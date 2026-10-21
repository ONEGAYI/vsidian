// T04（#624）批量导出执行器单元测试：逐文件两段式循环（renderPage →
// awaiting-resources → finalizePrint）、单项失败继续其余、skip 条目跳过、
// 取消保留已完成、resume/resume-all 缺资源选择与配对释放。
// 浏览器链路经 BrowserExportSession 端口替身注入（T01/T02 单测同模式）。
import { describe, expect, it, vi } from 'vitest'
import { PdfExportBrowserError, type BrowserExportSession } from '../../src/host/pdfExport/pdfExportJob'
import { PdfBatchJob, type PdfBatchJobPorts } from '../../src/host/pdfExport/pdfExportBatchJob'
import { planBatchMapping, type PdfBatchConflictStrategy, type PdfBatchItem } from '../../src/shared/pdfExportBatch'
import { PDF_EXPORT_OPTIONS_DEFAULTS } from '../../src/shared/pdfExportOptions'
import type { PdfExportInputPayload } from '../../src/host/pdfExport/pdfExportJob'

const payloadOf = (name: string): PdfExportInputPayload => ({
  docs: [{ fsPath: `D:/v/${name}`, docName: name, text: `# ${name}`, version: 1 }],
  embeds: [],
  mediaEmbeds: [],
  embedFailures: [],
  style: { dark: false, vars: {}, reading: {} },
  snippets: [],
  breaks: false,
})

interface FileScript {
  name: string
  /** captureDoc 失败原因（缺省成功） */
  captureFail?: string
  /** renderPage 失败清单（缺资源分支） */
  failures?: Array<{ kind: string; item: string; reason: string }>
  /** renderPage 抛错分态 */
  renderError?: { code: 'launch' | 'navigate' | 'not-ready' | 'print'; message: string }
  /** writeFile 抛错 */
  writeFail?: boolean
  /** renderPage 挂起直至 cancel */
  hangingRender?: boolean
}

interface Harness {
  ports: PdfBatchJobPorts
  job: PdfBatchJob
  calls: {
    capture: string[]
    writeFile: Array<{ target: string; bytes: number }>
    sessionDispose: number
    sessionCancel: number
  }
  /** 手动驱动 awaiting-resources 选择 */
  choose(choice: 'resume' | 'resume-all' | false): void
}

function makeHarness(files: FileScript[]): Harness {
  const calls = { capture: [] as string[], writeFile: [] as Array<{ target: string; bytes: number }>, sessionDispose: 0, sessionCancel: 0 }
  const scripts = new Map(files.map((f) => [f.name, f]))
  /** 挂起中的 renderPage reject 队列：cancel()（killSync 语义）触发连接断开
   *  reject——在途命令立即失败，忠实于生产 browserLauncher 行为 */
  const hangingRejects = new Set<(error: Error) => void>()
  const ports: PdfBatchJobPorts = {
    resolveBrowser: async () => ({ ok: true, browser: { executablePath: 'C:/edge.exe', source: 'found' }, reason: undefined }) as never,
    createSession: (_executablePath: string): BrowserExportSession => {
      return {
        renderPage: vi.fn(async ({ payload }: { payload: { docs: Array<{ docName: string }> } }) => {
          const script: Partial<FileScript> = scripts.get(payload.docs[0]!.docName) ?? {}
          if (script.hangingRender) {
            await new Promise<never>((_, reject) => {
              const rejecter = (error: Error) => { hangingRejects.delete(rejecter); reject(error) }
              hangingRejects.add(rejecter)
            })
          }
          if (script.renderError) {
            throw new PdfExportBrowserError(script.renderError.code as 'launch', script.renderError.message)
          }
          return { ready: true, readyState: {} as never, failures: (script.failures ?? []) as never }
        }),
        finalizePrint: vi.fn(async () => Buffer.from('%PDF-1.4 mock-bytes')),
        cancel: vi.fn(() => {
          calls.sessionCancel++
          const error = new Error('CDP connection closed')
          for (const reject of [...hangingRejects]) reject(error)
        }),
        dispose: vi.fn(() => { calls.sessionDispose++ }),
      }
    },
    captureDoc: async (fsPath: string) => {
      const name = fsPath.split('/').pop()!
      calls.capture.push(name)
      const script = scripts.get(name)
      if (script?.captureFail) {
        return { ok: false as const, reason: script.captureFail }
      }
      return { docName: name, capturedVersion: 1, payload: payloadOf(name) }
    },
    writeFile: async (target: string, bytes: Uint8Array) => {
      // basename（去目录、去 "(n)" 编号）映射回源名查 writeFail 脚本
      const base = target.split('/').pop()!
      const name = base.replace(/ \(\d+\)\.pdf$/i, '.pdf').replace(/\.pdf$/i, '.md')
      const script = scripts.get(name)
      if (script?.writeFail) {
        throw new Error('EACCES')
      }
      calls.writeFile.push({ target, bytes: bytes.length })
    },
    locale: () => 'zh-cn',
  }
  const job = new PdfBatchJob(ports)
  return {
    ports, job, calls,
    choose: (choice) => { job.resolveResourceChoice(choice) },
  }
}

