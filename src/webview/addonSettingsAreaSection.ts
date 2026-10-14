// 「组件设置」独立分页（#465 IA 分页二轮，2026-10-13 用户指令）：附加组
// 件页**禁止**出现启用开关与行为控制以外的任何设置项——组件基础设置
// （#353 T04：双标签作用范围 + 平台基础控件 + 清除覆盖）与组件设置页挂
// 载（#351 T02）全部迁至本分页承载，附加组件页的渲染通道随之堵死（那边
// 不再消费 addons.settingsState / openAddonSettingsPage，守护契约见
// addonSettingsSection.test.ts「通道堵死」用例）。
//
// 本分页两种形态（同页切换，宿主权威态驱动）：
// - 组件清单（缺省）：列出可配置组件（有设置定义或有自己的设置页），
//   点击进入该组件的基础设置；无可配置组件时空态提示。
// - 组件详情：settingsState.open 指向组件时呈现基础设置区；设置区未开
//   但 openAddonSettingsPage 在场时呈现 T02 挂载回退。「返回组件列表」
//   上送 addons.settingsClose 回清单形态。
//
// 状态权威在宿主（addons.state / addons.settingsState 推送回显；装载经
// addons.get / addons.settingsGet 拉取，由 settingsMain 装载点统一发送）；
// 页面不自行推断。文案一律 t() 取词（addons.* 词条）。控件构造器在
// addonSettingsControls.ts。
import { t, currentLocaleLang } from '../shared/i18n'
import { isHostToWebview } from '../shared/protocol'
import { splitAddonArrayPasteText } from '../shared/addonSettings'
import { resolveLocalizedText } from '../shared/localizedText'
import type { AddonSettingDefinition, AddonSettingGroup, AddonSettingValue } from '../shared/addonSettings'
import { groupIcon, type SettingsPageBridge, type SettingsPageSection } from './settingsPageView'
import { createScalarDefinitionControl, createScalarItemControl, scalarItemFallback } from './addonSettingsControls'
import { captureSectionRebuildAnchor, restoreSectionRebuildAnchor, captureLocalFocusKey, restoreLocalFocusKey, REBUILD_FOCUS_ATTR } from './sectionRebuildGuard'

type AddonsStateMessage = Extract<import('../shared/protocol').HostToWebview, { kind: 'addons.state' }>
type AddonSettingsStateMessage = Extract<import('../shared/protocol').HostToWebview, { kind: 'addons.settingsState' }>
type AddonSettingsAreaPayload = AddonSettingsStateMessage['addon'] extends infer T ? T extends null ? never : NonNullable<T> : never

/** 功能开关行的 data 键（与定义键空间区分——开关不是设置定义） */
const ENABLED_KEY = '__enabled__'

/** 定位高亮一次性退场时限（#462 档位语义：约 1.5s 后摘除，推送重渲染不重现） */
const LOCATED_FADE_MS = 1500

/** 全局搜索定位入口 id（hub = 组件清单；area = 打开中的组件详情） */
export const ADDON_SETTINGS_SECTION_ID = 'addon-settings'
export const ADDON_SETTINGS_SECTION_HUB_ENTRY = 'hub'
export const ADDON_SETTINGS_SECTION_AREA_ENTRY = 'area'

/** #472 跨组件定位目标（focusEntry 形状 addon:<addonId>/def:<定义键> 或
 *  addon:<addonId>/group:<组键>——沿 addon:<id> 前缀先例层进；组件 ID 是
 *  publisher.name 形状不含斜杠，首个斜杠即分隔位） */
type AddonFocusTarget = { addonId: string; kind: 'def' | 'group'; key: string }

/** 解析定位入口（非 addon: 前缀或形状不合法返回 undefined） */
function parseAddonFocusEntry(focusEntry: string | undefined): AddonFocusTarget | undefined {
  if (focusEntry === undefined || !focusEntry.startsWith('addon:')) return undefined
  const rest = focusEntry.slice('addon:'.length)
  const slash = rest.indexOf('/')
  if (slash <= 0) return undefined
  const tail = rest.slice(slash + 1)
  if (tail.startsWith('def:')) return { addonId: rest.slice(0, slash), kind: 'def', key: tail.slice('def:'.length) }
  if (tail.startsWith('group:')) return { addonId: rest.slice(0, slash), kind: 'group', key: tail.slice('group:'.length) }
  return undefined
}

export class AddonSettingsAreaSection implements SettingsPageSection {
  readonly id = ADDON_SETTINGS_SECTION_ID
  readonly hideFromNavigation = true
  /** 滑杆组字形（调参意象——组件设置的调谐面） */
  readonly icon = 'sliders' as const
  /** bare 装配（与附加组件域各分页同口径）：组卡片直挂页面列表 */
  readonly bare = true
  get title(): string { return t('settings.addonSettingsSection') }
  get description(): string { return t('settings.addonSettingsSectionDescription') }

