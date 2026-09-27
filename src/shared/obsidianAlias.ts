// Obsidian 原名别名桥（#132）：direct 级承诺的 Obsidian 原名在 DOM 双类名与
// CSS 变量 fallback 两条路径上的**实现同源表**。webview 发射侧
// （liveDecorations / liveLinks / readingView / readingMarkdown / syncController）
// 只 import 本模块——本模块不含清单文档数据（条目中文内容在 ./styleContract，
// 供指南生成与契约测试消费），保证 webview bundle 零文档字节。
//
// 与清单条目 aliasTargets 的一致性由 test/unit/styleContract.test.ts（无孤儿
// 常量 / 双向对照）与 test/unit/obsidianAlias.test.ts（发射契约）钉住；
// 变量桥的 CSS 形态由 test/unit/obsidianAliasCssContract.test.ts 钉 main.css。

// ---------------------------------------------------------------------------
// Obsidian 原名别名桥常量（direct 级承诺的实现同源表）
// ---------------------------------------------------------------------------

/**
 * DOM 双类名别名（#132 别名桥）：发射侧把这些 Obsidian 原类名与 vsidian
 * 稳定类名**挂在同一元素**上——用户片段按 Obsidian 原名书写即命中。
 * 族形态用函数表达（level / 对齐值代入）。
 * 本表与条目的 aliasTargets 由 test/unit/styleContract.test.ts 钉住一致；
 * 发射处（liveDecorations / readingView / liveLinks / syncController）一律
 * import 本表拼类名，不得手写字面量。
 */
export const OBSIDIAN_DOM_ALIASES = {
  /** live 容器（Obsidian 片段常用容器/主题作用域三件套） */
  liveContainer: ['markdown-source-view', 'mod-cm6', 'cm-s-obsidian'] as const,
  /** 阅读容器（Obsidian 阅读视图容器；其后代标签选择器随之天然命中） */
  readingContainer: ['markdown-preview-view'] as const,
  /** live 标题行（Obsidian `.HyperMD-header-{n}` 行容器族） */
  headingLine: (lv: number) => [`HyperMD-header-${lv}`] as const,
  /** live 标题内容 span（Obsidian `.cm-header-{n}` token 族） */
  headerSpan: (lv: number) => [`cm-header-${lv}`] as const,
  strong: ['cm-strong'] as const,
  emphasis: ['cm-emphasis'] as const,
  inlineCode: ['cm-inline-code'] as const,
  highlight: ['cm-highlight'] as const,
  /** 引用行（Obsidian 行级类；span 级 .cm-quote 不承诺，见 limit-quote-span） */
  quoteLine: ['HyperMD-quote'] as const,
  /** 围栏/缩进代码行（Obsidian 代码块行族） */
  codeLine: ['HyperMD-codeblock'] as const,
  /** 列表项行（基类；Obsidian 深度/编号靠行 class 组合，本项目为 -d{1..8} 自有形态） */
  listLine: ['HyperMD-list-line'] as const,
  /** 水平线行（源码态着色；渲染态 widget 见 live-hr-widget 条目） */
  hrLine: ['cm-hr'] as const,
  frontmatterLine: ['cm-hmd-frontmatter'] as const,
  tableLine: ['HyperMD-table-line'] as const,
  /** 单元格内容 span（社区主题常用方向，非 Obsidian 官方类） */
  tableCell: ['cm-table-cell'] as const,
  /** 链接内容 span */
  link: ['cm-link'] as const,
  /** 双链呈现（widget 与源码 mark 共用） */
  wikilink: ['cm-hmd-internal-link'] as const,
  /** 阅读任务列表项（li 级；其后代 input[type=checkbox] 选择器随之命中） */
  readingTask: ['task-list-item'] as const,
  /** 阅读 frontmatter 头块 */
  readingFrontmatter: ['markdown-frontmatter'] as const,
  /** 阅读双链（a 级类名） */
  readingWikilink: ['internal-link'] as const,
} as const

