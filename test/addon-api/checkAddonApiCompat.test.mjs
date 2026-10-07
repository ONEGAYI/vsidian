// 附加组件 API 契约门禁检查器契约测试（#363 T14，node --test，与
// checkStyleContract.test.mjs 同先例）：钉住「独立历史基线 vs 候选清单」的
// 类型 + 语义双检查、发行台账双门槛弃用期限、可信基线验证（bootstrap 与
// release 两条路径，后者经隔离 Git fixture——测试标签一律 fixture/ 前缀，
// 不把测试标签当真实 SDK 发行）与反规避负向场景。
//
// 负向矩阵（票面口径）：
//   删除接口 / 收窄参数与结果（签名文本）/ 改变只读目标或故障语义 /
//   篡改基线 / 遗漏指南 / 提前移除 / 无基线或锚点不可达不被静默接受 /
//   未发布候选冒充发行 / 台账历史被当前树改写。
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  TOOL_ID,
  compareEntries,
  compareReleases,
  validateRemovalDeadlines,
  checkSignatureTexts,
  checkVerificationFiles,
  checkApiVersionBinding,
  verifyAddonApiBaseline,
  emitAddonApiBaseline,
  runAddonApiCompatCheck,
  realGitAccess,
  BASELINE_PATH,
} from '../../scripts/addonApiCompatCheck.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASELINE = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
const CTX = { baselineLabel: `${BASELINE.meta.baselineVersion} (${BASELINE.meta.anchor.sha.slice(0, 7)})`, apiVersion: '1.0.0' }

function failureCodes(failures) {
  return failures.map((f) => f.code)
}

function byId(entries, id) {
  return entries.find((e) => e.id === id)
}

/** 深拷贝基线条目集合，按 id 施加变更（构造候选形态） */
function mutateEntry(id, mutate) {
  const entries = structuredClone(BASELINE.entries)
  const entry = byId(entries, id)
  assert.ok(entry, `测试基线应含条目 ${id}`)
  mutate(entry)
  return entries
}

// ---------------------------------------------------------------------------
// 1. 条目比较：类型 + 语义双检查（纯逻辑负向矩阵）
// ---------------------------------------------------------------------------

test('基线自检：真实基线条目与候选一致时零失败（正向基准）', () => {
  assert.deepEqual(compareEntries(BASELINE.entries, structuredClone(BASELINE.entries), CTX), [])
})

test('删除接口被拒：entry-missing（条目永不物理删除）', () => {
  const candidate = BASELINE.entries.filter((e) => e.id !== 'manifest-declaration')
  const failures = compareEntries(BASELINE.entries, candidate, CTX)
  assert.ok(failures.some((f) => f.code === 'entry-missing' && f.entry === 'manifest-declaration'))
})

test('收窄执行端被拒：endpoints-shrunk；扩展端点放行', () => {
  const shrunk = mutateEntry('page-sdk', (e) => {
    e.endpoints = e.endpoints.filter((x) => x !== 'settings-page')
  })
  assert.ok(
    compareEntries(BASELINE.entries, shrunk, CTX).some((f) => f.code === 'endpoints-shrunk' && f.entry === 'page-sdk'),
  )
  const extended = mutateEntry('page-sdk', (e) => {
    e.endpoints = ['editor-page', 'settings-page', 'host']
  })
  assert.deepEqual(compareEntries(BASELINE.entries, extended, CTX), [])
})

test('实验分层降级被拒：layer-downgraded（experimental 不随弃用期限承诺）', () => {
  const downgraded = mutateEntry('views-editor', (e) => {
    e.layer = 'experimental'
    e.experimentalEntry = 'cm6'
  })
  assert.ok(compareEntries(BASELINE.entries, downgraded, CTX).some((f) => f.code === 'layer-downgraded' && f.entry === 'views-editor'))
})

test('改变目标语义被拒：purpose-changed（目标文本冻结，改写走显式重锚定）', () => {
  const changed = mutateEntry('manifest-declaration', (e) => {
    e.purpose = e.purpose + '（收窄：不再保留状态）'
  })
  assert.ok(compareEntries(BASELINE.entries, changed, CTX).some((f) => f.code === 'purpose-changed' && f.entry === 'manifest-declaration'))
})

