// PDF 导出 @page 剥离单元测试（T01/#621 建立，T02/#622 随宿主侧装配退役
// 收窄为单一职责——V01 §6 方向渗透坑的剥离防线）。
import { describe, expect, it } from 'vitest'
import { stripAtPageRules } from '../../src/host/pdfExport/pdfExportHtml'

describe('stripAtPageRules：用户 @page 剥离', () => {
  it('剥离顶层 @page、保留其余规则', () => {
    const css = 'body { color: red }\n@page { size: A5 landscape; margin: 2cm }\np { margin: 0 }'
    expect(stripAtPageRules(css)).toBe('body { color: red }\np { margin: 0 }')
  })

  it('剥离 @media 块内嵌套 @page，保留 @media 块本身', () => {
    const css = '@media print { @page { size: A3 } body { font-size: 10pt } }'
    expect(stripAtPageRules(css)).toBe('@media print { body { font-size: 10pt } }')
  })

  it('剥离带 margin 盒嵌套花括号的 @page（深度配对）', () => {
    const css = '@page { size: A4; @top-center { content: "x" } } h1 { color: blue }'
    const out = stripAtPageRules(css)
    expect(out).not.toContain('@page')
    expect(out).toContain('h1 { color: blue }')
  })

  it('字符串内的 @page 不误剥（content 伪造场景）', () => {
    const css = 'p::before { content: "@page { fake }"; color: red }'
    expect(stripAtPageRules(css)).toBe(css)
  })

  it('注释内的 @page 不触发（注释保留原样）', () => {
    const css = '/* @page { size: A5 } */ body { color: red }'
    expect(stripAtPageRules(css)).toBe(css)
  })

  it('多条 @page 全部剥离、无 @page 原样返回', () => {
    expect(stripAtPageRules('@page{margin:0}@page{size:B5}b{}')).toBe('b{}')
    expect(stripAtPageRules('a { x: 1 }')).toBe('a { x: 1 }')
  })

  it('CSS 片段文本（T02 载荷面）与 url() 内联同源剥离', () => {
    const css = '.bg { background: url("@page.png") }\n@page { margin: 0 }'
    // 末尾 @page 剥离后最多残留一条尾换行（规则间收口语义，无空行堆积）
    expect(stripAtPageRules(css).replace(/\n$/, '')).toBe('.bg { background: url("@page.png") }')
  })
})
