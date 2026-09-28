// @vitest-environment jsdom
// 撤销分段的时间停顿驱动契约（工单 #153，规格以票内冻结评论为准）：
// - 撤销分段不再由 ack 往返驱动：连续输入停顿 ≥500ms，或用户主动移光标
//   （点击/方向键），即开新撤销段；每段独立一笔 edit.request = 一条宿主
//   undo 记录，一次 Ctrl+Z 撤一个可预期单位
// - 停顿阈值内连续输入仍合并为单笔传输（传输效率不回退；纯输入导致的
//   光标后移不触发分段）
// - IME 组合原子：组合进行中（compositionstart..compositionend）不切段，
//   候选间隔超过阈值也保持一次组合一笔事务
// - 组合间按时间分段：切分点最早落在上一组合提交（compositionend 净输入
//   落地）之后；组合间隔 < 阈值仍并为一段
// - 触碰暂缓/组合攒批继续承担传输合并，但不再决定撤销分段：到达分段边界
//   而 ack 未齐时记录段切分点，ack 收敛后的出站按切分点拆为多笔依次出站，
//   两笔坐标依次映射（切分点落在字符边界）
// - #148 竞态守卫不回归：分段多笔在途时 history.request 恒晚于全部
//   edit.request
// - 净抵消段同样清空已确认链：在途请求确认后暂缓段自相抵消（输入即删），
//   本地与权威即刻收敛，Ctrl+Z 必须立即生效——净抵消路径遗留 ackedChain
//   会让守卫恒真且无收敛点释放（撤销无响应，迟到的释放撤掉新输入）
import { describe, it, expect, vi, afterEach } from 'vitest'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import type { SerChange, WebviewToHost } from '../../src/shared/protocol'

// jsdom 无布局：为 CM6 的视口测量（measureTextSize → Range.getClientRects）
// 提供零值 polyfill，真宿主 Chromium 有真实实现（组合事件路径会触发测量）
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

/** 模拟用户点击（主动移光标） */
function clickContent(c: WebviewSyncController) {
  c.getView()!.contentDOM.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
}

/** 模拟方向键移动光标（主动移光标） */
function pressArrow(c: WebviewSyncController, key: 'ArrowLeft' | 'ArrowRight' = 'ArrowLeft') {
  c.getView()!.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
}

/** 模拟 Ctrl+Z（keymap 转发路径；keyCode 见 historyForwarding 注释） */
function pressUndo(c: WebviewSyncController) {
  const view = c.getView()!
  view.focus()
  view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'z', ctrlKey: true, keyCode: 90, bubbles: true, cancelable: true,
  }))
}

type EditReq = Extract<WebviewToHost, { kind: 'edit.request' }>
const editRequests = (sent: WebviewToHost[]) =>
  sent.filter((m): m is EditReq => m.kind === 'edit.request')
const historyRequests = (sent: WebviewToHost[]) =>
  sent.filter((m) => m.kind === 'history.request')

/** 按序应用请求变更到文本（宿主权威文本的简化模型） */
function applySer(text: string, changes: SerChange[]): string {
  let out = text
  for (const c of [...changes].sort((a, b) => b.offset - a.offset)) {
    out = out.slice(0, c.offset) + c.text + out.slice(c.offset + c.length)
  }
  return out
}

/** 一次 Ctrl+Z 后的权威文本：撤销栈顶 = 最后一条 edit.request（一条 undo
 *  记录），撤掉它回到倒数第二个状态 */
function undoOnceOver(reqs: EditReq[], base: string): string {
  const states = [base]
  for (const r of reqs) {
    states.push(applySer(states[states.length - 1], r.changes))
  }
  return states[states.length - 2]
}

