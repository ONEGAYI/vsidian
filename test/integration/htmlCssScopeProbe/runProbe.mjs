// #566（T01）CSS 作用域探针启动器（真宿主）：下载/复用 VSCode 1.82.3 ->
// 以 testHost.mjs 策略启动真实宿主运行 out/test/integration/htmlCssScopeProbe/suite.js。
// 报告落 .vscode-test/html-css-scope-probe.log（完整 stdout/stderr + 退出码），
// 退出码判定复用 evaluateHostReport。长耗时命令：跑一次 = 留一份证据，
// 复核读报告不重跑。前置：node esbuild.mjs（产出 out/webview/main.css 与
// 探针 bundle）。
import { downloadAndUnzipVSCode } from '@vscode/test-electron'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildTestHostArgs, cleanupTestDirs, createPortableShardHost, evaluateHostReport, resolveTestHostMode, runTestHost, writeTestWorkspaceFile } from '../testHost.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const testCacheDir = path.join(root, '.vscode-test')
const reportPath = path.join(testCacheDir, 'html-css-scope-probe.log')

const executable = process.env.VSIDIAN_TEST_VSCODE_PATH || await downloadAndUnzipVSCode({ version: '1.82.3' })
const mode = resolveTestHostMode()
console.log(`[cssScopeProbe] 宿主 ${executable}（模式 ${mode}）`)

const wsDir = mkdtempSync(path.join(tmpdir(), 'vsidian-cssprobe-'))
const portable = createPortableShardHost(testCacheDir, 1)
const portableDirs = [portable.portableDir]
const started = Date.now()
let exitCode = 1
try {
  const wsFile = `${wsDir}.code-workspace`
  writeTestWorkspaceFile(wsDir)
  const args = buildTestHostArgs({
    workspaceDir: wsFile,
    testsPath: path.join(root, 'out', 'test', 'integration', 'htmlCssScopeProbe', 'suite.js'),
    extensionPath: root,
    extensionsDir: portable.extensionsDir,
    userDataDir: portable.userDataDir,
    disableExtensions: true,
  })
  exitCode = await runTestHost({
    executable,
    args,
    mode,
    env: { ...portable.env },
    reportPath,
  })
  console.log(`[cssScopeProbe] 宿主退出码 ${exitCode}（耗时 ${((Date.now() - started) / 1000).toFixed(1)}s）`)
} catch (err) {
  console.error('[cssScopeProbe] 运行失败', err)
  process.exitCode = 1
} finally {
  try {
    rmSync(`${wsDir}.code-workspace`, { force: true })
  } catch { /* 同 runTest：workspace 文件尽力清理 */ }
  for (const failure of cleanupTestDirs([wsDir], tmpdir())) console.error(`[cssScopeProbe] ${failure}`)
  for (const failure of cleanupTestDirs(portableDirs, testCacheDir)) console.error(`[cssScopeProbe] ${failure}`)
}

if (exitCode !== 0) {
  // #211 收尾退出噪声放行口径与 runTest 一致：报告零 FAIL 且全部用例终态
  const verdict = evaluateHostReport(readFileSync(reportPath, 'utf8').split('\n'), exitCode)
  if (verdict.ok) {
    console.warn(`[cssScopeProbe] 宿主退出码 ${exitCode} 但${verdict.reason}（放行）`)
    process.exitCode = 0
  } else {
    console.error(`[cssScopeProbe] ${verdict.reason}，详见 ${reportPath}`)
    process.exitCode = 1
  }
}
