// #353 T04 附加组件设置服务契约测试（宿主侧纯逻辑，持久层经端口注入）。
//
// 钉住票面规则：
// - 定义按组件 ID 隔离；非法定义整批拒绝；重复 key（批内/既有）整批拒绝；
//   重新注册替换定义集，存储值不重置（普通升级不重置）。
// - 按批校验与保存：未知键/非法值/无工作区写 workspace → 整批拒绝，
//   有效值不落地；持久化失败（write false）不虚报成功、内存回滚、
//   变化事件不发；变化事件只在持久化成功后发出。
// - 清除工作区覆盖只删该键覆盖（恢复继承，不是恢复出厂值）。
// - 跨窗口/重启边界：同 store 新实例读到先前写入（重启回显语义）；
//   写序串行化（两次并发 update 不丢键）。
import { describe, expect, it } from 'vitest'
import { AddonSettingsService, type AddonSettingsPersistencePort } from '../../src/host/addons/addonSettingsService'
import type { AddonSettingDefinition } from '../../src/shared/addonSettings'

/** 内存持久层（模拟 globalState/workspaceState；fail 可动态开关注入写失败） */
function memoryPersistence(options: { hasWorkspace?: boolean; failWrite?: 'user' | 'workspace' | 'always' } = {}): AddonSettingsPersistencePort & { raw: Map<'user' | 'workspace', unknown>; fail: null | 'user' | 'workspace' | 'always' } {
  const raw = new Map<'user' | 'workspace', unknown>()
  const handle = {
    raw,
    fail: (options.failWrite ?? null) as null | 'user' | 'workspace' | 'always',
    hasWorkspace: options.hasWorkspace ?? true,
    read: (scope: 'user' | 'workspace') => raw.get(scope),
    write: async (scope: 'user' | 'workspace', value: unknown) => {
      const failure = handle.fail
      if (failure === scope || failure === 'always') return false
      raw.set(scope, value)
      return true
    },
  }
  return handle
}

const DEFS: readonly AddonSettingDefinition[] = [
  { key: 'flag', title: '开关', type: 'boolean', default: true },
  { key: 'threshold', title: '阈值', type: 'number', min: 1, max: 100, default: 20 },
  { key: 'replacements', title: '替换规则', type: 'array', items: { kind: 'string', maxLength: 10 }, default: ['旧→新'] },
  {
    key: 'limits', title: '对象样例', type: 'object',
    fields: [
      { key: 'name', title: '名称', kind: 'string', maxLength: 10, default: 'demo' },
      { key: 'count', title: '数量', kind: 'number', min: 0, max: 9, default: 3 },
    ],
  },
]

describe('T04 设置服务：定义注册（按组件隔离 + 整批拒绝）', () => {
  it('合法批注册成功；definitionsOf 按组件隔离', () => {
    const port = memoryPersistence()
    const service = new AddonSettingsService(port)
    expect(service.registerDefinitions('a.demo', DEFS)).toEqual({ ok: true })
    expect(service.registerDefinitions('b.other', [DEFS[0]!])).toEqual({ ok: true })
    expect(service.definitionsOf('a.demo')).toHaveLength(4)
    expect(service.definitionsOf('b.other')).toHaveLength(1)
    expect(service.definitionsOf('c.none')).toEqual([])
    expect(service.hasDefinitions('a.demo')).toBe(true)
  })

  it('非法定义整批拒绝（批内一非法全拒，合法项不落地）', () => {
    const service = new AddonSettingsService(memoryPersistence())
    const result = service.registerDefinitions('a.demo', [DEFS[0]!, { key: 'bad', title: '坏', type: 'boolean', default: 1 }])
    expect(result.ok).toBe(false)
    expect(service.definitionsOf('a.demo')).toEqual([])
  })

  it('重复 key 拒绝：批内重复与既有重复', () => {
    const service = new AddonSettingsService(memoryPersistence())
    expect(service.registerDefinitions('a.demo', [DEFS[0]!, { ...DEFS[0]!, title: '同名' }]).ok).toBe(false)
    expect(service.registerDefinitions('a.demo', DEFS).ok).toBe(true)
    expect(service.registerDefinitions('a.demo', [DEFS[0]!]).ok).toBe(false)
    // 拒绝批不影响既有定义
    expect(service.definitionsOf('a.demo')).toHaveLength(4)
  })

  it('重新注册（新代次 setup）替换定义集；存储值不重置（普通升级不重置）', async () => {
    const port = memoryPersistence()
    const service = new AddonSettingsService(port)
    service.registerDefinitions('a.demo', DEFS)
    await service.update('a.demo', 'user', { threshold: 55 })
    // 新 setup 代次：runtime 先清空定义集再注册新批（键集变化）
    service.clearDefinitions('a.demo')
    service.registerDefinitions('a.demo', [{ key: 'threshold', title: '阈值', type: 'number', min: 1, max: 200, default: 20 }])
    expect(service.definitionsOf('a.demo')).toHaveLength(1)
    // 旧键 threshold 的存储值保留且仍生效（新定义 min/max 放宽后合法）
    const snapshot = service.effectiveSnapshot('a.demo')
    expect(snapshot.values['threshold']).toBe(55)
    expect(snapshot.sources['threshold']).toBe('user')
    // 已从定义集消失的键（flag）不呈现，但存储未删（重新登记后回来）
    expect(snapshot.values['flag']).toBeUndefined()
    service.clearDefinitions('a.demo')
    service.registerDefinitions('a.demo', DEFS)
    expect(service.effectiveSnapshot('a.demo').values['flag']).toBe(true)
  })
})

