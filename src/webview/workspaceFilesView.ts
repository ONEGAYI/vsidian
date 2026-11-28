import {
  isWorkspaceFileAction, WORKSPACE_FILE_ACTIONS, type WorkspaceFileAction,
  type WorkspaceFileEntry, type WorkspaceFileTab, type WorkspaceFilesRequest, type WorkspaceFilesSnapshot,
} from '../shared/protocol'
import { buildMenuModel, PLAIN_MENU_LINE, type MenuItemDescriptor } from '../shared/contextMenu'
import type { MessageKey } from '../shared/locales/en'
import { t } from '../shared/i18n'
import { bindLocale, bindLocaleAttrs, bindLocaleFn, refreshElementLocale } from './localeDom'
import { closeHoverPopupIfAnchorWithin, hoverPreviewAnchorEnter, hoverPreviewAnchorLeave, repositionHoverPopupIfAnchorWithin } from './hoverPopup'
import { buildMenuDom } from './contextMenuDom'
import { WorkspaceFilesLayoutControls } from './workspaceFilesLayout'

const SVG_NS = 'http://www.w3.org/2000/svg'
const FILE_DRAG_TYPE = 'application/vnd.vsidian.workspace-file'
// 打开另一文档会换 webview。给原按钮留出常规 500ms 双击窗口及事件余量，
// 让 Chromium 的 dblclick 在换页前决定是否保留，避免第二击落到移位后的树行。
const FILE_CLICK_WAIT_MS = 550
// 16px 线框图标槽；目录用展开箭头单独表达开合态。
const FILE_ICONS = {
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h6',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  chevron: 'm10 6 6 6-6 6',
  filePlus: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M12 11v7 M8.5 14.5h7',
  folderPlus: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M12 10v7 M8.5 13.5h7',
  refresh: 'M20 9a8.5 8.5 0 1 0 .5 6 M20 4v5h-5',
  collapseAll: 'M7 18v1a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-1 M5 3h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M7 10.5h7',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  close: 'M6 6l12 12M18 6L6 18',
} as const

function icon(key: keyof typeof FILE_ICONS): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', FILE_ICONS[key])
  svg.appendChild(path)
  return svg
}

function actionButton(key: keyof typeof FILE_ICONS, label: MessageKey, action: () => void, name?: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'vsidian-file-action'
  bindLocaleAttrs(button, label, name === undefined ? undefined : { name })
  button.appendChild(icon(key))
  button.addEventListener('click', action)
  return button
}

interface FileRow {
  element: HTMLLIElement
  button: HTMLButtonElement
  name: HTMLSpanElement
  detail?: HTMLSpanElement
  manage?: HTMLButtonElement
  close?: HTMLButtonElement
  status?: HTMLDivElement
  tab: WorkspaceFileTab | WorkspaceFileEntry
  kind?: WorkspaceFileEntry['kind']
}

interface FileMenuHost {
  open(entry: WorkspaceFileEntry, anchor: HTMLButtonElement, x: number, y: number): void
  isOpen(): boolean
}

