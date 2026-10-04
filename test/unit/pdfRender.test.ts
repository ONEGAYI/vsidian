// PDF 悬停渲染器契约（#337 / P3-05）：状态机（装载/绘制/错误分态/翻页）、
// 取消纪律（重入与 dispose 后迟到结果不落地——旧 canvas 不冒充新目标）
// 与失败装载的 destroy 纪律（#334 探针：失败装载也持有 worker，reject 的
// catch 必须显式 destroy）。jsdom 环境以替身 pdfjs 注入（真实 PDF.js 装配
// 与 canvas 绘制由浏览器 hoverPdf 套件与真宿主集成用例断言）。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetPdfjsSingletonsForTest,
  __setPdfAssetsForTest,
  pdfErrorText,
  PdfHoverView,
  type PdfAssetsConfig,
} from '../../src/webview/pdfRender'

/** 装配资源替身（生产经宿主 HTML 内联全局注入） */
const ASSETS: PdfAssetsConfig = {
  mainJs: 'https://assets.test/pdfMain.js',
  workerJs: 'https://assets.test/pdfWorker.js',
  cMapUrl: 'https://assets.test/cmaps',
  fontUrl: 'https://assets.test/fonts',
  wasmUrl: 'https://assets.test/wasm',
  iccUrl: 'https://assets.test/iccs',
}

/** pdfjs 替身：文档代理按需构造（numPages / getPage 行为可调） */
interface FakeDoc {
  numPages: number
  getPage(pageNumber: number): {
    getViewport(params: { scale: number }): { width: number; height: number }
    render(params: { canvas: HTMLCanvasElement; viewport: { width: number; height: number } }): { promise: Promise<void>; cancel(): void }
  }
  destroy(): Promise<void>
}

function makeFakePage(width = 612, height = 792, renderImpl?: () => Promise<void>) {
  return {
    getViewport: ({ scale }: { scale: number }) => ({ width: width * scale, height: height * scale }),
    render: ({ canvas, viewport }: { canvas: HTMLCanvasElement; viewport: { width: number; height: number } }) => {
      let rejectOuter: ((err: Error) => void) | undefined
      const task = {
        promise: new Promise<void>((resolve, reject) => {
          rejectOuter = reject
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          if (renderImpl) {
            void renderImpl().then(resolve, reject)
          } else {
            resolve()
          }
        }),
        cancel: () => {
          // 渲染取消：以 RenderingCancelledException 拒绝在途 promise（吞
          // unhandled——渲染器对取消的 catch 分支不构成错误态）
          const err = new Error('cancelled')
          err.name = 'RenderingCancelledException'
          task.promise.catch(() => {})
          rejectOuter?.(err)
        },
      }
      return task
    },
  }
}

function makeFakeDoc(numPages: number, pages: Record<number, ReturnType<typeof makeFakePage>> = {}): FakeDoc {
  return {
    numPages,
    getPage: (n: number) => pages[n] ?? makeFakePage(),
    destroy: vi.fn(async () => {}),
  }
}

function installFakePdfjs(doc: FakeDoc | ((src: Record<string, unknown>) => Promise<FakeDoc>)): { destroyed: number } {
  const state = { destroyed: 0 }
  const lib = {
    GlobalWorkerOptions: { workerSrc: '' },
    getDocument: (src: Record<string, unknown>) => {
      // 装载即 transfer（#334 实测行为：主线程 byteLength 归零）——替身侧
      // 不实际 detach（jsdom/Node 的 buffer 语义差异不影响被测契约）
      void (src.data as Uint8Array)
      const task = {
        promise: typeof doc === 'function' ? doc(src) : Promise.resolve(doc),
        destroy: async () => {
          state.destroyed++
        },
      }
      return task
    },
  }
  ;(globalThis as unknown as { __vsidianPdfjs?: unknown }).__vsidianPdfjs = lib
  const fetchImpl = vi.fn(async (_url: string) => ({
    ok: true,
    arrayBuffer: async () => new TextEncoder().encode('fake-pdf-bytes').buffer,
    text: async () => 'worker-text',
  }))
  vi.stubGlobal('fetch', fetchImpl)
  vi.stubGlobal('Blob', class {
    // jsdom Blob 兜底（vitest environment 见配置；显式替换保证可移植）
  })
  const createObjectURL = vi.fn(() => 'blob:fake-worker-url')
  const revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))
  // jsdom 无 canvas 包（getContext 返回 null）：stub 2d 上下文（真实绘制由
  // 浏览器 hoverPdf 套件断言）
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    return {
      fillStyle: '',
      fillRect: () => {},
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4).fill(200),
      }),
    } as unknown as CanvasRenderingContext2D
  })
  return state
}


