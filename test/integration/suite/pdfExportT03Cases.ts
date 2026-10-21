// T03（#623）选区导出集成用例：
// 1. core（无浏览器）：入口状态机——无选区/阅读模式不开模态（i18n 提示，
//    不误触发全文导出）；Live 多选区 → 命令打开模态并捕获严格片段
//    （fragmentCount 观测）；选区读取与导出入口对选区/源文零干扰。
// 2. sensitive（真实浏览器，沿 T01/T02 先例）：多选区严格切片（半表格/
//    围栏首行只输出选中文字、选区外对照不进入）、文档顺序、选区内相对
//    图片以原文档身份解析（图像 XObject）、pdfjs 可提取文字与范围；
//    取消链路的选区/源文不变式与重复执行健康。
// 选区注入经 sync.test.setSelection（纯 selection 事务：不产生编辑历史、
// 不出站 edit.request——与用户键入形成的选区同一读取路径）。
import * as vscode from 'vscode'
import * as assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { exportFailFastError } from './pdfExportEvidence'

const VIEW_TYPE = 'onegayi.vsidian.editor'
const SELECTION_EXPORT_COMMAND = 'onegayi.vsidian.pdfExport.selection'
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
  cancelKind: 'user' | 'save-dialog' | undefined
  lastHtml: string | undefined
  lastPaint: unknown
  hookedSaveTarget: string | undefined
  resourceIssues: ReadonlyArray<{ kind: string; item: string; reason: string }> | undefined
  embedStats: { embeds: number; mediaEmbeds: number; failures: number } | undefined
  fragmentCount: number
  lastSnapshot: string | undefined
}

