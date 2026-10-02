// Live 视图链接与图片（工单 #10/#28）：按 visibleRanges 间接装饰，
// 渲染态单击及 Ctrl/Cmd+单击上报跳转意图。
//
// 装饰语义（与既有间接装饰同类，ADR-0005 / #8 分工沿用）：
// - 链接内容 span：vsidian-link 稳定类名（Obsidian .cm-link 方向）；
//   光标或选区进入该链接范围才显示首尾标记与 URL，其余链接仍隐藏源码
// - 图片：光标在该图片范围外时替换为 LiveImageWidget（进入视口才创建
//   DOM，离开视口由 CM6 移除、经 ImageResourceManager.sweep 释放）；
//   进入图片范围才显示源码
// - 引用式链接/图片（[t][ref]）：本票不解析引用定义，保持源码降级
//   （阅读视图由 markdown-it 完整解析——差异见选择器映射表已知限制）
// - 自动链接 <https://…>：URL 即内容，标记 span + 范围外隐藏尖括号
//
// #11 双链装饰（本文件扩展）：`[[…]]` 不在 lezer Markdown 语法内（CommonMark
// 视为普通文本），装饰来源是 shared/wikilink 的行内扫描（与阅读渲染、宿主
// 解析共用同一形态学）；代码上下文（围栏/缩进/行内代码）与 frontmatter
// 内不装饰（语法树 + fm 边界判定，与 #8 的源码降级边界一致）。
//
// 点击语义：已渲染的链接单击跳转；光标进入该链接范围后的普通单击仍由 CM6 编辑；
// Ctrl/Cmd+单击在两种形态下都跳转
// （原始 URI/target + 源区间），执行归宿主（URI 解析与白名单在宿主侧；
// 双链先于普通链接判定——两者语法不重叠）。
import { EditorSelection, RangeSet, Text, type Extension, type Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from '@codemirror/view'
import type { SyntaxNode, Tree } from '@lezer/common'
import { chainAt, visitRange, type SourceRange } from './markdownDoc'
import { liveDecorationsField, selectionTouchesRange } from './liveDecorations'
import { hitIntersectsRange, hitRangesOf, hitRevealField, type HitRange } from './hitReveal'
import { IMAGE_CLASS_NAMES, type ImageResourceManager } from './imageResource'
import { buildGraphicChrome, GRAPHIC_CHROME_CLASS_NAMES, markImageFrameSized } from './graphicBlockChrome'
import { openImagePopup } from './imagePopup'
import {
  WIKILINK_CLASS_NAMES,
  embedAtCol,
  parseWikilinkInner,
  scanEmbedsInLine,
  scanWikilinksInLine,
  soleEmbedOfLine,
  wikilinkAtCol,
} from '../shared/wikilink'
import { looseLinkAtCol, scanLooseLinksInLine } from '../shared/looseLink'
import { applyObsidianDomAlias } from '../shared/obsidianAlias'

/** #10 链接稳定类名（图片类名复用 IMAGE_CLASS_NAMES.image） */
export const LINK_CLASS_NAMES = {
  /** 链接内容 span（Obsidian `.cm-link`） */
  link: 'vsidian-link',
} as const

/** Ctrl/Cmd 修饰键激活态类（挂 body；#217 验收反馈：按住 Ctrl/Cmd 悬停
 *  可跳转链接时加下划线与可点击光标——修饰键悬停的可发现性反馈，样式
 *  契约 content 域 mod-link-hover 条目同源；由 syncController 的
 *  keydown/keyup/blur 维护） */
export const LINK_MOD_CLASS = 'vsidian-mod-link'

export { WIKILINK_CLASS_NAMES }

// #132 别名桥：链接/双链装饰类经别名表加工（vsidian 名 + Obsidian 原名同挂）
const linkMarkDeco = Decoration.mark({ class: applyObsidianDomAlias(LINK_CLASS_NAMES.link) })
const renderedLinkMarkDeco = Decoration.mark({
  class: applyObsidianDomAlias(LINK_CLASS_NAMES.link),
  attributes: { 'data-vsidian-rendered-link': 'true' },
})
const hideDeco = Decoration.replace({})

// ---- #11 双链装饰实例缓存（同 display 复用同一实例，RangeSet.eq 成立） ----

const wikilinkMarkDeco = Decoration.mark({ class: applyObsidianDomAlias(WIKILINK_CLASS_NAMES.wikilink) })

/** widget 装饰缓存上限：键是用户内容（双链 display / 图片 src+alt），无上限
 *  会随大文档滚动无限累积——视口内同时可见的双链/图片远小于此，超限逐最旧 */
export const WIDGET_DECO_CACHE_LIMIT = 512

/** Map 的 LRU 化访问：命中即重插到迭代序末尾（Map 迭代序 = 插入序），
 *  超限逐迭代序最旧项 */
function lruGet<V>(cache: Map<string, V>, key: string): V | undefined {
  const hit = cache.get(key)
  if (hit !== undefined) {
    cache.delete(key)
    cache.set(key, hit)
  }
  return hit
}

function lruEvict<V>(cache: Map<string, V>, limit: number): void {
  while (cache.size > limit) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) {
      break
    }
    cache.delete(oldest)
  }
}

