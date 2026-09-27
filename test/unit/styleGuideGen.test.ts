// 样式指南生成一致性契约（#132）：指南产物（HTML 资产 + 设置页数据模块）
// 由 scripts/genStyleGuide.mjs 从清单单一事实源生成，本测试以 --check 模式
// 复跑生成器比对磁盘——手改产物、改清单后未再生成、或生成器回归都会失败。
// 同时钉住生成器的纯函数行为（HTML 结构要素 + 数据模块形态），防产物
// 内容空洞化（例如渲染函数丢字段仍产合法 HTML）。
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { readFileSync } from 'node:fs'
// @ts-expect-error mjs 无类型声明（运行时由 vitest ESM 加载；类型面不消费）
import { buildStyleGuideDataModule, buildStyleGuideHtml, renderEntryCard, SUPPORT_LEGEND } from '../../scripts/genStyleGuide.mjs'

const root = path.resolve(process.cwd())

describe('styleGuideGen 生成器纯函数', () => {
  const sampleEntry = {
    id: 'sample-strong',
    domain: 'content' as const,
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

  it('buildStyleGuideHtml 含版本、图例、变量别名总表与两域分节', () => {
    const html = buildStyleGuideHtml({
      entries: [sampleEntry as never, { ...sampleEntry, id: 'chrome-x', domain: 'chrome' as const } as never],
      variableAliases: [
        { obsidian: '--h1-color', vsidian: '--vsidian-heading-color-1', fallback: 'var(--vscode-editor-foreground)' },
      ],
      version: '0.4.0',
    })
    expect(html.includes('v0.4.0')).toBe(true)
    expect(html.includes('--h1-color')).toBe(true)
    expect(html.includes('别名桥')).toBe(true)
    expect(SUPPORT_LEGEND).toHaveLength(4)
    for (const l of SUPPORT_LEGEND) expect(html.includes(l.level)).toBe(true)
    expect(html.includes('正文域')).toBe(true)
    expect(html.includes('界面域')).toBe(true)
    // 无脚本（离线静态文档，不依赖 JS）
    expect(/<script/i.test(html)).toBe(false)
  })

  it('buildStyleGuideDataModule 产出可编译的数据模块形态', () => {
    const ts = buildStyleGuideDataModule({
      entries: [sampleEntry] as never,
      variableAliases: [],
      version: '1.2.3',
    })
    expect(ts.includes('export const STYLE_GUIDE_VERSION = "1.2.3"')).toBe(true)
    expect(ts.includes('export const STYLE_GUIDE_ENTRIES')).toBe(true)
    expect(ts.includes('禁止手改')).toBe(true)
    expect(ts.includes('"id": "sample-strong"')).toBe(true)
  })
})

describe('styleGuideGen 产物一致性（--check）', () => {
  it('磁盘产物与清单再生成结果一致', () => {
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
})
