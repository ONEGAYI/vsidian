// #353 T04 附加组件运行生命周期与设置服务的集成契约（纯逻辑，vscode 经
// 端口注入）。钉住：
// - setup context 的公开设置 API 形状：get()/getSource/update/clear-
//   WorkspaceOverride/onChanged（技术方案 5.5）；定义经 registerDefinitions
//   进入服务（按组件隔离）。
// - 按批写成功后组件 onChanged 收到变化；get() 反映新值与来源；故障暂停
//   后定义保留（服务仍在）、迟到订阅停投。
// - 设置区状态机：openSettingsArea（无定义且无自定义页拒绝；faulted 仍可
//   打开——定义保留供基础控件）、closeSettingsArea。
// - 功能开关两层：setEnabledScope 写对应层、effectiveEnabled 三层序、
//   clearEnabledOverride 只清工作区覆盖、无工作区拒绝写 workspace。
// - 新 setup 代次重跑替换定义集（clearDefinitions 时机在 setup 前）。
import { describe, expect, it } from 'vitest'
import { AddonRegistry, type AddonDefinition } from '../../src/host/addons/addonRegistry'
import { AddonRuntime, type AddonPreferenceStore } from '../../src/host/addons/addonRuntime'
import { AddonSettingsService, type AddonSettingsPersistencePort } from '../../src/host/addons/addonSettingsService'
import { AddonStorageService } from '../../src/host/addons/addonStorageService'
import { ADDON_API_VERSION, OFFICIAL_ADDON_EXTENSION_IDS } from '../../src/shared/addonIdentity'

