// 附加组件公开 API 版本参考生成脚本（#362 T13）：从语义清单与发行台账
// 单一事实源（src/shared/addonApiCatalog.ts）+ 各事实源模块的 TypeScript
// 声明，生成接口参考文档：
//
//   docs/addons/api-reference.md
//     六组接口参考（签名 + 语义 + 验证定位）与版本索引/发行台账渲染。
//     产物入库、由本脚本再生；**签名不手写第二份**——声明文本用 TypeScript
//     编译器 API 从事实源模块逐符号提取（含紧邻前导文档注释），符号缺失
//     或清单自洽性破坏（validateAddonApiCatalog）即失败。
//
//   node scripts/genAddonApiRef.mjs          # 生成并写盘（幂等；内容一致跳过）
//   node scripts/genAddonApiRef.mjs --check  # 不写盘：产物与磁盘不一致即退出 1
//
// 一致性纪律（防手改参考漂移）：npm run compile 前置生成，
// test/unit/addonApiRefGen.test.ts 以 --check 钉住「清单 → 参考」可复现。
// 确定性纪律：产物不携带生成时间戳——同一 (清单, 事实源) 再生成字节一致。
// 诚实性纪律：候选/草案状态不渲染发布日期——发行是人工落账动作，见台账。
import * as esbuild from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/** 分层徽标（参考文档的诚实边界：候选不是已发布） */
const LAYER_LABELS = {
  'stable-candidate': '稳定候选（随 1.0.0 候选冻结，未发行）',
  experimental: '实验入口（不随稳定 API 弃用期限承诺）',
}

/** 状态中文名（台账渲染） */
const STATUS_LABELS = {
  draft: '草案',
  candidate: '候选（未发行）',
  released: '已发布',
  deprecated: '已弃用',
  removed: '已移除',
}

/** 执行端中文名 */
const ENDPOINT_LABELS = {
  host: '组件宿主代码',
  'editor-page': '编辑器页',
  'settings-page': '设置页',
}

/**
 * 从 TypeScript 源文本提取指定符号的声明（含紧邻前导文档注释）。
 * 覆盖顶层与 declare module 内的 interface / type / function / const。
 * 返回 Map<符号名, 文本>；wantedSymbols 中缺失的符号不出现在结果里
 * （调用方负责把缺失当失败——这是「清单 → 声明」的存在性门禁）。
 */
export function extractSymbolDeclarations(fileText, fileName, wantedSymbols) {
  const wanted = new Set(wantedSymbols)
  const found = new Map()
  const sf = ts.createSourceFile(fileName, fileText, ts.ScriptTarget.Latest, true)
  const visit = (node) => {
    let name = null
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isFunctionDeclaration(node)) {
      name = node.name?.text ?? null
    } else if (ts.isVariableStatement(node)) {
      const decl = node.declarationList.declarations[0]
      if (decl && ts.isIdentifier(decl.name)) {
        name = decl.name.text
      }
    }
    if (name !== null && wanted.has(name) && !found.has(name)) {
      // 紧邻前导注释：取最后一个注释范围，且其结尾与声明起点之间只有空白
      const ranges = ts.getLeadingCommentRanges(fileText, node.getFullStart()) ?? []
      const last = ranges[ranges.length - 1]
      let prefix = ''
      if (last) {
        const between = fileText.slice(last.end, node.getStart(sf))
        if (/^\s*$/.test(between) && (fileText.slice(last.pos, last.pos + 3) === '/**' || fileText.slice(last.pos, last.pos + 2) === '//')) {
          prefix = `${fileText.slice(last.pos, last.end).trimEnd()}\n`
        }
      }
      // 声明首行在源文件中的缩进（declare module 内 >0）：getText 首行顶格、
      // 内部行保持源文件绝对缩进——以首行源缩进为基准剥内部行的相对多余
      const lead = fileText.slice(node.getFullStart(), node.getStart(sf))
      const lastLeadLine = lead.slice(lead.lastIndexOf('\n') + 1)
      const baseIndent = (lastLeadLine.match(/^[ \t]*/) ?? [''])[0].length
      found.set(name, dedentBy(`${prefix}${node.getText(sf)}`, baseIndent))
    }
    node.forEachChild(visit)
  }
  sf.forEachChild(visit)
  return found
}

