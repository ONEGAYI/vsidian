// #535 T08 迁移 PR #581 七审 R7 契约测试。三项 P2 的反例形态（红态对
// 六审尾实现跑，out/test/t08-review7-red.log）：
//
// R7-1（让位记号旧缓存覆写）：1.82.3 ExtensionMemento 向 storage 发送
// 整个扩展对象、存储端整体序列化落盘——旧窗口让位写 overlay 记号时，
// 以其过期缓存**整对象**覆盖 DB，抹掉他窗已落盘的身份载体与 default
// 设置；广播全部送达后从最新 DB 重开的窗口已无身份，按让位记号另造
// UUID 二次迁移引导。断言：让位/等待路径零 DB 写（载体与 default 原样
// 保留），广播送达后重开窗从 DB 读到身份短路，总引导恰 1 次。
//
// R7-2（他 profile 状态阻塞首迁）：hasAnyMigrationState 跨 profile 扫
// 描——独立新 profile 缓存新鲜、无任何广播在途，首次激活仍被当作「可
// 能是旧缓存」让位，用户保持窗口打开则迁移与引导永不发生。断言：他
// profile 状态文件在场时，本 profile 首次激活在**同次激活内**完成迁移
// 与引导（收敛窗后生成自己的身份）。
//
// R7-3（滞后 owner 异步覆写 done）：fence 检查在 await writeMarker 之
// 前，writer 内 mkdir/writeFile/rename 异步链未按代次拒绝——A 挂起在
// pending 写入链内，B 陈旧接管完成 done 与引导，A 恢复把 done 覆回
// pending，下次激活按 pending 补发（累计 2 次引导）。断言：滞后
// owner 的迟到状态提交不改变磁盘权威状态（读取仍 done），总引导恰 1
// 次，再次激活不补发。
//
// R7-1b（声明的残余边界，七审落档）：同 profile 广播延迟超过收敛窗
// （平台故障形态——延迟大于第二窗预算或永久丢失）时，迟到窗在收敛窗
// 尽后换身份重迁，多引导一次；此后系统收敛（新身份 done 短路、旧身
// 份状态文件原样保留），不再增长。本用例钉住边界**形状**（恰 2 次且
// 收敛），不把该形态宣称成恰 1。
import { afterAll, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  LEGACY_THEME_MIGRATION_PROFILE_ID_OVERLAY_KEY,
  runLegacyThemeMigration,
  type LegacyThemeMigrationPorts,
} from '../../src/shared/legacyThemeMigration'
import { createLegacyThemeMigrationLock } from '../../src/shared/legacyThemeMigrationLock'
import { legacyHasAnyMarkerState, makeDiskMarkerStore } from './legacyDiskMarkerStore'
import {
  SETTINGS_STORAGE_KEY,
  type SettingsStorage,
} from '../../src/host/settingsService'
import { MERMAID_THEME_KEY, APPEARANCE_THEME_KEY } from '../../src/shared/settings'

const PROFILE_ID_STATE_KEY = 'vsidian.legacyThemeMigration.profileId'
const DEFERRED_KEY = '_legacyThemeMigration.identityWaitDeferred'

const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'vsidian-legacy-review7-'))
afterAll(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true })
})

let dirSeq = 0
async function newDir(): Promise<string> {
  const dir = path.join(tmpRoot, `case-${++dirSeq}`)
  await fsp.mkdir(dir, { recursive: true })
  return dir
}

