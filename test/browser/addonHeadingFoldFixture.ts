// #410 标题折叠 API 浏览器夹具：装配**生产** WebviewSyncController、
// **生产**装载器与统一视图注册表（src/webview/addonViews——与生产
// main.js 同源装配），折叠夹具组件（.build/fold-addon/dist）经本地
// http 服务以真实 URL 装载、经公开 SDK 的 experimental.headingFold 消费。
// 夹具扮演宿主角色：
// - 折叠指令收件箱（fold.next 待发队列 + fold.result 结局队列——短轮询
//   驱动协议与 t06Editor/foldEditor 配对）；
// - paint 探针（生产 collectHeadingFoldPaint 采集体——绘制层断言锚）。
// 按键/命令全部由组件经公开 API 发起，夹具不代发。
import 'katex/dist/katex.min.css'
import * as cmState from '@codemirror/state'
import * as cmView from '@codemirror/view'
import * as cmLanguage from '@codemirror/language'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { WebviewSyncController } from '../../src/webview/syncController'
import { addonCm6LanguageSubset, installAddonPageLoader, type AddonPageLoaderHandle } from '../../src/webview/addonPageLoader'
import { AddonViewRegistry } from '../../src/webview/addonViews'
import { collectHeadingFoldPaint, headingFoldField } from '../../src/webview/headingFold'
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

const outbound: AddonPageOutbound[] = []
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
controller.attachAddonViews(addonViews)

controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])

interface FoldCommand {
  seq: number
  op: string
  args?: Record<string, unknown>
}

/** 待发指令队列（fold.next 取走）与已回结局（fold.result 收件） */
const pendingCommands: FoldCommand[] = []
const foldResults: Array<{ seq: number; outcome: unknown }> = []
let commandSeq = 0

const channelRequests: Array<{ requestId: string; topic: string; payload: unknown }> = []

/** 宿主角色：fold.next 回下一条指令（或 null）、fold.result 入收件箱 */
const drainChannel = () => {
  for (const message of outbound.splice(0)) {
    if (message.type !== 'addon.channel.request') {
      continue
    }
    channelRequests.push({ requestId: message.requestId, topic: message.topic, payload: message.payload })
    let outcome: AddonChannelOutcome
    if (message.topic === 'fold.next') {
      outcome = { ok: true, result: pendingCommands.shift() ?? null }
    } else if (message.topic === 'fold.result') {
      foldResults.push(message.payload as { seq: number; outcome: unknown })
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

const mainView = () => EditorView.findFromDOM(document.querySelector('.cm-editor')!)

Object.assign(window, {
  initDoc(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 'fold-addon', docUri: 'file:///fold-addon.md', version: 1, text })
  },
  /** 塞一条折叠指令并等组件执行回报（短轮询周期 ≤ 200ms + 缓冲） */
  async runFoldOp(op: string, args?: Record<string, unknown>): Promise<unknown> {
    drainChannel()
    const seq = ++commandSeq
    pendingCommands.push({ seq, op, args })
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      drainChannel()
      const hit = foldResults.find((r) => r.seq === seq)
      if (hit) {
        foldResults.splice(foldResults.indexOf(hit), 1)
        return hit.outcome
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(`fold op ${op}#${seq} 未回报（收件 ${JSON.stringify(foldResults)}）`)
  },
  async loadFoldAddon(scriptUri: string, generation: number): Promise<AddonLoadOutcome> {
    drainChannel()
    const outcome = await loader.load({
      addonId: 'vsidian-test-fixture.addon-fold',
      generation,
      page: 'editor',
      scriptUri,
      cssUris: [],
    })
    drainChannel()
    return outcome
  },
  async unloadFoldAddon(generation: number): Promise<AddonUnloadOutcome> {
    const outcome = await loader.unload('vsidian-test-fixture.addon-fold', generation)
    drainChannel()
    return outcome
  },
  /** 宿主角色回执清点（通道观察） */
  channelRequestCount(topic: string): number {
    drainChannel()
    return channelRequests.filter((r) => r.topic === topic).length
  },
  /** 塞一条折叠指令（不等待回报——卸载场景用：断言指令不被消费） */
  queueFoldCmd(op: string, args?: Record<string, unknown>): number {
    drainChannel()
    const seq = ++commandSeq
    pendingCommands.push({ seq, op, args })
    return seq
  },
  /** 取走已回结局（卸载场景断言空收件） */
  takeFoldResults(): Array<{ seq: number; outcome: unknown }> {
    drainChannel()
    return foldResults.splice(0)
  },
  /** paint 探针（生产 collectHeadingFoldPaint 采集体；浏览器有布局，
   *  visible 类字段为绘制层断言依据） */
  foldProbe() {
    const view = mainView()
    return view ? collectHeadingFoldPaint(view) : null
  },
  /** 实例折叠键集观测（本体 StateField 直读——API 结果的独立对照面） */
  foldKeys(): number[] {
    const keys = mainView()?.state.field(headingFoldField, false)
    return keys ? [...keys].sort((a, b) => a - b) : []
  },
  readEditor() {
    const view = mainView()!
    const main = view.state.selection.main
    return { text: view.state.doc.toString(), head: main.head }
  },
  /** 选区落位（apply 选区驱动三操作的定位入口——经 SDK 同链路由用例脚本
   *  直接驱动，此处只提供宿主侧等价选区事务） */
  setCursor(offset: number) {
    const view = mainView()!
    view.dispatch({ selection: { anchor: offset } })
  },
  /** 模式切换（宿主 view.mode.set 同款消息路径——Live-only 断言） */
  switchMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
})