  private state: AddonsStateMessage | undefined
  /** #353 T04 设置区载荷（addons.settingsState） */
  private settingsState: AddonSettingsStateMessage | undefined
  /** 当前作用范围标签（本地 UI 态；推送重渲染保持） */
  private scope: 'user' | 'workspace' = 'user'
  /** 数组/对象的未保存草稿（定义键 → 草稿值；推送保留，保存成功清除） */
  private drafts = new Map<string, unknown>()
  /** #472 跨组件定位挂起（目标组件设置区未开：已发 settingsOpen，等
   *  settingsState 应答渲染后定位；只消费一次——此后常规推送不重现） */
  private pendingFocus: AddonFocusTarget | undefined
  /** #472 挂起定位的消费渲染标记（一次读一次清）：消费渲染等价显式定位
   *  ——跳过 #467 滚动/焦点守卫，否则 restore 会把 scrollIntoView 写回 */
  private consumingPendingFocus = false
  /** #472 定位高亮目标（退场时限内推送重渲染保持——定位后排定一次性
   *  退场（#462 语义），摘除高亮类时一并清空；时限外推送不再重现） */
  private locatedTarget: AddonFocusTarget | undefined
  /** #472 定位高亮退场计时器（实例级，跨分页挂载/卸载存续，保证最终退场） */
  private locatedFadeTimer: ReturnType<typeof setTimeout> | undefined
  private parent: HTMLElement | undefined

  constructor(
    private readonly bridge: SettingsPageBridge,
    /** #351 T02 组件设置页挂载宿主元素（settingsMain 创建的持久容器——
     *  装载器 mountRoot 挂进它；不随分页重渲染销毁，重渲染只移动节点） */
    private readonly addonSettingsHost?: HTMLElement,
  ) {}

  get entries() {
    // #472 定义级与组级条目进全局搜索（全部已注册组件——addons.state 携带
    // 搜索摘要；组标题按当前语言选值、定义 title/description 直用原文，
    // object 字段级不进）。id 即跨组件定位键（addon:<id>/def|group:<键>）
    const list: Array<{ id: string; title: string; description?: string }> = [
      {
        id: ADDON_SETTINGS_SECTION_HUB_ENTRY,
        title: t('settings.addonSettingsSection'),
        description: t('settings.addonSettingsSectionDescription'),
      },
    ]
    for (const entry of this.state?.addons ?? []) {
      const index = entry.settingsSearchIndex
      if (!index) continue
      for (const group of index.groups ?? []) {
        list.push({ id: `addon:${entry.id}/group:${group.key}`, title: resolveLocalizedText(group.title, currentLocaleLang()) })
      }
      for (const def of index.definitions) {
        list.push({
          id: `addon:${entry.id}/def:${def.key}`,
          title: def.title,
          ...(def.description !== undefined ? { description: def.description } : {}),
        })
      }
    }
    return list
  }

  mount(parent: HTMLElement, focusEntry?: string): (() => void) | undefined {
    this.parent = parent
    // #472 跨组件定位（全局搜索命中 def/group 级条目）：记定位态并排定
    // 一次性退场；目标组件设置区未开时先请求打开（应答后渲染定位）
    const target = parseAddonFocusEntry(focusEntry)
    if (target) {
      this.locatedTarget = target
      this.scheduleLocatedFade()
      if (this.settingsState?.open !== target.addonId) {
        this.pendingFocus = target
        this.send({ kind: 'addons.settingsOpen', addonId: target.addonId })
      }
    }
    this.render(focusEntry)
    return () => {
      this.parent = undefined
    }
  }

  handleHostMessage(message: unknown): void {
    if (!isHostToWebview(message)) {
      return
    }
    if (message.kind === 'addons.state') {
      this.state = message
      this.render()
      return
    }
    if (message.kind === 'addons.settingsState') {
      // 保存成功（notice saved）涉及的键清草稿；失败保留（用户输入不丢）
      if (message.notice?.kind === 'saved') {
        for (const key of message.notice.keys ?? []) {
          this.drafts.delete(key)
        }
      }
      // 设置区切换组件（或关闭）时草稿全清（跨组件不串值）
      const previous = this.settingsState?.open
      if (previous !== undefined && previous !== message.open) {
        this.drafts.clear()
      }
      this.settingsState = message
      // #472 挂起定位消费：目标组件设置区已开（settingsOpen 应答到达）——
      // 本次渲染按定位语义走（等价显式 focusEntry）；pending 清空（此后
      // 推送不重现）。应答晚于退场时限到达时定位态已被清——按挂起目标
      // 重立并重排退场（高亮寿命从定位渲染起算，不从发请求起算）
      if (this.pendingFocus !== undefined && message.open === this.pendingFocus.addonId) {
        if (this.locatedTarget === undefined) {
          this.locatedTarget = this.pendingFocus
          this.scheduleLocatedFade()
        }
        this.pendingFocus = undefined
        this.consumingPendingFocus = true
      }
      this.render()
    }
  }

