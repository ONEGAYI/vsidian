// frontmatter 表格化纯函数契约（工单 #140）：解析 → 编辑计划 → 序列化。
//
// 断言口径（用户可观察行为，非实现复述）：
// - 解析：合法简单头区（标量 + 字符串数组）产出区间模型；嵌套 / 多行
//   标量 / 锚点 / 非法 YAML / 重复键 → null（降级源码）；头区外 `---`
//   不影响（边界由 frontmatterRange 保证，模型只消费其区间）
// - 编辑计划：最小重写——只替换被编辑区间，未触及行字节不变；空值
//   插入自动补 `: ` 结构空格；增删行整行（含换行）操作
// - 导航：Tab/Shift+Tab 格间往返、Enter 下行同列（末行返回 null 交上层）
import { describe, it, expect } from 'vitest'
import { frontmatterRange } from '../../src/webview/markdownDoc'
import {
  parseFrontmatterTable,
  planSetFmValue,
  planSetFmKey,
  planAddFmEntry,
  planRemoveFmEntry,
  planAddFmArrayItem,
  planRemoveFmArrayItem,
  fmCellAt,
  fmCellNavTarget,
  fmCellDownTarget,
  buildFrontmatterTableHtml,
} from '../../src/shared/frontmatterTable'

/** 应用编辑计划到全文（模拟 CM6 变更） */
function apply(text: string, plan: { changes: ReadonlyArray<{ from: number; to?: number; insert: string }> }): string {
  let out = text
  for (const c of [...plan.changes].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, c.from) + c.insert + out.slice(c.to ?? c.from)
  }
  return out
}

/** 文本中子串的区间 */
function span(text: string, needle: string, from = 0): { from: number; to: number } {
  const i = text.indexOf(needle, from)
  if (i < 0) throw new Error(`未找到: ${needle}`)
  return { from: i, to: i + needle.length }
}

function modelOf(text: string) {
  const fm = frontmatterRange(text)
  expect(fm).not.toBeNull()
  return parseFrontmatterTable(text, fm!)
}