const wikilinkWidgetDecos = new Map<string, ReturnType<typeof Decoration.replace>>()

export function wikilinkWidgetDeco(display: string): ReturnType<typeof Decoration.replace> {
  const hit = lruGet(wikilinkWidgetDecos, display)
  if (hit) {
    return hit
  }
  const deco = Decoration.replace({ widget: new LiveWikilinkWidget(display) })
  wikilinkWidgetDecos.set(display, deco)
  lruEvict(wikilinkWidgetDecos, WIDGET_DECO_CACHE_LIMIT)
  return deco
}

/**
 * #11 live 双链 widget：光标在范围外时把 `[[…]]` 整体替换为显示文字（别名或
 * 链接名）。纯呈现（无加载/失败生命周期）；点击交互经编辑器级
 * 编辑器级 mousedown 的 posAtCoords 命中（替换区间仍有文档坐标）。
 */
export class LiveWikilinkWidget extends WidgetType {
  constructor(readonly displayText: string) {
    super()
  }

  eq(other: LiveWikilinkWidget): boolean {
    return other.displayText === this.displayText
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = applyObsidianDomAlias(WIKILINK_CLASS_NAMES.wikilink)
    span.dataset['vsidianRenderedWikilink'] = 'true'
    span.textContent = this.displayText
    return span
  }

  ignoreEvent(): boolean {
    return false // 交给 CM6：渲染态单击跳转，其他事件仍可用于编辑
  }
}

/** 行扫描类内联装饰（双链 / #152 宽松链接）排除的代码上下文（lezer 节点
 *  名）：围栏/缩进代码与行内代码内按源码呈现 */
const INLINE_SCAN_CODE_CONTEXTS = new Set([
  'FencedCode',
  'CodeBlock',
  'CodeText',
  'CodeMark',
  'CodeInfo',
  'InlineCode',
])

/** occurrence 起点是否处于代码上下文或 frontmatter 内（源码降级边界） */
function inlineScanSuppressed(tree: Tree, from: number, fm: SourceRange | null): boolean {
  if (fm && from < fm.end) {
    return true
  }
  for (const node of chainAt(tree, from)) {
    if (INLINE_SCAN_CODE_CONTEXTS.has(node.name)) {
      return true
    }
  }
  return false
}

/** 无管理器形态（纯构建直驱）的缓存键（模块级常量对象） */
const NO_MANAGER = {}

/** live 图片 widget 装饰缓存：按管理器实例隔离（同 src/alt/形态 复用同一
 *  实例，RangeSet.eq 成立；不同管理器/会话不得共享 widget 实例） */
const imageWidgetDecos = new WeakMap<object, Map<string, ReturnType<typeof Decoration.replace>>>()

export function imageWidgetDeco(
  src: string,
  alt: string,
  images: ImageResourceManager | undefined,
  block = false,
  chrome = false,
) {
  const holder: object = images ?? NO_MANAGER
  let cache = imageWidgetDecos.get(holder)
  if (!cache) {
    cache = new Map()
    imageWidgetDecos.set(holder, cache)
  }
  const key = `${src}\u0000${alt}\u0000${block ? '1' : '0'}\u0000${chrome ? '1' : '0'}`
  const hit = lruGet(cache, key)
  if (hit) {
    return hit
  }
  const deco = Decoration.replace({ widget: new LiveImageWidget(src, alt, images, block, chrome) })
  cache.set(key, deco)
  lruEvict(cache, WIDGET_DECO_CACHE_LIMIT)
  return deco
}

/** live 图片 widget：占位（alt 文本）→ 经资源管理器装载 → 失败可重试。
 *  block = 独立成行形态（该行其余文本全空白）：容器取块级布局，为无固有
 *  尺寸的图源（viewBox-only 百分比宽 SVG）给出确定宽度基准。
 *  chrome = 挂同款 hover 按钮组（#212：edit + popup）并吞点击——图片本体
 *  不再触发光标落位/源码显形（误触源），编辑入口收敛到 edit 按钮；链接
 *  内嵌与表格网格内图片不挂（chrome=false 保持既有落位/跳转语义，规格
 *  明确排除）。按钮组 DOM 是 graphicBlockChrome 通用件（代码块同款），
 *  显现由 CSS 的 loaded 态兄弟选择器承担（错误/加载态无按钮）。 */
