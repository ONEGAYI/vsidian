// 行内原生 HTML 的 CSS 契约（#568/T03）：Live 行内宿主的关键绘制规则钉
// 在 CSS 源文本（样式契约 live-inline-html-widget / reading-inline-html
// 条目的规则形态防线——样式注入失效或规则误删时 computed 断言在 headless
// 下不可靠，规则形态钉住与 liveHtmlCssContract 同款纪律）：
// - Live 宿主行内化（display:inline——行内混排不隐藏前后正文的前提）
// - 行内降级源码回退的等宽呈现（span.vsidian-html-source-fallback，
//   Live 宿主与 Reading 段落两侧）
import { describe, expect, it } from 'vitest'
import { cssRule, readMainCss } from './cssContract'

const css = readMainCss()

describe('Live 行内 HTML 宿主绘制规则（live-inline-html-widget 条目）', () => {
  it('宿主行内化（display:inline——前后正文同行流不断行）', () => {
    const rule = cssRule(css, '#app .cm-editor .cm-content .vsidian-live-inline-html')
    expect(rule).toMatch(/display:\s*inline/)
  })

  it('行内降级源码回退等宽呈现（span 回退，Live 侧与 Reading 段落内共组）', () => {
    // 两选择器共组一条规则（cssRule 按后缀匹配只取组尾选择器）——组尾
    // 查声明体，组首存在性钉在源文本（liveHtmlCssContract 同款纪律）
    const tail = cssRule(css, '#app .vsidian-view-reading span.vsidian-html-source-fallback')
    expect(tail).toMatch(/font-family:\s*var\(--vscode-editor-font-family/)
    expect(tail).toMatch(/white-space:\s*pre-wrap/)
    expect(css).toContain('#app .vsidian-live-inline-html .vsidian-html-source-fallback,')
  })
})
