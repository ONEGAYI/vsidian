// 活动格使用独立 textarea 收集原生输入，不依赖源码空格承载文字节点。
// 网格、选区、结构操作和出站同步仍由外层 CM6 负责。
import { Annotation, EditorSelection, type EditorState } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { tableBoundaryField, insertOutside } from './tableBoundary'
import { tableRegionField } from './tableRegionField'
import { planTableCellInput, tableCellInputView } from '../shared/tableCellInput'
import { tableCellBreaks } from '../shared/tableCells'
import { bindLocale } from './localeDom'

/** 编码前的整格文本；空白行首笔规范化据此保留原始输入载荷。 */
export const independentTableInput = Annotation.define<{ text: string }>()
export const independentTableKey = new WeakSet<EditorState>()
function inputSelection(raw: string, plan: ReturnType<typeof planTableCellInput>, offset: number) {
  const next = raw.slice(0, plan.from) + plan.insert + raw.slice(plan.to)
  const assoc = tableCellBreaks(next).some(item => item.to === plan.selection) ? 1 : -1
  return EditorSelection.create([EditorSelection.cursor(offset + plan.selection, assoc)])
}
export function createTableCellInput({ editableGridCellAt, deleteGridCellBreak }: {
  editableGridCellAt: typeof import('./tableEditing').editableGridCellAt
  deleteGridCellBreak: typeof import('./tableEditing').deleteGridCellBreak
}) {
  function inputCell(view: EditorView) {
    if (view.state.readOnly || !view.state.facet(EditorView.editable) ||
        view.state.selection.ranges.length !== 1 || view.state.field(tableBoundaryField)) return null
    const range = view.state.selection.main, cell = editableGridCellAt(view.state, range.anchor)
    if (!cell || range.from < cell.from || range.to > cell.to) return null
    return cell.contentFrom === cell.contentTo ? { ...cell, contentFrom: cell.from, contentTo: cell.from } : cell
  }
  function projectedPosition(positions: number[], source: number): number {
    let at = 0
    while (at + 1 < positions.length && positions[at + 1]! <= source) at++
    return at
  }
  const inputPlugin = ViewPlugin.fromClass(class {
    readonly input = document.createElement('textarea')
    readonly caret = document.createElement('div')
    composing = false
    forwarding = false
    destroyed = false
    pointerSelecting = false
    contentRange: { from: number; to: number } | null = null
    constructor(readonly view: EditorView) {
      this.input.className = 'vsidian-table-cell-input'
      bindLocale(this.input, 'aria-label', 'decor.tableCellInput')
      this.input.spellcheck = false
      this.input.wrap = 'off'
      this.caret.className = 'vsidian-table-cell-input-caret'
      this.caret.setAttribute('aria-hidden', 'true')
      view.dom.append(this.input, this.caret)
      this.input.addEventListener('input', () => this.commit())
      this.input.addEventListener('select', () => {
        this.syncSelection()
      })
      this.input.addEventListener('keyup', () => this.syncSelection())
      for (const type of ['copy', 'cut', 'paste'] as const) this.input.addEventListener(type, event => {
      const richPaste = type === 'paste' && !view.state.field(tableBoundaryField) &&
        (event.clipboardData?.types.includes('text/html') || Array.from(event.clipboardData?.items ?? [])
          .some(item => item.kind === 'file' && item.type.startsWith('image/')))
      if (!view.state.field(tableRegionField, false) && !richPaste) return
      this.syncSelection()
        const forwarded = new ClipboardEvent(type, { clipboardData: event.clipboardData, bubbles: true, cancelable: true })
        view.contentDOM.dispatchEvent(forwarded)
        if (forwarded.defaultPrevented) event.preventDefault()
      })
      this.input.addEventListener('keydown', event => {
        event.stopPropagation()
        if (event.isComposing || this.composing) return
        const start = this.input.selectionStart, end = this.input.selectionEnd
        const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight'
        const atBoundary = horizontal && start === end &&
          (event.key === 'ArrowLeft' ? start === 0 : end === this.input.value.length)
        const deletionBoundary = start === end && (event.key === 'Backspace' ? start === 0 : end === this.input.value.length)
        const shortcut = (event.ctrlKey || event.metaKey) && !['a', 'c', 'v', 'x', 'control', 'meta', 'shift', 'alt'].includes(event.key.toLowerCase())
        const structure = ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab', 'Enter'].includes(event.key)
        const regionKey = Boolean(view.state.field(tableRegionField, false)) && structure
        if (event.key === 'Backspace' && !regionKey && !deletionBoundary && !event.ctrlKey && !event.metaKey) {
          this.syncSelection()
          if (deleteGridCellBreak(view)) { event.preventDefault(); this.refresh(); return }
        }
        const edge = view.state.field(tableBoundaryField)
        if (edge && !structure && !shortcut) return
        if (!edge && !regionKey && ['Backspace', 'Delete'].includes(event.key) && !deletionBoundary && !shortcut) return
        if (!regionKey && !shortcut && (!structure || (horizontal && !atBoundary))) return
        this.syncSelection()
        this.forwarding = true
        const forwarded = new KeyboardEvent('keydown', { key: event.key, code: event.code,
          ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, shiftKey: event.shiftKey,
          bubbles: true, cancelable: true })
        const startState = view.state
        independentTableKey.add(startState)
        view.contentDOM.dispatchEvent(forwarded)
        independentTableKey.delete(startState)
        this.forwarding = false
        event.preventDefault()
        this.refresh()
      })
      this.input.addEventListener('compositionstart', () => {
        this.composing = true
        view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      })
      this.input.addEventListener('compositionend', () => {
        this.composing = false
        this.commit()
        view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
        this.refresh()
      })
      view.dom.addEventListener('focusin', this.onFocus)
      view.dom.addEventListener('focusout', this.onFocus)
      view.contentDOM.addEventListener('pointerdown', this.onPointerDown, true)
      view.dom.ownerDocument.addEventListener('pointerup', this.onPointerUp)
      view.dom.ownerDocument.addEventListener('pointercancel', this.onPointerUp)
      view.scrollDOM.addEventListener('scroll', this.onScroll)
      this.refresh()
    }
    readonly onFocus = () => this.refresh()
    readonly onScroll = () => this.measure()
    readonly onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      this.pointerSelecting = true
      this.caret.hidden = true
      this.view.dom.classList.remove('vsidian-table-cell-input-active')
    }
    readonly onPointerUp = () => {
      this.pointerSelecting = false
      this.refresh()
    }
    syncSelection() {
      if (this.forwarding || this.composing || this.view.dom.ownerDocument.activeElement !== this.input ||
          this.view.state.field(tableRegionField, false)) return
      const cell = this.cell()
      if (!cell) return
      const projection = tableCellInputView(this.view.state.sliceDoc(cell.contentFrom, cell.contentTo))
      const anchor = cell.contentFrom + projection.positions[this.input.selectionStart]!
      const head = cell.contentFrom + projection.positions[this.input.selectionEnd]!
      const backward = this.input.selectionDirection === 'backward'
      const selection = EditorSelection.single(backward ? head : anchor, backward ? anchor : head)
      if (selection.main.anchor !== this.view.state.selection.main.anchor ||
          selection.main.head !== this.view.state.selection.main.head) {
        this.view.dispatch({ selection, userEvent: 'select' })
      }
    }
    commit() {
      if (this.view.state.field(tableBoundaryField)) {
        if (!this.composing && this.input.value) { insertOutside(this.view, this.input.value); this.view.focus() }
        return
      }
      const cell = this.cell()
      if (!cell) return
      const raw = this.view.state.sliceDoc(cell.contentFrom, cell.contentTo)
      const region = this.view.state.field(tableRegionField, false)
      const plan = planTableCellInput(raw, this.input.value, this.input.selectionStart)
      if (!region && raw.slice(plan.from, plan.to) === plan.insert) return
      this.forwarding = true
      this.view.dispatch({ changes: region
        ? { from: cell.contentFrom, to: cell.contentTo, insert: planTableCellInput('', this.input.value, this.input.selectionStart).insert }
        : { from: cell.contentFrom + plan.from, to: cell.contentFrom + plan.to, insert: plan.insert },
        selection: inputSelection(raw, plan, cell.contentFrom),
        annotations: independentTableInput.of({ text: this.input.value }), userEvent: this.composing ? 'input.type.compose' : 'input.type' })
      this.forwarding = false
      if (!this.composing) this.refresh()
      this.measure()
    }
    update(update: ViewUpdate) {
      if (update.state.field(tableRegionField, false)) update.view.dom.ownerDocument.getSelection()?.removeAllRanges()
      if (update.docChanged && this.contentRange) this.contentRange = {
        from: update.changes.mapPos(this.contentRange.from, -1),
        to: update.changes.mapPos(this.contentRange.to, 1),
      }
      if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged ||
          update.transactions.some(tr => tr.reconfigured) ||
          update.startState.field(tableBoundaryField) !== update.state.field(tableBoundaryField)) this.refresh()
    }
    refresh() {
      queueMicrotask(() => {
        if (this.destroyed || this.forwarding || this.composing || this.view.compositionStarted) return
        const view = this.view, active = view.dom.ownerDocument.activeElement, cell = this.cell()
        const edge = !view.state.readOnly && view.state.facet(EditorView.editable) && view.state.field(tableBoundaryField)
        const focused = active === this.input || view.hasFocus
        this.caret.hidden = this.pointerSelecting || !cell || !focused || Boolean(view.state.field(tableRegionField, false))
        view.dom.classList.toggle('vsidian-table-cell-input-active', Boolean(cell && focused && !this.pointerSelecting))
        // 拖选期间由 CM6 管理原生 selection；松手后再交给独立输入，避免焦点切换打断鼠标选择。
        if (this.pointerSelecting) return
        if ((!cell && !edge) || !focused) { if (active === this.input) view.focus(); return }
        const region = view.state.field(tableRegionField, false)
        const projection = tableCellInputView(cell && !region ? view.state.sliceDoc(cell.contentFrom, cell.contentTo) : '')
        const range = view.state.selection.main
        this.forwarding = true
        if (this.input.value !== projection.text) this.input.value = projection.text
        const from = region || !cell ? 0 : projectedPosition(projection.positions, range.from - cell.contentFrom)
        const to = region || !cell ? projection.text.length : projectedPosition(projection.positions, range.to - cell.contentFrom)
        const direction = range.anchor > range.head ? 'backward' : 'forward'
        if (this.input.selectionStart !== from || this.input.selectionEnd !== to || this.input.selectionDirection !== direction) this.input.setSelectionRange(from, to, direction)
        this.input.focus({ preventScroll: true })
        this.forwarding = false
        // 透明格式空白可投影为同一输入落点；源选区也须对齐，符号补全才认作原位键入。
        this.syncSelection()
        this.measure()
      })
    }
    cell() {
      const cell = inputCell(this.view)
      if (!cell) { this.contentRange = null; return null }
      if (!this.contentRange || this.contentRange.from < cell.from || this.contentRange.to > cell.to) {
        this.contentRange = { from: cell.contentFrom, to: cell.contentTo }
      }
      return { ...cell, contentFrom: this.contentRange.from, contentTo: this.contentRange.to }
    }
    measure() {
      this.view.requestMeasure({
        key: this,
        read: view => {
          if (view.dom.ownerDocument.activeElement !== this.input) return null
          const edge = view.state.field(tableBoundaryField), cell = this.cell()
          if (!cell && !edge) return null
          let rect = view.coordsAtPos(view.state.selection.main.head, view.state.selection.main.assoc || 1)
          if (edge) {
            const painted = view.dom.querySelector<HTMLElement>('.vsidian-table-boundary')
            if (painted && !painted.hidden) {
              const box = painted.getBoundingClientRect()
              rect = { left: box.left, right: box.right, top: box.top + box.height / 2, bottom: box.top + box.height / 2 + view.defaultLineHeight }
            }
          } else if (cell && cell.contentFrom === cell.contentTo) {
            const row = [...view.contentDOM.querySelectorAll<HTMLElement>('.vsidian-table-grid-row')]
              .find(el => view.posAtDOM(el, 0) === cell.line.from)
            const column = cell.cells.findIndex(item => item.from === cell.from)
            const element = row?.querySelectorAll<HTMLElement>(':scope > .vsidian-table-grid-cell')[column]
            if (element) {
              const box = element.getBoundingClientRect(), style = getComputedStyle(element)
              const left = box.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth)
              const top = box.top + parseFloat(style.paddingTop) + parseFloat(style.borderTopWidth)
              rect = { left, right: left, top, bottom: top + view.defaultLineHeight }
            }
          }
          const root = view.dom.getBoundingClientRect()
          return rect ? { left: rect.left - root.left, top: rect.top - root.top, height: rect.bottom - rect.top } : null
        },
        write: rect => {
          this.caret.hidden = !rect || !this.view.state.selection.main.empty || Boolean(this.view.state.field(tableRegionField, false)) || Boolean(this.view.state.field(tableBoundaryField))
          if (rect) {
            Object.assign(this.caret.style, { left: rect.left + 'px', top: rect.top + 'px', height: rect.height + 'px' })
            Object.assign(this.input.style, { left: rect.left + 'px', top: rect.top + 'px' })
          }
        },
      })
    }
    destroy() {
      this.destroyed = true
      this.view.dom.removeEventListener('focusin', this.onFocus)
      this.view.dom.removeEventListener('focusout', this.onFocus)
      this.view.contentDOM.removeEventListener('pointerdown', this.onPointerDown, true)
      this.view.dom.ownerDocument.removeEventListener('pointerup', this.onPointerUp)
      this.view.dom.ownerDocument.removeEventListener('pointercancel', this.onPointerUp)
      this.view.scrollDOM.removeEventListener('scroll', this.onScroll)
      this.input.remove()
      this.caret.remove()
      this.view.dom.classList.remove('vsidian-table-cell-input-active')
    }
  })

  return [
    inputPlugin,
    EditorView.domEventHandlers({
      beforeinput(event, view) {
        if (event.inputType !== 'insertText' || event.data === null || event.isComposing) return false
        const cell = inputCell(view)
        if (!cell) return false
        event.preventDefault()
        const range = view.state.selection.main
        const raw = view.state.sliceDoc(cell.contentFrom, cell.contentTo), projection = tableCellInputView(raw)
        const from = projectedPosition(projection.positions, range.from - cell.contentFrom)
        const to = projectedPosition(projection.positions, range.to - cell.contentFrom)
        const text = projection.text.slice(0, from) + event.data + projection.text.slice(to)
        const plan = planTableCellInput(raw, text, from + event.data.length)
        view.dispatch({ changes: { from: cell.contentFrom + plan.from, to: cell.contentFrom + plan.to, insert: plan.insert },
          selection: inputSelection(raw, plan, cell.contentFrom),
          annotations: independentTableInput.of({ text }), userEvent: 'input.type' })
        return true
      },
    }),
  ]
}
