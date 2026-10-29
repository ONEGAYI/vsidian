// Callout 浏览器 fixture（#653/T02）：真实生产控制器 + 产物 CSS，驱动
// live/reading 双视图的 callout 形态与绘制层观测（模式切换走 view.mode.set，
// 与宿主同款消息）。光标定位经 view.locate 生产链路（multicursor 同款
// 口径），键盘输入落到真实焦点。
import { WebviewSyncController } from '../../src/webview/syncController'
import { keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import '../../src/webview/main.css'

bootLocaleFromDocument()
let saved: unknown
const controller = new WebviewSyncController({
  postMessage() {},
  getState<T>() { return saved as T | undefined },
  setState(state) { saved = state },
})
controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])
Object.assign(window, {
  controller,
  initCallout(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'callout', docUri: 'file:///callout.md', version: 1, text })
  },
  setCalloutMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  locateCallout(offset: number) {
    controller.handleHostMessage({ kind: 'view.locate', offset })
  },
})
