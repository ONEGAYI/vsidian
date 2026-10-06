// 双链联想容量基准（工单 #382 T07，规格「失败、容量与交付口径」节）。
//
// 在三档混合语料（1千/1万/10万文件：Markdown + 常用资源 + 仅登记类型）
// 上驱动**真实生产服务**（esbuild 即时编译 src/host/vaultIndexService.ts
// 为 node ESM，单一事实源不复制逻辑；扫描/存储端口以真实 node:fs 实现），
// 测量：首建、冷启动恢复（子进程）、空/短/长/多词查询、逐字输入序列、
// 单文件事件（watcher 回调直驱→清单可查→删除回落）、覆盖重算中途取消
// （长任务有界）、墙钟、事件循环最长停顿（monitorEventLoopDelay + 20ms
// 饿死探针双路）、内存峰值、磁盘占用与候选传输量；并核验清单缓存不含
// 附件全文（哨兵字符串扫描）。
//
// 诚实边界（写报告 meta.methods，解读文档展开）：
// - 纯 Node 直跑（非 VSCode 扩展宿主进程内）；宿主内数字归集成测试。
// - 冷启动恢复 = 新起子进程（JS 堆/编译缓存冷）；OS 文件缓存无法用户态
//   清空，为热缓存近似。
// - 文件事件经 watchRoot 端口回调直驱（服务内去抖→三态判定→清单更新
//   →提交去抖全链路真实），OS watcher 传播延迟不在测量内。
// - 查询为同步 CPU 评分（queryWikilinkFileCandidates）；事件循环停顿由
//   饿死探针捕捉（同步阻塞下 monitorEventLoopDelay 样本缺失）。
//
// 用法：
//   node test/perf/wikilinkCatalogBench.mjs [--corpus <dir>] [--tiers 1k,10k,100k]
//                                          [--report <json>] [--keep-corpus]
// 语料默认生成到 D:/CODE/Project/_ForExplore/vsidian-382-bench（工作树外，
// 不提交）；报告默认写 docs/perf/data/wikilink-catalog-bench.json。
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import fsSync from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { cpus } from 'node:os'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const buildDir = path.join(repoRoot, 'out', 'test', 'perf-wikilink-catalog')

// ---------- CLI ----------
const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : fallback
}
const DEFAULT_CORPUS_ROOT = 'D:/CODE/Project/_ForExplore/vsidian-382-bench'
const corpusRoot = argOf('--corpus', DEFAULT_CORPUS_ROOT)
const tiersArg = argOf('--tiers', '1k,10k,100k').split(',')
const reportPath = argOf(
  '--report',
  path.join(repoRoot, 'docs', 'perf', 'data', 'wikilink-catalog-bench.json'),
)

