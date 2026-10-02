// 引用块内表格绘制回归（#296 真机报障）：装配生产 webview 控制器，
// 断言落在真实布局（同行格同水平带、列序、竖条计算值），防「存在性
// 断言全绿但布局断裂」的盲区复发。
import 'katex/dist/katex.min.css'
import { WebviewSyncController } from '../../src/webview/syncController'
import { keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
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
  if (!view) return { text: '', head: 0, from: 0, to: 0, line: 0 }
  const head = view.state.selection.main.head
  return { text: view.state.doc.toString(), head,
    from: view.state.selection.main.from, to: view.state.selection.main.to,
    line: view.state.doc.lineAt(head).number }
}, controller })
