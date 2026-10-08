// #351 T02 页面 SDK 浏览器夹具：装配**生产** WebviewSyncController 与
// **生产**装载器（src/webview/addonPageLoader——与生产 main.js 同源），
// 按键只由浏览器键盘/CDP IME 发起：
// - 编辑器扩展挂载槽 = 生产路径 controller.reconfigureAddonExtensions →
//   liveInstance 扩展数组末尾的附加组件 Compartment 空槽（V02 放行结论
//   的生产缺口已闭合，不再由夹具自建槽）；
// - 装载器与夹具共享同一份 @codemirror/* 命名空间（页面 bundle 单实例）；
// - 组件产物（.build/test-addon/dist）经本地 http 服务提供——装载器用
//   真实 URL 驱动 <script>/<link>，与真宿主 asWebviewUri 地址同机制；
// - 夹具扮演宿主角色：收集组件通道请求，由测试脚本决定回执（迟到回执
//   拒收、正常回执送达都经此驱动）。
import 'katex/dist/katex.min.css'
import * as cmState from '@codemirror/state'
import * as cmView from '@codemirror/view'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { WebviewSyncController } from '../../src/webview/syncController'
import { installAddonPageLoader, type AddonPageLoaderHandle } from '../../src/webview/addonPageLoader'
import { setAddonRenderersBridge, type AddonRenderersOutboundMessage } from '../../src/webview/addonRenderers'
import { AddonRendererService } from '../../src/host/addons/addonRendererService'
import type { AddonRendererStoreV1 } from '../../src/shared/addonRenderers'
import type { AddonChannelOutcome, AddonLoadOutcome, AddonPageOutbound, AddonUnloadOutcome } from '../../src/shared/addonPage'
import '../../src/webview/main.css'

const hostMessages: unknown[] = []
const controller = new WebviewSyncController({
  postMessage(message) {
    hostMessages.push(message)
    ;(window as unknown as Record<string, unknown>)['__lastHostMessage'] = message
  },
  getState() {
    return undefined
  },
  setState() {},
})

const findView = () => EditorView.findFromDOM(document.querySelector('.cm-editor')!)

const outbound: AddonPageOutbound[] = []
// #358 T09 渲染提供者桥（与生产 main.ts 同款装配：先桥后装载器，SDK
// renderers 面后端；候选上报进宿主角色收件箱，测试脚本经 hostRendererStep
// 消费）
const rendererOutbox: AddonRenderersOutboundMessage[] = []
const addonRenderers = setAddonRenderersBridge((message) => rendererOutbox.push(message))
const loader: AddonPageLoaderHandle = installAddonPageLoader({
  page: 'editor',
  cm6: { state: cmState, view: cmView },
  // 生产槽路径：装载器 → controller → liveInstance 的附加组件
  // Compartment（与生产 main.ts 装载点同一装配）
  attachExtensions: (extension) => {
    controller.reconfigureAddonExtensions(extension)
  },
  send: (message) => outbound.push(message),
  addonRenderers,
})
// #358 T09：控制器订阅生效表变化（热切换：动态语言集/所有权扫描/live
// 效应/阅读重渲染——生产 attachAddonRenderers 同款）
controller.attachAddonRenderers()

/** 宿主回执直发（window API 与内部放行共用；可任意迟到——装载器拒收
 *  旧代次/已终结请求） */
function replyChannelRequestDirect(requestId: string, outcome: AddonChannelOutcome): void {
  const [addonId, generation] = requestId.split('#')
  loader.handleDirective({
    type: 'addon.channel.reply',
    addonId,
    generation: Number(generation),
    requestId,
    outcome,
  })
}

// 生产装配：附加组件槽由 liveInstance 扩展数组自带（Compartment 空槽），
// 夹具不再注入槽——与生产 main.ts 的 mount 参数形态一致
controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])

// #358 T09 宿主角色：真实渲染服务实例（内存持久层——批次幂等/首选/选择
// 纯逻辑与生产同一实现；测试脚本经 hostRendererStep 驱动）
let rendererStoreData: unknown
const rendererHost = new AddonRendererService({
  persistence: {
    read: () => rendererStoreData,
    write: async (value) => {
      rendererStoreData = value
      return true
    },
  },
  log: () => {},
})

