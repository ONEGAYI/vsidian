// #546 T07 页面明暗环境 hub 契约：缓存先更新后通知、重复值不广播、
// 代次释放整组退订、订阅判活（TDD 先立预期）。规则来源：
// docs/specs/addon-themes.md §4（通知在页面缓存更新后送达，回调中再读
// 拿到相同新状态；重复值不重复广播；代次释放自动退订）。
import { beforeEach, describe, expect, it } from 'vitest'
import { installThemeEnvironmentHub } from '../../src/webview/addonThemeEnvironment'

describe('页面明暗环境 hub', () => {
  let hub: ReturnType<typeof installThemeEnvironmentHub>

  beforeEach(() => {
    hub = installThemeEnvironmentHub({ dark: false, highContrast: false })
  })

  it('快照读取：current 返回当前缓存', () => {
    expect(hub.current()).toEqual({ dark: false, highContrast: false })
    hub.applyEnvironment({ dark: true, highContrast: false })
    expect(hub.current()).toEqual({ dark: true, highContrast: false })
  })

  it('缓存先更新后通知：回调中 current 已是新值', () => {
    const seen: Array<{ dark: boolean; atRead: { dark: boolean } }> = []
    hub.subscribe('pub.a', 1, (env) => {
      seen.push({ dark: env.dark, atRead: hub.current() })
    })
    hub.applyEnvironment({ dark: true, highContrast: false })
    expect(seen).toEqual([{ dark: true, atRead: { dark: true, highContrast: false } }])
  })

  it('重复值不广播（等值跳过，通知计数不增）', () => {
    let calls = 0
    hub.subscribe('pub.a', 1, () => {
      calls += 1
    })
    hub.applyEnvironment({ dark: true, highContrast: false })
    hub.applyEnvironment({ dark: true, highContrast: false })
    expect(calls).toBe(1)
  })

  it('非法载荷拒绝（不更新缓存不通知）', () => {
    let calls = 0
    hub.subscribe('pub.a', 1, () => {
      calls += 1
    })
    expect(hub.applyEnvironment({ dark: 'x' } as unknown as { dark: boolean })).toBe(false)
    expect(hub.applyEnvironment(null)).toBe(false)
    expect(calls).toBe(0)
    expect(hub.current()).toEqual({ dark: false, highContrast: false })
  })

  it('代次释放整组退订（releaseAddon 后不再收到通知；重复释放无害）', () => {
    let calls = 0
    hub.subscribe('pub.a', 1, () => {
      calls += 1
    })
    hub.subscribe('pub.a', 2, () => {
      calls += 1
    })
    hub.subscribe('pub.b', 1, () => {
      calls += 1
    })
    hub.releaseAddon('pub.a')
    hub.releaseAddon('pub.a')
    hub.applyEnvironment({ dark: true, highContrast: false })
    // pub.b 仍收到；pub.a 两组都已退订
    expect(calls).toBe(1)
  })

  it('显式退订函数生效', () => {
    let calls = 0
    const off = hub.subscribe('pub.a', 1, () => {
      calls += 1
    })
    off()
    hub.applyEnvironment({ dark: true, highContrast: false })
    expect(calls).toBe(0)
  })

  it('订阅后同值初始化不通知（初始等值跳过）', () => {
    let calls = 0
    hub.subscribe('pub.a', 1, () => {
      calls += 1
    })
    hub.applyEnvironment({ dark: false, highContrast: false })
    expect(calls).toBe(0)
  })

  it('四态全流转（light → dark → hc → hc-light，各通知一次）', () => {
    const seen: string[] = []
    hub.subscribe('pub.a', 1, (env) => {
      seen.push(`${env.dark ? 'd' : 'l'}${env.highContrast ? 'hc' : ''}`)
    })
    hub.applyEnvironment({ dark: true, highContrast: false })
    hub.applyEnvironment({ dark: true, highContrast: true })
    hub.applyEnvironment({ dark: false, highContrast: true })
    expect(seen).toEqual(['d', 'dhc', 'lhc'])
    expect(hub.current()).toEqual({ dark: false, highContrast: true })
  })
})
