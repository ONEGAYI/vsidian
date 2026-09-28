// 工作区引用索引宿主服务（工单 #197）：扫描 / 持久化 / 覆盖层 / 反链查询
// 的编排核心。fs 与监听全部经端口注入（vscode 层壳见 vaultIndexWiring.ts），
// 本体不依赖 vscode / DOM（vitest 直驱）。
//
// 架构约定（#194 规格 + ADR-0008）：
// - **挂载层级**：activate 装配的服务级单例，不进 SessionEntry（面板全关
//   不销毁索引）
// - **多根边界**：各 workspaceFolder 为独立资源边界，独立 model 与快照
//   分区（baseDir = <storageUri>/vsidian-index/<rootKeyOf(uri)>）；嵌套根
//   按文档实际所属的最具体根划分（不重复归属）；跨根目标不解析（断链保留）
// - **事实源分层**：磁盘正文（扫描进 model）+ 未保存内容（内存覆盖层，
//   TextDocument.version 单调仲裁——旧扫描/旧请求不得覆盖新版本）；快照
//   只存磁盘基线，覆盖层不落盘
// - **事件循环**：扫描分批让出（scanBatchFiles/批）；快照提交经
//   planSnapshotCommitChunked 片间让出（ADR-0008 接线硬约束）
// - **排除谓词留位**：scanPort.exclude 供 #198 接线（首版恒不排除）
//
// 调度初值（#194「生命周期」，待测初值非时限承诺）：未保存编辑去抖 500ms
// 重抽；watcher/保存变更去抖合并后重扫并合并提交快照（1.5s）；周期核验、
// 增量队列与排除设置归 #198。
import * as path from 'node:path'
import { extractVaultEdges } from './vaultLinkExtract'
import { queryBacklinks, VaultIndexOverlay } from './vaultIndexOverlay'
import {
  buildBacklinkIndex,
  loadSnapshot,
  planSnapshotCommitChunked,
  rootKeyOf,
  type VaultEdge,
  type VaultFileEntry,
  type VaultIndexFsPort,
  type VaultIndexModel,
  type SnapshotMeta,
} from '../shared/vaultIndexSnapshot'

/** 工作区根引用（wiring 层已按 vscode 语义对语法异构同指向 URI 去重） */
export interface VaultRootRef {
  fsPath: string
  /** 根 URI 字符串（rootKeyOf 输入；file scheme） */
  uri: string
}

/** 扫描端口（vscode 层壳实现；#198 在 listMarkdownFiles 内接排除谓词） */
export interface VaultIndexScanPort {
  /** 列根内全部 Markdown（绝对 fsPath，磁盘真实形态；不含排除项） */
  listMarkdownFiles(rootFsPath: string): Promise<string[]>
  /** 读文件 utf-8 文本；失败/不存在 null（原样返回，CRLF 由服务归一） */
  readFileText(fsPath: string): Promise<string | null>
  /** stat（mtime/size——快照条目与增量筛选）；失败 null */
  statFile(fsPath: string): Promise<{ mtimeMs: number; size: number } | null>
  /** 递归监听根内 *.md 变更（首版：保存/删除/外部修改触发单文件重扫） */
  watchRoot(rootFsPath: string, onEvent: (fsPath: string | null) => void): () => void
  /** 让出事件循环（扫描分批与快照片间；vscode 层传 setImmediate） */
  yieldToEventLoop(): Promise<void>
}

/** 快照存储端口：VaultIndexFsPort（恢复读）+ 写侧（提交与回收） */
export interface VaultIndexStoragePort extends VaultIndexFsPort {
  /** 写文件（调用方保证写前目录存在；原子性由实现保证——临时写 + rename） */
  writeFile(path: string, content: string): Promise<void>
  /** 删除目录（回收旧代；失败忽略——下一轮回收兜底） */
  removeDir(path: string): Promise<void>
  /** 确保目录存在（提交前） */
  ensureDir(path: string): Promise<void>
}

