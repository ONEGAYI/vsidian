// PDF 导出浏览器会话管理（T01/#621）：spawn 已安装 Chrome/Edge 的 CDP 调用面。
// 自 #619（V01）探针 test/integration/pdfExportProbe/browser.ts 收编
// （V01 §11 实施指令：spawn 纪律与生命周期语义原样，就绪谓词产品化）。
//
// - spawn 纪律（V01 实测参数）：--headless=new + --remote-debugging-port=0
//   （动态端口经 stderr「DevTools listening on ws://...」提取）+ 独立临时
//   --user-data-dir（mkdtemp；用户默认 profile 单例锁与登录态零接触——
//   规格 §2.5「不终止用户原有浏览器会话」的结构性保证）；
// - 页面会话：Target.createTarget + attachToTarget（flat 协议）+ Page 域
//   导航（先订阅 loadEventFired 再 navigate，事件不丢）+ Runtime.evaluate
//   （exceptionDetails 显式透传）+ Page.printToPDF；
// - 超时纪律：printToPDF 90s / evaluate 60s 显式 withTimeout（V01 §10.3：
//   光栅化挂起类故障表现为永不返回，无超时会拖死导出任务）；
// - 生命周期：close()（Browser.close → 等进程退出 → 清理临时目录）与
//   killSync()（用户取消：强杀进程树并清理，悬挂命令立即 reject）。

import { spawn, ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { CdpConnection, CdpSession } from './cdpClient'
import { printToPdfParamsOf, type PdfExportOptions } from '../../shared/pdfExportOptions'

export interface LaunchOptions {
  executablePath: string
  /** 独立临时 user-data-dir（缺省自动创建；传入则由调用方负责清理）。 */
  userDataDir?: string
  /** 等待 DevTools 就绪的上限（毫秒）。 */
  timeoutMs?: number
}

export interface LaunchedBrowser {
  proc: ChildProcess
  pid: number | undefined
  executablePath: string
  userDataDir: string
  ownUserDataDir: boolean
  browserWsUrl: string
  connection: CdpConnection
  /** CDP Browser.getVersion 回报。 */
  cdpVersion: { browser: string; protocol: string; userAgent: string }
  /** Browser.close → 等 exit → 清理临时目录。返回进程退出码。 */
  close: () => Promise<number | null>
  /** 强杀进程树并清理（用户取消；悬挂命令随连接断开立即 reject）。 */
  killSync: () => void
}

const DEVTOOLS_LINE = /DevTools listening on (ws:\/\/\S+)/

export async function launchHeadlessBrowser(options: LaunchOptions): Promise<LaunchedBrowser> {
  const ownUserDataDir = !options.userDataDir
  const userDataDir = options.userDataDir ?? mkdtempSync(path.join(tmpdir(), 'vsidian-pdfexport-'))
  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--disable-features=Translate',
    'about:blank',
  ]
  const proc = spawn(options.executablePath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderrText = ''
  let wsUrl: string | null = null
  const timeoutMs = options.timeoutMs ?? 20_000

  const devtoolsPromise = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`等待 DevTools 监听超时（${timeoutMs}ms）——目标不是可调试浏览器或启动失败；stderr 头部：${stderrText.slice(0, 400)}`))
    }, timeoutMs)
    proc.stderr!.on('data', (chunk: Buffer) => {
      stderrText += chunk.toString('utf8')
      const match = DEVTOOLS_LINE.exec(stderrText)
      if (match && !wsUrl) {
        wsUrl = match[1]!
        clearTimeout(timer)
        resolve(wsUrl)
      }
    })
    proc.on('error', (error) => {
      clearTimeout(timer)
      reject(new Error(`spawn 失败：${(error as NodeJS.ErrnoException).code ?? ''} ${error.message}`))
    })
    proc.on('exit', (code, signal) => {
      clearTimeout(timer)
      if (!wsUrl) reject(new Error(`浏览器进程提前退出（code=${code} signal=${signal}）；stderr 头部：${stderrText.slice(0, 400)}`))
    })
  })

  let browserWsUrl: string
  try {
    browserWsUrl = await devtoolsPromise
  } catch (error) {
    // 启动失败路径：尽力回收进程与临时目录，不留孤儿
    try { proc.kill() } catch { /* 已退出 */ }
    if (ownUserDataDir) try { rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 }) } catch { /* 尽力 */ }
    throw error
  }

  const connection = await CdpConnection.connect(browserWsUrl)
  const versionResult = await connection.send('Browser.getVersion') as unknown as { product?: string; revision?: string; userAgent?: string; protocolVersion?: string }
  const cdpVersion = {
    browser: versionResult.product ?? 'unknown',
    protocol: versionResult.protocolVersion ?? 'unknown',
    userAgent: versionResult.userAgent ?? 'unknown',
  }

  const close = async (): Promise<number | null> => {
    try { await connection.send('Browser.close') } catch { /* 已断开时退化为等进程退出 */ }
    connection.close()
    const exitCode = await new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => { try { proc.kill() } catch { /* 已退出 */ } resolve(null) }, 10_000)
      proc.on('close', (code) => { clearTimeout(timer); resolve(code) })
      if (proc.exitCode !== null) { clearTimeout(timer); resolve(proc.exitCode) }
    })
    if (ownUserDataDir) rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    return exitCode
  }
  const killSync = (): void => {
    try { proc.kill('SIGKILL') } catch { /* 已退出 */ }
    connection.close()
    if (ownUserDataDir) try { rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 }) } catch { /* 尽力 */ }
  }

  return {
    proc,
    pid: proc.pid,
    executablePath: options.executablePath,
    userDataDir,
    ownUserDataDir,
    browserWsUrl,
    connection,
    cdpVersion,
    close,
    killSync,
  }
}

