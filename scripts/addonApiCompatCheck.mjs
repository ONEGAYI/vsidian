// 附加组件 API 契约门禁检查器（#363 T14）：以**独立历史基线**（git 锚定的
// 公开 API 语义清单 + 签名声明快照 + 发行台账快照）对照候选分支，拦截
// 「删接口 / 收窄签名与语义 / 改写台账历史 / 提前移除弃用接口 / 文档漂移」
// 的破坏与规避组合。
//
// 本模块是纯逻辑 + 编排（可被 node --test import，CLI 壳在
// scripts/checkAddonApiCompat.mjs——与 styleContractCheck / checkStyleContract
// 同分层先例）。基线数据：test/addon-api/baseline-bootstrap-1.json。
//
// 可信基线规则（票面 #363）：
// - **先验证历史基线的 Git 发行锚点 / 声明 / 语义与发布日期，再运行兼容检查**
//   （CI 步骤序：--verify-baseline 在全检查之前——先证检查器可信，再信检查结果）；
// - 基线独立于当前声明：条目 / 签名文本 / 台账快照一律从 git 对象
//   （`git show <sha>:<path>`）重新派生比对，不信任候选树文件；
// - **首个真实发行前采用显式初始基线（bootstrap）模式，不伪造已发布锚点**：
//   bootstrap 锚点是提交（T13 落地树），release 锚点是发行 tag + 台账 released
//   记录 + 实际发布日期；两者都经隔离 git fixture 独立验证；
// - 无基线、浅克隆（锚点对象不可达）、不可证实的日期或被当前树修改的基线
//   一律失败，不静默接受（fail-closed）。
//
// 类型 + 语义双检查（票面口径「类型通过不代替行为兼容」）：
// - 签名源收回与声明文本变化（signature-*，类型/签名级）；
// - 目标 / 模式 / 坐标 / 生命周期 / 历史 / 错误 / 自动规则语义字段收回或改写
//   （purpose-changed / semantics-*，行为级）——语义文本即契约，改写须显式
//   重锚定基线并独立评审，不得静默收窄；
// - 测试关联（verification）与语义一起检查：关联收回或关联文件缺失均失败。
//
// 弃用期限双门槛（ADDON_API_REMOVAL_RULE）：移除须「距弃用版本实际发布满
// 30 天」且「弃用版本之后已发行 >= 2 个后续 API 次版本」**两项同时满足**；
// 版本跨度按独立 API 版本（台账）计算，不读 Vsidian 本体版本与 CHANGELOG。
//
// 诚实边界（同 styleContractCheck）：候选同时改检查器 / 基线 / 工作流可绕过
// 本地防线——对抗该组合是远端必需检查 + PR 审查的职责（见
// docs/specs/addons-api-gate.md）。全程无网络请求。
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// 复用 CSS 门禁的已测工具（semver 比较 / 日期差 / 完整性清单检查同型）
import { compareSemver, daysBetween, checkGuardManifest as cssCheckGuardManifest } from './styleContractCheck.mjs'
// 复用 T13 生成器的已测工具（符号声明提取 / 签名源汇总 / 候选加载 / 参考渲染）
import { extractSymbolDeclarations, collectSignatureSources, loadSignatures, buildApiReferenceMarkdown } from './genAddonApiRef.mjs'

export const TOOL_ID = 'checkAddonApiCompat'

const SELF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 事实源与基线的默认路径（CLI 可覆盖；#135 受保护来源形态同型） */
export const BASELINE_PATH = path.join(SELF_ROOT, 'test/addon-api/baseline-bootstrap-1.json')
const CATALOG_PATH = 'src/shared/addonApiCatalog.ts'
const API_VERSION_MODULE = 'src/shared/addonIdentity.ts'
const API_VERSION_RE = /export const ADDON_API_VERSION = '([^']+)'/
const SEMVER_RE = /^\d+\.\d+\.\d+$/

/** 完整性清单兜底（发射基线时目标文件尚不存在用；已存在基线复用自己的清单） */
export const DEFAULT_GUARD_MANIFEST = {
  requiredFiles: [
    { path: 'src/shared/addonApiCatalog.ts', anchor: 'validateAddonApiCatalog' },
    { path: 'scripts/genAddonApiRef.mjs', anchor: 'buildApiReferenceMarkdown' },
    { path: 'scripts/addonApiCompatCheck.mjs', anchor: 'runAddonApiCompatCheck' },
    { path: 'scripts/checkAddonApiCompat.mjs', anchor: '--emit-baseline' },
    { path: 'test/addonApi/publicApiConsumer.ts', anchor: 'ADDON_API_VERSION' },
    { path: 'test/unit/addonApiSurface.test.ts', anchor: '公开声明消费面' },
    { path: 'test/unit/addonApiRefGen.test.ts', anchor: 'buildApiReferenceMarkdown' },
    { path: 'test/addon-api/checkAddonApiCompat.test.mjs', anchor: 'verifyAddonApiBaseline' },
    { path: 'docs/addons/api-reference.md', anchor: '禁止手改' },
    { path: 'docs/addons/developer-guide.md', anchor: 'Vsidian 附加组件开发指南' },
    { path: 'docs/addons/example-repo-plan.md', anchor: '独立示例附加组件仓库' },
    { path: 'test/fixtures/addon-v02/sdk/vsidian-addon-sdk.d.ts', anchor: 'defineAddonPage' },
  ],
}

