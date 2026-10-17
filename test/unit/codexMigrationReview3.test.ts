// #535 T08 迁移 PR #581 第三轮审查修复的契约测试（P2-A / P2-B / 锁接管
// 竞态同修）。三个场景先以审查锁定时点的实现形态跑红（红证据见
// out/test/t08-review3-red.log，5 项全红），修复后为绿形态：
// - P2-A：pending 写入期间用户经**真实 SettingsService.apply** 保存的新
//   选择（组件主题/其他设置）不得被 await 前捕获的旧 overlay 快照覆盖
//   （评审方在 pending 写入处设屏障复现主题被改回 default）；
// - P2-B：两「窗口」各自独立 memento 缓存 + 延迟跨窗广播 + 共享同一
//   磁盘状态目录（真实 fs）→ 引导恰一次（评审方受控缓存模拟 guides=2
//   反例——完成判据必须是磁盘权威，不依赖各窗口 memento）；
// - 锁接管竞态（同修）：A 接管重建新锁后，B 持旧 stat（过期观察）尝试
//   接管 → 不得删 A 新锁，至多一方完成迁移（评审方真实 fs 受控调度
//   两边均 migrate）。锁协议细节另见 codexMigrationLock.test.ts。
import { afterAll, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  parseCodexMigrationMarker,
  runCodexThemeMigration,
  type CodexMigrationMarker,
  type CodexMigrationPorts,
} from '../../src/shared/codexMigration'
import {
  createCodexMigrationLock,
  type CodexLockFilesystem,
  type CodexMigrationLockHandle,
} from '../../src/shared/codexMigrationLock'
import {
  SettingsService,
  SETTINGS_STORAGE_KEY,
  type SettingsStorage,
} from '../../src/host/settingsService'
import {
  APPEARANCE_THEME_KEY,
  MERMAID_THEME_KEY,
  PRODUCTION_SETTING_DEFINITIONS,
  READABLE_LINE_WIDTH_KEY,
} from '../../src/shared/settings'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'

installLocale('zh-cn', zhCn)

const BRIDGE_THEME_REF = 'ONEGAYI.vsidian-codex-bridge/codex'
const STATE_FILE = 'codex-theme-migration.state.json'
const LOCK_FILE = 'codex-theme-migration.lock'

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

/** 互斥「读-判-写」的内存合成（P2-B/锁竞态场景——串行化路径在真实
 * SettingsService 内，此处以同快照合成等价语义；P2-A 场景用真实服务） */
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

/** 内存锁句柄（P2-A 场景——锁协议细节由 codexMigrationLock.test.ts 钉住） */
function makeMemLock(): CodexMigrationLockHandle {
  const state = { held: false }
  const handle: CodexMigrationLockHandle = {
    tryAcquire: async () => {
      if (state.held) return false
      state.held = true
      return true
    },
    takeoverIfStale: async () => handle.tryAcquire(),
    release: async () => {
      state.held = false
    },
    ageMs: async () => (state.held ? 0 : null),
    forceCleanup: async () => {
      state.held = false
    },
  }
  return handle
}

/** P2-A 端口：overlay 读写与真实 SettingsService 同一 memento；写路径经
 * settingsService 串行链（真实生产路径）；屏障挂在 writeMarker(pending)
 * 完成之后（评审方同款手法——挂起胜者于等待窗口） */
function makeReview3Ports(options: {
  memento: SettingsStorage
  exclusiveStep: CodexMigrationPorts['applyExclusiveOverlayStep']
  markerBox: { value: CodexMigrationMarker | undefined }
  guides: { count: number }
  lock: CodexMigrationLockHandle
}): {
  ports: CodexMigrationPorts
  barrier: { entered: Promise<void>; release: () => void }
} {
  let releaseBarrier: (() => void) | undefined
  let markEntered: (() => void) | undefined
  const barrier = {
    entered: new Promise<void>((resolve) => {
      markEntered = resolve
    }),
    release: () => releaseBarrier?.(),
  }
  const pendingGate = new Promise<void>((resolve) => {
    releaseBarrier = resolve
  })
  const ports: CodexMigrationPorts = {
    readRawOverlay: () => options.memento.get(SETTINGS_STORAGE_KEY),
    applyExclusiveOverlayStep: options.exclusiveStep,
    readMarker: async () => options.markerBox.value ?? null,
    writeMarker: async (marker) => {
      options.markerBox.value = marker
      if (marker.state === 'pending') {
        markEntered?.()
        markEntered = undefined
        await pendingGate
      }
    },
    extensionVersion: () => '1.2.3-test',
    requestGuide: () => {
      options.guides.count += 1
    },
    lock: options.lock,
  }
  return { ports, barrier }
}

