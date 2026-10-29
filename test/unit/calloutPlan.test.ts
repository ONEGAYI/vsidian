// Callout 源文转换规划契约（#656/T05）：插入／转换／改类型／无 Callout 的
// 精确原文契约（规格 docs/specs/callout.md §6）。断言一律逐字节比对产物
// 原文（应用变更集后的全文），并核对完成后选区（选中类型名）——TDD 先红
// 后绿的红的载体。目标解析（最内层 callout 树解析）归 webview 层
// （liveCallout.test.ts 家族）；本文件只钉规划器纯函数语义。
import { describe, expect, it } from 'vitest'
import {
  CALLOUT_TYPE_IDS,
  docLinesOf,
  planCalloutRemove,
  planCalloutRetype,
  planCalloutWrap,
  type CalloutPlanTarget,
} from '../../src/shared/calloutPlan'
import { parseCalloutDecl } from '../../src/shared/calloutSyntax'

/** 行级应用变更集 → 产物全文（CM6 多段变更同一语义；from 升序无重叠） */
function applyPlan(text: string, changes: ReadonlyArray<{ from: number; to: number; insert: string }>): string {
  let out = text
  for (const change of [...changes].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, change.from) + change.insert + out.slice(change.to)
  }
  return out
}

/** 从夹具构造目标 callout（识别单一事实源 parseCalloutDecl；行号 1-based，
 *  markerFrom 按「标题行引用前缀之后的段起点」计算） */
function targetOf(text: string, titleLineNo: number, lastLineNo: number, hasBody: boolean): CalloutPlanTarget {
  const lines = text.split('\n')
  const line = lines[titleLineNo - 1]!
  const prefix = /^(?:\s*>\s?)+/.exec(line)![0]!
  const decl = parseCalloutDecl(line.slice(prefix.length))
  if (!decl) {
    throw new Error(`夹具标题行不是成型声明：${line}`)
  }
  let markerFrom = 0
  for (let i = 0; i < titleLineNo - 1; i++) {
    markerFrom += lines[i]!.length + 1
  }
  markerFrom += prefix.length
  return { decl, markerFrom, titleLineNo, lastLineNo, hasBody }
}

describe('planCalloutWrap：普通正文插入／转换（§6.1）', () => {
  it('空行无选区创建骨架：写入声明行并选中类型名', () => {
    const text = 'aaa\n\nbbb\n'
    // 光标在行 2（空行，LF 偏移 4）
    const plan = planCalloutWrap(text, 4, 4, 'note')
    expect(plan).not.toBeNull()
    const out = applyPlan(text, plan!.changes)
    expect(out).toBe('aaa\n> [!note]\nbbb\n')
    // 选中 note（`> [!` 之后 4 字符）
    expect(plan!.selection).toEqual({ anchor: 8, head: 12 })
  })

  it('带缩进的空行保留缩进（引用插入同口径）', () => {
    const text = 'x\n   \ny\n'
    const plan = planCalloutWrap(text, 4, 4, 'tip')
    expect(applyPlan(text, plan!.changes)).toBe('x\n   > [!tip]\ny\n')
    // 行 2 起点 2，插入串 `   > [!tip]`：tip 在文档 [2+3+4, 2+3+4+3)
    expect(plan!.selection).toEqual({ anchor: 9, head: 12 })
  })

  it('无选区非空行转换当前段落（空行分界，整段逐行补容器前缀）', () => {
    const text = 'para one\npara two\n\nother\n'
    // 光标在行 2 中部（LF 偏移 11）
    const plan = planCalloutWrap(text, 11, 11, 'note')
    expect(applyPlan(text, plan!.changes)).toBe('> [!note]\n> para one\n> para two\n\nother\n')
  })

  it('单行段落（前后空行）只包一行', () => {
    const text = 'before\n\nsingle\n\nafter\n'
    const plan = planCalloutWrap(text, 10, 10, 'note')
    expect(applyPlan(text, plan!.changes)).toBe('before\n\n> [!note]\n> single\n\nafter\n')
  })

  it('跨行选区扩展到完整行，空行留在所建容器内（> 空引用行）', () => {
    const text = 'l1\n\nl2\n'
    // 选区覆盖行 1 起到行 3 中部
    const plan = planCalloutWrap(text, 0, 7, 'note')
    expect(applyPlan(text, plan!.changes)).toBe('> [!note]\n> l1\n>\n> l2\n')
  })

  it('选区终点落在行首时不包含该行（行起点 < to 口径）', () => {
    const text = 'l1\nl2\n'
    // to = 3 恰是行 2 行首：行 2 不在选区
    const plan = planCalloutWrap(text, 0, 3, 'note')
    expect(applyPlan(text, plan!.changes)).toBe('> [!note]\n> l1\nl2\n')
  })

  it('选区含列表行：列表源文保持内部结构，整体进容器', () => {
    const text = '- a\n- b\n'
    const plan = planCalloutWrap(text, 0, text.length, 'note')
    expect(applyPlan(text, plan!.changes)).toBe('> [!note]\n> - a\n> - b\n')
  })

  it('选区含代码围栏：围栏行逐行补前缀，围栏结构保持', () => {
    const text = '```js\ncode()\n```\n'
    const plan = planCalloutWrap(text, 0, text.length, 'note')
    expect(applyPlan(text, plan!.changes)).toBe('> [!note]\n> ```js\n> code()\n> ```\n')
  })

  it('选区含普通引用行：再加一层引用前缀形成嵌套', () => {
    const text = '> q\n'
    const plan = planCalloutWrap(text, 0, text.length, 'note')
    expect(applyPlan(text, plan!.changes)).toBe('> [!note]\n> > q\n')
  })

  it('行内选区（同段内部分字符）扩展为整行包裹', () => {
    const text = 'abcdef\n'
    const plan = planCalloutWrap(text, 2, 4, 'note')
    expect(applyPlan(text, plan!.changes)).toBe('> [!note]\n> abcdef\n')
  })

  it('选区到文档末尾（末行无换行）', () => {
    const text = 'x\ntail'
    const plan = planCalloutWrap(text, 2, 5, 'note')
    expect(applyPlan(text, plan!.changes)).toBe('x\n> [!note]\n> tail')
  })

  it('菜单选具体类型写入所选类型并选中该类型名', () => {
    const text = '\n'
    const plan = planCalloutWrap(text, 0, 0, 'warning')
    expect(applyPlan(text, plan!.changes)).toBe('> [!warning]\n')
    expect(plan!.selection).toEqual({ anchor: 4, head: 11 })
  })

  it('缩进行保持原缩进于容器内', () => {
    const text = '  - item\n'
    const plan = planCalloutWrap(text, 4, 4, 'note')
    expect(applyPlan(text, plan!.changes)).toBe('> [!note]\n>   - item\n')
  })
})

