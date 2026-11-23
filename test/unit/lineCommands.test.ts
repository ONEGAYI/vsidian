// @vitest-environment jsdom
// VSCode 编辑器操作族（2026-11-23）：视口按行滚动与上下插入空行。
// planLineInsert / lineScrollTop 是纯函数（无 DOM）；insertLineAt 经真实
// EditorView 驱动；键位本地分支与 ui.command 两入口经生产控制器 + 真实
// KeyboardEvent 驱动。真实滚动位移由浏览器套件 keybindingEditor 断言
// （jsdom 无布局，scrollTop 不可观测）。
import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState, type Extension, type Text } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import {
  insertLineAt, lineScrollTop, planLineInsert, registryLineTakeover, scrollByLine,
} from '../../src/webview/lineCommands'
import {
  clampFoldHiddenCursor, collectHeadings, effectiveHeadingFolds, headingFoldField,
} from '../../src/webview/headingFold'
import { liveDecorationsField } from '../../src/webview/liveDecorations'
import { setTableRegion, tableRegionField } from '../../src/webview/tableRegionField'
import { WebviewSyncController } from '../../src/webview/syncController'

// jsdom 无布局：CM6 视口测量的零值 polyfill（keybindingUiCommands.test.ts 同款）
if (Range.prototype.getClientRects === undefined) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0)
}

const docOf = (text: string): Text => EditorState.create({ doc: text }).doc

describe('插入空行计划（planLineInsert）', () => {
  it('下方插入：在行尾断行，新行继承当前行的前导空白，光标落在新行缩进后', () => {
    const doc = docOf('    - nested item\nnext')
    expect(planLineInsert(doc, 8, 'below')).toEqual({ from: 17, insert: '\n    ', cursor: 22 })
    // 无缩进行：新行为纯空行
    expect(planLineInsert(docOf('abc\ndef'), 1, 'below')).toEqual({ from: 3, insert: '\n', cursor: 4 })
  })

  it('上方插入：在行首插入「当前行前导空白 + 换行」，原行连同自身缩进整体下移', () => {
    const doc = docOf('first\n    - nested item')
    expect(planLineInsert(doc, 15, 'above')).toEqual({ from: 6, insert: '    \n', cursor: 10 })
    // 首行上方：文档起点插入，光标落新首行
    expect(planLineInsert(docOf('abc\ndef'), 2, 'above')).toEqual({ from: 0, insert: '\n', cursor: 0 })
  })

  it('末行下方插入（文档无尾换行）与 Tab 缩进继承', () => {
    const doc = docOf('abc\n\titem')
    expect(planLineInsert(doc, 7, 'below')).toEqual({ from: 9, insert: '\n\t', cursor: 11 })
  })
})

describe('视口按行滚动目标（lineScrollTop）', () => {
  it('每次平移一个行高；顶部/底部钳制，已在边界时无可滚动返回 null', () => {
    const roomy = { scrollTop: 40, clientHeight: 600, scrollHeight: 2000 }
    expect(lineScrollTop(roomy, 24, 1)).toBe(64)
    expect(lineScrollTop(roomy, 24, -1)).toBe(16)
    expect(lineScrollTop({ ...roomy, scrollTop: 10 }, 24, -1)).toBe(0)
    expect(lineScrollTop({ ...roomy, scrollTop: 0 }, 24, -1)).toBeNull()
    expect(lineScrollTop({ ...roomy, scrollTop: 1390 }, 24, 1)).toBe(1400)
    expect(lineScrollTop({ ...roomy, scrollTop: 1400 }, 24, 1)).toBeNull()
  })

  it('内容不足一屏或行高非正时无可滚动', () => {
    expect(lineScrollTop({ scrollTop: 0, clientHeight: 600, scrollHeight: 600 }, 24, 1)).toBeNull()
    expect(lineScrollTop({ scrollTop: 0, clientHeight: 600, scrollHeight: 2000 }, 0, 1)).toBeNull()
    expect(lineScrollTop({ scrollTop: 0, clientHeight: 600, scrollHeight: 2000 }, Number.NaN, 1)).toBeNull()
  })
})

