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
import { createHash, randomUUID } from 'node:crypto'
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
import { pdfPreviewFingerprint, type PdfPreviewTarget } from '../../shared/pdfExportPreview'
import type {
  PdfExportFailureItem,
  PdfExportSnippetEntry,
  PdfExportStyleSnapshot,
} from '../../shared/pdfExportPayload'
import {
  addBatchFiles,
  addToBatchFromDir,
  isMarkdownFilePath,
  isPdfBatchConflictStrategy,
  mergeBatchResults,
  moveBatchItem,
  occupiedTargetsFromListings,
  planBatchMapping,
  removeBatchItem,
  type PdfBatchConflictStrategy,
  type PdfBatchItem,
  type PdfBatchMappingEntry,
  type PdfBatchResultEntry,
} from '../../shared/pdfExportBatch'
import {
  PDF_EXPORT_BOOKMARKS_KEY,
  PDF_EXPORT_BROWSER_PATH_KEY,
  PDF_EXPORT_CUSTOM_HEIGHT_MM_KEY,
  PDF_EXPORT_CUSTOM_WIDTH_MM_KEY,
  PDF_EXPORT_HEADER_DATE_KEY,
  PDF_EXPORT_HEADER_KEY,
  PDF_EXPORT_HEADER_TITLE_KEY,
  PDF_EXPORT_MARGIN_KEY,
  PDF_EXPORT_ORIENTATION_KEY,
  PDF_EXPORT_PAGE_NUMBER_KEY,
  PDF_EXPORT_PAGE_NUMBER_POSITION_KEY,
  PDF_EXPORT_PAPER_KEY,
  PDF_EXPORT_SCALE_KEY,
  type SettingsPayload,
} from '../../shared/settings'
import { PdfExportJob, PdfExportTargetExistsError, type PdfExportInput, type PdfExportInputPayload, type PdfExportJobState, type PdfExportPrecomputed } from './pdfExportJob'
import { PdfBatchJob, type PdfBatchRunPlan, type PdfBatchCapturedDoc } from './pdfExportBatchJob'
import { PdfMergeJob, buildPdfMergePayload, type PdfMergeRunPlan } from './pdfExportMergeJob'
import { PdfPreviewJob } from './pdfExportPreviewJob'
import { createBrowserExportSession } from './pdfExportSession'
import { resolveExportBrowser } from './browserFind'
import { createPdfRemoteAdapter, type PdfRemoteAdapter } from './pdfRemoteAdapter'
import { readPdfRemoteTestHooks } from './pdfRemoteTestHooks'
import { prefetchEmbedTargets, type PdfExportEmbedReadPort } from './pdfExportEmbeds'
import { sliceSelectionFragments, type PdfSelectionRange } from './pdfExportSelection'
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
  /** 标题书签结果（T05：done 观测面——written/reason/skipped 断言面） */
  bookmarks: PdfExportJobState['bookmarks']
  /** 固定输入的嵌入预取统计（观测面） */
  embedStats: { embeds: number; mediaEmbeds: number; failures: number } | undefined
  /** T03（#623）选区片段数（0=全文导出；选区导出的片段数观测面） */
  fragmentCount: number
  /** 就绪后导出页整页截图（测试钩子装配时的视觉证据；base64 PNG） */
  lastSnapshot: string | undefined
  /** T07（#627）模态 HTML 的预览装配观测：CSP 全文与 pdfjs 资产注入标志
   *  （core 集成断言在无浏览器环境钉住装载面——worker-src blob: 等） */
  modalCsp: string
  modalPreviewAssetsReady: boolean
  /** T08（#628）remote 会话观测面：是否走本机执行端链路 + 最近一次执行端
   *  浏览器解析结果（e2e 断言「remote 路径确实被取用」） */
  remote: {
    active: boolean
    /** undefined = 本会话尚未发起过任务（无 ping 数据） */
    browserResolved: boolean | undefined
    browserKind?: string | undefined
  }
  /** T07（#627）预览观测面（无预览会话时 phase='idle'；bytesSha 为就绪
   *  产物的指纹摘要——与最终导出文件哈希对读，钉住「同源同代次」） */
  preview: {
    phase: 'idle' | 'generating' | 'ready' | 'failed'
    generation: number
    fingerprint: string | undefined
    byteLength: number
    bytesSha256: string
    bookmarks: PdfExportJobState['bookmarks']
    failures: PdfExportJobState['resourceIssues']
    failReason: string | undefined
    target: PdfPreviewTarget | undefined
    /** 批量模式当前选中预览条目 id（非批量模式 undefined） */
    batchItemId: string | undefined
    /** 捕获/生成在途（刷新按钮禁用判据） */
    busy: boolean
    /** 最近一次单文档/合并导出是否复用了预览字节（观测面） */
    lastExportReused: boolean
    /** 预览任务累计发起/取消计数（释放配对观测） */
    runs: number
    cancels: number
  }
  /** T04（#624）批量模式观测面（非批量/合并模式 undefined；合并模式为
   *  merge 形态——单产物观测：savedPath/bookmarks/篇进度，无映射面） */
  batch:
    | {
        mode: 'batch'
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
      }
    | {
        mode: 'merge'
        /** T06（#626）合并单产物阶段（capturing = 逐篇固定输入；saving =
         *  保存对话框/写盘——批量模式不产生这两个阶段） */
        phase: 'editing' | 'capturing' | 'running' | 'awaiting-resources' | 'saving' | 'done' | 'cancelled' | 'failed'
        items: PdfBatchItem[]
        currentIndex: number
        total: number
        currentName: string | undefined
        resourceIssues: PdfExportJobState['resourceIssues']
        failReason: string | undefined
        /** 失败的原始诊断（观测面；不进用户文案） */
        failDetail: string | undefined
        savedPath: string | undefined
        bookmarks: PdfExportJobState['bookmarks']
        /** 钩子模式下保存对话框短路的自动目标路径 */
        hookedSaveTarget: string | undefined
      }
    | undefined
}

export interface PdfExportModalHandle {
  /** 打开（或 reveal 已有面板并刷新固定输入——重新执行命令 = 新一轮输入）。
   *  selection（T03/#623 选区导出）：当前 CM6 多选区（LF 坐标）——在场
   *  即选区模式，捕获阶段切片为片段（不扩大）；缺省 = 全文导出（T01/T02
   *  语义不变）。命令层保证非空（空选区/阅读模式在入口拦截，不开模态） */
  open(source: PdfExportDocumentSource, selection?: readonly PdfSelectionRange[]): void
  /** 打开（或 reveal 已有面板并刷新固定输入——重新执行命令 = 新一轮输入） */
  open(source: PdfExportDocumentSource): void
  /** T04（#624）打开批量模式（或 reveal 已有面板切换到批量清单——不依赖
   *  活动文档；清单与映射权威在宿主，重开重置为空清单） */
  openBatch(): void
  /** T06（#626）打开合并模式（或 reveal 已有面板切换到合并清单——同一
   *  清单数据面按合并语义消费：清单顺序即合篇顺序，单产物无映射面） */
  openMerge(): void
  close(): void
  isOpen(): boolean
  getInfo(): PdfExportModalInfo
  /** 经正式处理入口注入模态 webview → 宿主消息（测试钩子通道） */
  injectMessage(message: unknown): void
  /** T07（#627）宿主 → 模态 webview 消息转发（测试钩子通道——webview 侧
   *  仅 __vsidianTestHooks 标志下消费 _test 形态） */
  postToWebview(message: unknown): void
}

