// @vitest-environment jsdom
// #323 常规页「默认编辑器」委托组契约（wordSegmentSettings #264 同款形态，
// 落位常规页——委托组装配机制扩展后的首个常规页组）：
// 常规页组结构（标准行 + 委托组并存、守护键不以标准行重复呈现）、状态行
// 四形态展示（vsidian/builtin/other 可读名与反查回退/none）、守护开关回显
// 与标准保存链路、手动「设为默认」按钮禁用态与上送、defaultEditor.state
// 推送的就地更新（不重建开关行）、全局搜索归常规分组并定位组内块。
// 装配口径与生产 settingsMain.ts 同源（sections 三分页 + editorGroups 一组
// + generalGroups 一组）。
import { describe, it, expect } from 'vitest'
import { SettingsPageView, type SettingsPageDelegateGroup } from '../../src/webview/settingsPageView'
import { PRODUCTION_SETTING_DEFINITIONS, type SettingsPayload } from '../../src/shared/settings'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import { isHostToWebview, type HostToWebview } from '../../src/shared/protocol'
import { KeybindingSettingsSection } from '../../src/webview/keybindingSettings'
import { CssSnippetSettingsSection } from '../../src/webview/cssSnippetSettings'
import { StyleReferenceSection } from '../../src/webview/styleReferenceSettings'
import { AppearanceSection } from '../../src/webview/appearanceSettings'
import { IndexMaintenanceSection } from '../../src/webview/indexMaintenanceSettings'
import { WordSegmentSection } from '../../src/webview/wordSegmentSettings'
import {
  DefaultEditorSection,
  DEFAULT_EDITOR_SECTION_STATUS_ENTRY,
  DEFAULT_EDITOR_SECTION_GUARD_ENTRY,
} from '../../src/webview/defaultEditorSettings'

installLocale('zh-cn', zhCn)

/** 生产装配口径（settingsMain.ts 同构）：常规页一组委托 + 编辑器页尾分词组；
 *  dispatch 模拟 settingsMain 的 message listener——view 与两组各自消费同一条宿主消息 */
function makeProductionView(): {
  view: SettingsPageView
  defaultEditor: DefaultEditorSection
  dispatch(message: unknown): void
  sent: unknown[]
  parent: HTMLElement
} {
  const sent: unknown[] = []
  const bridge = { postMessage: (m: unknown) => sent.push(m) }
  const appearance = new AppearanceSection(
    new CssSnippetSettingsSection(bridge), new StyleReferenceSection(bridge))
  const wordSegment = new WordSegmentSection(bridge)
  const defaultEditor = new DefaultEditorSection(bridge)
  const view = new SettingsPageView(bridge, PRODUCTION_SETTING_DEFINITIONS,
    [new KeybindingSettingsSection(bridge), appearance, new IndexMaintenanceSection(bridge)],
    [wordSegment],
    [defaultEditor])
  const parent = document.createElement('div')
  view.mount(parent)
  return {
    view, defaultEditor, sent, parent,
    dispatch: (message: unknown) => {
      view.handleHostMessage(message)
      wordSegment.handleHostMessage(message)
      defaultEditor.handleHostMessage(message)
    },
  }
}

const groupTitles = (parent: HTMLElement): string[] =>
  [...parent.querySelectorAll('.vsidian-settings-group-title')].map((el) => el.textContent ?? '')

/** 点击侧栏导航项（按显示文本定位，生产注册表口径） */
function clickNav(parent: HTMLElement, title: string): void {
  const nav = [...parent.querySelectorAll<HTMLButtonElement>('.vsidian-settings-nav-item')]
    .find((b) => b.textContent === title)!
  nav.click()
}

/** 当前页正文里的「默认编辑器」组容器（常规页） */
function defaultEditorGroup(parent: HTMLElement): HTMLElement {
  const group = [...parent.querySelectorAll('.vsidian-settings-group')]
    .find((g) => g.querySelector('.vsidian-settings-group-title')?.textContent ===
      zhCn['defaultEditor.title'])
  expect(group, '常规页应渲染「默认编辑器」二级组').toBeTruthy()
  return group as HTMLElement
}

/** 模拟宿主下发 defaultEditor.state（经协议校验的正式形态） */
function pushState(
  section: DefaultEditorSection,
  state: Partial<Extract<HostToWebview, { kind: 'defaultEditor.state' }>> = {},
): void {
  const message: Extract<HostToWebview, { kind: 'defaultEditor.state' }> = {
    kind: 'defaultEditor.state',
    status: 'none',
    viewType: null,
    label: null,
    ...state,
  }
  expect(isHostToWebview(message)).toBe(true)
  section.handleHostMessage(message)
}

const hostValues = (values: Partial<SettingsPayload>): HostToWebview =>
  ({ kind: 'settings.snapshot', values }) as HostToWebview

