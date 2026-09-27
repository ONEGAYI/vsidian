// 符号自动补全浏览器回归（#123）：装配生产 webview 控制器（补全扩展经
// syncController extensions 进入，位于 tableEditing 之后），按键只由浏览器
// 键盘/CDP IME 发起。光标定位经 view.locate 消息走生产链路；粘贴经真实
// 剪贴板快捷键（Control+v）。与 tabIndentFixture 同口径。
import 'katex/dist/katex.min.css'
import { WebviewSyncController } from '../../src/webview/syncController'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import '../../src/webview/main.css'

const controller = new WebviewSyncController({
  postMessage(message) {
    ;(window as unknown as Record<string, unknown>)['__lastHostMessage'] = message
  },
  getState() {
    return undefined
  },
  setState() {},
})
controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])
Object.assign(window, {
  initDoc(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'symbol-input',
      docUri: 'file:///symbol.md', version: 1, text })
  },
  locate(offset: number) {
    controller.handleHostMessage({ kind: 'view.locate', offset })
  },
  setSymbolAutocomplete(on: boolean) {
    controller.handleHostMessage({ kind: 'settings.changed',
      values: { 'editor.symbolAutocomplete': on } })
  },
  setSymbolSelectionWrap(on: boolean) {
    controller.handleHostMessage({ kind: 'settings.changed',
      values: { 'editor.symbolSelectionWrap': on } })
  },
  setSymbolTabEscape(on: boolean) {
    controller.handleHostMessage({ kind: 'settings.changed',
      values: { 'editor.symbolTabEscape': on } })
  },
  readEditor() {
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
    const main = view.state.selection.main
    return { text: view.state.doc.toString(), head: main.head, from: main.from,
      to: main.to,
      // #124 多 range 原文选区（跨段包裹产物）的完整回报
      ranges: view.state.selection.ranges.map((range) => ({ from: range.from, to: range.to })) }
  },
})
