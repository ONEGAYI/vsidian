// T01（#621）PDF 导出集成用例：
// 1. 命令打开模态 + 参数控件绘制层断言 + 重复开关（core 组）；
// 2. 固定输入（生成期间追加不混入、源文零改动零撤销）、真实浏览器生成、
//    PDF 产物页数/中文文本/尾部标记/纸张几何断言（sensitive 组——无可用
//    浏览器环境如实 SKIP 留痕，不冒充通过）。
// PDF 文本断言经 pdfjs-dist legacy（node 侧 getTextContent，无 canvas 面）；
// 中文匹配先做 NFKC 归一（V01 §7：Chromium ToUnicode 的部首兼容码位坑）。
import * as vscode from 'vscode'
import * as assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const VIEW_TYPE = 'onegayi.vsidian.editor'
const EXPORT_COMMAND = 'onegayi.vsidian.pdfExport.currentDocument'
const wsDir = process.env['WORKSPACE_DIR'] ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''
if (!wsDir) {
  throw new Error('工作区根不可得：WORKSPACE_DIR 未设置且无工作区文件夹')
}
const wsUri = (name: string): vscode.Uri => vscode.Uri.file(`${wsDir}/${name}`)

interface ModalInfo {
  open: boolean
  phase: 'idle' | 'generating' | 'saving' | 'done' | 'failed' | 'cancelled'
  generation: number
  docName: string
  capturedVersion: number
  savedPath: string | undefined
  failReason: string | undefined
  failDetail: string | undefined
  lastHtml: string | undefined
  lastPaint: unknown
  hookedSaveTarget: string | undefined
}

interface PaintReport {
  docNameText: string
  paperSelect: { visible: boolean; display: string; color: string } | null
  orientationSelect: { visible: boolean; display: string; color: string } | null
  marginInput: { visible: boolean; display: string; color: string } | null
  scaleRange: { visible: boolean; display: string; color: string } | null
  runButton: { visible: boolean; display: string; color: string } | null
  runButtonDisabled: boolean | null
  statusText: string
  status: { visible: boolean; display: string; color: string } | null
}

