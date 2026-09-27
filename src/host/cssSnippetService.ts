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
// - 监听事件尾随去抖后按事件路径分流（#129）：
//   - 第一层 .css 事件（或无路径信息）→ 权威重扫（清单可能增删）；
//   - 仅子目录事件 → 变更归因（哪个启用入口的依赖闭包包含该路径），只
//     重载受影响入口；无入口依赖时静默（不通知、版本不动）。
// - 版本号两轴（#128 列表态 + #129 入口级）：
//   - version：列表结构版本，成功重扫/开关/目录变更 +1（消息拍与去重键）。
//   - contentVersions：入口级缓存击穿版本（独立单调计数）——入口启用、
//     入口文件被改、其依赖闭包内文件被改、清单结构变化时推进该入口；
//     其他入口启停与未涉及重扫不扰动（webview 侧 ?v= 不变即不重取）。
// - 越界拒绝（#129）：启用条目经 analyzeSnippetEntry（shared 纯逻辑）做
//   词法包含与 realpath 逃逸检查；被拒条目从装载清单排除并经
//   onEntryRejected 回调提示（只在拒绝态变化时触发，不重复打扰）。
import {
  mergeScanEntries,
  enabledSnippetFiles,
  isSnippetFileName,
  type CssSnippetRejection,
  type CssSnippetState,
  type StoredCssSnippetState,
} from '../shared/cssSnippets'
import { readStoredCssSnippetBucket } from '../shared/cssSnippetEnv'
import { analyzeSnippetEntry, normalizeSnippetPath } from '../shared/cssSnippetImports'

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
   * 要触发刷新——#129 依赖归因的输入）。事件携带变更文件路径（宿主
   * fsPath；端口无法给出路径时传 null——服务按保守全量重扫处理）。
   * 返回取消函数。
   */
  watchDirectory(directory: string, onEvent: (changedPath: string | null) => void): () => void
  /** #129 读 CSS 文本（utf-8 解码；失败/不存在 → null） */
  readFileText(path: string): Promise<string | null>
  /** #129 符号链接解析（失败/不存在 → null；宿主 node fs.realpath 语义） */
  realpath(path: string): Promise<string | null>
}

export type CssSnippetSaveResult =
  | { ok: true; state: CssSnippetState }
  | { ok: false; reason: 'storage' | 'invalid' }

/** 状态变更原因（onChange 监听者可区分场景；快照本身同形）。
 *  dep：#129 依赖归因拍——仅部分入口的 contentVersions 推进（列表结构
 *  未变，version 不动）；pause/resume：#131 全局暂停/恢复拍 */
export type CssSnippetChangeReason =
  | 'initialize'
  | 'directory'
  | 'enabled'
  | 'scan'
  | 'scan-failed'
  | 'dep'
  | 'pause'
  | 'resume'

/**
 * 用户可见回调（vscode 层接 i18n 通知/界面提示）：
 * - onUserVisibleReadError：只在失败【由用户动作直接触发】时调用
 *   （choose/refresh 期望立即看到目录内容，失败必须可见）；watcher 去抖
 *   后的后台失败不打扰用户，由设置页常驻的 readError 状态条呈现。
 * - onEntryRejected：#129 越界/符号链接逃逸的启用条目被拒时调用——只在
 *   拒绝态变化（新增或目标变化）时触发一次，不逐事件重复打扰。
 */
export interface CssSnippetServiceOptions {
  /** 监听事件去抖窗口（ms）；默认 400 */
  debounceMs?: number
  onUserVisibleReadError?: (directory: string) => void
  /** #131 环境桶戳（cssSnippetEnvStamp 推导）：读取侧过滤异桶存储，写入
   *  侧随值落地。缺省 'local'（与 #128 行为一致——含存量无戳采用语义）。
   *  权威隔离由 globalState 按宿主机器持久保证（ADR-0007），本戳是防御层 */
  environmentStamp?: string
  onEntryRejected?: (name: string, reason: CssSnippetRejection['reason'], path: string) => void
}

/** 无路径事件的哨兵（归并进去抖批后按「需全量重扫」处理） */
const PATHLESS_MARKER = ''

function sameNameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  const sa = [...a].sort()
  const sb = [...b].sort()
  return sa.every((name, i) => name === sb[i])
}

