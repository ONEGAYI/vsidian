// @vitest-environment jsdom
// #582：生产页面装载器消费平台 i18n 同源快照；覆盖两类页面与装载生命周期。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as i18n from '../../src/shared/i18n'
import { resolveLocale } from '../../src/shared/locales'
import { buildLocaleIslandHtml } from '../../src/shared/locales/island'
import type { AddonPageKind, AddonPageOutbound, AddonPageRegistration, VsidianAddonPageSdk } from '../../src/shared/addonPage'
import {
  ADDON_PAGE_REGISTRY_GLOBAL,
  installAddonPageLoader,
  type AddonPageLoaderHandle,
} from '../../src/webview/addonPageLoader'
import { bootLocaleFromDocument, handleLocaleChangedMessage } from '../../src/webview/localeBoot'

const ADDON_ID = 'test.locale-addon'
const loaders: AddonPageLoaderHandle[] = []

function harness(page: AddonPageKind, installLoader = installAddonPageLoader) {
  const registrations: AddonPageRegistration[] = []
  const sent: AddonPageOutbound[] = []
  Object.assign(globalThis, { [ADDON_PAGE_REGISTRY_GLOBAL]: registrations })
  const loader = installLoader({
    page,
    now: () => 1,
    loadScript: async () => ({ ok: true }),
    send: (message) => sent.push(message),
  })
  loaders.push(loader)
  return {
    loader,
    sent,
    async load(factory: AddonPageRegistration['factory'], generation = 1, addonId = ADDON_ID) {
      let captured!: VsidianAddonPageSdk
      registrations.push({
        addonId,
        registeredAt: 1,
        factory: (sdk) => {
          captured = sdk
          return factory(sdk)
        },
      })
      const outcome = await loader.load({ addonId, generation, page, scriptUri: 'https://page.test/locale.js' })
      return { sdk: captured, outcome }
    },
  }
}

beforeEach(() => {
  i18n.installLocale('en', { 'test.message': 'English' })
})

