import { EditorSelection, type EditorState, type Transaction } from '@codemirror/state'
import type { PasteSelection, PasteStage } from '../shared/protocol'
import { inlineMathNeedsSpace, scanMathRanges, type MathOccurrence } from '../shared/math'
import { scanMathInMarkdownLine } from '../shared/markdownDoc'
import type { ConvertedHtml } from './htmlToMarkdown'

export function pasteSelection(selection: EditorSelection): PasteSelection {
  return { ranges: selection.ranges.map(r => ({ anchor: r.anchor, head: r.head })), mainIndex: selection.mainIndex }
}

/** 与 CM6 文本粘贴同样按选区替换；多选区与行数相同则逐行分配。 */
function pasteChanges(state: EditorState, text: string, insertions?: readonly string[]) {
  const input = state.toText(text)
  const distribute = input.lines === state.selection.ranges.length
  let i = 0
  return state.changeByRange(range => {
    const insert = insertions?.[i] ?? (distribute ? input.line(i + 1).text : input)
    i++
    return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(range.from + insert.length, -1) }
  })
}

function pasteTransaction(state: EditorState, text: string, insertions?: readonly string[]): Transaction {
  return state.update({ ...pasteChanges(state, text, insertions), userEvent: 'input.paste', scrollIntoView: true })
}

/** 计算富文本选区的实际插入内容。既有文档会抢占公式定界符或吞掉新内容时返回 null，
 *  让调用方沿纯文本路径回退，而不是为修正格式改动选区之外的源码。 */
export function prepareMathPaste(state: EditorState, text: string, inlineMath: NonNullable<ConvertedHtml['inlineMath']>, blocks: readonly MathOccurrence[]): {
  insertions: string[]; spaced: boolean
} | null {
  const ranges = state.selection.ranges
  const scanned = new Map<number, MathOccurrence[]>()
  const existingInline: MathOccurrence[] = []
  const boundaryBlocks = new Set<MathOccurrence>()
  let blockIndex = 0
  for (const range of ranges) {
    for (const at of [range.from, range.to]) {
      const line = state.doc.lineAt(at)
      // 光标或选区端点在已有公式内部：沿纯文本编辑，不新增一层美元定界符。
      while (blockIndex < blocks.length && blocks[blockIndex]!.to <= line.from) blockIndex++
      const block = blocks[blockIndex]
      if (block && block.from < line.to) {
        if (block.from < at && at < block.to) return null
        boundaryBlocks.add(block)
      }
      let hits = scanned.get(line.number)
      if (!hits) {
        hits = scanMathInMarkdownLine(line.text, line.from)
        scanned.set(line.number, hits)
        for (const hit of hits) if (hit.kind === 'inline') existingInline.push(hit)
      }
      if (hits.some(hit => hit.from < at && at < hit.to)) return null
    }
  }
  const existingStarts = new Set(existingInline.map(hit => hit.from))
  const existingEnds = new Set(existingInline.map(hit => hit.to))
  const input = state.toText(text)
  const distribute = input.lines === ranges.length
  const mathByLine = new Map<number, { from: number; to: number }[]>()
  if (distribute) {
    for (const hit of inlineMath) {
      const line = input.lineAt(hit.from).number
      const set = mathByLine.get(line)
      if (set) set.push(hit)
      else mathByLine.set(line, [hit])
    }
  }
  const expected: { from: number; to: number }[] = []
  let tail: string | undefined, tailIsMath = false, shift = 0, spaced = false
  const insertions = ranges.map((range, i) => {
    const line = distribute ? input.line(i + 1) : undefined
    const chunk = line?.text ?? text
    const start = line?.from ?? 0
    const math = line ? mathByLine.get(line.number) ?? [] : inlineMath
    if (ranges[i - 1]?.to !== range.from) {
      tail = range.from > 0 ? state.doc.sliceString(range.from - 1, range.from) : undefined
      tailIsMath = existingEnds.has(range.from)
    }
    const before = chunk.length > 0 && (math[0]?.from === start && inlineMathNeedsSpace(tail, 'before') ||
      tailIsMath && inlineMathNeedsSpace(chunk[0], 'after'))
    if (chunk) {
      tail = chunk.at(-1)
      tailIsMath = math.at(-1)?.to === start + chunk.length
    }
    const after = ranges[i + 1]?.from !== range.to && (
      existingStarts.has(range.to) && inlineMathNeedsSpace(tail, 'before') ||
      tailIsMath && range.to < state.doc.length &&
        inlineMathNeedsSpace(state.doc.sliceString(range.to, range.to + 1), 'after')
    )
    const insert = (before ? ' ' : '') + chunk + (after ? ' ' : '')
    const offset = range.from + shift + Number(before) - start
    for (const hit of math) expected.push({ from: hit.from + offset, to: hit.to + offset })
    shift += insert.length - (range.to - range.from)
    spaced ||= before || after
    return insert
  })
  // 校验草稿文档，不触发安装在真实事务上的行为或过滤器。
  const { changes } = pasteChanges(state, text, insertions)
  const doc = changes.apply(state.doc)
  // 只检查选区端点所在线的旧公式；被选区替换的公式不参与校验。
  const existing = existingInline.concat([...boundaryBlocks]).sort((a, b) => a.from - b.from)
  const closingTails: { from: number; to: number }[] = []
  let selectionIndex = 0
  for (const hit of existing) {
    while (selectionIndex < ranges.length && ranges[selectionIndex]!.to <= hit.from) selectionIndex++
    const range = ranges[selectionIndex]
    if (range && range.from < hit.to) continue
    const from = changes.mapPos(hit.from, 1)
    const to = changes.mapPos(hit.to, -1)
    if (hit.kind === 'inline') {
      expected.push({ from, to })
      continue
    }
    // 不能仅扫描定界符之间：粘贴可能在旧开启标记之前接上正文。
    const first = doc.lineAt(from)
    const last = doc.lineAt(to - 1)
    const lines: string[] = []
    for (let n = first.number; n <= last.number; n++) lines.push(doc.line(n).text)
    if (!scanMathRanges(lines, first.from).some(block =>
      block.kind === 'block' && block.from === from && block.to === to && block.tex === hit.tex,
    )) return null
    if (to < last.to) closingTails.push({ from: to, to: last.to })
  }
  // 阅读视图会消费整条闭合行。旧块仍可渲染，不代表同一行新增的正文也可见。
  if (closingTails.length) {
    let tailIndex = 0, hiddenInsertion = false
    changes.iterChangedRanges((_fromA, _toA, from, to) => {
      while (!hiddenInsertion && tailIndex < closingTails.length) {
        const tail = closingTails[tailIndex]!
        if (tail.from >= to) break
        const start = Math.max(from, tail.from), end = Math.min(to, tail.to)
        if (start < end && doc.sliceString(start, end).trim()) {
          hiddenInsertion = true
          break
        }
        if (tail.to > to) break
        tailIndex++
      }
    })
    if (hiddenInsertion) return null
  }
  expected.sort((a, b) => a.from - b.from)
  let checked = 0, actual = new Map<number, number>()
  for (const hit of expected) {
    const line = doc.lineAt(hit.from)
    if (line.number !== checked) {
      checked = line.number
      actual = new Map(scanMathInMarkdownLine(line.text, line.from).filter(hit => hit.kind === 'inline').map(hit => [hit.from, hit.to]))
    }
    if (actual.get(hit.from) !== hit.to) return null
  }
  return { insertions, spaced }
}

