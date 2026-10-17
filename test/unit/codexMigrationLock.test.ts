// #535 T08 迁移锁协议契约测试（PR #581 三审 P2-B 同修）：真实文件系统
// （os.tmpdir 临时目录 + fs.open 'wx'/rename/link/rm/utimes）钉住
// codexMigrationLock 的接管与释放不变量——评审方以真实 fs 受控调度复现
// 的「B 按过期观察删 A 新锁 → 两边均 migrate」反例在此协议化。
import { afterAll, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  createCodexMigrationLock,
  parseCodexMigrationLockInfo,
  type CodexLockFilesystem,
} from '../../src/shared/codexMigrationLock'

const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'vsidian-codex-lock-'))
afterAll(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true })
})

let dirSeq = 0
async function newDir(): Promise<string> {
  const dir = path.join(tmpRoot, `case-${++dirSeq}`)
  await fsp.mkdir(dir, { recursive: true })
  return dir
}

/** 与 wiring 相同的 node fs 端口（真实原语） */
const nodeFs: CodexLockFilesystem = {
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
}

/** 预置一把锁文件（模拟崩溃残留）：内容 + 可控 mtime */
async function seedLock(
  dir: string,
  info: { token: string; pid?: number; createdAt?: number },
  ageMs: number,
): Promise<string> {
  const lockPath = path.join(dir, 'codex-theme-migration.lock')
  const payload = JSON.stringify({
    token: info.token,
    pid: info.pid ?? 4242,
    createdAt: info.createdAt ?? Date.now() - ageMs,
  })
  await fsp.writeFile(lockPath, payload, 'utf8')
  const old = new Date(Date.now() - ageMs)
  await fsp.utimes(lockPath, old, old)
  return lockPath
}

const identity = (token: string) => ({ token, pid: 1000 })

describe('锁协议（真实 fs）：认领与内容形态', () => {
  it('O_EXCL 认领互斥；锁文件内容为 { token, pid, createdAt }', async () => {
    const dir = await newDir()
    const lockPath = path.join(dir, 'codex-theme-migration.lock')
    const a = createCodexMigrationLock(nodeFs, lockPath, identity('token-a'))
    const b = createCodexMigrationLock(nodeFs, lockPath, identity('token-b'))
    expect(await a.tryAcquire()).toBe(true)
    expect(await b.tryAcquire()).toBe(false)
    const info = parseCodexMigrationLockInfo(await fsp.readFile(lockPath, 'utf8'))
    expect(info).toMatchObject({ token: 'token-a', pid: 1000 })
    expect(typeof info?.createdAt).toBe('number')
  })

  it('释放删除自己的锁；释放后再认领成功', async () => {
    const dir = await newDir()
    const lockPath = path.join(dir, 'codex-theme-migration.lock')
    const a = createCodexMigrationLock(nodeFs, lockPath, identity('token-a'))
    expect(await a.tryAcquire()).toBe(true)
    await a.release()
    expect(await nodeFs.statMtimeMs(lockPath)).toBeNull()
    const b = createCodexMigrationLock(nodeFs, lockPath, identity('token-b'))
    expect(await b.tryAcquire()).toBe(true)
  })

  it('未持有者 release 不删除他人在位的锁（幂等安全）', async () => {
    const dir = await newDir()
    const lockPath = path.join(dir, 'codex-theme-migration.lock')
    const owner = createCodexMigrationLock(nodeFs, lockPath, identity('token-owner'))
    expect(await owner.tryAcquire()).toBe(true)
    const stranger = createCodexMigrationLock(nodeFs, lockPath, identity('token-stranger'))
    await stranger.release() // 从未 acquire——不得动锁
    expect(await nodeFs.statMtimeMs(lockPath)).not.toBeNull()
  })
})

