// PDF 导出任务编排（T01/#621 建立，T02/#622 升级两段式与缺资源选择）。
//
// 纯逻辑可单测：浏览器链路经 BrowserExportSession 端口注入（生产实现
// createBrowserExportSession：launch → 资源服务 → http 页面 → 组合就绪 →
// 失败清单 →（用户选择）→ printToPDF → 释放），文件系统与保存对话框经
// ports 注入（vscode 层装配）。
//
// 语义（规格 §2.5 任务结果与释放 + §2.3 缺资源选择）：
// - 代次（generation）单调递增，新旧任务以真实代次区分（§2.4）；
// - 两段式：renderPage（装配 + 就绪 + 失败清单）→ 失败非空进入
//   awaiting-resources（模态呈现 i18n 列表，用户选择继续/取消）→
//   finalizePrint（printToPDF）→ saving → done；
// - 取消：killSync 等价路径打断在途命令（悬挂命令立即 reject，V01 §8），
//   已取消任务不落盘（未完成产物不得伪装成成功 PDF）；
// - 保存对话框在生成完成后弹出，用户取消即本次任务取消（产物丢弃）；
// - 每次任务的浏览器会话与服务在 finally 释放（dispose 幂等兜底）。

import type { ResolveBrowserResult } from './browserFind'
import type { PdfExportFailureItem, PdfExportPagePayload, PdfExportReadyState } from '../../shared/pdfExportPayload'
import type { PdfHeadingMark } from '../../shared/pdfOutline'
import type { PdfExportOptions } from '../../shared/pdfExportOptions'

export type PdfExportPhase =
  | 'idle'
  | 'generating'
  | 'awaiting-resources'
  | 'saving'
  | 'done'
  | 'failed'
  | 'cancelled'

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

/** 固定输入（规格 §2.1：准备阶段确定本次使用的版本）——payload 数据面。
 *  docs[0] 恒为主文档；mermaidUri/resBase 由会话装配层填、locale 由模态
 *  侧填（此处不携带）。T03 选区与 T04 批量在此结构上扩展 docs 或片段。 */
export type PdfExportInputPayload = Omit<PdfExportPagePayload, 'mermaidUri' | 'resBase' | 'locale'>

export interface PdfExportInput {
  /** 文档显示名（文件名，含扩展名） */
  docName: string
  /** 固定时刻权威版本（观测面：供断言「生成期间后续编辑不混入」） */
  capturedVersion: number
  /** 固定输入数据面（正文/嵌入/样式快照/片段；T02 起 readingStyleSnapshot
   *  的骨架形态并入 payload.style） */
  payload: PdfExportInputPayload
}

/** 浏览器链路错误码（生产 session 抛出，job 映射失败分态） */
export class PdfExportBrowserError extends Error {
  constructor(readonly code: 'launch' | 'navigate' | 'not-ready' | 'print', message: string) {
    super(message)
    this.name = 'PdfExportBrowserError'
  }
}

/** 标题书签报告（T05/#625）：written=false 时产物不加 /Outlines——不给
 *  伪造书签；机器原因码不进用户文案（模态按 reason 映射词条） */
export interface PdfBookmarkReport {
  written: boolean
  /** 埋点标题总数 */
  total: number
  /** 定位失败被跳过的标题数（written=true 时可为部分跳过） */
  skipped: number
  reason?: 'disabled' | 'no-headings' | 'none-located' | 'locate-failed' | 'write-failed'
  /** 失败的原始诊断信息（观测面；不进用户文案） */
  detail?: string
}

/** 异常 → 失败分态映射（T04 起单文档 job 与批量执行器共用——不建第二份
 *  分态口径；非浏览器链路异常收敛 internal） */
export function mapBrowserErrorToFailReason(error: unknown): PdfExportFailReason {
  return error instanceof PdfExportBrowserError
    ? (error.code === 'launch' ? 'launch-failed'
      : error.code === 'navigate' ? 'navigate-failed'
      : error.code === 'not-ready' ? 'not-ready'
      : 'print-failed')
    : 'internal'
}

/** 单次导出的浏览器会话端口（生产 createBrowserExportSession 实现） */
export interface BrowserExportSession {
  /** 装配导出页并等待就绪：返回页面失败清单与标题埋点（页面保留在场待 finalize） */
  renderPage(input: { payload: PdfExportPagePayload; options: PdfExportOptions }): Promise<{
    ready: boolean
    readyState: PdfExportReadyState
    failures: PdfExportFailureItem[]
    /** T05：标题书签埋点（DOM 文档序；finalizePrint 的书签数据面） */
    headings: PdfHeadingMark[]
  }>
  /** 打印并释放（renderPage 成功后可达一次）：T05 起返回书签报告 */
  finalizePrint(options: PdfExportOptions): Promise<{ bytes: Buffer; bookmarks: PdfBookmarkReport }>
  /** 用户取消：强杀进程树并清理（在途命令随连接断开 reject） */
  cancel(): void
  /** 幂等兜底释放（renderPage/finalizePrint 成功/失败后调用均安全） */
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
  /** UI 语言（payload.locale 装配） */
  locale(): 'zh-cn' | 'en'
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
  /** awaiting-resources 阶段的失败清单（模态 i18n 列表数据源） */
  resourceIssues?: PdfExportFailureItem[]
  /** 标题书签结果（T05：done 阶段观测面——模态按 reason/skipped 映射提示） */
  bookmarks?: PdfBookmarkReport
}

export interface PdfExportRunResult {
  ok: boolean
  /** done=成功落盘；failed/cancelled 终态；awaiting-resources=等待用户选择 */
  kind: 'done' | 'failed' | 'cancelled' | 'busy' | 'awaiting-resources'
  state: PdfExportJobState
  bytes?: Buffer
}

