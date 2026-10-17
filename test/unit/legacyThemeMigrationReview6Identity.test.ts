// #535 T08 迁移 PR #581 六审 R5-1 契约测试（身份等待超时后不得自造新
// UUID）。红态场景（对五审尾实现跑红，out/test/t08-review6-identity-red.log）：
// R5 复审实测——同一 profile 三个既存缓存窗口、storage 广播延迟 5000ms、
// 错开激活排除锁并发：三窗各在身份等待窗超时后自生成 UUID、各迁移各引
// 导，共 3 次（次数 = 未收到广播的窗口数，「最多多一次」的边界声明不成
// 立）。七审 R7 改判（本文件随改）：六审的「让位 + overlay 记号恢复资
// 格」被 R7-1/R7-2 复审推翻——让位记号写会以旧缓存整对象覆盖 DB（抹掉
// 已持久化身份），且他 profile 状态把本 profile 首迁推到下次激活。现行
// 契约：身份等待分级两窗（第一窗 + 收敛窗），未定窗零写入；收敛窗内
// 收敛（恰 1 次引导）、收敛窗尽后同次激活生成身份完成首迁（他 profile
// 不阻塞）。整对象覆盖语义的 DB 级断言在 legacyThemeMigrationReview7。
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
import {
  legacyHasAnyMarkerState,
  legacyMarkerIdentitiesOnDisk,
  makeDiskMarkerStore,
} from './legacyDiskMarkerStore'
import {
  SETTINGS_STORAGE_KEY,
  type SettingsStorage,
} from '../../src/host/settingsService'
import { MERMAID_THEME_KEY } from '../../src/shared/settings'

const PROFILE_ID_STATE_KEY = 'vsidian.legacyThemeMigration.profileId'
/** 第一窗 30ms / 收敛窗 300ms：配合 60ms 广播延迟构造「第一窗外、收敛窗内」 */
const RUN_OPTS = { profileIdWaitMs: 30, profileIdPollMs: 5, profileIdSettleMs: 300 }
/** 收敛窗尽路径（他 profile 隔离、身份永不到达）：小收敛窗快速到达生成 */
const RUN_OPTS_FAST = { profileIdWaitMs: 30, profileIdPollMs: 5, profileIdSettleMs: 30 }

const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'vsidian-legacy-review6-id-'))
afterAll(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true })
})

let dirSeq = 0
async function newDir(): Promise<string> {
  const dir = path.join(tmpRoot, `case-${++dirSeq}`)
  await fsp.mkdir(dir, { recursive: true })
  return dir
}

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

/** 身份端口（两载体读序同生产；本测试不预置身份，生成/收敛走锁内判定） */
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
  const lock = createLock(dir, token)
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

// ---- 同 profile 共享 db + 延迟广播（1.82.3 storage 语义的收敛观测面；
// 整对象覆盖语义的 DB 级钉住在 legacyThemeMigrationReview7 的
// makeSharedStorage，本 fixture 只需按键到达即足以观测身份收敛） ----
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
          if (other === cache || other.has(key)) continue
          setTimeout(() => { other.set(key, db.get(key)) }, delayMs).unref?.()
        }
        return Promise.resolve()
      },
    }
    return { memento, cache }
  }
  return { db, openWindow }
}

function createLock(dir: string, token: string) {
  // 与其他 review 文件同款的真 fs 锁（本场景错开激活无锁并发，无需门控）
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
  return createLegacyThemeMigrationLock(
    lockFs, path.join(dir, 'legacy-theme-migration'), { token, pid: 1000 })
}