export class LiveImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly images?: ImageResourceManager,
    readonly block = false,
    readonly chrome = false,
  ) {
    super()
  }

  eq(other: LiveImageWidget): boolean {
    return (
      other.src === this.src && other.alt === this.alt && other.block === this.block && other.chrome === this.chrome
    )
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span')
    // chrome 形态槽位兼任按钮组定位宿主（vsidian-graphic-frame 的
    // position:relative + inline-block 行内形态覆盖规则），按钮组为 img 的
    // 后置兄弟——与 mermaid 渲染容器/chrome 的兄弟结构同构，CSS 兄弟选择
    // 器（loaded 态显现、hover 显隐）两侧共用
    span.className = this.chrome
      ? `${IMAGE_CLASS_NAMES.image} ${GRAPHIC_CHROME_CLASS_NAMES.frame}`
      : IMAGE_CLASS_NAMES.image
    if (this.block) {
      span.classList.add(IMAGE_CLASS_NAMES.block)
    }
    span.dataset['vsidianImgState'] = 'loading'
    span.classList.add(IMAGE_CLASS_NAMES.state('loading'))
    span.setAttribute('data-tooltip', this.alt)

    span.textContent = this.alt
    this.images?.attach(span, this.src, (slot, src) => {
      slot.textContent = ''
      const image = document.createElement('img')
      image.alt = this.alt
      image.src = src
      // 禁原生拖拽（与阅读侧 attach 通道同源决策）：ghost 缩略图 + 复制
      // 徽标语义错乱，且吞交互输入流
      image.draggable = false
      slot.appendChild(image)
      if (this.chrome) {
        slot.appendChild(
          buildGraphicChrome({
            // 编辑源码（同代码块 edit 语义）：光标落图片源码起点 →
            // selectionTouchesRange 命中 → widget 退场显源文
            onEdit: () => {
              const view = EditorView.findFromDOM(span)
              if (view) {
                view.dispatch({ selection: { anchor: view.posAtDOM(span) } })
              }
            },
            onPopup: () => {
              openImagePopup(this.src, this.alt)
            },
          }),
        )
      }
      // 贴图收缩标记：仅独行块级 chrome 形态挂载（行内混排/表格/内嵌
      // 无按钮贴图诉求，不挂类留语义噪音）；render 每次执行处挂，重取
      // 重建时随新 load 重算
      if (this.block && this.chrome) {
        markImageFrameSized(slot, image)
      }
      return image
    })
    return span
  }

  /** 图片错误态重试由管理器处理（原生 DOM 监听不受 CM6 事件管线影响）；
   *  chrome 形态吞掉其余事件——点击不触发光标落位/源码显形（#212 防误触），
   *  编辑入口迁移到 edit 按钮；非 chrome 形态（链接内嵌/表格网格内）交还
   *  编辑器（既有落位与 Ctrl+点击跳转语义，规格明确排除不改） */
  ignoreEvent(): boolean {
    return this.chrome
  }
}

/** 名为 name 的直接子节点 */
function childNamed(node: SyntaxNode, name: string): SyntaxNode | null {
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.name === name) {
      return c
    }
  }
  return null
}

/** 祖先链上是否有名为 name 的节点（#212 图片 chrome 排除判定：
 *  Link 内嵌 / Table 网格内不挂按钮组不吞点击，规格明确排除） */
function hasAncestorNamed(node: SyntaxNode, name: string): boolean {
  for (let p = node.parent; p; p = p.parent) {
    if (p.name === name) {
      return true
    }
  }
  return false
}

/** [from,to) 是否整体落在语法树的 Table 节点内（#212 宽松路径的表格
 *  判定——行扫描无节点可查祖先，改按区间包含查询；Table 不可嵌套，
 *  命中即唯一） */
function insideTableRange(tree: Tree, from: number, to: number): boolean {
  let hit = false
  tree.iterate({
    from,
    to,
    enter: (node) => {
      if (node.name === 'Table' && node.from <= from && node.to >= to) {
        hit = true
        return false
      }
      return true
    },
  })
  return hit
}

/** LinkMark 子节点序列（升序） */
function linkMarks(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = []
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.name === 'LinkMark') {
      out.push(c)
    }
  }
  return out
}

/** 内联形态（`[t](url)` / `![a](src)`）：闭括号后随 '(' 开标记。
 *  引用形态（`[t][ref]`，后随 LinkLabel）本票不装饰（源码降级） */
