// 跳转目标高亮绘制 CSS 契约（#163 验收反馈）：半透黄背景颜色必须经
// --vsidian-anchor-flash-background 变量暴露（用户可覆盖的 CSS 接口），
// 变量定义于 #app（两视图共用一处定义）；live 与 reading 分视图规则
// 同引该变量（类名 vsidian-anchor-flash 跨视图同口径）。
import { describe, expect, it } from 'vitest'
import { cssRule, readMainCss } from './cssContract'

const css = readMainCss()

describe('跳转目标高亮 CSS 契约（#163 验收反馈）', () => {
  it('live 行级规则：背景引用暴露变量（不得硬编码颜色）', () => {
    const rule = cssRule(css, '.cm-line.vsidian-anchor-flash')
    expect(rule).toMatch(/background:\s*var\(--vsidian-anchor-flash-background\)/u)
    expect(rule).not.toMatch(/rgba?\(|#[0-9a-fA-F]{3,8}/u)
  })
  it('reading 块级规则：同一变量（跨视图同口径）', () => {
    const rule = cssRule(css, '.vsidian-view-reading .vsidian-anchor-flash')
    expect(rule).toMatch(/background:\s*var\(--vsidian-anchor-flash-background\)/u)
  })
  it('变量定义在 #app（半透黄默认值，可被用户覆盖）', () => {
    expect(css).toMatch(/#app\s*\{[^{}]*--vsidian-anchor-flash-background:\s*(?:rgba?\([^)]*\)|#[0-9a-fA-F]{3,8})/u)
  })
})
