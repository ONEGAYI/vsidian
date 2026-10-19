// @vitest-environment jsdom
// 评审 004（PR #599 / #597）：键入路径包裹/补全的净变更出站从「两端
// 插入」变为「整段替换」（原文 ord → 【ord】），另一 Live 实例经
// doc.changed 回流时，CM6 选区映射把被替换区间**内部**的原文字标
// 坍缩到区间边界（wo|rd 坍到 w|【ord】）。旧文本是新文本子串（符号
// 产出保序保留原文）时按子串锚定补偿——原文内字符位置逐字保留。
import { describe, it, expect } from 'vitest'
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

  it('区间外光标不受锚定影响（前缀平移照常）', () => {
    const { controller, view } = setup('word\n')
    view.dispatch({ selection: { anchor: 4 } }) // 区间右端点
    controller.handleHostMessage({
      kind: 'doc.changed', version: 2, origin: 'external',
      changes: [{ offset: 1, length: 3, text: '【ord】' }],
    })
    expect(view.state.selection.main.head).toBe(6) // w【ord】| 末尾
  })
})
