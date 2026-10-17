// #546 T07 设置页「主题」页签体契约：选项构建（内置 + 目录 + 多语言名 +
// 来源）、单选写入、不可用呈现与回落提示、目录对账重渲染
//（jsdom；断言落在用户可见层——radio 选中/禁用状态与文案，非纯 DOM 存在）。
// #535 T08：内置 Codex 单选项已随内核退役删除，写入退化为单键（新键）。
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import { AddonThemesStore, ThemeSelectionSection, themeOptionsOf } from '../../src/webview/themeSettings'
import { APPEARANCE_THEME_KEY } from '../../src/shared/settings'

beforeEach(() => {
  installLocale('zh-cn', zhCn)
})

function statePayload(overrides: Partial<Parameters<AddonThemesStore['applyThemesState']>[0]> = {}) {
  return {
    kind: 'addons.themesState' as const,
    version: 1,
    themes: [
      {
        addonId: 'pub.pack',
        themeId: 'aqua',
        themeRef: 'pub.pack/aqua',
        label: { 'zh-cn': '水青', en: 'Aqua' },
        rendererId: 'aqua-renderer',
        providerId: 'pub.pack/aqua-renderer',
        languages: ['mermaid'],
        available: true,
      },
    ],
    preferred: 'default',
    preferredAvailable: true,
    ...overrides,
  }
}

describe('themeOptionsOf（选项构建）', () => {
  it('无目录时仅内置 default 一项（来源标「内置」——#535 后 Codex 已退役）', () => {
    const options = themeOptionsOf(null, () => undefined, 'zh-cn')
    expect(options.map((o) => o.value)).toEqual(['default'])
    expect(options[0]!.title).toBe(zhCn['setting.theme.defaultOption'])
    expect(options.every((o) => o.source === zhCn['appearance.theme.sourceBuiltin'])).toBe(true)
  })

  it('目录主题按 themeRef 稳定序追加，显示名按页面语言解析、来源取组件显示名', () => {
    const store = new AddonThemesStore()
    store.applyAddonLabels([{ id: 'pub.pack', label: '主题包' }])
    const state = statePayload({
      themes: [
        { ...statePayload().themes[0]!, themeId: 'zeta', themeRef: 'pub.pack/zeta', label: { en: 'Zeta' } },
        statePayload().themes[0]!,
      ],
    })
    const options = themeOptionsOf(state, (id) => store.addonLabelOf(id), 'zh-cn')
    expect(options.map((o) => o.value)).toEqual(['default', 'pub.pack/aqua', 'pub.pack/zeta'])
    expect(options[1]!.title).toBe('水青')
    expect(options[1]!.source).toBe('主题包')
    expect(options[2]!.title).toBe('Zeta')
  })

  it('不可用主题标记 unavailable', () => {
    const state = statePayload({ themes: [{ ...statePayload().themes[0]!, available: false }] })
    const options = themeOptionsOf(state, () => undefined, 'zh-cn')
    expect(options[1]!.unavailable).toBe(true)
  })

  it('目录回收后仍保留不可用首选作为单选回显', () => {
    const options = themeOptionsOf(statePayload({ themes: [], preferred: 'pub.gone/aqua', preferredAvailable: false }), () => undefined, 'zh-cn')
    expect(options.at(-1)).toEqual({ value: 'pub.gone/aqua', title: 'pub.gone/aqua', source: 'pub.gone', unavailable: true })
  })
})

