// T08（#628）Remote SSH PDF 导出端到端驱动器：真实 SSH 链路（远端=本机回环
// sshd——物理同机如实标注，链路/双 ext host/命令路由为真实架构）。
//
// 形态（沿 T17 runRemoteSshAddons + V02 runRemoteProbe 先例）：
// - 主 VSIX + 执行端 VSIX（scripts/packageExecutor.mjs）+ remote-ssh 0.106.x
//   装入隔离 profile；主扩展镜像到 ~/.vscode-server/extensions（workspace
//   kind → 远端 ext host），执行端（ui kind）留本机；
// - 工作区 fixture（三篇 md + 图片 + marker 文件）；runner 在本地 ext host
//   （suite.ts），被测命令经 executeCommand 跨 ext host 路由到远端；
// - 断连轮沿 V02 killProbeSshSession：杀探针 sshd 会话进程树，观察远端
//   不可达与伪产物缺席，宿主窗口由驱动器终结。
//
// 用法：node test/integration/runPdfRemoteE2E.mjs [--round=main|noexec|disconnect|all]
// 报告：out/test/t08-remote-e2e-<round>.log；产物：out/test/t08-e2e/<round>/；
// PDF 深检（pdfjs 页数/文本/书签）在本驱动器侧执行（node_modules 面可用）。
import { downloadAndUnzipVSCode } from '@vscode/test-electron'
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildTestHostArgs, evaluateHostReport, resolveTestHostMode, runTestHost } from './testHost.mjs'
import { installExtension, packageMainVsix } from './installSupport.mjs'
import {
  ensureRemoteSshVsix,
  mirrorExtensionsToRemoteServer,
  remoteSshProfileSettings,
  withRemoteArg,
} from './t17RemoteSsh.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outDir = path.join(root, 'out', 'test')
const vsixDir = path.join(outDir, 't08-e2e-vsix')
const artifactsRoot = path.join(outDir, 't08-e2e')
const remoteSshCacheDir = path.join(outDir, 't08-e2e-remote-ssh')
const remoteServerExtensionsDir = path.join(homedir(), '.vscode-server', 'extensions')
const SSH_HOST = process.env.VSIDIAN_T08_SSH_HOST ?? 'localhost'

const roundArg = process.argv.find((arg) => arg.startsWith('--round='))
const singleRound = roundArg ? roundArg.slice('--round='.length) : null
if (singleRound !== null && !['main', 'noexec', 'disconnect', 'all'].includes(singleRound)) {
  console.error(`[t08-e2e] 未知轮次 ${singleRound}（main/noexec/disconnect/all）`)
  process.exit(1)
}
const rounds = singleRound === null || singleRound === 'all' ? ['main', 'noexec', 'disconnect'] : [singleRound]

const summary = { startedAt: new Date().toISOString(), host: null, rounds: {} }

/** fixture 正文（三篇：主文档两页 + 中文标题 + 选区标记 + 相对图片；两篇子目录） */
const MAIN_MD = `# T08 远端主文档

REMOTE-MAIN-MARKER 首段内容：本正文由 vscode-server 读取，经跨 ext host 命令通道送达本机执行端渲染。

![远端图片](../img/t08-probe.png)

## 第二节 标题书签甲

选区标记甲：多选区第一段，导出时应严格切片进入产物。

## 第三节 标题书签乙

选区标记乙：多选区第二段，与第一段按文档顺序合成同一份 PDF。

分页之后内容。
`

const SECOND_MD = `# T08 第二篇（子目录）

REMOTE-SECOND-MARKER 第二篇正文：批量导出时应保留 sub/ 相对结构；合并时作为第二篇拼接。

## 第二篇小节
第二篇内容行。
`

const THIRD_MD = `# T08 第三篇（取消用例）

REMOTE-THIRD-MARKER 第三篇正文：本篇用于导出途中取消与断连轮的在途载荷。
`

