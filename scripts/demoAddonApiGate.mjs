// #363 T14 负向演示：故意破坏附加组件公开 API 面 → 门禁拦截 → 恢复通过。
//
// 票面标志性要求的可重复隔离验证（demoStyleContractGate 同型）：在系统临时
// 目录构造临时候选树 / 隔离 git fixture 施加破坏，真实运行
// scripts/checkAddonApiCompat.mjs CLI（子进程 + 真实退出码，与 CI job 同一
// 入口），全程不触碰仓库工作树、不留破坏性提交。
//
//   场景 A（删除接口）：清单删条目 → 全检查 exit 1，entry-missing
//   场景 B（收窄参数/结果）：签名声明文本改写 → exit 1，signature-declaration-changed
//   场景 C（改变只读/目标或故障语义）：目标与语义文本改写 → exit 1，
//          purpose-changed + semantics-text-changed
//   场景 D（篡改基线）：基线条目字段被改 → --verify-baseline exit 1（CI 的
//          第一道防线，排在契约检查之前）
//   场景 E（遗漏指南）：删开发指南 → exit 1，guard-file-missing
//   场景 F（提前移除）：台账写入未满双门槛的移除 + 条目删除 → exit 1，
//          removal-too-early + removal-minor-span-insufficient + entry-missing
//   场景 G（两条基线路径的隔离 git fixture 证据）：bootstrap（提交锚点发射
//          → 复验通过）与 release（fixture/ 前缀 tag 锚点发行基线 → 复验
//          通过；基线被改 → exit 1）——测试标签不冒充真实 SDK 发行
//   场景 H（恢复态）：真实仓库树原样全检查 → exit 0
//
// 证据写入 logs/addon-api-gate-demo-<日期>.md（各场景命令、退出码、失败码
// 与报告副本；logs/ 不入 git，.gitignore 排除），文档
// docs/specs/addons-api-gate.md 记录场景与判定标准，重跑本脚本即可复核。
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_PATH = path.join(REPO_ROOT, 'test/addon-api/baseline-bootstrap-1.json')
const CHECKER = path.join(REPO_ROOT, 'scripts/checkAddonApiCompat.mjs')
const BASELINE = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))

/** 临时候选树文件清单：检查器消费的候选面（与契约测试 simTreeFiles 同源） */
function simTreeFiles() {
  const files = new Set(['package.json', 'docs/addons/api-reference.md'])
  for (const f of BASELINE.guardManifest.requiredFiles) files.add(f.path)
  for (const m of Object.keys(BASELINE.declarations)) files.add(m)
  for (const e of BASELINE.entries) for (const v of e.verification) files.add(v)
  return [...files]
}

function buildSimTree() {
  const sim = mkdtempSync(path.join(tmpdir(), 'vsidian-t14-demo-'))
  for (const rel of simTreeFiles()) {
    const to = path.join(sim, rel)
    mkdirSync(path.dirname(to), { recursive: true })
    cpSync(path.join(REPO_ROOT, rel), to)
  }
  return sim
}

/** sim 树文本读写（归一 CRLF——磁盘 Windows 检出为 CRLF，基线字节为 LF） */
function readSim(sim, rel) {
  return readFileSync(path.join(sim, rel), 'utf8').replace(/\r\n/g, '\n')
}

function writeSim(sim, rel, text) {
  writeFileSync(path.join(sim, rel), text, 'utf8')
}

/** 删除清单条目对象整块（括号配平；条目间独立注释行保留，语法不破坏） */
function deleteCatalogEntry(sim, id) {
  const file = path.join(sim, 'src/shared/addonApiCatalog.ts')
  const lines = readFileSync(file, 'utf8').split('\n')
  const start = lines.findIndex((l) => l.includes(`id: '${id}'`))
  if (start < 0) throw new Error(`演示树应含条目 ${id}`)
  let objStart = start
  while (!lines[objStart].includes('{')) objStart--
  let depth = 0
  let objEnd = objStart
  for (let i = objStart; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') depth++
      else if (ch === '}') depth--
    }
    if (depth === 0 && i > objStart) {
      objEnd = i
      break
    }
  }
  let removeEnd = objEnd
  while (removeEnd + 1 < lines.length && /^[),\s]*$/.test(lines[removeEnd + 1])) removeEnd++
  writeFileSync(file, [...lines.slice(0, objStart), ...lines.slice(removeEnd + 1)].join('\n'))
}

