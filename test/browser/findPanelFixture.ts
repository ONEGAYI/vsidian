// 查找面板浏览器回归（#236）：装配生产 webview 控制器，Ctrl+F / Ctrl+H /
// Enter / Esc 只由浏览器键盘发起（keydown 注入测不到 keybindingRouter 的
// 真实分发链）。与 commentToggleFixture 同口径；替换写回经 ackLastEdit
// 模拟宿主确认。
import 'katex/dist/katex.min.css'
import { WebviewSyncController } from '../../src/webview/syncController'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import '../../src/webview/main.css'

// 与生产首帧同路径装配语言岛（无岛时取词回退键名）
bootLocaleFromDocument()

const hostMessages: unknown[] = []
const controller = new WebviewSyncController({
  postMessage(message) {
    hostMessages.push(message)
    // 生产宿主行为回环（find 族键位为本地消化，不经此通道）：
    // findOptions.set 清洗后持久化并广播 findOptions.snapshot（同值回环）
    const kind = (message as { kind?: string }).kind
    if (kind === 'findOptions.set') {
      const { options } = message as { options: { matchCase: boolean, wholeWord: boolean, regexp: boolean } }
      queueMicrotask(() => {
        controller.handleHostMessage({ kind: 'findOptions.snapshot', options })
      })
    }
  },
  getState() {
    return undefined
  },
  setState() {},
})
controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])
Object.assign(window, {
  initDoc(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'find-panel',
      docUri: 'file:///find.md', version: 1, text })
  },
  focusEditor() {
    EditorView.findFromDOM(document.querySelector('.cm-editor')!)!.focus()
  },
  locate(offset: number) {
    EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
      .dispatch({ selection: { anchor: offset } })
  },
  setViewMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  readEditor() {
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
    const main = view.state.selection.main
    return { text: view.state.doc.toString(), head: main.head, from: main.from, to: main.to }
  },
  readHostMessages() {
    return hostMessages
  },
  ackLastEdit(version: number) {
    const request = [...hostMessages].reverse().find((message) =>
      (message as { kind?: string }).kind === 'edit.request') as { seq: number } | undefined
    if (!request) throw new Error('缺少待确认的 edit.request')
    controller.handleHostMessage({ kind: 'edit.ack', seq: request.seq, ok: true, version })
  },
  /** 面板 DOM 观测：类名态 + 计数文本 + 输入框值（绘制层断言由脚本侧
   *  用 computed style 补充——此处只回报结构性状态） */
  readFindPanel() {
    const panel = document.querySelector<HTMLElement>('.vsidian-find')
    if (!panel) return null
    const input = panel.querySelector<HTMLInputElement>('.vsidian-find-input')
    const count = panel.querySelector<HTMLElement>('.vsidian-find-count')
    const replaceRow = panel.querySelector<HTMLElement>('.vsidian-find-replace')
    return {
      open: panel.classList.contains('vsidian-find-open'),
      query: input?.value ?? '',
      invalid: input?.classList.contains('vsidian-find-input-invalid') ?? false,
      count: count?.textContent ?? '',
      countEmpty: count?.classList.contains('vsidian-find-count-empty') ?? false,
      countHidden: count?.classList.contains('vsidian-find-count-hidden') ?? false,
      caseActive: panel.querySelector('.vsidian-find-case')?.classList.contains('vsidian-find-case-active') ?? false,
      wordActive: panel.querySelector('.vsidian-find-word')?.classList.contains('vsidian-find-word-active') ?? false,
      regexpActive: panel.querySelector('.vsidian-find-regexp')?.classList.contains('vsidian-find-regexp-active') ?? false,
      inSelectionActive: panel.querySelector('.vsidian-find-in-selection')?.classList.contains('vsidian-find-in-selection-active') ?? false,
      inSelectionDisabled: (panel.querySelector('.vsidian-find-in-selection') as HTMLButtonElement | null)?.disabled ?? null,
      selectionRangeMarks: document.querySelectorAll('.cm-content .vsidian-find-selection-range').length,
      replaceOpen: replaceRow?.classList.contains('vsidian-find-replace-open') ?? false,
      replaceInput: panel.querySelector<HTMLInputElement>('.vsidian-find-replace-input')?.value ?? '',
      /** live 视口内全部匹配装饰数（当前匹配装饰另计） */
      matchMarks: document.querySelectorAll('.cm-content .vsidian-find-match').length,
      currentMarks: document.querySelectorAll('.cm-content .vsidian-find-match-current').length,
      activeIsInput: document.activeElement === input,
    }
  },
})
