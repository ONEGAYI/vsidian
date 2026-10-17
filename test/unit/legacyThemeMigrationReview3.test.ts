// #535 T08 迁移 PR #581 审查修复的契约测试（三审 P2-A / P2-B + 四审
// P2-D 生产链调度）。场景先以对应轮次的旧实现形态跑红，修复后为绿：
// - P2-A（三审）：pending 写入期间用户经**真实 SettingsService.apply**
//   保存的新选择（组件主题/其他设置）不得被 await 前捕获的旧 overlay
//   快照覆盖（评审方在 pending 写入处设屏障复现主题被改回 default）；
// - P2-B（三审）：两「窗口」各自独立 memento 缓存 + 延迟跨窗广播 + 共享
//   同一磁盘状态目录（真实 fs）→ 引导恰一次（评审方受控缓存模拟
//   guides=2 反例——完成判据必须是磁盘权威，不依赖各窗口 memento）；
// - P2-D（四审）：生产 runLegacyThemeMigration + 真实磁盘 state + 三
//   「窗口」独立缓存 + 受控调度（C 的每个锁原语边界注入 B 的完整激
//   活）→ 引导恰一次（评审方接入生产链实测 guides=['C','A'] 的反例
//   ——旧协议 rename 窗口让活锁路径暂时消失，第三窗口获锁成双 owner）。
//   锁协议原语级双调度（接管 A/C、释放 B/C）见 legacyThemeMigrationLock.test.ts。
import { afterAll, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  parseLegacyThemeMigrationMarker,
  runLegacyThemeMigration,
  type LegacyThemeMigrationMarker,
  type LegacyThemeMigrationPorts,
} from '../../src/shared/legacyThemeMigration'
import {
  createLegacyThemeMigrationLock,
  type LegacyThemeMigrationLockHandle,
} from '../../src/shared/legacyThemeMigrationLock'
import { LockFsGate, runGated, type LockFsLike } from './legacyLockTestGate'
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

// 等价性对拍用中性组件主题身份（判定按命名空间形态，不依赖具体组件）
const COMPONENT_THEME_REF = 'pub.two/aqua'
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

/** 内存锁句柄（P2-A 场景——锁协议细节由 legacyThemeMigrationLock.test.ts 钉住） */
function makeMemLock(): LegacyThemeMigrationLockHandle {
  const state = { held: false }
  const handle: LegacyThemeMigrationLockHandle = {
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
  exclusiveStep: LegacyThemeMigrationPorts['applyExclusiveOverlayStep']
  markerBox: { value: LegacyThemeMigrationMarker | undefined }
  guides: { count: number }
  lock: LegacyThemeMigrationLockHandle
}): {
  ports: LegacyThemeMigrationPorts
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
  const ports: LegacyThemeMigrationPorts = {
    readRawOverlay: () => options.memento.get(SETTINGS_STORAGE_KEY),
    applyExclusiveOverlayStep: options.exclusiveStep,
    // B'：身份已收敛的常态（本场景焦点在 memento 缓存延迟非身份生成）
    readProfileId: async () => 'review3-profile',
    writeProfileId: async () => {},
    readMarker: async () => options.markerBox.value ?? null,
    writeMarker: async (_profileId, marker) => {
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

const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'vsidian-legacy-review3-'))
afterAll(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true })
})

let dirSeq = 0
async function newDir(): Promise<string> {
  const dir = path.join(tmpRoot, `case-${++dirSeq}`)
  await fsp.mkdir(dir, { recursive: true })
  return dir
}

/** 与 wiring 同族的真实 fs 端口（含两代协议原语并集——红绿两态共用） */
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

