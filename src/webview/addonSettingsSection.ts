// 「附加组件」设置分页（#350 T01 / #351 T02 / #353 T04）：组件状态列表
// （官方/第三方分组）+ 功能开关与组件设置页挂载区（T02 两生命周期入口）
// + 基础设置区（T04：双标签作用范围 + 平台基础控件 + 清除覆盖）+ 市场
// 搜索入口 + VSCode 扩展管理入口。接入现有 Vsidian 自有设置页
// （SettingsPageSection），不新建页面体系。
//
// 边界（票面）：安装、卸载与整个扩展的禁用继续由 VSCode 管理——本分页
// 只呈现状态并提供 VSCode 入口；市场关键词（vsidian-addon）仅帮助寻找，
// 不代表接入协议或官方身份。API 版本行保持草案标注（draft 恒真），不把
// 声明能力冒充已发布稳定 API。#351 起：开关只切换运行贡献（enable 生命
// 周期），停用后设置能力保留（打开组件设置页仍可用）；故障暂停撤下组件
// 设置页代码（hasSettingsPage=false）并显示原因——状态句呈现「故障暂停」。
// #353 T04 起：基础设置区由平台定义驱动（标量/数组/对象基础控件），
// 停用与故障后保留（ADR Q23）；顶部双标签控制本次修改写入哪一层（Q21），
// 逐项「使用用户默认」只清工作区覆盖（恢复继承，不是恢复出厂值）。
//
// 状态权威在宿主（addons.state / addons.settingsState 推送回显；装载经
// addons.get / addons.settingsGet 拉取）；页面不自行推断。文案一律 t()
// 取词（addons.* 词条）。控件构造器在 addonSettingsControls.ts。
import { t } from '../shared/i18n'
import { isHostToWebview } from '../shared/protocol'
import type { AddonStatusEntry } from '../shared/addonIdentity'
import {
  orderedAddonBehaviorKeys,
  type AddonBehaviorInfo,
  type AddonBehaviorStateStore,
} from '../shared/addonBehaviors'
import type { AddonSettingDefinition, AddonSettingValue } from '../shared/addonSettings'
import type { SettingsPageBridge, SettingsPageSection, SettingsSidebarGroup } from './settingsPageView'
import { createScalarDefinitionControl, createScalarItemControl, scalarItemFallback } from './addonSettingsControls'

type AddonsStateMessage = Extract<import('../shared/protocol').HostToWebview, { kind: 'addons.state' }>
type AddonSettingsStateMessage = Extract<import('../shared/protocol').HostToWebview, { kind: 'addons.settingsState' }>
type AddonBehaviorsMessage = Extract<import('../shared/protocol').HostToWebview, { kind: 'addons.behaviors' }>
type AddonSettingsAreaPayload = AddonSettingsStateMessage['addon'] extends infer T ? T extends null ? never : NonNullable<T> : never

/** 功能开关行的 data 键（与定义键空间区分——开关不是设置定义） */
const ENABLED_KEY = '__enabled__'

/** 侧栏组件条目定位键前缀（mount 的 focusEntry 形如 addon:<组件 ID>） */
const SIDEBAR_ADDON_ENTRY_PREFIX = 'addon:'

/** 全局搜索定位入口 id（list = 状态列表；manage = 搜索与管理入口组；
 *  behaviors = 行为冲突管理组——T08 #357） */
export const ADDONS_SECTION_LIST_ENTRY = 'list'
export const ADDONS_SECTION_MANAGE_ENTRY = 'manage'
export const ADDONS_SECTION_BEHAVIORS_ENTRY = 'behaviors'

/**
 * #354 T05 侧栏大组分组数据（ADR-0012「侧栏结构」与「分组与故障状态」）：
 * - 官方/第三方两大组恒在场（空清单呈现空态，结构不消失）；
 * - 按用户功能开关归类已启用/已停用——开关值只在已注册组件上存在，
 *   未注册（不兼容/唤醒失败等）不参与分组（状态列表仍呈现）；
 * - 开关开启但故障暂停者留在已启用组并标注故障（不移入已停用）。
 */
