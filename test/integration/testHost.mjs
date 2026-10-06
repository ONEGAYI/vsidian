// 开发态与安装态共用的 VSCode 测试宿主启动策略。
// reportPath：把本次宿主运行的完整 stdout/stderr 与退出码落盘为报告文件
// （跑一次 = 留一份证据，复核与统计读文件、不重跑）；打开失败仅告警降级。
import { spawn } from 'node:child_process'
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const hiddenDesktopScript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'hiddenDesktop.ps1')

function writeReportAll(fd, data) {
  // writeSync 对普通文件也可能部分写入，循环写满
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8')
  let offset = 0
  while (offset < buf.length) offset += writeSync(fd, buf, offset)
}

function openReport(reportPath, stderr) {
  try {
    mkdirSync(path.dirname(reportPath), { recursive: true })
    const fd = openSync(reportPath, 'w')
    writeReportAll(fd, `[testHost] 运行报告 ${new Date().toISOString()}\n`)
    return fd
  } catch (error) {
    stderr.write(`[testHost] 报告文件不可写（${reportPath}）：${error.message}；继续运行但不留报告\n`)
    return -1
  }
}

export function buildTestHostArgs({ workspaceDir, testsPath, extensionPath, extensionsDir, userDataDir, disableExtensions = false, extraExtensionPaths = [] }) {
  return [
    ...(disableExtensions ? ['--disable-extensions'] : []),
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--disable-updates',
    '--skip-welcome',
    '--skip-release-notes',
    '--no-cached-data',
    '--disable-workspace-trust',
    `--extensionTestsPath=${testsPath}`,
    // #350 T01 附加组件夹具：--extensionDevelopmentPath 可重复传递（CLI
    // 定义为多值），附加夹具扩展与被测扩展同宿主装载
    `--extensionDevelopmentPath=${extensionPath}`,
    ...extraExtensionPaths.map((extra) => `--extensionDevelopmentPath=${extra}`),
    `--extensions-dir=${extensionsDir}`,
    `--user-data-dir=${userDataDir}`,
    workspaceDir,
  ]
}

/**
 * 生成单 folder 的 .code-workspace 文件并返回其路径（2026-10 批次）：
 * VSCode 1.86.2 上以**目录**（single-folder workspace）启动时（1.82.3 下界
 * 矩阵沿用同型装配，未另测目录形态），
 * updateWorkspaceFolders 增根要走 enterMultiRootWorkspace 的 workspace
 * 身份转换——触发 window reload、ext host 随之退出，跑在 ext host 里的
 * 集成 suite 当场中断（#198「工作区根增删」用例确定性复现：返回 true
 * 后 ext host 立即 code 0 退出、宿主 code 1）。以单 folder 的
 * .code-workspace 启动让宿主以 multi-root 形态起步，根增删退化为纯
 * folders 更新（无 reload）。workspaceDir 参数由此可传目录（向后兼容）
 * 或本函数产出的 workspace 文件路径。
 *
 * 文件是工作区目录的**兄弟文件**（不进任何根的扫描范围）；调用方负责
 * 随工作区目录一并清理
 */
export function writeTestWorkspaceFile(workspaceDir, writeFile = writeFileSync) {
  const workspaceFile = `${workspaceDir}.code-workspace`
  const posixDir = workspaceDir.split(path.sep).join('/')
  writeFile(workspaceFile, `${JSON.stringify({ folders: [{ path: posixDir }] }, null, 2)}\n`, 'utf8')
  return workspaceFile
}

export function createPortableShardHost(baseDir, shard, env = process.env) {
  if (!Number.isInteger(shard) || shard < 1) {
    throw new Error(`分片序号须为正整数：${shard}`)
  }
  const portableDir = mkdtempSync(path.join(path.resolve(baseDir), `portable-s${shard}-`))
  return {
    portableDir,
    extensionsDir: path.join(portableDir, 'extensions'),
    userDataDir: path.join(portableDir, 'user-data'),
    // VSCode 便携模式优先于 --user-data-dir；显式指定每片独立目录才能隔离 main IPC。
    env: { ...env, VSCODE_PORTABLE: portableDir },
  }
}

