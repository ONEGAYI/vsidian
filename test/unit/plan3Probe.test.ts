// @vitest-environment jsdom
// #597 方案 3 验证探针（键入路径「原始事务 → 链驱动 → 内置兜底」重排的
// 出站与撤销粒度 + 多选区兜底重建原型）：
//
// 1. 现状基线（方案 1）：真实键入 `(` 经 transactionFilter 原子改写为
//    `()` 单笔事务 → 单笔 edit.request（一条宿主撤销记录），一次 Ctrl+Z
//    整体恢复。
// 2. 方案 3 朴素形态的撤销粒度回归实证：原始 `(` 与微任务兜底 `)` 是两笔
//    事务——孤立按键（无未确认触碰）下原始笔**立即出站**，兜底笔只能进
//    暂缓段另出一笔 → 两条撤销记录，一次 Ctrl+Z 撤掉 `)` 留下悬空 `(`。
//    结论：方案 3 须让符号原始事务强制暂缓（或等价机制），兜底并入同段。
// 3. IME 同构对照：组合期事务一律暂缓、compositionend 后微任务兜底并入
//    同段 → 单笔单条撤销。这是方案 3 键入路径应复用的既有合并机制。
// 4. 多选区兜底重建原型（纯函数）：原始多 range 同字符替换后按段重建
//    包裹，终态与选区覆盖文本与现行 filter 改写逐字一致——attempt 的
//    坐标数学可直接从 planSelectionWrap + 段循环导出。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import { planSelectionWrap } from '../../src/shared/symbolWrap'
import { findSelectionWrapEntry } from '../../src/shared/symbols'
import type { SerChange, WebviewToHost } from '../../src/shared/protocol'

// jsdom 无布局：为 CM6 的视口测量提供零值 polyfill（undoSegmentation 同款）
if (typeof Range !== 'undefined' && Range.prototype.getClientRects === undefined) {
  ;(Range.prototype as unknown as { getClientRects(): DOMRectList }).getClientRects =
    () => [] as unknown as DOMRectList
  ;(Range.prototype as unknown as { getBoundingClientRect(): DOMRect }).getBoundingClientRect =
    () => new DOMRect(0, 0, 0, 0)
}

const DOC_URI = 'file:///d%3A/notes/u.md'

function makeBridge() {
  const sent: WebviewToHost[] = []
  let state: Record<string, unknown> | undefined
  const bridge: VsCodeBridge = {
    postMessage: (m) => sent.push(m as WebviewToHost),
    getState: <T,>() => state as T | undefined,
    setState: (s) => {
      state = s as Record<string, unknown>
    },
  }
  return { bridge, sent }
}

function mount(bridge: VsCodeBridge): WebviewSyncController {
  const controller = new WebviewSyncController(bridge)
  controller.mount(document.createElement('div'))
  return controller
}

function init(c: WebviewSyncController, text: string, version = 1, sessionId = 's1') {
  c.handleHostMessage({ kind: 'init', sessionId, docUri: DOC_URI, version, text })
}

function startComposition(c: WebviewSyncController) {
  c.getView()!.contentDOM.dispatchEvent(new CompositionEvent('compositionstart'))
}

function endComposition(c: WebviewSyncController) {
  c.getView()!.contentDOM.dispatchEvent(new CompositionEvent('compositionend'))
}

type EditReq = Extract<WebviewToHost, { kind: 'edit.request' }>
const editRequests = (sent: WebviewToHost[]) =>
  sent.filter((m): m is EditReq => m.kind === 'edit.request')

function applySer(text: string, changes: SerChange[]): string {
  let out = text
  for (const c of [...changes].sort((a, b) => b.offset - a.offset)) {
    out = out.slice(0, c.offset) + c.text + out.slice(c.offset + c.length)
  }
  return out
}

/** 一次 Ctrl+Z 后的权威文本（栈顶 = 最后一条 edit.request） */
function undoOnceOver(reqs: EditReq[], base: string): string {
  const states = [base]
  for (const r of reqs) {
    states.push(applySer(states[states.length - 1], r.changes))
  }
  return states[states.length - 2]
}

