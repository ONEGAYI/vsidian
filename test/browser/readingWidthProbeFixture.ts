// 诊断探针 fixture（视窗宽度 bug 回路）：真实生产控制器 + 产物 CSS，
// 引导 live/reading 双视图后暴露宽度观测钩子（模式切换与侧栏开关走 DOM
// 类，与产线驱动方式等价——本探针只测 CSS 布局层，不测交互链）。
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
  setRwLineWidth(value: string) {
    const app = document.getElementById('app')!
    if (value === '') app.style.removeProperty('--file-line-width')
    else app.style.setProperty('--file-line-width', value)
  },
})
