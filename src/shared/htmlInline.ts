// 行内 HTML 片段边界共享事实源（#568/T03，规格「HTML 范围与源文」「Live
// 的状态与选区」）：
// - **节点名与结构经实测**（探针 test/unit 临时探针 + out/test 探针先例，
//   #246 纪律——不猜节点名）：Paragraph/SetextHeading1/SetextHeading2 是
//   跨行的行内容器（InlineCode/Comment 节点可跨行）；CodeBlock 从缩进
//   之后才开始（行首点查祖先不含它——须行末定位）；链接语法产
//   Link/LinkLabel/LinkMark/URL/LinkTitle，引用定义产 LinkReference
//   （整行被块级消费，不产正文内容）。
// - 片段边界由**原始文本交错扫描**确定（#576 二轮复审起弃用 Lezer
//   HTMLTag 节点集合——解析器把片段内反引号配成 InlineCode 会吞/漏吞
//   标签候选）：按文档序转义对跳过、反引号串等长配对复刻 code span
//   （markdown-it backticks 规则语义）、非元素原始 HTML 产物（注释/
//   PI/声明/CDATA——markdown-it html_inline 各 token 正则的镜像）整
//   token 消费、`<` 起 matchInlineHtmlFragmentAt 成型片段整段消费。两端
//   共用本模块：Lezer 侧 `inlineHtmlFragmentsOfTree`（容器整段扫描 +
//   树上下文排除），markdown-it 侧 `matchInlineHtmlFragmentAt`（行内
//   规则的消费驱动面）——两端一致性由对拍测试钉住
//   （test/unit/htmlInline.test.ts）。
// - **跨行 code span 状态（#576 三轮复审 P2-1）**：code span 可跨行
//   （开闭串可分处容器两行）——状态在**完整行内容器**内维持（容器
//   整段扫描），容器边界重置；单行 HTML 片段的成型边界不变（片段
//   不跨行是 CM6 行内 replace 装饰的硬约束）。
// - **树上下文排除（#576 三轮复审 P2-2/P2-3）**：块级结构五节点名按
//   **行末字符**（行首点查不到缩进后才开始的 CodeBlock）与**片段起点**
//   的祖先链排除；行内结构字面区（LinkTitle/LinkReference——title 是
//   字面串不内解析、定义被块级消费）按片段**起点**祖先链排除
//   （#576 五轮复审 P2-2：终点落入字面区只是树把片段内部文本误标为
//   链接——md-it 位置序先消费片段、链接从未存在，不否决已成型片段）。
// - **孤岛行字面区（#576 五轮复审 P2-1）**：ATX 标题/表格单元格等
//   单行上下文同样接入扫描期跳过（title/目的地/autolink 内的反引号
//   是字面——与容器行同口径）。
// - **字面区事实源 = 占位重解析（#576 八轮复审起）**：行内链接族字面区
//   （LinkTitle/URL/Autolink）不再取外层树节点——HTML 片段跨界时外层
//   树解析出伪链接（Lezer 不懂位置序消费，把片段内部的 `[` 当开界）
//   或漏掉真实成立的链接（闭界 `]` 被片段吞掉），六/七轮的「区间相交
//   /宿主开界被吞」判据在开界与闭界分别被吞的两个方向上各有反例。
//   改为**迭代占位重解析**：扫描得片段 → 片段区间等长替换为中性字符
//   （U+E000 起）→ `parseInline` 重解析 → 派生字面区 → 再扫描，迭代
//   至稳定（≤4 轮）。原理：md-it 位置序中 HTML 片段被消费为 token、
//   对其后的 Markdown 结构解析等价于一段中性文本——占位重解析复现
//   该语义，字面区天然只含真实成立的链接结构。引用定义
//   （LinkReference，块级消费）不受行内消费影响，仍按外层树排除。
// - **表格行分格扫描（#576 六轮复审 P2-2、七轮复审 P2-2、八轮复审
//   P2-2）**：TableCell 只判定「是表格行」；格边界与**格内字面区**都
//   来自生产同源语义——先 `maskCodeSpanPipes`（一次 code span 扫描，
//   未转义且非遮蔽位的 `|` 即格界，O(行长)），再格内占位重解析（真
//   实链接 title 内的反引号+管道受遮蔽保护，不与格末反引号伪配对）。
//   开闭标签分处两格不成片段、code span 内管道不切格（裸 Lezer
//   TableCell 会切错）。
// - **片段配对跳过非元素 token（#576 六轮复审 P2-3）**：片段内部配对
//   按同一 HTML 词法跳过注释/PI/声明/CDATA（内部同名标签是字面，不参
//   与嵌套深度——与片段外交错扫描器同口径）。
// - **单行成型边界**：片段不跨行（开标签与匹配闭标签须同行）；未闭合
//   开标签/孤立闭标签不成片段，降级为源码字面（保守方向与 htmlBlock
//   一致——显源码优先）。
// - **最外层语义**：嵌套片段只取最外层（内层被包含，不独立成片段）——
//   Live 单 widget 覆盖、点击选中完整源码、显形粒度均以最外层为确定性
//   区间；void/自闭合标签单标签即片段。
import type { Text } from '@codemirror/state'
import type { SyntaxNode, Tree } from '@lezer/common'
import { markdownTreeParser } from './markdownDoc'
import { isEscapedAt, maskCodeSpanPipes } from './tableCells'

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
/** 声明产物的名字（HTML 语法：大写字母序列） */
const DECL_NAME_RE = /^<![A-Z]+/
/** 需要扩窗的相关字符（`<` 或反引号——跨行状态与片段成型的唯一入口） */
const RELEVANT_CHARS_RE = /[<`]/

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
 * （单行成型边界——与容器扫描的行内投影一致）。
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
      // 非元素 token（注释/PI/声明/CDATA——#576 六轮复审 P2-3）：按
      // HTML 词法整 token 跳过——内部的同名开/闭标签是字面，不参与
      // 嵌套深度（不能只在片段外的交错扫描器处理注释）
      const rawEnd = matchRawHtmlNonElementAt(src, i, limit)
      if (rawEnd !== null) {
        i = rawEnd
        continue
      }
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
 * 非元素原始 HTML 产物（#576 三轮复审 P2-3）的 token 终点：注释
 * `<!--…-->`（含 `<!-->`/`<!--->` 空形态；内容以 `-->` 结束，可跨行）、
 * PI `<?…?>`、声明 `<!NAME …>`（大写名 + 空白 + 至首个 `>`）、CDATA
 * `<![CDATA[…]]]>`——markdown-it html_inline 各 token 正则的镜像（单
 * token 消费，内部标签是字面）。不成形（无闭串）返回 null（字面，
 * 扫描继续——与 markdown-it 该处规则失败后的继续语义一致）。limit 为
 * 容器末端（这些 token 与 code span 一样可跨行）。
 */
function matchRawHtmlNonElementAt(src: string, pos: number, limit: number): number | null {
  if (pos + 1 >= limit || src[pos] !== '<') {
    return null
  }
  const next = src[pos + 1]!
  if (next === '?') {
    // PI 闭串 `?>` 是两个字符（#576 四轮复审 P2-2：曾按注释闭串误写 +3，
    // 多推进一位吞掉紧邻标签起点）
    const close = src.indexOf('?>', pos + 2)
    return close < 0 || close + 2 > limit ? null : close + 2
  }
  if (next !== '!') {
    return null
  }
  if (src.startsWith('<!-->', pos)) {
    return pos + 5
  }
  if (src.startsWith('<!--->', pos)) {
    return pos + 6
  }
  if (src.startsWith('<!--', pos)) {
    // 通用形态：内容以首个 `-->` 结束（懒惰量词语义；内容可跨行）
    const close = src.indexOf('-->', pos + 4)
    return close < 0 || close + 3 > limit ? null : close + 3
  }
  if (src.startsWith('<![CDATA[', pos)) {
    const close = src.indexOf(']]>', pos + 9)
    return close < 0 || close + 3 > limit ? null : close + 3
  }
  const decl = DECL_NAME_RE.exec(src.slice(pos, limit))
  if (decl !== null) {
    // markdown-it 声明正则：`<![A-Z]+\s[^>]*>`——名字后必须一个空白
    // （\s 含换行），内容至首个 `>`（内容不含 `>`，可跨行）
    const afterName = pos + decl[0].length
    if (afterName < limit && /[ \t\n\r]/.test(src[afterName]!)) {
      const close = src.indexOf('>', afterName + 1)
      return close < 0 || close + 1 > limit ? null : close + 1
    }
    return null
  }
  return null
}

/**
 * 行内代码 span 的闭串查找（markdown-it backticks 规则语义复刻）：开串
 * （长度 n）向后找**等长**串（长度不同的串跳过继续）；内容原样穿过
 * （含 HTML 标签——code span 内容是字面；跨行由容器扫描传入跨行
 * limit 自然成立）。找不到返回 -1（该串按字面）。
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

/** 中性占位字符（U+E000 起私有区第一个文本未含的字符）：HTML 片段
 *  等长替换后重解析用——不参与任何 Markdown 结构（非 delimiter、非
 *  管道、非标签），与 protectCodePipes 的遮蔽字符同一区间选取口径 */
function pickNeutralChar(text: string): string {
  for (let code = 0xe000; code <= 0xf8ff; code++) {
    const ch = String.fromCharCode(code)
    if (!text.includes(ch)) {
      return ch
    }
  }
  return '\u0000' // 私有区全占用兜底（744 位，实践中不可达）
}

/** `parseInline` 产物的嵌套形态（@lezer/markdown Element 的 children
 *  是 @internal 构造参数——公开类型未暴露，运行时结构经探针实证，
 *  此处按运行时结构局部声明） */
interface InlineElement {
  type: number
  from: number
  to: number
  children?: readonly InlineElement[]
}

/** 一次行内交错扫描的产物：片段与已消费区间（同坐标文本内偏移） */
export interface InlineScanResult {
  fragments: HtmlInlineFragment[]
  /** 已成型的 HTML 片段区间（文本内偏移）——占位重解析的占位输入与
   *  调试透出用 */
  consumedRanges: Array<{ from: number; to: number }>
}

/**
 * 行内交错扫描（#576 二轮复审 P2 起的事实源，三轮复审扩为容器粒度）：
 * 按文档序从 from 到 limit 扫描（from/limit 通常为**行内容器**区间——
 * code span 与非元素原始 HTML token 可跨行，状态须容器内维持）：
 * - skipRanges（文本内偏移、升序互斥）：**不参与正文内联解析**的字面区
 *   （链接 title/目的地/autolink——占位重解析派生，#576 八轮复审起天然
 *   只含真实成立的链接结构）——扫描位置进入即整区跳过（#576 四轮复审
 *   P2-3：这些区里的反引号是字面，若参与配对会污染其后正文的 code span
 *   判定；事后过滤只能删错误产物，恢复不了扫描阶段漏掉的正文）。
 * - 转义对 `\x` 跳过（外部上下文的 `\<` 不是标签起点）
 * - 反引号串按等长配对复刻 code span（内容原样跳过——含 HTML 字面；
 *   未配对的串按字面继续）
 * - `<` 起非元素产物（注释/PI/声明/CDATA）**整 token 消费**（内部
 *   标签字面——markdown-it 单 token 语义）
 * - `<` 起 matchInlineHtmlFragmentAt（成型片段**整段消费**——片段内部
 *   的反引号/转义是字面，不参与 Markdown 结构、不污染其后的配对上下文；
 *   片段不跨行由其行内 limit 保证）
 * 与 markdown-it 侧（backticks/html 规则按位置交错）语义一致，两端一致
 * 性由对拍钉住。产出片段与已消费区间的**文本内偏移**区间。
 */
export function scanInlineHtmlFragmentsInText(
  src: string,
  from: number,
  limit: number,
  skipRanges: ReadonlyArray<{ from: number; to: number }> = [],
): InlineScanResult {
  const out: HtmlInlineFragment[] = []
  const consumed: Array<{ from: number; to: number }> = []
  let skipIdx = 0
  let i = from
  while (i < limit) {
    while (skipIdx < skipRanges.length && skipRanges[skipIdx]!.to <= i) {
      skipIdx++
    }
    const skip = skipRanges[skipIdx]
    if (skip !== undefined && i >= skip.from && i < skip.to) {
      i = skip.to
      continue
    }
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
      const rawEnd = matchRawHtmlNonElementAt(src, i, limit)
      if (rawEnd !== null) {
        i = rawEnd
        continue
      }
      const end = matchInlineHtmlFragmentAt(src, i)
      if (end !== null) {
        out.push({ from: i, to: end })
        consumed.push({ from: i, to: end })
        i = end
        continue
      }
    }
    i++
  }
  return { fragments: out, consumedRanges: consumed }
}

/** 行内片段不进入的块级结构（探针实测节点名——整块先行消费，行内容是
 *  字面：围栏/缩进代码块、HTML 注释块、处理指令块、块级 HTML/DOCTYPE） */
const INLINE_EXCLUDED_BLOCK_NODES = new Set(['FencedCode', 'CodeBlock', 'CommentBlock', 'ProcessingInstructionBlock', 'HTMLBlock'])

/** 跨行的行内容器名（探针实测：Paragraph/SetextHeading1/SetextHeading2；
 *  ATX 标题与表格单元格单行——孤岛扫描等价，不入白名单） */
const INLINE_CONTAINER_NODES = new Set(['Paragraph', 'SetextHeading1', 'SetextHeading2'])

/** 片段端点的行内上下文排除名（探针实测）：块级五名（双保险——缩进
 *  代码的块起点在缩进之后，行首判定查不到，端点判定兜底）与
 *  LinkReference（引用定义整行被**块级**消费，不产正文内容——块级
 *  判定先于行内 HTML 位置序消费，不受其影响，外层树即事实源）。
 *  LinkTitle 不在此列（#576 八轮复审起）：行内链接的 title 真伪由
 *  占位重解析在扫描期保证，未经 HTML 语义修正的外层树 LinkTitle
 *  不得否决片段；引用定义的 title 已被 LinkReference 整行覆盖 */
const INLINE_EXCLUDED_CONTEXT_NODES = new Set([...INLINE_EXCLUDED_BLOCK_NODES, 'LinkReference'])

/** 一行的行内扫描上下文（inlineContextOfLine 的产物） */
export interface InlineLineContext {
  /** 行内容属块级排除结构（整行字面，不扫描） */
  excluded: boolean
  /** 行所属行内容器节点（code span 状态的维持边界、字面区收集根）；
   *  null = 无容器（主题分隔线、表格分隔行、引用定义行等——孤岛扫描） */
  container: SyntaxNode | null
}

/**
 * 行的行内扫描上下文（#576 三轮复审 P2-2）：**行末字符**（行首点查
 * 的祖先链不含缩进后才开始的 CodeBlock——块级结构的行内起点在缩进/
 * 标记之后）经 resolveInner 的祖先链（O(depth)，增量窗口路径每次键击
 * 只付祖先链成本）：命中块级排除名 → 整行字面；命中行内容器名 → 容器
 * 区间（跨行 code span 状态的维持边界，容器边界重置）。
 */
export function inlineContextOfLine(tree: Tree, lineFrom: number, lineTo: number): InlineLineContext {
  const pos = Math.max(0, Math.min(lineTo - 1, tree.length - 1))
  if (lineTo <= lineFrom || pos < lineFrom) {
    return { excluded: false, container: null } // 空行：无内容（容器边界语义由相邻行容器差承担）
  }
  let node: SyntaxNode | null = tree.resolveInner(pos, 1)
  let container: SyntaxNode | null = null
  while (node !== null) {
    if (INLINE_EXCLUDED_BLOCK_NODES.has(node.name)) {
      return { excluded: true, container: null }
    }
    if (container === null && INLINE_CONTAINER_NODES.has(node.name)) {
      container = node
    }
    node = node.parent
  }
  return { excluded: false, container }
}

/**
 * 片段起点的上下文排除（块级结构 + 引用定义）。**只认起点**（#576 五轮
 * 复审 P2-2）：块级结构整块先行消费，片段起点在块级内则整段都在——起点
 * 判定即充分。链上无排除名节点时零成本早退（普通文本片段的常态路径）。
 * 行内链接族的伪字面区判定（六/七轮的区间相交/宿主开界判据）已整体退役
 * （#576 八轮复审 P2-1：开界与闭界分别被吞的两个方向各有反例）——该
 * 职责由占位重解析在扫描期接管（resolveInlineHtmlInText）。
 */
function fragmentExcludedByContext(tree: Tree, from: number): boolean {
  let node: SyntaxNode | null = tree.resolveInner(Math.max(0, Math.min(from, tree.length - 1)), 1)
  while (node !== null) {
    if (INLINE_EXCLUDED_CONTEXT_NODES.has(node.name)) {
      return true
    }
    node = node.parent
  }
  return false
}

/** 重解析树中**不参与正文内联解析**的字面区节点名（探针实测）：链接
 *  title（字面串）、目的地 URL（裸/尖括号形态均产——内部反引号字面）、
 *  autolink（<scheme:…> 整体字面）。这些区在扫描期跳过（#576 四轮复审
 *  P2-3——事后过滤删不掉已污染的配对状态）；链接 label 是内联内容，
 *  不入此集合 */
const INLINE_LITERAL_CONTEXT_NODES = new Set(['LinkTitle', 'URL', 'Autolink'])

/** 占位文本的 inline 重解析派生字面区（绝对区间，offset 为文本起点
 *  的文档偏移）：parseInline 的 Element 树递归收集，命中字面区名即整
 *  区收集不再深入（字面区内部无正文内联结构） */
function literalRangesOfPlaceholder(placeholder: string, offset: number): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = []
  const visit = (el: InlineElement): void => {
    const name = markdownTreeParser.nodeSet.types[el.type]?.name
    if (name !== undefined && INLINE_LITERAL_CONTEXT_NODES.has(name)) {
      out.push({ from: el.from, to: el.to })
      return
    }
    for (const child of el.children ?? []) {
      visit(child)
    }
  }
  for (const el of markdownTreeParser.parseInline(placeholder, offset) as InlineElement[]) {
    visit(el)
  }
  return out
}

/** 占位重解析的收敛产物：片段与字面区（均为文档绝对坐标） */
export interface ResolvedInlineHtml {
  fragments: HtmlInlineFragment[]
  literals: Array<{ from: number; to: number }>
}

/**
 * 行内 HTML 片段的**收敛解析**（#576 八轮复审起的事实源）：扫描（字面
 * 区跳过）→ 片段区间等长替换为中性字符 → `parseInline` 重解析 → 派生
 * 字面区 → 再扫描，迭代至片段与字面区双双稳定（≤4 轮）。原理：md-it
 * 位置序中 HTML 片段被消费为 token、对其后的 Markdown 结构解析等价于
 * 一段中性文本——占位重解析复现该语义，字面区（链接 title/目的地/
 * autolink）天然只含**真实成立**的链接结构（链接闭界或目的地被片段
 * 吞掉时重解析不再产链接节点；片段内部的伪 `[` 开界被占位抹去——
 * 外层树在两个方向上都不可信，故不再作字面区事实源）。
 * 典型收敛两轮：首轮无 skip 扫出全部候选片段（含真 title 内的——占位
 * 后重解析恢复链接结构）、次轮字面区生效后片段集修正、第三轮确认稳定。
 * 纯文本快路径：无 `<` 直接零片段返回（不付 parseInline 成本）。
 */
function resolveInlineHtmlInText(text: string, offset: number): ResolvedInlineHtml {
  if (!text.includes('<')) {
    return { fragments: [], literals: [] }
  }
  const neutral = pickNeutralChar(text)
  let fragments: HtmlInlineFragment[] = []
  let literals: Array<{ from: number; to: number }> = []
  for (let round = 0; round < 4; round++) {
    const scan = scanInlineHtmlFragmentsInText(text, 0, text.length,
      literals.map((l) => ({ from: l.from - offset, to: l.to - offset })))
    const frs = scan.fragments.map((f) => ({ from: offset + f.from, to: offset + f.to }))
    let placeholder = text
    if (frs.length > 0) {
      const chars = text.split('')
      for (const f of frs) {
        for (let i = f.from - offset; i < f.to - offset; i++) {
          chars[i] = neutral
        }
      }
      placeholder = chars.join('')
    }
    const nextLits = literalRangesOfPlaceholder(placeholder, offset)
    const stable = rangesEqual(frs, fragments) && rangesEqual(nextLits, literals)
    fragments = frs
    literals = nextLits
    if (stable) {
      break
    }
  }
  return { fragments, literals }
}

function rangesEqual(a: ReadonlyArray<{ from: number; to: number }>, b: ReadonlyArray<{ from: number; to: number }>): boolean {
  return a.length === b.length && a.every((r, i) => r.from === b[i]!.from && r.to === b[i]!.to)
}

/** 孤岛表格行的分格产物：格边界（绝对区间升序）+ 遮蔽后行文本（等长
 *  ——格内扫描/重解析都在遮蔽文本上进行，坐标不变） */
interface TableRowCells {
  segments: Array<{ from: number; to: number }>
  maskedText: string
}

/**
 * 孤岛表格行的分格（#576 八轮复审 P2-2）：**生产同源**口径——先
 * `maskCodeSpanPipes` 遮蔽 code span 内管道（一次 code span 扫描，与
 * Reading 的 protectCodePipes 同一实现），遮蔽后未转义的 `|` 即格界
 * （O(行长)——七轮复审 P3 的逐管道重扫整行在此消除）。#576 六/七轮
 * 复审 P2-2 的边界维持：裸 Lezer TableCell 会把 code span 内管道切
 * 成格界、截断同格完整 HTML——TableCell 只用于判定「是表格行」。
 * 返回 null = 非表格行。
 */
function tableRowCellsOfLine(
  tree: Tree,
  lineFrom: number,
  lineTo: number,
  lineText: string,
): TableRowCells | null {
  let isTableRow = false
  tree.iterate({
    from: lineFrom,
    to: lineTo,
    enter: (node) => {
      if (node.name === 'TableCell') {
        isTableRow = true
        return false
      }
      return true
    },
  })
  if (!isTableRow) {
    return null
  }
  const maskedText = maskCodeSpanPipes(lineText, pickNeutralChar(lineText))
  const segments: Array<{ from: number; to: number }> = []
  let cellStart = 0
  for (let i = 0; i <= maskedText.length; i++) {
    if (i === maskedText.length || (maskedText[i] === '|' && !isEscapedAt(maskedText, i))) {
      if (i > cellStart) {
        segments.push({ from: lineFrom + cellStart, to: lineFrom + i })
      }
      cellStart = i + 1
    }
  }
  return { segments, maskedText }
}

/**
 * Lezer 树的行内 HTML 片段（最外层、单行）：树提供**结构上下文**（块级
 * 排除区、行内容器、表格行判定——全部经实测节点名）；行内结构（code
 * span 配对、非元素 token 消费、片段消费、外部转义）与**链接族字面区**
 * （#576 八轮复审起：字面区不再取外层树——占位重解析派生）由
 * resolveInlineHtmlInText 在容器/格原始文本上收敛解析（#576 三轮复审
 * P2-1/P2-3：容器整段扫描维持跨行状态；不用 Lezer HTMLTag 节点集合）。
 * from/to 可限定行窗口（增量重建：窗口内命中的容器**整段**扫描——状态
 * 从容器起点才正确——片段发射裁剪到窗口交集；同容器多行只扫一次）。
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
  const scanned = new Map<string, HtmlInlineFragment[]>()
  const emitted = new Set<string>()
  for (let n = firstLine; n <= lastLine; n++) {
    const line = doc.line(n)
    const ctx = inlineContextOfLine(tree, line.from, line.to)
    if (ctx.excluded) {
      continue
    }
    if (ctx.container !== null) {
      const containerNode = ctx.container
      const base = containerNode.from
      const key = `${base}:${containerNode.to}`
      if (!scanned.has(key)) {
        const text = doc.sliceString(base, containerNode.to)
        scanned.set(key, resolveInlineHtmlInText(text, base).fragments
          .filter((f) => !fragmentExcludedByContext(tree, f.from)))
      }
      if (!emitted.has(key)) {
        emitted.add(key)
        for (const f of scanned.get(key)!) {
          if (f.to > from && f.from < to) {
            out.push({ from: f.from, to: f.to })
          }
        }
      }
      continue
    }
    // 孤岛行（无行内容器）：表格行按**生产同源**的遮蔽口径分格（一次
    // code span 扫描，格内扫描与字面区都在遮蔽文本上收敛——配对不跨
    // 格且真实链接 title 内的反引号+管道受遮蔽保护，#576 六/七/八轮复审
    // P2-2），其余单行上下文（ATX 标题等）按整行收敛解析（无跨行状态
    // ——单行容器语义等价）
    const lineText = doc.sliceString(line.from, line.to)
    const cells = tableRowCellsOfLine(tree, line.from, line.to, lineText)
    const segments = cells !== null
      ? cells.segments
      : [{ from: line.from, to: line.to }]
    for (const seg of segments) {
      const segText = (cells !== null ? cells.maskedText : lineText)
        .slice(seg.from - line.from, seg.to - line.from)
      for (const f of resolveInlineHtmlInText(segText, seg.from).fragments) {
        if (f.to > from && f.from < to && !fragmentExcludedByContext(tree, f.from)) {
          out.push({ from: f.from, to: f.to })
        }
      }
    }
  }
  return out
}

/** 变更行扩窗相关性判定的共享正则（`<` 或反引号——跨行状态与片段成型
 *  的唯一入口；liveInlineHtml 的窗口构造与剪枝共用同一口径） */
export const INLINE_RELEVANT_CHARS_RE = RELEVANT_CHARS_RE
