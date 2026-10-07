// 集成测试启动器：生成临时 fixture 工作区，下载并启动 VSCode 1.82.3
// （#255 起验证矩阵钉在 engines 承诺下界），
// 以 extensionDevelopmentPath 模式加载扩展后运行 out/test/integration/suite。
// fixture 内容见 fixtures.mjs（与 runInstalled.mjs 安装态回归共用同一套）。
//
// VSIDIAN_ITEST_SHARDS=N（N>=2）时并行起 N 个宿主。每片注入
// VSIDIAN_TEST_SHARD=k/N，并以独立便携目录隔离用户数据、扩展与主进程 IPC。
// 缺省 N=1 保持原有单宿主行为与 integration-dev.log 报告名。
// VSIDIAN_TEST_GROUP=all/core/sensitive：缺省全量；敏感组报告单独命名。
import { downloadAndUnzipVSCode } from '@vscode/test-electron'
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generatePerfSample, generateReadingSample, generateMermaidDenseSample } from '../perf/gen-sample.mjs'
import { writeFixtures, LARGE_DOC_LINES } from './fixtures.mjs'
import { buildTestAddons } from '../fixtures/addon-v02/sdk/buildAddon.mjs'
import { buildTestHostArgs, cleanupTestDirs, createPortableShardHost, evaluateHostReport, resolveTestHostMode, runTestHost, writeTestWorkspaceFile } from './testHost.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const group = process.env.VSIDIAN_TEST_GROUP || 'all'
if (!['all', 'core', 'sensitive'].includes(group)) {
  console.error(`[runTest] VSIDIAN_TEST_GROUP 须为 all/core/sensitive，收到 ${JSON.stringify(process.env.VSIDIAN_TEST_GROUP)}`)
  process.exit(1)
}

const shardTotal = Number(process.env.VSIDIAN_ITEST_SHARDS ?? '1')
if (!Number.isInteger(shardTotal) || shardTotal < 1) {
  console.error(`[runTest] VSIDIAN_ITEST_SHARDS 须为 >=1 整数，收到 ${JSON.stringify(process.env.VSIDIAN_ITEST_SHARDS)}`)
  process.exit(1)
}
const sharded = shardTotal > 1
const reportName = (shard) => group === 'sensitive'
  ? (sharded ? `integration-sensitive-s${shard}.log` : 'integration-sensitive.log')
  : (sharded ? `integration-dev-s${shard}.log` : 'integration-dev.log')
if (sharded) {
  console.log(`[runTest] 分片并行：${shardTotal} 个宿主同时起跑（每片独立 fixture/存储/报告）`)
}

// VSIDIAN_TEST_VSCODE_PATH：指向已解压宿主可执行文件（如 1.82.3 下界
// 验证）时跳过默认宿主下载直接使用——#254 分段验证路径 / #255 下界
// 反复实测的通道；dev path 模式同样执行 engines 安装门槛（实测 1.82.3
// 宿主上 engines ^1.86.0 时扩展不激活、_test.* 命令全 not found）——
// 用本通道探测**低于已提交 engines 下界**的更早宿主时，验证树须临时降
// package.json 的 engines（仅验证用，不进提交）；默认路径宿主与 engines
// 同版，无需任何降版
const overrideExecutable = process.env.VSIDIAN_TEST_VSCODE_PATH
const executable = overrideExecutable || await downloadAndUnzipVSCode({ version: '1.82.3' })
const mode = resolveTestHostMode()
console.log(`[runTest] 测试宿主模式：${mode}；宿主 ${executable}`)
console.log(`[runTest] 分组：${group}`)
if (process.env.VSIDIAN_TEST_CASES) {
  console.log(`[runTest] 用例筛选：${JSON.stringify(process.env.VSIDIAN_TEST_CASES)}`)
}

const wsDirs = []
const wsFiles = []
const portableDirs = []
const testCacheDir = path.join(root, '.vscode-test')
// #350 T01 附加组件夹具（清单与实现见 test/integration/addonFixtures/）：
// 兼容注册（addon-ok）、声明合法但不兼容（addon-incompatible）、激活失败
// （addon-fail）；#351 T02 页面 SDK 夹具（addon-t02——页面产物由 V02
// 构建桥生成后拷入其 dist/，构建产物不入库）；#353 T04 复杂设置夹具
//（addon-t04——纯宿主 CJS，无页面产物；经公开 API 注册复杂定义与分层读写）
const ADDON_FIXTURE_PATHS = ['addon-ok', 'addon-incompatible', 'addon-fail', 'addon-t02', 'addon-t04'].map((name) =>
  path.join(root, 'test', 'integration', 'addonFixtures', name))

