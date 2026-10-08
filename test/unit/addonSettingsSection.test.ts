// @vitest-environment jsdom
// #350 T01 设置页「附加组件」分页呈现契约：状态列表的**用户可见文本**
// （注册/唤醒/不兼容含声明范围/激活失败含原因/当前宿主不可用不冒充未安
// 装）、官方与第三方分组、空态、API 版本草案标注、市场搜索与 VSCode 扩
// 展管理按钮的消息上送。装配口径与生产 settingsMain.ts 同构。
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
import { AddonSection, ADDONS_SECTION_LIST_ENTRY, ADDONS_SECTION_MANAGE_ENTRY } from '../../src/webview/addonSettingsSection'

installLocale('zh-cn', zhCn)

function makeView(addonSettingsHost?: HTMLElement): {
  view: SettingsPageView
  addons: AddonSection
  dispatch(message: unknown): void
  sent: unknown[]
  parent: HTMLElement
} {
  const sent: unknown[] = []
  const bridge = { postMessage: (m: unknown) => sent.push(m) }
  // #354 T05 侧栏联动中转（与生产 settingsMain 同构：分页经回调触发
  // 视图 refreshSidebar 重建侧栏大组）
  let refreshSidebar: () => void = () => {}
  const addons = new AddonSection(bridge, addonSettingsHost, () => refreshSidebar())
  const view = new SettingsPageView(bridge, PRODUCTION_SETTING_DEFINITIONS,
    [
      new KeybindingSettingsSection(bridge),
      new AppearanceSection(new CssSnippetSettingsSection(bridge), new StyleReferenceSection(bridge)),
      new IndexMaintenanceSection(bridge),
      addons,
    ],
    [], [])
  refreshSidebar = () => view.refreshSidebar()
  const parent = document.createElement('div')
  view.mount(parent)
  return {
    view, addons, sent, parent,
    dispatch: (message: unknown) => {
      view.handleHostMessage(message)
      addons.handleHostMessage(message)
    },
  }
}

/** 构造 addons.state 消息（先经协议守卫验证载荷形态，再进分页） */
function addonsState(
  addons: HostToWebview extends never ? never : Array<Record<string, unknown>>,
  openAddonSettingsPage?: string | null,
): HostToWebview {
  const message = {
    kind: 'addons.state',
    apiVersion: '1.0.0',
    draft: true,
    addons,
    ...(openAddonSettingsPage !== undefined ? { openAddonSettingsPage } : {}),
  }
  if (!isHostToWebview(message)) {
    throw new Error('addons.state 载荷未通过协议守卫')
  }
  return message
}

function openAddonsPage(harness: ReturnType<typeof makeView>): void {
  harness.view.selectSection('addons')
}

function visibleText(root: HTMLElement): string {
  return root.textContent ?? ''
}

