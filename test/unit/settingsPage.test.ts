// @vitest-environment jsdom
// 设置页 UI 契约（#33）：页面归属 Vsidian（标题）、空状态（无占位开关）、
// fixture 定义渲染、快照回显、变更上送（settings.set）与权威值恢复
// （宿主拒绝后以 settings.snapshot 回滚显示）。
// #93 起：框架标题经 t() 取词——本文件装配生产 zh-cn 语言包（装配三径之
// 单测注入），断言与字典同源（不再复制字面量）。#95 起设置项定义经
// titleKey/descriptionKey 取词，fixture 定义复用生产词条键。
import { describe, it, expect } from 'vitest'
import {
  SettingsPageView,
  SETTINGS_PAGE_CLASS_NAMES,
} from '../../src/webview/settingsPageView'
import { PRODUCTION_SETTING_DEFINITIONS, type SettingDefinition } from '../../src/shared/settings'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import { AppearanceSection } from '../../src/webview/appearanceSettings'
import { CssSnippetSettingsSection } from '../../src/webview/cssSnippetSettings'
import { StyleReferenceSection } from '../../src/webview/styleReferenceSettings'
import { KeybindingSettingsSection } from '../../src/webview/keybindingSettings'
import { IndexMaintenanceSection } from '../../src/webview/indexMaintenanceSettings'
import { STYLE_GUIDE_ENTRIES } from '../../src/webview/styleGuideData'

installLocale('zh-cn', zhCn)

const FIXTURE_DEFS: readonly SettingDefinition[] = [
  {
    key: 'editor.lineNumbers',
    type: 'boolean',
    default: false,
    titleKey: 'setting.editorLineNumbers.title',
    descriptionKey: 'setting.editorLineNumbers.description',
  },
  { key: 'editor.spellcheck', type: 'boolean', default: true, titleKey: 'setting.testFlag.title' },
]

function makeView(defs: readonly SettingDefinition[]): {
  view: SettingsPageView
  sent: unknown[]
  parent: HTMLElement
} {
  const sent: unknown[] = []
  const view = new SettingsPageView({ postMessage: (m) => sent.push(m) }, defs)
  const parent = document.createElement('div')
  view.mount(parent)
  return { view, sent, parent }
}

/** 点击侧栏导航项（按显示文本定位，生产注册表口径） */
function clickNav(parent: HTMLElement, title: string): void {
  const nav = [...parent.querySelectorAll<HTMLButtonElement>('.vsidian-settings-nav-item')]
    .find((b) => b.textContent === title)!
  nav.click()
}

/** 编辑器页内的组内标题小节容器（#163 二轮还原：编辑器页按小节分容器） */
function sectionByTitle(parent: HTMLElement, title: string): HTMLElement {
  const group = [...parent.querySelectorAll('.vsidian-settings-group')]
    .find((g) => g.querySelector('.vsidian-settings-group-title')?.textContent === title)
  expect(group, `应渲染「${title}」小节`).toBeTruthy()
  return group as HTMLElement
}