afterEach(async () => {
  for (const loader of loaders.splice(0)) await loader.disposeAll()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe.each(['editor', 'settings'] as const)('#582 locale：%s 页面', (page) => {
  it.each([
    ['en', 'zh-cn', 'zh-CN', 'en'],
    ['zh-cn', 'en', 'en-US', 'zh-cn'],
    ['auto', 'zh-tw', 'en-US', 'zh-cn'],
    ['auto', 'ja', 'zh-CN', 'en'],
  ])('首帧沿用宿主解析后的数据岛：偏好 %s / 宿主 %s / 浏览器 %s → %s', async (preference, hostLanguage, browserLanguage, expected) => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue(browserLanguage)
    document.body.innerHTML = buildLocaleIslandHtml(resolveLocale(preference, hostLanguage), {})
    expect(bootLocaleFromDocument()).toBe(true)
    const h = harness(page)
    let initial: string | undefined
    const { outcome, sdk } = await h.load((sdk) => { initial = sdk.locale?.get() })
    expect(outcome.ok).toBe(true)
    expect(initial).toBe(expected)
    expect(sdk.locale?.get()).toBe(i18n.currentLocaleLang())
    expect(document.documentElement.lang).toBe(expected)
  })

  it('订阅不回放；只通知语言变化，回调先读到新快照；同语言换包仍刷新内核', async () => {
    const h = harness(page)
    const factory = vi.fn()
    const { sdk } = await h.load(factory)
    const events: Array<[string, string]> = []
    sdk.locale!.onChange((language) => events.push([language, sdk.locale!.get()]))
    const coreListener = vi.fn()
    const offCore = i18n.onLocaleChanged(coreListener)
    try {
      expect(events).toEqual([])
      handleLocaleChangedMessage({ kind: 'locale.changed', lang: 'en', messages: { 'test.message': 'Updated' } })
      expect(i18n.t('test.message')).toBe('Updated')
      expect(events).toEqual([])
      handleLocaleChangedMessage({ kind: 'locale.changed', lang: 'zh-cn', messages: {} })
      handleLocaleChangedMessage({ kind: 'locale.changed', lang: 'zh-cn', messages: {} })
      handleLocaleChangedMessage({ kind: 'locale.changed', lang: 'en', messages: {} })
      expect(events).toEqual([['zh-cn', 'zh-cn'], ['en', 'en']])
      expect(coreListener).toHaveBeenCalledTimes(4)
      expect(factory).toHaveBeenCalledTimes(1)
      expect(h.loader.stats().active).toEqual([{ addonId: ADDON_ID, generation: 1 }])
    } finally {
      offCore()
    }
  })

  it('同一回调的多次订阅各自独立；手动退订幂等且不影响其他订阅', async () => {
    const h = harness(page)
    const { sdk } = await h.load(() => {})
    const listener = vi.fn()
    const offFirst = sdk.locale!.onChange(listener)
    const offSecond = sdk.locale!.onChange(listener)
    i18n.installLocale('zh-cn', {})
    expect(listener).toHaveBeenCalledTimes(2)
    offFirst()
    offFirst()
    i18n.installLocale('en', {})
    expect(listener).toHaveBeenCalledTimes(3)
    offSecond()
    i18n.installLocale('zh-cn', {})
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('卸载前撤下共享监听；释放回调换包也不再通知，迟到订阅不登记', async () => {
    const subscribe = i18n.onLocaleChanged
    const sourceOff = vi.fn()
    const sourceSubscribe = vi.spyOn(i18n, 'onLocaleChanged').mockImplementation((listener) => {
      const off = subscribe(listener)
      return () => { sourceOff(); off() }
    })
    const h = harness(page)
    const listener = vi.fn()
    const { sdk } = await h.load((sdk) => {
      sdk.locale!.onChange(listener)
      sdk.onDispose(() => i18n.installLocale('zh-cn', {}))
    })
    const off = sdk.locale!.onChange(listener)
    off()
    off()
    expect(sourceOff).toHaveBeenCalledTimes(1)
    await h.loader.unload(ADDON_ID, 1)
    expect(sourceOff).toHaveBeenCalledTimes(2)
    expect(listener).not.toHaveBeenCalled()
    const lateOff = sdk.locale!.onChange(listener)
    lateOff()
    expect(sourceSubscribe).toHaveBeenCalledTimes(2)
    i18n.installLocale('en', {})
    expect(listener).not.toHaveBeenCalled()
    expect(sdk.locale!.get()).toBe('en')
  })

  it('换代清理旧订阅；旧句柄不能复活，旧故障/卸载不能撤掉新代次', async () => {
    const h = harness(page)
    const oldListener = vi.fn()
    const newListener = vi.fn()
    const { sdk: oldSdk } = await h.load((sdk) => { sdk.locale!.onChange(oldListener) })
    const { sdk: newSdk } = await h.load((sdk) => { sdk.locale!.onChange(newListener) }, 2)
    oldSdk.locale!.onChange(oldListener)()
    h.loader.handleDirective({ type: 'addon.fault', addonId: ADDON_ID, generation: 1 })
    expect(await h.loader.unload(ADDON_ID, 1)).toEqual({ ok: false, reason: 'stale-generation' })
    i18n.installLocale('zh-cn', {})
    expect(oldListener).not.toHaveBeenCalled()
    expect(newListener).toHaveBeenCalledExactlyOnceWith('zh-cn')
    expect(newSdk.locale!.get()).toBe('zh-cn')
  })

  it('通知过程中释放本代次会跳过余下订阅，其他组件继续接收', async () => {
    const h = harness(page)
    const afterRelease = vi.fn()
    await h.load((sdk) => {
      sdk.locale!.onChange(() => {
        h.loader.handleDirective({ type: 'addon.fault', addonId: ADDON_ID, generation: 1 })
      })
      sdk.locale!.onChange(afterRelease)
    })
    const other = vi.fn()
    await h.load((sdk) => { sdk.locale!.onChange(other) }, 1, 'test.other-addon')
    i18n.installLocale('zh-cn', {})
    expect(afterRelease).not.toHaveBeenCalled()
    expect(other).toHaveBeenCalledExactlyOnceWith('zh-cn')
    expect(h.loader.stats().active).toEqual([{ addonId: 'test.other-addon', generation: 1 }])
  })

  it.each(['host-fault', 'factory-throw', 'factory-reject', 'dispose-all'] as const)('%s 完整回收订阅，已释放 SDK 迟到注册无效', async (ending) => {
    const h = harness(page)
    const listener = vi.fn()
    const { sdk } = await h.load((sdk) => {
      sdk.locale!.onChange(listener)
      if (ending === 'factory-throw') throw new Error('factory failed')
      if (ending === 'factory-reject') return Promise.reject(new Error('factory rejected'))
    })
    if (ending === 'host-fault') h.loader.handleDirective({ type: 'addon.fault', addonId: ADDON_ID, generation: 1 })
    if (ending === 'dispose-all') await h.loader.disposeAll()
    expect(h.loader.stats().active).toEqual([])
    sdk.locale!.onChange(listener)()
    i18n.installLocale('zh-cn', {})
    expect(listener).not.toHaveBeenCalled()
  })

  it('回调异常归属并按代次去重，内核与其他组件继续收消息；宿主释放后故障订阅回收', async () => {
    const h = harness(page)
    const broken = vi.fn(() => { throw new Error('locale callback failed') })
    await h.load((sdk) => { sdk.locale!.onChange(broken) })
    const healthy = vi.fn()
    await h.load((sdk) => { sdk.locale!.onChange(healthy) }, 1, 'test.healthy-addon')
    const core = vi.fn()
    const offCore = i18n.onLocaleChanged(core)
    try {
      expect(() => handleLocaleChangedMessage({ kind: 'locale.changed', lang: 'zh-cn', messages: {} })).not.toThrow()
      i18n.installLocale('en', {})
      expect(h.sent.filter((message) => message.type === 'addon.faulted')).toEqual([{
        type: 'addon.faulted', addonId: ADDON_ID, generation: 1, page, reason: 'locale: Error: locale callback failed',
      }])
      expect(core).toHaveBeenCalledTimes(2)
      expect(healthy.mock.calls).toEqual([['zh-cn'], ['en']])
      expect(document.documentElement.lang).toBe('zh-cn')
      // 与主题环境一致：只上报，宿主裁决前不在组件回调栈中同步释放。
      expect(h.loader.stats().active).toHaveLength(2)
      await h.loader.unload(ADDON_ID, 1)
      i18n.installLocale('zh-cn', {})
      expect(broken).toHaveBeenCalledTimes(2)
      expect(healthy).toHaveBeenCalledTimes(3)
    } finally {
      offCore()
    }
  })

  it('无法字符串化的回调异常也不阻断其他组件、平台换词或 html lang 更新', async () => {
    document.body.innerHTML = buildLocaleIslandHtml('en', { 'test.message': 'English' })
    expect(bootLocaleFromDocument()).toBe(true)
    const h = harness(page)
    await h.load((sdk) => {
      sdk.locale!.onChange(() => { throw Object.create(null) })
    })
    const healthy = vi.fn()
    await h.load((sdk) => { sdk.locale!.onChange(healthy) }, 1, 'test.healthy-addon')
    const core = vi.fn(() => i18n.t('test.message'))
    const offCore = i18n.onLocaleChanged(core)
    try {
      expect(() => handleLocaleChangedMessage({
        kind: 'locale.changed', lang: 'zh-cn', messages: { 'test.message': '中文' },
      })).not.toThrow()
      expect(document.documentElement.lang).toBe('zh-cn')
      expect(() => handleLocaleChangedMessage({
        kind: 'locale.changed', lang: 'en', messages: { 'test.message': 'English' },
      })).not.toThrow()
      expect(document.documentElement.lang).toBe('en')
      expect(healthy.mock.calls).toEqual([['zh-cn'], ['en']])
      expect(core.mock.results.map((result) => result.value)).toEqual(['中文', 'English'])
      expect(h.sent.filter((message) => message.type === 'addon.faulted')).toEqual([{
        type: 'addon.faulted', addonId: ADDON_ID, generation: 1, page, reason: 'locale: unprintable callback error',
      }])
    } finally {
      offCore()
    }
  })
})

it('#582 缺失/损坏首帧数据岛保留 core 空值，不从浏览器伪造语言；合法消息可恢复', async () => {
  vi.resetModules()
  const freshLoader = await import('../../src/webview/addonPageLoader')
  const freshLocale = await import('../../src/webview/localeBoot')
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(navigator, 'language', 'get').mockReturnValue('zh-CN')
  const h = harness('settings', freshLoader.installAddonPageLoader)
  expect(freshLocale.bootLocaleFromDocument()).toBe(false)
  const { sdk } = await h.load(() => {})
  expect(sdk.locale!.get()).toBe('')
  document.body.innerHTML = '<script type="application/json" id="vsidian-locale">invalid</script>'
  expect(freshLocale.bootLocaleFromDocument()).toBe(false)
  expect(sdk.locale!.get()).toBe('')
  expect(warn).toHaveBeenCalledTimes(2)
  const listener = vi.fn()
  sdk.locale!.onChange(listener)
  freshLocale.handleLocaleChangedMessage({ kind: 'locale.changed', lang: 'en', messages: {} })
  expect(sdk.locale!.get()).toBe('en')
  expect(listener).toHaveBeenCalledExactlyOnceWith('en')
})
