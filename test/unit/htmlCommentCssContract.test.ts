// HTML 注释淡化绘制 CSS 契约（#139）：钉住 main.css 注释淡化的关键规则。
// 呈现承诺：低对比度（正文前景色的低混入比）、明暗主题同规则（跟随
// --vscode-editor-foreground）、不隐藏不折叠（无 display/visibility/replace）。
// 真实宿主/浏览器的 computed color 断言在浏览器套件 commentToggle（本契约
// 防样式表被误删或只剩类名——样式注入失效时 DOM 存在性照样通过，对比度
// 必须是 computed 可读的差异来源）。
import { describe, expect, it } from 'vitest'
import { cssRule, readMainCss } from './cssContract'

const css = readMainCss()

describe('HTML 注释淡化 CSS 契约（#139）', () => {
  it('注释 span 淡化：颜色为正文前景的低混入（color-mix，跟随明暗主题）', () => {
    const body = cssRule(css, '.vsidian-html-comment')
    // 与 --vsidian-hr-color 同款的 color-mix 口径：单一规则同时服务明暗
    // 主题（前景变量随主题翻转，混入比固定）
    expect(body).toMatch(/color:\s*color-mix\(in srgb, var\(--vscode-editor-foreground, #[0-9a-fA-F]{6}\) 4[0-9]%, transparent\)/u)
    // 淡化语义禁用隐藏/折叠手段（仍可读）
    expect(body).not.toMatch(/display|visibility|opacity:\s*0/u)
  })

  it('注释不隐藏内容：无针对注释区间的隐藏规则（防退化成折叠）', () => {
    expect(css).not.toMatch(/\.vsidian-html-comment[^{]*\{[^{}]*display:\s*none/u)
  })
})