describe('页面结构（#33 归属与空状态）', () => {
  it('标题经 t() 取词：与字典 settings.pageTitle 同源（#93）', () => {
    const { parent } = makeView(FIXTURE_DEFS)
    const title = parent.querySelector(`.${SETTINGS_PAGE_CLASS_NAMES.title}`)
    expect(title?.textContent).toBe(zhCn['settings.pageTitle'])
    expect(title?.textContent).toContain('Vsidian')
    expect(title?.textContent).toContain('设置')
  })

  it('空定义表渲染空状态，不出现任何开关（渲染层空状态路径）', () => {
    const { parent } = makeView([])
    const empty = parent.querySelector(`.${SETTINGS_PAGE_CLASS_NAMES.empty}`)
    expect(empty, '应渲染空状态元素').toBeTruthy()
    expect(empty!.textContent).toBe(zhCn['settings.empty'])
    expect(parent.querySelectorAll('input')).toHaveLength(0)
    expect(parent.querySelectorAll('button')).toHaveLength(0)
  })

  it('生产注册表（#34 起）渲染真实开关：显示行号在「显示」小节、默认勾选', () => {
    // #34：首个实际设置项接入后设置页不再是空状态——注册表追加定义即
    // 出现开关（#33 设计的预期演进），此处以生产定义直测渲染结果。
    // #96 起注册表含「界面语言」（string 枚举），设置页新增「常规」分组
    // 且默认显示之——开关断言先切到「编辑器」分组
    expect(PRODUCTION_SETTING_DEFINITIONS.length).toBeGreaterThan(0)
    const { parent } = makeView(PRODUCTION_SETTING_DEFINITIONS)
    expect(parent.querySelector(`.${SETTINGS_PAGE_CLASS_NAMES.empty}`)).toBeNull()
    // 默认分组 = 常规（首个分类）：语言项可见，无开关
    expect(parent.querySelector(`select.${SETTINGS_PAGE_CLASS_NAMES.select}`)).toBeTruthy()
    clickNav(parent, zhCn['settings.editorCategory'])
    // #163 验收反馈二轮还原：分类收敛回侧栏两组，编辑器页内按小节分容器——
    // 「显示」小节承载行号开关（其余小节见「分组重组」describe）
    const display = sectionByTitle(parent, zhCn['settings.groupDisplay'])
    const first = display.querySelector(`.${SETTINGS_PAGE_CLASS_NAMES.itemTitle}`)
    expect(first?.textContent).toBe(zhCn['setting.editorLineNumbers.title'])
    const box = display.querySelector<HTMLInputElement>(`input.${SETTINGS_PAGE_CLASS_NAMES.checkbox}`)!
    expect(box.checked).toBe(true) // 默认开启
  })

  it('符号选区包裹（#124）渲染于编辑器页符号输入小节：标题/说明经 t() 取词、默认勾选', () => {
    const { parent } = makeView(PRODUCTION_SETTING_DEFINITIONS)
    clickNav(parent, zhCn['settings.editorCategory'])
    const item = [...sectionByTitle(parent, zhCn['settings.groupSymbols'])
      .querySelectorAll<HTMLElement>(`.${SETTINGS_PAGE_CLASS_NAMES.item}`)]
      .find((el) => el.querySelector(`.${SETTINGS_PAGE_CLASS_NAMES.itemTitle}`)?.textContent ===
        zhCn['setting.symbolSelectionWrap.title'])
    expect(item, '应渲染「选区符号包裹」设置行').toBeTruthy()
    expect(item!.querySelector(`.${SETTINGS_PAGE_CLASS_NAMES.itemDescription}`)?.textContent)
      .toBe(zhCn['setting.symbolSelectionWrap.description'])
    expect(item!.querySelector<HTMLInputElement>(`input.${SETTINGS_PAGE_CLASS_NAMES.checkbox}`)!.checked)
      .toBe(true)
  })

  it('符号自动补全（#123）渲染于编辑器页符号输入小节：标题/说明经 t() 取词、默认勾选', () => {
    const { parent } = makeView(PRODUCTION_SETTING_DEFINITIONS)
    clickNav(parent, zhCn['settings.editorCategory'])
    const item = [...sectionByTitle(parent, zhCn['settings.groupSymbols'])
      .querySelectorAll<HTMLElement>(`.${SETTINGS_PAGE_CLASS_NAMES.item}`)]
      .find((el) => el.querySelector(`.${SETTINGS_PAGE_CLASS_NAMES.itemTitle}`)?.textContent ===
        zhCn['setting.symbolAutocomplete.title'])
    expect(item, '应渲染「符号自动补全」设置行').toBeTruthy()
    expect(item!.querySelector(`.${SETTINGS_PAGE_CLASS_NAMES.itemDescription}`)?.textContent)
      .toBe(zhCn['setting.symbolAutocomplete.description'])
    expect(item!.querySelector<HTMLInputElement>(`input.${SETTINGS_PAGE_CLASS_NAMES.checkbox}`)!.checked)
      .toBe(true)
  })

  it('符号 Tab 越界（#125）渲染于编辑器页符号输入小节：标题/说明经 t() 取词、默认勾选', () => {
    const { parent } = makeView(PRODUCTION_SETTING_DEFINITIONS)
    clickNav(parent, zhCn['settings.editorCategory'])
    const item = [...sectionByTitle(parent, zhCn['settings.groupSymbols'])
      .querySelectorAll<HTMLElement>(`.${SETTINGS_PAGE_CLASS_NAMES.item}`)]
      .find((el) => el.querySelector(`.${SETTINGS_PAGE_CLASS_NAMES.itemTitle}`)?.textContent ===
        zhCn['setting.symbolTabEscape.title'])
    expect(item, '应渲染「符号 Tab 越界」设置行').toBeTruthy()
    expect(item!.querySelector(`.${SETTINGS_PAGE_CLASS_NAMES.itemDescription}`)?.textContent)
      .toBe(zhCn['setting.symbolTabEscape.description'])
    expect(item!.querySelector<HTMLInputElement>(`input.${SETTINGS_PAGE_CLASS_NAMES.checkbox}`)!.checked)
      .toBe(true)
  })
})

describe('定义渲染与快照回显', () => {
  it('fixture 定义渲染为带标题的复选行，默认值生效', () => {
    const { parent } = makeView(FIXTURE_DEFS)
    const items = parent.querySelectorAll(`.${SETTINGS_PAGE_CLASS_NAMES.item}`)
    expect(items).toHaveLength(2)
    const first = items[0]!
    expect(first.querySelector(`.${SETTINGS_PAGE_CLASS_NAMES.itemTitle}`)?.textContent)
      .toBe(zhCn['setting.editorLineNumbers.title'])
    expect(first.querySelector(`.${SETTINGS_PAGE_CLASS_NAMES.itemDescription}`)?.textContent)
      .toBe(zhCn['setting.editorLineNumbers.description'])
    const boxes = parent.querySelectorAll<HTMLInputElement>(`input.${SETTINGS_PAGE_CLASS_NAMES.checkbox}`)
    expect(boxes[0]!.checked).toBe(false) // 默认 false
    expect(boxes[1]!.checked).toBe(true) // 默认 true
  })

  it('settings.snapshot 回显当前值', () => {
    const { view, parent } = makeView(FIXTURE_DEFS)
    view.handleHostMessage({ kind: 'settings.snapshot', values: { 'editor.lineNumbers': true } })
    const boxes = parent.querySelectorAll<HTMLInputElement>(`input.${SETTINGS_PAGE_CLASS_NAMES.checkbox}`)
    expect(boxes[0]!.checked).toBe(true)
  })

  it('settings.changed 广播同样刷新回显', () => {
    const { view, parent } = makeView(FIXTURE_DEFS)
    view.handleHostMessage({ kind: 'settings.changed', values: { 'editor.spellcheck': false } })
    const boxes = parent.querySelectorAll<HTMLInputElement>(`input.${SETTINGS_PAGE_CLASS_NAMES.checkbox}`)
    expect(boxes[1]!.checked).toBe(false)
  })

  it('非法宿主消息整体忽略（不崩溃、不清空已渲染内容）', () => {
    const { view, parent } = makeView(FIXTURE_DEFS)
    view.handleHostMessage({ kind: 'init', sessionId: 's', docUri: 'u', version: 1, text: 'x' })
    view.handleHostMessage({ kind: 'settings.snapshot' }) // 缺 values
    view.handleHostMessage(null)
    view.handleHostMessage('x')
    expect(parent.querySelectorAll(`.${SETTINGS_PAGE_CLASS_NAMES.item}`)).toHaveLength(2)
  })
})

