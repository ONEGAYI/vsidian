// 「输入行为管理」独立分页（#465 IA 分页 + #466 更名）：附加组件页收敛为
// 组件级管理后，跨组件行为仲裁面（注册行为调序 + 逐项关闭）迁至本分页——
// 管理语义的名称与说明（原「行为冲突管理」措辞退役）、输入/键盘语义图标
// （原 git 合并形线条退役）。行级交互契约不变：管理单位是注册的具体行为
// （名称 + 所属组件；说明/例子存在时按需展开），行序按展示全序（关闭项保位
// 呈现，orderedAddonBehaviorKeys——与链执行的有效序同口径），单项开关与
// 调序经 addons.behaviorsSetDisabled/SetOrder 上送，结局由宿主推送
// addons.behaviors 权威回显。#464 起：注册名是 {zh-cn,en} 映射形态时按当前
// 页面语言选值（resolveAddonBehaviorName 透传解析），本层不做多语言处理。
//
// #474 分页与积木筛选（docs/specs/behavior-manage-pagination.md）：
// - **列表分页**（D1–D3）：20 行/页（BEHAVIOR_LIST_PAGE_SIZE）；上一页/
//   下一页 + 「第 x / y 页」+ 首末页 `<<`/`>>`（按需禁用发灰）；总页数
//   ≤ 1 不渲染控件。命中保持展示全序（查询只过滤不排序，D7）。
// - **积木筛选**（D4–D9）：搜索区为积木构造器（behaviorQueryBuilder——
//   编辑器组件；求值/序列化在 shared/behaviorFilterQuery 纯函数）；行为
//   显示名按「当前语言解析名」匹配（渲染时现算，切语言后查询含义跟随）。
// - **调序跨页跟随**（D10）：上移/下移语义不变（全序相邻交换），交换后
//   被移动行离开当前页时视图跟随跳页并保持可见。
// - **持久**（D11）：页码 + 查询树跨重启用户级持久（宿主 globalState，经
//   addons.behaviorsViewGet 拉取 / behaviorsViewSet 写入）；会话内恢复走
//   captureState/restoreState（settings.uiState，宿主内存级）且**优先于**
//   跨重启值；页码越界静默回落第 1 页。
// - **定位**（D12–D15）：focusEntry 扩 `page:<n>` 与 `row:<完整键>`（行
//   优先）；定位挂起至 behaviors 载荷与视图状态都到达后求值合法性；非法
//   回落默认渲染 + toast；定位行被当前查询过滤时清空查询定位 + toast 说明
//   + 气泡内撤销（恢复查询与页码）。
// - toast 经设置页入口注入（复用编辑器侧 ToastChannel 随设置页 bundle，
//   D14 形态演进——撤销按钮 + 倒计时条）。
//
// 状态权威在宿主（addons.behaviors / addons.state 推送回显；装载经
// addons.behaviorsGet / addons.get 拉取，由 settingsMain 装载点统一发送）；
// 视图状态（页码 + 查询树）webview 自持权威、宿主只持久。文案一律 t() 取词。
import { t, currentLocaleLang } from '../shared/i18n'
import { isHostToWebview } from '../shared/protocol'
import {
  orderedAddonBehaviorKeys,
  resolveAddonBehaviorName,
  type AddonBehaviorInfo,
  type AddonBehaviorStateStore,
} from '../shared/addonBehaviors'
import {
  BEHAVIOR_LIST_PAGE_SIZE,
  evaluateBehaviorQuery,
  paginateBehaviorList,
  parseBehaviorQueryFilter,
  resolveBehaviorRowStatus,
  type BehaviorQueryFilter,
  type BehaviorQueryRowContext,
} from '../shared/behaviorFilterQuery'
import { groupIcon, type SettingsPageBridge, type SettingsPageSection } from './settingsPageView'
import { captureSectionRebuildAnchor, restoreSectionRebuildAnchor, REBUILD_FOCUS_ATTR } from './sectionRebuildGuard'
import { BehaviorQueryBuilder } from './behaviorQueryBuilder'

