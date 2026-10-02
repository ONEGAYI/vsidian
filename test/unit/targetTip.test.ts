// 跳转目标提示（#299）模块契约：悬停在引用上且本次悬停不会打开浮层时，
// 稳定悬停（统一 tooltip 体系的 --vsidian-tooltip-show-delay 口径，jsdom
// 读不到变量回缺省 300ms）后经宿主轻量解析（hover.target.resolve）取得
// 目标路径并显示统一小卡片（vsidian-tooltip 族类名复用，零新增类名）；
// 浮层打开（外部联动 closeTargetTip）、指针离开联合域、提示持焦 Esc、
// 目标脱树即收。同一目标重复悬停命中短缓存不重复请求（成功与失败都
// 缓存；缓存不落盘）。真实指针时序与绘制层断言在 test/browser/targetTip。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebviewToHost } from '../../src/shared/protocol'
import {
  __resetTargetTipForTest,
  closeTargetTip,
  notifyTargetTipResolved,
  setTargetTipContext,
  targetTipAnchorEnter,
  targetTipAnchorLeave,
} from '../../src/webview/targetTip'
// 稳定悬停延迟取统一提示体系的缺省单一来源（jsdom 读不到 CSS 变量，
// resolveShowDelay 即回该缺省——推进量与运行时实际延迟同源）
import { DEFAULT_SHOW_DELAY_MS, TOOLTIP_CLASS_NAMES } from '../../src/webview/tooltipCard'

const SESSION = { sessionId: 'panel-1', docUri: 'file:///d%3A/notes/a.md' }

interface Harness {
  sent: WebviewToHost[]
  anchor: HTMLElement
  /** 回包注入（真实 handleHostMessage 同入口的模块级路由） */
  respond(reqId: number, ok: boolean, relPath?: string, anchor?: string): void
}

function makeHarness(enabled = (): boolean => true): Harness {
  const sent: WebviewToHost[] = []
  setTargetTipContext({
    session: () => SESSION,
    send: (message) => {
      sent.push(message)
    },
    enabled,
  })
  const anchor = document.createElement('a')
  anchor.className = 'vsidian-wikilink'
  anchor.setAttribute('href', '目标笔记')
  document.body.appendChild(anchor)
  return {
    sent,
    anchor,
    respond: (reqId, ok, relPath, anchorSuffix) => {
      notifyTargetTipResolved(
        ok
          ? { kind: 'hover.target.resolved', reqId, ok: true, relPath: relPath ?? '目标笔记.md', ...(anchorSuffix ? { anchor: anchorSuffix } : {}) }
          : { kind: 'hover.target.resolved', reqId, ok: false },
      )
    },
  }
}

function tipEl(): HTMLElement | null {
  // 目标提示卡片与通用 tooltip 同类名——测试环境只装配 targetTip，
  // 取在场且已显示（--shown）的卡片
  for (const el of Array.from(document.querySelectorAll<HTMLElement>(`.${TOOLTIP_CLASS_NAMES.card}`))) {
    if (el.classList.contains(TOOLTIP_CLASS_NAMES.shown)) {
      return el
    }
  }
  return null
}

function resolveMsg(h: Harness) {
  const msg = [...h.sent].reverse().find((m) => m.kind === 'hover.target.resolve')
  if (!msg || msg.kind !== 'hover.target.resolve') {
    throw new Error('hover.target.resolve 未发出')
  }
  return msg
}

beforeEach(() => {
  // jsdom 无布局：锚点 rect 全零——定位写内联值即可，不断言几何
  if (Range.prototype.getClientRects === undefined) {
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  }
})

afterEach(() => {
  __resetTargetTipForTest()
  document.body.innerHTML = ''
  vi.useRealTimers()
})

