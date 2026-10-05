// #343（P3-11）宿主消息来源允许清单契约：仅放行真宿主桥来源（身份层
// window/parent + 来源层 origin 等值），拒绝其余一切——原网页 iframe
//（直接子帧/嵌套帧/已移除旧引用）、不透明源 'null'、攻击者源全部落选。
// 真宿主实测形态（poster 身份不可达、origin === window.origin）单独钉
// 住；行为级证据（真宿主 init 不被误拒）由集成 core 分片承担。
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { isTrustedHostMessageSource, untrustedFrameWindowCount } from '../../src/webview/untrustedFrame'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('#343 宿主消息来源允许清单（身份层）', () => {
  it('window 自身放行（单帧环境 parent === window，宿主桥退化形态）', () => {
    expect(isTrustedHostMessageSource(window, window.origin)).toBe(true)
    expect(isTrustedHostMessageSource(window, 'null')).toBe(true)
    expect(window.parent).toBe(window)
  })
})

describe('#343 宿主消息来源允许清单（来源层：真宿主实测形态）', () => {
  it('身份不可达的同源 Window + origin 等值放行（真宿主 1.82.3 实测：宿主桥 poster 与 window/parent/top 均不同一）', () => {
    const unreachableWindow = { marker: 'host-bridge-window' }
    expect(isTrustedHostMessageSource(unreachableWindow, window.origin)).toBe(true)
  })

  it('同源判定要求 origin 逐字符等值：其它源拒绝', () => {
    const src = { marker: 'window' }
    expect(isTrustedHostMessageSource(src, 'null')).toBe(false)
    expect(isTrustedHostMessageSource(src, 'https://evil.example')).toBe(false)
    expect(isTrustedHostMessageSource(src, `${window.origin}/`)).toBe(false)
  })
})

describe('#343 宿主消息来源允许清单（拒绝矩阵）', () => {
  it('直接子 iframe 的 contentWindow 拒绝（沙箱不透明源形态）', () => {
    const iframe = document.createElement('iframe')
    iframe.className = 'vsidian-hover-web-frame'
    document.body.appendChild(iframe)
    expect(untrustedFrameWindowCount()).toBe(1)
    // 生产形态：sandbox 无 allow-same-origin → origin 'null'
    expect(isTrustedHostMessageSource(iframe.contentWindow, 'null')).toBe(false)
    expect(isTrustedHostMessageSource(iframe.contentWindow, 'https://evil.example')).toBe(false)
  })

  it('嵌套 iframe 的窗口拒绝（恶意页内再嵌一层——孙代 window 身份与 origin 双落选）', () => {
    const outer = document.createElement('iframe')
    document.body.appendChild(outer)
    const nested = outer.contentDocument?.createElement('iframe')
    if (nested) {
      outer.contentDocument?.body.appendChild(nested)
    }
    // 嵌套 contentWindow 不可得时退化为另一独立 iframe 的窗口——语义
    // 相同：非 window/parent 的任意 Window 且 origin 非本源，一律落选
    const unknownWindow = nested?.contentWindow ?? (() => {
      const other = document.createElement('iframe')
      document.body.appendChild(other)
      return other.contentWindow
    })()
    expect(unknownWindow).toBeTruthy()
    expect(isTrustedHostMessageSource(unknownWindow, 'null')).toBe(false)
    expect(isTrustedHostMessageSource(unknownWindow, 'https://evil.example')).toBe(false)
    // 外层 iframe 的窗口同样落选
    expect(isTrustedHostMessageSource(outer.contentWindow, 'null')).toBe(false)
  })

  it('已移除 iframe 的旧 contentWindow 引用拒绝（移除前入队消息的移除后派发向量）', () => {
    const iframe = document.createElement('iframe')
    iframe.className = 'vsidian-hover-web-frame'
    document.body.appendChild(iframe)
    const stale = iframe.contentWindow
    iframe.remove()
    expect(untrustedFrameWindowCount()).toBe(0)
    expect(isTrustedHostMessageSource(stale, 'null')).toBe(false)
  })

  it('非窗口来源（null/undefined/普通对象）在非本源 origin 下拒绝', () => {
    expect(isTrustedHostMessageSource(null, 'null')).toBe(false)
    expect(isTrustedHostMessageSource(undefined, 'null')).toBe(false)
    expect(isTrustedHostMessageSource({}, 'null')).toBe(false)
    expect(isTrustedHostMessageSource({ port: 1 }, 'https://evil.example')).toBe(false)
  })
})

describe('#343 不透明源环境（origin 均为 null 的零区分度场景）', () => {
  it("本帧 origin 为 'null' 时来源层整体禁用：仅身份层兜底（沙箱 iframe 同为 null 不可借此放行）", () => {
    const originDescriptor = Object.getOwnPropertyDescriptor(window, 'origin')
      ?? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(window), 'origin')
    expect(originDescriptor).toBeTruthy()
    Object.defineProperty(window, 'origin', { value: 'null', configurable: true })
    try {
      // 身份层仍可用
      expect(isTrustedHostMessageSource(window, 'null')).toBe(true)
      // 来源层禁用：身份不可达的来源即便 origin 同为 'null' 也不放行
      expect(isTrustedHostMessageSource({ marker: 'window' }, 'null')).toBe(false)
      const hostile = document.createElement('iframe')
      document.body.appendChild(hostile)
      expect(isTrustedHostMessageSource(hostile.contentWindow, 'null')).toBe(false)
      hostile.remove()
    } finally {
      // 还原被覆盖的 origin（afterEach 的 innerHTML 清理之外补齐）
      if (originDescriptor) {
        Object.defineProperty(window, 'origin', originDescriptor)
      }
    }
  })
})
