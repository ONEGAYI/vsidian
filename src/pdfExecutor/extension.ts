// Vsidian PDF 导出本机执行端扩展（T08/#628）：双 VSIX 分发的第二个包
//（`onegayi.vsidian-pdf-executor`，extensionKind ui——跑在 remote 窗口的
// 本机 ext host）。依据 V02 探针结论（docs/research/pdf-export-remote-ssh-probe.md
// §7 实施指令）：
//
// - 职责：浏览器发现（browserFind 复用）→ CDP 生成（browserLauncher/
//   cdpClient/pdfExportSession 整体复用，**不建第二份生成实现**）→ 任务
//   注册表（进度/取消/挂起资源查询命令）→ 本机落盘（workspace.fs + file:）
//   → 本机对话框；
// - 协议：shared/pdfRemote.ts 单一事实源（错误码进 message 前缀——Error.code
//   跨端丢失；进度与资源经轮询命令；取消经第二条命令）；
// - 静态资产（pdfExportPage.js/css、KaTeX/mermaid/pdfjs 资产）不随执行端
//   包重复分发——从本机安装的 vsidian 主扩展目录读取（双 VSIX 安装是分发
//   前提；缺失经 ping 如实报告）。
//
// 生成端移植零复制的代价说明：pdf-lib（书签后处理）与 shared 纯逻辑随
// esbuild 打进本包 bundle（主包 node_modules 不随 VSIX 分发，两包各自
// 自包含）。

import * as vscode from 'vscode'
import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { resolveExportBrowser } from '../host/pdfExport/browserFind'
import { createBrowserExportSession } from '../host/pdfExport/pdfExportSession'
import { PdfExportBrowserError, type BrowserExportSession } from '../host/pdfExport/pdfExportJob'
import { RemoteResourceQueue } from './resourceQueue'
import {
  PDF_EXECUTOR_COMMANDS,
  PDF_EXECUTOR_PROTOCOL_VERSION,
  encodePdfRemoteError,
  type PdfRemoteFinalizePrintRequest,
  type PdfRemoteFinalizePrintResult,
  type PdfRemotePingResult,
  type PdfRemoteQueryTaskResult,
  type PdfRemoteRenderPageRequest,
  type PdfRemoteRenderPageResult,
  type PdfRemoteResourceItem,
  type PdfRemoteSaveDialogRequest,
  type PdfRemoteStatFilesRequest,
  type PdfRemoteStatFilesResult,
  type PdfRemoteWriteFileRequest,
} from '../shared/pdfRemote'
import type { PdfExportOptions } from '../shared/pdfExportOptions'

/** 主扩展本机资产目录（out/webview）须在场的运行时产物（缺失 = 执行端不可用） */
const MAIN_ASSET_FILES = [
  'pdfExportPage.js',
  'pdfExportPage.css',
  'pdfMain.js',
  'pdfWorker.js',
  'mermaid.js',
  path.join('pdfjs', 'cmaps'),
]

/**
 * 定位本机安装的主扩展产物目录。**不能**用 `vscode.extensions.getExtension`
 * 探测：remote 窗口的本地 ext host 上 workspace 主扩展不可见（跑在远端，
 * V02 §3.2 分发语义）——按执行端自身安装目录的兄弟目录定位
 * （`<extensionsDir>/onegayi.vsidian-<version>`，取资产完整的最新者；
 * 双 VSIX 同目录安装是分发前提）。
 */
const mainAssetsProbe = (): { dir: string | undefined; missing: string[]; mainVersion: string | undefined } => {
  const self = vscode.extensions.getExtension('onegayi.vsidian-pdf-executor')
  if (self === undefined) {
    return { dir: undefined, missing: [...MAIN_ASSET_FILES], mainVersion: undefined }
  }
  const extensionsDir = path.dirname(self.extensionPath)
  let candidates: string[] = []
  try {
    candidates = readdirSync(extensionsDir)
      .filter((name) => /^onegayi\.vsidian-\d/.test(name))
      .sort()
      .reverse()
  } catch {
    return { dir: undefined, missing: [...MAIN_ASSET_FILES], mainVersion: undefined }
  }
  for (const name of candidates) {
    const dir = path.join(extensionsDir, name, 'out', 'webview')
    const missing = MAIN_ASSET_FILES.filter((rel) => !existsSync(path.join(dir, rel)))
    if (missing.length === 0) {
      let mainVersion: string | undefined
      try {
        mainVersion = (JSON.parse(readFileSync(path.join(extensionsDir, name, 'package.json'), 'utf8')) as { version?: string }).version
      } catch { /* 诊断面缺席不阻塞 */ }
      return { dir, missing: [], mainVersion }
    }
  }
  return { dir: undefined, missing: [...MAIN_ASSET_FILES], mainVersion: undefined }
}

