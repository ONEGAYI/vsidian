// @vitest-environment jsdom
// T08（#357）行为冲突管理——设置页「附加组件」分页的呈现与交互契约：
// 用户可见文本（名称、所属组件、徽章、提示）、展示全序（关闭项保位）、
// 单项开关与调序的上送形态、状态一致性（单项关闭 vs 整体停用/故障）、
// 写操作结局提示与全局搜索定位。装配口径与生产 settingsMain.ts 同构
// （复用 addonSettingsSection.test.ts 的 makeView 形态）。
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

function makeView(): {
  view: SettingsPageView
  addons: AddonSection
  dispatch(message: unknown): void
  sent: unknown[]
  parent: HTMLElement
} {
  const sent: unknown[] = []
  const bridge = { postMessage: (m: unknown) => sent.push(m) }
  let refreshSidebar: () => void = () => {}
  const addons = new AddonSection(bridge, undefined, () => refreshSidebar())
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

function openAddonsPage(harness: ReturnType<typeof makeView>): void {
  harness.view.selectSection('addons')
}

function visibleText(root: HTMLElement): string {
  return root.textContent ?? ''
}

function behaviorRows(harness: ReturnType<typeof makeView>): HTMLElement[] {
  return [...harness.parent.querySelectorAll<HTMLElement>('.vsidian-addons-behaviors-row')]
}

describe('行为冲突管理（T08）', () => {
  it('载荷未到达时呈现组标题与读取中；空目录呈现空态提示（打开文档后可管理）', () => {
    const harness = makeView()
    openAddonsPage(harness)
    const text = visibleText(harness.parent)
    expect(text).toContain('行为冲突管理')
    expect(text).toContain('正在读取行为注册')
    expect(text).not.toContain('暂无已注册的输入行为')

    harness.dispatch(behaviorsPayload({}))
    expect(visibleText(harness.parent)).toContain('暂无已注册的输入行为')
  })

  it('按展示全序渲染行为行：名称、所属组件与例子可见，说明/例子按需展开', () => {
    const harness = makeView()
    openAddonsPage(harness)
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
    openAddonsPage(harness)
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
    openAddonsPage(harness)
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
    openAddonsPage(harness)
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
    openAddonsPage(harness)
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
    openAddonsPage(harness)
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
    openAddonsPage(harness)
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

  it('全局搜索入口可定位行为冲突管理组（条目命中后跳转定位）', () => {
    const harness = makeView()
    openAddonsPage(harness)
    const entry = harness.addons.entries.find((e) => e.id === 'behaviors')
    expect(entry?.title).toBe('行为冲突管理')
    harness.view.selectSection('addons', 'behaviors')
    const group = harness.parent.querySelector('.vsidian-addons-behaviors')
    expect(group?.classList.contains('vsidian-settings-item-located')).toBe(true)
  })

  it('组件状态条目缺席时所属组件回退为组件 ID（目录滞后于 addons.state）', () => {
    const harness = makeView()
    openAddonsPage(harness)
    harness.dispatch(addonsState([]))
    harness.dispatch(behaviorsPayload({ behaviors: [INFO_TILDE] }))
    const owner = harness.parent.querySelector('.vsidian-addons-behaviors-owner')!
    expect(owner.textContent).toBe(`所属组件：${ADDON_B}`)
  })
})
