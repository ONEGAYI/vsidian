// 出链抽取纯逻辑（工单 #197，父规格 #194「路径与范围」）：从 Markdown 全文
// 抽取双链 / 普通内联链接 / 图片 / 引用式链接定义为边（VaultEdge 形态），
// 排除代码字面量（围栏 / 缩进 / 行内代码）与 frontmatter。
//
// 与呈现侧同源（规格硬约束「语法抽取应与当前呈现复用规则，差异必须有测试
// 及明确说明」）：
// - 树驱动链接 / 图片 / 引用式定义：markdownTreeParser（与 liveDecorations /
//   大纲同一解析器，src/shared/markdownDoc），内联形态判定与 liveLinks 的
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
// （宿主索引传「文件集合 + 平台大小写」实现，返回规范绝对身份）。
//
// #556（T2）身份与解析升级：resolvedTarget 从根内相对路径升级为**规范
// 绝对身份**（磁盘真实形态、`/` 分隔）——跨根/工作区外目标以绝对身份
// 表达，不再恒 null；显式绝对路径目标（盘符/POSIX 根形态）经规划器
// absolute 分支解析并登记（登记/失效语义在索引服务侧）；相对候选全未
// 命中的纯文件名 Markdown 目标经注入的短名补查端口解析（唯一命中取
// 端口给定的磁盘真实形态；ambiguous/pending **不归任一候选**——边保持
// resolvedTarget=null，与断链共用现有 null 语义，消费入口的分态提示由
// T3 经同一解析器实时判定）。补查域形态学与结果映射复用 vaultLink 的
// shortnameLookupKeyOf / shortnameLookupResolution——不在本模块复制第二
// 套规则（R1 单一解析语义）。
import * as path from 'node:path'
import type { SyntaxNode, Tree } from '@lezer/common'
import { classifyImageTarget, classifyLinkTarget, linkPathTextOf, type LinkContext } from './linkTarget'
import { parseWikilinkInner, scanEmbedsInLine, scanWikilinksInLine } from '../shared/wikilink'
import { scanEmbedsInTableRow, scanWikilinksInTableRow } from '../shared/tableCellEmbed'
import { scanLooseLinksInLine } from '../shared/looseLink'
import {
  planVaultLinkPath,
  shortnameLookupKeyOf,
  shortnameLookupResolution,
  type VaultLinkPathContext,
  type VaultLinkShortnameLookupResult,
} from '../shared/vaultLink'
import { sortEdges, type VaultEdge, type VaultEdgeKind } from '../shared/vaultIndexModel'
import { chainAt, frontmatterRange, markdownTreeParser } from '../shared/markdownDoc'

/**
 * 出链面板的边准入判别（出链面板批次）：外部 scheme（https:// 等）与危险
 * scheme（javascript: 等）边不进面板——分类复用跳转链路同一分类器
 * （classifyLinkTarget / classifyImageTarget），与「外链白名单」的既有
 * 口径一致。双链与嵌入边为 vault 内形态，恒准入（#222 嵌入边同款——断链
 * 嵌入保留可见性，目标原文非 URL）。
 */
export function isVaultPanelOutlink(edge: VaultEdge, ctx: LinkContext): boolean {
  if (edge.kind === 'wikilink' || edge.kind === 'embed') {
    return true
  }
  if (edge.kind === 'image') {
    const target = classifyImageTarget(edge.target, ctx)
    return target.kind === 'workspace' || target.kind === 'absolute'
  }
  const target = classifyLinkTarget(edge.target, ctx)
  return target.kind === 'doc' || target.kind === 'anchor' || target.kind === 'absolute'
}

/** occurrence 起点是否处于代码/注释上下文或 frontmatter 内（源码降级
 *  边界）：代码集合同 liveLinks.inlineScanSuppressed 同源复制（该模块带
 *  DOM 依赖不可被宿主侧引用；漂移由抽取测试钉住）。#246 起注释（lezer
 *  的 Comment/CommentBlock）一并排除——阅读呈现对注释整段剥离（#139），
 *  行扫描若在注释内产边即与「呈现不可见」分叉（反链出现不可见引用、
 *  rename 触达用户看不见的位置）；live 行扫描对注释内文本的源码装饰
 *  不受影响（live 呈现源文，注释文字可见） */
