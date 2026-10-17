// #535 T08 迁移 PR #581 六审 R5-1 契约测试（身份等待超时后不得自造新
// UUID）。红态场景（对五审尾实现跑红，out/test/t08-review6-identity-red.log）：
// R5 复审实测——同一 profile 三个既存缓存窗口、storage 广播延迟 5000ms、
// 错开激活排除锁并发：三窗各在身份等待窗超时后自生成 UUID、各迁移各引
// 导，共 3 次（次数 = 未收到广播的窗口数，「最多多一次」的边界声明不成
// 立）。六审修复（失败关闭）：超时后不再自生成——磁盘上已有任一迁移状
// 态文件即让位（不迁移、不引导、不写迁移状态），下次激活 memento 从 db
// 初始化读到已收敛身份后短路；全新 profile 经 overlay 让位记号在下次激
// 活恢复生成资格（跨 profile 活性不回退，五审 P2-C 修复面保持）。
// 广播延迟 5000ms 在「错开激活、前窗完整结束后下窗才开始」的时间线内，
// 与测试视界内的广播丢失等价（下窗的判定发生在广播到达之前）。
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
import { makeDiskMarkerStore, legacyHasAnyMarkerState } from './legacyDiskMarkerStore'
import {
  SETTINGS_STORAGE_KEY,
  type SettingsStorage,
} from '../../src/host/settingsService'
import { MERMAID_THEME_KEY, APPEARANCE_THEME_KEY } from '../../src/shared/settings'

const PROFILE_ID_STATE_KEY = 'vsidian.legacyThemeMigration.profileId'
const RUN_OPTS = { profileIdWaitMs: 30, profileIdPollMs: 5 }

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

const RETIRED_OVERLAY = { [MERMAID_THEME_KEY]: 'retired-preset' }

/** 身份端口（两载体读序同生产；本测试不预置身份，生成/让位走锁内判定） */
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
  const diskMarker = makeDiskMarkerStore(dir)
  return {
    readRawOverlay: () => memento.get(SETTINGS_STORAGE_KEY),
    applyExclusiveOverlayStep: mementoExclusiveStep(memento),
    ...profileIdPorts(memento),
    ...diskMarker,
    hasAnyMigrationState: () => legacyHasAnyMarkerState(dir),
    extensionVersion: () => '1.2.3-test',
    requestGuide: onGuide,
    lock: createLock(dir, token),
  }
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

describe('六审 R5-1（reviewer 复现）：同 profile 三窗错开激活、广播延迟超出等待窗', () => {
  it('三窗恰一次引导；让位窗不生成身份不写迁移状态；重开窗从 db 收敛短路', async () => {
    const dir = await newDir()
    const diskMarker = makeDiskMarkerStore(dir)
    const w1 = makeMemento()
    const w2 = makeMemento()
    const w3 = makeMemento()
    for (const w of [w1, w2, w3]) {
      w.store.set(SETTINGS_STORAGE_KEY, { ...RETIRED_OVERLAY })
    }
    let guides = 0
    const portsOf = (w: ReturnType<typeof makeMemento>, token: string) =>
      windowPorts(w.memento, dir, token, () => {
        guides += 1
      })

    // 错开激活：前窗完整结束后下窗才开始（排除锁并发——R5 复现同款）
    const r1 = await runLegacyThemeMigration(portsOf(w1, 'token-1'), RUN_OPTS)
    // W1：磁盘全净（无任何迁移状态）→ 首次认领，生成身份并完整迁移（红绿一致）
    expect(r1).toEqual({ action: 'migrate', guide: true })
    const id1 = w1.store.get(PROFILE_ID_STATE_KEY) as string
    expect(id1).toBeTruthy()

    const r2 = await runLegacyThemeMigration(portsOf(w2, 'token-2'), RUN_OPTS)
    const r3 = await runLegacyThemeMigration(portsOf(w3, 'token-3'), RUN_OPTS)
    // R5 反例（红态）：W2/W3 各自生成 UUID、各迁移各引导（guides=3）。
    // 六审：身份未达 + 磁盘已有迁移状态 → 让位（不迁移、不引导、不写状态）
    expect(r2).toEqual({ action: 'none', guide: false })
    expect(r3).toEqual({ action: 'none', guide: false })
    expect(guides).toBe(1)
    // 让位窗不生成第二/第三身份：磁盘状态文件仍只有 W1 的身份一份
    const stateFiles = (await fsp.readdir(dir)).filter((n) => n.endsWith('.state.json'))
    expect(stateFiles.length).toBe(1)
    expect((await diskMarker.readMarker(id1))?.state).toBe('done')

    // 重开窗（memento 从 db 初始化：读到 W1 的身份与迁移后 overlay）→
    // 短路，引导计数不再增长
    const reopened = makeMemento()
    reopened.store.set(SETTINGS_STORAGE_KEY, {
      [APPEARANCE_THEME_KEY]: 'default',
      [MERMAID_THEME_KEY]: 'default',
      [LEGACY_THEME_MIGRATION_PROFILE_ID_OVERLAY_KEY]: id1,
    })
    reopened.store.set(PROFILE_ID_STATE_KEY, id1)
    const r4 = await runLegacyThemeMigration(portsOf(reopened, 'token-4'), RUN_OPTS)
    expect(r4).toEqual({ action: 'none', guide: false })
    expect(guides).toBe(1)
  })
})

