// @vitest-environment jsdom
// #353 T04 设置页「附加组件」分页的基础设置区契约测试：双标签作用范围、
// 标量/数组/对象基础控件、来源徽章、「使用用户默认」清除覆盖、保存反馈
// （失败不虚报）、无工作区形态、自定义页入口与挂载区合并。
//
// 断言对象是用户可见文本与控件行为（消息上送形态），不是 DOM 存在性——
// 绘制层断言（颜色/可见性）在浏览器套件 test/browser/addonSettings.mjs。
import { describe, it, expect } from 'vitest'
import { SettingsPageView } from '../../src/webview/settingsPageView'
import { PRODUCTION_SETTING_DEFINITIONS } from '../../src/shared/settings'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import { isHostToWebview, type HostToWebview } from '../../src/shared/protocol'
import { KeybindingSettingsSection } from '../../src/webview/keybindingSettings'
import { CssSnippetSettingsSection } from '../../src/webview/cssSnippetSettings'
import { StyleReferenceSection } from '../../src/webview/styleReferenceSettings'
import { AppearanceSection } from '../../src/webview/appearanceSettings'
import { IndexMaintenanceSection } from '../../src/webview/indexMaintenanceSettings'
import { AddonSection } from '../../src/webview/addonSettingsSection'

installLocale('zh-cn', zhCn)

const ADDON_ID = 'fixture.demo'

function makeView(addonSettingsHost?: HTMLElement): {
  view: SettingsPageView
  sent: unknown[]
  parent: HTMLElement
  dispatch(message: unknown): void
} {
  const sent: unknown[] = []
  const bridge = { postMessage: (m: unknown) => sent.push(m) }
  const addons = new AddonSection(bridge, addonSettingsHost)
  const view = new SettingsPageView(bridge, PRODUCTION_SETTING_DEFINITIONS,
    [
      new KeybindingSettingsSection(bridge),
      new AppearanceSection(new CssSnippetSettingsSection(bridge), new StyleReferenceSection(bridge)),
      new IndexMaintenanceSection(bridge),
      addons,
    ],
    [], [])
  const parent = document.createElement('div')
  view.mount(parent)
  return {
    view, sent, parent,
    dispatch: (message) => {
      view.handleHostMessage(message)
      addons.handleHostMessage(message)
    },
  }
}

function addonsState(entries: Array<Record<string, unknown>>, openSettings?: string | null): HostToWebview {
  const message = {
    kind: 'addons.state',
    apiVersion: '1.0.0',
    draft: true,
    addons: entries,
    openAddonSettingsPage: null,
    ...(openSettings !== undefined ? { openAddonSettings: openSettings } : {}),
  }
  if (!isHostToWebview(message)) throw new Error('addons.state 载荷未通过协议守卫')
  return message
}

const DEFINITIONS = [
  { key: 'flag', title: '开关项', type: 'boolean', default: true },
  { key: 'threshold', title: '阈值', type: 'number', min: 1, max: 100, default: 20 },
  { key: 'mode', title: '模式', type: 'string', enum: ['a', 'b'], default: 'a' },
  { key: 'replacements', title: '替换规则', type: 'array', items: { kind: 'string', maxLength: 10 }, default: ['旧→新'] },
  {
    key: 'limits', title: '对象样例', type: 'object',
    fields: [
      { key: 'name', title: '名称', kind: 'string', maxLength: 10, default: 'demo' },
      { key: 'count', title: '数量', kind: 'number', min: 0, max: 9, default: 3 },
    ],
  },
]

