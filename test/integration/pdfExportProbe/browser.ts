// #619（V01）PDF 导出探针 · 宿主侧浏览器会话管理（路线 B 的调用面）。
// - spawn 已安装 Chrome/Edge：独立临时 --user-data-dir + --remote-debugging-port=0
//   （动态端口经 stderr 的「DevTools listening on ws://...」提取，避免固定端口冲突）；
// - DevTools HTTP /json/version 交叉确认（Browser.getVersion 提供精确版本回报）；
// - 页面会话：Target.createTarget + attachToTarget（flat 协议）+ Page 域导航/
//   loadEventFired 订阅 + Runtime.evaluate + Page.printToPDF 封装；
// - 生命周期：close()（Browser.close → 进程退出 → 临时目录清理）、killSync()
//   （模拟用户中途取消）、启动失败分态（ENOENT / 非 DevTools 进程超时）。
// 本文件是探针代码（研究票产物），不进 VSIX，不定义产品行为。

import { spawn, ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { get as httpGet } from 'node:http'
import { CdpConnection, CdpSession } from './cdpClient'

export interface LaunchOptions {
  executablePath: string
  /** '--headless=new' 或 '--headless'（Chrome 129+ 两者同义，对照记录 stderr 差异）。 */
  headlessFlag?: string
  /** 独立临时 user-data-dir（缺省自动创建；传入则由调用方负责清理）。 */
  userDataDir?: string
  extraArgs?: string[]
  /** 等待 DevTools 就绪的上限（毫秒）。 */
  timeoutMs?: number
}

export interface LaunchedBrowser {
  proc: ChildProcess
  pid: number | undefined
  executablePath: string
  headlessFlag: string
  userDataDir: string
  ownUserDataDir: boolean
  browserWsUrl: string
  connection: CdpConnection
  /** 启动 stderr 前 4KB（deprecation 警告等取证）。 */
  stderrHead: string
  /** CDP Browser.getVersion 回报。 */
  cdpVersion: { browser: string; protocol: string; userAgent: string }
  /** Browser.close → 等 exit → 清理临时目录。返回进程退出码。 */
  close: () => Promise<number | null>
  /** 强杀进程树并清理（模拟用户取消；不等待优雅关闭）。 */
  killSync: () => void
}

const DEVTOOLS_LINE = /DevTools listening on (ws:\/\/\S+)/

export async function launchHeadlessBrowser(options: LaunchOptions): Promise<LaunchedBrowser> {
  const headlessFlag = options.headlessFlag ?? '--headless=new'
  const ownUserDataDir = !options.userDataDir
  const userDataDir = options.userDataDir ?? mkdtempSync(path.join(tmpdir(), 'vsidian-pdfexport-'))
  const args = [
    headlessFlag,
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
    ...(options.extraArgs ?? []),
  ]
  const proc = spawn(options.executablePath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  const stderrChunks: Buffer[] = []
  let stderrText = ''
  let wsUrl: string | null = null
  const timeoutMs = options.timeoutMs ?? 20_000

  const devtoolsPromise = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`等待 DevTools 监听超时（${timeoutMs}ms）——目标不是可调试浏览器或启动失败；stderr 头部：${stderrText.slice(0, 400)}`))
    }, timeoutMs)
    proc.stderr!.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk)
      stderrText += chunk.toString('utf8')
      const match = DEVTOOLS_LINE.exec(stderrText)
      if (match && !wsUrl) {
        wsUrl = match[1]
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
    headlessFlag,
    userDataDir,
    ownUserDataDir,
    browserWsUrl,
    connection,
    stderrHead: stderrText.slice(0, 4096),
    cdpVersion,
    close,
    killSync,
  }
}

/** DevTools HTTP /json/version（WS 之外的独立确认通道）。 */
export function devtoolsHttpVersion(port: number, timeoutMs = 5000): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const request = httpGet({ host: '127.0.0.1', port, path: '/json/version', timeout: timeoutMs }, (response) => {
      let body = ''
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => {
        try { resolve(JSON.parse(body) as Record<string, string>) } catch (error) { reject(error) }
      })
    })
    request.on('timeout', () => { request.destroy(); reject(new Error('/json/version 超时')) })
    request.on('error', reject)
  })
}

/** 从 DevTools ws URL 提取端口。 */
export function portOfWsUrl(wsUrl: string): number {
  return Number(new URL(wsUrl).port)
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
export async function navigateAndWaitLoad(session: CdpSession, url: string, timeoutMs = 20_000): Promise<number> {
  const startedAt = Date.now()
  const loadFired = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`loadEventFired 超时（${timeoutMs}ms）：${url}`)), timeoutMs)
    session.on('Page.loadEventFired', () => { clearTimeout(timer); resolve() })
  })
  await session.send('Page.navigate', { url })
  await loadFired
  return Date.now() - startedAt
}

/** 命令级超时保护：CDP 某些状态（如后台 target 光栅化被挂起）会让命令
 * 永不返回——超时显式报错比拖死宿主可诊断（探针实测过 printToPDF 后
 * 非前台 target 的渲染 await 无限悬挂）。 */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error) => { clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))) },
    )
  })
}

/** Runtime.evaluate（returnByValue；可选 awaitPromise）。页面异常透传，不吞 exceptionDetails。 */
export async function evaluate<T>(session: CdpSession, expression: string, options: { awaitPromise?: boolean; timeoutMs?: number } = {}): Promise<T> {
  const result = await withTimeout(session.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: options.awaitPromise ?? false,
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

/** Page.printToPDF：返回 PDF 字节（base64 解码）。 */
export async function printToPdf(session: CdpSession, params: Record<string, unknown> = {}): Promise<Buffer> {
  const result = await withTimeout(session.send('Page.printToPDF', {
    printBackground: true,
    ...params,
  }), 90_000, 'Page.printToPDF') as unknown as { data: string }
  return Buffer.from(result.data, 'base64')
}

export interface CompositeReadyState {
  asyncReady: boolean
  fontsStatus: string
  fontsReadyFlag: boolean
  imgsOk: boolean
  imgCount: number
  timeline: Record<string, number | null> | null
}

/** 组合就绪谓词（页面侧单次求值）：asyncReady && fonts.status==='loaded' && 全部图片 complete。 */
export async function readCompositeReady(session: CdpSession): Promise<CompositeReadyState> {
  return evaluate<CompositeReadyState>(session,
    `(() => {
      const imgs = Array.from(document.images)
      const state = {
        asyncReady: false, fontsStatus: document.fonts.status, fontsReadyFlag: false,
        imgsOk: imgs.every((im) => im.complete && im.naturalWidth > 0), imgCount: imgs.length,
        timeline: window.__probe ? JSON.parse(JSON.stringify(window.__probe)) : null,
      }
      state.asyncReady = window.__probe ? window.__probe.asyncReady === true : false
      state.fontsReadyFlag = window.__probe ? window.__probe.fontsReady === true : false
      return state
    })()`)
}

/** 轮询组合就绪谓词直到全部为真或超时；返回最终状态与耗时。 */
export async function waitForCompositeReady(session: CdpSession, timeoutMs = 15_000): Promise<{ ok: boolean; state: CompositeReadyState; waitedMs: number }> {
  const startedAt = Date.now()
  for (;;) {
    const state = await readCompositeReady(session)
    if (state.asyncReady && state.fontsStatus === 'loaded' && state.fontsReadyFlag && state.imgsOk) {
      return { ok: true, state, waitedMs: Date.now() - startedAt }
    }
    if (Date.now() - startedAt > timeoutMs) return { ok: false, state, waitedMs: Date.now() - startedAt }
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
}
