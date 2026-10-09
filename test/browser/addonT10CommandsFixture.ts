// #359 T10 命令/菜单/快捷键浏览器夹具：装配**生产** WebviewSyncController、
// **生产**装载器与**生产**命令注册表（src/webview/addonCommands——与生产
// main.js 同源装配），组件产物（.build/t10-addon/dist）经本地 http 服务以
// 真实 URL 装载。夹具扮演宿主角色：
// - 收集组件命令表上报（addonCommands.report——宿主侧目录的对应面）；
// - 键位快照伪造（keybindings.snapshot 驱动 router 的 overrides——用户
//   绑定/清空场景的模拟通道）；
// - 通道请求回执（t10.register 的注册结局收件）。
// 按键只由浏览器真实键盘发起；右键菜单由真实 pointer 事件驱动。
import 'katex/dist/katex.min.css'
import * as cmState from '@codemirror/state'
import * as cmView from '@codemirror/view'
import * as cmLanguage from '@codemirror/language'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { WebviewSyncController } from '../../src/webview/syncController'
import { addonCm6LanguageSubset, installAddonPageLoader, type AddonPageLoaderHandle } from '../../src/webview/addonPageLoader'
import { AddonViewRegistry } from '../../src/webview/addonViews'
import { AddonCommandsRuntime } from '../../src/webview/addonCommands'
import type { AddonCommandReport } from '../../src/shared/addonCommands'
import type { AddonChannelOutcome, AddonLoadOutcome, AddonPageOutbound } from '../../src/shared/addonPage'
import type { KeybindingOverrides } from '../../src/shared/keybindings'
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

const outbound: AddonPageOutbound[] = []
/** 组件命令表上报收件箱（宿主目录的对应面） */
const commandReports: Array<{ addonId: string; generation: number; commands: AddonCommandReport[] }> = []
/** t10.register 的注册结局收件箱（负向拒绝断言面） */
const registrations: unknown[] = []
const channelRequests: Array<{ requestId: string; topic: string; payload: unknown }> = []
/** t10.next 待发指令队列与 t10.result 收件箱（宿主角色——counters 观察
 *  面：#427 回调目标句柄经组件内部状态带出断言） */
const pendingOps: Array<{ seq: number; op: string }> = []
const opResults: Array<{ seq: number; outcome: unknown }> = []
let opSeq = 0

const addonCommands = new AddonCommandsRuntime({
  report: (payload) => {
    commandReports.push({ ...payload, commands: [...payload.commands] })
    hostMessages.push({ kind: 'addonCommands.report', ...payload })
  },
})

// T06 同款：统一视图注册表（页面级一份）注入装载器（SDK views 面后端）
// 与控制器（主正文句柄随 init 注册）
const addonViews = new AddonViewRegistry()
const loader: AddonPageLoaderHandle = installAddonPageLoader({
  page: 'editor',
  cm6: { state: cmState, view: cmView, language: addonCm6LanguageSubset(cmLanguage) },
  attachExtensions: (extension) => {
    controller.reconfigureAddonExtensions(extension)
  },
  addonViews,
  addonCommands,
  send: (message) => outbound.push(message),
})
controller.attachAddonViews(addonViews)
controller.attachAddonCommands(addonCommands)
// #427 命令回调目标视图句柄接线（生产 main.ts 同款）：execute 时解析
// 当前活动视图为句柄——组件回调防御链由平台承担
addonCommands.bindActiveTarget((addonId) => {
  const instanceId = controller.addonActiveInstanceId()
  return instanceId === null ? null : loader.buildViewHandle(addonId, instanceId)
})

controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])

const collectOutbound = () => {
  for (const message of outbound.splice(0)) {
    if (message.type === 'addon.channel.request') {
      channelRequests.push({ requestId: message.requestId, topic: message.topic, payload: message.payload })
    }
  }
}

/** 通道请求自动回执（宿主角色：t10.register 收件；t10.next 回 null；其余 ok） */
const drainChannel = () => {
  for (const request of channelRequests.splice(0)) {
    let outcome: AddonChannelOutcome
    if (request.topic === 't10.register') {
      registrations.push(request.payload)
      outcome = { ok: true, result: 'ok' }
    } else if (request.topic === 't10.next') {
      outcome = { ok: true, result: pendingOps.shift() ?? null }
    } else if (request.topic === 't10.result') {
      opResults.push(request.payload as { seq: number; outcome: unknown })
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
  initDoc(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 't10-addon', docUri: 'file:///t10-addon.md', version: 1, text })
  },
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
  async loadT10(scriptUri: string, generation: number): Promise<AddonLoadOutcome> {
    collectOutbound()
    const outcome = await loader.load({
      addonId: 'vsidian-test-fixture.addon-t10',
      generation,
      page: 'editor',
      scriptUri,
      cssUris: [],
    })
    collectOutbound()
    drainChannel()
    return outcome
  },
  async unloadT10(generation: number) {
    const outcome = await loader.unload('vsidian-test-fixture.addon-t10', generation)
    collectOutbound()
    return outcome
  },
  /** 取走命令表上报（宿主目录对应面） */
  takeCommandReports() {
    return commandReports.splice(0)
  },
  /** 取走注册结局收件（t10.register 载荷） */
  takeRegistrations() {
    drainChannel()
    return registrations.splice(0)
  },
  /** 排一条组件指令（t10.next 弹出——组件执行后经 t10.result 回报） */
  queueT10Op(op: string) {
    pendingOps.push({ seq: ++opSeq, op })
  },
  /** 取第一条已回执的指令结果（先冲刷通道；无结果轮询等待） */
  async takeT10Result(): Promise<{ seq: number; outcome: unknown } | null> {
    for (let i = 0; i < 40; i++) {
      collectOutbound()
      drainChannel()
      const result = opResults.shift()
      if (result) {
        return result
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return null
  },
  /** 键位快照伪造（宿主角色驱动 router 的 overrides——绑定/清空场景） */
  applyKeybindings(overrides: KeybindingOverrides) {
    controller.handleHostMessage({ kind: 'keybindings.snapshot', overrides })
  },
  /** 宿主命令面板入口模拟（addonCommand.execute 回发路径） */
  executeAddonCommand(commandId: string) {
    controller.handleHostMessage({ kind: 'addonCommand.execute', commandId })
  },
  readEditor() {
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
    const main = view.state.selection.main
    return { text: view.state.doc.toString(), head: main.head }
  },
})
