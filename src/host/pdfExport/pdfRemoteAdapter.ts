// PDF 导出远端会话适配器（T08/#628）：Remote SSH 窗口中把四个导出 job 与
// 预览 job 的端口面（resolveBrowser/createSession/showSaveDialog/writeFile）
// 替换为跨宿主命令通道实现——job/模态/指纹复用逻辑零改动（T07 代次模型
// 不感知运行侧）。
//
// 依据 V02 探针实测（docs/research/pdf-export-remote-ssh-probe.md）：
// - executeCommand 跨 ext host 路由（8MB 实测；命令并行不排队）；
// - 断连后远端在途 await **无终态**——所有跨端调用自带超时，超时按
//   executor-unreachable 如实收口，不伪成功；
// - 进度/挂起资源经轮询查询命令（120–200ms 实测够用）；取消经第二条
//   命令（协作式取消）。
//
// 纯逻辑可单测：命令通道（exec）与资源读取端口注入，无 vscode 依赖。

import { randomUUID } from 'node:crypto'
import { withTimeout } from './browserLauncher'
import {
  PdfExportBrowserError,
  PdfExportRemoteChannelError,
  type BrowserExportSession,
} from './pdfExportJob'
import type { ResolveBrowserResult } from './browserFind'
import {
  PDF_EXECUTOR_COMMANDS,
  PDF_EXECUTOR_PROTOCOL_VERSION,
  decodePdfRemoteError,
  type PdfRemoteExec,
  type PdfRemotePingResult,
  type PdfRemoteQueryTaskResult,
  type PdfRemoteRenderPageRequest,
  type PdfRemoteRenderPageResult,
  type PdfRemoteResourceItem,
} from '../../shared/pdfRemote'
import type { PdfBookmarkReport, PdfExportPagePayload } from '../../shared/pdfExportPayload'
import type { PdfExportOptions } from '../../shared/pdfExportOptions'

/** 远端侧资源读取端口（解析面复用 provider 既有端口——不建第二份） */
export interface PdfRemoteAdapterDeps {
  exec: PdfRemoteExec
  /** 资源解析（classifyImageTarget + stat 的既有生产端口） */
  resolveResource(src: string, sourceFsPath: string | undefined): Promise<
    | { ok: true; fsPath: string; contentType: string }
    | { ok: false; reason: 'not-found' | 'inaccessible' | 'blocked' }
  >
  /** 远端读资源字节（workspace.fs.readFile） */
  readResourceBytes(fsPath: string): Promise<Uint8Array>
  /** 本次固定输入登记的文档身份集合（/res 与 /resource 守卫数据面） */
  knownDocFsPaths(): ReadonlySet<string>
  /** 远端 UI 语言的页码词条（PDF 页脚跟随远端语言，不跟执行端 locale） */
  pageLabel(): { pre: string; mid: string; post: string }
  /** 测试钩子注入（marker 文件形态；生产 undefined——对话框走真实链路）：
   *  saveTarget = 精确路径（单发）；saveDir = 目录（按默认文件名拼接，
   *  多次导出互不覆盖）；targetDir = 批量目标目录 */
  testHooks(): { saveTarget?: string; saveDir?: string; targetDir?: string } | undefined
  /** 超时/节拍预算覆盖（生产缺省见 DEFAULT_BUDGETS；单测注入小值驱动
   *  超时与轮询路径——生产代码不传） */
  budgets?: Partial<PdfRemoteBudgets>
}

/** 轮询节拍与超时预算（V02 实测口径：单次轮询 RTT 1–4ms，120ms 间隔收敛） */
export interface PdfRemoteBudgets {
  pollIntervalMs: number
  pollTimeoutMs: number
  /** 连续轮询超时判定通道死亡（断连后宿主 20s 检出——3×10s 覆盖检出窗） */
  pollLossLimit: number
  pingTimeoutMs: number
  renderTimeoutMs: number
  printTimeoutMs: number
  writeTimeoutMs: number
  dialogTimeoutMs: number
}

const DEFAULT_BUDGETS: PdfRemoteBudgets = {
  pollIntervalMs: 150,
  pollTimeoutMs: 10_000,
  pollLossLimit: 3,
  pingTimeoutMs: 30_000,
  renderTimeoutMs: 180_000,
  printTimeoutMs: 300_000,
  writeTimeoutMs: 120_000,
  dialogTimeoutMs: 10 * 60_000,
}

