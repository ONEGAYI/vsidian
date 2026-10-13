// @vitest-environment jsdom
// #465/#466 输入行为管理独立分页（AddonBehaviorManageSection）——呈现与
// 交互契约：侧栏「选项」组导航项（「附加组件」之后）、页标题与副题（管理
// 语义）、组卡片头（已注册行为 + 图标槽）、展示全序（关闭项保位）、单项
// 开关与调序的上送形态、状态一致性（单项关闭 vs 整体停用/故障）、写操作
// 结局提示、全局搜索定位与 #464 多语言名称渲染。装配口径与生产
// settingsMain.ts 同构（附加组件页收敛为组件级管理后行为区不再在 'addons'
// 分页呈现——该侧契约见 addonSettingsSection.test.ts）。
import { describe, it, expect } from 'vitest'
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
import { IndexMaintenanceSection } from '../../src/webview/indexMaintenanceSettings'
import { AddonSection } from '../../src/webview/addonSettingsSection'
import { AddonBehaviorManageSection, ADDONS_BEHAVIORS_SECTION_ID } from '../../src/webview/addonBehaviorManageSection'

installLocale('zh-cn', zhCn)

function makeView(): {
  view: SettingsPageView
  addons: AddonSection
  behaviors: AddonBehaviorManageSection
  dispatch(message: unknown): void
  sent: unknown[]
  parent: HTMLElement
} {
  const sent: unknown[] = []
  const bridge = { postMessage: (m: unknown) => sent.push(m) }
  let refreshSidebar: () => void = () => {}
  const addons = new AddonSection(bridge, () => refreshSidebar())
  const behaviors = new AddonBehaviorManageSection(bridge)
  const view = new SettingsPageView(bridge, PRODUCTION_SETTING_DEFINITIONS,
    [
      new KeybindingSettingsSection(bridge),
      new AppearanceSection(new CssSnippetSettingsSection(bridge), new StyleReferenceSection(bridge)),
      new IndexMaintenanceSection(bridge),
      addons,
      behaviors,
    ],
    [], [])
  refreshSidebar = () => view.refreshSidebar()
  const parent = document.createElement('div')
  view.mount(parent)
  return {
    view, addons, behaviors, sent, parent,
    dispatch: (message: unknown) => {
      view.handleHostMessage(message)
      addons.handleHostMessage(message)
      behaviors.handleHostMessage(message)
    },
  }
}

