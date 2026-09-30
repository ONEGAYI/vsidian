// 引用视图同步纯逻辑（#224）：工程参数（集中定义）、目标内容版本仲裁
// 矩阵与订阅注册表（相同目标合并订阅、各实例独立释放、目标数有界）。
// 协调器的分态/防抖在 test/unit/hoverRefreshCoordinator.test.ts；本文件
// 只钉 shared 层的数学与数据结构。
import { describe, expect, it } from 'vitest'
import {
  HOVER_REFRESH_DEFAULTS,
  HoverWatchRegistry,
  shouldApplyHoverVersion,
} from '../../src/shared/hoverRefresh'

describe('#224 工程参数（集中定义，测试钉住量级与关系）', () => {
  it('防抖 < 强制合并上限 < 核验周期量级（短暂合并刷新语义）', () => {
    expect(HOVER_REFRESH_DEFAULTS.debounceMs).toBeGreaterThan(0)
    expect(HOVER_REFRESH_DEFAULTS.maxWaitMs).toBeGreaterThan(HOVER_REFRESH_DEFAULTS.debounceMs)
    // 短暂合并：防抖窗与 hover 开闭延迟同量级（300-500ms 工程带）
    expect(HOVER_REFRESH_DEFAULTS.debounceMs).toBeGreaterThanOrEqual(200)
    expect(HOVER_REFRESH_DEFAULTS.debounceMs).toBeLessThanOrEqual(800)
  })

  it('缓存双上限为正且有界（条目数与字节量分别限制）', () => {
    expect(HOVER_REFRESH_DEFAULTS.cacheEntryLimit).toBeGreaterThan(0)
    expect(HOVER_REFRESH_DEFAULTS.cacheByteLimit).toBeGreaterThan(0)
  })

  it('订阅与实例状态库上限为正（有界淘汰的参数前提）', () => {
    expect(HOVER_REFRESH_DEFAULTS.watchTargetLimit).toBeGreaterThan(0)
    expect(HOVER_REFRESH_DEFAULTS.embedEntryLimit).toBeGreaterThan(0)
  })
})

describe('目标内容版本仲裁矩阵（旧响应不覆盖新目标或更新版本）', () => {
  it('未应用过（null）→ 任何版本可应用（首载）', () => {
    expect(shouldApplyHoverVersion(null, 1)).toBe(true)
    expect(shouldApplyHoverVersion(null, 0)).toBe(true)
  })

  it('来包版本更新（更大）→ 应用', () => {
    expect(shouldApplyHoverVersion(3, 4)).toBe(true)
  })

  it('来包版本相同 → 应用（重复投递幂等，不判旧）', () => {
    expect(shouldApplyHoverVersion(3, 3)).toBe(true)
  })

  it('来包版本更旧 → 拒绝（慢响应旧内容不冒充新目标）', () => {
    expect(shouldApplyHoverVersion(5, 4)).toBe(false)
    expect(shouldApplyHoverVersion(5, 1)).toBe(false)
  })
})

describe('订阅注册表：相同目标合并订阅、实例独立释放', () => {
  it('多实例订阅同一目标合并为目标级订阅；任一实例在场即保持订阅', () => {
    const reg = new HoverWatchRegistry()
    reg.watch('s1', 'D:\\notes\\b.md', 'embed-1')
    reg.watch('s1', 'D:\\notes\\b.md', 'embed-2')
    reg.watch('s2', 'D:\\notes\\b.md', 'hover-1')
    expect(reg.has('D:\\notes\\b.md')).toBe(true)
    expect(reg.targets()).toBe(1) // 三实例合并为一个目标
    expect(reg.totalSubscriptions()).toBe(3)
    // 独立释放：逐个退订，最后一个退完目标才退场
    reg.unwatch('s1', 'D:\\notes\\b.md', 'embed-1')
    expect(reg.has('D:\\notes\\b.md')).toBe(true)
    reg.unwatch('s2', 'D:\\notes\\b.md', 'hover-1')
    reg.unwatch('s1', 'D:\\notes\\b.md', 'embed-2')
    expect(reg.has('D:\\notes\\b.md')).toBe(false)
    expect(reg.totalSubscriptions()).toBe(0)
  })

  it('重复 watch 同实例幂等（订阅计数不虚增）', () => {
    const reg = new HoverWatchRegistry()
    reg.watch('s1', 'b.md', 'e1')
    reg.watch('s1', 'b.md', 'e1')
    reg.watch('s1', 'b.md', 'e1')
    expect(reg.totalSubscriptions()).toBe(1)
    reg.unwatch('s1', 'b.md', 'e1')
    expect(reg.has('b.md')).toBe(false)
  })

  it('unwatch 未登记项为无操作（迟到 unwatch 不误伤）', () => {
    const reg = new HoverWatchRegistry()
    reg.watch('s1', 'b.md', 'e1')
    reg.unwatch('s1', 'b.md', 'ghost')
    reg.unwatch('s1', 'missing.md', 'e1')
    reg.unwatch('s-other', 'b.md', 'e1')
    expect(reg.has('b.md')).toBe(true)
    expect(reg.totalSubscriptions()).toBe(1)
  })

  it('subscribersOf 返回订阅该目标的全部会话（推送路由）', () => {
    const reg = new HoverWatchRegistry()
    reg.watch('s1', 'b.md', 'e1')
    reg.watch('s2', 'b.md', 'e1')
    reg.watch('s3', 'c.md', 'e1')
    expect([...reg.subscribersOf('b.md')].sort()).toEqual(['s1', 's2'])
    expect(reg.subscribersOf('c.md')).toEqual(['s3'])
    expect(reg.subscribersOf('none.md')).toEqual([])
  })

  it('releaseSession 释放该会话全部订阅（面板销毁：计数回落）', () => {
    const reg = new HoverWatchRegistry()
    reg.watch('s1', 'b.md', 'e1')
    reg.watch('s1', 'c.md', 'e2')
    reg.watch('s2', 'b.md', 'e3')
    reg.releaseSession('s1')
    expect(reg.has('b.md')).toBe(true) // s2 仍在场
    expect(reg.has('c.md')).toBe(false)
    expect(reg.totalSubscriptions()).toBe(1)
    reg.releaseSession('s2')
    expect(reg.has('b.md')).toBe(false)
  })

  it('目标数上限：超出按最近触达淘汰整目标（有界）', () => {
    const reg = new HoverWatchRegistry(HOVER_REFRESH_DEFAULTS.watchTargetLimit)
    for (let i = 0; i < HOVER_REFRESH_DEFAULTS.watchTargetLimit; i++) {
      reg.watch('s1', `t${i}.md`, 'e')
    }
    expect(reg.targets()).toBe(HOVER_REFRESH_DEFAULTS.watchTargetLimit)
    // 触达 t0（最近使用）后再加新目标：淘汰的是最久未触达的 t1
    reg.watch('s1', 't0.md', 'e2')
    reg.watch('s1', 'new.md', 'e')
    expect(reg.targets()).toBe(HOVER_REFRESH_DEFAULTS.watchTargetLimit)
    expect(reg.has('t0.md')).toBe(true)
    expect(reg.has('new.md')).toBe(true)
    expect(reg.has('t1.md')).toBe(false)
  })
})