// ---- 真实 fs 帮手（P2-B / 锁竞态：共享磁盘状态目录 + 文件锁） ----

const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'vsidian-codex-review3-'))
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

/** 磁盘权威 marker 端口（与 wiring 同语义：tmp+rename 原子写、损坏按无标记） */
function makeDiskMarkerStore(dir: string): Pick<CodexMigrationPorts, 'readMarker' | 'writeMarker'> {
  const statePath = path.join(dir, STATE_FILE)
  return {
    readMarker: async () => {
      try {
        return parseCodexMigrationMarker(JSON.parse(await fsp.readFile(statePath, 'utf8')))
      } catch {
        return null
      }
    },
    writeMarker: async (marker) => {
      const tmp = `${statePath}.tmp`
      await fsp.writeFile(tmp, JSON.stringify(marker), 'utf8')
      await fsp.rename(tmp, statePath)
    },
  }
}

/** 预置陈旧锁文件（模拟崩溃残留；mtime 回拨 ageMs） */
async function seedStaleLock(dir: string, ageMs: number): Promise<string> {
  const lockPath = path.join(dir, LOCK_FILE)
  const payload = JSON.stringify({ token: 'stale-owner', pid: 4242, createdAt: Date.now() - ageMs })
  await fsp.writeFile(lockPath, payload, 'utf8')
  const old = new Date(Date.now() - ageMs)
  await fsp.utimes(lockPath, old, old)
  return lockPath
}

// ---- P2-A：pending 写入期间的用户新选择不被旧快照覆盖 ----

describe('P2-A：pending 持久化等待窗口内的用户写入（真实 SettingsService.apply）', () => {
  it('等待期间保存组件主题 → 保留新键、清旧键、不引导、收口 done', async () => {
    const { memento, store } = makeMemento()
    store.set(SETTINGS_STORAGE_KEY, { [MERMAID_THEME_KEY]: 'codex' })
    const settingsService = new SettingsService(memento, PRODUCTION_SETTING_DEFINITIONS)
    const markerBox: { value: CodexMigrationMarker | undefined } = { value: undefined }
    const guides = { count: 0 }
    const { ports, barrier } = makeReview3Ports({
      memento,
      exclusiveStep: (step) => settingsService.runExclusiveOverlayStep(step),
      markerBox, guides, lock: makeMemLock(),
    })

    const run = runCodexThemeMigration(ports)
    await barrier.entered // 胜者挂起在 pending 写入之后（等待窗口敞开）

    const applied = await settingsService.apply({ [APPEARANCE_THEME_KEY]: BRIDGE_THEME_REF })
    expect(applied.ok).toBe(true) // 真实 apply 保存组件主题成功

    barrier.release()
    const result = await run
    expect(result).toEqual({ action: 'clean-legacy', guide: false })
    const overlay = store.get(SETTINGS_STORAGE_KEY) as Record<string, unknown>
    expect(overlay[APPEARANCE_THEME_KEY]).toBe(BRIDGE_THEME_REF) // 新选择保留
    expect(overlay[MERMAID_THEME_KEY]).toBe('default') // 旧键残留清除
    expect(guides.count).toBe(0) // 用户已自行选择，不再打扰
    expect(markerBox.value).toEqual({ state: 'done', version: '1.2.3-test' })
  })

  it('等待期间修改其他设置 → 迁移回落照常且其他设置不被覆盖', async () => {
    const { memento, store } = makeMemento()
    store.set(SETTINGS_STORAGE_KEY, { [MERMAID_THEME_KEY]: 'codex' })
    const settingsService = new SettingsService(memento, PRODUCTION_SETTING_DEFINITIONS)
    const markerBox: { value: CodexMigrationMarker | undefined } = { value: undefined }
    const guides = { count: 0 }
    const { ports, barrier } = makeReview3Ports({
      memento,
      exclusiveStep: (step) => settingsService.runExclusiveOverlayStep(step),
      markerBox, guides, lock: makeMemLock(),
    })

    const run = runCodexThemeMigration(ports)
    await barrier.entered
    const applied = await settingsService.apply({ [READABLE_LINE_WIDTH_KEY]: 800 })
    expect(applied.ok).toBe(true)
    barrier.release()

    const result = await run
    expect(result).toEqual({ action: 'migrate', guide: true })
    const overlay = store.get(SETTINGS_STORAGE_KEY) as Record<string, unknown>
    expect(overlay[APPEARANCE_THEME_KEY]).toBe('default')
    expect(overlay[MERMAID_THEME_KEY]).toBe('default')
    expect(overlay[READABLE_LINE_WIDTH_KEY]).toBe(800) // 同期其他设置保留
    expect(guides.count).toBe(1)
    expect(markerBox.value).toEqual({ state: 'done', version: '1.2.3-test' })
  })

  it('等待期间双键被自行处置到位 → 重判 none：不写不引导、直接收口 done', async () => {
    const { memento, store } = makeMemento()
    store.set(SETTINGS_STORAGE_KEY, { [MERMAID_THEME_KEY]: 'codex' })
    const settingsService = new SettingsService(memento, PRODUCTION_SETTING_DEFINITIONS)
    const markerBox: { value: CodexMigrationMarker | undefined } = { value: undefined }
    const guides = { count: 0 }
    const { ports, barrier } = makeReview3Ports({
      memento,
      exclusiveStep: (step) => settingsService.runExclusiveOverlayStep(step),
      markerBox, guides, lock: makeMemLock(),
    })

    const run = runCodexThemeMigration(ports)
    await barrier.entered
    // 双键到位无法经 apply 完成（旧键定义已删，写旧键被拒）——直写存储层
    // 模拟外部处置（防御性收口语义：pending 已写则收口 done）
    store.set(SETTINGS_STORAGE_KEY, { [MERMAID_THEME_KEY]: 'default' })
    barrier.release()

    const result = await run
    expect(result).toEqual({ action: 'none', guide: false })
    const overlay = store.get(SETTINGS_STORAGE_KEY) as Record<string, unknown>
    expect(overlay).toEqual({ [MERMAID_THEME_KEY]: 'default' })
    expect(guides.count).toBe(0)
    expect(markerBox.value).toEqual({ state: 'done', version: '1.2.3-test' })
  })
})

