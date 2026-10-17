// Live 块级原生 HTML 装饰（#567/T02，规格「Live 的状态与选区」表）：
// - 块表：Lezer HTMLBlock 节点派生（shared/htmlBlock 的顶层扫描——与
//   Reading 侧 markdown-it html_block token 两端对拍钉住），增量重建
//   （种子 = 变更区间 ∪ 相交旧块，窗口内树扫描、窗口外映射保留）。
// - 片段替换装饰：未触及 = **精确区间 [from, to] inline replace widget**
//   （liveEmbed #247 同款——保持 inline 是键盘垂直导航可进入该行的前提，
//   块级 replace 会被 CM6 跳过整行）；触及（selectionTouchesRange 语义：
//   折叠光标含两端、非空选区严格相交、任一 range 命中）= 撤下 widget
//   源码显形，**不扩大到相邻文字/整行**，兄弟块独立显隐；命中显形
//   （hitIntersectsRange，查找定位/锚点导航抵达源码区间）同列触发。
// - 纯 <style> 块（Q6A）：恒不发射装饰——源码常显可直接编辑，不占位。
// - 普通点击进入源码：widget ignoreEvent=false（点击落父编辑器选区管
//   线），另有 mousedown 拦截器把**无修饰左键**点击转成「选中该片段完整
//   源码」（规格「普通点击渲染内容或编辑按钮 → 选中完整源码」）；修饰
//   键点击（shift 扩选等）放行默认链——正反向跨块选择不扩选。
// - 显隐切换不产生文档修改或独立撤销历史（纯装饰派生，零写回）。
// - IME：组合发生在 CM6 文本层（组合期光标在已显形源码内 → 触及恒成立
//   不重挂 widget；组合在片段外 → widget 与组合节点不同 DOM 区域）——
//   与 liveInstance 组合门控族无交叉，无需额外冻结（推断依据：
//   selectionTouchesRange 在组合期内恒命中已显形区间）。
import { Facet, RangeSet, StateField, type ChangeSet, type Extension, type Range, type Text, type Transaction } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { ViewPlugin, ViewUpdate } from '@codemirror/view'
import { selectionTouchesRange } from './liveDecorations'
import { liveDecorationsField } from './liveDecorations'
import { hitIntersectsRange, hitRangesOf, hitRevealField, type HitRange } from './hitReveal'
import { isPureStyleHtmlBlock, topLevelHtmlBlockSpansOfTree, type HtmlBlockSpan } from '../shared/htmlBlock'
import { htmlBlockRenderHtml } from './htmlSanitize'
import { buildGraphicChrome, GRAPHIC_CHROME_CLASS_NAMES } from './graphicBlockChrome'
import { DocumentStyleBinding, type DocStyleResourcePort } from './docStyleLoader'
import { disposeHtmlResourcesOf, prepareHtmlResources } from './htmlResourceMount'
import { liveImagesOfView } from './liveLinks'
import { t } from '../shared/i18n'
import type { SyntaxNode, Tree } from '@lezer/common'

/** #567 Live HTML 块宿主稳定类名（样式契约 content 域 live-html-widget
 *  条目同源；宿主兼任 hover 边框与编辑按钮的定位包裹层） */
export const LIVE_HTML_CLASS_NAMES = {
  /** widget 根宿主（inline replace 的替换物，块级呈现；携带源码区间
   *  dataset 供点击拦截器定位） */
  host: 'vsidian-live-html',
  /** 净化内容容器（原生语义 DOM 的直接父级——docScope 标记面） */
  content: 'vsidian-live-html-content',
} as const

/** #572（T07）Live widget 内 iframe 的命中区接管结构（外层命中机制）：
 *  沙箱/跨域子文档是独立 document，帧内指针事件**不冒泡到父文档**——
 *  CM6 的 mousedown 拦截器无从命中，无法兑现「单击 iframe 可视区域 →
 *  选中完整源码」。以透明覆盖层（shield）盖住帧可视区，指针事件落在
 *  父文档元素上、正常冒泡到拦截器（结构载体而非事件自监听——「跨域
 *  iframe 不能冒充可直接监听的子 DOM」的落档形态）。Reading 侧不接管
 *  （规格 U13：承载受支持的原生交互）。 */
