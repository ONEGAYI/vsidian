// #366 T17 附加组件 Remote SSH 同宿主安装、资源与排障——SSH 安装态启动器。
//
// 真实 SSH 链路（远端=本机回环 sshd，链路真实走 SSH——资源 URI、webview
// 装载、扩展宿主都是真路径）：
// - 主 Vsidian VSIX + 三套 T15 样例 VSIX + 两枚负向夹具 VSIX 经 VSCode
//   1.82.3 CLI --install-extension 装入隔离 profile（本地安装链：权威
//   清单 extensions.json + 解压目录——版本/位置证据）；Remote-SSH 0.106.x
//   （engine ^1.82.0-insider；0.107+ 引擎抬高不可装）同链路装入；
// - 被测扩展经**远端清单镜像**装载进远端扩展服务（~/.vscode-server/
//   extensions/extensions.json 镜像本地 CLI 真实安装的权威条目；localhost
//   回环下解压目录两址同盘）——激活/exports/命令注册在远端 ext host
//   真实发生。dev path 用空壳锚满足测试模式装配要求（不注入真实扩展，
//   装载权威走远端清单）。
//
// 架构事实（实测，通道如实处理不绕过）：1.82.3 的 extension tests runner
// 挂在**本地** ext host（remote window 下 workspace 扩展分流到远端）——
// runner 不能直接断言远端清单；断言面经命令路由（本地 runner 调远端注册
// 的命令）+ 样例 stats 的宿主观测自报（样例代码在远端执行，读远端清单）。
//
// 通道边界：
// - 远端 ext host 不继承本地 env：VSIDIAN_TEST_HOOKS / VSIDIAN_TEST_CASES /
//   WORKSPACE_DIR 一概传不进 SSH 会话——hooks 缺席（发行态语义）为用例
//   断言面，用例筛选与阶段经工作区标记文件（writeSshPhaseMarker）；
// - profile 预置 remote.SSH.remotePlatform/confirmFingerprint（缺省时
//   resolver 弹平台选择 QuickPick 且 ignoreFocusOut 永不超时，无人值守
//   会话挂死——探针实证 out/test/t17-probe2-ssh.log）；
// - 首连经 VSCode 标准行为在远端用户目录建 ~/.vscode-server（远端会话
//   产物目录，非本启动器改动的用户 SSH 配置）；首连含 server 下载，
//   阶段超时给足。
//
// 阶段矩阵：
// - R1 全装载：主 + 三样例 + 两夹具镜像进远端清单（发行态远端会话全量
//   断言：同宿主接入/页面装载/三类公开接入/卸载重接）；
// - R2 宿主不可见负向：远端镜像少 input-behavior（本地安装仍在——同一
//   安装下宿主可见性差异）——「当前宿主查不到」不冒充「未安装/装错侧」。
//
// 用法：node test/integration/runRemoteSshAddons.mjs [--phase=R1|R2]
// 前提：npm run compile；sshd 运行中且 `ssh localhost` BatchMode 免密可
// 直连（环境探测记录于票面；无通道时本启动器在 Remote-SSH 安装/连接步
// 失败并如实退出，不用本机 mock 冒充通过）。VSIDIAN_TEST_VSCODE_PATH
// 指向已解压宿主时跳过默认下载。
// 报告：out/test/t17-phase-<r1|r2>.log；VSIX 产物：out/test/t17-vsix/；
// profile：out/test/t17-profile/（跨阶段共享；全阶段通过后清理，失败保留）。
import { downloadAndUnzipVSCode } from '@vscode/test-electron'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generatePerfSample, generateReadingSample, generateMermaidDenseSample } from '../perf/gen-sample.mjs'
import { writeFixtures } from './fixtures.mjs'
import { buildTestHostArgs, evaluateHostReport, resolveTestHostMode, runTestHost, writeTestWorkspaceFile } from './testHost.mjs'
import { buildAllExamples } from '../examples/tools/buildLib.mjs'
import { installExtension, installedExtensionDir, packageExtensionVsix, packageMainVsix, writeDevAnchor } from './t16Package.mjs'
import {
  REMOTE_SSH_COMPAT_VERSION,
  T17_SSH_CASE_FILTER,
  ensureRemoteSshVsix,
  mirrorExtensionsToRemoteServer,
  remoteSshProfileSettings,
  withRemoteArg,
  writeSshPhaseMarker,
} from './t17RemoteSsh.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** SSH 目标主机（远端=本机回环；改配置文件形态的主机名同样适用） */
const SSH_HOST = process.env.VSIDIAN_T17_SSH_HOST ?? 'localhost'
/** 远端平台（remote.SSH.remotePlatform 预置值） */
const SSH_PLATFORM = process.env.VSIDIAN_T17_SSH_PLATFORM ?? 'windows'

