// #535 T08 迁移 PR #581 六审 P2-E 契约测试（锁认领协议闭环）。红态场景
// （对五审尾实现跑红，out/test/t08-review6-lock-red.log）：R4/R5 复审的
// 认领协议双空隙——
// - 空隙 1（普通认领 fail-open）：tryAcquire 以 staleMs:0 步进候选，另一
//   窗口几毫秒前刚创建、认领在途尚未提交指针的新鲜候选被当「陈旧孤儿」
//   越过（场景 2 直接钉住）；
// - 空隙 2（指针校验与推进非原子）：U2 单调性校验的 readPointer 与
//   pushPointer 的 rename 之间可暂停；滞后者恢复后按先前校验把指针写回
//   旧值（实测 2→1 回退），双 owner 并存、guides=['B','A']（场景 1/1b
//   复现 R4 定序反例）。
// 修复（六审）：提交点改 O_EXCL 单调标记族（原子仲裁）+ 普通认领对在途
//   候选 fail-closed + owner 序列副作用前按代次 fencing（见
//   legacyThemeMigrationLock / legacyThemeMigration 文件头六审节）。场景 3
// 钉 fencing：已过提交核验的 owner 在序列中段被更高代次接管后，恢复时
// 不得再发引导。
import { afterAll, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  runLegacyThemeMigration,
  type LegacyThemeMigrationPorts,
} from '../../src/shared/legacyThemeMigration'
import {
  createLegacyThemeMigrationLock,
  parseLegacyThemeMigrationLockInfo,
  type LegacyThemeMigrationLockHandle,
} from '../../src/shared/legacyThemeMigrationLock'
import { LockFsGate, runGated, type LockFsLike } from './legacyLockTestGate'
import { makeDiskMarkerStore } from './legacyDiskMarkerStore'
import { SETTINGS_STORAGE_KEY, type SettingsStorage } from '../../src/host/settingsService'
import { MERMAID_THEME_KEY } from '../../src/shared/settings'

const LOCK_FILE = 'legacy-theme-migration'
const PROFILE_ID = 'review6-profile'

const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'vsidian-legacy-review6-lock-'))
afterAll(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true })
})

let dirSeq = 0
async function newDir(): Promise<string> {
  const dir = path.join(tmpRoot, `case-${++dirSeq}`)
  await fsp.mkdir(dir, { recursive: true })
  return dir
}

const nodeFs: LockFsLike = {
  writeFileExclusive: async (target, data) => {
    const handle = await fsp.open(target, 'wx')
    try {
      await handle.writeFile(data, 'utf8')
    } finally {
      await handle.close()
    }
  },
  rename: (from, to) => fsp.rename(from, to),
  rm: async (target) => {
    await fsp.rm(target, { force: true })
  },
  statMtimeMs: async (target) => {
    try {
      return (await fsp.stat(target)).mtimeMs
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  },
  readFile: (target) => fsp.readFile(target, 'utf8'),
  listDirFiles: (dir) => fsp.readdir(dir),
}

const pointerOf = (dir: string) => path.join(dir, `${LOCK_FILE}.gen`)
const genOf = (dir: string, gen: number) => path.join(dir, `${LOCK_FILE}.${gen}`)
const legacyOf = (dir: string) => path.join(dir, LOCK_FILE)
const identity = (token: string) => ({ token, pid: 1000 })
const lockAt = (dir: string, token: string): LegacyThemeMigrationLockHandle =>
  createLegacyThemeMigrationLock(nodeFs, legacyOf(dir), identity(token))

async function ageFile(file: string, ms: number): Promise<void> {
  const old = new Date(Date.now() - ms)
  await fsp.utimes(file, old, old)
}

async function readPointerRaw(dir: string): Promise<string | null> {
  try {
    return (await fsp.readFile(pointerOf(dir), 'utf8')).trim()
  } catch {
    return null
  }
}

/**
 * 有效代次上界 = max(指针文件内容, O_EXCL 提交标记族 g<n>)——六审绿态的
 * 「指针」判据（标记族只增不回退；指针文件为兼容视图）。红态（无标记
 * 族）退化为指针文件内容——正好呈现回退反例
 */
async function effectiveMax(dir: string): Promise<number> {
  let max = 0
  const raw = await readPointerRaw(dir)
  if (raw !== null && /^\d+$/.test(raw)) max = Math.max(max, Number.parseInt(raw, 10))
  for (const name of await fsp.readdir(dir)) {
    const match = /^legacy-theme-migration\.g(\d+)$/.exec(name)
    if (match !== null) max = Math.max(max, Number.parseInt(match[1], 10))
  }
  return max
}

/** 目录内内容 token 与期望一致的锁文件（协议无关的「活锁在位」断言） */
async function findLockByToken(dir: string, token: string): Promise<string | null> {
  for (const name of await fsp.readdir(dir)) {
    if (!name.startsWith(LOCK_FILE)) continue
    try {
      const info = parseLegacyThemeMigrationLockInfo(await fsp.readFile(path.join(dir, name), 'utf8'))
      if (info?.token === token) return name
    } catch {
      // 非锁文件（指针 / 标记 / tmp）——跳过
    }
  }
  return null
}

// ---- 生产链夹具（同 review3 形态：窗口独立 memento + 共享磁盘 + 真锁） ----

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

/** done 写屏障（写前挂起一次）：模拟「引导已发、收口在途」的暂停窗口 */
interface DoneBarrier {
  entered: Promise<void>
  release(): void
  hangIfFirst(): Promise<void> | null
}

function makeDoneBarrier(): DoneBarrier {
  let releaseFn: (() => void) | undefined
  let markEntered: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    releaseFn = resolve
  })
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve
  })
  let enabled = true
  return {
    entered,
    release: () => releaseFn?.(),
    hangIfFirst: () => {
      if (!enabled) return null
      enabled = false
      markEntered?.()
      markEntered = undefined
      return gate
    },
  }
}

