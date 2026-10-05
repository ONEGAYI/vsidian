// 双链（wikilink）形态学单一事实源（工单 #11）：`[[…]]` 内部结构解析与
// 单行出现扫描。live 装饰、阅读渲染（markdown-it 规则）与宿主目标解析
// 共用本模块——三处对「什么算合法双链」的判定必须逐字节一致，否则同一
// 文本在两种视图/两端呈现不同语义。
//
// 支持形态（ADR-0002 / mvp.md / #159 锚点跳转）：
// - [[笔记]]、[[目录/笔记]]（含中文与空格）、[[笔记|显示文字]]、
//   [[笔记#标题]]、组合 [[目录/笔记#标题|显示]]
// - 块引用 [[笔记#^块ID]] 及其别名组合（Obsidian `#^` 标准形态；块 ID 仅
//   拉丁字母/数字/连字符——Obsidian 官方约束。#159 起块级定位跳转已接入，
//   引用更新仍不属本期）
// - 本文件锚点 [[#标题]]、[[#^块ID]]（可带别名；#159）——path 为空串，
//   display 默认锚点原文（别名优先），与 Obsidian 呈现一致
//
// 降级规则（不支持即按原文显示，不改写源文——源码保真）：
// - 路径裸含 ^（Obsidian 文件名非法字符）、标题文本含 ^（非 #^ 开头）、
//   空/越集块 ID、多级标题 [[a#b#c]]、空锚点 [[#]]：parse 返回 null
// - 嵌入 ![[…]]、残缺嵌套（前置 [ 或内部含 [ ]）：双链扫描层不命中
//   （#222 起嵌入由独立扫描器 scanEmbedsInLine 识别——语法角色分离，
//   守卫不动；嵌入内部解析复用本模块 parseWikilinkInner）
// - 扩展名省略按 Markdown 处理（宿主补 .md 候选，本模块不管文件系统）
//
// 规范化契约（写入测试固定）：
// - path/heading/blockId/alias 各自 trim（内部空格保留——文件名可含空格）
// - 首个 | 恒为别名分割（其后内容含 | 全归别名）
// - 首个 # 恒为标题分割（标题内不得再含 #；块引用形态为 `#^` 开头）
// - 显示文字 = 别名 ??（路径 + (#标题 或 #^块ID)；路径为空时即锚点原文）
//
// 本模块不依赖 vscode/DOM/CM6（node 单测直驱；宿主与 webview 双产物共用）。

/** #11 双链稳定类名（live widget/mark 与阅读 a 共用；Obsidian 对应
 *  `.cm-hmd-internal-link` / `.internal-link`，见选择器映射表） */
export const WIKILINK_CLASS_NAMES = {
  /** 双链呈现（live 非活动行替换 widget、活动行 mark、阅读 a） */
  wikilink: 'vsidian-wikilink',
} as const

/** 解析后的双链结构（trim 后形态；源文原样语义见 inner） */
export interface ParsedWikilink {
  /** 目标路径部分（不含扩展名推断）。本文件锚点（#159）为空串——
   *  宿主以当前文档为目标，不查文件、无 ambiguous */
  path: string
  /** 标题目标（无 # 为 null；块引用形态下恒为 null——目标是块不是标题） */
  heading: string | null
  /** 块引用 ID（`#^块ID` 形态；无 ^ 为 null）。#159 起宿主按块 id 定位
   *  目标块首行；引用更新（重命名同步）仍不属本期 */
  blockId: string | null
  /** 显示别名（无 | 为 null） */
  alias: string | null
  /** 非活动行显示文字 */
  display: string
}

/** 块 ID 字符集：拉丁字母/数字/连字符（Obsidian 官方约束——块标识符
 *  只能由拉丁字母、数字和连字符组成） */
const BLOCK_ID_RE = /^[A-Za-z0-9-]+$/

/**
 * 解析 `[[` 与 `]]` 之间的内部文本。非法形态（路径裸含 ^、空锚点、空标题/
 * 空别名、多级标题、空或越集块 ID 等）返回 null——调用方按原文降级，不产
 * 生装饰/渲染/跳转。本文件锚点（#159）：`#标题`、`#^块ID`（可带 `|别名`）
 * 合法，path 为空串。
 */
