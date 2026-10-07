// 附加组件 API 契约门禁检查器 CLI（#363 T14）。
//
//   node scripts/checkAddonApiCompat.mjs                     # 全检查（候选=本仓库）
//   node scripts/checkAddonApiCompat.mjs --verify-baseline   # 从 git 对象复验基线
//                                                             # （CI 步骤序：先于全检查）
//   node scripts/checkAddonApiCompat.mjs --emit-baseline --anchor <ref>
//                                                             # 从 git 锚点发射基线
//       --mode release --api-version <semver>                 # 发行基线形态
//   node scripts/checkAddonApiCompat.mjs --root <候选树> --baseline <基线>
//        --json out/test/addon-api-compat-report.json        # 受保护来源形态
//
// 退出码：0 = 通过；1 = 存在失败（JSON 报告含全部失败明细，供 CI 必需检查
// 与发布前复验直接消费）。全程无网络请求。
//
// 基线发射（bootstrap 重锚定 / release 落账）是**有意识的显式动作**：发射
// 产物须随变更同 PR 提交并在 PR 描述独立说明理由（AGENTS「检查器/CI/基线
// 变更须独立列出理由与保护效果」）；--verify-baseline 从 git 对象复验，
// 候选分支改基线文件抹历史承诺会在契约检查之前即失败。
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { emitAddonApiBaseline, realGitAccess, runAddonApiCompatCheck, verifyAddonApiBaseline, BASELINE_PATH, DEFAULT_GUARD_MANIFEST, TOOL_ID } from './addonApiCompatCheck.mjs'

const SELF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function argValue(name) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const root = argValue('--root') ?? SELF_ROOT
  const baselinePath = argValue('--baseline') ?? BASELINE_PATH

  if (process.argv.includes('--emit-baseline')) {
    const anchorRef = argValue('--anchor')
    const mode = argValue('--mode') ?? 'bootstrap'
    const apiVersion = argValue('--api-version')
    const out = argValue('--out') ?? (mode === 'release' ? path.join(SELF_ROOT, 'test/addon-api', `baseline-api-${apiVersion}.json`) : BASELINE_PATH)
    // 已存在的基线文件复用其完整性清单（重锚定不丢手工维护的清单）
    let guardManifest = DEFAULT_GUARD_MANIFEST
    if (existsSync(out)) {
      try {
        const prev = JSON.parse(readFileSync(out, 'utf8'))
        if (prev.guardManifest?.requiredFiles?.length) guardManifest = prev.guardManifest
      } catch {
        // 既有文件不可解析时用兜底清单
      }
    }
    const baseline = await emitAddonApiBaseline({ gitAccess: realGitAccess(root), mode, anchorRef, apiVersion, guardManifest })
    writeFileSync(out, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8')
    console.log(`已发射基线：${path.relative(SELF_ROOT, out)}`)
    console.log(`  模式：${baseline.meta.mode}；锚点：${baseline.meta.anchor.kind} ${baseline.meta.anchor.sha.slice(0, 7)}（${baseline.meta.anchor.tag ?? baseline.meta.anchor.ref ?? ''}）`)
    console.log(`  条目 ${baseline.entries.length} 条 / 台账 ${baseline.releases.length} 条 / 签名模块 ${Object.keys(baseline.declarations).length} 个`)
    console.log('  发射是显式动作：产物须随变更同 PR 提交并独立说明理由（重锚定 / 首个发行落账）')
    return
  }

  if (process.argv.includes('--verify-baseline')) {
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
    const failures = await verifyAddonApiBaseline(baseline, realGitAccess(root))
    const anchor = baseline.meta?.anchor ?? {}
    console.log(`[verify-baseline] ${baseline.meta?.baselineVersion}（模式 ${baseline.meta?.mode}，锚点 ${anchor.kind} ${(anchor.tag ?? anchor.sha ?? '?').slice(0, 12)}）从 git 对象复验`)
    if (failures.length) {
      for (const f of failures) console.error(`FAIL [${f.code}] ${f.message}\n  证据：${f.evidence}`)
      process.exitCode = 1
      return
    }
    console.log(`基线与 git 锚定内容一致（条目 ${baseline.entries.length} / 台账 ${baseline.releases.length} / 声明模块 ${Object.keys(baseline.declarations ?? {}).length} 零差异）`)
    return
  }

  const reportPath = argValue('--json') ?? path.join(SELF_ROOT, 'out/test/addon-api-compat-report.json')
  const report = await runAddonApiCompatCheck({
    root,
    baselinePath,
    reportPath,
    ...(argValue('--now') ? { now: argValue('--now') } : {}),
  })

  for (const c of report.checks) {
    const icon = c.status === 'pass' ? 'ok' : c.status.toUpperCase()
    console.log(`[${icon}] ${c.id}${c.detail ? '：' + c.detail : ''}`)
  }
  if (report.failures.length) {
    console.error(`\n${report.failures.length} 项失败（基线 ${report.baseline.version}，模式 ${report.baseline.mode}）：`)
    for (const f of report.failures) {
      console.error(`\nFAIL [${f.code}] ${f.message}`)
      console.error(`  入口：${f.entry ?? '（非条目级）'}${f.target ? '（' + f.target + '）' : ''}`)
      console.error(`  历史来源：${f.source}`)
      console.error(`  证据：${f.evidence}`)
    }
    console.error(`\nJSON 报告：${reportPath}`)
    process.exitCode = 1
    return
  }
  console.log(`\n${TOOL_ID} 通过：基线 ${report.baseline.version}（${report.baseline.mode}，${String(report.baseline.anchor.sha ?? '').slice(0, 7)}）↔ 候选 ${report.candidate.apiVersion}，${report.checks.length} 项检查零失败。JSON 报告：${reportPath}`)
}

main().catch((err) => {
  console.error(`${TOOL_ID} 执行失败：`, err)
  process.exitCode = 1
})
