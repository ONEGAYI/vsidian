import { bindLocale } from './localeDom'

/** 一个阅读视口只画一条底栏；实际水平位移仍由各表格/代码区持有。 */
export class ReadingHorizontalScroll {
  readonly scrollbar: HTMLElement
  private readonly scrollbarContent: HTMLElement
  private readonly listeners = new AbortController()
  private readonly surfaces = new Map<HTMLElement, HTMLElement>()
  private readonly observer: ResizeObserver | undefined
  private readonly intersection: IntersectionObserver | undefined
  private target: HTMLElement | null = null
  private frame: number | undefined

  constructor(private readonly viewport: HTMLElement) {
    const doc = viewport.ownerDocument
    this.scrollbar = doc.createElement('div')
    this.scrollbar.className = 'vsidian-reading-scrollbar'
    this.scrollbar.hidden = true
    this.scrollbar.tabIndex = 0
    this.scrollbar.setAttribute('role', 'region')
    bindLocale(this.scrollbar, 'aria-label', 'reading.horizontalScrollbar')
    this.scrollbarContent = doc.createElement('div')
    this.scrollbar.append(this.scrollbarContent)
    const { signal } = this.listeners
    viewport.addEventListener('scroll', event => {
      if (this.target && event.target === this.target) {
        this.scrollbar.scrollLeft = this.target.scrollLeft
      } else if (event.target === viewport) {
        this.refresh()
      }
    }, { capture: true, signal })
    viewport.addEventListener('pointerdown', event => this.activateAt(event), { signal })
    viewport.addEventListener('wheel', event => {
      if (event.deltaX !== 0 || event.shiftKey && event.deltaY !== 0) this.activateAt(event)
    }, { passive: true, signal })
    this.scrollbar.addEventListener('scroll', () => {
      if (this.target) this.target.scrollLeft = this.scrollbar.scrollLeft
    }, { signal })
    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(() => this.refresh())
      this.observer.observe(viewport)
    }
    if (typeof IntersectionObserver === 'function') {
      // 前面的图片或折叠块可把目标推离视口，而不改变目标自身的尺寸。
      this.intersection = new IntersectionObserver(() => this.refresh(), { root: viewport })
    }
  }

  get activeTarget(): HTMLElement | null {
    return this.target
  }

  track(owner: HTMLElement, surface: HTMLElement): void {
    if (!this.surfaces.has(owner)) {
      this.surfaces.set(owner, surface)
      this.observer?.observe(surface)
      this.intersection?.observe(surface)
    }
    this.refresh()
  }

  untrack(owner: HTMLElement): void {
    const surface = this.surfaces.get(owner)
    if (!surface) return
    this.surfaces.delete(owner)
    this.observer?.unobserve(surface)
    this.intersection?.unobserve(surface)
    if (this.target === surface) this.target = null
    this.refresh()
  }

  refresh(): void {
    if (this.frame !== undefined || (this.surfaces.size === 0 && this.scrollbar.hidden)) return
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined
      this.update()
    })
  }

  dispose(): void {
    this.listeners.abort()
    this.observer?.disconnect()
    this.intersection?.disconnect()
    if (this.frame !== undefined) cancelAnimationFrame(this.frame)
    this.scrollbar.remove()
  }

  /** 只让显式手势换目标；原生 scroll 事件可能来自已经换出的内容。 */
  private activateAt(event: Event): void {
    for (const node of event.composedPath()) {
      if (node === this.viewport) break
      if (!(node instanceof HTMLElement)) continue
      const target = this.surfaces.get(node)
      if (target) {
        if (target !== this.target) this.update(target)
        break
      }
    }
  }

  private update(preferred = this.target): void {
    const viewport = this.viewport.getBoundingClientRect()
    let target: HTMLElement | null = null
    let bounds: DOMRect | null = null
    if (viewport.height > 0) {
      for (const surface of this.surfaces.values()) {
        if (surface.scrollWidth <= surface.clientWidth) continue
        const rect = surface.getBoundingClientRect()
        if (rect.bottom <= viewport.top || rect.top >= viewport.bottom) continue
        if (surface === preferred || !bounds || rect.top < bounds.top) {
          target = surface
          bounds = rect
        }
        if (surface === preferred) break
      }
    }
    this.target = target
    this.scrollbar.hidden = target === null
    if (!target || !bounds) return
    this.scrollbar.style.marginLeft = `${bounds.left - viewport.left}px`
    this.scrollbar.style.width = `${target.clientWidth}px`
    this.scrollbarContent.style.width = `${target.scrollWidth}px`
    // RTL 目标的 scrollLeft 是负值；底栏必须在相同坐标系中同步。
    this.scrollbar.style.direction = getComputedStyle(target).direction
    this.scrollbar.scrollLeft = target.scrollLeft
  }
}