export const LIVE_HTML_FRAME_CLASS_NAMES = {
  /** iframe 定位包裹层（shield 的定位上下文；行内宿主内 inline-block） */
  frame: 'vsidian-live-html-frame',
  /** 透明命中接管层（inset:0 覆盖帧——样式契约 live-html-widget 条目） */
  shield: 'vsidian-live-html-frame-shield',
} as const

/** Live widget 内 iframe 装配 shield（幂等——已包裹的帧跳过） */
function shieldLiveIframes(content: HTMLElement): void {
  for (const iframe of Array.from(content.querySelectorAll('iframe'))) {
    if (iframe.parentElement?.classList.contains(LIVE_HTML_FRAME_CLASS_NAMES.frame) === true) {
      continue
    }
    const frame = document.createElement('div')
    frame.className = LIVE_HTML_FRAME_CLASS_NAMES.frame
    const shield = document.createElement('div')
    shield.className = LIVE_HTML_FRAME_CLASS_NAMES.shield
    iframe.replaceWith(frame)
    frame.append(iframe, shield)
  }
}

/** 装饰实例缓存上限（键 = 源文 + 区间 + docScope；与 liveEmbed 同量级） */
export const liveHtmlDecoCacheLimit = 64

/** 一个 Live HTML 块（LF 全文 offset，end 不含；source 为源文全量） */
export interface LiveHtmlSpan extends HtmlBlockSpan {
  source: string
}

/** 树窗口内顶层 HTMLBlock 扫描（表构建/增量重建共用） */
function scanHtmlSpans(doc: Text, tree: Tree, from: number, to: number): LiveHtmlSpan[] {
  const spans = topLevelHtmlBlockSpansOfTree(tree)
    .filter((s) => s.to > from && s.from < to)
  return spans.map((s) => ({ from: s.from, to: s.to, source: doc.sliceString(s.from, s.to) }))
}

/** 全树扫描（文档装载/resync 的全量路径） */
function scanAllHtmlSpans(doc: Text, tree: Tree | null): LiveHtmlSpan[] {
  if (!tree) {
    return []
  }
  return topLevelHtmlBlockSpansOfTree(tree)
    .map((s) => ({ from: s.from, to: s.to, source: doc.sliceString(s.from, s.to) }))
}

/**
 * #576 评审 P2-5：顶层结构签名守卫（块级与行内增量重建共用）。
 * 窗口化增量的安全前提是「变更区之外解析结构不变」；块级结构开关
 * （围栏开闭等）的传播影响会使**变更区之外**的块整体重分类
 * （HTMLBlock ↔ FencedCode——重解析后树是正确的，错的是窗口外保留的
 * 旧条目与缺口）。守卫：旧树顶层块经变更映射后与新树顶层逐一对照
 * （节点名 + 边界），全一致 = 变更区外无重分类（窗口外旧条目可信，
 * 纯增量保持——普通打字的顶层结构通常不变）；任一不一致（含块数增减）
 * = 退全量重扫（树是权威）。树未推进（同引用）由调用方短路。
 * #576 四轮复审 P2-4：顶层名与边界一致**不足以**证明容器内部结构不变
 * ——嵌套引用/列表内的 FencedCode 等重分类不改变顶层 Blockquote 的名
 * 与映射边界。补第二道：变更区间的**新旧两端**（iterChangedRanges 的
 * fromA/toA 旧坐标与 fromB/toB 新坐标——映射会落到删除区起点之前而
 * 看不到旧结构）各取祖先链名序列对照——内部重分类必然改变编辑点所处
 * 的结构路径（如 Blockquote>Blockquote>FencedCode ↔ Blockquote>
 * FencedCode），名序列不同即退全量（每次编辑多付常数次 O(depth) 对照）。
 */
