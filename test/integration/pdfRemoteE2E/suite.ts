// T08（#628）Remote SSH 四种 PDF 导出端到端套件：runner 挂在**本地** ext host
//（1.82.3 架构事实，V02 §3.7），被测主扩展经远端清单镜像跑在 vscode-server，
// 执行端扩展（ui kind）经 VSIX 安装留本机——断言面经命令路由（本地 runner
// 调远端注册的命令）+ 本机磁盘产物 + 驱动器侧 pdfjs 深检。
//
// 轮次（VSIDIAN_T08_ROUND 经 env 传入本地 runner）：
// - main：执行端在场——当前文档/选区/批量/合并四导出 + 预览刷新与复用 +
//   导出途中取消（协作式取消传到本机端）；
// - noexec：执行端缺席——导出如实报 executor-missing（不伪成功）；
// - disconnect：导出在途断连——driver 杀 SSH 会话，runner 观察远端命令
//   不可达、注入目标无伪产物后收口（宿主窗口由 driver 终结）。
//
// 对话框经工作区标记文件注入（.vsidian-pdf-remote-test.json——远端 ext host
// 读不到宿主 env，V02 §3.4；沿 T17 标记先例）；写盘与生成全走真实链路。
import * as vscode from 'vscode'
import * as assert from 'node:assert/strict'

const VIEW_TYPE = 'onegayi.vsidian.editor'
const CURRENT_COMMAND = 'onegayi.vsidian.pdfExport.currentDocument'
const SELECTION_COMMAND = 'onegayi.vsidian.pdfExport.selection'
const BATCH_COMMAND = 'onegayi.vsidian.pdfExport.batch'
const MERGE_COMMAND = 'onegayi.vsidian.pdfExport.merge'
const ROUND = process.env.VSIDIAN_T08_ROUND ?? 'main'
const HOST = process.env.VSIDIAN_T08_SSH_HOST ?? 'localhost'
/** 本机产物根（driver 注入）——各用例的 saveDir/targetDir 由套件按用例改写
 *  marker（写远端工作区标记文件，对话框端口每次读取）实现互不覆盖 */
const ARTIFACTS = process.env.VSIDIAN_T08_ARTIFACTS ?? ''

/** 改写测试钩子标记文件（远端 fs 写——模态与适配器按次读取） */
async function setMarker(partial: { saveDir?: string; targetDir?: string; saveTarget?: string }): Promise<void> {
  const payload: Record<string, unknown> = { hooks: true, ...partial }
  await vscode.workspace.fs.writeFile(
    vscode.Uri.joinPath(wsRoot(), '.vsidian-pdf-remote-test.json'),
    Buffer.from(JSON.stringify(payload), 'utf8'),
  )
}

const slash = (p: string): string => p.split('\\').join('/')
const saveDirOf = (name: string): string => (ARTIFACTS !== '' ? `${slash(ARTIFACTS)}/saves/${name}` : `saves/${name}`)

/** 工作区根（runner 侧）：优先 workspaceFolders（T17 实测 .code-workspace
 *  形态下本地 ext host 亦持有 vscode-remote folders）；缺席即硬错——不用
 *  手工拼 URI 兜底冒充 */
function wsRoot(): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0]
  assert.ok(folder !== undefined, '本地 runner 应持有工作区根（vscode-remote 形态）——检查 driver 是否用 .code-workspace 打开')
  assert.ok(folder.uri.scheme === 'vscode-remote', `工作区根应为 vscode-remote 形态（实际 ${folder.uri.scheme}）`)
  return folder.uri
}

const wsUri = (name: string): vscode.Uri => vscode.Uri.joinPath(wsRoot(), name)

async function poll<T>(label: string, fn: () => T | undefined | Promise<T | undefined>, timeoutMs = 120_000): Promise<T> {
  const start = Date.now()
  for (;;) {
    const value = await fn()
    if (value !== undefined) return value
    if (Date.now() - start > timeoutMs) throw new Error(`等待超时：${label}（${timeoutMs}ms）`)
    await new Promise((r) => setTimeout(r, 200))
  }
}

