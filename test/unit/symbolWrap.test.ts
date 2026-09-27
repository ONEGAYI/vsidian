// 选区包裹注册表扩展与包裹计划契约（工单 #124）：注册表为每个符号显式
// 登记「有选区键入时的包裹能力」（selectionWrap），与无选区自动补全、
// Tab 可导航节点是三个不同集合——本测试钉住：包裹清单逐项显式登记、
// 包裹计划纯函数（拆段/空行保留/选区映射）的行为契约，以及「重复包裹
// 是叠加、不是切换」的路径语义（区别于格式按钮的两态切换）。
import { describe, expect, it } from 'vitest'
import {
  SYMBOL_AUTOCLOSE_REGISTRY,
  findSelectionWrapEntry,
  shouldSelectionWrap,
  type SymbolPairEntry,
} from '../../src/shared/symbols'
import { planSelectionWrap } from '../../src/shared/symbolWrap'

const byOpen = (open: string): SymbolPairEntry =>
  SYMBOL_AUTOCLOSE_REGISTRY.find((entry) => entry.open === open)!

const star = byOpen('*')
const bracket = byOpen('[')
const curlyQuote = byOpen('“')

describe('注册表包裹能力登记（#124）', () => {
  it('全部 18 项显式登记 selectionWrap：括号、引号、Markdown 触发符逐项可包裹', () => {
    expect(SYMBOL_AUTOCLOSE_REGISTRY.every((entry) => entry.selectionWrap === true)).toBe(true)
  })

  it('findSelectionWrapEntry 按 open 命中：星号/下划线/波浪号/反引号/等号/美元符', () => {
    for (const open of ['*', '_', '~', '`', '=', '$']) {
      expect(findSelectionWrapEntry(open)?.open).toBe(open)
    }
  })

  it('方括号命中同一注册项（重复输入形成 [[wikilink]] 类结构）', () => {
    expect(findSelectionWrapEntry('[')?.close).toBe(']')
  })

  it('键入 close 字符不触发包裹（只认起始符号）', () => {
    expect(findSelectionWrapEntry(')')).toBeNull()
    expect(findSelectionWrapEntry(']')).toBeNull()
    expect(findSelectionWrapEntry('”')).toBeNull()
  })

  it('英文尖括号不在包裹集合', () => {
    expect(findSelectionWrapEntry('<')).toBeNull()
    expect(findSelectionWrapEntry('>')).toBeNull()
  })

  it('包裹集合与补全集合字段独立：包裹判定不经邻接抑制（选区意图明确）', () => {
    // 与 shouldAutoclose 的差异契约：词中/转义邻接是「无选区防误触」，
    // 有选区时用户已圈定范围，包裹不做词中抑制
    expect(findSelectionWrapEntry("'")).not.toBeNull()
    expect(findSelectionWrapEntry('"')).not.toBeNull()
  })
})

describe('shouldSelectionWrap：代码上下文门控', () => {
  it.each(SYMBOL_AUTOCLOSE_REGISTRY.filter((e) => e.kind === 'markdown').map((e) => [e.open, e]))(
    '%s：代码上下文不包裹（Markdown 强调不改写代码）',
    (_open, entry) => {
      expect(shouldSelectionWrap(entry, { inCode: true })).toBe(false)
    },
  )

  it.each(SYMBOL_AUTOCLOSE_REGISTRY.filter((e) => e.kind !== 'markdown').map((e) => [e.open, e]))(
    '%s：代码上下文允许包裹（括号引号照常）',
    (_open, entry) => {
      expect(shouldSelectionWrap(entry, { inCode: true })).toBe(true)
    },
  )

  it('正文上下文全部允许包裹', () => {
    for (const entry of SYMBOL_AUTOCLOSE_REGISTRY) {
      expect(shouldSelectionWrap(entry, { inCode: false })).toBe(true)
    }
  })
})

