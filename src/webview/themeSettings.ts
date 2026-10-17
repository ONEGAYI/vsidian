// #546 T07 设置页「主题」页签体——统一组件主题单选列表（外观第四页签
// 原位更名后的页签体；外观大卡片内的标准组头与单选行）。
//
// 数据流（目录与首选权威在宿主）：
// - 目录：装载即拉取 addons.themesGet → 宿主应答/推送 addons.themesState
//   （目录 + 唯一首选 + 可用性；等值幂等）→ store 更新并重渲染；
// - 选中写入：radio change → settings.set（appearanceThemePatch 单键——
//   #535 T08 后旧 Mermaid 键投影退役）→ 宿主 settings.changed 回推 +
//   themesState 对账（本地乐观选中先行）；
// - 来源徽章：default 标「内置」；组件主题标组件显示名（经
//   addons.state 的组件清单解析——同名主题按来源区分的落点）；
// - 不可用主题：radio 禁用 + 「不可用」徽章（条目保留呈现，不隐藏）；
//   首选组件主题不可用时列表上方回落提示 callout（保留首选的回显）。
//
// #535 T08：内置 Codex 单选项已随内核退役删除（组件版 Codex 经附加组件
// 提供并出现在目录主题列表中）。
//
// 呈现形态（ui-patterns §2.2/§2.3）：h3 组头挂外观大卡片内（负边距全幅）、
// 单选行复用设置行节奏（radio 键盘可达 + 名称 + 来源徽章 11px pill）。
import { currentLocaleLang, onLocaleChanged, t } from '../shared/i18n'
import { resolveLocalizedText } from '../shared/localizedText'
import {
  DEFAULT_THEME_ID,
  isAddonThemesStatePayload,
  parseAddonThemeRef,
  type AddonThemesStatePayload,
} from '../shared/addonThemes'
import { appearanceThemePatch } from '../shared/settings'
import { groupIcon } from './settingsPageView'

/** 页面级主题目录 store（宿主推送权威；设置页与外观分页共用） */
export class AddonThemesStore {
  private state: AddonThemesStatePayload | null = null
  private addonLabels = new Map<string, string>()
  private readonly listeners = new Set<() => void>()

  /** 宿主 addons.themesState 应用（等值跳过） */
  applyThemesState(payload: unknown): boolean {
    if (!isAddonThemesStatePayload(payload)) {
      return false
    }
    if (this.state?.version === payload.version && themesStateEqual(this.state, payload)) {
      return false
    }
    this.state = payload
    this.notifyChanged()
    return true
  }

  /** addons.state 到达时刷新组件显示名表（来源徽章解析） */
  applyAddonLabels(addons: readonly { id: string; label: string }[]): void {
    let changed = false
    for (const entry of addons) {
      if (this.addonLabels.get(entry.id) !== entry.label) {
        this.addonLabels.set(entry.id, entry.label)
        changed = true
      }
    }
    if (changed) {
      this.notifyChanged()
    }
  }

  snapshot(): AddonThemesStatePayload | null {
    return this.state
  }

  addonLabelOf(addonId: string): string | undefined {
    return this.addonLabels.get(addonId)
  }

  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notifyChanged(): void {
    for (const listener of [...this.listeners]) {
      listener()
    }
  }
}

function themesStateEqual(a: AddonThemesStatePayload, b: AddonThemesStatePayload): boolean {
  return JSON.stringify([a.themes, a.preferred, a.preferredAvailable]) ===
    JSON.stringify([b.themes, b.preferred, b.preferredAvailable])
}

interface ThemeOption {
  /** 单选值（default / codex / themeRef） */
  value: string
  /** 显示名（组件主题按页面语言解析） */
  title: string
  /** 来源徽章文本（内置主题标「内置」；组件主题标组件显示名） */
  source: string
  /** 组件主题且不可用（radio 禁用 + 徽章） */
  unavailable: boolean
}

/** 目录 + 首选 → 单选选项集（内置 default 置前，目录按 themeRef 稳定序） */
export function themeOptionsOf(state: AddonThemesStatePayload | null, addonLabelOf: (addonId: string) => string | undefined, locale: string): ThemeOption[] {
  const builtin: ThemeOption[] = [
    { value: DEFAULT_THEME_ID, title: t('setting.theme.defaultOption'), source: t('appearance.theme.sourceBuiltin'), unavailable: false },
  ]
  if (!state) {
    return builtin
  }
  const themed = [...state.themes]
    .sort((a, b) => (a.themeRef < b.themeRef ? -1 : 1))
    .map((theme): ThemeOption => ({
      value: theme.themeRef,
      title: resolveLocalizedText(theme.label, locale) || theme.themeId,
      source: addonLabelOf(theme.addonId) ?? theme.addonId,
      unavailable: !theme.available,
    }))
  if (!state.preferredAvailable && !themed.some((theme) => theme.value === state.preferred)) {
    const addonId = parseAddonThemeRef(state.preferred)?.addonId ?? state.preferred
    themed.push({ value: state.preferred, title: state.preferred, source: addonLabelOf(addonId) ?? addonId, unavailable: true })
  }
  return [...builtin, ...themed]
}

