// #535 T08 旧内核 Codex 设置迁移——纯函数与宿主编排的契约测试。
//
// 判据关键：迁移判定读 globalState `vsidian.settings` 的**原始 overlay**
// （未经 sanitize）——枚举收窄后 sanitize 会把残留 'codex' 静默变
// 'default'，快照层无法区分「曾是 codex」与「从未设置」，一次性引导
// 将永不触发（探索笔记 theme-settings-flow 第一节的推论）。
//
// PR #581 评审修复（发现 1/2）：迁移持久化改为「pending-guide 可恢复
// 状态机」（先写 pending → 改设置 → 发引导 → 写 done），并发迁移经
// globalStorage 锁文件原子认领（O_EXCL）——败者等待或超时均静默退出，
// 陈旧锁（mtime 超阈值）由后续激活接管。以下恢复与并发场景为评审
// 方复现用例的契约化。
import { describe, expect, it } from 'vitest'
import {
  CODEX_MIGRATION_PROFILE_ID_OVERLAY_KEY,
  parseCodexMigrationMarker,
  planCodexThemeMigration,
  runCodexThemeMigration,
  type CodexMigrationMarker,
  type CodexMigrationPorts,
} from '../../src/shared/codexMigration'
import type { CodexMigrationLockHandle } from '../../src/shared/codexMigrationLock'
import { APPEARANCE_THEME_KEY, MERMAID_THEME_KEY } from '../../src/shared/settings'

/**
 * 编排用例默认预置的 profile 身份（B' 五审 P2-C）：身份生成/等待窗/按身份
 * 分居磁盘的语义由 codexMigrationReview5.test.ts 以真实 fs 钉住，此处预置
 * 身份让用例聚焦迁移矩阵与持久化顺序本身
 */
const TEST_PROFILE_ID = 'test-profile-1'

/** 迁移补丁同批落 overlay 的身份键期望（与生产 CODEX_MIGRATION_PROFILE_ID_OVERLAY_KEY 同键） */
const PROFILE_ID_IN_OVERLAY = { [CODEX_MIGRATION_PROFILE_ID_OVERLAY_KEY]: TEST_PROFILE_ID }

// ---- 三档迁移矩阵（规格 addon-themes.md §6.2 / 任务书语义矩阵） ----

