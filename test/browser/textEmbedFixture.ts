// 可读文本嵌入（#341 / P3-09）浏览器回归 fixture：装配生产 webview 控制器
// （与 readingEmbedFixture 同模式），父文档 Reading/Live 正文中的 ![[…]]
// 文本目标经真实挂载链路升级为引用卡片，text 载荷、token 分层与外观广播
// 由脚本经伪造通道注入（respondEmbed → handleHostMessage 同入口）——文本
// 视图绘制层（行号/计算色/视口约束）、窗口/滚动几何与只读边界的观测面。
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { HostToWebview, WebviewToHost } from '../../src/shared/protocol'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import { keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import '../../src/webview/main.css'

bootLocaleFromDocument()

const sent: WebviewToHost[] = []
const bridge: VsCodeBridge = {
  postMessage(message) {
    sent.push(message as WebviewToHost)
  },
  getState() {
    return undefined
  },
  setState() {},
}
const controller = new WebviewSyncController(bridge)
controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])

/** 主 Reading 容器（嵌入卡/Live widget 内有嵌套同名容器——观测面限定主
 *  文档正文容器，排除嵌套与 Live 侧残留） */
function mainReading(): HTMLElement | null {
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('.vsidian-view-reading'))) {
    if (!el.closest('.vsidian-embed-card') && !el.closest('.vsidian-hover-popup') &&
        !el.closest('.vsidian-live-embed')) {
      return el
    }
  }
  return null
}

