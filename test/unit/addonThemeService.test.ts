// #546 T07 宿主主题目录服务契约：登记校验与批内重复拒绝、按组件整组
// 替换与回收、目录版本稳定性（等值不递增）、主题提供者排除表导出
//（TDD 先立预期）。规则来源：docs/specs/addon-themes.md §3.1/§3.2。
import { describe, expect, it } from 'vitest'
import { AddonThemeService } from '../../src/host/addons/addonThemeService'
import { isAddonThemesStatePayload, themedProviderIdsOf, type AddonThemeDeclaration } from '../../src/shared/addonThemes'
import { selectEffectiveRenderers } from '../../src/shared/addonRenderers'
import { SettingsService, type SettingsStorage } from '../../src/host/settingsService'
import { APPEARANCE_THEME_KEY, appearanceThemePatch, PRODUCTION_SETTING_DEFINITIONS } from '../../src/shared/settings'

function memoryPort(initial: unknown = undefined) {
  return {
    data: initial,
    writes: [] as unknown[],
    read(): unknown { return this.data },
    async write(value: unknown): Promise<boolean> {
      this.data = value
      this.writes.push(value)
      return true
    },
  }
}

function declaration(opts: Partial<AddonThemeDeclaration> = {}): AddonThemeDeclaration {
  return {
    themeId: 'aqua',
    label: { 'zh-cn': '水青', en: 'Aqua' },
    rendererId: 'aqua-renderer',
    languages: ['mermaid'],
    ...opts,
  }
}

describe('登记与校验（普通 API 结果）', () => {
  it('合法声明登记进目录', () => {
    const service = new AddonThemeService({ log: () => {} })
    const result = service.register('pub.pack', [declaration()])
    expect(result.ok).toBe(true)
    expect(service.catalog()).toEqual([
      expect.objectContaining({ addonId: 'pub.pack', themeRef: 'pub.pack/aqua', providerId: 'pub.pack/aqua-renderer' }),
    ])
  })

  it('任一条目形状非法：整批拒绝 invalid-theme，目录不变', () => {
    const service = new AddonThemeService({ log: () => {} })
    const result = service.register('pub.pack', [declaration(), { themeId: 'bad' }])
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toBe('invalid-theme')
    expect(typeof result.dispose).toBe('function')
    expect(service.catalog()).toEqual([])
  })

  it('同批 themeId 重复拒绝；不同主题支持同一语言可登记', () => {
    const service = new AddonThemeService({ log: () => {} })
    const first = service.register('pub.pack', [declaration(), declaration({ rendererId: 'other' })])
    expect(first.ok).toBe(false)
    expect(first.ok === false && first.reason).toBe('duplicate-theme')
    const second = service.register('pub.pack', [
      declaration({ themeId: 'a', rendererId: 'ra' }),
      declaration({ themeId: 'b', rendererId: 'rb' }),
    ])
    expect(second.ok).toBe(true)
  })
})

