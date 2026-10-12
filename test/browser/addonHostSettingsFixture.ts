// #457 宿主设置读取面浏览器夹具：装配**生产** WebviewSyncController 与
// **生产**装载器（src/webview/addonPageLoader——与生产 main.js 同源装配，
// hostSettingsSnapshot 接线同 main.ts：controller.settingsSnapshotNow），
// hostSettings 夹具组件（.build/host-settings-addon/dist）经本地 http
// 服务以真实 URL 装载、经公开 SDK 的 experimental.hostSettings 消费。
// 夹具扮演宿主角色：
// - 读取指令收件箱（hostSettings.next 待发队列 + hostSettings.result
//   结局队列——短轮询驱动协议与 foldEditor 配对）；
// - 设置快照注入（settings.snapshot / settings.changed 经生产消息路径
//   进入 controller 缓存——codeCardChrome 同款手法）。
// 按键/命令全部由组件经公开 API 发起，夹具不代发。
import 'katex/dist/katex.min.css'
import * as cmState from '@codemirror/state'
import * as cmView from '@codemirror/view'
import * as cmLanguage from '@codemirror/language'
import { keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { WebviewSyncController } from '../../src/webview/syncController'
import { addonCm6LanguageSubset, installAddonPageLoader, type AddonPageLoaderHandle } from '../../src/webview/addonPageLoader'
import type { AddonChannelOutcome, AddonLoadOutcome, AddonPageOutbound } from '../../src/shared/addonPage'
import type { SettingsPayload } from '../../src/shared/settings'
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
const loader: AddonPageLoaderHandle = installAddonPageLoader({
  page: 'editor',
  cm6: { state: cmState, view: cmView, language: addonCm6LanguageSubset(cmLanguage) },
  attachExtensions: (extension) => {
    controller.reconfigureAddonExtensions(extension)
  },
  // 生产 main.ts 同款接线：宿主设置读取面的数据源（拉取式——设置消息
  // 到达即更新缓存，组件每次 get 取最新值）
  hostSettingsSnapshot: () => controller.settingsSnapshotNow(),
  send: (message) => outbound.push(message),
})

controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])

interface HostSettingsCommand {
  seq: number
  op: string
  args?: Record<string, unknown>
}

/** 待发指令队列（hostSettings.next 取走）与已回结局（hostSettings.result 收件） */
const pendingCommands: HostSettingsCommand[] = []
const getResults: Array<{ seq: number; outcome: unknown }> = []
let commandSeq = 0

const channelRequests: Array<{ requestId: string; topic: string; payload: unknown }> = []

/** 宿主角色：hostSettings.next 回下一条指令（或 null）、hostSettings.result 入收件箱 */
const drainChannel = () => {
  for (const message of outbound.splice(0)) {
    if (message.type !== 'addon.channel.request') {
      continue
    }
    channelRequests.push({ requestId: message.requestId, topic: message.topic, payload: message.payload })
    let outcome: AddonChannelOutcome
    if (message.topic === 'hostSettings.next') {
      outcome = { ok: true, result: pendingCommands.shift() ?? null }
    } else if (message.topic === 'hostSettings.result') {
      getResults.push(message.payload as { seq: number; outcome: unknown })
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
    controller.handleHostMessage({ kind: 'init', sessionId: 'host-settings-addon', docUri: 'file:///host-settings-addon.md', version: 1, text })
  },
  /** 宿主角色注入设置快照（生产消息路径——settings.snapshot/changed 共用
   *  的控制器缓存更新；kind 参数区分「初始拉取回填」与「保存热更广播」） */
  pushSettings(values: SettingsPayload, kind: 'settings.snapshot' | 'settings.changed' = 'settings.snapshot') {
    controller.handleHostMessage({ kind, values })
  },
  /** 塞一条读取指令并等组件执行回报（短轮询周期 ≤ 200ms + 缓冲） */
  async runHostSettingsOp(op: string, args?: Record<string, unknown>): Promise<unknown> {
    drainChannel()
    const seq = ++commandSeq
    pendingCommands.push({ seq, op, args })
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      drainChannel()
      const hit = getResults.find((r) => r.seq === seq)
      if (hit) {
        getResults.splice(getResults.indexOf(hit), 1)
        return hit.outcome
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(`hostSettings op ${op}#${seq} 未回报（收件 ${JSON.stringify(getResults)}）`)
  },
  async loadHostSettingsAddon(scriptUri: string, generation: number): Promise<AddonLoadOutcome> {
    drainChannel()
    const outcome = await loader.load({
      addonId: 'vsidian-test-fixture.addon-host-settings',
      generation,
      page: 'editor',
      scriptUri,
      cssUris: [],
    })
    drainChannel()
    return outcome
  },
  /** 宿主角色回执清点（通道观察） */
  channelRequestCount(topic: string): number {
    drainChannel()
    return channelRequests.filter((r) => r.topic === topic).length
  },
})
