// #292 骨架屏撤除时刻计算矩阵（TDD 先行）：纯函数契约——
// 动画未开始就绪即撤、动画已开始等当前周期播完、周期边界到点即撤、
// reduced-motion 等价「动画未开始」。
import { describe, expect, it } from 'vitest'
import {
  planSkeletonExit,
  SKELETON_SHIMMER_CYCLE_MS,
  SKELETON_SHIMMER_DELAY_MS,
} from '../../src/shared/skeletonTiming'

const T0 = 1000

describe('planSkeletonExit（#292 撤除计划）', () => {
  it('默认常量：延时 300ms、周期 1500ms', () => {
    expect(SKELETON_SHIMMER_DELAY_MS).toBe(300)
    expect(SKELETON_SHIMMER_CYCLE_MS).toBe(1500)
  })

  it('载入早于延时结束：动画未开始，就绪即撤（瞬间载好全程无扫光）', () => {
    const plan = planSkeletonExit({ shownAt: T0, readyAt: T0 + 200 })
    expect(plan.animationStarted).toBe(false)
    expect(plan.removeAt).toBe(T0 + 200)
  })

  it('载入恰在延时结束点：零个完整周期，就绪即撤', () => {
    const plan = planSkeletonExit({ shownAt: T0, readyAt: T0 + SKELETON_SHIMMER_DELAY_MS })
    expect(plan.animationStarted).toBe(false)
    expect(plan.removeAt).toBe(T0 + SKELETON_SHIMMER_DELAY_MS)
  })

  it('首个周期中载入（0.5 周期）：等第 1 周期播完才撤', () => {
    const readyAt = T0 + SKELETON_SHIMMER_DELAY_MS + SKELETON_SHIMMER_CYCLE_MS * 0.5
    const plan = planSkeletonExit({ shownAt: T0, readyAt })
    expect(plan.animationStarted).toBe(true)
    expect(plan.removeAt).toBe(T0 + SKELETON_SHIMMER_DELAY_MS + SKELETON_SHIMMER_CYCLE_MS)
  })

  it('1.5 周期载入：第 2 周期末退出（规格示例）', () => {
    const readyAt = T0 + SKELETON_SHIMMER_DELAY_MS + SKELETON_SHIMMER_CYCLE_MS * 1.5
    const plan = planSkeletonExit({ shownAt: T0, readyAt })
    expect(plan.animationStarted).toBe(true)
    expect(plan.removeAt).toBe(T0 + SKELETON_SHIMMER_DELAY_MS + SKELETON_SHIMMER_CYCLE_MS * 2)
  })

  it('恰在周期边界载入：到点即撤（ceil 取整不进位）', () => {
    const readyAt = T0 + SKELETON_SHIMMER_DELAY_MS + SKELETON_SHIMMER_CYCLE_MS * 2
    const plan = planSkeletonExit({ shownAt: T0, readyAt })
    expect(plan.animationStarted).toBe(true)
    expect(plan.removeAt).toBe(readyAt)
  })

  it('reduced-motion：即使动画窗口已过也不等待收束，就绪即撤', () => {
    const readyAt = T0 + SKELETON_SHIMMER_DELAY_MS + SKELETON_SHIMMER_CYCLE_MS * 1.5
    const plan = planSkeletonExit({ shownAt: T0, readyAt, reducedMotion: true })
    expect(plan.animationStarted).toBe(false)
    expect(plan.removeAt).toBe(readyAt)
  })

  it('自定义延时与周期按同规则收束', () => {
    const plan = planSkeletonExit({
      shownAt: T0,
      readyAt: T0 + 100 + 400 * 1.25,
      delayMs: 100,
      cycleMs: 400,
    })
    expect(plan.animationStarted).toBe(true)
    expect(plan.removeAt).toBe(T0 + 100 + 400 * 2)
  })

  it('防御：readyAt 早于 shownAt（时钟异常）按就绪即撤，不前移撤除时刻', () => {
    const plan = planSkeletonExit({ shownAt: T0, readyAt: T0 - 50 })
    expect(plan.animationStarted).toBe(false)
    expect(plan.removeAt).toBe(T0 - 50)
  })

  it('防御：cycleMs 非正回退默认周期，不产生非有限撤除时刻', () => {
    const plan = planSkeletonExit({
      shownAt: T0,
      readyAt: T0 + SKELETON_SHIMMER_DELAY_MS + 100,
      cycleMs: 0,
    })
    expect(plan.animationStarted).toBe(true)
    expect(Number.isFinite(plan.removeAt)).toBe(true)
    expect(plan.removeAt).toBe(T0 + SKELETON_SHIMMER_DELAY_MS + SKELETON_SHIMMER_CYCLE_MS)
  })

  it('防御：非有限 cycleMs（Infinity）回退默认周期（审查 F1）', () => {
    const plan = planSkeletonExit({
      shownAt: T0,
      readyAt: T0 + SKELETON_SHIMMER_DELAY_MS + 100,
      cycleMs: Number.POSITIVE_INFINITY,
    })
    expect(plan.animationStarted).toBe(true)
    expect(plan.removeAt).toBe(T0 + SKELETON_SHIMMER_DELAY_MS + SKELETON_SHIMMER_CYCLE_MS)
  })

  it('防御：负数与 NaN delayMs 回退默认延时（审查 F2）', () => {
    for (const delayMs of [-5, Number.NaN]) {
      const plan = planSkeletonExit({
        shownAt: T0,
        readyAt: T0 + SKELETON_SHIMMER_DELAY_MS + 100,
        delayMs,
      })
      expect(plan.removeAt).toBe(T0 + SKELETON_SHIMMER_DELAY_MS + SKELETON_SHIMMER_CYCLE_MS)
    }
  })

  it('防御：readyAt 非有限按未开始处理并立即撤（不产生 NaN 计时）', () => {
    const plan = planSkeletonExit({ shownAt: T0, readyAt: Number.NaN })
    expect(plan.animationStarted).toBe(false)
    expect(plan.removeAt).toBe(0)
  })

  it('防御：shownAt 非有限按未开始处理（就绪即撤）', () => {
    const plan = planSkeletonExit({ shownAt: Number.NaN, readyAt: T0 + 5000 })
    expect(plan.animationStarted).toBe(false)
    expect(plan.removeAt).toBe(T0 + 5000)
  })
})
