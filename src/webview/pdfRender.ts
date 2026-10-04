// PDF 悬停渲染器（#337 / P3-05）：悬停浮层内绘制本地 PDF 首条闭环——
// 装载指定页（双链 #page=N 或第一页）到 canvas，支持翻页操作、错误分态
// 与取消。装配结论全部来自 #334 探针（pdfjs-dist@6.4.299 legacy 主库 +
// legacy worker、blob 单文件 worker、asWebviewUri 资产目录 + 尾斜杠、
// 6.x render() 以 {canvas, viewport} 为主参、失败装载也持有 worker）。
//
// 资源装配（宿主 HTML 内联注入全局，mermaid 同款 URI 传递机制）：
// - `window.__vsidianPdfAssets`：pdfMain.js / pdfWorker.js 产物与
//   cmaps / standard_fonts / wasm / iccs 资产目录的 webview 资源 URI；
// - 主库懒加载：动态 <script> 装载 pdfMain.js（script-src cspSource 放行），
//   pdfjsLib 挂全局 `__vsidianPdfjs`；进程级单例 Promise；
// - worker：fetch 单文件产物文本（connect-src cspSource 放行）→ Blob →
//   objectURL → GlobalWorkerOptions.workerSrc（worker-src blob: 放行）；
//   blob URL 进程级单例常驻（装配资源，非每文档）；每文档 worker 由
//   loadingTask.destroy() 终止。
//
// 生命周期纪律：
// - 渲染代次（renderSeq）守卫：重入 show / dispose 后的迟到结果不落地
//   （旧 canvas 不冒充新目标）；
// - getDocument reject 的 catch 里显式 task.destroy()（失败装载也持有
//   worker——#334 实测泄漏纪律）；
// - dispose：取消在途 renderTask、destroy 文档、清空 DOM。
//
// 错误分态（就地 i18n，不弹宿主通知）：
// - corrupt（InvalidPDF）／ encrypted（Password——首批提示在原应用打开，
//   不采集密码）／ page-range（页码越出总页数，不静默跳第一页）／
//   resource（fetch 或渲染失败）／ load-failed（引擎产物装载失败）。
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

/** PDF.js 文档代理的最小消费面（本票只用页视口与渲染） */
interface PdfDocumentLike {
  numPages: number
  getPage(pageNumber: number): Promise<PdfPageLike>
  destroy(): Promise<void>
}

interface PdfPageLike {
  getViewport(params: { scale: number }): { width: number; height: number }
  render(params: { canvas: HTMLCanvasElement; viewport: { width: number; height: number } }): { promise: Promise<void>; cancel(): void }
}

/** 渲染错误分态（i18n 键的选取依据；page-range 附页码与总页数） */
export type PdfRenderErrorReason = 'corrupt' | 'encrypted' | 'page-range' | 'resource' | 'load-failed'

/** 渲染器观测面（hoverPopupProbe 的 pdf 字段数据源；集成/浏览器测试断言）。
 *  nonWhiteRatio 为 content 态的 canvas 实际像素采样（绘制层证据——集成
 *  断言落像素而非 DOM 存在性；非 content 态为 -1） */
export interface PdfRenderProbe {
  phase: 'idle' | 'loading' | 'content' | 'error'
  page: number
  totalPages: number
  canvasWidth: number
  canvasHeight: number
  errorReason: PdfRenderErrorReason | ''
  requestedPage: number
  nonWhiteRatio: number
}