  /** #472 排定定位高亮一次性退场：约 1.5s 后摘除设置区已渲染的 located
   *  类（定义行与组容器）并清定位态——此后推送重渲染不再重现 */
  private scheduleLocatedFade(): void {
    if (this.locatedFadeTimer !== undefined) {
      clearTimeout(this.locatedFadeTimer)
    }
    this.locatedFadeTimer = setTimeout(() => {
      this.locatedFadeTimer = undefined
      this.locatedTarget = undefined
      this.parent?.querySelectorAll('.vsidian-addons-settings .vsidian-settings-item-located').forEach((el) => {
        el.classList.remove('vsidian-settings-item-located')
      })
    }, LOCATED_FADE_MS)
  }

  private send(message: object): void {
    this.bridge.postMessage(message)
  }

  private button(label: string, action: () => void, cls = '', attrs: Record<string, string> = {}): HTMLButtonElement {
    const el = document.createElement('button')
    el.className = cls
    el.type = 'button'
    el.textContent = label
    for (const [key, value] of Object.entries(attrs)) {
      el.setAttribute(key, value)
    }
    el.addEventListener('click', action)
    return el
  }

  private render(focusEntry?: string): void {
    const parent = this.parent
    if (!parent) {
      return
    }
    // #467 同分页推送重渲染保持滚动与焦点（守卫说明见 sectionRebuildGuard）；
    // 显式定位渲染（focusEntry 在场）不恢复——定位语义优先；#472 挂起定位
    // 的消费渲染同豁免（consumed 一次读一次清），否则 restore 把定位滚动写回
    const locating = focusEntry !== undefined || this.consumingPendingFocus
    this.consumingPendingFocus = false
    const anchor = locating ? undefined : captureSectionRebuildAnchor(parent)
    parent.replaceChildren()
    // ---- 组件详情：基础设置区打开（settingsState.open）或组件设置页挂载
    //      在场（openAddonSettingsPage，设置区未承载时的 T02 回退） ----
    const settingsArea = this.renderSettingsArea(focusEntry)
    if (settingsArea) {
      parent.append(settingsArea)
      // #472 def/group 定位滚动须在挂载后（渲染函数返回前 scrollIntoView
      // 作用于游离子树，无可滚动祖先——真实布局下不滚动）；且只在显式
      // 定位渲染滚（#467 契约）——退场窗口内常规推送重渲染保持高亮但不
      // 重放滚动
      if (locating) {
        settingsArea.querySelector('.vsidian-settings-item-located')?.scrollIntoView?.({ block: 'nearest' })
      }
    } else if (this.state && this.addonSettingsHost) {
      const openId = this.state.openAddonSettingsPage ?? null
      const openEntry = openId === null ? undefined : this.state.addons.find((entry) => entry.id === openId)
      if (openEntry) {
        parent.append(this.renderAddonPageMount(openEntry))
      } else {
        parent.append(this.renderHub(focusEntry))
      }
    } else {
      parent.append(this.renderHub(focusEntry))
    }
    if (anchor) {
      restoreSectionRebuildAnchor(parent, anchor)
    }
  }

  /** 组件清单（缺省形态）：可配置组件各一行，点击进入其基础设置 */
  private renderHub(focusEntry?: string): HTMLElement {
    const area = document.createElement('section')
    area.className = 'vsidian-addons-settings-hub'
    if (focusEntry === ADDON_SETTINGS_SECTION_HUB_ENTRY) {
      area.classList.add('vsidian-settings-item-located')
    }
    const group = document.createElement('div')
    group.className = 'vsidian-settings-group'
    const title = document.createElement('h3')
    title.className = 'vsidian-settings-group-title'
    title.append(groupIcon('sliders'))
    title.append(document.createTextNode(t('addons.settingsHubTitle')))
    group.append(title)
    const configurable = (this.state?.addons ?? []).filter((entry) => entry.hasSettingsDefinitions || entry.hasSettingsPage)
    if (configurable.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'vsidian-settings-empty'
      empty.textContent = t('addons.settingsHubEmpty')
      group.append(empty)
    }
    for (const entry of configurable) {
      const item = document.createElement('div')
      item.className = 'vsidian-settings-item'
      const label = document.createElement('div')
      label.className = 'vsidian-settings-item-label'
      const copy = document.createElement('div')
      copy.className = 'vsidian-settings-item-copy'
      const name = document.createElement('span')
      name.className = 'vsidian-settings-item-title'
      name.textContent = entry.official
        ? `${entry.label} · ${t('addons.officialBadge')}`
        : entry.label
      const desc = document.createElement('span')
      desc.className = 'vsidian-settings-item-description'
      desc.textContent = entry.id
      copy.append(name, desc)
      // 停用与故障组件仍可配置（ADR Q23：打开设置区不解禁、不重试）
      label.append(copy, this.button(t('addons.openSettingsArea'), () => {
        this.send({ kind: 'addons.settingsOpen', addonId: entry.id })
      }, '', { [REBUILD_FOCUS_ATTR]: `hub-open:${entry.id}` }))
      item.append(label)
      group.append(item)
    }
    area.append(group)
    if (focusEntry === ADDON_SETTINGS_SECTION_HUB_ENTRY) {
      area.scrollIntoView?.({ block: 'nearest' })
    }
    return area
  }

