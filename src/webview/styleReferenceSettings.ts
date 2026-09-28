// 设置页「样式参考」分页（#132）：从生成的数据模块（styleGuideData.ts，
// 由 scripts/genStyleGuide.mjs 从清单单一事实源产出）离线渲染公开样式契约
// 指南——与安装版本配套，无需网络。
// #145 起改为小类分栏 + 分页：左侧类目栏按 content/chrome 域分组（含条目
// 计数，域切换语义并入分组呈现），右侧条目卡片每页 15 条（上一页/下一页 +
// 「第 x/y 页」导航，类目切换重置到第一页）；支持等级过滤与文本搜索保留
// ——搜索命中跨类目时以聚合结果呈现并标注来源类目。
// #145 契约 JSON 导出：工具区「导出 JSON」按钮经消息桥请求宿主另存
// （导出内容与 VSIX 内 style-reference.json 同一数据源）。
// #155 小改：总分页签两态——「样式参考」总表（版本说明、别名桥要点、变量
// 别名总表）与「详细查询」（类目分栏 + 过滤搜索 + 分页）；全局搜索定位条目
// 时直接落入详细查询页签。
// UI 文案一律 t() 取词（styleRef.* 词条）；条目内容是文档数据（中文为准）。
import { t } from '../shared/i18n'
import type { StyleContractCategory, StyleContractEntry } from '../shared/styleContract'
import type { SettingsPageSection } from './settingsPageView'
import {
  STYLE_GUIDE_CATEGORIES,
  STYLE_GUIDE_ENTRIES,
  STYLE_GUIDE_VARIABLE_ALIASES,
  STYLE_GUIDE_VERSION,
} from './styleGuideData'

type SupportFilter = 'all' | 'direct' | 'semantic' | 'native' | 'none'

/** 每页条目数（约 15 条：一屏可扫读，115 条清单最长类目分两页） */
const PAGE_SIZE = 15

const SUPPORT_LABEL: Record<SupportFilter, () => string> = {
  all: () => t('styleRef.filterAll'),
  direct: () => t('styleRef.supportDirect'),
  semantic: () => t('styleRef.supportSemantic'),
  native: () => t('styleRef.supportNative'),
  none: () => t('styleRef.supportNone'),
}

/** 类目条目数（按当前全集条目推导；与契约 JSON 的 count 同口径） */
export function categoryEntryCounts(entries: readonly StyleContractEntry[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const entry of entries) {
    counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1)
  }
  return counts
}

/** 类目在域内的呈现序（order 升序；content 域在前） */
function orderedCategories(categories: readonly StyleContractCategory[]): StyleContractCategory[] {
  return [...categories].sort((a, b) => (a.domain === b.domain
    ? a.order - b.order
    : (a.domain === 'content' ? -1 : 1) - (b.domain === 'content' ? -1 : 1)))
}

export interface StyleReferenceBridge { postMessage(message: unknown): void }

export class StyleReferenceSection implements SettingsPageSection {
  readonly id = 'style-reference'
  readonly icon = 'book' as const
  get title(): string { return t('styleRef.title') }
  get description(): string { return t('styleRef.description') }

  constructor(private readonly bridge?: StyleReferenceBridge) {}

  get entries() {
    // 全局搜索可定位到具体条目（按 id；过滤不进搜索索引）
    return [
      { id: 'overview', title: t('styleRef.title'), description: t('styleRef.description') },
      ...STYLE_GUIDE_ENTRIES.map((entry) => ({ id: entry.id, title: entry.target })),
    ]
  }

