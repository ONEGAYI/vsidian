// 图片刷新协调器契约（工单 #201）：provider 级单件，串起三层失效通道的
// 宿主侧执行——版本表代次、事件路径（watcher/onTargetChange 无条件失效）、
// 周期核验路径（决策 refresh 才失效）。stat 与目标解析经端口注入，
// 本模块保持纯逻辑可单测。
import { describe, expect, it } from 'vitest'
import { ImageRefreshCoordinator } from '../../src/host/imageRefreshCoordinator'
import type { ImageStatOutcome } from '../../src/shared/imageRefresh'

interface Harness {
  coordinator: ImageRefreshCoordinator
  stats: Map<string, ImageStatOutcome>
  resolves: Map<string, string | null>
  invalidated: string[]
  statCalls: string[]
}

function makeHarness(win = true): Harness {
  const stats = new Map<string, ImageStatOutcome>()
  const resolves = new Map<string, string | null>()
  const invalidated: string[] = []
  const statCalls: string[] = []
  const coordinator = new ImageRefreshCoordinator(
    {
      statTarget: async (fsPath) => {
        statCalls.push(fsPath)
        return stats.get(fsPath) ?? { kind: 'inaccessible' }
      },
      resolveTarget: (src) => resolves.get(src) ?? null,
      invalidateTarget: (fsPath) => {
        invalidated.push(fsPath)
      },
    },
    { isWindowsHost: win },
  )
  return { coordinator, stats, resolves, invalidated, statCalls }
}

describe('事件路径（watcher / onTargetChange）', () => {
  it('事件到达：无条件失效并推进代次（即使元数据相同）', async () => {
    const h = makeHarness()
    h.stats.set('D:/r/a.png', { kind: 'ok', mtimeMs: 1, size: 10 })
    await h.coordinator.handleTargetEvent('D:/r/a.png')
    await h.coordinator.handleTargetEvent('D:/r/a.png')
    expect(h.invalidated).toEqual(['D:/r/a.png', 'D:/r/a.png'])
    expect(h.coordinator.versions.generationOf('D:/r/a.png')).toBe(2)
  })

  it('删除事件：lastKnown 置空（恢复必检出）且仍失效', async () => {
    const h = makeHarness()
    h.stats.set('D:/r/a.png', { kind: 'ok', mtimeMs: 1, size: 10 })
    await h.coordinator.handleTargetEvent('D:/r/a.png')
    h.stats.set('D:/r/a.png', { kind: 'missing' })
    await h.coordinator.handleTargetEvent('D:/r/a.png')
    expect(h.coordinator.versions.lastKnownOf('D:/r/a.png')).toBeNull()
    expect(h.invalidated.length).toBe(2)
  })

  it('stat 探测不可访问：不动版本表但仍广播（重发请求按 inaccessible 呈现）', async () => {
    const h = makeHarness()
    h.stats.set('D:/r/a.png', { kind: 'inaccessible' })
    await h.coordinator.handleTargetEvent('D:/r/a.png')
    expect(h.coordinator.versions.has('D:/r/a.png')).toBe(false)
    expect(h.invalidated).toEqual(['D:/r/a.png'])
  })
})

describe('周期核验路径（image.verify）', () => {
  function setupVerify(h: Harness) {
    h.resolves.set('./a.png', 'D:/r/a.png')
    h.resolves.set('./miss.png', 'D:/r/miss.png')
  }

  it('元数据未变且健康：current 不失效（未变化不重载）', async () => {
    const h = makeHarness()
    setupVerify(h)
    h.stats.set('D:/r/a.png', { kind: 'ok', mtimeMs: 1, size: 10 })
    // 预置版本表：解析请求已登记过
    h.coordinator.versions.recordObservation('D:/r/a.png', { mtimeMs: 1, size: 10 })
    await h.coordinator.verify([{ src: './a.png', state: 'loaded' }])
    expect(h.invalidated).toEqual([])
  })

  it('元数据变化：refresh，版本表 bump 出新代次后失效', async () => {
    const h = makeHarness()
    setupVerify(h)
    h.stats.set('D:/r/a.png', { kind: 'ok', mtimeMs: 9, size: 10 })
    h.coordinator.versions.recordObservation('D:/r/a.png', { mtimeMs: 1, size: 10 })
    await h.coordinator.verify([{ src: './a.png', state: 'loaded' }])
    expect(h.invalidated).toEqual(['D:/r/a.png'])
    expect(h.coordinator.versions.generationOf('D:/r/a.png')).toBe(2)
  })

  it('缺失：refresh + recordMissing（重发请求得 not-found）', async () => {
    const h = makeHarness()
    setupVerify(h)
    h.stats.set('D:/r/a.png', { kind: 'missing' })
    h.coordinator.versions.recordObservation('D:/r/a.png', { mtimeMs: 1, size: 10 })
    await h.coordinator.verify([{ src: './a.png', state: 'loaded' }])
    expect(h.invalidated).toEqual(['D:/r/a.png'])
    expect(h.coordinator.versions.lastKnownOf('D:/r/a.png')).toBeNull()
  })

  it('维持态不扰动：全部条目已呈 not-found 且仍缺失 → 不失效', async () => {
    const h = makeHarness()
    setupVerify(h)
    h.stats.set('D:/r/miss.png', { kind: 'missing' })
    h.coordinator.versions.recordMissing('D:/r/miss.png')
    await h.coordinator.verify([{ src: './miss.png', state: 'error', reason: 'not-found' }])
    expect(h.invalidated).toEqual([])
  })

  it('断连恢复：stat 恢复且元数据相同但条目呈 inaccessible → refresh 且不 bump（URI 不变缓存命中恢复）', async () => {
    const h = makeHarness()
    setupVerify(h)
    h.stats.set('D:/r/a.png', { kind: 'ok', mtimeMs: 1, size: 10 })
    h.coordinator.versions.recordObservation('D:/r/a.png', { mtimeMs: 1, size: 10 })
    await h.coordinator.verify([{ src: './a.png', state: 'error', reason: 'inaccessible' }])
    expect(h.invalidated).toEqual(['D:/r/a.png'])
    expect(h.coordinator.versions.generationOf('D:/r/a.png')).toBe(1)
  })

  it('解析失败的目标（blocked/越界）跳过；同文件多 src 去重 stat 一次', async () => {
    const h = makeHarness()
    setupVerify(h)
    h.resolves.set('./blocked.png', null)
    h.resolves.set('assets/a.png', 'D:/r/a.png')
    h.stats.set('D:/r/a.png', { kind: 'ok', mtimeMs: 1, size: 10 })
    h.coordinator.versions.recordObservation('D:/r/a.png', { mtimeMs: 1, size: 10 })
    await h.coordinator.verify([
      { src: './blocked.png', state: 'loading' },
      { src: './a.png', state: 'loaded' },
      { src: 'assets/a.png', state: 'loaded' },
    ])
    // blocked 跳过；同文件两 src 归并一次 stat；未变化不失效
    expect(h.statCalls).toEqual(['D:/r/a.png'])
    expect(h.invalidated).toEqual([])
  })

  it('无登记目标（版本表未知）也按 refresh 处理（防御：首次核验先于解析的窗口）', async () => {
    const h = makeHarness()
    setupVerify(h)
    h.stats.set('D:/r/a.png', { kind: 'ok', mtimeMs: 1, size: 10 })
    await h.coordinator.verify([{ src: './a.png', state: 'loaded' }])
    expect(h.invalidated).toEqual(['D:/r/a.png'])
  })
})
