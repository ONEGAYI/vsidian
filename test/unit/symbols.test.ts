// 符号自动补全注册表契约（工单 #123）：符号清单、逐项触发/闭合越过/
// 相邻字符抑制条件的参数化断言。注册表是符号输入辅助（#123 自动补全、
// #124 选区包裹、#125 Tab 越界）的共享符号元数据单一事实源——本测试钉住
// 「每项显式登记」的承诺：未登记的符号（英文尖括号）默认不自动补全。
import { describe, expect, it } from 'vitest'
import {
  SYMBOL_AUTOCLOSE_REGISTRY,
  TAB_ESCAPE_TREE_NODE_NAMES,
  findAutocloseEntry,
  shouldAutoclose,
  type AutocloseContext,
  type SymbolPairEntry,
} from '../../src/shared/symbols'

/** 中性上下文：行首/行尾、无同字符前驱、非代码 */
const NEUTRAL: AutocloseContext = { charBefore: '', charAfter: '', runBefore: 0, inCode: false }
const ctx = (patch: Partial<AutocloseContext>): AutocloseContext => ({ ...NEUTRAL, ...patch })

const byOpen = (open: string): SymbolPairEntry =>
  SYMBOL_AUTOCLOSE_REGISTRY.find((entry) => entry.open === open)!

describe('注册表清单契约（#123）', () => {
  it('登记 18 项：8 括号 + 4 引号 + 6 Markdown 触发符，无重复 open', () => {
    expect(SYMBOL_AUTOCLOSE_REGISTRY).toHaveLength(18)
    expect(new Set(SYMBOL_AUTOCLOSE_REGISTRY.map((e) => e.open)).size).toBe(18)
  })

  it('括号对：() [] {} 与全角（）【】《》「」『』', () => {
    for (const [open, close] of [
      ['(', ')'], ['[', ']'], ['{', '}'],
      ['（', '）'], ['【', '】'], ['《', '》'], ['「', '」'], ['『', '』'],
    ] as const) {
      expect(byOpen(open).close).toBe(close)
      expect(byOpen(open).kind).toBe('bracket')
    }
  })

  it('引号对：弯双/弯单与英文单双引号（英文引号自反：open === close）', () => {
    expect(byOpen('“').close).toBe('”')
    expect(byOpen('‘').close).toBe('’')
    expect(byOpen('"').close).toBe('"')
    expect(byOpen("'").close).toBe("'")
    for (const open of ['“', '‘', '"', "'"]) {
      expect(byOpen(open).kind).toBe('quote')
    }
  })

  it('Markdown 触发符：* _ ~ ` = $ 均为自反符号', () => {
    for (const open of ['*', '_', '~', '`', '=', '$']) {
      const entry = byOpen(open)
      expect(entry.close).toBe(open)
      expect(entry.kind).toBe('markdown')
      expect(entry.mirrorAtRunStartOnly).toBe(true)
    }
  })

  it('英文尖括号默认不注册：findAutocloseEntry 返回 null', () => {
    expect(findAutocloseEntry('<')).toBeNull()
    expect(findAutocloseEntry('>')).toBeNull()
    expect(SYMBOL_AUTOCLOSE_REGISTRY.some((e) => e.open === '<' || e.close === '>')).toBe(false)
  })

  it('全部 open/close 为单 UTF-16 码元（位置状态可按 ±1 平移）', () => {
    for (const entry of SYMBOL_AUTOCLOSE_REGISTRY) {
      expect(entry.open.length).toBe(1)
      expect(entry.close.length).toBe(1)
    }
  })

  it('findAutocloseEntry 按 open 与 close 双向命中（越过判定用 close 查询）', () => {
    expect(findAutocloseEntry('(')?.close).toBe(')')
    // 闭合越过：键入 close 字符命中同一注册项（markdown 自反天然命中）
    expect(findAutocloseEntry(')')).toBe(findAutocloseEntry('('))
    expect(findAutocloseEntry('”')).toBe(findAutocloseEntry('“'))
    expect(findAutocloseEntry('x')).toBeNull()
  })
})

