// #535 T08 迁移 PR #581 五审 P2-C 契约测试（方案 B'：profile 身份 +
// 按 profileId 命名的磁盘权威状态）。红态场景（对四审尾实现跑红，
// t08-review5-p2c-red.log）：双 profile 反例——1.82.3 的 globalStorageUri
// 恒为默认 profile（跨 profile 共享磁盘目录），固定名状态文件让 profile
// A 的 done 短路 profile B，B 的迁移与引导被永久跳过。B' 修复：状态文件
// 名携带 profile 身份（globalState PROFILE 域持久化、锁内生成、双载体）。
//
// 绿态场景（任务口径；七审 R7 起身份等待分级语义同步改写）：
// - 正常双窗恰 1（同 profile 双窗首启，广播即时镜像）；
// - 延迟在第一窗内恰 1（广播延迟 < 第一窗 → 败者收敛到胜者身份）；
// - 双 profile 各自独立完成迁移与引导（四审反例场景的修复验证；七审
//   R7-2 起他 profile 状态在场时本 profile 收敛窗尽后**同次激活**完成
//   迁移——恰一次）；
// - 广播延迟超出第一窗但在收敛窗内（七审 R7-1）：身份未定窗零写入，
//   收敛窗内收敛 → done 短路，迁移与引导恰一次；重开窗从 db 短路
//   （**不写**「任意延迟下恰 1」断言——广播超收敛窗的残余边界见
//   legacyThemeMigration 文件头七审声明与 legacyThemeMigrationReview7）。
// 整对象存储覆盖语义（1.82.3 ExtensionMemento）由 review7 的
// makeSharedStorage 钉住；本文件的按键镜像夹具只承载身份收敛观测。
import { afterAll, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  LEGACY_THEME_MIGRATION_PROFILE_ID_OVERLAY_KEY,
  runLegacyThemeMigration,
  type LegacyThemeMigrationPorts,
} from '../../src/shared/legacyThemeMigration'
import { legacyHasAnyMarkerState, legacyMarkerIdentitiesOnDisk, makeDiskMarkerStore } from './legacyDiskMarkerStore'
import {
  createLegacyThemeMigrationLock,
  type LegacyThemeMigrationLockHandle,
} from '../../src/shared/legacyThemeMigrationLock'
import {
  SETTINGS_STORAGE_KEY,
  type SettingsStorage,
} from '../../src/host/settingsService'
import { MERMAID_THEME_KEY } from '../../src/shared/settings'

const PROFILE_ID_STATE_KEY = 'vsidian.legacyThemeMigration.profileId'
const LOCK_FILE = 'legacy-theme-migration'

/** 内存 memento（globalState 语义：update 完成后 get 可见新值——同窗口） */
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

/** 互斥「读-判-写」的内存合成（与 review3 测试同款：串行化路径语义等价合成） */
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

/**
 * 跨窗镜像 memento 对（模拟 1.82.3 storage 跨窗广播）：任一侧 update 在
 * delayMs 后镜像到对侧 store（最后写赢）。delayMs = 0 微任务级即时；
 * Infinity = 广播丢失（永不同步——评审方 P2-B 反例同款形态）
 */
function makeMirroredMementos(delayMs: number): {
  A: { memento: SettingsStorage; store: Map<string, unknown> }
  B: { memento: SettingsStorage; store: Map<string, unknown> }
} {
  const storeA = new Map<string, unknown>()
  const storeB = new Map<string, unknown>()
  const mirror = (peer: Map<string, unknown>, key: string, value: unknown) => {
    if (delayMs === Infinity) return
    const apply = () => {
      // 只镜像对侧尚未自行写入的键（对侧自生成身份时不被胜者镜像覆盖）
      if (!peer.has(key)) peer.set(key, value)
    }
    if (delayMs === 0) queueMicrotask(apply)
    else setTimeout(apply, delayMs)
  }
  const mementoOf = (store: Map<string, unknown>, peer: Map<string, unknown>): SettingsStorage => ({
    get: <T>(key: string) => store.get(key) as T | undefined,
    update: (key: string, value: unknown) => {
      store.set(key, value)
      mirror(peer, key, value)
      return Promise.resolve()
    },
  })
  return {
    A: { memento: mementoOf(storeA, storeB), store: storeA },
    B: { memento: mementoOf(storeB, storeA), store: storeB },
  }
}

// ---- 真实 fs（1.82.3 宿主形态：globalStorageUri 跨 profile 共享同一目录） ----

const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'vsidian-legacy-review5-'))
afterAll(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true })
})

let dirSeq = 0
async function newDir(): Promise<string> {
  const dir = path.join(tmpRoot, `case-${++dirSeq}`)
  await fsp.mkdir(dir, { recursive: true })
  return dir
}

