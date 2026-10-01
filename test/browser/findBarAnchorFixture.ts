// 浮层锚点跟随回归 fixture（2026-10）：真实生产控制器 + 产物 CSS，暴露
// 文档装载、设置快照注入、模式/侧栏切换与面板开关钩子。面板开关走内部
// openFind/closeFind（键盘开合路径由 findPanel 套件覆盖，本套件只测几何
// 跟随）；选词会话走真实键盘 Ctrl+D（入口路径与 occurrence 套件同口径）。
import { WebviewSyncController } from '../../src/webview/syncController'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import '../../src/webview/main.css'

type FindPanelHost = { openFind(): void, closeFind(): void, endOccurrenceSession(): void }

const controller = new WebviewSyncController({
  postMessage() {},
  getState() {
    return undefined
  },
  setState() {},
})
const host = controller as unknown as FindPanelHost
controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])
Object.assign(window, {
  initDoc(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'fba',
      docUri: 'file:///fba.md', version: 1, text })
  },
  setSettings(values: Record<string, unknown>) {
    controller.handleHostMessage({ kind: 'settings.snapshot', values })
  },
  setMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  setSidebar(open: boolean) {
    document.querySelector('.vsidian-body')?.classList.toggle('vsidian-sidebar-open', open)
  },
  openFindPanel() {
    host.openFind()
  },
  closeFindPanel() {
    host.closeFind()
  },
  endOccurrenceSession() {
    host.endOccurrenceSession()
  },
  locate(offset: number) {
    controller.handleHostMessage({ kind: 'view.locate', offset })
  },
  focusEditor() {
    EditorView.findFromDOM(document.querySelector('.cm-editor')!)!.focus()
  },
})
