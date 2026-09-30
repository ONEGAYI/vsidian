// 嵌入卡片 CSS 契约（#222）：钉住 main.css 的卡片壳/边条/限高/占位行/
// 只读 checkbox 源规则，防止样式表被误删或只剩 DOM 类名（hoverPopupCssContract
// 同模式）。真实 computed style、限高滚动与视口回收在 test/browser
// readingEmbed 套件验证。
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

describe('嵌入卡片 CSS 契约（#222；#223 起卡片壳规则并列 Live 宿主）', () => {
  it('卡片壳：左引用边条 + 边框 + 圆角 + 微底色（引用块样式边条的可辨识绘制）', () => {
    // #223 两选择器并列（Reading 块 + Live widget 宿主同款绘制）；组以
    // Live 选择器置尾，断言组文本同时包含两侧选择器
    const card = rule('#app .cm-editor .cm-content .vsidian-live-embed .vsidian-embed-card')
    expect(card).toMatch(/border-left:\s*3px solid var\(--vsidian-quote-bar-color\)/)
    expect(card).toMatch(/border:\s*1px solid var\(--vscode-panel-border/)
    expect(card).toMatch(/border-radius:/)
    expect(card).toMatch(/background-color:\s*var\(--vscode-textBlockQuote-background/)
    expect(card.split('{')[0])
      .toContain('#app .vsidian-view-reading .vsidian-reading-embed .vsidian-embed-card')
  })

  it('#223 Live 下方形态宿主：块级呈现（显形态源文行下方的独立块）', () => {
    const below = rule('#app .cm-editor .cm-content .vsidian-live-embed-below')
    expect(below).toMatch(/display:\s*block/)
  })

  it('顶部栏与文件名：横排布局（标题居左、入口居右）、文件名走描述色', () => {
    const header = rule('#app .vsidian-embed-card .vsidian-embed-card-header')
    expect(header).toMatch(/display:\s*flex/)
    expect(header).toMatch(/justify-content:\s*space-between/)
    const title = rule('#app .vsidian-embed-card .vsidian-embed-card-title')
    expect(title).toMatch(/color:\s*var\(--vscode-descriptionForeground/)
  })

  it('右上角打开入口：图标按钮尺寸与 hover/focus 可见反馈', () => {
    const open = rule('#app .vsidian-embed-card .vsidian-embed-card-open')
    expect(open).toMatch(/cursor:\s*pointer/)
    const hover = rule(
      '#app .vsidian-embed-card .vsidian-embed-card-open:hover,\n#app .vsidian-embed-card .vsidian-embed-card-open:focus-visible',
    )
    expect(hover).toMatch(/border-color:/)
  })

  it('内容滚动区：限高缺省 480 与内部滚动（长内容不撑破正文流）', () => {
    const scroll = rule('#app .vsidian-embed-card .vsidian-embed-card-scroll')
    expect(scroll).toMatch(/overflow:\s*auto/)
    expect(scroll).toMatch(/max-height:\s*480px/)
  })

  it('就地状态行：在场绘制文案（loading/错误分态不隐藏整个卡片）', () => {
    const state = rule('#app .vsidian-embed-card .vsidian-embed-card-state')
    expect(state).not.toMatch(/display:\s*none/)
    expect(state).toMatch(/padding/)
    expect(state).toMatch(/color:\s*var\(--vscode-descriptionForeground/)
  })

  it('只读契约：卡片内任务 checkbox 不响应指针（与悬停浮层同款并列规则）', () => {
    // 并列组以既有浮层选择器置尾（hoverPopupCssContract 的 endsWith 契约
    // 零改动通过）；嵌入作用域在组首，按组文本包含断言
    const box = rule('.vsidian-hover-popup input\[type="checkbox"\]')
    expect(box).toMatch(/pointer-events:\s*none/)
    expect(box.split('{')[0]).toContain('.vsidian-embed-card input[type="checkbox"]')
  })

  it('属性区折叠规则覆盖嵌入卡片作用域（fm 折叠键规则在卡片内同样生效）', () => {
    const collapsedRow = rule('#app .vsidian-hover-popup .vsidian-hover-fm.vsidian-hover-fm-collapsed .vsidian-fm-row')
    expect(collapsedRow).toMatch(/display:\s*none/)
    expect(collapsedRow.split('{')[0])
      .toContain('#app .vsidian-embed-card .vsidian-hover-fm.vsidian-hover-fm-collapsed .vsidian-fm-row')
    const toggle = rule('.vsidian-hover-popup .vsidian-hover-fm-toggle')
    expect(toggle).toMatch(/opacity:\s*0/)
    expect(toggle).toMatch(/pointer-events:\s*none/)
    expect(toggle.split('{')[0]).toContain('.vsidian-embed-card .vsidian-hover-fm-toggle')
  })
})