/** 单命令写盘分块上限（base64 字符数；6MB ≈ 4.5MB 原始字节，V02 8MB 实测内取保守值） */
const WRITE_CHUNK_CHARS = 6 * 1024 * 1024

function isCommandNotFound(error: unknown): boolean {
  return error instanceof Error && /command '[^']+' not found/.test(error.message)
}

/** 通道调用：统一超时 + executor 缺失/不可达分态（missing = 命令未注册——
 *  执行端未安装/未激活；unreachable = 超时/断连/其余通道故障） */
async function channelCall<T>(exec: PdfRemoteExec, budgets: PdfRemoteBudgets, budgetKey: 'pollTimeoutMs' | 'pingTimeoutMs' | 'renderTimeoutMs' | 'printTimeoutMs' | 'writeTimeoutMs' | 'dialogTimeoutMs', command: string, arg: unknown, label: string): Promise<T> {
  const timeoutMs = budgets[budgetKey]
  try {
    return await withTimeout(Promise.resolve(exec(command, arg)) as Promise<T>, timeoutMs, `${label} cross-host timeout (${timeoutMs}ms)`)
  } catch (error) {
    if (isCommandNotFound(error)) {
      throw new PdfExportRemoteChannelError(`本机执行端扩展未安装或未激活：${command}`, 'missing')
    }
    throw new PdfExportRemoteChannelError(error instanceof Error ? error.message : String(error), 'unreachable')
  }
}

/** 执行端错误解码 → job 分态错误（launch/navigate/not-ready/print 透传；
 *  其余机器码收敛 launch 分态——原始码保留在 message（failDetail 观测面）） */
function decodeExecutorError(error: unknown): Error {
  const decoded = decodePdfRemoteError(error)
  if (decoded !== undefined) {
    if (decoded.code === 'launch' || decoded.code === 'navigate' || decoded.code === 'not-ready' || decoded.code === 'print') {
      return new PdfExportBrowserError(decoded.code, decoded.message)
    }
    return new PdfExportBrowserError('launch', `[${decoded.code}] ${decoded.message}`)
  }
  if (error instanceof PdfExportRemoteChannelError) return error
  return error instanceof Error ? error : new Error(String(error))
}

export interface PdfRemoteAdapter {
  /** 浏览器解析（执行端发现——远端无本机浏览器可寻） */
  resolveBrowser(configuredPath: string | undefined): Promise<ResolveBrowserResult>
  /** 会话工厂（BrowserExportSession 端口形态——四个 job/预览共用） */
  createSession(executablePath: string): BrowserExportSession
  /** 本机保存对话框（undefined = 用户取消） */
  showSaveDialog(defaultFileName: string): Promise<string | undefined>
  /** 本机目录选择（undefined = 用户取消） */
  showOpenDialogDir(): Promise<string | undefined>
  /** 本机原子写盘（分块传输 + 执行端组装备落位——目录按需创建 + 原子替换） */
  writeFile(targetPath: string, bytes: Uint8Array): Promise<void>
  /** 本机 stat 探测（批量目标目录冲突映射） */
  statFiles(paths: readonly string[]): Promise<Array<{ path: string; exists: boolean; isFile: boolean }>>
}

