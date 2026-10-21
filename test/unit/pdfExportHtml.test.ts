// T01（#621）PDF 导出装配单元测试：@page 剥离（V01 §6 方向渗透坑）、
// 纯 Markdown 渲染（中文标题/列表/表格）、纸张适配与就绪位。
import { describe, expect, it } from 'vitest'
import {
  buildPdfExportHtml,
  pdfExportBaseCss,
  renderMarkdownBody,
  stripAtPageRules,
} from '../../src/host/pdfExport/pdfExportHtml'
import { cssAtPageRuleOf, PDF_EXPORT_OPTIONS_DEFAULTS } from '../../src/shared/pdfExportOptions'

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
})

describe('renderMarkdownBody：纯 Markdown 渲染', () => {
  it('中文标题/列表/表格/粗体渲染为对应 HTML 元素', () => {
    const html = renderMarkdownBody(
      [
        '# 中文标题甲',
        '',
        '段落**加粗**文本。',
        '',
        '- 列表项一',
        '- 列表项二',
        '',
        '| 列甲 | 列乙 |',
        '| --- | --- |',
        '| 格一 | 格二 |',
      ].join('\n'),
    )
    expect(html).toContain('<h1>中文标题甲</h1>')
    expect(html).toContain('<strong>加粗</strong>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>列表项一</li>')
    expect(html).toContain('<table>')
    expect(html).toContain('<th>列甲</th>')
    expect(html).toContain('<td>格二</td>')
  })

  it('原生 HTML 字面转义（T01 纯 Markdown 口径）', () => {
    const html = renderMarkdownBody('<div>注入</div>')
    expect(html).not.toContain('<div>')
    expect(html).toContain('&lt;div&gt;注入&lt;/div&gt;')
  })
})

describe('buildPdfExportHtml：完整装配', () => {
  it('结构齐全：DOCTYPE、charset、@page 纸张适配、就绪位、正文', () => {
    const html = buildPdfExportHtml({
      title: '笔记甲',
      markdown: '# 标题\n\n正文段。',
      options: PDF_EXPORT_OPTIONS_DEFAULTS,
    })
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain('<meta charset="UTF-8">')
    expect(html).toContain(cssAtPageRuleOf(PDF_EXPORT_OPTIONS_DEFAULTS))
    expect(html).toContain('window.__vsidianPdfExport = { asyncReady: true }')
    expect(html).toContain('<h1>标题</h1>')
    expect(html).toContain(pdfExportBaseCss().trim().slice(0, 40))
  })

  it('landscape 纸张：@page 尺寸互换（A4 横版 11.69×8.27in）', () => {
    const html = buildPdfExportHtml({
      title: 't',
      markdown: 'x',
      options: { ...PDF_EXPORT_OPTIONS_DEFAULTS, orientation: 'landscape' },
    })
    expect(html).toContain('size: 11.69in 8.27in')
  })

  it('extraCss（T02 接线骨架）：其中的 @page 被剥离、其余保留', () => {
    const html = buildPdfExportHtml({
      title: 't',
      markdown: 'x',
      options: PDF_EXPORT_OPTIONS_DEFAULTS,
      extraCss: '@page { size: A5 landscape } .custom { color: teal }',
    })
    // 用户 @page 不得出现两次（我们的 @page 只有一处且为 A4 纵向形态）
    expect(html.match(/@page/g)).toHaveLength(1)
    expect(html).toContain('size: 8.27in 11.69in')
    expect(html).toContain('.custom { color: teal }')
  })

  it('标题转义（防注入 <title>）', () => {
    const html = buildPdfExportHtml({ title: 'a<b>&c', markdown: 'x', options: PDF_EXPORT_OPTIONS_DEFAULTS })
    expect(html).toContain('<title>a&lt;b&gt;&amp;c</title>')
  })
})
