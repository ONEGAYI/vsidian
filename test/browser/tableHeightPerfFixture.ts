// #373 多列表格高度优化性能实测基座：生产 webview 控制器 + 纯规划层直调。
// 探针 API（window.*）：
// - initPerfDoc(text)：装载文档（真实控制器链路）
// - perfLeave()：把光标移到文档首（触发离开→0ms 冲量→搜索/发布），返回
//   调度统计；配合外部计时覆盖「显示重排」路径
// - perfRead()：表格几何（行数/总高/计划串/轨道和/行区宽）
// - benchOptimize({rows, samples, metrics, iterations})：页内直调
//   optimizeTableHeight 计时（纯计算路径；冷首跑 + 热中位）
// - perfStats()：调度层统计（searches/publishes/cellEvals/candidates）
// - perfMetrics()：度量就绪探针（availablePx 等）
import { WebviewSyncController } from '../../src/webview/syncController'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { optimizeTableHeight } from '../../src/webview/tableHeightPlan'
import { getTableOptimizeStats } from '../../src/webview/tableHeightPlan'
import { tableMetricsFacet } from '../../src/webview/tableMetrics'
import { getTableGridStats } from '../../src/webview/liveDecorations'
import '../../src/webview/main.css'

const controller = new WebviewSyncController({
  postMessage() {},
  getState() {
    return undefined
  },
  setState() {},
})
controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])

interface BenchRow {
  header: boolean
  cells: string[]
}

Object.assign(window, {
  initPerfDoc(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'height-perf',
      docUri: 'file:///height-perf.md', version: 1, text })
  },
  perfFocusAt(pos: number) {
    const view = controller.getView()
    if (!view) return false
    view.dispatch({ selection: { anchor: pos } })
    return true
  },
  perfLeave() {
    const view = controller.getView()
    if (!view) return false
    view.dispatch({ selection: { anchor: 0 } })
    return true
  },
  perfRead() {
    const rows = [...document.querySelectorAll('.vsidian-table-grid-row')]
    if (!rows.length) return null
    const first = rows[0].getBoundingClientRect()
    const last = rows[rows.length - 1].getBoundingClientRect()
    const tracks = getComputedStyle(rows[0]).gridTemplateColumns.split(' ').map(Number.parseFloat)
    return {
      rowCount: rows.length,
      height: last.bottom - first.top,
      plan: rows[0].style.getPropertyValue('--vsidian-table-col-widths'),
      tracksSum: tracks.reduce((s, v) => s + v, 0),
      rowArea: rows[0].getBoundingClientRect().width,
      gridCells: document.querySelectorAll('.vsidian-table-grid-cell').length,
    }
  },
  perfStats() {
    return { ...getTableOptimizeStats(), grid: getTableGridStats() }
  },
  perfMetrics() {
    const view = controller.getView()
    const metrics = view?.state.facet(tableMetricsFacet)
    return { availablePx: metrics?.availablePx ?? 0, contentPx: metrics?.contentPx ?? 0,
      cellBoxPx: metrics?.cellBoxPx ?? 0 }
  },
  /** 纯计算直调：iterations 轮（首个 tokenCache 每轮新建 = 冷；随后热） */
  benchOptimize(spec: {
    rows: BenchRow[]
    samples: number[]
    metrics: { contentPx: number; cellBoxPx: number; availablePx: number }
    iterations: number
  }) {
    const times: number[] = []
    let cold = 0
    let last: ReturnType<typeof optimizeTableHeight> | null = null
    let cacheSize = 0
    for (let i = 0; i < spec.iterations; i++) {
      const cache = i === 0 ? new Map() : undefined
      const t0 = performance.now()
      last = optimizeTableHeight(
        { rows: spec.rows, samples: spec.samples, readability: spec.metrics },
        cache ? { tokenCache: cache } : {},
      )
      const dt = performance.now() - t0
      if (i === 0) cold = dt
      else times.push(dt)
      if (i === 0) cacheSize = cache.size
    }
    times.sort((a, b) => a - b)
    const median = times.length ? times[Math.floor(times.length / 2)]! : cold
    const mean = times.length ? times.reduce((s, v) => s + v, 0) / times.length : cold
    return {
      origin: last?.origin ?? '',
      totalLines: last?.totalLines ?? 0,
      baselineLines: last?.baselineLines ?? 0,
      candidates: last?.candidates ?? 0,
      cellEvals: last?.cellEvals ?? 0,
      coldMs: cold,
      warmMedianMs: median,
      warmMeanMs: mean,
      cacheEntries: cacheSize,
    }
  },
  /** 原生输入路径计时：contentDOM 上记录 keydown→input 事件时间差 */
  armInputProbe() {
    const marks: Array<{ kind: string; t: number }> = []
    const content = controller.getView()!.contentDOM
    const onKey = (e: Event): void => {
      if ((e as KeyboardEvent).key.length === 1) marks.push({ kind: 'keydown', t: performance.now() })
    }
    const onInput = (): void => {
      marks.push({ kind: 'input', t: performance.now() })
    }
    content.addEventListener('keydown', onKey)
    content.addEventListener('input', onInput, true)
    ;(window as unknown as Record<string, unknown>)['__perfInputMarks'] = marks
  },
  readInputDeltas() {
    const marks = (window as unknown as { __perfInputMarks?: Array<{ kind: string; t: number }> }).__perfInputMarks ?? []
    const deltas: number[] = []
    for (let i = 1; i < marks.length; i++) {
      if (marks[i].kind === 'input' && marks[i - 1].kind === 'keydown') {
        deltas.push(marks[i].t - marks[i - 1].t)
      }
    }
    return deltas
  },
  controller,
})