describe('parseFrontmatterTable：解析', () => {
  it('标量头区：区间精确（key/value 分离，冒号与空格在区间外）', () => {
    const doc = '---\ntitle: hello\ncount: 3\n---\n\n正文'
    const model = modelOf(doc)!
    expect(model.entries).toHaveLength(2)
    const [title, count] = model.entries
    expect(title?.kind).toBe('scalar')
    expect(count?.kind).toBe('scalar')
    if (title?.kind !== 'scalar' || count?.kind !== 'scalar') return
    expect(title.key).toEqual(span(doc, 'title'))
    expect(title.value).toEqual(span(doc, 'hello'))
    expect(title.comment).toBeNull()
    expect(count.key).toEqual(span(doc, 'count'))
    expect(count.value).toEqual(span(doc, '3'))
  })

  it('block 数组：宿主行 + 项行，项区间不含 `- ` 标记与缩进', () => {
    const doc = '---\ntags:\n  - alpha\n  - beta\n---'
    const model = modelOf(doc)!
    expect(model.entries).toHaveLength(1)
    const entry = model.entries[0]
    expect(entry?.kind).toBe('array')
    if (entry?.kind !== 'array') return
    expect(entry.form).toBe('block')
    expect(entry.key).toEqual(span(doc, 'tags'))
    expect(entry.items).toHaveLength(2)
    expect(entry.items[0]?.item).toEqual(span(doc, 'alpha'))
    expect(entry.items[1]?.item).toEqual(span(doc, 'beta'))
  })

  it('flow 数组：值区间含括号，项区间按顶层逗号拆分', () => {
    const doc = '---\ntags: [alpha, "beta x"]\n---'
    const model = modelOf(doc)!
    const entry = model.entries[0]
    expect(entry?.kind).toBe('array')
    if (entry?.kind !== 'array') return
    expect(entry.form).toBe('flow')
    expect(entry.value).toEqual(span(doc, '[alpha, "beta x"]'))
    expect(entry.items.map((i) => doc.slice(i.item.from, i.item.to)))
      .toEqual(['alpha', '"beta x"'])
  })

  it('空值标量：value.from === value.to（区间零宽）', () => {
    const doc = '---\ntitle:\n---'
    const model = modelOf(doc)!
    const entry = model.entries[0]
    expect(entry?.kind).toBe('scalar')
    if (entry?.kind !== 'scalar') return
    expect(entry.value.from).toBe(entry.value.to)
  })

  it('引号键与引号值：区间保留原文（含引号）', () => {
    const doc = '---\n"my key": "hello world"\n---'
    const model = modelOf(doc)!
    const entry = model.entries[0]
    expect(entry?.kind).toBe('scalar')
    if (entry?.kind !== 'scalar') return
    expect(doc.slice(entry.key.from, entry.key.to)).toBe('"my key"')
    expect(doc.slice(entry.value.from, entry.value.to)).toBe('"hello world"')
  })

  it('行内注释：值区间止于注释前，注释区间独立', () => {
    const doc = '---\ntitle: hello # 备注\n---'
    const model = modelOf(doc)!
    const entry = model.entries[0]
    if (entry?.kind !== 'scalar') throw new Error('应为标量')
    expect(doc.slice(entry.value.from, entry.value.to)).toBe('hello')
    expect(entry.comment).not.toBeNull()
    expect(doc.slice(entry.comment!.from, entry.comment!.to)).toBe('# 备注')
  })

  it('空头区与纯注释/空行头区：成型（条目数为 0 或跳过杂项行）', () => {
    // 两行围栏（`---\n---`）不构成头区（frontmatterRange 现状语义）；
    // 最小空头区为三行含空行形态
    expect(modelOf('---\n\n---')!.entries).toHaveLength(0)
    const withComment = '---\n# 独立注释行\n\n---'
    const model = modelOf(withComment)!
    expect(model.entries).toHaveLength(0)
    // 独立注释行原样保留：插入新条目不吞注释
    expect(apply(withComment, planAddFmEntry(model, withComment)!))
      .toBe('---\n# 独立注释行\n\nkey: value\n---')
  })

  it('注释行穿插条目之间：解析跳过、插入点取末条目行', () => {
    const doc = '---\na: 1\n# 中注\nb: 2\n---'
    const model = modelOf(doc)!
    expect(model.entries).toHaveLength(2)
    expect(apply(doc, planAddFmEntry(model, doc)!)).toBe('---\na: 1\n# 中注\nb: 2\nkey: value\n---')
  })

  it('布尔 / 数字 / 日期字符串：均为标量', () => {
    const doc = '---\ndraft: true\nnum: 42\nday: 2026-09-27\n---'
    const model = modelOf(doc)!
    expect(model.entries).toHaveLength(3)
    expect(model.entries.every((e) => e.kind === 'scalar')).toBe(true)
  })

  it('降级：嵌套对象（缩进子键）→ null', () => {
    expect(modelOf('---\nouter:\n  inner: 1\n---')).toBeNull()
  })

  it('降级：多行标量 | 与 > → null', () => {
    expect(modelOf('---\ndesc: |\n  line1\n  line2\n---')).toBeNull()
    expect(modelOf('---\ndesc: >\n  folded\n---')).toBeNull()
  })

  it('降级：非法 YAML（未闭合 flow / 制表缩进 / 冒号粘连歧义）→ null', () => {
    expect(modelOf('---\ntags: [a, b\n---')).toBeNull()
    expect(modelOf('---\na: 1\n\tb: 2\n---')).toBeNull()
  })

  it('降级：对象数组 / 顶层数组 / 数组内嵌套 → null', () => {
    expect(modelOf('---\nitems:\n  - k: v\n---')).toBeNull()
    expect(modelOf('---\n- a\n- b\n---')).toBeNull()
    expect(modelOf('---\nitems: [[a]]\n---')).toBeNull()
  })

  it('降级：锚点与别名引用 → null', () => {
    expect(modelOf('---\nbase: &anchor 1\nother: *anchor\n---')).toBeNull()
  })

  it('降级：重复键 → null', () => {
    expect(modelOf('---\na: 1\na: 2\n---')).toBeNull()
  })

  it('头区外正文中的 --- 不参与解析（fm 区间之外的内容不进模型）', () => {
    const doc = '---\na: 1\n---\n\n---\n不在头区: true\n---\n'
    const model = modelOf(doc)!
    expect(model.entries).toHaveLength(1)
    expect(model.entries[0]?.key).toEqual(span(doc, 'a'))
  })

  it('未闭合头区：frontmatterRange 已判 null，模型无从谈起（边界单一事实源）', () => {
    expect(frontmatterRange('---\na: 1\n正文')).toBeNull()
  })
})