function isInlineForm(node: SyntaxNode, doc: Text): boolean {
  const marks = linkMarks(node)
  const closer = marks[1]
  if (!closer) {
    return false
  }
  const next = closer.nextSibling
  if (!next || next.name !== 'LinkMark') {
    return false
  }
  return doc.sliceString(next.from, next.to).startsWith('(')
}

/** URL 子节点的目标文本（剥 <> 包裹形态） */
function linkHrefOf(doc: Text, node: SyntaxNode): string | null {
  const url = childNamed(node, 'URL')
  if (!url) {
    return null
  }
  let href = doc.sliceString(url.from, url.to)
  if (href.startsWith('<') && href.endsWith('>') && href.length >= 2) {
    href = href.slice(1, -1)
  }
  return href || null
}

/** 图片出现（[from, to)）所在行其余文本是否全为空白：独立成行判定——
 *  整行仅含一张图片时 live widget 槽位取块级布局（vsidian-image-block），
 *  为无固有尺寸图源给出确定宽度基准；列表前缀、混排文字、同行多图均
 *  不满足（保持行内形态） */
function soloImageLine(doc: Text, from: number, to: number): boolean {
  const line = doc.lineAt(from)
  const before = line.text.slice(0, from - line.from)
  const after = line.text.slice(to - line.from)
  return !/\S/.test(before) && !/\S/.test(after)
}

/** 区间裁剪：[from, to) 减去 cuts（互不重叠、已排序） */
function subtractIntervals(
  from: number,
  to: number,
  cuts: Array<{ from: number; to: number }>,
): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = []
  let at = from
  for (const cut of cuts) {
    if (cut.to <= at || cut.from >= to) {
      continue
    }
    if (cut.from > at) {
      out.push({ from: at, to: cut.from })
    }
    at = Math.max(at, cut.to)
  }
  if (at < to) {
    out.push({ from: at, to })
  }
  return out
}

/**
 * 构建视口内链接/图片间接装饰（原始区间表；#11 起与双链装饰合并为同一
 * ViewPlugin 的输出）。纯数据输入，可单测直驱。
 * visitRange 相交访问可能重复命中跨区间边界的节点——以节点 from 去重。
 */
export function buildLinkImageDecorationRanges(
  doc: Text,
  tree: Tree,
  selection: EditorSelection,
  visibleRanges: ReadonlyArray<{ from: number; to: number }>,
  images?: ImageResourceManager,
  hits: readonly HitRange[] = [],
): Array<Range<Decoration>> {
  const out: Array<Range<Decoration>> = []
  const seen = new Set<SyntaxNode>()
  const imageRangesByRange: Array<Array<{ from: number; to: number }>> = []
  for (const range of visibleRanges) {
    const imageRanges: Array<{ from: number; to: number }> = []
    imageRangesByRange.push(imageRanges)
    visitRange(tree, range.from, range.to, (node) => {
      if (node.name === 'Image' && isInlineForm(node, doc)) {
        imageRanges.push({ from: node.from, to: node.to })
      }
    })
    imageRanges.sort((a, b) => a.from - b.from)
  }
  for (let i = 0; i < visibleRanges.length; i++) {
    const range = visibleRanges[i]!
    const imageRanges = imageRangesByRange[i]!
    visitRange(tree, range.from, range.to, (node) => {
      if (seen.has(node)) {
        return
      }
      const active = selectionTouchesRange(selection, node.from, node.to)
      switch (node.name) {
        case 'Autolink': {
          seen.add(node)
          const url = childNamed(node, 'URL')
          if (url && url.to > url.from) {
            out.push((active ? linkMarkDeco : renderedLinkMarkDeco).range(url.from, url.to))
          }
          if (!active) {
            for (const mark of linkMarks(node)) {
              out.push(hideDeco.range(mark.from, mark.to))
            }
          }
          return
        }
        case 'Link': {
          if (!isInlineForm(node, doc)) {
            return // 引用式：源码降级
          }
          seen.add(node)
          const marks = linkMarks(node)
          const opener = marks[0]
          const closer = marks[1]
          if (!opener || !closer || closer.from <= opener.to) {
            return
          }
          // 内容 span：扣除内部图片（其自身是替换装饰，mark 不得跨越）
          const innerCuts = imageRanges.filter((r) => r.from >= opener.to && r.to <= closer.from)
          for (const run of subtractIntervals(opener.to, closer.from, innerCuts)) {
            if (run.to > run.from) {
              out.push((active ? linkMarkDeco : renderedLinkMarkDeco).range(run.from, run.to))
            }
          }
          if (!active) {
            out.push(hideDeco.range(opener.from, opener.to))
            // 尾部整体隐藏："]" + "(" + URL + 标题 + ")"（连续区间，mark/URL
            // 均在其中——对内联形态该区间不含正文）
            out.push(hideDeco.range(closer.from, node.to))
          }
          return
        }
        case 'Image': {
          if (!isInlineForm(node, doc)) {
            return // 引用式：源码降级
          }
          // #251 命中显形：独行图片的替换区间与活跃命中相交时回源码
          // （widget 上的命中 mark 画不出来）。行内混排图片刻意不参与
          // （票面覆盖清单钉住独行形态，不顺手放宽）
          if (active ||
              (soloImageLine(doc, node.from, node.to) &&
                hitIntersectsRange(hits, node.from, node.to))) {
            return // 光标进入该图片范围，显示源码供编辑
          }
          seen.add(node)
          const marks = linkMarks(node)
          const opener = marks[0]
          const closer = marks[1]
          const src = linkHrefOf(doc, node)
          if (!opener || !closer || src === null) {
            return
          }
          const alt = doc.sliceString(opener.to, closer.from)
          // #212 按钮组排除：链接内嵌图片（`[![a](i)](url)`，点击保留链接
          // 跳转语义）与表格网格内图片（点击落单元格源码）不挂 chrome、
          // 不吞点击（规格明确排除，行为现状钉住）
          const chrome = !hasAncestorNamed(node, 'Link') && !hasAncestorNamed(node, 'Table')
          out.push(
            imageWidgetDeco(
              src,
              alt,
              images,
              soloImageLine(doc, node.from, node.to),
              chrome,
            ).range(node.from, node.to),
          )
          return
        }
        default:
          return
      }
    })
  }
  return out
}

