// #619（V01）PDF 导出探针启动器：准备路线 A 依赖 -> 下载/复用 VSCode 1.82.3
// -> 以 testHost.mjs 策略启动真实宿主运行 out/test/integration/pdfExportProbe/suite.js。
// 报告落 .vscode-test/pdf-export-probe.log（完整 stdout/stderr + 退出码），
// 退出码判定复用 evaluateHostReport。长耗时命令：跑一次 = 留一份证据。
// 复现顺序：
//   node esbuild.mjs                                            # 探针三产物
//   node test/integration/pdfExportProbe/runProbe.mjs            # 本文件
import { downloadAndUnzipVSCode } from '@vscode/test-electron'
import { mkdirSync, mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildTestHostArgs, cleanupTestDirs, createPortableShardHost, evaluateHostReport, resolveTestHostMode, runTestHost, writeTestWorkspaceFile } from '../testHost.mjs'
import { prepareRouteA, routeADepsDir, routeABundlePath } from './prepareRouteA.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const testCacheDir = path.join(root, '.vscode-test')
const artifactsDir = path.join(testCacheDir, 'pdf-export-probe-artifacts')
const pngDir = path.join(root, 'docs', 'research', 'data', 'pdf-export-browser-probe')
const reportPath = path.join(testCacheDir, 'pdf-export-probe.log')

const executable = process.env.VSIDIAN_TEST_VSCODE_PATH || await downloadAndUnzipVSCode({ version: '1.82.3' })
const mode = resolveTestHostMode()
console.log(`[pdfExportProbe] 宿主 ${executable}（模式 ${mode}）`)

const wsDir = mkdtempSync(path.join(tmpdir(), 'vsidian-pdfexport-'))
const portable = createPortableShardHost(testCacheDir, 1)
mkdirSync(artifactsDir, { recursive: true })
const started = Date.now()
let exitCode = 1
try {
  const routeA = prepareRouteA()
  console.log(`[pdfExportProbe] 路线A bundle ${(routeA.bundleBytes / 1024 / 1024).toFixed(2)} MB -> ${routeABundlePath}`)
  const wsFile = `${wsDir}.code-workspace`
  writeTestWorkspaceFile(wsDir)
  const args = buildTestHostArgs({
    workspaceDir: wsFile,
    testsPath: path.join(root, 'out', 'test', 'integration', 'pdfExportProbe', 'suite.js'),
    extensionPath: root,
    extensionsDir: portable.extensionsDir,
    userDataDir: portable.userDataDir,
    disableExtensions: true,
  })
  exitCode = await runTestHost({
    executable,
    args,
    mode,
    env: {
      ...portable.env,
      VSIDIAN_PDF_EXPORT_ARTIFACTS: artifactsDir,
      VSIDIAN_PDF_EXPORT_PNG_DIR: pngDir,
      VSIDIAN_PDF_EXPORT_ROUTE_A: routeADepsDir,
      VSIDIAN_PDF_EXPORT_ROUTE_A_BUNDLE: routeABundlePath,
    },
    timeoutMs: 12 * 60_000,
    reportPath,
  })
  console.log(`[pdfExportProbe] 宿主退出码 ${exitCode}（耗时 ${((Date.now() - started) / 1000).toFixed(1)}s）`)
} catch (err) {
  console.error('[pdfExportProbe] 运行失败', err)
  process.exitCode = 1
} finally {
  try {
    rmSync(`${wsDir}.code-workspace`, { force: true })
  } catch { /* workspace 文件尽力清理 */ }
  for (const failure of cleanupTestDirs([wsDir], tmpdir())) console.error(`[pdfExportProbe] ${failure}`)
  for (const failure of cleanupTestDirs([portable.portableDir], testCacheDir)) console.error(`[pdfExportProbe] ${failure}`)
}

if (exitCode !== 0) {
  // #211 收尾退出噪声放行口径与 runTest 一致：报告零 FAIL 且全部用例终态
  const verdict = evaluateHostReport(readFileSync(reportPath, 'utf8').split('\n'), exitCode)
  if (verdict.ok) {
    console.warn(`[pdfExportProbe] 宿主退出码 ${exitCode} 但${verdict.reason}（放行）`)
    process.exitCode = 0
  } else {
    console.error(`[pdfExportProbe] ${verdict.reason}，详见 ${reportPath}`)
    process.exitCode = 1
  }
}
