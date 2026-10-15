// #546 T07 统一组件主题——目录校验、稳定身份、唯一选择与回落、首选
// 解析与页面明暗四态的纯逻辑单测（TDD 先立预期）。规则来源：
// docs/specs/addon-themes.md §3（宿主目录/唯一选择/过渡内核）与 §4（页面
// 明暗四态）；ADR-0017（安装只新增候选、唯一互斥、回落保留首选）。
import { describe, expect, it } from 'vitest'
import {
  ADDON_THEME_ID_MAX,
  CODEX_THEME_ID,
  DEFAULT_THEME_ID,
  addonThemeCandidateOf,
  addonThemeEnvironmentEqual,
  addonThemeEnvironmentOf,
  addonThemeRefOf,
  isAddonThemeDeclaration,
  isAddonThemeEnvironmentPayload,
  isAddonThemesStatePayload,
  parseAddonThemeRef,
  resolveActiveTheme,
  resolveThemePreferred,
  themedProviderIdsOf,
  validateAddonThemeBatch,
  type AddonThemeCandidate,
} from '../../src/shared/addonThemes'
import { APPEARANCE_THEME_DEFAULT, APPEARANCE_THEME_KEY, appearanceThemePatch, MERMAID_THEME_KEY } from '../../src/shared/settings'

function declaration(opts: Partial<Parameters<typeof addonThemeCandidateOf>[1]> = {}) {
  return {
    themeId: 'aqua',
    label: { 'zh-cn': '水青', en: 'Aqua' },
    rendererId: 'aqua-renderer',
    languages: ['mermaid'],
    ...opts,
  }
}

function theme(addonId: string, themeId: string, opts: Partial<AddonThemeCandidate> = {}): AddonThemeCandidate {
  return {
    addonId,
    themeId,
    themeRef: `${addonId}/${themeId}`,
    label: { en: themeId },
    rendererId: `${themeId}-renderer`,
    providerId: `${addonId}/${themeId}-renderer`,
    languages: ['mermaid'],
    ...opts,
  }
}

// ---- §3.1 登记与身份 ----

describe('主题声明守卫与稳定身份', () => {
  it('合法声明通过守卫', () => {
    expect(isAddonThemeDeclaration(declaration())).toBe(true)
    expect(isAddonThemeDeclaration({ ...declaration(), label: '纯文本名' })).toBe(true)
  })

  it('themeId 空/超长、label 非法、rendererId 空、语言空集或超长均拒绝', () => {
    expect(isAddonThemeDeclaration({ ...declaration(), themeId: ' ' })).toBe(false)
    expect(isAddonThemeDeclaration({ ...declaration(), themeId: 'x'.repeat(ADDON_THEME_ID_MAX + 1) })).toBe(false)
    expect(isAddonThemeDeclaration({ ...declaration(), label: '' })).toBe(false)
    expect(isAddonThemeDeclaration({ ...declaration(), label: [] })).toBe(false)
    expect(isAddonThemeDeclaration({ ...declaration(), rendererId: '' })).toBe(false)
    expect(isAddonThemeDeclaration({ ...declaration(), languages: [] })).toBe(false)
    expect(isAddonThemeDeclaration({ ...declaration(), languages: ['mermaid', ''] })).toBe(false)
    expect(isAddonThemeDeclaration(null)).toBe(false)
    expect(isAddonThemeDeclaration(42)).toBe(false)
  })

  it('候选注入命名空间：themeRef 与 providerId 由平台组合，不由声明自带', () => {
    const candidate = addonThemeCandidateOf('pub.theme-pack', declaration())
    expect(candidate.themeRef).toBe('pub.theme-pack/aqua')
    expect(candidate.providerId).toBe('pub.theme-pack/aqua-renderer')
    expect(candidate.languages).toEqual(['mermaid'])
    // 借主题登记改写其他组件身份在结构上不可表达：声明无 addonId 字段
    expect('addonId' in declaration()).toBe(false)
  })

  it('themeRef 解析与往返', () => {
    expect(parseAddonThemeRef(addonThemeRefOf('a.b', 'c/d'))).toEqual({ addonId: 'a.b', themeId: 'c/d' })
    expect(parseAddonThemeRef('noseparator')).toBeNull()
    expect(parseAddonThemeRef('/x')).toBeNull()
    expect(parseAddonThemeRef('x/')).toBeNull()
  })
})