/** 从设置快照读取本次默认参数与浏览器路径（实时快照——设置页修改即时生效） */
function defaultsFromSettings(snapshot: SettingsPayload): { defaults: PdfExportOptions; browserPath: string } {
  const numberOr = (key: string): number | undefined => {
    const value = snapshot[key]
    return typeof value === 'number' ? value : undefined
  }
  const boolOr = (key: string): boolean | undefined => {
    const value = snapshot[key]
    return typeof value === 'boolean' ? value : undefined
  }
  return {
    defaults: normalizePdfExportOptions({
      paper: snapshot[PDF_EXPORT_PAPER_KEY],
      orientation: snapshot[PDF_EXPORT_ORIENTATION_KEY],
      marginMm: numberOr(PDF_EXPORT_MARGIN_KEY),
      scale: numberOr(PDF_EXPORT_SCALE_KEY),
      customWidthMm: numberOr(PDF_EXPORT_CUSTOM_WIDTH_MM_KEY),
      customHeightMm: numberOr(PDF_EXPORT_CUSTOM_HEIGHT_MM_KEY),
      headerEnabled: boolOr(PDF_EXPORT_HEADER_KEY),
      headerTitle: boolOr(PDF_EXPORT_HEADER_TITLE_KEY),
      headerDate: boolOr(PDF_EXPORT_HEADER_DATE_KEY),
      pageNumberEnabled: boolOr(PDF_EXPORT_PAGE_NUMBER_KEY),
      pageNumberPosition: snapshot[PDF_EXPORT_PAGE_NUMBER_POSITION_KEY],
      bookmarksEnabled: boolOr(PDF_EXPORT_BOOKMARKS_KEY),
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
  let modalCsp = ''
  let modalPreviewAssetsReady = false
  let hookedSaveTarget: string | undefined
  let embedStats: PdfExportModalInfo['embedStats']
  /** 最近一次捕获的选区片段数（观测面；0=全文导出） */
  let fragmentCount = 0
  /** 当前任务参与文档身份集（资源服务 knownDocFsPaths 数据源——任务发起
   *  前登记、终态后清空） */
  const knownDocFsPaths = new Set<string>()

  // ---- T08（#628）Remote SSH 运行侧判定与会话适配 ----
  // 判据：`vscode.env.remoteName` 在场 = remote 窗口。主扩展 extensionKind
  // 为 workspace——remote 窗口中本扩展恒跑在 vscode-server（远端），本地
  // 窗口恒跑本机；对 workspace-kind 扩展，remoteName 与「本进程在远端」
  // 等价（V02 §2 的教训是 remoteName 不能判别任意扩展在哪端——本扩展
  // 单端运行，无此歧义）。remote 下四个 job 与预览的端口面换成本机执行
  // 端适配器（跨 ext host 命令通道）；本地窗口保持既有链路零改动。
  const workspaceRootOf = (): string | undefined => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  const remoteAdapter: PdfRemoteAdapter | undefined = vscode.env.remoteName !== undefined
    ? createPdfRemoteAdapter({
      exec: (command, arg) => vscode.commands.executeCommand(command, arg),
      resolveResource: sessionDeps.resolveResource,
      readResourceBytes: async (fsPath) => vscode.workspace.fs.readFile(vscode.Uri.file(fsPath)),
      knownDocFsPaths: () => knownDocFsPaths,
      pageLabel: () => ({
        pre: t('pdfExport.pageNumber.pre'),
        mid: t('pdfExport.pageNumber.mid'),
        post: t('pdfExport.pageNumber.post'),
      }),
      testHooks: () => readPdfRemoteTestHooks(undefined, workspaceRootOf()),
    })
    : undefined
  /** remote 观测面：最近一次执行端 ping 的浏览器解析结果 */
  let remoteResolveObserved: { ok: boolean; kind?: string } | undefined

  /** 测试钩子门控（本地 = env；remote e2e = 工作区标记文件——远端 ext host
   *  读不到宿主 env，V02 §3.4；沿 T17 标记文件先例） */
  const testHooksActive = (): boolean =>
    process.env.VSIDIAN_TEST_HOOKS === '1' || readPdfRemoteTestHooks(undefined, workspaceRootOf()) !== undefined

  /** 保存对话框端口（单文档与 T06 合并共用：钩子短路临时目录自动路径
   *  经 hookedSaveTarget 暴露；生产走系统对话框，取消 = undefined。
   *  T08 remote：对话框与写盘都在本机——经执行端命令（远端 Uri.file 会
   *  把本机路径误落到远端 fs，V02 §3.3 语义；钩子注入路径同样走执行端
   *  真实落盘，目标路径经 hookedSaveTarget 暴露） */
  const saveDialogPort = async (defaultFileName: string): Promise<string | undefined> => {
    if (remoteAdapter !== undefined) {
      const target = await remoteAdapter.showSaveDialog(defaultFileName)
      if (target !== undefined && testHooksActive()) {
        hookedSaveTarget = target
      }
      return target
    }
    if (process.env.VSIDIAN_TEST_HOOKS === '1') {
      // 测试钩子短路：自动目标路径（临时目录 + 默认名），真实落盘可断言；
      // 目标路径经 getInfo()（单文档直读 / 合并 batch.hookedSaveTarget）暴露
      const dir = mkdtempSync(path.join(tmpdir(), 'vsidian-pdfexport-test-'))
      hookedSaveTarget = path.join(dir, defaultFileName)
      return hookedSaveTarget
    }
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.joinPath(sourceDirForDialog ?? vscode.Uri.file(tmpdir()), defaultFileName),
      filters: { 'PDF': ['pdf'] },
    })
    return target?.fsPath
  }

  /** T08 remote：浏览器解析与端口面（本地窗口保持既有链路） */
  const resolveBrowserPort = remoteAdapter !== undefined
    ? async (configuredPath: string | undefined) => {
      const result = await remoteAdapter!.resolveBrowser(configuredPath)
      remoteResolveObserved = result.ok
        ? { ok: true, kind: result.browser.kind }
        : { ok: false }
      return result
    }
    : resolveExportBrowser
  const createSessionPort = remoteAdapter !== undefined
    ? (executablePath: string) => remoteAdapter!.createSession(executablePath)
    : (executablePath: string) => createBrowserExportSession(executablePath, {
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
    })

  /** 单文档/选区落盘端口（双轴评审 P2-001）：remote 下保存对话框返回的是
   *  **本机**路径，必须经执行端写本机 fs——用远端 workspace.fs 会把本机路径
   *  误落到远端（或直接失败）。批量/合并的 writeBatchFile 已是此口径。 */
  const writeFilePort = remoteAdapter !== undefined
    ? (targetPath: string, bytes: Uint8Array) => remoteAdapter!.writeFile(targetPath, bytes)
    : async (targetPath: string, bytes: Uint8Array) => {
      await vscode.workspace.fs.writeFile(vscode.Uri.file(targetPath), Buffer.from(bytes))
    }

  const job = new PdfExportJob({
    resolveBrowser: resolveBrowserPort,
    createSession: createSessionPort,
    showSaveDialog: saveDialogPort,
    writeFile: writeFilePort,
    onHtmlAssembled: (html) => {
      lastHtml = html
    },
    locale: () => hostLocale(getSettingsSnapshot()),
  })

  // ---- T04（#624）批量模式：清单权威在宿主（编辑经消息上行，state 推送
  //  下行）；清单顺序即执行顺序；映射预览在 confirm 阶段呈现并随策略切换
  //  重算（磁盘已有探测缓存于 confirm 进入时——准备阶段固定映射快照）。
  //  T06（#626）合并模式共用同一清单数据面（batchItems/batchOpChain/
  //  nextBatchId）——消费面换 mergeJob（单产物两段式）。 ----
  let mode: 'document' | 'batch' | 'merge' = 'document'
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
  /** 结果表聚合（双轴评审 P3）：整批轮与单项重试轮共用——job 单轮 state
   *  只含本轮条目，此处按 id 原位归并（mergeBatchResults 单一事实源），
   *  重试后既有成功/跳过记录不丢 */
  let batchResults: PdfBatchResultEntry[] = []
  /** 批量异步操作串行链（收集/对话框/探测不得交错——消息到达序即用户
   *  操作序，晚到的增删看到一致的清单中间态） */
  let batchOpChain: Promise<void> = Promise.resolve()
  const enqueueBatchOp = (op: () => Promise<void>): void => {
    batchOpChain = batchOpChain.then(op, op)
  }
  const nextBatchId = (): string => `b${++batchIdSeq}`

  // ---- T07（#627）同模态 PDF 预览：会话级代次模型与产物存储 ----
  // 统一代次模型（合并/批量 job 不补 generation 字段——既有状态面不动）：
  // - previewGen 每次发布（刷新完成或导出产物回填）单调 +1；previewResetToken
  //   在模态关闭/切换模式时 +1。迟到回包 = 旧代次或旧令牌，一律丢弃——
  //   不覆盖新结果、不复活旧预览（连续刷新、关闭后迟到、导出让位同守卫）；
  // - 过期判定单一事实源：pdfPreviewFingerprint（shared）——webview 以
  //   state 下发的目标身份 + 本地参数就地比较（参数/清单/选中条目/输入
  //   版本任一变化即失配）；宿主在导出发起时以同一函数核对相等才允许
  //   字节复用（「新一轮 run 重置」语义由会话层 reset 承担）。
  let previewGen = 0
  let previewResetToken = 0
  let previewPhase: 'idle' | 'generating' | 'ready' | 'failed' = 'idle'
  let previewFailReason: string | undefined
  /** 捕获或生成在途（同一时刻至多一轮——连续刷新不叠加启动生成任务） */
  let previewBusy = false
  let previewStore: {
    generation: number
    fingerprint: string
    bytes: Buffer
    bookmarks: NonNullable<PdfExportJobState['bookmarks']>
    failures: PdfExportFailureItem[]
  } | undefined
  /** 批量模式选中预览条目（缺省首条；被移除时回退首条——见 previewTargetOf） */
  let previewBatchItemId: string | undefined
  /** 条目 fsPath → 最近一次捕获的权威版本（批量/合并目标身份数据面） */
  const previewItemVersions = new Map<string, number>()
  let previewRuns = 0
  let previewCancels = 0
  let previewLastExportReused = false
  /** open 时刻的源与选区（刷新预览 = 新一轮固定输入，按原选区重新捕获） */
  let activeSource: PdfExportDocumentSource | undefined
  let activeSelection: readonly PdfSelectionRange[] | undefined

  const hostToday = (): string => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  }

  const previewJob = new PdfPreviewJob({
    resolveBrowser: resolveBrowserPort,
    createSession: createSessionPort,
    locale: () => hostLocale(getSettingsSnapshot()),
  })

  /** 当前预览目标身份（随 state 下发——webview 与本地参数合成指纹比较） */
  const previewTargetOf = (): PdfPreviewTarget | undefined => {
    if (mode === 'document') {
      const input = fixedInput
      if (input === undefined) return undefined
      return {
        kind: 'document',
        doc: {
          docName: input.docName,
          capturedVersion: input.capturedVersion,
          ...(input.payload.fragments !== undefined
            ? { fragments: input.payload.fragments.map((f) => [f.start, f.end] as const) }
            : {}),
        },
      }
    }
    if (mode === 'batch') {
      const selected = batchItems.find((i) => i.id === previewBatchItemId) ?? batchItems[0]
      if (selected === undefined) return undefined
      return {
        kind: 'batchItem',
        fsPath: selected.fsPath,
        doc: {
          docName: selected.fsPath.split('/').pop() ?? selected.fsPath,
          capturedVersion: previewItemVersions.get(selected.fsPath) ?? 0,
        },
      }
    }
    if (batchItems.length === 0) return undefined
    return {
      kind: 'merge',
      fsPaths: batchItems.map((i) => i.fsPath),
      versions: batchItems.map((i) => previewItemVersions.get(i.fsPath) ?? 0),
    }
  }

  /** 批量模式生效中的预览条目 id（选中条目被移除时回退首条） */
  const effectivePreviewItemId = (): string | undefined =>
    mode === 'batch'
      ? (batchItems.find((i) => i.id === previewBatchItemId) ?? batchItems[0])?.id
      : undefined

  /** 就绪产物复用核对：参数与固定输入身份（含每篇另起一页与页眉日期）与
   *  产物代次指纹严格相等才复用——过期 PDF 不得当作当前设置结果 */
  const previewReusable = (options: PdfExportOptions, pageBreak: boolean): PdfExportPrecomputed | undefined => {
    if (previewStore === undefined || previewPhase !== 'ready' || previewBusy) return undefined
    const target = previewTargetOf()
    if (target === undefined) return undefined
    if (pdfPreviewFingerprint({ options, target, pageBreak, today: hostToday() }) !== previewStore.fingerprint) {
      return undefined
    }
    // 双轴评审 P2-002：预览在缺资源时**自动继续**（只读核对面——正文保留可见
    // 说明）。但最终导出必须让用户就「继续/取消」做出选择（规格 §2.3）；把
    // 带失败项的预览字节直接复用会静默跳过该确认。带 failures 时不复用，
    // 走正常生成链重新呈现确认。
    if (previewStore.failures.length > 0) return undefined
    return { bytes: previewStore.bytes, bookmarks: previewStore.bookmarks }
  }

  /** 导出发起/重新执行命令时让位：作废在途预览（代次推进——迟到回包丢弃） */
  const cancelInFlightPreview = (): void => {
    if (!previewBusy) return
    previewGen++
    if (previewJob.isRunning) {
      previewJob.cancel()
      previewCancels++
    }
    previewBusy = false
    previewPhase = previewStore !== undefined ? 'ready' : 'idle'
    previewFailReason = undefined
  }

  /** 预览会话整体重置（关闭模态/切换模式）：重开不显示上一会话预览 */
  const resetPreviewSession = (): void => {
    cancelInFlightPreview()
    previewResetToken++
    previewGen++
    previewStore = undefined
    previewPhase = 'idle'
    previewFailReason = undefined
    previewBatchItemId = undefined
    previewItemVersions.clear()
    previewLastExportReused = false
  }

  const pushPreviewArtifact = (): void => {
    if (panel === undefined || previewStore === undefined) return
    void panel.webview.postMessage({
      kind: 'pdfExportModal.previewArtifact',
      generation: previewStore.generation,
      base64: previewStore.bytes.toString('base64'),
    })
  }

  /** 发布就绪产物：状态置 ready 并推送字节（generation 由调用方给定——
   *  刷新轮 = 该轮请求代次（不推进 previewGen，保 continuation 的 finally
   *  守卫成立以复位 busy）；导出回填 = ++previewGen 的新代次） */
  const adoptPreviewBytes = (
    generation: number,
    fingerprint: string,
    bytes: Buffer,
    bookmarks: NonNullable<PdfExportJobState['bookmarks']>,
    failures: PdfExportFailureItem[],
  ): void => {
    previewStore = { generation, fingerprint, bytes, bookmarks, failures }
    previewPhase = 'ready'
    previewFailReason = undefined
    notifyState()
    pushPreviewArtifact()
  }

  /** 手动刷新预览：新一轮固定输入重新捕获（规格 §2.1——不复用上一轮输入）
   *  → 与导出同一 createBrowserExportSession 管线产出字节。连续刷新/导出
   *  运行中不叠加发起（不因重复输入反复启动生成任务）。 */
  const refreshPreview = (rawParams: unknown, pageBreak: boolean): void => {
    if (previewBusy || job.isRunning || batchJob.isRunning || mergeJob.isRunning) return
    const { defaults, browserPath } = defaultsFromSettings(getSettingsSnapshot())
    const params = normalizePdfExportOptions(rawParams, defaults)
    const gen = ++previewGen
    const token = previewResetToken
    previewBusy = true
    previewRuns++
    previewPhase = 'generating'
    previewFailReason = undefined
    notifyState()
    void (async () => {
      let fingerprintTarget: PdfPreviewTarget | undefined
      let payload: PdfExportInputPayload | undefined
      try {
        if (mode === 'document') {
          const source = activeSource
          if (source === undefined) {
            // 无源（防御：单文档模式恒有 open 源）——回 idle 不冒充失败
            previewPhase = 'idle'
            return
          }
          if (fixedInput === undefined) {
            // 固定输入捕获尚未完成（open 后捕获在途——UI 刷新按钮此时禁用；
            // 本路径仅在捕获竞态下可达）：回 idle，用户稍后再刷新
            previewPhase = 'idle'
            return
          }
          // 新一轮固定内容：按 open 时刻的选区重新捕获全文并切片（钳制兜底）
          const input = await captureInput(source, activeSelection)
          if (gen !== previewGen || token !== previewResetToken) return
          fixedInput = input
          payload = input.payload
        } else if (mode === 'batch') {
          const item = batchItems.find((i) => i.id === previewBatchItemId) ?? batchItems[0]
          if (item === undefined) {
            // 空清单无可预览目标：静默回 idle（不构成失败）
            previewPhase = 'idle'
            return
          }
          batchWindowCapture = await sessionDeps.captureBatchWindowInput()
          if (gen !== previewGen || token !== previewResetToken) return
          const captured = await makeCaptureDocPort()(item.fsPath)
          if (gen !== previewGen || token !== previewResetToken) return
          if (!('payload' in captured) || !captured.payload) throw new Error('capture-failed')
          previewItemVersions.set(item.fsPath, captured.capturedVersion)
          payload = captured.payload
        } else {
          if (batchItems.length === 0) {
            previewPhase = 'idle'
            return
          }
          batchWindowCapture = await sessionDeps.captureBatchWindowInput()
          if (gen !== previewGen || token !== previewResetToken) return
          const captureDoc = makeCaptureDocPort()
          const captured: PdfBatchCapturedDoc[] = []
          for (const item of batchItems) {
            const outcome = await captureDoc(item.fsPath)
            if (gen !== previewGen || token !== previewResetToken) return
            if (!('payload' in outcome) || !outcome.payload) throw new Error('capture-failed')
            previewItemVersions.set(item.fsPath, outcome.capturedVersion)
            captured.push(outcome)
          }
          const raw = batchWindowCapture
          payload = buildPdfMergePayload([captured[0]!, ...captured.slice(1)], {
            style: raw.style ?? {
              dark: vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark
                || vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast,
              vars: {},
              reading: {},
            },
            snippets: raw.snippets,
            breaks: raw.breaks,
          }, pageBreak)
        }
        fingerprintTarget = previewTargetOf()
        if (fingerprintTarget === undefined || payload === undefined) throw new Error('no-preview-target')
        const fingerprint = pdfPreviewFingerprint({ options: params, target: fingerprintTarget, pageBreak, today: hostToday() })
        // 资源服务守卫登记（预览任务的固定输入数据面）
        knownDocFsPaths.clear()
        for (const doc of payload.docs) knownDocFsPaths.add(doc.fsPath)
        if (payload.merge !== undefined) {
          for (const entry of payload.merge.docs) knownDocFsPaths.add(entry.doc.fsPath)
        }
        const result = await previewJob.run({
          payload,
          options: params,
          browserPath: browserPath.trim() || undefined,
        })
        if (gen !== previewGen || token !== previewResetToken) return
        if (result.ok) {
          adoptPreviewBytes(gen, fingerprint, result.bytes, result.bookmarks, result.failures)
        } else if (result.reason === 'cancelled') {
          previewPhase = previewStore !== undefined ? 'ready' : 'idle'
        } else {
          previewPhase = 'failed'
          previewFailReason = result.reason
        }
      } catch (error) {
        if (gen !== previewGen || token !== previewResetToken) return
        previewPhase = 'failed'
        previewFailReason = error instanceof Error && error.message === 'capture-failed' ? 'capture-failed' : 'internal'
      } finally {
        if (gen === previewGen && token === previewResetToken) {
          previewBusy = false
          knownDocFsPaths.clear()
          notifyState()
        }
      }
    })()
  }

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
        results: batchResults,
        resourceIssues: batchJob.state.resourceIssues,
        failReason: batchJob.state.failReason,
        hookedTargetDir: hookedBatchTargetDir,
      }
    : mode === 'merge'
      ? {
          mode: 'merge' as const,
          // 合并阶段直读 mergeJob（editing 由模态会话管理；终态后保持——
          // 与批量 batchPhase 的终态滞留语义一致；idle 是 run 前瞬态，
          // 映射 running 与 batchPhase 观测一致）
          phase: batchPhase === 'editing'
            ? 'editing' as const
            : mergeJob.state.phase === 'idle' ? 'running' as const : mergeJob.state.phase,
          items: batchItems,
          currentIndex: mergeJob.state.currentIndex,
          total: mergeJob.state.total,
          currentName: mergeJob.state.currentName,
          resourceIssues: mergeJob.state.resourceIssues,
          failReason: mergeJob.state.failReason,
          failDetail: mergeJob.state.failDetail,
          savedPath: mergeJob.state.savedPath,
          bookmarks: mergeJob.state.bookmarks,
          hookedSaveTarget,
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

  /** 批量产物写盘：目标目录按需创建 + 临时文件 + 原子落位（失败清理临时
   *  文件）。
   *  overwrite=true：显式覆盖策略/保存对话框已确认——原子替换旧文件。
   *  overwrite=false：白名单策略（自动更名/跳过）的无覆盖提交——rename
   *  不带 replace，目标在写入瞬间已存在即抛 PdfExportTargetExistsError；
   *  调用方（batch job）换下一编号候选重试，绝不静默覆盖。
   *  T08 remote：产物落本机——经执行端分块写盘命令（远端 workspace.fs
   *  是远端盘；原子与排他语义由执行端承担，路径为本机真实路径） */
  const writeBatchFile = async (targetPath: string, bytes: Uint8Array, overwrite = true): Promise<void> => {
    if (remoteAdapter !== undefined) {
      await remoteAdapter.writeFile(targetPath, bytes, overwrite)
      return
    }
    const target = vscode.Uri.file(targetPath)
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, '..'))
    const tmp = `${targetPath}.vsidian-tmp-${randomUUID()}`
    try {
      await vscode.workspace.fs.writeFile(vscode.Uri.file(tmp), Buffer.from(bytes))
      await vscode.workspace.fs.rename(vscode.Uri.file(tmp), target, { overwrite })
    } catch (error) {
      await vscode.workspace.fs.delete(vscode.Uri.file(tmp)).then(() => undefined, () => undefined)
      if (!overwrite && isFileExistsError(error)) {
        throw new PdfExportTargetExistsError(targetPath)
      }
      throw error
    }
  }

  /** 排他落位撞上已存在目标的判定（FileSystemError 与底层 EEXIST 两形态） */
  const isFileExistsError = (error: unknown): boolean => {
    if (error instanceof vscode.FileSystemError) return error.code === 'FileExists'
    const message = error instanceof Error ? error.message : String(error)
    return /EEXIST|file exists|already exists/i.test(message)
  }

  /** 条目级捕获端口（T04 批量与 T06 合并共用）：provider 固定输入 + 窗口
   *  级件并入 + 资源服务守卫登记（主条目 + 嵌入目标身份——捕获成功即登记，
   *  renderPage 资源请求在捕获之后，时序上先于页面装载） */
  const makeCaptureDocPort = () => async (fsPath: string) => {
    const outcome = await sessionDeps.capturePdfBatchDoc(fsPath)
    if (!outcome.ok) return outcome
    const window = batchWindowCapture
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
  }

  const batchJob = new PdfBatchJob({
    resolveBrowser: resolveBrowserPort,
    createSession: createSessionPort,
    captureDoc: makeCaptureDocPort(),
    writeFile: writeBatchFile,
    locale: () => hostLocale(getSettingsSnapshot()),
  })
  batchJob.onStateChange = () => {
    // 批量 job 阶段映射（done/cancelled/failed 终态后保持——结果表呈现）
    const phase = batchJob.state.phase
    if (phase === 'running' || phase === 'awaiting-resources' || phase === 'done' || phase === 'cancelled' || phase === 'failed') {
      batchPhase = phase
    }
    // 结果聚合：job 单轮结果按 id 原位归并（重试轮替换失败条目、保留其余）
    if (batchJob.state.results.length > 0) {
      batchResults = mergeBatchResults(batchResults, batchJob.state.results)
    }
    if (phase === 'idle' || phase === 'done' || phase === 'cancelled' || phase === 'failed') {
      knownDocFsPaths.clear()
    }
    notifyState()
  }

  // ---- T06（#626）合并模式执行器：同一清单数据面按合并语义消费（单产物
  //  两段式；保存对话框/写盘/释放与单文档同口径——取消/失败不留伪成功） ----
  const mergeJob = new PdfMergeJob({
    resolveBrowser: resolveBrowserPort,
    createSession: createSessionPort,
    captureDoc: makeCaptureDocPort(),
    showSaveDialog: saveDialogPort,
    writeFile: writeBatchFile,
    locale: () => hostLocale(getSettingsSnapshot()),
  })
  mergeJob.onStateChange = () => {
    const phase = mergeJob.state.phase
    if (phase === 'idle' || phase === 'done' || phase === 'cancelled' || phase === 'failed') {
      knownDocFsPaths.clear()
    }
    notifyState()
  }

  /** T06（#626）合并执行：窗口级固定输入一次捕获（style 兜底）+ 全部主条目
   *  身份预登记（嵌入目标随逐篇捕获补登记——见 makeCaptureDocPort）。
   *  T07（#627）：指纹核对相等的合并预览字节直接复用（跳过捕获与浏览器
   *  生成，仅保存对话框与写盘）；预览在途时先让位取消。 */
  const startMergeRun = async (params: PdfExportOptions, pageBreak: boolean): Promise<void> => {
    if (mergeJob.isRunning || batchJob.isRunning || job.isRunning) return
    cancelInFlightPreview()
    const reuse = previewReusable(params, pageBreak)
    previewLastExportReused = reuse !== undefined
    let plan: PdfMergeRunPlan
    if (reuse !== undefined) {
      plan = {
        items: batchItems,
        options: params,
        pageBreak,
        window: {
          style: { dark: false, vars: {}, reading: {} },
          snippets: [],
          breaks: false,
        },
        browserPath: undefined,
        precomputed: reuse,
      }
    } else {
      lastHtml = undefined
      lastSnapshot = undefined
      hookedSaveTarget = undefined
      const raw = await sessionDeps.captureBatchWindowInput()
      batchWindowCapture = raw
      plan = {
        items: batchItems,
        options: params,
        pageBreak,
        window: {
          style: raw.style ?? {
            dark: vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.Dark
              || vscode.window.activeColorTheme.kind === vscode.ColorThemeKind.HighContrast,
            vars: {},
            reading: {},
          },
          snippets: raw.snippets,
          breaks: raw.breaks,
        },
        browserPath: defaultsFromSettings(getSettingsSnapshot()).browserPath.trim() || undefined,
      }
    }
    batchPhase = 'running'
    notifyState()
    for (const item of batchItems) {
      knownDocFsPaths.add(item.fsPath)
    }
    void mergeJob.run(plan).then((state) => {
      if (state.phase === 'done' && state.savedPath !== undefined) {
        void vscode.window.showInformationMessage(t('pdfExport.savedTo', { path: state.savedPath }))
      }
    })
  }

  /** confirm 进入：枚举目标目录真实占用 + 首版映射（T08 remote：目标目录
   *  在本机——占用枚举经执行端目录命令）。
   *
   *  双轴评审 P2-003 复核：rename 的占用判定必须枚举**目录里实际存在的
   *  文件**，不能按固定编号上限猜候选（既有 `name (201).pdf` 会漏出探测面，
   *  随后被当作空闲覆盖）。占用集交给 planBatchMapping/nextAvailableTargetPath
   *  统一裁决；命名序列本身没有上限假设。 */
  const enterBatchConfirm = async (targetDir: string): Promise<void> => {
    batchTargetDir = targetDir
    const dir = targetDir.replace(/\/+$/, '')
    const nominalTargets = batchItems.map((item) =>
      `${dir}/${item.relPath.replace(/\.(md|markdown)$/i, '.pdf')}`)
    const listings = new Map<string, string[]>()
    const dirs = new Set<string>()
    for (const target of nominalTargets) {
      const slash = target.lastIndexOf('/')
      if (slash > 0) dirs.add(target.slice(0, slash))
    }
    if (remoteAdapter !== undefined) {
      for (const entry of dirs) {
        listings.set(entry, await remoteAdapter.listDirectory(entry))
      }
    } else {
      await Promise.all([...dirs].map(async (entry) => {
        try {
          const children = await vscode.workspace.fs.readDirectory(vscode.Uri.file(entry))
          listings.set(entry, children.map(([name]) => name))
        } catch {
          listings.set(entry, []) // 目录不存在/不可读 = 无既有占用
        }
      }))
    }
    batchExisting = new Set(occupiedTargetsFromListings(nominalTargets, (entry) => listings.get(entry) ?? []))
    batchMapping = planBatchMapping(batchItems, targetDir, batchStrategy, batchExisting)
    batchPhase = 'confirm'
    notifyState()
  }

  /** 批量执行：窗口级固定输入一次捕获 + knownDocFsPaths 登记（全批条目与
   *  其嵌入目标——资源服务守卫数据面）。T07：批量永不复用预览字节（预览
   *  只覆盖单条目——部分覆盖不得进导出）；预览在途时先让位取消。 */
  const startBatchRun = async (params: PdfExportOptions): Promise<void> => {
    if (batchJob.isRunning || job.isRunning) return
    cancelInFlightPreview()
    previewLastExportReused = false
    batchResults = []
    batchWindowCapture = await sessionDeps.captureBatchWindowInput()
    const plan: PdfBatchRunPlan = {
      items: batchItems,
      mapping: new Map((batchMapping ?? []).map((entry) => [entry.id, entry])),
      options: params,
      strategy: batchStrategy,
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

  /** 失败项单项重试（双轴评审 P3，规格 §2.5「失败项可据清单重新发起」）：
   *  终态结果表上按 id 重发单项——复用既有 batchJob 与该条目的映射计划
   *  （目标路径与策略沿用本轮 confirm 固定值），新一轮固定输入重新捕获
   *  （窗口级件 + 该文档）；结果经 batchResults 原位归并（成功/跳过不丢）。
   *  结构性取舍：不把「单条重入」做进 job 状态机——单项计划即同一状态机
   *  的单元素输入，job 逻辑零改动。phase 在同步段先置 running——终态
   *  观察面不残留旧 done（重试发起即离开上一轮终态）。 */
  const retryBatchItem = (id: string, params: PdfExportOptions): void => {
    if (mode !== 'batch' || batchJob.isRunning || job.isRunning || mergeJob.isRunning) return
    const item = batchItems.find((i) => i.id === id)
    const mapping = batchMapping?.find((m) => m.id === id)
    if (item === undefined || mapping === undefined || mapping.action === 'skip') return
    cancelInFlightPreview()
    batchPhase = 'running'
    notifyState()
    void (async () => {
      batchWindowCapture = await sessionDeps.captureBatchWindowInput()
      knownDocFsPaths.add(item.fsPath)
      notifyState()
      await batchJob.run({
        items: [item],
        mapping: new Map([[id, mapping]]),
        options: params,
        strategy: batchStrategy,
        browserPath: defaultsFromSettings(getSettingsSnapshot()).browserPath.trim() || undefined,
      })
    })()
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
    bookmarks: job.state.bookmarks,
    embedStats,
    fragmentCount,
    lastSnapshot,
    modalCsp,
    modalPreviewAssetsReady,
    remote: {
      active: remoteAdapter !== undefined,
      browserResolved: remoteResolveObserved?.ok,
      ...(remoteResolveObserved?.ok ? { browserKind: remoteResolveObserved.kind } : {}),
    },
    batch: batchInfo(),
    preview: {
      phase: previewPhase,
      generation: previewStore?.generation ?? previewGen,
      fingerprint: previewStore?.fingerprint,
      byteLength: previewStore?.bytes.length ?? 0,
      bytesSha256: previewStore !== undefined
        ? createHash('sha256').update(previewStore.bytes).digest('hex')
        : '',
      bookmarks: previewStore?.bookmarks,
      failures: previewStore?.failures,
      failReason: previewFailReason,
      target: previewTargetOf(),
      batchItemId: effectivePreviewItemId(),
      busy: previewBusy,
      lastExportReused: previewLastExportReused,
      runs: previewRuns,
      cancels: previewCancels,
    },
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
      ...(job.state.bookmarks !== undefined ? { bookmarks: job.state.bookmarks } : {}),
      ...(job.state.resourceIssues !== undefined
        ? { resourceIssues: job.state.resourceIssues.map((issue) => ({ kind: issue.kind, item: issue.item, reason: issue.reason })) }
        : {}),
      // T04（#624）批量 / T06（#626）合并模式状态（单文档模式不携带——
      // 既有字段零改动；合并形态经 batchInfo 的 merge 分支）
      ...(mode !== 'document' ? { batch: batchInfo() } : {}),
      // T07（#627）预览状态（含当前目标身份与宿主侧日期——webview 就地
      //  合成指纹做过期比较，与宿主导出复用核对同一函数）
      preview: {
        phase: previewPhase,
        generation: previewStore?.generation ?? previewGen,
        ...(previewStore !== undefined ? { fingerprint: previewStore.fingerprint } : {}),
        ...(previewStore?.bookmarks !== undefined ? { bookmarks: previewStore.bookmarks } : {}),
        ...(previewStore !== undefined && previewStore.failures.length > 0
          ? { failures: previewStore.failures.map((issue) => ({ kind: issue.kind, item: issue.item, reason: issue.reason })) }
          : {}),
        ...(previewFailReason !== undefined ? { failReason: previewFailReason } : {}),
        ...(effectivePreviewItemId() !== undefined ? { batchItemId: effectivePreviewItemId() } : {}),
      },
      ...(previewTargetOf() !== undefined ? { previewTarget: previewTargetOf()! } : {}),
      hostToday: hostToday(),
    })
  }
  job.onStateChange = () => {
    if (job.state.phase === 'idle' || job.state.phase === 'done' || job.state.phase === 'failed' || job.state.phase === 'cancelled') {
      knownDocFsPaths.clear()
    }
    notifyState()
  }

  /** 固定输入捕获：在途编辑落地后读权威全文 + 嵌入预取 + 样式快照 + 片段
   *  （此后任务只消费该 payload；样式快照超时降级空快照不阻塞捕获）。
   *  T03 选区模式：全文与嵌入预取照读（docs[0] 携带全文——超集语义与
   *  docStyle 收集面不变），另按选区切严格片段（whenEditsSettled 后切片
   *  ——选区读取与全文同源 LF 坐标，命令打断输入后无新增编辑，切片不漂移；
   *  钳制为最后防线）；选区在归一化后为空（全部纯光标）则按无有效选区
   *  报错（命令层已拦截，防御兜底） */
  const captureInput = async (source: PdfExportDocumentSource, selection?: readonly PdfSelectionRange[]): Promise<PdfExportInput> => {
    await source.session.whenEditsSettled()
    const lfText = source.document.getText().replace(/\r\n?/g, '\n')
    const docName = path.basename(source.uri.fsPath || 'document.md')
    const [embeds, style, snippets] = await Promise.all([
      prefetchEmbedTargets(lfText, { readTarget: (inner) => source.readEmbedTarget(inner) }),
      source.requestStyleSnapshot().catch(() => null),
      source.snippetEntries().catch(() => [] as PdfExportSnippetEntry[]),
    ])
    embedStats = { embeds: embeds.embeds.length, mediaEmbeds: embeds.mediaEmbeds.length, failures: embeds.embedFailures.length }
    const fragments = selection !== undefined ? sliceSelectionFragments(lfText, selection) : undefined
    fragmentCount = fragments?.length ?? 0
    if (fragments !== undefined && fragments.length === 0) {
      throw new Error('pdf-export-empty-selection')
    }
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
        ...(fragments !== undefined ? { fragments } : {}),
      },
    }
  }

  /** T04（#624）/T06（#626）清单模式消息族处理（清单编辑经消息上行——
   *  宿主为清单权威；增删调序两模式共用，run/confirm/策略按模式分治；
   *  对话框为生产唯一入口，paths/path/targetDir 仅 VSIDIAN_TEST_HOOKS 门控
   *  下消费；收集/探测类操作经 batchOpChain 串行——消息到达序即用户操作序） */
  const handleBatchMessage = (message: { kind: string; paths?: unknown; path?: unknown; targetDir?: unknown; id?: unknown; direction?: unknown; strategy?: unknown; params?: unknown; all?: unknown; pageBreak?: unknown }): void => {
    if (mode !== 'batch' && mode !== 'merge') return
    const editingLocked = batchJob.isRunning || mergeJob.isRunning
    switch (message.kind) {
      case 'pdfExportModal.batch.addFiles': {
        if (editingLocked) return
        enqueueBatchOp(async () => {
          let files: string[] | undefined
          const injected = message.paths
          // 路径统一经 Uri.file 归一形态（Windows 盘符大小写/分隔符——与
          // 对话框结果同款，避免同文件因来源不同形成异形身份）
          if (Array.isArray(injected) && injected.every((p) => typeof p === 'string') && testHooksActive()) {
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
          if (typeof injected === 'string' && injected !== '' && testHooksActive()) {
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
        if (mode !== 'batch' || batchJob.isRunning || batchItems.length === 0) return
        enqueueBatchOp(async () => {
          let targetDir: string | undefined
          if (testHooksActive()) {
            // 测试钩子短路：注入目录优先（用例预置已有文件后探测；remote
            // e2e 经 marker.targetDir 注入本机目录——产物真实落盘可断言），
            // 缺省自动临时目录；经观测面暴露
            const marker = readPdfRemoteTestHooks(undefined, workspaceRootOf())
            const injected = typeof message.targetDir === 'string' && message.targetDir !== '' ? message.targetDir : marker?.targetDir
            if (injected) {
              targetDir = injected.replaceAll('\\', '/')
              hookedBatchTargetDir = targetDir
            } else {
              const dir = mkdtempSync(path.join(tmpdir(), 'vsidian-pdfbatch-test-'))
              hookedBatchTargetDir = dir.replaceAll('\\', '/')
              targetDir = hookedBatchTargetDir
            }
          } else if (remoteAdapter !== undefined) {
            // T08 remote：产物落本机——目标目录在本机选（远端 showOpenDialog
            // 浏览的是远端 fs，两者不是同一台机器的盘）
            const picked = await remoteAdapter.showOpenDialogDir()
            targetDir = picked?.replaceAll('\\', '/')
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
      case 'pdfExportModal.merge.run': {
        // T06（#626）合并入口：清单即合篇顺序（无目标目录/映射/策略——单
        // 产物保存对话框在生成后弹出，与单文档导出同时序）
        if (mode !== 'merge' || mergeJob.isRunning || batchJob.isRunning || batchItems.length === 0) return
        const { defaults } = defaultsFromSettings(getSettingsSnapshot())
        const params = normalizePdfExportOptions(message.params as Record<string, unknown> | undefined, defaults)
        void startMergeRun(params, message.pageBreak === true)
        return
      }
      case 'pdfExportModal.batch.setStrategy': {
        if (mode !== 'batch' || batchPhase !== 'confirm' || !isPdfBatchConflictStrategy(message.strategy)) return
        batchStrategy = message.strategy
        batchMapping = planBatchMapping(batchItems, batchTargetDir!, batchStrategy, batchExisting)
        notifyState()
        return
      }
      case 'pdfExportModal.batch.confirm': {
        if (mode !== 'batch' || batchPhase !== 'confirm' || batchJob.isRunning) return
        const { defaults } = defaultsFromSettings(getSettingsSnapshot())
        const params = normalizePdfExportOptions(message.params as Record<string, unknown> | undefined, defaults)
        void startBatchRun(params)
        return
      }
      case 'pdfExportModal.batch.cancel': {
        if (mode === 'merge' && mergeJob.isRunning) {
          mergeJob.cancel()
          return
        }
        if (mode === 'batch' && batchJob.isRunning) {
          batchJob.cancel()
          return
        }
        // confirm/done/cancelled/failed → 回到清单编辑（映射丢弃，新一轮
        // 重新选择目标目录与探测——上一轮未完成结果不复用；合并同口径：
        // done 后返回 = 新一轮重新固定输入）
        if (batchPhase !== 'editing') {
          batchPhase = 'editing'
          batchMapping = undefined
          batchTargetDir = undefined
          batchExisting = new Set()
          batchResults = []
          notifyState()
        }
        return
      }
      case 'pdfExportModal.batch.resume': {
        if (mode === 'merge') {
          mergeJob.resolveResourceChoice(message.all === true ? 'resume-all' : 'resume')
          return
        }
        batchJob.resolveResourceChoice(message.all === true ? 'resume-all' : 'resume')
        return
      }
      case 'pdfExportModal.batch.retryItem': {
        // 失败项单项重试（终态结果表入口；params 为 webview 当前控件值）
        if (mode !== 'batch' || typeof message.id !== 'string') return
        const { defaults } = defaultsFromSettings(getSettingsSnapshot())
        const params = normalizePdfExportOptions(message.params as Record<string, unknown> | undefined, defaults)
        void retryBatchItem(message.id, params)
        return
      }
      default:
        return
    }
  }

  /** T07（#627）预览消息族：手动刷新与批量条目选择（清单/输入权威在宿主，
   *  过期判定在 webview 经目标身份 + 本地参数指纹比较） */
  const handlePreviewMessage = (message: { kind: string; params?: unknown; pageBreak?: unknown; itemId?: unknown }): void => {
    switch (message.kind) {
      case 'pdfExportModal.preview.refresh': {
        refreshPreview(message.params, message.pageBreak === true)
        return
      }
      case 'pdfExportModal.preview.select': {
        if (mode === 'batch' && !batchJob.isRunning && typeof message.itemId === 'string'
          && batchItems.some((i) => i.id === message.itemId)) {
          previewBatchItemId = message.itemId
          notifyState()
        }
        return
      }
      default:
        return
    }
  }

  const handleMessage = (message: unknown): void => {
    if (!isWebviewToHost(message)) return
    if (typeof message.kind === 'string'
      && (message.kind.startsWith('pdfExportModal.batch.') || message.kind.startsWith('pdfExportModal.merge.'))) {
      handleBatchMessage(message)
      return
    }
    if (typeof message.kind === 'string' && message.kind.startsWith('pdfExportModal.preview.')) {
      handlePreviewMessage(message)
      return
    }
    switch (message.kind) {
      case 'pdfExportModal.get':
        notifyState()
        // webview 会话内重挂载（面板 retained 后重载）：重推当前预览产物
        pushPreviewArtifact()
        return
      case 'pdfExportModal.run': {
        if (!fixedInput) return
        cancelInFlightPreview()
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
        // T07（#627）预览产物复用：指纹核对相等（参数 + 固定输入身份）时
        // 导出直接消费预览管线字节——与预览同源同代次，过期预览不进导出
        const reuse = previewReusable(params, false)
        previewLastExportReused = reuse !== undefined
        void job.run(fixedInput, params, browserPath.trim() || undefined, reuse).then((result) => {
          if (result.kind === 'done') {
            void vscode.window.showInformationMessage(t('pdfExport.savedTo', { path: result.state.savedPath ?? '' }))
            // 导出产物回填预览（单文档 run 返回字节；指纹不同才更新推送）
            const target = previewTargetOf()
            if (result.bytes !== undefined && target !== undefined && !previewBusy) {
              const fingerprint = pdfPreviewFingerprint({ options: params, target, today: hostToday() })
              if (previewStore?.fingerprint !== fingerprint) {
                adoptPreviewBytes(
                  ++previewGen,
                  fingerprint,
                  result.bytes,
                  result.state.bookmarks ?? { written: false, total: 0, skipped: 0, reason: 'disabled' },
                  [],
                )
              }
            }
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
    const built = buildPdfExportModalHtml(
      created.webview,
      context.extensionUri,
      hostLocale(getSettingsSnapshot()),
    )
    created.webview.html = built.html
    modalCsp = built.csp
    modalPreviewAssetsReady = built.assetsReady
    const messageSub = created.webview.onDidReceiveMessage(handleMessage)
    created.onDidDispose(() => {
      messageSub.dispose()
      panel = undefined
      // 关闭模态：取消在途任务并释放（规格 §2.5 配对释放；未完成产物不落盘）
      job.dispose()
      batchJob.dispose()
      mergeJob.dispose()
      previewJob.dispose()
      // 预览会话终结：重置代次与产物（重开 = 全新会话，不显示上一会话预览）
      resetPreviewSession()
      knownDocFsPaths.clear()
      lastPaint = undefined
      // 固定输入一并作废（T08 e2e 实证：闭包变量跨会话残留会让重开后的
      // 极早期 run 消费上一会话输入——新一轮 open 的捕获在途时旧输入仍可答）
      fixedInput = undefined
      sourceDirForDialog = undefined
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
      batchResults = []
    })
  }

  /** 清单模式收口：切换/重开均进入新清单会话——取消在途任务并重置清单
   *  与策略选择（上一会话的策略选择不跨会话残留；open(source) 同款
   *  「重新执行命令 = 新一轮输入」语义；单文档任务在途时取消让位） */
  const enterListMode = (next: 'batch' | 'merge'): void => {
    job.cancel()
    batchJob.cancel()
    mergeJob.cancel()
    // 切换模式 = 新清单会话：预览代次与产物整体重置（目标身份形态已变）
    resetPreviewSession()
    mode = next
    batchPhase = 'editing'
    batchItems = []
    batchMapping = undefined
    batchTargetDir = undefined
    batchExisting = new Set()
    batchStrategy = 'rename'
    hookedBatchTargetDir = undefined
    batchWindowCapture = undefined
    batchResults = []
    notifyState()
  }

  const open = (source: PdfExportDocumentSource, selection?: readonly PdfSelectionRange[]): void => {
    sourceDirForDialog = source.uri.scheme === 'file'
      ? vscode.Uri.file(path.dirname(source.uri.fsPath))
      : vscode.workspace.workspaceFolders?.[0]?.uri
    // 重新执行命令 = 新一轮输入：在途预览让位（迟到回包按代次丢弃）
    cancelInFlightPreview()
    activeSource = source
    activeSelection = selection
    if (mode !== 'document') {
      // 清单模式 → 单文档：取消在途清单任务，清单丢弃（重开清单 = 空清单）
      batchJob.cancel()
      mergeJob.cancel()
      resetPreviewSession()
      mode = 'document'
    }
    // 固定输入捕获（异步）：面板装载握手（get）早于捕获完成时以空输入态
    // 应答，捕获完成由 then 补推对齐（新一轮输入就位）
    embedStats = undefined
    fragmentCount = 0
    void captureInput(source, selection).then((input) => {
      fixedInput = input
      notifyState()
    }, (error) => {
      // 防御兜底：归一化后空选区（命令层已拦截）按无有效选区呈现，不开
      // 选区导出任务（不误触发全文导出）
      if (error instanceof Error && error.message === 'pdf-export-empty-selection') {
        void vscode.window.showWarningMessage(t('host.pdfExportSelectionEmpty'))
        return
      }
      throw error
    })
    ensurePanel()
  }

  const openBatch = (): void => {
    enterListMode('batch')
    ensurePanel()
    notifyState()
  }

  const openMerge = (): void => {
    enterListMode('merge')
    ensurePanel()
    notifyState()
  }

  return {
    open,
    openBatch,
    openMerge,
    close: () => {
      panel?.dispose()
    },
    isOpen: () => panel !== undefined,
    getInfo: info,
    injectMessage: handleMessage,
    postToWebview: (message: unknown) => {
      if (panel !== undefined) {
        void panel.webview.postMessage(message)
      }
    },
  }
}

/** 模态 HTML：CSP 与产物地址装配（settingsPage 同模式）；测试钩子标志经
 *  nonce 内联注入（webview 侧仅在该标志下发送 _test.* 绘制层探针——宿主
 *  侧门控的被动接收形态，与编辑器面板 _test 钩子同约定）。
 *  T07（#627）预览装载面（#337/#334 编辑器 webview 同口径，不另建阅读器）：
 *  - `window.__vsidianPdfAssets`：pdfMain/pdfWorker 产物与 pdfjs 资产目录
 *    的 webview 资源 URI（pdfRender.ts 的 PdfHoverView 消费——分页 canvas、
 *    有界挂载与 Blob worker 装配全部复用）；
 *  - CSP 增量三条：`worker-src blob:`（worker 经 fetch→Blob→objectURL 装配
 *    ——#334 探针实证 webview 内可行）、`connect-src ${cspSource} blob:`
 *    （worker 文本/资产 fetch 走 cspSource；预览 PDF 字节源是本页自建
 *    Blob URL）、script-src 追加 `'wasm-unsafe-eval'`（pdfjs wasm/ICC 资产
 *    编译——与 editorCsp 同款最小放行）。V01 探针的「opaque origin 下
 *    Blob 不能承载 Worker」结论针对导出浏览器内的 about:blank/data:
 *    页面，不适用于 VSCode webview（#334 已在生产 webview 实证通过）。 */
function buildPdfExportModalHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  locale: LocaleCode,
): { html: string; csp: string; assetsReady: boolean } {
  const nonce = randomUUID()
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'pdfExport.js'),
  )
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'pdfExport.css'),
  )
  const pdfAssets = {
    mainJs: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'pdfMain.js')).toString(),
    workerJs: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'pdfWorker.js')).toString(),
    cMapUrl: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'pdfjs', 'cmaps')).toString(),
    fontUrl: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'pdfjs', 'standard_fonts')).toString(),
    wasmUrl: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'pdfjs', 'wasm')).toString(),
    iccUrl: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'pdfjs', 'iccs')).toString(),
  }
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource}`,
    `script-src ${webview.cspSource} 'nonce-${nonce}' 'wasm-unsafe-eval'`,
    `style-src ${webview.cspSource}`,
    `connect-src ${webview.cspSource} blob:`,
    `worker-src blob:`,
  ].join('; ')
  const testHooksFlag = process.env.VSIDIAN_TEST_HOOKS === '1' ? 'window.__vsidianTestHooks = true;' : ''
  return {
    html: `<!DOCTYPE html>
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
<script nonce="${nonce}">${testHooksFlag}window.__vsidianPdfAssets = ${JSON.stringify(pdfAssets)};</script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`,
    csp,
    assetsReady: Object.values(pdfAssets).every((value) => value !== ''),
  }
}