function windowPorts(options: {
  memento: SettingsStorage
  dir: string
  token: string
  onGuide: () => void
  doneBarrier?: DoneBarrier
  gatedFs?: LockFsLike
}): LegacyThemeMigrationPorts {
  const lock = createLegacyThemeMigrationLock(
    options.gatedFs ?? nodeFs,
    legacyOf(options.dir),
    identity(options.token),
  )
  // 状态文件按写入者锁代次分居（七审 R7-3，与生产 wiring 同构）
  const diskMarker = makeDiskMarkerStore(options.dir, {
    ownedGeneration: () => lock.getOwnedGeneration(),
  })
  const barrier = options.doneBarrier
  return {
    readRawOverlay: () => options.memento.get(SETTINGS_STORAGE_KEY),
    applyExclusiveOverlayStep: mementoExclusiveStep(options.memento),
    readProfileId: async () => PROFILE_ID,
    writeProfileId: async () => {},
    // 固定预置身份——六审 R5-1 的等待/让位判定不可达，桩值即可
    hasAnyMigrationState: async () => false,
    readMarker: diskMarker.readMarker,
    writeMarker: async (profileId, marker) => {
      const hang = barrier?.hangIfFirst()
      if (hang !== null && hang !== undefined) await hang
      await diskMarker.writeMarker(profileId, marker)
    },
    extensionVersion: () => '1.2.3-test',
    requestGuide: options.onGuide,
    lock,
  }
}

// ---- 场景 1（协议级，R4 定序反例） ----

