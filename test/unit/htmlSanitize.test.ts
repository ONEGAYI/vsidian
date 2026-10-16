// @vitest-environment jsdom
// 内容净化边界契约（#567/T02，ADR-0019 决定 5）：html 块源文进 DOM 前经
// DOMPurify 白名单净化（第一道闸），现行 sanitizeReadingDom 黑名单保留为
// 防御纵深（第二道闸）。契约面：
// - 合规 HTML 通过（含 colspan/rowspan 合并单元格、details/summary、
//   SVG/MathML 安全子集——全量支持目标的方向基线）
// - script 执行能力拒绝、事件属性拒绝、危险协议链接拒绝
// - 系统自身 data-vsidian-* 锚点不被源文伪造（源文带该前缀一律剥离；
//   系统装配生成的锚点不在净化输入内，天然不误删）
// - <style> 元素不随 DOM 净化放行（T04 收集器独立抽取装载——双通道）
// - 净化后为空的片段（script-only 等）回退为转义源码（可访问原始源码）
import { describe, it, expect } from 'vitest'
import {
  sanitizeHtmlBlockMarkup,
  htmlBlockRenderHtml,
  HTML_SOURCE_FALLBACK_CLASS,
} from '../../src/webview/htmlSanitize'

describe('sanitizeHtmlBlockMarkup：白名单净化（第一道闸）', () => {
  it('合并单元格表格原样通过（colspan/rowspan 保留）', () => {
    const src = '<table>\n  <tr>\n    <td colspan="2" rowspan="3">合并</td>\n    <td>普通</td>\n  </tr>\n</table>'
    const out = sanitizeHtmlBlockMarkup(src)
    expect(out).toContain('<td colspan="2" rowspan="3">')
    expect(out).toContain('<table>')
    expect(out).toContain('合并')
  })

  it('结构类元素与全局属性通过（div/section/style 属性/class/id/title）', () => {
    const out = sanitizeHtmlBlockMarkup('<section id="s" class="c" title="t" style="color:red"><p style="text-align:center">x</p></section>')
    expect(out).toContain('<section id="s" class="c" title="t" style="color:red">')
    expect(out).toContain('<p style="text-align:center">x</p>')
  })

  it('交互语义标签通过（details/summary/open、列表属性）', () => {
    const out = sanitizeHtmlBlockMarkup('<details open><summary>题</summary><ol start="3" reversed><li>a</li></ol></details>')
    expect(out).toContain('<details open')
    expect(out).toContain('<summary>题</summary>')
    expect(out).toContain('<ol start="3" reversed')
  })

  it('SVG 与 MathML 命名空间内容通过安全子集', () => {
    const out = sanitizeHtmlBlockMarkup('<svg width="20" height="20"><circle cx="10" cy="10" r="8"></circle></svg><math><mi>x</mi></math>')
    expect(out).toContain('<circle')
    expect(out).toContain('<math>')
    expect(out).toContain('<mi>x</mi>')
  })

  it('script 元素移除（不执行能力）', () => {
    const out = sanitizeHtmlBlockMarkup('<div>前</div><script>alert(1)</script><div>后</div>')
    expect(out).not.toContain('<script')
    expect(out).toContain('<div>前</div>')
    expect(out).toContain('<div>后</div>')
  })

  it('行内事件属性移除（onclick/onerror/onload）', () => {
    const out = sanitizeHtmlBlockMarkup('<div onclick="evil()" onerror="evil()">x</div><img src="a.png" onerror="evil()">')
    expect(out).not.toContain('onclick')
    expect(out).not.toContain('onerror')
    expect(out).toContain('<div>x</div>')
  })

  it('危险协议链接拒绝（javascript:/vbscript:/data:text/html）', () => {
    const out = sanitizeHtmlBlockMarkup('<a href="javascript:evil()">a</a><a href="vbscript:x">b</a><a href="data:text/html,x">c</a><a href="https://ok">好</a>')
    expect(out).not.toContain('javascript:')
    expect(out).not.toContain('vbscript:')
    expect(out).not.toContain('data:text/html')
    expect(out).toContain('href="https://ok"')
  })

  it('源文自带的 data-vsidian-* 一律剥离（不可伪造系统锚点）', () => {
    const out = sanitizeHtmlBlockMarkup('<div data-vsidian-src-start="9" data-vsidian-doc-scope="fake" data-keep="1">x</div>')
    expect(out).not.toContain('data-vsidian-src-start')
    expect(out).not.toContain('data-vsidian-doc-scope')
    expect(out).toContain('data-keep="1"')
  })

  it('<style> 元素不随 DOM 净化放行（T04 收集器独立通道）', () => {
    const out = sanitizeHtmlBlockMarkup('<div>d</div><style>body { color: red; }</style>')
    expect(out).not.toContain('<style')
    expect(out).toContain('<div>d</div>')
  })

  it('净化后为空（script-only 等）返回空串——调用方回退转义源码', () => {
    expect(sanitizeHtmlBlockMarkup('<script>alert(1)</script>')).toBe('')
    expect(sanitizeHtmlBlockMarkup('<style>s{}</style>')).toBe('')
  })

  it('注释不出现在净化产物（两态一致：Live 常显源码、渲染态无注释噪声）', () => {
    const out = sanitizeHtmlBlockMarkup('<div>a</div><!-- 噪声 -->')
    expect(out).not.toContain('噪声')
  })
})

describe('htmlBlockRenderHtml：块渲染 HTML 装配（净化 + 降级回退）', () => {
  it('可安全呈现的块产出净化 HTML（供 innerHTML 装配）', () => {
    const html = htmlBlockRenderHtml('<table><tr><td>x</td></tr></table>')
    expect(html).toContain('<table>')
    expect(html).not.toContain(HTML_SOURCE_FALLBACK_CLASS)
  })

  it('净化后为空的块回退转义源码（源文可访问，不吞不执行）', () => {
    const html = htmlBlockRenderHtml('<script>alert("逃逸")</script>')
    expect(html).toContain(HTML_SOURCE_FALLBACK_CLASS)
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script')
  })
})
