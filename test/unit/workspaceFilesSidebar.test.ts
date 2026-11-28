import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({
  readDirectory: vi.fn(), stat: vi.fn(), realpath: vi.fn(), createDirectory: vi.fn(), remove: vi.fn(),
  applyEdit: vi.fn(), createFile: vi.fn(), renameFile: vi.fn(), open: vi.fn(),
  showInputBox: vi.fn(), showQuickPick: vi.fn(), warn: vi.fn(), error: vi.fn(),
  textDocuments: [] as Array<{ uri: unknown; isDirty: boolean }>,
  notebookDocuments: [] as Array<{ uri: unknown; isDirty: boolean }>,
  watchCreate: vi.fn(), watchDelete: vi.fn(),
  mediaProvider: vi.fn(), readFile: vi.fn(),
  extraRoots: [] as string[],
  extraRootAuthorities: new Map<string, string>(),
  rootScheme: 'file',
  rootAuthority: '',
  remoteName: undefined as string | undefined,
  filesEnableTrash: true,
  tabGroups: [] as unknown[],
  showNotebook: vi.fn(), closeTab: vi.fn(),
}))

vi.mock('node:fs/promises', async (original) => ({
  ...await original<typeof import('node:fs/promises')>(),
  realpath: mock.realpath,
}))

vi.mock('vscode', async () => {
  const path = (await import('node:path')).posix
  const uri = (path: string, scheme = 'file', authority = scheme === mock.rootScheme ? mock.rootAuthority : '') =>
    ({ path, fsPath: path, scheme, authority, toString: () => `${scheme}://${authority}${path}` })
  const disposable = () => ({ dispose() {} })
  class FileSystemError extends Error {
    readonly code: string
    constructor(code: string) { super(code); this.code = code }
    static Unavailable() { return new FileSystemError('Unavailable') }
    static FileNotFound() { return new FileSystemError('FileNotFound') }
  }
  const folders = () => ['/notes', ...mock.extraRoots].map((path, index) => ({
    name: path.slice(1), uri: uri(path, mock.rootScheme, mock.extraRootAuthorities.get(path)), index,
  }))
  return {
    Uri: {
      file: uri,
      from: (value: { path: string; scheme: string }) => uri(value.path, value.scheme),
      joinPath: (base: { path: string; scheme: string; authority: string }, ...parts: string[]) =>
        uri(path.join(base.path, ...parts), base.scheme, base.authority),
    },
    FileSystemError,
    FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
    ExtensionKind: { UI: 1, Workspace: 2 },
    env: { get remoteName() { return mock.remoteName } },
    Disposable: { from: disposable },
    EventEmitter: class { event = disposable; dispose() {} },
    WorkspaceEdit: class { createFile = mock.createFile; renameFile = mock.renameFile },
    TabInputText: class {},
    TabInputCustom: class { constructor(readonly uri: unknown, readonly viewType: string) {} },
    TabInputNotebook: class { constructor(readonly uri: unknown, readonly notebookType: string) {} },
    workspace: {
      get workspaceFolders() { return folders() },
      getWorkspaceFolder: ({ path, scheme, authority }: { path: string; scheme: string; authority: string }) => folders().reverse().find(folder =>
        scheme === folder.uri.scheme && authority === folder.uri.authority &&
        (path === folder.uri.path || path.startsWith(`${folder.uri.path}/`))),
      getConfiguration: (section?: string) => ({ get: (key: string, fallback?: unknown) =>
        (section ? `${section}.${key}` : key) === 'files.enableTrash' ? mock.filesEnableTrash : fallback }),
      asRelativePath: ({ path }: { path: string }) => path.replace('/notes/', ''),
      fs: { readDirectory: mock.readDirectory, stat: mock.stat, createDirectory: mock.createDirectory, delete: mock.remove,
        readFile: mock.readFile,
        isWritableFileSystem: (scheme: string) => scheme === mock.rootScheme },
      applyEdit: mock.applyEdit,
      textDocuments: mock.textDocuments,
      notebookDocuments: mock.notebookDocuments,
      onDidChangeWorkspaceFolders: disposable,
      registerFileSystemProvider: mock.mediaProvider,
      createFileSystemWatcher: () => ({ ...disposable(), onDidCreate: mock.watchCreate, onDidDelete: mock.watchDelete }),
    },
    window: {
      tabGroups: { all: mock.tabGroups, onDidChangeTabGroups: disposable, onDidChangeTabs: disposable, close: mock.closeTab },
      showNotebookDocument: mock.showNotebook,
      showInputBox: mock.showInputBox, showQuickPick: mock.showQuickPick,
      showWarningMessage: mock.warn, showErrorMessage: mock.error,
    },
    commands: { executeCommand: mock.open },
  }
})

import * as vscode from 'vscode'
import { WorkspaceFilesSidebar } from '../../src/host/workspaceFilesSidebar'
import { previewSourceImagePaths } from '../../src/host/previewSourceImages'
import type { HostToWebview, WorkspaceFilesSnapshot } from '../../src/shared/protocol'
import { isHostToWebview, isWebviewToHost } from '../../src/shared/protocol'

const files = new Map<string, number>()
const fileType = vscode.FileType.File
const dirType = vscode.FileType.Directory
const makeUri = vscode.Uri.file
const matchingUri = (path: string) => expect.objectContaining({ path, scheme: 'file' })
const initial: { open: boolean; layout?: unknown } = { open: false }
const update = vi.fn()
const makeSidebar = (hostKind = vscode.ExtensionKind.UI) => new WorkspaceFilesSidebar(
  { get: (key: string) => key === 'vsidian.workspaceFiles.open' ? initial.open : initial.layout, update } as unknown as vscode.Memento, hostKind,
)
let sidebar: WorkspaceFilesSidebar
let created: (uri: vscode.Uri) => void
let deleted: (uri: vscode.Uri) => void

