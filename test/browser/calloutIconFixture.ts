// Callout 图标与容器变量浏览器 fixture（#657/T06）：真实生产控制器 +
// 产物 CSS + 真实片段通道（snippets.snapshot → SnippetLoader <link> 装配
// ——blob URL 与 asWebviewUri 同为「样式表 URL 锚定」形态，#128 同款），
// 驱动 --callout-icon 公开自定义（锁版 Lucide ID / 净化 SVG / 非法值诊断）
// 与容器变量（border/blend）的明暗主题、热更新、模式往返与视口重挂绘制
// 层验证。
import { keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
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
controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])
Object.assign(window, {
  controller,
  initIcon(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'cicon', docUri: 'file:///cicon.md', version: 1, text })
  },
  setIconMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  locateIcon(offset: number) {
    controller.handleHostMessage({ kind: 'view.locate', offset })
  },
  /** 片段 CSS 文本 → blob URL（link 装配用） */
  snippetUrl(css: string): string {
    return URL.createObjectURL(new Blob([css], { type: 'text/css' }))
  },
  /** 宿主广播路径：直接走正式消息入口 */
  applySnippets(version: number, snippets: Array<{ name: string; uri: string }>) {
    controller.handleHostMessage({ kind: 'snippets.snapshot', version, snippets })
  },
  /** 出站消息观测（装载回报等待用） */
  iconSent() { return sent },
})
