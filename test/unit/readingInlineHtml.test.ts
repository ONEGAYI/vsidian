// @vitest-environment jsdom
// 阅读侧行内 HTML 渲染契约（#568/T03）：行内片段（成对最外层）经
// vsidian_inline_html 规则消费为完整片段 token → htmlInlineRenderHtml
// 净化装配（DOMPurify 单一事实源复用）原位渲染；不成型（未闭合/孤立
// 闭/跨行）维持 T02 的 html_inline 转义字面；前后 Markdown 文字、列表/
// 引用容器、Markdown 表格内语义不丢；片段内不递归 Markdown（规格
// 「不为 HTML 元素内部递归开启另一套 Markdown 渲染」）；危险内容净化。
import { describe, it, expect } from 'vitest'
import {
  buildLineBounds,
  createMarkdownRenderer,
  renderTokenHtml,
} from '../../src/webview/readingMarkdown'

function renderToDom(md: ReturnType<typeof createMarkdownRenderer>, src: string): HTMLElement {
  const env = buildLineBounds(src)
  const tokens = md.parse(src, env as unknown as Parameters<ReturnType<typeof createMarkdownRenderer>['parse']>[1])
  const host = document.createElement('div')
  host.innerHTML = renderTokenHtml(md, tokens, env)
  return host
}

describe('行内 HTML 原位渲染（净化后元素、非转义文本）', () => {
  it('span 内联颜色渲染为原生元素，前后 Markdown 文字保留', () => {
    const host = renderToDom(createMarkdownRenderer(), '前文 <span style="color:red">红字</span> 后文 **粗体**')
    const span = host.querySelector<HTMLSpanElement>('span[style*="color:red"]')
    expect(span).not.toBeNull()
    expect(span!.textContent).toBe('红字')
    expect(host.querySelector('strong')).not.toBeNull()
    expect(host.textContent).toContain('前文 ')
    expect(host.textContent).toContain(' 后文 ')
  })

  it('br 换行渲染：不拆段（同一段落内的原生换行）', () => {
    const host = renderToDom(createMarkdownRenderer(), '第一行<br>第二行 尾字')
    const brs = host.querySelectorAll('br')
    expect(brs.length).toBeGreaterThanOrEqual(1)
    // 仍在同一 <p>（不被换行拆成两个段落）
    expect(host.querySelectorAll('p')).toHaveLength(1)
  })

  it('嵌套片段整体渲染（内层标签按 HTML 语义生效）', () => {
    const host = renderToDom(createMarkdownRenderer(), 'a <span style="color:red">r<b>bi</b>c</span> b')
    const span = host.querySelector<HTMLSpanElement>('span[style*="color:red"]')
    expect(span).not.toBeNull()
    expect(span!.querySelector('b')!.textContent).toBe('bi')
    expect(span!.textContent).toBe('rbic')
  })

  it('片段内不递归 Markdown：**bold** 字面呈现（规格红线）', () => {
    const host = renderToDom(createMarkdownRenderer(), 'a <u>**bold**</u> b')
    const u = host.querySelector('u')
    expect(u).not.toBeNull()
    expect(u!.textContent).toBe('**bold**')
    expect(host.querySelector('strong')).toBeNull()
  })

  it('void/自闭合元素渲染（img/wbr/br 变体）', () => {
    const host = renderToDom(createMarkdownRenderer(), 'a <img src="x.png"> b <br/> c')
    expect(host.querySelector('img[src="x.png"]')).not.toBeNull()
    expect(host.querySelectorAll('br').length).toBeGreaterThanOrEqual(1)
  })

  it('标题/引用/列表/表格上下文原位渲染', () => {
    const md = createMarkdownRenderer()
    const heading = renderToDom(md, '# 标题 <span style="color:red">x</span>')
    expect(heading.querySelector('h1 span[style*="color:red"]')).not.toBeNull()
    const quote = renderToDom(md, '> 引用 <span style="color:red">q</span>')
    expect(quote.querySelector('blockquote span[style*="color:red"]')).not.toBeNull()
    const list = renderToDom(md, '- 项 <u>i</u>')
    expect(list.querySelector('li u')).not.toBeNull()
    const table = renderToDom(md, '| a | b |\n|---|---|\n| <span style="color:red">x</span> | y |')
    expect(table.querySelector('td span[style*="color:red"]')).not.toBeNull()
    expect(table.querySelectorAll('table').length).toBeGreaterThanOrEqual(1)
  })

  it('表格格内 bare <br> 既有放行不回退（#248 语义保持）', () => {
    const host = renderToDom(createMarkdownRenderer(), '| a | b |\n|---|---|\n| 一<br>二 | y |')
    expect(host.querySelectorAll('td br').length).toBeGreaterThanOrEqual(1)
  })
})

describe('不成型片段维持字面（T02 html_inline 转义降级不回退）', () => {
  it('未闭合/孤立闭/跨行：转义字面文本', () => {
    const md = createMarkdownRenderer()
    const unclosed = renderToDom(md, '未闭合 <span style="color:red">尾巴')
    expect(unclosed.querySelector('span[style]')).toBeNull()
    expect(unclosed.textContent).toContain('<span')
    const orphan = renderToDom(md, '孤立 </span> 文字')
    expect(orphan.querySelector('span')).toBeNull()
    expect(orphan.textContent).toContain('</span>')
    const crossline = renderToDom(md, '跨行 <span style="color:red">a\nb</span> 尾')
    expect(crossline.querySelector('span[style]')).toBeNull()
    expect(crossline.textContent).toContain('<span')
  })

  it('容器内 html_block 仍字面（T02 容器降级边界不回退）', () => {
    const host = renderToDom(createMarkdownRenderer(), '> <div>引用内块</div>')
    expect(host.querySelector('div')).toBeNull()
    expect(host.textContent).toContain('<div>')
  })

  it('代码上下文字面（围栏/缩进/行内代码）', () => {
    const md = createMarkdownRenderer()
    const fence = renderToDom(md, '```\n<span style="color:red">围栏</span>\n```')
    expect(fence.querySelector('span[style]')).toBeNull()
    const inline = renderToDom(md, '文字 `<span style="color:red">行内</span>` 代码')
    expect(inline.querySelector('span[style]')).toBeNull()
    expect(inline.textContent).toContain('<span')
  })
})

describe('行内片段净化（第一道闸 + 危险属性剥离）', () => {
  it('事件属性/伪造系统锚点不进场', () => {
    const host = renderToDom(
      createMarkdownRenderer(),
      'a <span style="color:red" onclick="evil()" data-vsidian-src-start="1">x</span> b',
    )
    const span = host.querySelector<HTMLSpanElement>('span[style*="color:red"]')
    expect(span).not.toBeNull()
    expect(span!.getAttribute('onclick')).toBeNull()
    expect(span!.getAttribute('data-vsidian-src-start')).toBeNull()
    expect(span!.textContent).toBe('x')
  })

  it('行内 script 片段净化为空 → 回退转义源码（可访问原始源码）', () => {
    const host = renderToDom(createMarkdownRenderer(), 'a <script>alert(1)</script> b')
    expect(host.querySelector('script')).toBeNull()
    expect(host.textContent).toContain('<script>alert(1)</script>')
  })

  it('危险协议 href 摘除', () => {
    const host = renderToDom(createMarkdownRenderer(), 'a <a href="javascript:alert(1)">链</a> b')
    const anchor = host.querySelector('a')
    expect(anchor).not.toBeNull()
    expect(anchor!.getAttribute('href')).toBeNull()
  })
})
