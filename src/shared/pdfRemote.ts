// PDF 导出跨宿主协议（T08/#628）：Remote SSH 会话中主扩展（workspace 侧，
// 跑在 vscode-server）与本机执行端扩展 `vsidian.pdf-executor`（ui 侧，跑在
// 本机 ext host）之间的命令协议单一事实源。两端共用，不建第二份。
//
// 依据 V02 探针（docs/research/pdf-export-remote-ssh-probe.md）实测结论：
// - 通道 = `vscode.commands.executeCommand` 跨 ext host 路由：参数/返回值
//   JSON 序列化可靠（8MB 实测），命令并行不排队；
// - Error 跨端保持 instanceof/message/name，但 **code 等自定义字段丢失**
//   ——错误码编码进 message 前缀（本模块 codec 承担），不依赖 Error.code；
// - executeCommand 无取消参数：协作式取消经第二条命令（cancelTask），
//   进度/挂起资源经轮询查询命令（queryTask）；
// - 断连后远端在途 await 无终态：调用方必须自带超时（remote 会话适配器
//   的 withTimeout 承担），超时如实报失败不伪成功。
//
// 零依赖（两端共用；不引 node:/vscode API）。

import type { PdfBookmarkReport, PdfExportFailureItem, PdfExportPagePayload, PdfExportReadyState } from './pdfExportPayload'
import type { PdfExportOptions } from './pdfExportOptions'
import type { PdfHeadingMark } from './pdfOutline'

/** 跨宿主命令通道端口（生产 = vscode.commands.executeCommand，返回
 *  Thenable；两端单测注入替身） */
export type PdfRemoteExec = (command: string, arg?: unknown) => PromiseLike<unknown>

/** 执行端扩展 id（双 VSIX 分发的第二个包；主包 onegayi.vsidian 不动） */
export const PDF_EXECUTOR_EXTENSION_ID = 'onegayi.vsidian-pdf-executor'

/** 协议版本（ping 返回；不匹配时远端按 executor-unreachable 收口——执行端
 *  旧版与主扩展新版间的形态漂移不冒充可用）。
 *  v2（#624 P2-003 复核）：writeFileAtomic 增 overwrite 标志 + 新增
 *  listDirectory——批量自动更名要在本机侧枚举目标目录真实占用并做无覆盖
 *  提交，不能靠固定编号候选猜。两包同版分发，旧执行端按缺失收口。 */
export const PDF_EXECUTOR_PROTOCOL_VERSION = 2

/** 命令族（全部在执行端注册；远端经 executeCommand 跨 ext host 调用） */
export const PDF_EXECUTOR_COMMANDS = {
  /** 能力探测：执行端在场性/浏览器解析结果/主扩展本机资产在场性 */
  ping: 'vsidian.pdfExecutor.ping',
  /** 装配导出页并等待就绪（固定输入整包传入；挂起资源经 queryTask 轮询） */
  renderPage: 'vsidian.pdfExecutor.renderPage',
  /** 打印（renderPage 成功后可达一次）；字节 base64 回传 */
  finalizePrint: 'vsidian.pdfExecutor.finalizePrint',
  /** 协作式取消：浏览器 killSync + 资源服务关闭（幂等） */
  cancelTask: 'vsidian.pdfExecutor.cancelTask',
  /** 任务态查询（进度 + 挂起资源清单——远端轮询通道） */
  queryTask: 'vsidian.pdfExecutor.queryTask',
  /** 挂起资源供给（远端读取字节后回传；与 queryTask 配对） */
  provideResources: 'vsidian.pdfExecutor.provideResources',
  /** 本机原子写盘（目录按需创建 + 临时文件 + rename；overwrite=false 时
   *  排他落位，目标已存在抛 target-exists） */
  writeFileAtomic: 'vsidian.pdfExecutor.writeFileAtomic',
  /** 本机文件 stat 探测（批量目标目录冲突映射在本机侧解析） */
  statFiles: 'vsidian.pdfExecutor.statFiles',
  /** 本机目录枚举（批量自动更名的真实占用面；目录不存在返回空） */
  listDirectory: 'vsidian.pdfExecutor.listDirectory',
  /** 本机保存对话框（返回本机路径字符串；取消 = null） */
  showSaveDialog: 'vsidian.pdfExecutor.showSaveDialog',
  /** 本机目录选择对话框（批量目标目录；取消 = null） */
  showOpenDialogDir: 'vsidian.pdfExecutor.showOpenDialogDir',
} as const

// ---- 错误编码（Error.code 跨端丢失——机器码进 message 前缀） ----

/** 执行端上抛错误的机器码前缀（远端解码还原 PdfExportBrowserError 分态） */
const ERROR_PREFIX = '[vsidian-pdf-executor]'

export function encodePdfRemoteError(code: string, message: string): Error {
  const error = new Error(`${ERROR_PREFIX}${code}: ${message}`)
  error.name = 'PdfRemoteExecutorError'
  return error
}

