// 出链抽取纯逻辑（工单 #197，父规格 #194「路径与范围」）：从 Markdown 全文
// 抽取双链 / 普通内联链接 / 图片 / 引用式链接定义为边（VaultEdge 形态），
// 排除代码字面量（围栏 / 缩进 / 行内代码）与 frontmatter。
//
// 与呈现侧同源（规格硬约束「语法抽取应与当前呈现复用规则，差异必须有测试
// 及明确说明」）：
// - 树驱动链接 / 图片 / 引用式定义：markdownTreeParser（与 liveDecorations /
//   大纲同一解析器，src/webview/markdownDoc），内联形态判定与 liveLinks 的
//   buildLinkImageDecorationRanges 同一判定（闭 LinkMark 后随 `(` 开标记）
// - 双链与宽松链接：行扫描形态学直接复用 shared/wikilink 与 shared/looseLink
//   （live 装饰与阅读渲染的同一单一事实源），代码上下文排除集合与 liveLinks
//   的 INLINE_SCAN_CODE_CONTEXTS 同源（该集合在 webview 模块私有，此处复制
//   并以集成对拍钉住不漂移）
// - 目标分类：复用 src/host/linkTarget 的 classifyLinkTarget /
//   classifyImageTarget（跳转链路同一分类器——外链白名单、锚点拆分、容错
//   percent-decode、扩展名候选全部一致），路径规划复用 #196 的
//   planVaultLinkPath（docDir 基准、根内边界）
//
// 与呈现侧的已钉住差异（test/unit/vaultLinkExtract.test.ts）：
// - 引用式使用形态 `[文字][ref]` 不单独产边（呈现侧 live 亦不装饰引用式；
//   其目标由 refdef 定义边代表，边类型无第五种）
// - 宽松链接（目标含空格，#152）按呈现侧同款形态学抽取，边类型归
//   mdlink/image（呈现侧有装饰且可跳转，索引不缺席）
// - 危险 scheme（javascript: 等）与越界目标保留为边（resolvedTarget=null）
//   ——「保留断链及未命中引用」的可见性口径
//
// 本模块不依赖 vscode / DOM（node 单测直驱）；存在性经 resolver 端口注入
// （宿主索引传「文件集合 + 平台大小写」实现，返回根内相对真实路径）。
import type { SyntaxNode, Tree } from '@lezer/common'
import { classifyImageTarget, classifyLinkTarget, type LinkContext } from './linkTarget'
import { parseWikilinkInner, scanWikilinksInLine } from '../shared/wikilink'
import { scanLooseLinksInLine } from '../shared/looseLink'
import { planVaultLinkPath, type VaultLinkPathContext } from '../shared/vaultLink'
import { sortEdges, type VaultEdge, type VaultEdgeKind } from '../shared/vaultIndexModel'
import { chainAt, frontmatterRange, markdownTreeParser } from '../webview/markdownDoc'

/** 行扫描类抽取（双链 / 宽松链接）排除的代码上下文（lezer 节点名）——
 *  与 liveLinks 的 INLINE_SCAN_CODE_CONTEXTS 同源复制（该模块带 DOM 依赖
 *  不可被宿主侧引用；集合漂移由抽取测试的代码上下文用例钉住） */
const INLINE_SCAN_CODE_CONTEXTS = new Set([
  'FencedCode',
  'CodeBlock',
  'CodeText',
  'CodeMark',
  'CodeInfo',
  'InlineCode',
])

/** 存在性解析端口：绝对 fsPath → 根内相对规范路径（`/` 分隔、磁盘真实
 *  大小写形态）或 null（不存在）。大小写语义由实现方按宿主平台决定
 *  （Windows 折叠 / POSIX 严格），与 #196 的 statFileRealPath 端口同型。 */
export type VaultEdgeResolvePort = (absoluteFsPath: string) => string | null