/** 格式引入额外换行时，不能让多选区B/C改变文本分发数量。 */
export function richPasteDistributionMatches(state: EditorState, plain: string, formatted: string): boolean {
  const ranges = state.selection.ranges.length
  return ranges === 1 || (state.toText(plain).lines === ranges) === (state.toText(formatted).lines === ranges)
}

/** 只计划两条编辑，不持有或执行撤销栈；真正历史来自宿主逐笔 applyEdit。 */
export function planRichPaste(state: EditorState, plain: string, formatted: string, split: boolean, group: string, insertions?: readonly string[]): { transaction: Transaction; paste: PasteStage }[] {
  const final = pasteTransaction(state, formatted, insertions)
  if (final.state.doc.eq(state.doc)) return []
  const text = pasteTransaction(state, plain)
  const hasTextStep = split && !text.state.doc.eq(state.doc) && !text.state.doc.eq(final.state.doc)
  const descriptor = (transaction: Transaction, stage: PasteStage['stage']): PasteStage => ({
    group, stage, hasTextStep,
    before: pasteSelection(transaction.startState.selection), after: pasteSelection(transaction.state.selection),
  })
  if (!hasTextStep) return [{ transaction: final, paste: descriptor(final, split && !text.state.doc.eq(final.state.doc) ? 'format' : 'single') }]
  const format = text.state.update({
    changes: text.changes.invert(state.doc).compose(final.changes),
    selection: final.state.selection,
    userEvent: 'input.paste', scrollIntoView: true,
  })
  return [{ transaction: text, paste: descriptor(text, 'text') }, { transaction: format, paste: descriptor(format, 'format') }]
}
