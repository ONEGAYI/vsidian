// 引用视图同步浏览器回归（#224 装配基座）：装配生产 webview 控制器，
// 真实布局（Chromium）下验证订阅刷新链路——目标未保存修改（宿主
// hover.invalidated changed 推送）后嵌入卡片与悬停浮层静默重载、刷新
// 保持 fm 展开与滚动位置、快速连续更新无旧内容冒充、删除/恢复分态与
// 订阅生命周期（hover.watch / hover.unwatch 出站序列）。宿主读取回包与
// 失效推送经 fixture 内伪造通道注入（与真实 handleHostMessage 同入口）；
// 悬停由 Playwright 真实指针驱动（与 hoverPreview 套件同模式）。
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

/** 主 Reading 容器（排除嵌入卡片/浮层/Live 残留内的嵌套同名容器） */
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
  /** 装配父文档并切 Reading（宿主消息与生产同入口） */
  initRefreshDoc(text: string) {
    controller.handleHostMessage({
      kind: 'init',
      sessionId: 'refresh-itest',
      docUri: 'file:///d%3A/notes/parent.md',
      version: 1,
      text,
    })
    controller.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
  },
  /** 已出站消息快照（hover.request / hover.watch / hover.unwatch / edit.request 观测） */
  refreshSent(): WebviewToHost[] {
    return [...sent]
  },
  /** 注入宿主消息（hover.result / hover.invalidated 与真实 handleHostMessage 同入口） */
  respondRefresh(message: HostToWebview) {
    controller.handleHostMessage(message)
  },
  /** 嵌入卡片观测（绘制层：可见性、内容文本、状态行与 fm 折叠态） */
  readRefreshCards() {
    const els = Array.from((mainReading() ?? document).querySelectorAll<HTMLElement>('.vsidian-embed-card'))
    return els.map((card) => {
      const rect = card.getBoundingClientRect()
      const stateEl = card.querySelector<HTMLElement>('.vsidian-embed-card-state')!
      const scrollEl = card.querySelector<HTMLElement>('.vsidian-embed-card-scroll')!
      const centerEl = document.elementFromPoint(
        rect.left + Math.min(rect.width / 2, 80),
        rect.top + Math.min(rect.height / 2, 24),
      )
      return {
        hitInside: centerEl !== null && card.contains(centerEl),
        text: (card.textContent ?? '').trim(),
        stateText: (stateEl.textContent ?? '').trim(),
        stateVisible: getComputedStyle(stateEl).display !== 'none',
        contentVisible: getComputedStyle(scrollEl).display !== 'none',
        scrollTop: scrollEl.scrollTop,
        fmCollapsed: card.querySelector('.vsidian-hover-fm')?.classList.contains('vsidian-hover-fm-collapsed') ?? null,
      }
    })
  },
  /** 滚动第 idx 张卡片内容区（刷新滚动保持场景驱动） */
  scrollRefreshCard(index: number, top: number): number {
    const scrollEl = (mainReading() ?? document).querySelectorAll<HTMLElement>('.vsidian-embed-card-scroll')[index]
    if (!scrollEl) {
      return -1
    }
    scrollEl.scrollTop = top
    return scrollEl.scrollTop
  },
  /** 卡片 fm 展开切换（真实点击事件） */
  clickRefreshCardFm(index: number): boolean {
    const btn = (mainReading() ?? document).querySelectorAll<HTMLElement>('.vsidian-embed-card .vsidian-hover-fm-toggle')[index]
    if (!btn) {
      return false
    }
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    return true
  },
  /** 浮层观测（绘制层可见性 + 内容文本 + fm 折叠态） */
  readRefreshPopup() {
    const el = document.querySelector<HTMLElement>('.vsidian-hover-popup')
    if (!el) {
      return { open: false as const }
    }
    const rect = el.getBoundingClientRect()
    const scrollEl = el.querySelector<HTMLElement>('.vsidian-hover-popup-scroll')!
    const centerEl = document.elementFromPoint(rect.left + rect.width / 2, rect.top + Math.min(rect.height / 2, 30))
    return {
      open: true as const,
      hitInside: centerEl !== null && el.contains(centerEl),
      text: (el.textContent ?? '').trim(),
      contentVisible: getComputedStyle(scrollEl).display !== 'none',
      scrollTop: scrollEl.scrollTop,
      fmCollapsed: el.querySelector('.vsidian-hover-fm')?.classList.contains('vsidian-hover-fm-collapsed') ?? null,
    }
  },
  /** 悬停浮层内容滚动（刷新滚动保持场景驱动） */
  scrollRefreshPopup(top: number): number {
    const scrollEl = document.querySelector<HTMLElement>('.vsidian-hover-popup .vsidian-hover-popup-scroll')
    if (!scrollEl) {
      return -1
    }
    scrollEl.scrollTop = top
    return scrollEl.scrollTop
  },
  controller,
})
