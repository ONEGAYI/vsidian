// 引用视图同步纯逻辑（#224）：工程参数（集中定义）、目标内容版本仲裁
// 矩阵与订阅注册表（相同目标合并订阅、各实例独立释放、目标数有界）。
// 协调器的分态/防抖在 test/unit/hoverRefreshCoordinator.test.ts；本文件
// 只钉 shared 层的数学与数据结构。
import { describe, expect, it } from 'vitest'
import {
  HOVER_REFRESH_DEFAULTS,
  HoverWatchRegistry,
  selectTextWatchEvictions,
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
    reg.watch('s1', 'D:\\\\notes\\b.md', 'embed-1')
    reg.watch('s1', 'D:\\\\notes\\b.md', 'embed-2')
    reg.watch('s2', 'D:\\\\notes\\b.md', 'hover-1')
    expect(reg.has('D:\\\\notes\\b.md')).toBe(true)
    expect(reg.targets()).toBe(1) // 三实例合并为一个目标
    expect(reg.totalSubscriptions()).toBe(3)
    // 独立释放：逐个退订，最后一个退完目标才退场
    reg.unwatch('s1', 'D:\\\\notes\\b.md', 'embed-1')
    expect(reg.has('D:\\\\notes\\b.md')).toBe(true)
    reg.unwatch('s2', 'D:\\\\notes\\b.md', 'hover-1')
    reg.unwatch('s1', 'D:\\\\notes\\b.md', 'embed-2')
    expect(reg.has('D:\\\\notes\\b.md')).toBe(false)
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

  it('跨面板第 129 个目标被拒绝；既有面板订阅不失效，同目标复用槽位', () => {
    const reg = new HoverWatchRegistry(HOVER_REFRESH_DEFAULTS.watchTargetLimit)
    expect(reg.watch('panel-a', 'old.md', 'a')).toBe(true)
    expect(reg.watch('panel-b', 'old.md', 'b')).toBe(true)
    for (let i = 1; i < HOVER_REFRESH_DEFAULTS.watchTargetLimit; i++) {
      expect(reg.watch('panel-b', `t${i}.md`, 'e')).toBe(true)
    }
    expect(reg.targets()).toBe(HOVER_REFRESH_DEFAULTS.watchTargetLimit)
    expect(reg.watch('panel-c', 'new.md', 'c')).toBe(false)
    expect(reg.targets()).toBe(HOVER_REFRESH_DEFAULTS.watchTargetLimit)
    expect(reg.subscribersOf('old.md')).toEqual(['panel-a', 'panel-b'])
    expect(reg.has('new.md')).toBe(false)
    expect(reg.watch('panel-c', 'old.md', 'c')).toBe(true)
    expect(reg.totalSubscriptions()).toBe(HOVER_REFRESH_DEFAULTS.watchTargetLimit + 2)
    reg.unwatch('panel-b', 't1.md', 'e')
    expect(reg.watch('panel-c', 'new.md', 'c')).toBe(true)
  })
})

describe('订阅注册表：Windows 键归一（大小写形态漂移）', () => {
  const fold = (fsPath: string): string => fsPath.replaceAll('\\', '/').toLowerCase()
  const CANON = 'D:\\Notes\\Target.md'
  const EDITOR_FORM = 'd:\\notes\\TARGET.md'

  it('编辑器事件形态与读取归正形态仅大小写不同仍命中同一目标', () => {
    const reg = new HoverWatchRegistry(HOVER_REFRESH_DEFAULTS.watchTargetLimit, fold)
    reg.watch('s1', CANON, 'e1') // 读取归正形态（大小写混合）
    expect(reg.has(EDITOR_FORM)).toBe(true) // 编辑器事件形态
    expect(reg.subscribersOf('D:/NOTES/target.MD')).toEqual(['s1'])
    // 推送载荷保持登记形态（与 webview 侧 loaded.fsPath 同源）
    expect(reg.canonicalOf(EDITOR_FORM)).toBe(CANON)
    // 退订也走归一键
    reg.unwatch('s1', 'D:/NOTES/TARGET.MD', 'e1')
    expect(reg.has(CANON)).toBe(false)
  })

  it('归一键下重复 watch 同目标不同形态不产生第二目标', () => {
    const reg = new HoverWatchRegistry(HOVER_REFRESH_DEFAULTS.watchTargetLimit, fold)
    reg.watch('s1', CANON, 'e1')
    reg.watch('s2', EDITOR_FORM, 'e2')
    expect(reg.targets()).toBe(1) // 同一目标（两实例合并）
    expect(reg.totalSubscriptions()).toBe(2)
  })
})

