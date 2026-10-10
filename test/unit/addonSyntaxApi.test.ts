// #433 附加组件语法查询面——组合判定纯函数的契约测试。
// 矩阵基线迁移自 #408 评估探针（vsidian-wt-408-assess/probe/probe-fixed.ts
// 的 19 情形与两处行首陷阱），并按 #433 口径扩展：单行 $$x$$ 块、段内
// 形态、嵌套优先级、fm 行内、围栏内字面 $、setext 标题、未闭合块。
// 数据源构造与生产装配同源：tree/fm 走 markdownDoc 同一函数，跨行块表
// 复刻 liveMath.scanAllBlocks 的过滤式（只留跨行块——mathBlocksField 的
// create 路径；SDK 链路测试走真实 field 佐证两者一致）。
import { describe, expect, it } from 'vitest'
import { Text } from '@codemirror/state'
import { docInput, frontmatterRange, FM_SCAN_LIMIT, markdownTreeParser } from '../../src/shared/markdownDoc'
import { scanMathRanges, type MathOccurrence } from '../../src/shared/math'
import {
  addonSyntaxInlineAt,
  addonSyntaxLineTypeAt,
  isAddonSyntaxPos,
  type AddonSyntaxSource,
} from '../../src/shared/addonSyntaxApi'

/** 探针原文样例（#408 评估，19 情形矩阵基线） */
const SAMPLE_LINES = [
  '---', 'title: fm', 'tags: [a]', '---', '',
  '# 标题', '',
  '正文段落 `inline code` 与 $inline math$ 与 ==高亮==。', '',
  '$$', 'block math x = 1', '$$', '',
  '```ts', 'const a = 1', '```', '',
  '| a | b |', '| - | - |', '| 1 | 2 |', '',
  '> quote line', '> [!note] callout', '> callout 内容行', '',
  '- 列表项', '  - 嵌套项', '',
]

/** #433 口径扩展样例：单行闭合块、段内形态、嵌套组合、fm 行内、围栏内
 *  字面 $、围栏内跨行 $$ 块、setext 标题与未闭合块（1-based 行号见矩阵注释） */
const EXT_LINES = [
  '---', // L1 fm 开
  'fmcode: `x` $y$', // L2 fm 行内（源码态：无行内标记语义）
  '---', // L3 fm 闭
  '', // L4
  '$$x$$', // L5 单行闭合块（独占一行 → formula）
  'text $$seg$$ tail', // L6 段内形态（行级 text，行内维度 formula）
  'plain `c` and $m$.', // L7 行内混合
  '- $$x$$', // L8 列表内公式（树优先 → list）
  '> $$q$$', // L9 引用内公式（树优先 → quote）
  '> - qitem', // L10 引用内列表（位置粒度：行首 QuoteMark 处 quote，列表项内容处 list）
  '- > lq', // L11 列表内引用（优先级 list > quote）
  '```', // L12 围栏开
  '$$f$$', // L13 围栏内单行块形态（字面代码）
  '$$', // L14 围栏内跨行块开（块表收、树判 code——代码上下文守卫）
  'a+b', // L15 围栏内跨行块内容（同上）
  '$$', // L16 围栏内跨行块闭（同上）
  '$d$', // L17 围栏内行内 $（字面）
  '```', // L18 围栏闭
  '$$', // L19 未闭合块（不产出 → text）
  '', // L20（隔离行：避免 $$ 行与 setext 例相邻构成 SetextHeading）
  'Setext 题', // L21 setext 内容行
  '===', // L22 setext 下划线行
]

function sourceOf(lines: readonly string[]): { source: AddonSyntaxSource; at: (ln: number, col?: number) => number } {
  const doc = Text.of(lines)
  const tree = markdownTreeParser.parse(docInput(doc))
  const fm = frontmatterRange(doc.sliceString(0, Math.min(doc.length, FM_SCAN_LIMIT)))
  // 与 liveMath.scanAllBlocks 同式：块表只留跨行块（单行形态由判定器
  // 的单行扫描补判，行内 hit 不进块表——否则行内 $…$ 会污染行类型）
  const mathBlocks: readonly MathOccurrence[] = scanMathRanges(lines, 0).filter((hit) =>
    doc.lineAt(hit.from).number !== doc.lineAt(Math.max(0, hit.to - 1)).number)
  return {
    source: { doc, tree, fm, mathBlocks },
    at: (ln: number, col = 0) => Math.min(doc.line(ln).from + col, doc.line(ln).to),
  }
}