describe('planCalloutRetype：类型切换（§6.1 已有 callout 内）', () => {
  it('改类型保留折叠符号与显式标题，完成后选中类型名', () => {
    const text = '> [!note]+ 标题\n> 正文\n'
    const target = targetOf(text, 1, 2, true)
    const plan = planCalloutRetype(target, 'tip')
    expect(plan).not.toBeNull()
    expect(applyPlan(text, plan!.changes)).toBe('> [!tip]+ 标题\n> 正文\n')
    expect(plan!.selection).toEqual({ anchor: 4, head: 7 })
  })

  it('与当前类型一致返回 null（零编辑零撤销项）', () => {
    const text = '> [!note]\n> 正文\n'
    const target = targetOf(text, 1, 2, true)
    expect(planCalloutRetype(target, 'note')).toBeNull()
  })

  it('无标题无折叠的声明同样只替换类型名区间', () => {
    const text = 'intro\n> [!info]\n> b\n'
    const target = targetOf(text, 2, 3, true)
    const plan = planCalloutRetype(target, 'danger')
    expect(applyPlan(text, plan!.changes)).toBe('intro\n> [!danger]\n> b\n')
    expect(plan!.selection).toEqual({ anchor: 10, head: 16 })
  })

  it('嵌套最内层改类型：只动内层声明，外层与正文不变', () => {
    const text = '> [!note] 外\n> > [!tip] 内\n> > inner\n'
    const target = targetOf(text, 2, 3, true)
    const plan = planCalloutRetype(target, 'bug')
    expect(applyPlan(text, plan!.changes)).toBe('> [!note] 外\n> > [!bug] 内\n> > inner\n')
  })
})