export function topLevelStructureStable(
  changes: ChangeSet,
  oldTree: Tree,
  newTree: Tree,
): boolean {
  let o = oldTree.topNode.firstChild
  let n = newTree.topNode.firstChild
  for (; o !== null && n !== null; o = o.nextSibling, n = n.nextSibling) {
    if (o.name !== n.name) {
      return false
    }
    if (changes.mapPos(o.from, 1) !== n.from || changes.mapPos(o.to, -1) !== n.to) {
      return false
    }
  }
  if (o !== null || n !== null) {
    return false
  }
  const chainNamesOf = (tree: Tree, pos: number): string => {
    const clamped = Math.max(0, Math.min(pos, tree.length - 1))
    let node: SyntaxNode | null = tree.resolveInner(clamped, 1)
    const names: string[] = []
    while (node !== null) {
      names.push(node.name)
      node = node.parent
    }
    return names.join('>')
  }
  let chainsStable = true
  changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    if (!chainsStable) {
      return
    }
    const oldEnd = Math.max(fromA, toA - 1)
    const newEnd = Math.max(fromB, toB - 1)
    if (chainNamesOf(oldTree, fromA) !== chainNamesOf(newTree, fromB) ||
      chainNamesOf(oldTree, oldEnd) !== chainNamesOf(newTree, newEnd)) {
      chainsStable = false
    }
  })
  return chainsStable
}

/**
 * 块表增量重建（liveEmbed.rebuildEmbedSpans 同款纪律）：种子 = 变更区间
 * （新坐标）∪ 映射后与之相交的旧块；窗口内树扫描（树是权威——HTMLBlock
 * 的界定来自解析器，不猜嵌套），窗口外映射保留。坍缩条目（区间倒挂）
 * 丢弃。树缺席（liveDecorationsField 未初始化）时保持旧表——发射层仍有
 * 语法兜底。#576 评审 P2-5：prevTree 在场且顶层结构签名不稳定时退
 * 全量重扫（围栏开闭的传播重分类覆盖窗口外）。
 */
export function rebuildHtmlSpans(
  doc: Text,
  tr: Transaction,
  prev: readonly LiveHtmlSpan[],
  tree: Tree | null,
  prevTree?: Tree | null,
): LiveHtmlSpan[] {
  const changes = tr.changes
  let seedFrom = doc.length + 1
  let seedTo = -1
  changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    seedFrom = Math.min(seedFrom, fromB)
    seedTo = Math.max(seedTo, toB)
  })
  if (seedTo < 0) {
    return prev as LiveHtmlSpan[]
  }
  const mapped = prev.map((s) => ({
    from: changes.mapPos(s.from, 1),
    to: changes.mapPos(s.to, -1),
    source: s.source,
  }))
  for (const m of mapped) {
    if (m.to + 1 >= seedFrom && m.from <= seedTo + 1) {
      seedFrom = Math.min(seedFrom, m.from)
      seedTo = Math.max(seedTo, m.to)
    }
  }
  if (tree === null) {
    // 树缺席（理论不可达——docChanged 时 liveDecorationsField 先行重建）：
    // 保守只做映射，不产新块（降级方向 = 不渲染新 html，源码可见）
    return mapped.filter((m) => m.to > m.from)
  }
  if (prevTree != null && tree !== prevTree && !topLevelStructureStable(changes, prevTree, tree)) {
    // 块级重分类（围栏开闭的传播影响）：窗口策略不安全——全量重扫
    return scanAllHtmlSpans(doc, tree)
  }
  const out: LiveHtmlSpan[] = []
  for (const m of mapped) {
    if (m.to <= m.from) {
      continue // 坍缩产物（整块删除）
    }
    if (m.to < seedFrom || m.from > seedTo) {
      out.push(m) // 窗口外保留（映射语义：未受变更影响的块）
    }
  }
  out.push(...scanHtmlSpans(doc, tree, Math.max(0, seedFrom), Math.min(doc.length, seedTo)))
  out.sort((a, b) => a.from - b.from)
  return out
}

/** 全文档 HTML 块表：docChanged 时增量重建；树变化（增量解析推进）同样
 *  重建；纯选区移动零成本。树取自 liveDecorationsField（装配序在其后） */
