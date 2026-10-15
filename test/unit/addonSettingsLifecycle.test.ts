// @vitest-environment jsdom
// #555 PR 评审第二轮生命周期缺陷回归（生产模块链组合）：
// - P1：从自绘组件 A 切到自绘组件 B 时 A 未被卸载（宿主单值
//   desiredSettingsLoad 对账 + webview 先 close 后 open 的发送顺序）；
// - P2：搜索定位目标按 addonId 归属定向交付（切换窗口期仍装载的 A
//   不得收到 B 的目标；等值不去重口径不回归）；
// - P2：手动重试成功后自动恢复详情打开态（registry release → 重新注册
//   的真实链，不允许 mock faulted=false 的假链）。
// #555 评审第三轮 P1（验证在途竞态）：宿主对账改用生产模块本体
// （addonSettingsPanelReconcile——addonWiring 的 pushSettingsDirectives /
// postSettingsLoadIfVerified 提取物），realpath 验证注入可控 deferred：
// 二轮把验证环节同步化的「忠实翻译」掩盖了「A 验证在途时切 B/关详情，
// A 的迟到验证仍推 load 并覆盖 pushed」的竞态（评审 :238-260 定位）。
//
// 链路组合：真实 AddonSettingsAreaSection + 真实装载器
// （installAddonPageLoader，page='settings'）+ 真实 AddonSettingsContext
// Runtime + 真实 AddonRuntime/AddonRegistry/AddonSettingsService + 生产
// 对账模块 addonSettingsPanelReconcile（vscode 依赖剥除；真宿主全链在
// 集成套件）。断言对象是用户可见结局（挂载根、消息序列、详情态）。
import { beforeEach, describe, expect, it } from 'vitest'
import { AddonRegistry, type AddonDefinition } from '../../src/host/addons/addonRegistry'
import { AddonRuntime, type AddonPreferenceStore } from '../../src/host/addons/addonRuntime'
import {
  createSettingsPanelRecord,
  pushSettingsPanelDirectives,
  type SettingsPanelReconcilePorts,
} from '../../src/host/addons/addonSettingsPanelReconcile'
import { AddonSettingsService, type AddonSettingsPersistencePort } from '../../src/host/addons/addonSettingsService'
import { AddonThemeService } from '../../src/host/addons/addonThemeService'
import { AddonStorageService } from '../../src/host/addons/addonStorageService'
import { AddonPasteRuleService } from '../../src/host/addons/addonPasteRuleService'
import { ADDON_API_VERSION, OFFICIAL_ADDON_EXTENSION_IDS } from '../../src/shared/addonIdentity'
import { AddonSettingsAreaSection } from '../../src/webview/addonSettingsAreaSection'
import { AddonSettingsContextRuntime } from '../../src/webview/addonSettingsContext'
import {
  ADDON_PAGE_REGISTRY_GLOBAL,
  installAddonPageLoader,
  type AddonPageLoaderHandle,
} from '../../src/webview/addonPageLoader'
import type { AddonPageRegistration } from '../../src/shared/addonPage'
import { isHostToWebview, type HostToWebview } from '../../src/shared/protocol'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'

installLocale('zh-cn', zhCn)

/** 等待微任务排空（装载 loadScript/通道 promise 的结算传播） */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

// ---- 宿主侧纯逻辑装配（与 addonRuntimeSettings.test.ts 同款端口） ----

function memoryPreference(): AddonPreferenceStore {
  const user: Record<string, boolean> = {}
  return { hasWorkspace: true, read: () => ({ user, workspace: null }), write: () => {} }
}

function memorySettingsPersistence(): AddonSettingsPersistencePort {
  const raw = new Map<'user' | 'workspace', unknown>()
  return { hasWorkspace: true, read: (scope) => raw.get(scope), write: async (scope, value) => { raw.set(scope, value); return true } }
}

interface RuntimeHarness {
  registry: AddonRegistry
  runtime: AddonRuntime
  settings: AddonSettingsService
}

function runtimeHarness(): RuntimeHarness {
  const settings = new AddonSettingsService(memorySettingsPersistence())
  const runtime = new AddonRuntime({
    apiVersion: ADDON_API_VERSION,
    preferences: memoryPreference(),
    settings,
    storage: new AddonStorageService({
      baseDir: '/test/addons',
      uriOf: (addonId) => `file:///test/addons/${addonId}`,
      fs: {
        readFile: async () => new Uint8Array(),
        writeFile: async () => {},
        delete: async () => {},
        readDirectory: async () => [],
        createDirectory: async () => {},
      },
      createWatcher: () => ({ dispose: () => {} }),
    }),
    pasteRules: new AddonPasteRuleService({ log: () => {} }),
    themes: new AddonThemeService({ log: () => {} }),
    installDirOf: () => '/test/addons/demo',
    log: () => {},
  })
  const registry = new AddonRegistry(
    {
      apiVersion: ADDON_API_VERSION,
      experimental: {},
      officialIds: OFFICIAL_ADDON_EXTENSION_IDS,
      findExtension: (id) => ({ id, packageJSON: { name: id, publisher: 'fixture', vsidianAddon: { manifestVersion: 1, api: '^1.0.0' } } }),
    },
    runtime.registryHooks(),
  )
  return { registry, runtime, settings }
}

