// T04（#624）批量 PDF 导出集成用例：
// 1. core：模态批量清单编辑（收集/非 Markdown 排除/增删调序）与映射预览
//    （相对结构/批内同名/三策略）——绘制层断言（模态 webview 探针），无
//    浏览器依赖；
// 2. sensitive（真实浏览器链路，沿 T01/T02 敏感组先例）：批量执行、相对
//    结构、同名自动更名、已打开未保存内容、skip 保护已有文件、单项失败
//    继续其余、缺资源 resume-all 与中途取消保留已完成。
import * as vscode from 'vscode'
import * as assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const VIEW_TYPE = 'onegayi.vsidian.editor'
const BATCH_COMMAND = 'onegayi.vsidian.pdfExport.batch'
const wsDir = process.env['WORKSPACE_DIR'] ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ''
if (!wsDir) {
  throw new Error('工作区根不可得：WORKSPACE_DIR 未设置且无工作区文件夹')
}
const wsUri = (name: string): vscode.Uri => vscode.Uri.file(`${wsDir}/${name}`)
const norm = (p: string): string => p.replaceAll('\\', '/')

interface BatchModalInfo {
  open: boolean
  lastPaint: unknown
  batch: {
    mode: 'document' | 'batch'
    phase: 'editing' | 'confirm' | 'running' | 'awaiting-resources' | 'done' | 'cancelled' | 'failed'
    items: Array<{ id: string; fsPath: string; rootFsPath: string; relPath: string }>
    mapping: Array<{ id: string; fsPath: string; targetPath: string; action: 'export' | 'skip'; conflict: string; renamed: boolean; skipReason?: string }> | undefined
    targetDir: string | undefined
    strategy: 'skip' | 'overwrite' | 'rename'
    currentIndex: number
    total: number
    results: Array<{ id: string; fsPath: string; docName: string; status: string; targetPath?: string; failReason?: string; skipReason?: string }>
    resourceIssues: ReadonlyArray<{ kind: string; item: string; reason: string }> | undefined
    failReason: string | undefined
    hookedTargetDir: string | undefined
  } | undefined
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

async function modalState(): Promise<BatchModalInfo> {
  return vscode.commands.executeCommand('onegayi.vsidian._test.getPdfExportModalState') as Promise<BatchModalInfo>
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

async function closeActiveEditor(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
  await new Promise((r) => setTimeout(r, 250))
}

function normalizePdfText(text: string): string {
  return text.normalize('NFKC')
}

async function extractPdfText(bytes: Buffer): Promise<{ pages: string[]; pageCount: number }> {
  // Node 18 宿主无 Promise.withResolvers（pdfjs-dist 需要）——同款 polyfill
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
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise
  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    pages.push(content.items.map((item) => 'str' in item ? item.str : '').join(''))
  }
  return { pages, pageCount: doc.numPages }
}

const paintOf = (info: BatchModalInfo): Record<string, unknown> =>
  (info.lastPaint ?? {}) as Record<string, unknown>

const visible = (probe: unknown): boolean => {
  if (probe === null || probe === undefined) return false
  const p = probe as { visible?: boolean; display?: string }
  return p.visible === true && p.display !== 'none'
}

export const pdfExportT04Cases: Array<[string, () => Promise<void>]> = [
  ['PDF 导出（#624 T04）：批量清单编辑、非 Markdown 排除与映射预览三策略（core 绘制层）', async () => {
    // 用例隔离：关闭上一用例可能遗留的模态/面板（openBatch 为新会话语义，
    // 但显式清场防御跨用例泄漏）
    await vscode.commands.executeCommand('workbench.action.closeAllEditors').then(() => undefined, () => undefined)
    await new Promise((r) => setTimeout(r, 200))
    await vscode.commands.executeCommand(BATCH_COMMAND)
    await poll('批量模态打开（editing 空清单）', async () => {
      const info = await modalState()
      return info.batch?.phase === 'editing' && info.batch.items.length === 0 ? true : undefined
    })

    // 目录收集：递归 + 非 Markdown 排除（note.txt / pic.png 不入清单）
    await inject({ kind: 'pdfExportModal.batch.addDir', path: norm(path.join(wsDir, 'pdf-batch/dir1')) })
    const dir1 = await poll('dir1 收集（a.md + sub/b.md，非 Markdown 排除）', async () => {
      const info = await modalState()
      return info.batch?.items.length === 2 ? info.batch : undefined
    })
    assert.deepEqual(dir1.items.map((i) => i.relPath), ['a.md', 'sub/b.md'], '递归收集应只含 Markdown 并按稳定序排列')
    assert.ok(!dir1.items.some((i) => /note\.txt|pic\.png/.test(i.fsPath)), '非 Markdown 不应进入清单')

    // 单文件添加：dir2/a.md 入列；dir1/a.md 重复回灌不增条目（去重语义）
    await inject({ kind: 'pdfExportModal.batch.addFiles', paths: [norm(path.join(wsDir, 'pdf-batch/dir2/a.md')), norm(path.join(wsDir, 'pdf-batch/dir1/a.md'))] })
    const three = await poll('单文件添加与去重（3 条）', async () => {
      const info = await modalState()
      return info.batch?.items.length === 3 ? info.batch : undefined
    })
    assert.equal(three.items[2]!.relPath, 'a.md', 'dir2/a.md 应入列')

    // 绘制层断言：清单条目文本与添加按钮可见（用户看到的东西）
    await poll('绘制层探针上报清单', async () => {
      const info = await modalState()
      const paint = paintOf(info)
      const rels = paint['batchItemRels'] as string[] | undefined
      return rels && rels.length === 3 ? paint : undefined
    }).then((paint) => {
      const rels = paint['batchItemRels'] as string[]
      assert.ok(rels.includes('sub/b.md') && rels.filter((r) => r === 'a.md').length === 2, `清单行文本应含全部条目（实际 ${JSON.stringify(rels)}）`)
      const addButtons = paint['batchAddButtons'] as unknown[]
      assert.equal(addButtons.length, 2, '添加文件/添加目录两按钮应在场')
      assert.ok(addButtons.every(visible), '添加按钮应可见（offsetParent 命中）')
    })

    // 调序：首条下移 → 顺序真实变化（顺序即执行顺序）
    const firstId = three.items[0]!.id
    await inject({ kind: 'pdfExportModal.batch.move', id: firstId, direction: 'down' })
    await poll('调序生效', async () => {
      const batch = (await modalState()).batch
      return batch && batch.items[0]!.id !== firstId && batch.items[1]!.id === firstId ? true : undefined
    })

    // 删除一条（dir1/sub/b.md——按 id 删）：3 条 → 2 条
    const current = (await modalState()).batch
    assert.ok(current, '批量状态应在场')
    const removeId = current.items.find((i) => i.relPath === 'sub/b.md')!.id
    await inject({ kind: 'pdfExportModal.batch.remove', id: removeId })
    const afterRemove = await poll('删除生效（2 条）', async () => {
      const info = await modalState()
      return info.batch?.items.length === 2 ? info.batch : undefined
    })
    assert.ok(!afterRemove.items.some((i) => i.relPath === 'sub/b.md'), '删除的条目不应再在场')

    // 映射预览：rename 默认（同名后到者编号）、skip、overwrite 三态
    await inject({ kind: 'pdfExportModal.batch.run' })
    const confirm = await poll('confirm 映射预览', async () => {
      const info = await modalState()
      return info.batch?.phase === 'confirm' && info.batch.mapping !== undefined ? info.batch : undefined
    })
    assert.ok(confirm.targetDir && confirm.targetDir.length > 0, '应携带目标目录（钩子短路）')
    // 清单序（调序删除后）：dir1/a 在前 → 原名；dir2/a 在后 → 编号。
    // 身份匹配用 endsWith（宿主 Uri 归一后盘符小写，与注入原串可能异形）
    const dir1A = confirm.mapping!.find((m) => norm(m.fsPath).endsWith('pdf-batch/dir1/a.md'))!
    const dir2A = confirm.mapping!.find((m) => norm(m.fsPath).endsWith('pdf-batch/dir2/a.md'))!
    assert.equal(dir1A.conflict, 'duplicate', '批内同名两方均应标注 duplicate')
    assert.equal(dir2A.conflict, 'duplicate', '批内同名两方均应标注 duplicate（双向标注）')
    assert.equal(dir1A.targetPath, `${confirm.targetDir}/a.pdf`, '清单序首条应映射原名')
    assert.equal(norm(dir2A.targetPath), `${norm(confirm.targetDir)}/a (2).pdf`, 'rename 策略应给同名后到者编号路径')
    assert.ok(dir2A.renamed && !dir1A.renamed, '仅后到者标注 renamed')

    await inject({ kind: 'pdfExportModal.batch.setStrategy', strategy: 'skip' })
    const skipMapping = await poll('skip 策略重算', async () => {
      const info = await modalState()
      return info.batch?.strategy === 'skip' && info.batch.mapping?.some((m) => m.action === 'skip') ? info.batch.mapping : undefined
    })
    assert.ok(skipMapping.some((m) => m.action === 'skip' && m.skipReason === 'duplicate'), 'skip 策略应显式跳过同名后到者')

    await inject({ kind: 'pdfExportModal.batch.setStrategy', strategy: 'overwrite' })
    await poll('overwrite 策略重算', async () => {
      const info = await modalState()
      return info.batch?.strategy === 'overwrite' && info.batch.mapping?.every((m) => m.action === 'export') ? true : undefined
    })

    // 返回清单（映射丢弃）
    await inject({ kind: 'pdfExportModal.batch.cancel' })
    await poll('返回 editing', async () => {
      const info = await modalState()
      return info.batch?.phase === 'editing' && info.batch.mapping === undefined ? true : undefined
    })

    await closeActiveEditor()
  }],

  ['PDF 导出（#624 T04）：批量执行、相对结构、同名更名与已打开未保存内容（真浏览器）', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors').then(() => undefined, () => undefined)
    await new Promise((r) => setTimeout(r, 200))
    const { resolveExportBrowser } = await import('../../../src/host/pdfExport/browserFind')
    const browser = await resolveExportBrowser(undefined)
    if (!browser.ok) {
      console.log('[集成测试][SKIP] 无可用 Chrome/Edge，T04 批量执行链路本环境未验证（#624）')
      return
    }

    // 已打开文档注入未保存修改（不保存——批量捕获应取未保存权威文本）
    const docUri = wsUri('pdf-batch/dir1/a.md')
    const doc = await vscode.workspace.openTextDocument(docUri)
    const unsavedMarker = 'PDF-T04-UNSAVED-TEXT（未保存注入）'
    const edit = new vscode.WorkspaceEdit()
    edit.insert(docUri, new vscode.Position(doc.lineCount, 0), `\n未保存段：${unsavedMarker}\n`)
    assert.ok(await vscode.workspace.applyEdit(edit), '未保存编辑应成功')
    await openDocAndWait('pdf-batch/dir1/a.md')

    await vscode.commands.executeCommand(BATCH_COMMAND)
    // 清单顺序：dir2/a.md 在前（执行顺序断言载体）
    await inject({ kind: 'pdfExportModal.batch.addFiles', paths: [
      norm(path.join(wsDir, 'pdf-batch/dir2/a.md')),
      norm(path.join(wsDir, 'pdf-batch/dir1/a.md')),
    ] })
    await poll('清单 2 条', async () => {
      const info = await modalState()
      return info.batch?.items.length === 2 ? true : undefined
    })

    await inject({ kind: 'pdfExportModal.batch.run' })
    const confirm = await poll('confirm 映射（rename：同名后到者编号）', async () => {
      const info = await modalState()
      return info.batch?.phase === 'confirm' && info.batch.mapping !== undefined ? info.batch : undefined
    })
    const [first, second] = confirm.mapping!
    assert.equal(first!.targetPath, `${confirm.targetDir}/a.pdf`, '清单首条映射原名')
    assert.equal(second!.targetPath, `${confirm.targetDir}/a (2).pdf`, '同名后到者应自动更名')

    await inject({ kind: 'pdfExportModal.batch.confirm', params: { paper: 'a4', orientation: 'portrait', marginMm: 18, scale: 1 } })
    const done = await poll('批量执行完成', async () => {
      const info = await modalState()
      if (info.batch?.phase === 'failed') {
        throw new Error(`批量失败分态：${info.batch.failReason ?? 'unknown'}`)
      }
      return info.batch?.phase === 'done' ? info.batch : undefined
    }, 180000)

    // 结果表：2 成功、顺序与清单一致、真实输出路径
    assert.deepEqual(done.results.map((r) => r.status), ['success', 'success'], '两项均应成功')
    assert.equal(done.results[0]!.docName, 'a.md', '结果顺序应与清单一致（dir2 在前）')
    assert.equal(done.results[1]!.targetPath, second!.targetPath, '结果路径应与映射一致（自动更名）')

    // 产物断言：真实 PDF 文本（顺序内容 + 未保存内容）
    for (const [target, marker] of [
      [first!.targetPath, 'PDF-T04-DIR2-A'],
      [second!.targetPath, 'PDF-T04-DIR1-A'],
    ] as const) {
      const bytes = Buffer.from(await readFile(target!))
      assert.equal(bytes.subarray(0, 5).toString('latin1'), '%PDF-', '产物应为 PDF 字节')
      const { pages } = await extractPdfText(bytes)
      assert.ok(normalizePdfText(pages.join('\n')).includes(marker), `${marker} 应入版（${target}）`)
    }
    const unsavedBytes = Buffer.from(await readFile(second!.targetPath))
    const unsavedText = normalizePdfText((await extractPdfText(unsavedBytes)).pages.join('\n'))
    assert.ok(unsavedText.includes(unsavedMarker.replace(/（.*）/,'')) || unsavedText.includes('PDF-T04-UNSAVED-TEXT'),
      '已打开文档的未保存内容应进入本次批量结果')

    // 源文零回写：文档保持未保存
    const after = await vscode.workspace.openTextDocument(docUri)
    assert.ok(after.isDirty, '源文档应保持未保存（批量不触发保存）')

    await closeActiveEditor()
    await vscode.commands.executeCommand('workbench.action.closeAllEditors').then(() => undefined, () => undefined)
  }],