  /** 基础设置区（open 且载荷在场时非 null；组件已注销的空载荷时为 null） */
  private renderSettingsArea(focusEntry?: string): HTMLElement | null {
    const payload = this.settingsState
    if (!payload || payload.open === null || payload.addon === null) {
      return null
    }
    const area = document.createElement('section')
    area.className = 'vsidian-addons-settings'
    if (focusEntry === ADDON_SETTINGS_SECTION_AREA_ENTRY) {
      area.classList.add('vsidian-settings-item-located')
      area.scrollIntoView?.({ block: 'nearest' })
    }

    // 头部：标题 + 关闭
    const head = document.createElement('div')
    head.className = 'vsidian-addons-settings-head'
    const heading = document.createElement('h3')
    heading.className = 'vsidian-settings-group-title'
    heading.textContent = t('addons.settingsAreaTitle', { label: payload.addon.label })
    head.append(heading, this.button(t('addons.closeSettingsArea'), () => {
      this.send({ kind: 'addons.settingsClose' })
    }, '', { [REBUILD_FOCUS_ATTR]: 'close-settings-area' }))
    area.append(head)

    // 双标签（用户默认 / 当前工作区；无工作区禁用 + 提示）
    const tabs = document.createElement('div')
    tabs.className = 'vsidian-addons-scope-tabs'
    tabs.setAttribute('role', 'tablist')
    for (const scope of ['user', 'workspace'] as const) {
      const tab = this.button(t(scope === 'user' ? 'addons.scopeUserDefault' : 'addons.scopeWorkspace'), () => {
        this.scope = scope
        this.render()
      }, 'vsidian-addons-scope-tab')
      tab.setAttribute('role', 'tab')
      tab.setAttribute(REBUILD_FOCUS_ATTR, `scope:${scope}`)
      tab.setAttribute('aria-selected', this.scope === scope ? 'true' : 'false')
      if (scope === 'workspace' && !payload.hasWorkspace) {
        tab.disabled = true
      }
      tabs.append(tab)
    }
    area.append(tabs)
    if (!payload.hasWorkspace) {
      const hint = document.createElement('p')
      hint.className = 'vsidian-addons-scope-hint'
      hint.textContent = t('addons.noWorkspaceHint')
      area.append(hint)
    }

    // 故障排障块（#354 T05：状态呈现 + 日志入口 + 手动重试；完整诊断归
    // T12——自定义页已撤下，已有定义时下方基础控件保留）
    if (payload.addon.faulted) {
      const troubleshoot = document.createElement('div')
      troubleshoot.className = 'vsidian-addons-fault-troubleshoot'
      const faultTitle = document.createElement('h4')
      faultTitle.className = 'vsidian-settings-group-title'
      faultTitle.textContent = t('addons.faultTroubleshootTitle')
      const reason = document.createElement('p')
      reason.className = 'vsidian-addons-fault-hint'
      reason.textContent = t('addons.statusFaulted', { detail: payload.addon.faultReason ?? '' })
      const hint = document.createElement('p')
      hint.className = 'vsidian-addons-fault-hint'
      hint.textContent = t('addons.faultTroubleshootHint')
      const faultActions = document.createElement('div')
      faultActions.className = 'vsidian-addons-fault-actions'
      faultActions.append(
        this.button(t('addons.openLogs'), () => {
          this.send({ kind: 'addons.openLogs' })
        }),
        this.button(t('addons.retryFaulted'), () => {
          this.send({ kind: 'addons.retry', addonId: payload.addon!.addonId })
        }, 'vsidian-addons-retry', { [REBUILD_FOCUS_ATTR]: `settings-retry:${payload.addon!.addonId}` }),
      )
      troubleshoot.append(faultTitle, reason, hint, faultActions)
      area.append(troubleshoot)
    }

    // 控件组（#472 分组呈现）：首容器无组标题——功能开关行恒居首 + 未分组
    // 定义聚拢（按注册序）；组容器按声明序随后（组标题档位 + 组内定义按
    // 注册序聚拢不散插；空组仍渲染）。无组声明时单容器平铺（向后兼容）。
    // 宿主注册批已保证组键唯一，重复键只可能来自损坏载荷——按首见去重，
    // 防同一定义在同名组卡片重复渲染
    const definitions = payload.addon.definitions
    const declaredGroups: AddonSettingGroup[] = []
    for (const group of payload.addon.groups ?? []) {
      if (!declaredGroups.some((seen) => seen.key === group.key)) {
        declaredGroups.push(group)
      }
    }
    // #472 定位落点（目标组件匹配时）：def 级描定义行、group 级描组容器
    //（互斥——落点唯一；渲染循环内按 key 比对标记，避免选择器转义）
    const located = this.locatedTarget
    const locatedRowOf = (def: AddonSettingDefinition): boolean =>
      located !== undefined && located.kind === 'def' && located.addonId === payload.addon!.addonId && located.key === def.key
    // 引用键不在声明集（异常载荷，宿主校验后不应出现）时回落首容器——
    // 不吞呈现
    const declaredKeys = new Set(declaredGroups.map((group) => group.key))
    const belongsToFirst = (def: AddonSettingDefinition): boolean => def.group === undefined || !declaredKeys.has(def.group)
    const firstGroup = document.createElement('div')
    firstGroup.className = 'vsidian-settings-group'
    firstGroup.append(this.renderEnabledRow(payload.addon))
    if (definitions.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'vsidian-settings-empty'
      empty.textContent = t('addons.settingsEmpty')
      firstGroup.append(empty)
    }
    for (const def of definitions) {
      if (belongsToFirst(def)) {
        const row = this.renderDefinitionRow(payload.addon, def)
        if (locatedRowOf(def)) {
          row.classList.add('vsidian-settings-item-located')
        }
        firstGroup.append(row)
      }
    }
    area.append(firstGroup)
    for (const group of declaredGroups) {
      const card = document.createElement('div')
      card.className = 'vsidian-settings-group'
      const title = document.createElement('h3')
      title.className = 'vsidian-settings-group-title'
      title.textContent = resolveLocalizedText(group.title, currentLocaleLang())
      card.append(title)
      if (group.description !== undefined) {
        const desc = document.createElement('p')
        desc.className = 'vsidian-addons-group-description'
        desc.textContent = resolveLocalizedText(group.description, currentLocaleLang())
        card.append(desc)
      }
      if (located !== undefined && located.kind === 'group' && located.addonId === payload.addon.addonId && located.key === group.key) {
        card.classList.add('vsidian-settings-item-located')
      }
      for (const def of definitions) {
        if (def.group === group.key) {
          const row = this.renderDefinitionRow(payload.addon, def)
          if (locatedRowOf(def)) {
            row.classList.add('vsidian-settings-item-located')
          }
          card.append(row)
        }
      }
      area.append(card)
    }

    // 保存反馈（notice 由宿主应答推送；常规推送清空——不残留旧结局）
    if (payload.notice !== undefined) {
      const notice = document.createElement('p')
      notice.className = `vsidian-addons-settings-notice vsidian-addons-settings-notice-${payload.notice.kind}`
      notice.setAttribute('role', 'status')
      notice.textContent = this.noticeText(payload.notice)
      area.append(notice)
    }

    // 自定义设置页入口与挂载区（故障暂停撤下；T02 挂载逻辑并入设置区）
    if (payload.addon.hasCustomPage) {
      const mounted = payload.openAddonSettingsPage === payload.addon.addonId
      const customRow = document.createElement('div')
      customRow.className = 'vsidian-addons-custompage-actions'
      customRow.append(this.button(t(mounted ? 'addons.closeSettingsPage' : 'addons.openCustomPage'), () => {
        this.send(mounted ? { kind: 'addons.closeAddonPage' } : { kind: 'addons.openAddonPage', addonId: payload.addon!.addonId })
      }))
      area.append(customRow)
      if (mounted && this.addonSettingsHost) {
        const state = this.state
        const openEntry = state?.addons.find((entry) => entry.id === payload.addon!.addonId)
        if (openEntry) {
          area.append(this.renderAddonPageMount(openEntry))
        }
      }
    }
    return area
  }

