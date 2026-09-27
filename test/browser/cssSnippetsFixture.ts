import { keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { WebviewSyncController } from '../../src/webview/syncController'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import '../../src/webview/main.css'

// CSS 片段浏览器回归 fixture（#128）：真实 WebviewSyncController + 真实
// <link> 装配（片段 CSS 经 blob URL 加载——宿主同形 CSP 复刻页内无 vscode
// 资源服务，blob: 与 asWebviewUri 同为「样式表 URL 锚定」形态）。宿主方向
// 消息一律经 controller.handleHostMessage 正式入口（snippets.get 拉取路径
// 与 snippets.snapshot 广播路径都真实走到）。
bootLocaleFromDocument()
let saved: unknown
const sent: unknown[] = []
const controller = new WebviewSyncController({
  postMessage(message) { sent.push(message) },
  getState<T>() { return saved as T | undefined },
  setState(state) { saved = state },
})
controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])
Object.assign(window, {
  controller,
  initSnip(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'snip', docUri: 'file:///snip.md', version: 1, text })
  },
  /** 片段 CSS 文本 → blob URL（link 装配用；相对路径语义与文件 URL 同构） */
  snippetUrl(css: string): string {
    return URL.createObjectURL(new Blob([css], { type: 'text/css' }))
  },
  /** 宿主广播路径：直接走正式消息入口 */
  applySnippets(version: number, snippets: Array<{ name: string; uri: string }>) {
    controller.handleHostMessage({ kind: 'snippets.snapshot', version, snippets })
  },
  snipSent() { return sent },
})
