import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { buildTestHostArgs, cleanupTestDirs, createPortableShardHost, evaluateHostReport, resolveTestHostMode, runTestHost, writeTestWorkspaceFile } from './testHost.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))

// 用户显式选择前台模式（如 SSH / 服务会话等无交互桌面的 Windows 环境，
// CreateDesktop 无法工作）时跳过独立桌面专项——与集成启动器的模式开关
// （VSIDIAN_TEST_HOST_MODE）同一语义，保证 npm run test:unit 有逃生门。
const skipDesktop = process.platform !== 'win32' || process.env.VSIDIAN_TEST_HOST_MODE === 'foreground'

// 探针及其子进程最长 4.5 秒后自行退出；失败的 RED 阶段也不会留下长驻进程。
const childProbeScript = 'require("node:fs").writeFileSync(process.argv[1], String(process.pid)); setTimeout(() => process.exit(0), 4500)'
const probeScript = [
  'const fs = require("node:fs")',
  'const { spawn } = require("node:child_process")',
  'fs.writeFileSync(process.argv[1], String(process.pid))',
  `spawn(process.execPath, ["-e", ${JSON.stringify(childProbeScript)}, process.argv[2]], { stdio: "ignore" })`,
  'setTimeout(() => process.exit(0), 4500)',
].join('; ')

function running(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}

async function waitUntil(check, timeoutMs = 3000) {
  const until = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > until) throw new Error('探针进程未在限时内启动')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

function stopProbePids(files) {
  for (const file of files) {
    if (!existsSync(file)) continue
    const pid = Number(readFileSync(file, 'utf8'))
    if (running(pid)) process.kill(pid)
  }
}

test('集成测试有两种运行路径共用的宿主启动器', () => {
  assert.equal(existsSync(path.join(here, 'testHost.mjs')), true)
  assert.equal(existsSync(path.join(here, 'hiddenDesktop.ps1')), true)
})