test('改变故障语义被拒：semantics-text-changed（errors 文本改写）', () => {
  const changed = mutateEntry('manifest-declaration', (e) => {
    e.semantics.errors = '一种拒绝（收窄）'
  })
  assert.ok(
    compareEntries(BASELINE.entries, changed, CTX).some((f) => f.code === 'semantics-text-changed' && f.entry === 'manifest-declaration'),
  )
})

test('收回语义字段被拒：semantics-field-retracted；新增语义字段放行', () => {
  const retracted = mutateEntry('views-editor', (e) => {
    delete e.semantics.history
  })
  assert.ok(
    compareEntries(BASELINE.entries, retracted, CTX).some((f) => f.code === 'semantics-field-retracted' && f.entry === 'views-editor'),
  )
  const extended = mutateEntry('manifest-declaration', (e) => {
    e.semantics.coordinates = 'LF 全文偏移'
  })
  assert.deepEqual(compareEntries(BASELINE.entries, extended, CTX), [])
})

test('收回签名源被拒：signature-source-retracted（删符号或换模块均为收窄）', () => {
  const removed = mutateEntry('compatibility', (e) => {
    e.signatures[0].symbols = e.signatures[0].symbols.filter((s) => s !== 'checkAddonCompatibility')
  })
  assert.ok(
    compareEntries(BASELINE.entries, removed, CTX).some((f) => f.code === 'signature-source-retracted' && f.entry === 'compatibility'),
  )
  const moved = mutateEntry('compatibility', (e) => {
    e.signatures[0].module = 'src/shared/otherModule.ts'
  })
  assert.ok(
    compareEntries(BASELINE.entries, moved, CTX).some((f) => f.code === 'signature-source-retracted' && f.entry === 'compatibility'),
  )
})

test('收回测试关联被拒：verification-retracted（类型通过不代替行为验证）', () => {
  const shrunk = mutateEntry('behaviors-register', (e) => {
    e.verification = e.verification.filter((v) => !v.includes('T07'))
  })
  assert.ok(
    compareEntries(BASELINE.entries, shrunk, CTX).some((f) => f.code === 'verification-retracted' && f.entry === 'behaviors-register'),
  )
})

test('条目跨组迁移被拒：group-changed（重划须核对历史归属）', () => {
  const moved = mutateEntry('official-registry', (e) => {
    e.group = 'settings'
  })
  assert.ok(compareEntries(BASELINE.entries, moved, CTX).some((f) => f.code === 'group-changed' && f.entry === 'official-registry'))
})

// ---------------------------------------------------------------------------
// 2. 发行台账：历史不可改写 + 双门槛弃用期限
// ---------------------------------------------------------------------------

test('台账历史被当前树改写被拒：release-history-mutated（改状态/改日期/删版本）', () => {
  const statusRewritten = structuredClone(BASELINE.releases)
  statusRewritten[0].status = 'released'
  assert.ok(compareReleases(BASELINE.releases, statusRewritten, CTX).some((f) => f.code === 'release-history-mutated'))

  const dated = structuredClone(BASELINE.releases)
  dated[0].releasedAt = '2026-01-01'
  assert.ok(compareReleases(BASELINE.releases, dated, CTX).some((f) => f.code === 'release-history-mutated'))

  const deleted = BASELINE.releases.slice(1)
  assert.ok(compareReleases(BASELINE.releases, deleted, CTX).some((f) => f.code === 'release-history-mutated'))
})

test('台账追加新版本放行（正常演进；新版本自身受自洽与期限校验约束）', () => {
  const grown = [
    ...structuredClone(BASELINE.releases),
    { version: '1.1.0', status: 'candidate', summary: '新增', experimental: [] },
  ]
  assert.deepEqual(compareReleases(BASELINE.releases, grown, CTX), [])
})

