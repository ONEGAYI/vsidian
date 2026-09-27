// 围栏内两步 Tab 越界的生产链路（工单 #125，jsdom 控制器）：fenceEscape
// keymap 接入后的真实 keydown 分发——两步光标断言、嵌套链、纯选区零写回、
// 与表格导航（格内先越界后切格）及 #120 缩进的优先级实测（生产控制器，
// 非装配注释推断）、有选区/多 range/代码块/设置关闭的回落。与浏览器套件
// （symbolInput 的 Tab 场景）互补：本层驱动 CM6 keymap 链（真实 keydown
// 事件），浏览器层用真实 Tab 键验证同一链路。
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EditorSelection } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
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
  // 生产 main.ts 同款：defaultKeymap 兜底（Backspace 等）
  controller.mount(document.createElement('div'), [keymap.of(defaultKeymap)])
  controller.handleHostMessage({ kind: 'init', sessionId: 'tab-escape', docUri: 'file:///tab-escape.md', version: 1, text })
  return { controller, sent, view: controller.getView()! }
}

/** 真实 keydown（与用户按 Tab 同一 keymap 链路） */
function pressTab(view: ReturnType<typeof setup>['view'], shift = false) {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true }),
  )
}

function locate(controller: ReturnType<typeof setup>['controller'], offset: number) {
  controller.handleHostMessage({ kind: 'view.locate', offset })
}

const editRequests = (sent: WebviewToHost[]) => sent.filter((m) => m.kind === 'edit.request')

/** 优先级与设置场景共用：表头第二格含 StrongEmphasis 围栏 */
const TABLE_DOC = '| a | **bc** |\n| --- | --- |\n| 1 | 2 |'
const ROW = TABLE_DOC.indexOf('**bc**')

describe('两步越界：纯选区移动、零写回', () => {
  it('规格样例 **some|thing** → **something|** → **something**|：文本不变、无 edit.request', () => {
    const { controller, sent, view } = setup('**something**')
    locate(controller, 6)
    pressTab(view)
    expect(view.state.doc.toString()).toBe('**something**')
    expect(view.state.selection.main.head).toBe(11)
    pressTab(view)
    expect(view.state.doc.toString()).toBe('**something**')
    expect(view.state.selection.main.head).toBe(13)
    expect(editRequests(sent)).toHaveLength(0)
  })

  it('目标是闭合边界而非词尾：**some| thing** 首按落在闭合左边界', () => {
    const { controller, view } = setup('**some thing**')
    locate(controller, 6)
    pressTab(view)
    expect(view.state.selection.main.head).toBe(12)
  })

  it('空内容围栏两步：*|* → *| 前界 → 越出', () => {
    const { controller, view } = setup('a **b** c')
    locate(controller, 5) // **b|** 的内容尾（贴闭标记左边界）→ 直接第二步
    pressTab(view)
    expect(view.state.selection.main.head).toBe(7)
    locate(controller, 4) // **|b** 贴开标记右侧 → 首步到内容尾
    pressTab(view)
    expect(view.state.selection.main.head).toBe(5)
  })

  it('普通括号与引号（无语法节点，行内匹配路径）：两步越界', () => {
    const { controller, sent, view } = setup('（中文内容）')
    locate(controller, 3)
    pressTab(view)
    expect(view.state.selection.main.head).toBe(5)
    pressTab(view)
    expect(view.state.selection.main.head).toBe(6)
    expect(view.state.doc.toString()).toBe('（中文内容）')
    expect(editRequests(sent)).toHaveLength(0)
  })

  it('英文引号交替配对下越界', () => {
    const { controller, view } = setup('say "hello world" ok')
    locate(controller, 9)
    pressTab(view)
    expect(view.state.selection.main.head).toBe(16)
    pressTab(view)
    expect(view.state.selection.main.head).toBe(17)
  })

  it('行内代码是树围栏：`a|b` 两步越出反引号', () => {
    const { controller, view } = setup('code `ab` tail')
    locate(controller, 7)
    pressTab(view)
    expect(view.state.selection.main.head).toBe(8)
    pressTab(view)
    expect(view.state.selection.main.head).toBe(9)
  })

  it('wikilink 经方括号行内匹配逐层越出（[[Note|alias]]，显式决策）', () => {
    const { controller, view } = setup('see [[Note|alias]] end')
    const base = 'see '.length
    locate(controller, base + 7)
    pressTab(view)
    expect(view.state.selection.main.head).toBe(base + 12)
    pressTab(view)
    expect(view.state.selection.main.head).toBe(base + 13)
    pressTab(view)
    expect(view.state.selection.main.head).toBe(base + 14)
  })
})

