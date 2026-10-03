// @vitest-environment jsdom
// 跳转目标高亮面板交互契约（#163 验收反馈）：view.locate（双链/普通链
// 接锚点跳转通道）后目标标题/段落整体覆盖半透黄（vsidian-anchor-flash），
// 用户任意操作（点击、滚动、按键、切走页面）后消失；定位自身的程序滚动
// 不误清（时间窗内的 scroll 忽略）。大纲点击不闪（有自己的常驻高亮）。
import { describe, it, expect, afterEach, vi } from 'vitest'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { WebviewToHost } from '../../src/shared/protocol'

if (typeof Range !== 'undefined' && Range.prototype.getClientRects === undefined) {
  ;(Range.prototype as unknown as { getClientRects(): DOMRectList }).getClientRects =
    () => [] as unknown as DOMRectList
  ;(Range.prototype as unknown as { getBoundingClientRect(): DOMRect }).getBoundingClientRect =
    () => new DOMRect(0, 0, 0, 0)
}
// jsdom 无命中测试：pointerdown 冒泡到表格选区监听时 elementFromPoint 回 null
if (typeof document !== 'undefined' && !document.elementFromPoint) {
  ;(document as unknown as { elementFromPoint: () => null }).elementFromPoint = () => null
}

const DOC_URI = 'file:///d%3A/notes/flash.md'
const mountedParents: HTMLElement[] = []
afterEach(() => {
  for (const parent of mountedParents.splice(0)) {
    parent.remove()
  }
  vi.useRealTimers()
})

const DOC = '前置段落\n\n# 目标标题\n\n目标段落甲\n目标段落乙\n\n后文\n'

interface BridgeHarness {
  bridge: VsCodeBridge
  sent: WebviewToHost[]
}

function makeBridge(): BridgeHarness {
  const sent: WebviewToHost[] = []
  const bridge: VsCodeBridge = {
    postMessage: (m) => sent.push(m as WebviewToHost),
    getState: () => undefined,
    setState: () => undefined,
  }
  return { bridge, sent }
}

function mountPanel(h: BridgeHarness, text = DOC, mode: 'live' | 'reading' = 'live') {
  const c = new WebviewSyncController(h.bridge)
  const parent = document.createElement('div')
  document.body.appendChild(parent)
  mountedParents.push(parent)
  c.mount(parent)
  c.handleHostMessage({ kind: 'init', sessionId: 's1', docUri: DOC_URI, version: 1, text })
  if (mode === 'reading') {
    c.handleHostMessage({ kind: 'view.mode.set', mode: 'reading' })
  }
  return { c, parent }
}

const flashLines = () =>
  document.querySelectorAll('.cm-line.vsidian-anchor-flash')
const flashReadingBlocks = () =>
  document.querySelectorAll('.vsidian-view-reading .vsidian-anchor-flash')

describe('view.locate 跳转目标高亮（live）', () => {
  it('定位到段落：整块各行加类；ack 照常回发', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    c.handleHostMessage({ kind: 'view.locate', offset: DOC.indexOf('目标段落甲') })
    const lines = flashLines()
    expect(lines.length, '多行段落应整块高亮').toBe(2)
    expect(lines[0]!.textContent).toContain('目标段落甲')
    expect(lines[1]!.textContent).toContain('目标段落乙')
    expect(h.sent).toContainEqual({ kind: 'view.locate.ack', offset: DOC.indexOf('目标段落甲') })
  })

  it('定位到标题：标题行整行加类', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    c.handleHostMessage({ kind: 'view.locate', offset: DOC.indexOf('# 目标标题') })
    const lines = flashLines()
    expect(lines.length).toBe(1)
    expect(lines[0]!.textContent).toContain('目标标题')
  })

  it('用户点击正文后消失（一次性监听，不残留）', () => {
    const h = makeBridge()
    const { c, parent } = mountPanel(h)
    c.handleHostMessage({ kind: 'view.locate', offset: DOC.indexOf('目标段落甲') })
    expect(flashLines().length).toBe(2)
    parent.querySelector('.cm-content')!.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true }))
    expect(flashLines().length, '点击后应消失').toBe(0)
    // 再定位一次后再点击仍正常（监听可重挂）
    c.handleHostMessage({ kind: 'view.locate', offset: DOC.indexOf('# 目标标题') })
    expect(flashLines().length).toBe(1)
    parent.querySelector('.cm-content')!.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true }))
    expect(flashLines().length).toBe(0)
  })

  it('程序滚动不误清（定位时间窗内的 scroll 忽略）；窗口外用户滚动消失', () => {
    vi.useFakeTimers()
    const h = makeBridge()
    const { c, parent } = mountPanel(h)
    c.handleHostMessage({ kind: 'view.locate', offset: DOC.indexOf('目标段落甲') })
    const scroller = parent.querySelector('.cm-scroller')!
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
    expect(flashLines().length, '定位自身的滚动不得清除高亮').toBe(2)
    vi.advanceTimersByTime(500)
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
    expect(flashLines().length, '时间窗后的用户滚动应清除').toBe(0)
  })

  it('切走页面（blur）后消失；再次定位可重新出现', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    c.handleHostMessage({ kind: 'view.locate', offset: DOC.indexOf('目标段落甲') })
    window.dispatchEvent(new Event('blur'))
    expect(flashLines().length).toBe(0)
  })
})

describe('view.locate 跳转目标高亮（reading）', () => {
  it('定位到段落：目标阅读块加类；点击阅读区后消失', () => {
    const h = makeBridge()
    const { c, parent } = mountPanel(h, DOC, 'reading')
    c.handleHostMessage({ kind: 'view.locate', offset: DOC.indexOf('目标段落甲') })
    const blocks = flashReadingBlocks()
    expect(blocks.length, '目标段落块应有高亮类').toBe(1)
    expect(blocks[0]!.textContent).toContain('目标段落甲')
    parent.querySelector('.vsidian-view-reading')!.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true }))
    expect(flashReadingBlocks().length).toBe(0)
  })
})

describe('view.locate 区间选区落位（#318 head）', () => {
  function viewState(c: WebviewSyncController, h: BridgeHarness) {
    const before = h.sent.length
    c.handleHostMessage({ kind: 'view.state.request' })
    const msg = h.sent.slice(before).find((m) => m.kind === 'view.state')
    if (!msg) {
      throw new Error('view.state 未回报')
    }
    return msg as Extract<WebviewToHost, { kind: 'view.state' }>
  }

  it('带 head：selectionOffset/selectionHead 落区间两端；缺省 head 单点不变', () => {
    const h = makeBridge()
    const { c } = mountPanel(h)
    const from = DOC.indexOf('目标段落甲')
    const to = DOC.indexOf('目标段落乙')
    c.handleHostMessage({ kind: 'view.locate', offset: from, head: to })
    const state = viewState(c, h)
    expect(state.selectionOffset, '区间左端应落 offset').toBe(from)
    expect(state.selectionHead, '区间右端应落 head').toBe(to)
    // 缺省 head 单点落位：光标落 offset（outlineJump.test.ts 已有覆盖），
    // 此处补齐 head 退化一致性
    c.handleHostMessage({ kind: 'view.locate', offset: to })
    const single = viewState(c, h)
    expect(single.selectionOffset).toBe(to)
    expect(single.selectionHead, '无 head 时选区退化为单点').toBe(single.selectionOffset)
  })
})