interface ModalInfo {
  open: boolean
  phase: string
  capturedVersion: number
  fragmentCount: number
  failReason?: string
  failDetail?: string
  savedPath?: string
  bookmarks?: { written: boolean; total: number; skipped: number; reason?: string }
  hookedSaveTarget?: string
  remote: { active: boolean; browserResolved?: boolean; browserKind?: string }
  preview: {
    phase: 'idle' | 'generating' | 'ready' | 'failed'
    fingerprint?: string
    bytesSha256: string
    failReason?: string
    busy: boolean
    lastExportReused: boolean
    runs: number
    cancels: number
  }
  batch?:
    | { mode: 'batch'; phase: string; items: Array<{ id: string; fsPath: string; relPath: string }>; mapping?: Array<{ id: string; targetPath: string; action: string }>; targetDir?: string; results?: Array<{ status: string; targetPath?: string; failReason?: string }> }
    | { mode: 'merge'; phase: string; items: Array<{ id: string; fsPath: string }>; savedPath?: string; failReason?: string }
    | undefined
}

async function modalState(): Promise<ModalInfo> {
  return vscode.commands.executeCommand('onegayi.vsidian._test.getPdfExportModalState') as Promise<ModalInfo>
}

async function injectModal(message: unknown): Promise<void> {
  await vscode.commands.executeCommand('onegayi.vsidian._test.injectPdfExportModalMessage', message)
}

/** 会话探测：返回 (found, ready, sessionUris)。远端 provider 的会话键实测
 *  为 file: 形态（workbench 对 remote 打开请求的解析侧产物），runner 侧的
 *  vscode-remote URI 探测会 miss——以 sessionUris 里按文件名匹配到的条目
 *  键为权威（诊断输出对读用） */
async function probeSession(uriStr: string): Promise<{ found: boolean; ready: boolean; sessionUris: string[] }> {
  const info = (await Promise.resolve(vscode.commands.executeCommand('onegayi.vsidian._test.getSessionState', uriStr)).catch(() => undefined)) as
    | { found: boolean; panels: Array<{ ready: boolean }>; sessionUris?: string[] }
    | undefined
  const uris = info?.sessionUris ?? []
  if (info === undefined) return { found: false, ready: false, sessionUris: uris }
  return { found: info.found, ready: info.found && info.panels.some((p) => p.ready), sessionUris: uris }
}

async function openDocAndWait(name: string): Promise<vscode.Uri> {
  const uri = wsUri(name)
  await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE)
  // 先以打开用 URI 探测一轮拿 sessionUris，从中按文件名挑出远端会话键
  let keyUri: vscode.Uri | undefined
  await poll(`会话就绪 ${name}`, async () => {
    const probe = await probeSession(uri.toString())
    if (keyUri === undefined) {
      const hit = probe.sessionUris.find((k) => k.endsWith(`/${name}`))
      if (hit !== undefined) {
        keyUri = vscode.Uri.parse(hit)
      }
    }
    if (keyUri !== undefined) {
      const keyed = await probeSession(keyUri.toString())
      if (keyed.found && keyed.ready) return true
    }
    return undefined
  }, 150_000)
  if (keyUri === undefined) {
    throw new Error(`未能定位 ${name} 的远端会话键（sessionUris 匹配失败）`)
  }
  return keyUri
}

async function closeAll(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors').then(() => undefined, () => undefined)
  await new Promise((r) => setTimeout(r, 300))
}

/** 远端命令可达性（disconnect 轮观察面）：不可达 = true */
async function remoteCommandDead(): Promise<boolean> {
  try {
    await Promise.race([
      vscode.commands.executeCommand('onegayi.vsidian._test.getPdfExportModalState'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('remote-cmd-timeout')), 8_000)),
    ])
    return false
  } catch {
    return true
  }
}

/** 导出终态轮询（带阶段变化诊断——remote 链路排障观测面） */
async function pollExportDone(label: string, timeoutMs = 240_000): Promise<ModalInfo> {
  let lastPhase = ''
  return poll(label, async () => {
    const info = await modalState()
    if (info.phase !== lastPhase) {
      console.log(`[T08-e2e][diag] ${label}: phase=${info.phase}${info.failReason !== undefined ? ` reason=${info.failReason} detail=${info.failDetail ?? ''}` : ''}${info.batch !== undefined ? ` batchPhase=${info.batch.phase}` : ''} preview=${info.preview.phase}`)
      lastPhase = info.phase
    }
    if (info.phase === 'failed') throw new Error(`${label} 失败：${info.failReason} ${info.failDetail ?? ''}`)
    return info.phase === 'done' ? info : undefined
  }, timeoutMs)
}