test('提前移除被拒：removed-without-deprecation（无弃用先行）', () => {
  const releases = [
    { version: '1.0.0', status: 'released', releasedAt: '2026-01-01', summary: 'a', experimental: [] },
    { version: '1.3.0', status: 'removed', releasedAt: '2026-06-01', summary: 'b', experimental: [] },
  ]
  assert.ok(
    validateRemovalDeadlines(releases, '2026-06-01', CTX).some((f) => f.code === 'removed-without-deprecation'),
  )
})

test('提前移除被拒：removal-too-early（次版本足够但天数不足——两项须同时满足）', () => {
  const releases = [
    { version: '1.0.0', status: 'released', releasedAt: '2026-01-01', summary: 'a', experimental: [] },
    { version: '1.1.0', status: 'deprecated', releasedAt: '2026-05-01', summary: '弃用', experimental: [] },
    { version: '1.2.0', status: 'released', releasedAt: '2026-05-15', summary: 'b', experimental: [] },
    { version: '1.3.0', status: 'released', releasedAt: '2026-05-28', summary: 'c', experimental: [] },
    { version: '1.4.0', status: 'removed', releasedAt: '2026-05-29', summary: 'd', experimental: [] },
  ]
  const failures = validateRemovalDeadlines(releases, '2026-05-29', CTX)
  assert.ok(failures.some((f) => f.code === 'removal-too-early'))
  assert.ok(!failures.some((f) => f.code === 'removal-minor-span-insufficient'))
})

test('提前移除被拒：removal-minor-span-insufficient（天数足够但次版本不足）', () => {
  const releases = [
    { version: '1.0.0', status: 'released', releasedAt: '2026-01-01', summary: 'a', experimental: [] },
    { version: '1.1.0', status: 'deprecated', releasedAt: '2026-01-02', summary: '弃用', experimental: [] },
    { version: '1.1.1', status: 'released', releasedAt: '2026-02-01', summary: '补丁', experimental: [] },
    { version: '1.2.0', status: 'removed', releasedAt: '2026-03-01', summary: 'd', experimental: [] },
  ]
  const failures = validateRemovalDeadlines(releases, '2026-03-01', CTX)
  assert.ok(failures.some((f) => f.code === 'removal-minor-span-insufficient'))
  assert.ok(!failures.some((f) => f.code === 'removal-too-early'), '补丁版本不计入次版本跨度，但天数门槛单独满足')
})

test('候选版本不计入次版本跨度（未发行不伪造历程）', () => {
  const releases = [
    { version: '1.0.0', status: 'released', releasedAt: '2026-01-01', summary: 'a', experimental: [] },
    { version: '1.1.0', status: 'deprecated', releasedAt: '2026-01-02', summary: '弃用', experimental: [] },
    { version: '1.2.0', status: 'candidate', summary: '候选不算已发行', experimental: [] },
    { version: '1.3.0', status: 'candidate', summary: '候选不算已发行', experimental: [] },
    { version: '1.4.0', status: 'removed', releasedAt: '2026-03-01', summary: 'd', experimental: [] },
  ]
  assert.ok(
    validateRemovalDeadlines(releases, '2026-03-01', CTX).some((f) => f.code === 'removal-minor-span-insufficient'),
  )
})

test('移除版本自身不计入次版本跨度（等待期不能由执行移除的版本自己充当）', () => {
  const releases = [
    { version: '1.0.0', status: 'released', releasedAt: '2026-01-01', summary: 'a', experimental: [] },
    { version: '1.1.0', status: 'deprecated', releasedAt: '2026-01-02', summary: '弃用', experimental: [] },
    { version: '1.2.0', status: 'released', releasedAt: '2026-01-15', summary: 'b', experimental: [] },
    { version: '1.3.0', status: 'removed', releasedAt: '2026-02-20', summary: 'c', experimental: [] },
  ]
  const failures = validateRemovalDeadlines(releases, '2026-02-20', CTX)
  assert.ok(!failures.some((f) => f.code === 'removal-too-early'), '天数 49 已满足')
  assert.ok(
    failures.some((f) => f.code === 'removal-minor-span-insufficient'),
    '弃用后仅 1.2.0 一个后续次版本（1.3.0 是移除版本自身，不计入）',
  )
})