describe('编辑计划：最小重写', () => {
  it('改标量值：只替换值区间，其余行字节不变（含注释保留）', () => {
    const doc = '---\ntitle: hello # 备注\ncount: 3\n---'
    const model = modelOf(doc)!
    const plan = planSetFmValue(model, 0, 'world')!
    expect(plan.changes).toEqual([{ from: span(doc, 'hello').from, to: span(doc, 'hello').to, insert: 'world' }])
    expect(apply(doc, plan)).toBe('---\ntitle: world # 备注\ncount: 3\n---')
  })

  it('改空值：自动补冒号后结构空格', () => {
    const doc = '---\ntitle:\n---'
    const model = modelOf(doc)!
    expect(apply(doc, planSetFmValue(model, 0, 'hello')!)).toBe('---\ntitle: hello\n---')
  })

  it('清空值：值区间清空后仍合法（空标量）', () => {
    const doc = '---\ntitle: hello\n---'
    const model = modelOf(doc)!
    expect(apply(doc, planSetFmValue(model, 0, '')!)).toBe('---\ntitle: \n---')
  })

  it('改键：只替换键区间', () => {
    const doc = '---\ntitle: hello\n---'
    const model = modelOf(doc)!
    expect(apply(doc, planSetFmKey(model, 0, 'name')!)).toBe('---\nname: hello\n---')
  })

  it('新增键值对：末条目行后插入，光标选中新键文本；键名去重递增', () => {
    const doc = '---\nkey: a\n---'
    const model = modelOf(doc)!
    const plan = planAddFmEntry(model, doc)!
    expect(apply(doc, plan)).toBe('---\nkey: a\nkey2: value\n---')
    expect(plan.selection).toEqual({ anchor: span('---\nkey: a\nkey2: value', 'key2').from, head: span('---\nkey: a\nkey2: value', 'key2').to })
  })

  it('新增键值对：空头区插入在空行之后、闭合行之前', () => {
    const doc = '---\n\n---'
    const model = modelOf(doc)!
    expect(apply(doc, planAddFmEntry(model, doc)!)).toBe('---\n\nkey: value\n---')
  })

  it('删除标量条目：整行含换行删除', () => {
    const doc = '---\na: 1\nb: 2\n---'
    const model = modelOf(doc)!
    expect(apply(doc, planRemoveFmEntry(model, 0)!)).toBe('---\nb: 2\n---')
  })

  it('删除 block 数组条目：宿主行与全部项行一起删除', () => {
    const doc = '---\na: 1\ntags:\n  - x\n  - y\nb: 2\n---'
    const model = modelOf(doc)!
    expect(apply(doc, planRemoveFmEntry(model, 1)!)).toBe('---\na: 1\nb: 2\n---')
  })

  it('block 数组末尾加项：缩进对齐既有项，选中项文本', () => {
    const doc = '---\ntags:\n  - alpha\n---'
    const model = modelOf(doc)!
    const plan = planAddFmArrayItem(model, 0)!
    expect(apply(doc, plan)).toBe('---\ntags:\n  - alpha\n  - item\n---')
    const next = '---\ntags:\n  - alpha\n  - item\n---'
    expect(plan.selection).toEqual({ anchor: span(next, 'item').from, head: span(next, 'item').to })
  })

  it('空标量加项：宿主行后插入 2 空格缩进项（tags 空值起步路径）', () => {
    const doc = '---\ntags:\n---'
    const model = modelOf(doc)!
    expect(apply(doc, planAddFmArrayItem(model, 0)!)).toBe('---\ntags:\n  - item\n---')
  })

  it('非空标量加项：不支持（返回 null，按钮层不显示）', () => {
    const doc = '---\ntitle: hello\n---'
    const model = modelOf(doc)!
    expect(planAddFmArrayItem(model, 0)).toBeNull()
  })

  it('block 数组删项：删整项行；删到零项保留空宿主', () => {
    const doc = '---\ntags:\n  - alpha\n  - beta\n---'
    const model = modelOf(doc)!
    expect(apply(doc, planRemoveFmArrayItem(model, 0, 1)!)).toBe('---\ntags:\n  - alpha\n---')
    const one = modelOf('---\ntags:\n  - alpha\n---')!
    expect(apply('---\ntags:\n  - alpha\n---', planRemoveFmArrayItem(one, 0, 0)!)).toBe('---\ntags:\n---')
  })

  it('最小重写总检：多键头区改一个值，其余行逐字节保留（顺序/引号/缩进/注释）', () => {
    const doc = '---\n"quoted": "keep me"  # note\ntags:\n  - a\nplain: 42\n---'
    const model = modelOf(doc)!
    const before = doc
    const after = apply(doc, planSetFmValue(model, 2, '43')!)
    expect(after).toBe('---\n"quoted": "keep me"  # note\ntags:\n  - a\nplain: 43\n---')
    // 未涉及行不变：逐行对比
    const beforeLines = before.split('\n')
    const afterLines = after.split('\n')
    expect(afterLines[1]).toBe(beforeLines[1])
    expect(afterLines[2]).toBe(beforeLines[2])
    expect(afterLines[3]).toBe(beforeLines[3])
  })
})

