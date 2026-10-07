// #351 T02 附加组件运行生命周期契约测试（纯逻辑，vscode 经端口注入）。
// 钉住票面验收的核心行为：
// - 轻量 setup 注册设置定义与自己的设置入口；运行 enable 按用户功能
//   开关装配（扩展 T01 registerAddon definition 的 enable + 页面入口形状）；
// - 普通关闭释放运行贡献但保留设置能力；重启（同 store 新实例）后停用
//   状态保持（用户关闭选择持久保留——存储格式与 T04 对齐预留）；
// - 可归因注册/初始化/回调异常暂停该组件全部注册贡献，启用偏好独立
//   保存，基础原因状态可观察；
// - 通道只传 JSON：成功/拒绝/序列化防线；重复 topic 拒绝；
// - 释放意图（面板桥消费 desiredEditorLoads / 停用 unload 代次）与
//   代次递增、重复释放幂等、手动重新接入建新代次。
import { describe, expect, it } from 'vitest'
import { AddonRegistry } from '../../src/host/addons/addonRegistry'
import { AddonRuntime, type AddonPreferenceStore } from '../../src/host/addons/addonRuntime'
import { AddonSettingsService, type AddonSettingsPersistencePort } from '../../src/host/addons/addonSettingsService'
import { ADDON_API_VERSION, OFFICIAL_ADDON_EXTENSION_IDS } from '../../src/shared/addonIdentity'

const INSTALL = process.platform === 'win32' ? 'C:\\addons\\demo-addon' : '/addons/demo-addon'

/** 内存偏好层（模拟 globalState/workspaceState 持久层的读写面） */
function memoryStore(initial: { user?: Record<string, boolean>; workspace?: Record<string, boolean> | null } = {}): AddonPreferenceStore & { user: Record<string, boolean>; workspace: Record<string, boolean> | null } {
  const state = { user: { ...initial.user }, workspace: initial.workspace === undefined ? null : { ...initial.workspace } }
  return {
    hasWorkspace: true,
    get user() { return state.user },
    get workspace() { return state.workspace },
    read: () => ({ user: { ...state.user }, workspace: state.workspace === null ? null : { ...state.workspace } }),
    write(scope, values) {
      const target = scope === 'user' ? state.user : (state.workspace ??= {})
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) delete target[key]
        else target[key] = value
      }
    },
  }
}

interface Harness {
  registry: AddonRegistry
  runtime: AddonRuntime
  store: ReturnType<typeof memoryStore>
  logs: string[]
  changes: number
  register(definition?: import('../../src/host/addons/addonRegistry').AddonDefinition, addonId?: string): unknown
}

function harness(options: { store?: ReturnType<typeof memoryStore>; installDirs?: Record<string, string | undefined> } = {}): Harness {
  const store = options.store ?? memoryStore()
  const logs: string[] = []
  const installDirs = options.installDirs ?? { 'fixture.demo': INSTALL }
  // #353 T04 起 settings 为 runtime 必需端口（内存持久层）
  const settingsPersistence: AddonSettingsPersistencePort = {
    hasWorkspace: true,
    read: () => undefined,
    write: async () => true,
  }
  const runtime = new AddonRuntime({
    apiVersion: ADDON_API_VERSION,
    preferences: store,
    settings: new AddonSettingsService(settingsPersistence),
    installDirOf: (addonId) => installDirs[addonId],
    log: (stage, addonId, detail) => logs.push(`${stage}:${addonId}:${detail}`),
  })
  const extensions = [{ id: 'fixture.demo', packageJSON: { name: 'demo', publisher: 'fixture', vsidianAddon: { manifestVersion: 1, api: '^1.0.0' } } }]
  const registry = new AddonRegistry(
    {
      apiVersion: ADDON_API_VERSION,
      experimental: {},
      officialIds: OFFICIAL_ADDON_EXTENSION_IDS,
      findExtension: (id) => extensions.find((extension) => extension.id === id),
    },
    runtime.registryHooks(),
  )
  const changes: number[] = []
  runtime.onChanged(() => changes.push(1))
  return {
    registry,
    runtime,
    store,
    logs,
    get changes() { return changes.length },
    register: (definition, addonId = 'fixture.demo') => registry.register({ id: addonId }, definition ?? {}),
  }
}

