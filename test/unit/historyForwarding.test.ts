// @vitest-environment jsdom
// 撤销/重做转发契约（工单 #3 / #148）：
// - webview 键盘 Mod-Z / Mod-Shift-Z / Mod-Y 经 keymap 转发为 history.request，
//   不落入未装 CM6 history 扩展时的本地 no-op undo/redo（撤销栈归宿主）
// - 宿主 undo/redo 的回流增量（external）应用后光标折叠到合理位置
// - doc.resync（全文重同步）装载全文并推进 baseVersion
// - 转发与回流的组合不产生回声：external 增量应用后不回发 edit.request
// - #148 undo 竞态守卫：本地存在未落地宿主的编辑（在途未确认请求、
//   IME/触碰暂缓集、未确认坐标链任一非空）时持有撤销/重做意图，待全部
//   落地确认后按序发出——宿主可见顺序恒为 edit.request 先于 history.request
import { describe, it, expect, vi } from 'vitest'
import { EditorView } from '@codemirror/view'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import { DocumentSession, type HostDocumentPort, type SessionNotice } from '../../src/host/documentSession'
import type { HostToWebview, SerChange, WebviewToHost } from '../../src/shared/protocol'

// jsdom 无布局：为 CM6 的视口测量（measureTextSize → Range.getClientRects）
// 提供零值 polyfill，真宿主 Chromium 有真实实现（组合事件路径会触发测量）
if (typeof Range !== 'undefined' && Range.prototype.getClientRects === undefined) {
  ;(Range.prototype as unknown as { getClientRects(): DOMRectList }).getClientRects =
    () => [] as unknown as DOMRectList
  ;(Range.prototype as unknown as { getBoundingClientRect(): DOMRect }).getBoundingClientRect =
    () => new DOMRect(0, 0, 0, 0)
}

const DOC_URI = 'file:///d%3A/notes/h.md'

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

/** 模拟 webview 键盘事件（jsdom 的 KeyboardEvent 经 CM6 keymap 处理链路）。
 * keyCode 必须显式传入：CM6 匹配 Shift+字母 时依赖 w3c-keyname 的
 * base[keyCode] 表回退小写键名（jsdom 默认 keyCode=0 会导致误判） */
const KEY_CODES: Record<string, number> = { z: 90, Z: 90, y: 89 }
function pressKey(view: EditorView, key: string, opts: { ctrl?: boolean; shift?: boolean }) {
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: opts.ctrl ?? false,
    shiftKey: opts.shift ?? false,
    keyCode: KEY_CODES[key] ?? key.charCodeAt(0),
    bubbles: true,
    cancelable: true,
  })
  view.contentDOM.dispatchEvent(event)
}

function sentHistoryRequests(sent: WebviewToHost[]) {
  return sent.filter((m) => m.kind === 'history.request')
}

describe('撤销/重做键盘转发到宿主权威栈', () => {
  it('Ctrl+Z 经 keymap 转发为 history.request undo', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, '# 中文标题\n正文')
    const view = c.getView()!
    view.focus()
    pressKey(view, 'z', { ctrl: true })
    const reqs = sentHistoryRequests(sent)
    expect(reqs).toEqual([{ kind: 'history.request', op: 'undo' }])
  })

  it('Ctrl+Shift+Z 与 Ctrl+Y 转发为 redo', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, 'abc')
    const view = c.getView()!
    view.focus()
    pressKey(view, 'Z', { ctrl: true, shift: true })
    pressKey(view, 'y', { ctrl: true })
    expect(sentHistoryRequests(sent)).toEqual([
      { kind: 'history.request', op: 'redo' },
      { kind: 'history.request', op: 'redo' },
    ])
  })

  it('普通按键不被劫持：Ctrl+B 等不产生 history.request', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, 'abc')
    const view = c.getView()!
    view.focus()
    pressKey(view, 'b', { ctrl: true })
    pressKey(view, 'x', {})
    expect(sentHistoryRequests(sent)).toHaveLength(0)
  })

  it('未收到 init（无会话）时不转发', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    const view = c.getView()!
    view.focus()
    pressKey(view, 'z', { ctrl: true })
    expect(sentHistoryRequests(sent)).toHaveLength(0)
  })
})