describe('锁协议（真实 fs）：陈旧接管不变量', () => {
  it('陈旧锁（mtime 超阈值）→ 接管成功并重抢新锁', async () => {
    const dir = await newDir()
    const lockPath = await seedLock(dir, { token: 'stale-owner' }, 60_000)
    const taker = createCodexMigrationLock(nodeFs, lockPath, identity('token-taker'))
    expect(await taker.takeoverIfStale(10_000)).toBe(true)
    const info = parseCodexMigrationLockInfo(await fsp.readFile(lockPath, 'utf8'))
    expect(info?.token).toBe('token-taker')
    await taker.release()
    expect(await nodeFs.statMtimeMs(lockPath)).toBeNull()
  })

  it('新鲜锁 → 不接管、锁原样在位', async () => {
    const dir = await newDir()
    const lockPath = await seedLock(dir, { token: 'live-owner' }, 0)
    const taker = createCodexMigrationLock(nodeFs, lockPath, identity('token-taker'))
    expect(await taker.takeoverIfStale(10_000)).toBe(false)
    expect(parseCodexMigrationLockInfo(await fsp.readFile(lockPath, 'utf8'))?.token)
      .toBe('live-owner')
  })

  it('无锁 → takeoverIfStale 等价直接认领', async () => {
    const dir = await newDir()
    const lockPath = path.join(dir, 'codex-theme-migration.lock')
    const taker = createCodexMigrationLock(nodeFs, lockPath, identity('token-taker'))
    expect(await taker.takeoverIfStale(10_000)).toBe(true)
    await taker.release()
  })

  it('评审方调度：A 接管重建新锁后，B 按过期观察（伪造 stat）尝试接管 → 不得删 A 新锁', async () => {
    const dir = await newDir()
    // 1. 预置陈旧锁（L1，mtime 60s 前）——B 的「旧观察」对象
    const lockPath = await seedLock(dir, { token: 'stale-owner' }, 60_000)
    // 2. A 接管：删 L1、建新锁 L2（A token，mtime 新鲜）
    const a = createCodexMigrationLock(nodeFs, lockPath, identity('token-a'))
    expect(await a.takeoverIfStale(10_000)).toBe(true)
    // 3. B 持过期观察：statMtimeMs(lockPath) 被劫持返回 60s 前的伪造值
    // （模拟 B 在 L1 时代完成 stat、之后未重读）——其余原语真实
    const staleObservingFs: CodexLockFilesystem = {
      ...nodeFs,
      statMtimeMs: async (target) => {
        if (target === lockPath) return Date.now() - 60_000
        return nodeFs.statMtimeMs(target)
      },
    }
    const b = createCodexMigrationLock(staleObservingFs, lockPath, identity('token-b'))
    // B 走「stat 陈旧 → rename 夺走 → 对夺走对象重新验证」——夺走的 L2
    // 真实 mtime 新鲜 → 恢复原位、不接管、不删除
    expect(await b.takeoverIfStale(10_000)).toBe(false)
    // A 的新锁完好：内容仍是 A 的 token、仍在锁位
    expect(parseCodexMigrationLockInfo(await fsp.readFile(lockPath, 'utf8'))?.token)
      .toBe('token-a')
    // A 正常释放（token 核对通过 → 删除）
    await a.release()
    expect(await nodeFs.statMtimeMs(lockPath)).toBeNull()
  })
})

describe('锁协议（真实 fs）：owner 释放不删继任锁', () => {
  it('A 被接管后 finally 释放：核对 token 不符 → 继任者的锁原样保留', async () => {
    const dir = await newDir()
    const lockPath = path.join(dir, 'codex-theme-migration.lock')
    // A 认领 → 被接管（隔离式清走）→ B 认领新锁 → A 的 finally 释放
    const a = createCodexMigrationLock(nodeFs, lockPath, identity('token-a'))
    expect(await a.tryAcquire()).toBe(true)
    const b = createCodexMigrationLock(nodeFs, lockPath, identity('token-b'))
    // 模拟接管链：隔离式清走 A 的锁（forceCleanup 语义）后 B 认领
    await createCodexMigrationLock(nodeFs, lockPath, identity('token-taker')).forceCleanup()
    expect(await b.tryAcquire()).toBe(true)
    // A 的 finally 释放：rename 夺走的是 B 的锁——token 核对不符 → 恢复
    await a.release()
    expect(parseCodexMigrationLockInfo(await fsp.readFile(lockPath, 'utf8'))?.token)
      .toBe('token-b')
    await b.release()
    expect(await nodeFs.statMtimeMs(lockPath)).toBeNull()
  })

  it('forceCleanup（_test 隔离）：隔离式删除，锁不在位', async () => {
    const dir = await newDir()
    const lockPath = await seedLock(dir, { token: 'stale-owner' }, 0)
    await createCodexMigrationLock(nodeFs, lockPath, identity('token-taker')).forceCleanup()
    expect(await nodeFs.statMtimeMs(lockPath)).toBeNull()
  })
})