// #351 T02：夹具组件页面产物构建（chrome114 IIFE + 静态红线——CM6 不
// 重打包）；产物拷入 addon-t02/dist 供组件按相对入口登记（资源授权锚 =
// 夹具安装目录）
const t02Layout = (await buildTestAddons({ log: () => {} })).t02Addon
cpSync(t02Layout.distDir, path.join(root, 'test', 'integration', 'addonFixtures', 'addon-t02', 'dist'), { recursive: true })
console.log('[runTest] T02 夹具组件页面产物已构建并拷入 addonFixtures/addon-t02/dist')
const started = Date.now()
try {
  // 所有宿主结束后再清理便携目录；若一片启动异常，也不能清理仍在运行的其他片。
  const results = await Promise.allSettled(
    Array.from({ length: shardTotal }, async (_, i) => {
      const shard = i + 1
      const wsDir = mkdtempSync(path.join(tmpdir(), `vsidian-itest-s${shard}-`))
      wsDirs.push(wsDir)
      await writeFixtures(wsDir, { generatePerfSample, generateReadingSample, generateMermaidDenseSample })
      // 以单 folder 的 .code-workspace 启动（multi-root 形态起步）：1.86.2 上
      // 目录（single-folder）启动时 updateWorkspaceFolders 增根触发 window
      // reload（ext host 退出、suite 中断，#198 用例确定性复现；1.82.3 下界
      // 矩阵沿用同型装配，未另测目录形态）；multi-root
      // 形态下根增删是纯 folders 更新
      const wsFile = writeTestWorkspaceFile(wsDir)
      wsFiles.push(wsFile)
      // 每次运行一律独立便携目录（#198 教训：非分片模式共享 user-data 会把
      // 「工作区根增删」用例留下的多根窗口状态泄漏给后续运行——失效根被
      // 恢复、宿主多开、fixture 交叉污染；隔离的便携目录随 finally 清理）
      const portable = createPortableShardHost(testCacheDir, shard)
      portableDirs.push(portable.portableDir)
      const args = buildTestHostArgs({
        workspaceDir: wsFile,
        testsPath: path.join(root, 'out', 'test', 'integration', 'suite', 'index.js'),
        extensionPath: root,
        extensionsDir: portable.extensionsDir,
        userDataDir: portable.userDataDir,
        disableExtensions: true,
        // #350 T01 附加组件夹具：以附加 development path 装载——与被测扩
        // 展同宿主，供集成用例断言发现、兼容检查、唤醒与状态呈现
        extraExtensionPaths: ADDON_FIXTURE_PATHS,
      })
      // CI 的 xvfb 虚拟显示无 GPU，Electron GPU 进程反复崩溃会拖垮 webview 面板
      if (process.env.CI) {
        args.push('--disable-gpu')
      }
      const code = await runTestHost({
        executable,
        args,
        mode,
        env: {
          ...(portable?.env ?? process.env),
          WORKSPACE_DIR: wsDir,
          LARGE_DOC_LINES: String(LARGE_DOC_LINES),
          // C-11：开启 _test.* 测试钩子命令（生产/常规开发不注册）
          VSIDIAN_TEST_HOOKS: '1',
          VSIDIAN_TEST_GROUP: group,
          ...(sharded ? { VSIDIAN_TEST_SHARD: `${shard}/${shardTotal}` } : {}),
        },
        reportPath: path.join(testCacheDir, reportName(shard)),
      })
      console.log(`[runTest] 分片 ${shard}/${shardTotal} 宿主退出码 ${code}（耗时 ${((Date.now() - started) / 1000).toFixed(1)}s）`)
      return code
    }),
  )
  const failures = results.flatMap((result, i) => {
    if (result.status === 'rejected') {
      return [`${i + 1}: 启动异常 ${String(result.reason)}`]
    }
    if (result.value === 0) {
      return []
    }
    // 退出码非零时以报告为准（evaluateHostReport，#254 抽出为可测纯函数）：
    // Linux 宿主收尾存在「全部用例 PASS 后退出码 1」的退出竞速噪声
    // （Extension host Canceled 特征，CI 五轮确定性复现且与用例成败无关；
    // 本地 Windows 不复现）——报告零 FAIL 且计划用例全部取得终态时放行该
    // 噪声。宿主中途截断（零 FAIL 但计划项未跑完，此前实测 59 项只执行
    // 53 项被静默放行）不属于 #211 边界：判败并点名缺失用例身份
    const report = path.join(testCacheDir, reportName(i + 1))
    try {
      const verdict = evaluateHostReport(readFileSync(report, 'utf8').split('\n'), result.value)
      if (verdict.ok) {
        console.warn(`[runTest] 片 ${i + 1} 宿主退出码 ${result.value} 但${verdict.reason}（详见 ${report}）`)
        return []
      }
      return [`${i + 1}: ${verdict.reason}`]
    } catch {
      // 报告不可读：维持退出码判定
    }
    return [`${i + 1}: 退出码 ${result.value}`]
  })
  if (failures.length > 0) {
    throw new Error(`集成回归 ${group} 组有 ${failures.length}/${shardTotal} 片失败（${failures.join('；')}），详见 .vscode-test/integration-*.log`)
  }
} catch (err) {
  console.error('[runTest] 运行失败', err)
  process.exitCode = 1
} finally {
  // workspace 文件随工作区目录一并清理（兄弟文件，cleanupTestDirs 只收目录）
  for (const wsFile of wsFiles) {
    try {
      rmSync(wsFile, { force: true })
    } catch {
      // 与目录清理同口径：失败不中断，仅留痕
      console.error(`[runTest] 清理 ${wsFile} 失败`)
    }
  }
  const cleanupFailures = [
    ...cleanupTestDirs(wsDirs, tmpdir()),
    ...cleanupTestDirs(portableDirs, testCacheDir),
  ]
  if (cleanupFailures.length > 0) {
    for (const failure of cleanupFailures) console.error(`[runTest] ${failure}`)
    process.exitCode = 1
  }
}