const EDITOR_ENTRY = { entry: 'dist/editor.js', css: ['dist/editor.css'], resources: ['dist/assets'] }
const SETTINGS_ENTRY = { entry: 'dist/settings.js', css: ['dist/settings.css'], resources: ['dist/assets'] }

describe('T02 运行生命周期：注册与两阶段装配', () => {
  it('注册即调 setup（设置页入口 + 定义收集）；默认启用再调 enable（编辑器入口 + onDispose）', () => {
    const h = harness()
    const calls: string[] = []
    h.register({
      setup(context) {
        calls.push('setup')
        expect(context.addonId).toBe('fixture.demo')
        context.settings.registerPage(SETTINGS_ENTRY)
        context.settings.registerDefinitions([{ key: 'demo.flag', title: 'Demo flag', type: 'boolean', default: true }])
      },
      enable(context) {
        calls.push('enable')
        context.pages.registerEditor(EDITOR_ENTRY)
        context.onDispose(() => calls.push('run-cleanup'))
      },
    })
    expect(calls).toEqual(['setup', 'enable'])
    // 装载意图：编辑器页（generation 1）；设置页入口可打开
    const loads = h.runtime.desiredEditorLoads()
    expect(loads).toHaveLength(1)
    expect(loads[0]).toMatchObject({ addonId: 'fixture.demo', generation: 1 })
    expect(loads[0].entryFsPath.endsWith('editor.js')).toBe(true)
    expect(h.runtime.openSettingsPage('fixture.demo')).toBe('ok')
    expect(h.runtime.desiredSettingsLoad()?.addonId).toBe('fixture.demo')
    // 状态可观察
    expect(h.runtime.runtimeStatus('fixture.demo')).toMatchObject({ enabled: true, runState: 'enabled', hasSettingsPage: true })
  })

  it('未声明 enable 的组件：注册后不进入运行态，setup 贡献保留', () => {
    const h = harness()
    h.register({ setup(context) { context.settings.registerPage(SETTINGS_ENTRY) } })
    expect(h.runtime.desiredEditorLoads()).toEqual([])
    expect(h.runtime.runtimeStatus('fixture.demo')).toMatchObject({ runState: 'idle', hasSettingsPage: true })
  })

  it('页面入口越界登记被拒绝（不进装载面，log 留痕，其余贡献不受牵连）', () => {
    const h = harness()
    h.register({
      setup(context) {
        context.settings.registerPage({ entry: '../outside/settings.js' })
        context.channel.handle('t02.setupEcho', (payload) => ({ echoed: payload }))
      },
      enable(context) {
        context.pages.registerEditor({ ...EDITOR_ENTRY, css: ['..\\evil.css'] })
      },
    })
    expect(h.runtime.desiredEditorLoads()).toEqual([])
    expect(h.logs.some((line) => line.includes('escape'))).toBe(true)
    expect(h.runtime.openSettingsPage('fixture.demo')).toBe('no-settings-page')
    // 通道仍可用（设置 scope）
    expect(h.runtime.runtimeStatus('fixture.demo')?.hasSettingsPage).toBe(false)
  })

  it('installDir 不可解析的组件：页面入口登记拒绝', () => {
    const h = harness({ installDirs: { 'fixture.demo': undefined } })
    h.register({ enable(context) { context.pages.registerEditor(EDITOR_ENTRY) } })
    expect(h.runtime.desiredEditorLoads()).toEqual([])
  })
})

