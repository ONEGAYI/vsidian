// 块 id 标记淡化绘制 CSS 契约（#163 验收反馈）：钉住 main.css 块 id 淡化
// 的关键规则。呈现承诺与 html-comment 同款：低对比度（正文前景色的低混
// 入比）、明暗主题同规则（跟随 --vscode-editor-foreground——相对正文色
// 变换而非锚定固定色，适配自定义字体颜色）、不隐藏不折叠（live 可读可
// 编辑；阅读侧经渲染前剥离隐藏，不经 CSS）。
import { describe, expect, it } from 'vitest'
import { cssRule, readMainCss } from './cssContract'

const css = readMainCss()

describe('块 id 标记淡化 CSS 契约（#163 验收反馈）', () => {
  it('标记 span 淡化：颜色为正文前景的低混入（color-mix，跟随明暗主题与自定义字体色）', () => {
    const body = cssRule(css, '.vsidian-block-id')
    // 口径同 .vsidian-html-comment：单一 color-mix 规则同时服务明暗主题
    expect(body).toMatch(/color:\s*color-mix\(in srgb, var\(--vscode-editor-foreground, #[0-9a-fA-F]{6}\) 4[0-9]%, transparent\)/u)
    // 淡化语义禁用隐藏/折叠手段（仍可读可编辑）
    expect(body).not.toMatch(/display|visibility|opacity:\s*0/u)
  })
  it('live 不经 CSS 隐藏标记：无 display:none 规则（阅读隐藏走渲染前剥离）', () => {
    expect(css).not.toMatch(/\.vsidian-block-id[^{]*\{[^{}]*display:\s*none/u)
  })
})