const itemsOf = (names: string[]): PdfBatchItem[] =>
  names.map((name, i) => ({ id: `id${i}`, fsPath: `D:/v/${name}`, rootFsPath: 'D:/v', relPath: name }))

/** 组装 plan（默认 rename 策略；同名单文件场景不冲突） */
const planOf = (names: string[], existing: ReadonlySet<string> = new Set(), strategy: PdfBatchConflictStrategy = 'rename') => {
  const items = itemsOf(names)
  const mapping = new Map(planBatchMapping(items, 'D:/out', strategy, existing).map((e) => [e.id, e]))
  return { items, mapping, options: { ...PDF_EXPORT_OPTIONS_DEFAULTS }, browserPath: undefined }
}

describe('批量执行：逐文件两段式循环', () => {
  it('三文件全部成功：每文件一次会话与写入，终态 done', async () => {
    const h = makeHarness([{ name: 'a.md' }, { name: 'b.md' }, { name: 'c.md' }])
    const state = await h.job.run(planOf(['a.md', 'b.md', 'c.md']))
    expect(state.phase).toBe('done')
    expect(state.results.map((r) => r.status)).toEqual(['success', 'success', 'success'])
    expect(h.calls.capture).toEqual(['a.md', 'b.md', 'c.md'])
    expect(h.calls.writeFile).toHaveLength(3)
    expect(h.calls.sessionDispose).toBe(3)
  })

  it('skip 条目不捕获不执行，结果如实登记 skipped', async () => {
    const h = makeHarness([{ name: 'a.md' }, { name: 'b.md' }])
    // skip 策略 + 磁盘已有 a.pdf → a 条目 skip，b 正常导出
    const state = await h.job.run(planOf(['a.md', 'b.md'], new Set(['d:/out/a.pdf']), 'skip'))
    expect(state.phase).toBe('done')
    expect(state.results[0]).toMatchObject({ status: 'skipped', skipReason: 'exists' })
    expect(state.results[1].status).toBe('success')
    expect(h.calls.capture).toEqual(['b.md'])
  })

  it('单项捕获失败继续其余（capture-failed）', async () => {
    const h = makeHarness([{ name: 'a.md' }, { name: 'bad.md', captureFail: 'not-found' }, { name: 'c.md' }])
    const state = await h.job.run(planOf(['a.md', 'bad.md', 'c.md']))
    expect(state.phase).toBe('done')
    expect(state.results[1]).toMatchObject({ status: 'failed', failReason: 'capture-failed' })
    expect(state.results[0].status).toBe('success')
    expect(state.results[2].status).toBe('success')
  })

  it('单项浏览器链路失败继续其余（分态映射）', async () => {
    const h = makeHarness([
      { name: 'a.md' },
      { name: 'dead.md', renderError: { code: 'navigate', message: '导航失败' } },
      { name: 'c.md' },
    ])
    const state = await h.job.run(planOf(['a.md', 'dead.md', 'c.md']))
    expect(state.results[1]).toMatchObject({ status: 'failed', failReason: 'navigate-failed' })
    expect(state.results.map((r) => r.status)).toEqual(['success', 'failed', 'success'])
    expect(h.calls.sessionDispose).toBeGreaterThanOrEqual(3)
  })

  it('单项写入失败继续其余（write-failed）', async () => {
    const h = makeHarness([{ name: 'a.md' }, { name: 'locked.md', writeFail: true }, { name: 'c.md' }])
    const state = await h.job.run(planOf(['a.md', 'locked.md', 'c.md']))
    expect(state.results[1]).toMatchObject({ status: 'failed', failReason: 'write-failed' })
    expect(state.results[2].status).toBe('success')
  })

  it('缺资源暂停等待选择：resume 继续当前文件', async () => {
    const h = makeHarness([
      { name: 'a.md', failures: [{ kind: 'image', item: 'x.png', reason: 'not-found' }] },
      { name: 'b.md' },
    ])
    const runPromise = h.job.run(planOf(['a.md', 'b.md']))
    // 等待 awaiting-resources
    await vi.waitFor(() => { expect(h.job.state.phase).toBe('awaiting-resources') })
    expect(h.job.state.resourceIssues).toHaveLength(1)
    h.choose('resume')
    const state = await runPromise
    expect(state.phase).toBe('done')
    expect(state.results.map((r) => r.status)).toEqual(['success', 'success'])
  })

  it('resume-all：首个选择后，后续文件缺资源自动继续不再暂停', async () => {
    const h = makeHarness([
      { name: 'a.md', failures: [{ kind: 'image', item: 'x.png', reason: 'not-found' }] },
      { name: 'b.md', failures: [{ kind: 'image', item: 'y.png', reason: 'not-found' }] },
    ])
    const runPromise = h.job.run(planOf(['a.md', 'b.md']))
    await vi.waitFor(() => { expect(h.job.state.phase).toBe('awaiting-resources') })
    h.choose('resume-all')
    const state = await runPromise
    expect(state.phase).toBe('done')
    expect(state.results.map((r) => r.status)).toEqual(['success', 'success'])
  })

  it('缺资源时用户取消：当前项 cancelled、剩余不执行、已完成保留（会话优雅释放）', async () => {
    const h = makeHarness([
      { name: 'a.md' },
      { name: 'b.md', failures: [{ kind: 'image', item: 'x.png', reason: 'not-found' }] },
      { name: 'c.md' },
    ])
    const runPromise = h.job.run(planOf(['a.md', 'b.md', 'c.md']))
    await vi.waitFor(() => { expect(h.job.state.phase).toBe('awaiting-resources') })
    h.choose(false)
    const state = await runPromise
    expect(state.phase).toBe('cancelled')
    expect(state.results).toHaveLength(2)
    expect(state.results[0].status).toBe('success')
    expect(state.results[1]).toMatchObject({ status: 'cancelled' })
    // c.md 未开始：capture 不含 c；b 会话释放（awaiting-resources 无在途
    // 命令，优雅 dispose 即配对释放——killSync 语义只在打断在途时需要）
    expect(h.calls.capture).toEqual(['a.md', 'b.md'])
    expect(h.calls.sessionDispose).toBeGreaterThanOrEqual(2)
  })

  it('生成中取消：session.cancel 调用（在途命令随连接断开 reject）、当前项 cancelled、终态 cancelled', async () => {
    const h = makeHarness([{ name: 'a.md' }, { name: 'hang.md', hangingRender: true }, { name: 'c.md' }])
    const runPromise = h.job.run(planOf(['a.md', 'hang.md', 'c.md']))
    // renderPage 挂起：等 capture 推进到 hang.md 后取消（替身 cancel 触发
    // 挂起命令 reject——killSync 后在途命令立即失败的生产语义）
    await vi.waitFor(() => { expect(h.calls.capture).toContain('hang.md') })
    h.job.cancel()
    const state = await runPromise
    expect(state.phase).toBe('cancelled')
    expect(state.results[0].status).toBe('success')
    expect(state.results[1].status).toBe('cancelled')
    expect(state.results).toHaveLength(2)
    expect(h.calls.sessionCancel).toBeGreaterThanOrEqual(1)
    expect(h.calls.capture).not.toContain('c.md')
  })

  it('resolveBrowser 失败：整批 failed、零会话零结果', async () => {
    const h = makeHarness([{ name: 'a.md' }])
    h.ports.resolveBrowser = async () => ({ ok: false, reason: 'no-browser' }) as never
    const state = await h.job.run(planOf(['a.md']))
    expect(state.phase).toBe('failed')
    expect(state.failReason).toBe('no-browser')
    expect(state.results).toHaveLength(0)
    expect(h.calls.capture).toHaveLength(0)
  })

  it('运行中重复 run 返回 busy（防重入）', async () => {
    const h = makeHarness([{ name: 'a.md', hangingRender: false }, { name: 'b.md' }])
    void h.job.run(planOf(['a.md', 'b.md']))
    const again = await h.job.run(planOf(['a.md']))
    expect(again.phase).toBe('running')
  })
})
