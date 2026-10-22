// T06（#626）PDF 合并导出集成用例：
// 1. core：合并模式清单编辑与每篇另起一页参数面（绘制层断言——模态
//    webview 探针，无浏览器依赖）；
// 2. sensitive（真实浏览器链路，沿 T01–T05 敏感组先例）：
//    - 三篇（中文标题/图片/不同文档样式/跨篇重复标题）按清单顺序合并成
//      一份 PDF——每篇另起一页开：分页证据 + 文档名顶级书签 + 页码总页数
//      对应合并产物；
//    - 每篇另起一页关：连续排版（同页证据）+ 样式不跨篇（h1 字号几何
//      按篇归属——文本提取的字号断言，非 DOM 检查）；
//    - 固定输入失败（清单篇不可读）整次失败无产物；缺资源取消无伪成功；
//      resume-all 降级完成。
// 产物断言经 pdfjs-dist legacy（node 侧 getTextContent/getOutline）；中文
// 匹配先 NFKC + CJK 部首补充区对照归一（shared/pdfTextNormalize 与生产
// 书签定位同源）。无可用浏览器环境如实 SKIP 留痕。
import * as vscode from 'vscode'
import * as assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { normalizePdfText } from '../../../src/shared/pdfTextNormalize'

const VIEW_TYPE = 'onegayi.vsidian.editor'
const MERGE_COMMAND = 'onegayi.vsidian.pdfExport.merge'
const wsDir = process.env['WORKSPACE_DIR'] ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''
if (!wsDir) {
  throw new Error('工作区根不可得：WORKSPACE_DIR 未设置且无工作区文件夹')
}
const wsUri = (name: string): vscode.Uri => vscode.Uri.file(`${wsDir}/${name}`)
const norm = (p: string): string => p.replaceAll('\\', '/')

interface MergeModalInfo {
  open: boolean
  lastPaint: unknown
  batch:
    | {
        mode: 'batch'
        phase: string
        items: Array<{ id: string; fsPath: string; rootFsPath: string; relPath: string }>
      }
    | {
        mode: 'merge'
        phase: 'editing' | 'capturing' | 'running' | 'awaiting-resources' | 'saving' | 'done' | 'cancelled' | 'failed'
        items: Array<{ id: string; fsPath: string; rootFsPath: string; relPath: string }>
        currentIndex: number
        total: number
        currentName?: string
        failReason?: string
        failDetail?: string
        savedPath?: string
        bookmarks?: { written: boolean; total: number; skipped: number; reason?: string }
        hookedSaveTarget?: string
      }
    | undefined
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

async function modalState(): Promise<MergeModalInfo> {
  return vscode.commands.executeCommand('onegayi.vsidian._test.getPdfExportModalState') as Promise<MergeModalInfo>
}

async function inject(message: unknown): Promise<void> {
  await vscode.commands.executeCommand('onegayi.vsidian._test.injectPdfExportModalMessage', message)
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

interface PdfTextItem {
  str: string
  height: number
}

/** pdfjs-dist legacy 证据提取：逐页文本 + 逐项字号（样式归属断言——
 *  docStyle 的 h1 字号差异体现在文本项几何）+ outline 读回。 */
async function extractMergeEvidence(bytes: Buffer): Promise<{
  pages: string[]
  itemsByPage: PdfTextItem[][]
  pageCount: number
  outline: Array<{ title: string; destPageIndex: number | null; depth: number }> | null
}> {
  if (typeof (Promise as unknown as { withResolvers?: unknown }).withResolvers !== 'function') {
    ;(Promise as unknown as { withResolvers: () => unknown }).withResolvers = function withResolvers() {
      let resolve!: (value: unknown) => void
      let reject!: (reason?: unknown) => void
      const promise = new Promise((res, rej) => { resolve = res; reject = rej })
      return { promise, resolve, reject }
    }
  }
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const { createRequire } = await import('node:module')
  const { pathToFileURL } = await import('node:url')
  const workerPath = createRequire(__filename).resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false })
  const doc = await task.promise
  try {
    const pages: string[] = []
    const itemsByPage: PdfTextItem[][] = []
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      const items = (content.items as Array<{ str?: string; height?: number }>)
        .filter((item): item is { str: string; height: number } => typeof item.str === 'string' && typeof item.height === 'number')
      itemsByPage.push(items.map((item) => ({ str: item.str, height: item.height })))
      pages.push(items.map((item) => item.str).join(''))
    }
    const rawOutline = await doc.getOutline()
    const outline: Array<{ title: string; destPageIndex: number | null; depth: number }> = []
    const walk = async (items: Array<{ title?: string; dest?: unknown }>, depth: number): Promise<void> => {
      for (const item of items) {
        let destPageIndex: number | null = null
        if (Array.isArray(item.dest) && item.dest[0] && typeof item.dest[0] === 'object') {
          try {
            destPageIndex = await doc.getPageIndex(item.dest[0] as never)
          } catch { destPageIndex = null }
        }
        outline.push({ title: item.title ?? '', destPageIndex, depth })
        await walk((item as unknown as { items?: Array<{ title?: string; dest?: unknown }> }).items ?? [], depth + 1)
      }
    }
    if (rawOutline) {
      await walk(rawOutline as never, 0)
    }
    return { pages, itemsByPage, pageCount: doc.numPages, outline: rawOutline ? outline : null }
  } finally {
    await task.destroy()
  }
}

