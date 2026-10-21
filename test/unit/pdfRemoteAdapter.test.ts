// T08（#628）远端适配器单元测试：跨宿主命令端口注入替身，钉住——
// ping/浏览器解析分态（执行端缺失/协议代差/资产缺失/无浏览器）、
// renderPage 载荷装配与挂起资源回填循环、错误解码、取消命令、
// 分块写盘与对话框钩子短路。

import { describe, expect, it } from 'vitest'
import { createPdfRemoteAdapter, type PdfRemoteAdapterDeps } from '../../src/host/pdfExport/pdfRemoteAdapter'
import { PdfExportBrowserError } from '../../src/host/pdfExport/pdfExportJob'
import { PDF_EXECUTOR_COMMANDS, PDF_EXECUTOR_PROTOCOL_VERSION, encodePdfRemoteError } from '../../src/shared/pdfRemote'
import type { PdfRemotePingResult, PdfRemoteQueryTaskResult, PdfRemoteRenderPageRequest } from '../../src/shared/pdfRemote'
import type { PdfExportPagePayload, PdfExportReadyState } from '../../src/shared/pdfExportPayload'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

interface Harness {
  deps: PdfRemoteAdapterDeps
  calls: Array<{ command: string; arg: unknown }>
  setHandler(command: string, handler: (arg: any) => any): void
  dropHandler(command: string): void
}

function makeHarness(overrides: Partial<Pick<PdfRemoteAdapterDeps, 'resolveResource' | 'readResourceBytes' | 'knownDocFsPaths' | 'pageLabel' | 'testHooks'>> = {}): Harness {
  const calls: Array<{ command: string; arg: unknown }> = []
  const handlers = new Map<string, (arg: unknown) => unknown>()
  const exec = (command: string, arg?: unknown): Promise<unknown> => {
    calls.push({ command, arg })
    const handler = handlers.get(command)
    if (handler === undefined) {
      return Promise.reject(new Error(`command '${command}' not found`))
    }
    return Promise.resolve(handler(arg))
  }
  return {
    calls,
    setHandler: (command, handler) => handlers.set(command, handler),
    dropHandler: (command) => handlers.delete(command),
    deps: {
      exec,
      resolveResource: overrides.resolveResource ?? (async () => ({ ok: false as const, reason: 'not-found' as const })),
      readResourceBytes: overrides.readResourceBytes ?? (async () => new Uint8Array()),
      knownDocFsPaths: overrides.knownDocFsPaths ?? (() => new Set(['/d/a.md'])),
      pageLabel: overrides.pageLabel ?? (() => ({ pre: '第 ', mid: ' 页 / 共 ', post: ' 页' })),
      testHooks: overrides.testHooks ?? (() => undefined),
      ...('budgets' in (overrides as Record<string, unknown>) ? { budgets: (overrides as unknown as { budgets: PdfRemoteAdapterDeps['budgets'] }).budgets } : {}),
    },
  }
}

const fastBudgets = { pollIntervalMs: 5, pollTimeoutMs: 30, pollLossLimit: 2, pingTimeoutMs: 50, renderTimeoutMs: 500, printTimeoutMs: 200, writeTimeoutMs: 100, dialogTimeoutMs: 100 }

const okPing = (browser: PdfRemotePingResult['browser']): PdfRemotePingResult => ({
  protocolVersion: PDF_EXECUTOR_PROTOCOL_VERSION,
  platform: 'win32',
  browser,
  mainAssets: { present: true, missing: [] },
})

const readyState: PdfExportReadyState = { assembled: true, images: true, graphics: true, fonts: 'loaded', asyncReady: true, failures: [] }

const samplePayload = (): PdfExportPagePayload => ({
  docs: [{ fsPath: '/d/a.md', docName: 'a.md', text: '# t', version: 3 }],
  embeds: [],
  mediaEmbeds: [],
  embedFailures: [],
  style: { dark: false, vars: {}, reading: {} },
  snippets: [],
  breaks: false,
  mermaidUri: '',
  resBase: '',
  locale: 'zh-cn',
})

