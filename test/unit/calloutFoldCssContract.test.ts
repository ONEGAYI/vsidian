// Callout 折叠 CSS 契约（#655/T04）：钉住 main.css 的 .callout-fold 箭头
// 基座（Live widget 与阅读注入共用）、is-collapsed 收起呈现（Live 标题行
// 下圆角 / 阅读正文 display:none）与 is-collapsible 状态类口径（T01 固定
// 口径——Obsidian 原名状态类；状态源是 calloutFoldField，类只是呈现消费
// 面）。用户看到的东西（AGENTS 视觉层断言）：收起后正文不可见、标题可
// 见、箭头状态正确由浏览器 calloutFold 的 computed/paint 断言兜底，本
// 契约在源头钉住规则形态——样式被误删时先在此失败。
import { describe, expect, it } from 'vitest'
import { cssRule, readMainCss } from './cssContract'

const css = readMainCss()

describe('callout 折叠箭头（.callout-fold）', () => {
  it('#app 基座：inline-flex 控件形态、类型色、透明背景（Live 行尾 widget 与阅读标题尾部共用）', () => {
    const base = cssRule(css, '#app .callout-fold')
    expect(base).toMatch(/display:\s*inline-flex/)
    expect(base).toMatch(/background:\s*transparent/)
    expect(base).toMatch(/color:\s*var\(--callout-color\)/)
    expect(base).toMatch(/cursor:\s*pointer/)
  })

  it('收起态箭头右向（rotate -90deg，T01 口径 is-collapsed 双挂的 fold 元素侧）', () => {
    const collapsed = cssRule(css, '#app .callout-fold.is-collapsed svg')
    expect(collapsed).toMatch(/rotate\(-90deg\)/)
  })
})

describe('callout 收起呈现（is-collapsed）', () => {
  it('Live 行级形态：收起标题行补下圆角（容器末行已被 replace 隐藏）', () => {
    const rule = cssRule(css, '.vsidian-quote-line.callout-title.is-collapsed')
    expect(rule).toMatch(/border-bottom-left-radius:\s*var\(--callout-radius\)/)
    expect(rule).toMatch(/border-bottom-right-radius:\s*var\(--callout-radius\)/)
  })

  it('阅读真实容器：收起时正文不绘制（display:none）', () => {
    const rule = cssRule(css, '.vsidian-reading-block div.callout.is-collapsed > .callout-content')
    expect(rule).toMatch(/display:\s*none/)
  })
})