/** 构造 addons.settingsState 载荷（默认全 default 来源） */
function settingsState(options: {
  open?: string | null
  hasWorkspace?: boolean
  values?: Record<string, { effective?: unknown; user?: unknown; workspace?: unknown; source?: string }>
  enabled?: { effective?: boolean; userExplicit?: boolean | null; workspaceExplicit?: boolean | null; source?: string }
  faulted?: boolean
  faultReason?: string
  hasCustomPage?: boolean
  openAddonSettingsPage?: string | null
  notice?: Record<string, unknown>
}): HostToWebview {
  const defaultValueOf = (def: (typeof DEFINITIONS)[number]): unknown => {
    if (def.type === 'object') {
      const composed: Record<string, unknown> = {}
      for (const field of def.fields ?? []) composed[field.key] = field.default
      return composed
    }
    return def.default
  }
  const values: Record<string, { effective: unknown; source: string; user?: unknown; workspace?: unknown }> = {}
  for (const def of DEFINITIONS) {
    const override = options.values?.[def.key]
    values[def.key] = {
      effective: override?.effective ?? defaultValueOf(def),
      source: override?.source ?? 'default',
      ...(override?.user !== undefined ? { user: override.user } : {}),
      ...(override?.workspace !== undefined ? { workspace: override.workspace } : {}),
    }
  }
  const message = {
    kind: 'addons.settingsState',
    apiVersion: '1.0.0',
    draft: true,
    open: options.open ?? ADDON_ID,
    hasWorkspace: options.hasWorkspace ?? true,
    addon: options.open === null ? null : {
      addonId: ADDON_ID,
      label: 'Demo',
      faulted: options.faulted ?? false,
      ...(options.faultReason !== undefined ? { faultReason: options.faultReason } : {}),
      hasCustomPage: options.hasCustomPage ?? false,
      enabled: {
        effective: options.enabled?.effective ?? true,
        userExplicit: options.enabled?.userExplicit ?? null,
        workspaceExplicit: options.enabled?.workspaceExplicit ?? null,
        source: options.enabled?.source ?? 'default',
      },
      definitions: DEFINITIONS,
      values,
    },
    openAddonSettingsPage: options.openAddonSettingsPage ?? null,
    ...(options.notice !== undefined ? { notice: options.notice } : {}),
  }
  if (!isHostToWebview(message)) throw new Error('addons.settingsState 载荷未通过协议守卫')
  return message
}

function openAddonsPage(h: ReturnType<typeof makeView>): void {
  h.view.selectSection('addons')
}

function area(h: ReturnType<typeof makeView>): HTMLElement | null {
  return h.parent.querySelector('.vsidian-addons-settings')
}

function buttons(h: ReturnType<typeof makeView>, text: string): HTMLButtonElement[] {
  return [...h.parent.querySelectorAll('button')].filter((b) => b.textContent === text) as HTMLButtonElement[]
}

describe('T04 设置区：入口与打开', () => {
  it('hasSettingsDefinitions 的组件显示「设置」按钮；点击上送 addons.settingsOpen', () => {
    const h = makeView()
    openAddonsPage(h)
    h.dispatch(addonsState([{ id: ADDON_ID, label: 'Demo', official: false, status: 'registered', enabled: true, hasSettingsDefinitions: true }]))
    const open = buttons(h, '设置')[0]
    expect(open).toBeTruthy()
    open!.click()
    expect(h.sent).toContainEqual({ kind: 'addons.settingsOpen', addonId: ADDON_ID })
  })

  it('无定义且无设置页的组件不显示「设置」按钮', () => {
    const h = makeView()
    openAddonsPage(h)
    h.dispatch(addonsState([{ id: ADDON_ID, label: 'Demo', official: false, status: 'registered', enabled: true }]))
    expect(buttons(h, '设置')).toEqual([])
  })

  it('设置区渲染：标题、双标签、全部定义行（用户可见文本）', () => {
    const h = makeView()
    openAddonsPage(h)
    h.dispatch(addonsState([{ id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true }]))
    h.dispatch(settingsState({}))
    const el = area(h)
    expect(el).toBeTruthy()
    const text = el!.textContent ?? ''
    expect(text).toContain('基础设置：Demo')
    expect(text).toContain('用户默认')
    expect(text).toContain('当前工作区')
    expect(text).toContain('开关项')
    expect(text).toContain('阈值')
    expect(text).toContain('模式')
    expect(text).toContain('替换规则')
    expect(text).toContain('对象样例')
  })

  it('关闭按钮上送 addons.settingsClose；open=null 后设置区消失', () => {
    const h = makeView()
    openAddonsPage(h)
    h.dispatch(addonsState([{ id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true }], ADDON_ID))
    h.dispatch(settingsState({}))
    buttons(h, '关闭基础设置')[0]!.click()
    expect(h.sent).toContainEqual({ kind: 'addons.settingsClose' })
    h.dispatch(settingsState({ open: null }))
    expect(area(h)).toBeNull()
  })
})