describe('planCodexThemeMigration（三档迁移矩阵，原始 overlay 判据）', () => {
  it('档 1a：新键显式 codex（T07 过渡内置项身份）→ 双键回落 default + 引导', () => {
    expect(planCodexThemeMigration(
      { [APPEARANCE_THEME_KEY]: 'codex', [MERMAID_THEME_KEY]: 'codex' },
      false,
    )).toEqual({
      action: 'migrate',
      overlayPatch: { [APPEARANCE_THEME_KEY]: 'default', [MERMAID_THEME_KEY]: 'default' },
      guide: true,
    })
  })

  it('档 1b：新键缺失/空串且原始旧键 codex → 双键回落 default + 引导（升级用户主路径）', () => {
    expect(planCodexThemeMigration({ [MERMAID_THEME_KEY]: 'codex' }, false)).toEqual({
      action: 'migrate',
      overlayPatch: { [APPEARANCE_THEME_KEY]: 'default', [MERMAID_THEME_KEY]: 'default' },
      guide: true,
    })
    expect(planCodexThemeMigration({ [APPEARANCE_THEME_KEY]: '', [MERMAID_THEME_KEY]: 'codex' }, false))
      .toMatchObject({ action: 'migrate', guide: true })
  })

  it('档 1c：新键 default 且原始旧键 codex → 双键回落 default + 引导（清残留）', () => {
    expect(planCodexThemeMigration(
      { [APPEARANCE_THEME_KEY]: 'default', [MERMAID_THEME_KEY]: 'codex' },
      false,
    )).toEqual({
      action: 'migrate',
      overlayPatch: { [APPEARANCE_THEME_KEY]: 'default', [MERMAID_THEME_KEY]: 'default' },
      guide: true,
    })
  })

  it('档 2：新键为组件主题身份 → 不动新键；旧键残留 codex 清 default；不引导', () => {
    expect(planCodexThemeMigration(
      { [APPEARANCE_THEME_KEY]: 'pub.two/aqua', [MERMAID_THEME_KEY]: 'codex' },
      false,
    )).toEqual({
      action: 'clean-legacy',
      overlayPatch: { [MERMAID_THEME_KEY]: 'default' },
      guide: false,
    })
  })

  it('档 2b：新键为组件主题身份且旧键无 codex 残留 → 无操作', () => {
    expect(planCodexThemeMigration({ [APPEARANCE_THEME_KEY]: 'pub.two/aqua' }, false))
      .toEqual({ action: 'none', overlayPatch: {}, guide: false })
    expect(planCodexThemeMigration({ [APPEARANCE_THEME_KEY]: 'pub.two/aqua', [MERMAID_THEME_KEY]: 'default' }, false))
      .toEqual({ action: 'none', overlayPatch: {}, guide: false })
  })

  it('档 3：新键 default/缺失且旧键非 codex → 无操作', () => {
    expect(planCodexThemeMigration(undefined, false)).toEqual({ action: 'none', overlayPatch: {}, guide: false })
    expect(planCodexThemeMigration({}, false)).toEqual({ action: 'none', overlayPatch: {}, guide: false })
    expect(planCodexThemeMigration({ [MERMAID_THEME_KEY]: 'default' }, false))
      .toEqual({ action: 'none', overlayPatch: {}, guide: false })
    expect(planCodexThemeMigration({ [APPEARANCE_THEME_KEY]: 'default' }, false))
      .toEqual({ action: 'none', overlayPatch: {}, guide: false })
  })

  it('原始 overlay 形态防御：数组/非对象值 → 无操作', () => {
    expect(planCodexThemeMigration(['codex'], false)).toEqual({ action: 'none', overlayPatch: {}, guide: false })
    expect(planCodexThemeMigration('codex', false)).toEqual({ action: 'none', overlayPatch: {}, guide: false })
  })

  it('迁移已完成（done 标记）→ 无操作（不再迁移、不再引导——重开/重启/多窗口只一次的判据）', () => {
    expect(planCodexThemeMigration({ [MERMAID_THEME_KEY]: 'codex' }, true))
      .toEqual({ action: 'none', overlayPatch: {}, guide: false })
    expect(planCodexThemeMigration({ [APPEARANCE_THEME_KEY]: 'codex' }, true))
      .toEqual({ action: 'none', overlayPatch: {}, guide: false })
  })
})

// ---- 标记形态（pending-guide 状态机） ----

describe('parseCodexMigrationMarker（标记形态守卫）', () => {
  it('合法形态：{ state, version }（pending = 引导欠账，done = 迁移收口）', () => {
    expect(parseCodexMigrationMarker({ state: 'pending', version: '1.2.3' }))
      .toEqual({ state: 'pending', version: '1.2.3' })
    expect(parseCodexMigrationMarker({ state: 'done', version: '1.2.3' }))
      .toEqual({ state: 'done', version: '1.2.3' })
  })

  it('非对象/未知状态/版本非字符串 → null（视为无标记：恢复按 overlay 判据走）', () => {
    expect(parseCodexMigrationMarker(undefined)).toBeNull()
    expect(parseCodexMigrationMarker('1.1.0')).toBeNull()
    expect(parseCodexMigrationMarker(null)).toBeNull()
    expect(parseCodexMigrationMarker({ state: 'unknown', version: '1.2.3' })).toBeNull()
    expect(parseCodexMigrationMarker({ state: 'done' })).toBeNull()
    expect(parseCodexMigrationMarker({ state: 'done', version: 3 })).toBeNull()
    expect(parseCodexMigrationMarker(['done'])).toBeNull()
  })
})

// ---- 宿主编排 ----

/** 内存锁（P2-B 后端口为锁句柄；takeover 语义的内存等价——细节协议由
 * codexMigrationLock.test.ts 以真实 fs 钉住，此处只承载编排场景） */
