// #365 T16 附加组件双 VSIX 安装态、重启与升级回归启动器。
//
// 真实安装链（runInstalled.mjs 先例的扩展）：主 Vsidian VSIX + 三套 T15
// 样例 VSIX（+ 两枚负向夹具 VSIX）经 VSCode 1.82.3 CLI --install-extension
// 装入隔离 profile 的 extensions 目录，测试模式以安装解压产物为
// development path 运行同一集成 suite——被测代码是 VSIX 产物，禁止仓库
// 源码/dev path 注入代替安装链。
//
// 阶段矩阵（同一 profile 跨阶段保留 user-data = 重启/升级不重置的载体；
// 每阶段独立 fixture 工作区，globalState 持久在 user-data 不随工作区换新）：
// - A 依赖缺失：仅装组件 VSIX（主缺席），空壳 dev anchor 满足测试模式装配；
// - B 补装主 VSIX：全矩阵（发现/包内容/默认功能/热接入/重复注册/T12 链/
//   建立跨重启持久状态）；
// - C 发行态：宿主不设 VSIDIAN_TEST_HOOKS——钩子缺席断言 + 公开命令在场；
// - D 重启保留：B 建立的行为单项关闭与渲染首选跨重启生效复验；
// - E 升级：--force 同版本覆盖 + 0.2.0 版本差异化升级后状态保留、无重复注册。
//
// 用法：node test/integration/runInstalledAddons.mjs [--phase=A|B|C|D|E]
// 前提：npm run compile（suite 产物）。缺省全阶段顺序执行；--phase 定向
// 重跑单阶段（复用既有 profile 与 VSIX——不重新打包，报告按阶段覆盖）。
// VSIDIAN_TEST_VSCODE_PATH 指向已解压宿主可执行文件时跳过默认下载。
// 报告：out/test/t16-phase-<X>.log（完整逐例输出与退出码，复核读报告）；
// VSIX 产物：out/test/t16-vsix/；profile：out/test/t16-profile/（跨阶段
// 共享，全阶段通过后清理，失败保留供诊断）。
import { downloadAndUnzipVSCode } from '@vscode/test-electron'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generatePerfSample, generateReadingSample, generateMermaidDenseSample } from '../perf/gen-sample.mjs'
import { writeFixtures, LARGE_DOC_LINES } from './fixtures.mjs'
import { buildTestHostArgs, evaluateHostReport, resolveTestHostMode, runTestHost, writeTestWorkspaceFile } from './testHost.mjs'
import { buildAllExamples } from '../examples/tools/buildLib.mjs'
import {
  applyPhaseEnv,
  auditAddonVsixEntries,
  auditMainVsixEntries,
  installExtension,
  installedExtensionDir,
  listVsixEntries,
  packageExtensionVsix,
  packageMainVsix,
  phaseHostEnv,
  writeDevAnchor,
} from './t16Package.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const EXAMPLE_IDS = {
  'input-behavior': 'vsidian-example.input-behavior',
  renderer: 'vsidian-example.renderer',
  'ui-command': 'vsidian-example.ui-command',
}
const FIXTURES = [
  { dir: 'addon-incompatible', vsix: 'addon-incompatible.vsix', hostOnly: true },
  { dir: 'addon-fail', vsix: 'addon-fail.vsix', hostOnly: true, hostEntry: 'extension/extension.js', extraFiles: ['extension.js'] },
]

const phaseArg = process.argv.find((arg) => arg.startsWith('--phase='))
const singlePhase = phaseArg ? phaseArg.slice('--phase='.length) : null
if (singlePhase && !['A', 'B', 'C', 'D', 'E'].includes(singlePhase)) {
  console.error(`[runInstalledAddons] 未知阶段 ${JSON.stringify(singlePhase)}（可选 A/B/C/D/E）`)
  process.exit(1)
}

const outDir = path.join(root, 'out', 'test')
const vsixDir = path.join(outDir, 't16-vsix')
const profileDir = path.join(outDir, 't16-profile')
const extensionsDir = path.join(profileDir, 'extensions')
const userDataDir = path.join(profileDir, 'user-data')

/** 已打包的样例 VSIX 清单（阶段 A/B 用 0.1.0，阶段 E 升级用 0.2.0） */
const exampleVsix = (name, version) => path.join(vsixDir, `${name}-${version}.vsix`)
const mainVsixPath = path.join(vsixDir, 'vsidian-main.vsix')

function requireArtifact(file, hint) {
  if (!existsSync(file)) {
    throw new Error(`缺少 ${file}（${hint}）`)
  }
}

