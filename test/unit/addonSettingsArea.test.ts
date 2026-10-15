// @vitest-environment jsdom
// #353 T04「组件设置」独立分页（#465 二轮起自附加组件页迁出）：组件清单
// （hub）与组件详情（基础设置区）两形态、双标签作用范围、标量/数组/对象
// 基础控件、来源徽章、「使用用户默认」清除覆盖、保存反馈（失败不虚报）、
// 无工作区形态、自定义页入口与挂载区、T02 回退挂载与故障排障块。
//
// 断言对象是用户可见文本与控件行为（消息上送形态），不是 DOM 存在性——
// 绘制层断言（颜色/可见性）在浏览器套件 test/browser/addonSettings.mjs。
import { describe, it, expect, vi } from 'vitest'
import { SettingsPageView } from '../../src/webview/settingsPageView'
import { PRODUCTION_SETTING_DEFINITIONS } from '../../src/shared/settings'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import { en } from '../../src/shared/locales/en'
import { isHostToWebview, type HostToWebview } from '../../src/shared/protocol'
import { KeybindingSettingsSection } from '../../src/webview/keybindingSettings'
import { CssSnippetSettingsSection } from '../../src/webview/cssSnippetSettings'
import { StyleReferenceSection } from '../../src/webview/styleReferenceSettings'
import { AppearanceSection } from '../../src/webview/appearanceSettings'
import { AddonThemesStore, ThemeSelectionSection } from '../../src/webview/themeSettings'
import { IndexMaintenanceSection } from '../../src/webview/indexMaintenanceSettings'
import { AddonSection } from '../../src/webview/addonSettingsSection'
import { AddonBehaviorManageSection } from '../../src/webview/addonBehaviorManageSection'
import { AddonSettingsAreaSection, ADDON_SETTINGS_SECTION_ID } from '../../src/webview/addonSettingsAreaSection'
import { AddonSettingsContextRuntime } from '../../src/webview/addonSettingsContext'

installLocale('zh-cn', zhCn)

const ADDON_ID = 'fixture.demo'

function makeView(addonSettingsHost?: HTMLElement, settingsContext?: AddonSettingsContextRuntime): {
  view: SettingsPageView
  settingsArea: AddonSettingsAreaSection
  sent: unknown[]
  parent: HTMLElement
  dispatch(message: unknown): void
  settle(): Promise<void>
} {
  const sent: unknown[] = []
  const bridge = { postMessage: (m: unknown) => sent.push(m) }
  // 与生产 settingsMain 同构（#465 导航回调经微任务延迟——mount 内触发
  // 时不嵌套重渲染）
  let refreshSidebar: () => void = () => {}
  let navigateToAddonSettings: () => void = () => {}
  const addons = new AddonSection(bridge, () => refreshSidebar(), () => navigateToAddonSettings())
  const behaviors = new AddonBehaviorManageSection(bridge)
  // #554 生产接线同形：settingsState 推送（当前组件切换/关闭）→ 侧栏重建
  // #553 设置页上下文 runtime（作用域/定位目标的页面桥——生产 settingsMain 构造注入）
  const settingsArea = new AddonSettingsAreaSection(bridge, addonSettingsHost, () => refreshSidebar(), settingsContext)
  const view = new SettingsPageView(bridge, PRODUCTION_SETTING_DEFINITIONS,
    [
      new KeybindingSettingsSection(bridge),
      new AppearanceSection(new CssSnippetSettingsSection(bridge), new StyleReferenceSection(bridge), new ThemeSelectionSection(new AddonThemesStore(), { postMessage: () => {} })),
      new IndexMaintenanceSection(bridge),
      addons,
      behaviors,
      settingsArea,
    ],
    [], [],
    // #554 生产接线同形：详情分页下侧栏组件条目以本分页权威状态为唯一选中源
    (activeId) => (activeId === ADDON_SETTINGS_SECTION_ID ? settingsArea.currentSidebarEntryId() : undefined))
  refreshSidebar = () => view.refreshSidebar()
  navigateToAddonSettings = () => queueMicrotask(() => view.selectSection(ADDON_SETTINGS_SECTION_ID))
  const parent = document.createElement('div')
  view.mount(parent)
  return {
    view, settingsArea, sent, parent,
    dispatch: (message) => {
      view.handleHostMessage(message)
      addons.handleHostMessage(message)
      behaviors.handleHostMessage(message)
      settingsArea.handleHostMessage(message)
    },
    settle: () => Promise.resolve(),
  }
}

function addonsState(entries: Array<Record<string, unknown>>, openAddonSettingsPage?: string | null): HostToWebview {
  const message = {
    kind: 'addons.state',
    apiVersion: '1.0.0',
    draft: true,
    addons: entries,
    openAddonSettingsPage: null,
    ...(openAddonSettingsPage !== undefined ? { openAddonSettingsPage } : {}),
  }
  if (!isHostToWebview(message)) throw new Error('addons.state 载荷未通过协议守卫')
  return message
}

const DEFINITIONS = [
  { key: 'flag', title: '开关项', type: 'boolean', default: true },
  { key: 'threshold', title: '阈值', type: 'number', min: 1, max: 100, default: 20 },
  { key: 'mode', title: '模式', type: 'string', enum: ['a', 'b'], default: 'a' },
  {
    key: 'strategy', title: '空格策略', type: 'string', enum: ['none', 'soft', 'strict'], default: 'soft',
    // strict 缺失标签：回退渲染枚举值本身（向后兼容语义）
    enumLabels: {
      none: { 'zh-cn': '不要求空格', en: 'No spaces' },
      soft: { 'zh-cn': '软空格', en: 'Soft spaces' },
    },
  },
  { key: 'note', title: '备注', type: 'string', multiline: true, maxLength: 20, default: '第一行\n第二行' },
  { key: 'replacements', title: '替换规则', type: 'array', items: { kind: 'string', maxLength: 10 }, default: ['旧→新'] },
  {
    key: 'limits', title: '对象样例', type: 'object',
    fields: [
      { key: 'name', title: '名称', kind: 'string', maxLength: 10, default: 'demo' },
      { key: 'count', title: '数量', kind: 'number', min: 0, max: 9, default: 3 },
    ],
  },
]

