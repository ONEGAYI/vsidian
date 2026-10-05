// #342（P3-10）外链卡片浏览器回归 fixture：装配生产 webview 控制器，
// 真实指针/键盘驱动 Reading 与 Live 的 http(s) 链接悬停——开关门控
//（关闭态零请求）、web 载荷卡片的实际文字内容、失败分态与打开入口、
// loading 态关闭的 hover.cancel 出站。宿主回包经伪造通道注入（与真实
// handleHostMessage 同入口）；hoverEntryFixture 同装配模式。
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { HostToWebview, WebviewToHost } from '../../src/shared/protocol'
import { isHostToWebview } from '../../src/shared/protocol'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import { keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import '../../src/webview/main.css'

bootLocaleFromDocument()

/** 出站消息观测（hover.request / hover.cancel 载荷断言 + link.activate 回归） */
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

const DOC_URI = 'file:///d%3A/notes/parent.md'

Object.assign(window, {
  /** 装配父文档（Live 起步） */
  initWebLinkDoc(text: string) {
    controller.handleHostMessage({
      kind: 'init',
      sessionId: 'web-link',
      docUri: DOC_URI,
      version: 1,
      text,
    })
  },
  setEntryMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  /** 注入设置快照（hover.externalEnabled 的生效面） */
  applyWebLinkSettings(values: Record<string, boolean | number | string>) {
    controller.handleHostMessage({ kind: 'settings.snapshot', values })
  },
  /** 注入宿主消息（hover.result 等与真实 handleHostMessage 同入口） */
  respondHoverResult(message: HostToWebview) {
    controller.handleHostMessage(message)
  },
  /** 已出站消息快照 */
  webLinkSent(): WebviewToHost[] {
    return [...sent]
  },
  /** 诊断：浏览器 bundle 内校验器对消息的判定（web 形态诊断用） */
  debugValidate(message: unknown): boolean {
    return isHostToWebview(message)
  },
  /** 浮层观测（hoverEntryFixture 同款口径） */
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
  /** web 卡片观测：实际文字内容与安全链接（绘制层断言素材） */
  readWebCard() {
    const card = document.querySelector<HTMLElement>('.vsidian-hover-web-card')
    if (!card) {
      return null
    }
    const title = card.querySelector<HTMLElement>('.vsidian-hover-web-title')
    const desc = card.querySelector<HTMLElement>('.vsidian-hover-web-desc')
    const domain = card.querySelector<HTMLAnchorElement>('.vsidian-hover-web-domain')
    const links = [...card.querySelectorAll('a')]
    const rect = card.getBoundingClientRect()
    return {
      title: (title?.textContent ?? '').trim(),
      titleVisible: title !== null && getComputedStyle(title).display !== 'none' &&
        (title.textContent ?? '').trim() !== '',
      desc: (desc?.textContent ?? '').trim(),
      descPresent: desc !== null,
      domain: (domain?.textContent ?? '').trim(),
      domainHref: domain?.getAttribute('href') ?? '',
      linkCount: links.length,
      cardWidth: rect.width,
      cardHeight: rect.height,
    }
  },
})
