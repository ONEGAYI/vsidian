// 集成测试启动器：生成临时 fixture 工作区，下载并启动 VSCode 1.86.2，
// 以 extensionDevelopmentPath 模式加载扩展后运行 out/test/integration/suite。
// fixture 内容见 fixtures.mjs（与 runInstalled.mjs 安装态回归共用同一套）。
//
// VSIDIAN_ITEST_SHARDS=N（N>=2）时并行起 N 个宿主。每片注入
// VSIDIAN_TEST_SHARD=k/N，并以独立便携目录隔离用户数据、扩展与主进程 IPC。
// 缺省 N=1 保持原有单宿主行为与 integration-dev.log 报告名。
import { downloadAndUnzipVSCode } from '@vscode/test-electron'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generatePerfSample, generateReadingSample, generateMermaidDenseSample } from '../perf/gen-sample.mjs'
import { writeFixtures, LARGE_DOC_LINES } from './fixtures.mjs'
import { buildTestHostArgs, cleanupTestDirs, createPortableShardHost, resolveTestHostMode, runTestHost, writeTestWorkspaceFile } from './testHost.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const shardTotal = Number(process.env.VSIDIAN_ITEST_SHARDS ?? '1')
if (!Number.isInteger(shardTotal) || shardTotal < 1) {
  console.error(`[runTest] VSIDIAN_ITEST_SHARDS 须为 >=1 整数，收到 ${JSON.stringify(process.env.VSIDIAN_ITEST_SHARDS)}`)
  process.exit(1)
}
const sharded = shardTotal > 1
if (sharded) {
  console.log(`[runTest] 分片并行：${shardTotal} 个宿主同时起跑（每片独立 fixture/存储/报告）`)
}

const executable = await downloadAndUnzipVSCode({ version: '1.86.2' })
const mode = resolveTestHostMode()
console.log(`[runTest] 测试宿主模式：${mode}；宿主 ${executable}`)
if (process.env.VSIDIAN_TEST_CASES) {
  console.log(`[runTest] 用例筛选：${JSON.stringify(process.env.VSIDIAN_TEST_CASES)}`)
}

const wsDirs = []
const wsFiles = []
const portableDirs = []
const testCacheDir = path.join(root, '.vscode-test')
const started = Date.now()
try {
  // 所有宿主结束后再清理便携目录；若一片启动异常，也不能清理仍在运行的其他片。
  const results = await Promise.allSettled(
    Array.from({ length: shardTotal }, async (_, i) => {
      const shard = i + 1
      const wsDir = mkdtempSync(path.join(tmpdir(), `vsidian-itest-s${shard}-`))
      wsDirs.push(wsDir)
      writeFixtures(wsDir, { generatePerfSample, generateReadingSample, generateMermaidDenseSample })
      // 以单 folder 的 .code-workspace 启动（multi-root 形态起步）：1.86.2 上
      // 目录（single-folder）启动时 updateWorkspaceFolders 增根触发 window
      // reload（ext host 退出、suite 中断，#198 用例确定性复现）；multi-root
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
          ...(sharded ? { VSIDIAN_TEST_SHARD: `${shard}/${shardTotal}` } : {}),
        },
        reportPath: path.join(testCacheDir, sharded ? `integration-dev-s${shard}.log` : 'integration-dev.log'),
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
    // 退出码非零时以报告为准：Linux 宿主收尾存在「全部用例 PASS 后退
    // 出码 1」的退出竞速噪声（Extension host Canceled 特征，CI 五轮确
    // 定性复现且与用例成败无关；本地 Windows 不复现）——报告内 FAIL
    // 行数为零且计划用例已全部执行时放行该噪声，非零照常判败（不掩盖
    // 真实失败）。执行计数核对（2026-10 批次加固）：此前只数 FAIL 行，
    // 放行过「宿主中途截断」形态（少跑用例、零 FAIL、退出码 1，实测
    // 计划 59 项只执行 53 项被静默放行）——#211 噪声边界是「全部用例
    // PASS 后」的收尾竞速，未跑完的计划项不属于该边界，须照常判败
    const report = path.join(testCacheDir, sharded ? `integration-dev-s${i + 1}.log` : 'integration-dev.log')
    try {
      const lines = readFileSync(report, 'utf8').split('\n')
      const failCount = lines.filter((line) => line.includes('[集成测试][FAIL]')).length
      const doneCount = lines.filter((line) => line.includes('[集成测试][TIME]')).length
      const planMatch = /\[集成测试\] 执行 (\d+)\/\d+ 项/
        .exec(lines.find((line) => line.includes('[集成测试] 执行')) ?? '')
      const planned = planMatch ? Number(planMatch[1]) : 0
      if (failCount === 0 && planned > 0 && doneCount >= planned) {
        console.warn(`[runTest] 片 ${i + 1} 宿主退出码 ${result.value} 但报告零失败且 ${doneCount}/${planned} 项全部执行（收尾退出噪声放行，详见 ${report}）`)
        return []
      }
    } catch {
      // 报告不可读：维持退出码判定
    }
    return [`${i + 1}: 退出码 ${result.value}`]
  })
  if (failures.length > 0) {
    throw new Error(`集成回归有 ${failures.length}/${shardTotal} 片失败（${failures.join('；')}），详见 .vscode-test/integration-dev*.log`)
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