describe('附加组件分页呈现（用户可见文本）', () => {
  it('状态未到达时显示读取中，不显示空态或列表', () => {
    const harness = makeView()
    openAddonsPage(harness)
    const text = visibleText(harness.parent)
    expect(text).toContain('附加组件')
    expect(text).toContain('正在唤醒')
    expect(text).not.toContain('未发现')
  })

  it('注册组件显示显示名、扩展 ID 与已注册状态', () => {
    const harness = makeView()
    openAddonsPage(harness)
    harness.dispatch(addonsState([
      { id: 'vsidian-test-fixture.addon-ok', label: 'Sample Add-on', official: false, status: 'registered' },
    ]))
    const text = visibleText(harness.parent)
    expect(text).toContain('Sample Add-on')
    expect(text).toContain('vsidian-test-fixture.addon-ok')
    expect(text).toContain('已注册')
    expect(text).not.toContain('正在唤醒')
  })

  it('不兼容组件显示声明范围与宿主版本（原因组句）', () => {
    const harness = makeView()
    openAddonsPage(harness)
    harness.dispatch(addonsState([
      { id: 'vsidian-test-fixture.addon-incompatible', label: 'Future', official: false, status: 'incompatible', apiRange: '^2.0.0' },
    ]))
    const text = visibleText(harness.parent)
    expect(text).toContain('不兼容')
    expect(text).toContain('^2.0.0')
    expect(text).toContain('1.0.0')
  })

  it('激活失败组件显示错误摘要', () => {
    const harness = makeView()
    openAddonsPage(harness)
    harness.dispatch(addonsState([
      { id: 'vsidian-test-fixture.addon-fail', label: 'Fail', official: false, status: 'activation-failed', detail: 'addon exploded' },
    ]))
    const text = visibleText(harness.parent)
    expect(text).toContain('激活失败')
    expect(text).toContain('addon exploded')
  })

  it('当前宿主不可用：显示查不到提示，不冒充未安装或装错侧', () => {
    const harness = makeView()
    openAddonsPage(harness)
    harness.dispatch(addonsState([
      { id: 'vsidian-test-fixture.addon-gone', label: 'Gone', official: false, status: 'host-unavailable' },
    ]))
    const text = visibleText(harness.parent)
    expect(text).toContain('查不到该扩展')
    expect(text).toContain('VSCode 扩展管理')
    expect(text).not.toContain('未安装')
  })

  it('身份声明不合法显示原因', () => {
    const harness = makeView()
    openAddonsPage(harness)
    harness.dispatch(addonsState([
      { id: 'vsidian-test-fixture.addon-bad', label: 'Bad', official: false, status: 'invalid-declaration', detail: 'manifest-version-unsupported' },
    ]))
    const text = visibleText(harness.parent)
    expect(text).toContain('身份声明不合法')
    expect(text).toContain('manifest-version-unsupported')
  })

  it('官方组件归「核心组件」分组并带官方徽章；第三方归第三方分组', () => {
    const harness = makeView()
    openAddonsPage(harness)
    harness.dispatch(addonsState([
      { id: 'a.third', label: 'Third', official: false, status: 'registered' },
      { id: 'onegayi.core', label: 'Core', official: true, status: 'registered' },
    ]))
    const text = visibleText(harness.parent)
    expect(text).toContain('核心组件')
    expect(text).toContain('第三方组件')
    expect(text).toContain('Core · 官方')
    // 官方分组在第三方之前呈现
    expect(text.indexOf('核心组件')).toBeLessThan(text.indexOf('第三方组件'))
  })

  it('空列表显示空态文案', () => {
    const harness = makeView()
    openAddonsPage(harness)
    harness.dispatch(addonsState([]))
    expect(visibleText(harness.parent)).toContain('未发现 Vsidian 附加组件')
  })

  it('API 版本行带草案标注（不冒充已发布稳定 API）', () => {
    const harness = makeView()
    openAddonsPage(harness)
    harness.dispatch(addonsState([]))
    const text = visibleText(harness.parent)
    expect(text).toContain('附加组件 API 版本 1.0.0')
    expect(text).toContain('草案')
  })
})

