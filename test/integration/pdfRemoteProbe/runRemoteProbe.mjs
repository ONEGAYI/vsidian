// #620（V02）Remote SSH 最小闭环探针启动器。
// 流程：构建（build.mjs）-> 每轮隔离 profile/extensions -> CLI 安装
// remote-ssh 0.105.0（+ 轮 B 的 ui/dual VSIX）-> 独立桌面宿主以
// --remote ssh-remote+localhost 打开 fixture 远端工作区跑套件：
//   轮 A（dev 形态）：三扩展均走 --extensionDevelopmentPath；
//   轮 B（VSIX 形态）：ui/dual 经 VSIX 安装（生产分发语义），workspace 走 dev；
//   轮 C（断连轮）：disconnectSuite 发起挂起任务后，驱动器杀 vscode-server
//     进程，观察宿主断连行为与本机执行端的迟到完成（disconnect-round.pdf）。
// 全部宿主/SSH 操作首跑即落盘日志与退出码（.vscode-test/pdf-remote-probe/）。
// 复现：
//   node test/integration/pdfRemoteProbe/build.mjs
//   node test/integration/pdfRemoteProbe/runRemoteProbe.mjs            # 三轮全跑
//   node test/integration/pdfRemoteProbe/runRemoteProbe.mjs --round=B  # 定向单轮

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runTestHost, evaluateHostReport } from '../testHost.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const probeDir = path.dirname(fileURLToPath(import.meta.url))
const cacheDir = path.join(root, '.vscode-test', 'pdf-remote-probe')
const outRoot = path.join(root, 'out', 'test', 'integration', 'pdfRemoteProbe')
const fixtureDir = path.join(outRoot, 'fixture')

const remoteSshVsix = path.join(cacheDir, 'rs-0.105.0.vsix')
const executable = process.env.VSIDIAN_TEST_VSCODE_PATH
  ?? 'D:\\CODE\\Project\\_Extensions\\vsidian\\.vscode-test\\vscode-win32-x64-archive-1.82.3\\Code.exe'
const codeCli = path.join(path.dirname(executable), 'bin', 'Code.cmd')

const roundFlag = process.argv.find((arg) => arg.startsWith('--round='))
const rounds = roundFlag ? [roundFlag.slice('--round='.length).toUpperCase()] : ['A', 'B', 'C']

mkdirSync(cacheDir, { recursive: true })
if (!existsSync(executable)) throw new Error(`便携宿主不存在：${executable}`)
if (!existsSync(codeCli)) throw new Error(`宿主 CLI 不存在：${codeCli}`)
if (!existsSync(remoteSshVsix)) throw new Error(`remote-ssh vsix 不存在：${remoteSshVsix}（见 download-remote-ssh 日志）`)
if (!existsSync(path.join(fixtureDir, 'sample.md'))) {
  const build = spawnSync(process.execPath, [path.join(probeDir, 'build.mjs')], { stdio: 'inherit', cwd: root })
  if (build.status !== 0) throw new Error(`build.mjs 失败（${build.status}）`)
}

const summary = { startedAt: new Date().toISOString(), host: executable, rounds: {} }