const nodeFs = {
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

// 磁盘 marker 夹具六审抽取为共享单一事实源（test/unit/legacyDiskMarkerStore.ts；
// tmp 竞态修复随六审落档）——六审前为本文件本地等价实现

function makeLock(dir: string, token: string): LegacyThemeMigrationLockHandle {
  return createLegacyThemeMigrationLock(nodeFs, path.join(dir, LOCK_FILE), { token, pid: 1000 })
}

/** 身份端口（独立键读写——本测试不预置身份，生成走锁内唯一入口） */
const profileIdPorts = (memento: SettingsStorage) => ({
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
})

function windowPorts(
  memento: SettingsStorage,
  dir: string,
  token: string,
  onGuide: () => void,
): LegacyThemeMigrationPorts {
  const lock = makeLock(dir, token)
  // 状态文件按写入者锁代次分居（七审 R7-3，与生产 wiring 同构）
  const diskMarker = makeDiskMarkerStore(dir, { ownedGeneration: () => lock.getOwnedGeneration() })
  return {
    readRawOverlay: () => memento.get(SETTINGS_STORAGE_KEY),
    applyExclusiveOverlayStep: mementoExclusiveStep(memento),
    ...profileIdPorts(memento),
    ...diskMarker,
    hasAnyMigrationState: () => legacyHasAnyMarkerState(dir),
    extensionVersion: () => '1.2.3-test',
    requestGuide: onGuide,
    lock,
  }
}

/** 迁移夹具：退役预设值形态（裸词非 default） */
const RETIRED_OVERLAY = { [MERMAID_THEME_KEY]: 'retired-preset' }

describe("B'（五审 P2-C）：双 profile 共享 globalStorage 磁盘目录", () => {
  it('profile A 完成迁移后 profile B 激活 → 收敛窗尽后同次激活完成自己的迁移与引导（恰一次）', async () => {
    const dir = await newDir()
    // 双 profile：各自独立 globalState（PROFILE 域隔离，storage 广播亦不互通）
    const profileA = makeMemento()
    const profileB = makeMemento()
    for (const p of [profileA, profileB]) {
      p.store.set(SETTINGS_STORAGE_KEY, RETIRED_OVERLAY)
    }
    const guides = { A: 0, B: 0 }
    // 无镜像（profile 域隔离）；身份等待窗注入小值让分级判定快速到达
    const a = await runLegacyThemeMigration(windowPorts(profileA.memento, dir, 'token-a', () => { guides.A += 1 }), { profileIdWaitMs: 10, profileIdPollMs: 2 })
    expect(a).toEqual({ action: 'migrate', guide: true })
    expect(guides.A).toBe(1)
    const idA = profileA.store.get(PROFILE_ID_STATE_KEY) as string

    // B 首次激活：磁盘已有 A 的迁移状态（身份永不到达 B 的 memento——
    // PROFILE 域隔离）→ 第一窗尽 → 收敛窗尽仍无身份 → 生成自己的身份
    // 并在**同次激活**内完成迁移与引导（七审 R7-2：他 profile 的状态文
    // 件不阻塞本 profile；六审的「让位等下次激活」已按 R7 复审改判）
    const b = await runLegacyThemeMigration(windowPorts(profileB.memento, dir, 'token-b', () => { guides.B += 1 }), { profileIdWaitMs: 10, profileIdPollMs: 2, profileIdSettleMs: 30 })
    expect(b).toEqual({ action: 'migrate', guide: true })
    expect(guides.B).toBe(1) // B 的迁移引导不被 A 的完成状态吞掉，恰一次

    // 两身份各自落盘（共享目录、按身份分文件——数身份数不数文件数：
    // 一身份可有 pending/done 两个代次文件）
    const identities = await legacyMarkerIdentitiesOnDisk(dir)
    expect(identities.length).toBe(2)
    const idB = profileB.store.get(PROFILE_ID_STATE_KEY) as string
    expect(idA).not.toBe(idB) // 双 profile 双身份
    expect((await makeDiskMarkerStore(dir).readMarker(idA))?.state).toBe('done')
    expect((await makeDiskMarkerStore(dir).readMarker(idB))?.state).toBe('done')
  })
})

describe("B'（五审 P2-C）：同 profile 双窗首启（身份生成竞态）", () => {
  it('正常双窗（广播即时镜像）→ 引导恰一次，败者收敛到胜者身份', async () => {
    const dir = await newDir()
    const { A, B } = makeMirroredMementos(0) // 即时广播
    A.store.set(SETTINGS_STORAGE_KEY, RETIRED_OVERLAY)
    B.store.set(SETTINGS_STORAGE_KEY, RETIRED_OVERLAY)
    const guides = { A: 0, B: 0 }
    const [a, b] = await Promise.all([
      runLegacyThemeMigration(windowPorts(A.memento, dir, 'token-a', () => { guides.A += 1 }), { profileIdWaitMs: 200, profileIdPollMs: 10, waitTimeoutMs: 2_000, pollIntervalMs: 10 }),
      runLegacyThemeMigration(windowPorts(B.memento, dir, 'token-b', () => { guides.B += 1 }), { profileIdWaitMs: 200, profileIdPollMs: 10, waitTimeoutMs: 2_000, pollIntervalMs: 10 }),
    ])
    const results = [`${a.action}:${a.guide}`, `${b.action}:${b.guide}`].sort()
    expect(results).toEqual(['migrate:true', 'none:false'])
    expect(guides.A + guides.B).toBe(1) // 恰一次
    // 双窗收敛到同一身份（镜像到达后败者读到胜者身份）
    const idA = A.store.get(PROFILE_ID_STATE_KEY) as string | undefined
    const idB = B.store.get(PROFILE_ID_STATE_KEY) as string | undefined
    expect(idA).toBe(idB)
    expect(idA).toBeTruthy()
  })

  it('广播延迟在身份等待窗内 → 败者等待窗内收敛到胜者身份，引导仍恰一次', async () => {
    const dir = await newDir()
    const { A, B } = makeMirroredMementos(50) // 广播延迟 50ms < 等待窗 300ms
    A.store.set(SETTINGS_STORAGE_KEY, RETIRED_OVERLAY)
    B.store.set(SETTINGS_STORAGE_KEY, RETIRED_OVERLAY)
    const guides = { A: 0, B: 0 }
    const [a, b] = await Promise.all([
      runLegacyThemeMigration(windowPorts(A.memento, dir, 'token-a', () => { guides.A += 1 }), { profileIdWaitMs: 300, profileIdPollMs: 10, waitTimeoutMs: 2_000, pollIntervalMs: 10 }),
      runLegacyThemeMigration(windowPorts(B.memento, dir, 'token-b', () => { guides.B += 1 }), { profileIdWaitMs: 300, profileIdPollMs: 10, waitTimeoutMs: 2_000, pollIntervalMs: 10 }),
    ])
    const results = [`${a.action}:${a.guide}`, `${b.action}:${b.guide}`].sort()
    expect(results).toEqual(['migrate:true', 'none:false'])
    expect(guides.A + guides.B).toBe(1)
    const idA = A.store.get(PROFILE_ID_STATE_KEY) as string | undefined
    const idB = B.store.get(PROFILE_ID_STATE_KEY) as string | undefined
    expect(idA).toBe(idB) // 延迟到达但仍在窗内 → 同一身份（磁盘状态不分裂）
  })

  it('广播延迟超出第一窗但在收敛窗内（七审 R7-1）→ 收敛窗内收敛身份零写入；重开窗从 db 短路；迁移恰一次', async () => {
    const dir = await newDir()
    const { A, B } = makeMirroredMementos(50) // 广播延迟 50ms：第一窗 30ms 外、收敛窗 300ms 内
    A.store.set(SETTINGS_STORAGE_KEY, RETIRED_OVERLAY)
    B.store.set(SETTINGS_STORAGE_KEY, RETIRED_OVERLAY)
    const guides = { A: 0, B: 0 }
    // 顺序激活（A 完成后 B 首启）——B 的第一窗内广播尚未到达
    const a = await runLegacyThemeMigration(windowPorts(A.memento, dir, 'token-a', () => { guides.A += 1 }), { profileIdWaitMs: 30, profileIdPollMs: 5 })
    expect(a).toEqual({ action: 'migrate', guide: true })
    const idA = A.store.get(PROFILE_ID_STATE_KEY) as string
    const b = await runLegacyThemeMigration(windowPorts(B.memento, dir, 'token-b', () => { guides.B += 1 }), { profileIdWaitMs: 30, profileIdPollMs: 5, profileIdSettleMs: 300 })
    // 七审 R7-1：第一窗尽时身份广播在途（磁盘已有 A 的状态）→ 收敛窗内
    // 身份镜像到达 → 收敛为胜者身份 → 磁盘 done 短路——不迁移、不引导、
    // 零写入（红态六审实现：让位写记号 → 过期缓存整对象覆盖 DB → 重开
    // 另造身份二次引导，整对象语义反例见 legacyThemeMigrationReview7）
    expect(b).toEqual({ action: 'none', guide: false })
    expect(guides.A + guides.B).toBe(1)
    // 收敛窗不生成第二身份：磁盘身份仍只有 A 的一个
    expect(await legacyMarkerIdentitiesOnDisk(dir)).toEqual([idA])

    // 「重开」B：新窗口 memento 从 db 初始化（同 profile 共享 db——A 的
    // 身份与迁移后 overlay 已持久化，广播丢失不影响重开窗口的 db 读）→
    // 读到已收敛身份与磁盘 done → 短路，引导计数不再增长（收敛面）
    const restarted = makeMemento()
    restarted.store.set(SETTINGS_STORAGE_KEY, {
      [MERMAID_THEME_KEY]: 'default',
      [LEGACY_THEME_MIGRATION_PROFILE_ID_OVERLAY_KEY]: idA,
    })
    restarted.store.set(PROFILE_ID_STATE_KEY, idA)
    const again = await runLegacyThemeMigration(windowPorts(restarted.memento, dir, 'token-b2', () => { guides.B += 1 }))
    expect(again).toEqual({ action: 'none', guide: false })
    expect(guides.A + guides.B).toBe(1) // 迁移与引导恰一次
  })
})
