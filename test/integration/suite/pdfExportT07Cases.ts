// T07（#627）同模态 PDF 预览集成用例：
// 1. core：预览装载面（模态 CSP 三增量 + pdfjs 资产注入）与工具栏绘制层
//    （刷新按钮可见可用、空态说明、无过期徽章——offsetParent 命中而非
//    DOM 存在性，无浏览器依赖）；
// 2. sensitive（真实浏览器链路，沿 T01–T06 敏感组先例）：
//    - 单文档：预览真实 PDF 页面（pdfjs canvas 非白像素 + 页数）→ 参数
//      修改过期可见（不自动生成）→ 手动刷新新配置生效（横向几何）→ 导出
//      复用同源字节（文件哈希 = 预览哈希、页数一致）→ 参数失配不复制用；
//    - 批量：按清单选择预览项、目标切换过期、长文档有界挂载（挂载页数
//      与画布费用不随总页数增长）；
//    - 合并：合并预览书签观测、导出复用同源、关闭模态在途作废与重开
//      无上一会话预览（迟到回包不复活）。
import * as vscode from 'vscode'
import * as assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const VIEW_TYPE = 'onegayi.vsidian.editor'
const CURRENT_COMMAND = 'onegayi.vsidian.pdfExport.currentDocument'
const BATCH_COMMAND = 'onegayi.vsidian.pdfExport.batch'
const MERGE_COMMAND = 'onegayi.vsidian.pdfExport.merge'
const wsDir = process.env['WORKSPACE_DIR'] ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''
if (!wsDir) {
  throw new Error('工作区根不可得：WORKSPACE_DIR 未设置且无工作区文件夹')
}
const wsUri = (name: string): vscode.Uri => vscode.Uri.file(`${wsDir}/${name}`)
const norm = (p: string): string => p.replaceAll('\\', '/')

interface T07ModalInfo {
  open: boolean
  lastPaint: unknown
  modalCsp: string
  modalPreviewAssetsReady: boolean
  preview: {
    phase: 'idle' | 'generating' | 'ready' | 'failed'
    generation: number
    fingerprint?: string
    byteLength: number
    bytesSha256: string
    bookmarks?: { written: boolean; total: number; skipped: number; reason?: string }
    failReason?: string
    target?: { kind: string; fsPath?: string; doc?: { docName: string } }
    batchItemId?: string
    busy: boolean
    lastExportReused: boolean
    runs: number
    cancels: number
  }
  batch?:
    | { mode: 'batch'; phase: string; items: Array<{ id: string; fsPath: string; relPath: string }> }
    | { mode: 'merge'; phase: string; items: Array<{ id: string; fsPath: string; relPath: string }> }
    | undefined
  /** 验收统一页：单文档模式清单观测面（一行当前文档） */
  list?: {
    mode: 'document'
    items: Array<{ id: string; fsPath: string; rootFsPath: string; relPath: string }>
    selectedId?: string
  }
  savedPath?: string
  hookedSaveTarget?: string
}

interface T07PreviewPdfProbe {
  phase: string
  page: number
  totalPages: number
  mountedPages: number
  canvasBytes: number
  nonWhiteRatio: number
  canvasWidth: number
  canvasHeight: number
}

async function poll<T>(label: string, fn: () => T | undefined | Promise<T | undefined>, timeoutMs = 30000): Promise<T> {
  const start = Date.now()
  for (;;) {
    const value = await fn()
    if (value !== undefined) {
      return value
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`等待超时：${label}`)
    }
    await new Promise((r) => setTimeout(r, 150))
  }
}

async function modalState(): Promise<T07ModalInfo> {
  return vscode.commands.executeCommand('onegayi.vsidian._test.getPdfExportModalState') as Promise<T07ModalInfo>
}

async function inject(message: unknown): Promise<void> {
  await vscode.commands.executeCommand('onegayi.vsidian._test.injectPdfExportModalMessage', message)
}

