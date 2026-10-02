// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import { htmlToMarkdown } from '../../src/webview/htmlToMarkdown'

function rendered(html: string): DocumentFragment {
  const template = document.createElement('template')
  template.innerHTML = new MarkdownIt().render(htmlToMarkdown(html).markdown)
  return template.content
}

describe('富文本兼容包装保留既有 Markdown 语义', () => {
  // Word/Docs 形态的手写回归夹具；不作为真实软件剪贴板验收。
  it.each([
    '<section><h2>标题</h2><p>正文 <strong>粗体</strong></p><p>下一段</p></section>',
    '<b style="font-weight:normal"><h2>标题</h2><p>正文 <span style="font-weight:700">粗体</span></p><p>下一段</p></b>',
    '<article><header><h2>标题</h2></header><section><p>正文 <strong>粗体</strong></p><p>下一段</p></section></article>',
  ])('跨块包装不把标题与段落压为行内：%s', (html) => {
    const dom = rendered(html)
    expect(dom.querySelector('h2')?.textContent).toBe('标题')
    expect([...dom.querySelectorAll('p')].map(el => el.textContent)).toEqual(['正文 粗体', '下一段'])
    expect(dom.querySelector('p strong')?.textContent).toBe('粗体')
  })

  it('包装不丢引用、代码块及普通表格，也不恢复不支持的外观或脚本', () => {
    const html = '<section style="font-size:30px;color:red"><blockquote><p>引用</p></blockquote>' +
      '<pre><code class="language-js">a\n\n\nb</code></pre>' +
      '<table><tr><th>名称</th></tr><tr><td>值</td></tr></table><script>bad()</script></section>'
    const dom = rendered(html)
    expect(dom.querySelector('blockquote p')?.textContent).toBe('引用')
    expect(dom.querySelector('pre code.language-js')?.textContent).toBe('a\n\n\nb\n')
    expect(dom.querySelector('th')?.textContent).toBe('名称')
    expect(dom.querySelector('td')?.textContent).toBe('值')
    expect(dom.querySelector('script,[style]')).toBeNull()
    expect(dom.textContent).not.toContain('bad()')
  })

  it('列表及嵌套列表继承已支持的粗体和斜体，局部 normal 仍可取消', () => {
    const dom = rendered('<section style="font-weight:700"><ul><li>甲<ul><li><span style="font-weight:normal">子项</span></li></ul></li>' +
      '<li style="font-style:italic">乙</li></ul></section>')
    expect(dom.querySelectorAll('ul')).toHaveLength(2)
    expect([...dom.querySelectorAll('strong')].map(el => el.textContent)).toEqual(['甲', '乙'])
    expect(dom.querySelector('em')?.textContent).toBe('乙')
    expect(dom.querySelector('ul ul li')?.textContent).toBe('子项')
    expect(dom.querySelector('ul ul strong')).toBeNull()
  })

  it.each(['em', 'strong', 'del'])('相邻文字与标点不使 %s 标记变成字面量，也不插入空格', (tag) => {
    const selector = tag === 'del' ? 's' : tag
    for (const [html, text, formatted] of [
      [`<${tag}>(foo)</${tag}>bar`, '(foo)bar', '(foo)'],
      [`foo<${tag}>(x)</${tag}>`, 'foo(x)', '(x)'],
    ]) {
      const dom = rendered(html)
      expect(dom.textContent?.trim()).toBe(text)
      expect(dom.querySelector(selector)?.textContent).toBe(formatted)
    }
  })
})
