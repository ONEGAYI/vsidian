// 引用索引存储选型三档容量基准（工单 #195）。
//
// 在同一份确定性语料（vaultIndexGen.mjs 生成，1千/1万/10万篇三档）上
// 对两个候选存储引擎做同操作集测量：
//   A. 紧凑分片快照 + 内存关系表（src/shared/vaultIndexSnapshot.ts，生产候选基线）
//   B. SQLite（sql.js WASM 对照引擎，test/perf/vaultIndexSqliteEngine.mjs）
//
// 测量项（每项多轮取中位数，轮数随数据写入报告）：首次构建、冷启动恢复、
// 单文件更新、批量变更（500 文件）、反链查询、峰值内存、磁盘占用、写入量、
// 事件循环响应（perf_hooks.monitorEventLoopDelay）。
//
// 诚实边界（同步写入报告 meta.methods，解读文档展开）：
// - 纯 Node 直跑（本机 Node 版本见 meta），非 VSCode 1.86 扩展宿主进程内；
//   宿主内数字归 #202 集成/远程票验证。
// - 冷启动恢复 = 新起子进程加载（JS 堆/编译缓存冷）；OS 文件缓存无法在
//   用户态清空，为热缓存近似，不冒充 OS 级冷启动。
// - SQLite 引擎为 sql.js（WASM，无 native 绑定）——这正是它作为「可兼容
//   旧宿主接入形态」的测量对象；写入量以 export() 字节近似（内存库无 WAL）。
//
// 用法：
//   node test/perf/vaultIndexBench.mjs [--corpus <dir>] [--tiers 1k,10k,100k]
//                                     [--report <json>] [--keep-corpus]
// 语料默认生成到 D:/CODE/Project/_ForExplore/vsidian-194-bench（工单指定，
// 不提交仓库）；报告默认写 docs/perf/data/vault-index-storage-bench.json。
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { readdir, readFile, rename, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import { cpus } from 'node:os'
import fsSync from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { generateTier } from './vaultIndexGen.mjs'
import { loadSqlJs, createSqliteIndex, openSqliteIndex } from './vaultIndexSqliteEngine.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const buildDir = path.join(repoRoot, 'out', 'test', 'perf-vault-index')

// ---------- CLI ----------
const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : fallback
}
const DEFAULT_CORPUS_ROOT = 'D:/CODE/Project/_ForExplore/vsidian-194-bench'
const corpusRoot = argOf('--corpus', DEFAULT_CORPUS_ROOT)
const tiersArg = argOf('--tiers', '1k,10k,100k').split(',')
const reportPath = argOf('--report', path.join(repoRoot, 'docs', 'perf', 'data', 'vault-index-storage-bench.json'))