describe('undo/redo 回流增量的光标行为', () => {
  it('撤销插入的外部删除增量应用后光标折叠到删除区间起点', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, '你好世界', 1)
    const view = c.getView()!
    // 用户在末尾输入 '！'（本地乐观回显 + edit.request）
    view.dispatch({ changes: { from: 4, insert: '！' }, selection: { anchor: 5 } })
    expect(view.state.doc.toString()).toBe('你好世界！')
    // 宿主确认
    c.handleHostMessage({ kind: 'edit.ack', seq: 1, ok: true, version: 2 })
    // 宿主 undo 的逆增量回流：删除插入的 '！'
    c.handleHostMessage({
      kind: 'doc.changed',
      version: 3,
      origin: 'external',
      changes: [{ offset: 4, length: 1, text: '' }],
    })
    expect(view.state.doc.toString()).toBe('你好世界')
    expect(view.state.selection.main.head).toBe(4)
    // 回声防护：undo 回流应用后不回发 edit.request
    expect(sent.filter((m) => m.kind === 'edit.request')).toHaveLength(1)
  })

  it('跨块（多行）删除的编辑以单事务描述且撤销后文本与光标恢复', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, '# 标题\n\n- 列表一\n- 列表二\n\n正文段落', 1)
    const view = c.getView()!
    // 跨块选择删除：从标题行首到列表第二行行尾（跨标题、空行与列表）
    const from = 0
    const to = '# 标题\n\n- 列表一\n- 列表二'.length
    view.dispatch({ changes: { from, to, insert: '' }, selection: { anchor: from } })
    const req = sent.at(-1) as Extract<WebviewToHost, { kind: 'edit.request' }>
    expect(req.changes).toEqual([{ offset: 0, length: to, text: '' }])
    expect(view.state.doc.toString()).toBe('\n\n正文段落')
    // 撤销回流：恢复被删文本
    c.handleHostMessage({ kind: 'edit.ack', seq: 1, ok: true, version: 2 })
    c.handleHostMessage({
      kind: 'doc.changed',
      version: 3,
      origin: 'external',
      changes: [{ offset: 0, length: 0, text: '# 标题\n\n- 列表一\n- 列表二' }],
    })
    expect(view.state.doc.toString()).toBe('# 标题\n\n- 列表一\n- 列表二\n\n正文段落')
    // 光标映射到恢复文本起点附近（合理位置：插入点 0）
    expect(view.state.selection.main.head).toBe(0)
  })
})

describe('doc.resync（全文重同步）', () => {
  it('装载全文并推进 baseVersion，后续编辑携带新版本', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, '旧文本', 1)
    c.handleHostMessage({ kind: 'doc.resync', version: 8, text: '宿主权威文本' })
    expect(c.getView()!.state.doc.toString()).toBe('宿主权威文本')
    c.getView()!.dispatch({ changes: { from: 0, insert: '前缀' } })
    const req = sent.at(-1) as Extract<WebviewToHost, { kind: 'edit.request' }>
    expect(req.baseVersion).toBe(8)
  })

  it('resync 全文重置后不回发 edit.request（不是用户编辑）', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, 'a', 1)
    c.handleHostMessage({ kind: 'doc.resync', version: 2, text: 'b' })
    expect(sent.filter((m) => m.kind === 'edit.request')).toHaveLength(0)
  })
})