/** 最早出现某标记的页索引（归一匹配） */
const firstPageOf = (pages: string[], marker: string): number => {
  const needle = normalizePdfText(marker)
  const index = pages.findIndex((page) => normalizePdfText(page).includes(needle))
  assert.ok(index >= 0, `标记 ${marker} 应入版（页文本：${pages.map((p) => normalizePdfText(p).slice(0, 30)).join(' / ')}）`)
  return index
}

/** 首个含某文本的文本项字号（样式归属断言） */
const heightOf = (itemsByPage: PdfTextItem[][], needle: string): number => {
  const target = normalizePdfText(needle)
  for (const items of itemsByPage) {
    for (const item of items) {
      if (normalizePdfText(item.str).includes(target)) return item.height
    }
  }
  throw new Error(`文本项未见 ${needle}`)
}

const paintOf = (info: MergeModalInfo): Record<string, unknown> => (info.lastPaint ?? {}) as Record<string, unknown>

const visible = (probe: unknown): boolean => {
  if (probe === null || probe === undefined) return false
  const p = probe as { visible?: boolean; display?: string }
  return p.visible === true && p.display !== 'none'
}

async function closeAll(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors').then(() => undefined, () => undefined)
  await new Promise((r) => setTimeout(r, 200))
}

/** 发起合并到终态（failed/cancelled 抛错——由调用方另行构造失败面用例） */
async function runMerge(params: Record<string, unknown>, pageBreak: boolean): Promise<NonNullable<Extract<MergeModalInfo['batch'], { mode: 'merge' }>>> {
  await inject({ kind: 'pdfExportModal.merge.run', params, pageBreak })
  return poll('合并终态', async () => {
    const info = await modalState()
    const batch = info.batch
    if (batch?.mode === 'merge') {
      if (batch.phase === 'failed') {
        throw new Error(`合并失败分态：${batch.failReason ?? 'unknown'}：${batch.failDetail ?? ''}`)
      }
      if (batch.phase === 'cancelled') {
        throw new Error('合并意外取消')
      }
      if (batch.phase === 'done' && batch.savedPath) return batch
    }
    return undefined
  }, 180000)
}

const PARAMS_BASE = { paper: 'a4', orientation: 'portrait', marginMm: 18, scale: 1 }