for (const round of rounds) {
  console.log(`\n[pdfRemoteProbe] ===== 轮 ${round} =====`)
  const runDir = path.join(cacheDir, `run-${round.toLowerCase()}-${Date.now()}`)
  const userDataDir = path.join(runDir, 'user-data')
  const extensionsDir = path.join(runDir, 'extensions')
  const artifactsDir = path.join(runDir, 'artifacts')
  // 每轮独立 vscode-server 目录（remote.SSH.serverInstallPath）。0.105 对
  // Windows 远端实测走 code CLI 通道：serverInstallPath 是根目录，其下自动
  // 建 .vscode-server（code-<commit>.exe CLI 由扩展自动下载或预置，真 server
  // 进程由 CLI 从全局 ~/.vscode/cli/servers 拉起——二进制全局共享，扩展目录
  // 独立）。workspace 扩展经「目录放置 + extensions.json 注册」模拟 marketplace
  // 自动分发（探针扩展不在 marketplace；用户 ~/.vscode-server 已有
  // onegayi.vsidian-0.11.0 证明 marketplace 分发通路存在）。
  const serverHome = path.join(runDir, 'server-home')
  const serverDataDir = path.join(serverHome, '.vscode-server')
  const serverExtDir = path.join(serverDataDir, 'extensions')
  mkdirSync(serverExtDir, { recursive: true })
  // 预置 code CLI（若用户目录已有同 commit CLI 则拷入，避免每轮重复下载）
  const userCli = path.join(process.env.USERPROFILE ?? '', '.vscode-server', 'code-fdb98833154679dbaa7af67a5a29fe19e55c2b73.exe')
  if (existsSync(userCli)) cpSync(userCli, path.join(serverDataDir, 'code-fdb98833154679dbaa7af67a5a29fe19e55c2b73.exe'))
  writeFileSync(path.join(serverExtDir, 'extensions.json'), '[]', 'utf8')
  if (round === 'B' || round === 'C') {
    const extName = 'vsidian.pdf-remote-probe-workspace-0.0.1'
    cpSync(path.join(outRoot, 'exts', 'workspace'), path.join(serverExtDir, extName), { recursive: true })
    writeFileSync(path.join(serverExtDir, 'extensions.json'), JSON.stringify([{
      identifier: { id: 'vsidian.pdf-remote-probe-workspace' },
      version: '0.0.1',
      location: { $mid: 1, path: serverExtDir.replaceAll('\\', '/').replace(/^([A-Za-z]):/, '/$1:') + '/' + extName, scheme: 'file' },
      relativeLocation: extName,
      metadata: { installedTimestamp: Date.now(), publisherDisplayName: 'vsidian', isPreReleaseVersion: false },
    }]), 'utf8')
  }
  mkdirSync(extensionsDir, { recursive: true })
  mkdirSync(artifactsDir, { recursive: true })
  mkdirSync(path.join(userDataDir, 'User'), { recursive: true })
  // remotePlatform 预设，防止首连弹平台选择框阻塞自动化。
  // 注意 0.105 的归一化只认小写枚举值（"windows"/"macOS"/"linux"），
  // 大写 "Windows" 会被静默忽略——首连即弹 QuickPick 挂死（实测踩坑）
  writeFileSync(path.join(userDataDir, 'User', 'settings.json'), JSON.stringify({
    'remote.SSH.remotePlatform': { localhost: 'windows' },
    'remote.SSH.serverInstallPath': { localhost: serverHome },
    'remote.SSH.showLoginTerminal': false,
    'extensions.autoUpdate': false,
    'update.mode': 'none',
    'extensions.ignoreRecommendations': true,
  }, null, 2), 'utf8')

  const installLog = []
  const install = (vsix) => {
    // Node 24 起 spawn .cmd 直调报 EINVAL（CVE-2024-27980 收紧），经 cmd.exe 调用
    const result = spawnSync('cmd.exe', ['/c', codeCli,
      `--user-data-dir=${userDataDir}`, `--extensions-dir=${extensionsDir}`,
      '--install-extension', vsix, '--force',
    ], { encoding: 'utf8', timeout: 120_000 })
    installLog.push({ vsix, status: result.status, stdout: (result.stdout || '').trim().slice(-400), stderr: (result.stderr || '').trim().slice(-400) })
    if (result.status !== 0) throw new Error(`安装失败 ${vsix}：${result.stdout} ${result.stderr}`)
  }
  install(remoteSshVsix)
  if (round === 'B' || round === 'C') {
    // VSIX 形态（生产分发语义）：workspace/ui/dual 全经 VSIX 安装，按各自
    // extensionKind 分发到 remote/local ext host；dev path 仅留空壳占位
    // （extensionTestsPath 依赖 extensionDevelopmentPath 同时存在，且避免
    // 同名扩展 dev/VSIX 双份装载）。轮 A 实测：dev 形态下全部扩展（含
    // workspace kind）都装载在 local ext host，remote 端不装载。
    install(path.join(outRoot, 'vsix', 'workspace-0.0.1.vsix'))
    install(path.join(outRoot, 'vsix', 'ui-0.0.1.vsix'))
    install(path.join(outRoot, 'vsix', 'dual-0.0.1.vsix'))
  }
  writeFileSync(path.join(runDir, 'install-log.json'), JSON.stringify(installLog, null, 2), 'utf8')
  console.log(`[pdfRemoteProbe] 扩展安装完成（${installLog.length} 项）`)

  const activationLogPath = path.join(artifactsDir, 'activation-log.jsonl')
  const devPaths = {
    A: ['workspace', 'ui', 'dual'].map((name) => path.join(outRoot, 'exts', name)),
    B: [path.join(outRoot, 'exts', 'shell')],
    C: [path.join(outRoot, 'exts', 'shell')],
  }[round]

  const args = [
    '--no-sandbox', '--disable-gpu-sandbox', '--disable-updates', '--skip-welcome', '--skip-release-notes',
    '--no-cached-data', '--disable-workspace-trust', '--disable-crash-reporter',
    '--remote', 'ssh-remote+localhost', fixtureDir,
    ...devPaths.map((p) => `--extensionDevelopmentPath=${p}`),
    `--extensionTestsPath=${path.join(outRoot, round === 'C' ? 'disconnectSuite.js' : 'suite.js')}`,
    `--extensions-dir=${extensionsDir}`,
    `--user-data-dir=${userDataDir}`,
  ]
  const env = {
    ...process.env,
    VSIDIAN_PDF_REMOTE_ARTIFACTS: artifactsDir,
    VSIDIAN_PDF_REMOTE_ACTIVATION_LOG: activationLogPath,
    VSIDIAN_PDF_EXPORT_PROBE_DIST: path.join(root, 'out', 'test', 'integration', 'pdfExportProbe'),
    VSIDIAN_PDF_REMOTE_HOST_ENV_MARKER: '1',
  }
  const reportPath = path.join(runDir, round === 'C' ? 'disconnect.log' : `run-${round.toLowerCase()}.log`)
  console.log(`[pdfRemoteProbe] 启动宿主（轮 ${round}），日志 ${reportPath}`)

  let exitCode = -1
  let disconnectObservations = null
  if (round === 'C') {
    const outcome = await runDisconnectRound({ args, env, reportPath, runDir, artifactsDir })
    exitCode = outcome.exitCode
    disconnectObservations = outcome.observations
    console.log(`[pdfRemoteProbe] 轮 C 完成（判定 ${exitCode === 0 ? '通过' : '未过'}）`)
  } else {
    exitCode = await runTestHost({ executable, args, env, timeoutMs: 8 * 60_000, reportPath })
    console.log(`[pdfRemoteProbe] 轮 ${round} 宿主退出码 ${exitCode}`)
    cleanupServerProcesses(runDir, serverHome)
  }

  const verdict = round === 'C'
    ? { ok: exitCode === 0, reason: exitCode === 0 ? '断连轮判定通过（marker + 迟到产物）' : '断连轮判定未过（见 disconnect-observations.json）', rawExitCode: exitCode }
    : { ...collectVerdict(reportPath, exitCode), rawExitCode: exitCode }
  summary.rounds[round] = {
    runDir, exitCode, verdict,
    artifacts: listFiles(artifactsDir),
    activationLog: readMaybe(activationLogPath),
    probeData: collectProbeData(reportPath),
    disconnectObservations,
  }
  rmSync(extensionsDir, { recursive: true, force: true, maxRetries: 3 })
  // user-data 保留（logs 内含 remote-ssh/remote ext host 日志，证据；体量小）。
  // 预置的 code CLI exe ~100MB：轮尾尽力释放（进程未退尽时 EPERM 不致命）
  try {
    rmSync(path.join(serverDataDir, 'code-fdb98833154679dbaa7af67a5a29fe19e55c2b73.exe'), { force: true, maxRetries: 3 })
  } catch (err) {
    console.warn(`[pdfRemoteProbe] CLI exe 清理跳过（${err.code ?? err.message}）`)
  }
}

