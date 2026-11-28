import * as vscode from 'vscode'
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { PDF_HOVER_MAX_BYTES } from './hoverDocAccess'
import { t } from '../shared/i18n'
import type { MessageKey } from '../shared/locales/en'
import {
  isWorkspaceFilesLayout, WORKSPACE_FILES_DIMENSIONS, type HostToWebview, type WorkspaceFileAction,
  type WorkspaceFileEntry, type WorkspaceFilesLayout, type WorkspaceFilesRequest, type WorkspaceFilesSnapshot,
} from '../shared/protocol'
import { classifyLocalRefContentKind } from '../shared/refContent'

const OPEN_KEY = 'vsidian.workspaceFiles.open'
const LAYOUT_KEY = 'vsidian.workspaceFiles.layout'
const MEDIA_SCHEME = 'vsidian-file-preview'
const ASSET_ALIAS_LIMIT = 256
const nameOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
const parentOf = (uri: vscode.Uri): vscode.Uri => vscode.Uri.joinPath(uri, '..')

type FileTab = vscode.Tab & { input: vscode.TabInputText | vscode.TabInputCustom | vscode.TabInputNotebook }
type TreeTarget = { kind: WorkspaceFileEntry['kind']; uri: vscode.Uri; name: string }
type Target = TreeTarget | { kind: 'tab'; uri: vscode.Uri; editor: string; group: vscode.TabGroup }
// null 表示确认不存在；undefined（或缺项）表示无法核验。
type PhysicalRoots = ReadonlyMap<string, vscode.Uri | null | undefined>
const NO_PHYSICAL_ROOTS: PhysicalRoots = new Map()
interface AssetAlias { owner: string; uri: vscode.Uri; source: vscode.Uri; root: vscode.Uri; active(): boolean }
interface Client {
  uri: vscode.Uri
  panel: vscode.WebviewPanel
  ready: boolean
  generation: number
  loaded: boolean
  targets: Map<string, Target>
  mediaRoot: vscode.Uri
  assets: Map<string, AssetAlias>
}

const isFileTab = (tab: vscode.Tab): tab is FileTab =>
  tab.input instanceof vscode.TabInputText || tab.input instanceof vscode.TabInputCustom || tab.input instanceof vscode.TabInputNotebook
function editorOf(tab: FileTab): string {
  if (tab.input instanceof vscode.TabInputCustom) return tab.input.viewType
  if (tab.input instanceof vscode.TabInputNotebook) return `notebook:${tab.input.notebookType}`
  return 'default'
}
const previewKindOf = (uri: vscode.Uri) => uri.scheme === 'file' ? classifyLocalRefContentKind(uri.fsPath) : undefined

function pathIdentity(uri: vscode.Uri): string {
  const ignoreCase = uri.scheme === 'file' && (process.platform === 'win32' || process.platform === 'darwin')
  const path = uri.path.replace(/\/+$/, '') || '/'
  return ignoreCase ? path.toLowerCase() : path
}

const originOf = (uri: vscode.Uri): string => `${uri.scheme}://${uri.authority.toLowerCase()}`
const sameOrigin = (a: vscode.Uri, b: vscode.Uri): boolean => originOf(a) === originOf(b)

function contains(parent: vscode.Uri, item: vscode.Uri): boolean {
  if (!sameOrigin(parent, item)) return false
  const base = pathIdentity(parent)
  const itemPath = pathIdentity(item)
  return itemPath === base || itemPath.startsWith(base.endsWith('/') ? base : `${base}/`)
}

function sameUri(a: vscode.Uri, b: vscode.Uri): boolean {
  return sameOrigin(a, b) && pathIdentity(a) === pathIdentity(b) &&
    a.query === b.query && a.fragment === b.fragment
}

function isWritable(uri: vscode.Uri): boolean {
  return vscode.workspace.getWorkspaceFolder(uri) !== undefined && vscode.workspace.fs.isWritableFileSystem(uri.scheme) === true
}

function isWorkspaceRoot(uri: vscode.Uri): boolean {
  return (vscode.workspace.workspaceFolders ?? []).some(folder => contains(folder.uri, uri) && contains(uri, folder.uri))
}

async function readPhysicalRoots(folders = vscode.workspace.workspaceFolders ?? []): Promise<PhysicalRoots> {
  const local = folders.filter(folder => folder.uri.scheme === 'file')
  // 单根里的目录不可能是该根的物理祖先。不为它增加磁盘探测。
  if (local.length < 2) return NO_PHYSICAL_ROOTS
  return new Map(await Promise.all(local.map(async ({ uri }) => {
    const canonical = await realpath(uri.fsPath).then(path => vscode.Uri.file(path), (error: NodeJS.ErrnoException) =>
      error.code === 'ENOENT' || error.code === 'ENOTDIR' ? null : undefined)
    return [uri.toString(), canonical] as const
  })))
}

