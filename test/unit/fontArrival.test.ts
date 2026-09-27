// 字体晚到监听契约（#130）：片段样式表落地后 @font-face 字体常在链 load
// 之后才异步装载完成——装载成功的即时重测可能早于字体生效。本模块钉住
// 「等待字体集稳定后再回调」的时序语义（有界多轮 + 新装载重启等待）。
// 真实字体晚到的重测与滚动锚定效果由 test/browser/cssHttpsImports.mjs
// 在真实 Chromium 布局上验证；jsdom 无 FontFaceSet，这里用可控假件驱动。
import { describe, it, expect, vi } from 'vitest'
import { createFontArrivalWatch, type FontSetLike } from '../../src/webview/fontArrival'

/** 可控字体集：ready 按批 resolve；status 由测试翻转 */
class FakeFontSet implements FontSetLike {
  status: 'loading' | 'idle' = 'idle'
  private waiters: Array<() => void> = []
  private readonly readyBase: Promise<unknown>
  constructor() {
    // 每轮 ready 都要能重新挂起（真实 FontFaceSet.ready 在新装载开始后
    // 重新 pending）——用「当前批 promise」模拟：settle 批次即 resolve
    this.readyBase = Promise.resolve()
  }
  get ready(): Promise<unknown> {
    if (this.status === 'loading') {
      return new Promise<void>((resolve) => {
        this.waiters.push(resolve)
      })
    }
    return this.readyBase
  }
  /** 开启一批装载：status=loading，ready 挂起 */
  beginLoad(): void {
    this.status = 'loading'
  }
  /** 结束一批装载：status=idle，ready resolve */
  finishLoad(): void {
    this.status = 'idle'
    const waiters = this.waiters
    this.waiters = []
    for (const w of waiters) {
      w()
    }
  }
}

const nextTick = () => new Promise<void>((r) => setTimeout(r, 0))
/** 排空 watch 内部的 ready 微任务与 nextFrame 定时器（node 环境无 rAF，
 *  nextFrame 退化为 setTimeout 0——需要多轮 tick 让「ready→帧→status 检查」
 *  的异步链走完） */
const flush = async (rounds = 6): Promise<void> => {
  for (let i = 0; i < rounds; i++) {
    await nextTick()
  }
}

describe('字体晚到监听（#130）', () => {
  it('无字体集（旧环境无 document.fonts）：schedule 即回调（退化为立即重测）', () => {
    const onArrived = vi.fn()
    const watch = createFontArrivalWatch(() => undefined, onArrived)
    watch.schedule()
    expect(onArrived).toHaveBeenCalledTimes(1)
  })

  it('空闲字体集：等待 ready 与一帧后回调一次（有界，不空转）', async () => {
    const fonts = new FakeFontSet()
    const onArrived = vi.fn()
    const watch = createFontArrivalWatch(() => fonts, onArrived)
    watch.schedule()
    await flush()
    expect(onArrived).toHaveBeenCalledTimes(1)
    // 再无新装载：不重复回调
    await flush()
    expect(onArrived).toHaveBeenCalledTimes(1)
  })

  it('装载中的字体集：等该批完成（fonts.ready resolve）后才回调——晚到字体触发重测', async () => {
    const fonts = new FakeFontSet()
    const onArrived = vi.fn()
    const watch = createFontArrivalWatch(() => fonts, onArrived)
    fonts.beginLoad()
    watch.schedule()
    await flush()
    expect(onArrived).not.toHaveBeenCalled() // 字体未到不重测
    fonts.finishLoad()
    await flush()
    expect(onArrived).toHaveBeenCalledTimes(1)
  })

  it('首帧后又启动新装载（远程表内第二个字体族）：重启等待，稳定后只回调一次', async () => {
    const fonts = new FakeFontSet()
    const onArrived = vi.fn()
    const watch = createFontArrivalWatch(() => fonts, onArrived)
    fonts.beginLoad()
    watch.schedule()
    fonts.finishLoad()
    await nextTick()
    expect(onArrived).not.toHaveBeenCalled() // 检查帧后 status 前不回调
    // 帧间隙（layout 消费字体）又启动新一批（如阅读重挂载用到第二个族）
    fonts.beginLoad()
    await flush()
    expect(onArrived).not.toHaveBeenCalled() // 新批次在途：等待覆盖
    fonts.finishLoad()
    await flush()
    expect(onArrived).toHaveBeenCalledTimes(1)
  })

  it('running 期间重复 schedule 合并：空闲批次不补跑，回调恰一次', async () => {
    const fonts = new FakeFontSet()
    const onArrived = vi.fn()
    const watch = createFontArrivalWatch(() => fonts, onArrived)
    fonts.beginLoad()
    watch.schedule()
    watch.schedule()
    watch.schedule()
    fonts.finishLoad()
    await flush()
    expect(onArrived).toHaveBeenCalledTimes(1)
  })

  it('running 期间 schedule 且确有新批次在途：结算后补一轮（覆盖新装载）', async () => {
    const fonts = new FakeFontSet()
    const onArrived = vi.fn()
    const watch = createFontArrivalWatch(() => fonts, onArrived)
    fonts.beginLoad()
    watch.schedule() // 第一轮开始（挂起等待批次一）
    // 批次一完成后、第一轮尚未结算时应用新片段（批次二立即启动）
    fonts.finishLoad()
    fonts.beginLoad()
    watch.schedule() // running 中：置 rerunRequested
    fonts.finishLoad()
    await flush()
    expect(onArrived.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(onArrived.mock.calls.length).toBeLessThanOrEqual(2) // 不并发空跑
  })

  it('ready 拒绝（异常字体集）：不吞回调——仍执行一次重测（正文可读优先）', async () => {
    const fonts: FontSetLike = {
      status: 'loading',
      get ready() {
        return Promise.reject(new Error('fonts broken'))
      },
    }
    const onArrived = vi.fn()
    const watch = createFontArrivalWatch(() => fonts, onArrived)
    watch.schedule()
    await flush()
    expect(onArrived).toHaveBeenCalledTimes(1)
  })

  it('dispose 后不再回调（面板卸载）', async () => {
    const fonts = new FakeFontSet()
    const onArrived = vi.fn()
    const watch = createFontArrivalWatch(() => fonts, onArrived)
    watch.dispose()
    watch.schedule()
    await flush()
    expect(onArrived).not.toHaveBeenCalled()
  })
})
