// T06（#355）宿主历史协调器契约测试（纯逻辑，端口注入）。
//
// 钉住票面与 V01 放行边界的协调器语义：
// - 版本对位链（缺口/超前 → mapping-lost，F4/F5）
// - 条目流重建：addon（atomic 开组 / joinPrevious 并组 / 合并笔 joined）
//   与 foreign；归属对位 + 迟到归属兜底
// - gateSubmit：joinPrevious 四种拒绝形态（空日志/仅外来/组顶被打断/
//   映射失配），atomic 恒放行
// - 外部单步撤销/重做的组补完（含 F3 前置检查——补完时点对象核对、
//   F4 自驱吸收——预期版本集合、F2 执行时点计划）
// - ABCD 撤回/重做单位（A+B、C+D）；外来条目单步单位
// - Undo 后新写截断 redo；旧区深度镜像（条目区外 undo/redo 不错位）
// - 持久化快照：文本指纹对账恢复（命中归位/未命中 lost）
import { describe, expect, it, vi } from 'vitest'
import {
  AddonHistoryCoordinator,
  textFingerprint,
  type AddonHistoryCoordinatorPorts,
  type AddonHistorySnapshotData,
} from '../../src/host/addonHistoryCoordinator'
import type { EditOriginMeta } from '../../src/shared/editOrigin'

const ORIGIN_A: EditOriginMeta = { addonId: 'pub.addon', opId: 'op-a', undo: 'atomic' }
const ORIGIN_B: EditOriginMeta = { addonId: 'pub.addon', opId: 'op-b', undo: 'joinPrevious' }
const ORIGIN_C: EditOriginMeta = { addonId: 'pub.addon', opId: 'op-c', undo: 'atomic' }
const ORIGIN_D: EditOriginMeta = { addonId: 'pub.addon', opId: 'op-d', undo: 'joinPrevious' }

interface Harness {
  coord: AddonHistoryCoordinator
  runHistorySteps: ReturnType<typeof vi.fn>
  saved: AddonHistorySnapshotData[]
  attribute(version: number, origin: EditOriginMeta, joined?: EditOriginMeta[]): void
}

function harness(initial: { version: number; restore?: AddonHistorySnapshotData; initialText?: string } = { version: 0 }): Harness {
  const runHistorySteps = vi.fn(async (_op: 'undo' | 'redo', steps: number) => {
    return { executedSteps: steps }
  })
  const saved: AddonHistorySnapshotData[] = []
  const attributions = new Map<number, { origin: EditOriginMeta; joined?: EditOriginMeta[] }>()
  const ports: AddonHistoryCoordinatorPorts = {
    runHistorySteps: (op, steps) => runHistorySteps(op, steps),
    originAt: (version) => attributions.get(version),
    save: (snap) => saved.push(snap),
    log: () => {},
  }
  const coord = new AddonHistoryCoordinator(ports, initial)
  return {
    coord,
    runHistorySteps,
    saved,
    attribute(version, origin, joined) {
      attributions.set(version, { origin, ...(joined ? { joined } : {}) })
    },
  }
}

/** 前向写入回流（无 reason） */
function forward(h: unknown, version: number): void {
  ;(h as { coord: AddonHistoryCoordinator }).coord.observeChange({ version })
}

/** 外部历史回流 */
function backflow(h: unknown, version: number, reason: 'undo' | 'redo'): void {
  ;(h as { coord: AddonHistoryCoordinator }).coord.observeChange({ version, reason })
}

/** 等待补完链落定（宏任务排空全部 microtask 层级） */
async function settle(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0))
}

describe('版本对位与条目流', () => {
  it('前向归属对位：atomic 开组、joinPrevious 并组、外来 foreign、合并笔 joined 保留', () => {
    const h = harness({ version: 0 })
    h.attribute(1, ORIGIN_A)
    h.attribute(2, ORIGIN_B)
    forward(h, 1)
    forward(h, 2)
    const state = h.coord.observe()
    expect(state.applied).toBe(2)
    expect(state.entries[0]).toMatchObject({ version: 1, owner: 'addon', groupId: 'op-a', atomic: true })
    expect(state.entries[1]).toMatchObject({ version: 2, owner: 'addon', groupId: 'op-a' })
    expect(state.lost).toBe(false)
  })

  it('外来写入不建组（单步撤回单位）', () => {
    const h = harness({ version: 0 })
    forward(h, 1)
    const state = h.coord.observe()
    expect(state.entries[0]).toMatchObject({ version: 1, owner: 'foreign' })
    expect(state.entries[0]!.groupId).toBeUndefined()
  })

  it('合并笔（atomic + joined joinPrevious）一条 entry 保留逐次 opId', () => {
    const h = harness({ version: 0 })
    h.attribute(1, ORIGIN_A, [ORIGIN_B])
    forward(h, 1)
    const state = h.coord.observe()
    expect(state.entries[0]).toMatchObject({ owner: 'addon', groupId: 'op-a', atomic: true, joinedOpIds: ['op-b'] })
  })

  it('迟到归属兜底矫正（兜底确认路径先记 foreign 后归位）', () => {
    const h = harness({ version: 0 })
    forward(h, 1) // attribution 未登记 → foreign
    h.coord.noteAttribution(1, ORIGIN_A)
    const state = h.coord.observe()
    expect(state.entries[0]).toMatchObject({ owner: 'addon', groupId: 'op-a' })
  })

  it('版本链缺口 → mapping-lost（此后一切拒绝）', () => {
    const h = harness({ version: 0 })
    forward(h, 1)
    h.coord.observeChange({ version: 5 })
    expect(h.coord.lost).toBe(true)
    expect(h.coord.gateSubmit(ORIGIN_B)).toBe(false)
    expect(h.coord.planCompletion('undo')).toEqual({ reject: 'mapping-lost' })
  })
})