test('双门槛同时满足时移除放行（>= 30 天且 >= 2 个后续已发行次版本）', () => {
  const releases = [
    { version: '1.0.0', status: 'released', releasedAt: '2026-01-01', summary: 'a', experimental: [] },
    { version: '1.1.0', status: 'deprecated', releasedAt: '2026-01-02', summary: '弃用并给出替代', experimental: [] },
    { version: '1.2.0', status: 'released', releasedAt: '2026-02-01', summary: 'b', experimental: [] },
    { version: '1.3.0', status: 'released', releasedAt: '2026-03-01', summary: 'c', experimental: [] },
    { version: '1.4.0', status: 'removed', releasedAt: '2026-04-01', summary: 'd', experimental: [] },
  ]
  assert.deepEqual(validateRemovalDeadlines(releases, '2026-04-01', CTX), [])
})

test('台账版本号非法被拒：ledger-version-malformed（不把 Vsidian 本体版本当 API 跨度）', () => {
  const releases = [{ version: '0.11.0-vscode', status: 'candidate', summary: 'a', experimental: [] }]
  assert.ok(validateRemovalDeadlines(releases, '2026-04-01', CTX).some((f) => f.code === 'ledger-version-malformed'))
})

// ---------------------------------------------------------------------------
// 3. 签名文本与验证关联
// ---------------------------------------------------------------------------

test('签名声明文本收窄被拒：signature-declaration-changed', () => {
  const module = 'src/shared/addonIdentity.ts'
  const symbol = 'ADDON_IDENTITY_MANIFEST_VERSION'
  const original = BASELINE.declarations[module][symbol]
  const extracted = new Map([[module, new Map([[symbol, original.replace('= 1', '= 2')]])]])
  assert.ok(
    checkSignatureTexts(BASELINE, extracted, CTX).some((f) => f.code === 'signature-declaration-changed' && f.entry !== null),
  )
})

test('签名符号消失被拒：signature-symbol-missing（模块或符号不可得）', () => {
  const module = 'src/shared/addonSettings.ts'
  const symbol = 'AddonSettingValue'
  const extracted = new Map([[module, new Map()]])
  const failures = checkSignatureTexts(BASELINE, extracted, CTX)
  assert.ok(failures.some((f) => f.code === 'signature-symbol-missing' && f.target === symbol))
})

test('验证关联文件缺失被拒：verification-file-missing（删测试不能消除语义关联）', () => {
  const failures = checkVerificationFiles('/definitely/not/a/real/root', BASELINE.entries, CTX)
  assert.ok(failures.length > 0)
  assert.ok(failures.every((f) => f.code === 'verification-file-missing'))
})

test('真实仓库树的验证关联文件全部在场（正向基准）', () => {
  assert.deepEqual(checkVerificationFiles(REPO_ROOT, BASELINE.entries, CTX), [])
})

// ---------------------------------------------------------------------------
// 4. API 版本绑定（独立 API 版本，不按 Vsidian 本体版本计算）
// ---------------------------------------------------------------------------

test('宿主 API 版本不在台账被拒：api-version-not-in-ledger', () => {
  assert.ok(checkApiVersionBinding('2.5.0', BASELINE.releases, CTX).some((f) => f.code === 'api-version-not-in-ledger'))
})

test('台账超前宿主实现被拒：ledger-ahead-of-host（文档不得声称宿主未提供的面）', () => {
  const releases = [
    ...structuredClone(BASELINE.releases),
    { version: '1.1.0', status: 'candidate', summary: '超前', experimental: [] },
  ]
  assert.ok(checkApiVersionBinding('1.0.0', releases, CTX).some((f) => f.code === 'ledger-ahead-of-host'))
})

test('宿主版本与台账一致时零失败（正向基准）', () => {
  assert.deepEqual(checkApiVersionBinding('1.0.0', BASELINE.releases, CTX), [])
})

// ---------------------------------------------------------------------------
// 5. 可信基线验证：bootstrap（真实仓库 git 锚定）
// ---------------------------------------------------------------------------

test('真实 bootstrap 基线经 git 对象复验一致（锚定内容零差异）', async () => {
  const failures = await verifyAddonApiBaseline(BASELINE, realGitAccess(REPO_ROOT), CTX)
  assert.deepEqual(failures, [])
})