export function addonSidebarGroups(addons: readonly AddonStatusEntry[]): readonly SettingsSidebarGroup[] {
  const build = (official: boolean): SettingsSidebarGroup => {
    const scoped = addons.filter((entry) => entry.official === official && typeof entry.enabled === 'boolean')
    const of = (enabled: boolean) => scoped
      .filter((entry) => entry.enabled === enabled)
      .map((entry) => ({
        id: `${SIDEBAR_ADDON_ENTRY_PREFIX}${entry.id}`,
        title: entry.label,
        ...(entry.fault !== undefined ? { faulted: true } : {}),
      }))
    return {
      label: t(official ? 'addons.sidebarCoreAddons' : 'addons.sidebarThirdPartyAddons'),
      subgroups: [
        { label: t('addons.sidebarEnabledGroup'), entries: of(true) },
        { label: t('addons.sidebarDisabledGroup'), entries: of(false) },
      ],
    }
  }
  return [build(true), build(false)]
}

/** 状态行可见文本（分组句；不兼容/失败携带原因原文） */
export function addonStatusText(entry: AddonStatusEntry, apiVersion: string): string {
  switch (entry.status) {
    case 'registered':
      return t('addons.statusRegistered')
    case 'activating':
      return t('addons.statusActivating')
    case 'awaiting-registration':
      return t('addons.statusAwaitingRegistration')
    case 'incompatible':
      return t('addons.statusIncompatible', { range: entry.apiRange ?? '?', version: apiVersion })
    case 'activation-failed':
      return t('addons.statusActivationFailed', { detail: entry.detail ?? '' })
    case 'host-unavailable':
      return t('addons.statusHostUnavailable')
    case 'invalid-declaration':
      return t('addons.statusInvalidDeclaration', { detail: entry.detail ?? '' })
  }
}

/** 运行生命周期状态句（#351；未注册组件无运行状态——返回 null 不占位） */
export function addonRuntimeText(entry: AddonStatusEntry): string | null {
  if (entry.fault !== undefined) {
    return t('addons.statusFaulted', { detail: entry.fault.reason })
  }
  if (entry.enabled === true) {
    return t('addons.statusEnabledRuntime')
  }
  if (entry.enabled === false) {
    return t('addons.statusDisabled')
  }
  return null
}

export class AddonSection implements SettingsPageSection {
  readonly id = 'addons'
  /** 四块拼贴字形（附加组件 = 独立扩展模块的组合意象） */
  readonly icon = 'blocks' as const
  get title(): string { return t('settings.addonsSection') }
  get description(): string { return t('settings.addonsSectionDescription') }

  private state: AddonsStateMessage | undefined
  /** #353 T04 设置区载荷（addons.settingsState） */
  private settingsState: AddonSettingsStateMessage | undefined
  /** T08（#357）行为冲突管理载荷（addons.behaviors；undefined = 未到达） */
  private behaviorsState: AddonBehaviorsMessage | undefined
  /** 当前作用范围标签（本地 UI 态；推送重渲染保持） */
  private scope: 'user' | 'workspace' = 'user'
  /** 数组/对象的未保存草稿（定义键 → 草稿值；推送保留，保存成功清除） */
  private drafts = new Map<string, unknown>()
  /** #354 T05 侧栏条目定位的组件 ID（推送重渲染保持——定位高亮不因
   *  settingsOpen 的应答回灌清失；下次定位或分页重挂载时更新） */
  private locatedAddonId: string | undefined
  private parent: HTMLElement | undefined

  constructor(
    private readonly bridge: SettingsPageBridge,
    /** #351 T02 组件设置页挂载宿主元素（settingsMain 创建的持久容器——
     *  装载器 mountRoot 挂进它；不随分页重渲染销毁，重渲染只移动节点） */
    private readonly addonSettingsHost?: HTMLElement,
    /** #354 T05 侧栏大组数据变化回调（settingsMain 接视图 refreshSidebar；
     *  addons.state 推送后触发侧栏重建，分页自身不直接改侧栏 DOM） */
    private readonly onSidebarChange?: () => void,
  ) {}

  get entries() {
    return [
      {
        id: ADDONS_SECTION_LIST_ENTRY,
        title: t('settings.addonsSection'),
        description: t('settings.addonsSectionDescription'),
      },
      {
        id: ADDONS_SECTION_MANAGE_ENTRY,
        title: t('addons.searchMarketplace'),
        description: t('addons.openExtensionsView'),
      },
      {
        id: ADDONS_SECTION_BEHAVIORS_ENTRY,
        title: t('addons.behaviorsGroupTitle'),
        description: t('addons.behaviorsGroupHint'),
      },
    ]
  }

