// #620（V02）Remote SSH 探针 · workspace 侧夹具扩展（extensionKind: workspace）。
// 预期跑在 vscode-server（remote ext host）。1.82.3 实测 --extensionTestsPath
// 装载在本机 ext host 且 local 端 workspaceFolders 为空——「远端发起」视角
// 由本扩展的命令族承载：suite（本机端）executeCommand 路由到 remote 执行，
// 返回值回传——一条调用链同时实测 local->remote 与 remote->local 双向路由。
// 探针代码，不定义产品行为。

import * as vscode from 'vscode'
import { createHash } from 'node:crypto'
import { CMDS, EXT_IDS, appendActivationLine, collectIdentity, endKindOf } from '../shared'

function sha256(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex')
}

function nfkc(text: string): string {
  return text.normalize('NFKC')
}

interface UiIdentity {
  extId: string
  hostname: string
  pid: number
  envRemoteName: string | null
  execPath: string
  electronVersion: string | null
  workspaceFolderUris: string[]
  extensionKindSelf: number | null
  hostEnvMarkerVisible: boolean
}

interface RenderPdfResult {
  browser: string
  readyWaitMs: number
  durationMs: number
  pdfBytes: number
  pdfSha256: string
  pdfBase64: string
  savedTo: string
  savedBytesOnDisk: number
  verifyEnabled: boolean
  verify: { numPages: number; textByPage: Record<string, string>; sampleColors: Array<Array<number> | null> } | null
  tempDirCleaned: boolean
}

/** fixture 根：1.82.3 实测 remote+tests 组合下两端 ext host 的
 * workspaceFolders 均为空数组（窗口资源 external URI 虽是 fixture）——
 * 路径改由调用方（suite）构造 vscode-remote URI 传入，读取仍走 remote fs。 */
function fixtureRoot(rootUriArg: string): vscode.Uri {
  return vscode.Uri.parse(rootUriArg)
}