test('开发态、安装态与空窗口激活启动器都接入共用宿主启动器', () => {
  for (const launcher of ['runTest.mjs', 'runInstalled.mjs', 'runSettingsActivation.mjs']) {
    const source = readFileSync(path.join(here, launcher), 'utf8')
    assert.match(source, /from '\.\/testHost\.mjs'/)
    assert.match(source, /buildTestHostArgs\(/)
    assert.match(source, /runTestHost\(/)
  }
})

test('开发态和安装态都用相同参数集并隔离 profile', () => {
  const base = {
    workspaceDir: 'D:\\fixture',
    testsPath: 'D:\\suite\\index.js',
    extensionsDir: 'D:\\cache\\extensions',
    userDataDir: 'D:\\cache\\user-data',
  }
  const dev = buildTestHostArgs({ ...base, extensionPath: 'D:\\repo' })
  const installed = buildTestHostArgs({ ...base, extensionPath: 'D:\\installed' })
  assert.deepEqual(
    installed,
    dev.map((arg) => arg === '--extensionDevelopmentPath=D:\\repo'
      ? '--extensionDevelopmentPath=D:\\installed'
      : arg),
  )
  assert.ok(dev.includes('--extensionTestsPath=D:\\suite\\index.js'))
  assert.ok(dev.includes('--extensions-dir=D:\\cache\\extensions'))
  assert.ok(dev.includes('--user-data-dir=D:\\cache\\user-data'))
  assert.equal(dev.at(-1), 'D:\\fixture')
  assert.ok(buildTestHostArgs({ ...base, extensionPath: 'D:\\repo', disableExtensions: true }).includes('--disable-extensions'))
})

test('并行宿主共用程序但使用各自的便携数据目录与环境变量', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vsidian-portable-shards-'))
  const inherited = { VSCODE_PORTABLE: 'inherited', MARKER: 'kept' }
  try {
    const first = createPortableShardHost(dir, 1, inherited)
    const second = createPortableShardHost(dir, 2, inherited)
    assert.notEqual(first.portableDir, second.portableDir)
    for (const shard of [first, second]) {
      assert.equal(existsSync(shard.portableDir), true, 'VSCode 启动前必须预建便携目录')
      assert.equal(shard.userDataDir, path.join(shard.portableDir, 'user-data'))
      assert.equal(shard.extensionsDir, path.join(shard.portableDir, 'extensions'))
      assert.equal(shard.env.VSCODE_PORTABLE, shard.portableDir)
      assert.equal(shard.env.MARKER, 'kept')
    }
    assert.equal(inherited.VSCODE_PORTABLE, 'inherited', '不得修改父进程环境')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('writeTestWorkspaceFile 生成单 folder 的 .code-workspace：multi-root 形态起步（#198 根增删不触发 reload）', () => {
  const writes = []
  const dir = path.join(tmpdir(), 'vsidian-wsfile', 'ws')
  const file = writeTestWorkspaceFile(dir, (p, content) => writes.push({ p, content }))
  // 文件是工作区目录的兄弟文件（不进任何根的扫描范围），名字随目录
  assert.ok(file.endsWith(`${path.sep}ws.code-workspace`), `workspace 文件路径形态：${file}`)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].p, file)
  // folders 恰一个（= fixture 工作区根）、路径正斜杠（Windows 反斜杠的 JSON 转义形态免歧义）
  const parsed = JSON.parse(writes[0].content)
  assert.deepEqual(parsed.folders, [{ path: dir.split(path.sep).join('/') }])
})

// #254 启动器契约：宿主退出码非零时的报告判定不得只数 FAIL 行——
// 「零 FAIL 但计划用例未全部取得终态」是被 #211 收尾噪声放行逻辑误放行过的
// 真实形态（实测计划 59 项只执行 53 项被静默放行）。四类判定契约钉住：
// 判败必须列出缺失用例的身份（有 START 无终态的名称 + 未开始数量）。
function caseLog(kind, name) {
  return `[集成测试][${kind}] ${name}`
}

function reportLines({ plan, pass = [], fail = [], startedWithoutEnd = [], noiseExit = 1 }) {
  const lines = [`[testHost] 运行报告 2026-10-01T00:00:00.000Z`]
  if (plan) lines.push(`[集成测试] 执行 ${plan.executed}/${plan.total} 项${plan.detail ?? ''}`)
  for (const name of pass) {
    lines.push(caseLog('START', name))
    lines.push(caseLog('PASS', name))
    lines.push(`[集成测试][TIME] 12ms ${name}`)
  }
  for (const name of fail) {
    lines.push(caseLog('START', name))
    lines.push(caseLog('FAIL', name))
    lines.push(`[集成测试][TIME] 12ms ${name}`)
  }
  for (const name of startedWithoutEnd) lines.push(caseLog('START', name))
  lines.push(`[testHost] 宿主退出码 ${noiseExit}`)
  return lines
}

test('报告判定：零 FAIL 但零终态（首用例即截断）必须判败并点名缺失用例', () => {
  const verdict = evaluateHostReport(reportLines({
    plan: { executed: 1, total: 234 },
    startedWithoutEnd: ['索引维护：工作区根增删与嵌套根归属（#198）'],
  }), 1)
  assert.equal(verdict.ok, false)
  assert.equal(verdict.pardon, false)
  assert.equal(verdict.failCount, 0)
  assert.equal(verdict.planned, 1)
  assert.equal(verdict.doneCount, 0)
  assert.deepEqual(verdict.missing, ['索引维护：工作区根增删与嵌套根归属（#198）'])
  assert.equal(verdict.notStarted, 0)
  assert.match(verdict.reason, /索引维护：工作区根增删/)
})

test('报告判定：分片中途缺项（有 START 无终态）判败并区分缺终态与未开始', () => {
  const passed = Array.from({ length: 52 }, (_, i) => `用例 ${i + 1}`)
  const verdict = evaluateHostReport(reportLines({
    plan: { executed: 59, total: 234, detail: '（分片 2/4，本片 59 项）' },
    pass: passed,
    startedWithoutEnd: ['跨根 rename（#199）', '悬停预览刷新（#224）', '图片三层失效（#201）'],
  }), 1)
  assert.equal(verdict.ok, false)
  assert.equal(verdict.doneCount, 52)
  assert.deepEqual(verdict.missing, ['跨根 rename（#199）', '悬停预览刷新（#224）', '图片三层失效（#201）'])
  // START 共 55（52 完成 + 3 无终态），59 - 55 = 4 项未开始
  assert.equal(verdict.notStarted, 4)
  assert.match(verdict.reason, /3 项有始无终/)
  assert.match(verdict.reason, /4 项未开始/)
})

test('报告判定：筛选用例缺项同样判败（计划 2 项只终态 1 项）', () => {
  const verdict = evaluateHostReport(reportLines({
    plan: { executed: 2, total: 234, detail: '（筛选 "根增删,rename"）' },
    pass: ['工作区根增删（#198）'],
  }), 1)
  assert.equal(verdict.ok, false)
  assert.deepEqual(verdict.missing, [])
  assert.equal(verdict.notStarted, 1)
})

test('报告判定：全部计划用例取得终态且零 FAIL 的非零退出按 #211 噪声放行', () => {
  const passed = Array.from({ length: 59 }, (_, i) => `用例 ${i + 1}`)
  const verdict = evaluateHostReport(reportLines({
    plan: { executed: 59, total: 234, detail: '（分片 2/4，本片 59 项）' },
    pass: passed,
  }), 1)
  assert.equal(verdict.ok, true)
  assert.equal(verdict.pardon, true)
  assert.equal(verdict.failCount, 0)
  assert.equal(verdict.doneCount, 59)
})

test('报告判定：存在 FAIL 行时无论终态计数如何都判败；退出码 0 直接通过', () => {
  const failed = evaluateHostReport(reportLines({
    plan: { executed: 2, total: 2 },
    pass: ['用例 1'],
    fail: ['用例 2'],
  }), 1)
  assert.equal(failed.ok, false)
  assert.equal(failed.pardon, false)
  assert.equal(failed.failCount, 1)
  assert.match(failed.reason, /FAIL 1/)

  const zeroExit = evaluateHostReport(reportLines({ plan: { executed: 1, total: 1 }, pass: ['用例 1'] }), 0)
  assert.equal(zeroExit.ok, true)
  assert.equal(zeroExit.pardon, false)
})

test('报告判定：报告缺计划行（执行 N/M）时不得放行非零退出', () => {
  const verdict = evaluateHostReport([
    '[testHost] 运行报告 2026-10-01T00:00:00.000Z',
    '[testHost] 宿主退出码 1',
  ], 1)
  assert.equal(verdict.ok, false)
  assert.equal(verdict.planned, 0)
  assert.match(verdict.reason, /计划行/)
})

test('runTest 非零退出的放行判定经 evaluateHostReport 而非内联数行', () => {
  const source = readFileSync(path.join(here, 'runTest.mjs'), 'utf8')
  assert.match(source, /evaluateHostReport\(/)
})

test('runTest 支持 VSIDIAN_TEST_VSCODE_PATH 指定已解压宿主跳过下载（下界验证通道）', () => {
  const source = readFileSync(path.join(here, 'runTest.mjs'), 'utf8')
  assert.match(source, /VSIDIAN_TEST_VSCODE_PATH/)
  // 有 override 时不得仍触发 1.86.2 下载（短路在 downloadAndUnzipVSCode 之前）
  assert.match(source, /overrideExecutable \|\| await downloadAndUnzipVSCode/)
})

test('临时目录清理遇到占用仍继续清理其余目录，并拒绝越界目标', () => {
  const parent = mkdtempSync(path.join(tmpdir(), 'vsidian-cleanup-'))
  const locked = path.join(parent, 'locked')
  const removable = path.join(parent, 'removable')
  mkdirSync(locked)
  mkdirSync(removable)
  const removed = []
  try {
    const failures = cleanupTestDirs([locked, removable, path.join(parent, '..', 'outside')], parent, (dir, options) => {
      removed.push(dir)
      if (dir === locked) throw new Error('locked')
      rmSync(dir, options)
    })
    assert.deepEqual(removed, [locked, removable])
    assert.equal(existsSync(removable), false)
    assert.equal(failures.length, 2)
    assert.match(failures[0], /locked/)
    assert.match(failures[1], /outside/)
  } finally {
    rmSync(parent, { recursive: true, force: true })
  }
})

test('Windows 默认独立桌面，仅显式指定才使用当前桌面', () => {
  assert.equal(resolveTestHostMode('win32', {}), 'desktop')
  assert.equal(resolveTestHostMode('win32', { VSIDIAN_TEST_HOST_MODE: 'foreground' }), 'foreground')
  assert.equal(resolveTestHostMode('linux', {}), 'foreground')
  assert.throws(() => resolveTestHostMode('win32', { VSIDIAN_TEST_HOST_MODE: 'wrong' }), /VSIDIAN_TEST_HOST_MODE/)
})

test('前台启动器原样传递真实进程输出和非零退出码', async () => {
  let output = ''
  const code = await runTestHost({
    executable: process.execPath,
    args: ['-e', 'process.stdout.write("launcher probe"); process.exit(17)'],
    env: process.env,
    mode: 'foreground',
    stdout: { write: (chunk) => { output += chunk.toString() } },
    stderr: { write: () => {} },
  })
  assert.equal(code, 17)
  assert.equal(output, 'launcher probe')
})

test('宿主运行按 reportPath 落盘完整报告：逐例输出与尾部退出码', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vsidian-host-report-'))
  // 嵌套路径：报告目录不存在时应自动创建（真实启动器把报告放进 .vscode-test/）
  const reportPath = path.join(dir, 'nested', 'integration-dev.log')
  try {
    const code = await runTestHost({
      executable: process.execPath,
      args: ['-e', 'process.stdout.write("report probe out\\n"); process.stderr.write("report probe err\\n"); process.exit(9)'],
      env: process.env,
      mode: 'foreground',
      reportPath,
    })
    assert.equal(code, 9)
    const report = readFileSync(reportPath, 'utf8')
    assert.match(report, /report probe out/, '报告应包含子进程 stdout')
    assert.match(report, /report probe err/, '报告应包含子进程 stderr')
    assert.match(report, /\[testHost\] 宿主退出码 9/, '报告尾部应有退出码摘要行')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('超时终止的运行同样落盘报告并记录超时退出码', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vsidian-host-report-timeout-'))
  const reportPath = path.join(dir, 'integration-timeout.log')
  try {
    const code = await runTestHost({
      executable: process.execPath,
      args: ['-e', 'setTimeout(() => process.exit(0), 8000)'],
      env: process.env,
      mode: 'foreground',
      timeoutMs: 600,
      reportPath,
    })
    assert.equal(code, 124)
    assert.match(readFileSync(reportPath, 'utf8'), /\[testHost\] 宿主退出码 124/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('开发态分片各有报告，单片及另外两种启动器保留原报告名', () => {
  const expected = {
    'runInstalled.mjs': 'integration-installed.log',
    'runSettingsActivation.mjs': 'settings-activation.log',
  }
  const dev = readFileSync(path.join(here, 'runTest.mjs'), 'utf8')
  assert.match(dev, /integration-dev-s\$\{shard\}\.log/)
  assert.match(dev, /'integration-dev\.log'/)
  for (const [launcher, reportName] of Object.entries(expected)) {
    const source = readFileSync(path.join(here, launcher), 'utf8')
    assert.match(
      source,
      new RegExp(`reportPath:\\s*path\\.join\\(root,\\s*'\\.vscode-test',\\s*'${reportName}'\\)`),
      `${launcher} 应把报告指到 .vscode-test/${reportName}`,
    )
  }
})

test('Windows 独立桌面启动器原样传递真实进程输出和非零退出码', { skip: skipDesktop }, async () => {
  let output = ''
  let diagnostics = ''
  const code = await runTestHost({
    executable: process.execPath,
    args: ['-e', 'process.stdout.write("desktop probe"); process.exit(23)'],
    env: process.env,
    mode: 'desktop',
    stdout: { write: (chunk) => { output += chunk.toString() } },
    stderr: { write: (chunk) => { diagnostics += chunk.toString() } },
  })
  assert.equal(code, 23)
  assert.match(output, /desktop probe/)
  assert.match(diagnostics, /观察期间前台 PID/)
})

test('Windows 独立桌面超时后结束本次宿主及其子进程', { skip: skipDesktop }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vsidian-host-timeout-'))
  const markers = [path.join(dir, 'host.pid'), path.join(dir, 'child.pid')]
  const unrelated = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 4500)'], { stdio: 'ignore' })
  try {
    let diagnostics = ''
    const started = Date.now()
    const code = await runTestHost({
      executable: process.execPath,
      args: ['-e', probeScript, ...markers],
      env: process.env,
      mode: 'desktop',
      timeoutMs: 1200,
      stdout: { write: () => {} },
      stderr: { write: (chunk) => { diagnostics += chunk.toString() } },
    })
    assert.equal(code, 124)
    assert.match(diagnostics, /超过 1200 ms/)
    assert.ok(Date.now() - started < 3000, '超时应尽快结束')
    await waitUntil(() => markers.every(existsSync), 500)
    await new Promise((resolve) => setTimeout(resolve, 300))
    for (const marker of markers) assert.equal(running(Number(readFileSync(marker, 'utf8'))), false)
    assert.equal(running(unrelated.pid), true, '不应影响本次 Job 之外的进程')
  } finally {
    if (running(unrelated.pid)) unrelated.kill()
    stopProbePids(markers)
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Windows 父启动器被终止后不遗留独立桌面宿主及其子进程', { skip: skipDesktop }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vsidian-host-parent-'))
  const markers = [path.join(dir, 'host.pid'), path.join(dir, 'child.pid')]
  const moduleUrl = pathToFileURL(path.join(here, 'testHost.mjs')).href
  const runnerSource = `import { runTestHost } from ${JSON.stringify(moduleUrl)}; await runTestHost({ executable: process.execPath, args: ${JSON.stringify(['-e', probeScript, ...markers])}, env: process.env, mode: 'desktop' })`
  const runner = spawn(process.execPath, ['--input-type=module', '-e', runnerSource], { stdio: 'ignore' })
  try {
    await waitUntil(() => markers.every(existsSync))
    runner.kill()
    await new Promise((resolve) => runner.once('close', resolve))
    await new Promise((resolve) => setTimeout(resolve, 700))
    for (const marker of markers) assert.equal(running(Number(readFileSync(marker, 'utf8'))), false)
  } finally {
    if (running(runner.pid)) runner.kill()
    stopProbePids(markers)
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Windows PowerShell 在 CreateProcess 后被强制终止时清理本次进程树', { skip: skipDesktop }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vsidian-host-wrapper-'))
  const markers = [path.join(dir, 'host.pid'), path.join(dir, 'child.pid')]
  const crashWrapperScript = `${probeScript}; setTimeout(() => process.kill(process.ppid), 350)`
  try {
    const started = Date.now()
    const code = await runTestHost({
      executable: process.execPath,
      args: ['-e', crashWrapperScript, ...markers],
      env: process.env,
      mode: 'desktop',
      stdout: { write: () => {} },
      stderr: { write: () => {} },
    })
    assert.notEqual(code, 0)
    assert.ok(Date.now() - started < 2500, 'PowerShell 退出应立即结束宿主进程树')
    await waitUntil(() => markers.every(existsSync), 500)
    await new Promise((resolve) => setTimeout(resolve, 700))
    for (const marker of markers) assert.equal(running(Number(readFileSync(marker, 'utf8'))), false)
  } finally {
    stopProbePids(markers)
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Windows PowerShell 在 CreateProcess 后抛错时清理本次进程树', { skip: skipDesktop }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vsidian-host-error-'))
  const markers = [path.join(dir, 'host.pid'), path.join(dir, 'child.pid')]
  try {
    let diagnostics = ''
    const started = Date.now()
    const code = await runTestHost({
      executable: process.execPath,
      args: ['-e', probeScript, ...markers],
      env: { ...process.env, VSIDIAN_TEST_HOST_FAULT_MARKER: markers[1] },
      mode: 'desktop',
      stdout: { write: () => {} },
      stderr: { write: (chunk) => { diagnostics += chunk.toString() } },
    })
    assert.equal(code, 1)
    assert.match(diagnostics, /fault after CreateProcess/)
    assert.ok(Date.now() - started < 3000)
    await waitUntil(() => markers.every(existsSync), 500)
    await new Promise((resolve) => setTimeout(resolve, 300))
    for (const marker of markers) assert.equal(running(Number(readFileSync(marker, 'utf8'))), false)
  } finally {
    stopProbePids(markers)
    rmSync(dir, { recursive: true, force: true })
  }
})

test('Windows 启动器收到 SIGINT 后返回中断码并清理进程树', { skip: skipDesktop }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'vsidian-host-sigint-'))
  const markers = [path.join(dir, 'host.pid'), path.join(dir, 'child.pid')]
  const resultFile = path.join(dir, 'result.txt')
  const moduleUrl = pathToFileURL(path.join(here, 'testHost.mjs')).href
  const runnerSource = [
    `import { runTestHost } from ${JSON.stringify(moduleUrl)}`,
    'import { existsSync, writeFileSync } from "node:fs"',
    `const pulse = setInterval(() => { if (existsSync(${JSON.stringify(markers[1])})) { clearInterval(pulse); process.emit('SIGINT') } }, 50)`,
    `const code = await runTestHost({ executable: process.execPath, args: ${JSON.stringify(['-e', probeScript, ...markers])}, env: process.env, mode: 'desktop' })`,
    `writeFileSync(${JSON.stringify(resultFile)}, String(code))`,
  ].join('; ')
  try {
    const runner = spawn(process.execPath, ['--input-type=module', '-e', runnerSource], { stdio: 'ignore' })
    await new Promise((resolve) => runner.once('close', resolve))
    assert.equal(readFileSync(resultFile, 'utf8'), '130')
    for (const marker of markers) assert.equal(running(Number(readFileSync(marker, 'utf8'))), false)
  } finally {
    stopProbePids(markers)
    rmSync(dir, { recursive: true, force: true })
  }
})