export const liveHtmlSpansField = StateField.define<readonly LiveHtmlSpan[]>({
  create(state) {
    return scanAllHtmlSpans(state.doc, state.field(liveDecorationsField, false)?.tree ?? null)
  },
  update(value, tr) {
    const treeChanged =
      tr.startState.field(liveDecorationsField, false) !== tr.state.field(liveDecorationsField, false)
    if (!tr.docChanged && !treeChanged) {
      return value
    }
    if (!tr.docChanged && treeChanged) {
      // 树推进（解析追上文档）：全树重扫对齐（低频路径——resync/装载）
      return scanAllHtmlSpans(tr.state.doc, tr.state.field(liveDecorationsField, false)?.tree ?? null)
    }
    return rebuildHtmlSpans(tr.state.doc, tr, value,
      tr.state.field(liveDecorationsField, false)?.tree ?? null,
      tr.startState.field(liveDecorationsField, false)?.tree ?? null)
  },
})

/** 文档身份标记（T01 探针 b2 隔离基座）：根正文注入 'doc'，嵌入内部
 *  Live 的目标身份键随 T04 装载器接线；缺省不挂标记 */
const liveHtmlDocScopeFacet = Facet.define<string | null, string | null>({
  combine: (values) => values[values.length - 1] ?? null,
})

/** docScope 装配扩展（syncController 经 extraExtensions 注入根正文） */
export function liveHtmlDocScope(scope: string): Extension {
  return liveHtmlDocScopeFacet.of(scope)
}

/** docScope 读取面（#568/T03 行内装饰消费同一通道——不新建装载面；
 *  未装配（嵌入实例，随 T04 接线）时为 null） */
export function liveHtmlDocScopeOf(state: import('@codemirror/state').EditorState): string | null {
  return state.facet(liveHtmlDocScopeFacet)
}

/** #570（T05）资源解析的来源文档身份（嵌入内部 Live = B 的 fsPath；主文
 *  缺省 null = 面板自身文档 A）。与 docScope facet 同款注入面——widget
 *  toDOM 按所属视图读取，srcset/媒体属性与 CSS 资源按此身份订阅解析 */
const liveHtmlResourceSourceFacet = Facet.define<string | null, string | null>({
  combine: (values) => values[values.length - 1] ?? null,
})

/** 嵌入内部 Live 的资源来源装配（embedCard createLiveInstance 注入 B 的
 *  fsPath；主文不装配——hub 订阅 sourceDocUri 缺省即面板文档） */
export function liveHtmlResourceSource(fsPath: string | null): Extension {
  return liveHtmlResourceSourceFacet.of(fsPath)
}

/** 视图的资源来源身份读取面（widget toDOM 消费） */
export function liveHtmlResourceSourceOf(state: import('@codemirror/state').EditorState): string | null {
  return state.facet(liveHtmlResourceSourceFacet)
}

/**
 * 装饰构建（纯数据输入，可单测直驱）：逐块发射——未触及且非纯 style →
 * 精确区间 inline replace widget；触及（选区或命中显形）或纯 style →
 * 不发射（源码可见）。frontmatter 内不发射（头区不产正文装饰）。
 */
export function buildLiveHtmlDecorationRanges(
  selection: import('@codemirror/state').EditorSelection,
  spans: readonly LiveHtmlSpan[],
  fm: { end: number } | null,
  docScope: string | null,
  hits: readonly HitRange[] = [],
): Array<Range<Decoration>> {
  const out: Array<Range<Decoration>> = []
  for (const span of spans) {
    if (fm && span.from < fm.end) {
      continue
    }
    if (isPureStyleHtmlBlock(span.source)) {
      continue // Q6A：纯 style 块源码常显，不占位
    }
    const touched = selectionTouchesRange(selection, span.from, span.to) ||
      hitIntersectsRange(hits, span.from, span.to)
    if (!touched) {
      out.push(liveHtmlWidgetDeco(span.source, span.from, span.to, docScope).range(span.from, span.to))
    }
  }
  return out
}

// ---- widget 与装饰实例缓存 ----