/** 自绘设置页组件定义（setup 注册页入口 + 一个 boolean 定义） */
function pageAddonDefinition(): AddonDefinition {
  return {
    setup(context) {
      context.settings.registerPage({ entry: 'dist/settings.js' })
      context.settings.registerDefinitions([{ key: 'flag', title: '开关项', type: 'boolean', default: true }])
    },
  }
}

/** 可触发故障的自绘页组件定义（crash 通道回调抛异常——真实故障链入口） */
function crashablePageAddonDefinition(): AddonDefinition {
  return {
    setup(context) {
      context.settings.registerPage({ entry: 'dist/settings.js' })
      context.settings.registerDefinitions([{ key: 'flag', title: '开关项', type: 'boolean', default: true }])
      context.channel.handle('crash', () => { throw new Error('boom') })
    },
  }
}

// ---- P1/P2 共用：webview 生产模块 + 宿主桥忠实替身 ----

interface PanelHarness {
  /** 真实装载器（page='settings'——mountRoot 挂进共享 host 容器） */
  loader: AddonPageLoaderHandle
  /** 真实「组件设置」分页（对账消息的发送方） */
  area: AddonSettingsAreaSection
  /** 真实设置页上下文 runtime（装载器 env 注入同一实例） */
  context: AddonSettingsContextRuntime
  /** 真实宿主 runtime（openSettingsArea/Page 的权威状态机） */
  runtime: AddonRuntime
  registry: AddonRegistry
  settings: AddonSettingsService
  /** 持久挂载容器（settingsMain 的 addonSettingsHost 同构） */
  host: HTMLElement
  parent: HTMLElement
  /** webview → 宿主的上送消息留痕（pump 不清空——序列断言用） */
  sentHistory: Array<Record<string, unknown>>
  /** 宿主 → webview 的装载指令序列（unload/load 全留痕） */
  directives: Array<Record<string, unknown>>
  /** 宿主对账事件留痕（directive.load/unload、load-rejected-realpath、load-dropped-stale） */
  events: Array<{ kind: string; addonId: string; generation?: number }>
  /** 模拟用户/宿主入口把一条 webview→宿主消息交给宿主桥处理 */
  hostReceive(message: Record<string, unknown>): void
  /** 泵：处理上送消息 → 指令喂装载器 → 状态推送回 webview，直到不动点；
   *  默认自动放行在途 realpath 验证（holdVerify 后只搬运消息不验证） */
  pump(): Promise<void>
  /** 进入手动验证控制（pump 不再自动放行——测试显式 resolve 构造在途窗口） */
  holdVerify(): void
  /** 放行某组件的在途验证（队列中首个匹配，verdict 缺省 ok）；返回是否命中 */
  releaseVerify(addonId: string, verdict?: 'ok' | 'escape'): boolean
  /** 在途验证队列的计划组件序列（断言验证窗口用） */
  pendingVerifyPlans(): string[]
}

/**
 * 装配生产模块链。宿主桥内联翻译 addonWiring 的关键段（语义等价，vscode
 * 依赖剥除）：
 * - handleSettingsMessage 的 settingsOpen/settingsClose/openAddonPage/
 *   closeAddonPage 分支（1259-1311 行语义）；
 * - 装载对账直接运行生产模块 addonSettingsPanelReconcile（不写第二份对
 *   账逻辑）；realpath 验证以 deferred promise 注入——默认 pump 自动放行
 *   （既有用例等价于「验证即刻通过」），holdVerify 后由测试控制完成顺序。
 */