// ---------------------------------------------------------------------------
// 失败构造（沿用 CSS 门禁四元组：入口 / 历史来源 / 候选版本 / 证据）
// ---------------------------------------------------------------------------

function fail(ctx, code, message, entryMeta, evidence) {
  return {
    code,
    message,
    entry: entryMeta?.id ?? null,
    target: entryMeta?.target ?? null,
    source: `baseline ${ctx.baselineLabel}`,
    candidateVersion: ctx.apiVersion ?? ctx.candidateVersion ?? 'candidate',
    evidence,
  }
}

// ---------------------------------------------------------------------------
// git 访问层（CLI / 演示 / 测试注入同一形状；真实实现限定 cwd，防向上取错仓库）
// ---------------------------------------------------------------------------

/** 真实 git 访问：showCommitFile(sha, path) 与 resolveCommit(ref)；失败返回 null */
export function realGitAccess(root) {
  const run = (args) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  return {
    showCommitFile(sha, p) {
      try {
        return run(['show', `${sha}:${p}`])
      } catch {
        return null
      }
    },
    resolveCommit(ref) {
      try {
        return run(['rev-parse', `${ref}^{commit}`]).trim()
      } catch {
        return null
      }
    },
  }
}

// ---------------------------------------------------------------------------
// 清单编译与快照派生（基线发射 / 基线复验 / 候选加载共用）
// ---------------------------------------------------------------------------

/** 编译自包含清单 TS 文本（git show 输出；addonApiCatalog.ts 无相对导入） */
async function compileCatalogText(text) {
  const esbuild = await import('esbuild')
  const result = await esbuild.build({
    stdin: { contents: text, sourcefile: 'addonApiCatalog.ts', loader: 'ts' },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    write: false,
    logLevel: 'silent',
  })
  const code = result.outputFiles[0].text
  return import(`data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`)
}

