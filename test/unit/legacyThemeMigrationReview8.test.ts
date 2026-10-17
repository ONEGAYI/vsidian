// #535 T08 迁移 PR #581 八审 R8 契约测试。两项 P2 的反例形态（红态对
// 七审尾实现跑，out/test/t08-review8-red.log）：
//
// R8-2（正常身份等待长于锁租期）：他 profile 的 done 在场时，本 profile
// 的身份等待长达第一窗+收敛窗（默认 1+10s），而锁陈旧阈值默认 10s——
// 并发启动的他 profile 窗口会在等待中段按「陈旧」接管，等待者随后被
// fence 静默退出，本 profile 本次激活迁移被跳过（需再激活恢复）。断言：
// owner 在合法等待期间不被判失效（等待期锁心跳），双 profile 并发各恰
// 一次迁移与引导。
//
// R8-3（O_EXCL 先发布文件名后写内容）：open(wx) 先暴露正式文件名再写
// JSON——写入失败/中断留下的空/残缺**高代**文件遮蔽低代有效 pending，
// reader 按最高代取值解析失败返回 null，引导欠账丢失（连续恢复均不引
// 导）。断言：不完整高代写入不得消除有效 pending 债务（读取降级回退
// 到可解析的次高代）；正常写入以 tmp+rename 原子发布完整内容（最终名
// 上不存在「先创建后填充」窗口），发布失败不在最终名留残缺文件。
//
// R8-1（有限广播延迟仍生成第二身份重复引导）为规格裁决项：平台无双
// 满足通道（globalState 按 profile 隔离但跨窗广播有限延迟、无事件订阅；
// 磁盘即时但跨 profile 共享），「等待超时」与「他 profile 无身份」在
// 有限时间内不可区分——本轮回执提出方案提请裁决，不在本文件钉契约。
import { afterAll, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  runLegacyThemeMigration,
  type LegacyThemeMigrationPorts,
} from '../../src/shared/legacyThemeMigration'
import { createLegacyThemeMigrationLock } from '../../src/shared/legacyThemeMigrationLock'
import { makeDiskMarkerStore } from './legacyDiskMarkerStore'
import {
  SETTINGS_STORAGE_KEY,
  type SettingsStorage,
} from '../../src/host/settingsService'
import { MERMAID_THEME_KEY, APPEARANCE_THEME_KEY } from '../../src/shared/settings'

const PROFILE_ID_STATE_KEY = 'vsidian.legacyThemeMigration.profileId'

const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'vsidian-legacy-review8-'))
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

/** 独立 profile 的内存 memento（PROFILE 域隔离：跨 profile 无广播互通） */
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

const RETIRED_OVERLAY = { [MERMAID_THEME_KEY]: 'retired-preset' }

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