beforeEach(() => {
  vi.resetAllMocks()
  mock.textDocuments.length = 0
  mock.notebookDocuments.length = 0
  mock.extraRoots.length = 0
  mock.extraRootAuthorities.clear()
  mock.rootScheme = 'file'
  mock.rootAuthority = ''
  mock.remoteName = undefined
  mock.filesEnableTrash = true
  mock.tabGroups.length = 0
  files.clear()
  for (const [path, type] of Object.entries({ '/notes': dirType, '/notes/start.md': fileType,
    '/notes/drafts': dirType, '/notes/drafts/old.md': fileType, '/notes/escape': dirType | vscode.FileType.SymbolicLink,
    '/notes/.git': dirType })) files.set(path, type)
  mock.stat.mockImplementation(async (uri: vscode.Uri) => {
    const type = files.get(uri.path)
    if (type === undefined) throw vscode.FileSystemError.FileNotFound(uri)
    return { type }
  })
  mock.realpath.mockImplementation(async (path: string) => path)
  mock.readDirectory.mockImplementation(async (uri: vscode.Uri) => {
    const prefix = `${uri.path}/`
    return [...files].flatMap(([path, type]) => {
      const name = path.slice(prefix.length)
      return path.startsWith(prefix) && !name.includes('/') ? [[name, type]] : []
    })
  })
  mock.watchCreate.mockImplementation(callback => { created = callback })
  mock.watchDelete.mockImplementation(callback => { deleted = callback })
  mock.applyEdit.mockResolvedValue(true)
  initial.open = false
  initial.layout = undefined
  update.mockReset()
  sidebar = makeSidebar()
})

afterEach(() => { sidebar.dispose() })

function mount(document: string | vscode.Uri = '/notes/start.md') {
  let snapshot: WorkspaceFilesSnapshot | undefined
  let layout: Extract<HostToWebview, { kind: 'workspaceFiles.layout' }>['layout'] | undefined
  let active = true
  let column = 2
  const panel = {
    get active() { return active }, visible: true, get viewColumn() { return column },
    webview: { postMessage: (message: HostToWebview) => {
      if (message.kind === 'workspaceFiles.snapshot') snapshot = message
      if (message.kind === 'workspaceFiles.layout') layout = message.layout
    } },
  } as unknown as vscode.WebviewPanel
  const client = sidebar.attach(typeof document === 'string' ? makeUri(document) : document, panel)
  client.ready()
  async function loaded() {
    return vi.waitFor(() => {
      expect(snapshot).toMatchObject({ open: true, loading: false })
      return snapshot!
    })
  }
  return { ...client, loaded, snapshot: () => snapshot, layout: () => layout, setActive: (value: boolean) => { active = value },
    setColumn: (value: number) => { column = value },
    id: async (name: string) => (await loaded()).entries.find(entry => entry.name === name)!.id }
}

it('记住两个独立尺寸；提交只刷新布局，新面板及新宿主读回同一工作区状态', async () => {
  initial.open = true
  initial.layout = { width: 330, openedHeight: null }
  update.mockImplementation((key, value) => { if (key === 'vsidian.workspaceFiles.layout') initial.layout = value })
  sidebar = makeSidebar()
  const client = mount()
  const before = await client.loaded()
  expect(client.layout()).toEqual({ width: 330, openedHeight: null })
  client.request({ kind: 'workspaceFiles.resize', dimension: 'openedHeight', value: 126 })
  client.request({ kind: 'workspaceFiles.resize', dimension: 'width', value: 412 })
  expect(client.layout()).toEqual({ width: 412, openedHeight: 126 })
  expect(client.snapshot()).toBe(before)
  expect(mock.readDirectory).toHaveBeenCalledTimes(1)
  const loadedLater = mount('/notes/drafts/old.md')
  expect(loadedLater.layout()).toEqual({ width: 412, openedHeight: 126 })
  client.request({ kind: 'workspaceFiles.resize', dimension: 'openedHeight', value: null })
  expect(loadedLater.layout()).toEqual({ width: 412, openedHeight: null })
  sidebar.dispose()
  sidebar = makeSidebar()
  expect(mount().layout()).toEqual({ width: 412, openedHeight: null })
})

it('移动只用快照 ID，走 VS Code 文件重命名且展开落点，可再移回工作区根', async () => {
  const client = mount()
  client.request({ kind: 'workspaceFiles.toggle' })
  const startId = await client.id('start.md')
  const root = await client.id('notes')
  const drafts = await client.id('drafts')
  mock.renameFile.mockImplementation((from, to) => {
    files.delete(from.path)
    files.set(to.path, fileType)
  })

  client.request({ kind: 'workspaceFiles.move', id: startId, directoryId: drafts })
  await vi.waitFor(() => expect(client.snapshot()?.entries.find(row => row.name === 'start.md')).toMatchObject({ level: 2 }))
  expect(mock.renameFile).toHaveBeenCalledWith(matchingUri('/notes/start.md'), matchingUri('/notes/drafts/start.md'), { overwrite: false })
  expect(mock.applyEdit).toHaveBeenCalledTimes(1)
  const moved = await client.id('start.md')
  expect(moved).not.toBe(startId)
  client.request({ kind: 'workspaceFiles.move', id: moved, directoryId: root })
  await vi.waitFor(() => expect(client.snapshot()?.entries.find(row => row.name === 'start.md')).toMatchObject({ level: 1 }))
  expect(mock.renameFile).toHaveBeenLastCalledWith(matchingUri('/notes/drafts/start.md'), matchingUri('/notes/start.md'), { overwrite: false })
  expect(mock.open).not.toHaveBeenCalled()
})

it.each(['同名目标', '目标变成符号链接', '查重时目标变成符号链接'])('拖放遇到%s时不应用文件改动', async conflict => {
  const client = mount()
  client.request({ kind: 'workspaceFiles.toggle' })
  const id = await client.id('start.md')
  const directoryId = await client.id('drafts')
  if (conflict === '同名目标') files.set('/notes/drafts/start.md', fileType)
  else if (conflict === '目标变成符号链接') files.set('/notes/drafts', dirType | vscode.FileType.SymbolicLink)
  else {
    const stat = mock.stat.getMockImplementation()!
    mock.stat.mockImplementation(async (uri: vscode.Uri) => {
      if (uri.path === '/notes/drafts/start.md') files.set('/notes/drafts', dirType | vscode.FileType.SymbolicLink)
      return stat(uri)
    })
  }
  client.request({ kind: 'workspaceFiles.move', id, directoryId })
  await vi.waitFor(() => expect(mock.error).toHaveBeenCalledTimes(1))
  expect(mock.renameFile).not.toHaveBeenCalled()
  expect(files.get('/notes/start.md')).toBe(fileType)
})

it('拖放不接受目录源、文件目的地、原目录或不在本面板快照中的 ID', async () => {
  const client = mount()
  client.request({ kind: 'workspaceFiles.toggle' })
  const id = await client.id('start.md')
  const dir = await client.id('drafts')
  const root = await client.id('notes')
  mock.stat.mockClear()
  for (const [from, to] of [[dir, root], [id, id], [id, root], [id, '/notes/drafts'], ['/notes/start.md', dir]]) {
    client.request({ kind: 'workspaceFiles.move', id: from!, directoryId: to! })
    await Promise.resolve()
    await Promise.resolve()
  }
  expect(mock.renameFile).not.toHaveBeenCalled()
  expect(mock.stat).not.toHaveBeenCalled()
})