/** 按基准缩进剥离（declare module 内声明的内部行提出后对齐顶层；
 *  不足基准的行保持原样，避免负缩进） */
function dedentBy(text, baseIndent) {
  if (baseIndent === 0) {
    return text.replace(/\r\n/g, '\n').trimEnd()
  }
  const pattern = new RegExp(`^[ \\t]{1,${baseIndent}}`)
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(pattern, ''))
    .join('\n')
    .trimEnd()
}

/** 汇总条目签名源：模块 → 符号集合（去重） */
export function collectSignatureSources(entries) {
  const byModule = new Map()
  for (const entry of entries) {
    for (const source of entry.signatures) {
      if (!byModule.has(source.module)) {
        byModule.set(source.module, new Set())
      }
      for (const symbol of source.symbols) {
        byModule.get(source.module).add(symbol)
      }
    }
  }
  return byModule
}

/**
 * 生成参考文档正文。signatures 形状：Map<模块, Map<符号, 声明文本>>。
 * data：{ groups, entries, releases, removalRule, catalogVersion? }
 */
export function buildApiReferenceMarkdown(data, signatures) {
  const { groups, entries, releases, removalRule } = data
  const groupsOrdered = [...groups].sort((a, b) => a.order - b.order)

  const toc = groupsOrdered
    .map((group) => {
      const items = entries
        .filter((entry) => entry.group === group.id)
        .map((entry) => `    - [\`${entry.id}\` ${entry.title}](#${entry.id})`)
        .join('\n')
      return `  - [${group.order}. ${group.title}](#${anchor(`${group.order}-${group.title}`)})\n${items}`
    })
    .join('\n')

  const statusSection = renderReleases(releases)

  const body = groupsOrdered
    .map((group) => {
      const items = entries
        .filter((entry) => entry.group === group.id)
        .map((entry) => renderEntry(entry, signatures))
        .join('\n')
      return `## ${group.order}. ${group.title}

**能力范围**：${group.scope}

${items}`
    })
    .join('\n')

  return `# Vsidian 附加组件公开 API 参考

> 本文档由 \`scripts/genAddonApiRef.mjs\` 从语义清单与发行台账单一事实源（\`src/shared/addonApiCatalog.ts\`）及各事实源模块的 TypeScript 声明自动生成，**禁止手改**；新鲜度由 \`npm run check:addonapi\` 校验。接入流程、构建桥、调试与迁移的叙述性内容见[开发指南](developer-guide.md)；示例仓库的准备说明见[示例仓库准备](example-repo-plan.md)。

**诚实声明**：当前所有条目与版本均为**候选状态，尚未对外发布**——Vsidian 尚未发行任何稳定 API、SDK 包或独立示例仓库。候选形状已随 T01–T12 的消费样例冻结，发行前不产生兼容承诺。

## 状态、版本与发行台账

${statusSection}

### 稳定 API 移除规则

${removalRule}

### 维护入口

- 语义清单与台账（单一事实源）：\`src/shared/addonApiCatalog.ts\`——新增或修改六组接口时同步条目并重跑 \`npm run gen:addonapi\` 提交产物。
- 公开声明的编译期消费：\`test/addonApi/publicApiConsumer.ts\`（删除公开成员、收窄枚举会使 \`npm run compile\` 失败）；导入面纪律由 \`test/unit/addonApiSurface.test.ts\` 钉住。
- 消费样例（行为验证）：\`test/fixtures/addon-v02/\` 各夹具组件。

## 目录

${toc}

${body}

---

由 src/shared/addonApiCatalog.ts 与各事实源声明生成（scripts/genAddonApiRef.mjs）；产物一致性由 test/unit/addonApiRefGen.test.ts 钉住。
`
}

