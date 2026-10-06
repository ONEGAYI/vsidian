// V01（#348）附加组件历史分组协调——纯逻辑状态机契约测试。
//
// 钉住票面已确认规则的纯逻辑侧：
// - 原子修饰独立成组（一次撤回单位）；非原子修饰归属同目标上次原子组，
//   来源逐次独立跟踪（每条 entry 独立 seq/opId）。
// - 无可归属前项（空日志 / 仅外来写入 / 组顶被外来写入打断）时拒绝提交
//   （HistoryBoundaryUnavailable 语义），不静默换成另一种撤销语义。
// - 撤回/重做计划按「组」给出连续原生步骤与每步预期回流文本；
//   空历史拒绝；Undo 后新写截断 Redo；外部单步回流触发组完成剩余步骤。
// - 版本/历史映射失配 → lost：此后一切协调请求明确拒绝。
// - 快照恢复必须与宿主实际保留状态对得上，对不上即 lost。
import { describe, expect, it } from 'vitest'
import {
  AddonHistoryGrouping,
  type AddonHistoryEntry,
} from '../../src/shared/addonHistoryGrouping'

/** 顺次追加前向条目：版本 +1、文本按 states 推进（固定互不重复状态链） */
function feed(g: AddonHistoryGrouping, states: string[], from: { version: number; text: string }, tag?: (i: number) => { owner: 'addon' | 'foreign'; opId?: string; groupId?: string; atomic?: boolean }): void {
  let cur = from
  states.forEach((text, i) => {
    const meta = tag?.(i) ?? { owner: 'foreign' as const }
    g.noteForwardEntry({
      owner: meta.owner,
      opId: meta.opId,
      groupId: meta.groupId,
      atomic: meta.atomic,
      versionBefore: cur.version,
      textBefore: cur.text,
      versionAfter: cur.version + 1,
      textAfter: text,
    })
    cur = { version: cur.version + 1, text }
  })
}

/** ABCD 标准排列：A 原子、B 非原子（并入 g1）、C 原子、D 非原子（并入 g2） */
function abcd(g: AddonHistoryGrouping): void {
  const specs = [
    { opId: 'A', atomic: true, text: 'A' },
    { opId: 'B', atomic: false, text: 'AB' },
    { opId: 'C', atomic: true, text: 'ABC' },
    { opId: 'D', atomic: false, text: 'ABCD' },
  ] as const
  let cur = { version: 1, text: '' }
  for (const spec of specs) {
    const check = g.planSubmit(spec.opId, spec.atomic)
    expect(check.ok).toBe(true)
    if (!check.ok) throw new Error('unreachable')
    const entry = g.noteForwardEntry({
      owner: 'addon', opId: spec.opId, groupId: check.groupId, atomic: spec.atomic,
      versionBefore: cur.version, textBefore: cur.text,
      versionAfter: cur.version + 1, textAfter: spec.text,
    })
    // ack 版本对位打标（真实路径由探针执行；此处直接验证可定位）
    expect(entry.opId).toBe(spec.opId)
    cur = { version: cur.version + 1, text: spec.text }
  }
}

describe('V01 历史分组：提交归属规则', () => {
  it('空日志的非原子提交拒绝（无同目标前项）', () => {
    const g = new AddonHistoryGrouping()
    expect(g.planSubmit('B0', false)).toEqual({ ok: false, reason: 'boundary-unavailable' })
  })

  it('仅外来写入时非原子提交拒绝（前项不可确认）', () => {
    const g = new AddonHistoryGrouping()
    feed(g, ['用户输入'], { version: 1, text: '' })
    expect(g.planSubmit('B1', false)).toEqual({ ok: false, reason: 'boundary-unavailable' })
  })

  it('组顶被外来写入打断后非原子提交拒绝', () => {
    const g = new AddonHistoryGrouping()
    expect(g.planSubmit('A', true)).toEqual({ ok: true, groupId: 'g1' })
    feed(g, ['A'], { version: 1, text: '' }, () => ({ owner: 'addon', opId: 'A', groupId: 'g1', atomic: true }))
    feed(g, ['A外部'], { version: 2, text: 'A' })
    // A 的组顶被外来写入覆盖：并入会产生非连续组，明确拒绝
    expect(g.planSubmit('B', false)).toEqual({ ok: false, reason: 'boundary-unavailable' })
  })

  it('上次原子已全部撤回后非原子提交拒绝（前项须在已应用区）', () => {
    const g = new AddonHistoryGrouping()
    abcd(g)
    const plan = g.planHistory('undo')
    expect(plan.kind).toBe('execute')
    if (plan.kind !== 'execute') return
    // 应用两步计划（D、C）后 appliedCount = 2（A、B 仍应用）——此处再撤一组
    expect(g.noteUndoBackflow('ABC', 5).matched).toBe(true)
    expect(g.noteUndoBackflow('AB', 6).matched).toBe(true)
    expect(g.noteUndoBackflow('A', 7).matched).toBe(true)
    expect(g.noteUndoBackflow('', 8).matched).toBe(true)
    expect(g.planSubmit('E-late', false)).toEqual({ ok: false, reason: 'boundary-unavailable' })
  })

  it('连续非原子并入同一组；原子开新组', () => {
    const g = new AddonHistoryGrouping()
    // A 原子提交并落地（版本 1→2）
    expect(g.planSubmit('A', true)).toEqual({ ok: true, groupId: 'g1' })
    feed(g, ['A'], { version: 1, text: '' }, () => ({ owner: 'addon', opId: 'A', groupId: 'g1', atomic: true }))
    expect(g.planSubmit('B1', false)).toEqual({ ok: true, groupId: 'g1' })
    feed(g, ['AB1'], { version: 2, text: 'A' }, () => ({ owner: 'addon', opId: 'B1', groupId: 'g1', atomic: false }))
    expect(g.planSubmit('B2', false)).toEqual({ ok: true, groupId: 'g1' })
    feed(g, ['AB1B2'], { version: 3, text: 'AB1' }, () => ({ owner: 'addon', opId: 'B2', groupId: 'g1', atomic: false }))
    expect(g.planSubmit('C', true)).toEqual({ ok: true, groupId: 'g2' })
    // 一次撤回单位 = A+B1+B2 整组（3 步）
    const plan = g.planHistory('undo')
    expect(plan.kind).toBe('execute')
    if (plan.kind !== 'execute') return
    expect(plan.steps.map((s) => s.expectText)).toEqual(['AB1', 'A', ''])
  })
})