/** 1×1 红色 PNG（合法最小图——图片资源走远端字节 → 执行端资源服务通道） */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function prepareWorkspace(round) {
  const artifactsDir = path.join(artifactsRoot, round)
  rmSync(artifactsDir, { recursive: true, force: true })
  const wsDir = mkdtempSync(path.join(tmpdir(), `vsidian-t08-${round}-`))
  mkdirSync(path.join(wsDir, 'sub'), { recursive: true })
  mkdirSync(path.join(wsDir, 'img'), { recursive: true })
  // 图片在工作区内 img/（相对路径 img/...——真实相对资源解析路径，不越工作区根）
  writeFileSync(path.join(wsDir, 'img', 't08-probe.png'), Buffer.from(TINY_PNG_BASE64, 'base64'))
  writeFileSync(path.join(wsDir, 't08-main.md'), MAIN_MD.replace('(../img/t08-probe.png)', '(img/t08-probe.png)'), 'utf8')
  writeFileSync(path.join(wsDir, 'sub', 't08-second.md'), SECOND_MD, 'utf8')
  writeFileSync(path.join(wsDir, 'sub', 't08-third.md'), THIRD_MD, 'utf8')
  mkdirSync(path.join(artifactsDir, 'saves'), { recursive: true })
  mkdirSync(path.join(artifactsDir, 'batch'), { recursive: true })
  const marker = round === 'disconnect'
    ? { hooks: true, saveTarget: path.join(artifactsDir, 'disconnect-target.pdf').replaceAll('\\', '/') }
    : { hooks: true, saveDir: path.join(artifactsDir, 'saves').replaceAll('\\', '/'), targetDir: path.join(artifactsDir, 'batch').replaceAll('\\', '/') }
  writeFileSync(path.join(wsDir, '.vsidian-pdf-remote-test.json'), JSON.stringify(marker, null, 2), 'utf8')
  return { wsDir, artifactsDir, marker }
}

function listPdf(dir) {
  const found = []
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = path.join(d, name)
      const info = statSync(full)
      if (info.isDirectory()) walk(full)
      else if (name.toLowerCase().endsWith('.pdf')) found.push(full)
    }
  }
  walk(dir)
  return found
}

/** 驱动器侧 pdfjs 深检（页数 + 关键文本 + 书签） */
async function verifyPdf(file, { minPages = 1, expectTexts = [], expectOutlineMin = 0 }) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(readFileSync(file))
  const loadingTask = pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false })
  const doc = await loadingTask.promise
  const problems = []
  if (doc.numPages < minPages) problems.push(`页数 ${doc.numPages} < ${minPages}`)
  const allText = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    allText.push(content.items.map((item) => ('str' in item ? item.str : '')).join(''))
  }
  const joined = allText.join('\n').normalize('NFKC')
  for (const text of expectTexts) {
    if (!joined.includes(text.normalize('NFKC'))) problems.push(`缺文本「${text}」`)
  }
  let outlineCount = 0
  const outline = await doc.getOutline().catch(() => null)
  const countOutline = (items) => {
    for (const item of items ?? []) {
      outlineCount += 1
      countOutline(item.items)
    }
  }
  countOutline(outline)
  if (outlineCount < expectOutlineMin) problems.push(`书签 ${outlineCount} < ${expectOutlineMin}`)
  await loadingTask.destroy()
  return { ok: problems.length === 0, problems, numPages: doc.numPages, outlineCount }
}

function chromeProcessCount() {
  const ps = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '@(Get-CimInstance Win32_Process -Filter "Name=\'chrome.exe\'" | Where-Object { $_.CommandLine -match "vsidian-pdfexport" }).Count'],
    { encoding: 'utf8', timeout: 30_000 })
  return Number((ps.stdout ?? '').trim()) || 0
}

