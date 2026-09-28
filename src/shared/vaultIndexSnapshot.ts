// 引用索引分片快照存储纯逻辑（工单 #195 选型模块，#197 接线）。
//
// 「紧凑分片快照 + 内存关系表」方案的单一事实源：负责规划一次快照提交
// 写哪些文件、按什么顺序写（原子性与崩溃安全的关键），以及从存储目录
// 状态恢复模型、决定回退与回收。fs 访问经 VaultIndexFsPort 注入，本模块
// 零 vscode / node 专属依赖（TextEncoder 为 Web 标准，Node 18 与宿主均备），
// 供宿主侧装配与 vitest 直测。
//
// 目录布局（baseDir = 扩展私有工作区存储下的根分区目录，如
// <context.storageUri>/vsidian-index/<rootKey>）：
//
//   CURRENT                // 纯文本 = 当前代目录名；唯一提交点，原子替换
//   gen-000006-a1b2/       // 代目录：6 位代际号 + 写者随机段（多窗口防撞）
//     manifest.json        // formatVersion / generation / 片清单与校验和
//     shard-000.json       // 列式紧凑 JSON：字符串表 + 文件条目 + 出链边
//     shard-001.json
//   tmp-write-*/           // 写入期临时目录（残留即回收候选）
//
// 崩溃安全三要素：
// 1. 片与 manifest 均按「写临时文件 + rename」原子落盘（SnapshotWrite.atomic
//    标记，由端口实现保证）；manifest 中的 bytes/checksum 检出半截写入。
// 2. CURRENT 最后写：写它之前，磁盘上的新代目录已经是完整可加载的。
// 3. 回收只删「代际号不高于当前 CURRENT 指向代且非其继承源」的目录，
//    读者至多回退到更旧完整代，永不读到半新半旧。
import { buildBacklinkIndex, sortEdges, type VaultEdge, type VaultEdgeKind, type VaultFileEntry, type VaultFileKind, type VaultIndexModel } from './vaultIndexModel'

export { buildBacklinkIndex }
export type { VaultEdge, VaultEdgeKind, VaultFileEntry, VaultFileKind, VaultIndexModel } from './vaultIndexModel'

/** 快照格式版本：片/manifest 结构不兼容演进时递增，加载侧拒读异版本。
 *  v2：文件行加 kind 列（markdown/asset），边行加 resolvedTarget 列。 */
export const SNAPSHOT_FORMAT_VERSION = 2

/** 单次提交的片数上限（shard 文件名三位补零）。 */
export const MAX_SHARD_COUNT = 1000

const EDGE_KIND_CODE: readonly VaultEdgeKind[] = ['wikilink', 'mdlink', 'image', 'refdef']
const KIND_BY_CODE = new Map(EDGE_KIND_CODE.map((k, i) => [i, k] as const))
const FILE_KIND_CODE: readonly VaultFileKind[] = ['markdown', 'asset']
const FILE_KIND_BY_CODE = new Map(FILE_KIND_CODE.map((k, i) => [i, k] as const))

/** 稳定字符串 hash（FNV-1a 32 位）：分片与内容校验和共用，非密码学用途。 */
export function stableHash(text: string): string {
  return fnv1a(text).toString(16).padStart(8, '0')
}

/** 文件路径 → 稳定片号：同一路径永远落同一片（增量提交的基石）。
 *  取 hash 高低 16 位折叠后取模，避免 FNV 低比特对结构化短路径分布弱。 */
export function shardIdForPath(path: string, shardCount: number): number {
  const h = fnv1a(path)
  return ((h ^ (h >>> 16)) >>> 0) % shardCount
}