// 键位所有权归注册表：defaultKeymap 内建的 Mod-Enter（insertBlankLine）由
// 接管 keymap 退役——用户清空/改绑「在下方插入空行」后内建绑定不得复活。
describe('Ctrl+Enter 内建绑定接管（registryLineTakeover）', () => {
  function bareEditor(extensions: Extension[], doc = 'abc'): { root: HTMLElement; view: EditorView } {
    const root = document.createElement('div')
    document.body.append(root)
    const view = new EditorView({ parent: root, state: EditorState.create({ doc, extensions }) })
    return { root, view }
  }

  const pressCtrlEnter = (view: EditorView): void => {
    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }))
  }

  it('对照组：裸 defaultKeymap 下 Ctrl+Enter 经内建 insertBlankLine 插入空行（接管必要性的事实钉）', () => {
    const { root, view } = bareEditor([keymap.of(defaultKeymap)])
    pressCtrlEnter(view)
    expect(view.state.doc.toString()).toBe('abc\n')
    view.destroy()
    root.remove()
  })

  it('接管后内建绑定不执行（吞键不执行，文档零变更）', () => {
    const { root, view } = bareEditor([registryLineTakeover, keymap.of(defaultKeymap)])
    pressCtrlEnter(view)
    expect(view.state.doc.toString()).toBe('abc')
    view.destroy()
    root.remove()
  })

  const pressAltArrow = (view: EditorView, key: 'ArrowUp' | 'ArrowDown'): void => {
    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key, altKey: true, bubbles: true, cancelable: true }))
  }

  it('对照组：裸 defaultKeymap 下 Alt+↓ 经内建 moveLineDown 移动当前行（接管必要性的事实钉）', () => {
    const { root, view } = bareEditor([keymap.of(defaultKeymap)], 'a\nb')
    view.dispatch({ selection: { anchor: 0 } })
    pressAltArrow(view, 'ArrowDown')
    expect(view.state.doc.toString()).toBe('b\na')
    view.destroy()
    root.remove()
  })

  it('接管后 Alt+方向键的内建移动不执行（吞键不执行，文档零变更）', () => {
    const { root, view } = bareEditor([registryLineTakeover, keymap.of(defaultKeymap)], 'a\nb')
    view.dispatch({ selection: { anchor: 0 } })
    pressAltArrow(view, 'ArrowDown')
    expect(view.state.doc.toString()).toBe('a\nb')
    view.destroy()
    root.remove()
  })

})