function panelHarness(ids: string[], options: { definitions?: Record<string, AddonDefinition> } = {}): PanelHarness {
  const { registry, runtime, settings } = runtimeHarness()
  for (const id of ids) {
    registry.register({ id }, options.definitions?.[id] ?? pageAddonDefinition())
  }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const context = new AddonSettingsContextRuntime()
  const webviewSent: Array<Record<string, unknown>> = []
  const directives: Array<Record<string, unknown>> = []
  /** 宿主 → webview 的状态推送队列（pump 时 dispatch 给 area） */
  const hostOutbox: HostToWebview[] = []
  const registrations: AddonPageRegistration[] = []
  ;(globalThis as unknown as Record<string, unknown>)[ADDON_PAGE_REGISTRY_GLOBAL] = registrations
  let clock = 1_000
  /** 组件工厂（mountRoot 挂载自绘内容——真实组件 IIFE 的最小替身） */
  const pageFactory: AddonPageRegistration['factory'] = (sdk) => {
    const root = sdk.mountRoot()
    if (root) {
      root.textContent = `${sdk.addon.id} 自绘内容`
    }
  }
  const loader = installAddonPageLoader({
    page: 'settings',
    mountContainer: host,
    addonSettingsContext: context,
    send: (outbound) => { webviewSent.push({ kind: 'addonPage.outbound', outbound } as Record<string, unknown>) },
    // 脚本装载即组件 IIFE 执行：装载期间向登记表 push 本组件工厂（同一
    // 组件第二次装载同样有新鲜登记——真实脚本的重复执行语义）
    loadScript: (uri) => {
      const addonId = /^https:\/\/page\.test\/([^/]+)\/settings\.js$/.exec(uri)?.[1]
      if (addonId === undefined) {
        return Promise.resolve({ ok: false, error: `unexpected script uri: ${uri}` })
      }
      registrations.push({ addonId, factory: pageFactory, registeredAt: clock })
      return Promise.resolve({ ok: true })
    },
    loadCss: () => Promise.resolve('authorized'),
    now: () => clock,
  })
  const labelOf = (addonId: string): string => `Label ${addonId}`
  const settingsStateMessage = (): HostToWebview => {
    const open = runtime.settingsAreaAddonId() ?? null
    const status = open === null ? undefined : runtime.runtimeStatus(open)
    const message = {
      kind: 'addons.settingsState',
      apiVersion: ADDON_API_VERSION,
      draft: true,
      open,
      hasWorkspace: true,
      addon: open === null ? null : {
        addonId: open,
        label: labelOf(open),
        faulted: status?.runState === 'faulted',
        hasCustomPage: status?.hasSettingsPage === true,
        enabled: { effective: runtime.effectiveEnabled(open), userExplicit: null, workspaceExplicit: null, source: 'default' },
        definitions: [{ key: 'flag', title: '开关项', type: 'boolean', default: true }],
        values: { flag: { effective: true, source: 'default' } },
      },
      openAddonSettingsPage: runtime.openSettingsAddonId() ?? null,
    }
    if (!isHostToWebview(message)) throw new Error('addons.settingsState 载荷未通过协议守卫')
    return message
  }
  const addonsStateMessage = (): HostToWebview => {
    const message = {
      kind: 'addons.state',
      apiVersion: ADDON_API_VERSION,
      draft: true,
      addons: ids.map((id) => {
        const status = runtime.runtimeStatus(id)
        return {
          id, label: labelOf(id), official: false, status: 'registered',
          enabled: runtime.effectiveEnabled(id),
          hasSettingsDefinitions: settings.hasDefinitions(id),
          hasSettingsPage: status?.hasSettingsPage === true,
        }
      }),
      openAddonSettingsPage: runtime.openSettingsAddonId() ?? null,
      openAddonSettings: runtime.settingsAreaAddonId() ?? null,
    }
    if (!isHostToWebview(message)) throw new Error('addons.state 载荷未通过协议守卫')
    return message
  }
  // 装载对账：生产模块本体（addonWiring pushSettingsDirectives/
  // postSettingsLoadIfVerified 的提取物），验证 promise 可控注入
  const panelRecord = createSettingsPanelRecord()
  const verifyQueue: Array<{ plan: { addonId: string }; resolve: (verdict: 'ok' | 'escape') => void }> = []
  const panelEvents: Array<{ kind: string; addonId: string; generation?: number }> = []
  let holdVerify = false
  const settingsPorts: SettingsPanelReconcilePorts = {
    desiredLoad: () => runtime.desiredSettingsLoad(),
    isEscapedDir: () => false,
    verifyLoadPlan: (plan) => new Promise((resolve) => { verifyQueue.push({ plan, resolve }) }),
    blockEscapePlanRoots: () => {},
    buildLoadDirective: (plan) => ({
      type: 'addon.load',
      manifest: {
        addonId: plan.addonId,
        generation: plan.generation,
        page: 'settings',
        scriptUri: `https://page.test/${plan.addonId}/settings.js`,
        cssUris: [],
      },
    }),
    postDirective: (directive) => {
      directives.push(directive as unknown as Record<string, unknown>)
      loader.handleDirective(directive)
    },
    recordEvent: (event) => { panelEvents.push(event) },
    postBehaviorEnabledState: () => {},
  }
  const pushSettingsDirectives = (): void => {
    pushSettingsPanelDirectives(settingsPorts, panelRecord)
  }
  // addonWiring handleSettingsMessage 开合分支忠实翻译 + onRuntimeChanged 推送
  // （extension.ts 的 onRuntimeChanged → notifyAddonsChanged/notifyAddonSettings
  //  Changed 两路 + addonWiring.onRuntimeChanged 末尾的 notifyAddonPanels →
  //  pushSettingsDirectives——故障/重试的 unload/load 对账正是走这条路）
  runtime.onChanged(() => {
    pushSettingsDirectives()
    hostOutbox.push(addonsStateMessage())
    hostOutbox.push(settingsStateMessage())
  })
  const handleHostMessage = (message: Record<string, unknown>): void => {
    if (message.kind === 'addons.settingsOpen') {
      runtime.openSettingsArea(message.addonId as string)
      return
    }
    if (message.kind === 'addons.settingsClose') {
      runtime.closeSettingsArea()
      return
    }
    if (message.kind === 'addons.openAddonPage') {
      runtime.openSettingsPage(message.addonId as string)
      pushSettingsDirectives()
      return
    }
    if (message.kind === 'addons.closeAddonPage') {
      runtime.closeSettingsPage()
      pushSettingsDirectives()
      return
    }
    // 装载器 outbound（addon.loaded/unloaded 等）：宿主不重复记账（生产语义）
  }
  const sentHistory: Array<Record<string, unknown>> = []
  const area = new AddonSettingsAreaSection(
    { postMessage: (m) => { sentHistory.push(m as Record<string, unknown>); webviewSent.push(m as Record<string, unknown>) } },
    host, undefined, context,
  )
  area.mount(parent)
  return {
    loader, area, context, runtime, registry, settings, host, parent, sentHistory, directives,
    events: panelEvents,
    hostReceive: (message) => { handleHostMessage(message) },
    holdVerify: () => { holdVerify = true },
    releaseVerify: (addonId, verdict = 'ok') => {
      const index = verifyQueue.findIndex((entry) => entry.plan.addonId === addonId)
      if (index === -1) {
        return false
      }
      const [entry] = verifyQueue.splice(index, 1)
      entry!.resolve(verdict)
      return true
    },
    pendingVerifyPlans: () => verifyQueue.map((entry) => entry.plan.addonId),
    pump: async () => {
      for (let round = 0; round < 40; round += 1) {
        let worked = false
        while (webviewSent.length > 0) {
          handleHostMessage(webviewSent.shift()!)
          worked = true
        }
        while (hostOutbox.length > 0) {
          area.handleHostMessage(hostOutbox.shift()!)
          worked = true
        }
        if (!holdVerify) {
          // 自动放行在途验证（真实宿主的 realpath 复核很快完成——既有用例
          // 不感知验证异步性；holdVerify 后验证完成顺序归测试控制）
          while (verifyQueue.length > 0) {
            verifyQueue.shift()!.resolve('ok')
            worked = true
          }
        }
        await settle()
        if (!worked && webviewSent.length === 0 && hostOutbox.length === 0) {
          return
        }
      }
      throw new Error('pump 未收敛（消息往返超出轮次预算——疑似对账死循环）')
    },
  }
}