  ['PDF 导出（#624 T04）：skip 保护已有文件与单项失败继续（真浏览器）', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors').then(() => undefined, () => undefined)
    await new Promise((r) => setTimeout(r, 200))
    const { resolveExportBrowser } = await import('../../../src/host/pdfExport/browserFind')
    const browser = await resolveExportBrowser(undefined)
    if (!browser.ok) {
      console.log('[集成测试][SKIP] 无可用 Chrome/Edge，T04 skip/失败链路本环境未验证（#624）')
      return
    }

    await vscode.commands.executeCommand(BATCH_COMMAND)
    // 清单：dir1 目录（a.md + sub/b.md——保留嵌套相对结构；txt/png 排除）
    // + 不存在路径（测试钩子注入——capture 失败单项）
    await inject({ kind: 'pdfExportModal.batch.addDir', path: norm(path.join(wsDir, 'pdf-batch/dir1')) })
    await inject({ kind: 'pdfExportModal.batch.addFiles', paths: [norm(path.join(wsDir, 'pdf-batch/does-not-exist.md'))] })
    await poll('清单 3 条', async () => {
      const info = await modalState()
      return info.batch?.items.length === 3 ? true : undefined
    })

    // 用例自建目标目录并预置已有 a.pdf（skip 保护断言载体）——经测试钩子
    // 注入同目录探测（映射快照在 confirm 进入时固定，预置须先于探测）
    const targetRoot = path.join(wsDir, 'pdf-batch-skip-target')
    const existingTarget = norm(path.join(targetRoot, 'a.pdf'))
    const oldBytes = Buffer.from('%PDF-1.4 OLD-CONTENT-SHOULD-SURVIVE')
    await mkdir(path.dirname(existingTarget), { recursive: true })
    await writeFile(existingTarget, oldBytes)

    await inject({ kind: 'pdfExportModal.batch.run', targetDir: targetRoot.replaceAll('\\', '/') })
    await poll('confirm（注入目录）', async () => {
      const info = await modalState()
      return info.batch?.phase === 'confirm' && norm(info.batch.targetDir ?? '').toLowerCase() === norm(targetRoot).toLowerCase() ? info.batch : undefined
    })

    await inject({ kind: 'pdfExportModal.batch.setStrategy', strategy: 'skip' })
    await poll('skip 映射（a.md skip）', async () => {
      const info = await modalState()
      return info.batch?.strategy === 'skip' && info.batch.mapping?.some((m) => m.action === 'skip') ? true : undefined
    })
    await inject({ kind: 'pdfExportModal.batch.confirm', params: { paper: 'a4', orientation: 'portrait', marginMm: 18, scale: 1 } })
    const done = await poll('批量执行完成（失败继续）', async () => {
      const info = await modalState()
      if (info.batch?.phase === 'failed') {
        throw new Error(`批量失败分态：${info.batch.failReason ?? 'unknown'}`)
      }
      return info.batch?.phase === 'done' ? info.batch : undefined
    }, 180000)

    // 单项失败继续其余：skip / success / failed(capture-failed) 各就位
    assert.equal(done.results[0]!.status, 'skipped', '已有目标 + skip 策略应跳过')
    assert.equal(done.results[0]!.skipReason, 'exists')
    assert.equal(done.results[1]!.status, 'success', '其余项应继续完成')
    assert.equal(done.results[2]!.status, 'failed', '不存在条目应失败')
    assert.equal(done.results[2]!.failReason, 'capture-failed')

    // skip 保护：已有文件未被覆盖（内容原样）
    const after = Buffer.from(await readFile(existingTarget))
    assert.ok(after.equals(oldBytes), 'skip 策略下已有文件不应被改动')

    // 成功项产物真实（嵌套子目录相对结构）
    const bTarget = done.results[1]!.targetPath!
    assert.ok(/sub[\\/]b\.pdf$/.test(norm(bTarget)), '嵌套子目录应保留相对结构')
    const bBytes = Buffer.from(await readFile(bTarget))
    const bText = normalizePdfText((await extractPdfText(bBytes)).pages.join('\n'))
    assert.ok(bText.includes('PDF-T04-DIR1-SUB-B'), '成功项产物应含标记正文')

    await vscode.commands.executeCommand('workbench.action.closeAllEditors').then(() => undefined, () => undefined)
  }],

  ['PDF 导出（#624 T04）：缺资源 resume-all 与中途取消保留已完成（真浏览器）', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors').then(() => undefined, () => undefined)
    await new Promise((r) => setTimeout(r, 200))
    const { resolveExportBrowser } = await import('../../../src/host/pdfExport/browserFind')
    const browser = await resolveExportBrowser(undefined)
    if (!browser.ok) {
      console.log('[集成测试][SKIP] 无可用 Chrome/Edge，T04 缺资源/取消链路本环境未验证（#624）')
      return
    }

    await vscode.commands.executeCommand(BATCH_COMMAND)
    // 清单：dir2/a.md（成功）、dir2/missing.md（缺图 → awaiting）、
    // dir1/sub/b.md（成功）
    await inject({ kind: 'pdfExportModal.batch.addDir', path: norm(path.join(wsDir, 'pdf-batch/dir2')) })
    await inject({ kind: 'pdfExportModal.batch.addFiles', paths: [norm(path.join(wsDir, 'pdf-batch/dir1/sub/b.md'))] })
    const listed = await poll('清单 3 条', async () => {
      const info = await modalState()
      return info.batch?.items.length === 3 ? info.batch : undefined
    })
    // 单文件添加的相对身份 = 文件名（映射到目标根）——与目录收集的嵌套
    // 相对路径形成对照
    assert.deepEqual(listed.items.map((i) => i.relPath), ['a.md', 'missing.md', 'b.md'], '清单顺序即执行顺序')

    await inject({ kind: 'pdfExportModal.batch.run' })
    await poll('confirm', async () => {
      const info = await modalState()
      return info.batch?.phase === 'confirm' ? true : undefined
    })
    await inject({ kind: 'pdfExportModal.batch.confirm', params: { paper: 'a4', orientation: 'portrait', marginMm: 18, scale: 1 } })

    // 第 2 个文件缺资源 → awaiting-resources；resume-all 后第 3 个文件即便
    // 再有缺资源也不再暂停（本 fixture 仅 missing 缺图——语义断言：一次
    // 选择后整批跑完）
    const awaiting = await poll('missing.md awaiting-resources（缺图清单）', async () => {
      const info = await modalState()
      return info.batch?.phase === 'awaiting-resources' ? info.batch : undefined
    }, 180000)
    assert.ok(awaiting.resourceIssues?.some((issue) => issue.kind === 'image' && issue.reason === 'not-found'),
      `失败清单应含缺失图（实际 ${JSON.stringify(awaiting.resourceIssues)}）`)
    // 绘制层：继续/继续全部按钮可见
    await poll('绘制层探针上报缺资源面', async () => {
      const info = await modalState()
      const paint = paintOf(info)
      return paint['batchResumeAllButton'] !== undefined ? paint : undefined
    }).then((paint) => {
      assert.ok(visible(paint['batchResumeAllButton']), '「继续导出全部」按钮应可见')
    })
    await inject({ kind: 'pdfExportModal.batch.resume', all: true })
    const done = await poll('resume-all 后整批完成', async () => {
      const info = await modalState()
      if (info.batch?.phase === 'failed') {
        throw new Error(`批量失败分态：${info.batch.failReason ?? 'unknown'}`)
      }
      return info.batch?.phase === 'done' ? info.batch : undefined
    }, 180000)
    assert.deepEqual(done.results.map((r) => r.status), ['success', 'success', 'success'], 'resume-all 后三项均应完成')
    const missingText = normalizePdfText((await extractPdfText(Buffer.from(await readFile(done.results[1]!.targetPath!)))).pages.join('\n'))
    assert.ok(missingText.includes('PDF-T04-MISSING'), '缺资源项选择继续后应保留说明并完成导出')

    // 第二轮：中途取消保留已完成
    await inject({ kind: 'pdfExportModal.batch.cancel' }) // done → editing（清单保留）
    await poll('回到 editing', async () => {
      const info = await modalState()
      return info.batch?.phase === 'editing' ? true : undefined
    })
    await inject({ kind: 'pdfExportModal.batch.run' })
    const confirm2 = await poll('第二轮 confirm（新目标目录）', async () => {
      const info = await modalState()
      return info.batch?.phase === 'confirm' ? info.batch : undefined
    })
    const firstTarget = confirm2.mapping!.find((m) => m.fsPath.endsWith('dir2/a.md'))!.targetPath
    await inject({ kind: 'pdfExportModal.batch.confirm', params: { paper: 'a4', orientation: 'portrait', marginMm: 18, scale: 1 } })
    // a.md 成功后，missing.md 进入 awaiting-resources 时取消
    await poll('第二轮 missing.md awaiting-resources', async () => {
      const info = await modalState()
      return info.batch?.phase === 'awaiting-resources' ? true : undefined
    }, 180000)
    await poll('第一项已完成', async () => {
      const info = await modalState()
      return info.batch?.results.some((r) => r.status === 'success') ? true : undefined
    })
    await inject({ kind: 'pdfExportModal.batch.cancel' })
    const cancelled = await poll('取消终态', async () => {
      const info = await modalState()
      return info.batch?.phase === 'cancelled' ? info.batch : undefined
    }, 60000)

    // 取消语义：已完成保留、当前 cancelled、剩余不伪装成功
    assert.equal(cancelled.results[0]!.status, 'success', '已完成文件应保留')
    assert.equal(cancelled.results[1]!.status, 'cancelled', '当前未完成项应标 cancelled')
    assert.equal(cancelled.results.length, 2, '剩余项不应产生结果条目')
    const keptBytes = Buffer.from(await readFile(firstTarget))
    assert.equal(keptBytes.subarray(0, 5).toString('latin1'), '%PDF-', '取消后已完成 PDF 应真实可用')

    await vscode.commands.executeCommand('workbench.action.closeAllEditors').then(() => undefined, () => undefined)
  }],
]
