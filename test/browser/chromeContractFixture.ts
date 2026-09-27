// 界面域样式契约浏览器 fixture（#133）：真实生产控制器 + 产物 CSS +
// probe.css（chrome 探针规则按 vsidian 稳定类名书写），驱动双视图探针、
// 明暗主题切换与片段注入。模式切换走 view.mode.set（宿主同款消息）；
// 探针经 view.state.request 采集（与 obsidianAliasFixture 同模式）。
import { WebviewSyncController } from '../../src/webview/syncController'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import '../../src/webview/main.css'

bootLocaleFromDocument()
let saved: unknown
const sent: unknown[] = []
const controller = new WebviewSyncController({
  postMessage(message) { sent.push(message) },
  getState<T>() { return saved as T | undefined },
  setState(state) { saved = state },
})
controller.mount(document.getElementById('app')!)
Object.assign(window, {
  controller,
  initChromeContract(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'chrome-contract', docUri: 'file:///chrome-contract.md', version: 1, text })
  },
  setChromeContractMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  /** 触发一次探针采集并返回最近一条 view.state 的 cssProbe */
  chromeProbe(): Record<string, unknown> | undefined {
    const before = sent.length
    controller.handleHostMessage({ kind: 'view.state.request' })
    for (let i = sent.length - 1; i >= before; i--) {
      const message = sent[i] as { kind?: string; cssProbe?: Record<string, unknown> }
      if (message.kind === 'view.state' && message.cssProbe) {
        return message.cssProbe
      }
    }
    return undefined
  },
})
