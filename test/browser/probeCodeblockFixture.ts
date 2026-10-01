// 一次性诊断探针（#241 验收反馈：代码块内无法拖选/Shift+Arrow）：
// 生产控制器 + 真实事件驱动；与 findPanelFixture 同口径。
import { WebviewSyncController } from '../../src/webview/syncController'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import '../../src/webview/main.css'

bootLocaleFromDocument()

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
    controller.handleHostMessage({ kind: 'init', sessionId: 'probe-codeblock',
      docUri: 'file:///probe.md', version: 1, text })
    // 生产宿主握手会推设置快照（multicursor 组默认开 → drawSelection 装配，
    // 选区绘制层在场）；fixture 补推对齐生产首帧装配
    controller.handleHostMessage({ kind: 'settings.snapshot', values: { 'editor.multicursor': true } })
  },
  focusEditor() {
    EditorView.findFromDOM(document.querySelector('.cm-editor')!)!.focus()
  },
  setMulticursor(on: boolean) {
    controller.handleHostMessage({ kind: 'settings.changed', values: { 'editor.multicursor': on } })
  },
  /** 字符 offset → 视口坐标（边界 +1px 落进右侧字符左半段） */
  posCoords(offset: number) {
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
    const at = view.coordsAtPos(offset)!
    return { x: at.left, y: (at.top + at.bottom) / 2 }
  },
  readEditor() {
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
    const main = view.state.selection.main
    return {
      text: view.state.doc.toString(),
      ranges: view.state.selection.ranges.map((r) => [r.from, r.to]),
      main: [main.from, main.to],
      activeIsEditor: (() => {
        const dom = view.contentDOM
        return document.activeElement !== null &&
          (dom === document.activeElement || dom.contains(document.activeElement))
      })(),
    }
  },
  /** 光标定位（不经 select 事务语义，纯诊断前置） */
  locate(offset: number) {
    EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
      .dispatch({ selection: { anchor: offset } })
  },
})