describe('嵌套逐层退出（最内层 → 外层）', () => {
  it('规格样例 (a **b|c** d) 四步链：树围栏与括号混合逐层退出', () => {
    const { controller, sent, view } = setup('(a **bc** d)')
    locate(controller, 6)
    pressTab(view)
    expect(view.state.selection.main.head).toBe(7)
    pressTab(view)
    expect(view.state.selection.main.head).toBe(9)
    pressTab(view)
    expect(view.state.selection.main.head).toBe(11)
    pressTab(view)
    expect(view.state.selection.main.head).toBe(12)
    expect(view.state.doc.toString()).toBe('(a **bc** d)')
    expect(editRequests(sent)).toHaveLength(0)
  })
})

describe('不越界情形：回落既有行为', () => {
  it('围栏外纯文本不向右搜索围栏：沿用 #120 整行缩进', () => {
    const { controller, view } = setup('something **next**')
    locate(controller, 2)
    pressTab(view)
    expect(view.state.doc.toString()).toBe('  something **next**')
    expect(view.state.selection.main.head).toBe(4)
  })

  it('有文本选区时不越界：走既有选区缩进', () => {
    const { view } = setup('**bold** rest')
    view.dispatch({ selection: EditorSelection.range(2, 6) })
    pressTab(view)
    expect(view.state.doc.toString()).toBe('  **bold** rest')
  })

  it('代码块内 Tab 继续缩进不越界', () => {
    const { controller, view } = setup('```js\n(a, b)\n```')
    locate(controller, 7)
    pressTab(view)
    expect(view.state.doc.toString()).toBe('```js\n  (a, b)\n```')
    expect(view.state.selection.main.head).toBe(9)
  })

  it('成型 frontmatter 光标不可达：定位即被引导至闭合行后，头区不参与越界', () => {
    const { controller, view } = setup('---\ntitle: "a"\n---\n\nbody')
    // #140 Popover 改版：成型头区不暴露源码——定位到引号内部即被光标
    // 引导弹到闭合行后（body 起点）；Tab 落在正文空行按缩进语义处理，
    // 头区字节不变（围栏越界路径不涉及头区）
    locate(controller, 12) // 引号内部
    expect(view.state.selection.main.head).toBe('---\ntitle: "a"\n---\n'.length)
    pressTab(view)
    // 引导位置是空行行首：Tab 按正文缩进语义给空行补一级缩进（空行成为
    // '  ' 行）；头区字节不变、围栏越界路径不涉及头区
    expect(view.state.doc.toString()).toBe('---\ntitle: "a"\n---\n  \nbody')
  })

  it('Shift+Tab 不新增反向越界：围栏内 Shift+Tab 仍是反向缩进', () => {
    const { controller, view } = setup('  **bold** rest')
    locate(controller, 7)
    pressTab(view, true)
    expect(view.state.doc.toString()).toBe('**bold** rest')
    expect(view.state.selection.main.head).toBe(5)
  })

  it('多 range 光标不越界：保持既有缩进的行并集语义（显式决策：只处理单 range）', () => {
    const { view } = setup('**bold** x\nplain y')
    view.dispatch({
      selection: EditorSelection.create([
        EditorSelection.cursor(3),
        EditorSelection.cursor(12),
      ]),
    })
    pressTab(view)
    expect(view.state.doc.toString()).toBe('  **bold** x\n  plain y')
  })
})