describe('逐注册项：触发与上下文排除（参数化）', () => {
  it.each(SYMBOL_AUTOCLOSE_REGISTRY.map((e) => [e.open, e]))('%s：中性上下文触发补全', (_open, entry) => {
    expect(shouldAutoclose(entry, NEUTRAL)).toBe(true)
  })

  it.each(SYMBOL_AUTOCLOSE_REGISTRY.map((e) => [e.open, e]))('%s：左邻反斜杠（转义）一律抑制', (_open, entry) => {
    expect(shouldAutoclose(entry, ctx({ charBefore: '\\' }))).toBe(false)
  })

  it.each(SYMBOL_AUTOCLOSE_REGISTRY.filter((e) => e.kind !== 'markdown').map((e) => [e.open, e]))(
    '%s：代码上下文允许配对（行内代码/代码块内括号引号照补）', (_open, entry) => {
      expect(entry.allowInCode).toBe(true)
      expect(shouldAutoclose(entry, ctx({ inCode: true }))).toBe(true)
    },
  )

  it.each(SYMBOL_AUTOCLOSE_REGISTRY.filter((e) => e.kind === 'markdown').map((e) => [e.open, e]))(
    '%s：代码上下文抑制（Markdown 强调不改写代码）', (_open, entry) => {
      expect(entry.allowInCode).toBe(false)
      expect(shouldAutoclose(entry, ctx({ inCode: true }))).toBe(false)
    },
  )
})

describe('Markdown 触发符的邻接规则（#123 显式登记）', () => {
  const marks = ['*', '_', '~', '`', '=', '$']

  it.each(marks)('%s：光标左侧已有同字符（连续串非首）不补——星号契约第三步禁补对', (open) => {
    expect(shouldAutoclose(byOpen(open), ctx({ runBefore: 1 }))).toBe(false)
    expect(shouldAutoclose(byOpen(open), ctx({ runBefore: 3 }))).toBe(false)
  })

  it.each(marks)('%s：右邻字母/数字（词中间）不补——防误触闭合输入', (open) => {
    expect(shouldAutoclose(byOpen(open), ctx({ charAfter: 'a' }))).toBe(false)
    expect(shouldAutoclose(byOpen(open), ctx({ charAfter: '7' }))).toBe(false)
    expect(shouldAutoclose(byOpen(open), ctx({ charAfter: '文' }))).toBe(false)
  })

  it.each(marks)('%s：右邻空白/标点/行尾放行', (open) => {
    expect(shouldAutoclose(byOpen(open), ctx({ charAfter: ' ' }))).toBe(true)
    expect(shouldAutoclose(byOpen(open), ctx({ charAfter: ',' }))).toBe(true)
    expect(shouldAutoclose(byOpen(open), ctx({ charAfter: '' }))).toBe(true)
  })
})

describe('英文单引号的撇号防误触（#123）', () => {
  it('词中/词尾撇号按普通文字处理：左邻字母数字不补', () => {
    expect(shouldAutoclose(byOpen("'"), ctx({ charBefore: 't' }))).toBe(false)
    expect(shouldAutoclose(byOpen("'"), ctx({ charBefore: 's' }))).toBe(false)
    expect(shouldAutoclose(byOpen("'"), ctx({ charBefore: '7' }))).toBe(false)
    expect(shouldAutoclose(byOpen("'"), ctx({ charBefore: '文' }))).toBe(false)
  })

  it('行首/空白后仍配对', () => {
    expect(shouldAutoclose(byOpen("'"), ctx({ charBefore: ' ' }))).toBe(true)
    expect(shouldAutoclose(byOpen("'"), NEUTRAL)).toBe(true)
  })

  it('英文双引号不做撇号抑制（词尾键入照常配对）', () => {
    expect(shouldAutoclose(byOpen('"'), ctx({ charBefore: 't' }))).toBe(true)
  })
})

describe('Tab 越界能力登记（#125）', () => {
  it('括号与引号（12 项）显式登记 tabEscape：行内匹配路径', () => {
    for (const entry of SYMBOL_AUTOCLOSE_REGISTRY) {
      if (entry.kind === 'bracket' || entry.kind === 'quote') {
        expect(entry.tabEscape, `${entry.open} 应登记 tabEscape`).toBe(true)
      }
    }
  })

  it('Markdown 触发符中 * _ ~ ` = 登记 tabEscape（对应树围栏），$ 不登记（显式决策）', () => {
    for (const open of ['*', '_', '~', '`', '=']) {
      expect(byOpen(open).tabEscape, `${open} 应登记 tabEscape`).toBe(true)
    }
    // $ 与 wikilink 无语法节点结构：行内扫描配对的边界语义与公式/双链
    // 形态学（KaTeX 渲染范围、alias 竖线）不一致，最小样例先行不含它们
    expect(byOpen('$').tabEscape).toBeUndefined()
  })

  it('英文尖括号不在 Tab 越界集合', () => {
    expect(SYMBOL_AUTOCLOSE_REGISTRY.some((e) => e.open === '<' && e.tabEscape)).toBe(false)
  })

  it('Tab 可导航树围栏节点集合：五个行内结构节点（与 markdown tabEscape 项对应）', () => {
    expect([...TAB_ESCAPE_TREE_NODE_NAMES].sort()).toEqual(
      ['Emphasis', 'Highlight', 'InlineCode', 'Strikethrough', 'StrongEmphasis'],
    )
  })
})
