// 图片周期核验调度器契约（工单 #201）：webview 侧定时器启停与触发时机。
// 语义来自 #194「图片定期刷新与删除态」节：可见面板已挂载图源每约 30 秒
// 合并核验一次；无活跃槽位停止计时；面板恢复可见立即核验一轮。
// 定时器行为用 vitest fake timers 钉住（真实 30 秒间隔不进测试等待）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ImageVerifyScheduler } from '../../src/webview/imageVerifyScheduler'
import { IMAGE_VERIFY_INTERVAL_MS } from '../../src/shared/imageRefresh'

type Sent = Array<{ src: string; state: string; reason?: string }>

describe('周期核验调度器（#201）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function makeScheduler(opts?: {
    items?: Array<{ src: string; state: 'loaded' | 'loading' | 'error'; reason?: string }>
    visible?: boolean
  }) {
    let items = opts?.items ?? []
    const sent: Sent = []
    const scheduler = new ImageVerifyScheduler(
      () => items,
      (payload) => {
        sent.push(...(payload as Sent))
      },
      { visible: () => opts?.visible ?? true },
    )
    return {
      scheduler,
      sent,
      setItems: (next: typeof items) => {
        items = next
      },
    }
  }

  it('活跃回调启动计时：间隔到合并上报全部活跃图源', () => {
    const t = makeScheduler({
      items: [
        { src: './a.png', state: 'loaded' },
        { src: './b.png', state: 'error', reason: 'not-found' },
      ],
    })
    t.scheduler.onBecomeActive()
    expect(t.sent.length).toBe(0) // 起表不立即核验（下周期才核验）
    vi.advanceTimersByTime(IMAGE_VERIFY_INTERVAL_MS)
    expect(t.sent).toEqual([
      { src: './a.png', state: 'loaded' },
      { src: './b.png', state: 'error', reason: 'not-found' },
    ])
  })

  it('周期滚动：连续轮次持续上报', () => {
    const t = makeScheduler({ items: [{ src: './a.png', state: 'loaded' }] })
    t.scheduler.onBecomeActive()
    vi.advanceTimersByTime(IMAGE_VERIFY_INTERVAL_MS * 3)
    expect(t.sent.length).toBe(3)
  })

  it('无活跃槽位停止计时：不再上报', () => {
    const t = makeScheduler({ items: [{ src: './a.png', state: 'loaded' }] })
    t.scheduler.onBecomeActive()
    vi.advanceTimersByTime(IMAGE_VERIFY_INTERVAL_MS)
    expect(t.sent.length).toBe(1)
    t.setItems([])
    vi.advanceTimersByTime(IMAGE_VERIFY_INTERVAL_MS * 3)
    expect(t.sent.length).toBe(1) // 空轮后停表
    // 活跃回归：重新起表
    t.setItems([{ src: './a.png', state: 'loaded' }])
    t.scheduler.onBecomeActive()
    vi.advanceTimersByTime(IMAGE_VERIFY_INTERVAL_MS)
    expect(t.sent.length).toBe(2)
  })

  it('onBecomeIdle 停表（条目全回收）', () => {
    const t = makeScheduler({ items: [{ src: './a.png', state: 'loaded' }] })
    t.scheduler.onBecomeActive()
    t.scheduler.onBecomeIdle()
    vi.advanceTimersByTime(IMAGE_VERIFY_INTERVAL_MS * 2)
    expect(t.sent.length).toBe(0)
  })

  it('wake 立即核验一轮（不等周期；焦点回归/远程重连的及时核验）', () => {
    const t = makeScheduler({ items: [{ src: './a.png', state: 'loaded' }] })
    t.scheduler.onBecomeActive()
    t.scheduler.wake()
    expect(t.sent.length).toBe(1)
    // wake 后周期表仍滚动
    vi.advanceTimersByTime(IMAGE_VERIFY_INTERVAL_MS)
    expect(t.sent.length).toBe(2)
  })

  it('wake 时无活跃图源：不上报也不起表', () => {
    const t = makeScheduler({ items: [] })
    t.scheduler.wake()
    expect(t.sent.length).toBe(0)
    vi.advanceTimersByTime(IMAGE_VERIFY_INTERVAL_MS * 2)
    expect(t.sent.length).toBe(0)
  })

  it('面板隐藏停表、恢复可见立即核验并重新起表', () => {
    let visible = true
    const sent: Sent = []
    let items: Array<{ src: string; state: 'loaded' }> = [{ src: './a.png', state: 'loaded' }]
    const scheduler = new ImageVerifyScheduler(
      () => items,
      (payload) => {
        sent.push(...(payload as Sent))
      },
      { visible: () => visible },
    )
    scheduler.onBecomeActive()
    visible = false
    scheduler.onVisibilityChange()
    vi.advanceTimersByTime(IMAGE_VERIFY_INTERVAL_MS * 2)
    expect(sent.length).toBe(0) // 隐藏期间停表
    visible = true
    scheduler.onVisibilityChange()
    expect(sent.length).toBe(1) // 恢复可见立即核验
    vi.advanceTimersByTime(IMAGE_VERIFY_INTERVAL_MS)
    expect(sent.length).toBe(2) // 并重新起表
  })

  it('隐藏面板的 onBecomeActive 不起表（等恢复可见）', () => {
    const t = makeScheduler({ items: [{ src: './a.png', state: 'loaded' }], visible: false })
    t.scheduler.onBecomeActive()
    vi.advanceTimersByTime(IMAGE_VERIFY_INTERVAL_MS * 2)
    expect(t.sent.length).toBe(0)
  })

  it('dispose 停表', () => {
    const t = makeScheduler({ items: [{ src: './a.png', state: 'loaded' }] })
    t.scheduler.onBecomeActive()
    t.scheduler.dispose()
    vi.advanceTimersByTime(IMAGE_VERIFY_INTERVAL_MS * 2)
    expect(t.sent.length).toBe(0)
  })
})
