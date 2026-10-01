// 公开样式契约清单契约测试（#132）：钉住清单 schema、别名桥同源性与
// 迁移完整性（旧映射表条目全集不丢）。清单是单一事实源——本测试保证：
// 1. schema 合法（ID 唯一、枚举、content 域字段完备、chrome 域带 #133 核实标记）；
// 2. direct 级承诺的 aliasTargets 与 DOM/变量别名常量表逐项一致（发射侧
//    与清单同源的机器保证）；
// 3. 旧映射表（docs/design/obsidian-selector-map.md @ 6ef5997，与 v0.4.0
//    tag 一致）全部条目在清单中有归宿（MIGRATION_PARITY 快照）；
// 4. 弃用/移除生命周期先例（var-heading-accent）有记录。
import { describe, expect, it } from 'vitest'
import {
  OBSIDIAN_ALIAS_PROBES,
  OBSIDIAN_DOM_ALIASES,
  OBSIDIAN_VARIABLE_ALIASES,
  STYLE_CONTRACT_BY_ID,
  STYLE_CONTRACT_CATEGORIES,
  STYLE_CONTRACT_ENTRIES,
  joinObsidianAlias,
} from '../../src/shared/styleContract'
import { en } from '../../src/shared/locales/en'
import { zhCn } from '../../src/shared/locales/zh-cn'

const SUPPORT_LEVELS = new Set(['direct', 'semantic', 'native', 'none'])
const DOMAINS = new Set(['content', 'chrome'])
const KINDS = new Set(['container', 'selector', 'variable', 'limitation'])