describe('变更上送与权威值恢复', () => {
  it('切换复选框上送 settings.set（键值对）', () => {
    const { view, sent, parent } = makeView(FIXTURE_DEFS)
    view.handleHostMessage({ kind: 'settings.snapshot', values: { 'editor.lineNumbers': false } })
    const box = parent.querySelector<HTMLInputElement>(`input.${SETTINGS_PAGE_CLASS_NAMES.checkbox}`)!
    box.checked = true
    box.dispatchEvent(new Event('change'))
    expect(sent).toContainEqual({
      kind: 'settings.set',
      values: { 'editor.lineNumbers': true },
    })
  })

  it('宿主拒绝保存（回 settings.snapshot 权威值）后显示回滚', () => {
    const { view, sent, parent } = makeView(FIXTURE_DEFS)
    view.handleHostMessage({ kind: 'settings.snapshot', values: { 'editor.lineNumbers': false } })
    const box = parent.querySelector<HTMLInputElement>(`input.${SETTINGS_PAGE_CLASS_NAMES.checkbox}`)!
    box.checked = true
    box.dispatchEvent(new Event('change'))
    expect(sent.at(-1)).toEqual({ kind: 'settings.set', values: { 'editor.lineNumbers': true } })
    // 宿主以权威快照响应（保存被拒或另一窗口已改回）：render 重建后以
    // 权威值回滚显示
    view.handleHostMessage({ kind: 'settings.snapshot', values: { 'editor.lineNumbers': false } })
    const revived = parent.querySelector<HTMLInputElement>(`input.${SETTINGS_PAGE_CLASS_NAMES.checkbox}`)!
    expect(revived.checked).toBe(false)
  })
})

describe('分类与全局搜索（#90）', () => {
  it('按名称和说明搜索真实设置，标注分类并定位；清空与无结果反馈明确', () => {
    const { parent } = makeView(FIXTURE_DEFS)
    const search = parent.querySelector<HTMLInputElement>('input[type=search]')!
    expect(search).toBeTruthy()
    search.value = '左侧'
    search.dispatchEvent(new Event('input'))
    expect(parent.querySelectorAll('.vsidian-settings-result')).toHaveLength(1)
    const result = parent.querySelector<HTMLButtonElement>('.vsidian-settings-result')!
    expect(result.textContent).toContain(zhCn['settings.editorCategory'])
    result.click()
    expect(search.value).toBe('')
    expect(parent.querySelectorAll(`.${SETTINGS_PAGE_CLASS_NAMES.item}`)).toHaveLength(2)
    search.value = '不存在'
    search.dispatchEvent(new Event('input'))
    expect(parent.textContent).toContain(zhCn['settings.searchEmpty'])
    search.value = ''
    search.dispatchEvent(new Event('input'))
    expect(parent.querySelectorAll(`.${SETTINGS_PAGE_CLASS_NAMES.item}`)).toHaveLength(2)
  })
})

it('保存拒绝恢复权威值并反馈，初始快照不报错，回包保持焦点', () => {
  const { view, parent } = makeView(FIXTURE_DEFS)
  document.body.append(parent)
  view.handleHostMessage({ kind: 'settings.snapshot', values: { 'editor.lineNumbers': false } })
  expect(parent.querySelector('.vsidian-settings-status')?.textContent).toBe('')
  const box = parent.querySelector<HTMLInputElement>('input[type=checkbox]')!
  box.focus()
  box.checked = true
  box.dispatchEvent(new Event('change'))
  view.handleHostMessage({ kind: 'settings.snapshot', values: { 'editor.lineNumbers': false } })
  expect(box.checked).toBe(false)
  expect(parent.querySelector('.vsidian-settings-status')?.textContent).toBe(zhCn['settings.saveFailed'])
  expect(document.activeElement).toBe(box)
  parent.remove()
})

