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
import { EditorView, getDrawSelectionConfig, layer, RectangleMarker } from '@codemirror/view'
import { EmptyTableCellWidget, liveDecorationsField, LIVE_CLASS_NAMES } from './liveDecorations'

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
    // 与 CM6 selectionLayer 同条件重算（LayerView 外层另有 geometryChanged
    // 兜底）。configChanged（selectionConfig 重配）在原生层有、此处同样
    // 纳入——drawSelection() 全仓唯一调用点且恒默认装配，当前无重配路径，
    // 条件保留是为与原生层语义完全对齐
    const configChanged = getDrawSelectionConfig(update.startState) !== getDrawSelectionConfig(update.state)
    return update.docChanged || update.selectionSet || update.viewportChanged || configChanged
  },
  class: 'vsidian-selection-layer',
})

/** 选区区间 → 背景块：表格 grid 行走格内 clamp；连续非表格行合并为 run
 * 整段交 CM6——run 内跨行/跨软折行命中 CM6 的跨视觉行双分支，首行延伸到
 * 内容区右缘、中间行满宽、末行起内容区左缘（正文惯例保持）。不能逐行
 * 拆分委托：拆分后每段两端落在同一文档行、永远命中单行分支，跨段落选区
 * 的首/中间行高亮会止于行尾文本（审查轮 1 P1）。grid 行打断 run；分隔行
 * （vsidian-table-delimiter-line）非 grid 行、在两段 grid 行间单独成 run，
 * 画文本宽带——比旧的原生满宽横穿收敛，属 #484 台账内口径。 */
function rangeMarkers(view: EditorView, rawFrom: number, rawTo: number): Array<RectangleMarker> {
  // 视口裁剪与 CM6 rectanglesForRange 同口径：视口外行不产出块，裁掉可
  // 避免万行级大范围选区在每次选区/视口变化时全文档逐行 domAtPos 上溯
  const from = Math.max(rawFrom, view.viewport.from)
  const to = Math.min(rawTo, view.viewport.to)
  if (from >= to) return []
  const out: Array<RectangleMarker> = []
  let runStart: number | null = null
  let pos = from
  while (pos < to) {
    const line = view.state.doc.lineAt(pos)
    const lineEl = lineElement(view, line.from)
    if (lineEl?.classList.contains(LIVE_CLASS_NAMES.tableGridRow)) {
      if (runStart != null) {
        closeRunBeforeGrid(view, out, runStart, line.from)
        runStart = null
      }
      const segStart = Math.max(from, line.from)
      const segEnd = Math.min(to, line.to)
      out.push(...tableLineMarkers(view, lineEl, segStart, segEnd, line.from, line.to))
    } else if (runStart == null) {
      runStart = Math.max(from, line.from)
    }
    if (line.to >= to) break
    pos = line.to + 1
  }
  if (runStart != null) {
    out.push(...RectangleMarker.forRange(view, SELECTION_BLOCK_CLASS, EditorSelection.range(runStart, to)))
  }
  return out
}

/**
 * run 在 grid 行前闭合（审查轮 2）：被 grid 打断的 run 内部**全手动分段**，
 * 不再委托 forRange——委托段的 to 落点在哪一行，哪一行就成为「to 所在行」
 * 而退化为文本宽（首版只补末行时倒数第二行同样退化，被 para-into-grid
 * 场景抓回）。形态对齐原生跨行选区：首行（选区起点所在）从起点延伸到
 * 内容区右缘、起点之后的折行视觉行与其余各行（含衔接 grid 的末行）满宽
 * ——它们都是「选区延续行」。
 *
 * 已知边界（审查轮 3 落档）：选区**终止**于分隔行的路径由循环尾部
 * forRange 画文本宽（台账口径）；分隔行被命中显形揭示且选区**穿越**进
 * grid 行的窄路径按延续行画满宽——两口径不一致属已知边界（单光标常态
 * 下覆盖选区使分隔行保持隐藏、coordsAtPos 为 null 提前返回，不触发）。
 * run 首行不可测提前返回依赖「隐藏行必为分隔行且其后必是 grid 行」的
 * 现状；整块替换 widget（如 Mermaid 图形块）作 run 首行时画满内容宽
 * （原生画 widget 盒宽），属形态超集。
 */
