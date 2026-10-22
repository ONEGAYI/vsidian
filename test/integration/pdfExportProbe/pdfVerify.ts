// #619（V01）PDF 导出探针 · 宿主侧产物验证驱动。
// 在被测浏览器里维护一个专用验证 target。关键约束：验证页面必须具备
// http(s) origin——about:blank 的 opaque origin 下 Blob URL 无法承载
// Worker，PDF.js 会回退 fake worker 并失败（探针实测）。因此宿主起一个
// 仅绑 127.0.0.1 随机端口的微型资源服务，供验证页面加载 verify.js 与
// verifyWorker.js；PDF 字节经 Runtime.evaluate 传入，取回页数 / 逐页
// 文本 / 大纲 / PNG dataURL / 文本几何 / 像素采样。
// 产物验证因此发生在「宿主 Node 18 spawn 的浏览器」内——pdfjs-dist 的
// engines.node>=22 声明只约束 Node 侧使用，页面侧无此限制。
// 本文件是探针代码（研究票产物），不进 VSIX，不定义产品行为。

import { createServer, type Server } from 'node:http'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { CdpConnection, CdpSession } from './cdpClient'
import { evaluate } from './browser'
import type { VerifyRequest, VerifyResult } from './verifyEntry'

export class PdfVerifier {
  private httpServer: Server | null = null
  private constructor(readonly session: CdpSession, private targetId: string) {}

  /** 起资源服务（verifyJsPath：out 下 iife 产物路径）并创建验证页面。 */
  static async create(connection: CdpConnection, verifyJsPath: string): Promise<PdfVerifier> {
    const verifyDir = path.dirname(verifyJsPath)
    const assets: Record<string, { body: Buffer; type: string }> = {
      '/verify.js': { body: readFileSync(path.join(verifyDir, 'verify.js')), type: 'text/javascript; charset=utf-8' },
      '/verifyWorker.js': { body: readFileSync(path.join(verifyDir, 'verifyWorker.js')), type: 'text/javascript; charset=utf-8' },
    }
    const server = createServer((request, response) => {
      const url = (request.url ?? '/').split('?')[0]
      if (url === '/') {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        response.end('<!DOCTYPE html><html><head><meta charset="utf-8"><title>verify</title>'
          + '<script src="/verify.js"></script></head><body>pdf.js verify host</body></html>')
        return
      }
      const asset = assets[url]
      if (asset) {
        response.writeHead(200, { 'content-type': asset.type })
        response.end(asset.body)
        return
      }
      response.writeHead(404)
      response.end('not found')
    })
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port))
    })
    try {
      const target = await connection.send('Target.createTarget', { url: `http://127.0.0.1:${port}/` })
      const attached = await connection.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })
      const session = new CdpSession(connection, attached.sessionId as string)
      await session.send('Page.enable')
      await session.send('Runtime.enable')
      // verify.js 由页面 <script> 加载（同源静态资源），等待全局函数就绪
      const startedAt = Date.now()
      for (;;) {
        const ready = await evaluate<boolean>(session, 'typeof window.__vsidianVerifyRun === "function"')
        if (ready) break
        if (Date.now() - startedAt > 10_000) throw new Error('验证页面 10s 内未见 __vsidianVerifyRun（verify.js 装载失败）')
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      const verifier = new PdfVerifier(session, target.targetId as string)
      verifier.httpServer = server
      return verifier
    } catch (error) {
      server.close()
      throw error
    }
  }

  async verify(pdf: Buffer, options: Omit<VerifyRequest, 'pdfBase64'> = {}): Promise<VerifyResult> {
    // 每次验证前前台化：printToPDF 会把被打印 target 顶回前台，此后非前台
    // target 的 canvas 光栅化被 Chromium 挂起（探针实测：渲染 await 永不
    // 完成，文本提取不受影响）——create 时机的一次性 bringToFront 不够
    await this.session.send('Page.bringToFront')
    const request: VerifyRequest = { pdfBase64: pdf.toString('base64'), ...options }
    return evaluate<VerifyResult>(this.session,
      `window.__vsidianVerifyRun(${JSON.stringify(request)})`,
      { awaitPromise: true })
  }

  dispose(): void {
    void this.session.send('Target.closeTarget', { targetId: this.targetId }).catch(() => { /* 浏览器侧关闭兜底 */ })
    this.httpServer?.close()
  }
}
