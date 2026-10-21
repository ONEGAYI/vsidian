// PDF 导出浏览器会话生产实现（T01/#621 建立，T02/#622 升级 http 页面）。
//
// 链路（V01 探针实测 + T02 页面内 Reading 管线）：
// renderPage：launch → 起微型资源服务（127.0.0.1 随机端口 + token 根）→
//   骨架页 HTML 进服务内存 → http 导航（opaque origin 坑的结构性规避，
//   V01 §10.1）→ 组合就绪信号轮询 → 拉取页面失败清单。页面保留在场。
// finalizePrint：printToPDF → 优雅释放（Browser.close + 服务关闭）。
// cancel/dispose：killSync 强杀 + 服务关闭（幂等；在途 CDP 命令随连接
// 断开立即 reject——V01 §8）。
//
// 错误分态经 PdfExportBrowserError code 上抛（job 映射 launch/navigate/
// not-ready/print 四分态）；临时 HTML 文件形态退役（T01）——页面由服务
// 直供，无临时目录。

import {
  createPageSession,
  launchHeadlessBrowser,
  navigateAndWaitLoad,
  printToPdf,
  readExportFailures,
  waitForExportReady,
  withTimeout,
  type LaunchedBrowser,
} from './browserLauncher'
import { startExportResourceServer, type ExportResourceResolvePort, type ExportResourceServer } from './exportResourceServer'
import { buildPdfExportPageHtml } from './pdfExportPage'
import { PdfExportBrowserError, type BrowserExportSession } from './pdfExportJob'
import type { PdfExportFailureItem, PdfExportPagePayload, PdfExportReadyState } from '../../shared/pdfExportPayload'
import type { PdfExportOptions } from '../../shared/pdfExportOptions'

export interface CreateBrowserExportSessionDeps {
  /** 产物根（extensionUri/out/webview——静态产物与资产的服务目录） */
  outWebviewDir: string
  /** 资源解析端口（classifyImageTarget + stat 的 http 化；provider 注入） */
  resourceResolve: ExportResourceResolvePort
  /** 装配导出页 HTML 观测点（模态 lastHtml / 集成断言；可空） */
  onPageAssembled?: (html: string) => void
  /** 就绪后整页截图观测点（视觉证据 PNG——测试钩子装配；可空） */
  onPageSnapshot?: (pngBase64: string) => void
}

export function createBrowserExportSession(
  executablePath: string,
  deps: CreateBrowserExportSessionDeps,
): BrowserExportSession {
  let launched: LaunchedBrowser | undefined
  let server: ExportResourceServer | undefined
  let pageSession: Awaited<ReturnType<typeof createPageSession>>['session'] | undefined
  let released = false
  let pageRendered = false

  const releaseKill = (): void => {
    if (released) return
    released = true
    launched?.killSync()
    server?.close()
    server = undefined
  }

  const releaseGraceful = async (): Promise<void> => {
    if (released) return
    released = true
    if (launched) {
      try { await launched.close() } catch { launched.killSync() }
      launched = undefined
    }
    server?.close()
    server = undefined
  }

  return {
    async renderPage(input: { payload: PdfExportPagePayload; options: PdfExportOptions }): Promise<{
      ready: boolean
      readyState: PdfExportReadyState
      failures: PdfExportFailureItem[]
    }> {
      if (released) throw new PdfExportBrowserError('launch', '会话已释放（重复 renderPage）')
      try {
        try {
          launched = await launchHeadlessBrowser({ executablePath })
        } catch (error) {
          throw new PdfExportBrowserError('launch', `浏览器启动失败：${error instanceof Error ? error.message : String(error)}`)
        }
        try {
          server = await startExportResourceServer(deps.outWebviewDir, deps.resourceResolve)
        } catch (error) {
          throw new PdfExportBrowserError('launch', `导出资源服务启动失败：${error instanceof Error ? error.message : String(error)}`)
        }
        let session
        try {
          session = await createPageSession(launched.connection)
        } catch (error) {
          throw new PdfExportBrowserError('launch', `页面会话建立失败：${error instanceof Error ? error.message : String(error)}`)
        }
        pageSession = session.session
        const pageUrl = `${server.baseUrl}/export.html`
        const pageHtml = buildPdfExportPageHtml({
          payload: {
            ...input.payload,
            mermaidUri: `${server.baseUrl}/mermaid.js`,
            resBase: `${server.baseUrl}/res`,
          },
          options: input.options,
          scriptSrc: `${server.baseUrl}/pdfExportPage.js`,
          styleHref: `${server.baseUrl}/pdfExportPage.css`,
        })
        deps.onPageAssembled?.(pageHtml)
        server.setExportPage(pageHtml)
        try {
          await navigateAndWaitLoad(session.session, pageUrl)
        } catch (error) {
          throw new PdfExportBrowserError('navigate', `导出页导航失败：${error instanceof Error ? error.message : String(error)}`)
        }
        const ready = await waitForExportReady(session.session)
        if (!ready.ok) {
          throw new PdfExportBrowserError('not-ready',
            `导出页未在限定时间内就绪（asyncReady=${ready.state.asyncReady} fonts=${ready.state.fontsStatus} 等待 ${ready.waitedMs}ms）`)
        }
        const failures = await readExportFailures(session.session)
        pageRendered = true
        if (deps.onPageSnapshot !== undefined) {
          // 视觉证据：就绪后的整页截图（probe 后、打印前——正文/图片/图形
          // 的绘制层呈现；集成测试落盘 PNG 供人工/读图核验）
          try {
            const shot = await withTimeout(session.session.send('Page.captureScreenshot', {
              format: 'png',
              captureBeyondViewport: true,
            }), 15_000, 'Page.captureScreenshot') as unknown as { data: string }
            deps.onPageSnapshot(shot.data)
          } catch { /* 截图失败不构成导出失败 */ }
        }
        return {
          ready: true,
          readyState: {
            assembled: ready.state.assembled ?? ready.state.asyncReady,
            images: ready.state.images ?? true,
            graphics: ready.state.graphics ?? true,
            fonts: ready.state.fontsStatus,
            asyncReady: ready.state.asyncReady,
            failures,
          },
          failures,
        }
      } catch (error) {
        // 失败路径强杀收尾（幂等）；成功路径页面保留待 finalizePrint
        releaseKill()
        throw error
      }
    },

    async finalizePrint(options: PdfExportOptions): Promise<Buffer> {
      if (!pageRendered || released || !launched || !pageSession) {
        throw new PdfExportBrowserError('print', '页面未就绪（finalizePrint 前置 renderPage 未成功）')
      }
      const session = pageSession
      try {
        // printToPDF 前前台化：被打印 target 须在前台（V01 §10.2 光栅化挂起
        // 坑的防御——headless 下为幂等防御位）
        await session.send('Page.bringToFront').catch(() => undefined)
        const bytes = await printToPdf(session, options)
        await releaseGraceful()
        return bytes
      } catch (error) {
        releaseKill()
        if (error instanceof PdfExportBrowserError) throw error
        throw new PdfExportBrowserError('print', `printToPDF 失败：${error instanceof Error ? error.message : String(error)}`)
      }
    },

    cancel(): void {
      releaseKill()
    },
    dispose(): void {
      releaseKill()
    },
  }
}
