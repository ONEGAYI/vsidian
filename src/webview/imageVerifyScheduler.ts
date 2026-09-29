// 图片周期核验调度器（工单 #201）：webview 侧定时器启停与触发时机。
// 语义来自 #194「图片定期刷新与删除态」节：
// - 可见面板已挂载图源每约 30 秒合并核验一次（间隔常量 IMAGE_VERIFY_INTERVAL_MS，
//   工程初值集中可调）
// - 无活跃槽位停止计时（图源条目全回收 / 面板隐藏）；活跃回归或面板恢复
//   可见时重新起表并立即核验一轮
// - 宿主 image.wake（窗口焦点回归/远程重连）触发立即核验（及时核验）
//
// 上报内容由调用方采集（ImageResourceManager.activeEntries——直连外链
// 不入上报）；本类只管「何时上报」。定时器用平台 setInterval（vitest
// fake timers 可直驱），不引入 timer 注入端口。
import { IMAGE_VERIFY_INTERVAL_MS } from '../shared/imageRefresh'

export interface VerifyReportItem {
  src: string
  state: 'loaded' | 'loading' | 'error'
  reason?: string
}

export interface ImageVerifySchedulerOptions {
  /** 当前面板是否可见（缺省读 document.visibilityState；测试注入） */
  visible?: () => boolean
  /** 核验间隔（缺省工程初值约 30 秒；测试注入） */
  intervalMs?: number
}

export class ImageVerifyScheduler {
  private timer: ReturnType<typeof setInterval> | null = null
  private disposed = false

  constructor(
    /** 活跃图源采集（空列表 = 无活跃槽位） */
    private readonly collect: () => VerifyReportItem[],
    /** 上报出口（image.verify 消息发送） */
    private readonly report: (items: VerifyReportItem[]) => void,
    private readonly options: ImageVerifySchedulerOptions = {},
  ) {}

  private get visible(): boolean {
    if (this.options.visible) {
      return this.options.visible()
    }
    return typeof document !== 'undefined' && document.visibilityState === 'visible'
  }

  /** 首个非直连条目建立（ImageResourceManager.onBecomeActive） */
  onBecomeActive(): void {
    this.ensureTimer()
  }

  /** 非直连条目全部回收（onBecomeIdle）——无活跃槽位停止计时 */
  onBecomeIdle(): void {
    this.stopTimer()
  }

  /** 面板可见性变化（visibilitychange 监听由 syncController 绑定） */
  onVisibilityChange(): void {
    if (this.visible) {
      this.tick() // 恢复可见：立即核验
      this.ensureTimer()
    } else {
      this.stopTimer()
    }
  }

  /** 宿主唤醒（image.wake：焦点回归/远程重连的及时核验） */
  wake(): void {
    this.tick()
  }

  dispose(): void {
    this.disposed = true
    this.stopTimer()
  }

  private ensureTimer(): void {
    if (this.timer !== null || this.disposed || !this.visible) {
      return
    }
    this.timer = setInterval(() => this.tick(), this.options.intervalMs ?? IMAGE_VERIFY_INTERVAL_MS)
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** 一轮核验：空活跃集停表不报；有活跃合并上报 */
  private tick(): void {
    if (this.disposed) {
      return
    }
    const items = this.collect()
    if (items.length === 0) {
      this.stopTimer()
      return
    }
    this.report(items)
    this.ensureTimer()
  }
}
