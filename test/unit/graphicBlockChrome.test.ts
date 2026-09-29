// @vitest-environment jsdom
// markImageFrameSized 的监听驱动契约（#212 贴图收缩标记，review-loops
// P3-4 回归钉住）：jsdom 无布局（rect 恒 0、无 ResizeObserver），恰好
// 覆盖「无布局环境的退化分支不抛异常」；挂/摘的几何判定本身由浏览器
// 测试（imagePopup 17c/17d/17e/25/26）承担，这里钉事件语义——load 常
// 驻驱动重算、error 即摘（成功→失效→重取失败链上 error 框不窄化）。
import { describe, expect, it } from 'vitest'
import { markImageFrameSized, GRAPHIC_CHROME_CLASS_NAMES } from '../../src/webview/graphicBlockChrome'
import { IMAGE_CLASS_NAMES } from '../../src/webview/imageResource'

function mount(): { frame: HTMLElement; img: HTMLImageElement } {
  const host = document.createElement('div')
  const frame = document.createElement('span')
  frame.className = `${GRAPHIC_CHROME_CLASS_NAMES.frame} ${IMAGE_CLASS_NAMES.image}`
  const img = document.createElement('img')
  frame.appendChild(img)
  host.appendChild(frame)
  document.body.appendChild(host)
  return { frame, img }
}

describe('markImageFrameSized 事件驱动契约', () => {
  it('无布局环境（jsdom 无 RO、rect 恒 0）调用不抛异常且不挂类', () => {
    const { frame, img } = mount()
    expect(() => markImageFrameSized(frame, img)).not.toThrow()
    expect(frame.classList.contains(IMAGE_CLASS_NAMES.sized)).toBe(false)
  })

  it('load 事件常驻驱动重算（jsdom 无布局 → 重算结果为摘）', () => {
    const { frame, img } = mount()
    frame.classList.add(IMAGE_CLASS_NAMES.sized)
    markImageFrameSized(frame, img)
    img.dispatchEvent(new Event('load'))
    // 无布局环境重算结果恒为摘（available 为 0 或 NaN——jsdom 的
    // computed padding 可能返回空串走 parseFloat('')，两种路径比较
    // 同为 false）——证明 load 监听在场并驱动了 apply
    expect(frame.classList.contains(IMAGE_CLASS_NAMES.sized)).toBe(false)
  })

  it('error 即摘（成功→失效→重取失败链上 sized 不残留）', () => {
    const { frame, img } = mount()
    frame.classList.add(IMAGE_CLASS_NAMES.sized)
    markImageFrameSized(frame, img)
    img.dispatchEvent(new Event('error'))
    expect(frame.classList.contains(IMAGE_CLASS_NAMES.sized)).toBe(false)
  })
})
