// 快捷键设置分页（#91）。#95 i18n：本页文案经 t() 取词（settings./
// keybindingSettings. 前缀）；分页标题/描述与 entries 为 getter——语言
// 换包后由宿主容器重建分页时重新求值。操作名一律 t(op.titleKey) 直取
// （注册表全源持字典键：format.* / command.*，与 manifest NLS 同源）。
// #155 视觉刷新：对齐 Obsidian——顶部单搜索框＋键盘图标切换按键捕获过滤、
// 筛选签（冲突/全部/已分配/由我分配/未分配）、每操作单行（键位牌在右、
// 清空/恢复默认收进 ⋯ 菜单）、点 ＋ 原位变 ✓ 就地出现键位捕获签。
import {
  KEYBINDING_FILTER_KINDS, allKeybindingOperations, applyBindingChange,
  findConflictedOperationIds, formatBindingLabel, getEffectiveBindings,
  operationMatchesFilter, type KeybindingFilterKind, type KeybindingOverrides,
} from '../shared/keybindings'
import { t } from '../shared/i18n'
import type { MessageKey } from '../shared/locales/en'
import type { SettingsPageBridge, SettingsPageSection } from './settingsPageView'
import { keyStep } from './keybindingRouter'
import { isHostToWebview } from '../shared/protocol'

/** 冲突文案等的操作名取词（id 为运行时来源，未登记 id 回退显示 id 本身）。
 *  #359 T10：合并视图（内置 + 组件命令）取操作名——组件命令用注册的自由
 *  文本（titleOverride），内置走字典键 */
function titleOf(op: { readonly titleKey: MessageKey; readonly titleOverride?: string }): string {
  return op.titleOverride ?? t(op.titleKey)
}

function titleOfId(id: string): string {
  const op = allKeybindingOperations().find((item) => item.id === id)
  return op ? titleOf(op) : id
}

/**
 * #164：快照 overrides 与当前是否等价（未收到快照的初始 undefined 视为
 * 「无用户覆盖」，与空对象等价——装载语义即确认默认绑定）。
 */
function sameOverrides(current: KeybindingOverrides | undefined, next: KeybindingOverrides): boolean {
  const base = current ?? {}
  for (const key of new Set([...Object.keys(base), ...Object.keys(next)])) {
    if ((base[key] ?? []).join('\u0000') !== (next[key] ?? []).join('\u0000')) return false
  }
  return true
}

function el(tag: string, cls: string, text = ''): HTMLElement {
  const node = document.createElement(tag)
  node.className = cls
  node.textContent = text
  return node
}

function icon(pathData: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(svg.namespaceURI, 'path')
  path.setAttribute('d', pathData)
  svg.append(path)
  return svg
}

const SEARCH_ICON_PATH = 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0'
const KEYBOARD_ICON_PATH = 'M3 5h18v14H3zM6 9h1m3 0h1m3 0h1m3 0h1m3 0h1M6 12h1m3 0h1m3 0h1m3 0h1M7 16h10'

/** 冲突文案的操作名串接（分隔符随语言：zh 顿号 / en 逗号） */
function joinOpNames(ids: readonly string[]): string {
  return ids.map(titleOfId).join(t('keybindingSettings.nameSeparator'))
}

/** 筛选签取词映射（#155：与共享维度注册表同序） */
const FILTER_LABEL_KEYS: Record<KeybindingFilterKind, MessageKey> = {
  all: 'keybindingSettings.filterAll',
  conflict: 'keybindingSettings.filterConflicts',
  assigned: 'keybindingSettings.filterAssigned',
  userAssigned: 'keybindingSettings.filterUserAssigned',
  unassigned: 'keybindingSettings.filterUnassigned',
}

export class KeybindingSettingsSection implements SettingsPageSection {
  readonly id = 'keybindings'
  readonly icon = 'keyboard'
  get title(): string { return t('keybindingSettings.title') }
  get description(): string { return t('keybindingSettings.description') }
  get entries() {
    // #359 T10：组件命令（运行期操作）一并进入分页条目——描述列以组件 ID
    // 标注归属（命名空间即归属，无需额外文案）
    return allKeybindingOperations().map((op) => {
      const runtime = (op as { addonId?: string }).addonId
      const modeText = t(op.mode === 'both' ? 'keybindingSettings.modeBoth'
        : op.mode === 'live' ? 'keybindingSettings.modeLive' : 'keybindingSettings.modeReading')
      const suffix = runtime !== undefined ? ` · ${op.command} · ${runtime}` : ` · ${op.command}`
      return {
        id: op.id,
        title: titleOf(op),
        description: `${modeText}${suffix}`,
      }
    })
  }