describe('八审 R8-2：合法身份等待期间 owner 不被陈旧接管逐出', () => {
  it('双 profile 并发（B 长等待持锁、C 稍后启动）→ B/C 各恰一次迁移引导，B 不被 fence 退出', async () => {
    const dir = await newDir()
    const guides: string[] = []
    // profile A 先完成（磁盘留下他 profile 的 done——B 的收敛窗因此触发）
    const a = makeMemento()
    a.memento.update(SETTINGS_STORAGE_KEY, { ...RETIRED_OVERLAY })
    await runLegacyThemeMigration(
      makeWindowPorts(a.memento, dir, 'token-a', () => { guides.push('A') }),
      { profileIdWaitMs: 30, profileIdPollMs: 5 },
    )
    expect(guides).toEqual(['A'])
    // profile B：第一窗 150ms → 收敛窗 900ms（无身份到达）→ 生成并迁移，
    // 全程持锁 ~1050ms；锁陈旧阈值 300ms——无心跳时 C 会在 ~300ms 接管
    const b = makeMemento()
    b.memento.update(SETTINGS_STORAGE_KEY, { ...RETIRED_OVERLAY })
    const runB = runLegacyThemeMigration(
      makeWindowPorts(b.memento, dir, 'token-b', () => { guides.push('B') }),
      { profileIdWaitMs: 150, profileIdPollMs: 25, profileIdSettleMs: 900, lockStaleMs: 300, waitTimeoutMs: 5_000, pollIntervalMs: 25, convergeWatchMs: 100 },
    )
    await sleep(250) // B 进入收敛窗等待（锁在握、mtime 停留在认领时刻）
    // profile C：独立 profile，同需迁移；等待环内按陈旧阈值尝试接管
    const c = makeMemento()
    c.memento.update(SETTINGS_STORAGE_KEY, { ...RETIRED_OVERLAY })
    const runC = runLegacyThemeMigration(
      makeWindowPorts(c.memento, dir, 'token-c', () => { guides.push('C') }),
      { profileIdWaitMs: 150, profileIdPollMs: 25, profileIdSettleMs: 900, lockStaleMs: 300, waitTimeoutMs: 1_500, pollIntervalMs: 25, convergeWatchMs: 100 },
    )
    const [bResult, cResult] = await Promise.all([runB, runC])
    // R8 反例（红态）：C 在 ~300ms 以陈旧接管夺取 gen2，B 在 ~1050ms 生成
    // 身份后被 fence 静默退出（none）——B 的本次迁移被跳过。绿态（心跳）：
    // B/C 首次激活都完成**迁移**（方案 A：临时身份未定 → 不发引导）
    expect(bResult).toEqual({ action: 'migrate', guide: false })
    expect(cResult).toEqual({ action: 'migrate', guide: false })
    expect(guides).toEqual(['A'])
    // 下次激活各按 pending 恢复补发恰一次（B 不被逐出 = 迁移已在本激
    // 活落盘，第二激活只是还引导欠账）
    const b2 = await runLegacyThemeMigration(
      makeWindowPorts(b.memento, dir, 'token-b2', () => { guides.push('B') }), {})
    const c2 = await runLegacyThemeMigration(
      makeWindowPorts(c.memento, dir, 'token-c2', () => { guides.push('C') }), {})
    expect(b2).toEqual({ action: 'none', guide: true })
    expect(c2).toEqual({ action: 'none', guide: true })
    // 双 profile 各恰一次（C 在 B 释放后经等待环接管完成自己的迁移）
    expect(guides).toEqual(['A', 'B', 'C'])
    const bOverlay = b.memento.get<Record<string, unknown>>(SETTINGS_STORAGE_KEY)
    expect(bOverlay?.[APPEARANCE_THEME_KEY]).toBe('default')
    const cOverlay = c.memento.get<Record<string, unknown>>(SETTINGS_STORAGE_KEY)
    expect(cOverlay?.[APPEARANCE_THEME_KEY]).toBe('default')
    const readMarker = makeDiskMarkerStore(dir).readMarker
    expect((await readMarker(String(b.store.get(PROFILE_ID_STATE_KEY))))?.state).toBe('done')
    expect((await readMarker(String(c.store.get(PROFILE_ID_STATE_KEY))))?.state).toBe('done')
  })
})

describe('八审 R8-3：不完整高代写入不得消除有效 pending 债务', () => {
  it('空 p2（最高代）+ 有效 p1 → 读取回退到 p1 的 pending（红态：null）', async () => {
    const dir = await newDir()
    const profileId = 'r8-recovery-profile'
    await fsp.writeFile(path.join(dir, `legacy-theme-migration.${profileId}.p1.json`),
      JSON.stringify({ state: 'pending', version: '1.2.3-test' }), 'utf8')
    await fsp.writeFile(path.join(dir, `legacy-theme-migration.${profileId}.p2.json`), '', 'utf8')
    expect((await makeDiskMarkerStore(dir).readMarker(profileId))?.state).toBe('pending')
  })

  it('空 d3 + 有效 p1 → 回退到 p1 的 pending（done 残缺不吞引导欠账）', async () => {
    const dir = await newDir()
    const profileId = 'r8-recovery-profile'
    await fsp.writeFile(path.join(dir, `legacy-theme-migration.${profileId}.p1.json`),
      JSON.stringify({ state: 'pending', version: '1.2.3-test' }), 'utf8')
    await fsp.writeFile(path.join(dir, `legacy-theme-migration.${profileId}.d3.json`), '{broken', 'utf8')
    expect((await makeDiskMarkerStore(dir).readMarker(profileId))?.state).toBe('pending')
  })
})

