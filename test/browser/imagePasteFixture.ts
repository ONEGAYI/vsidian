// 图片粘贴浏览器回归（#161）：真实 ClipboardEvent（Chromium 构造
// DataTransfer + File）驱动生产控制器的 paste 拦截链——守卫矩阵（总开关/
// 阅读模式/IME 组合/纯文本放行）、图片优先于文本、出站载荷形态、结果
// 插入（单事务 + 陈旧 reqId 丢弃）。与 commentToggleFixture 同口径。
import 'katex/dist/katex.min.css'
import { WebviewSyncController } from '../../src/webview/syncController'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import '../../src/webview/main.css'

bootLocaleFromDocument()

const hostMessages: unknown[] = []
const controller = new WebviewSyncController({
  postMessage(message) {
    hostMessages.push(message)
  },
  getState() {
    return undefined
  },
  setState() {},
})
controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])

function findView(): EditorView {
  return EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
}

Object.assign(window, {
  initDoc(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'image-paste',
      docUri: 'file:///d/note.md', version: 1, text })
  },
  locate(offset: number) {
    controller.handleHostMessage({ kind: 'view.locate', offset })
  },
  focusEditor() {
    findView().focus()
  },
  selectRange(from: number, to: number) {
    const view = findView()
    view.dispatch({ selection: { anchor: from, head: to } })
    view.focus()
  },
  setViewMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  /** 注入设置快照（总开关等） */
  applySettings(values: Record<string, unknown>) {
    controller.handleHostMessage({ kind: 'settings.snapshot', values })
  },
  /** 派发真实 ClipboardEvent('paste') 到 .cm-content；返回 defaultPrevented */
  firePaste(items: Array<{ kind: 'file' | 'string'; type: string; name?: string; bytes?: number[]; text?: string }>): boolean {
    const dt = new DataTransfer()
    for (const item of items) {
      if (item.kind === 'file') {
        dt.items.add(new File([new Uint8Array(item.bytes ?? [1, 2, 3])], item.name ?? 'image.png', { type: item.type }))
      } else {
        dt.setData(item.type, item.text ?? '')
      }
    }
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt })
    document.querySelector('.cm-content')!.dispatchEvent(event)
    return event.defaultPrevented
  },
  /** 派发 compositionstart/compositionend 到 .cm-content（IME 组合态窗口） */
  fireComposition(phase: 'start' | 'end') {
    const target = document.querySelector('.cm-content')!
    target.dispatchEvent(new CompositionEvent(phase === 'start' ? 'compositionstart' : 'compositionend', { bubbles: true, data: '中' }))
  },
  readEditor() {
    const view = findView()
    const main = view.state.selection.main
    return { text: view.state.doc.toString(), head: main.head, from: main.from, to: main.to }
  },
  readHostMessages() {
    return hostMessages
  },
  /** 模拟宿主回发 image.paste.result（默认路由最后一条出站的 reqId） */
  respondImagePaste(ok: boolean, markdown: string, reqIdOverride?: number) {
    const requests = hostMessages.filter((m) => (m as { kind?: string }).kind === 'image.paste') as Array<{ reqId: number }>
    const last = requests[requests.length - 1]
    if (!last) throw new Error('缺少待响应的 image.paste')
    controller.handleHostMessage({
      kind: 'image.paste.result',
      reqId: reqIdOverride ?? last.reqId,
      ...(ok ? { ok: true, markdown } : { ok: false, reason: 'invalid-location' }),
    } as never)
  },
  ackLastEdit(version: number) {
    const request = [...hostMessages].reverse().find((message) =>
      (message as { kind?: string }).kind === 'edit.request') as { seq: number } | undefined
    if (!request) throw new Error('缺少待确认的 edit.request')
    controller.handleHostMessage({ kind: 'edit.ack', seq: request.seq, ok: true, version })
  },
})
