// #334（P3-02）PDF 探针 webview 主线程。
// 运行在真实宿主（VSCode 1.82.3 / Electron 25 / Chromium 114）的 webview 内：
// - PDF.js 核心（legacy 产物）经 esbuild 打入本 bundle；
// - worker 走「fetch worker 产物文本 -> Blob -> objectURL -> workerSrc」装配
//   （生产候选路线），Worker 与 Blob 的创建/终止/释放全程打点计数；
// - cMap / 标准字体 / ICC / wasm 资源经 asWebviewUri 指向扩展目录；
// - 测量数据与断言结果 postMessage 回宿主侧 suite。
//
// 本文件是探针代码（研究票产物），不进 VSIX，不定义产品行为。
import './workerPatches'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

interface AcquireVsCodeApi {
  postMessage(msg: unknown): void
  getState(): unknown
  setState(state: unknown): unknown
}
declare const acquireVsCodeApi: () => AcquireVsCodeApi

// 诊断 inline 脚本可能已 acquire 过（探针 HTML 的 bootstrap 通道）——
// VSCode webview 每页只允许一次 acquire，复用既有实例
const vscode = ((window as unknown as { __vsidianProbeApi?: AcquireVsCodeApi }).__vsidianProbeApi
  ?? acquireVsCodeApi())

/** 资源与样本 URI（宿主侧 configure 消息注入）。 */
let cfg: {
  workerJsUri: string
  cMapUrl: string
  fontUrl: string
  wasmUrl: string
  iccUrl: string
  samples: Record<string, string>
} | null = null

/** 累积测量报告（suite 在收尾时取回整包）。 */
interface DrawCost { sample: string; width: number; height: number; canvasBytes: number; renderMs: number; nonWhiteRatio: number; sourceBytes: number; loadMs: number; page: number; scale: number }
const metrics = {
  pdfjsVersion: (pdfjsLib as unknown as { version?: string }).version,
  drawCosts: [] as DrawCost[],
  totals: { canvasCount: 0, canvasBytes: 0, sourceBytes: 0, loads: 0 },
}

async function ensureWorkerBlobUrl(): Promise<string> {
  // 生产候选装配：worker 单文件产物以文本 fetch（connect-src: cspSource）后
  // 经 Blob URL 提供给 PDF.js。blob URL 只创建一次，探针收尾统一 revoke。
  if (!(globalThis as Record<string, unknown>).__vsidianPdfWorkerUrl) {
    const res = await fetch(cfg!.workerJsUri)
    if (!res.ok) throw new Error(`worker 产物 fetch 失败：${res.status}`)
    const text = await res.text()
    const blob = new Blob([text], { type: 'text/javascript' })
    const url = URL.createObjectURL(blob)
    ;(globalThis as Record<string, unknown>).__vsidianPdfWorkerUrl = url
  }
  return (globalThis as Record<string, unknown>).__vsidianPdfWorkerUrl as string
}

function withTrailingSlash(uri: string): string {
  return uri.endsWith('/') ? uri : uri + '/'
}

interface LoadedDoc {
  task: { promise: Promise<pdfjsLib.PDFDocumentProxy>; destroy(): Promise<void> }
  doc: pdfjsLib.PDFDocumentProxy
  bytes: number
  ms: number
}

/** 按生产候选参数装载一个样本（fetch 字节 -> getDocument）。 */
async function loadSample(name: string, extra: Record<string, unknown> = {}): Promise<LoadedDoc> {
  if (!cfg) throw new Error('未配置资源 URI')
  const workerSrc = await ensureWorkerBlobUrl()
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc
  const t0 = performance.now()
  const res = await fetch(cfg.samples[name])
  if (!res.ok) throw new Error(`样本 fetch 失败 ${name}：${res.status}`)
  const data = new Uint8Array(await res.arrayBuffer())
  // getDocument 会把 data 的底层 buffer transfer 给 worker（主线程侧
  // byteLength 随即归零），源字节必须在 transfer 前记录
  const sourceBytes = data.byteLength
  const task = pdfjsLib.getDocument({
    data,
    cMapUrl: withTrailingSlash(cfg.cMapUrl),
    cMapPacked: true,
    standardFontDataUrl: withTrailingSlash(cfg.fontUrl),
    wasmUrl: withTrailingSlash(cfg.wasmUrl),
    iccUrl: withTrailingSlash(cfg.iccUrl),
    ...extra,
  })
  let doc: pdfjsLib.PDFDocumentProxy
  try {
    doc = await task.promise
  } catch (err) {
    // 失败装载也持有 worker——不显式 destroy 即泄漏（P3-05 接线注意点）
    try { await task.destroy() } catch { /* 已销毁 */ }
    throw err
  }
  const ms = performance.now() - t0
  metrics.totals.loads++
  metrics.totals.sourceBytes += sourceBytes
  return { task, doc, bytes: sourceBytes, ms }
}

