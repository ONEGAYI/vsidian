// 行内 HTML 片段边界共享事实源（#568/T03，规格「HTML 范围与源文」「Live
// 的状态与选区」）：
// - **节点名经实测**（探针 out/test/t03-lezer-probe*.mts，#246 先例——
//   不猜节点名）：Live 侧 Lezer markdownLanguage 对行内 HTML 产
//   `HTMLTag` 节点（每标签一个，Paragraph/Heading/TableCell/引用与列表
//   内段落皆产；FencedCode/InlineCode/HTMLBlock 内不产——解析器先行
//   消费或整块吞噬，天然排除代码与块级区域）。
// - 配对范围由**栈派生**（token 级标签语法识别是两端解析器自身的规则
//   ——markdown-it html_inline tokenizer 与 Lezer HTMLTag 的产出形态；
//   不用正则猜测嵌套范围）。两端共用本模块：Lezer 侧
//   `inlineHtmlFragmentsOfTree`（树节点 → 同行分组 → 配对），markdown-it
//   侧 `matchInlineHtmlFragmentAt`（行内规则的消费驱动面）——两端一致
//   性由对拍测试钉住（test/unit/htmlInline.test.ts）。
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
 * 一组标签 token（同行、升序）→ 完整片段集合（最外层）：栈式配对——
 * 闭标签匹配栈内最近的同名开标签（其上未闭合的开标签出栈丢弃）；
 * atomic 单标签即片段；孤立闭标签忽略；行末栈中残留的未闭合开标签
 * 丢弃。嵌套只保留最外层（内层被包含）。
 */
export function pairInlineHtmlTags(tags: readonly HtmlTagToken[]): HtmlInlineFragment[] {
  const complete: HtmlInlineFragment[] = []
  const stack: HtmlTagToken[] = []
  for (const tag of tags) {
    if (tag.kind === 'open') {
      stack.push(tag)
    } else if (tag.kind === 'close') {
      let hit = -1
      for (let i = stack.length - 1; i >= 0; i -= 1) {
        if (stack[i]!.name === tag.name) {
          hit = i
          break
        }
      }
      if (hit >= 0) {
        complete.push({ from: stack[hit]!.from, to: tag.to })
        stack.length = hit // 弹出到匹配层（其上未闭合开标签不成交换）
      }
    } else {
      complete.push({ from: tag.from, to: tag.to })
    }
  }
  // 最外层过滤：被其他完整片段包含的内层片段移除
  const out: HtmlInlineFragment[] = []
  for (const frag of complete) {
    const contained = complete.some(
      (other) => other !== frag && other.from <= frag.from && frag.to <= other.to,
    )
    if (!contained) {
      out.push(frag)
    }
  }
  out.sort((a, b) => a.from - b.from)
  return out
}

/**
 * Lezer 树的行内 HTML 片段（最外层、单行）：HTMLTag 节点按行分组后
 * 栈式配对（shared/htmlInline 单一事实源——与 markdown-it 侧
 * matchInlineHtmlFragmentAt 对拍钉住）。代码与块级区域不产 HTMLTag
 * 节点（解析器语义，探针实测），无需排除表。
 */
export function inlineHtmlFragmentsOfTree(tree: Tree, doc: Text): HtmlInlineFragment[] {
  const tags: HtmlTagToken[] = []
  const visit = (node: SyntaxNode): void => {
    if (node.name === 'HTMLTag') {
      const text = doc.sliceString(node.from, node.to)
      const matched = matchHtmlTagAt(text, 0, text.length)
      if (matched !== null) {
        tags.push({ from: node.from, to: node.to, name: matched.name, kind: matched.kind })
      }
      return // 叶子节点（解析器界定的单标签）
    }
    for (let child = node.firstChild; child; child = child.nextSibling) {
      visit(child)
    }
  }
  visit(tree.topNode)
  if (tags.length === 0) {
    return []
  }
  // 同行分组（单行成型边界），行内按序配对
  const out: HtmlInlineFragment[] = []
  let lineOf = -1
  let group: HtmlTagToken[] = []
  for (const tag of tags) {
    const line = doc.lineAt(tag.from).number
    if (line !== lineOf) {
      out.push(...pairInlineHtmlTags(group))
      group = []
      lineOf = line
    }
    group.push(tag)
  }
  out.push(...pairInlineHtmlTags(group))
  out.sort((a, b) => a.from - b.from)
  return out
}
