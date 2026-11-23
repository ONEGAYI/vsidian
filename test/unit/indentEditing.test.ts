// @vitest-environment jsdom
// Tab/Shift+Tab 通用行缩进的 webview 键位契约（工单 #120）。
//
// 核心断言（用户可观察行为，非实现复述）：
// - Tab：光标行（无选区）或选区覆盖的各行整行缩进一级，光标/选区随
//   缩进平移；Shift+Tab 反向（至多删一级，不足全删）
// - 列表行缩进量智能对齐父项内容起点（`- ` 2 格、`10. ` 4 格、任务
//   6 格），落点在引用前缀右端；普通行（含纯引用行）单位 2 空格
// - 代码块围栏内同普通行语义（不做列表智能对齐）
// - 表格上下文不接管（返回 false）：单元格导航归 tableEditing，表格
//   边界放行也不缩进表格行（不破坏表格结构）
// - frontmatter、IME 组合中不接管；无可删空白时 Shift+Tab 仍吞键
//   （返回 true，避免焦点逃逸到工作台）
// - 多选区各 range 覆盖行取并集；选区末端恰在行首不含该行（对齐
//   CM6 changeBySelectedLine 口径）
// - 单笔事务：一次按键一笔文档变更事务（一次撤销整体回退）
import { describe, it, expect } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { liveDecorationsField } from '../../src/webview/liveDecorations'
import { mathBlocksField } from '../../src/webview/liveMath'
import { tableEditing } from '../../src/webview/tableEditing'
import {
  indentEditing,
  indentLine,
  dedentLine,
} from '../../src/webview/indentEditing'

if (typeof Range !== 'undefined' && Range.prototype.getClientRects === undefined) {
  ;(Range.prototype as unknown as { getClientRects(): DOMRectList }).getClientRects =
    () => [] as unknown as DOMRectList
  ;(Range.prototype as unknown as { getBoundingClientRect(): DOMRect }).getBoundingClientRect =
    () => new DOMRect(0, 0, 0, 0)
}

function makeEditView(
  doc: string,
  selection: { anchor: number; head?: number } | number,
  extra: Extension[] = [],
): EditorView {
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  const sel = typeof selection === 'number'
    ? EditorSelection.single(selection)
    : EditorSelection.range(selection.anchor, selection.head ?? selection.anchor)
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [liveDecorationsField, mathBlocksField, tableEditing, indentEditing, ...extra],
      selection: sel,
    }),
  })
}

const pressTab = (view: EditorView, shift = false): void => {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true }),
  )
}

/** 按一次 Tab/Shift+Tab 后返回文本与主选区，并销毁视图 */
function typed(
  view: EditorView,
  shift = false,
): { text: string; from: number; to: number } {
  pressTab(view, shift)
  const main = view.state.selection.main
  const out = { text: view.state.doc.toString(), from: main.from, to: main.to }
  view.destroy()
  return out
}

// ---- Tab：光标行缩进 ----