describe('planCalloutRemove：无 Callout（§6.2）', () => {
  it('无显式标题且有正文：删除空标题行，正文保留引用层级', () => {
    const text = '> [!note]\n> body\n'
    const target = targetOf(text, 1, 2, true)
    const plan = planCalloutRemove(text, target)
    expect(applyPlan(text, plan!.changes)).toBe('> body\n')
  })

  it('显式标题且有正文：标题转首段（声明与折叠符号移除）', () => {
    const text = '> [!note] 标题\n> body\n'
    const target = targetOf(text, 1, 2, true)
    const plan = planCalloutRemove(text, target)
    expect(applyPlan(text, plan!.changes)).toBe('> 标题\n> body\n')
  })

  it('折叠符号随声明移除', () => {
    const text = '> [!note]- 标题\n> body\n'
    const target = targetOf(text, 1, 2, true)
    const plan = planCalloutRemove(text, target)
    expect(applyPlan(text, plan!.changes)).toBe('> 标题\n> body\n')
  })

  it('只有声明无正文：保留可编辑的空引用行', () => {
    const text = '> [!note]\n'
    const target = targetOf(text, 1, 1, false)
    const plan = planCalloutRemove(text, target)
    expect(applyPlan(text, plan!.changes)).toBe('> \n')
  })

  it('显式标题且无正文：标题转首段（单行声明变引用首段）', () => {
    const text = '> [!note] 标题\n'
    const target = targetOf(text, 1, 1, false)
    const plan = planCalloutRemove(text, target)
    expect(applyPlan(text, plan!.changes)).toBe('> 标题\n')
  })

  it('声明与标题间的多空白全部剥除', () => {
    const text = '> [!note]   标题\n> b\n'
    const target = targetOf(text, 1, 2, true)
    const plan = planCalloutRemove(text, target)
    expect(applyPlan(text, plan!.changes)).toBe('> 标题\n> b\n')
  })

  it('嵌套外层移除：只删外层标题行，内层 callout 与引用层级原样保留', () => {
    const text = '> [!note]\n> > [!tip]\n> > inner\n'
    const target = targetOf(text, 1, 3, true)
    const plan = planCalloutRemove(text, target)
    expect(applyPlan(text, plan!.changes)).toBe('> > [!tip]\n> > inner\n')
  })

  it('移除嵌套内层：只动内层声明，外层结构不动', () => {
    const text = '> [!note] 外\n> > [!tip] 内\n> > inner\n'
    const target = targetOf(text, 2, 3, true)
    const plan = planCalloutRemove(text, target)
    expect(applyPlan(text, plan!.changes)).toBe('> [!note] 外\n> > 内\n> > inner\n')
  })

  it('标题行在文档中间：删行带走其后换行（拼接正确）', () => {
    const text = 'a\n> [!note]\n> b\nc\n'
    const target = targetOf(text, 2, 3, true)
    const plan = planCalloutRemove(text, target)
    expect(applyPlan(text, plan!.changes)).toBe('a\n> b\nc\n')
  })

  it('标题行为文档末行：删行不带越界换行', () => {
    const text = 'a\n> [!note]\n> b\n> [!tip]'
    const target = targetOf(text, 4, 4, false)
    const plan = planCalloutRemove(text, target)
    expect(applyPlan(text, plan!.changes)).toBe('a\n> [!note]\n> b\n> ')
  })
})

describe('CALLOUT_TYPE_IDS：菜单类型列表派生', () => {
  it('13 个规范类型按注册表顺序排列（别名不进列表）', () => {
    expect(CALLOUT_TYPE_IDS).toEqual([
      'note', 'abstract', 'info', 'todo', 'tip', 'success', 'question',
      'warning', 'failure', 'danger', 'bug', 'example', 'quote',
    ])
  })
})

describe('docLinesOf：行边界辅助（wrap 行收集口径）', () => {
  it('LF 坐标 → 行号（1-based，to 恰在行首时归前一行）', () => {
    expect(docLinesOf('ab\ncd\nef\n', 0, false)).toBe(1)
    expect(docLinesOf('ab\ncd\nef\n', 3, true)).toBe(1) // to=3 是行 2 行首：不含
    expect(docLinesOf('ab\ncd\nef\n', 4, false)).toBe(2)
    expect(docLinesOf('ab\ncd\nef\n', 9, true)).toBe(3) // to=文档长（末 \n 后）：恰在末空行行首，归前一行
  })
})

describe('#662 R1-002 无 Callout 移除保留外层容器前缀', () => {
  /** 混合容器前缀场景的手工目标（targetOf 夹具的纯引用前缀正则不覆盖）：
   *  markerFrom 按声明 `[` 的行内位置手算，decl 走识别单一事实源 */
  function targetAt(markerFrom: number, titleLineNo: number, lastLineNo: number, declText: string): CalloutPlanTarget {
    const decl = parseCalloutDecl(declText)
    if (!decl) {
      throw new Error(`夹具声明不成型：${declText}`)
    }
    return { markerFrom, titleLineNo, lastLineNo, hasBody: true, decl }
  }

  it('列表首行声明（- > [!note]）移除：保留列表标记与换行，仅删最内层引用标记+声明', () => {
    const text = '- > [!note]\n  > body'
    const plan = planCalloutRemove(text, targetAt(4, 1, 2, '[!note]'))
    expect(applyPlan(text, plan.changes)).toBe('-\n  > body')
  })

  it('有序列表（1. > [!tip]+）同样保留序号前缀', () => {
    const text = '1. > [!tip]+\n   > body'
    const plan = planCalloutRemove(text, targetAt(5, 1, 2, '[!tip]+'))
    expect(applyPlan(text, plan.changes)).toBe('1.\n   > body')
  })

  it('嵌套外层声明同行（> [!note] > [!tip]）：移除内层保留外层声明，正文归外层', () => {
    const text = '> [!note] > [!tip]\n> body'
    const plan = planCalloutRemove(text, targetAt(12, 1, 2, '[!tip]'))
    expect(applyPlan(text, plan.changes)).toBe('> [!note]\n> body')
  })

  it('纯引用前缀（回归）：无标题有正文仍整行删除', () => {
    const text = '> [!note]\n> body'
    const plan = planCalloutRemove(text, targetAt(2, 1, 2, '[!note]'))
    expect(applyPlan(text, plan.changes)).toBe('> body')
  })
})
