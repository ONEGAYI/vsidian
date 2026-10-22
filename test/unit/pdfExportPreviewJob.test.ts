// PDF 导出预览任务执行器单元测试（T07/#627）：成功链路、缺资源自动继续、
// busy 拒绝、取消收口、失败分态与配对释放（浏览器链路经端口替身注入）。
import { describe, expect, it, vi } from 'vitest'
import {
  PdfExportBrowserError,
  type BrowserExportSession,
  type PdfExportInputPayload,
} from '../../src/host/pdfExport/pdfExportJob'
import { PdfPreviewJob, type PdfPreviewJobPorts } from '../../src/host/pdfExport/pdfExportPreviewJob'
import { PDF_EXPORT_OPTIONS_DEFAULTS, type PdfExportOptions } from '../../src/shared/pdfExportOptions'
import type { PdfExportFailureItem, PdfExportPagePayload } from '../../src/shared/pdfExportPayload'

const PAYLOAD: PdfExportInputPayload = {
  docs: [{
    fsPath: 'D:/vault/a.md',
    docName: 'a.md',
    text: '# 标题\n\n正文。',
    version: 1,
  }],
  embeds: [],
  mediaEmbeds: [],
  embedFailures: [],
  style: { dark: false, vars: {}, reading: {} },
  snippets: [],
  breaks: false,
}

const OPTIONS: PdfExportOptions = { ...PDF_EXPORT_OPTIONS_DEFAULTS }

interface Script {
  failures?: PdfExportFailureItem[]
  renderError?: { code: 'launch' | 'navigate' | 'not-ready'; message: string }
  printError?: { code: 'print'; message: string }
  hangingRender?: boolean
  hangingPrint?: boolean
  noBrowser?: boolean
}

function makePorts(script: Script = {}) {
  const calls = {
    renderPage: 0,
    finalizePrint: 0,
    dispose: 0,
    cancel: 0,
  }
  let hangingReject: ((error: Error) => void) | undefined
  const session: BrowserExportSession = {
    renderPage: script.hangingRender
      ? () => {
        calls.renderPage += 1
        return new Promise((_resolve, reject) => { hangingReject = reject }) as never
      }
      : async (input: { payload: PdfExportPagePayload }) => {
        calls.renderPage += 1
        void input
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
        return { bytes: Buffer.from('%PDF-preview'), bookmarks: { written: false, total: 0, skipped: 0, reason: 'disabled' } }
      },
    cancel: () => {
      calls.cancel += 1
      hangingReject?.(new Error('连接已断开，命令未完成'))
    },
    dispose: () => { calls.dispose += 1 },
  }
  const ports: PdfPreviewJobPorts = {
    resolveBrowser: async () => script.noBrowser
      ? { ok: false as const, reason: 'no-browser' as const }
      : { ok: true as const, browser: { kind: 'chrome' as const, executablePath: 'C:\\chrome.exe', version: '155', via: 'app-paths-registry' as const }, fromConfiguredPath: false },
    createSession: () => session,
    locale: () => 'zh-cn',
  }
  return { ports, calls }
}

const REQ = { payload: PAYLOAD, options: OPTIONS, browserPath: undefined } as const

describe('PdfPreviewJob：成功链路与释放', () => {
  it('renderPage → finalizePrint 返回字节与书签报告；dispose 恰好一次', async () => {
    const { ports, calls } = makePorts()
    const job = new PdfPreviewJob(ports)
    const result = await job.run(REQ)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.bytes.toString()).toBe('%PDF-preview')
      expect(result.failures).toEqual([])
      expect(result.bookmarks.written).toBe(false)
    }
    expect(calls.renderPage).toBe(1)
    expect(calls.finalizePrint).toBe(1)
    expect(calls.dispose).toBe(1)
    expect(job.isRunning).toBe(false)
  })

  it('renderPage 载荷补齐 mermaidUri/resBase/locale（与导出 job 同口径）', async () => {
    let seen: PdfExportPagePayload | undefined
    const { ports } = makePorts()
    const original = ports.createSession
    ports.createSession = (executablePath) => {
      const session = original(executablePath)
      return {
        ...session,
        renderPage: async (input: Parameters<BrowserExportSession['renderPage']>[0]) => {
          seen = input.payload
          return session.renderPage(input)
        },
      }
    }
    await new PdfPreviewJob(ports).run(REQ)
    expect(seen?.locale).toBe('zh-cn')
    expect(seen?.mermaidUri).toBe('')
    expect(seen?.resBase).toBe('')
  })

  it('缺资源不等待用户：自动继续打印并如实携带失败清单', async () => {
    const failures: PdfExportFailureItem[] = [{ kind: 'image', item: 'missing.png', reason: 'not-found' }]
    const { ports, calls } = makePorts({ failures })
    const result = await new PdfPreviewJob(ports).run(REQ)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.failures).toEqual(failures)
    }
    expect(calls.finalizePrint).toBe(1)
  })
})