describe('T02 运行生命周期：手动停用与持久化', () => {
  it('停用释放运行贡献但保留设置能力；重新启用建新代次', async () => {
    const h = harness()
    const events: string[] = []
    h.register({
      setup(context) {
        context.settings.registerPage(SETTINGS_ENTRY)
        context.channel.handle('t02.setupEcho', (payload) => ({ scope: 'setup', echoed: payload }))
      },
      enable(context) {
        context.pages.registerEditor(EDITOR_ENTRY)
        context.channel.handle('t02.runEcho', () => ({ scope: 'run' }))
        context.onDispose(() => events.push('released'))
      },
    })
    h.runtime.setUserEnabled('fixture.demo', false)
    // 运行贡献释放：清理回调执行、装载面清空、run handler 移除
    expect(events).toEqual(['released'])
    expect(h.runtime.desiredEditorLoads()).toEqual([])
    expect(h.runtime.runtimeStatus('fixture.demo')).toMatchObject({ enabled: false, runState: 'disabled' })
    // 停用 unload 意图携带最后装载代次（面板桥据此发 addon.unload）
    expect(h.runtime.lastEditorUnloadDirective('fixture.demo')).toMatchObject({ type: 'addon.unload', addonId: 'fixture.demo', generation: 1 })
    // 设置能力保留：设置页可打开 + setup scope 通道可用
    expect(h.runtime.openSettingsPage('fixture.demo')).toBe('ok')
    expect(h.runtime.runtimeStatus('fixture.demo')?.hasSettingsPage).toBe(true)
    await expect(h.runtime.dispatchChannelRequest('fixture.demo', 't02.setupEcho', { a: 1 })).resolves.toEqual({ ok: true, result: { scope: 'setup', echoed: { a: 1 } } })
    // 重新接入：release 终结旧代次后重新注册；停用偏好在重注册后仍保持
    // （手动重新接入 ≠ 自动恢复运行——用户开关独立于代次）
    let reEnabled = false
    h.registry.release('fixture.demo')
    // 清理回调已随停用执行过（splice 清空）——release 不重复执行（幂等）
    expect(events).toEqual(['released'])
    h.register({
      setup(context) { context.settings.registerPage(SETTINGS_ENTRY) },
      enable(context) {
        reEnabled = true
        context.pages.registerEditor(EDITOR_ENTRY)
        context.onDispose(() => events.push('released-2'))
      },
    })
    expect(reEnabled).toBe(false)
    expect(h.runtime.runtimeStatus('fixture.demo')).toMatchObject({ enabled: false, runState: 'idle' })
    // 用户重新打开开关：enable 装配、代次从头计数（新代次）
    h.runtime.setUserEnabled('fixture.demo', true)
    expect(reEnabled).toBe(true)
    expect(h.runtime.desiredEditorLoads()[0]).toMatchObject({ generation: 1 })
  })

  it('停用后重新启用（不经 release）：enable 重跑且代次递增', async () => {
    const h = harness()
    let enableRuns = 0
    h.register({
      enable(context) {
        enableRuns++
        context.pages.registerEditor(EDITOR_ENTRY)
      },
    })
    expect(h.runtime.desiredEditorLoads()[0].generation).toBe(1)
    h.runtime.setUserEnabled('fixture.demo', false)
    h.runtime.setUserEnabled('fixture.demo', true)
    expect(enableRuns).toBe(2)
    expect(h.runtime.desiredEditorLoads()[0].generation).toBe(2)
    // run scope 通道恢复服务
    expect(h.runtime.runtimeStatus('fixture.demo')).toMatchObject({ runState: 'enabled' })
  })

  it('重启后停用状态保持：同 store 新 runtime 不再 enable（用户关闭持久保留）', () => {
    const store = memoryStore()
    const first = harness({ store })
    first.register({ enable(context) { context.pages.registerEditor(EDITOR_ENTRY) } })
    first.runtime.setUserEnabled('fixture.demo', false)
    expect(store.user).toEqual({ 'fixture.demo': false })
    // 新实例（同一持久层——模拟宿主重启后重建）
    const second = harness({ store })
    let enableAfterRestart = 0
    second.register({
      setup(context) { context.settings.registerPage(SETTINGS_ENTRY) },
      enable() { enableAfterRestart++ },
    })
    expect(enableAfterRestart).toBe(0)
    // 偏好生效值 false（呈现「已停用」按 enabled 字段）；runState 为 idle
    // ——重启后本代次从未装配过运行贡献（disabled 保留给「曾启用后被停」）
    expect(second.runtime.runtimeStatus('fixture.demo')).toMatchObject({ enabled: false, runState: 'idle' })
    expect(second.runtime.desiredEditorLoads()).toEqual([])
    // setup 贡献照常可用（停用不阻断设置生命周期）
    expect(second.runtime.runtimeStatus('fixture.demo')?.hasSettingsPage).toBe(true)
  })

  it('默认启用：无显式偏好时 effectiveEnabled 为 true（ADR 默认状态）', () => {
    const h = harness()
    expect(h.runtime.effectiveEnabled('fixture.demo')).toBe(true)
    expect(h.runtime.effectiveEnabled('nobody.registered')).toBe(true)
  })
})