describe('六审 P2-E 场景 1（协议级，R4 定序反例）：A 于 U2 读取后暂停 → B 完整认领代次 2 → A 恢复提交', () => {
  it('指针终值 ≥2 不回退；A 撤退非 owner；B 独持代次 2', async () => {
    const dir = await newDir()
    const gate = new LockFsGate()
    const a = createLegacyThemeMigrationLock(gate.wrap(nodeFs), legacyOf(dir), identity('token-a'))
    const b = lockAt(dir, 'token-b')
    let wfeSeen = 0
    let directed = false
    let bTry: boolean | undefined
    let bTook: boolean | undefined
    const aResult = await runGated(
      gate,
      () => a.tryAcquire(),
      async (_index, op) => {
        if (op === 'writeFileExclusive') wfeSeen += 1
        // 锚点 = A 的第二次 writeFileExclusive：红态为指针 tmp 写（U2 已用
        // 旧读数通过、rename 未发），绿态为提交标记 g1 的 O_EXCL 创建（原
        // 子仲裁已发生、提交后核验未发）——两态同锚，世界在此前进
        if (wfeSeen >= 2 && !directed) {
          directed = true
          bTry = await b.tryAcquire()
          if (bTry !== true) {
            // 绿态：普通认领对在途新候选 fail-closed → 模拟 A 滞缓（候选
            // 陈旧超阈值）→ B 以陈旧接管完成代次 2 认领（合法路径）
            await ageFile(genOf(dir, 1), 60_000)
            bTook = await b.takeoverIfStale(10_000)
          }
        }
      },
    )
    // 指针终值 ≥2：红态 A 恢复把指针写回 1（空隙 2 的回退反例）
    expect(await effectiveMax(dir)).toBeGreaterThanOrEqual(2)
    expect(bTry === true || bTook === true).toBe(true)
    // 双 owner 不成立：A 必须撤退（红态返回 true）
    expect(aResult).toBe(false)
    expect(await findLockByToken(dir, 'token-a')).toBeNull()
    // B 独持代次 2（红态 A 把指针拉回后第三窗还能再获锁的级联不再成立）
    expect(await findLockByToken(dir, 'token-b')).not.toBeNull()
  })
})

// ---- 场景 2（协议级，空隙 1） ----

describe('六审 P2-E 场景 2（协议级）：B 候选已建未提交（新鲜）时 A 的普通 tryAcquire', () => {
  it('必须 fail-closed 返回 false，不得越过在途候选', async () => {
    const dir = await newDir()
    const gate = new LockFsGate()
    const b = createLegacyThemeMigrationLock(gate.wrap(nodeFs), legacyOf(dir), identity('token-b'))
    const a = lockAt(dir, 'token-a')
    let held = false
    let aTry: boolean | undefined
    const bResult = await runGated(
      gate,
      () => b.tryAcquire(),
      async (_index, op) => {
        if (op === 'writeFileExclusive' && !held) {
          // B 刚创建自己的候选 gen 文件（认领在途、提交未发）。隔 25ms 再
          // 试 A（对齐 R4 实测的「约 24ms 后」——红态下 `now()-mtime > 0`
          // 必然成立，排除同毫秒侥幸判新鲜的不确定性）
          held = true
          await new Promise((resolve) => setTimeout(resolve, 25))
          aTry = await a.tryAcquire()
        }
      },
    )
    expect(aTry).toBe(false) // 红态：0ms 越过新鲜候选返回 true
    expect(bResult).toBe(true) // 放行后 B 完整认领自己的代次
    expect(await nodeFs.statMtimeMs(genOf(dir, 2))).toBeNull() // A 未曾越至代次 2
    expect(await readPointerRaw(dir)).toBe('1')
  })
})

// ---- 场景 1b（生产链，R4 反例接入 runLegacyThemeMigration） ----

