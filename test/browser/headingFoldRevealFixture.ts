// 原生浏览器回归（#415，#409 T04）：落点展开（reveal 族统一机制）端到端——
// view.locate 通道（锚点跳转/搜索结果/双链/链接跳转/大纲点击的共同汇聚
// 实现 locateOffset）、查找面板真实键盘（Ctrl+F 输入命中折叠区自动展开）、
// 双模式往返折叠存续与 modeAnchor 落隐藏区的回切展开。装配生产 webview
// 控制器，定位/模式切换全走宿主消息通道（view.locate / view.mode.set），
// 折叠操作经真实键盘（keybindingRouter 注册表默认键位路由）。
import 'katex/dist/katex.min.css'
import { WebviewSyncController } from '../../src/webview/syncController'
import { headingFoldField } from '../../src/webview/headingFold'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import '../../src/webview/main.css'

const sentKinds: string[] = []

const controller = new WebviewSyncController({
  postMessage(message) {
    sentKinds.push((message as { kind: string }).kind)
  },
  getState() {
    return undefined
  },
  setState() {},
})
controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])

function mainView(): EditorView | null {
  const el = document.querySelector('.cm-editor')
  return el instanceof HTMLElement ? EditorView.findFromDOM(el) : null
}

Object.assign(window, {
  initDoc(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'heading-fold-reveal',
      docUri: 'file:///heading-fold-reveal.md', version: 1, text })
  },
  locate(offset: number, head?: number) {
    controller.handleHostMessage(head === undefined
      ? { kind: 'view.locate', offset }
      : { kind: 'view.locate', offset, head })
  },
  setMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  readEditor() {
    const view = mainView()!
    const main = view.state.selection.main
    return { text: view.state.doc.toString(), head: main.head, from: main.from, to: main.to }
  },
  /** 折叠键集快照（落点展开的可观测面：StateField 生效值） */
  foldKeys(): number[] {
    const keys = mainView()?.state.field(headingFoldField, false)
    return keys ? [...keys].sort((a, b) => a - b) : []
  },
  /** 出站编辑类消息计数（零写回断言；view.state 等观测类消息不计入） */
  editRequestCount(): number {
    return sentKinds.filter((kind) => kind === 'edit.request').length
  },
})
