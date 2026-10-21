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
  readHeadingMarks,
  waitForExportReady,
  withTimeout,
  type LaunchedBrowser,
} from './browserLauncher'
import { startExportResourceServer, type ExportResourceResolvePort, type ExportResourceServer } from './exportResourceServer'
import { buildPdfExportPageHtml } from './pdfExportPage'
import { PdfExportBrowserError, type BrowserExportSession, type PdfBookmarkReport } from './pdfExportJob'
import { extractPdfPageTexts } from './pdfOutlineFlow'
import { writePdfOutline } from './pdfOutlineWrite'
import { locateHeadingsInPages, locateMergeHeadingsInPages, mergeOutlineEntries, outlineEntriesOf, type PdfHeadingMark, type PdfOutlineEntry } from '../../shared/pdfOutline'
import { t } from '../../shared/i18n'
import type { PdfExportFailureItem, PdfExportPagePayload, PdfExportReadyState } from '../../shared/pdfExportPayload'
import type { PdfExportOptions, PdfHeaderFooterContext } from '../../shared/pdfExportOptions'

export interface CreateBrowserExportSessionDeps {
  /** 产物根（extensionUri/out/webview——静态产物与资产的服务目录） */
  outWebviewDir: string
  /** 资源解析端口（classifyImageTarget + stat 的 http 化；provider 注入） */
  resourceResolve: ExportResourceResolvePort
  /** 装配导出页 HTML 观测点（模态 lastHtml / 集成断言；可空） */
  onPageAssembled?: (html: string) => void
  /** 就绪后整页截图观测点（视觉证据 PNG——测试钩子装配；可空） */
  onPageSnapshot?: (pngBase64: string) => void
  /**
   * T08/#628 页码词条覆盖（远端会话）：PDF 页脚文案须跟远端 UI 语言，
   * 而本会话在 remote 下跑在本机执行端（其 locale 可能不同）——远端
   * 适配器按自身 locale 取 t() 后传入。缺省（本地会话）直接用本进程 t()。
   */
  pageLabel?: { pre: string; mid: string; post: string }
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
  /** T05：renderPage 捕获的页眉页脚上下文 + 标题埋点（finalizePrint 消费） */
  let hfContext: PdfHeaderFooterContext | undefined
  let headingMarks: PdfHeadingMark[] = []
  /** T06（#626）：合并导出的书签元数据（篇名序列 + 每篇另起一页——
   *  finalizePrint 按篇分段定位与子树拼接消费；单文档导出 undefined） */
  let mergeMeta: { docNames: readonly string[]; pageBreak: boolean } | undefined

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
      headings: PdfHeadingMark[]
    }> {
      if (released) throw new PdfExportBrowserError('launch', 'session already released (duplicate renderPage)')
      try {
        try {
          launched = await launchHeadlessBrowser({ executablePath })
        } catch (error) {
          throw new PdfExportBrowserError('launch', `browser launch failed: ${error instanceof Error ? error.message : String(error)}`)
        }
        try {
          server = await startExportResourceServer(deps.outWebviewDir, deps.resourceResolve)
        } catch (error) {
          throw new PdfExportBrowserError('launch', `export resource server failed to start: ${error instanceof Error ? error.message : String(error)}`)
        }
        let session
        try {
          session = await createPageSession(launched.connection)
        } catch (error) {
          throw new PdfExportBrowserError('launch', `page session setup failed: ${error instanceof Error ? error.message : String(error)}`)
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
          throw new PdfExportBrowserError('navigate', `export page navigation failed: ${error instanceof Error ? error.message : String(error)}`)
        }
        const ready = await waitForExportReady(session.session)
        if (!ready.ok) {
          throw new PdfExportBrowserError('not-ready',
            `导出页未在限定时间内就绪（asyncReady=${ready.state.asyncReady} assembled=${ready.state.assembled} images=${ready.state.images} graphics=${ready.state.graphics} fonts=${ready.state.fontsStatus} 等待 ${ready.waitedMs}ms）`)
        }
        const failures = await readExportFailures(session.session)
        // T05（#625）：标题埋点拉取（书签数据面——DOM 文档序）+ 页眉页脚
        // 上下文捕获（docTitle/dark/页码词条；dateText 取打印时刻——见
        // finalizePrint）
        try {
          headingMarks = await readHeadingMarks(session.session)
        } catch { headingMarks = [] } // 埋点拉取失败：书签链路如实降级（finalizePrint 报告）
        // T06（#626）：合并书签元数据（篇名序列去扩展名——与页眉标题同源）
        if (input.payload.merge !== undefined) {
          mergeMeta = {
            docNames: input.payload.merge.docs.map((entry) => entry.doc.docName.replace(/\.(md|markdown)$/i, '')),
            pageBreak: input.payload.merge.pageBreak,
          }
        } else {
          mergeMeta = undefined
        }
        hfContext = {
          docTitle: (input.payload.docs[0]?.docName ?? 'document').replace(/\.md$/i, ''),
          dateText: '',
          dark: input.payload.style.dark,
          pageLabel: deps.pageLabel ?? {
            pre: t('pdfExport.pageNumber.pre'),
            mid: t('pdfExport.pageNumber.mid'),
            post: t('pdfExport.pageNumber.post'),
          },
        }
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
          headings: headingMarks,
        }
      } catch (error) {
        // 失败路径强杀收尾（幂等）；成功路径页面保留待 finalizePrint
        releaseKill()
        throw error
      }
    },

    async finalizePrint(options: PdfExportOptions): Promise<{ bytes: Buffer; bookmarks: PdfBookmarkReport }> {
      if (!pageRendered || released || !launched || !pageSession) {
        throw new PdfExportBrowserError('print', 'page not ready (finalizePrint requires a successful renderPage)')
      }
      const session = pageSession
      try {
        // printToPDF 前前台化：被打印 target 须在前台（V01 §10.2 光栅化挂起
        // 坑的防御——headless 下为幂等防御位）
        await session.send('Page.bringToFront').catch(() => undefined)
        // T05：页眉页脚上下文（dateText 取打印时刻；renderPage 未捕获时
        // undefined——与开关全关等价，参数面仍由 options 主导）
        const now = new Date()
        const dateText = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
        const hf = hfContext !== undefined ? { ...hfContext, dateText } : undefined
        const printed = await printToPdf(session, options, hf)
        // T05（#625）：标题书签后处理——打印产物 → 浏览器侧 pdfjs 逐页文本
        //（locate target，只 getTextContent 不受光栅化挂起影响）→ 宿主游标
        // 匹配 → pdf-lib 写 /Outlines。任何失败整份不加书签并如实报告
        //（不伪造）；部分标题定位失败跳过该条。浏览器与服务在书签链路
        // 完成后才释放（定位 target 需要 server 供给 pdfMain/worker）。
        // T06（#626）：合并产物按篇分段定位（游标重置 + 篇首下界）并以
        // 文档名顶级拼接条目流——写入层与单文档共用 writePdfOutline。
        let bookmarks: PdfBookmarkReport = { written: false, total: headingMarks.length, skipped: 0, reason: 'disabled' }
        let bytes = printed
        if (options.bookmarksEnabled) {
          if (headingMarks.length === 0) {
            bookmarks = { written: false, total: 0, skipped: 0, reason: 'no-headings' }
          } else {
            try {
              const pageTexts = await extractPdfPageTexts(launched.connection, server!.baseUrl, printed)
              let entries: PdfOutlineEntry[]
              /** 与埋点同口径的条目数（skipped 计算基数——合并流的文档名
               *  顶级条目不是埋点标题，不计入） */
              let headingEntryCount: number
              if (mergeMeta !== undefined) {
                // 合并：埋点按篇分段（无篇标记的防御归 0），逐篇定位后拼接
                const groups: PdfHeadingMark[][] = mergeMeta.docNames.map(() => [])
                for (const mark of headingMarks) {
                  const index = Math.max(0, Math.min(mark.docIndex ?? 0, groups.length - 1))
                  groups[index]!.push(mark)
                }
                const located = locateMergeHeadingsInPages(
                  groups.map((marks) => ({ marks })),
                  pageTexts,
                  mergeMeta.pageBreak,
                )
                entries = mergeOutlineEntries(located.map((docLocated, index) => ({
                  docName: mergeMeta!.docNames[index]!,
                  entries: outlineEntriesOf(docLocated),
                })))
                headingEntryCount = entries.filter((entry) => entry.level > 1).length
              } else {
                const located = locateHeadingsInPages(headingMarks, pageTexts)
                entries = outlineEntriesOf(located)
                headingEntryCount = entries.length
              }
              bookmarks = {
                written: entries.length > 0,
                total: headingMarks.length,
                skipped: headingMarks.length - headingEntryCount,
                ...(entries.length === 0 ? { reason: 'none-located' as const } : {}),
              }
              if (entries.length > 0) {
                bytes = Buffer.from(await writePdfOutline(printed, entries))
              }
            } catch (error) {
              bookmarks = {
                written: false,
                total: headingMarks.length,
                skipped: headingMarks.length,
                reason: 'locate-failed',
                detail: error instanceof Error ? error.message : String(error),
              }
            }
          }
        }
        await releaseGraceful()
        return { bytes, bookmarks }
      } catch (error) {
        releaseKill()
        if (error instanceof PdfExportBrowserError) throw error
        throw new PdfExportBrowserError('print', `printToPDF failed: ${error instanceof Error ? error.message : String(error)}`)
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
