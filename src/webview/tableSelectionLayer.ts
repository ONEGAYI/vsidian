// 表格感知选区背景层（#484）：修复 grid 表格行内跨视觉行选区高亮贯穿整行。
//
// 问题（诊断见 #484）：CM6 drawSelection 的 rectanglesForRange 在折行编辑器
// 中，凡选区 from/to 分属不同视觉行即走「上下双分支」——上段右边界强制取
// 内容区右缘（rightSide）、下段左边界取内容区左缘（leftSide）、中间补满宽
// 竖带。普通正文折行中该行为正确（视觉行高亮满宽符合直觉）；但表格 grid 行
// 的「视觉行」是单个单元格内的折行（<br> cell break 或窄列换行），满宽高亮
// 因此横穿列分隔线并越出表格右边框。
//
// 方案：自建一个与 CM6 selectionLayer 同形的背景层接管绘制——非表格行为逐
// 像素复用 RectangleMarker.forRange（保持正文折行满宽的既有惯例）；命中表格
// grid 行的选区按 tableCells 语义的格区间分段，每段块的横向边界 clamp 到
// 所属格内容盒。CM6 原生 selectionLayer 经 CSS 隐藏（display:none——其测量
// 与 DOM 维持照常运行，行为零风险，仅不再可见），装配随 multicursorExtensions
// 整组进出（多光标关闭时回到原生 ::selection 路径，不装本层）。
import { EditorSelection } from '@codemirror/state'
import { EditorView, layer, RectangleMarker } from '@codemirror/view'
import { liveDecorationsField, LIVE_CLASS_NAMES } from './liveDecorations'

/** 自建层块类名（与 CM6 的 cm-selectionBackground 同样式，见 main.css） */
const SELECTION_BLOCK_CLASS = 'vsidian-selection-background'

/** 表格感知选区背景层：装配在 drawSelection() 旁边（multicursorExtensions） */
export const tableAwareSelectionLayer = layer({
  above: false,
  markers(view) {
    const markers: Array<RectangleMarker> = []
    for (const range of view.state.selection.ranges) {
      if (range.empty) continue
      for (const marker of rangeMarkers(view, range.from, range.to)) markers.push(marker)
    }
    return markers
  },
  update(update) {
    // 与 CM6 selectionLayer 同条件重算（LayerView 外层另有 geometryChanged 兜底）
    return update.docChanged || update.selectionSet || update.viewportChanged
  },
  class: 'vsidian-selection-layer',
})

/** 选区区间 → 背景块：按文档行分段，表格 grid 行走格内 clamp，其余复用 CM6 */
function rangeMarkers(view: EditorView, from: number, to: number): Array<RectangleMarker> {
  const out: Array<RectangleMarker> = []
  let pos = from
  while (pos < to) {
    const line = view.state.doc.lineAt(pos)
    const segEnd = Math.min(to, line.to)
    const segStart = Math.max(from, line.from)
    const lineEl = lineElement(view, line.from)
    if (lineEl?.classList.contains(LIVE_CLASS_NAMES.tableGridRow)) {
      out.push(...tableLineMarkers(view, lineEl, segStart, segEnd, line.from, line.to))
    } else {
      // 非表格行：整段交 CM6（正文折行跨视觉行满宽是既有正确惯例）
      out.push(...RectangleMarker.forRange(view, SELECTION_BLOCK_CLASS, EditorSelection.range(segStart, segEnd)))
    }
    pos = line.to + 1
  }
  return out
}

/** 位置所在 .cm-line 元素（不可得时 null） */
function lineElement(view: EditorView, pos: number): HTMLElement | null {
  const at = view.domAtPos(pos)
  let el = at.node instanceof HTMLElement ? at.node : at.node.parentElement
  while (el && !el.classList.contains('cm-line')) el = el.parentElement
  return el
}

/**
 * 表格 grid 行内选区分段绘制：格区间来自 liveDecorations 的 grid cell mark
 * 装饰（tableCells 的 GFM 语义拆分，\| 与行内代码内管道不切格）；每段块的
 * 横向边界 clamp 到所属格元素盒。
 */
function tableLineMarkers(
  view: EditorView,
  lineEl: HTMLElement,
  from: number,
  to: number,
  lineFrom: number,
  lineTo: number,
): Array<RectangleMarker> {
  const field = view.state.field(liveDecorationsField, false)
  if (!field) return []
  const cells: Array<[number, number]> = []
  field.decos.between(lineFrom, lineTo, (f, t, deco) => {
    const cls = (deco.spec as { class?: string }).class
    if (typeof cls === 'string' && cls.split(' ').includes(LIVE_CLASS_NAMES.tableGridCell)) {
      cells.push([f, t])
    }
  })
  if (cells.length === 0) return []
  const cellEls = lineEl.querySelectorAll<HTMLElement>(':scope > .vsidian-table-grid-cell')
  const base = layerBase(view)
  const out: Array<RectangleMarker> = []
  cells.forEach(([cFrom, cTo], index) => {
    const segStart = Math.max(from, cFrom)
    const segEnd = Math.min(to, cTo)
    if (segStart >= segEnd) return
    const cellEl = cellEls[index]
    if (!cellEl) return
    const box = cellEl.getBoundingClientRect()
    if (box.width === 0 && box.height === 0) return
    out.push(...cellMarkers(view, segStart, segEnd, box, base))
  })
  return out
}

/**
 * 单元格内子区间的块：同视觉行单块；跨视觉行（格内 <br>/窄列折行）时
 * 首段右界与末段左界 clamp 到格盒、中间满格带——与 CM6 在正文折行中的
 * 三段形态同构，只是边界从内容区改为格盒。
 */
function cellMarkers(
  view: EditorView,
  from: number,
  to: number,
  box: DOMRect,
  base: { left: number; top: number },
): Array<RectangleMarker> {
  const start = view.coordsAtPos(from, 1)
  const end = view.coordsAtPos(to, -1)
  if (!start || !end) return []
  const sameVisualLine = start.top < end.bottom && end.top < start.bottom
  const piece = (left: number, top: number, right: number, bottom: number) =>
    new RectangleMarker(SELECTION_BLOCK_CLASS, left - base.left, top - base.top, Math.max(0, right - left), bottom - top)
  if (sameVisualLine) {
    return [piece(Math.min(start.left, end.left), Math.min(start.top, end.top), Math.max(start.right, end.right), Math.max(start.bottom, end.bottom))]
  }
  const out = [piece(start.left, start.top, box.right, start.bottom)]
  if (end.top > start.bottom + 0.5) {
    out.push(piece(box.left, start.bottom, box.right, end.top))
  }
  out.push(piece(box.left, end.top, end.right, end.bottom))
  return out
}

/** 层坐标基点（与 CM6 RectangleMarker.forRange 的 getBase 同构，LTR） */
function layerBase(view: EditorView): { left: number; top: number } {
  const rect = view.scrollDOM.getBoundingClientRect()
  return {
    left: rect.left - view.scrollDOM.scrollLeft * view.scaleX,
    top: rect.top - view.scrollDOM.scrollTop * view.scaleY,
  }
}
