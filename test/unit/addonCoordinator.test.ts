// #350 T01 附加组件发现协调契约：先订阅 extensions.onDidChange 再初始
// 扫描；API 先就绪再唤醒；扫描与变化处理按组件 ID 合并；不等待依赖自己
// 的组件（start 同步返回）；合法声明不兼容不唤醒；激活失败有状态与原因；
// 曾发现后查不到显示 host-unavailable（不删记录、不断言未安装）。
// 规则事实源：docs/design/vsidian-addon-api.md 第 2.2 节、ADR-0012 Q25。
import { describe, expect, it, vi } from 'vitest'
import { AddonCoordinator, type AddonCoordinatorPorts, type AddonExtensionLike } from '../../src/host/addons/addonCoordinator'
import { AddonRegistry } from '../../src/host/addons/addonRegistry'
import { ADDON_API_VERSION, OFFICIAL_ADDON_EXTENSION_IDS } from '../../src/shared/addonIdentity'

interface FakeExtension extends AddonExtensionLike {
  activateImpl?: () => Promise<unknown>
}

function makeFake(extension: Partial<FakeExtension> & { id: string }): FakeExtension {
  return {
    label: extension.label ?? extension.id,
    packageJSON: extension.packageJSON ?? {},
    isActive: extension.isActive ?? false,
    activate: extension.activate ?? vi.fn(async () => undefined),
    ...extension,
  }
}

const OK_DECLARATION = { vsidianAddon: { manifestVersion: 1, api: '^1.0.0' } }

interface Harness {
  coordinator: AddonCoordinator
  registry: AddonRegistry
  events: string[]
  setExtensions(extensions: FakeExtension[]): void
  emitChange(): void
  state(): void
}

function makeHarness(initial: FakeExtension[], options?: { ensureSelfDelay?: boolean }): Harness {
  const events: string[] = []
  let extensions = initial
  let changeListener: (() => void) | undefined
  let selfPublishResolve: (() => void) | undefined
  const ensureStarted = options?.ensureSelfDelay
    ? new Promise<void>((resolve) => { selfPublishResolve = resolve })
    : Promise.resolve()
  const ports: AddonCoordinatorPorts = {
    selfExtensionId: 'onegayi.vsidian',
    getAllExtensions: () => { events.push('scan'); return [...extensions] },
    onExtensionsChanged: (listener) => {
      events.push('subscribe')
      changeListener = listener
      return { dispose: () => { changeListener = undefined } }
    },
    ensureSelfApiPublished: () => {
      events.push('ensure-self')
      return ensureStarted
    },
  }
  const registry = new AddonRegistry({
    apiVersion: ADDON_API_VERSION,
    experimental: {},
    officialIds: OFFICIAL_ADDON_EXTENSION_IDS,
    findExtension: (id) => extensions.find((extension) => extension.id === id),
  })
  const coordinator = new AddonCoordinator(ports, registry)
  return {
    coordinator,
    registry,
    events,
    setExtensions(next) { extensions = next },
    emitChange() { changeListener?.() },
    state() {
      // 模拟自身 activate() 完成（API 公布）：解除 ensureSelfApiPublished 的挂起
      selfPublishResolve?.()
    },
  }
}