type AddonsStateMessage = Extract<import('../shared/protocol').HostToWebview, { kind: 'addons.state' }>
type AddonBehaviorsMessage = Extract<import('../shared/protocol').HostToWebview, { kind: 'addons.behaviors' }>

/** 轻提示通道（设置页入口注入 ToastChannel；测试可注入 stub）——D14 形态
 *  演进后 show 携带可选气泡内撤销按钮 */
export interface BehaviorManageToastChannel {
  show(text: string, severity?: 'neutral' | 'warning' | 'error', key?: string,
    action?: { label: string; onClick: () => void }): void
}

/** 全局搜索定位入口 id（behaviors = 行为卡片） */
export const ADDONS_BEHAVIORS_SECTION_ID = 'addons-behaviors'
export const ADDONS_BEHAVIORS_SECTION_ENTRY = 'behaviors'

/** focusEntry 行内定位形状（D12）：`page:<n>` 定位页 / `row:<完整键>` 定位行 */
const FOCUS_PAGE_PATTERN = /^page:(\d+)$/
const FOCUS_ROW_PREFIX = 'row:'

/** 行渲染信息：求值上下文（单值状态——状态积木求值输入）+ 原始三标志
 *  （徽章多标注呈现与单项开关勾选态——徽章条件独立叠加，「已关闭」与
 *  「故障暂停」可并存，不随求值单值归类收敛） */
interface BehaviorRowRenderInfo {
  readonly ctx: BehaviorQueryRowContext
  readonly userDisabled: boolean
  readonly addonDisabled: boolean
  readonly faulted: boolean
}

/** 定位求值结果：invalid = 非法回落（toast）；整卡定位沿用既有条目形状 */
interface FocusResolution {
  readonly kind: 'card' | 'page' | 'row' | 'invalid'
  readonly page?: number
  readonly rowKey?: string
}

export class AddonBehaviorManageSection implements SettingsPageSection {
  readonly id = ADDONS_BEHAVIORS_SECTION_ID
  /** 输入框 + I 型光标字形（#466：输入/键盘语义，替换原 git 合并形线条） */
  readonly icon = 'inputCursor' as const
  /** bare 装配（多组管理型分页同附加组件页先例）：组卡片直挂页面列表，
   *  不套 section-content 大卡片 */
  readonly bare = true
  get title(): string { return t('settings.addonsBehaviorsSection') }
  get description(): string { return t('settings.addonsBehaviorsSectionDescription') }

  /** 行为目录载荷（addons.behaviors；undefined = 未到达） */
  private behaviorsState: AddonBehaviorsMessage | undefined
  /** 组件状态（行为行的所属组件显示名与停用/故障徽章来源） */
  private state: AddonsStateMessage | undefined
  private parent: HTMLElement | undefined
  /** 当前页码（1 起；渲染时经 paginateBehaviorList 规范化——越界回落第 1 页） */
  private page = 1
  /** #474 视图状态（页码 + 查询树）跨重启持久是否已应答（定位消费条件之一：
   *  两个载荷都到达才求值定位，避免「持久查询后到覆盖掉已执行的定位」竞态） */
  private viewStateResolved = false
  /** 会话内 uiState 已恢复（restoreState 成功）：跨重启视图值不再应用
   *  （会话内记忆更近，恢复优先） */
  private sessionRestored = false
  /** 挂起定位（mount 带 focusEntry 但载荷未齐时缓存；消费一次后清除） */
  private pendingFocus: string | undefined
  /** 调序视图跟随（D10）：待跟随的移动行完整键（下一次 behaviors 推送
   *  渲染时消费——视图跳至该行所在页并保持可见） */
  private followKey: string | undefined
  /** 定位行高亮（located 类；渲染当次应用） */
  private focusRowKey: string | undefined
  /** 积木查询构造器（跨渲染复用 DOM——编辑现场与焦点不因列表重渲染丢失） */
  private readonly queryBuilder: BehaviorQueryBuilder
  /** 当前列表容器引用（查询编辑的轻量重渲染目标；随整卡渲染重建） */
  private listContainer: HTMLElement | undefined
  private stateSink: (() => void) | undefined