describe('gateSubmit（HistoryBoundaryUnavailable 四形态）', () => {
  it('空日志 / 仅外来写入 / 组顶被外来打断 / lost 都拒绝 joinPrevious；atomic 恒放行', () => {
    const empty = harness({ version: 0 })
    expect(empty.coord.gateSubmit(ORIGIN_B)).toBe(false) // 空日志
    expect(empty.coord.gateSubmit(ORIGIN_A)).toBe(true) // atomic 放行

    const foreignOnly = harness({ version: 0 })
    forward(foreignOnly, 1)
    expect(foreignOnly.coord.gateSubmit(ORIGIN_B)).toBe(false) // 仅外来写入

    const interrupted = harness({ version: 0 })
    interrupted.attribute(1, ORIGIN_A)
    forward(interrupted, 1)
    forward(interrupted, 2) // 外来写入打断组顶
    expect(interrupted.coord.gateSubmit(ORIGIN_B)).toBe(false)
  })

  it('栈顶为 addon 条目时 joinPrevious 放行', () => {
    const h = harness({ version: 0 })
    h.attribute(1, ORIGIN_A)
    forward(h, 1)
    expect(h.coord.gateSubmit(ORIGIN_B)).toBe(true)
  })
})

describe('外部回流补完（F2/F3/F4）', () => {
  it('ABCD 序列：外部单步 undo 触发组补完，一次撤完 C+D；再撤 A+B', async () => {
    const h = harness({ version: 0 })
    h.attribute(1, ORIGIN_A)
    h.attribute(2, ORIGIN_B)
    h.attribute(3, ORIGIN_C)
    h.attribute(4, ORIGIN_D)
    for (let v = 1; v <= 4; v++) {
      forward(h, v)
    }
    // Ctrl+Z #1：外部撤 D（版本 5）→ 补完撤 C（版本 6，自驱）
    let nextVersion = 5
    h.runHistorySteps.mockImplementation(async (op: "undo" | "redo", steps: number) => {
      for (let i = 0; i < steps; i++) {
        h.coord.observeChange({ version: nextVersion, reason: op })
        nextVersion += 1
      }
      return { executedSteps: steps }
    })
    backflow(h, nextVersion++, 'undo')
    await settle()
    let state = h.coord.observe()
    expect(state.applied).toBe(2) // C+D 撤完（A+B 在）
    expect(h.runHistorySteps).toHaveBeenCalledWith('undo', 1)

    // Ctrl+Z #2：外部撤 B → 补完撤 A
    backflow(h, nextVersion++, 'undo')
    await settle()
    state = h.coord.observe()
    expect(state.applied).toBe(0)
    expect(h.coord.lost).toBe(false)

    // Ctrl+Shift+Z：外部 redo A → 补完 redo B
    backflow(h, nextVersion++, 'redo')
    await settle()
    state = h.coord.observe()
    expect(state.applied).toBe(2) // A+B 重做
    expect(state.lost).toBe(false)
  })

  it('外来条目外部 undo 单步单位：不触发补完', async () => {
    const h = harness({ version: 0 })
    forward(h, 1) // foreign
    backflow(h, 2, 'undo')
    await settle()
    expect(h.runHistorySteps).not.toHaveBeenCalled()
    expect(h.coord.observe().applied).toBe(0)
    expect(h.coord.lost).toBe(false)
  })

  it('连续非原子同组：外部撤组尾后补完余下全部（B1+B2+B3 各自成条）', async () => {
    const h = harness({ version: 0 })
    h.attribute(1, ORIGIN_A)
    forward(h, 1)
    for (const [v, op] of [[2, 'op-b1'], [3, 'op-b2'], [4, 'op-b3']] as const) {
      h.attribute(v, { addonId: 'pub.addon', opId: op, undo: 'joinPrevious' })
      forward(h, v)
    }
    let nextVersion = 5
    h.runHistorySteps.mockImplementation(async (op: "undo" | "redo", steps: number) => {
      for (let i = 0; i < steps; i++) {
        h.coord.observeChange({ version: nextVersion, reason: op })
        nextVersion += 1
      }
      return { executedSteps: steps }
    })
    backflow(h, nextVersion++, 'undo') // 撤 B3
    await settle()
    expect(h.runHistorySteps).toHaveBeenCalledWith('undo', 3) // B2、B1、A
    expect(h.coord.observe().applied).toBe(0)
  })

  it('Undo 后新写入截断 redo 区（被截断条目不残留）', () => {
    const h = harness({ version: 0 })
    h.attribute(1, ORIGIN_A)
    forward(h, 1)
    backflow(h, 2, 'undo')
    // 新外来写入 → 截断
    forward(h, 3)
    const state = h.coord.observe()
    expect(state.entries.length).toBe(1)
    expect(state.entries[0]).toMatchObject({ version: 3, owner: 'foreign' })
    expect(state.applied).toBe(1)
  })

  it('旧区深度镜像：条目区撤空后 undo 入旧区、redo 先回旧区（不 lost、不错位）', async () => {
    const h = harness({ version: 0 })
    h.attribute(1, ORIGIN_A)
    forward(h, 1)
    backflow(h, 2, 'undo') // 撤空条目区
    backflow(h, 3, 'undo') // 旧区 #1
    backflow(h, 4, 'undo') // 旧区 #2
    expect(h.coord.lost).toBe(false)
    expect(h.coord.observe().applied).toBe(0)
    backflow(h, 5, 'redo') // 旧区 #2 回
    backflow(h, 6, 'redo') // 旧区 #1 回
    expect(h.coord.lost).toBe(false)
    expect(h.coord.observe().applied).toBe(0) // 条目区尚未重做
    // 再 redo → 条目区 A（外部单步）+ 补完
    let nextVersion = 7
    h.runHistorySteps.mockImplementation(async (op: "undo" | "redo", steps: number) => {
      for (let i = 0; i < steps; i++) {
        h.coord.observeChange({ version: nextVersion, reason: op })
        nextVersion += 1
      }
      return { executedSteps: steps }
    })
    backflow(h, nextVersion++, 'redo')
    expect(h.coord.observe().applied).toBe(1)
    expect(h.coord.lost).toBe(false)
  })

  it('补完执行中断（aborted）：按实际吸收推进、协调保持（不 lost）', async () => {
    const h = harness({ version: 0 })
    h.attribute(1, ORIGIN_A)
    forward(h, 1)
    for (const [v, op] of [[2, 'op-b1'], [3, 'op-b2']] as const) {
      h.attribute(v, { addonId: 'pub.addon', opId: op, undo: 'joinPrevious' })
      forward(h, v)
    }
    let nextVersion = 4
    h.runHistorySteps.mockImplementation(async (op: 'undo' | 'redo') => {
      // 只成功一步（第二步版本失配中止）
      h.coord.observeChange({ version: nextVersion, reason: op })
      nextVersion += 1
      return { executedSteps: 1, aborted: 'version-mismatch' as const }
    })
    backflow(h, nextVersion++, 'undo') // 撤 B2
    await settle()
    expect(h.coord.observe().applied).toBe(1) // B1 已补完撤掉，A 在
    expect(h.coord.lost).toBe(false)
  })

  it('补完核对失配（absorbed ≠ executed）→ lost', async () => {
    const h = harness({ version: 0 })
    h.attribute(1, ORIGIN_A)
    h.attribute(2, ORIGIN_B)
    forward(h, 1)
    forward(h, 2)
    // runHistorySteps 声称执行但回流没有到达（吸收 0）
    h.runHistorySteps.mockImplementation(async () => ({ executedSteps: 1 }))
    backflow(h, 3, 'undo')
    await settle()
    expect(h.coord.lost).toBe(true)
  })
})

describe('持久化快照恢复', () => {
  it('当前文本与保存态一致 → 采信指针继续；不一致 → 保守 lost', () => {
    const textA = 'state-after-a'
    const snap: AddonHistorySnapshotData = {
      entries: [{ version: 1, owner: 'addon', groupId: 'op-a', atomic: true }],
      applied: 1,
      lost: false,
      version: 1,
      textHash: textFingerprint(textA),
    }
    const restored = harness({ version: 9, restore: snap, initialText: textA })
    expect(restored.coord.lost).toBe(false)
    expect(restored.coord.observe().applied).toBe(1)

    const miss = harness({ version: 9, restore: snap, initialText: 'different' })
    expect(miss.coord.lost).toBe(true)
  })

  it('serialize 以当前全文指纹为对账锚', () => {
    const h = harness({ version: 0 })
    h.attribute(1, ORIGIN_A)
    forward(h, 1)
    const data = h.coord.serialize(1, 'body')
    expect(data.textHash).toBe(textFingerprint('body'))
    expect(data.applied).toBe(1)
    expect(data.entries[0]).toMatchObject({ groupId: 'op-a' })
  })
})
