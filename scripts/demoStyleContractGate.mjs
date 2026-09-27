// #135 负向演示：故意破坏公开样式入口 → 门禁拦截 → 恢复通过。
//
// 工单 #135 标志性要求的可重复隔离验证：「通过一次故意破坏旧入口的测试
// PR 或等效隔离验证证明拦截，再恢复正常通过；不为演示合并破坏或发布测试
// 版本」。本脚本即「等效隔离验证」——在系统临时目录构造临时候选树施加
// 破坏，真实运行 scripts/checkStyleContract.mjs CLI（子进程 + 真实退出码，
// 与 CI job 同一入口），全程不触碰仓库工作树、不留破坏性提交。
//
//   场景 A（候选改实现）：删除公开入口清单条目 live-heading-line
//     → 全检查 exit 1，报告含 entry-missing
//   场景 B（候选改历史基线）：基线 sourceRows 被删一行
//     → --verify-baseline exit 1（CI job 的第一道防线在契约检查前拦截）
//   场景 C（恢复态）：真实仓库树原样全检查 → exit 0
//
// 证据写入 logs/style-contract-gate-demo-<日期>.md（含各场景命令、退出码、
// 失败码与 JSON 报告副本）；logs/ 不入 git（.gitignore），文档
// docs/specs/style-contract-gate.md 记录场景与判定标准，重跑本脚本即可复核。
//
// 破坏变换与临时候选树文件清单同源于 test/style-contract/checkStyleContract.test.mjs
// 的 buildSimTree/deleteEntry（#134 纯逻辑负向测试）——本脚本的差异是走
// 真实 CLI 退出码而非进程内函数调用，对应 CI job 的实际执行形态。
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_PATH = path.join(REPO_ROOT, 'test/style-contract/baseline-v0.4.0.json')
const CHECKER = path.join(REPO_ROOT, 'scripts/checkStyleContract.mjs')
const BASELINE = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))

/** 临时候选树文件清单：检查器消费的候选面（与 #134 测试 buildSimTree 同源） */
function simTreeFiles() {
  const extra = [
    'package.json',
    'CHANGELOG.md',
    'src/shared/chromeContract.ts',
    'src/webview/styleGuideData.ts',
    'media/style-reference/style-reference.html',
  ]
  return [...extra, ...BASELINE.guardManifest.requiredFiles.map((f) => f.path)]
}

function buildSimTree() {
  const sim = mkdtempSync(path.join(tmpdir(), 'vsidian-css135-demo-'))
  const seen = new Set()
  for (const rel of simTreeFiles()) {
    if (seen.has(rel)) continue
    seen.add(rel)
    const to = path.join(sim, rel)
    mkdirSync(path.dirname(to), { recursive: true })
    cpSync(path.join(REPO_ROOT, rel), to)
  }
  return sim
}

/** 删除清单条目对象整块（合法 TS：吞掉对象字面量与尾逗号行；与 #134 deleteEntry 同源） */
function deleteEntry(id) {
  const file = path.join(buildSimTree.last, 'src/shared/styleContract.ts')
  const lines = readFileSync(file, 'utf8').split('\n')
  const start = lines.findIndex((l) => l.includes(`id: '${id}'`))
  if (start < 0) throw new Error(`演示树应含条目 ${id}`)
  let objStart = start
  while (!lines[objStart].includes('{')) objStart--
  let objEnd = start
  let depth = 0
  for (let i = objStart; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') depth++
      else if (ch === '}') depth--
    }
    if (depth === 0) {
      objEnd = i
      break
    }
  }
  let removeEnd = objEnd
  while (removeEnd + 1 < lines.length && /^[),\s]*$/.test(lines[removeEnd + 1])) removeEnd++
  writeFileSync(file, lines.slice(0, objStart - 1 >= 0 ? objStart - 1 : objStart).concat(lines.slice(removeEnd + 1)).join('\n'))
}