describe('resolveBrowser（ping 分态）', () => {
  it('执行端健康：浏览器结果透传，ping 携带配置路径', async () => {
    const h = makeHarness()
    h.setHandler(PDF_EXECUTOR_COMMANDS.ping, () => okPing({ ok: true, kind: 'chrome', executablePath: 'C:/Chrome/chrome.exe' }))
    const adapter = createPdfRemoteAdapter(h.deps)
    const result = await adapter.resolveBrowser('C:/my/chrome.exe')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.browser.executablePath).toBe('C:/Chrome/chrome.exe')
      expect(result.fromConfiguredPath).toBe(true)
    }
    expect(h.calls[0]).toEqual({ command: PDF_EXECUTOR_COMMANDS.ping, arg: { browserPath: 'C:/my/chrome.exe' } })
  })

  it('命令未注册（执行端未装）→ executor-missing', async () => {
    const h = makeHarness()
    const adapter = createPdfRemoteAdapter({ ...h.deps, budgets: fastBudgets })
    const result = await adapter.resolveBrowser(undefined)
    expect(result).toEqual({ ok: false, reason: 'executor-missing' })
  })

  it('协议版本不一致 → executor-missing（代差不冒充可用）', async () => {
    const h = makeHarness()
    h.setHandler(PDF_EXECUTOR_COMMANDS.ping, () => ({ ...okPing({ ok: true, kind: 'chrome', executablePath: 'x' }), protocolVersion: 999 }))
    const adapter = createPdfRemoteAdapter(h.deps)
    expect(await adapter.resolveBrowser(undefined)).toEqual({ ok: false, reason: 'executor-missing' })
  })

  it('主扩展本机资产缺失 → executor-missing', async () => {
    const h = makeHarness()
    h.setHandler(PDF_EXECUTOR_COMMANDS.ping, () => ({ ...okPing({ ok: true, kind: 'chrome', executablePath: 'x' }), mainAssets: { present: false, missing: ['mermaid.js'] } }))
    const adapter = createPdfRemoteAdapter(h.deps)
    expect(await adapter.resolveBrowser(undefined)).toEqual({ ok: false, reason: 'executor-missing' })
  })

  it('本机无浏览器/配置路径缺失如实分态', async () => {
    const h = makeHarness()
    h.setHandler(PDF_EXECUTOR_COMMANDS.ping, (arg: { browserPath?: string }) => {
      const ping = okPing(arg.browserPath ? { ok: false as const, reason: 'configured-path-missing' as const } : { ok: false as const, reason: 'no-browser' as const })
      return ping
    })
    const adapter = createPdfRemoteAdapter(h.deps)
    expect(await adapter.resolveBrowser(undefined)).toEqual({ ok: false, reason: 'no-browser' })
    expect(await adapter.resolveBrowser('C:/gone.exe')).toEqual({ ok: false, reason: 'configured-path-missing', configuredPath: 'C:/gone.exe' })
  })

  it('ping 挂起无回包 → 超时 executor-unreachable（断连不悬挂）', async () => {
    const h = makeHarness()
    h.setHandler(PDF_EXECUTOR_COMMANDS.ping, () => new Promise(() => undefined))
    const adapter = createPdfRemoteAdapter({ ...h.deps, budgets: fastBudgets })
    expect(await adapter.resolveBrowser(undefined)).toEqual({ ok: false, reason: 'executor-unreachable' })
  })
})