/** 悬停 PDF 容器的稳定类名（样式契约 chrome 域 hover-popup 条目同源登记） */
export const HOVER_PDF_CLASS_NAMES = {
  /** PDF 内容容器（浮层滚动区内，与 Reading 容器并列） */
  root: 'vsidian-hover-pdf',
  /** 页面画布 */
  canvas: 'vsidian-hover-pdf-canvas',
  /** 页码信息行（第 N / M 页——翻页操作的状态反馈） */
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
 *  常驻是装配资源的进程级共享语义，跨用例替身需重置） */
export function __resetPdfjsSingletonsForTest(): void {
  pdfjsLoad = null
  workerBlobUrl = null
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

/** PDF.js 拒绝值的错误名（ InvalidPDF / Password 等以 err.name 分态） */
function pdfErrorName(err: unknown): string {
  if (typeof err === 'object' && err !== null && 'name' in err) {
    return String((err as { name: unknown }).name)
  }
  return ''
}

/**
 * PDF 悬停渲染器：一个浮层实例一个（挂浮层滚动区内）。
 *
 * show() 幂等重入：同 URI 重入只在页码变化时翻页（文档复用，不重复装载）；
 * 换 URI 先销毁旧文档。dispose() 后一切迟到结果不落地。
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
  private docTask: { destroy(): Promise<void> } | null = null
  private renderTask: { cancel(): void; promise: Promise<void> } | null = null
  /** 内容容器（公开只读：浮层的尺寸观察挂此——canvas 绘制增高触发重定位） */
  readonly root: HTMLDivElement
  private readonly canvas: HTMLCanvasElement
  private readonly pageInfo: HTMLDivElement

  constructor(container: HTMLElement) {
    this.root = document.createElement('div')
    this.root.className = HOVER_PDF_CLASS_NAMES.root
    this.canvas = document.createElement('canvas')
    this.canvas.className = HOVER_PDF_CLASS_NAMES.canvas
    this.pageInfo = document.createElement('div')
    this.pageInfo.className = HOVER_PDF_CLASS_NAMES.pageInfo
    this.root.appendChild(this.canvas)
    this.root.appendChild(this.pageInfo)
    container.appendChild(this.root)
  }

  /** 观测面（probe 数据源；canvas 尺寸为实际绘制面） */
  probe(): PdfRenderProbe {
    return {
      phase: this.phase,
      page: this.page,
      totalPages: this.totalPages,
      canvasWidth: this.phase === 'content' ? this.canvas.width : 0,
      canvasHeight: this.phase === 'content' ? this.canvas.height : 0,
      errorReason: this.errorReason,
      requestedPage: this.requestedPage,
      nonWhiteRatio: this.phase === 'content' ? this.canvasNonWhiteRatio() : -1,
    }
  }

  /** canvas 非白像素比例（绘制层采样；无 2d 上下文或采样不可用时 -1
   *  ——诚实边界：观测失败不构成渲染失败，probe 不得因环境缺 canvas 实
   *  现而抛错） */
  private canvasNonWhiteRatio(): number {
    if (this.canvas.width === 0 || this.canvas.height === 0) {
      return -1
    }
    try {
      const ctx = this.canvas.getContext('2d')
      if (ctx === null || typeof ctx.getImageData !== 'function') {
        return -1
      }
      const data = ctx.getImageData(0, 0, this.canvas.width, this.canvas.height).data
      let nonWhite = 0
      const total = this.canvas.width * this.canvas.height
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
   * 呈现目标：装载 uri 指向的 PDF 并绘制 page（缺省第一页）。
   * 返回 false = 本次调用被后续重入/dispose 取代（迟到结果不落地）。
   */
  async show(uri: string, page: number | undefined, renderWidth: number): Promise<boolean> {
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
    const target = page ?? 1
    this.requestedPage = target
    this.phase = 'loading'
    this.errorReason = ''
    this.clearCanvas()
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
    // 同文档重入：只翻页（文档复用——快速切换页码不重复装载）
    if (this.doc !== null && this.docUri === uri) {
      await this.renderPage(seq, target, renderWidth)
      return seq === this.renderSeq
    }
    await this.destroyDocument()
    if (seq !== this.renderSeq || this.disposed) {
      return false
    }
    const res = await fetch(uri)
    if (!res.ok) {
      if (seq !== this.renderSeq) return false
      this.setError('resource')
      return true
    }
    // data 的底层 buffer 会被 transfer 给 worker（#334 实测）——先取快照
    const data = new Uint8Array(await res.arrayBuffer())
    if (seq !== this.renderSeq || this.disposed) {
      return false
    }
    const task = lib.getDocument({
      data,
      cMapUrl: withTrailingSlash(assets.cMapUrl),
      cMapPacked: true,
      standardFontDataUrl: withTrailingSlash(assets.fontUrl),
      wasmUrl: withTrailingSlash(assets.wasmUrl),
      iccUrl: withTrailingSlash(assets.iccUrl),
    })
    this.docTask = task
    try {
      const doc = await task.promise
      if (seq !== this.renderSeq || this.disposed) {
        // 已被取代：销毁刚完成的文档（不冒充新目标）
        void doc.destroy()
        return false
      }
      this.doc = doc
      this.docUri = uri
      this.totalPages = doc.numPages
      await this.renderPage(seq, target, renderWidth)
      return seq === this.renderSeq
    } catch (err) {
      if (seq !== this.renderSeq) return false
      // 失败装载也持有 worker——必须显式 destroy（#334 泄漏纪律）
      await this.destroyDocument()
      if (pdfErrorName(err) === 'PasswordException') {
        this.setError('encrypted')
      } else if (pdfErrorName(err) === 'InvalidPDFException') {
        this.setError('corrupt')
      } else {
        this.setError('resource')
      }
      return true
    }
  }

  /** 绘制指定页（页码越界 → page-range 分态，不静默跳第一页） */
  private async renderPage(seq: number, target: number, renderWidth: number): Promise<void> {
    const doc = this.doc
    if (doc === null) {
      this.setError('resource')
      return
    }
    if (target < 1 || target > doc.numPages) {
      this.page = 0
      this.setError('page-range')
      return
    }
    try {
      const page = await doc.getPage(target)
      if (seq !== this.renderSeq || this.disposed) {
        return
      }
      const base = page.getViewport({ scale: 1 })
      const scale = Math.min(PDF_RENDER_MAX_SCALE, Math.max(0.1, renderWidth / base.width))
      const viewport = page.getViewport({ scale })
      this.canvas.width = Math.floor(viewport.width)
      this.canvas.height = Math.floor(viewport.height)
      const ctx = this.canvas.getContext('2d')
      if (ctx === null) {
        this.setError('resource')
        return
      }
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
      const renderTask = page.render({ canvas: this.canvas, viewport })
      this.renderTask = renderTask
      try {
        await renderTask.promise
      } catch {
        // RenderingCancelledException（重入/ dispose 取消）——不构成错误态
        if (seq !== this.renderSeq) return
      }
      this.renderTask = null
      if (seq !== this.renderSeq || this.disposed) {
        return
      }
      this.page = target
      this.phase = 'content'
      this.errorReason = ''
      this.pageInfo.textContent = t('hover.pdfPageInfo', { page: String(target), total: String(this.totalPages) })
    } catch {
      if (seq !== this.renderSeq) return
      this.setError('resource')
    }
  }

  /** 翻页操作（键位默认未绑定；只读——不修改任何文档）。翻出界为无操作。
   *  页码乐观推进（连续翻页的每次按键立即生效——绘制异步追上；失败路径
   *  setError 清零页码，不残留错误值） */
  turnPage(delta: 1 | -1, renderWidth: number): boolean {
    if (this.disposed || this.doc === null || this.phase !== 'content') {
      return false
    }
    const next = this.page + delta
    if (next < 1 || next > this.totalPages) {
      return false
    }
    this.page = next
    void this.renderPage(++this.renderSeq, next, renderWidth)
    return true
  }

  /** 撤下在场内容（目标失效 deleted/stale——旧 canvas 不冒充在场内容；
   *  与 dispose 的区别：视图与装配资源保留，恢复 changed 推送可重绘） */
  discardContent(): void {
    this.renderSeq++
    this.phase = 'idle'
    this.page = 0
    this.errorReason = ''
    this.clearCanvas()
    this.pageInfo.textContent = ''
  }

  /** 当前渲染宽（翻页操作的 scale 输入——浮层滚动区内容宽） */
  currentRenderWidth(fallback: number): number {
    const el = this.root.parentElement
    const inner = el?.clientWidth ?? 0
    return inner > 0 ? inner - 16 : fallback
  }

  private setError(reason: PdfRenderErrorReason): void {
    this.phase = 'error'
    this.errorReason = reason
    this.clearCanvas()
    this.pageInfo.textContent = ''
  }

  private clearCanvas(): void {
    this.canvas.width = 0
    this.canvas.height = 0
  }

  private async destroyDocument(): Promise<void> {
    this.renderTask?.cancel()
    this.renderTask = null
    const doc = this.doc
    const task = this.docTask
    this.doc = null
    this.docUri = ''
    this.docTask = null
    this.totalPages = 0
    if (doc !== null) {
      try {
        await doc.destroy()
      } catch {
        // 已销毁（迟到 destroy 双保险）
      }
      return
    }
    if (task !== null) {
      try {
        await task.destroy()
      } catch {
        // 同上
      }
    }
  }

  /** 释放：取消在途任务、销毁文档、清空 DOM。之后一切迟到结果不落地 */
  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.renderSeq++
    void this.destroyDocument()
    this.phase = 'idle'
    this.clearCanvas()
    this.root.remove()
  }
}

/** 渲染 scale 上限（浮层宽适配的放大封顶——探针实测 scale 2 约 7.6 MiB/页，
 *  上限 2.5 控制单页 canvas 费用；P3-07 缩放接入后再放开用户控制） */
const PDF_RENDER_MAX_SCALE = 2.5

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
