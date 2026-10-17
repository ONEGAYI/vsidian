// #535 T08 迁移 PR #581 九审 R9 + 方案 A 契约测试（2026-10-17 用户裁决
// 批准方案 A 方向：迁移同次激活、身份未定时引导保留待发、收敛后补发、
// 允许引导延至下次激活）。红态证据 out/test/t08-review9-red.log。
//
// - R9-2：败者排队预算须覆盖 owner 身份等待最坏占用（生产默认 1+10s vs
//   旧默认 5s）——生产默认参数组合的普通并发（A 留 done、B 首次激活 11s
//   等待持锁、C 2s 后启动）下，C 不得静默退出跳过首迁移。
// - R9-3：done 的瞬时读取失败（EIO）不得降级取旧 pending 当引导欠账（区
//   分「读取错误」与「内容残缺」：前者 fail-closed 返回 null，后者才降
//   级回退——R8-3 的债务保护不回退）。
// - 方案 A 四路径（裁决要求的红绿证据）：同 profile 有限延迟（生产默认
//   参数 + 15s 延迟，R8/R9 审查方反例复现链）恰一次；独立 profile 首次
//   激活迁移生效、引导留待下次激活补发（重启恢复路径）；持续不能确认
//   身份（观察预算尽）不无限延期；收敛到他窗 pending 欠账时补发恰一次。
import { afterAll, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  runLegacyThemeMigration,
  type LegacyThemeMigrationPorts,
} from '../../src/shared/legacyThemeMigration'
import { createLegacyThemeMigrationLock } from '../../src/shared/legacyThemeMigrationLock'
import { legacyMarkerIdentitiesOnDisk, makeDiskMarkerStore } from './legacyDiskMarkerStore'
import {
  SETTINGS_STORAGE_KEY,
  type SettingsStorage,
} from '../../src/host/settingsService'
import { MERMAID_THEME_KEY, APPEARANCE_THEME_KEY } from '../../src/shared/settings'

const PROFILE_ID_STATE_KEY = 'vsidian.legacyThemeMigration.profileId'
const RETIRED_OVERLAY = { [MERMAID_THEME_KEY]: 'retired-preset' }

const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'vsidian-legacy-review9-'))
afterAll(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true })
})

