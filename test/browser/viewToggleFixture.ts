// 工具栏双态视图切换按钮浏览器回归（#141）：装配生产 webview 控制器，
// 点击与 Ctrl+Q 只由真实输入发起。宿主侧 mock：view.switch.request 与
// keybindings.execute 的回环经 view.mode.set 回发（生产宿主同款驱动）。
import 'katex/dist/katex.min.css'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import '../../src/webview/main.css'

// 与生产首帧同路径装配语言岛（无岛时取词回退键名）
bootLocaleFromDocument()

const hostMessages: unknown[] = []
let persistedState: Record<string, unknown> | undefined
const bridge: VsCodeBridge = {
  postMessage(message) {
    hostMessages.push(message)
    // 生产宿主行为回环：双态切换请求/快捷键 → runViewSwitch（目标=当前态
    // 取反）→ view.mode.set 回流。fixture 无真实宿主，按同款目标推导回发
    const kind = (message as { kind?: string }).kind
    if (kind === 'view.switch.request') {
      const target = (message as { target: 'live' | 'reading' }).target
      queueMicrotask(() => {
        controller.handleHostMessage({ kind: 'view.mode.set', mode: target })
      })
    } else if (kind === 'keybindings.execute' &&
        (message as { id: string }).id === 'toggleDualView') {
      queueMicrotask(() => {
        const body = document.querySelector('.vsidian-body')
        const mode = body?.classList.contains('vsidian-mode-reading') ? 'live' : 'reading'
        controller.handleHostMessage({ kind: 'view.mode.set', mode })
      })
    }
  },
  getState<T>() {
    return persistedState as T | undefined
  },
  setState(state: unknown) {
    persistedState = state as Record<string, unknown>
  },
}
let controller = new WebviewSyncController(bridge)
controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])

function mountViewportDoc(text: string, clearState: boolean): void {
  controller.dispose()
  if (clearState) persistedState = undefined
  controller = new WebviewSyncController(bridge)
  controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])
  controller.handleHostMessage({ kind: 'init', sessionId: 'view-toggle',
    docUri: 'file:///toggle.md', version: 1, text })
}

Object.assign(window, {
  resetViewportDoc(text: string) { mountViewportDoc(text, true) },
  reloadViewportDoc(text: string) { mountViewportDoc(text, false) },
  liveCenterLine() {
    const view = controller.getView()!
    const box = view.scrollDOM.getBoundingClientRect()
    const content = view.contentDOM.getBoundingClientRect()
    const pos = view.posAtCoords({
      x: content.left + Math.min(60, content.width / 2),
      y: box.top + box.height / 2,
    })
    return pos === null ? null : view.state.doc.lineAt(pos).number
  },
  setViewportMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  initDoc(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'view-toggle',
      docUri: 'file:///toggle.md', version: 1, text })
  },
  locate(offset: number) {
    controller.handleHostMessage({ kind: 'view.locate', offset })
  },
  focusEditor() {
    EditorView.findFromDOM(document.querySelector('.cm-editor')!)!.focus()
  },
  focusReading() {
    ;(document.querySelector('.vsidian-view-reading') as HTMLElement).focus()
  },
  readHostMessages() {
    return hostMessages
  },
  /** 绘制层探针：按钮可见性（尺寸/元素命中）与图标随态（computed display）；
   * #158 起附右端组几何字段：按钮中心/工具栏中心水平坐标、与侧栏开关的
   * 水平间距（绘制层断言据此钉住「中点右侧 + gap 紧邻组成右端组」） */
  readTogglePaint() {
    const btn = document.querySelector<HTMLButtonElement>('.vsidian-view-toggle')
    if (!btn) return null
    const rect = btn.getBoundingClientRect()
    const hit = rect.width > 0 && rect.height > 0
      ? document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      : null
    const barRect = btn.closest('.vsidian-toolbar')?.getBoundingClientRect() ?? null
    const sideRect = document.querySelector('.vsidian-sidebar-toggle')
      ?.getBoundingClientRect() ?? null
    const displayOf = (cls: string) => {
      const icon = btn.querySelector(`.${cls}`)
      return icon ? getComputedStyle(icon).display : 'missing'
    }
    return {
      visible: rect.width > 0 && rect.height > 0,
      hitIsButton: !!hit && (hit === btn || btn.contains(hit)),
      bookDisplay: displayOf('vsidian-view-toggle-book'),
      editDisplay: displayOf('vsidian-view-toggle-edit'),
      aria: btn.getAttribute('aria-label'),
      title: btn.getAttribute('title'),
      centerX: rect.x + rect.width / 2,
      toolbarCenterX: barRect ? barRect.x + barRect.width / 2 : null,
      gapToSidebar: sideRect ? sideRect.left - rect.right : null,
    }
  },
  /** 工具栏按钮序（DOM 序契约） */
  toolbarOrder() {
    const bar = document.querySelector('.vsidian-toolbar')!
    return [...bar.children].map((el) => el.className)
  },
  /** mousedown 后正文焦点是否保住 */
  editorHasFocus() {
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)
    return !!view && document.activeElement === view.contentDOM
  },
})