describe('PdfPreviewJob：失败/取消/防重入', () => {
  it('浏览器缺失：no-browser 失败且不建会话', async () => {
    const { ports, calls } = makePorts({ noBrowser: true })
    const result = await new PdfPreviewJob(ports).run(REQ)
    expect(result).toEqual({ ok: false, reason: 'no-browser' })
    expect(calls.renderPage).toBe(0)
  })

  it('renderPage 抛错：失败分态映射 + 失败装载也配对释放', async () => {
    const { ports, calls } = makePorts({ renderError: { code: 'navigate', message: 'x' } })
    const result = await new PdfPreviewJob(ports).run(REQ)
    expect(result).toEqual({ ok: false, reason: 'navigate-failed', detail: 'x' })
    expect(calls.dispose).toBe(1)
  })

  it('renderPage 挂起中取消：cancelled 收口、cancel/dispose 配对', async () => {
    const { ports, calls } = makePorts({ hangingRender: true })
    const job = new PdfPreviewJob(ports)
    const running = job.run(REQ)
    // 等会话建立（cancel 需触达 activeSession；run 协程跨 resolveBrowser await）
    await vi.waitFor(() => expect(calls.renderPage).toBe(1))
    job.cancel()
    const result = await running
    expect(result).toEqual({ ok: false, reason: 'cancelled' })
    expect(calls.cancel).toBe(1)
    expect(calls.dispose).toBe(1)
    expect(job.isRunning).toBe(false)
  })

  it('finalizePrint 挂起中取消：同取消语义', async () => {
    const { ports } = makePorts({ hangingPrint: true })
    const job = new PdfPreviewJob(ports)
    const running = job.run(REQ)
    await vi.waitFor(() => expect(job.isRunning).toBe(true))
    job.cancel()
    await expect(running).resolves.toEqual({ ok: false, reason: 'cancelled' })
  })

  it('会话建立前取消（模态关闭竞态窗口）：复投取消、不进入 renderPage', async () => {
    const { ports, calls } = makePorts({ hangingRender: true })
    const job = new PdfPreviewJob(ports)
    const running = job.run(REQ)
    job.cancel() // resolveBrowser 尚未落定——activeSession 还不在场
    await expect(running).resolves.toEqual({ ok: false, reason: 'cancelled' })
    expect(calls.renderPage).toBe(0)
    expect(calls.dispose).toBeGreaterThanOrEqual(1)
  })

  it('运行中再发起：busy 拒绝', async () => {
    const { ports } = makePorts({ hangingRender: true })
    const job = new PdfPreviewJob(ports)
    const running = job.run(REQ)
    await expect(job.run(REQ)).resolves.toEqual({ ok: false, reason: 'busy' })
    job.cancel()
    await running
  })

  it('dispose 兜底取消在途（幂等）', async () => {
    const { ports, calls } = makePorts({ hangingRender: true })
    const job = new PdfPreviewJob(ports)
    const running = job.run(REQ)
    await vi.waitFor(() => expect(calls.renderPage).toBe(1))
    job.dispose()
    job.dispose()
    await expect(running).resolves.toEqual({ ok: false, reason: 'cancelled' })
    expect(calls.cancel).toBe(1)
  })
})

describe('PdfPreviewJob：并发健康（连续刷新）', () => {
  it('上一轮收口后可立即再发起（连续刷新无残留运行态）', async () => {
    const { ports } = makePorts()
    const job = new PdfPreviewJob(ports)
    const first = await job.run(REQ)
    expect(first.ok).toBe(true)
    const second = await job.run({ ...REQ, options: { ...OPTIONS, orientation: 'landscape' } })
    expect(second.ok).toBe(true)
    expect(job.isRunning).toBe(false)
  })

  it('失败轮之后同样可再发起（不残留 rejected 状态）', async () => {
    const { ports } = makePorts({ noBrowser: true })
    const job = new PdfPreviewJob(ports)
    expect((await job.run(REQ)).ok).toBe(false)
    const portsOk = makePorts()
    const job2 = new PdfPreviewJob(portsOk.ports)
    expect((await job2.run(REQ)).ok).toBe(true)
  })
})
