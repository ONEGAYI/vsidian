// 可读文本悬停视图 CSS 契约（#340）：钉住 main.css 文本视图段的关键规则，
// 防止样式表被误删或只剩 DOM 类名（hoverPopupCssContract 同模式）。真实
// computed style（字体/着色/滚动几何）在 test/browser textHover 套件按
// 绘制层验证。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(path.resolve(process.cwd(), 'src/webview/main.css'), 'utf8')
  .replace(/\r\n/g, '\n')

function rule(selector: string): string {
  const blocks = css.match(/[^{}]+\{[^{}]*\}/g) ?? []
  const found = blocks.filter((block) => block.split('{')[0]?.trim().endsWith(selector))
  expect(found, `CSS 规则 ${selector} 应唯一存在`).toHaveLength(1)
  return found[0]!
}

describe('可读文本悬停视图 CSS 契约（#340）', () => {
  it('视图根：flex 双列（行号列 + 代码区）与字体变量族回落（零公开变量新增）', () => {
    const view = rule('.vsidian-text-view')
    expect(view).toMatch(/display:\s*flex/)
    expect(view).toMatch(/font-family:\s*var\(--vscode-editor-font-family/)
    expect(view).toMatch(/color:\s*var\(--vscode-editor-foreground/)
    expect(view).toMatch(/background:\s*transparent/)
  })

  it('行号列：不可选（复制不裹挟行号）、右对齐、溢出裁剪', () => {
    const gutter = rule('.vsidian-text-gutter')
    expect(gutter).toMatch(/user-select:\s*none/)
    expect(gutter).toMatch(/text-align:\s*right/)
    expect(gutter).toMatch(/overflow:\s*hidden/)
    expect(gutter).toMatch(/color:\s*var\(--vscode-editorLineNumber-foreground/)
  })

  it('代码区：横向滚动承载（原生编辑器默认不折行）、纵向归浮层滚动区', () => {
    const code = rule('.vsidian-text-code')
    expect(code).toMatch(/overflow-x:\s*auto/)
    expect(code).toMatch(/overflow-y:\s*hidden/)
  })

  it('行内容：white-space pre（列对齐与尾随空格保真）', () => {
    expect(rule('.vsidian-text-line')).toMatch(/white-space:\s*pre/)
    expect(rule('.vsidian-text-gutter-line')).toMatch(/white-space:\s*pre/)
  })

  it('虚拟化窗口层：绝对定位位移承载（可见行挂载的结构前提）', () => {
    expect(rule('.vsidian-text-window')).toMatch(/position:\s*absolute/)
    expect(rule('.vsidian-text-gutter-window')).toMatch(/position:\s*absolute/)
    expect(rule('.vsidian-text-lines')).toMatch(/position:\s*relative/)
  })
})
