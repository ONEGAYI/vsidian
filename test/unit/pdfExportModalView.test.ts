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
    /** 乘子 1 对应「纸面 100%」的反比（窄面板 >1；宽面板 =1）——模拟
     *  适配宽度与纸面尺寸的差距，复位 100% 需把乘子推到该值 */
    paperZoom = 1
    resetZoomCalls = 0
    paperResetCalls = 0
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
      this.resetZoomCalls++
      if (this.zoom === 1) return false
      this.zoom = 1
      return true
    }

    resetToPaperScale(): boolean {
      this.paperResetCalls++
      if (this.zoom === this.paperZoom) return false
      this.zoom = this.paperZoom
      return true
    }

    zoomPercent(): number {
      return Math.round((this.zoom / this.paperZoom) * 100)
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

const mount = (): { view: PdfExportModalView; host: HTMLElement; posted: unknown[] } => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const posted: unknown[] = []
  const view = new PdfExportModalView({ postMessage: (message) => { posted.push(message) } })
  view.mount(host)
  return { view, host, posted }
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

    // 百分比复位走预览专用的纸面 100% 入口，而非阅读器的适合宽度复位
    expect(instance.paperResetCalls).toBeGreaterThan(0)
    expect(instance.resetZoomCalls).toBe(0)
    expect(instance.zoomPercent()).toBe(100)
  })

  it('窄面板：百分比复位到纸面 100%（不是适合宽度），回显随达成值', async () => {
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
    // 窄面板：乘子 1 只到纸面的约 51%，复位需要乘子 ≈1.96
    instance.paperZoom = 794 / 408
    // 走 + 按钮（视图入口）放大一档：百分比按纸面前基准回显 ≈64%
    host.querySelectorAll<HTMLButtonElement>('.vsidian-pdfexport-zoom-btn')[1]!.click()
    const value = host.querySelector<HTMLButtonElement>('.vsidian-pdfexport-zoom-value')!
    expect(value.textContent).toBe('64%')
    value.click()
    expect(value.textContent).toBe('100%')
    expect(instance.paperResetCalls).toBe(1)
    expect(instance.resetZoomCalls).toBe(0)
    // 已在纸面尺寸再点：无效但不报错，回显不变
    value.click()
    expect(value.textContent).toBe('100%')
  })
})

describe('PDF 导出模态视图：统一导出页清单（验收）', () => {
  const LIST_STATE = stateWithPreview({
    list: {
      mode: 'document',
      items: [{ id: 'document', fsPath: 'D:/ws/a.md', rootFsPath: 'D:/ws', relPath: 'a.md' }],
      selectedId: 'document',
    },
    previewTarget: { kind: 'document', doc: { docName: 'a.md', capturedVersion: 1 } },
  })

  it('单文档：清单在右侧栏、一行且选中，主区只有预览（无下拉选择器）', () => {
    const { view, host } = mount()
    view.applyState(LIST_STATE)
    const side = host.querySelector('.vsidian-pdfexport-side')!
    const list = side.querySelector(':scope > .vsidian-pdfexport-export-list')
    expect(list).not.toBeNull()
    const rows = list!.querySelectorAll('.vsidian-pdfexport-batch-item')
    expect(rows.length).toBe(1)
    expect(rows[0]!.classList.contains('vsidian-pdfexport-batch-item-selected')).toBe(true)
    expect(rows[0]!.querySelector('.vsidian-pdfexport-batch-item-rel')?.textContent).toBe('a.md')
    // 主区只剩预览块；工具栏无预览文件下拉
    const main = host.querySelector('.vsidian-pdfexport-preview')!
    expect(main.querySelector('.vsidian-pdfexport-export-list')).toBeNull()
    expect(main.querySelector('.vsidian-pdfexport-previewbar .vsidian-pdfexport-select')).toBeNull()
    // 侧栏清单在参数之前（清单/参数/操作/状态的信息序）
    const sideChildren = Array.from(side.children).map((n) => n.className)
    expect(sideChildren[0]).toContain('vsidian-pdfexport-export-list')
  })

  it('点击清单条目：上行 preview.select（带当前参数），移动/移除按钮不误触选择', () => {
    const { view, host, posted } = mount()
    view.applyState(LIST_STATE)
    const row = host.querySelector<HTMLElement>('.vsidian-pdfexport-batch-item')!
    row.click()
    const select = posted.find((m) => (m as { kind?: string }).kind === 'pdfExportModal.preview.select') as
      | { itemId: string; params: Record<string, unknown> }
      | undefined
    expect(select).toBeDefined()
    expect(select!.itemId).toBe('document')
    expect(select!.params.paper).toBe(PDF_EXPORT_OPTIONS_DEFAULTS.paper)
    // 行内按钮点击不触发条目选择（移除按钮自身路径）
    posted.length = 0
    row.querySelector<HTMLButtonElement>('.vsidian-pdfexport-batch-item-btn:last-of-type')!.click()
    expect(posted.some((m) => (m as { kind?: string }).kind === 'pdfExportModal.batch.remove')).toBe(true)
    expect(posted.some((m) => (m as { kind?: string }).kind === 'pdfExportModal.preview.select')).toBe(false)
  })

  it('批量：选中态跟随 preview.batchItemId，点击另一条上行该条 id', () => {
    const batchState = stateWithPreview({
      batch: {
        mode: 'batch',
        phase: 'editing',
        items: [
          { id: 'b1', fsPath: 'D:/ws/a.md', rootFsPath: 'D:/ws', relPath: 'a.md' },
          { id: 'b2', fsPath: 'D:/ws/b.md', rootFsPath: 'D:/ws', relPath: 'b.md' },
        ],
        strategy: 'rename',
        currentIndex: 0,
        total: 0,
        results: [],
        preview: undefined,
      },
      preview: { phase: 'ready', generation: 1, batchItemId: 'b2', fingerprint: 'fp' },
      previewTarget: { kind: 'batchItem', fsPath: 'D:/ws/b.md', doc: { docName: 'b.md', capturedVersion: 1 } },
    })
    const { view, host, posted } = mount()
    view.applyState(batchState)
    const rows = host.querySelectorAll<HTMLElement>('.vsidian-pdfexport-batch-item')
    expect(rows.length).toBe(2)
    expect(rows[0]!.classList.contains('vsidian-pdfexport-batch-item-selected')).toBe(false)
    expect(rows[1]!.classList.contains('vsidian-pdfexport-batch-item-selected')).toBe(true)
    rows[0]!.click()
    const select = posted.find((m) => (m as { kind?: string }).kind === 'pdfExportModal.preview.select') as
      | { itemId: string }
      | undefined
    expect(select?.itemId).toBe('b1')
  })
})
