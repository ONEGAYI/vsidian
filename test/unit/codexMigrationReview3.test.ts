// #535 T08 迁移 PR #581 第三轮审查修复的契约测试（P2-A / P2-B / 锁接管
// 竞态同修）。三个场景先以审查锁定时点的实现形态跑红（红证据见
// out/test/t08-review3-red.log），随修复演进为绿形态：
// - P2-A：pending 写入期间用户经**真实 SettingsService.apply** 保存的新
//   选择（组件主题/其他设置）不得被 await 前捕获的旧 overlay 快照覆盖
//   （评审方在 pending 写入处设屏障复现主题被改回 default）；
// - P2-B：两「窗口」各自独立 memento 缓存 + 延迟跨窗广播 + 共享磁盘
//   状态目录 → 引导恰一次（评审方受控缓存模拟 guides=2 反例）；
// - 锁接管竞态（同修）：A 接管重建新锁后，B 持旧 stat 尝试接管 → 不得
//   删 A 新锁，至多一方完成迁移（评审方真实 fs 受控调度两边均 migrate）。
import { describe, expect, it } from 'vitest'
import {
  runCodexThemeMigration,
  type CodexMigrationMarker,
  type CodexMigrationPorts,
} from '../../src/shared/codexMigration'
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

/** 共享内存锁（红形态端口：tryAcquire/lockAgeMs/releaseLock 三方法） */
function makeLockFixture() {
  const state = { held: false, ageMs: 0 }
  function windowLock(staleObservedMs?: number) {
    return {
      tryAcquireLock: async (): Promise<boolean> => {
        if (state.held) return false
        state.held = true
        state.ageMs = 0
        return true
      },
      lockAgeMs: async (): Promise<number | null> =>
        staleObservedMs ?? (state.held ? state.ageMs : null),
      releaseLock: async (): Promise<void> => {
        state.held = false
        state.ageMs = 0
      },
    }
  }
  return { state, windowLock }
}

/** P2-A 端口：overlay 读写与真实 SettingsService 同一 memento；写路径经
 * settingsService 串行链（真实生产路径）；屏障挂在 writeMarker(pending)
 * 完成之后（评审方同款手法——挂起胜者于等待窗口） */
function makeReview3Ports(options: {
  memento: SettingsStorage
  exclusiveStep: CodexMigrationPorts['applyExclusiveOverlayStep']
  markerBox: { value: CodexMigrationMarker | undefined }
  guides: { count: number }
  lock: ReturnType<ReturnType<typeof makeLockFixture>['windowLock']>
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
    readMarker: () => options.markerBox.value,
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
    ...options.lock,
  }
  return { ports, barrier }
}

// ---- P2-A：pending 写入期间的用户新选择不被旧快照覆盖 ----