  mount(parent: HTMLElement, focusEntry?: string): () => void {
    parent.replaceChildren()

    // ---- 总分页签（#155 小改）：总表 / 详细查询两态，aria-selected 单选 ----
    // 全局搜索定位条目（focusEntry 非 overview）时直接落入详细查询
    const initialTab = focusEntry && focusEntry !== 'overview' ? 'detail' : 'overview'
    const tabbar = document.createElement('div')
    tabbar.className = 'vsidian-style-ref-tabs'
    tabbar.setAttribute('role', 'tablist')
    tabbar.setAttribute('aria-label', t('styleRef.tabNav'))
    const overviewPanel = document.createElement('div')
    overviewPanel.className = 'vsidian-style-ref-overview'
    overviewPanel.setAttribute('role', 'tabpanel')
    const detailPanel = document.createElement('div')
    detailPanel.className = 'vsidian-style-ref-detail'
    detailPanel.setAttribute('role', 'tabpanel')
    const tabs = new Map<string, HTMLButtonElement>()
    const setTab = (tab: string): void => {
      for (const [id, button] of tabs) {
        button.setAttribute('aria-selected', id === tab ? 'true' : 'false')
      }
      overviewPanel.toggleAttribute('hidden', tab !== 'overview')
      detailPanel.toggleAttribute('hidden', tab !== 'detail')
    }
    for (const id of ['overview', 'detail'] as const) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'vsidian-style-ref-tab'
      button.dataset['tab'] = id
      button.setAttribute('role', 'tab')
      button.textContent = id === 'overview' ? t('styleRef.tabOverview') : t('styleRef.tabDetail')
      button.addEventListener('click', () => setTab(id))
      tabs.set(id, button)
      tabbar.append(button)
    }
    parent.append(tabbar)

    // 总表面板：版本配套说明 + 别名桥要点（callout 形态，文档内容直接呈现）。
    // 分页标题由设置页壳层呈现，此处不再重复 h2。
    const ver = document.createElement('p')
    ver.className = 'vsidian-style-ref-version'
    ver.textContent = t('styleRef.versionNote', { version: STYLE_GUIDE_VERSION })
    const bridge = document.createElement('p')
    bridge.className = 'vsidian-style-ref-bridge vsidian-settings-callout'
    bridge.textContent = t('styleRef.bridgeNote')
    overviewPanel.append(ver, bridge)

    // 变量别名总表
    const varTitle = document.createElement('h3')
    varTitle.textContent = t('styleRef.variableTable')
    const varTable = document.createElement('table')
    varTable.className = 'vsidian-style-ref-vars'
    const thead = document.createElement('thead')
    const hrow = document.createElement('tr')
    for (const label of [t('styleRef.varObsidian'), t('styleRef.varVsidian'), t('styleRef.varDefault')]) {
      const th = document.createElement('th')
      th.textContent = label
      hrow.append(th)
    }
    thead.append(hrow)
    const tbody = document.createElement('tbody')
    for (const alias of STYLE_GUIDE_VARIABLE_ALIASES) {
      const row = document.createElement('tr')
      for (const value of [alias.obsidian, alias.vsidian, alias.fallback]) {
        const td = document.createElement('td')
        const code = document.createElement('code')
        code.textContent = value
        td.append(code)
        row.append(td)
      }
      tbody.append(row)
    }
    varTable.append(thead, tbody)
    overviewPanel.append(varTitle, varTable)

    // ---- 小类分栏布局：左侧类目栏（按域分组），右侧条目表 + 分页 ----
    const categories = orderedCategories(STYLE_GUIDE_CATEGORIES)
    const counts = categoryEntryCounts(STYLE_GUIDE_ENTRIES)
    // focusEntry 定位：目标条目所在类目成为初始类目（无目标时首个类目）
    const focusTarget = focusEntry && focusEntry !== 'overview'
      ? STYLE_GUIDE_ENTRIES.find((entry) => entry.id === focusEntry)
      : undefined
    let activeCategory = focusTarget?.category ?? categories[0]!.id
    let page = 1

    const layout = document.createElement('div')
    layout.className = 'vsidian-style-ref-layout'

    // 左侧类目栏（域切换语义并入分组呈现：content / chrome 两组）
    const catNav = document.createElement('nav')
    catNav.className = 'vsidian-style-ref-cats'
    catNav.setAttribute('aria-label', t('styleRef.categoryNav'))
    const catButtons = new Map<string, HTMLButtonElement>()
    const buildCatNav = (): void => {
      catNav.replaceChildren()
      catButtons.clear()
      for (const domain of ['content', 'chrome'] as const) {
        const groupTitle = document.createElement('p')
        groupTitle.className = 'vsidian-style-ref-cats-domain'
        groupTitle.textContent = domain === 'content' ? t('styleRef.domainContent') : t('styleRef.domainChrome')
        catNav.append(groupTitle)
        for (const cat of categories.filter((c) => c.domain === domain)) {
          const button = document.createElement('button')
          button.type = 'button'
          button.className = 'vsidian-style-ref-cat'
          button.dataset['category'] = cat.id
          const name = document.createElement('span')
          name.className = 'vsidian-style-ref-cat-name'
          name.textContent = t(cat.titleKey)
          const count = document.createElement('span')
          count.className = 'vsidian-style-ref-cat-count'
          count.textContent = String(counts.get(cat.id) ?? 0)
          button.append(name, count)
          button.addEventListener('click', () => {
            if (activeCategory === cat.id) return
            activeCategory = cat.id
            page = 1
            render()
          })
          catButtons.set(cat.id, button)
          catNav.append(button)
        }
      }
    }
    buildCatNav()