describe('六审 P2-E 场景 1b（生产链）：同一 profileId 双窗，A 于认领提交前暂停、B 完整激活', () => {
  it('guides 恰 1（红态 2）、指针终值 ≥2、done 收口', async () => {
    const dir = await newDir()
    const diskMarker = makeDiskMarkerStore(dir)
    const windowA = makeMemento()
    const windowB = makeMemento()
    for (const w of [windowA, windowB]) {
      w.store.set(SETTINGS_STORAGE_KEY, RETIRED_OVERLAY)
    }
    const guides = { A: 0, B: 0 }
    const barrier = makeDoneBarrier()
    const gate = new LockFsGate()
    const portsA = windowPorts({
      memento: windowA.memento, dir, token: 'token-a',
      onGuide: () => {
        guides.A += 1
      },
      gatedFs: gate.wrap(nodeFs),
    })
    const portsB = windowPorts({
      memento: windowB.memento, dir, token: 'token-b',
      onGuide: () => {
        guides.B += 1
      },
      doneBarrier: barrier,
    })
    const bRuns: Promise<{ action: string; guide: boolean }>[] = []
    let wfeSeen = 0
    let directed = false
    const a = await runGated(
      gate,
      () => runLegacyThemeMigration(portsA, { waitTimeoutMs: 400, pollIntervalMs: 10 }),
      async (_index, op) => {
        if (op === 'writeFileExclusive') wfeSeen += 1
        if (wfeSeen >= 2 && !directed) {
          directed = true
          // B 第一次完整激活（短等待窗）：红态 B 的 tryAcquire 以 0ms 越过
          // A 的新鲜候选 → 引导后挂起于 done 写屏障；绿态 fail-closed →
          // 等待环超时静默退出（none）
          const first = runLegacyThemeMigration(portsB, { waitTimeoutMs: 200, pollIntervalMs: 10 })
          bRuns.push(first)
          const firstHung = await Promise.race([
            first.then(() => false),
            barrier.entered.then(() => true),
          ])
          if (!firstHung) {
            // 绿态：模拟 A 滞缓（候选陈旧超阈值）→ B 二次激活以陈旧接管
            // 认领（引导后挂起于 done 屏障前——A 恢复时 B 收口在途）
            await ageFile(genOf(dir, 1), 60_000)
            const second = runLegacyThemeMigration(portsB, { waitTimeoutMs: 200, pollIntervalMs: 10 })
            bRuns.push(second)
            await Promise.race([
              second.then(() => false),
              barrier.entered.then(() => true),
            ])
          }
        }
      },
    )
    barrier.release()
    await Promise.all(bRuns)
    expect(guides.A + guides.B).toBe(1) // 红态：A/B 双 owner 各引导一次（guides=2）
    expect(await effectiveMax(dir)).toBeGreaterThanOrEqual(2) // 红态：指针被写回 1
    expect((await diskMarker.readMarker(PROFILE_ID))?.state).toBe('done')
    expect(a).toEqual({ action: 'none', guide: false })
  })
})

// ---- 场景 3（生产链，方向 B fencing） ----

describe('六审 P2-E 场景 3（生产链，方向 B）：A 已过提交核验、挂起于 owner 序列 → B 陈旧接管收口在途 → A 恢复', () => {
  it('A 不再发引导（红态 guides=2）：fence 拦截滞后 owner 的副作用', async () => {
    const dir = await newDir()
    const diskMarker = makeDiskMarkerStore(dir)
    const windowA = makeMemento()
    const windowB = makeMemento()
    for (const w of [windowA, windowB]) {
      w.store.set(SETTINGS_STORAGE_KEY, RETIRED_OVERLAY)
    }
    const guides = { A: 0, B: 0 }
    const barrier = makeDoneBarrier()
    const gate = new LockFsGate()
    const portsA = windowPorts({
      memento: windowA.memento, dir, token: 'token-a',
      onGuide: () => {
        guides.A += 1
      },
      gatedFs: gate.wrap(nodeFs),
    })
    const portsB = windowPorts({
      memento: windowB.memento, dir, token: 'token-b',
      onGuide: () => {
        guides.B += 1
      },
      doneBarrier: barrier,
    })
    const bRuns: Promise<{ action: string; guide: boolean }>[] = []
    let directed = false
    const a = await runGated(
      gate,
      () => runLegacyThemeMigration(portsA, { waitTimeoutMs: 400, pollIntervalMs: 10 }),
      async (_index, op) => {
        // 锚点 = A 的首次 rename：红态为指针推进 rename（认领即将成功返
        // 回 true），绿态为提交且核验通过后的指针兼容视图写——两态均为
        // 「认领已成立、owner 序列副作用未发」
        if (op === 'rename' && !directed) {
          directed = true
          // 模拟 A 在 owner 序列中段滞缓超阈值：代次文件陈旧 → B 接管并
          // 完整收口（引导后挂起于 done 写前）
          await ageFile(genOf(dir, 1), 60_000)
          const bRun = runLegacyThemeMigration(portsB, { waitTimeoutMs: 200, pollIntervalMs: 10 })
          bRuns.push(bRun)
          await Promise.race([
            bRun.then(() => false),
            barrier.entered.then(() => true),
          ])
        }
      },
    )
    barrier.release()
    await Promise.all(bRuns)
    expect(guides.A + guides.B).toBe(1) // 红态：B 引导后 A 恢复又补发一次（2）
    expect(a).toEqual({ action: 'none', guide: false }) // 红态：A 以 owner 身份补发引导
    expect((await diskMarker.readMarker(PROFILE_ID))?.state).toBe('done')
    expect(await effectiveMax(dir)).toBeGreaterThanOrEqual(2)
  })
})
