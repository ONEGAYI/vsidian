// PDF 渲染器（#337 / P3-05 悬停首条闭环；#338 / P3-06 全文按页滚动与
// 正文嵌入）：本地 PDF 的只读阅读视图——按页 canvas 池 + spacer 虚拟化
//（全文模型与 DOM/canvas 常驻分开：滚动区用估计高度 spacer 撑开、真实
// 页高渲染后回填），翻页操作与滚动定位互通。装配结论全部来自 #334 探针
//（pdfjs-dist@6.4.299 legacy 主库 + legacy worker、blob 单文件 worker、
// asWebviewUri 资产目录 + 尾斜杠、6.x render() 以 {canvas, viewport} 为
// 主参、失败装载也持有 worker）。
//
// 资源装配（宿主 HTML 内联注入全局，mermaid 同款 URI 传递机制）：
// - `window.__vsidianPdfAssets`：pdfMain.js / pdfWorker.js 产物与
//   cmaps / standard_fonts / wasm / iccs 资产目录的 webview 资源 URI；
// - 主库懒加载：动态 <script> 装载 pdfMain.js（script-src cspSource 放行），
//   pdfjsLib 挂全局 `__vsidianPdfjs`；进程级单例 Promise；
// - worker：fetch 单文件产物文本（connect-src cspSource 放行）→ Blob →
//   objectURL → GlobalWorkerOptions.workerSrc（worker-src blob: 放行）；
//   blob URL 进程级单例常驻（装配资源，非每文档）；每文档 worker 随共享
//   文档存储的引用计数归零销毁。
//
// 文档数据共享（#338）：同 URI（含 `?v=` 代次戳）多视图共享一份
// PDFDocumentProxy（引用计数；最后一个消费者释放才 destroy——同目标多
// occurrence 共享文档数据，滚动/视口/生命周期各自独立）。URI 含版本戳，
// 文件替换后的新 URI 是新键——旧文档在旧引用归零后销毁，天然版本隔离。
//
// 生命周期纪律：
// - 渲染代次（renderSeq）守卫：重入 show / dispose 后的迟到结果不落地
//  （旧 canvas 不冒充新目标）；
// - getDocument reject 的 catch 里显式 task.destroy()（失败装载也持有
//   worker——#334 实测泄漏纪律）；
// - 离屏页：取消在途 renderTask、canvas 置零并移除（画布不常驻——费用
//   不随总页数线性增长）；
// - dispose：取消在途、释放共享文档引用、清空 DOM、移除监听。
//
// 错误分态（就地 i18n，不弹宿主通知）：
// - corrupt（InvalidPDF）／ encrypted（Password——首批提示在原应用打开，
//   不采集密码）／ page-range（页码越出总页数，不静默跳第一页——仅初次
//   定位；刷新重载的浏览位置合法钳制）／ resource（fetch 或渲染失败）／
//   load-failed（引擎产物装载失败）。
import { t } from '../shared/i18n'

/** 宿主注入的 PDF 装配资源 URI（buildWebviewHtml 内联全局
 *  `__vsidianPdfAssets`；测试环境可经 __setPdfAssetsForTest 注入替身） */
export interface PdfAssetsConfig {
  /** pdfMain.js 产物（懒加载入口） */
  mainJs: string
  /** pdfWorker.js 产物（blob 装配源文本） */
  workerJs: string
  cMapUrl: string
  fontUrl: string
  wasmUrl: string
  iccUrl: string
}

interface PdfjsGlobal {
  getDocument: (src: Record<string, unknown>) => { promise: Promise<PdfDocumentLike>; destroy(): Promise<void> }
  GlobalWorkerOptions: { workerSrc: string }
  version?: string
}

/** PDF.js 文档代理的最小消费面（页视口与渲染）。**不含销毁**：pdfjs 6.x
 * 的 PDFDocumentProxy 没有 destroy 方法（类型面实测——只有 cleanup 的
 * 内存整理，不终止 worker）；文档与 worker 的销毁正道是持有 loadingTask
 * 调 task.destroy()（#334 探针结论，由共享存储的 entry.task 承担） */
interface PdfDocumentLike {
  numPages: number
  getPage(pageNumber: number): Promise<PdfPageLike>
}

interface PdfPageLike {
  getViewport(params: { scale: number }): { width: number; height: number }
  render(params: { canvas: HTMLCanvasElement; viewport: { width: number; height: number } }): { promise: Promise<void>; cancel(): void }
}

/** 渲染错误分态（i18n 键的选取依据；page-range 附页码与总页数） */
export type PdfRenderErrorReason = 'corrupt' | 'encrypted' | 'page-range' | 'resource' | 'load-failed'

/**
 * 全文按页滚动的费用参数（#338 集中定义——「资源与兼容性验收」的参数
 * 集中原则；初值依据 #334 探针）：
 * - canvasBudgetBytes：单视图窗口内 canvas 像素总预算（w×h×4 累计）。
 *   #334 探针实测 US Letter 页（612×792 pt）scale 1.5 约 4.31 MiB/页、
 *   scale 2 约 7.64 MiB/页，线性外推 scale 2.5（渲染上限）约 11.9
 *   MiB/页；40 MiB ≈ 全尺度 3.4 页或 scale 1.5 下约 9 页——预算先于
 *   maxMountedPages 收窄时保底可见页本身；
 * - maxMountedPages：单视图同时挂载页数硬上限（宽矮视口多页可见时
 *   兜底；正常竖版视口由预算与窗口自然约束）；
 * - windowPadPages：可见页外每侧预挂页数（滚动连续性预渲染）；
 * - renderConcurrency：单视图同时在途 renderTask 上限（大页串行化，
 *   避免滚动风暴下的绘制排队）。
 */
export const PDF_SCROLL_LIMITS = {
  canvasBudgetBytes: 40 * 1024 * 1024,
  maxMountedPages: 8,
  windowPadPages: 1,
  renderConcurrency: 2,
} as const

/** 渲染 scale 上限（宽度适配的放大封顶——探针实测 scale 2 约 7.6 MiB/页，
 *  上限 2.5 控制单页 canvas 费用；P3-07 缩放接入后再放开用户控制） */
