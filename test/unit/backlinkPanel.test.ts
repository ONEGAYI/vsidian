// @vitest-environment jsdom
// 反链面板 DOM 契约测试（#197 建立；形态改版批次按新形态重做）：四态渲染、
// 工具栏四按钮、搜索框显隐、页头计数、分组/组头折叠态、上下文卡片与命中
// 高亮切分（跨高亮边界文本）、固定区复用（搜索输入不丢输入节点）。
import { describe, expect, it } from 'vitest'
import {
  backlinkCardSegmentsOf,
  backlinkSourceLabel,
  BACKLINK_CLASS_NAMES,
  BACKLINK_SORT_MENU,
  buildBacklinksDom,
  defaultBacklinkView,
  renderBacklinksState,
  type BacklinkPanelSnapshot,
  type BacklinkPanelView,
} from '../../src/webview/backlinkPanel'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import type { BacklinkItemPayload } from '../../src/shared/protocol'

// 面板文案经 t() 取词：装配生产中文包，断言与字典同源（outlinePanel 先例）
installLocale('zh-cn', zhCn)

function itemOf(overrides: Partial<BacklinkItemPayload> = {}): BacklinkItemPayload {
  return {
    sourceRelPath: 'notes/来源.md',
    sourceFsPath: 'C:/vault/notes/来源.md',
    kind: 'wikilink',
    anchor: '',
    start: 6,
    end: 12,
    line: 3,
    snippet: '引用 [[目标]] 的行',
    snippetStart: 3,
    sourceMtimeMs: 1_000,
    sourceBirthtimeMs: 500,
    snippetLong: '上文\n引用 [[目标]] 的行\n下文',
    snippetLongStart: 0,
    ...overrides,
  }
}

function ready(items: readonly BacklinkItemPayload[], updating = false): BacklinkPanelSnapshot {
  return { state: 'ready', updating, items }
}

describe('buildBacklinksDom', () => {
  it('按钮与面板带稳定类名与可访问语义；初始为 loading 占位', () => {
    const { toggle, panel } = buildBacklinksDom()
    expect(toggle.className).toBe('vsidian-backlinks-toggle')
    expect(panel.className).toBe(BACKLINK_CLASS_NAMES.panel)
    expect(panel.getAttribute('role')).toBe('region')
    expect(panel.getAttribute('aria-label')).toBe('链接当前文件')
    expect(panel.querySelector(`.${BACKLINK_CLASS_NAMES.placeholder}`)).not.toBeNull()
    expect(panel.querySelector(`.${BACKLINK_CLASS_NAMES.placeholder}`)!.textContent)
      .toBe('正在加载反向链接…')
  })

  it('toggle 图标为链环 SVG（currentColor 描边，线宽不写在属性上——CSS 契约钉住）', () => {
    const { toggle } = buildBacklinksDom()
    const svg = toggle.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg!.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(svg!.getAttribute('stroke')).toBe('currentColor')
    expect(svg!.getAttribute('stroke-width')).toBeNull()
    expect(svg!.querySelectorAll('path').length).toBeGreaterThanOrEqual(4)
  })
})