describe('会话（renderPage/finalizePrint/cancel）', () => {
  it('renderPage：载荷/守卫集合/页码词条随请求传递，结果透传', async () => {
    const h = makeHarness()
    h.setHandler(PDF_EXECUTOR_COMMANDS.renderPage, () => ({ ready: true, readyState, failures: [], headings: [] }))
    h.setHandler(PDF_EXECUTOR_COMMANDS.queryTask, (): PdfRemoteQueryTaskResult => ({ known: true, phase: 'rendering', pending: [] }))
    const adapter = createPdfRemoteAdapter({ ...h.deps, budgets: fastBudgets })
    const session = adapter.createSession('ignored')
    const result = await session.renderPage({ payload: samplePayload(), options: { paper: 'a4' } as never })
    expect(result.ready).toBe(true)
    const request = h.calls.find((c) => c.command === PDF_EXECUTOR_COMMANDS.renderPage)!.arg as PdfRemoteRenderPageRequest
    expect(request.knownDocFsPaths).toEqual(['/d/a.md'])
    expect(request.pageLabel).toEqual({ pre: '第 ', mid: ' 页 / 共 ', post: ' 页' })
    expect(request.payload.docs[0]!.text).toBe('# t')
    // 双轴评审 P1：远端身份在 renderPage 咽喉统一标注（页面据此不给远端 fsPath 产 file:/// 链接）
    expect(request.payload.remoteFs).toBe(true)
    expect(typeof request.taskId).toBe('string')
  })

  it('挂起资源：轮询发现 → 远端解析读字节 → provideResources 回填后 renderPage 完成', async () => {
    let released = false
    let pollCount = 0
    const provided: unknown[] = []
    const h = makeHarness({
      resolveResource: async (src) => src === 'img.png'
        ? { ok: true as const, fsPath: '/d/img.png', contentType: 'image/png' }
        : { ok: false as const, reason: 'not-found' as const },
      readResourceBytes: async () => new Uint8Array([9, 9, 9]),
    })
    h.setHandler(PDF_EXECUTOR_COMMANDS.renderPage, async () => {
      while (!released) await sleep(2)
      return { ready: true, readyState, failures: [], headings: [] }
    })
    h.setHandler(PDF_EXECUTOR_COMMANDS.queryTask, (): PdfRemoteQueryTaskResult => {
      pollCount += 1
      if (pollCount === 1) {
        return { known: true, phase: 'rendering', pending: [{ key: '/d/a.md\u0000img.png', src: 'img.png', doc: '/d/a.md' }] }
      }
      return { known: true, phase: 'rendering', pending: [] }
    })
    h.setHandler(PDF_EXECUTOR_COMMANDS.provideResources, (arg: { items: unknown[] }) => {
      provided.push(...arg.items)
      released = true
      return { accepted: true }
    })
    const adapter = createPdfRemoteAdapter({ ...h.deps, budgets: fastBudgets })
    const result = await adapter.createSession('x').renderPage({ payload: samplePayload(), options: {} as never })
    expect(result.ready).toBe(true)
    expect(provided).toEqual([
      { key: '/d/a.md\u0000img.png', ok: true, contentType: 'image/png', base64: Buffer.from([9, 9, 9]).toString('base64') },
    ])
  })

  it('资源解析失败：按 reason 回填失败面（页面登记缺资源）', async () => {
    let released = false
    const provided: unknown[] = []
    let poll = 0
    const h = makeHarness({
      resolveResource: async () => ({ ok: false as const, reason: 'blocked' as const }),
    })
    h.setHandler(PDF_EXECUTOR_COMMANDS.renderPage, async () => {
      while (!released) await sleep(2)
      return { ready: true, readyState, failures: [], headings: [] }
    })
    h.setHandler(PDF_EXECUTOR_COMMANDS.queryTask, (): PdfRemoteQueryTaskResult => {
      poll += 1
      return poll === 1
        ? { known: true, phase: 'rendering', pending: [{ key: 'k', src: 'x.png', doc: undefined }] }
        : { known: true, phase: 'rendering', pending: [] }
    })
    h.setHandler(PDF_EXECUTOR_COMMANDS.provideResources, (arg: { items: unknown[] }) => {
      provided.push(...arg.items)
      released = true
      return { accepted: true }
    })
    const adapter = createPdfRemoteAdapter({ ...h.deps, budgets: fastBudgets })
    await adapter.createSession('x').renderPage({ payload: samplePayload(), options: {} as never })
    expect(provided).toEqual([{ key: 'k', ok: false, reason: 'blocked' }])
  })

  it('执行端错误按机器码还原 PdfExportBrowserError 分态，并补发取消', async () => {
    const h = makeHarness()
    h.setHandler(PDF_EXECUTOR_COMMANDS.renderPage, () => {
      throw encodePdfRemoteError('not-ready', '页面未就绪')
    })
    const adapter = createPdfRemoteAdapter({ ...h.deps, budgets: fastBudgets })
    await expect(adapter.createSession('x').renderPage({ payload: samplePayload(), options: {} as never }))
      .rejects.toMatchObject({ code: 'not-ready' })
    expect(h.calls.some((c) => c.command === PDF_EXECUTOR_COMMANDS.cancelTask)).toBe(true)
  })

  it('renderPage 整体超时 → executor-unreachable 通道分态（断连无终态）', async () => {
    const h = makeHarness()
    h.setHandler(PDF_EXECUTOR_COMMANDS.renderPage, () => new Promise(() => undefined))
    h.setHandler(PDF_EXECUTOR_COMMANDS.queryTask, () => new Promise(() => undefined))
    const adapter = createPdfRemoteAdapter({ ...h.deps, budgets: { ...fastBudgets, renderTimeoutMs: 120, pollTimeoutMs: 1000, pollLossLimit: 50 } })
    const session = adapter.createSession('x')
    const outcome = session.renderPage({ payload: samplePayload(), options: {} as never })
    await expect(outcome).rejects.toMatchObject({ name: 'PdfExportRemoteChannelError' })
  })

  it('finalizePrint：base64 还原字节与书签报告；未知任务码收敛 launch 分态', async () => {
    const h = makeHarness()
    h.setHandler(PDF_EXECUTOR_COMMANDS.renderPage, () => ({ ready: true, readyState, failures: [], headings: [] }))
    h.setHandler(PDF_EXECUTOR_COMMANDS.finalizePrint, () => ({
      pdfBase64: Buffer.from('%PDF-1').toString('base64'),
      bookmarks: { written: true, total: 1, skipped: 0 },
    }))
    const adapter = createPdfRemoteAdapter({ ...h.deps, budgets: fastBudgets })
    const session = adapter.createSession('x')
    await session.renderPage({ payload: samplePayload(), options: {} as never })
    const printed = await session.finalizePrint({} as never)
    expect(printed.bytes.toString()).toBe('%PDF-1')
    expect(printed.bookmarks).toEqual({ written: true, total: 1, skipped: 0 })

    h.setHandler(PDF_EXECUTOR_COMMANDS.finalizePrint, () => {
      throw encodePdfRemoteError('unknown-task', '任务不可用')
    })
    const second = adapter.createSession('x')
    await second.renderPage({ payload: samplePayload(), options: {} as never })
    await expect(second.finalizePrint({} as never)).rejects.toBeInstanceOf(PdfExportBrowserError)
  })

  it('cancel 触发 cancelTask 协作式取消；dispose 幂等', async () => {
    const h = makeHarness()
    h.setHandler(PDF_EXECUTOR_COMMANDS.renderPage, () => ({ ready: true, readyState, failures: [], headings: [] }))
    const adapter = createPdfRemoteAdapter({ ...h.deps, budgets: fastBudgets })
    const session = adapter.createSession('x')
    await session.renderPage({ payload: samplePayload(), options: {} as never })
    session.cancel()
    session.dispose()
    const cancels = h.calls.filter((c) => c.command === PDF_EXECUTOR_COMMANDS.cancelTask)
    expect(cancels.length).toBe(1)
    await expect(session.renderPage({ payload: samplePayload(), options: {} as never })).rejects.toMatchObject({ code: 'launch' })
  })
})