describe('上下插入空行：键位本地分支与 ui.command 两入口', () => {
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

  function setup(text: string): { root: HTMLElement; controller: WebviewSyncController; sent: unknown[] } {
    const root = document.createElement('div')
    document.body.append(root)
    const sent: unknown[] = []
    const controller = new WebviewSyncController({
      postMessage: (m) => sent.push(m),
      getState: () => undefined,
      setState: () => undefined,
    })
    controller.mount(root)
    controller.handleHostMessage({ kind: 'init', sessionId: 'line-commands',
      docUri: 'file:///line-commands.md', version: 1, text })
    return { root, controller, sent }
  }

  function editor(root: HTMLElement): EditorView {
    const view = EditorView.findFromDOM(root.querySelector('.cm-editor') as HTMLElement)
    if (!view) throw new Error('未找到主编辑器实例')
    return view
  }

  function teardown(root: HTMLElement, controller: WebviewSyncController): void {
    controller.dispose()
    root.remove()
  }

  /** 经 document 捕获层派发真实 KeyboardEvent（与用户按键同路径） */
  function pressKey(root: HTMLElement, key: string, init: KeyboardEventInit): void {
    editor(root).contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key, ...init, bubbles: true, cancelable: true }))
  }

  const editsOf = (sent: unknown[]) => sent.filter((m) => (m as { kind?: string }).kind === 'edit.request')
  const overridesMessage = (controller: WebviewSyncController, overrides: Record<string, string[]>) =>
    controller.handleHostMessage({ kind: 'keybindings.changed', overrides })

  it('Ctrl+Enter 下方插入空行：当前行不动、光标落新行、单笔写回', async () => {
    const { root, controller, sent } = setup('- item\nnext')
    editor(root).dispatch({ selection: { anchor: 3 } })
    pressKey(root, 'Enter', { ctrlKey: true })
    expect(editor(root).state.doc.toString()).toBe('- item\n\nnext')
    expect(editor(root).state.selection.main.head).toBe(7)
    await settle()
    expect(editsOf(sent).length).toBe(1)
    teardown(root, controller)
  })

  it('Ctrl+Shift+Enter 上方插入空行：原行整体下移、光标落新空行', async () => {
    const { root, controller, sent } = setup('first\nsecond')
    editor(root).dispatch({ selection: { anchor: 2 } })
    pressKey(root, 'Enter', { ctrlKey: true, shiftKey: true })
    expect(editor(root).state.doc.toString()).toBe('\nfirst\nsecond')
    expect(editor(root).state.selection.main.head).toBe(0)
    await settle()
    expect(editsOf(sent).length).toBe(1)
    teardown(root, controller)
  })

  it('新空行继承当前行缩进；有选区时塌缩为新行上的单光标（选区文本保留）', () => {
    const { root, controller } = setup('    - nested item\nnext')
    const view = editor(root)
    view.dispatch({ selection: { anchor: 6, head: 12 } })
    pressKey(root, 'Enter', { ctrlKey: true })
    expect(view.state.doc.toString()).toBe('    - nested item\n    \nnext')
    expect(view.state.selection.main.empty).toBe(true)
    expect(view.state.selection.main.head).toBe(22)
    // 上方：缩进随新行落上方，原行连同自身缩进整体下移；光标在新行缩进后
    view.dispatch({ selection: { anchor: 8 } })
    pressKey(root, 'Enter', { ctrlKey: true, shiftKey: true })
    expect(view.state.doc.toString()).toBe('    \n    - nested item\n    \nnext')
    expect(view.state.selection.main.head).toBe(4)
    teardown(root, controller)
  })

  it('ui.command 命令面板入口与键位同一执行体', () => {
    const { root, controller } = setup('aaa\nbbb\nccc')
    editor(root).dispatch({ selection: { anchor: 5 } })
    controller.handleHostMessage({ kind: 'ui.command', op: 'insertLineBelow' })
    expect(editor(root).state.doc.toString()).toBe('aaa\nbbb\n\nccc')
    expect(editor(root).state.selection.main.head).toBe(8)
    // 光标已在新空行上：再上方插入一条空行，光标随新行上移
    controller.handleHostMessage({ kind: 'ui.command', op: 'insertLineAbove' })
    expect(editor(root).state.doc.toString()).toBe('aaa\nbbb\n\n\nccc')
    expect(editor(root).state.selection.main.head).toBe(8)
    teardown(root, controller)
  })

  it('显式清空后按键不插入（内建 Mod-Enter 不复活）；改绑后按新键生效', () => {
    const { root, controller } = setup('abc\ndef')
    overridesMessage(controller, { insertLineBelow: [], insertLineAbove: [] })
    pressKey(root, 'Enter', { ctrlKey: true })
    pressKey(root, 'Enter', { ctrlKey: true, shiftKey: true })
    expect(editor(root).state.doc.toString()).toBe('abc\ndef')
    overridesMessage(controller, { insertLineBelow: ['ctrl+alt+enter'] })
    editor(root).dispatch({ selection: { anchor: 1 } })
    pressKey(root, 'Enter', { ctrlKey: true, altKey: true })
    expect(editor(root).state.doc.toString()).toBe('abc\n\ndef')
    teardown(root, controller)
  })

  it('阅读模式静默：键位与命令均不写入', () => {
    const { root, controller, sent } = setup('abc\ndef')
    controller.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
    pressKey(root, 'Enter', { ctrlKey: true })
    controller.handleHostMessage({ kind: 'ui.command', op: 'insertLineBelow' })
    controller.handleHostMessage({ kind: 'ui.command', op: 'insertLineAbove' })
    expect(editor(root).state.doc.toString()).toBe('abc\ndef')
    expect(editsOf(sent)).toEqual([])
    teardown(root, controller)
  })

  it('多光标：只在主选区所在行插入，其余选区经映射原样保留（多光标形态不收敛）', () => {
    const { root, controller } = setup('aaa\nbbb\nccc')
    const view = editor(root)
    // 主选区（mainIndex=1）在第二行；副选区在首行
    view.dispatch({ selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(6)], 1) })
    expect(view.state.selection.ranges.length).toBe(2)
    expect(view.state.selection.main.head).toBe(6)
    pressKey(root, 'Enter', { ctrlKey: true })
    expect(view.state.doc.toString()).toBe('aaa\nbbb\n\nccc')
    expect(view.state.selection.ranges.length).toBe(2)
    expect(view.state.selection.main.head).toBe(8)
    expect(view.state.selection.ranges[0]!.head).toBe(1)
    teardown(root, controller)
  })

  it('表格格区在场时不插入（格区维持单选区语义，与添加光标同口径）', () => {
    const { root, controller } = setup('| A | B |\n| --- | --- |\n| left | right |\n')
    const view = editor(root)
    view.dispatch({ selection: { anchor: 3 } })
    view.dispatch({ effects: setTableRegion.of({ tableFrom: 0, rowFrom: 0, rowTo: 0, columnFrom: 0, columnTo: 1 }) })
    expect(view.state.field(tableRegionField, false)).not.toBeNull()
    controller.handleHostMessage({ kind: 'ui.command', op: 'insertLineBelow' })
    expect(view.state.doc.toString()).toBe('| A | B |\n| --- | --- |\n| left | right |\n')
    teardown(root, controller)
  })

  it('光标落在表格行上时不插入（无需先拖选格区——真宿主验收发现的缺陷）', () => {
    // 回归：守卫一度只看 tableRegionField，而该字段只有拖选表格区域后才非空；
    // 光标停在表格某一行（未拖选）时守卫失效，插入把表格切成两半。正确判据
    // 是解析树行身份（tableRowsAt），表头/分隔行/数据行都算表内
    for (const anchor of [3, 12, 24]) {
      const { root, controller, sent } = setup('| A | B |\n| --- | --- |\n| left | right |\n')
      const view = editor(root)
      view.dispatch({ selection: { anchor } })
      expect(view.state.field(tableRegionField, false)).toBeNull()
      controller.handleHostMessage({ kind: 'ui.command', op: 'insertLineBelow' })
      expect(view.state.doc.toString(), `anchor=${anchor} below`)
        .toBe('| A | B |\n| --- | --- |\n| left | right |\n')
      controller.handleHostMessage({ kind: 'ui.command', op: 'insertLineAbove' })
      expect(view.state.doc.toString(), `anchor=${anchor} above`)
        .toBe('| A | B |\n| --- | --- |\n| left | right |\n')
      expect(editsOf(sent)).toEqual([])
      teardown(root, controller)
    }
  })

  it('只读视图不插入（insertLineAt 返回 false、零变更）', () => {
    const root = document.createElement('div')
    document.body.append(root)
    const view = new EditorView({ parent: root, state: EditorState.create({
      doc: 'abc', extensions: EditorState.readOnly.of(true) }) })
    expect(insertLineAt(view, 'below')).toBe(false)
    expect(view.state.doc.toString()).toBe('abc')
    view.destroy()
    root.remove()
  })

  it('光标在已折叠标题行时下方插入空行：落点展开折叠，新光标不落隐藏区', () => {
    const DOC = '# T1\n\nalpha\n\n## T2\n\nbeta\n'
    const { root, controller } = setup(DOC)
    const view = editor(root)
    // 折叠 T1 辖域（光标在 T1 标题行）
    controller.handleHostMessage({ kind: 'ui.command', op: 'headingFold' })
    expect([...view.state.field(headingFoldField)!]).toEqual([0])
    pressKey(root, 'Enter', { ctrlKey: true })
    expect(view.state.doc.toString()).toBe('# T1\n\n\nalpha\n\n## T2\n\nbeta\n')
    const cursor = view.state.selection.main.head
    expect(cursor).toBe(5)
    const tree = view.state.field(liveDecorationsField, false)?.tree
    const folds = effectiveHeadingFolds(view.state.field(headingFoldField)!,
      collectHeadings(view.state.doc, tree), view.state.doc)
    expect(clampFoldHiddenCursor(folds, cursor)).toBeNull()
    teardown(root, controller)
  })

  it('scrollByLine：内容不足一屏时零操作（真实位移见浏览器套件）', () => {
    const { root, controller } = setup('abc\ndef')
    expect(scrollByLine(editor(root), 1)).toBe(false)
    teardown(root, controller)
  })

  // VSCode 编辑器操作族：上移/下移当前行（Alt+↑/↓）——此前是 CM6 内建裸
  // 绑定、设置页不可见；本批登记为可配置操作并接管内建键位
  it('Alt+↓ / Alt+↑ 移动当前行：真实按键路径、单笔写回、首末行边界零操作', async () => {
    const { root, controller, sent } = setup('alpha\nbeta\ngamma')
    const view = editor(root)
    view.dispatch({ selection: { anchor: 1 } })
    const before = editsOf(sent).length
    pressKey(root, 'ArrowDown', { altKey: true })
    expect(view.state.doc.toString()).toBe('beta\nalpha\ngamma')
    await settle()
    expect(editsOf(sent).length).toBe(before + 1)
    pressKey(root, 'ArrowUp', { altKey: true })
    expect(view.state.doc.toString()).toBe('alpha\nbeta\ngamma')
    await settle()
    // 边界：首行上移/末行下移零操作、零写回
    const settled = editsOf(sent).length
    view.dispatch({ selection: { anchor: 0 } })
    pressKey(root, 'ArrowUp', { altKey: true })
    expect(view.state.doc.toString()).toBe('alpha\nbeta\ngamma')
    view.dispatch({ selection: { anchor: view.state.doc.length } })
    pressKey(root, 'ArrowDown', { altKey: true })
    expect(view.state.doc.toString()).toBe('alpha\nbeta\ngamma')
    await settle()
    expect(editsOf(sent).length).toBe(settled)
    teardown(root, controller)
  })

  it('Alt+方向键在表格行上仍可移动（收编不改既有行为，不加表格守卫）', () => {
    // 收编前 Alt+↑/↓ 在表格行上一直可用（内建 moveLine 直接移动整行）；
    // 登记为可配置操作不该让它变哑——加了表格守卫反而是退化
    const DOC = '| A | B |\n| --- | --- |\n| left | right |\n\n尾行'
    const { root, controller } = setup(DOC)
    const view = editor(root)
    view.dispatch({ selection: { anchor: 3 } })
    pressKey(root, 'ArrowDown', { altKey: true })
    expect(view.state.doc.toString()).toBe('| --- | --- |\n| A | B |\n| left | right |\n\n尾行')
    teardown(root, controller)
  })

  it('显式清空后 Alt+方向键不移动（CM6 内建 moveLine 不复活）', () => {
    const { root, controller } = setup('alpha\nbeta')
    const view = editor(root)
    overridesMessage(controller, { moveLineUp: [], moveLineDown: [] })
    view.dispatch({ selection: { anchor: 0 } })
    pressKey(root, 'ArrowDown', { altKey: true })
    expect(view.state.doc.toString()).toBe('alpha\nbeta')
    teardown(root, controller)
  })
})