/**
 * #570（T05）HTML widget 内容的资源装配 + 链接防跳转（块级与行内 widget
 * 共用执行体）：
 * - img/srcset/媒体属性按**所属视图**的资源身份装配（liveImagesOfView——
 *   根正文 = A 面板管理器、嵌入内部 Live = B 实例管理器；srcset/媒体属性
 *   经 hub 订阅，sourceDocUri 取视图的资源来源 facet）。
 * - `<a>` 点击一律 preventDefault：Live 普通点击优先源码显形（mousedown
 *   拦截器已转完整源码选区），修饰键点击保持选区语义——任何情形都不让
 *   webview 原生导航接管（相对路径在本 origin 必坏 + https 会整页跳走，
 *   均为「意外跳转」）。
 * - #572（T07）iframe 命中区接管：shield 盖帧（帧事件不冒泡到父文档——
 *   外层命中机制，见 LIVE_HTML_FRAME_CLASS_NAMES 头注释）。
 */
export function prepareHtmlWidgetContent(
  content: HTMLElement,
  view: import('@codemirror/view').EditorView | undefined,
): void {
  if (view !== undefined) {
    const sourceDocUri = liveHtmlResourceSourceOf(view.state)
    prepareHtmlResources(content, {
      images: liveImagesOfView(view) ?? null,
      sourceDocUri: sourceDocUri ?? undefined,
      live: true,
      // #573（T08）ID 文档作用域：docScope facet（主文 'doc' 零改写，
      // 嵌入内部 Live = B 的 docScope 键——B 产物 id 前缀化）
      docScope: liveHtmlDocScopeOf(view.state),
    })
  } else {
    // 裸构造（单测直驱无视图）：仅图片管理器绑定面缺席，属性资源照走 hub
    prepareHtmlResources(content, { images: null, live: true })
  }
  // #572（T07）iframe 命中区接管：shield 盖帧（帧事件不冒泡——见
  // LIVE_HTML_FRAME_CLASS_NAMES 头注释）；mousedown 冒泡到 CM6 拦截器
  // → 选中完整源码（与内容点击同一执行体）
  shieldLiveIframes(content)
  content.addEventListener('click', (event) => {
    const target = event.target
    if (target instanceof Element && target.closest('a[href]') !== null) {
      event.preventDefault() // 不意外跳转（规格「Live 的状态与选区」红线）
    }
  })
}

/**
 * Live HTML 块 widget：宿主 div（块级呈现 + hover 边框 + 右上角编辑按钮
 * ——复用图形块按钮族 DOM/CSS，仅 edit 钮）内挂净化后的原生语义 DOM。
 * ignoreEvent=false：点击落父编辑器选区管线（规格「HTML 内部普通点击仍
 * 优先进入源码」）；无修饰左键由 mousedown 拦截器转完整源码选区。
 * 宿主携带源码区间 dataset（拦截器与编辑按钮的目标面）与 docScope
 * 标记（T04 隔离基座——挂在内容语义根上，系统 chrome 不挂）。
 */