  mount(parent: HTMLElement, focusEntry?: string): (() => void) | undefined {
    this.parent = parent
    // #354 T05 侧栏组件条目定位（addon:<组件 ID>）：可配置（有定义或有
    // 自己的设置页）时打开该组件基础设置区——停用组件仍可配置（ADR Q23）；
    // 纯运行组件（两者皆无）只定位状态列表行，不强开设置区
    const focusAddonId = focusAddonOf(focusEntry)
    if (focusAddonId !== undefined) {
      const entry = this.state?.addons.find((item) => item.id === focusAddonId)
      if (entry && (entry.hasSettingsDefinitions || entry.hasSettingsPage)) {
        this.send({ kind: 'addons.settingsOpen', addonId: focusAddonId })
      }
    }
    this.render(focusEntry)
    return () => {
      this.parent = undefined
    }
  }

  /** #354 T05 侧栏大组贡献：核心组件/第三方组件两大组（各分已启用/
   *  已停用；分组规则见 addonSidebarGroups 头注——状态未到达时空态） */
  sidebarGroups(): readonly SettingsSidebarGroup[] {
    return addonSidebarGroups(this.state?.addons ?? [])
  }

  handleHostMessage(message: unknown): void {
    if (!isHostToWebview(message)) {
      return
    }
    if (message.kind === 'addons.state') {
      this.state = message
      this.render()
      // #354 T05 组件状态变化 → 侧栏大组分组数据随之重建（视图刷新）
      this.onSidebarChange?.()
      return
    }
    // T08（#357）行为冲突管理载荷：目录（注册表上报对账）与用户覆盖变化
    // 都经此推送；notice 为最近一次写操作结局（常规推送缺省不残留）
    if (message.kind === 'addons.behaviors') {
      this.behaviorsState = message
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
      this.render()
    }
  }

  private send(message: object): void {
    this.bridge.postMessage(message)
  }

  private button(label: string, action: () => void, cls = ''): HTMLButtonElement {
    const el = document.createElement('button')
    el.className = cls
    el.type = 'button'
    el.textContent = label
    el.addEventListener('click', action)
    return el
  }