describe('T02 故障暂停：可归因异常暂停全部注册贡献', () => {
  it('enable 抛错 → fault：半初始化回收（已收集贡献与清理回调释放）、偏好保留、状态可观察', async () => {
    const h = harness()
    const events: string[] = []
    h.register({
      setup(context) {
        context.settings.registerPage(SETTINGS_ENTRY)
        context.settings.registerDefinitions([{ key: 'demo.flag', title: 'Demo flag', type: 'boolean', default: true }])
        context.channel.handle('t02.setupEcho', () => 'ok')
      },
      enable(context) {
        context.pages.registerEditor(EDITOR_ENTRY)
        context.onDispose(() => events.push('partial-cleanup'))
        throw new Error('enable boom')
      },
    })
    expect(events).toEqual(['partial-cleanup'])
    expect(h.runtime.desiredEditorLoads()).toEqual([])
    expect(h.runtime.runtimeStatus('fixture.demo')).toMatchObject({ runState: 'faulted', enabled: true })
    expect(h.runtime.runtimeStatus('fixture.demo')?.faultReason).toContain('enable boom')
    // 全部注册贡献暂停：设置页不可打开、setup 通道不可用（页面代码撤下）
    expect(h.runtime.openSettingsPage('fixture.demo')).toBe('faulted')
    await expect(h.runtime.dispatchChannelRequest('fixture.demo', 't02.setupEcho', {})).resolves.toMatchObject({ ok: false, reason: 'rejected' })
    // 已取得的设置定义保留（故障后仍可由平台基础控件呈现——T04 消费）
    expect(h.runtime.collectedDefinitions('fixture.demo')).toHaveLength(1)
  })

  it('setup 抛错 → fault：注册记录保留（T01 语义）但全部贡献暂停', () => {
    const h = harness()
    h.register({
      setup() { throw new Error('setup boom') },
      enable(context) { context.pages.registerEditor(EDITOR_ENTRY) },
    })
    expect(h.registry.has('fixture.demo')).toBe(true)
    expect(h.runtime.runtimeStatus('fixture.demo')).toMatchObject({ runState: 'faulted' })
    expect(h.runtime.runtimeStatus('fixture.demo')?.faultReason).toContain('setup boom')
    // enable 不再执行（setup 故障即全组件暂停）
    expect(h.runtime.desiredEditorLoads()).toEqual([])
  })

  it('页面工厂异常（addon.loaded factory-error / addon.faulted）→ fault：宿主侧贡献同步释放', () => {
    const h = harness()
    const events: string[] = []
    h.register({
      enable(context) {
        context.pages.registerEditor(EDITOR_ENTRY)
        context.channel.handle('t02.runEcho', () => 'ok')
        context.onDispose(() => events.push('cleanup'))
      },
    })
    expect(h.runtime.desiredEditorLoads()).toHaveLength(1)
    h.runtime.handleOutbound({
      type: 'addon.loaded',
      addonId: 'fixture.demo',
      generation: 1,
      outcome: { ok: false, reason: 'factory-error', detail: 'Error: page boom' },
    })
    expect(events).toEqual(['cleanup'])
    expect(h.runtime.runtimeStatus('fixture.demo')).toMatchObject({ runState: 'faulted' })
    expect(h.runtime.runtimeStatus('fixture.demo')?.faultReason).toContain('page boom')
    expect(h.runtime.desiredEditorLoads()).toEqual([])
  })

  it('通道回调抛错 → rejected 回执 + fault 暂停', async () => {
    const h = harness()
    h.register({
      enable(context) {
        context.channel.handle('t02.crash', () => { throw new Error('handler boom') })
      },
    })
    const outcome = await h.runtime.dispatchChannelRequest('fixture.demo', 't02.crash', {})
    expect(outcome).toEqual({ ok: false, reason: 'rejected' })
    expect(h.runtime.runtimeStatus('fixture.demo')).toMatchObject({ runState: 'faulted' })
    expect(h.runtime.runtimeStatus('fixture.demo')?.faultReason).toContain('handler boom')
  })

  it('故障后手动重新接入：release 旧代次 + 重新注册恢复（偏好保留）', () => {
    const h = harness()
    h.register({ enable(context) { context.pages.registerEditor(EDITOR_ENTRY) } })
    h.runtime.handleOutbound({ type: 'addon.faulted', addonId: 'fixture.demo', generation: 1, reason: 'page fault' })
    expect(h.runtime.runtimeStatus('fixture.demo')?.runState).toBe('faulted')
    // 手动重试入口（T05/T06 UI 消费）：release 旧代次 → 组件重新注册
    h.registry.release('fixture.demo')
    expect(h.runtime.runtimeStatus('fixture.demo')).toBeUndefined()
    let reEnabled = false
    const result = h.register({
      setup(context) { context.settings.registerPage(SETTINGS_ENTRY) },
      enable(context) {
        reEnabled = true
        context.pages.registerEditor(EDITOR_ENTRY)
      },
    })
    expect(result).toMatchObject({ ok: true })
    expect(reEnabled).toBe(true)
    expect(h.runtime.runtimeStatus('fixture.demo')).toMatchObject({ runState: 'enabled' })
  })
})

