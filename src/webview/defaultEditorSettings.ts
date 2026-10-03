// 设置页常规页「默认编辑器」二级委托组（#323）：当前默认编辑器状态行
// （四形态：Vsidian / 内置文本编辑器 / 其他扩展（可读名，反查失败回退关联
// 值原文）/ 无记录）、守护开关（设置键 general.defaultEditorGuard 呈现，
// 值权威在宿主 settings.snapshot/changed 回显）与手动「设为默认」按钮
// （走守护修复链路 fixNow 同一通道，结果经 defaultEditor.state 推送与宿主
// 通知呈现，不逐次应答）。经委托组装配进常规页（不占侧栏分页槽位），
// 组不自行推断状态——defaultEditor.state 未到达前显示读取中文案。
// 文案一律 t() 取词（defaultEditor.* / setting.* 词条）。
import { t } from '../shared/i18n'
import { isHostToWebview } from '../shared/protocol'
import {
  DEFAULT_EDITOR_GUARD_DEFAULT,
  DEFAULT_EDITOR_GUARD_KEY,
  type SettingsPayload,
} from '../shared/settings'
import type { SettingsPageBridge, SettingsPageDelegateGroup, SettingsGroupIcon } from './settingsPageView'

type DefaultEditorStateMessage = Extract<import('../shared/protocol').HostToWebview, { kind: 'defaultEditor.state' }>

/** 全局搜索定位入口 id（status = 状态行 + 手动按钮块；guard = 守护开关行） */
export const DEFAULT_EDITOR_SECTION_STATUS_ENTRY = 'status'
export const DEFAULT_EDITOR_SECTION_GUARD_ENTRY = 'guard'

export class DefaultEditorSection implements SettingsPageDelegateGroup {
  /** 组标题语言键（常规页内 h3 二级标题） */
  readonly titleKey = 'defaultEditor.title' as const
  /** 新组无退役分页（legacySectionId 缺省——不设兼容路由） */
  /** 组标题图标槽：shield 内联字形（守护意象；编辑器页各二级组同槽位惯例） */
  readonly icon: SettingsGroupIcon = 'shield'

  private values: SettingsPayload | undefined
  private state: DefaultEditorStateMessage | undefined
  private parent: HTMLElement | undefined
  /** 守护开关行元素（状态块重建时按序插到它之前——组的视觉顺序恒为
   *  状态块在前、开关行在后，不受状态推送重建影响） */
  private guardItemEl: HTMLElement | undefined

  constructor(private readonly bridge: SettingsPageBridge) {}

  get entries() {
    return [
      {
        id: DEFAULT_EDITOR_SECTION_STATUS_ENTRY,
        title: t('defaultEditor.statusLabel'),
        description: t('defaultEditor.statusDescription'),
      },
      {
        id: DEFAULT_EDITOR_SECTION_GUARD_ENTRY,
        title: t('setting.defaultEditorGuard.title'),
        description: t('setting.defaultEditorGuard.description'),
      },
    ]
  }

  mount(parent: HTMLElement, focusEntry?: string): (() => void) | undefined {
    this.parent = parent
    this.guardItemEl = undefined
    this.renderStatusBlock(focusEntry)
    this.renderGuardItem(focusEntry)
    return () => {
      this.parent = undefined
      this.guardItemEl = undefined
    }
  }

  handleHostMessage(message: unknown): void {
    if (!isHostToWebview(message)) return
    if (message.kind === 'defaultEditor.state') {
      this.state = message
      // 就地只重建状态块：开关行 DOM 不动（保存广播与状态推送并行到达时
      // 不丢开关焦点——标准设置行的回显同为就地同步语义）
      this.renderStatusBlock(undefined)
      return
    }
    if (message.kind === 'settings.snapshot' || message.kind === 'settings.changed') {
      this.values = message.values
      this.syncGuardCheckbox()
    }
  }

  /** 状态行文本（四形态经设置页语言包组句；label 为宿主反查可读名） */
  private statusText(): string {
    const state = this.state
    if (!state) {
      return t('defaultEditor.statusPending')
    }
    if (state.status === 'vsidian') {
      return t('defaultEditor.statusVsidian')
    }
    if (state.status === 'builtin') {
      return t('defaultEditor.statusBuiltin')
    }
    if (state.status === 'other') {
      return t('defaultEditor.statusOther', { name: state.label ?? state.viewType ?? '' })
    }
    return t('defaultEditor.statusNone')
  }

  /** 守护开关当前生效值（快照缺值回退注册表默认；与 settingsPageView
   * value() 的 boolean 口径一致） */
  private guardEnabled(): boolean {
    const raw = this.values?.[DEFAULT_EDITOR_GUARD_KEY]
    return typeof raw === 'boolean' ? raw : DEFAULT_EDITOR_GUARD_DEFAULT
  }