/** 加载候选树清单（esbuild stdin 包装导出，resolveDir=root；loadCandidateContract 同型） */
export async function loadCandidateCatalog(root) {
  const esbuild = await import('esbuild')
  const result = await esbuild.build({
    stdin: {
      contents: [
        'export { ADDON_API_GROUPS, ADDON_API_ENTRIES, ADDON_API_RELEASES, ADDON_API_REMOVAL_RULE, validateAddonApiCatalog } from "./src/shared/addonApiCatalog.ts"',
      ].join('\n'),
      resolveDir: root,
      sourcefile: 'addonApiCompatSources.ts',
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    write: false,
    logLevel: 'silent',
  })
  const code = result.outputFiles[0].text
  return import(`data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`)
}

/**
 * 从清单模块派生确定性快照（基线发射与锚定复验共用同一函数——保证
 * 「发射时的派生」与「复验时的派生」字节同构）。experimentalEntry 与
 * releasedAt 未定义时不落键（JSON 往返稳定）。
 */
export function snapshotCatalog(mod) {
  return {
    entries: mod.ADDON_API_ENTRIES.map((e) => ({
      id: e.id,
      group: e.group,
      title: e.title,
      layer: e.layer,
      ...(e.experimentalEntry !== undefined ? { experimentalEntry: e.experimentalEntry } : {}),
      endpoints: [...e.endpoints],
      purpose: e.purpose,
      semantics: Object.fromEntries(Object.entries(e.semantics ?? {})),
      signatures: e.signatures.map((s) => ({ module: s.module, symbols: [...s.symbols] })),
      verification: [...e.verification],
      introduced: e.introduced,
    })),
    releases: mod.ADDON_API_RELEASES.map((r) => ({
      version: r.version,
      status: r.status,
      ...(r.releasedAt !== undefined ? { releasedAt: r.releasedAt } : {}),
      experimental: (r.experimental ?? []).map((x) => ({
        entry: x.entry,
        version: x.version,
        status: x.status,
        ...(x.releasedAt !== undefined ? { releasedAt: x.releasedAt } : {}),
      })),
    })),
  }
}

// ---------------------------------------------------------------------------
// 基线发射（--emit-baseline：从 git 锚点对象确定性生成基线 JSON）
// ---------------------------------------------------------------------------

/**
 * 从 git 锚点发射基线对象。
 * opts：{ gitAccess, mode: 'bootstrap'|'release', anchorRef, apiVersion?,
 *         baselineVersion?, guardManifest?, catalogPath? }
 * bootstrap：锚点为提交（首个真实发行前的显式初始基线，不伪造发行）。
 * release：锚点为发行 tag；台账在锚点处须含 apiVersion 的 released 记录
 * （未真实发行时 releasedAt 为 null——由 verifyAddonApiBaseline 拒绝，不在
 * 发射时静默补日期）。
 */
export async function emitAddonApiBaseline(opts) {
  const { gitAccess, mode = 'bootstrap', anchorRef, apiVersion, baselineVersion, guardManifest = DEFAULT_GUARD_MANIFEST, catalogPath = CATALOG_PATH } = opts
  if (!anchorRef) throw new Error('发射基线需要 anchorRef（--anchor <ref>）')
  if (mode === 'release' && !apiVersion) throw new Error('release 模式发射基线需要 apiVersion（--api-version <semver>）')
  const sha = gitAccess.resolveCommit(anchorRef)
  if (!sha) throw new Error(`锚点引用不可解析：${anchorRef}（git 对象不可达时不得发射基线）`)
  const catalogText = gitAccess.showCommitFile(sha, catalogPath)
  if (catalogText === null) throw new Error(`锚点提交 ${sha.slice(0, 7)} 缺 ${catalogPath}`)
  const mod = await compileCatalogText(catalogText)
  const snap = snapshotCatalog(mod)

  // 签名声明文本：逐模块从锚点对象提取（基线独立于当前树的事实源文件）
  const byModule = collectSignatureSources(snap.entries)
  const declarations = {}
  for (const [module, symbols] of byModule) {
    const text = gitAccess.showCommitFile(sha, module)
    if (text === null) throw new Error(`锚点提交 ${sha.slice(0, 7)} 缺签名源模块 ${module}`)
    const extracted = extractSymbolDeclarations(text, module, [...symbols])
    const missed = [...symbols].filter((s) => !extracted.has(s))
    if (missed.length) throw new Error(`锚点 ${sha.slice(0, 7)} 的 ${module} 缺符号：${missed.join('、')}`)
    declarations[module] = Object.fromEntries([...symbols].map((s) => [s, extracted.get(s)]))
  }

  let anchor
  let note
  if (mode === 'release') {
    const record = mod.ADDON_API_RELEASES.find((r) => r.version === apiVersion)
    anchor = {
      kind: 'tag',
      tag: String(anchorRef),
      sha,
      apiVersion,
      catalogPath,
      releasedAt: record?.status === 'released' ? (record.releasedAt ?? null) : null,
    }
    note = '发行基线：锚点是发行 tag 与台账 released 记录（含实际发布日期）。复验时 tag 指向、台账状态与日期三者都须与 git 对象一致。'
  } else {
    anchor = { kind: 'commit', sha, ref: String(anchorRef), catalogPath }
    note = 'bootstrap 显式初始基线：锚点是提交（不是发行标签），在首个真实发行前建立——不伪造已发布锚点。首个稳定 API 发行时应以 release 模式重新锚定。'
  }

  return {
    meta: {
      tool: TOOL_ID,
      baselineVersion: baselineVersion ?? (mode === 'release' ? `api-${apiVersion}` : 'bootstrap-1'),
      mode,
      anchor,
      note,
      emittedBy: `node scripts/checkAddonApiCompat.mjs --emit-baseline --anchor <ref>${mode === 'release' ? ' --mode release --api-version <semver>' : ''}`,
    },
    entries: snap.entries,
    declarations,
    releases: snap.releases,
    guardManifest,
  }
}

// ---------------------------------------------------------------------------
// 基线信任验证（--verify-baseline：先证检查器可信，再信检查结果）
// ---------------------------------------------------------------------------

/** 两对象的字段级差异键列表（undefined 与缺失视为同一「无」） */
function deepFieldDiff(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  const diffs = []
  for (const k of keys) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) diffs.push(k)
  }
  return diffs
}

/** 台账快照比对：返回差异描述（空数组 = 一致）；发行/额外/缺失/字段漂移统一报告 */
function diffReleaseSnapshots(baseReleases, anchorReleases) {
  const diffs = []
  const anchorByVer = new Map(anchorReleases.map((r) => [r.version, r]))
  const baseVers = new Set(baseReleases.map((r) => r.version))
  for (const r of baseReleases) {
    const a = anchorByVer.get(r.version)
    if (!a) {
      diffs.push(`版本 ${r.version} 不在锚点台账中（基线被增改）`)
      continue
    }
    const fields = deepFieldDiff(a, r)
    if (fields.length) diffs.push(`版本 ${r.version} 字段漂移：${fields.join('、')}`)
  }
  for (const a of anchorReleases) {
    if (!baseVers.has(a.version)) diffs.push(`锚点台账版本 ${a.version} 未在基线登记（基线被删改——丢项即丢保护）`)
  }
  return diffs
}

/**
 * 验证基线可信性：从 git 锚点对象重新派生条目 / 台账 / 声明快照，与基线
 * 文件精确比对；release 模式额外核实 tag 指向与台账发行日期。锚点不可达
 * （无 .git / 浅克隆 / 伪造 SHA / tag 消失）一律失败，不静默接受。
 */