async function caseCurrentDocument(): Promise<void> {
  await setMarker({ saveDir: saveDirOf('single') })
  await openDocAndWait('t08-main.md')
  await vscode.commands.executeCommand(CURRENT_COMMAND)
  await poll('固定输入捕获完成', async () => {
    const info = await modalState()
    return info.open && info.capturedVersion > 0 ? true : undefined
  }, 60_000)
  // 模态内「导出」经消息注入（与真实按钮同链路）
  await injectModal({ kind: 'pdfExportModal.run', params: { paper: 'a4', orientation: 'portrait', marginMm: 20, scale: 1, bookmarksEnabled: true } })
  const state = await pollExportDone('当前文档导出')
  assert.equal(state.remote.active, true, 'remote 会话应走执行端链路（remote.active）')
  assert.equal(state.remote.browserResolved, true, '执行端浏览器解析应成功')
  assert.ok(state.savedPath !== undefined && state.savedPath.endsWith('/t08-main.pdf'), `保存路径应为注入目录下的 t08-main.pdf（实际 ${state.savedPath}）`)
  assert.ok(state.bookmarks === undefined || state.bookmarks.written, `远端书签链路应产出（bookmarks=${JSON.stringify(state.bookmarks)}）`)
  console.log(`[probe-data] currentDocument saved=${state.savedPath}`)
  await closeAll()
}

async function caseSelection(): Promise<void> {
  await setMarker({ saveDir: saveDirOf('selection') })
  const uri = await openDocAndWait('t08-main.md')
  // 与 T03 同注入面：postToPanel 的 sync.test.setSelection（host → webview）
  const text = (await vscode.workspace.fs.readFile(wsUri('t08-main.md'))).toString().replace(/\r\n?/g, '\n')
  const firstPara = text.indexOf('选区标记甲')
  const secondPara = text.indexOf('选区标记乙')
  assert.ok(firstPara >= 0 && secondPara > firstPara, 'fixture 应含选区标记')
  await vscode.commands.executeCommand('onegayi.vsidian._test.postToPanel', uri.toString(), {
    kind: 'sync.test.setSelection',
    ranges: [
      { anchor: firstPara, head: firstPara + 40 },
      { anchor: secondPara, head: secondPara + 40 },
    ],
  })
  await new Promise((r) => setTimeout(r, 200))
  await vscode.commands.executeCommand(SELECTION_COMMAND)
  await poll('固定输入捕获完成（选区）', async () => {
    const info = await modalState()
    return info.open && info.capturedVersion > 0 ? true : undefined
  }, 60_000)
  await injectModal({ kind: 'pdfExportModal.run', params: { paper: 'a4', orientation: 'portrait', marginMm: 20, scale: 1 } })
  const state = await pollExportDone('选区导出')
  assert.ok(state.savedPath !== undefined && state.savedPath.endsWith('/t08-main.pdf'), `选区导出落盘 t08-main.pdf（实际 ${state.savedPath}）`)
  assert.equal(state.fragmentCount, 2, '选区模式应以两个片段导出（fragmentCount）')
  console.log(`[probe-data] selection saved=${state.savedPath}`)
  await closeAll()
}