function memoryPreference(initial: { user?: Record<string, boolean>; workspace?: Record<string, boolean> | null } = {}): AddonPreferenceStore & { user: Record<string, boolean>; workspace: Record<string, boolean> | null } {
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

/** 无工作区偏好层（workspace 层读写拒绝路径） */
function noWorkspacePreference(): AddonPreferenceStore {
  return {
    hasWorkspace: false,
    read: () => ({ user: {}, workspace: null }),
    write: () => {},
  }
}

function memorySettingsPersistence(hasWorkspace = true): AddonSettingsPersistencePort & { raw: Map<'user' | 'workspace', unknown> } {
  const raw = new Map<'user' | 'workspace', unknown>()
  return {
    raw,
    hasWorkspace,
    read: (scope) => raw.get(scope),
    write: async (scope, value) => {
      raw.set(scope, value)
      return true
    },
  }
}

interface Harness {
  registry: AddonRegistry
  runtime: AddonRuntime
  settings: AddonSettingsService
  register(definition?: AddonDefinition): unknown
}

function harness(options: { preference?: ReturnType<typeof memoryPreference> | AddonPreferenceStore; settingsPersistence?: ReturnType<typeof memorySettingsPersistence> } = {}): Harness {
  const preferences = options.preference ?? memoryPreference()
  const settingsPersistence = options.settingsPersistence ?? memorySettingsPersistence()
  const settings = new AddonSettingsService(settingsPersistence)
  const runtime = new AddonRuntime({
    apiVersion: ADDON_API_VERSION,
    preferences,
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
    installDirOf: () => 'C:\\addons\\demo',
    log: () => {},
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
    settings,
    register: (definition) => registry.register({ id: 'fixture.demo' }, definition ?? {}),
  }
}

const DEFS = [
  { key: 'flag', title: '开关', type: 'boolean' as const, default: true },
  { key: 'threshold', title: '阈值', type: 'number' as const, min: 1, max: 100, default: 20 },
  { key: 'replacements', title: '替换规则', type: 'array' as const, items: { kind: 'string' as const, maxLength: 10 }, default: ['旧→新'] },
  {
    key: 'limits', title: '对象样例', type: 'object' as const,
    fields: [
      { key: 'name', title: '名称', kind: 'string' as const, maxLength: 10, default: 'demo' },
      { key: 'count', title: '数量', kind: 'number' as const, min: 0, max: 9, default: 3 },
    ],
  },
]

describe('T04 runtime：setup context 设置 API（公开消费面）', () => {
  it('registerDefinitions 进入服务；get() 返回默认值与来源 default', () => {
    const h = harness()
    let api: import('../../src/host/addons/addonRegistry').AddonSetupContext['settings'] | undefined
    h.register({
      setup(context) {
        api = context.settings
        context.settings.registerDefinitions(DEFS)
      },
    })
    expect(h.settings.definitionsOf('fixture.demo')).toHaveLength(4)
    const snapshot = api!.get()
    expect(snapshot.values).toEqual({ flag: true, threshold: 20, replacements: ['旧→新'], limits: { name: 'demo', count: 3 } })
    expect(snapshot.sources['threshold']).toBe('default')
    expect(api!.getSource('threshold')).toBe('default')
    expect(api!.getSource('mystery')).toBeUndefined()
  })

  it('update/clearWorkspaceOverride 经公开 API 生效；onChanged 在持久化成功后投递', async () => {
    const h = harness()
    const changes: Array<{ scope: string; keys: readonly string[] }> = []
    let api: import('../../src/host/addons/addonRegistry').AddonSetupContext['settings'] | undefined
    h.register({
      setup(context) {
        api = context.settings
        context.settings.registerDefinitions(DEFS)
        context.settings.onChanged((change) => changes.push(change))
      },
    })
    const result = await api!.update('user', { threshold: 33, replacements: ['a', 'b'] })
    expect(result).toEqual({ ok: true })
    expect(changes).toEqual([{ scope: 'user', keys: ['threshold', 'replacements'] }])
    expect(api!.get().values['threshold']).toBe(33)
    expect(api!.get().sources['threshold']).toBe('user')
    await api!.update('workspace', { threshold: 44 })
    expect(api!.get().sources['threshold']).toBe('workspace')
    expect(await api!.clearWorkspaceOverride('threshold')).toEqual({ ok: true })
    expect(api!.get().sources['threshold']).toBe('user')
    expect(changes).toHaveLength(3)
  })

  it('非法补丁整批拒绝（不虚报）：结果可辨认、值不变、事件不发', async () => {
    const h = harness()
    const changes: unknown[] = []
    let api: import('../../src/host/addons/addonRegistry').AddonSetupContext['settings'] | undefined
    h.register({
      setup(context) {
        api = context.settings
        context.settings.registerDefinitions(DEFS)
        context.settings.onChanged((change) => changes.push(change))
      },
    })
    const result = await api!.update('user', { threshold: 500, flag: false })
    expect(result).toMatchObject({ ok: false, reason: 'invalid-value' })
    expect(api!.get().values['threshold']).toBe(20)
    expect(api!.get().values['flag']).toBe(true)
    expect(changes).toEqual([])
  })

  it('无工作区：update workspace 拒绝 no-workspace，get 仍可用', async () => {
    const h = harness({ settingsPersistence: memorySettingsPersistence(false) })
    let api: import('../../src/host/addons/addonRegistry').AddonSetupContext['settings'] | undefined
    h.register({ setup(context) { api = context.settings; context.settings.registerDefinitions(DEFS) } })
    expect(await api!.update('workspace', { threshold: 5 })).toMatchObject({ ok: false, reason: 'no-workspace' })
    expect(api!.get().values['threshold']).toBe(20)
  })
})

describe('T04 runtime：故障暂停与定义保留', () => {
  it('可归因异常暂停后：定义保留在服务（基础控件数据源仍在），组件订阅停投', async () => {
    const h = harness()
    const changes: unknown[] = []
    h.register({
      setup(context) {
        context.settings.registerDefinitions(DEFS)
        context.settings.onChanged((change) => changes.push(change))
        context.channel.handle('crash', () => { throw new Error('boom') })
      },
    })
    await h.runtime.dispatchChannelRequest('fixture.demo', 'crash', null)
    expect(h.runtime.runtimeStatus('fixture.demo')?.runState).toBe('faulted')
    // 定义保留：服务仍可查（平台基础控件可用）；平台侧写入照常（不经组件代码）
    expect(h.settings.hasDefinitions('fixture.demo')).toBe(true)
    expect(await h.settings.update('fixture.demo', 'user', { threshold: 8 })).toEqual({ ok: true })
    // 组件订阅已随代次故障停投（组件代码暂停——不再接收平台事件）
    expect(changes).toEqual([])
  })
})

describe('T04 runtime：设置区状态机（基础控件区）', () => {
  it('有定义的组件可打开设置区；无定义且无自定义页拒绝', () => {
    const h = harness()
    h.register({ setup(context) { context.settings.registerDefinitions(DEFS) } })
    expect(h.runtime.openSettingsArea('fixture.demo')).toBe('ok')
    expect(h.runtime.settingsAreaAddonId()).toBe('fixture.demo')
    h.runtime.closeSettingsArea()
    expect(h.runtime.settingsAreaAddonId()).toBeUndefined()
    expect(h.runtime.openSettingsArea('unknown.addon')).toBe('not-registered')
    // 无定义组件（仅通道）
    h.registry.release('fixture.demo')
    h.register({ setup(context) { context.channel.handle('x', () => 1) } })
    expect(h.runtime.openSettingsArea('fixture.demo')).toBe('no-definitions')
  })

  it('仅自定义页无定义的组件也可打开（基础区为空但有自定义页入口）', () => {
    const h = harness()
    h.register({
      setup(context) {
        context.settings.registerPage({ entry: 'dist/settings.js' })
      },
    })
    expect(h.runtime.openSettingsArea('fixture.demo')).toBe('ok')
  })

  it('faulted 组件仍可打开设置区（定义保留——基础控件与修正参数入口）', () => {
    const h = harness()
    h.register({
      setup(context) {
        context.settings.registerDefinitions(DEFS)
        context.channel.handle('crash', () => { throw new Error('boom') })
      },
    })
    void h.runtime.dispatchChannelRequest('fixture.demo', 'crash', null)
    expect(h.runtime.openSettingsArea('fixture.demo')).toBe('ok')
    // 自定义页装载通道仍按 T02 语义拒绝（页面代码撤下）
    expect(h.runtime.openSettingsPage('fixture.demo')).toBe('faulted')
  })

  it('组件注销时设置区关闭（面板桥不再渲染数据）', () => {
    const h = harness()
    h.register({ setup(context) { context.settings.registerDefinitions(DEFS) } })
    h.runtime.openSettingsArea('fixture.demo')
    h.registry.release('fixture.demo')
    expect(h.runtime.settingsAreaAddonId()).toBeUndefined()
  })
})

describe('T04 runtime：功能开关两层作用范围', () => {
  it('setEnabledScope 写对应层；effectiveEnabled 三层序；clearEnabledOverride 只清工作区覆盖', () => {
    const preference = memoryPreference()
    const h = harness({ preference })
    h.register({ setup(context) { context.settings.registerDefinitions(DEFS) } })
    // 默认启用（无显式偏好）
    expect(h.runtime.effectiveEnabled('fixture.demo')).toBe(true)
    // user 层关闭
    h.runtime.setEnabledScope('fixture.demo', 'user', false)
    expect(preference.user['fixture.demo']).toBe(false)
    expect(h.runtime.effectiveEnabled('fixture.demo')).toBe(false)
    // workspace 层覆盖为启用
    h.runtime.setEnabledScope('fixture.demo', 'workspace', true)
    expect(h.runtime.effectiveEnabled('fixture.demo')).toBe(true)
    // 清除工作区覆盖：回 user 层（false）——恢复继承，不是恢复出厂
    h.runtime.clearEnabledOverride('fixture.demo')
    expect(h.runtime.effectiveEnabled('fixture.demo')).toBe(false)
    expect(preference.workspace?.['fixture.demo']).toBeUndefined()
    expect(preference.user['fixture.demo']).toBe(false)
  })

  it('无工作区时写 workspace 层拒绝；无覆盖时 clear 幂等无害', () => {
    const preference = noWorkspacePreference()
    const h = harness({ preference })
    h.register({})
    expect(h.runtime.setEnabledScope('fixture.demo', 'workspace', false)).toBe('no-workspace')
    expect(h.runtime.clearEnabledOverride('fixture.demo')).toBe('no-workspace')
    expect(preference.read().workspace).toBeNull()
  })

  it('setUserEnabled 保持 T02 语义（写用户默认层）', () => {
    const preference = memoryPreference()
    const h = harness({ preference })
    h.register({})
    h.runtime.setUserEnabled('fixture.demo', false)
    expect(preference.user['fixture.demo']).toBe(false)
  })
})

describe('T04 runtime：新 setup 代次重跑替换定义集', () => {
  it('release 后重新注册：定义先清空再收集（升级不残留旧键）', () => {
    const h = harness()
    const first: AddonDefinition = {
      setup(context) { context.settings.registerDefinitions(DEFS) },
    }
    h.register(first)
    expect(h.settings.definitionsOf('fixture.demo')).toHaveLength(4)
    h.registry.release('fixture.demo')
    // 新代次只注册一个定义
    h.register({
      setup(context) { context.settings.registerDefinitions([DEFS[0]!]) },
    })
    expect(h.settings.definitionsOf('fixture.demo')).toHaveLength(1)
  })
})
