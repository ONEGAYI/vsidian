// 引用视图刷新协调器（#224 宿主侧纯逻辑）：事件分态矩阵（未保存修改
// 防抖合并 / 磁盘事件直通 / deleted 撤下 pending）、推送路由（订阅会话）
// 与代次单调。真宿主接线（onDidChangeTextDocument / onTargetChange 转发）
// 在 textEditorProvider；本文件经 fake timers 直驱协调器。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HOVER_REFRESH_DEFAULTS } from '../../src/shared/hoverRefresh'
import {
  admitHoverWatch,
  HoverRefreshCoordinator,
  shouldForwardHoverDocChange,
  type HoverInvalidationStatus,
} from '../../src/host/hoverRefreshCoordinator'

interface Pushed {
  sessionKeys: string[]
  fsPath: string
  status: HoverInvalidationStatus
  generation: number
}

function makeCoordinator() {
  const pushed: Pushed[] = []
  const coordinator = new HoverRefreshCoordinator({
    pushInvalidation: (sessionKeys, fsPath, status, generation) => {
      pushed.push({ sessionKeys: [...sessionKeys], fsPath, status, generation })
    },
  })
  return { coordinator, pushed }
}

beforeEach(() => {
  vi.useFakeTimers()
})

describe('#244 provider 订阅准入与来源原子交接', () => {
  it('跨面板满槽拒绝新目标；来源拒绝不撤已在场同目标订阅并释放待用租约', () => {
    const coordinator = new HoverRefreshCoordinator({ pushInvalidation: () => {} }, { targetLimit: 1 })
    const pins = new Set<string>()
    const source = { retainHoverSource: (_sessionId: string, _fsPath: string,
      instanceId: string, sourceLeaseId?: string) => {
      if (sourceLeaseId === 'bad') return false
      pins.add(instanceId)
      return true
    } }
    const released: string[] = []
    const admit = (sessionKey: string, fsPath: string, instanceId: string, lease: string) =>
      admitHoverWatch(coordinator, source, { sessionKey, sessionId: sessionKey,
        fsPath, instanceId, sourceLeaseId: lease }, () => released.push(lease))
    expect(admit('panel-A', 'old.md', 'a', 'a-lease')).toBe('ok')
    expect(admit('panel-B', 'old.md', 'b', 'b-lease')).toBe('ok')
    expect(admit('panel-C', 'new.md', 'c', 'c-lease')).toBe('capacity')
    expect(admit('panel-C', 'old.md', 'bad', 'bad')).toBe('source')
    expect(coordinator.stats()).toEqual({ targets: 1, subscriptions: 2 })
    expect(pins).toEqual(new Set(['a', 'b']))
    expect(released).toEqual(['c-lease', 'bad'])
    coordinator.handleDiskEvent('old.md', 'changed')
    expect(coordinator.stats().subscriptions).toBe(2)
    coordinator.dispose()
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('未保存修改跟随（防抖合并刷新）', () => {
  it('被订阅目标的文档修改在防抖窗后推送 changed（不等待保存）', () => {
    const { coordinator, pushed } = makeCoordinator()
    coordinator.watch('s1', 'D:\\notes\\b.md', 'embed-1')
    coordinator.handleDocChanged('D:\\notes\\b.md')
    expect(pushed).toEqual([]) // 防抖窗内不推
    vi.advanceTimersByTime(HOVER_REFRESH_DEFAULTS.debounceMs)
    expect(pushed).toEqual([
      { sessionKeys: ['s1'], fsPath: 'D:\\notes\\b.md', status: 'changed', generation: 1 },
    ])
  })

  it('高频输入合并为一次推送（短暂合并刷新）', () => {
    const { coordinator, pushed } = makeCoordinator()
    coordinator.watch('s1', 'b.md', 'e1')
    for (let i = 0; i < 20; i++) {
      coordinator.handleDocChanged('b.md')
      vi.advanceTimersByTime(50) // 每次输入都在防抖窗内重置
    }
    expect(pushed).toEqual([])
    vi.advanceTimersByTime(HOVER_REFRESH_DEFAULTS.debounceMs)
    expect(pushed).toHaveLength(1)
  })

  it('连续输入不超过强制合并上限（自首个未冲刷事件起算）', () => {
    const { coordinator, pushed } = makeCoordinator()
    coordinator.watch('s1', 'b.md', 'e1')
    coordinator.handleDocChanged('b.md')
    // 持续输入：每 100ms 一次，总时长超过 maxWait 后必须推送
    for (let i = 0; i < HOVER_REFRESH_DEFAULTS.maxWaitMs / 100; i++) {
      vi.advanceTimersByTime(100)
      coordinator.handleDocChanged('b.md')
    }
    vi.advanceTimersByTime(100)
    expect(pushed.length).toBeGreaterThanOrEqual(1)
    expect(pushed.every((p) => p.status === 'changed')).toBe(true)
  })

  it('未被订阅的目标修改零推送（订阅外的文档变更不扩散）', () => {
    const { coordinator, pushed } = makeCoordinator()
    coordinator.watch('s1', 'b.md', 'e1')
    coordinator.handleDocChanged('other.md')
    vi.advanceTimersByTime(HOVER_REFRESH_DEFAULTS.maxWaitMs + 100)
    expect(pushed).toEqual([])
  })

  it('退订后 pending 防抖不再推送（订阅生命周期）', () => {
    const { coordinator, pushed } = makeCoordinator()
    coordinator.watch('s1', 'b.md', 'e1')
    coordinator.handleDocChanged('b.md')
    coordinator.unwatch('s1', 'b.md', 'e1')
    vi.advanceTimersByTime(HOVER_REFRESH_DEFAULTS.maxWaitMs + 100)
    expect(pushed).toEqual([])
  })
})

describe('磁盘事件分态（vaultIndex onTargetChange 直通）', () => {
  it('deleted 立即推送（确认删除撤下内容不等待）并取消 pending 防抖', () => {
    const { coordinator, pushed } = makeCoordinator()
    coordinator.watch('s1', 'b.md', 'e1')
    coordinator.handleDocChanged('b.md') // 防抖窗内
    coordinator.handleDiskEvent('b.md', 'deleted')
    expect(pushed).toEqual([
      { sessionKeys: ['s1'], fsPath: 'b.md', status: 'deleted', generation: 1 },
    ])
    vi.advanceTimersByTime(HOVER_REFRESH_DEFAULTS.maxWaitMs + 100)
    expect(pushed).toHaveLength(1) // pending changed 被取消，不双推
  })

  it('stale（权限/断连）立即推送，不等同删除', () => {
    const { coordinator, pushed } = makeCoordinator()
    coordinator.watch('s1', 'b.md', 'e1')
    coordinator.handleDiskEvent('b.md', 'stale')
    expect(pushed[0]).toMatchObject({ status: 'stale' })
  })

  it('changed 磁盘事件直通（外部改写/保存）并合并 pending 防抖为一次', () => {
    const { coordinator, pushed } = makeCoordinator()
    coordinator.watch('s1', 'b.md', 'e1')
    coordinator.handleDocChanged('b.md') // 未保存事件 pending
    coordinator.handleDiskEvent('b.md', 'changed')
    expect(pushed).toHaveLength(1)
    expect(pushed[0]).toMatchObject({ status: 'changed' })
    vi.advanceTimersByTime(HOVER_REFRESH_DEFAULTS.maxWaitMs + 100)
    expect(pushed).toHaveLength(1)
  })

  it('删除后恢复（changed 跟随 deleted）再推送，代次单调递增', () => {
    const { coordinator, pushed } = makeCoordinator()
    coordinator.watch('s1', 'b.md', 'e1')
    coordinator.handleDiskEvent('b.md', 'deleted')
    coordinator.handleDiskEvent('b.md', 'changed') // 恢复
    expect(pushed.map((p) => p.status)).toEqual(['deleted', 'changed'])
    expect(pushed[0]!.generation).toBe(1)
    expect(pushed[1]!.generation).toBe(2)
    expect(pushed[1]!.generation).toBeGreaterThan(pushed[0]!.generation)
  })

  it('未被订阅目标的磁盘事件零推送', () => {
    const { coordinator, pushed } = makeCoordinator()
    coordinator.handleDiskEvent('stranger.md', 'changed')
    expect(pushed).toEqual([])
  })
})

describe('推送路由与订阅生命周期', () => {
  it('多会话订阅同一目标：一次事件全部送达', () => {
    const { coordinator, pushed } = makeCoordinator()
    coordinator.watch('s1', 'b.md', 'e1')
    coordinator.watch('s2', 'b.md', 'hover-1')
    coordinator.handleDiskEvent('b.md', 'changed')
    expect(pushed).toHaveLength(1)
    expect([...pushed[0]!.sessionKeys].sort()).toEqual(['s1', 's2'])
  })

  it('会话整体释放后不再收到推送（面板销毁：订阅计数回落）', () => {
    const { coordinator, pushed } = makeCoordinator()
    coordinator.watch('s1', 'b.md', 'e1')
    coordinator.watch('s2', 'b.md', 'e1')
    coordinator.releaseSession('s1')
    coordinator.handleDiskEvent('b.md', 'changed')
    expect(pushed).toHaveLength(1)
    expect(pushed[0]!.sessionKeys).toEqual(['s2'])
    expect(coordinator.stats().subscriptions).toBe(1)
  })

  it('stats：目标数与实例订阅数观测（集成断言订阅计数回落）', () => {
    const { coordinator } = makeCoordinator()
    coordinator.watch('s1', 'b.md', 'e1')
    coordinator.watch('s1', 'b.md', 'e2')
    coordinator.watch('s1', 'c.md', 'e1')
    expect(coordinator.stats()).toEqual({ targets: 2, subscriptions: 3 })
    coordinator.unwatch('s1', 'b.md', 'e1')
    expect(coordinator.stats()).toEqual({ targets: 2, subscriptions: 2 })
  })

  it('dispose 清空订阅与 pending 定时器', () => {
    const { coordinator, pushed } = makeCoordinator()
    coordinator.watch('s1', 'b.md', 'e1')
    coordinator.handleDocChanged('b.md')
    coordinator.dispose()
    vi.advanceTimersByTime(HOVER_REFRESH_DEFAULTS.maxWaitMs + 100)
    expect(pushed).toEqual([])
    expect(coordinator.stats()).toEqual({ targets: 0, subscriptions: 0 })
  })
})

describe('自引用防循环（收敛语义）', () => {
  it('修改→推送→再修改→再推送收敛：每轮一轮推送、代次单调，不发散', () => {
    // 自引用场景（A 嵌入 A）的事件序列：编辑 A → 防抖推送 → webview 重载
    // （只读，hover.request→openTextDocument 不产生事件）→ 再编辑 → 再推送。
    // 协调器钉住的收敛性：逐轮事件只产出逐轮推送（1:1），无自我放大
    const { coordinator, pushed } = makeCoordinator()
    coordinator.watch('s1', 'a.md', 'e1')
    for (let round = 0; round < 3; round++) {
      coordinator.handleDocChanged('a.md')
      vi.advanceTimersByTime(HOVER_REFRESH_DEFAULTS.debounceMs)
    }
    expect(pushed).toHaveLength(3)
    expect(pushed.every((p) => p.status === 'changed')).toBe(true)
    expect(pushed.map((p) => p.generation)).toEqual([1, 2, 3])
    coordinator.dispose()
  })

  it('推送回调只发消息不触发宿主事件源（回调内零事件再入，结构性行为）', () => {
    // 生产装配：pushInvalidation → panel.port.send（纯消息出站）——回调
    // 内不调用 handleDocChanged/handleDiskEvent。此处钉住协调器不自带
    // 事件反馈（推送不诱发新事件）：推送后无 pending 定时器残留
    const { coordinator, pushed } = makeCoordinator()
    coordinator.watch('s1', 'a.md', 'e1')
    coordinator.handleDiskEvent('a.md', 'changed')
    expect(pushed).toHaveLength(1)
    vi.advanceTimersByTime(HOVER_REFRESH_DEFAULTS.maxWaitMs + 100)
    expect(pushed).toHaveLength(1) // 无后续自发推送
    coordinator.dispose()
  })
})

// ---- B-1（review-loops 波次一）：text/pdf 引用目标的宿主事件源可达性 ----
// 缺陷：provider 的 onDidChangeTextDocument 转发带 /\.md$/i 硬过滤，
// text 目标（.txt/.json 等）已 watch 时编辑事件被拦（#340「未保存修改
// 正确刷新」对 text 不成立）。判据数据面 = 协调器登记表（isWatched），
// 与 handleDiskEvent 的 registry.has 同一登记表。
describe('B-1：isWatched 观测与 TextDocument 事件转发判据', () => {
  it('isWatched：watch 后为真（归一键大小写折叠），目标内最后实例退场后为假', () => {
    const coordinator = new HoverRefreshCoordinator(
      { pushInvalidation: () => {} },
      { isWindowsHost: true },
    )
    expect(coordinator.isWatched('D:\\notes\\a.txt')).toBe(false)
    coordinator.watch('s1', 'D:\\notes\\a.txt', 'e1')
    expect(coordinator.isWatched('D:\\notes\\a.txt')).toBe(true)
    expect(coordinator.isWatched('D:\\notes\\A.TXT')).toBe(true) // Windows 键归一
    coordinator.unwatch('s1', 'D:\\notes\\a.txt', 'e1')
    expect(coordinator.isWatched('D:\\notes\\a.txt')).toBe(false)
    coordinator.dispose()
  })

  it('isWatched：releaseSession 整体释放与 dispose 后为假（订阅生命周期）', () => {
    const coordinator = new HoverRefreshCoordinator({ pushInvalidation: () => {} })
    coordinator.watch('s1', '/ws/配置.json', 'e1')
    coordinator.releaseSession('s1')
    expect(coordinator.isWatched('/ws/配置.json')).toBe(false)
    coordinator.watch('s2', '/ws/配置.json', 'e2')
    coordinator.dispose()
    expect(coordinator.isWatched('/ws/配置.json')).toBe(false)
  })

  it('转发判据：.md 既有域不变（未订阅也放行——缓存失效广播不依赖订阅在场）；text 未订阅不放行', () => {
    const watched = new Set(['/ws/笔记.txt'])
    const isWatched = (fsPath: string) => watched.has(fsPath)
    // .md 既有行为：未 watch 的 .md 仍转发（修 1 语义保持，不得收窄）
    expect(shouldForwardHoverDocChange('/ws/任意.md', '/ws/任意.md', isWatched)).toBe(true)
    // text：已 watch 放行、未 watch 不放行（按订阅集合驱动）
    expect(shouldForwardHoverDocChange('/ws/笔记.txt', '/ws/笔记.txt', isWatched)).toBe(true)
    expect(shouldForwardHoverDocChange('/ws/其他.json', '/ws/其他.json', isWatched)).toBe(false)
  })

  it('转发判据与协调器登记表同源：watch 登记后 text 目标放行、退场后收回', () => {
    const coordinator = new HoverRefreshCoordinator({ pushInvalidation: () => {} })
    const forward = (docPath: string, fsPath: string) =>
      shouldForwardHoverDocChange(docPath, fsPath, (p) => coordinator.isWatched(p))
    expect(forward('/ws/笔记.txt', '/ws/笔记.txt')).toBe(false)
    coordinator.watch('s1', '/ws/笔记.txt', 'e1')
    expect(forward('/ws/笔记.txt', '/ws/笔记.txt')).toBe(true)
    coordinator.unwatch('s1', '/ws/笔记.txt', 'e1')
    expect(forward('/ws/笔记.txt', '/ws/笔记.txt')).toBe(false)
    coordinator.dispose()
  })

  it('handleDocChanged 对 text 目标同样防抖推送（协调器无 md 载荷假设）', () => {
    const { coordinator, pushed } = makeCoordinator()
    coordinator.watch('s1', '/ws/配置.json', 'embed-1')
    coordinator.handleDocChanged('/ws/配置.json')
    vi.advanceTimersByTime(HOVER_REFRESH_DEFAULTS.debounceMs)
    expect(pushed).toEqual([
      { sessionKeys: ['s1'], fsPath: '/ws/配置.json', status: 'changed', generation: 1 },
    ])
    coordinator.dispose()
  })
})
