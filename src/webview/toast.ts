import './toast.css'

export type ToastSeverity = 'neutral' | 'warning' | 'error'

/** 气泡内可点操作（如撤销）：label 由调用方本地化后传入，本模块不引入语言包。 */
export interface ToastAction { label: string; onClick: () => void }

/** 带 action 的 toast 默认呈现时长：覆盖「读清文案 + 移动指针点击撤销」的窗口（规格 behavior-manage-pagination.md §2.5 D14）。 */
export const TOAST_ACTION_DURATION_MS = 8000

interface Notice { text: string; severity: ToastSeverity; key?: string; action?: ToastAction }

/** 编辑器本地轻提示；不依赖宿主通知，最多一条可见、五条等待。 */
export class ToastChannel {
  private readonly container: HTMLElement
  private current: Notice | undefined
  private readonly pending: Notice[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  /** 悬停/聚焦双暂停源：指针与键盘焦点可交叠（悬停中点按钮），任一在场即暂停倒计时。 */
  private hoverPaused = false
  private focusPaused = false
  /** 已进入退场：退场不被暂停打断，也不在退场中恢复呈现计时。 */
  private leaving = false
  private activeToast: HTMLElement | undefined
  private remainingMs = 0
  private armedAtMs = 0

  constructor(private readonly app: HTMLElement) {
    this.container = document.createElement('div')
    this.container.className = 'vsidian-toast-container'
    this.container.setAttribute('role', 'status')
    this.container.setAttribute('aria-live', 'polite')
    this.container.setAttribute('aria-atomic', 'true')
    app.append(this.container)
  }

  show(text: string, severity: ToastSeverity = 'neutral', key?: string, action?: ToastAction): void {
    if (this.disposed || !text) return
    const notice: Notice = { text, severity, ...(key !== undefined ? { key } : {}), ...(action ? { action } : {}) }
    if (key !== undefined) {
      for (let i = this.pending.length - 1; i >= 0; i--) {
        if (this.pending[i]!.key === key) this.pending.splice(i, 1)
      }
      if (this.current?.key === key) {
        this.clearCurrent()
        this.present(notice)
        return
      }
    }
    const previous = this.pending.at(-1) ?? this.current
    // 完全相同才去重：action 以 label 与回调引用参与比较——同文案不同撤销目标不得被误吞。
    if (previous?.text === text && previous.severity === severity && previous.key === key
      && previous.action?.label === action?.label && previous.action?.onClick === action?.onClick) return
    if (!this.current) this.present(notice)
    else if (this.pending.length < 5) this.pending.push(notice)
  }

  /** 只使指定业务组的消息失效，不影响其他本地提示或宿主通知。 */
  dismiss(key: string): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (this.pending[i]!.key === key) this.pending.splice(i, 1)
    }
    if (this.current?.key === key) this.advance()
  }

  /** 清当前气泡并推进队列；显式移除（dismiss/点击 action）不走退场动画。 */
  private advance(): void {
    this.clearCurrent()
    const next = this.pending.shift()
    if (next) this.present(next)
  }

  private clearCurrent(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.current = undefined
    this.activeToast = undefined
    this.leaving = false
    this.container.replaceChildren()
  }

  private duration(token: string, fallback: number, cssTime = false): number {
    const raw = getComputedStyle(this.app).getPropertyValue(token).trim()
    const value = Number.parseFloat(raw)
    if (!Number.isFinite(value) || value < 0) return fallback
    return Math.min(value * (cssTime && /^\d*\.?\d+s$/.test(raw) ? 1000 : 1), 60000)
  }

  private present(notice: Notice): void {
    this.current = notice
    this.hoverPaused = false
    this.focusPaused = false
    this.leaving = false
    const toast = document.createElement('div')
    toast.className = 'vsidian-toast'
    toast.dataset['severity'] = notice.severity
    toast.append(notice.text)
    const severity = notice.severity === 'neutral' ? '' : `${notice.severity}-`
    const fallback = notice.severity === 'warning' ? 4000 : notice.severity === 'error' ? 5000 : 2600
    const durationMs = notice.action
      ? TOAST_ACTION_DURATION_MS
      : this.duration(`--vsidian-toast-${severity}duration`, fallback)
    // 倒计时条：所有 toast 都渲染；时长按气泡内联注入（不新增公开 CSS 变量）。
    const bar = document.createElement('div')
    bar.className = 'vsidian-toast-timer'
    bar.style.animationDuration = `${durationMs}ms`
    toast.append(bar)
    if (notice.action) {
      const action = notice.action
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'vsidian-toast-action'
      button.textContent = action.label
      button.addEventListener('click', () => {
        action.onClick()
        this.advance()
      })
      toast.append(button)
    }
    // JS 计时与 CSS 条动画双轨：同一组 enter/leave 事件驱动暂停恢复、同一起点（present）同速率。
    toast.addEventListener('pointerenter', () => { this.hoverPaused = true; this.pause() })
    toast.addEventListener('pointerleave', () => { this.hoverPaused = false; if (!this.focusPaused) this.resume() })
    toast.addEventListener('focusin', () => { this.focusPaused = true; this.pause() })
    toast.addEventListener('focusout', () => { this.focusPaused = false; if (!this.hoverPaused) this.resume() })
    this.container.replaceChildren(toast)
    this.activeToast = toast
    this.armTimer(durationMs)
  }

  private armTimer(ms: number): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.remainingMs = ms
    this.armedAtMs = Date.now()
    this.timer = setTimeout(() => this.expire(), ms)
  }

  private pause(): void {
    if (!this.current || this.leaving || this.timer === undefined) return
    clearTimeout(this.timer)
    this.timer = undefined
    this.remainingMs = Math.max(0, this.remainingMs - (Date.now() - this.armedAtMs))
  }

  private resume(): void {
    if (!this.current || this.leaving || this.timer !== undefined) return
    this.armTimer(this.remainingMs)
  }

  private expire(): void {
    this.timer = undefined
    this.leaving = true
    this.activeToast?.classList.add('vsidian-toast--leaving')
    this.timer = setTimeout(() => this.advance(), this.duration('--vsidian-toast-exit-duration', 120, true))
  }

  dispose(): void {
    this.disposed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.pending.length = 0
    this.current = undefined
    this.activeToast = undefined
    this.container.remove()
  }
}
