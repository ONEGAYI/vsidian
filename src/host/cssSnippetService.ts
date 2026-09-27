// CSS 片段宿主服务（#128）：目录选择、开关映射的持久化权威 + 目录扫描与
// 文件监听的状态机。宿主是权威（spec「实施边界」）：配置、扫描、监听都在
// 这里，webview 只按 下发的有序清单装配 <link>。
//
// 设计（照 KeybindingService/SettingsService 的既有模式）：
// - 结构化状态存独立 globalState key（SettingDefinition 只有 boolean/string
//   枚举，放不下「目录 + 文件名→开关映射」）；存储 key 为
//   `vsidian.cssSnippets`（单机形态；#131 环境隔离时升级为按环境命名空间
//   的键并做一次迁移，本命名不堵死该路径）。
// - 文件系统与监听经 CssSnippetFsPort 注入，本模块不依赖 vscode，可在单测
//   注入假端口（vscode 层实现在 host/cssSnippetWiring.ts）。
// - 失败语义（验收）：读取失败（目录暂时消失/被锁）保留最近成功清单并把
//   readError 置位——已打开编辑器因此保留最近成功样式；开关映射永不因文件
//   暂时消失而清洗（编辑器原子保存=写临时文件再替换，不得误判删除）。
// - 监听事件尾随去抖后做一次权威重扫（不是增量维护清单）：rename 期间的
//   中间态（旧文件已删、新文件未就位）被去抖窗口吸收；若扫描仍撞上中间
//   态，短暂撤下后由后续事件自愈，用户开关不受影响。
// - 版本号（version）：每次成功重扫与目录/开关变更递增。webview 侧把它拼
//   进片段 URI 的查询参数击穿缓存——「保存后自动更新」的实际生效机制。
import {
  mergeScanEntries,
  sanitizeStoredCssSnippets,
  type CssSnippetState,
  type StoredCssSnippetState,
} from '../shared/cssSnippets'

/** 持久层抽象（与 SettingsService/KeybindingService 同形；vscode 层用
 *  context.globalState 实现） */
export interface CssSnippetStorage {
  get<T>(key: string): T | undefined
  update(key: string, value: unknown): Thenable<void> | Promise<void>
}

/** 文件系统端口：vscode 层实现（workspace.fs + createFileSystemWatcher） */
export interface CssSnippetFsPort {
  /**
   * 列出目录第一层 .css 文件名（仅文件，不含目录）。读取失败（目录不存
   * 在/不可读）返回 null——与「空目录」区别开：null 保留最近成功清单。
   */
  listCssFiles(directory: string): Promise<string[] | null>
  /**
   * 递归监听目录（含子目录：列表只扫一层，但被 @import 的嵌套文件变化也
   * 要触发刷新——#129 依赖，监听面先行）。返回取消函数。
   */
  watchDirectory(directory: string, onEvent: () => void): () => void
}

export type CssSnippetSaveResult =
  | { ok: true; state: CssSnippetState }
  | { ok: false; reason: 'storage' | 'invalid' }

/** 状态变更原因（onChange 监听者可区分场景；快照本身同形） */
export type CssSnippetChangeReason = 'initialize' | 'directory' | 'enabled' | 'scan' | 'scan-failed'

/**
 * 扫描失败的用户提示回调（vscode 层接 i18n 通知/界面提示）：只在失败
 * 【由用户动作直接触发】时调用（choose/refresh 期望立即看到目录内容，
 * 失败必须可见）；watcher 去抖后的后台失败不打扰用户，由设置页常驻的
 * readError 状态条呈现。
 */
export interface CssSnippetServiceOptions {
  /** 监听事件去抖窗口（ms）；默认 400 */
  debounceMs?: number
  onUserVisibleReadError?: (directory: string) => void
}

export class CssSnippetService {
  private readonly listeners = new Set<(state: CssSnippetState, reason: CssSnippetChangeReason) => void>()
  private stored: StoredCssSnippetState
  /** 最近成功扫描的文件名清单（读取失败时保留） */
  private names: string[] = []
  private readError = false
  private version = 0
  private watcherDispose: (() => void) | undefined
  private debounceTimer: ReturnType<typeof setTimeout> | undefined
  private scanToken = 0
  private queue: Promise<unknown> = Promise.resolve()
  private disposed = false

  constructor(
    private readonly storage: CssSnippetStorage,
    private readonly fs: CssSnippetFsPort,
    private readonly storageKey = 'vsidian.cssSnippets',
    private readonly options: CssSnippetServiceOptions = {},
  ) {
    this.stored = sanitizeStoredCssSnippets(storage.get(this.storageKey))
  }

  /** 当前权威状态（同步、纯内存） */
  getState(): CssSnippetState {
    return {
      directory: this.stored.directory,
      readError: this.readError,
      entries: mergeScanEntries(this.names, this.stored.enabled),
      version: this.version,
    }
  }

  /** 持久层形态（测试/诊断观测面） */
  getStored(): StoredCssSnippetState {
    return { directory: this.stored.directory, enabled: { ...this.stored.enabled } }
  }

