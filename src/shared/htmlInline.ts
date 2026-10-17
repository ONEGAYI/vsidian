// 行内 HTML 片段边界共享事实源（#568/T03，规格「HTML 范围与源文」「Live
// 的状态与选区」）：
// - **节点名经实测**（探针 out/test/t03-lezer-probe*.mts，#246 先例——
//   不猜节点名）：Live 侧 Lezer markdownLanguage 对行内 HTML 产
//   `HTMLTag` 节点（每标签一个，Paragraph/Heading/TableCell/引用与列表
//   内段落皆产；FencedCode/InlineCode/HTMLBlock 内不产——解析器先行
//   消费或整块吞噬，天然排除代码与块级区域）。
// - 配对范围由**原始 HTML 语法扫描**确定（token 级标签识别是两端解析器
//   自身的规则；不用正则猜测嵌套范围）。两端共用本模块：Lezer 侧
//   `inlineHtmlFragmentsOfTree`（树 HTMLTag 节点作候选起点 + 原始文本
//   定范围——#576 评审 P2-6：树配对会被片段内 Escape 吞标签误判未
//   闭合），markdown-it 侧 `matchInlineHtmlFragmentAt`（行内规则的消费
//   驱动面）——两端一致性由对拍测试钉住（test/unit/htmlInline.test.ts）。
// - **单行成型边界**：片段不跨行（开标签与匹配闭标签须同行）。理由：
//   CM6 行内 replace 装饰不得跨换行（Live 硬约束），跨行配对两端一致
//   降级为源码字面（含属性内换行的标签同理不成型）。
// - **最外层语义**：嵌套片段只取最外层（内层被包含，不独立成片段）——
//   Live 单 widget 覆盖、点击选中完整源码、显形粒度均以最外层为确定性
//   区间；void/自闭合标签单标签即片段。
// - 未闭合开标签/孤立闭标签不成片段：降级为源码字面（保守方向与
//   htmlBlock 一致——显源码优先）。
import type { Text } from '@codemirror/state'
import type { SyntaxNode, Tree } from '@lezer/common'

/** 一个行内 HTML 片段的源文区间（LF 全文 UTF-16 offset，end 不含；
 *  单行内、最外层） */
export interface HtmlInlineFragment {
  from: number
  to: number
}

/** 一个行内 HTML 标签 token（识别产物；配对由栈派生） */
export interface HtmlTagToken {
  from: number
  to: number
  /** 小写标签名（大小写不敏感配对） */
  name: string
  /** open = 成对开标签；close = 闭标签；atomic = void 元素或自闭合 */
  kind: 'open' | 'close' | 'atomic'
}

/** HTML void 元素（无内容元素——HTML 标准清单）：不配对，单标签即片段 */
export const HTML_VOID_TAG_NAMES: ReadonlySet<string> = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
])

/** 标签名（HTML 语法：字母开头，字母数字与连字符） */
const TAG_NAME_RE = /^[A-Za-z][A-Za-z0-9-]*/
/** 属性名（HTML 语法：字母/下划线/冒号开头） */
const ATTR_NAME_RE = /^[A-Za-z_:][A-Za-z0-9_.:-]*/
/** 标签与属性之间的空白（不含换行——单行成型边界） */
const ATTR_WS_RE = /[ \t]*/

/**
 * 识别 src[pos] 起的单个 HTML 标签（CommonMark 原始 HTML 标签语法的
 * 逐字符识别——这是两端解析器自身的 token 级规则，识别标签边界不是
 * 猜测嵌套范围）。limit 为扫描上界（行内驱动面传行尾；跨 limit 的标签
 * 不识别）。非法形态返回 null（留给默认链处理）。
 */
