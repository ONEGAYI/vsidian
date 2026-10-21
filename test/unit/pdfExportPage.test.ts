// T02（#622）PDF 导出页骨架装配单元测试：payload 注入防断裂、主题变量
// 快照与兜底、@page 纸张适配、片段 @page 剥离、CSP 与产物引用。
import { describe, expect, it } from 'vitest'
import { buildPdfExportPageHtml } from '../../src/host/pdfExport/pdfExportPage'
import { PDF_EXPORT_OPTIONS_DEFAULTS } from '../../src/shared/pdfExportOptions'
import type { PdfExportPagePayload } from '../../src/shared/pdfExportPayload'

function payloadOf(overrides: Partial<PdfExportPagePayload> = {}): PdfExportPagePayload {
  return {
    docs: [{
      fsPath: 'D:/vault/笔记甲.md',
      docName: '笔记甲.md',
      text: '# 标题\n\n正文段。',
      version: 3,
    }],
    embeds: [],
    mediaEmbeds: [],
    embedFailures: [],
    style: { dark: false, vars: {}, reading: {} },
    snippets: [],
    breaks: false,
    mermaidUri: 'http://127.0.0.1:1/t/mermaid.js',
    resBase: 'http://127.0.0.1:1/t/res',
    locale: 'zh-cn',
    ...overrides,
  }
}

const ADDRESSES = {
  scriptSrc: '/t/pdfExportPage.js',
  styleHref: '/t/pdfExportPage.css',
}

describe('buildPdfExportPageHtml：骨架装配', () => {
  it('结构齐全：DOCTYPE、CSP、产物引用、#app 容器与 payload 注入', () => {
    const html = buildPdfExportPageHtml({ payload: payloadOf(), options: PDF_EXPORT_OPTIONS_DEFAULTS, ...ADDRESSES })
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain('http-equiv="Content-Security-Policy"')
    expect(html).toContain(`href="${ADDRESSES.styleHref}"`)
    expect(html).toContain(`src="${ADDRESSES.scriptSrc}"`)
    expect(html).toContain('<div id="app"')
    expect(html).toContain('window.__vsidianPdfExportInput =')
    expect(html).toContain('"docName":"笔记甲.md"')
  })

  it('payload 含 </script> 时防断裂（< 转义为 \\u003c）', () => {
    const html = buildPdfExportPageHtml({
      payload: payloadOf({
        docs: [{
          fsPath: 'D:/v/x.md',
          docName: 'x.md',
          text: '</script><script>alert(1)</script>',
          version: 1,
        }],
      }),
      options: PDF_EXPORT_OPTIONS_DEFAULTS,
      ...ADDRESSES,
    })
    expect(html).not.toContain('</script><script>')
    // 注入序列以转义形态出现（脚本提前闭合被阻断）
    expect(html).toContain('\\u003c/script>')
  })

  it('@page 与参数同源（A4 纵向 + 20mm 边距）；landscape 互换', () => {
    const portrait = buildPdfExportPageHtml({ payload: payloadOf(), options: PDF_EXPORT_OPTIONS_DEFAULTS, ...ADDRESSES })
    expect(portrait).toContain('size: 8.27in 11.69in')
    const landscape = buildPdfExportPageHtml({
      payload: payloadOf(),
      options: { ...PDF_EXPORT_OPTIONS_DEFAULTS, orientation: 'landscape' },
      ...ADDRESSES,
    })
    expect(landscape).toContain('size: 11.69in 8.27in')
  })

  it('主题快照变量注入 :root；暗色挂 body 类与暗色兜底', () => {
    const html = buildPdfExportPageHtml({
      payload: payloadOf({
        style: { dark: true, vars: { '--vscode-editor-foreground': '#cccccc', '--h1-color': '#e6e6e6' }, reading: { fontFamily: '"Noto Serif SC", serif' } },
      }),
      options: PDF_EXPORT_OPTIONS_DEFAULTS,
      ...ADDRESSES,
    })
    expect(html).toContain('<body class="vscode-dark">')
    expect(html).toContain('--vscode-editor-foreground: #cccccc;')
    expect(html).toContain('--h1-color: #e6e6e6;')
    expect(html).toContain('--vsidian-pdf-reading-font: "Noto Serif SC", serif;')
    expect(html).toContain('font-family: "Noto Serif SC", serif;')
  })

  it('快照缺失时亮色兜底值在场（默认主题公开基础值）', () => {
    const html = buildPdfExportPageHtml({ payload: payloadOf(), options: PDF_EXPORT_OPTIONS_DEFAULTS, ...ADDRESSES })
    expect(html).toContain('<body class="vscode-light">')
    expect(html).toContain('--vscode-editor-background: #ffffff;')
  })

  it('片段文本经 @page 剥离后进样式链（T01 防线对片段统一执行）', () => {
    const html = buildPdfExportPageHtml({
      payload: payloadOf({
        snippets: [{ name: 'a.css', css: '@page { size: A5 landscape } .custom { color: teal }' }],
      }),
      options: PDF_EXPORT_OPTIONS_DEFAULTS,
      ...ADDRESSES,
    })
    // 装配侧自己的 @page 恰一条（A4 纵向）；片段 style 块内无 @page
    //（payload JSON 数据面保留快照原貌，不按全文计数）
    expect(html.match(/size: 8\.27in 11\.69in/g)).toHaveLength(1)
    const snippetBlock = html.slice(html.indexOf('/* snippet: a.css */'))
    expect(snippetBlock.slice(0, snippetBlock.indexOf('</style>'))).not.toContain('@page')
    expect(html).toContain('.custom { color: teal }')
  })

  it('阅读字号/行高随快照落到 #app 内联样式', () => {
    const html = buildPdfExportPageHtml({
      payload: payloadOf({
        style: { dark: false, vars: {}, reading: { fontSize: '16px', lineHeight: '1.8' } },
      }),
      options: PDF_EXPORT_OPTIONS_DEFAULTS,
      ...ADDRESSES,
    })
    expect(html).toContain('font-size: 16px;')
    expect(html).toContain('line-height: 1.8;')
  })
})
