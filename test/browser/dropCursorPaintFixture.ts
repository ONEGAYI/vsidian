// 拖放落点光标原生浏览器回归（2026-10 修复）：装配生产 webview 控制器，
// 经合成 DragEvent 三段序列（dragstart → dragover → drop，均带真实字符
// 边界坐标）驱动 CM6 生产 eventObservers/domEventHandlers——CDP 鼠标序列
// 实测不触发 HTML5 拖拽（裸 mouse.down/move 只有 mousedown/mouseup、
// move 被当作拖选重选；dragAndDrop 有 dragstart/dragover 但不分发 drop），
// 合成事件是 Playwright 框架内驱动该链路的路径，断言对象仍是绘制层产物
// （.cm-dropCursor 元素与文本落位，见 dropCursorPaint.mjs 头注释）。
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

/** dragstart 时 CM6 核心填入 dataTransfer 的载荷（drop 段复用——与真实
 *  拖拽同构：drop 事件的 dataTransfer 即拖拽源携带的那份） */
let carriedText = ''

Object.assign(window, {
  initDoc(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'dropcursor',
      docUri: 'file:///dropcursor.md', version: 1, text })
  },
  /** 选区经生产 view.dispatch 设置（拖拽源=非空选区） */
  selectRange(from: number, to: number) {
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
    view.dispatch({ selection: { anchor: from, head: to } })
  },
  /** 在 offset 的字符边界坐标分发一段拖拽事件（真实布局坐标 → CM6
   *  posAtCoords 正常解析），返回分发坐标供测试断言定位容差 */
  dispatchDrag(type: 'dragstart' | 'dragover' | 'drop', offset: number) {
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
    const rect = view.coordsAtPos(offset)!
    const x = rect.left
    const y = (rect.top + rect.bottom) / 2
    const data = new DataTransfer()
    if (type === 'dragstart') {
      // 载荷由 CM6 dragstart handler 填（选区文本），分发后读取留存
      view.contentDOM.dispatchEvent(new DragEvent('dragstart', {
        bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: data,
      }))
      carriedText = data.getData('text/plain')
    } else {
      if (type === 'drop') data.setData('text/plain', carriedText)
      view.contentDOM.dispatchEvent(new DragEvent(type, {
        bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: data,
      }))
    }
    return { x, y }
  },
  /** 落点光标绘制层读数：dropCursor 扩展装配并真实定位的证据（无装配/
   *  无定位时返回 null 或 -100000px 兜底位） */
  readDropCursor() {
    const el = document.querySelector<HTMLElement>('.cm-dropCursor')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { left: r.left, top: r.top, height: r.height }
  },
  readText() {
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
    return view.state.doc.toString()
  },
})