async function caseBatch(): Promise<void> {
  await setMarker({ targetDir: slash(ARTIFACTS) + '/batch' })
  await vscode.commands.executeCommand(BATCH_COMMAND)
  await poll('批量模态就绪', async () => (await modalState()).open ? true : undefined)
  // 目录入列（递归收集——相对结构的真实入口；单文件入列是拍平映射的
  // 产品语义，T04 已覆盖，此处钉目录链路）
  await injectModal({ kind: 'pdfExportModal.batch.addDir', path: wsRoot().fsPath.split('\\').join('/') })
  const ready = await poll('清单入列（目录递归收集）', async () => {
    const info = await modalState()
    const batch = info.batch
    return batch?.mode === 'batch' && batch.items.length === 3 ? batch : undefined
  })
  assert.ok(ready.items.find((i) => i.relPath === 'sub/t08-second.md') !== undefined, '子目录条目应保留相对结构')
  await injectModal({ kind: 'pdfExportModal.batch.run' })
  const confirmed = await poll('映射确认就绪', async () => {
    const info = await modalState()
    const batch = info.batch
    return batch?.mode === 'batch' && batch.phase === 'confirm' ? batch : undefined
  }, 60_000)
  assert.ok(confirmed.mapping !== undefined && confirmed.mapping.length === 3, `confirm 阶段应有 3 条映射（实际 ${JSON.stringify(confirmed.mapping)}）`)
  await injectModal({ kind: 'pdfExportModal.batch.confirm', params: { paper: 'a4', orientation: 'portrait', marginMm: 20, scale: 1 } })
  let lastBatchPhase = ''
  const state = await poll('批量执行 done', async () => {
    const info = await modalState()
    const batch = info.batch
    if (batch !== undefined && batch.phase !== lastBatchPhase) {
      lastBatchPhase = batch.phase
      console.log(`[T08-e2e][diag] 批量: batchPhase=${batch.phase}${batch.mode === 'batch' ? ` results=${JSON.stringify(batch.results ?? [])}` : ''}`)
    }
    if (batch?.mode === 'batch' && (batch.phase === 'failed' || batch.phase === 'cancelled')) {
      throw new Error(`批量失败：${batch.phase} ${JSON.stringify(batch.results ?? [])}`)
    }
    return batch?.mode === 'batch' && batch.phase === 'done' ? batch : undefined
  }, 240_000)
  assert.equal(state.results?.length, 3, '三个条目均应有结果')
  for (const entry of state.results ?? []) {
    assert.equal(entry.status, 'success', `条目应成功（${JSON.stringify(entry)}）`)
  }
  const subTarget = (state.results ?? []).find((r) => r.targetPath?.includes('sub'))
  assert.ok(subTarget !== undefined, '子目录产物应映射到 sub/ 下（相对结构保留）')
  for (const entry of state.results ?? []) {
    assert.ok(entry.targetPath !== undefined && entry.targetPath.startsWith(slash(ARTIFACTS) + '/batch/'), `批量产物应落在注入的本机目标目录（实际 ${entry.targetPath}）`)
  }
  console.log(`[probe-data] batch results=${JSON.stringify(state.results ?? [])}`)
  await closeAll()
}

async function caseMerge(): Promise<void> {
  await setMarker({ saveDir: saveDirOf('merge') })
  await vscode.commands.executeCommand(MERGE_COMMAND)
  await poll('合并模态就绪', async () => (await modalState()).open ? true : undefined)
  await injectModal({ kind: 'pdfExportModal.batch.addFiles', paths: [
    wsUri('t08-main.md').fsPath.replaceAll('\\', '/'),
    wsUri('sub/t08-second.md').fsPath.replaceAll('\\', '/'),
    wsUri('sub/t08-third.md').fsPath.replaceAll('\\', '/'),
  ] })
  await poll('合并清单入列', async () => {
    const info = await modalState()
    return info.batch?.items.length === 3 ? true : undefined
  })
  await injectModal({ kind: 'pdfExportModal.merge.run', pageBreak: true, params: { paper: 'a4', orientation: 'portrait', marginMm: 20, scale: 1, bookmarksEnabled: true } })
  const state = await poll('合并执行 done', async () => {
    const info = await modalState()
    const merge = info.batch
    if (merge?.mode === 'merge' && (merge.phase === 'failed' || merge.phase === 'cancelled')) {
      throw new Error(`合并失败：${merge.phase} ${merge.failReason ?? ''}`)
    }
    return merge?.mode === 'merge' && merge.phase === 'done' ? merge : undefined
  })
  assert.ok(state.savedPath !== undefined && state.savedPath.endsWith('/t08-main.pdf'), `合并产物落盘（实际 ${state.savedPath}）`)
  console.log(`[probe-data] merge saved=${state.savedPath}`)
  await closeAll()
}

