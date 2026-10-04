// PDF 悬停渲染器契约（#337 / P3-05）：状态机（装载/绘制/错误分态/翻页）、
// 取消纪律（重入与 dispose 后迟到结果不落地——旧 canvas 不冒充新目标）
// 与失败装载的 destroy 纪律（#334 探针：失败装载也持有 worker，reject 的
// catch 必须显式 destroy）。jsdom 环境以替身 pdfjs 注入（真实 PDF.js 装配
// 与 canvas 绘制由浏览器 hoverPdf 套件与真宿主集成用例断言）。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __pdfDocumentStoreStatsForTest,
  __resetPdfjsSingletonsForTest,
  __setPdfAssetsForTest,
  PDF_SCROLL_LIMITS,
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

/** pdfjs 替身：文档代理按需构造（numPages / getPage 行为可调）。刻意
 *  **不提供 destroy**——pdfjs 6.x 的 PDFDocumentProxy 没有 destroy 方法
 *  （销毁正道是 loadingTask.destroy，#334 结论）：产品代码若回潮调
 *  doc.destroy 会在本替身上以 TypeError 暴露 */
interface FakeDoc {
  numPages: number
  getPage(pageNumber: number): {
    getViewport(params: { scale: number }): { width: number; height: number }
    render(params: { canvas: HTMLCanvasElement; viewport: { width: number; height: number } }): { promise: Promise<void>; cancel(): void }
  }
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

// ---- #338（P3-06）：全文按页滚动（页 canvas 池 + spacer 虚拟化） ----
// 契约：全文模型（页高度表）与 DOM/canvas 常驻分开——滚动区由 spacer
// 撑开全文高度，仅可见页与有限相邻页保留画布；canvas 常驻与费用不随
// 总页数线性增长；翻页操作与滚动定位互通。
describe('PDF 全文按页滚动（#338）', () => {
  let scrollEl: HTMLElement
  let cleanupFns: Array<() => void> = []

  /** 视口高 mock：滚动区 400px（jsdom 无布局——clientHeight 按类名给值） */
  function mockViewport(): void {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset['pdfScrollPort'] === '1' ? 400 : 0
    })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset['pdfScrollPort'] === '1' ? 448 : 0
    })
  }

  /** 驱动滚动：写 scrollTop 并派发 scroll 事件（jsdom 无布局滚动） */
  function scrollTo(top: number): void {
    scrollEl.scrollTop = top
    scrollEl.dispatchEvent(new Event('scroll'))
  }

  beforeEach(() => {
    __setPdfAssetsForTest(ASSETS)
    ;(globalThis as unknown as { __vsidianPdfjs?: unknown }).__vsidianPdfjs = undefined
    scrollEl = document.createElement('div')
    scrollEl.dataset['pdfScrollPort'] = '1'
    document.body.appendChild(scrollEl)
  })

  afterEach(() => {
    for (const fn of cleanupFns.splice(0)) fn()
    scrollEl.remove()
    __resetPdfjsSingletonsForTest()
    __setPdfAssetsForTest(null)
    ;(globalThis as unknown as { __vsidianPdfjs?: unknown }).__vsidianPdfjs = undefined
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('全文高度撑开：12 页文档装载后 scrollHeight 反映全文（spacer），画布仅窗口内有界', async () => {
    mockViewport()
    installFakePdfjs(makeFakeDoc(12))
    const view = new PdfHoverView(scrollEl)
    cleanupFns.push(() => view.dispose())
    expect(await view.show('https://files.test/a.pdf?v=1', 1, 448)).toBe(true)
    const probe = view.probe()
    expect(probe.phase).toBe('content')
    expect(probe.totalPages).toBe(12)
    // 页高 792 * (448/612) ≈ 579px/页 × 12 页 —— 撑开全文高度（不随窗口缩）
    expect(probe.scrollHeight).toBeGreaterThanOrEqual(12 * 500)
    // 画布有界：视口 400px 只见 1 页 + 两侧 pad —— 恒小于总页数
    expect(probe.mountedPages).toBeGreaterThan(0)
    expect(probe.mountedPages).toBeLessThan(12)
    expect(probe.mountedPages).toBeLessThanOrEqual(PDF_SCROLL_LIMITS.maxMountedPages)
    // canvas 数 = mountedPages（DOM 画布与 probe 一致）
    expect(scrollEl.querySelectorAll('canvas').length).toBe(probe.mountedPages)
  })

  it('滚动窗口平移：滚到中段后中段页挂载、远端页画布回收（常驻不随总页数增长）', async () => {
    mockViewport()
    installFakePdfjs(makeFakeDoc(12))
    const view = new PdfHoverView(scrollEl)
    cleanupFns.push(() => view.dispose())
    await view.show('https://files.test/a.pdf?v=1', 1, 448)
    const before = view.probe()
    // 滚到第 7 页顶部（按装载后的实测页高动态定位——不依赖取整常数）
    const perPage = view.probe().scrollHeight / 12
    scrollTo(Math.round(6 * perPage) + 1)
    await pumpUntil(() => view.probe().page >= 7)
    const mid = view.probe()
    expect(mid.page).toBeGreaterThanOrEqual(7)
    expect(mid.mountedPages).toBeLessThanOrEqual(PDF_SCROLL_LIMITS.maxMountedPages)
    // 远端页回收：第 1/2 页（远离中段窗口）的页占位与画布均不在场
    expect(scrollEl.querySelector('[data-page="1"]')).toBeNull()
    expect(scrollEl.querySelector('[data-page="2"]')).toBeNull()
    // DOM 画布数不超过挂载槽数（在途页槽允许尚无画布）
    expect(scrollEl.querySelectorAll('canvas').length).toBeLessThanOrEqual(mid.mountedPages)
    expect(mid.canvasBytes).toBeLessThanOrEqual(PDF_SCROLL_LIMITS.canvasBudgetBytes)
    // 回滚顶部：窗口回到首页区间（mounted 有界不变）
    scrollTo(0)
    await pumpUntil(() => view.probe().page === 1)
    const back = view.probe()
    expect(back.mountedPages).toBeLessThanOrEqual(PDF_SCROLL_LIMITS.maxMountedPages)
    void before
  })

  it('翻页操作 = 滚动定位：turnPage 推进到目标页 offset，与滚动互通（probe.page 随滚动更新）', async () => {
    mockViewport()
    installFakePdfjs(makeFakeDoc(6))
    const view = new PdfHoverView(scrollEl)
    cleanupFns.push(() => view.dispose())
    await view.show('https://files.test/a.pdf?v=1', 1, 448)
    expect(view.probe().page).toBe(1)
    expect(view.turnPage(1, 448)).toBe(true)
    await pumpUntil(() => view.probe().phase === 'content' && view.probe().page === 2)
    // 滚动定位落到第 2 页区间（offset(2) = 579 附近，非 0）
    const probe = view.probe()
    expect(probe.scrollTop).toBeGreaterThan(300)
    expect(probe.page).toBe(2)
    // 出界无操作
    expect(view.turnPage(-1, 448)).toBe(true)
    expect(view.turnPage(-1, 448)).toBe(false)
  })

  it('页高回填：真实高度更新高度表（估计 → 实测），滚动区高度随之修正', async () => {
    mockViewport()
    // 第 3 页是双倍高的长页（估计按默认纵横比装载）
    const doc = makeFakeDoc(4, { 3: makeFakePage(612, 1584) })
    installFakePdfjs(doc)
    const view = new PdfHoverView(scrollEl)
    cleanupFns.push(() => view.dispose())
    await view.show('https://files.test/a.pdf?v=1', 1, 448)
    const estimated = view.probe().scrollHeight
    // 滚到第 3 页 → 触发第 3 页渲染 → 回填真实高度（按实测页高动态定位）
    const perPage = estimated / 4
    scrollTo(Math.round(2 * perPage) + 1)
    await pumpUntil(() => view.probe().page === 3)
    // 回填后全文高度高于纯估计（第 3 页从 ~580 修正到 ~1160）
    expect(view.probe().scrollHeight).toBeGreaterThan(estimated + 300)
  })

  it('文档数据共享：同 URI 两视图共享一份文档，dispose 一个不销毁另一个，全释放才 destroy（loadingTask 正道——PDFDocumentProxy 无 destroy）', async () => {
    mockViewport()
    const doc = makeFakeDoc(3)
    // 销毁计数挂 loadingTask.destroy（installFakePdfjs 的 state.destroyed
    // ——pdfjs 6.x 文档代理无 destroy 方法，产品代码调用会在替身上 TypeError）
    const state = installFakePdfjs(doc)
    const viewA = new PdfHoverView(scrollEl)
    const viewB = new PdfHoverView(scrollEl)
    cleanupFns.push(() => viewA.dispose(), () => viewB.dispose())
    await viewA.show('https://files.test/a.pdf?v=1', 1, 448)
    await viewB.show('https://files.test/a.pdf?v=1', 2, 448)
    expect(__pdfDocumentStoreStatsForTest()).toEqual(
      expect.arrayContaining([{ uri: 'https://files.test/a.pdf?v=1', refs: 2 }]))
    viewA.dispose()
    expect(state.destroyed, '仍有一个消费者——文档不得销毁').toBe(0)
    expect(__pdfDocumentStoreStatsForTest()).toEqual(
      expect.arrayContaining([{ uri: 'https://files.test/a.pdf?v=1', refs: 1 }]))
    viewB.dispose()
    expect(state.destroyed, '最后一个消费者释放后销毁文档与 worker').toBe(1)
    expect(__pdfDocumentStoreStatsForTest()).toEqual([])
  })

  it('版本替换重载：?v= 推进 → 新文档装载，浏览位置合法钳制（页数变少时）', async () => {
    mockViewport()
    // 两次装载返回不同文档（uri ?v= 不同 = store 不同键；fake 按装载次序给文档）
    let loadCount = 0
    installFakePdfjs(() => {
      loadCount++
      return Promise.resolve(loadCount === 1 ? makeFakeDoc(12) : makeFakeDoc(4))
    })
    const view = new PdfHoverView(scrollEl)
    cleanupFns.push(() => view.dispose())
    await view.show('https://files.test/a.pdf?v=1', 1, 448)
    // 滚到第 10 页（按装载后的页高动态定位）
    const perPage = view.probe().scrollHeight / 12
    scrollTo(Math.round(9 * perPage) + 1)
    await pumpUntil(() => view.probe().page >= 10)
    // 文件替换：?v=2，新文档只有 4 页 → 当前页 10 钳制到第 4 页
    expect(await view.show('https://files.test/a.pdf?v=2', undefined, 448)).toBe(true)
    const probe = view.probe()
    expect(probe.phase).toBe('content')
    expect(probe.totalPages).toBe(4)
    expect(probe.page).toBe(4)
  })

  it('canvas 费用预算：宽视口下挂载窗口受预算钳制（canvasBytes ≤ 预算）', async () => {
    mockViewport()
    installFakePdfjs(makeFakeDoc(30))
    const view = new PdfHoverView(scrollEl)
    cleanupFns.push(() => view.dispose())
    // renderWidth 3000 → scale 4.9 被 maxScale 2.5 钳制 → 每页 ~1530×1980×4 ≈ 11.6MiB
    // 预算 40MiB ≈ 3.4 页 → 窗口挂载数被预算收窄
    await view.show('https://files.test/a.pdf?v=1', 1, 3000)
    const probe = view.probe()
    expect(probe.phase).toBe('content')
    expect(probe.canvasBytes).toBeLessThanOrEqual(PDF_SCROLL_LIMITS.canvasBudgetBytes)
    // 至少保底当前可见页
    expect(probe.mountedPages).toBeGreaterThanOrEqual(1)
    expect(probe.mountedPages).toBeLessThan(30)
  })
})