it('快照区分移动范围，并把同一目录的多根视图映射到同一个落点身份', async () => {
  mock.extraRoots.push('/notes/drafts', '/share')
  mock.extraRootAuthorities.set('/share', 'server')
  files.set('/share', dirType)
  const client = mount('/notes/drafts/old.md')
  client.request({ kind: 'workspaceFiles.toggle' })
  const rows = (await client.loaded()).entries
  const source = rows.find(row => row.name === 'old.md')!
  const destination = rows.find(row => row.name === 'share')!
  expect(source.move).toEqual(rows.find(row => row.kind === 'root' && row.name === 'notes/drafts')?.move)
  expect(source.move?.scope).not.toBe(destination.move?.scope)
  expect(destination.move?.scope).toBe('file://server')
  mock.stat.mockClear()
  client.request({ kind: 'workspaceFiles.move', id: source.id, directoryId: destination.id })
  expect(mock.stat).not.toHaveBeenCalled()
  expect(mock.renameFile).not.toHaveBeenCalled()
})

it('已打开列表取 VS Code 的临时状态，中键和关闭按钮命中当前组的实时标签', async () => {
  const input = new vscode.TabInputCustom(makeUri('/notes/start.md'), 'vsidian')
  const preview = { input, label: 'start.md', isPreview: true, isActive: true, isDirty: false }
  const group = { viewColumn: 2, tabs: [preview] }
  mock.tabGroups.push({ viewColumn: 1, tabs: [{ ...preview }] }, group)
  const client = mount()
  client.request({ kind: 'workspaceFiles.toggle' })
  const [tab] = (await client.loaded()).tabs
  expect(tab).toMatchObject({ name: 'start.md', isPreview: true })
  client.request({ kind: 'workspaceFiles.activate', id: tab!.id, mode: 'keep' })
  await vi.waitFor(() => expect(mock.open).toHaveBeenCalledExactlyOnceWith(
    'vscode.openWith', input.uri, input.viewType, { viewColumn: 2, preview: false },
  ))
  await new Promise<void>(resolve => setImmediate(resolve))
  const latest = { ...preview, isPreview: false, isDirty: true }
  group.tabs = [latest] // VS Code 可在标签变化时重建 Tab。
  mock.closeTab.mockResolvedValue(false) // 取消保存确认，仍保留标签。
  client.request({ kind: 'workspaceFiles.closeTab', id: tab!.id })
  await vi.waitFor(() => expect(mock.closeTab).toHaveBeenCalledTimes(1))
  expect(mock.closeTab.mock.calls[0]![0]).toBe(latest)
  client.request({ kind: 'workspaceFiles.closeTab', id: await client.id('start.md') })
  expect(mock.closeTab).toHaveBeenCalledTimes(1)
})

it('首次加载目录期间，已经显示的标签可以预览和关闭', async () => {
  let finish!: (rows: [string, vscode.FileType][]) => void
  mock.readDirectory.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const input = new vscode.TabInputCustom(makeUri('/notes/start.md'), 'vsidian')
  const tab = { input, label: 'start.md', isActive: true }
  mock.tabGroups.push({ viewColumn: 2, tabs: [tab] })
  const client = mount()
  client.request({ kind: 'workspaceFiles.toggle' })
  try {
    expect(client.snapshot()?.loading).toBe(true)
    const id = client.snapshot()!.tabs[0]!.id
    expect(await client.previewTarget(id)).toBe('/notes/start.md')
    client.request({ kind: 'workspaceFiles.closeTab', id })
    expect(mock.closeTab).toHaveBeenCalledWith(tab, false)
  } finally {
    finish?.([['start.md', fileType]])
  }
})

it('换组期间或新组快照已更新后，旧行都不能关闭新组同 URI 的标签', async () => {
  const original = { label: 'start.md', isPreview: true, input: new vscode.TabInputCustom(makeUri('/notes/start.md'), 'vsidian') }
  const sameFile = { ...original, isPreview: false }
  mock.tabGroups.push({ viewColumn: 2, tabs: [original] }, { viewColumn: 1, tabs: [sameFile] })
  const client = mount()
  client.request({ kind: 'workspaceFiles.toggle' })
  const fromOldGroup = (await client.loaded()).tabs[0]!.id
  client.setColumn(1)
  client.request({ kind: 'workspaceFiles.closeTab', id: fromOldGroup })
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(mock.closeTab).not.toHaveBeenCalled()

  client.viewChanged()
  const fromNewGroup = await vi.waitFor(() => {
    const latest = client.snapshot()!.tabs[0]!
    expect(latest.id).not.toBe(fromOldGroup)
    return latest.id
  })
  client.request({ kind: 'workspaceFiles.closeTab', id: fromOldGroup })
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(mock.closeTab).not.toHaveBeenCalled()
  client.request({ kind: 'workspaceFiles.closeTab', id: fromNewGroup })
  expect(mock.closeTab.mock.calls[0]![0]).toBe(sameFile)
})

it('新文件以请求指定的临时或保留方式打开；已有持久标签单击不降级', async () => {
  const client = mount()
  client.request({ kind: 'workspaceFiles.toggle' })
  const id = await client.id('start.md')
  client.request({ kind: 'workspaceFiles.activate', id, mode: 'preview' })
  await vi.waitFor(() => expect(mock.open).toHaveBeenCalledExactlyOnceWith(
    'vscode.open', matchingUri('/notes/start.md'), { viewColumn: 2, preview: true },
  ))
  client.request({ kind: 'workspaceFiles.activate', id, mode: 'keep' })
  await vi.waitFor(() => expect(mock.open).toHaveBeenLastCalledWith(
    'vscode.open', matchingUri('/notes/start.md'), { viewColumn: 2, preview: false },
  ))
  const uri = makeUri('/notes/start.md')
  mock.tabGroups.push({ viewColumn: 2, tabs: [{
    input: new vscode.TabInputCustom(uri, 'vsidian'), isPreview: false, isActive: false,
  }] })
  client.request({ kind: 'workspaceFiles.activate', id, mode: 'preview' })
  await vi.waitFor(() => expect(mock.open).toHaveBeenLastCalledWith(
    'vscode.openWith', uri, 'vsidian', { viewColumn: 2, preview: false },
  ))
})