  /** notice 组句（失败不虚报——原因码经 i18n 组句，键名原文列出） */
  private noticeText(notice: NonNullable<AddonSettingsStateMessage['notice']>): string {
    if (notice.kind === 'saved') {
      const scopeText = t(notice.scope === 'workspace' ? 'addons.scopeWorkspace' : 'addons.scopeUserDefault')
      return t('addons.savedNotice', { scope: scopeText })
    }
    const keys = (notice.keys ?? []).join(', ')
    const reason = notice.reason === 'invalid-value'
      ? t('addons.saveFailedInvalid', { keys })
      : notice.reason === 'unknown-key'
        ? t('addons.saveFailedUnknownKey', { keys })
        : notice.reason === 'no-workspace'
          ? t('addons.saveFailedNoWorkspace')
          : notice.reason === 'store-write-failed'
            ? t('addons.saveFailedStore')
            : notice.reason === 'rejected'
              ? t('addons.saveFailedRejected')
              : ''
    return t('addons.saveFailedNotice', { reason })
  }

  /** 功能开关行（两层作用范围随标签；workspace 已覆盖可清除） */
  private renderEnabledRow(addon: NonNullable<AddonSettingsAreaPayload>): HTMLElement {
    const item = document.createElement('div')
    item.className = 'vsidian-settings-item'
    const label = document.createElement('label')
    label.className = 'vsidian-settings-item-label'
    const copy = document.createElement('span')
    copy.className = 'vsidian-settings-item-copy'
    const title = document.createElement('span')
    title.className = 'vsidian-settings-item-title'
    title.textContent = t('addons.enableSwitchTitle')
    const desc = document.createElement('span')
    desc.className = 'vsidian-settings-item-description'
    desc.textContent = t('addons.enableSwitchDescription')
    copy.append(this.renderTitleRow(title, addon.enabled.source), desc)
    // 当前标签层的开关值：user 标签 = userExplicit ?? 默认启用；workspace
    // 标签 = workspaceExplicit ?? 生效值（继承显示）
    const layerValue = this.scope === 'user'
      ? (addon.enabled.userExplicit ?? true)
      : (addon.enabled.workspaceExplicit ?? addon.enabled.effective)
    const toggle = document.createElement('input')
    toggle.type = 'checkbox'
    toggle.className = 'vsidian-settings-checkbox'
    toggle.checked = layerValue === true
    toggle.setAttribute('data-addon-setting', ENABLED_KEY)
    toggle.setAttribute(REBUILD_FOCUS_ATTR, ENABLED_KEY)
    toggle.addEventListener('change', () => {
      this.send({ kind: 'addons.setEnabled', addonId: addon.addonId, enabled: toggle.checked, scope: this.scope })
    })
    label.append(copy, toggle)
    item.append(label)
    if (this.scope === 'workspace' && addon.enabled.workspaceExplicit !== null) {
      item.append(this.clearOverrideButton(addon.addonId, ENABLED_KEY))
    }
    return item
  }