function useSegmentClock() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('#597 方案3 探针：出站与撤销粒度', () => {
  it('现状基线：键入 ( 经 filter 原子改写 → 单笔 edit.request（()），一次撤销整体恢复', async () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, '中', 1)
    const view = c.getView()!
    useSegmentClock()
    view.dispatch({ selection: { anchor: 1, head: 1 } })
    // #597 实施后此用例走真实键入路径：filter 放行原始 ( + 微任务兜底 )
    // 强制暂缓合并。真实键入事务总带显式选区（CM6 domObserver 从 DOM
    // 读回光标——插入后落在插入文本之后），模拟形态与其对齐。断言形态
    // 不变：终态 ()、单笔 edit.request 含 ()、一次撤销整体恢复——方案 3
    // 的出站/撤销粒度契约与现状基线一致
    view.dispatch({ changes: { from: 1, insert: '(' }, selection: { anchor: 2 }, userEvent: 'input.type' })
    await vi.advanceTimersByTimeAsync(20)
    expect(view.state.doc.toString()).toBe('中()')
    const reqs = editRequests(sent)
    expect(reqs).toHaveLength(1)
    expect(reqs[0].changes).toEqual([{ offset: 1, length: 0, text: '()' }])
    expect(undoOnceOver(reqs, '中')).toBe('中')
  })

  it('方案3朴素形态：原始 ( + 微任务兜底 ) 两笔 → 两条撤销记录，一次撤销残留悬空半对', async () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, '中', 1)
    const view = c.getView()!
    useSegmentClock()
    view.dispatch({ selection: { anchor: 1, head: 1 } })
    // 原始事务（不带 userEvent 以绕开现行 filter 改写——出站/撤销语义不依赖
    // userEvent，probe 只模拟「两笔事务 + 微任务间隔」的时序形态）
    view.dispatch({ changes: { from: 1, insert: '(' } })
    await Promise.resolve() // 微任务间隔 = 链驱动与兜底 attempt 的执行时点
    view.dispatch({ changes: { from: 2, insert: ')' } }) // 内置兜底闭合
    await vi.advanceTimersByTimeAsync(20) // flush 定时器：原始笔在途，兜底留守暂缓段
    let reqs = editRequests(sent)
    expect(reqs).toHaveLength(1)
    expect(reqs[0].changes).toEqual([{ offset: 1, length: 0, text: '(' }])
    c.handleHostMessage({ kind: 'edit.ack', seq: 1, ok: true, version: 2 })
    reqs = editRequests(sent)
    expect(reqs).toHaveLength(2)
    expect(reqs[1].changes).toEqual([{ offset: 2, length: 0, text: ')' }])
    expect(view.state.doc.toString()).toBe('中()')
    // 撤销粒度回归实证：一次 Ctrl+Z 只撤兜底 )，留下悬空 (
    expect(undoOnceOver(reqs, '中')).toBe('中(')
  })

  it('补救机制证据：原始符号事务进暂缓集（触碰未确认）时，兜底闭合并入同段 → 单条撤销记录', async () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, '中', 1)
    const view = c.getView()!
    useSegmentClock()
    view.dispatch({ selection: { anchor: 1, head: 1 } })
    // 前置输入 q（与后续 ( 相邻）：立即出站且未确认——触碰它的原始 (
    // 事务进暂缓集（方案 3 的「强制暂缓」要复刻的正是这条路径）
    view.dispatch({ changes: { from: 1, insert: 'q' } })
    view.dispatch({ changes: { from: 2, insert: '(' } }) // 原始事务：触碰未确认 → 暂缓段
    await Promise.resolve()
    view.dispatch({ changes: { from: 3, insert: ')' } }) // 兜底闭合：触碰 → 并入同段
    await vi.advanceTimersByTimeAsync(20)
    let reqs = editRequests(sent)
    expect(reqs).toHaveLength(1) // q 在途，暂缓集留守（sendDeferredLocal 守卫 inFlight）
    expect(reqs[0].changes).toEqual([{ offset: 1, length: 0, text: 'q' }])
    c.handleHostMessage({ kind: 'edit.ack', seq: 1, ok: true, version: 2 })
    reqs = editRequests(sent)
    // ( 与 ) 合并为单笔（一条撤销记录）；q 与符号对分属两段（独立撤销单位）
    expect(reqs).toHaveLength(2)
    expect(reqs[1].changes).toEqual([{ offset: 2, length: 0, text: '()' }])
    expect(view.state.doc.toString()).toBe('中q()')
    expect(undoOnceOver(reqs, '中')).toBe('中q')
  })

  it('IME 同构对照：组合期一律暂缓 + 定稿后微任务兜底并入同段 → 单笔单条撤销', async () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, '中', 1)
    const view = c.getView()!
    useSegmentClock()
    startComposition(c)
    view.dispatch({ changes: { from: 1, insert: '【' }, userEvent: 'input.type.compose' })
    endComposition(c)
    await Promise.resolve() // compositionend 后微任务 attempt 时点
    view.dispatch({ changes: { from: 2, insert: '】' } }) // 兜底闭合（触碰暂缓 → 并入同段）
    await vi.advanceTimersByTimeAsync(20)
    const reqs = editRequests(sent)
    expect(reqs).toHaveLength(1)
    expect(reqs[0].changes).toEqual([{ offset: 1, length: 0, text: '【】' }])
    expect(view.state.doc.toString()).toBe('中【】')
    expect(undoOnceOver(reqs, '中')).toBe('中')
  })
})

