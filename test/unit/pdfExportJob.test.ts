// PDF 导出任务编排单元测试（T01/#621 建立，T02/#622 升级两段式端口与
// 缺资源选择）：状态机、代次、取消、失败分态、awaiting-resources 继续/
// 取消两分支与资源配对释放（浏览器链路经 BrowserExportSession 端口注入
// 替身）。
import { describe, expect, it, vi } from 'vitest'
import {
  PdfExportBrowserError,
  PdfExportJob,
  type BrowserExportSession,
  type PdfExportJobPorts,
} from '../../src/host/pdfExport/pdfExportJob'
import { PDF_EXPORT_OPTIONS_DEFAULTS } from '../../src/shared/pdfExportOptions'
import type { PdfExportFailureItem, PdfExportPagePayload } from '../../src/shared/pdfExportPayload'

const INPUT = {
  docName: '笔记甲.md',
  capturedVersion: 3,
  payload: {
    docs: [{
      fsPath: 'D:/vault/笔记甲.md',
      docName: '笔记甲.md',
      text: '# 标题\n\n正文段。',
      version: 3,
    }],
    embeds: [],
    mediaEmbeds: [],
    embedFailures: [],
    style: { dark: false, vars: {}, reading: {} },
    snippets: [],
    breaks: false,
  },
} as const

interface SessionScript {
  /** renderPage 的失败清单（缺资源分支；缺省空） */
  failures?: PdfExportFailureItem[]
  /** renderPage 抛错（launch/navigate/not-ready 分态） */
  renderError?: { code: 'launch' | 'navigate' | 'not-ready'; message: string }
  /** finalizePrint 抛错（print 分态） */
  printError?: { code: 'print'; message: string }
  /** renderPage 挂起直至 cancel()（模拟 killSync 后在途命令立即 reject） */
  hangingRender?: boolean
  /** finalizePrint 挂起直至 cancel() */
  hangingPrint?: boolean
  /** T05：finalizePrint 的书签报告（缺省 disabled 形态） */
  bookmarks?: { written: boolean; total: number; skipped: number; reason?: string }
}

function makePorts(script: SessionScript = {}) {
  const calls = {
    resolveBrowser: [] as string[],
    createSession: [] as string[],
    renderPage: [] as Array<{ docName: string; locale: string; mermaidUri: string; resBase: string }>,
    finalizePrint: 0,
    dispose: 0,
    cancel: 0,
    showSaveDialog: [] as string[],
    writeFile: [] as Array<{ target: string; bytes: number }>,
  }
  let hangingReject: ((error: Error) => void) | undefined
  const session: BrowserExportSession = {
    renderPage: script.hangingRender
      ? () => new Promise((_resolve, reject) => { hangingReject = reject }) as never
      : async (input: { payload: PdfExportPagePayload }) => {
        calls.renderPage.push({
          docName: input.payload.docs[0]!.docName,
          locale: input.payload.locale,
          mermaidUri: input.payload.mermaidUri,
          resBase: input.payload.resBase,
        })
        if (script.renderError) {
          throw new PdfExportBrowserError(script.renderError.code, script.renderError.message)
        }
        return {
          ready: true,
          readyState: { assembled: true, images: true, graphics: true, fonts: 'loaded', asyncReady: true, failures: script.failures ?? [] },
          failures: script.failures ?? [],
          headings: [],
        }
      },
    finalizePrint: script.hangingPrint
      ? () => {
        calls.finalizePrint += 1
        return new Promise<{ bytes: Buffer; bookmarks: { written: boolean; total: number; skipped: number } }>((_resolve, reject) => { hangingReject = reject })
      }
      : async () => {
        calls.finalizePrint += 1
        if (script.printError) {
          throw new PdfExportBrowserError(script.printError.code, script.printError.message)
        }
        return { bytes: Buffer.from('%PDF-mock'), bookmarks: script.bookmarks ?? { written: false, total: 0, skipped: 0, reason: 'disabled' } }
      },
    cancel: () => {
      calls.cancel += 1
      hangingReject?.(new Error('连接已断开，命令未完成'))
    },
    dispose: () => { calls.dispose += 1 },
  }
  const ports: PdfExportJobPorts = {
    resolveBrowser: async (configuredPath) => {
      calls.resolveBrowser.push(configuredPath ?? '')
      return { ok: true, browser: { kind: 'chrome', executablePath: 'C:\\chrome.exe', version: '155', via: 'app-paths-registry' }, fromConfiguredPath: false }
    },
    createSession: (executablePath) => {
      calls.createSession.push(executablePath)
      return session
    },
    showSaveDialog: async (defaultName) => {
      calls.showSaveDialog.push(defaultName)
      return `D:\\out\\${defaultName}`
    },
    writeFile: async (target, bytes) => {
      calls.writeFile.push({ target, bytes: bytes.length })
    },
    locale: () => 'zh-cn',
  }
  return { ports, calls }
}