export function cleanupTestDirs(dirs, parent, remove = rmSync) {
  const failures = []
  const allowedParent = path.resolve(parent)
  for (const dir of dirs) {
    if (path.dirname(path.resolve(dir)) !== allowedParent) {
      failures.push(`拒绝清理越界目录：${dir}`)
      continue
    }
    try {
      remove(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch (error) {
      failures.push(`清理 ${dir} 失败：${String(error)}`)
    }
  }
  return failures
}

export function resolveTestHostMode(platform = process.platform, env = process.env) {
  const requested = env.VSIDIAN_TEST_HOST_MODE
  if (requested && requested !== 'desktop' && requested !== 'foreground') {
    throw new Error(`VSIDIAN_TEST_HOST_MODE 只能为 desktop 或 foreground，收到 ${requested}`)
  }
  if (requested === 'desktop' && platform !== 'win32') {
    throw new Error('VSIDIAN_TEST_HOST_MODE=desktop 仅支持 Windows')
  }
  return requested ?? (platform === 'win32' ? 'desktop' : 'foreground')
}

/**
 * 宿主非零退出时的报告判定（#254 抽出为可测纯函数）：放行前必须核对
 * 每个计划用例都取得终态（[TIME] 行）且零 FAIL。#211 的收尾噪声边界是
 * 「全部用例 PASS 后」的退出竞速；宿主中途截断（零 FAIL 但计划项未跑完，
 * 实测计划 59 项只执行 53 项曾被静默放行）不属于该边界，判败并点名缺失
 * 身份：有 START 无终态的用例名（missing）与未开始数量（notStarted）。
 * 未开始的用例在报告中无任何行，名称不可得，notStarted 即其计数。
 */
export function evaluateHostReport(lines, exitCode) {
  const failCount = lines.filter((line) => line.includes('[集成测试][FAIL]')).length
  // 终态计数与点名同用严格口径：畸形行（正文引用 "[集成测试][TIME] 非
  // 数字" 形态）不得计入放行计数（宽松 includes 计数会虚增 doneCount、
  // 放过截断宿主；全仓现无此类打印，属防御性统一）
  const doneCount = lines.filter((line) => /\[集成测试\]\[TIME\] \d+ms .+$/.test(line)).length
  const startNames = []
  const doneNames = new Set()
  for (const line of lines) {
    const start = /\[集成测试\]\[START\] (.+)$/.exec(line)
    if (start) startNames.push(start[1])
    const done = /\[集成测试\]\[TIME\] \d+ms (.+)$/.exec(line)
    if (done) doneNames.add(done[1])
  }
  const planLine = lines.find((line) => line.includes('[集成测试] 执行')) ?? ''
  const planMatch = /\[集成测试\] 执行 (\d+)\/\d+ 项/.exec(planLine)
  const planned = planMatch ? Number(planMatch[1]) : 0
  const missing = startNames.filter((name) => !doneNames.has(name))
  const notStarted = Math.max(0, planned - startNames.length)
  const verdict = { ok: false, pardon: false, failCount, planned, doneCount, missing, notStarted, reason: '' }
  if (exitCode === 0) {
    return { ...verdict, ok: true, reason: '宿主退出码 0' }
  }
  if (planned === 0) {
    return { ...verdict, reason: planMatch
      ? `报告计划执行 0 项（${planLine.trim()}），空片或零计划不能按收尾噪声放行`
      : '报告未见计划行（[集成测试] 执行 N/M 项），不能按收尾噪声放行' }
  }
  if (failCount > 0) {
    return { ...verdict, reason: `报告 FAIL ${failCount} 项` }
  }
  if (doneCount >= planned) {
    return { ...verdict, ok: true, pardon: true, reason: `报告零失败且 ${doneCount}/${planned} 项全部取得终态（收尾退出噪声放行）` }
  }
  const parts = []
  if (missing.length > 0) parts.push(`${missing.length} 项有始无终（${missing.join('；')}）`)
  if (notStarted > 0) parts.push(`${notStarted} 项未开始`)
  return { ...verdict, reason: `计划 ${planned} 项仅 ${doneCount} 项取得终态：${parts.join('，')}` }
}

export function runTestHost({ executable, args, env, mode = resolveTestHostMode(), timeoutMs = 15 * 60_000, stdout = process.stdout, stderr = process.stderr, reportPath }) {
  if (mode === 'desktop' && process.platform !== 'win32') {
    throw new Error('独立桌面仅支持 Windows')
  }
  if (mode !== 'desktop' && mode !== 'foreground') {
    throw new Error(`未知测试宿主模式：${mode}`)
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`测试宿主超时必须为正数：${timeoutMs}`)
  }
  const reportFd = reportPath ? openReport(reportPath, stderr) : -1
  const report = (data) => { if (reportFd >= 0) writeReportAll(reportFd, data) }
  const windowsWrapper = process.platform === 'win32'
  const command = windowsWrapper ? 'powershell.exe' : executable
  const commandArgs = windowsWrapper
    ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', hiddenDesktopScript,
      Buffer.from(JSON.stringify({ executable, args, cwd: process.cwd(), mode, parentPid: process.pid }), 'utf8').toString('base64')]
    : args
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { env, windowsHide: windowsWrapper })
    let stopCode = 0
    const stop = (code, reason) => {
      if (stopCode) return
      stopCode = code
      report(`[testHost] ${reason}，结束本次测试宿主进程树\n`)
      stderr.write(`[testHost] ${reason}，结束本次测试宿主进程树\n`)
      child.kill()
    }
    const onSigint = () => stop(130, '收到 SIGINT')
    const onSigterm = () => stop(143, '收到 SIGTERM')
    const timeout = setTimeout(() => stop(124, `超过 ${timeoutMs} ms`), timeoutMs)
    process.on('SIGINT', onSigint)
    process.on('SIGTERM', onSigterm)
    const cleanup = () => {
      clearTimeout(timeout)
      process.off('SIGINT', onSigint)
      process.off('SIGTERM', onSigterm)
    }
    child.stdout.on('data', (chunk) => { report(chunk); stdout.write(chunk) })
    child.stderr.on('data', (chunk) => { report(chunk); stderr.write(chunk) })
    child.on('error', (error) => {
      report(`[testHost] 启动失败 ${error.message}\n`)
      if (reportFd >= 0) closeSync(reportFd)
      cleanup(); reject(error)
    })
    child.on('close', (code) => {
      const finalCode = stopCode || (code ?? 1)
      report(`[testHost] 宿主退出码 ${finalCode}\n`)
      if (reportFd >= 0) closeSync(reportFd)
      cleanup(); resolve(finalCode)
    })
  })
}
