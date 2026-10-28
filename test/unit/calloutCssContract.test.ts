// Callout CSS 契约（#653/T02）：钉住 main.css 的 callout 变量族、类型
// 变量表、双通道背景与「callout 替代该层引用紫条」边界（T01 报告 §5.4
// 四项实施边界的 CSS 落点）。用户看到的东西（AGENTS 视觉层断言）：外框
// 底色/圆角/标题字重/图标可见性由浏览器 calloutPaint 的 computed 断言
// 兜底，本契约在源头钉住规则形态——样式被误删时先在此失败。
import { describe, expect, it } from 'vitest'
import { cssRule, cssRuleExact, readMainCss } from './cssContract'

const css = readMainCss()

describe('callout 变量族（Obsidian 原名即公开入口）', () => {
  it('#app 定义暗色档默认值（note 色 #027aff、radius 4px、边框宽 0）', () => {
    const app = cssRuleExact(css, '#app')
    expect(app).toMatch(/--callout-radius:\s*4px/)
    expect(app).toMatch(/--callout-default:\s*#027aff/)
    expect(app).toMatch(/--callout-color:\s*var\(--callout-default\)/)
    expect(app).toMatch(/--callout-border-width:\s*0px/)
    expect(app).toMatch(/--callout-content-background:\s*transparent/)
  })

  it('亮色主题覆盖 note 色（#086ddd）', () => {
    const light = cssRule(css, 'body.vscode-light #app')
    expect(light).toMatch(/--callout-default:\s*#086ddd/)
  })

  it('类型变量表以 :where() 零特异性承载（T01 边界 1：行元素无内联变量）', () => {
    const note = cssRule(css, ":where([data-callout='note'])")
    expect(note).toMatch(/--callout-color:\s*var\(--callout-default\)/)
    // 零特异性承诺：规则以 :where 起头（无 #app 等特异性来源前缀——
    // 契约解析器会把前置块注释并入 selector，故按行首锚定断言）
    expect(css).toMatch(/\n:where\(\[data-callout='note'\]\)\s*\{/)
  })

  it('行级类不携带内联 style 变量（增量发射的 data-callout 属性不带 style）', () => {
    // 契约口径：行装饰 attributes 只有 data-callout（+既有网格属性）；
    // 本测试钉 CSS 侧不消费 --callout-color 以外的行内注入面——变量只
    // 经 :where 类型表与 #app 默认值两处定义
    const defs = css.match(/--callout-color:\s*[^;]+;/g) ?? []
    expect(defs.filter((d) => !/var\(--callout-default\)/.test(d))).toHaveLength(0)
  })
})

describe('live 行级形态：替代紫条与双通道底色', () => {
  const liveQuiet = () => cssRule(css, '.vsidian-quote-line.callout.vsidian-callout-quiet')

  it('quiet 行抑制引用紫条并画双通道底色（拆属性双通道，T01 §6.2）', () => {
    const rule = liveQuiet()
    expect(rule).toMatch(/box-shadow:\s*none/)
    expect(rule).toMatch(/background-color:\s*rgba\(var\(--callout-color\),\s*0?\.1\)/)
    expect(rule).toMatch(/background-image:\s*linear-gradient\(\s*color-mix\(in oklch, var\(--callout-color\) 10%, transparent\)/)
  })

  it('普通引用行紫条规则不被改动（callout 接入不回归引用契约）', () => {
    const quote = cssRule(css, '#app .cm-editor .cm-scroller .vsidian-quote-line')
    expect(quote).toMatch(/box-shadow:\s*inset 3px 0 0 var\(--vsidian-quote-bar-color\)/)
  })

  it('首末行圆角分角（单行容器两类同挂自然合成全圆角）', () => {
    const first = cssRule(css, '.vsidian-quote-line.vsidian-callout-first')
    expect(first).toMatch(/border-top-left-radius:\s*var\(--callout-radius\)/)
    expect(first).toMatch(/border-top-right-radius:\s*var\(--callout-radius\)/)
    const last = cssRule(css, '.vsidian-quote-line.vsidian-callout-last')
    expect(last).toMatch(/border-bottom-left-radius:\s*var\(--callout-radius\)/)
    expect(last).toMatch(/border-bottom-right-radius:\s*var\(--callout-radius\)/)
  })

  it('标题行字重与图标 mask（Obsidian 默认铅笔形）', () => {
    const title = cssRule(css, '.vsidian-quote-line.callout-title')
    expect(title).toMatch(/font-weight:\s*var\(--callout-title-weight\)/)
    const icon = cssRule(css, '#app .callout-icon')
    expect(icon).toMatch(/mask:\s*url\("data:image\/svg\+xml/)
    expect(icon).toMatch(/background-color:\s*var\(--callout-color\)/)
  })
})

describe('阅读侧真实容器', () => {
  it('div.callout 容器：padding/radius 与双通道底色（与 live 同变量）', () => {
    const rule = cssRule(css, '#app .vsidian-view-reading .vsidian-reading-block div.callout')
    expect(rule).toMatch(/padding:\s*var\(--callout-padding\)/)
    expect(rule).toMatch(/border-radius:\s*var\(--callout-radius\)/)
    expect(rule).toMatch(/background-color:\s*rgba\(var\(--callout-color\),\s*0?\.1\)/)
    expect(rule).toMatch(/background-image:\s*linear-gradient\(\s*color-mix\(in oklch, var\(--callout-color\) 10%, transparent\)/)
  })

  it('.callout-title / .callout-content 消费标题与正文变量', () => {
    const title = cssRule(css, '#app .vsidian-view-reading .vsidian-reading-block .callout-title')
    expect(title).toMatch(/font-weight:\s*var\(--callout-title-weight\)/)
    const content = cssRule(css, '#app .vsidian-view-reading .vsidian-reading-block .callout-content')
    expect(content).toMatch(/padding:\s*var\(--callout-content-padding\)/)
    expect(content).toMatch(/background:\s*var\(--callout-content-background\)/)
  })
})
