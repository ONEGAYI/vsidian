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

  it('行号列：横向滚动时钉视口左缘（sticky left）＋不透明底色遮住滑过文本（2026-10-05 验收 5b 改版）', () => {
    const gutter = rule('.vsidian-text-gutter')
    expect(gutter).toMatch(/position:\s*sticky/)
    expect(gutter).toMatch(/left:\s*0/)
    expect(gutter).toMatch(/z-index:\s*1/)
    expect(gutter).toMatch(/background-color:\s*var\(--vscode-editor-background/)
  })

  it('代码区：不自持横滚（横向滚动归宿主滚动区——横条贴浮窗/卡片视口底缘，原生编辑器同款语义；2026-10-05 验收 5b 改版）', () => {
    const code = rule('.vsidian-text-code')
    expect(code).toMatch(/overflow:\s*visible/)
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

  it('虚拟化窗口层不携带 will-change（强制合成层禁用子像素抗锯齿，浅色主题文字观感发灰——2026-10-04 着色发灰次要因素修复）', () => {
    expect(rule('.vsidian-text-window')).not.toMatch(/will-change/)
    expect(rule('.vsidian-text-gutter-window')).not.toMatch(/will-change/)
  })
})