describe('Tab 无选区光标行缩进', () => {
  it('普通行：行首插入 2 空格，光标随缩进右移', () => {
    expect(typed(makeEditView('plain text', 6))).toEqual({ text: '  plain text', from: 8, to: 8 })
  })

  it('光标在行首：缩进后光标落在缩进右端', () => {
    expect(typed(makeEditView('plain', 0))).toEqual({ text: '  plain', from: 2, to: 2 })
  })

  it('空行：同样插入 2 空格', () => {
    const doc = 'a\n\nb'
    expect(typed(makeEditView(doc, 2))).toEqual({ text: 'a\n  \nb', from: 4, to: 4 })
  })

  it('列表行：缩进对齐父项内容起点（`- ` 2 格）', () => {
    const doc = '- p\n- c'
    expect(typed(makeEditView(doc, 5))).toEqual({ text: '- p\n  - c', from: 7, to: 7 })
  })

  it('有序宽编号：`10. ` 4 格', () => {
    const doc = '10. p\n11. c'
    expect(typed(makeEditView(doc, 8))).toEqual({ text: '10. p\n    11. c', from: 12, to: 12 })
  })

  it('空有序项成为新子列表首项时，从 1 开始并保持光标在标记后', () => {
    const doc = '1. 数字电路：受限于拓扑，扫一遍即可\n2. '
    expect(typed(makeEditView(doc, doc.length))).toEqual({
      text: '1. 数字电路：受限于拓扑，扫一遍即可\n   1. ', from: doc.length + 3, to: doc.length + 3,
    })
  })

  it('空有序项进入已有同种子列表时，不重置编号', () => {
    const doc = '1. parent\n   1. existing\n2. '
    expect(typed(makeEditView(doc, doc.length))).toEqual({
      text: '1. parent\n   1. existing\n   2. ', from: doc.length + 3, to: doc.length + 3,
    })
  })

  it('有序项正文即使只有不换行空格，也不重置编号', () => {
    const doc = '1. p\n2. \u00a0'
    expect(typed(makeEditView(doc, doc.length))).toEqual({
      text: '1. p\n   2. \u00a0', from: doc.length + 3, to: doc.length + 3,
    })
  })

  it('任务行：对齐上方项内容列（`- ` 2 格——任务标记属内容不计列宽）', () => {
    const doc = '- [ ] p\n- [ ] c'
    expect(typed(makeEditView(doc, doc.indexOf('c') + 1)))
      .toEqual({ text: '- [ ] p\n  - [ ] c', from: doc.indexOf('c') + 3, to: doc.indexOf('c') + 3 })
  })

  it('引用内列表：缩进落在引用前缀右端', () => {
    const doc = '> - p\n> - c'
    // L2 从 6 起，插入点 8（quote 右端）在光标右侧：光标不动
    expect(typed(makeEditView(doc, 7))).toEqual({ text: '> - p\n>   - c', from: 7, to: 7 })
  })

  it('跨族缩进对齐上方项内容列：无序父 + 任务子得 2 格（不取自身标记宽 6，防结构破坏）', () => {
    const doc = '- a\n- [ ] t'
    expect(typed(makeEditView(doc, doc.indexOf('t') + 1)))
      .toEqual({ text: '- a\n  - [ ] t', from: doc.indexOf('t') + 3, to: doc.indexOf('t') + 3 })
  })

  it('跨族缩进：宽编号有序父 + 无序子得 4 格', () => {
    const doc = '10. a\n- b'
    expect(typed(makeEditView(doc, doc.indexOf('b') + 1)))
      .toEqual({ text: '10. a\n    - b', from: doc.indexOf('b') + 5, to: doc.indexOf('b') + 5 })
  })

  it('任务首项（无上文项）：退普通行 2 空格', () => {
    const doc = '- [ ] t'
    expect(typed(makeEditView(doc, doc.indexOf('t') + 1)))
      .toEqual({ text: '  - [ ] t', from: doc.indexOf('t') + 3, to: doc.indexOf('t') + 3 })
  })

  it('纯引用行：普通行语义（行首 2 空格）', () => {
    expect(typed(makeEditView('> q', 3))).toEqual({ text: '  > q', from: 5, to: 5 })
  })

  it('代码块围栏内：普通行语义，不做列表智能对齐', () => {
    const doc = '```js\n1. code\n```'
    const at = doc.indexOf('1.') + 1
    expect(typed(makeEditView(doc, at))).toEqual({ text: '```js\n  1. code\n```', from: at + 2, to: at + 2 })
  })

  it('块级公式内：普通行语义，不做列表智能对齐', () => {
    const doc = '$$\n10. a\n$$'
    expect(typed(makeEditView(doc, doc.indexOf('a') + 1)))
      .toEqual({ text: '$$\n  10. a\n$$', from: doc.indexOf('a') + 3, to: doc.indexOf('a') + 3 })
  })

  it('公式块内 Shift+Tab 按普通行删行首空白', () => {
    const doc = '$$\n  10. a\n$$'
    expect(typed(makeEditView(doc, doc.indexOf('a') + 1), true))
      .toEqual({ text: '$$\n10. a\n$$', from: doc.indexOf('a') - 1, to: doc.indexOf('a') - 1 })
  })

  it('缩进代码块内：普通行语义，不做列表智能对齐', () => {
    const doc = 'para\n\n    10. code'
    const at = doc.indexOf('10.')
    expect(typed(makeEditView(doc, at + 3)))
      .toEqual({ text: 'para\n\n      10. code', from: at + 5, to: at + 5 })
  })

  it('嵌套列表再缩进一级：从 2 格到 4 格', () => {
    const doc = '- p\n  - c'
    expect(typed(makeEditView(doc, 7))).toEqual({ text: '- p\n    - c', from: 9, to: 9 })
  })
})