describe('T04 设置区：双标签作用范围', () => {
  it('默认用户默认标签选中；切换工作区标签后保存携带 workspace scope', () => {
    const h = makeView()
    openAddonsPage(h)
    h.dispatch(addonsState([{ id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true }], ADDON_ID))
    h.dispatch(settingsState({}))
    const tabs = [...h.parent.querySelectorAll('.vsidian-addons-scope-tab')] as HTMLButtonElement[]
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false'])
    tabs[1]!.click()
    // 工作区标签下修改标量 → scope=workspace
    const numberInput = h.parent.querySelector<HTMLInputElement>('input[data-addon-setting="threshold"]')
    expect(numberInput).toBeTruthy()
    numberInput!.value = '55'
    numberInput!.dispatchEvent(new Event('change', { bubbles: true }))
    expect(h.sent).toContainEqual({ kind: 'addons.settingsUpdate', addonId: ADDON_ID, scope: 'workspace', values: { threshold: 55 } })
  })

  it('无工作区：工作区标签禁用并显示提示（明确结果，不猜测）', () => {
    const h = makeView()
    openAddonsPage(h)
    h.dispatch(addonsState([{ id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true }], ADDON_ID))
    h.dispatch(settingsState({ hasWorkspace: false }))
    const tabs = [...h.parent.querySelectorAll('.vsidian-addons-scope-tab')] as HTMLButtonElement[]
    expect(tabs[0]!.disabled).toBe(false)
    expect(tabs[1]!.disabled).toBe(true)
    expect((area(h)!.textContent ?? '')).toContain('当前无打开的工作区')
  })
})

describe('T04 设置区：标量基础控件', () => {
  it('boolean/number/enum 控件按定义呈现；修改即按批上送（user 层）', () => {
    const h = makeView()
    openAddonsPage(h)
    h.dispatch(addonsState([{ id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true }], ADDON_ID))
    h.dispatch(settingsState({}))
    const checkbox = h.parent.querySelector<HTMLInputElement>('input[data-addon-setting="flag"]')
    expect(checkbox!.type).toBe('checkbox')
    expect(checkbox!.checked).toBe(true)
    checkbox!.checked = false
    checkbox!.dispatchEvent(new Event('change', { bubbles: true }))
    expect(h.sent).toContainEqual({ kind: 'addons.settingsUpdate', addonId: ADDON_ID, scope: 'user', values: { flag: false } })

    const select = h.parent.querySelector<HTMLSelectElement>('select[data-addon-setting="mode"]')
    expect(select).toBeTruthy()
    expect([...select!.options].map((o) => o.value)).toEqual(['a', 'b'])
    select!.value = 'b'
    select!.dispatchEvent(new Event('change', { bubbles: true }))
    expect(h.sent).toContainEqual({ kind: 'addons.settingsUpdate', addonId: ADDON_ID, scope: 'user', values: { mode: 'b' } })

    const numberInput = h.parent.querySelector<HTMLInputElement>('input[data-addon-setting="threshold"]')
    expect(numberInput!.type).toBe('number')
  })

  it('来源徽章按生效来源显示（默认/用户默认/工作区覆盖）', () => {
    const h = makeView()
    openAddonsPage(h)
    h.dispatch(addonsState([{ id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true }], ADDON_ID))
    h.dispatch(settingsState({}))
    expect((area(h)!.textContent ?? '')).toContain('默认')
    h.dispatch(settingsState({ values: { threshold: { source: 'user' } } }))
    expect((area(h)!.textContent ?? '')).toContain('用户默认')
    h.dispatch(settingsState({ values: { threshold: { source: 'workspace' } } }))
    expect((area(h)!.textContent ?? '')).toContain('工作区覆盖')
  })

  it('控件显示当前标签层的值：workspace 标签下显示覆盖值，user 标签显示用户层值', () => {
    const h = makeView()
    openAddonsPage(h)
    h.dispatch(addonsState([{ id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true }], ADDON_ID))
    h.dispatch(settingsState({ values: { threshold: { effective: 77, user: 30, workspace: 77, source: 'workspace' } } }))
    // user 标签（默认）：显示用户层值 30
    expect(h.parent.querySelector<HTMLInputElement>('input[data-addon-setting="threshold"]')!.value).toBe('30')
    // 切到 workspace 标签：显示覆盖值 77
    const tabs = [...h.parent.querySelectorAll('.vsidian-addons-scope-tab')] as HTMLButtonElement[]
    tabs[1]!.click()
    expect(h.parent.querySelector<HTMLInputElement>('input[data-addon-setting="threshold"]')!.value).toBe('77')
  })
})