async function poll<T>(label: string, fn: () => T | undefined | Promise<T | undefined>, timeoutMs = 20000): Promise<T> {
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

/** NFKC 归一（中文文本匹配前置；V01 §7 部首兼容码位坑的已知面） */
function normalizePdfText(text: string): string {
  return text.normalize('NFKC')
}

export const pdfExportT01Cases: Array<[string, () => Promise<void>]> = [
  ['PDF 导出模态（#621 T01）：命令打开、参数控件绘制层可见与重复开关', async () => {
    await openDocAndWait('pdf-export.md')
    const ok = await vscode.commands.executeCommand(EXPORT_COMMAND)
    assert.equal(ok, true, '当前文档命令应成功打开模态')

    // 绘制层断言：控件真实可见（offsetParent 命中 + 计算样式非 none），
    // 非 DOM 存在性——样式注入失效时（CSP 拦截等）此断言如实失败。
    // T02 起固定输入捕获含嵌入预取/样式快照（异步），轮询同时等捕获完成
    //（docName 就位）与绘制层探针
    const state = await poll('模态绘制层探针就位', async () => {
      const info = await modalState()
      if (info.open && info.docName === 'pdf-export.md' && info.lastPaint !== undefined) {
        const paint = info.lastPaint as PaintReport
        if (paint.paperSelect && paint.runButton) return info
      }
      return undefined
    })
    const paint = state.lastPaint as PaintReport
    assert.equal(state.docName, 'pdf-export.md', '模态应显示固定输入文档名')
    assert.ok(state.capturedVersion >= 1, '固定输入应记录权威版本')
    assert.equal(paint.docNameText, 'pdf-export.md')
    assert.equal(paint.paperSelect?.visible, true, '纸张控件应可见（绘制层）')
    assert.equal(paint.paperSelect.display, 'block', '纸张控件计算 display 非 none')
    assert.ok(paint.paperSelect.color.includes('('), '纸张控件计算颜色已解析（非默认值）')
    assert.equal(paint.orientationSelect?.visible, true, '方向控件应可见')
    assert.equal(paint.marginInput?.visible, true, '边距控件应可见')
    assert.equal(paint.scaleRange?.visible, true, '缩放控件应可见')
    assert.equal(paint.runButton?.visible, true, '导出按钮应可见')
    assert.notEqual(paint.runButtonDisabled, true, '导出按钮初始可用')
    assert.ok(paint.statusText.length > 0, '状态区应有阶段文案')

    // 关闭 → 重复打开：资源回收（面板态健康、代次归零重开）
    await closeActiveEditor()
    const afterClose = await modalState()
    assert.equal(afterClose.open, false, '关闭后模态应注销')
    const okAgain = await vscode.commands.executeCommand(EXPORT_COMMAND)
    assert.equal(okAgain, true, '重复打开命令应成功')
    await poll('重复打开后模态就绪', async () => {
      const info = await modalState()
      return info.open ? true : undefined
    })
    const reopened = await modalState()
    assert.ok(['idle', 'done', 'cancelled', 'failed'].includes(reopened.phase), `重复打开后无在途任务（实际 ${reopened.phase}）`)
    await closeActiveEditor()
  }],

  ['PDF 导出（#621 T01）：固定输入、真实浏览器生成与本机保存（多页中文 PDF）', async () => {
    // 前置：本机可用浏览器（V01 三通道发现）；无浏览器时如实 SKIP——
    // 该环境此链路未验证，不以 SKIP 冒充通过（CI windows runner 预装 Edge）
    const { resolveExportBrowser } = await import('../../../src/host/pdfExport/browserFind')
    const browser = await resolveExportBrowser(undefined)
    if (!browser.ok) {
      console.log('[集成测试][SKIP] 无可用 Chrome/Edge，PDF 真实生成链路本环境未验证（#621 T01）')
      return
    }
    console.log(`[集成测试] PDF 后端：${browser.browser.kind} @ ${browser.browser.executablePath}`)

    await openDocAndWait('pdf-export.md')
    const doc = await vscode.workspace.openTextDocument(wsUri('pdf-export.md'))

    await vscode.commands.executeCommand(EXPORT_COMMAND)
    await poll('固定输入捕获就位', async () => {
      const info = await modalState()
      return info.capturedVersion >= 1 && info.docName === 'pdf-export.md' ? info : undefined
    })
    const capturedVersion = (await modalState()).capturedVersion

    // 生成期间追加文本：不应混入本次固定输入（规格 §2.1）
    const appendMarker = '导出后追加段：不应出现在 PDF 中'
    const edit = new vscode.WorkspaceEdit()
    const end = new vscode.Position(doc.lineCount, 0)
    edit.insert(wsUri('pdf-export.md'), end, `\n${appendMarker}\n`)
    assert.ok(await vscode.workspace.applyEdit(edit), '追加编辑应成功')
    const docAfterAppend = await vscode.workspace.openTextDocument(wsUri('pdf-export.md'))
    await poll('追加落地', async () => docAfterAppend.getText().includes(appendMarker) ? true : undefined)
    assert.ok(docAfterAppend.version > capturedVersion, '追加后权威版本应前进')

    // 经正式消息入口发起导出（A4 纵向 20mm 100%——纸张参数真实传递）
    await vscode.commands.executeCommand('onegayi.vsidian._test.injectPdfExportModalMessage', {
      kind: 'pdfExportModal.run',
      params: { paper: 'a4', orientation: 'portrait', marginMm: 20, scale: 1 },
    })
    const done = await poll('导出完成', async () => {
      const info = await modalState()
      if (info.phase === 'failed') {
        throw new Error(`导出失败分态：${info.failReason ?? 'unknown'}（generation ${info.generation}）：${info.failDetail ?? ''}；lastHtml ${info.lastHtml ? info.lastHtml.length : 'absent'} 字节`)
      }
      return info.phase === 'done' && info.savedPath ? info : undefined
    }, 150000)

    // 固定输入：PDF 不含追加文本；源文零改动零撤销（version 不再前进）
    assert.ok(done.savedPath, '应有保存路径')
    const docFinal = await vscode.workspace.openTextDocument(wsUri('pdf-export.md'))
    assert.equal(docFinal.version, docAfterAppend.version, '导出不得产生文档变更（无新增撤销记录）')
    assert.ok(docFinal.getText().includes(appendMarker), '源文保持追加后状态（导出不回写）')

    // 产物断言：pdfjs 页数 / 首中末段中文文本 / 尾部标记 / A4 纵向几何
    const bytes = Buffer.from(await readFile(done.savedPath!))
    assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-', '产物应为 PDF 字节')
    const text = await extractPdfTextWithPages(bytes)
    const whole = normalizePdfText(text.pages.join('\n'))
    assert.ok(text.pageCount >= 2, `多页断言（实际 ${text.pageCount} 页）`)
    assert.ok(whole.includes('中文导出样例标题'), '首页中文标题应入版')
    assert.ok(whole.includes('列表项甲'), '列表应入版')
    assert.ok(/项目|纸张/.test(whole), '表格列头应入版')
    assert.ok(whole.includes('PDF-EXPORT-TAIL-MARKER'), '末段标记应完整保留（多页尾段）')
    assert.ok(whole.includes('正文填充行'), '中段正文应入版')
    assert.ok(!whole.includes('导出后追加段'), '生成期间追加不得混入固定输入')
    // A4 纵向几何（V01 §6 口径：595.92×841.92pt ±2）
    assert.ok(Math.abs(text.widthPt - 595.92) <= 2 && Math.abs(text.heightPt - 841.92) <= 2,
      `A4 纵向纸张参数应生效（实际 ${text.widthPt}×${text.heightPt}pt）`)

    // 关闭模态（任务已结束）→ 重复开关健康
    await closeActiveEditor()
    assert.equal((await modalState()).open, false)
    await vscode.commands.executeCommand(EXPORT_COMMAND)
    await poll('重开模态', async () => (await modalState()).open ? true : undefined)
    await closeActiveEditor()
  }],
]

/** pdfjs-dist legacy（node 侧）文本与首页几何提取。宿主 Node 18.15 缺
 *  Promise.withResolvers——先补 polyfill（#334 探针 banner 同款）。 */
async function extractPdfTextWithPages(bytes: Buffer): Promise<{ pages: string[]; pageCount: number; widthPt: number; heightPt: number }> {
  if (typeof (Promise as unknown as { withResolvers?: unknown }).withResolvers !== 'function') {
    ;(Promise as unknown as { withResolvers: () => unknown }).withResolvers = function withResolvers() {
      let resolve!: (value: unknown) => void
      let reject!: (reason?: unknown) => void
      const promise = new Promise((res, rej) => { resolve = res; reject = rej })
      return { promise, resolve, reject }
    }
  }
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  // node 侧 fake worker：workerSrc 指向 node_modules 实际产物（绝对路径的
  // 动态 import 由 pdfjs 装载器执行，不经 esbuild 静态打包——suite bundle
  // 不吞 worker 体积）
  const { createRequire } = await import('node:module')
  const { pathToFileURL } = await import('node:url')
  // suite 产物为 cjs：__filename 恒在，createRequire 以其为锚解析 node_modules；
  // Windows 绝对路径（D:\…）不是合法 ESM 说明符——转 file:// URL
  const workerPath = createRequire(__filename).resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise
  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    pages.push(content.items.map((item) => 'str' in item ? item.str : '').join(''))
  }
  const first = await doc.getPage(1)
  const viewport = first.getViewport({ scale: 1 })
  return { pages, pageCount: doc.numPages, widthPt: viewport.width, heightPt: viewport.height }
}
