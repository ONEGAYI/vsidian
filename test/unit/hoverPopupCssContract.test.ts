// 悬停预览浮层 CSS 契约（#218）：钉住 main.css 对应源规则，防止样式表
// 被误删或只剩 DOM 类名（frontmatterPaintCssContract 同模式）。真实
// computed style 与四边避障在 test/browser hoverPreview 套件验证。
// #220 扩展：浮层挂 #app（主题变量与正文样式天然命中）+ 笔记属性区
// （hover-fm-section）折叠/热区/键盘聚焦规则。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(path.resolve(process.cwd(), 'src/webview/main.css'), 'utf8')
  .replace(/\r\n/g, '\n')

function rule(selector: string, declaration?: RegExp): string {
  const blocks = css.match(/[^{}]+\{[^{}]*\}/g) ?? []
  const found = blocks.filter((block) => block.split('{')[0]?.trim().endsWith(selector) &&
    (declaration === undefined || declaration.test(block.split('{')[1] ?? '')))
  expect(found, `CSS 规则 ${selector} 应唯一存在`).toHaveLength(1)
  return found[0]!
}

describe('悬停预览浮层 CSS 契约（#218）', () => {
  it('浮层容器：fixed 定位、默认宽 480、最大高 400、实底与投影可辨识', () => {
    const popup = rule('#app > .vsidian-hover-popup')
    expect(popup).toMatch(/position:\s*fixed/)
    expect(popup).toMatch(/width:\s*480px/)
    expect(popup).toMatch(/max-height:\s*400px/)
    // 绘制层可见性：实底背景（非透明）+ 边框 + 投影
    expect(popup).toMatch(/background:\s*var\(--vscode-editor-background/)
    expect(popup).toMatch(/border:\s*1px solid var\(--vscode-panel-border/)
    expect(popup).toMatch(/box-shadow:/)
  })

  it('内容滚动区：overflow 滚动承载（移入保活可滚动）', () => {
    const scroll = rule('#app > .vsidian-hover-popup .vsidian-hover-popup-scroll')
    expect(scroll).toMatch(/overflow:\s*auto/)
  })

  it('就地状态行（loading/error）在场绘制，不使用 display:none 隐藏整个浮层', () => {
    const state = rule('#app > .vsidian-hover-popup .vsidian-hover-popup-state')
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

describe('悬停浮层笔记属性区 CSS 契约（#220）', () => {
  it('标题行是悬停热区（position:relative 承载绝对定位按钮）', () => {
    const header = rule('.vsidian-hover-popup .vsidian-hover-fm .vsidian-fm-header')
    expect(header).toMatch(/position:\s*relative/)
  })

  it('切换按钮默认透明不接指针（opacity/pointer-events，非整体隐藏——保留 Tab 可达）', () => {
    const btn = rule('.vsidian-hover-popup .vsidian-hover-fm-toggle')
    expect(btn).toMatch(/opacity:\s*0/)
    expect(btn).toMatch(/pointer-events:\s*none/)
    expect(btn, '不得用整体隐藏类声明（会把按钮移出 Tab 序）').not.toMatch(/visibility:/)
  })

  it('悬停热区与键盘聚焦都显示按钮并接指针（:hover 标题行 + :focus-visible 按钮）', () => {
    const reveal = rule(
      '.vsidian-hover-popup .vsidian-hover-fm .vsidian-fm-header:hover .vsidian-hover-fm-toggle,\n.vsidian-hover-popup .vsidian-hover-fm-toggle:focus-visible',
      /pointer-events:\s*auto/,
    )
    expect(reveal).toMatch(/opacity:\s*1/)
  })

  it('键盘聚焦可见性带焦点轮廓（focus-visible outline）', () => {
    const focus = rule('.vsidian-hover-popup .vsidian-hover-fm-toggle:focus-visible', /outline:/)
    expect(focus).toMatch(/outline:\s*1px solid/)
  })

  it('收起态隐藏属性行与降级源码块（display:none；标题行保留）', () => {
    const rows = rule(
      '#app .vsidian-hover-popup .vsidian-hover-fm.vsidian-hover-fm-collapsed .vsidian-fm-row',
    )
    expect(rows).toMatch(/display:\s*none/)
    const pre = rule(
      '#app .vsidian-hover-popup .vsidian-hover-fm.vsidian-hover-fm-collapsed > pre',
    )
    expect(pre).toMatch(/display:\s*none/)
  })

  it('chevron 收起态旋转（-90° 指向右 = 可展开）', () => {
    const chevron = rule('.vsidian-hover-popup .vsidian-hover-fm-collapsed .vsidian-hover-fm-toggle svg')
    expect(chevron).toMatch(/rotate\(-90deg\)/)
  })
})

describe('错误分态样式区分（验收反馈）', () => {
  it('错误状态行挂错误修饰类：主题错误色（与 loading 描述色区分）', () => {
    const error = rule('#app > .vsidian-hover-popup .vsidian-hover-popup-state-error')
    expect(error).toMatch(/color:\s*var\(--vscode-errorForeground/)
  })
})