export class CssSnippetService {
  private readonly listeners = new Set<(state: CssSnippetState, reason: CssSnippetChangeReason) => void>()
  private stored: StoredCssSnippetState
  /** 最近成功扫描的文件名清单（读取失败时保留） */
  private names: string[] = []
  private readError = false
  private version = 0
  /** #129 入口级缓存击穿版本（独立单调计数；见文件头「版本号两轴」） */
  private contentVersions = new Map<string, number>()
  private contentTick = 0
  /** #129 启用条目 → 依赖闭包路径集（变更归因面；含缺失但被引用的目标） */
  private depWatch = new Map<string, string[]>()
  /** #129 被拒条目 */
  private rejections = new Map<string, CssSnippetRejection>()
  /** 去抖窗口内归集的变更路径（PATHLESS_MARKER 表示无路径信息） */
  private pendingChanges = new Set<string>()
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
    this.stored = readStoredCssSnippetBucket(
      storage.get(this.storageKey),
      this.options.environmentStamp ?? 'local',
    )
  }

  /** 当前权威状态（同步、纯内存） */
  getState(): CssSnippetState {
    const rejections: Record<string, CssSnippetRejection> = {}
    for (const [name, rejection] of this.rejections) {
      rejections[name] = { ...rejection }
    }
    return {
      directory: this.stored.directory,
      readError: this.readError,
      paused: this.stored.paused,
      entries: mergeScanEntries(this.names, this.stored.enabled),
      version: this.version,
      rejections,
    }
  }

  /**
   * #129 编辑器装载清单项：启用 ∧ 未被拒的条目，确定性文件名顺序；v 为
   * 入口级缓存击穿版本（?v= 参数值）——宿主 provider 据此构造 URI。
   */
  getLinkItems(): Array<{ name: string; v: number }> {
    return enabledSnippetFiles(this.getState())
      .filter((name) => !this.rejections.has(name))
      .map((name) => ({ name, v: this.contentVersions.get(name) ?? this.version }))
  }

  /** 持久层形态（测试/诊断观测面） */
  getStored(): StoredCssSnippetState {
    return {
      directory: this.stored.directory,
      enabled: { ...this.stored.enabled },
      paused: this.stored.paused,
    }
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
      const next: StoredCssSnippetState = { directory, enabled: {}, paused: this.stored.paused }
      if (!(await this.persist(next))) {
        return { ok: false, reason: 'storage' }
      }
      this.stored = next
      this.readError = false
      this.resetDependencyState()
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
        paused: this.stored.paused,
      }
      if (!(await this.persist(next))) {
        return { ok: false, reason: 'storage' }
      }
      this.stored = next
      this.version += 1
      if (enabled) {
        if (this.names.includes(name)) {
          // #129 启用即分析依赖闭包（拒绝面与归因面立即成立），通过则
          // 推进入口级版本（webview 装新链）；文件暂不在清单（原子保存
          // 窗口）时留待重扫入列补拍
          await this.analyzeEntries([name])
          if (!this.rejections.has(name)) {
            this.contentVersions.set(name, this.nextContentTick())
          }
        }
      } else {
        this.rejections.delete(name)
        this.depWatch.delete(name)
        this.contentVersions.delete(name)
      }
      this.notify('enabled')
      return { ok: true, state: this.getState() }
    })
  }

  /**
   * #131 全局暂停/恢复（宿主命令与设置页按钮共用入口）。语义与逐项停用
   * 正交：只翻转持久化冻结标志，enabled 映射与扫描清单原样保留——恢复时
   * 按原配置立即生效，无需重新启用。装载门控在宿主广播侧
   * （buildSnippetLinkList：paused 即空清单），编辑器撤下/重装由广播驱动。
   * 幂等：同值重复设置不写入不通知（命令面板重复调用不产生冗余广播）。
   */
  setPaused(paused: boolean): Promise<CssSnippetSaveResult> {
    if (typeof paused !== 'boolean') {
      return Promise.resolve({ ok: false, reason: 'invalid' })
    }
    if (this.stored.paused === paused) {
      return Promise.resolve({ ok: true, state: this.getState() })
    }
    return this.serialize(async () => {
      // 串行段内再查一次：并发翻转以最后一笔为准，中间笔自然跳过
      if (this.stored.paused === paused) {
        return { ok: true, state: this.getState() }
      }
      const next: StoredCssSnippetState = {
        directory: this.stored.directory,
        enabled: { ...this.stored.enabled },
        paused,
      }
      if (!(await this.persist(next))) {
        return { ok: false, reason: 'storage' }
      }
      this.stored = next
      this.version += 1
      this.notify(paused ? 'pause' : 'resume')
      return { ok: true, state: this.getState() }
    })
  }

  /** 手动刷新：取消待执行的去抖，立即权威重扫（全部启用入口取新内容） */
  refresh(): Promise<void> {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = undefined
    }
    return this.serialize(() => this.scan('scan', { userInitiated: true, reloadAll: true })).then(
      () => undefined,
    )
  }

  /**
   * 监听事件入口（watcher 回调）：尾随去抖后按批处理。changedPath 为宿主
   * fsPath（任意斜杠形态，内部归一为正斜杠）；null 表示端口给不出路径
   * （保守全量重扫）。
   */
  notifyFsEvent(changedPath: string | null): void {
    if (this.disposed) {
      return
    }
    if (typeof changedPath === 'string' && changedPath.length > 0) {
      this.pendingChanges.add(normalizeSnippetPath(changedPath))
    } else {
      this.pendingChanges.add(PATHLESS_MARKER)
    }
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer)
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined
      void this.serialize(() => this.handleWatchBatch()).then(() => undefined, () => undefined)
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
    this.pendingChanges.clear()
  }

  /** 状态变更串行化：目录/开关/扫描不交错（后到变更基于已落地状态） */
  private serialize<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  private nextContentTick(): number {
    this.contentTick += 1
    return this.contentTick
  }

  private resetDependencyState(): void {
    this.contentVersions.clear()
    this.depWatch.clear()
    this.rejections.clear()
    this.pendingChanges.clear()
  }

  private entryPathOf(name: string): string {
    const dir = normalizeSnippetPath(this.stored.directory ?? '')
    return `${dir}/${name}`
  }

  /** 去抖批处理：第一层事件/无路径 → 权威重扫；纯子级事件 → 归因重载 */
  private async handleWatchBatch(): Promise<void> {
    const directory = this.stored.directory
    if (!directory) {
      this.pendingChanges.clear()
      return
    }
    const dirNorm = normalizeSnippetPath(directory)
    const needsScan =
      this.pendingChanges.has(PATHLESS_MARKER) ||
      [...this.pendingChanges].some((p) => {
        if (!p.startsWith(`${dirNorm}/`)) {
          return true // 目录外路径（不应发生）：保守重扫
        }
        const rel = p.slice(dirNorm.length + 1)
        return !rel.includes('/') && isSnippetFileName(rel)
      })
    if (needsScan) {
      // 权威重扫（清单可能增删/入口内容变化）；批内路径由 scan 的归因拍消费
      await this.scan('scan')
      return
    }
    const pending = new Set(this.pendingChanges)
    this.pendingChanges.clear()
    // 纯子目录路径：第一层清单不受影响，不重扫——直接归因
    const affected = this.affectedEntries(pending)
    if (affected.size === 0) {
      return // 静默：无入口依赖该文件（不通知、版本与入口版本均不动）
    }
    const rejectionChanged = await this.analyzeEntries([...affected])
    let bumped = false
    for (const name of affected) {
      if (!this.rejections.has(name)) {
        this.contentVersions.set(name, this.nextContentTick())
        bumped = true
      }
    }
    if (bumped || rejectionChanged) {
      this.notify('dep')
    }
  }

  /** 批内路径 → 受影响启用入口（入口自身路径命中或依赖闭包包含） */
  private affectedEntries(pending: ReadonlySet<string>): Set<string> {
    const affected = new Set<string>()
    for (const name of enabledSnippetFiles(this.getState())) {
      const entryPath = this.entryPathOf(name)
      const deps = this.depWatch.get(name) ?? []
      if (pending.has(entryPath) || deps.some((dep) => pending.has(dep))) {
        affected.add(name)
      }
    }
    return affected
  }

  private async persist(next: StoredCssSnippetState): Promise<boolean> {
    try {
      // #131 桶戳随值落地：本环境写入的数据归属本环境（异桶读取侧过滤）
      await this.storage.update(this.storageKey, {
        ...next,
        envStamp: this.options.environmentStamp ?? 'local',
      })
    } catch {
      return false
    }
    return true
  }

  /**
   * 权威重扫。结果按 scanToken 防陈旧（后发起的扫描作废先发起的）。
   * - 目录未配置：清空清单（版本推进一次以撤下 webview 已装片段），失败态复位。
   * - 读取失败：names/readError/依赖面前值保留、version 不动（webview 不
   *   重装链），仅以 scan-failed 通知（设置页常驻错误条；用户主动触发的
   *   失败另经 onUserVisibleReadError 提示）。
   * - 成功：names 更新、版本推进；随后重建启用条目的依赖闭包（拒绝面），
   *   并按「清单结构变化 / 手动刷新 / 批内归因路径」推进入口级版本。
   */
  private async scan(
    reason: 'initialize' | 'directory' | 'scan',
    options: { userInitiated?: boolean; reloadAll?: boolean } = {},
  ): Promise<'ok' | 'failed' | 'stale' | 'no-directory'> {
    const directory = this.stored.directory
    if (!directory) {
      this.readError = false
      if (this.names.length > 0) {
        this.names = []
        this.resetDependencyState()
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
    const namesChanged = !sameNameSet(this.names, names)
    this.names = names
    this.readError = false
    this.version += 1
    // #129 依赖面重建（含拒绝态变化回报）；stale 检查在其后（串行队列下
    // 实际不可达，保留与 #128 相同的防御）
    const pending = new Set(this.pendingChanges)
    this.pendingChanges.clear()
    await this.analyzeEntries(enabledSnippetFiles(this.getState()))
    if (token !== this.scanToken || this.disposed) {
      return 'stale'
    }
    if (namesChanged || options.reloadAll) {
      for (const name of enabledSnippetFiles(this.getState())) {
        if (!this.rejections.has(name)) {
          this.contentVersions.set(name, this.nextContentTick())
        }
      }
    } else {
      for (const name of this.affectedEntries(pending)) {
        if (!this.rejections.has(name)) {
          this.contentVersions.set(name, this.nextContentTick())
        }
      }
    }
    this.notify(reason)
    return 'ok'
  }

  /**
   * 重建给定启用条目的依赖闭包与拒绝面。返回拒绝态是否变化（供归因拍
   * 决定是否通知——被拒条目入/出清单是用户可见变化）。readFileText 上的
   * 失败不拒绝条目（浏览器侧装载失败自会回报），仅保留上一次闭包。
   */
  private async analyzeEntries(names: readonly string[]): Promise<boolean> {
    const directory = this.stored.directory
    if (!directory || names.length === 0) {
      return false
    }
    let realDirectory: string | null = null
    try {
      realDirectory = await this.fs.realpath(directory)
    } catch {
      realDirectory = null
    }
    const realDirNorm = realDirectory !== null
      ? normalizeSnippetPath(realDirectory)
      : normalizeSnippetPath(directory)
    let rejectionChanged = false
    // 端口适配：服务级 fs（readFileText/realpath）→ 分析纯逻辑端口（readText/realpath）
    const analysisPorts = {
      readText: (p: string) => this.fs.readFileText(p),
      realpath: (p: string) => this.fs.realpath(p),
    }
    for (const name of names) {
      const analysis = await analyzeSnippetEntry(directory, name, analysisPorts, realDirNorm)
      if (analysis.ok) {
        this.depWatch.set(name, analysis.importPaths)
        if (this.rejections.delete(name)) {
          rejectionChanged = true
        }
      } else {
        this.depWatch.delete(name)
        const prev = this.rejections.get(name)
        if (!prev || prev.reason !== analysis.reason || prev.path !== analysis.path) {
          this.rejections.set(name, { reason: analysis.reason, path: analysis.path })
          rejectionChanged = true
          this.options.onEntryRejected?.(name, analysis.reason, analysis.path)
        }
      }
    }
    return rejectionChanged
  }

  /** 监听器随目录重挂（目录取消配置时摘除） */
  private syncWatcher(): void {
    this.watcherDispose?.()
    this.watcherDispose = undefined
    const directory = this.stored.directory
    if (!directory) {
      return
    }
    this.watcherDispose = this.fs.watchDirectory(directory, (changedPath) =>
      this.notifyFsEvent(changedPath),
    )
  }

  private notify(reason: CssSnippetChangeReason): void {
    const state = this.getState()
    for (const listener of this.listeners) {
      listener(state, reason)
    }
  }
}
