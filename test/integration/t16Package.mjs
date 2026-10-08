// #365 T16 附加组件安装态回归——打包与阶段装配库（启动器与单测共用）。
//
// 双 VSIX 安装态：主 Vsidian VSIX + 三套 T15 独立样例 VSIX（+ 两枚负向
// 夹具 VSIX）经 VSCode 1.82.3 CLI --install-extension 装入隔离 profile，
// 测试模式从安装解压产物加载（同 runInstalled.mjs 先例）；阶段矩阵经
// 同一 profile 多次启动承载「重启/升级不重置」。
//
// 本文件分两层：
// - 纯逻辑（单测覆盖）：主/组件 VSIX 条目断言、阶段宿主环境拼装；
// - 副作用（启动器调用）：vsce 打包（staging + 版本差异化）、CLI 安装、
//   阶段 A 的空壳 development path 锚目录。
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

/** T16 阶段矩阵（启动器按序执行；用例体经 phaseGuard 选择执行）
 * - A 依赖缺失：仅装组件 VSIX（不装主），样例激活因缺依赖失败
 * - B 补装主 VSIX：发现/包内容/默认功能/热接入/重复注册/T12 链/建立持久状态
 * - C 发行态（不设 VSIDIAN_TEST_HOOKS）：钩子缺席断言 + 样例公开命令可用
 * - D 重启保留：B 建立的行为单项关闭与渲染首选跨重启仍在且生效
 * - E 升级：--force 同版本覆盖 + 0.2.0 版本升级后状态保留、目录唯一
 */
export const T16_PHASES = ['A', 'B', 'C', 'D', 'E']

/** T16 安装态用例的名称子串（VSIDIAN_TEST_CASES 定向筛选） */
export const T16_CASE_FILTER = '附加组件 T16'

/** 主 VSIX 中不得出现的目录前缀（.vscodeignore 排除面的断言镜像） */
const MAIN_VSIX_FORBIDDEN_PREFIXES = [
  'extension/src/',
  'extension/test/',
  'extension/docs/',
  'extension/examples/',
  'extension/.agents/',
]

/** 主 VSIX 必含产物（宿主入口 + 两 webview 产物 + 清单；缺一即打包缺漏） */
const MAIN_VSIX_REQUIRED_ENTRIES = [
  'extension/package.json',
  'extension/out/extension.js',
  'extension/out/webview/main.js',
  'extension/out/webview/settings.js',
]

/** 纯逻辑：主 VSIX 条目断言（tar -tf 条目清单；返回违规清单，空数组=通过）
 * 主包排除 src/test/docs/示例工程（票面验收）与关键产物完整性同面断言 */
