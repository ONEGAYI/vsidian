// @vitest-environment jsdom
// 设置页「外观」合并分页契约（#231）：侧栏「CSS 片段」与「样式参考」合并为
// 一条「外观」（调色板图标，取 CSS 片段原槽位），扁平三页签（CSS 片段 /
// 样式参考 / 详细查询）复用样式参考现有 tablist 页签机制（pill 页签 +
// aria-selected 单选 + hidden 面板切换），组合复用 CssSnippetSettingsSection
// 与 StyleReferenceSection 作为页签体，不重写两者内部逻辑。
// 断言落在用户可见层（页签切换后的可见面板与文案、定位高亮），不落纯 DOM
// 存在性（PR #37 教训：样式注入失效时 DOM 存在性照样通过）。
import { describe, it, expect, beforeAll } from 'vitest'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import { isHostToWebview } from '../../src/shared/protocol'
import { AppearanceSection, routeAppearanceTab } from '../../src/webview/appearanceSettings'
import { CssSnippetSettingsSection } from '../../src/webview/cssSnippetSettings'
import { StyleReferenceSection } from '../../src/webview/styleReferenceSettings'
import { STYLE_GUIDE_VERSION } from '../../src/webview/styleGuideData'

beforeAll(() => {
  installLocale('zh-cn', zhCn)
})

/** 组合装配：snippets + styleRef → 外观分页；返回句柄供用例注入与断言 */
function makeAppearance(focusEntry?: string) {
  const sent: unknown[] = []
  const bridge = { postMessage: (m: unknown) => { sent.push(m) } }
  const snippets = new CssSnippetSettingsSection(bridge)
  const styleRef = new StyleReferenceSection(bridge)
  const appearance = new AppearanceSection(snippets, styleRef)
  const parent = document.createElement('div')
  const dispose = appearance.mount(parent, focusEntry)
  return { appearance, snippets, styleRef, parent, sent, dispose }
}

/** 模拟宿主下发 snippets.state（经协议校验的正式形态，与生产消息同源） */
function pushState(
  section: CssSnippetSettingsSection,
  state: {
    directory: string | null; readError?: boolean; paused?: boolean; version?: number
    entries?: Array<{ name: string; enabled: boolean }>
  },
): void {
  const message = {
    kind: 'snippets.state',
    directory: state.directory,
    readError: state.readError ?? false,
    paused: state.paused ?? false,
    version: state.version ?? 1,
    entries: state.entries ?? [],
  }
  expect(isHostToWebview(message)).toBe(true)
  section.handleHostMessage(message)
}

/** 页签按钮（按 data-tab 定位） */
function tabOf(parent: HTMLElement, id: string): HTMLButtonElement {
  const tab = parent.querySelector<HTMLButtonElement>(`.vsidian-style-ref-tab[data-tab="${id}"]`)
  expect(tab, `页签 ${id} 应已渲染`).toBeTruthy()
  return tab!
}

describe('搜索定位路由（routeAppearanceTab 纯函数）', () => {
  it('按条目归属落页签：片段文件与目录行 → CSS 片段；overview → 样式参考；契约条目 → 详细查询；无定位默认 CSS 片段', () => {
    expect(routeAppearanceTab(undefined)).toBe('cssSnippets')
    expect(routeAppearanceTab('directory')).toBe('cssSnippets')
    expect(routeAppearanceTab('snippet:github.css')).toBe('cssSnippets')
    expect(routeAppearanceTab('overview')).toBe('overview')
    expect(routeAppearanceTab('outline-search-hit')).toBe('detail')
    expect(routeAppearanceTab('any-contract-entry')).toBe('detail')
  })
})

describe('三页签结构与默认页签', () => {
  it('挂载即三页签齐备（顺序与文案沿用现有键），默认落在 CSS 片段页签', () => {
    const { parent } = makeAppearance()
    const tabs = [...parent.querySelectorAll<HTMLButtonElement>('.vsidian-style-ref-tab')]
    expect(tabs.map((b) => b.textContent)).toEqual([
      zhCn['cssSnippets.title'], zhCn['styleRef.tabOverview'], zhCn['styleRef.tabDetail'],
    ])
    expect(tabOf(parent, 'cssSnippets').getAttribute('aria-selected')).toBe('true')
    expect(tabOf(parent, 'overview').getAttribute('aria-selected')).toBe('false')
    expect(tabOf(parent, 'detail').getAttribute('aria-selected')).toBe('false')
    expect(parent.querySelector('[role="tablist"]')!.getAttribute('aria-label')).toBe(zhCn['styleRef.tabNav'])
    // 可见面板：CSS 片段目录行与动作按钮对用户可见；总表/详细查询隐藏
    expect(parent.querySelector('.vsidian-appearance-snippets')!.hasAttribute('hidden')).toBe(false)
    expect(parent.querySelector('.vsidian-css-snippets-actions')!.textContent)
      .toContain(zhCn['cssSnippets.chooseDirectory'])
    expect(parent.querySelector('.vsidian-style-ref-overview')!.hasAttribute('hidden')).toBe(true)
    expect(parent.querySelector('.vsidian-style-ref-detail')!.hasAttribute('hidden')).toBe(true)
  })

  it('切到样式参考：总表可见（版本说明 + 变量别名总表），其余页签隐藏；切回 CSS 片段恢复', () => {
    const { parent } = makeAppearance()
    tabOf(parent, 'overview').click()
    const overview = parent.querySelector('.vsidian-style-ref-overview')!
    expect(overview.hasAttribute('hidden')).toBe(false)
    expect(overview.textContent)
      .toContain(zhCn['styleRef.versionNote'].replace('{version}', STYLE_GUIDE_VERSION))
    expect(overview.querySelector('.vsidian-style-ref-vars tbody tr')).toBeTruthy()
    expect(parent.querySelector('.vsidian-style-ref-detail')!.hasAttribute('hidden')).toBe(true)
    expect(parent.querySelector('.vsidian-appearance-snippets')!.hasAttribute('hidden')).toBe(true)
    tabOf(parent, 'cssSnippets').click()
    expect(parent.querySelector('.vsidian-appearance-snippets')!.hasAttribute('hidden')).toBe(false)
    expect(overview.hasAttribute('hidden')).toBe(true)
  })

  it('切到详细查询：查询布局可见（类目栏 + 过滤搜索），总表隐藏', () => {
    const { parent } = makeAppearance()
    tabOf(parent, 'detail').click()
    const detail = parent.querySelector('.vsidian-style-ref-detail')!
    expect(detail.hasAttribute('hidden')).toBe(false)
    expect(detail.querySelector('.vsidian-style-ref-cats')).toBeTruthy()
    expect(detail.querySelector('.vsidian-style-ref-search')).toBeTruthy()
    expect(parent.querySelector('.vsidian-style-ref-overview')!.hasAttribute('hidden')).toBe(true)
  })
})

