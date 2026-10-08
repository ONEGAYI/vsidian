// 标题折叠 UI 的原生浏览器回归装配（#414，#409 T03）：gutter 箭头（悬停
// 显现/折叠态常显）、省略号占位与 paint 探针的绘制层断言配套。装配生产
// webview 控制器 + 双实例（主编辑器 + 第二独立 Live 实例——嵌入/悬停卡
// 内 Live 共用 liveInstance 扩展装配，实例独立折叠态的机制面由此钉住）。
// 交互全部由真实鼠标驱动（move/click）；观测经 view.state.paint 探针族
// 的 headingFold 字段与几何采样钩子。
import 'katex/dist/katex.min.css'
import { WebviewSyncController } from '../../src/webview/syncController'
import { collectHeadingFoldPaint, headingFoldField } from '../../src/webview/headingFold'
import { installLocale } from '../../src/shared/i18n'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import '../../src/webview/main.css'

// 悬停词注入（生产链路经 localeBoot 数据岛装配，此处直接换测试词——
// data-tooltip 断言值可预期）
installLocale('zh-cn', {
  'headingfold.fold': '折叠此节',
  'headingfold.unfold': '展开此节',
})

const sentKinds: string[] = []
function buildController(): WebviewSyncController {
  return new WebviewSyncController({
    postMessage(message) {
      sentKinds.push((message as { kind: string }).kind)
    },
    getState() {
      return undefined
    },
    setState() {},
  })
}

const controller = buildController()
controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])

const controller2 = buildController()
controller2.mount(document.getElementById('app2')!, [keymap.of(defaultKeymap)])

/** 主编辑器域限定（#app）：第二实例 #app2 共存，document 级查询会被
 *  其 .cm-lineNumbers/.vsidian-fold-arrow 等同类元素污染 */
const APP_ROOT_ID = 'app'

function mainView(root: ParentNode = document.getElementById(APP_ROOT_ID)!): EditorView | null {
  const el = root.querySelector('.cm-editor')
  return el instanceof HTMLElement ? EditorView.findFromDOM(el) : null
}

Object.assign(window, {
  initDoc(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'heading-fold-ui',
      docUri: 'file:///heading-fold-ui.md', version: 1, text })
  },
  initDoc2(text: string) {
    controller2.handleHostMessage({ kind: 'init', sessionId: 'heading-fold-ui-2',
      docUri: 'file:///heading-fold-ui-2.md', version: 1, text })
  },
  locate(offset: number) {
    controller.handleHostMessage({ kind: 'view.locate', offset })
  },
  setSettings(values: Record<string, unknown>) {
    controller.handleHostMessage({ kind: 'settings.snapshot', values })
  },
  setBodyDark(on: boolean) {
    document.body.classList.toggle('vscode-dark', on)
  },
  foldKeys(): number[] {
    const keys = mainView()?.state.field(headingFoldField, false)
    return keys ? [...keys].sort((a, b) => a - b) : []
  },
  foldKeys2(): number[] {
    const keys = mainView(document.getElementById('app2')!)?.state.field(headingFoldField, false)
    return keys ? [...keys].sort((a, b) => a - b) : []
  },
  /** paint 探针（生产 collectHeadingFoldPaint 采集体；浏览器有布局，
   *  visible 类字段为绘制层断言依据） */
  probe() {
    const view = mainView()
    return view ? collectHeadingFoldPaint(view) : null
  },
  /** 正文列（.cm-content）与滚动几何采样 */
  contentBox() {
    const view = mainView()!
    const rect = view.contentDOM.getBoundingClientRect()
    return { left: rect.left, right: rect.right, scrollTop: view.scrollDOM.scrollTop }
  },
  /** 全部箭头的几何与可见性（折叠态/悬停态分别采样） */
  arrowBoxes() {
    return [...document.getElementById(APP_ROOT_ID)!.querySelectorAll<HTMLElement>('.vsidian-fold-gutter .vsidian-fold-arrow')]
      .map((el) => {
        const rect = el.getBoundingClientRect()
        return {
          x: rect.x, y: rect.y, w: rect.width, h: rect.height,
          visibility: getComputedStyle(el).visibility,
          collapsed: el.classList.contains('vsidian-fold-arrow-collapsed'),
          tooltip: el.getAttribute('data-tooltip'),
          expanded: el.getAttribute('aria-expanded'),
        }
      })
  },
  /** 行号列右缘（无列为 null——行号关态） */
  lineNumberColumnRight(): number | null {
    const el = document.getElementById(APP_ROOT_ID)!.querySelector<HTMLElement>('.cm-lineNumbers')
    return el ? el.getBoundingClientRect().right : null
  },
  /** 标题行可见性（含指定文本的首个标题行，elementFromPoint 中心命中） */
  headingVisible(text: string): boolean {
    const lines = [...document.getElementById(APP_ROOT_ID)!.querySelectorAll<HTMLElement>('.vsidian-heading-line')]
    const line = lines.find((el) => (el.textContent ?? '').includes(text))
    if (!line) return false
    const rect = line.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return false
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return !!hit && (hit === line || line.contains(hit))
  },
  /** 省略号占位几何 */
  ellipsisBox() {
    const el = document.getElementById(APP_ROOT_ID)!.querySelector<HTMLElement>('.vsidian-fold-ellipsis')
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
  },
  editRequestCount(): number {
    return sentKinds.filter((kind) => kind === 'edit.request').length
  },
})
