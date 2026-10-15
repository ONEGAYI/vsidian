// @vitest-environment jsdom
// #557 编辑器面板装载迟到验证竞态回归（生产模块链组合）：
// - 竞态一：realpath 验证在途时停用/释放组件（desired 移除、unload 推送），
//   迟到验证返回后仍推 load——已停用组件的旧页面迟到装载；
// - 竞态二：换入口重新注册（release → 重注册，代次换代）后旧计划的验证
//   迟到返回，推出旧代次 load 指令——装载器「不同代次先释放旧再装新」
//   会用旧代次替换已装好的新代次；
// - 多组件并存：编辑器面板 desired 是多值集合（与设置面板单值语义的本
//   质差异），组件 A 的失效/换代不得影响组件 B 的在途验证与装载。
//
// 链路组合：真实 AddonRuntime/AddonRegistry + 生产对账模块
// addonEditorPanelReconcile（addonWiring 的 pushEditorDirectives /
// postEditorLoadIfVerified 提取物，vscode 依赖剥除）+ 真实编辑器页装载器
// （installAddonPageLoader，page='editor'——可选 facet 省略的最小装配）。
// realpath 验证以真实 deferred promise 注入（holdVerify/releaseVerify 控制
// 完成时序，不同步化——同步化会掩盖在途竞态，#555 三轮评审实证）。
// 脚本装载同样经队列逐个完成（真实脚本的装载完成互不同拍——同步同拍
// 会触发装载器 takeFreshRegistration 的同批登记交叉消费，属装载器级既有
// 边界，非本票范围）。断言对象是用户可见结局（装载器 active、指令序列、
// 对账事件）。
import { beforeEach, describe, expect, it } from 'vitest'
import { AddonRegistry, type AddonDefinition } from '../../src/host/addons/addonRegistry'
import { AddonRuntime, type AddonPreferenceStore } from '../../src/host/addons/addonRuntime'
import {
  createEditorPanelRecord,
  pushEditorPanelDirectives,
  type EditorPanelReconcilePorts,
} from '../../src/host/addons/addonEditorPanelReconcile'
import { AddonSettingsService, type AddonSettingsPersistencePort } from '../../src/host/addons/addonSettingsService'
import { AddonThemeService } from '../../src/host/addons/addonThemeService'
import { AddonStorageService } from '../../src/host/addons/addonStorageService'
import { AddonPasteRuleService } from '../../src/host/addons/addonPasteRuleService'
import { ADDON_API_VERSION, OFFICIAL_ADDON_EXTENSION_IDS } from '../../src/shared/addonIdentity'
import {
  ADDON_PAGE_REGISTRY_GLOBAL,
  installAddonPageLoader,
  type AddonPageLoaderHandle,
} from '../../src/webview/addonPageLoader'
import type { AddonPageOutbound, AddonPageRegistration } from '../../src/shared/addonPage'

/** 等待微任务排空（装载 loadScript/通道 promise 的结算传播） */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

// ---- 宿主侧纯逻辑装配（与 addonSettingsLifecycle.test.ts 同款端口） ----

function memoryPreference(): AddonPreferenceStore {
  const user: Record<string, boolean | undefined> = {}
  // 编辑器装载对账由 effectiveEnabled 驱动（停用/启用必须真实落内存——
  // 空操作 write 会让 setEnabledScope 无效，停用场景全部失真）
  return {
    hasWorkspace: true,
    read: () => ({ user: user as Record<string, boolean>, workspace: null }),
    write: (scope, values) => { if (scope === 'user') Object.assign(user, values) },
  }
}

function memorySettingsPersistence(): AddonSettingsPersistencePort {
  const raw = new Map<'user' | 'workspace', unknown>()
  return { hasWorkspace: true, read: (scope) => raw.get(scope), write: async (scope, value) => { raw.set(scope, value); return true } }
}

/** 编辑器页组件定义（enable 注册编辑器页入口——desiredEditorLoads 的来源） */
function editorPageAddonDefinition(): AddonDefinition {
  return {
    enable(context) {
      context.pages.registerEditor({ entry: 'dist/editor.js' })
    },
  }
}

