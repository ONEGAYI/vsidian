// CSS 片段设置分页（#128）：目录选择/打开、逐片段开关、手动刷新与读取
// 失败状态条。经 SettingsPageSection 注入设置页（与快捷键分页同模式），
// 状态权威在宿主（snippets.state 推送回显，页面不自行推断）。
// #131 增暂停/恢复：「暂停全部」按钮与暂停状态条内的恢复入口
// （snippets.setPaused 上送），暂停不清逐项开关。
// 本页不加载任何用户 CSS——设置页不注入片段（spec「已确认行为」）。
// 文案一律 t() 取词（cssSnippets.* 词条）。
import { t } from '../shared/i18n'
import { isHostToWebview } from '../shared/protocol'
import type { CssSnippetState } from '../shared/cssSnippets'
import type { SettingsPageBridge, SettingsPageSection } from './settingsPageView'

/** 全局搜索定位用的静态入口 id（目录行；片段文件条目动态并入 entries） */
export const SNIPPET_SECTION_DIRECTORY_ENTRY = 'directory'

export class CssSnippetSettingsSection implements SettingsPageSection {
  readonly id = 'css-snippets'
  readonly icon = 'palette' as const
  get title(): string { return t('cssSnippets.title') }
  get description(): string { return t('cssSnippets.description') }

  private state: CssSnippetState | undefined
  private parent: HTMLElement | undefined

  constructor(private readonly bridge: SettingsPageBridge) {}

  get entries() {
    // 目录行静态 + 片段文件动态并入（全局搜索可定位到具体片段开关）
    const directory = {
      id: SNIPPET_SECTION_DIRECTORY_ENTRY,
      title: t('cssSnippets.directoryLabel'),
      description: this.state?.directory ?? t('cssSnippets.noDirectory'),
    }
    const files = (this.state?.entries ?? []).map((entry) => ({
      id: `snippet:${entry.name}`,
      title: entry.name,
    }))
    return [directory, ...files]
  }

  mount(parent: HTMLElement, focusEntry?: string): () => void {
    this.parent = parent
    this.render(focusEntry)
    return () => {
      this.parent = undefined
    }
  }

  handleHostMessage(message: unknown): void {
    if (!isHostToWebview(message) || message.kind !== 'snippets.state') {
      return
    }
    this.state = {
      directory: message.directory,
      readError: message.readError,
      paused: message.paused,
      version: message.version,
      entries: message.entries.map((entry) => ({ name: entry.name, enabled: entry.enabled })),
      rejections: message.rejections ?? {},
    }
    this.render()
  }

  private send(message: object): void {
    this.bridge.postMessage(message)
  }

  private button(label: string, action: () => void, cls = ''): HTMLButtonElement {
    const button = document.createElement('button')
    button.className = cls
    button.type = 'button'
    button.textContent = label
    button.addEventListener('click', action)
    return button
  }

  private render(focusEntry?: string): void {
    const parent = this.parent
    if (!parent) {
      return
    }
    parent.replaceChildren()
    const state = this.state

    // 目录行：路径 + 三个动作（选择 / 打开 / 刷新）
    const dirRow = document.createElement('div')
    dirRow.className = 'vsidian-css-snippets-directory'
    const dirLabel = document.createElement('label')
    dirLabel.className = 'vsidian-css-snippets-directory-label'
    const caption = document.createElement('span')
    caption.className = 'vsidian-css-snippets-directory-caption'
    caption.textContent = t('cssSnippets.directoryLabel')
    const path = document.createElement('span')
    path.className = 'vsidian-css-snippets-directory-path'
    path.textContent = state?.directory ?? t('cssSnippets.noDirectory')
    dirLabel.append(caption, path)
    if (focusEntry === SNIPPET_SECTION_DIRECTORY_ENTRY) {
      dirRow.classList.add('vsidian-settings-item-located')
      dirRow.scrollIntoView?.({ block: 'nearest' })
    }
    const actions = document.createElement('div')
    actions.className = 'vsidian-css-snippets-actions'
    // #131 暂停全部：全局冻结（保留逐项开关）；已暂停时禁用（恢复入口在
    // 暂停状态条内，语义显式分开）
    const pauseButton = this.button(t('cssSnippets.pauseAll'), () =>
      this.send({ kind: 'snippets.setPaused', paused: true }))
    pauseButton.disabled = state?.paused === true
    actions.append(
      this.button(t('cssSnippets.chooseDirectory'), () =>
        this.send({ kind: 'snippets.chooseDirectory' })),
      this.button(t('cssSnippets.openDirectory'), () =>
        this.send({ kind: 'snippets.openDirectory' }), 'vsidian-css-snippets-open'),
      this.button(t('cssSnippets.refresh'), () =>
        this.send({ kind: 'snippets.refresh' })),
      pauseButton,
    )
    dirRow.append(dirLabel, actions)
    parent.append(dirRow)

    // #131 暂停状态条：常驻提示 + 恢复入口（宿主状态驱动回显；恢复按原
    // 配置立即生效——逐项开关全程保留）
    if (state?.paused) {
      const pausedRow = document.createElement('p')
      pausedRow.className = 'vsidian-css-snippets-paused'
      pausedRow.setAttribute('role', 'status')
      const text = document.createElement('span')
      text.textContent = t('cssSnippets.pausedStatus')
      pausedRow.append(text, this.button(t('cssSnippets.resume'), () =>
        this.send({ kind: 'snippets.setPaused', paused: false })))
      parent.append(pausedRow)
    }

    // 状态条：读取失败常驻警告（后台失败不打扰、界面必达）；无目录/空目录提示
    const status = document.createElement('p')
    status.className = 'vsidian-css-snippets-status'
    status.setAttribute('role', 'status')
    if (state?.readError) {
      status.classList.add('vsidian-css-snippets-status-error')
      status.textContent = t('cssSnippets.readError')
    } else if (state && state.entries.length === 0) {
      status.textContent = state.directory
        ? t('cssSnippets.emptyDirectory')
        : t('cssSnippets.noDirectory')
    }
    parent.append(status)

    // 片段列表：逐项开关（宿主权威回显；翻转即上送）
    const list = document.createElement('div')
    list.className = 'vsidian-css-snippets-list'
    for (const entry of state?.entries ?? []) {
      const item = document.createElement('label')
      item.className = 'vsidian-css-snippets-item'
      const box = document.createElement('input')
      box.type = 'checkbox'
      box.className = 'vsidian-settings-checkbox'
      box.checked = entry.enabled
      box.dataset.snippetName = entry.name
      box.setAttribute('aria-label', entry.name)
      box.addEventListener('change', () => {
        this.send({ kind: 'snippets.setEnabled', name: entry.name, enabled: box.checked })
      })
      const name = document.createElement('span')
      name.className = 'vsidian-css-snippets-item-name'
      name.textContent = entry.name
      item.append(name)
      // #129 被拒条目（越界/符号链接逃逸）：行内提示 + title 携带逃逸路径
      const rejection = this.state?.rejections?.[entry.name]
      if (rejection) {
        const mark = document.createElement('span')
        mark.className = 'vsidian-css-snippets-item-rejected'
        mark.textContent = t('cssSnippets.entryRejected')
        mark.title = rejection.path
        item.append(mark)
      }
      item.append(box)
      list.append(item)
      if (focusEntry === `snippet:${entry.name}`) {
        item.classList.add('vsidian-settings-item-located')
        box.focus()
        item.scrollIntoView?.({ block: 'nearest' })
      }
    }
    parent.append(list)
  }
}