describe('T04 设置服务：默认值与生效快照', () => {
  it('未写入时生效值 = 出厂默认，来源 default；对象出厂值按字段组装', () => {
    const service = new AddonSettingsService(memoryPersistence())
    service.registerDefinitions('a.demo', DEFS)
    const snapshot = service.effectiveSnapshot('a.demo')
    expect(snapshot.values).toEqual({
      flag: true,
      threshold: 20,
      replacements: ['旧→新'],
      limits: { name: 'demo', count: 3 },
    })
    expect(snapshot.sources).toEqual({ flag: 'default', threshold: 'default', replacements: 'default', limits: 'default' })
    expect(snapshot.hasWorkspace).toBe(true)
  })

  it('存量非法值（定义升级漂移）：显示层回默认但存储保留', async () => {
    const port = memoryPersistence()
    const service = new AddonSettingsService(port)
    service.registerDefinitions('a.demo', DEFS)
    await service.update('a.demo', 'user', { threshold: 50 })
    // 模拟定义升级：max 收窄到 40，存量 50 漂移（新代次 setup 替换定义）
    service.clearDefinitions('a.demo')
    service.registerDefinitions('a.demo', [{ key: 'threshold', title: '阈值', type: 'number', min: 1, max: 40, default: 20 }])
    const snapshot = service.effectiveSnapshot('a.demo')
    expect(snapshot.values['threshold']).toBe(20)
    expect(snapshot.sources['threshold']).toBe('default')
    // 存储未删：定义回放宽后恢复生效
    service.clearDefinitions('a.demo')
    service.registerDefinitions('a.demo', [{ key: 'threshold', title: '阈值', type: 'number', min: 1, max: 100, default: 20 }])
    expect(service.effectiveSnapshot('a.demo').values['threshold']).toBe(50)
  })
})

