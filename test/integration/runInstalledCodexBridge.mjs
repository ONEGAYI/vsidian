// #535 T08 安装态组件对照与升级路径启动器（bridge 同装 + 旧版升级）。
//
// 真实安装链（runInstalledAddons.mjs 先例的扩展）：v1.1.0 旧主 VSIX 与
// 本分支主 VSIX + bridge VSIX（ONEGAYI.vsidian-codex-bridge，组件版
// Codex 主题）经 VSCode 1.82.3 CLI --install-extension 装入隔离 profile
// 的 extensions 目录，测试模式以安装解压产物为 development path 运行
// 集成 suite——被测代码是 VSIX 产物，禁止仓库源码/dev path 注入代替
// 安装链。
//
// 阶段矩阵（同一 profile 跨阶段共享 user-data/globalState——1.82.3 测试
// 宿主 storage 完全 in-memory，跨会话持久实际不可达（T16 D/E 票面实证），
// 升级存量以 _test 钩子注入原始 overlay 承载，取舍见
// t08CodexBridge.mjs 头注释）：
// - legacy：装 v1.1.0 旧主 VSIX（真实旧物）——旧枚举 codex 在旧版语义内
//   合法可保存，建立升级前基线；
// - upgraded：--force 同版本覆盖为本分支主 VSIX（本分支未升版本号，以
//   同版本覆盖承载安装链升级面；版本差异化升级链已由 T16 E 先例覆盖）
//   + bridge 同装——组件对照与升级迁移语义。
//
// 用法：node test/integration/runInstalledCodexBridge.mjs [--phase=legacy|upgraded]
// 前提：npm run compile（suite 产物）；环境变量：
// - VSIDIAN_TEST_CODEX_BRIDGE_VSIX：bridge VSIX 路径（外部仓产物，不入库）
// - VSIDIAN_TEST_CODEX_LEGACY_VSIX：v1.1.0 旧主 VSIX 路径（升级路径旧实物）
// VSIDIAN_TEST_VSCODE_PATH 指向已解压宿主可执行文件时跳过默认下载。
// 报告：out/test/t08-phase-<阶段>.log（完整逐例输出与退出码，复核读报告）；
// 主 VSIX 产物：out/test/t08-vsix/；profile：out/test/t08-codex-profile/
// （跨阶段共享，全阶段通过后清理，失败保留供诊断）。
import { downloadAndUnzipVSCode } from '@vscode/test-electron'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generatePerfSample, generateReadingSample, generateMermaidDenseSample } from '../perf/gen-sample.mjs'
import { writeFixtures, LARGE_DOC_LINES } from './fixtures.mjs'
import { buildTestHostArgs, evaluateHostReport, resolveTestHostMode, runTestHost, writeTestWorkspaceFile } from './testHost.mjs'
import { applyPhaseEnv, installExtension, installedExtensionDir, listVsixEntries, packageMainVsix } from './t16Package.mjs'
import { T08_PHASES, auditBridgeVsixEntries, t08PhaseHostEnv } from './t08CodexBridge.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const phaseArg = process.argv.find((arg) => arg.startsWith('--phase='))
const singlePhase = phaseArg ? phaseArg.slice('--phase='.length) : null
if (singlePhase && !T08_PHASES.includes(singlePhase)) {
  console.error(`[runInstalledCodexBridge] 未知阶段 ${JSON.stringify(singlePhase)}（可选 ${T08_PHASES.join('/')}）`)
  process.exit(1)
}

const outDir = path.join(root, 'out', 'test')
const vsixDir = path.join(outDir, 't08-vsix')
const profileDir = path.join(outDir, 't08-codex-profile')
const extensionsDir = path.join(profileDir, 'extensions')
const userDataDir = path.join(profileDir, 'user-data')
const mainVsixPath = path.join(vsixDir, 'vsidian-main.vsix')

function requireArtifact(file, hint) {
  if (!existsSync(file)) {
    throw new Error(`缺少 ${file}（${hint}）`)
  }
}

/** 运行一个阶段：fixture 工作区 + 阶段环境 + 宿主启动 + 报告落盘 */
async function runPhase({ phase, devPath, cliPath, executable }) {
  const wsDir = mkdtempSync(path.join(tmpdir(), `vsidian-t08-${phase}-`))
  const reportPath = path.join(outDir, `t08-phase-${phase}.log`)
  try {
    await writeFixtures(wsDir, { generatePerfSample, generateReadingSample, generateMermaidDenseSample })
    const wsFile = writeTestWorkspaceFile(wsDir)
    const args = buildTestHostArgs({
      workspaceDir: wsFile,
      testsPath: path.join(root, 'out', 'test', 'integration', 'suite', 'index.js'),
      extensionPath: devPath,
      extensionsDir,
      userDataDir,
    })
    const mode = resolveTestHostMode()
    const env = applyPhaseEnv({
      ...process.env,
      WORKSPACE_DIR: wsDir,
      LARGE_DOC_LINES: String(LARGE_DOC_LINES),
    }, t08PhaseHostEnv(phase, { hooks: true }))
    console.log(`[runInstalledCodexBridge] 阶段 ${phase} 启动（dev path：${devPath}；模式：${mode}）`)
    const code = await runTestHost({ executable, args, mode, env, reportPath })
    if (code !== 0) {
      // 退出码非零但报告零 FAIL 且全部用例取得终态时放行（#211 收尾噪声
      // 族与 runTest.mjs 同一判定纯函数）
      const verdict = evaluateHostReport(readFileSync(reportPath, 'utf8').split(/\r?\n/), code)
      if (!verdict.ok) {
        throw new Error(`阶段 ${phase} 退出码 ${code}：${verdict.reason}（报告：${reportPath}）`)
      }
      console.warn(`[runInstalledCodexBridge] 阶段 ${phase} 退出码 ${code} 但${verdict.reason}`)
    }
    console.log(`[runInstalledCodexBridge] 阶段 ${phase} 通过（报告：${reportPath}）`)
  } finally {
    rmSync(`${wsDir}.code-workspace`, { force: true })
    rmSync(wsDir, { recursive: true, force: true })
  }
}

