// #335 原生文字外观探针启动器（P3-03）。
// 复用 test/integration/testHost.mjs 真宿主框架：下载 1.82.3 便携宿主、
// 独立用户数据/扩展目录、报告与退出码落盘。与常规集成回归的差异：
// 1) 不传 --disable-extensions（内置语言/主题扩展必须在场，第三方 grammar
//    经 marketplace CLI 预装进探针专属 extensions 目录）；
// 2) 每轮预置 user settings（主题、tokenColor/semanticToken 自定义、
//    [typescript] 语言级字体），驱动明暗主题与自定义矩阵；
// 3) 证据 JSON 写入 docs/research/data/appearance-probe-<label>.json，
//    随报告一起提交，保证对照数据可复核。
//
// 运行：node test/integration/runAppearanceProbe.mjs [--label=dark-custom|light-default]
// 报告：.vscode-test/appearance-probe-<label>.log
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { downloadAndUnzipVSCode } from '@vscode/test-electron'
import { buildTestHostArgs, cleanupTestDirs, createPortableShardHost, resolveTestHostMode, runTestHost } from './testHost.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const SAMPLES = {
  'sample.ts': [
    '// 探针样本：语法 + 语义双层（#335）',
    "import { join } from 'path';",
    '',
    'export interface ProbeSample {',
    '  readonly id: number;',
    '  label: string;',
    '}',
    '',
    "const greeting: string = `hello ${'world'}`;",
    '',
    'export function describe(sample: ProbeSample): string {',
    '  const count = sample.id + 1;',
    '  return `${sample.label}: ${count} (${greeting})`;',
    '}',
    '',
    'class ProbeRunner {',
    "  private status = 'idle';",
    '',
    '  run(): void {',
    "    this.status = 'running';",
    '  }',
    '}',
    '',
  ].join('\n'),
  'sample.py': [
    '# 探针样本：仅 grammar 语言（#335）',
    'import os',
    'from pathlib import Path',
    '',
    "CONSTANT = 'value'",
    '',
    'def describe(sample_id: int) -> str:',
    '    """docstring"""',
    '    count = sample_id * 2',
    '    return f"sample-{count}"',
    '',
    'class Runner:',
    "    status = 'idle'",
    '',
    '    def run(self):',
    "        self.status = 'running'",
    '',
  ].join('\n'),
  'sample.toml': [
    '# 探针样本：第三方 grammar（#335）',
    '[probe]',
    'title = "appearance probe"',
    'count = 42',
    'enabled = true',
    'tags = ["native", "textmate"]',
    '',
    '[runner]',
    "status = 'idle'",
    '',
  ].join('\n'),
  'plain.txt': [
    '这一行没有语法高亮（plaintext，#335 对照组）。',
    'this line has no grammar.',
    '',
  ].join('\n'),
}

/** 矩阵两轮：暗色 + 全量自定义 / 亮色纯默认 */
const PRESETS = {
  'dark-custom': {
    settings: {
      'workbench.colorTheme': 'Default Dark Modern',
      'editor.fontFamily': "Consolas, 'Courier New', monospace",
      'editor.fontSize': 14,
      'editor.fontLigatures': true,
      'editor.tokenColorCustomizations': {
        textMateRules: [
          // 宽泛规则：演示「主题更具体规则覆盖用户宽泛自定义」的原生同构行为
          // （keyword.control.import.ts 等仍由主题具体规则着色）
          { scope: 'keyword', settings: { foreground: '#FF7700' } },
          // 具体规则：主题无同级竞争规则，验证用户自定义 > 主题的覆盖序
          { scope: 'variable.other.readwrite.alias', settings: { foreground: '#FF00FF' } },
        ],
      },
      'editor.semanticTokenColorCustomizations': {
        rules: { variable: '#00FFAA' },
        '[Default Dark Modern]': { rules: { parameter: '#00C8FF' } },
      },
      '[typescript]': {
        'editor.fontFamily': "'Cascadia Code', Consolas, monospace",
        'editor.fontSize': 20,
      },
    },
  },
  'light-default': {
    settings: {
      'workbench.colorTheme': 'Default Light Modern',
    },
  },
}

// 第三方 grammar（受控样本）：be5invis.toml（TOML Language Support 0.6.0，
// marketplace 唯一 ID 为 be5invis.toml——注意不是 vscode-toml；engines
// VSCode 1.8.0+，纯 grammar/格式化贡献，与 1.82.3 兼容）
const THIRD_PARTY_GRAMMAR = 'be5invis.toml'

const labelFilter = process.argv.find((a) => a.startsWith('--label='))?.slice('--label='.length)
const labels = labelFilter ? [labelFilter] : Object.keys(PRESETS)

const executable = process.env.VSIDIAN_TEST_VSCODE_PATH || (await downloadAndUnzipVSCode({ version: '1.82.3' }))
const mode = resolveTestHostMode()
console.log(`[appearance-probe] 宿主 ${executable}（模式 ${mode}）；轮次：${labels.join(' → ')}`)