// ---- P2-B：窗口间 memento 缓存过期（磁盘权威完成状态） ----

describe('P2-B：双窗口独立 memento 缓存 + 延迟广播 + 共享磁盘状态目录 → 引导恰一次', () => {
  it('A 写 done 删锁后 B 未见跨窗广播（缓存过期）→ B 不得再次迁移引导', async () => {
    const dir = await newDir()
    const lockPath = path.join(dir, LOCK_FILE)
    const diskMarker = makeDiskMarkerStore(dir)
    // 独立 overlay memento：A 的迁移写入不进 B 的缓存（延迟跨窗广播——
    // 测试期内不同步，模拟 1.82.3 storage 广播迟到/丢失；B 恒读旧值）
    const windowA = makeMemento()
    const windowB = makeMemento()
    for (const w of [windowA, windowB]) {
      w.store.set(SETTINGS_STORAGE_KEY, { [MERMAID_THEME_KEY]: 'codex' })
    }
    const guides = { A: 0, B: 0 }
    const windowPorts = (
      window: ReturnType<typeof makeMemento>,
      lock: CodexMigrationLockHandle,
      guideKey: 'A' | 'B',
    ): CodexMigrationPorts => ({
      readRawOverlay: () => window.memento.get(SETTINGS_STORAGE_KEY),
      applyExclusiveOverlayStep: mementoExclusiveStep(window.memento),
      ...diskMarker,
      extensionVersion: () => '1.2.3-test',
      requestGuide: () => {
        guides[guideKey] += 1
      },
      lock,
    })
    const portsA = windowPorts(windowA, createCodexMigrationLock(nodeFs, lockPath, { token: 'token-a', pid: 1000 }), 'A')
    const portsB = windowPorts(windowB, createCodexMigrationLock(nodeFs, lockPath, { token: 'token-b', pid: 1000 }), 'B')

    // 窗口 A 激活：完整迁移并收口（done 落盘、锁释放）
    const a = await runCodexThemeMigration(portsA)
    expect(a).toEqual({ action: 'migrate', guide: true })
    expect(await nodeFs.statMtimeMs(lockPath)).toBeNull() // 锁已释放
    // 窗口 B 随后激活：overlay 缓存仍旧（延迟广播）、memento 无标记——
    // 完成判据来自共享磁盘权威状态，B 必须短路
    const b = await runCodexThemeMigration(portsB)
    expect(b).toEqual({ action: 'none', guide: false })
    expect(guides.A + guides.B).toBe(1) // 引导恰一次
    expect((await diskMarker.readMarker())?.state).toBe('done')
  })
})

// ---- 同修：锁接管竞态（不得按过期观察删除新锁） ----

