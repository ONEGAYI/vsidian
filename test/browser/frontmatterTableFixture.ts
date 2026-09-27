// frontmatter 表格卡片真实键鼠回归（#140）：装配生产 webview 控制器，
// 输入回流（keydown 注入测不到 input.type 回流路径）、Tab/Enter 导航与
// 结构按钮点击全部由 Playwright 原生键鼠发起。
import { WebviewSyncController } from '../../src/webview/syncController'
import { keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import '../../src/webview/main.css'

// 桥接 stub：累计出站消息（edit.request 断言依据；生产链路由宿主消费）
const sent: unknown[] = []
const controller = new WebviewSyncController({
  postMessage(message) {
    sent.push(message)
  },
  getState() {
    return undefined
  },
  setState() {},
})
controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])
Object.assign(window, {
  controller,
  initFmDoc(text: string, mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'init', sessionId: 'fm-table',
      docUri: 'file:///fm.md', version: 1, text })
    if (mode === 'reading') {
      controller.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    }
  },
  fmDoc() {
    return controller.getView()!.state.doc.toString()
  },
  fmHead() {
    return controller.getView()!.state.selection.main.head
  },
  fmSent() {
    return sent
  },
  fmExternal(offset: number, length: number, text: string, version: number) {
    controller.handleHostMessage({ kind: 'doc.changed', version, origin: 'external',
      changes: [{ offset, length, text }] })
  },
})
