// #343（P3-11）不可信子页消息来源判定契约：在场 .vsidian-hover-web-frame
// iframe 的 contentWindow 是唯一被否定的 message 来源；脱树即出局（无
// 悬空注册）；非窗口来源（宿主桥常见的 source=null）不受影响。
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { isUntrustedMessageSource, untrustedFrameWindowCount } from '../../src/webview/untrustedFrame'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('#343 不可信 iframe 消息来源判定', () => {
  it('在场 iframe 的 contentWindow 被判定为不可信来源', () => {
    const iframe = document.createElement('iframe')
    iframe.className = 'vsidian-hover-web-frame'
    document.body.appendChild(iframe)
    expect(untrustedFrameWindowCount()).toBe(1)
    expect(isUntrustedMessageSource(iframe.contentWindow)).toBe(true)
    iframe.remove()
  })

  it('iframe 移除后其窗口不再命中（脱树出局，无悬空注册）', () => {
    const iframe = document.createElement('iframe')
    iframe.className = 'vsidian-hover-web-frame'
    document.body.appendChild(iframe)
    const win = iframe.contentWindow
    iframe.remove()
    expect(untrustedFrameWindowCount()).toBe(0)
    expect(isUntrustedMessageSource(win)).toBe(false)
  })

  it('无 iframe 在场时零计数', () => {
    expect(untrustedFrameWindowCount()).toBe(0)
  })

  it('非窗口来源（null/对象/无关注口的 Window）不受影响', () => {
    const other = document.createElement('iframe') // 不带 web-frame 类
    other.className = 'some-other-frame'
    document.body.appendChild(other)
    expect(isUntrustedMessageSource(null)).toBe(false)
    expect(isUntrustedMessageSource({})).toBe(false)
    expect(isUntrustedMessageSource(undefined)).toBe(false)
    expect(isUntrustedMessageSource(other.contentWindow)).toBe(false)
    other.remove()
  })
})
