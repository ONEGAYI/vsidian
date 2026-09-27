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

  it('生产注册表（#34 起）渲染真实开关：显示行号、默认勾选', () => {
    // #34：首个实际设置项接入后设置页不再是空状态——注册表追加定义即
    // 出现开关（#33 设计的预期演进），此处以生产定义直测渲染结果。
    // #96 起注册表含「界面语言」（string 枚举），设置页新增「常规」分组
    // 且默认显示之——开关断言先切到「编辑器」分组
    expect(PRODUCTION_SETTING_DEFINITIONS.length).toBeGreaterThan(0)
    const { parent } = makeView(PRODUCTION_SETTING_DEFINITIONS)
    expect(parent.querySelector(`.${SETTINGS_PAGE_CLASS_NAMES.empty}`)).toBeNull()
    // 默认分组 = 常规（首个分类）：语言项可见，无开关
    expect(parent.querySelector(`select.${SETTINGS_PAGE_CLASS_NAMES.select}`)).toBeTruthy()
    const editorNav = [...parent.querySelectorAll<HTMLButtonElement>('.vsidian-settings-nav-item')]
      .find((b) => b.textContent === '编辑器')!
    editorNav.click()
    const booleanDefs = PRODUCTION_SETTING_DEFINITIONS.filter((d) => d.type === 'boolean')
    const boxes = parent.querySelectorAll<HTMLInputElement>(
      `input.${SETTINGS_PAGE_CLASS_NAMES.checkbox}`,
    )
    expect(boxes).toHaveLength(booleanDefs.length)
    const first = parent.querySelector(`.${SETTINGS_PAGE_CLASS_NAMES.itemTitle}`)
    expect(first?.textContent).toBe(zhCn['setting.editorLineNumbers.title'])
    expect(boxes[0]!.checked).toBe(true) // 默认开启
  })

  it('符号选区包裹（#124）渲染为编辑器分组开关：标题/说明经 t() 取词、默认勾选', () => {
    const { parent } = makeView(PRODUCTION_SETTING_DEFINITIONS)
    const editorNav = [...parent.querySelectorAll<HTMLButtonElement>('.vsidian-settings-nav-item')]
      .find((b) => b.textContent === '编辑器')!
    editorNav.click()
    const item = [...parent.querySelectorAll<HTMLElement>(`.${SETTINGS_PAGE_CLASS_NAMES.item}`)]
      .find((el) => el.querySelector(`.${SETTINGS_PAGE_CLASS_NAMES.itemTitle}`)?.textContent ===
        zhCn['setting.symbolSelectionWrap.title'])
    expect(item, '应渲染「选区符号包裹」设置行').toBeTruthy()
    expect(item!.querySelector(`.${SETTINGS_PAGE_CLASS_NAMES.itemDescription}`)?.textContent)
      .toBe(zhCn['setting.symbolSelectionWrap.description'])
    expect(item!.querySelector<HTMLInputElement>(`input.${SETTINGS_PAGE_CLASS_NAMES.checkbox}`)!.checked)
      .toBe(true)
  })

  it('符号自动补全（#123）渲染为编辑器分组开关：标题/说明经 t() 取词、默认勾选', () => {
    const { parent } = makeView(PRODUCTION_SETTING_DEFINITIONS)
    const editorNav = [...parent.querySelectorAll<HTMLButtonElement>('.vsidian-settings-nav-item')]
      .find((b) => b.textContent === '编辑器')!
    editorNav.click()
    const item = [...parent.querySelectorAll<HTMLElement>(`.${SETTINGS_PAGE_CLASS_NAMES.item}`)]
      .find((el) => el.querySelector(`.${SETTINGS_PAGE_CLASS_NAMES.itemTitle}`)?.textContent ===
        zhCn['setting.symbolAutocomplete.title'])
    expect(item, '应渲染「符号自动补全」设置行').toBeTruthy()
    expect(item!.querySelector(`.${SETTINGS_PAGE_CLASS_NAMES.itemDescription}`)?.textContent)
      .toBe(zhCn['setting.symbolAutocomplete.description'])
    expect(item!.querySelector<HTMLInputElement>(`input.${SETTINGS_PAGE_CLASS_NAMES.checkbox}`)!.checked)
      .toBe(true)
  })

  it('符号 Tab 越界（#125）渲染为编辑器分组开关：标题/说明经 t() 取词、默认勾选', () => {
    const { parent } = makeView(PRODUCTION_SETTING_DEFINITIONS)
    const editorNav = [...parent.querySelectorAll<HTMLButtonElement>('.vsidian-settings-nav-item')]
      .find((b) => b.textContent === '编辑器')!
    editorNav.click()
    const item = [...parent.querySelectorAll<HTMLElement>(`.${SETTINGS_PAGE_CLASS_NAMES.item}`)]
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

it('分组容器（#155 容器语言）：内建分组条目包进容器，编辑器组标题在容器内', () => {
  const { parent } = makeView(PRODUCTION_SETTING_DEFINITIONS)
  // 默认「常规」分组：唯一容器，条目住进容器内
  const groups = parent.querySelectorAll('.vsidian-settings-group')
  expect(groups).toHaveLength(1)
  expect(groups[0]!.querySelectorAll(`.${SETTINGS_PAGE_CLASS_NAMES.item}`).length).toBeGreaterThan(0)
  expect(groups[0]!.querySelector('.vsidian-settings-group-title')).toBeNull()
  // 「编辑器」分组：容器内含组标题（显示）与条目
  const editorNav = [...parent.querySelectorAll<HTMLButtonElement>('.vsidian-settings-nav-item')]
    .find((b) => b.textContent === '编辑器')!
  editorNav.click()
  const editorGroup = parent.querySelector('.vsidian-settings-group')!
  expect(editorGroup.querySelector('.vsidian-settings-group-title')?.textContent)
    .toBe(zhCn['settings.groupDisplay'])
  expect(editorGroup.querySelectorAll(`.${SETTINGS_PAGE_CLASS_NAMES.item}`).length).toBeGreaterThan(0)
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
  expect(css).toMatch(/\.vsidian-settings-checkbox\s*\{[^}]*appearance:\s*none/)
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