// ---- Tab：选区多行 ----

describe('Tab 选区多行缩进', () => {
  it('选区覆盖的各行全部缩进，选区随平移', () => {
    const doc = 'a\nb\nc'
    const out = typed(makeEditView(doc, { anchor: 0, head: 3 }))
    expect(out.text).toBe('  a\n  b\nc')
    expect(out.from).toBe(2)
    expect(out.to).toBe(7)
  })

  it('选区末端恰在行首不含该行（对齐 CM6 选区行口径）', () => {
    const doc = 'a\nb\nc'
    const out = typed(makeEditView(doc, { anchor: 0, head: 2 }))
    expect(out.text).toBe('  a\nb\nc')
  })

  it('选区从行中间开始：该行仍整行缩进', () => {
    const doc = 'aaa\nbbb'
    const out = typed(makeEditView(doc, { anchor: 1, head: 5 }))
    expect(out.text).toBe('  aaa\n  bbb')
    expect(out.from).toBe(3)
    expect(out.to).toBe(9)
  })

  it('列表与普通行混选：各行按自身单位缩进', () => {
    const doc = '- item\nplain'
    const out = typed(makeEditView(doc, { anchor: 0, head: 12 }))
    expect(out.text).toBe('  - item\n  plain')
  })

  it('选中有序项下方的多个无序项：一次 Tab 整组嵌套，Shift+Tab 整组退出', () => {
    const doc = '1. parent\n- first\n- second\n- third\n- untouched'
    const nested = '1. parent\n   - first\n   - second\n   - third\n- untouched'
    const view = makeEditView(doc, { anchor: doc.indexOf('- first'), head: doc.indexOf('- untouched') })
    try {
      pressTab(view)
      expect(view.state.doc.toString()).toBe(nested)
      expect(view.state.selection.main.from).toBe(nested.indexOf('- first'))
      expect(view.state.selection.main.to).toBe(nested.indexOf('- untouched'))

      pressTab(view, true)
      expect(view.state.doc.toString()).toBe(doc)
      expect(view.state.selection.main.from).toBe(doc.indexOf('- first'))
      expect(view.state.selection.main.to).toBe(doc.indexOf('- untouched'))
    } finally {
      view.destroy()
    }
  })

  it('引用内不同标记的同级项一起嵌套，Shift+Tab 保留原有外层列表', () => {
    const doc = '> - outer\n>   1. parent\n>   - first\n>   * second'
    const nested = '> - outer\n>   1. parent\n>      - first\n>      * second'
    const view = makeEditView(doc, { anchor: doc.indexOf('- first'), head: doc.length })
    try {
      pressTab(view)
      expect(view.state.doc.toString()).toBe(nested)

      pressTab(view, true)
      expect(view.state.doc.toString()).toBe(doc)
    } finally {
      view.destroy()
    }
  })

  it('只移动选区内的内容，续段、围栏和子列表跟随各自的列表项', () => {
    const content = '- first\n\n  continued\n\n  \u00a0\n\n  ```txt\n  code\n  ```\n  - child\n- second'
    const doc = `10. parent\n${content}\n- untouched`
    const nested = `10. parent\n${content.replace(/^(?=.)/gm, '    ')}\n- untouched`
    const view = makeEditView(doc, { anchor: doc.indexOf('- first'), head: doc.indexOf('- untouched') })
    try {
      pressTab(view)
      expect(view.state.doc.toString()).toBe(nested)

      pressTab(view, true)
      expect(view.state.doc.toString()).toBe(doc)
    } finally {
      view.destroy()
    }
  })

  it.each([
    ['空父项', '1.', '', '   '],
    ['标记后接制表符', '1.\tparent', '', '    '],
    ['标记后接五个空格', '1.     code', '', '   '],
    ['同一行的内层标记', '- 1. parent', '  ', '     '],
    ['父项和所选项以制表符缩进', '1. outer\n\t1. parent', '\t', '\t   '],
  ])('按 Markdown 列宽处理%s', (_, above, before, after) => {
    const doc = `${above}\n${before}- first\n${before}- second`
    const nested = `${above}\n${after}- first\n${after}- second`
    const view = makeEditView(doc, { anchor: doc.indexOf('- first'), head: doc.length })
    try {
      pressTab(view)
      expect(view.state.doc.toString()).toBe(nested)

      pressTab(view, true)
      expect(view.state.doc.toString()).toBe(doc)
    } finally {
      view.destroy()
    }
  })

  it.each([
    ['裸引用标记', '> 1. p', '>', '> ', '>    '],
    ['续行的引用制表符', '> 10. p', '>\t', '>\t', '>\t    '],
    ['引用开行的额外制表符', '>\t1. p', '>\t', '>\t   ', '>\t      '],
    ['列表行里的引用', '- > 1. p', '  > ', '  > ', '  >    '],
  ])('同级项按实际引用前缀成组：%s', (_, parent, before, afterDedent, nested) => {
    const doc = `${parent}\n${before}- first\n${before}- second`
    const view = makeEditView(doc, { anchor: doc.indexOf('- first'), head: doc.length })
    try {
      pressTab(view)
      expect(view.state.doc.toString()).toBe(`${parent}\n${nested}- first\n${nested}- second`)
      pressTab(view, true)
      expect(view.state.doc.toString()).toBe(`${parent}\n${afterDedent}- first\n${afterDedent}- second`)
    } finally {
      view.destroy()
    }
  })

  it('没有前置同级父候选时，连续按 Tab 不会把整组首批子项变成代码', () => {
    const doc = '10. p\n- first\n- second'
    const nested = '10. p\n    - first\n    - second'
    const view = makeEditView(doc, { anchor: doc.indexOf('- first'), head: doc.length })
    try {
      pressTab(view)
      expect(view.state.doc.toString()).toBe(nested)
      pressTab(view)
      expect(view.state.doc.toString()).toBe(nested)
      pressTab(view, true)
      expect(view.state.doc.toString()).toBe(doc)
    } finally {
      view.destroy()
    }
  })

  it('深层引用中缺一层标记的惰性续行保持原文，按键不被空白匹配拖慢', () => {
    const quote = '> '.repeat(27)
    const lazy = `${quote.slice(2)}lazy`
    const doc = `${quote}1. p\n${quote}- first\n${lazy}\n${quote}- second`
    const view = makeEditView(doc, { anchor: doc.indexOf('- first'), head: doc.length })
    try {
      const start = performance.now()
      pressTab(view)
      // 旧量词回溯约需数秒；线性扫描只处理这四行，阈值不以机器微基准为准。
      expect(performance.now() - start).toBeLessThan(1500)
      expect(view.state.doc.toString()).toBe(`${quote}1. p\n${quote}   - first\n${lazy}\n${quote}   - second`)
    } finally {
      view.destroy()
    }
  })

  it('多光标：各 range 覆盖行取并集', () => {
    const doc = 'a\nb\nc\nd'
    const view = makeEditView(doc, 0, [EditorState.allowMultipleSelections.of(true)])
    view.dispatch({
      selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(4)]),
    })
    pressTab(view)
    expect(view.state.doc.toString()).toBe('  a\nb\n  c\nd')
    expect(view.state.selection.ranges.map((r) => r.head)).toEqual([2, 8])
    view.destroy()
  })
})