// ---- #148 undo 竞态守卫 ----
// 竞态：Ctrl+Z 瞬间打字还攒在 deferredLocal 未发出（IME 组合后 flush 出站
// 前、或在途请求未确认时触发的暂缓），history.request 先入宿主队列会撤掉
// 更早的操作，迟到的打字经重定位静默应用。守卫契约：本地存在未落地宿主
// 的编辑时持有撤销/重做意图（按下序累积），待本地编辑全部落地确认后按序
// 发出——宿主可见顺序恒为 edit.request 先于 history.request，撤销的必然是
// 最后一次已完成的输入。

function startComposition(c: WebviewSyncController) {
  c.getView()!.contentDOM.dispatchEvent(new CompositionEvent('compositionstart'))
}

function endComposition(c: WebviewSyncController) {
  c.getView()!.contentDOM.dispatchEvent(new CompositionEvent('compositionend'))
}

/** 模拟 CM6 在组合期间把候选文本读入状态的组合事务 */
function commitCompositionText(c: WebviewSyncController, from: number, insert: string) {
  c.getView()!.dispatch({ changes: { from, insert }, userEvent: 'input.type.compose' })
}

/**
 * jsdom 的 navigator.vendor 默认 "Apple Computer, Inc."，CM6 据此把环境判为
 * Safari：合成 compositionend 后 100ms 内的 keydown 被 ignoreDuringComposition
 * 吞掉（真宿主 Chromium 无此行为，纯测试环境假象）。组合类用例在
 * compositionend 前切 fake timers（toFake 含 Date），用 setSystemTime 跳出该
 * 窗口（不触发挂起的 flush 定时器），按键后再 advanceTimersByTimeAsync 驱动
 * flush。调用点写 vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout',
 * 'Date'] })（内联字面量走上下文类型，共享常量会因可变数组类型不匹配）。
 */

const editRequests = (sent: WebviewToHost[]) =>
  sent.filter((m): m is Extract<WebviewToHost, { kind: 'edit.request' }> => m.kind === 'edit.request')

