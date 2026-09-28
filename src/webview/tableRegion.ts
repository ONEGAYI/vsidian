import { escapeCellText, parseTableDelimiter, tableRowCellsForColumns, type TableCellRange } from './tableCells'
import type { PlannedTableEdit, TableRowInfo } from './tableStructure'

/** 表头和数据行使用连续索引；分隔行不计入矩形。端点始终规范化为升序。 */
export interface TableRegion {
  tableFrom: number
  rowFrom: number
  rowTo: number
  columnFrom: number
  columnTo: number
}

function tableParts(doc: string, rows: TableRowInfo[]) {
  if (rows[0]?.kind !== 'header' || rows[1]?.kind !== 'delimiter') return null
  const columns = parseTableDelimiter(doc.slice(rows[1].lineFrom, rows[1].lineTo))?.length
  if (!columns) return null
  const content = [rows[0], ...rows.slice(2)]
  const cells = content.map((row) => tableRowCellsForColumns(
    doc.slice(row.lineFrom, row.lineTo), row.lineFrom, columns))
  if (cells.some((row) => !row || row.length !== columns)) return null
  return { columns, content, cells: cells as TableCellRange[][] }
}

export function normalizeTableRegion(region: TableRegion): TableRegion {
  return {
    tableFrom: region.tableFrom,
    rowFrom: Math.min(region.rowFrom, region.rowTo),
    rowTo: Math.max(region.rowFrom, region.rowTo),
    columnFrom: Math.min(region.columnFrom, region.columnTo),
    columnTo: Math.max(region.columnFrom, region.columnTo),
  }
}

function validRegion(region: TableRegion, rows: TableRowInfo[], columns: number): boolean {
  return region.tableFrom === rows[0]?.lineFrom && region.rowFrom >= 0 &&
    region.rowTo < rows.length - 1 && region.columnFrom >= 0 && region.columnTo < columns
}

function escapeCopiedPipes(text: string): string {
  let result = ''
  let slashes = 0
  for (const char of text) {
    if (char === '|') {
      if (slashes % 2 === 0) result += '\\'
      result += char
      slashes = 0
    } else {
      result += char
      slashes = char === '\\' ? slashes + 1 : 0
    }
  }
  return result
}

/** 直接使用格内源文；已合法转义的管道和内联语法不再做二次转义。 */
export function serializeTableRegion(doc: string, rows: TableRowInfo[], selected: TableRegion): string | null {
  const parts = tableParts(doc, rows)
  const region = normalizeTableRegion(selected)
  if (!parts || !validRegion(region, rows, parts.columns)) return null
  const lines: string[] = []
  for (let r = region.rowFrom; r <= region.rowTo; r++) {
    const cells = parts.cells[r]!.slice(region.columnFrom, region.columnTo + 1)
    lines.push('|' + cells.map((cell) => escapeCopiedPipes(doc.slice(cell.from, cell.to))).join('|') + '|')
    if (r === region.rowFrom) lines.push('|' + cells.map(() => ' --- ').join('|') + '|')
  }
  return lines.join('\n')
}