/** microtask 泵：推进 show 的装载链直到谓词成立（挂起点就位） */
async function pumpUntil(pred: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !pred(); i++) {
    await Promise.resolve()
  }
  expect(pred(), '挂起点应就位（装载链推进超时）').toBe(true)
}

describe('PDF 悬停渲染器（#337）', () => {
  let container: HTMLElement
  let cleanupFns: Array<() => void> = []

  beforeEach(() => {
    __setPdfAssetsForTest(ASSETS)
    ;(globalThis as unknown as { __vsidianPdfjs?: unknown }).__vsidianPdfjs = undefined
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    for (const fn of cleanupFns.splice(0)) fn()
    container.remove()
    __resetPdfjsSingletonsForTest()
    __setPdfAssetsForTest(null)
    ;(globalThis as unknown as { __vsidianPdfjs?: unknown }).__vsidianPdfjs = undefined
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('首条闭环：装载 + 绘制成功 → content 态（页码与 canvas 尺寸入观测面）', async () => {
    installFakePdfjs(makeFakeDoc(5))
    const view = new PdfHoverView(container)
    cleanupFns.push(() => view.dispose())
    const applied = await view.show('https://files.test/a.pdf?v=1', 3, 448)
    expect(applied).toBe(true)
    const probe = view.probe()
    expect(probe.phase).toBe('content')
    expect(probe.page).toBe(3)
    expect(probe.totalPages).toBe(5)
    expect(probe.requestedPage).toBe(3)
    expect(probe.canvasWidth).toBeGreaterThan(0)
    expect(probe.canvasHeight).toBeGreaterThan(0)
  })

  it('无页码从第一页开始；页码越界 → page-range 错误分态（不静默跳第一页）', async () => {
    installFakePdfjs(makeFakeDoc(3))
    const view = new PdfHoverView(container)
    cleanupFns.push(() => view.dispose())
    expect(await view.show('https://files.test/a.pdf?v=1', undefined, 448)).toBe(true)
    expect(view.probe().page).toBe(1)
    expect(view.probe().phase).toBe('content')

    expect(await view.show('https://files.test/a.pdf?v=1', 9, 448)).toBe(true)
    const probe = view.probe()
    expect(probe.phase).toBe('error')
    expect(probe.errorReason).toBe('page-range')
    expect(probe.requestedPage).toBe(9)
    expect(probe.totalPages).toBe(3)
  })

  it('损坏分态：InvalidPDFException → corrupt，且装载 task 显式 destroy（失败装载也持有 worker 的纪律）', async () => {
    const destroyed = installFakePdfjs(async () => {
      const err = new Error('Invalid PDF structure')
      err.name = 'InvalidPDFException'
      throw err
    })
    const view = new PdfHoverView(container)
    cleanupFns.push(() => view.dispose())
    expect(await view.show('https://files.test/bad.pdf?v=1', undefined, 448)).toBe(true)
    expect(view.probe().phase).toBe('error')
    expect(view.probe().errorReason).toBe('corrupt')
    expect(destroyed.destroyed, 'getDocument reject 后必须显式 destroy').toBe(1)
  })

  it('加密分态：PasswordException → encrypted（首批提示在原应用打开）', async () => {
    installFakePdfjs(async () => {
      const err = new Error('No password given')
      err.name = 'PasswordException'
      throw err
    })
    const view = new PdfHoverView(container)
    cleanupFns.push(() => view.dispose())
    expect(await view.show('https://files.test/enc.pdf?v=1', undefined, 448)).toBe(true)
    expect(view.probe().errorReason).toBe('encrypted')
  })

  it('取消纪律：dispose 后迟到绘制不落地（旧 canvas 不冒充新目标）', async () => {
    // 挂起在页渲染（装载完成后、绘制完成前 dispose——迟到的绘制 resolve）
    let releaseRender!: () => void
    const hangingPage = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }),
      render: () => ({
        promise: new Promise<void>((resolve) => {
          releaseRender = resolve
        }),
        cancel: () => {
          releaseRender()
        },
      }),
    }
    const doc = makeFakeDoc(2, { 1: hangingPage as unknown as ReturnType<typeof makeFakePage> })
    installFakePdfjs(doc)
    const view = new PdfHoverView(container)
    const pending = view.show('https://files.test/slow.pdf?v=1', 1, 448)
    // 等待装载与 getPage 进入挂起的 renderTask（microtask 泵推进）
    await pumpUntil(() => typeof releaseRender === 'function')
    view.dispose()
    releaseRender()
    expect(await pending).toBe(false)
    expect(view.probe().phase).toBe('idle')
    expect(container.children.length, 'dispose 清空 DOM').toBe(0)
  })

  it('重入取代：新 show 使旧的在途绘制不落地（同 URI 换页码复用文档翻页）', async () => {
    let releaseRender!: () => void
    const hangingPage = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }),
      render: () => ({
        promise: new Promise<void>((resolve) => {
          releaseRender = resolve
        }),
        cancel: () => {
          releaseRender()
        },
      }),
    }
    const doc = makeFakeDoc(4, { 1: hangingPage as unknown as ReturnType<typeof makeFakePage> })
    installFakePdfjs(doc)
    const view = new PdfHoverView(container)
    cleanupFns.push(() => view.dispose())
    const first = view.show('https://files.test/a.pdf?v=1', 1, 448)
    await pumpUntil(() => typeof releaseRender === 'function')
    const second = view.show('https://files.test/a.pdf?v=1', 2, 448)
    releaseRender()
    expect(await first).toBe(false)
    expect(await second).toBe(true)
    expect(view.probe().page).toBe(2)
  })

  it('翻页操作：next/prev 推进页码，翻出界为无操作（只读——不改任何文档）', async () => {
    installFakePdfjs(makeFakeDoc(3))
    const view = new PdfHoverView(container)
    cleanupFns.push(() => view.dispose())
    expect(await view.show('https://files.test/a.pdf?v=1', 1, 448)).toBe(true)
    expect(view.turnPage(1, 448)).toBe(true)
    expect(view.turnPage(-1, 448)).toBe(true)
    // 回到第 1 页后再 prev：出界无操作
    expect(view.turnPage(-1, 448)).toBe(false)
    view.turnPage(1, 448)
    view.turnPage(1, 448)
    expect(view.turnPage(1, 448)).toBe(false)
  })

  it('装配资源缺失 → load-failed 分态（如实呈现，不静默空白）', async () => {
    __setPdfAssetsForTest(null)
    const view = new PdfHoverView(container)
    cleanupFns.push(() => view.dispose())
    expect(await view.show('https://files.test/a.pdf?v=1', 1, 448)).toBe(true)
    expect(view.probe().errorReason).toBe('load-failed')
  })

  it('失效撤下：discardContent 清 canvas（deleted/stale 不冒充在场内容），视图保留可复用', async () => {
    installFakePdfjs(makeFakeDoc(2))
    const view = new PdfHoverView(container)
    cleanupFns.push(() => view.dispose())
    await view.show('https://files.test/a.pdf?v=1', 1, 448)
    expect(view.probe().phase).toBe('content')
    view.discardContent()
    const probe = view.probe()
    expect(probe.phase).toBe('idle')
    expect(probe.canvasWidth).toBe(0)
  })
})

describe('PDF 渲染错误分态 → i18n 文案映射（#337）', () => {
  it('五分态均有文案且穷举闭合（测试环境 t() 回键名——分态映射经键名断言，措辞由 i18nLocales parity 把关）', () => {
    expect(pdfErrorText('corrupt', 0, 0)).toBe('hover.pdfErrorCorrupt')
    expect(pdfErrorText('encrypted', 0, 0)).toBe('hover.pdfErrorEncrypted')
    expect(pdfErrorText('page-range', 9, 3)).toBe('hover.pdfErrorPageRange')
    expect(pdfErrorText('resource', 0, 0)).toBe('hover.pdfErrorResource')
    expect(pdfErrorText('load-failed', 0, 0)).toBe('hover.pdfErrorLoadFailed')
  })
})