interface EditorPanelHarness {
  loader: AddonPageLoaderHandle
  runtime: AddonRuntime
  registry: AddonRegistry
  /** 宿主 → webview 的装载指令序列（unload/load 全留痕） */
  directives: Array<Record<string, unknown>>
  /** 宿主对账事件留痕（directive.load/unload、load-rejected-realpath、load-dropped-stale） */
  events: Array<{ kind: string; addonId: string; generation?: number }>
  /** blockEscapePlanRoots 登记的组件（escape 事实迟到照登的观测面） */
  escapedAddonIds: string[]
  /** 组件工厂调用留痕（每次真实装载一次） */
  factoryLoads: Array<{ addonId: string; generation: number }>
  /** 泵：出站消息入账 + 脚本逐个完成 + 自动放行在途验证，直到不动点；
   *  holdVerify 后不自动放行验证（在途窗口归测试控制） */
  pump(): Promise<void>
  /** 进入手动验证控制（pump 不再自动放行——测试显式 resolve 构造在途窗口） */
  holdVerify(): void
  /** 放行在途验证（队列中首个匹配；verdict 缺省 ok，generation 可选限定）；返回是否命中 */
  releaseVerify(addonId: string, options?: { verdict?: 'ok' | 'escape'; generation?: number }): boolean
  /** 在途验证队列的（组件，代次）序列（断言验证窗口用） */
  pendingVerifyPlans(): Array<{ addonId: string; generation: number }>
}

/**
 * 装配生产模块链（编辑器面板的最小真集）：真实 AddonRuntime/AddonRegistry
 * + 真实编辑器页装载器 + 生产对账模块 addonEditorPanelReconcile（不写第
 * 二份对账逻辑）。realpath 验证以 deferred promise 注入——默认 pump 自动
 * 放行（既有用例等价于「验证即刻通过」），holdVerify 后由测试控制完成
 * 顺序。runtime 状态变化（注册/停用/释放）经 onChanged 即时对账（生产
 * 链为 runtime.onChanged → notifyAddonPanels → 面板 pushDirectives）。
 */