describe('PdfExportJob：成功链路（T02 两段式）', () => {
  it('generating → saving → done；renderPage 载荷携带固定输入 docs 与 locale；落盘字节真实', async () => {
    const { ports, calls } = makePorts()
    const job = new PdfExportJob(ports)
    const result = await job.run(INPUT as never, PDF_EXPORT_OPTIONS_DEFAULTS, undefined)
    expect(result.ok).toBe(true)
    expect(result.state.phase).toBe('done')
    expect(result.state.savedPath).toBe('D:\\out\\笔记甲.pdf')
    expect(calls.showSaveDialog).toEqual(['笔记甲.pdf'])
    expect(calls.writeFile).toEqual([{ target: 'D:\\out\\笔记甲.pdf', bytes: 9 }])
    expect(calls.dispose).toBe(1)
    expect(calls.finalizePrint).toBe(1)
    expect(calls.renderPage[0]).toMatchObject({ docName: '笔记甲.md', locale: 'zh-cn' })
  })

  it('T05 书签报告透传：session 的 bookmarks 进入终态 state（done 观测面）', async () => {
    const { ports } = makePorts({
      bookmarks: { written: true, total: 5, skipped: 1 },
    })
    const job = new PdfExportJob(ports)
    const result = await job.run(INPUT as never, PDF_EXPORT_OPTIONS_DEFAULTS, undefined)
    expect(result.ok).toBe(true)
    expect(result.state.bookmarks).toEqual({ written: true, total: 5, skipped: 1 })
    // 缺省（书签关）形态：disabled 报告如实透传
    const plain = new PdfExportJob(makePorts().ports)
    const plainResult = await plain.run(INPUT as never, PDF_EXPORT_OPTIONS_DEFAULTS, undefined)
    expect(plainResult.state.bookmarks).toEqual({ written: false, total: 0, skipped: 0, reason: 'disabled' })
  })

  it('代次单调递增，状态推送每阶段到达', async () => {
    const { ports } = makePorts()
    const job = new PdfExportJob(ports)
    const phases: string[] = []
    job.onStateChange = (state) => phases.push(`${state.generation}:${state.phase}`)
    await job.run(INPUT as never, PDF_EXPORT_OPTIONS_DEFAULTS, undefined)
    await job.run(INPUT as never, PDF_EXPORT_OPTIONS_DEFAULTS, undefined)
    expect(phases).toEqual([
      '1:generating', '1:saving', '1:done',
      '2:generating', '2:saving', '2:done',
    ])
  })
})

describe('PdfExportJob：缺资源选择（T02 awaiting-resources）', () => {
  const failures: PdfExportFailureItem[] = [
    { kind: 'image', item: 'assets/a.png', reason: 'not-found' },
    { kind: 'embed', item: 'missing-note', reason: 'not-found' },
  ]

  it('失败清单非空：进入 awaiting-resources，state 携带清单', async () => {
    const { ports, calls } = makePorts({ failures })
    const job = new PdfExportJob(ports)
    const running = job.run(INPUT as never, PDF_EXPORT_OPTIONS_DEFAULTS, undefined)
    await vi.waitFor(() => expect(job.state.phase).toBe('awaiting-resources'))
    expect(job.state.resourceIssues).toEqual(failures)
    // 等待选择期间不打印、不落盘、不释放
    expect(calls.finalizePrint).toBe(0)
    expect(calls.showSaveDialog).toHaveLength(0)
    expect(calls.dispose).toBe(0)
    job.resolveResourceChoice(false)
    const result = await running
    expect(result.kind).toBe('cancelled')
    expect(result.state.cancelKind).toBe('user')
    expect(calls.finalizePrint).toBe(0)
    expect(calls.dispose).toBe(1)
  })

  it('用户选择继续：回到 generating → finalizePrint → saving → done', async () => {
    const { ports, calls } = makePorts({ failures })
    const job = new PdfExportJob(ports)
    const phases: string[] = []
    job.onStateChange = (state) => phases.push(state.phase)
    const running = job.run(INPUT as never, PDF_EXPORT_OPTIONS_DEFAULTS, undefined)
    await vi.waitFor(() => expect(job.state.phase).toBe('awaiting-resources'))
    job.resolveResourceChoice(true)
    const result = await running
    expect(result.ok).toBe(true)
    expect(result.state.phase).toBe('done')
    expect(phases).toEqual(['generating', 'awaiting-resources', 'generating', 'saving', 'done'])
    expect(job.state.resourceIssues).toBeUndefined()
    expect(calls.finalizePrint).toBe(1)
  })

  it('等待选择期间 cancel：立即取消并释放（清单不残留）', async () => {
    const { ports, calls } = makePorts({ failures })
    const job = new PdfExportJob(ports)
    const running = job.run(INPUT as never, PDF_EXPORT_OPTIONS_DEFAULTS, undefined)
    await vi.waitFor(() => expect(job.state.phase).toBe('awaiting-resources'))
    job.cancel()
    const result = await running
    expect(result.kind).toBe('cancelled')
    expect(calls.cancel).toBe(1)
    expect(calls.dispose).toBe(1)
    expect(calls.showSaveDialog).toHaveLength(0)
  })
})

