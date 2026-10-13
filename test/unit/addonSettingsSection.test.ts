// @vitest-environment jsdom
// #350 T01 设置页「附加组件」分页呈现契约（#465 二轮起本页收敛为组件级
// 管理并**通道堵死**）：状态列表的用户可见文本（注册/唤醒/不兼容含声明范
// 围/激活失败含原因/当前宿主不可用不冒充未安装）、官方与第三方分组、空
// 态、API 版本草案标注、市场搜索与 VSCode 扩展管理按钮的消息上送、设置
// 类入口的跨分页导航（附加组件页不承载任何组件设置内容——守护契约）。
// 组件设置分页侧见 addonSettingsArea.test.ts；行为管理分页侧见
// addonBehaviorManageSection.test.ts。装配口径与生产 settingsMain.ts 同构。
import { describe, it, expect, vi } from 'vitest'
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
import { AddonBehaviorManageSection } from '../../src/webview/addonBehaviorManageSection'
import { AddonSettingsAreaSection, ADDON_SETTINGS_SECTION_ID } from '../../src/webview/addonSettingsAreaSection'

installLocale('zh-cn', zhCn)

function makeView(addonSettingsHost?: HTMLElement): {
  view: SettingsPageView
  addons: AddonSection
  behaviors: AddonBehaviorManageSection
  settingsArea: AddonSettingsAreaSection
  dispatch(message: unknown): void
  sent: unknown[]
  parent: HTMLElement
  /** 微任务收敛（生产 settingsMain 的导航回调同口径——见 wiring 注释） */
  settle(): Promise<void>
} {
  const sent: unknown[] = []
  const bridge = { postMessage: (m: unknown) => sent.push(m) }
  // #354 T05 侧栏联动中转（与生产 settingsMain 同构：分页经回调触发
  // 视图 refreshSidebar 重建侧栏大组）；#465 跨分页导航经微任务延迟
  // （navigate 回调在 mount 内触发时避免嵌套重渲染——生产同款）
  let refreshSidebar: () => void = () => {}
  let navigateToAddonSettings: () => void = () => {}
  const addons = new AddonSection(bridge, () => refreshSidebar(), () => navigateToAddonSettings())
  const behaviors = new AddonBehaviorManageSection(bridge)
  const settingsArea = new AddonSettingsAreaSection(bridge, addonSettingsHost)
  const view = new SettingsPageView(bridge, PRODUCTION_SETTING_DEFINITIONS,
    [
      new KeybindingSettingsSection(bridge),
      new AppearanceSection(new CssSnippetSettingsSection(bridge), new StyleReferenceSection(bridge)),
      new IndexMaintenanceSection(bridge),
      addons,
      behaviors,
      settingsArea,
    ],
    [], [])
  refreshSidebar = () => view.refreshSidebar()
  navigateToAddonSettings = () => queueMicrotask(() => view.selectSection(ADDON_SETTINGS_SECTION_ID))
  const parent = document.createElement('div')
  view.mount(parent)
  return {
    view, addons, behaviors, settingsArea, sent, parent,
    dispatch: (message: unknown) => {
      view.handleHostMessage(message)
      addons.handleHostMessage(message)
      behaviors.handleHostMessage(message)
      settingsArea.handleHostMessage(message)
    },
    settle: () => Promise.resolve(),
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

// ---- #465 二轮：通道堵死与跨分页导航（守护契约） ----

describe('附加组件分页：通道堵死与设置入口导航（#465）', () => {
  /** 构造打开指定组件基础设置区的 addons.settingsState 推送 */
  function settingsStatePush(harness: ReturnType<typeof makeView>, open: string | null): void {
    const message = {
      kind: 'addons.settingsState',
      apiVersion: '1.0.0',
      draft: true,
      open,
      hasWorkspace: false,
      addon: open === null ? null : {
        addonId: open,
        label: 'Demo',
        faulted: false,
        hasCustomPage: false,
        enabled: { effective: true, userExplicit: true, workspaceExplicit: null, source: 'user' },
        definitions: [
          { key: 'flag', title: '开关项', type: 'boolean', default: true },
          { key: 'replacements', title: '替换规则', type: 'array', items: { kind: 'string', maxLength: 10 }, default: ['旧→新'] },
          {
            key: 'limits', title: '对象样例', type: 'object',
            fields: [
              { key: 'name', title: '名称', kind: 'string', maxLength: 10, default: 'demo' },
              { key: 'count', title: '数量', kind: 'number', min: 0, max: 9, default: 3 },
            ],
          },
        ],
        values: {
          flag: { effective: true, source: 'default' },
          replacements: { effective: ['旧→新'], source: 'default' },
          limits: { effective: { name: 'demo', count: 3 }, source: 'default' },
        },
      },
      openAddonSettingsPage: null,
    }
    if (!isHostToWebview(message)) {
      throw new Error('addons.settingsState 载荷未通过协议守卫')
    }
    harness.dispatch(message)
  }

  it('守护契约：设置载荷在场时附加组件页仍恒为管理视图，不渲染任何组件设置内容', () => {
    const host = document.createElement('div')
    const harness = makeView(host)
    openAddonsPage(harness)
    harness.dispatch(addonsState([
      { id: 'fixture.demo', label: 'Demo', official: false, status: 'registered', enabled: true, hasSettingsDefinitions: true, hasSettingsPage: true },
    ], 'fixture.demo'))
    settingsStatePush(harness, 'fixture.demo')
    // 管理视图恒在场（启用开关与入口可见）
    expect(harness.parent.querySelector('.vsidian-addons-list')).not.toBeNull()
    expect(harness.parent.querySelector('.vsidian-addons-actions')).not.toBeNull()
    // 通道堵死：任何组件设置内容不得在本页渲染（基础设置区/挂载区/设置
    // 控件/作用范围标签一律缺席——组件设置分页承载）。数组/对象控件的
    // data 契约与 boolean 不同（data-addon-array-item / data-addon-field，
    // 均不带 data-addon-setting），须按族钉住；hub 清单同理不得回潮本页
    expect(harness.parent.querySelector('.vsidian-addons-settings')).toBeNull()
    expect(harness.parent.querySelector('.vsidian-addons-addonpage')).toBeNull()
    expect(harness.parent.querySelector('.vsidian-addons-scope-tabs')).toBeNull()
    expect(harness.parent.querySelector('.vsidian-addons-settings-hub')).toBeNull()
    expect(harness.parent.querySelector('[data-addon-setting]')).toBeNull()
    expect(harness.parent.querySelector('[data-addon-array-item]')).toBeNull()
    expect(harness.parent.querySelector('[data-addon-field]')).toBeNull()
    expect(harness.parent.querySelector('.vsidian-addons-array')).toBeNull()
    expect(harness.parent.querySelector('.vsidian-addons-object')).toBeNull()
    expect(harness.parent.querySelector('.vsidian-addons-clear-override')).toBeNull()
    // 同一载荷下「组件设置」分页正常承载（对侧正例——三族控件齐在场）
    harness.view.selectSection(ADDON_SETTINGS_SECTION_ID)
    expect(harness.parent.querySelector('.vsidian-addons-settings')).not.toBeNull()
    expect(harness.parent.querySelector('[data-addon-setting]')).not.toBeNull()
    expect(harness.parent.querySelector('[data-addon-array-item]')).not.toBeNull()
    expect(harness.parent.querySelector('[data-addon-field]')).not.toBeNull()
  })

  it('守护契约：本页不消费 addons.behaviors（行为区在独立分页呈现）', () => {
    const harness = makeView()
    openAddonsPage(harness)
    expect(harness.parent.querySelector('.vsidian-addons-behaviors')).toBeNull()
    expect(harness.parent.querySelector('[data-behavior-key]')).toBeNull()
  })

  it('行内「设置」入口：上送 settingsOpen 并导航到「组件设置」分页', async () => {
    const harness = makeView()
    openAddonsPage(harness)
    harness.dispatch(addonsState([
      { id: 'fixture.demo', label: 'Demo', official: false, status: 'registered', enabled: true, hasSettingsDefinitions: true },
    ]))
    const open = [...harness.parent.querySelectorAll('button')].find((b) => b.textContent === '设置')
    expect(open).toBeTruthy()
    open!.click()
    expect(harness.sent).toContainEqual({ kind: 'addons.settingsOpen', addonId: 'fixture.demo' })
    await harness.settle()
    expect(harness.parent.querySelector('.vsidian-settings-heading')?.textContent).toBe('组件设置')
    expect(harness.parent.querySelector('.vsidian-addons-list')).toBeNull()
  })

  it('行内「打开组件设置页」入口：上送 openAddonPage 并导航到「组件设置」分页', async () => {
    const harness = makeView()
    openAddonsPage(harness)
    harness.dispatch(addonsState([
      { id: 'fixture.demo', label: 'Demo', official: false, status: 'registered', enabled: true, hasSettingsPage: true },
    ]))
    const open = [...harness.parent.querySelectorAll('button')].find((b) => b.textContent === '打开组件设置页')
    expect(open).toBeTruthy()
    open!.click()
    expect(harness.sent).toContainEqual({ kind: 'addons.openAddonPage', addonId: 'fixture.demo' })
    await harness.settle()
    expect(harness.parent.querySelector('.vsidian-settings-heading')?.textContent).toBe('组件设置')
  })

  it('无设置能力组件不显示设置类入口（仅开关/详情/重试）', () => {
    const harness = makeView()
    openAddonsPage(harness)
    harness.dispatch(addonsState([
      { id: 'fixture.plain', label: 'Plain', official: false, status: 'registered', enabled: true },
    ]))
    const buttons = [...harness.parent.querySelectorAll('button')].map((b) => b.textContent)
    expect(buttons).not.toContain('设置')
    expect(buttons).not.toContain('打开组件设置页')
  })
})

// ---- #351 T02：运行生命周期（功能开关 / 故障态） ----

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

// ---- #354 T05：侧栏三组结构（选项 / 核心组件 / 第三方组件） ----

describe('设置页侧栏三组结构（T05）', () => {
  it('「选项」大组恒在场并收纳现有内置分页与附加组件域三个管理分页', () => {
    const harness = makeView()
    const nav = harness.parent.querySelector('nav')
    const optionsLabel = nav?.querySelector('.vsidian-settings-nav-group-label')
    expect(optionsLabel?.textContent).toBe('选项')
    const optionsSection = optionsLabel?.closest('.vsidian-settings-nav-section')
    // 现有内置分页（常规/编辑器/快捷键/外观/文件与链接/实验性功能）与
    // 附加组件域三分页（附加组件/输入行为管理/组件设置）都在「选项」大组内
    const itemTexts = [...(optionsSection?.querySelectorAll('.vsidian-settings-nav-item') ?? [])].map((b) => b.textContent)
    for (const expected of ['常规', '编辑器', '快捷键', '外观', '文件与链接', '实验性功能', '附加组件', '输入行为管理', '组件设置']) {
      expect(itemTexts.some((text) => text?.includes(expected))).toBe(true)
    }
    // 附加组件域三分页相邻且按约定顺序
    const ids = itemTexts.map((text) => text)
    expect(ids.indexOf('附加组件')).toBeLessThan(ids.indexOf('输入行为管理'))
    expect(ids.indexOf('输入行为管理')).toBeLessThan(ids.indexOf('组件设置'))
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

  it('侧栏可配置组件条目点击：打开设置区并导航到「组件设置」分页', async () => {
    const harness = makeView()
    harness.dispatch(addonsState([
      { id: 'a.demo', label: 'Demo', official: false, status: 'registered', enabled: true, hasSettingsDefinitions: true },
    ]))
    const nav = harness.parent.querySelector('nav')
    const item = [...(nav?.querySelectorAll<HTMLButtonElement>('.vsidian-settings-nav-item') ?? [])].find((b) => b.textContent?.includes('Demo'))
    expect(item).toBeTruthy()
    item!.click()
    // 打开该组件基础设置区（停用后仍可配置——ADR Q23）并离开本页
    expect(harness.sent).toContainEqual({ kind: 'addons.settingsOpen', addonId: 'a.demo' })
    await harness.settle()
    expect(harness.parent.querySelector('.vsidian-settings-heading')?.textContent).toBe('组件设置')
  })

  it('无定义且无设置页的组件条目点击只定位列表行（不导航、不强开设置区）', async () => {
    const harness = makeView()
    harness.dispatch(addonsState([
      { id: 'a.plain', label: 'Plain', official: false, status: 'registered', enabled: true },
    ]))
    const nav = harness.parent.querySelector('nav')
    const item = [...(nav?.querySelectorAll<HTMLButtonElement>('.vsidian-settings-nav-item') ?? [])].find((b) => b.textContent?.includes('Plain'))
    item!.click()
    expect(harness.sent.filter((m) => (m as { kind?: string }).kind === 'addons.settingsOpen')).toEqual([])
    await harness.settle()
    expect(harness.parent.querySelector('.vsidian-settings-heading')?.textContent).toBe('附加组件')
    // 定位落在条目行上（.vsidian-settings-item），容器本身不带 located
    const list = harness.parent.querySelector('.vsidian-addons-list')
    const locatedRow = harness.parent.querySelector('.vsidian-addons-list .vsidian-settings-item-located')
    expect(locatedRow).toBeTruthy()
    expect(locatedRow?.classList.contains('vsidian-settings-item')).toBe(true)
    expect(list?.classList.contains('vsidian-settings-item-located')).toBe(false)
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

// ---- #462：定位高亮层级互斥与一次性退场（纯运行组件 = 条目级唯一载体） ----

describe('定位高亮层级互斥与一次性退场（#462）', () => {
  function locatePlainBySidebar(harness: ReturnType<typeof makeView>): void {
    const nav = harness.parent.querySelector('nav')
    const item = [...(nav?.querySelectorAll<HTMLButtonElement>('.vsidian-settings-nav-item') ?? [])].find((b) => b.textContent?.includes('Plain'))
    expect(item).toBeTruthy()
    item!.click()
  }

  it('list 级定位：高亮落列表容器本身，不落到条目行（互斥另一半）', () => {
    const harness = makeView()
    harness.dispatch(addonsState([
      { id: 'a.plain', label: 'Plain', official: false, status: 'registered', enabled: true },
    ]))
    // 全局搜索命中「附加组件」list 入口 → render('list') 定位列表容器
    const search = harness.parent.querySelector<HTMLInputElement>('input.vsidian-settings-search')
    search!.value = '附加组件'
    search!.dispatchEvent(new Event('input', { bubbles: true }))
    const results = [...harness.parent.querySelectorAll<HTMLButtonElement>('.vsidian-settings-result')]
    const listEntry = results.find((b) => b.querySelector('strong')?.textContent === '附加组件')
    expect(listEntry).toBeTruthy()
    listEntry!.click()
    const list = harness.parent.querySelector('.vsidian-addons-list')
    expect(list?.classList.contains('vsidian-settings-item-located')).toBe(true)
    expect(list?.querySelector('.vsidian-settings-item-located')).toBeNull()
  })

  it('定位高亮一次性退场：约 1.5s 后摘除类，后续推送重渲染不再重现', () => {
    vi.useFakeTimers()
    try {
      const harness = makeView()
      harness.dispatch(addonsState([
        { id: 'a.plain', label: 'Plain', official: false, status: 'registered', enabled: true },
      ]))
      locatePlainBySidebar(harness)
      expect(harness.parent.querySelector('.vsidian-addons-list .vsidian-settings-item-located')).toBeTruthy()
      vi.advanceTimersByTime(1500)
      // 退场：已渲染的高亮类被摘除（定位态清空）
      expect(harness.parent.querySelector('.vsidian-addons-list .vsidian-settings-item-located')).toBeNull()
      // 此后推送重渲染不重现（locatedAddonId 已清，不再是持久标记）
      harness.dispatch(addonsState([
        { id: 'a.plain', label: 'Plain', official: false, status: 'registered', enabled: true },
      ]))
      expect(harness.parent.querySelector('.vsidian-addons-list .vsidian-settings-item-located')).toBeNull()
      expect(harness.parent.querySelector('.vsidian-addons-list')?.classList.contains('vsidian-settings-item-located')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('退场时限内的推送重渲染保持高亮且不叠容器描边；重新定位可再次呈现', () => {
    vi.useFakeTimers()
    try {
      const harness = makeView()
      harness.dispatch(addonsState([
        { id: 'a.plain', label: 'Plain', official: false, status: 'registered', enabled: true },
      ]))
      locatePlainBySidebar(harness)
      // 时限内的推送（定位后应答回灌）重渲染：条目行高亮保持，容器仍不带
      harness.dispatch(addonsState([
        { id: 'a.plain', label: 'Plain', official: false, status: 'registered', enabled: true },
      ]))
      const list = harness.parent.querySelector('.vsidian-addons-list')
      expect(list?.classList.contains('vsidian-settings-item-located')).toBe(false)
      expect(list?.querySelector('.vsidian-settings-item-located .vsidian-settings-item-title')?.textContent).toContain('Plain')
      vi.advanceTimersByTime(1500)
      expect(harness.parent.querySelector('.vsidian-addons-list .vsidian-settings-item-located')).toBeNull()
      // 再次显式定位：高亮重新呈现（一次性退场不清灭后续导航）
      locatePlainBySidebar(harness)
      expect(harness.parent.querySelector('.vsidian-addons-list .vsidian-settings-item-located')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })
})

// ---- #354 T05：故障排障入口（列表行重试 + 工具组日志） ----

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
})