/** 构建视口内链接/图片间接装饰（#10 契约入口；区间表版之上的包装） */
export function buildLinkImageDecorations(
  doc: Text,
  tree: Tree,
  selection: EditorSelection,
  visibleRanges: ReadonlyArray<{ from: number; to: number }>,
  images?: ImageResourceManager,
  hits: readonly HitRange[] = [],
): DecorationSet {
  return RangeSet.of(
    buildLinkImageDecorationRanges(doc, tree, selection, visibleRanges, images, hits),
    true,
  )
}

/**
 * 构建视口内双链装饰区间（#11）：逐行扫描 shared/wikilink 的出现表——
 * - 光标在该双链范围外：`[[…]]` 整体替换为显示文字 widget
 * - 光标进入该双链范围：mark 标记整个出现（源码可编辑）
 * - 代码上下文（围栏/缩进/行内代码）与 frontmatter 内不装饰（源码降级）
 * 纯数据输入，可单测直驱。
 *
 * #217 验收反馈：嵌入 `![[…]]` 与双链并行消费同一扫描循环（scanEmbedsInLine
 * ——形态学镜像、命中互斥）。嵌入只发射 mark（链接高亮），且**接管行归
 * 接管方**：独占行嵌入在光标未及时由 liveEmbed 整行 replace 接管（此处
 * 零发射——mark 与整行 replace 重叠会同帧渲染出被替换的源文，浏览器
 * 实测；显形态（触及）时 liveEmbed 撤 replace、源文在场，此处发射 mark
 * 保有链接色）；混排/容器内嵌入 liveEmbed 永不接管，mark 常驻（源文
 * 常驻即有链接色）。
 */
export function buildWikilinkDecorationRanges(
  doc: Text,
  tree: Tree,
  selection: EditorSelection,
  visibleRanges: ReadonlyArray<{ from: number; to: number }>,
  fm: SourceRange | null,
): Array<Range<Decoration>> {
  const out: Array<Range<Decoration>> = []
  const seenLines = new Set<number>()
  for (const range of visibleRanges) {
    let pos = range.from
    while (pos < range.to) {
      const line = doc.lineAt(pos)
      if (!seenLines.has(line.number)) {
        seenLines.add(line.number)
        for (const hit of scanWikilinksInLine(line.text, line.from)) {
          if (inlineScanSuppressed(tree, hit.from, fm)) {
            continue
          }
          const parsed = parseWikilinkInner(hit.inner)
          if (!parsed) {
            continue // 防御：扫描已过滤非法形态
          }
          out.push(
            selectionTouchesRange(selection, hit.from, hit.to)
              ? wikilinkMarkDeco.range(hit.from, hit.to)
              : wikilinkWidgetDeco(parsed.display).range(hit.from, hit.to),
          )
        }
        for (const hit of scanEmbedsInLine(line.text, line.from)) {
          if (inlineScanSuppressed(tree, hit.from, fm)) {
            continue
          }
          // 独占行嵌入：仅光标/选区触及（显形态——liveEmbed 已撤整行
          // replace、源文在场）时发射 mark；未及时该行由 liveEmbed 的
          // replace 接管，零发射避免重叠渲染冲突。混排行永不接管，常驻
          const sole = soleEmbedOfLine(line.text) !== null
          if (sole && !selectionTouchesRange(selection, hit.from, hit.to)) {
            continue
          }
          out.push(wikilinkMarkDeco.range(hit.from, hit.to))
        }
      }
      if (line.to >= range.to) {
        break
      }
      pos = line.to + 1
    }
  }
  return out
}

