// @vitest-environment jsdom
// #662 R1-001：callout 执行族的目标坐标按传入 view 的文档长度钳制——
// 嵌入实例 B ≠ 主文档 A，读主文档长度的钳制会把长 B 的目标坐标截断到
// A.length（innermostCalloutAt 落错误位置：目标漏改、别处被包裹）。
// 门控语义：applyCalloutTypeAt 的 embed=null 路径按主 viewMode 门控，
// 主会话默认 live，嵌入 view 的可编辑性由调用方 actionTarget 保障——
// 本文件钉坐标归属，不复制门控矩阵。
import { describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { WebviewToHost } from '../../src/shared/protocol'

const DOC_URI = 'file:///d%3A/notes/a.md'

// jsdom 无布局：CM6 异步测量兜底（webviewSync.test.ts 同款）
if (Range.prototype.getClientRects === undefined) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
}

function makeBridge(): { bridge: VsCodeBridge; sent: WebviewToHost[] } {
  const sent: WebviewToHost[] = []
  const bridge: VsCodeBridge = {
    postMessage: (m) => { sent.push(m as WebviewToHost) },
    getState: () => undefined,
    setState: () => {},
  }
  return { bridge, sent }
}

describe('callout 执行族目标坐标归属（#662 R1-001）', () => {
  it('长嵌入文档 B 的目标改类型：钳制按 B 长度，不落 A.length 截断', () => {
    const { bridge } = makeBridge()
    const c = new WebviewSyncController(bridge)
    c.mount(document.createElement('div'))
    try {
      const A_TEXT = '![[B]]\n'
      c.handleHostMessage({ kind: 'init', sessionId: 's1', docUri: DOC_URI, version: 1, text: A_TEXT })
      // B：首段 + 填充 + 目标 callout（声明偏移远超 A.length）
      const filler = 'x'.repeat(40)
      const B_TEXT = `B 首段。\n${filler}\n\n> [!tip] 目标\n> 正文\n`
      const viewB = new EditorView({ state: EditorState.create({ doc: B_TEXT }) })
      try {
        const tipPos = B_TEXT.indexOf('[!tip]')
        expect(tipPos).toBeGreaterThan(A_TEXT.length) // 前置：目标确在 A 长度之外
        ;(c as unknown as {
          applyCalloutTypeAt: (view: EditorView, embed: unknown, pos: number, target: string) => void
        }).applyCalloutTypeAt(viewB, null, tipPos, 'warning')
        const after = viewB.state.doc.toString()
        expect(after).toContain('[!warning]')
        expect(after).not.toContain('[!tip]')
        expect(after.startsWith('B 首段。')).toBe(true) // 首段不被误包装
      } finally {
        viewB.destroy()
      }
    } finally {
      c.dispose()
    }
  })
})
