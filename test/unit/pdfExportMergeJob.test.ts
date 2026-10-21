// T06（#626）多文档合并导出执行器单元测试：
// - payload 纯装配（清单序 docs + 嵌入跨篇并集去重 + 按篇嵌入面 + pageBreak
//   进 merge 字段，不携带选区片段）；
// - 两段式单会话（逐篇捕获 → renderPage → awaiting-resources 选择 →
//   finalizePrint → 保存对话框 → 原子写盘）；
// - 任一篇捕获失败整次失败（不冒充成功、不落盘）；捕获中取消不落盘；
// - 保存对话框取消（save-dialog 分态）产物丢弃；resume/resume-all 语义。
// 浏览器链路经 BrowserExportSession 端口替身注入（T04 批量单测同模式）。
import { describe, expect, it, vi } from 'vitest'
import { PdfExportBrowserError, type BrowserExportSession } from '../../src/host/pdfExport/pdfExportJob'
import type { PdfBatchCapturedDoc } from '../../src/host/pdfExport/pdfExportBatchJob'
import { buildPdfMergePayload, PdfMergeJob, type PdfMergeJobPorts } from '../../src/host/pdfExport/pdfExportMergeJob'
import { PDF_EXPORT_OPTIONS_DEFAULTS } from '../../src/shared/pdfExportOptions'
import type { PdfBatchItem } from '../../src/shared/pdfExportBatch'

const window = {
  style: { dark: false, vars: {}, reading: {} },
  snippets: [{ name: 's.css', css: 'h1 { color: red }' }],
  breaks: false,
}

const capturedOf = (name: string, embeds: PdfBatchCapturedDoc['payload']['embeds'] = []): PdfBatchCapturedDoc => ({
  docName: name,
  capturedVersion: 2,
  payload: {
    docs: [{ fsPath: `D:/v/${name}`, docName: name, text: `# ${name} 标题\n\n${name} 正文。`, version: 2 }],
    embeds,
    mediaEmbeds: [],
    embedFailures: [],
    style: window.style,
    snippets: [],
    breaks: true,
  },
})

const itemsOf = (names: readonly string[]): PdfBatchItem[] =>
  names.map((name, index) => ({ id: `b${index + 1}`, fsPath: `D:/v/${name}`, rootFsPath: 'D:/v', relPath: name }))

describe('buildPdfMergePayload（合并 payload 纯装配）', () => {
  it('docs 为全部主文档（清单序）+ 嵌入目标跨篇并集；merge.docs 按篇携带嵌入面', () => {
    const shared = { fsPath: 'D:/v/共享.md', docName: '共享.md', text: '共享正文', version: 1 }
    const captured: [PdfBatchCapturedDoc, PdfBatchCapturedDoc] = [
      { ...capturedOf('甲.md'), payload: { ...capturedOf('甲.md').payload, embeds: [{ inner: '共享', ...shared }] } },
      { ...capturedOf('乙.md'), payload: { ...capturedOf('乙.md').payload, embeds: [{ inner: '共享', ...shared }] } },
    ]
    const payload = buildPdfMergePayload(captured, window, true)
    // docs：两篇主文档依清单序在前，嵌入并集在后（同 fsPath+inner 去重为一条）
    expect(payload.docs.map((d) => d.docName)).toEqual(['甲.md', '乙.md', '共享.md'])
    expect(payload.embeds).toHaveLength(1)
    // merge.docs 按篇：每篇自带 embeds/mediaEmbeds/embedFailures（不跨篇混配）
    expect(payload.merge?.docs).toHaveLength(2)
    expect(payload.merge?.docs[0]!.doc.docName).toBe('甲.md')
    expect(payload.merge?.docs[0]!.embeds).toHaveLength(1)
    expect(payload.merge?.docs[1]!.embeds).toHaveLength(1)
    expect(payload.merge?.pageBreak).toBe(true)
    // 窗口级件以 plan.window 为权威（逐篇 captured 内的 style/snippets 不混入）
    expect(payload.snippets).toEqual(window.snippets)
    expect(payload.style).toEqual(window.style)
    expect(payload.breaks).toBe(false)
    // 合并不携带选区片段（T03 片段是主文档维度的叠加）
    expect(payload.fragments).toBeUndefined()
  })

  it('同 inner 不同目标（两篇各解析到自己的嵌入）在并集各留一条', () => {
    const captured: [PdfBatchCapturedDoc, PdfBatchCapturedDoc] = [
      { ...capturedOf('甲.md'), payload: { ...capturedOf('甲.md').payload, embeds: [{ inner: '笔记', fsPath: 'D:/v/a/笔记.md', docName: '笔记.md', text: 'A 的笔记', version: 1 }] } },
      { ...capturedOf('乙.md'), payload: { ...capturedOf('乙.md').payload, embeds: [{ inner: '笔记', fsPath: 'D:/v/b/笔记.md', docName: '笔记.md', text: 'B 的笔记', version: 1 }] } },
    ]
    const payload = buildPdfMergePayload(captured, window, false)
    expect(payload.embeds.map((e) => e.fsPath)).toEqual(['D:/v/a/笔记.md', 'D:/v/b/笔记.md'])
    expect(payload.docs.filter((d) => d.docName === '笔记.md')).toHaveLength(2)
    expect(payload.merge?.pageBreak).toBe(false)
  })
})

