// 历史 CSS 契约兼容检查器契约测试（#134，node --test，与 release.test.mjs 同
// 先例）：钉住「独立历史基线 vs 候选清单」比较、弃用期限校验、发布数据解析
// 与**反规避负向场景**——模拟候选树剥离（删实现/清单/旧测试）后检查器仍须
// 失败。这是 #134 的标志性要求：候选分支删掉自身测试不能消除历史约束。
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  parseChangelogReleases,
  parseSelectorMapRows,
  normalizeRowKey,
  compareSemver,
  releasedMinorsAfter,
  daysBetween,
  extractLifecycleVersion,
  compareEntries,
  extractClassTokens,
  targetCompatible,
  validateLifecycle,
  checkAliasBridge,
  verifyBaselineRows,
  checkGuardManifest,
  runStyleContractCheck,
} from '../../scripts/styleContractCheck.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASELINE_PATH = path.join(REPO_ROOT, 'test/style-contract/baseline-v0.4.0.json')
const BASELINE = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))

const CTX = { candidateVersion: '0.4.0', baselineLabel: 'v0.4.0 (75c3df7)' }

function failureCodes(failures) {
  return failures.map((f) => f.code)
}

function byId(entries, id) {
  return entries.find((e) => e.id === id)
}

// ---------------------------------------------------------------------------
// 1. 发布数据解析（CHANGELOG 版本段 / git tag 快照交叉）
// ---------------------------------------------------------------------------

test('parseChangelogReleases：版本段日期解析，Unreleased 跳过', () => {
  const md = [
    '# Changelog',
    '',
    '## Unreleased',
    '',
    '- 内部条目',
    '',
    '## 0.4.0 - 2026-09-27',
    '',
    '## 0.3.0 - 2026-09-26',
    '',
    '## 0.2.0 - 2026-09-26',
    '',
    '## 0.1.0 - 2026-09-25',
    '',
  ].join('\n')
  const releases = parseChangelogReleases(md)
  assert.deepEqual(Object.keys(releases), ['0.4.0', '0.3.0', '0.2.0', '0.1.0'])
  assert.equal(releases['0.4.0'].date, '2026-09-27')
  assert.equal(releases['0.1.0'].date, '2026-09-25')
  assert.equal('Unreleased' in releases, false)
})

test('parseChangelogReleases：日期格式非法时失败（不静默通过）', () => {
  const md = '## 0.2.0 - 不存在的日期\n'
  assert.throws(() => parseChangelogReleases(md), /0\.2\.0/)
})

test('真实 CHANGELOG 解析结果与基线固化快照一致', () => {
  const md = readFileSync(path.join(REPO_ROOT, 'CHANGELOG.md'), 'utf8')
  const releases = parseChangelogReleases(md)
  for (const [version, snap] of Object.entries(BASELINE.releases)) {
    assert.equal(releases[version]?.date, snap.date, `${version} 的 CHANGELOG 日期应与基线固化快照一致`)
  }
})

// ---------------------------------------------------------------------------
// 2. v0.4.0 映射表主键提取（--verify-baseline 的解析器）
// ---------------------------------------------------------------------------

test('normalizeRowKey：去反引号/删除线/括号注释', () => {
  assert.equal(normalizeRowKey('`.vsidian-heading-line-{1..6}`（挂在 `.cm-line` 行元素上）'), '.vsidian-heading-line-{1..6}')
  assert.equal(normalizeRowKey('~~`--vsidian-heading-accent`~~'), '--vsidian-heading-accent')
  assert.equal(normalizeRowKey('| `.vsidian-view-live` '), '.vsidian-view-live')
})

test('parseSelectorMapRows：跳过表头与分隔行，只取主键列', () => {
  const md = [
    '## 容器与视图入口',
    '',
    '| 本项目稳定类名 | 本项目用途 |',
    '| --- | --- | --- |',
    '| `.vsidian-view-live` | 容器 |',
    '| `.vsidian-view-reading` | 容器 |',
    '',
    '## 公开 CSS 变量',
    '',
    '| 变量 | 默认值 |',
    '| --- | --- |',
    '| `--vsidian-table-background` | 值 |',
  ].join('\n')
  const rows = parseSelectorMapRows(md)
  assert.deepEqual(rows.map((r) => r.key), [
    '.vsidian-view-live',
    '.vsidian-view-reading',
    '--vsidian-table-background',
  ])
})