async function settle(): Promise<void> {
  // 让 fire-and-forget 的扫描链走完（microtask 队列清空）
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('发现协调顺序与等待边界', () => {
  it('先订阅 onDidChange，再等待自身 API 发布，再扫描', async () => {
    const harness = makeHarness([])
    harness.coordinator.start()
    await settle()
    expect(harness.events[0]).toBe('subscribe')
    expect(harness.events[1]).toBe('ensure-self')
    expect(harness.events[2]).toBe('scan')
  })

  it('start 同步返回，不被自身 activate 等待（API 发布挂起时亦然）', async () => {
    const harness = makeHarness([], { ensureSelfDelay: true })
    let returned = false
    harness.coordinator.start()
    returned = true
    expect(returned).toBe(true)
    // API 尚未发布：不扫描、不唤醒
    await settle()
    expect(harness.events).toEqual(['subscribe', 'ensure-self'])
    expect(harness.coordinator.stateEntries()).toEqual([])
    harness.coordinator.dispose()
  })

  it('API 发布完成后自行开始扫描（无需外部再触发）', async () => {
    const harness = makeHarness([], { ensureSelfDelay: true })
    harness.coordinator.start()
    await settle()
    expect(harness.events).not.toContain('scan')
    // 模拟自身 activate 完成（API 公布）
    harness.state()
    await settle()
    expect(harness.events).toContain('scan')
    harness.coordinator.dispose()
  })
})

describe('发现、兼容与唤醒', () => {
  it('普通扩展不入列表；合法兼容组件被唤醒并注册一次', async () => {
    const plain = makeFake({ id: 'vscode.plain', packageJSON: { name: 'plain' }, isActive: true })
    const addon = makeFake({
      id: 'fixture.addon-ok',
      label: 'Sample Add-on',
      packageJSON: { displayName: 'Sample Add-on', ...OK_DECLARATION },
      activate: vi.fn(async () => {
        // 组件代码在激活内调用公开注册入口（原生激活路径）
        void harness.registry.register({ id: 'fixture.addon-ok' }, { setup() {} })
      }),
    })
    const harness = makeHarness([plain, addon])
    harness.coordinator.start()
    await settle()
    const entries = harness.coordinator.stateEntries()
    expect(entries.map((entry) => entry.id)).toEqual(['fixture.addon-ok'])
    expect(entries[0]).toMatchObject({
      label: 'Sample Add-on',
      status: 'registered',
      official: false,
    })
    expect(addon.activate).toHaveBeenCalledTimes(1)
  })

  it('合法声明但不兼容：记录状态与声明范围，不唤醒', async () => {
    const incompatible = makeFake({
      id: 'fixture.future',
      packageJSON: { displayName: 'Future', vsidianAddon: { manifestVersion: 1, api: '^2.0.0' } },
      activate: vi.fn(async () => undefined),
    })
    const harness = makeHarness([incompatible])
    harness.coordinator.start()
    await settle()
    const entries = harness.coordinator.stateEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ id: 'fixture.future', status: 'incompatible', apiRange: '^2.0.0' })
    expect(incompatible.activate).not.toHaveBeenCalled()
  })

  it('声明形状非法：记录 invalid-declaration 与原因', async () => {
    const bad = makeFake({
      id: 'fixture.bad',
      packageJSON: { displayName: 'Bad', vsidianAddon: { manifestVersion: 7 } },
    })
    const harness = makeHarness([bad])
    harness.coordinator.start()
    await settle()
    const entries = harness.coordinator.stateEntries()
    expect(entries[0]).toMatchObject({ id: 'fixture.bad', status: 'invalid-declaration' })
    expect(typeof entries[0].detail).toBe('string')
  })

  it('激活失败：状态 activation-failed 且携带错误摘要', async () => {
    const failing = makeFake({
      id: 'fixture.fail',
      packageJSON: { displayName: 'Fail', ...OK_DECLARATION },
      activate: vi.fn(async () => { throw new Error('addon exploded') }),
    })
    const harness = makeHarness([failing])
    harness.coordinator.start()
    await settle()
    const entries = harness.coordinator.stateEntries()
    expect(entries[0]).toMatchObject({ id: 'fixture.fail', status: 'activation-failed' })
    expect(entries[0].detail).toContain('addon exploded')
  })

  it('激活失败后重复 rescan 不自动重试：状态保持 activation-failed（真宿主实证——1.82.3 中 isActive 表示「已尝试」，失败后仍为 true 且二次 activate() 假成功）', async () => {
    const failing = makeFake({
      id: 'fixture.fail',
      packageJSON: { displayName: 'Fail', ...OK_DECLARATION },
      // 模拟 1.82.3 真实语义：激活被尝试后 isActive 恒 true（即使失败）；
      // 二次 activate() 假成功（resolve 而非重抛）
      activate: vi.fn(async () => { throw new Error('addon exploded') }),
    })
    const harness = makeHarness([failing])
    harness.coordinator.start()
    await settle()
    expect(harness.coordinator.stateEntries()[0]).toMatchObject({ status: 'activation-failed' })
    // 模拟真宿主：激活已尝试，isActive 翻 true（VSCode 不因失败回退该值）
    failing.isActive = true
    await harness.coordinator.rescan()
    expect(failing.activate).toHaveBeenCalledTimes(1)
    expect(harness.coordinator.stateEntries()[0]).toMatchObject({
      id: 'fixture.fail', status: 'activation-failed',
    })
  })

  it('唤醒完成但组件未注册：awaiting-registration（不冒充已注册）', async () => {
    const lazy = makeFake({
      id: 'fixture.lazy',
      packageJSON: { displayName: 'Lazy', ...OK_DECLARATION },
      activate: vi.fn(async () => undefined),
    })
    const harness = makeHarness([lazy])
    harness.coordinator.start()
    await settle()
    expect(harness.coordinator.stateEntries()[0]).toMatchObject({
      id: 'fixture.lazy', status: 'awaiting-registration',
    })
  })

  it('已被 VSCode 原生激活的组件：不重复 activate，等待其注册', async () => {
    const addon = makeFake({
      id: 'fixture.active',
      packageJSON: { displayName: 'Active', ...OK_DECLARATION },
      isActive: true,
      activate: vi.fn(async () => undefined),
    })
    const harness = makeHarness([addon])
    harness.coordinator.start()
    await settle()
    expect(harness.coordinator.stateEntries()[0]).toMatchObject({
      id: 'fixture.active', status: 'awaiting-registration',
    })
    expect(addon.activate).not.toHaveBeenCalled()
  })
})

