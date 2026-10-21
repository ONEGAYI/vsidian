// T01（#621）PDF 导出任务编排单元测试：状态机、代次、取消、失败分态与
// 资源配对释放（浏览器链路经 BrowserExportSession 端口注入替身）。
import { describe, expect, it, vi } from 'vitest'
import {
  PdfExportBrowserError,
  PdfExportJob,
  type BrowserExportSession,
  type PdfExportJobPorts,
} from '../../src/host/pdfExport/pdfExportJob'
import { PDF_EXPORT_OPTIONS_DEFAULTS } from '../../src/shared/pdfExportOptions'

const INPUT = {
  docName: '笔记甲.md',
  markdown: '# 标题\n\n正文段。',
  capturedVersion: 3,
  readingStyleSnapshot: {},
}

interface SessionScript {
  exportPdf?: (input: { html: string }) => Promise<Buffer> | never
  /** 挂起直至 cancel() 触发 reject（模拟 killSync 后在途命令立即 reject） */
  hanging?: boolean
}

function makePorts(script: SessionScript = {}) {
  const calls = {
    resolveBrowser: [] as string[],
    createSession: [] as string[],
    dispose: 0,
    cancel: 0,
    showSaveDialog: [] as string[],
    writeFile: [] as Array<{ target: string; bytes: number }>,
    html: [] as string[],
  }
  // 挂起中导出的 reject 句柄：cancel() 触发（模拟 killSync 后在途命令
  // 立即 reject——V01 §8 实测语义）
  let hangingReject: ((error: Error) => void) | undefined
  const session: BrowserExportSession = {
    exportPdf: script.hanging
      ? () => new Promise<Buffer>((_resolve, reject) => { hangingReject = reject })
      : script.exportPdf ?? (async () => Buffer.from('%PDF-mock')),
    cancel: () => {
      calls.cancel += 1
      hangingReject?.(new Error('连接已断开，命令 Page.printToPDF 未完成'))
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
    onHtmlAssembled: (html) => { calls.html.push(html) },
  }
  return { ports, calls }
}

describe('PdfExportJob：成功链路', () => {
  it('generating → saving → done；保存对话框默认名去 .md 加 .pdf；落盘字节真实', async () => {
    const { ports, calls } = makePorts()
    const job = new PdfExportJob(ports)
    const result = await job.run(INPUT, PDF_EXPORT_OPTIONS_DEFAULTS, undefined)
    expect(result.ok).toBe(true)
    expect(result.state.phase).toBe('done')
    expect(result.state.savedPath).toBe('D:\\out\\笔记甲.pdf')
    expect(calls.showSaveDialog).toEqual(['笔记甲.pdf'])
    expect(calls.writeFile).toEqual([{ target: 'D:\\out\\笔记甲.pdf', bytes: 9 }])
    expect(calls.dispose).toBe(1)
    // 装配 HTML 观测点收到完整装配（含固定输入正文渲染）
    expect(calls.html[0]).toContain('<h1>标题</h1>')
  })

  it('代次单调递增，状态推送每阶段到达', async () => {
    const { ports } = makePorts()
    const job = new PdfExportJob(ports)
    const phases: string[] = []
    job.onStateChange = (state) => phases.push(`${state.generation}:${state.phase}`)
    await job.run(INPUT, PDF_EXPORT_OPTIONS_DEFAULTS, undefined)
    await job.run(INPUT, PDF_EXPORT_OPTIONS_DEFAULTS, undefined)
    expect(phases).toEqual(['1:generating', '1:saving', '1:done', '2:generating', '2:saving', '2:done'])
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
    const result = await job.run(INPUT, PDF_EXPORT_OPTIONS_DEFAULTS, undefined)
    expect(result.state.phase).toBe('failed')
    expect(result.state.failReason).toBe(expected)
    expect(calls.createSession).toHaveLength(0)
  })

  it.each([
    ['launch', 'launch-failed'],
    ['navigate', 'navigate-failed'],
    ['not-ready', 'not-ready'],
    ['print', 'print-failed'],
  ])('浏览器链路 %s 错误映射 %s，会话释放恰好一次', async (code, expected) => {
    const { ports, calls } = makePorts({
      exportPdf: () => { throw new PdfExportBrowserError(code as 'launch', 'mock') },
    })
    const job = new PdfExportJob(ports)
    const result = await job.run(INPUT, PDF_EXPORT_OPTIONS_DEFAULTS, undefined)
    expect(result.state.phase).toBe('failed')
    expect(result.state.failReason).toBe(expected)
    expect(calls.dispose).toBe(1)
  })

  it('写盘失败：failed/write-failed', async () => {
    const { ports } = makePorts()
    ports.writeFile = async () => { throw new Error('disk full') }
    const job = new PdfExportJob(ports)
    const result = await job.run(INPUT, PDF_EXPORT_OPTIONS_DEFAULTS, undefined)
    expect(result.state.phase).toBe('failed')
    expect(result.state.failReason).toBe('write-failed')
  })
})

describe('PdfExportJob：取消与防重入', () => {
  it('生成中用户取消：session.cancel 调用、产物不落盘、终态 cancelled/user', async () => {
    const { ports, calls } = makePorts({ hanging: true })
    const job = new PdfExportJob(ports)
    const running = job.run(INPUT, PDF_EXPORT_OPTIONS_DEFAULTS, undefined)
    await vi.waitFor(() => expect(job.isRunning).toBe(true))
    job.cancel()
    const result = await running
    expect(result.state.phase).toBe('cancelled')
    expect(result.state.cancelKind).toBe('user')
    expect(calls.cancel).toBe(1)
    expect(calls.showSaveDialog).toHaveLength(0)
    expect(calls.writeFile).toHaveLength(0)
  })

  it('保存对话框取消：cancelled/save-dialog、不写盘', async () => {
    const { ports, calls } = makePorts()
    ports.showSaveDialog = async () => undefined
    const job = new PdfExportJob(ports)
    const result = await job.run(INPUT, PDF_EXPORT_OPTIONS_DEFAULTS, undefined)
    expect(result.state.phase).toBe('cancelled')
    expect(result.state.cancelKind).toBe('save-dialog')
    expect(calls.writeFile).toHaveLength(0)
  })

  it('任务进行中再发起：busy 拒绝且不改当前代次', async () => {
    const { ports } = makePorts({
      exportPdf: () => new Promise((resolve) => setTimeout(() => resolve(Buffer.from('x')), 60)),
    })
    const job = new PdfExportJob(ports)
    const running = job.run(INPUT, PDF_EXPORT_OPTIONS_DEFAULTS, undefined)
    await vi.waitFor(() => expect(job.isRunning).toBe(true))
    const again = await job.run(INPUT, PDF_EXPORT_OPTIONS_DEFAULTS, undefined)
    expect(again.kind).toBe('busy')
    expect(again.state.failReason).toBe('busy')
    expect((await running).state.phase).toBe('done')
  })

  it('dispose 兜底取消在途任务（模态关闭路径）', async () => {
    const { ports, calls } = makePorts({ hanging: true })
    const job = new PdfExportJob(ports)
    const running = job.run(INPUT, PDF_EXPORT_OPTIONS_DEFAULTS, undefined)
    await vi.waitFor(() => expect(job.isRunning).toBe(true))
    job.dispose()
    const result = await running
    expect(result.state.phase).toBe('cancelled')
    expect(calls.cancel).toBe(1)
  })
})