    // 右侧主体：工具行（等级过滤 + 搜索 + 导出）→ 列表 → 分页导航
    const main = document.createElement('div')
    main.className = 'vsidian-style-ref-main'
    const bar = document.createElement('div')
    bar.className = 'vsidian-style-ref-bar'
    const supportSel = document.createElement('select')
    supportSel.className = 'vsidian-settings-select'
    supportSel.setAttribute('aria-label', t('styleRef.supportFilter'))
    for (const key of ['all', 'direct', 'semantic', 'native', 'none'] as const) {
      const opt = document.createElement('option')
      opt.value = key
      opt.textContent = SUPPORT_LABEL[key]()
      supportSel.append(opt)
    }
    const search = document.createElement('input')
    search.type = 'search'
    search.className = 'vsidian-style-ref-search'
    search.placeholder = t('styleRef.searchPlaceholder')
    search.setAttribute('aria-label', t('styleRef.searchPlaceholder'))
    // #145 契约 JSON 导出：宿主另存（VSIX 内资产同一数据源）
    const exportButton = document.createElement('button')
    exportButton.type = 'button'
    exportButton.className = 'vsidian-style-ref-export'
    exportButton.textContent = t('styleRef.exportJson')
    exportButton.addEventListener('click', () => {
      this.bridge?.postMessage({ kind: 'styleRef.export' })
    })
    bar.append(supportSel, search, exportButton)
    const list = document.createElement('div')
    list.className = 'vsidian-style-ref-list'
    const pager = document.createElement('div')
    pager.className = 'vsidian-style-ref-pager'
    main.append(bar, list, pager)
    layout.append(catNav, main)
    detailPanel.append(layout)
    parent.append(overviewPanel, detailPanel)
    setTab(initialTab)

    const render = (): void => {
      const support = supportSel.value as SupportFilter
      const query = search.value.trim().toLowerCase()
      // 搜索模式：跨类目聚合（等级过滤仍生效）；否则按当前类目浏览
      const searching = query.length > 0
      const pool = searching ? STYLE_GUIDE_ENTRIES : STYLE_GUIDE_ENTRIES.filter((e) => e.category === activeCategory)
      const visible = pool.filter((entry) => {
        if (support !== 'all' && entry.obsidian.support !== support) return false
        if (query) {
          const haystack = `${entry.id} ${entry.target} ${entry.purpose}`.toLowerCase()
          if (!haystack.includes(query)) return false
        }
        return true
      })
      const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
      if (page > pages) page = pages
      const slice = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

      // 类目栏高亮（搜索模式下不标当前类目——结果不限于该类目）
      for (const [id, button] of catButtons) {
        button.setAttribute('aria-current', !searching && id === activeCategory ? 'true' : 'false')
      }

      list.replaceChildren()
      if (visible.length === 0) {
        const empty = document.createElement('p')
        empty.className = 'vsidian-settings-empty'
        empty.textContent = t('styleRef.empty')
        list.append(empty)
      } else if (searching) {
        // 聚合结果提示 + 来源类目标注
        const summary = document.createElement('p')
        summary.className = 'vsidian-style-ref-search-count'
        summary.setAttribute('role', 'status')
        summary.textContent = t('styleRef.searchCount', { count: visible.length })
        list.append(summary)
        for (const entry of slice) {
          list.append(this.renderCard(entry, { withCategory: true }))
        }
      } else {
        for (const entry of slice) {
          list.append(this.renderCard(entry, { withCategory: false }))
        }
      }

      // 分页导航（单页时收起）
      pager.replaceChildren()
      if (pages > 1) {
        const prev = document.createElement('button')
        prev.type = 'button'
        prev.className = 'vsidian-style-ref-page-btn'
        prev.textContent = t('styleRef.prevPage')
        prev.disabled = page <= 1
        prev.addEventListener('click', () => {
          if (page > 1) {
            page -= 1
            render()
          }
        })
        const indicator = document.createElement('span')
        indicator.className = 'vsidian-style-ref-page-indicator'
        indicator.textContent = t('styleRef.pageIndicator', { page, pages })
        const next = document.createElement('button')
        next.type = 'button'
        next.className = 'vsidian-style-ref-page-btn'
        next.textContent = t('styleRef.nextPage')
        next.disabled = page >= pages
        next.addEventListener('click', () => {
          if (page < pages) {
            page += 1
            render()
          }
        })
        pager.append(prev, indicator, next)
      }
    }
    supportSel.addEventListener('change', () => {
      page = 1
      render()
    })
    search.addEventListener('input', () => {
      page = 1
      render()
    })
    render()