const PDF_RENDER_MAX_SCALE = 2.5

/** 未知页的尺寸估计基准（PDF 默认用户单位——US Letter 纵向） */
const PDF_ESTIMATED_PAGE_WIDTH = 612
const PDF_ESTIMATED_PAGE_HEIGHT = 792

/** 渲染器观测面（hoverPopupProbe 的 pdf 字段与嵌入卡 probe 的数据源；
 *  集成/浏览器测试断言）。nonWhiteRatio 为当前可见页 canvas 实际像素采样
 *  （绘制层证据——集成断言落像素而非 DOM 存在性；非 content 态为 -1）；
 *  mountedPages/canvasBytes/scrollHeight/scrollTop 为 #338 全文滚动观测
 *  （画布常驻与费用不随总页数线性增长的断言载体）。 */
export interface PdfRenderProbe {
  phase: 'idle' | 'loading' | 'content' | 'error'
  page: number
  totalPages: number
  canvasWidth: number
  canvasHeight: number
  errorReason: PdfRenderErrorReason | ''
  requestedPage: number
  nonWhiteRatio: number
  /** 当前挂载画布的页数（窗口内；有界——不随总页数增长） */
  mountedPages: number
  /** 窗口内 canvas 像素总费用（w×h×4 累计；预算收窄对常规视口收敛为
   *  ≤ canvasBudgetBytes——但 computeWindow 以保底可见页优先，极宽视口
   *  无上位让位页时可超预算，E-6 口径：预算是收敛目标而非硬上限） */
  canvasBytes: number
  /** 全文内容高度（spacer 撑开的估计+实测总高；px） */
  scrollHeight: number
  /** 当前滚动位置（px；翻页定位与滚动互通的观测） */
  scrollTop: number
}

/** 悬停 PDF 容器的稳定类名（样式契约 chrome 域 hover-pdf-view 条目同源登记） */
export const HOVER_PDF_CLASS_NAMES = {
  /** PDF 内容容器（挂滚动区内，与 Reading 容器并列——浮层与嵌入卡同款） */
  root: 'vsidian-hover-pdf',
  /** 撑开全文高度的 spacer（窗口前/后；页高度模型的 DOM 表达） */
  spacer: 'vsidian-hover-pdf-spacer',
  /** 窗口内页占位（高度 = 页渲染高；窗口内含画布） */
  page: 'vsidian-hover-pdf-page',
  /** 页面画布 */
  canvas: 'vsidian-hover-pdf-canvas',
  /** 页码信息行（当前可见页——sticky 固定于滚动区底部） */
  pageInfo: 'vsidian-hover-pdf-page-info',
} as const

function readAssetsGlobal(): PdfAssetsConfig | null {
  const g = globalThis as { __vsidianPdfAssets?: unknown }
  if (typeof g.__vsidianPdfAssets !== 'object' || g.__vsidianPdfAssets === null) {
    return null
  }
  const raw = g.__vsidianPdfAssets as Record<string, unknown>
  const keys = ['mainJs', 'workerJs', 'cMapUrl', 'fontUrl', 'wasmUrl', 'iccUrl'] as const
  const out: Record<string, string> = {}
  for (const key of keys) {
    if (typeof raw[key] !== 'string' || (raw[key] as string) === '') {
      return null
    }
    out[key] = raw[key] as string
  }
  return out as unknown as PdfAssetsConfig
}

/** 测试注入：替换宿主内联全局的装配资源（生产不调用） */
export function __setPdfAssetsForTest(assets: PdfAssetsConfig | null): void {
  ;(globalThis as { __vsidianPdfAssets?: unknown }).__vsidianPdfAssets = assets
}

/** 测试隔离：清空懒装载与 worker blob 的模块级单例（生产不调用——单例
 *  常驻是装配资源的进程级共享语义，跨用例替身需重置；store 条目一并清空，
 *  残余等待者由各自的 seq 守卫与 catch 收敛，测试替身无真实 worker） */
export function __resetPdfjsSingletonsForTest(): void {
  pdfjsLoad = null
  workerBlobUrl = null
  documentStore.clear()
}

/** 测试观测：共享文档存储快照（refs 断言——共享与回收纪律） */
export function __pdfDocumentStoreStatsForTest(): Array<{ uri: string; refs: number }> {
  return [...documentStore.entries()].map(([uri, entry]) => ({ uri, refs: entry.refs }))
}

let pdfjsLoad: Promise<PdfjsGlobal> | null = null

/** 懒装载 PDF.js 主库（动态 <script>，进程级单例；重复调用共享同一 Promise） */
function ensurePdfjs(assets: PdfAssetsConfig): Promise<PdfjsGlobal> {
  if (pdfjsLoad === null) {
    pdfjsLoad = new Promise<PdfjsGlobal>((resolve, reject) => {
      const existing = (globalThis as { __vsidianPdfjs?: unknown }).__vsidianPdfjs
      if (typeof existing === 'object' && existing !== null) {
        resolve(existing as PdfjsGlobal)
        return
      }
      const script = document.createElement('script')
      script.src = assets.mainJs
      script.onload = () => {
        const lib = (globalThis as { __vsidianPdfjs?: unknown }).__vsidianPdfjs
        if (typeof lib === 'object' && lib !== null) {
          resolve(lib as PdfjsGlobal)
        } else {
          // 装载成功但全局缺失（产物异常）：与 onerror 同款重置单例——
          // 失败可重试，下次调用重新装载（D-1 半边不可重试修复）
          pdfjsLoad = null
          reject(new Error('pdfjs global missing after load'))
        }
      }
      script.onerror = () => {
        pdfjsLoad = null // 失败可重试（下次悬停重新装载）
        reject(new Error('pdfMain.js load failed'))
      }
      document.head.appendChild(script)
    })
  }
  return pdfjsLoad
}

let workerBlobUrl: string | null = null

/** worker 单文件产物的 Blob URL（fetch 文本 → Blob → objectURL；进程级单例） */
async function ensureWorkerBlobUrl(assets: PdfAssetsConfig): Promise<string> {
  if (workerBlobUrl !== null) {
    return workerBlobUrl
  }
  const res = await fetch(assets.workerJs)
  if (!res.ok) {
    throw new Error(`worker fetch failed: ${res.status}`)
  }
  const blob = new Blob([await res.text()], { type: 'text/javascript' })
  workerBlobUrl = URL.createObjectURL(blob)
  return workerBlobUrl
}

