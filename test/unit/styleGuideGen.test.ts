// 样式指南生成一致性契约（#132）：指南产物（HTML 资产 + 设置页数据模块 +
// 契约 JSON，#145）由 scripts/genStyleGuide.mjs 从清单单一事实源生成，本测试
// 以 --check 模式复跑生成器比对磁盘——手改产物、改清单后未再生成、或生成器
// 回归都会失败。同时钉住生成器的纯函数行为（HTML 结构要素 + 数据模块形态 +
// JSON 自描述与同源计数），防产物内容空洞化（例如渲染函数丢字段仍产合法 HTML）。
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { readFileSync } from 'node:fs'
// @ts-expect-error mjs 无类型声明（运行时由 vitest ESM 加载；类型面不消费）
import { buildStyleGuideDataModule, buildStyleGuideHtml, buildStyleReferenceJson, renderEntryCard, resolveGuideGeneratedAt, SUPPORT_LEGEND } from '../../scripts/genStyleGuide.mjs'

const root = path.resolve(process.cwd())

const sampleCategories = [
  { id: 'heading', domain: 'content', title: '标题', titleKey: 'styleRef.category.heading', order: 1 },
  { id: 'math', domain: 'chrome', title: '公式', titleKey: 'styleRef.category.math', order: 1 },
]

const sampleEntry = {
  id: 'sample-strong',
  domain: 'content',
  category: 'heading',
  kind: 'selector' as const,
  target: '.vsidian-strong',
  purpose: '粗体内容入口。',
  views: ['live', 'reading'] as const,
  states: '标记触及显形',
  dom: '行内 mark span',
  example: '.cm-strong {\n  color: red;\n}',
  obsidian: { counterpart: '.cm-strong', support: 'direct' as const },
  aliasTargets: ['cm-strong'],
  verification: ['集成用例 X'],
  introduced: '#8',
  deprecated: undefined,
  removed: undefined,
}

const sampleData = (overrides: Record<string, unknown> = {}) => ({
  entries: [sampleEntry, { ...sampleEntry, id: 'chrome-x', domain: 'chrome', category: 'math' }],
  categories: sampleCategories,
  variableAliases: [
    { obsidian: '--h1-color', vsidian: '--vsidian-heading-color-1', fallback: 'var(--vscode-editor-foreground)' },
  ],
  version: '0.4.0',
  generatedAt: '2026-09-27',
  ...overrides,
})