describe('格导航', () => {
  const DOC = '---\ntitle: hello\ntags:\n  - alpha\n  - beta\ncount: 1\n---\n正文'
  // 单字符/短词会撞键名，用项标记精确定位
  const ITEM_A = DOC.indexOf('- alpha') + 2
  const ITEM_B = DOC.indexOf('- beta') + 2
  const VAL_COUNT = DOC.indexOf('count: 1') + 7

  it('fmCellAt：key/value/项 格身份按光标定位', () => {
    const model = modelOf(DOC)!
    expect(fmCellAt(model, span(DOC, 'titl').from)?.kind).toBe('key')
    expect(fmCellAt(model, span(DOC, 'hell').from)?.kind).toBe('value')
    expect(fmCellAt(model, ITEM_A + 1)?.kind).toBe('item')
  })

  it('Tab 前向：key → value → 下行 key → …；末值 → 闭合行行尾（越出）', () => {
    const model = modelOf(DOC)!
    const keyOf = span(DOC, 'title').from
    expect(fmCellNavTarget(model, keyOf, false)).toBe(span(DOC, 'hello').from)
    expect(fmCellNavTarget(model, span(DOC, 'hello').from, false)).toBe(span(DOC, 'tags').from)
    // 数组宿主值格（空）→ 首项
    expect(fmCellNavTarget(model, span(DOC, 'tags').to + 1, false)).toBe(ITEM_A)
    // 末项 → 下一 key
    expect(fmCellNavTarget(model, ITEM_B, false)).toBe(span(DOC, 'count').from)
    // 末条目值 → 闭合行行尾
    expect(fmCellNavTarget(model, VAL_COUNT, false)).toBe(DOC.indexOf('\n正文'))
  })

  it('Shift+Tab 反向：value → 本行 key → 上一行 value', () => {
    const model = modelOf(DOC)!
    expect(fmCellNavTarget(model, span(DOC, 'hello').from, true)).toBe(span(DOC, 'title').from)
    expect(fmCellNavTarget(model, span(DOC, 'tags').from, true)).toBe(span(DOC, 'hello').from)
  })

  it('fmCellDownTarget：Enter 下行同列；末行返回 null（上层决定加行）', () => {
    const model = modelOf(DOC)!
    expect(fmCellDownTarget(model, span(DOC, 'title').from)).toBe(span(DOC, 'tags').from)
    expect(fmCellDownTarget(model, span(DOC, 'hello').from)).toBe(span(DOC, 'tags').to + 1)
    // 项 → 下一项
    expect(fmCellDownTarget(model, ITEM_A)).toBe(ITEM_B)
    // 末项 → 下一条目值（同列）
    expect(fmCellDownTarget(model, ITEM_B)).toBe(VAL_COUNT)
    // 末条目 key/value → null
    expect(fmCellDownTarget(model, span(DOC, 'count').from)).toBeNull()
    expect(fmCellDownTarget(model, VAL_COUNT)).toBeNull()
  })

  it('头区外与围栏行：fmCellAt 为 null（Tab 落穿既有行为）', () => {
    const model = modelOf(DOC)!
    expect(fmCellAt(model, 1)).toBeNull()
    expect(fmCellAt(model, DOC.indexOf('正文'))).toBeNull()
  })
})

describe('阅读侧 HTML 构建', () => {
  it('表格结构与值转义：键值/项分层，HTML 特殊字符全转义', () => {
    const doc = '---\ntitle: <b>&x\n---'
    const model = modelOf(doc)!
    const html = buildFrontmatterTableHtml(model, doc, { emptyLabel: '（空）' })
    expect(html).toContain('vsidian-fm-table')
    expect(html).toContain('<span class="vsidian-fm-cell vsidian-fm-key">title</span>')
    expect(html).toContain('&lt;b&gt;&amp;x')
    expect(html).not.toContain('<b>')
  })

  it('block 数组：项行带占位键列；flow 数组：项逐行列出', () => {
    const blockDoc = '---\ntags:\n  - a\n  - b\n---'
    const blockHtml = buildFrontmatterTableHtml(modelOf(blockDoc)!, blockDoc, { emptyLabel: '（空）' })
    expect(blockHtml).toContain('vsidian-fm-item-row')
    expect(blockHtml).toContain('>a</span>')

    const flowDoc = '---\ntags: [x, y]\n---'
    const flowHtml = buildFrontmatterTableHtml(modelOf(flowDoc)!, flowDoc, { emptyLabel: '（空）' })
    expect(flowHtml).toContain('>x</span>')
    expect(flowHtml).toContain('>y</span>')
  })

  it('空头区：占位文案（i18n 词条由调用方传入）', () => {
    const html = buildFrontmatterTableHtml(modelOf('---\n\n---')!, '---\n\n---', { emptyLabel: '（空）' })
    expect(html).toContain('（空）')
  })
})
