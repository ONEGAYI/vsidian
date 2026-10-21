// T05（#625）PDF 导出集成用例（真实浏览器链路——沿 T01/T02 sensitive 组
// 先例）：页眉页脚与页码（产物文本可提取）、排版参数真实影响几何
//（横纵向/自定义纸张）、标题书签（pdfjs getOutline 读回：中文/层级/重复
// 标题/页码定位互证）、书签失败不给伪造（无标题文档零 outline）、
// 持久默认参数回显（自有设置页键 → 模态预选）。
// 产物断言经 pdfjs-dist legacy（node 侧 getTextContent/getOutline）；中文
// 匹配先 NFKC + CJK 部首补充区对照归一（V01 §7——shared/pdfTextNormalize，
// 与生产书签定位同源）。无可用浏览器环境如实 SKIP 留痕。
import * as vscode from 'vscode'
import * as assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { normalizePdfText } from '../../../src/shared/pdfTextNormalize'

const VIEW_TYPE = 'onegayi.vsidian.editor'
const EXPORT_COMMAND = 'onegayi.vsidian.pdfExport.currentDocument'
const wsDir = process.env['WORKSPACE_DIR'] ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''
if (!wsDir) {
  throw new Error('工作区根不可得：WORKSPACE_DIR 未设置且无工作区文件夹')
}
const wsUri = (name: string): vscode.Uri => vscode.Uri.file(`${wsDir}/${name}`)

interface ModalInfo {
  open: boolean
  phase: 'idle' | 'generating' | 'awaiting-resources' | 'saving' | 'done' | 'failed' | 'cancelled'
  generation: number
  docName: string
  capturedVersion: number
  savedPath: string | undefined
  failReason: string | undefined
  failDetail: string | undefined
  bookmarks: { written: boolean; total: number; skipped: number; reason?: string; detail?: string } | undefined
  lastPaint: unknown
}

interface PdfPaint {
  headerChecked: boolean | null
  pageNumberChecked: boolean | null
  bookmarksChecked: boolean | null
  paperValue: string
  pageNumberPositionValue: string | null
  bookmarkNoticeText: string
  headerCheck: { visible: boolean } | null
  bookmarksCheck: { visible: boolean } | null
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

async function modalState(): Promise<ModalInfo> {
  return vscode.commands.executeCommand('onegayi.vsidian._test.getPdfExportModalState') as Promise<ModalInfo>
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

async function closeActiveEditor(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
  await new Promise((r) => setTimeout(r, 250))
}

/** 打开文档 → 触发导出命令 → 等固定输入捕获完成 */
async function openExportAndWaitCapture(name: string): Promise<void> {
  await openDocAndWait(name)
  await vscode.commands.executeCommand(EXPORT_COMMAND)
  await poll('固定输入捕获', async () => {
    const info = await modalState()
    return info.docName === name && info.capturedVersion >= 1 ? true : undefined
  })
}

/** 发起导出到终态（done/failed 抛错、cancelled 抛错——T05 样本无缺失资源，
 *  不会进入 awaiting-resources） */
async function runExport(params: Record<string, unknown>): Promise<ModalInfo> {
  await vscode.commands.executeCommand('onegayi.vsidian._test.injectPdfExportModalMessage', {
    kind: 'pdfExportModal.run',
    params,
  })
  return poll('导出终态', async () => {
    const info = await modalState()
    if (info.phase === 'failed') {
      throw new Error(`导出失败分态：${info.failReason ?? 'unknown'}：${info.failDetail ?? ''}`)
    }
    if (info.phase === 'cancelled') {
      throw new Error('导出意外取消')
    }
    return info.phase === 'done' && info.savedPath ? info : undefined
  }, 180000)
}

/** pdfjs-dist legacy（node 侧）证据提取：逐页文本 + outline 读回
 * （destPageIndex 解析）+ 首页几何。 */
async function extractPdfEvidence(bytes: Buffer): Promise<{
  pages: string[]
  pageCount: number
  widthPt: number
  heightPt: number
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
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const content = await page.getTextContent()
      pages.push(content.items.map((item) => 'str' in item ? item.str : '').join(''))
    }
    const first = await doc.getPage(1)
    const viewport = first.getViewport({ scale: 1 })
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
    return { pages, pageCount: doc.numPages, widthPt: viewport.width, heightPt: viewport.height, outline: rawOutline ? outline : null }
  } finally {
    await task.destroy()
  }
}