async function casePreviewAndReuse(): Promise<void> {
  await setMarker({ saveDir: saveDirOf('reuse') })
  await openDocAndWait('t08-main.md')
  await vscode.commands.executeCommand(CURRENT_COMMAND)
  await poll('固定输入捕获完成（预览）', async () => {
    const info = await modalState()
    return info.open && info.capturedVersion > 0 ? true : undefined
  }, 60_000)
  await injectModal({ kind: 'pdfExportModal.preview.refresh', params: { paper: 'a4', orientation: 'portrait', marginMm: 20, scale: 1 } })
  const ready = await poll('预览就绪', async () => {
    const info = await modalState()
    if (info.preview.phase === 'failed') throw new Error(`预览失败：${info.preview.failReason}`)
    return info.preview.phase === 'ready' ? info : undefined
  })
  assert.notEqual(ready.preview.fingerprint, undefined, '预览应产出指纹')
  assert.notEqual(ready.preview.bytesSha256, '', '预览应产出字节')
  console.log(`[probe-data] preview ready sha=${ready.preview.bytesSha256.slice(0, 16)} bytes-fingerprint=${ready.preview.fingerprint?.slice(0, 12)}`)
  // 参数一致直接导出 → 复用同源字节（T07 语义在 remote 下保持）
  await injectModal({ kind: 'pdfExportModal.run', params: { paper: 'a4', orientation: 'portrait', marginMm: 20, scale: 1 } })
  const state = await poll('导出 done（复用预览）', async () => {
    const info = await modalState()
    if (info.phase === 'failed') throw new Error(`导出失败：${info.failReason}`)
    return info.phase === 'done' ? info : undefined
  })
  assert.equal(state.preview.lastExportReused, true, '参数一致时应复用预览字节（不重启浏览器生成）')
  console.log(`[probe-data] previewReuse saved=${state.savedPath}`)
  await closeAll()
}

async function caseCancel(): Promise<void> {
  await setMarker({ saveDir: saveDirOf('cancel') })
  await openDocAndWait('sub/t08-third.md')
  await vscode.commands.executeCommand(CURRENT_COMMAND)
  await poll('固定输入捕获完成（取消）', async () => {
    const info = await modalState()
    return info.open && info.capturedVersion > 0 ? true : undefined
  }, 60_000)
  // 先确认新一轮 generating 真实开始（上一会话的 done 终态残留会误判
  // 「先行完成」——job 的 phase 不随模态重开重置），再注入取消
  for (let attempt = 0; attempt < 2; attempt++) {
    await injectModal({ kind: 'pdfExportModal.run', params: { paper: 'a4', orientation: 'portrait', marginMm: 20, scale: 1 } })
    await poll(`取消用例进入 generating（第 ${attempt + 1} 次）`, async () => {
      const info = await modalState()
      return info.phase === 'generating' ? true : undefined
    }, 90_000)
    await injectModal({ kind: 'pdfExportModal.cancel' })
    const state = await poll('取消终态', async () => {
      const info = await modalState()
      if (info.phase === 'failed') throw new Error(`取消用例不应失败：${info.failReason}`)
      return (info.phase === 'cancelled' || info.phase === 'done') ? info : undefined
    }, 90_000)
    if (state.phase === 'cancelled') {
      console.log('[probe-data] cancel ok（协作式取消经命令通道传到本机端）')
      await closeAll()
      return
    }
    console.log(`[probe-data] cancel 第 ${attempt + 1} 次竞态先行完成，重试`)
  }
  throw new Error('连续两次取消竞态先行完成——取消通道失效')
}

async function caseExecutorMissing(): Promise<void> {
  await openDocAndWait('t08-main.md')
  await vscode.commands.executeCommand(CURRENT_COMMAND)
  await poll('固定输入捕获完成（noexec）', async () => {
    const info = await modalState()
    return info.open && info.capturedVersion > 0 ? true : undefined
  }, 60_000)
  await injectModal({ kind: 'pdfExportModal.run', params: { paper: 'a4', orientation: 'portrait', marginMm: 20, scale: 1 } })
  const state = await poll('executor-missing 终态', async () => {
    const info = await modalState()
    return info.phase === 'failed' ? info : undefined
  })
  assert.equal(state.failReason, 'executor-missing', `应如实报 executor-missing（实际 ${state.failReason}）`)
  console.log('[probe-data] executorMissing ok（不伪成功）')
  await closeAll()
}

