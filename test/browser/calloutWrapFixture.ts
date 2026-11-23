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
// T07（#675）组合验证：出站消息捕获（复制内容断言——codeblock.copy
// 经宿主桥出站，fixture 桥 no-op 但留观测量）
const posted: Array<{ kind: string; text?: string }> = []
let controller: WebviewSyncController | undefined
Object.assign(window, {
  initCallout(text: string) {
    // 每个夹具是独立文档，不能把上一夹具的光标和可滚动视口恢复到新正文。
    controller?.dispose()
    saved = undefined
    controller = new WebviewSyncController({
      postMessage(msg) { posted.push(msg as { kind: string; text?: string }) },
      getState<T>() { return saved as T | undefined },
      setState(state) { saved = state },
    })
    controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])
    Object.assign(window, { controller })
    controller.handleHostMessage({ kind: 'init', sessionId: 'callout', docUri: 'file:///callout.md', version: 1, text })
  },
  setCalloutMode(mode: 'live' | 'reading') {
    controller!.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  locateCallout(offset: number) {
    controller!.handleHostMessage({ kind: 'view.locate', offset })
  },
  /** T07：出站消息快照（复制断言用；取后不清，调用方按序取尾） */
  postedCallout() { return posted.slice() },
})