/** 面板反链条目（查询结果；LF 坐标 + 行片段） */
export interface BacklinkItem {
  sourceRelPath: string
  sourceFsPath: string
  kind: VaultEdge['kind']
  anchor: string
  /** 出链标记在来源正文中的 LF 偏移区间（跳转定位） */
  start: number
  end: number
  /** 来源行号（1 基） */
  line: number
  /** 引用片段（来源行文本，超长截断） */
  snippet: string
}

/** 反链查询结果（面板四态的数据面：loading/无引用(ready+空)/updating/error） */
export type BacklinksResult =
  | { status: 'ready'; items: BacklinkItem[]; updating: boolean }
  | { status: 'loading' }
  | { status: 'error'; reason: 'no-workspace' | 'read-error' }

/** 单根的索引状态 */
interface RootIndexState {
  fsPath: string
  /** 根 URI 字符串（分区键输入——wiring 已按 vscode 语义去重） */
  uri: string
  model: VaultIndexModel | null
  backlinks: Map<string, readonly VaultEdge[]> | null
  overlay: VaultIndexOverlay
  meta: SnapshotMeta | null
  /** 扫描/重建进行中（无数据时面板呈 loading，有数据呈 updating） */
  scanning: boolean
  hasData: boolean
  unwatch: (() => void) | null
  /** 快照合并提交去抖定时器 */
  commitTimer: ReturnType<typeof setTimeout> | undefined
  /** 文件级重扫去抖（fsPath 归一键 → timer） */
  rescanTimers: Map<string, ReturnType<typeof setTimeout>>
  /** 未保存文档的最新文本（去抖窗口内） */
  unsaved: Map<string, { version: number; text: string }>
  unsavedTimers: Map<string, ReturnType<typeof setTimeout>>
}

export interface VaultIndexServiceOptions {
  /** 快照存储根（fsPath；实际分区 = <storageRoot>/vsidian-index/<rootKey>） */
  storageRoot: string
  /** 宿主文件系统语义（Windows 本地 true；远程一律 false） */
  isWindowsHost: boolean
  /** 扫描批大小（每批之间让出事件循环）；缺省 24 */
  scanBatchFiles?: number
  /** 未保存编辑去抖 ms；缺省 500（#194 待测初值） */
  unsavedDebounceMs?: number
  /** 文件重扫去抖 ms；缺省 800 */
  rescanDebounceMs?: number
  /** 快照合并提交去抖 ms；缺省 1500 */
  commitDebounceMs?: number
  /** 片段截断长度；缺省 160 */
  snippetLimit?: number
}

const ADAPTIVE_SHARDS: readonly { maxFiles: number; shards: number }[] = [
  { maxFiles: 10_000, shards: 16 },
  { maxFiles: 100_000, shards: 64 },
  { maxFiles: Number.MAX_SAFE_INTEGER, shards: 256 },
]

export class VaultIndexService {
  private readonly roots = new Map<string, RootIndexState>()
  /** 按深度降序的根键列表（最具体根优先匹配） */
  private rootOrder: string[] = []
  private readonly listeners = new Set<() => void>()
  private disposed = false
  private readonly scanBatch: number
  private readonly unsavedDebounce: number
  private readonly rescanDebounce: number
  private readonly commitDebounce: number
  private readonly snippetLimit: number

  constructor(
    private readonly scan: VaultIndexScanPort,
    private readonly storage: VaultIndexStoragePort,
    private readonly opts: VaultIndexServiceOptions,
  ) {
    this.scanBatch = opts.scanBatchFiles ?? 24
    this.unsavedDebounce = opts.unsavedDebounceMs ?? 500
    this.rescanDebounce = opts.rescanDebounceMs ?? 800
    this.commitDebounce = opts.commitDebounceMs ?? 1500
    this.snippetLimit = opts.snippetLimit ?? 160
  }