// ---------- 生产服务模块：esbuild 即时编译（单一事实源） ----------
async function buildServiceModule() {
  fsSync.mkdirSync(buildDir, { recursive: true })
  const outfile = path.join(buildDir, 'service.mjs')
  await build({
    entryPoints: [path.join(repoRoot, 'src', 'host', 'vaultIndexService.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    logLevel: 'silent',
  })
  return import(pathToFileURL(outfile).href)
}

// ---------- 语料生成（确定性 PRNG；混合类型 + 附件哨兵） ----------
const TIERS = {
  '1k': { files: 1_000, seed: 20261005 },
  '10k': { files: 10_000, seed: 20261006 },
  '100k': { files: 100_000, seed: 20261007 },
}
const AREA_COUNT = 24
const CN_WORDS = ['设计', '研究', '笔记', '会议', '架构', '方案', '调研', '复盘', '总结', '草稿',
  '规范', '索引', '实验', '计划', '评审', '资料', '手册', '日志', '提案', '任务',
  '模板', '清单', '指南', '概述']
const EN_WORDS = ['design', 'research', 'notes', 'meeting', 'arch', 'review', 'plan', 'spec',
  'index', 'draft', 'guide', 'report']
const SENTENCES = [
  '容量测量语料：双链联想候选来自全文件清单与查询评分。',
  '清单条目只登记名称、路径、类型与元数据，不含正文。',
  '空查询只列常用资源并按修改时间从新到旧排序。',
  '有查询时按匹配分数优先，同分再按修改时间破序。',
  '文件事件去抖后进入清单维护，移除需要存在性正证据。',
]

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

/** 混合类型构成（按文件数占比）：md 55% / 常用资源 20%（png/pdf/mp3/mp4/txt）
 * / 仅登记 25%（pyc/bin + 无扩展名）——「区分 Markdown 与仅登记类型」。
 * 附件正文 2–8 KB（容量档 10 万文件时总盘占用 ~400 MB 量级）。 */
const MIX = [
  { ext: '.md', kind: 'markdown', share: 0.55 },
  { ext: '.png', kind: 'asset', share: 0.06 },
  { ext: '.pdf', kind: 'asset', share: 0.04 },
  { ext: '.mp3', kind: 'asset', share: 0.03 },
  { ext: '.mp4', kind: 'asset', share: 0.02 },
  { ext: '.txt', kind: 'asset', share: 0.05 },
  { ext: '.pyc', kind: 'other', share: 0.12 },
  { ext: '.bin', kind: 'other', share: 0.08 },
  { ext: '', kind: 'other', share: 0.05 }, // 无扩展名（classify → other）
]

const SENTINEL_PREFIX = 'VSI382T07SENTINEL'

/** 生成一档语料；返回统计。附件正文含唯一哨兵（供「缓存不含附件全文」核验）。 */
async function generateTier(tier) {
  const { files, seed } = TIERS[tier]
  const rnd = mulberry32(seed)
  const dir = path.join(corpusRoot, tier)
  await rm(dir, { recursive: true, force: true })
  const names = []
  for (let i = 0; i < files; i++) {
    const cn = CN_WORDS[Math.floor(rnd() * CN_WORDS.length)]
    const en = EN_WORDS[Math.floor(rnd() * EN_WORDS.length)]
    names.push(`${cn}-${en}-${String(i).padStart(6, '0')}`)
  }
  const mdNames = new Set()
  let cursor = 0
  const alloc = []
  for (const slot of MIX) {
    const count = Math.round(files * slot.share)
    for (let k = 0; k < count && cursor < files; k++) {
      alloc.push(slot)
      if (slot.kind === 'markdown') mdNames.add(names[cursor])
      cursor++
    }
  }
  while (cursor < files) {
    alloc.push(MIX[0])
    mdNames.add(names[cursor])
    cursor++
  }
  const mdList = [...mdNames]
  const byKind = { markdown: 0, asset: 0, other: 0 }
  let assetBytes = 0
  for (let i = 0; i < files; i++) {
    const area = `area-${String(i % AREA_COUNT).padStart(2, '0')}`
    const slot = alloc[i]
    const name = names[i] + slot.ext
    const abs = path.join(dir, area, name)
    await mkdir(path.dirname(abs), { recursive: true })
    if (slot.kind === 'markdown') {
      byKind.markdown++
      const lines = [`# ${names[i]}`, '']
      const linkCount = 2 + Math.floor(rnd() * 3)
      for (let l = 0; l < linkCount; l++) {
        const target = mdList[Math.floor(rnd() * mdList.length)]
        lines.push(`链接 [[${target}]] 与相关 [[${target}#章节]]。`)
      }
      lines.push(SENTENCES[Math.floor(rnd() * SENTENCES.length)])
      lines.push(`![](附件-${String(i % 97).padStart(3, '0')}.png)`)
      lines.push(`断链 [[不存在的目标-${i}]]。`)
      await writeFile(abs, lines.join('\n') + '\n', 'utf8')
    } else {
      byKind[slot.kind]++
      const size = 2 * 1024 + Math.floor(rnd() * 6 * 1024)
      const buf = Buffer.concat([
        Buffer.from(`${SENTINEL_PREFIX}-${tier}-${i}\n`, 'utf8'),
        randomBytes(Math.max(0, size - 64)),
      ])
      await writeFile(abs, buf)
      assetBytes += buf.length
    }
  }
  return { tier, files, mdCount: byKind.markdown, assetCount: byKind.asset, otherCount: byKind.other, assetBytes, sentinel: `${SENTINEL_PREFIX}-${tier}-` }
}

// ---------- 真实 fs 端口（带调用/字节计数） ----------
function makePorts() {
  const counts = {
    listAllFiles: 0,
    listAllFilesReturned: 0,
    listMarkdown: 0,
    readFileText: 0,
    readFileTextBytes: 0,
    statFile: 0,
    accessOf: 0,
    storageReadFile: 0,
    storageReadBytes: 0,
    storageWriteBytes: 0,
    yieldCount: 0,
  }
  const watchers = []
  const scan = {
    async listMarkdownFiles(rootFsPath) {
      counts.listMarkdown++
      const out = []
      const walk = async (rel) => {
        const entries = await readdir(path.join(rootFsPath, rel), { withFileTypes: true })
        for (const e of entries) {
          const r = rel ? `${rel}/${e.name}` : e.name
          if (e.isDirectory()) {
            if (e.name !== '.git' && e.name !== 'node_modules') await walk(r)
          } else if (e.isFile() && /\.md$/i.test(e.name)) {
            out.push(path.join(rootFsPath, r))
          }
        }
      }
      await walk('')
      return out
    },
    async listAllFiles(rootFsPath, opts) {
      counts.listAllFiles++
      const files = []
      const failedDirs = []
      const walk = async (rel) => {
        let entries
        try {
          entries = await readdir(path.join(rootFsPath, rel), { withFileTypes: true })
        } catch {
          failedDirs.push(path.join(rootFsPath, rel))
          return
        }
        for (const e of entries) {
          const r = rel ? `${rel}/${e.name}` : e.name
          if (e.isDirectory()) {
            if (e.name === '.git' || e.name === 'node_modules') continue
            if (opts?.skipDir && opts.skipDir(path.join(rootFsPath, r))) continue
            await walk(r)
          } else if (e.isFile()) {
            files.push(path.join(rootFsPath, r))
          }
        }
      }
      await walk('')
      counts.listAllFilesReturned += files.length
      return { files, failedDirs }
    },
    async readFileText(fsPath) {
      try {
        const t = await readFile(fsPath, 'utf8')
        counts.readFileText++
        counts.readFileTextBytes += Buffer.byteLength(t, 'utf8')
        return t
      } catch {
        return null
      }
    },
    async statFile(fsPath) {
      try {
        counts.statFile++
        const s = await stat(fsPath)
        return {
          mtimeMs: Math.round(s.mtimeMs),
          size: s.size,
          birthtimeMs: s.birthtimeMs,
          type: s.isDirectory() ? 'dir' : 'file',
        }
      } catch {
        return null
      }
    },
    async accessOf(fsPath) {
      counts.accessOf++
      try {
        await stat(fsPath)
        return 'ok'
      } catch (err) {
        return err?.code === 'ENOENT' ? 'missing' : 'inaccessible'
      }
    },
    watchRoot(_rootFsPath, onEvent) {
      watchers.push(onEvent)
      return () => {}
    },
    async yieldToEventLoop() {
      counts.yieldCount++
      await new Promise((resolve) => setImmediate(resolve))
    },
  }
  const storage = {
    async listDirs(baseDir) {
      try {
        const entries = await readdir(baseDir, { withFileTypes: true })
        return entries.filter((e) => e.isDirectory()).map((e) => e.name)
      } catch {
        return []
      }
    },
    async readFile(p) {
      try {
        const t = await readFile(p, 'utf8')
        counts.storageReadFile++
        counts.storageReadBytes += Buffer.byteLength(t, 'utf8')
        return t
      } catch {
        throw new Error(`ENOENT:${p}`)
      }
    },
    async writeFile(p, content) {
      // 与生产壳同语义：临时写 + rename（原子提交）
      const tmp = `${p}.tmp-${process.pid}-${Date.now()}`
      await mkdir(path.dirname(p), { recursive: true })
      await writeFile(tmp, content, 'utf8')
      await fsSync.promises.rename(tmp, p)
      counts.storageWriteBytes += Buffer.byteLength(content, 'utf8')
    },
    async removeDir(p) {
      await rm(p, { recursive: true, force: true })
    },
    async ensureDir(p) {
      await mkdir(p, { recursive: true })
    },
  }
  return { scan, storage, counts, watchers }
}

// ---------- 度量工具 ----------
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** 监视包装（与 vaultIndexBench 同双路事件循环证据）：直方图 + 20ms 饿死
 *  探针；25ms 内存采样；结束后等 150ms 收尾捕捉解除后 spike。
 *  fn 的返回值原样透传（墙钟由 fn 内自计并随 value 返回）。 */
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
    await new Promise((resolve) => setTimeout(resolve, 150))
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

async function dirSize(p) {
  let total = 0
  let files = 0
  const walk = async (rel) => {
    const entries = await readdir(path.join(p, rel), { withFileTypes: true })
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) await walk(r)
      else {
        const s = await stat(path.join(p, r))
        total += s.size
        files++
      }
    }
  }
  await walk('')
  return { totalBytes: total, files }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---------- 服务装配 ----------
async function makeService(mod, corpusDir, storageRoot) {
  const ports = makePorts()
  const service = new mod.VaultIndexService(ports.scan, ports.storage, {
    storageRoot,
    isWindowsHost: process.platform === 'win32',
    verifyIntervalMs: 0, // 基准期禁用周期核验（避免后台任务污染测量）
  })
  const rootRef = {
    fsPath: corpusDir,
    uri: pathToFileURL(corpusDir).href,
  }
  return { service, ports, rootRef }
}

const catalogCountOf = (service) =>
  service.maintenanceInfo().roots.reduce((a, r) => a + r.catalogFileCount, 0)

// ---------- 查询负载 ----------
const QUERIES = [
  { key: 'empty', q: '' },
  { key: 'short-cn', q: '设计' },
  { key: 'short-en', q: 'design' },
  { key: 'long', q: 'arch-review-meeting-notes' },
  { key: 'multi-word', q: '设计 meeting' },
]
/** 逐字输入序列（模拟敲键，前缀逐步增长） */
const TYPING_SEQUENCE = ['d', 'de', 'des', 'desi', 'desig', 'design']
const WALL_ROUNDS = 25
const STARVE_ROUNDS = 3

// ---------- 冷启动恢复子进程 ----------
function restoreChild(corpusDir, storageRoot) {
  const r = spawnSync(
    process.execPath,
    [fileURLToPath(import.meta.url), '--restore-child', corpusDir, storageRoot],
    { encoding: 'utf8', timeout: 10 * 60_000 },
  )
  if (r.status !== 0) throw new Error(`恢复子进程失败：${r.stderr}`)
  return JSON.parse(r.stdout.trim().split('\n').pop())
}

async function runRestoreChild(corpusDir, storageRoot) {
  const mod = await buildServiceModule()
  const { service, ports, rootRef } = await makeService(mod, corpusDir, storageRoot)
  const result = await monitored(async () => {
    const t0 = performance.now()
    await service.initialize([rootRef])
    return { wallMs: performance.now() - t0 }
  })
  const info = service.maintenanceInfo()
  service.dispose()
  return {
    loadMs: result.value.wallMs,
    loopDelay: result.loopDelay,
    memory: result.memory,
    portCounts: { ...ports.counts },
    roots: info.roots.map((r) => ({
      catalogFileCount: r.catalogFileCount,
      catalogComplete: r.catalogComplete,
      hasData: r.hasData,
    })),
  }
}

// ---------- 主流程（每档） ----------
async function measureTier(mod, tier, report) {
  console.log(`\n===== ${tier} =====`)
  const corpusDir = path.join(corpusRoot, tier)
  const storageRoot = path.join(corpusRoot, `storage-${tier}`)

  // 语料（已存在则复用——marker 由生成器写到档位目录外，不污染清单计数）
  const marker = path.join(corpusRoot, `${tier}.bench-gen.json`)
  let genStats
  if (!fsSync.existsSync(marker)) {
    const t0 = performance.now()
    genStats = await generateTier(tier)
    genStats.genMs = Math.round(performance.now() - t0)
    await writeFile(marker, JSON.stringify(genStats), 'utf8')
  } else {
    genStats = JSON.parse(await readFile(marker, 'utf8'))
  }
  console.log(
    `[gen] files=${genStats.files} md=${genStats.mdCount} asset=${genStats.assetCount} other=${genStats.otherCount}`,
  )

  // ---- 首建（清空 storage；md 索引扫描 + 全文件清单枚举并行） ----
  await rm(storageRoot, { recursive: true, force: true })
  const { service, ports, rootRef } = await makeService(mod, corpusDir, storageRoot)
  const first = await monitored(async () => {
    const t0 = performance.now()
    await service.initialize([rootRef])
    return { wallMs: performance.now() - t0 }
  })
  const firstInfo = service.maintenanceInfo().roots.map((r) => ({
    catalogFileCount: r.catalogFileCount,
    catalogComplete: r.catalogComplete,
    catalogScanning: r.catalogScanning,
    hasData: r.hasData,
  }))
  // catalog.json 定位（<storageRoot>/vsidian-index/<rootKey>/catalog.json）
  let catalogJsonPath = null
  const indexRoot = path.join(storageRoot, 'vsidian-index')
  if (fsSync.existsSync(indexRoot)) {
    for (const d of await readdir(indexRoot, { withFileTypes: true })) {
      if (d.isDirectory()) {
        const p = path.join(indexRoot, d.name, 'catalog.json')
        if (fsSync.existsSync(p)) catalogJsonPath = p
      }
    }
  }
  const catalogJsonBytes = catalogJsonPath ? (await stat(catalogJsonPath)).size : null
  const storageSize = await dirSize(storageRoot)
  console.log(
    `[firstBuild] wall=${(first.value.wallMs / 1000).toFixed(2)}s starveMax=${first.loopDelay.maxStarveMs.toFixed(0)}ms catalog=${firstInfo[0]?.catalogFileCount} complete=${firstInfo[0]?.catalogComplete} json=${(catalogJsonBytes / 1024).toFixed(0)}KB`,
  )

  // ---- 缓存边界核验：附件全文哨兵不得出现在 catalog.json ----
  let sentinelCheck = 'missing-catalog'
  if (catalogJsonPath) {
    const content = await readFile(catalogJsonPath, 'utf8')
    sentinelCheck = content.includes(SENTINEL_PREFIX) ? 'LEAKED' : 'clean'
  }
  console.log(`[sentinel] 缓存不含附件全文：${sentinelCheck}`)

  // ---- 查询费用（热态；墙钟裸计 25 轮取中位 + starve 采样 3 轮） ----
  const areaDir = path.join(corpusDir, 'area-00')
  const srcEntries = await readdir(areaDir)
  const sourceFile = path.join(areaDir, srcEntries.find((n) => n.endsWith('.md')))
  const queries = {}
  for (const { key, q } of QUERIES) {
    const wallRounds = []
    let last = null
    for (let i = 0; i < WALL_ROUNDS; i++) {
      const t0 = performance.now()
      const r = service.queryWikilinkFileCandidates(sourceFile, q)
      wallRounds.push(performance.now() - t0)
      last = r
    }
    let starve = 0
    for (let i = 0; i < STARVE_ROUNDS; i++) {
      const m = await monitored(() =>
        Promise.resolve(service.queryWikilinkFileCandidates(sourceFile, q)))
      starve = Math.max(starve, m.loopDelay.maxStarveMs)
    }
    queries[key] = {
      query: q,
      rounds: WALL_ROUNDS,
      medianWallMs: median(wallRounds),
      maxWallMs: Math.max(...wallRounds),
      maxStarveMs: starve,
      totalMatches: last?.status === 'ready' ? last.total : null,
      itemsCount: last?.status === 'ready' ? last.items.length : 0,
      payloadBytes:
        last?.status === 'ready' ? Buffer.byteLength(JSON.stringify(last.items), 'utf8') : 0,
    }
    console.log(
      `[query ${key}] median=${queries[key].medianWallMs.toFixed(2)}ms total=${queries[key].totalMatches} items=${queries[key].itemsCount} payload=${(queries[key].payloadBytes / 1024).toFixed(1)}KB starve=${starve.toFixed(1)}ms`,
    )
  }

  // ---- 逐字输入序列（d→design 六步；每步单独计墙钟） ----
  const typing = []
  for (const q of TYPING_SEQUENCE) {
    const t0 = performance.now()
    const r = service.queryWikilinkFileCandidates(sourceFile, q)
    typing.push({
      query: q,
      wallMs: performance.now() - t0,
      total: r.status === 'ready' ? r.total : null,
      items: r.status === 'ready' ? r.items.length : 0,
    })
  }
  const typingTotalMs = typing.reduce((a, b) => a + b.wallMs, 0)
  console.log(
    `[typing] 6 步总 ${typingTotalMs.toFixed(2)}ms（中位单步 ${median(typing.map((t) => t.wallMs)).toFixed(2)}ms）`,
  )

  // ---- 单文件事件（watcher 回调直驱 → 清单可查；轮询零查询污染） ----
  const baselineCount = catalogCountOf(service)
  const newBinPath = path.join(areaDir, `bench-event-${Date.now()}.bin`)
  await writeFile(
    newBinPath,
    Buffer.concat([Buffer.from(`${SENTINEL_PREFIX}-event\n`), randomBytes(8192)]),
  )
  const evt0 = performance.now()
  for (const w of ports.watchers) w(newBinPath) // 服务内 800ms 去抖→三态判定→清单更新
  let eventVisibleMs = null
  for (let i = 0; i < 300; i++) {
    await sleep(100)
    if (catalogCountOf(service) === baselineCount + 1) {
      eventVisibleMs = performance.now() - evt0
      break
    }
  }
  // 删除回落（删除正证据 → 清单条目移除）
  let removeVisibleMs = null
  if (eventVisibleMs !== null) {
    await rm(newBinPath, { force: true })
    const rm0 = performance.now()
    for (const w of ports.watchers) w(newBinPath)
    for (let i = 0; i < 300; i++) {
      await sleep(100)
      if (catalogCountOf(service) === baselineCount) {
        removeVisibleMs = performance.now() - rm0
        break
      }
    }
  }
  console.log(
    `[event] 新增→清单可见 ${eventVisibleMs === null ? 'TIMEOUT' : `${eventVisibleMs.toFixed(0)}ms`}；删除→清单回落 ${removeVisibleMs === null ? 'TIMEOUT' : `${removeVisibleMs.toFixed(0)}ms`}（各含 800ms 去抖）`,
  )

  // ---- 长任务有界/可取消：覆盖重算中途取消（排除变更双驱动 epoch 失配） ----
  let cancel = {}
  {
    const t0 = performance.now()
    const firstPass = service.setExcludePatterns(['zzz-bench-cancel-probe']) // 覆盖重算启动
    const midWaitMs = Math.min(2000, Math.max(60, TIERS[tier].files / 50))
    await sleep(midWaitMs) // 扫至中途
    const tCancel = performance.now()
    const secondPass = service.setExcludePatterns([]) // 重入：epoch++ → 首轮批间中止
    await firstPass
    const firstCancelledAt = performance.now()
    await secondPass
    const doneAt = performance.now()
    const info = service.maintenanceInfo()
    cancel = {
      probeWaitMs: midWaitMs,
      firstPassMs: firstCancelledAt - t0, // 含被中止轮的收敛耗时
      secondPassMs: doneAt - tCancel,
      finalCatalogCount: info.roots.reduce((a, r) => a + r.catalogFileCount, 0),
      finalComplete: info.roots.every((r) => r.catalogComplete),
      excludeReset: service.getExcludePatterns().length === 0,
    }
  }
  console.log(
    `[cancel] 首轮(被取消)收敛 ${cancel.firstPassMs.toFixed(0)}ms；重入轮完成 ${cancel.secondPassMs.toFixed(0)}ms；终态 catalog=${cancel.finalCatalogCount} complete=${cancel.finalComplete}`,
  )

  // 收尾：热态内存（服务持有清单+索引）
  const finalMem = process.memoryUsage()
  service.dispose()

  report.tiers[tier] = {
    corpus: { ...genStats, corpusDir, storageRoot },
    firstBuild: {
      wallMs: first.value.wallMs,
      loopDelay: first.loopDelay,
      memory: first.memory,
      info: firstInfo,
      portCounts: { ...ports.counts },
      storageBytes: storageSize.totalBytes,
      catalogJsonBytes,
    },
    sentinelCheck,
    queries,
    typing: { steps: typing, totalMs: typingTotalMs },
    fileEvent: { visibleMs: eventVisibleMs, removeVisibleMs, timeoutMs: 30000 },
    cancelRework: cancel,
    finalMemory: { rss: finalMem.rss, heapUsed: finalMem.heapUsed },
  }
  return report.tiers[tier]
}

// ---------- 报告汇总 ----------
async function main() {
  if (args.includes('--restore-child')) {
    const i = args.indexOf('--restore-child')
    const r = await runRestoreChild(args[i + 1], args[i + 2])
    console.log(JSON.stringify(r))
    return
  }
  const mod = await buildServiceModule()
  const report = {
    meta: {
      date: new Date().toISOString(),
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      cpuModel: cpus()[0].model,
      corpusRoot,
      tiers: tiersArg,
      queryWallRounds: WALL_ROUNDS,
      queryStarveRounds: STARVE_ROUNDS,
      methods: {
        runtime: '纯 Node 直驱生产 VaultIndexService（esbuild 编译单一事实源；端口为真实 node:fs，写盘为临时写+rename 原子提交）',
        coldRestore: '子进程重启（JS 堆/编译缓存冷；OS 文件缓存热——用户态无法清空，如实标注）；initialize 墙钟为激活感知，启动核验（#198 快照恢复后清单比对，含 listAllFiles+stat）后台执行不阻塞',
        eventLoop: 'monitorEventLoopDelay 直方图 + 20ms 饿死探针（同步阻塞下直方图样本缺失）',
        event: '文件事件经 watchRoot 端口回调直驱（服务内去抖→三态判定→清单更新真实），OS watcher 传播延迟不在测量内；可见性以 maintenanceInfo 轮询（零查询污染）',
        typing: '逐字前缀序列 6 步，每步单独计墙钟',
        queries: `每查询 ${WALL_ROUNDS} 轮裸计墙钟取中位 + ${STARVE_ROUNDS} 轮饿死探针采样`,
        cancel: 'setExcludePatterns 双驱动（同轮 epoch 失配中止）验证覆盖重算可取消与终态一致',
        sentinel: '附件正文埋唯一哨兵字符串，扫描 catalog.json 确认不含附件全文',
      },
    },
    tiers: {},
  }
  fsSync.mkdirSync(path.dirname(reportPath), { recursive: true })
  for (const tier of tiersArg) {
    await measureTier(mod, tier, report)
    // 每档完成即落盘（长跑中断可保留已完成档）
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')
  }
  // 冷启动恢复（语料与缓存已就绪；每档 3 轮取中位数）
  for (const tier of tiersArg) {
    const corpusDir = path.join(corpusRoot, tier)
    const storageRoot = path.join(corpusRoot, `storage-${tier}`)
    const rounds = []
    for (let i = 0; i < 3; i++) rounds.push(restoreChild(corpusDir, storageRoot))
    report.tiers[tier].coldRestore = {
      rounds: rounds.map((r) => ({
        loadMs: r.loadMs,
        maxStarveMs: r.loopDelay.maxStarveMs,
        heapPeak: r.memory.heapUsedPeak,
        listAllFilesCalls: r.portCounts.listAllFiles,
        readFileTextCalls: r.portCounts.readFileText,
        catalogWriteBytes: r.portCounts.storageWriteBytes,
        catalogFileCount: r.roots[0]?.catalogFileCount,
      })),
      medianLoadMs: median(rounds.map((r) => r.loadMs)),
      medianMaxStarveMs: median(rounds.map((r) => r.loopDelay.maxStarveMs)),
      // 走缓存判据：catalog.json 未被重写（重建路径 scanCatalog 必 commitCatalog
      // 写盘；listAllFiles 调用属启动核验——#198 契约「快照恢复后清单比对」）
      restoredFromCache: rounds.every((r) => r.portCounts.storageWriteBytes === 0),
      catalogIntact: rounds.every(
        (r) => r.roots[0]?.catalogFileCount === report.tiers[tier].corpus.files,
      ),
    }
    console.log(
      `[coldRestore ${tier}] median=${(report.tiers[tier].coldRestore.medianLoadMs / 1000).toFixed(2)}s starve=${report.tiers[tier].coldRestore.medianMaxStarveMs.toFixed(1)}ms 走缓存=${report.tiers[tier].coldRestore.restoredFromCache}`,
    )
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')
  }
  console.log(`\n报告写入 ${reportPath}`)
  console.log(`语料保留在 ${corpusRoot}（复跑可重用；清理请手动 rm -rf）`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