// ---- 共享文档存储（#338）：同 URI 多视图共享一份 PDFDocumentProxy ----

interface PdfStoreEntry {
  doc: PdfDocumentLike | null
  /** 装载中（首个消费者发起，后来者共享同一 Promise）；装载完成置 null */
  pending: Promise<PdfDocumentLike> | null
  /** loadingTask（getDocument 返回值）：常驻持有——refs 归零的销毁正道
   *  （pdfjs 6.x 的 PDFDocumentProxy 无 destroy；task.destroy 终止文档
   *  与 worker，幂等）。装载发起后即赋值，随条目存活 */
  task: { destroy(): Promise<void> } | null
  refs: number
  /** fetch 阶段 refs 已归零（task 未就位）：装载完成时自毁（防孤儿文档） */
  abandoned: boolean
}

const documentStore = new Map<string, PdfStoreEntry>()

/** PDF.js 拒绝值的错误名（ InvalidPDF / Password 等以 err.name 分态） */
function pdfErrorName(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'name' in err) {
    return String((err as { name: unknown }).name)
  }
  return ''
}

function classifyLoadError(err: unknown): PdfRenderErrorReason {
  if (pdfErrorName(err) === 'PasswordException') {
    return 'encrypted'
  }
  if (pdfErrorName(err) === 'InvalidPDFException') {
    return 'corrupt'
  }
  return 'resource'
}

/**
 * 获取共享文档（引用计数 +1）：命中直接复用（同 URI 多 occurrence 共享
 * 文档数据与 worker）；未命中发起装载（fetch 源字节 + getDocument）。
 * 装载失败：显式 task.destroy()（#334 泄漏纪律——失败装载也持有 worker）、
 * 移除条目、等待者统一按错误分态收敛。调用方必须在自己失效时调用
 * pdfReleaseDocument 配对（dispose / 换目标）。
 */
async function pdfAcquireDocument(uri: string, assets: PdfAssetsConfig, lib: PdfjsGlobal): Promise<PdfDocumentLike> {
  const hit = documentStore.get(uri)
  if (hit !== undefined) {
    hit.refs++
    if (hit.pending !== null) return hit.pending
    return hit.doc!
  }
  const entry: PdfStoreEntry = { doc: null, pending: null, task: null, refs: 1, abandoned: false }
  documentStore.set(uri, entry)
  entry.pending = (async () => {
    try {
      const res = await fetch(uri)
      if (!res.ok) {
        throw Object.assign(new Error(`pdf fetch failed: ${res.status}`), { name: 'PdfFetchError' })
      }
      // data 的底层 buffer 会被 transfer 给 worker（#334 实测）——先取快照
      const data = new Uint8Array(await res.arrayBuffer())
      const task = lib.getDocument({
        data,
        cMapUrl: withTrailingSlash(assets.cMapUrl),
        cMapPacked: true,
        standardFontDataUrl: withTrailingSlash(assets.fontUrl),
        wasmUrl: withTrailingSlash(assets.wasmUrl),
        iccUrl: withTrailingSlash(assets.iccUrl),
      })
      entry.task = task
      try {
        const doc = await task.promise
        entry.doc = doc
        entry.pending = null
        if (entry.abandoned) {
          // fetch 阶段所有等待者已放弃（release 时 task 尚未就位）：自毁，
          // 不让孤儿文档与 worker 存活（残余等待者的 seq 守卫丢弃迟到结果）
          void task.destroy().catch(() => {})
          throw Object.assign(new Error('pdf store entry abandoned'), { name: 'PdfAbandonedError' })
        }
        return doc
      } catch (err) {
        // 失败装载也持有 worker——必须显式 destroy（#334 泄漏纪律）
        try {
          await task.destroy()
        } catch {
          // 已销毁（迟到 destroy 双保险）
        }
        throw err
      }
    } catch (err) {
      // 装载失败（fetch/解析/getDocument/装载 reject）移除本条目——不残留
      // rejected pending（否则该 URI 本会话一切 acquire 命中旧条目直接拿
      // rejection，永久不可重开）；按条目身份删除，并发下新建的同 URI 条目
      // 不误伤。fetch 阶段 task 未创建无需 destroy（task 阶段的 destroy 已
      // 在上分支按持有处理）。删除后下次 acquire 未命中 → 重新发起装载
      //（一次瞬时失败可重试，E-1 修复语义）
      if (documentStore.get(uri) === entry) {
        documentStore.delete(uri)
      }
      throw err
    }
  })()
  return entry.pending
}

/** 释放共享文档引用（计数归零销毁文档与 worker；store 条目移除）。
 *  销毁走 loadingTask.destroy()（终止文档与 worker——pdfjs 6.x 的
 *  PDFDocumentProxy 无 destroy 方法，task 是唯一正道，#334 结论） */
function pdfReleaseDocument(uri: string): void {
  const entry = documentStore.get(uri)
  if (entry === undefined) {
    return
  }
  entry.refs--
  if (entry.refs > 0) {
    return
  }
  documentStore.delete(uri)
  if (entry.task !== null) {
    // 成功装载后的常驻 task：destroy 终止文档与 worker；装载中放弃同路径
    // 取消在途（destroy 幂等——destroyed 标志，catch 兜底迟到销毁）
    void entry.task.destroy().catch(() => {})
  } else {
    // fetch 阶段归零（task 未就位）：标记放弃，装载完成时自毁
    entry.abandoned = true
  }
}

/** 窗口内一页的挂载状态 */
interface PdfPageSlot {
  pageNo: number
  el: HTMLDivElement
  canvas: HTMLCanvasElement | null
  /** 在途 renderTask（离窗/重入取消） */
  task: { cancel(): void; promise: Promise<void> } | null
  /** 尺寸（渲染像素——canvasBytes 计费与页高回填的观测） */
  width: number
  height: number
}