/** 远端读 fixture（markdown + 相对图片）并装配打印 HTML——「远端读取身份」的事实源。 */
async function readFixtureAndBuildHtml(rootUriArg: string): Promise<{ html: string; mdSha256: string; imgSha256: string; rootUri: string; mdUri: string; imgUri: string }> {
  const root = fixtureRoot(rootUriArg)
  const mdUri = vscode.Uri.joinPath(root, 'sample.md')
  const imgUri = vscode.Uri.joinPath(root, 'probe-img.png')
  const mdBytes = await vscode.workspace.fs.readFile(mdUri)
  const imgBytes = await vscode.workspace.fs.readFile(imgUri)
  const mdText = Buffer.from(mdBytes).toString('utf8')
  const title = /# (.+)/.exec(mdText)?.[1] ?? '远端文档标题'
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:'Microsoft YaHei',sans-serif} h1{color:#1a56db;background:#eef2ff;padding:8px}
    .page2{page-break-before:always}
  </style></head><body>
  <h1>${title}</h1>
  <p>REMOTE-LOOP-MARKER-P1 远端到本机闭环：正文由 vscode-server 读取，经跨扩展宿主命令送达本机执行端渲染。</p>
  <img src="data:image/png;base64,${Buffer.from(imgBytes).toString('base64')}" alt="远端图片">
  <div class="page2"><h2>第二页标题</h2><p>REMOTE-LOOP-MARKER-P2 第二页内容，验证多页分页。</p></div>
  <script>window.__probe={asyncReady:true,fontsReady:true}</script>
  </body></html>`
  return { html, mdSha256: sha256(mdBytes), imgSha256: sha256(imgBytes), rootUri: root.toString(), mdUri: mdUri.toString(), imgUri: imgUri.toString() }
}

export function activate(context: vscode.ExtensionContext): void {
  const identity = collectIdentity(EXT_IDS.workspace)
  const writtenTo = appendActivationLine({ ...identity, kind: 'workspace-ext', endKind: endKindOf(identity) })

  context.subscriptions.push(
    vscode.commands.registerCommand(CMDS.workspaceIdentity, () => ({ ...identity, activationLogWrittenTo: writtenTo, endKind: endKindOf(identity) })),

    /** 远端读取身份：md/图片的 vscode-remote URI、正文与字节哈希、端身份。 */
    vscode.commands.registerCommand(CMDS.workspaceReadFixture, async ({ rootUri }: { rootUri: string }) => {
      const root = fixtureRoot(rootUri)
      const mdUri = vscode.Uri.joinPath(root, 'sample.md')
      const imgUri = vscode.Uri.joinPath(root, 'probe-img.png')
      const mdBytes = await vscode.workspace.fs.readFile(mdUri)
      const imgBytes = await vscode.workspace.fs.readFile(imgUri)
      return {
        identity: { ...identity, endKind: endKindOf(identity) },
        rootUri: root.toString(),
        md: { uri: mdUri.toString(), bytes: mdBytes.length, sha256: sha256(mdBytes), textHead: Buffer.from(mdBytes).toString('utf8').slice(0, 60) },
        img: { uri: imgUri.toString(), bytes: imgBytes.length, sha256: sha256(imgBytes) },
      }
    }),

    /** 核心闭环（远端发起）：读 fixture -> 装配 HTML -> executeCommand 到 ui 执行端 ->
     * 本机浏览器生成 -> base64 回传 -> 远端校验 -> 返回全程数据。 */
    vscode.commands.registerCommand(CMDS.workspaceCoreLoop, async ({ rootUri }: { rootUri: string }) => {
      const startedAt = Date.now()
      const fixture = await readFixtureAndBuildHtml(rootUri)
      const result = await vscode.commands.executeCommand(CMDS.uiRenderPdf, {
        html: fixture.html,
        fileName: 'remote-loop.pdf',
        samplePoints: [{ page: 1, fx: 0.02, fy: 0.06 }],
      }) as RenderPdfResult
      const pdfBytes = Buffer.from(result.pdfBase64, 'base64')
      const checks = {
        pdfHeaderValid: pdfBytes.subarray(0, 5).toString('ascii') === '%PDF-',
        sha256MatchRemoteDecode: result.pdfSha256 === sha256(pdfBytes),
        savedUriScheme: vscode.Uri.parse(result.savedTo).scheme,
        savedBytesMatch: result.savedBytesOnDisk === result.pdfBytes,
        verifyEnabled: result.verifyEnabled,
        verifyNumPages: result.verify?.numPages ?? null,
        markersHit: result.verify ? (Object.values(result.verify.textByPage).join('\n').includes('REMOTE-LOOP-MARKER-P1') && Object.values(result.verify.textByPage).join('\n').includes('REMOTE-LOOP-MARKER-P2')) : false,
        chineseHit: result.verify ? [...'远端到本机闭环'].every((ch) => nfkc(Object.values(result.verify!.textByPage).join('\n')).includes(nfkc(ch))) : false,
        sampleColor: result.verify?.sampleColors?.[0] ?? null,
      }
      return { startedAt, durationMs: Date.now() - startedAt, fixture: { mdSha256: fixture.mdSha256, imgSha256: fixture.imgSha256, rootUri: fixture.rootUri }, result: { ...result, pdfBase64: undefined }, checks }
    }),

    /** remote->local 方向的 payload 矩阵。 */
    vscode.commands.registerCommand(CMDS.workspacePayloadEcho, async ({ sizes }: { sizes: number[] }) => {
      const out = []
      for (const size of sizes) {
        const t0 = Date.now()
        try {
          const payload = sha256(String(size)).repeat(2) + 'x'.repeat(Math.max(0, size - 128))
          const sliced = payload.slice(0, size)
          const result = await vscode.commands.executeCommand(CMDS.uiEcho, sliced) as { size: number; sha256: string }
          out.push({ size, ok: result.sha256 === sha256(sliced) && result.size === size, rttMs: Date.now() - t0 })
        } catch (err) {
          out.push({ size, ok: false, error: err instanceof Error ? err.message : String(err) })
        }
      }
      // 返回方向：ui 生成 4MB 字符串回传到 remote
      const t1 = Date.now()
      const big = await vscode.commands.executeCommand(CMDS.uiEchoBigReturn, 4 * 1024 * 1024) as string
      out.push({ size: 4 * 1024 * 1024, direction: 'return', ok: typeof big === 'string' && big.length === 4 * 1024 * 1024, rttMs: Date.now() - t1, received: big.length })
      return out
    }),

    /** remote 端调 ui.throwError：错误跨 ext host 回传形态。 */
    vscode.commands.registerCommand(CMDS.workspaceErrorProbe, async () => {
      try {
        await vscode.commands.executeCommand(CMDS.uiThrowError, { message: '中文错误消息-本机执行端抛出', code: 'EPROBE' })
        return { thrown: false }
      } catch (err) {
        return {
          thrown: true,
          isErrorInstance: err instanceof Error,
          message: err instanceof Error ? err.message : String(err),
          code: (err as { code?: string }).code ?? null,
          name: err instanceof Error ? err.name : null,
        }
      }
    }),

    /** 远端发起的进度轮询通道实测。 */
    vscode.commands.registerCommand(CMDS.workspaceProgressLoop, async ({ taskId }: { taskId: string }) => {
      await vscode.commands.executeCommand(CMDS.uiProgressStart, { taskId, totalStages: 5 })
      const t0 = Date.now()
      const stages: Array<{ stage: number; atMs: number; pollRttMs: number }> = []
      let lastStage = -1
      for (;;) {
        const pollStart = Date.now()
        const state = await vscode.commands.executeCommand(CMDS.uiProgressPoll, { taskId }) as { stage: number; total: number; done: boolean }
        const pollRtt = Date.now() - pollStart
        if (state.stage !== lastStage) {
          stages.push({ stage: state.stage, atMs: Date.now() - t0, pollRttMs: pollRtt })
          lastStage = state.stage
        }
        if (state.done) break
        if (Date.now() - t0 > 30_000) throw new Error('进度轮询 30s 未收敛')
        await new Promise((resolve) => setTimeout(resolve, 120))
      }
      return { stages, totalMs: Date.now() - t0 }
    }),

    /** 迟到回包与协作式取消（远端发起）。 */
    vscode.commands.registerCommand(CMDS.workspaceLateAndCancel, async () => {
      let lateSettled: boolean | string = false
      const late = Date.now()
      void vscode.commands.executeCommand(CMDS.uiSleepEcho, { ms: 3000, tag: 'late-reply' }).then(() => { lateSettled = true }, () => { lateSettled = 'rejected' })
      await new Promise((resolve) => setTimeout(resolve, 250))
      const channelStillUsable = await vscode.commands.executeCommand(CMDS.uiSleepEcho, { ms: 200, tag: 'quick' }) as { tag: string }
      await new Promise((resolve) => setTimeout(resolve, 3200))
      const taskId = `cancel-${Date.now()}`
      void vscode.commands.executeCommand(CMDS.uiCancelableStart, { taskId }).then(undefined, () => { /* 吞掉避免 unhandled */ })
      let hanging = false
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 200))
        const state = await vscode.commands.executeCommand(CMDS.uiTaskState, { taskId }) as { state: string }
        if (state.state === 'hanging') { hanging = true; break }
      }
      const cancelResult = await vscode.commands.executeCommand(CMDS.uiCancelTask, { taskId }) as { killed: boolean; tempDirExistsAfterKill: boolean }
      return {
        abandonedAwait: true,
        channelStillUsable: channelStillUsable.tag === 'quick',
        lateSettledAfterWait: lateSettled !== false,
        lateMs: Date.now() - late,
        taskReachedHanging: hanging,
        cancel: cancelResult,
      }
    }),

    /** remote 端调 dual.identity：命令落在哪端。 */
    vscode.commands.registerCommand(CMDS.workspaceDualProbe, async () => {
      try {
        const identity = await vscode.commands.executeCommand(CMDS.dualIdentity) as UiIdentity
        return { ok: true, endKind: endKindOf(identity), envRemoteName: identity.envRemoteName, pid: identity.pid, execPath: identity.execPath }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }),

    /** 断连轮专用：remote 端发起 hang 60s 的 ui.renderPdf（不 await），
     * 命令立即返回——在途任务挂在 remote 端等待 local 回包。 */
    vscode.commands.registerCommand(CMDS.workspaceDisconnectFlight, async ({ rootUri }: { rootUri: string }) => {
      const fixture = await readFixtureAndBuildHtml(rootUri)
      void vscode.commands.executeCommand(CMDS.uiRenderPdf, { html: fixture.html, fileName: 'disconnect-round.pdf', hangMs: 60_000 }).then(
        (result) => console.log(`[probe-mark] remote-await-settled ${JSON.stringify({ savedTo: (result as RenderPdfResult).savedTo, bytes: (result as RenderPdfResult).pdfBytes })}`),
        (err) => console.log(`[probe-mark] remote-await-rejected ${err instanceof Error ? err.message : String(err)}`),
      )
      return { launched: true, atMs: Date.now() }
    }),

    /** remote 端调 showSaveDialog：对话框发起行为观察（非交互预期 pending）。 */
    vscode.commands.registerCommand(CMDS.workspaceSaveDialogProbe, async () => {
      const outcome = await Promise.race([
        vscode.window.showSaveDialog({ title: 'V02 probe: remote-side save dialog check' }).then((uri) => ({ outcome: 'resolved' as const, uri: uri ? uri.toString() : null, scheme: uri?.scheme ?? null })),
        new Promise<{ outcome: 'pending'; uri: null; scheme: null }>((resolve) => setTimeout(() => resolve({ outcome: 'pending', uri: null, scheme: null }), 3500)),
      ])
      return outcome
    }),

    /** 远端发起的本机 VSIX 安装（分发候选实验；路径由 suite 传入）。 */
    vscode.commands.registerCommand(CMDS.workspaceInstallProbe, async ({ fileUri }: { fileUri: string }) => {
      try {
        const result = await vscode.commands.executeCommand(CMDS.uiHelperInstallVsix, { fileUri }) as { installed: string | null }
        await new Promise((resolve) => setTimeout(resolve, 1500))
        const visible = vscode.extensions.getExtension(EXT_IDS.installee)
        return { ok: true, installed: result.installed, visibleAfterInstall: visible !== undefined }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }),
  )
}
