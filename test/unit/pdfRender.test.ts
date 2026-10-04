// PDF 悬停渲染器契约（#337 / P3-05）：状态机（装载/绘制/错误分态/翻页）、
// 取消纪律（重入与 dispose 后迟到结果不落地——旧 canvas 不冒充新目标）
// 与失败装载的 destroy 纪律（#334 探针：失败装载也持有 worker，reject 的
// catch 必须显式 destroy）。jsdom 环境以替身 pdfjs 注入（真实 PDF.js 装配
// 与 canvas 绘制由浏览器 hoverPdf 套件与真宿主集成用例断言）。
// #339（P3-07）追加：用户缩放（与 scale 上限/画布预算联动、适合宽度复位、
// 容器宽度变化重绘）、文本层（pdfjs TextLayer 消费面——挂载/缩放重建/
// 扫描页不虚构）与链接层（分类纯函数 + 元素交互 + 安全面）。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __pdfDocumentStoreStatsForTest,
  __resetPdfjsSingletonsForTest,
  __setPdfAssetsForTest,
  classifyPdfLink,
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
    getViewport: ({ scale }: { scale: number }) => ({
      width: width * scale,
      height: height * scale,
      // #339 链接定位消费面（真实 pdfjs viewport 均携带；rotation 0 的
      // 标准 y 翻转变换）
      scale,
      transform: [scale, 0, 0, -scale, 0, height * scale],
    }),
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

// ---- #339（P3-07）替身扩展：文本层 / 链接注解 / 文档目标解析 ----

/** 文本项（pdfjs TextItem 最小消费面：str + transform[6] + width/height） */
interface FakeTextItem {
  str: string
  transform: number[]
  width: number
  height: number
  fontName?: string
  dir?: string
  hasEOL?: boolean
}

/** 链接注解（pdfjs getAnnotations 输出的 Link 子集消费面） */
interface FakeLinkAnnotation {
  subtype?: string
  rect?: [number, number, number, number]
  url?: string
  unsafeUrl?: string
  dest?: unknown
  action?: string
  attachment?: unknown
}

/** 带文本与链接的页替身（生产消费面：getViewport/render/streamTextContent/
 *  getAnnotations） */
function makeFakeTextPage(
  width: number,
  height: number,
  opts: { textItems?: FakeTextItem[]; annotations?: FakeLinkAnnotation[] } = {},
) {
  return {
    ...makeFakePage(width, height),
    streamTextContent: () => ({ items: opts.textItems ?? [], styles: {} }),
    getAnnotations: async () => opts.annotations ?? [],
  }
}

/** 文档替身（含 #339 目标解析面：getPageIndex / getDestination） */
function makeFakeDocWithDests(
  numPages: number,
  namedDests: Record<string, unknown> = {},
  pages: Record<number, ReturnType<typeof makeFakePage> | ReturnType<typeof makeFakeTextPage>> = {},
) {
  // 页引用对象（num = 页号-1）：getPageIndex 按 Ref 反查页序
  return {
    numPages,
    getPage: (n: number) => (pages[n] ?? makeFakePage()) as ReturnType<typeof makeFakePage>,
    getPageIndex: async (ref: { num: number }) => ref.num,
    getDestination: async (id: string) => namedDests[id] ?? null,
  }
}

/** TextLayer 替身：按 textContentSource（对象形态）把 span 挂进容器——
 *  生产代码把 streamTextContent() 结果原样交给 TextLayer 构造（pdfjs
 *  接受 ReadableStream 与对象两形态；替身走对象形态） */
class FakeTextLayer {
  static instances: FakeTextLayer[] = []
  constructor(private readonly params: { textContentSource: unknown; container: HTMLElement }) {
    FakeTextLayer.instances.push(this)
  }
  async render(): Promise<void> {
    const source = this.params.textContentSource as { items?: FakeTextItem[] }
    for (const item of source.items ?? []) {
      const span = document.createElement('span')
      span.textContent = item.str
      this.params.container.appendChild(span)
    }
  }
  cancel(): void {
    this.params.container.textContent = ''
  }
}

/** PDF 源 fetch 的可编程计划（D-2 测试钉：失败/挂起/重试控制）。worker
 *  fetch 恒 ok——blob 单例装配不参与被测契约；计划对象由测试中途可变
 *  （fetchImpl 闭包引用——首败后改回 200 即可断言重试语义） */
interface FakeFetchPlan {
  /** PDF 源 fetch 的 HTTP 状态（非 200 → !ok；默认 200） */
  pdfStatus?: number
  /** 就位则 PDF 源 fetch 等待该 gate（挂起装载链——fetch 阶段 dispose 用） */
  pdfGate?: Promise<void>
  /** #344：按 URL 精确挂起（并发装载身份判定——多 URI 场景单挂其一；
   *  与 pdfGate 互斥使用，就位时优先于全局 gate） */
  pdfGateFor?: (url: string) => Promise<void> | undefined
}

/** fetch 替身响应面（显式注解——两分支返回形态统一，避免推断循环） */
interface FakeFetchResponse {
  ok: boolean
  status: number
  arrayBuffer: () => Promise<ArrayBuffer>
  text: () => Promise<string>
}