interface MergeScript {
  name: string
  /** captureDoc 挂起直至用例 releaseCapture（取消窗口构造） */
  hangingCapture?: boolean
  /** captureDoc 失败原因（缺省成功） */
  captureFail?: string
  /** renderPage 失败清单（缺资源分支） */
  failures?: Array<{ kind: string; item: string; reason: string }>
  /** renderPage 抛错分态 */
  renderError?: { code: 'launch' | 'navigate' | 'not-ready' | 'print'; message: string }
  /** renderPage 挂起直至 cancel */
  hangingRender?: boolean
}

interface Harness {
  ports: PdfMergeJobPorts
  job: PdfMergeJob
  /** 放行挂起的捕获 */
  releaseCapture(name: string): void
  calls: {
    capture: string[]
    sessions: number
    renderedPayloads: Array<{ docNames: string[]; merge?: unknown }>
    finalize: number
    writeFile: Array<{ target: string; bytes: number }>
    sessionDispose: number
    sessionCancel: number
    saveDialogNames: string[]
  }
  choose(choice: 'resume' | 'resume-all' | false): void
  /** saveDialog 短路目标（undefined = 用户取消） */
  nextSaveTarget: string | undefined
}

function makeHarness(files: MergeScript[]): Harness {
  const calls: Harness['calls'] = {
    capture: [], sessions: 0, renderedPayloads: [], finalize: 0,
    writeFile: [], sessionDispose: 0, sessionCancel: 0, saveDialogNames: [],
  }
  const scripts = new Map(files.map((f) => [f.name, f]))
  const hangingRejects = new Set<(error: Error) => void>()
  const captureGates = new Map<string, () => void>()
  let saveTarget: string | undefined = '/tmp/merged-test.pdf'
  const ports: PdfMergeJobPorts = {
    resolveBrowser: async () => ({ ok: true, browser: { executablePath: 'C:/edge.exe', source: 'found' }, reason: undefined }) as never,
    createSession: (_executablePath: string): BrowserExportSession => {
      calls.sessions++
      return {
        renderPage: vi.fn(async ({ payload }: { payload: { docs: Array<{ docName: string }>; merge?: unknown } }) => {
          calls.renderedPayloads.push({ docNames: payload.docs.map((d) => d.docName), merge: payload.merge })
          const script: Partial<MergeScript> = scripts.get(payload.docs[0]!.docName) ?? {}
          if (script.hangingRender) {
            await new Promise<never>((_, reject) => {
              const rejecter = (error: Error) => { hangingRejects.delete(rejecter); reject(error) }
              hangingRejects.add(rejecter)
            })
          }
          if (script.renderError) {
            throw new PdfExportBrowserError(script.renderError.code as 'launch', script.renderError.message)
          }
          return { ready: true, readyState: {} as never, failures: (script.failures ?? []) as never, headings: [] }
        }),
        finalizePrint: vi.fn(async () => {
          calls.finalize++
          return { bytes: Buffer.from('%PDF-1.4 merged-mock'), bookmarks: { written: false, total: 0, skipped: 0, reason: 'disabled' } as never }
        }),
        cancel: vi.fn(() => {
          calls.sessionCancel++
          for (const reject of [...hangingRejects]) reject(new Error('CDP connection closed'))
        }),
        dispose: vi.fn(() => { calls.sessionDispose++ }),
      }
    },
    captureDoc: async (fsPath: string) => {
      const name = fsPath.split('/').pop()!
      calls.capture.push(name)
      const script = scripts.get(name)
      if (script?.hangingCapture) {
        await new Promise<void>((resolve) => { captureGates.set(name, resolve) })
      }
      if (script?.captureFail) {
        return { ok: false as const, reason: script.captureFail }
      }
      return capturedOf(name)
    },
    showSaveDialog: async (defaultFileName: string) => {
      calls.saveDialogNames.push(defaultFileName)
      return saveTarget
    },
    writeFile: async (target: string, bytes: Uint8Array) => {
      calls.writeFile.push({ target, bytes: bytes.length })
    },
    locale: () => 'zh-cn',
  }
  const job = new PdfMergeJob(ports)
  harnessJob = job
  return {
    ports,
    job,
    calls,
    choose: (choice: 'resume' | 'resume-all' | false) => {
      // 直达公开选择入口（awaiting-resources 阶段的用户操作）
      harnessJob.resolveResourceChoice(choice)
    },
    get nextSaveTarget() { return saveTarget },
    set nextSaveTarget(value: string | undefined) { saveTarget = value },
    /** 放行挂起的捕获（取消已发出后再放行——收口走取消分支） */
    releaseCapture: (name: string) => { captureGates.get(name)?.() },
  }
}

