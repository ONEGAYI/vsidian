// 多光标基础设施（工单 #237，jsdom 控制器）：drawSelection 装配、
// allowMultipleSelections 独立设置项（与符号包裹解耦）、上下添加光标命令
// （注册表键位 + ui.command + region/设置/清空绑定边界）、Esc 收敛与
// defaultKeymap 内建 Ctrl+Alt+方向键的注册表接管。
// 与浏览器套件（multicursor）互补：本层驱动 CM6 事务与消息；浏览器层用
// 真实键盘/鼠标验证 alt+click 三场景落点、绘制光标可见性与 goal column。
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EditorSelection } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
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
  // 生产 main.ts 同款：defaultKeymap 提供默认行为兜底（含 Esc→simplifySelection
  // 与内建 Mod-Alt-ArrowUp/Down——后者由本票的注册表接管键位退役）
  const host = document.createElement('div')
  document.body.append(host)
  controller.mount(host, [keymap.of(defaultKeymap)])
  controller.handleHostMessage({ kind: 'init', sessionId: 'multicursor',
    docUri: 'file:///multicursor.md', version: 1, text })
  const view = controller.getView()!
  const findPanelOpen = () =>
    !!host.querySelector('.vsidian-find')?.classList.contains('vsidian-find-open')
  return { controller, sent, view, host, findPanelOpen }
}

const ranges = (view: EditorView) =>
  view.state.selection.ranges.map((range) => ({ from: range.from, to: range.to }))
const heads = (view: EditorView) => view.state.selection.ranges.map((range) => range.head)

/** 编辑器正文内键盘事件（liveFocused 判定要求目标在 contentDOM 内） */
function pressKey(view: EditorView, key: string, init: KeyboardEventInit = {}): void {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
  )
}

describe('drawSelection 与多选区装配（#237）', () => {
  it('默认开启：多 range 选区存续、光标/选区绘制层在场', () => {
    const { view } = setup('aaa\nbbb\nccc')
    view.dispatch({ selection: EditorSelection.create(
      [EditorSelection.cursor(0), EditorSelection.cursor(8)], 0) })
    expect(ranges(view)).toEqual([{ from: 0, to: 0 }, { from: 8, to: 8 }])
    // drawSelection 装配产物：光标层与选区层 DOM（jsdom 无布局，元素本身在场；
    // 绘制可见性断言交由浏览器套件）
    expect(view.dom.querySelector('.cm-cursorLayer')).toBeTruthy()
    expect(view.dom.querySelector('.cm-selectionLayer')).toBeTruthy()
  })

  it('设置关闭：多 range 折回单 range、绘制层退出装配；再开启热重配恢复', () => {
    const { controller, view } = setup('aaa\nbbb\nccc')
    controller.handleHostMessage({ kind: 'settings.changed', values: { 'editor.multicursor': false } })
    view.dispatch({ selection: EditorSelection.create(
      [EditorSelection.cursor(0), EditorSelection.cursor(8)], 0) })
    expect(ranges(view)).toEqual([{ from: 0, to: 0 }])
    expect(view.dom.querySelector('.cm-cursorLayer')).toBeNull()
    expect(view.dom.querySelector('.cm-selectionLayer')).toBeNull()
    controller.handleHostMessage({ kind: 'settings.changed', values: { 'editor.multicursor': true } })
    view.dispatch({ selection: EditorSelection.create(
      [EditorSelection.cursor(0), EditorSelection.cursor(8)], 1) })
    expect(ranges(view)).toEqual([{ from: 0, to: 0 }, { from: 8, to: 8 }])
    expect(view.dom.querySelector('.cm-cursorLayer')).toBeTruthy()
  })
})

describe('allowMultipleSelections 与符号包裹解耦（#237）', () => {
  it('符号包裹关闭不再影响多选区可用性（facet 移交多光标装配点）', () => {
    const { controller, view } = setup('hello text')
    controller.handleHostMessage({ kind: 'settings.changed',
      values: { 'editor.symbolSelectionWrap': false } })
    view.dispatch({ selection: EditorSelection.create(
      [EditorSelection.cursor(0), EditorSelection.cursor(6)], 0) })
    expect(ranges(view), '包裹关闭后多 range 仍存续').toHaveLength(2)
  })

  it('多光标关闭时跨段包裹仍改写文本，选区折回主 range（降级边界）', () => {
    const { controller, sent, view } = setup('aa\n\nbb')
    controller.handleHostMessage({ kind: 'settings.changed', values: { 'editor.multicursor': false } })
    view.dispatch({ selection: EditorSelection.range(0, 6), userEvent: 'select.pointer' })
    view.dispatch({
      changes: { from: 0, to: 6, insert: '*' },
      selection: { anchor: 1 },
      userEvent: 'input.type',
    })
    // 包裹计划仍两侧插入（文本生效），选区被 asSingle 折回单 range
    expect(view.state.doc.toString()).toBe('*aa*\n\n*bb*')
    expect(ranges(view)).toHaveLength(1)
    expect(sent.filter((m) => m.kind === 'edit.request')).toHaveLength(1)
  })
})

