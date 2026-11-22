import { EditorSelection, type EditorState, type Transaction } from '@codemirror/state'
import type { PasteSelection, PasteStage } from '../shared/protocol'
import { inlineMathNeedsSpace } from '../shared/math'
import type { ConvertedHtml } from './htmlToMarkdown'

export function pasteSelection(selection: EditorSelection): PasteSelection {
  return { ranges: selection.ranges.map(r => ({ anchor: r.anchor, head: r.head })), mainIndex: selection.mainIndex }
}

/** 与 CM6 文本粘贴同样按选区替换；多选区与行数相同则逐行分配。 */
function pasteTransaction(state: EditorState, text: string, inlineMath?: ConvertedHtml['inlineMath']): Transaction {
  const input = state.toText(text)
  const distribute = input.lines === state.selection.ranges.length
  const starts = inlineMath && new Set(inlineMath.map(hit => hit.from))
  const ends = inlineMath && new Set(inlineMath.map(hit => hit.to))
  let i = 1
  const changes = state.changeByRange(range => {
    const line = distribute ? input.line(i++) : undefined
    const before = starts?.has(line?.from ?? 0) && range.from > 0 &&
      inlineMathNeedsSpace(state.doc.sliceString(range.from - 1, range.from), 'before')
    const after = ends?.has(line?.to ?? input.length) && range.to < state.doc.length &&
      inlineMathNeedsSpace(state.doc.sliceString(range.to, range.to + 1), 'after')
    let insert = line?.text ?? input
    if (before || after) insert = (before ? ' ' : '') + insert.toString() + (after ? ' ' : '')
    return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(range.from + insert.length, -1) }
  })
  return state.update({ ...changes, userEvent: 'input.paste', scrollIntoView: true })
}

/** 格式引入额外换行时，不能让多选区B/C改变文本分发数量。 */
export function richPasteDistributionMatches(state: EditorState, plain: string, formatted: string): boolean {
  const ranges = state.selection.ranges.length
  return ranges === 1 || (state.toText(plain).lines === ranges) === (state.toText(formatted).lines === ranges)
}

/** 只计划两条编辑，不持有或执行撤销栈；真正历史来自宿主逐笔 applyEdit。 */
export function planRichPaste(state: EditorState, plain: string, formatted: string, split: boolean, group: string, inlineMath?: ConvertedHtml['inlineMath']): { transaction: Transaction; paste: PasteStage }[] {
  const final = pasteTransaction(state, formatted, inlineMath)
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
