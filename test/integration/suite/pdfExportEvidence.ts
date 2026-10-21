// PDF 导出集成用例共享的证据提取（pdfjs-dist legacy，node 侧）：逐页文本 +
// 页数 + 首页几何 + 图像 XObject 计数（本地图以位图入版的绘制层证据）。
// T02（#622）建立；T03（#623）起共用——不复制第二份提取实现。
import type { Buffer } from 'node:buffer'

export interface PdfEvidence {
  pages: string[]
  pageCount: number
  widthPt: number
  heightPt: number
  imageXObjectCount: number
}

export async function extractPdfEvidence(bytes: Buffer): Promise<PdfEvidence> {
  if (typeof (Promise as unknown as { withResolvers?: unknown }).withResolvers !== 'function') {
    ;(Promise as unknown as { withResolvers: () => unknown }).withResolvers = function withResolvers() {
      let resolve!: (value: unknown) => void
      let reject!: (reason?: unknown) => void
      const promise = new Promise((res, rej) => { resolve = res; reject = rej })
      return { promise, resolve, reject }
    }
  }
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const { createRequire } = await import('node:module')
  const { pathToFileURL } = await import('node:url')
  const workerPath = createRequire(__filename).resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise
  const pages: string[] = []
  let imageXObjectCount = 0
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    pages.push(content.items.map((item) => 'str' in item ? item.str : '').join(''))
    const ops = await page.getOperatorList()
    for (const fn of ops.fnArray) {
      if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject) {
        imageXObjectCount += 1
      }
    }
  }
  const first = await doc.getPage(1)
  const viewport = first.getViewport({ scale: 1 })
  return { pages, pageCount: doc.numPages, widthPt: viewport.width, heightPt: viewport.height, imageXObjectCount }
}