describe('PdfExportJob：失败分态', () => {
  it.each([
    ['no-browser', { ok: false as const, reason: 'no-browser' as const }],
    ['configured-path-missing', { ok: false as const, reason: 'configured-path-missing' as const }],
  ])('%s：resolveBrowser 失败直通分态、不建会话', async (expected, resolveResult) => {
    const { ports, calls } = makePorts()
    ports.resolveBrowser = async () => resolveResult as never
    const job = new PdfExportJob(ports)
    const result = await job.run(INPUT as never, PDF_EXPORT_OPTIONS_DEFAULTS, undefined)
    expect(result.state.phase).toBe('failed')
    expect(result.state.failReason).toBe(expected)
    expect(calls.createSession).toHaveLength(0)
  })

  it.each([
    ['launch', 'launch-failed'],
    ['navigate', 'navigate-failed'],
    ['not-ready', 'not-ready'],
  ])('renderPage 链路 %s 错误映射 %s，会话释放恰好一次', async (code, expected) => {
    const { ports, calls } = makePorts({ renderError: { code: code as 'launch', message: 'mock' } })
    const job = new PdfExportJob(ports)
    const result = await job.run(INPUT as never, PDF_EXPORT_OPTIONS_DEFAULTS, undefined)
    expect(result.state.phase).toBe('failed')
    expect(result.state.failReason).toBe(expected)
    expect(calls.dispose).toBe(1)
  })

  it('finalizePrint 的 print 错误映射 print-failed，会话释放恰好一次', async () => {
    const { ports, calls } = makePorts({ printError: { code: 'print', message: 'mock' } })
    const job = new PdfExportJob(ports)
    const result = await job.run(INPUT as never, PDF_EXPORT_OPTIONS_DEFAULTS, undefined)
    expect(result.state.phase).toBe('failed')
    expect(result.state.failReason).toBe('print-failed')
    expect(calls.dispose).toBe(1)
  })

  it('写盘失败：failed/write-failed', async () => {
    const { ports } = makePorts()
    ports.writeFile = async () => { throw new Error('disk full') }
    const job = new PdfExportJob(ports)
    const result = await job.run(INPUT as never, PDF_EXPORT_OPTIONS_DEFAULTS, undefined)
    expect(result.state.phase).toBe('failed')
    expect(result.state.failReason).toBe('write-failed')
  })
})