describe('批内校验（普通 API 结果）', () => {
  it('合法批次通过', () => {
    expect(
      validateAddonThemeBatch([
        declaration(),
        declaration({ themeId: 'solar', rendererId: 'solar-renderer', languages: ['plantuml'] }),
      ]),
    ).toBe('ok')
  })

  it('任一条目形状非法整批拒绝 invalid-theme', () => {
    expect(validateAddonThemeBatch(null as unknown as readonly unknown[])).toBe('invalid-theme')
    expect(validateAddonThemeBatch([declaration(), { themeId: 'x' }])).toBe('invalid-theme')
    expect(validateAddonThemeBatch(['nope'])).toBe('invalid-theme')
  })

  it('同批 themeId 重复拒绝 duplicate-theme', () => {
    expect(validateAddonThemeBatch([declaration(), declaration()])).toBe('duplicate-theme')
  })

  it('同组件不同主题允许支持同一语言，由唯一首选决定生效项', () => {
    expect(
      validateAddonThemeBatch([
        declaration({ themeId: 'a', rendererId: 'ra', languages: ['mermaid'] }),
        declaration({ themeId: 'b', rendererId: 'rb', languages: ['mermaid'] }),
      ]),
    ).toBe('ok')
    // 同一主题多语言、不同主题不同语言：合法
    expect(
      validateAddonThemeBatch([
        declaration({ themeId: 'a', rendererId: 'ra', languages: ['mermaid', 'plantuml'] }),
        declaration({ themeId: 'b', rendererId: 'rb', languages: ['vega'] }),
      ]),
    ).toBe('ok')
  })
})

// ---- §3.2 唯一选择与回落 ----

describe('resolveActiveTheme（唯一首选与回落）', () => {
  const themes = [
    theme('pub.one', 'aqua'),
    theme('pub.two', 'aqua', { languages: ['mermaid', 'plantuml'] }),
  ]

  it('default / codex（内置）恒可用且生效', () => {
    expect(resolveActiveTheme({ themes, preferred: DEFAULT_THEME_ID, isThemeAvailable: () => true }))
      .toEqual({ preferred: DEFAULT_THEME_ID, available: true, effective: DEFAULT_THEME_ID })
    expect(resolveActiveTheme({ themes, preferred: CODEX_THEME_ID, isThemeAvailable: () => true }))
      .toEqual({ preferred: CODEX_THEME_ID, available: true, effective: CODEX_THEME_ID })
  })

  it('选中组件主题可用时生效并给出关联提供者', () => {
    const result = resolveActiveTheme({
      themes,
      preferred: 'pub.two/aqua',
      isThemeAvailable: (t) => t.addonId === 'pub.two',
    })
    expect(result).toEqual({
      preferred: 'pub.two/aqua',
      available: true,
      effective: 'pub.two/aqua',
      activeProviderId: 'pub.two/aqua-renderer',
      activeLanguages: ['mermaid', 'plantuml'],
    })
  })

  it('选中主题不可用：回落 default 显示、保留首选、标记不可用（不用其他主题顶替）', () => {
    const result = resolveActiveTheme({
      themes,
      preferred: 'pub.two/aqua',
      isThemeAvailable: () => false,
    })
    expect(result).toEqual({
      preferred: 'pub.two/aqua',
      available: false,
      effective: DEFAULT_THEME_ID,
    })
  })

  it('目录不命中（组件卸载/未注册）同样回落并保留首选', () => {
    const result = resolveActiveTheme({
      themes,
      preferred: 'pub.gone/old',
      isThemeAvailable: () => true,
    })
    expect(result.effective).toBe(DEFAULT_THEME_ID)
    expect(result.preferred).toBe('pub.gone/old')
    expect(result.available).toBe(false)
  })
})

describe('themedProviderIdsOf（渲染选择排除表）', () => {
  it('目录全集的提供者 ID 集', () => {
    const ids = themedProviderIdsOf([theme('pub.one', 'aqua'), theme('pub.two', 'aqua')])
    expect([...ids].sort()).toEqual(['pub.one/aqua-renderer', 'pub.two/aqua-renderer'])
    expect(themedProviderIdsOf([]).size).toBe(0)
  })
})

