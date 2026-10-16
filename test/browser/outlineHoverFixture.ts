// 原生浏览器悬停回归（#99）：装配生产 webview 控制器，光标形态与悬停
// 高亮由真实布局验证——jsdom 无布局测不了的 :hover 伪类着色、color-mix
// 浅一档色阶、located 优先不叠加在此落地。
// #577 追加：大纲条目 Ctrl 悬停弹出标题引用浮窗（directTarget 载荷、
// 补触发、松开/移出时序、openAction 跳转、重渲染释放）——出站消息观测
// 与宿主回包注入与 hoverEntryFixture 同款形态。
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { HostToWebview, WebviewToHost } from '../../src/shared/protocol'
import { keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import '../../src/webview/main.css'

/** 出站消息观测（#577 hover.request 载荷断言） */
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

const DOC_URI = 'file:///d%3A/notes/outline.md'
const DOC_FS_PATH = 'd:\\notes\\outline.md'

/** 大纲面板观测（断言用户看到的东西：条目 computed 背景与光标形态；
 *  悬停态由 Playwright locator.hover 真实驱动，不做类名存在性断言） */
function readOutline() {
  const items = [...document.querySelectorAll<HTMLElement>('.vsidian-outline-item')]
  return {
    count: items.length,
    texts: items.map((el) => el.textContent ?? ''),
    locatedIndex: items.findIndex((el) => el.classList.contains('vsidian-outline-located')),
    bg: (n: number) => getComputedStyle(items[n]!).backgroundColor,
    cursor: (n: number) => getComputedStyle(items[n]!).cursor,
  }
}

Object.assign(window, {
  initOutline(text: string) {
    controller.handleHostMessage({
      kind: 'init', sessionId: 'outline-hover', docUri: DOC_URI, fsPath: DOC_FS_PATH,
      version: 1, text,
    })
  },
  /** 注入宿主消息（hover.result 等与真实 handleHostMessage 同入口） */
  respondHoverResult(message: HostToWebview) {
    controller.handleHostMessage(message)
  },
  /** 注入设置快照（hover.outlinePreview / hover.enabled 生效面） */
  applyOutlineSettings(values: Record<string, boolean | number | string>) {
    controller.handleHostMessage({ kind: 'settings.snapshot', values })
  },
  /** 已出站消息快照 */
  hoverSent(): WebviewToHost[] {
    return [...sent]
  },
  /** 浮层观测（与 hoverEntryFixture 同款：绘制层可见性、几何、内容） */
  readHoverPopup() {
    const el = document.querySelector<HTMLElement>('.vsidian-hover-popup')
    if (!el) {
      return { open: false as const }
    }
    const rect = el.getBoundingClientRect()
    const centerTopEl = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + Math.min(rect.height / 2, 30),
    )
    return {
      open: true as const,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      hitInside: centerTopEl !== null && el.contains(centerTopEl),
      text: (el.textContent ?? '').trim(),
      hasOpenButton: el.querySelector('.vsidian-hover-popup-open') !== null,
    }
  },
  /** 浮窗标题条「打开」按钮点击（openAction 执行面；无浮窗 false） */
  clickHoverOpenButton() {
    const btn = document.querySelector<HTMLButtonElement>('.vsidian-hover-popup-open')
    if (!btn) {
      return false
    }
    btn.click()
    return true
  },
  controller,
  readOutline,
})