/** 真实运行检查器 CLI，返回 { status, stdout, stderr } */
function runChecker(args) {
  const r = spawnSync(process.execPath, [CHECKER, ...args], { encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

const today = new Date().toISOString().slice(0, 10)
const evidencePath = path.join(REPO_ROOT, 'logs', `style-contract-gate-demo-${today}.md`)
mkdirSync(path.dirname(evidencePath), { recursive: true })
const evidence = [`# 历史契约门禁负向演示证据（#135）`, '', `生成：node scripts/demoStyleContractGate.mjs（${new Date().toISOString()}）`, '']

function record(scene, verdict, detail) {
  evidence.push(`## ${scene}`, '', `- 判定：**${verdict}**`, ...detail.map((l) => `- ${l}`), '')
}

let failed = false

// ---------------------------------------------------------------------------
// 场景 A：候选删除公开入口清单条目 → 全检查失败（entry-missing）
// ---------------------------------------------------------------------------
{
  const sim = buildSimTree()
  buildSimTree.last = sim
  deleteEntry('live-heading-line')
  // 受保护来源形态（与 CI job 一致）：--root 临时候选树 + --baseline 仓库基线
  // + --git-tags 注入固化数据（临时树无 .git，复刻「基线与脚本来源固定」）。
  // 元数据与报告一律放 sim 树内部的独立子目录——清理时只删 sim 自身，
  // 绝不触碰临时目录根（下同）。
  const meta = path.join(sim, '.demo-meta')
  mkdirSync(meta, { recursive: true })
  const tagsFile = path.join(meta, 'git-tags.json')
  writeFileSync(tagsFile, JSON.stringify(Object.fromEntries(Object.entries(BASELINE.releases).map(([v, r]) => [r.tag, r.sha]))))
  const reportFile = path.join(meta, 'report.json')
  const r = runChecker(['--root', sim, '--baseline', BASELINE_PATH, '--git-tags', tagsFile, '--json', reportFile])
  const report = JSON.parse(readFileSync(reportFile, 'utf8'))
  const codes = report.failures.map((f) => `${f.code}:${f.entry ?? ''}`)
  const hit = report.failures.some((f) => f.code === 'entry-missing' && f.entry === 'live-heading-line')
  const ok = r.status === 1 && hit
  if (!ok) failed = true
  cpSync(reportFile, path.join(REPO_ROOT, 'logs', `style-contract-demo-scenario-a-${today}.json`))
  record(
    '场景 A：删除公开入口 live-heading-line → 拦截',
    ok ? '符合预期（exit 1，entry-missing）' : '不符合预期',
    [
      `命令：\`node scripts/checkStyleContract.mjs --root <临时树> --baseline <仓库基线> --git-tags <固化tag数据> --json <报告>\``,
      `退出码：${r.status}（预期 1）`,
      `失败码：${codes.join('、') || '（无）'}`,
      `拦截断言：entry-missing:live-heading-line ${hit ? '命中' : '未命中'}`,
      `报告副本：logs/style-contract-demo-scenario-a-${today}.json`,
    ],
  )
  rmSync(sim, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// 场景 B：候选篡改历史基线（sourceRows 删一行）→ --verify-baseline 失败
// ---------------------------------------------------------------------------
{
  const dir = mkdtempSync(path.join(tmpdir(), 'vsidian-css135-demo-b-'))
  const tampered = JSON.parse(JSON.stringify(BASELINE))
  // 删第一条 sourceRow（.vsidian-view-live）：历史映射表仍有该行而基线缺失
  // → verifyBaselineRows 报 baseline-row-extra（丢项即丢保护）
  tampered.sourceRows = tampered.sourceRows.slice(1)
  const tamperedPath = path.join(dir, 'baseline-tampered.json')
  writeFileSync(tamperedPath, JSON.stringify(tampered, null, 2))
  const r = runChecker(['--verify-baseline', '--baseline', tamperedPath])
  const ok = r.status === 1 && r.stderr.includes('baseline-row-extra')
  if (!ok) failed = true
  record(
    '场景 B：篡改历史基线（sourceRows 删一行）→ verify-baseline 拦截',
    ok ? '符合预期（exit 1，baseline-row-extra）' : '不符合预期',
    [
      `命令：\`node scripts/checkStyleContract.mjs --verify-baseline --baseline <被改基线>\``,
      `退出码：${r.status}（预期 1）`,
      `stderr 摘要：${r.stderr.split('\n').filter((l) => l.includes('FAIL')).slice(0, 2).join(' | ') || '（无 FAIL 行）'}`,
      `防线说明：CI job（ci.yml style-contract）把本复验排在契约检查之前——先证检查器可信，再信检查结果`,
    ],
  )
  rmSync(dir, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// 场景 C：恢复态（真实仓库树原样）→ 全检查通过
// ---------------------------------------------------------------------------
{
  const reportFile = path.join(REPO_ROOT, 'out', 'test', `style-contract-demo-scenario-c-${today}.json`)
  const r = runChecker(['--json', reportFile])
  const ok = r.status === 0
  if (!ok) failed = true
  record(
    '场景 C：恢复态（真实仓库树原样）→ 通过',
    ok ? '符合预期（exit 0）' : '不符合预期',
    [
      `命令：\`node scripts/checkStyleContract.mjs\`（候选=本仓库）`,
      `退出码：${r.status}（预期 0）`,
      `stdout 末行：${r.stdout.trim().split('\n').pop()}`,
      `说明：场景 A/B 的破坏均在临时目录施加，仓库工作树未被触碰；删除 git 未提交内容亦无从谈起（无破坏性提交）`,
    ],
  )
}

evidence.push('---', '', '重跑方式：`node scripts/demoStyleContractGate.mjs`（退出码 0 = 三场景全部符合预期）。', '机制与边界说明见 docs/specs/style-contract-gate.md。', '')
writeFileSync(evidencePath, evidence.join('\n'), 'utf8')

console.log(evidence.join('\n'))
console.log(`\n证据已写入：${evidencePath}`)
if (failed) {
  console.error('存在不符合预期的场景')
  process.exitCode = 1
} else {
  console.log('三场景全部符合预期（拦截 → 拦截 → 恢复通过）')
}