describe('styleContract schema', () => {
  it('条目 ID 唯一', () => {
    const ids = STYLE_CONTRACT_ENTRIES.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('枚举字段合法（domain / kind / support / views）', () => {
    for (const entry of STYLE_CONTRACT_ENTRIES) {
      expect(DOMAINS.has(entry.domain), `${entry.id} domain`).toBe(true)
      expect(KINDS.has(entry.kind), `${entry.id} kind`).toBe(true)
      expect(SUPPORT_LEVELS.has(entry.obsidian.support), `${entry.id} support`).toBe(true)
      for (const view of entry.views) {
        expect(['live', 'reading']).toContain(view)
      }
      // 已移除条目（历史记录）与 limitation 无适用视图；chrome 域侧栏 UI
      // （大纲面板等）不属于编辑器两视图，允许空 views（挂载位置见 dom）
      if (entry.domain === 'content' && entry.kind !== 'limitation' && entry.removed === undefined) {
        expect(entry.views.length, `${entry.id} 正文域条目须声明适用视图`).toBeGreaterThan(0)
      }
    }
  })

  it('正文域条目字段完备（用途/示例/验证/引入非空）', () => {
    for (const entry of STYLE_CONTRACT_ENTRIES) {
      if (entry.domain !== 'content' || entry.kind === 'limitation') {
        continue
      }
      expect(entry.purpose.length, `${entry.id} purpose`).toBeGreaterThan(0)
      expect(entry.example.length, `${entry.id} example`).toBeGreaterThan(0)
      expect(entry.verification.length, `${entry.id} verification`).toBeGreaterThan(0)
      expect(entry.introduced.length, `${entry.id} introduced`).toBeGreaterThan(0)
      expect(entry.dom.length, `${entry.id} dom`).toBeGreaterThan(0)
    }
  })

  it('界面域条目已逐项核实（#133）：无 pendingVerification 残留且 selector/variable 条目验证定位非空', () => {
    let chromeCount = 0
    for (const entry of STYLE_CONTRACT_ENTRIES) {
      if (entry.domain !== 'chrome') {
        continue
      }
      chromeCount += 1
      // 迁移期防伪反向钉：自称已核实的域不得再携带待核实标记
      expect(entry.pendingVerification, `${entry.id} 不应残留待核实标记`).toBeUndefined()
      // 已核实条目必须有验证定位（limitation 的「清单即边界」除外）
      if (entry.kind !== 'limitation' && entry.removed === undefined) {
        expect(entry.verification.length, `${entry.id} verification`).toBeGreaterThan(0)
      }
    }
    expect(chromeCount).toBeGreaterThanOrEqual(41)
  })

  it('direct 级条目必须给出 aliasTargets（承诺可执行）', () => {
    // 靠容器别名后的语义标签/元素**天然命中**的 direct 条目（无别名发射点）
    const NATURAL_DIRECT = new Set(['inline-strikethrough', 'image-slot'])
    for (const entry of STYLE_CONTRACT_ENTRIES) {
      if (entry.obsidian.support === 'direct' && entry.kind !== 'limitation') {
        // live 视图 direct 依赖别名桥发射（DOM 类名或变量 fallback），必须有
        // 机器同源的 aliasTargets；阅读侧天然命中或 NATURAL_DIRECT 例外豁免
        const needsAlias =
          !NATURAL_DIRECT.has(entry.id) &&
          (entry.views.includes('live') || entry.kind === 'variable' || entry.kind === 'container')
        if (needsAlias) {
          expect((entry.aliasTargets ?? []).length, `${entry.id}`).toBeGreaterThan(0)
        }
      }
      if (entry.obsidian.support !== 'direct') {
        expect(entry.aliasTargets, `${entry.id} 非 direct 不应有 aliasTargets`).toBeUndefined()
      }
    }
  })

  it('移除条目保留完整生命周期记录（先例：var-heading-accent、mode-toggle）', () => {
    const removed = STYLE_CONTRACT_ENTRIES.filter((e) => e.removed !== undefined)
    expect(removed.map((e) => e.id)).toEqual(['var-heading-accent', 'mode-toggle'])
    expect(removed[0]!.removed!).toContain('#55')
    expect(removed[0]!.views).toEqual([])
    // mode-toggle：#38 移除且从未随发布版存在（#133 核实纠错，见条目 removed 记录）
    expect(removed[1]!.removed!).toContain('#38')
    expect(removed[1]!.views).toEqual([])
    expect(removed[1]!.example.length).toBeGreaterThan(0)
  })

  it('joinObsidianAlias 拼接稳定', () => {
    expect(joinObsidianAlias('vsidian-strong', OBSIDIAN_DOM_ALIASES.strong)).toBe('vsidian-strong cm-strong')
    expect(joinObsidianAlias('vsidian-x', [])).toBe('vsidian-x')
  })
})

/** direct 级 DOM 别名承诺全集（条目 aliasTargets 与 OBSIDIAN_DOM_ALIASES 双向对照的期望） */
const EXPECTED_DOM_ALIAS_TARGETS: Record<string, string[]> = {
  'container-live': ['markdown-source-view', 'mod-cm6', 'cm-s-obsidian'],
  'container-reading': ['markdown-preview-view'],
  'live-heading-line': ['HyperMD-header-{1..6}'],
  'live-header-span': ['cm-header-{1..6}'],
  'inline-strong': ['cm-strong'],
  'inline-emphasis': ['cm-emphasis'],
  'inline-code': ['cm-inline-code'],
  'inline-highlight': ['cm-highlight'],
  'live-code-line': ['HyperMD-codeblock'],
  'live-quote-line': ['HyperMD-quote'],
  'live-list-line': ['HyperMD-list-line'],
  'live-hr-line': ['cm-hr'],
  'live-frontmatter-line': ['cm-hmd-frontmatter'],
  'live-table-line': ['HyperMD-table-line'],
  'live-table-cell': ['cm-table-cell'],
  'live-link': ['cm-link'],
  'live-wikilink': ['cm-hmd-internal-link'],
  'reading-task': ['task-list-item'],
  'reading-frontmatter': ['markdown-frontmatter'],
  'reading-wikilink': ['internal-link'],
  'reading-embed-card': ['markdown-embed'],
}

describe('styleContract 别名桥同源', () => {
  it('DOM 别名条目 aliasTargets 与发射侧常量表展开一致', () => {
    for (const [id, expected] of Object.entries(EXPECTED_DOM_ALIAS_TARGETS)) {
      const entry = STYLE_CONTRACT_BY_ID.get(id)
      expect(entry, id).toBeDefined()
      expect([...entry!.aliasTargets!], id).toEqual(expected)
    }
  })

  it('OBSIDIAN_DOM_ALIASES 每个别名都在某条目的 aliasTargets 中（无孤儿常量）', () => {
    // 族形态（{1..6}）与具体层级（-1）归一化后比较
    const normalize = (s: string): string => s.replace(/-\{1\.\.6\}/g, '').replace(/-\d+$/g, '')
    const allTargets = new Set(
      STYLE_CONTRACT_ENTRIES.flatMap((e) => (e.aliasTargets ?? []).map(normalize)),
    )
    const aliasValues: string[] = []
    for (const value of Object.values(OBSIDIAN_DOM_ALIASES)) {
      if (typeof value === 'function') {
        for (const lv of [1, 3, 6]) aliasValues.push(...(value as (n: number) => readonly string[])(lv))
      } else {
        aliasValues.push(...(value as readonly string[]))
      }
    }
    for (const alias of new Set(aliasValues)) {
      expect(allTargets.has(normalize(alias)), `别名 ${alias} 应被某条目承诺`).toBe(true)
    }
  })

  it('探针表 OBSIDIAN_ALIAS_PROBES：id 均存在、视图匹配、选择器含对应别名', () => {
    for (const probe of OBSIDIAN_ALIAS_PROBES) {
      // 键允许「条目 id」或「条目 id-reading」视图消歧后缀（同一条目两视图探针）
      const entry = STYLE_CONTRACT_BY_ID.get(probe.id) ?? STYLE_CONTRACT_BY_ID.get(probe.id.replace(/-reading$/, ''))
      expect(entry, probe.id).toBeDefined()
      // live 视图探针的选择器必须包含某个别名类名（证明按原名命中）
      if (probe.view === 'live') {
        const aliases = (entry!.aliasTargets ?? []).map((t) => t.replace('-{1..6}', '-1'))
        const hit = aliases.some((a) => probe.selector.includes(a))
        expect(hit, `${probe.id} 探针选择器应含别名（${probe.selector}）`).toBe(true)
      }
      // 阅读侧探针必须以 Obsidian 容器名开头（天然命中路径）
      if (probe.view === 'reading' && probe.id !== 'container-reading') {
        expect(probe.selector.startsWith('.markdown-preview-view'), probe.id).toBe(true)
      }
    }
    // live 容器组合探针验证容器三件套
    const containerLive = OBSIDIAN_ALIAS_PROBES.find((p) => p.id === 'container-live')!
    expect(containerLive.selector).toBe('.markdown-source-view.mod-cm6')
  })

  it('变量别名表：vsidian 名全部是清单公开变量；Obsidian 名不撞 vsidian 名', () => {
    // 族形态归一化：--vsidian-heading-color-1 → --vsidian-heading-color
    const normalize = (s: string): string => s.replace(/-\d+$/, '').replace(/-\{1\.\.6\}/, '')
    for (const alias of OBSIDIAN_VARIABLE_ALIASES) {
      const family = normalize(alias.vsidian)
      expect(
        STYLE_CONTRACT_ENTRIES.some((e) => e.kind === 'variable' && normalize(e.target).includes(family)),
        `${alias.vsidian} 应是清单公开变量`,
      ).toBe(true)
      expect(alias.obsidian.startsWith('--')).toBe(true)
      expect(alias.obsidian.startsWith('--vsidian')).toBe(false)
      expect(alias.fallback.length).toBeGreaterThan(0)
    }
    // heading-color 族 6 条 + 阅读排版 4 + 高亮 + 表格 = 12；#175 live 限宽 = 13
    expect(OBSIDIAN_VARIABLE_ALIASES.length).toBe(13)
  })

  it('变量别名条目的 aliasTargets 与变量别名表一致', () => {
    const varEntry = STYLE_CONTRACT_BY_ID.get('var-heading-color')!
    expect(varEntry.aliasTargets).toEqual(['--h1-color', '--h2-color', '--h3-color', '--h4-color', '--h5-color', '--h6-color'])
    const varMap = new Map(OBSIDIAN_VARIABLE_ALIASES.map((a) => [a.vsidian, a.obsidian]))
    for (const entry of STYLE_CONTRACT_ENTRIES) {
      if (entry.kind !== 'variable' || entry.obsidian.support !== 'direct') {
        continue
      }
      for (const target of entry.aliasTargets ?? []) {
        expect(varMap.has(OBSIDIAN_VARIABLE_ALIASES.find((a) => a.obsidian === target)?.vsidian ?? ''), `${target} 在变量别名表中`).toBe(true)
      }
    }
  })
})

/**
 * 迁移完整性快照：旧映射表（@ 6ef5997 = v0.4.0 基线）全部条目主键 →
 * 清单条目 ID。删除/改名任何条目都会在此暴露；新增条目不受限。
 * 依据 logs/baseline-freeze-2026-09-27.md 与 logs/migration-parity.txt。
 */
const MIGRATION_PARITY: ReadonlyArray<[string, string]> = [
  ['.vsidian-view-live', 'container-live'],
  ['.vsidian-view-reading', 'container-reading'],
  ['.vsidian-heading-line-{1..6}', 'live-heading-line'],
  ['.vsidian-header-{1..6}', 'live-header-span'],
  ['.vsidian-heading-inview', 'live-heading-inview'],
  ['.vsidian-heading-active', 'live-heading-active'],
  ['.vsidian-strong', 'inline-strong'],
  ['.vsidian-emphasis', 'inline-emphasis'],
  ['.vsidian-inline-code', 'inline-code'],
  ['.vsidian-highlight', 'inline-highlight'],
  ['.vsidian-code-line', 'live-code-line'],
  ['.vsidian-quote-line', 'live-quote-line'],
  ['.vsidian-list-line', 'live-list-line'],
  ['.vsidian-list-bullet', 'live-list-bullet'],
  ['.vsidian-list-ordered', 'live-list-ordered'],
  ['.vsidian-list-marker-visible', 'live-list-marker-visible'],
  ['.vsidian-task-checkbox', 'live-task-checkbox'],
  ['.vsidian-hr-line', 'live-hr-line'],
  ['.vsidian-hr', 'live-hr-widget'],
  ['.vsidian-frontmatter-line', 'live-frontmatter-line'],
  ['.vsidian-table-line', 'live-table-line'],
  ['.vsidian-table-header-line', 'live-table-header-line'],
  ['.vsidian-table-delimiter-line', 'live-table-delimiter-line'],
  ['.vsidian-table-cell', 'live-table-cell'],
  ['.vsidian-table-pipe', 'live-table-pipe'],
  ['.vsidian-table-align-{left/center/right}', 'live-table-align'],
  ['.vsidian-table-grid-row', 'live-table-grid-row'],
  ['.vsidian-table-grid-cell', 'live-table-grid-cell'],
  ['.vsidian-table-grid-delimiter', 'live-table-grid-delimiter'],
  ['.vsidian-table-grid-align-{left/center/right}', 'live-table-grid-align'],
  ['.vsidian-table-escaped-pipe', 'live-table-escaped-pipe'],
  ['.vsidian-reading-block', 'reading-block'],
  ['.vsidian-reading-heading-{1..6}', 'reading-heading'],
  ['.vsidian-reading-paragraph', 'reading-paragraph'],
  ['.vsidian-reading-blockquote', 'reading-blockquote'],
  ['.vsidian-reading-list', 'reading-list'],
  ['li.vsidian-reading-task', 'reading-task'],
  ['.vsidian-reading-task-checkbox', 'reading-task-checkbox'],
  ['.vsidian-reading-code-block', 'reading-code-block'],
  ['.vsidian-reading-hr', 'reading-hr'],
  ['.vsidian-reading-table', 'reading-table'],
  ['.vsidian-reading-frontmatter', 'reading-frontmatter'],
  ['.vsidian-reading-spacer', 'reading-spacer'],
  ['.vsidian-link', 'live-link'],
  ['阅读链接（语义 a）', 'reading-link'],
  ['.vsidian-image', 'image-slot'],
  ['.vsidian-image-loading/-loaded/-error', 'image-states'],
  ['.vsidian-wikilink', 'live-wikilink'],
  ['a.vsidian-wikilink', 'reading-wikilink'],
  ['.vsidian-math', 'live-math'],
  ['.vsidian-math-block', 'live-math-block'],
  ['.vsidian-math-source', 'live-math-source'],
  ['.katex-block .vsidian-math', 'reading-math-block'],
  ['.vsidian-math-error', 'math-error'],
  ['.vsidian-mermaid', 'mermaid-container'],
  ['.vsidian-mermaid svg', 'mermaid-svg'],
  ['.vsidian-reading-mermaid', 'reading-mermaid-block'],
  ['.vsidian-mermaid-error', 'mermaid-error'],
  ['.vsidian-outline-item', 'outline-item'],
  ['.vsidian-outline-strong/-emphasis/-code/-strike/-highlight', 'outline-inline-marks'],
  ['.vsidian-outline-located', 'outline-located'],
  ['.vsidian-outline-slider', 'outline-slider'],
  ['.vsidian-outline-slider-dot', 'outline-slider-dot'],
  ['.vsidian-outline-chevron', 'outline-chevron'],
  ['.vsidian-outline-collapsed', 'outline-collapsed'],
  ['.vsidian-outline-hidden', 'outline-hidden'],
  ['.vsidian-outline-toolbar', 'outline-toolbar'],
  ['.vsidian-outline-jump-bottom/-reset', 'outline-toolbar-buttons'],
  ['.vsidian-outline-search', 'outline-search'],
  ['mark.vsidian-outline-search-hit', 'outline-search-hit'],
  ['.vsidian-outline-nomatch', 'outline-nomatch'],
  ['.vsidian-outline-menu', 'outline-menu'],
  ['.vsidian-outline-rename-input', 'outline-rename-input'],
  ['.vsidian-outline-dragging', 'outline-dragging'],
  ['.vsidian-outline-drop-before/-after', 'outline-drop-edge'],
  ['.vsidian-outline-drop-inside', 'outline-drop-inside'],
  ['.vsidian-code-card-line', 'live-code-card-line'],
  ['.vsidian-code-card-edge-top/-bottom', 'live-code-card-edge'],
  ['.vsidian-code-card-header', 'live-code-card-header'],
  ['.vsidian-code-card-header-label/-actions', 'live-code-card-header-parts'],
  ['.vsidian-code-card-copy', 'live-code-card-copy'],
  ['.vsidian-code-card-fold', 'live-code-card-fold'],
  ['.vsidian-code-card-linenumber', 'live-code-card-linenumber'],
  ['tok-*', 'tok-tokens'],
  ['.vsidian-reading-code-card', 'reading-code-card'],
  ['.vsidian-suspend-banner', 'suspend-banner'],
  ['.vsidian-toolbar', 'toolbar'],
  ['.vsidian-mode-toggle', 'mode-toggle'],
  ['REMOVED:--vsidian-heading-accent', 'var-heading-accent'],
  ['--vsidian-heading-color-{1..6}', 'var-heading-color'],
  ['--vsidian-reading-font-size', 'var-reading-font-size'],
  ['--vsidian-reading-max-width', 'var-reading-max-width'],
  ['--vsidian-live-preview-max-width', 'var-live-preview-max-width'],
  ['--vsidian-reading-line-height', 'var-reading-line-height'],
  ['--vsidian-reading-code-background', 'var-reading-code-background'],
  ['--vsidian-code-card-background', 'var-code-card-background'],
  ['--vsidian-highlight-background', 'var-highlight-background'],
  ['--vsidian-table-background', 'var-table-background'],
  // 旧表「已知不支持项」→ limitation 条目（划线已升级项不迁）
  ['.cm-hashtag / .tag', 'limit-hashtag'],
  ['.callout', 'limit-callout'],
  ['data-task 扩展状态', 'limit-task-extended-states'],
  ['.markdown-embed', 'limit-markdown-embed'],
  ['.cm-strikethrough（live）', 'limit-strikethrough-live'],
  ['.cm-quote（span 级）', 'limit-quote-span'],
  ['is-unresolved', 'limit-is-unresolved'],
  ['引用式链接 live 侧', 'limit-reference-links-live'],
  ['表格跨视图拆分差异', 'limit-table-crossview'],
  ['阅读虚拟化', 'limit-virtualization'],
  ['查找高亮交叉形态', 'limit-find-hit-mask'],
  ['.token-*（Prism）', 'limit-prism-tokens'],
  // 阅读行内语义标签（旧表散文段承诺）
  ['阅读行内 del 标签', 'inline-strikethrough'],
]

describe('styleContract 迁移完整性（旧映射表全集不丢）', () => {
  it('旧表全部主键在清单中有归宿', () => {
    for (const [oldKey, id] of MIGRATION_PARITY) {
      const entry = STYLE_CONTRACT_BY_ID.get(id)
      expect(entry, `旧条目「${oldKey}」→ 清单 ${id} 缺失`).toBeDefined()
    }
    expect(MIGRATION_PARITY.length).toBeGreaterThanOrEqual(100)
  })

  it('旧表条目数守恒（快照：防止对照表自身被删减）', () => {
    // #175 新增 var-live-preview-max-width 对照行：110 → 111
    expect(MIGRATION_PARITY.length).toBe(111)
    expect(STYLE_CONTRACT_ENTRIES.length).toBeGreaterThanOrEqual(MIGRATION_PARITY.length)
  })
})

// ---- 类目体系（#145）：小类分栏与契约 JSON 的分组单一事实源 ----

/** 每类目条目数快照（显式钉住归类：重划/迁移类目必须同步改这里，防静默漂移） */
const CATEGORY_COUNT_SNAPSHOT: Record<string, number> = {
  // content 域（82；#222 增嵌入卡片与占位行两条，#223 增 Live 嵌入宿主，
  // #217 验收反馈增 mod-link-hover）
  'view-container': 2,
  heading: 4,
  'inline-format': 8,
  'list-task': 5,
  'line-syntax': 5,
  table: 11,
  'reading-structure': 12,
  'link-image-wikilink': 13,
  'content-variables': 12,
  'content-limits': 11,
  // chrome 域（64）
  math: 5,
  diagram: 4,
  'graphic-interact': 2,
  'code-card': 11,
  outline: 19,
  'chrome-limits': 4,
  'toolbar-banner': 6,
  frontmatter: 6,
  'context-menu': 1,
  backlinks: 4,
  outlinks: 2,
  'hover-preview': 2,
  'find-panel': 6,
}

describe('styleContract 类目体系（#145）', () => {
  it('类目定义表形态合法（id 唯一、kebab-case、域合法、域内 order 连续自 1 起）', () => {
    const ids = STYLE_CONTRACT_CATEGORIES.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const cat of STYLE_CONTRACT_CATEGORIES) {
      expect(DOMAINS.has(cat.domain), `${cat.id} domain`).toBe(true)
      expect(cat.id, `${cat.id} 须为 kebab-case`).toMatch(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/)
      expect(cat.title.length, `${cat.id} title`).toBeGreaterThan(0)
      expect(cat.order, `${cat.id} order 须为正整数`).toBeGreaterThan(0)
    }
    for (const domain of ['content', 'chrome'] as const) {
      const orders = STYLE_CONTRACT_CATEGORIES.filter((c) => c.domain === domain)
        .map((c) => c.order).sort((a, b) => a - b)
      expect(orders, `${domain} 域 order 须从 1 连续`).toEqual(
        Array.from({ length: orders.length }, (_, i) => i + 1),
      )
    }
  })

  it('每条目已归类且类目存在于定义表（域一致）', () => {
    const byId = new Map(STYLE_CONTRACT_CATEGORIES.map((c) => [c.id, c]))
    for (const entry of STYLE_CONTRACT_ENTRIES) {
      const cat = byId.get(entry.category)
      expect(cat, `${entry.id} 的类目 ${entry.category} 未在定义表登记`).toBeDefined()
      expect(cat!.domain, `${entry.id} 归入 ${entry.category} 但域不一致`).toBe(entry.domain)
    }
  })

  it('每类目至少一条条目；计数与实际一致（快照）', () => {
    const counts = new Map<string, number>()
    for (const entry of STYLE_CONTRACT_ENTRIES) {
      counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1)
    }
    for (const cat of STYLE_CONTRACT_CATEGORIES) {
      expect(counts.get(cat.id), `类目 ${cat.id} 不能为空`).toBeGreaterThan(0)
    }
    expect(Object.fromEntries(counts)).toEqual(CATEGORY_COUNT_SNAPSHOT)
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(STYLE_CONTRACT_ENTRIES.length)
  })

  it('类目 titleKey 在两语言包存在，zh-cn 取词与文档名一致（设置页与指南同源）', () => {
    for (const cat of STYLE_CONTRACT_CATEGORIES) {
      const key = cat.titleKey as keyof typeof en
      expect(en[key], `${cat.id} titleKey ${key} 缺 en 词条`).toBeTruthy()
      expect(zhCn[key], `${cat.id} titleKey ${key} 缺 zh-cn 词条`).toBeTruthy()
      expect(zhCn[key], `${cat.id} zh-cn 词条须与文档名 title 一致`).toBe(cat.title)
    }
  })
})
