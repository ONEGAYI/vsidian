// #360 T11 界面贡献浏览器夹具：装配**生产** WebviewSyncController、
// **生产**装载器、**生产**命令注册表与**生产**界面运行时（src/webview/
// addonUi——与生产 main.js 同源装配，含 bindHandleFactory 目标路由），
// 组件产物（.build/t11-addon/dist）经本地 http 服务以真实 URL 装载。夹具
// 扮演宿主角色：
// - t11 通道指令队列（t11.next 回执待发指令——openPanel/panelState 等）；
// - t11.register/t11.result 收件箱；
// - 组件界面绘制探针（直接 DOM 查询 + elementFromPoint 命中）。
// 点击与悬停只由浏览器真实指针驱动；按钮键盘激活走真实 Tab/Enter。
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
import { AddonUiRuntime } from '../../src/webview/addonUi'
import type { AddonChannelOutcome, AddonLoadOutcome, AddonPageOutbound } from '../../src/shared/addonPage'
import type { KeybindingOverrides } from '../../src/shared/keybindings'
import { t } from '../../src/shared/i18n'
import { bootLocaleFromDocument } from '../../src/webview/localeBoot'
import { installTooltipCard } from '../../src/webview/tooltipCard'
import '../../src/webview/main.css'

bootLocaleFromDocument()
// #300 统一自绘悬停提示（生产装配同 main.ts——组件按钮 tooltip 断言依赖）
installTooltipCard()

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
const registrations: unknown[] = []
const results: Array<{ seq: number; outcome: unknown }> = []
const channelRequests: Array<{ requestId: string; topic: string; payload: unknown }> = []
/** 待发指令队列（宿主角色——mjs 侧 queueT11 塞入） */
const pendingCommands: Array<{ seq: number; op: string }> = []
let seqCounter = 0

const addonCommands = new AddonCommandsRuntime({
  report: () => {},
})

// mount 先行（工具栏槽与面板 dock 随 buildToolbar/mount 创建——T11 界面
// 运行时构造需取真实容器）
controller.mount(document.getElementById('app')!, [keymap.of(defaultKeymap)])

const addonViews = new AddonViewRegistry()
// T11：生产界面运行时（与 main.js 同源装配——槽/dock/目标路由/键位徽章）
const addonUi = new AddonUiRuntime({
  toolbarSlot: controller.addonToolbarSlot()!,
  panelDock: controller.addonPanelDock()!,
  currentMode: () => controller.viewModeNow(),
  activeInstanceId: () => controller.addonActiveInstanceId(),
  executeCommand: (commandId) => controller.runAddonCommand(commandId),
  bindingHints: (commandId) => controller.addonEffectiveBindings(commandId),
  panelCloseLabel: () => t('addonUi.panelClose'),
  log: (detail) => console.warn(`[t11-fixture] ${detail}`),
})
const loader: AddonPageLoaderHandle = installAddonPageLoader({
  page: 'editor',
  cm6: { state: cmState, view: cmView, language: addonCm6LanguageSubset(cmLanguage) },
  attachExtensions: (extension) => {
    controller.reconfigureAddonExtensions(extension)
  },
  addonViews,
  addonCommands,
  addonUi,
  send: (message) => outbound.push(message),
})
addonUi.bindHandleFactory((addonId, instanceId) => loader.buildViewHandle(addonId, instanceId))
controller.attachAddonViews(addonViews)
controller.attachAddonCommands(addonCommands)
controller.attachAddonUi(addonUi)

const collectOutbound = () => {
  for (const message of outbound.splice(0)) {
    if (message.type === 'addon.channel.request') {
      channelRequests.push({ requestId: message.requestId, topic: message.topic, payload: message.payload })
    }
  }
}

/** 通道请求自动回执（宿主角色：t11.register/t11.result 收件；t11.next 回执待发指令） */
const drainChannel = () => {
  collectOutbound()
  for (const request of channelRequests.splice(0)) {
    let outcome: AddonChannelOutcome
    if (request.topic === 't11.register') {
      registrations.push(request.payload)
      outcome = { ok: true, result: 'ok' }
    } else if (request.topic === 't11.next') {
      outcome = { ok: true, result: pendingCommands.shift() ?? null }
    } else if (request.topic === 't11.result') {
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
  initDoc(text: string) {
    controller.handleHostMessage({ kind: 'init', sessionId: 't11-addon', docUri: 'file:///t11-addon.md', version: 1, text })
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
  async loadT11(scriptUri: string, generation: number): Promise<AddonLoadOutcome> {
    collectOutbound()
    const outcome = await loader.load({
      addonId: 'vsidian-test-fixture.addon-t11',
      generation,
      page: 'editor',
      scriptUri,
      cssUris: [],
    })
    collectOutbound()
    drainChannel()
    return outcome
  },
  async unloadT11(generation: number) {
    const outcome = await loader.unload('vsidian-test-fixture.addon-t11', generation)
    collectOutbound()
    return outcome
  },
  /** 塞指令并等结局（mjs 侧驱动组件 ops 的入口） */
  async runOp<T>(op: string): Promise<T | undefined> {
    drainChannel()
    pendingCommands.push({ seq: ++seqCounter, op })
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      drainChannel()
      const found = results.splice(0).find((entry) => entry.seq === seqCounter)
      if (found) {
        return found.outcome as T
      }
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return undefined
  },
  takeRegistrations() {
    drainChannel()
    return registrations.splice(0)
  },
  /** 键位快照伪造（键位徽章数据源——ctrl+alt+t 默认经运行期表即可命中） */
  applyKeybindings(overrides: KeybindingOverrides) {
    controller.handleHostMessage({ kind: 'keybindings.snapshot', overrides })
  },
  switchMode(mode: 'live' | 'reading') {
    controller.handleHostMessage({ kind: 'view.mode.set', mode })
  },
  /** 组件界面绘制探针（按钮/面板的 DOM 在场 + elementFromPoint 命中） */
  probeAddonUi() {
    const visible = (el: Element | null): boolean => {
      if (!(el instanceof HTMLElement) || !el.isConnected) {
        return false
      }
      try {
        const rect = el.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) {
          return false
        }
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
        return hit !== null && el.contains(hit)
      } catch {
        return false
      }
    }
    const slot = document.querySelector('.vsidian-addon-toolbar-slot')
    const dock = document.querySelector('.vsidian-addon-panel-dock')
    return {
      buttons: [...(slot?.querySelectorAll<HTMLElement>('button') ?? [])].map((el) => ({
        id: el.dataset['addonButton'] ?? '',
        label: el.getAttribute('aria-label') ?? '',
        tooltip: el.getAttribute('data-tooltip') ?? '',
        tooltipKeys: el.getAttribute('data-tooltip-keys'),
        visible: visible(el),
      })),
      slotVisible: visible(slot),
      dockVisible: visible(dock),
      panels: [...(dock?.querySelectorAll<HTMLElement>('.vsidian-addon-panel') ?? [])].map((el) => ({
        id: el.dataset['addonPanel'] ?? '',
        title: el.querySelector('.vsidian-addon-panel-title')?.textContent ?? '',
        content: el.querySelector('.vsidian-addon-panel-root')?.textContent ?? '',
        contentVisible: visible(el.querySelector('.vsidian-addon-panel-root')),
        closeLabel: el.querySelector('.vsidian-addon-panel-close')?.getAttribute('aria-label') ?? '',
      })),
    }
  },
  readEditor() {
    const view = EditorView.findFromDOM(document.querySelector('.cm-editor')!)!
    const main = view.state.selection.main
    return { text: view.state.doc.toString(), head: main.head }
  },
})
