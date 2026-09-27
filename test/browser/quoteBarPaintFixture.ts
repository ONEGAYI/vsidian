// 引用块紫色提示边条浏览器 fixture（#143）：真实生产控制器 + 产物 CSS，
// 驱动 live/reading 双视图的竖条颜色绘制层观测（模式切换走 view.mode.set，
// 与宿主同款消息）。
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
  initQuote(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'quote', docUri: 'file:///quote.md', version: 1, text })
  },
  setQuoteMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
})
