// T05（#544）附加组件只读引用浮窗的 hoverPopup 接线契约（模块级 jsdom）：
// 请求载荷携带 addonSource（来源覆盖）、装载成功/失败/装载中关闭的结局
// 回调（至多一次）、替换与迟到回包不误结算、触发位置脱树即关（DOM 变更
// 观测）、键盘路径焦点进入与 Esc 归还、openPopup 入口返回实例身份。
// 真实指针/几何/观感回归在 test/browser 与集成层。
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebviewToHost } from '../../src/shared/protocol'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
import type { AddonRefPopupSettle } from '../../src/webview/addonRefViews'
import {
  __resetHoverPopupForTest,
  closeHoverPopup,
  currentHoverPopupInstanceId,
  isHoverPopupOpen,
  notifyHoverInvalidated,
  notifyHoverResult,
  openHoverPopupForAddonRef,
  setHoverPreviewContext,
} from '../../src/webview/hoverPopup'

installLocale('zh-cn', zhCn)

if (Range.prototype.getClientRects === undefined) {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
}

const SESSION = { sessionId: 'panel-1', docUri: 'file:///d%3A/notes/a.md' }

interface Harness {
  sent: WebviewToHost[]
  trigger: HTMLElement
}

function makeHarness(): Harness {
  const sent: WebviewToHost[] = []
  setHoverPreviewContext({
    session: () => SESSION,
    send: (message) => {
      sent.push(message)
    },
    codeHighlight: () => true,
  })
  const trigger = document.createElement('button')
  trigger.textContent = '预览 B'
  document.body.appendChild(trigger)
  return { sent, trigger }
}

function requestOf(sent: WebviewToHost[]) {
  const req = sent.find((m) => m.kind === 'hover.request')
  if (!req || req.kind !== 'hover.request') {
    throw new Error('hover.request 未发出')
  }
  return req
}

const RESULT_OK = {
  target: { fsPath: 'D:\\notes\\b.md', relPath: 'b.md' },
  version: 1,
  text: '# B 文档\n\n正文一段\n',
  range: { start: 0, end: 16 },
  scope: { kind: 'full' as const },
}

function okResult(instanceId: string, reqId: number) {
  return { kind: 'hover.result' as const, instanceId, reqId, ok: true as const, ...RESULT_OK }
}