describe('附加组件分页入口与消息上送', () => {
  it('侧栏注册「附加组件」分页并可切换', () => {
    const harness = makeView()
    const nav = harness.parent.querySelector('nav')
    expect(nav?.textContent).toContain('附加组件')
  })

  it('装载即拉取：分页构造不主动拉取（由 settingsMain 装载点发 addons.get）', () => {
    const harness = makeView()
    expect(harness.sent).toEqual([])
  })

  it('市场搜索与扩展管理按钮经消息桥上送宿主', () => {
    const harness = makeView()
    openAddonsPage(harness)
    harness.dispatch(addonsState([]))
    const buttons = [...harness.parent.querySelectorAll('button')]
    const search = buttons.find((button) => button.textContent === '在市场搜索附加组件')
    const manage = buttons.find((button) => button.textContent === '在 VSCode 管理扩展')
    expect(search).toBeTruthy()
    expect(manage).toBeTruthy()
    search!.click()
    manage!.click()
    expect(harness.sent).toContainEqual({ kind: 'addons.openSearch' })
    expect(harness.sent).toContainEqual({ kind: 'addons.openExtensionsView' })
  })

  it('组件行的「扩展详情」按钮上送 addons.openExtension（携带组件 ID）', () => {
    const harness = makeView()
    openAddonsPage(harness)
    harness.dispatch(addonsState([
      { id: 'vsidian-test-fixture.addon-ok', label: 'Sample', official: false, status: 'registered' },
    ]))
    const detail = [...harness.parent.querySelectorAll('button')]
      .find((button) => button.textContent === '扩展详情')
    expect(detail).toBeTruthy()
    detail!.click()
    expect(harness.sent).toContainEqual({ kind: 'addons.openExtension', extensionId: 'vsidian-test-fixture.addon-ok' })
  })

  it('全局搜索条目命中「附加组件」分组', () => {
    const harness = makeView()
    const search = harness.parent.querySelector<HTMLInputElement>('input.vsidian-settings-search')
    expect(search).toBeTruthy()
    search!.value = '附加组件'
    search!.dispatchEvent(new Event('input', { bubbles: true }))
    const results = harness.parent.textContent ?? ''
    expect(results).toContain('附加组件')
    expect(results).toContain('在市场搜索附加组件')
  })

  it('focusEntry 定位：list 定位列表、manage 定位工具组', () => {
    const harness = makeView()
    openAddonsPage(harness)
    harness.dispatch(addonsState([]))
    const list = harness.parent.querySelector('.vsidian-addons-list')
    const manage = harness.parent.querySelector('.vsidian-addons-actions')
    expect(list).toBeTruthy()
    expect(manage).toBeTruthy()
    expect(ADDONS_SECTION_LIST_ENTRY).toBe('list')
    expect(ADDONS_SECTION_MANAGE_ENTRY).toBe('manage')
  })
})

// ---- #351 T02：运行生命周期（功能开关 / 组件设置页挂载区 / 故障态） ----

describe('附加组件分页：功能开关与运行状态（T02）', () => {
  it('已启用组件显示「停用」按钮与「已启用」状态句；点击上送 setEnabled(false)', () => {
    const harness = makeView()
    openAddonsPage(harness)
    harness.dispatch(addonsState([
      { id: 'fixture.demo', label: 'Demo', official: false, status: 'registered', enabled: true },
    ]))
    const text = visibleText(harness.parent)
    expect(text).toContain('已启用')
    const disable = [...harness.parent.querySelectorAll('button')].find((b) => b.textContent === '停用')
    expect(disable).toBeTruthy()
    disable!.click()
    expect(harness.sent).toContainEqual({ kind: 'addons.setEnabled', addonId: 'fixture.demo', enabled: false })
  })

  it('已停用组件显示「启用」按钮与「已停用」状态句；点击上送 setEnabled(true)', () => {
    const harness = makeView()
    openAddonsPage(harness)
    harness.dispatch(addonsState([
      { id: 'fixture.demo', label: 'Demo', official: false, status: 'registered', enabled: false },
    ]))
    expect(visibleText(harness.parent)).toContain('已停用')
    const enable = [...harness.parent.querySelectorAll('button')].find((b) => b.textContent === '启用')
    expect(enable).toBeTruthy()
    enable!.click()
    expect(harness.sent).toContainEqual({ kind: 'addons.setEnabled', addonId: 'fixture.demo', enabled: true })
  })

  it('未注册组件（无 enabled 字段）不显示开关与运行状态句', () => {
    const harness = makeView()
    openAddonsPage(harness)
    harness.dispatch(addonsState([
      { id: 'fixture.old', label: 'Old', official: false, status: 'registered' },
    ]))
    const buttons = [...harness.parent.querySelectorAll('button')].map((b) => b.textContent)
    expect(buttons).not.toContain('启用')
    expect(buttons).not.toContain('停用')
    expect(visibleText(harness.parent)).not.toContain('已启用')
    expect(visibleText(harness.parent)).not.toContain('已停用')
  })

  it('故障暂停：状态句显示原因原文，偏好状态仍呈现，开关照常可用', () => {
    const harness = makeView()
    openAddonsPage(harness)
    harness.dispatch(addonsState([
      { id: 'fixture.demo', label: 'Demo', official: false, status: 'registered', enabled: true, fault: { reason: 'enable 异常：boom' } },
    ]))
    const text = visibleText(harness.parent)
    expect(text).toContain('故障暂停')
    expect(text).toContain('enable 异常：boom')
    // 偏好保留（enabled=true——用户未关闭），开关照常
    expect([...harness.parent.querySelectorAll('button')].some((b) => b.textContent === '停用')).toBe(true)
  })
})