describe('ThemeSelectionSection（单选页签体）', () => {
  function makeSection() {
    const store = new AddonThemesStore()
    const sent: unknown[] = []
    const section = new ThemeSelectionSection(store, { postMessage: (m) => sent.push(m) })
    return { store, section, sent }
  }

  it('mount 渲染内置 default + 目录主题，preferred 项 checked', () => {
    const { store, section } = makeSection()
    store.applyThemesState(statePayload({ preferred: 'pub.pack/aqua' }))
    const parent = document.createElement('div')
    section.mount(parent)
    const radios = [...parent.querySelectorAll<HTMLInputElement>('input[type=radio]')]
    expect(radios.map((r) => r.value)).toEqual(['default', 'pub.pack/aqua'])
    expect(radios.find((r) => r.value === 'pub.pack/aqua')!.checked).toBe(true)
    expect(radios.find((r) => r.value === 'default')!.checked).toBe(false)
    // 页签体为单选语义（radiogroup）
    expect(parent.querySelector('.vsidian-theme-options')!.getAttribute('role')).toBe('radiogroup')
  })

  it('radio change 发 settings.set 单键补丁（新键完整身份——旧 Mermaid 键已随 #535 退役）', () => {
    const { store, section, sent } = makeSection()
    store.applyThemesState(statePayload())
    const parent = document.createElement('div')
    section.mount(parent)
    // 选内置 default：只写新键
    const def = parent.querySelector<HTMLInputElement>('input[value=default]')!
    def.checked = true
    def.dispatchEvent(new Event('change'))
    expect(sent).toEqual([{ kind: 'settings.set', values: { [APPEARANCE_THEME_KEY]: 'default' } }])
    // 切组件主题：新键完整身份
    const aqua = parent.querySelector<HTMLInputElement>('input[value="pub.pack/aqua"]')!
    aqua.checked = true
    aqua.dispatchEvent(new Event('change'))
    expect(sent[1]).toEqual({
      kind: 'settings.set',
      values: { [APPEARANCE_THEME_KEY]: 'pub.pack/aqua' },
    })
  })

  it('不可用主题 radio 禁用并带「不可用」徽章；首选不可用时显示回落提示', () => {
    const { store, section } = makeSection()
    store.applyThemesState(statePayload({
      themes: [{ ...statePayload().themes[0]!, available: false }],
      preferred: 'pub.pack/aqua',
      preferredAvailable: false,
    }))
    const parent = document.createElement('div')
    section.mount(parent)
    const aqua = parent.querySelector<HTMLInputElement>('input[value="pub.pack/aqua"]')!
    expect(aqua.disabled).toBe(true)
    expect(parent.querySelector('.vsidian-theme-option-unavailable')!.textContent).toBe(zhCn['appearance.theme.unavailable'])
    expect(parent.querySelector('.vsidian-theme-fallback')!.textContent).toBe(zhCn['appearance.theme.fallbackNotice'])
    // 回落态选中仍显示原首选（checked 不静默换主题）
    expect(aqua.checked).toBe(true)
  })

  it('可用首选无回落提示；目录推送对账重渲染（preferred 变化后 checked 跟随）', () => {
    const { store, section } = makeSection()
    store.applyThemesState(statePayload())
    const parent = document.createElement('div')
    section.mount(parent)
    expect(parent.querySelector('.vsidian-theme-fallback')).toBeNull()
    store.applyThemesState(statePayload({ version: 2, preferred: 'pub.pack/aqua' }))
    const aqua = parent.querySelector<HTMLInputElement>('input[value="pub.pack/aqua"]')!
    const def = parent.querySelector<HTMLInputElement>('input[value=default]')!
    expect(aqua.checked).toBe(true)
    expect(def.checked).toBe(false)
  })

  it('组件显示名推送后来源徽章就地更新', () => {
    const { store, section } = makeSection()
    store.applyThemesState(statePayload())
    const parent = document.createElement('div')
    section.mount(parent)
    const badgeOf = () => parent.querySelector('label:has(input[value="pub.pack/aqua"]) .vsidian-theme-option-source')!
    expect(badgeOf().textContent).toBe('pub.pack')
    store.applyAddonLabels([{ id: 'pub.pack', label: '官方主题包' }])
    // 重渲染重建节点——按新节点断言
    expect(badgeOf().textContent).toBe('官方主题包')
  })

  it('store 等值推送不触发重渲染（等值幂等）', () => {
    const { store, section } = makeSection()
    store.applyThemesState(statePayload())
    const parent = document.createElement('div')
    section.mount(parent)
    const before = parent.querySelector('.vsidian-theme-options')!
    store.applyThemesState(statePayload())
    expect(parent.querySelector('.vsidian-theme-options')!).toBe(before)
  })

  it('搜索条目：主题设置入口（appearance.theme 定位键）', () => {
    const { section } = makeSection()
    expect(section.entries).toEqual([
      { id: 'appearance.theme', title: zhCn['setting.theme.title'], description: zhCn['setting.theme.description'] },
    ])
  })
})
