// PDF 导出浏览器会话生产实现（T01/#621）：BrowserExportSession 端口的
// 真实链路（PdfExportJob 经端口注入、单测替换）。
//
// 链路与 V01 探针实测一致（§11 实施指令）：launch → createTarget →
// 装配 HTML 写临时文件 → file:// 导航 → 组合就绪信号轮询 → printToPDF →
// Browser.close → 清理临时目录。HTML 经临时文件 + file:// 导航送达
// （data: URL 有长度上限且 opaque origin 有一致性坑，V01 探针全程用文件
// 形态；T01 无页面内 Worker 需求，file:// 页面满足打印语义）。
//
// 错误分态经 PdfExportBrowserError code 上抛（job 映射 launch/navigate/
// not-ready/print 四分态）；取消走 killSync（在途 CDP 命令随连接断开
// 立即 reject——V01 §8 实测）。

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  createPageSession,
  launchHeadlessBrowser,
  navigateAndWaitLoad,
  printToPdf,
  waitForExportReady,
  type LaunchedBrowser,
} from './browserLauncher'
import { PdfExportBrowserError, type BrowserExportSession } from './pdfExportJob'
import type { PdfExportOptions } from '../../shared/pdfExportOptions'

export function createBrowserExportSession(executablePath: string): BrowserExportSession {
  let launched: LaunchedBrowser | undefined
  let pageDir: string | undefined
  let released = false

  const releaseKill = (): void => {
    if (released) return
    released = true
    launched?.killSync()
    if (pageDir) {
      try { rmSync(pageDir, { recursive: true, force: true, maxRetries: 3 }) } catch { /* 尽力 */ }
      pageDir = undefined
    }
  }

  const releaseGraceful = async (): Promise<void> => {
    if (released) return
    released = true
    if (launched) {
      try { await launched.close() } catch { launched.killSync() }
      launched = undefined
    }
    if (pageDir) {
      try { rmSync(pageDir, { recursive: true, force: true, maxRetries: 3 }) } catch { /* 尽力 */ }
      pageDir = undefined
    }
  }

  return {
    async exportPdf(input: { html: string; options: PdfExportOptions }): Promise<Buffer> {
      try {
        try {
          launched = await launchHeadlessBrowser({ executablePath })
        } catch (error) {
          throw new PdfExportBrowserError('launch', `浏览器启动失败：${error instanceof Error ? error.message : String(error)}`)
        }
        let session
        try {
          session = await createPageSession(launched.connection)
        } catch (error) {
          throw new PdfExportBrowserError('launch', `页面会话建立失败：${error instanceof Error ? error.message : String(error)}`)
        }
        // 装配 HTML 落临时文件（命名进 mkdtemp 目录，结束后整体清理）
        pageDir = mkdtempSync(path.join(tmpdir(), 'vsidian-pdfexport-page-'))
        const htmlPath = path.join(pageDir, 'export.html')
        writeFileSync(htmlPath, input.html, 'utf8')
        const fileUrl = pathToFileURL(htmlPath).href
        try {
          await navigateAndWaitLoad(session.session, fileUrl)
        } catch (error) {
          throw new PdfExportBrowserError('navigate', `导出页导航失败：${error instanceof Error ? error.message : String(error)}`)
        }
        const ready = await waitForExportReady(session.session)
        if (!ready.ok) {
          throw new PdfExportBrowserError('not-ready',
            `导出页未在限定时间内就绪（asyncReady=${ready.state.asyncReady} fonts=${ready.state.fontsStatus} 等待 ${ready.waitedMs}ms）`)
        }
        try {
          const bytes = await printToPdf(session.session, input.options)
          await releaseGraceful()
          return bytes
        } catch (error) {
          if (error instanceof PdfExportBrowserError) throw error
          throw new PdfExportBrowserError('print', `printToPDF 失败：${error instanceof Error ? error.message : String(error)}`)
        }
      } finally {
        // 成功路径已在上方优雅释放；失败/取消路径强杀收尾（幂等）
        releaseKill()
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