it('协议只接受有界尺寸、完整条目身份与已定义的打开方式', () => {
  expect(isWebviewToHost({ kind: 'workspaceFiles.move', id: 'file', directoryId: 'folder' })).toBe(true)
  expect(isWebviewToHost({ kind: 'workspaceFiles.move', id: 'file', directoryId: '' })).toBe(false)
  expect(isWebviewToHost({ kind: 'workspaceFiles.move', id: 'file', uri: '/folder' })).toBe(false)
  expect(isWebviewToHost({ kind: 'workspaceFiles.resize', dimension: 'width', value: 360 })).toBe(true)
  expect(isWebviewToHost({ kind: 'workspaceFiles.resize', dimension: 'width', value: null })).toBe(false)
  expect(isWebviewToHost({ kind: 'workspaceFiles.resize', dimension: 'openedHeight', value: Infinity })).toBe(false)
  expect(isHostToWebview({ kind: 'workspaceFiles.layout', layout: { width: 280, openedHeight: null } })).toBe(true)
  expect(isHostToWebview({ kind: 'workspaceFiles.layout', layout: { width: 1000, openedHeight: 64 } })).toBe(false)
  expect(isWebviewToHost({ kind: 'workspaceFiles.activate', id: 'file', mode: 'preview', expanded: true })).toBe(false)
  expect(isWebviewToHost({ kind: 'workspaceFiles.activate', id: 'file', mode: 'other' })).toBe(false)
  expect(isWebviewToHost({ kind: 'workspaceFiles.closeTab', id: '' })).toBe(false)
})

it('关闭时不读盘；仅加载展开目录，显示当前文件并响应目录增量', async () => {
  const client = mount()
  expect(mock.readDirectory).not.toHaveBeenCalled()
  expect(client.snapshot()?.open).toBe(false)
  client.request({ kind: 'workspaceFiles.toggle' })
  expect((await client.loaded()).entries.map(row => [row.name, row.kind])).toEqual([
    ['notes', 'root'], ['drafts', 'folder'], ['start.md', 'file'],
  ])
  expect(client.snapshot()?.entries.find(row => row.name === 'start.md')?.current).toBe(true)
  expect(mock.readDirectory.mock.calls.map(([uri]) => uri.path)).toEqual(['/notes'])
  client.request({ kind: 'workspaceFiles.activate', id: await client.id('drafts') })
  await vi.waitFor(() => expect(client.snapshot()?.entries.map(row => row.name)).toContain('old.md'))
  files.set('/notes/drafts/new.md', fileType)
  created(makeUri('/notes/drafts/new.md'))
  await vi.waitFor(() => expect(client.snapshot()?.entries.map(row => row.name)).toContain('new.md'))
  expect(update).toHaveBeenCalledWith('vsidian.workspaceFiles.open', true)
  const next = mount('/notes/drafts/new.md')
  expect((await next.loaded()).entries.find(row => row.name === 'new.md')?.current).toBe(true)
})

it('手动刷新重新读取已展开的目录，不依赖文件监视事件', async () => {
  const client = mount('/notes/drafts/old.md')
  client.request({ kind: 'workspaceFiles.toggle' })
  expect((await client.loaded()).entries.some(row => row.name === 'old.md')).toBe(true)
  files.delete('/notes/drafts/old.md')
  files.set('/notes/drafts/updated.md', fileType)
  files.set('/notes/root-new.md', fileType)

  client.request({ kind: 'workspaceFiles.refresh' })
  await vi.waitFor(() => expect(client.snapshot()?.entries.map(row => row.name)).toEqual([
    'notes', 'drafts', 'updated.md', 'root-new.md', 'start.md',
  ]))
  expect(client.snapshot()?.entries.find(row => row.name === 'drafts')?.expanded).toBe(true)
})

it('文件预览按面板当前快照授权，仅文件条目可读取', async () => {
  files.set('/notes/map #.png', fileType)
  const client = mount('/notes/drafts/old.md')
  client.request({ kind: 'workspaceFiles.toggle' })
  const old = await client.id('old.md')
  const image = await client.id('map #.png')
  expect(await client.previewTarget(old)).toBe('/notes/drafts/old.md')
  expect(await client.previewTarget(await client.id('drafts'))).toBeUndefined()
  expect(await client.previewTarget('/notes/map #.png')).toBeUndefined()
  expect(client.previewMedia(old)).toBeUndefined()
  expect(client.previewMedia(image)).toMatchObject({ scheme: 'vsidian-file-preview' })
  client.request({ kind: 'workspaceFiles.collapseAll' })
  await vi.waitFor(async () => expect(await client.previewTarget(old)).toBeUndefined())
  expect(await client.previewTarget(image)).toBe('/notes/map #.png')
  client.request({ kind: 'workspaceFiles.toggle' })
  expect(client.previewMedia(image)).toBeUndefined()
})

it('文件预览消息只接受条目身份，拒绝混用带任意路径的形态', () => {
  const request = { kind: 'hover.request', sessionId: 'parent', docUri: 'file:///notes/start.md',
    reqId: 1, instanceId: 'hover-1', sourceStart: 0, sourceEnd: 0, target: 'start.md', workspaceFileId: 'known-row' }
  expect(isWebviewToHost(request)).toBe(true)
  expect(isWebviewToHost({ ...request, workspaceFileId: '' })).toBe(false)
  expect(isWebviewToHost({ ...request, directTarget: { fsPath: '/outside/else.md' } })).toBe(false)
  expect(isWebviewToHost({ ...request, linkHref: 'https://example.com' })).toBe(false)
  expect(isWebviewToHost({ ...request, source: { parentInstanceId: 'parent', sourceDocUri: '/a.md' } })).toBe(false)
  expect(isWebviewToHost({ ...request, addonSource: { instanceId: 'main', sourceFsPath: '' } })).toBe(false)
})

it('目录在快照发出后变成符号链接时，拒绝读取旧文件条目', async () => {
  const client = mount('/notes/drafts/old.md')
  client.request({ kind: 'workspaceFiles.toggle' })
  const id = await client.id('old.md')
  files.set('/notes/drafts', dirType | vscode.FileType.SymbolicLink)
  expect(await client.previewTarget(id)).toBeUndefined()
})

it('等待回收站确认期间目录改为符号链接时，不操作旧条目下的文件', async () => {
  const client = mount('/notes/drafts/old.md')
  client.request({ kind: 'workspaceFiles.toggle' })
  const id = await client.id('old.md')
  mock.showQuickPick.mockImplementation(items => Promise.resolve(items.find((item: { label: string }) => item.label === 'workspaceFiles.trash')))
  mock.warn.mockImplementationOnce(async () => {
    files.set('/notes/drafts', dirType | vscode.FileType.SymbolicLink)
    return 'workspaceFiles.trash'
  })
  client.request({ kind: 'workspaceFiles.manage', id })
  await vi.waitFor(() => expect(mock.error).toHaveBeenCalledTimes(1))
  expect(mock.remove).not.toHaveBeenCalled()
})