test('parseSelectorMapRows：v0.4.0 真实映射表提取 89 个主键且与基线 sourceRow 集合一致', () => {
  const mapMd = execFileSync('git', ['show', `${BASELINE.meta.sourceSha}:docs/design/obsidian-selector-map.md`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  const rows = parseSelectorMapRows(mapMd)
  assert.equal(rows.length, 89, 'v0.4.0 映射表主键数应为 89（生成基线时的冻结值）')
  const failures = verifyBaselineRows(BASELINE, rows)
  assert.deepEqual(failures, [], '基线 sourceRow 集合应与 v0.4.0 tag 内容逐项一致')
})

test('verifyBaselineRows：候选改动基线（删一条 sourceRow）被 git 锚定复验抓住', () => {
  const mapMd = execFileSync('git', ['show', `${BASELINE.meta.sourceSha}:docs/design/obsidian-selector-map.md`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  const rows = parseSelectorMapRows(mapMd)
  // 模拟候选分支改基线文件：抹去一条 sourceRow 对照（假装该入口从未承诺）
  const tampered = JSON.parse(JSON.stringify(BASELINE))
  const victim = tampered.sourceRows.findIndex((r) => r.key.includes('vsidian-heading-line'))
  tampered.sourceRows.splice(victim, 1)
  const failures = verifyBaselineRows(tampered, rows)
  assert.ok(failures.some((f) => f.code === 'baseline-row-extra'), '应报 baseline-row-extra（历史表有行而基线丢项）：' + JSON.stringify(failureCodes(failures)))
})

// ---------------------------------------------------------------------------
// 3. 版本跨度与天数计算
// ---------------------------------------------------------------------------

test('compareSemver：次版本排序', () => {
  assert.equal(compareSemver('0.2.0', '0.3.0') < 0, true)
  assert.equal(compareSemver('0.10.0', '0.9.0') > 0, true)
  assert.equal(compareSemver('0.2.1', '0.2.1'), 0)
})

test('releasedMinorsAfter：补丁不计次版本、未发布版本不算', () => {
  const releases = {
    '0.2.0': { date: '2026-08-01' },
    '0.2.1': { date: '2026-08-02' },
    '0.2.2': { date: '2026-08-03' },
    '0.3.0': { date: '2026-08-15' },
    '0.4.0': { date: '2026-09-01' },
  }
  // 0.2.x 弃用：后续已发布次版本 = 0.3.0、0.4.0（0.2.1/0.2.2 是补丁，不计）
  assert.deepEqual(releasedMinorsAfter(releases, '0.2.0'), ['0.3.0', '0.4.0'])
  // 跳版本伪造：弃用后只有 0.3.0 一个次版本
  assert.deepEqual(releasedMinorsAfter({ '0.2.0': { date: '2026-08-01' }, '0.3.0': { date: '2026-08-15' } }, '0.2.0'), ['0.3.0'])
})

test('daysBetween：29/30 天边界', () => {
  assert.equal(daysBetween('2026-08-01', '2026-08-31'), 30)
  assert.equal(daysBetween('2026-08-01', '2026-08-30'), 29)
  assert.equal(daysBetween('2026-08-01', '2026-08-01'), 0)
})

test('extractLifecycleVersion：自由文本提取 semver', () => {
  assert.equal(extractLifecycleVersion('v0.2.0 起弃用；替代写法见 X'), '0.2.0')
  assert.equal(extractLifecycleVersion('0.2.1（2026-09-01 发布）'), '0.2.1')
  assert.equal(extractLifecycleVersion('v0.4.x 周期内移除'), '0.4.0')
  assert.equal(extractLifecycleVersion('无版本号的弃用声明'), null)
})

// ---------------------------------------------------------------------------
// 4. 契约比较（compareEntries）
// ---------------------------------------------------------------------------

function baselineEntry(overrides = {}) {
  return {
    id: 'live-heading-line',
    sourceKey: '.vsidian-heading-line-{1..6}',
    domain: 'content',
    kind: 'selector',
    target: '.vsidian-heading-line-{1..6}',
    views: ['live'],
    obsidianSupport: 'direct',
    aliasTargets: ['HyperMD-header-{1..6}'],
    introduced: '#5（2026-09-23）',
    ...overrides,
  }
}

test('compareEntries：候选删除清单条目即失败（独立于候选自身测试）', () => {
  const candidate = [baselineEntry()] // 基线两条，候选只剩一条
  const failures = compareEntries([baselineEntry(), baselineEntry({ id: 'inline-strong', sourceKey: '.vsidian-strong', target: '.vsidian-strong', aliasTargets: ['cm-strong'] })], candidate, CTX)
  assert.deepEqual(failureCodes(failures), ['entry-missing'])
  const f = failures[0]
  assert.equal(f.entry, 'inline-strong')
  // 工单要求的失败四元组：入口、历史来源、候选版本、证据
  assert.ok(f.source.includes('v0.4.0'), '失败报告须含历史来源')
  assert.equal(f.candidateVersion, '0.4.0')
  assert.ok(f.evidence.length > 0, '失败报告须含证据')
})

test('compareEntries：已移除（removed）的基线条目同样不得从清单消失', () => {
  const removed = baselineEntry({ id: 'var-heading-accent', kind: 'variable', target: '--vsidian-heading-accent（已移除）', views: [], obsidianSupport: 'none', aliasTargets: undefined, removed: 'v0.2.x 周期内随 #55（2026-09-25）移除' })
  const failures = compareEntries([removed], [], CTX)
  assert.deepEqual(failureCodes(failures), ['entry-missing'])
})

test('compareEntries：target 改名视同删除', () => {
  const candidate = [baselineEntry({ target: '.vsidian-heading-row-{1..6}' })]
  const failures = compareEntries([baselineEntry()], candidate, CTX)
  assert.deepEqual(failureCodes(failures), ['entry-target-changed'])
})

test('compareEntries：support 降级失败，升级通过', () => {
  // 隔离测 support：降级候选保留 aliasTargets（否则同时触发 alias-retracted）
  const downgraded = [baselineEntry({ obsidianSupport: 'semantic' })]
  assert.deepEqual(failureCodes(compareEntries([baselineEntry()], downgraded, CTX)), ['support-downgraded'])
  const upgraded = [baselineEntry({ obsidianSupport: 'direct' })]
  assert.deepEqual(compareEntries([baselineEntry({ obsidianSupport: 'semantic', aliasTargets: undefined })], upgraded, CTX), [])
})

test('compareEntries：views 收回失败，扩展通过', () => {
  const shrunk = [baselineEntry({ views: [] })]
  assert.deepEqual(failureCodes(compareEntries([baselineEntry()], shrunk, CTX)), ['views-shrunk'])
  const extended = [baselineEntry({ views: ['live', 'reading'] })]
  assert.deepEqual(compareEntries([baselineEntry()], extended, CTX), [])
})

test('compareEntries：aliasTargets 收回 Obsidian 原名承诺即失败', () => {
  const retracted = [baselineEntry({ aliasTargets: undefined })]
  const failures = compareEntries([baselineEntry()], retracted, CTX)
  // 族形态 {1..6} 展开为 6 个实名，逐个报告收回
  assert.ok(failures.length >= 6 && failures.every((f) => f.code === 'alias-retracted'), JSON.stringify(failureCodes(failures)))
})

test('compareEntries：kind/domain 变化失败；候选新增条目不受限', () => {
  const changed = [baselineEntry({ kind: 'variable' })]
  assert.deepEqual(failureCodes(compareEntries([baselineEntry()], changed, CTX)), ['kind-changed'])
  const added = [baselineEntry(), baselineEntry({ id: 'new-entry', sourceKey: null, target: '.vsidian-new' })]
  assert.deepEqual(compareEntries([baselineEntry()], added, CTX), [])
})

test('compareEntries：chrome 域条目（#133 界面域清单）自动纳入同一规则，不写死 content 域', () => {
  const chromeEntry = baselineEntry({
    id: 'chrome-toolbar', sourceKey: '.vsidian-toolbar', domain: 'chrome', target: '.vsidian-toolbar', views: [], aliasTargets: undefined,
  })
  // 基线含 chrome 条目而候选删除 → 同样 entry-missing（#133 落地后自动受保护）
  assert.deepEqual(failureCodes(compareEntries([chromeEntry], [], CTX)), ['entry-missing'])
  // 候选保留则通过
  assert.deepEqual(compareEntries([chromeEntry], [{ ...chromeEntry }], CTX), [])
})

// ---------------------------------------------------------------------------
// 4b. target 类名 token 兼容判定（#133 数据修正形态；合并 #133 时引入）
// ---------------------------------------------------------------------------

test('extractClassTokens：只提点前缀完整词，无点简写与中文注释不参与', () => {
  assert.deepEqual([...extractClassTokens('.vsidian-outline-slider-dot（+ .vsidian-outline-slider-active / -filled）')].sort(),
    ['.vsidian-outline-slider-active', '.vsidian-outline-slider-dot'])
  assert.deepEqual([...extractClassTokens('.vsidian-mode-toggle（已移除）')], ['.vsidian-mode-toggle'])
  assert.deepEqual([...extractClassTokens('--vsidian-heading-color-1')], [])
})

test('targetCompatible：基线类名 token 只增不减的括注扩展放行，消失/替换仍拦', () => {
  // #133 真实修正形态（合并树候选清单 vs 基线快照）
  assert.equal(targetCompatible(
    '.vsidian-outline-slider-dot（+ .vsidian-outline-slider-active）',
    '.vsidian-outline-slider-dot（+ .vsidian-outline-slider-active / -filled）'), true)
  assert.equal(targetCompatible(
    '.vsidian-reading-code-card',
    '.vsidian-reading-code-card（+ .vsidian-reading-code-line 行结构 / .vsidian-code-card-folded 收起态）'), true)
  assert.equal(targetCompatible(
    '.vsidian-suspend-banner',
    '.vsidian-suspend-banner（内含 .vsidian-suspend-banner-text）'), true)
  assert.equal(targetCompatible(
    '.vsidian-mode-toggle',
    '.vsidian-mode-toggle（已移除）'), true)
  // 收缩：基线承诺的第二个类被删 → 拦
  assert.equal(targetCompatible('.vsidian-a / .vsidian-b', '.vsidian-a'), false)
  // 改名：token 替换 → 拦
  assert.equal(targetCompatible('.vsidian-heading-line-{1..6}', '.vsidian-heading-row-{1..6}'), false)
  // 候选丢失全部类名（改成纯文字）→ 拦
  assert.equal(targetCompatible('.vsidian-a', '无'), false)
  // 变量 target（无类名 token）回退全等：追加任何文本都按改名报告
  assert.equal(targetCompatible('--vsidian-x', '--vsidian-x（.vsidian-y）'), false)
  assert.equal(targetCompatible('--vsidian-x', '--vsidian-x'), true)
})

test('compareEntries：target 括注扩展（类名 token 只增不减）通过，token 消失仍报', () => {
  const base = baselineEntry({ target: '.vsidian-suspend-banner', views: [], aliasTargets: undefined })
  const expanded = [baselineEntry({ target: '.vsidian-suspend-banner（内含 .vsidian-suspend-banner-text）', views: [], aliasTargets: undefined })]
  assert.deepEqual(compareEntries([base], expanded, CTX), [])
  const shrunk = [baselineEntry({ target: '.vsidian-a', views: [], aliasTargets: undefined })]
  assert.deepEqual(failureCodes(compareEntries(
    [baselineEntry({ target: '.vsidian-a / .vsidian-b', views: [], aliasTargets: undefined })], shrunk, CTX)), ['entry-target-changed'])
})

// ---------------------------------------------------------------------------
// 4c. 条目比较豁免（基线 entryComparisonExemptions；mode-toggle 纠错补登）
// ---------------------------------------------------------------------------

test('compareEntries：豁免条目跳过字段比较，但 entry-missing 仍拦', () => {
  const base = baselineEntry({ id: 'mode-toggle', target: '.vsidian-mode-toggle', views: ['live', 'reading'], aliasTargets: undefined })
  // 未豁免：views 收缩 + target 变化即失败
  const rewritten = [baselineEntry({ id: 'mode-toggle', target: '.vsidian-mode-toggle（已移除）', views: [], aliasTargets: undefined })]
  assert.ok(compareEntries([base], rewritten, CTX).length >= 2, '未豁免时 target/views 变化应报失败')
  // 豁免：同形态通过
  assert.deepEqual(compareEntries([base], rewritten, CTX, new Set(['mode-toggle'])), [])
  // 豁免不豁免物理删除
  assert.deepEqual(failureCodes(compareEntries([base], [], CTX, new Set(['mode-toggle']))), ['entry-missing'])
})

test('基线补登（#133 合并）：mode-toggle 的双层豁免与 provenance 理由在册', () => {
  assert.ok(BASELINE.lifecycleExemptions?.includes('mode-toggle'),
    'lifecycleExemptions 应登记 mode-toggle（removed 无弃用先行的期限校验豁免）')
  assert.deepEqual(BASELINE.entryComparisonExemptions, ['mode-toggle'],
    'entryComparisonExemptions 应恰登记 mode-toggle（基线快照承诺经 git 证据核实为陈旧数据的纠错豁免）')
  const note = BASELINE.meta.provenance.find((p) => p.includes('entryComparisonExemptions'))
  assert.ok(note && note.includes('零命中') && note.includes('entry-missing 仍拦'),
    'provenance 应记录豁免理由（git 证据）与保护边界（entry-missing 不豁免）')
  // 豁免与真实基线/候选形态对拍：基线条目存在且候选清单（合并树）确有移除记录条目
  assert.equal(byId(BASELINE.entries, 'mode-toggle').views.join('/'), 'live/reading')
})

// ---------------------------------------------------------------------------
// 5. 弃用期限校验（validateLifecycle）
// ---------------------------------------------------------------------------

const RELEASES_FIXTURE = {
  '0.1.0': { date: '2026-07-01' },
  '0.2.0': { date: '2026-08-01' },
  '0.2.1': { date: '2026-08-05' },
  '0.3.0': { date: '2026-08-15' },
  '0.4.0': { date: '2026-09-05' },
}

test('validateLifecycle：弃用声明缺实际发布版本（资料不可取得）不降级通过', () => {
  const entries = [baselineEntry({ deprecated: 'v0.9.9 起弃用；替代：X' })]
  const failures = validateLifecycle(entries, RELEASES_FIXTURE, '2026-09-27')
  assert.ok(failures.some((f) => f.code === 'deprecated-version-unverifiable'), JSON.stringify(failureCodes(failures)))
})

test('validateLifecycle：弃用声明缺替代写法失败', () => {
  const entries = [baselineEntry({ deprecated: 'v0.2.0 起弃用' })]
  const failures = validateLifecycle(entries, RELEASES_FIXTURE, '2026-09-27')
  assert.ok(failures.some((f) => f.code === 'deprecated-no-replacement'), JSON.stringify(failureCodes(failures)))
})

test('validateLifecycle：removed 必须有弃用声明先行', () => {
  const entries = [baselineEntry({ removed: 'v0.4.0 移除' })]
  const failures = validateLifecycle(entries, RELEASES_FIXTURE, '2026-09-27')
  assert.ok(failures.some((f) => f.code === 'removed-without-deprecation'), JSON.stringify(failureCodes(failures)))
})

test('validateLifecycle：29 天边界——弃用未满 30 天禁止移除', () => {
  // 0.2.0 发布于 2026-08-01；now = 2026-08-30 恰 29 天：不允许移除
  const entries = [baselineEntry({ deprecated: 'v0.2.0 起弃用；替代：X', removed: 'v0.4.0 移除' })]
  const failures = validateLifecycle(entries, RELEASES_FIXTURE, '2026-08-30')
  assert.ok(failures.some((f) => f.code === 'removal-too-early'), JSON.stringify(failureCodes(failures)))
})

test('validateLifecycle：满 30 天整（2026-08-31 = 第 30 天）且跨度足够则通过', () => {
  const entries = [baselineEntry({ deprecated: 'v0.2.0 起弃用；替代：X', removed: 'v0.4.0 移除' })]
  const failures = validateLifecycle(entries, RELEASES_FIXTURE, '2026-08-31')
  assert.deepEqual(failures, [])
})

test('validateLifecycle：版本跨度不足（仅一个后续次版本）禁止移除', () => {
  // 0.3.0 弃用（2026-08-15），now 已满 30 天，但后续次版本只有 0.4.0 一个
  const entries = [baselineEntry({ deprecated: 'v0.3.0 起弃用；替代：X', removed: 'v0.4.0 移除' })]
  const failures = validateLifecycle(entries, RELEASES_FIXTURE, '2026-09-27')
  assert.ok(failures.some((f) => f.code === 'removal-minor-span-insufficient'), JSON.stringify(failureCodes(failures)))
})

test('validateLifecycle：跳版本号不能伪造发布历程（移除版本未实际发布）', () => {
  // 声明 v0.6.0 移除，但 0.6.0 不在已发布集合
  const entries = [baselineEntry({ deprecated: 'v0.2.0 起弃用；替代：X', removed: 'v0.6.0 移除' })]
  const failures = validateLifecycle(entries, RELEASES_FIXTURE, '2026-09-27')
  assert.ok(failures.some((f) => f.code === 'removal-version-unverifiable'), JSON.stringify(failureCodes(failures)))
})

test('validateLifecycle：正常到期迁移通过（两后续次版本 + 满 30 天）', () => {
  const entries = [baselineEntry({ deprecated: 'v0.2.0 起弃用；替代：用 .vsidian-heading-active', removed: 'v0.4.0 移除' })]
  const failures = validateLifecycle(entries, RELEASES_FIXTURE, '2026-09-27')
  assert.deepEqual(failures, [])
})

test('validateLifecycle：弃用未到期不产生失败（到期不自动移除——无 removed 即无校验）', () => {
  const entries = [baselineEntry({ deprecated: 'v0.4.0 起弃用；替代：X' })]
  const failures = validateLifecycle(entries, RELEASES_FIXTURE, '2026-09-06')
  assert.deepEqual(failures, [])
})

test('validateLifecycle：真实先例 var-heading-accent（移除早于本工单、已记录于基线）不再重复校验', () => {
  // 基线时点已是 removed 状态的历史条目：期限校验只针对基线 active 而候选新标
  // 弃用/移除的场景（compareEntries 已保证条目本体不丢）
  const entry = byId(BASELINE.entries, 'var-heading-accent')
  assert.ok(entry, '基线应含 var-heading-accent 历史条目')
  const candidate = [{ ...entry }]
  const failures = validateLifecycle(candidate, BASELINE.releases, '2026-09-27', BASELINE.lifecycleExemptions ?? [])
  // 该条目在基线 lifecycleExemptions 登记（历史先例的弃用声明早于工具建立，
  // 结构化记录不完整属既成事实）——豁免须来自基线（受保护数据），非候选自定
  assert.ok(BASELINE.lifecycleExemptions?.includes('var-heading-accent'), '基线应登记该豁免')
  assert.deepEqual(failures, [])
})

// ---------------------------------------------------------------------------
// 6. 别名桥实现一致性（删实现被抓）
// ---------------------------------------------------------------------------

test('checkAliasBridge：direct 条目的 Obsidian 原名不被候选别名表承接即失败', () => {
  const candidateAliases = {
    dom: new Set(['markdown-source-view', 'mod-cm6', 'cm-s-obsidian', 'markdown-preview-view']),
    variables: new Set(['--h1-color']),
  }
  const failures = checkAliasBridge([baselineEntry()], candidateAliases, CTX)
  assert.ok(failures.some((f) => f.code === 'alias-implementation-missing'), JSON.stringify(failureCodes(failures)))
  assert.equal(failures[0].entry, 'live-heading-line')
})

test('checkAliasBridge：变量别名桥丢失同名承诺失败', () => {
  const varEntry = baselineEntry({ id: 'var-heading-color', kind: 'variable', target: '--vsidian-heading-color-{1..6}', aliasTargets: ['--h1-color'] })
  const failures = checkAliasBridge([varEntry], { dom: new Set(), variables: new Set() }, CTX)
  assert.ok(failures.some((f) => f.code === 'alias-implementation-missing'))
})

test('checkAliasBridge：全部承接时通过', () => {
  const dom = new Set()
  for (const lv of [1, 2, 3, 4, 5, 6]) dom.add(`HyperMD-header-${lv}`)
  const failures = checkAliasBridge([baselineEntry()], { dom, variables: new Set() }, CTX)
  assert.deepEqual(failures, [])
})

// ---------------------------------------------------------------------------
// 7. 完整性自检（guardManifest）
// ---------------------------------------------------------------------------

test('checkGuardManifest：必需文件缺失或锚点丢失失败', () => {
  const manifest = { requiredFiles: [{ path: 'src/shared/styleContract.ts', anchor: 'STYLE_CONTRACT_ENTRIES' }] }
  const dir = mkdtempSync(path.join(tmpdir(), 'guard-'))
  try {
    // 文件不存在
    let failures = checkGuardManifest(dir, manifest)
    assert.ok(failures.some((f) => f.code === 'guard-file-missing'))
    // 文件存在但锚点被删（模拟候选弱化测试）
    mkdirSync(path.join(dir, 'src/shared'), { recursive: true })
    writeFileSync(path.join(dir, 'src/shared/styleContract.ts'), 'export const X = 1\n')
    failures = checkGuardManifest(dir, manifest)
    assert.ok(failures.some((f) => f.code === 'guard-anchor-missing'))
    // 完整形态通过
    writeFileSync(path.join(dir, 'src/shared/styleContract.ts'), 'export const STYLE_CONTRACT_ENTRIES = []\n')
    failures = checkGuardManifest(dir, manifest)
    assert.deepEqual(failures, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 8. 真实仓库当前态：完整检查通过
// ---------------------------------------------------------------------------

test('runStyleContractCheck：真实仓库当前态（清单=基线迁移态）全检查通过', async () => {
  const report = await runStyleContractCheck({ root: REPO_ROOT, baselinePath: BASELINE_PATH })
  assert.equal(report.ok, true, '当前树应通过全部检查：' + JSON.stringify(report.failures, null, 2))
  assert.equal(report.failures.length, 0)
  assert.ok(report.checks.length >= 5, '报告应含分项检查明细')
})

test('runStyleContractCheck：git tag 指向与基线固化 SHA 一致（真实仓库）', async () => {
  const report = await runStyleContractCheck({ root: REPO_ROOT, baselinePath: BASELINE_PATH })
  const tagCheck = report.checks.find((c) => c.id === 'git-tag-consistency')
  assert.ok(tagCheck, '报告应含 git tag 一致性分项')
  assert.equal(tagCheck.status, 'pass', JSON.stringify(tagCheck))
})

// ---------------------------------------------------------------------------
// 9. 反规避负向：模拟候选树剥离（#134 标志性要求）
// ---------------------------------------------------------------------------

/** 构造模拟候选树：复制检查器消费的候选面文件，再施加剥离变换 */
async function buildSimTree(transforms = []) {
  const sim = mkdtempSync(path.join(tmpdir(), 'vsidian-css134-sim-'))
  const files = [
    'package.json',
    'CHANGELOG.md',
    'src/shared/styleContract.ts',
    'src/shared/obsidianAlias.ts',
    // #133 起 styleContract.ts 转发导出 chromeContract 的探针表——sim 树
    // 须一并复制，否则候选清单 esbuild 编译即失败（candidate-contract-error）
    'src/shared/chromeContract.ts',
    'src/webview/styleGuideData.ts',
    'media/style-reference/style-reference.html',
    ...BASELINE.guardManifest.requiredFiles.map((f) => f.path),
  ]
  const seen = new Set()
  for (const rel of files) {
    if (seen.has(rel)) continue
    seen.add(rel)
    const from = path.join(REPO_ROOT, rel)
    const to = path.join(sim, rel)
    mkdirSync(path.dirname(to), { recursive: true })
    cpSync(from, to)
  }
  for (const t of transforms) {
    const err = t(sim)
    if (err) throw err
  }
  return sim
}

/** 对模拟树内文本文件做「删匹配行」变换 */
function dropLines(rel, matcher) {
  return (sim) => {
    const file = path.join(sim, rel)
    const lines = readFileSync(file, 'utf8').split('\n')
    const kept = lines.filter((l) => !matcher(l))
    if (kept.length === lines.length) return new Error(`变换未命中任何行：${rel}`)
    writeFileSync(file, kept.join('\n'))
  }
}

function rewrite(rel, fn) {
  return (sim) => {
    const file = path.join(sim, rel)
    writeFileSync(file, fn(readFileSync(file, 'utf8')))
  }
}

const SIM_OPTS = () => ({
  root: undefined, // 由调用方填
  baselinePath: BASELINE_PATH,
  // 模拟树无 .git：注入与真实 tag 一致的固化数据（复刻 CI 缓存场景）
  gitTagData: Object.fromEntries(Object.entries(BASELINE.releases).map(([v, r]) => [r.tag, r.sha])),
})

/** 删除清单条目对象整块（合法 TS：吞掉对象字面量与尾逗号行） */
const deleteEntry = (id) =>
  rewrite('src/shared/styleContract.ts', (text) => {
    const lines = text.split('\n')
    const start = lines.findIndex((l) => l.includes(`id: '${id}'`))
    assert.ok(start >= 0, `模拟树应含条目 ${id}`)
    // 回溯到对象开头 {
    let objStart = start
    while (!lines[objStart].includes('{')) objStart--
    // 前进到对象收尾 },
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
    // 连同可能的尾逗号行与行注释一起吞掉
    let removeEnd = objEnd
    while (removeEnd + 1 < lines.length && /^[),\s]*$/.test(lines[removeEnd + 1])) removeEnd++
    return lines.slice(0, objStart - 1 >= 0 ? objStart - 1 : objStart).concat(lines.slice(removeEnd + 1)).join('\n')
  })

test('负向 a：候选删除清单条目整块 → 独立基线仍报 entry-missing', async () => {
  const sim = await buildSimTree([deleteEntry('live-heading-line')])
  try {
    const report = await runStyleContractCheck({ ...SIM_OPTS(), root: sim })
    assert.equal(report.ok, false, '候选删除清单条目必须失败')
    assert.ok(report.failures.some((f) => f.code === 'entry-missing' && f.entry === 'live-heading-line'), JSON.stringify(report.failures.map((f) => f.code + ':' + f.entry)))
  } finally {
    rmSync(sim, { recursive: true, force: true })
  }
})

test('负向 b：同时删清单条目 + 删旧迁移测试（MIGRATION_PARITY 行与守恒断言）→ 仍失败', async () => {
  const sim = await buildSimTree([
    deleteEntry('live-heading-line'),
    // 候选顺手删掉 #132 的迁移守恒断言与 parity 行，消除候选侧测试的阻力
    dropLines('test/unit/styleContract.test.ts', (l) => l.includes("['.vsidian-heading-line-{1..6}', 'live-heading-line']")),
    dropLines('test/unit/styleContract.test.ts', (l) => l.includes('MIGRATION_PARITY.length).toBe(110)')),
    dropLines('test/unit/styleContract.test.ts', (l) => l.includes('旧条目「${oldKey}」→ 清单 ${id} 缺失')),
  ])
  try {
    const report = await runStyleContractCheck({ ...SIM_OPTS(), root: sim })
    assert.equal(report.ok, false)
    // 独立历史基线（非候选 MIGRATION_PARITY）仍拦住
    assert.ok(report.failures.some((f) => f.code === 'entry-missing' && f.entry === 'live-heading-line'), JSON.stringify(report.failures.map((f) => f.code)))
  } finally {
    rmSync(sim, { recursive: true, force: true })
  }
})

test('负向 c：候选删除别名桥实现表项（实现剥离）→ alias-implementation-missing', async () => {
  const sim = await buildSimTree([
    rewrite('src/shared/obsidianAlias.ts', (text) =>
      text.replace("headingLine: (lv: number) => [`HyperMD-header-${lv}`] as const,", 'headingLine: (lv: number) => [] as const,'),
    ),
  ])
  try {
    const report = await runStyleContractCheck({ ...SIM_OPTS(), root: sim })
    assert.equal(report.ok, false)
    assert.ok(report.failures.some((f) => f.code === 'alias-implementation-missing'), JSON.stringify(report.failures.map((f) => f.code + ':' + f.entry)))
  } finally {
    rmSync(sim, { recursive: true, force: true })
  }
})

test('负向 d：候选把 direct 降级 semantic（收回原名承诺）→ support-downgraded', async () => {
  const sim = await buildSimTree([
    rewrite('src/shared/styleContract.ts', (text) => {
      // 定位 live-heading-line 条目内的 support 字段并降级
      const marker = "id: 'live-heading-line'"
      const idx = text.indexOf(marker)
      assert.ok(idx >= 0)
      const segment = text.slice(idx, idx + 1200)
      const patched = segment.replace("support: 'direct'", "support: 'semantic'")
      assert.notEqual(patched, segment, '条目内应存在 support: direct 字段')
      return text.slice(0, idx) + patched + text.slice(idx + 1200)
    }),
  ])
  try {
    const report = await runStyleContractCheck({ ...SIM_OPTS(), root: sim })
    assert.equal(report.ok, false)
    assert.ok(report.failures.some((f) => f.code === 'support-downgraded'), JSON.stringify(report.failures.map((f) => f.code)))
  } finally {
    rmSync(sim, { recursive: true, force: true })
  }
})

test('负向 e：候选改 CHANGELOG 历史日期伪造弃用期限 → changelog-date-mismatch', async () => {
  const sim = await buildSimTree([
    rewrite('CHANGELOG.md', (text) => text.replace('## 0.2.0 - 2026-09-26', '## 0.2.0 - 2026-08-01')),
    // 候选声明一个「看似满足期限」的移除（按伪造日期已满 30 天）
    rewrite('src/shared/styleContract.ts', (text) =>
      text.replace(/introduced: '#8（2026-09-24）',\r?\n  },/, "introduced: '#8（2026-09-24）',\n    deprecated: 'v0.2.0 起弃用；替代：用 vsidian 名',\n    removed: 'v0.4.0 移除',\n  },"),
    ),
  ])
  try {
    const report = await runStyleContractCheck({ ...SIM_OPTS(), root: sim })
    assert.equal(report.ok, false)
    assert.ok(report.failures.some((f) => f.code === 'changelog-date-mismatch'), JSON.stringify(report.failures.map((f) => f.code)))
    // 伪造日期不能换来移除资格：期限按基线固化的真实日期计算仍不满
    assert.ok(report.failures.some((f) => f.code === 'removal-too-early'), '按真实发布日期（0.2.0=2026-09-26 至今 1 天）期限必须不满：' + JSON.stringify(report.failures.map((f) => f.code)))
  } finally {
    rmSync(sim, { recursive: true, force: true })
  }
})

test('负向 f：跳版本号（声明未发布版本移除）→ removal-version-unverifiable', async () => {
  const sim = await buildSimTree([
    rewrite('src/shared/styleContract.ts', (text) =>
      text.replace(/introduced: '#8（2026-09-24）',\r?\n  },/, "introduced: '#8（2026-09-24）',\n    deprecated: 'v0.4.0 起弃用；替代：用 vsidian 名',\n    removed: 'v0.7.0 移除',\n  },"),
    ),
  ])
  try {
    const report = await runStyleContractCheck({ ...SIM_OPTS(), root: sim })
    assert.equal(report.ok, false)
    assert.ok(report.failures.some((f) => f.code === 'removal-version-unverifiable'), JSON.stringify(report.failures.map((f) => f.code)))
  } finally {
    rmSync(sim, { recursive: true, force: true })
  }
})

test('负向 g：候选删除检查器消费的旧测试文件 → guard-file-missing', async () => {
  const sim = await buildSimTree([
    (dir) => rmSync(path.join(dir, 'test/unit/styleContract.test.ts'), { force: true }),
  ])
  try {
    const report = await runStyleContractCheck({ ...SIM_OPTS(), root: sim })
    assert.equal(report.ok, false)
    assert.ok(report.failures.some((f) => f.code === 'guard-file-missing'), JSON.stringify(report.failures.map((f) => f.code)))
  } finally {
    rmSync(sim, { recursive: true, force: true })
  }
})

test('负向 h：候选改弱探针资产（删原名探针规则）→ guard-anchor-missing', async () => {
  const sim = await buildSimTree([
    dropLines('media/css-contract-probe.css', (l) => l.includes('HyperMD-header-1')),
  ])
  try {
    const report = await runStyleContractCheck({ ...SIM_OPTS(), root: sim })
    assert.equal(report.ok, false)
    assert.ok(report.failures.some((f) => f.code === 'guard-anchor-missing'), JSON.stringify(report.failures.map((f) => f.code)))
  } finally {
    rmSync(sim, { recursive: true, force: true })
  }
})

test('负向 i：候选清单与指南产物脱钩（改清单不重新生成指南）→ guide-stale', async () => {
  // 在清单尾部追加一个新条目但指南产物保持旧内容
  const sim = await buildSimTree([
    rewrite('src/shared/styleContract.ts', (text) =>
      text.replace(
        /^]\s*$/m,
        [
          '  {',
          "    id: 'sim-extra-entry',",
          "    domain: 'content',",
          "    kind: 'selector',",
          "    target: '.vsidian-sim-extra',",
          "    purpose: '模拟新增条目（负向测试注入）。',",
          "    views: ['live'],",
          "    dom: '无。',",
          "    example: '',",
          "    obsidian: { counterpart: '无', support: 'none' },",
          "    verification: ['模拟'],",
          "    introduced: '#134（模拟）',",
          '  },',
          ']',
        ].join('\n'),
      ),
    ),
  ])
  try {
    const report = await runStyleContractCheck({ ...SIM_OPTS(), root: sim })
    assert.equal(report.ok, false)
    assert.ok(report.failures.some((f) => f.code === 'guide-stale'), JSON.stringify(report.failures.map((f) => f.code)))
  } finally {
    rmSync(sim, { recursive: true, force: true })
  }
})

test('负向 j：候选伪造版本号（package.json 抬高但无发布记录）不产生虚假通过', async () => {
  const sim = await buildSimTree([
    rewrite('package.json', (text) => text.replace('"version": "0.4.0"', '"version": "0.6.0"')),
    rewrite('src/shared/styleContract.ts', (text) =>
      text.replace(/introduced: '#8（2026-09-24）',\r?\n  },/, "introduced: '#8（2026-09-24）',\n    deprecated: 'v0.4.0 起弃用；替代：用 vsidian 名',\n    removed: 'v0.6.0 移除',\n  },"),
    ),
  ])
  try {
    const report = await runStyleContractCheck({ ...SIM_OPTS(), root: sim })
    assert.equal(report.ok, false)
    // 0.6.0 不在基线固化发布记录：移除版本不可核实（单纯抬高版本号不算发布）
    assert.ok(report.failures.some((f) => f.code === 'removal-version-unverifiable'), JSON.stringify(report.failures.map((f) => f.code)))
  } finally {
    rmSync(sim, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 10. 工具形态约束（#135 接口与网络无关性）
// ---------------------------------------------------------------------------

test('报告结构：失败四元组（入口/历史来源/候选版本/证据）与稳定路径约定', async () => {
  const sim = await buildSimTree([
    (dir) => rmSync(path.join(dir, 'test/unit/styleContract.test.ts'), { force: true }),
  ])
  try {
    const report = await runStyleContractCheck({ ...SIM_OPTS(), root: sim, reportPath: path.join(sim, 'report.json') })
    assert.equal(report.ok, false)
    assert.ok(report.tool === 'checkStyleContract')
    assert.ok(report.baseline.version === BASELINE.meta.baselineVersion)
    for (const f of report.failures) {
      assert.ok(f.source, '失败项须含历史来源')
      assert.ok(f.candidateVersion, '失败项须含候选版本')
      assert.ok(typeof f.evidence === 'string' && f.evidence.length > 0, '失败项须含证据')
    }
    assert.ok(existsSync(path.join(sim, 'report.json')), 'reportPath 指定时应写 JSON 报告')
  } finally {
    rmSync(sim, { recursive: true, force: true })
  }
})