describe('附加组件分页：组件设置页入口与挂载区（T02）', () => {
  it('hasSettingsPage 时显示「打开组件设置页」按钮；点击上送 openAddonPage', () => {
    const harness = makeView()
    openAddonsPage(harness)
    harness.dispatch(addonsState([
      { id: 'fixture.demo', label: 'Demo', official: false, status: 'registered', enabled: true, hasSettingsPage: true },
    ]))
    const open = [...harness.parent.querySelectorAll('button')].find((b) => b.textContent === '打开组件设置页')
    expect(open).toBeTruthy()
    open!.click()
    expect(harness.sent).toContainEqual({ kind: 'addons.openAddonPage', addonId: 'fixture.demo' })
  })

  it('无设置页或故障暂停时不显示打开入口', () => {
    const harness = makeView()
    openAddonsPage(harness)
    harness.dispatch(addonsState([
      { id: 'fixture.none', label: 'None', official: false, status: 'registered', enabled: true },
      { id: 'fixture.faulted', label: 'Faulted', official: false, status: 'registered', enabled: true, fault: { reason: 'x' }, hasSettingsPage: false },
    ]))
    const buttons = [...harness.parent.querySelectorAll('button')].map((b) => b.textContent)
    expect(buttons).not.toContain('打开组件设置页')
  })

  it('openAddonSettingsPage 时渲染挂载区（标题 + 关闭按钮 + host 移入分页）', () => {
    const host = document.createElement('div')
    const mounted = document.createElement('button')
    mounted.textContent = '组件内容'
    host.appendChild(mounted)
    const harness = makeView(host)
    openAddonsPage(harness)
    harness.dispatch(addonsState([
      { id: 'fixture.demo', label: 'Demo', official: false, status: 'registered', enabled: true, hasSettingsPage: true },
    ], 'fixture.demo'))
    const wrap = harness.parent.querySelector('.vsidian-addons-addonpage')
    expect(wrap).toBeTruthy()
    expect(wrap!.textContent).toContain('组件设置页：Demo')
    // host（含组件挂载内容）被移入分页，子树保留
    expect(wrap!.contains(host)).toBe(true)
    expect(wrap!.contains(mounted)).toBe(true)
    const close = [...wrap!.querySelectorAll('button')].find((b) => b.textContent === '关闭组件设置页')
    expect(close).toBeTruthy()
    close!.click()
    expect(harness.sent).toContainEqual({ kind: 'addons.closeAddonPage' })
  })

  it('状态推送重渲染只移动 host 节点，不清空组件挂载内容', () => {
    const host = document.createElement('div')
    const mounted = document.createElement('span')
    mounted.textContent = '组件内容'
    host.appendChild(mounted)
    const harness = makeView(host)
    openAddonsPage(harness)
    harness.dispatch(addonsState([
      { id: 'fixture.demo', label: 'Demo', official: false, status: 'registered', enabled: true, hasSettingsPage: true },
    ], 'fixture.demo'))
    harness.dispatch(addonsState([
      { id: 'fixture.demo', label: 'Demo', official: false, status: 'registered', enabled: true, hasSettingsPage: true },
    ], 'fixture.demo'))
    const wrap = harness.parent.querySelector('.vsidian-addons-addonpage')
    expect(wrap).toBeTruthy()
    expect(wrap!.contains(mounted)).toBe(true)
  })

  it('openAddonSettingsPage 终结（null）后挂载区消失，host 移出分页但内容保留', () => {
    const host = document.createElement('div')
    const mounted = document.createElement('span')
    mounted.textContent = '组件内容'
    host.appendChild(mounted)
    const harness = makeView(host)
    openAddonsPage(harness)
    harness.dispatch(addonsState([
      { id: 'fixture.demo', label: 'Demo', official: false, status: 'registered', enabled: true, hasSettingsPage: true },
    ], 'fixture.demo'))
    harness.dispatch(addonsState([
      { id: 'fixture.demo', label: 'Demo', official: false, status: 'registered', enabled: true, hasSettingsPage: true },
    ], null))
    expect(harness.parent.querySelector('.vsidian-addons-addonpage')).toBeNull()
    expect(harness.parent.contains(host)).toBe(false)
    expect(host.contains(mounted)).toBe(true)
  })
})