  onChange(
    listener: (state: CssSnippetState, reason: CssSnippetChangeReason) => void,
  ): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * 启动：按已存目录做初次扫描并挂监听。面板打开早于扫描完成时先拿到
   * 空清单，扫描完成后经 onChange 广播自愈。必须在宿主层监听者
   * （编辑器面板广播、设置页推送）接好之后调用。
   */
  initialize(): Promise<void> {
    this.syncWatcher()
    return this.serialize(() => this.scan('initialize')).then(() => undefined)
  }

  /**
   * 设置片段目录（null = 取消配置）。目录更换时开关映射整体重置——片段
   * 按目录语义归属，沿用另一目录的开关会造成不可预测的初始状态。
   */
  setDirectory(directory: string | null): Promise<CssSnippetSaveResult> {
    if (directory !== null && (typeof directory !== 'string' || directory.length === 0)) {
      return Promise.resolve({ ok: false, reason: 'invalid' })
    }
    return this.serialize(async () => {
      const next: StoredCssSnippetState = { directory, enabled: {} }
      if (!(await this.persist(next))) {
        return { ok: false, reason: 'storage' }
      }
      this.stored = next
      this.readError = false
      this.syncWatcher()
      await this.scan('directory', { userInitiated: true })
      return { ok: true, state: this.getState() }
    })
  }

  /** 逐片段开关（文件名键入持久层；文件暂时不在清单也允许——原子保存窗口
   *  内的翻转不能丢） */
  setEnabled(name: string, enabled: boolean): Promise<CssSnippetSaveResult> {
    if (typeof name !== 'string' || name.length === 0 || typeof enabled !== 'boolean') {
      return Promise.resolve({ ok: false, reason: 'invalid' })
    }
    return this.serialize(async () => {
      const next: StoredCssSnippetState = {
        directory: this.stored.directory,
        enabled: { ...this.stored.enabled, [name]: enabled },
      }
      if (!(await this.persist(next))) {
        return { ok: false, reason: 'storage' }
      }
      this.stored = next
      this.version += 1
      this.notify('enabled')
      return { ok: true, state: this.getState() }
    })
  }

  /** 手动刷新：取消待执行的去抖，立即权威重扫 */
  refresh(): Promise<void> {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = undefined
    }
    return this.serialize(() => this.scan('scan', { userInitiated: true })).then(() => undefined)
  }

  /** 监听事件入口（watcher 回调）：尾随去抖后重扫 */
  notifyFsEvent(): void {
    if (this.disposed) {
      return
    }
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer)
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined
      void this.serialize(() => this.scan('scan')).then(() => undefined)
    }, this.options.debounceMs ?? 400)
  }

  dispose(): void {
    this.disposed = true
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = undefined
    }
    this.watcherDispose?.()
    this.watcherDispose = undefined
    this.listeners.clear()
  }

  /** 状态变更串行化：目录/开关/扫描不交错（后到变更基于已落地状态） */
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  private async persist(next: StoredCssSnippetState): Promise<boolean> {
    try {
      await this.storage.update(this.storageKey, next)
    } catch {
      return false
    }
    return true
  }

  /**
   * 权威重扫。结果按 scanToken 防陈旧（后发起的扫描作废先发起的）。
   * - 目录未配置：清空清单（版本推进一次以撤下 webview 已装片段），失败态复位。
   * - 读取失败：names/readError 前值保留、version 不动（webview 不重装链），
   *   仅以 scan-failed 通知（设置页常驻错误条；用户主动触发的失败另经
   *   onUserVisibleReadError 提示）。
   * - 成功：names 更新、版本推进（URI 缓存击穿）。
   */
  private async scan(
    reason: 'initialize' | 'directory' | 'scan',
    options: { userInitiated?: boolean } = {},
  ): Promise<'ok' | 'failed' | 'stale' | 'no-directory'> {
    const directory = this.stored.directory
    if (!directory) {
      this.readError = false
      if (this.names.length > 0) {
        this.names = []
        this.version += 1
        this.notify(reason)
      }
      return 'no-directory'
    }
    const token = ++this.scanToken
    const names = await this.fs.listCssFiles(directory)
    if (token !== this.scanToken || this.disposed) {
      return 'stale'
    }
    if (names === null) {
      if (!this.readError) {
        this.readError = true
        this.notify('scan-failed')
      }
      if (options.userInitiated) {
        this.options.onUserVisibleReadError?.(directory)
      }
      return 'failed'
    }
    this.names = names
    this.readError = false
    this.version += 1
    this.notify(reason)
    return 'ok'
  }

  /** 监听器随目录重挂（目录取消配置时摘除） */
  private syncWatcher(): void {
    this.watcherDispose?.()
    this.watcherDispose = undefined
    const directory = this.stored.directory
    if (!directory) {
      return
    }
    this.watcherDispose = this.fs.watchDirectory(directory, () => this.notifyFsEvent())
  }

  private notify(reason: CssSnippetChangeReason): void {
    const state = this.getState()
    for (const listener of this.listeners) {
      listener(state, reason)
    }
  }
}