interface FakeLock {
  /** 预置一个已占用锁；ageMs 供陈旧判定（默认 0 = 活跃） */
  hold(ageMs?: number): void
  isHeld(): boolean
}

function makeFakeLock(): FakeLock & { handle: CodexMigrationLockHandle } {
  const state = { held: false, ageMs: 0 }
  const handle: CodexMigrationLockHandle = {
    tryAcquire: async () => {
      if (state.held) return false
      state.held = true
      state.ageMs = 0
      return true
    },
    takeoverIfStale: async (staleMs: number) => {
      if (!state.held) return handle.tryAcquire()
      if (state.ageMs <= staleMs) return false
      state.held = false
      return handle.tryAcquire()
    },
    release: async () => {
      state.held = false
      state.ageMs = 0
    },
    ageMs: async () => (state.held ? state.ageMs : null),
    forceCleanup: async () => {
      state.held = false
      state.ageMs = 0
    },
  }
  return {
    handle,
    hold(ageMs = 0) {
      state.held = true
      state.ageMs = ageMs
    },
    isHeld: () => state.held,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fakePorts(
  rawOverlay: unknown,
  marker: CodexMigrationMarker | undefined = undefined,
): {
  ports: CodexMigrationPorts
  state: {
    overlay: unknown
    marker: CodexMigrationMarker | undefined
    markers: Map<string, CodexMigrationMarker>
    guides: number
    events: string[]
    profileId: string | null
  }
  lock: FakeLock
} {
  const state = {
    overlay: rawOverlay,
    /** B'：按身份分箱的 marker 读箱（真实 fs 分居语义的内存等价） */
    markers: new Map<string, CodexMigrationMarker>(
      marker !== undefined ? [[TEST_PROFILE_ID, marker]] : [],
    ),
    /** 最后写入的 marker（诊断面；读判走 markers 分箱） */
    marker,
    guides: 0,
    events: [] as string[],
    profileId: TEST_PROFILE_ID as string | null,
  }
  const lock = makeFakeLock()
  const ports: CodexMigrationPorts = {
    readRawOverlay: () => state.overlay,
    // P2-A（PR #581 三审）：端口为互斥「读-判-写」——fake 以同快照合成；
    // 覆盖点（写失败/写后崩场景）由用例替换整个方法
    applyExclusiveOverlayStep: async (step) => {
      const { patch, result } = step(state.overlay)
      if (patch !== null) {
        state.events.push('write-overlay')
        state.overlay = { ...(isRecord(state.overlay) ? state.overlay : {}), ...patch }
      }
      return result
    },
    // B' 身份端口：读序同生产（独立键 → overlay 载体）；marker 按身份分箱
    readProfileId: async () => {
      if (state.profileId !== null) return state.profileId
      const fromOverlay = isRecord(state.overlay)
        ? state.overlay[CODEX_MIGRATION_PROFILE_ID_OVERLAY_KEY]
        : undefined
      return typeof fromOverlay === 'string' && fromOverlay !== '' ? fromOverlay : null
    },
    writeProfileId: async (id) => {
      state.profileId = id
    },
    readMarker: async (profileId) => state.markers.get(profileId) ?? null,
    writeMarker: async (profileId, markerToWrite) => {
      state.events.push(`write-marker:${markerToWrite.state}`)
      state.markers.set(profileId, markerToWrite)
      state.marker = markerToWrite
    },
    extensionVersion: () => '1.2.3-test',
    requestGuide: () => {
      state.events.push('guide')
      state.guides += 1
    },
    lock: lock.handle,
  }
  return { ports, state, lock }
}

describe('runCodexThemeMigration（宿主编排：持久化顺序）', () => {
  it('迁移：先写 pending 标记、再改设置、发引导、写 done——持久化先于引导（写锁不依赖用户响应）', async () => {
    const { ports, state, lock } = fakePorts({ [MERMAID_THEME_KEY]: 'codex' })
    const result = await runCodexThemeMigration(ports)
    expect(result).toEqual({ action: 'migrate', guide: true })
    expect(state.overlay).toEqual({
      [APPEARANCE_THEME_KEY]: 'default',
      [MERMAID_THEME_KEY]: 'default',
      ...PROFILE_ID_IN_OVERLAY, // B'：身份随迁移补丁同批落 overlay（第二载体）
    })
    expect(state.marker).toEqual({ state: 'done', version: '1.2.3-test' })
    expect(state.guides).toBe(1)
    // 顺序：pending → overlay → guide → done（引导前已有 pending 兜底——
    // 中断后可恢复补发；done 收口后不再引导）
    expect(state.events).toEqual(['write-marker:pending', 'write-overlay', 'guide', 'write-marker:done'])
    expect(lock.isHeld()).toBe(false)
  })

  it('迁移保留原始 overlay 中的无关键（增量补丁语义）', async () => {
    const { ports, state } = fakePorts({ [MERMAID_THEME_KEY]: 'codex', 'editor.readableLineWidth': 800 })
    await runCodexThemeMigration(ports)
    expect(state.overlay).toEqual({
      [APPEARANCE_THEME_KEY]: 'default',
      [MERMAID_THEME_KEY]: 'default',
      'editor.readableLineWidth': 800,
      ...PROFILE_ID_IN_OVERLAY,
    })
  })

  it('clean-legacy：只清旧键、不写标记、不引导', async () => {
    const { ports, state } = fakePorts({ [APPEARANCE_THEME_KEY]: 'pub.two/aqua', [MERMAID_THEME_KEY]: 'codex' })
    const result = await runCodexThemeMigration(ports)
    expect(result).toEqual({ action: 'clean-legacy', guide: false })
    expect(state.overlay).toEqual({
      [APPEARANCE_THEME_KEY]: 'pub.two/aqua',
      [MERMAID_THEME_KEY]: 'default',
      ...PROFILE_ID_IN_OVERLAY,
    })
    expect(state.marker).toBeUndefined()
    expect(state.guides).toBe(0)
  })

  it('无操作：不读不写不引导、不碰锁', async () => {
    const { ports, state, lock } = fakePorts({ [MERMAID_THEME_KEY]: 'default' })
    const result = await runCodexThemeMigration(ports)
    expect(result).toEqual({ action: 'none', guide: false })
    expect(state.events).toEqual([])
    expect(state.guides).toBe(0)
    expect(lock.isHeld()).toBe(false)
  })

  it('done 标记在场：无操作（重开/重启/多窗口不重复引导；快速路径不抢锁）', async () => {
    const { ports, state, lock } = fakePorts(
      { [MERMAID_THEME_KEY]: 'codex' },
      { state: 'done', version: '1.1.0' },
    )
    lock.hold() // 锁被他人占用也不影响——done 短路在认领之前
    const result = await runCodexThemeMigration(ports)
    expect(result).toEqual({ action: 'none', guide: false })
    expect(state.overlay).toEqual({ [MERMAID_THEME_KEY]: 'codex' })
    expect(state.guides).toBe(0)
    expect(state.events).toEqual([])
  })

  it('设置写失败：异常传播、引导未发（pending 已写——下次激活按恢复规则重走完整迁移）', async () => {
    const { ports, state } = fakePorts({ [MERMAID_THEME_KEY]: 'codex' })
    ports.applyExclusiveOverlayStep = async () => {
      throw new Error('storage down')
    }
    await expect(runCodexThemeMigration(ports)).rejects.toThrow('storage down')
    expect(state.marker).toEqual({ state: 'pending', version: '1.2.3-test' })
    expect(state.guides).toBe(0)
  })
})

// ---- 发现 1：pending-guide 恢复语义（评审场景契约化） ----

describe('runCodexThemeMigration（迁移中断恢复——PR #581 评审发现 1）', () => {
  it('场景 A（评审复现）：设置已迁移、引导发出前中断 → 恢复重跑补发引导恰一次', async () => {
    // 构造评审方场景的等价状态：旧代码在「改设置成功、标记写失败/进程退出」
    // 后，设置已回落但引导永不补发。新序列把该中断点落在 write-overlay 成功
    // 之后（引导未发、done 未写）——恢复存储后重跑必须补发恰一次。
    const { ports, state } = fakePorts({ [MERMAID_THEME_KEY]: 'codex' })
    ports.applyExclusiveOverlayStep = async (step) => {
      const { patch, result } = step(state.overlay)
      if (patch !== null) {
        state.overlay = { ...(isRecord(state.overlay) ? state.overlay : {}), ...patch }
        throw new Error('simulated crash after overlay write')
      }
      return result
    }
    await expect(runCodexThemeMigration(ports)).rejects.toThrow('simulated crash after overlay write')
    expect(state.guides).toBe(0)
    expect(state.marker).toEqual({ state: 'pending', version: '1.2.3-test' })
    expect(state.overlay).toEqual({
      [APPEARANCE_THEME_KEY]: 'default',
      [MERMAID_THEME_KEY]: 'default',
      ...PROFILE_ID_IN_OVERLAY,
    })
    // 恢复存储重跑（模拟下次激活）：已迁移（plan none）+ pending → 补发引导 + done
    const retry = await runCodexThemeMigration(ports)
    expect(retry).toEqual({ action: 'none', guide: true })
    expect(state.guides).toBe(1)
    expect(state.marker).toEqual({ state: 'done', version: '1.2.3-test' })
    // 再跑：done 收口 → 不再引导（引导恰一次）
    const third = await runCodexThemeMigration(ports)
    expect(third).toEqual({ action: 'none', guide: false })
    expect(state.guides).toBe(1)
  })

  it('场景 B：pending 写成功、设置写失败 → 恢复重跑走完整迁移（幂等）', async () => {
    const { ports, state } = fakePorts({ [MERMAID_THEME_KEY]: 'codex' })
    ports.applyExclusiveOverlayStep = async () => {
      throw new Error('storage down')
    }
    await expect(runCodexThemeMigration(ports)).rejects.toThrow('storage down')
    expect(state.guides).toBe(0)
    expect(state.overlay).toEqual({ [MERMAID_THEME_KEY]: 'codex' })
    expect(state.marker).toEqual({ state: 'pending', version: '1.2.3-test' })
    // 恢复存储重跑：原始 overlay 仍是 codex → 完整迁移重走（幂等）
    ports.applyExclusiveOverlayStep = async (step) => {
      const { patch, result } = step(state.overlay)
      if (patch !== null) {
        state.overlay = { ...(isRecord(state.overlay) ? state.overlay : {}), ...patch }
      }
      return result
    }
    const retry = await runCodexThemeMigration(ports)
    expect(retry).toEqual({ action: 'migrate', guide: true })
    expect(state.guides).toBe(1)
    expect(state.overlay).toEqual({
      [APPEARANCE_THEME_KEY]: 'default',
      [MERMAID_THEME_KEY]: 'default',
      ...PROFILE_ID_IN_OVERLAY,
    })
    expect(state.marker).toEqual({ state: 'done', version: '1.2.3-test' })
  })

  it('残余边界（文档化）：done 写失败时引导已发，恢复重跑会再补发一次（总 2 次）', async () => {
    // 引导 fire 与 done 写之间无 await（同步序）——该窗口内进程被 kill 或
    // done 持久化失败时，恢复路径只能按 pending 补发，可能双弹一次。这是
    // 声明的极端边界（与「进程级 kill 的同步序残余窗口」同类），比「引导
    // 永久丢失」（发现 1 修复前的行为）代价小。
    const { ports, state } = fakePorts({ [MERMAID_THEME_KEY]: 'codex' })
    let failDoneOnce = true
    const originalWriteMarker = ports.writeMarker
    ports.writeMarker = async (profileId, marker) => {
      if (marker.state === 'done' && failDoneOnce) {
        failDoneOnce = false
        throw new Error('marker write down')
      }
      await originalWriteMarker(profileId, marker)
    }
    await expect(runCodexThemeMigration(ports)).rejects.toThrow('marker write down')
    expect(state.guides).toBe(1)
    expect(state.marker).toEqual({ state: 'pending', version: '1.2.3-test' })
    const retry = await runCodexThemeMigration(ports)
    expect(retry).toEqual({ action: 'none', guide: true })
    expect(state.guides).toBe(2)
    expect(state.marker).toEqual({ state: 'done', version: '1.2.3-test' })
  })

  it('pending 残留且 overlay 处于档 2（用户在窗口期改选组件主题）：清旧键并补发引导收口', async () => {
    // pending = 引导欠账：无论恢复时计划落在哪一档，认领成功后补发引导并
    // 写 done 收口；clean-legacy 自身的清旧键语义照走
    const { ports, state } = fakePorts(
      { [APPEARANCE_THEME_KEY]: 'pub.two/aqua', [MERMAID_THEME_KEY]: 'codex' },
      { state: 'pending', version: '1.2.3-test' },
    )
    const result = await runCodexThemeMigration(ports)
    expect(result).toEqual({ action: 'clean-legacy', guide: true })
    expect(state.overlay).toEqual({
      [APPEARANCE_THEME_KEY]: 'pub.two/aqua',
      [MERMAID_THEME_KEY]: 'default',
      ...PROFILE_ID_IN_OVERLAY,
    })
    expect(state.guides).toBe(1)
    expect(state.marker).toEqual({ state: 'done', version: '1.2.3-test' })
  })
})

// ---- 发现 2：多窗口并发认领（评审场景契约化） ----

describe('runCodexThemeMigration（多窗口并发——PR #581 评审发现 2）', () => {
  it('并发两次调用（写入屏障挂起胜者）→ 引导恰一次，败者静默等待 done', async () => {
    const { ports, state } = fakePorts({ [MERMAID_THEME_KEY]: 'codex' })
    let releaseBarrier: (() => void) | undefined
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve
    })
    const originalWrite = ports.applyExclusiveOverlayStep
    ports.applyExclusiveOverlayStep = async (step) => {
      await barrier // 受控写入屏障：挂起胜者的设置写（评审方同款手法）
      return originalWrite(step)
    }
    // 两个窗口并发激活（同一 profile：同 overlay、同标记、同锁）
    const runA = runCodexThemeMigration(ports, { pollIntervalMs: 10 })
    const runB = runCodexThemeMigration(ports, { pollIntervalMs: 10 })
    await new Promise((resolve) => setTimeout(resolve, 20)) // 胜者挂起在屏障、败者进入等待
    releaseBarrier!()
    const [a, b] = await Promise.all([runA, runB])
    // 恰一个窗口完成迁移并引导，另一个静默退出（绝不通告）
    const results = [a, b].map((r) => `${r.action}:${r.guide}`).sort()
    expect(results).toEqual(['migrate:true', 'none:false'])
    expect(state.guides).toBe(1)
    expect(state.marker).toEqual({ state: 'done', version: '1.2.3-test' })
    expect(state.overlay).toEqual({
      [APPEARANCE_THEME_KEY]: 'default',
      [MERMAID_THEME_KEY]: 'default',
      ...PROFILE_ID_IN_OVERLAY,
    })
  })

  it('胜者崩溃（锁残留且 mtime 陈旧）→ 后续激活接管补完（引导欠账必达）', async () => {
    // 胜者写 pending 后被 kill：finally 不执行、锁残留。锁 mtime 超过陈旧
    // 阈值后，后续激活删除重抢并按恢复规则补完
    const { ports, state, lock } = fakePorts(
      { [APPEARANCE_THEME_KEY]: 'default', [MERMAID_THEME_KEY]: 'default' },
      { state: 'pending', version: '1.2.3-test' },
    )
    lock.hold(60_000) // 残留锁，mtime 已陈旧（远超阈值）
    const result = await runCodexThemeMigration(ports)
    expect(result).toEqual({ action: 'none', guide: true })
    expect(state.guides).toBe(1)
    expect(state.marker).toEqual({ state: 'done', version: '1.2.3-test' })
    expect(lock.isHeld()).toBe(false)
  })

  it('胜者崩溃且 overlay 未迁移（锁陈旧）→ 接管者重走完整迁移', async () => {
    const { ports, state, lock } = fakePorts(
      { [MERMAID_THEME_KEY]: 'codex' },
      { state: 'pending', version: '1.2.3-test' },
    )
    lock.hold(60_000)
    const result = await runCodexThemeMigration(ports)
    expect(result).toEqual({ action: 'migrate', guide: true })
    expect(state.guides).toBe(1)
    expect(state.overlay).toEqual({
      [APPEARANCE_THEME_KEY]: 'default',
      [MERMAID_THEME_KEY]: 'default',
      ...PROFILE_ID_IN_OVERLAY,
    })
    expect(state.marker).toEqual({ state: 'done', version: '1.2.3-test' })
  })

  it('认领失败且等待超时：静默退出、绝不通知（本次不引导，待下次激活恢复）', async () => {
    const { ports, state, lock } = fakePorts({ [MERMAID_THEME_KEY]: 'codex' })
    lock.hold() // 活跃胜者持有（mtime 新鲜）
    const result = await runCodexThemeMigration(ports, { waitTimeoutMs: 40, pollIntervalMs: 10 })
    expect(result).toEqual({ action: 'none', guide: false })
    expect(state.guides).toBe(0)
    expect(state.events).toEqual([])
    expect(lock.isHeld()).toBe(true)
  })
})

