// #543 T03 文档导航浏览器夹具：装配**生产** WebviewSyncController 与
// **生产**装载器 + **生产**视图注册表（src/webview/addonViews——与生产
// main.ts 同源装配，docNav 出站端口与面板身份接线同款），docnav 夹具
// 组件（.build/docnav-addon/dist）经本地 http 服务以真实 URL 装载、经
// 公开 SDK 的 views.openDocument 消费。夹具扮演宿主角色：
// - 通道收件箱（docnav.next / docnav.result 短轮询）；
// - 导航请求捕获（addonDocNav.request 出站——宿主侧断言面：来源文档
//   URI/面板身份/代次注入）与回执注入（addonDocNav.result 经生产路由点
//   registry.handleDocNavResult）；
// - 宿主定位驱动（view.locate / view.mode.set / view.state.request 经
//   控制器生产消息路径）。
import 'katex/dist/katex.min.css'
import * as cmState from '@codemirror/state'
import * as cmView from '@codemirror/view'
import * as cmLanguage from '@codemirror/language'
import { keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { WebviewSyncController } from '../../src/webview/syncController'
import { AddonViewRegistry } from '../../src/webview/addonViews'
import { addonCm6LanguageSubset, installAddonPageLoader, type AddonPageLoaderHandle } from '../../src/webview/addonPageLoader'
import type { AddonChannelOutcome, AddonLoadOutcome, AddonPageOutbound } from '../../src/shared/addonPage'
import type { WebviewToHost } from '../../src/shared/protocol'
import '../../src/webview/main.css'

/** 宿主消息收件（控制器出站 + 装载器出站分列） */
const hostMessages: WebviewToHost[] = []
const outbound: AddonPageOutbound[] = []

const controller = new WebviewSyncController({
  postMessage(message: unknown) {
    hostMessages.push(message as WebviewToHost)
  },
  getState() {
    return undefined
  },
  setState() {},
})

/** 生产 main.ts 同款：页面级视图注册表 + 装载器（views 面后端） */
const addonViews = new AddonViewRegistry()
const loader: AddonPageLoaderHandle = installAddonPageLoader({
  page: 'editor',
  cm6: { state: cmState, view: cmView, language: addonCm6LanguageSubset(cmLanguage) },
  attachExtensions: (extension) => {
    controller.reconfigureAddonExtensions(extension)
  },
  addonViews,
  send: (message) => outbound.push(message),
})
addonViews.attachDocNavPort({
  send: (message) => hostMessages.push(message),
  panelIdentity: () => controller.sessionIdentityNow(),
})
controller.attachAddonViews(addonViews)

controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])

interface DocNavCommand {
  seq: number
  op: string
  args?: Record<string, unknown>
}

const pendingCommands: DocNavCommand[] = []
const results: Array<{ seq: number; outcome: unknown }> = []
let commandSeq = 0

const drainChannel = () => {
  for (const message of outbound.splice(0)) {
    if (message.type !== 'addon.channel.request') {
      continue
    }
    let outcome: AddonChannelOutcome
    if (message.topic === 'docnav.next') {
      outcome = { ok: true, result: pendingCommands.shift() ?? null }
    } else if (message.topic === 'docnav.result') {
      results.push(message.payload as { seq: number; outcome: unknown })
      outcome = { ok: true, result: 'ok' }
    } else {
      outcome = { ok: true, result: null }
    }
    const [addonId, generation] = message.requestId.split('#')
    loader.handleDirective({
      type: 'addon.channel.reply',
      addonId,
      generation: Number(generation),
      requestId: message.requestId,
      outcome,
    })
  }
}

Object.assign(window, {
  initDoc(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'docnav-addon', docUri: 'file:///d%3A/ws/a.md', version: 1, text })
  },
  async runDocNavOp(op: string, args?: Record<string, unknown>): Promise<unknown> {
    drainChannel()
    const seq = ++commandSeq
    pendingCommands.push({ seq, op, args })
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      drainChannel()
      const hit = results.find((r) => r.seq === seq)
      if (hit) {
        results.splice(results.indexOf(hit), 1)
        return hit.outcome
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(`docnav op ${op}#${seq} 未回报`)
  },
  async loadDocNavAddon(scriptUri: string, generation: number): Promise<AddonLoadOutcome> {
    drainChannel()
    const outcome = await loader.load({
      addonId: 'vsidian-test-fixture.addon-docnav',
      generation,
      page: 'editor',
      scriptUri,
      cssUris: [],
    })
    drainChannel()
    return outcome
  },
  async unloadDocNavAddon(generation: number): Promise<void> {
    await loader.unload('vsidian-test-fixture.addon-docnav', generation)
  },
  /** 捕获的导航出站请求（宿主角色断言面） */
  docNavRequests(): Array<Extract<WebviewToHost, { kind: 'addonDocNav.request' }>> {
    drainChannel()
    return hostMessages.filter((m): m is Extract<WebviewToHost, { kind: 'addonDocNav.request' }> => m.kind === 'addonDocNav.request')
  },
  /** 宿主角色回执（生产路由点：main.ts 的 addonDocNav.result 消息分支） */
  replyDocNav(reqId: number, addonId: string, generation: number, result: unknown): void {
    addonViews.handleDocNavResult({ reqId, addonId, generation, result: result as never })
  },
  /** 宿主角色驱动 view.locate（宿主定位管线的生产入口消息） */
  hostLocate(offset: number): void {
    controller.handleHostMessage({ kind: 'view.locate', offset })
  },
  /** 宿主角色驱动模式切换（生产入口消息） */
  hostSetMode(mode: 'live' | 'reading'): void {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  /** 光标落点（LF 偏移；live 态生产控制器真实选区） */
  cursorOffset(): number | null {
    const view = controller.getView()
    return view ? view.state.selection.main.head : null
  },
  /** 视图模式下的可见折叠状态探针（headingFold 状态面之外的独立口径：
   *  折叠隐藏区行是否仍在 DOM——绘制层断言用） */
  liveLineCount(): number {
    return document.querySelectorAll('.cm-content .cm-line').length
  },
})
