// #535 T08 迁移锁协议契约测试（PR #581 四审 P2-D：代次锁/fencing）：
// 真实文件系统（os.tmpdir 临时目录 + fs.open 'wx'/rename/rm/utimes）钉
// 住 codexMigrationLock 的认领/接管/释放不变量，并以受控调度（每个 fs
// 原语边界注入第三方认领尝试，见 codexLockTestGate）复现评审方四审实测
// 的双调度反例——「接管先 rename 候选再核验：rename 把 A 的活锁从公开
// 路径移走，恢复前 C 可 open('wx') 成功 → 双 owner」「释放先 rename 后
// 核验 token 的同型空隙」。两个调度在旧协议（三审实现）上必须红（红证
// 据 out/test/t08-review4-red.log），代次锁协议上全绿。
import { afterAll, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  createCodexMigrationLock,
  parseCodexMigrationLockInfo,
  type CodexMigrationLockHandle,
} from '../../src/shared/codexMigrationLock'
import { LockFsGate, runGated, type LockFsLike } from './codexLockTestGate'

const LOCK_BASE = 'codex-theme-migration.lock'

const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'vsidian-codex-lock4-'))
afterAll(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true })
})

let dirSeq = 0
async function newDir(): Promise<string> {
  const dir = path.join(tmpRoot, `case-${++dirSeq}`)
  await fsp.mkdir(dir, { recursive: true })
  return dir
}

/**
 * 与 wiring 同族的真实 fs 端口。含两代协议原语并集（link 仅旧协议使用，
 * listDirFiles 仅代次锁使用）——红态与绿态共用同一测试体
 */
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
  link: (from, to) => fsp.link(from, to),
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

const pointerOf = (dir: string) => path.join(dir, `${LOCK_BASE}.gen`)
const genOf = (dir: string, gen: number) => path.join(dir, `${LOCK_BASE}.${gen}`)
const legacyOf = (dir: string) => path.join(dir, LOCK_BASE)
const identity = (token: string) => ({ token, pid: 1000 })

async function ageFile(file: string, ms: number): Promise<void> {
  const old = new Date(Date.now() - ms)
  await fsp.utimes(file, old, old)
}

interface SeedOptions {
  /** 指针初始代次（缺省 = 指针文件不存在，引导态） */
  pointer?: number
  /** 预置陈旧代次文件（mtime 回拨 60s，模拟崩溃残留 / 提交窗孤儿） */
  staleGens?: number[]
  /** 预置新鲜代次文件（模拟在位 owner） */
  freshGens?: number[]
  /** 预置旧协议形态的锁文件（红态脚本兼容） */
  legacy?: 'stale' | 'fresh'
}

async function seedDir(options: SeedOptions): Promise<string> {
  const dir = await newDir()
  if (options.pointer !== undefined) {
    await fsp.writeFile(pointerOf(dir), String(options.pointer), 'utf8')
  }
  for (const gen of options.staleGens ?? []) {
    const file = genOf(dir, gen)
    await fsp.writeFile(file, JSON.stringify({
      token: `stale-${gen}`, pid: 4242, createdAt: Date.now() - 60_000, gen,
    }), 'utf8')
    await ageFile(file, 60_000)
  }
  for (const gen of options.freshGens ?? []) {
    await fsp.writeFile(genOf(dir, gen), JSON.stringify({
      token: `live-${gen}`, pid: 4242, createdAt: Date.now(), gen,
    }), 'utf8')
  }
  if (options.legacy) {
    const file = legacyOf(dir)
    await fsp.writeFile(file, JSON.stringify({
      token: 'legacy-owner', pid: 4242, createdAt: Date.now() - 60_000,
    }), 'utf8')
    if (options.legacy === 'stale') await ageFile(file, 60_000)
  }
  return dir
}

async function readPointerRaw(dir: string): Promise<string | null> {
  try {
    return (await fsp.readFile(pointerOf(dir), 'utf8')).trim()
  } catch {
    return null
  }
}

