// 符号自动补全生产链路（工单 #123，jsdom 控制器）：transactionFilter 接入
// 后的真实事务流——补全单笔 edit.request、闭合越过零写回、自动空对退格、
// IME 组合门控、粘贴排除、代码上下文、表格格区语义、设置开关与外部重载
// 失效。与浏览器套件（symbolInput）互补：本层驱动 CM6 事务（userEvent 注解
// 模拟浏览器 input 事件回流），浏览器层用真实键盘/IME 验证同一链路。
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { keymap } from '@codemirror/view'
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
  // 生产 main.ts 同款：defaultKeymap 提供 Backspace 默认删除（本套件断言
  // 「非自动来源不接管」时依赖它）
  controller.mount(document.createElement('div'), [keymap.of(defaultKeymap)])
  controller.handleHostMessage({ kind: 'init', sessionId: 'symbol', docUri: 'file:///symbol.md', version: 1, text })
  return { controller, sent, view: controller.getView()! }
}

/** 模拟浏览器 input 事件回流产生的事务（CM6 对普通键入的 userEvent 与
 *  光标形态：插入后光标落在插入文本之后——CM6 domObserver 从 DOM 选区
 *  读出的正是这一形态）。带 to 时模拟选区替换事务 */
function typeText(
  view: ReturnType<typeof setup>['view'],
  from: number,
  text: string,
  userEvent = 'input.type',
  to?: number,
) {
  view.dispatch({
    changes: { from, to: to ?? from, insert: text },
    selection: { anchor: from + text.length },
    userEvent,
  })
}

/** 回 ack 确认既有未确认编辑（连续两笔重叠编辑的第二笔会被同步协议暂缓
 *  出站——deferredLocal；回 ack 后下一笔立即出站） */
function ackPending(controller: ReturnType<typeof setup>['controller'], sent: WebviewToHost[]) {
  const pending = sent.filter((m) => m.kind === 'edit.request').at(-1) as { seq: number } | undefined
  if (pending) {
    controller.handleHostMessage({ kind: 'edit.ack', seq: pending.seq, ok: true, version: 99 })
  }
}

function pressBackspace(view: ReturnType<typeof setup>['view']) {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }),
  )
}

const editRequests = (sent: WebviewToHost[]) => sent.filter((m) => m.kind === 'edit.request')

describe('无选区自动补全：单笔事务、光标居中', () => {
  it('键入起始括号补入闭合符号：单笔 edit.request 携带两侧文本', () => {
    const { sent, view } = setup('')
    typeText(view, 0, '(')
    expect(view.state.doc.toString()).toBe('()')
    expect(view.state.selection.main.head).toBe(1)
    expect(editRequests(sent)).toHaveLength(1)
    expect(editRequests(sent)[0]).toMatchObject({
      kind: 'edit.request',
      changes: [{ offset: 0, length: 0, text: '()' }],
    })
  })

  it.each([
    ['[', '[]'], ['{', '{}'],
    ['（', '（）'], ['【', '【】'], ['《', '《》'], ['「', '「」'], ['『', '『』'],
    ['“', '“”'], ['‘', '‘’'], ['"', '""'], ["'", "''"],
    ['*', '**'], ['_', '__'], ['~', '~~'], ['`', '``'], ['=', '=='], ['$', '$$'],
  ])('键入 %s 得 %s 且光标居中', (open, wrapped) => {
    const { view } = setup('')
    typeText(view, 0, open)
    expect(view.state.doc.toString()).toBe(wrapped)
    expect(view.state.selection.main.head).toBe(1)
  })

  it('英文尖括号不补全：原样插入', () => {
    const { view } = setup('')
    typeText(view, 0, '<')
    expect(view.state.doc.toString()).toBe('<')
    expect(view.state.selection.main.head).toBe(1)
  })

  it('非注册字符与多字符插入不触发补全', () => {
    const { view } = setup('')
    typeText(view, 0, 'x')
    expect(view.state.doc.toString()).toBe('x')
    typeText(view, 1, 'ab')
    expect(view.state.doc.toString()).toBe('xab')
  })
})

