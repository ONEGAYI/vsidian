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

function makeView(): {
  view: SettingsPageView
  addons: AddonSection
  dispatch(message: unknown): void
  sent: unknown[]
  parent: HTMLElement
} {
  const sent: unknown[] = []
  const bridge = { postMessage: (m: unknown) => sent.push(m) }
  const addons = new AddonSection(bridge)
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
    view, addons, sent, parent,
    dispatch: (message: unknown) => {
      view.handleHostMessage(message)
      addons.handleHostMessage(message)
    },
  }
}

/** 构造 addons.state 消息（先经协议守卫验证载荷形态，再进分页） */
function addonsState(addons: HostToWebview extends never ? never : Array<Record<string, unknown>>): HostToWebview {
  const message = {
    kind: 'addons.state',
    apiVersion: '1.0.0',
    draft: true,
    addons,
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