/**
 * CSS 变量别名桥（#132）：main.css 的 vsidian 公开变量默认定义改写为
 * `var(<Obsidian 名>, <原默认>)` 形态——用户片段设置 Obsidian 原名变量
 * 即生效；不设置时保持 vsidian 默认。同名 vsidian 变量的整条覆盖严格
 * 优先于 Obsidian 名（双轨并存，vsidian 名优先）。
 * 形态由 test/unit/obsidianAliasCssContract.test.ts 从本表钉住 main.css。
 */
export interface ObsidianVariableAlias {
  obsidian: string
  vsidian: string
  /** 原默认值（未设置 Obsidian 名时的回退表达式，照抄 main.css 字面） */
  fallback: string
}

export const OBSIDIAN_VARIABLE_ALIASES: readonly ObsidianVariableAlias[] = [
  { obsidian: '--h1-color', vsidian: '--vsidian-heading-color-1', fallback: 'var(--vscode-editor-foreground)' },
  { obsidian: '--h2-color', vsidian: '--vsidian-heading-color-2', fallback: 'var(--vscode-editor-foreground)' },
  { obsidian: '--h3-color', vsidian: '--vsidian-heading-color-3', fallback: 'var(--vscode-editor-foreground)' },
  { obsidian: '--h4-color', vsidian: '--vsidian-heading-color-4', fallback: 'var(--vscode-editor-foreground)' },
  { obsidian: '--h5-color', vsidian: '--vsidian-heading-color-5', fallback: 'var(--vscode-editor-foreground)' },
  { obsidian: '--h6-color', vsidian: '--vsidian-heading-color-6', fallback: 'var(--vscode-editor-foreground)' },
  { obsidian: '--font-text-size', vsidian: '--vsidian-reading-font-size', fallback: 'var(--vsidian-content-font-size)' },
  { obsidian: '--file-line-width', vsidian: '--vsidian-reading-max-width', fallback: '760px' },
  { obsidian: '--line-height-normal', vsidian: '--vsidian-reading-line-height', fallback: 'var(--vsidian-content-line-height)' },
  {
    obsidian: '--code-background',
    vsidian: '--vsidian-reading-code-background',
    fallback: 'var(--vscode-textCodeBlock-background, rgba(128, 128, 128, 0.12))',
  },
  { obsidian: '--text-highlight-bg', vsidian: '--vsidian-highlight-background', fallback: 'rgba(255, 208, 0, 0.35)' },
  { obsidian: '--table-background', vsidian: '--vsidian-table-background', fallback: 'rgba(128, 128, 128, 0.05)' },
]

/**
 * 别名桥渲染验证的探针表（#132）：集成用例「Obsidian 原名别名桥」经
 * `cssProbe.obsidianAliases[<id>]` 逐项断言——probe.css 以 **Obsidian 原名
 * 选择器** 写探针规则，本表给出各 id 的定位选择器与所属视图根。键集与
 * direct 级 DOM 别名条目一致（契约测试钉住）。
 */
export interface ObsidianAliasProbe {
  /** 清单条目 ID（cssProbe.obsidianAliases 的键） */
  id: string
  view: 'live' | 'reading'
  /** 在对应视图容器内定位目标元素的选择器（与 probe.css 探针规则同形） */
  selector: string
  /** probe.css 探针规则的期望 outline-color（集成断言与规则契约同源；探针
   *  属性统一用 outline-color——与既有 text-decoration-color 探针体系正交，
   *  同元素被两套探针命中时零层叠串扰，且 outline-style none 时无视觉影响） */
  expected: string
}

