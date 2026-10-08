// #404 附加组件数据目录服务（宿主侧纯逻辑，文件系统与 watcher 经端口
// 注入——vscode 层装配在 addonWiring；本模块零 vscode 依赖，可单测）。
//
// 职责（票面）：
// - 按 addonId 派生隔离目录 `<baseDir>/<addonId>/`，实现 shared
//   AddonStorageFacet 的读写与监听；组件只能触达自己目录（路径守卫
//   复用 shared 单一事实源，越界在 IO 之前拒绝）。
// - 单文件上限（ADDON_STORAGE_FILE_LIMIT_BYTES）在 writeFile 入口拦截。
// - watcher 惰性创建、多订阅共享底层、全退订或 release 时注销；变化
//   回调只回相对路径。
// - 卸载清理策略：release 只注销 watcher，文件数据保留（组件停用/故障/
//   扩展卸载都不自动删——随 Vsidian 本体卸载整体清除；见 shared 头注释）。
import {
  ADDON_STORAGE_FILE_LIMIT_BYTES,
  isSafeAddonStoragePath,
  type AddonStorageEntryInfo,
  type AddonStorageFacet,
  type AddonStorageListResult,
  type AddonStorageResult,
} from '../../shared/addonStorage'

/** 文件系统端口（vscode 层实现 = vscode.workspace.fs；路径为正斜杠
 * 归一后的绝对文件系统路径；FileType 沿用 vscode 枚举数值：1=目录 0=文件） */
export interface AddonStorageFsPort {
  readFile(path: string): Promise<Uint8Array>
  writeFile(path: string, content: Uint8Array): Promise<void>
  delete(path: string): Promise<void>
  readDirectory(path: string): Promise<Array<[string, number]>>
  createDirectory(path: string): Promise<void>
}

/** watcher 工厂端口（vscode 层实现 = createFileSystemWatcher） */
export type AddonStorageWatcherFactory = (
  dirPath: string,
  onEvent: (kind: 'change' | 'delete', relativePath: string) => void,
) => { dispose(): void }

export interface AddonStorageServiceDeps {
  /** addons 基座目录（正斜杠归一绝对路径；生产 = <globalStorage>/addons） */
  readonly baseDir: string
  /** 组件数据目录的 URI 字符串（生产经 vscode.Uri 构造；显示与同步配置用） */
  readonly uriOf: (addonId: string) => string
  readonly fs: AddonStorageFsPort
  readonly createWatcher: AddonStorageWatcherFactory
}

interface WatcherState {
  underlying: { dispose(): void }
  subscribers: Set<(relativePath: string, kind: 'change' | 'delete') => void>
}

/** 页面级服务：按 addonId 派生隔离的存储 facet；release 注销该组件 watcher */
export class AddonStorageService {
  private readonly watchers = new Map<string, WatcherState>()

  constructor(private readonly deps: AddonStorageServiceDeps) {}

  storageFor(addonId: string): AddonStorageFacet {
    const root = `${this.deps.baseDir}/${addonId}`
    const deps = this.deps
    const service = this
    return {
      uri: () => deps.uriOf(addonId),
      readFile: (relativePath) =>
        withGuard(relativePath, async () => ({
          ok: true as const,
          value: Buffer.from(await deps.fs.readFile(`${root}/${relativePath}`)).toString('utf8'),
        })),
      writeFile: (relativePath, content) =>
        withGuard(relativePath, async () => {
          if (Buffer.byteLength(content, 'utf8') > ADDON_STORAGE_FILE_LIMIT_BYTES) {
            return { ok: false as const, reason: 'too-large' as const }
          }
          await deps.fs.createDirectory(`${root}/${dirOf(relativePath)}`)
          await deps.fs.writeFile(`${root}/${relativePath}`, Buffer.from(content, 'utf8'))
          return { ok: true as const, value: null }
        }),
      list: (relativePath, recursive) =>
        listDirectory(deps, root, relativePath ?? '', recursive === true),
      deleteFile: (relativePath) =>
        withGuard(relativePath, async () => {
          await deps.fs.delete(`${root}/${relativePath}`)
          return { ok: true as const, value: null }
        }),
      onDidChangeFile: (callback) => service.subscribe(addonId, root, callback),
    }
  }

  private subscribe(
    addonId: string,
    root: string,
    callback: (relativePath: string) => void,
  ): { dispose(): void } {
    let state = this.watchers.get(addonId)
    if (!state) {
      const subscribers = new Set<(relativePath: string, kind: 'change' | 'delete') => void>()
      const underlying = this.deps.createWatcher(root, (kind, relativePath) => {
        for (const subscriber of subscribers) {
          try {
            subscriber(relativePath, kind)
          } catch {
            // 订阅方异常不阻断其余订阅
          }
        }
      })
      state = { underlying, subscribers }
      this.watchers.set(addonId, state)
    }
    state.subscribers.add(callback)
    return {
      dispose: () => {
        const current = this.watchers.get(addonId)
        if (!current) return
        current.subscribers.delete(callback)
        if (current.subscribers.size === 0) {
          current.underlying.dispose()
          this.watchers.delete(addonId)
        }
      },
    }
  }

  /** 组件释放（停用/故障/代次终结）：注销该组件 watcher；文件数据保留 */
  release(addonId: string): void {
    this.watchers.get(addonId)?.underlying.dispose()
    this.watchers.delete(addonId)
  }
}

async function withGuard<T>(
  relativePath: string,
  run: () => Promise<AddonStorageResult<T>>,
): Promise<AddonStorageResult<T>> {
  if (!isSafeAddonStoragePath(relativePath)) {
    return { ok: false, reason: 'invalid-path' }
  }
  try {
    return await run()
  } catch (err) {
    return { ok: false, reason: 'error', detail: String(err) }
  }
}

async function listDirectory(
  deps: AddonStorageServiceDeps,
  root: string,
  relativePath: string,
  recursive: boolean,
): Promise<AddonStorageListResult> {
  if (relativePath !== '' && !isSafeAddonStoragePath(relativePath)) {
    return { ok: false, reason: 'invalid-path' }
  }
  const base = relativePath === '' ? root : `${root}/${relativePath}`
  const prefix = relativePath === '' ? '' : `${relativePath}/`
  const entries: AddonStorageEntryInfo[] = []
  try {
    await collectEntries(deps, base, prefix, recursive, entries)
    return { ok: true, entries }
  } catch (err) {
    return { ok: false, reason: 'error', detail: String(err) }
  }
}

/** 目录项类型值与 vscode.FileType 对齐（Directory = 2, File = 1） */
const FILE_TYPE = { file: 1, directory: 2 } as const

async function collectEntries(
  deps: AddonStorageServiceDeps,
  dir: string,
  prefix: string,
  recursive: boolean,
  out: AddonStorageEntryInfo[],
): Promise<void> {
  for (const [name, type] of await deps.fs.readDirectory(dir)) {
    if (type === FILE_TYPE.directory) {
      out.push({ path: `${prefix}${name}`, kind: 'directory' })
      if (recursive) {
        await collectEntries(deps, `${dir}/${name}`, `${prefix}${name}/`, recursive, out)
      }
    } else {
      out.push({ path: `${prefix}${name}`, kind: 'file' })
    }
  }
}

/** 相对路径的父目录（无斜杠 = 根） */
function dirOf(relativePath: string): string {
  const slash = relativePath.lastIndexOf('/')
  return slash === -1 ? '' : relativePath.slice(0, slash)
}
