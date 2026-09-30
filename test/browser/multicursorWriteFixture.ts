// 多光标写操作的原生浏览器回归（#240）：真实键盘 + 鼠标驱动生产
// webview 控制器——Alt+点击/ Ctrl+Alt+方向键构造多光标（与 #237
// multicursorFixture 同口径），Shift+方向键逐 range 扩选，随后经宿主
// 命令回发链路（format.command，宿主快捷键/命令面板的真实执行通路）
// 与快速操作条按钮（真实点击）触发格式操作。
// 断言面：逐 range 应用产物、单笔 edit.request（宿主撤销一次整批回退
// 的既定语义由单事务保证）、结构性操作退化主 range、多 range 形态
// 在退化后不收敛、Tab 多光标行并集缩进（indentEditing #120 声明的
// 浏览器层实证）。
import 'katex/dist/katex.min.css'
import { WebviewSyncController } from '../../src/webview/syncController'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import '../../src/webview/main.css'

const hostMessages: unknown[] = []
const controller = new WebviewSyncController({
  postMessage(message) {
    hostMessages.push(message)
    ;(window as unknown as Record<string, unknown>)['__lastHostMessage'] = message
  },
  getState() {
    return undefined
  },
  setState() {},
})
controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])
Object.assign(window, {
  initDoc(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'multicursorWrite',
      docUri: 'file:///multicursorWrite.md', version: 1, text })
  },
  locate(offset: number) {
    controller.handleHostMessage({ kind: 'view.locate', offset })
  },
  /** 宿主命令回发链路（快捷键/命令面板经宿主执行后的真实通路） */
  formatCommand(op: string) {
    controller.handleHostMessage({ kind: 'format.command', op })
  },
  readEditor() {
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
    const main = view.state.selection.main
    return { text: view.state.doc.toString(), head: main.head, from: main.from,
      to: main.to, mainIndex: view.state.selection.mainIndex,
      ranges: view.state.selection.ranges.map((range) => ({ from: range.from, to: range.to })) }
  },
  readHostMessages() {
    return hostMessages
  },
  posCoords(offset: number) {
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
    const rect = view.coordsAtPos(offset)!
    return { x: rect.left, y: (rect.top + rect.bottom) / 2 }
  },
})