  private overrides: KeybindingOverrides = {}
  private parent: HTMLElement | undefined
  private filtersEl: HTMLElement | undefined
  private resultsEl: HTMLElement | undefined
  private statusEl: HTMLElement | undefined
  private searchEl: HTMLInputElement | undefined
  /** 键位捕获签当前打开的操作（undefined=无） */
  private selected: string | undefined
  /** 捕获签草稿：draft 为完整键位（可两段），draftRaw 为未成两段的裸首段 */
  private draft = ''
  private draftRaw = ''
  /** 提交进行中标记：提交引发的失焦不得当作取消（见 buildCaptureInput） */
  private completing = false
  /** 捕获签重聚焦白名单（N-1）：仅行内动作（save/resetOne）与宿主回推
   *  置位——这些重渲染不是离开意图，焦点落 body 时拉回捕获签继续录制；
   *  筛选签/搜索/菜单外点/恢复默认等入口的重渲染不置位，由 blur 判定
   *  自然取消（否则会劫持离开意图：录制存续+焦点抢回+可能误存键位） */
  private refocusCapture = false
  /** ⋯ 菜单当前打开的操作（一次只开一个） */
  private menuOpenId: string | undefined
  private focusEntry: string | undefined
  private query = ''
  private keyQuery = ''
  private keyQueryRaw = ''
  private searchMode: 'text' | 'key' = 'text'
  private filter: KeybindingFilterKind = 'all'
  private status = ''
  private conflict: { id: string; bindings: string[]; ids: string[]; reset?: boolean } | undefined
  private requestId = 0

  constructor(private readonly bridge: SettingsPageBridge) {}

  /** 视图注入的输入态变化回调（PR #346）：query/keyQuery/searchMode/filter
   *  变化处调用，视图据此重报 uiState 携带 captureState 载荷 */
  private stateSink: (() => void) | undefined

  setStateSink(sink: () => void): void {
    this.stateSink = sink
  }

  /**
   * 会话内恢复（PR #346 方案 A）：序列化分页内输入态四项（搜索词 query、
   * 键位查询 keyQuery、键位过滤模式 searchMode、筛选签 filter）。边界：
   * 键位录制现场（selected/draft/draftRaw）与 ⋯ 菜单开合（menuOpenId）
   * 不入载荷——恢复录制现场无意义且可能误存键位，重载后一律回到非录制
   * 形态；恢复后的列表滚动由设置页主区 scrollTop 链路承担
   */
  captureState(): unknown {
    return {
      query: this.query,
      keyQuery: this.keyQuery,
      searchMode: this.searchMode,
      filter: this.filter,
    }
  }

  /** 应用恢复的输入态（selectSection 在 mount 前调用）。整体形态不符
   *  （非纯对象/数组/空）整条忽略（旧端/损坏载荷安全降级）；对象内
   *  **逐项守卫**——单项形态不符跳过该项、其余照常恢复（review-loops
   *  #346 增量轮勘正：实现自始为逐项，非整条）；text 模式强制清空键位
   *  查询——keyQuery 只在 key 模式有意义，与 setKeyMode 的既有清理行为
   *  同源（capture 自洽载荷不受影响） */
  restoreState(state: unknown): void {
    if (typeof state !== 'object' || state === null || Array.isArray(state)) return
    const record = state as Record<string, unknown>
    if (typeof record.query === 'string') this.query = record.query
    if (record.searchMode === 'text' || record.searchMode === 'key') {
      this.searchMode = record.searchMode
    }
    if (typeof record.keyQuery === 'string') this.keyQuery = this.searchMode === 'text' ? '' : record.keyQuery
    if ((KEYBINDING_FILTER_KINDS as readonly string[]).includes(record.filter as string)) {
      this.filter = record.filter as KeybindingFilterKind
    }
  }

