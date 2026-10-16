// T05（#544）/T06（#545）附加组件只读引用视图浏览器夹具：装配**生产**
// WebviewSyncController、**生产**装载器、**生产**界面运行时与**生产**引用
// 视图运行时（src/webview/addonRefViews——与生产 main.js 同源装配），组件
// 产物（.build/refviews-addon/dist）经本地 http 服务以真实 URL 装载。夹具
// 扮演宿主角色：
// - rv 通道指令队列（rv.next 回执待发指令——request/close/active/
//   closePanel/openPanel/embed/embedRelease/embedActive）；
// - hover.request 自动回包（目标文本 → markdown 成功 / missing → not-found
//   ——与真实 handleHostMessage 同入口注入）；
// - 浮窗与嵌入挂载的绘制观测（元素/几何/命中/计算色/文本/滚动）与出站
//   消息快照。
import 'katex/dist/katex.min.css'
import * as cmState from '@codemirror/state'
import * as cmView from '@codemirror/view'
import * as cmLanguage from '@codemirror/language'
import { keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { WebviewSyncController } from '../../src/webview/syncController'
import { addonCm6LanguageSubset, installAddonPageLoader, type AddonPageLoaderHandle } from '../../src/webview/addonPageLoader'
import { AddonViewRegistry } from '../../src/webview/addonViews'
import { AddonCommandsRuntime } from '../../src/webview/addonCommands'
import { AddonUiRuntime } from '../../src/webview/addonUi'
import { AddonRefViewsRuntime } from '../../src/webview/addonRefViews'
import { closeHoverPopup, currentHoverPopupInstanceId, openHoverPopupForAddonRef } from '../../src/webview/hoverPopup'
import { graphicProviderAddonOwnerOf } from '../../src/webview/graphicRenderers'
import type { AddonChannelOutcome, AddonPageOutbound } from '../../src/shared/addonPage'
import type { HostToWebview, WebviewToHost } from '../../src/shared/protocol'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import { installTooltipCard } from '../../src/webview/tooltipCard'
import '../../src/webview/main.css'

bootLocaleFromDocument()
installTooltipCard()

const sent: WebviewToHost[] = []
const controller = new WebviewSyncController({
  postMessage(message) {
    sent.push(message as WebviewToHost)
  },
  getState() {
    return undefined
  },
  setState() {},
})

const outbound: AddonPageOutbound[] = []
const registrations: unknown[] = []
const results: Array<{ seq: number; outcome: unknown }> = []
const channelRequests: Array<{ requestId: string; topic: string; payload: unknown }> = []
const pendingCommands: Array<{ seq: number; op: string; args?: Record<string, unknown> }> = []
let seqCounter = 0

const addonCommands = new AddonCommandsRuntime({ report: () => {} })

controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])

const addonViews = new AddonViewRegistry()
const addonUi = new AddonUiRuntime({
  toolbarSlot: controller.addonToolbarSlot()!,
  panelDock: controller.addonPanelDock()!,
  currentMode: () => controller.viewModeNow(),
  activeInstanceId: () => controller.addonActiveInstanceId(),
  executeCommand: (commandId) => controller.runAddonCommand(commandId),
  bindingHints: (commandId) => controller.addonEffectiveBindings(commandId),
  panelCloseLabel: () => '关闭面板',
  log: (detail) => console.warn(`[rv-fixture] ${detail}`),
})
// 生产引用视图运行时（与 main.js 同源装配——来源解析/浮窗入口/句柄簿记；
// T06 嵌入：容器归属 = 面板内容根（addonUi）/渲染容器（graphicRenderers），
// 卡片挂载与整组释放经控制器的 EmbedCardManager 只读端口）
const addonRefViews = new AddonRefViewsRuntime({
  resolveSource: (instanceId) => {
    const info = addonViews.infoOf(instanceId)
    if (!info) return undefined
    if (info.viewType === 'main') return { viewType: 'main' }
    const fsPath = addonViews.targetFsPathOf(instanceId)
    return fsPath ? { viewType: info.viewType === 'embed' ? 'embed' : 'hover', fsPath } : undefined
  },
  openPopup: ({ trigger, spec, keyboard, addonSource, onSettled }) =>
    openHoverPopupForAddonRef(trigger, spec, { keyboard, addonSource, onSettled }),
  currentPopupInstanceId: () => currentHoverPopupInstanceId(),
  closePopup: () => closeHoverPopup(),
  ownsContainer: (addonId, el) =>
    addonUi.panelAddonOwnerOf(el) === addonId ||
    graphicProviderAddonOwnerOf(el) === addonId,
  mountEmbedCard: (input) => controller.mountAddonRefEmbed(input),
  releaseEmbedCard: (subRoot) => controller.releaseAddonRefEmbed(subRoot),
})
addonViews.onDisposed((info) => addonRefViews.releaseSource(info.instanceId))
const loader: AddonPageLoaderHandle = installAddonPageLoader({
  page: 'editor',
  cm6: { state: cmState, view: cmView, language: addonCm6LanguageSubset(cmLanguage) },
  attachExtensions: (extension) => {
    controller.reconfigureAddonExtensions(extension)
  },
  addonViews,
  addonCommands,
  addonUi,
  addonRefViews,
  send: (message) => outbound.push(message),
})
addonUi.bindHandleFactory((addonId, instanceId) => loader.buildViewHandle(addonId, instanceId))
controller.attachAddonViews(addonViews)
controller.attachAddonCommands(addonCommands)
controller.attachAddonUi(addonUi)