/** 夹具扮演宿主：组件通道请求记录（测试脚本回执驱动） */
const channelRequests: Array<{ requestId: string; topic: string; payload: unknown; addonId: string; generation: number }> = []
const collectOutbound = () => {
  for (const message of outbound.splice(0)) {
    if (message.type === 'addon.channel.request') {
      channelRequests.push({
        requestId: message.requestId,
        topic: message.topic,
        payload: message.payload,
        addonId: message.addonId,
        generation: message.generation,
      })
    }
  }
}

Object.assign(window, {
  initDoc(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'v02-addon', docUri: 'file:///v02-addon.md', version: 1, text })
  },
  /** #354 T05 宿主角色落定循环：ack 在途请求并等待暂缓集 flush 出站，
   *  循环至本地输入完全落定（装载/断言前驱动——生产中宿主持续 ack，
   *  夹具无自动循环；暂缓输入经 flush 定时器出站，单次 ack 不够） */
  async settleInputs(): Promise<boolean> {
    const requests = () => hostMessages.filter(
      (message): message is { kind: 'edit.request'; seq: number; baseVersion: number } =>
        typeof message === 'object' && message !== null && (message as { kind?: string }).kind === 'edit.request',
    )
    for (let i = 0; i < 20; i++) {
      const pending = requests()
      if (pending.length > 0) {
        hostMessages.length = 0
        for (const request of pending) {
          controller.handleHostMessage({ kind: 'edit.ack', seq: request.seq, ok: true, version: request.baseVersion + 1 })
        }
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 50))
      if (!controller.hasPendingLocalInput()) {
        return true
      }
    }
    return false
  },
  /** #354 T05 宿主角色 ack：确认全部未确认的 edit.request（ok，version =
   *  base + 1，逐条）——热切换落定链（onLocalInputSettled 冲刷挂起的组件
   *  扩展重配）在浏览器场景的驱动入口；组合链可能产生多条在途请求 */
  ackPendingEdits() {
    const requests = hostMessages.filter(
      (message): message is { kind: 'edit.request'; seq: number; baseVersion: number } =>
        typeof message === 'object' && message !== null && (message as { kind?: string }).kind === 'edit.request',
    )
    let last: number | null = null
    for (const request of requests) {
      controller.handleHostMessage({ kind: 'edit.ack', seq: request.seq, ok: true, version: request.baseVersion + 1 })
      last = request.seq
    }
    return last
  },
  async loadAddon(scriptUri: string, cssUri: string | null, generation: number): Promise<AddonLoadOutcome> {
    collectOutbound()
    const outcome = await loader.load({
      addonId: 'onegayi.vsidian-test-addon',
      generation,
      page: 'editor',
      scriptUri,
      cssUris: cssUri ? [cssUri] : [],
    })
    collectOutbound()
    return outcome
  },
  async unloadAddon(generation: number): Promise<AddonUnloadOutcome> {
    const outcome = await loader.unload('onegayi.vsidian-test-addon', generation)
    collectOutbound()
    return outcome
  },
  addonStats: () => loader.stats(),
  /** 取走累积的通道请求（宿主角色收件箱） */
  takeChannelRequests() {
    collectOutbound()
    return channelRequests.splice(0)
  },
  /** 宿主回执（可任意迟到——装载器负责拒收旧代次/已终结请求） */
  replyChannelRequest(requestId: string, outcome: AddonChannelOutcome) {
    replyChannelRequestDirect(requestId, outcome)
  },
  readEditor() {
    const view = findView()!
    const main = view.state.selection.main
    return { text: view.state.doc.toString(), head: main.head, from: main.from, to: main.to }
  },
  /** #354 T05 本地输入在途观测（守卫谓词透出——热切换收尾的诊断面） */
  pendingInput(): boolean {
    return controller.hasPendingLocalInput()
  },
  /** #354 T05 组件扩展重配挂起观测（true = 有意图等待落定冲刷） */
  pendingReconfigure(): boolean {
    return controller.hasPendingAddonReconfigure
  },
  /** 首字符标记的绘制层观测：元素计数 + 计算样式 + 几何 + 文本 */
  markInfo() {
    const marks = [...document.querySelectorAll<HTMLElement>('.vsa2-mark')]
    if (marks.length === 0) return { count: 0 }
    const first = marks[0]
    const style = getComputedStyle(first)
    const rect = first.getBoundingClientRect()
    return {
      count: marks.length,
      color: style.backgroundColor,
      text: first.textContent ?? '',
      rectWidth: rect.width,
      rectHeight: rect.height,
    }
  },
  dispatchProbeEvent() {
    document.dispatchEvent(new CustomEvent('vsa2-probe'))
  },
  /** 构造器身份观测：装载器注入的运行时即页面 bundle 的模块命名空间
   *  （esbuild 单实例去重）。跨实例兼容性由功能断言承担——若组件自带
   *  第二份 CM6，其 StateField/装饰无法接入本页视图（field 查询抛错、
   *  标记不绘制），套件的 pageerror 监听与绘制断言会暴露。 */
  /** #358 T09 宿主角色渲染表步进：消费候选上报（真实 AddonRendererService
   *  纯逻辑：批次分配/首选/确定性选择），按可用组件集求表并下发本页桥；
   *  返回表 JSON（测试脚本断言生效者）。preferred 传 null 清除该语言首选 */
  hostRendererStep(availableAddonIds: string[], preferred?: Array<[string, string | null]>): {
    version: number
    languages: Array<{ language: string; effective: string; source: string }>
    store: AddonRendererStoreV1
  } {
    for (const message of rendererOutbox.splice(0)) {
      rendererHost.registerProviders(message.payload.addonId, message.payload.providers)
    }
    if (preferred) {
      for (const [language, provider] of preferred) {
        rendererHost.setPreferred(language, provider)
      }
    }
    const table = rendererHost.effectiveTable((addonId) => availableAddonIds.includes(addonId))
    addonRenderers.applyTable(table)
    return { version: table.version, languages: [...table.languages], store: rendererHost.snapshot(() => true).store }
  },
  /** #358 T09 渲染容器观测（绘制层断言锚）：文档内 t09-box 的提供者/语言/
   *  模式/文本与计算背景色 + 内置 mermaid svg 在场数 */
  rendererPaintInfo() {
    const boxes = [...document.querySelectorAll<HTMLElement>('.t09-box')]
    return {
      boxes: boxes.filter((el) => el.isConnected).map((el) => ({
        renderer: el.getAttribute('data-t09-renderer'),
        language: el.getAttribute('data-t09-language'),
        mode: el.getAttribute('data-t09-mode'),
        text: el.textContent ?? '',
        color: getComputedStyle(el).backgroundColor,
        width: el.getBoundingClientRect().width,
      })),
      lateMarks: document.querySelectorAll('[data-t09-late]').length,
      releasedMarks: document.querySelectorAll('[data-t09-released]').length,
      builtinSvg: document.querySelectorAll('.vsidian-mermaid svg').length,
      mermaidStates: [...document.querySelectorAll<HTMLElement>('.vsidian-mermaid')].map((el) => el.getAttribute('data-vsidian-mermaid-state')),
    }
  },
  /** #358 T09 装载 T09 渲染夹具组件（addonId 与页面工厂声明一致） */
  async loadRendererAddon(scriptUri: string, cssUri: string | null, generation: number): Promise<AddonLoadOutcome> {
    collectOutbound()
    const outcome = await loader.load({
      addonId: 'vsidian-test-fixture.addon-t09',
      generation,
      page: 'editor',
      scriptUri,
      cssUris: cssUri ? [cssUri] : [],
    })
    collectOutbound()
    return outcome
  },
  /** #358 T09 放行夹具组件的渲染候选注册（页面装载时经通道询问——本
   *  夹具页面默认惰性，不毒化共享浏览器会话的其他断言） */
  grantRendererProviders(): number {
    let granted = 0
    for (const request of channelRequests.splice(0)) {
      if (request.topic === 't09.providersAllowed') {
        replyChannelRequestDirect(request.requestId, { ok: true, result: { allowed: true } })
        granted += 1
      }
    }
    return granted
  },
  /** #358 T09 光标落位（呈现态发射前提——移出围栏） */
  focusEditorAt(offset: number) {
    const view = findView()
    view?.dispatch({ selection: { anchor: offset } })
  },
  /** #358 T09 模式切换（宿主 view.mode.set 同款消息路径） */
  switchMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  runtimeIdentity() {
    const stats = loader.stats()
    return {
      cm6Shared: stats.cm6Shared,
      stateFieldConstructor: cmState.StateField?.name,
      viewConstructor: cmView.EditorView?.name,
    }
  },
})
