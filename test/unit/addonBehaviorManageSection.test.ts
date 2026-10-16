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
import { AddonThemesStore, ThemeSelectionSection } from '../../src/webview/themeSettings'
import { IndexMaintenanceSection } from '../../src/webview/indexMaintenanceSettings'
import { AddonSection } from '../../src/webview/addonSettingsSection'
import {
  AddonBehaviorManageSection,
  ADDONS_BEHAVIORS_SECTION_ID,
  type BehaviorManageToastChannel,
} from '../../src/webview/addonBehaviorManageSection'

installLocale('zh-cn', zhCn)

/** #474 toast stub：收集 show 调用（text + 可选撤销 action） */
type ToastCall = { text: string; action?: { label: string; onClick: () => void } }
function makeToast(): { toast: BehaviorManageToastChannel; calls: ToastCall[] } {
  const calls: ToastCall[] = []
  return {
    calls,
    toast: {
      show: (text: string, _severity?: 'neutral' | 'warning' | 'error', _key?: string,
        action?: { label: string; onClick: () => void }) => {
        calls.push({ text, action })
      },
    },
  }
}

function makeView(toast?: BehaviorManageToastChannel): {
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
  const behaviors = new AddonBehaviorManageSection(bridge, toast)
  const view = new SettingsPageView(bridge, PRODUCTION_SETTING_DEFINITIONS,
    [
      new KeybindingSettingsSection(bridge),
      new AppearanceSection(new CssSnippetSettingsSection(bridge), new StyleReferenceSection(bridge), new ThemeSelectionSection(new AddonThemesStore(), { postMessage: () => {} })),
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
    draft: false,
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

// ---- #474：分页 / 积木筛选 / 持久 / 定位 / 跨页调序 ----

/** #474 视图状态消息（addons.behaviorsView；先经协议守卫验证载荷形态） */
function behaviorsViewPayload(view: { page: number; query: unknown } | null): HostToWebview {
  const message = { kind: 'addons.behaviorsView', view }
  if (!isHostToWebview(message)) {
    throw new Error('addons.behaviorsView 载荷未通过协议守卫')
  }
  return message
}

/** #474 大列表 fixture：同一组件下的顺序行为（行为00..行为N-1） */
function manyBehaviors(count: number): Array<Record<string, unknown>> {
  return Array.from({ length: count }, (_, i) => ({
    addonId: ADDON_A,
    id: `behavior-${String(i).padStart(2, '0')}`,
    name: `行为${String(i).padStart(2, '0')}`,
    history: 'atomic',
  }))
}

/** 装配已就绪的 #474 场景：行为页打开、目录（count 行）与视图状态（默认
 *  无存储）都已到达——定位求值不再挂起 */
function setupPagedHarness(count: number, toast?: BehaviorManageToastChannel): ReturnType<typeof makeView> {
  const harness = makeView(toast)
  openBehaviorsPage(harness)
  harness.dispatch(addonsState([
    { id: ADDON_A, label: '组件甲', official: false, status: 'registered', enabled: true },
  ]))
  harness.dispatch(behaviorsPayload({ behaviors: manyBehaviors(count) }))
  harness.dispatch(behaviorsViewPayload(null))
  return harness
}

describe('#474 行为列表分页（D1–D3）', () => {
  it('45 行分 3 页：第 1 页 20 行 + 翻页五件套，首页/上一页禁用发灰', () => {
    const harness = setupPagedHarness(45)
    const rows = behaviorRows(harness)
    expect(rows).toHaveLength(20)
    const pager = harness.parent.querySelector('.vsidian-addons-behaviors-pager')!
    const buttons = [...pager.querySelectorAll<HTMLButtonElement>('.vsidian-addons-behaviors-pager-button')]
    expect(buttons.map((b) => b.textContent)).toEqual(['<<', '<', '>', '>>'])
    expect(buttons[0]!.disabled).toBe(true)
    expect(buttons[1]!.disabled).toBe(true)
    expect(buttons[2]!.disabled).toBe(false)
    expect(buttons[3]!.disabled).toBe(false)
    expect(pager.querySelector('.vsidian-addons-behaviors-pager-indicator')!.textContent).toBe('第 1 / 3 页')
    // aria 可读（翻页控件全套）
    expect(buttons[0]!.getAttribute('aria-label')).toBe('首页')
    expect(buttons[2]!.getAttribute('aria-label')).toBe('下一页')
  })

  it('翻页导航：下一页/末页跳转正确，末页按钮禁用；翻页上送视图持久', () => {
    const harness = setupPagedHarness(45)
    const buttons = [...harness.parent.querySelectorAll<HTMLButtonElement>('.vsidian-addons-behaviors-pager-button')]
    buttons[2]!.click() // >
    expect(behaviorRows(harness)).toHaveLength(20)
    expect(harness.parent.querySelector('.vsidian-addons-behaviors-pager-indicator')!.textContent).toBe('第 2 / 3 页')
    buttons[3]!.click() // >>
    expect(behaviorRows(harness)).toHaveLength(5)
    expect(harness.parent.querySelector('.vsidian-addons-behaviors-pager-indicator')!.textContent).toBe('第 3 / 3 页')
    const refreshed = [...harness.parent.querySelectorAll<HTMLButtonElement>('.vsidian-addons-behaviors-pager-button')]
    expect(refreshed[2]!.disabled).toBe(true)
    expect(refreshed[3]!.disabled).toBe(true)
    // 翻页写入跨重启视图持久（D11：页码变化整表写）
    expect(harness.sent).toContainEqual({
      kind: 'addons.behaviorsViewSet',
      view: { page: 3, query: null },
    })
  })

  it('不満一页（20 行以内）不渲染翻页控件（D3 自然阈值）', () => {
    const harness = setupPagedHarness(20)
    expect(behaviorRows(harness)).toHaveLength(20)
    expect(harness.parent.querySelector('.vsidian-addons-behaviors-pager')).toBeNull()
  })
})

describe('#474 积木筛选与视图持久（D5–D7/D11）', () => {
  it('恢复的查询过滤列表（按行为 ID 子串）：命中保持全序、页码回落第 1 页', () => {
    const harness = makeView()
    openBehaviorsPage(harness)
    harness.dispatch(addonsState([
      { id: ADDON_A, label: '组件甲', official: false, status: 'registered', enabled: true },
    ]))
    // 会话内恢复（restoreState 在 mount 前调用；页码越界 99 → 渲染时回落 1）
    harness.view.dispose()
    const harness2 = makeView()
    openBehaviorsPage(harness2)
    harness2.dispatch(addonsState([
      { id: ADDON_A, label: '组件甲', official: false, status: 'registered', enabled: true },
    ]))
    harness2.behaviors.restoreState({
      page: 99,
      query: { version: 1, blocks: [{ kind: 'field', field: 'behaviorId', text: 'behavior-4' }] },
    })
    harness2.dispatch(behaviorsPayload({ behaviors: manyBehaviors(50) }))
    harness2.dispatch(behaviorsViewPayload(null))
    // 'behavior-4' 子串命中 behavior-40..49（字典序升序，共 10 行）；页码回落第 1 页
    const rows = behaviorRows(harness2)
    expect(rows).toHaveLength(10)
    expect(rows[0]!.querySelector('.vsidian-settings-item-title')!.textContent).toBe('行为40')
    // 单页呈现（10 行无翻页控件）
    expect(harness2.parent.querySelector('.vsidian-addons-behaviors-pager')).toBeNull()
    void harness
  })

  it('跨重启视图状态应用（addons.behaviorsView 应答）：页码与查询生效', () => {
    const harness = makeView()
    openBehaviorsPage(harness)
    harness.dispatch(addonsState([
      { id: ADDON_A, label: '组件甲', official: false, status: 'registered', enabled: true },
    ]))
    harness.dispatch(behaviorsPayload({ behaviors: manyBehaviors(45) }))
    // 应答到达前：默认第 1 页全量渲染
    expect(behaviorRows(harness)).toHaveLength(20)
    harness.dispatch(behaviorsViewPayload({
      page: 2,
      query: { version: 1, blocks: [{ kind: 'field', field: 'behaviorName', text: '行为' }] },
    }))
    expect(behaviorRows(harness)).toHaveLength(20)
    expect(harness.parent.querySelector('.vsidian-addons-behaviors-pager-indicator')!.textContent).toBe('第 2 / 3 页')
  })

  it('会话内恢复优先于跨重启值：restoreState 后到达的 behaviorsView 不覆盖', () => {
    const harness = makeView()
    openBehaviorsPage(harness)
    harness.dispatch(addonsState([
      { id: ADDON_A, label: '组件甲', official: false, status: 'registered', enabled: true },
    ]))
    harness.behaviors.restoreState({ page: 1 })
    harness.dispatch(behaviorsPayload({ behaviors: manyBehaviors(45) }))
    harness.dispatch(behaviorsViewPayload({ page: 3, query: null }))
    expect(harness.parent.querySelector('.vsidian-addons-behaviors-pager-indicator')!.textContent).toBe('第 1 / 3 页')
  })

  it('查询编辑经构造器上抛：字段输入实时持久（query 变化整表写）', () => {
    const harness = setupPagedHarness(45)
    const input = harness.parent.querySelector<HTMLInputElement>('.vsidian-bq-field-input')
    // 无积木时无输入框——先经加号菜单新建字段积木（UI 真实路径）
    if (input === null) {
      harness.parent.querySelector<HTMLButtonElement>('.vsidian-behavior-query-add')!.click()
      const items = [...harness.parent.querySelectorAll<HTMLButtonElement>('.vsidian-bq-menu-item')]
      items[0]!.click() // 行为显示名
    }
    const field = harness.parent.querySelector<HTMLInputElement>('.vsidian-bq-field-input')!
    field.value = '行为4'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    expect(behaviorRows(harness)).toHaveLength(5) // 40-44
    expect(harness.sent).toContainEqual({
      kind: 'addons.behaviorsViewSet',
      view: { page: 1, query: { version: 1, blocks: [{ kind: 'field', field: 'behaviorName', text: '行为4' }] } },
    })
  })

  it('垃圾桶清空整个查询：toast 说明 + 气泡撤销恢复查询（D4/D14）', () => {
    const toastBox = makeToast()
    const harness = setupPagedHarness(45, toastBox.toast)
    // 经 UI 建立查询（行为显示名 = 行为4 → 5 行）
    harness.parent.querySelector<HTMLButtonElement>('.vsidian-behavior-query-add')!.click()
    const items = [...harness.parent.querySelectorAll<HTMLButtonElement>('.vsidian-bq-menu-item')]
    items[0]!.click()
    const field = harness.parent.querySelector<HTMLInputElement>('.vsidian-bq-field-input')!
    field.value = '行为4'
    field.dispatchEvent(new Event('input', { bubbles: true }))
    expect(behaviorRows(harness)).toHaveLength(5)
    // 无选中单击垃圾桶 = 清空整个查询
    harness.parent.querySelector<HTMLButtonElement>('.vsidian-behavior-query-trash')!.click()
    expect(behaviorRows(harness)).toHaveLength(20)
    expect(toastBox.calls.map((call) => call.text)).toEqual(['已清空筛选'])
    expect(toastBox.calls[0]!.action!.label).toBe('撤销')
    // 撤销：恢复清空前的查询树
    toastBox.calls[0]!.action!.onClick()
    expect(behaviorRows(harness)).toHaveLength(5)
  })
})

describe('#474 定位（D12–D15）', () => {
  it('row:完整键 定位：跳至行所在页并高亮该行（行优先，D12）', () => {
    const harness = setupPagedHarness(45)
    harness.view.selectSection(ADDONS_BEHAVIORS_SECTION_ID, `row:${ADDON_A}#behavior-42`)
    expect(harness.parent.querySelector('.vsidian-addons-behaviors-pager-indicator')!.textContent).toBe('第 3 / 3 页')
    const row = harness.parent.querySelector(`[data-behavior-key="${ADDON_A}#behavior-42"]`)!
    expect(row.classList.contains('vsidian-settings-item-located')).toBe(true)
  })

  it('page:n 定位：跳至指定页（D12）', () => {
    const harness = setupPagedHarness(45)
    harness.view.selectSection(ADDONS_BEHAVIORS_SECTION_ID, 'page:2')
    expect(harness.parent.querySelector('.vsidian-addons-behaviors-pager-indicator')!.textContent).toBe('第 2 / 3 页')
  })

  it('非法定位（页码越界 / 行键不在注册集）回落默认渲染 + toast（D13）', () => {
    const toastBox = makeToast()
    const harness = setupPagedHarness(45, toastBox.toast)
    harness.view.selectSection(ADDONS_BEHAVIORS_SECTION_ID, 'page:99')
    expect(harness.parent.querySelector('.vsidian-addons-behaviors-pager-indicator')!.textContent).toBe('第 1 / 3 页')
    harness.view.selectSection(ADDONS_BEHAVIORS_SECTION_ID, 'row:unknown.addon#nope')
    expect(toastBox.calls.map((call) => call.text)).toEqual([
      '未找到定位目标，已回到默认视图',
      '未找到定位目标，已回到默认视图',
    ])
  })

  it('D15：定位行被当前查询过滤 → 清空查询定位 + toast 说明 + 气泡撤销恢复查询与页码', () => {
    const toastBox = makeToast()
    const harness = makeView(toastBox.toast)
    openBehaviorsPage(harness)
    harness.dispatch(addonsState([
      { id: ADDON_A, label: '组件甲', official: false, status: 'registered', enabled: true },
    ]))
    harness.behaviors.restoreState({
      page: 1,
      query: { version: 1, blocks: [{ kind: 'field', field: 'behaviorId', text: 'behavior-00' }] },
    })
    harness.dispatch(behaviorsPayload({ behaviors: manyBehaviors(45) }))
    harness.dispatch(behaviorsViewPayload(null))
    // 定位行 behavior-42 被查询过滤：清空查询并定位（定位优先——跳至行
    // 所在第 3 页呈现该行，非回第 1 页）
    harness.view.selectSection(ADDONS_BEHAVIORS_SECTION_ID, `row:${ADDON_A}#behavior-42`)
    expect(behaviorRows(harness)).toHaveLength(5) // 第 3 页（40–44）
    expect(harness.parent.querySelector('.vsidian-addons-behaviors-pager-indicator')!.textContent).toBe('第 3 / 3 页')
    expect(harness.parent.querySelector(`[data-behavior-key="${ADDON_A}#behavior-42"]`)!.classList.contains('vsidian-settings-item-located')).toBe(true)
    expect(toastBox.calls).toHaveLength(1)
    expect(toastBox.calls[0]!.text).toBe('目标行为被当前筛选隐藏，已清空筛选以显示该行为')
    // 清空查询已持久（view query null）
    expect(harness.sent).toContainEqual({ kind: 'addons.behaviorsViewSet', view: { page: 1, query: null } })
    // 气泡撤销：恢复清空前的查询与页码
    toastBox.calls[0]!.action!.onClick()
    const rows = behaviorRows(harness)
    expect(rows).toHaveLength(1) // 查询恢复：只 behavior-00
    expect(rows[0]!.dataset.behaviorKey).toBe(`${ADDON_A}#behavior-00`)
  })

  it('定位挂起（D13）：载荷未齐时定位不消费，到达后统一求值', () => {
    const toastBox = makeToast()
    const harness = makeView(toastBox.toast)
    openBehaviorsPage(harness)
    harness.dispatch(addonsState([
      { id: ADDON_A, label: '组件甲', official: false, status: 'registered', enabled: true },
    ]))
    // mount 时定位（behaviors 已到但视图状态未到）——渲染默认态不弹 toast
    harness.view.selectSection(ADDONS_BEHAVIORS_SECTION_ID, 'page:99')
    expect(toastBox.calls).toHaveLength(0)
    expect(harness.parent.querySelector('.vsidian-addons-behaviors-list')).toBeNull() // 仍在读取中
    // 目录后到（重新 dispatch behaviors）但视图状态仍未到：仍不消费
    harness.dispatch(behaviorsPayload({ behaviors: manyBehaviors(45) }))
    expect(toastBox.calls).toHaveLength(0)
    // 视图状态到达：挂起定位统一求值（非法 → toast + 回落）
    harness.dispatch(behaviorsViewPayload(null))
    expect(toastBox.calls).toHaveLength(1)
    expect(harness.parent.querySelector('.vsidian-addons-behaviors-pager-indicator')!.textContent).toBe('第 1 / 3 页')
  })
})

describe('#474 跨页调序视图跟随（D10）', () => {
  it('第 2 页行上移跨页：回显后视图跟随该行跳回第 1 页并保持可见', () => {
    const harness = setupPagedHarness(45)
    // 跳到第 2 页
    const buttons = [...harness.parent.querySelectorAll<HTMLButtonElement>('.vsidian-addons-behaviors-pager-button')]
    buttons[2]!.click()
    expect(harness.parent.querySelector('.vsidian-addons-behaviors-pager-indicator')!.textContent).toBe('第 2 / 3 页')
    // 第 2 页首行（全序第 20 项 behavior-20）上移：与 behavior-19 交换
    const up = harness.parent.querySelector<HTMLButtonElement>('[data-behavior-move=up]')!
    up.click()
    // 宿主权威回显（新序）
    const behaviors = manyBehaviors(45) as Array<{ addonId: string; id: string; name: string; history: string }>
    const reordered = [...behaviors]
    ;[reordered[19], reordered[20]] = [reordered[20]!, reordered[19]!]
    harness.dispatch(behaviorsPayload({
      behaviors: reordered,
      state: { order: reordered.map((entry) => `${entry.addonId}#${entry.id}`) },
    }))
    // 视图跟随被移动行（behavior-20 现在全序第 19 位 = 第 1 页末尾）
    expect(harness.parent.querySelector('.vsidian-addons-behaviors-pager-indicator')!.textContent).toBe('第 1 / 3 页')
    const rows = behaviorRows(harness)
    expect(rows[19]!.dataset.behaviorKey).toBe(`${ADDON_A}#behavior-20`)
  })
})