it('扩展分页提供全局搜索入口，定位回调与清理独立于分页内部搜索', () => {
  let located: string | undefined
  let disposed = 0
  const parent = document.createElement('div')
  const view = new SettingsPageView({ postMessage() {} }, FIXTURE_DEFS, [{
    id: 'shortcuts', title: '快捷键', description: '管理操作绑定', icon: 'keyboard',
    entries: [{ id: 'bindings', title: '按键绑定', description: '修改操作组合键' }],
    mount(content, focusEntry) { located = focusEntry; content.textContent = '快捷键内容'; return () => { disposed++ } },
  }])
  view.mount(parent)
  const search = parent.querySelector<HTMLInputElement>('input[type=search]')!
  search.value = '组合键'
  search.dispatchEvent(new Event('input'))
  const result = parent.querySelector<HTMLButtonElement>('.vsidian-settings-result')!
  expect(result.textContent).toContain('快捷键')
  result.click()
  expect(located).toBe('bindings')
  expect(parent.textContent).toContain('快捷键内容')
  // #155 容器语言：附加分页内容住进统一容器；主区为独立滚动容器
  expect(parent.querySelector('.vsidian-settings-section-content')).toBeTruthy()
  expect(parent.querySelector('.vsidian-settings-main')).toBeTruthy()
  parent.querySelector<HTMLButtonElement>('.vsidian-settings-nav-item')!.click()
  expect(disposed).toBe(1)
})

it('分组容器（#155 容器语言）：内建分组条目包进容器，编辑器页按小节分容器', () => {
  const { parent } = makeView(PRODUCTION_SETTING_DEFINITIONS)
  // 默认「常规」分组：唯一容器，条目住进容器内、无组内标题
  const groups = parent.querySelectorAll('.vsidian-settings-group')
  expect(groups).toHaveLength(1)
  expect(groups[0]!.querySelectorAll(`.${SETTINGS_PAGE_CLASS_NAMES.item}`).length).toBeGreaterThan(0)
  expect(groups[0]!.querySelector('.vsidian-settings-group-title')).toBeNull()
  // 「编辑器」分组：多个小节容器，各含组标题（显示/符号输入/…）与条目
  clickNav(parent, zhCn['settings.editorCategory'])
  const editorGroups = parent.querySelectorAll('.vsidian-settings-group')
  expect(editorGroups.length).toBeGreaterThanOrEqual(2)
  expect(editorGroups[0]!.querySelector('.vsidian-settings-group-title')?.textContent)
    .toBe(zhCn['settings.groupDisplay'])
  expect(editorGroups[0]!.querySelectorAll(`.${SETTINGS_PAGE_CLASS_NAMES.item}`).length).toBeGreaterThan(0)
})

it('样式契约：双栏独立滚动、分组容器、拨动开关、主题选中态、可见焦点及窄屏布局', async () => {
  const { readFileSync } = await import('node:fs')
  const css = readFileSync('src/webview/settingsPage.css', 'utf8')
  expect(css).toContain('grid-template-columns: 236px minmax(0, 1fr)')
  // #155 独立滚动骨架：侧栏与主区各自 overflow，外层锁定视口高度
  expect(css).toMatch(/\.vsidian-settings-sidebar\s*\{[^}]*overflow-y:\s*auto/)
  expect(css).toMatch(/\.vsidian-settings-main\s*\{[^}]*overflow-y:\s*auto/)
  expect(css).toMatch(/\.vsidian-settings\s*\{[^}]*height:\s*100%/)
  // #155 容器语言色差与拨动开关均为纯 CSS 契约
  expect(css).toContain('--vsidian-settings-container-bg')
  expect(css).toContain('color-mix(in srgb, var(--vsidian-settings-tint) 4%')
  // #163 二轮还原：编辑器页多小节容器，容器间留呼吸间距
  expect(css).toMatch(/\.vsidian-settings-group \+ \.vsidian-settings-group\s*\{[^}]*margin-top:\s*20px/)
  expect(css).toMatch(/\.vsidian-settings-checkbox\s*\{[^}]*appearance:\s*none/)
  // #155 跟进：依赖灰化（dependsOn 注册表驱动）为纯 CSS 契约
  expect(css).toMatch(/\.vsidian-settings-item-disabled[^{]*\{[^}]*opacity:\s*0\.55/)
  // 样式参考页签面板切换承载点：author display 规则不得压过 hidden 语义
  // （detail 面板常驻 display:flex，无此基线两面板会同屏叠加）
  expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important/)
  expect(css).toContain('.vsidian-settings-nav-item[aria-current="page"]')
  expect(css).toContain('--vscode-list-activeSelectionBackground')
  expect(css).toContain(':focus-visible')
  expect(css).toContain('@media (max-width: 600px)')
})

it('样式契约：callout 形态与样式参考总分页签（#155 小改）', async () => {
  const { readFileSync } = await import('node:fs')
  const css = readFileSync('src/webview/settingsPage.css', 'utf8')
  // callout：左强调条 + 圆角色底承载说明性长文案（CSS 片段远程缓存说明、样式参考别名桥要点共用）
  expect(css).toMatch(/\.vsidian-settings-callout\s*\{[^}]*border-left/)
  expect(css).toMatch(/\.vsidian-settings-callout\s*\{[^}]*border-radius/)
  // 总分页签：pill 形态，aria-selected 单选激活态走主题选中色
  expect(css).toMatch(/\.vsidian-style-ref-tab\s*\{[^}]*border-radius:\s*999px/)
  expect(css).toContain('.vsidian-style-ref-tab[aria-selected="true"]')
})