function installFakePdfjs(
  doc: FakeDoc | ((src: Record<string, unknown>) => Promise<FakeDoc>),
  plan: FakeFetchPlan = {},
) {
  const state = { destroyed: 0, loaded: 0 }
  const lib = {
    GlobalWorkerOptions: { workerSrc: '' },
    // #339：TextLayer 构造面（真实 pdfjs 全局导出；替身挂同一键）
    TextLayer: FakeTextLayer,
    getDocument: (src: Record<string, unknown>) => {
      // 装载即 transfer（#334 实测行为：主线程 byteLength 归零）——替身侧
      // 不实际 detach（jsdom/Node 的 buffer 语义差异不影响被测契约）
      void (src.data as Uint8Array)
      state.loaded++
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
  const fetchImpl = vi.fn(async (url: string): Promise<FakeFetchResponse> => {
    if (url === ASSETS.workerJs) {
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new TextEncoder().encode('fake-pdf-bytes').buffer as ArrayBuffer,
        text: async () => 'worker-text',
      }
    }
    if (plan.pdfGateFor !== undefined) {
      const gate = plan.pdfGateFor(url)
      if (gate !== undefined) {
        await gate
      }
    } else if (plan.pdfGate !== undefined) {
      await plan.pdfGate
    }
    const status = plan.pdfStatus ?? 200
    return {
      ok: status === 200,
      status,
      arrayBuffer: async () => new TextEncoder().encode('fake-pdf-bytes').buffer as ArrayBuffer,
      text: async () => 'pdf-text',
    }
  })
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
  // Object.assign 就地挂 fetchImpl：返回**同一 state 引用**（计数由闭包
  // 递增——展开拷贝会读出恒 0 的快照）
  return Object.assign(state, { fetchImpl })
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

  it('主库 onload 后全局缺失：load-failed 分态且单例已重置（重试可装载，D-1 半边）', async () => {
    // 不预置替身全局：走 ensurePdfjs 动态 <script> 路径（jsdom 不自动装载）
    const view = new PdfHoverView(container)
    cleanupFns.push(() => view.dispose())
    const pending = view.show('https://files.test/a.pdf?v=1', 1, 448)
    await pumpUntil(() => document.querySelector(`script[src="${ASSETS.mainJs}"]`) !== null)
    // 手动触发 onload 且不设 __vsidianPdfjs（产物异常）→ 该分支 reject
    document.querySelector(`script[src="${ASSETS.mainJs}"]`)!.dispatchEvent(new Event('load'))
    expect(await pending).toBe(true)
    const probe = view.probe()
    expect(probe.phase).toBe('error')
    expect(probe.errorReason).toBe('load-failed')
    // 可重试：装上替身全局后同 URI 再 show → 装载成功（证明 pdfjsLoad 已
    // 重置——未重置时第二次会拿到同一 rejected Promise，仍是 load-failed）
    installFakePdfjs(makeFakeDoc(2))
    expect(await view.show('https://files.test/a.pdf?v=1', 1, 448)).toBe(true)
    expect(view.probe().phase).toBe('content')
    expect(view.probe().totalPages).toBe(2)
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

  // ---- review-loops 波次二（D/E 审查修复）----

  it('fetch 失败：resource 分态 + store 条目不残留（E-1）——同 URI 二次 show 重新 fetch（瞬时失败可重试，D-2①）', async () => {
    mockViewport()
    const plan: FakeFetchPlan = { pdfStatus: 404 }
    const state = installFakePdfjs(makeFakeDoc(3), plan)
    const view = new PdfHoverView(scrollEl)
    cleanupFns.push(() => view.dispose())
    const uri = 'https://files.test/a.pdf?v=1'
    expect(await view.show(uri, 1, 448)).toBe(true)
    expect(view.probe().phase).toBe('error')
    expect(view.probe().errorReason).toBe('resource')
    expect(__pdfDocumentStoreStatsForTest(), '失败条目不得残留（rejected pending 会让该 URI 本会话永久打不开）').toEqual([])
    // 可重试：修复后第二次 acquire 未命中 store → 重新发起 fetch
    plan.pdfStatus = 200
    expect(await view.show(uri, 1, 448)).toBe(true)
    const probe = view.probe()
    expect(probe.phase).toBe('content')
    expect(probe.totalPages).toBe(3)
    expect(
      state.fetchImpl.mock.calls.filter(([u]) => u === uri),
      'PDF 源 fetch 恰两次（失败 + 重试，不命中旧 rejection）',
    ).toHaveLength(2)
  })

  it('装载 Promise 未决时 dispose：迟到完成后引用释放、loadingTask 显式 destroy（D-2②）', async () => {
    mockViewport()
    let releaseDoc!: () => void
    const gate = new Promise<void>((resolve) => {
      releaseDoc = resolve
    })
    const state = installFakePdfjs(() => gate.then(() => makeFakeDoc(2)))
    const view = new PdfHoverView(scrollEl)
    const pending = view.show('https://files.test/a.pdf?v=1', 1, 448)
    // 推进到 getDocument 已发起（task 就位——fetch 未挂起即刻完成）
    await pumpUntil(() => state.loaded === 1)
    view.dispose()
    // dispose 时 show 仍挂起在 acquire（docRefUri 未就位）：销毁由迟到完成
    // 后的取代守卫释放（不泄漏 worker——destroy 恰一次）
    expect(state.destroyed).toBe(0)
    releaseDoc()
    expect(await pending).toBe(false)
    expect(state.destroyed, '迟到 doc 由已 dispose 的 show 释放 → task.destroy').toBe(1)
    expect(__pdfDocumentStoreStatsForTest()).toEqual([])
  })

  it('fetch 阶段 refs 归零后装载完成：孤儿文档自毁（abandoned 分支，D-2③）', async () => {
    mockViewport()
    const plan: FakeFetchPlan = {}
    let releaseFetch!: () => void
    plan.pdfGate = new Promise<void>((resolve) => {
      releaseFetch = resolve
    })
    const state = installFakePdfjs(makeFakeDoc(2), plan)
    const view = new PdfHoverView(scrollEl)
    const pending = view.show('https://files.test/a.pdf?v=1', 1, 448)
    await pumpUntil(() => __pdfDocumentStoreStatsForTest().length === 1)
    view.dispose() // fetch 未决：task 未就位 → 条目标记 abandoned（不销毁）
    expect(state.destroyed).toBe(0)
    releaseFetch() // fetch 完成 → getDocument → doc resolve → abandoned 自毁
    await pumpUntil(() => state.destroyed === 1)
    expect(await pending).toBe(false)
    expect(__pdfDocumentStoreStatsForTest()).toEqual([])
  })

  it('恢复语义（resume）：记忆页越新文档界 → 钳制到新末页而非报错（E-2 重挂/删除恢复链）', async () => {
    mockViewport()
    let loadCount = 0
    installFakePdfjs(() => {
      loadCount++
      return Promise.resolve(loadCount === 1 ? makeFakeDoc(3) : makeFakeDoc(2))
    })
    const view = new PdfHoverView(scrollEl)
    cleanupFns.push(() => view.dispose())
    // resume：记忆页 10、3 页文档 → 定位第 3 页（不报错）
    expect(await view.show('https://files.test/a.pdf?v=1', 10, 448, true)).toBe(true)
    let probe = view.probe()
    expect(probe.phase).toBe('content')
    expect(probe.page).toBe(3)
    expect(probe.totalPages).toBe(3)
    expect(probe.requestedPage).toBe(10)
    // 换更短文档（?v=2，2 页）：视图记忆（restorePage）与 resume 双路径均钳制
    expect(await view.show('https://files.test/a.pdf?v=2', 10, 448, true)).toBe(true)
    probe = view.probe()
    expect(probe.phase).toBe('content')
    expect(probe.page).toBe(2)
    expect(probe.totalPages).toBe(2)
    // 非 resume（双链初始页）保持初次非法就地报错（#337 契约）——新视图验证
    const fresh = new PdfHoverView(scrollEl)
    cleanupFns.push(() => fresh.dispose())
    expect(await fresh.show('https://files.test/a.pdf?v=9', 9, 448)).toBe(true)
    const errProbe = fresh.probe()
    expect(errProbe.phase).toBe('error')
    expect(errProbe.errorReason).toBe('page-range')
  })

  it('翻页失败路径：目标页渲染失败 → error 分态且乐观页码清零（失败态诚实显示，波次二·失败页码语义）', async () => {
    mockViewport()
    // 末页（第 6 页）getPage 抛错——不在初始窗口（首窗 1~2），翻到第 5 页
    //（窗口 4~6）时才入窗失败
    const doc: FakeDoc = {
      numPages: 6,
      getPage: (n: number) => {
        if (n === 6) throw new Error('page missing')
        return makeFakePage()
      },
    }
    installFakePdfjs(doc)
    const view = new PdfHoverView(scrollEl)
    cleanupFns.push(() => view.dispose())
    expect(await view.show('https://files.test/a.pdf?v=1', 1, 448)).toBe(true)
    expect(view.probe().phase).toBe('content')
    expect(view.probe().page).toBe(1)
    // 乐观推进返回 true；第 6 页入窗渲染失败 → resource 分态，页码不残留
    for (let i = 0; i < 4; i++) {
      expect(view.turnPage(1, 448)).toBe(true)
    }
    expect(view.probe().page).toBe(5)
    await pumpUntil(() => view.probe().phase === 'error')
    const probe = view.probe()
    expect(probe.errorReason).toBe('resource')
    expect(probe.page, 'error 态 probe 不得残留乐观页码').toBe(0)
  })

  it('上方位移补偿：视口下方页的实测回填平移 scrollTop（视口内容稳定，E-4）', async () => {
    mockViewport()
    // 第 3 页为双倍高长页（首窗 1~2 不触及——装载期按默认纵横比估计，
    // 入窗渲染时回填为实测双倍高）
    installFakePdfjs(makeFakeDoc(6, { 3: makeFakePage(612, 1584) }))
    const view = new PdfHoverView(scrollEl)
    cleanupFns.push(() => view.dispose())
    await view.show('https://files.test/a.pdf?v=1', 1, 448)
    const estimated = view.probe().scrollHeight
    const perPage = estimated / 6
    // 滚到第 4 页顶 = 第 3 页旧底边界（窗口 2~4 → 第 3 页入窗渲染回填）
    scrollTo(Math.round(3 * perPage))
    await pumpUntil(() => view.probe().page === 4)
    // 补偿：第 3 页高度 580 → ~1159，视口顶恰在旧底 → 平移至新底（第 4 页
    // 顶）。不补偿则 scrollTop 落进拉长后的第 3 页内，观感跳回上一页
    await pumpUntil(() => view.probe().scrollTop >= Math.round(2 * perPage) + Math.round(perPage) + 500)
    const probe = view.probe()
    expect(probe.page, '补偿后视口内容仍在第 4 页顶（不跳回第 3 页）').toBe(4)
    expect(probe.scrollTop).toBeGreaterThanOrEqual(Math.round(2 * perPage) + Math.round(perPage) + 500)
    // 全文高度按实测修正（第 3 页从估计 ~580 修正到 ~1159）
    expect(probe.scrollHeight).toBeGreaterThan(estimated + 500)
  })
})

// ---- #339（P3-07）：适合宽度、用户缩放、文本层与链接 ----
// 契约：默认适合容器宽（zoom=1）；用户缩放乘子作用于宽度适配 scale，总
// scale 受 PDF_RENDER_MAX_SCALE 上限钳制（触顶后放大无效不受理）；缩放
// 与容器宽度变化全量重算高度模型并**重绘已挂载页**（旧画布/文本层/链接
// 层一并回收——不留旧 scale 残影）；费用受画布预算收窄。文本层挂 pdfjs
// TextLayer（容器 --total-scale-factor 与绘制 scale 同源；扫描页无 span
// 不虚构）。链接层消费 getAnnotations：http(s) 外链回调宿主通道、内部
// GoTo/dest 就地翻页、其余动作明确禁用（无 href——不可导航面）。
describe('PDF 适合宽度与用户缩放（#339）', () => {
  let scrollEl: HTMLElement
  let cleanupFns: Array<() => void> = []

  function mockViewport(): void {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset['pdfScrollPort'] === '1' ? 400 : 0
    })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset['pdfScrollPort'] === '1' ? 448 : 0
    })
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

  it('默认适合容器宽：zoom=1，绘制尺寸 = 容器内容宽（448 → 612×0.732）', async () => {
    mockViewport()
    installFakePdfjs(makeFakeDoc(3))
    const view = new PdfHoverView(scrollEl)
    cleanupFns.push(() => view.dispose())
    await view.show('https://files.test/a.pdf?v=1', 1, 448)
    const probe = view.probe()
    expect(probe.zoom).toBe(1)
    // 浮点口径：448/612 × 612 = 447.999… → floor 447（真实 pdfjs 同算式同结果）
    expect(probe.canvasWidth).toBe(Math.floor(612 * (448 / 612)))
  })

  it('放大：zoom 乘子推进且绘制尺寸按新 scale 重绘（挂载页不残留旧画布）', async () => {
    mockViewport()
    installFakePdfjs(makeFakeDoc(3))
    const view = new PdfHoverView(scrollEl)
    cleanupFns.push(() => view.dispose())
    await view.show('https://files.test/a.pdf?v=1', 1, 448)
    const before = view.probe().canvasWidth
    expect(view.zoomBy(1.25)).toBe(true)
    expect(view.probe().zoom).toBeCloseTo(1.25, 5)
    // 重绘完成：canvas 宽 = floor(612 × 448/612 × 1.25) = 560
    await pumpUntil(() => view.probe().canvasWidth === 560)
    expect(view.probe().canvasWidth).toBe(560)
    expect(view.probe().canvasWidth).toBeGreaterThan(before)
    // 画布唯一（旧画布回收，不叠画布）
    expect(scrollEl.querySelectorAll('canvas').length).toBe(view.probe().mountedPages)
  })

  it('缩小与适合宽度复位：复位回宽度适配（zoom=1），已复位再复位为无效', async () => {
    mockViewport()
    installFakePdfjs(makeFakeDoc(3))
    const view = new PdfHoverView(scrollEl)
    cleanupFns.push(() => view.dispose())
    await view.show('https://files.test/a.pdf?v=1', 1, 448)
    expect(view.zoomBy(1 / 1.25)).toBe(true)
    expect(view.probe().zoom).toBeLessThan(1)
    expect(view.resetZoom()).toBe(true)
    const fitW = Math.floor(612 * (448 / 612))
    await pumpUntil(() => view.probe().canvasWidth === fitW)
    expect(view.probe().zoom).toBe(1)
    expect(view.probe().canvasWidth).toBe(fitW)
    expect(view.resetZoom(), '已复位再复位无效').toBe(false)
  })

  it('上限语义：宽度适配已触 PDF_RENDER_MAX_SCALE 时放大不受理（zoom 不变）', async () => {
    mockViewport()
    installFakePdfjs(makeFakeDoc(3))
    const view = new PdfHoverView(scrollEl)
    cleanupFns.push(() => view.dispose())
    // renderWidth 3000 → fit 4.9 被钳到 2.5：放大不改变可见页有效 scale
    await view.show('https://files.test/a.pdf?v=1', 1, 3000)
    const probe = view.probe()
    expect(probe.canvasWidth).toBe(Math.floor(612 * 2.5))
    expect(view.zoomBy(1.25), '已触顶：放大无效').toBe(false)
    expect(view.probe().zoom).toBe(1)
  })

  it('逐步放大至上限：有效 scale 恰达 2.5 后继续放大无效', async () => {
    mockViewport()
    installFakePdfjs(makeFakeDoc(3))
    const view = new PdfHoverView(scrollEl)
    cleanupFns.push(() => view.dispose())
    await view.show('https://files.test/a.pdf?v=1', 1, 448)
    // 448/612≈0.732；×1.25 六次 ≈ 2.79 > 2.5 —— 前几次生效，触顶后拒绝
    let applied = 0
    for (let i = 0; i < 8; i++) {
      if (view.zoomBy(1.25)) applied++
      else break
    }
    expect(applied).toBeGreaterThan(3)
    await pumpUntil(() => view.probe().canvasWidth === Math.floor(612 * 2.5))
    expect(view.probe().canvasWidth).toBe(Math.floor(612 * 2.5))
    expect(view.zoomBy(1.25), '触顶后继续放大无效').toBe(false)
  })

  it('预算联动：放大后窗口挂载受画布预算收窄（canvasBytes ≤ 预算）', async () => {
    mockViewport()
    installFakePdfjs(makeFakeDoc(30))
    const view = new PdfHoverView(scrollEl)
    cleanupFns.push(() => view.dispose())
    await view.show('https://files.test/a.pdf?v=1', 1, 448)
    const before = view.probe().mountedPages
    for (let i = 0; i < 6; i++) view.zoomBy(1.25)
    await pumpUntil(() => view.probe().canvasWidth === Math.floor(612 * 2.5))
    const probe = view.probe()
    expect(probe.canvasBytes).toBeLessThanOrEqual(PDF_SCROLL_LIMITS.canvasBudgetBytes)
    expect(probe.mountedPages).toBeLessThanOrEqual(before)
    expect(probe.mountedPages).toBeGreaterThanOrEqual(1)
  })

  it('容器宽度变化：已挂载页按新宽度重绘（不留旧 scale 画布）', async () => {
    mockViewport()
    installFakePdfjs(makeFakeDoc(4))
    const view = new PdfHoverView(scrollEl)
    cleanupFns.push(() => view.dispose())
    await view.show('https://files.test/a.pdf?v=1', 1, 448)
    expect(view.probe().canvasWidth).toBe(Math.floor(612 * (448 / 612)))
    // turnPage 携带新宽度（既有 ResizeObserver 同款 setRenderWidth 路径）
    view.turnPage(1, 648)
    await pumpUntil(() => view.probe().canvasWidth === 648)
    const probe = view.probe()
    expect(probe.canvasWidth).toBe(648)
    // 重绘不叠画布：每页占位至多一枚 canvas（并发 2 下第三页可能仍在途）
    const perSlot = [...scrollEl.querySelectorAll('.vsidian-hover-pdf-page')]
    for (const slotEl of perSlot) {
      expect(slotEl.querySelectorAll('canvas').length).toBeLessThanOrEqual(1)
    }
    expect(scrollEl.querySelectorAll('canvas').length).toBeLessThanOrEqual(probe.mountedPages)
  })

  it('守卫：无内容（未装载）时缩放操作无效', async () => {
    mockViewport()
    installFakePdfjs(makeFakeDoc(2))
    const view = new PdfHoverView(scrollEl)
    cleanupFns.push(() => view.dispose())
    expect(view.zoomBy(1.25)).toBe(false)
    expect(view.resetZoom()).toBe(false)
  })

  it('缩放取消在途渲染：被取消的旧协程迟到完成不换入半成品画布', async () => {
    mockViewport()
    // 页 2 render 挂起且可控（记录每次调用的 resolve——旧协程与重新入队
    // 后的新协程各自一枚 task）；cancel 走真实 pdfjs 语义：以
    // RenderingCancelledException reject（渲染器 catch 吞掉后继续到达
    // 换入守卫——正是半成品画布可能漏换入的路径）
    const page2Tasks: Array<{ resolve: () => void }> = []
    const hangingPage2 = {
      getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }),
      render: () => {
        let resolveOuter!: () => void
        let rejectOuter!: (err: Error) => void
        const task = {
          promise: new Promise<void>((resolve, reject) => {
            resolveOuter = resolve
            rejectOuter = reject
          }),
          cancel: () => {
            const err = new Error('cancelled')
            err.name = 'RenderingCancelledException'
            task.promise.catch(() => {})
            rejectOuter(err)
          },
        }
        page2Tasks.push({ resolve: resolveOuter })
        return task
      },
    }
    installFakePdfjs(makeFakeDoc(4, { 2: hangingPage2 as unknown as ReturnType<typeof makeFakePage> }))
    const view = new PdfHoverView(scrollEl)
    cleanupFns.push(() => view.dispose())
    await view.show('https://files.test/a.pdf?v=1', 1, 448)
    // 窗口 [1,2] 并发在途：页 1 即完成（content 态），页 2 挂起
    await pumpUntil(() => page2Tasks.length === 1)
    // 触发缩放：cancel 页 2 在途任务并把挂载页全部重新入队
    expect(view.zoomBy(1.25)).toBe(true)
    await pumpUntil(() => page2Tasks.length === 2)
    await pumpUntil(() => view.probe().canvasWidth === 560)
    // 此刻被取消的旧协程必然已跑完换入守卫（其 continuation 排队早于
    // 新协程的 render 调用）：旧 scale 半成品画布（宽 447）不得出现在
    // 窗口内——在场只允许页 1 的新 scale 画布（560）
    const widths = [...scrollEl.querySelectorAll('canvas')].map((c) => c.width)
    expect(widths, '被取消协程的半成品画布不得换入').toEqual([560])
    // 新协程完成：页 2 以新 scale 落地
    page2Tasks[1]!.resolve()
    await pumpUntil(() => scrollEl.querySelectorAll('canvas').length === 2)
    const finalWidths = [...scrollEl.querySelectorAll('canvas')].map((c) => c.width)
    expect(finalWidths).toEqual([560, 560])
  })
})