describe('六审 R5-1（跨 profile 活性）：全新 profile 在他 profile 已迁移的磁盘上', () => {
  it('首次激活让位（不吞迁移），下次激活生成身份完成自己的迁移与引导（恰一次）', async () => {
    const dir = await newDir()
    const diskMarker = makeDiskMarkerStore(dir)
    // profile A：磁盘全净，正常完成（A 的迁移状态文件此后在场）
    const profileA = makeMemento()
    profileA.store.set(SETTINGS_STORAGE_KEY, { ...RETIRED_OVERLAY })
    let guidesA = 0
    let guidesB = 0
    const a = await runLegacyThemeMigration(
      windowPorts(profileA.memento, dir, 'token-a', () => {
        guidesA += 1
      }), RUN_OPTS)
    expect(a).toEqual({ action: 'migrate', guide: true })
    const idA = profileA.store.get(PROFILE_ID_STATE_KEY) as string

    // profile B：自己的 memento（PROFILE 域隔离，A 的身份永不到达）
    const profileB = makeMemento()
    profileB.store.set(SETTINGS_STORAGE_KEY, { ...RETIRED_OVERLAY })
    const bPorts = () =>
      windowPorts(profileB.memento, dir, 'token-b', () => {
        guidesB += 1
      })
    // 首次激活：磁盘已有 A 的迁移状态 → 让位（红态：立即生成并迁移引导）
    const b1 = await runLegacyThemeMigration(bPorts(), RUN_OPTS)
    expect(b1).toEqual({ action: 'none', guide: false })
    expect(guidesB).toBe(0)
    // 下次激活：B 读到自己的让位记号（overlay，同 profile 域）→ 恢复生成
    // 资格，完成自己的迁移与引导（跨 profile 活性不回退——五审 P2-C 面）
    const b2 = await runLegacyThemeMigration(bPorts(), RUN_OPTS)
    expect(b2).toEqual({ action: 'migrate', guide: true })
    expect(guidesB).toBe(1)
    const idB = profileB.store.get(PROFILE_ID_STATE_KEY) as string
    expect(idB).not.toBe(idA)
    // 双身份各自落盘（共享目录、按身份分文件）
    const stateFiles = (await fsp.readdir(dir)).filter((n) => n.endsWith('.state.json'))
    expect(stateFiles.length).toBe(2)
    expect((await diskMarker.readMarker(idA))?.state).toBe('done')
    expect((await diskMarker.readMarker(idB))?.state).toBe('done')
  })
})