describe('闭合越过：紧贴自动补出的闭合符号再键入同一符号', () => {
  it('括号越过零写回：文本不变、光标跳过闭合符号、无新增 edit.request', () => {
    const { sent, view } = setup('')
    typeText(view, 0, '(')
    expect(view.state.doc.toString()).toBe('()')
    const before = editRequests(sent).length
    typeText(view, 1, ')')
    expect(view.state.doc.toString()).toBe('()')
    expect(view.state.selection.main.head).toBe(2)
    expect(editRequests(sent)).toHaveLength(before)
  })

  it('越过同样适用于弯引号与 Markdown 自反符号', () => {
    const { view } = setup('')
    typeText(view, 0, '“')
    expect(view.state.doc.toString()).toBe('“”')
    typeText(view, 1, '”')
    expect(view.state.doc.toString()).toBe('“”')
    expect(view.state.selection.main.head).toBe(2)
  })

  it('越过只认自动补出的闭合符号：手打的相邻闭合符号照常插入', () => {
    const { view } = setup('()')
    view.dispatch({ selection: { anchor: 1 } })
    typeText(view, 1, ')')
    expect(view.state.doc.toString()).toBe('())')
  })

  it('越过消耗后自动状态消失：再键入闭合符号为普通插入', () => {
    const { view } = setup('')
    typeText(view, 0, '(')
    typeText(view, 1, ')')
    typeText(view, 2, ')')
    expect(view.state.doc.toString()).toBe('())')
  })
})

describe('星号连续输入硬契约：| → *|* → **| → ***|', () => {
  it('三连击严格得到空对、越过、单边第三星', () => {
    const { view } = setup('')
    typeText(view, 0, '*')
    expect(view.state.doc.toString()).toBe('**')
    expect(view.state.selection.main.head).toBe(1)
    typeText(view, 1, '*')
    expect(view.state.doc.toString()).toBe('**')
    expect(view.state.selection.main.head).toBe(2)
    typeText(view, 2, '*')
    expect(view.state.doc.toString()).toBe('***')
    expect(view.state.selection.main.head).toBe(3)
  })

  it('已有星号前缀（词尾闭合场景）仍按串首契约补全：**bold| 键 * 得 **bold*|*',
    () => {
      // runBefore 只看紧邻左侧同字符：`d` 前无星号 → 补全（闭合粗体的
      // 第二键经越过消费，与星号契约一致，不特判词形）
      const { view } = setup('**bold')
      view.dispatch({ selection: { anchor: 6 } })
      typeText(view, 6, '*')
      expect(view.state.doc.toString()).toBe('**bold**')
      expect(view.state.selection.main.head).toBe(7)
    })
})

describe('自动空对退格删除', () => {
  it('自动补出的空符号对内部退格同删两侧（单笔 edit.request）', () => {
    const { controller, sent, view } = setup('')
    typeText(view, 0, '（')
    expect(view.state.doc.toString()).toBe('（）')
    const before = editRequests(sent).length
    // 回 ack：连续重叠编辑的第二笔默认暂缓出站（既有同步协议），确认后
    // 删除那笔才能立即出站
    ackPending(controller, sent)
    pressBackspace(view)
    expect(view.state.doc.toString()).toBe('')
    expect(view.state.selection.main.head).toBe(0)
    expect(editRequests(sent)).toHaveLength(before + 1)
    expect(editRequests(sent).at(-1)).toMatchObject({
      kind: 'edit.request',
      changes: [{ offset: 0, length: 2, text: '' }],
    })
  })

  it('非自动来源的空对退格只删起始符号（交默认行为）', () => {
    const { view } = setup('()')
    view.dispatch({ selection: { anchor: 1 } })
    const before = view.state.doc.toString()
    expect(before).toBe('()')
    pressBackspace(view)
    expect(view.state.doc.toString()).toBe(')')
  })

  it('对内出现内容后退格不再同删两侧', () => {
    const { view } = setup('')
    typeText(view, 0, '(')
    typeText(view, 1, '好')
    expect(view.state.doc.toString()).toBe('(好)')
    pressBackspace(view)
    expect(view.state.doc.toString()).toBe('()')
  })

  it('外部重载（doc.resync）清空自动状态：退格不误删', () => {
    const { controller, view } = setup('')
    typeText(view, 0, '(')
    expect(view.state.doc.toString()).toBe('()')
    controller.handleHostMessage({ kind: 'doc.resync', version: 5, text: '()' })
    view.dispatch({ selection: { anchor: 1 } })
    pressBackspace(view)
    expect(view.state.doc.toString()).toBe(')')
  })
})

