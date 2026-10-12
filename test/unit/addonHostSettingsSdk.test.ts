// @vitest-environment jsdom
// #457 附加组件宿主设置读取面——SDK 链路契约测试（experimental.hostSettings）：
// - 注入形态：编辑器页 + env 快照读取器在场时提供；设置页缺省；读取器
//   未注入缺省（对齐 headingFold/syntax 口径）
// - 读取链路：get 的值来自 env 快照读取器（生产实现为 syncController 的
//   设置快照缓存）；快照变化后下次 get 即新值（拉取式——宿主热更广播
//   更新缓存，无需重开面板，也无推送通知）
// - 拒绝分层：白名单外键 invalid-key；卸载后迟到调用 view-disposed
// - 实现为闭包无 this 依赖：解构裸传安全（对齐 viewIdentity 钉法）
import { describe, expect, it, afterEach } from 'vitest'
import {
  ADDON_PAGE_REGISTRY_GLOBAL,
  installAddonPageLoader,
  type AddonPageLoaderHandle,
} from '../../src/webview/addonPageLoader'
import type { VsidianAddonPageSdk, AddonPageRegistration } from '../../src/shared/addonPage'
import type { AddonHostSettingsFacet } from '../../src/shared/addonHostSettingsApi'
import { READING_BREAKS_KEY } from '../../src/shared/settings'
import type { SettingsPayload } from '../../src/shared/settings'

interface Harness {
  handle: AddonPageLoaderHandle
  sdk: () => VsidianAddonPageSdk | undefined
  setSnapshot: (next: SettingsPayload | undefined) => void
}

function mountHarness(options?: { page?: 'editor' | 'settings'; withReader?: boolean }): Harness {
  const page = options?.page ?? 'editor'
  const withReader = options?.withReader ?? true
  const registrations: AddonPageRegistration[] = []
  ;(globalThis as unknown as Record<string, unknown>)[ADDON_PAGE_REGISTRY_GLOBAL] = registrations
  let captured: VsidianAddonPageSdk | undefined
  let snapshot: SettingsPayload | undefined
  const handle = installAddonPageLoader({
    page,
    ...(withReader ? { hostSettingsSnapshot: () => snapshot } : {}),
    send: () => {},
    loadScript: () => Promise.resolve({ ok: true }),
    loadCss: () => Promise.resolve('denied'),
    now: () => 1_000,
    scheduleTimeout: (callback) => ({ cancel: () => void callback() }),
  })
  registrations.push({ addonId: 'pub.host-settings-addon', factory: (sdk) => { captured = sdk }, registeredAt: 1_000 })
  return {
    handle,
    sdk: () => captured,
    setSnapshot: (next) => { snapshot = next },
  }
}

afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>)[ADDON_PAGE_REGISTRY_GLOBAL]
})

async function load(h: Harness, page: 'editor' | 'settings' = 'editor'): Promise<void> {
  await h.handle.load({ addonId: 'pub.host-settings-addon', generation: 1, page, scriptUri: 'https://x/a.js' })
}

const facetOf = (h: Harness): AddonHostSettingsFacet => h.sdk()!.experimental.hostSettings!

describe('experimental.hostSettings 注入形态', () => {
  it('编辑器页 + 快照读取器在场：提供读取面', async () => {
    const h = mountHarness()
    await load(h)
    expect(h.sdk()!.experimental.hostSettings).toBeDefined()
  })

  it('设置页缺省；编辑器页但读取器未注入也缺省（不提供半接线面）', async () => {
    const settingsH = mountHarness({ page: 'settings' })
    await load(settingsH, 'settings')
    expect(settingsH.sdk()!.experimental.hostSettings).toBeUndefined()

    const noReaderH = mountHarness({ page: 'editor', withReader: false })
    await load(noReaderH)
    expect(noReaderH.sdk()!.experimental.hostSettings).toBeUndefined()
  })
})

describe('读取链路（拉取式快照）', () => {
  it('快照未达回默认值 false；快照携带 true 时返回 true（与宿主快照同源）', async () => {
    const h = mountHarness()
    await load(h)
    const facet = facetOf(h)
    expect(facet.get(READING_BREAKS_KEY)).toEqual({ ok: true, value: false })
    h.setSnapshot({ [READING_BREAKS_KEY]: true })
    expect(facet.get(READING_BREAKS_KEY)).toEqual({ ok: true, value: true })
    h.setSnapshot({ [READING_BREAKS_KEY]: false })
    expect(facet.get(READING_BREAKS_KEY)).toEqual({ ok: true, value: false })
  })

  it('快照热更（模拟 settings.changed 后缓存更新）：下次 get 即新值，无需重开面板', async () => {
    const h = mountHarness()
    await load(h)
    const facet = facetOf(h)
    expect(facet.get(READING_BREAKS_KEY)).toEqual({ ok: true, value: false })
    // 宿主广播 settings.changed → syncController.settings 更新 → 同一
    // facet 下次读取拿到新值（拉取式跟随，无推送通知）
    h.setSnapshot({ [READING_BREAKS_KEY]: true })
    expect(facet.get(READING_BREAKS_KEY)).toEqual({ ok: true, value: true })
  })

  it('白名单外键 invalid-key 拒绝（读取范围收敛，不静默 undefined）', async () => {
    const h = mountHarness()
    await load(h)
    // 运行时守卫：JS 组件传入任意字符串
    expect(facetOf(h).get('editor.fontSize' as never)).toEqual({ ok: false, reason: 'invalid-key' })
  })

  it('卸载后迟到调用拒绝 view-disposed（僵尸读取不落宿主状态）', async () => {
    const h = mountHarness()
    await load(h)
    const facet = facetOf(h)
    await h.handle.unload('pub.host-settings-addon', 1)
    expect(facet.get(READING_BREAKS_KEY)).toEqual({ ok: false, reason: 'view-disposed' })
  })

  it('闭包实现无 this 依赖：解构裸传安全（对齐 viewIdentity 钉法）', async () => {
    const h = mountHarness()
    await load(h)
    const { get } = facetOf(h)
    h.setSnapshot({ [READING_BREAKS_KEY]: true })
    expect(get(READING_BREAKS_KEY)).toEqual({ ok: true, value: true })
  })
})