describe('包裹计划纯函数：单段（#124）', () => {
  it('选中 text 键星号：两侧插入、选区保持原文覆盖（正向）', () => {
    const plan = planSelectionWrap('hello text', [{ from: 6, to: 10 }], star)!
    expect(plan).not.toBeNull()
    expect(plan.changes).toEqual([
      { from: 6, to: 6, insert: '*' },
      { from: 10, to: 10, insert: '*' },
    ])
    // 产物 *text*：原文新坐标 7..11，保持选中
    expect(plan.selection).toEqual([{ anchor: 7, head: 11 }])
  })

  it('连续第二键在原文两侧再包裹：得到 **text**（叠加而非切换）', () => {
    const first = planSelectionWrap('hello text', [{ from: 6, to: 10 }], star)!
    const applied = applyPlan('hello text', first)
    expect(applied).toBe('hello *text*')
    // 第二轮选区仍是原文（first.selection），不得把第一轮标记当原文
    const second = planSelectionWrap(applied, asRanges(first.selection), star)!
    expect(applyPlan(applied, second)).toBe('hello **text**')
    expect(second.selection).toEqual([{ anchor: 8, head: 12 }])
  })

  it('括号包裹使用 open/close 两侧形态', () => {
    const plan = planSelectionWrap('a go b', [{ from: 2, to: 4 }], bracket)!
    expect(applyPlan('a go b', plan)).toBe('a [go] b')
    const second = planSelectionWrap('a [go] b', asRanges(plan.selection), bracket)!
    expect(applyPlan('a [go] b', second)).toBe('a [[go]] b')
    // [[go]] 是 wikilink 类结构：原文仍保持选中
    expect(second.selection).toEqual([{ anchor: 4, head: 6 }])
  })

  it('弯引号包裹：选区两侧各得开/闭引号', () => {
    const plan = planSelectionWrap('说 word 吧', [{ from: 2, to: 6 }], curlyQuote)!
    expect(applyPlan('说 word 吧', plan)).toBe('说 “word” 吧')
  })

  it('首尾空白随被选部分整体包裹（只包裹被选部分，不修剪）', () => {
    const plan = planSelectionWrap('x word y', [{ from: 1, to: 7 }], star)!
    expect(applyPlan('x word y', plan)).toBe('x* word *y')
    expect(plan.selection).toEqual([{ anchor: 2, head: 8 }])
  })

  it('首尾部分选中只包裹被选部分：段落首尾前缀不扩散', () => {
    const plan = planSelectionWrap('前段中后', [{ from: 2, to: 3 }], star)!
    expect(applyPlan('前段中后', plan)).toBe('前段*中*后')
  })
})