/** fake 时钟装订（内联字面量走上下文类型，理由见 historyForwarding 注释） */
function useSegmentClock() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('#153 时间停顿驱动的撤销分段', () => {
  it('停顿 ≥500ms 后的输入开新段：暂缓集按切分点拆两笔依次出站，坐标依次映射', async () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, 'abcdef', 1)
    const view = c.getView()!
    useSegmentClock()
    view.dispatch({ changes: { from: 0, insert: 'X' } }) // 正常出站（seq1 在途）
    view.dispatch({ changes: { from: 1, insert: 'Y' } }) // 触碰 X 未确认区间 → 暂缓段1
    await vi.advanceTimersByTimeAsync(600) // 停顿超阈值（无 ack、无 flush，暂缓集滞留）
    view.dispatch({ changes: { from: 2, insert: 'Z' } }) // 新段：触碰仍暂缓 → 段2
    expect(view.state.doc.toString()).toBe('XYZabcdef')
    expect(editRequests(sent)).toHaveLength(1) // 旧实现此刻仍是单笔在途
    // ack 收敛 → 段1（Y）先出站
    c.handleHostMessage({ kind: 'edit.ack', seq: 1, ok: true, version: 2 })
    const afterFirst = editRequests(sent)
    expect(afterFirst).toHaveLength(2)
    expect(afterFirst[1]).toMatchObject({
      baseVersion: 2,
      changes: [{ offset: 1, length: 0, text: 'Y' }],
    })
    // 段1 确认 → 段2（Z）依次出站：坐标落在段1 应用后的权威文本系
    c.handleHostMessage({ kind: 'edit.ack', seq: 2, ok: true, version: 3 })
    const afterSecond = editRequests(sent)
    expect(afterSecond).toHaveLength(3)
    expect(afterSecond[2]).toMatchObject({
      baseVersion: 3,
      changes: [{ offset: 2, length: 0, text: 'Z' }],
    })
    // 全部应用后权威文本与本地一致；一次 Ctrl+Z 只撤末段（Z），前段保留
    const authority = afterSecond.reduce(
      (text, r) => applySer(text, r.changes), 'abcdef')
    expect(authority).toBe('XYZabcdef')
    expect(undoOnceOver(afterSecond, 'abcdef')).toBe('XYabcdef')
  })

  it('停顿阈值内连续输入合并为单笔传输（纯输入的光标后移不触发分段）', async () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, 'abcdef', 1)
    const view = c.getView()!
    useSegmentClock()
    view.dispatch({ changes: { from: 0, insert: 'X' } }) // seq1 在途
    view.dispatch({ changes: { from: 1, insert: 'Y' } }) // 暂缓段1
    await vi.advanceTimersByTimeAsync(100) // 阈值内停顿：不分段
    view.dispatch({ changes: { from: 2, insert: 'Z' } }) // 仍并入段1
    c.handleHostMessage({ kind: 'edit.ack', seq: 1, ok: true, version: 2 })
    const reqs = editRequests(sent)
    expect(reqs).toHaveLength(2)
    // 传输合并不回退：Y+Z 合并为单笔 edit.request（一条 undo 记录）
    expect(reqs[1]).toMatchObject({
      baseVersion: 2,
      changes: [{ offset: 1, length: 0, text: 'YZ' }],
    })
  })

  it('用户点击移光标开新段（无需等停顿阈值）', async () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, 'abcdef', 1)
    const view = c.getView()!
    useSegmentClock()
    view.dispatch({ changes: { from: 0, insert: 'X' } }) // seq1 在途
    view.dispatch({ changes: { from: 1, insert: 'Y' } }) // 暂缓段1
    clickContent(c) // 点击：主动移光标 → 开新段
    view.dispatch({ changes: { from: 2, insert: 'Z' } }) // 段2
    c.handleHostMessage({ kind: 'edit.ack', seq: 1, ok: true, version: 2 })
    c.handleHostMessage({ kind: 'edit.ack', seq: 2, ok: true, version: 3 })
    const reqs = editRequests(sent)
    expect(reqs).toHaveLength(3)
    expect(reqs[1].changes).toEqual([{ offset: 1, length: 0, text: 'Y' }])
    expect(reqs[2].changes).toEqual([{ offset: 2, length: 0, text: 'Z' }])
  })

  it('方向键移光标同样开新段', async () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, 'abcdef', 1)
    const view = c.getView()!
    useSegmentClock()
    view.dispatch({ changes: { from: 0, insert: 'X' } })
    view.dispatch({ changes: { from: 1, insert: 'Y' } }) // 暂缓段1
    pressArrow(c, 'ArrowLeft')
    view.dispatch({ changes: { from: 2, insert: 'Z' } }) // 段2
    c.handleHostMessage({ kind: 'edit.ack', seq: 1, ok: true, version: 2 })
    c.handleHostMessage({ kind: 'edit.ack', seq: 2, ok: true, version: 3 })
    expect(editRequests(sent).map((r) => r.changes)).toEqual([
      [{ offset: 0, length: 0, text: 'X' }],
      [{ offset: 1, length: 0, text: 'Y' }],
      [{ offset: 2, length: 0, text: 'Z' }],
    ])
  })

  it('IME 组合内不切段：候选间隔超阈值仍合并为一次组合一笔事务', async () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, 'abc', 1)
    const view = c.getView()!
    useSegmentClock()
    startComposition(c)
    view.dispatch({ changes: { from: 3, insert: '你' }, userEvent: 'input.type.compose' })
    await vi.advanceTimersByTimeAsync(800) // 组合中停顿超阈值：不切段
    // 候选替换（同组合）：净输入 = 用「你好」覆盖候选「你」
    view.dispatch({ changes: { from: 3, to: 4, insert: '你好' }, userEvent: 'input.type.compose' })
    endComposition(c)
    await vi.advanceTimersByTimeAsync(20) // flush
    const reqs = editRequests(sent)
    expect(reqs).toHaveLength(1)
    expect(reqs[0].changes).toEqual([{ offset: 3, length: 0, text: '你好' }])
    expect(view.state.doc.toString()).toBe('abc你好')
  })

  it('组合中的 compositionupdate 长停顿后到达不得拆段（组合中不回看停顿）', async () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, 'abc', 1)
    const view = c.getView()!
    useSegmentClock()
    startComposition(c)
    view.dispatch({ changes: { from: 3, insert: '你' }, userEvent: 'input.type.compose' })
    // 用户组合中停顿超阈值后继续选候选：update 事件先于候选事务到达，
    // 此刻不得置位段边界（组合原子性优先于停顿回看）
    await vi.advanceTimersByTimeAsync(800)
    c.getView()!.contentDOM.dispatchEvent(new CompositionEvent('compositionupdate'))
    view.dispatch({ changes: { from: 3, to: 4, insert: '你好' }, userEvent: 'input.type.compose' })
    endComposition(c)
    await vi.advanceTimersByTimeAsync(20)
    const reqs = editRequests(sent)
    expect(reqs).toHaveLength(1)
    expect(reqs[0].changes).toEqual([{ offset: 3, length: 0, text: '你好' }])
  })

  it('组合间停顿 ≥500ms 开新段（切分点落在上一组合提交之后）', async () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, 'abc', 1)
    const view = c.getView()!
    useSegmentClock()
    startComposition(c)
    view.dispatch({ changes: { from: 3, insert: '你' }, userEvent: 'input.type.compose' })
    endComposition(c) // 组合1 定稿（flush 定时挂起，暂缓集未出站）
    vi.setSystemTime(Date.now() + 600) // 只走时钟不跑定时器：组合间停顿 ≥ 阈值
    startComposition(c) // 组合2 开始：compositionstart 判定停顿 → 开新段
    view.dispatch({ changes: { from: 4, insert: '好' }, userEvent: 'input.type.compose' })
    endComposition(c)
    await vi.advanceTimersByTimeAsync(20) // flush：段1 出站
    expect(editRequests(sent)).toHaveLength(1)
    c.handleHostMessage({ kind: 'edit.ack', seq: 1, ok: true, version: 2 })
    const reqs = editRequests(sent)
    expect(reqs).toHaveLength(2)
    expect(reqs[0].changes).toEqual([{ offset: 3, length: 0, text: '你' }])
    expect(reqs[1].changes).toEqual([{ offset: 4, length: 0, text: '好' }])
    expect(view.state.doc.toString()).toBe('abc你好')
  })

  it('组合间停顿 <500ms 仍并为一段（连续组合一次撤销单位）', async () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, 'abc', 1)
    const view = c.getView()!
    useSegmentClock()
    startComposition(c)
    view.dispatch({ changes: { from: 3, insert: '你' }, userEvent: 'input.type.compose' })
    endComposition(c)
    vi.setSystemTime(Date.now() + 100) // 阈值内：连续组合不分段
    startComposition(c)
    view.dispatch({ changes: { from: 4, insert: '好' }, userEvent: 'input.type.compose' })
    endComposition(c)
    await vi.advanceTimersByTimeAsync(20)
    const reqs = editRequests(sent)
    expect(reqs).toHaveLength(1)
    expect(reqs[0].changes).toEqual([{ offset: 3, length: 0, text: '你好' }])
  })

  it('#148 守卫不回归：多段在途时 Ctrl+Z，history.request 恒晚于全部 edit.request', async () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, 'abc', 1)
    const view = c.getView()!
    useSegmentClock()
    view.dispatch({ changes: { from: 0, insert: 'X' } }) // seq1 在途
    view.dispatch({ changes: { from: 1, insert: 'Y' } }) // 暂缓段1
    vi.setSystemTime(Date.now() + 600)
    view.dispatch({ changes: { from: 2, insert: 'Z' } }) // 暂缓段2
    pressUndo(c) // 竞态窗口：两段均未落地，撤销意图持有
    expect(historyRequests(sent)).toHaveLength(0)
    expect(editRequests(sent)).toHaveLength(1)
    // ack 收敛：段1、段2 依次出站，期间撤销意图持续持有
    c.handleHostMessage({ kind: 'edit.ack', seq: 1, ok: true, version: 2 })
    expect(historyRequests(sent)).toHaveLength(0)
    expect(editRequests(sent)).toHaveLength(2)
    c.handleHostMessage({ kind: 'edit.ack', seq: 2, ok: true, version: 3 })
    expect(historyRequests(sent)).toHaveLength(0)
    expect(editRequests(sent)).toHaveLength(3)
    // 全部落地后释放：history.request 排在最后一个 edit.request 之后
    c.handleHostMessage({ kind: 'edit.ack', seq: 3, ok: true, version: 4 })
    const history = historyRequests(sent)
    expect(history).toEqual([{ kind: 'history.request', op: 'undo' }])
    const edits = editRequests(sent)
    expect(sent.indexOf(history[0])).toBeGreaterThan(sent.indexOf(edits[2]))
  })

  it('净抵消段耗尽后守卫即刻收敛：在途确认 + 输入即删，Ctrl+Z 立即生效且撤销目标正确', async () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, 'abcdef', 1)
    const view = c.getView()!
    useSegmentClock()
    view.dispatch({ changes: { from: 0, insert: 'X' } }) // seq1 在途
    vi.setSystemTime(Date.now() + 600) // 停顿超阈值：下一笔开新段
    view.dispatch({ changes: { from: 1, insert: 'Y' } }) // 触碰 X → 暂缓段1
    view.dispatch({ changes: { from: 1, to: 2 } }) // 立即删除 Y：阈值内并入段1 → 段净抵消
    expect(view.state.doc.toString()).toBe('Xabcdef') // Y 输入即删，本地无 Y
    // ack(X)：净抵消段出站跳过，此刻本地与权威必须完全收敛（含已确认链
    // 清空）——遗留 ackedChain 会让 hasUnlandedLocalEdits 恒真且无收敛点
    c.handleHostMessage({ kind: 'edit.ack', seq: 1, ok: true, version: 2 })
    expect(editRequests(sent)).toHaveLength(1) // 净抵消段不出站
    pressUndo(c) // 收敛后 Ctrl+Z：不得暂存，须立即生效
    expect(historyRequests(sent)).toEqual([{ kind: 'history.request', op: 'undo' }])
    // 撤销目标正确：唯一已落地编辑是 X（Y 净抵消从未落地），撤 X 回基线
    expect(undoOnceOver(editRequests(sent), 'abcdef')).toBe('abcdef')
  })
})