/** 断连注入（V02 runRemoteProbe 同款锚定法）：杀含 1.82.3 CLI 进程的 sshd 会话 */
function killProbeSshSession() {
  const ps = [
    "$sshdIds = @(Get-CimInstance Win32_Process -Filter \"Name='sshd.exe'\" | ForEach-Object { $_.ProcessId })",
    "$conns = @(Get-CimInstance Win32_Process -Filter \"Name='sshd.exe'\" | Where-Object { $sshdIds -contains $_.ParentProcessId })",
    '$killed = @()',
    'foreach ($conn in $conns) {',
    '  $seen = @{}; $queue = @($conn); $hit = $false',
    '  for ($i = 0; $i -lt 14 -and $queue.Count -gt 0; $i++) {',
    '    $next = @()',
    '    foreach ($p in $queue) {',
    '      if ($seen.ContainsKey($p.ProcessId)) { continue } else { $seen[$p.ProcessId] = 1 }',
    '      if ($p.Name -like "code-fdb9883*") { $hit = $true; break }',
    '      $next += @(Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $p.ProcessId })',
    '    }',
    '    if ($hit) { break }',
    '    $queue = $next',
    '  }',
    '  if ($hit) { Write-Output ("KILL " + $conn.ProcessId); Stop-Process -Id $conn.ProcessId -Force; $killed += $conn }',
    '}',
    'if ($killed.Count -eq 0) { Write-Output "NOSESSION" }',
  ].join('\n')
  const kill = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 60_000 })
  return ((kill.stdout ?? '').split('\n').filter((l) => l.startsWith('KILL') || l.startsWith('NOSESSION')).map((l) => l.trim()))
}

const readMaybe = (file) => {
  try { return readFileSync(file, 'utf8') } catch { return null }
}