const wsDirs = []
const portableDirs = []
let failed = 0
try {
  for (const label of labels) {
    console.log(`[appearance-probe] ===== 轮次 ${label} =====`)
    const wsDir = mkdtempSync(path.join(tmpdir(), `vsidian-appearance-${label}-`))
    wsDirs.push(wsDir)
    for (const [file, content] of Object.entries(SAMPLES)) {
      writeFileSync(path.join(wsDir, file), content, 'utf8')
    }
    const portable = createPortableShardHost(path.join(root, '.vscode-test'), 1, { ...process.env })
    portableDirs.push(portable.portableDir)
    // 预置用户设置（便携目录的 user-data 在启动前可写）
    const userDir = path.join(portable.userDataDir, 'User')
    mkdirSync(userDir, { recursive: true })
    writeFileSync(path.join(userDir, 'settings.json'), JSON.stringify(PRESETS[label].settings, null, 2), 'utf8')
    console.log(`[appearance-probe] 预置设置：${path.join(userDir, 'settings.json')}`)
    // 第三方 grammar 预装（marketplace；网络失败时记录并继续——后续 languageId 硬断言会如实暴露）。
    // 注意：Windows 下直调 Code.exe --install-extension 会启动完整应用而非 CLI 模式
    // （首跑实证：无安装输出、宿主完整起退），必须走 bin/code.cmd 专用 CLI。
    const codeCli = path.join(path.dirname(executable), 'bin', process.platform === 'win32' ? 'code.cmd' : 'code')
    const installLog = path.join(root, '.vscode-test', `appearance-probe-install-${label}.log`)
    const cliCommand = process.platform === 'win32' ? 'cmd.exe' : codeCli
    const cliArgs = process.platform === 'win32'
      ? ['/c', codeCli, '--install-extension', THIRD_PARTY_GRAMMAR, '--extensions-dir', portable.extensionsDir, '--user-data-dir', portable.userDataDir, '--disable-workspace-trust']
      : ['--install-extension', THIRD_PARTY_GRAMMAR, '--extensions-dir', portable.extensionsDir, '--user-data-dir', portable.userDataDir, '--disable-workspace-trust']
    const install = spawnSync(cliCommand, cliArgs, { encoding: 'utf8', timeout: 180_000 })
    const installOutput = `exit=${install.status}\nstdout:\n${install.stdout ?? ''}\nstderr:\n${install.stderr ?? ''}`
    mkdirSync(path.dirname(installLog), { recursive: true })
    writeFileSync(installLog, installOutput, 'utf8')
    console.log(`[appearance-probe] 第三方 grammar 安装（${THIRD_PARTY_GRAMMAR}）退出码 ${install.status}，日志 ${installLog}`)
    if (install.status !== 0 || !/Successfully installed|already installed/i.test(install.stdout ?? '')) {
      console.warn(`[appearance-probe][WARN] 第三方 grammar 安装未确认成功，本轮 toml 格将按实际 languageId 如实记录`)
    }
    const evidencePath = path.join(root, 'docs', 'research', 'data', `appearance-probe-${label}.json`)
    mkdirSync(path.dirname(evidencePath), { recursive: true })
    const args = buildTestHostArgs({
      workspaceDir: wsDir,
      testsPath: path.join(root, 'out', 'test', 'integration', 'appearanceProbe', 'index.js'),
      extensionPath: root,
      extensionsDir: portable.extensionsDir,
      userDataDir: portable.userDataDir,
      // 关键差异：探针需要内置语言/主题扩展在场（常规回归禁用全部扩展）
      disableExtensions: false,
    })
    const code = await runTestHost({
      executable,
      args,
      mode,
      env: {
        ...portable.env,
        WORKSPACE_DIR: wsDir,
        VSIDIAN_PROBE_LABEL: label,
        VSIDIAN_PROBE_EVIDENCE: evidencePath,
        VSIDIAN_PROBE_ONIG_WASM: path.join(root, 'node_modules', 'vscode-oniguruma', 'release', 'onig.wasm'),
      },
      reportPath: path.join(root, '.vscode-test', `appearance-probe-${label}.log`),
    })
    console.log(`[appearance-probe] 轮次 ${label} 宿主退出码 ${code}（证据 ${evidencePath}）`)
    if (code !== 0) {
      failed++
    }
  }
  if (failed > 0) {
    throw new Error(`appearance probe ${failed}/${labels.length} 轮失败，详见 .vscode-test/appearance-probe-*.log`)
  }
  console.log('[appearance-probe] 全部轮次通过')
} finally {
  const wsCleanup = cleanupTestDirs(wsDirs, tmpdir())
  const portableCleanup = cleanupTestDirs(portableDirs, path.join(root, '.vscode-test'))
  for (const failure of [...wsCleanup, ...portableCleanup]) {
    console.error(`[appearance-probe] ${failure}`)
  }
}