/** 台账渲染：状态行、版本表、实验入口兼容清单 */
function renderReleases(releases) {
  const versionRows = releases
    .map((record) => {
      const date = record.releasedAt ?? '—（未发行不携带日期）'
      return `| ${record.version} | ${STATUS_LABELS[record.status]} | ${date} | ${oneLine(record.summary)} |`
    })
    .join('\n')
  const experimentalRows = releases
    .flatMap((record) =>
      record.experimental.map((exp) => {
        const date = exp.releasedAt ?? '—（未发行不携带日期）'
        return `| \`${exp.entry}\` | ${exp.version} | ${STATUS_LABELS[exp.status]} | ${date} | ${oneLine(exp.note ?? '')} |`
      }),
    )
    .join('\n')
  return `**版本号独立于 Vsidian 本体版本**——附加组件声明支持的 API 范围不能以本体版本代替；台账区分候选与实际发行，只有真实发行才携带日期。

| API 版本 | 状态 | 实际发布日期 | 说明 |
| --- | --- | --- | --- |
${versionRows}

**实验入口兼容清单**（使用须在清单 \`experimental\` 声明对应入口与兼容范围；实验入口可能随版本调整，不随稳定 API 弃用期限承诺）：

| 入口 | 版本 | 状态 | 实际发布日期 | 兼容边界 |
| --- | --- | --- | --- | --- |
${experimentalRows}`
}