/** 打包全部 VSIX（全阶段模式：先清空旧产物重打；定向单阶段跳过打包） */
async function packageAll() {
  rmSync(vsixDir, { recursive: true, force: true })
  mkdirSync(vsixDir, { recursive: true })
  // 主 VSIX（仓库根 cwd——.vscodeignore 与 vscode:prepublish 生产链路）
  await packageMainVsix({ root, outVsix: mainVsixPath })
  // 三样例：0.1.0（源版本）与 0.2.0（升级用版本差异化包）
  for (const name of Object.keys(EXAMPLE_IDS)) {
    const srcDir = path.join(root, 'test', 'examples', name)
    await packageExtensionVsix({ srcDir, outVsix: exampleVsix(name, '0.1.0') })
    await packageExtensionVsix({ srcDir, outVsix: exampleVsix(name, '0.2.0'), versionOverride: '0.2.0' })
  }
  // 两枚负向夹具（声明不兼容 / 激活失败）
  for (const fixture of FIXTURES) {
    await packageExtensionVsix({
      srcDir: path.join(root, 'test', 'integration', 'addonFixtures', fixture.dir),
      outVsix: path.join(vsixDir, fixture.vsix),
      extraFiles: fixture.extraFiles ?? [],
    })
  }
  // 包内容审计（打包期第一道；安装目录形态由 B 阶段用例钉第二道）
  const mainViolations = auditMainVsixEntries(await listVsixEntries(mainVsixPath))
  if (mainViolations.length > 0) {
    throw new Error(`主 VSIX 审计未过：${mainViolations.join('；')}`)
  }
  const addonExpect = (name) => {
    const pages = ['extension/dist/editor.js']
    const css = name === 'input-behavior' ? [] : ['extension/dist/editor.css']
    if (name === 'ui-command') {
      pages.push('extension/dist/settings.js')
    }
    return { pages, css }
  }
  for (const name of Object.keys(EXAMPLE_IDS)) {
    const violations = auditAddonVsixEntries(await listVsixEntries(exampleVsix(name, '0.1.0')), addonExpect(name))
    if (violations.length > 0) {
      throw new Error(`样例 ${name} VSIX 审计未过：${violations.join('；')}`)
    }
  }
  for (const fixture of FIXTURES) {
    const violations = auditAddonVsixEntries(
      await listVsixEntries(path.join(vsixDir, fixture.vsix)),
      fixture.hostEntry
        ? { hostOnly: true, hostEntry: fixture.hostEntry }
        : { hostOnly: fixture.hostOnly, pages: [], css: [] },
    )
    if (violations.length > 0) {
      throw new Error(`夹具 ${fixture.dir} VSIX 审计未过：${violations.join('；')}`)
    }
  }
  console.log('[runInstalledAddons] 全部 VSIX 打包并通过条目审计（主 + 3 样例 x2 版本 + 2 夹具）')
}

/** 运行一个阶段：fixture 工作区 + 阶段环境 + 宿主启动 + 报告落盘。
 * disableExtensionIds：固定「依赖不可用」态（1.82.3 工作台会为缺失的
 * extensionDependencies 自动从 marketplace 补装——依赖缺失场景以禁用
 * 主扩展钉住，实测发现记录于票面） */
async function runPhase({ phase, hooks, devPath, cliPath, executable, disableExtensionIds = [] }) {
  const wsDir = mkdtempSync(path.join(tmpdir(), `vsidian-t16-${phase.toLowerCase()}-`))
  const reportPath = path.join(outDir, `t16-phase-${phase.toLowerCase()}.log`)
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
    args.push(...disableExtensionIds.map((id) => `--disable-extension=${id}`))
    const mode = resolveTestHostMode()
    const env = applyPhaseEnv({
      ...process.env,
      WORKSPACE_DIR: wsDir,
      LARGE_DOC_LINES: String(LARGE_DOC_LINES),
      VSIDIAN_T16_EXTENSIONS_DIR: extensionsDir,
    }, phaseHostEnv(phase, { hooks }))
    console.log(`[runInstalledAddons] 阶段 ${phase} 启动（dev path：${devPath}；钩子：${hooks ? '在场' : '缺席（发行态）'}；模式：${mode}）`)
    const code = await runTestHost({ executable, args, mode, env, reportPath })
    if (code !== 0) {
      // 退出码非零但报告零 FAIL 且全部用例取得终态时放行（#211 收尾噪声
      // 族与 runTest.mjs 同一判定纯函数）
      const verdict = evaluateHostReport(readFileSync(reportPath, 'utf8').split(/\r?\n/), code)
      if (!verdict.ok) {
        throw new Error(`阶段 ${phase} 退出码 ${code}：${verdict.reason}（报告：${reportPath}）`)
      }
      console.warn(`[runInstalledAddons] 阶段 ${phase} 退出码 ${code} 但${verdict.reason}`)
    }
    console.log(`[runInstalledAddons] 阶段 ${phase} 通过（报告：${reportPath}）`)
    return true
  } finally {
    rmSync(`${wsDir}.code-workspace`, { force: true })
    rmSync(wsDir, { recursive: true, force: true })
  }
}