describe('styleGuideGen 生成器纯函数', () => {
  it('renderEntryCard 含全部公开字段（含转义与生命周期）', () => {
    const html = renderEntryCard(sampleEntry)
    for (const needle of [
      'sample-strong',
      '.vsidian-strong',
      '粗体内容入口',
      '实时预览',
      '阅读',
      'direct',
      '.cm-strong',
      'cm-strong',
      '标记触及显形',
      '.cm-strong {\n  color: red;\n}',
      '集成用例 X',
      '引入：#8',
    ]) {
      expect(html.includes(needle), `卡片应含 ${needle}`).toBe(true)
    }
    // 移除条目生命周期
    expect(renderEntryCard({ ...sampleEntry, removed: 'v0.2.x 随 #55' }).includes('移除')).toBe(true)
  })

  it('buildStyleGuideHtml 按类目分节（域 → 类目，含计数）', () => {
    const html = buildStyleGuideHtml(sampleData())
    expect(html.includes('v0.4.0')).toBe(true)
    expect(html.includes('--h1-color')).toBe(true)
    expect(html.includes('别名桥')).toBe(true)
    expect(SUPPORT_LEGEND).toHaveLength(4)
    for (const l of SUPPORT_LEGEND) expect(html.includes(l.level)).toBe(true)
    expect(html.includes('正文域')).toBe(true)
    expect(html.includes('界面域')).toBe(true)
    // #145：类目分节标题（域 · 类目（计数））
    expect(html.includes('正文域 · 标题（1）')).toBe(true)
    expect(html.includes('界面域 · 公式（1）')).toBe(true)
    // 旧的 kind 分节标题不再出现（类目取代种类分组）
    expect(html.includes('正文域 · 选择器')).toBe(false)
    // 无脚本（离线静态文档，不依赖 JS）
    expect(/<script/i.test(html)).toBe(false)
  })

  it('buildStyleGuideDataModule 产出可编译的数据模块形态（含类目表）', () => {
    const ts = buildStyleGuideDataModule(sampleData({ version: '1.2.3' }))
    expect(ts.includes('export const STYLE_GUIDE_VERSION = "1.2.3"')).toBe(true)
    expect(ts.includes('export const STYLE_GUIDE_ENTRIES')).toBe(true)
    expect(ts.includes('export const STYLE_GUIDE_CATEGORIES')).toBe(true)
    expect(ts.includes('禁止手改')).toBe(true)
    expect(ts.includes('"id": "sample-strong"')).toBe(true)
    expect(ts.includes('"category": "heading"')).toBe(true)
    expect(ts.includes('StyleContractCategory')).toBe(true)
  })

  it('buildStyleReferenceJson 自描述完整（meta/图例/类目计数/别名表/条目全字段）', () => {
    const json = buildStyleReferenceJson(sampleData())
    const doc = JSON.parse(json)
    expect(doc.meta.schemaVersion).toBe(1)
    expect(doc.meta.vsidianVersion).toBe('0.4.0')
    expect(doc.meta.generatedAt).toBe('2026-09-27')
    expect(doc.meta.entryCount).toBe(2)
    expect(doc.meta.fields.entries).toBeTruthy()
    expect(doc.supportLegend).toHaveLength(4)
    const heading = doc.categories.find((c: { id: string }) => c.id === 'heading')
    expect(heading.count).toBe(1)
    expect(heading.title).toBe('标题')
    expect(doc.variableAliases[0].obsidian).toBe('--h1-color')
    expect(doc.entries[0].category).toBe('heading')
    expect(doc.entries[0].obsidian.support).toBe('direct')
    // 同一 data 再生成字节一致（确定性）
    expect(buildStyleReferenceJson(sampleData())).toBe(json)
  })

  it('resolveGuideGeneratedAt 取版本发布日期；未发布版本回落最新发布日期', () => {
    const md = [
      '# Changelog',
      '## Unreleased',
      '## 0.5.0 - 2026-10-05',
      '## 0.4.0 - 2026-09-27',
    ].join('\n')
    expect(resolveGuideGeneratedAt(md, '0.4.0')).toBe('2026-09-27')
    expect(resolveGuideGeneratedAt(md, '0.4.9')).toBe('2026-10-05')
    expect(resolveGuideGeneratedAt('', '0.4.0')).toBe('unknown')
  })
})

describe('styleGuideGen 产物一致性（--check）', () => {
  it('磁盘产物与清单再生成结果一致（含契约 JSON）', () => {
    let out = ''
    let code = 0
    try {
      out = execFileSync('node', [path.join(root, 'scripts/genStyleGuide.mjs'), '--check'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      code = (error as { status?: number }).status ?? 1
      out = String((error as { stdout?: string }).stdout ?? '')
    }
    expect(code, `--check 应通过（${out}）`).toBe(0)
  })

  it('HTML 资产在盘且含条目计数（与清单规模一致）', () => {
    const html = readFileSync(path.join(root, 'media/style-reference/style-reference.html'), 'utf8')
    const entryCount = (html.match(/class="entry"/g) ?? []).length
    expect(entryCount).toBeGreaterThanOrEqual(110)
  })

  it('契约 JSON 在盘且自洽（条目归类、类目计数求和、meta 要素）', () => {
    const doc = JSON.parse(readFileSync(path.join(root, 'media/style-reference/style-reference.json'), 'utf8'))
    expect(doc.entries.length).toBeGreaterThanOrEqual(110)
    expect(doc.categories.length).toBeGreaterThanOrEqual(15)
    const total = doc.categories.reduce((sum: number, c: { count: number }) => sum + c.count, 0)
    expect(total).toBe(doc.entries.length)
    for (const key of ['schemaVersion', 'vsidianVersion', 'generatedAt', 'entryCount', 'fields']) {
      expect(doc.meta[key], `meta.${key}`).toBeDefined()
    }
    // 每条目都携带 category 且在类目表中；条目与设置页数据模块同源同规模
    const catIds = new Set(doc.categories.map((c: { id: string }) => c.id))
    for (const entry of doc.entries) {
      expect(catIds.has(entry.category), `${entry.id} category ${entry.category}`).toBe(true)
    }
    const dataTs = readFileSync(path.join(root, 'src/webview/styleGuideData.ts'), 'utf8')
    expect(dataTs.includes('"category"')).toBe(true)
    expect((dataTs.match(/"id": "/g) ?? []).length).toBeGreaterThanOrEqual(doc.entries.length)
  })
})
