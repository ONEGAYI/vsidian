// #299 跳转目标提示浏览器回归 fixture：装配生产 webview 控制器，Live
// 正文（默认 Ctrl+悬停组合）、Reading 正文与反链面板三入口经真实指针
// 驱动——「浮层不将现」的悬停场景出目标位置小浮标（统一 tooltip 体系
// 类名），浮层将现场景不出、补按 Ctrl 即消、各消失触发与缓存契约在真实
// 布局验证。宿主轻量解析回包（hover.target.resolved）与浮层回包
//（hover.result）经 fixture 内伪造通道注入（与真实 handleHostMessage
// 同入口）。fixture 不装配通用 tooltip 委托层（main.ts 顶层的
// installTooltipCard 不进本产物）——.vsidian-tooltip 卡片即目标提示。
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { BacklinkItemPayload, HostToWebview, WebviewToHost } from '../../src/shared/protocol'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import { keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import '../../src/webview/main.css'

bootLocaleFromDocument()

/** 出站消息观测（hover.target.resolve 载荷断言 + 零浮层读取/零写回断言） */
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
  /** 装配父文档（Live 起步——默认组合场景的前置） */
  initTargetTipDoc(text: string) {
    controller.handleHostMessage({
      kind: 'init',
      sessionId: 'target-tip',
      docUri: DOC_URI,
      version: 1,
      text,
    })
  },
  /** 切正文模式（view.mode.set，与生产回流同入口） */
  setTipMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  /** 注入设置快照（settings.snapshot 通道；三开关组合的生效面） */
  applyTipSettings(values: Record<string, boolean | number | string>) {
    controller.handleHostMessage({ kind: 'settings.snapshot', values })
  },
  /** 注入反链快照（面板条目悬停的目标载荷来源） */
  injectTipBacklinks(items: BacklinkItemPayload[]) {
    controller.handleHostMessage({
      kind: 'backlinks.snapshot',
      docUri: DOC_URI,
      state: 'ready',
      items,
      seq: 1,
    })
  },
  /** 注入宿主消息（hover.target.resolved / hover.result 等与真实
   *  handleHostMessage 同入口） */
  respondHost(message: HostToWebview) {
    controller.handleHostMessage(message)
  },
  /** 已出站消息快照 */
  tipSent(): WebviewToHost[] {
    return [...sent]
  },
  /** 目标提示观测（断言用户看到的东西：绘制层可见性、几何与内容）。
   *  fixture 环境的 .vsidian-tooltip 卡片即目标提示（通用委托层未装配） */
  readTargetTip() {
    const el = document.querySelector<HTMLElement>('.vsidian-tooltip.vsidian-tooltip--shown')
    if (!el) {
      return { open: false as const }
    }
    const rect = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    return {
      open: true as const,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      text: (el.textContent ?? '').trim(),
      /** 绘制层证据：实底背景 + 非零尺寸 + 内容文本（样式注入失效时
       *  background 退透明/尺寸归零，存在性断言照样过的反例防回潮） */
      background: style.backgroundColor,
      display: style.display,
      focusable: el.tabIndex === 0,
    }
  },
  /** 浮层观测（提示/浮层互斥与「浮层将现不出提示」断言素材） */
  readTipPopup() {
    const el = document.querySelector<HTMLElement>('.vsidian-hover-popup')
    return { open: el !== null, stateText: el?.querySelector('.vsidian-hover-popup-state')?.textContent ?? '' }
  },
  controller,
})
