// #198 索引维护调度纯逻辑契约测试：编辑防抖 + 2s 强制合并的冲刷时刻规划、
// 有界去重队列（容量上限与溢出策略）、mtime+size 清单比对（核验筛选）。
// 单一事实源 src/shared/vaultIndexSchedule.ts——服务（vaultIndexService）只
// 消费这些决策函数，不自行散落调度规则。
import { describe, expect, it } from 'vitest'
import {
  BoundedKeyQueue,
  diffManifest,
  planFlushAt,
  RESCAN_QUEUE_CAPACITY,
  SCHEDULE_DEFAULTS,
} from '../../src/shared/vaultIndexSchedule'

describe('调度初值常量（集中可调，文档不承诺固定时限）', () => {
  it('编辑防抖 500ms、连续输入强制合并 2s、重扫去抖 800ms、周期核验 10 分钟', () => {
    expect(SCHEDULE_DEFAULTS.unsavedDebounceMs).toBe(500)
    expect(SCHEDULE_DEFAULTS.unsavedMaxWaitMs).toBe(2000)
    expect(SCHEDULE_DEFAULTS.rescanDebounceMs).toBe(800)
    expect(SCHEDULE_DEFAULTS.verifyIntervalMs).toBe(10 * 60 * 1000)
    expect(RESCAN_QUEUE_CAPACITY).toBeGreaterThan(0)
  })
})

describe('planFlushAt：防抖与强制合并的时刻决策', () => {
  it('静默期到达即冲刷（末次事件 + 防抖窗）', () => {
    // 首个待处理事件 t=0，末次事件 t=300 → 300+500=800 早于 0+2000
    expect(planFlushAt(0, 300, 500, 2000)).toBe(800)
  })

  it('连续输入不超过 2s 必冲刷（首个事件 + maxWait 封顶）', () => {
    // 连续键入：末次事件 t=1900，防抖时点 2400 晚于首事件+2000 → 取 2000
    expect(planFlushAt(0, 1900, 500, 2000)).toBe(2000)
  })

  it('maxWait 已过（迟到决策）返回不晚于当前的时刻（立即冲刷）', () => {
    // 首事件 t=0、末次 t=2500：两候选时刻都已过，返回较早的 2000
    expect(planFlushAt(0, 2500, 500, 2000)).toBe(2000)
  })

  it('防抖时点晚于 maxWait 时以 maxWait 封顶（长时间连续输入不饿死）', () => {
    // 首事件 t=10000、末次 t=12000：防抖点 12500 晚于封顶点 12000 → 12000
    expect(planFlushAt(10_000, 12_000, 500, 2000)).toBe(12_000)
  })
})

describe('BoundedKeyQueue：有界去重的增量任务队列', () => {
  it('去重保位（重复入队不增长、保持首见顺序）', () => {
    const q = new BoundedKeyQueue(10)
    expect(q.enqueue('a.md')).toBe('added')
    expect(q.enqueue('b.md')).toBe('added')
    expect(q.enqueue('a.md')).toBe('present')
    expect(q.size).toBe(2)
    expect(q.drain(10)).toEqual(['a.md', 'b.md'])
    expect(q.size).toBe(0)
  })

  it('容量上限：队满后未知键入队报 overflow 且不入队（溢出降级由调用方处理）', () => {
    const q = new BoundedKeyQueue(2)
    q.enqueue('a.md')
    q.enqueue('b.md')
    expect(q.enqueue('c.md')).toBe('overflow')
    expect(q.size).toBe(2)
    // 已在队内的键仍可幂等命中（不误报溢出）
    expect(q.enqueue('a.md')).toBe('present')
  })

  it('drain 分批取出（批量处理间让出事件循环由调用方执行）', () => {
    const q = new BoundedKeyQueue(10)
    for (const k of ['a', 'b', 'c', 'd', 'e']) q.enqueue(k)
    expect(q.drain(2)).toEqual(['a', 'b'])
    expect(q.drain(2)).toEqual(['c', 'd'])
    expect(q.drain(2)).toEqual(['e'])
    expect(q.drain(2)).toEqual([])
  })

  it('clear 清空（全量扫描启动前排空增量队列）', () => {
    const q = new BoundedKeyQueue(10)
    q.enqueue('a')
    q.clear()
    expect(q.size).toBe(0)
    expect(q.has('a')).toBe(false)
  })
})

describe('diffManifest：mtime+size 清单比对（核验筛选）', () => {
  const known = new Map([
    ['same.md', { mtimeMs: 100, size: 10 }],
    ['changed.md', { mtimeMs: 100, size: 10 }],
    ['removed.md', { mtimeMs: 100, size: 10 }],
  ])
  const current = [
    { path: 'same.md', mtimeMs: 100, size: 10 },
    { path: 'changed.md', mtimeMs: 200, size: 12 },
    { path: 'added.md', mtimeMs: 300, size: 1 },
  ]

  it('筛出变更/新增/移除三类候选（仅筛选，不作内容一致性证明）', () => {
    expect(diffManifest(known, current)).toEqual({
      changed: ['changed.md'],
      added: ['added.md'],
      removed: ['removed.md'],
    })
  })

  it('mtime 相同而 size 不同也算变更（双字段联合筛选）', () => {
    const r = diffManifest(
      new Map([['a.md', { mtimeMs: 1, size: 5 }]]),
      [{ path: 'a.md', mtimeMs: 1, size: 6 }],
    )
    expect(r.changed).toEqual(['a.md'])
  })

  it('无差异时三清单皆空', () => {
    const r = diffManifest(
      new Map([['a.md', { mtimeMs: 1, size: 5 }]]),
      [{ path: 'a.md', mtimeMs: 1, size: 5 }],
    )
    expect(r).toEqual({ changed: [], added: [], removed: [] })
  })
})
