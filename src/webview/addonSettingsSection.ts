// 「附加组件」设置分页（#350 T01）：组件状态列表（官方/第三方分组）+
// 市场搜索入口 + VSCode 扩展管理入口。接入现有 Vsidian 自有设置页
// （SettingsPageSection），不新建页面体系。
//
// 边界（票面）：安装、卸载与整个扩展的禁用继续由 VSCode 管理——本分页
// 只呈现状态并提供 VSCode 入口；市场关键词（vsidian-addon）仅帮助寻找，
// 不代表接入协议或官方身份。API 版本行保持草案标注（draft 恒真），不把
// 声明能力冒充已发布稳定 API。
//
// 状态权威在宿主（addons.state 推送回显；装载经 addons.get 拉取）；页面
// 不自行推断。文案一律 t() 取词（addons.* 词条）。
import { t } from '../shared/i18n'
import { isHostToWebview } from '../shared/protocol'
import type { AddonStatusEntry } from '../shared/addonIdentity'
import type { SettingsPageBridge, SettingsPageSection } from './settingsPageView'

type AddonsStateMessage = Extract<import('../shared/protocol').HostToWebview, { kind: 'addons.state' }>

/** 全局搜索定位入口 id（list = 状态列表；manage = 搜索与管理入口组） */
export const ADDONS_SECTION_LIST_ENTRY = 'list'
export const ADDONS_SECTION_MANAGE_ENTRY = 'manage'

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

export class AddonSection implements SettingsPageSection {
  readonly id = 'addons'
  /** 四块拼贴字形（附加组件 = 独立扩展模块的组合意象） */
  readonly icon = 'blocks' as const
  get title(): string { return t('settings.addonsSection') }
  get description(): string { return t('settings.addonsSectionDescription') }

  private state: AddonsStateMessage | undefined
  private parent: HTMLElement | undefined

  constructor(private readonly bridge: SettingsPageBridge) {}

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
    this.render(focusEntry)
    return () => {
      this.parent = undefined
    }
  }

  handleHostMessage(message: unknown): void {
    if (!isHostToWebview(message) || message.kind !== 'addons.state') {
      return
    }
    this.state = message
    this.render()
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

    // ---- 状态列表（官方分组在前；列表未到达时显示读取中） ----
    const listWrap = document.createElement('div')
    listWrap.className = 'vsidian-addons-list'
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
          groupContainer.append(this.renderEntry(entry, state.apiVersion))
        }
        listWrap.append(groupContainer)
      }
    }
    parent.append(listWrap)
    if (focusEntry === ADDONS_SECTION_LIST_ENTRY) {
      listWrap.scrollIntoView?.({ block: 'nearest' })
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

  /** 单条组件行：显示名（+官方徽章）、状态句与 VSCode 扩展详情入口 */
  private renderEntry(entry: AddonStatusEntry, apiVersion: string): HTMLElement {
    const item = document.createElement('div')
    item.className = 'vsidian-settings-item'
    const label = document.createElement('div')
    label.className = 'vsidian-settings-item-label'
    const copy = document.createElement('span')
    copy.className = 'vsidian-settings-item-copy'
    const title = document.createElement('span')
    title.className = 'vsidian-settings-item-title'
    title.textContent = entry.official
      ? `${entry.label} · ${t('addons.officialBadge')}`
      : entry.label
    const desc = document.createElement('span')
    desc.className = 'vsidian-settings-item-description'
    desc.textContent = `${entry.id} — ${addonStatusText(entry, apiVersion)}`
    copy.append(title, desc)
    const detail = this.button(t('addons.openDetail'), () => {
      this.send({ kind: 'addons.openExtension', extensionId: entry.id })
    })
    detail.setAttribute('aria-label', t('addons.openDetail'))
    label.append(copy, detail)
    item.append(label)
    return item
  }
}