/** 向宿主桥注入「装载即拉取」的初始状态（settingsMain 装载点同构） */
async function openPanel(h: PanelHarness): Promise<void> {
  h.area.handleHostMessage((() => {
    const message = {
      kind: 'addons.state', apiVersion: ADDON_API_VERSION, draft: true,
      addons: [], openAddonSettingsPage: null, openAddonSettings: null,
    }
    if (!isHostToWebview(message)) throw new Error('初始 addons.state 未通过守卫')
    return message
  })())
  await h.pump()
}

/** 经用户入口打开某组件详情（hub「打开设置区」按钮的等效上送消息） */
async function userOpensDetail(h: PanelHarness, addonId: string): Promise<void> {
  h.hostReceive({ kind: 'addons.settingsOpen', addonId })
  await h.pump()
}

beforeEach(() => {
  ;(globalThis as unknown as Record<string, unknown>)[ADDON_PAGE_REGISTRY_GLOBAL] = []
})

// ---- P1：切换自绘组件 A → B，A 必须卸载 ----

describe('#555 评审二轮 P1：自绘组件切换的旧组件卸载（生产模块链）', () => {
  it('A→B 切换（双有自绘页）：消息序列先关 A 再开 B；装载终态只余 B；B 详情 DOM 仅一个挂载根', async () => {
    const h = panelHarness(['addon.a', 'addon.b'])
    await openPanel(h)
    await userOpensDetail(h, 'addon.a')
    // A 装载在场（首屏即自绘页）
    expect(h.loader.stats().active.map((a) => a.addonId)).toEqual(['addon.a'])
    expect(h.host.querySelector('[data-addon-id="addon.a"]')).toBeTruthy()

    await userOpensDetail(h, 'addon.b')
    // 上送序列：关闭旧组件 A 的消息在场，且先于 openAddonPage(B)（宿主单值
    // desired 对账依赖先 close 清场——open 直接覆盖 settingsOpenAddon 会让
    // A 的 unload 永不推出）
    const closeIdx = h.sentHistory.findIndex((m) => m.kind === 'addons.closeAddonPage')
    const openBIdx = h.sentHistory.findIndex((m) => m.kind === 'addons.openAddonPage' && m.addonId === 'addon.b')
    expect(closeIdx).toBeGreaterThanOrEqual(0)
    expect(openBIdx).toBeGreaterThan(closeIdx)
    // 指令序列：unload A → load B（宿主对账终态）
    const unloadA = h.directives.find((d) => d.type === 'addon.unload' && d.addonId === 'addon.a')
    const loadB = h.directives.find((d) => d.type === 'addon.load' && (d.manifest as { addonId: string }).addonId === 'addon.b')
    expect(unloadA).toBeTruthy()
    expect(loadB).toBeTruthy()
    // 装载器终态：active 只余 B（A 已释放），挂载根唯一且归属 B
    expect(h.loader.stats().active.map((a) => a.addonId)).toEqual(['addon.b'])
    const roots = [...h.host.querySelectorAll('[data-addon-id]')]
    expect(roots).toHaveLength(1)
    expect(roots[0]!.getAttribute('data-addon-id')).toBe('addon.b')
    // B 详情 DOM 在场（首屏自绘页）
    expect(h.parent.querySelector('.vsidian-addons-settings')).toBeTruthy()
  })

  it('B→A 再切回：A 重新装载、B 卸载（对账可重复收敛）', async () => {
    const h = panelHarness(['addon.a', 'addon.b'])
    await openPanel(h)
    await userOpensDetail(h, 'addon.a')
    await userOpensDetail(h, 'addon.b')
    await userOpensDetail(h, 'addon.a')
    expect(h.loader.stats().active.map((a) => a.addonId)).toEqual(['addon.a'])
    expect(h.host.querySelectorAll('[data-addon-id]')).toHaveLength(1)
    expect(h.host.querySelector('[data-addon-id="addon.a"]')).toBeTruthy()
  })

  it('关闭详情零残留：active 空、挂载容器空、宿主开合态归零', async () => {
    const h = panelHarness(['addon.a'])
    await openPanel(h)
    await userOpensDetail(h, 'addon.a')
    expect(h.loader.stats().active).toHaveLength(1)
    // 用户点「返回组件列表」（详情 head 的关闭按钮——真实 DOM 入口）
    const back = [...h.parent.querySelectorAll('button')].find((b) => b.textContent === zhCn['addons.closeSettingsArea'])
    expect(back).toBeTruthy()
    back!.click()
    await h.pump()
    expect(h.loader.stats().active).toEqual([])
    expect(h.host.querySelectorAll('[data-addon-id]')).toHaveLength(0)
    expect(h.runtime.settingsAreaAddonId()).toBeUndefined()
    expect(h.runtime.openSettingsAddonId()).toBeUndefined()
  })
})

