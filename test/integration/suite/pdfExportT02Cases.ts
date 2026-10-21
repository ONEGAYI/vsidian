// T02（#622）PDF 导出集成用例（真实浏览器链路——沿 T01 sensitive 组先例）：
// 1. 完整阅读装配：长文档首中末段（不依赖视口）、嵌入目标（含未保存）展开、
//    媒体降级真实链接、缺失资源失败清单 + 继续导出、图片/公式/mermaid
//    绘制证据（pdfjs 图像 XObject + 失败面无 graphic 条目）、导出页整页
//    截图视觉证据（out/test/）；
// 2. 取消释放：生成中取消 → cancelled/user、无产物落盘、重复执行健康。
// PDF 文本断言经 pdfjs-dist legacy（node 侧 getTextContent）；中文匹配先
// NFKC 归一（V01 §7 部首兼容码位坑）。无可用浏览器环境如实 SKIP 留痕。
import * as vscode from 'vscode'
import * as assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { exportFailFastError, extractPdfEvidence } from './pdfExportEvidence'

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
  cancelKind: 'user' | 'save-dialog' | undefined
  lastHtml: string | undefined
  lastPaint: unknown
  hookedSaveTarget: string | undefined
  resourceIssues: ReadonlyArray<{ kind: string; item: string; reason: string }> | undefined
  embedStats: { embeds: number; mediaEmbeds: number; failures: number } | undefined
  lastSnapshot: string | undefined
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

function normalizePdfText(text: string): string {
  return text.normalize('NFKC')
}