describe('V01 历史分组：撤回与重做计划', () => {
  it('ABCD → AB → 空 → AB → ABCD 的组单位计划', () => {
    const g = new AddonHistoryGrouping()
    abcd(g)
    const undo1 = g.planHistory('undo')
    expect(undo1).toEqual({
      kind: 'execute',
      op: 'undo',
      steps: [
        { expectText: 'ABC', entrySeq: 4, groupId: 'g2' },
        { expectText: 'AB', entrySeq: 3, groupId: 'g2' },
      ],
    })
    expect(g.commitPlan(undo1)).toBe(true)
    const undo2 = g.planHistory('undo')
    expect(undo2).toEqual({
      kind: 'execute',
      op: 'undo',
      steps: [
        { expectText: 'A', entrySeq: 2, groupId: 'g1' },
        { expectText: '', entrySeq: 1, groupId: 'g1' },
      ],
    })
    expect(g.commitPlan(undo2)).toBe(true)
    expect(g.planHistory('undo')).toEqual({ kind: 'reject', op: 'undo', reason: 'empty' })
    const redo1 = g.planHistory('redo')
    expect(redo1).toEqual({
      kind: 'execute',
      op: 'redo',
      steps: [
        { expectText: 'A', entrySeq: 1, groupId: 'g1' },
        { expectText: 'AB', entrySeq: 2, groupId: 'g1' },
      ],
    })
    expect(g.commitPlan(redo1)).toBe(true)
    const redo2 = g.planHistory('redo')
    expect(redo2.kind).toBe('execute')
    if (redo2.kind !== 'execute') return
    expect(redo2.steps.map((s) => s.expectText)).toEqual(['ABC', 'ABCD'])
    expect(g.commitPlan(redo2)).toBe(true)
    expect(g.planHistory('redo')).toEqual({ kind: 'reject', op: 'redo', reason: 'empty' })
  })

  it('外来写入条目是独立单步撤回单位（不并组）', () => {
    const g = new AddonHistoryGrouping()
    expect(g.planSubmit('A', true)).toEqual({ ok: true, groupId: 'g1' })
    feed(g, ['A'], { version: 1, text: '' }, () => ({ owner: 'addon', opId: 'A', groupId: 'g1', atomic: true }))
    feed(g, ['A用户'], { version: 2, text: 'A' })
    const plan = g.planHistory('undo')
    expect(plan).toEqual({
      kind: 'execute',
      op: 'undo',
      steps: [{ expectText: 'A', entrySeq: 2 }],
    })
  })

  it('空历史撤回/重做均拒绝', () => {
    const g = new AddonHistoryGrouping()
    expect(g.planHistory('undo')).toEqual({ kind: 'reject', op: 'undo', reason: 'empty' })
    expect(g.planHistory('redo')).toEqual({ kind: 'reject', op: 'redo', reason: 'empty' })
  })

  it('Undo 后新写入截断 Redo：重做拒绝', () => {
    const g = new AddonHistoryGrouping()
    abcd(g)
    expect(g.noteUndoBackflow('ABC', 5).matched).toBe(true)
    expect(g.noteUndoBackflow('AB', 6).matched).toBe(true)
    // 新原子写入：截断 redoable（C、D），g1 之上追加 E（新组）
    expect(g.planSubmit('E', true)).toEqual({ ok: true, groupId: 'g3' })
    feed(g, ['ABE'], { version: 7, text: 'AB' }, () => ({ owner: 'addon', opId: 'E', groupId: 'g3', atomic: true }))
    expect(g.planHistory('redo')).toEqual({ kind: 'reject', op: 'redo', reason: 'empty' })
    const undo = g.planHistory('undo')
    expect(undo.kind).toBe('execute')
    if (undo.kind !== 'execute') return
    expect(undo.steps.map((s) => s.expectText)).toEqual(['AB'])
  })
})