// ---- 首选解析（新键权威 + 旧键过渡回显） ----

describe('resolveThemePreferred（新键权威、旧键过渡回显）', () => {
  it('新键 codex / 组件主题原样生效', () => {
    expect(resolveThemePreferred(CODEX_THEME_ID, 'default')).toBe(CODEX_THEME_ID)
    expect(resolveThemePreferred('pub.two/aqua', 'codex')).toBe('pub.two/aqua')
  })

  it('新键 default 且旧键有效选择 codex：回 codex（升级用户旧值回显，T08 前不迁移）', () => {
    expect(resolveThemePreferred(APPEARANCE_THEME_DEFAULT, 'codex')).toBe(CODEX_THEME_ID)
  })

  it('新键 default 且旧键 default/未设置：default（显式选 default 已把旧键落 default）', () => {
    expect(resolveThemePreferred(APPEARANCE_THEME_DEFAULT, 'default')).toBe(DEFAULT_THEME_ID)
    expect(resolveThemePreferred(undefined, undefined)).toBe(DEFAULT_THEME_ID)
    expect(resolveThemePreferred('', 'default')).toBe(DEFAULT_THEME_ID)
  })
})

describe('appearanceThemePatch（双键同拍写入）', () => {
  it('组件主题身份：新键写完整身份，旧键落 default 投影', () => {
    expect(appearanceThemePatch('pub.two/aqua')).toEqual({
      [APPEARANCE_THEME_KEY]: 'pub.two/aqua',
      [MERMAID_THEME_KEY]: 'default',
    })
  })

  it('codex 与 default 的投影', () => {
    expect(appearanceThemePatch('codex')).toEqual({
      [APPEARANCE_THEME_KEY]: 'codex',
      [MERMAID_THEME_KEY]: 'codex',
    })
    expect(appearanceThemePatch('default')).toEqual({
      [APPEARANCE_THEME_KEY]: 'default',
      [MERMAID_THEME_KEY]: 'default',
    })
  })
})

// ---- §4 页面明暗四态 ----

describe('addonThemeEnvironmentOf（四态投影）', () => {
  it('亮色高对比不误判为暗', () => {
    expect(addonThemeEnvironmentOf('light')).toEqual({ dark: false, highContrast: false })
    expect(addonThemeEnvironmentOf('dark')).toEqual({ dark: true, highContrast: false })
    expect(addonThemeEnvironmentOf('high-contrast')).toEqual({ dark: true, highContrast: true })
    expect(addonThemeEnvironmentOf('high-contrast-light')).toEqual({ dark: false, highContrast: true })
  })

  it('快照相等判据（重复值不广播）', () => {
    expect(addonThemeEnvironmentEqual({ dark: true, highContrast: false }, { dark: true, highContrast: false })).toBe(true)
    expect(addonThemeEnvironmentEqual({ dark: true, highContrast: false }, { dark: true, highContrast: true })).toBe(false)
    expect(addonThemeEnvironmentEqual({ dark: false, highContrast: true }, { dark: true, highContrast: true })).toBe(false)
  })

  it('载荷守卫', () => {
    expect(isAddonThemeEnvironmentPayload({ dark: true, highContrast: false })).toBe(true)
    expect(isAddonThemeEnvironmentPayload({ dark: 'yes', highContrast: false })).toBe(false)
    expect(isAddonThemeEnvironmentPayload(null)).toBe(false)
  })
})

describe('目录状态载荷守卫', () => {
  it('合法载荷通过；缺字段/类型错拒绝', () => {
    const payload = {
      version: 1,
      themes: [{ ...theme('pub.one', 'aqua'), available: true }],
      preferred: 'default',
      preferredAvailable: true,
    }
    expect(isAddonThemesStatePayload(payload)).toBe(true)
    expect(isAddonThemesStatePayload({ ...payload, version: 0 })).toBe(true)
    expect(isAddonThemesStatePayload({ ...payload, version: -1 })).toBe(false)
    expect(isAddonThemesStatePayload({ ...payload, preferred: '' })).toBe(false)
    expect(isAddonThemesStatePayload({ ...payload, themes: [{ ...theme('pub.one', 'aqua') }] })).toBe(false)
    expect(isAddonThemesStatePayload({ ...payload, preferredAvailable: 'yes' })).toBe(false)
  })
})