// ---- #354 T05：侧栏三组结构（选项 / 核心组件 / 第三方组件） ----

describe('设置页侧栏三组结构（T05）', () => {
  it('「选项」大组恒在场并收纳现有内置分页与「附加组件」管理分页', () => {
    const harness = makeView()
    const nav = harness.parent.querySelector('nav')
    const optionsLabel = nav?.querySelector('.vsidian-settings-nav-group-label')
    expect(optionsLabel?.textContent).toBe('选项')
    const optionsSection = optionsLabel?.closest('.vsidian-settings-nav-section')
    // 现有内置分页（常规/编辑器/快捷键/外观/文件与链接/实验性功能）与
    // 「附加组件」管理分页都在「选项」大组内
    const itemTexts = [...(optionsSection?.querySelectorAll('.vsidian-settings-nav-item') ?? [])].map((b) => b.textContent)
    for (const expected of ['常规', '编辑器', '快捷键', '外观', '文件与链接', '实验性功能', '附加组件']) {
      expect(itemTexts.some((text) => text?.includes(expected))).toBe(true)
    }
  })

  it('核心/第三方两大组恒在场（空清单也不消失），官方与第三方组件归位准确', () => {
    const harness = makeView()
    harness.dispatch(addonsState([
      { id: 'onegayi.core', label: 'Core', official: true, status: 'registered', enabled: true },
      { id: 'a.third', label: 'Third', official: false, status: 'registered', enabled: true },
    ]))
    const labels = [...harness.parent.querySelectorAll('.vsidian-settings-nav-group-label')].map((el) => el.textContent)
    expect(labels).toEqual(['选项', '核心组件', '第三方组件'])
    const sections = [...harness.parent.querySelectorAll('.vsidian-settings-nav-section')]
    const core = sections[1]
    const third = sections[2]
    expect(core?.textContent).toContain('Core')
    expect(third?.textContent).toContain('Third')
  })

  it('大组间有视觉分隔元素', () => {
    const harness = makeView()
    harness.dispatch(addonsState([]))
    // 三个大组 → 两条分隔（选项|核心、核心|第三方）
    const dividers = harness.parent.querySelectorAll('.vsidian-settings-nav-divider')
    expect(dividers.length).toBe(2)
  })

  it('已启用/已停用子组按用户功能开关归类；未注册组件不进侧栏分组', () => {
    const harness = makeView()
    harness.dispatch(addonsState([
      { id: 'onegayi.core', label: 'CoreOn', official: true, status: 'registered', enabled: true },
      { id: 'onegayi.off', label: 'CoreOff', official: true, status: 'registered', enabled: false },
      { id: 'a.on', label: 'ThirdOn', official: false, status: 'registered', enabled: true },
      { id: 'a.off', label: 'ThirdOff', official: false, status: 'registered', enabled: false },
      // 未注册（无开关值）不参与已启用/已停用归类
      { id: 'a.incompatible', label: 'Future', official: false, status: 'incompatible', apiRange: '^2.0.0' },
    ]))
    const sections = [...harness.parent.querySelectorAll('.vsidian-settings-nav-section')]
    const coreSubgroups = [...(sections[1]?.querySelectorAll('.vsidian-settings-nav-subgroup') ?? [])]
    const coreEnabled = coreSubgroups.find((g) => g.querySelector('.vsidian-settings-nav-subgroup-label')?.textContent === '已启用')
    const coreDisabled = coreSubgroups.find((g) => g.querySelector('.vsidian-settings-nav-subgroup-label')?.textContent === '已停用')
    expect(coreEnabled?.textContent).toContain('CoreOn')
    expect(coreDisabled?.textContent).toContain('CoreOff')
    const thirdSubgroups = [...(sections[2]?.querySelectorAll('.vsidian-settings-nav-subgroup') ?? [])]
    const thirdEnabled = thirdSubgroups.find((g) => g.querySelector('.vsidian-settings-nav-subgroup-label')?.textContent === '已启用')
    const thirdDisabled = thirdSubgroups.find((g) => g.querySelector('.vsidian-settings-nav-subgroup-label')?.textContent === '已停用')
    expect(thirdEnabled?.textContent).toContain('ThirdOn')
    expect(thirdDisabled?.textContent).toContain('ThirdOff')
    const navText = harness.parent.querySelector('nav')?.textContent ?? ''
    expect(navText).not.toContain('Future')
  })

  it('开关开启但故障暂停者留在已启用组并标注故障（不移入已停用）', () => {
    const harness = makeView()
    harness.dispatch(addonsState([
      { id: 'a.faulted', label: 'Broken', official: false, status: 'registered', enabled: true, fault: { reason: 'enable 异常：boom' } },
    ]))
    const sections = [...harness.parent.querySelectorAll('.vsidian-settings-nav-section')]
    const third = sections[2]
    const subgroups = [...(third?.querySelectorAll('.vsidian-settings-nav-subgroup') ?? [])]
    const enabledGroup = subgroups.find((g) => g.querySelector('.vsidian-settings-nav-subgroup-label')?.textContent === '已启用')
    const disabledGroup = subgroups.find((g) => g.querySelector('.vsidian-settings-nav-subgroup-label')?.textContent === '已停用')
    expect(enabledGroup?.textContent).toContain('Broken')
    expect(enabledGroup?.textContent).toContain('故障暂停')
    expect(disabledGroup?.textContent ?? '').not.toContain('Broken')
  })

  it('空清单时两大组呈现空态提示（分组结构不消失）', () => {
    const harness = makeView()
    harness.dispatch(addonsState([]))
    const sections = [...harness.parent.querySelectorAll('.vsidian-settings-nav-section')]
    expect(sections.length).toBe(3)
    expect(sections[1]?.querySelector('.vsidian-settings-nav-empty')?.textContent).toContain('暂无')
    expect(sections[2]?.querySelector('.vsidian-settings-nav-empty')?.textContent).toContain('暂无')
  })

  it('侧栏组件条目点击：进入附加组件分页、打开该组件设置区并定位列表行', () => {
    const harness = makeView()
    harness.dispatch(addonsState([
      { id: 'a.demo', label: 'Demo', official: false, status: 'registered', enabled: true, hasSettingsDefinitions: true },
    ]))
    const nav = harness.parent.querySelector('nav')
    const item = [...(nav?.querySelectorAll<HTMLButtonElement>('.vsidian-settings-nav-item') ?? [])].find((b) => b.textContent?.includes('Demo'))
    expect(item).toBeTruthy()
    item!.click()
    // 打开该组件基础设置区（停用后仍可配置——ADR Q23）
    expect(harness.sent).toContainEqual({ kind: 'addons.settingsOpen', addonId: 'a.demo' })
    // 列表行定位（located 类）
    const list = harness.parent.querySelector('.vsidian-addons-list')
    expect(list?.querySelector('.vsidian-settings-item-located .vsidian-settings-item-title')?.textContent).toContain('Demo')
  })

  it('无定义且无设置页的组件条目点击只定位列表行（不强开设置区）', () => {
    const harness = makeView()
    harness.dispatch(addonsState([
      { id: 'a.plain', label: 'Plain', official: false, status: 'registered', enabled: true },
    ]))
    const nav = harness.parent.querySelector('nav')
    const item = [...(nav?.querySelectorAll<HTMLButtonElement>('.vsidian-settings-nav-item') ?? [])].find((b) => b.textContent?.includes('Plain'))
    item!.click()
    expect(harness.sent.filter((m) => (m as { kind?: string }).kind === 'addons.settingsOpen')).toEqual([])
    expect(harness.parent.querySelector('.vsidian-addons-list .vsidian-settings-item-located')).toBeTruthy()
  })

  it('addons.state 推送后侧栏随之重建（分组数据实时）', () => {
    const harness = makeView()
    harness.dispatch(addonsState([]))
    let navText = harness.parent.querySelector('nav')?.textContent ?? ''
    expect(navText).not.toContain('Later')
    harness.dispatch(addonsState([
      { id: 'a.later', label: 'Later', official: false, status: 'registered', enabled: true },
    ]))
    navText = harness.parent.querySelector('nav')?.textContent ?? ''
    expect(navText).toContain('Later')
  })
})