/** 单条目渲染：标题行（锚点=条目 id）、目标、语义、签名、验证 */
function renderEntry(entry, signatures) {
  const layer = LAYER_LABELS[entry.layer]
  const endpoints = entry.endpoints.map((e) => ENDPOINT_LABELS[e]).join('、')
  const sem = entry.semantics
  const semanticLines = [
    sem.modes ? `- **适用模式**：${sem.modes}` : null,
    sem.coordinates ? `- **坐标与数据形状**：${sem.coordinates}` : null,
    sem.lifecycle ? `- **生命周期**：${sem.lifecycle}` : null,
    sem.errors ? `- **错误与拒绝**：${sem.errors}` : null,
    sem.history ? `- **历史与撤回**：${sem.history}` : null,
    sem.autoRules ? `- **自动规则**：${sem.autoRules}` : null,
    sem.language ? `- **暴露面裁剪**：${sem.language}` : null,
  ].filter(Boolean)

  const signatureBlocks = entry.signatures
    .map((source) => {
      const extracted = signatures.get(source.module)
      const decls = source.symbols
        .map((symbol) => extracted?.get(symbol))
        .filter(Boolean)
        .join('\n\n')
      return `签名事实源：\`${source.module}\`

\`\`\`ts
${decls}
\`\`\``
    })
    .join('\n\n')

  const expLine =
    entry.layer === 'experimental'
      ? `\n> **实验入口**：清单 \`experimental\` 声明名 \`${entry.experimentalEntry}\`——兼容边界见上方实验入口兼容清单。`
      : ''

  return `### \`${entry.id}\` ${entry.title}

**分层**：${layer} · **执行端**：${endpoints} · **引入**：${entry.introduced}${expLine}

**目标**：${entry.purpose}

${semanticLines.length ? `语义要点：\n${semanticLines.join('\n')}` : '（语义见签名注释）'}

${signatureBlocks}

**验证**：${entry.verification.map((v) => `\`${v}\``).join('、')}
`
}

/** 压成单行（表格单元格用） */
function oneLine(text) {
  return text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|')
}

/** markdown 锚点（GitHub 风格：小写、去非字母数字、空格转连字符） */
function anchor(text) {
  return text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff\s-]/g, '').replace(/\s+/g, '-')
}

/** 编译并加载清单（TS → ESM 内存产物，data URL import；genStyleGuide 同模式） */
async function loadCatalog(root) {
  const result = await esbuild.build({
    stdin: {
      contents: [
        'export { ADDON_API_GROUPS, ADDON_API_ENTRIES, ADDON_API_RELEASES, ADDON_API_REMOVAL_RULE, validateAddonApiCatalog } from "./src/shared/addonApiCatalog.ts"',
      ].join('\n'),
      resolveDir: root,
      sourcefile: 'addonApiCatalogSources.ts',
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
 * 从磁盘读取全部签名源模块并提取声明。
 * 返回 { signatures, missing }：missing 为「模块 → 缺失符号」映射（非空即失败）。
 */
export function loadSignatures(root, entries) {
  const byModule = collectSignatureSources(entries)
  const signatures = new Map()
  const missing = new Map()
  for (const [module, symbols] of byModule) {
    const filePath = path.join(root, module)
    let text
    try {
      text = readFileSync(filePath, 'utf8')
    } catch {
      missing.set(module, [...symbols])
      continue
    }
    const extracted = extractSymbolDeclarations(text, module, [...symbols])
    const missed = [...symbols].filter((symbol) => !extracted.has(symbol))
    if (missed.length) {
      missing.set(module, missed)
    }
    signatures.set(module, extracted)
  }
  return { signatures, missing }
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const check = process.argv.includes('--check')
  const outputName = 'docs/addons/api-reference.md'

  const { ADDON_API_GROUPS, ADDON_API_ENTRIES, ADDON_API_RELEASES, ADDON_API_REMOVAL_RULE, validateAddonApiCatalog } =
    await loadCatalog(root)

  // 门禁一：清单自洽（含台账诚实性——候选携带日期即失败）
  const problems = validateAddonApiCatalog(ADDON_API_GROUPS, ADDON_API_ENTRIES, ADDON_API_RELEASES)
  if (problems.length) {
    console.error(`附加组件 API 清单自洽校验失败：\n${problems.map((p) => `  - ${p}`).join('\n')}`)
    process.exitCode = 1
    return
  }

  // 门禁二：签名源存在性（条目指向的符号必须真实存在于事实源模块）
  const { signatures, missing } = loadSignatures(root, ADDON_API_ENTRIES)
  if (missing.size) {
    const detail = [...missing.entries()].map(([module, symbols]) => `${module} 缺符号：${symbols.join('、')}`).join('\n  ')
    console.error(`签名源提取失败（条目指向的导出符号缺失）：\n  ${detail}`)
    process.exitCode = 1
    return
  }

  const content = `${buildApiReferenceMarkdown(
    { groups: ADDON_API_GROUPS, entries: ADDON_API_ENTRIES, releases: ADDON_API_RELEASES, removalRule: ADDON_API_REMOVAL_RULE },
    signatures,
  )}\n`

  let current = null
  try {
    current = readFileSync(path.join(root, outputName), 'utf8').replace(/\r\n/g, '\n')
  } catch {
    current = null
  }

  if (check) {
    if (current !== content) {
      console.error(`附加组件 API 参考产物与清单不一致：${outputName}（重跑 npm run gen:addonapi 并提交产物）`)
      process.exitCode = 1
      return
    }
    console.log(`附加组件 API 参考产物与清单一致（${ADDON_API_ENTRIES.length} 条目，${ADDON_API_GROUPS.length} 组）`)
    return
  }

  if (current !== content) {
    const target = path.join(root, outputName)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content, 'utf8')
    console.log(`已生成 ${outputName}`)
  } else {
    console.log(`产物无变化，跳过写盘 ${outputName}`)
  }
  console.log(`附加组件 API 参考生成完成：${ADDON_API_ENTRIES.length} 条目 / ${ADDON_API_GROUPS.length} 组 / 台账 ${ADDON_API_RELEASES.length} 条`)
}

// 被 test/unit/addonApiRefGen.test.ts 以 ESM import 复用时不执行 main
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