const reportJson = path.join(cacheDir, 'pdf-remote-probe-report.json')
writeFileSync(reportJson, JSON.stringify(summary, null, 2), 'utf8')
console.log(`\n[pdfRemoteProbe] 汇总报告 ${reportJson}`)
const anyFail = Object.values(summary.rounds).some((r) => !r.verdict.ok)
process.exitCode = anyFail ? 1 : 0

function listFiles(dir) {
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir).filter((f) => f !== 'activation-log.jsonl')
  } catch {
    return []
  }
}

function readMaybe(file) {
  try { return readFileSync(file, 'utf8') } catch { return null }
}

function collectProbeData(reportPath) {
  try {
    return readFileSync(reportPath, 'utf8').split('\n')
      .filter((line) => line.startsWith('[probe-data] '))
      .map((line) => JSON.parse(line.slice('[probe-data] '.length)))
  } catch {
    return []
  }
}

function collectVerdict(reportPath, exitCode) {
  try {
    const lines = readFileSync(reportPath, 'utf8').split('\n')
    return evaluateHostReport(lines, exitCode)
  } catch (err) {
    return { ok: false, reason: `报告读取失败：${err.message}` }
  }
}

/** 断连注入：杀探针连接对应的 sshd 会话进程（= 断开该 SSH 连接，等同
 * 网络中断；不动 sshd 服务本身）。锚定法：remote-ssh 0.105 在 Windows 用
 * 内建 ssh2 库直连（无 ssh.exe 子进程可杀；sshd 会话内进程对非提升 WMI
 * 不可见），但探针连接的会话子树必含 1.82.3 专属的 code-fdb98833 CLI
 * 进程——按该名字找子树命中的 sshd 连接进程，整体断开，零误杀。 */