const EXAMPLE_IDS = {
  'input-behavior': 'vsidian-example.input-behavior',
  renderer: 'vsidian-example.renderer',
  'ui-command': 'vsidian-example.ui-command',
}
const FIXTURES = [
  { id: 'vsidian-test-fixture.addon-incompatible', dir: 'addon-incompatible', vsix: 'addon-incompatible.vsix' },
  { id: 'vsidian-test-fixture.addon-fail', dir: 'addon-fail', vsix: 'addon-fail.vsix', extraFiles: ['extension.js'] },
]

const phaseArg = process.argv.find((arg) => arg.startsWith('--phase='))
const singlePhase = phaseArg ? phaseArg.slice('--phase='.length).toUpperCase() : null
if (singlePhase && singlePhase !== 'R1' && singlePhase !== 'R2') {
  console.error(`[runRemoteSshAddons] 未知阶段 ${JSON.stringify(singlePhase)}（可选 R1/R2）`)
  process.exit(1)
}

const outDir = path.join(root, 'out', 'test')
const vsixDir = path.join(outDir, 't17-vsix')
const profileDir = path.join(outDir, 't17-profile')
const extensionsDir = path.join(profileDir, 'extensions')
const userDataDir = path.join(profileDir, 'user-data')
const remoteSshCacheDir = path.join(outDir, 't17-remote-ssh')
/** 远端 server 扩展目录（VSCode 标准远端安装位置；localhost 回环=本机路径） */
const remoteServerExtensionsDir = path.join(homedir(), '.vscode-server', 'extensions')
const mainVsixPath = path.join(vsixDir, 'vsidian-main.vsix')
const exampleVsix = (name) => path.join(vsixDir, `${name}-0.1.0.vsix`)

function requireArtifact(file, hint) {
  if (!existsSync(file)) {
    throw new Error(`缺少 ${file}（${hint}）`)
  }
}

/** 打包全部 VSIX（全阶段模式清空重打；定向单阶段跳过——复用既有产物） */
async function packageAll() {
  rmSync(vsixDir, { recursive: true, force: true })
  mkdirSync(vsixDir, { recursive: true })
  await packageMainVsix({ root, outVsix: mainVsixPath })
  for (const name of Object.keys(EXAMPLE_IDS)) {
    await packageExtensionVsix({ srcDir: path.join(root, 'test', 'examples', name), outVsix: exampleVsix(name) })
  }
  for (const fixture of FIXTURES) {
    await packageExtensionVsix({
      srcDir: path.join(root, 'test', 'integration', 'addonFixtures', fixture.dir),
      outVsix: path.join(vsixDir, fixture.vsix),
      extraFiles: fixture.extraFiles ?? [],
    })
  }
  console.log('[runRemoteSshAddons] 全部 VSIX 打包完成（主 + 3 样例 + 2 负向夹具）')
}

/** 运行一个 SSH 阶段：远端清单镜像（阶段差分面）+ fixture 工作区 + 阶段
 * 标记 + 空壳 dev 锚 + 远端宿主启动 + 报告。 */