const near = (actual: number, expected: number, tol: number) => Math.abs(actual - expected) <= tol

export const pdfExportT05Cases: Array<[string, () => Promise<void>]> = [
  ['PDF 导出（#625 T05）：横纵向/自定义纸张几何、页眉页脚与页码产物断言', async () => {
    const { resolveExportBrowser } = await import('../../../src/host/pdfExport/browserFind')
    const browser = await resolveExportBrowser(undefined)
    if (!browser.ok) {
      console.log('[集成测试][SKIP] 无可用 Chrome/Edge，T05 排版与页眉页脚链路本环境未验证（#625）')
      return
    }

    // ---- 轮 1：A4 横向 + 页眉（标题/日期）+ 页码（页脚右）----
    await openExportAndWaitCapture('pdf-export-t05.md')
    const today = new Date()
    const dateText = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    const run1 = await runExport({
      paper: 'a4', orientation: 'landscape', marginMm: 10, scale: 1,
      headerEnabled: true, headerTitle: true, headerDate: true,
      pageNumberEnabled: true, pageNumberPosition: 'footer-right',
    })
    const bytes1 = Buffer.from(await readFile(run1.savedPath!))
    const r1 = await extractPdfEvidence(bytes1)
    // 横向几何：A4 互换（V01 §6 口径 ±2pt）
    assert.ok(near(r1.widthPt, 841.92, 2) && near(r1.heightPt, 595.92, 2),
      `A4 横向几何（实际 ${r1.widthPt}×${r1.heightPt}pt）`)
    assert.ok(r1.pageCount >= 2, `多页断言（实际 ${r1.pageCount} 页）`)
    // 页眉：标题 + 日期进每页（文本层可提取——产物断言非模态 DOM；两侧同
    // 归一口径——normalizePdfText 去空白不去标点，日期连字符保留）
    const dateNeedle = normalizePdfText(dateText)
    for (let i = 0; i < r1.pageCount; i++) {
      const page = normalizePdfText(r1.pages[i] ?? '')
      assert.ok(page.includes(normalizePdfText('pdf-export-t05')),
        `第 ${i + 1} 页页眉应含文档标题（页文本片段：${page.slice(0, 60)}）`)
      assert.ok(page.includes(dateNeedle), `第 ${i + 1} 页页眉应含导出日期 ${dateText}（页片段：${page.slice(0, 60)}）`)
    }
    // 页码：Chromium 原生 pageNumber/totalPages 替换——逐页页号正确。页码
    // 词条语言跟宿主 UI 语言（模态界面与产物页码同语言——集成宿主便携
    // 默认 en；断言双语兼容，不绑宿主语言环境）
    for (let i = 0; i < r1.pageCount; i++) {
      const page = normalizePdfText(r1.pages[i] ?? '')
      const zh = normalizePdfText(`第 ${i + 1} 页 / 共 ${r1.pageCount} 页`)
      const en = normalizePdfText(`Page ${i + 1} of ${r1.pageCount}`)
      assert.ok(page.includes(zh) || page.includes(en),
        `第 ${i + 1} 页页码应为「${zh}」或「${en}」（实际片段：${page.slice(-40)}）`)
    }
    // 页码与页眉的参数真实生效由上方产物断言钉住（票面：不以模态 DOM 检查
    // 替代产物）；注入 run 通道绕过模态控件（T01 先例），done 态控件回显
    // defaults——勾选态的回显验证归用例 4（设置注入路径走模态 applyState）
    await closeActiveEditor()

    // ---- 轮 2：自定义纸张（148×210mm 纵向）——参数真实传入换算 ----
    await openExportAndWaitCapture('pdf-export-t05.md')
    const run2 = await runExport({
      paper: 'custom', customWidthMm: 148, customHeightMm: 210,
      orientation: 'portrait', marginMm: 20, scale: 1,
    })
    const r2 = await extractPdfEvidence(Buffer.from(await readFile(run2.savedPath!)))
    // 148mm=419.53pt、210mm=595.28pt（±2pt）
    assert.ok(near(r2.widthPt, 148 / 25.4 * 72, 2) && near(r2.heightPt, 210 / 25.4 * 72, 2),
      `自定义纸张几何（实际 ${r2.widthPt}×${r2.heightPt}pt）`)
    await closeActiveEditor()
  }],

  ['PDF 导出（#625 T05）：标题书签结构、重复标题页码与中文标题', async () => {
    const { resolveExportBrowser } = await import('../../../src/host/pdfExport/browserFind')
    const browser = await resolveExportBrowser(undefined)
    if (!browser.ok) {
      console.log('[集成测试][SKIP] 无可用 Chrome/Edge，T05 书签链路本环境未验证（#625）')
      return
    }
    await openExportAndWaitCapture('pdf-export-t05.md')
    const done = await runExport({
      paper: 'a4', orientation: 'portrait', marginMm: 20, scale: 1,
      bookmarksEnabled: true,
    })
    // 书签报告：全部标题写入（written + skipped=0）
    assert.ok(done.bookmarks?.written, `书签应写入（报告 ${JSON.stringify(done.bookmarks)}）`)
    assert.equal(done.bookmarks?.skipped, 0, '样本标题均应定位成功（无跳过）')
    const evidence = await extractPdfEvidence(Buffer.from(await readFile(done.savedPath!)))
    // outline 读回：非空（Chromium printToPDF 不产 outline——后处理写入的实证）
    assert.ok(evidence.outline !== null && evidence.outline.length >= 4,
      `书签条目应 ≥4（实际 ${JSON.stringify(evidence.outline)}）`)
    const flat = evidence.outline!
    // 中文标题 + 层级：H1 顶级「T05 根标题：页面与书签」（标题含部首敏感字
    //「页」——PDFHexString 写入读回原样，不经 ToUnicode 部首映射）
    assert.equal(flat[0]!.title, 'T05 根标题：页面与书签')
    assert.equal(flat[0]!.depth, 0)
    assert.equal(flat[0]!.destPageIndex, 0, '根标题定位第 1 页')
    // 重复标题：两条「重复小节标题」按文档顺序在不同页且页码递增（游标推进）
    const dups = flat.filter((item) => item.title === '重复小节标题')
    assert.equal(dups.length, 2, `重复标题应有两条书签（实际 ${JSON.stringify(flat.map((f) => f.title))}）`)
    assert.ok(dups[0]!.destPageIndex !== null && dups[1]!.destPageIndex !== null
      && dups[1]!.destPageIndex! > dups[0]!.destPageIndex!,
      `重复标题页码应递增（实际 ${dups.map((d) => d.destPageIndex).join('→')}）`)
    assert.ok(dups[0]!.depth === 1 && dups[1]!.depth === 1, '重复小节应为 H1 的子级')
    // 页码定位互证：重复标题第二条的目标页文本确实含「第二次重复小节正文」
    const dupSecondPage = normalizePdfText(evidence.pages[dups[1]!.destPageIndex!] ?? '')
    assert.ok(dupSecondPage.includes(normalizePdfText('第二次重复小节正文')),
      '重复标题第二条应定位到第二次出现页（页码定位互证）')
    // 深层嵌套：三级小节挂第二个重复小节之下（depth 2）
    const deep = flat.find((item) => item.title === '深层三级小节')
    assert.ok(deep && deep.depth === 2, `三级小节应为二级的子级（实际 ${JSON.stringify(deep)}）`)
    await closeActiveEditor()
  }],

  ['PDF 导出（#625 T05）：书签失败不给伪造（无标题文档零 outline）', async () => {
    const { resolveExportBrowser } = await import('../../../src/host/pdfExport/browserFind')
    const browser = await resolveExportBrowser(undefined)
    if (!browser.ok) {
      console.log('[集成测试][SKIP] 无可用 Chrome/Edge，T05 书签失败面本环境未验证（#625）')
      return
    }
    await openExportAndWaitCapture('pdf-export-t05-noheadings.md')
    const done = await runExport({
      paper: 'a5', orientation: 'portrait', marginMm: 18, scale: 1,
      bookmarksEnabled: true,
    })
    // 报告如实：无标题 → 不写 outline
    assert.equal(done.bookmarks?.written, false)
    assert.equal(done.bookmarks?.reason, 'no-headings')
    const evidence = await extractPdfEvidence(Buffer.from(await readFile(done.savedPath!)))
    assert.ok(evidence.outline === null, '无标题文档产物不得含 /Outlines（不给伪造书签）')
    assert.ok(evidence.pages.join('').includes('PDF-T05-NOHEAD-BODY'), '正文正常入版（书签失败不影响产物）')
    // 模态提示如实呈现（绘制层探针）
    const paint = done.lastPaint as PdfPaint | undefined
    assert.ok((paint?.bookmarkNoticeText ?? '').length > 0, `模态应呈现书签未添加提示（实际 ${JSON.stringify(paint?.bookmarkNoticeText)}）`)
    await closeActiveEditor()
  }],

  ['PDF 导出（#625 T05）：持久默认参数回显（自有设置页键 → 模态预选）', async () => {
    const { resolveExportBrowser } = await import('../../../src/host/pdfExport/browserFind')
    const browser = await resolveExportBrowser(undefined)
    if (!browser.ok) {
      console.log('[集成测试][SKIP] 无可用 Chrome/Edge，T05 设置回显链路本环境未验证（#625）')
      return
    }
    try {
      // 写入持久默认（globalState 经设置服务——自有设置页同一数据面）
      await vscode.commands.executeCommand('onegayi.vsidian._test.setSettings', {
        'pdfExport.paper': 'custom',
        'pdfExport.customWidthMm': 100,
        'pdfExport.customHeightMm': 148,
        'pdfExport.headerEnabled': true,
        'pdfExport.headerDate': true,
        'pdfExport.pageNumberEnabled': true,
        'pdfExport.pageNumberPosition': 'footer-left',
        'pdfExport.bookmarksEnabled': true,
      })
      // 重开模态：固定输入捕获 + 绘制层探针上报后断言预选回显
      await openExportAndWaitCapture('pdf-export-t05.md')
      const paint = await poll('模态绘制层探针上报', async () => {
        const info = await modalState()
        const p = info.lastPaint as PdfPaint | undefined
        return p && p.paperValue !== undefined ? p : undefined
      })
      assert.equal(paint.paperValue, 'custom', `纸张应回显 custom（实际 ${paint.paperValue}）`)
      assert.ok(paint.headerChecked === true, '页眉开关应回显开')
      assert.ok(paint.pageNumberChecked === true, '页码开关应回显开')
      assert.ok(paint.bookmarksChecked === true, '书签开关应回显开')
      assert.equal(paint.pageNumberPositionValue, 'footer-left', '页码位置应回显页脚左')
      // 回显即验证面（不真跑生成）；关闭编辑器收口（模态 onDidDispose →
      // job.dispose 幂等取消——取消释放链路 T02 已覆盖）
      await closeActiveEditor()
    } finally {
      // 恢复默认（globalState 跨用例共享——不留脏状态）
      await vscode.commands.executeCommand('onegayi.vsidian._test.setSettings', {
        'pdfExport.paper': 'a4',
        'pdfExport.customWidthMm': 210,
        'pdfExport.customHeightMm': 297,
        'pdfExport.headerEnabled': false,
        'pdfExport.headerDate': false,
        'pdfExport.pageNumberEnabled': false,
        'pdfExport.pageNumberPosition': 'footer-center',
        'pdfExport.bookmarksEnabled': false,
      })
    }
  }],
]
