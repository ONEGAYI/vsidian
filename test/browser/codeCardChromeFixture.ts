// 代码块卡片浏览器 fixture（#189/#190/#191）：真实生产控制器 + 产物 CSS，
// 驱动 live/reading 双视图的卡片绘制层观测（几何对齐、按钮态与折行）。
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
  initCode(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'code-card', docUri: 'file:///code-card.md', version: 1, text })
  },
  setCodeMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
})
