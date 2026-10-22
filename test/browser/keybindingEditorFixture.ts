import { WebviewSyncController } from '../../src/webview/syncController'
import { EditorView } from '@codemirror/view'
import type { WebviewToHost } from '../../src/shared/protocol'
import '../../src/webview/main.css'

const messages: unknown[] = []
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
  keyState() {
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
    return { text: view.state.doc.toString(), messages, forwarded,
      findOpen: document.querySelector('.vsidian-find')?.classList.contains('vsidian-find-open'),
      cursor: view.state.selection.main.head, gotoLineExecutions }
  },
  /** #638：设定下一次 Ctrl+G 提交的行号（null = 用户取消输入框） */
  setGotoLineTarget(line: number | null) { gotoLineTarget = line },
})
