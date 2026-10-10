// 原生浏览器回归（#419）：阅读模式标题折叠——阅读视图消费 Live 折叠
// 状态集（翻案 #416 定案 1）的端到端断言配套。装配生产 webview 控制器，
// 模式切换走宿主消息通道（view.mode.set），折叠交互由真实鼠标驱动
// （标题 hover 显现箭头、点击折叠/展开、省略号点击展开）；观测经
// view.state.paint 探针族的 readingFold 字段（生产 collectFoldPaint 采集
// 体）与几何采样钩子。Live 侧折叠经 gutter 箭头（真实鼠标同 #414 套件）。
import 'katex/dist/katex.min.css'
import { WebviewSyncController } from '../../src/webview/syncController'
import { headingFoldField } from '../../src/webview/headingFold'
import { installLocale } from '../../src/shared/i18n'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import '../../src/webview/main.css'

// 悬停词注入（生产链路经 localeBoot 数据岛装配，此处直接换测试词——
// data-tooltip 断言值可预期；同 #414 headingFoldUiFixture）
installLocale('zh-cn', {
  'headingfold.fold': '折叠此节',
  'headingfold.unfold': '展开此节',
})

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

/** 生产阅读视图实例（collectFoldPaint 采集体；私有成员经测试装配面访问） */
function readingView(): { collectFoldPaint(): unknown } | null {
  const holder = controller as unknown as { readingView?: { collectFoldPaint(): unknown } }
  return holder.readingView ?? null
}

Object.assign(window, {
  initDoc(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'heading-fold-reading',
      docUri: 'file:///heading-fold-reading.md', version: 1, text })
  },
  setMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  /** 折叠键集快照（Live StateField 生效值——两模式共享的单一事实源） */
  foldKeys(): number[] {
    const keys = mainView()?.state.field(headingFoldField, false)
    return keys ? [...keys].sort((a, b) => a - b) : []
  },
  /** 阅读态折叠绘制观测（生产 collectFoldPaint；阅读容器结构性 + 绘制层） */
  readingProbe() {
    return readingView()?.collectFoldPaint() ?? null
  },
  /** 阅读容器可见文本（隐藏块断言面：被折叠内容不得在场） */
  readingText(): string {
    const el = document.querySelector<HTMLElement>('.vsidian-view-reading')
    return el?.textContent ?? ''
  },
  /** 阅读箭头几何与可见性（真实鼠标目标；hover 显现/折叠常显断言） */
  arrowBoxes() {
    return [...document.querySelectorAll<HTMLElement>('.vsidian-view-reading .vsidian-reading-fold-arrow')]
      .map((el) => {
        const rect = el.getBoundingClientRect()
        return {
          x: rect.x, y: rect.y, w: rect.width, h: rect.height,
          visibility: getComputedStyle(el).visibility,
          collapsed: !!el.closest('.vsidian-reading-fold-collapsed'),
          tooltip: el.getAttribute('data-tooltip'),
          srcStart: el.closest('[data-vsidian-src-start]')?.getAttribute('data-vsidian-src-start') ?? null,
        }
      })
  },
  /** 首个省略号几何（点击展开目标） */
  ellipsisBox() {
    const el = document.querySelector<HTMLElement>('.vsidian-view-reading .vsidian-reading-fold-ellipsis')
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
  },
  /** 标题块可见性（含指定源 start 的标题块，elementFromPoint 中心命中） */
  headingVisibleByStart(srcStart: number): boolean {
    const el = document.querySelector<HTMLElement>(
      `.vsidian-view-reading .vsidian-reading-block[data-vsidian-src-start="${srcStart}"]`)
    if (!el) return false
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return false
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return !!hit && (hit === el || el.contains(hit))
  },
  /** 阅读正文列左缘（箭头不得侵入正文列的定位断言） */
  readingContentLeft(): number {
    const el = document.querySelector<HTMLElement>('.vsidian-view-reading .vsidian-reading-block')
    return el ? el.getBoundingClientRect().left : -1
  },
  /** 出站编辑类消息计数（零写回断言） */
  editRequestCount(): number {
    return sentKinds.filter((kind) => kind === 'edit.request').length
  },
})