describe('优先级硬契约（生产控制器实测：越界 → 表格导航 → 缩进）', () => {
  it('表格格内先两步越界、越出后 Tab 切格：全程零写回', () => {
    const { controller, sent, view } = setup(TABLE_DOC)
    locate(controller, ROW + 3) // **b|c** 内容中间
    pressTab(view)
    expect(view.state.doc.toString()).toBe(TABLE_DOC)
    expect(view.state.selection.main.head).toBe(ROW + 4) // **bc|**（闭合左边界）
    pressTab(view)
    expect(view.state.selection.main.head).toBe(ROW + 6) // **bc**|（越过整个闭合标记，仍在格内）
    pressTab(view)
    expect(view.state.selection.main.head).toBe(TABLE_DOC.indexOf('1')) // 越出围栏后切格（跳过分隔行）
    expect(view.state.doc.toString()).toBe(TABLE_DOC)
    expect(editRequests(sent)).toHaveLength(0)
  })

  it('格内无围栏直接切格（越界未命中自然落穿）', () => {
    const { controller, view } = setup(TABLE_DOC)
    locate(controller, TABLE_DOC.indexOf('a') + 1)
    pressTab(view)
    expect(view.state.selection.main.head).toBe(ROW) // 下一格内容首（**bc** 的星号前）
    expect(view.state.doc.toString()).toBe(TABLE_DOC)
  })

  it('正文无围栏落穿到 #120 缩进（越界层 return false 不吞键）', () => {
    const { controller, view } = setup('plain line')
    locate(controller, 5)
    pressTab(view)
    expect(view.state.doc.toString()).toBe('  plain line')
    expect(view.state.selection.main.head).toBe(7)
  })

  it('代码块落穿到缩进（FencedCode 上下文排除）', () => {
    const { controller, view } = setup('```\n(fenced)\n```')
    locate(controller, 6)
    pressTab(view)
    expect(view.state.doc.toString()).toBe('```\n  (fenced)\n```')
  })
})

describe('设置开关（editor.symbolTabEscape）', () => {
  it('默认开启：装配即生效', () => {
    const { controller, view } = setup('**something**')
    locate(controller, 6)
    pressTab(view)
    expect(view.state.selection.main.head).toBe(11)
  })

  it('关闭后回落既有 Tab 行为（围栏内 Tab 变为整行缩进）', () => {
    const { controller, view } = setup('**something**')
    controller.handleHostMessage({ kind: 'settings.changed', values: { 'editor.symbolTabEscape': false } })
    locate(controller, 6)
    pressTab(view)
    expect(view.state.doc.toString()).toBe('  **something**')
    expect(view.state.selection.main.head).toBe(8)
  })

  it('关闭后表格格内直接切格；重新开启恢复越界（即时生效）', () => {
    const { controller, view } = setup(TABLE_DOC)
    controller.handleHostMessage({ kind: 'settings.changed', values: { 'editor.symbolTabEscape': false } })
    locate(controller, ROW + 3)
    pressTab(view)
    expect(view.state.selection.main.head).toBe(TABLE_DOC.indexOf('1'))
    controller.handleHostMessage({ kind: 'settings.changed', values: { 'editor.symbolTabEscape': true } })
    pressTab(view) // 现在光标在数据行首格（无围栏），切格到第二格
    expect(view.state.doc.toString()).toBe(TABLE_DOC)
    expect(view.state.selection.main.head).toBe(TABLE_DOC.indexOf('2'))
    locate(controller, ROW + 3)
    pressTab(view)
    expect(view.state.selection.main.head).toBe(ROW + 4)
  })

  it('关闭越界不影响 #123 补全与 #124 包裹开关的独立性', () => {
    const { controller, view } = setup('')
    controller.handleHostMessage({ kind: 'settings.changed', values: { 'editor.symbolTabEscape': false } })
    view.dispatch({
      changes: { from: 0, insert: '(' },
      selection: { anchor: 1 },
      userEvent: 'input.type',
    })
    expect(view.state.doc.toString()).toBe('()')
  })
})
