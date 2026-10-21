// 批量 PDF 导出执行器（T04/#624）：按清单逐文件复用 T02 单文档两段式链路。
//
// 语义（规格 §2.1/§2.2/§2.5）：
// - 逐文件 renderPage（装配 + 就绪 + 失败清单）→（缺资源且未选 resumeAll
//   时）awaiting-resources 等用户选择 → finalizePrint → 写盘；每文件一个
//   独立浏览器会话与资源服务，失败面语义与单文档一致（T02 job 同款分态）。
// - 单项失败（捕获/渲染/打印/写盘）继续其余项，结束汇总成功/失败/跳过与
//   真实输出路径；不伪称整批成功。
// - skip 条目（映射计划剔除）不捕获不执行，结果如实登记 skipped。
// - 取消：killSync 等价路径打断在途命令（V01 §8），已完成文件保留、当前
//   未完成项标 cancelled（不伪装成功）、剩余项不开始；未完成产物不落盘
//   （写盘前的取消自然丢弃；写盘经临时文件 + 原子替换——旧文件在新文件
//   完整写入前不损毁）。
// - 缺资源选择：resume（本文件继续）/ resume-all（本批后续缺资源自动继续
//   ——正文保留可见降级说明，T02 语义）/ 取消（整批）。
// - resolveBrowser 失败（无浏览器/配置路径缺失）是整批环境性失败：零结果
//   条目 + failReason 显式呈现，不逐文件冒充单项失败。
//
// 纯逻辑可单测：浏览器链路与文件系统经 ports 注入（生产装配在
// pdfExportModal.ts——captureDoc 为 provider 侧准备阶段固定输入入口）。

import {
  mapBrowserErrorToFailReason,
  type BrowserExportSession,
  type PdfExportFailReason,
  type PdfExportInputPayload,
} from './pdfExportJob'
import type { ResolveBrowserResult } from './browserFind'
import type { PdfExportFailureItem } from '../../shared/pdfExportPayload'
import type { PdfExportOptions } from '../../shared/pdfExportOptions'
import type { PdfBatchItem, PdfBatchMappingEntry, PdfBatchResultEntry } from '../../shared/pdfExportBatch'

/** 批量扩展失败分态：条目文档在准备阶段不可得（未保存文本读取失败/文件不存在） */
export type PdfBatchFailReason = PdfExportFailReason | 'capture-failed'

/** 准备阶段固定输入（provider 侧 capturePdfBatchDoc 产物；样式/片段/换行
 *  是窗口级件，由宿主在批开始时捕获一次并入 payload） */
export interface PdfBatchCapturedDoc {
  docName: string
  capturedVersion: number
  payload: PdfExportInputPayload
}

export interface PdfBatchJobPorts {
  resolveBrowser(configuredPath: string | undefined): Promise<ResolveBrowserResult>
  createSession(executablePath: string): BrowserExportSession
  /** 准备阶段固定输入：已打开文档用未保存权威文本，未打开走工作区读取
   *  通道；嵌入目标预取与主文档同款（T02 语义） */
  captureDoc(fsPath: string): Promise<PdfBatchCapturedDoc | { ok: false; reason: string }>
  /** 生成产物写盘（生产实现：临时文件 + 原子替换） */
  writeFile(targetPath: string, bytes: Uint8Array): Promise<void>
  /** UI 语言（payload.locale 装配） */
  locale(): 'zh-cn' | 'en'
}

export interface PdfBatchJobState {
  phase: 'idle' | 'running' | 'awaiting-resources' | 'done' | 'cancelled' | 'failed'
  /** 已处理到的条目序（0 起；结束 = 清单长） */
  currentIndex: number
  total: number
  /** 当前条目显示名（运行中观测面） */
  currentName?: string
  results: PdfBatchResultEntry[]
  /** awaiting-resources 阶段当前文件的失败清单 */
  resourceIssues?: PdfExportFailureItem[]
  /** 整批环境性失败分态（resolveBrowser 失败） */
  failReason?: PdfBatchFailReason
}

export interface PdfBatchRunPlan {
  items: readonly PdfBatchItem[]
  /** id → 映射计划条目（planBatchMapping 产物；skip 项由执行器登记跳过） */
  mapping: ReadonlyMap<string, PdfBatchMappingEntry>
  options: PdfExportOptions
  browserPath: string | undefined
}

/** 内部取消信号（killSync 后在途命令 reject 的收口哨兵） */
class BatchCancelled extends Error {
  constructor() {
    super('batch-cancelled')
  }
}

const docNameOf = (fsPath: string): string => fsPath.split('/').pop() ?? fsPath

export class PdfBatchJob {
  private _state: PdfBatchJobState = { phase: 'idle', currentIndex: 0, total: 0, results: [] }
  private running = false
  private cancelRequested = false
  /** resume-all 已选择：后续缺资源自动继续不再暂停 */
  private resumeAll = false
  private activeSession: BrowserExportSession | undefined
  private choiceResolver: ((choice: 'resume' | 'resume-all' | false) => void) | undefined
  onStateChange?: (state: PdfBatchJobState) => void

