// #259 长文档滚动到底回归 fixture：真实生产控制器 + 产物 CSS，暴露
// 文档装载与模式切换钩子（与 readingWidthProbeFixture 同惯例——设置走
// 产线消息通道，本套件测 Reading 主视图滚动几何）。
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
  initBottomReach(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'br', docUri: 'file:///br.md', version: 1, text })
  },
  setBrMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
})