let dirSeq = 0
async function newDir(): Promise<string> {
  const dir = path.join(tmpRoot, `case-${++dirSeq}`)
  await fsp.mkdir(dir, { recursive: true })
  return dir
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** 独立 profile 内存 memento（跨 profile 无广播互通） */
function makeMemento(): { memento: SettingsStorage; store: Map<string, unknown> } {
  const store = new Map<string, unknown>()
  const memento: SettingsStorage = {
    get: <T>(key: string) => store.get(key) as T | undefined,
    update: (key: string, value: unknown) => {
      store.set(key, value)
      return Promise.resolve()
    },
  }
  return { memento, store }
}

/**
 * 同 profile 共享 DB + 延迟广播（reviewer 反例链的收敛观测面）。广播按
 * **写时值快照**投递（入队语义——1.82.3 storage 事件队列送达的是写入
 * 时值，而非到达时的最新 DB 值：B 晚写覆盖 DB 后，A 先前入队的身份事件
 * 送达 B 时仍是 A 的值——这正是方案 A 收敛观察所依赖的到达语义）
 */
function makeSharedDb(delayMs: number) {
  const db = new Map<string, unknown>()
  const caches: Map<string, unknown>[] = []
  const openWindow = (): { memento: SettingsStorage; cache: Map<string, unknown> } => {
    const cache = new Map<string, unknown>(db)
    caches.push(cache)
    const memento: SettingsStorage = {
      get: <T>(key: string) => cache.get(key) as T | undefined,
      update: (key: string, value: unknown) => {
        cache.set(key, value)
        db.set(key, value)
        for (const other of caches) {
          if (other === cache) continue
          const delivered = value
          setTimeout(() => { other.set(key, delivered) }, delayMs).unref?.()
        }
        return Promise.resolve()
      },
    }
    return { memento, cache }
  }
  return { db, openWindow }
}

function mementoExclusiveStep(memento: SettingsStorage) {
  return async <R>(
    step: (overlay: unknown) => { patch: Record<string, unknown> | null; result: R },
  ): Promise<R> => {
    const { patch, result } = step(memento.get(SETTINGS_STORAGE_KEY))
    if (patch !== null) {
      const current = memento.get<Record<string, unknown>>(SETTINGS_STORAGE_KEY)
      await memento.update(SETTINGS_STORAGE_KEY, { ...current, ...patch })
    }
    return result
  }
}

const nodeLockFs = {
  writeFileExclusive: async (target: string, data: string) => {
    const handle = await fsp.open(target, 'wx')
    try {
      await handle.writeFile(data, 'utf8')
    } finally {
      await handle.close()
    }
  },
  rename: (from: string, to: string) => fsp.rename(from, to),
  rm: async (target: string) => {
    await fsp.rm(target, { force: true })
  },
  utimes: async (target: string, mtimeMs: number) => {
    const at = new Date(mtimeMs)
    await fsp.utimes(target, at, at)
  },
  statMtimeMs: async (target: string) => {
    try {
      return (await fsp.stat(target)).mtimeMs
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  },
  readFile: (target: string) => fsp.readFile(target, 'utf8'),
  listDirFiles: (dir: string) => fsp.readdir(dir),
}

function makeWindowPorts(
  memento: SettingsStorage,
  dir: string,
  token: string,
  onGuide: () => void,
): LegacyThemeMigrationPorts {
  const lock = createLegacyThemeMigrationLock(
    nodeLockFs, path.join(dir, 'legacy-theme-migration'), { token, pid: 1000 })
  const diskMarker = makeDiskMarkerStore(dir, { ownedGeneration: () => lock.getOwnedGeneration() })
  return {
    readRawOverlay: () => memento.get(SETTINGS_STORAGE_KEY),
    applyExclusiveOverlayStep: mementoExclusiveStep(memento),
    readProfileId: async () => {
      const direct = memento.get(PROFILE_ID_STATE_KEY)
      if (typeof direct === 'string' && direct !== '') return direct
      const overlay = memento.get<Record<string, unknown>>(SETTINGS_STORAGE_KEY)
      if (typeof overlay === 'object' && overlay !== null && !Array.isArray(overlay)) {
        const id = overlay['_legacyThemeMigration.profileId']
        if (typeof id === 'string' && id !== '') return id
      }
      return null
    },
    writeProfileId: async (id: string) => {
      await memento.update(PROFILE_ID_STATE_KEY, id)
    },
    ...diskMarker,
    hasAnyMigrationState: async () => {
      try {
        const names = await fsp.readdir(dir)
        return names.some((n) => n.startsWith('legacy-theme-migration.') && n.endsWith('.json'))
      } catch {
        return false
      }
    },
    extensionVersion: () => '1.2.3-test',
    requestGuide: onGuide,
    lock,
  }
}

describe('九审 R9-2：败者排队预算覆盖 owner 最坏等待（生产默认参数组合）', () => {
  it('A 留 done、B 首激活默认 1+10s 等待持锁、C 2s 后启动 → C 同次激活完成首迁移（红态：默认 5s 超时静默退出）', async () => {
    const dir = await newDir()
    const guides: string[] = []
    // profile A：磁盘全净，默认参数首任认领（~1s 引导，磁盘留下 done）
    const a = makeMemento()
    a.memento.update(SETTINGS_STORAGE_KEY, { ...RETIRED_OVERLAY })
    const a1 = await runLegacyThemeMigration(
      makeWindowPorts(a.memento, dir, 'token-a1', () => { guides.push('A') }), {})
    expect(a1).toEqual({ action: 'migrate', guide: true })
    // profile B：默认参数（wait 1s + settle 10s）——身份等待持锁 ~11s
    const b = makeMemento()
    b.memento.update(SETTINGS_STORAGE_KEY, { ...RETIRED_OVERLAY })
    const runB = runLegacyThemeMigration(
      makeWindowPorts(b.memento, dir, 'token-b1', () => { guides.push('B') }),
      { convergeWatchMs: 300 })
    await sleep(2_000) // C 于 B 后 2 秒启动（reviewer 反例同款时序）
    const c = makeMemento()
    c.memento.update(SETTINGS_STORAGE_KEY, { ...RETIRED_OVERLAY })
    const c1 = await runLegacyThemeMigration(
      makeWindowPorts(c.memento, dir, 'token-c1', () => { guides.push('C') }),
      { convergeWatchMs: 300 })
    const b1 = await runB
    // R9 反例（红态）：C 等满旧默认 5s 静默退出（none）——本 profile 首
    // 迁移被跳到下次激活。绿态：排队预算（默认 30s）覆盖 B 的 11s 占用
    expect(c1).toEqual({ action: 'migrate', guide: false })
    expect(b1).toEqual({ action: 'migrate', guide: false })
    // 方案 A：B/C 首次激活只迁移不引导（临时身份未定，观察预算尽）；
    // 再次激活按 pending 恢复补发——三 profile 各恰一次
    expect(guides).toEqual(['A'])
    const b2 = await runLegacyThemeMigration(
      makeWindowPorts(b.memento, dir, 'token-b2', () => { guides.push('B') }), {})
    const c2 = await runLegacyThemeMigration(
      makeWindowPorts(c.memento, dir, 'token-c2', () => { guides.push('C') }), {})
    expect(b2).toEqual({ action: 'none', guide: true })
    expect(c2).toEqual({ action: 'none', guide: true })
    expect(guides).toEqual(['A', 'B', 'C'])
  }, 90_000)
})

describe('九审 R9-3：done 的瞬时读取失败不得降级成 pending 债务', () => {
  it('d2 读取 EIO + p1 在场 → 整体 fail-closed 返回 null（红态：降级取 p1 的 pending）', async () => {
    const dir = await newDir()
    const profileId = 'r9-eio-profile'
    // 种子顺序：先 d2 再 p1——writeMarker 收尾清理更低代次，d2 先写会把
    // 尚未落盘的 p1 清掉；p1 后写（其清理面 <1 为空）两者并存
    const done2 = makeDiskMarkerStore(dir, { ownedGeneration: async () => 2 })
    await done2.writeMarker(profileId, { state: 'done', version: '1.2.3-test' })
    const seed = makeDiskMarkerStore(dir, { ownedGeneration: async () => 1 })
    await seed.writeMarker(profileId, { state: 'pending', version: '1.2.3-test' })
    // 注入：d2 的 readFile 抛 EIO（文件内容完好，仅读取瞬时失败）
    const eioReadFs = {
      readdir: (d: string) => fsp.readdir(d),
      readFile: async (p: string) => {
        if (p.includes('.d2.json')) {
          const error = new Error('injected transient EIO') as NodeJS.ErrnoException
          error.code = 'EIO'
          throw error
        }
        return fsp.readFile(p, 'utf8')
      },
      writeFile: (p: string, data: string) => fsp.writeFile(p, data, 'utf8'),
      rename: (from: string, to: string) => fsp.rename(from, to),
      rm: (p: string) => fsp.rm(p, { force: true }),
      exists: async (p: string) => {
        try {
          await fsp.stat(p)
          return true
        } catch {
          return false
        }
      },
    }
    // 权威状态未知（done 读不出）→ 不得采用 p1 当欠账；fail-closed null，
    // 本次激活放弃判定（下次激活重读 done 即短路，无重复引导）
    expect(await makeDiskMarkerStore(dir, { fs: eioReadFs }).readMarker(profileId)).toBeNull()
    // I/O 恢复后正常读取 → done（收口不回退）
    expect((await makeDiskMarkerStore(dir).readMarker(profileId))?.state).toBe('done')
  })
})

describe('方案 A：同 profile 有限延迟（生产默认参数 + 15s 广播延迟，R8/R9 反例复现链）', () => {
  it('B 等满默认 1+10s 后迁移不发引导，15s 广播到达收敛 → 墓碑封存 + 重跑短路，总引导恰 1 次', async () => {
    const dir = await newDir()
    const { db, openWindow } = makeSharedDb(15_000) // 审查方反例同款有限延迟
    const wA = openWindow()
    wA.memento.update(SETTINGS_STORAGE_KEY, { ...RETIRED_OVERLAY })
    const wB = openWindow() // B 缓存与 A 同步初始化（无身份、退役残留）
    const guides: string[] = []
    const a = await runLegacyThemeMigration(
      makeWindowPorts(wA.memento, dir, 'token-a', () => { guides.push('A') }), {})
    expect(a).toEqual({ action: 'migrate', guide: true })
    const idA = db.get(PROFILE_ID_STATE_KEY)
    // B：默认参数（wait 1s + settle 10s + 观察预算默认 120s）——11s 后迁
    // 移不发引导；15s 广播到达 → 收敛观察命中 → 临时身份封存 done + 按
    // idA 重跑 → done 短路（B 最终结果 none，总引导恰 1）
    const b = await runLegacyThemeMigration(
      makeWindowPorts(wB.memento, dir, 'token-b', () => { guides.push('B') }), {})
    expect(b).toEqual({ action: 'none', guide: false })
    expect(guides).toEqual(['A'])
    // 临时身份从磁盘身份数提取（B 的缓存在收敛镜像后已持有 idA——广播
    // 按写时值快照覆盖，恰是收敛机制本身）
    const readMarker = makeDiskMarkerStore(dir).readMarker
    const identities = await legacyMarkerIdentitiesOnDisk(dir)
    const idB = identities.find((identity) => identity !== idA)
    expect(typeof idB).toBe('string')
    expect((await readMarker(String(idA)))?.state).toBe('done')
    // 临时身份封存为 done 墓碑：后续任何读到 idB 的窗口不再补发
    expect((await readMarker(String(idB)))?.state).toBe('done')
    expect((db.get(SETTINGS_STORAGE_KEY) as Record<string, unknown>)[APPEARANCE_THEME_KEY])
      .toBe('default')
  }, 150_000)
})

describe('方案 A：独立 profile 首迁生效、引导延至下次激活（重启恢复 + 不无限延期）', () => {
  it('首激活迁移+pending 不引导；下次激活（真实 db 初始化）恢复补发恰一次；再下次短路', async () => {
    const dir = await newDir()
    const storageA = makeSharedDb(0)
    const wA = storageA.openWindow()
    wA.memento.update(SETTINGS_STORAGE_KEY, { ...RETIRED_OVERLAY })
    const guides: string[] = []
    await runLegacyThemeMigration(
      makeWindowPorts(wA.memento, dir, 'token-a', () => { guides.push('A') }),
      { profileIdWaitMs: 10, profileIdPollMs: 2 })
    // profile B：独立 storage（身份永不到达）；窗口注入小等待与观察预算
    // （本场景语义对比值不敏感——无竞态，只有「超时→迁移不发→下次补发」）
    const storageB = makeSharedDb(0)
    const wB = storageB.openWindow()
    wB.memento.update(SETTINGS_STORAGE_KEY, { ...RETIRED_OVERLAY })
    const b1 = await runLegacyThemeMigration(
      makeWindowPorts(wB.memento, dir, 'token-b1', () => { guides.push('B') }),
      { profileIdWaitMs: 20, profileIdPollMs: 2, profileIdSettleMs: 50, convergeWatchMs: 50 })
    expect(b1).toEqual({ action: 'migrate', guide: false })
    const idB = storageB.db.get(PROFILE_ID_STATE_KEY)
    expect((await makeDiskMarkerStore(dir).readMarker(String(idB)))?.state).toBe('pending')
    // 重启（新窗口从 db 初始化：临时身份与 default 已持久化）→ 恢复补发
    const wB2 = storageB.openWindow()
    const b2 = await runLegacyThemeMigration(
      makeWindowPorts(wB2.memento, dir, 'token-b2', () => { guides.push('B') }), {})
    expect(b2).toEqual({ action: 'none', guide: true })
    expect(guides).toEqual(['A', 'B'])
    expect((await makeDiskMarkerStore(dir).readMarker(String(idB)))?.state).toBe('done')
    // 再下次激活：done 短路，不再增长（不无限延期、也不重复）
    const wB3 = storageB.openWindow()
    const b3 = await runLegacyThemeMigration(
      makeWindowPorts(wB3.memento, dir, 'token-b3', () => { guides.push('B') }), {})
    expect(b3).toEqual({ action: 'none', guide: false })
    expect(guides).toEqual(['A', 'B'])
  })
})

describe('方案 A：收敛到他窗 pending 欠账（peer 崩溃于 pending 后）→ 补发恰一次', () => {
  it('观察窗内身份收敛到带 pending 的既有身份 → 墓碑封存临时身份 + 按收敛身份恢复补发', async () => {
    const dir = await newDir()
    const PEER_ID = 'r9-peer-crashed'
    // peer 崩溃形态：磁盘留下 pending(PEER_ID)（identity 未入本测试 db——
    // 由收敛注入直接到达 B 的缓存，模拟广播送达）
    await fsp.writeFile(path.join(dir, `legacy-theme-migration.${PEER_ID}.p1.json`),
      JSON.stringify({ state: 'pending', version: '0.9.0' }), 'utf8')
    const storageB = makeSharedDb(0)
    const wB = storageB.openWindow()
    wB.memento.update(SETTINGS_STORAGE_KEY, { ...RETIRED_OVERLAY })
    const guides: string[] = []
    const portsB = makeWindowPorts(wB.memento, dir, 'token-b', () => { guides.push('B') })
    const runB = runLegacyThemeMigration(portsB,
      { profileIdWaitMs: 20, profileIdPollMs: 2, profileIdSettleMs: 50, convergeWatchMs: 3_000, pollIntervalMs: 5 })
    // B 进入收敛观察后（迁移已做、临时身份 pending 已写）：身份广播到达
    // ——收敛目标带 pending 欠账（peer 未引导即崩溃）
    await sleep(200)
    await wB.memento.update(PROFILE_ID_STATE_KEY, PEER_ID)
    const b = await runB
    // 收敛 → 临时身份墓碑 + 按 PEER_ID 重跑 → pending 恢复补发恰一次
    expect(b).toEqual({ action: 'none', guide: true })
    expect(guides).toEqual(['B'])
    const readMarker = makeDiskMarkerStore(dir).readMarker
    expect((await readMarker(PEER_ID))?.state).toBe('done')
    const idB = storageB.db.get(PROFILE_ID_STATE_KEY)
    expect(typeof idB).toBe('string')
    expect((await readMarker(String(idB)))?.state).toBe('done')
  })
})
