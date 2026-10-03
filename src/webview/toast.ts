import './toast.css'

export type ToastSeverity = 'neutral' | 'warning' | 'error'
interface Notice { text: string; severity: ToastSeverity; key?: string }

/** 编辑器本地轻提示；不依赖宿主通知，最多一条可见、五条等待。 */
export class ToastChannel {
  private readonly container: HTMLElement
  private current: Notice | undefined
  private readonly pending: Notice[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private disposed = false

  constructor(private readonly app: HTMLElement) {
    this.container = document.createElement('div')
    this.container.className = 'vsidian-toast-container'
    this.container.setAttribute('role', 'status')
    this.container.setAttribute('aria-live', 'polite')
    this.container.setAttribute('aria-atomic', 'true')
    app.append(this.container)
  }

  show(text: string, severity: ToastSeverity = 'neutral', key?: string): void {
    if (this.disposed || !text) return
    if (key !== undefined) {
      const notice = { text, severity, key }
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
    if (previous?.text === text && previous.severity === severity && previous.key === key) return
    const notice = { text, severity, ...(key !== undefined ? { key } : {}) }
    if (!this.current) this.present(notice)
    else if (this.pending.length < 5) this.pending.push(notice)
  }

  /** 只使指定业务组的消息失效，不影响其他本地提示或宿主通知。 */
  dismiss(key: string): void {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (this.pending[i]!.key === key) this.pending.splice(i, 1)
    }
    if (this.current?.key === key) {
      this.clearCurrent()
      const next = this.pending.shift()
      if (next) this.present(next)
    }
  }

  private clearCurrent(): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.current = undefined
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
    const toast = document.createElement('div')
    toast.className = 'vsidian-toast'
    toast.dataset['severity'] = notice.severity
    toast.textContent = notice.text
    this.container.replaceChildren(toast)
    const severity = notice.severity === 'neutral' ? '' : `${notice.severity}-`
    const fallback = notice.severity === 'warning' ? 4000 : notice.severity === 'error' ? 5000 : 2600
    this.timer = setTimeout(() => {
      toast.classList.add('vsidian-toast--leaving')
      this.timer = setTimeout(() => {
        this.container.replaceChildren()
        this.current = undefined
        const next = this.pending.shift()
        if (next) this.present(next)
      }, this.duration('--vsidian-toast-exit-duration', 120, true))
    }, this.duration(`--vsidian-toast-${severity}duration`, fallback))
  }

  dispose(): void {
    this.disposed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.pending.length = 0
    this.current = undefined
    this.container.remove()
  }
}
