// 「附加组件」设置分页（#350 T01 / #351 T02；#465 IA 分页起收敛为组件级
// 管理）：组件状态列表（官方/第三方分组）+ 功能开关（启用/停用）+ 各入
// 口（设置/扩展详情/故障重试）+ 市场搜索 + VSCode 扩展管理入口。接入现
// 有 Vsidian 自有设置页（SettingsPageSection）。
//
// #465 IA 分页（2026-10-13 用户指令，二轮收紧）：本分页**禁止**出现启用
// 开关以外的任何组件设置项——基础设置区（#353 T04）与组件设置页挂载
// （#351 T02）的渲染通道在此堵死（本类不消费 addons.settingsState 与
// openAddonSettingsPage，守护契约见 test「通道堵死」用例）：组件基础
// 设置独立成「组件设置」分页（addonSettingsAreaSection.ts），本页各入口
// 经 settingsOpen / openAddonPage 上送并导航过去；跨组件行为仲裁在
// 「输入行为管理」分页（addonBehaviorManageSection.ts，#466 更名）。
//
// 边界（票面）：安装、卸载与整个扩展的禁用继续由 VSCode 管理——本分页
// 只呈现状态并提供 VSCode 入口；市场关键词（vsidian-addon）仅帮助寻找，
// 不代表接入协议或官方身份。API 版本行保持草案标注（draft 恒真），不把
// 声明能力冒充已发布稳定 API。#351 起：开关只切换运行贡献（enable 生命
// 周期），停用后设置能力保留（「组件设置」分页仍可用）；故障暂停撤下组件
// 设置页入口（hasSettingsPage=false）并显示原因——状态句呈现「故障暂停」。
//
// 状态权威在宿主（addons.state 推送回显；装载经 addons.get 拉取，由
// settingsMain 装载点统一发送）；页面不自行推断。文案一律 t() 取词。
import { t } from '../shared/i18n'
import { isHostToWebview } from '../shared/protocol'
import type { AddonStatusEntry } from '../shared/addonIdentity'
import { type SettingsPageBridge, type SettingsPageSection, type SettingsSidebarGroup } from './settingsPageView'
import { ADDON_SETTINGS_SECTION_ID } from './addonSettingsAreaSection'
import { captureSectionRebuildAnchor, restoreSectionRebuildAnchor, REBUILD_FOCUS_ATTR } from './sectionRebuildGuard'

type AddonsStateMessage = Extract<import('../shared/protocol').HostToWebview, { kind: 'addons.state' }>

/** 侧栏组件条目定位键前缀（mount 的 focusEntry 形如 addon:<组件 ID>） */
const SIDEBAR_ADDON_ENTRY_PREFIX = 'addon:'

/** #462 定位高亮一次性退场时限：跳转落点是导航反馈而非持久状态标记，
 *  呈现约 1.5s 后摘除（ui-patterns §2.4 档位语义） */
const LOCATED_FADE_MS = 1500

/** 全局搜索定位入口 id（list = 状态列表；manage = 搜索与管理入口组。
 *  行为管理入口已随 #465 迁往独立分页（ADDONS_BEHAVIORS_SECTION_ENTRY） */
