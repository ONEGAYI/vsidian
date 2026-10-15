// 工作区引用索引宿主服务（工单 #197 建立，#198 增量维护扩展）：扫描 /
// 持久化 / 覆盖层 / 反链查询 / 调度 / 排除 / 核验 / 变化发布 / 清理重建的
// 编排核心。fs 与监听全部经端口注入（vscode 层壳见 vaultIndexWiring.ts），
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
//   planSnapshotCommitChunked 片间让出（ADR-0008 接线硬约束）；增量队列
//   与核验同样分批让出（#198）
//
// #198 增量维护语义（初值集中于 shared/vaultIndexSchedule，待测初值非时
// 限承诺）：
// - **编辑调度**：未保存编辑防抖 500ms 冲刷覆盖层；连续输入自首事件起
//   2s 强制合并一次（planFlushAt）
// - **增量队列**：保存/外部事件进入有界去重队列（容量上限；溢出降级为
//   一次清单核验——批量 Git 切换不产生无界任务）；批间让出；不与全量
//   扫描/核验重叠（busy 时挂起，完成后接力）
// - **核验**：快照恢复后（启动）、窗口焦点回归（长时间离开/断连恢复）与
//   活跃期周期（约 10 分钟）触发 mtime+size 清单比对（diffManifest）——
//   **仅筛变化，不作内容一致性证明**；移除动作必须有 accessOf=missing 的
//   正证据，不可访问（SSH 断连/权限错误）标 stale 不移除
// - **排除**：模式匹配语义单一事实源在 shared/vaultIndexExclude（服务在
//   列举后过滤；不继承 VSCode 搜索排除与 .gitignore）；排除变更触发全部
//   根覆盖范围重算（全量重扫）；被显式引用的排除位置目标仍登记（missed-
//   stat 路径按 asset 登记元数据，不递归扫描）
// - **变化发布**：按目标记录已观测变化代次（generation per target，单调
//   递增，可作 ?v= 缓存击穿参数）；onTargetChange 供宿主侧订阅（#201 图
//   片刷新复用）；索引条目消失不等于磁盘删除——只有正证据才广播 deleted
// - **维护操作**：cleanupCache 按 planCleanupDirs 安全回收旧代际（保留
//   CURRENT 代、继承源与更高代际——尊重并发窗口的活跃读者/写者）；
//   rebuildAll 全根全量重扫（重解析正文并核验资源，进度回报、可取消）
//
// #556 T2 索引身份与补查接线（ADR-0018）：
// - **目标身份**：边 resolvedTarget 升级为规范绝对身份（normKey 语义），
//   反链聚合键随身份走——跨根/外部目标不与根内目标合并、不同根同名
//   相对路径不串反链；跨根/工作区外的被引用目标以绝对键登记入 files
//   表（asset，仅元数据与被引用关系，不扫描其目录、不递归建库），其
//   失效经周期核验（accessOf 三态：missing 正证据删除 / inaccessible 只
//   stale）+ onTargetChange 覆盖（无 watcher 域，核验是唯一探测通道）
// - **短名补查**：抽取经 catalog 的 Markdown basename 倒排（代次缓存，
//   零 IO）注入端口——complete = catalogComplete（未完整不声明唯一）；
//   补查域形态学与结果映射复用 vaultLink 的同步帮手（R1 单一解析语义）
// - **文件集合变化重判**：basename → 短名边来源的内存反查表（派生不
//   持久化，与 backlinks 同点位重建）；Markdown 增删（rescanFile 新增/
//   删除、verifyRoot removed、rename 批新旧名）、清单 Markdown 条目集
//   合变化（排除/根重划/枚举漂移）与清单转完整触发——只重抽受影响
//   来源（busy 时挂起，resumeAfterBusy 接力）
// - **快照 v3**：resolvedTarget 语义域升级；v2 旧快照结构兼容加载，恢复
//   时按根轻量迁移为绝对身份并全域重判（不触发重扫）
import * as path from 'node:path'
import {
  extractVaultEdges,
  isVaultPanelOutlink,
  reresolveVaultEdgeTarget,
  shortnameDepKeyOf,
  type VaultEdgeExtractOptions,
  type VaultEdgeShortnamePort,
} from './vaultLinkExtract'
import type { VaultLinkShortnameLookupResult } from '../shared/vaultLink'
import type { LinkContext } from './linkTarget'
import { queryBacklinks, VaultIndexOverlay } from './vaultIndexOverlay'
import {
  buildBacklinkIndex,
  loadSnapshot,
  planCleanupDirs,
  planSnapshotCommitChunked,
  rootKeyOf,
  type VaultEdge,
  type VaultFileEntry,
  type VaultIndexFsPort,
  type VaultIndexModel,
  type SnapshotMeta,
} from '../shared/vaultIndexSnapshot'
import { compileExcludeMatcher, type ExcludeMatcher } from '../shared/vaultIndexExclude'
import {
  BoundedKeyQueue,
  diffManifest,
  planFlushAt,
  SCHEDULE_DEFAULTS,
} from '../shared/vaultIndexSchedule'
import {
  defaultAliasOf,
  planWikilinkInsertPath,
  prepareWikilinkQuery,
  rankWikilinkCandidates,
  wikilinkFileCandidateSafe,
  type WikilinkCandidateFile,
  type WikilinkInsertPathMode,
  type WikilinkInsertPathOptions,
} from '../shared/wikilinkQuery'
import {
  classifyVaultFileCategory,
  isCommonVaultFileCategory,
  type VaultFileCategory,
} from '../shared/vaultFileCategory'
import {
  diffVaultCatalog,
  parseVaultCatalog,
  serializeVaultCatalog,
  type VaultCatalogEntry,
} from '../shared/vaultFileCatalog'
import type { WikilinkCandidateItem } from '../shared/protocol'
import { WIKILINK_QUERY_LIMIT } from '../shared/protocol'

export { WIKILINK_QUERY_LIMIT }

/** 工作区根引用（wiring 层已按 vscode 语义对语法异构同指向 URI 去重） */
export interface VaultRootRef {
  fsPath: string
  /** 根 URI 字符串（rootKeyOf 输入；file scheme） */
  uri: string
}

/** 扫描端口（vscode 层壳实现；排除过滤在服务侧统一执行——语义单一事实源
 *  在 shared/vaultIndexExclude，端口只负责列举/读取/探测） */
export interface VaultIndexScanPort {
  /** 列根内全部 Markdown（绝对 fsPath，磁盘真实形态；含将被排除者） */
  listMarkdownFiles(rootFsPath: string): Promise<string[]>
  /** 列根内全部普通文件（#377 T02 全文件清单；含将被排除者）。skipDir
   *  为服务侧注入的目录剪枝判定（排除语义单一事实源不进端口）；failedDirs
   *  为读取失败的目录（不可访问——不冒充其下文件删除）。 */
  listAllFiles(
    rootFsPath: string,
    opts?: { skipDir?: (fsPath: string) => boolean },
  ): Promise<{ files: string[]; failedDirs: string[] }>
  /** 读文件 utf-8 文本；失败/不存在 null（原样返回，CRLF 由服务归一） */
  readFileText(fsPath: string): Promise<string | null>
  /** stat（mtime/size——快照条目与增量筛选；birthtimeMs 可选：Windows 宿主
   *  取创建时间，POSIX 常不可得缺省）；失败 null。type 可选区分文件/目录
   *  （#377 T02 清单事件维护：目录事件不入清单；缺省按文件对待——兼容
   *  既有测试桩与只关心 md 的调用面）。 */
  statFile(fsPath: string): Promise<{
    mtimeMs: number
    size: number
    birthtimeMs?: number
    type?: 'file' | 'dir'
  } | null>
  /** 可访问性探测（#198）：区分「明确不存在」与「不可访问」（SSH 断连/
   *  权限错误）——后者不得等同删除。 */
  accessOf(fsPath: string): Promise<'ok' | 'missing' | 'inaccessible'>
  /** 递归监听根内文件变更（#377 T02 起全文件域 watcher：md 走既有增量
   *  重扫管道，非 md 只维护全文件清单；保存/删除/外部修改触发回调） */
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
  /** 短片段起点（LF 全文偏移；命中高亮的区间切分基准） */
  snippetStart: number
  /** 来源文件 mtime（毫秒；未知 0）——面板分组排序键 */
  sourceMtimeMs: number
  /** 来源文件创建时间（毫秒；未知 0——POSIX 常不可得，排序沉底） */
  sourceBirthtimeMs: number
  /** 长片段（引用行 ±2 行，总长上限约 300 字符，首尾按截断加「…」） */
  snippetLong: string
  /** 长片段起点（LF 全文偏移） */
  snippetLongStart: number
}

/** 出链条目（查询结果；出链面板数据源） */
export interface OutlinkItem {
  /** 目标显示名：命中取 basename 去扩展名；断链用 target 原文 */
  targetDisplay: string
  /** 命中的根内相对路径；断链 null */
  targetRelPath: string | null
  /** 目标绝对 fsPath；断链 null */
  targetFsPath: string | null
  kind: VaultEdge['kind']
  anchor: string
  resolved: boolean
  start: number
  end: number
}

/** 反链查询结果（面板四态的数据面：loading/无引用(ready+空)/updating/error） */
export type BacklinksResult =
  | { status: 'ready'; items: BacklinkItem[]; updating: boolean }
  | { status: 'loading' }
  | { status: 'error'; reason: 'no-workspace' | 'read-error' }

/** 出链查询结果（面板四态数据面；形态与 BacklinksResult 镜像） */
export type OutlinksResult =
  | { status: 'ready'; items: OutlinkItem[]; updating: boolean }
  | { status: 'loading' }
  | { status: 'error'; reason: 'no-workspace' | 'read-error' }

/** 目标变化状态：changed=观测到元数据/内容变化；deleted=有正证据的磁盘
 *  删除（来源断链保留）；stale=核验失败（不可访问——SSH 断连/权限错误，
 *  不得等同删除，条目保留）。 */
export type VaultTargetChangeStatus = 'changed' | 'deleted' | 'stale'

/**
 * 目标变化事件（#198 变化发布通道；#201 图片刷新消费）。
 * generation 为同一目标的已观测变化代次（单调递增；首观测为 1）——
 * 可作 ?v= 缓存击穿参数（webview 资源服务不承诺无缓存）。收到事件的
 * 订阅者即使元数据相同也应失效（防 mtime 粒度漏检——#194 图片节）。
 */
export interface VaultTargetChangeEvent {
  /** 绝对路径（宿主文件系统形态——宿主侧订阅者的资源身份） */
  fsPath: string
  /** 所属根 fsPath */
  rootFsPath: string
  /** 根内相对路径（索引域身份，`/` 形态） */
  relPath: string
  generation: number
  status: VaultTargetChangeStatus
  /** 已观测元数据（deleted 为 null；stale 携带最后已知的成功 stat） */
  stat: { mtimeMs: number; size: number } | null
}

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
  /** 当前全量扫描的所有权；旧轮结束不得清掉新轮的 busy 状态。 */
  scanOwner: symbol | undefined
  hasData: boolean
  unwatch: (() => void) | null
  /** 快照合并提交去抖定时器 */
  commitTimer: ReturnType<typeof setTimeout> | undefined
  /** 文件级重扫去抖（fsPath 归一键 → timer） */
  rescanTimers: Map<string, ReturnType<typeof setTimeout>>
  /** 未保存文档的最新文本（去抖窗口内） */
  unsaved: Map<string, { version: number; text: string }>
  /** 首个未冲刷事件时刻（强制合并窗口起点；键同 unsaved） */
  unsavedSince: Map<string, number>
  unsavedTimers: Map<string, ReturnType<typeof setTimeout>>
  /** 增量重扫任务队列（有界去重） */
  rescanQueue: BoundedKeyQueue
  /** 增量队列泵在跑 */
  pumping: boolean
  /** 泵的当前轮 Promise（documentSaved 等待排空用） */
  pumpRun: Promise<void> | undefined
  /** 扫描/核验期间到达的队列任务（完成后接力泵） */
  pumpPending: boolean
  /** 清单核验进行中 */
  verifying: boolean
  /** 泵忙碌时错过的核验请求（溢出降级触发；泵完成后补跑） */
  verifyPending: boolean
  // ---- #377 T02 全文件清单 ----
  /** 根内相对路径 → 清单条目（null = 尚未枚举；查询回退现有索引模型） */
  catalog: Map<string, VaultCatalogEntry> | null
  /** 清单枚举/重算进行中（查询可用项继续候选 + updating 标注） */
  catalogScanning: boolean
  /** 当前清单枚举的所有权（旧轮不得发布过期模型/复位新轮状态） */
  catalogOwner: symbol | undefined
  /** 最近一次枚举无失败目录（部分就绪不冒充完整——不参与移除 diff） */
  catalogComplete: boolean
  /** 清单代次（创建/删除/改名/排除修改/根增删/重连/周期核验递增；查询
   *  结果携带，旧枚举/旧 stat/旧查询不得复活已删除身份） */
  catalogGen: number
  /** 清单增量提交去抖定时器（事件/核验触发的合并写盘） */
  catalogCommitTimer: ReturnType<typeof setTimeout> | undefined
  /** 非 md 文件事件去抖（md 事件走既有 rescanTimers 增量管道） */
  catalogTimers: Map<string, ReturnType<typeof setTimeout>>
  /** 清单扫描期间到达的文件事件（发布后重放——闭掉「扫描窗口漏事件」） */
  catalogPendingEvents: Set<string>
  // ---- #556 T2 短名补查与文件集合重判 ----
  /** basename（fold 后、含扩展名）→ 引用了该 basename 纯文件名目标的来源
   *  rel 集合（派生数据不持久化，与 backlinks 同点位重建）——文件集合变化
   *  后只重抽受影响来源，不全库重扫 */
  shortnameDeps: Map<string, Set<string>>
  /** 清单 Markdown basename 倒排（fold(basename) → rels；代次缓存——
   *  catalogGen 变化时重建，补查端口零 IO 查询的载体） */
  catalogNameIndex: { gen: number; index: Map<string, string[]> } | null
  /** 清单转完整等触发的全域短名重判在 busy（扫描/核验/泵）期间挂起，由
   *  resumeAfterBusy 接力消费（'all' = 全部短名边来源；集合 = 受影响
   *  basename 的 fold 键） */
  pendingShortnameRejudge: 'all' | Set<string> | null
}

export interface VaultIndexServiceOptions {
  /** 快照存储根（fsPath；实际分区 = <storageRoot>/vsidian-index/<rootKey>） */
  storageRoot: string
  /** 宿主文件系统语义（Windows 本地 true；远程一律 false） */
  isWindowsHost: boolean
  /** 扫描批大小（每批之间让出事件循环）；缺省 24 */
  scanBatchFiles?: number
  /** 未保存编辑防抖 ms；缺省 500（#194 待测初值） */
  unsavedDebounceMs?: number
  /** 连续输入强制合并上限 ms（自首个未冲刷事件起算）；缺省 2000 */
  unsavedMaxWaitMs?: number
  /** 文件重扫去抖 ms；缺省 800 */
  rescanDebounceMs?: number
  /** 快照合并提交去抖 ms；缺省 1500 */
  commitDebounceMs?: number
  /** 片段截断长度；缺省 160 */
  snippetLimit?: number
  /** 增量队列容量；缺省 SCHEDULE_DEFAULTS.rescanQueueCapacity */
  rescanQueueCapacity?: number
  /** 增量队列每批文件数；缺省 SCHEDULE_DEFAULTS.rescanBatchFiles */
  rescanBatchFiles?: number
  /** 核验清单每批 stat 数；缺省 SCHEDULE_DEFAULTS.verifyBatchFiles */
  verifyBatchFiles?: number
  /** 周期核验间隔 ms；缺省约 10 分钟（低优先级补漏初值） */
  verifyIntervalMs?: number
  /** 焦点回归触发核验的最小间隔 ms；缺省 SCHEDULE_DEFAULTS */
  verifyFocusRegainMinGapMs?: number
  /** 初始排除模式（activate 从持久化读入；缺省不排除） */
  excludePatterns?: readonly string[]
  /** 文档是否打开（宿主 textDocuments 在场探测）；缺省视为在场（不启用
   *  关闭残渣兜底——node 单测无宿主文档概念，行为与历史一致） */
  isDocOpen?: (fsPath: string) => boolean
}

const ADAPTIVE_SHARDS: readonly { maxFiles: number; shards: number }[] = [
  { maxFiles: 10_000, shards: 16 },
  { maxFiles: 100_000, shards: 64 },
  { maxFiles: Number.MAX_SAFE_INTEGER, shards: 256 },
]

/** 长片段（「更多上下文」态）参数：引用行 ±2 行窗口，总长上限约 300 字符 */
const SNIPPET_LONG_CONTEXT_LINES = 2
export const SNIPPET_LONG_LIMIT = 300

