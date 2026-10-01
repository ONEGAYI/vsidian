// 多光标基础设施的原生浏览器回归（#237）：装配生产 webview 控制器，
// 输入只由浏览器键盘/鼠标发起（Alt+点击、Ctrl+Alt+方向键、Esc、键入）。
// 与 symbolInputFixture 同口径：光标定位经 view.locate 生产链路，坐标点击
// 用 posCoords 对准字符边界；另暴露绘制层读数（drawSelection 的
// .cm-cursor / .cm-selectionBackground 元素计数与几何——副光标可见性的
// 真实布局证据）与出站消息全量记录（链接不误跳的断言依据）。
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
Object.assign(window, {
  initDoc(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'multicursor',
      docUri: 'file:///multicursor.md', version: 1, text })
  },
  locate(offset: number) {
    controller.handleHostMessage({ kind: 'view.locate', offset })
  },
  setMulticursor(on: boolean) {
    controller.handleHostMessage({ kind: 'settings.changed',
      values: { 'editor.multicursor': on } })
  },
  /** 快捷键注册表生效绑定改写（清空 = overrides 空数组，生产链路同款） */
  setKeybindings(overrides: Record<string, string[]>) {
    controller.handleHostMessage({ kind: 'keybindings.snapshot', overrides })
  },
  readEditor() {
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
    const main = view.state.selection.main
    return { text: view.state.doc.toString(), head: main.head, from: main.from,
      to: main.to,
      ranges: view.state.selection.ranges.map((range) => ({ from: range.from, to: range.to })) }
  },
  readHostMessages() {
    return hostMessages
  },
  // 光标偏移的视口坐标（Alt+点击落点对准字符边界，与字体渲染宽度解耦）
  posCoords(offset: number) {
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
    const rect = view.coordsAtPos(offset)!
    return { x: rect.left, y: (rect.top + rect.bottom) / 2 }
  },
  /** 绘制层读数：drawSelection 装配与副光标可见性的真实布局证据
   * （元素计数 + 首个光标高度；多光标关闭时层不在场为 0） */
  readPaint() {
    const editor = document.querySelector('.cm-editor')!
    const cursors = [...editor.querySelectorAll<HTMLElement>('.cm-cursorLayer .cm-cursor')]
    const selections = [...editor.querySelectorAll<HTMLElement>('.cm-selectionLayer .cm-selectionBackground')]
    return {
      cursorCount: cursors.length,
      firstCursorHeight: cursors[0]?.getBoundingClientRect().height ?? 0,
      cursorLayerPresent: !!editor.querySelector('.cm-cursorLayer'),
      selectionCount: selections.length,
    }
  },
})