export async function verifyAddonApiBaseline(baseline, gitAccess, ctx = {}) {
  const failures = []
  const vctx = { baselineLabel: baseline.meta?.baselineVersion ?? 'unknown', apiVersion: ctx.apiVersion ?? 'baseline-audit' }
  const anchor = baseline.meta?.anchor ?? {}
  const catalogPath = anchor.catalogPath ?? CATALOG_PATH
  let sha = anchor.sha

  if (anchor.kind === 'tag' || baseline.meta?.mode === 'release') {
    if (!anchor.tag) {
      failures.push(fail(vctx, 'baseline-tag-unreachable', 'release 基线缺少锚点标签', null, '发行锚点必须携带 tag——不可证实的发行状态不得通过'))
      return failures
    }
    const resolved = gitAccess.resolveCommit(anchor.tag)
    if (!resolved) {
      failures.push(fail(vctx, 'baseline-tag-unreachable', `发行锚点标签不可达：${anchor.tag}`, null, '浅克隆、无 .git 或标签不存在时不得静默接受——发行锚点必须可从 git 对象证实'))
      return failures
    }
    if (resolved !== anchor.sha) {
      failures.push(fail(vctx, 'baseline-tag-sha-mismatch', `发行锚点标签指向与基线固化 SHA 不一致（重写 tag）：${anchor.tag}`, null, `基线固化：${anchor.sha}；实际：${resolved}`))
    }
    sha = resolved
  }

  const catalogText = gitAccess.showCommitFile(sha, catalogPath)
  if (catalogText === null) {
    failures.push(fail(vctx, 'baseline-anchor-unreachable', `基线锚点内容不可读：${String(sha).slice(0, 7)}:${catalogPath}`, null, 'git 对象不可达（无 .git / 浅克隆 / 伪造 SHA）时基线不可信，必须失败而非降级'))
    return failures
  }
  const mod = await compileCatalogText(catalogText)
  const snap = snapshotCatalog(mod)

  // 条目集合精确比对（多一条少一条一字段漂移都失败）
  const anchorById = new Map(snap.entries.map((e) => [e.id, e]))
  const baseIds = new Set(baseline.entries.map((e) => e.id))
  for (const e of baseline.entries) {
    const a = anchorById.get(e.id)
    if (!a) {
      failures.push(fail(vctx, 'baseline-entry-extra', `基线条目不在锚点清单中：${e.id}`, { id: e.id, target: e.id }, `锚点 ${String(sha).slice(0, 7)} 无此条目——基线被增改`))
      continue
    }
    const diffs = deepFieldDiff(a, e)
    if (diffs.length) {
      failures.push(fail(vctx, 'baseline-entry-field-mismatch', `基线条目与锚点内容不一致：${e.id}（${diffs.join('、')}）`, { id: e.id, target: e.id }, `锚点 ${String(sha).slice(0, 7)} 的该条目字段与基线文件不同——基线被当前树改写`))
    }
  }
  for (const a of snap.entries) {
    if (!baseIds.has(a.id)) {
      failures.push(fail(vctx, 'baseline-entry-missing', `锚点清单条目未在基线登记：${a.id}`, { id: a.id, target: a.id }, `锚点存在而基线缺失——基线被删改（丢项即丢保护）`))
    }
  }

  // 台账快照比对（含日期伪造）
  const releaseDiffs = diffReleaseSnapshots(baseline.releases ?? [], snap.releases)
  if (releaseDiffs.length) {
    failures.push(fail(vctx, 'baseline-release-mismatch', `基线台账快照与锚点台账不一致：${releaseDiffs[0]}${releaseDiffs.length > 1 ? ` 等 ${releaseDiffs.length} 处` : ''}`, null, `锚点 ${String(sha).slice(0, 7)} 台账与基线文件不同——台账历史（状态/日期/实验清单）不可被当前树改写`))
  }

  // 签名声明文本比对（基线独立于当前树的事实源文件）
  for (const [module, symbols] of Object.entries(baseline.declarations ?? {})) {
    const text = gitAccess.showCommitFile(sha, module)
    if (text === null) {
      failures.push(fail(vctx, 'baseline-declaration-mismatch', `锚点缺签名源模块：${module}`, { id: module, target: module }, `锚点 ${String(sha).slice(0, 7)} 不可读出该模块——基线声明的来源不可证实`))
      continue
    }
    const extracted = extractSymbolDeclarations(text, module, Object.keys(symbols))
    for (const [symbol, stored] of Object.entries(symbols)) {
      if (extracted.get(symbol) !== stored) {
        failures.push(fail(vctx, 'baseline-declaration-mismatch', `基线声明文本与锚点不一致：${module}#${symbol}`, { id: `${module}#${symbol}`, target: symbol }, `锚点 ${String(sha).slice(0, 7)} 的声明文本与基线记录不同——基线被改写`))
      }
    }
  }

  // release 模式：锚点版本在锚点台账中必须真实发行且日期一致
  if (baseline.meta?.mode === 'release' || anchor.kind === 'tag') {
    const record = snap.releases.find((r) => r.version === anchor.apiVersion)
    if (!record || record.status !== 'released') {
      failures.push(fail(vctx, 'baseline-release-not-released', `发行锚点版本在锚点台账中未真实发行：${anchor.apiVersion}`, null, '伪造发行状态被拒——锚点台账须为 released 且携带实际发布日期（候选冒充发行不可通过）'))
    } else if (anchor.releasedAt !== record.releasedAt) {
      failures.push(fail(vctx, 'baseline-release-date-mismatch', `基线发行日期与锚点台账不一致：${anchor.releasedAt} vs ${record.releasedAt}`, null, '日期不可被当前树改写（改日期不能伪造弃用期限）'))
    }
  }
  return failures
}