  /** 单个定义行：标量即时控件 / 数组重复项控件 / 对象字段控件 */
  private renderDefinitionRow(addon: NonNullable<AddonSettingsAreaPayload>, def: AddonSettingDefinition): HTMLElement {
    const item = document.createElement('div')
    item.className = `vsidian-addons-setting-item vsidian-addons-setting-${def.type}`
    const head = document.createElement('div')
    head.className = 'vsidian-settings-item-label'
    const copy = document.createElement('span')
    copy.className = 'vsidian-settings-item-copy'
    const title = document.createElement('span')
    title.className = 'vsidian-settings-item-title'
    title.textContent = def.title
    const entry = addon.values[def.key]
    copy.append(this.renderTitleRow(title, entry?.source ?? 'default'))
    if (def.description) {
      const desc = document.createElement('span')
      desc.className = 'vsidian-settings-item-description'
      desc.textContent = def.description
      copy.append(desc)
    }
    head.append(copy)
    item.append(head)

    if (def.type === 'array') {
      item.append(this.renderArrayControl(addon, def))
    } else if (def.type === 'object') {
      item.append(this.renderObjectControl(addon, def))
    } else if (def.type === 'string' && def.multiline === true) {
      // #475 多行控件占定义行整行（放 label 行下方），不挤右槽
      item.append(this.scalarControl(addon, def))
    } else {
      head.append(this.scalarControl(addon, def))
    }

    // 工作区标签下已覆盖的项提供「使用用户默认」（恢复继承，不是恢复出厂）
    if (this.scope === 'workspace' && entry?.workspace !== undefined) {
      item.append(this.clearOverrideButton(addon.addonId, def.key))
    }
    return item
  }

  /** 标量即时控件（change 即按批上送单键） */
  private scalarControl(addon: NonNullable<AddonSettingsAreaPayload>, def: AddonSettingDefinition): HTMLElement {
    const value = this.layerDisplayValue(addon, def)
    const control = createScalarDefinitionControl(def, value, (next) => {
      this.send({ kind: 'addons.settingsUpdate', addonId: addon.addonId, scope: this.scope, values: { [def.key]: next } })
    })
    control.setAttribute(REBUILD_FOCUS_ATTR, def.key)
    return control
  }

