// 阅读侧 HTML 注释剥离（#139）：markdown-it 解析前把注释整段删除，
// 仅保留其中的换行符，使阅读视图不渲染注释且行内不留空位
// （`单<!--注释-->词` 渲染为 `单词`）。
//
// 行数不变是坐标系承诺（readingBlocks 的 token.map 行号与 env.lineStarts
// 均为原文坐标）：全部锚点取行首/行尾偏移（块的 start/end、li 锚点、任务
// 写回锚点（#6/#7/#9 的 data-vsidian-src-*）），行内偏移不参与——保留
// 换行即保行数，锚点不受影响。
//
// 代码区保护（多保护优于误剥——误剥正文不可恢复，多显示注释只是呈现
// 瑕疵）：围栏代码（``` / ~~~ 行级状态机）、行内代码（反引号配对掩码，
// 与 tableCells.maskCodeSpanPipes 同款形态学）、缩进代码行（行首 ≥4 空格
// 或 tab 前导，CommonMark 缩进代码块的保守超集——列表续行等合法缩进
// 注释会被多保护，可接受）。未闭合残缺的 `<!--` 保留原样（不吞正文）。
//
// 剥离只影响阅读渲染输入（splitBody 的 body 切片）：查找、写回、源码
// 文本不经本函数；frontmatter 在 splitReadingBlocks 先行提取，天然不剥。
// 代码上下文内 Live 侧（Lezer）与阅读侧（markdown-it）都不产注释节点，
// 本函数的保守保护与两侧解析形态一致。全部按 UTF-16 code unit 索引操作
// （与 slice/indexOf 同口径，代理对不拆错位）。

const OPEN = '<!--'
const CLOSE = '-->'

/** 行内代码区掩码：成对反引号运行（CommonMark 行内代码配对规则——
 *  等长运行闭合）之间的内容（换行除外）替换为 \0 占位；不配对的运行
 *  保持字面。返回与原文等长的掩码文本。 */
function maskInlineCode(text: string): string {
  const chars = text.split('')
  let i = 0
  while (i < chars.length) {
    if (chars[i] !== '`') { i += 1; continue }
    let run = 0
    while (chars[i + run] === '`') run += 1
    let closed = -1
    for (let j = i + run; j < chars.length; ) {
      if (chars[j] === '`') {
        let run2 = 0
        while (chars[j + run2] === '`') run2 += 1
        if (run2 === run) { closed = j; break }
        j += run2
      } else {
        j += 1
      }
    }
    if (closed < 0) { i += run; continue }
    for (let k = i + run; k < closed; k++) {
      if (chars[k] !== '\n') chars[k] = '\0'
    }
    i = closed + run
  }
  return chars.join('')
}

/** 围栏状态机：行首（≤3 空格缩进）``` 或 ~~~（≥3 个）开启，同字符且
 *  长度 ≥ 开长度的行闭合；开闭行自身都算围栏内。 */
interface FenceState { ch: string; len: number }
function inFenceLine(line: string, state: FenceState | null): { state: FenceState | null; inFence: boolean } {
  const m = /^ {0,3}(`{3,}|~{3,})/u.exec(line)
  if (state) {
    if (m && m[1]![0] === state.ch && m[1]!.length >= state.len) {
      return { state: null, inFence: true }
    }
    return { state, inFence: true }
  }
  if (m) {
    return { state: { ch: m[1]![0]!, len: m[1]!.length }, inFence: true }
  }
  return { state: null, inFence: false }
}

/** 缩进代码行（保守超集）：行首 ≥4 空格或 tab 前导。 */
function indentedCodeLine(line: string): boolean {
  return /^(?: {4}|\t)/u.test(line)
}

/** 阅读渲染输入的注释剥离：全文（body 切片）→ 删除注释（仅保留换行）。
 *  代码上下文与未闭合残缺保留原样。纯函数，无副作用。 */
export function stripHtmlComments(text: string, onRemoved?: (from: number, to: number) => void): string {
  if (!text.includes(OPEN)) return text
  // 逐行掩码：围栏/缩进行整行掩码，其余行掩码行内代码区（\0 占位）
  const lines = text.split('\n')
  let fence: FenceState | null = null
  const maskedLines: string[] = []
  for (const line of lines) {
    const step = inFenceLine(line, fence)
    fence = step.state
    maskedLines.push(
      step.inFence || indentedCodeLine(line) ? '\0'.repeat(line.length) : maskInlineCode(line),
    )
  }
  const masked = maskedLines.join('\n')
  // 在掩码文本上配对开闭（代码区内被遮蔽的 <!-- 不可见），按原文真删除。
  // 体内再遇嵌套开标记 <!-- 时该开标记作废、扫描右移（与 Lezer/HTML
  // 形态学一致：`a <!-- x <!-- y --> b` 中只有第二个 <!-- 构成注释——
  // 体内再遇 <!-- 的开标记不是合法注释起点）。体内单个 `<`（非 <!--）
  // 是合法注释体：`<!-- a < b -->` Lezer 实测为 Comment 节点，照常剥离
  const out: string[] = []
  let i = 0
  while (i <= text.length) {
    const at = masked.indexOf(OPEN, i)
    if (at < 0) {
      out.push(text.slice(i))
      break
    }
    out.push(text.slice(i, at))
    const close = masked.indexOf(CLOSE, at + OPEN.length)
    const body = close < 0 ? '' : masked.slice(at + OPEN.length, close)
    if (close < 0 || body.includes(OPEN)) {
      // 未闭合残缺或体内含嵌套开标记：开标记原样保留，扫描从其后继续
      // （不吞后续正文；后续开标记可按自身开闭正常配对）
      out.push(OPEN)
      i = at + OPEN.length
      continue
    }
    const end = close + CLOSE.length
    onRemoved?.(at, end)
    // 整段删除，仅保留换行（行数不变是锚点坐标系承诺，见文件头）
    out.push(text.slice(at, end).replace(/[^\n]/gu, ''))
    i = end
  }
  return out.join('')
}