describe('T04 设置区：数组与对象基础控件（重复项/字段）', () => {
  it('数组重复项控件：行呈现默认项；添加/移除后经保存按钮整批上送', () => {
    const h = makeView()
    openAddonsPage(h)
    h.dispatch(addonsState([{ id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true }], ADDON_ID))
    h.dispatch(settingsState({}))
    const rowInputs = () => [...h.parent.querySelectorAll('input[data-addon-array-item="replacements"]')] as HTMLInputElement[]
    expect(rowInputs().map((input) => input.value)).toEqual(['旧→新'])
    // 添加项并输入
    buttons(h, '添加项')[0]!.click()
    expect(rowInputs()).toHaveLength(2)
    rowInputs()[1]!.value = '甲→乙'
    rowInputs()[1]!.dispatchEvent(new Event('input', { bubbles: true }))
    buttons(h, '保存')[0]!.click()
    expect(h.sent).toContainEqual({ kind: 'addons.settingsUpdate', addonId: ADDON_ID, scope: 'user', values: { replacements: ['旧→新', '甲→乙'] } })
  })

  it('对象字段控件：字段行呈现默认值；修改后经保存按钮整批上送', () => {
    const h = makeView()
    openAddonsPage(h)
    h.dispatch(addonsState([{ id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true }], ADDON_ID))
    h.dispatch(settingsState({}))
    const nameInput = h.parent.querySelector<HTMLInputElement>('input[data-addon-field="limits.name"]')
    const countInput = h.parent.querySelector<HTMLInputElement>('input[data-addon-field="limits.count"]')
    expect(nameInput!.value).toBe('demo')
    expect(countInput!.value).toBe('3')
    nameInput!.value = '甲'
    nameInput!.dispatchEvent(new Event('input', { bubbles: true }))
    countInput!.value = '7'
    countInput!.dispatchEvent(new Event('input', { bubbles: true }))
    buttons(h, '保存')[1]!.click()
    expect(h.sent).toContainEqual({ kind: 'addons.settingsUpdate', addonId: ADDON_ID, scope: 'user', values: { limits: { name: '甲', count: 7 } } })
  })
})

describe('T04 设置区：使用用户默认（清除覆盖）', () => {
  it('workspace 标签下已覆盖项显示「使用用户默认」；点击上送 settingsClearOverride', () => {
    const h = makeView()
    openAddonsPage(h)
    h.dispatch(addonsState([{ id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true }], ADDON_ID))
    h.dispatch(settingsState({ values: { threshold: { workspace: 77, source: 'workspace' } } }))
    // user 标签下无清除按钮（覆盖只在工作区标签呈现）
    expect(buttons(h, '使用用户默认')).toEqual([])
    const tabs = [...h.parent.querySelectorAll('.vsidian-addons-scope-tab')] as HTMLButtonElement[]
    tabs[1]!.click()
    const clear = buttons(h, '使用用户默认').find((button) => button.dataset.addonSettingKey === 'threshold')
    expect(clear).toBeTruthy()
    clear!.click()
    expect(h.sent).toContainEqual({ kind: 'addons.settingsClearOverride', addonId: ADDON_ID, key: 'threshold' })
  })

  it('功能开关的工作区覆盖同样可清除（clearEnabledOverride）', () => {
    const h = makeView()
    openAddonsPage(h)
    h.dispatch(addonsState([{ id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true }], ADDON_ID))
    h.dispatch(settingsState({ enabled: { effective: false, userExplicit: false, workspaceExplicit: true, source: 'workspace' } }))
    const tabs = [...h.parent.querySelectorAll('.vsidian-addons-scope-tab')] as HTMLButtonElement[]
    tabs[1]!.click()
    const clear = buttons(h, '使用用户默认').find((button) => button.dataset.addonSettingKey === '__enabled__')
    expect(clear).toBeTruthy()
    clear!.click()
    expect(h.sent).toContainEqual({ kind: 'addons.clearEnabledOverride', addonId: ADDON_ID })
  })

  it('功能开关随当前标签写入对应层', () => {
    const h = makeView()
    openAddonsPage(h)
    h.dispatch(addonsState([{ id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true }], ADDON_ID))
    h.dispatch(settingsState({}))
    const toggle = h.parent.querySelector<HTMLInputElement>('input[data-addon-setting="__enabled__"]')
    expect(toggle).toBeTruthy()
    toggle!.checked = false
    toggle!.dispatchEvent(new Event('change', { bubbles: true }))
    expect(h.sent).toContainEqual({ kind: 'addons.setEnabled', addonId: ADDON_ID, enabled: false, scope: 'user' })
    // 工作区标签下切换 → scope=workspace
    const tabs = [...h.parent.querySelectorAll('.vsidian-addons-scope-tab')] as HTMLButtonElement[]
    tabs[1]!.click()
    const workspaceToggle = h.parent.querySelector<HTMLInputElement>('input[data-addon-setting="__enabled__"]')!
    workspaceToggle.checked = true
    workspaceToggle.dispatchEvent(new Event('change', { bubbles: true }))
    expect(h.sent).toContainEqual({ kind: 'addons.setEnabled', addonId: ADDON_ID, enabled: true, scope: 'workspace' })
  })
})