describe('#148 undo 竞态守卫：本地编辑未落地时持有撤销意图', () => {
  it('组合暂缓输入未出站时按 Ctrl+Z：意图持有，输入落地确认后按序发出', async () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, 'abc', 1)
    const view = c.getView()!
    // 组合输入攒入暂缓集（deferredLocal）
    startComposition(c)
    commitCompositionText(c, 3, '拼')
    // compositionend 在 fake 时钟下触发：flush 定时器挂起不跑，竞态窗口可控
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      endComposition(c)
      vi.setSystemTime(Date.now() + 200) // 跳出按键忽略窗，见 IME_FAKE_TIMERS 注释
      // 竞态窗口：暂缓输入尚未发给宿主，撤销意图不得先行
      pressKey(view, 'z', { ctrl: true })
      expect(sentHistoryRequests(sent)).toHaveLength(0)
      expect(editRequests(sent)).toHaveLength(0)
      // 驱动 flush：暂缓输入以单笔 edit.request 出站（在途未确认，撤销继续持有）
      await vi.advanceTimersByTimeAsync(20)
    } finally {
      vi.useRealTimers()
    }
    const req = editRequests(sent).at(-1)!
    expect(req.changes).toEqual([{ offset: 3, length: 0, text: '拼' }])
    expect(sentHistoryRequests(sent)).toHaveLength(0)
    // 宿主确认后撤销意图才发出：宿主可见顺序 = edit.request 先于 history.request
    c.handleHostMessage({ kind: 'edit.ack', seq: req.seq, ok: true, version: 2 })
    const historyReqs = sentHistoryRequests(sent)
    expect(historyReqs).toEqual([{ kind: 'history.request', op: 'undo' }])
    expect(sent.indexOf(historyReqs[0])).toBeGreaterThan(sent.indexOf(req))
  })

  it('在途未确认请求时按 Ctrl+Z：等确认后发出（撤销的是刚确认的编辑）', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, 'abc', 1)
    const view = c.getView()!
    view.dispatch({ changes: { from: 3, insert: 'X' } })
    pressKey(view, 'z', { ctrl: true })
    expect(sentHistoryRequests(sent)).toHaveLength(0)
    c.handleHostMessage({ kind: 'edit.ack', seq: 1, ok: true, version: 2 })
    expect(sentHistoryRequests(sent)).toEqual([{ kind: 'history.request', op: 'undo' }])
    expect(sent.at(-1)!.kind).toBe('history.request')
  })

  it('持有期间连按不丢失：意图按按下序累积，落地后依序发出', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, 'abc', 1)
    const view = c.getView()!
    view.dispatch({ changes: { from: 3, insert: 'X' } })
    pressKey(view, 'z', { ctrl: true })
    pressKey(view, 'z', { ctrl: true })
    pressKey(view, 'Z', { ctrl: true, shift: true })
    expect(sentHistoryRequests(sent)).toHaveLength(0)
    c.handleHostMessage({ kind: 'edit.ack', seq: 1, ok: true, version: 2 })
    expect(sentHistoryRequests(sent)).toEqual([
      { kind: 'history.request', op: 'undo' },
      { kind: 'history.request', op: 'undo' },
      { kind: 'history.request', op: 'redo' },
    ])
  })

  it('等待期间继续输入不丢失：新输入正常出站，全部确认后撤销才发出', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, 'abc', 1)
    const view = c.getView()!
    view.dispatch({ changes: { from: 3, insert: 'X' } })
    pressKey(view, 'z', { ctrl: true })
    // 等待期间继续输入（落在未确认区间之外，走正常出站路径）
    view.dispatch({ changes: { from: 0, insert: 'Y' } })
    expect(editRequests(sent)).toHaveLength(2)
    c.handleHostMessage({ kind: 'edit.ack', seq: 1, ok: true, version: 2 })
    expect(sentHistoryRequests(sent)).toHaveLength(0)
    c.handleHostMessage({ kind: 'edit.ack', seq: 2, ok: true, version: 3 })
    expect(sentHistoryRequests(sent)).toEqual([{ kind: 'history.request', op: 'undo' }])
    // 未触发冲突暂停：撤销发出后新的输入照常出站
    view.dispatch({ changes: { from: 0, insert: 'Z' } })
    expect(editRequests(sent)).toHaveLength(3)
  })

  it('组合缓冲外部增量未 flush 时按 Ctrl+Z：缓冲应用后释放意图', async () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, 'abc', 1)
    const view = c.getView()!
    startComposition(c)
    c.handleHostMessage({
      kind: 'doc.changed', version: 2, origin: 'external',
      changes: [{ offset: 0, length: 0, text: '外' }],
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      // compositionend 后 flush 定时器尚未触发（组合期按键被 CM6 整体忽略，
      // 竞态窗口从组合结束才开始）：此刻撤销意图必须持有
      endComposition(c)
      vi.setSystemTime(Date.now() + 200) // 跳出按键忽略窗，见 IME_FAKE_TIMERS 注释
      pressKey(view, 'z', { ctrl: true })
      expect(sentHistoryRequests(sent)).toHaveLength(0)
      // 驱动 flush：缓冲应用、无本地输入在途，意图在 flush 末尾释放
      await vi.advanceTimersByTimeAsync(20)
    } finally {
      vi.useRealTimers()
    }
    expect(view.state.doc.toString()).toBe('外abc')
    expect(sentHistoryRequests(sent)).toEqual([{ kind: 'history.request', op: 'undo' }])
  })

  it('暂停面板（B-4）口径不变：暂停态按键照发，由宿主忽略', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, 'abc', 1)
    const view = c.getView()!
    view.dispatch({ changes: { from: 3, insert: 'X' } })
    c.handleHostMessage({ kind: 'edit.ack', seq: 1, ok: false, reason: 'conflict', version: 2 })
    pressKey(view, 'z', { ctrl: true })
    expect(sentHistoryRequests(sent)).toEqual([{ kind: 'history.request', op: 'undo' }])
  })

  it('持有期间进入冲突暂停：意图丢弃，恢复后不补发', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, 'abc', 1)
    const view = c.getView()!
    view.dispatch({ changes: { from: 3, insert: 'X' } })
    pressKey(view, 'z', { ctrl: true })
    expect(sentHistoryRequests(sent)).toHaveLength(0)
    // 在途请求失败进入暂停：持有的意图随之丢弃（暂停面板的撤销忽略）
    c.handleHostMessage({ kind: 'edit.ack', seq: 1, ok: false, reason: 'conflict', version: 2 })
    c.handleHostMessage({ kind: 'doc.resync', version: 3, text: 'abcX' })
    expect(sentHistoryRequests(sent)).toHaveLength(0)
    // 恢复后新输入照常出站（面板未被遗留状态卡死）
    view.dispatch({ changes: { from: 0, insert: 'Z' } })
    expect(editRequests(sent).at(-1)).toMatchObject({ baseVersion: 3 })
  })

  it('持有期间全文重同步：落地后释放意图（撤销最后已完成的操作）', () => {
    const { bridge, sent } = makeBridge()
    const c = mount(bridge)
    init(c, 'abc', 1)
    const view = c.getView()!
    view.dispatch({ changes: { from: 3, insert: 'X' } })
    pressKey(view, 'z', { ctrl: true })
    expect(sentHistoryRequests(sent)).toHaveLength(0)
    c.handleHostMessage({ kind: 'doc.resync', version: 5, text: 'abcX' })
    expect(sentHistoryRequests(sent)).toEqual([{ kind: 'history.request', op: 'undo' }])
  })
})