// ---- #344（P3-12 收口·RB-1）：text per-file watcher 的 LRU 淘汰选取 ----
// 契约：watcher 表超限时按 LRU 序优先淘汰**无活跃订阅**的陈旧条目；仍有
// 订阅的条目跳过（订阅在登记表而事件源被淘汰 = 推送承诺落空的不对称）；
// 全部在 watch 时不强拆（watcher 总量由订阅注册表上限另有界）。
describe('text watcher LRU 淘汰选取：跳过仍有活跃订阅的目标（RB-1）', () => {
  const neverWatched = (): boolean => false

  it('未超限零淘汰', () => {
    expect(selectTextWatchEvictions(['a', 'b', 'c'], neverWatched, 3)).toEqual([])
    expect(selectTextWatchEvictions([], neverWatched, 3)).toEqual([])
  })

  it('超限淘汰最旧的无订阅条目，数量恰好回到上限', () => {
    // 5 个条目上限 3：淘汰最旧 2 个（a、b——按 LRU 序从旧到新）
    expect(selectTextWatchEvictions(['a', 'b', 'c', 'd', 'e'], neverWatched, 3)).toEqual(['a', 'b'])
  })

  it('仍有活跃订阅的条目跳过，从更旧的陈旧条目补足', () => {
    // a、c 在 watch（有活跃订阅）：跳过；淘汰 b、d 补足超额
    const watched = new Set(['a', 'c'])
    expect(
      selectTextWatchEvictions(['a', 'b', 'c', 'd', 'e'], (k) => watched.has(k), 3),
    ).toEqual(['b', 'd'])
  })

  it('最旧条目全在 watch 时跳过，不因顺序阻塞其后陈旧条目的淘汰', () => {
    const watched = new Set(['a', 'b'])
    expect(
      selectTextWatchEvictions(['a', 'b', 'c', 'd', 'e'], (k) => watched.has(k), 3),
    ).toEqual(['c', 'd'])
  })

  it('全部在 watch 时不强拆（返回不足额——活跃事件源不得被淘汰断流）', () => {
    const alwaysWatched = (): boolean => true
    expect(selectTextWatchEvictions(['a', 'b', 'c', 'd', 'e'], alwaysWatched, 3)).toEqual([])
  })

  it('上界语义：淘汰后保留数 = 上限 + 在 watch 条目数（量级由订阅注册表上限兜底）', () => {
    // 128 上限、65 个陈旧 + 64 个在 watch（订阅注册表上限内）：淘汰 1 个最旧
    // 陈旧条目后余 128；在 watch 的 64 个全部保留
    const stale = Array.from({ length: 65 }, (_, i) => `stale-${i}`)
    const live = Array.from({ length: 64 }, (_, i) => `live-${i}`)
    const watched = new Set(live)
    const victims = selectTextWatchEvictions([...stale, ...live], (k) => watched.has(k), 128)
    expect(victims).toEqual(['stale-0'])
    const kept = [...stale.slice(1), ...live]
    expect(kept.length).toBe(128)
    expect(victims.every((v) => !watched.has(v)), '被淘汰者不得含在 watch 目标').toBe(true)
  })
})
