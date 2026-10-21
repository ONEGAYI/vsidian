// 多文档合并 PDF 导出执行器（T06/#626）：按清单序逐篇固定输入 → 单浏览器
// 会话合成一份 PDF。
//
// 语义（规格 pdf-export.md §2.2/§2.3/§2.5）：
// - 清单顺序即合篇顺序（用户可调序的清单权威在模态——与 T04 批量同一
//   数据面；planBatchMapping 的映射/重名策略是逐文件输出专用，合并单
//   产物不经过它，目标文件经保存对话框单点确定）。
// - 准备阶段固定输入：逐篇 captureDoc（已打开文档未保存权威文本 + 嵌入
//   预取；未打开走工作区读取通道——T04 同端口），全篇捕获完成后一次装配
//   合并 payload；**任一篇捕获失败即整次失败**（合并是单产物，缺篇静默
//   跳过会伪装成完整合并——失败原因携带篇名，不冒充成功）。
// - 每篇另起一页由装配侧 CSS 分页（payload.merge.pageBreak）承担；书签
//   按篇分段定位 + 文档名顶级子树在 session.finalizePrint 内消费
//   payload.merge 完成（写入层零改动——见 shared/pdfOutline）。
// - 两段式与失败面语义与 T02 单文档一致：renderPage →（缺资源且未选
//   resumeAll 时）awaiting-resources 等用户选择 → finalizePrint → 保存
//   对话框 → 原子写盘；取消/失败不留伪成功产物、不破坏既有目标文件
//  （写盘经临时文件 + 原子替换——生产装配在模态）。
// - totalPages/页眉页脚天然对应最终合并产物（Chromium totalPages 原生
//   class 与 hf 模板作用于整次打印）；页眉标题取首篇文档名（清单序的
//   用户锚点——合并产物无独立命名面，保存默认名同源）。
//
// 纯逻辑可单测：浏览器链路/文件系统/对话框经 ports 注入。

import {
  mapBrowserErrorToFailReason,
  type BrowserExportSession,
  type PdfBookmarkReport,
  type PdfExportFailReason,
  type PdfExportInputPayload,
} from './pdfExportJob'
import type { PdfBatchCapturedDoc } from './pdfExportBatchJob'
import type { ResolveBrowserResult } from './browserFind'
import type {
  PdfExportDocEntry,
  PdfExportEmbedEntry,
  PdfExportEmbedPrefetchFailure,
  PdfExportFailureItem,
  PdfExportMediaEmbedEntry,
  PdfExportSnippetEntry,
  PdfExportStyleSnapshot,
} from '../../shared/pdfExportPayload'
import type { PdfExportOptions } from '../../shared/pdfExportOptions'
import type { PdfBatchItem } from '../../shared/pdfExportBatch'

/** 合并窗口级固定输入（style 兜底后的权威形态——与批量 PdfBatchWindowCapture
 *  同数据面；模态在合并开始时捕获一次全产物共享） */
export interface PdfMergeWindowInput {
  style: PdfExportStyleSnapshot
  snippets: PdfExportSnippetEntry[]
  breaks: boolean
}

/** 合并执行计划（模态装配：清单 + 参数 + 每篇另起一页 + 窗口级件） */
export interface PdfMergeRunPlan {
  items: readonly PdfBatchItem[]
  options: PdfExportOptions
  pageBreak: boolean
  window: PdfMergeWindowInput
  browserPath: string | undefined
}

/** 合并 payload 纯装配（清单序 captured + 窗口级件 → 单产物载荷）：
 * - docs = 全部主文档（清单序）+ 嵌入目标跨篇并集（fsPath+inner 去重——
 *   两篇同 inner 可解析到不同目标，并集各留一条；docStyle 收集与资源
 *   身份数据面消费 docs 全量）；
 * - merge.docs 按篇携带各自的嵌入面（嵌入解析以来源文档为基准——消费
 *   面按篇，不跨篇混配）；pageBreak 供装配侧 CSS 分页；
 * - 选区片段不参与合并（fragments 是主文档维度的叠加，T03 语义限单文档
 *   导出——合并不携带）。 */