function containsWorkspaceRoot(uri: vscode.Uri, physical?: PhysicalRoots): boolean {
  const folders = vscode.workspace.workspaceFolders ?? []
  if (folders.some(folder => contains(uri, folder.uri))) return true
  if (!physical || uri.scheme !== 'file') return false
  const local = folders.filter(folder => folder.uri.scheme === 'file')
  if (local.length < 2) return false
  // 根在取真实路径期间切换，或有根无法解析时，不移走可能包含它的目录。
  if (local.some(folder => physical.get(folder.uri.toString()) === undefined)) return true
  const owner = vscode.workspace.getWorkspaceFolder(uri)?.uri
  const canonicalOwner = owner && physical.get(owner.toString())
  if (!owner || !canonicalOwner) return true
  const relative = uri.path.slice(pathIdentity(owner).length).replace(/^\/+/, '')
  const canonical = vscode.Uri.joinPath(canonicalOwner, relative)
  return local.some(folder => {
    const root = physical.get(folder.uri.toString())
    return root !== undefined && root !== null && contains(canonical, root)
  })
}

/** 目录快照不能授权当前磁盘状态：根以下任一层变成链接或变更类型即视为过期。
 * 用户明确挂载的工作区根仍可使用（包括通过符号链接加入的根）。 */
async function verifyTreePath(uri: vscode.Uri, expected: vscode.FileType,
  root = vscode.workspace.getWorkspaceFolder(uri)?.uri): Promise<void> {
  if (!root || !contains(root, uri)) throw vscode.FileSystemError.FileNotFound(uri)
  const chain: vscode.Uri[] = [uri]
  while (pathIdentity(chain.at(-1)!) !== pathIdentity(root)) {
    const parent = parentOf(chain.at(-1)!)
    if (pathIdentity(parent) === pathIdentity(chain.at(-1)!)) throw vscode.FileSystemError.FileNotFound(uri)
    chain.push(parent)
  }
  for (let i = chain.length - 1; i >= 0; i--) {
    const { type } = await vscode.workspace.fs.stat(chain[i]!)
    if (!(type & (i === 0 ? expected : vscode.FileType.Directory)) ||
      (i < chain.length - 1 && (type & vscode.FileType.SymbolicLink))) {
      throw vscode.FileSystemError.FileNotFound(uri)
    }
  }
}

function isFileName(name: string): boolean {
  return !!name && name.toLowerCase() !== '.git' && name === name.trim() && !/[<>:"/\\|?*\u0000-\u001f]/.test(name) && !name.endsWith('.') &&
    !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)
}

/** 按工作区共享开关、尺寸和目录展开态；按面板派发所在编辑器组的标签及可操作条目。 */
export class WorkspaceFilesSidebar implements vscode.Disposable {
  private open: boolean
  private layout: WorkspaceFilesLayout
  private readonly clients = new Map<vscode.WebviewPanel, Client>()
  private readonly groupIds = new WeakMap<vscode.TabGroup, number>()
  private nextGroupId = 0
  private physicalSnapshot: { key: string; roots?: PhysicalRoots } | undefined
  private readonly mediaClients = new Map<string, Client>()
  private readonly expandedRoots = new Map<string, boolean>()
  private readonly expandedFolders = new Map<string, boolean>()
  private readonly listings = new Map<string, Promise<[string, vscode.FileType][]>>()
  private lastDocument: string | undefined
  private subscriptions: vscode.Disposable | undefined
  private refreshTimer: ReturnType<typeof setTimeout> | undefined
  private actionPending = false

  constructor(private readonly store: vscode.Memento, private readonly hostKind: vscode.ExtensionKind) {
    this.open = store.get(OPEN_KEY) === true
    const saved = store.get(LAYOUT_KEY)
    this.layout = isWorkspaceFilesLayout(saved) ? saved : {
      width: WORKSPACE_FILES_DIMENSIONS.width.default,
      openedHeight: WORKSPACE_FILES_DIMENSIONS.openedHeight.default,
    }
  }

  attach(uri: vscode.Uri, panel: vscode.WebviewPanel) {
    const mediaRoot = vscode.Uri.from({ scheme: MEDIA_SCHEME, path: `/${randomUUID()}` })
    const client: Client = { uri, panel, ready: false, generation: 0, loaded: false, targets: new Map(), mediaRoot, assets: new Map() }
    this.clients.set(panel, client)
    this.mediaClients.set(mediaRoot.path, client)
    return {
      ready: (): void => {
        client.ready = true
        client.loaded = false
        client.targets.clear()
        client.assets.clear()
        this.viewChanged(client)
      },
      viewChanged: (): void => this.viewChanged(client),
      request: (request: WorkspaceFilesRequest): void => this.request(client, request),
      previewTarget: async (id: string): Promise<string | undefined> => (await this.verifyPreviewTarget(client, id))?.fsPath,
      previewMedia: (id: string): vscode.Uri | undefined => this.previewMedia(client, id),
      previewSourceAsset: (id: string, uri: vscode.Uri, source: vscode.Uri, active: () => boolean): vscode.Uri | undefined =>
        this.previewSourceAsset(client, id, uri, source, active),
      dispose: (): void => {
        if (this.clients.get(panel) !== client) return
        this.clients.delete(panel)
        this.mediaClients.delete(mediaRoot.path)
        if (this.clients.size === 0) this.stopWatching()
      },
    }
  }