function killProbeSshSession() {
  const ps = [
    "$sshdIds = @(Get-CimInstance Win32_Process -Filter \"Name='sshd.exe'\" | ForEach-Object { $_.ProcessId })",
    '$conns = @(Get-CimInstance Win32_Process -Filter "Name=\'sshd.exe\'" | Where-Object { $sshdIds -contains $_.ParentProcessId })',
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
    '  if ($hit) { Write-Output ("KILL " + $conn.ProcessId + " sshd-conn(parent=" + $conn.ParentProcessId + ")"); Stop-Process -Id $conn.ProcessId -Force; $killed += $conn }',
    '}',
    'if ($killed.Count -eq 0) { Write-Output "NOSESSION" }',
  ].join('\n')
  const kill = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', timeout: 60_000 })
  return ((kill.stdout || '').split('\n').filter((l) => l.startsWith('KILL') || l.startsWith('NOSESSION')).map((l) => l.trim()))
}

function cleanupServerProcesses(runDir, serverHome) {
  // 宿主退出即断连；server 以 --enable-remote-auto-shutdown 启动会自行退出。
  // sshd 会话内进程对本机非提升查询不可见（实测），不做进程枚举清理，
  // 记录 serverHome 残留状态供复核。
  writeFileSync(path.join(runDir, 'server-cleanup.txt'), `宿主已退出；server auto-shutdown 语义，serverHome=${serverHome}\n`, 'utf8')
}

/** 断连轮：宿主启动后监听报告文件，见 in-flight marker 后 4s 杀 server 进程，
 * 再等 70s 观察本机执行端迟到完成（disconnect-round.pdf），随后收尾杀宿主。 */
