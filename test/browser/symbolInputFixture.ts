// 符号自动补全浏览器回归（#123）：装配生产 webview 控制器（补全扩展经
// syncController extensions 进入，位于 tableEditing 之后），按键只由浏览器
// 键盘/CDP IME 发起。光标定位经 view.locate 消息走生产链路；粘贴经真实
// 剪贴板快捷键（Control+v）。与 tabIndentFixture 同口径。
import 'katex/dist/katex.min.css'
import { WebviewSyncController } from '../../src/webview/syncController'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import '../../src/webview/main.css'

const hostMessages: unknown[] = []
const controller = new WebviewSyncController({
  postMessage(message) {
    hostMessages.push(message)
    ;(window as unknown as Record<string, unknown>)['__lastHostMessage'] = message
  },
  getState() {
    return undefined
  },
  setState() {},
})
controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])
// #597 渲染帧采样探针（paint 中间态钉子）：每个渲染帧（rAF 回调时点）
// 采样用户可见文本（.cm-content 的 textContent——视觉层断言对象，非
// state.doc 存在性）。契约：原始字符与兜底闭合在同一事件循环任务内
// 完成（微任务先于渲染），任何帧的可见文本只能是初始或终态形态——
// 出现中间态（如 '中(' 无闭合、包裹半成品）即两笔跨帧、契约被破坏。
const frameSamples: string[] = []
const sampleFrame = () => {
  const content = document.querySelector('.cm-content')
  if (content) {
    frameSamples.push(content.textContent ?? '')
  }
  requestAnimationFrame(sampleFrame)
}
requestAnimationFrame(sampleFrame)
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
  readHostMessages() {
    return hostMessages
  },
  /** 单独确认最后一笔 edit.request（不撤销）——多笔连续出站场景的 ack
   *  收敛点：在途请求未确认时后续暂缓段留守，确认后才依次出站 */
  ackLastEdit(version: number) {
    const request = [...hostMessages].reverse().find((message) =>
      (message as { kind?: string }).kind === 'edit.request') as { seq: number } | undefined
    if (!request) throw new Error('缺少待确认的 edit.request')
    controller.handleHostMessage({ kind: 'edit.ack', seq: request.seq, ok: true, version })
  },
  resetFrameSamples() {
    frameSamples.length = 0
  },
  readFrameSamples() {
    return [...frameSamples]
  },
  ackAndExternalUndo(changes: { offset: number; length: number; text: string }[], version: number) {
    const request = [...hostMessages].reverse().find((message) =>
      (message as { kind?: string }).kind === 'edit.request') as { seq: number } | undefined
    if (!request) throw new Error('缺少待确认的 edit.request')
    controller.handleHostMessage({ kind: 'edit.ack', seq: request.seq, ok: true, version })
    controller.handleHostMessage({ kind: 'doc.changed', version: version + 1, origin: 'external', changes })
  },
  // 光标偏移的视口坐标（P2-8 多光标场景：把真实鼠标点击对准字符边界，
  // Ctrl+click 添加光标的落点才可复现）
  posCoords(offset: number) {
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
    const rect = view.coordsAtPos(offset)!
    return { x: rect.left, y: (rect.top + rect.bottom) / 2 }
  },
})