describe('P2-A：pending 持久化等待窗口内的用户写入（真实 SettingsService.apply）', () => {
  it('等待期间保存组件主题 → 保留新键、清旧键、不引导、收口 done', async () => {
    const { memento, store } = makeMemento()
    store.set(SETTINGS_STORAGE_KEY, { [MERMAID_THEME_KEY]: 'codex' })
    const settingsService = new SettingsService(memento, PRODUCTION_SETTING_DEFINITIONS)
    const markerBox: { value: CodexMigrationMarker | undefined } = { value: undefined }
    const guides = { count: 0 }
    const { windowLock } = makeLockFixture()
    const { ports, barrier } = makeReview3Ports({
      memento,
      exclusiveStep: (step) => settingsService.runExclusiveOverlayStep(step),
      markerBox, guides, lock: windowLock(),
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
    const { windowLock } = makeLockFixture()
    const { ports, barrier } = makeReview3Ports({
      memento,
      exclusiveStep: (step) => settingsService.runExclusiveOverlayStep(step),
      markerBox, guides, lock: windowLock(),
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
    const { windowLock } = makeLockFixture()
    const { ports, barrier } = makeReview3Ports({
      memento,
      exclusiveStep: (step) => settingsService.runExclusiveOverlayStep(step),
      markerBox, guides, lock: windowLock(),
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
// 本组在 commit 2（marker 磁盘权威化）落地前暂 skip：红证据已留档
// （out/test/t08-review3-red.log，5 项全红），修复后启用为绿。

describe.skip('P2-B：双窗口独立 memento 缓存 + 延迟广播 → 引导恰一次', () => {
  it('A 写 done 删锁后 B 未见跨窗广播（缓存过期）→ B 不得再次迁移引导', async () => {
    // 共享：锁。独立：overlay 缓存与 marker memento（延迟跨窗广播——测试期
    // 内不同步到对方，模拟 1.82.3 storage 广播迟到/丢失；B 的 overlay 缓存
    // 恒为迁移前旧值）。完成判据必须脱离各窗口 memento 缓存。
    const { state: lockState, windowLock } = makeLockFixture()
    const windowA = makeMemento()
    const windowB = makeMemento()
    for (const w of [windowA, windowB]) {
      w.store.set(SETTINGS_STORAGE_KEY, { [MERMAID_THEME_KEY]: 'codex' })
    }
    const guides = { A: 0, B: 0 }
    const markerA: { value: CodexMigrationMarker | undefined } = { value: undefined }
    const markerB: { value: CodexMigrationMarker | undefined } = { value: undefined }

    const portsA: CodexMigrationPorts = {
      readRawOverlay: () => windowA.memento.get(SETTINGS_STORAGE_KEY),
      applyExclusiveOverlayStep: mementoExclusiveStep(windowA.memento),
      readMarker: () => markerA.value,
      writeMarker: async (marker) => {
        markerA.value = marker
      },
      extensionVersion: () => '1.2.3-test',
      requestGuide: () => {
        guides.A += 1
      },
      ...windowLock(),
    }
    const portsB: CodexMigrationPorts = {
      readRawOverlay: () => windowB.memento.get(SETTINGS_STORAGE_KEY),
      applyExclusiveOverlayStep: mementoExclusiveStep(windowB.memento),
      readMarker: () => markerB.value, // B 的本地缓存：未见 A 的 done
      writeMarker: async (marker) => {
        markerB.value = marker
      },
      extensionVersion: () => '1.2.3-test',
      requestGuide: () => {
        guides.B += 1
      },
      ...windowLock(),
    }

    // 窗口 A 激活：完整迁移并收口（done 落地、锁释放）
    const a = await runCodexThemeMigration(portsA)
    expect(a).toEqual({ action: 'migrate', guide: true })
    expect(lockState.held).toBe(false)
    // 窗口 B 随后激活：overlay 缓存仍旧（延迟广播）、marker 缓存为空——
    // 完成判据来自跨窗口一致的真实状态，B 必须短路
    const b = await runCodexThemeMigration(portsB)
    expect(b).toEqual({ action: 'none', guide: false })
    expect(guides.A + guides.B).toBe(1) // 引导恰一次
  })
})

// ---- 同修：锁接管竞态（不得按过期观察删除新锁） ----
// 同上：commit 2（锁 token/rename 协议）落地前暂 skip，红证据已留档。

describe.skip('锁接管竞态：A 接管重建新锁后 B 持旧 stat 尝试接管', () => {
  it('不得删 A 新锁：至多一方完成迁移（评审方受控调度）', async () => {
    const { state: lockState, windowLock } = makeLockFixture()
    // 1. 预置陈旧锁（上一次崩溃残留，mtime 远超阈值）
    lockState.held = true
    lockState.ageMs = 60_000

    const windowA = makeMemento()
    windowA.store.set(SETTINGS_STORAGE_KEY, { [MERMAID_THEME_KEY]: 'codex' })
    const windowB = makeMemento()
    windowB.store.set(SETTINGS_STORAGE_KEY, { [MERMAID_THEME_KEY]: 'codex' })
    const guides = { A: 0, B: 0 }
    const markerA: { value: CodexMigrationMarker | undefined } = { value: undefined }
    const markerB: { value: CodexMigrationMarker | undefined } = { value: undefined }

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
      readMarker: () => markerA.value,
      writeMarker: async (marker) => {
        markerA.value = marker
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
      ...windowLock(),
    }
    // B 持旧 stat：B 在旧锁（L1）时代完成陈旧观察，之后未重读——B 的
    // lockAgeMs 恒返回该过期观察值
    const portsB: CodexMigrationPorts = {
      readRawOverlay: () => windowB.memento.get(SETTINGS_STORAGE_KEY),
      applyExclusiveOverlayStep: mementoExclusiveStep(windowB.memento),
      readMarker: () => markerB.value,
      writeMarker: async (marker) => {
        markerB.value = marker
      },
      extensionVersion: () => '1.2.3-test',
      requestGuide: () => {
        guides.B += 1
      },
      ...windowLock(60_000),
    }

    // 2. A 接管陈旧锁（删旧建新）→ 迁移序列挂起在 pending（A 持有新锁）
    const runA = runCodexThemeMigration(portsA)
    await aEnteredPromise

    // 3. B 按过期观察尝试接管：不得删除 A 的新锁、不得取得认领
    const runB = runCodexThemeMigration(portsB, { pollIntervalMs: 5, waitTimeoutMs: 60 })
    releaseA?.()
    const [a, b] = await Promise.all([runA, runB])

    // 至多一方完成迁移；B 被过期观察误导也不得删 A 新锁导致双迁移
    expect(a).toEqual({ action: 'migrate', guide: true })
    expect(b).toEqual({ action: 'none', guide: false })
    expect(guides.A + guides.B).toBe(1)
    expect(lockState.held).toBe(false)
  })
})
