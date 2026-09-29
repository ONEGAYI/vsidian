// 悬停预览浮层 CSS 契约（#218）：钉住 main.css 对应源规则，防止样式表
// 被误删或只剩 DOM 类名（frontmatterPaintCssContract 同模式）。真实
// computed style 与四边避障在 test/browser hoverPreview 套件验证。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(path.resolve(process.cwd(), 'src/webview/main.css'), 'utf8')

function rule(selector: string, declaration?: RegExp): string {
  const blocks = css.match(/[^{}]+\{[^{}]*\}/g) ?? []
  const found = blocks.filter((block) => block.split('{')[0]?.trim().endsWith(selector) &&
    (declaration === undefined || declaration.test(block.split('{')[1] ?? '')))
  expect(found, `CSS 规则 ${selector} 应唯一存在`).toHaveLength(1)
  return found[0]!
}

describe('悬停预览浮层 CSS 契约（#218）', () => {
  it('浮层容器：fixed 定位、默认宽 480、最大高 400、实底与投影可辨识', () => {
    const popup = rule('body > .vsidian-hover-popup')
    expect(popup).toMatch(/position:\s*fixed/)
    expect(popup).toMatch(/width:\s*480px/)
    expect(popup).toMatch(/max-height:\s*400px/)
    // 绘制层可见性：实底背景（非透明）+ 边框 + 投影
    expect(popup).toMatch(/background:\s*var\(--vscode-editor-background/)
    expect(popup).toMatch(/border:\s*1px solid var\(--vscode-panel-border/)
    expect(popup).toMatch(/box-shadow:/)
  })

  it('内容滚动区：overflow 滚动承载（移入保活可滚动）', () => {
    const scroll = rule('body > .vsidian-hover-popup .vsidian-hover-popup-scroll')
    expect(scroll).toMatch(/overflow:\s*auto/)
  })

  it('就地状态行（loading/error）在场绘制，不使用 display:none 隐藏整个浮层', () => {
    const state = rule('body > .vsidian-hover-popup .vsidian-hover-popup-state')
    expect(state).not.toMatch(/display:\s*none/)
    expect(state).toMatch(/padding/)
  })

  it('内部 Reading 容器随主题排版（字体走正文变量族）', () => {
    const content = rule('.vsidian-hover-popup .vsidian-hover-popup-scroll .vsidian-view-reading')
    expect(content).toMatch(/font-family:\s*var\(--vsidian-content-font-family/)
    expect(content).toMatch(/font-size:\s*var\(--vsidian-content-font-size/)
  })

  it('任务禁写呈现：浮层内 checkbox 不响应指针（只读契约的样式侧）', () => {
    const box = rule('.vsidian-hover-popup input\[type="checkbox"\]')
    expect(box).toMatch(/pointer-events:\s*none/)
  })
})