  dispose(): void {
    this.clients.clear()
    this.mediaClients.clear()
    this.stopWatching()
  }

  mediaRoots(panel: vscode.WebviewPanel): vscode.Uri[] {
    const root = this.clients.get(panel)?.mediaRoot
    return root ? [root] : []
  }

  /** 跨根与工作区外附件只按已列出的文件身份授权，不把其目录加入 localResourceRoots。 */
  registerMediaResources(): vscode.Disposable {
    const changes = new vscode.EventEmitter<vscode.FileChangeEvent[]>()
    const rejectWrite = () => { throw vscode.FileSystemError.NoPermissions() }
    const registration = vscode.workspace.registerFileSystemProvider(MEDIA_SCHEME, {
      onDidChangeFile: changes.event,
      watch: () => ({ dispose() {} }),
      stat: async uri => vscode.workspace.fs.stat(await this.mediaTarget(uri)),
      readFile: async uri => {
        const target = await this.mediaTarget(uri)
        if (previewKindOf(target) === 'pdf' && (await vscode.workspace.fs.stat(target)).size > PDF_HOVER_MAX_BYTES) {
          throw vscode.FileSystemError.Unavailable(uri)
        }
        return vscode.workspace.fs.readFile(target)
      },
      readDirectory: uri => { throw vscode.FileSystemError.FileNotFound(uri) },
      writeFile: rejectWrite, delete: rejectWrite, createDirectory: rejectWrite, rename: rejectWrite,
    }, { isCaseSensitive: true, isReadonly: true })
    return vscode.Disposable.from(registration, changes)
  }

  private previewMedia(client: Client, id: string): vscode.Uri | undefined {
    const source = this.previewTarget(client, id)
    if (!source) return
    const kind = previewKindOf(source)
    if (kind !== 'pdf' && kind !== 'image') return
    // 保留扩展名供 VS Code 生成 MIME；条目 ID 只用于快照查询，不解码为磁盘路径。
    const suffix = source.path.slice(source.path.lastIndexOf('.'))
    return vscode.Uri.joinPath(client.mediaRoot, Buffer.from(id).toString('base64url') + suffix)
  }

  private sourceRoot(source: vscode.Uri): vscode.Uri {
    return vscode.workspace.getWorkspaceFolder(source)?.uri ?? parentOf(source)
  }

  /** 调用方已核对宿主源码中的引用；这里只授权来源根内的具体附件。 */
  private previewSourceAsset(client: Client, owner: string, uri: vscode.Uri, source: vscode.Uri,
    active: () => boolean): vscode.Uri | undefined {
    const root = this.sourceRoot(source)
    const kind = previewKindOf(uri)
    if (!this.previewTarget(client, owner) || !active() || (kind !== 'image' && kind !== 'pdf') || !contains(root, uri)) return
    const key = Buffer.from(JSON.stringify([owner, uri.toString()])).toString('base64url')
    const alias = vscode.Uri.joinPath(client.mediaRoot, 'asset', key + uri.path.slice(uri.path.lastIndexOf('.')))
    client.assets.delete(alias.path)
    client.assets.set(alias.path, { owner, uri, source, root, active })
    if (client.assets.size > ASSET_ALIAS_LIMIT) client.assets.delete(client.assets.keys().next().value!)
    return alias
  }

  private async mediaTarget(uri: vscode.Uri): Promise<vscode.Uri> {
    const match = /^\/([^/]+)\/(asset\/)?([\w-]+)\.[^/]+$/.exec(uri.path)
    const client = match && this.mediaClients.get(`/${match[1]}`)
    if (client && match && uri.scheme === MEDIA_SCHEME && uri.authority === '') {
      if (match[2]) {
        const asset = client.assets.get(uri.path)
        const authorized = () => asset?.active() && sameUri(asset.root, this.sourceRoot(asset.source))
        if (asset && authorized() && await this.verifyPreviewTarget(client, asset.owner)) {
          await verifyTreePath(asset.uri, vscode.FileType.File, asset.root)
          if (client.assets.get(uri.path) === asset && authorized() && this.previewTarget(client, asset.owner)) return asset.uri
        }
      } else {
        const id = Buffer.from(match[3]!, 'base64url').toString()
        if (this.previewMedia(client, id)?.path === uri.path) {
          const source = await this.verifyPreviewTarget(client, id)
          if (source) return source
        }
      }
    }
    throw vscode.FileSystemError.FileNotFound(uri)
  }

  private viewChanged(client: Client): void {
    if (!client.ready || !client.panel.visible || this.clients.get(client.panel) !== client) return
    this.postLayout(client)
    if (this.open) {
      this.startWatching()
      if (client.panel.active) this.revealDocument(client.uri)
    }
    this.refresh()
  }

  private postLayout(client: Client): void {
    const message: HostToWebview = { kind: 'workspaceFiles.layout', layout: this.layout }
    void client.panel.webview.postMessage(message)
  }

