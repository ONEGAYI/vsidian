// 原生浏览器键盘回归（#413，#409 T02）：标题折叠五操作经注册表默认键位
// 真实生效——美式布局 Ctrl+Shift+[ / ] 的实际事件字符是 `{` / `}`（keyStep
// shift 上档符号映射的端到端验证），Ctrl+K 弦族命中切换/全量操作。装配
// 生产 webview 控制器（keybindingRouter document 捕获层本地分支接线），
// 按键只由浏览器键盘发起；光标定位经 view.locate 走生产链路。
// 「折叠内容不可见」的绘制层断言属 #414（T03 paint 探针），本套件只断言
// 操作命中（折叠键集）与文档零写回（无出站编辑消息）。
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
    controller.handleHostMessage({ kind: 'init', sessionId: 'heading-fold-keys',
      docUri: 'file:///heading-fold-keys.md', version: 1, text })
  },
  locate(offset: number) {
    controller.handleHostMessage({ kind: 'view.locate', offset })
  },
  setMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  readEditor() {
    const view = mainView()!
    const main = view.state.selection.main
    return { text: view.state.doc.toString(), head: main.head, from: main.from, to: main.to }
  },
  /** 折叠键集快照（操作命中的可观测面：StateField 生效值） */
  foldKeys(): number[] {
    const keys = mainView()?.state.field(headingFoldField, false)
    return keys ? [...keys].sort((a, b) => a - b) : []
  },
  /** 出站编辑类消息计数（零写回断言；view.state 等观测类消息不计入） */
  editRequestCount(): number {
    return sentKinds.filter((kind) => kind === 'edit.request').length
  },
})
