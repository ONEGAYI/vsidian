import { EditorSelection } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import type { Tree } from '@lezer/common'
import { normalizeTableRegion, type TableRegion } from './tableRegion'
import { prefixLenOf, type TableRowInfo } from './tableStructure'
import { liveDecorationsField } from './liveDecorations'
import { containerPrefixLen, splitTableRowCells } from '../shared/tableCells'
import { setTableRegion, tableRegionField } from './tableRegionField'

export { setTableRegion, tableRegionField, sameTableRegion } from './tableRegionField'

export function selectTableRegion(view: EditorView, region: TableRegion | null): void {
  const normalized = region ? normalizeTableRegion(region) : null
  if (!normalized && !view.state.field(tableRegionField, false)) return
  if (normalized) {
    const header = view.state.doc.lineAt(normalized.tableFrom)
    const lineNumber = header.number + normalized.rowFrom + (normalized.rowFrom > 0 ? 1 : 0)
    const line = lineNumber <= view.state.doc.lines ? view.state.doc.line(lineNumber) : null
    // 无行身份上下文：前缀按形态学回退感知切分（#296 审查轮），坐标零偏移
    const cell = line && splitTableRowCells(
      line.text, line.from, containerPrefixLen(line.text))[normalized.columnFrom]
    view.dispatch({ selection: EditorSelection.create([
      EditorSelection.cursor(cell?.contentFrom ?? normalized.tableFrom, -1)]),
      effects: setTableRegion.of(normalized) })
  } else {
    view.dispatch({ effects: setTableRegion.of(null) })
  }
}

function contentIndex(rows: TableRowInfo[], lineFrom: number): number {
  return [rows[0], ...rows.slice(2)].findIndex((row) => row?.lineFrom === lineFrom)
}

/** 鼠标原生事件只负责确定格坐标；选择、复制与删除读取同一 StateField。
 *  矩形蒙版类不在此绘制——由 liveDecorations 把 region 类并入网格格装饰
 *  托管（外部贴类会与列把手高亮、CM6 mark 重写互抹，2026-09-28）。 */