async function runRound(round, { executable, cliPath, mainVsix, executorVsix }) {
  console.log(`\n[t08-e2e] ===== 轮 ${round} =====`)
  const { wsDir, artifactsDir, marker } = prepareWorkspace(round)
  const roundDir = path.join(artifactsRoot, `${round}-profile`)
  rmSync(roundDir, { recursive: true, force: true })
  const extensionsDir = path.join(roundDir, 'extensions')
  const userDataDir = path.join(roundDir, 'user-data')
  mkdirSync(extensionsDir, { recursive: true })
  mkdirSync(path.join(userDataDir, 'User'), { recursive: true })

  const remoteSshVsix = await ensureRemoteSshVsix({ cacheDir: remoteSshCacheDir })
  const install = (vsix) => installExtension({ cliPath, vsix, extensionsDir, userDataDir, force: true })
  await install(remoteSshVsix)
  await install(mainVsix)
  if (round !== 'noexec') {
    await install(executorVsix)
    console.log(`[t08-e2e] 执行端 VSIX 已装（ui kind → 本机 ext host）`)
  } else {
    console.log('[t08-e2e] noexec 轮：不装执行端（缺失负向）')
  }
  // 主扩展 → 远端清单镜像（workspace kind 分发语义；断连轮镜像到隔离
  // server-home 的 extensions 目录——连接前就位，冷启动 server 直接装载）
  // 断连注入沿 V02 锚定法（会话进程树含 code-<commit> CLI 进程时命中）；
  // 暖 server 复用全局进程时树内无锚（实测 NOSESSION）——注入未命中时
  // 如实记录 skipInject，双出口判定仅在注入命中时要求
  const mirrorTarget = remoteServerExtensionsDir
  mkdirSync(mirrorTarget, { recursive: true })
  const mirrored = mirrorExtensionsToRemoteServer({
    serverExtensionsDir: mirrorTarget,
    localExtensionsDir: extensionsDir,
    includeIds: ['onegayi.vsidian'],
    governedIds: ['onegayi.vsidian'],
  })
  console.log(`[t08-e2e] 远端镜像：${mirrored.mirrored.length} 项`)

  const settings = remoteSshProfileSettings({ host: SSH_HOST, platform: 'windows' })
  const profileSettings = {
    ...settings,
    'extensions.autoUpdate': false,
    'update.mode': 'none',
    'extensions.ignoreRecommendations': true,
    'remote.SSH.showLoginTerminal': false,
  }
  // 断连轮隔离 server 数据目录（V02 runRemoteProbe 同款）：强制冷启动——
  // 会话进程树必含 code-<commit> CLI 进程（断连注入的锚定法依赖它；暖
  // server 复用全局进程时树内无锚，实测 NOSESSION 杀不中）
  writeFileSync(path.join(userDataDir, 'User', 'settings.json'), JSON.stringify(profileSettings, null, 2), 'utf8')

  // dev path 用空壳锚（测试模式要求 extensionDevelopmentPath 在场；被测扩展
  // 装载权威走 VSIX 安装 + 远端镜像——不注入 dev 副本）
  const anchor = path.join(roundDir, 'dev-anchor')
  mkdirSync(anchor, { recursive: true })
  writeFileSync(path.join(anchor, 'package.json'), JSON.stringify({ name: 'vsidian-t08-e2e-anchor', publisher: 'vsidian', version: '0.0.1', engines: { vscode: '^1.82.0' }, main: './extension.js' }), 'utf8')
  writeFileSync(path.join(anchor, 'extension.js'), 'function activate() {}\nmodule.exports = { activate }\n', 'utf8')

  const suiteOut = path.join(root, 'out', 'test', 'integration', 'pdfRemoteE2E', 'suite.js')
  if (!existsSync(suiteOut)) throw new Error(`缺少 ${suiteOut}——先 npm run compile（esbuild dev 产物线）`)
  const args = withRemoteArg(buildTestHostArgs({
    workspaceDir: wsDir,
    testsPath: suiteOut,
    extensionPath: anchor,
    extensionsDir,
    userDataDir,
  }), SSH_HOST)
  const env = { ...process.env, VSIDIAN_T08_ROUND: round, VSIDIAN_T08_SSH_HOST: SSH_HOST, VSIDIAN_T08_ARTIFACTS: artifactsDir.split('\\').join('/') }
  delete env.VSIDIAN_TEST_HOOKS // 发行态语义：远端会话钩子经 marker 文件
  const reportPath = path.join(outDir, `t08-remote-e2e-${round}.log`)
  console.log(`[t08-e2e] 启动宿主（报告 ${reportPath}；marker=${JSON.stringify(marker)}）`)

  const chromeBefore = chromeProcessCount()
  const result = { exitCode: -1, verdict: null, disconnect: null, verification: null }

  if (round === 'disconnect') {
    const hostPromise = runTestHost({ executable, args, env, timeoutMs: 6 * 60_000, reportPath })
    const disconnect = { markerSeenAtMs: null, killed: [], targetPdfAbsent: null, remoteUnreachableSeen: false }
    const t0 = Date.now()
    while (Date.now() - t0 < 180_000) {
      const text = readMaybe(reportPath) ?? ''
      if (text.includes('[probe-mark] in-flight')) {
        disconnect.markerSeenAtMs = Date.now() - t0
        console.log(`[t08-e2e][disconnect] in-flight 出现（${disconnect.markerSeenAtMs}ms），3s 后杀 SSH 会话`)
        break
      }
      if (text.includes('[集成测试][FAIL]')) break
      await new Promise((r) => setTimeout(r, 1000))
    }
    if (disconnect.markerSeenAtMs !== null) {
      await new Promise((r) => setTimeout(r, 3000))
      disconnect.killed = killProbeSshSession()
      console.log(`[t08-e2e][disconnect] 断连注入：${disconnect.killed.join(' | ') || '无命中'}`)
      // 等远端不可达 + 伪产物缺席观察窗（25s——保存由远端 orchestrator 驱动，
      // 远端死亡后不得出现产物；执行端浏览器由任务终结释放）
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 1000))
        const text = readMaybe(reportPath) ?? ''
        if (text.includes('[probe-mark] remote-unreachable')) disconnect.remoteUnreachableSeen = true
        if (disconnect.remoteUnreachableSeen && i > 22) break
      }
    }
    const target = marker.saveTarget
    disconnect.targetPdfAbsent = !existsSync(target)
    // 执行端任务终结释放观察（等待进程回收窗口）
    await new Promise((r) => setTimeout(r, 15_000))
    const chromeAfter = chromeProcessCount()
    disconnect.vsidianChromeAfter = chromeAfter
    // 宿主断连后停在重连界面——按 profile 目录匹配强杀收尾
    spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='Code.exe'" | Where-Object { $_.CommandLine -match [regex]::Escape('${roundDir.replace(/\\/g, '\\\\')}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`],
      { encoding: 'utf8', timeout: 30_000 })
    result.exitCode = await hostPromise
    const passed = disconnect.markerSeenAtMs !== null && disconnect.targetPdfAbsent === true && disconnect.killed.some((l) => l.startsWith('KILL'))
    result.verdict = { ok: passed, reason: passed ? '断连轮判定通过（伪产物缺席 + 断连生效）' : '断连轮未过（见 disconnect 观察）' }
    result.disconnect = disconnect
    console.log(`[t08-e2e][disconnect] 判定 ${passed ? '通过' : '未过'}：${JSON.stringify(disconnect)}`)
  } else {
    result.exitCode = await runTestHost({ executable, args, env, timeoutMs: 12 * 60_000, reportPath })
    const verdict = evaluateHostReport((readMaybe(reportPath) ?? '').split(/\r?\n/), result.exitCode)
    result.verdict = verdict
    // 产物深检（pdfjs）：main 轮四份产物；noexec 轮应零产物
    const pdfs = listPdf(artifactsDir)
    if (round === 'main') {
      const verification = []
      const byName = (needle) => pdfs.find((p) => p.replaceAll('\\', '/').includes(needle))
      const checks = [
        { file: byName('saves/single/t08-main.pdf'), minPages: 1, expectTexts: ['REMOTE-MAIN-MARKER'], expectOutlineMin: 3, label: '当前文档（全文，书签开）' },
        { file: byName('saves/selection/t08-main.pdf'), minPages: 1, expectTexts: ['选区标记甲', '选区标记乙'], expectOutlineMin: 0, label: '选区（两片段，书签默认关）' },
        { file: byName('saves/reuse/t08-main.pdf'), minPages: 1, expectTexts: ['REMOTE-MAIN-MARKER'], expectOutlineMin: 0, label: '预览复用导出（书签默认关）' },
        { file: byName('batch/sub/t08-second.pdf'), minPages: 1, expectTexts: ['REMOTE-SECOND-MARKER'], expectOutlineMin: 0, label: '批量子目录（书签默认关）' },
        { file: byName('batch/t08-main.pdf'), minPages: 1, expectTexts: ['REMOTE-MAIN-MARKER'], expectOutlineMin: 0, label: '批量主文档（书签默认关）' },
        { file: byName('saves/merge/t08-main.pdf'), minPages: 3, expectTexts: ['REMOTE-MAIN-MARKER', 'REMOTE-SECOND-MARKER', 'REMOTE-THIRD-MARKER'], expectOutlineMin: 4, label: '合并（三篇）' },
      ]
      for (const check of checks) {
        if (check.file === undefined) {
          if (!check.file && check.label.startsWith('选区')) continue
          verification.push({ label: check.label, ok: false, problems: ['产物缺失'] })
          continue
        }
        const outcome = await verifyPdf(check.file, check)
        verification.push({ label: check.label, file: check.file, ...outcome })
      }
      result.verification = verification
      const verifyOk = verification.every((v) => v.ok)
      console.log(`[t08-e2e] pdfjs 深检：${verifyOk ? '全部通过' : '存在失败'}\n${JSON.stringify(verification, null, 2)}`)
      if (!verifyOk) result.verdict = { ok: false, reason: 'pdfjs 深检存在失败项' }
    } else if (round === 'noexec') {
      const zeroProduct = pdfs.length === 0
      result.verification = { zeroProduct, pdfs }
      console.log(`[t08-e2e] noexec 产物缺席核验：${zeroProduct ? '通过（零产物）' : `失败（${pdfs.join(',')}）`}`)
      if (!zeroProduct) result.verdict = { ok: false, reason: 'noexec 轮出现伪产物' }
    }
    const chromeAfter = chromeProcessCount()
    result.chromeLeak = chromeAfter
    console.log(`[t08-e2e] 轮 ${round} 退出码 ${result.exitCode}（判定 ${result.verdict.ok ? '通过' : result.verdict.reason}；vsidian chrome 残留 ${chromeAfter}——轮前 ${chromeBefore}）`)
  }

  summary.rounds[round] = {
    reportPath, wsDir, artifactsDir, marker,
    exitCode: result.exitCode,
    verdict: result.verdict,
    disconnect: result.disconnect,
    verification: result.verification,
    pdfs: listPdf(artifactsDir),
    chromeLeak: result.chromeLeak ?? null,
  }
  // 工作区清理尽力而为（Windows 句柄延迟——失败留痕不阻断）
  try { rmSync(wsDir, { recursive: true, force: true, maxRetries: 3 }) } catch (err) {
    console.warn(`[t08-e2e] 工作区清理跳过（${err.code ?? err.message}）`)
  }
  return result.verdict.ok
}