  mount(parent: HTMLElement, focusEntry?: string): () => void {
    this.parent = parent
    if (focusEntry) {
      this.query = ''
      this.keyQuery = ''
      this.keyQueryRaw = ''
      this.filter = 'all'
      this.focusEntry = focusEntry
    }
    this.selected = focusEntry ?? this.selected
    // ⋯ 菜单「点击别处收起」（规格承诺）：document 级 pointerdown 常驻监听，
    // 目标不在当前菜单容器内即收起；随分页卸载移除
    const onDocPointerDown = (event: Event): void => {
      if (!this.menuOpenId) return
      const wrap = this.parent?.querySelector(
        `.vsidian-keybindings-row[data-operation-id="${this.menuOpenId}"] .vsidian-keybindings-menu-wrap`)
      if (wrap && event.target instanceof Node && wrap.contains(event.target)) return
      this.menuOpenId = undefined
      if (event.target instanceof Node && this.resultsEl?.contains(event.target)) {
        // 目标在结果区内（×/＋/另一行 ⋯）：收菜单不是离开意图——置重聚焦
        // 标志保留录制（被点按钮随重渲染替换、click 落空属已记录的两击边界）
        this.refocusCapture = true
      } else {
        // 目标在结果区外（空白/工具栏）：离开意图，录制一并取消
        this.cancelCapture()
      }
      this.renderRows()
    }
    document.addEventListener('pointerdown', onDocPointerDown)
    this.render()
    return () => {
      document.removeEventListener('pointerdown', onDocPointerDown)
      this.parent = undefined
      this.filtersEl = undefined
      this.resultsEl = undefined
      this.statusEl = undefined
      this.searchEl = undefined
    }
  }

  /** #359 T10：组件命令目录变化（addons.commandCatalog 推送/拉取应答后由
   *  settingsMain 调用——setRuntimeOperations 已更新合并视图，此处重渲染
   *  行列表与筛选签使组件命令立即可见） */
  handleCatalogChanged(): void {
    this.renderFilters()
    this.renderRows()
  }

  handleHostMessage(message: unknown): void {
    if (!isHostToWebview(message) ||
      (message.kind !== 'keybindings.snapshot' && message.kind !== 'keybindings.changed')) return
    const payload = message
    // #164 竞态源短路：装载快照（无 requestId）与当前状态幂等时跳过整容器
    // 重建——renderRows 的 replaceChildren 会使已解析的行节点 detached
    // （computed 取空串；CI 负载下装载回流漂移进断言窗口即测试间歇红）。
    // 保存回执带 requestId（status/conflict 更新依赖全渲染）、外部值变更、
    // 冲突待清理三种情形不走此短路。
    if (payload.requestId === undefined && !this.conflict
      && sameOverrides(this.overrides, payload.overrides)) return
    this.overrides = payload.overrides
    if (payload.requestId !== undefined && payload.requestId === this.requestId) {
      this.status = payload.ok ? t('keybindingSettings.saved')
        : payload.reason === 'storage' ? t('keybindingSettings.saveFailedStorage')
          : payload.reason === 'conflict' ? t('keybindingSettings.conflictInternal', { names: joinOpNames(payload.conflicts ?? []) })
            : t('keybindingSettings.invalid')
      if (payload.ok) this.conflict = undefined
    }
    this.updateStatus()
    this.renderFilters()
    this.refocusCapture = true
    this.renderRows()
  }

  private send(message: object): void {
    this.status = t('keybindingSettings.saving')
    this.bridge.postMessage(message)
    this.updateStatus()
    this.renderRows()
  }

  private save(id: string, bindings: string[], replaceConflicts = false): void {
    this.refocusCapture = true // 行内动作：重渲染不是离开意图，录制继续
    const check = applyBindingChange(this.overrides, id, bindings, replaceConflicts)
    if (!check.ok) {
      if (check.reason === 'conflict') {
        this.conflict = { id, bindings, ids: check.conflicts }
        this.status = t('keybindingSettings.conflictSave', { names: joinOpNames(check.conflicts) })
      } else this.status = t('keybindingSettings.invalid')
      this.updateStatus()
      this.renderRows()
      return
    }
    this.conflict = undefined
    this.send({ kind: 'keybindings.set', id, bindings, replaceConflicts,
      requestId: ++this.requestId })
  }