it('样式契约：详细查询两列独立滚动（#155 跟进）', async () => {
  const { readFileSync } = await import('node:fs')
  const css = readFileSync('src/webview/settingsPage.css', 'utf8')
  // 详细查询页签可见时主区收起滚动（页签切回总表自动恢复）；滚动收敛到类目栏与条目列表
  expect(css).toContain('.vsidian-settings-main:has(.vsidian-style-ref-detail:not([hidden]))')
  expect(css).toMatch(/\.vsidian-style-ref-cats\s*\{[^}]*overflow-y:\s*auto/)
  expect(css).toMatch(/\.vsidian-style-ref-list\s*\{[^}]*overflow-y:\s*auto/)
})

describe('设置项依赖灰化（#155 跟进：dependsOn 注册表驱动联动）', () => {
  /** 切到编辑器分组并取生产定义控件（卡片/行号/复制）——#163 二轮还原后
   *  codeblock.* 是编辑器页内的「代码块」小节 */
  function editorControls(parent: HTMLElement) {
    clickNav(parent, zhCn['settings.editorCategory'])
    const byKey = (key: string) =>
      parent.querySelector<HTMLInputElement>(`input[data-setting-key="${key}"]`)!
    const itemOf = (key: string) =>
      parent.querySelector<HTMLInputElement>(`input[data-setting-key="${key}"]`)!
        .closest('.vsidian-settings-item')!
    return {
      card: byKey('codeblock.card'),
      lineNumbers: byKey('codeblock.lineNumbers'),
      copyButton: byKey('codeblock.copyButton'),
      highlight: byKey('codeblock.highlight'),
      itemOf,
    }
  }
  /** 宿主回推正式消息形态（经协议校验口径构造） */
  const hostMessage = (values: Record<string, boolean | string>, kind: 'settings.snapshot' | 'settings.changed' = 'settings.changed') =>
    ({ kind, values })

  it('依赖关闭：子项控件 disabled、条目带灰化类；独立项（语法高亮）不受影响', () => {
    const { view, parent } = makeView(PRODUCTION_SETTING_DEFINITIONS)
    view.handleHostMessage(hostMessage({
      'editor.lineNumbers': true, 'codeblock.card': false,
      'codeblock.lineNumbers': true, 'codeblock.copyButton': true, 'codeblock.highlight': true,
      'editor.symbolAutocomplete': true, 'editor.symbolSelectionWrap': true, 'editor.symbolTabEscape': true,
      'general.language': 'auto',
    }, 'settings.snapshot'))
    const c = editorControls(parent)
    expect(c.card.disabled).toBe(false)
    expect(c.lineNumbers.disabled).toBe(true)
    expect(c.copyButton.disabled).toBe(true)
    expect(c.highlight.disabled).toBe(false)
    expect(c.itemOf('codeblock.lineNumbers').classList.contains('vsidian-settings-item-disabled')).toBe(true)
    expect(c.itemOf('codeblock.copyButton').classList.contains('vsidian-settings-item-disabled')).toBe(true)
    expect(c.itemOf('codeblock.highlight').classList.contains('vsidian-settings-item-disabled')).toBe(false)
  })

  it('联动自动化：宿主回推 settings.changed 后依赖项就地解灰（无重渲染、值不清除）', () => {
    const { view, parent } = makeView(PRODUCTION_SETTING_DEFINITIONS)
    // 初始快照：卡片关，子项灰化但值保留 true
    view.handleHostMessage(hostMessage({
      'editor.lineNumbers': true, 'codeblock.card': false,
      'codeblock.lineNumbers': true, 'codeblock.copyButton': true, 'codeblock.highlight': true,
      'editor.symbolAutocomplete': true, 'editor.symbolSelectionWrap': true, 'editor.symbolTabEscape': true,
      'general.language': 'auto',
    }, 'settings.snapshot'))
    const c = editorControls(parent)
    expect(c.lineNumbers.disabled).toBe(true)
    // 用户打开卡片：设置页上送 settings.set，宿主合并后回推 changed
    c.card.click()
    view.handleHostMessage(hostMessage({
      'editor.lineNumbers': true, 'codeblock.card': true,
      'codeblock.lineNumbers': true, 'codeblock.copyButton': true, 'codeblock.highlight': true,
      'editor.symbolAutocomplete': true, 'editor.symbolSelectionWrap': true, 'editor.symbolTabEscape': true,
      'general.language': 'auto',
    }))
    expect(c.lineNumbers.disabled).toBe(false)
    expect(c.copyButton.disabled).toBe(false)
    // 子项值未被清除：依赖恢复后按原值生效
    expect(c.lineNumbers.checked).toBe(true)
    expect(c.itemOf('codeblock.lineNumbers').classList.contains('vsidian-settings-item-disabled')).toBe(false)
    // 再关卡片：就地复灰（同一控件实例，验证不重建分页）
    view.handleHostMessage(hostMessage({
      'editor.lineNumbers': true, 'codeblock.card': false,
      'codeblock.lineNumbers': true, 'codeblock.copyButton': true, 'codeblock.highlight': true,
      'editor.symbolAutocomplete': true, 'editor.symbolSelectionWrap': true, 'editor.symbolTabEscape': true,
      'general.language': 'auto',
    }))
    expect(c.lineNumbers.disabled).toBe(true)
  })
})

