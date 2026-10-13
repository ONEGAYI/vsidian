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
// 状态权威在宿主（addons.behaviors / addons.state 推送回显；装载经
// addons.behaviorsGet / addons.get 拉取，由 settingsMain 装载点统一发送）；
// 页面不自行推断。文案一律 t() 取词。
import { t, currentLocaleLang } from '../shared/i18n'
import { isHostToWebview } from '../shared/protocol'
import {
  orderedAddonBehaviorKeys,
  resolveAddonBehaviorName,
  type AddonBehaviorInfo,
  type AddonBehaviorStateStore,
} from '../shared/addonBehaviors'
import { groupIcon, type SettingsPageBridge, type SettingsPageSection } from './settingsPageView'
import { captureSectionRebuildAnchor, restoreSectionRebuildAnchor, REBUILD_FOCUS_ATTR } from './sectionRebuildGuard'

type AddonsStateMessage = Extract<import('../shared/protocol').HostToWebview, { kind: 'addons.state' }>
type AddonBehaviorsMessage = Extract<import('../shared/protocol').HostToWebview, { kind: 'addons.behaviors' }>

/** 全局搜索定位入口 id（behaviors = 行为卡片） */
export const ADDONS_BEHAVIORS_SECTION_ID = 'addons-behaviors'
export const ADDONS_BEHAVIORS_SECTION_ENTRY = 'behaviors'

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

  constructor(private readonly bridge: SettingsPageBridge) {}

  get entries() {
    return [
      {
        id: ADDONS_BEHAVIORS_SECTION_ENTRY,
        title: t('settings.addonsBehaviorsSection'),
        description: t('settings.addonsBehaviorsSectionDescription'),
      },
    ]
  }

  mount(parent: HTMLElement, focusEntry?: string): (() => void) | undefined {
    this.parent = parent
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
    // 行为目录（注册表上报对账）与用户覆盖变化都经 addons.behaviors 推送；
    // notice 为最近一次写操作结局（常规推送缺省不残留）
    if (message.kind === 'addons.behaviors') {
      this.behaviorsState = message
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

  private render(focusEntry?: string): void {
    const parent = this.parent
    if (!parent) {
      return
    }
    // #467 同分页推送重渲染保持滚动与焦点（守卫说明见 sectionRebuildGuard）；
    // 显式定位渲染（focusEntry 在场）不恢复——定位的 scrollIntoView 与视图
    // 侧导航焦点语义优先
    const anchor = focusEntry === undefined ? captureSectionRebuildAnchor(parent) : undefined
    parent.replaceChildren()
    parent.append(this.renderBehaviorsArea(focusEntry))
    if (anchor) {
      restoreSectionRebuildAnchor(parent, anchor)
    }
  }

  /**
   * 行为管理卡（唯一主区块）：卡片头标注清单范围（已注册行为）并带输入
   * 语义图标，管理说明升为分页副题（不悬卡片内重复）；目录未到达时呈现
   * 读取中，空目录呈现空态。
   */
  private renderBehaviorsArea(focusEntry?: string): HTMLElement {
    const area = document.createElement('section')
    area.className = 'vsidian-addons-behaviors'
    if (focusEntry === ADDONS_BEHAVIORS_SECTION_ENTRY) {
      area.classList.add('vsidian-settings-item-located')
    }
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
    }
    area.append(group)
    if (payload !== undefined && payload.behaviors.length > 0 && payload.notice !== undefined) {
      const notice = document.createElement('p')
      notice.className = `vsidian-addons-behaviors-notice vsidian-addons-behaviors-notice-${payload.notice.kind}`
      notice.setAttribute('role', 'status')
      notice.textContent = t(payload.notice.kind === 'saved' ? 'addons.behaviorsSavedNotice' : 'addons.behaviorsSaveFailedNotice')
      area.append(notice)
    }
    if (focusEntry === ADDONS_BEHAVIORS_SECTION_ENTRY) {
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
    // #464 多语言名称渲染时按当前页面语言选值（对齐 styleReferenceSettings
    // 先例：语言切换经 applyLocale → render → 本方法重入，天然跟随；纯
    // 字串形态原样返回，行为不变）
    const displayName = resolveAddonBehaviorName(behavior.name, currentLocaleLang())
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
      }, 'vsidian-addons-behaviors-move', { [REBUILD_FOCUS_ATTR]: `behavior-move:${key}:${direction}` })
      button.dataset.behaviorMove = direction
      button.setAttribute('aria-label', t(direction === 'up' ? 'addons.behaviorsMoveUpAria' : 'addons.behaviorsMoveDownAria', { name: displayName }))
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