describe('renderBacklinksState：四态与骨架', () => {
  it('ready + items：工具栏四按钮 + 页头（标题/计数）+ 分组列表', () => {
    const panel = buildBacklinksDom().panel
    renderBacklinksState(panel, ready([itemOf()]), defaultBacklinkView())
    const toolbar = panel.querySelector(`.${BACKLINK_CLASS_NAMES.toolbar}`)!
    expect(toolbar).not.toBeNull()
    const buttons = toolbar.querySelectorAll(`.${BACKLINK_CLASS_NAMES.toolbarButton}`)
    expect(buttons).toHaveLength(4)
    expect([...buttons].map((b) => (b as HTMLElement).dataset['action'])).toEqual([
      'sort', 'search', 'collapse', 'context',
    ])
    const header = panel.querySelector(`.${BACKLINK_CLASS_NAMES.pageHeader}`)!
    expect(header.querySelector(`.${BACKLINK_CLASS_NAMES.pageTitle}`)!.textContent)
      .toBe('链接当前文件')
    expect(header.querySelector(`.${BACKLINK_CLASS_NAMES.pageCount}`)!.textContent).toBe('1')
    expect(panel.querySelectorAll(`.${BACKLINK_CLASS_NAMES.group}`)).toHaveLength(1)
  })

  it('ready + updating：细条在面板首位（固定区之上）', () => {
    const panel = buildBacklinksDom().panel
    renderBacklinksState(panel, ready([itemOf()], true), defaultBacklinkView())
    expect(panel.firstElementChild!.className).toBe(BACKLINK_CLASS_NAMES.updating)
    expect(panel.querySelector(`.${BACKLINK_CLASS_NAMES.toolbar}`)).not.toBeNull()
  })

  it('ready + 空 items：空态占位 + 工具栏骨架常驻（面板结构恒定）', () => {
    const panel = buildBacklinksDom().panel
    renderBacklinksState(panel, ready([]), defaultBacklinkView())
    expect(panel.querySelector(`.${BACKLINK_CLASS_NAMES.item}`)).toBeNull()
    // 骨架常驻（loading/error/空文档不撤固定区——探针与结构恒定）
    expect(panel.querySelector(`.${BACKLINK_CLASS_NAMES.toolbar}`)).not.toBeNull()
    expect(panel.querySelector(`.${BACKLINK_CLASS_NAMES.pageHeader}`)).toBeNull()
    expect(panel.querySelector(`.${BACKLINK_CLASS_NAMES.placeholder}`)!.textContent)
      .toBe('没有反向链接')
  })

  it('error 态：无工作区与读取失败分开文案', () => {
    const panel = buildBacklinksDom().panel
    renderBacklinksState(panel, { state: 'error', updating: false, reason: 'no-workspace', items: [] }, defaultBacklinkView())
    expect(panel.querySelector(`.${BACKLINK_CLASS_NAMES.placeholder}`)!.textContent)
      .toBe('未打开工作区，无法查看反向链接')
    renderBacklinksState(panel, { state: 'error', updating: false, reason: 'read-error', items: [] }, defaultBacklinkView())
    expect(panel.querySelector(`.${BACKLINK_CLASS_NAMES.placeholder}`)!.textContent)
      .toBe('反向链接不可用')
  })
})

