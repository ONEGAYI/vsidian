// 样式参考指南生成脚本（#132）：从结构化清单单一事实源
// （src/shared/styleContract.ts）生成用户指南，两份产物同步产出：
//
//   media/style-reference/style-reference.html
//     独立完整的离线指南（随 VSIX 分发；无脚本、自包含样式，
//     可在浏览器直接打开——本地环境亦可经命令用系统浏览器打开）
//   src/webview/styleGuideData.ts
//     设置页「样式参考」分页的渲染数据模块（esbuild 打进 settings.js，
//     保证设置页离线可查、内容与安装版本配套）
//
//   node scripts/genStyleGuide.mjs          # 生成并写盘（幂等）
//   node scripts/genStyleGuide.mjs --check  # 不写盘：产物与磁盘不一致即退出 1
//
// 一致性纪律（防手改指南漂移）：产物入库、由本脚本再生；编译链
// （npm run compile）前置生成，test/unit/styleGuideGen.test.ts 以 --check
// 钉住「清单 → 指南」可复现。改清单后须重跑并提交产物。
import * as esbuild from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 域显示名（指南分节） */
const DOMAIN_TITLES = { content: '正文域', chrome: '界面域' }

/** 支持等级图例（诚实边界：语义对应 ≠ 原名可直接使用） */
export const SUPPORT_LEGEND = [
  { level: 'direct', label: '直接兼容', desc: 'Obsidian 原名选择器/变量在本扩展实际生效（别名桥承接，两视图已验证）' },
  { level: 'semantic', label: '语义对应', desc: '功能等价但 Obsidian 原名不命中——须使用 vsidian 类名/变量名' },
  { level: 'native', label: '原生承担', desc: 'Obsidian 由原生结构/机制承担；本扩展为自有形态（无兼容承诺）' },
  { level: 'none', label: '无对应 / 不支持', desc: '无 Obsidian 对应，或该语法/结构当前不支持（片段中不命中）' },
]

const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function viewBadges(views) {
  if (!views.length) return '<span class="badge badge-none">非编辑视图</span>'
  return views.map((v) => `<span class="badge">${v === 'live' ? '实时预览' : '阅读'}</span>`).join('')
}

function lifecycle(entry) {
  const parts = [`引入：${entry.introduced}`]
  if (entry.deprecated) parts.push(`弃用：${entry.deprecated}`)
  if (entry.removed) parts.push(`移除：${entry.removed}`)
  return parts.join(' · ')
}

/** 单条目卡片（HTML 与设置页渲染共用同构字段序） */
export function renderEntryCard(entry) {
  const alias = entry.aliasTargets?.length
    ? `<p class="aliases">别名承诺：<code>${entry.aliasTargets.map(esc).join('</code> <code>')}</code></p>`
    : ''
  const states = entry.states ? `<p class="states">状态：${esc(entry.states)}</p>` : ''
  const pending = entry.pendingVerification
    ? `<p class="pending">界面域条目：逐项渲染验证随 #133 补齐（既有验证定位已列）</p>`
    : ''
  return `    <article class="entry" id="${esc(entry.id)}">
      <h3><code>${esc(entry.target)}</code><span class="eid">${esc(entry.id)}</span></h3>
      <p class="purpose">${esc(entry.purpose)}</p>
      <p class="views">${viewBadges(entry.views)} <span class="support support-${entry.obsidian.support}">${esc(entry.obsidian.support)}</span></p>
${states}
      <p class="obsidian">Obsidian 对应：${esc(entry.obsidian.counterpart)}</p>
${alias}
      <p class="dom">DOM 关系：${esc(entry.dom)}</p>
${entry.example ? `      <pre><code>${esc(entry.example)}</code></pre>
` : ''}      <p class="verify">验证：${entry.verification.map(esc).join('；')}</p>
${pending}      <p class="life">${esc(lifecycle(entry))}</p>
    </article>`
}