describe('T04 设置服务：按批校验与保存', () => {
  it('合法补丁落盘：user 层与 workspace 层各自写入，生效值切换来源', async () => {
    const port = memoryPersistence()
    const service = new AddonSettingsService(port)
    service.registerDefinitions('a.demo', DEFS)
    expect(await service.update('a.demo', 'user', { threshold: 30, replacements: ['a', 'b'], limits: { name: 'x', count: 1 } })).toEqual({ ok: true })
    let snapshot = service.effectiveSnapshot('a.demo')
    expect(snapshot.values['threshold']).toBe(30)
    expect(snapshot.sources['threshold']).toBe('user')
    expect(await service.update('a.demo', 'workspace', { threshold: 77 })).toEqual({ ok: true })
    snapshot = service.effectiveSnapshot('a.demo')
    expect(snapshot.values['threshold']).toBe(77)
    expect(snapshot.sources['threshold']).toBe('workspace')
    // 层值快照：两层显式值各自可读（userValues / workspaceValues）
    expect(snapshot.userValues['threshold']).toBe(30)
    expect(snapshot.workspaceValues?.['threshold']).toBe(77)
  })

  it('非法补丁整批拒绝：合法键不落地、值不变', async () => {
    const port = memoryPersistence()
    const service = new AddonSettingsService(port)
    service.registerDefinitions('a.demo', DEFS)
    await service.update('a.demo', 'user', { threshold: 30 })
    // threshold=500 超界 + flag 合法混批 → 整批拒绝
    const result = await service.update('a.demo', 'user', { threshold: 500, flag: false })
    expect(result).toEqual({ ok: false, reason: 'invalid-value', invalidKeys: ['threshold'] })
    const snapshot = service.effectiveSnapshot('a.demo')
    expect(snapshot.values['threshold']).toBe(30)
    expect(snapshot.values['flag']).toBe(true)
    expect(port.raw.get('user')).toBeDefined()
  })

  it('未知键拒绝（补丁键不在定义集）', async () => {
    const service = new AddonSettingsService(memoryPersistence())
    service.registerDefinitions('a.demo', DEFS)
    const result = await service.update('a.demo', 'user', { mystery: 1 })
    expect(result).toEqual({ ok: false, reason: 'unknown-key', invalidKeys: ['mystery'] })
  })

  it('无工作区时写 workspace 层拒绝；读层为 null', async () => {
    const service = new AddonSettingsService(memoryPersistence({ hasWorkspace: false }))
    service.registerDefinitions('a.demo', DEFS)
    expect(await service.update('a.demo', 'workspace', { threshold: 5 })).toEqual({ ok: false, reason: 'no-workspace' })
    expect(service.effectiveSnapshot('a.demo').hasWorkspace).toBe(false)
    expect(service.effectiveSnapshot('a.demo').workspaceValues).toBeNull()
  })

  it('持久化失败不虚报：内存回滚、事件不发、错误结果可辨认', async () => {
    const port = memoryPersistence({ failWrite: 'always' })
    const service = new AddonSettingsService(port)
    service.registerDefinitions('a.demo', DEFS)
    const changes: unknown[] = []
    service.onChanged((change) => changes.push(change))
    const result = await service.update('a.demo', 'user', { threshold: 40 })
    expect(result).toEqual({ ok: false, reason: 'store-write-failed' })
    // 内存权威回滚（仍是默认值），事件零投递
    expect(service.effectiveSnapshot('a.demo').values['threshold']).toBe(20)
    expect(changes).toEqual([])
  })

  it('变化事件只在持久化成功后发出（携带组件 ID、层与键清单）', async () => {
    const service = new AddonSettingsService(memoryPersistence())
    service.registerDefinitions('a.demo', DEFS)
    const changes: Array<{ addonId: string; scope: string; keys: readonly string[] }> = []
    service.onChanged((change) => changes.push(change))
    await service.update('a.demo', 'user', { threshold: 40 })
    expect(changes).toEqual([{ addonId: 'a.demo', scope: 'user', keys: ['threshold'] }])
    await service.update('a.demo', 'workspace', { threshold: 41, flag: false })
    expect(changes).toHaveLength(2)
    expect(changes[1]).toEqual({ addonId: 'a.demo', scope: 'workspace', keys: ['threshold', 'flag'] })
  })
})

describe('T04 设置服务：清除工作区覆盖', () => {
  it('清除后恢复继承用户默认（不是恢复出厂值）；存储层键删除', async () => {
    const port = memoryPersistence()
    const service = new AddonSettingsService(port)
    service.registerDefinitions('a.demo', DEFS)
    await service.update('a.demo', 'user', { threshold: 30 })
    await service.update('a.demo', 'workspace', { threshold: 77 })
    expect(service.effectiveSnapshot('a.demo').sources['threshold']).toBe('workspace')
    expect(await service.clearWorkspaceOverride('a.demo', 'threshold')).toEqual({ ok: true })
    const snapshot = service.effectiveSnapshot('a.demo')
    expect(snapshot.values['threshold']).toBe(30)
    expect(snapshot.sources['threshold']).toBe('user')
    expect(snapshot.workspaceValues?.['threshold']).toBeUndefined()
    // 清除无覆盖键：幂等成功（值不变）
    expect(await service.clearWorkspaceOverride('a.demo', 'flag')).toEqual({ ok: true })
    expect(service.effectiveSnapshot('a.demo').values['flag']).toBe(true)
  })

  it('清除未知键拒绝；无工作区拒绝；持久化失败不虚报', async () => {
    const noWorkspace = new AddonSettingsService(memoryPersistence({ hasWorkspace: false }))
    noWorkspace.registerDefinitions('a.demo', DEFS)
    expect(await noWorkspace.clearWorkspaceOverride('a.demo', 'threshold')).toEqual({ ok: false, reason: 'no-workspace' })

    const failingPort = memoryPersistence()
    const failing = new AddonSettingsService(failingPort)
    failing.registerDefinitions('a.demo', DEFS)
    expect(await failing.clearWorkspaceOverride('a.demo', 'mystery')).toEqual({ ok: false, reason: 'unknown-key', invalidKeys: ['mystery'] })
    // 覆盖先成功落地，再切换持久层为写失败——清除路径不虚报
    await failing.update('a.demo', 'workspace', { threshold: 9 })
    failingPort.fail = 'workspace'
    expect(await failing.clearWorkspaceOverride('a.demo', 'threshold')).toEqual({ ok: false, reason: 'store-write-failed' })
    // 内存未变（覆盖仍在）
    expect(failing.effectiveSnapshot('a.demo').sources['threshold']).toBe('workspace')
  })
})