export class LiveHtmlWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly from: number,
    readonly to: number,
    readonly docScope: string | null,
  ) {
    super()
  }

  eq(other: LiveHtmlWidget): boolean {
    return other.source === this.source && other.from === this.from &&
      other.to === this.to && other.docScope === this.docScope
  }

  get lineBreaks(): number {
    return 1
  }

  toDOM(view?: import('@codemirror/view').EditorView): HTMLElement {
    const host = document.createElement('div')
    host.className = LIVE_HTML_CLASS_NAMES.host
    host.dataset['vsidianHtmlFrom'] = String(this.from)
    host.dataset['vsidianHtmlTo'] = String(this.to)
    const content = document.createElement('div')
    content.className = LIVE_HTML_CLASS_NAMES.content
    if (this.docScope !== null) {
      content.dataset['vsidianDocScope'] = this.docScope
    }
    content.innerHTML = htmlBlockRenderHtml(this.source)
    prepareHtmlWidgetContent(content, view)
    const chrome = buildGraphicChrome({
      // 编辑源码：与内容点击/键位操作同一执行体——选中完整源码区间
      // （selectionTouchesRange 命中 → 既有源码显形管线接管）
      onEdit: () => {
        const editorView = EditorView.findFromDOM(host)
        if (editorView) {
          editorView.dispatch({ selection: { anchor: this.from, head: this.to } })
          editorView.focus()
        }
      },
    })
    host.append(content, chrome)
    // 悬停提示（tooltip 规格接管机制：data-tooltip 唯一承载）
    host.setAttribute('data-tooltip', t('html.blockTooltip'))
    return host
  }

  ignoreEvent(): boolean {
    return false // 点击不吞——普通点击进入源码（规格红线）
  }

  /**
   * #571（T06）widget 退场（显形撤下/视口移除/视图销毁——CM6 移除 widget
   * DOM 时回调）：释放内容根的资源 binding（其 dispose 即媒体释放——
   * DOM 移除不自动暂停，防「显形后音频仍在播」）+ 订阅即时退订（不等
   * liveLinks 的 sweep 兜底周期）。
   */
  destroy(dom: HTMLElement): void {
    const content = dom.querySelector(`.${LIVE_HTML_CLASS_NAMES.content}`)
    if (content instanceof HTMLElement) {
      disposeHtmlResourcesOf(content)
    }
  }
}

const decoCache = new Map<string, ReturnType<typeof Decoration.replace>>()

/** widget 装饰实例缓存（同键复用，RangeSet.eq 前提；liveEmbed 同款 LRU） */
export function liveHtmlWidgetDeco(
  source: string,
  from: number,
  to: number,
  docScope: string | null,
): ReturnType<typeof Decoration.replace> {
  const key = `${docScope ?? ''}::${from}::${to}::${source}`
  const hit = decoCache.get(key)
  if (hit) {
    decoCache.delete(key)
    decoCache.set(key, hit)
    return hit
  }
  const deco = Decoration.replace({ widget: new LiveHtmlWidget(source, from, to, docScope) })
  decoCache.set(key, deco)
  while (decoCache.size > liveHtmlDecoCacheLimit) {
    const oldest = decoCache.keys().next().value
    if (oldest === undefined) {
      break
    }
    decoCache.delete(oldest)
  }
  return deco
}

/** HTML 块装饰（StateField，CM6 硬约束——跨行 replace 只能来自
 *  StateField）；块表/树/选区/命中集任一变化时重建 */
export const liveHtmlDecorations = StateField.define<DecorationSet>({
  create(state) {
    const deco = state.field(liveDecorationsField, false)
    if (!deco) {
      return RangeSet.empty
    }
    return RangeSet.of(
      buildLiveHtmlDecorationRanges(
        state.selection,
        state.field(liveHtmlSpansField, false) ?? [],
        deco.fm,
        state.facet(liveHtmlDocScopeFacet),
        hitRangesOf(state),
      ),
      true,
    )
  },
  update(value, tr) {
    const spansChanged =
      tr.startState.field(liveHtmlSpansField, false) !== tr.state.field(liveHtmlSpansField, false)
    const liveDecoChanged =
      tr.startState.field(liveDecorationsField, false) !== tr.state.field(liveDecorationsField, false)
    const hitsChanged =
      tr.startState.field(hitRevealField, false) !== tr.state.field(hitRevealField, false)
    if (!tr.docChanged && tr.selection === undefined && !spansChanged && !liveDecoChanged && !hitsChanged) {
      return value
    }
    const deco = tr.state.field(liveDecorationsField, false)
    if (!deco) {
      return RangeSet.empty
    }
    return RangeSet.of(
      buildLiveHtmlDecorationRanges(
        tr.state.selection,
        tr.state.field(liveHtmlSpansField, false) ?? [],
        deco.fm,
        tr.state.facet(liveHtmlDocScopeFacet),
        hitRangesOf(tr.state),
      ),
      true,
    )
  },
  provide: (f) => EditorView.decorations.from(f),
})