/** 任务的浏览器会话 + 挂起资源队列（registry 数据面） */
interface ExecutorTask {
  id: string
  phase: 'rendering' | 'printing' | 'done' | 'failed' | 'cancelled'
  session: BrowserExportSession | undefined
  queue: RemoteResourceQueue
}

/** 断连后迟到完成的命令回包无处可去（V02 §5）——任务表允许残留终态条目，
 *  由下一次同 id 操作或扩展停用清理；id 为随机 UUID，不复用不累积增长 */
export function activate(context: vscode.ExtensionContext): void {
  const tasks = new Map<string, ExecutorTask>()
  /** 分块写盘中转表（writeId → 组装面；60s 超时自清理——远端断连不残留） */
  const pendingWrites = new Map<string, {
    targetPath: string
    total: number
    chunks: Map<number, Buffer>
    timer: ReturnType<typeof setTimeout>
  }>()

  /** 命令包装：Error → 协议编码（code 进 message 前缀） */
  const encoded = async <T>(code: string, run: () => Promise<T>): Promise<T> => {
    try {
      return await run()
    } catch (error) {
      if (error instanceof PdfExportBrowserError) {
        throw encodePdfRemoteError(error.code, error.message)
      }
      throw encodePdfRemoteError(code, error instanceof Error ? error.message : String(error))
    }
  }

  /** 任务终结算：会话释放 + 队列收口 + 移除 */
  const settleTask = (task: ExecutorTask, outcome: 'done' | 'failed' | 'cancelled'): void => {
    task.phase = outcome
    try {
      task.session?.dispose()
    } catch { /* 幂等兜底 */ }
    task.queue.failAll({ ok: false, reason: 'inaccessible' })
    tasks.delete(task.id)
  }

  context.subscriptions.push(
    // ---- 能力探测：执行端在场性 + 浏览器解析 + 主扩展资产在场性 ----
    vscode.commands.registerCommand(PDF_EXECUTOR_COMMANDS.ping, async (arg: { browserPath?: unknown } | undefined): Promise<PdfRemotePingResult> => {
      const browserPath = typeof arg?.browserPath === 'string' && arg.browserPath.trim() !== '' ? arg.browserPath.trim() : undefined
      const assets = mainAssetsProbe()
      const result: PdfRemotePingResult = {
        protocolVersion: PDF_EXECUTOR_PROTOCOL_VERSION,
        platform: process.platform,
        browser: { ok: false, reason: 'no-browser' },
        mainAssets: { present: assets.dir !== undefined, missing: assets.missing, ...(assets.mainVersion !== undefined ? { mainVersion: assets.mainVersion } : {}) },
      }
      try {
        const resolved = await resolveExportBrowser(browserPath)
        result.browser = resolved.ok
          ? { ok: true, kind: resolved.browser.kind, executablePath: resolved.browser.executablePath }
          : (resolved.reason === 'configured-path-missing'
            ? { ok: false, reason: 'configured-path-missing' as const }
            : { ok: false, reason: 'no-browser' as const })
      } catch (error) {
        throw encodePdfRemoteError('internal', error instanceof Error ? error.message : String(error))
      }
      return result
    }),

    // ---- 装配导出页并等待就绪（固定输入整包传入；资源字节远端供给） ----
    vscode.commands.registerCommand(PDF_EXECUTOR_COMMANDS.renderPage, async (request: PdfRemoteRenderPageRequest): Promise<PdfRemoteRenderPageResult> => {
      if (request === null || typeof request !== 'object' || typeof request.taskId !== 'string'
        || request.payload === null || typeof request.payload !== 'object' || request.options === null || typeof request.options !== 'object') {
        throw encodePdfRemoteError('bad-request', 'renderPage 参数形态非法')
      }
      return encoded('launch', async () => {
        const assets = mainAssetsProbe()
        if (assets.dir === undefined) {
          throw encodePdfRemoteError('assets-missing', `本机 vsidian 主扩展产物缺失：${assets.missing.join(', ')}`)
        }
        const resolved = await resolveExportBrowser(request.browserPath)
        if (!resolved.ok) {
          throw encodePdfRemoteError(resolved.reason, resolved.reason === 'configured-path-missing' ? `配置的浏览器路径不存在：${resolved.configuredPath}` : '本机未发现可用的 Chrome/Edge')
        }
        const task: ExecutorTask = {
          id: request.taskId,
          phase: 'rendering',
          session: undefined,
          queue: new RemoteResourceQueue(),
        }
        const known = new Set(request.knownDocFsPaths)
        const session = createBrowserExportSession(resolved.browser.executablePath, {
          outWebviewDir: assets.dir,
          resourceResolve: {
            // 远程形态不走本地 resolve（/res 已改 requestBytes 挂起；类型面
            // 兼容给出防御实现——正常流不可达）
            resolve: async () => ({ ok: false as const, reason: 'blocked' as const }),
            knownDocFsPaths: () => known,
            requestBytes: (src, doc) => task.queue.request(src, doc),
          },
          pageLabel: request.pageLabel,
        })
        task.session = session
        tasks.set(task.id, task)
        try {
          const rendered = await session.renderPage({
            payload: { ...request.payload, mermaidUri: '', resBase: '' },
            options: request.options as PdfExportOptions,
          })
          return rendered satisfies PdfRemoteRenderPageResult
        } catch (error) {
          settleTask(task, 'failed')
          throw error
        }
      })
    }),

    // ---- 打印（字节 base64 回传；成功/失败后任务终结并释放） ----
    vscode.commands.registerCommand(PDF_EXECUTOR_COMMANDS.finalizePrint, async (request: PdfRemoteFinalizePrintRequest): Promise<PdfRemoteFinalizePrintResult> => {
      if (request === null || typeof request !== 'object' || typeof request.taskId !== 'string') {
        throw encodePdfRemoteError('bad-request', 'finalizePrint 参数形态非法')
      }
      return encoded('print', async () => {
        const task = tasks.get(request.taskId)
        if (task === undefined || task.session === undefined) {
          throw encodePdfRemoteError('unknown-task', `任务不可用：${request.taskId}`)
        }
        task.phase = 'printing'
        try {
          const printed = await task.session.finalizePrint(request.options as PdfExportOptions)
          settleTask(task, 'done')
          return { pdfBase64: printed.bytes.toString('base64'), bookmarks: printed.bookmarks } satisfies PdfRemoteFinalizePrintResult
        } catch (error) {
          settleTask(task, 'failed')
          throw error
        }
      })
    }),

    // ---- 协作式取消（幂等；未知任务不构成错误） ----
    vscode.commands.registerCommand(PDF_EXECUTOR_COMMANDS.cancelTask, async (arg: { taskId?: unknown } | undefined) => {
      const taskId = typeof arg?.taskId === 'string' ? arg.taskId : ''
      const task = tasks.get(taskId)
      if (task === undefined) {
        return { cancelled: false }
      }
      settleTask(task, 'cancelled')
      return { cancelled: true }
    }),

    // ---- 任务态查询（远端轮询通道：进度 + 挂起资源清单） ----
    vscode.commands.registerCommand(PDF_EXECUTOR_COMMANDS.queryTask, async (arg: { taskId?: unknown } | undefined): Promise<PdfRemoteQueryTaskResult> => {
      const taskId = typeof arg?.taskId === 'string' ? arg.taskId : ''
      const task = tasks.get(taskId)
      if (task === undefined) {
        return { known: false, phase: 'done', pending: [] }
      }
      return { known: true, phase: task.phase, pending: task.queue.pendingList() }
    }),

    // ---- 挂起资源回填（按 key 配对；未知 key 忽略） ----
    vscode.commands.registerCommand(PDF_EXECUTOR_COMMANDS.provideResources, async (arg: { taskId?: unknown; items?: unknown } | undefined) => {
      const taskId = typeof arg?.taskId === 'string' ? arg.taskId : ''
      const items = Array.isArray(arg?.items) ? (arg!.items as PdfRemoteResourceItem[]) : []
      const task = tasks.get(taskId)
      if (task === undefined) {
        return { accepted: false }
      }
      task.queue.provide(items)
      return { accepted: true }
    }),

    // ---- 本机原子写盘（分块组装：远端按 writeId 逐块上行，集齐 total 块
    //  后目录按需创建 + 临时文件 + rename——与主包批量写盘同语义；单块
    //  即 total=1 直写。半途断连/超时按 writeId 自清理（60s），不残留
    //  半成品目标文件，旧文件在新文件完整写入前不损毁） ----
    vscode.commands.registerCommand(PDF_EXECUTOR_COMMANDS.writeFileAtomic, async (request: PdfRemoteWriteFileRequest) => {
      if (request === null || typeof request !== 'object' || typeof request.writeId !== 'string'
        || typeof request.targetPath !== 'string' || typeof request.base64 !== 'string'
        || !Number.isInteger(request.seq) || !Number.isInteger(request.total) || request.total < 1) {
        throw encodePdfRemoteError('bad-request', 'writeFileAtomic 参数形态非法')
      }
      return encoded('write-failed', async () => {
        const writeId = request.writeId
        let pending = pendingWrites.get(writeId)
        if (pending === undefined) {
          pending = {
            targetPath: request.targetPath,
            total: request.total,
            chunks: new Map(),
            timer: setTimeout(() => {
              pendingWrites.delete(writeId)
            }, 60_000),
          }
          pendingWrites.set(writeId, pending)
        }
        pending.chunks.set(request.seq, Buffer.from(request.base64, 'base64'))
        if (pending.chunks.size < pending.total) {
          return { assembling: true, received: pending.chunks.size, total: pending.total }
        }
        clearTimeout(pending.timer)
        pendingWrites.delete(writeId)
        const assembled = Buffer.concat(
          [...pending.chunks.keys()].sort((a, b) => a - b).map((seq) => pending!.chunks.get(seq)!),
        )
        const target = vscode.Uri.file(pending.targetPath)
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, '..'))
        const tmp = `${pending.targetPath}.vsidian-tmp-${randomUUID()}`
        try {
          await vscode.workspace.fs.writeFile(vscode.Uri.file(tmp), assembled)
          await vscode.workspace.fs.rename(vscode.Uri.file(tmp), target, { overwrite: true })
        } catch (error) {
          await vscode.workspace.fs.delete(vscode.Uri.file(tmp)).then(() => undefined, () => undefined)
          throw error
        }
        return { written: pending.targetPath, bytes: assembled.length }
      })
    }),

    // ---- 本机 stat 探测（批量目标目录冲突映射在本机侧解析） ----
    vscode.commands.registerCommand(PDF_EXECUTOR_COMMANDS.statFiles, async (request: PdfRemoteStatFilesRequest): Promise<PdfRemoteStatFilesResult> => {
      if (request === null || typeof request !== 'object' || !Array.isArray(request.paths)) {
        throw encodePdfRemoteError('bad-request', 'statFiles 参数形态非法')
      }
      const entries: PdfRemoteStatFilesResult['entries'] = []
      for (const target of request.paths) {
        if (typeof target !== 'string') continue
        try {
          const info = await vscode.workspace.fs.stat(vscode.Uri.file(target))
          entries.push({ path: target, exists: true, isFile: (info.type & vscode.FileType.File) !== 0 })
        } catch {
          entries.push({ path: target, exists: false, isFile: false })
        }
      }
      return { entries }
    }),

    // ---- 本机保存对话框（远端窗口下 workbench 对话框在本机侧；返回本机路径） ----
    vscode.commands.registerCommand(PDF_EXECUTOR_COMMANDS.showSaveDialog, async (request: PdfRemoteSaveDialogRequest): Promise<string | null> => {
      if (request === null || typeof request !== 'object' || typeof request.defaultFileName !== 'string') {
        throw encodePdfRemoteError('bad-request', 'showSaveDialog 参数形态非法')
      }
      const lastDir = context.globalState.get<string>('lastSaveDir')
      const defaultDir = lastDir !== undefined && lastDir !== '' && existsSync(lastDir) ? lastDir : homedir() || tmpdir()
      const picked = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(defaultDir, request.defaultFileName)),
        filters: { 'PDF': ['pdf'] },
      })
      if (picked === undefined) {
        return null
      }
      void context.globalState.update('lastSaveDir', path.dirname(picked.fsPath)).then(() => undefined, () => undefined)
      return picked.fsPath
    }),

    // ---- 本机目录选择（批量目标目录——产物落本机，目录也在本机选） ----
    vscode.commands.registerCommand(PDF_EXECUTOR_COMMANDS.showOpenDialogDir, async (): Promise<string | null> => {
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        canSelectFolders: true,
        canSelectFiles: false,
      })
      return picked !== undefined && picked.length > 0 ? picked[0]!.fsPath : null
    }),
  )
}
