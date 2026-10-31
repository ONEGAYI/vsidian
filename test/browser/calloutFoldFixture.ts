// Callout 折叠的原生浏览器回归装配（#655/T04）：生产控制器 + 产物 CSS，
// 双模式折叠状态机（真实点击箭头 / 键位 / ui.command 三入口）、光标迁移、
// 模式往返共享状态、阅读态收起呈现（CSS display:none）、查找落点展开、
// IME 组合不被中断与零写回断言。模式切换走宿主消息（view.mode.set），
// 光标定位走 view.locate 生产链路；观测经 paint 探针（calloutFold /
// readingCalloutFold 采集体）与几何采样钩子。
import { WebviewSyncController } from '../../src/webview/syncController'
import { calloutFoldField, collectCalloutFoldPaint } from '../../src/webview/calloutFold'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import '../../src/webview/main.css'

installLocale('zh-cn', zhCn)

const sentKinds: string[] = []
// init 版本自增：宿主协议同版本 init 会被去重——多段 re-init（P2 错配
// 形态等）此前一直在旧文档上跑（断言碰巧兼容）；协议对齐后 re-init 生效
let initVersion = 0
const controller = new WebviewSyncController({
  postMessage(message) {
    sentKinds.push((message as { kind: string }).kind)
  },
  getState<T>() {
    return undefined as T | undefined
  },
  setState() {},
})
controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])

function mainView(): EditorView | null {
  const el = document.querySelector('.cm-editor')
  return el instanceof HTMLElement ? EditorView.findFromDOM(el) : null
}

function readingView(): { collectCalloutFoldPaint(): unknown } | null {
  const holder = controller as unknown as { readingView?: { collectCalloutFoldPaint(): unknown } }
  return holder.readingView ?? null
}

Object.assign(window, {
  controller,
  initCalloutFold(text: string) {
    // init 版本自增：宿主协议同版本 init 会被去重——多段 re-init（P2 错配
    // 形态等）此前一直在旧文档上跑（断言碰巧兼容）；协议对齐后 re-init 生效
    initVersion += 1
    controller.handleHostMessage({ kind: 'init', sessionId: 'callout-fold',
      docUri: 'file:///callout-fold.md', version: initVersion, text })
  },
  setCalloutFoldMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  locateCalloutFold(offset: number) {
    controller.handleHostMessage({ kind: 'view.locate', offset })
  },
  /** 键位绑定注入（真实按键路径的数据源；生产经宿主 keybindings 快照） */
  setCalloutFoldBindings() {
    controller.handleHostMessage({ kind: 'keybindings.snapshot', overrides: { calloutToggleFold: ['ctrl+alt+u'] } })
  },
  /** 命令面板路径（ui.command 回发；与键位共用 runCalloutToggleCommand） */
  runCalloutFoldCommand() {
    controller.handleHostMessage({ kind: 'ui.command', op: 'calloutToggleFold' })
  },
  openFindPanel() {
    ;(controller as unknown as { openFind(): void }).openFind()
  },
  /** 折叠状态源快照（手动翻转记录，键按升序） */
  calloutFoldOverrides(): Array<[number, { folded: boolean; declFold: string }]> {
    const field = mainView()?.state.field(calloutFoldField, false)
    return field ? [...field.entries()].sort((a, b) => a[0] - b[0]) : []
  },
  selHead(): number | null {
    return mainView()?.state.selection.main.head ?? null
  },
  /** Live 侧 callout 折叠绘制观测（生产 collectCalloutFoldPaint 采集体） */
  calloutFoldProbe() {
    const view = mainView()
    return view ? collectCalloutFoldPaint(view) : null
  },
  /** 阅读侧 callout 折叠绘制观测 */
  readingCalloutFoldProbe() {
    return readingView()?.collectCalloutFoldPaint() ?? null
  },
  /** 出站编辑消息计数（零写回断言面：折叠全程不得产生 edit.request） */
  editRequestCount(): number {
    return sentKinds.filter((kind) => kind === 'edit.request').length
  },
  /** 行可见性采样（elementFromPoint 中心命中——绘制层断言） */
  lineTextPainted(text: string): boolean {
    const lines = [...document.querySelectorAll<HTMLElement>('.cm-line')]
    const line = lines.find((el) => (el.textContent ?? '').includes(text))
    if (!line) {
      return false
    }
    const rect = line.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      return false
    }
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return !!hit && (hit === line || line.contains(hit))
  },
  /** 阅读容器内文本是否可见（含该文本的最内层元素的 elementFromPoint
   *  命中——display:none 的祖先使 rect 归零，天然构成不可见判定） */
  readingTextPainted(text: string): boolean {
    const scope = document.querySelector('.vsidian-view-reading') ?? document.body
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT)
    let node: Node | null = walker.nextNode()
    while (node) {
      if (node.textContent != null && node.textContent.includes(text)) {
        const el = node.parentElement
        if (!el) {
          return false
        }
        const rect = el.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) {
          return false
        }
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
        return !!hit && (hit === el || el.contains(hit)) && (hit.textContent ?? '').includes(text)
      }
      node = walker.nextNode()
    }
    return false
  },
})
