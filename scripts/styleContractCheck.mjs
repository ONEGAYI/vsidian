// 历史 CSS 契约兼容检查器（#134）：以**独立历史基线**（固定已发布版本/SHA 的
// 公开样式契约快照）对照候选分支清单，拦截「删除实现、清单、旧测试」的规避
// 组合；并校验弃用期限、指南生成一致性与检查器资产完整性。
//
// 本模块是纯逻辑 + 编排（可被 node --test import）；CLI 壳在
// scripts/checkStyleContract.mjs。基线数据：test/style-contract/baseline-v0.4.0.json
// （来源固定：v0.4.0 tag = 75c3df7…，与 #132 迁移底稿逐字节一致，取证见
// 基线 meta.provenance 与 logs/baseline-freeze-2026-09-27.md）。
//
// 诚实边界（AGENTS「公开样式契约」节）：本工具与基线都在候选分支内运行时，
// 无法对抗「候选同时删除检查器/基线本身」——那是 #135 CI 受保护来源的职责；
// 本模块把接口备好：--baseline/--root/--git-tags 均可指向仓库外受保护来源，
// --verify-baseline 用 git 对象复验基线内容。全程无网络请求（不依赖在线
// 字体服务等任何外部资源可用性）。
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const TOOL_ID = 'checkStyleContract'

const SELF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const SUPPORT_RANK = { direct: 3, semantic: 2, native: 1, none: 0 }

// ---------------------------------------------------------------------------
// 发布数据解析（仓库内可离线取得的「实际发布」证据）
// ---------------------------------------------------------------------------

/** 解析 CHANGELOG 的 `## <semver> - <YYYY-MM-DD>` 版本段；Unreleased 段跳过。
 * 版本号合法但日期栏不是 YYYY-MM-DD 时抛错（静默忽略 = 改日期绕过检测）。 */
export function parseChangelogReleases(md) {
  const releases = {}
  const re = /^## (?:(Unreleased)|(\d+\.\d+\.\d+)) - ([^\n]*)$/gm
  let m
  while ((m = re.exec(md))) {
    if (m[1]) continue
    const [version, date] = [m[2], m[3].trim()]
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
      throw new Error(`CHANGELOG 版本 ${version} 的日期格式非法：${date}（须为 YYYY-MM-DD）`)
    }
    releases[version] = { date }
  }
  return releases
}