describe('输入法与粘贴', () => {
  it('组合进行中不干预；组合结束点提交单个起始符号补全（端到端）', async () => {
    const { controller, view } = setup('')
    controller.handleHostMessage({ kind: 'sync.test.composition', phase: 'start', text: '' })
    controller.handleHostMessage({ kind: 'sync.test.composition', phase: 'update', text: '（' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    // 候选阶段：只有候选文本本身，无闭合补全
    expect(view.state.doc.toString()).toBe('（')
    // jsdom 无布局，CM6 不从 DOM 选区读回组合光标——手动摆到提交符后
    // （真实浏览器由布局选区自然落位，symbolInput 套件已实证）
    view.dispatch({ selection: { anchor: 1 } })
    controller.handleHostMessage({ kind: 'sync.test.composition', phase: 'end', text: '（' })
    // compositionend 钩子延后微任务主动补全（Chromium 提交==候选时无定稿事务）
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(view.state.doc.toString()).toBe('（）')
    expect(view.state.selection.main.head).toBe(1)
  })

  it('输入法提交完整符号对不重复补全', async () => {
    const { controller, view } = setup('')
    controller.handleHostMessage({ kind: 'sync.test.composition', phase: 'start', text: '' })
    controller.handleHostMessage({ kind: 'sync.test.composition', phase: 'update', text: '（）' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    view.dispatch({ selection: { anchor: 2 } })
    controller.handleHostMessage({ kind: 'sync.test.composition', phase: 'end', text: '（）' })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(view.state.doc.toString()).toBe('（）')
  })

  it('组合结束窗口内的 compose 定稿事务不被 filter 改写（补全由钩子宏任务统一完成）', () => {
    const { controller, view } = setup('')
    controller.handleHostMessage({ kind: 'sync.test.composition', phase: 'start', text: '' })
    controller.handleHostMessage({ kind: 'sync.test.composition', phase: 'end', text: 'x' })
    // compositionend 后 field 延迟一个宏任务复位：窗口内的 compose 事务
    // （真实链路即 CM6 的定稿 flush）原样放行；补全统一由 compositionend
    // 钩子的 attempt 触发（上一用例端到端覆盖）
    typeText(view, 0, '（', 'input.type.compose')
    expect(view.state.doc.toString()).toBe('（')
  })

  it('粘贴事务（input.paste）不触发补全', () => {
    const { view } = setup('')
    typeText(view, 0, '(', 'input.paste')
    expect(view.state.doc.toString()).toBe('(')
  })

  it('拖放事务（input.drop）不触发补全', () => {
    const { view } = setup('')
    typeText(view, 0, '*', 'input.drop')
    expect(view.state.doc.toString()).toBe('*')
  })
})

describe('上下文抑制与共存', () => {
  it('围栏代码块内：括号照补、Markdown 强调抑制', () => {
    const { view } = setup('```js\n\n```')
    // 光标在围栏中间的空行（CodeText 区间）内
    view.dispatch({ selection: { anchor: 6 } })
    typeText(view, 6, '(')
    expect(view.state.doc.toString()).toBe('```js\n()\n```')
    typeText(view, 7, '*')
    expect(view.state.doc.toString()).toBe('```js\n(*)\n```')
  })

  it('行内代码内：括号照补、强调抑制', () => {
    const { view } = setup('a `b` c')
    // 内容首（b 之前）键 [：#151 右邻词字符不补——口径不豁免代码上下文
    view.dispatch({ selection: { anchor: 3 } })
    typeText(view, 3, '[')
    expect(view.state.doc.toString()).toBe('a `[b` c')
    expect(view.state.selection.main.head).toBe(4)
    // 内容尾（闭反引号前，右邻 ` 属注册表闭合类）键 [：allowInCode 照补
    view.dispatch({ selection: { anchor: 5 } })
    typeText(view, 5, '[')
    expect(view.state.doc.toString()).toBe('a `[b[]` c')
    expect(view.state.selection.main.head).toBe(6)
    // 同位置再键强调符：行内代码按代码口径抑制（不补对）
    typeText(view, 6, '~')
    expect(view.state.doc.toString()).toBe('a `[b[~]` c')
  })

  it('降级头区（不可成型）按代码口径：括号照补、强调抑制', () => {
    // #140 Popover 改版：成型头区光标不可达（编辑收敛到 Popover），代码
    // 口径的可编辑面收敛到降级源码形态（复杂类型）——嵌套键使头区降级
    const { view } = setup('---\nouter:\n  inner: x\n---\n')
    // 光标在 x 之后
    view.dispatch({ selection: { anchor: 21 } })
    typeText(view, 21, '(')
    expect(view.state.doc.toString()).toBe('---\nouter:\n  inner: x()\n---\n')
    typeText(view, 22, '=')
    expect(view.state.doc.toString()).toBe('---\nouter:\n  inner: x(=)\n---\n')
  })

  it('反斜杠转义后的符号按普通文字处理', () => {
    const { view } = setup('a \\')
    view.dispatch({ selection: { anchor: 3 } })
    typeText(view, 3, '*')
    expect(view.state.doc.toString()).toBe('a \\*')
    // 另一 Markdown 触发符同样只在紧邻 \ 后被抑制
    const second = setup('b \\')
    second.view.dispatch({ selection: { anchor: 3 } })
    typeText(second.view, 3, '~')
    expect(second.view.state.doc.toString()).toBe('b \\~')
  })

  it('英文撇号词中不配对', () => {
    const { view } = setup("don")
    view.dispatch({ selection: { anchor: 3 } })
    typeText(view, 3, "'")
    expect(view.state.doc.toString()).toBe("don'")
  })

  it('表格格区选区替换语义不被改写', () => {
    const table = '| A | B |\n| --- | --- |\n| x | y |'
    const { view } = setup(table)
    selectTableRegion(view, { tableFrom: 0, rowFrom: 0, rowTo: 1, columnFrom: 0, columnTo: 0 })
    typeText(view, view.state.selection.main.from, '（')
    // 既有格区替换语义（#72「普通输入覆盖矩形内容，文本只落左上格」）：
    // 左上格替换为（、其余选中格清空；符号补全不得在此追加闭合符号
    expect(view.state.doc.toString()).toBe('| （ | B |\n| --- | --- |\n|  | y |')
  })

  it('有普通文本选区时不补全：选区走 #124 包裹路径（两侧包裹，非空对插入）', () => {
    const { view } = setup('word')
    view.dispatch({ selection: { anchor: 0, head: 4 } })
    typeText(view, 0, '(', 'input.type', 4)
    // #124 落地后：非空选区的键入经 symbolWrap 包裹（(word)），补全的
    // 光标居中形态不复现（详见 symbolWrapInteraction 契约）
    expect(view.state.doc.toString()).toBe('(word)')
  })
})

describe('编程式多变更事务（形态门控）', () => {
  it('插、替、插三变更事务放行原事务：不把第三条纯插入误当单条插入接管', () => {
    // 评审 P1-1：singleInsertionOf 曾在「纯插入、替换、纯插入」序列下让
    // 第三条纯插入复活已判废的 found（真实用户路径不可达——单 range 用户
    // 输入恒为一条变更，多 range 另有 ranges 门控；此形态仅编程式
    // view.dispatch 复合变更可达，且三条变更间须隔未变字符——CM6 会把
    // 相邻的替换与插入合并成一条替换，见 ChangeSet 构造）。放行 = 三条
    // 变更照常应用，不得改写为补全形态（缺陷产物会是 abc()d：三条原始
    // 变更全部被丢弃、改写为 at 3 插入 ()）
    const { view } = setup('abcd')
    view.dispatch({ selection: { anchor: 3 } })
    view.dispatch({
      changes: [
        { from: 0, insert: '(' },
        { from: 1, to: 2, insert: 'x' },
        { from: 3, insert: '(' },
      ],
      selection: { anchor: 3 },
      userEvent: 'input.type',
    })
    expect(view.state.doc.toString()).toBe('(axc(d')
  })
})

describe('设置开关（editor.symbolAutocomplete）', () => {
  it('默认开启；关闭后补全、越过、空对删除全部停用', () => {
    const { controller, sent, view } = setup('')
    controller.handleHostMessage({
      kind: 'settings.changed',
      values: { 'editor.symbolAutocomplete': false },
    })
    typeText(view, 0, '(')
    expect(view.state.doc.toString()).toBe('(')
    expect(view.state.selection.main.head).toBe(1)
    expect(editRequests(sent)).toHaveLength(1)
    // 键入 ) 为普通插入（无自动状态可越过）
    typeText(view, 1, ')')
    expect(view.state.doc.toString()).toBe('()')
    // 退格只删光标前一个字符（不识别空对，无同删两侧）
    pressBackspace(view)
    expect(view.state.doc.toString()).toBe('(')
  })

  it('关闭再开启即时恢复补全', () => {
    const { controller, view } = setup('')
    controller.handleHostMessage({
      kind: 'settings.changed',
      values: { 'editor.symbolAutocomplete': false },
    })
    controller.handleHostMessage({
      kind: 'settings.changed',
      values: { 'editor.symbolAutocomplete': true },
    })
    typeText(view, 0, '(')
    expect(view.state.doc.toString()).toBe('()')
  })

  it('阅读模式不接管：正文无 input 事务路径（编辑器隐藏，无补全发生）', () => {
    const { controller, sent, view } = setup('文字')
    const before = editRequests(sent).length
    controller.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    expect(view.state.doc.toString()).toBe('文字')
    expect(editRequests(sent)).toHaveLength(before)
  })
})