async function runDisconnectRound({ args, env, reportPath, runDir, artifactsDir }) {
  const hostPromise = runTestHost({ executable, args, env, timeoutMs: 6 * 60_000, reportPath })
  const observations = { markerSeenAtMs: null, killedServerProcs: [], disconnectEffective: false, latePdf: null, hostExitBehavior: '' }
  const t0 = Date.now()
  while (Date.now() - t0 < 150_000) {
    const text = readMaybe(reportPath) ?? ''
    if (text.includes('[probe-mark] in-flight')) {
      observations.markerSeenAtMs = Date.now() - t0
      console.log(`[pdfRemoteProbe][C] marker 出现（${observations.markerSeenAtMs}ms），4s 后杀 vscode-server`)
      break
    }
    if (text.includes('[集成测试][FAIL]') || text.includes('never-disconnected')) break
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  if (observations.markerSeenAtMs === null) {
    console.error('[pdfRemoteProbe][C] 150s 未见 in-flight marker（server 启动失败或 suite 早退），跳过断连注入，仅观察日志')
  } else {
    await new Promise((resolve) => setTimeout(resolve, 4000))
    // 断连注入：杀宿主进程树内的 ssh.exe 客户端（= 用户侧网络中断）。
    // sshd 会话内的 server 进程对本机非提升 WMI 不可见，无法按名杀；
    // 杀客户端连接即真实断连（任务书允许「kill server 或断开」两种形态）。
    observations.killedServerProcs = killProbeSshSession()
    observations.disconnectEffective = observations.killedServerProcs.some((l) => l.startsWith('KILL'))
    console.log(`[pdfRemoteProbe][C] 断连注入（杀探针 sshd 连接会话）：${observations.killedServerProcs.join(' | ') || '无命中'}——${observations.disconnectEffective ? '断连生效' : '断连无效'}`)
    writeFileSync(path.join(runDir, 'kill-server-log.txt'), `markerAt=${observations.markerSeenAtMs}ms\n${observations.killedServerProcs.join('\n')}`, 'utf8')
  }
  // 等 70s：观察本机执行端迟到完成 + 宿主行为
  await new Promise((resolve) => setTimeout(resolve, 70_000))
  const latePdfPath = path.join(artifactsDir, 'disconnect-round.pdf')
  if (existsSync(latePdfPath)) {
    const info = statSync(latePdfPath)
    const killedAt = t0 + observations.markerSeenAtMs + 4000
    observations.latePdf = { path: latePdfPath, size: info.size, mtime: info.mtime.toISOString(), msAfterKill: info.mtime.getTime() - killedAt }
    console.log(`[pdfRemoteProbe][C] 本机执行端迟到完成：disconnect-round.pdf ${info.size}B（杀 server 后约 ${observations.latePdf.msAfterKill}ms 生成）`)
  } else {
    console.log('[pdfRemoteProbe][C] 未见迟到产物 disconnect-round.pdf')
  }
  // 杀宿主收尾（宿主断连后停在重连界面，不会自退）
  const killHost = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `Get-CimInstance Win32_Process -Filter "Name='Code.exe'" | Where-Object { $_.CommandLine -match [regex]::Escape('${runDir.replace(/\\/g, '\\\\')}') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`], { encoding: 'utf8', timeout: 30_000 })
  observations.hostExitBehavior = `断连后宿主窗口存活（重连界面），由驱动器按 runDir 匹配强制结束（kill exit=${killHost.status}）`
  const exitCode = await hostPromise
  writeFileSync(path.join(runDir, 'disconnect-observations.json'), JSON.stringify(observations, null, 2), 'utf8')
  const passed = observations.markerSeenAtMs !== null && observations.latePdf !== null && observations.disconnectEffective
  return { exitCode: passed ? 0 : 1, observations }
}