describe('PdfExportJob：取消与防重入', () => {
  it('renderPage 挂起中用户取消：session.cancel 调用、产物不落盘、终态 cancelled/user', async () => {
    const { ports, calls } = makePorts({ hangingRender: true })
    const job = new PdfExportJob(ports)
    const running = job.run(INPUT as never, PDF_EXPORT_OPTIONS_DEFAULTS, undefined)
    await vi.waitFor(() => expect(job.isRunning).toBe(true))
    job.cancel()
    const result = await running
    expect(result.state.phase).toBe('cancelled')
    expect(result.state.cancelKind).toBe('user')
    expect(calls.cancel).toBe(1)
    expect(calls.showSaveDialog).toHaveLength(0)
    expect(calls.writeFile).toHaveLength(0)
  })

  it('finalizePrint 挂起中用户取消：同取消语义收口', async () => {
    const { ports, calls } = makePorts({ hangingPrint: true })
    const job = new PdfExportJob(ports)
    const running = job.run(INPUT as never, PDF_EXPORT_OPTIONS_DEFAULTS, undefined)
    // 等 finalizePrint 被调用（renderPage 已成功、进入打印挂起）
    await vi.waitFor(() => expect(calls.finalizePrint).toBe(1))
    job.cancel()
    const result = await running
    expect(result.state.phase).toBe('cancelled')
    expect(result.state.cancelKind).toBe('user')
    expect(calls.showSaveDialog).toHaveLength(0)
  })

  it('保存对话框取消：cancelled/save-dialog、不写盘', async () => {
    const { ports, calls } = makePorts()
    ports.showSaveDialog = async () => undefined
    const job = new PdfExportJob(ports)
    const result = await job.run(INPUT as never, PDF_EXPORT_OPTIONS_DEFAULTS, undefined)
    expect(result.state.phase).toBe('cancelled')
    expect(result.state.cancelKind).toBe('save-dialog')
    expect(calls.writeFile).toHaveLength(0)
  })

  it('任务进行中再发起：busy 拒绝且不改当前代次', async () => {
    const { ports } = makePorts()
    const job = new PdfExportJob(ports)
    const running = job.run(INPUT as never, PDF_EXPORT_OPTIONS_DEFAULTS, undefined)
    await vi.waitFor(() => expect(job.isRunning).toBe(true))
    const again = await job.run(INPUT as never, PDF_EXPORT_OPTIONS_DEFAULTS, undefined)
    expect(again.kind).toBe('busy')
    expect(again.state.failReason).toBe('busy')
    expect((await running).state.phase).toBe('done')
  })

  it('dispose 兜底取消在途任务（模态关闭路径）', async () => {
    const { ports, calls } = makePorts({ hangingRender: true })
    const job = new PdfExportJob(ports)
    const running = job.run(INPUT as never, PDF_EXPORT_OPTIONS_DEFAULTS, undefined)
    await vi.waitFor(() => expect(job.isRunning).toBe(true))
    job.dispose()
    const result = await running
    expect(result.state.phase).toBe('cancelled')
    expect(calls.cancel).toBe(1)
  })
})

describe('PdfExportJob：预览产物复用（T07 precomputed）', () => {
  it('指纹核对相等的预览字节：跳过浏览器链路，直接保存对话框与写盘', async () => {
    const { ports, calls } = makePorts()
    const job = new PdfExportJob(ports)
    const precomputed = {
      bytes: Uint8Array.from(Buffer.from('%PDF-preview-bytes')),
      bookmarks: { written: true, total: 2, skipped: 0 } as never,
    }
    const result = await job.run(INPUT as never, PDF_EXPORT_OPTIONS_DEFAULTS, undefined, precomputed)
    expect(result.kind).toBe('done')
    expect(result.bytes?.toString()).toBe('%PDF-preview-bytes')
    // 未启动浏览器（resolveBrowser/createSession/renderPage 零调用）
    expect(calls.resolveBrowser).toHaveLength(0)
    expect(calls.createSession).toHaveLength(0)
    expect(calls.renderPage).toHaveLength(0)
    expect(calls.finalizePrint).toBe(0)
    // 保存对话框与写盘真实走通；书签报告透传
    expect(calls.showSaveDialog).toHaveLength(1)
    expect(calls.writeFile).toEqual([{ target: 'D:' + '\\' + 'out' + '\\' + '笔记甲.pdf', bytes: '%PDF-preview-bytes'.length }])
    expect(result.state.bookmarks?.written).toBe(true)
  })

  it('复用路径保存对话框取消：cancelled/save-dialog、不写盘', async () => {
    const { ports, calls } = makePorts()
    ports.showSaveDialog = async () => undefined
    const job = new PdfExportJob(ports)
    const result = await job.run(INPUT as never, PDF_EXPORT_OPTIONS_DEFAULTS, undefined, {
      bytes: Uint8Array.from(Buffer.from('%PDF-x')),
      bookmarks: { written: false, total: 0, skipped: 0 } as never,
    })
    expect(result.state.phase).toBe('cancelled')
    expect(result.state.cancelKind).toBe('save-dialog')
    expect(calls.writeFile).toHaveLength(0)
  })

  it('复用路径写盘失败：failed/write-failed（不静默成功）', async () => {
    const { ports } = makePorts()
    ports.writeFile = async () => { throw new Error('disk full') }
    const job = new PdfExportJob(ports)
    const result = await job.run(INPUT as never, PDF_EXPORT_OPTIONS_DEFAULTS, undefined, {
      bytes: Uint8Array.from(Buffer.from('%PDF-x')),
      bookmarks: { written: false, total: 0, skipped: 0 } as never,
    })
    expect(result.kind).toBe('failed')
    expect(result.state.failReason).toBe('write-failed')
  })
})
