// 选区包裹生产链路（工单 #124，jsdom 控制器）：transactionFilter 接入后
// 的真实事务流——有选区键入符号两侧包裹并保持原文选中、跨段按空行拆块
// 与多 range 原文保持、连续包裹叠加、代码上下文门控、表格格区语义、
// 粘贴/组合/完整对排除、设置开关独立于自动补全。与浏览器套件
// （symbolInput）互补：本层驱动 CM6 事务（userEvent 注解模拟浏览器
// input 事件回流，含 CM6 replaceSelection 的多 range 形态），浏览器层
// 用真实键盘/IME 验证同一链路。
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { keymap } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'
import { defaultKeymap } from '@codemirror/commands'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import { selectTableRegion } from '../../src/webview/tableRegionSelection'
import type { WebviewToHost } from '../../src/shared/protocol'

if (Range.prototype.getClientRects === undefined) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
}

function setup(text: string) {
  const sent: WebviewToHost[] = []
  const bridge: VsCodeBridge = {
    postMessage: (message) => sent.push(message as WebviewToHost),
    getState: () => undefined,
    setState: () => {},
  }
  const controller = new WebviewSyncController(bridge)
  // 生产 main.ts 同款：defaultKeymap 提供默认行为兜底
  controller.mount(document.createElement('div'), [keymap.of(defaultKeymap)])
  controller.handleHostMessage({ kind: 'init', sessionId: 'symbolwrap', docUri: 'file:///symbolwrap.md', version: 1, text })
  return { controller, sent, view: controller.getView()! }
}

/** 模拟浏览器 input 事件回流产生的事务（选区替换为键入文本；CM6 对
 *  contenteditable 普通键入的形态：change 覆盖 main 选区、光标落插入后） */
function typeOverSelection(
  view: ReturnType<typeof setup>['view'],
  text: string,
  userEvent = 'input.type',
) {
  const range = view.state.selection.main
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: text },
    selection: { anchor: range.from + text.length },
    userEvent,
  })
}

/** 模拟 CM6 applyDefaultInsert 的 replaceSelection 分支（多 range 真实
 *  键入形态：每 range 一条变更、光标各 range 插入后，userEvent input.type） */
function typeOverAllRanges(
  view: ReturnType<typeof setup>['view'],
  text: string,
) {
  view.dispatch({ ...view.state.replaceSelection(text), userEvent: 'input.type' })
}

const select = (view: ReturnType<typeof setup>['view'], anchor: number, head: number) => {
  view.dispatch({ selection: EditorSelection.single(anchor, head), userEvent: 'select.pointer' })
}

const editRequests = (sent: WebviewToHost[]) => sent.filter((m) => m.kind === 'edit.request')
const ranges = (view: ReturnType<typeof setup>['view']) =>
  view.state.selection.ranges.map((range) => ({ from: range.from, to: range.to }))

describe('单段包裹：一次包裹一笔事务、保持原文选中', () => {
  it('选中 text 键星号：得 *text*、选区覆盖原文、单笔 edit.request', () => {
    const { sent, view } = setup('hello text')
    select(view, 6, 10)
    typeOverSelection(view, '*')
    expect(view.state.doc.toString()).toBe('hello *text*')
    expect(ranges(view)).toEqual([{ from: 7, to: 11 }])
    const requests = editRequests(sent)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      changes: [
        { offset: 6, length: 0, text: '*' },
        { offset: 10, length: 0, text: '*' },
      ],
    })
  })

  it('反向选区（从右往左选）同样包裹，产物选区正向覆盖原文', () => {
    const { view } = setup('hello text')
    select(view, 10, 6)
    typeOverSelection(view, '*')
    expect(view.state.doc.toString()).toBe('hello *text*')
    expect(ranges(view)).toEqual([{ from: 7, to: 11 }])
  })

  it('连续第二键得 **text**：叠加包裹、不是切换取消', () => {
    const { view } = setup('hello text')
    select(view, 6, 10)
    typeOverSelection(view, '*')
    typeOverSelection(view, '*')
    expect(view.state.doc.toString()).toBe('hello **text**')
    expect(ranges(view)).toEqual([{ from: 8, to: 12 }])
  })

  it.each([
    ['(', '(', ')'], ['（', '（', '）'], ['“', '“', '”'], ['~', '~', '~'],
    ['=', '=', '='], ['$', '$', '$'], ['`', '`', '`'], ['_', '_', '_'],
  ])('键入 %s 在选区两侧得 %s…%s', (open, left, right) => {
    const { view } = setup('a word b')
    select(view, 2, 6)
    typeOverSelection(view, open)
    expect(view.state.doc.toString()).toBe(`a ${left}word${right} b`)
  })

  it('方括号两键形成 [[word]]（wikilink 类结构）', () => {
    const { view } = setup('a word b')
    select(view, 2, 6)
    typeOverSelection(view, '[')
    expect(view.state.doc.toString()).toBe('a [word] b')
    typeOverSelection(view, '[')
    expect(view.state.doc.toString()).toBe('a [[word]] b')
    expect(ranges(view)).toEqual([{ from: 4, to: 8 }])
  })

  it('键入闭合字符不包裹：选区被替换为键入字符（普通编辑语义）', () => {
    const { view } = setup('a word b')
    select(view, 2, 6)
    typeOverSelection(view, ')')
    expect(view.state.doc.toString()).toBe('a ) b')
  })

  it('英文尖括号不包裹：原样替换', () => {
    const { view } = setup('a word b')
    select(view, 2, 6)
    typeOverSelection(view, '<')
    expect(view.state.doc.toString()).toBe('a < b')
  })

  it('多字符插入不包裹（IME 完整符号对提交形态）', () => {
    const { view } = setup('a word b')
    select(view, 2, 6)
    typeOverSelection(view, '（）')
    expect(view.state.doc.toString()).toBe('a （） b')
  })
})