// ---- B'（PR #581 五审 P2-C）：profile 身份快速路径与锁内生成 ----

describe("runCodexThemeMigration（B' 身份解析）", () => {
  it('无身份且无迁移负担 → 零开销退出：不生成身份、不碰锁、不写盘', async () => {
    const { ports, state, lock } = fakePorts({ [MERMAID_THEME_KEY]: 'default' })
    state.profileId = null // 尚无身份
    const result = await runCodexThemeMigration(ports, { profileIdWaitMs: 0 })
    expect(result).toEqual({ action: 'none', guide: false })
    expect(state.profileId).toBeNull() // 未生成（无需迁移的 profile 零负担）
    expect(state.events).toEqual([])
    expect(lock.isHeld()).toBe(false)
  })

  it('无身份且需要迁移 → 锁内生成身份，并随迁移补丁同批落 overlay（第二载体）', async () => {
    const { ports, state } = fakePorts({ [MERMAID_THEME_KEY]: 'codex' })
    state.profileId = null
    const result = await runCodexThemeMigration(ports, { profileIdWaitMs: 0, profileIdPollMs: 1 })
    expect(result).toEqual({ action: 'migrate', guide: true })
    expect(state.profileId).not.toBeNull()
    const overlay = state.overlay as Record<string, unknown>
    expect(overlay[CODEX_MIGRATION_PROFILE_ID_OVERLAY_KEY]).toBe(state.profileId)
    expect(state.markers.get(state.profileId!)).toEqual({ state: 'done', version: '1.2.3-test' })
  })

  it('独立键丢失、overlay 载体在场 → 身份从载体恢复，读到既有 done 快速短路', async () => {
    const { ports, state } = fakePorts(
      { [MERMAID_THEME_KEY]: 'codex', [CODEX_MIGRATION_PROFILE_ID_OVERLAY_KEY]: TEST_PROFILE_ID },
      { state: 'done', version: '1.1.0' },
    )
    state.profileId = null // 独立键丢失
    const result = await runCodexThemeMigration(ports, { profileIdWaitMs: 0 })
    expect(result).toEqual({ action: 'none', guide: false })
    // 身份恢复成功 → 既有 done 短路；若身份丢失则生成新身份 → 无 done →
    // 重走迁移并引导（本用例反向钉住载体恢复语义）
    expect(state.guides).toBe(0)
    expect(state.events).toEqual([])
  })
})

// P2-B（PR #581 三审）：完成标记的 globalState 独立键已随磁盘权威化退役
// （state JSON 于 globalStorageUri 下，跨窗口一致、不依赖 memento 缓存；
// 五审 B' 起按 profile 身份命名分居）——双窗口独立缓存场景见
// codexMigrationReview3.test.ts，双 profile 分居场景见 codexMigrationReview5.test.ts。