describe('分组重组二轮还原（#163 验收反馈：侧栏只留常规/编辑器，编辑器页内小节分类）', () => {
  const navTitles = (parent: HTMLElement): string[] =>
    [...parent.querySelectorAll<HTMLButtonElement>('.vsidian-settings-nav-item')]
      .map((b) => b.textContent ?? '')
  const sectionTitles = (parent: HTMLElement): string[] =>
    [...parent.querySelectorAll('.vsidian-settings-group-title')].map((el) => el.textContent ?? '')
  const groupItemTitles = (parent: HTMLElement, title: string): string[] =>
    [...sectionByTitle(parent, title).querySelectorAll(`.${SETTINGS_PAGE_CLASS_NAMES.item}`)]
      .map((el) => el.querySelector(`.${SETTINGS_PAGE_CLASS_NAMES.itemTitle}`)?.textContent ?? '')

  it('侧栏只呈现常规/编辑器两个内置分组（附加分页另算）', () => {
    const { parent } = makeView(PRODUCTION_SETTING_DEFINITIONS)
    expect(navTitles(parent)).toEqual([
      zhCn['settings.generalSection'],
      zhCn['settings.editorCategory'],
    ])
  })

  it('编辑器页内小节为显示/符号输入/代码块/图片，条目按前缀归节', () => {
    const { parent } = makeView(PRODUCTION_SETTING_DEFINITIONS)
    clickNav(parent, zhCn['settings.editorCategory'])
    expect(sectionTitles(parent)).toEqual([
      zhCn['settings.groupDisplay'],
      zhCn['settings.groupSymbols'],
      zhCn['settings.groupCodeblock'],
      zhCn['settings.groupImage'],
    ])
    expect(groupItemTitles(parent, zhCn['settings.groupDisplay']))
      .toEqual([zhCn['setting.editorLineNumbers.title'], zhCn['setting.readableLineWidth.title']])
    expect(groupItemTitles(parent, zhCn['settings.groupSymbols'])).toEqual([
      zhCn['setting.symbolAutocomplete.title'],
      zhCn['setting.symbolSelectionWrap.title'],
      zhCn['setting.symbolTabEscape.title'],
    ])
    expect(groupItemTitles(parent, zhCn['settings.groupCodeblock'])).toEqual([
      zhCn['setting.codeblockCard.title'],
      zhCn['setting.codeblockLineNumbers.title'],
      zhCn['setting.codeblockCopyButton.title'],
      zhCn['setting.codeblockHighlight.title'],
    ])
    expect(groupItemTitles(parent, zhCn['settings.groupImage'])).toEqual([
      zhCn['setting.imagePaste.title'],
      zhCn['setting.imagePasteLocation.title'],
      zhCn['setting.imagePasteSubpath.title'],
    ])
  })

  it('图片子路径依赖灰化（#163 验收反馈防呆）：同目录模式置灰禁改，后两种模式可用', () => {
    const { view, parent } = makeView(PRODUCTION_SETTING_DEFINITIONS)
    clickNav(parent, zhCn['settings.editorCategory'])
    const subpathInput = parent.querySelector<HTMLInputElement>(
      'input[type="text"][data-setting-key="image.pasteSubpath"]')!
    // 默认 same-dir：子路径灰化禁改
    expect(subpathInput.disabled).toBe(true)
    expect(subpathInput.closest(`.${SETTINGS_PAGE_CLASS_NAMES.item}`)!.classList
      .contains('vsidian-settings-item-disabled')).toBe(true)
    // 切到相对工作区根：解灰可用
    view.handleHostMessage({ kind: 'settings.snapshot', values: {
      'general.language': 'auto',
      'image.paste': true,
      'image.pasteLocation': 'workspace-root',
      'image.pasteSubpath': 'assets',
    } } as never)
    expect(subpathInput.disabled).toBe(false)
    // 总开关关闭：整组级联灰化（依赖链传递）
    view.handleHostMessage({ kind: 'settings.snapshot', values: {
      'general.language': 'auto',
      'image.paste': false,
      'image.pasteLocation': 'workspace-root',
      'image.pasteSubpath': 'assets',
    } } as never)
    expect(subpathInput.disabled).toBe(true)
  })
})

describe('可读行宽定义（#175）', () => {
  it('注册「可读行宽」：number 定义带 zeroLabelKey/unit（0 档显示词走注册表，渲染层无特判）', () => {
    const def = PRODUCTION_SETTING_DEFINITIONS.find((d) => d.key === 'editor.readableLineWidth')
    expect(def).toBeTruthy()
    if (def && def.type === 'number') {
      expect(def.zeroLabelKey).toBe('setting.readableLineWidthFill')
      expect(def.unit).toBe('px')
    } else {
      expect.unreachable('可读行宽应为 number 定义')
    }
  })
})