async function main() {
  requireArtifact(path.join(root, 'out', 'extension.js'), '先 npm run compile')
  requireArtifact(path.join(root, 'out', 'test', 'integration', 'suite', 'index.js'), '先 npm run compile（suite 产物）')

  // 外部产物（bridge / 旧版主 VSIX）经 env 提供——测试启动器不反向依赖
  // 外部仓构建，也不把外部产物入库
  const bridgeVsix = process.env.VSIDIAN_TEST_CODEX_BRIDGE_VSIX
  const legacyVsix = process.env.VSIDIAN_TEST_CODEX_LEGACY_VSIX
  if (!bridgeVsix || !existsSync(bridgeVsix)) {
    throw new Error(`需要 VSIDIAN_TEST_CODEX_BRIDGE_VSIX 指向存在的 bridge VSIX（当前 ${JSON.stringify(bridgeVsix)}）`)
  }
  if (!legacyVsix || !existsSync(legacyVsix)) {
    throw new Error(`需要 VSIDIAN_TEST_CODEX_LEGACY_VSIX 指向存在的 v1.1.0 旧主 VSIX（当前 ${JSON.stringify(legacyVsix)}）`)
  }
  const bridgeViolations = auditBridgeVsixEntries(await listVsixEntries(bridgeVsix))
  if (bridgeViolations.length > 0) {
    throw new Error(`bridge VSIX 审计未过：${bridgeViolations.join('；')}`)
  }
  console.log('[runInstalledCodexBridge] bridge VSIX 条目审计通过（宿主/页面/mermaid 产物与分块在场）')

  const overrideExecutable = process.env.VSIDIAN_TEST_VSCODE_PATH
  const executable = overrideExecutable || await downloadAndUnzipVSCode({ version: '1.82.3' })
  console.log(`[runInstalledCodexBridge] 测试宿主：${executable}${overrideExecutable ? '（VSIDIAN_TEST_VSCODE_PATH 覆盖）' : ''}`)
  const cliPath = process.platform === 'win32'
    ? path.join(path.dirname(executable), 'bin', 'code.cmd')
    : path.join(path.dirname(executable), 'bin', 'code')

  const fullRun = singlePhase === null
  if (fullRun) {
    mkdirSync(vsixDir, { recursive: true })
    await packageMainVsix({ root, outVsix: mainVsixPath })
    rmSync(profileDir, { recursive: true, force: true })
    mkdirSync(extensionsDir, { recursive: true })
    mkdirSync(userDataDir, { recursive: true })
  } else {
    requireArtifact(mainVsixPath, '先全阶段运行建立产物（node test/integration/runInstalledCodexBridge.mjs）')
    requireArtifact(extensionsDir, 'profile 不存在——先全阶段运行')
  }

  const install = (vsix, force = false) => installExtension({ cliPath, vsix, extensionsDir, userDataDir, force })
  const mainInstallDir = () => {
    // 精确 id 定位（T08 坑点修复）：与 bridge 同装时字典序取尾会拿错——
    // installedExtensionDir 按版本段数字开头判主扩展目录
    const found = installedExtensionDir(extensionsDir, 'onegayi.vsidian')
    if (!found) {
      throw new Error(`主扩展安装目录未找到：${extensionsDir}`)
    }
    return found.dir
  }

  // 阶段 legacy：装 v1.1.0 旧主 VSIX（升级前真实旧物基线）
  if (singlePhase === null || singlePhase === 'legacy') {
    if (singlePhase === null) {
      await install(legacyVsix)
      console.log('[runInstalledCodexBridge] 阶段 legacy 装配：v1.1.0 旧主 VSIX 已装入隔离 profile')
    }
    await runPhase({ phase: 'legacy', devPath: mainInstallDir(), cliPath, executable })
  }

  // 阶段 upgraded：主 VSIX --force 同版本覆盖（升级）+ bridge 同装
  if (singlePhase === null || singlePhase === 'upgraded') {
    if (singlePhase === null) {
      await install(mainVsixPath, true)
      await install(bridgeVsix)
      console.log('[runInstalledCodexBridge] 阶段 upgraded 装配：本分支主 VSIX --force 覆盖 + bridge 同装')
    }
    await runPhase({ phase: 'upgraded', devPath: mainInstallDir(), cliPath, executable })
  }

  if (fullRun) {
    rmSync(profileDir, { recursive: true, force: true })
    console.log('[runInstalledCodexBridge] 全阶段通过；profile 已清理（报告与主 VSIX 保留供复核）')
  }
}

try {
  await main()
} catch (err) {
  console.error('[runInstalledCodexBridge] 运行失败', err)
  console.error(`[runInstalledCodexBridge] 现场保留供诊断：${profileDir}（报告 out/test/t08-phase-*.log；主 VSIX out/test/t08-vsix/）`)
  process.exitCode = 1
}