describe('T04 设置服务：持久化与跨窗口边界', () => {
  it('同 store 新实例读到先前写入（重启/新窗口回显语义）', async () => {
    const port = memoryPersistence()
    const first = new AddonSettingsService(port)
    first.registerDefinitions('a.demo', DEFS)
    await first.update('a.demo', 'user', { threshold: 33, replacements: ['x'] })
    await first.update('a.demo', 'workspace', { limits: { name: 'y', count: 2 } })
    // 新实例（模拟重启）：定义未注册时层值仍可读，生效值待定义注册后呈现
    const second = new AddonSettingsService(port)
    const raw = second.effectiveSnapshot('a.demo')
    expect(raw.userValues['threshold']).toBe(33)
    expect(raw.workspaceValues?.['limits']).toEqual({ name: 'y', count: 2 })
    second.registerDefinitions('a.demo', DEFS)
    const snapshot = second.effectiveSnapshot('a.demo')
    expect(snapshot.values['threshold']).toBe(33)
    expect(snapshot.values['limits']).toEqual({ name: 'y', count: 2 })
    expect(snapshot.sources['threshold']).toBe('user')
  })

  it('存储坏形态 fail-safe：解析回空不抛错、不写回覆盖', async () => {
    const port = memoryPersistence()
    port.raw.set('user', { version: 99, values: {} })
    port.raw.set('workspace', 'junk')
    const service = new AddonSettingsService(port)
    service.registerDefinitions('a.demo', DEFS)
    // 全部回默认（fail-safe），不炸
    const snapshot = service.effectiveSnapshot('a.demo')
    expect(snapshot.sources['threshold']).toBe('default')
    expect(snapshot.workspaceValues).toEqual({})
    // 下一次成功写入按 v1 结构落盘（不残留坏形态）
    await service.update('a.demo', 'user', { threshold: 10 })
    const stored = port.raw.get('user') as { version: number }
    expect(stored.version).toBe(1)
  })

  it('写序串行化：并发 update 不丢键（读改写不交错）', async () => {
    const port = memoryPersistence()
    const service = new AddonSettingsService(port)
    service.registerDefinitions('a.demo', DEFS)
    await Promise.all([
      service.update('a.demo', 'user', { threshold: 10 }),
      service.update('a.demo', 'user', { flag: false }),
      service.update('a.demo', 'user', { replacements: ['p'] }),
    ])
    const snapshot = service.effectiveSnapshot('a.demo')
    expect(snapshot.userValues).toEqual({ threshold: 10, flag: false, replacements: ['p'] })
  })

  it('onChanged 退订后不再投递', async () => {
    const service = new AddonSettingsService(memoryPersistence())
    service.registerDefinitions('a.demo', DEFS)
    const changes: unknown[] = []
    const off = service.onChanged((change) => changes.push(change))
    off()
    await service.update('a.demo', 'user', { threshold: 10 })
    expect(changes).toEqual([])
  })

  it('同窗口外部刷新钩子：onExternalChange 触发重读持久层（跨面板对账入口）', async () => {
    const port = memoryPersistence()
    const service = new AddonSettingsService(port)
    service.registerDefinitions('a.demo', DEFS)
    // 另一实例（同窗口其他面板装配）写入同一持久层
    const other = new AddonSettingsService(port)
    other.registerDefinitions('a.demo', DEFS)
    await other.update('a.demo', 'user', { threshold: 66 })
    // 本实例不重读时仍是旧视图；外部变更钩子触发后对账
    expect(service.effectiveSnapshot('a.demo').values['threshold']).toBe(20)
    service.refreshFromPersistence()
    expect(service.effectiveSnapshot('a.demo').values['threshold']).toBe(66)
  })

  it('构造时即从持久层装配（vi 验证无懒加载竞态）', () => {
    const port = memoryPersistence()
    port.raw.set('user', { version: 1, values: { 'a.demo': { threshold: 5 } } })
    const service = new AddonSettingsService(port)
    expect(service.effectiveSnapshot('a.demo').userValues['threshold']).toBe(5)
  })
})