async function runPhase({ phase, executable, includeIds, governedIds }) {
  // 远端清单镜像（R2 的差分在此发生：includeIds 少 input-behavior）
  const mirrored = mirrorExtensionsToRemoteServer({
    serverExtensionsDir: remoteServerExtensionsDir,
    localExtensionsDir: extensionsDir,
    includeIds,
    governedIds,
  })
  console.log(`[runRemoteSshAddons] 远端清单镜像：${mirrored.mirrored.length}/${governedIds.length} 项（清单共 ${mirrored.total} 条）`)
  const wsDir = mkdtempSync(path.join(tmpdir(), `vsidian-t17-${phase.toLowerCase()}-`))
  const reportPath = path.join(outDir, `t17-phase-${phase.toLowerCase()}.log`)
  try {
    await writeFixtures(wsDir, { generatePerfSample, generateReadingSample, generateMermaidDenseSample })
    // 阶段标记（含用例筛选——远端 ext host 读不到 env，兜底通道消费）
    writeSshPhaseMarker(wsDir, phase, T17_SSH_CASE_FILTER)
    const wsFile = writeTestWorkspaceFile(wsDir)
    // dev path 用空壳锚：测试模式要求 --extensionDevelopmentPath 在场，被测
    // 扩展的装载权威走远端清单镜像（不注入真实扩展，T16 阶段 A 同构先例）
    const anchor = writeDevAnchor(path.join(profileDir, 'dev-anchor'))
    const args = withRemoteArg(buildTestHostArgs({
      workspaceDir: wsFile,
      testsPath: path.join(root, 'out', 'test', 'integration', 'suite', 'index.js'),
      extensionPath: anchor,
      extensionsDir,
      userDataDir,
    }), SSH_HOST)
    const mode = resolveTestHostMode()
    // env 不传远端（通道边界见模块头）——本地侧仅有的 env 是 UI 进程继承，
    // 与远端 ext host 无关；刻意不设 VSIDIAN_TEST_HOOKS（发行态语义）
    const env = { ...process.env }
    delete env.VSIDIAN_TEST_HOOKS
    console.log(`[runRemoteSshAddons] 阶段 ${phase} 启动（--remote ssh-remote+${SSH_HOST}；dev path：空壳锚；远端镜像 ${includeIds.length} 项；模式：${mode}）`)
    const code = await runTestHost({ executable, args, mode, env, reportPath, timeoutMs: 20 * 60_000 })
    if (code !== 0) {
      const verdict = evaluateHostReport(readFileSync(reportPath, 'utf8').split(/\r?\n/), code)
      if (!verdict.ok) {
        throw new Error(`阶段 ${phase} 退出码 ${code}：${verdict.reason}（报告：${reportPath}）`)
      }
      console.warn(`[runRemoteSshAddons] 阶段 ${phase} 退出码 ${code} 但${verdict.reason}`)
    }
    console.log(`[runRemoteSshAddons] 阶段 ${phase} 通过（报告：${reportPath}）`)
    return true
  } finally {
    // 阶段工作区清理尽力而为（#367——Windows 句柄延迟释放：SSH server/
    // 宿主退出竞态下 rmSync 报 EPERM/EBUSY，T18 重跑实测 R1 四用例全过
    // 仍被清理异常判整轮失败）。临时目录位于系统 Temp，清理失败只留痕
    // 不阻断矩阵结论（#211 teardown 噪声边界同精神）。
    const cleanup = (target, recursive) => {
      for (let attempt = 0; ; attempt++) {
        try {
          rmSync(target, { recursive, force: true })
          return
        } catch (err) {
          const code = err?.code
          if (attempt >= 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'ENOTEMPTY')) {
            if (code !== undefined) {
              console.warn(`[runRemoteSshAddons] 阶段工作区清理失败（${code}，保留 ${target} 由系统临时区回收）`)
            }
            return
          }
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500)
        }
      }
    }
    cleanup(`${wsDir}.code-workspace`, false)
    cleanup(wsDir, true)
  }
}

/** 远端安装面审计（启动器侧 fs 证据：runner 在本地 ext host 读不到远端
 * 清单，安装面断言由本函数承载，结果进控制台与报告） */