  private render(focusEntry?: string): void {
    const parent = this.parent
    if (!parent) {
      return
    }
    parent.replaceChildren()
    const state = this.state
    // #354 T05 侧栏组件条目定位：显式携带 focusEntry 时更新定位意图，
    // 状态推送的无参重渲染保持既有定位（locatedAddonId）
    const explicitFocus = focusAddonOf(focusEntry)
    if (explicitFocus !== undefined || focusEntry !== undefined) {
      this.locatedAddonId = explicitFocus
    }
    const focusAddonId = this.locatedAddonId

    // ---- 状态列表（官方分组在前；列表未到达时显示读取中） ----
    const listWrap = document.createElement('div')
    listWrap.className = 'vsidian-addons-list'
    if (focusEntry === ADDONS_SECTION_LIST_ENTRY || focusAddonId !== undefined) {
      listWrap.classList.add('vsidian-settings-item-located')
    }
    if (!state) {
      const pending = document.createElement('p')
      pending.className = 'vsidian-settings-empty'
      pending.setAttribute('role', 'status')
      pending.textContent = t('addons.statusActivating')
      listWrap.append(pending)
    } else {
      const entries = [...state.addons]
      const official = entries.filter((entry) => entry.official)
      const thirdParty = entries.filter((entry) => !entry.official)
      if (!entries.length) {
        const empty = document.createElement('p')
        empty.className = 'vsidian-settings-empty'
        empty.textContent = t('addons.empty')
        listWrap.append(empty)
      }
      for (const [group, labelKey] of [
        [official, 'addons.groupOfficial'],
        [thirdParty, 'addons.groupThirdParty'],
      ] as const) {
        if (!group.length) {
          continue
        }
        const title = document.createElement('h3')
        title.className = 'vsidian-settings-group-title'
        title.textContent = t(labelKey)
        listWrap.append(title)
        const groupContainer = document.createElement('div')
        groupContainer.className = 'vsidian-settings-group'
        for (const entry of group) {
          groupContainer.append(this.renderEntry(entry, state.apiVersion, entry.id === focusAddonId))
        }
        listWrap.append(groupContainer)
      }
    }
    parent.append(listWrap)
    if (focusEntry === ADDONS_SECTION_LIST_ENTRY) {
      listWrap.scrollIntoView?.({ block: 'nearest' })
    } else if (focusAddonId !== undefined) {
      listWrap.querySelector('.vsidian-settings-item-located')?.scrollIntoView?.({ block: 'nearest' })
    }

    // ---- T08（#357）行为冲突管理（入口固定在本页：注册行为的调序与逐项
    //  开关；目录未到达时呈现读取中，空目录呈现空态） ----
    parent.append(this.renderBehaviorsArea(focusEntry))

    // ---- #353 T04 基础设置区（定义驱动；停用与故障后保留） ----
    const settingsArea = this.renderSettingsArea()
    if (settingsArea) {
      parent.append(settingsArea)
    }

    // ---- #351 T02 组件设置页挂载区（设置区未承载时按 T02 分页级呈现；
    //  host 持久元素随渲染移动，重渲染不清空组件挂载内容） ----
    if (state && this.addonSettingsHost && !settingsArea) {
      const openId = state.openAddonSettingsPage ?? null
      const openEntry = openId === null ? undefined : state.addons.find((entry) => entry.id === openId)
      if (openEntry) {
        parent.append(this.renderAddonPageMount(openEntry))
      }
    }

    // ---- 工具组：市场搜索 + VSCode 扩展管理（安装/禁用由 VSCode 管理） ----
    const actions = document.createElement('div')
    actions.className = 'vsidian-addons-actions'
    if (focusEntry === ADDONS_SECTION_MANAGE_ENTRY) {
      actions.classList.add('vsidian-settings-item-located')
      actions.scrollIntoView?.({ block: 'nearest' })
    }
    actions.append(
      this.button(t('addons.searchMarketplace'), () => {
        this.send({ kind: 'addons.openSearch' })
      }, 'vsidian-addons-primary'),
      this.button(t('addons.openExtensionsView'), () => {
        this.send({ kind: 'addons.openExtensionsView' })
      }),
      // #354 T05 日志入口（故障排障；无定义无设置页的故障组件也经此排障）
      this.button(t('addons.openLogs'), () => {
        this.send({ kind: 'addons.openLogs' })
      }),
    )
    parent.append(actions)

    // ---- API 版本行（草案标注——不冒充已发布稳定 API） ----
    if (state) {
      const api = document.createElement('p')
      api.className = 'vsidian-addons-apiversion'
      api.textContent = t('addons.apiVersionLabel', { version: state.apiVersion })
      parent.append(api)
    }
  }

  /** 单条组件行：显示名（+官方徽章）、状态句、功能开关、组件设置页入口
   *  与 VSCode 扩展详情入口（#351 起开关与设置页入口按运行状态呈现；
   *  #354 located = 侧栏条目定位高亮） */
  private renderEntry(entry: AddonStatusEntry, apiVersion: string, located = false): HTMLElement {
    const item = document.createElement('div')
    item.className = 'vsidian-settings-item'
    if (located) {
      item.classList.add('vsidian-settings-item-located')
    }
    const label = document.createElement('div')
    label.className = 'vsidian-settings-item-label'
    const copy = document.createElement('div')
    copy.className = 'vsidian-settings-item-copy'
    const title = document.createElement('span')
    title.className = 'vsidian-settings-item-title'
    title.textContent = entry.official
      ? `${entry.label} · ${t('addons.officialBadge')}`
      : entry.label
    const runtimeText = addonRuntimeText(entry)
    const desc = document.createElement('span')
    desc.className = 'vsidian-settings-item-description'
    const statusSentence = `${entry.id} — ${addonStatusText(entry, apiVersion)}`
    desc.textContent = runtimeText === null ? statusSentence : `${statusSentence} · ${runtimeText}`
    copy.append(title, desc)
    const buttons = document.createElement('div')
    buttons.className = 'vsidian-addons-entry-actions'
    // #351 功能开关：切换运行生命周期（停用保留设置能力——结果经
    // addons.state 推送回显，页面不自行推断）。#353 T04 起列表行开关固定
    // 写用户默认层（列表行不携带作用范围；两层切换在基础设置区内）
    if (entry.enabled !== undefined) {
      buttons.append(this.button(entry.enabled ? t('addons.disable') : t('addons.enable'), () => {
        this.send({ kind: 'addons.setEnabled', addonId: entry.id, enabled: !entry.enabled })
      }))
    }
    // #353 T04 基础设置入口：有定义即可配置（故障暂停仍保留——定义在）
    if (entry.hasSettingsDefinitions) {
      buttons.append(this.button(t('addons.openSettingsArea'), () => {
        this.send({ kind: 'addons.settingsOpen', addonId: entry.id })
      }))
    }
    // #351 组件设置页入口：hasSettingsPage 由宿主按运行状态给出（故障
    // 暂停撤下——不可打开时入口消失而非禁用占位）
    if (entry.hasSettingsPage) {
      buttons.append(this.button(t('addons.openSettingsPage'), () => {
        this.send({ kind: 'addons.openAddonPage', addonId: entry.id })
      }))
    }
    // #354 T05 故障排障：状态行手动重试（先释放旧代次再重新唤醒；结局经
    // addons.state 推送回显）；日志入口在工具组与设置区排障块
    if (entry.fault !== undefined) {
      buttons.append(this.button(t('addons.retryFaulted'), () => {
        this.send({ kind: 'addons.retry', addonId: entry.id })
      }, 'vsidian-addons-retry'))
    }
    const detail = this.button(t('addons.openDetail'), () => {
      this.send({ kind: 'addons.openExtension', extensionId: entry.id })
    })
    detail.setAttribute('aria-label', t('addons.openDetail'))
    buttons.append(detail)
    label.append(copy, buttons)
    item.append(label)
    return item
  }