describe('PDF 文本层（#339）', () => {
  let scrollEl: HTMLElement
  let cleanupFns: Array<() => void> = []

  function mockViewport(): void {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset['pdfScrollPort'] === '1' ? 400 : 0
    })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset['pdfScrollPort'] === '1' ? 448 : 0
    })
  }

  beforeEach(() => {
    __setPdfAssetsForTest(ASSETS)
    ;(globalThis as unknown as { __vsidianPdfjs?: unknown }).__vsidianPdfjs = undefined
    FakeTextLayer.instances.length = 0
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

  const TEXT_ITEMS: FakeTextItem[] = [
    { str: 'The quick brown fox', transform: [24, 0, 0, 24, 100, 700], width: 260, height: 24, fontName: 'g1' },
    { str: '中文文本内容', transform: [24, 0, 0, 24, 100, 650], width: 144, height: 24, fontName: 'g2' },
  ]

  it('文本层挂载：有文本的页挂 .vsidian-hover-pdf-text 且 span 数 = 文本项数', async () => {
    mockViewport()
    const page1 = makeFakeTextPage(612, 792, { textItems: TEXT_ITEMS })
    installFakePdfjs(makeFakeDoc(2, { 1: page1 as unknown as ReturnType<typeof makeFakePage> }))
    const view = new PdfHoverView(scrollEl)
    cleanupFns.push(() => view.dispose())
    await view.show('https://files.test/a.pdf?v=1', 1, 448)
    await pumpUntil(() => scrollEl.querySelectorAll('.vsidian-hover-pdf-text span').length >= 2)
    const layer = scrollEl.querySelector<HTMLElement>('.vsidian-hover-pdf-page[data-page="1"] .vsidian-hover-pdf-text')
    expect(layer).not.toBeNull()
    expect(layer!.querySelectorAll('span')).toHaveLength(2)
    expect(layer!.textContent).toContain('The quick brown fox')
    expect(layer!.textContent).toContain('中文文本内容')
    // 对齐契约：--total-scale-factor 与绘制 scale 同源（448/612）
    expect(layer!.style.getPropertyValue('--total-scale-factor')).toBe(String(448 / 612))
    await pumpUntil(() => view.probe().textLayerPages >= 1)
    expect(view.probe().textLayerPages).toBe(1)
  })

  it('扫描页不虚构：无文本项的页不产生 span，probe 不计入', async () => {
    mockViewport()
    const scanned = makeFakeTextPage(612, 792, { textItems: [] })
    installFakePdfjs(makeFakeDoc(2, { 1: scanned as unknown as ReturnType<typeof makeFakePage> }))
    const view = new PdfHoverView(scrollEl)
    cleanupFns.push(() => view.dispose())
    await view.show('https://files.test/a.pdf?v=1', 1, 448)
    await pumpUntil(() => view.probe().phase === 'content')
    await new Promise((r) => setTimeout(r, 0))
    expect(view.probe().textLayerPages, '无 span 的页不计入文本层观测').toBe(0)
  })

  it('缩放重建：zoom 后文本层按新 scale 重建（--total-scale-factor 更新）', async () => {
    mockViewport()
    const page1 = makeFakeTextPage(612, 792, { textItems: TEXT_ITEMS })
    installFakePdfjs(makeFakeDoc(2, { 1: page1 as unknown as ReturnType<typeof makeFakePage> }))
    const view = new PdfHoverView(scrollEl)
    cleanupFns.push(() => view.dispose())
    await view.show('https://files.test/a.pdf?v=1', 1, 448)
    await pumpUntil(() => view.probe().textLayerPages >= 1)
    view.zoomBy(1.25)
    await pumpUntil(() => {
      const layer = scrollEl.querySelector<HTMLElement>('.vsidian-hover-pdf-page[data-page="1"] .vsidian-hover-pdf-text')
      return layer !== null && layer.style.getPropertyValue('--total-scale-factor') === String((448 / 612) * 1.25)
    })
    const layer = scrollEl.querySelector<HTMLElement>('.vsidian-hover-pdf-page[data-page="1"] .vsidian-hover-pdf-text')!
    expect(layer.querySelectorAll('span')).toHaveLength(2)
  })
})