it.runIf(process.platform === 'win32' || process.platform === 'darwin')('大小写异写的嵌套工作区根不能改名或入回收站', async () => {
  mock.extraRoots.push('/notes/DrAfTs')
  files.set('/notes/DrAfTs', dirType)
  const client = mount()
  client.request({ kind: 'workspaceFiles.toggle' })
  const id = (await client.loaded()).entries.find(row => row.name === 'drafts' && row.kind === 'folder')!.id
  client.request({ kind: 'workspaceFiles.manage', id })
  await vi.waitFor(() => expect(mock.showQuickPick).toHaveBeenCalledTimes(1))
  expect(mock.showQuickPick.mock.calls[0]![0].map((item: { label: string }) => item.label))
    .toEqual(['workspaceFiles.createFile', 'workspaceFiles.createFolder'])
})

it('包含已挂载工作区根的父目录只能新建，路径前缀相同的兄弟目录不受限', async () => {
  const nestedRoot = '/notes/drafts/project'
  mock.extraRoots.push(nestedRoot)
  files.set(nestedRoot, dirType)
  files.set('/notes/drafts-archive', dirType)
  const client = mount()
  client.request({ kind: 'workspaceFiles.toggle' })

  mock.showQuickPick.mockImplementationOnce(items => items.find((item: { label: string }) => item.label === 'workspaceFiles.createFolder'))
  mock.showInputBox.mockResolvedValueOnce('assets')
  client.request({ kind: 'workspaceFiles.manage', id: await client.id('drafts') })
  await vi.waitFor(() => expect(mock.createDirectory).toHaveBeenCalledWith(matchingUri('/notes/drafts/assets')))
  expect(mock.showQuickPick.mock.calls[0]![0].map((item: { label: string }) => item.label))
    .toEqual(['workspaceFiles.createFile', 'workspaceFiles.createFolder'])

  client.request({ kind: 'workspaceFiles.manage', id: await client.id('drafts-archive') })
  await vi.waitFor(() => expect(mock.showQuickPick).toHaveBeenCalledTimes(2))
  expect(mock.showQuickPick.mock.calls[1]![0].map((item: { label: string }) => item.label))
    .toEqual(['workspaceFiles.createFile', 'workspaceFiles.createFolder', 'workspaceFiles.rename', 'workspaceFiles.trash'])
})

it('通过链接挂载的根也保护真实父目录，其他目录仍可管理', async () => {
  mock.extraRoots.push('/project-link')
  files.set('/project-link', dirType | vscode.FileType.SymbolicLink)
  files.set('/notes/drafts/project', dirType)
  files.set('/notes/drafts-archive', dirType)
  mock.realpath.mockImplementation(async path => path === '/project-link' ? '/notes/drafts/project' : path)
  const client = mount()
  client.request({ kind: 'workspaceFiles.toggle' })
  const rows = (await client.loaded()).entries
  expect(rows.find(row => row.name === 'drafts')?.actions).toEqual(['createFile', 'createFolder'])
  expect(rows.find(row => row.name === 'drafts-archive')?.actions).toEqual(['createFile', 'createFolder', 'rename', 'trash'])
})

it.each(['ENOENT', 'ENOTDIR', 'EACCES'])('另一个挂载根返回 %s 时区分已缺失与不可复核', async code => {
  mock.extraRoots.push('/unavailable')
  mock.realpath.mockImplementation(async path => {
    if (path === '/unavailable') throw Object.assign(new Error(code), { code })
    return path
  })
  const client = mount()
  client.request({ kind: 'workspaceFiles.toggle' })
  await vi.waitFor(() => {
    const row = client.snapshot()?.entries.find(entry => entry.name === 'drafts')
    expect(row?.actions).toEqual(code === 'EACCES' ? ['createFile', 'createFolder'] : ['createFile', 'createFolder', 'rename', 'trash'])
  })
})

it('折叠的慢根只暂缓目录重命名和回收，不阻塞浏览或新建', async () => {
  mock.extraRoots.push('/slow')
  files.set('/slow', dirType)
  let finish!: (path: string) => void
  mock.realpath.mockImplementation(async path => path === '/slow' ? new Promise(resolve => { finish = resolve }) : path)
  const client = mount()
  client.request({ kind: 'workspaceFiles.toggle' })
  try {
    const rows = (await client.loaded()).entries
    const drafts = rows.find(row => row.name === 'drafts')!
    expect(rows.some(row => row.name === 'start.md')).toBe(true)
    expect(drafts.actions).toEqual(['createFile', 'createFolder'])
    client.request({ kind: 'workspaceFiles.manage', id: drafts.id })
    await vi.waitFor(() => expect(mock.showQuickPick).toHaveBeenCalledTimes(1))
  } finally {
    finish('/slow')
  }
  await vi.waitFor(() => expect(client.snapshot()?.entries.find(row => row.name === 'drafts')?.actions)
    .toEqual(['createFile', 'createFolder', 'rename', 'trash']))
})

it('链接根的目标从缺失到恢复再移出时，按文件事件更新父目录动作', async () => {
  const project = '/notes/drafts/project'
  mock.extraRoots.push('/project-link')
  mock.realpath.mockImplementation(async path => {
    if (path !== '/project-link') return path
    if (!files.has(project)) throw Object.assign(new Error('not found'), { code: 'ENOENT' })
    return project
  })
  const client = mount()
  client.request({ kind: 'workspaceFiles.toggle' })
  const actions = () => client.snapshot()?.entries.find(row => row.name === 'drafts')?.actions
  await vi.waitFor(() => expect(actions()).toContain('rename'))
  // drafts 仍折叠，物理根状态的变化与是否加载过这个目录的列表无关。
  files.set(project, dirType)
  created(makeUri(project))
  await vi.waitFor(() => expect(actions()).toEqual(['createFile', 'createFolder']))
  files.delete(project)
  deleted(makeUri(project))
  await vi.waitFor(() => expect(actions()).toEqual(['createFile', 'createFolder', 'rename', 'trash']))
})

it.each(['rename', 'trash'] as const)('等待 %s 确认时挂载链接根，不能移走它的真实父目录', async action => {
  files.set('/notes/drafts/project', dirType)
  files.set('/project-link', dirType | vscode.FileType.SymbolicLink)
  mock.realpath.mockImplementation(async path => path === '/project-link' ? '/notes/drafts/project' : path)
  const client = mount()
  client.request({ kind: 'workspaceFiles.toggle' })
  const id = await client.id('drafts')
  const prompt = action === 'rename' ? mock.showInputBox : mock.warn
  prompt.mockImplementationOnce(async () => {
    mock.extraRoots.push('/project-link')
    return action === 'rename' ? 'renamed-drafts' : 'workspaceFiles.trash'
  })
  client.request({ kind: 'workspaceFiles.action', action, id })
  await vi.waitFor(() => expect(prompt).toHaveBeenCalledTimes(1))
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(mock.renameFile).not.toHaveBeenCalled()
  expect(mock.remove).not.toHaveBeenCalled()
})