// ---- 1.82.3 存储语义模拟：每扩展一个 storage 对象（整对象序列化落
// 盘），窗口缓存从对象初始化、update 把**本窗缓存整对象**写回 DB 并广
// 播（延迟可注入）；广播到达 = 把最新 DB 镜像进目标窗口缓存 ----
interface SharedDbWindow {
  cache: Map<string, unknown>
  memento: SettingsStorage
}
function makeSharedStorage(broadcastDelayMs: number) {
  /** DB 即扩展 storage 对象（键值对；整对象替换语义） */
  const db = new Map<string, unknown>()
  const windows: SharedDbWindow[] = []
  const openWindow = (): SharedDbWindow => {
    const cache = new Map<string, unknown>(db)
    const w: SharedDbWindow = {
      cache,
      memento: {
        get: <T>(key: string) => cache.get(key) as T | undefined,
        update: (key: string, value: unknown) => {
          cache.set(key, value)
          // 整对象写回：DB 被本窗缓存快照整体替换（旧键若不在本窗缓存即被抹）
          db.clear()
          for (const [k, v] of cache) db.set(k, v)
          // 广播：延迟后把 DB 镜像进其他窗口缓存
          for (const other of windows) {
            if (other === w) continue
            setTimeout(() => {
              other.cache.clear()
              for (const [k, v] of db) other.cache.set(k, v)
            }, broadcastDelayMs).unref?.()
          }
          return Promise.resolve()
        },
      },
    }
    windows.push(w)
    return w
  }
  return { db, openWindow }
}

const RETIRED_OVERLAY = { [MERMAID_THEME_KEY]: 'retired-preset' }

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