  // ---- T08（#357）行为冲突管理 ----

  /**
   * 行为冲突管理组（入口固定）：管理单位是注册的具体行为（名称 + 所属
   * 组件；说明/例子存在时按需展开）。行序按展示全序（关闭项保位呈现，
   * orderedAddonBehaviorKeys——与链执行的有效序同口径）；单项开关与
   * 调序经 addons.behaviorsSetDisabled/SetOrder 上送，结局由宿主推送
   * addons.behaviors 权威回显。
   */
  private renderBehaviorsArea(focusEntry?: string): HTMLElement {
    const area = document.createElement('section')
    area.className = 'vsidian-addons-behaviors'
    if (focusEntry === ADDONS_SECTION_BEHAVIORS_ENTRY) {
      area.classList.add('vsidian-settings-item-located')
    }
    const title = document.createElement('h3')
    title.className = 'vsidian-settings-group-title'
    title.textContent = t('addons.behaviorsGroupTitle')
    const hint = document.createElement('p')
    hint.className = 'vsidian-addons-behaviors-hint'
    hint.textContent = t('addons.behaviorsGroupHint')
    area.append(title, hint)

    const payload = this.behaviorsState
    if (payload === undefined) {
      const pending = document.createElement('p')
      pending.className = 'vsidian-settings-empty'
      pending.setAttribute('role', 'status')
      pending.textContent = t('addons.behaviorsLoading')
      area.append(pending)
    } else if (payload.behaviors.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'vsidian-settings-empty'
      empty.textContent = t('addons.behaviorsEmpty')
      area.append(empty)
    } else {
      const group = document.createElement('div')
      group.className = 'vsidian-settings-group'
      const disabledSet = new Set(payload.state === null ? [] : payload.state.disabled)
      const store: AddonBehaviorStateStore | null = payload.state
      const fullOrder = orderedAddonBehaviorKeys(payload.behaviors.map((entry) => `${entry.addonId}#${entry.id}`), store)
      const byKey = new Map(payload.behaviors.map((entry) => [`${entry.addonId}#${entry.id}`, entry]))
      fullOrder.forEach((key, index) => {
        const behavior = byKey.get(key)
        if (behavior !== undefined) {
          group.append(this.renderBehaviorRow(behavior, fullOrder, index, disabledSet.has(key)))
        }
      })
      area.append(group)
      if (payload.notice !== undefined) {
        const notice = document.createElement('p')
        notice.className = `vsidian-addons-behaviors-notice vsidian-addons-behaviors-notice-${payload.notice.kind}`
        notice.setAttribute('role', 'status')
        notice.textContent = t(payload.notice.kind === 'saved' ? 'addons.behaviorsSavedNotice' : 'addons.behaviorsSaveFailedNotice')
        area.append(notice)
      }
    }
    if (focusEntry === ADDONS_SECTION_BEHAVIORS_ENTRY) {
      area.scrollIntoView?.({ block: 'nearest' })
    }
    return area
  }