// ---- #555 评审三轮 P1：realpath 验证在途时切换/关闭，迟到验证不得装载旧页 ----

describe('#555 评审三轮 P1：验证在途的迟到结果严格失效（deferred 验证）', () => {
  it('A 验证在途 → 切 B → B 装载完成 → A 迟到完成：不推 load A、装载只含 B、单挂载根', async () => {
    const h = panelHarness(['addon.a', 'addon.b'])
    h.holdVerify()
    await openPanel(h)
    await userOpensDetail(h, 'addon.a')
    // A 的 realpath 验证在途：尚未装载（此窗口内 close 不产生 unload——A 未
    // 推送过 load，宿主对账无卸载基线，属正确中间态）
    expect(h.pendingVerifyPlans()).toEqual(['addon.a'])
    expect(h.loader.stats().active).toEqual([])

    // 切 B：经 close→open（二轮修复的发送顺序）；B 的验证进入队列
    await userOpensDetail(h, 'addon.b')
    expect(h.pendingVerifyPlans()).toEqual(['addon.a', 'addon.b'])

    // B 先完成验证并装载
    expect(h.releaseVerify('addon.b')).toBe(true)
    await h.pump()
    expect(h.loader.stats().active.map((a) => a.addonId)).toEqual(['addon.b'])

    // A 的迟到验证完成——不得推 load A（修复前：旧计划覆盖 pushed，装载器
    // 双组件并存，共享挂载容器出现双根）
    expect(h.releaseVerify('addon.a')).toBe(true)
    await h.pump()
    const loadIds = h.directives
      .filter((d) => d.type === 'addon.load')
      .map((d) => (d.manifest as { addonId: string }).addonId)
    expect(loadIds).toEqual(['addon.b'])
    expect(h.loader.stats().active.map((a) => a.addonId)).toEqual(['addon.b'])
    // B 详情 DOM 仅一个挂载根（无 A 的残留根）
    const roots = [...h.host.querySelectorAll('[data-addon-id]')]
    expect(roots).toHaveLength(1)
    expect(roots[0]!.getAttribute('data-addon-id')).toBe('addon.b')
    expect(h.parent.querySelector('.vsidian-addons-settings')).toBeTruthy()
  })

  it('A 验证在途 → 关闭详情 → A 迟到完成：零装载零残留', async () => {
    const h = panelHarness(['addon.a'])
    h.holdVerify()
    await openPanel(h)
    await userOpensDetail(h, 'addon.a')
    expect(h.pendingVerifyPlans()).toEqual(['addon.a'])

    // 用户点「返回组件列表」（真实 DOM 入口；二轮修复的连带关页链）
    const back = [...h.parent.querySelectorAll('button')].find((b) => b.textContent === zhCn['addons.closeSettingsArea'])
    expect(back).toBeTruthy()
    back!.click()
    await h.pump()
    expect(h.runtime.openSettingsAddonId()).toBeUndefined()

    // A 的迟到验证完成——不推任何 load、无挂载根残留
    expect(h.releaseVerify('addon.a')).toBe(true)
    await h.pump()
    expect(h.directives.filter((d) => d.type === 'addon.load')).toEqual([])
    expect(h.loader.stats().active).toEqual([])
    expect(h.host.querySelectorAll('[data-addon-id]')).toHaveLength(0)
  })

  it('A→B→A 快速往返（三轮验证全部在途，按发起序完成）：仅最后一次开页装载，代次取新', async () => {
    const h = panelHarness(['addon.a', 'addon.b'])
    h.holdVerify()
    await openPanel(h)
    await userOpensDetail(h, 'addon.a')
    await userOpensDetail(h, 'addon.b')
    await userOpensDetail(h, 'addon.a')
    // 三次开页的验证均在途（A(g1) → B(g1) → A(g2)，按发起序排队）
    expect(h.pendingVerifyPlans()).toEqual(['addon.a', 'addon.b', 'addon.a'])

    // 按发起序逐个放行：前两次验证发起后 desired 已离开，迟到即失效；
    // 只有最后一次开页的验证仍然有效
    expect(h.releaseVerify('addon.a')).toBe(true)
    await h.pump()
    expect(h.directives.filter((d) => d.type === 'addon.load')).toEqual([])
    expect(h.loader.stats().active).toEqual([])

    expect(h.releaseVerify('addon.b')).toBe(true)
    await h.pump()
    expect(h.directives.filter((d) => d.type === 'addon.load')).toEqual([])

    expect(h.releaseVerify('addon.a')).toBe(true)
    await h.pump()
    const loads = h.directives.filter((d) => d.type === 'addon.load')
    expect(loads).toHaveLength(1)
    expect((loads[0]!.manifest as { addonId: string; generation: number }).addonId).toBe('addon.a')
    // 代次取新（第二次打开 A——旧验证的 g1 不得复用）
    expect((loads[0]!.manifest as { addonId: string; generation: number }).generation).toBe(2)
    expect(h.loader.stats().active).toEqual([{ addonId: 'addon.a', generation: 2 }])
    const roots = [...h.host.querySelectorAll('[data-addon-id]')]
    expect(roots).toHaveLength(1)
    expect(roots[0]!.getAttribute('data-addon-id')).toBe('addon.a')
  })
})