/** 目录内是否存在内容 token 与期望一致的锁文件（协议无关的「活锁在位」断言） */
async function findLockByToken(dir: string, token: string): Promise<string | null> {
  for (const name of await fsp.readdir(dir)) {
    if (!name.startsWith(`${LOCK_BASE}`)) continue
    try {
      const info = parseCodexMigrationLockInfo(await fsp.readFile(path.join(dir, name), 'utf8'))
      if (info?.token === token) return name
    } catch {
      // 非锁文件（指针 tmp 等）——跳过
    }
  }
  return null
}

const lockAt = (dir: string, token: string): CodexMigrationLockHandle =>
  createCodexMigrationLock(nodeFs, legacyOf(dir), identity(token))

// ---- 基本认领 / 释放 / 接管（代次协议形态） ----

describe('锁协议（真实 fs）：认领、指针与内容形态', () => {
  it('O_EXCL 认领互斥；锁内容含代次；指针文件以 tmp+rename 落地（"1"）', async () => {
    const dir = await newDir()
    const a = lockAt(dir, 'token-a')
    const b = lockAt(dir, 'token-b')
    expect(await a.tryAcquire()).toBe(true)
    expect(await b.tryAcquire()).toBe(false)
    expect(parseCodexMigrationLockInfo(await fsp.readFile(genOf(dir, 1), 'utf8')))
      .toMatchObject({ token: 'token-a', pid: 1000, gen: 1 })
    expect(await readPointerRaw(dir)).toBe('1')
    expect(typeof parseCodexMigrationLockInfo(await fsp.readFile(genOf(dir, 1), 'utf8'))?.createdAt)
      .toBe('number')
  })

  it('释放只删自己代次文件；指针保留不删；再认领得更高代次（单调）', async () => {
    const dir = await newDir()
    const a = lockAt(dir, 'token-a')
    expect(await a.tryAcquire()).toBe(true)
    await a.release()
    expect(await nodeFs.statMtimeMs(genOf(dir, 1))).toBeNull()
    expect(await readPointerRaw(dir)).toBe('1') // 指针不清空——公开路径在场
    const b = lockAt(dir, 'token-b')
    expect(await b.tryAcquire()).toBe(true)
    expect(parseCodexMigrationLockInfo(await fsp.readFile(genOf(dir, 2), 'utf8'))?.token)
      .toBe('token-b')
    expect(await readPointerRaw(dir)).toBe('2')
  })

  it('未持有者 release 不动他人在位锁（幂等安全）', async () => {
    const dir = await newDir()
    const owner = lockAt(dir, 'token-owner')
    expect(await owner.tryAcquire()).toBe(true)
    await lockAt(dir, 'token-stranger').release()
    expect(await nodeFs.statMtimeMs(genOf(dir, 1))).not.toBeNull()
  })

  it('指针缺失（引导态）= 代次 0：首次认领创建 gen 1 与指针', async () => {
    const dir = await newDir()
    expect(await readPointerRaw(dir)).toBeNull()
    expect(await lockAt(dir, 'token-a').tryAcquire()).toBe(true)
    expect(await readPointerRaw(dir)).toBe('1')
  })
})