const INLINE_SCAN_CODE_CONTEXTS = new Set([
  'FencedCode',
  'CodeBlock',
  'CodeText',
  'CodeMark',
  'CodeInfo',
  'InlineCode',
  'Comment',
  'CommentBlock',
])

/** 存在性解析端口：绝对 fsPath → 目标**规范绝对身份**（磁盘真实形态、
 *  `/` 分隔）或 null（不存在）。大小写语义由实现方按宿主平台决定
 *  （Windows 折叠 / POSIX 严格），与 #196 的 statFileRealPath 端口同型。
 *  #556 T2 起返回值从根内相对路径升级为绝对身份——跨根/工作区外目标
 *  的命中结果即其绝对形态，不再因越根恒 null。 */
export type VaultEdgeResolvePort = (absoluteFsPath: string) => string | null

/** 短名补查端口（#556 T2 索引抽取侧注入）：与 vaultLink 的
 *  VaultLinkShortnamePort 同结果形态（candidates 为磁盘真实绝对形态、
 *  complete 为清单完整性），但为同步函数——索引抽取（extractVaultEdges）
 *  是同步纯逻辑，端口由宿主索引服务以内存清单查询实现（R6 容量红线：
 *  禁止点击/抽取时全库 fs 扫描）。 */
export type VaultEdgeShortnamePort = (basename: string) => VaultLinkShortnameLookupResult

/** 抽取选项（#556 T2）：短名补查与绝对目标解析端口注入 */
export interface VaultEdgeExtractOptions {
  /** 短名补查端口（不注入时纯文件名目标不做补查——与解析器端口缺省
   *  语义一致）；索引服务传清单查询（catalog 内存倒排） */
  lookupShortname?: VaultEdgeShortnamePort
  /** 显式绝对路径目标的解析端口：与主端口（相对候选域）分立——绝对形态
   *  允许跨根与工作区外（查外部登记表），相对候选落在嵌套根/他根维持
   *  不解析的既有边界。缺省回落主端口（形态上无法区分时按相对域处理，
   *  外部目标恒 miss——单测直驱的简化形态） */
  resolveAbsolute?: VaultEdgeResolvePort
}

/** 表格内容行节点名（#248：嵌入行扫描的格内解码分类） */
const TABLE_ROW_NODE_NAMES = new Set(['TableRow', 'TableHeader'])

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

/** 单行的嵌入命中（#248：表格内容行走格内解码扫描——inner 解码语义、
 *  区间源文；其余行走原始行扫描）。 */
function embedHitsOfLine(line: string, base: number, tree: Tree): ReturnType<typeof scanEmbedsInLine> {
  if (!line.includes('![[')) {
    return []
  }
  const isTableRow = chainAt(tree, base).some((node) => TABLE_ROW_NODE_NAMES.has(node.name))
  return isTableRow ? scanEmbedsInTableRow(line, base) : scanEmbedsInLine(line, base)
}

/** 单行的双链命中（#607：embedHitsOfLine 的同构镜像）——表格内容行
 *  （TableRow/TableHeader）走格内解码扫描（`\|` 按表格转义解码、`\` 不进
 *  目标路径，inner/target 为解码语义，区间为原始源文）；其余行走原始行
 *  扫描（非表格行 `\|` 形态仍按原文字面——既有语义不扩散）。 */
function wikilinkHitsOfLine(line: string, base: number, tree: Tree): ReturnType<typeof scanWikilinksInLine> {
  if (!line.includes('[[')) {
    return []
  }
  const isTableRow = chainAt(tree, base).some((node) => TABLE_ROW_NODE_NAMES.has(node.name))
  return isTableRow ? scanWikilinksInTableRow(line, base) : scanWikilinksInLine(line, base)
}