/** 树上查找 pos 处链接的目标 href；非链接位置返回 null */
function hrefAtPos(doc: Text, tree: Tree, pos: number): { href: string; from: number; to: number } | null {
  const chain = chainAt(tree, pos)
  const node = chain.find((n) => n.name === 'Link' || n.name === 'Autolink')
  if (!node) {
    return null
  }
  const href = linkHrefOf(doc, node)
  if (href === null) {
    return null
  }
  return { href, from: node.from, to: node.to }
}

/**
 * 构建视口内宽松内联链接/图片装饰区间（#152）：逐行扫描 shared/looseLink
 * 的出现表——lezer 对含空格目标只产 `[文字]` 残节点（树驱动路径不可用），
 * 行扫描与阅读渲染共用同一形态学（双链装饰同机制）。呈现语义与树驱动
 * 路径一致：光标在范围外链接标签为 rendered mark + 首尾隐藏、图片整块
 * 替换 widget；光标进入显源码。代码上下文与 frontmatter 内不装饰。
 * 纯数据输入，可单测直驱。
 */
export function buildLooseLinkDecorationRanges(
  doc: Text,
  tree: Tree,
  selection: EditorSelection,
  visibleRanges: ReadonlyArray<{ from: number; to: number }>,
  fm: SourceRange | null,
  images?: ImageResourceManager,
  hits: readonly HitRange[] = [],
): Array<Range<Decoration>> {
  const out: Array<Range<Decoration>> = []
  const seenLines = new Set<number>()
  for (const range of visibleRanges) {
    let pos = range.from
    while (pos < range.to) {
      const line = doc.lineAt(pos)
      if (!seenLines.has(line.number)) {
        seenLines.add(line.number)
        for (const hit of scanLooseLinksInLine(line.text, line.from)) {
          if (inlineScanSuppressed(tree, hit.from, fm)) {
            continue
          }
          if (hit.image) {
            // #251 命中显形：独行图片命中相交回源（与树驱动路径同口径）
            if (selectionTouchesRange(selection, hit.from, hit.to) ||
                (soloImageLine(doc, hit.from, hit.to) &&
                  hitIntersectsRange(hits, hit.from, hit.to))) {
              continue // 光标进入该图片范围，显示源码供编辑
            }
            const alt = doc.sliceString(hit.labelFrom, hit.labelTo)
            // #212 宽松图片同机制：表格网格内不挂 chrome 不吞点击（宽松
            // 形态学守卫标签不含 []，不会出现在链接内）
            out.push(
              imageWidgetDeco(
                hit.dest,
                alt,
                images,
                soloImageLine(doc, hit.from, hit.to),
                !insideTableRange(tree, hit.from, hit.to),
              ).range(hit.from, hit.to),
            )
            continue
          }
          const active = selectionTouchesRange(selection, hit.from, hit.to)
          out.push(
            (active ? linkMarkDeco : renderedLinkMarkDeco).range(hit.labelFrom, hit.labelTo),
          )
          if (!active) {
            // 首尾整体隐藏：`[` 与 `](目标)`（连续区间；标签内无嵌套图片——
            // 形态学守卫标签不含 []，嵌套图片即独立出现）
            out.push(hideDeco.range(hit.from, hit.labelFrom))
            out.push(hideDeco.range(hit.labelTo, hit.to))
          }
        }
      }
      if (line.to >= range.to) {
        break
      }
      pos = line.to + 1
    }
  }
  return out
}

/** 激活指定源位置的链接：命中即上报意图并返回 true */
export function activateLinkAtPos(
  view: EditorView,
  pos: number,
  postActivate: (href: string, srcStart: number, srcEnd: number) => void,
): boolean {
  const state = view.state
  const field = state.field(liveDecorationsField, false)
  if (!field) {
    return false
  }
  const hit = hrefAtPos(state.doc, field.tree, Math.max(0, Math.min(pos, state.doc.length)))
  if (!hit) {
    return false
  }
  postActivate(hit.href, hit.from, hit.to)
  return true
}

/** 激活指定源位置的宽松链接（#152）：命中即上报意图（字面目标原文，含
 *  空格——宿主 trim/容错解码）并返回 true。图片形态不是跳转目标（错误
 *  态重试由资源管理器处理）。替换区间仍有文档坐标，命中判定与源码态一致。 */
