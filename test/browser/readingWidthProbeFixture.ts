// 可读行宽回归 fixture（#174/#175）：真实生产控制器 + 产物 CSS，暴露
// 文档装载、模式切换、侧栏开关与设置快照注入钩子（设置走 settings.snapshot
// 与产线同消息；侧栏开关走 DOM 类，与产线按钮驱动等价——本套件测 CSS
// 布局层）。
import { WebviewSyncController } from '../../src/webview/syncController'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import '../../src/webview/main.css'

bootLocaleFromDocument()
let saved: unknown
const controller = new WebviewSyncController({
  postMessage() {},
  getState<T>() { return saved as T | undefined },
  setState(state) { saved = state },
})
controller.mount(document.getElementById('app')!)
Object.assign(window, {
  controller,
  initReadingWidth(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'rw', docUri: 'file:///rw.md', version: 1, text })
  },
  setRwMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  setRwSidebar(open: boolean) {
    document.querySelector('.vsidian-body')?.classList.toggle('vsidian-sidebar-open', open)
  },
  setRwSettings(values: Record<string, unknown>) {
    controller.handleHostMessage({ kind: 'settings.snapshot', values })
  },
})