/**
 * PDF 只读阅读视图（浮层与嵌入卡片共用——容器只负责尺寸、挂载与焦点）：
 * 挂载进宿主滚动区（scrollEl），自持页塔（spacer + 窗口页占位）与按页
 * canvas 池。一个视图实例 = 一个 occurrence 的滚动/视口状态；同 URI 多
 * 视图经共享文档存储复用文档数据。
 *
 * show() 幂等重入：同 URI 重入只滚动定位（文档复用，不重复装载）；换
 * URI 先释放旧引用再装载新文档（当前浏览页合法钳制恢复——文件替换后
 * `?v=` 推进的新 URI 是新键，旧文档随旧引用归零销毁）。dispose() 后一
 * 切迟到结果不落地。
 */
export class PdfHoverView {
  private renderSeq = 0
  private disposed = false
  private phase: PdfRenderProbe['phase'] = 'idle'
  private page = 0
  private totalPages = 0
  private requestedPage = 0
  private errorReason: PdfRenderErrorReason | '' = ''
  private doc: PdfDocumentLike | null = null
  private docUri = ''
  /** 本视图持有的共享文档引用（dispose/换目标释放；store refs 的本视图份额） */
  private docRefUri = ''
  private renderWidth = 0
  /** 页尺寸表（PDF 用户单位；null = 未实测——按估计纵横比） */
  private pageDims: Array<{ w: number; h: number } | null> = []
  /** 各页渲染高缓存（px；renderWidth 或实测页高变化时重算） */
  private pageHeights: number[] = []
  /** 页顶偏移前缀和（pageHeights 的累积；offsets[i] = 第 i+1 页顶部） */
  private offsets: number[] = [0]
  /** 窗口内页槽（pageNo → slot；离窗移除并回收画布） */
  private readonly slots = new Map<number, PdfPageSlot>()
  /** 渲染队列（页序；并发上限 PDF_SCROLL_LIMITS.renderConcurrency） */
  private readonly renderQueue: number[] = []
  private rendering = 0
  /** 定位页渲染完成即 content（#337 语义延续：目标页真实呈现） */
  private contentPage = 0
  private readonly listeners: Array<() => void> = []
  private resizeObserver: ResizeObserver | null = null
  /** show 等待定位页渲染完成的 resolver（定位页完成/错误/取消时 flush） */
  private contentWaiter: (() => void) | null = null
  /** 内容容器（公开只读：浮层的尺寸观察挂此——canvas 绘制增高触发重定位） */
  readonly root: HTMLDivElement
  private readonly topSpacer: HTMLDivElement
  private readonly bottomSpacer: HTMLDivElement
  private readonly pagesEl: HTMLDivElement
  private readonly pageInfo: HTMLDivElement
  /** 宿主滚动区（root 的父级——窗口计算与滚动定位的目标） */
  private readonly scrollEl: HTMLElement
  /** 初始定位粘性页（#338）：初次装载定位页的画布渲染完成前，滚动漂移
   *  （挂载初期 display:none / 布局未定使 scrollTop 写入被钳回 0——
   *  ResizeObserver 回调携带 scrollTop=0 的窗口更新会把页码观感拉回第
   *  一页）不覆盖页码且每次窗口更新重申定位；画布就绪即解除（用户滚动
   *  /翻页接管）。0 = 无粘性 */
  private stickyPage = 0