async function main() {
  if (!existsSync(path.join(root, 'out', 'extension.js'))) throw new Error('先 npm run compile')
  const executable = process.env.VSIDIAN_TEST_VSCODE_PATH
    ?? path.join(root, '.vscode-test', 'vscode-win32-x64-archive-1.82.3', 'Code.exe')
  if (!existsSync(executable)) throw new Error(`便携宿主不存在：${executable}（设 VSIDIAN_TEST_VSCODE_PATH）`)
  const cliPath = path.join(path.dirname(executable), 'bin', 'code.cmd')
  summary.host = executable

  mkdirSync(vsixDir, { recursive: true })
  const mainVsix = path.join(vsixDir, 'vsidian-main.vsix')
  await packageMainVsix({ root, outVsix: mainVsix })
  const executorVsix = path.join(vsixDir, 'vsidian-pdf-executor.vsix')
  const pkg = spawnSync(process.execPath, [path.join(root, 'scripts', 'packageExecutor.mjs'), '--out', executorVsix], { encoding: 'utf8', cwd: root, timeout: 300_000 })
  if (pkg.status !== 0) throw new Error(`执行端打包失败：${pkg.stdout}\n${pkg.stderr}`)
  console.log(`[t08-e2e] VSIX 就绪（主 ${statSync(mainVsix).size}B / 执行端 ${statSync(executorVsix).size}B）`)

  let allOk = true
  for (const round of rounds) {
    const ok = await runRound(round, { executable, cliPath, mainVsix, executorVsix })
    allOk = allOk && ok
  }
  writeFileSync(path.join(outDir, 't08-remote-e2e-summary.json'), JSON.stringify(summary, null, 2), 'utf8')
  console.log(`\n[t08-e2e] 汇总 ${path.join(outDir, 't08-remote-e2e-summary.json')}；总体 ${allOk ? '通过' : '未过'}`)
  process.exitCode = allOk ? 0 : 1
}

main().catch((err) => {
  console.error('[t08-e2e] 运行失败', err)
  writeFileSync(path.join(outDir, 't08-remote-e2e-summary.json'), JSON.stringify({ ...summary, error: String(err) }, null, 2), 'utf8')
  process.exitCode = 1
})