// ---- #354 T05：故障排障入口（日志 + 手动重试；完整诊断归 T12） ----

describe('故障排障入口（T05）', () => {
  it('故障状态行提供「重试组件」按钮；点击上送 addons.retry', () => {
    const harness = makeView()
    openAddonsPage(harness)
    harness.dispatch(addonsState([
      { id: 'a.broken', label: 'Broken', official: false, status: 'registered', enabled: true, fault: { reason: 'enable 异常：boom' } },
    ]))
    const retry = [...harness.parent.querySelectorAll('button')].find((b) => b.textContent === '重试组件')
    expect(retry).toBeTruthy()
    retry!.click()
    expect(harness.sent).toContainEqual({ kind: 'addons.retry', addonId: 'a.broken' })
  })

  it('非故障组件行不提供重试按钮', () => {
    const harness = makeView()
    openAddonsPage(harness)
    harness.dispatch(addonsState([
      { id: 'a.ok', label: 'Ok', official: false, status: 'registered', enabled: true },
    ]))
    expect([...harness.parent.querySelectorAll('button')].some((b) => b.textContent === '重试组件')).toBe(false)
  })

  it('工具组提供「查看组件日志」入口；点击上送 addons.openLogs', () => {
    const harness = makeView()
    openAddonsPage(harness)
    harness.dispatch(addonsState([]))
    const logs = [...harness.parent.querySelectorAll('button')].find((b) => b.textContent === '查看组件日志')
    expect(logs).toBeTruthy()
    logs!.click()
    expect(harness.sent).toContainEqual({ kind: 'addons.openLogs' })
  })

  it('设置区故障态呈现排障块：标题、提示、原因、日志与重试入口', () => {
    const harness = makeView()
    openAddonsPage(harness)
    harness.dispatch(addonsState([
      { id: 'a.broken', label: 'Broken', official: false, status: 'registered', enabled: true, fault: { reason: 'setup 异常：bad' }, hasSettingsDefinitions: true },
    ]))
    // 打开设置区（宿主推送 addons.settingsState）
    const settingsState = {
      kind: 'addons.settingsState',
      apiVersion: '1.0.0',
      draft: true,
      open: 'a.broken',
      hasWorkspace: false,
      addon: {
        addonId: 'a.broken',
        label: 'Broken',
        faulted: true,
        faultReason: 'setup 异常：bad',
        hasCustomPage: false,
        enabled: { effective: true, userExplicit: true, workspaceExplicit: null, source: 'user' },
        definitions: [],
        values: {},
      },
      openAddonSettingsPage: null,
    }
    harness.dispatch(settingsState)
    const troubleshoot = harness.parent.querySelector('.vsidian-addons-fault-troubleshoot')
    expect(troubleshoot).toBeTruthy()
    const text = troubleshoot!.textContent ?? ''
    expect(text).toContain('组件故障暂停')
    expect(text).toContain('setup 异常：bad')
    const buttons = [...troubleshoot!.querySelectorAll('button')].map((b) => b.textContent)
    expect(buttons).toContain('查看组件日志')
    expect(buttons).toContain('重试组件')
  })
})