// ---- Shift+Tab：反向 ----

describe('Shift+Tab 反向缩进', () => {
  it('普通行删 2 空格，光标左移', () => {
    expect(typed(makeEditView('  plain', 5), true)).toEqual({ text: 'plain', from: 3, to: 3 })
  })

  it('缩进超一级只删一级（4 格 → 2 格）', () => {
    expect(typed(makeEditView('    plain', 7), true)).toEqual({ text: '  plain', from: 5, to: 5 })
  })

  it('列表行删至父项内容对齐列', () => {
    const doc = '- p\n  - c'
    expect(typed(makeEditView(doc, 7), true)).toEqual({ text: '- p\n- c', from: 5, to: 5 })
  })

  it('列表行升一级：4 格子项直接删到父项标记列（顶级 0）', () => {
    const doc = '- p\n    - c'
    expect(typed(makeEditView(doc, doc.indexOf('c') + 1), true))
      .toEqual({ text: '- p\n- c', from: 7, to: 7 })
  })

  it('任务子项升一级：删全部缩进对齐无序父标记列（不按自身标记宽部分删）', () => {
    const doc = '- a\n  - [ ] t'
    expect(typed(makeEditView(doc, doc.indexOf('t') + 1), true))
      .toEqual({ text: '- a\n- [ ] t', from: doc.indexOf('t') - 1, to: doc.indexOf('t') - 1 })
  })

  it('有序宽编号删 4 格', () => {
    const doc = '10. p\n    11. c'
    expect(typed(makeEditView(doc, 12), true)).toEqual({ text: '10. p\n11. c', from: 8, to: 8 })
  })

  it('有序子项整组退一级时接续外层编号，只顺延同一列表的后项', () => {
    const doc = '03. parent\n    1) first\n    2) second\n04. next\n\nseparate\n\n9. other'
    const expected = '03. parent\n04. first\n05. second\n06. next\n\nseparate\n\n9. other'
    let edits = 0
    const view = makeEditView(doc, { anchor: doc.indexOf('1)'), head: doc.indexOf('04.') }, [
      EditorView.updateListener.of((update) => { if (update.docChanged) edits++ }),
    ])
    const out = typed(view, true)
    expect(out).toEqual({ text: expected, from: expected.indexOf('04.'), to: expected.indexOf('06.') })
    expect(edits).toBe(1)
  })

  it('后项编号跨过 9 时，所属子项保持在原后项下面', () => {
    const doc = '8. parent\n   1. child\n9. next\n   - stays nested'
    const expected = '8. parent\n9. child\n10. next\n    - stays nested'
    expect(typed(makeEditView(doc, doc.indexOf('child')), true)).toEqual({
      text: expected, from: expected.indexOf('child'), to: expected.indexOf('child'),
    })
  })

  it('升上来的编号变宽时，不把剩余子项意外抬到外层', () => {
    const doc = '9. p\n   1. moved\n   2. still nested\n10. q'
    const expected = '9. p\n10. moved\n    2. still nested\n11. q'
    expect(typed(makeEditView(doc, doc.indexOf('moved')), true)).toEqual({
      text: expected, from: expected.indexOf('moved'), to: expected.indexOf('moved'),
    })
  })

  it('续号不改被 Markdown 树误认成列表项的公式正文', () => {
    const doc = '1. parent\n   1. child\n2. next\n$$\n1. math\n$$'
    const expected = '1. parent\n2. child\n3. next\n$$\n1. math\n$$'
    expect(typed(makeEditView(doc, doc.indexOf('child')), true)).toEqual({
      text: expected, from: expected.indexOf('child'), to: expected.indexOf('child'),
    })
  })

  it('引用内列表：删引用前缀右端的缩进', () => {
    const doc = '> - p\n>   - c'
    // 删除 L2 内 [8,10)：光标 9 落在删除区间，坍到区间起点（'-' 前）
    expect(typed(makeEditView(doc, 9), true)).toEqual({ text: '> - p\n> - c', from: 8, to: 8 })
  })

  it('缩进不足一级全删', () => {
    const doc = '- p\n - c'
    expect(typed(makeEditView(doc, 6), true)).toEqual({ text: '- p\n- c', from: 5, to: 5 })
  })

  it('无可删空白：吞键但不产生任何文本与选区变化', () => {
    const view = makeEditView('plain', 2)
    expect(dedentLine(view)).toBe(true)
    expect(view.state.doc.toString()).toBe('plain')
    expect(view.state.selection.main.head).toBe(2)
    view.destroy()
  })

  it('选区多行混合：有缩进的删、无缩进的保持', () => {
    const doc = '  a\nb\n  c'
    const out = typed(makeEditView(doc, { anchor: 0, head: 8 }), true)
    expect(out.text).toBe('a\nb\nc')
    expect(out.from).toBe(0)
    expect(out.to).toBe(4)
  })
})

