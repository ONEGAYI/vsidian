import {
  WORKSPACE_FILES_DIMENSIONS, type WorkspaceFilesDimension, type WorkspaceFilesLayout,
} from '../shared/protocol'
import type { MessageKey } from '../shared/locales/en'
import { closeHoverPopupIfAnchorWithin } from './hoverPopup'
import { bindLocale } from './localeDom'

const RESIZE_STEP = 8
type Geometry = { min: number; max: number; size: number }
type ResizeGesture = {
  handle: HTMLElement
  dimension: WorkspaceFilesDimension
  pointerId: number
  start: number
  geometry: Geometry
  size: number
}

/** 两个分隔条共用一套拖动事务：移动只改画面，落定才同步到宿主。 */
export class WorkspaceFilesLayoutControls {
  readonly widthHandle: HTMLElement
  readonly heightHandle: HTMLElement
  private readonly observer: ResizeObserver | undefined
  private layout: WorkspaceFilesLayout = {
    width: WORKSPACE_FILES_DIMENSIONS.width.default,
    openedHeight: WORKSPACE_FILES_DIMENSIONS.openedHeight.default,
  }
  private gesture: ResizeGesture | undefined

  constructor(private readonly body: HTMLElement, private readonly aside: HTMLElement,
    private readonly opened: HTMLElement, private readonly list: HTMLElement,
    private readonly send: (dimension: WorkspaceFilesDimension, size: number | null) => void) {
    this.widthHandle = this.makeHandle('width', 'workspaceFiles.resizeWidth', aside.id)
    this.heightHandle = this.makeHandle('openedHeight', 'workspaceFiles.resizeOpened', list.id)
    this.heightHandle.hidden = true
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.updateAria())
      this.observer.observe(body)
      this.observer.observe(aside)
      this.observer.observe(list)
    }
  }

  get resizing(): boolean { return this.gesture !== undefined }

  apply(layout: WorkspaceFilesLayout): void {
    if (layout.width === this.layout.width && layout.openedHeight === this.layout.openedHeight) return
    this.layout = layout
    closeHoverPopupIfAnchorWithin(this.aside)
    this.render()
  }

  setVisible(open: boolean, hasTabs: boolean): void {
    this.heightHandle.hidden = !hasTabs
    if (!open || (!hasTabs && this.gesture?.dimension === 'openedHeight')) this.cancel()
  }

  dispose(): void {
    this.cancel()
    this.observer?.disconnect()
  }

  handleKeydown(event: KeyboardEvent): boolean {
    if (event.key === 'Escape' && this.gesture) {
      event.preventDefault()
      event.stopPropagation()
      this.cancel()
      return true
    }
    const dimension = event.target === this.widthHandle ? 'width' : event.target === this.heightHandle ? 'openedHeight' : undefined
    if (this.aside.inert || !dimension || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false
    const { min, max, size } = this.geometry(dimension)
    const increment = dimension === 'width'
      ? (getComputedStyle(this.aside).direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight')
      : 'ArrowDown'
    const decrement = dimension === 'width' ? (increment === 'ArrowRight' ? 'ArrowLeft' : 'ArrowRight') : 'ArrowUp'
    const value = event.key === increment ? Math.min(max, size + RESIZE_STEP)
      : event.key === decrement ? Math.max(min, size - RESIZE_STEP)
      : event.key === 'Home' ? min
      : event.key === 'End' ? max
      : event.key === 'Enter' ? WORKSPACE_FILES_DIMENSIONS[dimension].default
      : undefined
    if (value === undefined) return false
    event.preventDefault()
    if (!this.gesture && (event.key === 'Enter' || size !== value)) this.commit(dimension, value)
    return true
  }

  private makeHandle(dimension: WorkspaceFilesDimension, label: MessageKey, controls: string): HTMLElement {
    const handle = document.createElement('div')
    const width = dimension === 'width'
    handle.className = `vsidian-file-resizer vsidian-file-resizer-${width ? 'width' : 'height'}`
    handle.tabIndex = 0
    handle.setAttribute('role', 'separator')
    handle.setAttribute('aria-orientation', width ? 'vertical' : 'horizontal')
    handle.setAttribute('aria-controls', controls)
    bindLocale(handle, 'aria-label', label)
    const coordinate = (event: PointerEvent) => width
      ? event.clientX * (getComputedStyle(this.aside).direction === 'rtl' ? -1 : 1)
      : event.clientY
    handle.addEventListener('pointerdown', event => {
      if (this.aside.inert || handle.hidden || this.gesture || event.button !== 0 || event.buttons !== 1 || !event.isPrimary) return
      event.preventDefault()
      closeHoverPopupIfAnchorWithin(this.aside)
      handle.focus({ preventScroll: true })
      const geometry = this.geometry(dimension)
      this.gesture = { handle, dimension, pointerId: event.pointerId, start: coordinate(event), geometry, size: geometry.size }
      handle.setPointerCapture(event.pointerId)
      handle.classList.add('vsidian-file-resizer-active')
      if (width) this.aside.classList.add('vsidian-file-sidebar-resizing')
      window.addEventListener('blur', this.cancel)
    })
    handle.addEventListener('pointermove', event => {
      const gesture = this.gesture
      if (gesture?.pointerId !== event.pointerId) return
      // 同一指针的第二个鼠标键变化会送 pointermove，而不另送 pointerdown。
      if (event.buttons !== 1) return this.cancel()
      const { min, max, size } = gesture.geometry
      const value = Math.max(min, Math.min(max, Math.round(size + coordinate(event) - gesture.start)))
      if (gesture.size === value) return
      gesture.size = value
      this.render()
    })
    handle.addEventListener('pointerup', event => {
      const gesture = this.gesture
      if (gesture?.pointerId !== event.pointerId) return
      if (event.button !== 0 || event.buttons !== 0) return this.cancel()
      const { size, geometry } = gesture
      this.finish()
      if (size === geometry.size) this.render()
      else this.commit(dimension, size)
    })
    const lost = (event: PointerEvent) => {
      if (this.gesture?.pointerId === event.pointerId) this.cancel()
    }
    handle.addEventListener('pointercancel', lost)
    handle.addEventListener('lostpointercapture', lost)
    handle.addEventListener('dblclick', () => {
      if (!this.aside.inert && !handle.hidden && !this.gesture) this.commit(dimension, WORKSPACE_FILES_DIMENSIONS[dimension].default)
    })
    handle.addEventListener('focus', () => this.updateAria())
    return handle
  }

  private geometry(dimension: WorkspaceFilesDimension): Geometry {
    const { min, max } = WORKSPACE_FILES_DIMENSIONS[dimension]
    const isWidth = dimension === 'width'
    const cap = isWidth ? parseFloat(getComputedStyle(this.aside).maxWidth)
      : parseFloat(getComputedStyle(this.opened).maxHeight) - (this.opened.clientHeight - this.list.clientHeight)
    const limit = Number.isFinite(cap) ? Math.max(0, Math.min(max, Math.floor(cap))) : max
    const size = Math.round(isWidth ? this.aside.getBoundingClientRect().width : this.list.clientHeight)
    return { min: Math.min(min, limit), max: limit, size }
  }

  private updateAria(): void {
    if (this.aside.inert) return
    const update = (handle: HTMLElement, dimension: WorkspaceFilesDimension) => {
      const { min, max, size } = this.geometry(dimension)
      handle.setAttribute('aria-valuemin', String(min))
      handle.setAttribute('aria-valuemax', String(max))
      handle.setAttribute('aria-valuenow', String(Math.max(min, Math.min(max, size))))
    }
    update(this.widthHandle, 'width')
    if (!this.heightHandle.hidden) update(this.heightHandle, 'openedHeight')
  }

  private render(): void {
    const width = this.gesture?.dimension === 'width' ? this.gesture.size : this.layout.width
    const height = this.gesture?.dimension === 'openedHeight' ? this.gesture.size : this.layout.openedHeight
    this.body.style.setProperty('--_vsidian-file-sidebar-requested-width', `${width}px`)
    if (height === null) this.opened.style.removeProperty('--_vsidian-file-opened-height')
    else this.opened.style.setProperty('--_vsidian-file-opened-height', `${height}px`)
    this.updateAria()
  }

  private commit(dimension: WorkspaceFilesDimension, size: number | null): void {
    if (size !== null) size = Math.max(WORKSPACE_FILES_DIMENSIONS[dimension].min, size)
    const oldSize = this.layout[dimension]
    if (dimension === 'width') {
      if (size === null) return
      this.layout = { ...this.layout, width: size }
    } else this.layout = { ...this.layout, openedHeight: size }
    this.render()
    if (size === oldSize) return
    closeHoverPopupIfAnchorWithin(this.aside)
    this.send(dimension, size)
  }

  private finish(): void {
    const gesture = this.gesture
    if (!gesture) return
    this.gesture = undefined
    window.removeEventListener('blur', this.cancel)
    gesture.handle.classList.remove('vsidian-file-resizer-active')
    this.aside.classList.remove('vsidian-file-sidebar-resizing')
    if (gesture.handle.hasPointerCapture(gesture.pointerId)) gesture.handle.releasePointerCapture(gesture.pointerId)
  }

  private readonly cancel = (): void => {
    if (!this.gesture) return
    this.finish()
    this.render()
  }
}