describe('跨段包裹：空行拆段、多 range 原文保持', () => {
  it('选 甲段\\n\\n乙段 键星号：各段包裹、空行保留、选区为各段原文', () => {
    const { view } = setup('甲段\n\n乙段')
    select(view, 0, 6)
    typeOverSelection(view, '*')
    expect(view.state.doc.toString()).toBe('*甲段*\n\n*乙段*')
    expect(ranges(view)).toEqual([
      { from: 1, to: 3 },
      { from: 7, to: 9 },
    ])
  })

  it('第二键得 **甲段**\\n\\n**乙段**：第一轮标记不当原文', () => {
    const { view } = setup('甲段\n\n乙段')
    select(view, 0, 6)
    typeOverSelection(view, '*')
    // 多 range 选区下的真实键入走 CM6 replaceSelection 形态（每 range
    // 一条替换），单 range 改写只覆盖 main 不符合该形态
    typeOverAllRanges(view, '*')
    expect(view.state.doc.toString()).toBe('**甲段**\n\n**乙段**')
    expect(ranges(view)).toEqual([
      { from: 2, to: 4 },
      { from: 10, to: 12 },
    ])
  })

  it('跨段包裹是一笔事务：一次撤销整体恢复（多块单笔 edit.request）', () => {
    const { sent, view } = setup('甲段\n\n乙段')
    select(view, 0, 6)
    typeOverSelection(view, '*')
    const requests = editRequests(sent)
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      changes: [
        { offset: 0, length: 0, text: '*' },
        { offset: 2, length: 0, text: '*' },
        { offset: 4, length: 0, text: '*' },
        { offset: 6, length: 0, text: '*' },
      ],
    })
  })

  it('多 range 选区再键入（CM6 replaceSelection 形态）逐段继续包裹', () => {
    const { view } = setup('甲段\n\n乙段')
    select(view, 0, 6)
    typeOverSelection(view, '*')
    typeOverAllRanges(view, '*')
    expect(view.state.doc.toString()).toBe('**甲段**\n\n**乙段**')
    expect(ranges(view)).toEqual([
      { from: 2, to: 4 },
      { from: 10, to: 12 },
    ])
  })

  it('纯空白选区不接管（保持原输入语义）', () => {
    const { view } = setup('甲\n\n乙')
    select(view, 1, 3)
    typeOverSelection(view, '*')
    expect(view.state.doc.toString()).toBe('甲*乙')
  })
})

describe('代码上下文门控（#124）', () => {
  const CODE_DOC = '```js\nconst a = 1\n```\n\n正文段'
  const INLINE_CODE_DOC = '行内 `code` 结束'

  it('代码块内 Markdown 强调不包裹（选区被替换，普通编辑语义）', () => {
    const { view } = setup(CODE_DOC)
    const start = CODE_DOC.indexOf('const')
    select(view, start, start + 5)
    typeOverSelection(view, '*')
    expect(view.state.doc.toString()).toBe(CODE_DOC.replace('const', '*'))
  })

  it('行内代码内 Markdown 强调不包裹', () => {
    const { view } = setup(INLINE_CODE_DOC)
    const start = INLINE_CODE_DOC.indexOf('code')
    select(view, start, start + 4)
    typeOverSelection(view, '*')
    expect(view.state.doc.toString()).toBe(INLINE_CODE_DOC.replace('code', '*'))
  })

  it('代码块内括号照常包裹', () => {
    const { view } = setup(CODE_DOC)
    const start = CODE_DOC.indexOf('const')
    select(view, start, start + 5)
    typeOverSelection(view, '(')
    expect(view.state.doc.toString()).toBe(CODE_DOC.replace('const', '(const)'))
  })

  it('正文包裹不受代码块存在影响', () => {
    const { view } = setup(CODE_DOC)
    const start = CODE_DOC.indexOf('正文段')
    select(view, start, start + 3)
    typeOverSelection(view, '*')
    expect(view.state.doc.toString()).toBe(CODE_DOC.replace('正文段', '*正文段*'))
  })
})