describe('可读行宽滑块（#175：number 型渲染为 range 控件）', () => {  /** 切到编辑器分组（可读行宽落编辑器组）并取滑块/值文本 */
  function slider(parent: HTMLElement) {
    const editorNav = [...parent.querySelectorAll<HTMLButtonElement>('.vsidian-settings-nav-item')]
      .find((b) => b.textContent === '编辑器')!
    editorNav.click()
    const input = parent.querySelector<HTMLInputElement>('input[type=range][data-setting-key="editor.readableLineWidth"]')!
    const readout = parent.querySelector('.vsidian-settings-range-value')!
    return { input, readout }
  }

  it('渲染滑块：min/max/step 来自定义；默认 0 的值文本与 aria-valuetext 为「铺满」', () => {
    const { parent } = makeView(PRODUCTION_SETTING_DEFINITIONS)
    const { input, readout } = slider(parent)
    expect(input.min).toBe('0')
    expect(input.max).toBe('1600')
    expect(input.step).toBe('20')
    expect(input.value).toBe('0')
    expect(readout.textContent).toBe(zhCn['setting.readableLineWidthFill'])
    expect(input.getAttribute('aria-valuetext')).toBe(zhCn['setting.readableLineWidthFill'])
  })

  it('settings.snapshot 回显 900：input 值、值文本与 aria-valuetext 同步为 900px', () => {
    const { view, parent } = makeView(PRODUCTION_SETTING_DEFINITIONS)
    view.handleHostMessage({ kind: 'settings.snapshot', values: { 'editor.readableLineWidth': 900 } })
    const { input, readout } = slider(parent)
    expect(input.value).toBe('900')
    expect(readout.textContent).toBe('900px')
    expect(input.getAttribute('aria-valuetext')).toBe('900px')
  })

  it('拖动释放（change）上送 settings.set 数值', () => {
    const { sent, parent } = makeView(PRODUCTION_SETTING_DEFINITIONS)
    const { input } = slider(parent)
    input.value = '900'
    input.dispatchEvent(new Event('change'))
    expect(sent).toContainEqual({
      kind: 'settings.set',
      values: { 'editor.readableLineWidth': 900 },
    })
  })

  it('拖动中（input）即时刷新值文本但不立即上送（保存语义在释放）', () => {
    const { sent, parent } = makeView(PRODUCTION_SETTING_DEFINITIONS)
    const { input, readout } = slider(parent)
    input.value = '1200'
    input.dispatchEvent(new Event('input'))
    expect(readout.textContent).toBe('1200px')
    expect(input.getAttribute('aria-valuetext')).toBe('1200px')
    expect(sent).toHaveLength(0)
    // 拖回 0：值文本回到铺满档
    input.value = '0'
    input.dispatchEvent(new Event('input'))
    expect(readout.textContent).toBe(zhCn['setting.readableLineWidthFill'])
  })

  it('滑块样式契约：range 控件与值文本规则存在于 settingsPage.css', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync('src/webview/settingsPage.css', 'utf8')
    expect(css).toMatch(/\.vsidian-settings-range\s*\{[^}]*accent-color/)
    expect(css).toMatch(/\.vsidian-settings-range-value\s*\{[^}]*min-width/)
  })
})

describe('常规分组图标（#230：地球换双拨杆开关）', () => {
  /** 侧栏导航按钮内 svg path 的 d（经设置页真实渲染路径取用户所见字形） */
  function navPath(parent: HTMLElement, title: string): string {
    const nav = [...parent.querySelectorAll<HTMLButtonElement>('.vsidian-settings-nav-item')]
      .find((b) => b.textContent === title)!
    return nav.querySelector('svg path')!.getAttribute('d')!
  }

  it('「常规」图标为双拨杆开关：两枚横杆纵列、圆点一左一右（替换地球字形）', () => {
    const { parent } = makeView(PRODUCTION_SETTING_DEFINITIONS)
    const subs = navPath(parent, zhCn['settings.generalSection']).split(/(?=M)/)
    // 按子路径（M 起）切分：两枚开关主体胶囊 + 两枚圆点，共 4 段——
    // 地球字形为 3 段（外圆 + 赤道线 + 经线环），段数与形态断言据此暴露换形差异
    expect(subs).toHaveLength(4)
    // 两枚开关主体：同宽胶囊横杆（18 宽、两段半圆端）、纵向错位上下排列
    expect(subs[0]).toBe('M7 2h10a4 4 0 0 1 0 8H7a4 4 0 0 1 0-8Z')
    expect(subs[2]).toBe('M7 14h10a4 4 0 0 1 0 8H7a4 4 0 0 1 0-8Z')
    // 两枚圆点：r=2 描边小圆，上一枚偏左（圆心 x=8）、下一枚偏右（x=16），拨杆方向相反
    expect(subs[1]).toBe('M8 4a2 2 0 1 0 0 4 2 2 0 1 0 0-4')
    expect(subs[3]).toBe('M16 16a2 2 0 1 0 0 4 2 2 0 1 0 0-4')
  })

  it('其余条目图标不变：编辑器仍为铅笔起笔字形（与「常规」新字形可区分）', () => {
    const { parent } = makeView(PRODUCTION_SETTING_DEFINITIONS)
    const editor = navPath(parent, zhCn['settings.editorCategory'])
    expect(editor.startsWith('M14 4l6 6')).toBe(true)
    expect(editor).not.toBe(navPath(parent, zhCn['settings.generalSection']))
  })
})