    // 全局搜索定位：跳到目标条目所在类目与页，并短暂高亮
    if (focusTarget) {
      const support = supportSel.value as SupportFilter
      const matchesSupport = support === 'all' || focusTarget.obsidian.support === support
      if (matchesSupport) {
        const pool = STYLE_GUIDE_ENTRIES.filter((e) => e.category === focusTarget.category)
        const index = pool.indexOf(focusTarget)
        page = Math.floor(index / PAGE_SIZE) + 1
        render()
      }
      const target = list.querySelector(`[data-entry="${focusEntry}"]`)
      if (target instanceof HTMLElement) {
        target.classList.add('vsidian-settings-item-located')
        target.scrollIntoView?.({ block: 'start' }) // jsdom 无布局实现（可选调用，与 cssSnippetSettings 同口径）
      }
    }
    return () => undefined
  }

  private renderCard(entry: StyleContractEntry, opts: { withCategory: boolean }): HTMLElement {
    const card = document.createElement('article')
    card.className = 'vsidian-style-ref-entry'
    card.dataset['entry'] = entry.id
    const title = document.createElement('h4')
    const code = document.createElement('code')
    code.textContent = entry.target
    const eid = document.createElement('span')
    eid.className = 'vsidian-style-ref-eid'
    eid.textContent = entry.id
    title.append(code, eid)
    card.append(title)

    // 跨类目聚合（搜索模式）时标注来源类目
    if (opts.withCategory) {
      const cat = STYLE_GUIDE_CATEGORIES.find((c) => c.id === entry.category)
      if (cat) {
        const chip = document.createElement('span')
        chip.className = 'vsidian-style-ref-cat-chip'
        chip.textContent = t(cat.titleKey)
        title.append(chip)
      }
    }

    const purpose = document.createElement('p')
    purpose.textContent = entry.purpose
    card.append(purpose)

    const meta = document.createElement('p')
    meta.className = 'vsidian-style-ref-meta'
    const badges = entry.views.length
      ? entry.views.map((v) => (v === 'live' ? t('styleRef.viewLive') : t('styleRef.viewReading'))).join(' / ')
      : t('styleRef.viewNone')
    const support = document.createElement('span')
    support.className = `vsidian-style-ref-support vsidian-style-ref-support-${entry.obsidian.support}`
    support.textContent = SUPPORT_LABEL[entry.obsidian.support as SupportFilter]()
    meta.append(document.createTextNode(`${badges} · `), support)
    if (entry.states) {
      meta.append(document.createTextNode(` · ${entry.states}`))
    }
    card.append(meta)

    const obsidian = document.createElement('p')
    obsidian.className = 'vsidian-style-ref-obsidian'
    obsidian.textContent = `${t('styleRef.obsidianCounterpart')}：${entry.obsidian.counterpart}`
    card.append(obsidian)

    if (entry.aliasTargets?.length) {
      const aliases = document.createElement('p')
      aliases.className = 'vsidian-style-ref-aliases'
      aliases.append(document.createTextNode(`${t('styleRef.aliasTargets')}：`))
      for (const alias of entry.aliasTargets) {
        const a = document.createElement('code')
        a.textContent = alias
        aliases.append(a, document.createTextNode(' '))
      }
      card.append(aliases)
    }

    if (entry.example) {
      const pre = document.createElement('pre')
      const codeBlock = document.createElement('code')
      codeBlock.textContent = entry.example
      pre.append(codeBlock)
      card.append(pre)
    }

    const life = document.createElement('p')
    life.className = 'vsidian-style-ref-life'
    const parts = [entry.introduced]
    if (entry.deprecated) parts.push(`${t('styleRef.deprecated')}：${entry.deprecated}`)
    if (entry.removed) parts.push(`${t('styleRef.removed')}：${entry.removed}`)
    life.textContent = parts.join(' · ')
    card.append(life)
    return card
  }
}
