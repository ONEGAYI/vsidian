// #620（V02）Remote SSH 最小闭环探针 · 主套件（extensionTestsPath 模式）。
// 1.82.3 实测：--extensionTestsPath 装载在**本机** ext host（栈路径为宿主
// Electron 的 extensionHostProcess）且 local 端 workspaceFolders 为空——
// 本 suite 因此承担「编排者」角色：远端视角经 workspace 扩展命令族中转
// （executeCommand local->remote 路由 + 返回值回传），ui 执行端命令由
// workspace 端发起（remote->local 路由）——一条调用链实测双向跨 ext host。
// 输出协议：[集成测试][START/PASS/FAIL/TIME] 对齐 evaluateHostReport；
// 测量数据经 [probe-data] JSON 行走 stdout，由驱动器聚合落盘。
// 探针代码，不定义产品行为。

import * as vscode from 'vscode'
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { hostname } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { ACTIVATION_LOG_NAME, CMDS, EXT_IDS, endKindOf } from './shared'

const execFileAsync = promisify(execFile)

interface StepRecord { ok: boolean; detail: string }

interface EndIdentityPayload {
  extId: string
  hostname: string
  pid: number
  envRemoteName: string | null
  execPath: string
  electronVersion: string | null
  nodeVersion: string
  workspaceFolderUris: string[]
  extensionKindSelf: number | null
  hostEnvMarkerVisible: boolean
  endKind?: string
}

const probeData = (key: string, value: unknown): void => {
  console.log(`[probe-data] ${JSON.stringify({ key, value })}`)
}

function countChromeProcess(): Promise<number> {
  return execFileAsync('tasklist', ['/FI', 'IMAGENAME eq chrome.exe', '/FO', 'CSV'], { timeout: 15_000 })
    .then(({ stdout }) => stdout.split('\n').filter((line) => line.toLowerCase().includes('chrome.exe')).length)
    .catch(() => -1)
}