describe('写盘分块与对话框', () => {
  it('小产物单命令直写（total=1）', async () => {
    const h = makeHarness()
    h.setHandler(PDF_EXECUTOR_COMMANDS.writeFileAtomic, () => ({ written: true }))
    const adapter = createPdfRemoteAdapter({ ...h.deps, budgets: fastBudgets })
    await adapter.writeFile('D:/out/a.pdf', new Uint8Array([1, 2]))
    const writes = h.calls.filter((c) => c.command === PDF_EXECUTOR_COMMANDS.writeFileAtomic)
    expect(writes.length).toBe(1)
    const arg = writes[0]!.arg as { writeId: string; seq: number; total: number; base64: string; targetPath: string }
    expect(arg.total).toBe(1)
    expect(arg.seq).toBe(0)
    expect(arg.targetPath).toBe('D:/out/a.pdf')
    expect(Buffer.from(arg.base64, 'base64')).toEqual(Buffer.from([1, 2]))
  })

  it('大产物分块：块序完整、writeId 一致、拼接还原原文', async () => {
    const h = makeHarness()
    h.setHandler(PDF_EXECUTOR_COMMANDS.writeFileAtomic, () => ({ assembling: true }))
    const adapter = createPdfRemoteAdapter({ ...h.deps, budgets: fastBudgets })
    // raw ≈ 4.8MB → base64 ≈ 6.4MB > 6MB 上限 → 2 块
    const bytes = Buffer.alloc(4_800_000)
    bytes.fill(7)
    await adapter.writeFile('D:/out/big.pdf', bytes)
    const writes = h.calls.filter((c) => c.command === PDF_EXECUTOR_COMMANDS.writeFileAtomic).map((c) => c.arg as { writeId: string; seq: number; total: number; base64: string })
    expect(writes.length).toBe(2)
    expect(new Set(writes.map((w) => w.writeId)).size).toBe(1)
    expect(writes.map((w) => w.seq)).toEqual([0, 1])
    expect(writes.every((w) => w.total === 2)).toBe(true)
    // 大缓冲逐字节深比较开销大——sha256 对读（拼接 base64 还原后与原文等值）
    const { createHash } = await import('node:crypto')
    const reassembled = Buffer.from(writes.map((w) => w.base64).join(''), 'base64')
    expect(reassembled.length).toBe(bytes.length)
    expect(createHash('sha256').update(reassembled).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'))
  }, 20_000)

  it('保存对话框钩子短路；无钩子走执行端命令，null = 取消', async () => {
    const hooked = makeHarness({ testHooks: () => ({ hooks: true, saveTarget: 'D:/hook/a.pdf' }) })
    const adapterHooked = createPdfRemoteAdapter({ ...hooked.deps, budgets: fastBudgets })
    expect(await adapterHooked.showSaveDialog('a.pdf')).toBe('D:/hook/a.pdf')
    expect(hooked.calls.length).toBe(0)

    const h = makeHarness()
    h.setHandler(PDF_EXECUTOR_COMMANDS.showSaveDialog, () => 'D:/out/a.pdf')
    const adapter = createPdfRemoteAdapter({ ...h.deps, budgets: fastBudgets })
    expect(await adapter.showSaveDialog('a.pdf')).toBe('D:/out/a.pdf')
    h.setHandler(PDF_EXECUTOR_COMMANDS.showSaveDialog, () => null)
    expect(await adapter.showSaveDialog('a.pdf')).toBeUndefined()
  })

  it('目录选择钩子短路与执行端命令；statFiles 批量探测', async () => {
    const hooked = makeHarness({ testHooks: () => ({ hooks: true, targetDir: 'D:/hook' }) })
    expect(await createPdfRemoteAdapter({ ...hooked.deps, budgets: fastBudgets }).showOpenDialogDir()).toBe('D:/hook')

    const h = makeHarness()
    h.setHandler(PDF_EXECUTOR_COMMANDS.statFiles, (arg: { paths: string[] }) => ({
      entries: arg.paths.map((p, i) => ({ path: p, exists: i === 0, isFile: i === 0 })),
    }))
    const entries = await createPdfRemoteAdapter({ ...h.deps, budgets: fastBudgets }).statFiles(['a', 'b'])
    expect(entries).toEqual([
      { path: 'a', exists: true, isFile: true },
      { path: 'b', exists: false, isFile: false },
    ])
  })
})
