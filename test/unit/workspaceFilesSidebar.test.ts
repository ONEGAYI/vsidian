import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({
  readDirectory: vi.fn(), stat: vi.fn(), createDirectory: vi.fn(), remove: vi.fn(),
  applyEdit: vi.fn(), createFile: vi.fn(), renameFile: vi.fn(), open: vi.fn(),
  showInputBox: vi.fn(), showQuickPick: vi.fn(), warn: vi.fn(), error: vi.fn(),
  textDocuments: [] as Array<{ uri: unknown; isDirty: boolean }>,
  notebookDocuments: [] as Array<{ uri: unknown; isDirty: boolean }>,
  watchCreate: vi.fn(), watchDelete: vi.fn(),
  mediaProvider: vi.fn(), readFile: vi.fn(),
  extraRoots: [] as string[],
}))

vi.mock('vscode', async () => {
  const path = (await import('node:path')).posix
  const uri = (path: string, scheme = 'file') =>
    ({ path, fsPath: path, scheme, authority: '', toString: () => `${scheme}://${path}` })
  const disposable = () => ({ dispose() {} })
  class FileSystemError extends Error {
    readonly code: string
    constructor(code: string) { super(code); this.code = code }
    static Unavailable() { return new FileSystemError('Unavailable') }
    static FileNotFound() { return new FileSystemError('FileNotFound') }
  }
  const folder = { uri: uri('/notes'), name: 'notes', index: 0 }
  return {
    Uri: {
      file: uri,
      from: (value: { path: string; scheme: string }) => uri(value.path, value.scheme),
      joinPath: (base: { path: string; scheme: string }, ...parts: string[]) => uri(path.join(base.path, ...parts), base.scheme),
    },
    FileSystemError,
    FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
    Disposable: { from: disposable },
    EventEmitter: class { event = disposable; dispose() {} },
    WorkspaceEdit: class { createFile = mock.createFile; renameFile = mock.renameFile },
    TabInputText: class {},
    TabInputCustom: class {},
    workspace: {
      get workspaceFolders() { return [folder, ...mock.extraRoots.map(path => ({ name: path, uri: uri(path) }))] },
      getWorkspaceFolder: ({ path }: { path: string }) => path === '/notes' || path.startsWith('/notes/') ? folder : undefined,
      asRelativePath: ({ path }: { path: string }) => path.replace('/notes/', ''),
      fs: { readDirectory: mock.readDirectory, stat: mock.stat, createDirectory: mock.createDirectory, delete: mock.remove,
        readFile: mock.readFile,
        isWritableFileSystem: (scheme: string) => scheme === 'file' },
      applyEdit: mock.applyEdit,
      textDocuments: mock.textDocuments,
      notebookDocuments: mock.notebookDocuments,
      onDidChangeWorkspaceFolders: disposable,
      registerFileSystemProvider: mock.mediaProvider,
      createFileSystemWatcher: () => ({ ...disposable(), onDidCreate: mock.watchCreate, onDidDelete: mock.watchDelete }),
    },
    window: {
      tabGroups: { all: [], onDidChangeTabGroups: disposable, onDidChangeTabs: disposable },
      showInputBox: mock.showInputBox, showQuickPick: mock.showQuickPick,
      showWarningMessage: mock.warn, showErrorMessage: mock.error,
    },
    commands: { executeCommand: mock.open },
  }
})

import * as vscode from 'vscode'
import { WorkspaceFilesSidebar } from '../../src/host/workspaceFilesSidebar'
import type { WorkspaceFilesSnapshot } from '../../src/shared/protocol'
import { isHostToWebview, isWebviewToHost } from '../../src/shared/protocol'

const files = new Map<string, number>()
const fileType = vscode.FileType.File
const dirType = vscode.FileType.Directory
const makeUri = vscode.Uri.file
const matchingUri = (path: string) => expect.objectContaining({ path, scheme: 'file' })
const initial = { open: false }
const update = vi.fn()
let sidebar: WorkspaceFilesSidebar
let created: (uri: vscode.Uri) => void

beforeEach(() => {
  vi.resetAllMocks()
  mock.textDocuments.length = 0
  mock.notebookDocuments.length = 0
  mock.extraRoots.length = 0
  files.clear()
  for (const [path, type] of Object.entries({ '/notes': dirType, '/notes/start.md': fileType,
    '/notes/drafts': dirType, '/notes/drafts/old.md': fileType, '/notes/escape': dirType | vscode.FileType.SymbolicLink,
    '/notes/.git': dirType })) files.set(path, type)
  mock.stat.mockImplementation(async (uri: vscode.Uri) => {
    const type = files.get(uri.path)
    if (type === undefined) throw vscode.FileSystemError.FileNotFound(uri)
    return { type }
  })
  mock.readDirectory.mockImplementation(async (uri: vscode.Uri) => {
    const prefix = `${uri.path}/`
    return [...files].flatMap(([path, type]) => {
      const name = path.slice(prefix.length)
      return path.startsWith(prefix) && !name.includes('/') ? [[name, type]] : []
    })
  })
  mock.watchCreate.mockImplementation(callback => { created = callback })
  mock.applyEdit.mockResolvedValue(true)
  initial.open = false
  update.mockReset()
  sidebar = new WorkspaceFilesSidebar({ get: () => initial.open, update } as unknown as vscode.Memento)
})

afterEach(() => { sidebar.dispose() })

function mount(path = '/notes/start.md') {
  let snapshot: WorkspaceFilesSnapshot | undefined
  let active = true
  const panel = {
    get active() { return active }, visible: true, viewColumn: 2,
    webview: { postMessage: (message: WorkspaceFilesSnapshot) => { snapshot = message } },
  } as unknown as vscode.WebviewPanel
  const client = sidebar.attach(makeUri(path), panel)
  client.ready()
  async function loaded() {
    return vi.waitFor(() => {
      expect(snapshot).toMatchObject({ open: true, loading: false })
      return snapshot!
    })
  }
  return { ...client, loaded, snapshot: () => snapshot, setActive: (value: boolean) => { active = value },
    id: async (name: string) => (await loaded()).entries.find(entry => entry.name === name)!.id }
}

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

it('来源图片别名单文件读取；重定向的路径和非图片不获授权', async () => {
  const client = mount('/notes/drafts/old.md')
  client.request({ kind: 'workspaceFiles.toggle' })
  const owner = await client.id('old.md')
  const uri = makeUri('/notes/drafts/src.png')
  const root = makeUri('/notes')
  files.set('/notes/drafts/src.png', fileType)
  expect(client.previewImageAsset(owner, makeUri('/notes/drafts/old.md'), root)).toBeUndefined()
  expect(client.previewImageAsset(owner, makeUri('/outside/sibling.png'), root)).toBeUndefined()
  const alias = client.previewImageAsset(owner, uri, root)!
  sidebar.registerMediaResources()
  const provider = mock.mediaProvider.mock.calls[0]![1] as vscode.FileSystemProvider
  mock.readFile.mockResolvedValueOnce(Uint8Array.of(1))
  expect(await provider.readFile(alias)).toEqual(Uint8Array.of(1))
  expect(mock.readFile).toHaveBeenCalledExactlyOnceWith(uri)
  files.set('/notes/drafts', dirType | vscode.FileType.SymbolicLink)
  await expect(provider.readFile(alias)).rejects.toThrow()
  expect(mock.readFile).toHaveBeenCalledTimes(1)
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
