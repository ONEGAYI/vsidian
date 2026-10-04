// #334（P3-02）PDF 探针启动器：生成样本矩阵 -> 下载/复用 VSCode 1.82.3 ->
// 以 testHost.mjs 策略启动真实宿主运行 out/test/integration/pdfProbe/suite.js。
// 报告落 .vscode-test/pdf-probe.log（完整 stdout/stderr + 退出码），退出码
// 判定复用 evaluateHostReport（[集成测试][START]/[PASS]/[FAIL]/[TIME] 对齐）。
// 长耗时命令：跑一次 = 留一份证据，复核读报告不重跑。
import { downloadAndUnzipVSCode } from '@vscode/test-electron'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generatePdfSamples } from './genSamples.mjs'
import { buildTestHostArgs, cleanupTestDirs, createPortableShardHost, evaluateHostReport, resolveTestHostMode, runTestHost } from '../testHost.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const testCacheDir = path.join(root, '.vscode-test')
const reportPath = path.join(testCacheDir, 'pdf-probe.log')

const executable = process.env.VSIDIAN_TEST_VSCODE_PATH || await downloadAndUnzipVSCode({ version: '1.82.3' })
const mode = resolveTestHostMode()
console.log(`[pdfProbe] 宿主 ${executable}（模式 ${mode}）`)

const wsDir = mkdtempSync(path.join(tmpdir(), 'vsidian-pdfprobe-'))
const samplesDir = path.join(wsDir, 'samples')
const portable = createPortableShardHost(testCacheDir, 1)
const portableDirs = [portable.portableDir]
const started = Date.now()
let exitCode = 1
try {
  const sampleReport = await generatePdfSamples(samplesDir)
  for (const [name, info] of Object.entries(sampleReport)) {
    console.log(`[pdfProbe] 样本 ${name} ${info.size} B（${info.note}）`)
  }
  const wsFile = `${wsDir}.code-workspace`
  const { writeTestWorkspaceFile } = await import('../testHost.mjs')
  writeTestWorkspaceFile(wsDir)
  const args = buildTestHostArgs({
    workspaceDir: wsFile,
    testsPath: path.join(root, 'out', 'test', 'integration', 'pdfProbe', 'suite.js'),
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
      VSIDIAN_PDF_PROBE_SAMPLES: samplesDir,
      WORKSPACE_DIR: wsDir,
    },
    reportPath,
  })
  console.log(`[pdfProbe] 宿主退出码 ${exitCode}（耗时 ${((Date.now() - started) / 1000).toFixed(1)}s）`)
} catch (err) {
  console.error('[pdfProbe] 运行失败', err)
  process.exitCode = 1
} finally {
  try {
    rmSync(`${wsDir}.code-workspace`, { force: true })
  } catch { /* 同 runTest：workspace 文件尽力清理 */ }
  for (const failure of cleanupTestDirs([wsDir], tmpdir())) console.error(`[pdfProbe] ${failure}`)
  for (const failure of cleanupTestDirs(portableDirs, testCacheDir)) console.error(`[pdfProbe] ${failure}`)
}

if (exitCode !== 0) {
  // #211 收尾退出噪声放行口径与 runTest 一致：报告零 FAIL 且全部用例终态
  const verdict = evaluateHostReport(readFileSync(reportPath, 'utf8').split('\n'), exitCode)
  if (verdict.ok) {
    console.warn(`[pdfProbe] 宿主退出码 ${exitCode} 但${verdict.reason}（放行）`)
    process.exitCode = 0
  } else {
    console.error(`[pdfProbe] ${verdict.reason}，详见 ${reportPath}`)
    process.exitCode = 1
  }
}