describe('R5-1 → 七审 R7 改判（reviewer 复现链）：同 profile 三窗错开激活、广播延迟超出第一窗', () => {
  it('三窗恰一次引导；未定窗收敛窗内收敛零写入；广播全部送达后从最新 db 重开短路', async () => {
    const dir = await newDir()
    const diskMarker = makeDiskMarkerStore(dir)
    // 广播延迟 60ms：大于第一窗（30ms，未定窗判定时广播未达）、小于收
    // 敛窗（300ms，收敛窗内必达）
    const { db, openWindow } = makeSharedDb(60)
    const w1 = openWindow()
    w1.memento.update(SETTINGS_STORAGE_KEY, { [MERMAID_THEME_KEY]: 'retired-preset' })
    const w2 = openWindow()
    const w3 = openWindow() // 三窗缓存同步初始化（无身份、退役残留）
    let guides = 0
    const portsOf = (w: ReturnType<typeof openWindow>, token: string) =>
      windowPorts(w.memento, dir, token, () => {
        guides += 1
      })

    // 错开激活：前窗完整结束后下窗才开始（排除锁并发——R5 复现同款）
    const r1 = await runLegacyThemeMigration(portsOf(w1, 'token-1'), RUN_OPTS)
    // W1：磁盘全净（无任何迁移状态）→ 首次认领，生成身份并完整迁移
    expect(r1).toEqual({ action: 'migrate', guide: true })
    const id1 = db.get(PROFILE_ID_STATE_KEY) as string
    expect(id1).toBeTruthy()

    // W2：第一窗尽（30ms < 60ms 广播未达）→ 磁盘已有状态 → 收敛窗内
    // 身份广播到达 → 收敛为 W1 身份 → done 短路（零写入）。R5 反例
    // （红态）：各窗自造 UUID 各引导一次（guides=3）；R7-1 红态：让位
    // 记号写以过期缓存整对象覆盖 DB → 重开另造身份二次引导
    const r2 = await runLegacyThemeMigration(portsOf(w2, 'token-2'), RUN_OPTS)
    const r3 = await runLegacyThemeMigration(portsOf(w3, 'token-3'), RUN_OPTS)
    expect(r2).toEqual({ action: 'none', guide: false })
    expect(r3).toEqual({ action: 'none', guide: false })
    expect(guides).toBe(1)
    // 未定窗不生成第二/第三身份（数身份数不数文件数：一身份可有
    // pending/done 两个代次文件）
    expect(await legacyMarkerIdentitiesOnDisk(dir)).toEqual([id1])
    expect((await diskMarker.readMarker(id1))?.state).toBe('done')

    // 等全部广播送达后从最新 db 重开窗 → 读到身份与磁盘 done → 短路，
    // 引导计数不再增长（收敛面）
    await new Promise((resolve) => setTimeout(resolve, 150))
    const w4 = openWindow()
    const r4 = await runLegacyThemeMigration(portsOf(w4, 'token-4'), RUN_OPTS)
    expect(r4).toEqual({ action: 'none', guide: false })
    expect(guides).toBe(1)
  })
})

describe('R5-1 → 七审 R7-2（跨 profile 活性）：全新 profile 在他 profile 已迁移的磁盘上', () => {
  it('首次激活在收敛窗尽后同次激活完成自己的迁移与引导（恰一次）', async () => {
    const dir = await newDir()
    const diskMarker = makeDiskMarkerStore(dir)
    // profile A：磁盘全净，正常完成（A 的迁移状态文件此后在场）
    const profileA = makeMemento()
    profileA.store.set(SETTINGS_STORAGE_KEY, { [MERMAID_THEME_KEY]: 'retired-preset' })
    let guidesA = 0
    let guidesB = 0
    const a = await runLegacyThemeMigration(
      windowPorts(profileA.memento, dir, 'token-a', () => {
        guidesA += 1
      }), RUN_OPTS_FAST)
    expect(a).toEqual({ action: 'migrate', guide: true })
    const idA = profileA.store.get(PROFILE_ID_STATE_KEY) as string

    // profile B：自己的 memento（PROFILE 域隔离，A 的身份永不到达）
    const profileB = makeMemento()
    profileB.store.set(SETTINGS_STORAGE_KEY, { [MERMAID_THEME_KEY]: 'retired-preset' })
    // 首次激活：磁盘已有 A 的迁移状态 → 第一窗尽 → 收敛窗尽仍无身份 →
    // 生成自己的身份并在同次激活内完成迁移与引导（R7-2：他 profile 的
    // 状态不阻塞本 profile——六审「让位等下次激活」已按 R7 复审改判）
    const b = await runLegacyThemeMigration(
      windowPorts(profileB.memento, dir, 'token-b', () => {
        guidesB += 1
      }), RUN_OPTS_FAST)
    expect(b).toEqual({ action: 'migrate', guide: true })
    expect(guidesB).toBe(1)
    const idB = profileB.store.get(PROFILE_ID_STATE_KEY) as string
    expect(idB).not.toBe(idA)
    // 双身份各自落盘（共享目录、按身份分文件——数身份数不数文件数）
    expect((await legacyMarkerIdentitiesOnDisk(dir)).length).toBe(2)
    expect((await diskMarker.readMarker(idA))?.state).toBe('done')
    expect((await diskMarker.readMarker(idB))?.state).toBe('done')
  })
})
