// 代码块卡片绘制 CSS 契约（工单 #79）：真实宿主的 computed style 与命中
// 测试验证实际呈现（集成 paint.code 探针），此处钉住对应源规则，防止样式
// 表被误删或只剩 DOM 类名而集成探针失效。
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

describe('代码块卡片 CSS 契约（#79）', () => {
  it('代码内选区在 drawSelection 开启时补绘，聚焦/失焦颜色与宿主同源', () => {
    expect(rule('#app .cm-editor:has(.cm-selectionLayer) .cm-content .vsidian-code-selection'))
      .toMatch(/background-color:\s*var\(--vscode-editor-inactiveSelectionBackground/)
    expect(rule('#app .cm-editor.cm-focused:has(.cm-selectionLayer) .cm-content .vsidian-code-selection'))
      .toMatch(/background-color:\s*var\(--vscode-editor-selectionBackground/)
  })
  it('卡片行底色走公开变量 --vsidian-code-card-background（回落主题变量）', () => {
    expect(rule('#app .cm-editor .cm-scroller .cm-line.vsidian-code-card-line'))
      .toMatch(/background-color:\s*var\(--vsidian-code-card-background/)
  })

  it('变量默认值回落 VSCode 代码块背景（#app 根定义）', () => {
    expect(css).toMatch(/--vsidian-code-card-background:\s*var\(--vscode-textCodeBlock-background/)
  })

  it('首尾行圆角修饰存在（头部承担顶边，尾行承担底边）', () => {
    expect(rule('#app .cm-editor .cm-scroller .cm-line.vsidian-code-card-line.vsidian-code-card-edge-bottom'))
      .toMatch(/border-bottom-left-radius:\s*6px/)
    expect(rule('#app .cm-editor .cm-scroller .cm-line.vsidian-code-card-line.vsidian-code-card-edge-top'))
      .toMatch(/border-top-left-radius:\s*6px/)
  })

  it('围栏行（首/尾行）左内边距走对齐公式：行号列宽 + 24px（#189 真实对齐，值按块注入）', () => {
    expect(rule('#app .cm-editor .cm-scroller .cm-line.vsidian-code-card-line.vsidian-code-card-edge-top'))
      .toMatch(/padding-left:\s*var\(--vsidian-code-indent,\s*0px\)/)
    expect(rule('#app .cm-editor .cm-scroller .cm-line.vsidian-code-card-line.vsidian-code-card-edge-bottom'))
      .toMatch(/padding-left:\s*var\(--vsidian-code-indent,\s*0px\)/)
  })

  it('头部横带：flex 布局、顶边圆角、底部分隔线、底色同源', () => {
    const header = rule('#app .vsidian-code-card-header')
    expect(header).toMatch(/display:\s*flex/)
    expect(header).toMatch(/border-radius:\s*6px 6px 0 0/)
    expect(header).toMatch(/border-bottom:\s*1px solid var\(--vscode-editorGroup-border/)
    expect(header).toMatch(/background-color:\s*var\(--vsidian-code-card-background/)
  })

  it('语言标签加粗；按钮区内联排布（#81 复用容器）', () => {
    expect(rule('#app .vsidian-code-card-header .vsidian-code-card-header-label'))
      .toMatch(/font-weight:\s*600/)
    expect(rule('#app .vsidian-code-card-header .vsidian-code-card-header-actions'))
      .toMatch(/display:\s*inline-flex/)
  })

  it('卡内行号：右对齐、颜色与文档行号槽同源、禁选（#80）；边距 8+16 重分配（左缘 8px、数字与代码 16px，总占恒定代码列不动）', () => {
    const ln = rule('#app .vsidian-code-card-linenumber')
    expect(ln).toMatch(/display:\s*inline-block/)
    expect(ln).toMatch(/text-align:\s*right/)
    expect(ln).toMatch(/color:\s*var\(--vscode-editorLineNumber-foreground/)
    expect(ln).toMatch(/user-select:\s*none/)
    expect(ln).toMatch(/margin-left:\s*8px/)
    expect(ln).toMatch(/margin-right:\s*16px/)
  })

  it('复制按钮：悬停卡片显现、✓ 反馈态切换图标（#81）', () => {
    const btn = rule('#app .vsidian-code-card-header .vsidian-code-card-copy')
    expect(btn).toMatch(/opacity:\s*0/)
    // 悬停/focus 显现规则（组选择器，hover 段在块中部）
    const reveal = (css.match(/[^{}]+\{[^{}]*\}/g) ?? []).filter((b) =>
      b.split('{')[0]!.includes('.vsidian-code-card-header:hover .vsidian-code-card-copy') &&
      /opacity:\s*1/.test(b.split('{')[1] ?? ''))
    expect(reveal, '悬停显现规则（opacity 0→1）应存在').toHaveLength(1)
    expect(
      rule('#app .vsidian-code-card-header .vsidian-code-card-copy-done .vsidian-code-card-copy-icon-check'),
    ).toMatch(/display:\s*inline-flex/)
  })

  it('折叠 chevron：常驻可见、收起态转向 -90°、收起时头部补底边圆角（#82）', () => {
    const chevron = rule('#app .vsidian-code-card-header .vsidian-code-card-fold')
    expect(chevron).toMatch(/display:\s*inline-flex/)
    expect(chevron).not.toMatch(/visibility:\s*hidden/)
    expect(
      rule('#app .vsidian-code-card-header .vsidian-code-card-fold-collapsed svg'),
    ).toMatch(/transform:\s*rotate\(-90deg\)/)
    expect(
      rule('#app .vsidian-code-card-header:has(> .vsidian-code-card-header-actions > .vsidian-code-card-fold-collapsed)'),
    ).toMatch(/border-radius:\s*6px/)
  })

  it('token 色板：两套主题色与关键词、常量、字符串、注释、属性的区分；用户片段仍可覆写', () => {
    expect(rule('.tok-keyword', /color:\s*#af00db/i)).toMatch(/color:\s*#af00db/i)
    expect(rule('.tok-atom', /color:\s*#0550ae/i)).toMatch(/color:\s*#0550ae/i)
    expect(rule('.tok-string', /color:\s*#0a3069/i)).toMatch(/color:\s*#0a3069/i)
    expect(rule('.tok-comment', /color:\s*#6e7781/i)).toMatch(/color:\s*#6e7781/i)
    expect(rule('.tok-propertyName', /color:\s*#1f2328/i)).toMatch(/color:\s*#1f2328/i)
    expect(rule('.tok-function', /color:\s*#806000/i)).toMatch(/color:\s*#806000/i)
    expect(css.indexOf('.tok-function { color: #806000; }')).toBeGreaterThan(
      css.indexOf('.tok-propertyName { color: #1f2328; }'))
    expect(css.match(/:where\(body\.vscode-dark\) \.tok-keyword[^{]*\{[^}]*#c586c0/i)).not.toBeNull()
    expect(css.match(/:where\(body\.vscode-dark\) \.tok-atom[^{]*\{[^}]*#79c0ff/i)).not.toBeNull()
    expect(css.match(/:where\(body\.vscode-dark\) \.tok-string[^{]*\{[^}]*#a5d6ff/i)).not.toBeNull()
    expect(css.match(/:where\(body\.vscode-dark\) \.tok-comment[^{]*\{[^}]*#8b949e/i)).not.toBeNull()
    expect(css.match(/:where\(body\.vscode-dark\) \.tok-propertyName[^{]*\{[^}]*#c9d1d9/i)).not.toBeNull()
    expect(css.match(/:where\(body\.vscode-dark\) \.tok-function[^{]*\{[^}]*#dcdcaa/i)).not.toBeNull()
    // HC 函数色限定深色组合（评审 A-2）：浅色高对比回落浅色组 #806000
    expect(css.match(/:where\(body\.vscode-dark\.vscode-high-contrast\) \.tok-function[^{]*\{[^}]*#dcdcaa/i)).not.toBeNull()
    // 可覆写承诺的形态前提：内置色板不得携带 ID/主题类特异性
    expect(css.includes('#app .tok-')).toBe(false)
    expect(css.includes('body.vscode-dark #app .tok-')).toBe(false)
  })

  it('语言徽标：头部标签左侧字形徽标（#83）', () => {
    expect(rule('.vsidian-code-card-header .vsidian-code-card-header-icon'))
      .toMatch(/font-weight:\s*700/)
  })

  it('复制按钮显现规则组（#190 整卡悬停恒显）：header:hover 保留 + live reveal 类 + 阅读块容器 hover', () => {
    // 组内块匹配（copy 段与 wrap 段同组，选择器不以 copy 结尾，rule() 的
    // endsWith 匹配不适用）
    const blockHit = (sel: string) => (css.match(/[^{}]+\{[^{}]*\}/g) ?? []).filter((b) =>
      b.split('{')[0]!.includes(sel))
    // header:hover 直达显现保留（头部横带自身悬停仍显现）
    const hover = blockHit('.vsidian-code-card-header:hover .vsidian-code-card-copy')
      .filter((b) => /opacity:\s*1/.test(b.split('{')[1] ?? ''))
    expect(hover, 'header:hover 显现规则（opacity 0→1）应存在').toHaveLength(1)
    // live 整卡显现：头部 block widget 与卡片行无公共 DOM 祖先，JS 指针
    // 追踪给头部挂 reveal 类（内部交互态类，不入公开样式契约）
    const reveal = blockHit('.vsidian-code-card-header.vsidian-code-card-reveal .vsidian-code-card-copy')
    expect(reveal, 'live reveal 显现规则组应存在').toHaveLength(1)
    expect(reveal[0]!.split('{')[1]!).toMatch(/opacity:\s*1/)
    expect(reveal[0]!.split('{')[1]!).toMatch(/visibility:\s*visible/)
    // 阅读整卡显现：头部与代码同在块容器内，纯 CSS 可达
    const reading = blockHit('.vsidian-reading-block.vsidian-reading-code-card:hover .vsidian-code-card-copy')
    expect(reading, '阅读块容器 hover 显现规则组应存在').toHaveLength(1)
    expect(reading[0]!.split('{')[1]!).toMatch(/opacity:\s*1/)
    expect(reading[0]!.split('{')[1]!).toMatch(/visibility:\s*visible/)
  })

  it('头部横带整条折叠热区：cursor: pointer 视觉暗示（#190）', () => {
    expect(rule('#app .vsidian-code-card-header')).toMatch(/cursor:\s*pointer/)
  })
})

describe('折行窜行修复与折行开关（#191）', () => {
  it('live 通用行悬挂缩进：padding-left 走对齐变量、text-indent 负缩进拉回首行（续行对齐文本列）', () => {
    const line = rule('#app .cm-editor .cm-scroller .cm-line.vsidian-code-card-line')
    expect(line).toMatch(/padding-left:\s*var\(--vsidian-code-indent,\s*0px\)/)
    expect(line).toMatch(/text-indent:\s*calc\(-1 \* var\(--vsidian-code-indent,\s*0px\)\)/)
  })

  it('live 围栏行（首/尾）覆盖 text-indent: 0：无行号 widget，保持 #189 对齐缩进而无悬挂', () => {
    expect(rule('#app .cm-editor .cm-scroller .cm-line.vsidian-code-card-line.vsidian-code-card-edge-top'))
      .toMatch(/text-indent:\s*0/)
    expect(rule('#app .cm-editor .cm-scroller .cm-line.vsidian-code-card-line.vsidian-code-card-edge-bottom'))
      .toMatch(/text-indent:\s*0/)
  })

  it('阅读行无悬挂缩进两式（2026-10 卡内行号退场：行号区与 --vsidian-code-indent 注入一并移除）', () => {
    const line = rule('#app .vsidian-view-reading .vsidian-reading-block.vsidian-reading-code-card .vsidian-reading-code-line')
    expect(line).not.toMatch(/--vsidian-code-indent/)
  })

  it('阅读关闭折行：pre 横向滚动（white-space: pre + overflow-x: auto，容器状态类门控）', () => {
    const pre = rule('#app .vsidian-view-reading.vsidian-reading-nowrap .vsidian-reading-block.vsidian-reading-code-card > pre')
    expect(pre).toMatch(/white-space:\s*pre\b/)
    expect(pre).toMatch(/overflow-x:\s*auto/)
  })

  it('阅读关闭折行无行号专属规则（2026-10 卡内行号退场：sticky 钉左、遮罩与行盒延展规则一并移除）', () => {
    const blocks = css.match(/[^{}]+\{[^{}]*\}/g) ?? []
    const gone = [
      '#app .vsidian-view-reading.vsidian-reading-nowrap .vsidian-reading-block.vsidian-reading-code-card .vsidian-reading-code-line',
      '#app .vsidian-view-reading.vsidian-reading-nowrap .vsidian-reading-block.vsidian-reading-code-card .vsidian-code-card-linenumber',
    ]
    for (const selector of gone) {
      expect(blocks.some((block) => block.split('{')[0]?.trim().endsWith(selector)), selector).toBe(false)
    }
  })

  it('折行钮与复制钮同口径进卡即显：默认隐藏、三处显现组（header hover/focus、live reveal、阅读块容器 hover）；-off 经 filter 弱化（与显隐 opacity 正交）', () => {
    const btn = rule('#app .vsidian-code-card-header .vsidian-code-card-wrap')
    expect(btn).toMatch(/display:\s*inline-flex/)
    expect(btn).toMatch(/opacity:\s*0;/)
    expect(btn).toMatch(/visibility:\s*hidden/)
    expect(btn).toMatch(/transition:\s*opacity/)
    expect(rule('#app .vsidian-code-card-header .vsidian-code-card-wrap-off'))
      .toMatch(/filter:\s*opacity\(0\.4\)/)
    // 三处显现组各含 wrap 且给 opacity 1（组选择器块内命中）
    for (const sel of [
      '.vsidian-code-card-header:hover .vsidian-code-card-wrap',
      '.vsidian-code-card-header.vsidian-code-card-reveal .vsidian-code-card-wrap',
      '.vsidian-reading-block.vsidian-reading-code-card:hover .vsidian-code-card-wrap',
    ]) {
      const hits = (css.match(/[^{}]+\{[^{}]*\}/g) ?? []).filter((b) =>
        b.split('{')[0]!.includes(sel) &&
        /opacity:\s*1/.test(b.split('{')[1] ?? ''))
      expect(hits, `显现规则 ${sel}（opacity 1）应存在`).toHaveLength(1)
    }
  })
})

describe('ready-language visible lexical colors (#389)', () => {
  it('does not recolor the existing Markdown heading class', () => {
    expect(css).not.toMatch(/(?:^|\n)(?::where\([^)]*\) )?\.tok-heading\s*\{/)
  })
  it.each([
    ['inserted', '#22863a', '#85e89d'],
    ['deleted', '#b31d28', '#f97583'],
  ])('%s has distinct light and dark paint without changing existing token colors', (kind, light, dark) => {
    expect(css).toContain(`.tok-${kind} { color: ${light}; }`)
    expect(css).toContain(`:where(body.vscode-dark) .tok-${kind} { color: ${dark}; }`)
  })
})