export function createPdfRemoteAdapter(deps: PdfRemoteAdapterDeps): PdfRemoteAdapter {
  let sessionSeq = 0
  const budgets: PdfRemoteBudgets = { ...DEFAULT_BUDGETS, ...deps.budgets }

  const resolveBrowser = async (configuredPath: string | undefined): Promise<ResolveBrowserResult> => {
    let ping: PdfRemotePingResult
    try {
      ping = await channelCall<PdfRemotePingResult>(deps.exec, budgets, 'pingTimeoutMs', PDF_EXECUTOR_COMMANDS.ping, { browserPath: configuredPath }, 'ping')
    } catch (error) {
      if (error instanceof PdfExportRemoteChannelError && error.kind === 'missing') {
        return { ok: false, reason: 'executor-missing' }
      }
      return { ok: false, reason: 'executor-unreachable' }
    }
    if (ping.protocolVersion !== PDF_EXECUTOR_PROTOCOL_VERSION) {
      // 协议代差不冒充可用（执行端旧版/新版形态漂移）
      return { ok: false, reason: 'executor-missing' }
    }
    if (!ping.mainAssets.present) {
      // 主扩展本机安装缺失/产物不全：执行端不可用的另一形态（缺失清单
      // 保留在 ping 数据面——诊断观测）
      return { ok: false, reason: 'executor-missing' }
    }
    if (!ping.browser.ok) {
      return ping.browser.reason === 'configured-path-missing'
        ? { ok: false, reason: 'configured-path-missing', configuredPath: configuredPath ?? '' }
        : { ok: false, reason: 'no-browser' }
    }
    return {
      ok: true,
      fromConfiguredPath: configuredPath !== undefined && configuredPath !== '',
      browser: {
        kind: ping.browser.kind,
        executablePath: ping.browser.executablePath,
        version: null,
        via: 'app-paths-registry',
      },
    }
  }

  /** 挂起资源服务循环：renderPage 在途期间轮询 queryTask，解析 + 读字节
   *  后经 provideResources 回填。通道死亡即停服务（renderPromise 由外层
   *  超时收口）；renderPromise 落定即停（迟到轮询不再发起）。 */
  const servePendingResources = (taskId: string, until: Promise<unknown>): void => {
    let stopped = false
    let lossCount = 0
    const inFlight = new Set<string>()
    const stop = (): void => {
      stopped = true
    }
    void until.then(stop, stop)
    void (async () => {
      while (!stopped) {
        await new Promise((resolve) => setTimeout(resolve, budgets.pollIntervalMs))
        if (stopped) return
        let state: PdfRemoteQueryTaskResult
        try {
          state = await channelCall<PdfRemoteQueryTaskResult>(deps.exec, budgets, 'pollTimeoutMs', PDF_EXECUTOR_COMMANDS.queryTask, { taskId }, 'queryTask')
          lossCount = 0
        } catch {
          lossCount += 1
          if (lossCount >= budgets.pollLossLimit) return // 通道死亡：停服务（外层超时收口 renderPage）
          continue
        }
        // unknown（任务尚未注册——首轮轮询可能早于 renderPage 命令到达；
        // 或任务已终结）不退出：渲染 promise 落定（成功/失败/取消）才是
        // 停止条件，避免早到轮询杀死资源供给循环（实测坑：图片永久挂起）
        if (!state.known) continue
        for (const item of state.pending) {
          if (inFlight.has(item.key)) continue
          inFlight.add(item.key)
          void (async () => {
            const back = await (async (): Promise<PdfRemoteResourceItem> => {
              try {
                const resolved = await deps.resolveResource(item.src, item.doc)
                if (!resolved.ok) {
                  return { key: item.key, ok: false, reason: resolved.reason }
                }
                return {
                  key: item.key,
                  ok: true,
                  contentType: resolved.contentType,
                  base64: Buffer.from(await deps.readResourceBytes(resolved.fsPath)).toString('base64'),
                }
              } catch {
                return { key: item.key, ok: false, reason: 'inaccessible' as const }
              }
            })()
            inFlight.delete(item.key)
            if (!stopped) {
              await channelCall(deps.exec, budgets, 'writeTimeoutMs', PDF_EXECUTOR_COMMANDS.provideResources, { taskId, items: [back] }, 'provideResources').catch(() => undefined)
            }
          })()
        }
      }
    })()
  }

  const createSession = (_executablePath: string): BrowserExportSession => {
    let taskId = ''
    let disposed = false

    const fireCancel = (): void => {
      const id = taskId
      if (id === '') return
      taskId = ''
      void channelCall(deps.exec, budgets, 'writeTimeoutMs', PDF_EXECUTOR_COMMANDS.cancelTask, { taskId: id }, 'cancelTask').catch(() => undefined)
    }

    return {
      async renderPage(input: { payload: PdfExportPagePayload; options: PdfExportOptions }): Promise<PdfRemoteRenderPageResult> {
        if (disposed) throw new PdfExportBrowserError('launch', '会话已释放（重复 renderPage）')
        taskId = `r${++sessionSeq}-${randomUUID()}`
        // mermaidUri/resBase 由执行端资源服务装配（远端传空串——jobs 已置
        // 空串，多余字段跨端无害；类型经收窄声明）。exec 的同步异常也归一
        // 为 rejection（防御：通道实现不应同步抛，但抛了也不能绕过解码）
        const request: PdfRemoteRenderPageRequest = {
          taskId,
          payload: input.payload as PdfRemoteRenderPageRequest['payload'],
          options: input.options,
          knownDocFsPaths: [...deps.knownDocFsPaths()],
          pageLabel: deps.pageLabel(),
        }
        const renderPromise = (async () => deps.exec(PDF_EXECUTOR_COMMANDS.renderPage, request))() as Promise<PdfRemoteRenderPageResult>
        servePendingResources(taskId, renderPromise)
        try {
          return await withTimeout(renderPromise, budgets.renderTimeoutMs, 'renderPage cross-host timeout')
        } catch (error) {
          fireCancel()
          const mapped = decodeExecutorError(error)
          if (mapped === error && !(error instanceof PdfExportBrowserError) && !(error instanceof PdfExportRemoteChannelError)) {
            // 外层超时/未知通道异常 → executor-unreachable（断连后远端在途
            // await 无终态——超时如实收口，V02 §5）
            throw new PdfExportRemoteChannelError(error instanceof Error ? error.message : String(error), 'unreachable')
          }
          throw mapped
        }
      },

      async finalizePrint(options: PdfExportOptions): Promise<{ bytes: Buffer; bookmarks: PdfBookmarkReport }> {
        if (disposed || taskId === '') {
          throw new PdfExportBrowserError('print', '页面未就绪（finalizePrint 前置 renderPage 未成功）')
        }
        try {
          const result = await channelCall<{ pdfBase64: string; bookmarks: PdfBookmarkReport }>(
            deps.exec, budgets, 'printTimeoutMs', PDF_EXECUTOR_COMMANDS.finalizePrint, { taskId, options }, 'finalizePrint',
          )
          return { bytes: Buffer.from(result.pdfBase64, 'base64'), bookmarks: result.bookmarks }
        } catch (error) {
          throw decodeExecutorError(error)
        }
      },

      cancel(): void {
        disposed = true
        fireCancel()
      },
      dispose(): void {
        disposed = true
        fireCancel()
      },
    }
  }

  return {
    resolveBrowser,
    createSession,
    showSaveDialog: async (defaultFileName: string): Promise<string | undefined> => {
      const hooks = deps.testHooks()
      if (hooks?.saveTarget !== undefined && hooks.saveTarget !== '') return hooks.saveTarget
      if (hooks?.saveDir !== undefined && hooks.saveDir !== '') {
        return hooks.saveDir.replace(/[\\/]+$/, '') + '/' + defaultFileName
      }
      const picked = await channelCall<string | null>(deps.exec, budgets, 'dialogTimeoutMs', PDF_EXECUTOR_COMMANDS.showSaveDialog, { defaultFileName }, 'showSaveDialog')
      return typeof picked === 'string' && picked !== '' ? picked : undefined
    },
    showOpenDialogDir: async (): Promise<string | undefined> => {
      const hooks = deps.testHooks()
      if (hooks?.targetDir !== undefined && hooks.targetDir !== '') return hooks.targetDir
      const picked = await channelCall<string | null>(deps.exec, budgets, 'dialogTimeoutMs', PDF_EXECUTOR_COMMANDS.showOpenDialogDir, undefined, 'showOpenDialogDir')
      return typeof picked === 'string' && picked !== '' ? picked : undefined
    },
    writeFile: async (targetPath: string, bytes: Uint8Array): Promise<void> => {
      // 分块传输（V02 §3.1：单命令 8MB 实测安全——6MB base64 取保守上限）：
      // { writeId, seq, total, base64 } 逐块上行，执行端集齐后组装并原子
      // 落位（见执行端 writeFileAtomic 的分块面）。取消/断连时执行端按
      // writeId 超时自清理，不残留半成品目标文件。
      const writeId = randomUUID()
      const base64 = Buffer.from(bytes).toString('base64')
      const total = Math.max(1, Math.ceil(base64.length / WRITE_CHUNK_CHARS))
      for (let seq = 0; seq < total; seq++) {
        await channelCall(
          deps.exec,
          budgets,
          'writeTimeoutMs',
          PDF_EXECUTOR_COMMANDS.writeFileAtomic,
          { writeId, targetPath, seq, total, base64: base64.slice(seq * WRITE_CHUNK_CHARS, (seq + 1) * WRITE_CHUNK_CHARS) },
          'writeFileAtomic',
        )
      }
    },
    statFiles: async (paths: readonly string[]): Promise<Array<{ path: string; exists: boolean; isFile: boolean }>> => {
      const result = await channelCall<{ entries: Array<{ path: string; exists: boolean; isFile: boolean }> }>(
        deps.exec, budgets, 'writeTimeoutMs', PDF_EXECUTOR_COMMANDS.statFiles, { paths: [...paths] }, 'statFiles',
      )
      return result.entries
    },
  }
}