describe('表格上下文（#124）', () => {
  const TABLE_DOC = '| a | b |\n| --- | --- |\n| c1 | d1 |\n段落'

  it('格区选区不接管：格区输入语义归 tableEditing，不追加包裹符号', () => {
    const { view } = setup(TABLE_DOC)
    // 选中数据行第一列的格区（#123 用例同款构造；单行单格的格区输入
    // 既有语义为格内插入）
    selectTableRegion(view, { tableFrom: 0, rowFrom: 1, rowTo: 1, columnFrom: 0, columnTo: 0 })
    typeOverSelection(view, '*')
    // 符号包裹不接管：没有在格区两侧添加包裹符号，产物形态由
    // tableEditing 的格区语义决定（本票不改写它）
    expect(view.state.doc.toString()).toBe('| a | b |\n| --- | --- |\n| *c1 | d1 |\n段落')
  })

  it('格内局部文本选区照常包裹', () => {
    const { view } = setup(TABLE_DOC)
    const start = TABLE_DOC.indexOf('c1')
    select(view, start, start + 2)
    typeOverSelection(view, '*')
    expect(view.state.doc.toString()).toBe(TABLE_DOC.replace('c1', '*c1*'))
  })
})

describe('输入来源排除（#124）', () => {
  it('粘贴不包裹', () => {
    const { view } = setup('hello text')
    select(view, 6, 10)
    typeOverSelection(view, '**', 'input.paste')
    expect(view.state.doc.toString()).toBe('hello **')
  })

  it('拖放不包裹', () => {
    const { view } = setup('hello text')
    select(view, 6, 10)
    typeOverSelection(view, '**', 'input.drop')
    expect(view.state.doc.toString()).toBe('hello **')
  })

  it('组合中间与定稿事务（input.type.compose）不包裹', () => {
    const { view } = setup('hello text')
    select(view, 6, 10)
    typeOverSelection(view, '（', 'input.type.compose.start')
    expect(view.state.doc.toString()).toBe('hello （')
  })
})

describe('与无选区自动补全的规则隔离（#124）', () => {
  it('无选区星号序列不受包裹扩展影响：| → *|* → **| → ***|', () => {
    const { view } = setup('')
    typeOverSelection(view, '*')
    expect(view.state.doc.toString()).toBe('**')
    expect(view.state.selection.main.head).toBe(1)
    typeOverSelection(view, '*')
    expect(view.state.doc.toString()).toBe('**')
    expect(view.state.selection.main.head).toBe(2)
    typeOverSelection(view, '*')
    expect(view.state.doc.toString()).toBe('***')
    expect(view.state.selection.main.head).toBe(3)
  })

  it('两类输入规则不混用：选区包裹不升格为序列规则', () => {
    const { view } = setup('a word b')
    select(view, 2, 6)
    typeOverSelection(view, '*')
    typeOverSelection(view, '*')
    // 选区连续输入是叠加包裹（**word**），不是 **| 的序列形态
    expect(view.state.doc.toString()).toBe('a **word** b')
    expect(ranges(view)).toEqual([{ from: 4, to: 8 }])
  })
})

describe('设置开关（#124 与 #123 相互独立）', () => {
  it('关闭选区包裹后不接管、自动补全不受影响', () => {
    const { controller, view } = setup('a word b')
    controller.handleHostMessage({ kind: 'settings.changed', values: { 'editor.symbolSelectionWrap': false } })
    select(view, 2, 6)
    typeOverSelection(view, '*')
    expect(view.state.doc.toString()).toBe('a * b')
    // 无选区补全照常
    select(view, 0, 0)
    typeOverSelection(view, '(')
    expect(view.state.doc.toString()).toBe('()a * b')
    expect(view.state.selection.main.head).toBe(1)
  })

  it('关闭自动补全后选区包裹不受影响', () => {
    const { controller, view } = setup('a word b')
    controller.handleHostMessage({ kind: 'settings.changed', values: { 'editor.symbolAutocomplete': false } })
    select(view, 2, 6)
    typeOverSelection(view, '*')
    expect(view.state.doc.toString()).toBe('a *word* b')
    // 无选区补全停用：原样插入不补对
    select(view, 0, 0)
    typeOverSelection(view, '(')
    expect(view.state.doc.toString()).toBe('(a *word* b')
    expect(view.state.selection.main.head).toBe(1)
  })

  it('非布尔/缺省设置回默认（默认开启）', () => {
    const { controller, view } = setup('a word b')
    controller.handleHostMessage({ kind: 'settings.changed', values: {} })
    select(view, 2, 6)
    typeOverSelection(view, '*')
    expect(view.state.doc.toString()).toBe('a *word* b')
  })
})

describe('多光标混合形态防御（#124）', () => {
  it('range 与空光标混合不接管', () => {
    const { view } = setup('a word b')
    view.dispatch({
      selection: EditorSelection.create([
        EditorSelection.range(2, 6),
        EditorSelection.cursor(0),
      ], 0),
      userEvent: 'select.pointer',
    })
    typeOverAllRanges(view, '*')
    // CM6 replaceSelection 逐 range 替换为 *：包裹不接管混合形态
    expect(view.state.doc.toString()).toBe('*a * b')
  })
})
