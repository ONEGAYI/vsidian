// PDF 书签页码定位编排（T05/#625）：打印产物 → 浏览器侧 pdfjs 逐页文本
// 提取 → 宿主游标匹配（shared/pdfOutline）。
//
// 文本提取跑在导出浏览器的独立 target（locate.html——exportResourceServer
// 追加路由，装载 #337 随包 pdfMain.js；worker 经 fetch→Blob→objectURL，
// http origin 下合法——V01 §10.1 opaque origin 坑）。只用 getTextContent：
// 不受非前台 target 光栅化挂起影响（V01 §10.2 实测「文本提取不受影响」），
// 无需 bringToFront。任何失败上抛——调用方（session）降级为整份不加书签
// 并如实记录，不伪造。
//
// pdfjs 引擎取自 VSIX 已随包产物（#337 决策），宿主 Node 侧零新增依赖。

import {
  createPageSession,
  evaluate,
  navigateAndWaitLoad,
  withTimeout,
} from './browserLauncher'
import type { CdpConnection } from './cdpClient'

/** 页内提取函数的宿主侧装配（JSON 序列化参数内联；awaitPromise 求值）。
 *  cMaps/standardFonts 经同源静态资产（out/webview/pdfjs/——#337 复制面）：
 *  Chromium 产物带 ToUnicode 时不需要 cmaps，配置为保险面（无 ToUnicode
 *  的 CID 文本仍可提取）。 */
function locateExpression(pdfBase64: string, cMapUrl: string, standardFontDataUrl: string): string {
  return `(async () => {
    const pdfjs = globalThis.__vsidianPdfjs
    if (!pdfjs) throw new Error('pdfjs 未装载（pdfMain.js 装载失败）')
    const workerRes = await fetch('pdfWorker.js')
    if (!workerRes.ok) throw new Error('pdfWorker.js fetch 失败：' + workerRes.status)
    const workerBlob = new Blob([await workerRes.text()], { type: 'text/javascript' })
    const workerUrl = URL.createObjectURL(workerBlob)
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
    const binary = atob(${JSON.stringify(pdfBase64)})
    const data = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i)
    const task = pdfjs.getDocument({
      data,
      cMapUrl: ${JSON.stringify(cMapUrl)},
      cMapPacked: true,
      standardFontDataUrl: ${JSON.stringify(standardFontDataUrl)},
    })
    const doc = await task.promise
    try {
      const pages = []
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i)
        const content = await page.getTextContent()
        pages.push(content.items.map((item) => 'str' in item ? item.str : '').join(''))
      }
      return pages
    } finally {
      await task.destroy()
      URL.revokeObjectURL(workerUrl)
    }
  })()`
}

/** 逐页文本提取：新 target → locate.html → 等引擎就绪 → 提取 → 关 target。
 *  返回每页拼接文本（0 起索引与 pageIndex 对齐；归一与匹配在宿主
 *  locateHeadingsInPages）。 */
export async function extractPdfPageTexts(
  connection: CdpConnection,
  baseUrl: string,
  pdfBytes: Uint8Array,
  timeoutMs = 60_000,
): Promise<string[]> {
  const { session, targetId } = await createPageSession(connection)
  try {
    await navigateAndWaitLoad(session, `${baseUrl}/locate.html`)
    // 引擎就绪轮询（pdfMain.js 装载 + 全局挂载，10s 上限——探针同口径）
    const startedAt = Date.now()
    for (;;) {
      const ready = await evaluate<boolean>(session, 'typeof globalThis.__vsidianPdfjs === "object" && globalThis.__vsidianPdfjs !== null')
      if (ready) break
      if (Date.now() - startedAt > 10_000) {
        throw new Error('定位页 10s 内未见 __vsidianPdfjs（pdfMain.js 装载失败）')
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    const pages = await withTimeout(
      evaluate<string[]>(
        session,
        locateExpression(
          Buffer.from(pdfBytes).toString('base64'),
          `${baseUrl}/pdfjs/cmaps/`,
          `${baseUrl}/pdfjs/standard_fonts/`,
        ),
        { awaitPromise: true, timeoutMs },
      ),
      timeoutMs,
      'pdfjs getTextContent extraction',
    )
    if (!Array.isArray(pages) || pages.some((text) => typeof text !== 'string')) {
      throw new Error('提取返回形态非法（非字符串数组——不给伪造页码）')
    }
    return pages
  } finally {
    await connection.send('Target.closeTarget', { targetId }).catch(() => undefined)
  }
}
