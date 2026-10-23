// 活动格的可编辑文本与源码之间的投影。语法判定复用表格事实源。
import { scanCodeSpans, tableCellBreaks } from './tableCells'

export function tableCellInputView(raw: string) {
  const code = scanCodeSpans(raw), breaks = tableCellBreaks(raw)
  let text = ''
  const positions: number[] = []
  for (let i = 0; i < raw.length; i++) {
    const br = breaks.find(item => item.from === i)
    if (br) { positions.push(i); text += '\n'; i = br.to - 1; continue }
    if (raw[i] === '\\' && !code[i]) {
      let end = i
      while (raw[end] === '\\') end++
      const count = end - i
      if (raw[end] === '|' && !code[end] && count % 2 === 1) {
        for (let n = 0; n < (count - 1) / 2; n++) { positions.push(i + n * 2); text += '\\' }
        positions.push(end - 1); text += '|'; i = end; continue
      }
    }
    positions.push(i); text += raw[i]
  }
  positions.push(raw.length)
  return { text, positions }
}

export function planTableCellInput(raw: string, text: string, caret: number) {
  const previous = tableCellInputView(raw), code = scanCodeSpans(text)
  let prefix = 0, tail = 0
  while (prefix < previous.text.length && prefix < text.length && previous.text[prefix] === text[prefix]) prefix++
  while (tail < previous.text.length - prefix && tail < text.length - prefix &&
    previous.text[previous.text.length - tail - 1] === text[text.length - tail - 1]) tail++
  let next = ''
  const positions: number[] = []
  for (let i = 0; i < text.length; i++) {
    positions.push(next.length)
    if (text[i] === '\\' && !code[i]) {
      let end = i
      while (text[end] === '\\') end++
      if (text[end] === '|' && !code[end]) {
        for (; i < end; i++) { if (i > 0 && positions.length <= i) positions.push(next.length); next += '\\\\' }
        positions.push(next.length); next += '\\|'; continue
      }
    }
    if (text[i] === '|' && !code[i]) next += '\\|'
    else if (text[i] === '\n') {
      const old = i < prefix ? i : i >= text.length - tail ? previous.text.length - (text.length - i) : -1
      next += old < 0 ? '<br>' : raw.slice(previous.positions[old], previous.positions[old + 1])
    } else next += text[i]
  }
  positions.push(next.length)
  let from = 0, suffix = 0
  while (from < raw.length && from < next.length && raw[from] === next[from]) from++
  while (suffix < raw.length - from && suffix < next.length - from && raw[raw.length - suffix - 1] === next[next.length - suffix - 1]) suffix++
  return { from, to: raw.length - suffix, insert: next.slice(from, next.length - suffix), selection: positions[caret]! }
}