// ---- #148 组合缝：真实 DocumentSession × 真实 webview 控制器 ----
// 钉住工单复现时序的终态：早前操作已确认 → 组合输入攒在暂缓集 →
// flush 出站前按 Ctrl+Z → 全链路结算后，撤销的必须是刚落地的组合输入，
// 早前操作保留、全程无冲突通知。

function applyToText(text: string, changes: SerChange[]): string {
  const sorted = [...changes].sort((a, b) => a.offset - b.offset)
  let out = text
  let shift = 0
  for (const c of sorted) {
    out = out.slice(0, c.offset + shift) + c.text + out.slice(c.offset + shift + c.length)
    shift += c.text.length - c.length
  }
  return out
}

/** 带撤销栈的模拟权威文档（驱动真实 DocumentSession 的 HostDocumentPort） */
class SeamDoc implements HostDocumentPort {
  content: string
  ver: number
  readonly eol = 1 as const
  private undoStack: { changes: SerChange[]; before: string }[] = []
  private redoStack: { changes: SerChange[]; before: string }[] = []
  private listener: ((changes: SerChange[], version: number) => void) | undefined

  constructor(text: string) {
    this.content = text
    this.ver = 1
  }

  get version(): number {
    return this.ver
  }

  getText(): string {
    return this.content
  }

  onDocChanged(cb: (changes: SerChange[], version: number) => void): void {
    this.listener = cb
  }

  async applyChanges(changes: SerChange[]): Promise<boolean> {
    this.undoStack.push({ changes, before: this.content })
    this.redoStack = []
    this.content = applyToText(this.content, changes)
    this.ver++
    this.listener?.(changes, this.ver)
    return true
  }

  async undo(): Promise<boolean> {
    const top = this.undoStack.pop()
    if (!top) return false
    this.redoStack.push(top)
    // 逆变更按组内互不重叠假设基于 before 文本精确求逆（本缝测试用单条变更组）
    const inverse: SerChange[] = []
    for (const c of top.changes) {
      let delta = 0
      for (const other of top.changes) {
        if (other !== c && other.offset + other.length <= c.offset) {
          delta += other.text.length - other.length
        }
      }
      inverse.push({
        offset: c.offset + delta,
        length: c.text.length,
        text: top.before.slice(c.offset, c.offset + c.length),
      })
    }
    this.content = top.before
    this.ver++
    this.listener?.(inverse, this.ver)
    return true
  }