export const OBSIDIAN_ALIAS_PROBES: readonly ObsidianAliasProbe[] = [
  { id: 'container-live', view: 'live', selector: '.markdown-source-view.mod-cm6', expected: 'rgb(101, 102, 103)' },
  { id: 'live-heading-line', view: 'live', selector: '.HyperMD-header-1', expected: 'rgb(104, 105, 106)' },
  { id: 'live-header-span', view: 'live', selector: '.cm-header-1', expected: 'rgb(107, 108, 109)' },
  { id: 'inline-strong', view: 'live', selector: '.cm-strong', expected: 'rgb(110, 111, 112)' },
  { id: 'inline-emphasis', view: 'live', selector: '.cm-emphasis', expected: 'rgb(113, 114, 115)' },
  { id: 'inline-code', view: 'live', selector: '.cm-inline-code', expected: 'rgb(116, 117, 118)' },
  { id: 'inline-highlight', view: 'live', selector: '.cm-highlight', expected: 'rgb(119, 120, 121)' },
  { id: 'live-code-line', view: 'live', selector: '.HyperMD-codeblock', expected: 'rgb(122, 123, 124)' },
  { id: 'live-quote-line', view: 'live', selector: '.HyperMD-quote', expected: 'rgb(125, 126, 127)' },
  { id: 'live-list-line', view: 'live', selector: '.HyperMD-list-line', expected: 'rgb(128, 129, 130)' },
  { id: 'live-hr-line', view: 'live', selector: '.cm-hr', expected: 'rgb(131, 132, 133)' },
  { id: 'live-frontmatter-line', view: 'live', selector: '.cm-hmd-frontmatter', expected: 'rgb(134, 135, 136)' },
  { id: 'live-table-line', view: 'live', selector: '.HyperMD-table-line', expected: 'rgb(137, 138, 139)' },
  { id: 'live-table-cell', view: 'live', selector: '.cm-table-cell', expected: 'rgb(140, 141, 142)' },
  { id: 'live-link', view: 'live', selector: '.cm-link', expected: 'rgb(143, 144, 145)' },
  { id: 'live-wikilink', view: 'live', selector: '.cm-hmd-internal-link', expected: 'rgb(146, 147, 148)' },
  { id: 'reading-heading', view: 'reading', selector: '.markdown-preview-view h1', expected: 'rgb(151, 152, 153)' },
  { id: 'reading-paragraph', view: 'reading', selector: '.markdown-preview-view p', expected: 'rgb(154, 155, 156)' },
  { id: 'reading-blockquote', view: 'reading', selector: '.markdown-preview-view blockquote', expected: 'rgb(157, 158, 159)' },
  { id: 'reading-list', view: 'reading', selector: '.markdown-preview-view ul', expected: 'rgb(160, 161, 162)' },
  { id: 'reading-task', view: 'reading', selector: '.markdown-preview-view .task-list-item', expected: 'rgb(163, 164, 165)' },
  { id: 'reading-task-checkbox', view: 'reading', selector: '.markdown-preview-view .task-list-item input[type="checkbox"]', expected: 'rgb(166, 167, 168)' },
  { id: 'reading-code-block', view: 'reading', selector: '.markdown-preview-view pre', expected: 'rgb(169, 170, 171)' },
  { id: 'reading-hr', view: 'reading', selector: '.markdown-preview-view hr', expected: 'rgb(172, 173, 174)' },
  { id: 'reading-table', view: 'reading', selector: '.markdown-preview-view table', expected: 'rgb(175, 176, 177)' },
  { id: 'reading-frontmatter', view: 'reading', selector: '.markdown-preview-view .markdown-frontmatter', expected: 'rgb(178, 179, 180)' },
  { id: 'reading-link', view: 'reading', selector: '.markdown-preview-view a', expected: 'rgb(181, 182, 183)' },
  { id: 'reading-wikilink', view: 'reading', selector: '.markdown-preview-view a.internal-link', expected: 'rgb(184, 185, 186)' },
  { id: 'inline-strong-reading', view: 'reading', selector: '.markdown-preview-view strong', expected: 'rgb(187, 188, 189)' },
]

/**
 * direct 级 DOM 别名发射表（发射侧 import 拼类名用）：把 OBSIDIAN_DOM_ALIASES
 * 展平为「vsidian 单类名 → 别名串」帮助函数集合。发射处不手写 Obsidian 字面量。
 */
export function joinObsidianAlias(vsidianClass: string, aliases: readonly string[]): string {
  return aliases.length === 0 ? vsidianClass : `${vsidianClass} ${aliases.join(' ')}`
}

