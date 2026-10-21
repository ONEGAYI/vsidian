// #620（V02）Remote SSH 探针 · 本机执行端扩展（extensionKind: ui）。
// 预期跑在 remote 窗口的 local ext host：浏览器 spawn/CDP/PDF 生成/本机
// 落盘都在本机进程内完成；浏览器链路整体复用 V01（#619）探针模块
// （browserFind 发现三通道、browser 的 spawn/CDP/printToPdf、pdfVerify
// 内容级验证引擎），不建第二份实现。探针代码，不定义产品行为。
//
// 命令面（供 workspace 侧经 executeCommand 跨 ext host 调用）：
// - identity / echo / echoBigReturn / throwError：路由与序列化能力矩阵；
// - fsProbe：本机 file: URI 的 workspace.fs 读写（本机落盘接缝）；
// - renderPdf：HTML -> 本机浏览器 -> PDF base64 回传 + 本机落盘（核心闭环）；
// - progressStart/progressPoll：轮询式进度回报通道；
// - sleepEcho：迟到回包实验；cancelableStart/cancelTask/taskState：
//   协作式取消（跨 ext host 的取消信号只能经第二条命令传递）；
// - saveDialogProbe：remote 窗口下 showSaveDialog 的行为观察；
// - helperInstallVsix：生产分发候选（从本机 VSIX 拉起安装）实验。

import * as vscode from 'vscode'
import { createHash } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { CMDS, EXT_IDS, appendActivationLine, collectIdentity } from '../shared'
import { discoverBrowsers } from '../../pdfExportProbe/browserFind'
import { createPageSession, launchHeadlessBrowser, navigateAndWaitLoad, printToPdf, waitForCompositeReady, type LaunchedBrowser } from '../../pdfExportProbe/browser'
import { PdfVerifier } from '../../pdfExportProbe/pdfVerify'
import type { VerifyResult } from '../../pdfExportProbe/verifyEntry'

function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

function artifactsDir(): string {
  const fromEnv = process.env.VSIDIAN_PDF_REMOTE_ARTIFACTS
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  return vscode.extensions.getExtension(EXT_IDS.ui)?.extensionPath ?? __dirname
}

interface ProgressTask {
  stage: number
  total: number
  detail: string
  done: boolean
  startedAt: number
  timer?: NodeJS.Timeout
}

interface CancelableTask {
  state: 'hanging' | 'completed' | 'killed'
  browser: LaunchedBrowser
  startedAt: number
}