test('篡改基线条目被拒：baseline-entry-extra / baseline-entry-missing / 字段漂移', async () => {
  const extra = structuredClone(BASELINE)
  const ghost = structuredClone(extra.entries[0])
  ghost.id = 'ghost-entry-not-in-anchor'
  extra.entries.push(ghost)
  assert.ok((await verifyAddonApiBaseline(extra, realGitAccess(REPO_ROOT), CTX)).some((f) => f.code === 'baseline-entry-extra'))

  const missing = structuredClone(BASELINE)
  missing.entries = missing.entries.slice(1)
  assert.ok((await verifyAddonApiBaseline(missing, realGitAccess(REPO_ROOT), CTX)).some((f) => f.code === 'baseline-entry-missing'))

  const drifted = structuredClone(BASELINE)
  drifted.entries[0].purpose = '被当前树改写的基线'
  assert.ok((await verifyAddonApiBaseline(drifted, realGitAccess(REPO_ROOT), CTX)).some((f) => f.code === 'baseline-entry-field-mismatch'))
})

test('篡改基线声明文本被拒：baseline-declaration-mismatch', async () => {
  const tampered = structuredClone(BASELINE)
  const module = 'src/shared/addonIdentity.ts'
  tampered.declarations[module][Object.keys(tampered.declarations[module])[0]] = 'export const __tampered = 1'
  assert.ok(
    (await verifyAddonApiBaseline(tampered, realGitAccess(REPO_ROOT), CTX)).some((f) => f.code === 'baseline-declaration-mismatch'),
  )
})

test('篡改基线台账快照被拒：baseline-release-mismatch（含日期伪造）', async () => {
  const tampered = structuredClone(BASELINE)
  tampered.releases[0].releasedAt = '2026-01-01'
  assert.ok((await verifyAddonApiBaseline(tampered, realGitAccess(REPO_ROOT), CTX)).some((f) => f.code === 'baseline-release-mismatch'))
})

test('锚点不可达不被静默接受：baseline-anchor-unreachable（无 git / 浅克隆 / 伪造 SHA）', async () => {
  const broken = {
    showCommitFile: () => null,
    resolveCommit: () => null,
  }
  const failures = await verifyAddonApiBaseline(BASELINE, broken, CTX)
  assert.ok(failures.some((f) => f.code === 'baseline-anchor-unreachable'))
  assert.ok(failures.length > 0, 'git 数据不可用必须失败，不得降级通过')
})

test('伪造发行锚点被拒：bootstrap 基线声称 release 模式须有真实 tag 与台账发行记录', async () => {
  const fake = structuredClone(BASELINE)
  fake.meta.mode = 'release'
  fake.meta.anchor = {
    kind: 'tag',
    tag: 'api-1.0.0',
    sha: BASELINE.meta.anchor.sha,
    apiVersion: '1.0.0',
    releasedAt: '2026-01-01',
  }
  const failures = await verifyAddonApiBaseline(fake, realGitAccess(REPO_ROOT), CTX)
  assert.ok(failures.length > 0, '未真实发行的版本不得伪造 release 锚点（tag 不存在或台账非 released）')
})

// ---------------------------------------------------------------------------
// 6. 隔离 Git fixture：bootstrap 与 release 两条路径的独立证据
//    （fixture 仓库内的标签一律 fixture/ 前缀——不把测试标签当真实 SDK 发行）
// ---------------------------------------------------------------------------

const FIXTURE_TAG = 'fixture/api-1.0.0'

/** 最小可编译清单 fixture（运行时值即可——快照派生不依赖类型层） */
function fixtureCatalogText(released) {
  const releases = released
    ? `[{ version: '1.0.0', status: 'released', releasedAt: '2026-01-01', summary: 'fixture 发行', experimental: [] }]`
    : `[{ version: '1.0.0', status: 'candidate', summary: 'fixture 候选', experimental: [] }]`
  return `
export const ADDON_API_GROUPS = [
  { id: 'discovery', title: '发现与安装', scope: 'fixture', order: 1 },
]
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
export const ADDON_API_RELEASES = ${releases}
export const ADDON_API_REMOVAL_RULE = 'fixture 移除规则'
export function validateAddonApiCatalog() {
  return []
}
`
}