function addonsState(addons: Array<Record<string, unknown>>): HostToWebview {
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

/** 构造 addons.behaviors 消息（先经协议守卫验证载荷形态，再进分页） */
function behaviorsPayload(payload: {
  behaviors?: Array<Record<string, unknown>>
  state?: { order?: string[]; disabled?: string[] } | null
  notice?: { kind: 'saved' | 'save-failed' }
}): HostToWebview {
  const message = {
    kind: 'addons.behaviors',
    behaviors: payload.behaviors ?? [],
    state: payload.state === undefined || payload.state === null
      ? null
      : { version: 1, order: payload.state.order ?? [], disabled: payload.state.disabled ?? [] },
    ...(payload.notice !== undefined ? { notice: payload.notice } : {}),
  }
  if (!isHostToWebview(message)) {
    throw new Error('addons.behaviors 载荷未通过协议守卫')
  }
  return message
}

const ADDON_A = 'vsidian-test-fixture.addon-a'
const ADDON_B = 'vsidian-test-fixture.addon-b'
const INFO_DASH = { addonId: ADDON_A, id: 'dash-fill', name: '破折填充', description: '输入 - 后补全——', examples: ['- |'], history: 'atomic' }
const INFO_SPACE = { addonId: ADDON_A, id: 'space-fill', name: '空格整理', history: 'atomic' }
const INFO_TILDE = { addonId: ADDON_B, id: 'tilde-fill', name: '波浪填充', history: 'atomic' }

function openBehaviorsPage(harness: ReturnType<typeof makeView>): void {
  harness.view.selectSection(ADDONS_BEHAVIORS_SECTION_ID)
}

function visibleText(root: HTMLElement): string {
  return root.textContent ?? ''
}

function behaviorRows(harness: ReturnType<typeof makeView>): HTMLElement[] {
  return [...harness.parent.querySelectorAll<HTMLElement>('.vsidian-addons-behaviors-row')]
}

describe('输入行为管理分页：IA 注册与页面结构（#465/#466）', () => {
  it('侧栏「选项」组注册「输入行为管理」导航项：位于「附加组件」之后并带图标槽', () => {
    const harness = makeView()
    const optionsSection = harness.parent.querySelector('.vsidian-settings-nav-section')!
    const items = [...optionsSection.querySelectorAll<HTMLButtonElement>('.vsidian-settings-nav-item')]
    const titles = items.map((button) => button.textContent)
    const addonsIndex = titles.findIndex((text) => text === '附加组件')
    const behaviorsIndex = titles.findIndex((text) => text === '输入行为管理')
    expect(addonsIndex).toBeGreaterThanOrEqual(0)
    expect(behaviorsIndex).toBeGreaterThan(addonsIndex)
    // 导航项带图标（aria-hidden 纯装饰不读屏）
    expect(items[behaviorsIndex]!.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('IA 分页：行为区只在独立分页呈现，附加组件页与行为页互不混装', () => {
    const harness = makeView()
    harness.view.selectSection('addons')
    expect(harness.parent.querySelector('.vsidian-addons-behaviors')).toBeNull()
    openBehaviorsPage(harness)
    expect(harness.parent.querySelector('.vsidian-addons-behaviors')).not.toBeNull()
    // 行为页不承载附加组件页的管理内容（状态列表/工具组）
    expect(harness.parent.querySelector('.vsidian-addons-list')).toBeNull()
    expect(harness.parent.querySelector('.vsidian-addons-actions')).toBeNull()
  })

  it('页面结构：页标题与副题（管理语义）、bare 装配、组卡片头挂卡片内并带图标', () => {
    const harness = makeView()
    openBehaviorsPage(harness)
    const heading = harness.parent.querySelector('.vsidian-settings-heading')!
    expect(heading.textContent).toBe('输入行为管理')
    const subtitle = harness.parent.querySelector('.vsidian-settings-subtitle')!
    // #466 副题为管理语义：说明默认依次触发、可调序/逐项关闭，关闭单项
    // 不停用整个组件
    expect(subtitle.textContent).toContain('依次触发')
    expect(subtitle.textContent).toContain('不会停用整个组件')
    // bare 装配（多组管理型分页先例）：组卡片直挂页面列表，不套大卡片
    expect(harness.parent.querySelector('.vsidian-settings-section-content')).toBeNull()
    expect(harness.parent.querySelector('.vsidian-settings-section-bare')).not.toBeNull()
    const area = harness.parent.querySelector('.vsidian-addons-behaviors')!
    const group = area.querySelector('.vsidian-settings-group')!
    expect(group.closest('.vsidian-settings-section-content')).toBeNull()
    // 组卡片头：已注册行为 + 图标槽（挂卡片内，不游离）
    const title = area.querySelector('.vsidian-settings-group-title')!
    expect(title.parentElement?.classList.contains('vsidian-settings-group')).toBe(true)
    expect(title.textContent).toContain('已注册行为')
    expect(title.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })

  it('全局搜索条目命中本分页分组（页名可检索）并定位行为区', () => {
    const harness = makeView()
    const search = harness.parent.querySelector<HTMLInputElement>('input.vsidian-settings-search')!
    search.value = '输入行为管理'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    const results = [...harness.parent.querySelectorAll<HTMLButtonElement>('.vsidian-settings-result')]
    const hit = results.find((button) => button.querySelector('strong')?.textContent === '输入行为管理')
    expect(hit).toBeTruthy()
    hit!.click()
    const area = harness.parent.querySelector('.vsidian-addons-behaviors')
    expect(area?.classList.contains('vsidian-settings-item-located')).toBe(true)
  })

  it('载荷未到达时呈现读取中；空目录呈现空态提示（打开文档后可管理）', () => {
    const harness = makeView()
    openBehaviorsPage(harness)
    const text = visibleText(harness.parent)
    expect(text).toContain('正在读取行为注册')
    expect(text).not.toContain('暂无已注册的输入行为')

    harness.dispatch(behaviorsPayload({}))
    expect(visibleText(harness.parent)).toContain('暂无已注册的输入行为')
  })
})

describe('输入行为管理分页：行为行呈现与交互（T08 契约延续）', () => {
  it('按展示全序渲染行为行：名称、所属组件与例子可见，说明/例子按需展开', () => {
    const harness = makeView()
    openBehaviorsPage(harness)
    harness.dispatch(addonsState([
      { id: ADDON_A, label: '组件甲', official: false, status: 'registered', enabled: true },
      { id: ADDON_B, label: '组件乙', official: false, status: 'registered', enabled: true },
    ]))
    harness.dispatch(behaviorsPayload({
      behaviors: [INFO_DASH, INFO_SPACE, INFO_TILDE],
      state: { order: [`${ADDON_B}#tilde-fill`] },
    }))
    const rows = behaviorRows(harness)
    expect(rows).toHaveLength(3)
    // 用户序把组件乙的波浪填充提前；其余按默认序（字典序 dash < space）
    const titles = rows.map((row) => row.querySelector('.vsidian-settings-item-title')!.textContent)
    expect(titles).toEqual(['波浪填充', '破折填充', '空格整理'])
    // 所属组件呈现显示名（用户不必掌握完整行为也能辨认调整对象）
    const owners = rows.map((row) => row.querySelector('.vsidian-addons-behaviors-owner')!.textContent)
    expect(owners).toEqual(['所属组件：组件乙', '所属组件：组件甲', '所属组件：组件甲'])
    // 说明/例子存在时按需展开（details 收起态）：内容在 DOM、默认不展开
    const dashDetails = rows[1]!.querySelector<HTMLDetailsElement>('details.vsidian-addons-behaviors-details')!
    expect(dashDetails.open).toBe(false)
    expect(dashDetails.textContent).toContain('输入 - 后补全——')
    expect(dashDetails.textContent).toContain('- |')
    // 未提供说明/例子的行为不渲染展开块
    expect(rows[2]!.querySelector('details')).toBeNull()
  })

  it('单项开关：取消勾选上送关闭、恢复勾选上送开启（键为行为完整键）', () => {
    const harness = makeView()
    openBehaviorsPage(harness)
    harness.dispatch(addonsState([
      { id: ADDON_A, label: '组件甲', official: false, status: 'registered', enabled: true },
    ]))
    harness.dispatch(behaviorsPayload({ behaviors: [INFO_DASH, INFO_SPACE] }))
    const rows = behaviorRows(harness)
    const dashToggle = rows[0]!.querySelector<HTMLInputElement>('input[type=checkbox][data-behavior-key]')!
    expect(dashToggle.checked).toBe(true)
    dashToggle.checked = false
    dashToggle.dispatchEvent(new Event('change'))
    expect(harness.sent).toContainEqual({
      kind: 'addons.behaviorsSetDisabled',
      keys: [`${ADDON_A}#dash-fill`],
      disabled: true,
    })
    dashToggle.checked = true
    dashToggle.dispatchEvent(new Event('change'))
    expect(harness.sent).toContainEqual({
      kind: 'addons.behaviorsSetDisabled',
      keys: [`${ADDON_A}#dash-fill`],
      disabled: false,
    })
  })

  it('调序：上移/下移上送可见全序新序列；首末按钮禁用（回显驱动）', () => {
    const harness = makeView()
    openBehaviorsPage(harness)
    harness.dispatch(addonsState([
      { id: ADDON_A, label: '组件甲', official: false, status: 'registered', enabled: true },
    ]))
    harness.dispatch(behaviorsPayload({ behaviors: [INFO_DASH, INFO_SPACE] }))
    const rows = behaviorRows(harness)
    const upButtons = rows.map((row) => row.querySelector<HTMLButtonElement>('[data-behavior-move=up]')!)
    const downButtons = rows.map((row) => row.querySelector<HTMLButtonElement>('[data-behavior-move=down]')!)
    expect(upButtons[0]!.disabled).toBe(true)
    expect(upButtons[1]!.disabled).toBe(false)
    expect(downButtons[0]!.disabled).toBe(false)
    expect(downButtons[1]!.disabled).toBe(true)
    upButtons[1]!.click()
    expect(harness.sent).toContainEqual({
      kind: 'addons.behaviorsSetOrder',
      order: [`${ADDON_A}#space-fill`, `${ADDON_A}#dash-fill`],
    })
    // 宿主权威回显（新序落地）后再次调序：按钮按回显后的全序计算
    harness.dispatch(behaviorsPayload({
      behaviors: [INFO_DASH, INFO_SPACE],
      state: { order: [`${ADDON_A}#space-fill`, `${ADDON_A}#dash-fill`] },
    }))
    const nextRows = behaviorRows(harness)
    nextRows[0]!.querySelector<HTMLButtonElement>('[data-behavior-move=down]')!.click()
    expect(harness.sent).toContainEqual({
      kind: 'addons.behaviorsSetOrder',
      order: [`${ADDON_A}#dash-fill`, `${ADDON_A}#space-fill`],
    })
  })

  it('状态一致性：单项关闭与整体停用徽章互相区分，配置行仍在', () => {
    const harness = makeView()
    openBehaviorsPage(harness)
    harness.dispatch(addonsState([
      { id: ADDON_A, label: '组件甲', official: false, status: 'registered', enabled: true },
      { id: ADDON_B, label: '组件乙', official: false, status: 'registered', enabled: false },
    ]))
    harness.dispatch(behaviorsPayload({
      behaviors: [INFO_DASH, INFO_TILDE],
      state: { disabled: [`${ADDON_A}#dash-fill`] },
    }))
    const rows = behaviorRows(harness)
    // 单项关闭：勾选态为假 + 「已关闭」徽章（区别于整组件停用）
    const dashToggle = rows[0]!.querySelector<HTMLInputElement>('input[type=checkbox][data-behavior-key]')!
    expect(dashToggle.checked).toBe(false)
    expect(rows[0]!.textContent).toContain('已关闭')
    expect(rows[0]!.textContent).not.toContain('组件已停用')
    // 整组件停用：徽章标注组件已停用，行为行与单项配置仍在（配置不丢）
    const tildeToggle = rows[1]!.querySelector<HTMLInputElement>('input[type=checkbox][data-behavior-key]')!
    expect(tildeToggle.checked).toBe(true)
    expect(rows[1]!.textContent).toContain('组件已停用')
    expect(rows[1]!.textContent).not.toContain('已关闭')
  })

  it('故障暂停徽章与单项关闭并存可辨（组件故障 ≠ 行为被关）', () => {
    const harness = makeView()
    openBehaviorsPage(harness)
    harness.dispatch(addonsState([
      { id: ADDON_A, label: '组件甲', official: false, status: 'registered', enabled: true, fault: { reason: 'setup 崩溃' } },
    ]))
    harness.dispatch(behaviorsPayload({
      behaviors: [INFO_DASH],
      state: { disabled: [`${ADDON_A}#dash-fill`] },
    }))
    const row = behaviorRows(harness)[0]!
    expect(row.textContent).toContain('已关闭')
    expect(row.textContent).toContain('故障暂停')
  })

  it('推送回显重排与徽章（宿主权威）：关闭项保位呈现', () => {
    const harness = makeView()
    openBehaviorsPage(harness)
    harness.dispatch(addonsState([
      { id: ADDON_A, label: '组件甲', official: false, status: 'registered', enabled: true },
    ]))
    harness.dispatch(behaviorsPayload({ behaviors: [INFO_DASH, INFO_SPACE] }))
    harness.dispatch(behaviorsPayload({
      behaviors: [INFO_DASH, INFO_SPACE],
      state: {
        order: [`${ADDON_A}#space-fill`, `${ADDON_A}#dash-fill`],
        disabled: [`${ADDON_A}#dash-fill`],
      },
    }))
    const rows = behaviorRows(harness)
    const titles = rows.map((row) => row.querySelector('.vsidian-settings-item-title')!.textContent)
    // 关闭项保留在原位（用户序内），管理列表仍呈现它
    expect(titles).toEqual(['空格整理', '破折填充'])
    expect(rows[1]!.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false)
  })

  it('写操作结局提示呈现（保存成功/失败），常规推送不残留', () => {
    const harness = makeView()
    openBehaviorsPage(harness)
    harness.dispatch(addonsState([
      { id: ADDON_A, label: '组件甲', official: false, status: 'registered', enabled: true },
    ]))
    harness.dispatch(behaviorsPayload({ behaviors: [INFO_DASH], notice: { kind: 'saved' } }))
    expect(visibleText(harness.parent)).toContain('行为设置已保存')
    harness.dispatch(behaviorsPayload({ behaviors: [INFO_DASH], notice: { kind: 'save-failed' } }))
    expect(visibleText(harness.parent)).toContain('行为设置保存失败')
    harness.dispatch(behaviorsPayload({ behaviors: [INFO_DASH] }))
    expect(visibleText(harness.parent)).not.toContain('行为设置已保存')
    expect(visibleText(harness.parent)).not.toContain('行为设置保存失败')
  })

  it('组件状态条目缺席时所属组件回退为组件 ID（目录滞后于 addons.state）', () => {
    const harness = makeView()
    openBehaviorsPage(harness)
    harness.dispatch(addonsState([]))
    harness.dispatch(behaviorsPayload({ behaviors: [INFO_TILDE] }))
    const owner = harness.parent.querySelector('.vsidian-addons-behaviors-owner')!
    expect(owner.textContent).toBe(`所属组件：${ADDON_B}`)
  })

  it('#464 多语言 name 按当前页面语言渲染：标题与三处 aria 同幅，换包后重渲染跟随', () => {
    // 复位 zh-cn（其他用例不换包，此处显式装配保证起点确定）
    installLocale('zh-cn', zhCn)
    const harness = makeView()
    openBehaviorsPage(harness)
    harness.dispatch(addonsState([
      { id: ADDON_A, label: '组件甲', official: false, status: 'registered', enabled: true },
    ]))
    harness.dispatch(behaviorsPayload({
      behaviors: [{
        addonId: ADDON_A,
        id: 'locale-name',
        name: { en: 'Localized name demo', 'zh-cn': '多语言名称示例' },
        history: 'atomic',
      }],
    }))
    // zh-cn 装配：标题取 zh-cn 值（映射形态透传到渲染时才选值）
    const titleOf = () =>
      harness.parent.querySelector('.vsidian-addons-behaviors-row .vsidian-settings-item-title')!.textContent
    expect(titleOf()).toBe('多语言名称示例')
    // 三处 aria 用同一 displayName（调序上移/下移与单项开关）
    const moveUp = harness.parent.querySelector<HTMLElement>('[data-behavior-move=up]')!
    const moveDown = harness.parent.querySelector<HTMLElement>('[data-behavior-move=down]')!
    const toggle = harness.parent.querySelector<HTMLElement>('input[type=checkbox][data-behavior-key]')!
    expect(moveUp.getAttribute('aria-label')).toContain('多语言名称示例')
    expect(moveDown.getAttribute('aria-label')).toContain('多语言名称示例')
    expect(toggle.getAttribute('aria-label')).toContain('多语言名称示例')
    expect(moveUp.getAttribute('aria-label')).not.toContain('Localized name demo')
    // 换包 en（installLocale 原子换包 → SettingsPageView.applyLocale → render
    // → 分页 mount 重入）：标题与 aria 就地跟随 en 值
    installLocale('en', en)
    expect(titleOf()).toBe('Localized name demo')
    const moveUpEn = harness.parent.querySelector<HTMLElement>('[data-behavior-move=up]')!
    const toggleEn = harness.parent.querySelector<HTMLElement>('input[type=checkbox][data-behavior-key]')!
    expect(moveUpEn.getAttribute('aria-label')).toContain('Localized name demo')
    expect(moveUpEn.getAttribute('aria-label')).not.toContain('多语言名称示例')
    expect(toggleEn.getAttribute('aria-label')).toContain('Localized name demo')
    // 复位 zh-cn（避免影响后续用例的 zh 装配假设）
    installLocale('zh-cn', zhCn)
  })

  it('#464 映射缺失当前语言键时回落 en（zh-cn 值缺席不空白）', () => {
    installLocale('zh-cn', zhCn)
    const harness = makeView()
    openBehaviorsPage(harness)
    harness.dispatch(addonsState([
      { id: ADDON_A, label: '组件甲', official: false, status: 'registered', enabled: true },
    ]))
    harness.dispatch(behaviorsPayload({
      behaviors: [{
        addonId: ADDON_A,
        id: 'en-only',
        name: { en: 'English only name' },
        history: 'atomic',
      }],
    }))
    const title = harness.parent.querySelector('.vsidian-addons-behaviors-row .vsidian-settings-item-title')!
    expect(title.textContent).toBe('English only name')
  })

  it('#467 单项开关推送回显：焦点回到同键开关，主区 scrollTop 保持', () => {
    const harness = makeView()
    document.body.append(harness.parent)
    try {
      openBehaviorsPage(harness)
      harness.dispatch(addonsState([
        { id: ADDON_A, label: '组件甲', official: false, status: 'registered', enabled: true },
      ]))
      const behaviorKey = `${ADDON_A}#dash-fill`
      const behaviorMessage = {
        kind: 'addons.behaviors',
        behaviors: [{ addonId: ADDON_A, id: 'dash-fill', name: '破折填充', history: 'atomic' }],
        state: null,
      }
      if (!isHostToWebview(behaviorMessage)) {
        throw new Error('addons.behaviors 载荷未通过协议守卫')
      }
      harness.dispatch(behaviorMessage)
      const main = harness.parent.querySelector<HTMLElement>('.vsidian-settings-main')!
      const toggle = harness.parent.querySelector<HTMLInputElement>(`input[data-behavior-key="${behaviorKey}"]`)!
      toggle.focus()
      main.scrollTop = 90
      toggle.click() // change → 上送 behaviorsSetDisabled；回显推送整块重建
      harness.dispatch({ ...behaviorMessage, state: { version: 1, order: [], disabled: [behaviorKey] } })
      expect(document.activeElement?.getAttribute('data-behavior-key')).toBe(behaviorKey)
      expect(main.scrollTop).toBe(90)
    } finally {
      harness.parent.remove()
      harness.view.dispose()
    }
  })
})
