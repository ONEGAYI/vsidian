// 选下一处相同词（#238）的原生浏览器回归：装配生产 webview 控制器，
// 输入只由浏览器键盘发起（Ctrl+D 连按、Ctrl+K Ctrl+D 弦、Ctrl+Shift+L
// 全选、Esc 层级、选项条点击——keydown 注入测不到 keybindingRouter 的
// 真实分发链，含两段弦的前缀超时路径）。与 findPanelFixture 同口径：
// 光标定位经 view.locate 生产链路；drawSelection 绘制层读数（副选区可
// 见性的真实布局证据）；出站消息全量记录。
import 'katex/dist/katex.min.css'
import { WebviewSyncController } from '../../src/webview/syncController'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import '../../src/webview/main.css'

const hostMessages: unknown[] = []
const controller = new WebviewSyncController({
  postMessage(message) {
    hostMessages.push(message)
    // 生产宿主行为回环：findOptions.set 清洗后广播 findOptions.snapshot
    const kind = (message as { kind?: string }).kind
    if (kind === 'findOptions.set') {
      const { options } = message as { options: {
        matchCase: boolean, wholeWord: boolean, regexp: boolean } }
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
    controller.handleHostMessage({ kind: 'init', sessionId: 'occurrence',
      docUri: 'file:///occurrence.md', version: 1, text })
  },
  locate(offset: number) {
    controller.handleHostMessage({ kind: 'view.locate', offset })
  },
  focusEditor() {
    EditorView.findFromDOM(document.querySelector('.cm-editor')!)!.focus()
  },
  readEditor() {
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
    return {
      ranges: view.state.selection.ranges.map((range) => ({ from: range.from, to: range.to })),
      text: view.state.doc.toString(),
    }
  },
  readHostMessages() {
    return hostMessages
  },
  /** 选项条观测：在场态 + 三按钮点亮/aria + 焦点是否仍在编辑器（非模态） */
  readOccurrenceBar() {
    const bar = document.querySelector<HTMLElement>('.vsidian-occurrence-bar')
    if (!bar) return null
    const btn = (cls: string) => bar.querySelector<HTMLElement>(`.${cls}`)
    const state = (cls: string, activeCls: string) => ({
      active: btn(cls)?.classList.contains(activeCls) ?? false,
      pressed: btn(cls)?.getAttribute('aria-pressed') ?? null,
    })
    return {
      open: bar.classList.contains('vsidian-occurrence-bar-open'),
      case: state('vsidian-occurrence-case', 'vsidian-occurrence-case-active'),
      word: state('vsidian-occurrence-word', 'vsidian-occurrence-word-active'),
      regexp: state('vsidian-occurrence-regexp', 'vsidian-occurrence-regexp-active'),
      /** 非模态证据：条在场时活动焦点仍是编辑器内容区 */
      editorFocused: (() => {
        const content = document.querySelector('.cm-content')
        return !!content && document.activeElement !== null &&
          (content === document.activeElement || content.contains(document.activeElement))
      })(),
      /** 主面板开关闪烁态在场数（面板开时 Ctrl+D 的替代提示） */
      findFlashCount: document.querySelectorAll('.vsidian-find .vsidian-find-flash').length,
      findPanelOpen: !!document.querySelector('.vsidian-find')?.classList.contains('vsidian-find-open'),
    }
  },
  /** 绘制层读数：drawSelection 副选区可见性的真实布局证据（multicursor 同款） */
  readPaint() {
    const editor = document.querySelector('.cm-editor')!
    const selections = [...editor.querySelectorAll<HTMLElement>('.cm-selectionLayer .cm-selectionBackground')]
    return { selectionCount: selections.length }
  },
})