export function matchHtmlTagAt(
  src: string,
  pos: number,
  limit: number,
): { end: number; name: string; kind: 'open' | 'close' | 'atomic' } | null {
  if (pos >= limit || src[pos] !== '<') {
    return null
  }
  let i = pos + 1
  let closing = false
  if (i < limit && src[i] === '/') {
    closing = true
    i += 1
  }
  const nameMatch = TAG_NAME_RE.exec(src.slice(i, limit))
  if (nameMatch === null) {
    return null
  }
  const name = nameMatch[0]!.toLowerCase()
  i += nameMatch[0].length
  if (closing) {
    // 闭标签：`</` tagname 空白* `>`（不带属性）
    i += ATTR_WS_RE.exec(src.slice(i, limit))![0]!.length
    if (i < limit && src[i] === '>') {
      return { end: i + 1, name, kind: 'close' }
    }
    return null
  }
  // 开标签：属性序列 + 可选 `/>`
  for (;;) {
    i += ATTR_WS_RE.exec(src.slice(i, limit))![0]!.length
    if (i >= limit) {
      return null
    }
    const ch = src[i]!
    if (ch === '>') {
      return { end: i + 1, name, kind: HTML_VOID_TAG_NAMES.has(name) ? 'atomic' : 'open' }
    }
    if (ch === '/') {
      if (i + 1 < limit && src[i + 1] === '>') {
        return { end: i + 2, name, kind: 'atomic' }
      }
      return null
    }
    const attrMatch = ATTR_NAME_RE.exec(src.slice(i, limit))
    if (attrMatch === null) {
      return null
    }
    i += attrMatch[0].length
    // 可选 `= value`（unquoted / 'single' / "double"）
    let j = i + ATTR_WS_RE.exec(src.slice(i, limit))![0]!.length
    if (j < limit && src[j] === '=') {
      j += 1
      j += ATTR_WS_RE.exec(src.slice(j, limit))![0]!.length
      if (j >= limit) {
        return null
      }
      const quote = src[j]!
      if (quote === '\'' || quote === '"') {
        const closeQuote = src.indexOf(quote, j + 1)
        if (closeQuote < 0 || closeQuote >= limit) {
          return null
        }
        i = closeQuote + 1
      } else {
        const valueMatch = /^[^ \t\n"'=<>`]+/.exec(src.slice(j, limit))
        if (valueMatch === null) {
          return null
        }
        i = j + valueMatch[0].length
      }
    }
    // 无值属性（boolean form）——继续下一轮
  }
}

/**
 * markdown-it 行内规则的消费驱动面：src[pos] 若为完整行内 HTML 片段的
 * 起点（开标签 + 同行匹配闭标签，或原子标签），返回片段终点；否则
 * null（不成型，留给 html_inline 默认链转义字面）。扫描以首个换行为界
 * （单行成型边界——与 Lezer 侧同行分组一致）。
 */
export function matchInlineHtmlFragmentAt(src: string, pos: number): number | null {
  if (pos >= src.length || src[pos] !== '<') {
    return null
  }
  const nl = src.indexOf('\n', pos)
  const limit = nl < 0 ? src.length : nl
  const open = matchHtmlTagAt(src, pos, limit)
  if (open === null) {
    return null
  }
  if (open.kind === 'atomic') {
    return open.end // 原子标签（void/自闭合）：单标签即片段
  }
  if (open.kind === 'close') {
    return null // 闭标签不是片段起点（孤立闭不成型，字面降级）
  }
  let depth = 1
  let i = open.end
  while (i < limit) {
    if (src[i] === '<') {
      const tag = matchHtmlTagAt(src, i, limit)
      if (tag !== null) {
        if (tag.name === open.name) {
          if (tag.kind === 'close') {
            depth -= 1
            if (depth === 0) {
              return tag.end
            }
          } else if (tag.kind === 'open') {
            depth += 1
          } // atomic 同名（<span/>）不改深度
        }
        i = tag.end
        continue
      }
    }
    i += 1
  }
  return null
}

/**
 * 行内代码 span 的闭串查找（markdown-it backticks 规则语义复刻）：开串
 * （长度 n）向后找**等长**串（长度不同的串跳过继续）；内容原样穿过
 * （含 HTML 标签——code span 内容是字面）。找不到返回 -1（该串按字面）。
 */
function findClosingBacktickRun(src: string, start: number, limit: number, runLen: number): number {
  let i = start + runLen
  while (i < limit) {
    if (src[i] === '`') {
      let len = 0
      while (i + len < limit && src[i + len] === '`') {
        len++
      }
      if (len === runLen) {
        return i
      }
      i += len
      continue
    }
    i++
  }
  return -1
}

/**
 * 行内交错扫描（#576 二轮复审 P2）：按文档序从 from 到 limit 扫描，
 * - 转义对 `\x` 跳过（外部上下文的 `\<` 不是标签起点）
 * - 反引号串按等长配对复刻 code span（内容原样跳过——含 HTML 字面；
 *   未配对的串按字面继续）
 * - `<` 起 matchInlineHtmlFragmentAt（成型片段**整段消费**——片段内部的
 *   反引号/转义是字面，不参与 Markdown 结构、不污染其后的配对上下文）
 * 与 markdown-it 侧（backticks 规则先于 html 规则按位置交错）语义一致，
 * 两端一致性由对拍钉住。产出片段的**文本内偏移**区间。
 */
export function scanInlineHtmlFragmentsInText(src: string, from: number, limit: number): HtmlInlineFragment[] {
  const out: HtmlInlineFragment[] = []
  let i = from
  while (i < limit) {
    const ch = src[i]!
    if (ch === '\\') {
      i += 2 // 转义对（外部上下文）
      continue
    }
    if (ch === '`') {
      let runLen = 0
      while (i + runLen < limit && src[i + runLen] === '`') {
        runLen++
      }
      const close = findClosingBacktickRun(src, i, limit, runLen)
      i = close < 0 ? i + runLen : close + runLen
      continue
    }
    if (ch === '<') {
      const end = matchInlineHtmlFragmentAt(src, i)
      if (end !== null) {
        out.push({ from: i, to: end })
        i = end
        continue
      }
    }
    i++
  }
  return out
}

/** 行内片段不进入的块级结构（探针实测节点名——整块先行消费，行内容是
 *  字面：围栏/缩进代码块、HTML 注释块、处理指令块、块级 HTML/DOCTYPE） */
const INLINE_EXCLUDED_BLOCK_NODES = new Set(['FencedCode', 'CodeBlock', 'CommentBlock', 'ProcessingInstructionBlock', 'HTMLBlock'])

/**
 * 行的块级上下文判定：行首经 resolveInner 的祖先链含块级结构名即排除
 * （O(depth)——块级区间整体覆盖行，块级结构不跨「行中开始」；不遍历
 * 全树，增量重建的窗口路径每次键击只付祖先链成本）。
 */
function lineInBlockContext(tree: Tree, lineFrom: number): boolean {
  let node: SyntaxNode | null = tree.resolveInner(Math.max(0, Math.min(lineFrom, tree.length - 1)), 1)
  while (node !== null) {
    if (INLINE_EXCLUDED_BLOCK_NODES.has(node.name)) {
      return true
    }
    node = node.parent
  }
  return false
}

/**
 * Lezer 树的行内 HTML 片段（最外层、单行）：树只提供**块级排除区**
 * （块级结构先行消费的行——行内容是字面）；行内结构（code span 配对、
 * 片段消费、外部转义）由 scanInlineHtmlFragmentsInText 按原始文本交错
 * 扫描——不复用 Lezer 的 HTMLTag 节点集合（#576 二轮复审 P2：解析器把
 * HTML 片段内部的反引号配成 InlineCode，会吞掉后续标签的 HTMLTag 候选
 * 或漏吞应字面的标签，片段集合被污染）。from/to 可限定行窗口（增量
 * 重建的窗口扫描；缺省全文档）。
 */
export function inlineHtmlFragmentsOfTree(
  tree: Tree,
  doc: Text,
  from = 0,
  to = doc.length,
): HtmlInlineFragment[] {
  const out: HtmlInlineFragment[] = []
  const firstLine = doc.lineAt(Math.max(0, Math.min(from, doc.length))).number
  const lastLine = doc.lineAt(Math.max(0, Math.min(to, doc.length))).number
  for (let n = firstLine; n <= lastLine; n++) {
    const line = doc.line(n)
    if (lineInBlockContext(tree, line.from)) {
      continue
    }
    const text = doc.sliceString(line.from, line.to)
    for (const frag of scanInlineHtmlFragmentsInText(text, 0, text.length)) {
      out.push({ from: line.from + frag.from, to: line.from + frag.to })
    }
  }
  return out
}
