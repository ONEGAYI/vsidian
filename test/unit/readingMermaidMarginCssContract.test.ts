// 阅读 mermaid 块限宽居中契约（2026-10 修复）：限宽档（#175）下块居中
// 依赖 .vsidian-reading-block 的 margin: 0 auto；mermaid 块类规则
// （#60 起 margin: 0，纵向间距交给内层 .vsidian-mermaid 容器）与块基类
// 同挂在块 div 上且源序更靠后——同特异性下其 margin 简写若不含水平
// auto，会覆盖块居中 auto，限宽档 mermaid 贴左而正文居中（铺满档 auto
// 与 0 等价不可见；#206 标题块水平盒禁令的同族缺陷，mermaid 变体）。
// 契约：mermaid 块规则保持 margin: 0 auto（水平居中、纵向 0 交内层），
// 且不得出现显式水平 margin 声明（margin-left/right/inline* 置值会再次
// 杀掉 auto）。浏览器层左缘一致证据在 readingWidthProbe A7b。
import { describe, expect, it } from 'vitest'
import { cssRule, readMainCss } from './cssContract'

/** 显式水平 margin 属性（简写含 auto 之外的直接覆盖形态） */
const EXPLICIT_HORIZONTAL_MARGIN =
  /(^|[^-\w])margin-(?:left|right|inline(?:-start|-end)?)\s*:/i

describe('阅读 mermaid 块限宽居中契约', () => {
  it('vsidian-reading-mermaid 规则保持 margin: 0 auto（纵向 0 交内层容器）', () => {
    const body = cssRule(readMainCss(), '.vsidian-view-reading .vsidian-reading-mermaid')
    expect(body, 'mermaid 块规则必须保持 margin: 0 auto——水平 auto 被同特异性源序在后的简写抹掉即限宽档贴左').toMatch(
      /margin:\s*0\s+auto\s*;/,
    )
  })

  it('vsidian-reading-mermaid 规则不得声明显式水平 margin（防再次覆盖居中）', () => {
    const body = cssRule(readMainCss(), '.vsidian-view-reading .vsidian-reading-mermaid')
    expect(
      EXPLICIT_HORIZONTAL_MARGIN.test(body),
      `显式水平 margin 会在同特异性下覆盖居中 auto：${body.trim()}`,
    ).toBe(false)
  })
})
