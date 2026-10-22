// PDF 导出模态预览竞态（PR #633 复审 R7 #007/#008）宿主级回归：
// 驱动真实 createPdfExportModal 控制流，只把浏览器会话与面板换成替身。
//  - #007：预览轮次在捕获 + 渲染两个 await 之后都必须按**发起时锁定**的
//    目标核对；渲染期间改选后迟到字节不得以新选择的身份发布，最新选择
//    仍要补发一轮；
//  - #008：单文档选区 → 升格批量（全文预览）→ 缩回选区，全文产物不得被
//    重标成选区指纹（否则导出的 PDF 越过选区边界）。
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { writeFileMock, showSaveDialogMock, showInformationMessageMock } = vi.hoisted(() => ({
  writeFileMock: vi.fn(async () => undefined),
  showSaveDialogMock: vi.fn(),
  showInformationMessageMock: vi.fn(async () => undefined),
}))

vi.mock('vscode', () => {
  const uri = (p: string) => ({
    scheme: 'file',
    path: p.replace(/\\/g, '/'),
    fsPath: p,
    toString: () => `file:///${p.replace(/\\/g, '/')}`,
    with: (next: { path: string }) => uri(next.path),
  })
  return {
    Uri: {
      file: uri,
      parse: (s: string) => uri(decodeURIComponent(s.replace(/^file:\/*/, ''))),
      joinPath: (base: { path: string }, seg: string) => uri(`${base.path.replace(/\/$/, '')}/${seg}`),
    },
    ViewColumn: { Active: -1 },
    ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
    FileType: { File: 1, Directory: 2 },
    FileSystemError: class FileSystemError extends Error {
      code: string
      constructor(message: string, code = 'FileExists') {
        super(message)
        this.code = code
      }
    },
    env: { remoteName: undefined },
    commands: { executeCommand: vi.fn(async () => undefined) },
    workspace: {
      workspaceFolders: [],
      fs: {
        writeFile: writeFileMock,
        createDirectory: vi.fn(async () => undefined),
        delete: vi.fn(async () => undefined),
        rename: vi.fn(async () => undefined),
        stat: vi.fn(async () => ({ type: 1 })),
        readDirectory: vi.fn(async () => []),
        readFile: vi.fn(async () => new Uint8Array()),
      },
      getConfiguration: () => ({ get: () => undefined }),
    },
    window: {
      showSaveDialog: showSaveDialogMock,
      showOpenDialog: vi.fn(),
      showInformationMessage: showInformationMessageMock,
      showWarningMessage: vi.fn(async () => undefined),
      showErrorMessage: vi.fn(async () => undefined),
      activeColorTheme: { kind: 2 },
      createWebviewPanel: vi.fn(),
    },
  }
})

const { resolveExportBrowserMock, createSessionMock, sessionState } = vi.hoisted(() => {
  const state = {
    /** 每次 renderPage 收到的 payload（按调用序）：text 用于区分是哪一篇 */
    renders: [] as Array<{ fragments?: unknown; text?: string }>,
    /** renderPage 屏障：resolve 前挂起 */
    gates: [] as Array<() => void>,
    /** 是否自动放行（缺省 true；false 时需手动 resolve） */
    autoRelease: true,
    /** 每次 finalizePrint 产出的字节（按调用序）——与 renders 同序配对 */
    printed: [] as string[],
    /** 当前在渲染的序号（finalizePrint 取它作为产物标记） */
    current: -1,
  }
  return {
    sessionState: state,
    resolveExportBrowserMock: vi.fn(async () => ({
      ok: true as const,
      browser: { kind: 'chrome' as const, executablePath: '/fake/chrome' },
    })),
    createSessionMock: vi.fn(() => {
      let index = -1
      return {
        async renderPage(input: { payload: { docs: Array<{ text: string }>; fragments?: unknown } }) {
          index = state.renders.length
          state.current = index
          state.renders.push({ text: input.payload.docs[0]?.text, fragments: input.payload.fragments })
          if (!state.autoRelease) {
            await new Promise<void>((resolve) => state.gates.push(resolve))
          }
          return { ready: true, readyState: 'complete', failures: [], headings: [] }
        },
        async finalizePrint() {
          // 产物字节携带该轮正文，便于断言「发布的字节属于哪一篇」
          const text = state.renders[index]?.text ?? 'unknown'
          state.printed.push(text)
          return {
            bytes: Buffer.from(`%PDF-1.4 ${text}`),
            bookmarks: { written: false, total: 0, skipped: 0, reason: 'disabled' },
          }
        },
        cancel() {},
        dispose() {},
      }
    }),
  }
})

vi.mock('../../src/host/pdfExport/browserFind', async () => {
  const actual = await vi.importActual<typeof import('../../src/host/pdfExport/browserFind')>(
    '../../src/host/pdfExport/browserFind',
  )
  return { ...actual, resolveExportBrowser: resolveExportBrowserMock }
})

vi.mock('../../src/host/pdfExport/pdfExportSession', () => ({
  createBrowserExportSession: createSessionMock,
}))

import { createPdfExportModal, type PdfExportDocumentSource } from '../../src/host/pdfExport/pdfExportModal'

const BARRIER_MS = 50

/** 可观测的面板替身（记录宿主 → webview 的消息，供代次/目标断言） */
function makePanel(): {
  panel: {
    webview: {
      html: string
      cspSource: string
      asWebviewUri: (u: { toString(): string }) => { toString(): string }
      onDidReceiveMessage: (cb: (m: unknown) => void) => { dispose(): void }
      postMessage: (m: unknown) => Promise<boolean>
    }
    onDidDispose: (cb: () => void) => { dispose(): void }
    reveal: () => void
    dispose: () => void
  }
  posts: Array<Record<string, unknown>>
} {
  const posts: Array<Record<string, unknown>> = []
  return {
    posts,
    panel: {
      webview: {
        html: '',
        cspSource: 'vscode-resource:',
        asWebviewUri: (u) => u,
        onDidReceiveMessage: () => ({ dispose() {} }),
        postMessage: async (m: unknown) => {
          posts.push(m as Record<string, unknown>)
          return true
        },
      },
      onDidDispose: () => ({ dispose() {} }),
      reveal: () => undefined,
      dispose: () => undefined,
    },
  }
}

const SETTINGS: Record<string, unknown> = {}

function makeSource(fsPath: string, text: string): PdfExportDocumentSource {
  return {
    uri: { scheme: 'file', fsPath, path: fsPath } as never,
    document: {
      getText: () => text,
      version: 1,
      uri: { scheme: 'file', fsPath, path: fsPath },
    } as never,
    session: { whenEditsSettled: async () => undefined } as never,
    readEmbedTarget: async () => ({ ok: false, reason: 'not-found' }) as never,
    requestStyleSnapshot: async () => null,
    snippetEntries: async () => [],
    readingBreaks: () => false,
  }
}

const flush = async (ms = BARRIER_MS): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function lastState(posts: Array<Record<string, unknown>>): {
  preview: { phase: string; generation: number; fingerprint?: string; batchItemId?: string }
  previewTarget?: { kind: string; fsPath?: string; doc?: { fragments?: unknown } }
  batch?: { items: Array<{ id: string }> }
  list?: { items: Array<{ id: string }>; selectedId?: string }
} {
  for (let i = posts.length - 1; i >= 0; i--) {
    if (posts[i]!['kind'] === 'pdfExportModal.state') {
      return posts[i] as never
    }
  }
  throw new Error('没有收到 state 消息')
}

beforeEach(() => {
  // 注入路径分支（message.paths / message.path）只在测试钩子下生效
  process.env.VSIDIAN_TEST_HOOKS = '1'
  writeFileMock.mockClear()
  showSaveDialogMock.mockReset()
  showInformationMessageMock.mockClear()
  sessionState.renders.length = 0
  sessionState.gates.length = 0
  sessionState.printed.length = 0
  sessionState.current = -1
  sessionState.autoRelease = true
  resolveExportBrowserMock.mockClear()
  createSessionMock.mockClear()
})

describe('PDF 导出模态预览竞态（#007 渲染期改选）', () => {
  it('渲染在途改选后，迟到字节不以新选择发布，且最新选择补发一轮', async () => {
    const { panel, posts } = makePanel()
    const vscode = await import('vscode')
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel as never)
    const handle = createPdfExportModal(
      { extensionUri: { fsPath: '/ext', path: '/ext' } } as never,
      () => SETTINGS as never,
      () => undefined,
      {
        outWebviewDir: '/ext/out',
        resolveResource: async () => ({ ok: false, reason: 'not-found' }),
        capturePdfBatchDoc: async (fsPath: string) => ({
          ok: true as const,
          docName: fsPath.split('/').pop() ?? fsPath,
          capturedVersion: 1,
          payload: {
            docs: [{
              fsPath,
              docName: fsPath.split('/').pop() ?? fsPath,
              text: fsPath.endsWith('a.md') ? 'FIRST-DOC' : 'SECOND-DOC',
              version: 1,
            }],
            embeds: [],
            mediaEmbeds: [],
            embedFailures: [],
          },
        }),
        captureBatchWindowInput: async () => ({ style: null, snippets: [], breaks: false }),
      },
    )
    handle.openBatch()
    handle.injectMessage({
      kind: 'pdfExportModal.batch.addFiles',
      paths: ['/ws/a.md', '/ws/b.md'],
    })
    await flush()
    const items = lastState(posts).batch!.items
    expect(items.length).toBe(2)

    // 两篇正文不同：产出的 PDF 字节带各自正文，可直接判定「发布的是哪一篇」
    sessionState.autoRelease = false
    // 第一轮：选第二条（b.md）→ 卡在渲染
    handle.injectMessage({ kind: 'pdfExportModal.preview.select', itemId: items[1]!.id, params: {} })
    await flush()
    expect(sessionState.renders.length, '第一轮应已进入渲染').toBe(1)
    expect(sessionState.renders[0]!.text).toContain('SECOND')
    // 渲染未放行时改选第一条（a.md）：本轮产物属于 b，不得以 a 的身份发布
    handle.injectMessage({ kind: 'pdfExportModal.preview.select', itemId: items[0]!.id, params: {} })
    await flush()
    // 放行第一轮；随后补发轮（a.md）自动放行
    sessionState.autoRelease = true
    for (const release of sessionState.gates.splice(0)) release()
    await flush(600)

    const state = lastState(posts)
    const target = state.previewTarget as { fsPath?: string } | undefined
    expect(target?.fsPath, '预览目标应为最后点击的条目').toBe('/ws/a.md')
    expect(state.preview.phase).toBe('ready')
    // 补发轮发生：a.md 被真正渲染过（旧实现直接幂等返回、不读 a）
    expect(sessionState.renders.length, '最后选择应补发一轮生成').toBe(2)
    expect(sessionState.renders[1]!.text).toContain('FIRST')

    // 回放宿主 → webview 的消息流，按视图的接受规则（代次与当前 state 配对）
    // 算出最终真正会被显示的那份字节。旧实现会把 b 的迟到字节以 a 的代次
    // 下发——终态虽被补发轮纠正，但期间用户看到的仍是 b（复审 007 的症状）。
    const displayed = replayDisplayedArtifacts(posts)
    expect(displayed.text, '最终显示的画面应属于最后点击的条目').toContain('FIRST')
    // 关键：不存在「目标是 a、下发字节却是 b」的中间态
    expect(displayed.mismatched, '不得把旧条目的字节以新目标的身份下发').toBe(false)
  }, 30000)
})

/** 按 PdfExportModalView 的接受规则回放消息：只用「与最近一次 state 代次
 *  相符」的 artifact。返回最终显示的字节归属与该过程中是否出现错配。 */
function replayDisplayedArtifacts(posts: Array<Record<string, unknown>>): { text: string; mismatched: boolean } {
  let currentGen = -1
  let currentTargetFs: string | undefined
  let displayed = ''
  let mismatched = false
  for (const message of posts) {
    if (message['kind'] === 'pdfExportModal.state') {
      const preview = message['preview'] as { generation?: number } | undefined
      currentGen = typeof preview?.generation === 'number' ? preview.generation : -1
      const target = message['previewTarget'] as { fsPath?: string } | undefined
      currentTargetFs = target?.fsPath
      continue
    }
    if (message['kind'] !== 'pdfExportModal.previewArtifact') continue
    if (message['generation'] !== currentGen) continue // 视图丢弃迟到代次
    const base64 = message['base64'] as string
    const bytes = Buffer.from(base64, 'base64').toString('utf8')
    displayed = bytes
    // 该代次的目标是 a，但字节正文是 SECOND → 旧条目字节挂到了新目标下
    if (currentTargetFs === '/ws/a.md' && bytes.includes('SECOND')) mismatched = true
  }
  return { text: displayed, mismatched }
}

describe('PDF 导出模态预览竞态（#008 选区往返）', () => {
  it('选区 → 升格批量 → 缩回选区：不得复用全文产物', async () => {
    const { panel, posts } = makePanel()
    const vscode = await import('vscode')
    vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(panel as never)
    const handle = createPdfExportModal(
      { extensionUri: { fsPath: '/ext', path: '/ext' } } as never,
      () => SETTINGS as never,
      () => undefined,
      {
        outWebviewDir: '/ext/out',
        resolveResource: async () => ({ ok: false, reason: 'not-found' }),
        capturePdfBatchDoc: async (fsPath: string) => ({
          ok: true as const,
          docName: fsPath.split('/').pop() ?? fsPath,
          capturedVersion: 1,
          payload: {
            docs: [{ fsPath, docName: fsPath.split('/').pop() ?? fsPath, text: 'BODY', version: 1 }],
            embeds: [],
            mediaEmbeds: [],
            embedFailures: [],
          },
        }),
        captureBatchWindowInput: async () => ({ style: null, snippets: [], breaks: false }),
      },
    )
    // 选区 0..5（"FIRST"）
    handle.open(makeSource('/ws/a.md', 'FIRSTOUTSIDE'), [{ from: 0, to: 5 }])
    await flush(400)
    const opened = lastState(posts)
    expect(opened.previewTarget?.doc?.fragments, '选区导出首轮应带片段').toBeDefined()

    handle.injectMessage({ kind: 'pdfExportModal.batch.addFiles', paths: ['/ws/b.md'] })
    await flush(400)
    // 升格后点首条（当前文档）出全文预览
    const batchState = lastState(posts)
    const docItemId = batchState.batch!.items[0]!.id
    handle.injectMessage({ kind: 'pdfExportModal.preview.select', itemId: docItemId, params: {} })
    await flush(600)
    const fullPreview = lastState(posts)
    expect(fullPreview.previewTarget?.doc?.fragments, '升格后应出全文预览').toBeUndefined()

    // 删除 B → 缩回选区语义
    handle.injectMessage({ kind: 'pdfExportModal.batch.remove', id: batchState.batch!.items[1]!.id })
    await flush(600)
    const demoted = lastState(posts)
    expect(demoted.batch, '删到只剩当前文档应缩回单文档').toBeUndefined()
    expect(demoted.list?.items.length).toBe(1)
    // 关键：目标已带片段，则不得沿用全文产物（指纹必须失配 → 重新生成）
    const fragments = demoted.previewTarget?.doc?.fragments as unknown
    expect(fragments, '缩回后目标应恢复选区片段').toBeDefined()
    const lastRender = sessionState.renders[sessionState.renders.length - 1]!
    expect(lastRender.fragments, '新一轮渲染必须是选区片段而不是全文').toBeDefined()
  }, 30000)
})
