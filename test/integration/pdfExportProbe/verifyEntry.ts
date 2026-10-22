// #619（V01）PDF 导出探针 · 产物验证页面入口（跑在被测 Chromium 页面内）。
// 用 pdfjs-dist（与生产阅读同源、legacy 产物）解析探针生成的 PDF：
// - 页数、逐页文本提取（中文命中断言的依据）；
// - 大纲（书签）读回（pdf-lib 后处理验证）；
// - 指定页渲染 PNG（视觉证据，toDataURL 由宿主落盘）；
// - 文本项几何（排版矩阵的边距/字号/scale 测量）与页面像素采样。
// worker 文本由宿主传入（Blob URL 装配，与 P3-02 验证过的形态一致）；
// 本页面跑在 Chrome 155，无 webview CSP 限制。
// 本文件是探针代码（研究票产物），不进 VSIX，不定义产品行为。
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

export interface VerifyRequest {
  pdfBase64: string
  /** 需要渲染成 PNG 的页码（1 起）。 */
  renderPages?: number[]
  /** 渲染 scale（默认 1.5）。 */
  scale?: number
  /** 需要返回文本项几何（str/transform/width/height）的页码。 */
  wantTextItems?: number[]
  /** 像素采样点：{page, fx, fy}（0-1 归一化）。 */
  samplePoints?: Array<{ page: number; fx: number; fy: number }>
}

export interface TextItemInfo { str: string; x: number; y: number; w: number; h: number }

export interface VerifyResult {
  pdfjsVersion: string
  numPages: number
  /** 页码 -> 拼接文本（跨 item 直连，供 contains 断言）。键经 JSON 传输为字符串。 */
  textByPage: Record<string, string>
  /** pdf-lib 后处理书签的读回结果。 */
  outline: Array<{ title: string; destPageIndex: number | null }> | null
  /** 页码 -> PNG dataURL。 */
  pngs: Record<string, string>
  /** 页码 -> 文本项几何（仅 wantTextItems 请求的页）。 */
  textItems: Record<string, TextItemInfo[]>
  /** samplePoints 的采样结果（与请求同序）。 */
  sampleColors: Array<Array<number> | null>
  /** 每页尺寸（pt，PDF 用户空间）。 */
  pageSizes: Record<string, { width: number; height: number }>
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

let workerUrl: string | null = null

/** worker 装配：fetch 同源 verifyWorker.js -> Blob URL -> workerSrc。
 * 页面必须具备 http(s) origin（about:blank 的 opaque origin 下 Blob
 * 无法承载 Worker，PDF.js 会回退 fake worker 并失败——探针实测）。 */
async function ensureWorkerUrl(): Promise<string> {
  if (!workerUrl) {
    const response = await fetch(new URL('verifyWorker.js', document.baseURI).toString())
    if (!response.ok) throw new Error(`verifyWorker.js fetch 失败：${response.status}`)
    const text = await response.text()
    const blob = new Blob([text], { type: 'text/javascript' })
    workerUrl = URL.createObjectURL(blob)
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl
    const readBack = pdfjsLib.GlobalWorkerOptions.workerSrc
    if (readBack !== workerUrl) throw new Error(`workerSrc 赋值未生效（读回 ${JSON.stringify(readBack)}）——bundle 内出现双副本`)
  }
  return workerUrl
}

async function verifyRun(request: VerifyRequest): Promise<VerifyResult> {
  await ensureWorkerUrl()
  const data = base64ToBytes(request.pdfBase64)
  const task = pdfjsLib.getDocument({ data })
  let doc: pdfjsLib.PDFDocumentProxy
  try {
    doc = await task.promise
  } catch (err) {
    try { await task.destroy() } catch { /* 已销毁 */ }
    throw err
  }
  try {
    const result: VerifyResult = {
      pdfjsVersion: (pdfjsLib as unknown as { version?: string }).version ?? 'unknown',
      numPages: doc.numPages,
      textByPage: {},
      outline: null,
      pngs: {},
      textItems: {},
      sampleColors: [],
      pageSizes: {},
    }
    // 大纲（书签）
    const outlineRoot = await doc.getOutline()
    if (outlineRoot) {
      const flat: Array<{ title: string; destPageIndex: number | null }> = []
      const walk = async (items: Array<{ title: string; dest?: unknown; items?: unknown[] }>): Promise<void> => {
        for (const item of items) {
          let destPageIndex: number | null = null
          try {
            const dest = typeof item.dest === 'string' ? await doc.getDestination(item.dest as string) : item.dest
            if (Array.isArray(dest)) destPageIndex = (await doc.getPageIndex(dest[0] as never)) + 1
          } catch { /* 无法解析的目标如实置 null */ }
          flat.push({ title: item.title, destPageIndex })
          if (Array.isArray(item.items)) await walk(item.items as Array<{ title: string; dest?: unknown; items?: unknown[] }>)
        }
      }
      await walk(outlineRoot as unknown as Array<{ title: string; dest?: unknown; items?: unknown[] }>)
      result.outline = flat
    }
    // 逐页：尺寸 + 文本
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber)
      const viewport = page.getViewport({ scale: 1 })
      result.pageSizes[pageNumber] = { width: Number(viewport.width.toFixed(2)), height: Number(viewport.height.toFixed(2)) }
      const tc = await page.getTextContent()
      result.textByPage[pageNumber] = tc.items.map((item) => ('str' in item ? item.str : '')).join('')
      if (request.wantTextItems?.includes(pageNumber)) {
        result.textItems[pageNumber] = []
        for (const item of tc.items) {
          if (!('str' in item)) continue
          result.textItems[pageNumber]!.push({
            str: item.str,
            x: Number(item.transform[4].toFixed(2)),
            y: Number(item.transform[5].toFixed(2)),
            w: Number(item.width.toFixed(2)),
            h: Number(item.height.toFixed(2)),
          })
        }
      }
    }
    // 渲染 PNG + 像素采样（采样点依赖已渲染 canvas：未列于 renderPages 的采样页自动补渲染）
    const renderPages = request.renderPages ?? []
    const pagesToRender = [...new Set([...renderPages, ...(request.samplePoints ?? []).map((p) => p.page)])]
    const canvases = new Map<number, { canvas: HTMLCanvasElement }>()
    for (const pageNumber of pagesToRender) {
      const page = await doc.getPage(pageNumber)
      const viewport = page.getViewport({ scale: request.scale ?? 1.5 })
      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, viewport }).promise
      canvases.set(pageNumber, { canvas })
      if (renderPages.includes(pageNumber)) result.pngs[pageNumber] = canvas.toDataURL('image/png')
    }
    for (const point of request.samplePoints ?? []) {
      const entry = canvases.get(point.page)
      if (!entry) { result.sampleColors.push(null); continue }
      const ctx = entry.canvas.getContext('2d', { willReadFrequently: true })!
      const x = Math.min(entry.canvas.width - 1, Math.floor(entry.canvas.width * point.fx))
      const y = Math.min(entry.canvas.height - 1, Math.floor(entry.canvas.height * point.fy))
      const d = ctx.getImageData(x, y, 1, 1).data
      result.sampleColors.push([d[0], d[1], d[2]])
    }
    return result
  } finally {
    await task.destroy()
  }
}

// 挂到全局：宿主经 Runtime.evaluate 调用（awaitPromise + returnByValue）
;(globalThis as unknown as Record<string, unknown>).__vsidianVerifyRun = verifyRun
