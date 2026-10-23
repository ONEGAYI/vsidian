// 表外落点只拥有临时选区；文本与历史仍由外层 CM6/宿主拥有。
import { EditorSelection, StateEffect, StateField } from '@codemirror/state'
import { EditorView, ViewPlugin, keymap, type ViewUpdate } from '@codemirror/view'
import { liveDecorationsField } from './liveDecorations'
import type { TableRowInfo } from './tableStructure'

interface Boundary { from: number; to: number; side: 'before' | 'after' }
const setBoundary = StateEffect.define<Boundary | null>()
export const tableBoundaryField = StateField.define<Boundary | null>({
  create: () => null,
  update(value, tr) {
    if (tr.docChanged || (tr.selection && !tr.selection.eq(tr.startState.selection))) value = null
    for (const effect of tr.effects) if (effect.is(setBoundary)) value = effect.value
    return value
  },
})

export function insertOutside(view: EditorView, text: string, enter = false): boolean {
  if (view.state.readOnly || !view.state.facet(EditorView.editable)) return Boolean(view.state.field(tableBoundaryField))
  const edge = view.state.field(tableBoundaryField)
  if (!edge) return false
  const before = edge.side === 'before', at = before ? edge.from : edge.to
  const insert = enter ? '\n' : before ? text + '\n' : '\n' + text
  view.dispatch({ changes: { from: at, insert },
    selection: EditorSelection.single(enter ? before ? at : at + 1 : before ? at + text.length : at + insert.length),
    effects: setBoundary.of(null), scrollIntoView: true })
  return true
}