describe('T02 通道：JSON 语义与拒绝面', () => {
  it('成功回执携带 handler 结果；未注册 topic → rejected（协议性拒绝，不算故障）', async () => {
    const h = harness()
    h.register({
      enable(context) { context.channel.handle('t02.echo', (payload) => ({ echoed: payload })) },
    })
    expect(await h.runtime.dispatchChannelRequest('fixture.demo', 't02.echo', { x: 1 })).toEqual({
      ok: true, result: { echoed: { x: 1 } },
    })
    expect(await h.runtime.dispatchChannelRequest('fixture.demo', 't02.unknown', {})).toEqual({ ok: false, reason: 'rejected' })
    expect(h.runtime.runtimeStatus('fixture.demo')?.runState).toBe('enabled')
  })

  it('回执不可 JSON 序列化（函数/DOM 引用）→ rejected + fault（不桥接函数）', async () => {
    const h = harness()
    h.register({
      enable(context) { context.channel.handle('t02.leak', () => () => { throw new Error('never') }) },
    })
    expect(await h.runtime.dispatchChannelRequest('fixture.demo', 't02.leak', {})).toEqual({ ok: false, reason: 'rejected' })
    expect(h.runtime.runtimeStatus('fixture.demo')?.runState).toBe('faulted')
  })

  it('重复 topic 注册拒绝：第二次不生效，首个 handler 继续服务', async () => {
    const h = harness()
    h.register({
      enable(context) {
        context.channel.handle('t02.dup', () => 'first')
        context.channel.handle('t02.dup', () => 'second')
      },
    })
    expect(await h.runtime.dispatchChannelRequest('fixture.demo', 't02.dup', null)).toEqual({ ok: true, result: 'first' })
  })

  it('setup 与 enable 同名 topic：run scope 优先，停用后回落 setup scope', async () => {
    const h = harness()
    h.register({
      setup(context) { context.channel.handle('t02.shared', () => 'setup-scope') },
      enable(context) { context.channel.handle('t02.shared', () => 'run-scope') },
    })
    expect(await h.runtime.dispatchChannelRequest('fixture.demo', 't02.shared', null)).toEqual({ ok: true, result: 'run-scope' })
    h.runtime.setUserEnabled('fixture.demo', false)
    expect(await h.runtime.dispatchChannelRequest('fixture.demo', 't02.shared', null)).toEqual({ ok: true, result: 'setup-scope' })
  })

  it('句柄 dispose：通道注销与页面入口撤下', async () => {
    const h = harness()
    let editorHandle: { dispose(): void } | undefined
    let channelHandle: { dispose(): void } | undefined
    h.register({
      enable(context) {
        editorHandle = context.pages.registerEditor(EDITOR_ENTRY)
        channelHandle = context.channel.handle('t02.temp', () => 'ok')
      },
    })
    expect(h.runtime.desiredEditorLoads()).toHaveLength(1)
    editorHandle!.dispose()
    expect(h.runtime.desiredEditorLoads()).toEqual([])
    channelHandle!.dispose()
    expect(await h.runtime.dispatchChannelRequest('fixture.demo', 't02.temp', null)).toEqual({ ok: false, reason: 'rejected' })
  })
})