describe('#597 方案3 探针：多选区包裹兜底重建（纯函数原型）', () => {
  it('原始多 range 同字符替换后按段重建：终态与选区覆盖文本 = 现行 filter 改写', () => {
    const entry = findSelectionWrapEntry('【')!
    expect(entry).toBeDefined()
    const text = 'x ord y zwei z'
    const ranges = [
      { from: 2, to: 5 },
      { from: 8, to: 12 },
    ]

    // ---- 现行 filter 改写（对照基准）：原文档上直接规划 ----
    const filterPlan = planSelectionWrap(text, ranges, entry)!
    expect(filterPlan).not.toBeNull()
    const filterTerminal = applySer(
      text,
      filterPlan.changes.map((c) => ({ offset: c.from, length: c.to - c.from, text: c.insert })),
    )
    const filterCovered = filterPlan.selection.map((s) => filterTerminal.slice(s.anchor, s.head))

    // ---- 方案 3 兜底重建原型：原始事务已把每 range 替换为键入字符 ----
    const rawInserted = '【'
    let postShift = 0
    const segments = ranges
      .map((r) => ({ from: r.from, to: r.to, text: text.slice(r.from, r.to) }))
      .sort((a, b) => a.from - b.from)
      .map((seg) => {
        // 该段键入字符在原始替换后文档中的位置（前方段落净长差 = 1 - 原文长）
        const pos = seg.from + postShift
        postShift += rawInserted.length - (seg.to - seg.from)
        return { ...seg, pos }
      })
    const postDoc = applySer(
      text,
      segments.map((s) => ({ offset: s.from, length: s.to - s.from, text: rawInserted })),
    )
    expect(postDoc).toBe('x 【 y 【 z')

    const changes: { offset: number; length: number; text: string }[] = []
    const sels: { anchor: number; head: number }[] = []
    let delta = 0
    for (const seg of segments) {
      const plan = planSelectionWrap(seg.text, [{ from: 0, to: seg.text.length }], entry)!
      expect(plan).not.toBeNull()
      // 段内重建合成（attemptCompositionWrap 同款循环）：open+原文+close
      let rebuilt = ''
      let at = 0
      for (const ch of plan.changes) {
        rebuilt += seg.text.slice(at, ch.from) + ch.insert
        at = ch.from
      }
      rebuilt += seg.text.slice(at)
      // 变更组是批量同时语义：全部用批前（原始替换后）坐标，offset 不加 delta；
      // delta 只平移批后选区（CM6 ChangeSpec/selection 的坐标系分界）
      changes.push({ offset: seg.pos, length: rawInserted.length, text: rebuilt })
      const sel = plan.selection[0]!
      sels.push({ anchor: seg.pos + delta + sel.anchor, head: seg.pos + delta + sel.head })
      delta += rebuilt.length - rawInserted.length
    }
    const attemptTerminal = applySer(postDoc, changes)

    // 终态与选区覆盖文本逐字一致：兜底重建与现行 filter 改写等价
    expect(attemptTerminal).toBe(filterTerminal)
    expect(sels.map((s) => attemptTerminal.slice(s.anchor, s.head))).toEqual(filterCovered)
    expect(filterCovered).toEqual(['ord', 'zwei'])
  })
})