  /** activate 装配入口：恢复或重建各根索引并挂监听 */
  async initialize(roots: readonly VaultRootRef[]): Promise<void> {
    // fsPath 归一去重（wiring 已按 vscode 语义去重 URI；此处防御性收口）
    const seen = new Set<string>()
    for (const root of roots) {
      const key = this.normKey(root.fsPath)
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      this.roots.set(key, {
        fsPath: root.fsPath,
        uri: root.uri,
        model: null,
        backlinks: null,
        overlay: new VaultIndexOverlay(),
        meta: null,
        scanning: false,
        hasData: false,
        unwatch: null,
        commitTimer: undefined,
        rescanTimers: new Map(),
        unsaved: new Map(),
        unsavedTimers: new Map(),
      })
    }
    this.rootOrder = [...this.roots.keys()].sort((a, b) => b.length - a.length)
    for (const state of this.roots.values()) {
      if (this.disposed) {
        return
      }
      state.unwatch = this.scan.watchRoot(state.fsPath, (fsPath) => this.onWatchEvent(state, fsPath))
      await this.recoverOrScan(state)
    }
  }

  dispose(): void {
    this.disposed = true
    for (const state of this.roots.values()) {
      state.unwatch?.()
      state.unwatch = null
      if (state.commitTimer !== undefined) {
        clearTimeout(state.commitTimer)
      }
      for (const timer of state.rescanTimers.values()) {
        clearTimeout(timer)
      }
      for (const timer of state.unsavedTimers.values()) {
        clearTimeout(timer)
      }
      state.rescanTimers.clear()
      state.unsavedTimers.clear()
      state.unsaved.clear()
    }
  }