  async redo(): Promise<boolean> {
    const top = this.redoStack.pop()
    if (!top) return false
    this.undoStack.push(top)
    this.content = applyToText(this.content, top.changes)
    this.ver++
    this.listener?.(top.changes, this.ver)
    return true
  }
}

function makeSeam(initial: string) {
  const doc = new SeamDoc(initial)
  const notices: SessionNotice[] = []
  const session = new DocumentSession(doc, { docUri: DOC_URI, onNotice: (n) => notices.push(n) })
  doc.onDocChanged((changes, version) => session.handleDocChanged(changes, version))
  const hostToWebview: HostToWebview[] = []
  const webviewToHost: WebviewToHost[] = []
  let sessionId = ''
  const controller = new WebviewSyncController({
    postMessage: (m) => {
      webviewToHost.push(m as WebviewToHost)
      void session.handleWebviewMessage(m as WebviewToHost, sessionId)
    },
    getState: <T,>() => undefined as T | undefined,
    setState: () => undefined,
  })
  sessionId = session.attachPanel({
    send: (m) => {
      hostToWebview.push(m)
      controller.handleHostMessage(m)
    },
  })
  controller.mount(document.createElement('div'))
  const settle = () => new Promise<void>((r) => setTimeout(r, 30))
  return { doc, session, controller, notices, hostToWebview, webviewToHost, settle }
}

describe('#148 undo 竞态守卫：DocumentSession 组合缝终态', () => {
  it('早前操作确认 → 组合输入未落地时撤销 → 终态撤销刚落地的输入且无冲突', async () => {
    const seam = makeSeam('abc')
    const c = seam.controller
    const view = c.getView()!
    await seam.settle() // ready → init 握手
    // 1) 早前操作（模拟表格把手移动等已确认编辑）落地宿主撤销栈
    view.dispatch({ changes: { from: 0, insert: '表' } })
    await seam.settle()
    expect(seam.doc.content).toBe('表abc')
    // 2) 组合输入攒入暂缓集；compositionend 后、flush 出站前按 Ctrl+Z
    startComposition(c)
    commitCompositionText(c, 4, '拼')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    try {
      endComposition(c)
      vi.setSystemTime(Date.now() + 200) // 跳出按键忽略窗，见 IME_FAKE_TIMERS 注释
      pressKey(view, 'z', { ctrl: true })
      // 竞态窗口：撤销意图不得先于暂缓输入到达宿主
      expect(seam.webviewToHost.filter((m) => m.kind === 'history.request')).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(20) // 驱动 flush：暂缓输入出站
    } finally {
      vi.useRealTimers()
    }
    // 3) 全链路结算：确认 → 释放撤销 → 宿主 undo → 逆增量回流
    await seam.settle()
    await seam.settle()
    // 4) 终态：撤销的是刚落地的组合输入（'拼' 消失），早前操作（'表'）保留；
    //    全程无冲突通知、无暂停
    expect(seam.doc.content).toBe('表abc')
    expect(view.state.doc.toString()).toBe('表abc')
    expect(seam.notices).toEqual([])
    expect(seam.hostToWebview.filter((m) => m.kind === 'session.suspended')).toHaveLength(0)
    // 宿主可见顺序：携带 '拼' 的 edit.request 先于 history.request 到达会话
    const typingReq = seam.webviewToHost
      .filter((m): m is Extract<WebviewToHost, { kind: 'edit.request' }> => m.kind === 'edit.request')
      .find((m) => m.changes.some((ch) => ch.text === '拼'))
    const historyReq = seam.webviewToHost.find((m) => m.kind === 'history.request')
    expect(typingReq).toBeDefined()
    expect(historyReq).toBeDefined()
    expect(seam.webviewToHost.indexOf(typingReq!)).toBeLessThan(seam.webviewToHost.indexOf(historyReq!))
  })
})