describe('V01 历史分组：回流匹配与组完成', () => {
  it('外部单步撤销落在组中部时返回剩余完成步骤', () => {
    const g = new AddonHistoryGrouping()
    abcd(g)
    // 外部（原生编辑器）撤掉 D：文本回到 ABC，C 同组仍应用 → 需补一步撤 C
    const r = g.noteUndoBackflow('ABC', 5)
    expect(r.matched).toBe(true)
    expect(r.completion).toEqual([{ expectText: 'AB', entrySeq: 3, groupId: 'g2' }])
    expect(g.commitCompletion('undo', r.completion)).toBe(true)
    // 再外部撤 B（组 g1 中部）→ 补撤 A
    const r2 = g.noteUndoBackflow('A', 6)
    expect(r2.matched).toBe(true)
    expect(r2.completion).toEqual([{ expectText: '', entrySeq: 1, groupId: 'g1' }])
  })

  it('外部重做落在组中部时返回剩余完成步骤', () => {
    const g = new AddonHistoryGrouping()
    abcd(g)
    for (const [text, v] of [['ABC', 5], ['AB', 6], ['A', 7], ['', 8]] as const) {
      expect(g.noteUndoBackflow(text, v).matched).toBe(true)
    }
    // 外部重做 A：appliedCount=1，B 同组未重做 → 补一步
    const r = g.noteRedoBackflow('A', 9)
    expect(r.matched).toBe(true)
    expect(r.completion).toEqual([{ expectText: 'AB', entrySeq: 2, groupId: 'g1' }])
  })

  it('回流文本对不上任何边界 → lost，此后一切协调拒绝', () => {
    const g = new AddonHistoryGrouping()
    abcd(g)
    const r = g.noteUndoBackflow('完全未知的文本', 5)
    expect(r.matched).toBe(false)
    expect(g.lost).toBe(true)
    expect(g.planHistory('undo')).toEqual({ kind: 'reject', op: 'undo', reason: 'mapping-lost' })
    expect(g.planHistory('redo')).toEqual({ kind: 'reject', op: 'redo', reason: 'mapping-lost' })
    expect(g.planSubmit('X', true)).toEqual({ ok: false, reason: 'mapping-lost' })
  })
})

describe('V01 历史分组：快照恢复', () => {
  it('恢复到快照边界状态后分组继续可用', () => {
    const g = new AddonHistoryGrouping()
    abcd(g)
    expect(g.noteUndoBackflow('ABC', 5).matched).toBe(true)
    expect(g.noteUndoBackflow('AB', 6).matched).toBe(true)
    const snap = g.snapshot()
    // 模拟宿主侧重启后协调器重建：当前权威文本恰为 AB（边界态）
    const fresh = new AddonHistoryGrouping()
    fresh.restore(snap, { version: 6, text: 'AB' })
    const redo = fresh.planHistory('redo')
    expect(redo.kind).toBe('execute')
    if (redo.kind !== 'execute') return
    expect(redo.steps.map((s) => s.expectText)).toEqual(['ABC', 'ABCD'])
  })

  it('恢复时当前文本不是任何已记录边界 → lost（不猜测）', () => {
    const g = new AddonHistoryGrouping()
    abcd(g)
    const snap = g.snapshot()
    const fresh = new AddonHistoryGrouping()
    fresh.restore(snap, { version: 99, text: '重启后出现的外部写入' })
    expect(fresh.lost).toBe(true)
  })
})

describe('V01 历史分组：条目观测面', () => {
  it('来源逐次独立跟踪（seq/opId/原子标志）且 ack 版本可定位条目', () => {
    const g = new AddonHistoryGrouping()
    abcd(g)
    const entries: readonly AddonHistoryEntry[] = g.listEntries()
    expect(entries.map((e) => [e.seq, e.opId, e.groupId, e.atomic])).toEqual([
      [1, 'A', 'g1', true],
      [2, 'B', 'g1', false],
      [3, 'C', 'g2', true],
      [4, 'D', 'g2', false],
    ])
    expect(g.entryAtVersion(4)?.opId).toBe('C')
    expect(g.entryAtVersion(5)?.opId).toBe('D')
  })
})