  constructor(
    private readonly bridge: SettingsPageBridge,
    private readonly toast: BehaviorManageToastChannel | undefined = undefined,
  ) {
    this.queryBuilder = new BehaviorQueryBuilder({
      onChange: (query) => this.onQueryChange(query),
      onClearAll: (previousQuery) => {
        // 垃圾桶「无选中单击清空整个查询」：可撤销 toast（D15 的气泡撤销
        // 机制应用——恢复清空前的查询与页码）
        this.showUndoableClearToast(previousQuery, this.page)
      },
    })
  }

  get entries() {
    return [
      {
        id: ADDONS_BEHAVIORS_SECTION_ENTRY,
        title: t('settings.addonsBehaviorsSection'),
        description: t('settings.addonsBehaviorsSectionDescription'),
      },
    ]
  }

  /** #474 会话内输入态捕获（settings.uiState 载荷；宿主不解释）：页码 +
   *  查询树（空查询省字段——同态幂等） */
  captureState(): unknown {
    const query = this.queryBuilder.getQuery()
    return query.blocks.length > 0 ? { page: this.page, query } : { page: this.page }
  }

  /** #474 会话内恢复（mount 之前调用；载荷形态不符整条忽略）：成功后
   *  sessionRestored 置位——跨重启视图值不再覆盖（会话内记忆更近） */
  restoreState(state: unknown): void {
    if (typeof state !== 'object' || state === null) {
      return
    }
    const candidate = state as { page?: unknown; query?: unknown }
    if (typeof candidate.page !== 'number' || !Number.isInteger(candidate.page) || candidate.page < 1) {
      return
    }
    let query: BehaviorQueryFilter | null = null
    if (candidate.query !== undefined) {
      query = parseBehaviorQueryFilter(candidate.query)
      if (query === null) {
        return
      }
    }
    this.page = candidate.page
    this.queryBuilder.setQuery(query ?? { version: 1, blocks: [] })
    this.sessionRestored = true
  }

  setStateSink(sink: () => void): void {
    this.stateSink = sink
  }