export function activateLooseLinkAtPos(
  view: EditorView,
  pos: number,
  postActivate: (href: string, srcStart: number, srcEnd: number) => void,
): boolean {
  const state = view.state
  const field = state.field(liveDecorationsField, false)
  if (!field) {
    return false
  }
  const clamped = Math.max(0, Math.min(pos, state.doc.length))
  const line = state.doc.lineAt(clamped)
  const hit = looseLinkAtCol(line.text, clamped - line.from)
  if (!hit || hit.image) {
    return false
  }
  const from = line.from + hit.from
  const to = line.from + hit.to
  if (inlineScanSuppressed(field.tree, from, field.fm)) {
    return false
  }
  postActivate(hit.dest, from, to)
  return true
}

/** 激活指定源位置的双链：命中即上报意图（原始 target：`|` 之前原文）并
 *  返回 true。替换区间（光标在范围外时的 widget）仍有文档坐标，命中判定与源码态
 *  一致。#11。不含嵌入（`![[…]]` 走 activateEmbedAtPos——悬停预览判定族
 *  复用本函数且嵌入保持「常驻卡片不弹浮层」守卫，两语义分层）。 */
export function activateWikilinkAtPos(
  view: EditorView,
  pos: number,
  postActivate: (target: string, srcStart: number, srcEnd: number) => void,
): boolean {
  const state = view.state
  const field = state.field(liveDecorationsField, false)
  if (!field) {
    return false
  }
  const clamped = Math.max(0, Math.min(pos, state.doc.length))
  const line = state.doc.lineAt(clamped)
  const hit = wikilinkAtCol(line.text, clamped - line.from)
  if (!hit) {
    return false
  }
  // wikilinkAtCol 产出的是行内相对坐标：换算回全文绝对 offset（抑制检查与
  // 上报区间都以全文坐标为契约）
  const from = line.from + hit.from
  const to = line.from + hit.to
  if (parseWikilinkInner(hit.inner) === null || inlineScanSuppressed(field.tree, from, field.fm)) {
    return false
  }
  const pipeAt = hit.inner.indexOf('|')
  const target = pipeAt >= 0 ? hit.inner.slice(0, pipeAt) : hit.inner
  postActivate(target, from, to)
  return true
}

/** 激活指定源位置的嵌入（#217 验收反馈：嵌入源码恢复 Ctrl+点击跳转
 *  语义——与卡片右上角 open 入口同款 wikilink.activate 消息；与
 *  activateWikilinkAtPos 分层：悬停预览判定族只消费双链版，嵌入保持
 *  「常驻卡片不弹浮层」守卫，本函数仅由跳转事件路径串联）。命中上报
 *  原始 target（`|` 之前原文）与完整 `![[…]]` 区间并返回 true。 */
export function activateEmbedAtPos(
  view: EditorView,
  pos: number,
  postActivate: (target: string, srcStart: number, srcEnd: number) => void,
): boolean {
  const state = view.state
  const field = state.field(liveDecorationsField, false)
  if (!field) {
    return false
  }
  const clamped = Math.max(0, Math.min(pos, state.doc.length))
  const line = state.doc.lineAt(clamped)
  const hit = embedAtCol(line.text, clamped - line.from)
  if (!hit) {
    return false
  }
  const from = line.from + hit.from
  const to = line.from + hit.to
  if (inlineScanSuppressed(field.tree, from, field.fm)) {
    return false
  }
  const pipeAt = hit.inner.indexOf('|')
  const target = pipeAt >= 0 ? hit.inner.slice(0, pipeAt) : hit.inner
  postActivate(target, from, to)
  return true
}

/** Ctrl/Cmd+mousedown 直接激活；普通单击在 mouseup 才确认，以免拖选时跳转。
 *  #11：双链先于普通链接判定（两者语法不重叠，先后仅是判定次序）；
 *  #152：树驱动链接之后是宽松链接（行扫描判定，语法不重叠） */
export function makeLinkMouseDownHandler(
  postActivate: (href: string, srcStart: number, srcEnd: number) => void,
  postActivateWikilink?: (target: string, srcStart: number, srcEnd: number) => void,
): (event: MouseEvent, view: EditorView) => boolean {
  return (event, view) => {
    if (event.button !== 0 || !(event.ctrlKey || event.metaKey)) return false
    // 6.43 API 面：posAtCoords 直接返回 number | null
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
    if (pos === null) {
      return false
    }
    if (postActivateWikilink &&
        (activateWikilinkAtPos(view, pos, postActivateWikilink) ||
          activateEmbedAtPos(view, pos, postActivateWikilink))) {
      event.preventDefault()
      return true
    }
    if (activateLinkAtPos(view, pos, postActivate) || activateLooseLinkAtPos(view, pos, postActivate)) {
      event.preventDefault()
      return true
    }
    return false
  }
}

