// 格区剪切（Ctrl+X）契约：剪切 = 区域序列化入剪贴板 + 结构化删除，一次完成。
// 序列化与 Ctrl+C 同源（serializeTableRegion，规格契约 4）；删除与
// Delete/Backspace 同语义（planTableRegionDelete，契约 5）——修复前 cut 落到
// CM6 内建空选区兜底：按行复制原文 + 删除被 protectGridCellContent 钳成清空
// 单格，选区矩形被无视。jsdom 直驱真实 CM6 + 完整 tableEditing 栈（与
// indentEditing.test.ts 同形态）；真实键盘/剪贴板回归在 test/browser。
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tableEditing } from '../../src/webview/tableEditing'
import { liveDecorationsField } from '../../src/webview/liveDecorations'
import { selectTableRegion, tableRegionField } from '../../src/webview/tableRegionSelection'
import type { TableRegion } from '../../src/webview/tableRegion'

const DOC = '正文前\n\n| 名字 | 数量 | 备注 |\n| --- | --- | --- |\n| 苹果 | 3 | 甲 |\n| 香蕉 | 5 | 乙 |\n\n正文后'
const TABLE_FROM = DOC.indexOf('| 名字')
const WHOLE_TABLE = '| 名字 | 数量 | 备注 |\n| --- | --- | --- |\n| 苹果 | 3 | 甲 |\n| 香蕉 | 5 | 乙 |'

function mount(): EditorView {
  const view = new EditorView({
    state: EditorState.create({ doc: DOC, extensions: [liveDecorationsField, tableEditing] }),
    parent: document.body,
  })
  view.focus()
  return view
}

function region(r0: number, r1: number, c0: number, c1: number): TableRegion {
  return { tableFrom: TABLE_FROM, rowFrom: r0, rowTo: r1, columnFrom: c0, columnTo: c1 }
}

function dispatchCut(view: EditorView) {
  const written: Array<[string, string]> = []
  const event = new Event('cut', { bubbles: true, cancelable: true }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', {
    value: {
      setData: (type: string, value: string) => { written.push([type, value]) },
      getData: () => '',
      clearData: () => {},
    },
  })
  view.contentDOM.dispatchEvent(event)
  return { written, prevented: event.defaultPrevented }
}

afterEach(() => {
  document.body.innerHTML = ''
  document.getSelection()?.removeAllRanges()
})

describe('格区剪切（cut 事件层）', () => {
  it('部分格区：剪贴板得独立表格（首行包装成表头），选中格逐格清空、结构保留', () => {
    const view = mount()
    selectTableRegion(view, region(1, 2, 1, 2))
    const { written, prevented } = dispatchCut(view)
    expect(written).toEqual([['text/plain', '| 3 | 甲 |\n| --- | --- |\n| 5 | 乙 |']])
    expect(prevented).toBe(true)
    const after = view.state.doc.toString()
    expect(after).toContain('| 名字 | 数量 | 备注 |')
    expect(after).toContain('| --- | --- | --- |')
    expect(after).toContain('| 苹果 |  |  |')
    expect(after).toContain('| 香蕉 |  |  |')
    expect(view.state.field(tableRegionField, false)).toBeNull()
    view.destroy()
  })

  it('整表格区：剪贴板得完整表格，表格整块删除、前后正文保留', () => {
    const view = mount()
    selectTableRegion(view, region(0, 2, 0, 2))
    const { written, prevented } = dispatchCut(view)
    expect(written).toEqual([['text/plain', WHOLE_TABLE]])
    expect(prevented).toBe(true)
    expect(view.state.doc.toString()).toBe('正文前\n\n\n\n正文后')
    expect(view.state.field(tableRegionField, false)).toBeNull()
    view.destroy()
  })

  it('仅表头满行：剪贴板得表头行，表头删除后下一行晋升', () => {
    const view = mount()
    selectTableRegion(view, region(0, 0, 0, 2))
    const { written } = dispatchCut(view)
    expect(written).toEqual([['text/plain', '| 名字 | 数量 | 备注 |\n| --- | --- | --- |']])
    const after = view.state.doc.toString()
    expect(after).toContain('| 苹果 | 3 | 甲 |\n| --- | --- | --- |\n| 香蕉 | 5 | 乙 |')
    expect(after).not.toContain('| 名字 |')
    view.destroy()
  })

  it('局部全空选区：无可删内容时退化为复制（写剪贴板不动文档）', () => {
    const doc = '| A | B | C |\n| --- | --- | --- |\n|  |  |  |\n|  | x |  |'
    const view = new EditorView({
      state: EditorState.create({ doc, extensions: [liveDecorationsField, tableEditing] }),
      parent: document.body,
    })
    view.focus()
    selectTableRegion(view, { tableFrom: 0, rowFrom: 1, rowTo: 1, columnFrom: 0, columnTo: 1 })
    const { written, prevented } = dispatchCut(view)
    expect(written).toEqual([['text/plain', '|  |  |\n| --- | --- |']])
    expect(prevented).toBe(true)
    expect(view.state.doc.toString()).toBe(doc)
    view.destroy()
  })

})