export const pdfExportT06Cases: Array<[string, () => Promise<void>]> = [
  ['PDF 导出（#626 T06）：合并清单编辑与每篇另起一页参数（core 绘制层）', async () => {
    await closeAll()
    await vscode.commands.executeCommand(MERGE_COMMAND)
    await poll('合并模态打开（merge 模式空清单）', async () => {
      const info = await modalState()
      return info.batch?.mode === 'merge' && info.batch.phase === 'editing' && info.batch.items.length === 0 ? true : undefined
    })

    // 目录收集与批量共用（递归 Markdown——missing.md 一并 4 条）
    await inject({ kind: 'pdfExportModal.batch.addDir', path: norm(path.join(wsDir, 'pdf-merge')) })
    const listed = await poll('合并清单收集（4 条）', async () => {
      const info = await modalState()
      return info.batch?.mode === 'merge' && info.batch.items.length === 4 ? info.batch : undefined
    })
    assert.deepEqual(listed.items.map((i) => i.relPath).sort(), ['alpha.md', 'beta.md', 'gamma.md', 'missing.md'], '合并清单应收集全部 Markdown')

    // 绘制层断言：清单行文本 + 合并导出按钮 + 每篇另起一页开关（用户
    // 看到的东西——offsetParent 命中而非 DOM 存在性）；开关默认关
    const paint = await poll('合并绘制层探针上报', async () => {
      const p = paintOf(await modalState())
      const rels = p['batchItemRels'] as string[] | undefined
      return rels && rels.length === 4 ? p : undefined
    })
    assert.ok((paint['mergeRunButton'] as unknown) && visible(paint['mergeRunButton']), '「合并导出」按钮应可见')
    assert.equal(paint['mergeRunButtonDisabled'], false, '清单非空时合并按钮可用')
    assert.ok(visible(paint['mergePageBreakCheck']), '「每篇另起一页」开关应可见')
    assert.equal(paint['mergePageBreakChecked'], false, '每篇另起一页默认关闭')
    assert.ok(visible(paint['bookmarksCheck']), '标题书签开关应在合并参数区在场（单文档参数区共用）')

    // 调序与删除共用批量消息族（同一数据面）：首条下移生效
    const firstId = listed.items[0]!.id
    await inject({ kind: 'pdfExportModal.batch.move', id: firstId, direction: 'down' })
    await poll('合并清单调序生效', async () => {
      const batch = (await modalState()).batch
      return batch?.mode === 'merge' && batch.items[0]!.id !== firstId ? true : undefined
    })

    await closeAll()
  }],

  ['PDF 导出（#626 T06）：三篇合并、分篇书签与页码总页数（真浏览器）', async () => {
    await closeAll()
    const { resolveExportBrowser } = await import('../../../src/host/pdfExport/browserFind')
    const browser = await resolveExportBrowser(undefined)
    if (!browser.ok) {
      console.log('[集成测试][SKIP] 无可用 Chrome/Edge，T06 合并链路本环境未验证（#626）')
      return
    }

    // 丙篇注入未保存修改（不保存——合并捕获应取未保存权威文本）
    const gammaUri = wsUri('pdf-merge/gamma.md')
    const gammaDoc = await vscode.workspace.openTextDocument(gammaUri)
    const unsavedMarker = 'PDF-T06-UNSAVED-GAMMA'
    const edit = new vscode.WorkspaceEdit()
    edit.insert(gammaUri, new vscode.Position(gammaDoc.lineCount, 0), `\n未保存段：${unsavedMarker}\n`)
    assert.ok(await vscode.workspace.applyEdit(edit), '未保存编辑应成功')
    await openDocAndWait('pdf-merge/gamma.md')

    await vscode.commands.executeCommand(MERGE_COMMAND)
    // 清单顺序 = 合篇顺序（乱序添加证明顺序由清单决定）：丙 → 甲 → 乙
    await inject({ kind: 'pdfExportModal.batch.addFiles', paths: [
      norm(path.join(wsDir, 'pdf-merge/gamma.md')),
      norm(path.join(wsDir, 'pdf-merge/alpha.md')),
      norm(path.join(wsDir, 'pdf-merge/beta.md')),
    ] })
    await poll('合并清单 3 条', async () => {
      const info = await modalState()
      return info.batch?.mode === 'merge' && info.batch.items.length === 3 ? true : undefined
    })

    const done = await runMerge({ ...PARAMS_BASE, bookmarksEnabled: true, pageNumberEnabled: true }, true)
    assert.ok(done.bookmarks?.written, `合并书签应写入（报告 ${JSON.stringify(done.bookmarks)}）`)
    assert.equal(done.bookmarks?.skipped, 0, '样本标题均应定位成功')

    const evidence = await extractMergeEvidence(Buffer.from(await readFile(done.savedPath!)))
    const pagesN = evidence.pages.map((p) => normalizePdfText(p))
    // 每篇另起一页：三篇各占新页且顺序 = 清单序（丙 0 → 甲 1 → 乙 2）
    const gammaPage = firstPageOf(evidence.pages, 'PDF-T06-GAMMA')
    const alphaPage = firstPageOf(evidence.pages, 'PDF-T06-ALPHA')
    const betaPage = firstPageOf(evidence.pages, 'PDF-T06-BETA')
    assert.ok(gammaPage < alphaPage && alphaPage < betaPage, `清单序分页（实际 丙${gammaPage} 甲${alphaPage} 乙${betaPage}）`)
    assert.ok(!pagesN[alphaPage]!.includes(normalizePdfText('PDF-T06-GAMMA')), '甲篇起始页不应含丙篇正文（另起一页）')
    assert.ok(!pagesN[betaPage]!.includes(normalizePdfText('PDF-T06-ALPHA')), '乙篇起始页不应含甲篇正文（另起一页）')
    assert.ok(evidence.pageCount >= 3, `每篇另起一页应 ≥3 页（实际 ${evidence.pageCount}）`)

    // 未保存内容入版（固定输入）：注入段进合并产物
    assert.ok(pagesN.join('\n').includes(normalizePdfText(unsavedMarker)), '已打开文档的未保存内容应进入合并产物')
    // 源文零回写
    assert.ok((await vscode.workspace.openTextDocument(gammaUri)).isDirty, '源文档应保持未保存（合并不触发保存）')

    // 书签结构：文档名顶级（清单序）+ 篇内标题子级 + 跨篇重复标题各自定位
    assert.ok(evidence.outline !== null, '合并产物应含 outline')
    const tops = evidence.outline!.filter((item) => item.depth === 0)
    assert.deepEqual(tops.map((item) => item.title), ['gamma', 'alpha', 'beta'], '顶级书签 = 文档名（去扩展名，清单序）')
    assert.equal(tops[0]!.destPageIndex, gammaPage, '丙篇顶级书签定位丙篇起始页')
    assert.equal(tops[1]!.destPageIndex, alphaPage, '甲篇顶级书签定位甲篇起始页')
    assert.equal(tops[2]!.destPageIndex, betaPage, '乙篇顶级书签定位乙篇起始页')
    const dups = evidence.outline!.filter((item) => item.title === '重复小节标题')
    assert.equal(dups.length, 2, `跨篇重复标题应有两条书签（实际 ${JSON.stringify(evidence.outline!.map((o) => o.title))}）`)
    // 篇内层级保持：重复标题（H2）挂在本篇 H1 之下——depth 2（文档名顶级
    // depth 0 → 篇 H1 depth 1 → H2 小节 depth 2，T05 树构造语义原样保持）
    assert.equal(dups[0]!.depth, 2, '重复标题应挂在宿主篇 H1 之下（depth 2）')
    const dupAlphaPage = dups[0]!.destPageIndex!
    const dupBetaPage = dups[1]!.destPageIndex!
    assert.ok(dupAlphaPage >= alphaPage && dupAlphaPage <= betaPage, `甲篇重复标题应落在甲篇页域（实际 ${dupAlphaPage}）`)
    assert.equal(dupBetaPage, betaPage, `乙篇重复标题应落在乙篇页（按篇游标重置——实际 ${dupBetaPage}）`)
    // 定位互证：乙篇重复标题的目标页文本确含乙篇的重复小节正文
    assert.ok(pagesN[dupBetaPage]!.includes(normalizePdfText('PDF-T06-BETA-DUP')), '重复标题目标页应含乙篇重复小节正文')

    // 总页码对应最终合并产物：页脚 N = 实际总页数（双语兼容）
    for (let i = 0; i < evidence.pageCount; i++) {
      const zh = normalizePdfText(`共 ${evidence.pageCount} 页`)
      const en = normalizePdfText(`of ${evidence.pageCount}`)
      assert.ok(pagesN[i]!.includes(zh) || pagesN[i]!.includes(en),
        `第 ${i + 1} 页页脚应含总页数 ${evidence.pageCount}（页尾片段：${pagesN[i]!.slice(-30)}）`)
    }

    await closeAll()
  }],

  ['PDF 导出（#626 T06）：每篇另起一页关闭连续排版与样式不跨篇（真浏览器）', async () => {
    await closeAll()
    const { resolveExportBrowser } = await import('../../../src/host/pdfExport/browserFind')
    const browser = await resolveExportBrowser(undefined)
    if (!browser.ok) {
      console.log('[集成测试][SKIP] 无可用 Chrome/Edge，T06 连续排版链路本环境未验证（#626）')
      return
    }

    await vscode.commands.executeCommand(MERGE_COMMAND)
    await inject({ kind: 'pdfExportModal.batch.addFiles', paths: [
      norm(path.join(wsDir, 'pdf-merge/alpha.md')),
      norm(path.join(wsDir, 'pdf-merge/beta.md')),
      norm(path.join(wsDir, 'pdf-merge/gamma.md')),
    ] })
    await poll('合并清单 3 条', async () => {
      const info = await modalState()
      return info.batch?.mode === 'merge' && info.batch.items.length === 3 ? true : undefined
    })

    const done = await runMerge({ ...PARAMS_BASE, bookmarksEnabled: true }, false)
    assert.ok(done.bookmarks?.written, '连续排版下书签同样写入')
    const evidence = await extractMergeEvidence(Buffer.from(await readFile(done.savedPath!)))
    const pagesN = evidence.pages.map((p) => normalizePdfText(p))

    // 连续排版证据：甲篇与丙篇同页起始（关闭另起一页——与上一用例的
    // 分页形态互斥）
    const alphaPage = firstPageOf(evidence.pages, 'PDF-T06-ALPHA')
    const gammaPage = firstPageOf(evidence.pages, 'PDF-T06-GAMMA')
    assert.equal(alphaPage, gammaPage, `关闭每篇另起一页时甲篇应紧接丙篇同页（实际 甲${alphaPage} 丙${gammaPage}）`)

    // 样式不跨篇：文档样式（p 字号——内置规则不设段字号，文档样式可生效
    // 的属性面）按篇归属——甲 30px / 乙 9px / 丙默认。字号经文本项几何
    // 断言（needle 用 ASCII 标记——与 CJK 同风格的拉丁 run 单项完整），
    // 样式注入失效时归一为同一继承字号即失败
    const hAlpha = heightOf(evidence.itemsByPage, 'T06-ALPHA')
    const hBeta = heightOf(evidence.itemsByPage, 'T06-BETA')
    const hGamma = heightOf(evidence.itemsByPage, 'T06-GAMMA')
    assert.ok(hAlpha > hBeta * 2, `甲篇正文应显著大于乙篇（实际 甲${hAlpha} 乙${hBeta}——乙篇小字号样式未跨篇污染甲篇）`)
    assert.ok(hBeta < hGamma && hGamma < hAlpha, `丙篇默认字号应介于两篇之间（实际 丙${hGamma}——甲篇大字号样式未跨篇污染丙篇）`)

    // 书签顶级仍为文档名且页码合法（连续排版下的合并书签）
    const tops = evidence.outline!.filter((item) => item.depth === 0)
    assert.deepEqual(tops.map((item) => item.title), ['alpha', 'beta', 'gamma'])
    for (const top of tops) {
      assert.ok(top.destPageIndex !== null && top.destPageIndex >= 0 && top.destPageIndex < evidence.pageCount, '顶级书签页码应合法')
    }
    assert.ok(pagesN.join('\n').includes(normalizePdfText('PDF-T06-BETA-DUP')), '乙篇正文应完整入版')

    await closeAll()
  }],

  ['PDF 导出（#626 T06）：合并失败/取消无伪成功与缺资源继续（真浏览器）', async () => {
    await closeAll()
    const { resolveExportBrowser } = await import('../../../src/host/pdfExport/browserFind')
    const browser = await resolveExportBrowser(undefined)
    if (!browser.ok) {
      console.log('[集成测试][SKIP] 无可用 Chrome/Edge，T06 失败/取消链路本环境未验证（#626）')
      return
    }

    // ---- 轮 1：清单篇固定输入失败（不存在的文件）→ 整次失败、零产物 ----
    await vscode.commands.executeCommand(MERGE_COMMAND)
    await inject({ kind: 'pdfExportModal.batch.addFiles', paths: [
      norm(path.join(wsDir, 'pdf-merge/alpha.md')),
      norm(path.join(wsDir, 'pdf-merge/does-not-exist.md')),
    ] })
    await poll('清单 2 条', async () => {
      const info = await modalState()
      return info.batch?.mode === 'merge' && info.batch.items.length === 2 ? true : undefined
    })
    await inject({ kind: 'pdfExportModal.merge.run', params: PARAMS_BASE, pageBreak: true })
    const failed = await poll('捕获失败终态', async () => {
      const batch = (await modalState()).batch
      return batch?.mode === 'merge' && batch.phase === 'failed' ? batch : undefined
    }, 120000)
    assert.equal(failed.failReason, 'capture-failed', `缺篇应整次失败（实际 ${failed.failReason}）`)
    assert.equal(failed.failDetail, 'does-not-exist.md', '失败诊断应携带篇名')
    assert.equal(failed.savedPath, undefined, '失败不得有伪成功产物')
    assert.equal(failed.hookedSaveTarget, undefined, '失败不得进入保存阶段')

    // ---- 轮 2：缺资源 awaiting-resources 时取消 → cancelled、零产物 ----
    await inject({ kind: 'pdfExportModal.batch.cancel' }) // failed → editing
    await poll('回到 editing', async () => {
      const batch = (await modalState()).batch
      return batch?.mode === 'merge' && batch.phase === 'editing' ? true : undefined
    })
    await inject({ kind: 'pdfExportModal.batch.remove', id: ((await modalState()).batch as Extract<NonNullable<MergeModalInfo['batch']>, { mode: 'merge' }>).items.find((i) => i.relPath === 'does-not-exist.md')!.id })
    await inject({ kind: 'pdfExportModal.batch.addFiles', paths: [
      norm(path.join(wsDir, 'pdf-merge/missing.md')),
      norm(path.join(wsDir, 'pdf-merge/gamma.md')),
    ] })
    await poll('清单 3 条（含缺失图篇）', async () => {
      const batch = (await modalState()).batch
      return batch?.mode === 'merge' && batch.items.length === 3 ? true : undefined
    })
    await inject({ kind: 'pdfExportModal.merge.run', params: PARAMS_BASE, pageBreak: false })
    await poll('缺资源 awaiting-resources（缺失图）', async () => {
      const batch = (await modalState()).batch
      return batch?.mode === 'merge' && batch.phase === 'awaiting-resources' ? batch : undefined
    }, 180000)
    await inject({ kind: 'pdfExportModal.batch.cancel' })
    const cancelled = await poll('取消终态', async () => {
      const batch = (await modalState()).batch
      return batch?.mode === 'merge' && batch.phase === 'cancelled' ? batch : undefined
    }, 60000)
    assert.equal(cancelled.savedPath, undefined, '取消不得有伪成功产物')
    assert.equal(cancelled.hookedSaveTarget, undefined, '取消不得进入保存阶段')

    // ---- 轮 3：重新发起并 resume-all → 降级完成（说明保留、正文入版） ----
    await inject({ kind: 'pdfExportModal.batch.cancel' }) // cancelled → editing
    await poll('回到 editing（第二轮）', async () => {
      const batch = (await modalState()).batch
      return batch?.mode === 'merge' && batch.phase === 'editing' ? true : undefined
    })
    await inject({ kind: 'pdfExportModal.merge.run', params: PARAMS_BASE, pageBreak: false })
    await poll('第二轮 awaiting-resources', async () => {
      const batch = (await modalState()).batch
      return batch?.mode === 'merge' && batch.phase === 'awaiting-resources' ? true : undefined
    }, 180000)
    await inject({ kind: 'pdfExportModal.batch.resume', all: true })
    const done = await poll('resume-all 后合并完成', async () => {
      const batch = (await modalState()).batch
      if (batch?.mode === 'merge' && batch.phase === 'failed') {
        throw new Error(`合并失败分态：${batch.failReason}`)
      }
      return batch?.mode === 'merge' && batch.phase === 'done' && batch.savedPath ? batch : undefined
    }, 180000)
    const text = normalizePdfText((await extractMergeEvidence(Buffer.from(await readFile(done.savedPath!)))).pages.join('\n'))
    assert.ok(text.includes(normalizePdfText('PDF-T06-MISSING')), '缺资源选择继续后应保留说明并完成合篇')
    assert.ok(text.includes(normalizePdfText('PDF-T06-GAMMA')), '其余篇应完整入版')

    await closeAll()
  }],
]
