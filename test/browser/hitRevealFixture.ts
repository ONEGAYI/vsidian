// 命中显形（#251）浏览器回归：装配生产 webview 控制器，真实键盘驱动
// （Ctrl+F 键入 / Ctrl+D 追加 / Esc 关面板 / 方向键离开）验证：
// - 搜索命中 grid 行回源（行类缺席 + 竖线 computed display 可见），
//   未命中行保持网格；面板关闭恢复
// - 面板词 Ctrl+D 追加选区落在竖线上 → 行显形；关面板后停驻保持、
//   选区离开恢复（停驻先例）
// - 块级公式内命中回源（渲染 widget 退场、源码 mark 与文本可见），
//   离开恢复渲染
// 绘制层证据以 computed display 为主（类缺席只是机制，竖线真实可见
// 才是用户所见）。
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

/** 表格行观测：行类（网格行/分隔行）+ 首个管道符 span 的 computed display
 *  （display:none = 竖线隐藏；inline = 回源可见——绘制层证据） */
function tableRowStates() {
  return [...document.querySelectorAll<HTMLElement>('.cm-content .cm-line')]
    .filter((line) => line.classList.contains('vsidian-table-line'))
    .map((line) => {
      const pipe = line.querySelector<HTMLElement>('.vsidian-table-pipe')
      return {
        text: (line.textContent ?? '').trim(),
        grid: line.classList.contains('vsidian-table-grid-row'),
        delimiter: line.classList.contains('vsidian-table-grid-delimiter'),
        pipeDisplay: pipe ? getComputedStyle(pipe).display : null,
      }
    })
}

Object.assign(window, {
  initDoc(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'hit-reveal',
      docUri: 'file:///hit-reveal.md', version: 1, text })
  },
  focusEditor() {
    EditorView.findFromDOM(document.querySelector('.cm-editor')!)!.focus()
  },
  locate(offset: number) {
    controller.handleHostMessage({ kind: 'view.locate', offset })
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
  readReveal() {
    const mathRendered = document.querySelectorAll('.cm-content [data-vsidian-rendered-math]').length
    const mathSource = document.querySelectorAll('.cm-content .vsidian-math-source').length
    return {
      findOpen: !!document.querySelector('.vsidian-find')?.classList.contains('vsidian-find-open'),
      rows: tableRowStates(),
      mathRendered,
      mathSource,
      /** 公式源码行可见性（命中回源后源文在场）：渲染退场时源码行存在 */
      mathSrcTextVisible: [...document.querySelectorAll('.cm-content .cm-line')]
        .some((line) => (line.textContent ?? '').includes('target + 1')),
      occurrenceBarOpen: !!document.querySelector('.vsidian-occurrence-bar')
        ?.classList.contains('vsidian-occurrence-bar-open'),
    }
  },
})