describe('外观合并分页（#231）', () => {
  /** 完整装配（生产注册口径）：快捷键 + 外观（组合分页）+ 索引维护 */
  function makeFullView(): {
    view: SettingsPageView
    parent: HTMLElement
    snippets: CssSnippetSettingsSection
  } {
    const snippets = new CssSnippetSettingsSection({ postMessage() {} })
    const appearance = new AppearanceSection(
      snippets, new StyleReferenceSection({ postMessage() {} }))
    const view = new SettingsPageView({ postMessage() {} }, PRODUCTION_SETTING_DEFINITIONS, [
      new KeybindingSettingsSection({ postMessage() {} }),
      appearance,
      new IndexMaintenanceSection({ postMessage() {} }),
    ])
    const parent = document.createElement('div')
    view.mount(parent)
    return { view, parent, snippets }
  }

  function navItems(parent: HTMLElement): HTMLButtonElement[] {
    return [...parent.querySelectorAll<HTMLButtonElement>('.vsidian-settings-nav-item')]
  }
  function tabOf(parent: HTMLElement, id: string): HTMLButtonElement {
    const tab = parent.querySelector<HTMLButtonElement>(`.vsidian-style-ref-tab[data-tab="${id}"]`)
    expect(tab, `页签 ${id} 应已渲染`).toBeTruthy()
    return tab!
  }
  /** 点击全局搜索结果（外观分组、条目文本匹配） */
  function clickAppearanceResult(parent: HTMLElement, text: string): void {
    const result = [...parent.querySelectorAll<HTMLButtonElement>('.vsidian-settings-result')]
      .find((b) => b.querySelector('.vsidian-settings-result-category')?.textContent === zhCn['appearance.title']
        && (b.textContent ?? '').includes(text))
    expect(result, `外观分组应命中「${text}」`).toBeTruthy()
    result!.click()
  }

  it('侧栏五条：常规、编辑器、快捷键、外观、索引维护；「外观」为调色板图标', () => {
    const { parent } = makeFullView()
    expect(navItems(parent).map((b) => b.textContent)).toEqual([
      zhCn['settings.generalSection'],
      zhCn['settings.editorCategory'],
      zhCn['keybindingSettings.title'],
      zhCn['appearance.title'],
      zhCn['indexMaintenance.title'],
    ])
    // 外观条目 icon 是调色板：主体轮廓（lucide palette 形）+ 颜料孔圆点子路径
    const appearanceNav = navItems(parent).find((b) => b.textContent === zhCn['appearance.title'])!
    const d = appearanceNav.querySelector('svg path')!.getAttribute('d')!
    expect(d).toContain('M12 2C6.5 2 2 6.5 2 12')
    expect(d).toContain('M17.5 10.5h.01')
    // book 字形随样式参考侧栏条目退役：全部侧栏条目不再出现书本轮廓
    expect(navItems(parent).some((b) =>
      b.querySelector('svg path')?.getAttribute('d')?.startsWith('M4 19.5A2.5'))).toBe(false)
  })

  it('focusSection 带 entry（#231）：宿主命令直达外观指定页签（overview → 样式参考）', () => {
    const { view, parent } = makeFullView()
    view.handleHostMessage({ kind: 'settings.focusSection', section: 'appearance', entry: 'overview' })
    expect(parent.querySelector('.vsidian-settings-heading')?.textContent).toBe(zhCn['appearance.title'])
    expect(tabOf(parent, 'overview').getAttribute('aria-selected')).toBe('true')
    expect(parent.querySelector('.vsidian-style-ref-overview')!.hasAttribute('hidden')).toBe(false)
    expect(parent.querySelector('.vsidian-style-ref-detail')!.hasAttribute('hidden')).toBe(true)
  })

  it('全局搜索路由：片段条目落 CSS 片段页签、契约条目落详细查询、总表落样式参考', () => {
    const { parent, snippets } = makeFullView()
    // 片段条目进搜索索引（宿主状态直连实例）
    snippets.handleHostMessage({
      kind: 'snippets.state', directory: 'D:/s', readError: false, paused: false, version: 1,
      entries: [{ name: 'github.css', enabled: false }],
    })
    const search = parent.querySelector<HTMLInputElement>('input[type=search]')!
    // 片段文件命中 → 落 CSS 片段页签（可见目录行）
    search.value = 'github.css'
    search.dispatchEvent(new Event('input'))
    clickAppearanceResult(parent, 'github.css')
    expect(search.value).toBe('')
    expect(tabOf(parent, 'cssSnippets').getAttribute('aria-selected')).toBe('true')
    expect(parent.querySelector('.vsidian-appearance-snippets')!.hasAttribute('hidden')).toBe(false)
    // 契约条目命中 → 落详细查询页签（条目卡片定位高亮）
    const wikilink = STYLE_GUIDE_ENTRIES.find((e) => e.id === 'live-wikilink')!
    search.value = wikilink.target
    search.dispatchEvent(new Event('input'))
    clickAppearanceResult(parent, wikilink.target)
    expect(tabOf(parent, 'detail').getAttribute('aria-selected')).toBe('true')
    expect(parent.querySelector('.vsidian-style-ref-detail')!.hasAttribute('hidden')).toBe(false)
    expect(parent.querySelector('[data-entry="live-wikilink"]')!.classList
      .contains('vsidian-settings-item-located')).toBe(true)
    // 总表命中 → 落样式参考页签（版本说明可见）
    search.value = zhCn['styleRef.title']
    search.dispatchEvent(new Event('input'))
    clickAppearanceResult(parent, zhCn['styleRef.title'])
    expect(tabOf(parent, 'overview').getAttribute('aria-selected')).toBe('true')
    expect(parent.querySelector('.vsidian-style-ref-overview')!.hasAttribute('hidden')).toBe(false)
  })
})