// ---------------------------------------------------------------------------
// 兼容比较：基线 vs 候选清单（类型 + 语义双检查）
// ---------------------------------------------------------------------------

/**
 * 逐条比较基线与候选条目。候选删除条目（entry-missing——条目永不物理删除，
 * 移除须保留条目并走台账弃用流程）、改组、分层降级、收回执行端 / 签名源 /
 * 语义字段 / 测试关联、改写目标或语义文本，均失败。候选新增条目、扩展执行
 * 端 / 语义字段 / 签名源、experimental 升稳定，允许。title 与 introduced
 * 不参与候选比较（展示与溯源字段，完整性由 --verify-baseline 钉住）。
 */
export function compareEntries(baselineEntries, candidateEntries, ctx) {
  const failures = []
  const byId = new Map(candidateEntries.map((e) => [e.id, e]))
  for (const b of baselineEntries) {
    const c = byId.get(b.id)
    if (!c) {
      failures.push(fail(ctx, 'entry-missing', `基线条目 ${b.id} 在候选清单中不存在`, { id: b.id, target: b.id }, '清单条目永不物理删除——移除须保留条目并走台账弃用流程（30 天 + 两个后续 API 次版本双门槛）'))
      continue
    }
    if (b.group !== c.group) {
      failures.push(fail(ctx, 'group-changed', `条目 ${b.id} 分组变化：${b.group} → ${c.group}`, { id: b.id, target: c.group }, '分组重划须先核对历史基线归属（参考文档章节即入口结构）'))
    }
    if (b.layer !== c.layer) {
      const code = b.layer === 'stable-candidate' && c.layer === 'experimental' ? 'layer-downgraded' : 'layer-changed'
      failures.push(fail(ctx, code, `条目 ${b.id} 分层变化：${b.layer} → ${c.layer}`, { id: b.id, target: c.layer }, '稳定候选降为实验 = 收回弃用期限承诺；分层变化须显式重锚定基线并独立评审'))
    }
    for (const ep of b.endpoints) {
      if (!(c.endpoints ?? []).includes(ep)) {
        failures.push(fail(ctx, 'endpoints-shrunk', `条目 ${b.id} 收回执行端：${ep}`, { id: b.id, target: ep }, `基线承诺执行端：${b.endpoints.join('/')}`)
        )
      }
    }
    if (b.experimentalEntry !== undefined && b.experimentalEntry !== c.experimentalEntry) {
      failures.push(fail(ctx, 'experimental-entry-changed', `条目 ${b.id} 的实验入口声明变化：${b.experimentalEntry} → ${c.experimentalEntry}`, { id: b.id, target: b.experimentalEntry }, '实验入口绑定关系即兼容面'))
    }
    if (b.purpose !== c.purpose) {
      failures.push(fail(ctx, 'purpose-changed', `条目 ${b.id} 的目标语义被改写`, { id: b.id, target: 'purpose' }, '目标文本即契约（做什么 / 不做什么 / 只读目标）——改写须显式重锚定基线并走 API 版本化，不得静默收窄'))
    }
    const cSem = c.semantics ?? {}
    for (const [k, v] of Object.entries(b.semantics ?? {})) {
      if (!(k in cSem)) {
        failures.push(fail(ctx, 'semantics-field-retracted', `条目 ${b.id} 收回语义字段：${k}`, { id: b.id, target: k }, `基线承诺语义字段 ${k}（模式/坐标/LF/生命周期/历史/错误/自动规则之一）`))
      } else if (cSem[k] !== v) {
        failures.push(fail(ctx, 'semantics-text-changed', `条目 ${b.id} 语义字段改写：${k}`, { id: b.id, target: k }, '语义文本即行为契约——类型通过不代替行为兼容；改写须显式重锚定基线并独立评审'))
      }
    }
    const cPairs = new Set((c.signatures ?? []).flatMap((s) => (s.symbols ?? []).map((sym) => `${s.module}#${sym}`)))
    for (const s of b.signatures) {
      for (const sym of s.symbols) {
        if (!cPairs.has(`${s.module}#${sym}`)) {
          failures.push(fail(ctx, 'signature-source-retracted', `条目 ${b.id} 收回签名源：${s.module}#${sym}`, { id: b.id, target: `${s.module}#${sym}` }, '公开声明的签名源（模块 + 符号）只增不减；移除或换位均视同收窄类型面'))
        }
      }
    }
    for (const v of b.verification) {
      if (!(c.verification ?? []).includes(v)) {
        failures.push(fail(ctx, 'verification-retracted', `条目 ${b.id} 收回测试关联：${v}`, { id: b.id, target: v }, '语义承诺钉在测试上（类型通过不代替行为兼容）——收回关联须显式重锚定基线'))
      }
    }
  }
  return failures
}

/** 台账投影（比较用的稳定形状） */
function releaseProjection(r) {
  return JSON.stringify({
    status: r.status,
    releasedAt: r.releasedAt ?? null,
    experimental: (r.experimental ?? []).map((x) => ({ entry: x.entry, version: x.version, status: x.status, releasedAt: x.releasedAt ?? null })),
  })
}