/** 根内相对路径（`/` 分隔）的 basename 去扩展名（出链目标显示名） */
function basenameNoExt(relPath: string): string {
  const base = relPath.slice(relPath.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(0, dot) : base
}

/** 反斜杠分隔符统一为 `/`——索引抽象路径形态的原子归一步（Windows fsPath
 *  专用；posix 路径不含反斜杠，替换为恒等）。只收敛分隔符形态这一个同形
 *  步骤：大小写折叠（foldKey / vaultRenameWiring 的 normKeyOf）、resolve
 *  与去尾斜杠（normKey）等调用方各自的归一范围不在此合并，语义差异保留。 */
export function normalizeSeparators(fsPath: string): string {
  return fsPath.replace(/\\/g, '/')
}

/** 规范绝对身份（索引域 `/` 分隔）→ 宿主 fsPath 形态（normalizeSeparators
 *  的形态互逆：Windows 宿主反斜杠、POSIX 原样；大小写与内容不变）。宿主
 *  接线层把索引身份用于「打开/探测/日志/提示」等 fsPath 语义场合前转换
 *  （vscode.Uri.file(id).fsPath 的纯等价——集成 #556 收口钉住：跳转日志
 *  期望宿主形态，直接透传索引 `/` 形态即断言失败）；索引与纯逻辑层不
 *  感知（单一身份域不因此分叉）。 */
export function vaultIdentityToFsPath(identity: string, isWindowsHost: boolean): string {
  return isWindowsHost ? identity.replace(/\//g, '\\') : identity
}

export class VaultIndexService {
  private readonly roots = new Map<string, RootIndexState>()
  /** 按深度降序的根键列表（最具体根优先匹配） */
  private rootOrder: string[] = []
  private readonly listeners = new Set<() => void>()
  private disposed = false
  private readonly scanBatch: number
  private readonly unsavedDebounce: number
  private readonly unsavedMaxWait: number
  private readonly rescanDebounce: number
  private readonly commitDebounce: number
  private readonly snippetLimit: number
  private readonly rescanQueueCapacity: number
  private readonly rescanBatchFiles: number
  private readonly verifyBatchFiles: number
  private readonly verifyIntervalMs: number
  private readonly verifyFocusRegainMinGapMs: number

  // ---- #198 维护状态 ----
  /** 排除模式（清洗后）与编译匹配器 */
  private excludePatterns: readonly string[] = []
  private excludeMatcher: ExcludeMatcher
  /** 维护代际：每次取消/覆盖范围重算/重建递增——在途长任务批间检查，
   *  不匹配即中止（不与新一轮维护交叠） */
  private maintenanceEpoch = 0
  /** 目标 → 已观测变化代次（变化发布通道；session 内单调） */
  private readonly targetGenerations = new Map<string, number>()
  private readonly targetListeners = new Set<(event: VaultTargetChangeEvent) => void>()
  /** 已标 stale 的目标（去重：持续不可访问不重复广播） */
  private readonly staleMarks = new Set<string>()
  /** 周期核验定时器（活跃期低优先级补漏） */
  private verifyTimer: ReturnType<typeof setInterval> | undefined
  private lastVerifyAt = 0
  /** 窗口活跃（焦点）状态——wiring 经 onDidChangeWindowState 接线 */
  private windowActive = true
  /** 完整重建进行中（互斥重建） */
  private rebuilding = false

  constructor(
    private readonly scan: VaultIndexScanPort,
    private readonly storage: VaultIndexStoragePort,
    private readonly opts: VaultIndexServiceOptions,
  ) {
    this.scanBatch = opts.scanBatchFiles ?? 24
    this.unsavedDebounce = opts.unsavedDebounceMs ?? SCHEDULE_DEFAULTS.unsavedDebounceMs
    this.unsavedMaxWait = opts.unsavedMaxWaitMs ?? SCHEDULE_DEFAULTS.unsavedMaxWaitMs
    this.rescanDebounce = opts.rescanDebounceMs ?? SCHEDULE_DEFAULTS.rescanDebounceMs
    this.commitDebounce = opts.commitDebounceMs ?? SCHEDULE_DEFAULTS.commitDebounceMs
    this.snippetLimit = opts.snippetLimit ?? 160
    this.rescanQueueCapacity = opts.rescanQueueCapacity ?? SCHEDULE_DEFAULTS.rescanQueueCapacity
    this.rescanBatchFiles = opts.rescanBatchFiles ?? SCHEDULE_DEFAULTS.rescanBatchFiles
    this.verifyBatchFiles = opts.verifyBatchFiles ?? SCHEDULE_DEFAULTS.verifyBatchFiles
    this.verifyIntervalMs = opts.verifyIntervalMs ?? SCHEDULE_DEFAULTS.verifyIntervalMs
    this.verifyFocusRegainMinGapMs =
      opts.verifyFocusRegainMinGapMs ?? SCHEDULE_DEFAULTS.verifyFocusRegainMinGapMs
    this.excludePatterns = [...(opts.excludePatterns ?? [])]
    this.excludeMatcher = compileExcludeMatcher(this.excludePatterns, { foldCase: opts.isWindowsHost })
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
      this.roots.set(key, this.freshState(root))
    }
    this.rootOrder = [...this.roots.keys()].sort((a, b) => b.length - a.length)
    for (const state of this.roots.values()) {
      if (this.disposed) {
        return
      }
      state.unwatch = this.scan.watchRoot(state.fsPath, (fsPath) => this.onWatchEvent(state, fsPath))
      await this.recoverOrScan(state)
    }
    // 活跃期周期核验（约 10 分钟；低优先级——非活跃期挂起、busy 跳过）
    if (this.verifyIntervalMs > 0 && this.verifyTimer === undefined && !this.disposed) {
      this.verifyTimer = setInterval(() => {
        if (this.disposed || !this.windowActive) {
          return
        }
        void this.verifyNow()
      }, this.verifyIntervalMs)
    }
  }

  /** 根集合变更（onDidChangeWorkspaceFolders 域）：新增根扫描纳入、移除根
   *  停监听退出索引域（快照留在磁盘，显式清理才回收）。集合有变时对全部
   *  存留根做**覆盖范围重算**（#194「根增删后重新判断覆盖范围」）——嵌套
   *  根新增/移除会改变既存根的归属边界，父根已索引的文件须重新划分。 */
  async setRoots(roots: readonly VaultRootRef[]): Promise<void> {
    if (this.disposed) {
      return
    }
    const wanted = new Map<string, VaultRootRef>()
    for (const root of roots) {
      const key = this.normKey(root.fsPath)
      if (!wanted.has(key)) {
        wanted.set(key, root)
      }
    }
    let changed = false
    for (const key of [...this.roots.keys()]) {
      if (wanted.has(key)) {
        continue
      }
      const state = this.roots.get(key)!
      this.teardownState(state)
      this.roots.delete(key)
      changed = true
    }
    for (const [key, root] of wanted) {
      if (this.roots.has(key) || this.disposed) {
        continue
      }
      this.roots.set(key, this.freshState(root))
      this.rootOrder = [...this.roots.keys()].sort((a, b) => b.length - a.length)
      const state = this.roots.get(key)!
      state.unwatch = this.scan.watchRoot(state.fsPath, (fsPath) => this.onWatchEvent(state, fsPath))
      await this.recoverOrScan(state)
      changed = true
    }
    this.rootOrder = [...this.roots.keys()].sort((a, b) => b.length - a.length)
    if (!changed) {
      return
    }
    // 覆盖范围重算：全部存留根全量重扫（归属边界变化后重新划分；快照增量
    // 继承使未变片不重写，成本可控——根集合变更是低频事件）
    this.maintenanceEpoch++
    const epoch = this.maintenanceEpoch
    for (const state of this.roots.values()) {
      if (this.disposed || epoch !== this.maintenanceEpoch) {
        return
      }
      await this.fullScan(state, { epoch })
      // #377 T02：根增删改变覆盖范围——清单同轮重算
      await this.scanCatalog(state, epoch)
    }
    this.notify()
  }

  dispose(): void {
    this.disposed = true
    this.maintenanceEpoch++ // 中止在途核验/队列/重建
    if (this.verifyTimer !== undefined) {
      clearInterval(this.verifyTimer)
      this.verifyTimer = undefined
    }
    for (const state of this.roots.values()) {
      this.teardownState(state)
    }
  }

  /** 模型变化通知（provider 广播全部 ready 面板用） */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * 目标变化订阅（#201 图片刷新复用）：覆盖层/重扫/核验/重建观测到的
   * 磁盘目标变化（changed/deleted/stale）逐条发布；返回退订函数。
   */
  onTargetChange(listener: (event: VaultTargetChangeEvent) => void): () => void {
    this.targetListeners.add(listener)
    return () => this.targetListeners.delete(listener)
  }

  // ---- 维护观测与操作（设置页 / 宿主命令 / 测试钩子共用） ----

  /** 当前排除模式（清洗后形态） */
  getExcludePatterns(): readonly string[] {
    return this.excludePatterns
  }

  /** 维护观测（设置页状态与测试钩子） */
  maintenanceInfo(): {
    excludePatterns: readonly string[]
    rebuilding: boolean
    roots: Array<{
      fsPath: string
      hasData: boolean
      scanning: boolean
      verifying: boolean
      queued: number
      fileCount: number
      edgeCount: number
      /** #377 T02 全文件清单观测：条目数（null 为 0）、枚举/完整性状态与代次 */
      catalogFileCount: number
      catalogScanning: boolean
      catalogComplete: boolean
      catalogGeneration: number
    }>
  } {
    return {
      excludePatterns: this.excludePatterns,
      rebuilding: this.rebuilding,
      roots: [...this.roots.values()].map((state) => ({
        fsPath: state.fsPath,
        hasData: state.hasData,
        scanning: state.scanning,
        verifying: state.verifying,
        queued: state.rescanQueue.size,
        fileCount: state.model?.files.size ?? 0,
        edgeCount: state.model?.edges.length ?? 0,
        catalogFileCount: state.catalog?.size ?? 0,
        catalogScanning: state.catalogScanning,
        catalogComplete: state.catalogComplete,
        catalogGeneration: state.catalogGen,
      })),
    }
  }

  /**
   * 排除模式变更：更新匹配器并触发**全部根覆盖范围重算**（全量重扫）。
   * 在途增量/核验/扫描被中止（代际递增），新一轮扫描以新覆盖域为准。
   */
  async setExcludePatterns(patterns: readonly string[]): Promise<void> {
    this.excludePatterns = [...patterns]
    this.excludeMatcher = compileExcludeMatcher(this.excludePatterns, { foldCase: this.opts.isWindowsHost })
    this.maintenanceEpoch++
    const epoch = this.maintenanceEpoch
    for (const state of this.roots.values()) {
      if (this.disposed || epoch !== this.maintenanceEpoch) {
        return
      }
      state.rescanQueue.clear()
      // 新近排除的文档：覆盖层条目退役（不再作为反链来源）
      for (const rel of [...state.overlay.entriesOf().keys()]) {
        if (this.excludeMatcher.test(rel)) {
          state.overlay.clear(rel)
        }
      }
      await this.fullScan(state, { epoch })
      // #377 T02：排除变更触发清单覆盖范围重算（epoch 守卫——旧枚举不发布）
      await this.scanCatalog(state, epoch)
    }
    this.notify()
  }

  /** 立即核验全部根（busy 根跳过——不与扫描/泵重叠）；设置页手动入口与
   *  焦点回归共用 */
  async verifyNow(): Promise<void> {
    for (const state of this.roots.values()) {
      if (this.disposed) {
        return
      }
      await this.verifyRoot(state)
    }
  }

  /**
   * 清理当前工作区索引缓存：按 planCleanupDirs 安全回收各根分区下的旧
   * 代际与 tmp- 残留——保留 CURRENT 指向代、其继承链引用的全部实体目录
   * 与更高代际（并发窗口可能在途提交；无 CURRENT 时保留最高代号目录），
   * 不删活跃文件；健康缓存不按固定天数失效。
   */
  async cleanupCache(): Promise<{ removedDirs: number }> {
    let removedDirs = 0
    for (const state of this.roots.values()) {
      if (this.disposed) {
        break
      }
      const baseDir = this.baseDirOf(state)
      let currentDir: string | null = null
      try {
        currentDir = (await this.storage.readFile(`${baseDir}/CURRENT`)).trim() || null
      } catch {
        currentDir = null
      }
      const inheritSources = new Set<string>()
      if (currentDir !== null) {
        try {
          const manifest = JSON.parse(await this.storage.readFile(`${baseDir}/${currentDir}/manifest.json`)) as {
            shards?: Array<{ inheritedFrom?: string | null }>
          }
          for (const shard of manifest.shards ?? []) {
            if (shard.inheritedFrom) {
              inheritSources.add(shard.inheritedFrom)
            }
          }
        } catch {
          // manifest 不可读：只保留 CURRENT 代（保守回收其余）
        }
      }
      const dirs = await this.storage.listDirs(baseDir)
      const files = await this.storage.listFiles?.(baseDir) ?? []
      for (const dir of planCleanupDirs({
        currentDirName: currentDir,
        inheritSources: [...inheritSources],
        existingDirs: dirs,
        ...(files.length > 0 ? { existingFiles: files } : {}),
      })) {
        try {
          await this.storage.removeDir(`${baseDir}/${dir}`)
          removedDirs++
        } catch {
          // 回收失败不阻塞清理；残留由下一轮回收兜底
        }
      }
    }
    return { removedDirs }
  }

  /**
   * 完整重建：全部根全量重扫（重新解析正文并核验资源）。进度经 onProgress
   * 回报（done/total 为已处理/总计 Markdown 数）；cancelMaintenance 可中止
   * （返回 'cancelled'——模型保持上次完整数据，不清空基线）。
   */
  async rebuildAll(
    onProgress?: (progress: { done: number; total: number }) => void,
  ): Promise<'done' | 'cancelled' | 'busy'> {
    if (this.rebuilding) {
      return 'busy'
    }
    this.rebuilding = true
    this.maintenanceEpoch++ // 中止在途增量/核验/扫描，避免交叠
    const epoch = this.maintenanceEpoch
    try {
      let offset = 0
      for (const state of this.roots.values()) {
        if (this.disposed || epoch !== this.maintenanceEpoch) {
          return 'cancelled'
        }
        await this.fullScan(state, {
          epoch,
          onProgress: (done, total) => onProgress?.({ done: offset + done, total: offset + total }),
        })
        // fullScan 在代际失配时静默中止（模型保持旧数据）——此处显式判定
        if (this.disposed || epoch !== this.maintenanceEpoch) {
          return 'cancelled'
        }
        // #377 T02：完整重建核验资源——清单同轮重算
        await this.scanCatalog(state, epoch)
        if (this.disposed || epoch !== this.maintenanceEpoch) {
          return 'cancelled'
        }
        offset += state.model?.files.size ?? 0
      }
      return 'done'
    } finally {
      this.rebuilding = false
    }
  }

  /** 取消在途维护操作（核验/增量队列/重建在批间检查代际并中止） */
  cancelMaintenance(): void {
    this.maintenanceEpoch++
  }

  /**
   * 窗口活跃状态（wiring 经 vscode.window.onDidChangeWindowState 接线）。
   * 失焦挂起周期核验；长时间离开后焦点回归触发一次核验（断连/离开恢复）。
   */
  setActive(active: boolean): void {
    if (this.disposed || active === this.windowActive) {
      return
    }
    this.windowActive = active
    if (active && Date.now() - this.lastVerifyAt >= this.verifyFocusRegainMinGapMs) {
      void this.verifyNow()
    }
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      listener()
    }
  }

  // ---- 恢复与全量扫描 ----

  private freshState(root: VaultRootRef): RootIndexState {
    return {
      fsPath: root.fsPath,
      uri: root.uri,
      model: null,
      backlinks: null,
      overlay: new VaultIndexOverlay(),
      meta: null,
      scanning: false,
      scanOwner: undefined,
      hasData: false,
      unwatch: null,
      commitTimer: undefined,
      rescanTimers: new Map(),
      unsaved: new Map(),
      unsavedSince: new Map(),
      unsavedTimers: new Map(),
      rescanQueue: new BoundedKeyQueue(this.rescanQueueCapacity),
      pumping: false,
      pumpRun: undefined,
      pumpPending: false,
      verifying: false,
      verifyPending: false,
      catalog: null,
      catalogScanning: false,
      catalogOwner: undefined,
      catalogComplete: false,
      catalogGen: 0,
      catalogCommitTimer: undefined,
      catalogTimers: new Map(),
      catalogPendingEvents: new Set(),
      shortnameDeps: new Map(),
      catalogNameIndex: null,
      pendingShortnameRejudge: null,
    }
  }

  private teardownState(state: RootIndexState): void {
    state.unwatch?.()
    state.unwatch = null
    if (state.commitTimer !== undefined) {
      clearTimeout(state.commitTimer)
      state.commitTimer = undefined
    }
    if (state.catalogCommitTimer !== undefined) {
      clearTimeout(state.catalogCommitTimer)
      state.catalogCommitTimer = undefined
    }
    for (const timer of state.rescanTimers.values()) {
      clearTimeout(timer)
    }
    for (const timer of state.unsavedTimers.values()) {
      clearTimeout(timer)
    }
    for (const timer of state.catalogTimers.values()) {
      clearTimeout(timer)
    }
    state.rescanTimers.clear()
    state.unsavedTimers.clear()
    state.catalogTimers.clear()
    state.unsaved.clear()
    state.unsavedSince.clear()
    state.rescanQueue.clear()
  }

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
        // v2 → v3 轻量迁移（#556 T2）：旧快照的 resolvedTarget 为根内相对
        // 形态——按本根重建为规范绝对身份（结构同源不重扫，旧索引可重建
        // 边界不变）；迁移后旧规则下的断链短名边按新语义重判（清单就绪后）
        const migrated = loaded.meta.formatVersion === 2
        if (migrated) {
          for (const e of loaded.model.edges) {
            if (e.resolvedTarget !== null) {
              e.resolvedTarget = this.identityOf(state, e.resolvedTarget)
            }
          }
        }
        state.model = loaded.model
        state.meta = loaded.meta
        this.refreshDerived(state)
        state.hasData = true
        state.scanning = false
        this.notify()
        // #377 T02 全文件清单：恢复或重建（与引用关系独立——清单就绪不
        // 撑引用就绪，反之亦然）。先于核验完成：变更文件的重扫依赖清单
        // 补查端口（#556 T2——空清单抽边会产生滞留断链边）
        await this.ensureCatalog(state)
        if (migrated && !this.disposed && state.hasData) {
          // v2 边是旧规则（无补查/无绝对目标）产物：清单就绪后全域重判一次
          // （幂等重抽；busy 时挂起接力）
          void this.runShortnameRejudge(state, 'all')
        }
        // 启动核验（#198）：快照恢复不读正文——停机窗口内的漂移由清单比对
        // 检出（mtime+size 仅筛变化；后台执行，不阻塞激活）
        void this.verifyRoot(state)
        return
      }
    } catch {
      // 快照读取异常按全损处理（索引是可重建缓存）
    }
    // 清单枚举（纯名称）与正文扫描并发——名称枚举不等待 Markdown 出链
    // 核验完成（清单就绪与引用关系就绪分别标记，ADR-0013）
    await Promise.all([this.fullScan(state), this.ensureCatalog(state)])
  }

  /** 全量扫描：分批读盘抽取（批间让出）→ 附件登记（两遍法）→ 快照提交。
   *  epoch 不匹配（取消/新一轮维护）时中止，模型保持上次完整数据。
   *  模型发布后仍忙至提交结束；只有当前扫描能在 finally 复位并接力。 */
  private async fullScan(
    state: RootIndexState,
    runOpts: { epoch?: number; onProgress?: (done: number, total: number) => void } = {},
  ): Promise<void> {
    const epoch = runOpts.epoch ?? this.maintenanceEpoch
    const scanOwner = Symbol()
    const cancelled = (): boolean => this.disposed || epoch !== this.maintenanceEpoch || state.scanOwner !== scanOwner
    state.scanOwner = scanOwner
    state.scanning = true
    state.rescanQueue.clear() // 全量重扫涵盖增量任务，排空避免重复
    this.notify()
    try {
      // 嵌套根划分 + 排除过滤：父根扫描排除「实际属于更具体根」的文件
      // （rootOrder 深度降序保证 rootOf 取最具体根）与命中排除模式的文件
      const listed = (await this.scan.listMarkdownFiles(state.fsPath)).filter((abs) => {
        const rel = this.relOf(state, abs)
        return rel !== null && this.rootOf(abs) === state && !this.excludeMatcher.test(rel)
      })
      const foldIndex = new Map<string, string>() // fold(identity) → identity（md collection；#556 T2 identity domain）
      const absByRel = new Map<string, string>()
      for (const abs of listed) {
        const rel = this.relOf(state, abs)
        if (rel !== null) {
          const identity = this.identityOf(state, rel)
          foldIndex.set(this.foldKey(identity), identity)
          absByRel.set(rel, abs)
        }
      }
      const files = new Map<string, VaultFileEntry>()
      const edges: VaultEdge[] = []
      /** 附件登记：fold(身份) → 身份（两遍法的第二遍起可见；#556 T2 起
       *  键域为规范绝对身份——根内附件与外部/跨根目标同域，resolver 统一
       *  命中） */
      const assetFold = new Map<string, string>()
      /** 第一遍 miss 的候选（绝对形态；stat 后决定是否登记 asset——含被
       *  显式引用的排除位置目标与跨根/工作区外目标：登记元数据，不递归
       *  扫描） */
      const missed: string[] = []
      /** 存在断链边的来源 rel（第二遍重抽——asset 登记后可能命中） */
      const pendingSources = new Set<string>()

      /** 相对候选解析端口（#556 T2 起返回规范绝对身份）：根内 md/asset
       *  折叠命中；归属更具体根（嵌套根）的目标不解析不登记（各根独立
       *  资源边界的既有边界，不因绝对身份升级放宽） */
      const resolveWith = (absFsPath: string): string | null => {
        const rel = this.relOf(state, absFsPath)
        if (rel === null || this.rootOf(absFsPath) !== state) {
          return null
        }
        const key = this.foldKey(this.normKey(absFsPath))
        const mdHit = foldIndex.get(key)
        if (mdHit !== undefined) {
          return mdHit
        }
        const assetHit = assetFold.get(key)
        if (assetHit !== undefined) {
          return assetHit
        }
        missed.push(absFsPath)
        return null
      }

      /** 绝对路径目标解析端口（#556）：显式绝对形态的目标允许跨根与工作
       *  区外——根内照常命中，根外查绝对登记表，未登记者入 missed 供登记
       *  （相对候选落在嵌套根不触发该端口——相对与绝对的跨根边界分立） */
      const resolveAbsoluteWith = (absFsPath: string): string | null => {
        const rel = this.relOf(state, absFsPath)
        if (rel !== null && this.rootOf(absFsPath) === state) {
          const key = this.foldKey(this.normKey(absFsPath))
          const mdHit = foldIndex.get(key)
          if (mdHit !== undefined) {
            return mdHit
          }
          const assetHit = assetFold.get(key)
          if (assetHit !== undefined) {
            return assetHit
          }
          missed.push(absFsPath)
          return null
        }
        const key = this.foldKey(this.normKey(absFsPath))
        const hit = assetFold.get(key)
        if (hit !== undefined) {
          return hit
        }
        missed.push(absFsPath)
        return null
      }

      /** 短名补查端口（#556 T2）：实时读清单（扫描与清单枚举并发——清单
       *  中途就绪后后续来源自动可用；未就绪返回空候选） */
      const lookupShortname: VaultEdgeShortnamePort = (basename) => {
        const hits = this.mdBasenameIndexOf(state).get(this.foldKey(basename)) ?? []
        const candidates: string[] = []
        for (const rel of hits) {
          candidates.push(this.identityOf(state, rel))
        }
        return { candidates, complete: state.catalogComplete }
      }
      const extractOptions: VaultEdgeExtractOptions = { lookupShortname, resolveAbsolute: resolveAbsoluteWith }

      const ctxOf = (abs: string) => ({
        docDir: this.dirname(abs),
        rootDir: state.fsPath,
        isWindowsHost: this.opts.isWindowsHost,
      })

      // 第一遍：md 互解析（附件目标 miss 收集）
      const mdList = [...absByRel.keys()].sort()
      for (let i = 0; i < mdList.length; i++) {
        if (cancelled()) {
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
        const docEdges = extractVaultEdges(rel, text, ctxOf(abs), resolveWith, extractOptions)
        edges.push(...docEdges)
        files.set(rel, {
          path: rel,
          kind: 'markdown',
          mtimeMs: stat?.mtimeMs ?? 0,
          size: stat?.size ?? 0,
          contentVersion: 1,
          ...this.birthtimeOf(stat),
        })
        if (docEdges.some((e) => e.resolvedTarget === null)) {
          pendingSources.add(rel)
        }
        runOpts.onProgress?.(i + 1, mdList.length)
        if ((i + 1) % this.scanBatch === 0) {
          await this.scan.yieldToEventLoop()
        }
      }

      // 附件登记：miss 候选中真实存在者（任意类型，仅登记元数据与被引用
      //  关系，不解析内容——#194 规格）。#556 T2 起跨根/工作区外的绝对目标
      //  同域登记（键为规范绝对身份——「仅登记被明确引用的目标」，不扫描
      //  外部目录、不递归追踪外部文档建库；相对候选落在嵌套根不进 missed，
      //  各根不重复归属的既有边界不变）
      const uniqueMissed = [...new Set(missed)]
      for (let i = 0; i < uniqueMissed.length; i++) {
        if (cancelled()) {
          return
        }
        const abs = uniqueMissed[i]!
        const rel = this.relOf(state, abs)
        const inRoot = rel !== null && this.rootOf(abs) === state
        const key = inRoot ? rel! : this.normKey(abs)
        if (files.has(key)) {
          continue
        }
        const stat = await this.scan.statFile(abs)
        if (stat && (inRoot || stat.type !== 'dir')) {
          const identity = inRoot ? this.identityOf(state, rel!) : this.normKey(abs)
          files.set(key, {
            path: key, kind: 'asset', mtimeMs: stat.mtimeMs, size: stat.size, contentVersion: 1,
            ...this.birthtimeOf(stat),
          })
          assetFold.set(this.foldKey(identity), identity)
        }
        if ((i + 1) % this.scanBatch === 0) {
          await this.scan.yieldToEventLoop()
        }
      }

      // 第二遍：重抽存在断链边的文件（asset 集合就绪后可能命中；逐文件幂等替换）
      for (const rel of pendingSources) {
        if (cancelled()) {
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
        const next = extractVaultEdges(rel, text, ctxOf(abs), resolveWith, extractOptions)
        replaceEdgesOf(edges, rel, next)
      }

      // 变化发布（#198）：与上一版模型比对 stat（重扫/重建场景）；首扫描
      // 只建立代次不广播（避免启动风暴）；索引条目消失 ≠ 磁盘删除——
      // 只有 accessOf=missing 的正证据才广播 deleted
      if (cancelled()) {
        return
      }
      const prevModel = state.model
      for (const [rel, entry] of files) {
        const prev = prevModel?.files.get(rel)
        if (prev === undefined) {
          this.ensureGeneration(this.entryAbsOf(state, rel))
        } else if (prev.mtimeMs !== entry.mtimeMs || prev.size !== entry.size) {
          this.publishTargetChange(state, rel, 'changed', { mtimeMs: entry.mtimeMs, size: entry.size })
        }
      }
      if (prevModel) {
        for (const rel of prevModel.files.keys()) {
          if (files.has(rel)) {
            continue
          }
          if (cancelled()) {
            return
          }
          const abs = this.absOf(state, rel)
          const access = await this.scan.accessOf(abs)
          if (access === 'missing') {
            this.publishTargetChange(state, rel, 'deleted', null)
          } else if (access === 'inaccessible') {
            const prev = prevModel.files.get(rel)
            this.publishTargetChange(
              state, rel, 'stale',
              prev ? { mtimeMs: prev.mtimeMs, size: prev.size } : null,
            )
          }
          // access=ok：条目消失但磁盘仍在（排除/引用消失等）——不广播
        }
      }

      if (cancelled()) {
        return
      }
      const model: VaultIndexModel = { files, edges }
      state.model = model
      this.refreshDerived(state)
      state.hasData = true
      this.notify()
      await this.commitSnapshot(state)
    } finally {
      if (state.scanOwner === scanOwner) {
        state.scanOwner = undefined
        state.scanning = false
        this.notify()
        this.resumeAfterBusy(state)
      }
    }
  }

  /** 扫描/核验完成后接力：挂起的增量泵与溢出降级核验 */
  private resumeAfterBusy(state: RootIndexState): void {
    if (state.pumpPending && !state.pumping && !state.scanning && !state.verifying) {
      state.pumpPending = false
      void this.pumpRescans(state)
    }
    if (state.verifyPending && !state.pumping && !state.scanning && !state.verifying) {
      state.verifyPending = false
      void this.verifyRoot(state)
    }
    // #556 T2：busy 期间挂起的短名重判接力（清单转完整/迁移触发）
    if (state.pendingShortnameRejudge !== null && !state.pumping && !state.scanning && !state.verifying) {
      const scope = state.pendingShortnameRejudge
      state.pendingShortnameRejudge = null
      void this.runShortnameRejudge(state, scope)
    }
  }

  // ---- #556 T2：绝对身份、短名补查与文件集合重判 ----

  /** 条目键是否为绝对身份形态（跨根/工作区外被引用目标的登记） */
  private isAbsoluteEntry(entryPath: string): boolean {
    return this.ops.isAbsolute(entryPath)
  }

  /** 根内相对路径的规范绝对身份（normKey 语义：resolve + 分隔符归一 +
   *  去尾斜杠——resolvedTarget 与反链桶的统一身份域） */
  private identityOf(state: RootIndexState, rel: string): string {
    return this.normKey(this.absOf(state, rel))
  }

  /** 条目键（rel 或绝对身份）对应的绝对 fsPath */
  private entryAbsOf(state: RootIndexState, entryPath: string): string {
    return this.isAbsoluteEntry(entryPath) ? this.normKey(entryPath) : this.absOf(state, entryPath)
  }

  /** 根内相对路径的 basename（含扩展名、磁盘形态；重判触发面的受影响键） */
  private basenameOfRel(rel: string): string {
    return rel.slice(rel.lastIndexOf('/') + 1)
  }

  /** 派生索引重建（反链桶 + 短名依赖反查表——与边表变更同点位调用；
   *  反查表为派生数据不持久化，重建与 buildBacklinkIndex 同阶成本） */
  private refreshDerived(state: RootIndexState): void {
    if (!state.model) {
      state.backlinks = null
      state.shortnameDeps = new Map()
      return
    }
    state.backlinks = buildBacklinkIndex(state.model.edges)
    const deps = new Map<string, Set<string>>()
    // shortnameDepKeyOf 只消费 isWindowsHost（docDir/rootDir 不参与判定）
    const depCtx = { docDir: state.fsPath, rootDir: state.fsPath, isWindowsHost: this.opts.isWindowsHost }
    // 短名依赖按「合成最终边集」构建（评审 F2）：覆盖层在场的来源其基线
    // 边被整体替代——依赖表若只扫基线，dirty 来源的短名边不触发重判；
    // 合成口径与 queryBacklinks 一致（overlay 条目 = 该来源的最终出链）
    const overlayEntries = state.overlay.entriesOf()
    const edgesBySource = new Map<string, typeof state.model.edges>()
    for (const e of state.model.edges) {
      const list = edgesBySource.get(e.source)
      if (list) {
        list.push(e)
      } else {
        edgesBySource.set(e.source, [e])
      }
    }
    for (const [rel, entry] of overlayEntries) {
      edgesBySource.set(rel, entry.edges)
    }
    for (const edges of edgesBySource.values()) {
      for (const e of edges) {
        const key = shortnameDepKeyOf(e, depCtx)
        if (key === null) {
          continue
        }
        const folded = this.foldKey(key)
        let set = deps.get(folded)
        if (!set) {
          deps.set(folded, (set = new Set()))
        }
        set.add(e.source)
      }
    }
    state.shortnameDeps = deps
  }

  /** 清单 Markdown basename 倒排（代次缓存：catalogGen 变化时重建——
   *  补查端口零 IO 查询的载体，R6 容量红线） */
  private mdBasenameIndexOf(state: RootIndexState): Map<string, string[]> {
    const catalog = state.catalog
    if (!catalog) {
      return new Map()
    }
    const cached = state.catalogNameIndex
    if (cached && cached.gen === state.catalogGen) {
      return cached.index
    }
    const index = new Map<string, string[]>()
    for (const [rel, entry] of catalog) {
      if (entry.category !== 'markdown') {
        continue
      }
      const key = this.foldKey(rel.slice(rel.lastIndexOf('/') + 1))
      let list = index.get(key)
      if (!list) {
        index.set(key, (list = []))
      }
      list.push(rel)
    }
    state.catalogNameIndex = { gen: state.catalogGen, index }
    return index
  }

  /** 短名补查端口（#556 T2 索引侧数据面；R1 实现一处各消费方注入）：按
   *  完整 basename 查来源根内未排除 Markdown（catalog 已按最具体根归属
   *  过滤——嵌套根不重复归属），complete = catalogComplete（清单未完整
   *  唯一候选不声明唯一）。 */
  private shortnameLookupFor(state: RootIndexState): VaultEdgeShortnamePort {
    return (basename) => {
      const hits = this.mdBasenameIndexOf(state).get(this.foldKey(basename)) ?? []
      const candidates: string[] = []
      for (const rel of hits) {
        candidates.push(this.identityOf(state, rel))
      }
      return { candidates, complete: state.catalogComplete }
    }
  }

  /** #556 T3 跳转/悬停侧短名补查查询（R6 容量红线：catalog 倒排零 IO、
   *  禁止点击时全库 fs 扫描；R1 与索引抽取共用 shortnameLookupFor 数据面）：
   *  按来源 fsPath 定位所属根分区后查询。根未登记、索引无数据或清单不可
   *  用时返回 null——消费方不注入补查（不猜目标、行为与无补查语义一致）。
   *  多候选与清单不完整如实透传，分态映射（ambiguous/pending）由消费方经
   *  shared/vaultLink 的 shortnameLookupResolution 单一事实源完成。 */
  shortnameLookup(sourceFsPath: string, basename: string): VaultLinkShortnameLookupResult | null {
    const state = this.rootOf(sourceFsPath)
    if (!state || !state.hasData || !state.model) {
      return null
    }
    return this.shortnameLookupFor(state)(basename)
  }

  /** 评审 S1 路径存在性（rename 规划端口的数据面）：任意绝对 fsPath 是否被
   *  任一根的 files 表登记（含 asset——磁盘存在性的索引投影，全文件清单
   *  口径）。同步零 IO；normKey 归一后查询，大小写/分隔符漂移容错 */
  catalogHasFile(fsPath: string): boolean {
    const key = this.normKey(fsPath)
    for (const s of this.roots.values()) {
      if (s.model?.files.has(key) === true) {
        return true
      }
    }
    return false
  }

  /** #556 T3（R8）：文档已解析出链的绝对身份快照——面板装配点推导 webview
   *  localResourceRoots 许可面用（探针结论：根外资源目标 401，须在 html
   *  赋值前一次性纳入目标目录）。与 outlinksOf 同源边集（覆盖层未保存态
   *  优先，基线按 fold 匹配来源），只取 resolvedTarget 非空者；跳过面板
   *  呈现过滤（外链边恒 resolvedTarget=null，天然不进快照）。同步纯模型
   *  读取（装配不引入 IO 等待）；根未登记或索引无数据返回 null */
  resolvedOutlinkTargetsOf(fsPath: string): readonly string[] | null {
    const state = this.rootOf(fsPath)
    if (!state || !state.hasData || !state.model || !state.backlinks) {
      return null
    }
    const rel = this.relOf(state, fsPath)
    if (rel === null) {
      return null
    }
    const overlayEntry = state.overlay.get(rel)
    const sourceEdges = overlayEntry
      ? overlayEntry.edges
      : state.model.edges.filter((e) => this.foldKey(e.source) === this.foldKey(rel))
    const targets: string[] = []
    for (const e of sourceEdges) {
      if (e.resolvedTarget !== null) {
        targets.push(e.resolvedTarget)
      }
    }
    return targets
  }

  /** 基线 resolver 对（#556 T2 身份域升级）：resolve 按根内域（越根/归属
   *  更具体根不解析——相对链接的既有边界不放宽），resolveAbsolute 按绝对
   *  身份统一域（根内 + 已登记外部/跨根目标，miss 收集供登记）。键域为
   *  fold(规范绝对身份)——查询路径大小写漂移按 fold 容错。 */
  private makeModelResolvers(state: RootIndexState, missed?: string[]): {
    resolve: (absFsPath: string) => string | null
    resolveAbsolute: (absFsPath: string) => string | null
  } {
    const foldIndex = new Map<string, string>()
    for (const p of state.model?.files.keys() ?? []) {
      const identity = this.isAbsoluteEntry(p) ? this.normKey(p) : this.identityOf(state, p)
      foldIndex.set(this.foldKey(identity), identity)
    }
    const lookup = (absFsPath: string): string | null => {
      const key = this.foldKey(this.normKey(absFsPath))
      const hit = foldIndex.get(key)
      if (hit !== undefined) {
        return hit
      }
      missed?.push(absFsPath)
      return null
    }
    return {
      resolve: (absFsPath: string): string | null => {
        const rel = this.relOf(state, absFsPath)
        if (rel === null || this.rootOf(absFsPath) !== state) {
          return null
        }
        return lookup(absFsPath)
      },
      resolveAbsolute: lookup,
    }
  }

  /** 登记被明确引用的外部目标（#556 T2）：miss 收集中的根外绝对路径 stat
   *  后按 asset 登记入 files 表（键 = 规范绝对身份；仅元数据与被引用关系，
   *  不扫描外部目录、不递归追踪外部文档建库——Markdown 目标也不解析其
   *  内容，kind 归 asset）。根内 miss 维持既有断链语义。返回登记数。 */
  private async registerExternalTargets(state: RootIndexState, missed: readonly string[]): Promise<number> {
    if (this.disposed || !state.model) {
      return 0
    }
    let registered = 0
    let n = 0
    for (const abs of new Set(missed)) {
      const rel = this.relOf(state, abs)
      if (rel !== null && this.rootOf(abs) === state) {
        continue // 根内 miss：断链（附件登记在两遍法/rename 批域）
      }
      const identity = this.normKey(abs)
      if (state.model.files.has(identity)) {
        continue
      }
      const stat = await this.scan.statFile(abs)
      if (!stat || stat.type === 'dir') {
        continue
      }
      const prev = state.model.files.get(identity)
      state.model.files.set(identity, {
        path: identity,
        kind: 'asset',
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        contentVersion: (prev?.contentVersion ?? 0) + 1,
        ...this.birthtimeOf(stat),
      })
      this.ensureGeneration(identity)
      registered++
      if ((++n) % this.rescanBatchFiles === 0) {
        await this.scan.yieldToEventLoop()
      }
    }
    return registered
  }

  /** 重判受影响 basename 的短名边来源（#556 T2 文件集合变化重判）：按
   *  basename → 来源反查表定位依赖者并读盘重抽——只重抽相关来源，不全
   *  库重扫；覆盖唯一变歧义、歧义恢复唯一、相对候选新增抢占与删除后
   *  恢复（重抽幂等，来源为改写分支不再触发 basename 重判，无递归）。 */
  private async rejudgeShortnameByBasenames(state: RootIndexState, basenames: Iterable<string>): Promise<void> {
    if (this.disposed || !state.hasData || !state.model) {
      return
    }
    const sources = new Set<string>()
    for (const bn of basenames) {
      const deps = state.shortnameDeps.get(this.foldKey(bn))
      if (deps) {
        for (const s of deps) {
          sources.add(s)
        }
      }
    }
    await this.rescanSources(state, sources)
  }

  /** 全域短名重判（清单转完整 / v2 快照迁移）：全部短名边来源重抽 */
  private async rejudgeAllShortnameSources(state: RootIndexState): Promise<void> {
    if (this.disposed || !state.hasData || !state.model) {
      return
    }
    const sources = new Set<string>()
    for (const deps of state.shortnameDeps.values()) {
      for (const s of deps) {
        sources.add(s)
      }
    }
    await this.rescanSources(state, sources)
  }

  private async rescanSources(state: RootIndexState, sources: ReadonlySet<string>): Promise<void> {
    let n = 0
    for (const rel of sources) {
      if (this.disposed) {
        return
      }
      const abs = this.absOf(state, rel)
      await this.rescanFile(state, abs)
      // 评审 F2：dirty 来源的覆盖层按未保存正文重算（不能退回盘面文本，
      // 也不能让旧覆盖层压住已重判的世界）。worldReapply 语义：世界（候选
      // 集合/登记表）变化后的同版本重算——与 rename 批末世界重算同款，
      // apply 的同版本拒绝会把旧短名判定永久钉死
      const key = this.normKey(abs)
      if (state.unsaved.get(key) !== undefined && this.recomputeUnsaved(state, key, true)) {
        this.notify()
      }
      if ((++n) % this.rescanBatchFiles === 0) {
        await this.scan.yieldToEventLoop()
      }
    }
  }

  /** 执行（或 busy 时挂起接力）短名重判：'all' 为全部短名边来源；挂起态
   *  由 resumeAfterBusy 在扫描/核验/泵结束后消费（'all' 吸收集合态） */
  private runShortnameRejudge(state: RootIndexState, scope: 'all' | ReadonlySet<string>): Promise<void> {
    if (this.disposed || !state.hasData || !state.model) {
      return Promise.resolve()
    }
    if (state.scanning || state.verifying || state.pumping) {
      const cur = state.pendingShortnameRejudge
      if (cur === 'all' || scope === 'all') {
        state.pendingShortnameRejudge = 'all'
      } else if (cur === null) {
        state.pendingShortnameRejudge = new Set(scope)
      } else {
        state.pendingShortnameRejudge = new Set([...cur, ...scope])
      }
      return Promise.resolve()
    }
    return scope === 'all'
      ? this.rejudgeAllShortnameSources(state)
      : this.rejudgeShortnameByBasenames(state, scope)
  }

  // ---- 快照提交 ----

  private async commitSnapshot(state: RootIndexState): Promise<void> {
    if (this.disposed || !state.model) {
      return
    }
    const baseDir = this.baseDirOf(state)
    // prev 的片校验和表 + 片实体位置：读上一代 manifest（增量提交继承未变
    // 片；实体位置沿继承链回溯——孙代继承片仍指祖先目录，不恒记上一代名）
    let prev: {
      generation: number
      dirName: string
      shardChecksums: Map<number, string>
      shardLocations: Map<number, string>
    } | undefined
    if (state.meta) {
      try {
        const manifest = JSON.parse(await this.storage.readFile(`${baseDir}/${state.meta.dirName}/manifest.json`)) as {
          generation: number
          shards: Array<{ i: number; checksum: string; inheritedFrom: string | null }>
        }
        prev = {
          generation: manifest.generation,
          dirName: state.meta.dirName,
          shardChecksums: new Map(manifest.shards.map((s) => [s.i, s.checksum])),
          shardLocations: new Map(manifest.shards.map((s) => [s.i, s.inheritedFrom ?? state.meta!.dirName])),
        }
      } catch {
        prev = undefined // 上一代 manifest 不可读：按全新提交
      }
    }
    const fileCount = state.model.files.size
    const shardCount = ADAPTIVE_SHARDS.find((t) => fileCount <= t.maxFiles)!.shards
    const existingDirs = await this.storage.listDirs(baseDir)
    const existingFiles = await this.storage.listFiles?.(baseDir) ?? []
    const plan = await planSnapshotCommitChunked(
      state.model,
      {
        baseDir,
        shardCount,
        prev,
        existingDirs,
        ...(existingFiles.length > 0 ? { existingFiles } : {}),
        writerTag: randomWriterTag(),
      },
      () => this.scan.yieldToEventLoop(),
    )
    // writes 顺序即提交顺序：片 → manifest → CURRENT（唯一提交点）。
    // 写失败仅影响持久化：内存索引与 notify 照常（索引是可重建缓存，
    // 磁盘快照滞后由下一轮提交兜底），不留 unhandled rejection
    try {
      for (const w of plan.writes) {
        const dir = w.path.slice(0, Math.max(w.path.lastIndexOf('/'), 0))
        await this.storage.ensureDir(dir)
        await this.storage.writeFile(w.path, w.content)
      }
    } catch (err) {
      console.warn(
        `[vsidian] 索引快照写入失败（root=${state.fsPath} gen=${plan.generation}）：` +
        `${err instanceof Error ? err.message : String(err)}；下一轮提交兜底`,
      )
      this.notify()
      return
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
    // 排除文档不入覆盖层（排除来源不贡献反链——#194「排除来源不保证其
    // 引用自动更新」的索引侧推论）
    const rel = this.relOf(state, key)
    if (rel !== null && this.excludeMatcher.test(rel)) {
      return
    }
    // 服务层版本仲裁：迟到的旧版本事件（乱序广播）不覆盖已登记的新版本——
    // overlay.apply 是第二道防线（扫描完成时再仲裁一次）
    const pending = state.unsaved.get(key)
    if (pending && version <= pending.version) {
      return
    }
    const now = Date.now()
    state.unsaved.set(key, { version, text })
    if (!state.unsavedTimers.has(key)) {
      state.unsavedSince.set(key, now)
    }
    // 冲刷时刻 = min(末次事件+防抖, 首个未冲刷事件+强制合并上限)
    const flushAt = planFlushAt(
      state.unsavedSince.get(key) ?? now,
      now,
      this.unsavedDebounce,
      this.unsavedMaxWait,
    )
    const prevTimer = state.unsavedTimers.get(key)
    if (prevTimer !== undefined) {
      clearTimeout(prevTimer)
    }
    state.unsavedTimers.set(key, setTimeout(() => {
      state.unsavedTimers.delete(key)
      state.unsavedSince.delete(key)
      void this.flushUnsaved(state, key)
    }, Math.max(0, flushAt - now)))
  }

  private async flushUnsaved(state: RootIndexState, key: string): Promise<void> {
    if (this.recomputeUnsaved(state, key, false)) {
      this.notify()
    }
  }

  /** 按当前世界（resolver 快照）重算 key 的未保存文本边。写入入口由
   *  worldReapply 决定：false=flushUnsaved 常规冲刷（apply，版本严格递增，
   *  迟到同版本扫描被拒）；true=rename 批末世界重算（reapply，同版本可
   *  采信——「冲刷早于新路径登记」的断链边无后续冲刷时机，见 #269 落档）。
   *  排除复检（applyUnsaved 同口径）：排除变更后 pending 与在途定时器可
   *  残留，两条通道不得复活已排除来源的覆盖层条目（#198 排除语义）。
   *  返回是否采信。 */
  private recomputeUnsaved(state: RootIndexState, key: string, worldReapply: boolean): boolean {
    const pending = state.unsaved.get(key)
    if (!pending || !state.hasData) {
      return false
    }
    const rel = this.relOf(state, key)
    if (rel === null || this.excludeMatcher.test(rel)) {
      return false
    }
    const text = normalizeLf(pending.text)
    const { resolve, resolveAbsolute } = this.makeModelResolvers(state)
    const edges = extractVaultEdges(rel, text, {
      docDir: this.dirname(key),
      rootDir: state.fsPath,
      isWindowsHost: this.opts.isWindowsHost,
    }, (abs) => {
      // 覆盖层解析：基线集合（md + asset，平台大小写）+ 覆盖文档自身；
      // 未登记的附件目标按断链保留（覆盖层高频路径不做 stat IO——外部
      // 目标的登记在保存后的增量重扫完成）
      const hit = resolve(abs)
      if (hit !== null) {
        return hit
      }
      const target = this.relOf(state, abs)
      return target !== null && this.foldKey(target) === this.foldKey(rel) ? this.normKey(key) : null
    }, {
      lookupShortname: this.shortnameLookupFor(state),
      resolveAbsolute,
    })
    const prevOverlayEdges = state.overlay.get(rel)?.edges ?? []
    const accepted = worldReapply
      ? state.overlay.reapply(rel, pending.version, edges)
      : state.overlay.apply(rel, pending.version, edges)
    if (accepted) {
      // 评审 F6：覆盖层重算的 retarget 同款补发（与 rescanFile 基线通道一致）
      this.publishVanishedTargets(state, prevOverlayEdges, edges)
    }
    return accepted
  }

  /** 评审 F6：来源边重抽（基线或覆盖层）后消失的旧解析身份补发失效——
   *  短名 retarget、相对候选抢占等场景，旧身份文件本身无变化、只有引用
   *  解析语义变化，既有通道只发新身份事件；订阅旧身份的挂载悬停/嵌入
   *  由此收到 changed（stat null）并重发解析。身份去重后逐个发布 */
  private publishVanishedTargets(
    state: RootIndexState,
    prevEdges: readonly VaultEdge[],
    nextEdges: readonly VaultEdge[],
  ): void {
    if (prevEdges.length === 0) {
      return
    }
    const next = new Set(
      nextEdges.map((e) => e.resolvedTarget).filter((t): t is string => t !== null),
    )
    const vanished = new Set<string>()
    for (const e of prevEdges) {
      if (e.resolvedTarget !== null && !next.has(e.resolvedTarget)) {
        vanished.add(e.resolvedTarget)
      }
    }
    for (const target of vanished) {
      // 已从登记表移除的身份走删除/失效通道（deleted/stale 已发，消费方
      // 收到正确分态），不重复补发——补发面是「文件仍在、仅引用解析转移」。
      // 根内条目键为 rel、外部/跨根条目键为 normKey 绝对身份，双形态查表
      const relForm = this.relOf(state, target)
      const registered = relForm !== null
        ? state.model!.files.has(relForm)
        : state.model!.files.has(this.normKey(target))
      if (!registered) {
        continue
      }
      this.publishTargetChange(state, target, 'changed', null)
    }
  }

  /** 文档保存：覆盖层退役 + 增量队列重扫（有界；等待排空） */
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
    state.unsavedSince.delete(key)
    const rel = this.relOf(state, fsPath)
    if (rel !== null) {
      state.overlay.clear(rel)
      if (this.excludeMatcher.test(rel)) {
        return // 排除域：与 watcher/applyUnsaved 同款口径，不入增量队列
      }
    }
    // 保存走有界增量队列（与外部事件同域：容量/溢出/分批语义一致）
    await this.enqueueRescan(state, key)
  }

  /**
   * 文档关闭退役（review-loops #18；provider 的 onDidCloseTextDocument
   * 驱动，调用方须确认同文档无其他打开面板）：未保存内容随面板关闭丢弃
   * ——unsaved 全文、防抖计时器与覆盖层边一并退场，反链查询回到磁盘
   * 基线（内存索引是可重建缓存，磁盘为事实源）。不触发重扫（磁盘未变）。
   * 另一调用方为 rename 通道收尾（#256，retireLoadedDocs）：不做面板检查
   * ——面板持有者与 dirty 缓存实例已在调用前豁免（#269：dirty buffer 是
   * 通道改写的唯一载体），退役对象是无标签且无未保存内容的通道产物，
   * 退役即归基线，幂等无害。
   */
  documentClosed(fsPath: string): void {
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
    state.unsavedSince.delete(key)
    const rel = this.relOf(state, fsPath)
    if (rel !== null && state.overlay.get(rel) !== undefined) {
      state.overlay.clear(rel)
      this.notify()
    }
  }

  // ---- watcher / 增量队列 ----

  /** 未保存暂存与覆盖层条目的退役（#256 回流收敛/残渣兜底共用体）：去抖
   *  定时器、暂存全文、登记时间与覆盖层边一并退场。键域与登记同源：
   *  unsaved* 用 normKey 绝对域、overlay 用根内相对 rel。不重扫、不通知
   *  （调用方语义各自负责：重扫路径随后自会重建基线/发布变更）。 */
  private retireUnsavedEntry(state: RootIndexState, fsPath: string, rel: string): void {
    const key = this.normKey(fsPath)
    const timer = state.unsavedTimers.get(key)
    if (timer !== undefined) {
      clearTimeout(timer)
      state.unsavedTimers.delete(key)
    }
    state.unsaved.delete(key)
    state.unsavedSince.delete(key)
    state.overlay.clear(rel)
  }

  private onWatchEvent(state: RootIndexState, fsPath: string | null): void {
    if (!fsPath) {
      return
    }
    const rel = this.relOf(state, fsPath)
    // 越根/排除/归属更具体根（嵌套根——父子根 watcher 监听树重叠，变更
    // 事件会在两个根各到达一次）的文件不入本根增量域
    if (rel === null || this.excludeMatcher.test(rel) || this.rootOf(fsPath) !== state) {
      return
    }
    const key = this.normKey(fsPath)
    if (/\.md$/i.test(fsPath)) {
      const prev = state.rescanTimers.get(key)
      if (prev !== undefined) {
        clearTimeout(prev)
      }
      state.rescanTimers.set(key, setTimeout(() => {
        state.rescanTimers.delete(key)
        void this.enqueueRescan(state, key)
      }, this.rescanDebounce))
      return
    }
    // #377 T02 非 md 文件：只维护全文件清单（无正文抽取语义）；去抖键
    // 与 md 增量管道分立互不干扰
    const prev = state.catalogTimers.get(key)
    if (prev !== undefined) {
      clearTimeout(prev)
    }
    state.catalogTimers.set(key, setTimeout(() => {
      state.catalogTimers.delete(key)
      void this.catalogFileEvent(state, fsPath)
    }, this.rescanDebounce))
  }

  /** 入增量队列并启动泵（容量溢出降级为一次清单核验）；返回可等待的
   *  排空 Promise（保存路径用；busy 时挂起接力，不等实际完成）。 */
  private enqueueRescan(state: RootIndexState, key: string): Promise<void> {
    if (this.disposed) {
      return Promise.resolve()
    }
    const result = state.rescanQueue.enqueue(key)
    if (result === 'overflow') {
      // 溢出策略：放弃逐文件增量（清空队列），降级为一次清单核验——
      // 批量 Git 切换不产生无界任务
      state.rescanQueue.clear()
      if (state.pumping || state.scanning || state.verifying) {
        state.verifyPending = true
      } else {
        void this.verifyRoot(state)
      }
      return Promise.resolve()
    }
    if (state.pumping) {
      const run = state.pumpRun
      if (run) {
        return run.then(() => {
          // 泵可能在本次入队前的最后一次排空后退出：接力再泵一轮
          if (!state.pumping && state.rescanQueue.size > 0 && !state.scanning && !state.verifying) {
            return this.pumpRescans(state)
          }
          return undefined
        })
      }
      return Promise.resolve()
    }
    if (state.scanning || state.verifying) {
      state.pumpPending = true
      return Promise.resolve()
    }
    return this.pumpRescans(state)
  }

  /** 增量队列泵：分批重扫（批间让出），排空后合并提交一次快照 */
  private pumpRescans(state: RootIndexState): Promise<void> {
    const epoch = this.maintenanceEpoch
    state.pumping = true
    const run = this.drainRescanQueue(state, epoch)
    state.pumpRun = run
    return run
  }

  private async drainRescanQueue(state: RootIndexState, epoch: number): Promise<void> {
    try {
      for (;;) {
        if (this.disposed || epoch !== this.maintenanceEpoch) {
          return
        }
        const batch = state.rescanQueue.drain(this.rescanBatchFiles)
        if (batch.length === 0) {
          break
        }
        for (const key of batch) {
          if (this.disposed || epoch !== this.maintenanceEpoch) {
            return
          }
          await this.rescanFile(state, key)
        }
        await this.scan.yieldToEventLoop()
      }
      this.scheduleCommit(state) // 一批任务合并为一次磁盘提交
    } finally {
      state.pumping = false
      state.pumpRun = undefined
      this.resumeAfterBusy(state)
    }
  }

  /** 重扫单文件（保存/外部变更/新建/核验候选）；文件已删则移除其基线条目
   *  与边；不可访问标 stale 不移除（SSH 断连/权限错误不得等同删除）。 */
  private async rescanFile(state: RootIndexState, fsPath: string): Promise<void> {
    if (this.disposed || !state.model) {
      return
    }
    const rel = this.relOf(state, fsPath)
    if (rel === null) {
      return
    }
    const access = await this.scan.accessOf(fsPath)
    if (access === 'missing') {
      // 删除：移除基线。未保存覆盖层——文档仍打开时保留（编辑器内未保存
      // 内容仍接管查询）；文档已不在场时必为残渣（#256 review 轮：外部
      // 删除与关闭残渣并存时，幽灵边不得继续贡献反链），同款兜底退役——
      // 先于 removeBaselineEntry 执行（其 notify 触发时覆盖层已到终态）
      if (this.opts.isDocOpen !== undefined && !this.opts.isDocOpen(fsPath)) {
        this.retireUnsavedEntry(state, fsPath, rel)
      }
      this.removeBaselineEntry(state, rel)
      this.publishTargetChange(state, rel, 'deleted', null)
      // #556 T2：删除后重判——引用了该 basename 的短名边可能恢复唯一
      // （歧义恢复唯一的触发面之一）
      await this.rejudgeShortnameByBasenames(state, [this.basenameOfRel(rel)])
      return
    }
    if (access === 'inaccessible') {
      const prev = state.model.files.get(rel)
      this.publishTargetChange(
        state, rel, 'stale',
        prev ? { mtimeMs: prev.mtimeMs, size: prev.size } : null,
      )
      return
    }
    const [raw, stat] = await Promise.all([this.scan.readFileText(fsPath), this.scan.statFile(fsPath)])
    if (raw === null || stat === null) {
      // 可访问但读失败：保守按 stale 处理（不删条目）
      const prev = state.model.files.get(rel)
      this.publishTargetChange(
        state, rel, 'stale',
        prev ? { mtimeMs: prev.mtimeMs, size: prev.size } : null,
      )
      return
    }
    const text = normalizeLf(raw)
    // 外部变更回流收敛（#256）：「未保存」暂存若与磁盘文本一致（外部工具把
    // 盘面写成 buffer 同款——writeFile/外部保存经宿主回流登记的暂存），覆盖
    // 层使命已结束（基线即真相），此时退役——否则回流时刻早于目标文件归位
    // 基线的话，覆盖层会持有断链边并无事件可退役（外部写无保存/关闭事件），
    // 永久遮蔽已自愈的基线。盘≠暂存（真实未保存编辑）不动，覆盖层继续接管。
    // 关闭残渣兜底（同票）：文档已不在宿主 textDocuments 时覆盖层同样退役——
    // 覆盖层的存在前提是「文档打开且有未保存内容」，文档不在则必为残渣
    // （onDidCloseTextDocument 漏触发时的兜底退役路径）
    const pendingUnsaved = state.unsaved.get(this.normKey(fsPath))
    const docAbsent = this.opts.isDocOpen !== undefined && !this.opts.isDocOpen(fsPath)
    if (docAbsent || (pendingUnsaved !== undefined && normalizeLf(pendingUnsaved.text) === text)) {
      this.retireUnsavedEntry(state, fsPath, rel)
    }
    const prevEntry = state.model.files.get(rel)
    const missed: string[] = []
    const { resolve, resolveAbsolute } = this.makeModelResolvers(state, missed)
    let edges = extractVaultEdges(rel, text, {
      docDir: this.dirname(fsPath),
      rootDir: state.fsPath,
      isWindowsHost: this.opts.isWindowsHost,
    }, resolve, {
      lookupShortname: this.shortnameLookupFor(state),
      resolveAbsolute,
    })
    // 外部目标登记（#556 T2）：绝对路径目标（跨根/工作区外）stat 后登记
    // entry；登记发生后断链边重抽一次（登记表就绪后命中）。重抽须重建
    // resolver——旧闭包的 foldIndex 快照建于登记前，不含新登记的外部
    // 目标，复用则重抽 lookup 仍 miss（#556 收口实证：外部目标边在
    // 增量重扫中恒断链，出链绝对身份快照与授权面读到空）
    if (await this.registerExternalTargets(state, missed) > 0 && edges.some((e) => e.resolvedTarget === null)) {
      const reResolve = this.makeModelResolvers(state)
      edges = extractVaultEdges(rel, text, {
        docDir: this.dirname(fsPath),
        rootDir: state.fsPath,
        isWindowsHost: this.opts.isWindowsHost,
      }, reResolve.resolve, {
        lookupShortname: this.shortnameLookupFor(state),
        resolveAbsolute: reResolve.resolveAbsolute,
      })
    }
    state.model.files.set(rel, {
      path: rel,
      kind: 'markdown',
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      contentVersion: (prevEntry?.contentVersion ?? 0) + 1,
      ...this.birthtimeOf(stat),
    })
    const prevEdges = state.model.edges.filter((e) => e.source === rel)
    state.model.edges = state.model.edges.filter((e) => e.source !== rel).concat(edges)
    this.refreshDerived(state)
    // 评审 F6：重抽使该来源部分边的解析身份消失（短名 retarget、相对候选
    // 抢占）——订阅旧身份的挂载悬停/嵌入须收到失效才能重发解析；新身份
    // 的 changed 已由目标登记/重扫发布，旧身份无文件变化、只有解析语义
    // 变化，在此按身份补发（幂等，代次推进触发 webview 重发）
    this.publishVanishedTargets(state, prevEdges, edges)
    // #377 T02：md 增量重扫同步维护清单条目（磁盘 stat——未保存编辑不参
    // 与；changed 广播由下方既有发布承担，不双发）
    this.applyCatalogUpsert(state, rel, 'markdown', stat.mtimeMs, stat.size, false)
    if (!prevEntry || prevEntry.mtimeMs !== stat.mtimeMs || prevEntry.size !== stat.size) {
      this.publishTargetChange(state, rel, 'changed', { mtimeMs: stat.mtimeMs, size: stat.size })
    }
    if (!prevEntry) {
      // #556 T2：新增登记后重判——引用了该 basename 的短名边可能接通
      // （未解析边恢复）或被相对候选抢占
      await this.rejudgeShortnameByBasenames(state, [this.basenameOfRel(rel)])
    }
    this.notify()
  }

  /** 移除基线条目与该文件的全部出链（删除的正证据路径专用） */
  private removeBaselineEntry(state: RootIndexState, rel: string): void {
    const hadModel = state.model?.files.has(rel) === true
    if (hadModel) {
      state.model!.files.delete(rel)
      state.model!.edges = state.model!.edges.filter((e) => e.source !== rel)
      this.refreshDerived(state)
    }
    // #377 T02：清单条目随基线退场（调用方语义为删除正证据路径）
    const hadCatalog = this.removeCatalogEntry(state, rel)
    if (hadModel || hadCatalog) {
      this.notify()
    }
  }

  // ---- 全文件清单（#377 T02）----

  /**
   * 清单就绪入口（恢复或重建）：健康 catalog.json 直接恢复（不重新列举）；
   * 缺失/损坏走全量枚举。与引用关系（model）独立维护——清单就绪不撑引用
   * 就绪（rename 候选仍按 hasData 判定），反之亦然。
   */
  private async ensureCatalog(state: RootIndexState): Promise<void> {
    if (this.disposed || state.catalogScanning) {
      return
    }
    if (await this.loadCatalogFile(state)) {
      this.notify()
      return
    }
    await this.scanCatalog(state)
  }

  /** 恢复持久化清单（baseDir/catalog.json——单文件原子写）；损坏/缺失 false */
  private async loadCatalogFile(state: RootIndexState): Promise<boolean> {
    try {
      const content = await this.storage.readFile(`${this.baseDirOf(state)}/catalog.json`)
      const parsed = parseVaultCatalog(content)
      if (parsed === null) {
        return false
      }
      state.catalog = new Map(parsed.entries.map((e) => [e.relPath, e]))
      state.catalogComplete = parsed.complete
      state.catalogGen++
      return true
    } catch {
      return false
    }
  }

  /**
   * 全文件清单枚举（#377 T02）：所有未排除普通文件登记名称、根内路径与
   * 类型提示；常用资源取真实 mtime/size（stat——磁盘修改时间，不是入列
   * 时间），未知类型仅记名（未知显式建模 0，沉底，不伪装为当前时间）。
   * 分批让出、epoch+所有权双守卫——旧枚举不得发布过期模型或复位新轮状态。
   * failedDirs 非空 → catalogComplete=false（部分就绪不冒充完整、不参与
   * 下轮移除 diff）。发布后重放扫描窗口内到达的文件事件。
   */
  private async scanCatalog(state: RootIndexState, epoch = this.maintenanceEpoch): Promise<void> {
    if (this.disposed) {
      return
    }
    const owner = Symbol()
    const cancelled = (): boolean =>
      this.disposed || epoch !== this.maintenanceEpoch || state.catalogOwner !== owner
    state.catalogOwner = owner
    state.catalogScanning = true
    this.notify()
    try {
      // #556 T2：旧清单留档——发布后 diff Markdown 条目集合（排除变更/根
      // 重划/枚举漂移都会在此现形），受影响 basename 触发短名边重判
      const prevCatalog = state.catalog
      const prevComplete = state.catalogComplete
      const listed = await this.scan.listAllFiles(state.fsPath, {
        skipDir: (dirFsPath) => this.isExcludedDirDeep(dirFsPath),
      })
      const entries = new Map<string, VaultCatalogEntry>()
      for (let i = 0; i < listed.files.length; i++) {
        if (cancelled()) {
          return
        }
        const abs = listed.files[i]!
        const rel = this.relOf(state, abs)
        // 嵌套根归属/排除与 md 索引域同口径（端口列举含将被排除者）
        if (rel === null || this.rootOf(abs) !== state || this.excludeMatcher.test(rel)) {
          continue
        }
        const category = classifyVaultFileCategory(rel)
        let mtimeMs = 0
        let size = 0
        if (isCommonVaultFileCategory(category)) {
          const stat = await this.scan.statFile(abs)
          if (stat && stat.type !== 'dir') {
            mtimeMs = stat.mtimeMs
            size = stat.size
          }
          // stat 失败：保留名称身份，元数据未知（0）——不为判定读文件、
          // 也不丢弃条目（下一轮核验自愈）
        }
        entries.set(rel, { relPath: rel, category, mtimeMs, size })
        if ((i + 1) % this.scanBatch === 0) {
          await this.scan.yieldToEventLoop()
        }
      }
      if (cancelled()) {
        return
      }
      state.catalog = entries
      state.catalogComplete = listed.failedDirs.length === 0
      state.catalogGen++
      this.notify()
      await this.commitCatalog(state)
      // 扫描窗口内到达的事件重放（fromReplay 绕过 pending 登记；残留由
      // 周期核验兜底）。重放前复位 catalogScanning：整体覆盖已发生
      // （entries 已发布为权威清单），重放的三态登记必须走直写——否则
      // applyCatalogUpsert 的 F15 拦截会把同一事件回填 pending，重放循环
      // 永不收敛（CI s3 实证：扫描窗口内 watcher 事件到达即死循环，
      // scanCatalog 永不返回、清单事件永不上清）
      state.catalogScanning = false
      for (
        let pending = [...state.catalogPendingEvents];
        pending.length > 0 && !cancelled();
        pending = [...state.catalogPendingEvents]
      ) {
        state.catalogPendingEvents.clear()
        for (const fsPath of pending) {
          if (cancelled()) {
            return
          }
          await this.catalogFileEvent(state, fsPath, true)
        }
      }
      // #556 T2 短名重判（扫描完成触发）：其一，清单转完整（false→true）
      // ——pending 语义的短名边（唯一候选但不完整）恢复判定，全域重判；
      // 其二，Markdown 条目集合变化（排除/根重划/漂移）——受影响 basename
      // 定向重判。busy（扫描/核验/泵）时挂起，resumeAfterBusy 接力
      if (!cancelled()) {
        // 评审 F4：受影响粒度 =「basename → 同名候选成员身份集合」——
        // 排除变更（取消排除引入同名新成员）下名称集合不变而成员增减，
        // 只比名称会漏判「唯一变歧义」；成员身份与补查候选同域（normKey
        // 折叠），形态漂移不误判
        const mdMembersByBasename = (
          catalog: Map<string, VaultCatalogEntry> | null | undefined,
        ): Map<string, Set<string>> => {
          const out = new Map<string, Set<string>>()
          if (!catalog) {
            return out
          }
          for (const [rel, entry] of catalog) {
            if (entry.category !== 'markdown') {
              continue
            }
            const name = this.foldKey(this.basenameOfRel(rel))
            let set = out.get(name)
            if (!set) {
              out.set(name, (set = new Set()))
            }
            set.add(this.foldKey(this.normKey(this.absOf(state, rel))))
          }
          return out
        }
        const prevMembers = mdMembersByBasename(prevCatalog)
        const nextMembers = mdMembersByBasename(entries)
        const affected = new Set<string>()
        for (const [name, members] of nextMembers) {
          const prev = prevMembers.get(name)
          if (prev === undefined || [...members].some((m) => !prev.has(m))) {
            affected.add(name)
          }
        }
        for (const name of prevMembers.keys()) {
          if (!nextMembers.has(name)) {
            affected.add(name)
          }
        }
        const completeFlipped = !prevComplete && state.catalogComplete
        if (completeFlipped || affected.size > 0) {
          await this.runShortnameRejudge(state, completeFlipped ? 'all' : affected)
        }
      }
    } finally {
      if (state.catalogOwner === owner) {
        state.catalogOwner = undefined
        state.catalogScanning = false
        this.notify()
      }
    }
  }

  /**
   * 非 md 文件事件维护（watcher 去抖后）：三态判定——missing 正证据移除
   * （发布 deleted 代次）；inaccessible 保留条目（不冒充删除，曾有已知
   * 元数据者发 stale）；ok 时 stat 后按分类登记（目录事件不入清单——
   * 只登记普通文件）。清单枚举期间到达的事件入 pending（发布后重放）。
   */
  private async catalogFileEvent(
    state: RootIndexState,
    fsPath: string,
    fromReplay = false,
  ): Promise<void> {
    if (this.disposed) {
      return
    }
    if (state.catalogScanning && !fromReplay) {
      state.catalogPendingEvents.add(this.normKey(fsPath))
      return
    }
    if (!state.catalog) {
      return // 清单未建：ensureCatalog 全量枚举稍后覆盖（周期核验兜底）
    }
    const rel = this.relOf(state, fsPath)
    if (rel === null || this.rootOf(fsPath) !== state) {
      return
    }
    // 排除复检（去抖窗口内排除可能已变——排除域不进不出）
    if (this.excludeMatcher.test(rel)) {
      if (this.removeCatalogEntry(state, rel)) {
        this.publishTargetChange(state, rel, 'deleted', null)
        this.notify()
      }
      return
    }
    const access = await this.scan.accessOf(fsPath)
    if (this.disposed) {
      return
    }
    if (access === 'missing') {
      // 清单侧的 deleted 广播归此（removeCatalogEntry 只登记不广播）
      if (this.removeCatalogEntry(state, rel)) {
        this.publishTargetChange(state, rel, 'deleted', null)
        this.notify()
      }
      return
    }
    if (access === 'inaccessible') {
      const prev = state.catalog.get(rel)
      if (prev && (prev.mtimeMs > 0 || prev.size > 0)) {
        this.publishTargetChange(state, rel, 'stale', { mtimeMs: prev.mtimeMs, size: prev.size })
      }
      return
    }
    const stat = await this.scan.statFile(fsPath)
    if (stat === null) {
      // 可访问但 stat 失败：保守按 stale（与 rescanFile 同口径）
      const prev = state.catalog.get(rel)
      if (prev && (prev.mtimeMs > 0 || prev.size > 0)) {
        this.publishTargetChange(state, rel, 'stale', { mtimeMs: prev.mtimeMs, size: prev.size })
      }
      return
    }
    if (stat.type === 'dir') {
      return // 目录身份不入清单（全文件清单只登记普通文件）
    }
    const category = classifyVaultFileCategory(rel)
    const changed = isCommonVaultFileCategory(category)
      ? this.applyCatalogUpsert(state, rel, category, stat.mtimeMs, stat.size)
      : this.applyCatalogUpsert(state, rel, category, 0, 0)
    if (changed) {
      // watcher 单文件事件：变更后广播（面板快照与 #377 候选失效信号
      // wikilink.invalidate 的共同触发点——候选会话据此重发当前查询）
      this.notify()
    }
  }

  /**
   * 清单条目登记（增量路径共用体）：无变化不动（不空转代次）；新条目只建
   * 目标代次不广播（避免启动风暴——与 fullScan 同口径）；已有条目元数据
   * 变化发布 changed（#201 变化通道随清单扩展到非 md 目标自动接通）。
   * publishChange=false 供已自行广播的调用方（rescanFile 的 md 路径）复用
   * 登记逻辑而不双发。返回是否实际变更——调用方聚合后统一 notify（#200
   * 「批末一次广播」契约：批量 rename 不按文件数广播）。清单未建（null）
   * 时空操作——全量枚举稍后覆盖。
   */
  private applyCatalogUpsert(
    state: RootIndexState,
    rel: string,
    category: VaultFileCategory,
    mtimeMs: number,
    size: number,
    publishChange = true,
  ): boolean {
    const catalog = state.catalog
    if (!catalog) {
      return false
    }
    // F15：清单枚举进行中不直写——运行中重扫窗口内到达的直写通道
    // （verifyRoot 的清单比对、md 泵 rescanFile、rename 批）会被
    // scanCatalog 完成时的整体覆盖吞掉（≤ 周期核验间隔才自愈）；改走
    // catalogPendingEvents，由扫描收尾的既有重放循环按三态重新判定
    if (state.catalogScanning) {
      state.catalogPendingEvents.add(this.normKey(this.absOf(state, rel)))
      return false
    }
    const prev = catalog.get(rel)
    if (prev && prev.category === category && prev.mtimeMs === mtimeMs && prev.size === size) {
      return false
    }
    catalog.set(rel, { relPath: rel, category, mtimeMs, size })
    state.catalogGen++
    if (prev === undefined) {
      this.ensureGeneration(this.absOf(state, rel))
    } else if (
      publishChange &&
      (prev.mtimeMs !== mtimeMs || prev.size !== size)
    ) {
      this.publishTargetChange(state, rel, 'changed', mtimeMs > 0 ? { mtimeMs, size } : null)
    }
    this.scheduleCatalogCommit(state)
    return true
  }

  /** 清单条目移除（删除正证据路径）：移除即推进代次；**不广播**——deleted
   *  广播统一由调用方承担（rescanFile/verifyRoot/rename 批/catalogFileEvent
   *  各自已有发布点，避免双发）。返回是否实际移除（调用方聚合 notify）。
   *  F15：清单枚举进行中不直写（同 applyCatalogUpsert）——扫描收尾的
   *  整体覆盖会吞掉本移除；转 pending 由重放按 missing 正证据重新判定。 */
  private removeCatalogEntry(state: RootIndexState, rel: string): boolean {
    const catalog = state.catalog
    if (!catalog || !catalog.has(rel)) {
      return false
    }
    if (state.catalogScanning) {
      state.catalogPendingEvents.add(this.normKey(this.absOf(state, rel)))
      return false
    }
    catalog.delete(rel)
    state.catalogGen++
    this.scheduleCatalogCommit(state)
    return true
  }

  /** 清单增量提交去抖（事件/核验触发的合并写盘；全量枚举直写不经此） */
  private scheduleCatalogCommit(state: RootIndexState): void {
    if (state.catalogCommitTimer !== undefined) {
      clearTimeout(state.catalogCommitTimer)
    }
    state.catalogCommitTimer = setTimeout(() => {
      state.catalogCommitTimer = undefined
      void this.commitCatalog(state)
    }, this.commitDebounce)
  }

  /** 清单落盘（单文件原子写——临时写 + rename 由端口保证；写失败仅影响
   *  持久化，内存清单与 notify 照常，下一轮提交兜底） */
  private async commitCatalog(state: RootIndexState): Promise<void> {
    if (this.disposed || !state.catalog) {
      return
    }
    const content = serializeVaultCatalog(state.catalog.values(), state.catalogComplete)
    try {
      await this.storage.ensureDir(this.baseDirOf(state))
      await this.storage.writeFile(`${this.baseDirOf(state)}/catalog.json`, content)
    } catch (err) {
      console.warn(
        `[vsidian] 全文件清单写入失败（root=${state.fsPath}）：` +
        `${err instanceof Error ? err.message : String(err)}；下一轮提交兜底`,
      )
    }
  }

  // ---- 清单核验（#198） ----

  /**
   * 单根清单核验：列盘 → 分批 stat → mtime+size 比对（diffManifest，仅筛
   * 变化不作一致性证明）→ 变更/新增走 rescanFile（读正文重建边）、移除需
   * accessOf=missing 正证据（不可访问标 stale 不移除）。busy（扫描/泵/核验
   * 进行中）跳过——不重叠。
   */
  private async verifyRoot(state: RootIndexState): Promise<'busy' | 'done' | 'cancelled'> {
    if (this.disposed) {
      return 'cancelled'
    }
    if (state.scanning || state.verifying || state.pumping) {
      return 'busy'
    }
    if (!state.hasData || !state.model) {
      return 'done' // 无基线（首扫未完成/根刚移除）无事可核
    }
    state.verifying = true
    const epoch = this.maintenanceEpoch
    const cancelled = (): boolean => this.disposed || epoch !== this.maintenanceEpoch
    try {
      const candidates: Array<{ abs: string; rel: string }> = []
      for (const abs of await this.scan.listMarkdownFiles(state.fsPath)) {
        const rel = this.relOf(state, abs)
        if (rel !== null && this.rootOf(abs) === state && !this.excludeMatcher.test(rel)) {
          candidates.push({ abs, rel })
        }
      }
      const known = new Map<string, { mtimeMs: number; size: number }>()
      for (const [rel, entry] of state.model.files) {
        if (entry.kind === 'markdown') {
          known.set(rel, entry)
        }
      }
      // 分批 stat（批间让出；stat 失败不进清单——由移除正证据兜底区分）
      const current: Array<{ path: string; mtimeMs: number; size: number }> = []
      for (let i = 0; i < candidates.length; i++) {
        if (cancelled()) {
          return 'cancelled'
        }
        const { abs, rel } = candidates[i]!
        const stat = await this.scan.statFile(abs)
        if (stat) {
          current.push({ path: rel, mtimeMs: stat.mtimeMs, size: stat.size })
        }
        if ((i + 1) % this.verifyBatchFiles === 0) {
          await this.scan.yieldToEventLoop()
        }
      }
      const diff = diffManifest(known, current)
      let touched = false
      // 移除候选：正证据（accessOf=missing）才执行——不可访问不得当删除
      for (const rel of diff.removed) {
        if (cancelled()) {
          return 'cancelled'
        }
        const abs = this.absOf(state, rel)
        const access = await this.scan.accessOf(abs)
        if (access === 'missing') {
          this.removeBaselineEntry(state, rel)
          this.publishTargetChange(state, rel, 'deleted', null)
          // #556 T2：删除后重判（歧义恢复唯一的核验路径触发面）
          await this.rejudgeShortnameByBasenames(state, [this.basenameOfRel(rel)])
          touched = true
        } else if (access === 'inaccessible') {
          const prev = known.get(rel)
          this.publishTargetChange(
            state, rel, 'stale',
            prev ? { mtimeMs: prev.mtimeMs, size: prev.size } : null,
          )
        }
        // access=ok 但未在清单（列举漂移）：保守跳过，下轮核验兜底
      }
      // 变更/新增候选：逐文件重扫（读正文；核验批粒度让出）
      const pendingRels = [...diff.changed, ...diff.added]
      for (let i = 0; i < pendingRels.length; i++) {
        if (cancelled()) {
          return 'cancelled'
        }
        await this.rescanFile(state, this.absOf(state, pendingRels[i]!))
        touched = true
        if ((i + 1) % this.rescanBatchFiles === 0) {
          await this.scan.yieldToEventLoop()
        }
      }
      // #556 T2：跨根/外部目标条目核验（files 表绝对身份域）——外部目标
      // 不在 watcher 域（watchRoot 只监听根内），周期核验是其唯一的失效
      // 探测通道。三态语义与 md 域一致：missing 正证据移除并广播 deleted
      // （引用该目标的来源随之重抽、边转断链）；inaccessible 只广播 stale
      // （不冒充删除）；ok 时元数据变化更新条目并广播 changed
      const externals = [...state.model.files.keys()].filter((p) => this.isAbsoluteEntry(p))
      for (let i = 0; i < externals.length; i++) {
        if (cancelled()) {
          return 'cancelled'
        }
        const entryPath = externals[i]!
        const prev = state.model.files.get(entryPath)
        const access = await this.scan.accessOf(entryPath)
        if (access === 'missing') {
          state.model.files.delete(entryPath)
          this.refreshDerived(state)
          this.publishTargetChange(state, entryPath, 'deleted', null)
          touched = true
          // 引用该外部目标的来源重抽（边失效）：反链桶按身份聚合——fold 命中
          const sources = new Set<string>()
          for (const e of state.backlinks?.get(entryPath) ?? []) {
            sources.add(e.source)
          }
          if (state.backlinks && sources.size === 0) {
            for (const [key, list] of state.backlinks) {
              if (this.foldKey(key) === this.foldKey(entryPath)) {
                for (const e of list) {
                  sources.add(e.source)
                }
              }
            }
          }
          await this.rescanSources(state, sources)
        } else if (access === 'inaccessible') {
          this.publishTargetChange(
            state, entryPath, 'stale',
            prev ? { mtimeMs: prev.mtimeMs, size: prev.size } : null,
          )
        } else {
          const stat = await this.scan.statFile(entryPath)
          if (stat && prev && (prev.mtimeMs !== stat.mtimeMs || prev.size !== stat.size)) {
            state.model.files.set(entryPath, {
              ...prev,
              mtimeMs: stat.mtimeMs,
              size: stat.size,
              contentVersion: prev.contentVersion + 1,
            })
            this.publishTargetChange(state, entryPath, 'changed', { mtimeMs: stat.mtimeMs, size: stat.size })
            touched = true
          }
        }
        if ((i + 1) % this.verifyBatchFiles === 0) {
          await this.scan.yieldToEventLoop()
        }
      }
      // #377 T02 清单核验：全文件列举比对——外部增删（无事件漂移）兜底；
      // 部分枚举（failedDirs 非空）不做移除（不可访问不冒充删除）且
      // catalogComplete=false（查询侧呈部分就绪）。
      if (state.catalog) {
        if (cancelled()) {
          return 'cancelled'
        }
        const catListed = await this.scan.listAllFiles(state.fsPath, {
          skipDir: (dirFsPath) => this.isExcludedDirDeep(dirFsPath),
        })
        const completeNow = catListed.failedDirs.length === 0
        const listedRels = new Set<string>()
        // 列举项元数据：常用资源批量 stat（分批让出；仅记名条目 0/0——
        // 与 known 侧同形态，天然不误报 changed）
        const current: Array<{ path: string; mtimeMs: number; size: number }> = []
        let statDone = 0
        for (const abs of catListed.files) {
          if (cancelled()) {
            return 'cancelled'
          }
          const rel = this.relOf(state, abs)
          if (rel === null || this.rootOf(abs) !== state || this.excludeMatcher.test(rel)) {
            continue
          }
          listedRels.add(rel)
          if (!isCommonVaultFileCategory(classifyVaultFileCategory(rel))) {
            current.push({ path: rel, mtimeMs: 0, size: 0 })
            continue
          }
          const stat = await this.scan.statFile(abs)
          if (statDone++ % this.verifyBatchFiles === 0) {
            await this.scan.yieldToEventLoop()
          }
          if (stat && stat.type !== 'dir') {
            current.push({ path: rel, mtimeMs: stat.mtimeMs, size: stat.size })
          }
        }
        const known = new Map<string, { mtimeMs: number; size: number }>()
        for (const [rel, entry] of state.catalog) {
          known.set(rel, entry)
        }
        const catDiff = diffVaultCatalog(known, current)
        let catalogTouched = false
        const currentByPath = new Map(current.map((c) => [c.path, c] as const))
        for (const rel of [...catDiff.added, ...catDiff.changed]) {
          if (cancelled()) {
            return 'cancelled'
          }
          const hit = currentByPath.get(rel) ?? { mtimeMs: 0, size: 0 }
          catalogTouched = this.applyCatalogUpsert(
            state, rel, classifyVaultFileCategory(rel), hit.mtimeMs, hit.size,
          ) || catalogTouched
        }
        // 移除：仅完整枚举参与（正证据 accessOf=missing）
        if (completeNow) {
          for (const rel of catDiff.removed) {
            if (cancelled()) {
              return 'cancelled'
            }
            const access = await this.scan.accessOf(this.absOf(state, rel))
            if (access === 'missing') {
              if (this.removeCatalogEntry(state, rel)) {
                this.publishTargetChange(state, rel, 'deleted', null)
                catalogTouched = true
              }
            } else if (access === 'inaccessible') {
              const prev = state.catalog.get(rel)
              if (prev && (prev.mtimeMs > 0 || prev.size > 0)) {
                this.publishTargetChange(state, rel, 'stale', { mtimeMs: prev.mtimeMs, size: prev.size })
              }
            }
            // access=ok 但未在列举（列举漂移）：保守跳过，下轮核验兜底
          }
        }
        if (state.catalogComplete !== completeNow) {
          const flippedToComplete = completeNow && !state.catalogComplete
          state.catalogComplete = completeNow
          state.catalogGen++
          this.scheduleCatalogCommit(state)
          catalogTouched = true
          // 评审 F3：完整性翻转与扫描完成点共享全域短名重判——pending 边
          // （唯一候选但不完整）的判定依赖 complete，恢复完整必须重判。
          // 仅 false→true 有意义（true→false 时既有边维持，下轮恢复时统一
          // 重判）。核验态 busy：挂起接力由 finally 的 resumeAfterBusy 消费
          if (flippedToComplete) {
            void this.runShortnameRejudge(state, 'all')
          }
        }
        // F14：清单核验零变化不置位 touched——周期核验/焦点回归每 10 分钟
        // 一次，无条件 touched 会触发全模型序列化提交（10 万档实测 3.72s）
        // 与代际空转；仅在清单确有变化（catalogTouched）时合流 touched，
        // 「确有变化时」的提交与广播行为不变
        if (catalogTouched) {
          touched = true
          this.notify() // 清单核验变更：一次广播（聚合——不按条目数）
        }
      }
      if (touched) {
        this.scheduleCommit(state)
      }
      return 'done'
    } finally {
      state.verifying = false
      this.lastVerifyAt = Date.now()
      this.resumeAfterBusy(state)
    }
  }

  // ---- 变化发布（#198 通道；#201 消费） ----

  /** 初次观测：建立代次（=1）不广播 */
  private ensureGeneration(absFsPath: string): void {
    const key = this.normKey(absFsPath)
    if (!this.targetGenerations.has(key)) {
      this.targetGenerations.set(key, 1)
    }
  }

  private publishTargetChange(
    state: RootIndexState,
    rel: string,
    status: VaultTargetChangeStatus,
    stat: { mtimeMs: number; size: number } | null,
  ): void {
    // #556 T2：rel 可为规范绝对身份形态（跨根/外部目标条目）——绝对键
    // 直接归一，不与所属根拼接；事件 relPath 如实携带该形态
    const abs = this.isAbsoluteEntry(rel) ? this.normKey(rel) : this.absOf(state, rel)
    const key = this.normKey(abs)
    if (status === 'stale') {
      if (this.staleMarks.has(key)) {
        return // 持续不可访问：只广播首次转入
      }
      this.staleMarks.add(key)
    } else {
      this.staleMarks.delete(key)
    }
    const generation = (this.targetGenerations.get(key) ?? 0) + 1
    this.targetGenerations.set(key, generation)
    const event: VaultTargetChangeEvent = {
      fsPath: abs,
      rootFsPath: state.fsPath,
      relPath: rel,
      generation,
      status,
      stat,
    }
    for (const listener of [...this.targetListeners]) {
      try {
        listener(event)
      } catch {
        // 订阅者异常不阻断维护链路
      }
    }
  }

  // ---- 反链查询 ----

  /**
   * #199/#200 rename 改写候选：指向 oldFsPath 的引用边（按来源文档分组，
   * 基线 + 覆盖层合并视图——覆盖层在场的来源用未保存文本的边，区间对齐
   * 文档当前最新内容）与被移动文档自身的出链（.md 时；覆盖层优先）。
   * not-ready（首扫未完成/快照恢复中）时调用方不得做静默部分更新。
   */
  renameCandidatesOf(oldFsPath: string): {
    status: 'ready' | 'not-ready' | 'outside'
    /** ready 时为 old 所属根（outgoing 边的 resolvedTarget 根空间；外部目标为 null） */
    rootFsPath: string | null
    /** 引用者分组（键 = 来源 fsPath @ 边所在根——跨根来源按根分区，
     *  与 docsByKey 合并键同构）；边所在根经 group.edgeRootFsPath 携带 */
    incoming: Array<{ fsPath: string; edges: readonly VaultEdge[]; edgeRootFsPath: string }>
    outgoing: readonly VaultEdge[]
  } {
    const state = this.rootOf(oldFsPath)
    const absKey = this.normKey(oldFsPath)
    // 评审 F1：引用者按「规范目标身份跨来源分区」收集——目标所属根之外，
    // 凡 files 表登记过该目标绝对身份的根，其身份桶同样贡献来源（规格：
    // 已索引来源对跨根/外部目标的出链、反链及 VSCode 内更名更新均覆盖）；
    // 外部目标（无所属根）无任何登记时才维持 outside。与 backlinksOf 的
    // 跨根合并同口径（identityOnly 语义：身份桶命中，断链兜底不跨根）
    const states: RootIndexState[] = state ? [state] : []
    for (const s of this.roots.values()) {
      if (s === state || !s.hasData || !s.model || !s.backlinks) {
        continue
      }
      if (s.model.files.has(absKey)) {
        states.push(s)
      }
    }
    if (states.length === 0) {
      return { status: 'outside', rootFsPath: null, incoming: [], outgoing: [] }
    }
    // not-ready 语义保持「目标所属根未就绪不部分更新」；他根未就绪仅跳过
    // 该根贡献（跨根登记是渐进的，不能因一根在扫而放弃他根已就绪来源）
    if (state && (!state.hasData || !state.model || !state.backlinks)) {
      return { status: 'not-ready', rootFsPath: null, incoming: [], outgoing: [] }
    }
    const rel = state ? this.relOf(state, oldFsPath) : null
    if (state && rel === null) {
      return { status: 'outside', rootFsPath: null, incoming: [], outgoing: [] }
    }
    const incoming = new Map<string, { fsPath: string; edges: VaultEdge[]; edgeRootFsPath: string }>()
    for (const s of states) {
      if (!s.hasData || !s.model || !s.backlinks) {
        continue
      }
      // 反链桶按规范绝对身份聚合（#556 T2——resolvedTarget 身份域）；查询
      // fsPath 大小写可能漂移——fold 匹配桶键（Windows 语义）
      let bucketKey: string | null = null
      for (const key of s.backlinks.keys()) {
        if (this.foldKey(key) === this.foldKey(absKey)) {
          bucketKey = key
          break
        }
      }
      // 桶缺失不整段跳过（#269）：rename 后新目标的桶在依赖者重抽前恒空，
      // 但覆盖层在场的来源（面板打开的引用者经 will 改写只落 buffer，基线
      // 边恒指旧名、无桶可言）须仍可查——与 backlinksOf 同口径按
      // bucketKey ?? 查询键查询，覆盖层段独立遍历命中；基线桶不存在时该段
      // 自然为空。fold 传参同 backlinksOf（覆盖层边大小写漂移容错）。
      for (const e of queryBacklinks(
        s.backlinks, s.overlay, bucketKey ?? absKey, (p) => this.foldKey(p),
      )) {
        const abs = this.absOf(s, e.source)
        const groupKey = `${this.normKey(abs)}@${this.normKey(s.fsPath)}`
        let group = incoming.get(groupKey)
        if (!group) {
          incoming.set(groupKey, (group = { fsPath: abs, edges: [], edgeRootFsPath: s.fsPath }))
        }
        group.edges.push(e)
      }
    }
    const overlayEntry = state && rel !== null ? state.overlay.get(rel) : undefined
    const outgoing = state && rel !== null
      ? (overlayEntry
        ? overlayEntry.edges
        : state.model!.edges.filter((e) => e.source === rel))
      : []
    return {
      status: 'ready',
      rootFsPath: state ? state.fsPath : null,
      incoming: [...incoming.values()].map(({ fsPath, edges, edgeRootFsPath }) => ({ fsPath, edges, edgeRootFsPath })),
      outgoing,
    }
  }

  /**
   * 覆盖层条目只读视图（测试钩子观测口，`VSIDIAN_TEST_HOOKS` 门控命令
   * 消费）：返回该文档覆盖层边的 resolvedTarget 列表（断链为 null）；
   * 无条目返回 undefined。不触发任何状态变化。
   */
  overlayEdgesOf(fsPath: string): Array<string | null> | undefined {
    const state = this.rootOf(fsPath)
    if (!state) {
      return undefined
    }
    const rel = this.relOf(state, fsPath)
    const entry = rel === null ? undefined : state.overlay.get(rel)
    return entry ? entry.edges.map((e) => e.resolvedTarget) : undefined
  }

  /**
   * #199/#200 rename 后索引刷新（onDidRenameFiles 域）：旧路径退场与
   * 新路径登记。#200 起为批量化实现的单条委托（refreshRenamedBatch）。
   * 语义见 refreshRenamedBatch 注释；外部工具改名无 rename 事件，只经
   * watcher 增量维护，不经本入口。
   */
  async refreshRenamed(oldFsPath: string, newFsPath: string): Promise<void> {
    await this.refreshRenamedBatch([{ oldFsPath, newFsPath }])
  }

  /**
   * 目录前缀下已登记文件清单（#200 映射展开与 did 保底刷新的索引侧数据
   * 面）：.md 与 asset 全量返回。根未就绪（无数据）或路径在索引域外返回
   * null——调用方（expandRenameMoves）以 fs 列举兜底。
   */
  indexedFilesUnder(dirFsPath: string): string[] | null {
    const state = this.rootOf(dirFsPath)
    if (!state || !state.hasData || !state.model) {
      return null
    }
    const prefix = `${this.foldKey(this.normKey(this.ops.resolve(dirFsPath)))}/`
    const out: string[] = []
    for (const rel of state.model.files.keys()) {
      if (this.isAbsoluteEntry(rel)) {
        continue // 跨根/外部绝对身份条目不在本根 rel 域（#556 T2）
      }
      const abs = this.absOf(state, rel)
      if (this.foldKey(this.normKey(abs)).startsWith(prefix)) {
        out.push(abs)
      }
    }
    return out
  }

  /**
   * 目录子树是否整体落在排除域（#200 映射展开的 fs 递归剪枝）：探测目录
   * 下代表性路径——子树模式（默认的 .git、node_modules 排除与「目录名 +
   * 双星」这类整树形态）命中即剪；纯文件名模式（如「星.md」）不命中不剪
   * （目录内有未排除内容，误剪会丢 fs 兜底清单——索引清单不含排除者，
   * 二者合流仍完整）。
   */
  isExcludedDirDeep(dirFsPath: string): boolean {
    const state = this.rootOf(dirFsPath)
    if (!state) {
      return false
    }
    const rel = this.relOf(state, dirFsPath)
    if (rel === null) {
      return false
    }
    return this.excludeMatcher.test(`${rel}/\u0000probe`)
  }

  /**
   * #200 批量 rename 刷新（onDidRenameFiles 域，目录/多文件移动的展开后
   * 逐文件映射）：整批一次处理而非逐文件循环提交。语义与单条通道一致——
   *
   * - 旧侧移除须有 missing 正证据（不可访问标 stale 不当删除）；**旧路径
   *   仍可访问（ok）的极端形态跳过**——rename 完成后旧路径不应存在，ok
   *   意味着同位置另有文件（或映射异常），watcher 增量兜底（单文件通道
   *   经 rescanFile 重扫的等价行为由增量队列承担）
   * - 新侧 .md **两遍登记**：遍 1 装载文本与 stat 并登记 files entry，
   *   遍 2 统一抽边——批内互链文档（目录内 A 引用 B）的 resolver 可见
   *   完整新清单，不因处理顺序产生断链
   * - 新侧非 .md 附件无条件登记 asset（事件驱动窄登记，同单条通道）
   * - 排除的 .md 不进不出（排除来源不贡献索引）
   * - **批末合并**：每根一次 backlinks 重建 + 一次广播 + 一次快照提交
   *   （去抖合并）；分批让出事件循环（批大小复用 rescanBatchFiles）
   * - publishTargetChange 逐文件保持（#201 消费 per-target 代次）
   */
  async refreshRenamedBatch(moves: ReadonlyArray<{ oldFsPath: string; newFsPath: string }>): Promise<void> {
    interface MdLoad {
      fsPath: string
      rel: string
      text: string
      stat: { mtimeMs: number; size: number }
      prevEntry: VaultFileEntry | undefined
    }
    if (this.disposed || moves.length === 0) {
      return
    }
    const oldByRoot = new Map<RootIndexState, string[]>()
    const newByRoot = new Map<RootIndexState, string[]>()
    for (const move of moves) {
      const oldState = this.rootOf(move.oldFsPath)
      if (oldState) {
        pushTo(oldByRoot, oldState, move.oldFsPath)
      }
      const newState = this.rootOf(move.newFsPath)
      if (newState) {
        pushTo(newByRoot, newState, move.newFsPath)
      }
    }

    // ---- 旧侧：移除（missing 正证据）/ stale 标记 ----
    const touchedRoots = new Set<RootIndexState>()
    for (const [state, fsPaths] of oldByRoot) {
      if (!state.model) {
        continue
      }
      for (let i = 0; i < fsPaths.length; i++) {
        const fsPath = fsPaths[i]!
        const rel = this.relOf(state, fsPath)
        if (rel === null) {
          continue
        }
        if (/\.md$/i.test(fsPath) && this.excludeMatcher.test(rel)) {
          continue // 排除域不进不出
        }
        const access = await this.scan.accessOf(fsPath)
        if (access === 'missing') {
          if (state.model.files.has(rel)) {
            state.model.files.delete(rel)
            state.model.edges = state.model.edges.filter((e) => e.source !== rel)
            touchedRoots.add(state)
          }
          // #377 T02：清单条目随旧路径退场（missing 正证据；发布 deleted）
          if (this.removeCatalogEntry(state, rel)) {
            touchedRoots.add(state)
          }
          this.publishTargetChange(state, rel, 'deleted', null)
        } else if (access === 'inaccessible') {
          const prev = state.model.files.get(rel)
          this.publishTargetChange(
            state, rel, 'stale',
            prev ? { mtimeMs: prev.mtimeMs, size: prev.size } : null,
          )
        }
        if ((i + 1) % this.rescanBatchFiles === 0) {
          await this.scan.yieldToEventLoop()
        }
      }
    }

    // ---- 新侧：.md 两遍登记 / asset 无条件登记 ----
    for (const [state, fsPaths] of newByRoot) {
      if (!state.model || this.disposed) {
        continue
      }
      const mdLoads: MdLoad[] = []
      const assetPaths: string[] = []
      /** 本批在该根新登记的位置（.md + asset；遍 3 依赖者检测的接通域） */
      const registered = new Set<string>()
      for (let i = 0; i < fsPaths.length; i++) {
        const fsPath = fsPaths[i]!
        const rel = this.relOf(state, fsPath)
        if (rel === null) {
          continue
        }
        if (/\.md$/i.test(fsPath)) {
          if (this.excludeMatcher.test(rel)) {
            continue
          }
          const [raw, stat] = await Promise.all([this.scan.readFileText(fsPath), this.scan.statFile(fsPath)])
          if (raw === null || stat === null) {
            continue // 可访问但读失败：保守跳过，watcher 增量兜底
          }
          mdLoads.push({
            fsPath,
            rel,
            text: normalizeLf(raw),
            stat,
            prevEntry: state.model.files.get(rel),
          })
          state.model.files.set(rel, {
            path: rel,
            kind: 'markdown',
            mtimeMs: stat.mtimeMs,
            size: stat.size,
            contentVersion: (state.model.files.get(rel)?.contentVersion ?? 0) + 1,
            ...this.birthtimeOf(stat),
          })
          // #377 T02：md 新位置入清单（磁盘 stat；排除域不入清单；changed
          // 由批末统一发布，此处静默登记不双发）
          if (!this.excludeMatcher.test(rel)) {
            this.applyCatalogUpsert(state, rel, 'markdown', stat.mtimeMs, stat.size, false)
          }
          registered.add(rel)
        } else {
          assetPaths.push(fsPath)
        }
        if ((i + 1) % this.rescanBatchFiles === 0) {
          await this.scan.yieldToEventLoop()
        }
      }
      // 遍 1.5：asset 的 stat + 登记**先于抽边**（对齐 fullScan 两遍法次序）——
      // 批内 md 指向同批附件的边（目录恒等平移场景）在遍 2 抽边时 resolver
      // 已可见新位置附件，不因处理顺序产生断链
      let touched = mdLoads.length > 0
      for (const fsPath of assetPaths) {
        const rel = this.relOf(state, fsPath)
        if (rel === null) {
          continue
        }
        const stat = await this.scan.statFile(fsPath)
        if (!stat) {
          continue
        }
        const prev = state.model.files.get(rel)
        state.model.files.set(rel, {
          path: rel,
          kind: 'asset',
          mtimeMs: stat.mtimeMs,
          size: stat.size,
          contentVersion: (prev?.contentVersion ?? 0) + 1,
          ...this.birthtimeOf(stat),
        })
        this.ensureGeneration(fsPath)
        // #377 T02：附件新位置入清单（引用关系登记与清单登记分别判定——
        // 排除位置目标仍登记 asset（#198 语义），清单侧排除不入）
        if (!this.excludeMatcher.test(rel) && stat.type !== 'dir') {
          const category = classifyVaultFileCategory(rel)
          if (isCommonVaultFileCategory(category)) {
            this.applyCatalogUpsert(state, rel, category, stat.mtimeMs, stat.size)
          } else {
            this.applyCatalogUpsert(state, rel, category, 0, 0)
          }
        }
        registered.add(rel)
        touched = true
      }
      // 遍 2：抽边（resolver 可见遍 1/1.5 登记的完整新清单——批内互链不断链）
      const mdRels = new Set(mdLoads.map((l) => l.rel))
      const missed: string[] = []
      const { resolve, resolveAbsolute } = this.makeModelResolvers(state, missed)
      for (const load of mdLoads) {
        const edges = extractVaultEdges(load.rel, load.text, {
          docDir: this.dirname(load.fsPath),
          rootDir: state.fsPath,
          isWindowsHost: this.opts.isWindowsHost,
        }, resolve, {
          lookupShortname: this.shortnameLookupFor(state),
          resolveAbsolute,
        })
        state.model.edges = state.model.edges.filter((e) => e.source !== load.rel).concat(edges)
      }
      // 外部目标登记（#556 T2）：本批文档引用的未登记绝对目标 stat 后登记
      const externalRegistered = await this.registerExternalTargets(state, missed)
      // 登记后断链边重抽一次（#556 收口补齐——与扫描路径 rescanFile 的
      // 登记后重抽同款语义：遍 2 抽边时登记表未就绪，绝对目标边以断链入
      // 基线；增量泵此前无此重抽，外部目标边恒断链——出链绝对身份快照
      // （localResourceRoots 授权面数据源）与跨根消费口都读到 null）。
      // 只重抽边表里有断链边的本批文档（登记数 0 或全接通时不重解析）
      if (externalRegistered > 0 && state.model.edges.some((e) => e.resolvedTarget === null && mdRels.has(e.source))) {
        const reResolve = this.makeModelResolvers(state)
        for (const load of mdLoads) {
          if (!state.model.edges.some((e) => e.source === load.rel && e.resolvedTarget === null)) {
            continue
          }
          state.model.edges = state.model.edges.filter((e) => e.source !== load.rel).concat(
            extractVaultEdges(load.rel, load.text, {
              docDir: this.dirname(load.fsPath),
              rootDir: state.fsPath,
              isWindowsHost: this.opts.isWindowsHost,
            }, reResolve.resolve, {
              lookupShortname: this.shortnameLookupFor(state),
              resolveAbsolute: reResolve.resolveAbsolute,
            }),
          )
        }
      }
      // 遍 3（#269 目标归位重抽依赖者）：引用者的 will edit 落盘早于 rename
      // 应用，其 watcher 重扫若先于本批登记（泵与 did 通道在事件循环上竞态），
      // 断链边入基线后无事件重抽——新目标桶恒空，连续 rename 静默漏改写。
      // 按批内新登记位置找出「断链重解析恰好接通」的来源重扫（其盘面已是
      // 改写后文本，重抽即接通、桶随归位重建）。本批被移动文件不重扫——
      // 遍 2 已按完整新清单抽边，重扫是纯冗余。
      if (registered.size > 0) {
        const registeredFold = new Set([...registered].map((r) => this.foldKey(this.identityOf(state, r))))
        const resolver = this.makeModelResolvers(state)
        const dependents = new Set<string>()
        for (const e of state.model.edges) {
          if (e.resolvedTarget !== null || registered.has(e.source)) {
            continue
          }
          const hit = reresolveVaultEdgeTarget(e, {
            docDir: this.dirname(this.absOf(state, e.source)),
            rootDir: state.fsPath,
            isWindowsHost: this.opts.isWindowsHost,
          }, resolver.resolve, {
            lookupShortname: this.shortnameLookupFor(state),
            resolveAbsolute: resolver.resolveAbsolute,
          })
          if (hit !== null && registeredFold.has(this.foldKey(hit))) {
            dependents.add(e.source)
          }
        }
        let rescanned = 0
        for (const rel of dependents) {
          await this.rescanFile(state, this.absOf(state, rel))
          if ((++rescanned) % this.rescanBatchFiles === 0) {
            await this.scan.yieldToEventLoop()
          }
        }
      }
      if (touched) {
        touchedRoots.add(state)
        for (const load of mdLoads) {
          if (!load.prevEntry || load.prevEntry.mtimeMs !== load.stat.mtimeMs ||
            load.prevEntry.size !== load.stat.size) {
            this.publishTargetChange(state, load.rel, 'changed', load.stat)
          }
        }
      }
    }

    // ---- 批末：每根一次 backlinks 重建 + 广播 + 快照提交（整批合并） ----
    // #556 T2：旧/新位置的 Markdown basename 集合（重判触发面——唯一变
    // 歧义、恢复唯一、相对候选抢占在 rename 后同样成立）
    const affectedBasenames = new Set<string>()
    for (const move of moves) {
      for (const p of [move.oldFsPath, move.newFsPath]) {
        if (/\.md$/i.test(p)) {
          affectedBasenames.add(this.basenameOfRel(normalizeSeparators(this.ops.resolve(p))))
        }
      }
    }
    for (const state of touchedRoots) {
      if (!state.model) {
        continue
      }
      // #269 慢时序兜底：覆盖层冲刷早于本批新路径登记（大批量/慢盘下 did
      // 登记 > 500ms 防抖）时，断链边按当时世界落层且无后续冲刷时机——
      // 批末按完整新清单重算现存未保存条目（同版本世界重算，reapply）
      for (const key of state.unsaved.keys()) {
        this.recomputeUnsaved(state, key, true)
      }
      this.refreshDerived(state)
      this.notify()
      this.scheduleCommit(state)
      await this.rejudgeShortnameByBasenames(state, affectedBasenames)
    }
  }

  /**
   * 双链联想文件候选（#376 T01 建立，#377 T02 扩展为全文件清单）：候选源
   * 为来源文档所属根的全文件清单（所有未排除普通文件——未被引用的附件与
   * 未知类型可搜索）；清单未就绪（null，构建中/待恢复）时回退现有索引
   * Markdown/附件条目并标 updating（部分就绪不冒充完整空结果）。
   *
   * 排序契约（shared/wikilinkQuery，VSCode 基线移植 ADR-0014）：空查询仅
   * 常用资源（Markdown/图片/PDF/音视频/可读文本——零 IO 后缀派生），按
   * mtime 新→旧（未知沉底）、稳定路径破同分；有查询允许 .pyc 等未知/编译
   * 类型，匹配分数优先、同分再 mtime、稳定路径破同分。total 为命中总数，
   * items 自第 offset 个**可投递**候选（病态候选滑动跳过后）起取至多
   * limit 条——items.length < limit 即已穷尽（分页终态判据；排序在截取
   * 前全量完成）。
   *
   * 插入路径在宿主侧按来源文档目录计算并经 vaultLink 往返核对（核对失败
   * 的病态候选丢弃，不产出不可信路径）；别名 Markdown 去尾 .md、其余保留
   * 完整文件名。catalogGen 为清单代次回显（webview 侧拒收跨代次的迟到追
   * 加页）。未就绪/越根真实报状态，不伪装空结果。同步执行（内存模型，
   * 无 IO）——迟到/乱序由 webview 侧 reqId+generation 守卫承担。
   */
  queryWikilinkFileCandidates(
    sourceFsPath: string,
    query: string,
    offset = 0,
    limit = WIKILINK_QUERY_LIMIT,
    opts?: { insertPathType?: WikilinkInsertPathMode },
  ):
    | { status: 'unavailable'; reason: 'no-workspace' | 'not-ready' }
    | { status: 'ready'; updating: boolean; total: number; catalogGen: number; items: WikilinkCandidateItem[] } {
    const state = this.rootOf(sourceFsPath)
    if (!state) {
      return { status: 'unavailable', reason: 'no-workspace' }
    }
    if (!state.hasData || !state.model) {
      return { status: 'unavailable', reason: 'not-ready' }
    }
    const sourceRel = this.relOf(state, sourceFsPath)
    if (sourceRel === null) {
      return { status: 'unavailable', reason: 'no-workspace' }
    }
    // #556 T5 插入路径档位：缺省 relative（不传档位的既有调用行为不变）；
    // 逐查询传入（调用点从设置快照读取——设置变更后下一次查询即按新档位
    // 产出，即时生效）。shortest 档的核对数据面（同目录候选直击/遮蔽 +
    // 短名补查）在本方法内从清单数据装配（R6 零 IO、R1 与跳转/悬停共用
    // shortnameLookupFor 数据面）
    const shortest = opts?.insertPathType === 'shortest'
    const files: WikilinkCandidateFile[] = []
    /** 候选类型（别名派生：markdown 去尾 .md，其余完整文件名） */
    const kindByRel = new Map<string, 'markdown' | 'asset'>()
    /** shortest 档存在性端口的命中集（fold 身份 → 索引域真实身份形态） */
    const identityByFold = new Map<string, string>()
    const pushFile = (rel: string, mtimeMs: number, kind: 'markdown' | 'asset'): void => {
      const nameAt = rel.lastIndexOf('/') + 1
      files.push({
        name: rel.slice(nameAt),
        dir: nameAt > 0 ? rel.slice(0, nameAt - 1) : '',
        relPath: rel,
        mtimeMs,
      })
      kindByRel.set(rel, kind)
      if (shortest) {
        const identity = this.identityOf(state, rel)
        identityByFold.set(this.foldKey(identity), identity)
      }
    }
    const catalog = state.catalog
    if (catalog !== null) {
      for (const [rel, entry] of catalog) {
        pushFile(rel, entry.mtimeMs, entry.category === 'markdown' ? 'markdown' : 'asset')
      }
    } else {
      // 清单未就绪回退：现有索引的 Markdown 与被引用附件（可用项继续候选；
      // 跨根/外部绝对身份条目不进候选——联想不扫描其他根或外部目录，#556）
      for (const [rel, entry] of state.model.files) {
        if (this.isAbsoluteEntry(rel)) {
          continue
        }
        pushFile(
          rel,
          entry.mtimeMs,
          entry.kind === 'markdown' ? 'markdown' : 'asset',
        )
      }
    }
    // 空查询资格：仅常用资源（其他类型可被有查询命中——分页/排序共用同一
    // 排序实现，过滤在排序前完成）。F10：判空与评分侧同源
    // （prepareWikilinkQuery 的 normalized——单 `*`/引号等全符号查询在评分
    // 侧为空查询，此处不得以 trim 口径分叉放开常用资源过滤）
    const preparedEmpty = prepareWikilinkQuery(query).normalized === ''
    const pool = preparedEmpty
      ? files.filter((f) => {
        const rel = f.relPath
        const entry = catalog?.get(rel)
        const category = entry
          ? entry.category
          : classifyVaultFileCategory(rel) // 回退路径零 IO 派生（asset 按 after 派生）
        return isCommonVaultFileCategory(category)
      })
      : files
    const docDir = this.dirname(sourceFsPath)
    // 插入路径档位选项：shortest 携核对端口（存在性 = 清单身份 fold 集，
    // 补查 = shortnameLookupFor 倒排）；absolute/relative 只传档位；缺省
    // 不传 options（与既有调用逐字节一致）
    const insertOptions: WikilinkInsertPathOptions | undefined = shortest
      ? {
          mode: 'shortest',
          exists: (fsPath: string): string | null =>
            identityByFold.get(this.foldKey(this.normKey(fsPath))) ?? null,
          lookupShortname: (basename: string) => this.shortnameLookupFor(state)(basename),
        }
      : opts?.insertPathType === undefined
        ? undefined
        : { mode: opts.insertPathType }
    const items: WikilinkCandidateItem[] = []
    // F6：病态候选（insertPath 规划失败或写回往返失败）在页内丢弃须**补位**
    // ——排名全量取得后自头部滑动跳过病态条目，从第 offset 个**可投递**
    // 候选起凑满 limit 或穷尽（webview 续页的 offset 为已投递数，病态占位
    // 会使排名偏移错位、续页重复/尾部空页死循环）。items.length < limit 即
    // 穷尽信号（webview 以满页与否作终态判据）；total 保持命中总数，排序
    // 契约不变（滑动只跳过、不重排）
    const ranked = rankWikilinkCandidates(pool, query, pool.length)
    const limitClamped = Math.max(0, limit)
    let deliverableSeen = 0
    for (const item of ranked.items) {
      if (items.length >= limitClamped) {
        break // 已凑满（offset 之前不可能凑满，deliverableSeen 已越过）
      }
      const abs = this.absOf(state, item.relPath)
      // 插入路径按来源文档目录计算并经 vaultLink 往返核对 + F5 写回语法
      // 往返核对——核对失败的病态候选丢弃，不产出与所选身份不一致或写入
      // 即损坏引用的路径；#556 T5 起按档位生成（shortest/absolute 见上）
      const insertPath = planWikilinkInsertPath(docDir, state.fsPath, this.opts.isWindowsHost, abs, insertOptions)
      const alias = defaultAliasOf(item.name, kindByRel.get(item.relPath) ?? 'asset')
      if (insertPath === null || !wikilinkFileCandidateSafe(insertPath, alias)) {
        continue
      }
      if (deliverableSeen >= Math.max(0, offset)) {
        items.push({
          id: abs,
          name: item.name,
          dir: item.dir,
          relPath: item.relPath,
          insertPath,
          alias,
          mtimeMs: item.mtimeMs,
          score: item.score,
          labelHighlights: item.labelHighlights,
          dirHighlights: item.dirHighlights,
        })
      }
      deliverableSeen++
    }
    return {
      status: 'ready',
      updating: state.scanning || state.catalogScanning || !state.catalogComplete,
      total: ranked.total,
      catalogGen: state.catalogGen,
      items,
    }
  }

  /** 查询文档的反链（面板数据源；items 按来源路径/位置稳定排序） */
  async backlinksOf(fsPath: string): Promise<BacklinksResult> {
    const state = this.rootOf(fsPath)
    if (!state) {
      // #556 T2：工作区外目标身份无所属根——某根登记过该外部目标时按各根
      // 的绝对身份桶合并查询（登记根各自贡献来源）；无任何登记维持
      // no-workspace（与「无工作区文档」的面板契约不分叉）
      const absKey = this.normKey(fsPath)
      const registered = [...this.roots.values()].some((s) => s.model?.files.has(absKey))
      if (!registered) {
        return { status: 'error', reason: 'no-workspace' }
      }
      const items: BacklinkItem[] = []
      let updating = false
      for (const s of this.roots.values()) {
        if (!s.hasData || !s.model || !s.backlinks) {
          continue
        }
        updating = updating || s.scanning
        items.push(...await this.collectBacklinkItems(s, fsPath, { identityOnly: true }))
      }
      return { status: 'ready', items, updating }
    }
    if (!state.hasData || !state.model || !state.backlinks) {
      return state.scanning ? { status: 'loading' } : { status: 'error', reason: 'read-error' }
    }
    const items = await this.collectBacklinkItems(state, fsPath)
    let updating = state.scanning
    // #556 T3 跨根合并（T2 移交）：目标位于本根分区，但**他根来源**以显式
    // 绝对路径登记了指向本目标的边（边在他根的 backlinks 身份桶里，本根
    // 分区查不到）——规格「已索引来源对跨根目标的反链覆盖」。凡 files 表
    // 登记了该目标绝对身份的他根分区，其身份桶贡献并入（identityOnly——
    // 断链 basename 兜底不跨根，见下）。分区不串：身份桶按规范绝对身份
    // 聚合，不同根同名相对路径天然不撞桶
    const absKey = this.normKey(fsPath)
    for (const s of this.roots.values()) {
      if (s === state || !s.hasData || !s.model || !s.backlinks) {
        continue
      }
      if (!s.model.files.has(absKey)) {
        continue
      }
      updating = updating || s.scanning
      items.push(...await this.collectBacklinkItems(s, fsPath, { identityOnly: true }))
    }
    return { status: 'ready', items, updating }
  }

  /** 单根内的反链条目收集（桶匹配 + 断链兜底 + 片段与行号装配）。
   *  identityOnly（#556 T3 跨根/外部合并查询专用）：只取绝对身份桶，跳过
   *  basename/stem 断链兜底——断链兜底的语义是「同根内短名本可命中该
   *  目标」（补查限来源所属根），跨根/跨边界按名匹配恰是「不同根的同名
   *  路径不串反链」要拦的形态；目标所属根自身的查询保持兜底不变 */
  private async collectBacklinkItems(
    state: RootIndexState,
    fsPath: string,
    opts: { identityOnly?: boolean } = {},
  ): Promise<BacklinkItem[]> {
    // 反链桶按规范绝对身份聚合（#556 T2——resolvedTarget 身份域）；查询
    // fsPath 的大小写可能漂移——fold 匹配桶键后按 fold 查询（与
    // renameCandidatesOf 同口径；POSIX 宿主 fold 为 identity，大小写敏感
    // 语义保持）
    const absKey = this.normKey(fsPath)
    let bucketKey: string | null = null
    for (const key of state.backlinks!.keys()) {
      if (this.foldKey(key) === this.foldKey(absKey)) {
        bucketKey = key
        break
      }
    }
    let edges = queryBacklinks(
      state.backlinks!, state.overlay, bucketKey ?? absKey,
      (p) => this.foldKey(p),
    )
    // #556 T2 断链兜底：短名边重判/接通后断链按 target 原文聚合（裸名
    // 桶），文件身份查询按 basename（显式 .md 断链）与去扩展名 stem
    // （省略扩展名断链）兜底命中——「哪些文件断链指向 X」对短名边保持
    // 可见（桶键为裸名的必为断链边，解析边恒在身份桶，无双计）。
    // identityOnly（#556 T3 跨根合并）：兜底不跨根（见函数头注释）
    if (opts.identityOnly === true) {
      return this.assembleBacklinkItems(state, edges)
    }
    const basename = this.basenameOfRel(absKey)
    const fallbackKeys = basename.toLowerCase().endsWith('.md') && basename.length > 3
      ? [basename, basename.slice(0, -3)]
      : [basename]
    for (const fallback of fallbackKeys) {
      let brokenBucket: string | null = null
      for (const key of state.backlinks!.keys()) {
        if (this.foldKey(key) === this.foldKey(fallback)) {
          brokenBucket = key
          break
        }
      }
      if (brokenBucket === null) {
        continue
      }
      const broken = queryBacklinks(
        state.backlinks!, state.overlay, brokenBucket,
        (p) => this.foldKey(p),
      ).filter((e) => e.resolvedTarget === null)
      for (const e of broken) {
        if (!edges.includes(e)) {
          edges.push(e)
        }
      }
    }
    // 片段与行号：来源有未保存内容优先取其文本（覆盖层边对齐覆盖层文本），
    // 其余读盘一次（OS 缓存；CRLF 归一与抽取同口径）
    return this.assembleBacklinkItems(state, edges)
  }

  /** 反链条目装配（片段/行号/长片段与文件元数据；读来源正文一次） */
  private async assembleBacklinkItems(state: RootIndexState, edges: VaultEdge[]): Promise<BacklinkItem[]> {
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
      let snippetStart = 0
      let snippetLong = ''
      let snippetLongStart = 0
      if (lf !== null && e.start <= lf.length) {
        const lineStart = lf.lastIndexOf('\n', Math.min(e.start, lf.length - 1)) + 1
        line = lf.slice(0, lineStart).split('\n').length
        const nl = lf.indexOf('\n', lineStart)
        const lineEnd = nl < 0 ? lf.length : nl
        snippet = lf.slice(lineStart, lineEnd)
        snippetStart = lineStart
        if (snippet.length > this.snippetLimit) {
          snippet = `${snippet.slice(0, this.snippetLimit)}…`
        }
        // 长片段（「更多上下文」态）：引用行 ±2 行窗口，总长上限约 300 字符，
        // 首尾按截断加「…」（头部截断 = 窗口起点之前仍有内容）
        let winStart = lineStart
        for (let i = 0; i < SNIPPET_LONG_CONTEXT_LINES && winStart > 0; i++) {
          const prev = lf.lastIndexOf('\n', winStart - 2)
          winStart = prev < 0 ? 0 : prev + 1
        }
        let winEnd = lineEnd
        for (let i = 0; i < SNIPPET_LONG_CONTEXT_LINES && winEnd < lf.length; i++) {
          const nl2 = lf.indexOf('\n', winEnd + 1)
          winEnd = nl2 < 0 ? lf.length : nl2
        }
        let win = lf.slice(winStart, winEnd)
        if (win.length > SNIPPET_LONG_LIMIT) {
          win = `${win.slice(0, SNIPPET_LONG_LIMIT)}…`
        }
        if (winStart > 0) {
          win = `…${win}`
        }
        snippetLong = win
        snippetLongStart = winStart
      }
      const fileEntry = state.model?.files.get(e.source)
      return {
        sourceRelPath: e.source,
        sourceFsPath: this.absOf(state, e.source),
        kind: e.kind,
        anchor: e.anchor,
        start: e.start,
        end: e.end,
        line,
        snippet,
        snippetStart,
        sourceMtimeMs: fileEntry?.mtimeMs ?? 0,
        sourceBirthtimeMs: fileEntry?.birthtimeMs ?? 0,
        snippetLong,
        snippetLongStart,
      }
    })
    return items
  }

  /** 查询文档的出链（出链面板数据源；含覆盖层未保存态，外链不进面板） */
  async outlinksOf(fsPath: string): Promise<OutlinksResult> {
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
    // 覆盖层在场用覆盖层边（未保存编辑即时反映，与 queryBacklinks 同源
    // 语义）；否则按来源路径取基线边（fold 匹配——查询路径大小写漂移容忍）
    const overlayEntry = state.overlay.get(rel)
    const sourceEdges = overlayEntry
      ? overlayEntry.edges
      : state.model.edges.filter((e) => this.foldKey(e.source) === this.foldKey(rel))
    // 外链排除：分类复用跳转链路同一分类器（vaultLinkExtract 帮手）
    const ctx: LinkContext = {
      docDir: this.dirname(this.absOf(state, rel) ?? fsPath),
      rootDir: state.fsPath,
      isWindowsHost: this.opts.isWindowsHost,
    }
    const items: OutlinkItem[] = []
    for (const e of sourceEdges) {
      if (!isVaultPanelOutlink(e, ctx)) {
        continue
      }
      const resolved = e.resolvedTarget !== null
      // resolvedTarget 为规范绝对身份（#556 T2）：显示名按身份 basename；
      // targetRelPath 保持根内相对域（relOf 对根内身份还原 rel，跨根/外部
      // 目标无根内 rel 为 null），targetFsPath 直接取身份
      const display = resolved
        ? basenameNoExt(e.resolvedTarget!)
        : e.target
      items.push({
        targetDisplay: display,
        targetRelPath: resolved ? this.relOf(state, e.resolvedTarget!) : null,
        targetFsPath: resolved ? e.resolvedTarget : null,
        kind: e.kind,
        anchor: e.anchor,
        resolved,
        start: e.start,
        end: e.end,
      })
    }
    // stable 排序：resolved（命中在前）→ 目标 → 区间
    items.sort((a, b) =>
      a.resolved === b.resolved
        ? a.targetDisplay < b.targetDisplay
          ? -1
          : a.targetDisplay > b.targetDisplay
            ? 1
            : a.start - b.start || a.end - b.end
        : a.resolved
          ? -1
          : 1,
    )
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

  /** birthtimeMs 采集帮手：>0 才写键（POSIX 取不到为 0/缺省——面板排序
   *  沉底语义与快照缺列容忍都以「键缺省」表达） */
  private birthtimeOf(stat: { birthtimeMs?: number } | null | undefined): { birthtimeMs?: number } {
    return stat?.birthtimeMs !== undefined && stat.birthtimeMs > 0
      ? { birthtimeMs: stat.birthtimeMs }
      : {}
  }

  // ---- 路径工具（根内相对统一 `/` 形态；平台语义按注入配置） ----

  private get ops(): typeof path.posix {
    return this.opts.isWindowsHost ? path.win32 : path.posix
  }

  private normKey(fsPath: string): string {
    return normalizeSeparators(this.ops.resolve(fsPath)).replace(/\/$/, '')
  }

  /** 根内相对路径（`/` 形态）；越根 null（精确判定 `..`/`..` + 平台分隔符
   *  前缀——`..drafts.md` 这类 .. 起头的文件名不是上行，与 vaultLink.
   *  isInsideRoot 口径一致；越根前缀跟随 ops.sep：win32 的 relative 产出
   *  `..\` 形态，硬编码 '../' 会漏拦多段越根） */
  private relOf(state: RootIndexState, fsPath: string): string | null {
    const rel = this.ops.relative(this.ops.resolve(state.fsPath), this.ops.resolve(fsPath))
    if (rel === '' || rel === '..' || rel.startsWith(`..${this.ops.sep}`) || this.ops.isAbsolute(rel)) {
      return null
    }
    return normalizeSeparators(rel)
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

/** Map<K, V[]> 追加（#200 批量刷新的按根分组辅助） */
function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) {
    list.push(value)
  } else {
    map.set(key, [value])
  }
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
