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
 * Lezer 树的行内 HTML 片段（最外层、单行）：HTMLTag 节点是**候选起点**
 * （解析器语义面——代码与块级区域不产 HTMLTag，天然排除），片段范围在
 * **原始文本**上按 HTML 语法确定（matchInlineHtmlFragmentAt——与
 * markdown-it 侧同一驱动面，两端一致由对拍钉住）。不配对树节点的原因
 * （#576 评审 P2-6）：Lezer 会把片段内的 `\` 组合成 Escape 节点吞掉后续
 * 标签的 `<`（`a <span>\</span>` 的闭标签不再产 HTMLTag），只配对剩余
 * 节点会把两端一致的片段误判为未闭合。HTML 外部的真转义（`\<span>`）
 * 不产 HTMLTag 候选，排除语义保持。
 */
export function inlineHtmlFragmentsOfTree(tree: Tree, doc: Text): HtmlInlineFragment[] {
  const starts: number[] = []
  const visit = (node: SyntaxNode): void => {
    if (node.name === 'HTMLTag') {
      starts.push(node.from)
      return // 叶子节点（解析器界定的单标签）
    }
    for (let child = node.firstChild; child; child = child.nextSibling) {
      visit(child)
    }
  }
  visit(tree.topNode)
  if (starts.length === 0) {
    return []
  }
  // 候选升序逐个起扫：从最左候选在原始文本上确定完整片段，已成交片段
  // 内的后续候选跳过（嵌套只保留最外层；孤立闭标签起点不成型）
  const out: HtmlInlineFragment[] = []
  let coveredTo = -1
  for (const from of starts) {
    if (from < coveredTo) {
      continue // 已含在前一片段内
    }
    const line = doc.lineAt(from)
    const lineText = doc.sliceString(line.from, line.to)
    const end = matchInlineHtmlFragmentAt(lineText, from - line.from)
    if (end === null) {
      continue
    }
    const to = line.from + end
    out.push({ from, to })
    coveredTo = to
  }
  return out
}