/** 构造 addons.settingsState 载荷（默认全 default 来源；可注入自定义定义集） */
function settingsState(options: {
  open?: string | null
  addonId?: string
  hasWorkspace?: boolean
  values?: Record<string, { effective?: unknown; user?: unknown; workspace?: unknown; source?: string }>
  enabled?: { effective?: boolean; userExplicit?: boolean | null; workspaceExplicit?: boolean | null; source?: string }
  faulted?: boolean
  faultReason?: string
  hasCustomPage?: boolean
  openAddonSettingsPage?: string | null
  notice?: Record<string, unknown>
  definitions?: Array<Record<string, unknown>>
  groups?: Array<Record<string, unknown>>
}): HostToWebview {
  const definitions = options.definitions ?? DEFINITIONS
  const defaultValueOf = (def: Record<string, unknown>): unknown => {
    if (def.type === 'object') {
      const composed: Record<string, unknown> = {}
      for (const field of (def.fields as Array<Record<string, unknown>>) ?? []) composed[field.key as string] = field.default
      return composed
    }
    return def.default
  }
  const values: Record<string, { effective: unknown; source: string; user?: unknown; workspace?: unknown }> = {}
  for (const def of definitions) {
    const override = options.values?.[def.key as string]
    values[def.key as string] = {
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
    open: options.open ?? options.addonId ?? ADDON_ID,
    hasWorkspace: options.hasWorkspace ?? true,
    addon: options.open === null ? null : {
      addonId: options.addonId ?? ADDON_ID,
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
      definitions,
      ...(options.groups !== undefined ? { groups: options.groups } : {}),
      values,
    },
    openAddonSettingsPage: options.openAddonSettingsPage ?? null,
    ...(options.notice !== undefined ? { notice: options.notice } : {}),
  }
  if (!isHostToWebview(message)) throw new Error('addons.settingsState 载荷未通过协议守卫')
  return message
}

function openSettingsAreaPage(h: ReturnType<typeof makeView>): void {
  h.view.selectSection(ADDON_SETTINGS_SECTION_ID)
}

function area(h: ReturnType<typeof makeView>): HTMLElement | null {
  return h.parent.querySelector('.vsidian-addons-settings')
}

function buttons(h: ReturnType<typeof makeView>, text: string): HTMLButtonElement[] {
  return [...h.parent.querySelectorAll('button')].filter((b) => b.textContent === text) as HTMLButtonElement[]
}

describe('组件设置分页：组件清单（hub）与入口', () => {
  it('hub 呈现可配置组件（有定义或有设置页），点击「设置」上送 settingsOpen', () => {
    const h = makeView()
    openSettingsAreaPage(h)
    h.dispatch(addonsState([
      { id: 'fixture.demo', label: 'Demo', official: false, status: 'registered', enabled: true, hasSettingsDefinitions: true },
      { id: 'a.page', label: 'Page', official: false, status: 'registered', enabled: true, hasSettingsPage: true },
      { id: 'a.plain', label: 'Plain', official: false, status: 'registered', enabled: true },
    ]))
    const hub = h.parent.querySelector('.vsidian-addons-settings-hub')!
    expect(hub).toBeTruthy()
    const text = hub.textContent ?? ''
    expect(text).toContain('可配置的组件')
    expect(text).toContain('Demo')
    expect(text).toContain('Page')
    // 纯运行组件不进清单（无可开设置）
    expect(text).not.toContain('Plain')
    const open = [...hub.querySelectorAll('button')].find((b) => b.textContent === '设置')!
    expect(open).toBeTruthy()
    open.click()
    expect(h.sent).toContainEqual({ kind: 'addons.settingsOpen', addonId: 'fixture.demo' })
  })

  it('无可配置组件时 hub 呈现空态（页面结构在场）', () => {
    const h = makeView()
    openSettingsAreaPage(h)
    h.dispatch(addonsState([
      { id: 'a.plain', label: 'Plain', official: false, status: 'registered', enabled: true },
    ]))
    expect(h.parent.querySelector('.vsidian-addons-settings-hub')).toBeTruthy()
    expect((h.parent.textContent ?? '')).toContain('暂无可配置的附加组件')
  })

  it('官方组件在 hub 带官方徽章', () => {
    const h = makeView()
    openSettingsAreaPage(h)
    h.dispatch(addonsState([
      { id: 'onegayi.core', label: 'Core', official: true, status: 'registered', enabled: true, hasSettingsDefinitions: true },
    ]))
    expect((h.parent.querySelector('.vsidian-addons-settings-hub')?.textContent ?? '')).toContain('Core · 官方')
  })
})

describe('T04 设置区：详情形态', () => {
  it('设置区渲染：标题、双标签、全部定义行（用户可见文本）', () => {
    const h = makeView()
    openSettingsAreaPage(h)
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

  it('「返回组件列表」上送 addons.settingsClose；open=null 后回到 hub 清单', () => {
    const h = makeView()
    openSettingsAreaPage(h)
    h.dispatch(addonsState([{ id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true }]))
    h.dispatch(settingsState({}))
    buttons(h, '返回组件列表')[0]!.click()
    expect(h.sent).toContainEqual({ kind: 'addons.settingsClose' })
    h.dispatch(settingsState({ open: null }))
    expect(area(h)).toBeNull()
    // 回到 hub 清单形态（同页两态切换）
    expect(h.parent.querySelector('.vsidian-addons-settings-hub')).not.toBeNull()
  })
})

describe('T04 设置区：双标签作用范围', () => {
  it('默认用户默认标签选中；切换工作区标签后保存携带 workspace scope', () => {
    const h = makeView()
    openSettingsAreaPage(h)
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
    openSettingsAreaPage(h)
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
    openSettingsAreaPage(h)
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
    openSettingsAreaPage(h)
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
    openSettingsAreaPage(h)
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

describe('#477 设置区视觉呈现：卡片式设置行与开关形态', () => {
  it('布尔定义控件为拨动开关形态（vsidian-settings-checkbox 档位类；语义仍是 checkbox）', () => {
    const h = makeView()
    openSettingsAreaPage(h)
    h.dispatch(addonsState([{ id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true }], ADDON_ID))
    h.dispatch(settingsState({}))
    const checkbox = h.parent.querySelector<HTMLInputElement>('input[data-addon-setting="flag"]')
    expect(checkbox!.type).toBe('checkbox')
    expect(checkbox!.classList.contains('vsidian-settings-checkbox')).toBe(true)
    // 形态不改语义：change 仍按批上送
    checkbox!.checked = false
    checkbox!.dispatchEvent(new Event('change', { bubbles: true }))
    expect(h.sent).toContainEqual({ kind: 'addons.settingsUpdate', addonId: ADDON_ID, scope: 'user', values: { flag: false } })
  })

  it('来源徽章挂标题行、描述独占行（三行挤压修复）；标题保持纯文本', () => {
    const h = makeView()
    openSettingsAreaPage(h)
    h.dispatch(addonsState([{ id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true }], ADDON_ID))
    h.dispatch(settingsState({
      definitions: [
        { key: 'flag', title: '开关项', description: '开关描述文案', type: 'boolean', default: true },
      ],
    }))
    const row = h.parent.querySelector('.vsidian-addons-setting-item')!
    const titleRow = row.querySelector('.vsidian-addons-setting-title-row')!
    expect(titleRow.querySelector('.vsidian-settings-item-title')?.textContent).toBe('开关项')
    expect(titleRow.querySelector('.vsidian-addons-source-badge')?.textContent).toBe(zhCn['addons.sourceDefault'])
    // 描述独占行：不与徽章同容器（徽章不挤占描述行）
    expect(titleRow.querySelector('.vsidian-settings-item-description')).toBeNull()
    expect(row.querySelector('.vsidian-settings-item-description')?.textContent).toBe('开关描述文案')
    // 功能开关行（__enabled__）同结构：徽章挂标题行
    const enabledRow = area(h)!.querySelector('.vsidian-settings-item')!
    const enabledTitleRow = enabledRow.querySelector('.vsidian-addons-setting-title-row')!
    expect(enabledTitleRow.querySelector('.vsidian-settings-item-title')?.textContent).toBe(zhCn['addons.enableSwitchTitle'])
    expect(enabledTitleRow.querySelector('.vsidian-addons-source-badge')).toBeTruthy()
  })

  it('样式契约：定义行归型标准设置行（留白+分隔线+末行无线）、徽章标题行与组间 20px 档位', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync('src/webview/settingsPage.css', 'utf8')
    // 定义行归型 §2.3 标准设置行：行内留白 18px 0 + 行间分隔线（tint 8%）
    expect(css).toMatch(/\.vsidian-addons-setting-item\s*\{[^}]*padding:\s*18px 0/)
    expect(css).toMatch(/\.vsidian-addons-setting-item\s*\{[^}]*border-bottom:\s*1px solid color-mix\(in srgb, var\(--vsidian-settings-tint\) 8%, transparent\)/)
    expect(css).toMatch(/\.vsidian-addons-setting-item:last-child\s*\{[^}]*border-bottom:\s*0/)
    // 徽章标题行容器在场（flex 布局，gap 承接徽章间距）
    expect(css).toMatch(/\.vsidian-addons-setting-title-row\s*\{[^}]*display:\s*flex/)
    // 组间距合成 20px 档位：设置区 flex gap 10px + 组卡 margin 10px 叠加
    expect(css).toMatch(/\.vsidian-addons-settings\s*\{[^}]*gap:\s*10px/)
    expect(css).toMatch(/\.vsidian-addons-settings \.vsidian-settings-group \+ \.vsidian-settings-group\s*\{[^}]*margin-top:\s*10px/)
    // #477 死规则清理：组卡片（block）上不写 gap（ui-patterns §5 已知不一致项随本批移除）
    expect(css).not.toMatch(/\.vsidian-addons-settings \.vsidian-settings-group\s*\{[^}]*gap/)
    // 布尔数组项/对象字段开关不被行内 flex:1 拉伸（审查轮 1 发现 1）：行内
    // input 通用规则（类+元素特异性）高于开关档位类，需显式覆写回 36×20 档
    expect(css).toMatch(/\.vsidian-addons-array-row > input\.vsidian-settings-checkbox,\s*\.vsidian-addons-object-field > input\.vsidian-settings-checkbox\s*\{[^}]*flex:\s*none/)
  })
})

describe('T04 设置区：数组与对象基础控件（重复项/字段）', () => {
  it('数组重复项控件：行呈现默认项；添加/移除后经保存按钮整批上送', () => {
    const h = makeView()
    openSettingsAreaPage(h)
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
    openSettingsAreaPage(h)
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

describe('#473/#475 设置区：枚举档位标签与多行形态', () => {
  const openArea = (): ReturnType<typeof makeView> => {
    const h = makeView()
    openSettingsAreaPage(h)
    h.dispatch(addonsState([{ id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true }]))
    h.dispatch(settingsState({}))
    return h
  }

  /** jsdom 无 DataTransfer 构造：手挂 clipboardData 的 paste 事件 */
  function pasteEvent(text: string): Event {
    const event = new Event('paste', { cancelable: true, bubbles: true })
    ;(event as Event & { clipboardData: { getData: (kind: string) => string } }).clipboardData = {
      getData: () => text,
    }
    return event
  }

  it('枚举下拉显示本地化标签；option value 仍是枚举值；缺失标签回退枚举值本身', () => {
    const h = openArea()
    const select = h.parent.querySelector<HTMLSelectElement>('select[data-addon-setting="strategy"]')
    expect(select).toBeTruthy()
    const options = [...select!.options]
    expect(options.map((option) => option.value)).toEqual(['none', 'soft', 'strict'])
    expect(options.map((option) => option.textContent)).toEqual(['不要求空格', '软空格', 'strict'])
    expect(select!.selectedOptions[0]!.textContent).toBe('软空格')
    // 切换标签后上送枚举原值（标签仅呈现层，持久化值不变）
    select!.value = 'none'
    select!.dispatchEvent(new Event('change', { bubbles: true }))
    expect(h.sent).toContainEqual({ kind: 'addons.settingsUpdate', addonId: ADDON_ID, scope: 'user', values: { strategy: 'none' } })
  })

  it('标签随页面语言切换（zh-cn → en 换包重渲染后显示英文标签，缺失键仍回退）', () => {
    const h = openArea()
    try {
      installLocale('en', en)
      const select = h.parent.querySelector<HTMLSelectElement>('select[data-addon-setting="strategy"]')
      expect([...select!.options].map((option) => option.textContent)).toEqual(['No spaces', 'Soft spaces', 'strict'])
    } finally {
      installLocale('zh-cn', zhCn)
    }
  })

  it('multiline 定义渲染 textarea：当前值含换行呈现；修改后 change 上送含换行的值；maxLength 生效', () => {
    const h = openArea()
    const areaEl = h.parent.querySelector<HTMLTextAreaElement>('textarea[data-addon-setting="note"]')
    expect(areaEl).toBeTruthy()
    expect(areaEl!.value).toBe('第一行\n第二行')
    expect(areaEl!.maxLength).toBe(20)
    areaEl!.value = '甲\n乙\n丙'
    areaEl!.dispatchEvent(new Event('change', { bubbles: true }))
    expect(h.sent).toContainEqual({ kind: 'addons.settingsUpdate', addonId: ADDON_ID, scope: 'user', values: { note: '甲\n乙\n丙' } })
  })

  it('multiline 控件占定义行整行（不进 label 行右槽）；单行控件仍在 label 行', () => {
    const h = openArea()
    const areaEl = h.parent.querySelector<HTMLTextAreaElement>('textarea[data-addon-setting="note"]')!
    const noteItem = areaEl.closest('.vsidian-addons-setting-item')!
    expect(noteItem).toBeTruthy()
    expect(noteItem.querySelector('.vsidian-settings-item-label')!.contains(areaEl)).toBe(false)
    const modeSelect = h.parent.querySelector<HTMLSelectElement>('select[data-addon-setting="mode"]')!
    const modeItem = modeSelect.closest('.vsidian-addons-setting-item')!
    expect(modeItem.querySelector('.vsidian-settings-item-label')!.contains(modeSelect)).toBe(true)
  })

  it('数组批量粘贴拆分：多行剪贴板按行拆分追加（trim、去空行、maxLength 截断）；保存整批上送', () => {
    const h = openArea()
    const rowInputs = () => [...h.parent.querySelectorAll('input[data-addon-array-item="replacements"]')] as HTMLInputElement[]
    expect(rowInputs().map((input) => input.value)).toEqual(['旧→新'])
    rowInputs()[0]!.dispatchEvent(pasteEvent(' 甲 \r\n\r\n乙\n丙\n'))
    // 首行追加到当前项末尾（trim），后续行插入其后；空行丢弃
    expect(rowInputs().map((input) => input.value)).toEqual(['旧→新甲', '乙', '丙'])
    buttons(h, '保存')[0]!.click()
    expect(h.sent).toContainEqual({ kind: 'addons.settingsUpdate', addonId: ADDON_ID, scope: 'user', values: { replacements: ['旧→新甲', '乙', '丙'] } })
  })

  it('单行粘贴不拆分：不拦截默认行为，行数不变', () => {
    const h = openArea()
    const first = h.parent.querySelector<HTMLInputElement>('input[data-addon-array-item="replacements"]')!
    const paste = pasteEvent('单行')
    first.dispatchEvent(paste)
    expect(paste.defaultPrevented).toBe(false)
    expect([...h.parent.querySelectorAll('input[data-addon-array-item="replacements"]')]).toHaveLength(1)
  })

  it('各行超 maxLength 经截断入草稿（对齐浏览器单行粘贴截断语义）', () => {
    const h = openArea()
    const first = h.parent.querySelector<HTMLInputElement>('input[data-addon-array-item="replacements"]')!
    // maxLength=10：第二行 12 字符截为 10
    first.dispatchEvent(pasteEvent('x\n一二三四五六七八九十十二'))
    const rowInputs = [...h.parent.querySelectorAll('input[data-addon-array-item="replacements"]')] as HTMLInputElement[]
    expect(rowInputs.map((input) => input.value)).toEqual(['旧→新x', '一二三四五六七八九十'])
  })

  it('首行拼接结果同样经 maxLength 截断——草稿不持不可保存值（审查 F1）', () => {
    const h = openArea()
    const first = h.parent.querySelector<HTMLInputElement>('input[data-addon-array-item="replacements"]')!
    // 当前项 3 字符 + 首行 9 字符 = 12 > maxLength 10：拼接后截为 10
    first.dispatchEvent(pasteEvent('一二三四五六七八九\n乙'))
    const rowInputs = [...h.parent.querySelectorAll('input[data-addon-array-item="replacements"]')] as HTMLInputElement[]
    expect(rowInputs.map((input) => input.value)).toEqual(['旧→新一二三四五六七', '乙'])
    // 截断后的草稿可整批保存（不触发 save-failed）
    buttons(h, '保存')[0]!.click()
    expect(h.sent).toContainEqual({ kind: 'addons.settingsUpdate', addonId: ADDON_ID, scope: 'user', values: { replacements: ['旧→新一二三四五六七', '乙'] } })
  })

  it('枚举值为原型属性名（toString）时缺失标签回退枚举值本身（审查 F2：hasOwn 不走原型链）', () => {
    const h = makeView()
    openSettingsAreaPage(h)
    h.dispatch(addonsState([{ id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true }]))
    h.dispatch(settingsState({
      definitions: [{
        key: 'protoMode', title: '原型枚举', type: 'string', enum: ['toString', 'safe'], default: 'toString',
        enumLabels: { safe: '安全' },
      }],
    }))
    const select = h.parent.querySelector<HTMLSelectElement>('select[data-addon-setting="protoMode"]')
    expect([...select!.options].map((option) => option.textContent)).toEqual(['toString', '安全'])
  })
})

describe('T04 设置区：使用用户默认（清除覆盖）', () => {
  it('workspace 标签下已覆盖项显示「使用用户默认」；点击上送 settingsClearOverride', () => {
    const h = makeView()
    openSettingsAreaPage(h)
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
    openSettingsAreaPage(h)
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
    openSettingsAreaPage(h)
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
    openSettingsAreaPage(h)
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
    openSettingsAreaPage(h)
    h.dispatch(addonsState([{ id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true }], ADDON_ID))
    h.dispatch(settingsState({ notice: { kind: 'saved', scope: 'user' } }))
    expect((area(h)!.textContent ?? '')).toContain('已保存')
    h.dispatch(settingsState({}))
    expect((area(h)!.textContent ?? '')).not.toContain('已保存')
  })
})

describe('T04 设置区：故障态与自定义页', () => {
  it('故障暂停（无自定义页形态）：显示原因与基础配置提示；控件仍可用', () => {
    const h = makeView()
    openSettingsAreaPage(h)
    h.dispatch(addonsState([{ id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true }], ADDON_ID))
    h.dispatch(settingsState({ faulted: true, faultReason: 'enable 异常：boom', hasCustomPage: false }))
    const text = area(h)!.textContent ?? ''
    expect(text).toContain('故障暂停')
    expect(text).toContain('enable 异常：boom')
    // 控件在场：平台基础控件保留（修正参数入口）
    expect(h.parent.querySelector('input[data-addon-setting="threshold"]')).toBeTruthy()
  })
})

// ---- #351 T02 / #354 T05 / #467：迁自附加组件页的承载类用例（#465 后
//      挂载与排障块只在「组件设置」分页渲染） ----

describe('组件设置分页：T02 回退挂载与故障排障', () => {
  it('openAddonSettingsPage 在场（设置区未开）时挂载区独占详情形态', () => {
    const host = document.createElement('div')
    const mounted = document.createElement('span')
    mounted.textContent = '组件内容'
    host.appendChild(mounted)
    const h = makeView(host)
    openSettingsAreaPage(h)
    h.dispatch(addonsState([
      { id: ADDON_ID, label: 'Demo', official: false, status: 'registered', enabled: true, hasSettingsPage: true },
    ], ADDON_ID))
    const wrap = h.parent.querySelector('.vsidian-addons-addonpage')
    expect(wrap).toBeTruthy()
    expect(wrap!.textContent).toContain('组件设置页：Demo')
    expect(wrap!.contains(host)).toBe(true)
    expect(wrap!.contains(mounted)).toBe(true)
    const close = [...wrap!.querySelectorAll('button')].find((b) => b.textContent === '关闭组件设置页')
    expect(close).toBeTruthy()
    close!.click()
    expect(h.sent).toContainEqual({ kind: 'addons.closeAddonPage' })
  })

  it('状态推送重渲染只移动 host 节点，不清空组件挂载内容', () => {
    const host = document.createElement('div')
    const mounted = document.createElement('span')
    mounted.textContent = '组件内容'
    host.appendChild(mounted)
    const h = makeView(host)
    openSettingsAreaPage(h)
    h.dispatch(addonsState([
      { id: ADDON_ID, label: 'Demo', official: false, status: 'registered', enabled: true, hasSettingsPage: true },
    ], ADDON_ID))
    h.dispatch(addonsState([
      { id: ADDON_ID, label: 'Demo', official: false, status: 'registered', enabled: true, hasSettingsPage: true },
    ], ADDON_ID))
    const wrap = h.parent.querySelector('.vsidian-addons-addonpage')
    expect(wrap).toBeTruthy()
    expect(wrap!.contains(mounted)).toBe(true)
  })

  it('openAddonSettingsPage 终结（null）后挂载区消失，host 移出分页但内容保留', () => {
    const host = document.createElement('div')
    const mounted = document.createElement('span')
    mounted.textContent = '组件内容'
    host.appendChild(mounted)
    const h = makeView(host)
    openSettingsAreaPage(h)
    h.dispatch(addonsState([
      { id: ADDON_ID, label: 'Demo', official: false, status: 'registered', enabled: true, hasSettingsPage: true },
    ], ADDON_ID))
    h.dispatch(addonsState([
      { id: ADDON_ID, label: 'Demo', official: false, status: 'registered', enabled: true, hasSettingsPage: true },
    ], null))
    expect(h.parent.querySelector('.vsidian-addons-addonpage')).toBeNull()
    expect(h.parent.contains(host)).toBe(false)
    expect(host.contains(mounted)).toBe(true)
  })

  it('设置区故障态呈现排障块：标题、提示、原因、日志与重试入口', () => {
    const h = makeView()
    openSettingsAreaPage(h)
    h.dispatch(addonsState([
      { id: 'a.broken', label: 'Broken', official: false, status: 'registered', enabled: true, fault: { reason: 'setup 异常：bad' }, hasSettingsDefinitions: true },
    ]))
    h.dispatch(settingsState({ faulted: true, faultReason: 'setup 异常：bad' }))
    const troubleshoot = h.parent.querySelector('.vsidian-addons-fault-troubleshoot')
    expect(troubleshoot).toBeTruthy()
    const text = troubleshoot!.textContent ?? ''
    expect(text).toContain('组件故障暂停')
    expect(text).toContain('setup 异常：bad')
    const faultButtons = [...troubleshoot!.querySelectorAll('button')].map((b) => b.textContent)
    expect(faultButtons).toContain('查看组件日志')
    expect(faultButtons).toContain('重试组件')
  })
})

describe('组件设置分页：推送重渲染的滚动与焦点保持（#467）', () => {
  it('设置区功能开关变更回推：同键控件重获焦点，主区 scrollTop 保持', () => {
    const h = makeView()
    // jsdom 焦点管理只对挂在 document 上的元素生效（脱离文档 focus 为空操作）
    document.body.append(h.parent)
    try {
      openSettingsAreaPage(h)
      h.dispatch(addonsState([
        { id: 'fixture.demo', label: 'Demo', official: false, status: 'registered', enabled: true, hasSettingsDefinitions: true },
      ]))
      h.dispatch(settingsState({}))
      const main = h.parent.querySelector<HTMLElement>('.vsidian-settings-main')!
      const toggle = h.parent.querySelector<HTMLInputElement>('input[data-addon-setting="__enabled__"]')!
      toggle.focus()
      main.scrollTop = 120
      toggle.click() // change → 上送 addons.setEnabled；宿主权威回显经推送到达
      h.dispatch(settingsState({ enabled: { effective: false, userExplicit: false } }))
      expect(document.activeElement?.getAttribute('data-addon-setting')).toBe('__enabled__')
      expect(main.scrollTop).toBe(120)
    } finally {
      h.parent.remove()
      h.view.dispose()
    }
  })

  it('数组定义行键盘移除：局部重建后焦点回到等价位置的移除按钮（不落 BODY）', () => {
    const h = makeView()
    document.body.append(h.parent)
    try {
      openSettingsAreaPage(h)
      h.dispatch(addonsState([
        { id: 'fixture.demo', label: 'Demo', official: false, status: 'registered', enabled: true, hasSettingsDefinitions: true },
      ]))
      // 数组默认单行不足以验键盘焦点链：注入三行生效值
      h.dispatch(settingsState({ values: { replacements: { effective: ['甲', '乙', '丙'], source: 'default' } } }))
      const rows = h.parent.querySelectorAll('.vsidian-addons-array-row')
      expect(rows.length).toBe(3)
      const removeButtons = h.parent.querySelectorAll<HTMLButtonElement>('.vsidian-addons-array-remove')
      removeButtons[1]!.focus() // 键盘场景：焦点在第二行移除按钮上按 Enter
      removeButtons[1]!.click()
      const afterRows = h.parent.querySelectorAll('.vsidian-addons-array-row')
      expect(afterRows.length).toBe(2)
      // 焦点不丢到 BODY：回到重建后同位置的移除按钮（值序列为 甲/丙）
      expect(document.activeElement?.classList.contains('vsidian-addons-array-remove')).toBe(true)
      expect(document.activeElement?.closest('.vsidian-addons-array-row')?.querySelector('input')?.value).toBe('丙')
    } finally {
      h.parent.remove()
      h.view.dispose()
    }
  })
})

// ---- #472 设置定义分组：呈现、全局搜索与跨组件定位 ----

describe('#472 设置区分组呈现', () => {
  const GROUPS = [
    { key: 'appearance', title: { 'zh-cn': '外观', en: 'Appearance' }, description: { 'zh-cn': '观感相关', en: 'Look and feel' } },
    { key: 'behavior', title: '行为' },
  ]
  const GROUPED_DEFS = [
    { key: 'flag', title: '开关项', type: 'boolean', default: true },
    { key: 'theme', title: '主题', type: 'string', default: 'light', group: 'appearance' },
    { key: 'strict', title: '严格模式', type: 'boolean', default: false, group: 'behavior' },
    { key: 'density', title: '密度', type: 'string', default: 'compact', group: 'appearance' },
    { key: 'legacy', title: '未分组项', type: 'boolean', default: false },
  ]

  function openGrouped(options: { groups?: Array<Record<string, unknown>>; definitions?: Array<Record<string, unknown>> } = {}): ReturnType<typeof makeView> {
    const h = makeView()
    openSettingsAreaPage(h)
    h.dispatch(addonsState([{ id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true }]))
    h.dispatch(settingsState({ definitions: options.definitions ?? GROUPED_DEFS, groups: options.groups }))
    return h
  }

  /** 组容器列表（区域头部不在 .vsidian-settings-group 内，直接取设置区内组卡片） */
  function groupCards(h: ReturnType<typeof makeView>): HTMLElement[] {
    return [...h.parent.querySelectorAll<HTMLElement>('.vsidian-addons-settings > .vsidian-settings-group')]
  }

  it('分组渲染：首容器无组标题且开关行 + 未分组项恒置顶；组容器按声明序、组内聚拢不散插', () => {
    const h = openGrouped({ groups: GROUPS })
    const cards = groupCards(h)
    expect(cards).toHaveLength(3)
    // 首容器：开关行 + 未分组项（flag、legacy 按注册序），无组标题
    expect(cards[0]!.querySelector('.vsidian-settings-group-title')).toBeNull()
    expect(cards[0]!.querySelector('[data-addon-setting="__enabled__"]')).toBeTruthy()
    expect([...cards[0]!.querySelectorAll('.vsidian-addons-setting-item .vsidian-settings-item-title')].map((el) => el.textContent)).toEqual(['开关项', '未分组项'])
    // 组容器按声明序（appearance 先于 behavior），组内定义按注册序聚拢（theme、density 相邻）
    expect([...cards[1]!.querySelectorAll('.vsidian-addons-setting-item .vsidian-settings-item-title')].map((el) => el.textContent)).toEqual(['主题', '密度'])
    expect([...cards[2]!.querySelectorAll('.vsidian-addons-setting-item .vsidian-settings-item-title')].map((el) => el.textContent)).toEqual(['严格模式'])
  })

  it('组标题与组描述按当前语言选值（zh-cn 页面语言取 zh-cn 键；直值原样；无描述不渲染）', () => {
    const h = openGrouped({ groups: GROUPS })
    const cards = groupCards(h)
    expect(cards[1]!.querySelector('.vsidian-settings-group-title')?.textContent).toBe('外观')
    expect(cards[1]!.querySelector('.vsidian-addons-group-description')?.textContent).toBe('观感相关')
    expect(cards[2]!.querySelector('.vsidian-settings-group-title')?.textContent).toBe('行为')
    expect(cards[2]!.querySelector('.vsidian-addons-group-description')).toBeNull()
  })

  it('组文案随页面语言切换（zh-cn → en 换包重渲染后取 en 键）', () => {
    const h = openGrouped({ groups: GROUPS })
    try {
      installLocale('en', en)
      const cards = groupCards(h)
      expect(cards[1]!.querySelector('.vsidian-settings-group-title')?.textContent).toBe('Appearance')
      expect(cards[1]!.querySelector('.vsidian-addons-group-description')?.textContent).toBe('Look and feel')
    } finally {
      installLocale('zh-cn', zhCn)
    }
  })

  it('无组声明保持既有平铺（单容器无组标题、全部定义按注册序）', () => {
    const h = openGrouped()
    const cards = groupCards(h)
    expect(cards).toHaveLength(1)
    expect(cards[0]!.querySelector('.vsidian-settings-group-title')).toBeNull()
    expect(cards[0]!.querySelectorAll('.vsidian-addons-setting-item').length).toBe(GROUPED_DEFS.length)
  })

  it('空组（声明了组但没有定义引用）仍渲染组容器（引用式可声明空组）', () => {
    const h = openGrouped({ groups: [...GROUPS, { key: 'empty', title: '空组' }] })
    const cards = groupCards(h)
    expect(cards).toHaveLength(4)
    expect(cards[3]!.querySelector('.vsidian-settings-group-title')?.textContent).toBe('空组')
    expect(cards[3]!.querySelectorAll('.vsidian-addons-setting-item')).toHaveLength(0)
  })
})

describe('#472 全局搜索：定义级与组级条目（全部已注册组件）', () => {
  const INDEX = {
    definitions: [
      { key: 'theme', title: '主题', description: '配色主题' },
      { key: 'flag', title: '开关项' },
    ],
    groups: [{ key: 'appearance', title: { 'zh-cn': '外观', en: 'Appearance' } }],
  }

  function searchFor(h: ReturnType<typeof makeView>, text: string): HTMLButtonElement[] {
    const search = h.parent.querySelector<HTMLInputElement>('input.vsidian-settings-search')!
    search.value = text
    search.dispatchEvent(new Event('input', { bubbles: true }))
    return [...h.parent.querySelectorAll<HTMLButtonElement>('.vsidian-settings-result')]
  }

  /** 只取「组件设置」分组的搜索命中（全局搜索跨全部分页——宽词命中其他分页属正常） */
  function addonSettingsHits(h: ReturnType<typeof makeView>, text: string): HTMLButtonElement[] {
    return searchFor(h, text).filter((b) => b.querySelector('.vsidian-settings-result-category')?.textContent === zhCn['settings.addonSettingsSection'])
  }

  it('定义 title/description 与组标题进全局搜索，命中归「组件设置」分组', () => {
    const h = makeView()
    h.dispatch(addonsState([
      { id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true, settingsSearchIndex: INDEX },
      { id: 'b.other', label: 'Other', official: false, status: 'registered', hasSettingsDefinitions: false },
    ]))
    const results = addonSettingsHits(h, '主题')
    expect(results).toHaveLength(1)
    expect(results[0]!.querySelector('strong')?.textContent).toBe('主题')
    // 描述参与匹配
    expect(addonSettingsHits(h, '配色')).toHaveLength(1)
    // 组标题（按当前语言选值）参与匹配
    const groupHits = addonSettingsHits(h, '外观')
    expect(groupHits).toHaveLength(1)
    expect(groupHits[0]!.querySelector('strong')?.textContent).toBe('外观')
  })

  it('点击定义条目：切到组件设置分页，目标组件设置区未开时上送 settingsOpen；点击组条目同链路', () => {
    const h = makeView()
    h.dispatch(addonsState([
      { id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true, settingsSearchIndex: INDEX },
    ]))
    const [hit] = addonSettingsHits(h, '开关项')
    hit!.click()
    expect(h.sent).toContainEqual({ kind: 'addons.settingsOpen', addonId: ADDON_ID })
    const [groupHit] = addonSettingsHits(h, '外观')
    groupHit!.click()
    expect(h.sent.filter((m) => (m as { kind?: string }).kind === 'addons.settingsOpen')).toHaveLength(2)
  })
})

describe('#472 跨组件定位（focusEntry：addon:<id>/def:<键> 与 addon:<id>/group:<键>）', () => {
  const GROUPS = [{ key: 'appearance', title: '外观' }]
  const GROUPED_DEFS = [
    { key: 'flag', title: '开关项', type: 'boolean', default: true },
    { key: 'theme', title: '主题', type: 'string', default: 'light', group: 'appearance' },
  ]

  function scrollIntoViewSpy(): { restore(): void; calls: HTMLElement[] } {
    const calls: HTMLElement[] = []
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>
    const original = proto.scrollIntoView
    proto.scrollIntoView = function scrolled(this: HTMLElement) {
      calls.push(this)
    }
    return {
      restore: () => {
        if (original === undefined) delete proto.scrollIntoView
        else proto.scrollIntoView = original
      },
      calls,
    }
  }

  /** 经全局搜索点击条目导航（真实用户链路；只取「组件设置」分组的命中） */
  function locateBySearch(h: ReturnType<typeof makeView>, text: string): void {
    const search = h.parent.querySelector<HTMLInputElement>('input.vsidian-settings-search')!
    search.value = text
    search.dispatchEvent(new Event('input', { bubbles: true }))
    const [hit] = [...h.parent.querySelectorAll<HTMLButtonElement>('.vsidian-settings-result')]
      .filter((b) => b.querySelector('.vsidian-settings-result-category')?.textContent === zhCn['settings.addonSettingsSection'])
    expect(hit, `搜索应有命中: ${text}`).toBeTruthy()
    hit!.click()
  }

  it('def 级定位：设置区已开时定义行 located + scrollIntoView；定位落点唯一（不描组容器）', () => {
    const spy = scrollIntoViewSpy()
    try {
      const h = makeView()
      h.dispatch(addonsState([{ id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true }]))
      h.dispatch(settingsState({ definitions: GROUPED_DEFS, groups: GROUPS }))
      openSettingsAreaPage(h)
      // 重新 mount 带 focusEntry（搜索点击等价路径）
      h.view.selectSection(ADDON_SETTINGS_SECTION_ID, `addon:${ADDON_ID}/def:theme`)
      const row = h.parent.querySelector('[data-addon-setting="theme"]')?.closest('.vsidian-addons-setting-item')
      expect(row?.classList.contains('vsidian-settings-item-located')).toBe(true)
      expect(spy.calls).toContain(row)
      expect(h.parent.querySelectorAll('.vsidian-addons-settings .vsidian-settings-item-located')).toHaveLength(1)
    } finally {
      spy.restore()
    }
  })

  it('group 级定位：组容器 located（描组卡片，不描区域内行）', () => {
    const spy = scrollIntoViewSpy()
    try {
      const h = makeView()
      h.dispatch(addonsState([{ id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true }]))
      h.dispatch(settingsState({ definitions: GROUPED_DEFS, groups: GROUPS }))
      h.view.selectSection(ADDON_SETTINGS_SECTION_ID, `addon:${ADDON_ID}/group:appearance`)
      const cards = [...h.parent.querySelectorAll('.vsidian-addons-settings > .vsidian-settings-group')]
      const groupCard = cards.find((card) => card.querySelector('.vsidian-settings-group-title')?.textContent === '外观')
      expect(groupCard?.classList.contains('vsidian-settings-item-located')).toBe(true)
      expect(spy.calls).toContain(groupCard)
      expect(groupCard!.querySelector('.vsidian-settings-item-located')).toBeNull()
    } finally {
      spy.restore()
    }
  })

  it('定位高亮一次性退场：约 1.5s 后摘除，后续推送重渲染不重现', () => {
    vi.useFakeTimers()
    try {
      const h = makeView()
      h.dispatch(addonsState([{ id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true }]))
      h.dispatch(settingsState({ definitions: GROUPED_DEFS, groups: GROUPS }))
      h.view.selectSection(ADDON_SETTINGS_SECTION_ID, `addon:${ADDON_ID}/def:theme`)
      expect(h.parent.querySelector('.vsidian-addons-settings .vsidian-settings-item-located')).toBeTruthy()
      vi.advanceTimersByTime(1500)
      expect(h.parent.querySelector('.vsidian-addons-settings .vsidian-settings-item-located')).toBeNull()
      h.dispatch(settingsState({ definitions: GROUPED_DEFS, groups: GROUPS }))
      expect(h.parent.querySelector('.vsidian-addons-settings .vsidian-settings-item-located')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('未开区定位：先上送 settingsOpen，settingsState 到达后定位（pending 只消费一次）', () => {
    vi.useFakeTimers()
    const spy = scrollIntoViewSpy()
    try {
      const h = makeView()
      h.dispatch(addonsState([{
        id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true,
        settingsSearchIndex: {
          definitions: GROUPED_DEFS.map((def) => ({ key: def.key as string, title: def.title as string })),
          groups: [{ key: 'appearance', title: '外观' }],
        },
      }]))
      // 设置区未开（无 settingsState）——经搜索点击触发定位链路
      locateBySearch(h, '主题')
      expect(h.sent).toContainEqual({ kind: 'addons.settingsOpen', addonId: ADDON_ID })
      expect(h.parent.querySelector('.vsidian-addons-settings .vsidian-settings-item-located')).toBeNull()
      // 宿主应答 settingsState 后渲染并定位
      h.dispatch(settingsState({ definitions: GROUPED_DEFS, groups: GROUPS }))
      const row = h.parent.querySelector('[data-addon-setting="theme"]')?.closest('.vsidian-addons-setting-item')
      expect(row?.classList.contains('vsidian-settings-item-located')).toBe(true)
      expect(spy.calls).toContain(row)
      // 时限内同组件推送：高亮保持（定位态跨推送——不延长退场寿命）
      h.dispatch(settingsState({ definitions: GROUPED_DEFS, groups: GROUPS }))
      expect(h.parent.querySelectorAll('.vsidian-addons-settings .vsidian-settings-item-located')).toHaveLength(1)
      // 滚动不随常规推送重放（#467 契约：scrollIntoView 收窄到显式定位渲染）
      expect(spy.calls).toHaveLength(1)
      // 退场后推送不再重现（定位态已清——pending 与高亮均一次性）
      vi.advanceTimersByTime(1500)
      h.dispatch(settingsState({ definitions: GROUPED_DEFS, groups: GROUPS }))
      expect(h.parent.querySelectorAll('.vsidian-addons-settings .vsidian-settings-item-located')).toHaveLength(0)
    } finally {
      spy.restore()
      vi.useRealTimers()
    }
  })

  it('挂起定位应答晚于退场时限：消费时按挂起目标重立定位并重排退场', () => {
    vi.useFakeTimers()
    const spy = scrollIntoViewSpy()
    try {
      const h = makeView()
      h.dispatch(addonsState([{
        id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true,
        settingsSearchIndex: {
          definitions: GROUPED_DEFS.map((def) => ({ key: def.key as string, title: def.title as string })),
          groups: [{ key: 'appearance', title: '外观' }],
        },
      }]))
      locateBySearch(h, '主题')
      expect(h.sent).toContainEqual({ kind: 'addons.settingsOpen', addonId: ADDON_ID })
      // 应答慢于退场时限：mount 时排定的退场已 fire，定位态被清
      vi.advanceTimersByTime(1600)
      expect(h.parent.querySelector('.vsidian-addons-settings .vsidian-settings-item-located')).toBeNull()
      // 应答到达：按挂起目标重立（高亮寿命从定位渲染起算，不从发请求起算）
      h.dispatch(settingsState({ definitions: GROUPED_DEFS, groups: GROUPS }))
      const row = h.parent.querySelector('[data-addon-setting="theme"]')?.closest('.vsidian-addons-setting-item')
      expect(row?.classList.contains('vsidian-settings-item-located')).toBe(true)
      expect(spy.calls).toContain(row)
      // 重排的退场到期后摘除，此后推送不重现
      vi.advanceTimersByTime(1500)
      expect(h.parent.querySelector('.vsidian-addons-settings .vsidian-settings-item-located')).toBeNull()
      h.dispatch(settingsState({ definitions: GROUPED_DEFS, groups: GROUPS }))
      expect(h.parent.querySelector('.vsidian-addons-settings .vsidian-settings-item-located')).toBeNull()
    } finally {
      spy.restore()
      vi.useRealTimers()
    }
  })
})

// ---- #554：侧栏组件条目唯一选中（settingsState.open 权威状态驱动） ----

describe('侧栏组件条目唯一选中（#554）', () => {
  const CORE_A = 'onegayi.core-a'
  const CORE_B = 'onegayi.core-b'
  const THIRD_A = 'a.third'
  /** 两组件三态清单：核心组 A/B + 第三方组 A（跨核心/第三方分组的切换矩阵） */
  function groupedAddonsState(): HostToWebview {
    return addonsState([
      { id: CORE_A, label: 'Core A', official: true, status: 'registered', enabled: true, hasSettingsDefinitions: true },
      { id: CORE_B, label: 'Core B', official: true, status: 'registered', enabled: true, hasSettingsDefinitions: true },
      { id: THIRD_A, label: 'Third A', official: false, status: 'registered', enabled: true, hasSettingsDefinitions: true },
    ])
  }
  /** 侧栏导航条目（选项按钮与组件条目同法：按显示文本定位） */
  function navItem(h: ReturnType<typeof makeView>, title: string): HTMLButtonElement {
    const item = [...h.parent.querySelectorAll<HTMLButtonElement>('.vsidian-settings-nav-item')]
      .find((b) => b.textContent === title)
    expect(item, `侧栏条目「${title}」应在场`).toBeTruthy()
    return item!
  }
  const currentOf = (h: ReturnType<typeof makeView>, title: string): string =>
    navItem(h, title).getAttribute('aria-current') ?? ''

  it('点击组件条目并收到宿主 settingsState 应答后：仅该组件 aria-current=page（同组/跨组其余条目与选项按钮均 false）', async () => {
    const h = makeView()
    h.dispatch(groupedAddonsState())
    navItem(h, 'Core A').click()
    expect(h.sent).toContainEqual({ kind: 'addons.settingsOpen', addonId: CORE_A })
    await h.settle()
    // 宿主应答（真实时序：settingsOpen → postSettingsState 推送回显）
    h.dispatch(settingsState({ addonId: CORE_A }))
    expect(currentOf(h, 'Core A')).toBe('page')
    expect(currentOf(h, 'Core B')).toBe('false')
    expect(currentOf(h, 'Third A')).toBe('false')
    expect(currentOf(h, zhCn['settings.addonsSection'])).toBe('false')
  })

  it('从组件 A 切到 B：A 取消高亮、B 高亮；同组与跨核心/第三方分组均正确', async () => {
    const h = makeView()
    h.dispatch(groupedAddonsState())
    navItem(h, 'Core A').click()
    await h.settle()
    h.dispatch(settingsState({ addonId: CORE_A }))
    expect(currentOf(h, 'Core A')).toBe('page')
    // 同组切换（核心 A → 核心 B）
    navItem(h, 'Core B').click()
    await h.settle()
    h.dispatch(settingsState({ addonId: CORE_B }))
    expect(currentOf(h, 'Core B')).toBe('page')
    expect(currentOf(h, 'Core A')).toBe('false')
    // 跨组切换（核心 B → 第三方 A）
    navItem(h, 'Third A').click()
    await h.settle()
    h.dispatch(settingsState({ addonId: THIRD_A }))
    expect(currentOf(h, 'Third A')).toBe('page')
    expect(currentOf(h, 'Core B')).toBe('false')
    expect(currentOf(h, 'Core A')).toBe('false')
  })

  it('纯运行组件条目点击：不开设置区、组件条目不整组点亮，「附加组件」选项按钮按当前页高亮', async () => {
    const h = makeView()
    h.dispatch(addonsState([
      { id: 'a.plain', label: 'Plain', official: false, status: 'registered', enabled: true },
      { id: CORE_A, label: 'Core A', official: true, status: 'registered', enabled: true, hasSettingsDefinitions: true },
    ]))
    navItem(h, 'Plain').click()
    expect(h.sent.filter((m) => (m as { kind?: string }).kind === 'addons.settingsOpen')).toEqual([])
    await h.settle()
    expect(currentOf(h, 'Plain')).toBe('false')
    expect(currentOf(h, 'Core A')).toBe('false')
    expect(currentOf(h, zhCn['settings.addonsSection'])).toBe('page')
  })

  it('关闭设置区（open=null 推送）：组件条目高亮摘除，无旧组件残留', async () => {
    const h = makeView()
    h.dispatch(groupedAddonsState())
    navItem(h, 'Core A').click()
    await h.settle()
    h.dispatch(settingsState({ addonId: CORE_A }))
    expect(currentOf(h, 'Core A')).toBe('page')
    h.dispatch(settingsState({ open: null }))
    expect(currentOf(h, 'Core A')).toBe('false')
    expect(currentOf(h, 'Core B')).toBe('false')
    expect(currentOf(h, 'Third A')).toBe('false')
  })

  it('全局搜索跳入组件详情（#472 定位链路）：settingsState 应答后对应组件标记为当前项', async () => {
    const h = makeView()
    h.dispatch(groupedAddonsState())
    // 搜索结果点击的等价形态：active 落详情分页、mount 携带 def 级定位条目
    h.view.selectSection(ADDON_SETTINGS_SECTION_ID, `addon:${CORE_A}/def:flag`)
    expect(h.sent).toContainEqual({ kind: 'addons.settingsOpen', addonId: CORE_A })
    await h.settle()
    h.dispatch(settingsState({ addonId: CORE_A }))
    expect(currentOf(h, 'Core A')).toBe('page')
    expect(currentOf(h, 'Core B')).toBe('false')
  })

  it('重新打开的装载时序：状态先到、focusSection 恢复后到——侧栏收敛到当前组件高亮', () => {
    const h = makeView()
    h.dispatch(groupedAddonsState())
    // 装载即拉取的 settingsState 应答先到（此时不在详情分页，无高亮）
    h.dispatch(settingsState({ addonId: CORE_B }))
    // 宿主按会话内记忆补发 focusSection 恢复到详情分页
    h.view.handleHostMessage({ kind: 'settings.focusSection', section: ADDON_SETTINGS_SECTION_ID })
    expect(currentOf(h, 'Core B')).toBe('page')
    expect(currentOf(h, 'Core A')).toBe('false')
    expect(currentOf(h, 'Third A')).toBe('false')
  })
})

// ---- #553 详情自绘页优先：首屏形态、打开语义与设置上下文交付 ----

describe('#553 详情自绘页优先：首屏形态与打开语义', () => {
  /** 自绘页详情夹具：host 内预置组件挂载内容（装载器 mountRoot 的替身） */
  function customHost(): { host: HTMLElement; mounted: HTMLElement } {
    const host = document.createElement('div')
    const mounted = document.createElement('span')
    mounted.textContent = '组件自定义内容'
    host.appendChild(mounted)
    return { host, mounted }
  }

  /** 自绘页组件的 addons.state 清单（含设置页声明） */
  function customAddonsState(openAddonSettingsPage?: string | null): HostToWebview {
    return addonsState([
      { id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true, hasSettingsPage: true },
    ], openAddonSettingsPage ?? null)
  }

  it('hasCustomPage 详情渲染即自动上送 openAddonPage（无需用户点击）；应答未达期间重复推送不重发', () => {
    const { host } = customHost()
    const h = makeView(host)
    openSettingsAreaPage(h)
    h.dispatch(customAddonsState())
    h.dispatch(settingsState({ hasCustomPage: true }))
    expect(h.sent).toContainEqual({ kind: 'addons.openAddonPage', addonId: ADDON_ID })
    // 应答未达期间的常规推送不重发（宿主 openSettingsPage 会递增代次——重发即世代抖动）
    h.dispatch(settingsState({ hasCustomPage: true }))
    h.dispatch(settingsState({ hasCustomPage: true }))
    expect(h.sent.filter((m) => (m as { kind?: string }).kind === 'addons.openAddonPage')).toHaveLength(1)
  })

  it('openAddonSettingsPage 应答后挂载区并入详情首屏；无「打开自定义设置页」开闭按钮（重复入口消除）', () => {
    const { host, mounted } = customHost()
    const h = makeView(host)
    openSettingsAreaPage(h)
    h.dispatch(customAddonsState(ADDON_ID))
    h.dispatch(settingsState({ hasCustomPage: true, openAddonSettingsPage: ADDON_ID }))
    const wrap = h.parent.querySelector('.vsidian-addons-settings .vsidian-addons-addonpage')
    expect(wrap).toBeTruthy()
    expect(wrap!.contains(host)).toBe(true)
    expect(wrap!.contains(mounted)).toBe(true)
    // 旧「打开自定义设置页」开闭入口随本票退役（详情即页——不再有额外操作）
    expect(buttons(h, '打开自定义设置页')).toEqual([])
    expect(buttons(h, '关闭组件设置页')).toEqual([])
  })

  it('基础设置转次级视图：首屏无定义控件；「基础设置」页签切换后表单呈现（定义/校验/清除入口保留）；外壳恒在场', () => {
    const { host } = customHost()
    const h = makeView(host)
    openSettingsAreaPage(h)
    h.dispatch(customAddonsState(ADDON_ID))
    h.dispatch(settingsState({ hasCustomPage: true, openAddonSettingsPage: ADDON_ID }))
    // 首屏：自绘页为主内容，同一批设置项不重复呈现默认表单
    expect(h.parent.querySelector('[data-addon-setting="flag"]')).toBeNull()
    expect(h.parent.querySelector('[data-addon-array-item="replacements"]')).toBeNull()
    expect(buttons(h, '保存')).toEqual([])
    // 外壳保留：作用域标签 + 总开关恒在场（平台职责不迁移）
    expect(h.parent.querySelectorAll('.vsidian-addons-scope-tab')).toHaveLength(2)
    expect(h.parent.querySelector('input[data-addon-setting="__enabled__"]')).toBeTruthy()
    // 切到「基础设置」页签：表单呈现（定义行在场——注册/校验/存储清除入口不迁移）
    const tabs = [...h.parent.querySelectorAll('.vsidian-addons-detail-tab')] as HTMLButtonElement[]
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false'])
    tabs[1]!.click()
    expect(h.parent.querySelector('[data-addon-setting="flag"]')).toBeTruthy()
    expect(h.parent.querySelector('input[data-addon-array-item="replacements"]')).toBeTruthy()
    // 工作区标签下已覆盖项的清除入口仍在次级表单内
    const scopeTabs = [...h.parent.querySelectorAll('.vsidian-addons-scope-tab')] as HTMLButtonElement[]
    scopeTabs[1]!.click()
    h.dispatch(settingsState({ hasCustomPage: true, openAddonSettingsPage: ADDON_ID, values: { threshold: { workspace: 77, source: 'workspace' } } }))
    expect(buttons(h, '使用用户默认').some((b) => b.dataset.addonSettingKey === 'threshold')).toBe(true)
  })

  it('详情标题随形态：自绘页优先时用「{label} 设置」；返回时 settingsClose 与 closeAddonPage 同发（详情即页）', () => {
    const { host } = customHost()
    const h = makeView(host)
    openSettingsAreaPage(h)
    h.dispatch(customAddonsState(ADDON_ID))
    h.dispatch(settingsState({ hasCustomPage: true, openAddonSettingsPage: ADDON_ID }))
    expect(area(h)!.textContent ?? '').toContain(zhCn['addons.settingsDetailTitle'].replace('{label}', 'Demo'))
    buttons(h, '返回组件列表')[0]!.click()
    expect(h.sent).toContainEqual({ kind: 'addons.settingsClose' })
    expect(h.sent).toContainEqual({ kind: 'addons.closeAddonPage' })
  })

  it('切换组件：自绘页组件 → 无自绘页组件，挂载区让位、表单呈现且定位交付清空', () => {
    const { host, mounted } = customHost()
    const context = new AddonSettingsContextRuntime()
    const h = makeView(host, context)
    openSettingsAreaPage(h)
    h.dispatch(customAddonsState(ADDON_ID))
    h.dispatch(settingsState({ hasCustomPage: true, openAddonSettingsPage: ADDON_ID }))
    context.deliverLocateTarget({ kind: 'def', key: 'flag' })
    // 切到无自绘页组件 B：详情为整页表单，host 移出分页内容（内容保留不销毁）
    h.dispatch(addonsState([
      { id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true, hasSettingsPage: true },
      { id: 'b.plain', label: 'PlainB', official: false, status: 'registered', hasSettingsDefinitions: true },
    ], null))
    h.dispatch(settingsState({ addonId: 'b.plain', hasCustomPage: false, openAddonSettingsPage: null }))
    expect(h.parent.querySelector('[data-addon-setting="flag"]')).toBeTruthy()
    expect(h.parent.contains(host)).toBe(false)
    expect(host.contains(mounted)).toBe(true)
    expect(context.currentLocateTarget()).toBeNull()
    // 无自绘页组件不触发 openAddonPage
    expect(h.sent.filter((m) => (m as { kind?: string; addonId?: string }).kind === 'addons.openAddonPage' && (m as { addonId: string }).addonId === 'b.plain')).toEqual([])
  })

  it('故障态：自绘页视图退场（无页签/挂载），基础表单与排障块在场；不自动上送 openAddonPage；重试恢复后再次自动上送', () => {
    const { host } = customHost()
    const h = makeView(host)
    openSettingsAreaPage(h)
    h.dispatch(customAddonsState())
    h.dispatch(settingsState({ hasCustomPage: true }))
    const openedCount = () => h.sent.filter((m) => (m as { kind?: string }).kind === 'addons.openAddonPage').length
    expect(openedCount()).toBe(1)
    // 故障推送：desiredSettingsLoad 归 null（宿主撤载），详情退回基础表单 + 排障
    h.dispatch(settingsState({
      addonId: ADDON_ID, hasCustomPage: true, openAddonSettingsPage: null,
      faulted: true, faultReason: 'setup 异常：bad',
    }))
    expect(h.parent.querySelector('.vsidian-addons-detail-tab')).toBeNull()
    expect(h.parent.querySelector('.vsidian-addons-addonpage')).toBeNull()
    expect(h.parent.querySelector('.vsidian-addons-fault-troubleshoot')).toBeTruthy()
    expect(h.parent.querySelector('input[data-addon-setting="threshold"]')).toBeTruthy()
    // 故障期间不自动开页（请求标记已清）
    h.dispatch(settingsState({
      addonId: ADDON_ID, hasCustomPage: true, openAddonSettingsPage: null,
      faulted: true, faultReason: 'setup 异常：bad',
    }))
    expect(openedCount()).toBe(1)
    // 重试成功（faulted 恢复、设置区仍开）：再次自动上送 openAddonPage
    h.dispatch(settingsState({ addonId: ADDON_ID, hasCustomPage: true, openAddonSettingsPage: null }))
    expect(openedCount()).toBe(2)
  })

  it('无自绘页组件维持默认表单（无页签、无自动开页）', () => {
    const h = makeView()
    openSettingsAreaPage(h)
    h.dispatch(addonsState([{ id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true }]))
    h.dispatch(settingsState({}))
    expect(h.parent.querySelector('.vsidian-addons-detail-tab')).toBeNull()
    expect(h.parent.querySelector('input[data-addon-setting="flag"]')).toBeTruthy()
    expect(h.sent.filter((m) => (m as { kind?: string }).kind === 'addons.openAddonPage')).toEqual([])
  })
})

describe('#553 设置页上下文交付（作用域与定位目标）', () => {
  it('作用域切换上抛：详情渲染同步快照；切工作区标签 → runtime 快照更新且订阅回调收到；无工作区经宿主推送同步', () => {
    const context = new AddonSettingsContextRuntime()
    const seen: Array<{ scope: string; hasWorkspace: boolean }> = []
    context.subscribeScope('probe.addon', (s) => seen.push({ scope: s.scope, hasWorkspace: s.hasWorkspace }))
    const h = makeView(document.createElement('div'), context)
    openSettingsAreaPage(h)
    h.dispatch(addonsState([
      { id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true, hasSettingsPage: true },
    ], ADDON_ID))
    h.dispatch(settingsState({ hasCustomPage: true, openAddonSettingsPage: ADDON_ID }))
    // 详情首帧默认 user
    expect(context.scopeSnapshot()).toEqual({ scope: 'user', hasWorkspace: true })
    const tabs = [...h.parent.querySelectorAll('.vsidian-addons-scope-tab')] as HTMLButtonElement[]
    tabs[1]!.click()
    expect(context.scopeSnapshot()).toEqual({ scope: 'workspace', hasWorkspace: true })
    expect(seen).toEqual([{ scope: 'workspace', hasWorkspace: true }])
    // 无工作区载荷经 settingsState 推送同步（快照 hasWorkspace 跟随宿主权威值）
    h.dispatch(settingsState({ hasCustomPage: true, openAddonSettingsPage: ADDON_ID, hasWorkspace: false }))
    expect(context.scopeSnapshot()).toEqual({ scope: 'workspace', hasWorkspace: false })
  })

  /** 经全局搜索点击「组件设置」分组的命中条目（真实用户链路） */
  function locateByAddonSearch(h: ReturnType<typeof makeView>, text: string): void {
    const search = h.parent.querySelector<HTMLInputElement>('input.vsidian-settings-search')!
    search.value = text
    search.dispatchEvent(new Event('input', { bubbles: true }))
    const [hit] = [...h.parent.querySelectorAll<HTMLButtonElement>('.vsidian-settings-result')]
      .filter((b) => b.querySelector('.vsidian-settings-result-category')?.textContent === zhCn['settings.addonSettingsSection'])
    expect(hit, `搜索应有命中: ${text}`).toBeTruthy()
    hit!.click()
  }

  it('定位目标交给自绘页：已开详情时搜索定位 def → runtime 收到目标、详情保持自绘页视图（平台不切回自己表单）', () => {
    const context = new AddonSettingsContextRuntime()
    const h = makeView(document.createElement('div'), context)
    h.dispatch(addonsState([{
      id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true, hasSettingsPage: true,
      settingsSearchIndex: { definitions: [{ key: 'flag', title: '开关项' }], groups: [] },
    }]))
    h.dispatch(settingsState({ hasCustomPage: true, openAddonSettingsPage: ADDON_ID }))
    openSettingsAreaPage(h)
    locateByAddonSearch(h, '开关项')
    expect(context.currentLocateTarget()).toEqual({ kind: 'def', key: 'flag' })
    // 自绘页视图保持（平台不切回表单、不描表单行——落点交给组件）
    expect(h.parent.querySelector('.vsidian-addons-detail-tab')!.getAttribute('aria-selected')).toBe('true')
    expect(h.parent.querySelector('.vsidian-settings-item-located')).toBeNull()
  })

  it('未开区定位（pendingFocus 消费路径）：应答到达后目标交付 runtime', () => {
    const context = new AddonSettingsContextRuntime()
    const h = makeView(document.createElement('div'), context)
    h.dispatch(addonsState([{
      id: ADDON_ID, label: 'Demo', official: false, status: 'registered', hasSettingsDefinitions: true, hasSettingsPage: true,
      settingsSearchIndex: { definitions: [{ key: 'flag', title: '开关项' }], groups: [] },
    }]))
    locateByAddonSearch(h, '开关项')
    expect(h.sent).toContainEqual({ kind: 'addons.settingsOpen', addonId: ADDON_ID })
    expect(context.currentLocateTarget()).toBeNull()
    // 宿主应答（open + 挂载）：挂起目标交付
    h.dispatch(settingsState({ hasCustomPage: true, openAddonSettingsPage: ADDON_ID }))
    expect(context.currentLocateTarget()).toEqual({ kind: 'def', key: 'flag' })
  })

  it('样式契约：详情双视图页签归档（pill 容器 + 选中态 activeSelection 规则在场）', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync('src/webview/settingsPage.css', 'utf8')
    expect(css).toMatch(/\.vsidian-addons-detail-tabs\s*\{[^}]*display:\s*inline-flex/)
    expect(css).toMatch(/\.vsidian-addons-detail-tab\s*\{[^}]*border-radius:\s*6px/)
    expect(css).toMatch(/\.vsidian-addons-detail-tab\[aria-selected='true'\]\s*\{[^}]*background:\s*var\(--vscode-list-activeSelectionBackground/)
  })
})