/** 渲染一页到离屏 canvas 并采样像素证据（非空白比例 + 角/中心 RGB）。 */
interface PageStats {
  page: number; scale: number; width: number; height: number; canvasBytes: number
  renderMs: number; nonWhiteRatio: number
  cornerRGB: number[]; centerRGB: number[]; farCornerRGB: number[]
}

async function renderPage(
  doc: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
  scale: number,
): Promise<{ canvas: HTMLCanvasElement; stats: PageStats }> {
  const page = await doc.getPage(pageNumber)
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const t0 = performance.now()
  const renderTask = page.render({ canvas, viewport })
  await renderTask.promise
  const ms = performance.now() - t0
  // 像素采样：九宫格 5x5 采样块的中心像素 + 非白像素比例
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  let nonWhite = 0
  const samples: number[][] = []
  const total = canvas.width * canvas.height
  for (let i = 0; i < total; i++) {
    if (image[i * 4] < 245 || image[i * 4 + 1] < 245 || image[i * 4 + 2] < 245) nonWhite++
  }
  for (const [fx, fy] of [[0.05, 0.05], [0.5, 0.5], [0.95, 0.95]]) {
    const x = Math.floor(canvas.width * fx)
    const y = Math.floor(canvas.height * fy)
    const idx = (y * canvas.width + x) * 4
    samples.push([image[idx], image[idx + 1], image[idx + 2]])
  }
  const bytes = canvas.width * canvas.height * 4
  metrics.totals.canvasCount++
  metrics.totals.canvasBytes += bytes
  const stats = {
    page: pageNumber,
    scale,
    width: canvas.width,
    height: canvas.height,
    canvasBytes: bytes,
    renderMs: Math.round(ms),
    nonWhiteRatio: Number((nonWhite / total).toFixed(5)),
    cornerRGB: samples[0],
    centerRGB: samples[1],
    farCornerRGB: samples[2],
  }
  return { canvas, stats }
}

async function extractText(doc: pdfjsLib.PDFDocumentProxy, pageNumber: number): Promise<string> {
  const page = await doc.getPage(pageNumber)
  const tc = await page.getTextContent()
  return tc.items.map((item) => ('str' in item ? item.str : '')).join('')
}

/* ------------------------------ 场景实现 ------------------------------ */

type StepReporter = (ok: boolean, detail: string) => void