describe('整组替换、回收与幂等', () => {
  it('未安装主题时空目录载荷仍可经消息桥回显内置首选', () => {
    const service = new AddonThemeService({ log: () => {} })
    expect(isAddonThemesStatePayload({ version: service.version(), themes: service.catalog(), preferred: 'default', preferredAvailable: true })).toBe(true)
  })

  it('旧注册句柄释放不撤销随后替换的目录', () => {
    const service = new AddonThemeService({ log: () => {} })
    const old = service.register('pub.pack', [declaration()])
    service.register('pub.pack', [declaration({ themeId: 'solar' })])
    old.dispose()
    expect(service.catalog().map((theme) => theme.themeId)).toEqual(['solar'])
  })
  it('同组件重复注册整组替换（升级换主题集）；不同组件互不影响', () => {
    const service = new AddonThemeService({ log: () => {} })
    service.register('pub.pack', [declaration()])
    service.register('pub.pack', [declaration({ themeId: 'solar', rendererId: 'solar-renderer', languages: ['plantuml'] })])
    service.register('pub.other', [declaration()])
    const refs = service.catalog().map((t) => t.themeRef).sort()
    expect(refs).toEqual(['pub.other/aqua', 'pub.pack/solar'])
  })

  it('releaseAddon 回收该组件目录；未注册组件回收无副作用', () => {
    const service = new AddonThemeService({ log: () => {} })
    service.register('pub.pack', [declaration()])
    let changes = 0
    service.onChanged(() => {
      changes += 1
    })
    service.releaseAddon('pub.pack')
    service.releaseAddon('pub.pack')
    expect(service.catalog()).toEqual([])
    expect(changes).toBe(1)
  })

  it('等值重复注册不递增版本不通知；内容变化才递增', () => {
    const service = new AddonThemeService({ log: () => {} })
    let changes = 0
    service.onChanged(() => {
      changes += 1
    })
    service.register('pub.pack', [declaration()])
    expect(service.version()).toBe(1)
    expect(changes).toBe(1)
    service.register('pub.pack', [declaration()])
    expect(service.version()).toBe(1)
    expect(changes).toBe(1)
    service.register('pub.pack', [declaration({ label: { en: 'Aqua 2' } })])
    expect(service.version()).toBe(2)
    expect(changes).toBe(2)
  })

  it('登记复制本地化名称：作者改原映射后旧快照不变，再登记广播新名称', () => {
    const service = new AddonThemeService({ log: () => {} })
    const labels = { en: 'A', 'zh-cn': '水青' }
    const theme = declaration({ label: labels })
    const seen: unknown[] = []
    service.onChanged(() => seen.push(service.catalog()[0]?.label))
    service.register('pub.pack', [theme])
    const original = service.catalog()

    labels.en = 'B'
    service.register('pub.pack', [theme])

    expect(original[0]!.label).toEqual({ en: 'A', 'zh-cn': '水青' })
    expect(service.version()).toBe(2)
    expect(seen).toEqual([{ en: 'A', 'zh-cn': '水青' }, { en: 'B', 'zh-cn': '水青' }])
    expect(service.catalog()[0]!.label).toEqual({ en: 'B', 'zh-cn': '水青' })
  })

  it('空数组注册 = 该组件目录整体撤销（等价回收，经通知）', () => {
    const service = new AddonThemeService({ log: () => {} })
    service.register('pub.pack', [declaration()])
    let changes = 0
    service.onChanged(() => {
      changes += 1
    })
    service.register('pub.pack', [])
    expect(service.catalog()).toEqual([])
    expect(changes).toBe(1)
  })

  it('撤销/代次回收保留当前已选主题语言，同身份重登记替换，未知首选不猜语言', () => {
    const service = new AddonThemeService({ log: () => {}, preferred: () => 'pub.pack/aqua' })
    const handle = service.register('pub.pack', [declaration()])
    const original = service.knownLanguages('pub.pack/aqua')
    handle.dispose()
    expect(service.catalog()).toEqual([])
    expect(service.knownLanguages('pub.pack/aqua')).toEqual(['mermaid'])
    service.releaseAddon('pub.pack')
    expect(service.knownLanguages('pub.pack/aqua')).toEqual(['mermaid'])

    service.register('pub.pack', [declaration({ languages: ['plantuml'] })])
    service.register('pub.pack', [])
    expect(service.knownLanguages('pub.pack/aqua')).toEqual(['plantuml'])
    expect(original).toEqual(['mermaid'])
    expect(service.knownLanguages('unknown/theme')).toBeUndefined()
    expect(new AddonThemeService({ log: () => {} }).knownLanguages('pub.pack/aqua')).toBeUndefined()
  })
})

