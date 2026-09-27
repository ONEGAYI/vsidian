// frontmatter 只读表格 + Popover 编辑真实键鼠回归（#140 Popover 改版）：
// 装配生产 webview 控制器，输入回流（keydown 注入测不到 input.type 回流
// 路径）、Popover 开闭与输入、光标引导全部由 Playwright 原生键鼠发起。
import { WebviewSyncController } from '../../src/webview/syncController'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import { keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import '../../src/webview/main.css'

// 装配生产中文包：标题栏/按钮文案与字典同源（t() 断言依据）
installLocale('zh-cn', zhCn)


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
  /** Popover 开态（真实 DOM 在场判定） */
  fmPopoverOpen() {
    return document.querySelector('.vsidian-fm-popover') !== null
  },
})