it.each([
  { action: 'rename', phase: '对话', prompt: mock.showInputBox, answer: 'renamed' },
  { action: 'trash', phase: '对话', prompt: mock.warn, answer: 'workspaceFiles.trash' },
  { action: 'rename', phase: '路径复核', prompt: mock.showInputBox, answer: 'renamed' },
  { action: 'trash', phase: '路径复核', prompt: mock.warn, answer: 'workspaceFiles.trash' },
])('$action 在 $phase 期间挂载子工作区根时，不移动父目录', async ({ action, phase, prompt, answer }) => {
  const nestedRoot = '/notes/drafts/project'
  files.set(nestedRoot, dirType)
  const client = mount()
  client.request({ kind: 'workspaceFiles.toggle' })
  const id = await client.id('drafts')
  const mountNestedRoot = vi.fn(() => mock.extraRoots.push(nestedRoot))

  mock.showQuickPick.mockImplementationOnce(items => items.find((item: { label: string }) => item.label === `workspaceFiles.${action}`))
  prompt.mockImplementationOnce(async () => {
    if (phase === '对话') mountNestedRoot()
    return answer
  })
  if (phase === '路径复核') {
    const stat = mock.stat.getMockImplementation()!
    mock.stat.mockImplementation(async (uri: vscode.Uri) => {
      const result = await stat(uri)
      if (uri.path === '/notes/drafts') mountNestedRoot()
      return result
    })
  }
  client.request({ kind: 'workspaceFiles.manage', id })
  await vi.waitFor(() => expect(mountNestedRoot).toHaveBeenCalledTimes(1))
  expect(mock.renameFile).not.toHaveBeenCalled()
  expect(mock.applyEdit).not.toHaveBeenCalled()
  expect(mock.remove).not.toHaveBeenCalled()
})

it('来源图片别名单文件读取；重定向的路径和非图片不获授权', async () => {
  const client = mount('/notes/drafts/old.md')
  client.request({ kind: 'workspaceFiles.toggle' })
  const owner = await client.id('old.md')
  const uri = makeUri('/notes/drafts/src.png')
  const source = makeUri('/notes/drafts/old.md')
  const active = () => true
  files.set('/notes/drafts/src.png', fileType)
  expect(client.previewSourceAsset(owner, makeUri('/notes/drafts/old.md'), source, active)).toBeUndefined()
  expect(client.previewSourceAsset(owner, makeUri('/outside/sibling.png'), source, active)).toBeUndefined()
  const alias = client.previewSourceAsset(owner, uri, source, active)!
  sidebar.registerMediaResources()
  const provider = mock.mediaProvider.mock.calls[0]![1] as vscode.FileSystemProvider
  mock.readFile.mockResolvedValueOnce(Uint8Array.of(1))
  expect(await provider.readFile(alias)).toEqual(Uint8Array.of(1))
  expect(mock.readFile).toHaveBeenCalledExactlyOnceWith(uri)
  files.set('/notes/drafts', dirType | vscode.FileType.SymbolicLink)
  await expect(provider.readFile(alias)).rejects.toThrow()
  expect(mock.readFile).toHaveBeenCalledTimes(1)
})

it('来源资源须仍有租约并位于当前来源根', async () => {
  const client = mount()
  client.request({ kind: 'workspaceFiles.toggle' })
  const owner = await client.id('start.md')
  mock.extraRoots.push('/another')
  files.set('/another', dirType)
  files.set('/another/drawing.png', fileType)
  let alive = true
  const alias = client.previewSourceAsset(owner, makeUri('/another/drawing.png'),
    makeUri('/another/sub/note.md'), () => alive)!
  sidebar.registerMediaResources()
  const provider = mock.mediaProvider.mock.calls[0]![1] as vscode.FileSystemProvider
  expect(await provider.stat(alias)).toMatchObject({ type: fileType })
  alive = false
  await expect(provider.stat(alias)).rejects.toMatchObject({ code: 'FileNotFound' })
  alive = true
  mock.extraRoots.pop()
  await expect(provider.stat(alias)).rejects.toMatchObject({ code: 'FileNotFound' })
})

it('源码中明确引用的相对图片才有资格取得别名', () => {
  const text = [
    '![相对图片](../shown.png)', '', '![引用型图片][ref]', '', '[ref]: photo.png',
    '', '<img src="native.png" srcset="native.png 1x, large.png 2x">', '',
    '![外站](https://example.com/foreign.png)', '',
    '```md', '![代码示例](not-drawn.png)', '```',
  ].join('\n')
  expect(previewSourceImagePaths(text, '/notes/sub/note.md',
    { rootDir: '/notes', docDir: '/notes/sub', isWindowsHost: false })).toEqual(new Set([
    '/notes/shown.png', '/notes/sub/photo.png', '/notes/sub/native.png', '/notes/sub/large.png',
  ]))
})

it('UNC 主机名大小写不同也能保护未保存文档', async () => {
  mock.rootAuthority = 'SERVER'
  const client = mount()
  client.request({ kind: 'workspaceFiles.toggle' })
  const id = await client.id('drafts')
  mock.textDocuments.push({ uri: { ...makeUri('/notes/drafts/old.md'), authority: 'server' }, isDirty: true })
  mock.showQuickPick.mockImplementation(items => Promise.resolve(items.find((item: { label: string }) => item.label === 'workspaceFiles.trash')))
  mock.warn.mockResolvedValue('workspaceFiles.trash')
  client.request({ kind: 'workspaceFiles.manage', id })
  await vi.waitFor(() => expect(mock.warn).toHaveBeenCalledTimes(2))
  expect(mock.remove).not.toHaveBeenCalled()
})

it('折叠所有文件夹保留根目录，并清除子目录的展开状态', async () => {
  files.set('/notes/drafts/reference', dirType)
  files.set('/notes/drafts/reference/paper.md', fileType)
  const client = mount('/notes/drafts/reference/paper.md')
  client.request({ kind: 'workspaceFiles.toggle' })
  expect((await client.loaded()).entries.find(row => row.name === 'paper.md')?.current).toBe(true)

  const drafts = await client.id('drafts')
  client.request({ kind: 'workspaceFiles.collapseAll' })
  await vi.waitFor(() => expect(client.snapshot()?.entries.map(row => [row.name, row.expanded])).toEqual([
    ['notes', true], ['drafts', false], ['start.md', undefined],
  ]))
  client.viewChanged()
  client.request({ kind: 'workspaceFiles.activate', id: drafts })
  await vi.waitFor(() => expect(client.snapshot()?.entries.find(row => row.name === 'reference')?.expanded).toBe(false))
  expect(client.snapshot()?.entries.some(row => row.name === 'paper.md')).toBe(false)
})