describe('PDF 链接分类纯函数（#339）', () => {
  it('http(s) URL → external（url 由 pdfjs 预 absolutize）', () => {
    expect(classifyPdfLink({ url: 'https://example.com/doc' })).toEqual({ kind: 'external', url: 'https://example.com/doc' })
    expect(classifyPdfLink({ url: 'http://example.com/#page=2' })).toEqual({ kind: 'external', url: 'http://example.com/#page=2' })
  })

  it('非许可协议（ftp/mailto/tel/file/javascript）→ 禁用（protocol）', () => {
    expect(classifyPdfLink({ url: 'ftp://files.example.com/x' }).kind).toBe('unsupported')
    expect(classifyPdfLink({ url: 'mailto:a@b.c' }).kind).toBe('unsupported')
    expect(classifyPdfLink({ url: 'file:///etc/passwd' }).kind).toBe('unsupported')
    expect(classifyPdfLink({ url: 'javascript:alert(1)' }).kind).toBe('unsupported')
  })

  it('内部目标：dest 数组/字符串 → internal', () => {
    expect(classifyPdfLink({ dest: [2, { name: 'XYZ' }, 0, 720, null] })).toEqual({ kind: 'internal', dest: [2, { name: 'XYZ' }, 0, 720, null] })
    expect(classifyPdfLink({ dest: 'chapter1' })).toEqual({ kind: 'internal', dest: 'chapter1' })
  })

  it('具名动作 / 附件 / OCG / resetForm → 禁用（不执行）', () => {
    expect(classifyPdfLink({ action: 'Print' }).kind).toBe('unsupported')
    expect(classifyPdfLink({ action: 'FirstPage' }).kind).toBe('unsupported')
    expect(classifyPdfLink({ attachment: { filename: 'a.txt' } }).kind).toBe('unsupported')
    expect(classifyPdfLink({ setOCGState: { state: ['ON'] } }).kind).toBe('unsupported')
    expect(classifyPdfLink({ resetForm: {} }).kind).toBe('unsupported')
  })

  it('无 URL 无目标（JS 动作残留形态）→ 禁用（none）；unsafeUrl 不采信', () => {
    expect(classifyPdfLink({}).kind).toBe('unsupported')
    expect(classifyPdfLink({ unsafeUrl: 'file:///c:/x' }).kind).toBe('unsupported')
  })
})

