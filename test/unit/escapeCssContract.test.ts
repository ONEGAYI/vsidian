// 转义符通用显隐 CSS 契约（验收反馈通用化）：钉住 main.css 的通用转义
// 规则——默认隐藏（所见 = 字面字符）与触及行浅色显形（正文前景低混入、
// 跟随明暗主题，口径同块 id 淡化与表格转义专用规则）。
import { describe, expect, it } from 'vitest'
import { cssRule, readMainCss } from './cssContract'

const css = readMainCss()

describe('转义符通用显隐 CSS 契约', () => {
  it('默认隐藏：反斜杠 display:none（渲染为字面字符）', () => {
    const rule = cssRule(css, '#app .cm-editor .cm-scroller .vsidian-escape')
    expect(rule).toMatch(/display:\s*none/u)
  })

  it('触及行浅色显形：恢复文本流 + 正文前景低混入（color-mix，跟随主题）', () => {
    const rule = cssRule(css, '#app .cm-editor .cm-scroller .vsidian-escape-reveal')
    expect(rule).toMatch(/display:\s*inline/u)
    expect(rule).toMatch(/color:\s*color-mix\(in srgb, var\(--vscode-editor-foreground, #[0-9a-fA-F]{6}\) 4[0-9]%, transparent\)/u)
  })

  it('表格转义专用规则保留（#42 契约不回归）', () => {
    expect(cssRule(css, '.vsidian-table-escaped-pipe')).toMatch(/display:\s*none/u)
    expect(cssRule(css, '.vsidian-table-escaped-pipe-reveal')).toMatch(/display:\s*inline/u)
  })
})