describe('当前首选的 profile 派生语言快照', () => {
  it('真实主题停用后使用同一 profile 重建宿主：未登记主题仍回内置，未声明语言继续普通规则', async () => {
    const profile = new Map<string, unknown>()
    const storage: SettingsStorage = {
      get: <T>(key: string) => profile.get(key) as T | undefined,
      update: async (key, value) => { profile.set(key, value) },
    }
    const firstSettings = new SettingsService(storage, PRODUCTION_SETTING_DEFINITIONS)
    const persistence = {
      read: () => profile.get('theme-languages'),
      write: async (value: unknown) => { profile.set('theme-languages', value); return true },
    }
    const first = new AddonThemeService({
      log: () => {}, persistence,
      preferred: () => firstSettings.getSnapshot()[APPEARANCE_THEME_KEY] as string,
    })
    firstSettings.onChange(() => first.refreshPreferred())
    first.register('pub.pack', [declaration()])
    expect(profile.get('theme-languages')).toBeUndefined()
    await firstSettings.apply(appearanceThemePatch('pub.pack/aqua'))
    first.releaseAddon('pub.pack')

    const reopenedSettings = new SettingsService(storage, PRODUCTION_SETTING_DEFINITIONS)
    const preferred = reopenedSettings.getSnapshot()[APPEARANCE_THEME_KEY] as string
    const reopened = new AddonThemeService({ log: () => {}, persistence, preferred: () => preferred })
    const ordinary = {
      addonId: 'pub.plain', rendererId: 'renderer', providerId: 'pub.plain/renderer', label: 'Plain',
      languages: ['mermaid', 't09draw'], modes: ['live' as const], exportFormats: ['svg' as const],
    }
    const table = selectEffectiveRenderers({
      candidates: [ordinary], isAvailable: () => true, builtinLanguages: ['mermaid'],
      preferred: { mermaid: ordinary.providerId }, batches: { 'pub.plain': 1 },
      theme: { themedProviderIds: reopened.themedProviderIds(), unavailableThemeLanguages: reopened.knownLanguages(preferred) },
    })
    expect(preferred).toBe('pub.pack/aqua')
    expect(reopened.catalog()).toEqual([])
    expect(table.languages.find((entry) => entry.language === 'mermaid')!.effective).toBe('builtin')
    expect(table.languages.find((entry) => entry.language === 't09draw')!.effective).toBe(ordinary.providerId)
    expect(profile.get('theme-languages')).toEqual({ version: 1, themeRef: preferred, languages: ['mermaid'] })
    expect(profile.get('vsidian.settings')).toEqual(appearanceThemePatch(preferred))
  })

  it('只保留有效目录与当前首选快照，切换后丢弃已回收的历史主题语言', () => {
    const persistence = memoryPort()
    let preferred = 'pub.pack/aqua'
    const service = new AddonThemeService({ log: () => {}, persistence, preferred: () => preferred })
    service.register('pub.pack', [declaration()])
    service.register('pub.other', [declaration({ languages: ['plantuml'] })])
    service.releaseAddon('pub.pack')
    expect(service.knownLanguages('pub.pack/aqua')).toEqual(['mermaid'])
    expect(service.knownLanguages('pub.other/aqua')).toEqual(['plantuml'])

    preferred = 'pub.other/aqua'
    service.refreshPreferred()
    expect(service.knownLanguages('pub.pack/aqua')).toBeUndefined()
    service.releaseAddon('pub.other')
    expect(service.knownLanguages('pub.other/aqua')).toEqual(['plantuml'])
    expect(persistence.data).toEqual({ version: 1, themeRef: preferred, languages: ['plantuml'] })

    preferred = 'unknown/theme'
    service.refreshPreferred()
    expect(service.knownLanguages('unknown/theme')).toBeUndefined()
    expect(service.knownLanguages('pub.other/aqua')).toBeUndefined()
    expect(persistence.data).toBeUndefined()
  })

  it('当前首选同身份更新替换持久语言，等值重登记不重复写，内置选择清空派生快照', () => {
    const persistence = memoryPort()
    let preferred = 'pub.pack/aqua'
    const service = new AddonThemeService({ log: () => {}, persistence, preferred: () => preferred })
    service.register('pub.pack', [declaration()])
    service.register('pub.pack', [declaration()])
    expect(persistence.writes).toHaveLength(1)
    service.register('pub.pack', [declaration({ languages: ['plantuml'] })])
    expect(persistence.data).toEqual({ version: 1, themeRef: preferred, languages: ['plantuml'] })
    preferred = 'default'
    service.refreshPreferred()
    expect(persistence.data).toBeUndefined()
    service.releaseAddon('pub.pack')
    expect(service.knownLanguages('pub.pack/aqua')).toBeUndefined()
  })

  it.each([
    null,
    [],
    { version: 2, themeRef: 'pub.pack/aqua', languages: ['mermaid'] },
    { version: 1, themeRef: 'pub.pack/aqua', languages: [] },
    { version: 1, themeRef: 'pub.pack/aqua', languages: [''] },
    { version: 1, themeRef: 'pub.pack/aqua', languages: [1] },
    { version: 1, themeRef: 'pub.pack/aqua', languages: ['x'.repeat(65)] },
    { version: 1, themeRef: 'pub.pack/aqua', languages: Array(9).fill('mermaid') },
    { version: 1, themeRef: 'default', languages: ['mermaid'] },
    { version: 1, themeRef: `pub.pack/${'x'.repeat(65)}`, languages: ['mermaid'] },
    { version: 1, themeRef: `${'x'.repeat(193)}/aqua`, languages: ['mermaid'] },
    { version: 1, themeRef: 'pub.other/aqua', languages: ['mermaid'] },
  ])('非法或与唯一首选不匹配的存储快照不提供语言（%j）', (stored) => {
    const service = new AddonThemeService({
      log: () => {}, preferred: () => 'pub.pack/aqua', persistence: memoryPort(stored),
    })
    expect(service.knownLanguages('pub.pack/aqua')).toBeUndefined()
  })

  it('真正未知的首选没有可信语言，不抑制普通提供者', () => {
    const service = new AddonThemeService({ log: () => {}, preferred: () => 'unknown/theme', persistence: memoryPort() })
    const table = selectEffectiveRenderers({
      candidates: [{
        addonId: 'pub.plain', rendererId: 'r', providerId: 'pub.plain/r', label: 'Plain',
        languages: ['mermaid', 't09draw'], modes: ['live'], exportFormats: ['svg'],
      }],
      isAvailable: () => true, builtinLanguages: ['mermaid'], preferred: {}, batches: { 'pub.plain': 1 },
      theme: { themedProviderIds: service.themedProviderIds(), unavailableThemeLanguages: service.knownLanguages('unknown/theme') },
    })
    expect(table.languages.map((entry) => entry.effective)).toEqual(['pub.plain/r', 'pub.plain/r'])
  })

  it('持久化失败记录日志，不改写权威首选或阻断当前会话的回落', async () => {
    const logs: string[] = []
    const service = new AddonThemeService({
      preferred: () => 'pub.pack/aqua',
      persistence: { read: () => undefined, write: async () => false },
      log: (stage) => logs.push(stage),
    })
    service.register('pub.pack', [declaration()])
    service.releaseAddon('pub.pack')
    await Promise.resolve()
    expect(logs).toEqual(['theme-languages-persist-failed'])
    expect(service.knownLanguages('pub.pack/aqua')).toEqual(['mermaid'])
  })
})