/** vsidian 单类名 → 承接的 Obsidian 别名（由 OBSIDIAN_DOM_ALIASES 派生；含阅读侧） */
const DOM_ALIAS_BY_VSIDIAN_CLASS: ReadonlyMap<string, readonly string[]> = (() => {
  const m = new Map<string, readonly string[]>()
  m.set('vsidian-view-live', OBSIDIAN_DOM_ALIASES.liveContainer)
  m.set('vsidian-view-reading', OBSIDIAN_DOM_ALIASES.readingContainer)
  for (const lv of [1, 2, 3, 4, 5, 6]) {
    m.set(`vsidian-heading-line-${lv}`, OBSIDIAN_DOM_ALIASES.headingLine(lv))
    m.set(`vsidian-header-${lv}`, OBSIDIAN_DOM_ALIASES.headerSpan(lv))
  }
  m.set('vsidian-strong', OBSIDIAN_DOM_ALIASES.strong)
  m.set('vsidian-emphasis', OBSIDIAN_DOM_ALIASES.emphasis)
  m.set('vsidian-inline-code', OBSIDIAN_DOM_ALIASES.inlineCode)
  m.set('vsidian-highlight', OBSIDIAN_DOM_ALIASES.highlight)
  m.set('vsidian-quote-line', OBSIDIAN_DOM_ALIASES.quoteLine)
  m.set('vsidian-code-line', OBSIDIAN_DOM_ALIASES.codeLine)
  m.set('vsidian-list-line', OBSIDIAN_DOM_ALIASES.listLine)
  m.set('vsidian-hr-line', OBSIDIAN_DOM_ALIASES.hrLine)
  m.set('vsidian-frontmatter-line', OBSIDIAN_DOM_ALIASES.frontmatterLine)
  m.set('vsidian-table-line', OBSIDIAN_DOM_ALIASES.tableLine)
  m.set('vsidian-table-cell', OBSIDIAN_DOM_ALIASES.tableCell)
  m.set('vsidian-link', OBSIDIAN_DOM_ALIASES.link)
  m.set('vsidian-wikilink', OBSIDIAN_DOM_ALIASES.wikilink)
  m.set('vsidian-reading-task', OBSIDIAN_DOM_ALIASES.readingTask)
  m.set('vsidian-reading-frontmatter', OBSIDIAN_DOM_ALIASES.readingFrontmatter)
  return m
})()

/**
 * 装饰/元素类名加工（别名桥 DOM 侧唯一入口）：对类串逐 token 查别名表，
 * 命中的 token 追加其 Obsidian 原名（vsidian 名在前），未承诺的类原样保留。
 * 发射侧（liveDecorations / liveLinks / readingView / syncController 容器）
 * 一律经本函数拼类名——与清单 aliasTargets 的同源性由
 * test/unit/styleContract.test.ts（无孤儿常量）与 test/unit/obsidianAlias.test.ts
 * （发射契约）共同钉住。
 */
export function applyObsidianDomAlias(classAttr: string): string {
  if (!DOM_ALIAS_BY_VSIDIAN_CLASS.size || classAttr.length === 0) {
    return classAttr
  }
  let changed = false
  const parts: string[] = []
  for (const token of classAttr.split(' ')) {
    const aliases = DOM_ALIAS_BY_VSIDIAN_CLASS.get(token)
    if (aliases) {
      parts.push(joinObsidianAlias(token, aliases))
      changed = true
    } else {
      parts.push(token)
    }
  }
  return changed ? parts.join(' ') : classAttr
}

/**
 * 阅读侧别名专用入口：与 live 侧同名的 vsidian 类在阅读上下文承接**不同的**
 * Obsidian 原名（双链 a.internal-link 而非 .cm-hmd-internal-link；任务 li
 * .task-list-item）。返回「vsidian 名 + 别名」串（单类输入；消费处 split 后
 * 逐个 classList.add）。live 侧同名类的别名以 applyObsidianDomAlias 为准。
 */
const READING_ALIAS_PAIRS: ReadonlyArray<[string, readonly string[]]> = [
  ['vsidian-wikilink', OBSIDIAN_DOM_ALIASES.readingWikilink],
  ['vsidian-reading-task', OBSIDIAN_DOM_ALIASES.readingTask],
]
const READING_ALIAS_BY_VSIDIAN_CLASS: ReadonlyMap<string, readonly string[]> = new Map(READING_ALIAS_PAIRS)

export function joinObsidianDomAliasForReading(vsidianClass: string): string {
  const aliases = READING_ALIAS_BY_VSIDIAN_CLASS.get(vsidianClass)
  return aliases ? joinObsidianAlias(vsidianClass, aliases) : vsidianClass
}