export function activate(context: vscode.ExtensionContext): void {
  const identity = collectIdentity(EXT_IDS.ui)
  const writtenTo = appendActivationLine({ ...identity, kind: 'ui-ext' })
  const progressTasks = new Map<string, ProgressTask>()
  const cancelableTasks = new Map<string, CancelableTask>()

  context.subscriptions.push(
    vscode.commands.registerCommand(CMDS.uiIdentity, () => ({ ...identity, activationLogWrittenTo: writtenTo })),

    vscode.commands.registerCommand(CMDS.uiEcho, (payload: unknown) => {
      const text = typeof payload === 'string' ? payload : JSON.stringify(payload)
      return { size: Buffer.byteLength(text), sha256: sha256(text), echoedType: typeof payload }
    }),

    vscode.commands.registerCommand(CMDS.uiEchoBigReturn, (sizeBytes: number) => {
      const chunk = 'A1b2C3d4E5f6'
      const text = chunk.repeat(Math.ceil(sizeBytes / chunk.length)).slice(0, sizeBytes)
      return text
    }),

    vscode.commands.registerCommand(CMDS.uiThrowError, ({ message, code }: { message: string; code?: string }) => {
      const error = new Error(message)
      if (code) (error as Error & { code?: string }).code = code
      throw error
    }),

    vscode.commands.registerCommand(CMDS.uiFsProbe, async ({ op, uri, contentBase64 }: { op: 'write' | 'stat' | 'read'; uri: string; contentBase64?: string }) => {
      const target = vscode.Uri.parse(uri)
      if (op === 'write') {
        if (!contentBase64) throw new Error('write 需要 contentBase64')
        await vscode.workspace.fs.writeFile(target, Buffer.from(contentBase64, 'base64'))
        return { op, written: uri, bytes: Buffer.from(contentBase64, 'base64').length }
      }
      if (op === 'stat') {
        const info = await vscode.workspace.fs.stat(target)
        return { op, size: info.size, ctime: info.ctime, mtime: info.mtime, type: info.type, scheme: target.scheme }
      }
      const data = await vscode.workspace.fs.readFile(target)
      return { op, bytes: data.length, headBase64: Buffer.from(data.slice(0, 8)).toString('base64') }
    }),

    vscode.commands.registerCommand(CMDS.uiRenderPdf, async (request: {
      html: string
      fileName?: string
      expectPages?: number
      expectTexts?: string[]
      samplePoints?: Array<{ page: number; fx: number; fy: number }>
      hangMs?: number
      printBackground?: boolean
    }) => {
      const startedAt = Date.now()
      const dir = artifactsDir()
      const fileName = request.fileName ?? `remote-loop-${Date.now()}.pdf`
      const savePath = path.join(dir, fileName)
      const verifyDist = process.env.VSIDIAN_PDF_EXPORT_PROBE_DIST
      const found = await discoverBrowsers()
      if (found.length === 0) throw new Error('本机未发现 Chrome/Edge（browserFind 三通道均未命中）')
      const browserInfo = found.find((item) => item.kind === 'chrome') ?? found[0]
      const browser = await launchHeadlessBrowser({ executablePath: browserInfo.executablePath })
      try {
        if (request.hangMs && request.hangMs > 0) await new Promise((resolve) => setTimeout(resolve, request.hangMs))
        const { session } = await createPageSession(browser.connection)
        const dataUrl = `data:text/html;charset=utf-8;base64,${Buffer.from(request.html, 'utf8').toString('base64')}`
        await navigateAndWaitLoad(session, dataUrl)
        const ready = await waitForCompositeReady(session, 15_000)
        if (!ready.ok) throw new Error(`组合就绪超时：${JSON.stringify(ready.state)}`)
        const pdf = await printToPdf(session, { printBackground: request.printBackground ?? true })
        let verify: VerifyResult | null = null
        if (verifyDist && existsSync(path.join(verifyDist, 'verify.js'))) {
          const verifier = await PdfVerifier.create(browser.connection, path.join(verifyDist, 'verify.js'))
          try {
            verify = await verifier.verify(pdf, request.samplePoints ? { samplePoints: request.samplePoints } : {})
          } finally {
            verifier.dispose()
          }
        }
        await vscode.workspace.fs.writeFile(vscode.Uri.file(savePath), pdf)
        const fileStat = statSync(savePath)
        return {
          browser: `${browserInfo.kind}:${browserInfo.version ?? 'unknown'}`,
          readyWaitMs: ready.waitedMs,
          durationMs: Date.now() - startedAt,
          pdfBytes: pdf.length,
          pdfSha256: sha256(pdf),
          pdfBase64: pdf.toString('base64'),
          savedTo: vscode.Uri.file(savePath).toString(),
          savedBytesOnDisk: fileStat.size,
          verifyEnabled: verify !== null,
          verify: verify === null ? null : { numPages: verify.numPages, textByPage: verify.textByPage, sampleColors: verify.sampleColors },
          tempDirCleaned: true,
        }
      } finally {
        await browser.close()
      }
    }),

    vscode.commands.registerCommand(CMDS.uiProgressStart, ({ taskId, totalStages }: { taskId: string; totalStages: number }) => {
      const task: ProgressTask = { stage: 0, total: totalStages, detail: 'started', done: false, startedAt: Date.now() }
      task.timer = setInterval(() => {
        task.stage += 1
        task.detail = `stage ${task.stage}/${task.total}`
        if (task.stage >= task.total) {
          task.done = true
          task.detail = 'done'
          if (task.timer) clearInterval(task.timer)
        }
      }, 400)
      progressTasks.set(taskId, task)
      return { taskId, totalStages }
    }),

    vscode.commands.registerCommand(CMDS.uiProgressPoll, ({ taskId }: { taskId: string }) => {
      const task = progressTasks.get(taskId)
      if (!task) throw new Error(`未知任务：${taskId}`)
      if (task.done && task.timer) {
        clearInterval(task.timer)
        task.timer = undefined
        progressTasks.delete(taskId)
      }
      return { stage: task.stage, total: task.total, detail: task.detail, done: task.done, elapsedMs: Date.now() - task.startedAt }
    }),

    vscode.commands.registerCommand(CMDS.uiSleepEcho, async ({ ms, tag }: { ms: number; tag: string }) => {
      await new Promise((resolve) => setTimeout(resolve, ms))
      return { tag, wokeAfterMs: ms }
    }),

    vscode.commands.registerCommand(CMDS.uiCancelableStart, async ({ taskId }: { taskId: string }) => {
      const found = await discoverBrowsers()
      if (found.length === 0) throw new Error('本机未发现 Chrome/Edge')
      const browserInfo = found.find((item) => item.kind === 'chrome') ?? found[0]
      const browser = await launchHeadlessBrowser({ executablePath: browserInfo.executablePath })
      const task: CancelableTask = { state: 'hanging', browser, startedAt: Date.now() }
      cancelableTasks.set(taskId, task)
      // 模拟「生成中等待外部条件」：无取消信号则挂 5 分钟
      await new Promise((resolve) => setTimeout(resolve, 300_000))
      task.state = 'completed'
      await browser.close()
      return { taskId, completed: true }
    }),

    vscode.commands.registerCommand(CMDS.uiCancelTask, ({ taskId }: { taskId: string }) => {
      const task = cancelableTasks.get(taskId)
      if (!task) throw new Error(`未知任务：${taskId}`)
      const userDataDir = task.browser.userDataDir
      task.browser.killSync()
      task.state = 'killed'
      cancelableTasks.delete(taskId)
      return { taskId, killed: true, tempDirExistsAfterKill: existsSync(userDataDir) }
    }),

    vscode.commands.registerCommand(CMDS.uiTaskState, ({ taskId }: { taskId: string }) => {
      const task = cancelableTasks.get(taskId)
      return { taskId, known: task !== undefined, state: task?.state ?? 'unknown-or-finished' }
    }),

    vscode.commands.registerCommand(CMDS.uiSaveDialogProbe, async ({ defaultUri }: { defaultUri?: string }) => {
      const options: vscode.SaveDialogOptions = {
        title: 'V02 probe: save dialog origin check',
        defaultUri: defaultUri ? vscode.Uri.parse(defaultUri) : undefined,
      }
      const outcome = await Promise.race([
        vscode.window.showSaveDialog(options).then((uri) => ({ outcome: 'resolved' as const, uri: uri ? uri.toString() : null, scheme: uri?.scheme ?? null, fsPath: uri?.fsPath ?? null })),
        new Promise<{ outcome: 'pending'; uri: null; scheme: null; fsPath: null }>((resolve) => setTimeout(() => resolve({ outcome: 'pending', uri: null, scheme: null, fsPath: null }), 3500)),
      ])
      return outcome
    }),

    vscode.commands.registerCommand(CMDS.uiHelperInstallVsix, async ({ fileUri }: { fileUri: string }) => {
      const installed = await vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.parse(fileUri))
      return { installed: installed === undefined ? null : String(installed) }
    }),
  )
}