  mount(parent: HTMLElement, focusEntry?: string): (() => void) | undefined {
    this.parent = parent
    this.pendingFocus = focusEntry
    this.render(focusEntry)
    return () => {
      this.parent = undefined
      // 构造器的 document 级菜单监听随分页卸载释放（评审 B-4：键盘切分页
      // 不触发 pointerdown 自愈路径）
      this.queryBuilder.dispose()
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
    // 行为目录（注册表上报对账）与用户覆盖变化都经 addons.behaviors 推送；
    // notice 为最近一次写操作结局（常规推送缺省不残留）
    if (message.kind === 'addons.behaviors') {
      this.behaviorsState = message
      this.render()
      return
    }
    // #474 视图状态应答（装载拉取一次）：null = 无存储默认态；会话内已恢复
    // 则跳过（uiState 记忆更近，见 restoreState）
    if (message.kind === 'addons.behaviorsView') {
      this.viewStateResolved = true
      if (!this.sessionRestored && message.view !== null) {
        this.page = message.view.page
        this.queryBuilder.setQuery(message.view.query ?? { version: 1, blocks: [] })
      }
      this.render()
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

  // ---- #474 视图状态流转 ----

  /** 查询树变化（构造器回调）：持久 + 会话 uiState 上报 + **仅列表区**重渲染
   *  ——构造器 DOM 与组卡结构不动（字段输入/控件焦点不因查询编辑丢失，
   *  评审 C1：整卡 replaceChildren 会把聚焦 input 移出文档并清焦） */
  private onQueryChange(query: BehaviorQueryFilter): void {
    this.persistView(query)
    this.stateSink?.()
    this.renderListOnly()
  }

  /** 页码变化（翻页/定位跳页/调序跟随）：持久 + 会话上报 */
  private onPageChange(): void {
    this.persistView(this.queryBuilder.getQuery())
    this.stateSink?.()
  }

  /** 跨重启持久（整表写；空查询存 null；写失败宿主静默——视图偏好非灾难） */
  private persistView(query: BehaviorQueryFilter): void {
    this.send({
      kind: 'addons.behaviorsViewSet',
      view: {
        page: this.page,
        query: query.blocks.length > 0 ? query : null,
      },
    })
  }

  /** 可撤销的「查询已清空」toast（垃圾桶清空与 D15 定位清空共用）：撤销
   *  恢复清空前的查询与页码（UI 状态，不涉行为生效语义）。恢复后同步会话
   *  uiState 记忆（评审 B-1：漏报会让面板重载时恢复过时的旧查询） */
  private showUndoableClearToast(previousQuery: BehaviorQueryFilter, previousPage: number): void {
    if (previousQuery.blocks.length === 0) {
      return
    }
    this.toast?.show(t('addons.behaviorsQueryCleared'), 'neutral', 'addons-behaviors-query', {
      label: t('addons.behaviorsQueryUndo'),
      onClick: () => {
        this.page = previousPage
        this.queryBuilder.setQuery(previousQuery)
        this.persistView(previousQuery)
        this.stateSink?.()
        this.render()
      },
    })
  }

  // ---- 渲染 ----

  private render(focusEntry?: string): void {
    const parent = this.parent
    if (!parent) {
      return
    }
    // #474 定位挂起（D13）：行内形状（page:/row:）须等 behaviors 载荷与
    // 视图状态都到达才求值（避免「持久查询后到覆盖已执行定位」竞态）；
    // 整卡定位（behaviors）不依赖查询，即时呈现（既有语义不变）
    let effectiveFocus: string | undefined
    if (focusEntry === ADDONS_BEHAVIORS_SECTION_ENTRY) {
      effectiveFocus = focusEntry
      this.pendingFocus = undefined
    } else if (focusEntry !== undefined) {
      this.pendingFocus = focusEntry
    }
    if (effectiveFocus === undefined && this.pendingFocus !== undefined &&
      this.behaviorsState !== undefined && this.viewStateResolved) {
      effectiveFocus = this.pendingFocus
      this.pendingFocus = undefined
    }
    // #467 同分页推送重渲染保持滚动与焦点（守卫说明见 sectionRebuildGuard）；
    // 显式定位渲染（定位在场）不恢复——定位的 scrollIntoView 与视图
    // 侧导航焦点语义优先
    const anchor = effectiveFocus === undefined ? captureSectionRebuildAnchor(parent) : undefined
    parent.replaceChildren()
    parent.append(this.renderBehaviorsArea(effectiveFocus))
    if (anchor) {
      restoreSectionRebuildAnchor(parent, anchor)
    }
  }

  /**
   * 行为管理卡（唯一主区块）：卡片头标注清单范围（已注册行为）并带输入
   * 语义图标，管理说明升为分页副题（不悬卡片内重复）；目录未到达时呈现
   * 读取中，空目录呈现空态。#474 起组卡内含积木查询区（列表上方）与
   * 分页控件（列表下方，总页数 ≤ 1 不渲染）。
   */
  private renderBehaviorsArea(focusEntry?: string): HTMLElement {
    const area = document.createElement('section')
    area.className = 'vsidian-addons-behaviors'
    // 组卡片与组头同构于编辑器页二级组：h3 挂进 .vsidian-settings-group 承载
    // 全幅头部形态（负边距 + 下边线），输入语义图标置左
    const group = document.createElement('div')
    group.className = 'vsidian-settings-group'
    const title = document.createElement('h3')
    title.className = 'vsidian-settings-group-title'
    title.append(groupIcon('inputCursor'))
    title.append(document.createTextNode(t('addons.behaviorsListTitle')))
    group.append(title)

    const payload = this.behaviorsState
    const locatedCard = focusEntry === ADDONS_BEHAVIORS_SECTION_ENTRY
    if (locatedCard) {
      area.classList.add('vsidian-settings-item-located')
    }
    if (payload === undefined) {
      const pending = document.createElement('p')
      pending.className = 'vsidian-settings-empty'
      pending.setAttribute('role', 'status')
      pending.textContent = t('addons.behaviorsLoading')
      group.append(pending)
    } else if (payload.behaviors.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'vsidian-settings-empty'
      empty.textContent = t('addons.behaviorsEmpty')
      group.append(empty)
    } else {
      // #474 积木查询区（构造器 DOM 跨渲染复用——appendChild 移动不重建，
      // 编辑现场与焦点保持）；列表装进稳定容器（查询编辑只换列表内容，
      // 构造器与组卡结构不动——评审 C1 焦点保持路径）
      group.append(this.queryBuilder.ensureRendered())
      const listContainer = document.createElement('div')
      this.listContainer = listContainer
      group.append(listContainer)
      this.renderListInto(listContainer, payload, focusEntry)
    }
    area.append(group)
    if (payload !== undefined && payload.behaviors.length > 0 && payload.notice !== undefined) {
      const notice = document.createElement('p')
      notice.className = `vsidian-addons-behaviors-notice vsidian-addons-behaviors-notice-${payload.notice.kind}`
      notice.setAttribute('role', 'status')
      notice.textContent = t(payload.notice.kind === 'saved' ? 'addons.behaviorsSavedNotice' : 'addons.behaviorsSaveFailedNotice')
      area.append(notice)
    }
    if (locatedCard) {
      area.scrollIntoView?.({ block: 'nearest' })
    }
    return area
  }

  /** 当前行集渲染信息（#474：显示名渲染与查询匹配同源；组件显示名回退
   *  组件 ID 与行 owner 文案同口径；求值状态为单值归类（优先序），徽章
   *  呈现保留原始标志独立叠加——既有 T08 语义不回归） */
  private rowInfoOf(behavior: AddonBehaviorInfo, disabledSet: Set<string>): BehaviorRowRenderInfo {
    const addonEntry = this.state?.addons.find((entry) => entry.id === behavior.addonId)
    const userDisabled = disabledSet.has(`${behavior.addonId}#${behavior.id}`)
    return {
      userDisabled,
      addonDisabled: addonEntry !== undefined && addonEntry.enabled === false,
      faulted: addonEntry?.fault !== undefined,
      ctx: {
        behaviorName: resolveAddonBehaviorName(behavior.name, currentLocaleLang()),
        addonName: addonEntry?.label ?? behavior.addonId,
        behaviorId: behavior.id,
        addonId: behavior.addonId,
        status: resolveBehaviorRowStatus(userDisabled, addonEntry?.enabled, addonEntry?.fault),
      },
    }
  }

  /** 列表渲染入容器：page 若在渲染中被规范化/定位/跟随改写（与进入时不同），
   *  补一次持久 + 会话上报——持久值与用户实际所见一致（评审 F4/B-2：
   *  越界回落与定位跳页此前不落盘，重启后回到旧页码） */
  private renderListInto(container: HTMLElement, payload: AddonBehaviorsMessage, focusEntry?: string): void {
    const pageBefore = this.page
    container.replaceChildren(this.renderBehaviorList(payload, focusEntry))
    if (this.page !== pageBefore) {
      this.persistView(this.queryBuilder.getQuery())
      this.stateSink?.()
    }
  }

  /** 查询编辑路径的轻量重渲染：只换列表内容（构造器/组卡/notice 不动——
   *  notice 属写操作结局，查询编辑不产生）；载荷不在场（目录为空）时退回
   *  整卡渲染兜底 */
  private renderListOnly(): void {
    const container = this.listContainer
    const payload = this.behaviorsState
    if (container === undefined || payload === undefined || payload.behaviors.length === 0) {
      this.render()
      return
    }
    this.renderListInto(container, payload, undefined)
  }

  /** 展示全序（关闭项保位）+ 查询过滤（只过滤不排序，D7）+ 分页切片 + 定位
   *  消费（D12–D15）+ 调序跟随（D10）+ 翻页控件 */
  private renderBehaviorList(payload: AddonBehaviorsMessage, focusEntry?: string): HTMLElement {
    const list = document.createElement('div')
    list.className = 'vsidian-addons-behaviors-list'
    const disabledSet = new Set(payload.state === null ? [] : payload.state.disabled)
    const store: AddonBehaviorStateStore | null = payload.state
    const fullOrder = orderedAddonBehaviorKeys(payload.behaviors.map((entry) => `${entry.addonId}#${entry.id}`), store)
    const byKey = new Map(payload.behaviors.map((entry) => [`${entry.addonId}#${entry.id}`, entry]))
    const rowInfo = new Map<string, BehaviorRowRenderInfo>()
    for (const key of fullOrder) {
      const behavior = byKey.get(key)
      if (behavior !== undefined) {
        rowInfo.set(key, this.rowInfoOf(behavior, disabledSet))
      }
    }

    // 定位形状解析与行存在性（D12/D13；页码合法性在过滤后求值——总页数随
    // 查询命中集变化，挂起条件由 render 保证）
    const focus = this.parseFocusEntry(focusEntry, fullOrder)

    const filterBy = (query: BehaviorQueryFilter): string[] => fullOrder.filter((key) => {
      const info = rowInfo.get(key)
      return info !== undefined && evaluateBehaviorQuery(query, info.ctx)
    })
    let visibleKeys = filterBy(this.queryBuilder.getQuery())

    // D15：定位行被当前查询过滤——清空查询并定位（定位意图高于筛选保持），
    // toast 说明 + 气泡撤销（恢复清空前的查询与页码）；命中集随清空重算；
    // 清空与撤销都同步会话 uiState 记忆（评审 B-1：防面板重载时查询复活）
    if (focus.kind === 'row' && focus.rowKey !== undefined && !visibleKeys.includes(focus.rowKey)) {
      const previousQuery = this.queryBuilder.getQuery()
      const previousPage = this.page
      this.queryBuilder.setQuery({ version: 1, blocks: [] })
      this.persistView({ version: 1, blocks: [] })
      this.stateSink?.()
      visibleKeys = filterBy({ version: 1, blocks: [] })
      this.toast?.show(t('addons.behaviorsQueryClearedForFocus'), 'neutral', 'addons-behaviors-focus', {
        label: t('addons.behaviorsQueryUndo'),
        onClick: () => {
          this.page = previousPage
          this.queryBuilder.setQuery(previousQuery)
          this.persistView(previousQuery)
          this.stateSink?.()
          this.render()
        },
      })
    }

    // 定位应用：非法（页码越界或行键不在注册集）回落默认渲染 + toast（D13）
    const pageCount = Math.ceil(visibleKeys.length / BEHAVIOR_LIST_PAGE_SIZE)
    if (focus.kind === 'page' && focus.page !== undefined && focus.page >= 1 && focus.page <= pageCount) {
      this.page = focus.page
    } else if (focus.kind === 'row' && focus.rowKey !== undefined) {
      this.focusRowKey = focus.rowKey
      const index = visibleKeys.indexOf(focus.rowKey)
      if (index >= 0) {
        this.page = Math.floor(index / BEHAVIOR_LIST_PAGE_SIZE) + 1
      }
    } else if (focus.kind === 'invalid' || focus.kind === 'page') {
      this.toast?.show(t('addons.behaviorsFocusInvalid'), 'neutral', 'addons-behaviors-focus')
    }

    // 调序视图跟随（D10）：移动行离开当前页时视图跳至所在页并保持可见
    if (this.followKey !== undefined) {
      const followIndex = visibleKeys.indexOf(this.followKey)
      if (followIndex >= 0) {
        this.page = Math.floor(followIndex / BEHAVIOR_LIST_PAGE_SIZE) + 1
      }
      this.followKey = undefined
    }

    const pagination = paginateBehaviorList(visibleKeys, this.page)
    this.page = pagination.page
    pagination.pageItems.forEach((key) => {
      const behavior = byKey.get(key)
      if (behavior !== undefined) {
        list.append(this.renderBehaviorRow(behavior, fullOrder, fullOrder.indexOf(key), rowInfo.get(key)!))
      }
    })

    // 定位行高亮与滚动（行优先：已跳至行所在页，nearest 滚动呈现）
    if (this.focusRowKey !== undefined) {
      const row = list.querySelector<HTMLElement>(`[data-behavior-key="${cssEscape(this.focusRowKey)}"]`)
      if (row !== null) {
        row.classList.add('vsidian-settings-item-located')
        row.scrollIntoView?.({ block: 'nearest' })
      }
      this.focusRowKey = undefined
    }

    // 翻页控件（D2/D3：总页数 ≤ 1 不渲染）
    if (pagination.pageCount > 1) {
      appendPager(list, pagination.page, pagination.pageCount, (page) => {
        this.page = page
        this.onPageChange()
        this.render()
      })
    }
    return list
  }

  /** focusEntry 形状解析（D12）：`behaviors` 整卡 / `page:<n>` 页 / `row:<键>`
   *  行；行键不在注册全集（fullOrder）判非法（D13）。页码数值合法性由调用
   *  方在过滤后按总页数求值（页数随查询命中集变化）。 */
  private parseFocusEntry(focusEntry: string | undefined, fullOrder: readonly string[]): FocusResolution {
    if (focusEntry === undefined || focusEntry === ADDONS_BEHAVIORS_SECTION_ENTRY) {
      return { kind: 'card' }
    }
    const pageMatch = FOCUS_PAGE_PATTERN.exec(focusEntry)
    if (pageMatch !== null) {
      return { kind: 'page', page: Number.parseInt(pageMatch[1]!, 10) }
    }
    if (focusEntry.startsWith(FOCUS_ROW_PREFIX)) {
      const key = focusEntry.slice(FOCUS_ROW_PREFIX.length)
      return fullOrder.includes(key) ? { kind: 'row', rowKey: key } : { kind: 'invalid' }
    }
    return { kind: 'card' }
  }

  /**
   * 单条行为行：调序按钮（上移/下移——真实 button，Tab 可达 Enter/Space
   * 原生激活；首末禁用）、名称、所属组件、状态徽章（单项关闭与整体停用/
   * 故障互相区分）、单项开关（原生 checkbox）与说明/例子展开块。
   * #474：调序仍为全序相邻交换（D10「语义不变」——被过滤行也占全序位），
   * 交换后视图跟随被移动行（followKey，下一次回显渲染消费）。
   */
  private renderBehaviorRow(
    behavior: AddonBehaviorInfo,
    fullOrder: readonly string[],
    fullIndex: number,
    info: BehaviorRowRenderInfo,
  ): HTMLElement {
    const key = `${behavior.addonId}#${behavior.id}`
    const displayName = info.ctx.behaviorName
    const item = document.createElement('div')
    item.className = 'vsidian-addons-behaviors-row'
    item.dataset.behaviorKey = key
    const label = document.createElement('label')
    label.className = 'vsidian-settings-item-label'
    const copy = document.createElement('span')
    copy.className = 'vsidian-settings-item-copy'
    const title = document.createElement('span')
    title.className = 'vsidian-settings-item-title'
    title.textContent = displayName
    const owner = document.createElement('span')
    owner.className = 'vsidian-addons-behaviors-owner'
    owner.textContent = t('addons.behaviorsOwnerLabel', { label: info.ctx.addonName })
    copy.append(title, owner)
    // 状态徽章（互相区分、独立叠加——单项关闭与组件停用/故障可并存呈现）：
    // 单项关闭 = 用户逐项开关关闭（配置保留，可重开）；组件已停用/故障
    // 暂停 = 整组件层面（行为行与单项配置仍在——配置不丢）
    if (info.userDisabled) {
      copy.append(this.behaviorBadge('addons.behaviorsItemDisabledBadge', 'off'))
    }
    if (info.addonDisabled) {
      copy.append(this.behaviorBadge('addons.behaviorsAddonDisabledBadge', 'addon-off'))
    }
    if (info.faulted) {
      copy.append(this.behaviorBadge('addons.behaviorsFaultedBadge', 'faulted'))
    }

    // 调序按钮组（键盘可达；全序首行上移/末行下移禁用——边界不可越。
    // #474 交换发生在展示全序 fullOrder 上（D10：过滤只影响呈现不影响序）
    const orderControls = document.createElement('span')
    orderControls.className = 'vsidian-addons-behaviors-order'
    const move = (direction: 'up' | 'down', delta: number): HTMLButtonElement => {
      const button = this.button(t(direction === 'up' ? 'addons.behaviorsMoveUpText' : 'addons.behaviorsMoveDownText'), () => {
        const next = [...fullOrder]
        const target = fullIndex + delta
        ;[next[fullIndex], next[target]] = [next[target]!, next[fullIndex]!]
        this.followKey = key
        this.send({ kind: 'addons.behaviorsSetOrder', order: next })
      }, 'vsidian-addons-behaviors-move', { [REBUILD_FOCUS_ATTR]: `behavior-move:${key}:${direction}` })
      button.dataset.behaviorMove = direction
      button.setAttribute('aria-label', t(direction === 'up' ? 'addons.behaviorsMoveUpAria' : 'addons.behaviorsMoveDownAria', { name: displayName }))
      button.disabled = direction === 'up' ? fullIndex === 0 : fullIndex === fullOrder.length - 1
      return button
    }
    orderControls.append(move('up', -1), move('down', 1))

    // 单项开关（勾选 = 开启，只反映用户逐项开关；上送后由宿主权威推送回显）
    const toggle = document.createElement('input')
    toggle.type = 'checkbox'
    toggle.className = 'vsidian-settings-checkbox'
    toggle.checked = !info.userDisabled
    toggle.dataset.behaviorKey = key
    toggle.setAttribute(REBUILD_FOCUS_ATTR, `behavior:${key}`)
    toggle.setAttribute('aria-label', t('addons.behaviorsToggleAria', { name: displayName }))
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
}

/** 属性选择器转义（完整键含 #：`[data-behavior-key="a#b"]` 属性值在引号内
 *  合法，仅需转义引号与反斜杠） */
function cssEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** 翻页控件（D2）：`<< < 第 x / y 页 > >>`——四枚行内微钮（22px 档；到头/
 *  到底禁用发灰）+ 指示文本（12px 说明色）；aria-label 全套可读 */
function appendPager(
  list: HTMLElement,
  page: number,
  pageCount: number,
  go: (page: number) => void,
): void {
  const pager = document.createElement('nav')
  pager.className = 'vsidian-addons-behaviors-pager'
  pager.setAttribute('aria-label', t('addons.behaviorsPagerAria'))
  const pagerButton = (glyph: string, ariaKey: string, target: number, disabled: boolean): HTMLButtonElement => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'vsidian-addons-behaviors-pager-button'
    button.textContent = glyph
    button.setAttribute('aria-label', t(ariaKey))
    button.disabled = disabled
    button.addEventListener('click', () => go(target))
    return button
  }
  pager.append(
    pagerButton('<<', 'addons.behaviorsPageFirst', 1, page <= 1),
    pagerButton('<', 'addons.behaviorsPagePrev', page - 1, page <= 1),
    (() => {
      const indicator = document.createElement('span')
      indicator.className = 'vsidian-addons-behaviors-pager-indicator'
      indicator.textContent = t('addons.behaviorsPageIndicator', { page: String(page), total: String(pageCount) })
      return indicator
    })(),
    pagerButton('>', 'addons.behaviorsPageNext', page + 1, page >= pageCount),
    pagerButton('>>', 'addons.behaviorsPageLast', pageCount, page >= pageCount),
  )
  list.append(pager)
}
