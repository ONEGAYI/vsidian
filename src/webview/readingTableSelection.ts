import { readReadingTableCells, READING_TABLE_SELECTOR } from './readingTable'
import {
  normalizeTableRegion, serializeTableRegionCells, TABLE_REGION_CLASSES, tableRegionCellClasses, type TableRegion,
} from './tableRegion'

const REGION_CLASSES = Object.values(TABLE_REGION_CLASSES)

/** 阅读正文的格区只消费真实 GFM 表格。原生选字继续跟随鼠标，以便拖回首格
 *  或拖出表格时无缝恢复；跨格时暂不绘制原生高亮，松手才移除原生范围。 */
export class ReadingTableSelection {
  private readonly listeners = new AbortController()
  private anchor: { cell: HTMLTableCellElement; table: HTMLTableElement } | null = null
  private selected: { table: HTMLTableElement; region: TableRegion } | null = null
  private painted: HTMLTableCellElement[] = []

  constructor(private readonly root: HTMLElement, private readonly sourceText: () => string) {
    const { signal } = this.listeners
    const doc = root.ownerDocument
    doc.addEventListener('pointerdown', this.onDown, { capture: true, signal })
    doc.addEventListener('mousemove', this.onMove, { capture: true, signal })
    doc.addEventListener('pointerup', this.onUp, { signal })
    doc.addEventListener('pointercancel', this.clear, { signal })
    doc.addEventListener('selectionchange', this.onSelectionChange, { signal })
    doc.defaultView!.addEventListener('blur', this.clear, { signal })
    root.addEventListener('focusout', this.onFocusOut, { signal })
    root.addEventListener('keydown', this.onKeyDown, { signal })
    root.addEventListener('dragstart', this.onDragStart, { signal })
    root.addEventListener('copy', this.onCopy, { signal })
  }

  dispose(): void {
    this.listeners.abort()
    this.clear()
  }

  releaseWithin(block: HTMLElement): void {
    if (block.contains(this.anchor?.table ?? null) || block.contains(this.selected?.table ?? null)) this.clear()
  }

  clear = (): void => {
    this.anchor = null
    this.clearPaint()
  }

  private clearPaint(): void {
    for (const cell of this.painted) cell.classList.remove(...REGION_CLASSES)
    this.painted = []
    this.selected = null
  }

  private readonly onDown = (event: PointerEvent): void => {
    if (event.button !== 0 || event.pointerType !== 'mouse') return
    this.clear()
    if (!(event.target instanceof Element) || !this.root.contains(event.target) ||
        event.target.closest('.vsidian-embed-card, .vsidian-reading-html, input, textarea, button, select')) return
    const cell = event.target.closest<HTMLTableCellElement>('td, th')
    const table = cell?.closest<HTMLTableElement>('table')
    if (cell && table?.matches(READING_TABLE_SELECTOR)) this.anchor = { cell, table }
  }

  private readonly onMove = (event: MouseEvent): void => {
    if (!this.anchor || !(event.buttons & 1)) return
    const { cell, table } = this.anchor
    if (!(event.target instanceof Element) || !table.contains(event.target)) {
      this.clear()
      return
    }
    const end = event.target.closest<HTMLTableCellElement>('td, th')
    if (end?.closest('table') !== table) return
    if (end === cell) {
      this.clearPaint()
      return
    }
    const region = normalizeTableRegion({
      tableFrom: Number(table.dataset['vsidianTableFrom']),
      rowFrom: (cell.parentElement as HTMLTableRowElement).rowIndex,
      rowTo: (end.parentElement as HTMLTableRowElement).rowIndex,
      columnFrom: cell.cellIndex,
      columnTo: end.cellIndex,
    })
    const previous = this.selected?.region
    if (previous && previous.rowFrom === region.rowFrom && previous.rowTo === region.rowTo &&
        previous.columnFrom === region.columnFrom && previous.columnTo === region.columnTo) return
    this.clearPaint()
    this.selected = { table, region }
    for (let r = region.rowFrom; r <= region.rowTo; r++) {
      const row = table.rows[r]!
      for (let c = region.columnFrom; c <= region.columnTo; c++) {
        const selected = row.cells[c]!
        selected.classList.add(...tableRegionCellClasses(region, r, c))
        this.painted.push(selected)
      }
    }
  }

  private readonly onUp = (event: PointerEvent): void => {
    if (!this.anchor || event.pointerType !== 'mouse') return
    this.anchor = null
    if (this.selected) this.root.ownerDocument.getSelection()?.removeAllRanges()
  }

  private readonly onDragStart = (event: DragEvent): void => {
    // 链接/图片的原生拖放会发送 pointercancel。只抑制表格手势起点的
    // 原生拖放，不拦普通点击、选中文本拖放或表外的链接拖放。
    if (event.target instanceof Element && this.anchor?.cell.contains(event.target) &&
        event.target.matches('a[href], img')) event.preventDefault()
  }

  private readonly onSelectionChange = (): void => {
    if (!this.anchor && this.selected && !this.root.ownerDocument.getSelection()?.isCollapsed) this.clear()
  }

  private readonly onFocusOut = (event: FocusEvent): void => {
    if (!this.root.contains(event.relatedTarget as Node | null)) this.clear()
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.selected) {
      this.clear()
      event.preventDefault()
    }
  }

  private readonly onCopy = (event: ClipboardEvent): void => {
    if (!this.selected || !event.clipboardData) return
    const { table, region } = this.selected
    const rows = readReadingTableCells(table, this.sourceText())
      .slice(region.rowFrom, region.rowTo + 1).map(row => row.slice(region.columnFrom, region.columnTo + 1))
    event.clipboardData.setData('text/plain', serializeTableRegionCells(rows, 'reading'))
    event.preventDefault()
  }
}