function auditRemoteInstallSurface(includeIds) {
  const manifest = JSON.parse(readFileSync(path.join(remoteServerExtensionsDir, 'extensions.json'), 'utf8'))
  const remoteIds = new Set(manifest.map((entry) => (entry.identifier?.id ?? '').toLowerCase()))
  const problems = []
  for (const id of includeIds) {
    if (!remoteIds.has(id.toLowerCase())) {
      problems.push(`远端清单缺 ${id}`)
      continue
    }
    // 远端解压目录形态（镜像复制的物理目录在场）
    const found = installedExtensionDir(remoteServerExtensionsDir, id)
    if (!found) {
      problems.push(`远端扩展目录缺 ${id}`)
      continue
    }
    if (id === 'onegayi.vsidian') {
      const top = readdirSync(found.dir)
      for (const forbidden of ['src', 'test', 'docs', '.agents', 'examples']) {
        if (top.includes(forbidden)) {
          problems.push(`主扩展安装目录不得含 ${forbidden}/`)
        }
      }
      if (!existsSync(path.join(found.dir, 'out', 'extension.js'))) {
        problems.push('主扩展安装目录应含 out/extension.js')
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(`远端安装面审计未过：${problems.join('；')}`)
  }
  console.log(`[runRemoteSshAddons] 远端安装面审计通过（远端清单 ${manifest.length} 条，镜像 ${includeIds.length} 项目录在场，主包排除面 OK）`)
}

async function main() {
  requireArtifact(path.join(root, 'out', 'extension.js'), '先 npm run compile')
  requireArtifact(path.join(root, 'out', 'test', 'integration', 'suite', 'index.js'), '先 npm run compile（suite 产物）')
  await buildAllExamples({ log: () => {} })
  console.log('[runRemoteSshAddons] T15 样例工程已构建')

  const overrideExecutable = process.env.VSIDIAN_TEST_VSCODE_PATH
  const executable = overrideExecutable || await downloadAndUnzipVSCode({ version: '1.82.3' })
  console.log(`[runRemoteSshAddons] 测试宿主：${executable}${overrideExecutable ? '（VSIDIAN_TEST_VSCODE_PATH 覆盖）' : ''}`)
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
    requireArtifact(mainVsixPath, '先全阶段运行建立产物（node test/integration/runRemoteSshAddons.mjs）')
    requireArtifact(extensionsDir, 'profile 不存在——先全阶段运行')
  }

  // 安装链（本地隔离 profile：权威清单 + 解压目录——版本/位置证据）
  const install = (vsix, force = false) => installExtension({ cliPath, vsix, extensionsDir, userDataDir, force })
  if (fullRun) {
    await install(mainVsixPath, true)
    for (const name of Object.keys(EXAMPLE_IDS)) {
      await install(exampleVsix(name))
    }
    for (const fixture of FIXTURES) {
      await install(path.join(vsixDir, fixture.vsix))
    }
    const remoteSshVsix = await ensureRemoteSshVsix({ cacheDir: remoteSshCacheDir })
    await install(remoteSshVsix)
    console.log(`[runRemoteSshAddons] 安装链完成（主 + 3 样例 + 2 夹具 + Remote-SSH ${REMOTE_SSH_COMPAT_VERSION}）`)
    // profile 预置：跳过首连交互（探针实证的挂死根因，见 t17RemoteSsh.mjs 头注）
    const settings = remoteSshProfileSettings({ host: SSH_HOST, platform: SSH_PLATFORM })
    const userDir = path.join(userDataDir, 'User')
    mkdirSync(userDir, { recursive: true })
    writeFileSync(path.join(userDir, 'settings.json'), `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
    console.log(`[runRemoteSshAddons] profile 预置 Remote-SSH 设置（remotePlatform.${SSH_HOST}=${SSH_PLATFORM}；confirmFingerprint=false）`)
  }

  // T17 管辖集：被测 id 全集（远端镜像的差分只在管辖内发生）
  const governedIds = ['onegayi.vsidian', ...Object.values(EXAMPLE_IDS), ...FIXTURES.map((f) => f.id)]
  const allIncludeIds = governedIds.slice()

  // 阶段 R1：全装载（发行态远端会话全量断言）
  if (singlePhase === null || singlePhase === 'R1') {
    await runPhase({ phase: 'R1', executable, includeIds: allIncludeIds, governedIds })
    auditRemoteInstallSurface(allIncludeIds)
  }

  // 阶段 R2：宿主不可见负向（远端镜像少 input-behavior；本地安装仍在——
  // 同一安装下宿主可见性差异，「当前宿主查不到」不冒充「未安装/装错侧」）
  if (singlePhase === null || singlePhase === 'R2') {
    const reduced = governedIds.filter((id) => id !== EXAMPLE_IDS['input-behavior'])
    console.log('[runRemoteSshAddons] 阶段 R2 装配面：远端镜像不含 input-behavior（本地安装仍在——可见性负向）')
    await runPhase({ phase: 'R2', executable, includeIds: reduced, governedIds })
  }

  if (fullRun) {
    rmSync(profileDir, { recursive: true, force: true })
    console.log('[runRemoteSshAddons] 全阶段通过；profile 已清理（报告与 VSIX 保留供复核）')
  }
}

try {
  await main()
} catch (err) {
  console.error('[runRemoteSshAddons] 运行失败', err)
  console.error(`[runRemoteSshAddons] 现场保留供诊断：${profileDir}（报告 out/test/t17-phase-*.log；VSIX out/test/t17-vsix/）`)
  process.exitCode = 1
}
