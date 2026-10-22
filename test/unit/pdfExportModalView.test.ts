// PDF 导出模态视图（验收修复轮）：预览列宽按纸面宽封顶、左下角缩放条、
// Ctrl+滚轮与加载扫光骨架的装配契约。PdfHoverView 以替身注入（真实渲染由
// pdfRender 单测与浏览器套件覆盖）——本文件只钉视图侧接线与派生值。
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

const { FakePdfHoverView } = vi.hoisted(() => {
  class FakePdfHoverView {
    static instances: FakePdfHoverView[] = []
    readonly container: HTMLElement
    maxRenderWidth = 0
    private zoom = 1
    private ready = false
    shows: string[] = []

    constructor(container: HTMLElement) {
      this.container = container
      FakePdfHoverView.instances.push(this)
    }

    show(uri: string): Promise<boolean> {
      this.shows.push(uri)
      this.ready = true
      return Promise.resolve(true)
    }

    get contentReady(): boolean {
      return this.ready
    }

    setMaxRenderWidth(width: number | undefined): void {
      this.maxRenderWidth = width ?? 0
    }

    zoomBy(factor: number): boolean {
      this.zoom *= factor
      return true
    }

    resetZoom(): boolean {
      if (this.zoom === 1) return false
      this.zoom = 1
      return true
    }

    zoomPercent(): number {
      return Math.round(this.zoom * 100)
    }

    probe(): { phase: string } {
      return { phase: this.ready ? 'content' : 'idle' }
    }

    dispose(): void {}
  }
  return { FakePdfHoverView }
})

vi.mock('../../src/webview/pdfRender', () => ({
  PdfHoverView: FakePdfHoverView,
  PDF_ZOOM_STEP: 1.25,
}))

import { PDF_EXPORT_OPTIONS_DEFAULTS } from '../../src/shared/pdfExportOptions'
import { PdfExportModalView } from '../../src/webview/pdfExportModalView'

const STATE = {
  kind: 'pdfExportModal.state' as const,
  phase: 'idle' as const,
  generation: 0,
  docName: 'a.md',
  capturedVersion: 1,
  defaults: { ...PDF_EXPORT_OPTIONS_DEFAULTS },
  browserPath: '',
  hostToday: '2026-10-22',
  preview: { phase: 'idle' as const, generation: 0 },
}

const stateWithPreview = (overrides: Record<string, unknown>) => ({
  ...STATE,
  ...overrides,
  preview: { ...STATE.preview, ...(overrides['preview'] as Record<string, unknown> | undefined) },
})

const mount = (): { view: PdfExportModalView; host: HTMLElement } => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const view = new PdfExportModalView({ postMessage: () => undefined })
  view.mount(host)
  return { view, host }
}

const printWidthVar = (host: HTMLElement): string =>
  host.querySelector<HTMLElement>('.vsidian-pdfexport')?.style.getPropertyValue('--vsidian-pdfexport-print-width') ?? ''

afterEach(() => {
  document.body.textContent = ''
  FakePdfHoverView.instances.length = 0
  delete (globalThis as { __vsidianTestHooks?: boolean }).__vsidianTestHooks
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('PDF 导出模态视图：预览宽度与缩放条', () => {
  it('预览列宽按当前纸面宽派生（A4 纵向 794px；A3 横向随参数更新）', () => {
    ;(globalThis as { __vsidianTestHooks?: boolean }).__vsidianTestHooks = true
    const { view, host } = mount()
    view.applyState(STATE)
    expect(printWidthVar(host)).toBe('794px')

    view.applyTestSetParam({ field: 'paper', value: 'a3' })
    expect(printWidthVar(host)).toBe('1122px')
    view.applyTestSetParam({ field: 'orientation', value: 'landscape' })
    // A3 横向宽 = 16.54in × 96
    expect(printWidthVar(host)).toBe('1588px')
  })

  it('生成在途且无产物：显示扫光骨架（9 个同族灰块），空态不显示缩放条', () => {
    const { view, host } = mount()
    view.applyState(STATE)
    view.applyState(stateWithPreview({ preview: { phase: 'generating', generation: 1 } }))
    const skeleton = host.querySelector('.vsidian-pdfexport-preview-skeleton')
    expect(skeleton).not.toBeNull()
    expect(skeleton!.querySelectorAll('.vsidian-skeleton-block').length).toBe(9)
    // 节拍变量来自 shared/skeletonTiming（不是 CSS 内重复常量）
    expect((skeleton as HTMLElement).style.getPropertyValue('--vsidian-pdfexport-skeleton-cycle')).toBe('1500ms')
    expect((skeleton as HTMLElement).style.getPropertyValue('--vsidian-pdfexport-skeleton-delay')).toBe('300ms')
    expect(host.querySelector('.vsidian-pdfexport-preview-stage--empty')).not.toBeNull()
  })

  it('产物落地：缩放条可见、百分比回显，按钮与 Ctrl+滚轮走 PdfHoverView 同一缩放入口', async () => {
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:preview'),
      revokeObjectURL: vi.fn(),
    })
    const { view, host } = mount()
    view.applyState(stateWithPreview({ preview: { phase: 'ready', generation: 1, fingerprint: 'fp' } }))
    view.applyPreviewArtifact(1, btoa('preview'))
    await vi.waitFor(() => {
      expect(host.querySelector('.vsidian-pdfexport-preview-skeleton')).toBeNull()
    })

    const instance = FakePdfHoverView.instances[0]!
    // 预览封顶 = 纸面宽（宽面板不拉伸）
    expect(instance.maxRenderWidth).toBe(794)
    const value = host.querySelector<HTMLButtonElement>('.vsidian-pdfexport-zoom-value')!
    expect(value.textContent).toBe('100%')

    const scroll = host.querySelector('.vsidian-pdfexport-preview-scroll')!
    const wheel = new WheelEvent('wheel', { ctrlKey: true, deltaY: -100, bubbles: true, cancelable: true })
    scroll.dispatchEvent(wheel)
    expect(wheel.defaultPrevented).toBe(true)
    expect(value.textContent).toBe('125%')

    host.querySelectorAll<HTMLButtonElement>('.vsidian-pdfexport-zoom-btn')[0]!.click()
    expect(value.textContent).toBe('100%')
    host.querySelectorAll<HTMLButtonElement>('.vsidian-pdfexport-zoom-btn')[1]!.click()
    expect(value.textContent).toBe('125%')
    value.click()
    expect(value.textContent).toBe('100%')

    // 普通滚轮不拦截（页面仍可滚动）
    const plain = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true })
    scroll.dispatchEvent(plain)
    expect(plain.defaultPrevented).toBe(false)
  })
})