export function buildPdfMergePayload(
  captured: readonly [PdfBatchCapturedDoc, ...PdfBatchCapturedDoc[]],
  window: PdfMergeWindowInput,
  pageBreak: boolean,
): PdfExportInputPayload {
  const mains: PdfExportDocEntry[] = []
  const mergeDocs: Array<{ doc: PdfExportDocEntry; embeds: PdfExportEmbedEntry[]; mediaEmbeds: PdfExportMediaEmbedEntry[]; embedFailures: PdfExportEmbedPrefetchFailure[] }> = []
  const embeds: PdfExportEmbedEntry[] = []
  const seenEmbed = new Set<string>()
  const mediaEmbeds: PdfExportMediaEmbedEntry[] = []
  const seenMedia = new Set<string>()
  const embedFailures: PdfExportEmbedPrefetchFailure[] = []
  const seenFailure = new Set<string>()
  for (const entry of captured) {
    const main = entry.payload.docs[0]!
    mains.push(main)
    mergeDocs.push({
      doc: main,
      embeds: entry.payload.embeds,
      mediaEmbeds: entry.payload.mediaEmbeds,
      embedFailures: entry.payload.embedFailures,
    })
    for (const embed of entry.payload.embeds) {
      const key = `${embed.fsPath}\u0000${embed.inner}`
      if (seenEmbed.has(key)) continue
      seenEmbed.add(key)
      embeds.push(embed)
    }
    for (const media of entry.payload.mediaEmbeds) {
      const key = `${media.kind}\u0000${media.inner}`
      if (seenMedia.has(key)) continue
      seenMedia.add(key)
      mediaEmbeds.push(media)
    }
    for (const failure of entry.payload.embedFailures) {
      const key = `${failure.reason}\u0000${failure.inner}`
      if (seenFailure.has(key)) continue
      seenFailure.add(key)
      embedFailures.push(failure)
    }
  }
  return {
    docs: [mains[0]!, ...mains.slice(1), ...embeds.map((e) => ({ fsPath: e.fsPath, docName: e.docName, text: e.text, version: e.version }))],
    embeds,
    mediaEmbeds,
    embedFailures,
    style: window.style,
    snippets: window.snippets,
    breaks: window.breaks,
    merge: { docs: [mergeDocs[0]!, ...mergeDocs.slice(1)], pageBreak },
  }
}

export interface PdfMergeJobPorts {
  resolveBrowser(configuredPath: string | undefined): Promise<ResolveBrowserResult>
  createSession(executablePath: string): BrowserExportSession
  /** 准备阶段固定输入（T04 批量同端口：已打开未保存权威文本 + 嵌入预取） */
  captureDoc(fsPath: string): Promise<PdfBatchCapturedDoc | { ok: false; reason: string }>
  /** 保存对话框：undefined = 用户取消（产物丢弃） */
  showSaveDialog(defaultFileName: string): Promise<string | undefined>
  /** 生成产物写盘（生产实现：临时文件 + 原子替换） */
  writeFile(targetPath: string, bytes: Uint8Array): Promise<void>
  /** UI 语言（payload.locale 装配） */
  locale(): 'zh-cn' | 'en'
}

export type PdfMergeFailReason = PdfExportFailReason | 'capture-failed'

export interface PdfMergeJobState {
  phase: 'idle' | 'capturing' | 'running' | 'awaiting-resources' | 'saving' | 'done' | 'cancelled' | 'failed'
  /** 正在固定输入的篇序（0 起；capturing 阶段观测面） */
  currentIndex: number
  total: number
  /** 当前篇显示名（capturing/running 观测面；失败分态携带篇名） */
  currentName?: string
  savedPath?: string
  failReason?: PdfMergeFailReason
  /** 失败的原始诊断信息（观测面；不进用户文案） */
  failDetail?: string
  cancelKind?: 'user' | 'save-dialog'
  resourceIssues?: PdfExportFailureItem[]
  /** 标题书签结果（done 观测面——session 内合并书签报告） */
  bookmarks?: PdfBookmarkReport
}

/** 内部取消信号（killSync 后在途命令 reject 的收口哨兵） */
class MergeCancelled extends Error {
  constructor() {
    super('merge-cancelled')
  }
}

const docNameOf = (fsPath: string): string => fsPath.split('/').pop() ?? fsPath

/** 首篇文档名去扩展名（保存默认名与页眉标题同源——清单序的用户锚点） */
export const mergeDefaultFileName = (items: readonly PdfBatchItem[]): string =>
  (docNameOf(items[0]?.fsPath ?? '')).replace(/\.(md|markdown)$/i, '') || 'merged'

export class PdfMergeJob {
  private _state: PdfMergeJobState = { phase: 'idle', currentIndex: 0, total: 0 }
  private running = false
  private cancelRequested = false
  /** resume-all 已选择：本次合并的缺资源自动继续不再暂停 */
  private resumeAll = false
  private activeSession: BrowserExportSession | undefined
  private choiceResolver: ((choice: 'resume' | 'resume-all' | false) => void) | undefined
  onStateChange?: (state: PdfMergeJobState) => void

  constructor(private readonly ports: PdfMergeJobPorts) {}

  get state(): PdfMergeJobState {
    return this._state
  }

  private setState(next: Partial<PdfMergeJobState> & { phase?: PdfMergeJobState['phase'] }): void {
    this._state = { ...this._state, ...next }
    this.onStateChange?.(this._state)
  }

  get isRunning(): boolean {
    return this.running
  }

  /** 取消进行中的合并（幂等）：打断在途命令与捕获循环，产物不落盘 */
  cancel(): void {
    if (!this.running) return
    this.cancelRequested = true
    this.choiceResolver?.(false)
    this.choiceResolver = undefined
    this.activeSession?.cancel()
  }