describe('T04 设置服务：无效持久层值与定义缺失的组合', () => {
  it('定义未注册时 update 拒绝（unknown-key），clear 拒绝', async () => {
    const service = new AddonSettingsService(memoryPersistence())
    expect(await service.update('a.demo', 'user', { threshold: 5 })).toEqual({ ok: false, reason: 'unknown-key', invalidKeys: ['threshold'] })
    expect(await service.clearWorkspaceOverride('a.demo', 'threshold')).toEqual({ ok: false, reason: 'unknown-key', invalidKeys: ['threshold'] })
  })

  it('日志端口留痕：定义拒绝与写失败经 log 端口归因', async () => {
    const logs: string[] = []
    const port = memoryPersistence({ failWrite: 'user' })
    const service = new AddonSettingsService(port, (stage, addonId, detail) => logs.push(`${stage}:${addonId}:${detail}`))
    service.registerDefinitions('a.demo', [DEFS[0]!, { key: 'bad', title: '坏', type: 'boolean', default: 1 }])
    // 合法定义单独注册成功后触发落盘失败路径
    service.registerDefinitions('a.demo', [DEFS[1]!])
    await service.update('a.demo', 'user', { threshold: 7 })
    expect(logs.some((line) => line.startsWith('definitions-rejected:a.demo'))).toBe(true)
    expect(logs.some((line) => line.startsWith('store-write-failed:a.demo'))).toBe(true)
  })
})

describe('#395 P3 设置回写等值短路（同值不落盘不发事件）', () => {
  /** 带写调用计数的持久层（memoryPersistence 外包一层计数） */
  function countingPersistence(): ReturnType<typeof memoryPersistence> & { writeCalls: () => number } {
    const port = memoryPersistence()
    let calls = 0
    const inner = port.write.bind(port)
    port.write = async (scope, value) => {
      calls++
      return inner(scope, value)
    }
    return Object.assign(port, { writeCalls: () => calls })
  }

  it('同值 update：返回 ok、不写持久层、不发 onChanged（回写环路不再无限写盘）', async () => {
    const port = countingPersistence()
    const service = new AddonSettingsService(port)
    service.registerDefinitions('a.demo', DEFS)
    const changes: string[] = []
    service.onChanged((change) => changes.push(change.keys.join(',')))
    await service.update('a.demo', 'user', { threshold: 55 })
    expect(port.writeCalls()).toBe(1)
    expect(changes).toEqual(['threshold'])
    // 组件在 onChanged 里回写同值的环路：第二次起等值短路
    await service.update('a.demo', 'user', { threshold: 55 })
    expect(await service.update('a.demo', 'user', { threshold: 55 })).toEqual({ ok: true })
    expect(port.writeCalls()).toBe(1)
    expect(changes).toEqual(['threshold'])
    expect(service.effectiveSnapshot('a.demo').values['threshold']).toBe(55)
  })

  it('嵌套对象同值（JSON 视角深等值）同样短路；空补丁不产生落盘与事件', async () => {
    const port = countingPersistence()
    const service = new AddonSettingsService(port)
    service.registerDefinitions('a.demo', DEFS)
    const changes: number[] = []
    service.onChanged(() => changes.push(changes.length))
    await service.update('a.demo', 'user', { limits: { name: 'demo', count: 3 } })
    expect(port.writeCalls()).toBe(1)
    // 与存储值深等值的对象再写：短路
    await service.update('a.demo', 'user', { limits: { name: 'demo', count: 3 } })
    expect(port.writeCalls()).toBe(1)
    // 空补丁：无键可变，等值短路
    await service.update('a.demo', 'user', {})
    expect(port.writeCalls()).toBe(1)
    expect(changes).toHaveLength(1)
  })

  it('真值变化照常落盘与广播（短路与写失败互不干扰）', async () => {
    const port = countingPersistence()
    const service = new AddonSettingsService(port)
    service.registerDefinitions('a.demo', DEFS)
    const changes: Array<Record<string, unknown>> = []
    service.onChanged((change) => changes.push({ keys: change.keys, scope: change.scope }))
    await service.update('a.demo', 'user', { threshold: 55 })
    await service.update('a.demo', 'user', { threshold: 60 })
    expect(port.writeCalls()).toBe(2)
    expect(changes).toHaveLength(2)
    expect(service.effectiveSnapshot('a.demo').values['threshold']).toBe(60)
    // 短路不吞失败路径：真变化 + 落盘失败仍报失败
    port.fail = 'user'
    expect(await service.update('a.demo', 'user', { threshold: 70 })).toEqual({ ok: false, reason: 'store-write-failed' })
    expect(service.effectiveSnapshot('a.demo').values['threshold']).toBe(60)
  })
})