it('在当前目录新建文件，名称校验拒绝路径，且不覆盖已有文件', async () => {
  const client = mount('/notes/drafts/old.md')
  client.request({ kind: 'workspaceFiles.toggle' })
  await client.loaded()
  mock.showInputBox.mockImplementationOnce((options: vscode.InputBoxOptions) => {
    expect(options.validateInput?.('../outside.md')).toBe('workspaceFiles.invalidName')
    return Promise.resolve('old.md')
  })
  client.request({ kind: 'workspaceFiles.create', entry: 'file' })
  await vi.waitFor(() => expect(mock.error).toHaveBeenCalledTimes(1))
  expect(mock.applyEdit).not.toHaveBeenCalled()

  mock.showInputBox.mockResolvedValueOnce('新笔记.md')
  client.request({ kind: 'workspaceFiles.create', entry: 'file' })
  await vi.waitFor(() => expect(mock.open).toHaveBeenCalledWith('vscode.open', matchingUri('/notes/drafts/新笔记.md'), {
    preview: false, viewColumn: 2,
  }))
  expect(mock.createFile).toHaveBeenCalledWith(matchingUri('/notes/drafts/新笔记.md'), { overwrite: false })
})

it('折叠目录后栏顶仍在当前笔记的父目录新建', async () => {
  files.set('/notes/drafts/deep', dirType)
  files.set('/notes/drafts/deep/note.md', fileType)
  const client = mount('/notes/drafts/deep/note.md')
  client.request({ kind: 'workspaceFiles.toggle' })
  await client.loaded()
  client.request({ kind: 'workspaceFiles.collapseAll' })
  await vi.waitFor(() => expect(client.snapshot()?.entries.find(row => row.name === 'deep')).toBeUndefined())
  mock.showInputBox.mockResolvedValueOnce('旁边的新文件.md')
  client.request({ kind: 'workspaceFiles.create', entry: 'file' })
  await vi.waitFor(() => expect(mock.createFile).toHaveBeenCalledWith(
    matchingUri('/notes/drafts/deep/旁边的新文件.md'), { overwrite: false },
  ))
})

it('文件型 Notebook 出现在同组标签，并切回已打开的原编辑器模型', async () => {
  const uri = makeUri('/notes/research.ipynb')
  const model = { uri, notebookType: 'jupyter-notebook', isDirty: true }
  mock.notebookDocuments.push(model)
  mock.tabGroups.push({ viewColumn: 2, tabs: [{
    label: 'research.ipynb', isActive: false, isPreview: false, input: new vscode.TabInputNotebook(uri, model.notebookType),
  }] })
  const client = mount()
  client.request({ kind: 'workspaceFiles.toggle' })
  const row = (await client.loaded()).tabs.find(tab => tab.name === 'research.ipynb')!
  expect(row.id.startsWith(`tab:notebook:jupyter-notebook|${uri.toString()}|group:`)).toBe(true)
  client.request({ kind: 'workspaceFiles.activate', id: row.id })
  await vi.waitFor(() => expect(mock.showNotebook).toHaveBeenCalledExactlyOnceWith(model, { viewColumn: 2, preview: false }))
})

it('目录管理能在所选目录新建文件夹；文件改名走宿主 WorkspaceEdit', async () => {
  const client = mount()
  client.request({ kind: 'workspaceFiles.toggle' })
  const folderId = await client.id('drafts')
  mock.showQuickPick.mockImplementationOnce(items => Promise.resolve(items.find((item: { label: string }) => item.label === 'workspaceFiles.createFolder')))
  mock.showInputBox.mockResolvedValueOnce('子目录')
  client.request({ kind: 'workspaceFiles.manage', id: folderId })
  await vi.waitFor(() => expect(mock.createDirectory).toHaveBeenCalledWith(matchingUri('/notes/drafts/子目录')))
  mock.showQuickPick.mockImplementationOnce(items => Promise.resolve(items.find((item: { label: string }) => item.label === 'workspaceFiles.rename')))
  mock.showInputBox.mockResolvedValueOnce('renamed.md')
  client.request({ kind: 'workspaceFiles.manage', id: await client.id('start.md') })
  await vi.waitFor(() => expect(mock.applyEdit).toHaveBeenCalledTimes(1))
  expect(mock.renameFile).toHaveBeenCalledWith(matchingUri('/notes/start.md'), matchingUri('/notes/renamed.md'), { overwrite: false })
})

it('文件树发布行级操作，右键命令用同一宿主流程直接新建于目标目录', async () => {
  const client = mount()
  client.request({ kind: 'workspaceFiles.toggle' })
  const entries = (await client.loaded()).entries
  expect(entries.map(row => [row.kind, row.actions])).toEqual([
    ['root', ['createFile', 'createFolder']],
    ['folder', ['createFile', 'createFolder', 'rename', 'trash']],
    ['file', ['rename', 'trash']],
  ])
  const request = { kind: 'workspaceFiles.action', id: await client.id('drafts'), action: 'createFolder' } as const
  expect(isWebviewToHost(request)).toBe(true)
  expect(isWebviewToHost({ ...request, action: 'delete' })).toBe(false)
  mock.showInputBox.mockResolvedValueOnce('context-created')
  client.request(request)
  await vi.waitFor(() => expect(mock.createDirectory).toHaveBeenCalledExactlyOnceWith(
    matchingUri('/notes/drafts/context-created'),
  ))
  expect(mock.showQuickPick).not.toHaveBeenCalled()
})

it('操作由当前宿主重验；旧菜单不能回收新挂载根的父目录', async () => {
  const client = mount()
  client.request({ kind: 'workspaceFiles.toggle' })
  const folder = (await client.loaded()).entries.find(row => row.name === 'drafts')!
  expect(folder.actions).toContain('trash')
  mock.extraRoots.push('/notes/drafts/project')
  mock.warn.mockResolvedValue('workspaceFiles.trash')
  client.request({ kind: 'workspaceFiles.action', id: folder.id, action: 'trash' })
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(mock.warn).not.toHaveBeenCalled()
  expect(mock.remove).not.toHaveBeenCalled()
})

