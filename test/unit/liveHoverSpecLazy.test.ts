// review-loops 第 1 轮（#299 Live 入口 spec 懒化）契约：默认组合
// （hover.enabled 开、hover.liveDirect 关、无 Ctrl）下划过链接（稳定悬停
// 计时到期前离开）零源码位置解析成本——spec 以 thunk 进入 enterHoverOrTip，
// tip 路径的求值延迟到目标提示 300ms 计时到期回调内，离开即取消计时、
// thunk 永不求值。解析计数经 liveLinks 判定族三函数（双链/树驱动/宽松，
// liveLinkSpecAt 的全部出口）的 spy 观测；「完整悬停发出解析请求」用例
// 先自校验 spy 可观测性——spy 在 vitest ESM 变换下失效时该前置用例变红，
// 避免懒化断言假绿。真实指针与绘制层回归在 test/browser/targetTip 与
// hoverEntry。
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebviewSyncController, type VsCodeBridge } from '../../src/webview/syncController'
import * as liveLinks from '../../src/webview/liveLinks'
import { DEFAULT_SHOW_DELAY_MS } from '../../src/webview/tooltipCard'
import type { WebviewToHost } from '../../src/shared/protocol'

if (typeof Range !== 'undefined' && Range.prototype.getClientRects === undefined) {
  ;(Range.prototype as unknown as { getClientRects(): DOMRectList }).getClientRects =
    () => [] as unknown as DOMRectList
  ;(Range.prototype as unknown as { getBoundingClientRect(): DOMRect }).getBoundingClientRect =
    () => new DOMRect(0, 0, 0, 0)
}

const DOC_URI = 'file:///d%3A/notes/hover.md'
const DOC = '# 标题\n\n指向 [[目标笔记]] 的双链。\n'

describe('Live 悬停入口 spec 懒化（review-loops 第 1 轮）', () => {
  let sent: WebviewToHost[]
  let host: HTMLElement
  let controller: WebviewSyncController
  let spies: Array<ReturnType<typeof vi.spyOn>>

  beforeEach(() => {
    sent = []
    const bridge: VsCodeBridge = {
      postMessage: (m) => sent.push(m as WebviewToHost),
      getState: () => undefined,
      setState: () => undefined,
    }
    host = document.createElement('div')
    document.body.appendChild(host)
    controller = new WebviewSyncController(bridge)
    controller.mount(host)
    controller.handleHostMessage({ kind: 'init', sessionId: 's1', docUri: DOC_URI, version: 1, text: DOC })
    // spy 在 init 渲染后装配：初始装饰构建不经判定族，计数从零起
    spies = [
      vi.spyOn(liveLinks, 'activateWikilinkAtPos'),
      vi.spyOn(liveLinks, 'activateLinkAtPos'),
      vi.spyOn(liveLinks, 'activateLooseLinkAtPos'),
    ]
  })

  afterEach(() => {
    controller.dispose()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  const specCalls = (): number => spies.reduce((n, s) => n + s.mock.calls.length, 0)
  const resolveCalls = (): number =>
    sent.filter((m) => m.kind === 'hover.target.resolve').length
  const deco = (): HTMLElement | null =>
    host.querySelector<HTMLElement>('.cm-content .vsidian-wikilink')

  it('spy 自校验：完整悬停满延迟发出轻量解析请求，判定族可观测（计数 > 0）', () => {
    vi.useFakeTimers()
    const anchor = deco()
    expect(anchor).not.toBeNull()
    anchor!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    expect(specCalls()).toBe(0) // mouseover 时刻未解析（thunk 未求值）
    vi.advanceTimersByTime(DEFAULT_SHOW_DELAY_MS)
    expect(resolveCalls()).toBe(1) // 到期求值并发请求
    expect(specCalls()).toBeGreaterThan(0) // 判定族被触达（spy 可观测）
  })

  it('默认组合划过链接（快速 enter/leave）：零 spec 解析、零解析请求', () => {
    vi.useFakeTimers()
    const anchor = deco()
    expect(anchor).not.toBeNull()
    anchor!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    anchor!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })) // 计时到期前离开
    vi.advanceTimersByTime(DEFAULT_SHOW_DELAY_MS * 3)
    expect(specCalls()).toBe(0) // 离开取消计时 → thunk 永不求值
    expect(resolveCalls()).toBe(0)
  })

  it('划过不留残迹：同一链接随后完整悬停照常出提示请求（懒化不破坏正路）', () => {
    vi.useFakeTimers()
    const anchor = deco()
    expect(anchor).not.toBeNull()
    anchor!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    anchor!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))
    vi.advanceTimersByTime(DEFAULT_SHOW_DELAY_MS * 3)
    expect(specCalls()).toBe(0)
    // 划过后再完整悬停：正常解析与请求
    anchor!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    vi.advanceTimersByTime(DEFAULT_SHOW_DELAY_MS)
    expect(resolveCalls()).toBe(1)
    expect(specCalls()).toBeGreaterThan(0)
  })
})