describe('themedProviderIds（渲染选择排除表）', () => {
  it('撤销主题登记不会让页面残留提供者变成普通自动接管；组件代次结束再回收分类', () => {
    const service = new AddonThemeService({ log: () => {} })
    const handle = service.register('pub.pack', [declaration()])
    handle.dispose()
    expect(service.catalog()).toEqual([])
    expect([...service.themedProviderIds()]).toEqual(['pub.pack/aqua-renderer'])
    service.releaseAddon('pub.pack')
    expect([...service.themedProviderIds()]).toEqual([])
  })
  it('目录全集提供者 ID（多组件合并）', () => {
    const service = new AddonThemeService({ log: () => {} })
    service.register('pub.a', [declaration({ rendererId: 'ra' })])
    service.register('pub.b', [declaration({ themeId: 'solar', rendererId: 'rb' })])
    expect([...service.themedProviderIds()].sort()).toEqual(['pub.a/ra', 'pub.b/rb'])
    // 与纯逻辑同源
    expect([...service.themedProviderIds()].sort()).toEqual([...themedProviderIdsOf(service.catalog())].sort())
    service.releaseAddon('pub.a')
    expect([...service.themedProviderIds()].sort()).toEqual(['pub.b/rb'])
  })
})

describe('注册面句柄（enable 生命周期）', () => {
  it('register 返回 dispose：撤销单次注册的贡献（组件目录整体回收）', () => {
    const service = new AddonThemeService({ log: () => {} })
    const handle = service.register('pub.pack', [declaration()])
    expect(handle.ok).toBe(true)
    handle.dispose()
    expect(service.catalog()).toEqual([])
    // 重复 dispose 无害
    handle.dispose()
    expect(service.catalog()).toEqual([])
  })
})