describe('常规页委托组装配（#323）', () => {
  it('侧栏六项不变：「默认编辑器」组不占侧栏分页槽位（委托组不产生分页；#332 二轮文件与链接居实验性之前）', () => {
    const { parent } = makeProductionView()
    const titles = [...parent.querySelectorAll<HTMLButtonElement>('.vsidian-settings-nav-item')]
      .map((b) => b.textContent ?? '')
    expect(titles).toEqual([
      zhCn['settings.generalSection'],
      zhCn['settings.editorCategory'],
      zhCn['settings.filesLinksSection'],
      zhCn['settings.experimentalSection'],
      zhCn['keybindingSettings.title'],
      zhCn['appearance.title'],
    ])
  })

  it('常规页：标准行（界面语言）之后挂「默认编辑器」二级组，编辑器页不呈现该组', () => {
    const { parent } = makeProductionView()
    // 默认页即常规页：标准行 + 委托组并存
    expect(parent.querySelector('.vsidian-settings-heading')?.textContent)
      .toBe(zhCn['settings.generalSection'])
    const group = defaultEditorGroup(parent)
    // 组内不含标准设置行控件（呈现归组自绘，排除保留防重复）
    expect(group.querySelectorAll('[data-setting-key]')).toHaveLength(0)
    // 守护键不以标准行重复呈现：常规页全部 data-setting-key 里没有守护键
    const keys = [...parent.querySelectorAll('[data-setting-key]')]
      .map((el) => (el as HTMLElement).dataset.settingKey)
    expect(keys).not.toContain('general.defaultEditorGuard')
    // 切到编辑器页：组标题不含「默认编辑器」（组只挂常规页）
    clickNav(parent, zhCn['settings.editorCategory'])
    expect(groupTitles(parent)).toContain(zhCn['wordSegment.title'])
    expect(groupTitles(parent)).not.toContain(zhCn['defaultEditor.title'])
  })

  it('组结构：状态行（标签 + 状态文本 + 手动按钮）与守护开关行（标准行形态）', () => {
    const { parent } = makeProductionView()
    const group = defaultEditorGroup(parent)
    expect(group.querySelector('.vsidian-defedit-caption')?.textContent)
      .toBe(zhCn['defaultEditor.statusLabel'])
    expect(group.querySelector('.vsidian-defedit-status')?.getAttribute('role')).toBe('status')
    const buttons = [...group.querySelectorAll<HTMLButtonElement>('button')]
      .map((b) => b.textContent)
    expect(buttons).toContain(zhCn['defaultEditor.fixButton'])
    // 守护开关行复用标准行结构：标题 + 说明 + 复选开关
    expect(group.querySelector('.vsidian-settings-item-title')?.textContent)
      .toBe(zhCn['setting.defaultEditorGuard.title'])
    expect(group.querySelector('.vsidian-settings-item-description')?.textContent)
      .toBe(zhCn['setting.defaultEditorGuard.description'])
    expect(group.querySelector<HTMLInputElement>('.vsidian-settings-checkbox')).toBeTruthy()
  })

  it('组标题图标：shield 内联字形槽在文字前且纯装饰', () => {
    const { parent } = makeProductionView()
    const title = defaultEditorGroup(parent).querySelector('.vsidian-settings-group-title')!
    const svg = title.querySelector('svg')
    expect(svg, '组标题应带 shield 内联字形').toBeTruthy()
    expect(title.firstElementChild).toBe(svg)
    expect(svg!.getAttribute('aria-hidden')).toBe('true')
    expect(title.textContent).toBe(zhCn['defaultEditor.title'])
  })
})