export function parseWikilinkInner(inner: string): ParsedWikilink | null {
  if (inner.length === 0) {
    return null
  }
  // 首个 | 恒为别名分割（其后内容全归别名，含 |）
  const pipeAt = inner.indexOf('|')
  const targetPart = pipeAt >= 0 ? inner.slice(0, pipeAt) : inner
  const aliasPart = pipeAt >= 0 ? inner.slice(pipeAt + 1) : null
  const alias = aliasPart === null ? null : aliasPart.trim()
  if (aliasPart !== null && alias === '') {
    return null // [[笔记|]]：空别名按不支持形态降级
  }
  // 首个 # 恒为标题分割；标题内不得再含 #（多级标题属二期）
  const hashAt = targetPart.indexOf('#')
  const pathPart = hashAt >= 0 ? targetPart.slice(0, hashAt) : targetPart
  const headingPart = hashAt >= 0 ? targetPart.slice(hashAt + 1) : null
  if (pathPart.includes('^') || (headingPart !== null && headingPart.includes('#'))) {
    return null
  }
  // `#^` 开头为块引用（Obsidian 块链接标准形态）；标题文本含 ^（非 #^
  // 开头）降级——标题与块组合（`#标题^块`）在 Obsidian 中同样不是链接
  let blockId: string | null = null
  let headingRaw: string | null = null
  if (headingPart !== null) {
    if (headingPart.startsWith('^')) {
      const id = headingPart.slice(1).trim()
      if (!BLOCK_ID_RE.test(id)) {
        return null
      }
      blockId = id
    } else if (!headingPart.includes('^')) {
      headingRaw = headingPart
    } else {
      return null
    }
  }
  const path = pathPart.trim()
  const heading = headingRaw === null ? null : headingRaw.trim()
  if (headingRaw !== null && heading === '') {
    return null // [[笔记#]] 与 [[#]]（空锚点）
  }
  if (path === '' && heading === null && blockId === null) {
    return null // 纯空白 / 无锚点的空路径（[[ ]]）
  }
  // 本文件锚点：path 空串合法（display 默认锚点原文，与 Obsidian 一致）
  const anchorDisplay =
    heading !== null ? `#${heading}` : blockId !== null ? `#^${blockId}` : ''
  return {
    path,
    heading,
    blockId,
    alias,
    display: alias !== null ? alias : path !== '' ? `${path}${anchorDisplay}` : anchorDisplay || path,
  }
}

/** 一次双链出现（全文 offset 语义；from 含 `[[`，to 含 `]]`） */
export interface WikilinkOccurrence {
  from: number
  to: number
  /** `[[` 与 `]]` 之间的原文（未 trim——宿主解析自带规范化） */
  inner: string
}

/**
 * 扫描单行文本中的全部合法双链出现（base 为该行首的全文 offset，缺省 0）。
 * 守卫：前置 `[`（三连括号）与前置 `!`（嵌入 `![[…]]` 属二期）不命中；
 * 内部含 `[`/`]` 的形态不命中。扫描从命中尾部继续（不重叠）。
 */
export function scanWikilinksInLine(line: string, base = 0): WikilinkOccurrence[] {
  const out: WikilinkOccurrence[] = []
  let at = 0
  for (;;) {
    const open = line.indexOf('[[', at)
    if (open < 0) {
      return out
    }
    const prev = open > 0 ? line[open - 1] : ''
    if (prev === '[' || prev === '!') {
      at = open + 1 // 前置换过守卫字符，继续找下一处 [[
      continue
    }
    const close = line.indexOf(']]', open + 2)
    const inner = close >= 0 ? line.slice(open + 2, close) : null
    if (inner !== null && !/[\[\]\n]/.test(inner) && parseWikilinkInner(inner) !== null) {
      out.push({ from: base + open, to: base + close + 2, inner })
      at = close + 2 // 命中：后续扫描不与自身重叠
      continue
    }
    // 未闭合/内部残缺/形态非法：只推进到本 [[ 之后——其后出现的合法双链
    //（如「[[未闭合 [x] 后 [[合法]]」的第二处）仍必须独立命中
    at = open + 2
  }
}

/** 找包含 col（from <= col < to）的出现；未命中返回 null */
export function wikilinkAtCol(line: string, col: number): WikilinkOccurrence | null {
  for (const hit of scanWikilinksInLine(line)) {
    if (hit.from <= col && col < hit.to) {
      return hit
    }
  }
  return null
}

/** 一次嵌入出现（全文 offset 语义；from 含 `!`，to 含 `]]`） */
export interface EmbedOccurrence {
  from: number
  to: number
  /** `![[` 与 `]]` 之间的原文（未 trim——宿主解析自带规范化） */
  inner: string
}

