// 历史 CSS 契约兼容检查器 CLI（#134）。
//
//   node scripts/checkStyleContract.mjs                 # 全检查（本仓库=候选）
//   node scripts/checkStyleContract.mjs --verify-baseline  # 从 git 对象复验基线
//   node scripts/checkStyleContract.mjs --json out/test/style-contract-report.json
//   node scripts/checkStyleContract.mjs --root <候选树> --baseline <受保护基线>
//                                                       # #135 CI 受保护来源形态
//   node scripts/checkStyleContract.mjs --git-tags tags.json
//                                                       # git 不可用（CI 缓存）时注入
//
// 退出码：0 = 通过；1 = 存在失败（JSON 报告含全部失败明细，供 CI 必需检查与
// 发布前复验直接消费）。全程无网络请求。
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSelectorMapRows, runStyleContractCheck, verifyBaselineRows, TOOL_ID } from './styleContractCheck.mjs'

const SELF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function argValue(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const baselinePath = argValue('--baseline') ?? path.join(SELF_ROOT, 'test/style-contract/baseline-v0.4.0.json')
  const root = argValue('--root') ?? SELF_ROOT

  if (process.argv.includes('--verify-baseline')) {
    // 基线 git 锚定复验：从固定 SHA 的映射表对象重新解析并与基线 sourceRows
    // 做精确集合比对（候选分支改基线文件即在此暴露）
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
    const mapMd = execFileSync('git', ['show', `${baseline.meta.sourceSha}:docs/design/obsidian-selector-map.md`], {
      cwd: SELF_ROOT,
      encoding: 'utf8',
    })
    const rows = parseSelectorMapRows(mapMd)
    const failures = verifyBaselineRows(baseline, rows)
    console.log(`[verify-baseline] ${baseline.meta.sourceTag} (${baseline.meta.sourceSha.slice(0, 7)}) 映射表 ${rows.length} 行 vs 基线 sourceRows ${baseline.sourceRows.length} 行`)
    if (failures.length) {
      for (const f of failures) console.error(`FAIL [${f.code}] ${f.message}\n  证据：${f.evidence}`)
      process.exitCode = 1
      return
    }
    console.log('基线与 git 锚定内容一致（sourceRow 集合零差异）')
    return
  }

  let gitTagData
  const gitTagsPath = argValue('--git-tags')
  if (gitTagsPath) gitTagData = JSON.parse(readFileSync(gitTagsPath, 'utf8'))

  const reportPath = argValue('--json') ?? path.join(SELF_ROOT, 'out/test/style-contract-report.json')
  const report = await runStyleContractCheck({ root, baselinePath, gitTagData, reportPath })

  for (const c of report.checks) {
    const icon = c.status === 'pass' ? 'ok' : c.status.toUpperCase()
    console.log(`[${icon}] ${c.id}${c.detail ? '：' + c.detail : ''}`)
  }
  for (const w of report.warnings) console.warn(`[WARN] ${w}`)
  if (report.failures.length) {
    console.error(`\n${report.failures.length} 项失败（基线 ${report.baseline.version} / 候选 v${report.candidate.version}）：`)
    for (const f of report.failures) {
      console.error(`\nFAIL [${f.code}] ${f.message}`)
      console.error(`  入口：${f.entry ?? '（非条目级）'}${f.target ? '（' + f.target + '）' : ''}`)
      console.error(`  历史来源：${f.source}`)
      console.error(`  候选版本：v${f.candidateVersion}`)
      console.error(`  证据：${f.evidence}`)
    }
    console.error(`\nJSON 报告：${reportPath}`)
    process.exitCode = 1
    return
  }
  console.log(`\n${TOOL_ID} 通过：基线 ${report.baseline.version}（${report.baseline.sourceSha.slice(0, 7)}）↔ 候选 v${report.candidate.version}，${report.checks.length} 项检查零失败。JSON 报告：${reportPath}`)
}

main().catch((err) => {
  console.error(`${TOOL_ID} 执行失败：`, err)
  process.exitCode = 1
})