describe('变化处理与合并', () => {
  it('清单变化风暴按组件 ID 合并：activate 只调用一次', async () => {
    const addon = makeFake({
      id: 'fixture.addon-ok',
      packageJSON: { displayName: 'Sample', ...OK_DECLARATION },
      activate: vi.fn(async () => {
        void harness.registry.register({ id: 'fixture.addon-ok' }, { setup() {} })
      }),
    })
    const harness = makeHarness([addon])
    harness.coordinator.start()
    await settle()
    harness.emitChange()
    harness.emitChange()
    harness.emitChange()
    await settle()
    expect(addon.activate).toHaveBeenCalledTimes(1)
    expect(harness.coordinator.stateEntries()).toHaveLength(1)
    expect(harness.coordinator.stateEntries()[0].status).toBe('registered')
  })

  it('重复 rescan 幂等：已注册组件不再唤醒，接入回调不重跑', async () => {
    // T02 起接入回调经 hooks 桥由 runtime 驱动——这里以注册成功计数钉住
    // 「同一接入代次只接受一次注册」（already-registered 拒绝重跑）
    let acceptCount = 0
    const addon = makeFake({
      id: 'fixture.addon-ok',
      packageJSON: { displayName: 'Sample', ...OK_DECLARATION },
      activate: vi.fn(async () => {
        acceptCount++
        void harness.registry.register({ id: 'fixture.addon-ok' }, {})
      }),
    })
    const harness = makeHarness([addon])
    harness.coordinator.start()
    await settle()
    await harness.coordinator.rescan()
    expect(acceptCount).toBe(1)
    expect(addon.activate).toHaveBeenCalledTimes(1)
    expect(harness.coordinator.stateEntries()[0].status).toBe('registered')
  })

  it('曾发现的组件后续查不到：host-unavailable 保留在列表（不断言未安装）', async () => {
    const addon = makeFake({
      id: 'fixture.gone',
      packageJSON: { displayName: 'Gone', ...OK_DECLARATION },
      activate: vi.fn(async () => undefined),
    })
    const harness = makeHarness([addon])
    harness.coordinator.start()
    await settle()
    expect(harness.coordinator.stateEntries()[0].status).toBe('awaiting-registration')
    // 清单变化后该扩展在当前宿主查不到（禁用/另一宿主等，原因不可判）
    harness.setExtensions([])
    harness.emitChange()
    await settle()
    const entries = harness.coordinator.stateEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ id: 'fixture.gone', status: 'host-unavailable' })
  })

  it('状态变化通知（设置页推送数据源）', async () => {
    const addon = makeFake({
      id: 'fixture.addon-ok',
      packageJSON: { displayName: 'Sample', ...OK_DECLARATION },
      activate: vi.fn(async () => undefined),
    })
    const harness = makeHarness([addon])
    const listener = vi.fn()
    harness.coordinator.onStateChanged(listener)
    harness.coordinator.start()
    await settle()
    expect(listener).toHaveBeenCalled()
  })
})
