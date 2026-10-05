// #340（P3-08）真宿主高亮对照启动器：复用 test/integration/testHost.mjs
// 框架（1.82.3 便携宿主、独立用户数据/扩展目录、报告与退出码落盘），驱动
// 生产 TextAppearanceService 的语法层颜色对照（探针 #335 锚点值）。与常规
// 集成回归的差异：不传 --disable-extensions（内置语言/主题扩展在场）；
// 预置 Default Dark Modern 主题（与探针对照矩阵同主题）。单轮——明暗两
// 主题的矩阵覆盖由探针完成，本套件锚定生产链路与探针同色。
//
// 运行：node test/integration/runTextAppearance.mjs
// 报告：.vscode-test/text-appearance.log
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { downloadAndUnzipVSCode } from '@vscode/test-electron'
import { buildTestHostArgs, cleanupTestDirs, createPortableShardHost, resolveTestHostMode, runTestHost } from './testHost.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const executable = process.env.VSIDIAN_TEST_VSCODE_PATH || (await downloadAndUnzipVSCode({ version: '1.82.3' }))
const mode = resolveTestHostMode()
console.log(`[text-appearance] 宿主 ${executable}（模式 ${mode}）`)

const wsDir = mkdtempSync(path.join(tmpdir(), 'vsidian-text-appearance-'))
const portable = createPortableShardHost(path.join(root, '.vscode-test'), 1, { ...process.env })
try {
  // 预置主题（探针对照矩阵同主题；无任何自定义——颜色即主题原生值）
  const userDir = path.join(portable.userDataDir, 'User')
  mkdirSync(userDir, { recursive: true })
  writeFileSync(path.join(userDir, 'settings.json'), JSON.stringify({
    'workbench.colorTheme': 'Default Dark Modern',
  }, null, 2), 'utf8')

  const args = buildTestHostArgs({
    workspaceDir: wsDir,
    testsPath: path.join(root, 'out', 'test', 'integration', 'textAppearance', 'suite.js'),
    extensionPath: root,
    extensionsDir: portable.extensionsDir,
    userDataDir: portable.userDataDir,
    // 内置语言/主题扩展必须在场（语法层 grammar 与主题文件来源）
    disableExtensions: false,
  })
  const code = await runTestHost({
    executable,
    args,
    mode,
    env: { ...portable.env, WORKSPACE_DIR: wsDir },
    reportPath: path.join(root, '.vscode-test', 'text-appearance.log'),
  })
  console.log(`[text-appearance] 宿主退出码 ${code}（报告 .vscode-test/text-appearance.log）`)
  if (code !== 0) {
    throw new Error('text appearance 对照失败，详见 .vscode-test/text-appearance.log')
  }
  console.log('[text-appearance] 通过')
} finally {
  const wsCleanup = cleanupTestDirs([wsDir], tmpdir())
  const portableCleanup = cleanupTestDirs([portable.portableDir], path.join(root, '.vscode-test'))
  for (const failure of [...wsCleanup, ...portableCleanup]) {
    console.error('[text-appearance] ' + failure)
  }
}