export function auditMainVsixEntries(entries) {
  const normalized = entries.map((entry) => entry.replace(/\\/g, '/').replace(/^\.\//, '')?.trim()).filter(Boolean)
  const violations = []
  for (const entry of normalized) {
    for (const prefix of MAIN_VSIX_FORBIDDEN_PREFIXES) {
      if (entry === prefix.slice(0, -1) || entry.startsWith(prefix)) {
        violations.push(`主包不得包含 ${entry}（.vscodeignore 排除面）`)
      }
    }
  }
  for (const required of MAIN_VSIX_REQUIRED_ENTRIES) {
    if (!normalized.includes(required)) {
      violations.push(`主包缺少关键产物 ${required}`)
    }
  }
  return violations
}

/** 纯逻辑：组件 VSIX 条目断言（样例=宿主+页面+样式随包；负向夹具=清单即可）
 * @param {string[]} entries VSIX 条目清单
 * @param {{ pages?: string[], css?: string[], hostOnly?: boolean, hostEntry?: string }} expect
 * - pages：页面产物相对路径（如 ['extension/dist/editor.js']）
 * - css：随包样式（如 ['extension/dist/editor.css']）
 * - hostOnly：true = 只要求清单（addon-incompatible 无产物形态）
 * - hostEntry：根级宿主入口（如 addon-fail 的 'extension/extension.js'
 *   ——main 指根级文件而非 dist 产物的夹具形态） */
export function auditAddonVsixEntries(entries, expect) {
  const normalized = entries.map((entry) => entry.replace(/\\/g, '/').replace(/^\.\//, '')?.trim()).filter(Boolean)
  const violations = []
  if (!normalized.includes('extension/package.json')) {
    violations.push('组件包缺少 extension/package.json')
  }
  if (!expect.hostOnly && !normalized.includes('extension/dist/extension.js')) {
    violations.push('组件包缺少宿主产物 extension/dist/extension.js')
  }
  for (const hostEntry of expect.hostEntry ? [expect.hostEntry] : []) {
    if (!normalized.includes(hostEntry)) {
      violations.push(`组件包缺少宿主入口 ${hostEntry}`)
    }
  }
  for (const page of expect.pages ?? []) {
    if (!normalized.includes(page)) {
      violations.push(`组件包缺少页面产物 ${page}`)
    }
  }
  for (const css of expect.css ?? []) {
    if (!normalized.includes(css)) {
      violations.push(`组件包缺少样式 ${css}`)
    }
  }
  return violations
}

/**
 * 纯逻辑：某阶段的宿主环境拼装（返回要并入 process.env 的覆盖项）。
 * - 全阶段注入 VSIDIAN_T16_PHASE 与用例定向筛选 VSIDIAN_TEST_CASES；
 * - hooks=false（发行态阶段 C）时返回删除标记——启动器须从 env 中删除
 *   VSIDIAN_TEST_HOOKS（继承式 env 里残留 '1' 会把发行态会话变成测试
 *   会话，样例门控随之惰性，断言面失真）；
 * - hooks=true 时显式置 '1'（不依赖外层残留）。
 */
export function phaseHostEnv(phase, { hooks }) {
  if (!T16_PHASES.includes(phase)) {
    throw new Error(`未知 T16 阶段：${JSON.stringify(phase)}（可选 ${T16_PHASES.join('/')}）`)
  }
  const env = {
    VSIDIAN_T16_PHASE: phase,
    VSIDIAN_TEST_CASES: T16_CASE_FILTER,
  }
  if (hooks) {
    env.VSIDIAN_TEST_HOOKS = '1'
  } else {
    env['!delete'] = ['VSIDIAN_TEST_HOOKS']
  }
  return env
}

/** 纯逻辑：把 phaseHostEnv 的覆盖项应用到目标 env（删除标记落地） */
export function applyPhaseEnv(target, overrides) {
  const next = { ...target }
  const deletions = overrides['!delete'] ?? []
  delete next['!delete']
  for (const key of deletions) {
    delete next[key]
  }
  const { ['!delete']: _omit, ...rest } = overrides
  void _omit
  return { ...next, ...rest }
}

// ---- 副作用层（启动器调用；单测不触达） ----

/**
 * 打包一枚扩展 VSIX：最小集 staging（package.json + dist/ + 根级实现文件）
 * → vsce package --no-dependencies。versionOverride 用于版本差异化升级包
 * （改写 staging 内 package.json 的 version，不动源工程）。
 * @param {{ srcDir: string, outVsix: string, versionOverride?: string,
 *           extraFiles?: string[], cwdEnv?: NodeJS.ProcessEnv }} input
 */
export async function packageExtensionVsix({ srcDir, outVsix, versionOverride, extraFiles = [], stdio = 'inherit' }) {
  const staging = `${outVsix}.staging`
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  cpSync(path.join(srcDir, 'package.json'), path.join(staging, 'package.json'))
  if (existsSync(path.join(srcDir, 'dist'))) {
    cpSync(path.join(srcDir, 'dist'), path.join(staging, 'dist'), { recursive: true })
  }
  for (const file of extraFiles) {
    cpSync(path.join(srcDir, file), path.join(staging, file))
  }
  if (versionOverride) {
    const manifest = JSON.parse(readFileSync(path.join(staging, 'package.json'), 'utf8'))
    manifest.version = versionOverride
    writeFileSync(path.join(staging, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  }
  const { code } = await runCommand('npx', ['--yes', '@vscode/vsce', 'package', '--no-dependencies', '-o', outVsix], {
    cwd: staging,
    stdio,
  })
  rmSync(staging, { recursive: true, force: true })
  if (code !== 0 || !existsSync(outVsix)) {
    throw new Error(`vsce 打包失败（退出码 ${code}）：${srcDir} -> ${outVsix}`)
  }
  return outVsix
}

/** 主 VSIX 打包（仓库根为 cwd——.vscodeignore 与 prepublish 链路按仓库惯例） */
export async function packageMainVsix({ root, outVsix, stdio = 'inherit' }) {
  const { code } = await runCommand('npx', ['--yes', '@vscode/vsce', 'package', '--no-dependencies', '-o', outVsix], {
    cwd: root,
    stdio,
  })
  if (code !== 0 || !existsSync(outVsix)) {
    throw new Error(`主 VSIX 打包失败（退出码 ${code}）`)
  }
  return outVsix
}

/** 列出 VSIX 内条目（Windows bsdtar 支持 zip 目录；非 Windows 退回 tar） */
export async function listVsixEntries(vsix) {
  const tar = process.platform === 'win32' ? 'C:/Windows/System32/tar.exe' : 'tar'
  const { code, stdout } = await runCommand(tar, ['-tf', vsix], { capture: true })
  if (code !== 0) {
    throw new Error(`VSIX 条目列举失败（退出码 ${code}）：${vsix}`)
  }
  return stdout.split(/\r?\n/).filter(Boolean)
}

/** VSCode CLI 安装扩展到隔离目录（--force 支持同版本覆盖重装） */
export async function installExtension({ cliPath, vsix, extensionsDir, userDataDir, force = false, stdio = 'inherit' }) {
  const args = [
    '--disable-updates',
    `--install-extension=${vsix}`,
    `--extensions-dir=${extensionsDir}`,
    `--user-data-dir=${userDataDir}`,
  ]
  if (force) {
    args.push('--force')
  }
  const shell = process.platform === 'win32'
  const { code } = await runCommand(cliPath, args, { shell, stdio })
  if (code !== 0) {
    throw new Error(`扩展安装失败（退出码 ${code}）：${vsix}`)
  }
}

/** 阶段 A 空壳 development path 锚：无 main/无 activationEvents 的占位扩展，
 * 满足 1.82.3 测试模式对 --extensionDevelopmentPath 在场的要求，且不向
 * 会话引入任何真实扩展（主 VSIX 在该阶段刻意缺席——依赖缺失矩阵） */
export function writeDevAnchor(dir) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({
    name: 't16-dev-anchor',
    publisher: 'vsidian-test',
    displayName: 'T16 Dev Anchor',
    description: 'Placeholder development path anchor for T16 dependency-missing phase (#365).',
    version: '0.0.1',
    engines: { vscode: '^1.82.3' },
  }, null, 2)}\n`, 'utf8')
  return dir
}


/** 通配展开安装目录下的扩展解压目录（publisher.name-<version> 形态） */
export function installedExtensionDir(extensionsDir, extensionId) {
  const prefix = `${extensionId.toLowerCase()}-`
  const hit = readdirSync(extensionsDir).filter((d) => d.toLowerCase().startsWith(prefix))
  if (hit.length === 0) {
    return null
  }
  return { dir: path.join(extensionsDir, hit[hit.length - 1]), count: hit.length }
}

/** 子进程封装：capture 时收集 stdout，否则透传；Windows 下命令解析器
 * （npx / code.cmd）须经 shell 找到（spawn 直调 ENOENT），shell 模式参数
 * 统一加引号防路径空格断裂（runInstalled 先例同口径） */
function runCommand(command, args, { cwd, shell = false, stdio = 'inherit', capture = false } = {}) {
  const useShell = shell || (process.platform === 'win32' && !/[\/]/.test(command))
  const finalArgs = useShell && !shell ? args.map((a) => `"${a}"`) : args
  return new Promise((resolve, reject) => {
    const child = spawn(useShell ? command : command, finalArgs, {
      cwd,
      shell: useShell,
      env: process.env,
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : stdio,
      windowsHide: useShell,
    })
    let stdout = ''
    if (capture) {
      child.stdout.on('data', (d) => { stdout += d.toString() })
    } else if (stdio === 'inherit') {
      child.stdout?.on('data', (d) => process.stdout.write(d))
      child.stderr?.on('data', (d) => process.stderr.write(d))
    }
    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 1, stdout }))
  })
}
