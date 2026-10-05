// 引用块内表格绘制回归（#296 真机报障）：装配生产 webview 控制器，
// 断言落在真实布局（同行格同水平带、列序、竖条计算值），防「存在性
// 断言全绿但布局断裂」的盲区复发。
import 'katex/dist/katex.min.css'
import { WebviewSyncController } from '../../src/webview/syncController'
import { keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { liveDecorationsField } from '../../src/webview/liveDecorations'
import { getTableOptimizeStats } from '../../src/webview/tableHeightPlan'
import { tableMetricsFacet } from '../../src/webview/tableMetrics'
import '../../src/webview/main.css'

const controller = new WebviewSyncController({
  postMessage() {},
  getState() { return undefined },
  setState() {},
})
controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])
Object.assign(window, { initTable(text: string) {
  controller.handleHostMessage({ kind: 'init', sessionId: 'bq-paint',
    docUri: 'file:///bq.md', version: 1, text })
}, readEditor() {
  const view = controller.getView()
  if (!view) return { text: '', head: 0, from: 0, to: 0, line: 0, ranges: 0 }
  const head = view.state.selection.main.head
  return { text: view.state.doc.toString(), head,
    from: view.state.selection.main.from, to: view.state.selection.main.to,
    line: view.state.doc.lineAt(head).number,
    ranges: view.state.selection.ranges.length }
}, probePrefixMarks() {
  const view = controller.getView()
  if (!view) return -1
  const decos = view.state.field(liveDecorationsField, false)?.decos
  let count = 0
  decos?.between(0, view.state.doc.length, (_from, _to, value) => {
    if (typeof value.spec['class'] === 'string' && value.spec['class'].includes('vsidian-table-prefix')) count += 1
  })
  return count
}, touchEditor() {
  // #371 字号变化驱动重测：空事务触发 tableMetrics ViewPlugin 的字体签名
  // 比较（探针 refresh 为宏任务，测试侧随后轮询行内联计划的变化）
  const view = controller.getView()
  if (!view) return false
  view.dispatch({})
  return true
},
// #372 高度优化观测口（统计 + 度量就绪 + 光标移动）
tableOptimizeStats() {
  return getTableOptimizeStats()
},
tableMetricsReady() {
  const view = controller.getView()
  const metrics = view?.state.facet(tableMetricsFacet)
  return { availablePx: metrics?.availablePx ?? 0, contentPx: metrics?.contentPx ?? 0 }
},
moveCaret(pos: number) {
  const view = controller.getView()
  if (!view) return false
  view.dispatch({ selection: { anchor: pos } })
  return true
}, controller })