const lockFs = {
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

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** 读侧 marker 观测（与生产 wiring 同构的读取语义由共享夹具承载） */
const markerReader = (dir: string) => makeDiskMarkerStore(dir).readMarker

function makeWindowPorts(
  memento: SettingsStorage,
  dir: string,
  token: string,
  onGuide: () => void,
): LegacyThemeMigrationPorts {
  const lock = createLegacyThemeMigrationLock(
    lockFs, path.join(dir, 'legacy-theme-migration'), { token, pid: 1000 })
  // 状态文件按写入者锁代次分居（七审 R7-3，与生产 wiring 同构）
  const diskMarker = makeDiskMarkerStore(dir, { ownedGeneration: () => lock.getOwnedGeneration() })
  return {
    readRawOverlay: () => memento.get(SETTINGS_STORAGE_KEY),
    applyExclusiveOverlayStep: mementoExclusiveStep(memento),
    readProfileId: async () => {
      const direct = memento.get(PROFILE_ID_STATE_KEY)
      if (typeof direct === 'string' && direct !== '') return direct
      const overlay = memento.get<Record<string, unknown>>(SETTINGS_STORAGE_KEY)
      if (typeof overlay === 'object' && overlay !== null && !Array.isArray(overlay)) {
        const fromOverlay = overlay[LEGACY_THEME_MIGRATION_PROFILE_ID_OVERLAY_KEY]
        if (typeof fromOverlay === 'string' && fromOverlay !== '') return fromOverlay
      }
      return null
    },
    writeProfileId: async (id: string) => {
      await memento.update(PROFILE_ID_STATE_KEY, id)
    },
    ...diskMarker,
    hasAnyMigrationState: () => legacyHasAnyMarkerState(dir),
    extensionVersion: () => '1.2.3-test',
    requestGuide: onGuide,
    lock,
  }
}

describe('七审 R7-1：让位/等待路径不得向 DB 写回任何 profile 机制状态（整对象覆盖反例）', () => {
  it('A 完成后 B 缓存过期等待 → DB 的身份载体/default 原样保留；广播送达后重开窗从最新 DB 短路，总引导恰 1 次', async () => {
    const dir = await newDir()
    // 同 profile 双窗共享 storage：广播延迟 50ms（有限延迟）——大于 B 的
    // 第一窗（20ms，B 判定时广播未达）且小于收敛窗（200ms，广播必达）
    const { db, openWindow } = makeSharedStorage(50)
    const wA = openWindow()
    wA.memento.update(SETTINGS_STORAGE_KEY, { ...RETIRED_OVERLAY }) // db 初始含退役残留
    const wB = openWindow() // B 缓存与 A 同步初始化（无身份、退役残留）
    const guides: string[] = []
    // A 完整激活（前窗完整结束后下窗才开始——错开激活排除锁并发）
    const a = await runLegacyThemeMigration(
      makeWindowPorts(wA.memento, dir, 'token-a', () => { guides.push('A') }),
      { profileIdWaitMs: 20, profileIdPollMs: 2, profileIdSettleMs: 200 },
    )
    expect(a.guide).toBe(true)
    expect(guides).toEqual(['A'])
    const carrierDirect = db.get(PROFILE_ID_STATE_KEY)
    expect(typeof carrierDirect).toBe('string')
    expect((db.get(SETTINGS_STORAGE_KEY) as Record<string, unknown>)[APPEARANCE_THEME_KEY])
      .toBe('default')
    // B 激活：第一窗（20ms）内广播未达（A 的写入广播在 ~50ms 到）→ 身份
    // 未定 → 等待收敛窗（200ms）→ 广播送达 → 用既有身份 → done 短路
    const b = await runLegacyThemeMigration(
      makeWindowPorts(wB.memento, dir, 'token-b', () => { guides.push('B') }),
      { profileIdWaitMs: 20, profileIdPollMs: 2, profileIdSettleMs: 200 },
    )
    // 无论 B 走到哪条路径，DB 不得被 B 的过期缓存整对象覆盖：
    // 两个身份载体与 default 回落必须原样保留（R7-1 核心断言）
    expect(db.get(PROFILE_ID_STATE_KEY)).toBe(carrierDirect)
    const dbOverlay = db.get(SETTINGS_STORAGE_KEY) as Record<string, unknown>
    expect(dbOverlay[LEGACY_THEME_MIGRATION_PROFILE_ID_OVERLAY_KEY]).toBe(carrierDirect)
    expect(dbOverlay[APPEARANCE_THEME_KEY]).toBe('default')
    expect(dbOverlay[DEFERRED_KEY]).not.toBe(true)
    // 等全部广播送达后从最新 DB 重开窗（C 的缓存即 DB 初始化）：读到
    // 身份 → done 短路，不再引导（R7 复现链的第三步——重开不二次迁移）
    await sleep(150)
    const wC = openWindow()
    const c = await runLegacyThemeMigration(
      makeWindowPorts(wC.memento, dir, 'token-c', () => { guides.push('C') }),
      { profileIdWaitMs: 20, profileIdPollMs: 2, profileIdSettleMs: 200 },
    )
    expect(c).toEqual({ action: 'none', guide: false })
    expect(b).toEqual({ action: 'none', guide: false })
    // 总引导恰 1 次（R7 反例：让位覆写载体后重开窗另造身份 → 2 次）
    expect(guides).toEqual(['A'])
  })
})

describe('七审 R7-1b（声明边界）：同 profile 广播延迟超过收敛窗 → 恰 2 次并收敛', () => {
  it('B 收敛窗尽后换身份重迁（多引导一次），此后重开窗短路不再增长；旧身份状态文件原样保留', async () => {
    const dir = await newDir()
    // 广播延迟 500ms > 收敛窗 100ms——平台故障形态（延迟超窗/永久丢失）
    const { db, openWindow } = makeSharedStorage(500)
    const wA = openWindow()
    wA.memento.update(SETTINGS_STORAGE_KEY, { ...RETIRED_OVERLAY })
    const wB = openWindow()
    const guides: string[] = []
    const a = await runLegacyThemeMigration(
      makeWindowPorts(wA.memento, dir, 'token-a', () => { guides.push('A') }),
      { profileIdWaitMs: 20, profileIdPollMs: 2, profileIdSettleMs: 200 },
    )
    expect(a.guide).toBe(true)
    const idA = db.get(PROFILE_ID_STATE_KEY)
    // B：第一窗尽（20ms）→ 磁盘有状态 → 收敛窗（100ms）尽仍无身份 →
    // 生成自己的身份并在同次激活内完成迁移（边界形态：换身份重迁）
    const b = await runLegacyThemeMigration(
      makeWindowPorts(wB.memento, dir, 'token-b', () => { guides.push('B') }),
      { profileIdWaitMs: 20, profileIdPollMs: 2, profileIdSettleMs: 100, convergeWatchMs: 100 },
    )
    // 方案 A 后的边界形状：收敛窗尽 → 迁移照做、**本次激活不引导**（临
    // 时身份 pending 留存）；重复引导从「同激活第二弹」变为「下次激活
    // 的恢复补发」——总量仍为 2（平台故障形态的声明残余，见文件头）
    expect(b).toEqual({ action: 'migrate', guide: false })
    expect(guides).toEqual(['A'])
    const idB = db.get(PROFILE_ID_STATE_KEY)
    expect(idB).not.toBe(idA) // 收敛失败 → 换身份（边界形状）
    expect((await markerReader(dir)(String(idB)))?.state).toBe('pending')
    // 旧身份的状态文件原样保留（迟到窗不覆写他身份的磁盘状态）
    expect((await markerReader(dir)(String(idA)))?.state).toBe('done')
    // 等全部广播送达后重开（从 db 读到临时身份 + pending 债务）：恢复
    // 补发一次后收敛，再不增长
    await sleep(700)
    const wC = openWindow()
    const c = await runLegacyThemeMigration(
      makeWindowPorts(wC.memento, dir, 'token-c', () => { guides.push('C') }),
      { profileIdWaitMs: 20, profileIdPollMs: 2, profileIdSettleMs: 100 },
    )
    expect(c).toEqual({ action: 'none', guide: true })
    expect(guides).toEqual(['A', 'C'])
    expect((await markerReader(dir)(String(idB)))?.state).toBe('done')
  })
})

describe('七审 R7-2：他 profile 状态文件不得阻塞本 profile 首次升级迁移', () => {
  it('独立新 profile（缓存新鲜、无广播在途）首次激活在同次激活内完成迁移与引导', async () => {
    const dir = await newDir()
    // profile A：独立 storage，先完成迁移（磁盘留下状态文件）
    const storageA = makeSharedStorage(0)
    const wA = storageA.openWindow()
    wA.memento.update(SETTINGS_STORAGE_KEY, { ...RETIRED_OVERLAY })
    const guides: string[] = []
    await runLegacyThemeMigration(
      makeWindowPorts(wA.memento, dir, 'token-a', () => { guides.push('A') }),
      { profileIdWaitMs: 5, profileIdPollMs: 1, profileIdSettleMs: 30 },
    )
    expect(guides).toEqual(['A'])
    expect(await legacyHasAnyMarkerState(dir)).toBe(true)
    // profile B：全新独立 storage（与 A 无广播互通），首次激活
    const storageB = makeSharedStorage(0)
    const wB = storageB.openWindow()
    wB.memento.update(SETTINGS_STORAGE_KEY, { ...RETIRED_OVERLAY })
    const b = await runLegacyThemeMigration(
      makeWindowPorts(wB.memento, dir, 'token-b', () => { guides.push('B') }),
      { profileIdWaitMs: 5, profileIdPollMs: 1, profileIdSettleMs: 30, convergeWatchMs: 50 },
    )
    // 方案 A（2026-10-17 裁决）：同次激活完成**迁移**（R7 反例：让位 →
    // guides=0、marker=null、overlay 不动），临时身份未定 → 不发引导、
    // pending 债务留存（观察预算尽）
    expect(b).toEqual({ action: 'migrate', guide: false })
    expect(guides).toEqual(['A'])
    const bId = storageB.db.get(PROFILE_ID_STATE_KEY)
    expect(typeof bId).toBe('string')
    expect((await markerReader(dir)(String(bId)))?.state).toBe('pending')
    expect((storageB.db.get(SETTINGS_STORAGE_KEY) as Record<string, unknown>)[APPEARANCE_THEME_KEY])
      .toBe('default')
    // 下次激活（同 profile 缓存已有临时身份）：pending 恢复补发恰一次
    const b2 = await runLegacyThemeMigration(
      makeWindowPorts(wB.memento, dir, 'token-b2', () => { guides.push('B') }), {},
    )
    expect(b2).toEqual({ action: 'none', guide: true })
    expect(guides).toEqual(['A', 'B'])
    expect((await markerReader(dir)(String(bId)))?.state).toBe('done')
  })
})

describe('七审 R7-3：滞后 owner 的异步状态提交不得覆写继任者 done', () => {
  it('A 挂起于 pending 写入链、B 陈旧接管完成 done 后 A 恢复 → 磁盘仍 done、总引导恰 1、再次激活不补发', async () => {
    const dir = await newDir()
    // 共享身份预置（审查方反例同款：A/B 同一 profileId，状态文件同目标）
    const SHARED_ID = 'r7-shared-profile'
    const { openWindow } = makeSharedStorage(500) // 广播远慢于本用例时间线
    const wA = openWindow()
    wA.memento.update(SETTINGS_STORAGE_KEY, { ...RETIRED_OVERLAY })
    wA.memento.update(PROFILE_ID_STATE_KEY, SHARED_ID)
    const wB = openWindow() // 从 db 初始化：同身份、退役残留
    const guides: string[] = []
    const readMarker = markerReader(dir)
    // A 的 writeMarker 整体门控：进入写入链后挂起（审查方反例的异步提交
    // 窗口——writer 内 mkdir/writeFile/rename 链非原子，fence 检查已过）
    let releaseWrite: (() => void) | undefined
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve })
    const portsA = makeWindowPorts(wA.memento, dir, 'token-a', () => { guides.push('A') })
    const realWrite = portsA.writeMarker
    portsA.writeMarker = async (profileId, marker) => {
      await writeGate // A 在写入链前挂起（真实异步窗口，无假时钟）
      await realWrite(profileId, marker)
    }
    // A 启动：持有 gen1、fence 已过、走到 pending 写入链挂起
    const runA = runLegacyThemeMigration(portsA, {
      profileIdWaitMs: 5, profileIdPollMs: 1, lockStaleMs: 150, waitTimeoutMs: 5_000, pollIntervalMs: 10,
    })
    await sleep(80) // A 到达挂起点（gen1 在握、mtime 停在 ~0ms）
    // B 激活：锁新鲜（<150ms）→ 等待环轮询；A 的 gen1 陈旧超阈值后接管
    const b = await runLegacyThemeMigration(
      makeWindowPorts(wB.memento, dir, 'token-b', () => { guides.push('B') }),
      { profileIdWaitMs: 5, profileIdPollMs: 1, lockStaleMs: 150, waitTimeoutMs: 1_000, pollIntervalMs: 20 },
    )
    expect(b).toEqual({ action: 'migrate', guide: true })
    expect(guides).toEqual(['B'])
    expect((await readMarker(SHARED_ID))?.state).toBe('done')
    // A 恢复：迟到的 pending 提交完成（旧实现把 done 覆回 pending）
    releaseWrite?.()
    const a = await runA
    expect(a).toEqual({ action: 'none', guide: false }) // fence 撤退，不引导
    // 磁盘权威状态：读取仍为 done（R7-3 核心断言——迟到提交不改变状态）
    expect((await readMarker(SHARED_ID))?.state).toBe('done')
    // 等全部广播送达后重开：无 pending 欠账，不补发（R7 反例：覆回
    // pending → 补发 → 2 次）
    await sleep(700)
    const wC = openWindow()
    const c = await runLegacyThemeMigration(
      makeWindowPorts(wC.memento, dir, 'token-c', () => { guides.push('C') }),
      { profileIdWaitMs: 5, profileIdPollMs: 1 },
    )
    expect(c).toEqual({ action: 'none', guide: false })
    expect(guides).toEqual(['B'])
  })
})
