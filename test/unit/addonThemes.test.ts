// #546 T07 统一组件主题——目录校验、稳定身份、唯一选择与回落、首选
// 解析与页面明暗四态的纯逻辑单测（TDD 先立预期）。规则来源：
// docs/specs/addon-themes.md §3（宿主目录/唯一选择）与 §4（页面明暗四
// 态）；ADR-0017（安装只新增候选、唯一互斥、回落保留首选）。
// #535 T08：旧预设已退役——旧键回显分支删除、不做激活迁移（旧键写入
// 拒绝断言见 settingsService.test.ts）；本文件钉退役后的解析口径。v1.1.0
// 已发行的
// 公开符号（CODEX_THEME_ID 常量、resolveThemePreferred 双参形状）按
// PR #581 评审发现 3 恢复兼容形状并标 @deprecated，由本文件钉住。
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
import { APPEARANCE_THEME_DEFAULT, APPEARANCE_THEME_KEY, appearanceThemePatch } from '../../src/shared/settings'

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

  it('default（内置）恒可用且生效；退役预设身份走目录不命中（保留首选、回落显示）', () => {
    expect(resolveActiveTheme({ themes, preferred: DEFAULT_THEME_ID, isThemeAvailable: () => true }))
      .toEqual({ preferred: DEFAULT_THEME_ID, available: true, effective: DEFAULT_THEME_ID })
    // #535 T08：退役预设不再是内置身份——目录不命中即回落 default 且保留首选
    const retired = resolveActiveTheme({ themes, preferred: 'retired-preset', isThemeAvailable: () => true })
    expect(retired.available).toBe(false)
    expect(retired.effective).toBe(DEFAULT_THEME_ID)
    expect(retired.preferred).toBe('retired-preset')
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

// ---- 首选解析（新键权威；#535 后旧键不再参与） ----

describe('resolveThemePreferred（新键权威、空值兜底 default）', () => {
  it('组件主题身份原样生效', () => {
    expect(resolveThemePreferred('pub.two/aqua')).toBe('pub.two/aqua')
  })

  it('新键 default / 缺失 / 空串：default（迁移后旧键退役值已在激活时回落，不再回显）', () => {
    expect(resolveThemePreferred(APPEARANCE_THEME_DEFAULT)).toBe(DEFAULT_THEME_ID)
    expect(resolveThemePreferred(undefined)).toBe(DEFAULT_THEME_ID)
    expect(resolveThemePreferred('')).toBe(DEFAULT_THEME_ID)
    expect(resolveThemePreferred('  ')).toBe(DEFAULT_THEME_ID)
  })

  it('v1.1.0 双参调用形状兼容：legacyMermaidValue 传任何值（含退役值）都不再影响结果', () => {
    // PR #581 评审发现 3：第二参保留为 deprecated 兼容形状——旧消费者
    // 双参调用编译通过且语义收窄为「回落 default」（退役值回显→default
    // 即迁移语义本身），防再收窄由本断言与 addonApiSurface 钉住
    expect(resolveThemePreferred(APPEARANCE_THEME_DEFAULT, 'retired-preset')).toBe(DEFAULT_THEME_ID)
    expect(resolveThemePreferred(undefined, 'retired-preset')).toBe(DEFAULT_THEME_ID)
    expect(resolveThemePreferred('', 'default')).toBe(DEFAULT_THEME_ID)
    expect(resolveThemePreferred('pub.two/aqua', 'retired-preset')).toBe('pub.two/aqua')
  })
})

describe('CODEX_THEME_ID（v1.1.0 兼容常量，deprecated）', () => {
  it('值恒为历史字面量（不再是内置身份，仅兼容保留）', () => {
    expect(CODEX_THEME_ID).toBe('codex')
    // 作为未知首选走目录不命中回落（resolveActiveTheme 既有语义）
    const selection = resolveActiveTheme({
      themes: [],
      preferred: CODEX_THEME_ID,
      isThemeAvailable: () => true,
    })
    expect(selection.available).toBe(false)
    expect(selection.effective).toBe(DEFAULT_THEME_ID)
    expect(selection.preferred).toBe('codex')
  })
})

describe('appearanceThemePatch（单键写入——旧 Mermaid 键定义已随 #535 删除）', () => {
  it('只写新键完整身份（组件主题与 default 同形）', () => {
    expect(appearanceThemePatch('pub.two/aqua')).toEqual({
      [APPEARANCE_THEME_KEY]: 'pub.two/aqua',
    })
    expect(appearanceThemePatch('default')).toEqual({
      [APPEARANCE_THEME_KEY]: 'default',
    })
    // 旧键不再出现在补丁（写旧键会被定义校验拒绝）
    expect(appearanceThemePatch('default')).not.toHaveProperty('appearance.mermaidTheme')
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