describe('T04 设置区：保存反馈（失败不虚报）', () => {
  it('notice saved 显示已保存；save-failed 显示原因（值不合法/未知项）', () => {
    const h = makeView()
    openAddonsPage(h)
    h.dispatch(addonsState([{ id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true }], ADDON_ID))
    h.dispatch(settingsState({ notice: { kind: 'saved', scope: 'user', keys: ['threshold'] } }))
    expect((area(h)!.textContent ?? '')).toContain('已保存')
    h.dispatch(settingsState({ notice: { kind: 'save-failed', reason: 'invalid-value', keys: ['threshold'], scope: 'user' } }))
    const text = area(h)!.textContent ?? ''
    expect(text).toContain('保存失败')
    expect(text).toContain('值不合法')
    h.dispatch(settingsState({ notice: { kind: 'save-failed', reason: 'unknown-key', keys: ['mystery'] } }))
    expect((area(h)!.textContent ?? '')).toContain('未知设置项')
  })

  it('常规状态推送（无 notice）清空提示——不残留旧结局', () => {
    const h = makeView()
    openAddonsPage(h)
    h.dispatch(addonsState([{ id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true }], ADDON_ID))
    h.dispatch(settingsState({ notice: { kind: 'saved', scope: 'user' } }))
    expect((area(h)!.textContent ?? '')).toContain('已保存')
    h.dispatch(settingsState({}))
    expect((area(h)!.textContent ?? '')).not.toContain('已保存')
  })
})

describe('T04 设置区：故障态与自定义页', () => {
  it('故障暂停：显示原因与基础配置提示；自定义页入口消失；控件仍可用', () => {
    const h = makeView()
    openAddonsPage(h)
    h.dispatch(addonsState([{ id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true }], ADDON_ID))
    h.dispatch(settingsState({ faulted: true, faultReason: 'enable 异常：boom', hasCustomPage: false }))
    const text = area(h)!.textContent ?? ''
    expect(text).toContain('故障暂停')
    expect(text).toContain('enable 异常：boom')
    expect(buttons(h, '打开自定义设置页')).toEqual([])
    // 控件在场：平台基础控件保留（修正参数入口）
    expect(h.parent.querySelector('input[data-addon-setting="threshold"]')).toBeTruthy()
  })

  it('hasCustomPage：入口按钮上送 openAddonPage；挂载区并入设置区', () => {
    const host = document.createElement('div')
    const mounted = document.createElement('span')
    mounted.textContent = '组件自定义内容'
    host.appendChild(mounted)
    const h = makeView(host)
    openAddonsPage(h)
    h.dispatch(addonsState([
      { id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true, hasSettingsPage: true },
    ], ADDON_ID))
    h.dispatch(settingsState({ hasCustomPage: true }))
    const open = buttons(h, '打开自定义设置页')[0]
    expect(open).toBeTruthy()
    open!.click()
    expect(h.sent).toContainEqual({ kind: 'addons.openAddonPage', addonId: ADDON_ID })
    // 自定义页打开后：挂载区出现在设置区内（host 子树保留），T02 关闭按钮复用
    h.dispatch(settingsState({ hasCustomPage: true, openAddonSettingsPage: ADDON_ID }))
    const wrap = h.parent.querySelector('.vsidian-addons-addonpage')
    expect(wrap).toBeTruthy()
    expect(wrap!.contains(host)).toBe(true)
    expect(wrap!.contains(mounted)).toBe(true)
    const close = [...wrap!.querySelectorAll('button')].find((b) => b.textContent === '关闭组件设置页')
    expect(close).toBeTruthy()
  })
})
