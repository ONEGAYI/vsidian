// T04（#672）callout 容器 BlockWrapper 浏览器 fixture：真实生产控制器 +
// 产物 CSS（wrapper 装配走 rootOwnedViewExtensions 生产路径，不经探针
// 注入），驱动结构/点击/键入/模式往返观测。光标定位经 view.locate 生产
// 链路，键盘输入落到真实焦点。
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
// init 版本自增：宿主协议同版本 init 会去重，二次装载（长文档/重置）必须
// 递增（calloutPaint 的 version 2/3 手工递增同源语义）
let initVersion = 0
Object.assign(window, {
  controller,
  initCallout(text: string) {
    initVersion += 1
    controller.handleHostMessage({ kind: 'init', sessionId: 'callout', docUri: 'file:///callout.md', version: initVersion, text })
    controller.handleHostMessage({ kind: 'view.mode.set', mode: 'live' })
  },
  setCalloutMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  locateCallout(offset: number) {
    controller.handleHostMessage({ kind: 'view.locate', offset })
  },
})
