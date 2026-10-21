// PDF 导出模态（T01/#621 建立，T02/#622 升级固定输入与缺资源选择）。
//
// 固定输入（规格 §2.1/§2.3）：open 时经 source.session.whenEditsSettled() 等
// 在途 edit.request 落地，随后——
// - 主文档：读权威 TextDocument 全文与版本（T01 语义保持）；
// - 嵌入目标：source.readEmbedTarget 超集预取（全文 + 未保存版本固定；
//  非 Markdown 媒体身份与失败分态登记）；
// - 样式快照：source.requestStyleSnapshot（面板 webview 枚举主题变量；
//  超时/不可得降级空快照——骨架页基础默认值兜底）；
// - CSS 片段：source.snippetEntries 读启用清单文本（@page 剥离在骨架页
//  装配侧统一执行）；breaks：阅读宽松换行当前值。
// 此后任务只消费该 payload，生成期间的后续编辑不混入；不强制保存、
// 不新增撤销记录、源文 dirty 状态不受影响。
//
// 缺资源选择（T02）：job 的 awaiting-resources 阶段推送失败清单 → 模态
// 渲染 i18n 列表 + 继续导出/取消（pdfExportModal.resume / cancel）。
//
// 持久默认参数与浏览器路径只在 Vsidian 设置页（每次 open / run 实时读快照
// ——设置页改完重开模态即生效）。测试钩子（VSIDIAN_TEST_HOOKS=1）：
// showSaveDialog 短路为临时目录自动路径（真实落盘可断言），装配 HTML 与
// 绘制层探针经 _test.getPdfExportModalState 命令暴露（extension.ts 注册）。