// awaiting-resources 选择桥（makeHarness 内部引用 job 实例）
let harnessJob: PdfMergeJob

describe('PdfMergeJob（合并执行器）', () => {
  it('清单序逐篇捕获 → 单会话合并渲染 → finalize → 保存对话框 → 写盘', async () => {
    const h = makeHarness([{ name: '甲.md' }, { name: '乙.md' }, { name: '丙.md' }])
    const state = await h.job.run({
      items: itemsOf(['丙.md', '甲.md', '乙.md']), // 用户调序后的清单序
      options: { ...PDF_EXPORT_OPTIONS_DEFAULTS },
      pageBreak: true,
      window,
      browserPath: undefined,
    })
    expect(state.phase).toBe('done')
    expect(state.savedPath).toBe('/tmp/merged-test.pdf')
    // 捕获顺序 = 清单顺序（非文件名序）
    expect(h.calls.capture).toEqual(['丙.md', '甲.md', '乙.md'])
    // 单会话：渲染一次承载全部主文档（清单序）+ 合并字段
    expect(h.calls.sessions).toBe(1)
    expect(h.calls.renderedPayloads).toHaveLength(1)
    expect(h.calls.renderedPayloads[0]!.docNames.slice(0, 3)).toEqual(['丙.md', '甲.md', '乙.md'])
    expect(h.calls.renderedPayloads[0]!.merge).toEqual(expect.objectContaining({ pageBreak: true }))
    expect(h.calls.finalize).toBe(1)
    // 保存默认名 = 首篇文档名去扩展名（清单序锚点）
    expect(h.calls.saveDialogNames).toEqual(['丙.pdf'])
    expect(h.calls.writeFile).toEqual([{ target: '/tmp/merged-test.pdf', bytes: expect.any(Number) }])
    // 释放配对（成功路径 dispose）
    expect(h.calls.sessionDispose).toBe(1)
  })

  it('任一篇捕获失败：整次失败（capture-failed + 篇名），不建会话不落盘', async () => {
    const h = makeHarness([{ name: '甲.md' }, { name: '乙.md', captureFail: 'not-found' }, { name: '丙.md' }])
    const state = await h.job.run({
      items: itemsOf(['甲.md', '乙.md', '丙.md']),
      options: { ...PDF_EXPORT_OPTIONS_DEFAULTS },
      pageBreak: false,
      window,
      browserPath: undefined,
    })
    expect(state.phase).toBe('failed')
    expect(state.failReason).toBe('capture-failed')
    expect(state.failDetail).toBe('乙.md')
    expect(h.calls.sessions).toBe(0)
    expect(h.calls.writeFile).toEqual([])
  })

  it('缺资源 awaiting-resources：继续后完成；取消不留伪成功产物', async () => {
    const h = makeHarness([{ name: '甲.md', failures: [{ kind: 'image', item: 'gone.png', reason: 'not-found' }] }])
    const running = h.job.run({
      items: itemsOf(['甲.md']),
      options: { ...PDF_EXPORT_OPTIONS_DEFAULTS },
      pageBreak: true,
      window,
      browserPath: undefined,
    })
    await vi.waitFor(() => {
      expect(h.job.state.phase).toBe('awaiting-resources')
    })
    expect(h.job.state.resourceIssues?.[0]).toMatchObject({ kind: 'image', reason: 'not-found' })
    h.choose('resume')
    expect((await running).phase).toBe('done')
    expect(h.calls.writeFile).toHaveLength(1)

    // 取消分支：新任务 awaiting 时取消 → cancelled、不落盘、会话释放
    const h2 = makeHarness([{ name: '甲.md', failures: [{ kind: 'image', item: 'gone.png', reason: 'not-found' }] }])
    const running2 = h2.job.run({
      items: itemsOf(['甲.md']),
      options: { ...PDF_EXPORT_OPTIONS_DEFAULTS },
      pageBreak: false,
      window,
      browserPath: undefined,
    })
    await vi.waitFor(() => {
      expect(h2.job.state.phase).toBe('awaiting-resources')
    })
    h2.choose(false)
    expect((await running2).phase).toBe('cancelled')
    expect(h2.calls.writeFile).toEqual([])
    expect(h2.calls.sessionDispose).toBe(1)
  })

  it('保存对话框取消：产物丢弃（save-dialog 分态），无写盘', async () => {
    const h = makeHarness([{ name: '甲.md' }])
    h.nextSaveTarget = undefined
    const state = await h.job.run({
      items: itemsOf(['甲.md']),
      options: { ...PDF_EXPORT_OPTIONS_DEFAULTS },
      pageBreak: true,
      window,
      browserPath: undefined,
    })
    expect(state.phase).toBe('cancelled')
    expect(state.cancelKind).toBe('save-dialog')
    expect(h.calls.finalize).toBe(1) // 生成已完成（真实产物已产出），但用户未选位置
    expect(h.calls.writeFile).toEqual([])
  })

  it('渲染链路失败：failed 分态 + 会话释放，不进入保存', async () => {
    const h = makeHarness([{ name: '甲.md', renderError: { code: 'print', message: 'boom' } }])
    const state = await h.job.run({
      items: itemsOf(['甲.md']),
      options: { ...PDF_EXPORT_OPTIONS_DEFAULTS },
      pageBreak: false,
      window,
      browserPath: undefined,
    })
    expect(state.phase).toBe('failed')
    expect(state.failReason).toBe('print-failed')
    expect(h.calls.sessionDispose).toBe(1)
    expect(h.calls.writeFile).toEqual([])
  })

  it('捕获阶段取消：停在已完成篇数，cancelled、零会话零落盘', async () => {
    const h = makeHarness([{ name: '甲.md' }, { name: '乙.md', hangingCapture: true }])
    const running = h.job.run({
      items: itemsOf(['甲.md', '乙.md']),
      options: { ...PDF_EXPORT_OPTIONS_DEFAULTS },
      pageBreak: true,
      window,
      browserPath: undefined,
    })
    await vi.waitFor(() => {
      expect(h.calls.capture.length).toBeGreaterThanOrEqual(2) // 乙的捕获已发起并挂起
    })
    h.job.cancel()
    h.releaseCapture('乙.md')
    const state = await running
    expect(state.phase).toBe('cancelled')
    expect(h.calls.sessions).toBe(0)
    expect(h.calls.writeFile).toEqual([])
  })

  it('空清单防御：直接 failed（internal），不捕获不建会话', async () => {
    const h = makeHarness([])
    const state = await h.job.run({
      items: [],
      options: { ...PDF_EXPORT_OPTIONS_DEFAULTS },
      pageBreak: false,
      window,
      browserPath: undefined,
    })
    expect(state.phase).toBe('failed')
    expect(state.failReason).toBe('internal')
    expect(h.calls.capture).toEqual([])
  })

  it('resume-all：一次选择后同类缺资源不再暂停（单产物语义沿 T02/T04）', async () => {
    const h = makeHarness([{ name: '甲.md', failures: [{ kind: 'image', item: 'a.png', reason: 'not-found' }] }])
    const running = h.job.run({
      items: itemsOf(['甲.md']),
      options: { ...PDF_EXPORT_OPTIONS_DEFAULTS },
      pageBreak: true,
      window,
      browserPath: undefined,
    })
    await vi.waitFor(() => {
      expect(h.job.state.phase).toBe('awaiting-resources')
    })
    h.choose('resume-all')
    expect((await running).phase).toBe('done')
  })
})
