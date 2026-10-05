// 原生浏览器输入回归：装配生产 webview 控制器，输入只由浏览器键盘/IME 发起。
// KaTeX 样式与生产 webview 同源引入（katex.min.css 经 esbuild 字体裁剪插件
// 打包，字体产物化到 assets/）——公式场景在真实 KaTeX 样式下回归。
import 'katex/dist/katex.min.css'
import { WebviewSyncController } from '../../src/webview/syncController'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { getTableOptimizeStats } from '../../src/webview/tableHeightPlan'
import { tableMetricsFacet } from '../../src/webview/tableMetrics'
import '../../src/webview/main.css'

// 桥接 stub：记录最近一条出站消息（#81 复制链路断言依据；生产链路由宿主
// 消费，测试只观测消息形态与载荷）。#372 另计 edit.request 出站条数——
// 「布局变更零写回」的浏览器侧证据。
;(window as unknown as Record<string, unknown>)['__editRequests'] = 0
const controller = new WebviewSyncController({
  postMessage(message) {
    ;(window as unknown as Record<string, unknown>)['__lastHostMessage'] = message
    if ((message as { kind?: string }).kind === 'edit.request') {
      ;(window as unknown as { __editRequests: number })['__editRequests'] += 1
    }
  },
  getState() {
    return undefined
  },
  setState() {},
})
controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])
Object.assign(window, { initTable(text: string) {
  controller.handleHostMessage({ kind: 'init', sessionId: 'native-input',
    docUri: 'file:///table.md', version: 1, text })
}, readEditor() {
  const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
  const head = view.state.selection.main.head
  return { text: view.state.doc.toString(), head, from: view.state.selection.main.from,
    to: view.state.selection.main.to, line: view.state.doc.lineAt(head).number }
},
// #372 高度优化观测口：调度层统计（完整搜索/发布/丢弃）与度量就绪探针
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
