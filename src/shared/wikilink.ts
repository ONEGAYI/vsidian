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
// - 嵌入 ![[…]]、残缺嵌套（前置 [ 或内部含 [ ]）：扫描层不命中
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