export const pdfExportT02Cases: Array<[string, () => Promise<void>]> = [
  ['PDF 导出（#622 T02）：完整装配、嵌入展开、缺资源选择与绘制证据', async () => {
    const { resolveExportBrowser } = await import('../../../src/host/pdfExport/browserFind')
    const browser = await resolveExportBrowser(undefined)
    if (!browser.ok) {
      console.log('[集成测试][SKIP] 无可用 Chrome/Edge，T02 完整装配链路本环境未验证（#622）')
      return
    }

    // 嵌入目标注入未保存修改（applyEdit 不保存——固定输入含未保存语义）
    const embedUri = wsUri('pdf-export-t02-embed.md')
    const embedDoc = await vscode.workspace.openTextDocument(embedUri)
    const unsavedMarker = 'EMBED-UNSAVED-TEXT（未保存注入）'
    const edit = new vscode.WorkspaceEdit()
    edit.insert(embedUri, new vscode.Position(embedDoc.lineCount, 0), `\n嵌入目标未保存段：${unsavedMarker}\n`)
    assert.ok(await vscode.workspace.applyEdit(edit), '嵌入目标未保存编辑应成功')

    await openDocAndWait('pdf-export-t02.md')
    await vscode.commands.executeCommand(EXPORT_COMMAND)
    const captured = await poll('固定输入捕获（含嵌入预取）', async () => {
      const info = await modalState()
      return info.docName === 'pdf-export-t02.md' && info.capturedVersion >= 1 && info.embedStats !== undefined ? info : undefined
    })
    // 超集预取观测：1 个 markdown 嵌入 + 1 个媒体嵌入身份
    assert.equal(captured.embedStats?.embeds, 1, '应预取 1 个 markdown 嵌入目标')
    assert.equal(captured.embedStats?.mediaEmbeds, 1, '应登记 1 个媒体嵌入身份')

    await vscode.commands.executeCommand('onegayi.vsidian._test.injectPdfExportModalMessage', {
      kind: 'pdfExportModal.run',
      params: { paper: 'a4', orientation: 'portrait', marginMm: 18, scale: 1 },
    })
    // 缺资源选择：缺失图进失败清单（not-found）；继续导出
    const awaiting = await poll('awaiting-resources（缺失资源清单）', async () => {
      const info = await modalState()
      const fail = exportFailFastError(info)
      if (fail !== undefined) throw fail
      return info.phase === 'awaiting-resources' ? info : undefined
    }, 120000)
    assert.ok(awaiting.resourceIssues?.some((issue) => issue.kind === 'image' && issue.item.includes('pdf-t02-missing.png') && issue.reason === 'not-found'),
      `失败清单应含缺失图 not-found（实际 ${JSON.stringify(awaiting.resourceIssues)}）`)
    assert.ok(!awaiting.resourceIssues?.some((issue) => issue.kind === 'graphic'),
      'mermaid 渲染成功不应有 graphic 失败项')

    await vscode.commands.executeCommand('onegayi.vsidian._test.injectPdfExportModalMessage', {
      kind: 'pdfExportModal.resume',
    })
    const done = await poll('继续导出后完成', async () => {
      const info = await modalState()
      const fail = exportFailFastError(info)
      if (fail !== undefined) throw fail
      return info.phase === 'done' && info.savedPath ? info : undefined
    }, 120000)

    // 视觉证据：就绪后导出页整页截图（正文/图片/图形绘制层呈现）。
    // 落盘位置：钩子保存目标同目录（测试临时目录，随轮次保留供人工核验）；
    // T02_EVIDENCE_DIR 可覆盖为工作树内目录
    assert.ok(done.lastSnapshot, '测试钩子应携带导出页整页截图')
    const evidenceDir = process.env['T02_EVIDENCE_DIR'] ?? path.dirname(done.savedPath!)
    await mkdir(evidenceDir, { recursive: true }).catch(() => undefined)
    const snapshotPath = path.join(evidenceDir, 'pdf-export-t02-page.png')
    await writeFile(snapshotPath, Buffer.from(done.lastSnapshot!, 'base64'))
    console.log(`[集成测试] T02 视觉证据：${snapshotPath}`)

    // 产物断言：pdfjs 文本（首末段/嵌入展开含未保存/媒体真实链接）+ 图像 XObject
    const bytes = Buffer.from(await readFile(done.savedPath!))
    assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-', '产物应为 PDF 字节')
    const { pages, pageCount, widthPt, heightPt, imageXObjectCount } = await extractPdfEvidence(bytes)
    const whole = normalizePdfText(pages.join('\n'))
    // 断言辅助：pdfjs 的 text run 切分与跨页换行会打断子串匹配——关键
    // 断言同时用去空白形态复核（空白不参与语义）
    const dense = whole.replace(/\s/g, '')
    assert.ok(pageCount >= 2, `多页断言（实际 ${pageCount} 页）`)
    assert.ok(whole.includes('PDF-T02-HEAD-MARKER'), '首段标记应入版（不依赖视口）')
    assert.ok(whole.includes('PDF-T02-TAIL-MARKER'), '末段标记应入版（不依赖视口）')
    assert.ok(dense.includes('填充段20'), '中段填充正文应入版')
    assert.ok(whole.includes('EMBED-BASE-TEXT'), '嵌入目标预置正文应展开')
    assert.ok(dense.includes('EMBED-UNSAVED-TEXT'), '嵌入目标未保存内容应进入本次结果')
    assert.ok(whole.includes('pdf-export-t02-clip.mp4'), '媒体降级说明应含真实文件名链接')
    assert.ok(whole.includes('https://example.com/t02-clip.mp4'), 'HTML video 降级应含远端原链接')
    assert.ok(!whole.includes('graph TD; Start-->Check;'), 'mermaid 渲染成功后源码不应以文本呈现')
    assert.ok(imageXObjectCount >= 1, `本地图应以图像 XObject 入版（实际 ${imageXObjectCount}）`)
    assert.ok(Math.abs(widthPt - 595.92) <= 2 && Math.abs(heightPt - 841.92) <= 2,
      `A4 纵向几何（实际 ${widthPt}×${heightPt}pt）`)
    // 源文零回写：嵌入目标保持未保存（导出不触发保存）
    const embedAfter = await vscode.workspace.openTextDocument(embedUri)
    assert.ok(embedAfter.isDirty, '嵌入目标应保持未保存（导出不强制保存）')
    assert.ok(embedAfter.getText().includes(unsavedMarker), '未保存内容应仍在（不因导出回写丢失）')

    await closeActiveEditor()
  }],

  ['PDF 导出（#622 T02）：生成中取消释放与重复执行健康', async () => {
    const { resolveExportBrowser } = await import('../../../src/host/pdfExport/browserFind')
    const browser = await resolveExportBrowser(undefined)
    if (!browser.ok) {
      console.log('[集成测试][SKIP] 无可用 Chrome/Edge，取消释放链路本环境未验证（#622）')
      return
    }
    await openDocAndWait('pdf-export-t02.md')
    await vscode.commands.executeCommand(EXPORT_COMMAND)
    await poll('固定输入捕获', async () => {
      const info = await modalState()
      return info.capturedVersion >= 1 ? true : undefined
    })
    await vscode.commands.executeCommand('onegayi.vsidian._test.injectPdfExportModalMessage', {
      kind: 'pdfExportModal.run',
      params: { paper: 'a4', orientation: 'portrait', marginMm: 18, scale: 1 },
    })
    // 取消：在 awaiting-resources（或 generating）阶段取消——本 fixture 必达
    // awaiting-resources（缺失图在案）；两种在途阶段取消语义一致
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
    // 重复执行健康：新一轮任务可正常发起
    await vscode.commands.executeCommand('onegayi.vsidian._test.injectPdfExportModalMessage', {
      kind: 'pdfExportModal.run',
      params: { paper: 'a4', orientation: 'portrait', marginMm: 18, scale: 1 },
    })
    await poll('重复发起到达在途或选择阶段', async () => {
      const info = await modalState()
      return info.phase === 'generating' || info.phase === 'awaiting-resources' ? true : undefined
    }, 120000)
    await vscode.commands.executeCommand('onegayi.vsidian._test.injectPdfExportModalMessage', {
      kind: 'pdfExportModal.cancel',
    })
    await poll('第二轮取消终态', async () => {
      const info = await modalState()
      return info.phase === 'cancelled' ? true : undefined
    }, 60000)
    await closeActiveEditor()
  }],
]