/** 磁盘权威 marker 端口（与 wiring 同语义：tmp+rename 原子写、损坏按无标记） */
function makeDiskMarkerStore(dir: string): Pick<LegacyThemeMigrationPorts, 'readMarker' | 'writeMarker'> {
  const statePath = (profileId: string) =>
    path.join(dir, `legacy-theme-migration.${profileId}.state.json`)
  return {
    readMarker: async (profileId) => {
      try {
        return parseLegacyThemeMigrationMarker(JSON.parse(await fsp.readFile(statePath(profileId), 'utf8')))
      } catch {
        return null
      }
    },
    writeMarker: async (profileId, marker) => {
      const target = statePath(profileId)
      const tmp = `${target}.tmp`
      await fsp.writeFile(tmp, JSON.stringify(marker), 'utf8')
      await fsp.rename(tmp, target)
    },
  }
}

/**
 * 预置崩溃残留锁（模拟胜者残留；mtime 回拨 ageMs）。同时播种两代协议
 * 形态（旧协议单锁文件 + 代次锁指针与 gen 文件）——红态（三审实现）
 * 与绿态（代次锁）共用同一调度脚本
 */
async function seedStaleLock(dir: string, ageMs: number): Promise<string> {
  const lockPath = path.join(dir, LOCK_FILE)
  const payload = JSON.stringify({ token: 'stale-owner', pid: 4242, createdAt: Date.now() - ageMs })
  await fsp.writeFile(lockPath, payload, 'utf8')
  const old = new Date(Date.now() - ageMs)
  await fsp.utimes(lockPath, old, old)
  // 代次锁形态：指针 "1" + 陈旧 gen 1
  await fsp.writeFile(path.join(dir, `${LOCK_FILE}.gen`), '1', 'utf8')
  const gen1 = path.join(dir, `${LOCK_FILE}.1`)
  await fsp.writeFile(gen1, JSON.stringify({
    token: 'stale-owner', pid: 4242, createdAt: Date.now() - ageMs, gen: 1,
  }), 'utf8')
  await fsp.utimes(gen1, old, old)
  return lockPath
}

// ---- P2-A：pending 写入期间的用户新选择不被旧快照覆盖 ----

