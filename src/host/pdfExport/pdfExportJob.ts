// PDF 导出任务编排（T01/#621）：一次导出的状态机、代次与资源配对释放。
//
// 纯逻辑可单测：浏览器链路经 BrowserExportSession 端口注入（生产实现
// createBrowserExportSession：launch → 临时 HTML → file:// 导航 → 组合就绪
// 信号 → printToPDF → close → 清理临时目录；探针 V01 已实测的链路），
// 文件系统与保存对话框经 ports 注入（vscode 层装配）。
//
// 语义（规格 §2.5 任务结果与释放）：
// - 代次（generation）单调递增，新旧任务以真实代次区分（§2.4）；
// - 取消：killSync 等价路径打断在途命令（悬挂命令立即 reject，V01 §8），
//   已取消任务不落盘（未完成产物不得伪装成成功 PDF）；
// - 保存对话框在生成完成后弹出，用户取消即本次任务取消（产物丢弃）；
// - 每次任务的浏览器会话在 finally 释放（成功路径 exportPdf 内部已
//   Browser.close；dispose 幂等兜底失败路径）。

import { buildPdfExportHtml } from './pdfExportHtml'
import type { ResolveBrowserResult } from './browserFind'
import type { PdfExportOptions } from '../../shared/pdfExportOptions'

export type PdfExportPhase = 'idle' | 'generating' | 'saving' | 'done' | 'failed' | 'cancelled'

export type PdfExportFailReason =
  | 'no-browser'
  | 'configured-path-missing'
  | 'launch-failed'
  | 'navigate-failed'
  | 'not-ready'
  | 'print-failed'
  | 'write-failed'
  | 'busy'
  | 'internal'

/** 固定输入（规格 §2.1：准备阶段确定本次使用的版本） */
export interface PdfExportInput {
  /** 文档显示名（文件名，含扩展名） */
  docName: string
  /** 固定输入的 Markdown 正文（LF 坐标；打开模态时刻的权威文本快照） */
  markdown: string
  /** 固定时刻权威版本（观测面：供断言「生成期间后续编辑不混入」） */
  capturedVersion: number
  /** 阅读样式快照（T01 骨架：T02 接完整阅读样式） */
  readingStyleSnapshot: Record<string, unknown>
}

/** 浏览器链路错误码（生产 session 抛出，job 映射失败分态） */
export class PdfExportBrowserError extends Error {
  constructor(readonly code: 'launch' | 'navigate' | 'not-ready' | 'print', message: string) {
    super(message)
    this.name = 'PdfExportBrowserError'
  }
}

/** 单次导出的浏览器会话端口（生产 createBrowserExportSession 实现） */
export interface BrowserExportSession {
  /** 生成 PDF 字节（完成后浏览器已释放；失败时内部尽力释放） */
  exportPdf(input: { html: string; options: PdfExportOptions }): Promise<Buffer>
  /** 用户取消：强杀进程树并清理（在途 exportPdf 随连接断开 reject） */
  cancel(): void
  /** 幂等兜底释放（exportPdf 成功/失败后调用均安全） */
  dispose(): void
}

export interface PdfExportJobPorts {
  resolveBrowser(configuredPath: string | undefined): Promise<ResolveBrowserResult>
  createSession(executablePath: string): BrowserExportSession
  /** 保存对话框：返回目标路径（宿主层字符串形态），undefined = 用户取消 */
  showSaveDialog(defaultFileName: string): Promise<string | undefined>
  writeFile(targetPath: string, bytes: Uint8Array): Promise<void>
  /** 装配 HTML 观测点（VSIDIAN_TEST_HOOKS 集成断言用；生产可空实现） */
  onHtmlAssembled?: (html: string) => void
}

export interface PdfExportJobState {
  phase: PdfExportPhase
  generation: number
  docName?: string
  failReason?: PdfExportFailReason
  /** 失败的原始错误信息（诊断观测面；不进用户文案） */
  failDetail?: string
  /** cancelled 终态的细分（用户主动取消 / 保存对话框取消） */
  cancelKind?: 'user' | 'save-dialog'
  savedPath?: string
}

export interface PdfExportRunResult {
  ok: boolean
  kind: 'done' | 'failed' | 'cancelled' | 'busy'
  state: PdfExportJobState
  bytes?: Buffer
}