  /** 保存单个设置键（标准设置保存链路：宿主校验持久化后广播回显） */
  private setSetting(key: string, value: boolean): void {
    this.bridge.postMessage({ kind: 'settings.set', values: { [key]: value } })
  }

  /** 守护开关回显的就地同步：checked 态随权威快照更新，行结构不重建 */
  private syncGuardCheckbox(): void {
    const parent = this.parent
    if (!parent) return
    const box = parent.querySelector<HTMLInputElement>('input.vsidian-defedit-guard-checkbox')
    if (box) {
      box.checked = this.guardEnabled()
    }
  }

  /** 状态块（标签 + 状态文本 + 手动按钮）装配；state 推送时整块重建 */
  private renderStatusBlock(focusEntry: string | undefined): void {
    const parent = this.parent
    if (!parent) return
    parent.querySelectorAll(':scope > .vsidian-defedit-block').forEach((el) => el.remove())
    const block = document.createElement('div')
    block.className = 'vsidian-defedit-block'

    const label = document.createElement('label')
    label.className = 'vsidian-defedit-label'
    const caption = document.createElement('span')
    caption.className = 'vsidian-defedit-caption'
    caption.textContent = t('defaultEditor.statusLabel')
    const description = document.createElement('span')
    description.className = 'vsidian-defedit-description'
    description.textContent = t('defaultEditor.statusDescription')
    label.append(caption, description)
    block.append(label)

    const status = document.createElement('p')
    status.className = 'vsidian-defedit-status'
    status.setAttribute('role', 'status')
    status.textContent = this.statusText()
    block.append(status)

    const actions = document.createElement('div')
    actions.className = 'vsidian-defedit-actions'
    const fix = document.createElement('button')
    fix.type = 'button'
    fix.className = 'vsidian-index-primary'
    fix.textContent = t('defaultEditor.fixButton')
    // 已是我时禁用（规格设置页形态）；结果可见性：成功经 defaultEditor.state
    // 推送（状态行更新为 Vsidian），失败经宿主通知引导（组内不重复呈现）
    fix.disabled = this.state?.status === 'vsidian'
    fix.addEventListener('click', () => {
      this.bridge.postMessage({ kind: 'defaultEditor.fix' })
    })
    actions.append(fix)
    block.append(actions)

    parent.append(block)
    if (this.guardItemEl) {
      // 状态推送重建时按序插回开关行之前（append 会落到组尾破坏视觉顺序）
      parent.insertBefore(block, this.guardItemEl)
    }
    if (focusEntry === DEFAULT_EDITOR_SECTION_STATUS_ENTRY) {
      block.classList.add('vsidian-settings-item-located')
      block.scrollIntoView?.({ block: 'nearest' })
    }
  }

  /** 守护开关行装配（复用标准设置行结构，样式零新增；值仍走 settings.set
   * 标准链路——键已进注册表，标准行渲染被 generalDefs 排除防重复呈现） */
  private renderGuardItem(focusEntry: string | undefined): void {
    const parent = this.parent
    if (!parent) return
    const item = document.createElement('div')
    item.className = 'vsidian-settings-item'
    const label = document.createElement('label')
    label.className = 'vsidian-settings-item-label'
    const text = document.createElement('span')
    text.className = 'vsidian-settings-item-copy'
    const title = document.createElement('span')
    title.className = 'vsidian-settings-item-title'
    title.textContent = t('setting.defaultEditorGuard.title')
    text.append(title)
    const desc = document.createElement('span')
    desc.className = 'vsidian-settings-item-description'
    desc.textContent = t('setting.defaultEditorGuard.description')
    desc.id = `description-${DEFAULT_EDITOR_GUARD_KEY}`
    text.append(desc)
    const box = document.createElement('input')
    box.type = 'checkbox'
    // 组内控件类名沿用标准开关样式；独立类名仅用于组内就地回显定位
    //（不带 data-setting-key：标准行的快照同步循环不越权接管组内控件）
    box.className = 'vsidian-settings-checkbox vsidian-defedit-guard-checkbox'
    box.checked = this.guardEnabled()
    box.setAttribute('aria-label', t('setting.defaultEditorGuard.title'))
    box.setAttribute('aria-describedby', desc.id)
    box.addEventListener('change', () => {
      this.setSetting(DEFAULT_EDITOR_GUARD_KEY, box.checked)
    })
    label.append(text, box)
    item.append(label)
    parent.append(item)
    this.guardItemEl = item
    if (focusEntry === DEFAULT_EDITOR_SECTION_GUARD_ENTRY) {
      item.classList.add('vsidian-settings-item-located')
      box.focus()
      item.scrollIntoView?.({ block: 'nearest' })
    }
  }
}