/**
 * 从 Markdown 全文抽取全部出链边（LF 全文坐标）。
 *
 * @param sourceRelPath 来源文档的根内相对路径（边的 source 字段；
 *   本文件锚点边的身份亦由该值 + ctx.docDir 推导为绝对形态）
 * @param text LF 全文（宿主侧读盘后统一 LF——抽取器不做 CRLF 换算，
 *   区间语义与边表契约一致）
 * @param ctx 路径解析上下文（docDir / rootDir / 平台语义）
 * @param resolve 存在性端口（见 VaultEdgeResolvePort——返回规范绝对身份）
 * @param options 抽取选项（短名补查端口注入，#556 T2）
 * @returns 按 source → 区间稳定排序的边表（sortEdges 序）
 */
export function extractVaultEdges(
  sourceRelPath: string,
  text: string,
  ctx: VaultLinkPathContext,
  resolve: VaultEdgeResolvePort,
  options: VaultEdgeExtractOptions = {},
): VaultEdge[] {
  const linkCtx: LinkContext = ctx
  const edges: VaultEdge[] = []
  const fm = frontmatterRange(text)
  const fmEnd = fm ? fm.end : null
  const tree = markdownTreeParser.parse(text)
  const ops = ctx.isWindowsHost ? path.win32 : path.posix
  // 来源自身的规范绝对身份（本文件锚点边的 resolvedTarget；#556 T2 起边域
  // 为绝对身份）——docDir 与 sourceRelPath 同源（服务侧 dirname/relOf 对同
  // 一 fsPath 派生），basename 拼接即来源绝对路径
  const sourceIdentity = ops.resolve(ctx.docDir, ops.basename(sourceRelPath)).replace(/\\/g, '/')

  /** 解析候选目标：候选按优先序探测，命中取端口归正的绝对身份；未命中
   *  null（断链保留——补查在调用方接力）。port 由分支注入：相对候选走
   *  主端口（嵌套根/越根不解析的既有边界），绝对形态走 resolveAbsolute
   *  （跨根/工作区外允许） */
  const resolveDocTarget = (candidates: readonly string[], port: VaultEdgeResolvePort): string | null => {
    for (const candidate of candidates) {
      const hit = port(candidate)
      if (hit !== null) {
        return hit
      }
    }
    return null
  }
  const resolveAbsolutePort = options.resolveAbsolute ?? resolve

  /** 纯文件名 Markdown 目标的短名补查（#556）：相对候选全未命中后接力；
   *  唯一且清单完整 → 端口给定的绝对身份；ambiguous/pending/not-found →
   *  null（不归任一候选，与断链共用 null——分态提示由消费入口实时判定） */
  const resolveShortnameTarget = (rawPath: string, implicitMd: boolean): string | null => {
    const key = shortnameLookupKeyOf(rawPath, ctx, { implicitMd })
    if (key === null || options.lookupShortname === undefined) {
      return null
    }
    const resolution = shortnameLookupResolution(options.lookupShortname(key))
    return resolution.kind === 'target' ? resolution.fsPath : null
  }

  /** mdlink / refdef 目标分类 → 边（anchor 取 fragment；本文件锚点自引用） */
  const pushLinkEdge = (kind: VaultEdgeKind, href: string, start: number, end: number): void => {
    const target = classifyLinkTarget(href, linkCtx)
    if (target.kind === 'doc') {
      let resolved = resolveDocTarget(target.candidates, resolve)
      if (resolved === null) {
        // 短名补查的路径文本与跳转链路同形态（#534 起剥尾部行号后
        // 剥 fragment/query 容错解码——note.md:103 的补查域是 note.md）
        resolved = resolveShortnameTarget(linkPathTextOf(href), true)
      }
      edges.push({
        source: sourceRelPath,
        target: href,
        resolvedTarget: resolved,
        kind,
        anchor: target.fragment ?? '',
        start,
        end,
      })
      return
    }
    if (target.kind === 'absolute') {
      // 显式绝对路径目标（#556）：候选探测（跨根/工作区外的登记由服务侧
      // 经 missed 收集完成）；anchor 与 doc 分支同口径
      edges.push({
        source: sourceRelPath,
        target: href,
        resolvedTarget: resolveDocTarget(target.candidates, resolveAbsolutePort),
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
        resolvedTarget: sourceIdentity,
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
              // workspace 与 absolute（#556 显式绝对图源）都探测；图片单候选
              resolvedTarget:
                target.kind === 'workspace'
                  ? resolve(target.fsPath)
                  : target.kind === 'absolute'
                    ? resolveAbsolutePort(target.fsPath)
                    : null,
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

  // ---- 行扫描：双链与宽松链接（非表格行与 liveLinks 同一形态学 + 同一
  // 降级边界；表格内容行的双链 #607 起走格内解码——见 wikilinkHitsOfLine） ----
  const scanLine = (line: string, base: number): void => {
    // #607：表格内容行的双链走格内解码扫描（`\|` 解码语义）——与嵌入
    // （embedHitsOfLine）同一表格判定入口；其余行原文字面（既有语义）
    for (const hit of wikilinkHitsOfLine(line, base, tree)) {
      if (scanSuppressed(tree, hit.from, fmEnd)) {
        continue
      }
      const parsed = parseWikilinkInner(hit.inner)
      if (!parsed) {
        continue // 防御：扫描层已过滤非法形态
      }
      let resolved: string | null
      if (parsed.path === '') {
        resolved = sourceIdentity // 本文件锚点：自引用
      } else {
        const plan = planVaultLinkPath(parsed.path, ctx, { implicitMd: true })
        if (plan.kind === 'inside') {
          resolved = resolveDocTarget(plan.candidates, resolve)
          if (resolved === null) {
            resolved = resolveShortnameTarget(parsed.path, true)
          }
        } else if (plan.kind === 'absolute') {
          // 显式绝对路径（#556）：跨根/工作区外目标探测（missed 收集在服务侧）
          resolved = resolveDocTarget(plan.candidates, resolveAbsolutePort)
        } else {
          resolved = null
        }
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
    for (const hit of embedHitsOfLine(line, base, tree)) {
      // #222 嵌入（独立语法角色，行扫描形态学）：索引不设行独占限制——
      // 引用关系按出现抽取（行独占只属呈现侧挂载适配）；代码上下文排除
      // 与双链同一 scanSuppressed 边界；resolve 与锚点拆列同 wikilink 口径
      //（implicitMd 候选：显式图片等扩展名直接解析该文件）。#248 起表格
      // 内容行（TableRow/TableHeader）走格内解码扫描——inner/target 为解码
      // 语义（`B|别名` 的目标路径不含 `\`），区间为原始源文（含 `\|`）；
      // 非表格行 `\|` 形态仍按原文字面（既有语义不扩散）
      if (scanSuppressed(tree, hit.from, fmEnd)) {
        continue
      }
      const parsed = parseWikilinkInner(hit.inner)
      if (!parsed) {
        continue // 防御：扫描层已过滤非法形态
      }
      let resolved: string | null
      if (parsed.path === '') {
        resolved = sourceIdentity // 本文件锚点：自引用
      } else {
        const plan = planVaultLinkPath(parsed.path, ctx, { implicitMd: true })
        if (plan.kind === 'inside') {
          resolved = resolveDocTarget(plan.candidates, resolve)
          if (resolved === null) {
            resolved = resolveShortnameTarget(parsed.path, true)
          }
        } else if (plan.kind === 'absolute') {
          // 显式绝对路径（#556）：嵌入的绝对目标与双链同口径
          resolved = resolveDocTarget(plan.candidates, resolveAbsolutePort)
        } else {
          resolved = null
        }
      }
      edges.push({
        source: sourceRelPath,
        target: parsed.path,
        resolvedTarget: resolved,
        kind: 'embed',
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
          // workspace 与 absolute（#556 显式绝对图源）分端口探测
          resolvedTarget:
            target.kind === 'workspace'
              ? resolve(target.fsPath)
              : target.kind === 'absolute'
                ? resolveAbsolutePort(target.fsPath)
                : null,
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

/**
 * 断链边重解析（#269 目标归位重抽依赖者的检测步；#556 T2 起返回绝对
 * 身份并支持补查）：对单条 resolvedTarget 为 null 的边按其边型同口径
 * 重建候选并探测存在性端口，返回重解析目标（仍不可解为 null）。边型
 * 口径与 extractVaultEdges 内部逐型一致——wikilink/embed 走
 * planVaultLinkPath 候选序（implicitMd）与纯文件名补查，mdlink/refdef
 * 走 classifyLinkTarget 的 doc 分支候选与补查（absolute 分支探测绝对
 * 候选），image 走 classifyImageTarget 的 workspace/absolute 单候选
 * （非 Markdown 不补查）；external/blocked（外链与危险 scheme）不可
 * 接通恒 null，本文件锚点边（target 空串）为自引用、resolved 恒非
 * null——二者传入属调用方防御，返回 null 不参与依赖者判定。
 */
export function reresolveVaultEdgeTarget(
  edge: Pick<VaultEdge, 'target' | 'kind'>,
  ctx: VaultLinkPathContext,
  resolve: VaultEdgeResolvePort,
  options: VaultEdgeExtractOptions = {},
): string | null {
  const probe = (candidates: readonly string[], port: VaultEdgeResolvePort = resolve): string | null => {
    for (const candidate of candidates) {
      const hit = port(candidate)
      if (hit !== null) {
        return hit
      }
    }
    return null
  }
  const resolveAbsolutePort = options.resolveAbsolute ?? resolve
  const probeShortname = (rawPath: string, implicitMd: boolean): string | null => {
    const key = shortnameLookupKeyOf(rawPath, ctx, { implicitMd })
    if (key === null || options.lookupShortname === undefined) {
      return null
    }
    const resolution = shortnameLookupResolution(options.lookupShortname(key))
    return resolution.kind === 'target' ? resolution.fsPath : null
  }
  switch (edge.kind) {
    case 'wikilink':
    case 'embed': {
      if (edge.target === '') {
        return null // 本文件锚点（自引用）边的防御分支
      }
      const plan = planVaultLinkPath(edge.target, ctx, { implicitMd: true })
      if (plan.kind === 'inside') {
        return probe(plan.candidates) ?? probeShortname(edge.target, true)
      }
      if (plan.kind === 'absolute') {
        return probe(plan.candidates, resolveAbsolutePort)
      }
      return null
    }
    case 'mdlink':
    case 'refdef': {
      const target = classifyLinkTarget(edge.target, ctx)
      if (target.kind === 'doc') {
        return probe(target.candidates)
          ?? probeShortname(linkPathTextOf(edge.target), true)
      }
      if (target.kind === 'absolute') {
        return probe(target.candidates, resolveAbsolutePort)
      }
      return null // external / blocked / anchor：非文档目标不可接通
    }
    case 'image': {
      const target = classifyImageTarget(edge.target, ctx)
      return target.kind === 'workspace'
      ? resolve(target.fsPath)
      : target.kind === 'absolute'
        ? (options.resolveAbsolute ?? resolve)(target.fsPath)
        : null
    }
  }
}

/**
 * 短名依赖反查键（#556 T2 文件集合变化重判的数据面）：边目标在补查域
 * （纯文件名 Markdown 语义——重判面与补查面同域）时返回查询键（完整
 * basename 含扩展名），否则 null。服务侧按 fold(键) 建 basename → 来源
 * 反查表，文件集合变化后仅重抽引用了受影响 basename 的来源。mdlink/
 * refdef 的目标剥 fragment/query 后容错解码（与解析同形态）；image 为
 * 非 Markdown 语义（implicitMd=false / 非 .md 扩展）恒不在域内。
 */
export function shortnameDepKeyOf(
  edge: Pick<VaultEdge, 'target' | 'kind'>,
  ctx: VaultLinkPathContext,
): string | null {
  switch (edge.kind) {
    case 'wikilink':
    case 'embed':
      return shortnameLookupKeyOf(edge.target, ctx, { implicitMd: true })
    case 'mdlink':
    case 'refdef':
      return shortnameLookupKeyOf(linkPathTextOf(edge.target), ctx, { implicitMd: true })
    case 'image':
      return shortnameLookupKeyOf(edge.target, ctx, { implicitMd: false })
  }
}