/** T07（#627）预览产物复用形态：参数与固定输入身份经指纹严格核对相等时，
 *  导出直接消费预览管线产出的字节（同一 createBrowserExportSession 产物）
 *  ——跳过浏览器生成，仅走保存对话框与写盘；过期预览由调用方指纹核对
 *  排除（本 job 不重复判定）。 */
export interface PdfExportPrecomputed {
  bytes: Uint8Array
  bookmarks: PdfBookmarkReport
}

export class PdfExportJob {
  private generation = 0
  private activeSession: BrowserExportSession | undefined
  private running = false
  private cancelRequested = false
  /** awaiting-resources 的用户选择 resolver（resolveResourceChoice 消费） */
  private choiceResolver: ((accept: boolean) => void) | undefined
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

  /** 取消进行中的任务（幂等；对未运行任务无副作用）——含等待选择阶段 */
  cancel(): void {
    if (!this.running) return
    this.cancelRequested = true
    this.choiceResolver?.(false)
    this.choiceResolver = undefined
    this.activeSession?.cancel()
  }

  /** awaiting-resources 阶段的用户选择：accept=true 继续导出（正文保留可见
   *  降级说明），false = 取消。非该阶段调用无副作用（防御返回）。 */
  resolveResourceChoice(accept: boolean): void {
    const resolver = this.choiceResolver
    this.choiceResolver = undefined
    resolver?.(accept)
  }

  /** 执行一次导出。任务串行：进行中再发起返回 busy（模态防重入）。
   *  返回 awaiting-resources 时任务仍占用会话等待 resolveResourceChoice
   *  或 cancel；其余 kind 均为终态。
   *  precomputed（T07/#627）：指纹核对相等的预览产物——跳过浏览器链路
   *  直接进入保存阶段（产物与预览同源同代次）。 */
  async run(
    input: PdfExportInput,
    options: PdfExportOptions,
    configuredBrowserPath: string | undefined,
    precomputed?: PdfExportPrecomputed,
  ): Promise<PdfExportRunResult> {
    if (this.running) {
      return { ok: false, kind: 'busy', state: { ...this._state, failReason: 'busy' } }
    }
    this.running = true
    this.cancelRequested = false
    const generation = ++this.generation
    this.setState({ phase: 'generating', generation, docName: input.docName, failReason: undefined, failDetail: undefined, cancelKind: undefined, savedPath: undefined, resourceIssues: undefined, bookmarks: undefined })
    const finish = (result: PdfExportRunResult): PdfExportRunResult => {
      this.running = false
      this.activeSession = undefined
      this.choiceResolver = undefined
      return result
    }
    const cancelledResult = (kind: 'user'): PdfExportRunResult => {
      this.setState({ phase: 'cancelled', cancelKind: kind })
      return finish({ ok: false, kind: 'cancelled', state: this._state })
    }
    try {
      let bytes: Buffer
      let bookmarks: PdfBookmarkReport | undefined
      if (precomputed !== undefined) {
        // T07 预览产物复用：同源同代次字节直接进入保存阶段——不启动浏览器
        bytes = Buffer.from(precomputed.bytes)
      } else {
        const resolved = await this.ports.resolveBrowser(configuredBrowserPath)
        if (!resolved.ok) {
          this.setState({ phase: 'failed', failReason: resolved.reason })
          return finish({ ok: false, kind: 'failed', state: this._state })
        }
        const session = this.ports.createSession(resolved.browser.executablePath)
        this.activeSession = session
        let rendered
        try {
          rendered = await session.renderPage({
            payload: { ...input.payload, mermaidUri: '', resBase: '', locale: this.ports.locale() },
            options,
          })
        } catch (error) {
          session.dispose()
          throw error
        }
        if (this.cancelRequested) {
          session.dispose()
          return cancelledResult('user')
        }
        if (rendered.failures.length > 0) {
          // 缺资源选择（规格 §2.3）：失败清单非空 → 等待用户继续/取消；
          // 会话与页面保留（继续时直接打印，取消即释放）
          this.setState({ phase: 'awaiting-resources', resourceIssues: rendered.failures })
          const accept = await new Promise<boolean>((resolve) => {
            this.choiceResolver = resolve
          })
          if (!accept || this.cancelRequested) {
            session.dispose()
            return cancelledResult('user')
          }
          this.setState({ phase: 'generating', resourceIssues: undefined })
        }
        let printed: { bytes: Buffer; bookmarks: PdfBookmarkReport }
        try {
          printed = await session.finalizePrint(options)
        } finally {
          session.dispose()
        }
        bytes = printed.bytes
        bookmarks = printed.bookmarks
        if (this.cancelRequested) {
          // 导出途中用户取消（cancel 已触发 killSync；finalizePrint 正常返回的
          // 边缘竞态也按取消收口，产物不落盘）
          return cancelledResult('user')
        }
      }
      const finalBookmarks = bookmarks ?? precomputed?.bookmarks
      this.setState({ phase: 'saving', ...(finalBookmarks !== undefined ? { bookmarks: finalBookmarks } : {}) })
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
        return cancelledResult('user')
      }
      const reason = mapBrowserErrorToFailReason(error)
      this.setState({ phase: 'failed', failReason: reason, failDetail: error instanceof Error ? error.message : String(error) })
      return finish({ ok: false, kind: 'failed', state: this._state })
    }
  }

  /** 释放兜底（模态关闭时调用）：取消在途任务 */
  dispose(): void {
    this.cancel()
  }
}