  constructor(private readonly ports: PdfBatchJobPorts) {}

  get state(): PdfBatchJobState {
    return this._state
  }

  private setState(next: Partial<PdfBatchJobState> & { phase?: PdfBatchJobState['phase'] }): void {
    this._state = { ...this._state, ...next }
    this.onStateChange?.(this._state)
  }

  get isRunning(): boolean {
    return this.running
  }

  /** 取消进行中的批次（幂等）：打断在途命令、停止未完成项、保留已完成文件 */
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

  /** 执行整批。运行中重复发起直接返回当前状态（防重入由调用方观察 phase） */
  async run(plan: PdfBatchRunPlan): Promise<PdfBatchJobState> {
    if (this.running) return this._state
    this.running = true
    this.cancelRequested = false
    this.resumeAll = false
    this._state = { phase: 'running', currentIndex: 0, total: plan.items.length, results: [] }
    this.onStateChange?.(this._state)
    const finish = (): PdfBatchJobState => {
      this.running = false
      this.activeSession = undefined
      this.choiceResolver = undefined
      return this._state
    }
    try {
      const resolved = await this.ports.resolveBrowser(plan.browserPath)
      if (!resolved.ok) {
        this.setState({ phase: 'failed', failReason: resolved.reason })
        return finish()
      }
      const executablePath = resolved.browser.executablePath
      const results: PdfBatchResultEntry[] = []
      for (let index = 0; index < plan.items.length; index++) {
        const item = plan.items[index]!
        const mapping = plan.mapping.get(item.id)
        if (!mapping) continue // 防御：无映射条目不执行（正常流不会发生）
        const docName = docNameOf(item.fsPath)
        this.setState({ currentIndex: index, currentName: docName, resourceIssues: undefined })
        const base = { id: item.id, fsPath: item.fsPath, docName }
        if (mapping.action === 'skip') {
          results.push({ ...base, status: 'skipped', skipReason: mapping.skipReason })
          this.setState({ results: [...results] })
          continue
        }
        // ---- 准备阶段固定输入（已打开未保存权威文本 / 工作区读取通道）----
        let captured: PdfBatchCapturedDoc | { ok: false; reason: string }
        try {
          captured = await this.ports.captureDoc(item.fsPath)
        } catch {
          captured = { ok: false, reason: 'read-failed' }
        }
        if (!('payload' in captured) || !captured.payload) {
          results.push({ ...base, status: 'failed', failReason: 'capture-failed' })
          this.setState({ results: [...results] })
          continue
        }
        // ---- 逐文件两段式（T02 job 同款）----
        const session = this.ports.createSession(executablePath)
        this.activeSession = session
        let bytes: Buffer
        try {
          const rendered = await session.renderPage({
            payload: { ...captured.payload, mermaidUri: '', resBase: '', locale: this.ports.locale() },
            options: plan.options,
          })
          if (this.cancelRequested) throw new BatchCancelled()
          if (rendered.failures.length > 0 && !this.resumeAll) {
            this.setState({ phase: 'awaiting-resources', resourceIssues: rendered.failures })
            const choice = await new Promise<'resume' | 'resume-all' | false>((resolve) => {
              this.choiceResolver = resolve
            })
            if (choice === 'resume-all') this.resumeAll = true
            if (!choice || this.cancelRequested) throw new BatchCancelled()
            this.setState({ phase: 'running', resourceIssues: undefined })
          }
          bytes = await session.finalizePrint(plan.options)
        } catch (error) {
          session.dispose()
          if (this.cancelRequested || error instanceof BatchCancelled) {
            results.push({ ...base, status: 'cancelled' })
            this.setState({ phase: 'cancelled', results: [...results], currentName: undefined, resourceIssues: undefined })
            return finish()
          }
          results.push({ ...base, status: 'failed', failReason: mapBrowserErrorToFailReason(error) })
          this.setState({ results: [...results] })
          continue
        }
        session.dispose()
        if (this.cancelRequested) {
          // finalizePrint 正常返回与取消的边缘竞态：按取消收口，产物不落盘
          results.push({ ...base, status: 'cancelled' })
          this.setState({ phase: 'cancelled', results: [...results], currentName: undefined })
          return finish()
        }
        // ---- 写盘（生产实现临时文件 + 原子替换；失败继续其余项）----
        try {
          await this.ports.writeFile(mapping.targetPath, bytes)
        } catch {
          results.push({ ...base, status: 'failed', failReason: 'write-failed' })
          this.setState({ results: [...results] })
          continue
        }
        results.push({ ...base, status: 'success', targetPath: mapping.targetPath })
        this.setState({ results: [...results] })
      }
      this.setState({ phase: 'done', currentIndex: plan.items.length, currentName: undefined, resourceIssues: undefined })
      return finish()
    } finally {
      this.running = false
      this.activeSession = undefined
      this.choiceResolver = undefined
    }
  }

  /** 释放兜底（模态关闭时调用）：取消在途批次 */
  dispose(): void {
    this.cancel()
  }
}