export function createTableBoundary({ editableGridCellAt, tableRowsAt }: {
  editableGridCellAt: typeof import('./tableEditing').editableGridCellAt
  tableRowsAt: typeof import('./tableEditing').tableRowsAt
}) {
  function enterBoundary(view: EditorView, rows: TableRowInfo[], side: Boundary['side'], inside?: number): boolean {
    const first = rows[0]!, last = rows[rows.length - 1]!
    const cell = editableGridCellAt(view.state, side === 'before' ? first.lineFrom : last.lineTo)
    if (!cell) return false
    view.dispatch({ selection: EditorSelection.single(inside ?? (side === 'before' ? cell.cells[0]!.contentFrom
      : cell.cells[cell.cells.length - 1]!.contentTo)),
    effects: setBoundary.of({ from: first.lineFrom, to: last.lineTo, side }), userEvent: 'select' })
    return true
  }

  function moveTableBoundary(view: EditorView, forward: boolean, vertical = false): boolean {
    if (view.compositionStarted || view.state.selection.ranges.length !== 1 || !view.state.selection.main.empty) return false
    const state = view.state, edge = state.field(tableBoundaryField), head = state.selection.main.head
    if (edge) {
      const inward = edge.side === 'before' ? forward : !forward
      if (inward) {
        view.dispatch({ effects: setBoundary.of(null) })
        return true
      }
      const line = state.doc.lineAt(edge.side === 'before' ? edge.from : edge.to)
      const number = line.number + (forward ? 1 : -1)
      if (number >= 1 && number <= state.doc.lines) {
        const outside = state.doc.line(number)
        view.dispatch({ selection: EditorSelection.single(forward ? outside.from : outside.to),
          effects: setBoundary.of(null), scrollIntoView: true })
      }
      return true
    }
    const field = state.field(liveDecorationsField), cell = editableGridCellAt(state, head)
    if (cell) return false // 表内跨格仍走既有导航；首末出格由 stopAtTableBoundary 接手。
    if (vertical) return false // 垂直入格复用既有按水平目标定位列的链路。
    const line = state.doc.lineAt(head)
    if (head !== (forward ? line.to : line.from)) return false
    const number = line.number + (forward ? 1 : -1)
    if (number < 1 || number > state.doc.lines) return false
    const target = state.doc.line(number)
    if (!editableGridCellAt(state, target.from)) return false
    const rows = tableRowsAt(state, target.from, field.tree)
    return rows ? enterBoundary(view, rows, forward ? 'before' : 'after') : false
  }

  function stopAtTableBoundary(view: EditorView, forward: boolean, vertical = false): boolean {
    const field = view.state.field(liveDecorationsField)
    const rows = tableRowsAt(view.state, view.state.selection.main.head, field.tree)
    return rows ? enterBoundary(view, rows, forward ? 'after' : 'before', vertical ? view.state.selection.main.head : undefined) : false
  }

  function deleteOutside(view: EditorView, forward: boolean): boolean {
    if (view.state.readOnly || !view.state.facet(EditorView.editable)) return Boolean(view.state.field(tableBoundaryField))
    if (view.compositionStarted || view.state.selection.ranges.length !== 1 || !view.state.selection.main.empty) return false
    const state = view.state, edge = state.field(tableBoundaryField), head = state.selection.main.head
    if (edge) {
      if (forward !== (edge.side === 'after')) return true
      const line = state.doc.lineAt(forward ? edge.to : edge.from)
      const number = line.number + (forward ? 1 : -1)
      if (number < 1 || number > state.doc.lines) return true
      const adjacent = state.doc.line(number)
      if (adjacent.text.trim().length) {
        view.dispatch({ selection: EditorSelection.single(forward ? adjacent.from : adjacent.to), effects: setBoundary.of(null) })
        return true
      }
      const from = forward ? line.to : adjacent.from
      const to = forward ? adjacent.to : line.from
      const shift = to - from
      const next = { ...edge, from: forward ? edge.from : edge.from - shift, to: forward ? edge.to : edge.to - shift }
      view.dispatch({ changes: { from, to }, effects: setBoundary.of(next),
        selection: EditorSelection.single(forward ? head : head - shift) })
      return true
    }
    if (editableGridCellAt(state, head)) return false
    const line = state.doc.lineAt(head)
    if (head !== (forward ? line.to : line.from)) return false
    const number = line.number + (forward ? 1 : -1)
    if (number < 1 || number > state.doc.lines) return false
    const target = state.doc.line(number), field = state.field(liveDecorationsField)
    if (!editableGridCellAt(state, target.from)) return false
    const rows = tableRowsAt(state, target.from, field.tree)
    if (!rows || !enterBoundary(view, rows, forward ? 'before' : 'after')) return false
    return line.text.trim().length ? true : deleteOutside(view, !forward)
  }

  const boundaryPaint = ViewPlugin.fromClass(class {
    readonly dom = document.createElement('div')
    constructor(readonly view: EditorView) {
      this.dom.className = 'vsidian-table-boundary'
      this.dom.setAttribute('aria-hidden', 'true')
      view.dom.append(this.dom)
      this.measure()
    }
    update(update: ViewUpdate) {
      if (update.selectionSet || update.docChanged || update.viewportChanged || update.geometryChanged ||
          update.startState.field(tableBoundaryField) !== update.state.field(tableBoundaryField)) this.measure()
    }
    measure() {
      this.view.requestMeasure({
        key: this,
        read: view => {
          const edge = view.state.field(tableBoundaryField)
          if (!edge) return null
          const rows = [...view.contentDOM.querySelectorAll<HTMLElement>('.vsidian-table-grid-row')]
            .filter(row => { const pos = view.posAtDOM(row, 0); return pos >= edge.from && pos <= edge.to })
          if (!rows.length) return null
          const first = rows[0]!.getBoundingClientRect(), last = rows[rows.length - 1]!.getBoundingClientRect()
          const root = view.dom.getBoundingClientRect()
          return { side: edge.side, top: first.top - root.top, height: last.bottom - first.top,
            left: (edge.side === 'before' ? first.left : first.right) - root.left }
        },
        write: rect => {
          this.dom.hidden = !rect
          if (rect) Object.assign(this.dom.style, { top: rect.top + 'px', left: rect.left + 'px', height: rect.height + 'px' })
        },
      })
    }
    destroy() { this.dom.remove() }
  })

  const extension = [
    tableBoundaryField, boundaryPaint,
    EditorView.editorAttributes.of(view => view.state.field(tableBoundaryField) ? { class: 'vsidian-table-boundary-active' } : null),
    EditorView.inputHandler.of((view, _from, _to, text) => insertOutside(view, text)),
    EditorView.domEventHandlers({
      paste(event, view) {
        if (!view.state.field(tableBoundaryField)) return false
        const text = event.clipboardData?.getData('text/plain')
        if (text === undefined) return false
        event.preventDefault()
        return insertOutside(view, text)
      },
      mousedown(_event, view) {
        if (view.state.field(tableBoundaryField)) view.dispatch({ effects: setBoundary.of(null) })
        return false
      },
    }),
    keymap.of([
      { key: 'ArrowLeft', run: view => moveTableBoundary(view, false) },
      { key: 'ArrowRight', run: view => moveTableBoundary(view, true) },
      { key: 'ArrowUp', run: view => moveTableBoundary(view, false, true) },
      { key: 'ArrowDown', run: view => moveTableBoundary(view, true, true) },
      { key: 'Enter', run: view => insertOutside(view, '', true) },
      { key: 'Backspace', run: view => deleteOutside(view, false) },
      { key: 'Delete', run: view => deleteOutside(view, true) },
    ]),
  ]
  return { extension, enterBoundary, stopAtTableBoundary }
}