describe('跳转目标提示（#299 targetTip）', () => {
  it('稳定悬停满延迟后发轻量解析请求；回包成功显示统一小卡片（复用 vsidian-tooltip 族类名）', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    targetTipAnchorEnter(h.anchor, () => ({ target: '目标笔记', sourceStart: 0, sourceEnd: 4 }))
    expect(tipEl()).toBeNull()
    expect(h.sent).toEqual([]) // 计时未满零请求
    vi.advanceTimersByTime(DEFAULT_SHOW_DELAY_MS - 1)
    expect(h.sent).toEqual([])
    vi.advanceTimersByTime(1)
    const req = resolveMsg(h)
    expect(req.sessionId).toBe(SESSION.sessionId)
    expect(req.docUri).toBe(SESSION.docUri)
    expect(req.target).toBe('目标笔记')
    expect(req.reqId).toBeGreaterThanOrEqual(0)
    h.respond(req.reqId, true, 'sub/目标笔记.md', '#章节一')
    const el = tipEl()
    expect(el).not.toBeNull()
    // 内容口径：所属根内相对路径 + 源码形态锚点拼接
    expect(el!.textContent).toBe('sub/目标笔记.md#章节一')
  })

  it('解析失败不出提示；失败缓存——同目标再次悬停不重复请求', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    targetTipAnchorEnter(h.anchor, () => ({ target: '目标笔记', sourceStart: 0, sourceEnd: 4 }))
    vi.advanceTimersByTime(DEFAULT_SHOW_DELAY_MS)
    const req = resolveMsg(h)
    h.respond(req.reqId, false)
    expect(tipEl()).toBeNull()
    // 指针离开 → 再次悬停同一目标：命中失败缓存零新请求、无提示
    targetTipAnchorLeave(h.anchor)
    vi.advanceTimersByTime(DEFAULT_SHOW_DELAY_MS)
    targetTipAnchorEnter(h.anchor, () => ({ target: '目标笔记', sourceStart: 0, sourceEnd: 4 }))
    vi.advanceTimersByTime(DEFAULT_SHOW_DELAY_MS * 2)
    expect(h.sent.filter((m) => m.kind === 'hover.target.resolve').length).toBe(1)
    expect(tipEl()).toBeNull()
  })

  it('成功缓存：同目标再次悬停满延迟后直接显示（零新请求）', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    targetTipAnchorEnter(h.anchor, () => ({ target: '目标笔记', sourceStart: 0, sourceEnd: 4 }))
    vi.advanceTimersByTime(DEFAULT_SHOW_DELAY_MS)
    h.respond(resolveMsg(h).reqId, true, '目标笔记.md')
    expect(tipEl()).not.toBeNull()
    targetTipAnchorLeave(h.anchor)
    expect(tipEl()).toBeNull()
    targetTipAnchorEnter(h.anchor, () => ({ target: '目标笔记', sourceStart: 0, sourceEnd: 4 }))
    vi.advanceTimersByTime(DEFAULT_SHOW_DELAY_MS)
    expect(h.sent.filter((m) => m.kind === 'hover.target.resolve').length).toBe(1)
    expect(tipEl()?.textContent).toBe('目标笔记.md')
  })

  it('提示开关关闭（enabled false）不计时零请求；无会话（init 前）同样静默', () => {
    vi.useFakeTimers()
    const h = makeHarness(() => false)
    targetTipAnchorEnter(h.anchor, () => ({ target: '目标笔记', sourceStart: 0, sourceEnd: 4 }))
    vi.advanceTimersByTime(DEFAULT_SHOW_DELAY_MS * 3)
    expect(h.sent).toEqual([])
    expect(tipEl()).toBeNull()
    // init 前无会话：不发解析请求（会话守卫与其余请求同款）
    setTargetTipContext({
      session: () => ({ sessionId: undefined, docUri: undefined }),
      send: (message) => h.sent.push(message),
      enabled: () => true,
    })
    targetTipAnchorEnter(h.anchor, () => ({ target: '目标笔记', sourceStart: 0, sourceEnd: 4 }))
    vi.advanceTimersByTime(DEFAULT_SHOW_DELAY_MS * 3)
    expect(h.sent).toEqual([])
  })

  it('指针离开（leave）取消待开计时；在场提示随 leave 收起', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    targetTipAnchorEnter(h.anchor, () => ({ target: '目标笔记', sourceStart: 0, sourceEnd: 4 }))
    targetTipAnchorLeave(h.anchor)
    vi.advanceTimersByTime(DEFAULT_SHOW_DELAY_MS * 3)
    expect(h.sent).toEqual([]) // 计时已取消
    // 出场后离开：收起
    targetTipAnchorEnter(h.anchor, () => ({ target: '目标笔记', sourceStart: 0, sourceEnd: 4 }))
    vi.advanceTimersByTime(DEFAULT_SHOW_DELAY_MS)
    h.respond(resolveMsg(h).reqId, true, '目标笔记.md')
    expect(tipEl()).not.toBeNull()
    targetTipAnchorLeave(h.anchor)
    expect(tipEl()).toBeNull()
  })

  it('浮层打开联动（closeTargetTip）：在场提示立即收（含补按 Ctrl 即消的联动点）', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    targetTipAnchorEnter(h.anchor, () => ({ target: '目标笔记', sourceStart: 0, sourceEnd: 4 }))
    vi.advanceTimersByTime(DEFAULT_SHOW_DELAY_MS)
    h.respond(resolveMsg(h).reqId, true, '目标笔记.md')
    expect(tipEl()).not.toBeNull()
    closeTargetTip()
    expect(tipEl()).toBeNull()
  })

  it('目标脱树：回包到达时锚点已不在文档树，不显示；在场后脱树经滚动捕获收起', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    targetTipAnchorEnter(h.anchor, () => ({ target: '目标笔记', sourceStart: 0, sourceEnd: 4 }))
    vi.advanceTimersByTime(DEFAULT_SHOW_DELAY_MS)
    h.anchor.remove() // 视口虚拟化回收（无 mouseout 派发）
    h.respond(resolveMsg(h).reqId, true, '目标笔记.md')
    expect(tipEl()).toBeNull()
    // 在场后脱树 + 滚动（统一 tooltip 语义：滚动即收，覆盖虚拟化回收）
    const anchor2 = document.createElement('a')
    document.body.appendChild(anchor2)
    targetTipAnchorEnter(anchor2, () => ({ target: '目标笔记', sourceStart: 0, sourceEnd: 4 }))
    vi.advanceTimersByTime(DEFAULT_SHOW_DELAY_MS)
    expect(tipEl()).not.toBeNull()
    anchor2.remove()
    document.dispatchEvent(new Event('scroll'))
    expect(tipEl()).toBeNull()
  })

  it('迟到回包（reqId 不匹配的旧响应）丢弃；换锚重悬停以新请求为准', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    targetTipAnchorEnter(h.anchor, () => ({ target: '目标笔记', sourceStart: 0, sourceEnd: 4 }))
    vi.advanceTimersByTime(DEFAULT_SHOW_DELAY_MS)
    const staleReqId = resolveMsg(h).reqId
    targetTipAnchorLeave(h.anchor)
    targetTipAnchorEnter(h.anchor, () => ({ target: '目标笔记', sourceStart: 0, sourceEnd: 4 }))
    vi.advanceTimersByTime(DEFAULT_SHOW_DELAY_MS)
    const freshReqId = resolveMsg(h).reqId
    expect(freshReqId).toBeGreaterThan(staleReqId)
    h.respond(staleReqId, true, '旧响应.md')
    expect(tipEl()).toBeNull()
    h.respond(freshReqId, true, '新响应.md')
    expect(tipEl()?.textContent).toBe('新响应.md')
  })

  it('同锚重入幂等（review-loops 第 1 轮修复）：已显示态重入保活早退——无闪烁空窗、不重发请求', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    targetTipAnchorEnter(h.anchor, () => ({ target: '目标笔记', sourceStart: 0, sourceEnd: 4 }))
    vi.advanceTimersByTime(DEFAULT_SHOW_DELAY_MS)
    h.respond(resolveMsg(h).reqId, true, '目标笔记.md')
    const el = tipEl()!
    // 已显示态同锚重入（嵌套行内标记间移动/移入提示后移回锚点）：直接
    // return——不走 hide→重建 300ms→缓存重显（先消失再复现的闪烁空窗，
    // 空窗内离开则本次悬停不再出提示）
    targetTipAnchorEnter(h.anchor, () => ({ target: '目标笔记', sourceStart: 0, sourceEnd: 4 }))
    vi.advanceTimersByTime(DEFAULT_SHOW_DELAY_MS * 3)
    expect(tipEl()).toBe(el) // 同一 DOM 元素在场，未被移除重建
    expect(h.sent.filter((m) => m.kind === 'hover.target.resolve').length).toBe(1)
  })

  it('同锚重入幂等：计时期与请求在途重入均保留首算计时与代次，不重发请求', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    targetTipAnchorEnter(h.anchor, () => ({ target: '目标笔记', sourceStart: 0, sourceEnd: 4 }))
    vi.advanceTimersByTime(DEFAULT_SHOW_DELAY_MS - 50) // 计时期内重入
    targetTipAnchorEnter(h.anchor, () => ({ target: '目标笔记', sourceStart: 0, sourceEnd: 4 }))
    // 若重入重置计时，此刻累计仅 300ms 而重算起点后移——下一行取不到消息即红
    vi.advanceTimersByTime(50)
    const req = resolveMsg(h)
    // 请求在途时再重入：不取消在途代次、不重发（重发会作废在途徒增往返）
    targetTipAnchorEnter(h.anchor, () => ({ target: '目标笔记', sourceStart: 0, sourceEnd: 4 }))
    expect(h.sent.filter((m) => m.kind === 'hover.target.resolve').length).toBe(1)
    h.respond(req.reqId, true, '目标笔记.md')
    expect(tipEl()?.textContent).toBe('目标笔记.md')
  })

  it('普通链接与面板直接目标载荷形态：linkHref / directTarget 择一出站', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    targetTipAnchorEnter(h.anchor, () => ({ target: 'b.md', linkHref: 'b.md', sourceStart: 0, sourceEnd: 4 }))
    vi.advanceTimersByTime(DEFAULT_SHOW_DELAY_MS)
    expect(resolveMsg(h).linkHref).toBe('b.md')
    const item = document.createElement('div')
    document.body.appendChild(item)
    targetTipAnchorEnter(item, () => ({
      target: '显示名', sourceStart: 0, sourceEnd: 0,
      directFsPath: 'D:/notes/sub/c.md', directAnchor: '^blk',
    }))
    vi.advanceTimersByTime(DEFAULT_SHOW_DELAY_MS)
    const direct = resolveMsg(h)
    expect(direct.directTarget).toEqual({ fsPath: 'D:/notes/sub/c.md', anchor: '^blk' })
  })

  it('提示容器可聚焦（统一 tooltip 语义）：持焦 Esc 收起并还焦触发元素；悬停态不拦截 Esc', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    targetTipAnchorEnter(h.anchor, () => ({ target: '目标笔记', sourceStart: 0, sourceEnd: 4 }))
    vi.advanceTimersByTime(DEFAULT_SHOW_DELAY_MS)
    h.respond(resolveMsg(h).reqId, true, '目标笔记.md')
    const el = tipEl()!
    expect(el.tabIndex).toBe(0) // 可聚焦（文字可选中复制的统一语义）
    // 悬停态（焦点不在提示）：Esc 不被提示拦截（不 stopPropagation）
    const hoverEsc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    const seen: string[] = []
    document.addEventListener('keydown', () => seen.push('outer'), { once: true })
    document.dispatchEvent(hoverEsc)
    expect(seen).toEqual(['outer']) // 外层监听可达 = 提示未拦截
    expect(tipEl()).not.toBeNull()
    // 持焦态：Esc 收起 + 还焦锚点
    el.focus()
    const focusedEsc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    document.dispatchEvent(focusedEsc)
    expect(tipEl()).toBeNull()
    expect(document.activeElement).toBe(h.anchor)
  })

  it('指针移入提示本体保活（联合域语义：移出锚点但仍在提示内不收）', () => {
    vi.useFakeTimers()
    const h = makeHarness()
    targetTipAnchorEnter(h.anchor, () => ({ target: '目标笔记', sourceStart: 0, sourceEnd: 4 }))
    vi.advanceTimersByTime(DEFAULT_SHOW_DELAY_MS)
    h.respond(resolveMsg(h).reqId, true, '目标笔记.md')
    const el = tipEl()!
    // 调用侧委托转发形态（与 syncController 四入口同款）：leave 带
    // relatedTarget——落在提示本体内（联合域）不收
    targetTipAnchorLeave(h.anchor, el)
    expect(tipEl()).not.toBeNull()
    // 移出联合域（relatedTarget 在域外）：收
    targetTipAnchorLeave(h.anchor, document.body)
    expect(tipEl()).toBeNull()
  })
})
