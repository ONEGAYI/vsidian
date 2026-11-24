import { READING_TABLE_LAYOUT_DEFAULT, type ReadingTableLayoutMode } from '../shared/settings'
import type { ReadingHorizontalScroll } from './readingHorizontalScroll'
import {
  effectiveColumnFloorPx, measureWidestSegment, TABLE_WEIGHT_PADDING_UNITS, type TableReadabilityInput,
} from './tableColumnWidth'
import { optimizeTableHeight, resolveTracksPx, tableMetricsSig, type HeightRowInput } from './tableHeightPlan'
import { READING_TABLE_CELL_SOURCE } from './readingMarkdown'
import { stripHtmlComments } from './htmlComment'

export const READING_TABLE_SELECTOR = 'table[data-vsidian-table-from]'

/** 按已渲染的格身份读取原文；markdown-it 自动填补的空格没有源码区间。 */
export function readReadingTableCells(table: HTMLTableElement, text: string): string[][] {
  return Array.from(table.rows, row => Array.from(row.cells, cell => {
    const range = cell.getAttribute(READING_TABLE_CELL_SOURCE)
    if (!range) return ''
    const [from, to] = range.split(':', 2).map(Number)
    return text.slice(from, to)
  }))
}

interface ColumnPlan {
  group: HTMLTableColElement
  cols: HTMLTableColElement[]
  rows: HeightRowInput[]
  samples: number[]
  metricsKey?: string
}

interface MountedTable {
  text: string
  plan?: ColumnPlan
}

/** 折行复用 Live 列宽计划；单行将表格交给阅读视口底栏。 */
export class ReadingTableLayout {
  private readonly tables = new Map<HTMLTableElement, MountedTable>()
  private readonly observer: ResizeObserver | undefined
  private mode: ReadingTableLayoutMode = READING_TABLE_LAYOUT_DEFAULT

  constructor(private readonly horizontalScroll: ReadingHorizontalScroll) {
    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(entries => {
        for (const { target, contentRect } of entries) {
          if (contentRect.width > 0) {
            const table = target as HTMLTableElement
            this.resize(table, this.tables.get(table)!.plan!, contentRect.width)
          }
        }
      })
    }
  }

  setMode(mode: ReadingTableLayoutMode): void {
    if (this.mode === mode) return
    this.mode = mode
    for (const [table, model] of this.tables) {
      this.applyMode(table, model)
      if (mode === 'wrap' && table.clientWidth > 0) this.resize(table, model.plan!, table.clientWidth)
    }
  }

  mountWithin(block: HTMLElement, text: string): void {
    if (!this.observer) return
    for (const table of block.querySelectorAll<HTMLTableElement>(READING_TABLE_SELECTOR)) {
      if (table.closest('.vsidian-reading-html')) continue
      const model = { text }
      this.tables.set(table, model)
      this.applyMode(table, model)
    }
  }

  releaseWithin(block: HTMLElement): void {
    if (!this.observer) return
    for (const table of block.querySelectorAll<HTMLTableElement>(READING_TABLE_SELECTOR)) {
      if (this.tables.delete(table)) {
        this.observer.unobserve(table)
        this.horizontalScroll.untrack(table)
      }
    }
  }

  dispose(): void {
    this.observer?.disconnect()
  }

  private applyMode(table: HTMLTableElement, model: MountedTable): void {
    const wrap = this.mode === 'wrap'
    table.classList.toggle('vsidian-reading-table-planned', wrap)
    table.classList.toggle('vsidian-reading-table-single-line', !wrap)
    if (!wrap) {
      model.plan?.group.remove()
      this.observer!.unobserve(table)
      this.horizontalScroll.track(table, table)
      return
    }
    this.horizontalScroll.untrack(table)
    if (!model.plan) {
      const rows = readReadingTableCells(table, model.text).map((cells, index) => ({
        header: index === 0,
        cells: cells.map(cell => stripHtmlComments(cell.trim()).trim()),
      }))
      const samples = rows[0]!.cells.map(() => 0)
      for (const { cells } of rows) {
        cells.forEach((cell, index) => {
          samples[index] = Math.max(samples[index]!, measureWidestSegment(cell))
        })
      }
      const group = table.ownerDocument.createElement('colgroup')
      const cols = samples.map(() => table.ownerDocument.createElement('col'))
      group.append(...cols)
      model.plan = { group, cols, rows, samples }
    }
    table.prepend(model.plan.group)
    this.observer!.observe(table)
  }

  private resize(table: HTMLTableElement, plan: ColumnPlan, availablePx: number): void {
    const { cols, rows, samples } = plan
    const style = getComputedStyle(table.rows[0]!.cells[0]!)
    // 阅读侧按三个全角字的字号估算内容下限；盒占位取当前 th 的实际样式。
    const readability: TableReadabilityInput = {
      availablePx,
      contentPx: 3 * parseFloat(style.fontSize),
      cellBoxPx: parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) +
        parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth),
    }
    const key = tableMetricsSig(readability)
    if (key === plan.metricsKey) return
    plan.metricsKey = key
    const optimized = optimizeTableHeight({ rows, samples, readability })
    // 和 Live 一样，单列、超列数或超搜索预算仍走同一套轻量列宽分配。
    const widths = optimized.widthsPx ?? resolveTracksPx(
      samples.map(sample => sample + TABLE_WEIGHT_PADDING_UNITS),
      samples.map(() => effectiveColumnFloorPx(samples.length, readability)),
      availablePx,
    )
    cols.forEach((col, index) => { col.style.width = `${100 * widths[index]! / availablePx}%` })
  }

}
