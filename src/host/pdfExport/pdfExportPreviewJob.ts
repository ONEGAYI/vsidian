// PDF 导出预览任务执行器（T07/#627）：独立预览任务——与导出同一
// createBrowserExportSession 管线产出字节（renderPage → finalizePrint），
// 但不弹保存对话框、不落盘；缺资源不等待用户选择（预览是只读核对面——
// 页面侧保留可见降级说明，失败清单如实进结果由模态呈现）。
//
// 与三个导出 job 的分工（统一代次模型的宿主侧落点）：
// - 既有 PdfExportJob/PdfBatchJob/PdfMergeJob 的状态面不动（合并/批量 job
//   不补 generation 字段）；预览的代次、迟到丢弃与会话重置由模态会话层
//   （pdfExportModal）统一持有——「新一轮 run 重置」语义在会话层实现；
// - 本 job 只承担串行执行与配对释放：一次一任务（busy 拒绝）、cancel/
//   dispose 强杀、finally 释放（V01 §8 / P3-02 生命周期纪律——失败装载
//   也 destroy）。
//
// 纯逻辑可单测：浏览器链路经 BrowserExportSession 端口注入替身。

import {
  mapBrowserErrorToFailReason,
  type BrowserExportSession,
  type PdfBookmarkReport,
  type PdfExportFailReason,
  type PdfExportInputPayload,
} from './pdfExportJob'
import type { ResolveBrowserResult } from './browserFind'
import type { PdfExportFailureItem } from '../../shared/pdfExportPayload'
import type { PdfExportOptions } from '../../shared/pdfExportOptions'

export interface PdfPreviewJobPorts {
  resolveBrowser(configuredPath: string | undefined): Promise<ResolveBrowserResult>
  createSession(executablePath: string): BrowserExportSession
  /** UI 语言（payload.locale 装配） */
  locale(): 'zh-cn' | 'en'
}

export interface PdfPreviewRunRequest {
  /** 固定输入（模态会话层新的一轮捕获——本 job 不捕获） */
  payload: PdfExportInputPayload
  options: PdfExportOptions
  browserPath: string | undefined
}

export type PdfPreviewFailReason = 'busy' | 'cancelled' | PdfExportFailReason

export type PdfPreviewRunResult =
  | {
      ok: true
      bytes: Buffer
      bookmarks: PdfBookmarkReport
      /** renderPage 的缺资源清单（预览已自动继续——正文含可见降级说明） */
      failures: PdfExportFailureItem[]
    }
  | { ok: false; reason: PdfPreviewFailReason; detail?: string }

export class PdfPreviewJob {
  private running = false
  private cancelRequested = false
  private activeSession: BrowserExportSession | undefined

  constructor(private readonly ports: PdfPreviewJobPorts) {}

  get isRunning(): boolean {
    return this.running
  }

  /** 取消进行中的预览（幂等）：强杀浏览器链路，run 以 cancelled 收口 */
  cancel(): void {
    if (!this.running || this.cancelRequested) return
    this.cancelRequested = true
    this.activeSession?.cancel()
  }

  /** 释放兜底（模态关闭/导出让位时调用） */
  dispose(): void {
    this.cancel()
  }

  /** 执行一次预览生成。串行：进行中再发起返回 busy。 */
  async run(request: PdfPreviewRunRequest): Promise<PdfPreviewRunResult> {
    if (this.running) {
      return { ok: false, reason: 'busy' }
    }
    this.running = true
    this.cancelRequested = false
    try {
      const resolved = await this.ports.resolveBrowser(request.browserPath)
      if (!resolved.ok) {
        return { ok: false, reason: resolved.reason }
      }
      const session = this.ports.createSession(resolved.browser.executablePath)
      this.activeSession = session
      if (this.cancelRequested) {
        // 会话建立前已请求取消（模态关闭/导出让位的竞态窗口）：复投取消，
        // 不进入 renderPage（挂起态无人再杀）
        session.dispose()
        return { ok: false, reason: 'cancelled' }
      }
      try {
        const rendered = await session.renderPage({
          payload: { ...request.payload, mermaidUri: '', resBase: '', locale: this.ports.locale() },
          options: request.options,
        })
        if (this.cancelRequested) {
          return { ok: false, reason: 'cancelled' }
        }
        // 缺资源不等待用户选择：预览自动继续（页面降级说明保留在场），
        // failures 如实随结果上报——最终导出仍按导出 job 语义暂停问询
        const printed = await session.finalizePrint(request.options)
        if (this.cancelRequested) {
          return { ok: false, reason: 'cancelled' }
        }
        return { ok: true, bytes: printed.bytes, bookmarks: printed.bookmarks, failures: rendered.failures }
      } finally {
        session.dispose()
      }
    } catch (error) {
      if (this.cancelRequested) {
        return { ok: false, reason: 'cancelled' }
      }
      return {
        ok: false,
        reason: mapBrowserErrorToFailReason(error),
        detail: error instanceof Error ? error.message : String(error),
      }
    } finally {
      this.running = false
      this.activeSession = undefined
    }
  }
}