describe('锁接管竞态：A 接管重建新锁后 B 持旧 stat 尝试接管（真实 fs 受控调度）', () => {
  it('不得删 A 新锁：至多一方完成迁移（评审方受控调度）', async () => {
    const dir = await newDir()
    // 1. 预置陈旧锁（上一次崩溃残留，mtime 远超阈值）——B 的「旧观察」对象
    const lockPath = await seedStaleLock(dir, 60_000)
    const diskMarker = makeDiskMarkerStore(dir)
    const windowA = makeMemento()
    windowA.store.set(SETTINGS_STORAGE_KEY, { [MERMAID_THEME_KEY]: 'codex' })
    const windowB = makeMemento()
    windowB.store.set(SETTINGS_STORAGE_KEY, { [MERMAID_THEME_KEY]: 'codex' })
    const guides = { A: 0, B: 0 }

    // A 的 writeMarker(pending) 屏障：把 A 停在其迁移序列中段（持有新锁）
    let releaseA: (() => void) | undefined
    let aEntered: (() => void) | undefined
    const aGate = new Promise<void>((resolve) => {
      releaseA = resolve
    })
    const aEnteredPromise = new Promise<void>((resolve) => {
      aEntered = resolve
    })
    const portsA: CodexMigrationPorts = {
      readRawOverlay: () => windowA.memento.get(SETTINGS_STORAGE_KEY),
      applyExclusiveOverlayStep: mementoExclusiveStep(windowA.memento),
      readMarker: diskMarker.readMarker,
      writeMarker: async (marker) => {
        await diskMarker.writeMarker(marker)
        if (marker.state === 'pending') {
          aEntered?.()
          aEntered = undefined
          await aGate
        }
      },
      extensionVersion: () => '1.2.3-test',
      requestGuide: () => {
        guides.A += 1
      },
      lock: createCodexMigrationLock(nodeFs, lockPath, { token: 'token-a', pid: 1000 }),
    }
    // B 持旧 stat：对 lockPath 的**首次** stat 返回 60s 前的伪造值（模拟
    // B 在旧锁时代完成陈旧观察、之后未重读）；其余原语与后续 stat 真实
    let staleObservationsLeft = 1
    const staleObservingFs: CodexLockFilesystem = {
      ...nodeFs,
      statMtimeMs: async (target) => {
        if (target === lockPath && staleObservationsLeft > 0) {
          staleObservationsLeft -= 1
          return Date.now() - 60_000
        }
        return nodeFs.statMtimeMs(target)
      },
    }
    const portsB: CodexMigrationPorts = {
      readRawOverlay: () => windowB.memento.get(SETTINGS_STORAGE_KEY),
      applyExclusiveOverlayStep: mementoExclusiveStep(windowB.memento),
      ...diskMarker,
      extensionVersion: () => '1.2.3-test',
      requestGuide: () => {
        guides.B += 1
      },
      lock: createCodexMigrationLock(staleObservingFs, lockPath, { token: 'token-b', pid: 1000 }),
    }

    // 2. A 接管陈旧锁（删旧建新）→ 迁移序列挂起在 pending（A 持有新锁）
    const runA = runCodexThemeMigration(portsA)
    await aEnteredPromise
    // A 的新锁在位（内容为 A 的 token）
    expect(JSON.parse(await fsp.readFile(lockPath, 'utf8')).token).toBe('token-a')

    // 3. B 按过期观察尝试接管：rename 夺走 A 新锁 → 对夺走对象自身验证
    // （真实 mtime 新鲜）→ 原位恢复、不接管、不删除
    const runB = runCodexThemeMigration(portsB, { pollIntervalMs: 5, waitTimeoutMs: 60 })
    releaseA?.()
    const [a, b] = await Promise.all([runA, runB])

    // 至多一方完成迁移；A 的新锁未被 B 的过期观察删除
    expect(a).toEqual({ action: 'migrate', guide: true })
    expect(b).toEqual({ action: 'none', guide: false })
    expect(guides.A + guides.B).toBe(1)
    expect((await diskMarker.readMarker())?.state).toBe('done')
    // 收尾锁位：正常路径 A 释放即净；若与 B 的恢复交错（协议不变量 3
    // 声明的边界），允许残留一把幽灵锁——但内容必须是 A 的代次（B 从
    // 未取得认领），且由 mtime 陈旧接管兜底清理
    const lockStat = await nodeFs.statMtimeMs(lockPath)
    if (lockStat !== null) {
      expect(JSON.parse(await fsp.readFile(lockPath, 'utf8')).token).toBe('token-a')
    }
  })
})