function isFileMenuKey(event: KeyboardEvent): boolean {
  return !event.altKey && !event.ctrlKey && !event.metaKey &&
    (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
}

/** 文件菜单只消费宿主发来的能力，不进入正文/附加组件的菜单注册表。 */
export function buildWorkspaceFileMenu(entry: WorkspaceFileEntry, onAction: (action: 'activate' | WorkspaceFileAction) => void): HTMLElement {
  const descriptors: MenuItemDescriptor[] = [{
    id: 'workspaceFiles.activate', command: 'activate', group: 'fileNavigation', order: 0,
    labelKey: entry.kind === 'file' ? 'workspaceFiles.openFile'
      : entry.expanded ? 'workspaceFiles.collapseFolder' : 'workspaceFiles.expandFolder',
    when: () => true, enable: () => true,
  }, ...WORKSPACE_FILE_ACTIONS.map((action, order): MenuItemDescriptor => ({
    id: `workspaceFiles.${action}`, command: action, group: 'fileManagement', order,
    labelKey: `workspaceFiles.${action}`, danger: action === 'trash',
    when: () => entry.actions.includes(action), enable: () => true,
  }))]
  const menu = buildMenuDom(buildMenuModel(descriptors, {
    zone: 'normal', hasSelection: false, blockTarget: null, line: PLAIN_MENU_LINE,
  }), { onCommand: command => {
    if (command === 'activate' || isWorkspaceFileAction(command)) onAction(command)
  } })
  menu.setAttribute('aria-label', t('workspaceFiles.manage', { name: entry.name }))
  return menu
}

/** 只消费宿主已授权的条目；视图不拼路径、不推测当前文件或文件操作结果。 */
export class WorkspaceFilesView {
  readonly element: HTMLElement
  readonly header: HTMLElement
  readonly treeActions: readonly HTMLButtonElement[]
  readonly layout: WorkspaceFilesLayoutControls
  private readonly tree: HTMLElement
  private readonly scroll: HTMLElement
  private readonly opened: HTMLElement
  private readonly openedList: HTMLElement
  private readonly createButtons: HTMLButtonElement[]
  private readonly status: HTMLElement
  private readonly tabRows = new Map<string, FileRow>()
  private readonly treeRows = new Map<string, FileRow>()
  private hovered: FileRow | undefined
  private pendingOpen: { row: FileRow; timer: ReturnType<typeof setTimeout> } | undefined
  private dragSource: FileRow | undefined
  private dropTarget: FileRow | undefined
  private loading = false
  private revealedFile: string | undefined

  constructor(body: HTMLElement, private readonly send: (request: WorkspaceFilesRequest) => void, private readonly menu: FileMenuHost) {
    this.element = document.createElement('aside')
    this.element.id = 'vsidian-file-sidebar'
    this.element.className = 'vsidian-file-sidebar'
    this.element.inert = true
    bindLocale(this.element, 'aria-label', 'workspaceFiles.title')

    this.header = document.createElement('header')
    this.header.className = 'vsidian-file-sidebar-header'
    const label = document.createElement('span')
    bindLocale(label, 'text', 'workspaceFiles.title')
    this.createButtons = [
      actionButton('filePlus', 'workspaceFiles.createFile', () => send({ kind: 'workspaceFiles.create', entry: 'file' })),
      actionButton('folderPlus', 'workspaceFiles.createFolder', () => send({ kind: 'workspaceFiles.create', entry: 'folder' })),
    ]
    this.treeActions = [
      actionButton('refresh', 'workspaceFiles.refresh', () => send({ kind: 'workspaceFiles.refresh' })),
      actionButton('collapseAll', 'workspaceFiles.collapseAll', () => send({ kind: 'workspaceFiles.collapseAll' })),
    ]
    const buttons = [...this.createButtons, ...this.treeActions]
    buttons.forEach(button => { button.disabled = true })
    this.header.append(label, ...buttons)

    this.scroll = document.createElement('div')
    this.scroll.className = 'vsidian-file-sidebar-scroll'
    const list = (key: MessageKey): HTMLUListElement => {
      const ul = document.createElement('ul')
      bindLocale(ul, 'aria-label', key)
      return ul
    }
    this.opened = document.createElement('section')
    this.opened.className = 'vsidian-file-opened'
    const openedLabel = document.createElement('h2')
    bindLocale(openedLabel, 'text', 'workspaceFiles.opened')
    this.openedList = list('workspaceFiles.opened')
    this.openedList.id = 'vsidian-file-opened-list'
    this.opened.append(openedLabel, this.openedList)
    this.opened.hidden = true

    this.tree = list('workspaceFiles.workspace')
    this.tree.className = 'vsidian-file-tree'
    this.status = document.createElement('div')
    this.status.className = 'vsidian-file-status'
    this.status.setAttribute('role', 'status')
    this.status.hidden = true
    bindLocaleFn(this.status, 'text', () => t(this.loading ? 'workspaceFiles.loading' : 'workspaceFiles.noFolder'))
    this.scroll.append(this.tree, this.status)
    this.layout = new WorkspaceFilesLayoutControls(body, this.element, this.opened, this.openedList,
      (dimension, value) => this.send({ kind: 'workspaceFiles.resize', dimension, value }))
    this.element.append(this.header, this.opened, this.layout.heightHandle, this.scroll, this.layout.widthHandle)
    this.bindTreeDrag()
  }

  apply(snapshot: WorkspaceFilesSnapshot): void {
    this.element.inert = !snapshot.open
    if (!snapshot.open) {
      this.cancelFileClick()
      this.clearFileDrag()
    }
    this.createButtons.forEach(button => { button.disabled = !snapshot.canCreate })
    const hasRoot = snapshot.entries.some(entry => entry.kind === 'root')
    this.treeActions.forEach(button => { button.disabled = !hasRoot })
    const focused = document.activeElement instanceof HTMLButtonElement ? document.activeElement : undefined
    const key = focused?.dataset.fileFocus
    const scrollTop = this.scroll.scrollTop
    const tabsTop = this.openedList.scrollTop
    const oldRow = this.currentFile()?.getBoundingClientRect()
    const oldViewport = this.scroll.getBoundingClientRect()
    const currentWasVisible = !!oldRow && oldRow.height > 0 && oldViewport.height > 0 &&
      oldRow.top + oldRow.height / 2 >= oldViewport.top && oldRow.top + oldRow.height / 2 <= oldViewport.bottom
    this.opened.hidden = snapshot.tabs.length === 0
    this.layout.setVisible(snapshot.open, !this.opened.hidden)
    this.updateRows(this.openedList, this.tabRows, snapshot.tabs)
    this.updateRows(this.tree, this.treeRows, snapshot.entries)
    if (this.dragSource && !this.dragSource.button.draggable) this.clearFileDrag()
    if (this.dropTarget && !this.acceptsDrop(this.dropTarget)) this.highlightDrop()
    this.loading = snapshot.loading
    this.status.hidden = !snapshot.open || (!snapshot.loading && snapshot.entries.length > 0)
    if (!this.status.hidden) refreshElementLocale(this.status)
    // 行顺序变化时浏览器可能丢失焦点；恢复同一操作，不切走其他入口。
    if (snapshot.open && key && focused !== document.activeElement) {
      this.element.querySelector<HTMLButtonElement>(`[data-file-focus="${CSS.escape(key)}"]`)?.focus({ preventScroll: true })
    }
    this.scroll.scrollTop = scrollTop
    this.openedList.scrollTop = tabsTop
    if (!snapshot.open || snapshot.loading) this.revealedFile = undefined
    const current = this.currentFile()
    if (current && (currentWasVisible || current.dataset.fileFocus !== this.revealedFile)) {
      const row = current.getBoundingClientRect()
      const viewport = this.scroll.getBoundingClientRect()
      if (row.height > 0 && viewport.height > 0) {
        this.revealedFile = current.dataset.fileFocus
        if (row.top < viewport.top) this.scroll.scrollTop += row.top - viewport.top
        else if (row.bottom > viewport.bottom) this.scroll.scrollTop += row.bottom - viewport.bottom
      }
    }
    const adjusted = []
    if (scrollTop !== this.scroll.scrollTop) adjusted.push(this.scroll)
    if (tabsTop !== this.openedList.scrollTop) adjusted.push(this.openedList)
    repositionHoverPopupIfAnchorWithin(this.element, adjusted)
  }

  dispose(): void {
    this.cancelFileClick()
    this.clearFileDrag()
    this.layout.dispose()
    this.element.remove()
  }

  currentFile(): HTMLButtonElement | null {
    return this.tree.querySelector<HTMLButtonElement>('[aria-current="page"]')
  }

  previewTabName(): HTMLElement | null {
    return this.openedList.querySelector('.vsidian-file-preview-tab .vsidian-file-name')
  }

  /** 宿主测试不能发送物理鼠标事件，派发到真实文件树按钮的同一入口。 */
  dispatchContextMenuForTest(id: string): void {
    this.treeRows.get(id)?.button.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  }

  onPreviewModifierDown(): void {
    if (this.hovered) this.preview(this.hovered)
  }

  handleLocalKey(event: KeyboardEvent): boolean {
    if (this.layout.handleKeydown(event)) return true
    if (event.key === 'Escape' && (this.dragSource || this.pendingOpen)) {
      event.preventDefault()
      event.stopPropagation()
      this.clearFileDrag()
      this.cancelFileClick()
      return true
    }
    return !this.element.inert && isFileMenuKey(event) && event.target instanceof Element &&
      this.tree.contains(event.target) && event.target.closest('.vsidian-file-row') !== null
  }

  private preview(row: FileRow): void {
    const { id, name, previewKind } = row.tab
    if (!previewKind || this.element.inert || this.menu.isOpen() || this.dragSource || this.layout.resizing) return
    hoverPreviewAnchorEnter(row.button, {
      target: name, workspaceFile: { id, kind: previewKind, sidebar: this.element }, sourceStart: 0, sourceEnd: 0,
      openAction: () => this.send({ kind: 'workspaceFiles.activate', id }),
    })
  }

  private updateRows(list: HTMLElement, rows: Map<string, FileRow>,
    tabs: readonly (WorkspaceFileTab | WorkspaceFileEntry)[]): void {
    const ids = new Set(tabs.map(tab => tab.id))
    for (const [id, row] of rows) {
      if (!ids.has(id)) {
        this.removeRow(row)
        rows.delete(id)
      }
    }
    let next = list.firstElementChild
    for (const tab of tabs) {
      const entry = 'kind' in tab ? tab : undefined
      let row = rows.get(tab.id)
      if (!row || row.kind !== entry?.kind) {
        if (row) {
          if (next === row.element) next = next.nextElementSibling
          this.removeRow(row)
        }
        row = this.makeRow(tab, entry?.kind)
        rows.set(tab.id, row)
      }
      this.updateRow(row, tab, entry)
      // 不重挂位置未变的锚点，否则选区、焦点和悬停链会随刷新失效。
      if (row.element !== next) list.insertBefore(row.element, next)
      next = row.element.nextElementSibling
    }
  }

  private removeRow(row: FileRow): void {
    if (this.hovered === row) this.hovered = undefined
    if (this.pendingOpen?.row === row) this.cancelFileClick()
    if (this.dragSource === row) this.clearFileDrag()
    if (this.dropTarget === row) this.highlightDrop()
    closeHoverPopupIfAnchorWithin(row.element)
    row.element.remove()
  }

  private makeRow(tab: WorkspaceFileTab | WorkspaceFileEntry, kind?: WorkspaceFileEntry['kind']): FileRow {
    const element = document.createElement('li')
    element.className = 'vsidian-file-row'
    if (kind) element.dataset.fileId = tab.id
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'vsidian-file-entry'
    button.dataset.fileFocus = `activate:${tab.id}`
    if (kind === 'root') button.classList.add('vsidian-file-root')
    const directory = kind !== undefined && kind !== 'file'
    if (kind !== undefined) {
      const chevron = icon('chevron')
      chevron.classList.add('vsidian-file-chevron')
      if (!directory) chevron.classList.add('vsidian-file-chevron-spacer')
      button.append(chevron)
    }
    const glyph = icon(directory ? 'folder' : 'file')
    glyph.classList.add('vsidian-file-kind-icon')
    const name = document.createElement('span')
    name.className = 'vsidian-file-name'
    button.append(glyph, name)
    element.append(button)
    const row: FileRow = { element, button, name, kind, tab }
    button.addEventListener('click', event => this.activateRow(row, event))
    if (!kind || kind === 'file') button.addEventListener('dblclick', () => {
      this.cancelFileClick()
      this.send({ kind: 'workspaceFiles.activate', id: tab.id, mode: 'keep' })
    })
    if (!kind) {
      const close = () => {
        this.cancelFileClick()
        closeHoverPopupIfAnchorWithin(element)
        this.send({ kind: 'workspaceFiles.closeTab', id: tab.id })
      }
      const closeButton = actionButton('close', 'workspaceFiles.closeTab', close, tab.name)
      closeButton.classList.add('vsidian-file-close')
      closeButton.dataset.fileFocus = `close:${tab.id}`
      row.close = closeButton
      element.append(closeButton)
      element.addEventListener('mousedown', event => {
        if (event.button === 1) event.preventDefault()
      })
      element.addEventListener('auxclick', event => {
        if (event.button !== 1) return
        event.preventDefault()
        close()
      })
    }
    if (kind !== undefined) {
      const open = (event: MouseEvent | KeyboardEvent): void => {
        if (this.element.inert || !('kind' in row.tab)) return
        event.preventDefault()
        event.stopPropagation()
        this.cancelFileClick()
        closeHoverPopupIfAnchorWithin(this.element)
        const rect = button.getBoundingClientRect()
        const pointer = event instanceof MouseEvent && (event.clientX !== 0 || event.clientY !== 0)
        this.menu.open(row.tab, button, pointer ? event.clientX : rect.left, pointer ? event.clientY : rect.bottom)
      }
      element.addEventListener('contextmenu', open)
      element.addEventListener('keydown', event => {
        if (isFileMenuKey(event)) open(event)
      })
    }
    const within = (event: MouseEvent) => event.relatedTarget instanceof Node && button.contains(event.relatedTarget)
    button.addEventListener('mouseover', event => {
      if (within(event)) return
      this.hovered = row
      if (event.ctrlKey || event.metaKey) this.preview(row)
    })
    button.addEventListener('mouseout', event => {
      if (within(event)) return
      if (this.hovered === row) this.hovered = undefined
      hoverPreviewAnchorLeave(button)
    })
    return row
  }

  private activateRow(row: FileRow, event: MouseEvent): void {
    this.cancelFileClick()
    const id = row.tab.id
    const treeFile = row.kind === 'file'
    // 已激活行的鼠标首击不用查盘，不能占住紧随其后的双击保留请求。
    if ((treeFile || !row.kind) && (event.detail > 1 || (event.detail === 1 && row.tab.current))) return
    const request: WorkspaceFilesRequest = treeFile
      ? { kind: 'workspaceFiles.activate', id, mode: event.detail === 0 ? 'keep' : 'preview' }
      : { kind: 'workspaceFiles.activate', id }
    if (event.detail === 1 && (treeFile || (!row.kind && row.tab.isPreview))) {
      this.pendingOpen = { row, timer: setTimeout(() => {
        this.pendingOpen = undefined
        this.send(request)
      }, FILE_CLICK_WAIT_MS) }
    } else this.send(request)
  }

  private cancelFileClick(): void {
    clearTimeout(this.pendingOpen?.timer)
    this.pendingOpen = undefined
  }

  private bindTreeDrag(): void {
    const rowFor = (target: EventTarget | null) => {
      const id = target instanceof Element ? target.closest<HTMLElement>('[data-file-id]')?.dataset.fileId : undefined
      return id ? this.treeRows.get(id) : undefined
    }
    const destination = (event: DragEvent) => {
      const row = rowFor(event.target)
      return row && event.dataTransfer?.types.includes(FILE_DRAG_TYPE) && this.acceptsDrop(row) ? row : undefined
    }
    this.tree.addEventListener('dragstart', event => {
      const row = rowFor(event.target)
      if (!row || event.target !== row.button || !row.button.draggable || !event.dataTransfer || this.element.inert) return
      this.cancelFileClick()
      this.clearFileDrag()
      this.hovered = undefined
      closeHoverPopupIfAnchorWithin(this.element)
      this.dragSource = row
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData(FILE_DRAG_TYPE, 'move')
    })
    this.tree.addEventListener('dragover', event => {
      const target = destination(event)
      this.highlightDrop(target)
      if (!target || !event.dataTransfer) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
    })
    this.tree.addEventListener('dragleave', event => {
      if (this.dropTarget && rowFor(event.target) === this.dropTarget && rowFor(event.relatedTarget) !== this.dropTarget) {
        this.highlightDrop()
      }
    })
    this.tree.addEventListener('drop', event => {
      const source = this.dragSource
      const target = destination(event)
      this.clearFileDrag()
      if (!source || !target) return
      event.preventDefault()
      this.send({ kind: 'workspaceFiles.move', id: source.tab.id, directoryId: target.tab.id })
    })
    this.tree.addEventListener('dragend', () => this.clearFileDrag())
  }

  private acceptsDrop(row: FileRow): boolean {
    const entry = row.tab
    const source = this.dragSource?.tab
    return !!source && 'kind' in source && !!source.move && !this.element.inert &&
      'kind' in entry && (entry.kind === 'root' || entry.kind === 'folder') &&
      !entry.unreadable && entry.move?.scope === source.move.scope && entry.move.directory !== source.move.directory
  }

  private highlightDrop(row?: FileRow): void {
    if (this.dropTarget === row) return
    this.dropTarget?.button.classList.remove('vsidian-file-drop-target')
    this.dropTarget = row
    this.dropTarget?.button.classList.add('vsidian-file-drop-target')
  }

  private clearFileDrag(): void {
    this.dragSource = undefined
    this.highlightDrop()
  }

  private updateRow(row: FileRow, tab: WorkspaceFileTab | WorkspaceFileEntry, entry?: WorkspaceFileEntry): void {
    const { element, button, name } = row
    if (row.tab.previewKind !== tab.previewKind) closeHoverPopupIfAnchorWithin(element)
    if (entry) element.style.paddingInlineStart = `${Math.min(entry.level, 8) * 12}px`
    if (entry?.kind === 'file') button.draggable = entry.move !== undefined
    if (!entry) {
      button.classList.toggle('vsidian-file-preview-tab', tab.isPreview === true)
      if (row.close && row.tab.name !== tab.name) {
        bindLocaleAttrs(row.close, 'workspaceFiles.closeTab', { name: tab.name })
      }
    }
    if (entry && entry.kind !== 'file') button.setAttribute('aria-expanded', String(!!entry.expanded))
    if (tab.current) button.setAttribute('aria-current', 'page')
    else button.removeAttribute('aria-current')
    if (tab.detail) button.dataset.tooltip = entry ? tab.detail : `${tab.name} · ${tab.detail}`
    else delete button.dataset.tooltip
    if (name.textContent !== tab.name) name.textContent = tab.name
    if (!entry && tab.detail) {
      if (!row.detail) {
        row.detail = document.createElement('span')
        row.detail.className = 'vsidian-file-detail'
        button.append(row.detail)
      }
      if (row.detail.textContent !== tab.detail) row.detail.textContent = tab.detail
    } else {
      row.detail?.remove()
      row.detail = undefined
    }
    if (entry && entry.actions.length > 0) {
      if (!row.manage) {
        row.manage = actionButton('more', 'workspaceFiles.manage', () => this.send({ kind: 'workspaceFiles.manage', id: tab.id }), tab.name)
        row.manage.dataset.fileFocus = `manage:${tab.id}`
        element.insertBefore(row.manage, row.status ?? null)
      } else if (row.tab.name !== tab.name) bindLocaleAttrs(row.manage, 'workspaceFiles.manage', { name: tab.name })
    } else {
      row.manage?.remove()
      row.manage = undefined
    }
    if (entry?.unreadable) {
      if (!row.status) {
        row.status = document.createElement('div')
        row.status.className = 'vsidian-file-status vsidian-file-row-status'
        bindLocale(row.status, 'text', 'workspaceFiles.unreadable')
        element.append(row.status)
      }
    } else {
      row.status?.remove()
      row.status = undefined
    }
    row.tab = tab
  }
}