/**
 * 扫描单行文本中的全部合法嵌入（`![[…]]`）出现（工单 #222；base 为该行
 * 首的全文 offset，缺省 0）。与 scanWikilinksInLine 互为镜像的**独立语法
 * 角色**：双链扫描器的前置 `!` 守卫保持不动，嵌入经本扫描器识别——两者
 * 对同一文本的命中集合互斥（`[[x]]` 不被本函数命中、`![[x]]` 不被双链
 * 扫描命中）。
 *
 * 守卫：`!` 前为 `[`（`[![[x]]](url)` 链接域嵌套）或 `!`（`!![[x]]` 字面
 * 前缀）不命中；内部含 `[`/`]`/换行或形态非法（parseWikilinkInner 同源
 * 降级）不命中。内部目标解析与双链完全同源（复用 parseWikilinkInner：
 * 全文/标题章节/块/别名、本文件锚点 `![[#锚]]`）。扫描从命中尾部继续
 * （不重叠）；未闭合/残缺只推进到本 `![[` 之后，其后的合法嵌入照常命中。
 */
export function scanEmbedsInLine(line: string, base = 0): EmbedOccurrence[] {
  if (!line.includes('![[')) {
    return [] // 快速预检（绝大多数行零嵌入）
  }
  const out: EmbedOccurrence[] = []
  let at = 0
  for (;;) {
    const open = line.indexOf('![[', at)
    if (open < 0) {
      return out
    }
    const prev = open > 0 ? line[open - 1] : ''
    if (prev === '[' || prev === '!') {
      at = open + 1 // 前置换过守卫字符，继续找下一处 ![[（不吞后续合法嵌入）
      continue
    }
    const close = line.indexOf(']]', open + 3)
    const inner = close >= 0 ? line.slice(open + 3, close) : null
    if (inner !== null && !/[\[\]\n]/.test(inner) && parseWikilinkInner(inner) !== null) {
      out.push({ from: base + open, to: base + close + 2, inner })
      at = close + 2 // 命中：后续扫描不与自身重叠
      continue
    }
    // 未闭合/内部残缺/形态非法：推进到本 ![[ 之后（同双链扫描的容错语义）
    at = open + 3
  }
}

/**
 * 判定整行是否恰为**单个独占嵌入**（工单 #222 阅读挂载适配的行独占判定）：
 * trim 后整行从 `![[` 到 `]]`、无其他内容（首尾空白容忍——≤3 空格缩进在
 * Markdown 中仍是段落；行内代码反引号包裹因是行内容的一部分而不独占）。
 * 命中返回该出现；混排/多嵌入/残缺形态返回 null（按源文降级，1.5 期再接）。
 *
 * 行独占限制**只属挂载适配**（Reading 正文流替换该行）：索引抽取
 * （vaultLinkExtract）与目标解析（hoverDocAccess）不设此限。
 */
export function soleEmbedOfLine(line: string): EmbedOccurrence | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('![[')) {
    return null
  }
  const hits = scanEmbedsInLine(trimmed)
  if (hits.length !== 1) {
    return null
  }
  const hit = hits[0]!
  return hit.from === 0 && hit.to === trimmed.length ? hit : null
}

/** 找包含 col（from <= col < to）的嵌入出现；未命中返回 null（#217 验收
 *  反馈：嵌入源码恢复链接跳转语义——点击命中判定与 wikilinkAtCol 镜像；
 *  两扫描器命中集合互斥，判定次序无关） */
export function embedAtCol(line: string, col: number): EmbedOccurrence | null {
  for (const hit of scanEmbedsInLine(line)) {
    if (hit.from <= col && col < hit.to) {
      return hit
    }
  }
  return null
}

/**
 * 位置精确命中（#246 混排嵌入的 inline 渲染入口）：text[start..limit) 从
 * `![[` 起、到 `]]` 止恰好构成一个合法嵌入时返回该出现，否则 null。判定
 * 与 scanEmbedsInLine 逐字节同源（prev `[`/`!` 守卫、inner 禁 `[`/`]`/换
 * 行、parseWikilinkInner 同款降级）——两入口对同一文本的命中集合由
 * wikilinkEmbed 对拍测试钉住，供 markdown-it inline 规则逐位置试探而不
 * 引入第二套形态学。base 缺省 0（返回值 from/to 为 start + base 语义）。
 */
export function embedAtPosition(text: string, start: number, limit: number, base = 0): EmbedOccurrence | null {
  if (start + 3 > limit || start < 0 || start >= text.length) {
    return null
  }
  if (text.charCodeAt(start) !== 0x21 /* ! */ ||
      text.charCodeAt(start + 1) !== 0x5b /* [ */ ||
      text.charCodeAt(start + 2) !== 0x5b /* [ */) {
    return null
  }
  const prev = start > 0 ? text[start - 1] : ''
  if (prev === '[' || prev === '!') {
    return null // 前置守卫与 scanEmbedsInLine 一致（[![[x]] 链接域 / !! 双叹）
  }
  const close = text.indexOf(']]', start + 3)
  if (close < 0 || close + 2 > limit) {
    return null
  }
  const inner = text.slice(start + 3, close)
  if (/[\[\]\n]/.test(inner) || parseWikilinkInner(inner) === null) {
    return null
  }
  return { from: base + start, to: base + close + 2, inner }
}