describe('上下添加光标（#237）', () => {
  it('命令面板入口（ui.command）经同一实现添加光标', () => {
    const { controller, view } = setup('one\ntwo\nthree')
    view.dispatch({ selection: EditorSelection.cursor(5) }) // 第二行行尾
    controller.handleHostMessage({ kind: 'ui.command', op: 'addCursorAbove' })
    expect(view.state.selection.ranges.length).toBe(2)
    controller.dispose()
  })

  it('文档首行上方不添加（CM6 边界返回 false 不派发）', () => {
    const { view } = setup('one\ntwo')
    view.dispatch({ selection: EditorSelection.cursor(0) })
    pressKey(view, 'ArrowUp', { ctrlKey: true, altKey: true })
    expect(ranges(view)).toEqual([{ from: 0, to: 0 }])
  })

  it('表格格区（region）存在时不接管：维持格区单选区语义', () => {
    const { view } = setup('| a | b |\n| --- | --- |\n| 1 | 2 |\npara')
    selectTableRegion(view, { tableFrom: 0, rowFrom: 1, rowTo: 1, columnFrom: 0, columnTo: 0 })
    const before = heads(view)
    pressKey(view, 'ArrowUp', { ctrlKey: true, altKey: true })
    expect(heads(view), 'region 存在时多光标命令不派发').toEqual(before)
    expect(view.state.selection.ranges).toHaveLength(1)
  })

  it('多光标设置关闭时命令不接管（键位仍由注册表持有，行为回到单光标）', () => {
    const { controller, view } = setup('one\ntwo\nthree')
    controller.handleHostMessage({ kind: 'settings.changed', values: { 'editor.multicursor': false } })
    view.dispatch({ selection: EditorSelection.cursor(5) })
    pressKey(view, 'ArrowUp', { ctrlKey: true, altKey: true })
    expect(ranges(view)).toHaveLength(1)
  })

  it('清空默认绑定后 Ctrl+Alt+Up 不再触发（defaultKeymap 内建键位退役，所有权归注册表）', () => {
    const { controller, view } = setup('one\ntwo\nthree')
    controller.handleHostMessage({ kind: 'keybindings.snapshot', overrides: { addCursorAbove: [] } })
    view.dispatch({ selection: EditorSelection.cursor(5) })
    pressKey(view, 'ArrowUp', { ctrlKey: true, altKey: true })
    expect(ranges(view), '清空后内建绑定不得复活').toEqual([{ from: 5, to: 5 }])
  })
})

describe('Esc 收敛（#237：simplifySelection 排浮层之后，不插队）', () => {
  it('多 range 一次 Esc 收敛回主选区；非空选区再 Esc 折为光标', () => {
    const { view } = setup('aaa\nbbb\nccc')
    view.dispatch({ selection: EditorSelection.create(
      [EditorSelection.range(0, 3), EditorSelection.range(4, 7)], 0) })
    pressKey(view, 'Escape')
    expect(ranges(view)).toEqual([{ from: 0, to: 3 }])
    pressKey(view, 'Escape')
    // simplifySelection：非空选区折为 head 处光标（range(0,3) 的 head=3）
    expect(ranges(view)).toEqual([{ from: 3, to: 3 }])
  })

  it('查找面板打开时 Esc 先关面板、不收敛选区（浮层优先消费）', () => {
    const { controller, view, host, findPanelOpen } = setup('aaa\nbbb')
    // 两个空 range 光标（非空选区会被 #236 的 openFind 取为查找种子并经
    // findLocate 把选区定位到匹配处——那是查找票的主语义，非本用例对象）
    view.dispatch({ selection: EditorSelection.create(
      [EditorSelection.cursor(0), EditorSelection.cursor(4)], 0) })
    controller.handleHostMessage({ kind: 'view.find.open' })
    expect(findPanelOpen()).toBe(true)
    expect(ranges(view), '面板打开不收敛多光标选区').toHaveLength(2)
    // 面板打开后焦点在查找输入框：Esc 从输入框冒泡（真实焦点路径）
    const input = host.querySelector<HTMLInputElement>('.vsidian-find-input')!
    input.focus()
    input.dispatchEvent(new KeyboardEvent('keydown',
      { key: 'Escape', bubbles: true, cancelable: true }))
    expect(findPanelOpen(), 'Esc 先关查找面板').toBe(false)
    expect(ranges(view), '面板关闭的 Esc 不顺带收敛选区').toHaveLength(2)
  })
})