describe('包裹计划纯函数：跨段（#124）', () => {
  it('选 甲段\\n\\n乙段：各段分别包裹、空行数量不变、选区为各段原文', () => {
    const text = '甲段\n\n乙段'
    const plan = planSelectionWrap(text, [{ from: 0, to: text.length }], star)!
    expect(applyPlan(text, plan)).toBe('*甲段*\n\n*乙段*')
    expect(plan.selection).toEqual([
      { anchor: 1, head: 3 },
      { anchor: 7, head: 9 },
    ])
  })

  it('第二键得 **甲段**\\n\\n**乙段**：不得把第一轮标记当原文包裹', () => {
    const text = '甲段\n\n乙段'
    const first = planSelectionWrap(text, [{ from: 0, to: text.length }], star)!
    const applied = applyPlan(text, first)
    const second = planSelectionWrap(applied, asRanges(first.selection), star)!
    expect(applyPlan(applied, second)).toBe('**甲段**\n\n**乙段**')
    expect(second.selection).toEqual([
      { anchor: 2, head: 4 },
      { anchor: 10, head: 12 },
    ])
  })

  it('多个空行原样保留', () => {
    const text = '甲\n\n\n\n乙'
    const plan = planSelectionWrap(text, [{ from: 0, to: text.length }], star)!
    expect(applyPlan(text, plan)).toBe('*甲*\n\n\n\n*乙*')
  })

  it('含空白的空行序列按空行处理（空白行不包裹）', () => {
    const text = '甲\n  \n乙'
    const plan = planSelectionWrap(text, [{ from: 0, to: text.length }], star)!
    expect(applyPlan(text, plan)).toBe('*甲*\n  \n*乙*')
  })

  it('空段不包裹：首尾空白行只保留不包裹', () => {
    const text = '\n\n甲段\n\n'
    const plan = planSelectionWrap(text, [{ from: 0, to: text.length }], star)!
    expect(applyPlan(text, plan)).toBe('\n\n*甲段*\n\n')
    expect(plan.selection).toEqual([{ anchor: 3, head: 5 }])
  })

  it('单换行不拆段（同段软换行语义），自动折行无换行符天然不拆', () => {
    const text = '甲行\n乙行'
    const plan = planSelectionWrap(text, [{ from: 0, to: text.length }], star)!
    expect(applyPlan(text, plan)).toBe('*甲行\n乙行*')
    expect(plan.selection).toEqual([{ anchor: 1, head: 6 }])
  })

  it('跨段两端部分选中：各段只包被选部分', () => {
    const text = '甲段首\n\n乙段尾'
    // 选 「段首\n\n乙段尾」：第一段被选部分是「段首」，第二段是「乙段尾」
    const plan = planSelectionWrap(text, [{ from: 1, to: 8 }], star)!
    expect(applyPlan(text, plan)).toBe('甲*段首*\n\n*乙段尾*')
    expect(plan.selection).toEqual([
      { anchor: 2, head: 4 },
      { anchor: 8, head: 11 },
    ])
  })

  it('纯空白选区返回 null（不接管）', () => {
    expect(planSelectionWrap('甲\n\n乙', [{ from: 1, to: 3 }], star)).toBeNull()
    expect(planSelectionWrap('  ', [{ from: 0, to: 2 }], star)).toBeNull()
  })

  it('选区含空行且首尾也含空白的混合形态：只包非空白块', () => {
    const text = 'a \n\n b'
    const plan = planSelectionWrap(text, [{ from: 0, to: text.length }], star)!
    expect(applyPlan(text, plan)).toBe('*a *\n\n* b*')
  })
})

describe('包裹计划纯函数：多 range（#124 连续包裹的输入形态）', () => {
  it('两个原文 range 各自独立包裹、坐标互不串位', () => {
    const text = '*甲段*\n\n*乙段*'
    // 第一轮包裹后的原文 range（多 range 选区形态）
    const plan = planSelectionWrap(text, [
      { from: 1, to: 3 },
      { from: 7, to: 9 },
    ], star)!
    expect(applyPlan(text, plan)).toBe('**甲段**\n\n**乙段**')
    expect(plan.selection).toEqual([
      { anchor: 2, head: 4 },
      { anchor: 10, head: 12 },
    ])
  })

  it('range 覆盖不同段落时同样按段拆分', () => {
    const text = '前A\n\nB后\n\nC'
    const plan = planSelectionWrap(text, [{ from: 1, to: 9 }], star)!
    expect(applyPlan(text, plan)).toBe('前*A*\n\n*B后*\n\n*C*')
  })

  it('任一 range 为空返回 null（不接管空光标混合形态）', () => {
    expect(planSelectionWrap('ab', [{ from: 0, to: 1 }, { from: 2, to: 2 }], star)).toBeNull()
  })

  it('无有效块返回 null', () => {
    expect(planSelectionWrap('abc', [], star)).toBeNull()
  })

  it('changes 按 from 升序（可直接作为 CM6 事务变更组）', () => {
    const text = '甲段\n\n乙段\n\n丙段'
    const plan = planSelectionWrap(text, [{ from: 0, to: text.length }], star)!
    const froms = plan!.changes.map((change) => change.from)
    expect([...froms].sort((a, b) => a - b)).toEqual(froms)
  })
})

/** 测试辅助：把计划产物的原文选区（anchor/head）转回输入 range 形态，
 *  模拟「第二轮以第一轮原文选区继续包裹」的调用形态 */
function asRanges(selection: { anchor: number; head: number }[]): { from: number; to: number }[] {
  return selection.map((range) => ({ from: range.anchor, to: range.head }))
}

/** 测试辅助：把计划应用到文本（模拟事务结果），仅供断言产物 */
function applyPlan(text: string, plan: { changes: { from: number; to: number; insert: string }[] }): string {
  let out = text
  for (const change of [...plan.changes].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, change.from) + change.insert + out.slice(change.to)
  }
  return out
}