export const ADDONS_SECTION_LIST_ENTRY = 'list'
export const ADDONS_SECTION_MANAGE_ENTRY = 'manage'

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
  /** bare 装配（2026-10-12 验收反馈）：本页为多组管理型分页——状态列表
   *  与操作行各自成块，不套 section-content 大卡片（组卡片直挂页面列表，
   *  与编辑器页二级组同级形态） */
  readonly bare = true
  get title(): string { return t('settings.addonsSection') }
  get description(): string { return t('settings.addonsSectionDescription') }

  private state: AddonsStateMessage | undefined
  /** #354 T05 侧栏条目定位的组件 ID（推送重渲染在退场时限内保持——定位
   *  后排定一次性退场（#462），摘除高亮类时一并清空；时限外推送不再重现） */
  private locatedAddonId: string | undefined
  /** #462 定位高亮退场计时器（显式定位时排定；fire 时清定位态并摘除
   *  已渲染的高亮类——实例级，跨分页挂载/卸载存续，保证最终退场） */
  private locatedFadeTimer: ReturnType<typeof setTimeout> | undefined
  private parent: HTMLElement | undefined

  constructor(
    private readonly bridge: SettingsPageBridge,
    /** #354 T05 侧栏大组数据变化回调（settingsMain 接视图 refreshSidebar；
     *  addons.state 推送后触发侧栏重建，分页自身不直接改侧栏 DOM） */
    private readonly onSidebarChange?: () => void,
    /** #465 跨分页导航回调（settingsMain 接视图 selectSection）：设置类
     *  入口（基础设置/组件设置页/侧栏组件条目）打开组件设置时离开本页、
     *  落到「组件设置」分页——本页不承载任何组件设置内容 */
    private readonly navigate?: (sectionId: string) => void,
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
    ]
  }

  mount(parent: HTMLElement, focusEntry?: string): (() => void) | undefined {
    this.parent = parent
    // #354 T05 侧栏组件条目定位（addon:<组件 ID>）：可配置（有定义或有
    // 自己的设置页）时打开该组件基础设置区并导航到「组件设置」分页——
    // 停用组件仍可配置（ADR Q23）；纯运行组件（两者皆无）只定位状态列
    // 表行，不强开设置区（本页恒为管理视图，无详情可退）
    const focusAddonId = focusAddonOf(focusEntry)
    if (focusAddonId !== undefined) {
      const entry = this.state?.addons.find((item) => item.id === focusAddonId)
      if (entry && (entry.hasSettingsDefinitions || entry.hasSettingsPage)) {
        this.send({ kind: 'addons.settingsOpen', addonId: focusAddonId })
        this.navigate?.(ADDON_SETTINGS_SECTION_ID)
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
    // 通道堵死（#465 二轮）：addons.settingsState 与 openAddonSettingsPage
    // 的消费方是「组件设置」分页——本页忽略一切设置载荷，任何组件设置
    // 内容不得在此渲染（守护契约见 addonSettingsSection.test.ts）
  }

  private send(message: object): void {
    this.bridge.postMessage(message)
  }

  /** #462 排定定位高亮一次性退场：约 1.5s 后摘除列表区已渲染的 located
   *  类（列表容器自身与条目行）并清定位态——此后推送重渲染不再重现 */
  private scheduleLocatedFade(): void {
    if (this.locatedFadeTimer !== undefined) {
      clearTimeout(this.locatedFadeTimer)
    }
    this.locatedFadeTimer = setTimeout(() => {
      this.locatedFadeTimer = undefined
      this.locatedAddonId = undefined
      this.parent?.querySelectorAll(
        '.vsidian-addons-list.vsidian-settings-item-located, .vsidian-addons-list .vsidian-settings-item-located',
      ).forEach((el) => {
        el.classList.remove('vsidian-settings-item-located')
      })
    }, LOCATED_FADE_MS)
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

  /** 打开组件设置并导航到「组件设置」分页（本页不承载设置内容） */
  private openAddonSettings(open: () => void): void {
    open()
    this.navigate?.(ADDON_SETTINGS_SECTION_ID)
  }

  private render(focusEntry?: string): void {
    const parent = this.parent
    if (!parent) {
      return
    }
    // #467 同分页推送重渲染保持滚动与焦点（守卫说明见 sectionRebuildGuard）；
    // 显式定位渲染（focusEntry 在场）不恢复——定位的 scrollIntoView 与
    // 视图侧导航焦点语义优先
    const anchor = focusEntry === undefined ? captureSectionRebuildAnchor(parent) : undefined
    parent.replaceChildren()
    const state = this.state
    // #354 T05 侧栏组件条目定位：显式携带 focusEntry 时更新定位意图，
    // 状态推送的无参重渲染保持既有定位（locatedAddonId）
    const explicitFocus = focusAddonOf(focusEntry)
    if (explicitFocus !== undefined || focusEntry !== undefined) {
      this.locatedAddonId = explicitFocus
    }
    const focusAddonId = this.locatedAddonId
    // #462 跳转落点是一次性导航反馈：显式定位（列表级或组件条目）排定
    // 退场计时，推送触发的无参重渲染不重排（不因后续活动延长落点寿命）
    if (focusEntry === ADDONS_SECTION_LIST_ENTRY || explicitFocus !== undefined) {
      this.scheduleLocatedFade()
    }

    // ---- 状态列表（官方分组在前；列表未到达时显示读取中） ----
    const listWrap = document.createElement('div')
    listWrap.className = 'vsidian-addons-list'
    // #462 容器级与条目级定位互斥：定位到具体组件只标条目行——容器描边
    // （offset 8px 外扩套住标题与卡片）与条目描边、分组灰边框三层叠加是
    // 票面「圈圈套圈圈」观感来源；列表级定位（list 入口）才描容器本身
    if (focusEntry === ADDONS_SECTION_LIST_ENTRY) {
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
    } else if (explicitFocus !== undefined) {
      // #467 定位条目滚入视图只在显式定位渲染执行：locatedAddonId 跨推送
      // 持久（定位高亮保留），但推送重渲染的重放会在渲染中间态（内容塌
      // 缩中）强制布局把主区滚动钳到顶部——回顶向量
      listWrap.querySelector('.vsidian-settings-item-located')?.scrollIntoView?.({ block: 'nearest' })
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
    // #467 重建完成：恢复主区滚动与分页内焦点（同步块内，见守卫头注）
    if (anchor) {
      restoreSectionRebuildAnchor(parent, anchor)
    }
  }

  /** 单条组件行：显示名（+官方徽章）、状态句、功能开关、设置入口（导航
   *  到「组件设置」分页）与 VSCode 扩展详情入口（#351 起开关与设置页入口
   *  按运行状态呈现；#354 located = 侧栏条目定位高亮） */
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
    // 写用户默认层（列表行不携带作用范围；两层切换在「组件设置」分页内）
    if (entry.enabled !== undefined) {
      buttons.append(this.button(entry.enabled ? t('addons.disable') : t('addons.enable'), () => {
        this.send({ kind: 'addons.setEnabled', addonId: entry.id, enabled: !entry.enabled })
      }, '', { [REBUILD_FOCUS_ATTR]: `entry-toggle:${entry.id}` }))
    }
    // #353 T04 设置入口 → #553 起唯一设置入口：有设置定义**或有自己的设置
    // 页**即可配置（打开详情——有自绘页时详情首屏即自绘内容，openAddonPage
    // 由详情渲染自动对账发出，本页不再保留独立「打开组件设置页」入口）。
    // #465 二轮：入口只导航，设置内容在「组件设置」分页呈现。故障暂停仍
    // 保留（定义在——ADR Q23：已有定义时平台供基础控件修正参数）
    if (entry.hasSettingsDefinitions || entry.hasSettingsPage) {
      buttons.append(this.button(t('addons.openSettingsArea'), () => {
        this.openAddonSettings(() => {
          this.send({ kind: 'addons.settingsOpen', addonId: entry.id })
        })
      }, '', { [REBUILD_FOCUS_ATTR]: `entry-settings:${entry.id}` }))
    }
    // #354 T05 故障排障：状态行手动重试（先释放旧代次再重新唤醒；结局经
    // addons.state 推送回显）；日志入口在工具组与「组件设置」分页排障块
    if (entry.fault !== undefined) {
      buttons.append(this.button(t('addons.retryFaulted'), () => {
        this.send({ kind: 'addons.retry', addonId: entry.id })
      }, 'vsidian-addons-retry', { [REBUILD_FOCUS_ATTR]: `retry:${entry.id}` }))
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
}

/** focusEntry 是否为侧栏组件条目定位（addon:<组件 ID>）；否则返回 undefined */
function focusAddonOf(focusEntry: string | undefined): string | undefined {
  if (focusEntry === undefined || !focusEntry.startsWith(SIDEBAR_ADDON_ENTRY_PREFIX)) {
    return undefined
  }
  return focusEntry.slice(SIDEBAR_ADDON_ENTRY_PREFIX.length)
}
