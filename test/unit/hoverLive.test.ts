// P2-06（#283）悬停浮窗根引用内部 Live 契约（模块级 jsdom 直驱）：
// - 浮窗根 B 接入 EmbedCardManager 的目标编辑端口（与正文嵌入同一
//   requestClose/save/dirty 链路，不另造）：bind occurrence = 引用位置
//   语义键（跨开合稳定），装载成功且生效 Live 才绑定端口、创建编辑器
// - 内部模式默认跟随根面板模式（notifyParentModeChanged 联动），手动
//   切换按引用位置记忆；重开恢复模式与选区（无需编辑器常驻）
// - 浮窗头部 chrome：保存/模式/关闭入口与 dirty `·` 圆点（hover-popup
//   类名族；干净态无圆点节点）
// - 保活语义：端口在场且 dirty／在途输入／冲突暂停时，移出延迟关、
//   外点、blur/visibilitychange 等普通关闭条件不销毁；dirty 清零后
//   恢复常规关闭；干净 Live 与 Reading 同规普通关闭
// - Esc 分层：模态在场归模态（取消）；焦点在编辑器内归编辑器 keymap；
//   其余经显式退出链路（dirty 弹三项模态、干净直接退出编辑），Esc 的
//   消隐意图在链路完成后关浮窗，模态取消则保留现场
// - Live 在场时目标失效推送不重载 Reading（挂起，切回时补一次静默重载）
// 真实键盘/指针/绘制层在 test/browser（hoverLive.mjs）；真宿主保存路由
// 在集成层（P2-06 用例）。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HoverPreviewResult, WebviewToHost } from '../../src/shared/protocol'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import { EmbedCardManager, type EmbedCardContext } from '../../src/webview/embedCard'
import {
  hoverPopupProbe,
  isHoverPopupOpen,
  notifyHoverInvalidated,
  notifyHoverResult,
  openHoverPopupFor,
  setHoverPreviewContext,
  __resetHoverPopupForTest,
  HOVER_POPUP_CLOSE_DELAY_MS,
} from '../../src/webview/hoverPopup'
import { EditorView } from '@codemirror/view'

installLocale('zh-cn', zhCn)

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('vsidian-hover-popup-scroll') ? 400 : 0
  })
})

if (Range.prototype.getClientRects === undefined) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
}

const SESSION = { sessionId: 'panel-1', docUri: 'file:///d%3A/notes/a.md' }
const B_FS = 'D:\\notes\\目标笔记.md'
const B_DOC_URI = 'file:///d%3A/notes/%E7%9B%AE%E6%87%87%E7%AC%94%E8%AE%B0.md'
const TARGET_TEXT = ['# 目标笔记', '', '目标正文一段。', '目标正文二段。', ''].join('\n')
const DIALOG_SAVE = 'vsidian-ref-close-save'
const DIALOG_CANCEL = 'vsidian-ref-close-cancel'

interface Harness {
  sent: WebviewToHost[]
  manager: EmbedCardManager
  anchor: HTMLAnchorElement
  setParentMode(mode: 'reading' | 'live'): void
}

/** 装配：真 EmbedCardManager（与生产 syncController 同款接线）+ 悬停
 *  上下文；A 的双链锚点带源区间 dataset */
function makeHarness(parentMode: 'reading' | 'live' = 'reading'): Harness {
  const sent: WebviewToHost[] = []
  let mode = parentMode
  const ctx: EmbedCardContext = {
    session: () => SESSION,
    send: (message) => { sent.push(message) },
    codeHighlight: () => true,
    maxHeightPx: () => 480,
    maxDepth: () => 3,
    parentMode: () => mode,
  }
  const manager = new EmbedCardManager(ctx)
  setHoverPreviewContext({
    session: () => SESSION,
    send: (message) => { sent.push(message) },
    codeHighlight: () => true,
    mountPopupRoot: (args) => manager.mountPopupRoot(args),
  })
  const block = document.createElement('div')
  block.dataset['vsidianSrcStart'] = '10'
  block.dataset['vsidianSrcEnd'] = '30'
  const anchor = document.createElement('a')
  anchor.className = 'vsidian-wikilink'
  anchor.setAttribute('href', '目标笔记')
  block.appendChild(anchor)
  document.body.appendChild(block)
  return {
    sent,
    manager,
    anchor,
    setParentMode: (m) => {
      mode = m
      manager.notifyParentModeChanged()
    },
  }
}

function popupEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.vsidian-hover-popup')
}

function liveContainer(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.vsidian-hover-popup .vsidian-hover-popup-live')
}

function popupEditor(): EditorView | null {
  const editor = document.querySelector('.vsidian-hover-popup .vsidian-hover-popup-live .cm-editor')
  return editor instanceof HTMLElement ? EditorView.findFromDOM(editor) : null
}

function dirtyDot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.vsidian-hover-popup .vsidian-hover-popup-dirty')
}

function modeButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('.vsidian-hover-popup .vsidian-hover-popup-mode')
}

function openPopup(h: Harness, target = '目标笔记', sourceStart = 10): void {
  openHoverPopupFor(h.anchor, { target, sourceStart, sourceEnd: sourceStart + 10 })
}

function lastHoverRequest(h: Harness) {
  const req = [...h.sent].reverse().find((m) => m.kind === 'hover.request')
  if (!req || req.kind !== 'hover.request') {
    throw new Error('hover.request 未发出')
  }
  return req
}

function lastBindRequest(h: Harness) {
  const req = [...h.sent].reverse().find((m) => m.kind === 'refEdit.bind')
  if (!req || req.kind !== 'refEdit.bind') {
    throw new Error('refEdit.bind 未发出')
  }
  return req
}

function lastEditRequest(h: Harness) {
  for (let i = h.sent.length - 1; i >= 0; i--) {
    const m = h.sent[i]!
    if (m.kind === 'refEdit.message' && m.message.kind === 'edit.request') {
      return m.message
    }
  }
  throw new Error('edit.request 未发出')
}

function respondHoverOk(h: Harness, text = TARGET_TEXT, version = 5): void {
  const req = lastHoverRequest(h)
  const msg: Extract<HoverPreviewResult, { ok: true }> = {
    kind: 'hover.result',
    reqId: req.reqId,
    instanceId: req.instanceId,
    ok: true,
    target: { fsPath: B_FS, relPath: '目标笔记.md' },
    version,
    text,
    range: { start: 0, end: text.length },
    scope: { kind: 'full' },
    depth: 1,
    expansionPath: [],
    sourceLeaseId: `panel-1:source-${req.reqId}`,
  }
  notifyHoverResult(msg)
}

let portSeq = 0
/** 应答 bind（成功）并推送 init（编辑器装载全文） */
function respondBound(h: Harness, opts?: { dirty?: boolean; version?: number }): string {
  const bind = lastBindRequest(h)
  const portId = `refport-test-${++portSeq}`
  h.manager.notifyBound({
    kind: 'refEdit.bound', reqId: bind.reqId, ok: true,
    portId, fsPath: B_FS, docUri: B_DOC_URI,
    version: opts?.version ?? 5, dirty: opts?.dirty ?? false,
  })
  h.manager.notifyPush({
    kind: 'refEdit.push', portId, fsPath: B_FS,
    message: { kind: 'init', sessionId: portId, docUri: B_DOC_URI, version: opts?.version ?? 5, text: TARGET_TEXT },
  })
  return portId
}

function pushDirty(h: Harness, dirty: boolean): void {
  h.manager.notifyDirty({ kind: 'refEdit.dirty', fsPath: B_FS, dirty })
}

/** 向浮窗内编辑器注入一笔输入（与真实键入同一事务管线） */
function typeInPopupEditor(view: EditorView, pos: number, text: string): void {
  view.dispatch({ changes: { from: pos, to: pos, insert: text } })
}

/** 编辑器在途（edit.request 已出站、宿主未 ack）——hasPendingLocalInput */
function leaveEditInFlight(h: Harness): void {
  const view = popupEditor()
  if (!view) throw new Error('编辑器不在场')
  typeInPopupEditor(view, '# 目标笔记\n\n'.length, '【浮窗编辑】')
  expect(lastEditRequest(h).changes.length).toBeGreaterThan(0)
}

function ackEdit(h: Harness, portId: string, version: number): void {
  const env = lastEditRequest(h)
  h.manager.notifyPush({
    kind: 'refEdit.push', portId, fsPath: B_FS,
    message: { kind: 'edit.ack', seq: env.seq, ok: true, version },
  })
}

/** 模拟鼠标离开联合域（浮层容器 mouseleave → 延迟关闭源） */
function mouseLeavePopup(): void {
  popupEl()?.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }))
}