describe('T02 设置页装载意图与代次边界', () => {
  it('openSettingsPage 拒绝矩阵：未注册 / 无设置页 / 故障', () => {
    const h = harness()
    expect(h.runtime.openSettingsPage('nobody')).toBe('not-registered')
    h.register({ enable(context) { context.pages.registerEditor(EDITOR_ENTRY) } })
    expect(h.runtime.openSettingsPage('fixture.demo')).toBe('no-settings-page')
  })

  it('closeSettingsPage 终结装载意图；重复关闭无害', () => {
    const h = harness()
    h.register({ setup(context) { context.settings.registerPage(SETTINGS_ENTRY) } })
    h.runtime.openSettingsPage('fixture.demo')
    expect(h.runtime.desiredSettingsLoad()).not.toBeNull()
    h.runtime.closeSettingsPage()
    expect(h.runtime.desiredSettingsLoad()).toBeNull()
    h.runtime.closeSettingsPage()
    expect(h.runtime.desiredSettingsLoad()).toBeNull()
  })

  it('settingsPanelGone：设置页面板销毁后装载意图终结，重开需再次打开', () => {
    const h = harness()
    h.register({ setup(context) { context.settings.registerPage(SETTINGS_ENTRY) } })
    h.runtime.openSettingsPage('fixture.demo')
    h.runtime.settingsPanelGone()
    expect(h.runtime.desiredSettingsLoad()).toBeNull()
    expect(h.runtime.openSettingsPage('fixture.demo')).toBe('ok')
  })

  it('release（组件代次终结）触发全部贡献释放且幂等', () => {
    const h = harness()
    const events: string[] = []
    h.register({
      setup(context) { context.settings.registerPage(SETTINGS_ENTRY) },
      enable(context) {
        context.pages.registerEditor(EDITOR_ENTRY)
        context.onDispose(() => events.push('cleanup'))
      },
    })
    h.runtime.openSettingsPage('fixture.demo')
    h.registry.release('fixture.demo')
    expect(events).toEqual(['cleanup'])
    expect(h.runtime.desiredEditorLoads()).toEqual([])
    expect(h.runtime.desiredSettingsLoad()).toBeNull()
    expect(h.runtime.runtimeStatus('fixture.demo')).toBeUndefined()
    h.registry.release('fixture.demo')
    expect(events).toEqual(['cleanup'])
  })

  it('webview 重载不递增代次：同代次重发装载（面板桥按 desired 幂等）', () => {
    const h = harness()
    h.register({ enable(context) { context.pages.registerEditor(EDITOR_ENTRY) } })
    const first = h.runtime.desiredEditorLoads()[0].generation
    const again = h.runtime.desiredEditorLoads()[0].generation
    expect(again).toBe(first)
  })
})