/** v0.4.0 映射表行主键规范化：去行首列分隔、定界反引号/删除线与括号注释 */
export function normalizeRowKey(raw) {
  return String(raw)
    .replace(/^\|\s*/, '')
    .trim()
    .replace(/^~~|~~$/g, '')
    .replace(/`/g, '')
    .replace(/（[^）]*）\s*$/, '')
    .trim()
}

/**
 * 解析旧映射表（v0.4.0 形态 docs/design/obsidian-selector-map.md）的表格
 * 主键行：跳过表头（第一列为「本项目稳定类名」「变量」等）与 `---` 分隔行，
 * 返回 [{ raw, key }]。--verify-baseline 用它与基线 sourceRows 做精确集合比对。
 */
export function parseSelectorMapRows(md) {
  const rows = []
  for (const line of md.split('\n')) {
    if (!line.startsWith('|')) continue
    const cols = line.split('|')
    if (cols.length < 3) continue
    const first = cols[1]?.trim() ?? ''
    if (!first || /^-{3,}/.test(first)) continue
    if (first.includes('稳定类名') || first === '变量' || first === 'Obsidian 变量') continue
    const key = normalizeRowKey(first)
    if (key) rows.push({ raw: first, key })
  }
  return rows
}

export function compareSemver(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  }
  return 0
}

/**
 * 弃用版本之后**实际发布**的后续次版本列表（升序）。补丁版本不计；
 * 「跳版本号」不会在这里凭空产生中间版本——只有发布记录里真实存在的才算。
 */
export function releasedMinorsAfter(releases, fromVersion) {
  const [fromMajor, fromMinor] = fromVersion.split('.').map(Number)
  return Object.keys(releases)
    .filter((v) => {
      const [major, minor] = v.split('.').map(Number)
      return major === fromMajor && minor > fromMinor
    })
    .sort(compareSemver)
}

/** 两个 YYYY-MM-DD 的天数差（b - a） */
export function daysBetween(a, b) {
  const dayMs = 24 * 60 * 60 * 1000
  const da = Date.parse(`${a}T00:00:00Z`)
  const db = Date.parse(`${b}T00:00:00Z`)
  if (Number.isNaN(da) || Number.isNaN(db)) throw new Error(`日期格式非法：${a} / ${b}`)
  return Math.round((db - da) / dayMs)
}

/** 从生命周期自由文本提取首个 semver（`v0.4.x` 的 x 归一为 0，实际 patch 保留）；无则 null */
export function extractLifecycleVersion(text) {
  if (!text) return null
  const m = String(text).match(/v?(\d+)\.(\d+)\.(x|\d+)/i)
  if (!m) return null
  const patch = m[3].toLowerCase() === 'x' ? '0' : m[3]
  return `${m[1]}.${m[2]}.${patch}`
}

// ---------------------------------------------------------------------------
// 失败构造（工单四元组：入口 / 历史来源 / 候选版本 / 证据）
// ---------------------------------------------------------------------------

function fail(ctx, code, message, entry, evidence) {
  return {
    code,
    message,
    entry: entry?.id ?? null,
    target: entry?.target ?? null,
    source: `baseline ${ctx.baselineLabel}`,
    candidateVersion: ctx.candidateVersion,
    evidence,
  }
}

// ---------------------------------------------------------------------------
// 契约比较：基线 vs 候选
// ---------------------------------------------------------------------------

/** 展开族形态标注（`HyperMD-header-{1..6}` → 6 个实名） */
export function expandFamilyTargets(targets) {
  const out = []
  for (const t of targets ?? []) {
    if (/\{1\.\.6\}$/.test(t)) {
      for (let lv = 1; lv <= 6; lv++) out.push(t.replace(/\{1\.\.6\}$/, String(lv)))
    } else {
      out.push(t)
    }
  }
  return out
}

/**
 * 提取 target 文本中的类名 token（点前缀完整词）。`-filled` 这类无点简写
 * 与中文注释不参与提取——它们是说明性文本，不是独立入口。
 */
export function extractClassTokens(target) {
  const tokens = String(target ?? '').match(/\.[A-Za-z][A-Za-z0-9_-]*/g)
  return new Set(tokens ?? [])
}

/**
 * target 兼容判定：全等通过；基线承诺的类名 token 在候选中全部保留（只增
 * 不减）亦通过——target 括注追加子类/收起态等说明（#133 数据修正形态）不
 * 是入口改名。基线不含任何类名 token（变量等 `--xxx` 形态）时回退全等：
 * 变量名本身没有可提取的「只增不减」结构，任何文本变化都按改名报告。
 */
export function targetCompatible(baselineTarget, candidateTarget) {
  if (baselineTarget === candidateTarget) return true
  const baseTokens = extractClassTokens(baselineTarget)
  if (baseTokens.size === 0) return false
  const candidateTokens = extractClassTokens(candidateTarget)
  for (const token of baseTokens) {
    if (!candidateTokens.has(token)) return false
  }
  return true
}

/**
 * 逐条比较基线与候选清单。候选删除条目（含 removed 历史条目——清单条目
 * 永不物理删除）、改名 target（类名 token 消失；token 只增不减的括注扩展
 * 放行）、降级 support、收回 views 或 Obsidian 原名承诺，均失败。候选新增
 * 条目不受限；升级（semantic→direct）、views 扩展允许。候选条目的支持等级
 * 兼容两种形态：清单原生 `obsidian.support` 嵌套与基线同构的扁平
 * `obsidianSupport`。工具不写死 content 域——基线含 chrome 域条目（#133 起
 * 核实）时同一规则自动生效。
 *
 * entryExemptions（基线 entryComparisonExemptions 登记）：跳过该条目的
 * 字段级比较——用于基线快照承诺经 git 证据核实为陈旧数据、候选依纠错记录
 * 改写的场景（登记理由见基线 meta.provenance）。豁免不豁免 entry-missing：
 * 条目本体从清单物理删除仍失败。
 */
export function compareEntries(baselineEntries, candidateEntries, ctx, entryExemptions = new Set()) {
  const failures = []
  const byId = new Map(candidateEntries.map((e) => [e.id, e]))
  for (const b of baselineEntries) {
    const c = byId.get(b.id)
    if (!c) {
      failures.push(
        fail(ctx, 'entry-missing', `基线条目 ${b.id}（${b.target}）在候选清单中不存在`, b, `历史来源键：${b.sourceKey ?? b.target}；清单条目永不物理删除，弃用/移除须保留条目并标注生命周期字段`),
      )
      continue
    }
    if (entryExemptions.has(b.id)) continue
    if (!targetCompatible(b.target, c.target)) {
      failures.push(fail(ctx, 'entry-target-changed', `条目 ${b.id} 的公开入口改名：${b.target} → ${c.target}`, b, `基线 target：${b.target}；候选 target：${c.target}（类名 token 只增不减的括注扩展放行，基线承诺的类名消失/替换即改名）`))
    }
    const candidateSupport = c.obsidian?.support ?? c.obsidianSupport
    const rankB = SUPPORT_RANK[b.obsidianSupport] ?? -1
    const rankC = SUPPORT_RANK[candidateSupport] ?? -1
    if (rankC < rankB) {
      failures.push(fail(ctx, 'support-downgraded', `条目 ${b.id} 的 Obsidian 支持等级降级：${b.obsidianSupport} → ${candidateSupport}`, b, `支持等级收回等于片段兼容承诺破坏；升级允许，降级须走弃用流程`))
    }
    if (b.domain !== c.domain) {
      failures.push(fail(ctx, 'domain-changed', `条目 ${b.id} 域变化：${b.domain} → ${c.domain}`, b, `域重划须先核对历史基线归属`))
    }
    if (b.kind !== c.kind) {
      failures.push(fail(ctx, 'kind-changed', `条目 ${b.id} 种类变化：${b.kind} → ${c.kind}`, b, `选择器/变量/容器/限制互转视同入口语义变化`))
    }
    for (const v of b.views ?? []) {
      if (!(c.views ?? []).includes(v)) {
        failures.push(fail(ctx, 'views-shrunk', `条目 ${b.id} 收回适用视图：${v}`, b, `基线承诺视图：${(b.views ?? []).join('/')}`))
      }
    }
    const cAliases = new Set(expandFamilyTargets(c.aliasTargets ?? []))
    for (const a of expandFamilyTargets(b.aliasTargets ?? [])) {
      if (!cAliases.has(a)) {
        failures.push(fail(ctx, 'alias-retracted', `条目 ${b.id} 收回 Obsidian 原名承诺：${a}`, b, `基线 aliasTargets 承诺的原名在候选中消失`))
      }
    }
  }
  return failures
}

// ---------------------------------------------------------------------------
// 弃用期限校验（AGENTS「弃用与移除」）
// ---------------------------------------------------------------------------

/**
 * 校验候选清单的生命周期标注：
 * - deprecated 必须引用**实际发布**版本（在受信任发布记录中）且含替代写法；
 * - removed 必须有 deprecated 先行，且满足「弃用版本之后已发布 >= 2 个后续
 *   次版本（补丁不计）+ 自弃用实际发布日起满 30 天」；
 * - 移除声明引用的版本必须实际发布过（单纯抬高 package.json 版本号、跳
 *   版本号、改日期都不能伪造发布历程）；
 * - 到期不自动移除：本函数只判定「声明的移除是否合法」，从不修改或豁免
 *   清单条目本身（条目物理删除由 compareEntries 的 entry-missing 拦截）。
 * releases 是受信任发布记录（基线固化快照；运行时经 CHANGELOG/git tag
 * 交叉验证，矛盾即报错——见 assembleTrustedReleases）。
 */
export function validateLifecycle(entries, releases, now, exemptions = []) {
  const failures = []
  const exemptSet = new Set(exemptions)
  for (const entry of entries) {
    if (exemptSet.has(entry.id)) continue
    const ctx = { candidateVersion: entry.candidateVersion ?? 'candidate', baselineLabel: 'v-lifecycle' }
    const depV = entry.deprecated ? extractLifecycleVersion(entry.deprecated) : null
    if (entry.deprecated) {
      if (!depV || !releases[depV]) {
        failures.push(fail(ctx, 'deprecated-version-unverifiable', `条目 ${entry.id} 的弃用声明版本不可核实：${entry.deprecated}`, entry, `受信任发布记录不含该版本（或文本无可解析版本号）；历史资料不可取得时不得降级通过`))
      } else if (!/替代/.test(entry.deprecated)) {
        failures.push(fail(ctx, 'deprecated-no-replacement', `条目 ${entry.id} 的弃用声明缺少替代写法`, entry, `弃用声明须含实际发布版本与替代写法：${entry.deprecated}`))
      }
    }
    if (entry.removed) {
      if (!entry.deprecated) {
        failures.push(fail(ctx, 'removed-without-deprecation', `条目 ${entry.id} 标记移除但没有弃用声明先行`, entry, `removed: ${entry.removed}`))
        continue
      }
      if (!depV || !releases[depV]) continue // 弃用版本不可核实已在上面报错
      const depDate = releases[depV].date
      const days = daysBetween(depDate, now)
      if (days < 30) {
        failures.push(fail(ctx, 'removal-too-early', `条目 ${entry.id} 移除时距弃用发布仅 ${days} 天（须满 30 天）`, entry, `弃用版本 ${depV} 实际发布于 ${depDate}；校验时点 ${now}`))
      }
      const minors = releasedMinorsAfter(releases, depV)
      if (minors.length < 2) {
        failures.push(fail(ctx, 'removal-minor-span-insufficient', `条目 ${entry.id} 移除前仅经过 ${minors.length} 个后续次版本（须 >= 2；补丁版本不计）`, entry, `弃用版本 ${depV} 之后的已发布次版本：${minors.join('、') || '（无）'}`))
      }
      const remV = extractLifecycleVersion(entry.removed)
      if (!remV || !releases[remV]) {
        failures.push(fail(ctx, 'removal-version-unverifiable', `条目 ${entry.id} 的移除声明版本不可核实：${entry.removed}`, entry, `移除版本须为实际发布版本（在受信任发布记录中）；跳版本号或抬高 package.json 版本号不算发布`))
      }
    }
  }
  return failures
}

// ---------------------------------------------------------------------------
// 别名桥实现一致性（「删实现」的独立拦截）
// ---------------------------------------------------------------------------

/**
 * direct 级条目承诺的 Obsidian 原名必须仍被候选别名桥实现承接：
 * - DOM 类名：候选 OBSIDIAN_DOM_ALIASES 展平集合（函数族按 1..6 展开）；
 * - 变量：候选 OBSIDIAN_VARIABLE_ALIASES 的 obsidian 名集合。
 * 候选删除 obsidianAlias.ts 的表项（实现剥离）即使清单原样保留，也会在此
 * 被抓——「清单还在但实现没了」的规避路径被独立覆盖。
 */
export function checkAliasBridge(baselineEntries, candidateAliases, ctx) {
  const failures = []
  const dom = candidateAliases?.dom ?? new Set()
  const variables = candidateAliases?.variables ?? new Set()
  for (const b of baselineEntries) {
    if (b.obsidianSupport !== 'direct') continue
    for (const a of expandFamilyTargets(b.aliasTargets ?? [])) {
      const held = a.startsWith('--') ? variables.has(a) : dom.has(a)
      if (!held) {
        failures.push(fail(ctx, 'alias-implementation-missing', `条目 ${b.id} 承诺的 Obsidian 原名未被候选别名桥实现承接：${a}`, b, `候选实现同源表（src/shared/obsidianAlias.ts）中不存在该别名；别名桥必须实际命中原有内容`))
      }
    }
  }
  return failures
}

// ---------------------------------------------------------------------------
// 基线 git 锚定复验（--verify-baseline）
// ---------------------------------------------------------------------------

/**
 * 基线 sourceRows 对照旧映射表解析行的精确集合比对：多一行、少一行都失败。
 * 候选分支改基线文件以抹去历史承诺时，git 对象（固定 tag/SHA 的文件内容）
 * 不随候选分支变化——这是「来源固定、候选改不掉」的锚点。解析器与基线
 * 同时被改才能绕过，而那正是 #135 受保护基线要消除的自由度。
 */
export function verifyBaselineRows(baseline, rows) {
  const failures = []
  const ctx = { candidateVersion: 'baseline-audit', baselineLabel: `${baseline.meta.baselineVersion} (${baseline.meta.sourceSha.slice(0, 7)})` }
  const baselineKeys = new Set(baseline.sourceRows.map((r) => r.key))
  const rowKeys = new Set(rows.map((r) => r.key))
  for (const r of baseline.sourceRows) {
    if (!rowKeys.has(r.key)) {
      failures.push(fail(ctx, 'baseline-row-missing', `基线 sourceRow 在历史映射表中不存在：${r.key}`, { id: r.ids?.join('+') ?? r.key, target: r.key }, `基线声明了历史来源 ${r.key}，但 ${baseline.meta.sourceSha} 的映射表无此行——基线被增改`))
    }
  }
  for (const r of rows) {
    if (!baselineKeys.has(r.key)) {
      failures.push(fail(ctx, 'baseline-row-extra', `历史映射表行未在基线登记：${r.key}`, { id: null, target: r.key }, `映射表存在 ${r.key} 但基线缺失——基线被删改（丢项即丢保护）`))
    }
  }
  const entryIds = new Set(baseline.entries.map((e) => e.id))
  for (const r of baseline.sourceRows) {
    for (const id of r.ids ?? []) {
      if (!entryIds.has(id)) {
        failures.push(fail(ctx, 'source-row-unresolved', `sourceRow 指向的清单条目不存在：${r.key} → ${id}`, { id, target: r.key }, '基线内部引用断裂'))
      }
    }
  }
  return failures
}

// ---------------------------------------------------------------------------
// 完整性自检（guardManifest）
// ---------------------------------------------------------------------------

/**
 * 检查器消费的关键资产存在性与锚点核对：候选删除清单、别名桥、旧测试、
 * 探针资产或检查器自身时，本检查失败。边界（诚实声明）：manifest 定义在
 * 基线文件内，候选若连基线一起改可绕过本检查——对抗该组合是 #135 受保护
 * 基线的职责；本检查主要拦截「删测试/删资产」的常规规避与意外丢失。
 */
export function checkGuardManifest(root, manifest) {
  const failures = []
  const ctx = { candidateVersion: 'guard', baselineLabel: 'guardManifest' }
  for (const req of manifest?.requiredFiles ?? []) {
    const file = path.join(root, req.path)
    if (!existsSync(file)) {
      failures.push(fail(ctx, 'guard-file-missing', `完整性清单文件缺失：${req.path}`, { id: req.path, target: req.path }, `guardManifest 要求存在该文件（锚点：${req.anchor}）`))
      continue
    }
    if (req.anchor && !readFileSync(file, 'utf8').includes(req.anchor)) {
      failures.push(fail(ctx, 'guard-anchor-missing', `完整性清单文件失去锚点：${req.path}（锚点 ${req.anchor}）`, { id: req.path, target: req.path }, '文件存在但关键内容被删改（如探针规则/测试断言被剥离）'))
    }
  }
  return failures
}

// ---------------------------------------------------------------------------
// 候选加载（esbuild 内存编译 TS 清单/别名表——与 genStyleGuide.mjs 同模式）
// ---------------------------------------------------------------------------

async function importTsModule(root, exportLines) {
  const esbuild = await import('esbuild')
  const result = await esbuild.build({
    stdin: {
      contents: exportLines.join('\n'),
      resolveDir: root,
      sourcefile: 'styleContractCheckSources.ts',
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

/** 加载候选清单、类目表与别名桥（DOM 表函数族按 lv 1..6 展开） */
export async function loadCandidateContract(root) {
  const mod = await importTsModule(root, [
    'export { STYLE_CONTRACT_ENTRIES, STYLE_CONTRACT_CATEGORIES } from "./src/shared/styleContract.ts"',
    'export { OBSIDIAN_DOM_ALIASES, OBSIDIAN_VARIABLE_ALIASES } from "./src/shared/obsidianAlias.ts"',
  ])
  const dom = new Set()
  for (const value of Object.values(mod.OBSIDIAN_DOM_ALIASES)) {
    const lists = typeof value === 'function' ? [1, 2, 3, 4, 5, 6].map((lv) => value(lv)) : [value]
    for (const list of lists) for (const a of list) dom.add(a)
  }
  const variables = new Set(mod.OBSIDIAN_VARIABLE_ALIASES.map((a) => a.obsidian))
  return {
    entries: mod.STYLE_CONTRACT_ENTRIES,
    categories: mod.STYLE_CONTRACT_CATEGORIES,
    variableAliases: mod.OBSIDIAN_VARIABLE_ALIASES,
    aliases: { dom, variables },
  }
}

// ---------------------------------------------------------------------------
// 发布记录装配：基线固化快照 × CHANGELOG × git tag 三源交叉
// ---------------------------------------------------------------------------

function readGitTags(root) {
  try {
    const out = execFileSync('git', ['for-each-ref', 'refs/tags', '--format=%(refname:short) %(objectname)'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const tags = {}
    for (const line of out.split('\n')) {
      const m = line.trim().match(/^(\S+) ([0-9a-f]{40})$/)
      if (m) tags[m[1]] = m[2]
    }
    return tags
  } catch {
    return null
  }
}

/**
 * 装配受信任发布记录：
 * - 基线固化快照是权威集合（来源固定；#135 起由受保护来源提供）；
 * - CHANGELOG：固化版本的日期不得被改（矛盾 → 失败）；
 * - git tag（可得时）：固化版本的 tag 指向 SHA 不得变（矛盾 → 失败）；git
 *   不可用（CI 缓存/浅克隆）不阻塞，记 warning；
 * - CHANGELOG 新增版本：git tag 佐证存在才纳入受信任集合（本地正常演进即
 *   时可用），否则仅记 warning（保守：不作为期限计算的依据）。
 */
export function assembleTrustedReleases(baseline, changelogMd, gitTagData) {
  const failures = []
  const warnings = []
  const ctx = { candidateVersion: 'release-records', baselineLabel: `${baseline.meta.baselineVersion} (${baseline.meta.sourceSha.slice(0, 7)})` }
  const changelog = parseChangelogReleases(changelogMd)
  const trusted = {}
  for (const [version, snap] of Object.entries(baseline.releases)) {
    const cl = changelog[version]
    if (!cl) {
      failures.push(fail(ctx, 'changelog-release-missing', `固化发布版本 ${version} 在候选 CHANGELOG 中消失`, { id: version, target: version }, `基线固化：${snap.date}（tag ${snap.tag}）；删除已发布版本段 = 重写发布历史`))
      trusted[version] = { ...snap }
      continue
    }
    if (cl.date !== snap.date) {
      failures.push(fail(ctx, 'changelog-date-mismatch', `版本 ${version} 的 CHANGELOG 日期与基线固化快照矛盾`, { id: version, target: version }, `基线固化：${snap.date}；候选 CHANGELOG：${cl.date}（改日期不能伪造弃用期限）`))
    }
    if (gitTagData) {
      const sha = gitTagData[snap.tag]
      if (sha === undefined) {
        warnings.push(`tag ${snap.tag} 不在可用 git 数据中（CI 缓存场景可接受；本地请核对）`)
      } else if (sha !== snap.sha) {
        failures.push(fail(ctx, 'tag-sha-mismatch', `tag ${snap.tag} 指向与基线固化 SHA 不一致（重写 tag）`, { id: version, target: version }, `基线固化：${snap.sha}；实际：${sha}`))
      }
    } else {
      warnings.push('git tag 数据不可用（无 .git 或 git 失败）：跳过 tag→SHA 交叉验证，以基线固化快照为准')
    }
    trusted[version] = { ...snap, date: snap.date }
  }
  for (const version of Object.keys(changelog)) {
    if (trusted[version]) continue
    const tag = `v${version}`
    if (gitTagData?.[tag]) {
      trusted[version] = { date: changelog[version].date, tag, sha: gitTagData[tag], verifiedBy: 'changelog+tag' }
      warnings.push(`版本 ${version} 未固化进基线快照，经 CHANGELOG+tag 交叉验证纳入受信任集合（发布后建议更新基线快照并单独评审）`)
    } else {
      warnings.push(`版本 ${version} 仅见于候选 CHANGELOG 且无 tag 佐证：不纳入受信任发布记录（期限校验按未发布处理）`)
    }
  }
  return { trusted, failures, warnings }
}

// ---------------------------------------------------------------------------
// 指南一致性（衔接 #132 生成检查，同一门禁入口）
// ---------------------------------------------------------------------------

async function checkGuideConsistency(root, candidate, candidateVersion) {
  const failures = []
  const ctx = { candidateVersion, baselineLabel: 'generated-guide' }
  const gen = await import(pathToFileURL(path.join(SELF_ROOT, 'scripts/genStyleGuide.mjs')).href)
  // #145：三产物同源复算（HTML / 数据模块 / 契约 JSON）；generatedAt 与
  // 生成器同一确定性来源（CHANGELOG 版本日期），不引入运行时钟
  const data = {
    entries: candidate.entries,
    categories: candidate.categories,
    variableAliases: candidate.variableAliases,
    version: candidateVersion,
    generatedAt: gen.resolveGuideGeneratedAt(
      readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'),
      candidateVersion,
    ),
  }
  const outputs = [
    ['media/style-reference/style-reference.html', gen.buildStyleGuideHtml(data)],
    ['src/webview/styleGuideData.ts', gen.buildStyleGuideDataModule(data)],
    ['media/style-reference/style-reference.json', gen.buildStyleReferenceJson(data)],
  ]
  const stale = []
  for (const [name, content] of outputs) {
    let current = null
    try {
      current = readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n')
    } catch {
      current = null
    }
    if (current !== content) stale.push(name)
  }
  if (stale.length) {
    failures.push(fail(ctx, 'guide-stale', `样式指南产物与候选清单不一致：${stale.join('、')}`, { id: 'style-guide', target: stale.join('、') }, '改清单后须重跑 npm run gen:styleguide 并提交产物；候选产物与检查器复算结果不一致'))
  }
  return failures
}

// ---------------------------------------------------------------------------
// 全套编排
// ---------------------------------------------------------------------------

function today() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * 对候选树执行全套检查，返回结构化报告（exit code 语义：report.ok）。
 * opts：
 * - root：候选树根（默认本仓库；#135 可指向任意候选检出）
 * - baselinePath：基线 JSON（默认本仓库基线；#135 可指向受保护来源）
 * - gitTagData：{ [tag]: sha } 注入（CI 缓存）；缺省自动读 root 的 git
 * - now：期限校验时点（YYYY-MM-DD；缺省今天）
 * - reportPath：写入 JSON 报告的稳定路径
 * - skip：跳过的分项（如 'guide'）——仅限显式声明，报告记 skip
 */
export async function runStyleContractCheck(opts = {}) {
  const root = path.resolve(opts.root ?? SELF_ROOT)
  const baselinePath = path.resolve(opts.baselinePath ?? path.join(SELF_ROOT, 'test/style-contract/baseline-v0.4.0.json'))
  const now = opts.now ?? today()
  const skip = new Set(opts.skip ?? [])

  const checks = []
  const failures = []
  const warnings = []

  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const ctx = { candidateVersion: pkg.version, baselineLabel: `${baseline.meta.baselineVersion} (${baseline.meta.sourceSha.slice(0, 7)})` }

  const mark = async (id, fn) => {
    try {
      const r = await fn()
      // 兼容两种分项返回形态：failures 数组（单用途分项）或 {failures,warnings}
      const flist = Array.isArray(r) ? r : (r?.failures ?? [])
      const wlist = Array.isArray(r) ? [] : (r?.warnings ?? [])
      checks.push({ id, status: flist.length ? 'fail' : 'pass', failures: flist.length, warnings: wlist.length })
      failures.push(...flist)
      warnings.push(...wlist)
    } catch (err) {
      checks.push({ id, status: 'fail', error: String(err?.message ?? err) })
      failures.push(fail(ctx, `${id}-error`, `分项 ${id} 执行异常：${String(err?.message ?? err)}`, null, '检查器自身异常按失败处理（不降级通过）'))
    }
  }

  // 1. 发布记录三源交叉
  const gitTagData = opts.gitTagData !== undefined ? opts.gitTagData : readGitTags(root)
  let releaseAssembly = { trusted: {}, failures: [], warnings: [] }
  await mark('release-records', () => {
    const changelogMd = readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')
    releaseAssembly = assembleTrustedReleases(baseline, changelogMd, gitTagData)
    return releaseAssembly
  })
  checks.push({
    id: 'git-tag-consistency',
    status: gitTagData ? (releaseAssembly.failures.some((f) => f.code === 'tag-sha-mismatch') ? 'fail' : 'pass') : 'warn',
    detail: gitTagData ? `${Object.keys(gitTagData).length} 个 tag 可交叉验证` : 'git 不可用：以基线固化快照为准',
  })

  // 2. 候选加载（esbuild 编译清单与别名桥）
  let candidate = null
  if (!skip.has('candidate')) {
    try {
      candidate = await loadCandidateContract(root)
      checks.push({ id: 'candidate-contract', status: 'pass', detail: `${candidate.entries.length} 条清单条目` })
    } catch (err) {
      checks.push({ id: 'candidate-contract', status: 'fail', error: String(err?.message ?? err) })
      failures.push(fail(ctx, 'candidate-contract-error', `候选清单/别名表加载失败：${String(err?.message ?? err)}`, null, 'esbuild 编译或模块结构异常——清单与别名桥须保持可加载'))
    }
  } else {
    checks.push({ id: 'candidate-contract', status: 'skip', detail: '显式跳过' })
  }

  if (candidate) {
    // 3. 契约比较
    await mark('entry-comparison', () => ({ failures: compareEntries(baseline.entries, candidate.entries, ctx, new Set(baseline.entryComparisonExemptions ?? [])) }))
    // 4. 生命周期
    await mark('lifecycle', () => ({ failures: validateLifecycle(candidate.entries, releaseAssembly.trusted, now, baseline.lifecycleExemptions ?? []) }))
    // 5. 别名桥实现一致性
    await mark('alias-bridge', () => ({ failures: checkAliasBridge(baseline.entries, candidate.aliases, ctx) }))
    // 6. 指南一致性
    if (!skip.has('guide')) {
      await mark('guide-consistency', () => checkGuideConsistency(root, candidate, pkg.version))
    } else {
      checks.push({ id: 'guide-consistency', status: 'skip', detail: '显式跳过' })
    }
  }

  // 7. 完整性自检
  await mark('guard-manifest', () => ({ failures: checkGuardManifest(root, baseline.guardManifest) }))

  const report = {
    ok: failures.length === 0,
    tool: TOOL_ID,
    generatedAt: new Date().toISOString(),
    baseline: { version: baseline.meta.baselineVersion, sourceTag: baseline.meta.sourceTag, sourceSha: baseline.meta.sourceSha, path: baselinePath },
    candidate: { root, version: pkg.version },
    now,
    offline: true, // 全程无网络请求：不依赖在线字体服务等外部资源可用性
    checks,
    failures,
    warnings,
  }
  if (opts.reportPath) {
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(path.dirname(opts.reportPath), { recursive: true })
    writeFileSync(opts.reportPath, JSON.stringify(report, null, 2), 'utf8')
  }
  return report
}
