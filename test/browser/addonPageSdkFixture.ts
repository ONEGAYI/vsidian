// V02（#349）页面 SDK 浏览器夹具：装配**生产** WebviewSyncController（与
// symbolInputFixture 同口径——真实控制器 + 真实 CM6，按键只由浏览器键盘/
// CDP IME 发起），并在页面内安装 V02 装载器原型：
// - 编辑器扩展挂载槽 = extraExtensions 里的 Compartment（生产实现将在
//   生产扩展列表加入该槽，见结论文档「放行边界」）；
// - 装载器与夹具共享同一份 @codemirror/* 命名空间（页面 bundle 单实例）；
// - 组件产物（.build/test-addon/dist）经本地 http 服务提供——装载器用
//   真实 URL 驱动 <script>/<link>，与真宿主 asWebviewUri 地址同机制；
// - 夹具扮演宿主角色：收集组件通道请求，由测试脚本决定回执（迟到回执
//   拒收、正常回执送达都经此驱动）。
import 'katex/dist/katex.min.css'
import * as cmState from '@codemirror/state'
import * as cmView from '@codemirror/view'
import { Compartment } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { WebviewSyncController } from '../../src/webview/syncController'
import { installAddonPageLoader, type AddonPageLoaderHandle } from '../fixtures/addon-v02/loader/pageAddonLoader'
import type { AddonChannelOutcome, AddonLoadOutcome, AddonPageOutbound, AddonUnloadOutcome } from '../fixtures/addon-v02/loader/types'
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

/** 组件挂载槽：装载器经 attachExtensions 驱动 reconfigure */
const addonSlot = new Compartment()
const findView = () => EditorView.findFromDOM(document.querySelector('.cm-editor')!)

const outbound: AddonPageOutbound[] = []
const loader: AddonPageLoaderHandle = installAddonPageLoader({
  page: 'editor',
  cm6: { state: cmState, view: cmView },
  attachExtensions: (extension) => {
    const view = findView()
    if (!view) throw new Error('cm-editor 视图未就绪')
    view.dispatch({ effects: addonSlot.reconfigure(extension ?? []) })
  },
  send: (message) => outbound.push(message),
})

controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap), addonSlot.of([])])

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
    const [addonId, generation] = requestId.split('#')
    loader.handleDirective({
      type: 'addon.channel.reply',
      addonId,
      generation: Number(generation),
      requestId,
      outcome,
    })
  },
  readEditor() {
    const view = findView()!
    const main = view.state.selection.main
    return { text: view.state.doc.toString(), head: main.head, from: main.from, to: main.to }
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
  runtimeIdentity() {
    const stats = loader.stats()
    return {
      cm6Shared: stats.cm6Shared,
      stateFieldConstructor: cmState.StateField?.name,
      viewConstructor: cmView.EditorView?.name,
    }
  },
})