describe('P2-A：pending 持久化等待窗口内的用户写入（真实 SettingsService.apply）', () => {
  it('等待期间保存组件主题 → 保留新键、清旧键、不引导、收口 done', async () => {
    const { memento, store } = makeMemento()
    store.set(SETTINGS_STORAGE_KEY, { [MERMAID_THEME_KEY]: 'retired-preset' })
    const settingsService = new SettingsService(memento, PRODUCTION_SETTING_DEFINITIONS)
    const markerBox: { value: LegacyThemeMigrationMarker | undefined } = { value: undefined }
    const guides = { count: 0 }
    const { ports, barrier } = makeReview3Ports({
      memento,
      exclusiveStep: (step) => settingsService.runExclusiveOverlayStep(step),
      markerBox, guides, lock: makeMemLock(),
    })

    const run = runLegacyThemeMigration(ports)
    await barrier.entered // 胜者挂起在 pending 写入之后（等待窗口敞开）

    const applied = await settingsService.apply({ [APPEARANCE_THEME_KEY]: COMPONENT_THEME_REF })
    expect(applied.ok).toBe(true) // 真实 apply 保存组件主题成功

    barrier.release()
    const result = await run
    expect(result).toEqual({ action: 'clean-legacy', guide: false })
    const overlay = store.get(SETTINGS_STORAGE_KEY) as Record<string, unknown>
    expect(overlay[APPEARANCE_THEME_KEY]).toBe(COMPONENT_THEME_REF) // 新选择保留
    expect(overlay[MERMAID_THEME_KEY]).toBe('default') // 旧键残留清除
    expect(guides.count).toBe(0) // 用户已自行选择，不再打扰
    expect(markerBox.value).toEqual({ state: 'done', version: '1.2.3-test' })
  })

  it('等待期间修改其他设置 → 迁移回落照常且其他设置不被覆盖', async () => {
    const { memento, store } = makeMemento()
    store.set(SETTINGS_STORAGE_KEY, { [MERMAID_THEME_KEY]: 'retired-preset' })
    const settingsService = new SettingsService(memento, PRODUCTION_SETTING_DEFINITIONS)
    const markerBox: { value: LegacyThemeMigrationMarker | undefined } = { value: undefined }
    const guides = { count: 0 }
    const { ports, barrier } = makeReview3Ports({
      memento,
      exclusiveStep: (step) => settingsService.runExclusiveOverlayStep(step),
      markerBox, guides, lock: makeMemLock(),
    })

    const run = runLegacyThemeMigration(ports)
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
    store.set(SETTINGS_STORAGE_KEY, { [MERMAID_THEME_KEY]: 'retired-preset' })
    const settingsService = new SettingsService(memento, PRODUCTION_SETTING_DEFINITIONS)
    const markerBox: { value: LegacyThemeMigrationMarker | undefined } = { value: undefined }
    const guides = { count: 0 }
    const { ports, barrier } = makeReview3Ports({
      memento,
      exclusiveStep: (step) => settingsService.runExclusiveOverlayStep(step),
      markerBox, guides, lock: makeMemLock(),
    })

    const run = runLegacyThemeMigration(ports)
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
      w.store.set(SETTINGS_STORAGE_KEY, { [MERMAID_THEME_KEY]: 'retired-preset' })
    }
    const guides = { A: 0, B: 0 }
    const windowPorts = (
      window: ReturnType<typeof makeMemento>,
      lock: LegacyThemeMigrationLockHandle,
      guideKey: 'A' | 'B',
    ): LegacyThemeMigrationPorts => ({
      readRawOverlay: () => window.memento.get(SETTINGS_STORAGE_KEY),
      applyExclusiveOverlayStep: mementoExclusiveStep(window.memento),
      readProfileId: async () => 'review3-profile',
      writeProfileId: async () => {},
      ...diskMarker,
      extensionVersion: () => '1.2.3-test',
      requestGuide: () => {
        guides[guideKey] += 1
      },
      lock,
    })
    const portsA = windowPorts(windowA, createLegacyThemeMigrationLock(nodeFs, lockPath, { token: 'token-a', pid: 1000 }), 'A')
    const portsB = windowPorts(windowB, createLegacyThemeMigrationLock(nodeFs, lockPath, { token: 'token-b', pid: 1000 }), 'B')

    // 窗口 A 激活：完整迁移并收口（done 落盘、锁释放）
    const a = await runLegacyThemeMigration(portsA)
    expect(a).toEqual({ action: 'migrate', guide: true })
    expect(await nodeFs.statMtimeMs(lockPath)).toBeNull() // 锁已释放
    // 窗口 B 随后激活：overlay 缓存仍旧（延迟广播）、memento 无标记——
    // 完成判据来自共享磁盘权威状态，B 必须短路
    const b = await runLegacyThemeMigration(portsB)
    expect(b).toEqual({ action: 'none', guide: false })
    expect(guides.A + guides.B).toBe(1) // 引导恰一次
    expect((await diskMarker.readMarker('review3-profile'))?.state).toBe('done')
  })
})

// ---- 四审 P2-D：生产链受控调度（三「窗口」→ 引导恰一次） ----