function initFixtureRepo(catalogText) {
  const dir = mkdtempSync(path.join(tmpdir(), 'vsidian-t14-fixture-'))
  const git = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git(['init', '-q'])
  const files = {
    'src/shared/addonApiCatalog.ts': catalogText,
    'src/shared/fixtureDemo.ts': 'export function fixtureDemoApi(): void {}\n',
    'test/unit/fixtureDemo.test.ts': '// fixture 验证文件\n',
  }
  for (const [rel, content] of Object.entries(files)) {
    const to = path.join(dir, rel)
    mkdirSync(path.dirname(to), { recursive: true })
    writeFileSync(to, content, 'utf8')
  }
  git(['add', '.'])
  git(['-c', 'user.name=t14-fixture', '-c', 'user.email=t14@fixture.invalid', 'commit', '-q', '-m', 'fixture baseline anchor'])
  return { dir, sha: git(['rev-parse', 'HEAD']).trim() }
}

test('bootstrap 路径（隔离 git 仓库）：从提交锚点发射基线并复验通过；基线被改则失败', async () => {
  const { dir, sha } = initFixtureRepo(fixtureCatalogText(false))
  try {
    const access = realGitAccess(dir)
    const baseline = await emitAddonApiBaseline({
      gitAccess: access,
      mode: 'bootstrap',
      anchorRef: sha,
      baselineVersion: 'fixture-bootstrap-1',
      guardManifest: { requiredFiles: [] },
    })
    assert.equal(baseline.meta.mode, 'bootstrap')
    assert.equal(baseline.meta.anchor.kind, 'commit')
    assert.equal(baseline.meta.anchor.sha, sha)
    assert.deepEqual(await verifyAddonApiBaseline(baseline, access, CTX), [])

    const tampered = structuredClone(baseline)
    tampered.entries[0].purpose = '篡改后的目标'
    assert.ok(
      (await verifyAddonApiBaseline(tampered, access, CTX)).some((f) => f.code === 'baseline-entry-field-mismatch'),
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('release 路径（隔离 git 仓库，fixture/ 前缀标签）：tag 锚点发行基线复验通过；tag 重打或日期伪造则失败', async () => {
  const { dir, sha } = initFixtureRepo(fixtureCatalogText(true))
  try {
    const git = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    git(['tag', FIXTURE_TAG])
    const access = realGitAccess(dir)
    const baseline = await emitAddonApiBaseline({
      gitAccess: access,
      mode: 'release',
      anchorRef: FIXTURE_TAG,
      apiVersion: '1.0.0',
      baselineVersion: 'fixture-api-1.0.0',
      guardManifest: { requiredFiles: [] },
    })
    assert.equal(baseline.meta.mode, 'release')
    assert.equal(baseline.meta.anchor.kind, 'tag')
    assert.equal(baseline.meta.anchor.sha, sha)
    assert.equal(baseline.meta.anchor.releasedAt, '2026-01-01')
    assert.deepEqual(await verifyAddonApiBaseline(baseline, access, CTX), [])

    // 基线日期被改（伪造发行时间）→ 与锚点台账不一致
    const dateFaked = structuredClone(baseline)
    dateFaked.meta.anchor.releasedAt = '2025-01-01'
    assert.ok(
      (await verifyAddonApiBaseline(dateFaked, access, CTX)).some((f) => f.code === 'baseline-release-date-mismatch'),
    )

    // tag 被删（锚点不可达）→ 不静默接受
    git(['tag', '-d', FIXTURE_TAG])
    assert.ok(
      (await verifyAddonApiBaseline(baseline, access, CTX)).some((f) => f.code === 'baseline-tag-unreachable'),
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('release 锚点指向的台账版本未真实发行被拒：baseline-release-not-released', async () => {
  const { dir } = initFixtureRepo(fixtureCatalogText(false))
  try {
    const git = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    git(['tag', FIXTURE_TAG])
    const access = realGitAccess(dir)
    const baseline = await emitAddonApiBaseline({
      gitAccess: access,
      mode: 'release',
      anchorRef: FIXTURE_TAG,
      apiVersion: '1.0.0',
      baselineVersion: 'fixture-api-1.0.0',
      guardManifest: { requiredFiles: [] },
    })
    assert.ok(
      (await verifyAddonApiBaseline(baseline, access, CTX)).some((f) => f.code === 'baseline-release-not-released'),
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 7. 候选树编排（sim tree 集成：端到端负向矩阵）
// ---------------------------------------------------------------------------

/** 临时候选树文件清单：检查器消费的候选面（清单 + 全部签名源 + 验证关联 + 指南 + 完整性清单） */
function simTreeFiles() {
  const files = new Set(['package.json', 'docs/addons/api-reference.md'])
  for (const f of BASELINE.guardManifest.requiredFiles) files.add(f.path)
  for (const m of Object.keys(BASELINE.declarations)) files.add(m)
  for (const e of BASELINE.entries) for (const v of e.verification) files.add(v)
  return [...files]
}

function buildSimTree() {
  const sim = mkdtempSync(path.join(tmpdir(), 'vsidian-t14-sim-'))
  for (const rel of simTreeFiles()) {
    const to = path.join(sim, rel)
    mkdirSync(path.dirname(to), { recursive: true })
    cpSync(path.join(REPO_ROOT, rel), to)
  }
  return sim
}

/** 删除清单条目对象整块（括号配平；目录内条目间的独立注释行保留，语法不破坏） */
function deleteCatalogEntry(id) {
  const file = path.join(deleteCatalogEntry.root, 'src/shared/addonApiCatalog.ts')
  const lines = readFileSync(file, 'utf8').split('\n')
  const start = lines.findIndex((l) => l.includes(`id: '${id}'`))
  if (start < 0) throw new Error(`候选树应含条目 ${id}`)
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

async function runOnSimTree(sim, extra = {}) {
  const reportPath = path.join(sim, '.t14-report.json')
  const report = await runAddonApiCompatCheck({
    root: sim,
    baselinePath: BASELINE_PATH,
    reportPath,
    ...extra,
  })
  return { report, reportPath, written: existsSync(reportPath) }
}

/** sim 树文本变异辅助：归一 CRLF 后读写（磁盘 Windows 检出为 CRLF，基线与提取器字节为 LF） */
function readSimText(sim, rel) {
  return readFileSync(path.join(sim, rel), 'utf8').replace(/\r\n/g, '\n')
}

function writeSimText(sim, rel, text) {
  writeFileSync(path.join(sim, rel), text, 'utf8')
}

test('恢复态（候选树与真实仓库同源）→ 全检查通过且报告落盘', async () => {
  const sim = buildSimTree()
  try {
    const { report, written } = await runOnSimTree(sim)
    assert.equal(report.ok, true, JSON.stringify(report.failures, null, 2))
    assert.ok(written)
    assert.ok(report.checks.length >= 8, '检查分项应覆盖自洽/条目/台账/期限/签名/关联/版本/参考/完整性')
  } finally {
    rmSync(sim, { recursive: true, force: true })
  }
})

test('删除接口 → 端到端拦截（entry-missing；报告 ok=false）', async () => {
  const sim = buildSimTree()
  try {
    deleteCatalogEntry.root = sim
    deleteCatalogEntry('manifest-declaration')
    const { report } = await runOnSimTree(sim)
    assert.equal(report.ok, false)
    assert.ok(report.failures.some((f) => f.code === 'entry-missing' && f.entry === 'manifest-declaration'))
  } finally {
    rmSync(sim, { recursive: true, force: true })
  }
})

test('收窄签名声明文本 → 端到端拦截（signature-declaration-changed）', async () => {
  const sim = buildSimTree()
  try {
    const module = 'src/shared/addonIdentity.ts'
    const text = readSimText(sim, module)
    const decl = BASELINE.declarations[module]['ADDON_IDENTITY_MANIFEST_VERSION']
    assert.ok(decl.includes('= 1'))
    writeSimText(sim, module, text.replace(decl, decl.replace('= 1', '= 2')))
    const { report } = await runOnSimTree(sim)
    assert.ok(report.failures.some((f) => f.code === 'signature-declaration-changed'))
    assert.equal(report.ok, false)
  } finally {
    rmSync(sim, { recursive: true, force: true })
  }
})

test('改变目标语义 → 端到端拦截（purpose-changed 经 esbuild 加载真实清单）', async () => {
  const sim = buildSimTree()
  try {
    const text = readSimText(sim, 'src/shared/addonApiCatalog.ts')
    const purpose = byId(BASELINE.entries, 'manifest-declaration').purpose
    assert.ok(text.includes(purpose))
    writeSimText(sim, 'src/shared/addonApiCatalog.ts', text.replace(purpose, `${purpose}（收窄）`))
    const { report } = await runOnSimTree(sim)
    assert.ok(report.failures.some((f) => f.code === 'purpose-changed' && f.entry === 'manifest-declaration'))
    assert.equal(report.ok, false)
  } finally {
    rmSync(sim, { recursive: true, force: true })
  }
})

test('未发布候选在候选树冒充发行 → 拦截（catalog-selfcheck：候选携带日期）', async () => {
  const sim = buildSimTree()
  try {
    const text = readSimText(sim, 'src/shared/addonApiCatalog.ts')
    writeSimText(
      sim,
      'src/shared/addonApiCatalog.ts',
      text.replace("version: '1.0.0',\n    status: 'candidate',", "version: '1.0.0',\n    status: 'candidate',\n    releasedAt: '2026-01-01',"),
    )
    const { report } = await runOnSimTree(sim)
    assert.ok(report.failures.some((f) => f.code === 'catalog-selfcheck'))
    assert.equal(report.ok, false)
  } finally {
    rmSync(sim, { recursive: true, force: true })
  }
})

test('删除验证关联测试文件 → 端到端拦截（verification-file-missing）', async () => {
  const sim = buildSimTree()
  try {
    rmSync(path.join(sim, 'test/unit/addonIdentity.test.ts'))
    const { report } = await runOnSimTree(sim)
    assert.ok(report.failures.some((f) => f.code === 'verification-file-missing'))
    assert.equal(report.ok, false)
  } finally {
    rmSync(sim, { recursive: true, force: true })
  }
})

test('遗漏开发指南 → 端到端拦截（guard-file-missing）', async () => {
  const sim = buildSimTree()
  try {
    rmSync(path.join(sim, 'docs/addons/developer-guide.md'))
    const { report } = await runOnSimTree(sim)
    assert.ok(report.failures.some((f) => f.code === 'guard-file-missing'))
    assert.equal(report.ok, false)
  } finally {
    rmSync(sim, { recursive: true, force: true })
  }
})

test('参考文档漂移 → 端到端拦截（reference-stale）', async () => {
  const sim = buildSimTree()
  try {
    const file = path.join(sim, 'docs/addons/api-reference.md')
    writeFileSync(file, readFileSync(file, 'utf8') + '\n手改的漂移内容\n')
    const { report } = await runOnSimTree(sim)
    assert.ok(report.failures.some((f) => f.code === 'reference-stale'))
    assert.equal(report.ok, false)
  } finally {
    rmSync(sim, { recursive: true, force: true })
  }
})

test('签名符号从事实源消失 → 端到端拦截（signature-symbol-missing）', async () => {
  const sim = buildSimTree()
  try {
    const module = 'src/shared/addonSettings.ts'
    const text = readSimText(sim, module)
    const decl = BASELINE.declarations[module]['AddonSettingValue']
    writeSimText(sim, module, text.replace(decl, ''))
    const { report } = await runOnSimTree(sim)
    assert.ok(report.failures.some((f) => f.code === 'signature-symbol-missing' && f.target === 'AddonSettingValue'))
    assert.equal(report.ok, false)
  } finally {
    rmSync(sim, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// 8. 工具标识
// ---------------------------------------------------------------------------

test('工具标识稳定（CI job 与报告消费的契约）', () => {
  assert.equal(TOOL_ID, 'checkAddonApiCompat')
})