export function createTableRegionPointer(tableRowsAt: (view: EditorView, pos: number, tree: Tree) => TableRowInfo[] | null) {
  return ViewPlugin.fromClass(class {
    private anchor: { tableFrom: number; row: number; column: number } | null = null

    constructor(private readonly view: EditorView) {
      view.contentDOM.addEventListener('pointerdown', this.onDown)
      // CM6 的拖选线性更新监听在 document（bubble）的 mousemove 上；接管期
      // 须在 capture 阶段先行拦截，折叠事务才不会被随后的原生展开覆盖
      //（pointermove 上拦截无效：兼容 mousemove 仍会派发给 CM6）。
      document.addEventListener('mousemove', this.onMove, { capture: true })
      document.addEventListener('pointerup', this.onUp)
      document.addEventListener('pointercancel', this.onUp)
      view.dom.addEventListener('focusout', this.onBlur)
    }

    destroy(): void {
      this.view.contentDOM.removeEventListener('pointerdown', this.onDown)
      document.removeEventListener('mousemove', this.onMove, { capture: true })
      document.removeEventListener('pointerup', this.onUp)
      document.removeEventListener('pointercancel', this.onUp)
      this.view.dom.removeEventListener('focusout', this.onBlur)
    }

    private readonly onBlur = (event: FocusEvent): void => {
      if (event.relatedTarget instanceof Node && this.view.dom.contains(event.relatedTarget)) return
      queueMicrotask(() => {
        if (this.view.dom.contains(document.activeElement)) return
        this.anchor = null
        if (this.view.state.field(tableRegionField)) selectTableRegion(this.view, null)
      })
    }
    private readonly onUp = (): void => {
      this.anchor = null
      // CM6 的 pointerup 监听可能在本监听之后结算原生线性选区。
      queueMicrotask(() => {
        const region = this.view.state.field(tableRegionField)
        if (region) this.selectWithoutNativeText(region)
      })
    }

    private selectWithoutNativeText(region: TableRegion): void {
      const live = this.view.state.field(this.liveField, false)
      const rows = live && tableRowsAt(this.view, region.tableFrom, live.tree)
      const row = rows && [rows[0], ...rows.slice(2)][region.rowFrom]
      if (!row) return
      const line = this.view.state.doc.lineAt(row.lineFrom)
      // 行身份前缀（#296 审查轮）：格定位走前缀感知切分，坐标零偏移
      const cell = splitTableRowCells(
        line.text, line.from, prefixLenOf(row))[region.columnFrom]
      if (!cell) return
      this.view.dispatch({ selection: EditorSelection.single(cell.contentFrom), effects: setTableRegion.of(region) })
    }

    /** 格命中：DOM 可见坐标 → 格坐标。excludeCardDomain 为 true 时命中点
     *  落在嵌入卡片域内不算格命中（#248 交互隔离：onDown 起点锚定用——
     *  卡内选字/复制不启动父矩形格区选取）；onMove 的路径命中不排除
     *  （从格/把手开始的拖选经过卡片时仍按所在格扩展）。 */
    private hit(event: MouseEvent, excludeCardDomain = false) {
      const target = document.elementFromPoint(event.clientX, event.clientY) ?? event.target as Element
      if (excludeCardDomain && target instanceof Element &&
          (target.closest('.vsidian-embed-card') !== null || target.closest('.vsidian-live-embed') !== null)) {
        return null
      }
      const cell = target instanceof Element ? target.closest<HTMLElement>('.vsidian-table-grid-cell') : null
      const row = cell?.closest<HTMLElement>('.vsidian-table-grid-row')
      if (!cell || !row || !this.view.contentDOM.contains(row)) return null
      let pos: number
      try { pos = this.view.posAtDOM(row, 0) } catch { return null }
      const field = this.view.state.field(tableRegionField, false)
      if (field === undefined) return null
      // 表格行身份仍由 live 解析树提供，DOM 只提供实际命中的可见坐标。
      const live = this.view.state.field(this.liveField, false)
      if (!live) return null
      const lineFrom = this.view.state.doc.lineAt(pos).from
      const rows = tableRowsAt(this.view, lineFrom, live.tree)
      if (!rows) return null
      const rowIndex = contentIndex(rows, lineFrom)
      const column = [...row.querySelectorAll(':scope > .vsidian-table-grid-cell')].indexOf(cell)
      return rowIndex < 0 || column < 0 ? null : { tableFrom: rows[0]!.lineFrom, row: rowIndex, column }
    }

    // 通过构造器闭包间接取得 live 字段，避免本模块再定义另一套表格解析。
    private readonly liveField = liveDecorationsField

    private readonly onDown = (event: PointerEvent): void => {
      if (event.button !== 0 || this.view.compositionStarted) return
      // #248：起点锚定排除嵌入卡域（卡内 pointerdown 不启动格区选取）
      this.anchor = this.hit(event, true)
      if (this.view.state.field(tableRegionField)) selectTableRegion(this.view, null)
    }

    private readonly onMove = (event: MouseEvent): void => {
      if (!this.anchor || !(event.buttons & 1)) return
      const target = this.hit(event)
      if (!target || target.tableFrom !== this.anchor.tableFrom) {
        // 手势离开该表格后交回 CM6 原生文本拖选，不能保留过期矩形。
        // 此分支不拦截：CM6 需继续收到 mousemove 才能把线性选区扩到当前位置。
        if (this.view.state.field(tableRegionField)) selectTableRegion(this.view, null)
        this.anchor = null
        return
      }
      if (target.row === this.anchor.row && target.column === this.anchor.column) {
        // 仍在首格内：不拦截，保留 CM6 原生逐字文本拖选。
        if (this.view.state.field(tableRegionField)) selectTableRegion(this.view, null)
        return
      }
      // 跨格接管：capture 阶段截断本事件，CM6 的 bubble 监听不再更新线性选区。
      event.preventDefault()
      event.stopImmediatePropagation()
      const region = normalizeTableRegion({ tableFrom: target.tableFrom,
        rowFrom: this.anchor.row, rowTo: target.row,
        columnFrom: this.anchor.column, columnTo: target.column })
      const current = this.view.state.field(tableRegionField)
      if (!current || current.rowFrom !== region.rowFrom || current.rowTo !== region.rowTo ||
          current.columnFrom !== region.columnFrom || current.columnTo !== region.columnTo) {
        this.selectWithoutNativeText(region)
      } else if (!this.view.state.selection.main.empty) {
        this.selectWithoutNativeText(region)
      }
    }
  })
}
