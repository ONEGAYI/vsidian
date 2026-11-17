import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createPageSession, launchHeadlessBrowser, navigateAndWaitLoad,
  printToPdf, readExportFailures, readHeadingMarks, waitForExportReady,
  type LaunchedBrowser,
} from '../../src/host/pdfExport/browserLauncher'
import { startExportResourceServer, type ExportResourceServer } from '../../src/host/pdfExport/exportResourceServer'
import { createBrowserExportSession } from '../../src/host/pdfExport/pdfExportSession'
import { PDF_EXPORT_OPTIONS_DEFAULTS } from '../../src/shared/pdfExportOptions'
import type { PdfExportPagePayload } from '../../src/shared/pdfExportPayload'

vi.mock('../../src/host/pdfExport/browserLauncher', async () => ({
  ...await vi.importActual<typeof import('../../src/host/pdfExport/browserLauncher')>('../../src/host/pdfExport/browserLauncher'),
  launchHeadlessBrowser: vi.fn(), createPageSession: vi.fn(), navigateAndWaitLoad: vi.fn(),
  waitForExportReady: vi.fn(), readExportFailures: vi.fn(), readHeadingMarks: vi.fn(), printToPdf: vi.fn(),
}))
vi.mock('../../src/host/pdfExport/exportResourceServer', () => ({ startExportResourceServer: vi.fn() }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const payload: PdfExportPagePayload = {
  docs: [{ fsPath: '/vault/a.md', docName: 'a.md', text: '# A', version: 1 }],
  embeds: [], mediaEmbeds: [], embedFailures: [],
  style: { dark: false, vars: {}, reading: {} }, snippets: [], breaks: false,
  locale: 'en', mermaidUri: '', resBase: '',
}
const options = { ...PDF_EXPORT_OPTIONS_DEFAULTS, bookmarksEnabled: false }

function browserResource() {
  return { connection: {}, killSync: vi.fn(), close: vi.fn(async () => 0) } as unknown as LaunchedBrowser
}

function serverResource(): ExportResourceServer {
  return { baseUrl: 'http://127.0.0.1:12345/token', setExportPage: vi.fn(), close: vi.fn() }
}

function exportSession() {
  return createBrowserExportSession('/browser', {
    outWebviewDir: '/out/webview',
    resourceResolve: { resolve: async () => ({ ok: false, reason: 'blocked' }), knownDocFsPaths: () => new Set() },
    pageLabel: { pre: '', mid: '/', post: '' },
  })
}

describe('PDF 导出会话取消与资源获取', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(createPageSession).mockResolvedValue({ session: { send: vi.fn(async () => ({})) }, targetId: 'page' } as never)
    vi.mocked(navigateAndWaitLoad).mockResolvedValue(undefined)
    vi.mocked(waitForExportReady).mockResolvedValue({ ok: true, state: { asyncReady: true, fontsStatus: 'loaded' }, waitedMs: 0 })
    vi.mocked(readExportFailures).mockResolvedValue([])
    vi.mocked(readHeadingMarks).mockResolvedValue([])
    vi.mocked(printToPdf).mockResolvedValue(Buffer.from('%PDF-test'))
  })

  it('启动期间取消：晚到浏览器必须释放，不再启动资源服务', async () => {
    const launch = deferred<LaunchedBrowser>()
    const browser = browserResource()
    vi.mocked(launchHeadlessBrowser).mockReturnValue(launch.promise)
    vi.mocked(startExportResourceServer).mockResolvedValue(serverResource())
    const session = exportSession()
    const rendered = session.renderPage({ payload, options }).catch((error: unknown) => error)
    session.cancel()
    launch.resolve(browser)
    expect(await rendered).toBeInstanceOf(Error)
    expect(browser.killSync).toHaveBeenCalledTimes(1)
    expect(startExportResourceServer).not.toHaveBeenCalled()
    session.dispose()
    expect(browser.killSync).toHaveBeenCalledTimes(1)
  })

  it('资源服务启动期间取消：已启动浏览器与晚到服务分别释放一次', async () => {
    const started = deferred<void>()
    const listening = deferred<ExportResourceServer>()
    const browser = browserResource()
    const server = serverResource()
    vi.mocked(launchHeadlessBrowser).mockResolvedValue(browser)
    vi.mocked(startExportResourceServer).mockImplementation(() => {
      started.resolve()
      return listening.promise
    })
    const session = exportSession()
    const rendered = session.renderPage({ payload, options }).catch((error: unknown) => error)
    await started.promise
    session.cancel()
    expect(browser.killSync).toHaveBeenCalledTimes(1)
    listening.resolve(server)
    expect(await rendered).toBeInstanceOf(Error)
    expect(server.close).toHaveBeenCalledTimes(1)
    expect(createPageSession).not.toHaveBeenCalled()
    session.dispose()
    expect(browser.killSync).toHaveBeenCalledTimes(1)
    expect(server.close).toHaveBeenCalledTimes(1)
  })

  it('成功渲染和打印仍优雅关闭，重复 dispose 不再释放', async () => {
    const browser = browserResource()
    const server = serverResource()
    vi.mocked(launchHeadlessBrowser).mockResolvedValue(browser)
    vi.mocked(startExportResourceServer).mockResolvedValue(server)
    const session = exportSession()
    expect((await session.renderPage({ payload, options })).ready).toBe(true)
    expect((await session.finalizePrint(options)).bytes).toEqual(Buffer.from('%PDF-test'))
    session.dispose()
    session.dispose()
    expect(browser.close).toHaveBeenCalledTimes(1)
    expect(browser.killSync).not.toHaveBeenCalled()
    expect(server.close).toHaveBeenCalledTimes(1)
  })

  it('优雅关闭未完成时取消仍能接管强杀，并让打印任务收敛', async () => {
    const closeStarted = deferred<void>()
    let rejectClose!: (error: Error) => void
    const closing = new Promise<number | null>((_resolve, reject) => { rejectClose = reject })
    const browser = browserResource()
    const server = serverResource()
    vi.mocked(browser.close).mockImplementation(() => { closeStarted.resolve(); return closing })
    vi.mocked(browser.killSync).mockImplementation(() => { rejectClose(new Error('connection closed')) })
    vi.mocked(launchHeadlessBrowser).mockResolvedValue(browser)
    vi.mocked(startExportResourceServer).mockResolvedValue(server)
    const session = exportSession()
    await session.renderPage({ payload, options })
    const printing = session.finalizePrint(options)
    await closeStarted.promise
    session.cancel()
    expect(browser.killSync).toHaveBeenCalledTimes(1)
    await printing
    session.dispose()
    expect(browser.killSync).toHaveBeenCalledTimes(1)
    expect(server.close).toHaveBeenCalledTimes(1)
  })
})