interface ViewStateInfo {
  viewMode?: 'live' | 'reading'
  selectionOffset?: number
  selectionHead?: number
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

async function viewState(name: string): Promise<ViewStateInfo | undefined> {
  return vscode.commands.executeCommand('onegayi.vsidian._test.requestViewState', wsUri(name).toString()) as
    Promise<ViewStateInfo | undefined>
}

/** 权威 LF 全文（面板 CM6 与切片基准同源——协议 LF 坐标约定） */
async function lfTextOf(name: string): Promise<string> {
  const doc = await vscode.workspace.openTextDocument(wsUri(name))
  return doc.getText().replace(/\r\n?/g, '\n')
}

async function setSelection(name: string, ranges: Array<{ anchor: number; head: number }>): Promise<void> {
  await vscode.commands.executeCommand('onegayi.vsidian._test.postToPanel', wsUri(name).toString(), {
    kind: 'sync.test.setSelection',
    ranges,
  })
  // 纯 selection 事务即时生效；小间隔避免消息竞态
  await new Promise((r) => setTimeout(r, 150))
}

async function closeActiveEditor(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
  await new Promise((r) => setTimeout(r, 250))
}

function normalizePdfText(text: string): string {
  return text.normalize('NFKC')
}

/** T03 样例的四个选区（按文档顺序）：半表格行内容、围栏首行、列表项、图片段 */
function t03SelectionRanges(text: string): Array<{ anchor: number; head: number }> {
  const rangeOf = (needle: string): { anchor: number; head: number } => {
    const at = text.indexOf(needle)
    assert.ok(at >= 0, `fixture 应含 ${needle}`)
    return { anchor: at, head: at + needle.length }
  }
  // 文档顺序：表格行 → 列表 → 围栏首行 → 图片段
  return [
    rangeOf('T3-CELL-A | T3-CELL-B'),
    rangeOf('- T3-LIST-ALPHA'),
    rangeOf('T3-FENCE-FIRST = 1'),
    rangeOf('T03-IMG 段：![选区图](assets/pdf-t03-img.png)'),
  ]
}

export const pdfExportT03Cases: Array<[string, () => Promise<void>]> = [
  ['PDF 导出（#623 T03）：选区入口状态、片段捕获与选区零干扰（core）', async () => {
    await openDocAndWait('pdf-export-t03.md')
    const text = await lfTextOf('pdf-export-t03.md')

    // 1) 无选区（打开即单光标）：命令拒绝，不打开/不刷新模态（不误触发全文导出）
    const rejected = await vscode.commands.executeCommand(SELECTION_EXPORT_COMMAND)
    assert.equal(rejected, false, '无选区时选区导出命令应返回 false')
    const afterEmpty = await modalState()
    assert.ok(afterEmpty.open === false || afterEmpty.docName !== 'pdf-export-t03.md',
      `无选区不得打开选区导出模态（open=${afterEmpty.open} docName=${afterEmpty.docName}）`)
    // 拒绝路径零干扰：光标仍在文档开头（入口读取不移动光标/选区）
    const baseline = await viewState('pdf-export-t03.md')
    assert.ok(baseline && baseline.viewMode === 'live', '拒绝后编辑器应仍在实时预览')
    assert.equal(baseline!.selectionOffset, 0, '拒绝路径不得移动光标')
    assert.equal(baseline!.selectionHead, 0, '拒绝路径不得移动光标')

    // 2) 阅读模式：无选区交互语义（隐藏 CM6 的陈旧选区不冒充）——入口拒绝
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toReading')
    await poll('进入阅读模式', async () => {
      const state = await viewState('pdf-export-t03.md')
      return state?.viewMode === 'reading' ? true : undefined
    })
    // 在阅读模式下注入选区（webview 侧忽略——阅读无选区语义）后入口仍拒绝
    await setSelection('pdf-export-t03.md', t03SelectionRanges(text))
    const rejectedReading = await vscode.commands.executeCommand(SELECTION_EXPORT_COMMAND)
    assert.equal(rejectedReading, false, '阅读模式下选区导出命令应返回 false')
    const afterReading = await modalState()
    assert.ok(afterReading.open === false || afterReading.docName !== 'pdf-export-t03.md',
      '阅读模式不得打开选区导出模态')

    // 3) 回 Live 设置多选区：命令打开模态并捕获严格片段
    await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive')
    await poll('回到实时预览', async () => {
      const state = await viewState('pdf-export-t03.md')
      return state?.viewMode === 'live' ? true : undefined
    })
    const ranges = t03SelectionRanges(text)
    await setSelection('pdf-export-t03.md', ranges)
    // 注入后选区可观测（主选区 = 第一区间；随后命令消费同一读取路径）
    const withSelection = await viewState('pdf-export-t03.md')
    assert.equal(withSelection!.selectionOffset, ranges[0]!.anchor, '选区注入应生效（from）')
    assert.equal(withSelection!.selectionHead, ranges[0]!.head, '选区注入应生效（head）')
    const accepted = await vscode.commands.executeCommand(SELECTION_EXPORT_COMMAND)
    assert.equal(accepted, true, 'Live 有效多选区命令应成功')
    const captured = await poll('选区片段捕获', async () => {
      const info = await modalState()
      return info.open && info.docName === 'pdf-export-t03.md' && info.capturedVersion >= 1 && info.fragmentCount > 0
        ? info : undefined
    })
    // 4 个选区（均为非空区间）→ 4 个片段；纯光标剔除
    assert.equal(captured.fragmentCount, 4, `应捕获 4 个选区片段（实际 ${captured.fragmentCount}）`)

    // 4) 源文零干扰：捕获与模态打开不产生编辑（文档保持 clean、版本不推进；
    //    选区不被移动的证据在 webviewSync 单测「零副作用」——模态打开后编辑
    //    器 tab 隐藏、webview 挂起，选区在此处不可再观测，不伪造断言）
    // 源文不变：文档保持 clean、版本与打开时一致（无编辑事务——零写回）
    const doc = await vscode.workspace.openTextDocument(wsUri('pdf-export-t03.md'))
    assert.ok(!doc.isDirty, '选区导出入口不得产生未保存修改')
    assert.equal(doc.version, captured.capturedVersion, '选区导出入口不得推进文档版本')

    await closeActiveEditor()
  }],

  ['PDF 导出（#623 T03）：多选区严格切片、顺序与资源同源的真浏览器产物', async () => {
    const { resolveExportBrowser } = await import('../../../src/host/pdfExport/browserFind')
    const browser = await resolveExportBrowser(undefined)
    if (!browser.ok) {
      console.log('[集成测试][SKIP] 无可用 Chrome/Edge，T03 选区导出真浏览器链路本环境未验证（#623）')
      return
    }

    await openDocAndWait('pdf-export-t03.md')
    const text = await lfTextOf('pdf-export-t03.md')
    const capturedVersionBaseline = (await vscode.workspace.openTextDocument(wsUri('pdf-export-t03.md'))).version
    const ranges = t03SelectionRanges(text)
    await setSelection('pdf-export-t03.md', ranges)
    const accepted = await vscode.commands.executeCommand(SELECTION_EXPORT_COMMAND)
    assert.equal(accepted, true, 'Live 多选区命令应成功')
    await poll('选区片段捕获', async () => {
      const info = await modalState()
      return info.open && info.docName === 'pdf-export-t03.md' && info.fragmentCount === 4 ? info : undefined
    })

    await vscode.commands.executeCommand('onegayi.vsidian._test.injectPdfExportModalMessage', {
      kind: 'pdfExportModal.run',
      params: { paper: 'a4', orientation: 'portrait', marginMm: 18, scale: 1 },
    })
    const done = await poll('选区导出完成', async () => {
      const info = await modalState()
      const fail = exportFailFastError(info)
      if (fail !== undefined) throw fail
      return info.phase === 'done' && info.savedPath ? info : undefined
    }, 120000)

    // 视觉证据：就绪后导出页整页截图（片段群/图片绘制层呈现）
    assert.ok(done.lastSnapshot, '测试钩子应携带导出页整页截图')
    const evidenceDir = process.env['T03_EVIDENCE_DIR'] ?? path.dirname(done.savedPath!)
    await mkdir(evidenceDir, { recursive: true }).catch(() => undefined)
    const snapshotPath = path.join(evidenceDir, 'pdf-export-t03-page.png')
    await writeFile(snapshotPath, Buffer.from(done.lastSnapshot!, 'base64'))
    console.log(`[集成测试] T03 视觉证据：${snapshotPath}`)

    // 产物断言：只含实际选中文字；选区外对照不进入；顺序符合源文
    const bytes = Buffer.from(await readFile(done.savedPath!))
    assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-', '产物应为 PDF 字节')
    const { extractPdfEvidence } = await import('./pdfExportEvidence')
    const { pages, imageXObjectCount, widthPt, heightPt } = await extractPdfEvidence(bytes)
    const whole = normalizePdfText(pages.join('\n'))
    const dense = whole.replace(/\s/g, '')
    // 半表格行：只输出实际选中文字（无表头/相邻行）
    assert.ok(dense.includes('T3-CELL-A|T3-CELL-B'), '半表格行选中内容应入版')
    assert.ok(!whole.includes('T3A'), '表头行（选区外）不得进入')
    assert.ok(!whole.includes('T3-CELL-C'), '相邻表格行（选区外）不得进入')
    // 围栏首行：只输出实际选中文字（第二行代码选区外不进入）
    assert.ok(whole.includes('T3-FENCE-FIRST = 1'), '围栏首行选中内容应入版')
    assert.ok(!whole.includes('T3-FENCE-SECOND'), '围栏第二行（选区外）不得进入')
    // 列表与图片段入版；选区外首尾段不进入
    assert.ok(dense.includes('T3-LIST-ALPHA'), '列表片段应入版')
    assert.ok(dense.includes('T03-IMG'), '图片段片段应入版')
    assert.ok(!whole.includes('T03-OUTSIDE-HEAD'), '选区外首段不得进入')
    assert.ok(!whole.includes('T03-OUTSIDE-TAIL'), '选区外尾段不得进入')
    // 多选区顺序：表格片段 → 围栏片段 → 列表片段 → 图片段（源文顺序）
    const order = ['T3-CELL-A', 'T3-LIST-ALPHA', 'T3-FENCE-FIRST', 'T03-IMG'].map((m) => whole.indexOf(m))
    assert.ok(order.every((i) => i >= 0), `顺序断言的标记应全部入版（${JSON.stringify(order)}）`)
    assert.ok(order[0]! < order[1]! && order[1]! < order[2]! && order[2]! < order[3]!,
      `多选区应按文档顺序输出（${JSON.stringify(order)}）`)
    // 选区内相对图片以原文档身份解析（同源资源服务）——图像 XObject 入版
    assert.ok(imageXObjectCount >= 1, `选区内图片应以图像 XObject 入版（实际 ${imageXObjectCount}）`)
    assert.ok(Math.abs(widthPt - 595.92) <= 2 && Math.abs(heightPt - 841.92) <= 2,
      `A4 纵向几何（实际 ${widthPt}×${heightPt}pt）`)

    // 导出后不变式：源文不受导出影响（保持 clean、版本不推进）。选区不
    // 被移动的证据在 webviewSync 单测「零副作用」；模态在场使编辑器 tab
    // 隐藏、webview 挂起，此处选区不可观测，不伪造断言
    const doc = await vscode.workspace.openTextDocument(wsUri('pdf-export-t03.md'))
    assert.ok(!doc.isDirty, '导出不得产生未保存修改')
    assert.equal(doc.version, capturedVersionBaseline, '导出不得推进文档版本')

    await closeActiveEditor()
  }],

  ['PDF 导出（#623 T03）：选区导出取消释放与选区/源文不变式', async () => {
    const { resolveExportBrowser } = await import('../../../src/host/pdfExport/browserFind')
    const browser = await resolveExportBrowser(undefined)
    if (!browser.ok) {
      console.log('[集成测试][SKIP] 无可用 Chrome/Edge，T03 取消链路本环境未验证（#623）')
      return
    }

    await openDocAndWait('pdf-export-t03.md')
    const text = await lfTextOf('pdf-export-t03.md')
    const capturedVersionBaseline = (await vscode.workspace.openTextDocument(wsUri('pdf-export-t03.md'))).version
    const ranges = t03SelectionRanges(text)
    await setSelection('pdf-export-t03.md', ranges)
    const accepted = await vscode.commands.executeCommand(SELECTION_EXPORT_COMMAND)
    assert.equal(accepted, true, 'Live 多选区命令应成功')
    await poll('选区片段捕获', async () => {
      const info = await modalState()
      return info.open && info.fragmentCount === 4 ? true : undefined
    })
    await vscode.commands.executeCommand('onegayi.vsidian._test.injectPdfExportModalMessage', {
      kind: 'pdfExportModal.run',
      params: { paper: 'a4', orientation: 'portrait', marginMm: 18, scale: 1 },
    })
    await poll('任务进入在途阶段', async () => {
      const info = await modalState()
      return info.phase === 'generating' || info.phase === 'awaiting-resources' ? true : undefined
    }, 120000)
    await vscode.commands.executeCommand('onegayi.vsidian._test.injectPdfExportModalMessage', {
      kind: 'pdfExportModal.cancel',
    })
    const cancelled = await poll('取消终态', async () => {
      const info = await modalState()
      return info.phase === 'cancelled' ? info : undefined
    }, 60000)
    assert.equal(cancelled.cancelKind, 'user')
    assert.equal(cancelled.hookedSaveTarget, undefined, '取消路径不得落盘产物')

    // 取消不变式：源文不变（文档保持 clean、版本不推进——取消零写回）。
    // 选区不被移动的证据在 webviewSync 单测「零副作用」；模态在场时编辑器
    // webview 挂起，此处不伪造选区观测
    const doc = await vscode.workspace.openTextDocument(wsUri('pdf-export-t03.md'))
    assert.ok(!doc.isDirty, '取消不得产生未保存修改')
    assert.equal(doc.version, capturedVersionBaseline, '取消不得推进文档版本')

    // 重复执行健康：取消后可再次发起（新一轮固定输入）
    await vscode.commands.executeCommand('onegayi.vsidian._test.injectPdfExportModalMessage', {
      kind: 'pdfExportModal.run',
      params: { paper: 'a4', orientation: 'portrait', marginMm: 18, scale: 1 },
    })
    await poll('第二轮任务可发起', async () => {
      const info = await modalState()
      return info.phase === 'generating' || info.phase === 'awaiting-resources' || info.phase === 'saving' || info.phase === 'done' ? true : undefined
    }, 120000)
    const info = await modalState()
    if (info.phase !== 'done') {
      await vscode.commands.executeCommand('onegayi.vsidian._test.injectPdfExportModalMessage', {
        kind: 'pdfExportModal.cancel',
      })
      await poll('第二轮取消终态', async () => (await modalState()).phase === 'cancelled' ? true : undefined, 60000)
    }
    await closeActiveEditor()
  }],
]
