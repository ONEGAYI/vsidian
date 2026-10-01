// 查找面板绘制 CSS 契约（工单 #236）：jsdom 控制器测试（find.test.ts）
// 断言的是类名切换（DOM 层），此处钉住 main.css 对应源规则——防止样式
// 表被误删或只剩 DOM 类名而面板实际不可用（PR #37 P0 教训：样式注入
// 失效时 DOM 断言照样通过）。替换行显隐是纯 CSS 行为（无 JS 内联样式），
// 规则缺失即替换栏常驻显示，故显隐对是本文件最重要的断言。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(path.resolve(process.cwd(), 'src/webview/main.css'), 'utf8').replace(/\r\n/g, '\n')

function rule(selector: string, declaration?: RegExp): string {
  const blocks = css.match(/[^{}]+\{[^{}]*\}/g) ?? []
  const found = blocks.filter((block) => block.split('{')[0]?.trim().endsWith(selector) &&
    (declaration === undefined || declaration.test(block.split('{')[1] ?? '')))
  expect(found, `CSS 规则 ${selector} 应唯一存在`).toHaveLength(1)
  return found[0]!
}

describe('查找面板 CSS 契约（#236）', () => {
  it('阅读源码反馈固定定位、不占正文布局，源码文字自动换行且共用查找色变量', () => {
    const popup = rule(':where(#app .vsidian-reading-find-source)')
    expect(popup).toMatch(/position:\s*fixed/)
    expect(popup).toContain('--vscode-editorWidget-background')
    expect(popup).toMatch(/max-height:\s*160px/)
    expect(rule(':where(#app .vsidian-reading-find-source[hidden])')).toMatch(/display:\s*none/)
    expect(rule(':where(#app .vsidian-reading-find-source-code)')).toMatch(/white-space:\s*pre-wrap/)
    expect(css).toContain(':where(#app .vsidian-reading-find-source .vsidian-find-match),')
    expect(css).toContain(':where(#app .vsidian-reading-find-source .vsidian-find-match-current),')
  })
  it('阅读字符高亮与 Live 共用色变量，旧命中块入口默认透明', () => {
    expect(rule('#app .vsidian-view-reading .vsidian-find-match'))
      .toContain('--vsidian-find-match-background')
    expect(rule('#app .vsidian-view-reading .vsidian-find-match-current'))
      .toContain('--vsidian-find-match-current-background')
    const legacy = rule('#app .vsidian-view-reading .vsidian-reading-block.vsidian-reading-find-hit')
    expect(legacy).toContain('var(--vsidian-find-hit-block-background, transparent)')
    expect(legacy).not.toContain('box-shadow')
  })
  it('面板 open 态显隐：默认 none，open 类展开为 grid', () => {
    expect(rule('.vsidian-find', /display:\s*none/)).toBeTruthy()
    expect(rule('.vsidian-find.vsidian-find-open', /display:\s*grid/)).toBeTruthy()
  })

  it('面板为 grid 双列布局（toggle 左列 + 内容右列，2026-10 对齐 VSCode）', () => {
    expect(rule('.vsidian-find', /grid-template-columns:\s*auto\s+1fr/)).toBeTruthy()
  })

  it('替换行显隐对：默认收起（display:none），-open 类展开（display:flex）', () => {
    expect(rule('.vsidian-find .vsidian-find-replace', /display:\s*none/)).toBeTruthy()
    expect(rule('.vsidian-find .vsidian-find-replace.vsidian-find-replace-open', /display:\s*flex/)).toBeTruthy()
  })

  it('主行与替换行落在 grid 右列（column 2，toggle 让位走轨道不再用 padding）', () => {
    expect(rule('.vsidian-find .vsidian-find-row', /grid-column:\s*2/)).toBeTruthy()
    expect(rule('.vsidian-find .vsidian-find-replace', /grid-column:\s*2/)).toBeTruthy()
  })

  it('toggle 常态透明占位边框，focus-visible 才出强调色圈（焦点圈与输入框互斥）', () => {
    expect(rule('.vsidian-find .vsidian-find-toggle', /border:\s*1px solid transparent/)).toBeTruthy()
    expect(rule('.vsidian-find .vsidian-find-toggle:focus-visible', /border-color:\s*var\(--vscode-focusBorder/)).toBeTruthy()
  })

  it('toggle 高度随内容行：收起占首行，替换栏展开经 :has 跨两行', () => {
    expect(rule('.vsidian-find .vsidian-find-toggle', /grid-row:\s*1\s*\/\s*2/)).toBeTruthy()
    expect(rule('.vsidian-find:has(.vsidian-find-replace-open) .vsidian-find-toggle', /grid-row:\s*1\s*\/\s*3/)).toBeTruthy()
  })

  it('切换图标为内嵌 glyph 层：自绘 chevron SVG 双主题，展开随 aria-expanded 旋转 90°', () => {
    expect(rule('.vsidian-find .vsidian-find-toggle[aria-expanded=\'true\'] .vsidian-find-toggle-glyph', /transform:\s*rotate\(90deg\)/)).toBeTruthy()
    expect(rule('#app .vsidian-find .vsidian-find-toggle-glyph', /light\/light-chevronRight/))
      .toContain('light/light-chevronRight.svg')
    expect(rule('body.vscode-high-contrast #app .vsidian-find .vsidian-find-toggle-glyph', /dark\/dark-chevronRight/))
      .toContain('dark/dark-chevronRight.svg')
    // 双主题变体同块（body.vscode-dark 与 high-contrast 逗号并列）——
    // 误删 vscode-dark 选择器时此断言拦截
    expect(css).toContain('body.vscode-dark #app .vsidian-find .vsidian-find-toggle-glyph,')
  })

  it('三开关激活态点亮规则覆盖 Aa/ab/.*/☰ 四类（VSCode inputOption 激活族）', () => {
    const active = rule('.vsidian-find .vsidian-find-case-active,\n.vsidian-find .vsidian-find-word-active,\n.vsidian-find .vsidian-find-regexp-active,\n.vsidian-find .vsidian-find-in-selection-active')
    expect(active).toMatch(/background-color:\s*var\(--vscode-inputOption-activeBackground/)
    expect(active).toMatch(/color:\s*var\(--vscode-inputOption-activeForeground/)
  })

  it('图标按钮基线：透明底 + hover 淡入底色（功能词只在 aria-label/title）', () => {
    expect(rule('.vsidian-find button', /background-color:\s*transparent/)).toBeTruthy()
    expect(rule('.vsidian-find button:hover', /background-color:\s*var\(--vscode-toolbar-hoverBackground/)).toBeTruthy()
  })

  it('导航与替换图标在浅色、深色主题下都指向同名 SVG 资产', () => {
    const icons = [
      ['vsidian-find-prev', 'findPrev'],
      ['vsidian-find-next', 'findNext'],
      ['vsidian-find-close', 'findClose'],
      ['vsidian-find-replace-next', 'replaceOne'],
      ['vsidian-find-replace-all', 'replaceAll'],
      ['vsidian-find-in-selection', 'findInSelection'],
    ] as const
    for (const [className, key] of icons) {
      const selector = `.vsidian-find .${className}`
      expect(rule(selector, new RegExp(`light/light-${key}`))).toContain(`light/light-${key}.svg`)
      const darkSelector = `body.vscode-high-contrast #app .vsidian-find .${className}`
      expect(rule(darkSelector, new RegExp(`dark/dark-${key}`))).toContain(`dark/dark-${key}.svg`)
    }
  })

  it('替换输入框与主输入框共用基础排版（合并选择器）', () => {
    expect(rule('.vsidian-find .vsidian-find-input,\n.vsidian-find .vsidian-find-replace-input', /color:\s*var\(--vscode-input-foreground/)).toBeTruthy()
  })

  it('输入框容器：边框背景挂容器（三开关嵌入右缘的前提）', () => {
    const wrap = rule('.vsidian-find .vsidian-find-inputwrap')
    expect(wrap).toMatch(/background-color:\s*var\(--vscode-input-background/)
    expect(wrap).toMatch(/border:\s*1px solid var\(--vscode-input-border/)
  })

  it('容器聚焦环与非法态：focus-within 走 focusBorder，invalid 经 :has 上容器', () => {
    expect(rule('.vsidian-find .vsidian-find-inputwrap:focus-within', /border-color:\s*var\(--vscode-focusBorder/)).toBeTruthy()
    expect(rule('.vsidian-find .vsidian-find-inputwrap:has(.vsidian-find-input-invalid)', /border-color:\s*var\(--vscode-inputValidation-errorBorder/)).toBeTruthy()
  })

  it('主输入本体透明无边框（边框随容器）；替换输入框保持自带边框背景', () => {
    expect(rule('.vsidian-find .vsidian-find-input', /border:\s*none/)).toBeTruthy()
    expect(rule('.vsidian-find .vsidian-find-replace-input', /background-color:\s*var\(--vscode-input-background/)).toBeTruthy()
  })

  it('空查询计数收起：hidden 类 display:none（不预留「当前/总数」占位）', () => {
    expect(rule('.vsidian-find .vsidian-find-count-hidden', /display:\s*none/)).toBeTruthy()
  })

  it('在选定内容中查找：禁用态灰化不响应 hover；范围淡底走 inactiveSelection', () => {
    expect(rule('.vsidian-find .vsidian-find-in-selection:disabled', /opacity:\s*0\.4/)).toBeTruthy()
    expect(rule('.vsidian-find .vsidian-find-in-selection:disabled:hover', /background-color:\s*transparent/)).toBeTruthy()
    expect(rule('#app .cm-editor .cm-content .vsidian-find-selection-range',
      /background-color:\s*var\(--vscode-editor-inactiveSelectionBackground/)).toBeTruthy()
  })
})