describe('状态行四形态展示与推送更新', () => {
  it('初始未收到状态：显示读取中文案（不臆测形态）', () => {
    const { parent } = makeProductionView()
    expect(defaultEditorGroup(parent).querySelector('.vsidian-defedit-status')?.textContent)
      .toBe(zhCn['defaultEditor.statusPending'])
  })

  it('vsidian：状态文本为 Vsidian，手动按钮禁用', () => {
    const { defaultEditor, parent } = makeProductionView()
    pushState(defaultEditor, { status: 'vsidian' })
    const group = defaultEditorGroup(parent)
    expect(group.querySelector('.vsidian-defedit-status')?.textContent)
      .toBe(zhCn['defaultEditor.statusVsidian'])
    const fix = [...group.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent === zhCn['defaultEditor.fixButton'])!
    expect(fix.disabled, '已是我时手动按钮应禁用').toBe(true)
  })

  it('builtin：状态文本为内置文本编辑器（设置页自组句，不依赖宿主取词）', () => {
    const { defaultEditor, parent } = makeProductionView()
    pushState(defaultEditor, { status: 'builtin', viewType: 'default' })
    expect(defaultEditorGroup(parent).querySelector('.vsidian-defedit-status')?.textContent)
      .toBe(zhCn['defaultEditor.statusBuiltin'])
  })

  it('other：状态文本带可读名；反查失败回退关联值原文（label 即回退结果）', () => {
    const { defaultEditor, parent } = makeProductionView()
    pushState(defaultEditor, {
      status: 'other', viewType: 'cweijan.vscode-office.editor', label: 'Office Viewer',
    })
    expect(defaultEditorGroup(parent).querySelector('.vsidian-defedit-status')?.textContent)
      .toBe(zhCn['defaultEditor.statusOther'].replace('{name}', 'Office Viewer'))
    pushState(defaultEditor, {
      status: 'other', viewType: 'unknown.ext.editor', label: 'unknown.ext.editor',
    })
    expect(defaultEditorGroup(parent).querySelector('.vsidian-defedit-status')?.textContent)
      .toBe(zhCn['defaultEditor.statusOther'].replace('{name}', 'unknown.ext.editor'))
    const fix = [...defaultEditorGroup(parent).querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent === zhCn['defaultEditor.fixButton'])!
    expect(fix.disabled, '被抢占时手动按钮可用').toBe(false)
  })

  it('none：状态文本为无记录说明', () => {
    const { defaultEditor, parent } = makeProductionView()
    pushState(defaultEditor, { status: 'none' })
    expect(defaultEditorGroup(parent).querySelector('.vsidian-defedit-status')?.textContent)
      .toBe(zhCn['defaultEditor.statusNone'])
  })

  it('defaultEditor.state 推送就地更新状态块：开关行 DOM 不重建（无焦点丢失），视觉顺序恒定', () => {
    const { defaultEditor, parent } = makeProductionView()
    const group0 = defaultEditorGroup(parent)
    const checkbox = group0.querySelector<HTMLInputElement>('.vsidian-settings-checkbox')!
    pushState(defaultEditor, { status: 'other', viewType: 'x.editor', label: 'X' })
    const group = defaultEditorGroup(parent)
    const after = group.querySelector<HTMLInputElement>('.vsidian-settings-checkbox')!
    expect(after).toBe(checkbox)
    expect(group.querySelector('.vsidian-defedit-status')?.textContent)
      .toBe(zhCn['defaultEditor.statusOther'].replace('{name}', 'X'))
    // 状态块重建后仍在开关行之前（追加顺序不因重建漂移）
    const children = [...group.children]
    expect(children.indexOf(group.querySelector('.vsidian-defedit-block')!))
      .toBeLessThan(children.indexOf(group.querySelector('.vsidian-settings-item')!))
  })

  it('切页后状态推送不再写入（组已卸载、无悬挂写入）', () => {
    const { defaultEditor, parent } = makeProductionView()
    clickNav(parent, zhCn['settings.editorCategory'])
    expect(() => pushState(defaultEditor, { status: 'vsidian' })).not.toThrow()
    expect(parent.querySelectorAll('.vsidian-defedit-status')).toHaveLength(0)
  })
})

describe('守护开关回显与生效（标准保存链路）', () => {
  it('默认开：无快照值时开关选中（注册表默认 true 回退）', () => {
    const { parent } = makeProductionView()
    expect(defaultEditorGroup(parent)
      .querySelector<HTMLInputElement>('.vsidian-settings-checkbox')!.checked).toBe(true)
  })

  it('settings.snapshot 回显：关闭后开关就地取消选中（不重建）', () => {
    const { dispatch, parent } = makeProductionView()
    const checkbox = defaultEditorGroup(parent)
      .querySelector<HTMLInputElement>('.vsidian-settings-checkbox')!
    dispatch(hostValues({ 'general.defaultEditorGuard': false }))
    expect(checkbox.checked).toBe(false)
    dispatch(hostValues({ 'general.defaultEditorGuard': true }))
    expect(checkbox.checked).toBe(true)
  })

  it('点击开关上送标准 settings.set（键名与注册表一致）', () => {
    const { sent, parent } = makeProductionView()
    const checkbox = defaultEditorGroup(parent)
      .querySelector<HTMLInputElement>('.vsidian-settings-checkbox')!
    checkbox.checked = false
    checkbox.dispatchEvent(new Event('change'))
    expect(sent).toContainEqual({
      kind: 'settings.set',
      values: { 'general.defaultEditorGuard': false },
    })
  })

  it('开关切换不影响状态行与手动按钮（三者独立呈现）', () => {
    const { defaultEditor, dispatch, parent } = makeProductionView()
    pushState(defaultEditor, { status: 'vsidian' })
    dispatch(hostValues({ 'general.defaultEditorGuard': false }))
    const group = defaultEditorGroup(parent)
    expect(group.querySelector('.vsidian-defedit-status')?.textContent)
      .toBe(zhCn['defaultEditor.statusVsidian'])
    const fix = [...group.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent === zhCn['defaultEditor.fixButton'])!
    expect(fix.disabled).toBe(true)
  })
})