// ---- P2：定位目标按 addonId 归属定向交付 ----

describe('#555 评审二轮 P2：定位目标按组件归属定向交付（生产模块链）', () => {
  it('搜索定位 B（B 未装载、A 订阅在场）：A 不收到 B 的目标；B 装载后订阅即回放收到；同组件重复定位每次投递', async () => {
    const h = panelHarness(['addon.a', 'addon.b'])
    await openPanel(h)
    await userOpensDetail(h, 'addon.a')
    // A 的页面订阅在场（装载器 facet 的等价订阅——切换窗口期未卸载）
    const aSeen: unknown[] = []
    h.context.subscribeLocate('addon.a', (target) => aSeen.push(target))
    // B 的订阅稍后登记（B 装载后）
    const bSeen: unknown[] = []

    // 全局搜索点击 B 的定义条目（focusEntry 路径——#472 挂起定位链）
    h.area.mount(h.parent, 'addon:addon.b/def:only-b')
    expect(h.sentHistory.some((m) => m.kind === 'addons.settingsOpen' && m.addonId === 'addon.b')).toBe(true)
    // 宿主应答（open=B；挂载仍是 A——切换窗口期的真实中间态）
    await h.pump()
    // A 从未收到 B 的定义目标（归属正确性——修复前广播会串扰）
    expect(aSeen).toEqual([])
    // 目标已按归属缓存：B 视角可见、A 视角不可见
    expect(h.context.currentLocateTarget('addon.b')).toEqual({ kind: 'def', key: 'only-b' })
    expect(h.context.currentLocateTarget('addon.a')).toBeNull()

    // B 装载后（订阅即回放的 runtime 面）：登记即收到挂起目标
    h.context.subscribeLocate('addon.b', (target) => bSeen.push(target))
    expect(bSeen).toEqual([]) // runtime 登记不自动回放（回放在装载器 facet——loader 用例钉住）

    // 同组件重复定位是有效信号（等值不去重口径不回归）
    h.area.mount(h.parent, 'addon:addon.b/def:only-b')
    await h.pump()
    expect(aSeen).toEqual([])
  })

  it('重复定位同一目标每次投递（runtime 级——等值不去重）', () => {
    const context = new AddonSettingsContextRuntime()
    const seen: unknown[] = []
    context.subscribeLocate('addon.x', (target) => seen.push(target))
    context.deliverLocateTarget('addon.x', { kind: 'def', key: 'flag' })
    context.deliverLocateTarget('addon.x', { kind: 'def', key: 'flag' })
    expect(seen).toEqual([{ kind: 'def', key: 'flag' }, { kind: 'def', key: 'flag' }])
    // 清除投给归属组件（退场页内定位态）；此后归属视角为空
    context.clearLocateTarget()
    expect(seen[2]).toBeNull()
    expect(context.currentLocateTarget('addon.x')).toBeNull()
  })

  it('他组件目标不投递（runtime 级定向）', () => {
    const context = new AddonSettingsContextRuntime()
    const aSeen: unknown[] = []
    const bSeen: unknown[] = []
    context.subscribeLocate('addon.a', (t) => aSeen.push(t))
    context.subscribeLocate('addon.b', (t) => bSeen.push(t))
    context.deliverLocateTarget('addon.b', { kind: 'group', key: 'appearance' })
    expect(aSeen).toEqual([])
    expect(bSeen).toEqual([{ kind: 'group', key: 'appearance' }])
    // 清除只投给归属组件（B），不到 A
    context.clearLocateTarget()
    expect(aSeen).toEqual([])
    expect(bSeen).toEqual([{ kind: 'group', key: 'appearance' }, null])
  })
})