afterEach(() => {
  __resetHoverPopupForTest()
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('附加组件引用浮窗入口', () => {
  it('请求携带 addonSource（来源覆盖 + 目标合成原文 + 中性源区间）', () => {
    const h = makeHarness()
    const id = openHoverPopupForAddonRef(h.trigger, { target: 'notes/b.md', sourceStart: 0, sourceEnd: 0 }, {
      addonSource: { instanceId: 'embed:h1', sourceFsPath: 'D:\\notes\\sub\\b.md' },
      onSettled: () => undefined,
    })
    expect(id).toMatch(/^hover-/)
    expect(isHoverPopupOpen()).toBe(true)
    expect(currentHoverPopupInstanceId()).toBe(id)
    const req = requestOf(h.sent)
    expect(req.addonSource).toEqual({ instanceId: 'embed:h1', sourceFsPath: 'D:\\notes\\sub\\b.md' })
    expect(req.target).toBe('notes/b.md')
    expect(req.retainSource).toBe(true)
  })

  it('无会话时返回 null 且不开浮窗', () => {
    setHoverPreviewContext(null)
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    expect(openHoverPopupForAddonRef(trigger, { target: 'b.md', sourceStart: 0, sourceEnd: 0 }, {
      addonSource: { instanceId: 'main', sourceFsPath: '' },
      onSettled: () => undefined,
    })).toBeNull()
    expect(isHoverPopupOpen()).toBe(false)
  })

  it('装载成功结算 content（一次）；刷新重放不重复回调', () => {
    const h = makeHarness()
    const settles: AddonRefPopupSettle[] = []
    const id = openHoverPopupForAddonRef(h.trigger, { target: 'b.md', sourceStart: 0, sourceEnd: 0 }, {
      addonSource: { instanceId: 'embed:b', sourceFsPath: 'D:/notes/sub/b.md' },
      onSettled: (s) => settles.push(s),
    })!
    const req = requestOf(h.sent)
    expect(notifyHoverResult(okResult(id, req.reqId))).toBe(true)
    expect(settles).toEqual([{ phase: 'content' }])
    // 同实例刷新（invalidated changed → 重发读取 → 新 reqId 回包）不重复结算
    notifyHoverInvalidated({ fsPath: RESULT_OK.target.fsPath, status: 'changed', generation: 1 })
    const reloadReq = [...h.sent].reverse().find((m) => m.kind === 'hover.request') as Extract<WebviewToHost, { kind: 'hover.request' }>
    expect(reloadReq.reqId).toBeGreaterThan(req.reqId)
    expect(reloadReq.addonSource).toEqual(req.addonSource)
    expect(notifyHoverResult({ ...okResult(id, reloadReq.reqId), version: 2, text: '# B 文档 v2\n' })).toBe(true)
    expect(settles).toHaveLength(1)
  })

  it('API 浮窗不接入可写根会话，父 Live 与历史模式不能授予写端口', () => {
    const h = makeHarness()
    const mountPopupRoot = vi.fn(() => null)
    setHoverPreviewContext({ session: () => SESSION, send: (m) => h.sent.push(m), mountPopupRoot })
    openHoverPopupForAddonRef(h.trigger, { target: 'b.md', sourceStart: 0, sourceEnd: 0 }, {
      addonSource: { instanceId: 'main', sourceFsPath: '' }, onSettled: () => undefined,
    })
    expect(mountPopupRoot).not.toHaveBeenCalled()
    expect(document.querySelector<HTMLElement>('.vsidian-hover-popup-mode')?.style.display).toBe('none')
    expect(document.querySelector<HTMLElement>('.vsidian-hover-popup-save')?.style.display).toBe('none')
  })

  it('目标失败结算 error 并携带真实原因（浮窗就地错误分态）', () => {
    const h = makeHarness()
    const settles: AddonRefPopupSettle[] = []
    const id = openHoverPopupForAddonRef(h.trigger, { target: '没有的.md', sourceStart: 0, sourceEnd: 0 }, {
      addonSource: { instanceId: 'main', sourceFsPath: '' },
      onSettled: (s) => settles.push(s),
    })!
    const req = requestOf(h.sent)
    expect(notifyHoverResult({ kind: 'hover.result', instanceId: id, reqId: req.reqId, ok: false, reason: 'not-found' })).toBe(true)
    expect(settles).toEqual([{ phase: 'error', reason: 'not-found' }])
    // 错误分态绘制在浮窗内（不悬挂 loading）
    const stateEl = document.querySelector('.vsidian-hover-popup-state')
    expect(stateEl?.textContent).toContain('没有的.md')
  })

  it('装载中关闭结算 closed（替换/移出/Esc 等统一口径）', () => {
    const h = makeHarness()
    const settles: AddonRefPopupSettle[] = []
    openHoverPopupForAddonRef(h.trigger, { target: 'b.md', sourceStart: 0, sourceEnd: 0 }, {
      addonSource: { instanceId: 'main', sourceFsPath: '' },
      onSettled: (s) => settles.push(s),
    })
    closeHoverPopup()
    expect(settles).toEqual([{ phase: 'closed' }])
  })

  it('新请求替换旧请求：旧请求 closed 结算先于新请求打开；迟到回包不重开不误结算', () => {
    const h = makeHarness()
    const settlesA: AddonRefPopupSettle[] = []
    const settlesB: AddonRefPopupSettle[] = []
    const idA = openHoverPopupForAddonRef(h.trigger, { target: 'b.md', sourceStart: 0, sourceEnd: 0 }, {
      addonSource: { instanceId: 'main', sourceFsPath: '' },
      onSettled: (s) => settlesA.push(s),
    })!
    const reqA = requestOf(h.sent)
    const idB = openHoverPopupForAddonRef(h.trigger, { target: 'c.md', sourceStart: 0, sourceEnd: 0 }, {
      addonSource: { instanceId: 'main', sourceFsPath: '' },
      onSettled: (s) => settlesB.push(s),
    })!
    expect(idA).not.toBe(idB)
    expect(settlesA).toEqual([{ phase: 'closed' }])
    // 旧请求的迟到成功回包：实例身份不匹配 → 不消费、不重开、不结算 B
    expect(notifyHoverResult(okResult(idA, reqA.reqId))).toBe(false)
    expect(settlesB).toEqual([])
    expect(isHoverPopupOpen()).toBe(true)
    expect(currentHoverPopupInstanceId()).toBe(idB)
  })

  it('触发位置脱树（DOM 变更）即关闭并结算 closed', async () => {
    const h = makeHarness()
    const settles: AddonRefPopupSettle[] = []
    openHoverPopupForAddonRef(h.trigger, { target: 'b.md', sourceStart: 0, sourceEnd: 0 }, {
      addonSource: { instanceId: 'main', sourceFsPath: '' },
      onSettled: (s) => settles.push(s),
    })
    expect(isHoverPopupOpen()).toBe(true)
    h.trigger.remove()
    // MutationObserver 异步派发（微任务后）
    await new Promise((r) => setTimeout(r, 20))
    expect(isHoverPopupOpen()).toBe(false)
    expect(settles).toEqual([{ phase: 'closed' }])
  })

  it('键盘路径：焦点进入浮层，Esc 关闭并归还原焦点', () => {
    const h = makeHarness()
    const focusTarget = document.createElement('input')
    document.body.appendChild(focusTarget)
    focusTarget.focus()
    openHoverPopupForAddonRef(h.trigger, { target: 'b.md', sourceStart: 0, sourceEnd: 0 }, {
      keyboard: true,
      addonSource: { instanceId: 'main', sourceFsPath: '' },
      onSettled: () => undefined,
    })
    const popupEl = document.querySelector<HTMLElement>('.vsidian-hover-popup')
    expect(popupEl).not.toBeNull()
    expect(document.activeElement).toBe(popupEl)
    // Esc 捕获层关闭（既有键盘路径）
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(isHoverPopupOpen()).toBe(false)
    expect(document.activeElement).toBe(focusTarget)
  })

  it('缺省鼠标路径零抢焦点', () => {
    const h = makeHarness()
    const elsewhere = document.createElement('input')
    document.body.appendChild(elsewhere)
    elsewhere.focus()
    openHoverPopupForAddonRef(h.trigger, { target: 'b.md', sourceStart: 0, sourceEnd: 0 }, {
      addonSource: { instanceId: 'main', sourceFsPath: '' },
      onSettled: () => undefined,
    })
    expect(document.activeElement).toBe(elsewhere)
  })
})