  /**
   * 单条行为行：调序按钮（上移/下移——真实 button，Tab 可达 Enter/Space
   * 原生激活；首末禁用）、名称、所属组件、状态徽章（单项关闭与整体停用/
   * 故障互相区分）、单项开关（原生 checkbox）与说明/例子展开块。
   */
  private renderBehaviorRow(behavior: AddonBehaviorInfo, fullOrder: readonly string[], index: number, userDisabled: boolean): HTMLElement {
    const key = `${behavior.addonId}#${behavior.id}`
    const addonEntry = this.state?.addons.find((entry) => entry.id === behavior.addonId)
    const item = document.createElement('div')
    item.className = 'vsidian-addons-behaviors-row'
    item.dataset.behaviorKey = key
    const label = document.createElement('label')
    label.className = 'vsidian-settings-item-label'
    const copy = document.createElement('span')
    copy.className = 'vsidian-settings-item-copy'
    const title = document.createElement('span')
    title.className = 'vsidian-settings-item-title'
    title.textContent = behavior.name
    const owner = document.createElement('span')
    owner.className = 'vsidian-addons-behaviors-owner'
    owner.textContent = t('addons.behaviorsOwnerLabel', { label: addonEntry?.label ?? behavior.addonId })
    copy.append(title, owner)
    // 状态徽章（互相区分）：单项关闭 = 用户逐项开关关闭（配置保留，可重开）；
    // 组件已停用/故障暂停 = 整组件层面（行为行与单项配置仍在——配置不丢）
    if (userDisabled) {
      copy.append(this.behaviorBadge('addons.behaviorsItemDisabledBadge', 'off'))
    }
    if (addonEntry !== undefined && addonEntry.enabled === false) {
      copy.append(this.behaviorBadge('addons.behaviorsAddonDisabledBadge', 'addon-off'))
    }
    if (addonEntry?.fault !== undefined) {
      copy.append(this.behaviorBadge('addons.behaviorsFaultedBadge', 'faulted'))
    }

    // 调序按钮组（键盘可达；首行上移/末行下移禁用——边界不可越）
    const orderControls = document.createElement('span')
    orderControls.className = 'vsidian-addons-behaviors-order'
    const move = (direction: 'up' | 'down', delta: number): HTMLButtonElement => {
      const button = this.button(t(direction === 'up' ? 'addons.behaviorsMoveUpText' : 'addons.behaviorsMoveDownText'), () => {
        const next = [...fullOrder]
        const target = index + delta
        ;[next[index], next[target]] = [next[target]!, next[index]!]
        this.send({ kind: 'addons.behaviorsSetOrder', order: next })
      }, 'vsidian-addons-behaviors-move')
      button.dataset.behaviorMove = direction
      button.setAttribute('aria-label', t(direction === 'up' ? 'addons.behaviorsMoveUpAria' : 'addons.behaviorsMoveDownAria', { name: behavior.name }))
      button.disabled = direction === 'up' ? index === 0 : index === fullOrder.length - 1
      return button
    }
    orderControls.append(move('up', -1), move('down', 1))

    // 单项开关（勾选 = 开启；上送后由宿主权威推送回显）
    const toggle = document.createElement('input')
    toggle.type = 'checkbox'
    toggle.className = 'vsidian-settings-checkbox'
    toggle.checked = !userDisabled
    toggle.dataset.behaviorKey = key
    toggle.setAttribute('aria-label', t('addons.behaviorsToggleAria', { name: behavior.name }))
    toggle.addEventListener('change', () => {
      this.send({ kind: 'addons.behaviorsSetDisabled', keys: [key], disabled: !toggle.checked })
    })
    label.append(copy, orderControls, toggle)
    item.append(label)

    // 说明/例子（存在时按需展开——注册方不强制提供）
    if (behavior.description !== undefined || behavior.examples !== undefined) {
      const details = document.createElement('details')
      details.className = 'vsidian-addons-behaviors-details'
      const summary = document.createElement('summary')
      summary.textContent = t('addons.behaviorsDetailsSummary')
      details.append(summary)
      if (behavior.description !== undefined) {
        const desc = document.createElement('p')
        desc.className = 'vsidian-addons-behaviors-description'
        desc.textContent = behavior.description
        details.append(desc)
      }
      if (behavior.examples !== undefined && behavior.examples.length > 0) {
        const examples = document.createElement('p')
        examples.className = 'vsidian-addons-behaviors-examples'
        examples.textContent = t('addons.behaviorsExamplesLabel', { examples: behavior.examples.join('、') })
        details.append(examples)
      }
      item.append(details)
    }
    return item
  }