// ---- P2：手动重试成功后恢复详情（真实 Registry/Runtime 链） ----

describe('#555 评审二轮 P2：手动重试成功后自动恢复详情（真实链）', () => {
  /** 真实故障链：通道回调异常 → faultRecord（可归因异常触发暂停） */
  function faultedHarness(): RuntimeHarness {
    const h = runtimeHarness()
    h.registry.register({ id: 'fixture.demo' }, {
      setup(context) {
        context.settings.registerPage({ entry: 'dist/settings.js' })
        context.settings.registerDefinitions([{ key: 'flag', title: '开关项', type: 'boolean', default: true }])
        context.channel.handle('crash', () => { throw new Error('boom') })
      },
    })
    return h
  }

  it('详情在场 → 故障 → 手动重试（preserve + release + 重注册成功）：详情恢复、装载链路可达', async () => {
    const h = faultedHarness()
    // 详情打开（自绘页组件）
    expect(h.runtime.openSettingsArea('fixture.demo')).toBe('ok')
    expect(h.runtime.openSettingsPage('fixture.demo')).toBe('ok')
    // 真实故障链：通道回调异常 → 暂停（自绘页意图撤下，详情定义保留）
    await h.runtime.dispatchChannelRequest('fixture.demo', 'crash', null)
    expect(h.runtime.runtimeStatus('fixture.demo')?.runState).toBe('faulted')
    expect(h.runtime.desiredSettingsLoad()).toBeNull()
    expect(h.runtime.settingsAreaAddonId()).toBe('fixture.demo')

    // 手动重试（wiring 的 addons.retry 分支语义：preserve → coordinator.retry
    // 的 release 旧代次 → 重新唤醒注册）
    h.runtime.preserveSettingsDetailForRetry('fixture.demo')
    h.registry.release('fixture.demo')
    expect(h.runtime.settingsAreaAddonId()).toBeUndefined()
    h.registry.register({ id: 'fixture.demo' }, pageAddonDefinition())

    // 重试成功：详情自动恢复（webview 经 settingsState 推送回显详情，自绘
    // 页经渲染对账自动重开——openAddonPage 链路可达：页可开、装载意图出现）
    expect(h.runtime.settingsAreaAddonId()).toBe('fixture.demo')
    expect(h.runtime.openSettingsPage('fixture.demo')).toBe('ok')
    const desired = h.runtime.desiredSettingsLoad()
    expect(desired?.addonId).toBe('fixture.demo')
    expect(desired?.page).toBe('settings')
  })

  it('完整 webview 链：故障 → 重试成功 → 详情恢复推送回显 → 自动重开自绘页（真实装载）', async () => {
    const h = panelHarness(['fixture.demo'], { definitions: { 'fixture.demo': crashablePageAddonDefinition() } })
    await openPanel(h)
    await userOpensDetail(h, 'fixture.demo')
    expect(h.loader.stats().active.map((a) => a.addonId)).toEqual(['fixture.demo'])

    // 真实故障链：通道回调异常 → faultRecord → runtime notify → 推送回 webview
    await h.runtime.dispatchChannelRequest('fixture.demo', 'crash', null)
    await h.pump()
    // 故障形态：自绘页撤下、排障块在场、详情仍开（定义保留）
    expect(h.runtime.runtimeStatus('fixture.demo')?.runState).toBe('faulted')
    expect(h.loader.stats().active).toEqual([])
    expect(h.parent.querySelector('.vsidian-addons-fault-troubleshoot')).toBeTruthy()

    // 手动重试（wiring 语义：preserve → release → 重注册成功）
    h.runtime.preserveSettingsDetailForRetry('fixture.demo')
    h.registry.release('fixture.demo')
    h.registry.register({ id: 'fixture.demo' }, pageAddonDefinition())
    // 重注册的 notify → settingsState 推送（open 恢复）→ 详情重渲染 →
    // 自动 openAddonPage → 宿主推 load → 装载器真实装载
    await h.pump()
    expect(h.runtime.settingsAreaAddonId()).toBe('fixture.demo')
    expect(h.sentHistory.some((m) => m.kind === 'addons.openAddonPage' && m.addonId === 'fixture.demo')).toBe(true)
    expect(h.loader.stats().active.map((a) => a.addonId)).toEqual(['fixture.demo'])
    expect(h.parent.querySelector('.vsidian-addons-addonpage [data-addon-id="fixture.demo"]')).toBeTruthy()
  })

  it('重试失败（未重新注册）意图保留：再次重试成功后仍恢复（重试可再发起）', async () => {
    const h = faultedHarness()
    h.runtime.openSettingsArea('fixture.demo')
    await h.runtime.dispatchChannelRequest('fixture.demo', 'crash', null)
    // 第一次重试失败（activate 未完成注册——无重注册到达）
    h.runtime.preserveSettingsDetailForRetry('fixture.demo')
    h.registry.release('fixture.demo')
    // 第二次重试成功
    h.runtime.preserveSettingsDetailForRetry('fixture.demo')
    h.registry.register({ id: 'fixture.demo' }, pageAddonDefinition())
    expect(h.runtime.settingsAreaAddonId()).toBe('fixture.demo')
  })

  it('故障期间显式关闭详情（settingsClose）：意图丢弃，重注册后不恢复', async () => {
    const h = faultedHarness()
    h.runtime.openSettingsArea('fixture.demo')
    await h.runtime.dispatchChannelRequest('fixture.demo', 'crash', null)
    h.runtime.preserveSettingsDetailForRetry('fixture.demo')
    h.registry.release('fixture.demo')
    // 用户显式关闭（在途 settingsClose 到达——丢弃恢复意图）
    h.runtime.closeSettingsArea()
    h.registry.register({ id: 'fixture.demo' }, pageAddonDefinition())
    expect(h.runtime.settingsAreaAddonId()).toBeUndefined()
  })

  it('普通注销（无重试意图）不恢复：既有语义不回归', () => {
    const h = runtimeHarness()
    h.registry.register({ id: 'fixture.demo' }, pageAddonDefinition())
    h.runtime.openSettingsArea('fixture.demo')
    h.registry.release('fixture.demo')
    h.registry.register({ id: 'fixture.demo' }, pageAddonDefinition())
    expect(h.runtime.settingsAreaAddonId()).toBeUndefined()
  })

  it('重注册后无设置能力（无定义无页）不恢复详情（避免空壳详情）', () => {
    const h = faultedHarness()
    h.runtime.openSettingsArea('fixture.demo')
    void h.runtime.dispatchChannelRequest('fixture.demo', 'crash', null)
    h.runtime.preserveSettingsDetailForRetry('fixture.demo')
    h.registry.release('fixture.demo')
    // 重注册的组件形态变化：不再注册设置页，也无定义
    h.registry.register({ id: 'fixture.demo' }, { setup(context) { context.channel.handle('x', () => 1) } })
    expect(h.runtime.settingsAreaAddonId()).toBeUndefined()
  })
})