  /** 模型变化通知（provider 广播全部 ready 面板用） */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      listener()
    }
  }

  // ---- 恢复与全量扫描 ----

  private baseDirOf(state: RootIndexState): string {
    // 分区键以 wiring 传入的真实根 URI 求（rootKeyOf 只做语法层归一——
    // 平台大小写由 vscode 语义在 wiring 去重时处理，见 ADR-0008）
    return `${this.opts.storageRoot.replace(/\\/g, '/')}/vsidian-index/${rootKeyOf(state.uri)}`
  }

  private async recoverOrScan(state: RootIndexState): Promise<void> {
    state.scanning = true
    this.notify()
    const baseDir = this.baseDirOf(state)
    try {
      const loaded = await loadSnapshot(this.storage, baseDir)
      if (loaded && !this.disposed) {
        state.model = loaded.model
        state.meta = loaded.meta
        state.backlinks = buildBacklinkIndex(loaded.model.edges)
        state.hasData = true
        state.scanning = false
        this.notify()
        return
      }
    } catch {
      // 快照读取异常按全损处理（索引是可重建缓存）
    }
    await this.fullScan(state)
  }

  /** 全量扫描：分批读盘抽取（批间让出）→ 附件登记（两遍法）→ 快照提交 */
  private async fullScan(state: RootIndexState): Promise<void> {
    state.scanning = true
    this.notify()
    // 嵌套根划分：父根扫描排除「实际属于更具体根」的文件（不重复归属，
    // #194「路径与范围」；rootOrder 深度降序保证 rootOf 取最具体根）
    const listed = (await this.scan.listMarkdownFiles(state.fsPath))
      .filter((abs) => this.rootOf(abs) === state)
    const foldIndex = new Map<string, string>() // fold(rel) → rel（md 集合）
    const absByRel = new Map<string, string>()
    for (const abs of listed) {
      const rel = this.relOf(state, abs)
      if (rel !== null) {
        foldIndex.set(this.foldKey(rel), rel)
        absByRel.set(rel, abs)
      }
    }
    const files = new Map<string, VaultFileEntry>()
    const edges: VaultEdge[] = []
    /** 附件登记：fold(rel) → 条目（两遍法的第二遍起可见） */
    const assetFold = new Map<string, VaultFileEntry>()
    /** 第一遍 miss 的非 md 候选（绝对形态；stat 后决定是否登记 asset） */
    const missed: string[] = []
    /** 存在断链边的来源 rel（第二遍重抽——asset 登记后可能命中） */
    const pendingSources = new Set<string>()

    const resolveWith = (absFsPath: string): string | null => {
      const rel = this.relOf(state, absFsPath)
      if (rel === null) {
        return null
      }
      const mdHit = foldIndex.get(this.foldKey(rel))
      if (mdHit !== undefined) {
        return mdHit
      }
      const assetHit = assetFold.get(this.foldKey(rel))
      if (assetHit !== undefined) {
        return assetHit.path
      }
      missed.push(absFsPath)
      return null
    }

    const ctxOf = (abs: string) => ({
      docDir: this.dirname(abs),
      rootDir: state.fsPath,
      isWindowsHost: this.opts.isWindowsHost,
    })

    // 第一遍：md 互解析（附件目标 miss 收集）
    const mdList = [...absByRel.keys()].sort()
    for (let i = 0; i < mdList.length; i++) {
      if (this.disposed) {
        return
      }
      const rel = mdList[i]!
      const abs = absByRel.get(rel)!
      const raw = await this.scan.readFileText(abs)
      const stat = await this.scan.statFile(abs)
      if (raw === null) {
        continue // 读失败：不登记（watcher 兜底）
      }
      const text = normalizeLf(raw)
      const docEdges = extractVaultEdges(rel, text, ctxOf(abs), resolveWith)
      edges.push(...docEdges)
      files.set(rel, {
        path: rel,
        kind: 'markdown',
        mtimeMs: stat?.mtimeMs ?? 0,
        size: stat?.size ?? 0,
        contentVersion: 1,
      })
      if (docEdges.some((e) => e.resolvedTarget === null)) {
        pendingSources.add(rel)
      }
      if ((i + 1) % this.scanBatch === 0) {
        await this.scan.yieldToEventLoop()
      }
    }

    // 附件登记：miss 候选中真实存在者（任意类型，仅登记元数据与被引用关系，
    // 不解析内容——#194 规格）
    const uniqueMissed = [...new Set(missed)]
    for (let i = 0; i < uniqueMissed.length; i++) {
      if (this.disposed) {
        return
      }
      const abs = uniqueMissed[i]!
      const rel = this.relOf(state, abs)
      if (rel === null || files.has(rel)) {
        continue
      }
      const stat = await this.scan.statFile(abs)
      if (stat) {
        const entry: VaultFileEntry = {
          path: rel, kind: 'asset', mtimeMs: stat.mtimeMs, size: stat.size, contentVersion: 1,
        }
        files.set(rel, entry)
        assetFold.set(this.foldKey(rel), entry)
      }
      if ((i + 1) % this.scanBatch === 0) {
        await this.scan.yieldToEventLoop()
      }
    }

    // 第二遍：重抽存在断链边的文件（asset 集合就绪后可能命中；逐文件幂等替换）
    for (const rel of pendingSources) {
      if (this.disposed) {
        return
      }
      const abs = absByRel.get(rel)
      if (!abs) {
        continue
      }
      const raw = await this.scan.readFileText(abs)
      if (raw === null) {
        continue
      }
      const text = normalizeLf(raw)
      const next = extractVaultEdges(rel, text, ctxOf(abs), resolveWith)
      replaceEdgesOf(edges, rel, next)
    }

    const model: VaultIndexModel = { files, edges }
    state.model = model
    state.backlinks = buildBacklinkIndex(model.edges)
    state.hasData = true
    state.scanning = false
    this.notify()
    await this.commitSnapshot(state)
  }

  // ---- 快照提交 ----

  private async commitSnapshot(state: RootIndexState): Promise<void> {
    if (this.disposed || !state.model) {
      return
    }
    const baseDir = this.baseDirOf(state)
    // prev 的片校验和表：读上一代 manifest（增量提交继承未变片）
    let prev: { generation: number; dirName: string; shardChecksums: Map<number, string> } | undefined
    if (state.meta) {
      try {
        const manifest = JSON.parse(await this.storage.readFile(`${baseDir}/${state.meta.dirName}/manifest.json`)) as {
          generation: number
          shards: Array<{ i: number; checksum: string }>
        }
        prev = {
          generation: manifest.generation,
          dirName: state.meta.dirName,
          shardChecksums: new Map(manifest.shards.map((s) => [s.i, s.checksum])),
        }
      } catch {
        prev = undefined // 上一代 manifest 不可读：按全新提交
      }
    }
    const fileCount = state.model.files.size
    const shardCount = ADAPTIVE_SHARDS.find((t) => fileCount <= t.maxFiles)!.shards
    const existingDirs = await this.storage.listDirs(baseDir)
    const plan = await planSnapshotCommitChunked(
      state.model,
      {
        baseDir,
        shardCount,
        prev,
        existingDirs,
        writerTag: randomWriterTag(),
      },
      () => this.scan.yieldToEventLoop(),
    )
    // writes 顺序即提交顺序：片 → manifest → CURRENT（唯一提交点）
    for (const w of plan.writes) {
      const dir = w.path.slice(0, Math.max(w.path.lastIndexOf('/'), 0))
      await this.storage.ensureDir(dir)
      await this.storage.writeFile(w.path, w.content)
    }
    state.meta = {
      formatVersion: plan.formatVersion,
      generation: plan.generation,
      dirName: plan.dirName,
      shardCount: plan.stats.shardCount,
      stats: { fileCount: plan.stats.fileCount, edgeCount: plan.stats.edgeCount },
    }
    // 回收旧代与 tmp- 残留（失败忽略——下一轮兜底）
    for (const dir of plan.obsoleteDirs) {
      try {
        await this.storage.removeDir(`${baseDir}/${dir}`)
      } catch {
        // 回收失败不阻塞提交
      }
    }
    this.notify()
  }

  private scheduleCommit(state: RootIndexState): void {
    if (state.commitTimer !== undefined) {
      clearTimeout(state.commitTimer)
    }
    state.commitTimer = setTimeout(() => {
      state.commitTimer = undefined
      void this.commitSnapshot(state)
    }, this.commitDebounce)
  }

  // ---- 未保存内容（覆盖层）与保存 ----

  /** 文档变更（provider 的全局 onDidChangeTextDocument 驱动；version 单调） */
  applyUnsaved(fsPath: string, version: number, text: string): void {
    const state = this.rootOf(fsPath)
    if (!state) {
      return // 工作区外文档不入索引域
    }
    const key = this.normKey(fsPath)
    // 服务层版本仲裁：迟到的旧版本事件（乱序广播）不覆盖已登记的新版本——
    // overlay.apply 是第二道防线（扫描完成时再仲裁一次）
    const pending = state.unsaved.get(key)
    if (pending && version <= pending.version) {
      return
    }
    state.unsaved.set(key, { version, text })
    const prevTimer = state.unsavedTimers.get(key)
    if (prevTimer !== undefined) {
      clearTimeout(prevTimer)
    }
    state.unsavedTimers.set(key, setTimeout(() => {
      state.unsavedTimers.delete(key)
      void this.flushUnsaved(state, key)
    }, this.unsavedDebounce))
  }

  private async flushUnsaved(state: RootIndexState, key: string): Promise<void> {
    const pending = state.unsaved.get(key)
    if (!pending || !state.hasData) {
      return
    }
    const rel = this.relOf(state, key)
    if (rel === null) {
      return
    }
    const text = normalizeLf(pending.text)
    const modelResolver = this.makeModelResolver(state)
    const edges = extractVaultEdges(rel, text, {
      docDir: this.dirname(key),
      rootDir: state.fsPath,
      isWindowsHost: this.opts.isWindowsHost,
    }, (abs) => {
      // 覆盖层解析：基线集合（md + asset，平台大小写）+ 覆盖文档自身；
      // 未登记的附件目标按断链保留（覆盖层高频路径不做 stat IO）
      const hit = modelResolver(abs)
      if (hit !== null) {
        return hit
      }
      const target = this.relOf(state, abs)
      return target !== null && this.foldKey(target) === this.foldKey(rel) ? rel : null
    })
    if (state.overlay.apply(rel, pending.version, edges)) {
      this.notify()
    }
  }

  /** 文档保存：覆盖层退役 + 磁盘基线重扫 + 合并提交快照 */
  async documentSaved(fsPath: string): Promise<void> {
    const state = this.rootOf(fsPath)
    if (!state) {
      return
    }
    const key = this.normKey(fsPath)
    const timer = state.unsavedTimers.get(key)
    if (timer !== undefined) {
      clearTimeout(timer)
      state.unsavedTimers.delete(key)
    }
    state.unsaved.delete(key)
    const rel = this.relOf(state, fsPath)
    if (rel !== null) {
      state.overlay.clear(rel)
    }
    await this.rescanFile(state, fsPath)
    this.scheduleCommit(state)
  }

  // ---- watcher / 单文件重扫 ----

  private onWatchEvent(state: RootIndexState, fsPath: string | null): void {
    if (!fsPath) {
      return
    }
    const key = this.normKey(fsPath)
    const prev = state.rescanTimers.get(key)
    if (prev !== undefined) {
      clearTimeout(prev)
    }
    state.rescanTimers.set(key, setTimeout(() => {
      state.rescanTimers.delete(key)
      void this.rescanFile(state, fsPath).then(() => this.scheduleCommit(state))
    }, this.rescanDebounce))
  }

  /** 重扫单文件（保存/外部变更/新建）；文件已删则移除其基线条目与边 */
  private async rescanFile(state: RootIndexState, fsPath: string): Promise<void> {
    if (this.disposed || !state.model) {
      return
    }
    const rel = this.relOf(state, fsPath)
    if (rel === null) {
      return
    }
    const [raw, stat] = await Promise.all([this.scan.readFileText(fsPath), this.scan.statFile(fsPath)])
    if (raw === null || stat === null) {
      // 删除或不可读：移除基线（未保存覆盖层保留——编辑器内未保存内容仍接管查询）
      if (state.model.files.has(rel)) {
        state.model.files.delete(rel)
        state.model.edges = state.model.edges.filter((e) => e.source !== rel)
        state.backlinks = buildBacklinkIndex(state.model.edges)
        this.notify()
      }
      return
    }
    const text = normalizeLf(raw)
    const prevEntry = state.model.files.get(rel)
    const edges = extractVaultEdges(rel, text, {
      docDir: this.dirname(fsPath),
      rootDir: state.fsPath,
      isWindowsHost: this.opts.isWindowsHost,
    }, this.makeModelResolver(state))
    state.model.files.set(rel, {
      path: rel,
      kind: 'markdown',
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      contentVersion: (prevEntry?.contentVersion ?? 0) + 1,
    })
    state.model.edges = state.model.edges.filter((e) => e.source !== rel).concat(edges)
    state.backlinks = buildBacklinkIndex(state.model.edges)
    this.notify()
  }

  /** 基线 resolver：model.files 键精确 + 平台折叠（覆盖层文档不在基线时按断链） */
  private makeModelResolver(state: RootIndexState) {
    const foldIndex = new Map<string, string>()
    for (const rel of state.model?.files.keys() ?? []) {
      foldIndex.set(this.foldKey(rel), rel)
    }
    return (absFsPath: string): string | null => {
      const rel = this.relOf(state, absFsPath)
      if (rel === null) {
        return null
      }
      return foldIndex.get(this.foldKey(rel)) ?? null
    }
  }

  // ---- 反链查询 ----

  /** 查询文档的反链（面板数据源；items 按来源路径/位置稳定排序） */
  async backlinksOf(fsPath: string): Promise<BacklinksResult> {
    const state = this.rootOf(fsPath)
    if (!state) {
      return { status: 'error', reason: 'no-workspace' }
    }
    if (!state.hasData || !state.model || !state.backlinks) {
      return state.scanning ? { status: 'loading' } : { status: 'error', reason: 'read-error' }
    }
    const rel = this.relOf(state, fsPath)
    if (rel === null) {
      return { status: 'error', reason: 'no-workspace' }
    }
    const edges = queryBacklinks(state.backlinks, state.overlay, rel)
    // 片段与行号：来源有未保存内容优先取其文本（覆盖层边对齐覆盖层文本），
    // 其余读盘一次（OS 缓存；CRLF 归一与抽取同口径）
    const textBySource = new Map<string, string | null>()
    for (const e of edges) {
      if (textBySource.has(e.source)) {
        continue
      }
      const abs = this.absOf(state, e.source)
      const unsaved = abs ? state.unsaved.get(this.normKey(abs)) : undefined
      if (unsaved) {
        textBySource.set(e.source, normalizeLf(unsaved.text))
        continue
      }
      textBySource.set(e.source, abs ? await this.scan.readFileText(abs) : null)
    }
    const items: BacklinkItem[] = edges.map((e) => {
      const text = textBySource.get(e.source) ?? null
      const lf = text === null ? null : normalizeLf(text)
      let line = 1
      let snippet = ''
      if (lf !== null && e.start <= lf.length) {
        const lineStart = lf.lastIndexOf('\n', Math.min(e.start, lf.length - 1)) + 1
        line = lf.slice(0, lineStart).split('\n').length
        const nl = lf.indexOf('\n', lineStart)
        const lineEnd = nl < 0 ? lf.length : nl
        snippet = lf.slice(lineStart, lineEnd)
        if (snippet.length > this.snippetLimit) {
          snippet = `${snippet.slice(0, this.snippetLimit)}…`
        }
      }
      return {
        sourceRelPath: e.source,
        sourceFsPath: this.absOf(state, e.source),
        kind: e.kind,
        anchor: e.anchor,
        start: e.start,
        end: e.end,
        line,
        snippet,
      }
    })
    return { status: 'ready', items, updating: state.scanning }
  }

  /** 根定位：最具体（最长前缀）根；归一比较（Windows 折叠） */
  private rootOf(fsPath: string): RootIndexState | undefined {
    const key = this.normKey(fsPath)
    for (const rootKey of this.rootOrder) {
      if (key === rootKey || key.startsWith(`${rootKey}/`)) {
        return this.roots.get(rootKey)
      }
    }
    return undefined
  }

  // ---- 路径工具（根内相对统一 `/` 形态；平台语义按注入配置） ----

  private get ops(): typeof path.posix {
    return this.opts.isWindowsHost ? path.win32 : path.posix
  }

  private normKey(fsPath: string): string {
    return this.ops.resolve(fsPath).replace(/\\/g, '/').replace(/\/$/, '')
  }

  /** 根内相对路径（`/` 形态）；越根 null */
  private relOf(state: RootIndexState, fsPath: string): string | null {
    const rel = this.ops.relative(this.ops.resolve(state.fsPath), this.ops.resolve(fsPath))
    if (rel === '' || rel.startsWith('..') || this.ops.isAbsolute(rel)) {
      return null
    }
    return rel.replace(/\\/g, '/')
  }

  private absOf(state: RootIndexState, rel: string): string {
    return this.ops.resolve(this.ops.resolve(state.fsPath), ...rel.split('/'))
  }

  private foldKey(rel: string): string {
    return this.opts.isWindowsHost ? rel.toLowerCase() : rel
  }

  private dirname(fsPath: string): string {
    return this.ops.dirname(this.ops.resolve(fsPath))
  }
}

/** LF 归一（读盘文本统一进 LF 坐标——与协议/边表契约一致） */
function normalizeLf(text: string): string {
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text
}

/** 原地替换指定 source 的全部边（单文件重扫/重抽的幂等替换） */
function replaceEdgesOf(edges: VaultEdge[], source: string, next: readonly VaultEdge[]): void {
  for (let i = edges.length - 1; i >= 0; i--) {
    if (edges[i]!.source === source) {
      edges.splice(i, 1)
    }
  }
  edges.push(...next)
}

/** 写者随机段（多窗口并发防撞，ADR-0008 三不变量之一） */
function randomWriterTag(): string {
  return Math.random().toString(16).slice(2, 6).padEnd(4, '0')
}