describe('锁协议（真实 fs）：陈旧接管与孤儿自愈', () => {
  it('当前代次陈旧 → 以更高代次接管，指针推进，旧代次残留被清理', async () => {
    const dir = await seedDir({ pointer: 3, staleGens: [3] })
    const taker = lockAt(dir, 'token-taker')
    expect(await taker.takeoverIfStale(10_000)).toBe(true)
    expect(parseCodexMigrationLockInfo(await fsp.readFile(genOf(dir, 4), 'utf8'))?.token)
      .toBe('token-taker')
    expect(await readPointerRaw(dir)).toBe('4')
    expect(await nodeFs.statMtimeMs(genOf(dir, 3))).toBeNull() // U4：前代清理
    await taker.release()
  })

  it('新鲜锁 → 不接管、锁文件原样在位（不被移走）', async () => {
    const dir = await seedDir({ pointer: 1, freshGens: [1] })
    expect(await lockAt(dir, 'token-taker').takeoverIfStale(10_000)).toBe(false)
    expect(parseCodexMigrationLockInfo(await fsp.readFile(genOf(dir, 1), 'utf8'))?.token)
      .toBe('live-1')
    expect(await readPointerRaw(dir)).toBe('1')
  })

  it('无锁 → takeoverIfStale 等价直接认领', async () => {
    const dir = await newDir()
    const taker = lockAt(dir, 'token-taker')
    expect(await taker.takeoverIfStale(10_000)).toBe(true)
    await taker.release()
  })

  it('提交窗崩溃孤儿（gen 文件在、指针滞后）→ 后续认领按陈旧步进越过并清理，不锁死', async () => {
    const dir = await seedDir({ pointer: 1, staleGens: [1, 2] })
    expect(await lockAt(dir, 'token-healer').takeoverIfStale(10_000)).toBe(true)
    expect(await readPointerRaw(dir)).toBe('3') // 跳过孤儿 gen 2 直接落 3
    expect(await nodeFs.statMtimeMs(genOf(dir, 1))).toBeNull()
    expect(await nodeFs.statMtimeMs(genOf(dir, 2))).toBeNull()
    expect(parseCodexMigrationLockInfo(await fsp.readFile(genOf(dir, 3), 'utf8'))?.token)
      .toBe('token-healer')
  })

  it('单调性校验：滞后指针读者创建了已落后的空闲代次 → 提交校验撤退、不写回退指针', async () => {
    // 世界：gen1 陈旧。滞后读者 C 读到指针 "1" 后挂起；期间 A 接管 gen2
    // 并释放（指针 "2"、gen 文件均净）。C 恢复后可能重建 gen2（名字已
    // 空闲）——提交前重读指针 2 ≥ 2，必须撤退且不回退指针
    const dir = await seedDir({ pointer: 1, staleGens: [1] })
    const gate = new LockFsGate()
    const c = createCodexMigrationLock(gate.wrap(nodeFs), legacyOf(dir), identity('token-c'))
    const a = lockAt(dir, 'token-a')
    let started = false
    const cResult = await runGated(
      gate,
      () => c.takeoverIfStale(10_000),
      async (_index, op) => {
        if (!started && op === 'statMtimeMs') {
          started = true
          expect(await a.takeoverIfStale(10_000)).toBe(true)
          await a.release()
        }
      },
    )
    expect(cResult).toBe(false)
    expect(await readPointerRaw(dir)).toBe('2') // 指针停在 A 的代次
    expect(await nodeFs.statMtimeMs(genOf(dir, 2))).toBeNull() // C 撤退清了自己的文件
    expect(await findLockByToken(dir, 'token-c')).toBeNull()
  })
})

describe('锁协议（真实 fs）：_test 隔离清理', () => {
  it('forceCleanup：清指针与全代次文件（含旧协议残留），不动 state 文件', async () => {
    const dir = await seedDir({ pointer: 2, staleGens: [1], freshGens: [2], legacy: 'fresh' })
    const stateFile = path.join(dir, 'codex-theme-migration.state.json')
    await fsp.writeFile(stateFile, '{"state":"done","version":"1.2.3"}', 'utf8')
    await lockAt(dir, 'token-taker').forceCleanup()
    expect(await readPointerRaw(dir)).toBeNull()
    expect(await nodeFs.statMtimeMs(genOf(dir, 1))).toBeNull()
    expect(await nodeFs.statMtimeMs(genOf(dir, 2))).toBeNull()
    expect(await nodeFs.statMtimeMs(legacyOf(dir))).toBeNull()
    expect(await fsp.readFile(stateFile, 'utf8')).toContain('"done"')
  })
})

// ---- 受控调度：评审方四审双场景（P2-D 红测试） ----