import * as vscode from 'vscode'
import { randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { isWebviewToHost } from '../../shared/protocol'
import { t } from '../../shared/i18n'
import { LOCALE_MESSAGES, type LocaleCode } from '../../shared/locales'
import { buildLocaleIslandHtml } from '../../shared/locales/island'
import { hostLocale } from '../hostLocale'
import {
  normalizePdfExportOptions,
  PDF_EXPORT_OPTIONS_DEFAULTS,
  type PdfExportOptions,
} from '../../shared/pdfExportOptions'
import type {
  PdfExportSnippetEntry,
  PdfExportStyleSnapshot,
} from '../../shared/pdfExportPayload'
import {
  addBatchFiles,
  addToBatchFromDir,
  isMarkdownFilePath,
  isPdfBatchConflictStrategy,
  moveBatchItem,
  planBatchMapping,
  removeBatchItem,
  type PdfBatchConflictStrategy,
  type PdfBatchItem,
  type PdfBatchMappingEntry,
  type PdfBatchResultEntry,
} from '../../shared/pdfExportBatch'
import {
  PDF_EXPORT_BROWSER_PATH_KEY,
  PDF_EXPORT_MARGIN_KEY,
  PDF_EXPORT_ORIENTATION_KEY,
  PDF_EXPORT_PAPER_KEY,
  PDF_EXPORT_SCALE_KEY,
  type SettingsPayload,
} from '../../shared/settings'
import { PdfExportJob, type PdfExportInput, type PdfExportInputPayload, type PdfExportJobState } from './pdfExportJob'
import { PdfBatchJob, type PdfBatchRunPlan } from './pdfExportBatchJob'
import { createBrowserExportSession } from './pdfExportSession'
import { resolveExportBrowser } from './browserFind'
import { prefetchEmbedTargets, type PdfExportEmbedReadPort } from './pdfExportEmbeds'
import type { DocumentSession } from '../documentSession'

/** 模态 viewType（createWebviewPanel 无需清单声明） */
export const PDF_EXPORT_VIEW_TYPE = 'onegayi.vsidian.pdfExport'

/** 嵌入目标读取结果（provider 投影的窄形态；与 pdfExportEmbeds 端口一致） */
export type PdfExportEmbedReadOutcome = Awaited<ReturnType<PdfExportEmbedReadPort['readTarget']>>

/** 固定输入源（provider.getActivePdfExportSource 的返回形态） */
export type { PdfExportSnippetEntry, PdfExportStyleSnapshot } from '../../shared/pdfExportPayload'

export interface PdfExportDocumentSource {
  uri: vscode.Uri
  document: vscode.TextDocument
  session: DocumentSession
  /** T02（#622）嵌入目标读取（provider 的 readRefContentTarget 窄化投影：
   *  解析/范围规则与悬停预览同源，全文 + 未保存版本） */
  readEmbedTarget(inner: string): Promise<PdfExportEmbedReadOutcome>
  /** T02（#622）阅读样式快照（面板 styleProbe；超时/不可得 null） */
  requestStyleSnapshot(): Promise<PdfExportStyleSnapshot | null>
  /** T02（#622）CSS 片段固定文本（启用清单；读取失败项由实现方跳过） */
  snippetEntries(): Promise<PdfExportSnippetEntry[]>
  /** T02（#622）阅读宽松换行当前值（#423 渲染器同值） */
  readingBreaks(): boolean
}

/** T04（#624）批量条目捕获产物（provider capturePdfBatchDoc 的返回形态）：
 *  docs/embeds/mediaEmbeds/embedFailures 为条目级数据面；style/snippets/
 *  breaks 是窗口级件，由模态在批开始时捕获一次合并（准备阶段固定输入） */
export type PdfBatchDocCaptureOutcome =
  | {
      ok: true
      docName: string
      capturedVersion: number
      payload: {
        docs: PdfExportInputPayload['docs']
        embeds: PdfExportInputPayload['embeds']
        mediaEmbeds: PdfExportInputPayload['mediaEmbeds']
        embedFailures: PdfExportInputPayload['embedFailures']
      }
    }
  | { ok: false; reason: string }

/** T04（#624）批量窗口级固定输入（样式/片段/换行——批开始时刻一次捕获，
 *  全批共享：同一窗口同一主题同一设置，与单文档 captureInput 同兜底口径） */
export interface PdfBatchWindowCapture {
  style: PdfExportStyleSnapshot | null
  snippets: PdfExportSnippetEntry[]
  breaks: boolean
}

/** 会话装配依赖（extension.ts 注入：产物目录 + 资源解析端口） */
export interface PdfExportModalSessionDeps {
  outWebviewDir: string
  /** 资源解析（classifyImageTarget + stat；provider/extension 装配） */
  resolveResource(src: string, sourceFsPath: string | undefined): Promise<
    | { ok: true; fsPath: string; contentType: string }
    | { ok: false; reason: 'not-found' | 'inaccessible' | 'blocked' }
  >
  /** T04（#624）批量条目捕获（provider capturePdfBatchDoc：已打开文档
   *  未保存权威文本 + 嵌入预取；未打开走工作区读取通道） */
  capturePdfBatchDoc(fsPath: string): Promise<PdfBatchDocCaptureOutcome>
  /** T04（#624）批量窗口级固定输入（样式快照——活动面板优先，无则 null
   *  由模态主题兜底；CSS 片段与阅读宽松换行当前值） */
  captureBatchWindowInput(): Promise<PdfBatchWindowCapture>
}

/** 模态观测信息（_test 钩子与集成断言用） */
export interface PdfExportModalInfo {
  open: boolean
  phase: PdfExportJobState['phase']
  generation: number
  docName: string
  capturedVersion: number
  savedPath: string | undefined
  failReason: string | undefined
  /** 失败的原始错误信息（诊断观测面） */
  failDetail: string | undefined
  /** cancelled 终态细分（user / save-dialog） */
  cancelKind: 'user' | 'save-dialog' | undefined
  /** 最近一次装配导出页 HTML（测试钩子断言固定输入渲染面） */
  lastHtml: string | undefined
  /** 模态 webview 最近上报的绘制层探针（控件可见性与计算样式摘要） */
  lastPaint: unknown
  /** 钩子模式下 showSaveDialog 短路的自动目标路径 */
  hookedSaveTarget: string | undefined
  /** awaiting-resources 阶段的失败清单（继续/取消两分支断言面） */
  resourceIssues: PdfExportJobState['resourceIssues']
  /** 固定输入的嵌入预取统计（观测面） */
  embedStats: { embeds: number; mediaEmbeds: number; failures: number } | undefined
  /** 就绪后导出页整页截图（测试钩子装配时的视觉证据；base64 PNG） */
  lastSnapshot: string | undefined
  /** T04（#624）批量模式观测面（非批量模式 undefined） */
  batch: {
    mode: 'document' | 'batch'
    phase: 'editing' | 'confirm' | 'running' | 'awaiting-resources' | 'done' | 'cancelled' | 'failed'
    items: PdfBatchItem[]
    mapping: PdfBatchMappingEntry[] | undefined
    targetDir: string | undefined
    strategy: PdfBatchConflictStrategy
    currentIndex: number
    total: number
    currentName: string | undefined
    results: PdfBatchResultEntry[]
    resourceIssues: PdfExportJobState['resourceIssues']
    failReason: string | undefined
    /** 钩子模式下批量目标目录短路的自动路径 */
    hookedTargetDir: string | undefined
  } | undefined
}

export interface PdfExportModalHandle {
  /** 打开（或 reveal 已有面板并刷新固定输入——重新执行命令 = 新一轮输入） */
  open(source: PdfExportDocumentSource): void
  /** T04（#624）打开批量模式（或 reveal 已有面板切换到批量清单——不依赖
   *  活动文档；清单与映射权威在宿主，重开重置为空清单） */
  openBatch(): void
  close(): void
  isOpen(): boolean
  getInfo(): PdfExportModalInfo
  /** 经正式处理入口注入模态 webview → 宿主消息（测试钩子通道） */
  injectMessage(message: unknown): void
}

/** 从设置快照读取本次默认参数与浏览器路径（实时快照——设置页修改即时生效） */
function defaultsFromSettings(snapshot: SettingsPayload): { defaults: PdfExportOptions; browserPath: string } {
  return {
    defaults: normalizePdfExportOptions({
      paper: snapshot[PDF_EXPORT_PAPER_KEY],
      orientation: snapshot[PDF_EXPORT_ORIENTATION_KEY],
      marginMm: typeof snapshot[PDF_EXPORT_MARGIN_KEY] === 'number' ? snapshot[PDF_EXPORT_MARGIN_KEY] as number : undefined,
      scale: typeof snapshot[PDF_EXPORT_SCALE_KEY] === 'number' ? snapshot[PDF_EXPORT_SCALE_KEY] as number : undefined,
    }, PDF_EXPORT_OPTIONS_DEFAULTS),
    browserPath: typeof snapshot[PDF_EXPORT_BROWSER_PATH_KEY] === 'string'
      ? snapshot[PDF_EXPORT_BROWSER_PATH_KEY] as string
      : '',
  }
}

export function createPdfExportModal(
  context: vscode.ExtensionContext,
  getSettingsSnapshot: () => SettingsPayload,
  openSettingsCallback: () => void,
  sessionDeps: PdfExportModalSessionDeps,
): PdfExportModalHandle {
  let panel: vscode.WebviewPanel | undefined
  /** 当前固定输入（open 时捕获；新一轮命令重新捕获） */
  let fixedInput: PdfExportInput | undefined
  let sourceDirForDialog: vscode.Uri | undefined
  let lastHtml: string | undefined
  let lastPaint: unknown
  let lastSnapshot: string | undefined
  let hookedSaveTarget: string | undefined
  let embedStats: PdfExportModalInfo['embedStats']
  /** 当前任务参与文档身份集（资源服务 knownDocFsPaths 数据源——任务发起
   *  前登记、终态后清空） */
  const knownDocFsPaths = new Set<string>()

  const job = new PdfExportJob({
    resolveBrowser: (configuredPath) => resolveExportBrowser(configuredPath),
    createSession: (executablePath) => createBrowserExportSession(executablePath, {
      outWebviewDir: sessionDeps.outWebviewDir,
      resourceResolve: {
        resolve: sessionDeps.resolveResource,
        knownDocFsPaths: () => knownDocFsPaths,
      },
      onPageAssembled: (html) => {
        lastHtml = html
      },
      ...(process.env.VSIDIAN_TEST_HOOKS === '1'
        ? {
          onPageSnapshot: (pngBase64: string) => {
            lastSnapshot = pngBase64
          },
        }
        : {}),
    }),
    showSaveDialog: async (defaultFileName) => {
      if (process.env.VSIDIAN_TEST_HOOKS === '1') {
        // 测试钩子短路：自动目标路径（临时目录 + 文档名），真实落盘可断言；
        // 目标路径经 getInfo().hookedSaveTarget 暴露
        const dir = mkdtempSync(path.join(tmpdir(), 'vsidian-pdfexport-test-'))
        hookedSaveTarget = path.join(dir, defaultFileName)
        return hookedSaveTarget
      }
      const target = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.joinPath(sourceDirForDialog ?? vscode.Uri.file(tmpdir()), defaultFileName),
        filters: { 'PDF': ['pdf'] },
      })
      return target?.fsPath
    },
    writeFile: async (targetPath, bytes) => {
      await vscode.workspace.fs.writeFile(vscode.Uri.file(targetPath), Buffer.from(bytes))
    },
    onHtmlAssembled: (html) => {
      lastHtml = html
    },
    locale: () => hostLocale(getSettingsSnapshot()),
  })

  // ---- T04（#624）批量模式：清单权威在宿主（编辑经消息上行，state 推送
  //  下行）；清单顺序即执行顺序；映射预览在 confirm 阶段呈现并随策略切换
  //  重算（磁盘已有探测缓存于 confirm 进入时——准备阶段固定映射快照） ----
  let mode: 'document' | 'batch' = 'document'
  let batchPhase: 'editing' | 'confirm' | 'running' | 'awaiting-resources' | 'done' | 'cancelled' | 'failed' = 'editing'
  let batchItems: PdfBatchItem[] = []
  let batchMapping: PdfBatchMappingEntry[] | undefined
  let batchTargetDir: string | undefined
  let batchStrategy: PdfBatchConflictStrategy = 'rename'
  /** confirm 阶段探测的磁盘已有（小写键；策略切换重算映射用——进入执行后
   *  不再重探，映射与策略在确认时固定） */
  let batchExisting = new Set<string>()
  let batchIdSeq = 0
  let batchWindowCapture: PdfBatchWindowCapture | undefined
  let hookedBatchTargetDir: string | undefined
  /** 批量异步操作串行链（收集/对话框/探测不得交错——消息到达序即用户
   *  操作序，晚到的增删看到一致的清单中间态） */
  let batchOpChain: Promise<void> = Promise.resolve()
  const enqueueBatchOp = (op: () => Promise<void>): void => {
    batchOpChain = batchOpChain.then(op, op)
  }
  const nextBatchId = (): string => `b${++batchIdSeq}`

  const batchInfo = () => mode === 'batch'
    ? {
        mode: 'batch' as const,
        phase: batchPhase,
        items: batchItems,
        mapping: batchMapping,
        targetDir: batchTargetDir,
        strategy: batchStrategy,
        currentIndex: batchJob.state.currentIndex,
        total: batchJob.state.total,
        currentName: batchJob.state.currentName,
        results: batchJob.state.results,
        resourceIssues: batchJob.state.resourceIssues,
        failReason: batchJob.state.failReason,
        hookedTargetDir: hookedBatchTargetDir,
      }
    : undefined

  /** 目录递归收集（readDirectory 递归；条目名稳定排序——枚举顺序只是初始
   *  清单顺序，最终执行顺序由用户可调的清单决定） */
  const collectDirMarkdown = async (dirUri: vscode.Uri): Promise<string[]> => {
    const found: string[] = []
    const walk = async (dir: vscode.Uri): Promise<void> => {
      let entries: Array<[string, vscode.FileType]>
      try {
        entries = await vscode.workspace.fs.readDirectory(dir)
      } catch {
        return
      }
      entries.sort((a, b) => a[0].localeCompare(b[0]))
      for (const [name, type] of entries) {
        const child = vscode.Uri.joinPath(dir, name)
        if ((type & vscode.FileType.Directory) !== 0) {
          await walk(child)
        } else {
          found.push(child.fsPath.replaceAll('\\', '/'))
        }
      }
    }
    await walk(dirUri)
    return found
  }

  /** 批量产物写盘：目标目录按需创建 + 临时文件 + 原子替换（覆盖策略下
   *  旧文件在新文件完整写入前不损毁；失败清理临时文件） */
  const writeBatchFile = async (targetPath: string, bytes: Uint8Array): Promise<void> => {
    const target = vscode.Uri.file(targetPath)
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, '..'))
    const tmp = `${targetPath}.vsidian-tmp-${randomUUID()}`
    try {
      await vscode.workspace.fs.writeFile(vscode.Uri.file(tmp), Buffer.from(bytes))
      await vscode.workspace.fs.rename(vscode.Uri.file(tmp), target, { overwrite: true })
    } catch (error) {
      await vscode.workspace.fs.delete(vscode.Uri.file(tmp)).then(() => undefined, () => undefined)
      throw error
    }
  }

  const batchJob = new PdfBatchJob({
    resolveBrowser: (configuredPath) => resolveExportBrowser(configuredPath),
    createSession: (executablePath) => createBrowserExportSession(executablePath, {
      outWebviewDir: sessionDeps.outWebviewDir,
      resourceResolve: {
        resolve: sessionDeps.resolveResource,
        knownDocFsPaths: () => knownDocFsPaths,
      },
    }),
    captureDoc: async (fsPath) => {
      const outcome = await sessionDeps.capturePdfBatchDoc(fsPath)
      if (!outcome.ok) return outcome
      const window = batchWindowCapture
      // 资源服务守卫数据面：主条目 + 嵌入目标身份（捕获成功即登记——
      // renderPage 资源请求在捕获之后，时序上先于页面装载）
      for (const doc of outcome.payload.docs) {
        knownDocFsPaths.add(doc.fsPath)
      }
      return {
        docName: outcome.docName,
        capturedVersion: outcome.capturedVersion,
        payload: {
          ...outcome.payload,
          style: window?.style ?? {
            dark: vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark
              || vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast,
            vars: {},
            reading: {},
          },
          snippets: window?.snippets ?? [],
          breaks: window?.breaks ?? false,
        },
      }
    },
    writeFile: writeBatchFile,
    locale: () => hostLocale(getSettingsSnapshot()),
  })
  batchJob.onStateChange = () => {
    // 批量 job 阶段映射（done/cancelled/failed 终态后保持——结果表呈现）
    const phase = batchJob.state.phase
    if (phase === 'running' || phase === 'awaiting-resources' || phase === 'done' || phase === 'cancelled' || phase === 'failed') {
      batchPhase = phase
    }
    if (phase === 'idle' || phase === 'done' || phase === 'cancelled' || phase === 'failed') {
      knownDocFsPaths.clear()
    }
    notifyState()
  }

  /** confirm 进入：探测名义目标磁盘已有 + 首版映射 */
  const enterBatchConfirm = async (targetDir: string): Promise<void> => {
    batchTargetDir = targetDir
    batchExisting = new Set<string>()
    const nominalDirs = new Set(batchItems.map((item) => {
      const rel = item.relPath.replace(/\.(md|markdown)$/i, '.pdf')
      return `${targetDir}/${rel}`.toLowerCase()
    }))
    await Promise.all([...nominalDirs].map(async (target) => {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.file(target))
        batchExisting.add(target)
      } catch {
        /* 不存在即不占用 */
      }
    }))
    batchMapping = planBatchMapping(batchItems, targetDir, batchStrategy, batchExisting)
    batchPhase = 'confirm'
    notifyState()
  }

  /** 批量执行：窗口级固定输入一次捕获 + knownDocFsPaths 登记（全批条目与
   *  其嵌入目标——资源服务守卫数据面） */
  const startBatchRun = async (params: PdfExportOptions): Promise<void> => {
    if (batchJob.isRunning || job.isRunning) return
    batchWindowCapture = await sessionDeps.captureBatchWindowInput()
    const plan: PdfBatchRunPlan = {
      items: batchItems,
      mapping: new Map((batchMapping ?? []).map((entry) => [entry.id, entry])),
      options: params,
      browserPath: defaultsFromSettings(getSettingsSnapshot()).browserPath.trim() || undefined,
    }
    batchPhase = 'running'
    notifyState()
    // 主条目身份预登记（嵌入目标随逐文件捕获补登记——见 captureDoc）
    for (const item of batchItems) {
      knownDocFsPaths.add(item.fsPath)
    }
    void batchJob.run(plan).then(async (state) => {
      if (state.phase === 'done' && state.results.length > 0) {
        const summary = state.results.filter((r) => r.status === 'success').length
        void vscode.window.showInformationMessage(
          t('pdfExport.batch.doneNotice', { success: String(summary), total: String(state.results.length) }),
        )
      }
    })
  }

  const info = (): PdfExportModalInfo => ({
    open: panel !== undefined,
    phase: job.state.phase,
    generation: job.state.generation,
    docName: fixedInput?.docName ?? '',
    capturedVersion: fixedInput?.capturedVersion ?? 0,
    savedPath: job.state.savedPath,
    failReason: job.state.failReason,
    failDetail: job.state.failDetail,
    cancelKind: job.state.cancelKind,
    lastHtml,
    lastPaint,
    hookedSaveTarget,
    resourceIssues: job.state.resourceIssues,
    embedStats,
    lastSnapshot,
    batch: batchInfo(),
  })

  const notifyState = (): void => {
    if (!panel) return
    const { defaults, browserPath } = defaultsFromSettings(getSettingsSnapshot())
    void panel.webview.postMessage({
      kind: 'pdfExportModal.state',
      phase: job.state.phase,
      generation: job.state.generation,
      docName: fixedInput?.docName ?? '',
      capturedVersion: fixedInput?.capturedVersion ?? 0,
      defaults,
      browserPath,
      ...(job.state.savedPath !== undefined ? { savedPath: job.state.savedPath } : {}),
      ...(job.state.failReason !== undefined ? { failReason: job.state.failReason } : {}),
      ...(job.state.failDetail !== undefined ? { failDetail: job.state.failDetail } : {}),
      ...(job.state.cancelKind !== undefined ? { cancelKind: job.state.cancelKind } : {}),
      ...(job.state.resourceIssues !== undefined
        ? { resourceIssues: job.state.resourceIssues.map((issue) => ({ kind: issue.kind, item: issue.item, reason: issue.reason })) }
        : {}),
      // T04（#624）批量模式状态（单文档模式不携带——既有字段零改动）
      ...(mode === 'batch'
        ? {
            batch: {
              phase: batchPhase,
              items: batchItems,
              ...(batchMapping !== undefined ? { mapping: batchMapping } : {}),
              ...(batchTargetDir !== undefined ? { targetDir: batchTargetDir } : {}),
              strategy: batchStrategy,
              currentIndex: batchJob.state.currentIndex,
              total: batchJob.state.total,
              ...(batchJob.state.currentName !== undefined ? { currentName: batchJob.state.currentName } : {}),
              results: batchJob.state.results,
              ...(batchJob.state.resourceIssues !== undefined
                ? { resourceIssues: batchJob.state.resourceIssues.map((issue) => ({ kind: issue.kind, item: issue.item, reason: issue.reason })) }
                : {}),
              ...(batchJob.state.failReason !== undefined ? { failReason: batchJob.state.failReason } : {}),
            },
          }
        : {}),
    })
  }
  job.onStateChange = () => {
    if (job.state.phase === 'idle' || job.state.phase === 'done' || job.state.phase === 'failed' || job.state.phase === 'cancelled') {
      knownDocFsPaths.clear()
    }
    notifyState()
  }

  /** 固定输入捕获：在途编辑落地后读权威全文 + 嵌入预取 + 样式快照 + 片段
   *  （此后任务只消费该 payload；样式快照超时降级空快照不阻塞捕获） */
  const captureInput = async (source: PdfExportDocumentSource): Promise<PdfExportInput> => {
    await source.session.whenEditsSettled()
    const lfText = source.document.getText().replace(/\r\n?/g, '\n')
    const docName = path.basename(source.uri.fsPath || 'document.md')
    const [embeds, style, snippets] = await Promise.all([
      prefetchEmbedTargets(lfText, { readTarget: (inner) => source.readEmbedTarget(inner) }),
      source.requestStyleSnapshot().catch(() => null),
      source.snippetEntries().catch(() => [] as PdfExportSnippetEntry[]),
    ])
    embedStats = { embeds: embeds.embeds.length, mediaEmbeds: embeds.mediaEmbeds.length, failures: embeds.embedFailures.length }
    return {
      docName,
      capturedVersion: source.document.version,
      payload: {
        docs: [
          {
            fsPath: source.uri.fsPath.replaceAll('\\', '/'),
            docName,
            text: lfText,
            version: source.document.version,
          },
          ...embeds.embeds.map((entry) => ({
            fsPath: entry.fsPath,
            docName: entry.docName,
            text: entry.text,
            version: entry.version,
          })),
        ],
        embeds: embeds.embeds,
        mediaEmbeds: embeds.mediaEmbeds,
        embedFailures: embeds.embedFailures,
        style: style ?? {
          dark: vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark
            || vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast,
          vars: {},
          reading: {},
        },
        snippets,
        breaks: source.readingBreaks(),
      },
    }
  }

  /** T04（#624）批量消息族处理（清单编辑经消息上行——宿主为清单权威；
   *  对话框为生产唯一入口，paths/path/targetDir 仅 VSIDIAN_TEST_HOOKS 门控
   *  下消费；收集/探测类操作经 batchOpChain 串行——消息到达序即用户操作序） */
  const handleBatchMessage = (message: { kind: string; paths?: unknown; path?: unknown; targetDir?: unknown; id?: unknown; direction?: unknown; strategy?: unknown; params?: unknown; all?: unknown }): void => {
    if (mode !== 'batch') return
    const editingLocked = batchJob.isRunning
    switch (message.kind) {
      case 'pdfExportModal.batch.addFiles': {
        if (editingLocked) return
        enqueueBatchOp(async () => {
          let files: string[] | undefined
          const injected = message.paths
          // 路径统一经 Uri.file 归一形态（Windows 盘符大小写/分隔符——与
          // 对话框结果同款，避免同文件因来源不同形成异形身份）
          if (Array.isArray(injected) && injected.every((p) => typeof p === 'string') && process.env.VSIDIAN_TEST_HOOKS === '1') {
            files = (injected as string[]).map((p) => vscode.Uri.file(p).fsPath.replaceAll('\\', '/'))
          } else {
            const picked = await vscode.window.showOpenDialog({
              canSelectMany: true,
              canSelectFolders: false,
              openLabel: t('pdfExport.batch.addFiles'),
              filters: { 'Markdown': ['md', 'markdown'] },
            })
            files = picked?.map((uri) => uri.fsPath.replaceAll('\\', '/'))
          }
          if (!files || files.length === 0) return
          batchItems = addBatchFiles(batchItems, files, isMarkdownFilePath, nextBatchId).items
          notifyState()
        })
        return
      }
      case 'pdfExportModal.batch.addDir': {
        if (editingLocked) return
        enqueueBatchOp(async () => {
          let dirs: vscode.Uri[] | undefined
          const injected = message.path
          if (typeof injected === 'string' && injected !== '' && process.env.VSIDIAN_TEST_HOOKS === '1') {
            dirs = [vscode.Uri.file(injected)]
          } else {
            dirs = await vscode.window.showOpenDialog({
              canSelectMany: true,
              canSelectFolders: true,
              canSelectFiles: false,
              openLabel: t('pdfExport.batch.addDir'),
            })
          }
          if (!dirs || dirs.length === 0) return
          for (const dir of dirs) {
            const files = await collectDirMarkdown(dir)
            batchItems = addToBatchFromDir(
              batchItems,
              dir.fsPath.replaceAll('\\', '/'),
              files,
              isMarkdownFilePath,
              nextBatchId,
            ).items
          }
          notifyState()
        })
        return
      }
      case 'pdfExportModal.batch.remove': {
        if (editingLocked || typeof message.id !== 'string') return
        batchItems = removeBatchItem(batchItems, message.id)
        notifyState()
        return
      }
      case 'pdfExportModal.batch.move': {
        if (editingLocked || typeof message.id !== 'string' || (message.direction !== 'up' && message.direction !== 'down')) return
        batchItems = moveBatchItem(batchItems, message.id, message.direction)
        notifyState()
        return
      }
      case 'pdfExportModal.batch.run': {
        if (batchJob.isRunning || batchItems.length === 0) return
        enqueueBatchOp(async () => {
          let targetDir: string | undefined
          if (process.env.VSIDIAN_TEST_HOOKS === '1') {
            // 测试钩子短路：注入目录优先（用例预置已有文件后探测），
            // 缺省自动临时目录；真实落盘可断言，经观测面暴露
            const injected = typeof message.targetDir === 'string' && message.targetDir !== '' ? message.targetDir : undefined
            if (injected) {
              targetDir = vscode.Uri.file(injected).fsPath.replaceAll('\\', '/')
              hookedBatchTargetDir = targetDir
            } else {
              const dir = mkdtempSync(path.join(tmpdir(), 'vsidian-pdfbatch-test-'))
              hookedBatchTargetDir = dir.replaceAll('\\', '/')
              targetDir = hookedBatchTargetDir
            }
          } else {
            const picked = await vscode.window.showOpenDialog({
              canSelectMany: false,
              canSelectFolders: true,
              canSelectFiles: false,
              openLabel: t('pdfExport.batch.chooseTargetDir'),
            })
            targetDir = picked?.[0]?.fsPath.replaceAll('\\', '/')
          }
          if (!targetDir) return
          await enterBatchConfirm(targetDir)
        })
        return
      }
      case 'pdfExportModal.batch.setStrategy': {
        if (batchPhase !== 'confirm' || !isPdfBatchConflictStrategy(message.strategy)) return
        batchStrategy = message.strategy
        batchMapping = planBatchMapping(batchItems, batchTargetDir!, batchStrategy, batchExisting)
        notifyState()
        return
      }
      case 'pdfExportModal.batch.confirm': {
        if (batchPhase !== 'confirm' || batchJob.isRunning) return
        const { defaults } = defaultsFromSettings(getSettingsSnapshot())
        const params = normalizePdfExportOptions(message.params as Record<string, unknown> | undefined, defaults)
        void startBatchRun(params)
        return
      }
      case 'pdfExportModal.batch.cancel': {
        if (batchJob.isRunning) {
          batchJob.cancel()
          return
        }
        // confirm/done/cancelled/failed → 回到清单编辑（映射丢弃，新一轮
        // 重新选择目标目录与探测——上一轮未完成结果不复用）
        if (batchPhase !== 'editing') {
          batchPhase = 'editing'
          batchMapping = undefined
          batchTargetDir = undefined
          batchExisting = new Set()
          notifyState()
        }
        return
      }
      case 'pdfExportModal.batch.resume': {
        batchJob.resolveResourceChoice(message.all === true ? 'resume-all' : 'resume')
        return
      }
      default:
        return
    }
  }

  const handleMessage = (message: unknown): void => {
    if (!isWebviewToHost(message)) return
    if (typeof message.kind === 'string' && message.kind.startsWith('pdfExportModal.batch.')) {
      handleBatchMessage(message)
      return
    }
    switch (message.kind) {
      case 'pdfExportModal.get':
        notifyState()
        return
      case 'pdfExportModal.run': {
        if (!fixedInput) return
        lastHtml = undefined
        lastSnapshot = undefined
        hookedSaveTarget = undefined
        // 参与文档身份登记（资源服务守卫数据面）：主文档 + 嵌入目标
        knownDocFsPaths.clear()
        for (const doc of fixedInput.payload.docs) {
          knownDocFsPaths.add(doc.fsPath)
        }
        const { defaults, browserPath } = defaultsFromSettings(getSettingsSnapshot())
        const params = normalizePdfExportOptions(message.params, defaults)
        void job.run(fixedInput, params, browserPath.trim() || undefined).then((result) => {
          if (result.kind === 'done') {
            void vscode.window.showInformationMessage(t('pdfExport.savedTo', { path: result.state.savedPath ?? '' }))
          }
        })
        return
      }
      case 'pdfExportModal.cancel':
        job.cancel()
        return
      case 'pdfExportModal.resume':
        job.resolveResourceChoice(true)
        return
      case 'settings.open':
        openSettingsCallback()
        return
      case '_test.pdfExportModal.report':
        lastPaint = message.paint
        return
      default:
        return // 模态不会发出其余消息，忽略
    }
  }

  /** 面板创建（open/openBatch 共用；关闭时两个 job 均配对释放） */
  const ensurePanel = (): void => {
    if (panel) {
      panel.reveal()
      return
    }
    const created = vscode.window.createWebviewPanel(
      PDF_EXPORT_VIEW_TYPE,
      t('pdfExport.modalTitle'),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out')],
      },
    )
    panel = created
    created.webview.html = buildPdfExportModalHtml(
      created.webview,
      context.extensionUri,
      hostLocale(getSettingsSnapshot()),
    )
    const messageSub = created.webview.onDidReceiveMessage(handleMessage)
    created.onDidDispose(() => {
      messageSub.dispose()
      panel = undefined
      // 关闭模态：取消在途任务并释放（规格 §2.5 配对释放；未完成产物不落盘）
      job.dispose()
      batchJob.dispose()
      knownDocFsPaths.clear()
      lastPaint = undefined
      // 会话终结：模式、批量清单与策略选择一并重置（重开 = 全新会话）
      mode = 'document'
      batchPhase = 'editing'
      batchItems = []
      batchMapping = undefined
      batchTargetDir = undefined
      batchExisting = new Set()
      batchStrategy = 'rename'
      hookedBatchTargetDir = undefined
      batchWindowCapture = undefined
    })
  }

  /** 批量模式收口：切换/重开均进入新批量会话——取消在途任务并重置清单
   *  与策略选择（上一会话的策略选择不跨会话残留；open(source) 同款
   *  「重新执行命令 = 新一轮输入」语义；单文档任务在途时取消让位） */
  const enterBatchMode = (): void => {
    job.cancel()
    batchJob.cancel()
    mode = 'batch'
    batchPhase = 'editing'
    batchItems = []
    batchMapping = undefined
    batchTargetDir = undefined
    batchExisting = new Set()
    batchStrategy = 'rename'
    hookedBatchTargetDir = undefined
    batchWindowCapture = undefined
    notifyState()
  }

  const open = (source: PdfExportDocumentSource): void => {
    sourceDirForDialog = source.uri.scheme === 'file'
      ? vscode.Uri.file(path.dirname(source.uri.fsPath))
      : vscode.workspace.workspaceFolders?.[0]?.uri
    if (mode === 'batch') {
      // 批量 → 单文档：取消在途批量任务，清单丢弃（重开批量 = 空清单）
      batchJob.cancel()
      mode = 'document'
    }
    // 固定输入捕获（异步）：面板装载握手（get）早于捕获完成时以空输入态
    // 应答，捕获完成由 then 补推对齐（新一轮输入就位）
    embedStats = undefined
    void captureInput(source).then((input) => {
      fixedInput = input
      notifyState()
    })
    ensurePanel()
  }

  const openBatch = (): void => {
    enterBatchMode()
    ensurePanel()
    notifyState()
  }

  return {
    open,
    openBatch,
    close: () => {
      panel?.dispose()
    },
    isOpen: () => panel !== undefined,
    getInfo: info,
    injectMessage: handleMessage,
  }
}

/** 模态 HTML：CSP 与产物地址装配（settingsPage 同模式）；测试钩子标志经
 *  nonce 内联注入（webview 侧仅在该标志下发送 _test.* 绘制层探针——宿主
 *  侧门控的被动接收形态，与编辑器面板 _test 钩子同约定） */
function buildPdfExportModalHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  locale: LocaleCode,
): string {
  const nonce = randomUUID()
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'pdfExport.js'),
  )
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'pdfExport.css'),
  )
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource}`,
    `script-src ${webview.cspSource} 'nonce-${nonce}'`,
    `style-src ${webview.cspSource}`,
  ].join('; ')
  const testHooksFlag = process.env.VSIDIAN_TEST_HOOKS === '1' ? 'window.__vsidianTestHooks = true;' : ''
  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="${styleUri}" rel="stylesheet">
<title>${t('pdfExport.modalTitle')}</title>
</head>
<body>
<div id="app"></div>
${buildLocaleIslandHtml(locale, LOCALE_MESSAGES[locale])}
<script nonce="${nonce}">${testHooksFlag}</script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
}