  /** awaiting-resources 的用户选择（非该阶段调用无副作用） */
  resolveResourceChoice(choice: 'resume' | 'resume-all' | false): void {
    const resolver = this.choiceResolver
    this.choiceResolver = undefined
    resolver?.(choice)
  }

  /** 执行一次合并。运行中重复发起直接返回当前状态（防重入由调用方观察 phase） */
  async run(plan: PdfMergeRunPlan): Promise<PdfMergeJobState> {
    if (this.running) return this._state
    this.running = true
    this.cancelRequested = false
    this.resumeAll = false
    this._state = { phase: 'capturing', currentIndex: 0, total: plan.items.length }
    this.onStateChange?.(this._state)
    const finish = (): PdfMergeJobState => {
      this.running = false
      this.activeSession = undefined
      this.choiceResolver = undefined
      return this._state
    }
    const cancelledResult = (kind: 'user' | 'save-dialog'): PdfMergeJobState => {
      this.setState({ phase: 'cancelled', cancelKind: kind, currentName: undefined, resourceIssues: undefined })
      return finish()
    }
    try {
      if (plan.items.length === 0) {
        // 防御：空清单不构成合并任务（模态入口已拦截；不冒充成功）
        this.setState({ phase: 'failed', failReason: 'internal', failDetail: 'empty merge list' })
        return finish()
      }
      const resolved = await this.ports.resolveBrowser(plan.browserPath)
      if (!resolved.ok) {
        this.setState({ phase: 'failed', failReason: resolved.reason })
        return finish()
      }
      // ---- 准备阶段固定输入：逐篇捕获（清单序；任一篇失败即整次失败）----
      const captured: PdfBatchCapturedDoc[] = []
      for (let index = 0; index < plan.items.length; index++) {
        const item = plan.items[index]!
        const docName = docNameOf(item.fsPath)
        this.setState({ currentIndex: index, currentName: docName })
        let outcome: PdfBatchCapturedDoc | { ok: false; reason: string }
        try {
          outcome = await this.ports.captureDoc(item.fsPath)
        } catch {
          outcome = { ok: false, reason: 'read-failed' }
        }
        if (this.cancelRequested) return cancelledResult('user')
        if (!('payload' in outcome) || !outcome.payload) {
          this.setState({ phase: 'failed', failReason: 'capture-failed', failDetail: docName })
          return finish()
        }
        captured.push(outcome)
      }
      const payload = buildPdfMergePayload([captured[0]!, ...captured.slice(1)], plan.window, plan.pageBreak)
      // ---- 两段式（T02 单文档同款，单会话承载合并产物）----
      const session = this.ports.createSession(resolved.browser.executablePath)
      this.activeSession = session
      let bytes: Buffer
      let bookmarks: PdfBookmarkReport
      try {
        const rendered = await session.renderPage({
          payload: { ...payload, mermaidUri: '', resBase: '', locale: this.ports.locale() },
          options: plan.options,
        })
        if (this.cancelRequested) throw new MergeCancelled()
        this.setState({ phase: 'running' })
        if (rendered.failures.length > 0 && !this.resumeAll) {
          this.setState({ phase: 'awaiting-resources', resourceIssues: rendered.failures })
          const choice = await new Promise<'resume' | 'resume-all' | false>((resolve) => {
            this.choiceResolver = resolve
          })
          if (choice === 'resume-all') this.resumeAll = true
          if (!choice || this.cancelRequested) throw new MergeCancelled()
          this.setState({ phase: 'running', resourceIssues: undefined })
        }
        const printed = await session.finalizePrint(plan.options)
        bytes = printed.bytes
        bookmarks = printed.bookmarks
      } catch (error) {
        session.dispose()
        if (this.cancelRequested || error instanceof MergeCancelled) return cancelledResult('user')
        this.setState({ phase: 'failed', failReason: mapBrowserErrorToFailReason(error), failDetail: error instanceof Error ? error.message : String(error), currentName: undefined })
        return finish()
      }
      session.dispose()
      if (this.cancelRequested) {
        // finalizePrint 正常返回与取消的边缘竞态：按取消收口，产物不落盘
        return cancelledResult('user')
      }
      // ---- 保存对话框 + 原子写盘（取消/失败不留伪成功产物）----
      this.setState({ phase: 'saving', bookmarks })
      const target = await this.ports.showSaveDialog(`${mergeDefaultFileName(plan.items)}.pdf`)
      if (target === undefined) {
        this.setState({ phase: 'cancelled', cancelKind: 'save-dialog' })
        return finish()
      }
      try {
        await this.ports.writeFile(target, bytes)
      } catch (error) {
        this.setState({ phase: 'failed', failReason: 'write-failed', failDetail: error instanceof Error ? error.message : String(error) })
        return finish()
      }
      this.setState({ phase: 'done', savedPath: target, currentName: undefined })
      return finish()
    } finally {
      this.running = false
      this.activeSession = undefined
      this.choiceResolver = undefined
    }
  }

  /** 释放兜底（模态关闭时调用）：取消在途合并 */
  dispose(): void {
    this.cancel()
  }
}