describe('renderBacklinksState：分组与卡片', () => {
  const twoSources: BacklinkItemPayload[] = [
    itemOf(),
    itemOf({ start: 30, end: 38, line: 5, snippet: '第二处 [[目标]]', snippetStart: 28 }),
    itemOf({ sourceRelPath: 'b.md', sourceFsPath: 'C:/vault/b.md', start: 8, end: 16, line: 1, snippet: '[[目标]]', snippetStart: 0 }),
  ]

  it('按来源聚合分组：组头（chevron + 组名 + 计数）可折叠（aria-expanded）', () => {
    const panel = buildBacklinksDom().panel
    renderBacklinksState(panel, ready(twoSources), defaultBacklinkView())
    const groups = panel.querySelectorAll(`.${BACKLINK_CLASS_NAMES.group}`)
    expect(groups).toHaveLength(2)
    // 默认 name-asc：码位序 b.md 在前；按数据键定位断言（不依赖渲染序）
    const first = [...groups].find((g) => (g as HTMLElement).dataset['vsidianSource'] === 'notes/来源.md')!
    const header = first.querySelector(`.${BACKLINK_CLASS_NAMES.groupHeader}`)! as HTMLElement
    expect(header.querySelector(`.${BACKLINK_CLASS_NAMES.groupName}`)!.textContent).toBe('notes/来源')
    expect(header.querySelector(`.${BACKLINK_CLASS_NAMES.groupCount}`)!.textContent).toBe('2')
    expect(header.getAttribute('aria-expanded')).toBe('true')
    // 折叠该组：collapsed 类 + 卡片仍在 DOM（CSS 控制显隐）+ aria 翻转
    renderBacklinksState(panel, ready(twoSources), {
      ...defaultBacklinkView(),
      collapsedGroups: new Set(['notes/来源.md']),
    })
    const collapsed = [...panel.querySelectorAll(`.${BACKLINK_CLASS_NAMES.group}`)]
      .find((g) => (g as HTMLElement).dataset['vsidianSource'] === 'notes/来源.md')!
    expect(collapsed.classList.contains(BACKLINK_CLASS_NAMES.groupCollapsed)).toBe(true)
    expect(collapsed.querySelectorAll(`.${BACKLINK_CLASS_NAMES.card}`)).toHaveLength(2)
    expect(collapsed.querySelector(`.${BACKLINK_CLASS_NAMES.groupHeader}`)!.getAttribute('aria-expanded')).toBe('false')
  })

  it('卡片类名 card 与 #197 既有 item 并挂；dataset 携带跳转定位键', () => {
    const panel = buildBacklinksDom().panel
    renderBacklinksState(panel, ready([itemOf()]), defaultBacklinkView())
    const card = panel.querySelector(`.${BACKLINK_CLASS_NAMES.card}`)! as HTMLElement
    expect(card.classList.contains(BACKLINK_CLASS_NAMES.item)).toBe(true)
    expect(card.dataset['vsidianSource']).toBe('notes/来源.md')
    expect(card.dataset['vsidianOffset']).toBe('6')
    expect(card.getAttribute('aria-label')).toContain('notes/来源')
  })

  it('命中高亮：mark.hit 按区间切分文本（跨高亮边界文本保持完整）', () => {
    const panel = buildBacklinksDom().panel
    renderBacklinksState(panel, ready([itemOf()]), defaultBacklinkView())
    const text = panel.querySelector(`.${BACKLINK_CLASS_NAMES.cardText}`)!
    const mark = text.querySelector(`mark.${BACKLINK_CLASS_NAMES.hit}`)
    expect(mark).not.toBeNull()
    // snippetStart=3、区间 [6,12) → 片段内 [3,9) =「[[目标]]」整体语法
    expect(text.textContent).toBe('引用 [[目标]] 的行')
    expect(mark!.textContent).toBe('[[目标]]')
  })

  it('更多上下文开态：卡片文本换长片段并按长片段起点切高亮', () => {
    const panel = buildBacklinksDom().panel
    renderBacklinksState(panel, ready([itemOf()]), { ...defaultBacklinkView(), contextLong: true })
    const text = panel.querySelector(`.${BACKLINK_CLASS_NAMES.cardText}`)!
    expect(text.textContent).toBe('上文\n引用 [[目标]] 的行\n下文')
    const mark = text.querySelector(`mark.${BACKLINK_CLASS_NAMES.hit}`)!
    expect(mark.textContent).toBe('[[目标]]')
  })

  it('命中区间不在片段内：整段无高亮（hit mark 不出现）', () => {
    const panel = buildBacklinksDom().panel
    renderBacklinksState(
      panel,
      ready([itemOf({ snippetStart: undefined, start: 999, end: 1010 })]),
      defaultBacklinkView(),
    )
    expect(panel.querySelector(`mark.${BACKLINK_CLASS_NAMES.hit}`)).toBeNull()
  })
})

