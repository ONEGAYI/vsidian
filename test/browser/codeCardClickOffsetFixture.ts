// 代码块卡片点击/拖选落点回归 fixture（2026-10-30 偏移修复）：真实生产
// 控制器 + 产物 CSS。Live 侧块内行的鼠标落点判定依赖 CM6 高度模型与 DOM
// 行位一致——块顶间距若由头部横带自身 margin 承担，margin 折叠出行盒、
// 不进 CM6 高度记账，块内每行 DOM 实际位置比模型低出该 margin，点击行
// 下半部即被判到下一行。本 fixture 提供只读选区读取、高度模型对拍与行
// 几何探针，不给生产控制器增添操作入口。
import { WebviewSyncController } from '../../src/webview/syncController'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import { EditorView } from '@codemirror/view'
import '../../src/webview/main.css'

bootLocaleFromDocument()
let saved: unknown
const controller = new WebviewSyncController({
  postMessage() {},
  getState<T>() { return saved as T | undefined },
  setState(state) { saved = state },
})
controller.mount(document.getElementById('app')!)

function view(): EditorView {
  return EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
}

Object.assign(window, {
  controller,
  initCode(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'code-card-offset', docUri: 'file:///code-card-offset.md', version: 1, text })
  },
  readSelection() {
    const v = view()
    const main = v.state.selection.main
    const doc = v.state.doc
    return {
      anchorLine: doc.lineAt(main.anchor).number,
      headLine: doc.lineAt(main.head).number,
    }
  },
  // 高度模型对拍：每行 {modelTop, modelH, domTop, domMinusModel}。
  // domMinusModel 是本回归的核心量——DOM 实际行位与 CM6 高度模型行位之差，
  // 块顶 margin 漏记时从块内首行起恒为该 margin 值。
  modelReport() {
    const v = view()
    const doc = v.state.doc
    const docTop = v.documentTop
    const contentEl = document.querySelector('.cm-content') as HTMLElement
    const domLines = [...contentEl.children].map((el) => {
      const r = el.getBoundingClientRect()
      return { cls: el.className, top: +r.top.toFixed(1), h: +r.height.toFixed(1),
        text: (el.textContent ?? '') }
    })
    const rows: Array<Record<string, unknown>> = []
    for (let n = 1; n <= doc.lines; n++) {
      const line = doc.line(n)
      const model = v.lineBlockAt(line.from)
      // 行文本锚定 DOM 行（呈现态围栏行内容清空，锚定相邻可匹配行）
      const dom = domLines.find((d) => d.text.includes(line.text) && line.text !== '')
      rows.push({
        n, text: line.text,
        modelTop: +model.top.toFixed(1), modelH: +model.height.toFixed(1),
        domTop: dom ? dom.top : null, domH: dom ? dom.h : null,
        domMinusModel: dom ? +(dom.top - docTop - model.top).toFixed(1) : null,
      })
    }
    return { docTop, rows }
  },
  // 行几何探针：按包含文本锚定行，返回行盒与采样点
  lineProbe(needle: string) {
    for (const el of document.querySelectorAll('.cm-line')) {
      if (!(el.textContent ?? '').includes(needle)) continue
      const box = el.getBoundingClientRect()
      return { x: box.left + box.width * 0.6, boxTop: box.top, boxH: box.height }
    }
    return null
  },
})