export interface ThemeSelectionSectionPorts {
  postMessage(message: unknown): void
}

/**
 * 主题单选页签体（外观第四页签；mount 返回清理函数）。
 * 重渲染时机：目录/首选/可用性推送、组件显示名推送、语言切换（由
 * settingsMain 的 locale 链路调 refresh()）。
 */
export class ThemeSelectionSection {
  private hostElements: HTMLElement[] = []

  constructor(
    private readonly store: AddonThemesStore,
    private readonly ports: ThemeSelectionSectionPorts,
  ) {
    store.onChanged(() => this.refresh())
    // 语言切换后就地重渲染（组件主题显示名按新语言解析——H-U08）
    onLocaleChanged(() => this.refresh())
  }

  /** 语言切换后就地重渲染（显示名按新语言解析） */
  refresh(): void {
    if (this.hostElements.length === 0) {
      return
    }
    const parent = this.hostElements[0]!.parentElement
    if (!parent) {
      return
    }
    for (const el of this.hostElements) {
      el.remove()
    }
    this.hostElements = []
    parent.append(...this.buildContent())
  }

  /** 搜索索引条目（外观分页聚合：主题设置入口 → 路由到本页签） */
  get entries(): readonly { id: string; title: string; description?: string }[] {
    return [{ id: 'appearance.theme', title: t('setting.theme.title'), description: t('setting.theme.description') }]
  }

  mount(parent: HTMLElement, focusEntry?: string): () => void {
    parent.replaceChildren()
    const content = this.buildContent(focusEntry)
    parent.append(...content)
    return () => {
      this.hostElements = []
    }
  }

  /** 当前选中值（宿主目录权威——装载即拉取 addons.themesGet 必达；
   *  未达时回 default，首拍目录到达后对账重渲染） */
  private preferredValue(): string {
    return this.store.snapshot()?.preferred ?? DEFAULT_THEME_ID
  }

  private buildContent(focusEntry?: string): HTMLElement[] {
    const state = this.store.snapshot()
    const options = themeOptionsOf(state, (id) => this.store.addonLabelOf(id), currentLocaleLang())
    const preferred = this.preferredValue()
    const elements: HTMLElement[] = []
    const focused = focusEntry === 'appearance.theme'

    // 外观大卡片承载组头，不在页签面板内再套卡片。
    const group = document.createElement('div')
    group.className = 'vsidian-theme-group'
    const title = document.createElement('h3')
    title.className = 'vsidian-settings-group-title'
    title.append(groupIcon('codeblock'), document.createTextNode(t('appearance.themes')))
    group.append(title)
    if (focused) {
      group.classList.add('vsidian-theme-group-located')
      group.setAttribute('tabindex', '-1')
    }

    // 首选不可用回落提示（保留首选的回显——不静默换主题；#535 后退役的
    // codex 历史值同样按「未知首选不可用」呈现）
    if (state && state.preferred !== DEFAULT_THEME_ID && !state.preferredAvailable) {
      const callout = document.createElement('p')
      callout.className = 'vsidian-settings-callout vsidian-theme-fallback'
      callout.setAttribute('role', 'note')
      callout.textContent = t('appearance.theme.fallbackNotice')
      group.append(callout)
    }

    // 单选列表（role=radiogroup + 真 radio 键盘可达）
    const listbox = document.createElement('div')
    listbox.className = 'vsidian-theme-options'
    listbox.setAttribute('role', 'radiogroup')
    listbox.setAttribute('aria-label', t('appearance.themes'))
    for (const option of options) {
      const row = document.createElement('label')
      row.className = 'vsidian-theme-option'
      const radio = document.createElement('input')
      radio.type = 'radio'
      radio.name = 'vsidian-appearance-theme'
      radio.value = option.value
      radio.checked = option.value === preferred
      radio.disabled = option.unavailable
      radio.addEventListener('change', () => {
        if (!radio.checked) {
          return
        }
        // 单键写入（新键完整主题身份）——保存回执经
        // settings.changed 回推，目录 preferred 随 themesState 对账
        this.ports.postMessage({ kind: 'settings.set', values: appearanceThemePatch(option.value) })
      })
      const nameText = document.createElement('span')
      nameText.className = 'vsidian-theme-option-name'
      nameText.textContent = option.title
      const source = document.createElement('span')
      source.className = 'vsidian-addons-source-badge vsidian-theme-option-source'
      source.textContent = option.source
      row.append(radio, nameText, source)
      if (option.unavailable) {
        const badge = document.createElement('span')
        badge.className = 'vsidian-addons-source-badge vsidian-theme-option-unavailable'
        badge.textContent = t('appearance.theme.unavailable')
        row.append(badge)
      }
      listbox.append(row)
    }
    group.append(listbox)
    elements.push(group)

    this.hostElements = elements
    return elements
  }
}