describe('renderBacklinksState：工具栏与搜索框', () => {
  it('搜索框默认隐藏（hidden 属性）；开态可见且值回填', () => {
    const panel = buildBacklinksDom().panel
    renderBacklinksState(panel, ready([itemOf()]), defaultBacklinkView())
    const box = panel.querySelector(`.${BACKLINK_CLASS_NAMES.searchBox}`) as HTMLElement
    expect(box.hidden).toBe(true)
    renderBacklinksState(panel, ready([itemOf()]), { ...defaultBacklinkView(), searchOpen: true, query: '目标' })
    expect(box.hidden).toBe(false)
    const input = box.querySelector(`input.${BACKLINK_CLASS_NAMES.searchInput}`) as HTMLInputElement
    expect(input.value).toBe('目标')
  })

  it('固定区复用：重渲染不重建搜索输入（输入节点同一性——焦点不丢）', () => {
    const panel = buildBacklinksDom().panel
    const view: BacklinkPanelView = { ...defaultBacklinkView(), searchOpen: true }
    renderBacklinksState(panel, ready([itemOf()]), view)
    const inputBefore = panel.querySelector(`input.${BACKLINK_CLASS_NAMES.searchInput}`)
    view.query = '目'
    renderBacklinksState(panel, ready([itemOf()]), view)
    const inputAfter = panel.querySelector(`input.${BACKLINK_CLASS_NAMES.searchInput}`)
    expect(inputAfter).toBe(inputBefore)
    expect((inputAfter as HTMLInputElement).value).toBe('目')
  })

  it('搜索过滤后 0 条：无匹配占位（与空态区分），固定区保留', () => {
    const panel = buildBacklinksDom().panel
    renderBacklinksState(
      panel,
      ready([itemOf()]),
      { ...defaultBacklinkView(), searchOpen: true, query: 'zzz不存在的词' },
    )
    expect(panel.querySelector(`.${BACKLINK_CLASS_NAMES.placeholder}`)!.textContent).toBe('无匹配')
    expect(panel.querySelector(`.${BACKLINK_CLASS_NAMES.toolbar}`)).not.toBeNull()
    expect(panel.querySelectorAll(`.${BACKLINK_CLASS_NAMES.card}`)).toHaveLength(0)
  })

  it('排序菜单开态：六项三组、分隔线两条、当前项勾选（aria-checked）', () => {
    const panel = buildBacklinksDom().panel
    renderBacklinksState(
      panel,
      ready([itemOf()]),
      { ...defaultBacklinkView(), sortMenuOpen: true },
    )
    const menu = panel.querySelector(`.${BACKLINK_CLASS_NAMES.sortMenu}`)!
    expect(menu.getAttribute('role')).toBe('menu')
    const items = menu.querySelectorAll(`.${BACKLINK_CLASS_NAMES.sortMenuItem}`)
    expect(items).toHaveLength(6)
    expect(menu.querySelectorAll(`.${BACKLINK_CLASS_NAMES.sortMenuSeparator}`)).toHaveLength(2)
    const checked = menu.querySelector('[aria-checked="true"]') as HTMLElement
    expect(checked.dataset['vsidianSort']).toBe('name-asc')
  })

  it('工具栏按钮 aria 状态随视图态（collapse/context pressed、sort expanded）', () => {
    const panel = buildBacklinksDom().panel
    renderBacklinksState(
      panel,
      ready([itemOf()]),
      { ...defaultBacklinkView(), sortMenuOpen: true, contextLong: true, collapsedGroups: new Set(['notes/来源.md']) },
    )
    const byAction = (action: string): HTMLElement =>
      panel.querySelector(`button[data-action="${action}"]`)!
    expect(byAction('sort').getAttribute('aria-expanded')).toBe('true')
    expect(byAction('context').getAttribute('aria-pressed')).toBe('true')
    // 全折叠（唯一组已折叠）→ collapse pressed 且动作词为「全部展开」
    expect(byAction('collapse').getAttribute('aria-pressed')).toBe('true')
    expect(byAction('collapse').getAttribute('aria-label')).toBe('全部展开')
  })
})

describe('排序菜单清单', () => {
  it('六项三组与语言包键一一对应（BACKLINK_SORT_MENU 文档序）', () => {
    const modes = BACKLINK_SORT_MENU.filter((e) => 'mode' in e).map((e) => e.mode)
    expect(modes).toEqual(['name-asc', 'name-desc', 'mtime-desc', 'mtime-asc', 'birth-desc', 'birth-asc'])
    expect(BACKLINK_SORT_MENU.filter((e) => 'separator' in e)).toHaveLength(2)
  })
})

describe('辅助口径', () => {
  it('来源显示名去 .md 扩展、目录段保留', () => {
    expect(backlinkSourceLabel('notes/设计.md')).toBe('notes/设计')
    expect(backlinkSourceLabel('a/b/Note.MD')).toBe('a/b/Note')
    expect(backlinkSourceLabel('pic.png')).toBe('pic.png')
  })

  it('卡片切分纯函数：区间被片段边界截断时按 clamp 切', () => {
    // 片段长 6（snippetStart=0），区间 [4, 20) → 片段内 [4, 6)
    const segments = backlinkCardSegmentsOf(
      itemOf({ snippet: '引用 [[目', snippetStart: 0, start: 4, end: 20 }),
      false,
    )
    expect(segments).toEqual({ before: '引用 [', hit: '[目', after: '' })
  })

  it('载荷缺省（旧宿主快照）：回退短片段、无高亮', () => {
    const legacy = itemOf({ snippetStart: undefined, snippetLong: undefined, snippetLongStart: undefined })
    expect(backlinkCardSegmentsOf(legacy, true).hit).toBe('')
    expect(backlinkCardSegmentsOf(legacy, true).before).toBe(legacy.snippet)
  })
})
