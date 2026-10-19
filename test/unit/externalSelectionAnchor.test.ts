// @vitest-environment jsdom
// 评审 004（PR #599 / #597）：键入路径包裹/补全的净变更出站从「两端
// 插入」变为「整段替换」（原文 ord → 【ord】），另一 Live 实例经
// doc.changed 回流时，CM6 选区映射把被替换区间**内部**的原文字标
// 坍缩到区间边界（wo|rd 坍到 w|【ord】）。旧文本是新文本子串（符号
// 产出保序保留原文）时按子串锚定补偿——原文内字符位置逐字保留。
import { describe, it, expect } from 'vitest'
import { EditorSelection } from '@codemirror/state'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { WebviewToHost } from '../../src/shared/protocol'

if (typeof Range !== 'undefined' && Range.prototype.getClientRects === undefined) {
  ;(Range.prototype as unknown as { getClientRects(): DOMRectList }).getClientRects =
    () => [] as unknown as DOMRectList
  ;(Range.prototype as unknown as { getBoundingClientRect(): DOMRect }).getBoundingClientRect =
    () => new DOMRect(0, 0, 0, 0)
}

function setup(text: string) {
  const sent: WebviewToHost[] = []
  const bridge: VsCodeBridge = {
    postMessage: (m) => sent.push(m as WebviewToHost),
    getState: () => undefined,
    setState: () => {},
  }
  const controller = new WebviewSyncController(bridge)
  controller.mount(document.createElement('div'))
  controller.handleHostMessage({ kind: 'init', sessionId: 'anchor', docUri: 'file:///d%3A/a.md', version: 1, text })
  const view = controller.getView()!
  return { controller, view }
}

describe('外部整段替换的区间内部光标保序锚定（评审 004）', () => {
  it('子串保序替换（包裹净变更形态）：区间内部光标按原文锚定平移', () => {
    const { controller, view } = setup('word\n')
    view.dispatch({ selection: { anchor: 2 } })
    controller.handleHostMessage({
      kind: 'doc.changed', version: 2, origin: 'external',
      changes: [{ offset: 1, length: 3, text: '【ord】' }],
    })
    expect(view.state.doc.toString()).toBe('w【ord】\n')
    // wo|rd 的 | 在原文 o 与 r 之间——锚定后落在【ord】中 o 与 r 之间（3）
    expect(view.state.selection.main.head).toBe(3)
  })

  it('非子串替换（无保序原文）：维持 CM6 边界映射，不做锚定', () => {
    const { controller, view } = setup('word\n')
    view.dispatch({ selection: { anchor: 2 } })
    controller.handleHostMessage({
      kind: 'doc.changed', version: 2, origin: 'external',
      changes: [{ offset: 1, length: 3, text: 'XYZ' }],
    })
    expect(view.state.doc.toString()).toBe('wXYZ\n')
    // 原文已被真替换（无子串身份）：内部光标按 CM6 映射落在边界（1 或 4）
    expect([1, 4]).toContain(view.state.selection.main.head)
  })

  it('多段替换：后段内部光标锚定计入前序段位移（评审 004 续）', () => {
    const { controller, view } = setup('ordzwei\n')
    view.dispatch({ selection: { anchor: 4 } }) // zwei 的 w 前（段 2 内部）
    controller.handleHostMessage({
      kind: 'doc.changed', version: 2, origin: 'external',
      changes: [
        { offset: 0, length: 3, text: '【ord】' },
        { offset: 3, length: 4, text: '【zwei】' },
      ],
    })
    expect(view.state.doc.toString()).toBe('【ord】【zwei】\n')
    // 段 2 批内锚定 5 + 段 1 净位移 +2 = 7（【z|wei】——旧 w 前逐字保留；
    // 漏前序位移时错到 5（【|zwei】）
    expect(view.state.selection.main.head).toBe(7)
  })

  it('非空正向选区：两端各自锚定，覆盖原文身份保留（评审 004 续）', () => {
    const { controller, view } = setup('word\n')
    view.dispatch({ selection: { anchor: 2, head: 3 } }) // r 正向（两端都在区间严格内部）
    controller.handleHostMessage({
      kind: 'doc.changed', version: 2, origin: 'external',
      changes: [{ offset: 1, length: 3, text: '【ord】' }],
    })
    expect(view.state.doc.toString()).toBe('w【ord】\n')
    const sel = view.state.selection.main
    // 旧 anchor=2（r 前）锚定到【ord】的 r 前=3；旧 head=3（d 前）锚定到
    // d 前=4 → 新选区覆盖 r（【o|r|d】），原文身份逐字保留（端点在替换
    // 段边界上时归 CM6 端点映射，不在锚定面）
    expect(sel.anchor).toBe(3)
    expect(sel.head).toBe(4)
    expect(view.state.doc.sliceString(sel.anchor, sel.head)).toBe('r')
  })

  it('区间外光标不受锚定影响（前缀平移照常）', () => {
    const { controller, view } = setup('word\n')
    view.dispatch({ selection: { anchor: 4 } }) // 区间右端点
    controller.handleHostMessage({
      kind: 'doc.changed', version: 2, origin: 'external',
      changes: [{ offset: 1, length: 3, text: '【ord】' }],
    })
    expect(view.state.selection.main.head).toBe(6) // w【ord】| 末尾
  })

  it('同一替换段内多光标：不归并、逐光标锚定、主选区身份保留（评审 004 v2）', () => {
    const { controller, view } = setup('word\n')
    // 双光标都在被替换段内部（r 前=2、d 前=3），主选区是第二个
    view.dispatch({ selection: EditorSelection.create(
      [EditorSelection.cursor(2), EditorSelection.cursor(3)], 1) })
    controller.handleHostMessage({
      kind: 'doc.changed', version: 2, origin: 'external',
      changes: [{ offset: 1, length: 3, text: '【ord】' }],
    })
    expect(view.state.doc.toString()).toBe('w【ord】\n')
    const sel = view.state.selection
    // selection.map 会把同区间多光标归并（且丢主选区身份）——锚定须基于
    // 原始 ranges 逐光标：r 前→3、d 前→4，主选区仍指向第二个
    expect(sel.ranges).toHaveLength(2)
    expect(sel.ranges[0]!.head).toBe(3)
    expect(sel.ranges[1]!.head).toBe(4)
    expect(sel.mainIndex).toBe(1)
    expect(sel.main.head).toBe(4)
  })

  it('降序 changes 数组：锚定位移按位置序累计（评审 004 v2）', () => {
    const { controller, view } = setup('ordzwei\n')
    view.dispatch({ selection: { anchor: 4 } }) // zwei 的 w 前
    controller.handleHostMessage({
      kind: 'doc.changed', version: 2, origin: 'external',
      // 降序到达（宿主/来源未保证升序）：后段在前
      changes: [
        { offset: 3, length: 4, text: '【zwei】' },
        { offset: 0, length: 3, text: '【ord】' },
      ],
    })
    expect(view.state.doc.toString()).toBe('【ord】【zwei】\n')
    expect(view.state.selection.main.head).toBe(7)
  })
})