  private resize({ dimension, value }: Extract<WorkspaceFilesRequest, { kind: 'workspaceFiles.resize' }>): void {
    if (this.layout[dimension] === value) return
    const layout = { ...this.layout, [dimension]: value }
    if (!isWorkspaceFilesLayout(layout)) return
    this.layout = layout
    for (const client of this.clients.values()) {
      if (client.ready && client.panel.visible) this.postLayout(client)
    }
    void Promise.resolve(this.store.update(LAYOUT_KEY, layout)).catch(() =>
      vscode.window.showWarningMessage(t('workspaceFiles.storageFailed')))
  }

  private revealDocument(uri: vscode.Uri): void {
    if (this.lastDocument === uri.toString()) return
    this.lastDocument = uri.toString()
    const root = vscode.workspace.getWorkspaceFolder(uri)?.uri
    if (!root) return
    for (let dir = parentOf(uri); contains(root, dir); dir = parentOf(dir)) {
      this.expandedFolders.set(dir.toString(), true)
      if (sameUri(root, dir)) {
        this.expandedRoots.set(dir.toString(), true)
        break
      }
      if (sameUri(dir, parentOf(dir))) break
    }
  }

  private startWatching(): void {
    if (this.subscriptions) return
    const watcher = vscode.workspace.createFileSystemWatcher('**/*', false, true, false)
    this.subscriptions = vscode.Disposable.from(
      watcher,
      watcher.onDidCreate(uri => this.invalidate(uri)),
      watcher.onDidDelete(uri => this.invalidate(uri)),
      vscode.window.tabGroups.onDidChangeTabs(() => this.scheduleRefresh()),
      vscode.window.tabGroups.onDidChangeTabGroups(() => this.scheduleRefresh()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.listings.clear()
        this.physicalSnapshot = undefined
        this.lastDocument = undefined
        for (const client of this.clients.values()) if (client.panel.active) this.revealDocument(client.uri)
        this.scheduleRefresh()
      }),
    )
  }

  private stopWatching(): void {
    this.subscriptions?.dispose()
    this.subscriptions = undefined
    clearTimeout(this.refreshTimer)
    this.refreshTimer = undefined
    this.listings.clear()
    this.physicalSnapshot = undefined
  }

  private invalidate(uri: vscode.Uri): void {
    // 已解析的普通根只受其自身或祖先的变化影响；别名或缺失根的目标
    // 也可在尚未读入列表的折叠目录内消失或恢复。
    const snapshot = this.physicalSnapshot
    const physicalChanged = uri.scheme === 'file' && snapshot !== undefined &&
      (vscode.workspace.workspaceFolders ?? []).some(({ uri: root }) => {
        if (root.scheme !== 'file') return false
        const canonical = snapshot.roots?.get(root.toString())
        return !canonical || !sameUri(root, canonical) || contains(uri, root)
      })
    if (physicalChanged) this.physicalSnapshot = undefined
    const parentChanged = this.listings.delete(parentOf(uri).toString())
    const key = uri.toString()
    let directoryChanged = this.listings.delete(key)
    for (const dir of this.listings.keys()) {
      if (dir.startsWith(`${key}/`)) directoryChanged = this.listings.delete(dir) || directoryChanged
    }
    if (physicalChanged || parentChanged || directoryChanged) this.scheduleRefresh()
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== undefined) return
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined
      this.refresh()
    }, 50)
  }

  private refresh(): void {
    for (const client of this.clients.values()) {
      if (client.ready && client.panel.visible) void this.render(client)
    }
  }

  private physicalRootsForSnapshot(folders = vscode.workspace.workspaceFolders ?? []): PhysicalRoots {
    const local = folders.filter(folder => folder.uri.scheme === 'file')
    if (local.length < 2) return NO_PHYSICAL_ROOTS
    const key = JSON.stringify(local.map(folder => folder.uri.toString()))
    if (this.physicalSnapshot?.key !== key) {
      const pending: { key: string; roots?: PhysicalRoots } = { key }
      this.physicalSnapshot = pending
      // 慢根可能还未展开：先显示文件树和安全动作，不等物理身份。
      void readPhysicalRoots(local).then(roots => {
        if (this.physicalSnapshot !== pending) return
        pending.roots = roots
        this.refresh()
      })
    }
    return this.physicalSnapshot.roots ?? NO_PHYSICAL_ROOTS
  }

  private async render(client: Client): Promise<void> {
    const generation = ++client.generation
    const snapshot: WorkspaceFilesSnapshot = {
      kind: 'workspaceFiles.snapshot', open: this.open, loading: false, canCreate: false, entries: [], tabs: [],
    }
    if (!this.open) {
      client.loaded = false
      client.targets.clear()
      client.assets.clear()
      void client.panel.webview.postMessage(snapshot)
      return
    }
    const tabs = new Map<string, Target>()
    const group = this.groupOf(client)
    if (group) {
      let groupId = this.groupIds.get(group)
      if (groupId === undefined) this.groupIds.set(group, groupId = ++this.nextGroupId)
      for (const tab of group.tabs) {
        if (!isFileTab(tab)) continue
        const { input } = tab
        const editor = editorOf(tab)
        const id = `tab:${editor}|${input.uri.toString()}|group:${groupId}`
        const dir = parentOf(input.uri)
        const detail = input.uri.scheme === 'untitled' ? undefined : vscode.workspace.asRelativePath(dir)
        snapshot.tabs.push({ id, name: tab.label, detail, current: tab.isActive, isPreview: tab.isPreview, previewKind: previewKindOf(input.uri) })
        tabs.set(id, { kind: 'tab', editor, group, uri: input.uri })
      }
    }
    const roots = vscode.workspace.workspaceFolders ?? []
    if (!client.loaded && roots.length) {
      client.targets = tabs
      void client.panel.webview.postMessage({ ...snapshot, loading: true })
    }
    const targets = new Map(tabs)
    const physical = this.physicalRootsForSnapshot(roots)
    const trees = await Promise.all(roots.map(root =>
      this.rows(root.uri, { kind: 'root', uri: root.uri, name: root.name }, 0, roots.length === 1, client.uri, targets, physical)))
    if (generation !== client.generation || this.clients.get(client.panel) !== client || !client.panel.visible) return
    if (this.groupOf(client) !== group) return this.scheduleRefresh()
    snapshot.entries = trees.flat()
    snapshot.canCreate = roots.some(root => isWritable(root.uri))
    client.loaded = true
    client.targets = targets
    for (const [key, asset] of client.assets) {
      if (!targets.has(asset.owner) || !asset.active() || !sameUri(asset.root, this.sourceRoot(asset.source))) client.assets.delete(key)
    }
    void client.panel.webview.postMessage(snapshot)
  }

  private async rows(root: vscode.Uri, target: TreeTarget, level: number, singleRoot: boolean,
    current: vscode.Uri, targets: Map<string, Target>, physical: PhysicalRoots): Promise<WorkspaceFileEntry[]> {
    const { name, uri, kind } = target
    const key = uri.toString()
    const id = `tree:${root.toString()}|${key}`
    targets.set(id, target)
    const row: WorkspaceFileEntry = { id, name, kind, level, actions: this.fileActions(target, physical),
      detail: vscode.workspace.asRelativePath(uri), current: kind === 'file' && sameUri(uri, current) }
    if (row.actions.includes(kind === 'file' ? 'rename' : 'createFile')) {
      const directory = kind === 'file' ? parentOf(uri) : uri
      row.move = { scope: originOf(directory), directory: JSON.stringify([pathIdentity(directory), directory.query, directory.fragment]) }
    }
    if (kind === 'file') {
      row.previewKind = previewKindOf(uri)
      return [row]
    }
    const expansion = kind === 'root' ? this.expandedRoots : this.expandedFolders
    row.expanded = expansion.get(key) ?? (kind === 'root' && singleRoot)
    if (!row.expanded) return [row]

    let children: [string, vscode.FileType][]
    try {
      children = await this.readDirectory(uri)
    } catch {
      row.unreadable = true
      return [row]
    }
    const nested = await Promise.all(children.map(([child, type]) => this.rows(root, {
      name: child, kind: type === vscode.FileType.Directory ? 'folder' : 'file', uri: vscode.Uri.joinPath(uri, child),
    }, level + 1, singleRoot, current, targets, physical)))
    return [row, ...nested.flat()]
  }

  private readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const key = uri.toString()
    let children = this.listings.get(key)
    if (!children) {
      children = verifyTreePath(uri, vscode.FileType.Directory).then(() => vscode.workspace.fs.readDirectory(uri)).then(entries => entries
        .filter(([name, type]) => name.toLowerCase() !== '.git' &&
          (type === vscode.FileType.Directory || type === vscode.FileType.File))
        .sort(([a, ta], [b, tb]) => tb - ta || nameOrder.compare(a, b)))
      this.listings.set(key, children)
      void children.catch(() => {
        if (this.listings.get(key) === children) this.listings.delete(key)
      })
    }
    return children
  }

  private groupOf(client: Client): vscode.TabGroup | undefined {
    const column = client.panel.viewColumn
    return column === undefined && client.panel.active ? vscode.window.tabGroups.activeTabGroup :
      vscode.window.tabGroups.all.find(group => group.viewColumn === column)
  }

  private findTab(client: Client, target: Extract<Target, { kind: 'tab' }>): FileTab | undefined {
    if (this.groupOf(client) !== target.group) return
    return target.group.tabs.filter(isFileTab)
      .find(tab => editorOf(tab) === target.editor && sameUri(tab.input.uri, target.uri))
  }

  private previewTarget(client: Client, id: string): vscode.Uri | undefined {
    if (!this.open || !client.ready || !client.panel.visible || this.clients.get(client.panel) !== client) return
    const target = client.targets.get(id)
    if (!target || target.uri.scheme !== 'file') return
    const allowed = target.kind === 'tab' ? this.findTab(client, target) !== undefined :
      target.kind === 'file' && vscode.workspace.getWorkspaceFolder(target.uri) !== undefined
    if (allowed) return target.uri
  }

  private async verifyPreviewTarget(client: Client, id: string): Promise<vscode.Uri | undefined> {
    const uri = this.previewTarget(client, id)
    if (!uri) return
    if (client.targets.get(id)?.kind === 'file') {
      try {
        await verifyTreePath(uri, vscode.FileType.File)
      } catch (error) {
        if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return
        throw error
      }
    }
    return this.previewTarget(client, id)
  }

  private request(client: Client, request: WorkspaceFilesRequest): void {
    if (!client.ready || !client.panel.active || this.clients.get(client.panel) !== client) return
    if (request.kind === 'workspaceFiles.toggle') {
      this.open = !this.open
      const open = this.open
      void Promise.resolve(this.store.update(OPEN_KEY, open)).catch(() =>
        vscode.window.showWarningMessage(t('workspaceFiles.storageFailed')))
      if (open) {
        this.revealDocument(client.uri)
        this.startWatching()
      } else {
        this.stopWatching()
      }
      this.refresh()
      return
    }
    if (!this.open) return
    if (request.kind === 'workspaceFiles.resize') return this.resize(request)
    if (request.kind === 'workspaceFiles.refresh') {
      this.listings.clear()
      this.physicalSnapshot = undefined
      this.refresh()
      return
    }
    if (request.kind === 'workspaceFiles.collapseAll') {
      this.expandedFolders.clear()
      this.refresh()
      return
    }
    if (this.actionPending) return
    this.actionPending = true
    void this.perform(client, request).catch(error => {
      void vscode.window.showErrorMessage(t('workspaceFiles.operationFailed', {
        reason: error instanceof Error ? error.message : String(error),
      }))
    }).finally(() => { this.actionPending = false })
  }

  private async perform(client: Client, request: Extract<WorkspaceFilesRequest,
    { kind: 'workspaceFiles.activate' | 'workspaceFiles.manage' | 'workspaceFiles.create' | 'workspaceFiles.action' |
      'workspaceFiles.move' | 'workspaceFiles.closeTab' }>): Promise<void> {
    if (request.kind === 'workspaceFiles.create') {
      const directory = await this.defaultDirectory(client)
      if (directory) await this.create(client, directory, request.entry)
      return
    }
    if (request.kind === 'workspaceFiles.action') {
      await this.runFileAction(client, request.id, request.action)
      return
    }
    if (request.kind === 'workspaceFiles.move') return this.moveFile(client, request.id, request.directoryId)
    const target = client.targets.get(request.id)
    if (!target) return
    const isDirectory = target.kind === 'folder' || target.kind === 'root'
    if (request.kind === 'workspaceFiles.activate' &&
        ((request.expanded !== undefined && !isDirectory) || (request.mode !== undefined && isDirectory))) return
    if (target.kind === 'tab') {
      if (request.kind === 'workspaceFiles.activate') {
        // VS Code 可重建 Tab 对象；从同组实时标签按 URI 和编辑器类型重新定位。
        const tab = this.findTab(client, target)
        if (tab) await this.openTab(client, tab, request.mode === 'keep')
      } else if (request.kind === 'workspaceFiles.closeTab') {
        const tab = this.findTab(client, target)
        if (tab) await vscode.window.tabGroups.close(tab, !tab.isActive)
      }
      return
    }
    if (request.kind === 'workspaceFiles.closeTab' || !vscode.workspace.getWorkspaceFolder(target.uri)) return
    if (request.kind === 'workspaceFiles.manage') {
      await this.manage(client, request.id, target)
    } else if (target.kind === 'file') {
      await verifyTreePath(target.uri, vscode.FileType.File)
      const tabs = this.groupOf(client)?.tabs.filter(isFileTab) ?? []
      const existing = tabs.find(tab => tab.isActive && sameUri(tab.input.uri, target.uri)) ??
        tabs.find(tab => sameUri(tab.input.uri, target.uri))
      if (existing) await this.openTab(client, existing, request.mode === 'keep')
      else await this.openFile(client, target.uri, request.mode !== 'keep')
    } else {
      const key = target.uri.toString()
      const expansion = target.kind === 'root' ? this.expandedRoots : this.expandedFolders
      const expanded = expansion.get(key) ?? (target.kind === 'root' && vscode.workspace.workspaceFolders?.length === 1)
      const next = request.expanded ?? !expanded
      if (next === expanded) return
      expansion.set(key, next)
      if (next) this.listings.delete(key)
      this.refresh()
    }
  }

  private async openTab(client: Client, tab: FileTab, keep: boolean): Promise<void> {
    if (tab.isActive && (!keep || !tab.isPreview)) return
    const options = { viewColumn: client.panel.viewColumn, preview: !keep && tab.isPreview }
    if (tab.input instanceof vscode.TabInputCustom) {
      await vscode.commands.executeCommand('vscode.openWith', tab.input.uri, tab.input.viewType, options)
    } else if (tab.input instanceof vscode.TabInputNotebook) {
      const input = tab.input
      const model = vscode.workspace.notebookDocuments.find(doc => doc.notebookType === input.notebookType && sameUri(doc.uri, input.uri))
      if (model) await vscode.window.showNotebookDocument(model, options)
      else await vscode.commands.executeCommand('vscode.openWith', input.uri, input.notebookType, options)
    } else {
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(tab.input.uri), options)
    }
  }

  private async openFile(client: Client, uri: vscode.Uri, preview = false): Promise<void> {
    await vscode.commands.executeCommand('vscode.open', uri, { viewColumn: client.panel.viewColumn, preview })
  }

  private async defaultDirectory(client: Client): Promise<vscode.Uri | undefined> {
    const dir = parentOf(client.uri)
    if (isWritable(dir)) return dir
    const roots = (vscode.workspace.workspaceFolders ?? []).filter(folder => isWritable(folder.uri))
    if (roots.length <= 1) return roots[0]?.uri
    const chosen = await vscode.window.showQuickPick(roots.map(root => ({ label: root.name, uri: root.uri })),
      { placeHolder: t('workspaceFiles.chooseFolder') })
    return chosen?.uri
  }

  private canUseTrash(uri: vscode.Uri): boolean {
    // 只向内建本机文件系统发出回收站请求。远程 provider 没有 Trash 能力；
    // 远端扩展宿主中的 file URI 经 VS Code RPC 也会变成 vscode-remote。
    return this.hostKind === vscode.ExtensionKind.UI && uri.scheme === 'file'
  }

  private fileActions(target: TreeTarget, physical?: PhysicalRoots): WorkspaceFileAction[] {
    if (!isWritable(target.uri)) return []
    const actions: WorkspaceFileAction[] = target.kind === 'file' ? [] : ['createFile', 'createFolder']
    if (!containsWorkspaceRoot(target.uri, target.kind === 'folder' ? physical : undefined)) {
      actions.push('rename')
      if (this.canUseTrash(target.uri)) actions.push('trash')
    }
    return actions
  }

  private async manage(client: Client, id: string, target: TreeTarget): Promise<void> {
    const physical = target.kind === 'folder' ? this.physicalRootsForSnapshot() : undefined
    const options = this.fileActions(target, physical).map(action => ({ label: t(`workspaceFiles.${action}`), action }))
    if (options.length === 0) return
    const selection = await vscode.window.showQuickPick(options, { title: t('workspaceFiles.manage', { name: target.name }) })
    if (selection) await this.runFileAction(client, id, selection.action)
  }

  private async runFileAction(client: Client, id: string, action: WorkspaceFileAction): Promise<void> {
    if (!this.open || !client.panel.active || this.clients.get(client.panel) !== client) return
    const target = client.targets.get(id)
    if (!target || target.kind === 'tab') return
    const physical = target.kind === 'folder' && action !== 'createFile' && action !== 'createFolder'
      ? this.physicalRootsForSnapshot() : undefined
    if (!this.fileActions(target, physical).includes(action)) return
    switch (action) {
      case 'createFile': return this.create(client, target.uri, 'file')
      case 'createFolder': return this.create(client, target.uri, 'folder')
      case 'rename': return this.rename(target)
      case 'trash': return this.trash(target)
    }
  }

  private async promptName(dir: vscode.Uri, title: MessageKey, prompt: MessageKey, old?: string): Promise<string | undefined> {
    return vscode.window.showInputBox({
      title: `${t(title)} · ${vscode.workspace.asRelativePath(dir, true) || dir.path}`,
      prompt: t(prompt), value: old,
      validateInput: name => isFileName(name) ? undefined : t('workspaceFiles.invalidName'),
    })
  }

  private async requireMissing(uri: vscode.Uri, name: string): Promise<void> {
    try {
      await vscode.workspace.fs.stat(uri)
    } catch (error) {
      if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return
      throw error
    }
    throw new Error(t('workspaceFiles.exists', { name }))
  }

  private async create(client: Client, dir: vscode.Uri, entry: 'file' | 'folder'): Promise<void> {
    const name = await this.promptName(dir, entry === 'file' ? 'workspaceFiles.createFile' : 'workspaceFiles.createFolder',
      entry === 'file' ? 'workspaceFiles.filePrompt' : 'workspaceFiles.folderPrompt')
    if (!name || !isFileName(name) || !isWritable(dir)) return
    const uri = vscode.Uri.joinPath(dir, name)
    await this.requireMissing(uri, name)
    await verifyTreePath(dir, vscode.FileType.Directory)
    if (entry === 'folder') {
      await vscode.workspace.fs.createDirectory(uri)
    } else {
      const edit = new vscode.WorkspaceEdit()
      edit.createFile(uri, { overwrite: false })
      if (!await vscode.workspace.applyEdit(edit)) throw vscode.FileSystemError.Unavailable(uri)
    }
    this.expandDirectory(dir)
    this.invalidate(uri)
    this.scheduleRefresh()
    if (entry === 'file') await this.openFile(client, uri)
  }

  private async rename(target: TreeTarget): Promise<void> {
    const dir = parentOf(target.uri)
    const name = await this.promptName(dir, 'workspaceFiles.rename', 'workspaceFiles.renamePrompt', target.name)
    if (!name || !isFileName(name) || name === target.name || !isWritable(target.uri) || containsWorkspaceRoot(target.uri)) return
    const uri = vscode.Uri.joinPath(dir, name)
    // 大小写改名交由宿主判定；仍不允许覆盖其他文件。
    if (name.toLowerCase() !== target.name.toLowerCase()) await this.requireMissing(uri, name)
    const physical = target.kind === 'folder' ? await readPhysicalRoots() : undefined
    await verifyTreePath(target.uri, target.kind === 'file' ? vscode.FileType.File : vscode.FileType.Directory)
    if (containsWorkspaceRoot(target.uri, physical)) return
    await this.applyRename(target.uri, uri)
  }

  private async moveFile(client: Client, id: string, directoryId: string): Promise<void> {
    const source = client.targets.get(id)
    const directory = client.targets.get(directoryId)
    if (source?.kind !== 'file' || (directory?.kind !== 'folder' && directory?.kind !== 'root') ||
        !sameOrigin(source.uri, directory.uri) || sameUri(parentOf(source.uri), directory.uri) ||
        !this.fileActions(source).includes('rename') || !isWritable(directory.uri)) return
    const fromRoot = vscode.workspace.getWorkspaceFolder(source.uri)?.uri
    const toRoot = vscode.workspace.getWorkspaceFolder(directory.uri)?.uri
    if (!fromRoot || !toRoot) return
    const to = vscode.Uri.joinPath(directory.uri, source.name)
    if (!sameUri(parentOf(to), directory.uri)) return
    await this.requireMissing(to, source.name)
    // 查重的异步间隙也可能更换祖先目录；把实际路径复核放在写入前。
    await Promise.all([
      verifyTreePath(source.uri, vscode.FileType.File, fromRoot),
      verifyTreePath(directory.uri, vscode.FileType.Directory, toRoot),
    ])

    // 读盘期间窗口可切走、目录可折叠或工作区根可撤下；不沿用已经失效的授权。
    const currentSource = client.targets.get(id)
    const currentDirectory = client.targets.get(directoryId)
    const inSameRoot = (uri: vscode.Uri, root: vscode.Uri) => {
      const currentRoot = vscode.workspace.getWorkspaceFolder(uri)?.uri
      return currentRoot !== undefined && sameUri(root, currentRoot)
    }
    if (!this.open || !client.panel.active || this.clients.get(client.panel) !== client ||
        currentSource?.kind !== 'file' || !sameUri(currentSource.uri, source.uri) ||
        currentDirectory?.kind !== directory.kind || !sameUri(currentDirectory.uri, directory.uri) ||
        !inSameRoot(source.uri, fromRoot) || !inSameRoot(directory.uri, toRoot) ||
        !this.fileActions(source).includes('rename') || !isWritable(directory.uri)) return
    await this.applyRename(source.uri, to)
    this.expandDirectory(directory.uri)
  }

  private expandDirectory(uri: vscode.Uri): void {
    this.expandedFolders.set(uri.toString(), true)
    if (isWorkspaceRoot(uri)) this.expandedRoots.set(uri.toString(), true)
  }

  private async applyRename(from: vscode.Uri, to: vscode.Uri): Promise<void> {
    const edit = new vscode.WorkspaceEdit()
    edit.renameFile(from, to, { overwrite: false })
    if (!await vscode.workspace.applyEdit(edit)) throw vscode.FileSystemError.Unavailable(from)
    this.invalidate(from)
    this.invalidate(to)
    this.scheduleRefresh()
  }

  private async trash(target: TreeTarget): Promise<void> {
    const { uri, name } = target
    const trash = t('workspaceFiles.trash')
    const answer = await vscode.window.showWarningMessage(t(target.kind === 'file'
      ? 'workspaceFiles.trashFilePrompt' : 'workspaceFiles.trashFolderPrompt', { name }), { modal: true }, trash)
    if (answer !== trash || !isWritable(uri) || containsWorkspaceRoot(uri)) return
    const physical = target.kind === 'folder' ? await readPhysicalRoots() : undefined
    await verifyTreePath(uri, target.kind === 'file' ? vscode.FileType.File : vscode.FileType.Directory)
    if (containsWorkspaceRoot(uri, physical)) return
    const hasChanges = (doc: { isDirty: boolean; uri: vscode.Uri }): boolean => doc.isDirty && contains(uri, doc.uri)
    const dirty = vscode.workspace.textDocuments.some(hasChanges) || vscode.workspace.notebookDocuments.some(hasChanges) ||
      vscode.window.tabGroups.all.some(group => group.tabs.some(tab =>
        isFileTab(tab) && tab.isDirty && contains(uri, tab.input.uri)))
    if (dirty) {
      await vscode.window.showWarningMessage(t('workspaceFiles.dirty', { name }))
      return
    }
    await vscode.workspace.fs.delete(uri, { useTrash: true, recursive: target.kind === 'folder' })
    this.invalidate(uri)
    this.scheduleRefresh()
  }
}
