import { StateEffect, StateField, type EditorState } from '@codemirror/state'
import type { TableRegion } from './tableRegion'
import { splitTableRowCells } from './tableCells'

export const setTableRegion = StateEffect.define<TableRegion | null>()

function caretInRegion(state: EditorState, region: TableRegion, pos: number): boolean {
  const header = state.doc.lineAt(region.tableFrom)
  const line = state.doc.lineAt(pos)
  const row = line.number - header.number - (line.number > header.number ? 1 : 0)
  if (row < region.rowFrom || row > region.rowTo) return false
  const cells = splitTableRowCells(line.text, line.from)
  return cells.some((cell, column) => column >= region.columnFrom && column <= region.columnTo &&
    pos >= cell.from && pos <= cell.to)
}

export const tableRegionField = StateField.define<TableRegion | null>({
  create: () => null,
  update(region, tr) {
    if (tr.docChanged || region && tr.selection !== undefined && !tr.isUserEvent('select.pointer') &&
        (tr.isUserEvent('select') || !caretInRegion(tr.startState, region, tr.selection.main.head) ||
          !caretInRegion(tr.startState, region, tr.selection.main.anchor))) region = null
    for (const effect of tr.effects) if (effect.is(setTableRegion)) region = effect.value
    return region
  },
})

/** 两区域是否等值（null 与 null 相等；field(f, false) 的 undefined 同 null）：
 *  装饰增量种子的去重判定用 */
export function sameTableRegion(a: TableRegion | null | undefined, b: TableRegion | null | undefined): boolean {
  return (a ?? null) === (b ?? null) || a != null && b != null && a.tableFrom === b.tableFrom &&
    a.rowFrom === b.rowFrom && a.rowTo === b.rowTo && a.columnFrom === b.columnFrom && a.columnTo === b.columnTo
}
