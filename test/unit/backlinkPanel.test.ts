// @vitest-environment jsdom
// #197 反链面板 DOM 契约测试：四态渲染、类名锚点与条目载荷（跳转意图的
// 数据源——dataset 存相对路径 + 偏移，绝对路径从快照 items 取）。
import { describe, expect, it } from 'vitest'
import {
  backlinkPlaceholderKeyOf,
  backlinkSourceLabel,
  BACKLINK_CLASS_NAMES,
  buildBacklinksDom,
  renderBacklinksState,
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
    start: 12,
    end: 20,
    line: 3,
    snippet: '引用 [[目标]] 的行',
    ...overrides,
  }
}

describe('buildBacklinksDom', () => {
  it('按钮与面板带稳定类名与可访问语义；初始为 loading 占位', () => {
    const { toggle, panel } = buildBacklinksDom()
    expect(toggle.className).toBe('vsidian-backlinks-toggle')
    expect(panel.className).toBe(BACKLINK_CLASS_NAMES.panel)
    expect(panel.getAttribute('role')).toBe('region')
    expect(panel.getAttribute('aria-label')).toBe('反向链接')
    expect(panel.querySelector(`.${BACKLINK_CLASS_NAMES.placeholder}`)).not.toBeNull()
    expect(backlinkPlaceholderKeyOf({ state: 'loading', updating: false, items: [] })).toBe('backlinks.loading')
  })
})

describe('renderBacklinksState：四态', () => {
  it('ready + items：条目按序渲染（来源行 + 片段行），dataset 携带跳转定位键', () => {
    const panel = buildBacklinksDom().panel
    const items = [
      itemOf(),
      itemOf({ sourceRelPath: 'other.md', sourceFsPath: 'C:/vault/other.md', kind: 'mdlink', line: 9, start: 40, end: 60 }),
    ]
    renderBacklinksState(panel, { state: 'ready', updating: false, items })
    const nodes = panel.querySelectorAll(`.${BACKLINK_CLASS_NAMES.item}`)
    expect(nodes).toHaveLength(2)
    const first = nodes[0] as HTMLElement
    expect(first.dataset['vsidianSource']).toBe('notes/来源.md')
    expect(first.dataset['vsidianOffset']).toBe('12')
    expect(first.querySelector(`.${BACKLINK_CLASS_NAMES.itemSource}`)!.textContent)
      .toBe('notes/来源:3')
    expect(first.querySelector(`.${BACKLINK_CLASS_NAMES.itemSnippet}`)!.textContent)
      .toBe('引用 [[目标]] 的行')
    expect(first.getAttribute('aria-label')).toContain('notes/来源')
  })

  it('ready + updating：首行渲染更新中细条', () => {
    const panel = buildBacklinksDom().panel
    renderBacklinksState(panel, { state: 'ready', updating: true, items: [itemOf()] })
    expect(panel.querySelector(`.${BACKLINK_CLASS_NAMES.updating}`)).not.toBeNull()
    expect(panel.querySelectorAll(`.${BACKLINK_CLASS_NAMES.item}`)).toHaveLength(1)
  })

  it('ready + 空 items：空态占位（无引用）', () => {
    const panel = buildBacklinksDom().panel
    renderBacklinksState(panel, { state: 'ready', updating: false, items: [] })
    expect(backlinkPlaceholderKeyOf({ state: 'ready', updating: false, items: [] })).toBe('backlinks.empty')
    expect(panel.querySelector(`.${BACKLINK_CLASS_NAMES.item}`)).toBeNull()
    expect(panel.querySelector(`.${BACKLINK_CLASS_NAMES.placeholder}`)!.textContent).toBe('没有反向链接')
  })

  it('error 态：无工作区与读取失败分开文案', () => {
    const panel = buildBacklinksDom().panel
    renderBacklinksState(panel, { state: 'error', updating: false, reason: 'no-workspace', items: [] })
    expect(panel.querySelector(`.${BACKLINK_CLASS_NAMES.placeholder}`)!.textContent)
      .toBe('未打开工作区，无法查看反向链接')
    renderBacklinksState(panel, { state: 'error', updating: false, reason: 'read-error', items: [] })
    expect(panel.querySelector(`.${BACKLINK_CLASS_NAMES.placeholder}`)!.textContent).toBe('反向链接不可用')
  })
})

describe('辅助口径', () => {
  it('来源显示名去 .md 扩展、目录段保留', () => {
    expect(backlinkSourceLabel('notes/设计.md')).toBe('notes/设计')
    expect(backlinkSourceLabel('a/b/Note.MD')).toBe('a/b/Note')
    expect(backlinkSourceLabel('pic.png')).toBe('pic.png')
  })
})
