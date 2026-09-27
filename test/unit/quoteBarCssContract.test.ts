// 引用块紫色提示边条 CSS 契约（#143）：钉住「#app 定义 + 亮色覆盖 + 两侧
// 同引」——变量族形态沿用 heading-color 先例（outlineCssContract 同款钉法）。
// 用户看到的东西（AGENTS 视觉层断言）：竖条颜色明显为紫且两侧一致；样式表
// 被误删或只剩 DOM 类名时，浏览器 quoteBarPaint 的 computed 断言失去差异
// 来源，本契约先在源头钉住。
import { describe, expect, it } from 'vitest'
import { cssRule, cssRuleExact, readMainCss } from './cssContract'

const css = readMainCss()

describe('引用块提示竖条变量族（#143）', () => {
  it('#app 定义暗色档默认值（a78bfa），亮色主题分支覆盖深紫（7c3aed）', () => {
    // exact 取 #app 本体（后缀匹配会被亮色覆盖规则干扰）；亮色分支前有注释，
    // 按先例用后缀匹配（highlightCssContract 同款组合）
    const app = cssRuleExact(css, '#app')
    expect(app).toMatch(/--vsidian-quote-bar-color:\s*#a78bfa/)
    const light = cssRule(css, 'body.vscode-light #app')
    expect(light).toMatch(/--vsidian-quote-bar-color:\s*#7c3aed/)
  })

  it('定义唯一：竖条色变量不在 #app / 亮色分支之外重复定义', () => {
    const defs = css.match(/--vsidian-quote-bar-color:\s*[^;]+;/g) ?? []
    expect(defs).toHaveLength(2)
  })

  it('live 引用行竖条引用变量，且背景底维持 VSCode 灰调（不新增紫色背景）', () => {
    const live = cssRule(css, '#app .cm-editor .cm-scroller .vsidian-quote-line')
    expect(live).toMatch(/box-shadow:\s*inset 3px 0 0 var\(--vsidian-quote-bar-color\)/)
    expect(live).toMatch(/background-color:\s*var\(--vscode-textBlockQuote-background/)
    expect(live).not.toMatch(/--vsidian-quote-bar-color:\s*[^)]*background/)
  })

  it('阅读 blockquote 左竖条同引变量（两侧一致的颜色来源），背景底不变', () => {
    const reading = cssRule(css, '#app .vsidian-view-reading .vsidian-reading-block blockquote')
    expect(reading).toMatch(/border-left:\s*3px solid var\(--vsidian-quote-bar-color\)/)
    expect(reading).toMatch(/background-color:\s*var\(--vscode-textBlockQuote-background/)
  })

  it('旧灰调竖条消费已退场：两处规则不再引用 --vscode-textBlockQuote-border', () => {
    const live = cssRule(css, '#app .cm-editor .cm-scroller .vsidian-quote-line')
    const reading = cssRule(css, '#app .vsidian-view-reading .vsidian-reading-block blockquote')
    expect(live).not.toMatch(/textBlockQuote-border/)
    expect(reading).not.toMatch(/textBlockQuote-border/)
  })
})