describe('锁代次协议接入生产链（四审 P2-D）：三「窗口」独立缓存 + 受控调度 → 引导恰一次', () => {
  it('A 挂起于 owner 序列（pending 已落盘）、C 持陈旧观察接管、任意锁原语边界注入 B 完整激活 → guides 恰 1', async () => {
    const dir = await newDir()
    const lockPath = await seedStaleLock(dir, 60_000)
    const diskMarker = makeDiskMarkerStore(dir)
    // 三「窗口」各自独立 overlay 缓存（跨窗广播延迟/丢失——同 P2-B 形态）
    const windowA = makeMemento()
    const windowB = makeMemento()
    const windowC = makeMemento()
    for (const w of [windowA, windowB, windowC]) {
      w.store.set(SETTINGS_STORAGE_KEY, { [MERMAID_THEME_KEY]: 'retired-preset' })
    }
    const guides = { A: 0, B: 0, C: 0 }
    const windowPorts = (
      window: ReturnType<typeof makeMemento>,
      lock: LegacyThemeMigrationLockHandle,
      guideKey: 'A' | 'B' | 'C',
    ): LegacyThemeMigrationPorts => ({
      readRawOverlay: () => window.memento.get(SETTINGS_STORAGE_KEY),
      applyExclusiveOverlayStep: mementoExclusiveStep(window.memento),
      readProfileId: async () => 'review3-profile',
      writeProfileId: async () => {},
      ...diskMarker,
      extensionVersion: () => '1.2.3-test',
      requestGuide: () => {
        guides[guideKey] += 1
      },
      lock,
    })

    // A 的 writeMarker(pending) 屏障：把 A 停在其 owner 序列中段（持有锁）
    let releaseA: (() => void) | undefined
    let aEntered: (() => void) | undefined
    const aGate = new Promise<void>((resolve) => {
      releaseA = resolve
    })
    const aEnteredPromise = new Promise<void>((resolve) => {
      aEntered = resolve
    })
    const portsA: LegacyThemeMigrationPorts = {
      readRawOverlay: () => windowA.memento.get(SETTINGS_STORAGE_KEY),
      applyExclusiveOverlayStep: mementoExclusiveStep(windowA.memento),
      readProfileId: async () => 'review3-profile',
      writeProfileId: async () => {},
      readMarker: diskMarker.readMarker,
      writeMarker: async (profileId, marker) => {
        await diskMarker.writeMarker(profileId, marker)
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
      lock: createLegacyThemeMigrationLock(nodeFs, lockPath, { token: 'token-a', pid: 1000 }),
    }
    const portsB = windowPorts(
      windowB,
      createLegacyThemeMigrationLock(nodeFs, lockPath, { token: 'token-b', pid: 1000 }),
      'B',
    )
    // C：门控端口——C 的每个锁原语边界都是第三方（B）的完整激活入场点
    const gate = new LockFsGate()
    const portsC = windowPorts(
      windowC,
      createLegacyThemeMigrationLock(gate.wrap(nodeFs), lockPath, { token: 'token-c', pid: 1000 }),
      'C',
    )

    let runA: Promise<{ action: string; guide: boolean }> | undefined
    let aStarted = false
    const cResult = await runGated(
      gate,
      () => runLegacyThemeMigration(portsC, {
        lockStaleMs: 10_000, waitTimeoutMs: 150, pollIntervalMs: 5,
      }),
      async (_index, op) => {
        if (!aStarted && op === 'statMtimeMs') {
          // C 完成首次陈旧观察（真实陈旧值）后世界前进：A 接管胜出并挂
          // 起在 pending 屏障（持有新鲜锁）——评审方同款「陈旧观察后世界
          // 已被 A 重建」调度
          aStarted = true
          runA = runLegacyThemeMigration(portsA)
          await aEnteredPromise
          return
        }
        if (aStarted) {
          // 任意边界：B 完整激活一次（短超时静默退出）
          await runLegacyThemeMigration(portsB, {
            lockStaleMs: 10_000, waitTimeoutMs: 30, pollIntervalMs: 5,
          })
        }
      },
    )
    // C 落定后放 A 出屏障、收尾
    releaseA?.()
    const a = await runA

    // 四审反例（旧协议）：C 的 rename 窗口让 B 获锁成 owner、A 随后补走
    // 序列 → guides = 2。代次锁上 C/B 在 A 活锁在场时永远进不来
    expect(guides.A + guides.B + guides.C).toBe(1)
    expect(a).toEqual({ action: 'migrate', guide: true })
    expect(cResult).toEqual({ action: 'none', guide: false })
    expect((await diskMarker.readMarker('review3-profile'))?.state).toBe('done')
  })
})