  private resetOne(id: string, replaceConflicts = false): void {
    this.refocusCapture = true // 行内动作（菜单项）：同 save 口径
    const defaults = [...getEffectiveBindings({}, id)]
    const check = applyBindingChange(this.overrides, id, defaults, replaceConflicts)
    if (!check.ok) {
      if (check.reason === 'conflict') {
        this.conflict = { id, bindings: defaults, ids: check.conflicts, reset: true }
        this.status = t('keybindingSettings.conflictReset', { names: joinOpNames(check.conflicts) })
      } else this.status = t('keybindingSettings.resetFailed')
      this.updateStatus()
      this.renderRows()
      return
    }
    this.conflict = undefined
    this.send({ kind: 'keybindings.reset', id, replaceConflicts, requestId: ++this.requestId })
  }

  private button(text: string, action: () => void, cls = ''): HTMLButtonElement {
    const button = el('button', cls, text) as HTMLButtonElement
    button.type = 'button'
    button.addEventListener('click', action)
    return button
  }

  private menuItem(text: string, action: () => void): HTMLButtonElement {
    const item = this.button(text, action, 'vsidian-keybindings-menu-item')
    item.setAttribute('role', 'menuitem')
    return item
  }

  /** 键位捕获签（#155）：就地录制单段或两段键位；Enter/✓ 提交、Esc/失焦取消 */
  private buildCaptureInput(operationId: string, bindings: readonly string[]): HTMLInputElement {
    const input = el('input', 'vsidian-keybindings-capture') as HTMLInputElement
    input.readOnly = true
    input.placeholder = t('keybindingSettings.capturePlaceholder')
    input.setAttribute('aria-label', t('keybindingSettings.capturePlaceholder'))
    input.value = this.draft ? formatBindingLabel(this.draft) : ''
    input.addEventListener('keydown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') { this.cancelCapture(); return }
      if (event.key === 'Enter') {
        if (this.draft) this.commitCapture(operationId, bindings)
        return
      }
      if (event.key === 'Backspace' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        this.draft = ''
        this.draftRaw = ''
        input.value = ''
        const commit = input.closest('.vsidian-keybindings-row')
          ?.querySelector<HTMLButtonElement>('.vsidian-keybindings-commit')
        if (commit) commit.disabled = true
        return
      }
      const step = keyStep(event)
      if (!step) return
      const chord = this.draftRaw ? `${this.draftRaw} ${step}` : step
      this.draftRaw = chord.includes(' ') ? '' : chord
      this.draft = chord
      input.value = formatBindingLabel(chord)
      const commit = input.closest('.vsidian-keybindings-row')
        ?.querySelector<HTMLButtonElement>('.vsidian-keybindings-commit')
      if (commit) commit.disabled = !this.draft
    })
    // 失焦取消录制：双锚定判定（意图 + 现实），直接判 relatedTarget 或
    // activeElement 单独都不可靠——
    //  · 行内动作/宿主回推触发全表重渲染时，旧捕获签被移除会异步派发
    //    relatedTarget=null 的孤儿 blur（此时 renderRows 末尾已把焦点重聚到
    //    新捕获签，单看 activeElement 可化解）；
    //  · headless/部分平台点击按钮焦点实际落 body（relatedTarget 才是点击
    //    意图），单看 activeElement 会误判为用户点空白而取消+重建吞掉 click。
    // 一帧后：焦点意图（relatedTarget）或实际焦点任一落在捕获签/结果区内
    // 控件（×、⋯、✓、另一行 ＋）即录制继续；两者都离开（body、搜索框、
    // 页面其他区域）才取消。提交路径另有 completing 标记双保险
    input.addEventListener('blur', (event) => {
      if (this.completing) return
      const intended = event.relatedTarget
      const intentInside = intended instanceof Node && this.resultsEl?.contains(intended) === true
      requestAnimationFrame(() => {
        if (this.completing || !this.selected) return
        const active = document.activeElement
        if (intentInside
          || (active instanceof Element && (active.classList.contains('vsidian-keybindings-capture')
            || this.resultsEl?.contains(active) === true))) return
        this.cancelCapture()
      })
    })
    return input
  }

  private cancelCapture(): void {
    if (!this.selected) return
    this.selected = undefined
    this.draft = ''
    this.draftRaw = ''
    this.renderRows()
  }

  private commitCapture(operationId: string, bindings: readonly string[]): void {
    if (!this.draft) return
    const chord = this.draft
    this.completing = true
    try {
      this.selected = undefined
      this.draft = ''
      this.draftRaw = ''
      this.save(operationId, [...bindings, chord])
    } finally {
      this.completing = false
    }
  }

  /** 搜索框的按键捕获过滤模式切换（#155）：退回文字模式时清空键位过滤条件 */
  private setKeyMode(on: boolean): void {
    const next: 'text' | 'key' = on ? 'key' : 'text'
    if (this.searchMode === next) return
    this.searchMode = next
    if (!on) {
      this.keyQuery = ''
      this.keyQueryRaw = ''
    }
    this.stateSink?.() // 输入态变化（PR #346）：捕获态上报
    this.render()
    this.searchEl?.focus()
  }

  private render(): void {
    const parent = this.parent
    if (!parent) return
    parent.replaceChildren()
    const toolbar = el('div', 'vsidian-keybindings-toolbar')
    const searchWrap = el('div', 'vsidian-keybindings-search-wrap')
    const magnifier = icon(SEARCH_ICON_PATH)
    magnifier.setAttribute('class', 'vsidian-keybindings-search-icon')
    const nameSearch = el('input', 'vsidian-keybindings-search') as HTMLInputElement
    nameSearch.type = 'search'
    nameSearch.placeholder = this.searchMode === 'key' ? t('keybindingSettings.capturePlaceholder')
      : t('keybindingSettings.searchNamePlaceholder')
    // key 模式为按键捕获面（防粘贴/拖放改写显示值），readOnly 与可访问名
    // 随模式切换，与捕获签同口径
    nameSearch.readOnly = this.searchMode === 'key'
    nameSearch.setAttribute('aria-label', this.searchMode === 'key'
      ? t('keybindingSettings.capturePlaceholder')
      : t('keybindingSettings.searchNamePlaceholder'))
    nameSearch.value = this.searchMode === 'key'
      ? (this.keyQuery ? formatBindingLabel(this.keyQuery) : '')
      : this.query
    nameSearch.addEventListener('input', () => {
      if (this.searchMode !== 'text') return
      this.query = nameSearch.value
      this.stateSink?.() // 输入态变化（PR #346）：捕获态上报
      this.renderRows()
    })
    nameSearch.addEventListener('keydown', (event) => {
      if (this.searchMode !== 'key') {
        if (event.key === 'Escape') {
          nameSearch.value = ''
          this.query = ''
          this.stateSink?.()
          this.renderRows()
        }
        return
      }
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') { this.setKeyMode(false); return }
      if (event.key === 'Backspace' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        this.keyQuery = ''
        this.keyQueryRaw = ''
        nameSearch.value = ''
        this.stateSink?.() // 输入态变化（PR #346）：捕获态上报
        this.renderRows()
        return
      }
      const step = keyStep(event)
      if (!step) return
      const chord = this.keyQueryRaw ? `${this.keyQueryRaw} ${step}` : step
      this.keyQueryRaw = chord.includes(' ') ? '' : chord
      this.keyQuery = chord
      nameSearch.value = formatBindingLabel(chord)
      this.stateSink?.() // 输入态变化（PR #346）：捕获态上报
      this.renderRows()
    })
    const keyToggle = el('button', 'vsidian-keybindings-key-toggle') as HTMLButtonElement
    keyToggle.type = 'button'
    keyToggle.append(icon(KEYBOARD_ICON_PATH))
    keyToggle.setAttribute('data-tooltip', t('keybindingSettings.keySearchToggle'))

    keyToggle.setAttribute('aria-label', t('keybindingSettings.keySearchToggle'))
    keyToggle.setAttribute('aria-pressed', String(this.searchMode === 'key'))
    if (this.searchMode === 'key') keyToggle.classList.add('is-active')
    keyToggle.addEventListener('click', () => this.setKeyMode(this.searchMode !== 'key'))
    searchWrap.append(magnifier, nameSearch, keyToggle)
    toolbar.append(searchWrap, this.button(t('keybindingSettings.resetAll'), () => {
      this.cancelCapture() // 工具栏按钮是离开录制意图（N-1）
      this.send({ kind: 'keybindings.resetAll', requestId: ++this.requestId })
    }))
    parent.append(toolbar)
    const filters = el('div', 'vsidian-keybindings-filters')
    parent.append(filters)
    this.filtersEl = filters
    this.renderFilters()
    const status = el('p', 'vsidian-keybindings-status', this.status)
    status.setAttribute('role', 'status')
    parent.append(status)
    this.statusEl = status
    const results = el('div', 'vsidian-keybindings-results')
    parent.append(results)
    this.resultsEl = results
    this.searchEl = nameSearch
    this.renderRows()
  }

  /** 筛选签行（#155）：冲突签带实时计数，aria-pressed 标选中态 */
  private renderFilters(): void {
    const parent = this.filtersEl
    if (!parent) return
    const conflicted = findConflictedOperationIds(this.overrides)
    parent.replaceChildren()
    for (const kind of KEYBINDING_FILTER_KINDS) {
      const chip = el('button', 'vsidian-keybindings-filter') as HTMLButtonElement
      chip.type = 'button'
      chip.dataset.filter = kind
      chip.setAttribute('aria-pressed', String(this.filter === kind))
      const label = t(FILTER_LABEL_KEYS[kind])
      chip.textContent = kind === 'conflict' ? `${label} (${conflicted.size})` : label
      chip.addEventListener('click', () => {
        this.cancelCapture() // 筛选是离开录制意图（N-1：显式取消，不依赖帧时序）
        this.filter = kind
        this.stateSink?.() // 输入态变化（PR #346）：捕获态上报
        this.renderFilters()
        this.renderRows()
      })
      parent.append(chip)
    }
  }

  private updateStatus(): void {
    if (this.statusEl) this.statusEl.textContent = this.status
  }

  private renderRows(): void {
    const parent = this.resultsEl
    if (!parent) return
    parent.replaceChildren()
    let locatedRow: HTMLElement | undefined
    const conflicted = findConflictedOperationIds(this.overrides)
    const query = this.query.toLocaleLowerCase()
    // #359 T10：行列表消费合并视图（内置 + 组件命令——catalog 推送后
    // setRuntimeOperations 更新，重渲染即呈现）；行名追加组件 ID 标注归属
    const filtered = allKeybindingOperations().filter((op) =>
      titleOf(op).toLocaleLowerCase().includes(query) &&
      operationMatchesFilter(this.overrides, op.id, this.filter, conflicted) &&
      (!this.keyQuery || getEffectiveBindings(this.overrides, op.id).some((binding) =>
        binding === this.keyQuery || binding.startsWith(`${this.keyQuery} `))))
    if (!filtered.length) parent.append(el('p', 'vsidian-settings-empty', t('keybindingSettings.noMatch')))
    for (const op of filtered) {
      const row = el('section', 'vsidian-keybindings-row')
      row.dataset.operationId = op.id
      if (this.focusEntry === op.id) {
        row.classList.add('vsidian-settings-item-located')
        locatedRow = row
      }
      const name = el('div', 'vsidian-keybindings-row-name')
      const addonId = (op as { addonId?: string }).addonId
      name.append(el('strong', '', titleOf(op)),
        el('span', 'vsidian-keybindings-mode', t(op.mode === 'both' ? 'keybindingSettings.modeLiveReading'
          : op.mode === 'live' ? 'keybindingSettings.modeLive' : 'keybindingSettings.modeReading')
          + (addonId !== undefined ? ` · ${addonId}` : '')))
      row.append(name)
      const bindings = getEffectiveBindings(this.overrides, op.id)
      const controls = el('div', 'vsidian-keybindings-row-controls')
      const tags = el('div', 'vsidian-keybindings-tags')
      if (!bindings.length && this.selected !== op.id) {
        tags.append(el('span', 'vsidian-keybindings-unbound', t('keybindingSettings.unbound')))
      }
      for (const binding of bindings) {
        const tag = el('span', 'vsidian-keybindings-tag')
        tag.append(el('kbd', '', formatBindingLabel(binding)), this.button('×', () =>
          this.save(op.id, bindings.filter((item) => item !== binding)), 'vsidian-keybindings-remove'))
        tags.append(tag)
      }
      // 捕获签在键位牌之后（对齐参考基准：就地录制签紧邻 ＋/✓）
      if (this.selected === op.id) tags.append(this.buildCaptureInput(op.id, bindings))
      controls.append(tags)
      // ⋯ 更多操作菜单（#155）：清空绑定/恢复默认收进行内菜单，一次只开一个
      const menuWrap = el('div', 'vsidian-keybindings-menu-wrap')
      const menuButton = this.button('⋯', () => {
        this.menuOpenId = this.menuOpenId === op.id ? undefined : op.id
        this.renderRows()
      }, 'vsidian-keybindings-menu-btn')
      menuButton.setAttribute('aria-label', t('keybindingSettings.moreActions'))
      menuButton.setAttribute('aria-haspopup', 'menu')
      menuButton.setAttribute('aria-expanded', String(this.menuOpenId === op.id))
      menuWrap.append(menuButton)
      if (this.menuOpenId === op.id) {
        const menu = el('div', 'vsidian-keybindings-menu')
        menu.setAttribute('role', 'menu')
        menu.append(
          this.menuItem(t('keybindingSettings.clearBindings'), () => {
            this.menuOpenId = undefined
            this.save(op.id, [])
          }),
          this.menuItem(t('keybindingSettings.resetDefault'), () => {
            this.menuOpenId = undefined
            this.resetOne(op.id)
          }))
        menuWrap.append(menu)
      }
      controls.append(menuWrap)
      // ＋ / ✓（#155）：捕获态下 ＋ 原位变提交钮，草稿为空时禁用
      if (this.selected === op.id) {
        const commit = this.button('✓', () => this.commitCapture(op.id, bindings), 'vsidian-keybindings-commit')
        commit.setAttribute('aria-label', t('keybindingSettings.commitCapture'))
        commit.disabled = !this.draft
        // pointerdown preventDefault：点击提交不把焦点从捕获签夺走，避免
        // 先失焦（=取消）再点击的竞态；click 仍正常派发
        commit.addEventListener('pointerdown', (event) => event.preventDefault())
        controls.append(commit)
      } else {
        const add = this.button('＋', () => {
          this.selected = op.id
          this.draft = ''
          this.draftRaw = ''
          this.menuOpenId = undefined
          this.renderRows()
          // 术语契约「立即捕获键盘输入」：捕获签打开即聚焦（不等用户再点一次）
          this.resultsEl?.querySelector<HTMLInputElement>('.vsidian-keybindings-capture')?.focus()
        }, 'vsidian-keybindings-add')
        add.setAttribute('aria-label', t('keybindingSettings.addBinding'))
        controls.append(add)
      }
      row.append(controls)
      if (this.conflict?.id === op.id) {
        const warning = el('div', 'vsidian-keybindings-conflict',
          t('keybindingSettings.conflictRow', { names: joinOpNames(this.conflict.ids) }))
        warning.setAttribute('role', 'alert')
        warning.append(this.button(t('keybindingSettings.replaceConflicts'), () => this.conflict!.reset
          ? this.resetOne(op.id, true) : this.save(op.id, this.conflict!.bindings, true)))
        row.append(warning)
      }
      parent.append(row)
    }
    if (locatedRow) {
      locatedRow.querySelector<HTMLInputElement>('.vsidian-keybindings-capture')?.focus()
      locatedRow.scrollIntoView?.({ block: 'nearest' })
      this.focusEntry = undefined
    }
    // 捕获进行中的重聚焦（N-1 白名单）：仅行内动作与宿主回推的重渲染拉回
    // 焦点（焦点恰落 body 时）；其余入口（筛选签/搜索/菜单外点/恢复默认）
    // 不置标志，由 blur 双锚定判定自然取消，离开意图不被劫持
    if (this.selected && this.refocusCapture) {
      this.refocusCapture = false
      const capture = parent.querySelector<HTMLInputElement>('.vsidian-keybindings-capture')
      if (capture && document.activeElement === document.body) capture.focus()
    }
  }
}