/**
 * 台账历史不可改写：基线登记的版本记录（状态 / 日期 / 实验清单）在候选中
 * 被改写或删除均失败（release-history-mutated）；候选追加新版本允许
 * （新版本自身受清单自洽与弃用期限校验约束）。
 */
export function compareReleases(baselineReleases, candidateReleases, ctx) {
  const failures = []
  const byVer = new Map(candidateReleases.map((r) => [r.version, r]))
  for (const b of baselineReleases) {
    const c = byVer.get(b.version)
    if (!c) {
      failures.push(fail(ctx, 'release-history-mutated', `基线登记的台账版本在候选中消失：${b.version}`, null, `删除已登记版本记录 = 重写 API 历史基线：${releaseProjection(b)}`))
      continue
    }
    if (releaseProjection(b) !== releaseProjection(c)) {
      failures.push(fail(ctx, 'release-history-mutated', `台账版本 ${b.version} 的记录被改写（状态 / 日期 / 实验清单）`, null, `基线固化：${releaseProjection(b)}；候选：${releaseProjection(c)}——改日期或状态不能伪造发行历史`))
    }
  }
  return failures
}

/**
 * 弃用期限双门槛校验（ADDON_API_REMOVAL_RULE 的机械执行）：
 * - removed 版本必须有**已实际发行**（携带日期）的 deprecated 版本先行；
 * - 自弃用版本实际发布日起须满 30 天（removal-too-early）；
 * - 弃用版本之后须已发行 >= 2 个后续 API 次版本（removal-minor-span-
 *   insufficient；补丁与候选不计——未发行不伪造历程）；
 * - 两项门槛须**同时满足**；版本跨度按台账（独立 API 版本）计算，本函数
 *   不读取 Vsidian 本体版本与 CHANGELOG。
 * 到期不自动移除：只判定「声明的移除是否合法」，从不修改清单或台账。
 */
export function validateRemovalDeadlines(releases, now, ctx) {
  const failures = []
  for (const r of releases) {
    if (!SEMVER_RE.test(r.version)) {
      failures.push(fail(ctx, 'ledger-version-malformed', `台账版本号非法：${r.version}`, null, 'API 版本独立于 Vsidian 本体版本，须为标准 semver（x.y.z）'))
    }
  }
  const valid = releases.filter((r) => SEMVER_RE.test(r.version))
  const actuallyReleased = (r) => r.status === 'released' || r.status === 'deprecated' || r.status === 'removed'
  const releasedRecords = valid.filter(actuallyReleased)
  for (const r of valid) {
    if (r.status !== 'removed') continue
    const deps = valid
      .filter((x) => x.status === 'deprecated' && x.releasedAt && compareSemver(x.version, r.version) < 0)
      .sort((a, b) => compareSemver(b.version, a.version))
    const dep = deps[0]
    if (!dep) {
      failures.push(fail(ctx, 'removed-without-deprecation', `版本 ${r.version} 标记移除但没有已发行的弃用版本先行`, null, '移除规则：先发布弃用说明与替代方案（携带实际发布日期），再满足双门槛'))
      continue
    }
    const removalDate = r.releasedAt ?? now
    const days = daysBetween(dep.releasedAt, removalDate)
    if (days < 30) {
      failures.push(fail(ctx, 'removal-too-early', `版本 ${r.version} 移除时距弃用实际发布仅 ${days} 天（须满 30 天）`, null, `弃用版本 ${dep.version} 实际发布于 ${dep.releasedAt}；移除时点 ${removalDate}`))
    }
    const [depMajor, depMinor] = dep.version.split('.').map(Number)
    const minorsAfter = new Set()
    for (const x of releasedRecords) {
      if (compareSemver(x.version, dep.version) <= 0) continue
      const [xMajor, xMinor] = x.version.split('.').map(Number)
      if (xMajor === depMajor && xMinor > depMinor) minorsAfter.add(xMinor)
    }
    if (minorsAfter.size < 2) {
      failures.push(fail(ctx, 'removal-minor-span-insufficient', `版本 ${r.version} 移除前仅经过 ${minorsAfter.size} 个后续已发行次版本（须 >= 2）`, null, `弃用版本 ${dep.version} 之后的已发行次版本：${[...minorsAfter].sort((a, b) => a - b).join('、') || '（无）'}；补丁与候选版本不计入`))
    }
  }
  return failures
}

/**
 * 签名声明文本检查：候选事实源模块中逐符号提取声明文本，与基线记录精确
 * 比对。符号消失（signature-symbol-missing）或文本变化（signature-
 * declaration-changed——参数 / 结果收窄或任何形状变化）均失败；公开签名
 * 在候选冻结后视为契约面，变化须显式重锚定基线并走 API 版本化。
 * extracted 形状：Map<模块, Map<符号, 声明文本>>（genAddonApiRef 同口径）。
 */