export async function run(): Promise<void> {
  const failures: string[] = []
  const fixtureLocalDir = path.join(__dirname, 'fixture')

  const testCase = async (name: string, fn: (steps: StepRecord[]) => Promise<void>): Promise<void> => {
    console.log(`[集成测试][START] ${name}`)
    const steps: StepRecord[] = []
    const t0 = Date.now()
    try {
      await fn(steps)
      const bad = steps.filter((s) => !s.ok)
      if (bad.length > 0) throw new Error(`${bad.length} 步未过：${bad.map((s) => s.detail).join('；')}`)
      console.log(`[集成测试][PASS] ${name}`)
    } catch (err) {
      failures.push(name)
      console.error(`[集成测试][FAIL] ${name}`, err)
    } finally {
      console.log(`[集成测试][TIME] ${Date.now() - t0}ms ${name}`)
    }
  }
  const step = (steps: StepRecord[], ok: boolean, detail: string): void => {
    steps.push({ ok, detail })
    console.log(`[pdfRemoteProbe][${ok ? 'ok' : 'BAD'}] ${detail}`)
  }

  let savedToUri: string | null = null
  // 1.82.3 实测：remote+tests 组合下两端 ext host 的 workspaceFolders 均为空，
  // fixture 根改由 suite 构造 vscode-remote URI 传给远端命令（窗口日志的
  // external 形态：vscode-remote://ssh-remote+localhost/d%3A%5C...）
  const remoteFixtureUri = `vscode-remote://ssh-remote+localhost/${fixtureLocalDir}`

  const plannedTotal = 11
  console.log(`[集成测试] 执行 ${plannedTotal}/${plannedTotal} 项（pdfRemoteProbe 主套件）`)

  await testCase('tests-host-facts', async (steps) => {
    const suiteIdentity: EndIdentityPayload = {
      extId: '(suite)',
      hostname: hostname(),
      pid: process.pid,
      envRemoteName: vscode.env.remoteName ?? null,
      execPath: process.execPath,
      electronVersion: process.versions.electron ?? null,
      nodeVersion: process.versions.node,
      workspaceFolderUris: (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.toString()),
      extensionKindSelf: null,
      hostEnvMarkerVisible: process.env.VSIDIAN_PDF_REMOTE_HOST_ENV_MARKER === '1',
    }
    const kind = endKindOf(suiteIdentity)
    step(steps, kind === 'local(host-electron)', `extensionTestsPath 装载端=${kind}（execPath=${process.execPath.slice(-60)}，electron=${process.versions.electron ?? '无'}）——1.82.3 实测：tests 装在本机 ext host，remote 端装载须走 VSIX 分发`)
    step(steps, suiteIdentity.workspaceFolderUris.length === 0, `suite（local ext host）workspaceFolders=${JSON.stringify(suiteIdentity.workspaceFolderUris)}（1.82.3 实测：remote 窗口 local 端为空）`)
    step(steps, suiteIdentity.hostEnvMarkerVisible, `宿主 env 在 local ext host 可见（marker=1）`)
    probeData('tests-host-facts', { suiteIdentity, endKind: kind, remoteName: vscode.env.remoteName ?? null })
  })

  await testCase('remote-identity', async (steps) => {
    const identity = await vscode.commands.executeCommand(CMDS.workspaceIdentity) as EndIdentityPayload
    const kind = endKindOf(identity)
    step(steps, kind === 'remote(server-node)', `workspace 扩展跑在 ${kind}（execPath=${identity.execPath.slice(-70)}，electron=${identity.electronVersion ?? '无'}）——与 ui 扩展（local）分属两个 ext host`)
    step(steps, identity.envRemoteName === 'ssh-remote', `remote 端 env.remoteName=${identity.envRemoteName}（1.82.3 值形态：'ssh-remote'，非完整 authority）`)
    step(steps, identity.workspaceFolderUris.length === 0, `remote 端 workspaceFolders=${JSON.stringify(identity.workspaceFolderUris)}（1.82.3 remote+tests 实测为空——窗口资源虽是 fixture，两端均不镜像 folders）`)
    const fixture = await vscode.commands.executeCommand(CMDS.workspaceReadFixture, { rootUri: remoteFixtureUri }) as {
      md: { uri: string; bytes: number; sha256: string; textHead: string }
      img: { uri: string; bytes: number; sha256: string }
      rootUri: string
    }
    step(steps, fixture.md.uri.startsWith('vscode-remote://') && fixture.img.uri.startsWith('vscode-remote://'), `远端读取身份保持 vscode-remote URI：md=${fixture.md.uri}`)
    step(steps, fixture.md.textHead.includes('远端文档标题') && fixture.img.bytes > 0, `远端读取内容：md ${fixture.md.bytes}B sha=${fixture.md.sha256.slice(0, 12)}，img ${fixture.img.bytes}B sha=${fixture.img.sha256.slice(0, 12)}`)
    step(steps, !identity.hostEnvMarkerVisible, `宿主 env 在 server 内不可见（marker absent）——server env 与宿主 env 隔离`)
    probeData('remote-identity', { identity, kind, fixture })
  })

  await testCase('ui-presence-and-routing', async (steps) => {
    const uiExt = vscode.extensions.getExtension(EXT_IDS.ui)
    const dualExt = vscode.extensions.getExtension(EXT_IDS.dual)
    step(steps, uiExt !== undefined, `local 注册表可见 ui 扩展：${uiExt !== undefined}（kind=${uiExt?.extensionKind}，active=${uiExt?.isActive}）`)
    step(steps, dualExt !== undefined, `local 注册表可见 dual 扩展：${dualExt !== undefined}（kind=${dualExt?.extensionKind}，active=${dualExt?.isActive}）`)
    const identity = await vscode.commands.executeCommand(CMDS.uiIdentity) as EndIdentityPayload
    const kind = endKindOf(identity)
    step(steps, kind === 'local(host-electron)', `ui 扩展跑在 ${kind}（execPath=${identity.execPath.slice(-60)}，electron=${identity.electronVersion ?? '无'}）——与 workspace 扩展（server node）分属两端，跨 ext host 路由成立`)
    step(steps, identity.workspaceFolderUris.length === 0, `ui（local）端 workspaceFolders=${JSON.stringify(identity.workspaceFolderUris)}（实测为空——ui 扩展不能依赖 folders 定位路径）`)
    step(steps, identity.hostEnvMarkerVisible, `宿主 env 在 ui（local）端可见——VSIDIAN_* 只到本机端`)
    probeData('ui-presence-and-routing', { uiIdentity: identity, uiKind: uiExt?.extensionKind ?? null, dualKind: dualExt?.extensionKind ?? null, endKind: kind, sameHostProcessAsSuite: identity.pid === process.pid })
  })

  await testCase('dual-kind-matrix', async (steps) => {
    let localLanding = '(未调用)'
    try {
      const identity = await vscode.commands.executeCommand(CMDS.dualIdentity) as EndIdentityPayload
      localLanding = endKindOf(identity)
    } catch (err) {
      localLanding = `调用失败：${err instanceof Error ? err.message : String(err)}`
    }
    const fromRemote = await vscode.commands.executeCommand(CMDS.workspaceDualProbe) as { ok: boolean; endKind?: string; error?: string; envRemoteName?: string | null; pid?: number }
    const remoteLanding = fromRemote.ok ? fromRemote.endKind : `调用失败：${fromRemote.error}`
    step(steps, fromRemote.ok && !localLanding.startsWith('调用失败'), `dual.identity 两端调用形态：local 侧命令落点=${localLanding}；remote 侧命令落点=${remoteLanding}（pid=${fromRemote.pid}）`)
    // 激活标志聚合（remote 端写 fixture/、local 端写 env 指定路径——物理同机聚合便利）
    const sides: string[] = []
    for (const file of [path.join(fixtureLocalDir, ACTIVATION_LOG_NAME), path.join(process.env.VSIDIAN_PDF_REMOTE_ARTIFACTS ?? '', ACTIVATION_LOG_NAME)]) {
      if (file && existsSync(file)) {
        for (const line of readFileSync(file, 'utf8').split('\n').filter((l) => l.includes(`"extId":"${EXT_IDS.dual}"`))) {
          const entry = JSON.parse(line) as EndIdentityPayload
          sides.push(endKindOf(entry))
        }
      }
    }
    step(steps, sides.length >= 1, `dual 激活标志 ${sides.length} 条：${sides.join(' + ') || '无'}（数组 kind ["ui","workspace"] 在 1.82.3 的激活端决策）`)
    probeData('dual-kind-matrix', { localLanding, remoteLanding, activationSides: sides })
  })

  await testCase('payload-roundtrip', async (steps) => {
    const t0 = Date.now()
    const localSmall = await vscode.commands.executeCommand(CMDS.uiEcho, 'local-direct-echo-1KB-' + 'x'.repeat(1000)) as { sha256: string }
    step(steps, localSmall.sha256.length === 64, `local->local 对照 echo 1KB RTT=${Date.now() - t0}ms`)
    const matrix = await vscode.commands.executeCommand(CMDS.workspacePayloadEcho, { sizes: [1024, 128 * 1024, 1024 * 1024, 4 * 1024 * 1024, 8 * 1024 * 1024] }) as Array<{ size: number; ok?: boolean; error?: string; rttMs?: number; direction?: string; received?: number }>
    for (const item of matrix) {
      if (item.direction === 'return') {
        step(steps, item.ok === true, `返回方向 4MB：实收 ${item.received}B RTT=${item.rttMs}ms`)
      } else {
        step(steps, item.ok === true, `remote->local echo ${item.size}B：${item.ok === true ? `sha256 一致 RTT=${item.rttMs}ms` : `失败 ${item.error}（大小断点）`}`)
      }
    }
    probeData('payload-roundtrip', { matrix, localEchoRttMs: Date.now() - t0 })
  })

  await testCase('error-propagation', async (steps) => {
    const remoteProbe = await vscode.commands.executeCommand(CMDS.workspaceErrorProbe) as { thrown: boolean; isErrorInstance: boolean; message: string; code: string | null; name: string | null }
    step(steps, remoteProbe.thrown && remoteProbe.isErrorInstance, `remote->local 错误传播：instanceof Error=${remoteProbe.isErrorInstance}，message=${remoteProbe.message}`)
    step(steps, remoteProbe.code === null && remoteProbe.name === 'Error', `非标准字段实测：code 跨 ext host 丢失（null）、name 保留（${remoteProbe.name}）——命令通道只序列化 message/name 语义`)
    try {
      await vscode.commands.executeCommand('vsidian.pdfRemoteProbe.ui.nonexistent')
      step(steps, false, '不存在的命令未拒绝')
    } catch (err) {
      step(steps, true, `未知命令错误形态：${err instanceof Error ? err.message : String(err)}`)
    }
  })

  await testCase('core-pdf-loop', async (steps) => {
    const outcome = await vscode.commands.executeCommand(CMDS.workspaceCoreLoop, { rootUri: remoteFixtureUri }) as {
      durationMs: number
      fixture: { mdSha256: string; imgSha256: string; rootUri: string }
      result: { browser: string; pdfBytes: number; pdfSha256: string; savedTo: string; savedBytesOnDisk: number; verifyEnabled: boolean; tempDirCleaned: boolean; durationMs: number }
      checks: { pdfHeaderValid: boolean; sha256MatchRemoteDecode: boolean; savedUriScheme: string; savedBytesMatch: boolean; verifyEnabled: boolean; verifyNumPages: number | null; markersHit: boolean; chineseHit: boolean; sampleColor: number[] | null }
    }
    savedToUri = outcome.result.savedTo
    step(steps, outcome.checks.pdfHeaderValid && outcome.checks.sha256MatchRemoteDecode, `远端解码校验：%PDF 头=${outcome.checks.pdfHeaderValid}，sha256 一致=${outcome.checks.sha256MatchRemoteDecode}（${outcome.result.pdfBytes}B，ui 生成 ${outcome.result.durationMs}ms，端到端 ${outcome.durationMs}ms）`)
    step(steps, outcome.checks.savedUriScheme === 'file' && outcome.checks.savedBytesMatch, `本机落盘：URI=${outcome.result.savedTo}，磁盘 ${outcome.result.savedBytesOnDisk}B`)
    step(steps, outcome.checks.verifyEnabled, `内容级验证引擎（浏览器 ${outcome.result.browser}）：enabled=${outcome.checks.verifyEnabled}`)
    step(steps, outcome.checks.verifyNumPages === 2, `pdfjs 页数=${outcome.checks.verifyNumPages}（预期 2）`)
    step(steps, outcome.checks.markersHit, `两页标记文本命中：P1+P2=${outcome.checks.markersHit}`)
    step(steps, outcome.checks.chineseHit, `中文逐字命中（远端到本机闭环）：${outcome.checks.chineseHit}`)
    step(steps, outcome.checks.sampleColor !== null, `标题底色采样=${JSON.stringify(outcome.checks.sampleColor)}（#eef2ff）`)
    step(steps, outcome.result.tempDirCleaned, '浏览器临时目录已清理')
    probeData('core-pdf-loop', outcome)
  })

  await testCase('local-save-probe', async (steps) => {
    if (!savedToUri) throw new Error('前置 core-pdf-loop 未产出 savedTo')
    const dir = vscode.Uri.parse(savedToUri).with({ path: vscode.Uri.parse(savedToUri).path.replace(/\/[^/]+$/, '') })
    const target = vscode.Uri.joinPath(dir, `fsprobe-${Date.now()}.txt`)
    const content = Buffer.from('V02 local save probe 远端发起本机落盘').toString('base64')
    const writeResult = await vscode.commands.executeCommand(CMDS.uiFsProbe, { op: 'write', uri: target.toString(), contentBase64: content }) as { bytes: number }
    step(steps, writeResult.bytes === Buffer.from(content, 'base64').length, `workspace.fs.writeFile(file:) ${writeResult.bytes}B`)
    const statResult = await vscode.commands.executeCommand(CMDS.uiFsProbe, { op: 'stat', uri: target.toString() }) as { size: number; scheme: string }
    step(steps, statResult.size === writeResult.bytes && statResult.scheme === 'file', `stat 回读 size=${statResult.size}`)
    const readResult = await vscode.commands.executeCommand(CMDS.uiFsProbe, { op: 'read', uri: target.toString() }) as { headBase64: string }
    step(steps, Buffer.from(readResult.headBase64, 'base64').toString('utf8').startsWith('V02'), 'read 回读一致（head 8 字节）')
    const dialogLocal = await vscode.commands.executeCommand(CMDS.uiSaveDialogProbe, {}) as { outcome: string; uri: string | null }
    const dialogRemote = await vscode.commands.executeCommand(CMDS.workspaceSaveDialogProbe) as { outcome: string; uri: string | null }
    step(steps, dialogLocal.outcome === 'resolved' || dialogLocal.outcome === 'pending', `local 端 showSaveDialog=${dialogLocal.outcome}（非交互预期 pending=已弹出等待用户）`)
    step(steps, dialogRemote.outcome === 'resolved' || dialogRemote.outcome === 'pending', `remote 端 showSaveDialog=${dialogRemote.outcome}（返回形态需交互实测——未验证项）`)
    probeData('local-save-probe', { dir: dir.toString(), dialogLocal, dialogRemote })
  })

  await testCase('progress-channel', async (steps) => {
    const outcome = await vscode.commands.executeCommand(CMDS.workspaceProgressLoop, { taskId: `probe-${Date.now()}` }) as { stages: Array<{ stage: number; atMs: number; pollRttMs: number }>; totalMs: number }
    const rtts = outcome.stages.map((s) => s.pollRttMs)
    step(steps, outcome.stages.length >= 4, `远端发起轮询捕获 ${outcome.stages.length} 阶段（总 ${outcome.totalMs}ms，轮询 RTT ${Math.min(...rtts)}-${Math.max(...rtts)}ms）`)
    probeData('progress-channel', outcome)
  })

  await testCase('late-reply-and-cancel', async (steps) => {
    const chromeBefore = await countChromeProcess()
    const outcome = await vscode.commands.executeCommand(CMDS.workspaceLateAndCancel) as {
      abandonedAwait: boolean
      channelStillUsable: boolean
      lateSettledAfterWait: boolean
      lateMs: number
      taskReachedHanging: boolean
      cancel: { killed: boolean; tempDirExistsAfterKill: boolean }
    }
    step(steps, outcome.channelStillUsable, '放弃等待后通道仍可用（并行命令不受影响；executeCommand 无取消参数——只能放弃 await）')
    step(steps, outcome.lateSettledAfterWait, `迟到回包最终 resolve（${outcome.lateMs}ms；promise 不因调用方放弃而取消）`)
    step(steps, outcome.taskReachedHanging, '协作式任务进入 hanging（浏览器已 spawn）')
    step(steps, outcome.cancel.killed && !outcome.cancel.tempDirExistsAfterKill, `取消信号经第二条命令送达：killed=${outcome.cancel.killed}，临时目录残留=${outcome.cancel.tempDirExistsAfterKill}`)
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const chromeAfter = await countChromeProcess()
    step(steps, chromeBefore < 0 || chromeAfter <= chromeBefore, `chrome 进程计数 ${chromeBefore} -> ${chromeAfter}（杀任务后不增）`)
    probeData('late-reply-and-cancel', { outcome, chromeBefore, chromeAfter })
  })

  await testCase('vsix-install-helper', async (steps) => {
    const vsixUri = vscode.Uri.file(path.join(fixtureLocalDir, 'installee.vsix'))
    const outcome = await vscode.commands.executeCommand(CMDS.workspaceInstallProbe, { fileUri: vsixUri.toString() }) as { ok: boolean; installed?: string | null; visibleAfterInstall?: boolean; error?: string }
    step(steps, outcome.ok, `远端发起 installExtension（经 ui 侧 helper）：${outcome.ok ? `返回 ${String(outcome.installed)}，安装后立即可见=${outcome.visibleAfterInstall}` : `失败 ${outcome.error}`}`)
    probeData('vsix-install-helper', outcome)
  })

  if (failures.length > 0) throw new Error(`pdfRemoteProbe 失败 ${failures.length} 项：${failures.join('；')}`)
}