/**
 * 行内「链接/图片文字域」区间（#247 Live 嵌入发射排除）：保守方括号配对
 * 形态学——`[`（前缀非 `\`）压栈、`]` 弹栈，弹出后**紧邻** `(`（内联目标）
 * 或 `[`（引用式）的配对域记为链接文字域，区间 = 括号内文字（不含两侧
 * 括号字符）。双链/嵌入自身的 `[[`…`]]` 按普通括号计数（压二弹二自平衡，
 * 不产域）；嵌套括号域取外层闭合配对。
 *
 * 与 markdown-it 链接识别同向（Reading 侧 #246 钉住：链接文字域内嵌入
 * 产占位但不升级，Live 侧镜像为不挂卡保持源文）；边缘形态分叉方向是
 * 「误判为链接域 → 保持源文」，属安全降级（宁可少挂卡不误挂）。图片形态
 * `![alt](url)` 的 alt 域同样命中（markdown-it 图片 alt 内不产卡片 DOM，
 * Live 侧同向保持源文）。
 *
 * 本导出**不区分** image/link 域（全部紧邻域都返回——发射排除的保守口径：
 * 误判方向是少挂卡的安全侧）。仅图片 alt 的精确子集（Reading 配对排除用
 * ——误排除方向是整块降级，必须宁窄勿宽）见 imageAltRangesInLine。
 */
export function linkLabelRangesInLine(line: string, base = 0): Array<{ from: number; to: number }> {
  if (!line.includes('[')) {
    return []
  }
  return labelRangeCandidates(line, base).map(({ from, to }) => ({ from, to }))
}

/**
 * 行内链接/图片文字域（含目标闭合判定与图片标志，#371）：与
 * linkLabelRangesInLine 共享同一栈配对核心（形态学单一实现），面向需要
 * 区分「闭合才算链接/图片」（markdown-it 对未闭合形态按字面文本渲染）
 * 与「图片域与链接域」的消费方——Live 表格列宽的可见文字采样是首个
 * 使用者：闭合链接计文字域（目标不可见）、闭合图片按 widget 有界回退。
 */
export function linkLabelDomainRangesInLine(
  line: string,
  base = 0,
): Array<{ from: number; to: number; image: boolean; closed: boolean }> {
  if (!line.includes('[')) {
    return []
  }
  return labelRangeCandidates(line, base).map(({ from, to, image, targetClosed }) => ({
    from,
    to,
    image,
    closed: targetClosed,
  }))
}

/** 一次栈配对扫描的完整域产物（linkLabelRangesInLine 与
 *  imageAltRangesInLine 的共享核心——形态学单一实现，两入口各取所需） */
interface LabelRangeCandidate {
  from: number
  to: number
  /** 开括号 `[` 的前一字符为 `!`（图片 alt 候选）。不做 `\!` 转义排除：
   *  markdown-it 对 `\![alt](url)` 同样按图片解析（`\!` 的 `!` 兼作前缀，
   *  实测 alt 走属性不落 DOM），转义判定反而与渲染分叉 */
  image: boolean
  /** `]` 后紧邻 `[`（引用式）时其内的原始 label（未闭合取到行尾的尽力
   *  提取）；行内式（`(`）为 null */
  refLabel: string | null
  /** 域的链接/图片外围形态在行内闭合：行内式 = 目标 `(...)` 按
   *  inlineTargetClosed 判定；引用式 = label `[...]` 有闭合 `]` */
  targetClosed: boolean
}

/** 行内链接/图片目标 `(...)` 的闭合判定（与 markdown-it 目标语法同向、
 *  宁窄勿宽）：尖括号包裹 `<…>` 后紧邻 `)`；或裸目标（无空白无括号）到
 *  `)`；或裸目标后空白接 title（`"…"` / `'…' / `(…)`）再 `)`。不认定的
 *  形态（裸目标含空白、未闭合、嵌套括号目标等）返回 false——markdown-it
 *  对这些形态不产链接/图片（字面文本、占位照落 DOM），Reading 配对面
 *  不得排除（误排除 = 整块降级回归） */