// ---- 宿主角色：文档 init + hover.request 自动回包 ----
const TARGET_TEXT = ['# B 目标标题', '', ...Array.from({ length: 40 }, (_, i) => `B 文档第 ${i + 1} 段正文，用于撑出可滚动内容（嵌入双实例滚动独立性断言的载体）。`), '', '## 小节', '', '小节正文。', ''].join('\n')

/** 已回包的 hover.request（reqId+instanceId 配对——防重复回包） */
const replied = new Set<string>()

function autoRespondHover(): void {
  for (const message of sent) {
    if (message.kind !== 'hover.request') continue
    const req = message
    const key = `${req.instanceId}#${req.reqId}`
    if (replied.has(key)) {
      continue // 已回包
    }
    replied.add(key)
    let reply: HostToWebview
    if (req.target.includes('missing')) {
      reply = { kind: 'hover.result', reqId: req.reqId, instanceId: req.instanceId, ok: false, reason: 'not-found' }
    } else {
      const fsPath = `D:/notes/${req.target.replace(/\.md$/, '')}.md`
      reply = {
        kind: 'hover.result',
        reqId: req.reqId,
        instanceId: req.instanceId,
        ok: true,
        target: { fsPath, relPath: req.target },
        version: 1,
        text: TARGET_TEXT,
        range: { start: 0, end: TARGET_TEXT.length },
        scope: { kind: 'full' },
        sourceLeaseId: `lease-${req.reqId}`,
      }
    }
    controller.handleHostMessage(reply)
  }
}

// ---- 宿主角色：通道指令队列 ----
function drainChannel(): void {
  for (const message of outbound.splice(0)) {
    if (message.type !== 'addon.channel.request') continue
    channelRequests.push({ requestId: message.requestId, topic: message.topic, payload: message.payload })
  }
  for (const request of channelRequests.splice(0)) {
    let outcome: AddonChannelOutcome
    if (request.topic === 'rv.register') {
      registrations.push(request.payload)
      outcome = { ok: true, result: 'ok' }
    } else if (request.topic === 'rv.next') {
      outcome = { ok: true, result: pendingCommands.shift() ?? null }
    } else if (request.topic === 'rv.result') {
      results.push(request.payload as { seq: number; outcome: unknown })
      outcome = { ok: true, result: 'ok' }
    } else {
      outcome = { ok: true, result: null }
    }
    const [addonId, generation] = request.requestId.split('#')
    loader.handleDirective({
      type: 'addon.channel.reply',
      addonId,
      generation: Number(generation),
      requestId: request.requestId,
      outcome,
    })
  }
}