export function checkSignatureTexts(baseline, extracted, ctx) {
  const failures = []
  for (const entry of baseline.entries) {
    for (const source of entry.signatures) {
      const modTexts = extracted.get(source.module)
      for (const symbol of source.symbols) {
        const stored = baseline.declarations?.[source.module]?.[symbol]
        const actual = modTexts?.get(symbol)
        if (actual === undefined) {
          failures.push(fail(ctx, 'signature-symbol-missing', `签名符号在候选事实源中缺失：${source.module}#${symbol}`, { id: entry.id, target: symbol }, '公开声明的签名必须真实存在于事实源模块（T13 存在性门禁的同口径负向）'))
        } else if (stored !== undefined && actual !== stored) {
          failures.push(fail(ctx, 'signature-declaration-changed', `签名声明文本与基线不一致：${source.module}#${symbol}`, { id: entry.id, target: symbol }, '签名文本即类型契约（参数 / 结果收窄或任何形状变化）——变化须显式重锚定基线并走 API 版本化'))
        }
      }
    }
  }
  return failures
}

/**
 * 测试关联文件在场检查：条目 verification 声明的测试文件须存在于候选树
 * ——删测试不能消除语义关联（与 CSS 门禁 guardManifest 拦「删旧测试」同型，
 * 这里针对清单声明的关联面）。
 */
export function checkVerificationFiles(root, entries, ctx) {
  const failures = []
  for (const entry of entries) {
    for (const v of entry.verification ?? []) {
      if (!existsSync(path.join(root, v))) {
        failures.push(fail(ctx, 'verification-file-missing', `验证关联文件缺失：${v}`, { id: entry.id, target: v }, '语义承诺钉在测试上——关联文件被删除时承诺失去验证载体'))
      }
    }
  }
  return failures
}

/**
 * API 版本绑定：宿主运行时的 ADDON_API_VERSION（兼容判定用）必须存在于
 * 台账（运行时与文档同源），且台账不得出现超前宿主实现的版本（文档不得
 * 声称宿主未提供的 API 面）。
 */
export function checkApiVersionBinding(apiVersion, releases, ctx) {
  const failures = []
  if (typeof apiVersion !== 'string' || !SEMVER_RE.test(apiVersion)) {
    failures.push(fail(ctx, 'api-version-malformed', `宿主稳定 API 版本非法或不可读：${apiVersion}`, null, `${API_VERSION_MODULE} 的 ADDON_API_VERSION 须为标准 semver（x.y.z）`))
    return failures
  }
  const versions = releases.map((r) => r.version).filter((v) => SEMVER_RE.test(v))
  if (!versions.includes(apiVersion)) {
    failures.push(fail(ctx, 'api-version-not-in-ledger', `宿主 ADDON_API_VERSION ${apiVersion} 不在台账版本中`, null, '运行时兼容判定（addonIdentity.checkAddonCompatibility）与文档台账必须同源——漂移即其中一面在说谎'))
  }
  for (const v of versions) {
    if (compareSemver(v, apiVersion) > 0) {
      failures.push(fail(ctx, 'ledger-ahead-of-host', `台账版本 ${v} 超前宿主实现 ${apiVersion}`, null, '台账先于宿主实现登记更高版本 = 文档声称宿主未提供的面；实现落地后再登记'))
    }
  }
  return failures
}

// ---------------------------------------------------------------------------
// 版本参考新鲜度（check:addonapi 同口径，纳入本门禁链）
// ---------------------------------------------------------------------------

function checkReferenceFreshness(root, candidate, signatures, ctx) {
  const referencePath = path.join(root, 'docs/addons/api-reference.md')
  let current = null
  try {
    current = readFileSync(referencePath, 'utf8').replace(/\r\n/g, '\n')
  } catch {
    current = null
  }
  const content = `${buildApiReferenceMarkdown(
    {
      groups: candidate.ADDON_API_GROUPS,
      entries: candidate.ADDON_API_ENTRIES,
      releases: candidate.ADDON_API_RELEASES,
      removalRule: candidate.ADDON_API_REMOVAL_RULE,
    },
    signatures,
  )}\n`
  if (current !== content) {
    return [fail(ctx, 'reference-stale', '版本参考产物与候选清单不一致：docs/addons/api-reference.md', { id: 'api-reference', target: 'docs/addons/api-reference.md' }, '改清单 / 签名后须重跑 npm run gen:addonapi 并提交产物（check:addonapi 同口径，纳入本门禁链）')]
  }
  return []
}

// ---------------------------------------------------------------------------
// 完整性清单（guardManifest：复用 CSS 门禁已测实现，失败记录归一为本工具口径）
// ---------------------------------------------------------------------------

function checkGuardManifest(root, manifest, ctx) {
  return cssCheckGuardManifest(root, manifest).map((f) => ({ ...f, source: `baseline ${ctx.baselineLabel}`, candidateVersion: ctx.apiVersion }))
}

// ---------------------------------------------------------------------------
// 全套编排
// ---------------------------------------------------------------------------

function today() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * 对候选树执行全套检查，返回结构化报告（exit code 语义：report.ok）。
 * opts：root（默认本仓库）、baselinePath（默认本仓库 bootstrap 基线；
 * CI 可指向受保护来源）、now（期限校验时点）、reportPath（JSON 报告路径）。
 * 分项：catalog-selfcheck（T13 自洽）→ entry-comparison → release-history →
 * removal-deadlines → signatures → verification-files → api-version-binding →
 * reference-freshness → guard-manifest。候选加载失败时依赖分项不执行但
 * 显式记 fail（不隐藏检查；ok 恒 false）。
 */