function fnv1a(text: string): number {
  // FNV-1a over UTF-8 字节（与 TextEncoder 输出一致，两端同结果）
  const bytes = new TextEncoder().encode(text)
  let h = 0x811c9dc5
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** 根 URI 语法规范化：scheme 小写、path 去重复尾斜杠（仅 "/" 保留）、
 *  丢弃 query/fragment（workspace folder URI 不携带）。仅做语法层归一，
 *  不做平台大小写折叠（Linux 区分大小写，盲目小写会令不同目录撞键）——
 *  语法异构但同指向的 URI（如 Windows 盘符大小写差异）由宿主装配层
 *  先按 vscode 语义去重，再求分区键（#197 接线职责）。 */
export function normalizeRootUri(uri: string): string {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):(\/\/[^/?#]*)?([^?#]*)(?:[?#].*)?$/.exec(uri)
  if (!m) return uri
  const [, scheme, authority = '', pathPart] = m
  const normPath = pathPart.length > 1 ? pathPart.replace(/\/+$/, '') : pathPart
  return `${scheme.toLowerCase()}:${authority}${normPath}`
}

/** 根分区键：`<scheme>-<12 hex>`，文件系统安全（无 : / ? 空格等字符）。
 *  同一（语法等价）根稳定同键；48 位 hash 的生日碰撞界在千万根级，
 *  远超单工作区根数。baseDir 布局：
 *  `<context.storageUri>/vsidian-index/<rootKeyOf(root.uri)>/`。 */
export function rootKeyOf(rootUri: string): string {
  const norm = normalizeRootUri(rootUri)
  const scheme = norm.slice(0, norm.indexOf(':')) || 'root'
  return `${scheme}-${stableHash(norm).slice(0, 12)}`
}

/** 一次提交中要写的单个文件；atomic=true 表示端口必须以临时文件 + rename 落盘。 */
export interface SnapshotWrite {
  path: string
  content: string
  atomic: boolean
}

/** 提交计划：writes 的数组顺序即写入顺序（片 → manifest → CURRENT）。 */
export interface SnapshotCommitPlan {
  formatVersion: number
  generation: number
  /** 本次新代目录名（写入完成前不对外可见）。 */
  dirName: string
  writes: SnapshotWrite[]
  /** 提交成功（CURRENT 已替换）后可回收的目录名；含旧代、孤儿代与 tmp- 残留。 */
  obsoleteDirs: string[]
  stats: { fileCount: number; edgeCount: number; shardCount: number; writtenShards: number }
}

/** 上一代快照信息（增量提交时传入，未变的片继承、不重写）。
 *  只需上一代 manifest 中的片校验和表——判定「片未变」靠重新序列化后
 *  hash 比对，无需把上一代片内容读进内存（大库增量的内存关键）。 */
export interface PrevSnapshot {
  generation: number
  dirName: string
  /** 上一代各片号 → 片内容校验和（读 manifest.json 即得）。 */
  shardChecksums: Map<number, string>
}

export interface PlanSnapshotOptions {
  baseDir: string
  /** 默认 16；越大单片越小、增量命中越准，但文件数越多。 */
  shardCount?: number
  prev?: PrevSnapshot
  /** 写前调用方列出的 baseDir 现存子目录名（决定回收清单）；缺省不产出回收项。 */
  existingDirs?: string[]
  /** 写者随机段（多窗口并发时代目录防撞）；缺省 w000。 */
  writerTag?: string
}

/** 片的列式紧凑 JSON 形态（names 字符串表 + 数字数组，路径与锚点都走索引）。 */
interface ShardFile {
  v: 2
  names: string[]
  /** [nameIdx, mtimeMs, size, contentVersion, kindCode] */
  files: number[][]
  /** [srcIdx, tgtIdx, kindCode, anchorIdx(-1 无), start, end, resolvedIdx(-1 断链/未解析)] */
  edges: number[][]
}

function serializeShard(files: VaultFileEntry[], edges: VaultEdge[]): string {
  const names: string[] = []
  const nameIdx = new Map<string, number>()
  const intern = (s: string): number => {
    let i = nameIdx.get(s)
    if (i === undefined) {
      i = names.length
      names.push(s)
      nameIdx.set(s, i)
    }
    return i
  }
  const fileRows = files
    .slice()
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((f) => [intern(f.path), f.mtimeMs, f.size, f.contentVersion, FILE_KIND_CODE.indexOf(f.kind)])
  const edgeRows = sortEdges(edges).map((e) => [
    intern(e.source),
    intern(e.target),
    EDGE_KIND_CODE.indexOf(e.kind),
    e.anchor ? intern(e.anchor) : -1,
    e.start,
    e.end,
    e.resolvedTarget ? intern(e.resolvedTarget) : -1,
  ])
  const shard: ShardFile = { v: 2, names, files: fileRows, edges: edgeRows }
  return JSON.stringify(shard)
}

function parseShard(content: string, dirLabel: string): { files: VaultFileEntry[]; edges: VaultEdge[] } {
  let raw: ShardFile
  try {
    raw = JSON.parse(content) as ShardFile
  } catch {
    throw new Error(`快照片 JSON 损坏（${dirLabel}）`)
  }
  if (raw === null || typeof raw !== 'object' || raw.v !== 2 || !Array.isArray(raw.names) || !Array.isArray(raw.files) || !Array.isArray(raw.edges)) {
    throw new Error(`快照片结构不符（${dirLabel}）`)
  }
  const files = raw.files.map((row) => {
    const [ni, mtimeMs, size, contentVersion, kindCode] = row
    const kind = FILE_KIND_BY_CODE.get(kindCode)
    if (kind === undefined) throw new Error(`快照片文件类型未知（${dirLabel}）`)
    return { path: raw.names[ni], kind, mtimeMs, size, contentVersion }
  })
  const edges = raw.edges.map((row) => {
    const [si, ti, kindCode, ai, start, end, ri] = row
    const kind = KIND_BY_CODE.get(kindCode)
    if (kind === undefined) throw new Error(`快照片边类型未知（${dirLabel}）`)
    return { source: raw.names[si], target: raw.names[ti], resolvedTarget: ri >= 0 ? raw.names[ri] : null, kind, anchor: ai >= 0 ? raw.names[ai] : '', start, end } satisfies VaultEdge
  })
  return { files, edges }
}

interface ManifestShardEntry {
  i: number
  /** 本代自带的片字节数（继承片为 null）。 */
  bytes: number | null
  /** 本代自带片的校验和；继承片为「继承源的校验和」。 */
  checksum: string
  /** 继承来源目录名；本代自带为 null。 */
  inheritedFrom: string | null
}

interface Manifest {
  formatVersion: number
  generation: number
  shardCount: number
  shards: ManifestShardEntry[]
  stats: { fileCount: number; edgeCount: number }
}

/** 单片的序列化产物（分批提交规划的中间件；同步版与 chunked 版共用） */
interface PlannedShard {
  index: number
  path: string
  content: string
  checksum: string
}

/** 分组并按片号升序逐片序列化（生成器：同步版一次跑完，chunked 版逐片
 *  消费后在片间让出事件循环——大库单次同步序列化的 3.72s 饿死由此切片，
 *  ADR-0008「接线约束（事件循环）」的实现载体）。 */
function* planShards(
  model: VaultIndexModel,
  shardCount: number,
  baseDir: string,
  dirName: string,
): Generator<PlannedShard> {
  // 分片：文件条目与其出链同片（都以 source 文件路径为键）
  const filesByShard = new Map<number, VaultFileEntry[]>()
  const edgesByShard = new Map<number, VaultEdge[]>()
  for (const f of model.files.values()) {
    const s = shardIdForPath(f.path, shardCount)
    let list = filesByShard.get(s)
    if (!list) filesByShard.set(s, (list = []))
    list.push(f)
  }
  for (const e of model.edges) {
    const s = shardIdForPath(e.source, shardCount)
    let list = edgesByShard.get(s)
    if (!list) edgesByShard.set(s, (list = []))
    list.push(e)
  }
  for (let i = 0; i < shardCount; i++) {
    const content = serializeShard(filesByShard.get(i) ?? [], edgesByShard.get(i) ?? [])
    yield {
      index: i,
      path: `${optsShardPath(baseDir, dirName, i)}`,
      content,
      checksum: stableHash(content),
    }
  }
}

function optsShardPath(baseDir: string, dirName: string, index: number): string {
  return `${baseDir}/${dirName}/shard-${String(index).padStart(3, '0')}.json`
}

/** 消费片序列化结果，产出提交计划的公共部分（片写入 + manifest + CURRENT
 *  + 回收清单）。chunked 与同步两入口唯一差异是片间是否让出。 */
function finishCommitPlan(
  model: VaultIndexModel,
  opts: PlanSnapshotOptions,
  shardCount: number,
  dirName: string,
  planned: readonly PlannedShard[],
): SnapshotCommitPlan {
  const generation = (opts.prev?.generation ?? 0) + 1
  const writes: SnapshotWrite[] = []
  const shards: ManifestShardEntry[] = []
  let writtenShards = 0
  for (const shard of planned) {
    const prevChecksum = opts.prev?.shardChecksums.get(shard.index)
    if (prevChecksum !== undefined && prevChecksum === shard.checksum) {
      shards.push({ i: shard.index, bytes: null, checksum: shard.checksum, inheritedFrom: opts.prev!.dirName })
      continue
    }
    writes.push({ path: shard.path, content: shard.content, atomic: true })
    shards.push({ i: shard.index, bytes: shard.content.length, checksum: shard.checksum, inheritedFrom: null })
    writtenShards++
  }

  const manifest: Manifest = {
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    generation,
    shardCount,
    shards,
    stats: { fileCount: model.files.size, edgeCount: model.edges.length },
  }
  writes.push({ path: `${opts.baseDir}/${dirName}/manifest.json`, content: JSON.stringify(manifest), atomic: true })
  // CURRENT 最后写：此刻新代目录已完整，读者要么看到旧代、要么看到完整新代
  writes.push({ path: `${opts.baseDir}/CURRENT`, content: dirName, atomic: true })

  const obsoleteDirs = planObsoleteDirs({
    baseDir: opts.baseDir,
    newDirName: dirName,
    inheritSource: opts.prev?.dirName ?? null,
    existingDirs: opts.existingDirs ?? [],
  })

  return {
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    generation,
    dirName,
    writes,
    obsoleteDirs,
    stats: { fileCount: model.files.size, edgeCount: model.edges.length, shardCount, writtenShards },
  }
}

/** 规划一次快照提交：产出待写文件（含顺序）与回收清单，不触碰 fs。 */
export function planSnapshotCommit(model: VaultIndexModel, opts: PlanSnapshotOptions): SnapshotCommitPlan {
  const shardCount = Math.max(1, Math.min(MAX_SHARD_COUNT, opts.shardCount ?? 16))
  const writerTag = sanitizeTag(opts.writerTag ?? 'w000')
  const generation = (opts.prev?.generation ?? 0) + 1
  const dirName = `gen-${String(generation).padStart(6, '0')}-${writerTag}`
  return finishCommitPlan(model, opts, shardCount, dirName, [...planShards(model, shardCount, opts.baseDir, dirName)])
}

/** 分批版提交规划（#197 接线入口，ADR-0008 片间让出硬约束）：每序列化
 *  一片后 await yieldToEventLoop()（宿主传 setImmediate 适配），把单次
 *  同步序列化的饿死切成百毫秒级切片。产物与 planSnapshotCommit 逐字段
 *  一致（同一实现路径，一致性由单测钉住）；继承判定发生在全部片产出后
 *  （继承片未重写即未消耗序列化成本，让出计数对应实写片数）。 */
export async function planSnapshotCommitChunked(
  model: VaultIndexModel,
  opts: PlanSnapshotOptions,
  yieldToEventLoop: () => Promise<void>,
): Promise<SnapshotCommitPlan> {
  const shardCount = Math.max(1, Math.min(MAX_SHARD_COUNT, opts.shardCount ?? 16))
  const writerTag = sanitizeTag(opts.writerTag ?? 'w000')
  const generation = (opts.prev?.generation ?? 0) + 1
  const dirName = `gen-${String(generation).padStart(6, '0')}-${writerTag}`
  const planned: PlannedShard[] = []
  for (const shard of planShards(model, shardCount, opts.baseDir, dirName)) {
    planned.push(shard)
    await yieldToEventLoop()
  }
  return finishCommitPlan(model, opts, shardCount, dirName, planned)
}

/** 回收计划：旧代（代号 ≤ 新代且非继承源）、同代号孤儿、tmp- 残留。 */
export function planObsoleteDirs(input: { baseDir: string; newDirName: string; inheritSource: string | null; existingDirs: string[] }): string[] {
  const newGen = genNumOf(input.newDirName)
  const result: string[] = []
  for (const dir of input.existingDirs) {
    if (dir === input.newDirName || dir === input.inheritSource || dir === 'CURRENT') continue
    if (dir.startsWith('tmp-')) {
      result.push(dir)
      continue
    }
    const g = genNumOf(dir)
    if (newGen !== null && g !== null && g <= newGen) result.push(dir)
  }
  return result
}

function genNumOf(dirName: string): number | null {
  const m = /^gen-(\d+)/.exec(dirName)
  return m ? Number(m[1]) : null
}

function sanitizeTag(tag: string): string {
  const safe = tag.replace(/[^0-9a-zA-Z]/g, '').slice(0, 6)
  return safe || 'w000'
}

/** 恢复用的最小 fs 端口：宿主壳以 node:fs / vscode.workspace.fs 实现。 */
export interface VaultIndexFsPort {
  /** 列出 baseDir 下的直接子目录名（不存在时返回空数组）。 */
  listDirs(baseDir: string): Promise<string[]>
  readFile(path: string): Promise<string>
}

export interface SnapshotMeta {
  formatVersion: number
  generation: number
  dirName: string
  shardCount: number
  stats: { fileCount: number; edgeCount: number }
}

export interface SnapshotLoadResult {
  model: VaultIndexModel
  meta: SnapshotMeta
  /** 实际加载的代不是 CURRENT 指向的代（CURRENT 代损坏或不存在的回退）。 */
  usedFallback: boolean
}

/**
 * 从 baseDir 恢复快照：优先 CURRENT 指向的代；损坏或不存时按代际号降序
 * 回退扫描；全部不可用返回 null（调用方走全量重建）。继承片沿 manifest
 * 记录的来源目录读取，继承源缺失/校验不符同样判损坏。
 */
export async function loadSnapshot(port: VaultIndexFsPort, baseDir: string): Promise<SnapshotLoadResult | null> {
  let currentDir: string | null = null
  try {
    currentDir = (await port.readFile(`${baseDir}/CURRENT`)).trim() || null
  } catch {
    currentDir = null
  }
  const dirs = (await port.listDirs(baseDir)).filter((d) => /^gen-\d+/.test(d))
  const candidates: string[] = []
  if (currentDir && !candidates.includes(currentDir)) candidates.push(currentDir)
  const sorted = dirs
    .filter((d) => d !== currentDir)
    .sort((a, b) => (genNumOf(b) ?? -1) - (genNumOf(a) ?? -1))
  candidates.push(...sorted)

  for (const dir of candidates) {
    const loaded = await tryLoadGeneration(port, baseDir, dir)
    if (loaded) {
      return { model: loaded.model, meta: loaded.meta, usedFallback: dir !== currentDir }
    }
  }
  return null
}

async function tryLoadGeneration(port: VaultIndexFsPort, baseDir: string, dirName: string): Promise<{ model: VaultIndexModel; meta: SnapshotMeta } | null> {
  let manifest: Manifest
  try {
    const raw = JSON.parse(await port.readFile(`${baseDir}/${dirName}/manifest.json`))
    manifest = raw as Manifest
  } catch {
    return null
  }
  if (
    manifest === null || typeof manifest !== 'object'
    || manifest.formatVersion !== SNAPSHOT_FORMAT_VERSION
    || !Array.isArray(manifest.shards)
    || typeof manifest.generation !== 'number'
  ) {
    return null
  }
  const files = new Map<string, VaultFileEntry>()
  const edges: VaultEdge[] = []
  for (const shard of manifest.shards) {
    const shardDir = shard.inheritedFrom ?? dirName
    const shardPath = `${baseDir}/${shardDir}/shard-${String(shard.i).padStart(3, '0')}.json`
    let content: string
    try {
      content = await port.readFile(shardPath)
    } catch {
      return null
    }
    if (stableHash(content) !== shard.checksum) return null
    let parsed: ReturnType<typeof parseShard>
    try {
      parsed = parseShard(content, shardPath)
    } catch {
      return null
    }
    for (const f of parsed.files) files.set(f.path, f)
    edges.push(...parsed.edges)
  }
  return {
    model: { files, edges: sortEdges(edges) },
    meta: {
      formatVersion: manifest.formatVersion,
      generation: manifest.generation,
      dirName,
      shardCount: manifest.shardCount,
      stats: manifest.stats,
    },
  }
}