// ---------- 分片快照模块：esbuild 即时编译（单一事实源，不复制逻辑） ----------
async function buildSnapshotModule() {
  fsSync.mkdirSync(buildDir, { recursive: true })
  const outfile = path.join(buildDir, 'snapshot.mjs')
  await build({
    entryPoints: [path.join(repoRoot, 'src', 'shared', 'vaultIndexSnapshot.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    logLevel: 'silent',
  })
  return import(pathToFileURL(outfile).href)
}

// ---------- 基准专用简化抽取器 ----------
// 覆盖语料生成器的链接形态（[[t]]、[[t#a]]、[x](t)、![x](t)、[r]: t）。
// 解析规则按 #194 规格：按来源目录解析根内相对路径、双链省略扩展名默认
// .md、越出根与 https 为不可解析（resolvedTarget=null）。目标不存在仍给出
// 解析路径（断链=路径不在文件表）。生产级抽取（代码字面量排除、别名、
// URL 编码等）归 #196，本抽取器只服务基准数据形态。
const RE_WIKILINK = /\[\[([^\[\]|#]+)(?:#([^\[\]|]+))?\]\]/g
const RE_INLINE = /(!?)\[([^\]\[]*)\]\(([^)\s]+)\)/g
const RE_REFDEF = /^[ \t]{0,3}\[([^\]\[]+)\]:[ \t]+(\S+)$/gm

function posixDirname(p) {
  const i = p.lastIndexOf('/')
  return i < 0 ? '' : p.slice(0, i)
}

/** 根内相对解析：越出根（归一化后以 ../ 开头）返回 null。 */
function resolveWithinRoot(sourceRel, target, { defaultMdExt }) {
  if (/^https?:\/\//i.test(target)) return null
  const joined = path.posix.join(posixDirname(sourceRel), target)
  const norm = path.posix.normalize(joined)
  if (norm === '' || norm.startsWith('../') || norm === '..') return null
  if (defaultMdExt && !path.posix.extname(norm)) return `${norm}.md`
  return norm
}

function extractEdges(relPath, text) {
  const edges = []
  const push = (target, resolvedTarget, kind, anchor, start, end) => {
    if (!target) return
    edges.push({ source: relPath, target, resolvedTarget, kind, anchor, start, end })
  }
  for (const m of text.matchAll(RE_WIKILINK)) {
    const anchor = m[2] ?? ''
    const raw = m[1]
    push(raw, resolveWithinRoot(relPath, raw, { defaultMdExt: true }), 'wikilink', anchor, m.index, m.index + m[0].length)
  }
  for (const m of text.matchAll(RE_INLINE)) {
    const isImage = m[1] === '!'
    const target = m[3]
    const external = /^https?:\/\//i.test(target)
    push(target, external ? null : resolveWithinRoot(relPath, target, { defaultMdExt: false }), isImage ? 'image' : 'mdlink', '', m.index, m.index + m[0].length)
  }
  for (const m of text.matchAll(RE_REFDEF)) {
    const target = m[2]
    const external = /^https?:\/\//i.test(target)
    push(target, external ? null : resolveWithinRoot(relPath, target, { defaultMdExt: false }), 'refdef', '', m.index, m.index + m[0].length)
  }
  return edges
}

// ---------- 语料扫描（首次构建的输入侧，两引擎共用） ----------
const EXCLUDE_DIRS = new Set(['.git', 'node_modules'])
const READ_CONCURRENCY = 64

async function listCorpusFiles(corpusDir) {
  const out = []
  const walk = async (relPrefix) => {
    const entries = await readdir(path.join(corpusDir, relPrefix), { withFileTypes: true })
    for (const e of entries) {
      const rel = relPrefix ? `${relPrefix}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (!EXCLUDE_DIRS.has(e.name)) await walk(rel)
      } else if (e.isFile()) {
        out.push(rel)
      }
    }
  }
  await walk('')
  out.sort()
  return out
}

/** 扫描 + 读取 + 抽取 → VaultIndexModel；分计时。 */
async function scanCorpus(corpusDir) {
  const t0 = performance.now()
  const relFiles = await listCorpusFiles(corpusDir)
  const t1 = performance.now()
  const files = new Map()
  const edges = []
  let contentBytes = 0
  const queue = [...relFiles]
  const workers = Array.from({ length: READ_CONCURRENCY }, async () => {
    while (queue.length) {
      const rel = queue.shift()
      const abs = path.join(corpusDir, rel)
      const st = await stat(abs)
      if (rel.endsWith('.md')) {
        const text = await readFile(abs, 'utf8')
        contentBytes += Buffer.byteLength(text, 'utf8')
        files.set(rel, { path: rel, kind: 'markdown', mtimeMs: st.mtimeMs, size: st.size, contentVersion: 1 })
        edges.push(...extractEdges(rel, text))
      } else {
        files.set(rel, { path: rel, kind: 'asset', mtimeMs: st.mtimeMs, size: st.size, contentVersion: 1 })
      }
    }
  })
  await Promise.all(workers)
  const t2 = performance.now()
  return { model: { files, edges }, ms: { listDir: t1 - t0, readExtract: t2 - t1, total: t2 - t0 }, contentBytes, fileCount: relFiles.length }
}

// ---------- 快照引擎磁盘端口 ----------
function snapshotFsPort() {
  return {
    async listDirs(baseDir) {
      try {
        const entries = await readdir(baseDir, { withFileTypes: true })
        return entries.filter((e) => e.isDirectory()).map((e) => e.name)
      } catch {
        return []
      }
    },
    async readFile(p) {
      return readFile(p, 'utf8')
    },
  }
}

async function applyPlanWrites(plan) {
  let writtenBytes = 0
  for (const w of plan.writes) {
    writtenBytes += Buffer.byteLength(w.content, 'utf8')
    const abs = w.path
    await mkdir(path.dirname(abs), { recursive: true })
    if (w.atomic) {
      const tmp = `${abs}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`
      await writeFile(tmp, w.content, 'utf8')
      await rename(tmp, abs)
    } else {
      await writeFile(abs, w.content, 'utf8')
    }
  }
  return writtenBytes
}

async function recycleObsolete(baseDir, names) {
  for (const n of names) await rm(path.join(baseDir, n), { recursive: true, force: true })
}

async function readPrevSnapshot(baseDir) {
  try {
    const current = (await readFile(path.join(baseDir, 'CURRENT'), 'utf8')).trim()
    const manifest = JSON.parse(await readFile(path.join(baseDir, current, 'manifest.json'), 'utf8'))
    return {
      generation: manifest.generation,
      dirName: current,
      shardChecksums: new Map(manifest.shards.map((s) => [s.i, s.checksum])),
    }
  } catch {
    return undefined
  }
}

async function dirSize(dir) {
  let total = 0
  let count = 0
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        const sub = await dirSize(p)
        total += sub.total
        count += sub.count
      } else {
        total += (await stat(p)).size
        count++
      }
    }
  } catch { /* 不存在按 0 */ }
  return { total, count }
}

// ---------- 测量工具 ----------
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 监视包装：fn 执行期间采样事件循环延迟与 rss/heapUsed 峰值。
 *  两路事件循环证据：
 *  - monitorEventLoopDelay 直方图（检查点模式，纯长同步阻塞下样本缺失，
 *    实证见 100k 档 SQLite：3.96s 同步 commit 仅记到 ~23ms）；
 *  - 饿死探针（20ms setInterval 补跑时差）：同步阻塞解除后首轮回调
 *    必然迟到，可直接量化「最长多久不让出事件循环」。
 *  fn 结束后额外等 80ms 收尾，捕获阻塞解除后的 spike。 */
async function monitored(fn) {
  const h = monitorEventLoopDelay()
  h.enable()
  let peakRss = 0
  let peakHeap = 0
  let maxStarveMs = 0
  let lastTick = performance.now()
  const PROBE_MS = 20
  const before = process.memoryUsage()
  const timer = setInterval(() => {
    const m = process.memoryUsage()
    if (m.rss > peakRss) peakRss = m.rss
    if (m.heapUsed > peakHeap) peakHeap = m.heapUsed
  }, 25)
  const probe = setInterval(() => {
    const now = performance.now()
    const starve = now - lastTick - PROBE_MS
    if (starve > maxStarveMs) maxStarveMs = starve
    lastTick = now
  }, PROBE_MS)
  try {
    const value = await fn()
    await new Promise((resolve) => setTimeout(resolve, 80))
    return {
      value,
      loopDelay: {
        meanMs: h.mean / 1e6,
        p99Ms: h.percentile(99) / 1e6,
        maxMs: h.max / 1e6,
        maxStarveMs,
      },
      memory: {
        rssBefore: before.rss,
        rssPeak: Math.max(peakRss, before.rss),
        heapUsedPeak: Math.max(peakHeap, before.heapUsed),
      },
    }
  } finally {
    clearInterval(timer)
    clearInterval(probe)
    h.disable()
  }
}

// ---------- 冷启动恢复子进程 ----------
// 每轮 spawn 新 node 进程：JS 堆/编译缓存冷；OS 文件缓存热（无法用户态清空，
// 报告如实标注）。子进程内部计时并输出 JSON。
function coldRestoreChild(engine, storageDir, extra) {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--cold-restore-child', engine, storageDir, extra ?? ''], {
    encoding: 'utf8',
    timeout: 10 * 60_000,
  })
  if (r.status !== 0) throw new Error(`冷恢复子进程失败（${engine}）：${r.stderr}`)
  return JSON.parse(r.stdout.trim().split('\n').pop())
}

// ---------- 单文件/批量变更负载 ----------
/** 在文件末尾追加一段含 2 条新链接的文字（1 条指向既有文件、1 条断链）。 */
function appendedVariant(origText, targetRel) {
  const stamp = Math.random().toString(36).slice(2, 8)
  return `${origText}\n\n基准变更段 ${stamp}：引用 [[${targetRel.replace(/\.md$/, '')}]] 与 [[不存在的页面 ${stamp}]]。\n`
}

// ---------- 主流程 ----------
async function main() {
  const snapshot = await buildSnapshotModule()
  const { planSnapshotCommit, loadSnapshot, buildBacklinkIndex } = snapshot
  const SQL = await loadSqlJs()

  const report = {
    meta: {
      date: new Date().toISOString(),
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      cpuModel: cpus()[0].model,
      corpusRoot,
      methods: {
        runner: '纯 Node 直跑（非 VSCode 扩展宿主进程）',
        coldRestore: '新子进程加载；OS 文件缓存热（用户态不可清空），为热缓存近似',
        sqlite: 'sql.js WASM（无 native 绑定），写入量以 export() 字节近似',
        extractor: '基准专用正则抽取器（覆盖语料形态），生产抽取归 #196',
        rounds: '各测量项轮数见各条目 rounds 字段，中位数为 median(...)',
      },
    },
    tiers: {},
  }

  for (const tier of tiersArg) {
    console.log(`\n===== 档位 ${tier} =====`)
    const { corpusDir, stats: genStats } = generateTier(tier, corpusRoot)
    const corpusStats = {
      files: genStats.files,
      markdownFiles: genStats.files,
      attachmentFiles: genStats.attachmentFiles,
      corpusBytes: genStats.bytes,
      genLinks: genStats.links,
    }

    const storageA = path.join(corpusRoot, `storage-${tier}-snapshot`)
    const storageB = path.join(corpusRoot, `storage-${tier}-sqlite`)
    await rm(storageA, { recursive: true, force: true })
    await rm(storageB, { recursive: true, force: true })
    await mkdir(storageA, { recursive: true })
    await mkdir(storageB, { recursive: true })
    const sqliteFile = path.join(storageB, 'index.sqlite')

    // ---- 首次构建（两引擎各 3 轮，每轮从空存储开始；同轮共用一次扫描） ----
    const FIRST_ROUNDS = 3
    const firstBuild = { snapshot: [], sqlite: [] }
    let scanPhase = null
    for (let round = 0; round < FIRST_ROUNDS; round++) {
      const scan = await scanCorpus(corpusDir)
      scanPhase = { ms: scan.ms, contentBytes: scan.contentBytes }

      // 快照引擎
      await rm(storageA, { recursive: true, force: true }); await mkdir(storageA, { recursive: true })
      const runA = await monitored(async () => {
        const t0 = performance.now()
        const existingDirs = await snapshotFsPort().listDirs(storageA)
        const plan = planSnapshotCommit(scan.model, { baseDir: storageA, shardCount: 16, existingDirs })
        const writtenBytes = await applyPlanWrites(plan)
        await recycleObsolete(storageA, plan.obsoleteDirs)
        return { commitMs: performance.now() - t0, writtenBytes, planStats: plan.stats }
      })
      firstBuild.snapshot.push({
        totalMs: scan.ms.total + runA.value.commitMs,
        scanMs: scan.ms.total,
        commitMs: runA.value.commitMs,
        writeBytes: runA.value.writtenBytes,
        loopDelay: runA.loopDelay,
        memory: runA.memory,
      })

      // SQLite 引擎
      await rm(storageB, { recursive: true, force: true }); await mkdir(storageB, { recursive: true })
      const runB = await monitored(async () => {
        const t0 = performance.now()
        const handle = createSqliteIndex(SQL)
        handle.bulkBuild(scan.model)
        const bytes = handle.export()
        await writeFile(sqliteFile, bytes)
        return { commitMs: performance.now() - t0, writeBytes: bytes.length }
      })
      firstBuild.sqlite.push({
        totalMs: scan.ms.total + runB.value.commitMs,
        scanMs: scan.ms.total,
        commitMs: runB.value.commitMs,
        writeBytes: runB.value.writeBytes,
        loopDelay: runB.loopDelay,
        memory: runB.memory,
      })
      console.log(`[firstBuild ${tier} #${round}] snapshot total=${(firstBuild.snapshot[round].totalMs / 1000).toFixed(2)}s commit=${(firstBuild.snapshot[round].commitMs / 1000).toFixed(2)}s | sqlite commit=${(runB.value.commitMs / 1000).toFixed(2)}s`)
    }

    // 磁盘占用（首建后、回收后）
    const diskA = await dirSize(storageA)
    const diskB = await dirSize(storageB)

    // ---- 冷启动恢复（子进程，各 3 轮） ----
    const COLD_ROUNDS = 3
    const cold = { snapshot: [], sqlite: [] }
    for (let i = 0; i < COLD_ROUNDS; i++) {
      const a = coldRestoreChild('snapshot', storageA, '', '')
      cold.snapshot.push({ loadMs: a.loadMs, files: a.files, edges: a.edges, buildBacklinkMs: a.buildBacklinkMs, rss: a.rss })
      const b = coldRestoreChild('sqlite', storageB, sqliteFile, '')
      cold.sqlite.push({ loadMs: b.loadMs, files: b.files, edges: b.edges, rss: b.rss })
    }
    console.log(`[cold ${tier}] snapshot median=${(median(cold.snapshot.map((c) => c.loadMs)) / 1000).toFixed(2)}s | sqlite median=${(median(cold.sqlite.map((c) => c.loadMs)) / 1000).toFixed(2)}s`)

    // ---- 建立两引擎的常驻索引（后续更新/查询操作的载体） ----
    const scanFinal = await scanCorpus(corpusDir)
    const model = scanFinal.model
    corpusStats.markdownFiles = [...model.files.values()].filter((f) => f.kind === 'markdown').length
    corpusStats.assetFiles = [...model.files.values()].filter((f) => f.kind === 'asset').length
    corpusStats.contentBytes = scanFinal.contentBytes
    corpusStats.edgeCount = model.edges.length
    corpusStats.edgeKinds = model.edges.reduce((acc, e) => { acc[e.kind] = (acc[e.kind] ?? 0) + 1; return acc }, {})
    corpusStats.nonMarkdownTargets = new Set(model.edges.filter((e) => e.resolvedTarget && !e.resolvedTarget.endsWith('.md')).map((e) => e.resolvedTarget)).size
    corpusStats.brokenTargets = new Set(model.edges.filter((e) => e.resolvedTarget && !model.files.has(e.resolvedTarget)).map((e) => e.resolvedTarget)).size
    corpusStats.unresolvable = model.edges.filter((e) => e.resolvedTarget === null).length
    // 与生成器统计交叉验证（宽松对账：生成器按链接标记计、抽取器按抽取计，
    // 形态覆盖一致时总量应相等）
    corpusStats.genCrossCheck = {
      genTotal: genStats.links.wikilink + genStats.links.mdlink + genStats.links.image + genStats.links.refdef,
      extractedTotal: model.edges.length,
    }

    // 快照常驻：做一次全新提交作为工作基线
    await rm(storageA, { recursive: true, force: true }); await mkdir(storageA, { recursive: true })
    const basePlan = planSnapshotCommit(model, { baseDir: storageA, shardCount: 16 })
    await applyPlanWrites(basePlan)
    await recycleObsolete(storageA, basePlan.obsoleteDirs)
    // SQLite 常驻
    const liveHandle = createSqliteIndex(SQL)
    liveHandle.bulkBuild(model)
    await writeFile(sqliteFile, liveHandle.export())

    // ---- 单文件更新（各 10 轮，PRNG 固定选样） ----
    const POINT_ROUNDS = 10
    const rnd = mulberry32(20261001)
    const mdPaths = [...model.files.values()].filter((f) => f.kind === 'markdown').map((f) => f.path)
    const point = { snapshot: [], sqlite: [] }
    const pointPicks = [...new Set(Array.from({ length: POINT_ROUNDS }, () => mdPaths[Math.floor(rnd() * mdPaths.length)]))]
    for (const rel of pointPicks) {
      const abs = path.join(corpusDir, rel)
      const orig = await readFile(abs, 'utf8')
      const mutated = appendedVariant(orig, mdPaths[Math.floor(rnd() * mdPaths.length)])
      await writeFile(abs, mutated, 'utf8')
      const st = await stat(abs)
      // 快照增量提交
      const prev = await readPrevSnapshot(storageA)
      const tA = performance.now()
      {
        const entry = { path: rel, kind: 'markdown', mtimeMs: st.mtimeMs, size: st.size, contentVersion: (model.files.get(rel).contentVersion ?? 1) + 1 }
        model.files.set(rel, entry)
        const kept = model.edges.filter((e) => e.source !== rel)
        model.edges = [...kept, ...extractEdges(rel, mutated)]
        const existingDirs = await snapshotFsPort().listDirs(storageA)
        const plan = planSnapshotCommit(model, { baseDir: storageA, shardCount: 16, prev, existingDirs })
        const written = await applyPlanWrites(plan)
        await recycleObsolete(storageA, plan.obsoleteDirs)
        point.snapshot.push({ ms: performance.now() - tA, writeBytes: written, rewrittenShards: plan.stats.writtenShards })
      }
      // SQLite 单事务更新
      const tB = performance.now()
      {
        const entry = { path: rel, kind: 'markdown', mtimeMs: st.mtimeMs, size: st.size, contentVersion: 2 }
        liveHandle.pointUpdate(entry, extractEdges(rel, mutated))
        const bytes = liveHandle.export()
        await writeFile(sqliteFile, bytes)
        point.sqlite.push({ ms: performance.now() - tB, writeBytes: bytes.length })
      }
      await writeFile(abs, orig, 'utf8') // 还原语料（索引保留本轮变更，两引擎同等）
    }
    console.log(`[pointUpdate ${tier}] snapshot median=${median(point.snapshot.map((p) => p.ms)).toFixed(1)}ms | sqlite median=${median(point.sqlite.map((p) => p.ms)).toFixed(1)}ms`)

    // ---- 批量变更 500 文件（各 3 轮，每轮不同批） ----
    const BATCH_ROUNDS = 3
    const BATCH_SIZE = 500
    const batch = { snapshot: [], sqlite: [] }
    for (let round = 0; round < BATCH_ROUNDS; round++) {
      // 随机抽样后去重：同一文件重复进入同批会让快照路径重复 push 边
      // （SQLite 的 DELETE+INSERT 幂等），两引擎必须面对同一变更集
      const picks = [...new Set(Array.from({ length: Math.min(BATCH_SIZE, mdPaths.length) }, () => mdPaths[Math.floor(rnd() * mdPaths.length)]))]
      const originals = new Map()
      for (const rel of picks) {
        const abs = path.join(corpusDir, rel)
        const orig = await readFile(abs, 'utf8')
        originals.set(rel, orig)
        await writeFile(abs, appendedVariant(orig, mdPaths[Math.floor(rnd() * mdPaths.length)]), 'utf8')
      }
      // 快照批量增量
      const prev = await readPrevSnapshot(storageA)
      const tA = performance.now()
      {
        for (const rel of picks) {
          const abs = path.join(corpusDir, rel)
          const st = await stat(abs)
          const text = await readFile(abs, 'utf8')
          model.files.set(rel, { path: rel, kind: 'markdown', mtimeMs: st.mtimeMs, size: st.size, contentVersion: (model.files.get(rel)?.contentVersion ?? 1) + 1 })
        }
        const picked = new Set(picks)
        model.edges = [...model.edges.filter((e) => !picked.has(e.source))]
        for (const rel of picks) {
          model.edges.push(...extractEdges(rel, await readFile(path.join(corpusDir, rel), 'utf8')))
        }
        const existingDirs = await snapshotFsPort().listDirs(storageA)
        const plan = planSnapshotCommit(model, { baseDir: storageA, shardCount: 16, prev, existingDirs })
        const written = await applyPlanWrites(plan)
        await recycleObsolete(storageA, plan.obsoleteDirs)
        batch.snapshot.push({ ms: performance.now() - tA, writeBytes: written, rewrittenShards: plan.stats.writtenShards })
      }
      // SQLite 批量单事务
      const tB = performance.now()
      {
        const updates = []
        for (const rel of picks) {
          const st = await stat(path.join(corpusDir, rel))
          const text = await readFile(path.join(corpusDir, rel), 'utf8')
          updates.push({ entry: { path: rel, kind: 'markdown', mtimeMs: st.mtimeMs, size: st.size, contentVersion: 2 }, edges: extractEdges(rel, text) })
        }
        liveHandle.batchUpdate(updates)
        const bytes = liveHandle.export()
        await writeFile(sqliteFile, bytes)
        batch.sqlite.push({ ms: performance.now() - tB, writeBytes: bytes.length })
      }
      for (const [rel, orig] of originals) await writeFile(path.join(corpusDir, rel), orig, 'utf8')
      console.log(`[batch ${tier} #${round}] snapshot=${batch.snapshot[round].ms.toFixed(0)}ms (${batch.snapshot[round].rewrittenShards} 片) | sqlite=${batch.sqlite[round].ms.toFixed(0)}ms`)
    }

    // ---- 反链查询（20 个目标） ----
    const QUERY_N = 20
    const targetCounts = new Map()
    for (const e of model.edges) {
      if (!e.resolvedTarget) continue
      targetCounts.set(e.resolvedTarget, (targetCounts.get(e.resolvedTarget) ?? 0) + 1)
    }
    const hotTargets = [...targetCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, QUERY_N).map(([t]) => t)
    const tIdx0 = performance.now()
    const backlinkIndex = buildBacklinkIndex(model.edges)
    const backlinkBuildMs = performance.now() - tIdx0
    const query = { snapshot: [], sqlite: [] }
    for (const t of hotTargets) {
      const tA = performance.now()
      const rows = backlinkIndex.get(t) ?? []
      query.snapshot.push({ ms: performance.now() - tA, count: rows.length })
      const tB = performance.now()
      const rowsB = liveHandle.backlinks(t)
      query.sqlite.push({ ms: performance.now() - tB, count: rowsB.length })
      if (rows.length !== rowsB.length) throw new Error(`反链计数不一致（${t}）：快照 ${rows.length} vs SQLite ${rowsB.length}`)
    }
    console.log(`[backlink ${tier}] snapshot median=${(median(query.snapshot.map((q) => q.ms)) * 1000).toFixed(1)}µs | sqlite median=${(median(query.sqlite.map((q) => q.ms)) * 1000).toFixed(1)}µs | 索引构建 ${backlinkBuildMs.toFixed(0)}ms`)

    // ---- 分片数敏感性（快照引擎参数权衡，1k 档测 16/64/256） ----
    let shardSensitivity = null
    if (tier === '1k') {
      shardSensitivity = []
      const rndS = mulberry32(20261002)
      for (const shardCount of [16, 64, 256]) {
        const dir = path.join(corpusRoot, `storage-${tier}-snap-s${shardCount}`)
        await rm(dir, { recursive: true, force: true }); await mkdir(dir, { recursive: true })
        const base = planSnapshotCommit(model, { baseDir: dir, shardCount })
        await applyPlanWrites(base)
        await recycleObsolete(dir, base.obsoleteDirs)
        const rounds = []
        for (let r = 0; r < 5; r++) {
          const rel = mdPaths[Math.floor(rndS() * mdPaths.length)]
          const abs = path.join(corpusDir, rel)
          const orig = await readFile(abs, 'utf8')
          const mutated = appendedVariant(orig, mdPaths[Math.floor(rndS() * mdPaths.length)])
          await writeFile(abs, mutated, 'utf8')
          const st = await stat(abs)
          const prev = await readPrevSnapshot(dir)
          const t0 = performance.now()
          model.files.set(rel, { path: rel, kind: 'markdown', mtimeMs: st.mtimeMs, size: st.size, contentVersion: (model.files.get(rel)?.contentVersion ?? 1) + 1 })
          const picked = new Set([rel])
          model.edges = [...model.edges.filter((e) => !picked.has(e.source)), ...extractEdges(rel, mutated)]
          const plan = planSnapshotCommit(model, { baseDir: dir, shardCount, prev })
          await applyPlanWrites(plan)
          await recycleObsolete(dir, plan.obsoleteDirs)
          rounds.push({ ms: performance.now() - t0, writtenShards: plan.stats.writtenShards, shardBytes: plan.writes.filter((w) => /shard-\d+\.json$/.test(w.path)).reduce((a, w) => a + Buffer.byteLength(w.content, 'utf8'), 0) })
          await writeFile(abs, orig, 'utf8')
        }
        shardSensitivity.push({ shardCount, rounds: rounds.length, median_ms: median(rounds.map((x) => x.ms)), median_writtenShards: median(rounds.map((x) => x.writtenShards)), median_shardWriteBytes: median(rounds.map((x) => x.shardBytes)) })
        await rm(dir, { recursive: true, force: true })
      }
      console.log(`[shardSensitivity ${tier}]`, JSON.stringify(shardSensitivity))
    }

    // ---- 汇总本档 ----
    report.tiers[tier] = {
      corpus: corpusStats,
      firstBuild: {
        rounds: FIRST_ROUNDS,
        snapshot: summarize(firstBuild.snapshot),
        sqlite: summarize(firstBuild.sqlite),
        memoryPeakSnapshot: Math.max(...firstBuild.snapshot.map((r) => r.memory.heapUsedPeak)),
        memoryPeakSqlite: Math.max(...firstBuild.sqlite.map((r) => r.memory.heapUsedPeak)),
        loopDelaySnapshot: worstLoop(firstBuild.snapshot),
        loopDelaySqlite: worstLoop(firstBuild.sqlite),
        scanPhase,
      },
      diskAfterFirstBuild: {
        snapshot: { bytes: diskA.total, files: diskA.count },
        sqlite: { bytes: diskB.total, files: diskB.count },
      },
      coldRestore: {
        rounds: COLD_ROUNDS,
        snapshot: summarize(cold.snapshot),
        sqlite: summarize(cold.sqlite),
      },
      pointUpdate: { rounds: POINT_ROUNDS, snapshot: summarize(point.snapshot), sqlite: summarize(point.sqlite) },
      batchUpdate: { rounds: BATCH_ROUNDS, size: BATCH_SIZE, snapshot: summarize(batch.snapshot), sqlite: summarize(batch.sqlite) },
      backlinkQuery: { queries: QUERY_N, backlinkBuildMs, snapshot: summarize(query.snapshot), sqlite: summarize(query.sqlite) },
      shardSensitivity,
    }
  }

  fsSync.mkdirSync(path.dirname(reportPath), { recursive: true })
  fsSync.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')
  console.log(`\n报告已写入 ${reportPath}`)
  printSummary(report)
}

function summarize(rows) {
  const keys = Object.keys(rows[0]).filter((k) => typeof rows[0][k] === 'number')
  const out = { rounds: rows.length }
  for (const k of keys) out[`median_${k}`] = median(rows.map((r) => r[k]))
  return out
}

function worstLoop(rows) {
  return {
    maxOfMeanMs: Math.max(...rows.map((r) => r.loopDelay.meanMs)),
    maxOfP99Ms: Math.max(...rows.map((r) => r.loopDelay.p99Ms)),
    maxOfMaxMs: Math.max(...rows.map((r) => r.loopDelay.maxMs)),
    maxOfStarveMs: Math.max(...rows.map((r) => r.loopDelay.maxStarveMs)),
  }
}

function fmtMs(ms) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(ms < 10 ? 2 : 0)}ms`
}

function printSummary(report) {
  console.log('\n| 档位 | 引擎 | 首建(中位) | 冷恢复(中位) | 单文件更新 | 批量500 | 反链查询 |')
  console.log('| --- | --- | --- | --- | --- | --- | --- |')
  for (const [tier, t] of Object.entries(report.tiers)) {
    for (const engine of ['snapshot', 'sqlite']) {
      const fb = t.firstBuild[engine]
      const cr = t.coldRestore[engine]
      const pu = t.pointUpdate[engine]
      const bu = t.batchUpdate[engine]
      const q = t.backlinkQuery[engine]
      console.log(`| ${tier} | ${engine} | ${fmtMs(fb.median_totalMs)} | ${fmtMs(cr.median_loadMs)} | ${fmtMs(pu.median_ms)} | ${fmtMs(bu.median_ms)} | ${(q.median_ms * 1000).toFixed(0)}µs |`)
    }
  }
}

// ---------- 冷恢复子进程分支 ----------
async function coldRestoreChildMain(engine, storageDir, extra) {
  if (engine === 'snapshot') {
    const snapshot = await import(pathToFileURL(path.join(buildDir, 'snapshot.mjs')).href)
    const port = snapshotFsPort()
    const t0 = performance.now()
    const loaded = await snapshot.loadSnapshot(port, storageDir)
    const loadMs = performance.now() - t0
    if (!loaded) throw new Error('快照加载失败')
    const t1 = performance.now()
    snapshot.buildBacklinkIndex(loaded.model.edges)
    const buildBacklinkMs = performance.now() - t1
    console.log(JSON.stringify({
      loadMs, files: loaded.model.files.size, edges: loaded.model.edges.length,
      buildBacklinkMs, rss: process.memoryUsage().rss, heapUsed: process.memoryUsage().heapUsed,
    }))
  } else {
    const { readFile } = await import('node:fs/promises')
    const { loadSqlJs, openSqliteIndex } = await import(pathToFileURL(path.join(here, 'vaultIndexSqliteEngine.mjs')).href)
    const SQL = await loadSqlJs()
    const bytes = new Uint8Array(await readFile(extra))
    const t0 = performance.now()
    const handle = openSqliteIndex(SQL, bytes)
    const model = handle.readModel()
    const loadMs = performance.now() - t0
    const st = handle.stats()
    console.log(JSON.stringify({
      loadMs, files: model.files.size, edges: st.edges,
      rss: process.memoryUsage().rss, heapUsed: process.memoryUsage().heapUsed,
    }))
  }
}

if (args.includes('--cold-restore-child')) {
  const i = args.indexOf('--cold-restore-child')
  await coldRestoreChildMain(args[i + 1], args[i + 2], args[i + 3])
} else {
  await main().catch((err) => {
    console.error('[bench] 失败', err)
    process.exitCode = 1
  })
}
