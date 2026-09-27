// Obsidian 别名桥浏览器 fixture（#132）：真实生产控制器 + 产物 CSS +
// probe.css（探针规则按 Obsidian 原名书写），驱动明暗主题与双视图探针。
// 模式切换走 view.mode.set（宿主同款消息）；探针经 view.state.request 采集。
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
  initAlias(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'alias', docUri: 'file:///alias.md', version: 1, text })
  },
  setAliasMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  aliasSent() { return sent },
  /** 触发一次探针采集并返回最近一条 view.state 的 cssProbe */
  aliasProbe(): Record<string, unknown> | undefined {
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