async function postToWebview(message: unknown): Promise<void> {
  await vscode.commands.executeCommand('onegayi.vsidian._test.postPdfExportModalWebviewMessage', message)
}

async function openDocAndWait(name: string): Promise<void> {
  await vscode.commands.executeCommand('vscode.openWith', wsUri(name), VIEW_TYPE)
  await poll(`会话就绪 ${name}`, async () => {
    const info = (await vscode.commands.executeCommand('onegayi.vsidian._test.getSessionState', wsUri(name).toString())) as
      | { found: boolean; panels: Array<{ ready: boolean }> }
      | undefined
    return info?.found && info.panels.some((p) => p.ready) ? true : undefined
  })
}

const paintOf = (info: T07ModalInfo): Record<string, unknown> => (info.lastPaint ?? {}) as Record<string, unknown>

const visible = (probe: unknown): boolean => {
  if (probe === null || probe === undefined) return false
  const p = probe as { visible?: boolean; display?: string }
  return p.visible === true && p.display !== 'none'
}

// 注入参数与 webview 控件缺省值同口径（marginMm 20 = PDF_EXPORT_OPTIONS_DEFAULTS；
// 注入值若与控件实际值不一致，webview 侧指纹立即失配误报过期）
const PARAMS_BASE = { paper: 'a4', orientation: 'portrait', marginMm: 20, scale: 1 }

async function closeAll(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors').then(() => undefined, () => undefined)
  await new Promise((r) => setTimeout(r, 250))
}

