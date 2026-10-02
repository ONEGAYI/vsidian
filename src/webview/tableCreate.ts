/** 在光标/选区处插入两列、表头加一行数据的空 GFM 表格。#296 起感知容器
 *  前缀：引用块/列表行上插入的表格保持容器层级（表头带完整前缀、后续行
 *  用内容列缩进、分隔空行带裸引用层）；无前缀行为与既有顶层语义一致。 */
import { parseLinePrefix, prefixLength } from '../shared/listPrefix'

export interface PlannedTableCreation {
  changes: { from: number; to: number; insert: string }
  selection: number
}

const EMPTY_TABLE = '|  |  |\n| --- | --- |\n|  |  |'
const EMPTY_TABLE_ROWS = EMPTY_TABLE.split('\n')

/** 表格行的容器前缀形态（#296）：形态学复用 src/shared/listPrefix 单一事
 *  实源。first 用于表头（含列表标记，表格行不是列表项故不含任务标记）；
 *  rest 用于分隔/数据行（标记换成等宽内容列缩进）；blank 用于表格前后
 *  的分隔空行（裸引用层 + 内容列缩进）。无容器前缀返回 null。 */
function containerShapes(lineText: string): { first: string; rest: string; blank: string; total: number } | null {
  const prefix = parseLinePrefix(lineText)
  if (!prefix) return null
  const head = prefix.list
    ? prefix.list.bullet
      ? prefix.list.bullet + prefix.list.gap1
      : prefix.list.digits + prefix.list.delim + prefix.list.gap1
    : ''
  const contentCol = ' '.repeat(prefix.indent.length + head.length)
  return {
    first: prefix.quote + prefix.indent + head,
    rest: prefix.quote + prefix.indent + contentCol,
    blank: prefix.quote.replace(/\s+$/u, '') + (prefix.list ? prefix.indent + contentCol : ''),
    total: prefixLength(prefix),
  }
}

export function planCreateTable(doc: string, from: number, to = from): PlannedTableCreation {
  if (from < 0 || to < from || to > doc.length) {
    throw new RangeError('表格插入位置超出文档范围')
  }
  const lineStart = doc.lastIndexOf('\n', from - 1) + 1
  const nextBreak = doc.indexOf('\n', to)
  const lineEnd = nextBreak < 0 ? doc.length : nextBreak
  const before = doc.slice(0, lineStart)
  const after = doc.slice(lineEnd)
  const left = doc.slice(lineStart, from)
  const right = doc.slice(to, lineEnd)
  const previousLine = before.endsWith('\n') ? before.slice(0, -1).split('\n').at(-1) ?? '' : ''
  const nextLine = after.startsWith('\n') ? after.slice(1).split('\n', 1)[0] ?? '' : ''

  // 容器前缀感知（#296）：前缀取光标行自身的形态学，不猜测上下文
  //（引用块内的裸空行/lazy 正文行按顶层表格处理——规格「已知边界」）
  const shapes = containerShapes(doc.slice(lineStart, lineEnd))
  if (shapes) {
    if (doc.slice(lineStart + shapes.total, lineEnd).trim() === '') {
      // 纯前缀行（引用空行/列表空项）：整行替换为容器内表格——表头接
      // 完整前缀（含列表标记），前后不补空行
      const tableText = EMPTY_TABLE_ROWS.map((row, index) =>
        (index === 0 ? shapes.first : shapes.rest) + row).join('\n')
      return {
        changes: { from: lineStart, to: lineEnd, insert: tableText },
        selection: lineStart + shapes.first.length + 2,
      }
    }
    // 正文行：左右文字各自成段，表格与分隔空行保持容器层级。表格行一律
    // 用内容列前缀（列表标记换等宽缩进）——表格是该列表项的续内容块，
    // 而非新起一项
    const tableText = EMPTY_TABLE_ROWS.map((row) => shapes.rest + row).join('\n')
    const bodyStart = lineStart + shapes.total
    const hasLeftBody = from > bodyStart
    const rightStart = Math.max(to, bodyStart)
    const prefixOut = hasLeftBody
      ? `${left}\n${shapes.blank}\n`
      : previousLine.trim() ? `${shapes.blank}\n` : ''
    const suffixOut = rightStart < lineEnd
      ? `\n${shapes.blank}\n${doc.slice(rightStart, lineEnd)}`
      : nextLine.trim() ? `\n${shapes.blank}` : ''
    return {
      changes: { from: lineStart, to: lineEnd, insert: prefixOut + tableText + suffixOut },
      selection: lineStart + prefixOut.length + shapes.rest.length + 2,
    }
  }

  // 无容器前缀：顶层表格（既有行为）。行内左右文字各自成为段落，表格前后
  // 再留空行。若只在光标处插入管道行，Markdown 会把原行文字并进表头或紧
  // 邻段落，表格解析失败。
  const leftText = left.trim() ? left : ''
  const rightText = right.trim() ? right : ''
  const prefix = leftText ? `${leftText}\n\n` : previousLine.trim() ? '\n' : ''
  const suffix = rightText ? `\n\n${rightText}` : nextLine.trim() ? '\n' : ''
  return {
    changes: { from: lineStart, to: lineEnd, insert: prefix + EMPTY_TABLE + suffix },
    selection: lineStart + prefix.length + 2,
  }
}