describe('手动「设为默认」按钮闭环', () => {
  it('被抢占时点击上送 defaultEditor.fix（走守护修复链路同一通道）', () => {
    const { sent, parent } = makeProductionView()
    const fix = [...defaultEditorGroup(parent).querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent === zhCn['defaultEditor.fixButton'])!
    fix.click()
    expect(sent).toContainEqual({ kind: 'defaultEditor.fix' })
  })

  it('已是我时点击不上送（禁用态：jsdom 对 disabled 按钮不派发 click）', () => {
    const { defaultEditor, sent, parent } = makeProductionView()
    pushState(defaultEditor, { status: 'vsidian' })
    const fix = [...defaultEditorGroup(parent).querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent === zhCn['defaultEditor.fixButton'])!
    expect(fix.disabled).toBe(true)
    fix.click()
    expect(sent).not.toContainEqual({ kind: 'defaultEditor.fix' })
  })

  it('修复成功闭环：点击后宿主推送 vsidian 形态，状态行即时更新、按钮转禁用', () => {
    const { defaultEditor, sent, parent } = makeProductionView()
    pushState(defaultEditor, { status: 'other', viewType: 'x.editor', label: 'X' })
    const fix = [...defaultEditorGroup(parent).querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent === zhCn['defaultEditor.fixButton'])!
    fix.click()
    expect(sent).toContainEqual({ kind: 'defaultEditor.fix' })
    // 宿主 fixNow 完成后经 defaultEditor.state 推送新形态
    pushState(defaultEditor, { status: 'vsidian' })
    const group = defaultEditorGroup(parent)
    expect(group.querySelector('.vsidian-defedit-status')?.textContent)
      .toBe(zhCn['defaultEditor.statusVsidian'])
    expect([...group.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent === zhCn['defaultEditor.fixButton'])!.disabled).toBe(true)
  })
})

describe('全局搜索与定位（#323 常规页委托组归常规分组）', () => {
  it('搜索「守护」命中守护开关条目归常规分组，点击进常规页并定位开关行', () => {
    const { parent } = makeProductionView()
    const search = parent.querySelector<HTMLInputElement>('input[type=search]')!
    search.value = '守护'
    search.dispatchEvent(new Event('input'))
    const result = [...parent.querySelectorAll<HTMLButtonElement>('.vsidian-settings-result')]
      .find((b) => (b.textContent ?? '').includes(zhCn['setting.defaultEditorGuard.title']))
    expect(result, '守护开关条目应命中搜索').toBeTruthy()
    expect(result!.querySelector('.vsidian-settings-result-category')?.textContent)
      .toBe(zhCn['settings.generalSection'])
    result!.click()
    expect(parent.querySelector('.vsidian-settings-heading')?.textContent)
      .toBe(zhCn['settings.generalSection'])
    const item = defaultEditorGroup(parent).querySelector('.vsidian-settings-item')!
    expect(item.classList.contains('vsidian-settings-item-located')).toBe(true)
  })

  it('搜索「默认编辑器」命中状态行条目并定位状态块', () => {
    const { parent } = makeProductionView()
    const search = parent.querySelector<HTMLInputElement>('input[type=search]')!
    search.value = '默认编辑器'
    search.dispatchEvent(new Event('input'))
    const result = [...parent.querySelectorAll<HTMLButtonElement>('.vsidian-settings-result')]
      .find((b) => (b.textContent ?? '').includes(zhCn['defaultEditor.statusLabel']))
    expect(result, '状态行条目应命中搜索').toBeTruthy()
    expect(result!.querySelector('.vsidian-settings-result-category')?.textContent)
      .toBe(zhCn['settings.generalSection'])
    result!.click()
    const block = defaultEditorGroup(parent).querySelector('.vsidian-defedit-block')!
    expect(block.classList.contains('vsidian-settings-item-located')).toBe(true)
  })

  it('契约字段：entries 两项（status/guard）且无 legacySectionId（新组无退役分页）', () => {
    const { defaultEditor } = makeProductionView()
    expect(defaultEditor.entries.map((e) => e.id))
      .toEqual([DEFAULT_EDITOR_SECTION_STATUS_ENTRY, DEFAULT_EDITOR_SECTION_GUARD_ENTRY])
    // 接口可选成员经接口类型读取（类上未声明即缺省——新组不设兼容路由）
    const asGroup = defaultEditor as unknown as SettingsPageDelegateGroup
    expect(asGroup.legacySectionId).toBeUndefined()
    expect(defaultEditor.titleKey).toBe('defaultEditor.title')
  })
})