/** 等待预览就绪且 webview 绘制层出现真实 PDF 页面（非白像素证据） */
async function waitPreviewPainted(extraTimeoutMs = 180000): Promise<{ info: T07ModalInfo; pdf: T07PreviewPdfProbe }> {
  let last: { preview: T07ModalInfo['preview']; paint: Record<string, unknown> } | undefined
  try {
    return await poll('预览就绪且绘制', async () => {
      const info = await modalState()
      last = { preview: info.preview, paint: paintOf(info) }
      if (info.preview.phase !== 'ready') return undefined
      const pdf = last.paint['previewPdf'] as T07PreviewPdfProbe | null
      if (pdf === null || pdf.phase !== 'content' || pdf.totalPages < 1 || pdf.nonWhiteRatio <= 0) return undefined
      return { info, pdf }
    }, extraTimeoutMs)
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}；末态 ${JSON.stringify(last)}`)
  }
}

/** 等待单文档模态固定输入就位（open 后捕获在途——docName 就位即就绪） */
async function waitFixedInputReady(): Promise<void> {
  await poll('固定输入就位', async () => {
    const info = await modalState()
    return info.preview.target !== undefined ? true : undefined
  })
}

/** 等待预览在途轮收尾（验收统一页：open 即自动发起预览——后续注入的
 *  刷新/选择不得落在在途轮上，否则按协议被忽略或排队） */
async function waitPreviewSettled(timeoutMs = 180000): Promise<void> {
  await poll('预览在途轮收尾', async () => {
    const info = await modalState()
    return info.preview.busy === false ? true : undefined
  }, timeoutMs)
}

export const pdfExportT07Cases: Array<[string, () => Promise<void>]> = [
  ['PDF 导出（#627 T07）：统一导出页清单与进入自动预览（core 绘制层）', async () => {
    await closeAll()
    await openDocAndWait('pdf-export.md')
    await vscode.commands.executeCommand(CURRENT_COMMAND)
    await poll('模态打开', async () => {
      const info = await modalState()
      return info.open ? true : undefined
    })

    // 装载面：pdfjs 资产注入 + CSP 三增量（#334 探针口径——worker-src
    // blob: 是 Blob worker 的必要条件，缺省即 SecurityError）
    const info = await modalState()
    assert.ok(info.modalPreviewAssetsReady, '模态 HTML 应注入 __vsidianPdfAssets 装配资源')
    assert.ok(info.modalCsp.includes('worker-src blob:'), 'CSP 应放行 blob worker（#334 探针实证必要条件）')
    assert.ok(info.modalCsp.includes('connect-src ') && info.modalCsp.includes(' blob:'), 'CSP 应放行 Blob 源 fetch（预览字节装载）')
    assert.ok(info.modalCsp.includes("'wasm-unsafe-eval'"), 'CSP 应放行 wasm 编译（pdfjs 资产）')

    // 验收统一页：清单在侧栏、只有当前文档一行且处于选中态；工具栏不再有
    // 「预览文件」下拉。绘制层断言（offsetParent + 几何 + 计算样式）
    const paint = await poll('统一清单就位（单文档一行）', async () => {
      const p = paintOf(await modalState())
      return p['exportListVisible'] === true && p['selectedItemRel'] === 'pdf-export.md' ? p : undefined
    })
    assert.equal(paint['exportListInSide'], true, '导出清单应位于右侧栏')
    assert.equal(paint['previewBatchSelect'], null, '预览工具栏不应再有文件下拉选择器')
    assert.match(String(paint['selectedItemOutlines'] ?? ''), /^solid /, '选中条目应有可见描边（强调色）')

    // 进入即自动发起预览（无需点击刷新）：发起计数在请求时同步 +1——
    // core 组只钉「已请求」与清单绘制层，不等待真实出图（sensitive 组覆盖）
    const auto = await poll('进入自动发起预览', async () => {
      const current = await modalState()
      return current.preview.runs >= 1 ? current : undefined
    }, 60000)
    assert.ok(auto.preview.runs >= 1, '进入单文档导出应自动发起预览')
    // 预览列宽按 A4 纵向纸面宽派生
    assert.equal(String(paint['previewPrintWidth'] ?? ''), '794px', '预览列宽应等于 A4 纵向纸面宽（794px）')

    // ---- 统一页：单个 ↔ 多个同一页面（添加升格、删回缩回） ----
    // 单文档清单只有当前文档一行，宿主观测面同源
    const singleList = await poll('单文档清单观测面', async () => {
      const current = await modalState()
      return current.list?.items.length === 1 ? current.list : undefined
    })
    assert.equal(singleList.mode, 'document', '单文档模式清单形态为 document')
    assert.equal(singleList.selectedId, 'document', '当前文档条目应处于选中态')
    assert.equal(singleList.items[0]!.relPath, 'pdf-export.md', '清单一行为当前文档')

    // 添加文件 → 升格为批量清单（当前文档成为首条，仍被选中/已加载）
    await inject({ kind: 'pdfExportModal.batch.addFiles', paths: [norm(path.join(wsDir, 'pdf-export-t05.md'))] })
    const promoted = await poll('添加后升格为清单', async () => {
      const current = await modalState()
      return current.batch?.mode === 'batch' && current.batch.items.length === 2 ? current : undefined
    })
    const promotedPaint = await poll('升格后绘制层清单两行', async () => {
      const p = paintOf(await modalState())
      const rels = p['batchItemRels'] as string[] | undefined
      return rels !== undefined && rels.length === 2 ? p : undefined
    })
    assert.equal(promotedPaint['exportListInSide'], true, '升格后清单仍在右侧栏（同一页面形态）')
    assert.equal(promotedPaint['selectedItemRel'], 'pdf-export.md', '升格后当前文档仍为选中条目')

    // 删除新增条目 → 缩回单文档模式（单个与多个无本质区别）
    const added = promoted.batch!.items.find((item) => item.relPath === 'pdf-export-t05.md')!
    await inject({ kind: 'pdfExportModal.batch.remove', id: added.id })
    const demoted = await poll('删回后缩为单文档', async () => {
      const current = await modalState()
      return current.batch === undefined && current.list?.items.length === 1 ? current : undefined
    })
    assert.equal(demoted.list!.items[0]!.relPath, 'pdf-export.md', '缩回后清单仍为当前文档一行')

    await closeAll()
  }],

  ['PDF 导出（#627 T07）：单文档预览、过期刷新与导出同源（真浏览器）', async () => {
    await closeAll()
    const { resolveExportBrowser } = await import('../../../src/host/pdfExport/browserFind')
    const browser = await resolveExportBrowser(undefined)
    if (!browser.ok) {
      console.log('[集成测试][SKIP] 无可用 Chrome/Edge，T07 单文档预览链路本环境未验证（#627）')
      return
    }

    await openDocAndWait('pdf-export-t05.md')
    await vscode.commands.executeCommand(CURRENT_COMMAND)
    await poll('模态打开', async () => {
      return (await modalState()).open ? true : undefined
    })
    await waitFixedInputReady()
    // 统一页：open 已完成一轮自动预览——等它收尾再看「手动刷新」增量
    await waitPreviewSettled()

    // ---- 刷新 → 真实 PDF 页面（canvas 非白像素 + 书签观测）----
    // 书签经真实控件路径开启（注入参数须与控件实际值同口径——指纹不失配）
    await postToWebview({ kind: 'pdfExportModal._test.setParam', field: 'bookmarksEnabled', value: true })
    await poll('书签开关开启', async () => {
      return paintOf(await modalState())['bookmarksChecked'] === true ? true : undefined
    })
    const runsBefore = (await modalState()).preview.runs
    const BOOKMARKS_ON = { ...PARAMS_BASE, bookmarksEnabled: true } as const
    const LANDSCAPE_ON = { ...PARAMS_BASE, orientation: 'landscape', bookmarksEnabled: true } as const
    await inject({ kind: 'pdfExportModal.preview.refresh', params: BOOKMARKS_ON })
    const first = await waitPreviewPainted()
    assert.ok(first.pdf.nonWhiteRatio > 0.001, `预览画布应有真实绘制（非白比 ${first.pdf.nonWhiteRatio}）`)
    assert.ok(first.info.preview.bookmarks?.written === true, '书签开启时预览产物应写入书签（报告观测）')
    assert.ok(String(paintOf(first.info)['previewNoticeText'] ?? '').length > 0, '书签计数提示应在工具栏在场')
    assert.equal(paintOf(first.info)['previewStale'], false, '就绪预览与当前参数一致——无过期徽章')
    assert.equal(paintOf(first.info)['previewBlobUrlsAlive'], 1, '预览 Blob URL 存活计数应为 1（无泄漏）')
    // 验收修复：页面宽不超过 A4 纵向纸面宽（794 CSS px，宽面板不再拉伸；
    // 面板比纸面窄时随面板缩小），缩放条左下角可见且回显百分比
    const firstPaint = paintOf(first.info)
    const portraitWidth = Number(firstPaint['previewFirstCanvasCssWidth'] ?? 0)
    assert.ok(portraitWidth > 0 && portraitWidth <= 794.5, `预览页面宽应不超过 A4 纸面宽（实际 ${portraitWidth}px）`)
    assert.ok(visible(firstPaint['previewZoomBar']), '预览就绪后缩放条应可见')
    assert.match(String(firstPaint['previewZoomValueText'] ?? ''), /^\d+%$/, '缩放条应回显百分比')
    assert.ok((firstPaint['previewZoomButtons'] as unknown[]).every(visible), '缩放按钮应可见可用')

    // ---- 参数修改 → 过期可见；不自动生成（runs 不变、phase 仍 ready） ----
    await postToWebview({ kind: 'pdfExportModal._test.setParam', field: 'orientation', value: 'landscape' })
    await poll('参数修改后过期徽章可见', async () => {
      const p = paintOf(await modalState())
      return p['previewStale'] === true ? p : undefined
    })
    const staleInfo = await modalState()
    assert.equal(staleInfo.preview.phase, 'ready', '过期后不自动生成（预览仍在场）')
    assert.equal(staleInfo.preview.runs, runsBefore + 1, '参数输入不得反复启动生成任务')

    // ---- 手动刷新 → 新配置生效（横向几何证据：画布宽 > 高） ----
    await inject({ kind: 'pdfExportModal.preview.refresh', params: LANDSCAPE_ON })
    const second = await waitPreviewPainted()
    assert.ok(second.pdf.canvasWidth > second.pdf.canvasHeight,
      `横向预览画布应宽大于高（实际 ${second.pdf.canvasWidth}×${second.pdf.canvasHeight}）`)
    // 横向纸面宽 11.69in × 96 ≈ 1122 CSS px——页面宽同样不超过纸面宽
    const landscapeWidth = Number(paintOf(second.info)['previewFirstCanvasCssWidth'] ?? 0)
    assert.ok(landscapeWidth > 0 && landscapeWidth <= 1122.5, `横向预览页面宽应不超过纸面宽（实际 ${landscapeWidth}px）`)
    assert.equal(paintOf(second.info)['previewStale'], false, '刷新完成后过期徽章消失（新配置生效）')
    assert.equal(paintOf(second.info)['previewBlobUrlsAlive'], 1, '连续刷新后旧 Blob URL 应回收（存活恒 1）')
    assert.equal(second.info.preview.runs, runsBefore + 2, '两轮刷新各只发起一次生成')

    // ---- 导出复用：不改参数 → 文件哈希 = 预览哈希、页数一致（同源同代次） ----
    const previewSha = second.info.preview.bytesSha256
    await inject({ kind: 'pdfExportModal.run', params: LANDSCAPE_ON })
    const done1 = await poll('导出完成（复用路径）', async () => {
      const info = await modalState()
      // savedPath 仅在 done 阶段就位（hookedSaveTarget 在写盘前已设置——
      // 以其为判据会在写盘前竞态命中）
      return info.savedPath !== undefined && info.preview.lastExportReused === true ? info : undefined
    }, 180000)
    assert.equal(done1.preview.lastExportReused, true, '指纹一致时导出应复用预览字节')
    const file1 = Buffer.from(await readFile(done1.hookedSaveTarget ?? done1.savedPath!))
    assert.equal(createHash('sha256').update(file1).digest('hex'), previewSha, '导出文件与预览产物字节同源')
    // pdfjs-dist 6.x 宿主面缺口 polyfill（1.82.3 = Node 18 无 withResolvers）
    if (typeof (Promise as unknown as { withResolvers?: unknown }).withResolvers !== 'function') {
      ;(Promise as unknown as { withResolvers: () => unknown }).withResolvers = function withResolvers() {
        let resolve!: (value: unknown) => void
        let reject!: (reason?: unknown) => void
        const promise = new Promise((res, rej) => { resolve = res; reject = rej })
        return { promise, resolve, reject }
      }
    }
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const { pathToFileURL } = await import('node:url')
    const { createRequire } = await import('node:module')
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(createRequire(__filename).resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href
    const task1 = pdfjs.getDocument({ data: new Uint8Array(file1) })
    const doc1 = await task1.promise
    try {
      assert.equal(doc1.numPages, second.pdf.totalPages, '最终 PDF 页数与预览页数一致')
    } finally {
      await task1.destroy()
    }

    // ---- 参数失配 → 不复用：过期 PDF 不得当作当前设置结果 ----
    await postToWebview({ kind: 'pdfExportModal._test.setParam', field: 'scale', value: 0.5 })
    await inject({ kind: 'pdfExportModal.run', params: { ...LANDSCAPE_ON, scale: 0.5 } })
    const done2 = await poll('导出完成（新配置生成）', async () => {
      const info = await modalState()
      const saved = info.hookedSaveTarget ?? info.savedPath
      if (info.savedPath === undefined || saved === undefined) return undefined
      if (saved === (done1.hookedSaveTarget ?? done1.savedPath)) return undefined
      return info
    }, 180000)
    assert.equal(done2.preview.lastExportReused, false, '参数失配时导出不得复用旧预览')
    const file2 = Buffer.from(await readFile(done2.hookedSaveTarget ?? done2.savedPath!))
    const file2Sha = createHash('sha256').update(file2).digest('hex')
    assert.notEqual(file2Sha, previewSha, '新配置导出应为新生成字节')
    // 导出产物回填：预览更新为导出字节（同源同代次字面成立——回填与
    // done 状态推送异步竞态，轮询收敛）
    await poll('导出产物回填预览', async () => {
      const info = await modalState()
      return info.preview.bytesSha256 === file2Sha ? true : undefined
    })

    await closeAll()
  }],

  ['PDF 导出（#627 T07）：批量清单点击选中与自动加载预览（真浏览器）', async () => {
    await closeAll()
    const { resolveExportBrowser } = await import('../../../src/host/pdfExport/browserFind')
    const browser = await resolveExportBrowser(undefined)
    if (!browser.ok) {
      console.log('[集成测试][SKIP] 无可用 Chrome/Edge，T07 批量预览链路本环境未验证（#627）')
      return
    }

    await vscode.commands.executeCommand(BATCH_COMMAND)
    await inject({ kind: 'pdfExportModal.batch.addFiles', paths: [
      norm(path.join(wsDir, 'pdf-batch/dir1/a.md')),
      norm(path.join(wsDir, 'pdf-export-t07-long.md')),
    ] })
    const items = await poll('批量清单 2 条', async () => {
      const batch = (await modalState()).batch
      return batch?.mode === 'batch' && batch.items.length === 2 ? batch.items : undefined
    })

    // 点击清单条目 = 选中并自动加载预览（幂等）：首条两次点击只产生一轮
    // 生成；长文档条目点一次即成为预览目标（无需刷新按钮）
    const firstId = items[0]!.id
    const longId = items[1]!.id
    const runsStart = (await modalState()).preview.runs
    await inject({ kind: 'pdfExportModal.preview.select', itemId: longId, params: PARAMS_BASE })
    await poll('点击条目后目标切换', async () => {
      const info = await modalState()
      return info.preview.batchItemId === longId && info.preview.phase !== 'idle' ? info : undefined
    }, 60000)
    // 点击即加载：选中态绘制层高亮与目标身份一致
    await poll('选中条目高亮绘制层', async () => {
      const p = paintOf(await modalState())
      return p['selectedItemRel'] === 'pdf-export-t07-long.md' ? p : undefined
    })
    const long = await waitPreviewPainted()
    assert.ok(long.pdf.totalPages >= 10, `长文档预览应 ≥10 页（实际 ${long.pdf.totalPages}）`)
    // 有界挂载：仅可见窗口 ± 有限相邻页（挂载页数与画布费用不随总页数增长）
    assert.ok(long.pdf.mountedPages <= 8 && long.pdf.mountedPages < long.pdf.totalPages,
      `挂载页数应有界（实际 ${long.pdf.mountedPages} / 总 ${long.pdf.totalPages}）`)
    assert.ok(long.pdf.canvasBytes <= 40 * 1024 * 1024, `画布费用应在预算内（实际 ${long.pdf.canvasBytes}）`)
    assert.equal(paintOf(long.info)['previewStale'], false, '就绪预览无过期徽章')
    assert.equal((long.info.preview.target as { fsPath?: string } | undefined)?.fsPath,
      norm(items[1]!.fsPath), '预览目标应为选中条目')
    assert.equal(long.info.preview.runs, runsStart + 1, '点击条目只发起一轮生成')

    // 幂等：再点同一条目（同参数、已就绪且未过期）→ 零动作
    await inject({ kind: 'pdfExportModal.preview.select', itemId: longId, params: PARAMS_BASE })
    await new Promise((r) => setTimeout(r, 1200))
    const repeat = await modalState()
    assert.equal(repeat.preview.runs, runsStart + 1, '同一条目重复点击不得重复生成')
    assert.equal(repeat.preview.phase, 'ready', '同一条目重复点击保持就绪态')

    // 点击另一条 → 选中并自动加载新一轮（目标身份变化）。等 webview 已应用
    // 新代次产物（previewArtifactGeneration 与宿主 generation 对齐）再断言——
    // 宿主 ready 先于字节到达 webview，只等 phase 会读到上一张画布
    await inject({ kind: 'pdfExportModal.preview.select', itemId: firstId, params: PARAMS_BASE })
    const switched = await poll('切换条目自动加载预览并绘制', async () => {
      const info = await modalState()
      const p = paintOf(info)
      if (info.preview.phase !== 'ready') return undefined
      if (p['previewArtifactGeneration'] !== info.preview.generation) return undefined
      const pdf = p['previewPdf'] as T07PreviewPdfProbe | null
      if (pdf === null || pdf.phase !== 'content') return undefined
      return { info, pdf }
    }, 180000)
    assert.equal((switched.info.preview.target as { fsPath?: string } | undefined)?.fsPath,
      norm(items[0]!.fsPath), '切换条目后预览目标应为新选中条目')
    assert.equal(switched.info.preview.runs, runsStart + 2, '切换条目应自动加载新条目预览（一轮）')

    // 快速连点（先 A、随即 B）：最终呈现必须是 B，而不是先落地的那一轮。
    // 在途轮的目标身份在其发起时锁定，目标已变的迟到字节一律丢弃，最新
    // 选择在轮末补发一轮——用户最后点的那一项才是画面。
    const runsBeforeRace = (await modalState()).preview.runs
    await inject({ kind: 'pdfExportModal.preview.select', itemId: longId, params: PARAMS_BASE })
    await inject({ kind: 'pdfExportModal.preview.select', itemId: firstId, params: PARAMS_BASE })
    const raced = await poll('快速连点后落在最后点击的条目', async () => {
      const info = await modalState()
      const p = paintOf(info)
      if (info.preview.phase !== 'ready') return undefined
      if (p['previewArtifactGeneration'] !== info.preview.generation) return undefined
      const target = info.preview.target as { kind?: string; fsPath?: string } | undefined
      if (target?.fsPath !== norm(items[0]!.fsPath)) return undefined
      const pdf = p['previewPdf'] as T07PreviewPdfProbe | null
      if (pdf === null || pdf.phase !== 'content') return undefined
      return { info, pdf }
    }, 240000)
    assert.equal((raced.info.preview.target as { fsPath?: string } | undefined)?.fsPath,
      norm(items[0]!.fsPath), '快速连点后预览目标应为最后点击的条目')
    // 最后点击的条目至少补发了一轮（在途轮被作废时也要有新轮）
    assert.ok(raced.info.preview.runs >= runsBeforeRace + 1,
      `快速连点后应至少再生成一轮（实测 ${raced.info.preview.runs - runsBeforeRace} 轮）`)
    // 选中态与画面同源：不能出现「高亮 A、画面 B」
    const racedPaint = paintOf(raced.info)
    assert.equal(racedPaint['selectedItemRel'], items[0]!.relPath, '选中行应与最终预览目标一致')

    await closeAll()
  }],

  ['PDF 导出（#627 T07）：合并预览书签观测与关闭后迟到丢弃（真浏览器）', async () => {
    await closeAll()
    const { resolveExportBrowser } = await import('../../../src/host/pdfExport/browserFind')
    const browser = await resolveExportBrowser(undefined)
    if (!browser.ok) {
      console.log('[集成测试][SKIP] 无可用 Chrome/Edge，T07 合并预览链路本环境未验证（#627）')
      return
    }

    // ---- 轮 1：合并预览 → 书签观测 → 导出复用同源 ----
    await vscode.commands.executeCommand(MERGE_COMMAND)
    await inject({ kind: 'pdfExportModal.batch.addFiles', paths: [
      norm(path.join(wsDir, 'pdf-merge/alpha.md')),
      norm(path.join(wsDir, 'pdf-merge/beta.md')),
    ] })
    await poll('合并清单 2 条', async () => {
      const batch = (await modalState()).batch
      return batch?.mode === 'merge' && batch.items.length === 2 ? true : undefined
    })
    // 每篇另起一页经真实控件路径开启（webview 本地态与注入参数同口径——
    // 指纹成分一致，不误报过期）
    await postToWebview({ kind: 'pdfExportModal._test.setParam', field: 'mergePageBreak', value: true })
    await poll('每篇另起一页开启', async () => {
      return paintOf(await modalState())['mergePageBreakChecked'] === true ? true : undefined
    })
    await inject({ kind: 'pdfExportModal.preview.refresh', params: { ...PARAMS_BASE, bookmarksEnabled: true }, pageBreak: true })
    const painted = await waitPreviewPainted()
    assert.ok(painted.info.preview.bookmarks?.written === true, '合并预览应写入合并书签')
    assert.ok(painted.pdf.totalPages >= 2, `合并预览应 ≥2 页（实际 ${painted.pdf.totalPages}）`)

    const previewSha = painted.info.preview.bytesSha256
    await inject({ kind: 'pdfExportModal.merge.run', params: { ...PARAMS_BASE, bookmarksEnabled: true }, pageBreak: true })
    const done = await poll('合并导出完成（复用路径）', async () => {
      const info = await modalState()
      const batch = info.batch
      if (batch?.mode === 'merge' && batch.phase === 'done' && (info.hookedSaveTarget ?? info.savedPath)) return info
      if (batch?.mode === 'merge' && (batch.phase === 'failed' || batch.phase === 'cancelled')) {
        throw new Error(`合并导出失败：${JSON.stringify(batch)}`)
      }
      return undefined
    }, 180000)
    assert.equal(done.preview.lastExportReused, true, '指纹一致时合并导出应复用预览字节')
    const file = Buffer.from(await readFile(done.hookedSaveTarget ?? done.savedPath!))
    assert.equal(createHash('sha256').update(file).digest('hex'), previewSha, '合并导出文件与预览产物同源')

    // ---- 轮 2：生成在途关闭模态 → 重开无上一会话预览（迟到回包不复活） ----
    await inject({ kind: 'pdfExportModal.batch.cancel' }) // done → editing（新一轮语义）
    await poll('回到 editing', async () => {
      const batch = (await modalState()).batch
      return batch?.mode === 'merge' && batch.phase === 'editing' ? true : undefined
    })
    const runsBefore = (await modalState()).preview.runs
    await inject({ kind: 'pdfExportModal.preview.refresh', params: PARAMS_BASE, pageBreak: false })
    await poll('生成在途', async () => {
      return (await modalState()).preview.phase === 'generating' ? true : undefined
    }, 60000)
    await closeAll() // 关闭模态：在途预览作废（会话令牌重置）
    await poll('模态关闭', async () => {
      return (await modalState()).open === false ? true : undefined
    })
    await vscode.commands.executeCommand(MERGE_COMMAND)
    await poll('重开合并模态', async () => {
      const info = await modalState()
      return info.open && info.batch?.mode === 'merge' ? true : undefined
    })
    const reopened = await modalState()
    assert.equal(reopened.preview.phase, 'idle', '重开模态不得显示上一会话预览')
    assert.equal(reopened.preview.byteLength, 0, '重开会话无残留产物字节')
    assert.equal(reopened.preview.runs, runsBefore + 1, '在途轮计入发起计数（其余观测不残留）')
    // 迟到回包观察窗：令牌已重置——旧轮任何迟到结果不得复活预览
    await new Promise((r) => setTimeout(r, 3000))
    const settled = await modalState()
    assert.equal(settled.preview.phase, 'idle', '迟到回包不得发布（会话已终结）')
    assert.equal(settled.preview.byteLength, 0, '迟到回包不得推送字节')

    await closeAll()
  }],
]