// ---- 不接管条件 ----

describe('不接管条件（返回 false 交默认）', () => {
  it('表格行：单元格导航归 tableEditing，缩进处理器不接手', () => {
    const doc = '| a | b |\n| --- | --- |\n| 1 | 2 |\n'
    const view = makeEditView(doc, doc.indexOf('1') + 1)
    expect(indentLine(view)).toBe(false)
    expect(dedentLine(view)).toBe(false)
    view.destroy()
  })

  it('表格边界（首格 Shift+Tab 导航放行）：同样不缩进表格行', () => {
    const doc = '| a | b |\n| --- | --- |\n| 1 | 2 |\n'
    const view = makeEditView(doc, doc.indexOf('a') + 1)
    const before = { text: view.state.doc.toString(), head: view.state.selection.main.head }
    pressTab(view, true)
    expect(view.state.doc.toString()).toBe(before.text)
    expect(view.state.selection.main.head).toBe(before.head)
    view.destroy()
  })

  it('选区覆盖表格行：整体不接管（不破坏表格结构）', () => {
    const doc = 'para\n| a | b |\n| --- | --- |\n'
    const view = makeEditView(doc, { anchor: 0, head: doc.length - 1 })
    expect(indentLine(view)).toBe(false)
    view.destroy()
  })

  it('frontmatter 内不接管（成型卡片态）', () => {
    const doc = '---\ntitle: x\n---\nbody'
    const view = makeEditView(doc, doc.indexOf('title'))
    expect(indentLine(view)).toBe(false)
    view.destroy()
  })

  // #420：门控只应保护成型卡片；降级源码态头区是可编辑源码
  // （frontmatterTable「降级后编辑不受限」），YAML 嵌套缩进走普通行 2 空格制
  it('降级 frontmatter（嵌套 map 源码态）内空行：Tab 插 2 空格（#420）', () => {
    const doc = '---\nperm:\n\n  bash: deny\n---\nbody'
    const blankHead = doc.indexOf('\n\n  bash') + 1
    expect(typed(makeEditView(doc, blankHead)))
      .toEqual({ text: '---\nperm:\n  \n  bash: deny\n---\nbody', from: blankHead + 2, to: blankHead + 2 })
  })

  it('降级 frontmatter 内嵌套行：Tab 行首插 2 空格（#420）', () => {
    const doc = '---\nperm:\n  bash: deny\n---\nbody'
    expect(typed(makeEditView(doc, doc.indexOf('deny') + 4)))
      .toEqual({ text: '---\nperm:\n    bash: deny\n---\nbody', from: doc.indexOf('deny') + 6, to: doc.indexOf('deny') + 6 })
  })

  it('降级 frontmatter 内嵌套行：Shift+Tab 删至多 2 空格（#420）', () => {
    const doc = '---\nperm:\n    bash: deny\n---\nbody'
    expect(typed(makeEditView(doc, doc.indexOf('deny') + 4), true))
      .toEqual({ text: '---\nperm:\n  bash: deny\n---\nbody', from: doc.indexOf('deny') + 2, to: doc.indexOf('deny') + 2 })
  })

  it('IME 组合进行中不接管', () => {
    const view = makeEditView('plain', 2)
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart'))
    expect(indentLine(view)).toBe(false)
    expect(dedentLine(view)).toBe(false)
    view.contentDOM.dispatchEvent(new CompositionEvent('compositionend'))
    view.destroy()
  })
})

// ---- 表格优先（完整装配） ----

describe('表格上下文优先', () => {
  it('与 tableEditing 同装时表格内 Tab 是单元格导航（文本零变化）', () => {
    const doc = '| a | b |\n| --- | --- |\n| 1 | 2 |\n'
    const view = makeEditView(doc, doc.indexOf('1') + 1)
    pressTab(view)
    expect(view.state.selection.main.head).toBe(doc.indexOf('2'))
    expect(view.state.doc.toString()).toBe(doc)
    view.destroy()
  })
})

// ---- 单笔事务 ----

describe('单笔事务语义', () => {
  it('一次 Tab 多行缩进只产生一笔文档变更事务', () => {
    let docChangedTxs = 0
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: 'a\nb\nc',
        extensions: [
          liveDecorationsField,
          indentEditing,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) docChangedTxs++
          }),
        ],
        selection: EditorSelection.range(0, 3),
      }),
    })
    pressTab(view)
    expect(docChangedTxs).toBe(1)
    expect(view.state.doc.toString()).toBe('  a\n  b\nc')
    view.destroy()
  })
})