describe('受控调度（评审方四审 P2-D）：任意 fs 原语边界注入第三窗口', () => {
  it('接管场景：A 新鲜锁在场、C 持陈旧观察接管 → 至多一个 owner，A 的活锁不被移走', async () => {
    // 评审方反例（旧协议）：C 的接管先 rename 候选再核验——若候选已被
    // A 重建为新锁，rename 先把 A 的活锁从公开路径移走；恢复（link）前
    // 第三窗口 X 可 open('wx') 成功，随后 link 因 EEXIST 放弃恢复、rm 清
    // 掉 A 的隔离副本 → A/C（此处 A/X）双 owner。本测试在 C 的每个原语
    // 边界注入 X 的 tryAcquire——协议必须在所有边界上拒绝 X
    const dir = await seedDir({ pointer: 1, staleGens: [1], legacy: 'stale' })
    const gate = new LockFsGate()
    const c = createCodexMigrationLock(gate.wrap(nodeFs), legacyOf(dir), identity('token-c'))
    const a = lockAt(dir, 'token-a')
    const x = lockAt(dir, 'token-x')
    let aStarted = false
    let aAcquired = false
    const xResults: boolean[] = []
    const cResult = await runGated(
      gate,
      () => c.takeoverIfStale(10_000),
      async (_index, op) => {
        if (!aStarted && op === 'statMtimeMs') {
          // C 完成首次陈旧观察（真实陈旧值）后世界前进：A 接管重建新锁
          aStarted = true
          aAcquired = await a.takeoverIfStale(10_000)
          return
        }
        if (aStarted) {
          xResults.push(await x.tryAcquire()) // 每个 C 的原语边界：X 尝试认领
        }
      },
    )
    expect(aAcquired).toBe(true)
    expect(cResult).toBe(false)
    expect(xResults.length).toBeGreaterThan(0)
    expect(xResults.every((v) => v === false)).toBe(true) // X 永远进不来
    // A 的活锁仍在位、内容未被动过（「活锁不被移走」）
    const aLock = await findLockByToken(dir, 'token-a')
    expect(aLock).not.toBeNull()
    await a.release() // A 正常释放
  })

  it('释放场景：B 活锁被接管后释放、C 在位 → B 的释放只删自己代次，C 的锁不被移走', async () => {
    // 评审方反例（旧协议）：释放先 rename 夺走再核对 token——rename 把
    // 继任者 C 的锁移走形成空窗，第三窗口 X 获锁；核对不符后 link EEXIST
    // 放弃恢复、rm 清掉 C 的锁 → C/X 双 owner。代次锁的释放 = 单条 rm
    // 自己代次文件，任何原语边界都不产生空窗
    const dir = await newDir()
    const gate = new LockFsGate()
    const b = createCodexMigrationLock(gate.wrap(nodeFs), legacyOf(dir), identity('token-b'))
    const x = lockAt(dir, 'token-x')
    const xResults: boolean[] = []
    let injecting = false
    const driveB = <T>(party: () => Promise<T>): Promise<T> =>
      runGated(gate, party, async () => {
        if (injecting) xResults.push(await x.tryAcquire())
      })
    // 阶段 1（无注入）：B 认领持有
    expect(await driveB(() => b.tryAcquire())).toBe(true)
    // 时间流逝：B 的锁陈旧 → C 接管在位（B 挂起、尚未 release）
    for (const file of await fsp.readdir(dir)) {
      if (file.startsWith(LOCK_BASE)) await ageFile(path.join(dir, file), 60_000)
    }
    const c = lockAt(dir, 'token-c')
    expect(await c.takeoverIfStale(10_000)).toBe(true)
    // 阶段 2（每个边界注入 X）：B 的 finally 释放
    injecting = true
    await driveB(() => b.release())
    expect(xResults.length).toBeGreaterThan(0)
    expect(xResults.every((v) => v === false)).toBe(true) // X 永远进不来
    expect(await findLockByToken(dir, 'token-c')).not.toBeNull() // C 的锁在位
  })
})
