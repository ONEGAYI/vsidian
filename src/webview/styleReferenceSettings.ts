// 设置页「样式参考」分页（#132）：从生成的数据模块（styleGuideData.ts，
// 由 scripts/genStyleGuide.mjs 从清单单一事实源产出）离线渲染公开样式契约
// 指南——与安装版本配套，无需网络。本页纯只读（无宿主消息），提供：
// 域切换、支持等级过滤、文本搜索（id/target/purpose 即时过滤）。
// UI 文案一律 t() 取词（styleRef.* 词条）；条目内容是文档数据（中文为准）。
import { t } from '../shared/i18n'
import type { StyleContractEntry } from '../shared/styleContract'
import type { SettingsPageSection } from './settingsPageView'
import {
  STYLE_GUIDE_ENTRIES,
  STYLE_GUIDE_VARIABLE_ALIASES,
  STYLE_GUIDE_VERSION,
} from './styleGuideData'

type DomainFilter = 'all' | 'content' | 'chrome'
type SupportFilter = 'all' | 'direct' | 'semantic' | 'native' | 'none'

const KIND_LABEL: Record<string, () => string> = {
  container: () => t('styleRef.kindContainer'),
  selector: () => t('styleRef.kindSelector'),
  variable: () => t('styleRef.kindVariable'),
  limitation: () => t('styleRef.kindLimitation'),
}

const SUPPORT_LABEL: Record<SupportFilter, () => string> = {
  all: () => t('styleRef.filterAll'),
  direct: () => t('styleRef.supportDirect'),
  semantic: () => t('styleRef.supportSemantic'),
  native: () => t('styleRef.supportNative'),
  none: () => t('styleRef.supportNone'),
}

const DOMAIN_LABEL_FN: Record<'all' | 'content' | 'chrome', () => string> = {
  all: () => t('styleRef.filterAll'),
  content: () => t('styleRef.domainContent'),
  chrome: () => t('styleRef.domainChrome'),
}

export class StyleReferenceSection implements SettingsPageSection {
  readonly id = 'style-reference'
  readonly icon = 'book' as const
  get title(): string { return t('styleRef.title') }
  get description(): string { return t('styleRef.description') }

  get entries() {
    // 全局搜索可定位到具体条目（按 id；域/等级过滤不进搜索索引）
    return [
      { id: 'overview', title: t('styleRef.title'), description: t('styleRef.description') },
      ...STYLE_GUIDE_ENTRIES.map((entry) => ({ id: entry.id, title: entry.target })),
    ]
  }

  mount(parent: HTMLElement, focusEntry?: string): () => void {
    parent.replaceChildren()

    // 头部：版本配套说明 + 别名桥要点（文档内容，直接呈现）
    const head = document.createElement('div')
    head.className = 'vsidian-style-ref-head'
    const h = document.createElement('h2')
    h.textContent = t('styleRef.title')
    const ver = document.createElement('p')
    ver.className = 'vsidian-style-ref-version'
    ver.textContent = t('styleRef.versionNote', { version: STYLE_GUIDE_VERSION })
    const bridge = document.createElement('p')
    bridge.className = 'vsidian-style-ref-bridge'
    bridge.textContent = t('styleRef.bridgeNote')
    head.append(h, ver, bridge)
    parent.append(head)

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
    parent.append(varTitle, varTable)

    // 过滤工具行：域选择 + 等级选择 + 搜索框
    const bar = document.createElement('div')
    bar.className = 'vsidian-style-ref-bar'
    const domainSel = document.createElement('select')
    domainSel.className = 'vsidian-settings-select'
    domainSel.setAttribute('aria-label', t('styleRef.domainFilter'))
    const supportSel = document.createElement('select')
    supportSel.className = 'vsidian-settings-select'
    supportSel.setAttribute('aria-label', t('styleRef.supportFilter'))
    const fill = (sel: HTMLSelectElement, keys: readonly (DomainFilter | SupportFilter)[]) => {
      sel.replaceChildren()
      for (const key of keys) {
        const opt = document.createElement('option')
        opt.value = key
        opt.textContent = key in DOMAIN_LABEL_FN
          ? DOMAIN_LABEL_FN[key as DomainFilter]()
          : SUPPORT_LABEL[key as SupportFilter]()
        sel.append(opt)
      }
    }
    fill(domainSel, ['all', 'content', 'chrome'])
    fill(supportSel, ['all', 'direct', 'semantic', 'native', 'none'])
    const search = document.createElement('input')
    search.type = 'search'
    search.className = 'vsidian-style-ref-search'
    search.placeholder = t('styleRef.searchPlaceholder')
    search.setAttribute('aria-label', t('styleRef.searchPlaceholder'))
    bar.append(domainSel, supportSel, search)
    parent.append(bar)

    // 列表容器（过滤即重渲染）
    const list = document.createElement('div')
    list.className = 'vsidian-style-ref-list'
    parent.append(list)

    const render = (): void => {
      const domain = domainSel.value as DomainFilter
      const support = supportSel.value as SupportFilter
      const query = search.value.trim().toLowerCase()
      list.replaceChildren()
      const visible = STYLE_GUIDE_ENTRIES.filter((entry) => {
        if (domain !== 'all' && entry.domain !== domain) return false
        if (support !== 'all' && entry.obsidian.support !== support) return false
        if (query) {
          const haystack = `${entry.id} ${entry.target} ${entry.purpose}`.toLowerCase()
          if (!haystack.includes(query)) return false
        }
        return true
      })
      if (visible.length === 0) {
        const empty = document.createElement('p')
        empty.className = 'vsidian-settings-empty'
        empty.textContent = t('styleRef.empty')
        list.append(empty)
        return
      }
      // 按域 → 种类分组
      const groups = new Map<string, StyleContractEntry[]>()
      for (const entry of visible) {
        const key = `${entry.domain}:${entry.kind}`
        const bucket = groups.get(key) ?? []
        bucket.push(entry)
        groups.set(key, bucket)
      }
      for (const [key, items] of groups) {
        const [domainKey, kindKey] = key.split(':')
        const groupTitle = document.createElement('h3')
        groupTitle.className = 'vsidian-style-ref-group'
        const count = document.createElement('span')
        count.className = 'vsidian-style-ref-count'
        count.textContent = String(items.length)
        groupTitle.append(
          document.createTextNode(
            `${domainKey === 'content' ? t('styleRef.domainContent') : t('styleRef.domainChrome')} · ${(KIND_LABEL[kindKey] ?? (() => kindKey))()} `,
          ),
          count,
        )
        list.append(groupTitle)
        for (const entry of items) {
          list.append(this.renderCard(entry))
        }
      }
    }
    domainSel.addEventListener('change', render)
    supportSel.addEventListener('change', render)
    search.addEventListener('input', render)
    render()

    // 全局搜索定位：滚动到条目卡片并短暂高亮
    if (focusEntry && focusEntry !== 'overview') {
      const target = list.querySelector(`[data-entry="${focusEntry}"]`)
      if (target instanceof HTMLElement) {
        target.classList.add('vsidian-settings-item-located')
        target.scrollIntoView?.({ block: 'start' }) // jsdom 无布局实现（可选调用，与 cssSnippetSettings 同口径）
      }
    }
    return () => undefined
  }

  private renderCard(entry: StyleContractEntry): HTMLElement {
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