Object.assign(window, {
  /** 装配父文档并维持 Live（验证 API 引用不继承父模式授予写能力） */
  initRvDoc(text: string) {
    controller.handleHostMessage({
      kind: 'init',
      sessionId: 'rv-panel',
      docUri: 'file:///d%3A/notes/a.md',
      version: 1,
      text,
    })
    controller.handleHostMessage({ kind: 'view.mode.set', mode: 'live' })
  },
  /** 塞指令（宿主角色；seq 单调） */
  rvQueue(op: string, args?: Record<string, unknown>): number {
    const seq = ++seqCounter
    pendingCommands.push({ seq, op, args })
    return seq
  },
  /** 执行结局快照（非破坏式——轮询判定用） */
  rvPeek(): Array<{ seq: number; outcome: unknown }> {
    return [...results]
  },
  /** 取走全部执行结局 */
  rvCollect(): Array<{ seq: number; outcome: unknown }> {
    return results.splice(0)
  },
  /** 装载组件（manifest 直推——生产经宿主指令，此处测试直载） */
  async rvLoad(addonId: string, scriptUri: string) {
    const outcome = await loader.load({
      addonId, generation: 1, page: 'editor', scriptUri,
    })
    autoRespondHover()
    drainChannel()
    return outcome
  },
  rvRegistrations() {
    drainChannel()
    autoRespondHover()
    return registrations
  },
  /** 驱动一轮宿主角色（通道回执 + hover 自动回包） */
  rvPump() {
    autoRespondHover()
    drainChannel()
  },
  /** 出站消息快照（hover.request 的 addonSource 断言面 + edit.request 计数） */
  rvSent(): WebviewToHost[] {
    return [...sent]
  },
  /** views 注册表快照（hover 实例登记——来源选择面） */
  rvViews() {
    return addonViews.list()
  },
  /** 浮窗观测（绘制层：元素/几何/命中/文本/错误态） */
  readRvPopup() {
    const el = document.querySelector<HTMLElement>('.vsidian-hover-popup')
    if (!el) return { open: false as const }
    const rect = el.getBoundingClientRect()
    const stateEl = el.querySelector<HTMLElement>('.vsidian-hover-popup-state')
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + Math.min(rect.height / 2, 40))
    return {
      open: true as const,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      hitInside: hit !== null && el.contains(hit),
      background: getComputedStyle(el).backgroundColor,
      outlineColor: getComputedStyle(el).outlineColor,
      modeDisplay: getComputedStyle(el.querySelector('.vsidian-hover-popup-mode')!).display,
      saveDisplay: getComputedStyle(el.querySelector('.vsidian-hover-popup-save')!).display,
      text: (el.textContent ?? '').trim(),
      errorState: stateEl !== null && stateEl.classList.contains('vsidian-hover-popup-state-error'),
      stateText: (stateEl?.textContent ?? '').trim(),
    }
  },
  /** 触发按钮观测（几何对照与焦点面） */
  readRvTrigger() {
    const el = document.querySelector<HTMLElement>('.rv-trigger')
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return { connected: el.isConnected, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, focused: document.activeElement === el }
  },
  /** 当前浮窗实例身份（单实例仲裁断言面） */
  rvPopupInstanceId(): string | null {
    return currentHoverPopupInstanceId()
  },
  /** 键盘焦点是否在浮层内（R-U12 断言面） */
  rvFocusInPopup(): boolean {
    const el = document.querySelector<HTMLElement>('.vsidian-hover-popup')
    return el !== null && el.contains(document.activeElement)
  },
  /** T06 嵌入挂载观测（绘制层：容器内卡片/计算色/命中/文本/滚动/只读 chrome） */
  readRvEmbed(slot: 1 | 2) {
    const host = document.querySelector<HTMLElement>(`.rv-embed-slot-${slot}`)
    if (!host) return { present: false as const }
    const card = host.querySelector<HTMLElement>('.vsidian-embed-card')
    if (!card) return { present: true as const, card: false as const, childCount: host.childElementCount }
    const scroll = card.querySelector<HTMLElement>('.vsidian-embed-card-scroll')
    const state = card.querySelector<HTMLElement>('.vsidian-embed-card-state')
    const modeBtn = card.querySelector<HTMLElement>('.vsidian-embed-card-mode')
    const rect = card.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + Math.min(rect.height / 2, 40))
    const style = getComputedStyle(card)
    return {
      present: true as const,
      card: true as const,
      childCount: host.childElementCount,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      hitInside: hit !== null && card.contains(hit),
      // 绘制层：引用竖条与标题条边框的实际计算色（样式注入失效时透明）
      borderLeftColor: style.borderLeftColor,
      borderLeftWidth: style.borderLeftWidth,
      headerBorderBottom: getComputedStyle(card.querySelector<HTMLElement>('.vsidian-embed-card-header')!).borderBottomColor,
      text: (card.textContent ?? '').trim(),
      stateText: (state?.textContent ?? '').trim(),
      stateError: state?.classList.contains('vsidian-embed-card-state-error') ?? false,
      stateHidden: state !== null && state.style.display === 'none',
      modeDisplay: modeBtn !== null ? getComputedStyle(modeBtn).display : 'missing',
      scrollTop: scroll?.scrollTop ?? -1,
      scrollHeight: scroll?.scrollHeight ?? -1,
      clientHeight: scroll?.clientHeight ?? -1,
    }
  },
  /** T06 嵌入滚动写入（双实例独立性断言的驱动面——滚容器 1 不动容器 2） */
  rvEmbedScroll(slot: 1 | 2, top: number): boolean {
    const scroll = document.querySelector<HTMLElement>(`.rv-embed-slot-${slot} .vsidian-embed-card-scroll`)
    if (!scroll) return false
    scroll.scrollTop = top
    return true
  },
  /** 主正文用户可见文本快照（Live cm-content 或 Reading 容器——「展示请求
   *  零正文写入」的浏览器侧观测面；撤销历史属宿主文本管线，由真宿主用例
   *  按文档版本断言） */
  rvMainText(): string {
    const live = document.querySelector<HTMLElement>('.cm-content')
    if (live !== null) return live.textContent ?? ''
    const reading = document.querySelector<HTMLElement>('.vsidian-view-reading')
    return (reading?.textContent ?? '').trim()
  },
})