/** 生成完整 HTML 指南（无脚本、自包含样式、离线可开） */
export function buildStyleGuideHtml(data) {
  const { entries, variableAliases, version } = data
  const byDomain = { content: [], chrome: [] }
  for (const entry of entries) byDomain[entry.domain].push(entry)
  const sections = ['content', 'chrome']
    .map((domain) => {
      const list = byDomain[domain]
      const kindSections = [
        ['container', '容器'],
        ['selector', '选择器'],
        ['variable', 'CSS 变量'],
        ['limitation', '不支持与限制'],
      ]
        .map(([kind, title]) => {
          const items = list.filter((e) => e.kind === kind)
          if (!items.length) return ''
          return `    <h2>${DOMAIN_TITLES[domain]} · ${title}（${items.length}）</h2>
${items.map(renderEntryCard).join('\n')}`
        })
        .filter(Boolean)
        .join('\n')
      return `  <section class="domain" data-domain="${domain}">
${sections_header(domain, list.length)}
${kindSections || '    <p class="empty">（无条目）</p>'}
  </section>`
    })
    .join('\n')

  const varTable = variableAliases
    .map(
      (a) =>
        `      <tr><td><code>${esc(a.obsidian)}</code></td><td><code>${esc(a.vsidian)}</code></td><td><code>${esc(a.fallback)}</code></td></tr>`,
    )
    .join('\n')

  const legend = SUPPORT_LEGEND.map((l) => `      <li><code>${l.level}</code> <strong>${l.label}</strong> — ${esc(l.desc)}</li>`).join('\n')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vsidian 样式参考（v${esc(version)}）</title>
<style>
:root { color-scheme: light dark; }
body { font: 14px/1.65 system-ui, "Segoe UI", "Microsoft YaHei", sans-serif; margin: 0 auto; max-width: 880px; padding: 24px 20px 64px; }
h1 { font-size: 22px; } h2 { font-size: 17px; margin-top: 40px; border-bottom: 1px solid color-mix(in srgb, currentColor 18%, transparent); padding-bottom: 6px; }
code { font-family: ui-monospace, Consolas, monospace; background: color-mix(in srgb, currentColor 8%, transparent); padding: 1px 5px; border-radius: 4px; font-size: 12.5px; }
pre { background: color-mix(in srgb, currentColor 7%, transparent); padding: 10px 12px; border-radius: 6px; overflow-x: auto; }
pre code { background: none; padding: 0; }
.entry { border: 1px solid color-mix(in srgb, currentColor 16%, transparent); border-radius: 8px; padding: 12px 16px; margin: 14px 0; }
.entry h3 { font-size: 14.5px; margin: 0 0 6px; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.eid { color: color-mix(in srgb, currentColor 55%, transparent); font-size: 12px; font-weight: 400; }
.entry p { margin: 4px 0; font-size: 13px; }
.badge { display: inline-block; border: 1px solid color-mix(in srgb, currentColor 30%, transparent); border-radius: 999px; padding: 0 8px; font-size: 11.5px; }
.badge-none { opacity: .65; }
.support { font-weight: 600; margin-left: 6px; }
.support-direct { color: #1a7f37; } .support-semantic { color: #9a6700; }
.support-native { color: #6e7781; } .support-none { color: #cf222e; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { border: 1px solid color-mix(in srgb, currentColor 18%, transparent); padding: 5px 9px; text-align: left; }
ul.legend { padding-left: 18px; font-size: 13px; }
.note { background: color-mix(in srgb, currentColor 6%, transparent); border-radius: 8px; padding: 10px 14px; font-size: 13px; }
.pending { color: #9a6700; }
.empty { color: color-mix(in srgb, currentColor 55%, transparent); }
</style>
</head>
<body>
<h1>Vsidian 样式参考</h1>
<p>本指南由公开样式契约清单自动生成，与已安装版本 <strong>v${esc(version)}</strong> 配套；清单变更随版本更新，旧版本指南不承诺长期有效。CSS 片段的加载、目录与逐片段启停见扩展设置页「CSS 片段」。</p>

<div class="note">
<p><strong>Obsidian 原名兼容（别名桥）</strong>：标记 <code>direct</code> 的条目，其「别名承诺」列出的 Obsidian 原名选择器/变量在本扩展实际生效——DOM 同时挂载 vsidian 稳定类与 Obsidian 原名类；变量经 <code>var(Obsidian 名, 默认值)</code> 回退链生效，<strong>vsidian 名整条覆盖严格优先于 Obsidian 名</strong>。语义对应（<code>semantic</code>）条目不能用 Obsidian 原名，请改用 vsidian 名。</p>
<p><strong>主题作用域写法差异</strong>：Obsidian 片段常用的 <code>body.theme-dark</code>/<code>body.theme-light</code> 类不别名；请在 <code>:root</code>/<code>body</code> 或明暗两套属性值内书写（本扩展 webview 主题类为 <code>body.vscode-dark</code>/<code>body.vscode-light</code>）。</p>
</div>

<h2>支持等级图例</h2>
<ul class="legend">
${legend}
</ul>

<h2>Obsidian 变量别名总表</h2>
<table>
  <thead><tr><th>Obsidian 变量</th><th>vsidian 变量（优先）</th><th>未设置时默认值</th></tr></thead>
  <tbody>
${varTable}
  </tbody>
</table>

${sections}
<p style="margin-top:48px;color:color-mix(in srgb, currentColor 50%, transparent);font-size:12px">由 src/shared/styleContract.ts 生成（scripts/genStyleGuide.mjs）；产物一致性由 test/unit/styleGuideGen.test.ts 钉住。</p>
</body>
</html>
`
}

function sections_header(domain, count) {
  return `    <h1 style="font-size:19px;margin-bottom:4px">${DOMAIN_TITLES[domain]}（${count} 条）</h1>
${domain === 'chrome' ? '    <p class="note">界面域条目自 v0.4.0 迁移自既有映射表；逐项渲染验证随 #133 补齐，支持等级以各条目为准。</p>' : ''}`
}

/** 生成设置页渲染数据模块（styleGuideData.ts，esbuild 打包进 settings.js） */
export function buildStyleGuideDataModule(data) {
  const { entries, variableAliases, version } = data
  return `// 设置页「样式参考」分页渲染数据（#132）——由 scripts/genStyleGuide.mjs 从
// src/shared/styleContract.ts 生成，**禁止手改**；一致性由
// test/unit/styleGuideGen.test.ts 以 --check 钉住（改清单后重跑生成并提交）。
// 本文件是文档数据（公开指南内容，中文为准），不是 UI 文案——CJK 扫描豁免
// 同 styleContract.ts；不进编辑器 webview bundle（仅设置页 import）。
import type { StyleContractEntry } from '../shared/styleContract'
import type { ObsidianVariableAlias } from '../shared/obsidianAlias'

/** 指南配套的扩展版本（与安装版本一致） */
export const STYLE_GUIDE_VERSION = ${JSON.stringify(version)}

/** Obsidian 变量别名总表（指南总表同源） */
export const STYLE_GUIDE_VARIABLE_ALIASES: readonly ObsidianVariableAlias[] = ${JSON.stringify(variableAliases, null, 2)}

/** 清单条目（渲染数据形态与单一事实源同构） */
export const STYLE_GUIDE_ENTRIES: readonly StyleContractEntry[] = ${JSON.stringify(entries, null, 2)} as readonly StyleContractEntry[]
`
}

/** 编译并加载清单（TS → ESM 内存产物，data URL import；genNls.mjs 同模式） */
async function loadContract(root) {
  const result = await esbuild.build({
    stdin: {
      contents: [
        'export { STYLE_CONTRACT_ENTRIES } from "./src/shared/styleContract.ts"',
        'export { OBSIDIAN_VARIABLE_ALIASES } from "./src/shared/obsidianAlias.ts"',
      ].join('\n'),
      resolveDir: root,
      sourcefile: 'styleContractSources.ts',
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

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const check = process.argv.includes('--check')

  const { STYLE_CONTRACT_ENTRIES, OBSIDIAN_VARIABLE_ALIASES } = await loadContract(root)
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const data = { entries: STYLE_CONTRACT_ENTRIES, variableAliases: OBSIDIAN_VARIABLE_ALIASES, version: pkg.version }

  const outputs = [
    ['media/style-reference/style-reference.html', buildStyleGuideHtml(data)],
    ['src/webview/styleGuideData.ts', buildStyleGuideDataModule(data)],
  ]

  const changed = []
  for (const [name, content] of outputs) {
    let current = null
    try {
      current = readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n')
    } catch {
      current = null
    }
    if (current !== content) changed.push(name)
  }

  if (check) {
    if (changed.length) {
      console.error(`样式指南产物与清单不一致：${changed.join('、')}（重跑 npm run gen:styleguide 并提交产物）`)
      process.exitCode = 1
      return
    }
    console.log(`样式指南产物与清单一致（${STYLE_CONTRACT_ENTRIES.length} 条目，v${pkg.version}）`)
    return
  }

  for (const [name, content] of outputs) {
    const target = path.join(root, name)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content, 'utf8')
    console.log(`已生成 ${name}`)
  }
  console.log(`样式指南生成完成：${STYLE_CONTRACT_ENTRIES.length} 条目（正文域 ${data.entries.filter((e) => e.domain === 'content').length} / 界面域 ${data.entries.filter((e) => e.domain === 'chrome').length}），v${pkg.version}`)
}

// 被 test/unit/styleGuideGen.test.ts 以 ESM import 复用时不执行 main
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