export interface DecodedPdfRemoteError {
  code: string
  message: string
}

/** 解码执行端错误；非本协议形态返回 undefined（调用方按内部错误收口） */
export function decodePdfRemoteError(error: unknown): DecodedPdfRemoteError | undefined {
  if (!(error instanceof Error)) return undefined
  const match = new RegExp(`^${ERROR_PREFIX.replace(/[[\]]/g, '\\$&')}([a-z-]+): (.*)$`, 's').exec(error.message)
  if (!match) return undefined
  return { code: match[1]!, message: match[2]! }
}

// ---- 消息形态（两端共用；字段可 JSON 序列化——通道只保证标准形态） ----

/** renderPage 请求（固定输入数据面 = PdfExportPagePayload 去掉本机 URL 面） */
export interface PdfRemoteRenderPageRequest {
  taskId: string
  /** mermaidUri/resBase 在执行端装配（127.0.0.1 资源服务在本机起） */
  payload: Omit<PdfExportPagePayload, 'mermaidUri' | 'resBase'>
  options: PdfExportOptions
  /** 资源服务守卫集合（远端本次固定输入登记的文档身份——/res 与 /resource 的 doc 守卫） */
  knownDocFsPaths: string[]
  /** 页码词条（远端 UI 语言——执行端 locale 可能不同，不冒充） */
  pageLabel: { pre: string; mid: string; post: string }
  /** 执行端浏览器路径覆盖（本机路径语义——设置在远端读、浏览器在本机用） */
  browserPath?: string
}

export interface PdfRemoteRenderPageResult {
  ready: boolean
  readyState: PdfExportReadyState
  failures: PdfExportFailureItem[]
  headings: PdfHeadingMark[]
}

export interface PdfRemoteFinalizePrintRequest {
  taskId: string
  options: PdfExportOptions
}

export interface PdfRemoteFinalizePrintResult {
  pdfBase64: string
  bookmarks: PdfBookmarkReport
}

/** 挂起资源条目（queryTask 返回；远端解析 + 读字节后经 provideResources 回填） */
export interface PdfRemotePendingResource {
  /** 去重键（src + doc——同资源并发请求共享一条） */
  key: string
  src: string
  doc: string | undefined
}

export interface PdfRemoteQueryTaskResult {
  known: boolean
  phase: 'rendering' | 'printing' | 'done' | 'failed' | 'cancelled'
  pending: PdfRemotePendingResource[]
}

export interface PdfRemoteResourceItem {
  key: string
  ok: boolean
  contentType?: string
  base64?: string
  reason?: 'not-found' | 'inaccessible' | 'blocked'
}

/** 分块写盘请求（V02 §3.1 单命令 8MB 实测安全——6MB base64 分块保守上限；
 *  执行端按 writeId 集齐 total 块后组装并原子落位，中途失败/超时自清理
 *  不残留半成品目标文件）。
 *  overwrite（v2）：缺省/true = 原子替换（用户显式选择覆盖，或保存对话框
 *  已确认）；false = 无覆盖提交，目标已存在时执行端抛 target-exists，
 *  调用方换下一编号候选重试。 */
export interface PdfRemoteWriteFileRequest {
  /** 本次写的幂等键（远端 randomUUID） */
  writeId: string
  targetPath: string
  seq: number
  total: number
  base64: string
  overwrite?: boolean
}

export interface PdfRemoteStatFilesRequest {
  paths: string[]
}

export interface PdfRemoteStatFilesResult {
  entries: Array<{ path: string; exists: boolean; isFile: boolean }>
}

/** 目录枚举（批量自动更名的占用面——目录不存在返回空清单） */
export interface PdfRemoteListDirectoryRequest {
  dir: string
}

export interface PdfRemoteListDirectoryResult {
  /** 条目名（不含路径分隔符；枚举失败/目录不存在为空数组） */
  names: string[]
}

export interface PdfRemoteSaveDialogRequest {
  defaultFileName: string
}

export interface PdfRemotePingResult {
  protocolVersion: number
  platform: string
  /** 本机浏览器解析（resolveExportBrowser 结果形态；失败给 reason） */
  browser:
    | { ok: true; kind: 'chrome' | 'edge'; executablePath: string }
    | { ok: false; reason: 'no-browser' | 'configured-path-missing' }
  /** 主扩展本机安装的静态资产在场性（执行端按安装目录兄弟定位——remote
   *  窗口本地 host 看不到 workspace 主扩展；缺失即不可用；mainVersion 诊断面） */
  mainAssets: { present: boolean; missing: string[]; mainVersion?: string }
}

// ---- 挂起资源去重键（两端同构——server 侧入队与远端回填按同一键配对） ----

export function pdfRemoteResourceKey(src: string, doc: string | undefined): string {
  return `${doc ?? ''}\u0000${src}`
}
