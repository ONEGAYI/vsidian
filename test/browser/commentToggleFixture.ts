// HTML 注释浏览器回归（#139）：装配生产 webview 控制器，Ctrl+/ 只由浏览器
// 键盘发起（keydown 注入测不到 keybindingRouter 的真实分发链）。与
// symbolInputFixture 同口径。
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
    // 生产宿主行为回环：快捷键经 keybindings.execute 出站 → 宿主门控
    // （面板 active/模式/可写）后 executeCommand → 回发 format.command。
    // fixture 无真实宿主，mock 为 format 类 id 直接回发（生产同驱动链）
    const kind = (message as { kind?: string }).kind
    if (kind === 'keybindings.execute') {
      const { id } = message as { id: string }
      queueMicrotask(() => {
        controller.handleHostMessage({ kind: 'format.command', op: id as never })
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
    controller.handleHostMessage({ kind: 'init', sessionId: 'comment-toggle',
      docUri: 'file:///comment.md', version: 1, text })
  },
  locate(offset: number) {
    controller.handleHostMessage({ kind: 'view.locate', offset })
  },
  focusEditor() {
    EditorView.findFromDOM(document.querySelector('.cm-editor')!)!.focus()
  },
  setViewMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  selectRange(from: number, to: number) {
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: from, head: to } })
    view.focus()
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
  /** 绘制层探针：注释 span 与邻近正文 span 的 computed color + 元素命中 */
  readCommentPaint() {
    const comment = document.querySelector<HTMLElement>('.vsidian-html-comment')
    if (!comment) return null
    const style = getComputedStyle(comment)
    const range = document.createRange()
    const textNode = comment.firstChild
    range.setStart(textNode!, 0)
    range.setEnd(textNode!, 1)
    const rect = range.getBoundingClientRect()
    const hit = rect.width > 0 ? document.elementFromPoint(
      rect.x + rect.width / 2, rect.y + rect.height / 2) : null
    return {
      color: style.color,
      display: style.display,
      visible: rect.width > 0 && rect.height > 0,
      hitInsideComment: !!hit && comment.contains(hit),
    }
  },
  /** 阅读容器纯文本（断言注释不出现） */
  readingText() {
    const container = document.querySelector('.vsidian-view-reading')
    return container ? container.textContent ?? '' : ''
  },
})