export class PdfExportJob {
  private generation = 0
  private activeSession: BrowserExportSession | undefined
  private running = false
  private cancelRequested = false
  private _state: PdfExportJobState = { phase: 'idle', generation: 0 }
  onStateChange?: (state: PdfExportJobState) => void

  constructor(private readonly ports: PdfExportJobPorts) {}

  get state(): PdfExportJobState {
    return this._state
  }

  private setState(next: Partial<PdfExportJobState> & { phase: PdfExportPhase }): void {
    this._state = { ...this._state, ...next }
    this.onStateChange?.(this._state)
  }

  get isRunning(): boolean {
    return this.running
  }

  /** 取消进行中的任务（幂等；对未运行任务无副作用） */
  cancel(): void {
    if (!this.running) return
    this.cancelRequested = true
    this.activeSession?.cancel()
  }

  /** 执行一次导出。任务串行：进行中再发起返回 busy（模态防重入）。 */
  async run(
    input: PdfExportInput,
    options: PdfExportOptions,
    configuredBrowserPath: string | undefined,
  ): Promise<PdfExportRunResult> {
    if (this.running) {
      return { ok: false, kind: 'busy', state: { ...this._state, failReason: 'busy' } }
    }
    this.running = true
    this.cancelRequested = false
    const generation = ++this.generation
    this.setState({ phase: 'generating', generation, docName: input.docName, failReason: undefined, failDetail: undefined, cancelKind: undefined, savedPath: undefined })
    const finish = (result: PdfExportRunResult): PdfExportRunResult => {
      this.running = false
      this.activeSession = undefined
      return result
    }
    try {
      const resolved = await this.ports.resolveBrowser(configuredBrowserPath)
      if (!resolved.ok) {
        this.setState({ phase: 'failed', failReason: resolved.reason })
        return finish({ ok: false, kind: 'failed', state: this._state })
      }
      const html = buildPdfExportHtml({
        title: input.docName,
        markdown: input.markdown,
        options,
        // T02 接线骨架：阅读样式快照的样式面就位前进 extraCss
        ...(Object.keys(input.readingStyleSnapshot).length > 0 ? {} : {}),
      })
      this.ports.onHtmlAssembled?.(html)
      const session = this.ports.createSession(resolved.browser.executablePath)
      this.activeSession = session
      let bytes: Buffer
      try {
        bytes = await session.exportPdf({ html, options })
      } finally {
        session.dispose()
      }
      if (this.cancelRequested) {
        // 导出途中用户取消（cancel 已触发 killSync；exportPdf 正常返回的
        // 边缘竞态也按取消收口，产物不落盘）
        this.setState({ phase: 'cancelled', cancelKind: 'user' })
        return finish({ ok: false, kind: 'cancelled', state: this._state })
      }
      this.setState({ phase: 'saving' })
      const target = await this.ports.showSaveDialog(input.docName.replace(/\.md$/i, '') + '.pdf')
      if (target === undefined) {
        this.setState({ phase: 'cancelled', cancelKind: 'save-dialog' })
        return finish({ ok: false, kind: 'cancelled', state: this._state })
      }
      try {
        await this.ports.writeFile(target, bytes)
      } catch (error) {
        this.setState({ phase: 'failed', failReason: 'write-failed' })
        return finish({ ok: false, kind: 'failed', state: this._state })
      }
      this.setState({ phase: 'done', savedPath: target })
      return finish({ ok: true, kind: 'done', state: this._state, bytes })
    } catch (error) {
      if (this.cancelRequested) {
        this.setState({ phase: 'cancelled', cancelKind: 'user' })
        return finish({ ok: false, kind: 'cancelled', state: this._state })
      }
      const reason: PdfExportFailReason = error instanceof PdfExportBrowserError
        ? (error.code === 'launch' ? 'launch-failed'
          : error.code === 'navigate' ? 'navigate-failed'
          : error.code === 'not-ready' ? 'not-ready'
          : 'print-failed')
        : 'internal'
      this.setState({ phase: 'failed', failReason: reason, failDetail: error instanceof Error ? error.message : String(error) })
      return finish({ ok: false, kind: 'failed', state: this._state })
    }
  }

  /** 释放兜底（模态关闭时调用）：取消在途任务 */
  dispose(): void {
    this.cancel()
  }
}