export async function runAddonApiCompatCheck(opts = {}) {
  const root = path.resolve(opts.root ?? SELF_ROOT)
  const baselinePath = path.resolve(opts.baselinePath ?? BASELINE_PATH)
  const now = opts.now ?? today()
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
  const anchor = baseline.meta?.anchor ?? {}
  const ctx = {
    baselineLabel: `${baseline.meta?.baselineVersion ?? '?'} (${String(anchor.sha ?? '???????').slice(0, 7)})`,
    apiVersion: null,
  }

  const checks = []
  const failures = []
  const warnings = []

  const mark = async (id, fn) => {
    try {
      const r = await fn()
      const flist = Array.isArray(r) ? r : (r?.failures ?? [])
      checks.push({ id, status: flist.length ? 'fail' : 'pass', failures: flist.length })
      failures.push(...flist)
    } catch (err) {
      checks.push({ id, status: 'fail', error: String(err?.message ?? err) })
      failures.push(fail(ctx, `${id}-error`, `分项 ${id} 执行异常：${String(err?.message ?? err)}`, null, '检查器自身异常按失败处理（fail-closed，不降级通过）'))
    }
  }

  // 宿主 API 版本提取（运行时绑定检查的输入）
  let apiVersion = null
  try {
    const m = readFileSync(path.join(root, API_VERSION_MODULE), 'utf8').match(API_VERSION_RE)
    apiVersion = m ? m[1] : null
  } catch {
    apiVersion = null
  }
  ctx.apiVersion = apiVersion ?? 'unknown'

  // 候选清单加载（esbuild 内存编译）
  let candidate = null
  try {
    candidate = await loadCandidateCatalog(root)
    checks.push({ id: 'candidate-catalog', status: 'pass', detail: `${candidate.ADDON_API_ENTRIES.length} 条目 / ${candidate.ADDON_API_GROUPS.length} 组` })
  } catch (err) {
    checks.push({ id: 'candidate-catalog', status: 'fail', error: String(err?.message ?? err) })
    failures.push(fail(ctx, 'candidate-catalog-error', `候选清单加载失败：${String(err?.message ?? err)}`, null, 'esbuild 编译或清单模块结构异常——清单须保持可加载（fail-closed）'))
  }

  if (candidate) {
    await mark('catalog-selfcheck', () =>
      candidate
        .validateAddonApiCatalog(candidate.ADDON_API_GROUPS, candidate.ADDON_API_ENTRIES, candidate.ADDON_API_RELEASES)
        .map((p) => fail(ctx, 'catalog-selfcheck', p, null, '清单自洽校验（T13 validateAddonApiCatalog）在门禁链内失败——含台账诚实性（候选不带日期 / 已发布必有日期）')),
    )
    await mark('entry-comparison', () => compareEntries(baseline.entries, candidate.ADDON_API_ENTRIES, ctx))
    await mark('release-history', () => compareReleases(baseline.releases, candidate.ADDON_API_RELEASES, ctx))
    await mark('removal-deadlines', () => validateRemovalDeadlines(candidate.ADDON_API_RELEASES, now, ctx))
    let signatures = new Map()
    await mark('signatures', async () => {
      const r = await loadSignatures(root, candidate.ADDON_API_ENTRIES)
      signatures = r.signatures
      const fl = []
      for (const [module, symbols] of r.missing) {
        for (const s of symbols) {
          fl.push(fail(ctx, 'signature-symbol-missing', `签名符号在候选事实源中缺失：${module}#${s}`, { id: module, target: s }, '公开声明的签名必须真实存在（T13 存在性门禁的同口径负向）'))
        }
      }
      fl.push(...checkSignatureTexts(baseline, signatures, ctx))
      return fl
    })
    await mark('verification-files', () => checkVerificationFiles(root, candidate.ADDON_API_ENTRIES, ctx))
    await mark('api-version-binding', () => checkApiVersionBinding(apiVersion, candidate.ADDON_API_RELEASES, ctx))
    await mark('reference-freshness', () => checkReferenceFreshness(root, candidate, signatures, ctx))
  } else {
    for (const id of ['catalog-selfcheck', 'entry-comparison', 'release-history', 'removal-deadlines', 'signatures', 'verification-files', 'api-version-binding', 'reference-freshness']) {
      checks.push({ id, status: 'fail', detail: '候选清单未加载（前置失败，显式记败不隐藏）' })
    }
  }
  await mark('guard-manifest', () => checkGuardManifest(root, baseline.guardManifest, ctx))

  const report = {
    ok: failures.length === 0,
    tool: TOOL_ID,
    generatedAt: new Date().toISOString(),
    baseline: {
      version: baseline.meta?.baselineVersion,
      mode: baseline.meta?.mode,
      anchor,
      path: baselinePath,
    },
    candidate: { root, apiVersion },
    now,
    offline: true, // 全程无网络请求
    checks,
    failures,
    warnings,
  }
  if (opts.reportPath) {
    mkdirSync(path.dirname(opts.reportPath), { recursive: true })
    writeFileSync(opts.reportPath, JSON.stringify(report, null, 2), 'utf8')
  }
  return report
}