it('目录读取未返回时，旧菜单的展开动作不会把已展开的目录反转', async () => {
  const client = mount()
  client.request({ kind: 'workspaceFiles.toggle' })
  const id = await client.id('drafts')
  const list = mock.readDirectory.getMockImplementation()!
  let finishRead!: () => void
  const pendingRead = new Promise<void>(resolve => { finishRead = resolve })
  mock.readDirectory.mockImplementation(async (uri: vscode.Uri) => {
    if (uri.path === '/notes/drafts') await pendingRead
    return list(uri)
  })
  client.request({ kind: 'workspaceFiles.activate', id })
  await vi.waitFor(() => expect(mock.readDirectory).toHaveBeenCalledWith(matchingUri('/notes/drafts')))
  expect(client.snapshot()?.entries.find(row => row.id === id)?.expanded).toBe(false)
  client.request({ kind: 'workspaceFiles.activate', id, expanded: true })
  finishRead()
  await vi.waitFor(() => expect(client.snapshot()?.entries.map(row => row.name)).toContain('old.md'))
  expect(client.snapshot()?.entries.find(row => row.id === id)?.expanded).toBe(true)
  expect(isWebviewToHost({ kind: 'workspaceFiles.activate', id, expanded: 'false' })).toBe(false)
})

it('目录入回收站前检查未保存内容，确认后也不退回永久删除', async () => {
  const client = mount()
  client.request({ kind: 'workspaceFiles.toggle' })
  const id = await client.id('drafts')
  mock.showQuickPick.mockImplementation(items => Promise.resolve(items.find((item: { label: string }) => item.label === 'workspaceFiles.trash')))
  mock.warn.mockResolvedValue('workspaceFiles.trash')
  mock.textDocuments.push({ uri: makeUri('/notes/drafts/old.md'), isDirty: true })
  client.request({ kind: 'workspaceFiles.manage', id })
  await vi.waitFor(() => expect(mock.warn).toHaveBeenCalledTimes(2))
  expect(mock.warn.mock.calls[0]).toEqual(['workspaceFiles.trashFolderPrompt', { modal: true }, 'workspaceFiles.trash'])
  expect(mock.remove).not.toHaveBeenCalled()

  mock.textDocuments.length = 0
  mock.notebookDocuments.push({ uri: makeUri('/notes/drafts/research.ipynb'), isDirty: true })
  client.request({ kind: 'workspaceFiles.manage', id })
  await vi.waitFor(() => expect(mock.warn).toHaveBeenCalledTimes(4))
  expect(mock.remove).not.toHaveBeenCalled()

  mock.notebookDocuments.length = 0
  mock.remove.mockRejectedValueOnce(vscode.FileSystemError.Unavailable(makeUri('/notes/drafts')))
  client.request({ kind: 'workspaceFiles.manage', id })
  await vi.waitFor(() => expect(mock.error).toHaveBeenCalledTimes(1))
  expect(mock.remove).toHaveBeenCalledTimes(1)
  expect(mock.remove).toHaveBeenCalledWith(matchingUri('/notes/drafts'), { recursive: true, useTrash: true })
})

it.each([
  { scheme: 'file', hostKind: 'Workspace' },
  { scheme: 'vscode-remote', hostKind: 'UI' },
] as const)('Remote SSH $hostKind 宿主的 $scheme 文件保留改名，不提供回收站', async ({ scheme, hostKind }) => {
  mock.remoteName = 'ssh-remote'
  mock.rootScheme = scheme
  mock.rootAuthority = scheme === 'vscode-remote' ? 'ssh-remote+mock-host' : ''
  sidebar.dispose()
  sidebar = makeSidebar(vscode.ExtensionKind[hostKind])
  const file = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0]!.uri, 'start.md')
  const client = mount(file)
  client.request({ kind: 'workspaceFiles.toggle' })
  const id = await client.id('start.md')

  mock.showQuickPick.mockImplementationOnce((items: vscode.QuickPickItem[]) =>
    items.find(item => item.label === 'workspaceFiles.trash') ?? items.find(item => item.label === 'workspaceFiles.rename'))
  mock.warn.mockResolvedValue('workspaceFiles.trash')
  mock.showInputBox.mockResolvedValueOnce('renamed.md')
  client.request({ kind: 'workspaceFiles.manage', id })
  await vi.waitFor(() => expect(mock.showQuickPick).toHaveBeenCalledTimes(1))
  expect(mock.showQuickPick.mock.calls[0]![0].map((item: { label: string }) => item.label)).toEqual(['workspaceFiles.rename'])
  const targetUri = (path: string) => expect.objectContaining({ scheme, authority: mock.rootAuthority, path })
  await vi.waitFor(() => expect(mock.renameFile).toHaveBeenCalledExactlyOnceWith(
    targetUri('/notes/start.md'), targetUri('/notes/renamed.md'), { overwrite: false },
  ))
  expect(mock.warn).not.toHaveBeenCalled()
  expect(mock.remove).not.toHaveBeenCalled()
})

it('远程窗口的本机宿主仍能将本机文件移入回收站，不采用永久删除设置', async () => {
  mock.remoteName = 'ssh-remote'
  mock.filesEnableTrash = false
  const client = mount()
  client.request({ kind: 'workspaceFiles.toggle' })
  const id = await client.id('start.md')
  mock.showQuickPick.mockImplementationOnce(items => items.find((item: { label: string }) => item.label === 'workspaceFiles.trash'))
  mock.warn.mockResolvedValueOnce('workspaceFiles.trash')
  client.request({ kind: 'workspaceFiles.manage', id })
  await vi.waitFor(() => expect(mock.remove).toHaveBeenCalledExactlyOnceWith(
    matchingUri('/notes/start.md'), { recursive: false, useTrash: true },
  ))
})

it('只接受合法消息形态、活动面板与当前已发出的树条目', async () => {
  expect(isWebviewToHost({ kind: 'workspaceFiles.manage', id: 8 })).toBe(false)
  expect(isWebviewToHost({ kind: 'workspaceFiles.create', entry: 'link' })).toBe(false)
  const client = mount()
  client.request({ kind: 'workspaceFiles.toggle' })
  const loaded = await client.loaded()
  expect(isHostToWebview(loaded)).toBe(true)
  expect(isHostToWebview({ ...loaded, entries: [{ ...loaded.entries[0], level: -1 }] })).toBe(false)
  const id = await client.id('start.md')
  client.setActive(false)
  client.request({ kind: 'workspaceFiles.manage', id })
  client.setActive(true)
  client.request({ kind: 'workspaceFiles.manage', id: 'tree:file:///notes|file:///outside.md' })
  await client.loaded()
  expect(mock.showQuickPick).not.toHaveBeenCalled()
  expect(mock.open).not.toHaveBeenCalled()
})