/** CSP 探测：最小 blob worker（与 PDF.js 无关），回答 worker-src 是否放行。 */
async function scenarioWorkerCspProbe(report: StepReporter): Promise<void> {
  const code = 'self.onmessage = (e) => { if (e.data === "ping") self.postMessage("pong") }'
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }))
  try {
    const worker = new Worker(url, { type: 'module' })
    const pong = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('worker ping 超时')), 5000)
      worker.addEventListener('message', (e) => { clearTimeout(timer); resolve(String(e.data)) })
      worker.addEventListener('error', (e) => { clearTimeout(timer); reject(new Error(e.message || 'worker error 事件')) })
      worker.postMessage('ping')
    })
    worker.terminate()
    report(pong === 'pong', `blob worker 创建与 echo 成功（${pong}）——CSP 放行 blob worker`)
  } catch (err) {
    report(false, `blob worker 被拒或失败：${(err as Error).name}: ${(err as Error).message}`)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** 样本绘制 + 文本提取（draw-* / text-* 场景共用）。 */
async function scenarioDraw(
  report: StepReporter,
  sample: string,
  opts: { scale?: number; expectText?: string | null; expectNonWhite?: boolean },
): Promise<void> {
  const loaded = await loadSample(sample)
  try {
    const { stats } = await renderPage(loaded.doc, 1, opts.scale ?? 1.5)
    metrics.drawCosts.push({ ...stats, sample, sourceBytes: loaded.bytes, loadMs: Math.round(loaded.ms) })
    const drawn = stats.nonWhiteRatio > 0
    report(drawn, `${sample} 装载 ${loaded.bytes} B / ${Math.round(loaded.ms)}ms，canvas ${stats.width}x${stats.height} 非白像素比例 ${stats.nonWhiteRatio}`)
    if (opts.expectText !== undefined) {
      const text = await extractText(loaded.doc, 1)
      if (opts.expectText === null) {
        report(true, `${sample} 文本提取（如实为空）："${text.slice(0, 30)}"`)
      } else {
        const hit = text.includes(opts.expectText)
        report(hit, `${sample} 文本提取${hit ? '命中' : '未命中'}「${opts.expectText}」实际="${text.slice(0, 40)}"`)
      }
    }
  } finally {
    // 任何一步抛错也要销毁装载任务（worker 归零依赖显式 destroy）
    await loaded.task.destroy()
  }
}

/** 多页 + 按页取消：渲染中大 scale 页并立即取消，验证取消分态与后续可用。 */
async function scenarioCancel(report: StepReporter): Promise<void> {
  const loaded = await loadSample('multipage.pdf')
  const page1 = await renderPage(loaded.doc, 1, 1.5)
  report(page1.stats.nonWhiteRatio > 0, `第 1 页渲染完成（${page1.stats.renderMs}ms）`)
  // 大 scale 拉长第 2 页渲染窗口，渲染发起后立即取消
  const page = await loaded.doc.getPage(2)
  const viewport = page.getViewport({ scale: 6 })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const renderTask = page.render({ canvas, viewport })
  renderTask.cancel()
  const cancelError = await renderTask.promise.then(
    () => null,
    (err: unknown) => err,
  )
  if (cancelError) {
    const cancelled = (cancelError as Error).name === 'RenderingCancelledException'
    report(cancelled, `第 2 页大 scale 渲染被取消：${(cancelError as Error).name}（预期 RenderingCancelledException）`)
  } else {
    // 渲染太快来不及取消：如实记录未取得取消分态（探针失败，供调参 scale）
    report(false, '第 2 页渲染在 cancel 前完成（scale 6 仍过快，未取得取消分态证据）')
  }
  const page3 = await renderPage(loaded.doc, 3, 1.5)
  report(page3.stats.nonWhiteRatio > 0, '取消后第 3 页渲染仍可用')
  await loaded.task.destroy()
}
// 注：scenarioCancel 与 scenarioConcurrent 自身已顺序 destroy；中途异常时
// 计数归零由 finalMetrics 如实暴露（不静默）

/** 并发装载 3 文档 + 全部销毁：worker/Blob 计数应先增后归零。 */
async function scenarioConcurrent(report: StepReporter): Promise<void> {
  const stats = (globalThis as Record<string, unknown>).__vsidianPdfWorkerStats as {
    workersCreated: number
    workersTerminated: number
    blobCreated: number
    blobRevoked: number
  }
  const before = { c: stats.workersCreated, t: stats.workersTerminated }
  const loaded = await Promise.all([
    loadSample('multipage.pdf'),
    loadSample('multipage.pdf'),
    loadSample('multipage.pdf'),
  ])
  const renders = await Promise.all(loaded.map((l) => renderPage(l.doc, 1, 1.5)))
  const during = { c: stats.workersCreated - before.c, t: stats.workersTerminated - before.t }
  report(during.c === 3, `并发 3 文档装载渲染（每文档 1 worker）：worker 新建 ${during.c}（预期 3）`)
  const allNonWhite = renders.every((r) => r.stats.nonWhiteRatio > 0)
  report(allNonWhite, '并发渲染 3 canvas 全部非空白')
  await Promise.all(loaded.map((l) => l.task.destroy()))
  // terminate 经 postMessage 异步完成，给宿主一点稳定窗
  await new Promise((r) => setTimeout(r, 800))
  const after = { c: stats.workersCreated - before.c, t: stats.workersTerminated - before.t }
  report(after.c === after.t, `全部 destroy 后 worker 终止归零：created ${after.c} / terminated ${after.t}`)
  // 销毁后的迟到访问应被拒绝（释放后无悬挂活动）
  let rejected = false
  try {
    await loaded[0].doc.getPage(1)
  } catch {
    rejected = true
  }
  report(rejected, '已销毁文档的迟到 getPage 被拒绝')
}

/** 失败样本分态：损坏 / 加密 / 非 PDF。 */
async function scenarioFailures(report: StepReporter): Promise<void> {
  await loadSample('corrupt.pdf').then(
    () => report(false, 'corrupt.pdf 意外装载成功（预期 InvalidPDFException）'),
    (err: unknown) => {
      const name = (err as Error).name
      report(name === 'InvalidPDFException', `corrupt.pdf 分态：${name}（预期 InvalidPDFException）`)
    },
  )
  await loadSample('garbage.pdf').then(
    () => report(false, 'garbage.pdf 意外装载成功'),
    (err: unknown) => {
      const name = (err as Error).name
      report(name === 'InvalidPDFException', `garbage.pdf 分态：${name}（预期 InvalidPDFException）`)
    },
  )
  await loadSample('encrypted.pdf').then(
    () => report(false, 'encrypted.pdf 意外装载成功（预期 PasswordException）'),
    (err: unknown) => {
      const name = (err as Error).name
      report(name === 'PasswordException', `encrypted.pdf 分态：${name}（预期 PasswordException）`)
    },
  )
}

/* ------------------------------ 消息循环 ------------------------------ */

// 脚本初始化完成即宣告 ready（suite 收到后才发 configure；不能等 configure
// 再回 ready，否则与 suite 的等待互为死锁）
vscode.postMessage({ type: 'ready' })

window.addEventListener('message', async (event) => {
  const msg = event.data as { type: string; scenario?: string; options?: Record<string, unknown> }
  if (msg.type === 'configure') {
    cfg = msg as unknown as typeof cfg
    return
  }
  if (msg.type === 'metrics') {
    const stats = (globalThis as Record<string, unknown>).__vsidianPdfWorkerStats
    vscode.postMessage({ type: 'metrics', metrics: { ...metrics, workerStats: stats } })
    return
  }
  if (msg.type === 'finalize') {
    // revoke worker blob URL 并回报最终计数
    const url = (globalThis as Record<string, unknown>).__vsidianPdfWorkerUrl as string | undefined
    if (url) {
      URL.revokeObjectURL(url)
      ;(globalThis as Record<string, unknown>).__vsidianPdfWorkerUrl = undefined
    }
    await new Promise((r) => setTimeout(r, 300))
    const stats = (globalThis as Record<string, unknown>).__vsidianPdfWorkerStats
    vscode.postMessage({ type: 'finalized', metrics: { ...metrics, workerStats: stats } })
    return
  }
  if (msg.type !== 'run' || !msg.scenario) return
  const scenario = msg.scenario
  const report: StepReporter = (ok, detail) => {
    vscode.postMessage({ type: 'step', scenario, ok, detail })
  }
  try {
    switch (scenario) {
      case 'worker-csp-probe':
        await scenarioWorkerCspProbe(report)
        break
      case 'draw-zh-embedded':
        await scenarioDraw(report, 'zh-embedded.pdf', { expectText: '中文内嵌字体样页' })
        break
      case 'draw-zh-cmap':
        await scenarioDraw(report, 'zh-cmap.pdf', { expectText: '中文非内嵌字体样页' })
        break
      case 'draw-latin':
        await scenarioDraw(report, 'latin-standard.pdf', { expectText: 'Standard font probe' })
        break
      case 'draw-scanned':
        await scenarioDraw(report, 'scanned.pdf', { expectText: null })
        break
      case 'draw-zh-page2':
        await scenarioDraw(report, 'zh-embedded.pdf', { scale: 2 })
        break
      case 'multipage-cancel':
        await scenarioCancel(report)
        break
      case 'concurrent-load-destroy':
        await scenarioConcurrent(report)
        break
      case 'failure-states':
        await scenarioFailures(report)
        break
      default:
        report(false, `未知场景 ${scenario}`)
    }
    vscode.postMessage({ type: 'scenarioDone', scenario })
  } catch (err) {
    vscode.postMessage({ type: 'step', scenario, ok: false, detail: `场景异常：${(err as Error).stack ?? String(err)}` })
    vscode.postMessage({ type: 'scenarioDone', scenario })
  }
})
