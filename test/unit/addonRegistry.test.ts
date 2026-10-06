// #350 T01 附加组件注册表契约：registerAddon 入口核对当前宿主身份、
// 身份声明、API 范围与重复接入；同一接入代次重复注册返回
// already-registered 且不重跑 setup（规则见 design/vsidian-addon-api.md
// 第 2.2 节）。组件尚在自身激活过程中也允许注册（不要求 isActive）。
import { describe, expect, it } from 'vitest'
import { AddonRegistry } from '../../src/host/addons/addonRegistry'
import { ADDON_API_VERSION, OFFICIAL_ADDON_EXTENSION_IDS } from '../../src/shared/addonIdentity'

interface FakeExtension {
  id: string
  packageJSON: unknown
  isActive?: boolean
}

function makeRegistry(extensions: FakeExtension[]) {
  const registry = new AddonRegistry({
    apiVersion: ADDON_API_VERSION,
    experimental: {},
    officialIds: OFFICIAL_ADDON_EXTENSION_IDS,
    findExtension: (id: string) => extensions.find((extension) => extension.id === id),
  })
  return registry
}

const OK_PACKAGE = { name: 'addon-ok', publisher: 'fixture', vsidianAddon: { manifestVersion: 1, api: '^1.0.0' } }

describe('附加组件注册入口校验链', () => {
  it('合法组件注册成功：setup 恰好调用一次，上下文含组件 ID 与 API 版本', () => {
    const registry = makeRegistry([{ id: 'fixture.addon-ok', packageJSON: OK_PACKAGE }])
    const setups: unknown[] = []
    const result = registry.register({ id: 'fixture.addon-ok' }, {
      setup(context) { setups.push(context) },
    })
    expect(result).toEqual({ ok: true, addon: { addonId: 'fixture.addon-ok', apiVersion: ADDON_API_VERSION } })
    expect(setups).toEqual([{ addonId: 'fixture.addon-ok', apiVersion: ADDON_API_VERSION }])
  })

  it('组件激活中（isActive=false）同样允许注册——注册不得要求此时已激活', () => {
    const registry = makeRegistry([{ id: 'fixture.addon-ok', packageJSON: OK_PACKAGE, isActive: false }])
    const result = registry.register({ id: 'fixture.addon-ok' }, {})
    expect(result.ok).toBe(true)
  })

  it('当前宿主查不到调用者扩展 → extension-not-in-host（不等于未安装或装错侧）', () => {
    const registry = makeRegistry([])
    const result = registry.register({ id: 'fixture.addon-ok' }, {})
    expect(result).toEqual({ ok: false, reason: 'extension-not-in-host' })
  })

  it('无身份声明的普通扩展调用注册 → not-addon-extension', () => {
    const registry = makeRegistry([{ id: 'fixture.plain', packageJSON: { name: 'plain' } }])
    const result = registry.register({ id: 'fixture.plain' }, {})
    expect(result).toMatchObject({ ok: false, reason: 'not-addon-extension' })
  })

  it('声明形状非法 → not-addon-extension（携带原因详情）', () => {
    const registry = makeRegistry([{ id: 'fixture.bad', packageJSON: { vsidianAddon: { manifestVersion: 9 } } }])
    const result = registry.register({ id: 'fixture.bad' }, {})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('not-addon-extension')
      expect(typeof result.detail).toBe('string')
    }
  })

  it('声明合法但 API 范围不含宿主版本 → incompatible-api', () => {
    const registry = makeRegistry([{
      id: 'fixture.future',
      packageJSON: { vsidianAddon: { manifestVersion: 1, api: '^2.0.0' } },
    }])
    const result = registry.register({ id: 'fixture.future' }, {})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('incompatible-api')
    }
  })

  it('声明实验入口但宿主未发布 → incompatible-api（详情点名实验入口）', () => {
    const registry = makeRegistry([{
      id: 'fixture.exp',
      packageJSON: { vsidianAddon: { manifestVersion: 1, api: '^1.0.0', experimental: { cm6: '^0.1.0' } } },
    }])
    const result = registry.register({ id: 'fixture.exp' }, {})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('incompatible-api')
      expect(result.detail).toContain('cm6')
    }
  })
})

describe('重复注册与释放', () => {
  it('同一接入代次重复注册返回 already-registered，setup 不重跑', () => {
    const registry = makeRegistry([{ id: 'fixture.addon-ok', packageJSON: OK_PACKAGE }])
    let setupCount = 0
    const definition = { setup() { setupCount++ } }
    expect(registry.register({ id: 'fixture.addon-ok' }, definition).ok).toBe(true)
    const again = registry.register({ id: 'fixture.addon-ok' }, definition)
    expect(again).toEqual({ ok: false, reason: 'already-registered' })
    expect(setupCount).toBe(1)
  })

  it('release 后允许重新注册（手动重试先释放旧代次再建新代次）', () => {
    const registry = makeRegistry([{ id: 'fixture.addon-ok', packageJSON: OK_PACKAGE }])
    let setupCount = 0
    registry.register({ id: 'fixture.addon-ok' }, { setup() { setupCount++ } })
    registry.release('fixture.addon-ok')
    const result = registry.register({ id: 'fixture.addon-ok' }, { setup() { setupCount++ } })
    expect(result.ok).toBe(true)
    expect(setupCount).toBe(2)
  })

  it('注册与释放的观测口：has / setupCallCount', () => {
    const registry = makeRegistry([{ id: 'fixture.addon-ok', packageJSON: OK_PACKAGE }])
    expect(registry.has('fixture.addon-ok')).toBe(false)
    registry.register({ id: 'fixture.addon-ok' }, { setup() {} })
    expect(registry.has('fixture.addon-ok')).toBe(true)
    expect(registry.setupCallCount('fixture.addon-ok')).toBe(1)
    // 未注册的 id 观测为 0，不抛错
    expect(registry.setupCallCount('nobody')).toBe(0)
    // 重复释放无害
    registry.release('fixture.addon-ok')
    registry.release('fixture.addon-ok')
    expect(registry.has('fixture.addon-ok')).toBe(false)
  })

  it('setup 抛错不撤销注册记录（异常归因与故障暂停属后续票；本票不吞错也不半初始化）', () => {
    const registry = makeRegistry([{ id: 'fixture.addon-ok', packageJSON: OK_PACKAGE }])
    expect(() =>
      registry.register({ id: 'fixture.addon-ok' }, { setup() { throw new Error('boom') } }),
    ).toThrow('boom')
    expect(registry.has('fixture.addon-ok')).toBe(true)
  })
})
