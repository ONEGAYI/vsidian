// 设置页「外观」合并分页（#231）：侧栏「CSS 片段」与「样式参考」两条分页
// 合并为一条「外观」（调色板图标，取 CSS 片段原槽位，位于快捷键与索引维护
// 之间）。外观页复用样式参考现有 tablist 页签机制（pill 页签 + aria-selected
// 单选 + hidden 面板切换），扁平三页签：CSS 片段 / 样式参考 / 详细查询——
// 不加嵌套层级。实现形态是组合复用：CssSnippetSettingsSection 与
// StyleReferenceSection 作为页签体原样挂载（不重写两者内部逻辑），
// snippets.state 消息接线保持 settingsMain 直连实例不变。
// 搜索定位路由（工单拍板）：按条目归属落页签——片段文件与目录行 → CSS
// 片段页签；契约总表 overview → 样式参考页签；契约条目 → 详细查询页签；
// 无定位（侧栏进入）默认第一页签「CSS 片段」。
import { t } from '../shared/i18n'
import type { SettingsPageSection } from './settingsPageView'
import { CssSnippetSettingsSection } from './cssSnippetSettings'
import { StyleReferenceSection } from './styleReferenceSettings'

/** 外观页页签 id（data-tab 值；顺序即呈现顺序，CSS 片段为第一页签） */
export type AppearanceTab = 'cssSnippets' | 'overview' | 'detail'

/**
 * 搜索定位路由（纯函数）：focusEntry 按条目归属映射到外观页内页签。
 * 片段域条目（目录行 directory / 片段文件 snippet:<文件名>）与无定位
 * （undefined，侧栏进入）落第一页签；契约总表 overview 落样式参考页签；
 * 其余（契约条目 id）落详细查询页签。
 */
export function routeAppearanceTab(focusEntry?: string): AppearanceTab {
  if (!focusEntry) return 'cssSnippets'
  if (focusEntry === 'directory' || focusEntry.startsWith('snippet:')) return 'cssSnippets'
  if (focusEntry === 'overview') return 'overview'
  return 'detail'
}

export class AppearanceSection implements SettingsPageSection {
  readonly id = 'appearance'
  readonly icon = 'palette' as const
  get title(): string { return t('appearance.title') }
  get description(): string { return t('appearance.description') }

  constructor(private readonly snippets: CssSnippetSettingsSection,
    private readonly styleRef: StyleReferenceSection) {}

  /** 全局搜索索引：聚合两子分页条目（片段域 + 契约域），点击后按归属路由 */
  get entries() {
    return [...this.snippets.entries, ...this.styleRef.entries]
  }

  mount(parent: HTMLElement, focusEntry?: string): () => void {
    parent.replaceChildren()
    const tab = routeAppearanceTab(focusEntry)

    // ---- 三页签 tablist：复用样式参考页签机制（类名/aria 语义与 #155 同源，
    // settingsPage.css 的页签样式契约与 detail 可见时主区滚动规则照常生效）----
    const tabbar = document.createElement('div')
    tabbar.className = 'vsidian-style-ref-tabs'
    tabbar.setAttribute('role', 'tablist')
    tabbar.setAttribute('aria-label', t('styleRef.tabNav'))
    const snippetPanel = document.createElement('div')
    snippetPanel.className = 'vsidian-appearance-snippets'
    snippetPanel.setAttribute('role', 'tabpanel')
    const overviewPanel = document.createElement('div')
    overviewPanel.className = 'vsidian-style-ref-overview'
    overviewPanel.setAttribute('role', 'tabpanel')
    const detailPanel = document.createElement('div')
    detailPanel.className = 'vsidian-style-ref-detail'
    detailPanel.setAttribute('role', 'tabpanel')
    const panels: Record<AppearanceTab, HTMLElement> = {
      cssSnippets: snippetPanel, overview: overviewPanel, detail: detailPanel,
    }
    // 页签文案沿用现有键（工单拍板）：页签标题不新增词条
    const tabLabels: Record<AppearanceTab, string> = {
      cssSnippets: t('cssSnippets.title'),
      overview: t('styleRef.tabOverview'),
      detail: t('styleRef.tabDetail'),
    }
    const tabs = new Map<AppearanceTab, HTMLButtonElement>()
    const setTab = (selected: AppearanceTab): void => {
      for (const [id, button] of tabs) {
        button.setAttribute('aria-selected', id === selected ? 'true' : 'false')
      }
      for (const [id, panel] of Object.entries(panels) as Array<[AppearanceTab, HTMLElement]>) {
        panel.toggleAttribute('hidden', id !== selected)
      }
    }
    for (const id of ['cssSnippets', 'overview', 'detail'] as const) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'vsidian-style-ref-tab'
      button.dataset['tab'] = id
      button.setAttribute('role', 'tab')
      button.textContent = tabLabels[id]
      button.addEventListener('click', () => setTab(id))
      tabs.set(id, button)
      tabbar.append(button)
    }
    parent.append(tabbar)

    // 页签体组合挂载：focusEntry 原样传给两侧页签体——两侧定位注册表互不
    // 重叠（directory/snippet:* 仅片段侧命中；overview 与契约 id 仅契约侧
    // 命中），不匹配的一侧按「无定位」处理，与全局搜索行为一致
    const disposeSnippets = this.snippets.mount(snippetPanel, focusEntry)
    this.styleRef.mountPanels(overviewPanel, detailPanel, focusEntry)
    parent.append(snippetPanel, overviewPanel, detailPanel)
    setTab(tab)
    return () => {
      disposeSnippets?.()
    }
  }
}
