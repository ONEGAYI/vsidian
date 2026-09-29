// Reading 正文嵌入浏览器回归（#222 装配基座）：装配生产 webview 控制器，
// 父文档 Reading 正文中的独占行 ![[…]] 由真实挂载链路升级为引用卡片——
// 绘制层可见性、限高内部滚动、选字复制、一层展开占位跳转与视口回收重挂
// 的状态保持在真实布局（Chromium）验证。宿主读取回包经 fixture 内伪造
// 通道注入（与真实 handleHostMessage 同入口）；hoverPreviewFixture 同模式。
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { HostToWebview, WebviewToHost } from '../../src/shared/protocol'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import { keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import '../../src/webview/main.css'

bootLocaleFromDocument()

/** 出站消息观测（hover.request 载荷断言 + 零写回断言的 edit.request 计数） */
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

Object.assign(window, {
  /** 装配父文档并切 Reading（宿主消息与生产同入口；嵌入卡片随挂载自动升级） */
  initEmbedDoc(text: string) {
    controller.handleHostMessage({
      kind: 'init',
      sessionId: 'embed-itest',
      docUri: 'file:///d%3A/notes/parent.md',
      version: 1,
      text,
    })
    controller.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
  },
  /** 已出站消息快照（hover.request / *.activate / edit.request 观测） */
  embedSent(): WebviewToHost[] {
    return [...sent]
  },
  /** 注入宿主消息（hover.result / settings.snapshot 与真实 handleHostMessage 同入口） */
  respondEmbed(message: HostToWebview) {
    controller.handleHostMessage(message)
  },
  /** 嵌入卡片观测（绘制层：可见性、边条、限高、标题、占位行与禁写态） */
  readEmbedCards() {
    const els = Array.from(document.querySelectorAll<HTMLElement>('.vsidian-embed-card'))
    return els.map((card) => {
      const rect = card.getBoundingClientRect()
      const style = getComputedStyle(card)
      const scrollEl = card.querySelector<HTMLElement>('.vsidian-embed-card-scroll')!
      const stateEl = card.querySelector<HTMLElement>('.vsidian-embed-card-state')!
      const titleEl = card.querySelector<HTMLElement>('.vsidian-embed-card-title')
      const openBtn = card.querySelector<HTMLElement>('.vsidian-embed-card-open')
      const boxes = Array.from(card.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
      const centerEl = document.elementFromPoint(
        rect.left + Math.min(rect.width / 2, 80),
        rect.top + Math.min(rect.height / 2, 24),
      )
      return {
        rect: { top: rect.top, width: rect.width, height: rect.height },
        /** 绘制层证据：卡片头部区域的命中元素落在卡片内（真实接收指针） */
        hitInside: centerEl !== null && card.contains(centerEl),
        /** 左侧引用边条（border-left 宽度与颜色） */
        barWidth: style.borderLeftWidth,
        barColor: style.borderLeftColor,
        background: style.backgroundColor,
        title: (titleEl?.textContent ?? '').trim(),
        openPresent: openBtn !== null,
        stateText: (stateEl.textContent ?? '').trim(),
        stateVisible: getComputedStyle(stateEl).display !== 'none',
        scrollClientHeight: scrollEl.clientHeight,
        scrollScrollHeight: scrollEl.scrollHeight,
        scrollMaxHeight: scrollEl.style.maxHeight || getComputedStyle(scrollEl).maxHeight,
        scrollable: scrollEl.scrollHeight > scrollEl.clientHeight,
        checkboxCount: boxes.length,
        checkboxAllDisabled: boxes.length > 0 && boxes.every((b) => b.disabled),
        /** 一层展开：卡片内的嵌入占位引用行（不嵌套卡片） */
        nestedCards: card.querySelectorAll('.vsidian-embed-card').length,
        embedRefs: Array.from(card.querySelectorAll<HTMLElement>('a.vsidian-embed-ref')).map(
          (a) => (a.textContent ?? '').trim(),
        ),
        text: (card.textContent ?? '').trim(),
        fmCollapsed: card.querySelector('.vsidian-hover-fm')?.classList.contains('vsidian-hover-fm-collapsed') ?? null,
      }
    })
  },
  /** 嵌入卡片数（父文档正文流内；视口回收后应为 0 或不含目标块） */
  embedCardCount(): number {
    return document.querySelectorAll('.vsidian-embed-card').length
  },
  /** 滚动第 idx 张卡片的内容区（限高内部滚动承载） */
  scrollEmbedCard(index: number, top: number): number {
    const scrollEl = document.querySelectorAll<HTMLElement>('.vsidian-embed-card-scroll')[index]
    if (!scrollEl) {
      return -1
    }
    scrollEl.scrollTop = top
    return scrollEl.scrollTop
  },
  /** 卡片内容滚动位置观测（回收重挂的状态保持断言） */
  embedCardScrollTop(index: number): number {
    const scrollEl = document.querySelectorAll<HTMLElement>('.vsidian-embed-card-scroll')[index]
    return scrollEl ? scrollEl.scrollTop : -1
  },
  /** 点击卡片内一层展开占位引用行（真实指针坐标点击） */
  clickEmbedRef(index: number): boolean {
    const ref = document.querySelectorAll<HTMLElement>('a.vsidian-embed-ref')[index]
    if (!ref) {
      return false
    }
    const r = ref.getBoundingClientRect()
    const target = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    if (!target || !ref.contains(target)) {
      return false
    }
    ref.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    return true
  },
  /** 卡片 fm 展开切换按钮点击（真实 DOM 点击事件） */
  clickEmbedFmToggle(index: number): boolean {
    const btn = document.querySelectorAll<HTMLElement>('.vsidian-embed-card .vsidian-hover-fm-toggle')[index]
    if (!btn) {
      return false
    }
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    return true
  },
  /** 父文档阅读容器滚动到指定偏移（视口回收场景驱动） */
  scrollReadingTo(top: number): number {
    const container = document.querySelector<HTMLElement>('.vsidian-view-reading')
    if (!container) {
      return -1
    }
    container.scrollTop = top
    return container.scrollTop
  },
  /** 在卡片内容文本上建立选区（选字复制能力的 Selection 层证据） */
  selectEmbedText(index: number, needle: string): string {
    const card = document.querySelectorAll<HTMLElement>('.vsidian-embed-card')[index]
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
  /** 当前卡片选区文本（选字复制断言） */
  embedSelection(): string {
    return window.getSelection()?.toString() ?? ''
  },
  controller,
})