function inlineTargetClosed(line: string, open: number): boolean {
  if (line[open + 1] === '<') {
    const close = line.indexOf('>', open + 2)
    return close >= open + 2 && line[close + 1] === ')'
  }
  let j = open + 1
  while (j < line.length) {
    const ch = line[j]!
    if (ch === ')') {
      return true
    }
    if (ch === '(' || /\s/.test(ch)) {
      break
    }
    j += 1
  }
  if (j >= line.length || line[j] === '(') {
    return false
  }
  // 裸目标后空白接 title：终结符之后须紧邻 ')'
  let k = j
  while (k < line.length && /\s/.test(line[k]!)) {
    k += 1
  }
  const quote = line[k]
  if (quote === '"' || quote === "'") {
    const end = line.indexOf(quote, k + 1)
    return end > k && line[end + 1] === ')'
  }
  if (quote === '(') {
    let depth = 0
    for (let m = k; m < line.length; m += 1) {
      const ch = line[m]!
      if (ch === '(') {
        depth += 1
      } else if (ch === ')') {
        depth -= 1
        if (depth === 0) {
          return line[m + 1] === ')'
        }
      }
    }
  }
  return false
}

/** 栈配对核心：`[`（前缀非 `\`）压栈、`]` 弹栈，弹出后紧邻 `(` 或 `[` 的
 *  配对域产候选（from/to = 括号内文字区间；嵌套域取外层闭合配对） */
function labelRangeCandidates(line: string, base: number): LabelRangeCandidate[] {
  const stack: Array<{ pos: number; image: boolean }> = []
  const out: LabelRangeCandidate[] = []
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!
    if (ch === '\\') {
      i += 1 // 反斜杠转义下一字符（含 `[`/`]`）——保守跳过
      continue
    }
    if (ch === '[') {
      stack.push({ pos: i, image: i > 0 && line[i - 1] === '!' })
      continue
    }
    if (ch === ']') {
      const open = stack.pop()
      if (open === undefined) {
        continue
      }
      const next = line[i + 1]
      if (next === '(') {
        out.push({
          from: base + open.pos + 1,
          to: base + i,
          image: open.image,
          refLabel: null,
          targetClosed: inlineTargetClosed(line, i + 1),
        })
      } else if (next === '[') {
        const close = line.indexOf(']', i + 2)
        out.push({
          from: base + open.pos + 1,
          to: base + i,
          image: open.image,
          refLabel: line.slice(i + 2, close >= 0 ? close : line.length),
          targetClosed: close >= 0,
        })
      }
    }
  }
  return out
}

/**
 * **仅图片 alt 域**的区间（Reading 嵌入配对排除专用——markdown-it 把图片
 * alt 渲染为属性、占位不落 DOM，occurrence 扫描侧必须同集合对齐，否则
 * 配对失败整块降级牵连同块合法嵌入）。与 linkLabelRangesInLine 共享同一
 * 栈配对核心（形态学单一实现），在此收紧为「宁窄勿宽」：误产域会把
 * markdown-it 认定为字面文本的形态（占位照落 DOM）错排除，反向造成
 * 整块降级回归。产域条件（全部经 markdown-it 实测对齐）：
 * - 开括号 `[` 前是 `!`（图片候选；`\!` 前缀 markdown-it 同按图片解析）
 * - 行内式：目标 `(...)` 闭合（裸目标无空白 / 尖括号 / title 形态）
 * - 引用式：label `[...]` 闭合且 isDefinedRef 判定 ref 已定义（markdown-it
 *   对未定义 ref 不产图片、按字面文本渲染占位照落 DOM——不排除）
 *
 * isDefinedRef 缺省时引用式域一律不产（无 refmap 可查即保守放弃）；回调
 * 仅在行内存在引用式图片域时被调（惰性——调用方可按需延迟 refmap 提取）。
 */
export function imageAltRangesInLine(
  line: string,
  base = 0,
  isDefinedRef?: (label: string) => boolean,
): Array<{ from: number; to: number }> {
  if (!line.includes('![')) {
    return []
  }
  const out: Array<{ from: number; to: number }> = []
  for (const c of labelRangeCandidates(line, base)) {
    if (!c.image || !c.targetClosed) {
      continue
    }
    if (c.refLabel !== null && isDefinedRef?.(c.refLabel) !== true) {
      continue
    }
    out.push({ from: c.from, to: c.to })
  }
  return out
}

/** 引用 label 的 markdown-it 同款归一（normalizeReference 逐字节对齐：
 *  trim + 空白折叠 + lower→upper 的 Unicode 简单折叠）——形态学回调里的
 *  原始 label 与 refmap 键（已归一）比较前必须走同一函数 */
export function normalizeReferenceLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase().toUpperCase()
}