/** live 链接/图片/双链扩展装配：视口间接装饰 + 图片资源管理器 + 点击 */
export function createLinkInteractions(opts: {
  postActivate: (href: string, srcStart: number, srcEnd: number) => void
  images: ImageResourceManager
  /** #11 双链激活回调（缺省不启用双链点击判定） */
  postActivateWikilink?: (target: string, srcStart: number, srcEnd: number) => void
}): Extension {
  const onMouseDown = makeLinkMouseDownHandler(opts.postActivate, opts.postActivateWikilink)
  let pendingClick: { target: 'wikilink' | 'link'; pos: number; x: number; y: number } | null = null
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = this.build(view)
      }
      update(update: import('@codemirror/view').ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged ||
            update.startState.field(hitRevealField, false) !== update.state.field(hitRevealField, false)) {
          this.decorations = this.build(update.view)
        }
        // 视口外移除的 widget 无销毁回调：以 isConnected 兜底释放图片槽位
        opts.images.sweep()
      }
      private build(view: EditorView): DecorationSet {
        const field = view.state.field(liveDecorationsField, false)
        if (!field) {
          return RangeSet.empty
        }
        const hits = hitRangesOf(view.state)
        // #11：链接/图片（树驱动）与双链（行扫描）的区间合并为同一装饰集
        // ——两类语法不重叠，RangeSet.of 排序去重即可；#152 宽松链接同为
        // 行扫描来源，与树驱动/双链语法均不重叠（仅接管标准层拒绝的形态）
        return RangeSet.of(
          [
            ...buildLinkImageDecorationRanges(
              view.state.doc,
              field.tree,
              view.state.selection,
              view.visibleRanges,
              opts.images,
              hits,
            ),
            ...buildWikilinkDecorationRanges(
              view.state.doc,
              field.tree,
              view.state.selection,
              view.visibleRanges,
              field.fm,
            ),
            ...buildLooseLinkDecorationRanges(
              view.state.doc,
              field.tree,
              view.state.selection,
              view.visibleRanges,
              field.fm,
              opts.images,
              hits,
            ),
          ],
          true,
        )
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
      eventHandlers: {
        mousedown(event: MouseEvent, view: EditorView) {
          pendingClick = null
          if (event.ctrlKey || event.metaKey) return onMouseDown(event, view)
          if (event.button !== 0) return false
          // #237 多光标：Alt+点击是「在指针处添加光标」手势（clickAdds
          // SelectionRange），不是链接激活——按下与抬起双侧排除，防止
          // 按下无修饰、抬起带 Alt（或反之）的混合手势误触发跳转
          if (event.altKey) return false
          const target = event.target instanceof Element ? event.target : null
          // #42 网格中的普通单击先进入对应单元格源码；显式 Ctrl/Cmd
          // 仍按上方分支跳转，避免整格都是链接时失去点击编辑入口。
          if (target?.closest('.vsidian-table-grid-row')) return false
          const rendered = target?.closest('[data-vsidian-rendered-wikilink="true"]')
            ? 'wikilink'
            : target?.closest('[data-vsidian-rendered-link="true"]') ? 'link' : null
          if (!rendered) return false
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
          if (pos !== null) pendingClick = { target: rendered, pos, x: event.clientX, y: event.clientY }
          return false
        },
        mouseup(event: MouseEvent, view: EditorView) {
          const pending = pendingClick
          pendingClick = null
          if (!pending || event.button !== 0 || event.altKey ||
            Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 5) return false
          // #152：树驱动链接未命中再试宽松链接（行扫描；含 pos-1 边界重试）。
          // 嵌入（#217）与双链共享 wikilink 渲染类——渲染态点击目标同族，
          // 双链未命中再试嵌入激活
          const activateLink = (pos: number) =>
            activateLinkAtPos(view, pos, opts.postActivate) ||
            activateLooseLinkAtPos(view, pos, opts.postActivate)
          const activateWl = (pos: number) =>
            activateWikilinkAtPos(view, pos, opts.postActivateWikilink!) ||
            activateEmbedAtPos(view, pos, opts.postActivateWikilink!)
          const hit = pending.target === 'wikilink'
            ? Boolean(opts.postActivateWikilink &&
              (activateWl(pending.pos) || (pending.pos > 0 && activateWl(pending.pos - 1))))
            : activateLink(pending.pos) || (pending.pos > 0 && activateLink(pending.pos - 1))
          if (hit) event.preventDefault()
          return hit
        },
      },
    },
  )
}