function editorPanelHarness(ids: string[]): EditorPanelHarness {
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
    installDirOf: (addonId) => `/test/addons/${addonId}`,
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
  const registrations: AddonPageRegistration[] = []
  ;(globalThis as unknown as Record<string, unknown>)[ADDON_PAGE_REGISTRY_GLOBAL] = registrations
  let clock = 1_000
  const factoryLoads: Array<{ addonId: string; generation: number }> = []
  const outboundQueue: AddonPageOutbound[] = []
  /** 脚本装载队列（每泵轮完成一个——登记与完成互不同拍，规避装载器
   *  takeFreshRegistration 的同批登记交叉消费，见文件头注） */
  const scriptQueue: Array<{ addonId: string; resolve: (result: { ok: true } | { ok: false; error: string }) => void }> = []
  const loader = installAddonPageLoader({
    page: 'editor',
    send: (outbound) => { outboundQueue.push(outbound) },
    // 脚本装载即组件 IIFE 执行：完成时向登记表 push 本组件工厂（同一
    // 组件第二次装载同样有新鲜登记——真实脚本的重复执行语义）
    loadScript: (uri) => {
      const addonId = /^https:\/\/page\.test\/([^/]+)\/editor\.js$/.exec(uri)?.[1]
      if (addonId === undefined) {
        return Promise.resolve({ ok: false, error: `unexpected script uri: ${uri}` })
      }
      return new Promise((resolve) => { scriptQueue.push({ addonId, resolve }) })
    },
    loadCss: () => Promise.resolve('authorized'),
    now: () => clock,
  })
  // 装载对账：生产模块本体（addonWiring pushEditorDirectives/
  // postEditorLoadIfVerified 的提取物），验证 promise 可控注入
  const panelRecord = createEditorPanelRecord()
  const verifyQueue: Array<{ plan: { addonId: string; generation: number }; resolve: (verdict: 'ok' | 'escape') => void }> = []
  const panelEvents: Array<{ kind: string; addonId: string; generation?: number }> = []
  const directives: Array<Record<string, unknown>> = []
  const escapedAddonIds: string[] = []
  let holdVerify = false
  const ports: EditorPanelReconcilePorts = {
    desiredLoads: () => runtime.desiredEditorLoads(),
    isEscapedDir: () => false,
    verifyLoadPlan: (plan) => new Promise((resolve) => { verifyQueue.push({ plan, resolve }) }),
    blockEscapePlanRoots: (plan) => { escapedAddonIds.push(plan.addonId) },
    buildLoadDirective: (plan) => ({
      type: 'addon.load',
      manifest: {
        addonId: plan.addonId,
        generation: plan.generation,
        page: 'editor',
        scriptUri: `https://page.test/${plan.addonId}/editor.js`,
        cssUris: [],
      },
    }),
    postDirective: (directive) => {
      directives.push(directive as unknown as Record<string, unknown>)
      loader.handleDirective(directive)
    },
    recordEvent: (event) => { panelEvents.push(event) },
    postBehaviorState: () => {},
    postBehaviorEnabledState: () => {},
  }
  const pushEditorDirectives = (): void => {
    pushEditorPanelDirectives(ports, panelRecord)
  }
  // 生产链：runtime.onChanged → notifyAddonPanels → 面板对账（注册/停用/
  // 释放/换代的 unload/load 推送即时触发）
  runtime.onChanged(() => { pushEditorDirectives() })
  for (const id of ids) {
    registry.register({ id }, editorPageAddonDefinition())
  }
  return {
    loader, runtime, registry, directives, events: panelEvents, escapedAddonIds, factoryLoads,
    holdVerify: () => { holdVerify = true },
    releaseVerify: (addonId, options = {}) => {
      const index = verifyQueue.findIndex((entry) =>
        entry.plan.addonId === addonId && (options.generation === undefined || entry.plan.generation === options.generation))
      if (index === -1) {
        return false
      }
      const [entry] = verifyQueue.splice(index, 1)
      entry!.resolve(options.verdict ?? 'ok')
      return true
    },
    pendingVerifyPlans: () => verifyQueue.map((entry) => ({ addonId: entry.plan.addonId, generation: entry.plan.generation })),
    pump: async () => {
      for (let round = 0; round < 40; round += 1) {
        let worked = false
        while (outboundQueue.length > 0) {
          // 生产链：装载器出站（loaded/unloaded 结局）→ 宿主 runtime 记账
          runtime.handleOutbound(outboundQueue.shift()!)
          worked = true
        }
        if (scriptQueue.length > 0) {
          // 每轮完成一个脚本装载（登记 + 完成）——真实脚本完成互不同拍
          const entry = scriptQueue.shift()!
          registrations.push({
            addonId: entry.addonId,
            factory: (sdk) => { factoryLoads.push({ addonId: sdk.addon.id, generation: sdk.addon.generation }) },
            registeredAt: clock,
          })
          entry.resolve({ ok: true })
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
        // 收敛只看出站与脚本队列（holdVerify 下在途验证刻意保持未完成——
        // 与设置面板 harness 同口径，不把 verifyQueue 计入收敛条件）
        if (!worked && outboundQueue.length === 0 && scriptQueue.length === 0) {
          return
        }
      }
      throw new Error('pump 未收敛（消息往返超出轮次预算——疑似对账死循环）')
    },
  }
}

/** 装载指令序列中的 (addonId, generation) 对（断言指令面用） */
const loadIdentities = (directives: Array<Record<string, unknown>>): Array<{ addonId: string; generation: number }> =>
  directives
    .filter((d) => d.type === 'addon.load')
    .map((d) => {
      const manifest = d.manifest as { addonId: string; generation: number }
      return { addonId: manifest.addonId, generation: manifest.generation }
    })

beforeEach(() => {
  ;(globalThis as unknown as Record<string, unknown>)[ADDON_PAGE_REGISTRY_GLOBAL] = []
})

// ---- 竞态一：验证在途停用/释放组件，迟到验证不得装载旧页面 ----

describe('#557 竞态一：验证在途停用组件，迟到验证不推 load（deferred 验证）', () => {
  it('A 验证在途 → 停用（desired 移除）→ A 迟到完成：不推 load、零装载、事件留痕在场', async () => {
    const h = editorPanelHarness(['addon.a'])
    h.holdVerify()
    // 注册即触发对账：A 的 realpath 验证在途（尚未装载）
    expect(h.pendingVerifyPlans()).toEqual([{ addonId: 'addon.a', generation: 1 }])

    // 停用 A：desired 移除（A 从未推送过 load，无卸载基线——正确中间态）
    h.runtime.setEnabledScope('addon.a', 'user', false)
    await h.pump()
    expect(h.runtime.desiredEditorLoads()).toEqual([])

    // A 的迟到验证完成——不得推 load（修复前：仍推 load，已停用组件的
    // 旧页面迟到装载）
    expect(h.releaseVerify('addon.a')).toBe(true)
    await h.pump()
    expect(h.directives.filter((d) => d.type === 'addon.load')).toEqual([])
    expect(h.loader.stats().active).toEqual([])
    expect(h.factoryLoads).toEqual([])
    // 迟到丢弃有事件留痕（对齐设置面板侧 directive.load-dropped-stale 模式）
    expect(h.events).toContainEqual({ kind: 'directive.load-dropped-stale', addonId: 'addon.a', generation: 1 })
  })

  it('A 已装载 → 换代验证在途 → 停用（unload 已推）→ 迟到验证：无新 load、装载器保持空、事件在场', async () => {
    const h = editorPanelHarness(['addon.a'])
    await h.pump()
    expect(h.loader.stats().active).toEqual([{ addonId: 'addon.a', generation: 1 }])

    // 停用 → unload(g1) 已推；再启用 → g2 验证在途（enable 双通知：中间
    // 还会再验一次 g1——registerEditor 先于代次递增 notify，同代次计划
    // 各占一次验证）
    h.holdVerify()
    h.runtime.setEnabledScope('addon.a', 'user', false)
    await h.pump()
    const unload = h.directives.find((d) => d.type === 'addon.unload' && d.addonId === 'addon.a')
    expect(unload).toBeTruthy()
    expect((unload as { generation: number }).generation).toBe(1)
    expect(h.loader.stats().active).toEqual([])

    h.runtime.setEnabledScope('addon.a', 'user', true)
    await h.pump()
    expect(h.pendingVerifyPlans()).toEqual([
      { addonId: 'addon.a', generation: 1 },
      { addonId: 'addon.a', generation: 2 },
    ])

    // 停用窗口期内 g2 验证迟到返回——不得再推 g2 load
    h.runtime.setEnabledScope('addon.a', 'user', false)
    await h.pump()
    expect(h.releaseVerify('addon.a', { generation: 2 })).toBe(true)
    await h.pump()
    expect(loadIdentities(h.directives)).toEqual([{ addonId: 'addon.a', generation: 1 }])
    expect(h.loader.stats().active).toEqual([])
    expect(h.events).toContainEqual({ kind: 'directive.load-dropped-stale', addonId: 'addon.a', generation: 2 })
  })
})

// ---- 竞态二：换入口重新注册（代次替换），旧验证不得替换已装好的新代次 ----

describe('#557 竞态二：旧代次迟到验证不得替换已装载的新代次（deferred 验证）', () => {
  it('A(g1) 验证在途 → 释放重注册（g2）→ g2 先装载 → g1 迟到：g2 不被替换、无 g1 load 指令、事件留痕', async () => {
    const h = editorPanelHarness(['addon.a'])
    h.holdVerify()
    expect(h.pendingVerifyPlans()).toEqual([{ addonId: 'addon.a', generation: 1 }])

    // 换入口重新注册：release → 重注册（高水位换代 g2）；enable 双通知使
    // g1（registerEditor 先于代次递增 notify）与 g2 各发起一次验证
    h.registry.release('addon.a')
    h.registry.register({ id: 'addon.a' }, editorPageAddonDefinition())
    await h.pump()
    // 验证窗口：g2 的验证已在途（enable 双通知还会再发起一次 g1 验证——
    // registerEditor 先于代次递增 notify，同代次计划各占一次验证；具体
    // 队列形状不钉死，竞态结局由后续断言把关）
    const plans = h.pendingVerifyPlans()
    expect(plans.some((p) => p.addonId === 'addon.a' && p.generation === 2)).toBe(true)
    expect(plans.every((p) => p.addonId === 'addon.a')).toBe(true)

    // 新代次先完成验证并装载（pushed = g2）
    expect(h.releaseVerify('addon.a', { generation: 2 })).toBe(true)
    await h.pump()
    expect(h.loader.stats().active).toEqual([{ addonId: 'addon.a', generation: 2 }])

    // 旧代次验证迟到——不得推 g1 load（修复前：装载器按「不同代次先释放
    // 旧再装新」用 g1 替换已装好的 g2）
    expect(h.releaseVerify('addon.a', { generation: 1 })).toBe(true)
    await h.pump()
    expect(loadIdentities(h.directives)).toEqual([{ addonId: 'addon.a', generation: 2 }])
    expect(h.loader.stats().active).toEqual([{ addonId: 'addon.a', generation: 2 }])
    expect(h.factoryLoads).toEqual([{ addonId: 'addon.a', generation: 2 }])
    expect(h.events).toContainEqual({ kind: 'directive.load-dropped-stale', addonId: 'addon.a', generation: 1 })
    // enable 双通知的中间 g1 重验（修复后在途）同样迟到丢弃——终态不变
    if (h.releaseVerify('addon.a', { generation: 1 })) {
      await h.pump()
      expect(loadIdentities(h.directives)).toEqual([{ addonId: 'addon.a', generation: 2 }])
      expect(h.loader.stats().active).toEqual([{ addonId: 'addon.a', generation: 2 }])
    }
  })
})

// ---- 多组件并存：A 的失效/换代不影响 B 的在途验证与装载 ----

describe('#557 多组件并存：个别组件失效不牵连其他组件（票面明确要求）', () => {
  it('A、B 双验证在途 → 停用 A → B 正常装载 → A 迟到丢弃：B 全程不受影响', async () => {
    const h = editorPanelHarness(['addon.a', 'addon.b'])
    h.holdVerify()
    expect(h.pendingVerifyPlans()).toEqual([
      { addonId: 'addon.a', generation: 1 },
      { addonId: 'addon.b', generation: 1 },
    ])

    // 停用 A（仅 A 失效——B 的在途验证保持有效）
    h.runtime.setEnabledScope('addon.a', 'user', false)
    await h.pump()

    // B 在 A 失效后正常完成验证并装载
    expect(h.releaseVerify('addon.b')).toBe(true)
    await h.pump()
    expect(h.loader.stats().active).toEqual([{ addonId: 'addon.b', generation: 1 }])

    // A 的迟到验证完成——B 的装载不受牵连
    expect(h.releaseVerify('addon.a')).toBe(true)
    await h.pump()
    expect(loadIdentities(h.directives)).toEqual([{ addonId: 'addon.b', generation: 1 }])
    expect(h.loader.stats().active).toEqual([{ addonId: 'addon.b', generation: 1 }])
    expect(h.events).toContainEqual({ kind: 'directive.load-dropped-stale', addonId: 'addon.a', generation: 1 })
    expect(h.events.filter((e) => e.kind === 'directive.load-dropped-stale' && e.addonId === 'addon.b')).toEqual([])
  })

  it('A 换代（释放重注册）不影响 B：B 照常装载、A 装新代次、A 旧代次迟到丢弃', async () => {
    const h = editorPanelHarness(['addon.a', 'addon.b'])
    h.holdVerify()
    // A 换代：release → 重注册（g2）——enable 双通知使 A 的 g1（旧槽位
    // 已被失效回收后重新发起）与 g2 各占一次验证，B 的 g1 验证仍在途
    h.registry.release('addon.a')
    h.registry.register({ id: 'addon.a' }, editorPageAddonDefinition())
    await h.pump()
    // 验证窗口：B 的 g1 验证仍在途、A 的 g2 验证已发起（A 的 g1 旧验证
    // 与 enable 双通知的中间 g1 重验共存——队列形状不钉死，B 不受牵连
    // 的结局由后续断言把关）
    const plans = h.pendingVerifyPlans()
    expect(plans.some((p) => p.addonId === 'addon.b' && p.generation === 1)).toBe(true)
    expect(plans.some((p) => p.addonId === 'addon.a' && p.generation === 2)).toBe(true)

    // A 新代次与 B 各自完成验证并装载
    expect(h.releaseVerify('addon.a', { generation: 2 })).toBe(true)
    expect(h.releaseVerify('addon.b')).toBe(true)
    await h.pump()
    expect([...h.loader.stats().active].sort((x, y) => x.addonId.localeCompare(y.addonId))).toEqual([
      { addonId: 'addon.a', generation: 2 },
      { addonId: 'addon.b', generation: 1 },
    ])

    // A 旧代次验证迟到——A 保持新代次、B 不受影响
    expect(h.releaseVerify('addon.a', { generation: 1 })).toBe(true)
    await h.pump()
    expect([...h.loader.stats().active].sort((x, y) => x.addonId.localeCompare(y.addonId))).toEqual([
      { addonId: 'addon.a', generation: 2 },
      { addonId: 'addon.b', generation: 1 },
    ])
    expect(h.events).toContainEqual({ kind: 'directive.load-dropped-stale', addonId: 'addon.a', generation: 1 })
    expect(h.events.filter((e) => e.kind === 'directive.load-dropped-stale' && e.addonId === 'addon.b')).toEqual([])
    // enable 双通知的中间 g1 重验（修复后在途）同样迟到丢弃——终态不变
    if (h.releaseVerify('addon.a', { generation: 1 })) {
      await h.pump()
      expect([...h.loader.stats().active].sort((x, y) => x.addonId.localeCompare(y.addonId))).toEqual([
        { addonId: 'addon.a', generation: 2 },
        { addonId: 'addon.b', generation: 1 },
      ])
    }
  })
})

// ---- 对照组：既有对账行为不回归 ----

describe('#557 对照组：正常装载/卸载对账不回归（既有行为）', () => {
  it('注册即装载（验证自动放行）→ 停用推 unload → 重启用再装载（代次递增、终态正确）', async () => {
    const h = editorPanelHarness(['addon.a'])
    await h.pump()
    expect(h.loader.stats().active).toEqual([{ addonId: 'addon.a', generation: 1 }])
    expect(h.events).toContainEqual({ kind: 'directive.load', addonId: 'addon.a', generation: 1 })

    h.runtime.setEnabledScope('addon.a', 'user', false)
    await h.pump()
    expect(h.loader.stats().active).toEqual([])
    expect(h.events).toContainEqual({ kind: 'directive.unload', addonId: 'addon.a', generation: 1 })

    h.runtime.setEnabledScope('addon.a', 'user', true)
    await h.pump()
    expect(h.loader.stats().active).toEqual([{ addonId: 'addon.a', generation: 2 }])
    // 指令面：首装 g1、终装 g2（中间的换代重验不得推出旧代次 load）
    const loads = loadIdentities(h.directives)
    expect(loads[0]).toEqual({ addonId: 'addon.a', generation: 1 })
    expect(loads[loads.length - 1]).toEqual({ addonId: 'addon.a', generation: 2 })
    expect(loads.every((entry) => entry.addonId === 'addon.a')).toBe(true)
  })

  it('escape 登记「文件系统事实迟到照登」：停用后迟到 escape 仍登记排除表并记拒绝事件（先于失效核对）', async () => {
    const h = editorPanelHarness(['addon.a'])
    h.holdVerify()
    expect(h.pendingVerifyPlans()).toEqual([{ addonId: 'addon.a', generation: 1 }])
    h.runtime.setEnabledScope('addon.a', 'user', false)
    await h.pump()
    // 迟到返回 escape：目录排除表照登（安全事实与失效纪元无关）
    expect(h.releaseVerify('addon.a', { verdict: 'escape' })).toBe(true)
    await h.pump()
    expect(h.escapedAddonIds).toEqual(['addon.a'])
    expect(h.events).toContainEqual({ kind: 'directive.load-rejected-realpath', addonId: 'addon.a', generation: 1 })
    expect(h.directives.filter((d) => d.type === 'addon.load')).toEqual([])
    expect(h.loader.stats().active).toEqual([])
  })
})