/** 模拟外点（document 捕获 pointerdown，目标在联合域外） */
function pointerDownOutside(): void {
  document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
}

/** 模拟窗口失焦 */
function windowBlur(): void {
  window.dispatchEvent(new Event('blur'))
}

/** 模拟 Esc（document 捕获 keydown） */
function pressEscape(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
}

/** 打开浮窗并完成「装载 → （可选）Live 绑定」全链路 */
function setupLivePopup(h: Harness, opts?: { dirty?: boolean }): string {
  openPopup(h)
  respondHoverOk(h)
  const portId = respondBound(h, { dirty: opts?.dirty })
  return portId
}

afterEach(() => {
  __resetHoverPopupForTest()
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('P2-06 悬停浮窗根引用内部 Live：端口接入与模式状态机', () => {
  it('父模式 Live 时装载完成自动绑定端口并创建编辑器；occurrence 为引用位置语义键', () => {
    const h = makeHarness('live')
    openPopup(h)
    // 装载前不绑定（watch 固定是宿主 bind 校验前置；端口等装载完成）
    expect(h.sent.some((m) => m.kind === 'refEdit.bind')).toBe(false)
    respondHoverOk(h)
    const bind = lastBindRequest(h)
    expect(bind.occurrence).toBe('hover@10::目标笔记')
    expect(bind.fsPath).toBe(B_FS)
    const portId = respondBound(h)
    // 编辑器在浮窗 live 容器在场，Reading 容器隐藏
    const editor = popupEditor()
    expect(editor, '装载 + Live 继承后浮窗内应创建编辑器').not.toBeNull()
    expect(liveContainer()!.style.display).not.toBe('none')
    expect(editor!.state.doc.toString()).toBe(TARGET_TEXT)
    // watch 身份 = 语义键（bind 校验的来源固定同源）
    const watch = h.sent.find((m) => m.kind === 'hover.watch')
    expect(watch && watch.kind === 'hover.watch' ? watch.instanceId : '').toBe('hover@10::目标笔记')
    void portId
  })

  it('父模式 Reading 默认 Reading（无端口）；手动切换按引用位置记忆，重开恢复模式与选区', () => {
    vi.useFakeTimers()
    const h = makeHarness('reading')
    openPopup(h)
    respondHoverOk(h)
    expect(popupEditor()).toBeNull()
    expect(h.sent.some((m) => m.kind === 'refEdit.bind')).toBe(false)

    // 手动切 Live：头部模式按钮（真实 click 同处理器）
    modeButton()!.click()
    const portId = respondBound(h)
    const view = popupEditor()
    expect(view, '手动 Live 后创建编辑器').not.toBeNull()
    // 选区写入后关闭（普通路径）——选区与模式覆盖按位置记忆
    view!.dispatch({ selection: { anchor: 4, head: 9 } })
    mouseLeavePopup()
    vi.advanceTimersByTime(HOVER_POPUP_CLOSE_DELAY_MS)
    expect(isHoverPopupOpen()).toBe(false)
    expect(document.querySelector('.vsidian-hover-popup .cm-editor')).toBeNull()

    // 重开同位置：模式覆盖恢复 Live（重绑端口），选区恢复
    openPopup(h)
    respondHoverOk(h)
    const port2 = respondBound(h)
    expect(port2).not.toBe(portId)
    const reopened = popupEditor()
    expect(reopened, '重开后按位置记忆恢复内部 Live').not.toBeNull()
    const sel = reopened!.state.selection.main
    expect(sel.anchor).toBe(4)
    expect(sel.head).toBe(9)
  })

  it('干净浮窗重开恢复会话滚动位置（无需编辑器常驻）', () => {
    vi.useFakeTimers()
    const h = makeHarness('reading')
    openPopup(h)
    respondHoverOk(h)
    const scroll = document.querySelector<HTMLElement>('.vsidian-hover-popup-scroll')!
    scroll.scrollTop = 120
    scroll.dispatchEvent(new Event('scroll')) // 同步最后已知滚动（#258 语义）
    mouseLeavePopup()
    vi.advanceTimersByTime(HOVER_POPUP_CLOSE_DELAY_MS)
    expect(isHoverPopupOpen()).toBe(false)

    openPopup(h)
    respondHoverOk(h)
    // restoreScroll 延迟一帧回写（等宿主布局）
    vi.advanceTimersByTime(32)
    const reopened = document.querySelector<HTMLElement>('.vsidian-hover-popup-scroll')!
    expect(reopened.scrollTop).toBe(120)
  })

  it('不同引用位置的模式记忆互相隔离', () => {
    vi.useFakeTimers()
    const h = makeHarness('reading')
    openPopup(h, '目标笔记', 10)
    respondHoverOk(h)
    modeButton()!.click()
    respondBound(h)
    expect(popupEditor()).not.toBeNull()
    mouseLeavePopup()
    vi.advanceTimersByTime(HOVER_POPUP_CLOSE_DELAY_MS)
    expect(isHoverPopupOpen()).toBe(false)

    // 另一位置（不同 sourceStart）默认 Reading
    openPopup(h, '目标笔记', 40)
    respondHoverOk(h)
    expect(popupEditor()).toBeNull()
    expect(hoverPopupProbe().internalMode).toBe('reading')
    // 原位置重开仍 Live
    mouseLeavePopup()
    vi.advanceTimersByTime(HOVER_POPUP_CLOSE_DELAY_MS)
    openPopup(h, '目标笔记', 10)
    respondHoverOk(h)
    respondBound(h)
    expect(popupEditor()).not.toBeNull()
  })

  it('父面板模式切换联动：未手动覆盖的浮窗根跟随（Reading→Live 绑定端口）', () => {
    const h = makeHarness('reading')
    openPopup(h)
    respondHoverOk(h)
    expect(popupEditor()).toBeNull()
    h.setParentMode('live')
    const portId = respondBound(h)
    expect(popupEditor(), '父切 Live 后浮窗根跟随进入内部 Live').not.toBeNull()
    void portId
  })

  it('Live 在场时目标失效推送不重载 Reading（挂起；切回 Reading 时静默重载）', () => {
    vi.useFakeTimers()
    const h = makeHarness('live')
    const portId = setupLivePopup(h)
    const textLen = () => (document.querySelector('.vsidian-hover-popup .vsidian-view-reading')?.textContent ?? '').length
    const before = textLen()
    notifyHoverInvalidated({ fsPath: B_FS, status: 'changed', generation: 1 })
    expect(h.sent.filter((m) => m.kind === 'hover.request').length,
      'Live 在场时失效推送不得触发 Reading 重发请求').toBe(1)
    expect(textLen()).toBe(before)
    // 切回 Reading：挂起的失效补一次静默重载（anchorOptional 重读）
    modeButton()!.click()
    const requests = h.sent.filter((m) => m.kind === 'hover.request')
    expect(requests.length).toBe(2)
    expect(requests[1]!.anchorOptional).toBe(true)
    void portId
  })
})

describe('P2-06 浮窗头部 chrome：名称、圆点与保存/关闭入口', () => {
  it('dirty 推送驱动 `·` 圆点与保存入口在场；保存成功后清除', () => {
    const h = makeHarness('live')
    const portId = setupLivePopup(h)
    expect(dirtyDot(), '干净目标无圆点节点').toBeNull()
    pushDirty(h, true)
    const dot = dirtyDot()
    expect(dot, 'dirty 推送后圆点在场').not.toBeNull()
    expect(dot!.textContent).toBe('·')
    expect(dot!.getAttribute('data-tooltip')).toBeTruthy()
    h.manager.notifySaveResult({ kind: 'refEdit.save.result', portId, fsPath: B_FS, ok: true })
    pushDirty(h, false)
    expect(dirtyDot(), '保存成功且 dirty 清零后圆点消失').toBeNull()
  })

  it('头部按钮悬停词走 data-tooltip（不写原生 title）', () => {
    const h = makeHarness('reading')
    openPopup(h)
    respondHoverOk(h)
    for (const btn of document.querySelectorAll<HTMLButtonElement>('.vsidian-hover-popup-header button')) {
      expect(btn.getAttribute('title')).toBeNull()
      if (btn.classList.contains('vsidian-hover-popup-open')) {
        expect(btn.getAttribute('data-tooltip')).toBeTruthy()
      }
    }
  })
})

describe('P2-06 保活语义：dirty 抵抗普通关闭，干净沿用常规', () => {
  it('干净 Live：移出延迟关闭（与 Reading 同规）', () => {
    vi.useFakeTimers()
    const h = makeHarness('live')
    setupLivePopup(h)
    expect(popupEditor()).not.toBeNull()
    mouseLeavePopup()
    vi.advanceTimersByTime(HOVER_POPUP_CLOSE_DELAY_MS - 1)
    expect(isHoverPopupOpen(), '延迟窗口内仍在场').toBe(true)
    vi.advanceTimersByTime(2)
    expect(isHoverPopupOpen(), '干净 Live 移出后按常规关闭').toBe(false)
  })

  it('dirty Live：移出/外点/失焦均保活；dirty 清零后恢复常规关闭', () => {
    vi.useFakeTimers()
    const h = makeHarness('live')
    const portId = setupLivePopup(h)
    // 编辑 → dirty 推送
    leaveEditInFlight(h)
    ackEdit(h, portId, 6)
    pushDirty(h, true)
    expect(dirtyDot()).not.toBeNull()

    mouseLeavePopup()
    vi.advanceTimersByTime(HOVER_POPUP_CLOSE_DELAY_MS * 4)
    expect(isHoverPopupOpen(), 'dirty Live 移出不销毁').toBe(true)
    pointerDownOutside()
    expect(isHoverPopupOpen(), 'dirty Live 外点不销毁').toBe(true)
    windowBlur()
    expect(isHoverPopupOpen(), 'dirty Live 失焦不销毁').toBe(true)

    // 保存 → dirty 清零：保活失效，指针已在联合域外 → 恢复关闭
    h.manager.notifySaveResult({ kind: 'refEdit.save.result', portId, fsPath: B_FS, ok: true })
    pushDirty(h, false)
    vi.advanceTimersByTime(HOVER_POPUP_CLOSE_DELAY_MS * 2)
    expect(isHoverPopupOpen(), 'dirty 清零且指针在外后恢复常规关闭').toBe(false)
  })

  it('在途提交（未 ack）不按 B 干净销毁', () => {
    vi.useFakeTimers()
    const h = makeHarness('live')
    const portId = setupLivePopup(h)
    leaveEditInFlight(h) // edit.request 出站、不 ack → hasPendingLocalInput
    mouseLeavePopup()
    vi.advanceTimersByTime(HOVER_POPUP_CLOSE_DELAY_MS * 4)
    expect(isHoverPopupOpen(), '在途输入期间普通关闭条件不销毁').toBe(true)
    // 输入落定（ack 到达）且目标仍干净 → 恢复常规关闭
    const env = lastEditRequest(h)
    h.manager.notifyPush({
      kind: 'refEdit.push', portId, fsPath: B_FS,
      message: { kind: 'edit.ack', seq: env.seq, ok: true, version: 6 },
    })
    vi.advanceTimersByTime(HOVER_POPUP_CLOSE_DELAY_MS * 2)
    expect(isHoverPopupOpen(), 'ack 落定后（B 仍干净）恢复常规关闭').toBe(false)
  })

  it('冲突暂停（suspended）保活：不吞输入也不销毁', () => {
    vi.useFakeTimers()
    const h = makeHarness('live')
    const portId = setupLivePopup(h)
    h.manager.notifyPush({
      kind: 'refEdit.push', portId, fsPath: B_FS,
      message: { kind: 'session.suspended', version: 6, reason: 'conflict' },
    })
    mouseLeavePopup()
    vi.advanceTimersByTime(HOVER_POPUP_CLOSE_DELAY_MS * 4)
    expect(isHoverPopupOpen(), '冲突暂停期间普通关闭条件不销毁').toBe(true)
  })
})

describe('P2-06 Esc 分层与显式关闭链路（复用 P2-05 三项确认）', () => {
  it('Esc（焦点不在编辑器）+ dirty：出站 close.query → 三项模态；保存并关闭后退出编辑并关浮窗', () => {
    vi.useFakeTimers()
    const h = makeHarness('live')
    const portId = setupLivePopup(h)
    leaveEditInFlight(h)
    ackEdit(h, portId, 6)
    pushDirty(h, true)

    pressEscape()
    const query = h.sent.find((m) => m.kind === 'refEdit.close.query')
    expect(query, 'Esc 走显式退出链路（close.query 出站）').toBeTruthy()
    h.manager.notifyCloseState({
      kind: 'refEdit.close.state', reqId: query && query.kind === 'refEdit.close.query' ? query.reqId : 0,
      fsPath: B_FS, dirty: true, version: 6, relPath: '目标笔记.md',
    })
    const dialog = document.querySelector('.vsidian-ref-close-dialog')
    expect(dialog, 'dirty 目标弹三项确认模态').not.toBeNull()
    // 默认焦点取消
    expect(document.activeElement?.classList.contains(DIALOG_CANCEL)).toBe(true)

    // 保存并关闭
    document.querySelector<HTMLButtonElement>(`.${DIALOG_SAVE}`)!.click()
    const exec = h.sent.find((m) => m.kind === 'refEdit.close.execute')
    expect(exec, '确认后 close.execute 出站').toBeTruthy()
    h.manager.notifyCloseResult({
      kind: 'refEdit.close.result', reqId: exec && exec.kind === 'refEdit.close.execute' ? exec.reqId : 0,
      fsPath: B_FS, outcome: 'closed',
    })
    // 消隐意图完成：浮窗关闭（Esc 来自浮层Dismiss 意图）
    expect(isHoverPopupOpen(), 'Esc 消隐链路完成后浮窗关闭').toBe(false)
  })

  it('模态取消：保留浮窗、编辑器与 dirty 现场', () => {
    vi.useFakeTimers()
    const h = makeHarness('live')
    const portId = setupLivePopup(h)
    leaveEditInFlight(h)
    ackEdit(h, portId, 6)
    pushDirty(h, true)
    pressEscape()
    const query = h.sent.find((m) => m.kind === 'refEdit.close.query')
    h.manager.notifyCloseState({
      kind: 'refEdit.close.state', reqId: query && query.kind === 'refEdit.close.query' ? query.reqId : 0,
      fsPath: B_FS, dirty: true, version: 6, relPath: '目标笔记.md',
    })
    document.querySelector<HTMLButtonElement>(`.${DIALOG_CANCEL}`)!.click()
    expect(isHoverPopupOpen(), '取消保留浮窗').toBe(true)
    expect(popupEditor(), '取消保留编辑器').not.toBeNull()
    expect(dirtyDot(), '取消保留 dirty 现场').not.toBeNull()
    // 取消后恢复常规鼠标语义（仍 dirty → 保活）
    mouseLeavePopup()
    vi.advanceTimersByTime(HOVER_POPUP_CLOSE_DELAY_MS * 4)
    expect(isHoverPopupOpen()).toBe(true)
  })

  it('干净 Live + Esc（焦点在编辑器外 = 消隐意图）：经权威状态检查后退出编辑并关浮窗', () => {
    vi.useFakeTimers()
    const h = makeHarness('live')
    setupLivePopup(h)
    pressEscape()
    const query = h.sent.find((m) => m.kind === 'refEdit.close.query')
    expect(query, '干净目标也经宿主权威状态检查').toBeTruthy()
    h.manager.notifyCloseState({
      kind: 'refEdit.close.state', reqId: query && query.kind === 'refEdit.close.query' ? query.reqId : 0,
      fsPath: B_FS, dirty: false, version: 5, relPath: '目标笔记.md',
    })
    expect(document.querySelector('.vsidian-ref-close-dialog')).toBeNull()
    expect(popupEditor(), '干净退出后编辑器销毁').toBeNull()
    expect(isHoverPopupOpen(), '消隐意图完成：浮窗关闭').toBe(false)
  })

  it('干净 Live + Esc（焦点在编辑器内 = keymap 径）：退出编辑、浮窗保留回 Reading', () => {
    vi.useFakeTimers()
    const h = makeHarness('live')
    setupLivePopup(h)
    const view = popupEditor()!
    view.focus() // 真实焦点进编辑器——捕获层放行给编辑器 keymap
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    const query = h.sent.find((m) => m.kind === 'refEdit.close.query')
    expect(query, '编辑器 keymap 走同一显式退出链路').toBeTruthy()
    h.manager.notifyCloseState({
      kind: 'refEdit.close.state', reqId: query && query.kind === 'refEdit.close.query' ? query.reqId : 0,
      fsPath: B_FS, dirty: false, version: 5, relPath: '目标笔记.md',
    })
    expect(popupEditor(), '编辑器销毁').toBeNull()
    expect(isHoverPopupOpen(), 'keymap 径不携带消隐意图：浮窗保留（回 Reading）').toBe(true)
    expect(hoverPopupProbe().internalMode).toBe('reading')
    // Reading 态 Esc：常规关闭浮窗
    pressEscape()
    expect(isHoverPopupOpen(), 'Reading 态 Esc 关闭浮窗').toBe(false)
  })

  it('头部关闭按钮（close 意图）：干净时退出编辑不关浮窗', () => {
    vi.useFakeTimers()
    const h = makeHarness('live')
    setupLivePopup(h)
    const closeBtn = document.querySelector<HTMLButtonElement>('.vsidian-hover-popup .vsidian-hover-popup-close')
    expect(closeBtn, '端口在场时关闭入口可见').not.toBeNull()
    closeBtn!.click()
    const query = h.sent.find((m) => m.kind === 'refEdit.close.query')
    expect(query).toBeTruthy()
    h.manager.notifyCloseState({
      kind: 'refEdit.close.state', reqId: query && query.kind === 'refEdit.close.query' ? query.reqId : 0,
      fsPath: B_FS, dirty: false, version: 5, relPath: '目标笔记.md',
    })
    expect(isHoverPopupOpen(), 'close 意图退出编辑、浮窗保留').toBe(true)
    expect(popupEditor()).toBeNull()
  })
})

describe('P2-06 生命周期边界', () => {
  it('浮窗关闭销毁端口与编辑器（unbind 出站），迟到 bound 不复活', () => {
    vi.useFakeTimers()
    const h = makeHarness('live')
    const portId = setupLivePopup(h)
    mouseLeavePopup()
    vi.advanceTimersByTime(HOVER_POPUP_CLOSE_DELAY_MS)
    expect(isHoverPopupOpen()).toBe(false)
    expect(document.querySelector('.vsidian-hover-popup .cm-editor')).toBeNull()
    const unbind = h.sent.find((m) => m.kind === 'refEdit.unbind')
    expect(unbind, '浮窗关闭出站 unbind 释放端口').toBeTruthy()

    // 迟到 bound（浮窗已关）：不创建编辑器、不留端口
    const bind = lastBindRequest(h)
    h.manager.notifyBound({
      kind: 'refEdit.bound', reqId: bind.reqId + 100, ok: true,
      portId: 'refport-late', fsPath: B_FS, docUri: B_DOC_URI, version: 5, dirty: false,
    })
    expect(document.querySelector('.cm-editor')).toBeNull()
    void portId
  })

  it('在途 bind 期间关闭：迟到 bound 无副作用（无编辑器复活）', () => {
    vi.useFakeTimers()
    const h = makeHarness('live')
    openPopup(h)
    respondHoverOk(h)
    expect(lastBindRequest(h)).toBeTruthy() // bind 已出站未应答
    mouseLeavePopup()
    vi.advanceTimersByTime(HOVER_POPUP_CLOSE_DELAY_MS)
    expect(isHoverPopupOpen()).toBe(false)
    const bind = lastBindRequest(h)
    h.manager.notifyBound({
      kind: 'refEdit.bound', reqId: bind.reqId, ok: true,
      portId: 'refport-late2', fsPath: B_FS, docUri: B_DOC_URI, version: 5, dirty: false,
    })
    h.manager.notifyPush({
      kind: 'refEdit.push', portId: 'refport-late2', fsPath: B_FS,
      message: { kind: 'init', sessionId: 'refport-late2', docUri: B_DOC_URI, version: 5, text: TARGET_TEXT },
    })
    expect(document.querySelector('.cm-editor')).toBeNull()
  })

  it('上下文未提供 mountPopupRoot 时浮窗保持纯 Reading（chrome 隐藏）', () => {
    setHoverPreviewContext({
      session: () => SESSION,
      send: () => {},
      codeHighlight: () => true,
    })
    const anchor = document.createElement('a')
    anchor.setAttribute('href', '目标笔记')
    document.body.appendChild(anchor)
    openHoverPopupFor(anchor, { target: '目标笔记', sourceStart: 0, sourceEnd: 5 })
    expect(modeButton()!.style.display).toBe('none')
    expect(liveContainer()!.style.display).toBe('none') // live 容器在场但隐藏（纯 Reading 形态）
    const saveLegacy = document.querySelector<HTMLButtonElement>('.vsidian-hover-popup .vsidian-hover-popup-save')
    expect(saveLegacy!.style.display).toBe('none')
  })
})