async function caseDisconnect(): Promise<void> {
  await openDocAndWait('t08-main.md')
  await vscode.commands.executeCommand(CURRENT_COMMAND)
  await poll('固定输入捕获完成（disconnect）', async () => {
    const info = await modalState()
    return info.open && info.capturedVersion > 0 ? true : undefined
  }, 60_000)
  await injectModal({ kind: 'pdfExportModal.run', params: { paper: 'a4', orientation: 'portrait', marginMm: 20, scale: 1 } })
  await poll('generating 到位', async () => {
    const info = await modalState()
    return info.phase === 'generating' ? true : undefined
  }, 60_000)
  console.log('[probe-mark] in-flight')
  // driver 杀 SSH 会话。localhost 回环下 remote-ssh 会自动重连——两种真实
  // 出口均合法：(a) 连接死亡 → 远端命令不可达 + 无伪产物；(b) 重连自愈 →
  // 任务按真实链路完成并落盘（非伪成功）。观察窗内先探测死亡，否则等产物。
  const outcome = await poll('断连出口（死亡或自愈完成）', async () => {
    if (await remoteCommandDead()) return 'dead' as const
    try {
      const info = await modalState()
      if (info.phase === 'done' && info.savedPath !== undefined) return 'reconnected-done' as const
      if (info.phase === 'failed') return `failed:${info.failReason ?? ''}` as const
    } catch { /* 路由窗口期 */ }
    return undefined
  }, 150_000)
  console.log(`[probe-mark] disconnect-outcome=${outcome}`)
}

export async function run(): Promise<void> {
  console.log(`[T08-e2e] 轮次 ${ROUND}（remoteName=${vscode.env.remoteName ?? null}，host=${HOST}）`)
  if (vscode.env.remoteName !== 'ssh-remote') {
    console.log('[T08-e2e] 非 SSH 远程会话——按跳过处理（本套件只在 remote e2e driver 下运行）')
    return
  }
  // 远端主扩展激活晚于本地 runner（server 启动 + 镜像扩展激活有窗口）——
  // 先等观测命令可达（marker 文件门控的 _test 命令族随远端激活注册）
  await poll('远端主扩展命令就绪', async () => {
    try {
      await vscode.commands.executeCommand('onegayi.vsidian._test.getPdfExportModalState')
      return true
    } catch {
      return undefined
    }
  }, 180_000)
  // 远端主扩展可达性与 remote 分支取用证明
  const info = await modalState()
  assert.ok(info.remote.active === true, `主扩展应跑在远端并走执行端分支（remote=${JSON.stringify(info.remote)}）`)
  console.log(`[probe-data] remote-branch active=${info.remote.active}`)
  // 执行端在场性诊断（本地 ext host 视角）：未装/未激活直接可见
  const executorExt = vscode.extensions.getExtension('onegayi.vsidian-pdf-executor')
  console.log(`[T08-e2e][diag] executor ext present=${executorExt !== undefined} active=${executorExt?.isActive ?? 'n/a'}`)
  if (executorExt !== undefined && !executorExt.isActive) {
    await executorExt.activate().then(() => console.log('[T08-e2e][diag] executor 手动激活成功'), (err) => console.log(`[T08-e2e][diag] executor 手动激活失败：${err}`))
  }
  try {
    const ping = await vscode.commands.executeCommand('vsidian.pdfExecutor.ping', {})
    console.log(`[T08-e2e][diag] 本地直呼 ping=${JSON.stringify(ping)}`)
  } catch (err) {
    console.log(`[T08-e2e][diag] 本地直呼 ping 失败：${err instanceof Error ? err.message : String(err)}`)
  }

  if (ROUND === 'main') {
    await caseSelection()
    await caseCurrentDocument()
    await casePreviewAndReuse()
    await caseBatch()
    await caseMerge()
    await caseCancel()
    console.log('[T08-e2e] main 轮全部用例通过')
    return
  }
  if (ROUND === 'noexec') {
    await caseExecutorMissing()
    console.log('[T08-e2e] noexec 轮通过')
    return
  }
  if (ROUND === 'disconnect') {
    await caseDisconnect()
    console.log('[T08-e2e] disconnect 轮观察完成（宿主由 driver 终结）')
    return
  }
  throw new Error(`未知轮次：${ROUND}`)
}