  /** 行为状态徽章（kind 进类名——样式按状态区分） */
  private behaviorBadge(key: 'addons.behaviorsItemDisabledBadge' | 'addons.behaviorsAddonDisabledBadge' | 'addons.behaviorsFaultedBadge', kind: string): HTMLElement {
    const badge = document.createElement('span')
    badge.className = `vsidian-addons-behaviors-badge vsidian-addons-behaviors-badge-${kind}`
    badge.textContent = t(key)
    return badge
  }

  // ---- #353 T04 基础设置区 ----

  /** 设置区根（open 且载荷在场时非 null；组件已注销的空载荷时为 null） */
  private renderSettingsArea(): HTMLElement | null {
    const payload = this.settingsState
    if (!payload || payload.open === null || payload.addon === null) {
      return null
    }
    const area = document.createElement('section')
    area.className = 'vsidian-addons-settings'

    // 头部：标题 + 关闭
    const head = document.createElement('div')
    head.className = 'vsidian-addons-settings-head'
    const heading = document.createElement('h3')
    heading.className = 'vsidian-settings-group-title'
    heading.textContent = t('addons.settingsAreaTitle', { label: payload.addon.label })
    head.append(heading, this.button(t('addons.closeSettingsArea'), () => {
      this.send({ kind: 'addons.settingsClose' })
    }))
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
        }, 'vsidian-addons-retry'),
      )
      troubleshoot.append(faultTitle, reason, hint, faultActions)
      area.append(troubleshoot)
    }

    // 控件组：功能开关行 + 定义行
    const group = document.createElement('div')
    group.className = 'vsidian-settings-group'
    group.append(this.renderEnabledRow(payload.addon))
    const definitions = payload.addon.definitions
    if (definitions.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'vsidian-settings-empty'
      empty.textContent = t('addons.settingsEmpty')
      group.append(empty)
    }
    for (const def of definitions) {
      group.append(this.renderDefinitionRow(payload.addon, def))
    }
    area.append(group)

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
    copy.append(title, desc, this.sourceBadge(addon.enabled.source))
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
    copy.append(title)
    if (def.description) {
      const desc = document.createElement('span')
      desc.className = 'vsidian-settings-item-description'
      desc.textContent = def.description
      copy.append(desc)
    }
    const entry = addon.values[def.key]
    copy.append(this.sourceBadge(entry?.source ?? 'default'))
    head.append(copy)
    item.append(head)

    if (def.type === 'array') {
      item.append(this.renderArrayControl(addon, def))
    } else if (def.type === 'object') {
      item.append(this.renderObjectControl(addon, def))
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
    return createScalarDefinitionControl(def, value, (next) => {
      this.send({ kind: 'addons.settingsUpdate', addonId: addon.addonId, scope: this.scope, values: { [def.key]: next } })
    })
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
      rows.replaceChildren()
      draft.forEach((value, index) => {
        const row = document.createElement('div')
        row.className = 'vsidian-addons-array-row'
        row.append(
          createScalarItemControl(def.items, value, { 'data-addon-array-item': def.key }, (next) => {
            draft[index] = next
          }, 'input'),
          this.button(t('addons.arrayRemoveItem'), () => {
            draft.splice(index, 1)
            this.drafts.set(def.key, [...draft])
            renderRows()
          }, 'vsidian-addons-array-remove'),
        )
        rows.append(row)
      })
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
      }, 'vsidian-addons-array-save'),
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
    }, 'vsidian-addons-object-save'))
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
    }, 'vsidian-addons-clear-override')
    button.dataset.addonSettingKey = key
    return button
  }

  /** #351 T02 组件设置页挂载区（标题 + 关闭按钮 + host 移入；设置区/T02 分页级共用） */
  private renderAddonPageMount(openEntry: AddonStatusEntry): HTMLElement {
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

/** focusEntry 是否为侧栏组件条目定位（addon:<组件 ID>）；否则返回 undefined */
function focusAddonOf(focusEntry: string | undefined): string | undefined {
  if (focusEntry === undefined || !focusEntry.startsWith(SIDEBAR_ADDON_ENTRY_PREFIX)) {
    return undefined
  }
  return focusEntry.slice(SIDEBAR_ADDON_ENTRY_PREFIX.length)
}
