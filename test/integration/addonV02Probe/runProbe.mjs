// V02（#349）页面 SDK 探针启动器：构建组件产物 → 全量 esbuild（探针三产物
// 随 esbuild.mjs 构建）→ 下载/复用 VSCode 1.82.3 → 以 testHost.mjs 策略启动
// 真实宿主运行 out/test/integration/addonV02/suite.js。
// 报告落 .vscode-test/addon-v02-probe.log（完整 stdout/stderr + 退出码），
// 退出码判定复用 evaluateHostReport；证据 JSON 由套件写
// docs/research/data/addon-v02-probe-results.json（随仓库提交，可复核）。
// 长耗时命令：跑一次 = 留一份证据，复核读报告不重跑。
//
// 运行：node test/integration/addonV02Probe/runProbe.mjs
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { downloadAndUnzipVSCode } from '@vscode/test-electron'
import { buildTestAddons } from '../../fixtures/addon-v02/sdk/buildAddon.mjs'
import { buildTestHostArgs, cleanupTestDirs, createPortableShardHost, evaluateHostReport, resolveTestHostMode, runTestHost, writeTestWorkspaceFile } from '../testHost.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const testCacheDir = path.join(root, '.vscode-test')
const reportPath = path.join(testCacheDir, 'addon-v02-probe.log')
const evidencePath = path.join(root, 'docs', 'research', 'data', 'addon-v02-probe-results.json')

// 1) 组件产物（含静态红线：无 CM6 运行时标记）
const layout = await buildTestAddons()
console.log(`[addonV02Probe] 组件产物就绪：${layout.buildRoot}`)

// 2) 全量构建（esbuild.mjs 幂等；探针 suite/editor/settings 三产物随之构建）
const buildRun = spawnSync(process.execPath, [path.join(root, 'esbuild.mjs')], {
  cwd: root, encoding: 'utf8',
})
if (buildRun.status !== 0) {
  console.error(buildRun.stdout)
  console.error(buildRun.stderr)
  throw new Error(`esbuild.mjs 退出码 ${buildRun.status}`)
}

// 3) 真宿主
const executable = process.env.VSIDIAN_TEST_VSCODE_PATH || await downloadAndUnzipVSCode({ version: '1.82.3' })
const mode = resolveTestHostMode()
console.log(`[addonV02Probe] 宿主 ${executable}（模式 ${mode}）`)

const wsDir = mkdtempSync(path.join(tmpdir(), 'vsidian-addonv02-'))
const portable = createPortableShardHost(testCacheDir, 1)
const portableDirs = [portable.portableDir]
const started = Date.now()
let exitCode = 1
try {
  const wsFile = writeTestWorkspaceFile(wsDir)
  const args = buildTestHostArgs({
    workspaceDir: wsFile,
    testsPath: path.join(root, 'out', 'test', 'integration', 'addonV02', 'suite.js'),
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
      VSIDIAN_ADDON_V02_BUILD: layout.buildRoot,
      VSIDIAN_ADDON_V02_EVIDENCE: evidencePath,
      WORKSPACE_DIR: wsDir,
    },
    reportPath,
  })
  console.log(`[addonV02Probe] 宿主退出码 ${exitCode}（耗时 ${((Date.now() - started) / 1000).toFixed(1)}s）`)
  if (exitCode !== 0) {
    // 以报告为准的二次判定（#211 收尾噪声边界同口径）
    const { readFileSync } = await import('node:fs')
    const verdict = evaluateHostReport(readFileSync(reportPath, 'utf8').split('\n'), exitCode)
    if (!verdict.ok) {
      throw new Error(verdict.reason)
    }
    console.warn(`[addonV02Probe] ${verdict.reason}（放行收尾噪声）`)
    exitCode = 0
  }
} catch (err) {
  console.error('[addonV02Probe] 运行失败', err)
  process.exitCode = 1
} finally {
  for (const dir of [...portableDirs, wsDir]) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch {
      console.error(`[addonV02Probe] 清理 ${dir} 失败`)
    }
  }
  try {
    rmSync(`${wsDir}.code-workspace`, { force: true })
  } catch {
    // 与目录清理同口径
  }
}
mkdirSync(path.dirname(reportPath), { recursive: true })
writeFileSync(path.join(root, 'out', 'test', 'addon-v02-probe-exit.txt'), `EXIT=${exitCode}\n`, 'utf8')
process.exitCode = exitCode === 0 ? 0 : 1