  /** 数组重复项控件（草稿编辑 + 保存整批上送） */
  private renderArrayControl(addon: NonNullable<AddonSettingsAreaPayload>, def: Extract<AddonSettingDefinition, { type: 'array' }>): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'vsidian-addons-array'
    const effective = addon.values[def.key]?.effective
    const draft = (this.drafts.get(def.key) as unknown[] | undefined)
      ?? (Array.isArray(effective) ? [...effective] : [...(def.default as readonly unknown[])])
    this.drafts.set(def.key, [...draft])
    const rows = document.createElement('div')
    rows.className = 'vsidian-addons-array-rows'
    const renderRows = (): void => {
      // #467 局部重建焦点保持：数组行不经 section render 守卫，移除/
      // 追加行后按位置键把焦点回到等价控件（键盘删行不落 BODY）
      const focusKey = captureLocalFocusKey(rows)
      rows.replaceChildren()
      draft.forEach((value, index) => {
        const row = document.createElement('div')
        row.className = 'vsidian-addons-array-row'
        const control = createScalarItemControl(def.items, value, { 'data-addon-array-item': def.key }, (next) => {
          draft[index] = next
        }, 'input')
        // #475 批量粘贴拆分：string 自由文本项的多行剪贴板按行拆为多项
        //（首行追加当前项末尾，其余插入其后）；enum/number/boolean 项不适用。
        // 拼接结果同样经 maxLength 截断（对齐浏览器单行粘贴按总量的截断
        // 语义——逐行截断后拼接仍可能超限，草稿不持不可保存值）；
        // 逐项插入不走 spread（数万行级剪贴板可触发实参上限 RangeError）
        if (def.items.kind === 'string' && def.items.enum === undefined) {
          const items = def.items
          control.addEventListener('paste', (event) => {
            const text = event.clipboardData?.getData('text') ?? ''
            if (!/[\r\n]/.test(text)) return // 单行粘贴走默认输入行为
            event.preventDefault()
            const lines = splitAddonArrayPasteText(text, items.maxLength)
            if (lines.length === 0) return
            const current = typeof draft[index] === 'string' ? (draft[index] as string) : ''
            const merged = current + lines[0]!
            draft[index] = items.maxLength !== undefined && items.maxLength > 0 ? merged.slice(0, items.maxLength) : merged
            for (let i = 1; i < lines.length; i++) {
              draft.splice(index + i, 0, lines[i]!)
            }
            this.drafts.set(def.key, [...draft])
            renderRows()
            const refocus = rows.children[index]?.querySelector<HTMLElement>('[data-addon-array-item]')
            refocus?.focus({ preventScroll: true })
          })
        }
        row.append(
          control,
          this.button(t('addons.arrayRemoveItem'), () => {
            draft.splice(index, 1)
            this.drafts.set(def.key, [...draft])
            renderRows()
          }, 'vsidian-addons-array-remove', { [REBUILD_FOCUS_ATTR]: `array-remove:${def.key}:${index}` }),
        )
        rows.append(row)
      })
      // 末行（或唯一行）删除后无同键位置：回退到新末行的移除按钮，键盘
      // 连续删除不断流；数组删空时容器内无可聚焦控件，焦点回落 BODY
      if (focusKey !== null && !restoreLocalFocusKey(rows, focusKey)) {
        const removes = rows.querySelectorAll<HTMLElement>('.vsidian-addons-array-remove')
        removes[removes.length - 1]?.focus({ preventScroll: true })
      }
    }
    renderRows()
    const actions = document.createElement('div')
    actions.className = 'vsidian-addons-array-actions'
    actions.append(
      this.button(t('addons.arrayAddItem'), () => {
        draft.push(scalarItemFallback(def.items))
        this.drafts.set(def.key, [...draft])
        renderRows()
      }),
      this.button(t('addons.saveChanges'), () => {
        this.send({ kind: 'addons.settingsUpdate', addonId: addon.addonId, scope: this.scope, values: { [def.key]: [...draft] } })
      }, 'vsidian-addons-array-save', { [REBUILD_FOCUS_ATTR]: `array-save:${def.key}` }),
    )
    wrap.append(rows, actions)
    return wrap
  }

  /** 对象字段控件（每字段一行 + 保存整批上送） */
  private renderObjectControl(addon: NonNullable<AddonSettingsAreaPayload>, def: Extract<AddonSettingDefinition, { type: 'object' }>): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'vsidian-addons-object'
    const effective = addon.values[def.key]?.effective
    const fallback: Record<string, unknown> = {}
    for (const field of def.fields) {
      fallback[field.key] = field.default
    }
    const base = typeof effective === 'object' && effective !== null && !Array.isArray(effective) ? effective as Record<string, unknown> : fallback
    const draft = { ...(this.drafts.get(def.key) as Record<string, unknown> | undefined ?? base) }
    this.drafts.set(def.key, { ...draft })
    const fields = document.createElement('div')
    fields.className = 'vsidian-addons-object-fields'
    for (const field of def.fields) {
      const row = document.createElement('label')
      row.className = 'vsidian-addons-object-field'
      const name = document.createElement('span')
      name.className = 'vsidian-addons-object-field-name'
      name.textContent = field.title
      row.append(name, createScalarItemControl(field, draft[field.key], { 'data-addon-field': `${def.key}.${field.key}` }, (next) => {
        draft[field.key] = next
      }, 'input'))
      fields.append(row)
    }
    const actions = document.createElement('div')
    actions.className = 'vsidian-addons-object-actions'
    actions.append(this.button(t('addons.saveChanges'), () => {
      this.send({ kind: 'addons.settingsUpdate', addonId: addon.addonId, scope: this.scope, values: { [def.key]: { ...draft } } })
    }, 'vsidian-addons-object-save', { [REBUILD_FOCUS_ATTR]: `object-save:${def.key}` }))
    wrap.append(fields, actions)
    return wrap
  }

  /** 当前标签层的显示值：user 标签 = user ?? 出厂；workspace = workspace ?? effective（继承显示） */
  private layerDisplayValue(addon: NonNullable<AddonSettingsAreaPayload>, def: AddonSettingDefinition): AddonSettingValue {
    const entry = addon.values[def.key]
    if (this.scope === 'user') {
      return entry?.user ?? (def.type === 'object' ? objectDefault(def) : def.default)
    }
    return entry?.workspace ?? entry?.effective ?? (def.type === 'object' ? objectDefault(def) : def.default)
  }

  /** 标题行（#477 三行挤压修复）：标题 + 来源徽章同容器，描述独占行——
   * 徽章不挤占描述行；span 标签保持 phrasing content 合法（CSS flex） */
  private renderTitleRow(title: HTMLElement, source: 'default' | 'user' | 'workspace'): HTMLElement {
    const row = document.createElement('span')
    row.className = 'vsidian-addons-setting-title-row'
    row.append(title, this.sourceBadge(source))
    return row
  }

  /** 来源徽章（生效来源——两层标签共用同一生效口径） */
  private sourceBadge(source: 'default' | 'user' | 'workspace'): HTMLElement {
    const badge = document.createElement('span')
    badge.className = 'vsidian-addons-source-badge'
    badge.textContent = t(source === 'default' ? 'addons.sourceDefault' : source === 'user' ? 'addons.sourceUser' : 'addons.sourceWorkspace')
    return badge
  }

  /** 「使用用户默认」按钮（清除工作区覆盖——恢复继承，不是恢复出厂值） */
  private clearOverrideButton(addonId: string, key: string): HTMLButtonElement {
    const button = this.button(t('addons.useUserDefault'), () => {
      if (key === ENABLED_KEY) {
        this.send({ kind: 'addons.clearEnabledOverride', addonId })
      } else {
        this.send({ kind: 'addons.settingsClearOverride', addonId, key })
      }
    }, 'vsidian-addons-clear-override', { [REBUILD_FOCUS_ATTR]: `clear:${key}` })
    button.dataset.addonSettingKey = key
    return button
  }

  /** #351 T02 组件设置页挂载区（标题 + 关闭按钮 + host 移入；详情回退与设置区内共用） */
  private renderAddonPageMount(openEntry: import('../shared/addonIdentity').AddonStatusEntry): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'vsidian-addons-addonpage'
    const heading = document.createElement('h4')
    heading.className = 'vsidian-settings-group-title'
    heading.textContent = t('addons.addonSettingsTitle', { label: openEntry.label })
    const closeRow = document.createElement('div')
    closeRow.className = 'vsidian-addons-addonpage-actions'
    closeRow.append(this.button(t('addons.closeSettingsPage'), () => {
      this.send({ kind: 'addons.closeAddonPage' })
    }))
    wrap.append(heading, closeRow, this.addonSettingsHost!)
    return wrap
  }
}

/** 对象定义出厂值（字段 default 组装——shared compose 的 DOM 侧轻量版） */
function objectDefault(def: Extract<AddonSettingDefinition, { type: 'object' }>): Record<string, boolean | number | string> {
  if (def.default !== undefined) {
    return { ...def.default }
  }
  const composed: Record<string, boolean | number | string> = {}
  for (const field of def.fields) {
    composed[field.key] = field.default
  }
  return composed
}