async function main() {
  requireArtifact(path.join(root, 'out', 'extension.js'), '先 npm run compile')
  requireArtifact(path.join(root, 'out', 'test', 'integration', 'suite', 'index.js'), '先 npm run compile（suite 产物）')
  // 样例构建（dist 产物——打包与后续阶段依赖）
  await buildAllExamples({ log: () => {} })
  console.log('[runInstalledAddons] T15 样例工程已构建')

  const overrideExecutable = process.env.VSIDIAN_TEST_VSCODE_PATH
  const executable = overrideExecutable || await downloadAndUnzipVSCode({ version: '1.82.3' })
  console.log(`[runInstalledAddons] 测试宿主：${executable}${overrideExecutable ? '（VSIDIAN_TEST_VSCODE_PATH 覆盖）' : ''}`)
  const cliPath = process.platform === 'win32'
    ? path.join(path.dirname(executable), 'bin', 'code.cmd')
    : path.join(path.dirname(executable), 'bin', 'code')

  const fullRun = singlePhase === null
  if (fullRun) {
    await packageAll()
    rmSync(profileDir, { recursive: true, force: true })
    mkdirSync(extensionsDir, { recursive: true })
    mkdirSync(userDataDir, { recursive: true })
  } else {
    // 定向单阶段：profile 与 VSIX 必须已存在（此前全阶段运行产物）
    requireArtifact(mainVsixPath, '先全阶段运行建立产物（node test/integration/runInstalledAddons.mjs）')
    requireArtifact(path.join(extensionsDir), 'profile 不存在——先全阶段运行')
  }

  const install = (vsix, force = false) => installExtension({ cliPath, vsix, extensionsDir, userDataDir, force })
  const mainInstallDir = () => {
    const found = installedExtensionDir(extensionsDir, 'onegayi.vsidian')
    if (!found) {
      throw new Error(`主扩展安装目录未找到：${extensionsDir}`)
    }
    return found.dir
  }

  // 阶段 A：依赖缺失（仅组件；主缺席——dev path 用空壳锚，不引入真实扩展）
  if (singlePhase === null || singlePhase === 'A') {
    if (singlePhase === null) {
      for (const name of Object.keys(EXAMPLE_IDS)) {
        await install(exampleVsix(name, '0.1.0'))
      }
      for (const fixture of FIXTURES) {
        await install(path.join(vsixDir, fixture.vsix))
      }
      console.log('[runInstalledAddons] 阶段 A 装配：3 样例 0.1.0 + 2 负向夹具（主 VSIX 缺席）')
    }
    const anchor = writeDevAnchor(path.join(profileDir, 'dev-anchor'))
    await runPhase({ phase: 'A', hooks: true, devPath: anchor, cliPath, executable, disableExtensionIds: ['onegayi.vsidian'] })
  }

  // 阶段 B：补装主 VSIX（全矩阵；dev path = 主安装解压目录——真实安装链）
  if (singlePhase === null || singlePhase === 'B') {
    if (singlePhase === null) {
      // --force：覆盖依赖解析可能留下的任何占位（marketplace 自动补装
      // 见阶段 A 注释）——本地 VSIX 产物必须是安装链权威
      await install(mainVsixPath, true)
      console.log('[runInstalledAddons] 阶段 B 装配：补装主 VSIX（--force 覆盖占位）')
    }
    await runPhase({ phase: 'B', hooks: true, devPath: mainInstallDir(), cliPath, executable })
  }

  // 阶段 C：发行态（不设 VSIDIAN_TEST_HOOKS——钩子缺席本身是用例断言面）
  if (singlePhase === null || singlePhase === 'C') {
    await runPhase({ phase: 'C', hooks: false, devPath: mainInstallDir(), cliPath, executable })
  }

  // 阶段 D：重启保留（同一 profile 再次启动）。注：1.82.3 测试模式宿主的
  // storage 完全 in-memory（写入/预置均不落盘也不读盘——quit 优雅退出、
  // 周期等待、sqlite 直写+marker 三途径实证），跨会话 globalState 持久化
  // 在该通道不可达；D/E 以「会话内持久语义闭环」承载可自动化面，通道
  // 边界与正常路径落盘实证记录于票面（未决事项）
  if (singlePhase === null || singlePhase === 'D') {
    await runPhase({ phase: 'D', hooks: true, devPath: mainInstallDir(), cliPath, executable })
  }

  // 阶段 E：升级（--force 同版本覆盖一次 + 0.2.0 版本差异化升级）
  if (singlePhase === null || singlePhase === 'E') {
    if (singlePhase === null) {
      const rendererVsix = exampleVsix('renderer', '0.1.0')
      await install(rendererVsix, true)
      console.log('[runInstalledAddons] 阶段 E 装配：renderer 0.1.0 --force 同版本覆盖（重复安装口径）')
      for (const name of Object.keys(EXAMPLE_IDS)) {
        await install(exampleVsix(name, '0.2.0'))
      }
      console.log('[runInstalledAddons] 阶段 E 装配：三样例升级到 0.2.0（版本差异化口径）')
    }
    await runPhase({ phase: 'E', hooks: true, devPath: mainInstallDir(), cliPath, executable })
  }

  if (fullRun) {
    rmSync(profileDir, { recursive: true, force: true })
    console.log('[runInstalledAddons] 全阶段通过；profile 已清理（报告与 VSIX 保留供复核）')
  }
}

try {
  await main()
} catch (err) {
  console.error('[runInstalledAddons] 运行失败', err)
  console.error(`[runInstalledAddons] 现场保留供诊断：${profileDir}（报告 out/test/t16-phase-*.log；VSIX out/test/t16-vsix/）`)
  process.exitCode = 1
}