function closeRunBeforeGrid(
  view: EditorView,
  out: Array<RectangleMarker>,
  runStart: number,
  gridLineFrom: number,
): void {
  const sides = contentSides(view)
  const piece = (left: number, top: number, right: number, bottom: number) =>
    out.push(new RectangleMarker(
      SELECTION_BLOCK_CLASS,
      left - sides.base.left,
      top - sides.base.top,
      Math.max(0, right - left),
      bottom - top,
    ))
  const first = view.state.doc.lineAt(runStart)
  const startCoords = view.coordsAtPos(runStart, 1)
  if (!startCoords) return
  const firstBlock = view.lineBlockAt(runStart)
  // 起点所在视觉行：从起点到内容区右缘；起点下方同文档行的其余视觉行
  // 满宽（起点在软折行中间时存在——审查轮 3：整块画会在起点下方各行
  // 左侧留 [leftSide, 起点左] 缺口）
  piece(Math.max(startCoords.left, sides.left), startCoords.top, sides.right, startCoords.bottom)
  if (firstBlock.top + firstBlock.height > startCoords.bottom + 0.5) {
    piece(sides.left, startCoords.bottom, sides.right, firstBlock.top + firstBlock.height)
  }
  let pos = first.to + 1
  while (pos < gridLineFrom) {
    const line = view.state.doc.lineAt(pos)
    const block = view.lineBlockAt(line.from)
    piece(sides.left, block.top, sides.right, block.top + block.height)
    pos = line.to + 1
  }
}

/** 内容区左右界（与 CM6 rectanglesForRange 的 leftSide/rightSide 同式取值） */
function contentSides(view: EditorView): { left: number; right: number; base: { left: number; top: number } } {
  const contentRect = view.contentDOM.getBoundingClientRect()
  const lineElt = view.contentDOM.querySelector('.cm-line')
  const win = view.dom.ownerDocument.defaultView
  const style = lineElt && win ? win.getComputedStyle(lineElt) : null
  const pad = (v: string | undefined) => (style ? Number.parseInt(v ?? '', 10) || 0 : 0)
  return {
    left: contentRect.left + pad(style?.paddingLeft) + Math.min(0, pad(style?.textIndent)),
    right: contentRect.right - pad(style?.paddingRight),
    base: layerBase(view),
  }
}

/** 位置所在 .cm-line 元素（不可得时 null） */
function lineElement(view: EditorView, pos: number): HTMLElement | null {
  const at = view.domAtPos(pos)
  let el = at.node instanceof HTMLElement ? at.node : at.node.parentElement
  while (el && !el.classList.contains('cm-line')) el = el.parentElement
  return el
}

/**
 * 表格 grid 行内选区分段绘制：格区间来自 liveDecorations 的格装饰
 * （tableCells 的 GFM 语义拆分，\| 与行内代码内管道不切格）——非空格走
 * mark 装饰、零宽空格走 EmptyTableCellWidget（spec 无 class），两类都要
 * 收集：空格格区间零宽天然不产段，但缺席会使 cells 与 DOM 格元素索引
 * 错位（其后每格高亮左移一列）；每段块的横向边界 clamp 到所属格元素盒。
 * 一行未产出任何段时（格收集为空或全零宽区间无交）回退 CM6 整行段——
 * 原生层已被隐藏，不回退会使该行选区背景完全消失。
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
    const spec = deco.spec as { class?: string; widget?: unknown }
    const isCellMark = typeof spec.class === 'string' && spec.class.split(' ').includes(LIVE_CLASS_NAMES.tableGridCell)
    const isEmptyCell = spec.widget instanceof EmptyTableCellWidget
    if (isCellMark || isEmptyCell) {
      cells.push([f, t])
    }
  })
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
  if (out.length === 0) {
    // 未产出任何段（格收集为空或全零宽区间无交）：回退 CM6 整行段，防止
    // 原生层已隐藏的形态下选区背景整行消失
    return [...RectangleMarker.forRange(view, SELECTION_BLOCK_CLASS, EditorSelection.range(from, to))]
  }
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

/** 层坐标基点（与 CM6 RectangleMarker.forRange 的 getBase 同构，仅 LTR
 * 分支——VSCode webview 编辑器未设 RTL 文本方向；引入 RTL 支持时须补
 * right 锚点分支，与 CM6 getBase 对齐） */
function layerBase(view: EditorView): { left: number; top: number } {
  const rect = view.scrollDOM.getBoundingClientRect()
  return {
    left: rect.left - view.scrollDOM.scrollLeft * view.scaleX,
    top: rect.top - view.scrollDOM.scrollTop * view.scaleY,
  }
}