  constructor(container: HTMLElement) {
    this.scrollEl = container
    this.root = document.createElement('div')
    this.root.className = HOVER_PDF_CLASS_NAMES.root
    this.topSpacer = document.createElement('div')
    this.topSpacer.className = `${HOVER_PDF_CLASS_NAMES.spacer} ${HOVER_PDF_CLASS_NAMES.spacer}-top`
    this.bottomSpacer = document.createElement('div')
    this.bottomSpacer.className = `${HOVER_PDF_CLASS_NAMES.spacer} ${HOVER_PDF_CLASS_NAMES.spacer}-bottom`
    this.pagesEl = document.createElement('div')
    this.pagesEl.className = `${HOVER_PDF_CLASS_NAMES.root}-pages`
    this.pageInfo = document.createElement('div')
    this.pageInfo.className = HOVER_PDF_CLASS_NAMES.pageInfo
    this.root.appendChild(this.topSpacer)
    this.root.appendChild(this.pagesEl)
    this.root.appendChild(this.bottomSpacer)
    this.root.appendChild(this.pageInfo)
    container.appendChild(this.root)
    this.listen(container, 'scroll', () => this.scheduleWindowUpdate())
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver((entries) => {
        if (this.disposed || entries.length === 0) return
        const rect = entries[entries.length - 1]!.contentRect
        const width = Math.floor(rect.width)
        if (width > 0 && Math.abs(width - 16 - this.renderWidth) > 2) {
          // 宽度变化：scale 全变——重算高度表并重渲染当前窗口
          this.setRenderWidth(width - 16)
        } else {
          this.scheduleWindowUpdate()
        }
      })
      this.resizeObserver.observe(container)
    }
  }

  private listen(el: HTMLElement, type: string, listener: () => void): void {
    el.addEventListener(type, listener, { passive: true })
    this.listeners.push(() => el.removeEventListener(type, listener))
  }

  /** 观测面（probe 数据源；canvas 尺寸为当前可见页的实际绘制面） */
  probe(): PdfRenderProbe {
    const slot = this.phase === 'content' ? this.slotOfVisiblePage() : null
    const canvas = slot?.canvas ?? null
    return {
      phase: this.phase,
      page: this.page,
      totalPages: this.totalPages,
      canvasWidth: canvas !== null ? canvas.width : 0,
      canvasHeight: canvas !== null ? canvas.height : 0,
      errorReason: this.errorReason,
      requestedPage: this.requestedPage,
      nonWhiteRatio: canvas !== null ? this.canvasNonWhiteRatio(canvas) : -1,
      mountedPages: this.slots.size,
      canvasBytes: [...this.slots.values()].reduce((sum, s) => sum + s.width * s.height * 4, 0),
      scrollHeight: this.totalHeight(),
      scrollTop: this.scrollEl.scrollTop,
    }
  }

  /** 当前可见页（占视口比例最大的页；无布局时退当前 page 标记） */
  private slotOfVisiblePage(): PdfPageSlot | null {
    const pageNo = this.page > 0 ? this.page : this.currentPageFromScroll()
    return pageNo > 0 ? this.slots.get(pageNo) ?? null : null
  }

  /** canvas 非白像素比例（绘制层采样；无 2d 上下文或采样不可用时 -1
   *  ——诚实边界：观测失败不构成渲染失败，probe 不得因环境缺 canvas 实
   *  现而抛错） */
  private canvasNonWhiteRatio(canvas: HTMLCanvasElement): number {
    if (canvas.width === 0 || canvas.height === 0) {
      return -1
    }
    try {
      const ctx = canvas.getContext('2d')
      if (ctx === null || typeof ctx.getImageData !== 'function') {
        return -1
      }
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let nonWhite = 0
      const total = canvas.width * canvas.height
      for (let i = 0; i < total; i++) {
        if (data[i * 4] < 245 || data[i * 4 + 1] < 245 || data[i * 4 + 2] < 245) {
          nonWhite++
        }
      }
      return nonWhite / total
    } catch {
      return -1
    }
  }

  get contentReady(): boolean {
    return this.phase === 'content'
  }

  /**
   * 呈现目标：装载 uri 指向的 PDF 并定位到 page（缺省第一页）。
   * 返回 false = 本次调用被后续重入/dispose 取代（迟到结果不落地）。
   * - 初次定位页越界 → page-range 分态（不静默跳第一页）；
   * - 换 URI 重载（文件替换 `?v=` 推进）→ 保留当前浏览页，越界合法钳制
   *  （已打开视图的刷新口径——与初次非法页码就地报错不冲突）；
   * - resume = true（记忆恢复链——重挂/删除恢复等视图页码已清零的场景，
   *  page 携带 entry 记忆页）→ 越界钳制到 [1, totalPages] 而非报错（E-2：
   *  恢复语义与同视图刷新钳制同一口径；双链初始页不传 resume，保持 #337
   *  初次非法就地报错契约）。
   */
  async show(uri: string, page: number | undefined, renderWidth: number, resume = false): Promise<boolean> {
    if (this.disposed) {
      return false
    }
    const assets = readAssetsGlobal()
    if (assets === null) {
      // 装配资源缺失（宿主未注入——旧宿主/测试替身缺失）：如实分态，
      // 不静默空白
      this.setError('load-failed')
      return true
    }
    const seq = ++this.renderSeq
    this.flushContentWaiter() // 被取代的旧 show 解除等待（其 seq 配对失败返回 false）
    const target = page ?? 1
    this.requestedPage = target
    this.renderWidth = renderWidth
    this.phase = 'loading'
    this.errorReason = ''
    let lib: PdfjsGlobal
    try {
      lib = await ensurePdfjs(assets)
      lib.GlobalWorkerOptions.workerSrc = await ensureWorkerBlobUrl(assets)
    } catch {
      if (seq !== this.renderSeq) return false
      this.setError('load-failed')
      return true
    }
    if (seq !== this.renderSeq || this.disposed) {
      return false
    }
    // 同文档重入：只滚动定位（文档复用——快速切换页码不重复装载）；resume
    // 记忆路径越界钳制（恢复语义），双链初始页保持就地报错
    if (this.doc !== null && this.docUri === uri) {
      const effective = resume && this.totalPages > 0
        ? Math.min(Math.max(1, target), this.totalPages)
        : target
      if (effective >= 1 && effective <= this.totalPages) {
        this.scrollToPage(effective)
      } else {
        this.setError('page-range')
      }
      return seq === this.renderSeq
    }
    // 换目标：刷新路径的浏览位置恢复（当前页合法钳制）
    const restorePage = this.phase === 'loading' && this.page > 0
      ? this.page
      : (this.totalPages > 0 ? this.page : 0)
    this.clearPages()
    this.releaseDocRef()
    const doc = await pdfAcquireDocument(uri, assets, lib).catch((err: unknown) => {
      if (seq !== this.renderSeq) return null
      this.setError(classifyLoadError(err))
      return null
    })
    if (seq !== this.renderSeq || this.disposed) {
      // 已被取代：释放刚获得的引用（不冒充新目标）
      if (doc !== null) pdfReleaseDocument(uri)
      return false
    }
    if (doc === null) {
      return true // 错误分态已就地呈现
    }
    this.doc = doc
    this.docUri = uri
    this.docRefUri = uri
    this.totalPages = doc.numPages
    // 高度模型：全量估计（真实页高在窗口渲染时回填）
    this.pageDims = new Array<{ w: number; h: number } | null>(this.totalPages).fill(null)
    this.recomputeHeights()
    // 初始定位：restore（刷新钳制）优先，否则初次 target（越界就地报错）；
    // resume（记忆恢复链）越界钳制而非报错（E-2）
    let initial = target
    if (restorePage > 0) {
      initial = Math.min(restorePage, this.totalPages)
    }
    if (resume) {
      initial = Math.min(Math.max(1, initial), this.totalPages)
    }
    if (initial < 1 || initial > this.totalPages) {
      this.setError('page-range')
      return true
    }
    this.buildTower()
    this.stickyPage = initial // 初始定位粘性（布局漂移守卫，画布就绪解除）
    this.scrollToPage(initial)
    this.contentPage = initial
    this.updateWindow()
    // 等定位页真实呈现（#337 语义延续：await show 即 content/错误分态就绪）
    await new Promise<void>((resolve) => {
      this.contentWaiter = resolve
    })
    this.contentWaiter = null
    return seq === this.renderSeq
  }

  /** 重算高度模型（renderWidth 或实测页高变化时；滚动路径只读缓存） */
  private recomputeHeights(): void {
    this.pageHeights = this.pageDims.map((dim) => this.renderHeightOf(dim))
    this.offsets = [0]
    let acc = 0
    for (const h of this.pageHeights) {
      acc += h
      this.offsets.push(acc)
    }
  }

  /** 页渲染高（px）：宽适配 scale × 页基础高（未实测按估计纵横比） */
  private renderHeightOf(dim: { w: number; h: number } | null): number {
    const baseW = dim?.w ?? PDF_ESTIMATED_PAGE_WIDTH
    const baseH = dim?.h ?? PDF_ESTIMATED_PAGE_HEIGHT
    const scale = this.scaleFor(baseW)
    return Math.round(baseH * scale)
  }

  private scaleFor(baseWidth: number): number {
    return Math.min(PDF_RENDER_MAX_SCALE, Math.max(0.1, this.renderWidth / baseWidth))
  }

  private totalHeight(): number {
    return this.offsets.length > 1 ? this.offsets[this.offsets.length - 1]! : 0
  }

  /** 建/重建页塔骨架（spacer + 窗口容器；页槽由 updateWindow 差分挂载） */
  private buildTower(): void {
    for (const slot of this.slots.values()) {
      this.cancelSlot(slot)
      slot.el.remove()
    }
    this.slots.clear()
    this.renderQueue.length = 0
  }

  /** 滚动到页顶（翻页操作与初始定位的统一落点；窗口更新即时生效） */
  private scrollToPage(pageNo: number): void {
    this.page = pageNo
    const top = this.offsets[pageNo - 1] ?? 0
    this.updatePageInfo()
    // 布局先行：写 scrollTop 前保证滚动区高度覆盖目标位置（浏览器把超出
    // scrollHeight 的写入钳到当前可滚范围——窗口页占位未建时总高不足）
    const need = top + Math.max(this.viewportHeight(), 1)
    if (this.scrollEl.scrollHeight < need) {
      this.bottomSpacer.style.height = `${need}px` // 临时代位（updateWindow 重算精确值）
    }
    this.scrollEl.scrollTop = top
    this.updateWindow()
    // 定位页已在窗且已绘成（同 URI 重入快速翻页）：show 无需等待
    if (this.slots.get(pageNo)?.canvas !== undefined && this.slots.get(pageNo)?.canvas !== null) {
      this.phase = 'content'
      this.errorReason = ''
      this.flushContentWaiter()
    }
  }

  /** 滚动位置 → 页码（offsets 二分：最后 offset[i] <= top 的页） */
  private currentPageFromScroll(): number {
    const top = this.scrollEl.scrollTop
    let lo = 0
    let hi = this.offsets.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.offsets[mid]! <= top) {
        lo = mid
      } else {
        hi = mid - 1
      }
    }
    return Math.min(lo + 1, this.totalPages)
  }

  private viewportHeight(): number {
    return this.scrollEl.clientHeight
  }

  /** 调度窗口更新（同步——scroll 事件本身已按帧合并，窗口计算与差分轻量） */
  private scheduleWindowUpdate(): void {
    if (this.disposed || this.doc === null) return
    this.updateWindow()
  }

  /** 可见窗口计算：可见页 ± pad，受 maxMountedPages 与 canvas 预算收窄 */
  private computeWindow(): { first: number; last: number } {
    if (this.totalPages === 0) return { first: 0, last: 0 }
    const viewport = this.viewportHeight()
    // #338 粘性期窗口以定位页为中心（scrollTop 被钳回 0 时窗口不得挂在
    // 首页区间——定位页槽必须在窗，落位后恢复滚动语义）
    const firstVisible = this.stickyPage > 0 ? this.stickyPage : this.currentPageFromScroll()
    let lastVisible = firstVisible
    if (viewport > 0 && this.stickyPage === 0) {
      lastVisible = this.pageAtOrBefore(this.scrollEl.scrollTop + viewport - 1)
    }
    const pad = PDF_SCROLL_LIMITS.windowPadPages
    let first = Math.max(1, firstVisible - pad)
    let last = Math.min(this.totalPages, Math.max(lastVisible, firstVisible) + pad)
    // 硬上限收窄：保可见尾部 + 下方预载（向下滚动体验优先）
    if (last - first + 1 > PDF_SCROLL_LIMITS.maxMountedPages) {
      first = Math.max(1, last - PDF_SCROLL_LIMITS.maxMountedPages + 1)
    }
    // 预算收窄：从上端逐页让位（可见页恒保底）
    let bytes = 0
    for (let p = first; p <= last; p++) {
      bytes += this.estimatedCanvasBytes(p)
    }
    while (bytes > PDF_SCROLL_LIMITS.canvasBudgetBytes && first < Math.min(firstVisible, last)) {
      bytes -= this.estimatedCanvasBytes(first)
      first++
    }
    return { first, last }
  }

  /** offset 所在页（含边界回退第 1 页） */
  private pageAtOrBefore(offset: number): number {
    let lo = 0
    let hi = this.offsets.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.offsets[mid]! <= offset) {
        lo = mid
      } else {
        hi = mid - 1
      }
    }
    return Math.min(lo + 1, this.totalPages)
  }

  private estimatedCanvasBytes(pageNo: number): number {
    const dim = this.pageDims[pageNo - 1]
    const baseW = dim?.w ?? PDF_ESTIMATED_PAGE_WIDTH
    const baseH = dim?.h ?? PDF_ESTIMATED_PAGE_HEIGHT
    const scale = this.scaleFor(baseW)
    return Math.round(baseW * scale) * Math.round(baseH * scale) * 4
  }

  /** 应用窗口：差分挂载/卸载页槽（离屏页取消并回收画布） */
  private updateWindow(): void {
    if (this.disposed || this.doc === null) return
    const { first, last } = this.computeWindow()
    if (last < first) return
    // 当前页 = 占视口比例最大的页（滚动互通的观测基准）。#338 粘性守卫：
    // 初次装载定位页的「滚动落位」确认前（scrollTop 落进该页区间——此前
    // display:none / 高度未定期的写入会被钳回 0，迟到的窗口更新把页码观
    // 感拉回第一页），布局漂移不覆盖页码且每次窗口更新重申定位；落位即
    // 解除粘性、恢复滚动互通
    if (this.stickyPage > 0) {
      const top = this.offsets[this.stickyPage - 1] ?? 0
      const bottom = this.offsets[this.stickyPage] ?? top
      if (this.scrollEl.scrollTop >= top && this.scrollEl.scrollTop < Math.max(bottom, top + 1)) {
        this.stickyPage = 0
        this.page = this.currentPageFromScroll()
      } else {
        this.page = this.stickyPage
        const need = top + Math.max(this.viewportHeight(), 1)
        if (this.scrollEl.scrollHeight < need) {
          this.bottomSpacer.style.height = `${need}px`
        }
        this.scrollEl.scrollTop = top
      }
    } else {
      this.page = this.currentPageFromScroll()
    }
    this.updatePageInfo()
    // 卸载离窗页
    for (const [pageNo, slot] of [...this.slots.entries()]) {
      if (pageNo < first || pageNo > last) {
        this.cancelSlot(slot)
        slot.el.remove()
        this.slots.delete(pageNo)
        const qi = this.renderQueue.indexOf(pageNo)
        if (qi >= 0) this.renderQueue.splice(qi, 1)
      }
    }
    // 挂载新入窗页（页序插入）
    for (let pageNo = first; pageNo <= last; pageNo++) {
      if (this.slots.has(pageNo)) continue
      const el = document.createElement('div')
      el.className = HOVER_PDF_CLASS_NAMES.page
      el.dataset['page'] = String(pageNo)
      el.style.height = `${this.pageHeights[pageNo - 1] ?? 0}px`
      let anchor: HTMLElement | null = null
      for (let next = pageNo + 1; next <= last; next++) {
        anchor = this.slots.get(next)?.el ?? null
        if (anchor !== null) break
      }
      this.pagesEl.insertBefore(el, anchor)
      this.slots.set(pageNo, { pageNo, el, canvas: null, task: null, width: 0, height: 0 })
      this.renderQueue.push(pageNo)
    }
    this.applySpacers(first, last)
    this.pumpRenderQueue()
  }

  /** spacer 高度 = 窗口前/后页高和（高度模型的 DOM 表达） */
  private applySpacers(first: number, last: number): void {
    this.topSpacer.style.height = `${this.offsets[first - 1] ?? 0}px`
    this.bottomSpacer.style.height = `${Math.max(0, this.totalHeight() - (this.offsets[last] ?? this.totalHeight()))}px`
  }

  /** 渲染队列泵（并发上限内逐页渲染；页序优先） */
  private pumpRenderQueue(): void {
    while (this.rendering < PDF_SCROLL_LIMITS.renderConcurrency && this.renderQueue.length > 0) {
      const pageNo = this.renderQueue.shift()!
      void this.renderPageInto(pageNo)
    }
  }

  /** 渲染一页入槽（真实页高回填 + 上方位移补偿；迟到/离窗不落地） */
  private async renderPageInto(pageNo: number): Promise<void> {
    const slot = this.slots.get(pageNo)
    const doc = this.doc
    if (slot === undefined || doc === null) return
    this.rendering++
    const seq = this.renderSeq
    try {
      const page = await doc.getPage(pageNo)
      if (seq !== this.renderSeq || this.disposed || !this.slots.has(pageNo)) {
        return
      }
      const base = page.getViewport({ scale: 1 })
      // 真实页高回填（估计 → 实测）：高度模型与占位修正
      const prevHeight = this.pageHeights[pageNo - 1] ?? 0
      const dim = this.pageDims[pageNo - 1]
      if (dim === null || dim.w !== base.width || dim.h !== base.height) {
        this.pageDims[pageNo - 1] = { w: base.width, h: base.height }
        const oldOffsets = this.offsets
        this.recomputeHeights()
        const newHeight = this.pageHeights[pageNo - 1] ?? 0
        slot.el.style.height = `${newHeight}px`
        // 上方位移补偿：本页高度回填（估计→实测）变化且该页整体在视口上方
        //（视口顶不低于其旧底——下方内容整体平移 newHeight-prevHeight）时
        // 平移 scrollTop，保视口内容稳定（横版页等纵横比偏离估计的页回填
        // 不使视口瞬间跳变）。E-4：旧实现比较本页自身顶偏移之差恒 0，为
        // 死分支——真实判据是「本页高度变化 + 视口在该页下方」
        const oldBottom = (oldOffsets[pageNo - 1] ?? 0) + prevHeight
        if (newHeight !== prevHeight && this.scrollEl.scrollTop >= oldBottom) {
          this.scrollEl.scrollTop += newHeight - prevHeight
        }
        const { first, last } = this.computeWindow()
        this.applySpacers(first, last)
      }
      const scale = this.scaleFor(base.width)
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.className = HOVER_PDF_CLASS_NAMES.canvas
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      const ctx = canvas.getContext('2d')
      if (ctx === null) {
        this.setError('resource')
        return
      }
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      // 旧画布让位（重渲染/尺寸变化路径——先移除再挂新）
      slot.canvas?.remove()
      if (slot.task !== null) slot.task.cancel()
      slot.el.textContent = ''
      slot.el.appendChild(canvas)
      slot.canvas = canvas
      slot.width = canvas.width
      slot.height = canvas.height
      const renderTask = page.render({ canvas, viewport })
      slot.task = renderTask
      try {
        await renderTask.promise
      } catch {
        // RenderingCancelledException（重入/离窗/dispose 取消）——不构成错误态
      }
      slot.task = null
      if (seq !== this.renderSeq || this.disposed || !this.slots.has(pageNo)) {
        this.flushContentWaiter()
        return
      }
      if (pageNo === this.contentPage || this.phase === 'loading') {
        this.phase = 'content'
        this.errorReason = ''
      }
      if (pageNo === this.contentPage) {
        this.flushContentWaiter()
      }
    } catch {
      if (seq !== this.renderSeq) return
      if (this.slots.has(pageNo)) {
        this.setError('resource')
        this.flushContentWaiter()
      }
    } finally {
      this.rendering = Math.max(0, this.rendering - 1)
      if (!this.disposed) this.pumpRenderQueue()
    }
  }

  /** show 的等待解除（定位页完成/取消/错误——被取代时旧 show 返回 false） */
  private flushContentWaiter(): void {
    const waiter = this.contentWaiter
    this.contentWaiter = null
    waiter?.()
  }

  private updatePageInfo(): void {
    if (this.page > 0 && this.totalPages > 0) {
      this.pageInfo.textContent = t('hover.pdfPageInfo', { page: String(this.page), total: String(this.totalPages) })
    } else {
      this.pageInfo.textContent = ''
    }
  }

  /**
   * 翻页操作（键位默认未绑定；只读——不修改任何文档）。语义 = 滚动定位
   * 到目标页顶部（与滚动互通）；页码乐观推进（连续翻页每次按键立即生效
   * ——绘制异步追上）。翻出界为无操作。绘制失败路径经 setError 清零页码
   *（失败态诚实显示——波次二·失败页码语义：error 态 probe 不残留乐观页码）。
   */
  turnPage(delta: 1 | -1, renderWidth: number): boolean {
    if (this.disposed || this.doc === null || this.phase !== 'content') {
      return false
    }
    const next = this.page + delta
    if (next < 1 || next > this.totalPages) {
      return false
    }
    if (Math.abs(renderWidth - this.renderWidth) > 2) {
      this.setRenderWidth(renderWidth)
    }
    this.stickyPage = 0 // 用户动作接管（翻页有自己的乐观页码推进）
    this.scrollToPage(next)
    return true
  }

  /**
   * 滚动定位到指定页（浮层/容器在滚动区显示后调用——loading 期宿主滚动
   * 区可能隐藏，scrollTop 写入丢失；越界钳制到 [1, totalPages] 并返回
   * false，不构成错误分态（重定位语义，与初次非法页码就地报错不冲突）
   */
  locateTo(pageNo: number): boolean {
    if (this.disposed || this.doc === null || this.page === pageNo) {
      return this.page === pageNo
    }
    const target = Math.min(Math.max(1, pageNo), this.totalPages)
    if (target !== pageNo) {
      return false
    }
    this.stickyPage = 0 // 显式重定位接管（调用方给定的目标即用户意图）
    this.scrollToPage(target)
    return true
  }

  /** 宽度变化：重算高度模型并重建当前窗口（scale 全变） */
  private setRenderWidth(width: number): void {
    if (this.disposed || this.doc === null || width <= 0) return
    this.renderWidth = width
    const scrollTop = this.scrollEl.scrollTop
    const ratio = this.pageHeights.length > 0
      ? scrollTop / Math.max(1, this.totalHeight())
      : 0
    this.recomputeHeights()
    for (const [pageNo, slot] of this.slots) {
      slot.el.style.height = `${this.pageHeights[pageNo - 1] ?? 0}px`
    }
    const { first, last } = this.computeWindow()
    this.applySpacers(first, last)
    // 滚动位置按比例恢复（宽度变化后绝对偏移失真）
    this.scrollEl.scrollTop = Math.round(ratio * this.totalHeight())
    this.updateWindow()
  }

  /** 撤下在场内容（目标失效 deleted/stale——旧 canvas 不冒充在场内容；
   *  与 dispose 的区别：视图与文档引用保留，恢复 changed 推送可重载） */
  discardContent(): void {
    this.renderSeq++
    this.phase = 'idle'
    this.page = 0
    this.contentPage = 0
    this.stickyPage = 0
    this.errorReason = ''
    this.clearPages()
    this.pageInfo.textContent = ''
  }

  /** 当前渲染宽（翻页操作的 scale 输入——滚动区内容宽） */
  currentRenderWidth(fallback: number): number {
    const inner = this.scrollEl.clientWidth
    return inner > 0 ? inner - 16 : fallback
  }

  private setError(reason: PdfRenderErrorReason): void {
    this.phase = 'error'
    this.errorReason = reason
    this.page = 0 // 失败态诚实显示：清乐观/残留页码（画布已清，页码不冒充在场——波次二·失败页码语义）
    this.clearPages()
    this.pageInfo.textContent = ''
    this.flushContentWaiter()
  }

  /** 清空页塔（cancel 在途、回收画布、归零 spacer——root 骨架保留） */
  private clearPages(): void {
    for (const slot of this.slots.values()) {
      this.cancelSlot(slot)
      slot.el.remove()
    }
    this.slots.clear()
    this.renderQueue.length = 0
    this.topSpacer.style.height = '0px'
    this.bottomSpacer.style.height = '0px'
  }

  private cancelSlot(slot: PdfPageSlot): void {
    slot.task?.cancel()
    slot.task = null
    if (slot.canvas !== null) {
      // 画布像素释放：置零尺寸（GPU/位图回收的既有约定）
      slot.canvas.width = 0
      slot.canvas.height = 0
      slot.canvas.remove()
      slot.canvas = null
    }
    slot.width = 0
    slot.height = 0
    if (slot.pageNo === this.contentPage) {
      // 定位页被离窗取消：等待中的 show 解除（迟到绘制不冒充在场）
      this.flushContentWaiter()
    }
  }

  private releaseDocRef(): void {
    this.doc = null
    this.docUri = ''
    this.totalPages = 0
    this.pageDims = []
    this.pageHeights = []
    this.offsets = [0]
    if (this.docRefUri !== '') {
      pdfReleaseDocument(this.docRefUri)
      this.docRefUri = ''
    }
  }

  /** 释放：取消在途任务、释放文档引用、清空 DOM 与监听。之后一切迟到结果不落地 */
  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.renderSeq++
    this.flushContentWaiter()
    this.clearPages()
    this.releaseDocRef()
    this.phase = 'idle'
    this.page = 0
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    for (const off of this.listeners.splice(0)) off()
    this.root.remove()
  }
}

function withTrailingSlash(uri: string): string {
  return uri.endsWith('/') ? uri : `${uri}/`
}

/** PDF 渲染错误分态 → 就地 i18n 文案（页码越界附请求页与总页数） */
export function pdfErrorText(reason: PdfRenderErrorReason, page: number, totalPages: number): string {
  switch (reason) {
    case 'corrupt':
      return t('hover.pdfErrorCorrupt')
    case 'encrypted':
      return t('hover.pdfErrorEncrypted')
    case 'page-range':
      return t('hover.pdfErrorPageRange', { page: String(page), total: String(totalPages) })
    case 'resource':
      return t('hover.pdfErrorResource')
    case 'load-failed':
      return t('hover.pdfErrorLoadFailed')
  }
}