describe('PDF 链接层交互（#339）', () => {
  let scrollEl: HTMLElement
  let cleanupFns: Array<() => void> = []
  let externalUrls: string[]

  function mockViewport(): void {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset['pdfScrollPort'] === '1' ? 400 : 0
    })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset['pdfScrollPort'] === '1' ? 448 : 0
    })
  }

  /** 页 1 挂五类链接：内部（页引用 dest → 第 2 页）/ https 外链 / ftp 禁用 /
   *  纯 JS 动作残留（无 url/dest）/ 未知命名目标 */
  function makeLinkPage() {
    return makeFakeTextPage(612, 792, {
      annotations: [
        { subtype: 'Link', rect: [100, 650, 300, 680], dest: [{ num: 1, gen: 0 }, { name: 'XYZ' }, 0, 700, null] },
        { subtype: 'Link', rect: [100, 600, 300, 630], url: 'https://example.com/pdf-link' },
        { subtype: 'Link', rect: [100, 550, 300, 580], url: 'ftp://files.example.com/x' },
        { subtype: 'Link', rect: [100, 500, 300, 530] },
        { subtype: 'Link', rect: [100, 450, 300, 480], dest: 'unknown-named-dest' },
      ],
    })
  }

  beforeEach(() => {
    __setPdfAssetsForTest(ASSETS)
    ;(globalThis as unknown as { __vsidianPdfjs?: unknown }).__vsidianPdfjs = undefined
    scrollEl = document.createElement('div')
    scrollEl.dataset['pdfScrollPort'] = '1'
    document.body.appendChild(scrollEl)
    externalUrls = []
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

  async function openDoc(doc: unknown): Promise<PdfHoverView> {
    mockViewport()
    installFakePdfjs(doc as FakeDoc)
    const view = new PdfHoverView(scrollEl, { onExternalUrl: (url) => externalUrls.push(url) })
    cleanupFns.push(() => view.dispose())
    await view.show('https://files.test/a.pdf?v=1', 1, 448)
    return view
  }

  function linkEls(): HTMLElement[] {
    return [...scrollEl.querySelectorAll<HTMLElement>('.vsidian-hover-pdf-link')]
  }

  it('链接元素挂载：每条 Link 注解一个定位元素，矩形按 viewport 变换落 CSS 位', async () => {
    const view = await openDoc(makeFakeDocWithDests(3, {}, { 1: makeLinkPage() as unknown as ReturnType<typeof makeFakePage> }))
    await pumpUntil(() => linkEls().length === 5)
    const els = linkEls()
    expect(els).toHaveLength(5)
    expect(view.probe().linkAnnotations).toBe(5)
    // 第一条（内部链接）矩形：PDF [100,650,300,680] × scale 448/612、y 翻转
    const scale = 448 / 612
    const first = els[0]!
    expect(first.style.left).toBe(`${100 * scale}px`)
    expect(Math.abs(Number.parseFloat(first.style.top) - (792 - 680) * scale)).toBeLessThan(0.01)
    expect(Math.abs(Number.parseFloat(first.style.width) - 200 * scale)).toBeLessThan(0.01)
    expect(Math.abs(Number.parseFloat(first.style.height) - 30 * scale)).toBeLessThan(0.01)
    // 全部无 href（不可导航面——点击全走自持处理器）
    for (const el of els) {
      expect(el.getAttribute('href')).toBeNull()
    }
  })

  it('内部链接点击：就地翻页到目标页（当前实例导航）', async () => {
    const view = await openDoc(makeFakeDocWithDests(3, {}, { 1: makeLinkPage() as unknown as ReturnType<typeof makeFakePage> }))
    await pumpUntil(() => linkEls().length === 5)
    linkEls()[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await pumpUntil(() => view.probe().page === 2)
    expect(view.probe().page).toBe(2)
    // 内部跳转零外链回调
    expect(externalUrls).toEqual([])
  })

  it('https 外链点击：经回调通道上报（显式点击才触发，浮层层内不导航）', async () => {
    await openDoc(makeFakeDocWithDests(3, {}, { 1: makeLinkPage() as unknown as ReturnType<typeof makeFakePage> }))
    await pumpUntil(() => linkEls().length === 5)
    linkEls()[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(externalUrls).toEqual(['https://example.com/pdf-link'])
  })

  it('禁用链接：ftp 协议 / JS 动作残留 / 不可解析目标——点击零动作且带禁用标记', async () => {
    const view = await openDoc(makeFakeDocWithDests(3, {}, { 1: makeLinkPage() as unknown as ReturnType<typeof makeFakePage> }))
    await pumpUntil(() => linkEls().length === 5)
    const els = linkEls()
    for (const idx of [2, 3, 4]) {
      expect(els[idx]!.classList.contains('vsidian-hover-pdf-link-disabled'), `链接 ${idx} 应为禁用态`).toBe(true)
      expect(els[idx]!.getAttribute('aria-disabled')).toBe('true')
    }
    for (const idx of [2, 3, 4]) {
      els[idx]!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    }
    expect(view.probe().page).toBe(1)
    expect(externalUrls).toEqual([])
  })

  it('命名目标解析：具名 dest 经文档目标表解析到页（doc.getDestination）', async () => {
    const page1 = makeFakeTextPage(612, 792, {
      annotations: [
        { subtype: 'Link', rect: [100, 650, 300, 680], dest: 'chapter-two' },
      ],
    })
    const view = await openDoc(makeFakeDocWithDests(
      4,
      { 'chapter-two': [{ num: 2, gen: 0 }, { name: 'XYZ' }, 0, 700, null] },
      { 1: page1 as unknown as ReturnType<typeof makeFakePage> },
    ))
    await pumpUntil(() => linkEls().length === 1)
    const el = linkEls()[0]!
    expect(el.classList.contains('vsidian-hover-pdf-link-disabled')).toBe(false)
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await pumpUntil(() => view.probe().page === 3)
    expect(view.probe().page).toBe(3)
  })

  it('离窗回收：链接元素随页槽卸载（DOM 不残留）', async () => {
    const view = await openDoc(makeFakeDocWithDests(3, {}, { 1: makeLinkPage() as unknown as ReturnType<typeof makeFakePage> }))
    await pumpUntil(() => linkEls().length === 5)
    expect(scrollEl.querySelector('.vsidian-hover-pdf-page[data-page="1"]')).not.toBeNull()
    view.turnPage(1, 448)
    view.turnPage(1, 448)
    await pumpUntil(() => view.probe().page === 3)
    expect(scrollEl.querySelector('.vsidian-hover-pdf-page[data-page="1"]')).toBeNull()
    expect(linkEls().filter((el) => el.closest('[data-page="1"]'))).toHaveLength(0)
  })
})

// ---- #344（P3-12 收口）：并发身份/补偿负向/重入 resume/失败清页 四钉 ----
// 历轮审查积累的缺口：① 同 URI 并发 acquire 的结果归属（早请求迟到不得
// 冒充新目标——E-2/D-2 家族补集：换目标期间旧装载完成的释放与自毁路径）；
// ② 视口补偿的负向边界（视口在回填页自身范围内不补偿——E-4 的补集）；
// ③ 同文档重入 + resume 的越界钳制（E-2 在 show 同文档复用分支的钉子）；
// ④ 装载失败后 setError 清页契约（probe.page === 0，失败态不残留旧页码）。
describe('PDF 渲染器收口钉（#344）', () => {
  let scrollEl: HTMLElement
  let cleanupFns: Array<() => void> = []

  function mockViewport(): void {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset['pdfScrollPort'] === '1' ? 400 : 0
    })
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.dataset['pdfScrollPort'] === '1' ? 448 : 0
    })
  }

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

  it('并发装载身份判定：换目标期间旧 acquire 完成 → 释放引用自毁，不冒充新目标', async () => {
    mockViewport()
    const uriA = 'https://files.test/a.pdf?v=1'
    const uriB = 'https://files.test/b.pdf?v=1'
    let releaseA!: () => void
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve
    })
    const state = installFakePdfjs(makeFakeDoc(3), {
      pdfGateFor: (url) => (url === uriA ? gateA : undefined),
    })
    const view = new PdfHoverView(scrollEl)
    cleanupFns.push(() => view.dispose())
    const first = view.show(uriA, 1, 448)
    // A 的装载挂在 fetch（条目在场、引用 1）
    await pumpUntil(() => __pdfDocumentStoreStatsForTest().some((e) => e.uri === uriA))
    // 换目标：show(B) 使 first 的 seq 过期并释放 A 引用（fetch 阶段归零 →
    // 条目标记 abandoned 并从 store 删除）
    const second = view.show(uriB, 1, 448)
    expect(await second).toBe(true)
    // A 的 fetch 此刻才完成：装载完成后按 abandoned 自毁（worker 不泄漏），
    // first 以 false 收敛——迟到的 A 文档不得落地冒充 B 的内容
    releaseA()
    expect(await first).toBe(false)
    await pumpUntil(() => state.destroyed === 1)
    const probe = view.probe()
    expect(probe.phase).toBe('content')
    expect(probe.totalPages).toBe(3)
    expect(view.probe().page).toBe(1)
    // store 只剩 B 的活跃引用；A 无残留条目
    const stats = __pdfDocumentStoreStatsForTest()
    expect(stats).toEqual([{ uri: uriB, refs: 1 }])
  })

  it('视口补偿负向边界：视口在回填页自身范围内不补偿（scrollTop 不变）', async () => {
    mockViewport()
    // 第 3 页为双倍高长页：估计装载后滚到该页中段（视口顶 < 该页旧底）
    installFakePdfjs(makeFakeDoc(6, { 3: makeFakePage(612, 1584) }))
    const view = new PdfHoverView(scrollEl)
    cleanupFns.push(() => view.dispose())
    await view.show('https://files.test/a.pdf?v=1', 1, 448)
    const estimated = view.probe().scrollHeight
    const perPage = estimated / 6
    // 滚到第 3 页中段（约 2.5 页偏移）：视口顶落在该页旧区间内部
    const midPage3 = Math.round(2.5 * perPage)
    scrollTo(midPage3)
    await pumpUntil(() => view.probe().page === 3)
    // 等第 3 页回填完成（全文高度按实测增长）
    await pumpUntil(() => view.probe().scrollHeight > estimated + 300)
    const probe = view.probe()
    expect(probe.page, '视口仍在第 3 页内（不跳页）').toBe(3)
    expect(probe.scrollTop, '页内视口不位移（补偿仅限视口在回填页下方的情形）').toBe(midPage3)
    expect(probe.scrollHeight).toBeGreaterThan(estimated + 300)
  })

  it('同文档重入 + resume：越界记忆页钳制而非报错（show 复用分支的 E-2 钉子）', async () => {
    mockViewport()
    installFakePdfjs(makeFakeDoc(3))
    const view = new PdfHoverView(scrollEl)
    cleanupFns.push(() => view.dispose())
    const uri = 'https://files.test/a.pdf?v=1'
    expect(await view.show(uri, 2, 448)).toBe(true)
    expect(view.probe().page).toBe(2)
    // 同 URI 重入（文档复用分支）携带 resume 与越界页 9：钳制到 3，content
    //（非 resume 的同分支越界仍就地报错——既有钉子见「无页码从第一页开始」）
    expect(await view.show(uri, 9, 448, true)).toBe(true)
    const probe = view.probe()
    expect(probe.phase).toBe('content')
    expect(probe.errorReason).toBe('')
    expect(probe.page).toBe(3)
    expect(probe.requestedPage).toBe(9)
    // 对照：同 URI 重入不带 resume 的越界 → page-range（分支语义分野钉住）
    expect(await view.show(uri, 9, 448)).toBe(true)
    const errProbe = view.probe()
    expect(errProbe.phase).toBe('error')
    expect(errProbe.errorReason).toBe('page-range')
  })

  it('装载失败清页契约：换目标 fetch 失败 → error 态 probe.page === 0（不残留旧文档页码）', async () => {
    mockViewport()
    let loadCount = 0
    const plan: FakeFetchPlan = {}
    installFakePdfjs(() => {
      loadCount++
      return Promise.resolve(makeFakeDoc(5))
    }, plan)
    const view = new PdfHoverView(scrollEl)
    cleanupFns.push(() => view.dispose())
    // 旧文档 5 页、浏览到第 4 页（页码在场）
    expect(await view.show('https://files.test/a.pdf?v=1', 4, 448)).toBe(true)
    expect(view.probe().page).toBe(4)
    // 换目标失败（B fetch 404）：setError 清页——失败态不残留旧文档页码
    plan.pdfStatus = 404
    expect(await view.show('https://files.test/b.pdf?v=1', 1, 448)).toBe(true)
    const probe = view.probe()
    expect(probe.phase).toBe('error')
    expect(probe.errorReason).toBe('resource')
    expect(probe.page, '失败态 probe.page 必须为 0（清页契约）').toBe(0)
    expect(probe.totalPages).toBe(0)
    // 恢复：修复后重开仍可装载（失败不留 rejected pending——E-1 既有语义）
    plan.pdfStatus = 200
    expect(await view.show('https://files.test/b.pdf?v=1', 1, 448)).toBe(true)
    expect(view.probe().phase).toBe('content')
  })
})