/** 区域删除：整表 > 完整行 > 完整列 > 局部清格。所有改动作为一次事务派发。 */
export function planTableRegionDelete(doc: string, rows: TableRowInfo[], selected: TableRegion): PlannedTableEdit | null {
  const parts = tableParts(doc, rows)
  const region = normalizeTableRegion(selected)
  if (!parts || !validRegion(region, rows, parts.columns)) return null
  const allRows = region.rowFrom === 0 && region.rowTo === parts.content.length - 1
  const allColumns = region.columnFrom === 0 && region.columnTo === parts.columns - 1
  const blockFrom = rows[0]!.lineFrom
  const blockTo = rows.at(-1)!.lineTo
  if (allRows && allColumns || allRows && parts.columns === 1) {
    return { changes: [{ from: blockFrom, to: blockTo, insert: '' }], selection: blockFrom }
  }
  if (allColumns) {
    const kept = parts.content.filter((_row, index) => index < region.rowFrom || index > region.rowTo)
    if (!kept.length) return { changes: [{ from: blockFrom, to: blockTo, insert: '' }], selection: blockFrom }
    const line = (row: TableRowInfo) => doc.slice(row.lineFrom, row.lineTo)
    const insert = [line(kept[0]!), line(rows[1]!), ...kept.slice(1).map(line)].join('\n')
    return { changes: [{ from: blockFrom, to: blockTo, insert }], selection: blockFrom }
  }
  if (allRows) {
    if (region.columnFrom === 0 && region.columnTo === parts.columns - 1) {
      return { changes: [{ from: blockFrom, to: blockTo, insert: '' }], selection: blockFrom }
    }
    const line = (cells: TableCellRange[]) => '|' + cells.map((cell) => doc.slice(cell.from, cell.to)).join('|') + '|'
    const keep = (cells: TableCellRange[]) => cells.filter((_cell, index) =>
      index < region.columnFrom || index > region.columnTo)
    const rebuilt = [line(keep(parts.cells[0]!)),
      line(keep(tableRowCellsForColumns(doc.slice(rows[1]!.lineFrom, rows[1]!.lineTo),
        rows[1]!.lineFrom, parts.columns)!)),
      ...parts.cells.slice(1).map((cells) => line(keep(cells)))].join('\n')
    return { changes: [{ from: blockFrom, to: blockTo, insert: rebuilt }], selection: blockFrom }
  }
  const changes: PlannedTableEdit['changes'] = []
  for (let r = region.rowFrom; r <= region.rowTo; r++) {
    const row = parts.content[r]!
    const rowChanges: PlannedTableEdit['changes'] = []
    for (let c = region.columnFrom; c <= region.columnTo; c++) {
      const cell = parts.cells[r]![c]!
      if (cell.contentFrom < cell.contentTo) rowChanges.push({ from: cell.contentFrom, to: cell.contentTo, insert: '' })
    }
    if (!rowChanges.length) continue
    let edited = doc.slice(row.lineFrom, row.lineTo)
    for (const change of [...rowChanges].reverse()) {
      edited = edited.slice(0, change.from - row.lineFrom) + edited.slice(change.to - row.lineFrom)
    }
    if (tableRowCellsForColumns(edited, row.lineFrom, parts.columns)) {
      changes.push(...rowChanges)
    } else {
      const values = parts.cells[r]!.map((cell, col) => {
        if (col < region.columnFrom || col > region.columnTo) return doc.slice(cell.from, cell.to)
        return doc.slice(cell.from, cell.contentFrom) + doc.slice(cell.contentTo, cell.to) || ' '
      })
      changes.push({ from: row.lineFrom, to: row.lineTo, insert: '|' + values.join('|') + '|' })
    }
  }
  return changes.length ? { changes, selection: changes[0]!.from } : null
}

/** 普通输入覆盖矩形内容，文本只落左上格；结构行及未选格原样保留。 */
export function planTableRegionReplace(doc: string, rows: TableRowInfo[], selected: TableRegion,
  text: string): PlannedTableEdit | null {
  const parts = tableParts(doc, rows)
  const region = normalizeTableRegion(selected)
  if (!parts || !validRegion(region, rows, parts.columns)) return null
  const changes: PlannedTableEdit['changes'] = []
  let selection = -1
  let precedingDelta = 0
  const inserted = escapeCellText(text)
  for (let r = region.rowFrom; r <= region.rowTo; r++) {
    const row = parts.content[r]!
    const values = parts.cells[r]!.map((cell, col) => {
      const original = doc.slice(cell.from, cell.to)
      if (col < region.columnFrom || col > region.columnTo) return original
      const before = doc.slice(cell.from, cell.contentFrom)
      const after = doc.slice(cell.contentTo, cell.to)
      const value = before + (r === region.rowFrom && col === region.columnFrom ? inserted : '') + after
      return value || ' '
    })
    const replacement = '|' + values.join('|') + '|'
    if (!tableRowCellsForColumns(replacement, row.lineFrom, parts.columns)) return null
    if (r === region.rowFrom) {
      const first = parts.cells[r]![region.columnFrom]!
      selection = row.lineFrom + precedingDelta + 1 + values.slice(0, region.columnFrom)
        .reduce((length, value) => length + value.length + 1, 0) +
        doc.slice(first.from, first.contentFrom).length + inserted.length
    }
    changes.push({ from: row.lineFrom, to: row.lineTo, insert: replacement })
    precedingDelta += replacement.length - (row.lineTo - row.lineFrom)
  }
  return selection >= 0 ? { changes, selection } : null
}

/** 解析剪贴板文本为格值矩阵：全部行须构成合法 GFM 表格。复制产物把首行
 *  包装成表头使剪贴板独立成表，粘贴时剥掉包装——首行也是数据；分隔行
 *  不计（2026-09-28 决策）。格值保留原文（含保护空格、既有转义与 <br>
 *  字面；\| 在 GFM 拆分时还原为管道字符）。 */