/**
 * HTML widget 普通点击拦截器工厂（#568/T03 起块级与行内共用同一执行体
 * 形状）：无修饰左键落在指定宿主类的 widget 渲染内容上 → 选中该片段
 * 完整源码并显形（返回 true 吞掉 CM6 默认光标落位）。修饰键（shift
 * 扩选/ctrl/alt/meta）与右键放行默认链——正反向跨片段选择不扩选、上下
 * 文菜单不受影响；按钮组自有 mousedown（preventDefault），先排除避免
 * 双发。
 */
export function makeHtmlWidgetMousedown(
  hostClass: string,
): (event: MouseEvent, view: EditorView) => boolean {
  return (event, view) => {
    if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) {
      return false
    }
    const target = event.target
    if (!(target instanceof Element)) {
      return false
    }
    if (target.closest(`.${GRAPHIC_CHROME_CLASS_NAMES.chrome}`) !== null) {
      return false // 编辑按钮自有处理（onEdit 同一执行体）
    }
    const host = target.closest<HTMLElement>(`.${hostClass}`)
    if (host === null) {
      return false
    }
    const from = Number(host.dataset['vsidianHtmlFrom'])
    const to = Number(host.dataset['vsidianHtmlTo'])
    if (!Number.isInteger(from) || !Number.isInteger(to) || to <= from || to > view.state.doc.length) {
      return false
    }
    view.dispatch({ selection: { anchor: from, head: to } })
    view.focus()
    return true
  }
}

/** 块级宿主的点击拦截器（行内版由 liveInlineHtml 以本工厂装配） */
const htmlWidgetMousedown = makeHtmlWidgetMousedown(LIVE_HTML_CLASS_NAMES.host)

/**
 * 「编辑当前 HTML 源码」执行体（键位操作/编辑按钮/内容点击三入口同源）：
 * 光标（主 range head）落在任一 html 块区间内（含边界）→ 选中该片段完整
 * 源码；无命中静默不动作（选区不变）。
 */
export function revealHtmlSourceAtCursor(view: EditorView): boolean {
  const spans = view.state.field(liveHtmlSpansField, false)
  if (!spans || spans.length === 0) {
    return false
  }
  const head = view.state.selection.main.head
  const hit = spans.find((s) => s.from <= head && head <= s.to)
  if (!hit) {
    return false
  }
  view.dispatch({ selection: { anchor: hit.from, head: hit.to } })
  return true
}

/** Live HTML 扩展装配：块表 + 装饰 + 点击拦截（纯装饰无键位语义，装配于
 *  liveEmbed 之后同组；docScope 由视图装配层经 liveHtmlDocScope 注入） */
export const liveHtml: Extension = [
  liveHtmlSpansField,
  liveHtmlDecorations,
  EditorView.domEventHandlers({ mousedown: htmlWidgetMousedown }),
]

/**
 * 文档样式装载 ViewPlugin（#569/T04）：docChanged 或语法树推进（增量解析
 * 换树引用——掩码判定可能更新）时按全文源文重收集并同步产物。装载在
 * ViewPlugin（不进 StateField——DOM 副作用不属编辑器状态）；destroy 随
 * 视图销毁释放（主文 dispose 链、嵌入内部 Live teardown 同一出口）。
 * Reading 主文档与 Live 共享同一 CM6 doc（双模式单一权威文本），本插件
 * 常驻即覆盖两模式。树缺席或与文本长度不符时收集器内部独立全文 parse
 * （坐标安全前提）。
 */
export function liveDocStyle(docScope: string, resourcePort?: DocStyleResourcePort | null): Extension {
  return ViewPlugin.fromClass(class {
    private readonly binding = new DocumentStyleBinding(docScope, resourcePort)

    constructor(view: EditorView) {
      this.syncNow(view)
    }

    update(update: ViewUpdate): void {
      const treeAdvanced =
        update.startState.field(liveDecorationsField, false) !== update.state.field(liveDecorationsField, false)
      if (!update.docChanged && !treeAdvanced) {
        return
      }
      this.syncNow(update.view)
    }

    private syncNow(view: EditorView): void {
      const deco = view.state.field(liveDecorationsField, false)
      this.binding.sync(view.state.doc.toString(), deco?.tree ?? null)
    }

    destroy(): void {
      this.binding.dispose()
    }
  })
}