describe('八审 R8-3：原子发布（绿态钉住——红态不可注入，写入器形态随修复更替）', () => {
  it('正常写入后目录无 tmp 残留；同（身份,状态,代次）重发布幂等不抛错', async () => {
    const dir = await newDir()
    const profileId = 'r8-atomic-profile'
    const store = makeDiskMarkerStore(dir, { ownedGeneration: async () => 2 })
    await store.writeMarker(profileId, { state: 'pending', version: '1.2.3-test' })
    await store.writeMarker(profileId, { state: 'done', version: '1.2.3-test' })
    // 幂等重发布：done 已在最终名——按发布完成处理，不覆盖不抛错
    await store.writeMarker(profileId, { state: 'done', version: '1.2.3-test' })
    const names = await fsp.readdir(dir)
    expect(names.some((n) => n.endsWith('.tmp'))).toBe(false)
    expect(names).toContain('legacy-theme-migration.r8-atomic-profile.d2.json')
    expect((await store.readMarker(profileId))?.state).toBe('done')
  })

  it('发布 rename 失败 → 不在最终名留任何文件（残缺只可能落在 tmp，读取不受影响）', async () => {
    const dir = await newDir()
    const profileId = 'r8-fault-profile'
    // 先落一份有效低代 pending（rename 故障下的在读状态）
    const seedStore = makeDiskMarkerStore(dir, { ownedGeneration: async () => 1 })
    await seedStore.writeMarker(profileId, { state: 'pending', version: '1.2.3-test' })
    // 高代发布：rename 注入失败——最终名 d2 不得存在（旧 O_EXCL 形态会在
    // 最终名留下空文件并遮蔽 p1 债务）
    const failingFs = {
      readdir: (d: string) => fsp.readdir(d),
      readFile: (p: string) => fsp.readFile(p, 'utf8'),
      writeFile: (p: string, data: string) => fsp.writeFile(p, data, 'utf8'),
      rename: async () => {
        throw new Error('injected rename failure')
      },
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
    const faultStore = makeDiskMarkerStore(dir, {
      ownedGeneration: async () => 2,
      fs: failingFs,
    })
    await expect(faultStore.writeMarker(profileId, { state: 'done', version: '1.2.3-test' }))
      .rejects.toThrow('injected rename failure')
    expect(await fsp.stat(path.join(dir, 'legacy-theme-migration.r8-fault-profile.d2.json'))
      .then(() => true, () => false)).toBe(false)
    // 低代有效 pending 不受影响（欠账不丢）
    expect((await makeDiskMarkerStore(dir).readMarker(profileId))?.state).toBe('pending')
  })
})

describe('八审 R8-3：锁 keepalive（等待期心跳）', () => {
  it('owner 等待期 keepalive 刷新 mtime → 阈值内接管被拒；心跳停止超阈值后接管放行', async () => {
    const dir = await newDir()
    let now = 1_000
    const clock = () => now
    const owner = createLegacyThemeMigrationLock(
      nodeLockFs, path.join(dir, 'legacy-theme-migration'), { token: 'owner', pid: 1 }, clock)
    const rival = createLegacyThemeMigrationLock(
      nodeLockFs, path.join(dir, 'legacy-theme-migration'), { token: 'rival', pid: 2 }, clock)
    expect(await owner.tryAcquire()).toBe(true)
    // 等待期心跳：mtime 推进到当前时钟——陈旧判定按「距上次心跳」而非
    // 「距认领」计算
    now = 1_200
    await owner.keepalive()
    now = 1_300
    expect(await rival.takeoverIfStale(500)).toBe(false) // 距心跳 100ms：新鲜
    now = 1_900
    await owner.keepalive()
    now = 2_100
    expect(await rival.takeoverIfStale(500)).toBe(false) // 距心跳 200ms：新鲜
    // 心跳停止（owner 死亡/挂起）：距最后心跳 600ms > 500 → 接管放行
    now = 2_500
    expect(await rival.takeoverIfStale(500)).toBe(true)
  })
})