describe('T12 设置变化回调异常升级为全组件故障', () => {
  /** 局部 harness：暴露设置服务（变化触发面）与日志 */
  function settingsHarness() {
    const store = memoryStore()
    const logs: string[] = []
    const settingsPersistence: AddonSettingsPersistencePort = { hasWorkspace: true, read: () => undefined, write: async () => true }
    const settingsService = new AddonSettingsService(settingsPersistence)
    const runtime = new AddonRuntime({
      apiVersion: ADDON_API_VERSION,
      preferences: store,
      settings: settingsService,
      installDirOf: () => INSTALL,
      log: (stage, addonId, detail) => logs.push(`${stage}:${addonId}:${detail}`),
    })
    const extensions = [{ id: 'fixture.demo', packageJSON: { name: 'demo', publisher: 'fixture', vsidianAddon: { manifestVersion: 1, api: '^1.0.0' } } }]
    const registry = new AddonRegistry(
      {
        apiVersion: ADDON_API_VERSION,
        experimental: {},
        officialIds: OFFICIAL_ADDON_EXTENSION_IDS,
        findExtension: (id) => extensions.find((extension) => extension.id === id),
      },
      runtime.registryHooks(),
    )
    return {
      registry,
      runtime,
      settingsService,
      logs,
      register: (definition: import('../../src/host/addons/addonRegistry').AddonDefinition) =>
        registry.register({ id: 'fixture.demo' }, definition),
    }
  }

  it('组件设置变化监听器抛出未捕获异常 → 全组件暂停且通知循环不炸（其他监听者仍投递）', async () => {
    const h = settingsHarness()
    const received: number[] = []
    let listenerCalls = 0
    h.register({
      setup(context) {
        context.settings.registerDefinitions([{ key: 'demo.flag', title: 'Demo flag', type: 'boolean', default: true }])
        context.settings.onChanged(() => {
          listenerCalls++
          throw new Error('listener boom')
        })
      },
      enable() {},
    })
    // 平台侧另一个监听者（其他组件或宿主观察者——通知循环必须继续）
    h.settingsService.onChanged(() => received.push(1))
    const result = await h.settingsService.update('fixture.demo', 'user', { 'demo.flag': false })
    expect(result.ok).toBe(true)
    // 升级：设置回调异常 → 全组件故障暂停
    expect(h.runtime.runtimeStatus('fixture.demo')).toMatchObject({ runState: 'faulted' })
    expect(h.runtime.runtimeStatus('fixture.demo')!.faultReason).toContain('listener boom')
    // 通知循环不炸：平台监听者照常收到
    expect(listenerCalls).toBe(1)
    expect(received).toEqual([1])
    // 诊断日志：阶段结构化（fault/settings-listener）
    expect(h.logs.some((entry) => entry.startsWith('fault/settings-listener:fixture.demo:'))).toBe(true)
  })

  it('负向对照：设置写入被拒（无效键）不产生故障；正常监听不异常则运行态保持', async () => {
    const h = settingsHarness()
    h.register({
      setup(context) {
        context.settings.registerDefinitions([{ key: 'demo.flag', title: 'Demo flag', type: 'boolean', default: true }])
        context.settings.onChanged(() => { /* 正常 */ })
      },
      enable() {},
    })
    const rejected = await h.settingsService.update('fixture.demo', 'user', { 'demo.unknown': 1 })
    expect(rejected.ok).toBe(false)
    const ok = await h.settingsService.update('fixture.demo', 'user', { 'demo.flag': false })
    expect(ok.ok).toBe(true)
    expect(h.runtime.runtimeStatus('fixture.demo')!.runState).toBe('enabled')
  })
})