Object.assign(window, {
  /** 装配父文档并切 Reading（宿主消息与生产同入口；嵌入卡片随挂载自动升级） */
  initEmbedDoc(text: string) {
    controller.handleHostMessage({
      kind: 'init',
      sessionId: 'text-embed-itest',
      docUri: 'file:///d%3A/notes/parent.md',
      version: 1,
      text,
    })
    controller.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
  },
  embedSent(): WebviewToHost[] {
    return [...sent]
  },
  respondEmbed(message: HostToWebview) {
    controller.handleHostMessage(message)
  },
  /** view.state 探针：在场嵌入卡的 text 虚拟化统计（renderedLines 受视口/
   *  窗口约束的观测面；markdown 卡为 null） */
  embedTextProbe() {
    const before = sent.length
    controller.handleHostMessage({ kind: 'view.state.request' })
    const state = sent.slice(before).find((message) => message.kind === 'view.state')
    return state?.kind === 'view.state'
      ? (state.readingEmbed ?? []).map((card) => ({
        inner: card.inner, host: card.host, state: card.state,
        internalMode: card.internalMode, liveBound: card.liveBound,
        textStats: card.textStats ?? null,
      }))
      : []
  },
  /** 文本嵌入卡观测（绘制层：行号/计算色/可见性/滚动几何/只读 chrome） */
  readTextCards() {
    const els = Array.from((mainReading() ?? document).querySelectorAll<HTMLElement>('.vsidian-embed-card'))
    return els.map((card) => {
      const scrollEl = card.querySelector<HTMLElement>(':scope > .vsidian-embed-card-scroll')!
      const stateEl = card.querySelector<HTMLElement>(':scope > .vsidian-embed-card-state')!
      const titleEl = card.querySelector<HTMLElement>(':scope > .vsidian-embed-card-header .vsidian-embed-card-title')
      const modeBtn = card.querySelector<HTMLElement>(':scope > .vsidian-embed-card-header .vsidian-embed-card-mode')
      const clip = scrollEl.getBoundingClientRect()
      const lines = Array.from(scrollEl.querySelectorAll<HTMLElement>('.vsidian-text-line'))
      const gutters = Array.from(scrollEl.querySelectorAll<HTMLElement>('.vsidian-text-gutter-line'))
      const spans = Array.from(scrollEl.querySelectorAll<HTMLElement>('.vsidian-text-line span'))
        .filter((span) => (span.textContent ?? '').length > 0)
        .map((span) => ({
          text: span.textContent ?? '',
          color: getComputedStyle(span).color,
          painted: getComputedStyle(span).visibility === 'visible' &&
            getComputedStyle(span).display !== 'none',
          inViewport: (() => {
            const box = span.getBoundingClientRect()
            return box.bottom > clip.top && box.top < clip.bottom && box.height > 0
          })(),
        }))
      return {
        title: (titleEl?.textContent ?? '').trim(),
        stateText: (stateEl.textContent ?? '').trim(),
        stateVisible: getComputedStyle(stateEl).display !== 'none',
        modeBtnHidden: modeBtn === null || getComputedStyle(modeBtn).display === 'none',
        lineCount: lines.length,
        lineTexts: lines.map((l) => (l.textContent ?? '')),
        gutterNumbers: gutters.map((g) => g.textContent ?? ''),
        spans,
        scrollTop: scrollEl.scrollTop,
        scrollHeight: scrollEl.scrollHeight,
        clientHeight: scrollEl.clientHeight,
        /** 宿主结构：表格格内卡片落在 td/th mark span 内（格仍是单 grid item） */
        inTableCell: card.closest('td, th') !== null,
        hostClass: card.parentElement?.className ?? '',
      }
    })
  },
  embedCardCount(): number {
    return (mainReading() ?? document).querySelectorAll('.vsidian-embed-card').length
  },
  scrollEmbedCard(index: number, top: number): number {
    const scrollEl = (mainReading() ?? document).querySelectorAll<HTMLElement>('.vsidian-embed-card-scroll')[index]
    if (!scrollEl) {
      return -1
    }
    scrollEl.scrollTop = top
    return scrollEl.scrollTop
  },
  embedCardScrollTop(index: number): number {
    const scrollEl = (mainReading() ?? document).querySelectorAll<HTMLElement>('.vsidian-embed-card-scroll')[index]
    return scrollEl ? scrollEl.scrollTop : -1
  },
  scrollReadingTo(top: number): number {
    const container = mainReading()
    if (!container) {
      return -1
    }
    container.scrollTop = top
    return container.scrollTop
  },
  /** 主阅读容器当前滚动位置（扫描步进的数据源——注意不能用 querySelector
   *  直取 .vsidian-view-reading：隐藏 Live 侧的嵌入卡内嵌套同名容器在
   *  DOM 序上先行，首个命中不是主滚动容器） */
  embedReadingTop(): number {
    return mainReading()?.scrollTop ?? -1
  },
  /** 滚动父文档使指定 inner 的嵌入块（独占行块或混排提升宿主）进入视口
   *  （虚拟挂载窗口驱动：离屏块不挂载，观测前先滚到位） */
  scrollToEmbedInner(inner: string): number {
    return this.scrollToEmbedOccurrence(inner, 0)
  },
  /** 同 inner 多 occurrence 的指定序号宿主定位（列表/引用/表格格内等
   *  混排宿主与独占行块共用 inner——按主阅读容器内 DOM 序取第 nth 个） */
  scrollToEmbedOccurrence(inner: string, nth: number): number {
    const root = mainReading()
    if (!root) {
      return -1
    }
    const hosts = Array.from(root.querySelectorAll<HTMLElement>('[data-vsidian-embed-inner]'))
      .filter((n) => n.dataset['vsidianEmbedInner'] === inner)
    const el = hosts[nth]
    if (!el) {
      return -1
    }
    root.scrollTop = Math.max(0, el.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - 40)
    return root.scrollTop
  },
  /** 在卡片文本上建立选区（选字复制能力的 Selection 层证据） */
  selectEmbedText(index: number, needle: string): string {
    const card = (mainReading() ?? document).querySelectorAll<HTMLElement>('.vsidian-embed-card')[index]
    if (!card) {
      return ''
    }
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT)
    let node: Node | null = null
    while ((node = walker.nextNode()) !== null) {
      if ((node.textContent ?? '').includes(needle)) {
        break
      }
    }
    if (!node) {
      return ''
    }
    const offset = (node.textContent ?? '').indexOf(needle)
    const range = document.createRange()
    range.setStart(node, offset)
    range.setEnd(node, offset + needle.length)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    return selection?.toString() ?? ''
  },
  embedSelection(): string {
    return window.getSelection()?.toString() ?? ''
  },
  /** 父文档权威文本（选字/复制/滚动不改写父正文的断言数据源） */
  parentDocText(): string {
    return controller.getView()?.state.doc.toString() ?? ''
  },
  controller,
})
