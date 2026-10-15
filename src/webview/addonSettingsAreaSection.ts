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
// - 组件详情：settingsState.open 指向组件时呈现设置区；设置区未开
//   但 openAddonSettingsPage 在场时呈现 T02 挂载回退。「返回组件列表」
//   上送 addons.settingsClose（#553 详情即页：连带 closeAddonPage）回
//   清单形态。
//
// #553 详情自绘页优先：有自绘设置页且未故障的组件，详情首屏即自绘内容
//（渲染时自动对账上送 addons.openAddonPage——消除额外「打开自定义页」
// 操作），平台保留外壳（标题/返回、作用域标签、总开关、故障排障块），
// 基础设置表单转为页内次级视图（双视图页签）；作用域状态与 #472 搜索
// 定位目标经 AddonSettingsContextRuntime 上抛（settingsMain 构造注入，
// 装载器转成 SDK settingsContext 面），定位落点交给自绘页消费——平台
// 不切回自己的表单（located 描边只留给无自绘页组件）。无自绘页组件与
// 故障暂停（desiredSettingsLoad 撤下自绘代码）维持整页基础表单。
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
import type { AddonSettingsContextRuntime } from './addonSettingsContext'

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
  /** #553 详情内容视图（有自绘页组件）：page = 自绘页优先；basics = 基础
   *  设置次级表单。本地 UI 态（推送重渲染保持；切换组件/重开复位 page） */
  private detailView: 'page' | 'basics' = 'page'
  /** #553 自绘页自动打开的请求去重（已发 openAddonPage 但应答未达期间不
   *  重发——宿主 openSettingsPage 会递增装载代次，重发即世代抖动） */
  private openPageRequested: string | undefined
  /** #553 关闭他组件残留挂载的请求去重（同款口径——应答未达不重发） */
  private closePageRequested: string | undefined
  private parent: HTMLElement | undefined

  constructor(
    private readonly bridge: SettingsPageBridge,
    /** #351 T02 组件设置页挂载宿主元素（settingsMain 创建的持久容器——
     *  装载器 mountRoot 挂进它；不随分页重渲染销毁，重渲染只移动节点） */
    private readonly addonSettingsHost?: HTMLElement,
    /** #554 组件条目选中态变化回调（settingsMain 接视图 refreshSidebar）：
     *  addons.settingsState 推送（当前打开组件切换/关闭）后触发侧栏重建，
     *  分页自身不直接改侧栏 DOM（与 AddonSection 的 onSidebarChange 同构） */
    private readonly onSidebarCurrentChange?: () => void,
    /** #553 设置页上下文 runtime（作用域状态与搜索定位目标的页面桥——
     *  生产 settingsMain 构造注入，与装载器 env 同一实例；缺省时详情
     *  仍优先呈现自绘页，只是不向页面交付上下文） */
    private readonly settingsContext?: AddonSettingsContextRuntime,
  ) {}

  /** #554 侧栏组件条目当前项（settingsState.open 的只读派生视图）：
   *  设置区打开的组件非空时返回 'addon:<id>'，否则 undefined——不引入
   *  第二份组件状态源；挂载回退（openAddonSettingsPage）不作高亮源
   *  （只开自绘页而未开基础设置区时不冒充选中） */
  currentSidebarEntryId(): string | undefined {
    const open = this.settingsState?.open
    return open === null || open === undefined ? undefined : `addon:${open}`
  }

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
      } else {
        // #553 详情已开：定位目标立即交给自绘页（有自绘页且未故障时）
        this.deliverLocateToPage(target, this.settingsState)
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
        // #553 切换/关闭组件：详情视图复位自绘页优先、自绘页开合请求标记
        // 清空、定位交付清除（不把上一组件的目标串给下一组件）
        this.detailView = 'page'
        this.openPageRequested = undefined
        this.closePageRequested = undefined
        this.settingsContext?.clearLocateTarget()
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
        // #553 挂起定位到达：目标交给自绘页（有自绘页且未故障时——否则
        // 走既有表单 located 描边，见 appendDefinitionGroups）
        this.deliverLocateToPage(this.pendingFocus, message)
        this.pendingFocus = undefined
        this.consumingPendingFocus = true
      }
      this.render()
      // #554 当前组件变化（或关闭）→ 侧栏组件条目唯一选中同步重建（宿主
      // 推送链路：settingsMain 接视图 refreshSidebar——本分页不直接改侧栏）
      this.onSidebarCurrentChange?.()
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

  /** #553 定位目标交给自绘页（有自绘页且未故障时）：详情切自绘页视图，
   *  目标经上下文面按 addonId 定向交付（#555：只投给目标组件——切换窗口
   *  期仍装载的旧组件不收别人的目标）——平台不切回自己的表单（表单
   *  located 描边只留给无自绘页组件，见 appendDefinitionGroups 的
   *  markLocated 短路） */
  private deliverLocateToPage(target: AddonFocusTarget, payload: AddonSettingsStateMessage | undefined): void {
    const addon = payload?.addon
    if (!addon || addon.addonId !== target.addonId || !addon.hasCustomPage || addon.faulted) {
      return
    }
    this.detailView = 'page'
    this.settingsContext?.deliverLocateTarget(target.addonId, { kind: target.kind, key: target.key })
  }

  /** #553 自绘页挂载中的组件 ID（addons.state 与 settingsState 双源取
   *  available——openAddonPage 应答经 runtime notify 即时推 addons.state，
   *  settingsState 随写操作应答到达；任一在场即视为挂载）。
   *  取非空者的正确性依赖两个跨模块不变量，宿主侧改动前须核对：
   *  - 宿主每次关页（closeSettingsPage / faultRecord / releaseGeneration）
   *    都同步 notify 推新鲜 addons.state——本端 this.state 不驻留旧挂载值；
   *  - 单一 postMessage 管道 FIFO——两源消息的处理顺序与宿主发送顺序
   *    一致，payload 兜底读取不会盖掉更晚的关页推送 */
  private mountedPageOf(payload: AddonSettingsStateMessage): string | null {
    return this.state?.openAddonSettingsPage ?? payload.openAddonSettingsPage ?? null
  }

  /** #553 自绘页开合对账（渲染副作用，转移守卫幂等）：
   *  - 详情渲染（有自绘页且未故障）→ 自动上送 openAddonPage（打开详情即
   *    自绘页——消除额外「打开自定义设置页」操作）；应答未达期间不重发；
   *  - 故障/无自绘页 → 清请求标记（重试恢复后可再次自动打开）；
   *  - 他组件挂载残留 → 先上送 closeAddonPage 撤下再开新组件（#555：切换
   *    到有自绘页的组件同样先关旧组件——宿主 openSettingsPage 直接覆盖单一
   *    settingsOpenAddon，不先关则旧组件的 unload 永不推出，装载器侧新旧
   *    并存；close 先于 open 发送使宿主对账依次经 null → 新组件，unload
   *    旧 / load 新指令顺序天然正确）。 */
  private reconcileAddonPage(payload: AddonSettingsStateMessage): void {
    const addon = payload.addon
    if (!addon) {
      return
    }
    const self = addon.addonId
    const mounted = this.mountedPageOf(payload)
    const wantPage = addon.hasCustomPage && !addon.faulted
    if (mounted === self) {
      this.openPageRequested = undefined
    }
    if (!wantPage && this.openPageRequested === self) {
      this.openPageRequested = undefined
    }
    if (mounted === null || mounted === self) {
      this.closePageRequested = undefined
    } else if (this.closePageRequested !== mounted) {
      this.closePageRequested = mounted
      this.send({ kind: 'addons.closeAddonPage' })
    }
    if (wantPage && mounted !== self && this.openPageRequested !== self) {
      this.openPageRequested = self
      this.send({ kind: 'addons.openAddonPage', addonId: self })
    }
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

  /** 基础设置区（open 且载荷在场时非 null；组件已注销的空载荷时为 null）。
   *  #553 起详情分两形态：有自绘页且未故障 → 自绘页优先（平台外壳 + 页内
   *  双视图页签，基础表单转次级）；否则维持整页基础表单（无自绘页组件，
   *  或故障暂停——desiredSettingsLoad 已撤下自绘代码，基础控件供修正参数） */
  private renderSettingsArea(focusEntry?: string): HTMLElement | null {
    const payload = this.settingsState
    if (!payload || payload.open === null || payload.addon === null) {
      return null
    }
    const addon = payload.addon
    const customFirst = addon.hasCustomPage && !addon.faulted
    // #553 打开语义对账（自动开页/残留撤除）与上下文快照同步（渲染副作用，
    // 转移守卫幂等——重复推送不重发消息、等值不分发）
    this.reconcileAddonPage(payload)
    this.settingsContext?.applyScope({ scope: this.scope, hasWorkspace: payload.hasWorkspace })

    const area = document.createElement('section')
    area.className = 'vsidian-addons-settings'
    if (focusEntry === ADDON_SETTINGS_SECTION_AREA_ENTRY) {
      area.classList.add('vsidian-settings-item-located')
      area.scrollIntoView?.({ block: 'nearest' })
    }

    // 头部：标题（自绘页优先形态下详情即组件设置本体，用「{label} 设置」；
    // 基础表单形态维持「基础设置：{label}」）+ 关闭（#553 详情即页：关闭
    // 详情连带撤下自绘页——不留无详情的裸挂载态）
    const head = document.createElement('div')
    head.className = 'vsidian-addons-settings-head'
    const heading = document.createElement('h3')
    heading.className = 'vsidian-settings-group-title'
    heading.textContent = t(customFirst ? 'addons.settingsDetailTitle' : 'addons.settingsAreaTitle', { label: addon.label })
    head.append(heading, this.button(t('addons.closeSettingsArea'), () => {
      // closeAddonPage 无条件连带发（不按 mountedPageOf 判定）：open 请求
      // 在途（应答未达）时渲染闭包 payload 看不到挂载，按挂载可见性判定
      // 会漏发 close——宿主侧页仍会挂载，回退落入 T02 裸挂载视图。宿主
      // closeSettingsPage 对未开页有 undefined 早退守卫，重复关闭无害
      this.send({ kind: 'addons.settingsClose' })
      this.send({ kind: 'addons.closeAddonPage' })
    }, '', { [REBUILD_FOCUS_ATTR]: 'close-settings-area' }))
    area.append(head)

    // 双标签（用户默认 / 当前工作区；无工作区禁用 + 提示）——平台外壳恒
    // 在场；#553 切换经上下文面上抛（作用域真实传至组件，自绘控件据此
    // 对齐显示值与写入目标）
    const tabs = document.createElement('div')
    tabs.className = 'vsidian-addons-scope-tabs'
    tabs.setAttribute('role', 'tablist')
    for (const scope of ['user', 'workspace'] as const) {
      const tab = this.button(t(scope === 'user' ? 'addons.scopeUserDefault' : 'addons.scopeWorkspace'), () => {
        this.scope = scope
        this.settingsContext?.applyScope({ scope, hasWorkspace: payload.hasWorkspace })
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
    if (addon.faulted) {
      const troubleshoot = document.createElement('div')
      troubleshoot.className = 'vsidian-addons-fault-troubleshoot'
      const faultTitle = document.createElement('h4')
      faultTitle.className = 'vsidian-settings-group-title'
      faultTitle.textContent = t('addons.faultTroubleshootTitle')
      const reason = document.createElement('p')
      reason.className = 'vsidian-addons-fault-hint'
      reason.textContent = t('addons.statusFaulted', { detail: addon.faultReason ?? '' })
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
          this.send({ kind: 'addons.retry', addonId: addon.addonId })
        }, 'vsidian-addons-retry', { [REBUILD_FOCUS_ATTR]: `settings-retry:${addon.addonId}` }),
      )
      troubleshoot.append(faultTitle, reason, hint, faultActions)
      area.append(troubleshoot)
    }

    if (customFirst) {
      // ---- #553 自绘页优先形态 ----
      // 总开关行（平台外壳——组件主开关不随视图切换隐藏；两层作用范围随
      // 标签、workspace 已覆盖可清除）
      const enabledCard = document.createElement('div')
      enabledCard.className = 'vsidian-settings-group'
      enabledCard.append(this.renderEnabledRow(addon))
      area.append(enabledCard)
      // 详情双视图页签（自定义设置页 / 基础设置——ui-patterns §2.2 pill
      // 页签档位，与作用域标签同款形态）
      const viewTabs = document.createElement('div')
      viewTabs.className = 'vsidian-addons-detail-tabs'
      viewTabs.setAttribute('role', 'tablist')
      for (const view of ['page', 'basics'] as const) {
        const tab = this.button(t(view === 'page' ? 'addons.detailCustomViewTab' : 'addons.detailBasicsViewTab'), () => {
          this.detailView = view
          this.render()
        }, 'vsidian-addons-detail-tab')
        tab.setAttribute('role', 'tab')
        tab.setAttribute(REBUILD_FOCUS_ATTR, `detail-view:${view}`)
        tab.setAttribute('aria-selected', this.detailView === view ? 'true' : 'false')
        viewTabs.append(tab)
      }
      area.append(viewTabs)
      if (this.detailView === 'page') {
        // 自绘页挂载区（详情主视图）：标题与关闭在外壳——这里只搬 host
        // （持久容器移动节点不销毁，装载器 mountRoot 的挂载点）
        if (this.addonSettingsHost) {
          const wrap = document.createElement('div')
          wrap.className = 'vsidian-addons-addonpage'
          wrap.append(this.addonSettingsHost)
          area.append(wrap)
        }
      } else {
        // 基础设置（次级视图）：定义注册、值校验、存储与清除覆盖入口保留
        this.appendDefinitionGroups(area, payload, { includeEnabledRow: false, markLocated: false })
        this.appendNotice(area, payload)
      }
    } else {
      // ---- 基础表单整页形态（无自绘页，或故障暂停） ----
      this.appendDefinitionGroups(area, payload, { includeEnabledRow: true, markLocated: true })
      this.appendNotice(area, payload)
    }
    return area
  }

  /** 控件组（#472 分组呈现；#553 起 customFirst 形态不含总开关行——总开关
   *  升入平台外壳）。located 描边只留给无自绘页组件（#553：定位目标交给
   *  自绘页，平台不描自己的表单） */
  private appendDefinitionGroups(
    area: HTMLElement,
    payload: AddonSettingsStateMessage,
    options: { includeEnabledRow: boolean; markLocated: boolean },
  ): void {
    const addon = payload.addon!
    const definitions = addon.definitions
    const declaredGroups: AddonSettingGroup[] = []
    for (const group of addon.groups ?? []) {
      if (!declaredGroups.some((seen) => seen.key === group.key)) {
        declaredGroups.push(group)
      }
    }
    // #472 定位落点（目标组件匹配时）：def 级描定义行、group 级描组容器
    //（互斥——落点唯一；渲染循环内按 key 比对标记，避免选择器转义）
    const located = options.markLocated ? this.locatedTarget : undefined
    const locatedRowOf = (def: AddonSettingDefinition): boolean =>
      located !== undefined && located.kind === 'def' && located.addonId === addon.addonId && located.key === def.key
    // 引用键不在声明集（异常载荷，宿主校验后不应出现）时回落首容器——
    // 不吞呈现
    const declaredKeys = new Set(declaredGroups.map((group) => group.key))
    const belongsToFirst = (def: AddonSettingDefinition): boolean => def.group === undefined || !declaredKeys.has(def.group)
    const firstGroup = document.createElement('div')
    firstGroup.className = 'vsidian-settings-group'
    if (options.includeEnabledRow) {
      firstGroup.append(this.renderEnabledRow(addon))
    }
    if (definitions.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'vsidian-settings-empty'
      empty.textContent = t('addons.settingsEmpty')
      firstGroup.append(empty)
    }
    for (const def of definitions) {
      if (belongsToFirst(def)) {
        const row = this.renderDefinitionRow(addon, def)
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
      if (located !== undefined && located.kind === 'group' && located.addonId === addon.addonId && located.key === group.key) {
        card.classList.add('vsidian-settings-item-located')
      }
      for (const def of definitions) {
        if (def.group === group.key) {
          const row = this.renderDefinitionRow(addon, def)
          if (locatedRowOf(def)) {
            row.classList.add('vsidian-settings-item-located')
          }
          card.append(row)
        }
      }
      area.append(card)
    }
  }

  /** 保存反馈（notice 由宿主应答推送；常规推送清空——不残留旧结局） */
  private appendNotice(area: HTMLElement, payload: AddonSettingsStateMessage): void {
    if (payload.notice === undefined) {
      return
    }
    const notice = document.createElement('p')
    notice.className = `vsidian-addons-settings-notice vsidian-addons-settings-notice-${payload.notice.kind}`
    notice.setAttribute('role', 'status')
    notice.textContent = this.noticeText(payload.notice)
    area.append(notice)
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