/** 名为 name 的直接子节点 */
function childNamed(node: SyntaxNode, name: string): SyntaxNode | null {
  for (let c = node.firstChild; c; c = c.nextSibling) {
    if (c.name === name) {
      return c
    }
  }
  return null
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

/** 内联形态（`[t](url)` / `![a](src)`）：与 liveLinks.isInlineForm 同一判定
 *  ——闭 LinkMark 后随 `(` 开标记。引用式形态（`[t][ref]`）返回 false。 */
function isInlineForm(node: SyntaxNode, text: string): boolean {
  const marks = linkMarks(node)
  const closer = marks[1]
  if (!closer) {
    return false
  }
  const next = closer.nextSibling
  if (!next || next.name !== 'LinkMark') {
    return false
  }
  return text.slice(next.from, next.to).startsWith('(')
}

/** URL 子节点的目标文本（剥 <> 包裹形态，与 liveLinks.linkHrefOf 同口径） */
function urlTextOf(node: SyntaxNode, text: string): string | null {
  const url = childNamed(node, 'URL')
  if (!url) {
    return null
  }
  let href = text.slice(url.from, url.to)
  if (href.startsWith('<') && href.endsWith('>') && href.length >= 2) {
    href = href.slice(1, -1)
  }
  return href || null
}

/** occurrence 起点是否处于代码上下文或 frontmatter 内（源码降级边界，
 *  与 liveLinks.inlineScanSuppressed 同源） */
function scanSuppressed(tree: Tree, from: number, fmEnd: number | null): boolean {
  if (fmEnd !== null && from < fmEnd) {
    return true
  }
  for (const node of chainAt(tree, from)) {
    if (INLINE_SCAN_CODE_CONTEXTS.has(node.name)) {
      return true
    }
  }
  return false
}

/**
 * 从 Markdown 全文抽取全部出链边（LF 全文坐标）。
 *
 * @param sourceRelPath 来源文档的根内相对路径（边的 source 字段；
 *   本文件锚点边的 resolvedTarget 亦为该值）
 * @param text LF 全文（宿主侧读盘后统一 LF——抽取器不做 CRLF 换算，
 *   区间语义与边表契约一致）
 * @param ctx 路径解析上下文（docDir / rootDir / 平台语义）
 * @param resolve 存在性端口（见 VaultEdgeResolvePort）
 * @returns 按 source → 区间稳定排序的边表（sortEdges 序）
 */
export function extractVaultEdges(
  sourceRelPath: string,
  text: string,
  ctx: VaultLinkPathContext,
  resolve: VaultEdgeResolvePort,
): VaultEdge[] {
  const linkCtx: LinkContext = ctx
  const edges: VaultEdge[] = []
  const fm = frontmatterRange(text)
  const fmEnd = fm ? fm.end : null
  const tree = markdownTreeParser.parse(text)

  /** 解析文档类目标（classifyLinkTarget 的 doc 分支）：候选按优先序探测，
   *  命中取根内相对真实路径；未命中 null（断链保留） */
  const resolveDocTarget = (candidates: readonly string[]): string | null => {
    for (const candidate of candidates) {
      const hit = resolve(candidate)
      if (hit !== null) {
        return hit
      }
    }
    return null
  }

  /** mdlink / refdef 目标分类 → 边（anchor 取 fragment；本文件锚点自引用） */
  const pushLinkEdge = (kind: VaultEdgeKind, href: string, start: number, end: number): void => {
    const target = classifyLinkTarget(href, linkCtx)
    if (target.kind === 'doc') {
      edges.push({
        source: sourceRelPath,
        target: href,
        resolvedTarget: resolveDocTarget(target.candidates),
        kind,
        anchor: target.fragment ?? '',
        start,
        end,
      })
      return
    }
    if (target.kind === 'anchor') {
      edges.push({
        source: sourceRelPath,
        target: href,
        resolvedTarget: sourceRelPath,
        kind,
        anchor: target.fragment,
        start,
        end,
      })
      return
    }
    // external / blocked（危险 scheme、越界、空白）：保留边（resolved=null，
    // 「保留断链及未命中引用」的外链可见性口径）
    edges.push({
      source: sourceRelPath,
      target: href,
      resolvedTarget: null,
      kind,
      anchor: '',
      start,
      end,
    })
  }

  // ---- 树驱动：链接 / 图片 / 引用式定义 / 自动链接（与 liveLinks 同一节点判定） ----
  // frontmatter 排除（lezer 把头区按普通内容建树，fm 内的 Link 节点须跳过
  // ——live 装饰的源码降级边界同款）；代码上下文内 lezer 天然不产链接节点
  // （与 liveLinks 树驱动路径同一前提）。
  const visit = (node: SyntaxNode): void => {
    switch (node.name) {
      case 'Link': {
        // 引用式使用形态（无 URL 子节点或非内联形态）不产边（差异见模块头）
        if (isInlineForm(node, text) && !(fmEnd !== null && node.from < fmEnd)) {
          const href = urlTextOf(node, text)
          if (href !== null) {
            pushLinkEdge('mdlink', href, node.from, node.to)
          }
        }
        break
      }
      case 'Autolink': {
        if (!(fmEnd !== null && node.from < fmEnd)) {
          const href = urlTextOf(node, text)
          if (href !== null) {
            pushLinkEdge('mdlink', href, node.from, node.to)
          }
        }
        break
      }
      case 'Image': {
        if (isInlineForm(node, text) && !(fmEnd !== null && node.from < fmEnd)) {
          const src = urlTextOf(node, text)
          if (src !== null) {
            const target = classifyImageTarget(src, linkCtx)
            edges.push({
              source: sourceRelPath,
              target: src,
              resolvedTarget: target.kind === 'workspace' ? resolve(target.fsPath) : null,
              kind: 'image',
              anchor: '',
              start: node.from,
              end: node.to,
            })
          }
        }
        break
      }
      case 'LinkReference': {
        // 引用式链接定义：目标解析与 mdlink 同口径
        if (!(fmEnd !== null && node.from < fmEnd)) {
          const href = urlTextOf(node, text)
          if (href !== null) {
            pushLinkEdge('refdef', href, node.from, node.to)
          }
        }
        break
      }
      default:
        break
    }
    for (let c = node.firstChild; c; c = c.nextSibling) {
      visit(c)
    }
  }
  visit(tree.topNode)

  // ---- 行扫描：双链与宽松链接（与 liveLinks 同一形态学 + 同一降级边界） ----
  const scanLine = (line: string, base: number): void => {
    for (const hit of scanWikilinksInLine(line, base)) {
      if (scanSuppressed(tree, hit.from, fmEnd)) {
        continue
      }
      const parsed = parseWikilinkInner(hit.inner)
      if (!parsed) {
        continue // 防御：扫描层已过滤非法形态
      }
      let resolved: string | null
      if (parsed.path === '') {
        resolved = sourceRelPath // 本文件锚点：自引用
      } else {
        const plan = planVaultLinkPath(parsed.path, ctx, { implicitMd: true })
        resolved = plan.kind === 'inside' ? resolveDocTarget(plan.candidates) : null
      }
      edges.push({
        source: sourceRelPath,
        // 目标形态取锚点拆分后的路径部分（anchor 单列；与 mdlink 的
        // target 含锚原文不同——wikilink 形态学恒可拆，见 VaultEdge 语义）
        target: parsed.path,
        resolvedTarget: resolved,
        kind: 'wikilink',
        anchor: parsed.heading ?? (parsed.blockId !== null ? `^${parsed.blockId}` : ''),
        start: hit.from,
        end: hit.to,
      })
    }
    for (const hit of scanLooseLinksInLine(line, base)) {
      if (scanSuppressed(tree, hit.from, fmEnd)) {
        continue
      }
      if (hit.image) {
        const target = classifyImageTarget(hit.dest, linkCtx)
        edges.push({
          source: sourceRelPath,
          target: hit.dest,
          resolvedTarget: target.kind === 'workspace' ? resolve(target.fsPath) : null,
          kind: 'image',
          anchor: '',
          start: hit.from,
          end: hit.to,
        })
      } else {
        pushLinkEdge('mdlink', hit.dest, hit.from, hit.to)
      }
    }
  }
  let lineStart = 0
  for (const line of text.split('\n')) {
    scanLine(line, lineStart)
    lineStart += line.length + 1
  }

  return sortEdges(edges)
}
