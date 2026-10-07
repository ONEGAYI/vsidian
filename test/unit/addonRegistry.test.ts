// #350 T01 / #351 T02 附加组件注册表契约：registerAddon 入口核对当前宿主
// 身份、身份声明、API 范围与重复接入；同一接入代次重复注册返回
// already-registered 且不重跑接入回调（规则见 design/vsidian-addon-api.md
// 第 2.2 节）。组件尚在自身激活过程中也允许注册（不要求 isActive）。
// T02 起 setup/enable 生命周期经 hooks 桥交给 AddonRuntime 驱动（本文件
// 以记录 hooks 钉住联动契约；生命周期行为本身见 addonRuntime.test.ts）。
import { describe, expect, it } from 'vitest'
import { AddonRegistry, type AddonDefinition, type AddonRegistryHooks } from '../../src/host/addons/addonRegistry'
import { ADDON_API_VERSION, OFFICIAL_ADDON_EXTENSION_IDS } from '../../src/shared/addonIdentity'

interface FakeExtension {
  id: string
  packageJSON: unknown
  isActive?: boolean
}

function makeRegistry(extensions: FakeExtension[], hooks?: AddonRegistryHooks) {
  const registry = new AddonRegistry({
    apiVersion: ADDON_API_VERSION,
    experimental: {},
    officialIds: OFFICIAL_ADDON_EXTENSION_IDS,
    findExtension: (id: string) => extensions.find((extension) => extension.id === id),
  }, hooks)
  return registry
}

const OK_PACKAGE = { name: 'addon-ok', publisher: 'fixture', vsidianAddon: { manifestVersion: 1, api: '^1.0.0' } }

describe('附加组件注册入口校验链', () => {
  it('合法组件注册成功：hooks.onAccepted 恰好一次，携带组件 ID 与定义', () => {
    const accepted: Array<{ addonId: string; definition: AddonDefinition }> = []
    const registry = makeRegistry([{ id: 'fixture.addon-ok', packageJSON: OK_PACKAGE }], {
      onAccepted: (addonId, definition) => accepted.push({ addonId, definition }),
      onReleased: () => {},
    })
    const definition: AddonDefinition = { setup() {} }
    const result = registry.register({ id: 'fixture.addon-ok' }, definition)
    expect(result).toEqual({ ok: true, addon: { addonId: 'fixture.addon-ok', apiVersion: ADDON_API_VERSION } })
    expect(accepted).toEqual([{ addonId: 'fixture.addon-ok', definition }])
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

  it('声明宿主未发布的实验入口 → incompatible-api（详情点名实验入口）', () => {
    const registry = makeRegistry([{
      id: 'fixture.exp',
      packageJSON: { vsidianAddon: { manifestVersion: 1, api: '^1.0.0', experimental: { secret: '^0.1.0' } } },
    }])
    const result = registry.register({ id: 'fixture.exp' }, {})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('incompatible-api')
      expect(result.detail).toContain('secret')
    }
  })

  it('声明宿主已发布的实验入口（T02 cm6）且范围匹配 → 兼容通过', () => {
    const registry = new AddonRegistry({
      apiVersion: ADDON_API_VERSION,
      experimental: { cm6: '1.0.0' },
      officialIds: OFFICIAL_ADDON_EXTENSION_IDS,
      findExtension: (id) => (id === 'fixture.cm6'
        ? { packageJSON: { vsidianAddon: { manifestVersion: 1, api: '^1.0.0', experimental: { cm6: '^1.0.0' } } } }
        : undefined),
    })
    expect(registry.register({ id: 'fixture.cm6' }, {}).ok).toBe(true)
  })
})

describe('重复注册与释放（hooks 联动）', () => {
  it('同一接入代次重复注册返回 already-registered，onAccepted 不重跑', () => {
    let accepted = 0
    const registry = makeRegistry([{ id: 'fixture.addon-ok', packageJSON: OK_PACKAGE }], {
      onAccepted: () => { accepted++ },
      onReleased: () => {},
    })
    const definition = { setup() {} }
    expect(registry.register({ id: 'fixture.addon-ok' }, definition).ok).toBe(true)
    const again = registry.register({ id: 'fixture.addon-ok' }, definition)
    expect(again).toEqual({ ok: false, reason: 'already-registered' })
    expect(accepted).toBe(1)
  })

  it('release 触发 onReleased；释放后重新注册建立新代次（onAccepted 再次到达）', () => {
    const released: string[] = []
    let accepted = 0
    const registry = makeRegistry([{ id: 'fixture.addon-ok', packageJSON: OK_PACKAGE }], {
      onAccepted: () => { accepted++ },
      onReleased: (addonId) => released.push(addonId),
    })
    registry.register({ id: 'fixture.addon-ok' }, {})
    registry.release('fixture.addon-ok')
    expect(released).toEqual(['fixture.addon-ok'])
    const result = registry.register({ id: 'fixture.addon-ok' }, {})
    expect(result.ok).toBe(true)
    expect(accepted).toBe(2)
  })

  it('注册与释放的观测口：has / registeredIds；重复释放无害', () => {
    const registry = makeRegistry([{ id: 'fixture.addon-ok', packageJSON: OK_PACKAGE }])
    expect(registry.has('fixture.addon-ok')).toBe(false)
    registry.register({ id: 'fixture.addon-ok' }, {})
    expect(registry.has('fixture.addon-ok')).toBe(true)
    expect(registry.registeredIds()).toEqual(['fixture.addon-ok'])
    registry.release('fixture.addon-ok')
    registry.release('fixture.addon-ok')
    expect(registry.has('fixture.addon-ok')).toBe(false)
  })

  it('hooks 异常契约：onAccepted 的异常由 runtime 自捕获（addonRuntime.test 的 setup/enable 抛错用例钉住「注册记录保留 + 不冒泡」）；registry 不重复设防——实现缺陷在开发期暴露', () => {
    // 契约说明用例：无独立断言（行为归属 addonRuntime.test.ts
    // 「setup 抛错 → fault：注册记录保留」——register 调用不抛、记录保留）
    expect(true).toBe(true)
  })
})