describe('pos 守卫（isAddonSyntaxPos）', () => {
  it('非负整数放行；负数、非整数、非数值拒绝', () => {
    expect(isAddonSyntaxPos(0)).toBe(true)
    expect(isAddonSyntaxPos(42)).toBe(true)
    expect(isAddonSyntaxPos(-1)).toBe(false)
    expect(isAddonSyntaxPos(1.5)).toBe(false)
    expect(isAddonSyntaxPos('3')).toBe(false)
    expect(isAddonSyntaxPos(undefined)).toBe(false)
  })
})

describe('lineTypeAt：探针 19 情形矩阵（#408 基线迁移）', () => {
  const { source, at } = sourceOf(SAMPLE_LINES)
  const cases: Array<[number, string, string]> = [
    [1, 'frontmatter', '--- 开'],
    [2, 'frontmatter', 'fm 内容行（树上反语义 SetextHeading2，行首陷阱）'],
    [3, 'frontmatter', 'fm 内容行'],
    [4, 'frontmatter', 'fm 结束行'],
    [6, 'heading', 'ATX 标题'],
    [10, 'formula', '跨行 $$ 开'],
    [11, 'formula', '跨行块内容'],
    [12, 'formula', '跨行 $$ 闭'],
    [14, 'code', '围栏开（行首陷阱：resolve 首节点是 CodeMark）'],
    [15, 'code', '围栏内容'],
    [16, 'code', '围栏闭'],
    [18, 'table', '表头'],
    [19, 'table', '分隔行'],
    [20, 'table', '数据行'],
    [22, 'quote', '引用行'],
    [23, 'quote', 'callout 标记行（一期不入枚举，统一 quote）'],
    [24, 'quote', 'callout 内容行'],
    [26, 'list', '列表项'],
    [27, 'list', '嵌套列表项'],
  ]
  for (const [ln, want, label] of cases) {
    it(`L${ln} ${label} → ${want}`, () => {
      expect(addonSyntaxLineTypeAt(source, at(ln, 0)).kind).toBe(want)
    })
  }
  it('fm 结束行行尾仍在 frontmatter 内（行级口径：行尾是合法光标位）', () => {
    const doc = source.doc
    expect(source.fm).not.toBeNull()
    expect(addonSyntaxLineTypeAt(source, source.fm!.end).kind).toBe('frontmatter')
    expect(doc.lineAt(source.fm!.end).number).toBe(4)
  })
})

describe('lineTypeAt：#433 口径扩展矩阵', () => {
  const { source, at } = sourceOf(EXT_LINES)
  const cases: Array<[number, string, string]> = [
    [2, 'frontmatter', 'fm 内容行'],
    [5, 'formula', '单行闭合块 $$x$$（独占一行）'],
    [6, 'text', '段内 $$…$$（行级仍是文本段落——行内维度见 inlineAt）'],
    [7, 'text', '行内标记混合的普通段落'],
    [8, 'list', '列表内公式（树优先于单行块扫描）'],
    [9, 'quote', '引用内公式（树优先）'],
    [11, 'list', '列表内引用（优先级 list > quote）'],
    [13, 'code', '围栏内的 $$…$$ 单行形态（字面代码）'],
    [14, 'code', '围栏内跨行 $$ 块开行（块表收但代码上下文守卫——字面代码）'],
    [15, 'code', '围栏内跨行 $$ 块内容行（同上）'],
    [16, 'code', '围栏内跨行 $$ 块闭行（同上）'],
    [17, 'code', '围栏内行内 $ 行（字面）'],
    [18, 'code', '围栏闭'],
    [19, 'text', '未闭合 $$（不产出，稳定降级）'],
    [21, 'heading', 'setext 内容行'],
    [22, 'heading', 'setext 下划线行'],
  ]
  for (const [ln, want, label] of cases) {
    it(`L${ln} ${label} → ${want}`, () => {
      expect(addonSyntaxLineTypeAt(source, at(ln, 0)).kind).toBe(want)
    })
  }
  it('L10 引用内列表的位置粒度：行首（QuoteMark 处）quote，列表项内容处 list', () => {
    // 行首链停在 QuoteMark（'>' 字符处）——链式下降按位置走，列表标记
    // 右侧的项内容处链进 BulletList；两种位置各判各的，粒度语义钉住
    expect(addonSyntaxLineTypeAt(source, at(10, 0)).kind).toBe('quote')
    expect(addonSyntaxLineTypeAt(source, at(10, 3)).kind).toBe('list')
  })
})