describe('全局搜索 entries 与定位路由', () => {
  it('entries 聚合两子分页：片段目录/文件动态并入 + overview + 契约全部条目', () => {
    const { appearance, snippets } = makeAppearance()
    const ids = () => appearance.entries.map((e) => e.id)
    expect(ids()).toContain('directory')
    expect(ids()).toContain('overview')
    expect(ids()).toContain('outline-search-hit')
    pushState(snippets, { directory: 'D:/x', entries: [{ name: 'a.css', enabled: false }] })
    expect(ids()).toContain('snippet:a.css')
  })

  it('focusEntry=契约条目：默认落详细查询页签且条目卡片定位高亮', () => {
    const { parent } = makeAppearance('outline-search-hit')
    expect(tabOf(parent, 'detail').getAttribute('aria-selected')).toBe('true')
    expect(tabOf(parent, 'cssSnippets').getAttribute('aria-selected')).toBe('false')
    const card = parent.querySelector<HTMLElement>('[data-entry="outline-search-hit"]')
    expect(card, '目标条目卡片应已渲染').toBeTruthy()
    expect(card!.classList.contains('vsidian-settings-item-located')).toBe(true)
    expect(parent.querySelector('.vsidian-style-ref-detail')!.hasAttribute('hidden')).toBe(false)
  })

  it('focusEntry=overview：落样式参考页签（总表可见）', () => {
    const { parent } = makeAppearance('overview')
    expect(tabOf(parent, 'overview').getAttribute('aria-selected')).toBe('true')
    expect(parent.querySelector('.vsidian-style-ref-overview')!.hasAttribute('hidden')).toBe(false)
    expect(parent.querySelector('.vsidian-style-ref-detail')!.hasAttribute('hidden')).toBe(true)
  })

  it('focusEntry=directory：落 CSS 片段页签且目录行定位高亮', () => {
    const { parent } = makeAppearance('directory')
    expect(tabOf(parent, 'cssSnippets').getAttribute('aria-selected')).toBe('true')
    const dirRow = parent.querySelector('.vsidian-css-snippets-directory')!
    expect(parent.querySelector('.vsidian-appearance-snippets')!.hasAttribute('hidden')).toBe(false)
    expect(dirRow.classList.contains('vsidian-settings-item-located')).toBe(true)
    expect(parent.querySelector('.vsidian-style-ref-overview')!.hasAttribute('hidden')).toBe(true)
  })
})

describe('组合接线（snippets.state 直连实例不回归）', () => {
  it('组合形态下宿主状态推送就地回显：CSS 片段页签体目录与开关更新', () => {
    const { snippets, parent } = makeAppearance()
    pushState(snippets, { directory: 'D:/片段', entries: [{ name: 'a.css', enabled: false }] })
    expect(parent.querySelector('.vsidian-css-snippets-directory-path')?.textContent).toBe('D:/片段')
    expect(parent.querySelectorAll<HTMLInputElement>('input[data-snippet-name]')).toHaveLength(1)
    expect(parent.querySelector<HTMLInputElement>('input[data-snippet-name="a.css"]')!.checked).toBe(false)
  })

  it('卸载清理：dispose 后状态推送不再写入面板（页签体 parent 脱管）', () => {
    const { snippets, parent, dispose } = makeAppearance()
    dispose()
    pushState(snippets, { directory: 'D:/y', entries: [{ name: 'z.css', enabled: true }] })
    expect(parent.querySelector('.vsidian-css-snippets-directory-path')?.textContent)
      .toBe(zhCn['cssSnippets.noDirectory'])
    expect(parent.querySelectorAll('input[data-snippet-name]')).toHaveLength(0)
  })
})