/** 新建页面并 attach：返回 flat 协议会话。 */
export async function createPageSession(connection: CdpConnection): Promise<{ session: CdpSession; targetId: string }> {
  const target = await connection.send('Target.createTarget', { url: 'about:blank' })
  const targetId = target.targetId as string
  const attached = await connection.send('Target.attachToTarget', { targetId, flatten: true })
  const session = new CdpSession(connection, attached.sessionId as string)
  await session.send('Page.enable')
  await session.send('Runtime.enable')
  return { session, targetId }
}

/** 导航并等待 Page.loadEventFired（订阅先于 navigate，事件不丢）。 */
export async function navigateAndWaitLoad(session: CdpSession, url: string, timeoutMs = 20_000): Promise<void> {
  const loadFired = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`loadEventFired 超时（${timeoutMs}ms）：${url}`)), timeoutMs)
    session.on('Page.loadEventFired', () => { clearTimeout(timer); resolve() })
  })
  await session.send('Page.navigate', { url })
  await loadFired
}

/** 命令级超时保护：CDP 某些状态（如后台 target 光栅化被挂起）会让命令
 * 永不返回——超时显式报错比拖死宿主可诊断（V01 §10.2 实测）。 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))) },
    )
  })
}

/** Runtime.evaluate（returnByValue）。页面异常透传——exceptionDetails
 *  不在 result 里，必须显式检查（V01 §10.7 探针第一轮实证坑）。 */
export async function evaluate<T>(session: CdpSession, expression: string, options: { timeoutMs?: number } = {}): Promise<T> {
  const result = await withTimeout(session.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: false,
  }), options.timeoutMs ?? 60_000, 'Runtime.evaluate') as unknown as {
    result?: { type?: string; subtype?: string; value?: T; description?: string }
    exceptionDetails?: { text?: string; exception?: { description?: string; value?: unknown } }
  }
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description
      ?? (result.exceptionDetails.exception?.value !== undefined ? JSON.stringify(result.exceptionDetails.exception.value) : '')
    throw new Error(`页面 evaluate 异常：${result.exceptionDetails.text ?? ''} ${String(detail).slice(0, 500)}`)
  }
  const inner = result.result
  if (!inner) throw new Error('Runtime.evaluate 无返回结果')
  if (inner.subtype === 'error') throw new Error(`页面 evaluate 抛错：${inner.description ?? 'unknown'}`)
  return inner.value as T
}

export interface ExportReadyState {
  asyncReady: boolean
  fontsStatus: string
}

/** 导出页就绪谓词（页面侧单次求值）：装配就绪位 + 字体装载。
 *  T01 无图片/异步图形（归 T02 扩全量谓词：全图 complete && naturalWidth>0）。 */
export async function readExportReady(session: CdpSession): Promise<ExportReadyState> {
  return evaluate<ExportReadyState>(session,
    `(() => ({
      asyncReady: !!(window.__vsidianPdfExport && window.__vsidianPdfExport.asyncReady === true),
      fontsStatus: document.fonts ? document.fonts.status : 'loaded',
    }))()`)
}

/** 轮询就绪谓词直到全部为真或超时。禁止固定延迟（V01 §5 对照证伪：
 *  loadEventFired 与固定 500ms 均缺延迟注入内容，只有组合信号收敛）。 */
export async function waitForExportReady(
  session: CdpSession,
  timeoutMs = 15_000,
): Promise<{ ok: boolean; state: ExportReadyState; waitedMs: number }> {
  const startedAt = Date.now()
  for (;;) {
    const state = await readExportReady(session)
    if (state.asyncReady && state.fontsStatus === 'loaded') {
      return { ok: true, state, waitedMs: Date.now() - startedAt }
    }
    if (Date.now() - startedAt > timeoutMs) return { ok: false, state, waitedMs: Date.now() - startedAt }
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
}

/** Page.printToPDF：返回 PDF 字节（base64 解码）。参数由
 *  printToPdfParamsOf 统一换算（纸张/方向/边距/缩放真实传入）。 */
export async function printToPdf(session: CdpSession, options: PdfExportOptions): Promise<Buffer> {
  const result = await withTimeout(session.send('Page.printToPDF', {
    ...printToPdfParamsOf(options),
  }), 90_000, 'Page.printToPDF') as unknown as { data: string }
  return Buffer.from(result.data, 'base64')
}