describe('inlineAt：行内标记点位（code / formula / none）', () => {
  const sample = sourceOf(SAMPLE_LINES)
  it('探针点位：行内代码/行内公式/高亮/普通文本（#408 基线迁移）', () => {
    const line = SAMPLE_LINES[7]!
    const mid = (needle: string): number => sample.at(8, line.indexOf(needle) + Math.floor(needle.length / 2))
    expect(addonSyntaxInlineAt(sample.source, mid('inline code')).kind).toBe('code')
    expect(addonSyntaxInlineAt(sample.source, mid('inline math')).kind).toBe('formula')
    expect(addonSyntaxInlineAt(sample.source, mid('高亮')).kind).toBe('none')
    expect(addonSyntaxInlineAt(sample.source, sample.at(8, 0)).kind).toBe('none')
  })

  const ext = sourceOf(EXT_LINES)
  it('fm 行内的 `x` 与 $y$ 均为 none（fm 是源码态）', () => {
    const line = EXT_LINES[1]!
    expect(addonSyntaxInlineAt(ext.source, ext.at(2, line.indexOf('`x`') + 1)).kind).toBe('none')
    expect(addonSyntaxInlineAt(ext.source, ext.at(2, line.indexOf('$y$') + 1)).kind).toBe('none')
  })
  it('单行闭合块与段内形态的公式位置 → formula；行外位置 → none', () => {
    expect(addonSyntaxInlineAt(ext.source, ext.at(5, 3)).kind).toBe('formula')
    expect(addonSyntaxInlineAt(ext.source, ext.at(6, EXT_LINES[5]!.indexOf('seg') + 1)).kind).toBe('formula')
    expect(addonSyntaxInlineAt(ext.source, ext.at(6, 0)).kind).toBe('none')
  })
  it('行内 code 与行内 $ 同行并存：各自位置判各自的', () => {
    const line = EXT_LINES[6]!
    expect(addonSyntaxInlineAt(ext.source, ext.at(7, line.indexOf('`c`') + 1)).kind).toBe('code')
    expect(addonSyntaxInlineAt(ext.source, ext.at(7, line.indexOf('$m$') + 1)).kind).toBe('formula')
  })
  it('跨行公式块内的位置 → formula；围栏内的 $ 与 $$ 形态 → none（字面代码）', () => {
    expect(addonSyntaxInlineAt(sample.source, sample.at(11, 2)).kind).toBe('formula')
    expect(addonSyntaxInlineAt(ext.source, ext.at(13, 2)).kind).toBe('none')
    expect(addonSyntaxInlineAt(ext.source, ext.at(17, 1)).kind).toBe('none')
    // 围栏内跨行块的三行：与行类型同口径——代码上下文内 $ 是字面
    expect(addonSyntaxInlineAt(ext.source, ext.at(15, 1)).kind).toBe('none')
  })})

describe('nodeNames 诊断载荷（非稳定快照，存在性与如实性）', () => {
  const ext = sourceOf(EXT_LINES)
  it('空文档（Text.of([""])）：两查询不抛错、落 text/none（评审 R2 边界钉住）', () => {
    const empty = sourceOf([''])
    expect(addonSyntaxLineTypeAt(empty.source, 0).kind).toBe('text')
    expect(addonSyntaxInlineAt(empty.source, 0).kind).toBe('none')
  })
  it('普通段落行返回非空祖先链；fm 内容行如实快照树上反语义节点', () => {
    const plain = addonSyntaxLineTypeAt(ext.source, ext.at(7, 0))
    expect(Array.isArray(plain.nodeNames)).toBe(true)
    expect(plain.nodeNames.length).toBeGreaterThan(0)
    // fm 在树上反语义（内容行 + 结束 --- 构成 SetextHeading2）——快照
    // 如实返回该节点名，这正是诊断载荷的用途（组件作者可见平台树形态）
    const fm = addonSyntaxLineTypeAt(ext.source, ext.at(2, 2))
    expect(fm.kind).toBe('frontmatter')
    expect(fm.nodeNames.some((name) => name.startsWith('SetextHeading'))).toBe(true)
  })
  it('树不在场（装配防御位）：树枚举退化不命中，fm/单行扫描判定照走', () => {
    const degraded: AddonSyntaxSource = { ...ext.source, tree: undefined }
    expect(addonSyntaxLineTypeAt(degraded, ext.at(5, 2)).kind).toBe('formula')
    expect(addonSyntaxLineTypeAt(degraded, ext.at(7, 0)).kind).toBe('text')
    // 围栏识别依赖树：无树时 L13 的 $$f$$ 按单行闭合块判定为 formula
    // （降级语义——防御位只保证不抛错与判定链照走，不承诺与有树一致）
    expect(addonSyntaxLineTypeAt(degraded, ext.at(13, 0)).kind).toBe('formula')
    expect(addonSyntaxLineTypeAt(degraded, ext.at(2, 0)).kind).toBe('frontmatter')
    expect(addonSyntaxLineTypeAt(degraded, ext.at(7, 0)).nodeNames).toEqual([])
  })
})
