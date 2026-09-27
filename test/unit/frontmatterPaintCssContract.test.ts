// frontmatter 表格卡片绘制 CSS 契约（#140）：真实宿主的 computed style 与
// 命中测试验证实际呈现，此处钉住对应源规则，防止样式表被误删或只剩 DOM
// 类名而探针失效（tablePaintCssContract 同模式）。
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

describe('frontmatter 表格卡片 CSS 契约（#140）', () => {
  it('键值行按两列网格绘制，卡片行不因承载 frontmatter-line 别名而降透明', () => {
    expect(rule('.cm-scroller .vsidian-fm-row')).toMatch(/display:\s*grid/)
    expect(rule('.cm-scroller .vsidian-fm-row')).toMatch(/grid-template-columns:\s*minmax\(120px,\s*32%\)\s*1fr/)
    const card = rule('.vsidian-fm-card-line')
    expect(card).toMatch(/opacity:\s*1/)
    expect(card).toMatch(/font-family:\s*var\(--vscode-editor-font-family/)
  })

  it('单元格可见且不隐藏（边框与折行保留）；首行补顶线', () => {
    const cell = rule('.cm-scroller .vsidian-fm-row > .vsidian-fm-cell')
    expect(cell).toMatch(/border:\s*1px solid var\(--vscode-panel-border/)
    expect(cell).toMatch(/white-space:\s*pre-wrap/)
    expect(cell).not.toMatch(/display:\s*none/)
    expect(rule('.vsidian-fm-card-edge-top + .vsidian-fm-row > .vsidian-fm-cell'))
      .toMatch(/border-top:\s*1px solid/)
  })

  it('冒号与行内注释在绘制层隐藏（不占格位）；独立注释行淡化不隐藏', () => {
    expect(rule('.vsidian-fm-sep')).toMatch(/display:\s*none/)
    expect(rule('.vsidian-fm-comment')).toMatch(/display:\s*none/)
    expect(rule('.vsidian-fm-comment-line')).toMatch(/opacity:\s*0\.45/)
    expect(rule('.vsidian-fm-comment-line')).not.toMatch(/display:\s*none/)
  })

  it('结构按钮绝对定位脱流且 hover 显现；添加属性按钮虚线占位', () => {
    const remove = rule('.vsidian-fm-row > button.vsidian-fm-remove')
    expect(remove).toMatch(/position:\s*absolute/)
    expect(remove).toMatch(/opacity:\s*0/)
    expect(rule('button.vsidian-fm-remove:focus-visible')).toMatch(/opacity:\s*1/)
    expect(rule('.vsidian-fm-card-edge-bottom .vsidian-fm-add-entry')).toMatch(/border:\s*1px dashed/)
  })

  it('阅读侧同款表格：容器外框圆角、占位键列隐藏、空态文案在场', () => {
    const table = rule('.vsidian-view-reading .vsidian-reading-frontmatter .vsidian-fm-table', /border:/)
    expect(table).toMatch(/border:\s*1px solid/)
    expect(table).toMatch(/border-radius:\s*6px/)
    expect(rule('.vsidian-view-reading .vsidian-reading-frontmatter .vsidian-fm-row'))
      .toMatch(/display:\s*grid/)
    expect(rule('.vsidian-view-reading .vsidian-reading-frontmatter .vsidian-fm-key-placeholder'))
      .toMatch(/visibility:\s*hidden/)
    expect(rule('.vsidian-view-reading .vsidian-reading-frontmatter .vsidian-fm-empty'))
      .toMatch(/padding:\s*4px 10px/)
  })
})
