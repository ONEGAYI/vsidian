// #343（P3-11）外链原网页浏览器回归 fixture：装配生产 webview 控制器与
// main.ts 同款的消息守卫（不可信 iframe 来源丢弃），真实指针驱动 page
// 形态的 iframe 内容可见、滚轮滚动、退回矩阵、设置联动销毁与恶意子页
// 消息注入隔离。宿主回包经伪造通道注入（与真实 handleHostMessage 同
// 入口）；iframe 目标为本机受控 HTTP 服务器（fixture 页无 CSP，可真实
// 装载并跨源观察）。
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { HostToWebview, WebviewToHost } from '../../src/shared/protocol'
import { isHostToWebview } from '../../src/shared/protocol'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import { isTrustedHostMessageSource } from '../../src/webview/untrustedFrame'
import { keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import '../../src/webview/main.css'

bootLocaleFromDocument()

/** 出站消息观测（hover.request / hover.cancel 载荷断言 + settings.set
 *  「退回不得偷偷改设置」回归） */
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

// main.ts 同款守卫：允许清单——来源非真宿主桥（fixture 顶层页
// parent === window）的 message 一律丢弃（恶意子页 postMessage 注入
// 伪造宿主消息的隔离防线——与生产入口同构）
window.addEventListener('message', (event) => {
  if (!isTrustedHostMessageSource(event.source, event.origin)) {
    window.__webPageHostileDropped = (window.__webPageHostileDropped ?? 0) + 1
    return
  }
  controller.handleHostMessage(event.data)
})

const DOC_URI = 'file:///d%3A/notes/parent.md'

declare global {
  interface Window {
    __webPageHostileDropped?: number
  }
}

Object.assign(window, {
  /** 装配父文档（Live 起步——恶意子页伪造 view.mode.set 的可观测面） */
  initWebPageDoc(text: string) {
    controller.handleHostMessage({
      kind: 'init',
      sessionId: 'web-page',
      docUri: DOC_URI,
      version: 1,
      text,
    })
  },
  setEntryMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  /** 注入设置快照（notifyHoverExternalSettings 联动的生效面） */
  applyWebPageSettings(values: Record<string, boolean | number | string>) {
    controller.handleHostMessage({ kind: 'settings.snapshot', values })
  },
  /** 注入宿主消息（hover.result 等与真实 handleHostMessage 同入口） */
  respondHoverResult(message: HostToWebview) {
    controller.handleHostMessage(message)
  },
  /** 已出站消息快照 */
  webPageSent(): WebviewToHost[] {
    return [...sent]
  },
  /** 诊断：浏览器 bundle 内校验器对消息的判定 */
  debugValidate(message: unknown): boolean {
    return isHostToWebview(message)
  },
  /** 浮层观测（webLinkCardFixture 同款口径） */
  readHoverPopup() {
    const el = document.querySelector<HTMLElement>('.vsidian-hover-popup')
    if (!el) {
      return { open: false as const }
    }
    const stateEl = el.querySelector<HTMLElement>('.vsidian-hover-popup-state')!
    return {
      open: true as const,
      text: (el.textContent ?? '').trim(),
      stateText: (stateEl.textContent ?? '').trim(),
      stateVisible: getComputedStyle(stateEl).display !== 'none',
    }
  },
  /** 原网页视图观测：iframe 属性/尺寸/可见性与工具行文字（绘制层素材） */
  readWebPage() {
    const page = document.querySelector<HTMLElement>('.vsidian-hover-web-page')
    const frame = document.querySelector<HTMLIFrameElement>('.vsidian-hover-web-frame')
    if (!page || !frame) {
      return null
    }
    const btn = page.querySelector<HTMLButtonElement>('.vsidian-hover-web-fallback')
    const note = page.querySelector<HTMLElement>('.vsidian-hover-web-note')
    const rect = frame.getBoundingClientRect()
    const btnRect = btn?.getBoundingClientRect()
    const noteStyle = note ? getComputedStyle(note) : null
    return {
      sandbox: frame.getAttribute('sandbox') ?? '',
      referrerPolicy: frame.getAttribute('referrerpolicy') ?? '',
      src: frame.getAttribute('src') ?? '',
      allowAttr: frame.getAttribute('allow'),
      frameWidth: rect.width,
      frameHeight: rect.height,
      frameVisible: rect.width > 0 && rect.height > 0 && getComputedStyle(frame).visibility !== 'hidden',
      fallbackText: (btn?.textContent ?? '').trim(),
      fallbackVisible: btnRect !== undefined && btnRect.width > 0 && btnRect.height > 0,
      noteText: (note?.textContent ?? '').trim(),
      noteVisible: note !== null && noteStyle !== null && noteStyle.display !== 'none' &&
        noteStyle.visibility !== 'hidden' && (note.textContent ?? '').trim() !== '',
    }
  },
  /** 退回卡片观测（含自动退回原因行） */
  readWebFallbackCard() {
    const card = document.querySelector<HTMLElement>('.vsidian-hover-web-card')
    if (!card) {
      return null
    }
    const title = card.querySelector<HTMLElement>('.vsidian-hover-web-title')
    const reason = card.querySelector<HTMLElement>('.vsidian-hover-web-reason')
    const openBtn = document.querySelector('.vsidian-hover-popup .vsidian-hover-popup-open')
    const reasonStyle = reason ? getComputedStyle(reason) : null
    return {
      title: (title?.textContent ?? '').trim(),
      reasonText: (reason?.textContent ?? '').trim(),
      reasonPresent: reason !== null,
      reasonVisible: reason !== null && reasonStyle !== null && reasonStyle.display !== 'none' &&
        reasonStyle.color !== 'rgba(0, 0, 0, 0)' && reasonStyle.color !== 'transparent',
      openEntryPresent: openBtn !== null,
    }
  },
  /** Live 模式在场性（恶意子页伪造 view.mode.set 的不变量观测面） */
  liveEditorPresent(): boolean {
    return document.querySelector('.cm-content') !== null
  },
})
