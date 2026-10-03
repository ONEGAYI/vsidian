// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { htmlToMarkdown } from '../../src/webview/htmlToMarkdown'
import MarkdownIt from 'markdown-it'

describe('剪贴板HTML可表达格式', () => {
  it.each([
    ['<h2>标题</h2><p>段落<br>换行</p>', '## 标题\n\n段落  \n换行'],
    ['<p><strong>粗</strong> <em>斜</em> <del>删</del></p>', '**粗** *斜* ~~删~~'],
    ['<b style="font-weight:normal"><span style="font-weight:700">Google</span></b>', '**Google**'],
    ['<span style="font-style:italic;text-decoration:line-through">格式</span>', '~~*格式*~~'],
    ['<a href="https://example.com/a?q=1&amp;b=2">文字</a>', '[文字](https://example.com/a?q=1&b=2)'],
    ['<ul><li>甲</li><li>乙<ul><li>子项</li></ul></li></ul>', '- 甲\n- 乙\n  - 子项'],
    ['<ol start="3"><li>甲</li><li>乙</li></ol>', '3. 甲\n4. 乙'],
    ['<ul><li><input type="checkbox" checked>完成</li><li><input type="checkbox">待办</li></ul>', '- [x] 完成\n- [ ] 待办'],
    ['<blockquote><p>引用</p><p>第二段</p></blockquote>', '> 引用\n>\n> 第二段'],
    ['<code>a`b</code>', '``a`b``'],
    ['<pre><code class="language-js">const a = 1\n```</code></pre>', '````js\nconst a = 1\n```\n````'],
    ['<table><tr><th>甲</th><th>乙</th></tr><tr><td>a|b</td><td>x<br>y</td></tr></table>', '| 甲 | 乙 |\n| --- | --- |\n| a\\|b | x<br>y |'],
    ['<img src="https://example.com/i.png" alt="图">', '![图](https://example.com/i.png)'],
  ])('%s -> Markdown', (html, markdown) => {
    expect(htmlToMarkdown(html)).toEqual({ markdown, hasFormatting: true })
  })
  it.each(['<p>*星号*</p>', '<span style="color:red;font-size:30px">*星号*</span>', '<b style="font-weight:normal">*星号*</b>'])('普通包装与不支持外观不当作格式：%s', (html) => {
    expect(htmlToMarkdown(html).hasFormatting).toBe(false)
  })
  it('阻止危险链接、脚本、远程资源副作用和原样HTML', () => {
    const result = htmlToMarkdown('<script>bad()</script><style>body{display:none}</style><a href="javascript:alert(1)">文字</a><img src="file:///d/a.png" alt="本地图"><iframe src="https://bad.test"></iframe>')
    expect(result.markdown).toBe('文字本地图')
    expect(result.hasFormatting).toBe(false)
  })
  it('公式及相对/临时图片保留可提取文字，不虚构LaTeX', () => {
    expect(htmlToMarkdown('<span class="katex"><annotation encoding="application/x-tex">x^2</annotation></span><img src="blob:abc" alt="图">').markdown).toBe('x^2图')
  })
  it('Reading本地图片HTTPS资源代理仅alt，持久HTTPS外链图片保留', () => {
    expect(htmlToMarkdown('<img src="https://file+.vscode-resource.vscode-cdn.net/d:/notes/a.png" alt="本地图">')).toEqual({ markdown: '本地图', hasFormatting: false })
    expect(htmlToMarkdown('<img src="https://id.vscode-webview.net/tmp/a.png" alt="临时图">').markdown).toBe('临时图')
  })
  it('复杂表格降级，不虚构合并单元格结构', () => {
    const result = htmlToMarkdown('<table><tr><td colspan="2">合并</td></tr><tr><td>甲</td><td>乙</td></tr></table>')
    expect(result.markdown).not.toContain('| ---')
    expect(result.hasFormatting).toBe(false)
  })
  it('代码块内部空行不被段落归一化折叠', () => {
    expect(htmlToMarkdown('<pre><code>a\n\n\nb</code></pre>').markdown).toBe('```\na\n\n\nb\n```')
  })
  it('格式HTML中的字面删除线/列表不被额外解释，嵌套同标记不改变语义', () => {
    const renderer = new MarkdownIt()
    const output = renderer.render(htmlToMarkdown('<p><b>粗</b> ~~字面~~</p><p>- 字面</p><p>1. 字面</p><i><em>斜体</em></i><s><del>删除</del></s>').markdown)
    const template = document.createElement('template'); template.innerHTML = output
    expect(template.content.querySelectorAll('ul,ol')).toHaveLength(0)
    expect([...template.content.querySelectorAll('strong')].map((el) => el.textContent)).toEqual(['粗'])
    expect([...template.content.querySelectorAll('em')].map((el) => el.textContent)).toEqual(['斜体'])
    expect([...template.content.querySelectorAll('s')].map((el) => el.textContent)).toEqual(['删除'])
    expect(template.content.textContent).toContain('~~字面~~')
  })
  it('父粗体内显式normal按实际样式降级，渲染普通文字不加粗', () => {
    const output = new MarkdownIt().render(htmlToMarkdown('<strong>粗<span style="font-weight:normal">普通</span>再粗</strong>').markdown)
    const template = document.createElement('template'); template.innerHTML = output
    expect([...template.content.querySelectorAll('strong')].map((el) => el.textContent)).toEqual(['粗', '再粗'])
    expect(template.content.textContent).toContain('粗普通再粗')
  })
  it('混合嵌套粗斜体保持每段实际语义，不以相邻星号叠出额外标记', () => {
    for (const html of ['<i>a<b>b</b>c</i>', '<b>a<i>b</i>c</b>']) {
      const output = new MarkdownIt().render(htmlToMarkdown(html).markdown)
      const template = document.createElement('template'); template.innerHTML = output
      expect(template.content.textContent?.trim()).toBe('abc')
      expect(template.content.querySelectorAll('strong strong,em em')).toHaveLength(0)
      const italic = template.content.querySelector('em')!
      const bold = template.content.querySelector('strong')!
      expect(italic.textContent).toBe(html.startsWith('<i>') ? 'abc' : 'b')
      expect(bold.textContent).toBe(html.startsWith('<b>') ? 'abc' : 'b')
    }
  })
})
