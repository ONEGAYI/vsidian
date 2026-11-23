import { WebviewSyncController } from '../../src/webview/syncController'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { registryLineTakeover } from '../../src/webview/lineCommands'
import type { WebviewToHost } from '../../src/shared/protocol'
import { installLocale } from '../../src/shared/i18n'
import { en } from '../../src/shared/locales/en'
import '../../src/webview/main.css'

installLocale('en', en)
const messages: WebviewToHost[] = []
let forwarded = 0
/** #638 宿主输入框模拟：设定用户「提交」的行号（1-based，null = 取消） */
let gotoLineTarget: number | null = 2
const gotoLineExecutions: number[] = []
const controller = new WebviewSyncController({
  postMessage(message: WebviewToHost) {
    messages.push(message)
    if (message.kind === 'keybindings.execute') {
      if (message.id === 'find') controller.handleHostMessage({ kind: 'view.find.open' })
      else if (message.id === 'findNext' || message.id === 'findPrevious')
        controller.handleHostMessage({ kind: 'view.find.step',
          direction: message.id === 'findNext' ? 'next' : 'prev' })
      else if (message.id === 'gotoLine') {
        // 宿主链路模拟：输入框提交行号后按权威文本换算出 LF 行首偏移投递
        // view.locate；取消（null）不投递——与生产 gotoLineCommand 同口径
        gotoLineExecutions.push(gotoLineTarget ?? 0)
        if (gotoLineTarget !== null) {
          const text = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
            .state.doc.toString()
          let offset = 0
          for (let n = 1; n < gotoLineTarget; n++) {
            const next = text.indexOf('\n', offset)
            if (next < 0) break
            offset = next + 1
          }
          controller.handleHostMessage({ kind: 'view.locate', offset })
        }
      }
      else controller.handleHostMessage({ kind: 'format.command', op: message.id as 'bold' })
    }
  },
  getState() { return undefined }, setState() {},
})
controller.mount(document.getElementById('app')!)
window.addEventListener('keydown', (event) => {
  if (!['Control', 'Shift', 'Alt', 'Meta'].includes(event.key)) forwarded++
})
Object.assign(window, {
  initKeys(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'keyboard-browser',
      docUri: 'file:///keyboard.md', version: 1, text })
  },
  updateKeys(overrides: Record<string, string[]>) {
    controller.handleHostMessage({ kind: 'keybindings.changed', overrides })
  },
  setMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  enableLineNumbers() {
    controller.handleHostMessage({ kind: 'settings.snapshot', values: { 'editor.lineNumbers': true } })
  },
  readPaintedLineNumbers() {
    controller.handleHostMessage({ kind: 'view.state.request' })
    const state = messages.at(-1)
    return state?.kind === 'view.state' ? state.paint?.visibleLineNumbers : undefined
  },
  ackLastEdit() {
    const request = [...messages].reverse().find((message) => message.kind === 'edit.request')
    if (!request) throw new Error('缺少待确认的 edit.request')
    controller.handleHostMessage({ kind: 'edit.ack', seq: request.seq, version: request.baseVersion + 1, ok: true })
  },
  mountMacPagingProbe(takeover: boolean) {
    const parent = document.getElementById('mac-paging')!
    const current = parent.querySelector<HTMLElement>('.cm-editor')
    if (current) EditorView.findFromDOM(current)!.destroy()
    const view = new EditorView({
      parent, doc: 'line\n'.repeat(80),
      extensions: [...(takeover ? [registryLineTakeover] : []), keymap.of(defaultKeymap),
        EditorView.theme({ '&': { height: '240px' }, '.cm-scroller': { overflow: 'auto' } })],
    })
    const anchor = view.state.doc.line(40).from
    view.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: 'center' }) })
    view.focus()
    return anchor
  },
  macPagingHead() {
    return EditorView.findFromDOM(document.querySelector('#mac-paging .cm-editor')!)!.state.selection.main.head
  },
  keyState() {
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
    return { text: view.state.doc.toString(), messages, forwarded,
      findOpen: document.querySelector('.vsidian-find')?.classList.contains('vsidian-find-open'),
      cursor: view.state.selection.main.head, gotoLineExecutions,
      // 视口指标（按行滚动断言用）：滚动容器恒为 cm-scroller；lineHeight 为
      // CM6 实测的普通行高（scrollByLine 的步长）
      scrollTop: view.scrollDOM.scrollTop, lineHeight: view.defaultLineHeight,
      maxScrollTop: view.scrollDOM.scrollHeight - view.scrollDOM.clientHeight }
  },
  /** #638：设定下一次 Ctrl+G 提交的行号（null = 用户取消输入框） */
  setGotoLineTarget(line: number | null) { gotoLineTarget = line },
})