export function parseTableRegionClipboard(text: string): string[][] | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  while (lines.length && lines[0]!.trim() === '') lines.shift()
  while (lines.length && lines.at(-1)!.trim() === '') lines.pop()
  if (lines.length < 2) return null
  const columns = parseTableDelimiter(lines[1]!)?.length
  if (!columns) return null
  const matrix: string[][] = []
  for (const [index, line] of lines.entries()) {
    if (index === 1) continue
    const cells = tableRowCellsForColumns(line, 0, columns)
    if (!cells || cells.length !== columns) return null
    matrix.push(cells.map((cell) => line.slice(cell.from, cell.to)))
  }
  return matrix.length ? matrix : null
}

/** 格对格粘贴计划（2026-09-28 决策）：以选区左上为锚铺开源矩阵——源覆盖
 *  到的格逐一替换（含越过选区落入表内的格）；选区内源未覆盖的格清空；
 *  源越出表格时向表格末尾扩行、扩列容纳（扩列的分隔格用默认对齐）；粘贴
 *  永不删行列。整表块重建（同 planTableRegionDelete 的整列分支先例）。 */
export function planTableRegionPaste(doc: string, rows: TableRowInfo[], selected: TableRegion,
  matrix: string[][]): PlannedTableEdit | null {
  const parts = tableParts(doc, rows)
  const region = normalizeTableRegion(selected)
  if (!parts || !validRegion(region, rows, parts.columns) || !matrix.length ||
      matrix.some((row) => row.length !== matrix[0]!.length)) return null
  const sourceRows = matrix.length
  const sourceCols = matrix[0]!.length
  const totalCols = Math.max(parts.columns, region.columnFrom + sourceCols)
  const valueFor = (index: number, col: number): string => {
    const dr = index - region.rowFrom
    const dc = col - region.columnFrom
    if (dr >= 0 && dr < sourceRows && dc >= 0 && dc < sourceCols) return matrix[dr]![dc]!
    if (col >= parts.columns) return ' '
    if (index >= region.rowFrom && index <= region.rowTo &&
        col >= region.columnFrom && col <= region.columnTo) return ''
    // 追加行（越出原表）的其余格为空白
    if (index >= parts.content.length) return ' '
    return doc.slice(parts.cells[index]![col]!.from, parts.cells[index]![col]!.to)
  }
  const lines: string[] = []
  let firstCellLine = 0
  let firstCellFrom = 0
  let firstCellText = ' '
  for (let index = 0; index < parts.content.length; index++) {
    const touched = totalCols > parts.columns ||
      (index >= region.rowFrom && index <= region.rowTo) ||
      index < region.rowFrom + sourceRows
    if (!touched) {
      lines.push(doc.slice(parts.content[index]!.lineFrom, parts.content[index]!.lineTo))
      continue
    }
    const values = Array.from({ length: totalCols }, (_unused, col) => valueFor(index, col) || ' ')
    if (index === region.rowFrom) {
      firstCellLine = index === 0 ? 0 : index + 1
      firstCellFrom = 1 + values.slice(0, region.columnFrom)
        .reduce((length, value) => length + value.length + 1, 0)
      firstCellText = values[region.columnFrom]!
    }
    lines.push('|' + values.join('|') + '|')
  }
  const delimiter = totalCols > parts.columns
    ? doc.slice(rows[1]!.lineFrom, rows[1]!.lineTo).replace(/\s*$/, '') +
      ' --- |'.repeat(totalCols - parts.columns)
    : doc.slice(rows[1]!.lineFrom, rows[1]!.lineTo)
  const allLines = [lines[0]!, delimiter, ...lines.slice(1)]
  // 追加行（源行数越过表尾）：源覆盖列取源值，其余格为空白
  for (let index = parts.content.length; index < region.rowFrom + sourceRows; index++) {
    const values = Array.from({ length: totalCols }, (_unused, col) => valueFor(index, col) || ' ')
    allLines.push('|' + values.join('|') + '|')
  }
  const blockFrom = rows[0]!.lineFrom
  const blockTo = rows.at(-1)!.lineTo
  const insert = allLines.join('\n')
  const selection = blockFrom + allLines.slice(0, firstCellLine).join('\n').length +
    (firstCellLine > 0 ? 1 : 0) + firstCellFrom + firstCellText.length
  return { changes: [{ from: blockFrom, to: blockTo, insert }], selection }
}