/** 台账整体替换（场景 F：写入未满双门槛的提前移除记录） */
function rewriteReleases(sim, recordsLiteral) {
  const text = readSim(sim, 'src/shared/addonApiCatalog.ts')
  const marker = 'export const ADDON_API_RELEASES: readonly AddonApiReleaseRecord[] = ['
  const at = text.indexOf(marker)
  if (at < 0) throw new Error('演示树应含发行台账')
  writeSim(sim, 'src/shared/addonApiCatalog.ts', `${text.slice(0, at)}${marker}\n${recordsLiteral}\n]\n`)
}

/** 真实运行检查器 CLI，返回 { status, stdout, stderr } */
function runChecker(args) {
  const r = spawnSync(process.execPath, [CHECKER, ...args], { encoding: 'utf8' })
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

/** 全检查（受保护来源形态：--root 临时树 + --baseline 仓库基线；报告放临时树内部） */
function runFullCheck(sim) {
  const meta = path.join(sim, '.demo-meta')
  mkdirSync(meta, { recursive: true })
  const reportFile = path.join(meta, 'report.json')
  const r = runChecker(['--root', sim, '--baseline', BASELINE_PATH, '--json', reportFile])
  let report = null
  try {
    report = JSON.parse(readFileSync(reportFile, 'utf8'))
  } catch {
    report = null
  }
  return { r, report, reportFile }
}

const today = new Date().toISOString().slice(0, 10)
mkdirSync(path.join(REPO_ROOT, 'logs'), { recursive: true })
const evidencePath = path.join(REPO_ROOT, 'logs', `addon-api-gate-demo-${today}.md`)
const evidence = ['# 附加组件 API 契约门禁负向演示证据（#363 T14）', '', `生成：node scripts/demoAddonApiGate.mjs（${new Date().toISOString()}）`, '']
let reportSeq = 0

function record(scene, verdict, detail) {
  evidence.push(`## ${scene}`, '', `- 判定：**${verdict}**`, ...detail.map((l) => `- ${l}`), '')
}

function saveReport(reportFile, sceneKey) {
  reportSeq += 1
  const to = path.join(REPO_ROOT, 'logs', `addon-api-demo-${sceneKey}-${today}.json`)
  cpSync(reportFile, to)
  return path.relative(REPO_ROOT, to)
}

let failed = false
function expectRejection(scene, { r, report, reportFile }, wantedCodes, cmdDesc, sceneKey) {
  const codes = (report?.failures ?? []).map((f) => f.code)
  const hit = wantedCodes.every((c) => codes.includes(c))
  const ok = r.status === 1 && hit
  if (!ok) failed = true
  const details = [
    `命令：\`${cmdDesc}\``,
    `退出码：${r.status}（预期 1）`,
    `失败码：${codes.join('、') || '（无报告或无失败）'}`,
    ...wantedCodes.map((c) => `拦截断言：${c} ${codes.includes(c) ? '命中' : '未命中'}`),
  ]
  if (ok && report && reportFile) details.push(`报告副本：${saveReport(reportFile, sceneKey)}`)
  record(scene, ok ? `符合预期（exit 1，${wantedCodes.join('、')}）` : '不符合预期', details)
}

// ---------------------------------------------------------------------------
// 场景 A：删除接口（清单删条目）
// ---------------------------------------------------------------------------
{
  const sim = buildSimTree()
  deleteCatalogEntry(sim, 'manifest-declaration')
  const out = runFullCheck(sim)
  expectRejection('场景 A：删除接口 manifest-declaration → 拦截', out, ['entry-missing'], 'node scripts/checkAddonApiCompat.mjs --root <临时树> --baseline <仓库基线> --json <报告>', 'a')
  rmSync(sim, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// 场景 B：收窄参数/结果（签名声明文本改写）
// ---------------------------------------------------------------------------
{
  const sim = buildSimTree()
  const module = 'src/shared/addonIdentity.ts'
  const text = readSim(sim, module)
  const decl = BASELINE.declarations[module]['ADDON_IDENTITY_MANIFEST_VERSION']
  writeSim(sim, module, text.replace(decl, decl.replace('= 1', '= 2')))
  const out = runFullCheck(sim)
  expectRejection('场景 B：收窄签名声明（ADDON_IDENTITY_MANIFEST_VERSION = 1 → 2）→ 拦截', out, ['signature-declaration-changed'], 'node scripts/checkAddonApiCompat.mjs --root <临时树> --baseline <仓库基线> --json <报告>', 'b')
  rmSync(sim, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// 场景 C：改变只读/目标或故障语义（目标 + 语义文本改写）
// ---------------------------------------------------------------------------
{
  const sim = buildSimTree()
  const purposeEntry = BASELINE.entries.find((e) => e.id === 'manifest-declaration')
  const modesEntry = BASELINE.entries.find((e) => e.id === 'views-editor')
  let text = readSim(sim, 'src/shared/addonApiCatalog.ts')
  text = text.replace(purposeEntry.purpose, `${purposeEntry.purpose}（收窄：不再保留状态）`)
  text = text.replace(modesEntry.semantics.modes, `${modesEntry.semantics.modes}（收窄：hover 也可写）`)
  writeSim(sim, 'src/shared/addonApiCatalog.ts', text)
  const out = runFullCheck(sim)
  expectRejection('场景 C：改写目标与语义文本（只读/故障语义收窄）→ 拦截', out, ['purpose-changed', 'semantics-text-changed'], 'node scripts/checkAddonApiCompat.mjs --root <临时树> --baseline <仓库基线> --json <报告>', 'c')
  rmSync(sim, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// 场景 D：篡改基线（字段被改）→ --verify-baseline 失败（契约检查之前的第一道防线）
// ---------------------------------------------------------------------------
{
  const dir = mkdtempSync(path.join(tmpdir(), 'vsidian-t14-demo-d-'))
  const tampered = structuredClone(BASELINE)
  tampered.entries.find((e) => e.id === 'manifest-declaration').purpose = '被候选改写的基线承诺'
  const tamperedPath = path.join(dir, 'baseline-tampered.json')
  writeFileSync(tamperedPath, JSON.stringify(tampered, null, 2))
  const r = runChecker(['--verify-baseline', '--baseline', tamperedPath])
  const ok = r.status === 1 && r.stderr.includes('baseline-entry-field-mismatch')
  if (!ok) failed = true
  record(
    '场景 D：篡改基线（条目字段被改）→ verify-baseline 拦截',
    ok ? '符合预期（exit 1，baseline-entry-field-mismatch）' : '不符合预期',
    [
      '命令：`node scripts/checkAddonApiCompat.mjs --verify-baseline --baseline <被改基线>`',
      `退出码：${r.status}（预期 1）`,
      `stderr 摘要：${r.stderr.split('\n').filter((l) => l.includes('FAIL')).slice(0, 2).join(' | ') || '（无 FAIL 行）'}`,
      '防线说明：CI job（ci.yml addon-api-contract）把本复验排在契约检查之前——先证检查器可信，再信检查结果',
    ],
  )
  rmSync(dir, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// 场景 E：遗漏指南（删开发指南）
// ---------------------------------------------------------------------------
{
  const sim = buildSimTree()
  rmSync(path.join(sim, 'docs/addons/developer-guide.md'))
  const out = runFullCheck(sim)
  expectRejection('场景 E：删除开发指南 docs/addons/developer-guide.md → 拦截', out, ['guard-file-missing'], 'node scripts/checkAddonApiCompat.mjs --root <临时树> --baseline <仓库基线> --json <报告>', 'e')
  rmSync(sim, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// 场景 F：提前移除（双门槛未满 + 条目物理删除）
// ---------------------------------------------------------------------------
{
  const sim = buildSimTree()
  // 台账改写：1.0.0 已发行、1.1.0 弃用（2026-01-02）、1.4.0 于 2026-01-20 移除
  // （距弃用 18 天 < 30；弃用后已发行次版本仅 1 个 < 2——两项都不满足）
  rewriteReleases(
    sim,
    [
      "    { version: '1.0.0', status: 'released', releasedAt: '2026-01-01', summary: '已发行', experimental: [] },",
      "    { version: '1.1.0', status: 'deprecated', releasedAt: '2026-01-02', summary: '弃用并给出替代', experimental: [] },",
      "    { version: '1.2.0', status: 'released', releasedAt: '2026-01-10', summary: '后续次版本', experimental: [] },",
      "    { version: '1.4.0', status: 'removed', releasedAt: '2026-01-20', summary: '提前移除（不合法）', experimental: [] },",
    ].join('\n'),
  )
  // 同时物理删除一个基线保护条目（移除的另一半规避路径）
  deleteCatalogEntry(sim, 'official-registry')
  const out = runFullCheck(sim)
  expectRejection(
    '场景 F：提前移除（距弃用 18 天 + 仅 1 个后续次版本，且条目被物理删除）→ 拦截',
    out,
    ['removal-too-early', 'removal-minor-span-insufficient', 'entry-missing'],
    'node scripts/checkAddonApiCompat.mjs --root <临时树> --baseline <仓库基线> --json <报告>',
    'f',
  )
  rmSync(sim, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// 场景 G：两条基线路径的隔离 git fixture 证据（bootstrap 与 release）
// ---------------------------------------------------------------------------
{
  const dir = mkdtempSync(path.join(tmpdir(), 'vsidian-t14-demo-g-'))
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  const writeFile = (rel, content) => {
    const to = path.join(dir, rel)
    mkdirSync(path.dirname(to), { recursive: true })
    writeFileSync(to, content, 'utf8')
  }
  const catalog = (status) => `
export const ADDON_API_GROUPS = [{ id: 'discovery', title: '发现与安装', scope: 'fixture', order: 1 }]
export const ADDON_API_ENTRIES = [
  {
    id: 'fixture-demo-api',
    group: 'discovery',
    title: 'fixture 演示接口',
    layer: 'stable-candidate',
    endpoints: ['host'],
    signatures: [{ module: 'src/shared/fixtureDemo.ts', symbols: ['fixtureDemoApi'] }],
    purpose: 'fixture 演示用途。',
    semantics: { errors: '一种拒绝' },
    verification: ['test/unit/fixtureDemo.test.ts'],
    introduced: '#fixture',
  },
]
export const ADDON_API_RELEASES = [${
    status === 'released'
      ? "{ version: '1.0.0', status: 'released', releasedAt: '2026-01-01', summary: 'fixture 发行', experimental: [] }"
      : "{ version: '1.0.0', status: 'candidate', summary: 'fixture 候选', experimental: [] }"
  }]
export const ADDON_API_REMOVAL_RULE = 'fixture 移除规则'
export function validateAddonApiCatalog() {
  return []
}
`
  writeFile('src/shared/addonApiCatalog.ts', catalog('candidate'))
  writeFile('src/shared/fixtureDemo.ts', 'export function fixtureDemoApi(): void {}\n')
  writeFile('test/unit/fixtureDemo.test.ts', '// fixture 验证文件\n')
  git(['init', '-q'])
  git(['add', '.'])
  git(['-c', 'user.name=t14-demo', '-c', 'user.email=t14@demo.invalid', 'commit', '-q', '-m', 'bootstrap anchor'])
  const bootstrapOut = path.join(dir, 'baseline-fixture-bootstrap.json')

  const emitB = runChecker(['--root', dir, '--emit-baseline', '--anchor', 'HEAD', '--baseline-version', 'fixture-bootstrap-1', '--out', bootstrapOut])
  const verifyB = runChecker(['--root', dir, '--verify-baseline', '--baseline', bootstrapOut])
  // release 路径：改台账为已发行、提交、打 fixture/ 前缀标签（不冒充真实发行）
  writeFile('src/shared/addonApiCatalog.ts', catalog('released'))
  git(['add', '.'])
  git(['-c', 'user.name=t14-demo', '-c', 'user.email=t14@demo.invalid', 'commit', '-q', '-m', 'release anchor'])
  git(['tag', 'fixture/api-1.0.0'])
  const releaseOut = path.join(dir, 'baseline-fixture-api.json')
  const emitR = runChecker(['--root', dir, '--emit-baseline', '--anchor', 'fixture/api-1.0.0', '--mode', 'release', '--api-version', '1.0.0', '--out', releaseOut])
  const verifyR = runChecker(['--root', dir, '--verify-baseline', '--baseline', releaseOut])
  // 基线被改 → 复验失败
  const tamperedR = JSON.parse(readFileSync(releaseOut, 'utf8'))
  tamperedR.entries[0].purpose = '篡改后的目标'
  const tamperedRPath = path.join(dir, 'baseline-fixture-api-tampered.json')
  writeFileSync(tamperedRPath, JSON.stringify(tamperedR, null, 2))
  const verifyT = runChecker(['--root', dir, '--verify-baseline', '--baseline', tamperedRPath])

  const okBootstrap = emitB.status === 0 && verifyB.status === 0
  const okRelease = emitR.status === 0 && verifyR.status === 0
  const okTamper = verifyT.status === 1 && verifyT.stderr.includes('baseline-entry-field-mismatch')
  const ok = okBootstrap && okRelease && okTamper
  if (!ok) failed = true
  record(
    '场景 G：隔离 git fixture 的 bootstrap 与 release 两条基线路径',
    ok ? '符合预期（两条路径发射+复验通过；篡改被拒）' : '不符合预期',
    [
      `bootstrap（提交锚点，首个真实发行前的显式初始基线）：发射 exit ${emitB.status}，复验 exit ${verifyB.status}（预期 0/0）`,
      `release（fixture/api-1.0.0 标签锚点 + 台账 released + 实际日期）：发射 exit ${emitR.status}，复验 exit ${verifyR.status}（预期 0/0）`,
      `基线被改后复验：exit ${verifyT.status}（预期 1，baseline-entry-field-mismatch ${verifyT.stderr.includes('baseline-entry-field-mismatch') ? '命中' : '未命中'}）`,
      '边界说明：fixture 仓库内标签一律 fixture/ 前缀——测试标签不是真实 SDK 发行（票面「范围外」）；真实发行落账时用 release 模式在主仓库执行',
    ],
  )
  rmSync(dir, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// 场景 H：恢复态（真实仓库树原样）→ 全检查通过
// ---------------------------------------------------------------------------
{
  const r = runChecker([])
  const ok = r.status === 0
  if (!ok) failed = true
  record(
    '场景 H：恢复态（真实仓库树原样）→ 通过',
    ok ? '符合预期（exit 0）' : '不符合预期',
    [
      '命令：`node scripts/checkAddonApiCompat.mjs`（候选=本仓库）',
      `退出码：${r.status}（预期 0）`,
      `stdout 末行：${r.stdout.trim().split('\n').pop()}`,
      '说明：场景 A–G 的破坏均在临时目录施加，仓库工作树未被触碰；删除 git 未提交内容亦无从谈起（无破坏性提交）',
    ],
  )
}

evidence.push('---', '', '重跑方式：`node scripts/demoAddonApiGate.mjs`（退出码 0 = 全部场景符合预期）。', '机制与边界说明见 docs/specs/addons-api-gate.md。', '')
writeFileSync(evidencePath, evidence.join('\n'), 'utf8')

console.log(evidence.join('\n'))
console.log(`\n证据已写入：${evidencePath}`)
if (failed) {
  console.error('存在不符合预期的场景')
  process.exitCode = 1
} else {
  console.log('全部场景符合预期（负向全拦截 → 两条基线路径可信 → 恢复通过）')
}
