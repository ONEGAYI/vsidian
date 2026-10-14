// 多光标 IME 定稿的原生浏览器回归（#495）：CDP Input.imeSetComposition /
// Input.insertText 真实驱动 compositionstart..compositionend，双光标连续
// 键入全角句号——回归保护面（CDP 组合的 DOM selection 时序不复现错位，
// 错位的机制级钉住在 test/unit/liveInstance.test.ts 的 #495 describe；
// 口径详见 multicursorIme.mjs 头注）。与 multicursor / multicursorWrite
// 同口径：生产 WebviewSyncController 直挂页面，键盘/IME 事件原生派发。
import 'katex/dist/katex.min.css'
import { WebviewSyncController } from '../../src/webview/syncController'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import '../../src/webview/main.css'

const controller = new WebviewSyncController({
  postMessage() {},
  getState() {
    return undefined
  },
  setState() {},
})
controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])
Object.assign(window, {
  initDoc(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'multicursorIme',
      docUri: 'file:///multicursorIme.md', version: 1, text })
  },
  locate(offset: number) {
    controller.handleHostMessage({ kind: 'view.locate', offset })
  },
  readEditor() {
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
    return { text: view.state.doc.toString(),
      mainIndex: view.state.selection.mainIndex,
      ranges: view.state.selection.ranges.map((range) => ({ from: range.from, to: range.to })) }
  },
  posCoords(offset: number) {
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
    const rect = view.coordsAtPos(offset)!
    return { x: rect.left, y: (rect.top + rect.bottom) / 2 }
  },
})
