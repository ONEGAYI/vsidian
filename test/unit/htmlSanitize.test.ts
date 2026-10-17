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
// - #572（T07）iframe：白名单放行 + sandbox/权限面系统强制（作者值恒被
//   覆盖）+ srcdoc 内容递归净化（属性值不过标签层——第二净化通道）
import { describe, it, expect } from 'vitest'
import {
  sanitizeHtmlBlockMarkup,
  htmlBlockRenderHtml,
  HTML_SOURCE_FALLBACK_CLASS,
  IFRAME_APPROVED_ATTR,
  IFRAME_REMOTE_SANDBOX,
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

  // #571（T06）表单与媒体矩阵：DOMPurify 默认白名单已放行全族标签与安全
  // 属性（此处为契约钉住——防止后续收紧配置时静默丢族）；导航/聚焦类
  // 属性（formaction/autofocus）默认剥离是安全姿态，一并钉住。
  it('表单控件族通过（form/label/input/select/optgroup/option/textarea/button/fieldset/legend/datalist/output/progress/meter + 控件属性）', () => {
    const out = sanitizeHtmlBlockMarkup(
      '<form action="/x" method="post">' +
      '<label for="i">L</label>' +
      '<input id="i" type="text" value="v" placeholder="p" required>' +
      '<select name="s"><option value="1" selected>一</option><optgroup label="g"><option value="2">二</option></optgroup></select>' +
      '<textarea rows="3" cols="4">t</textarea>' +
      '<button type="submit">Go</button><button type="reset">R</button>' +
      '<input type="checkbox" checked><input type="radio" name="r" checked>' +
      '<input type="file" accept=".png"><input type="number" min="1" max="9" step="2" value="3">' +
      '<input type="range" value="5"><input type="color" value="#ff0000"><input type="date" value="2026-01-01">' +
      '<datalist id="d"><option value="x"></datalist>' +
      '<fieldset><legend>lg</legend><p>in</p></fieldset>' +
      '<output>o</output><progress value="7" max="10"></progress><meter value="0.5"></meter>' +
      '</form>',
    )
    expect(out).toContain('<form action="/x" method="post">')
    expect(out).toContain('<input id="i" type="text" value="v" placeholder="p" required')
    expect(out).toContain('<option value="1" selected')
    expect(out).toContain('<optgroup label="g">')
    expect(out).toContain('<textarea rows="3" cols="4">t</textarea>')
    expect(out).toContain('<button type="submit">Go</button>')
    expect(out).toContain('<input type="checkbox" checked')
    expect(out).toContain('<input type="file" accept=".png">')
    expect(out).toContain('<input type="number" min="1" max="9" step="2" value="3">')
    expect(out).toContain('<fieldset><legend>lg</legend>')
    expect(out).toContain('<progress value="7" max="10">')
    expect(out).toContain('<meter value="0.5">')
  })

  it('媒体族通过（audio/video/source/track + 装载与控件属性）', () => {
    const out = sanitizeHtmlBlockMarkup(
      '<video src="a.mp4" controls autoplay loop muted preload="metadata" poster="p.jpg" width="320" height="240" playsinline>' +
      '<track kind="subtitles" src="a.vtt" srclang="zh" label="中" default>' +
      '<source src="b.webm" type="video/webm">fallback</video>' +
      '<audio src="c.mp3" controls loop preload="auto"><source src="d.ogg" type="audio/ogg"></audio>',
    )
    expect(out).toContain('<video src="a.mp4" controls')
    expect(out).toContain('autoplay')
    expect(out).toContain('poster="p.jpg"')
    expect(out).toContain('playsinline')
    expect(out).toContain('<track kind="subtitles" src="a.vtt" srclang="zh" label="中" default')
    expect(out).toContain('<source src="b.webm" type="video/webm">')
    expect(out).toContain('<audio src="c.mp3" controls')
  })

  it('表单与媒体的负向：导航/聚焦/执行面恒拒（formaction/autofocus/on*/javascript: 媒体地址）', () => {
    const out = sanitizeHtmlBlockMarkup(
      '<form onsubmit="evil()" action="javascript:x"><button formaction="https://a/b">Go</button></form>' +
      '<input onfocus="evil()" autofocus>' +
      '<video src="javascript:evil()"></video>' +
      '<source onerror="evil()" src="a.mp4">' +
      '<input type="image" formaction="javascript:y" src="i.png">',
    )
    expect(out).not.toContain('onsubmit')
    expect(out).not.toContain('onfocus')
    expect(out).not.toContain('onerror')
    expect(out).not.toContain('formaction')
    expect(out).not.toContain('autofocus')
    expect(out).not.toContain('javascript:')
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


describe('#572（T07）iframe：白名单放行与 sandbox/权限面系统强制', () => {
  /** 从净化产物解析出 iframe 元素（断言读属性不读字符串子串） */
  function iframeOf(markup: string): HTMLIFrameElement {
    const doc = new DOMParser().parseFromString(markup, 'text/html')
    const frame = doc.querySelector('iframe')
    expect(frame, `产物应有 iframe（实际 ${markup}）`).not.toBeNull()
    return frame!
  }

  it('iframe 通过白名单（src/title/width/height 等呈现属性保留）', () => {
    const out = sanitizeHtmlBlockMarkup('<iframe src="https://example.com/embed" title="嵌入" width="320" height="180"></iframe>')
    const frame = iframeOf(out)
    expect(frame.getAttribute('src')).toBe('https://example.com/embed')
    expect(frame.getAttribute('title')).toBe('嵌入')
    expect(frame.getAttribute('width')).toBe('320')
    expect(frame.getAttribute('height')).toBe('180')
  })

  it('https 远端帧：sandbox 强制为仅 allow-scripts（作者值恒被覆盖），referrerpolicy=no-referrer', () => {
    const out = sanitizeHtmlBlockMarkup(
      '<iframe src="https://example.com" sandbox="allow-scripts allow-same-origin allow-top-navigation allow-forms"></iframe>')
    const frame = iframeOf(out)
    expect(frame.getAttribute('sandbox')).toBe(IFRAME_REMOTE_SANDBOX)
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin')
    expect(frame.getAttribute('sandbox')).not.toContain('allow-top-navigation')
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer')
  })

  it('相对路径形态（本地可控页面）：sandbox 零 token（笔记可控内容结构性禁脚本）', () => {
    const out = sanitizeHtmlBlockMarkup('<iframe src="page.html" sandbox="allow-scripts"></iframe>')
    expect(iframeOf(out).getAttribute('sandbox')).toBe('')
  })

  it('srcdoc 形态：sandbox 零 token（srcdoc 是笔记本体——脚本禁执行）', () => {
    const out = sanitizeHtmlBlockMarkup('<iframe srcdoc="<b>x</b>" sandbox="allow-scripts"></iframe>')
    expect(iframeOf(out).getAttribute('sandbox')).toBe('')
  })

  it('明文 http 与无 src 形态：sandbox 零 token（http 帧生产被 CSP 拦截，不放行脚本面）', () => {
    const out = sanitizeHtmlBlockMarkup('<div><iframe src="http://example.com"></iframe><iframe loading="lazy"></iframe></div>')
    const frames = new DOMParser().parseFromString(out, 'text/html').querySelectorAll('iframe')
    expect(frames.length).toBe(2)
    for (const frame of frames) {
      expect(frame.getAttribute('sandbox')).toBe('')
    }
  })

  it('权限面剥除：allow/allowfullscreen/allowpaymentrequest 不进产物（子文档零本地权限）', () => {
    const out = sanitizeHtmlBlockMarkup(
      '<iframe src="https://example.com" allow="camera; geolocation; fullscreen" allowfullscreen allowpaymentrequest></iframe>')
    expect(out).not.toContain('allow="')
    expect(out).not.toContain('allowfullscreen')
    expect(out).not.toContain('allowpaymentrequest')
    expect(out).not.toContain('camera')
  })

  it('系统标记在场：净化产物携带 IFRAME_APPROVED_ATTR（第二道闸豁免面）', () => {
    const out = sanitizeHtmlBlockMarkup('<iframe src="page.html"></iframe>')
    expect(iframeOf(out).getAttribute(IFRAME_APPROVED_ATTR)).not.toBeNull()
  })

  it('file: src 剥除（DOMPurify 默认协议面——无效地址矩阵，资源层不越权）', () => {
    const out = sanitizeHtmlBlockMarkup('<iframe src="file:///d:/notes/x.html"></iframe>')
    expect(iframeOf(out).getAttribute('src')).toBe(null)
  })

  it('作者伪造系统标记被剥离（源文 data-vsidian-* 不进场；系统值在属性过滤后写入）', () => {
    const out = sanitizeHtmlBlockMarkup('<span data-vsidian-iframe="1">fake</span>')
    expect(out).not.toContain('data-vsidian-iframe')
  })
})

describe('#572（T07）iframe srcdoc：内容递归净化（属性值不过标签层）', () => {
  function srcdocOf(markup: string): string {
    return iframeOf2(markup).getAttribute('srcdoc') ?? ''
  }
  function iframeOf2(markup: string): HTMLIFrameElement {
    const doc = new DOMParser().parseFromString(markup, 'text/html')
    const frame = doc.querySelector('iframe')
    expect(frame, `产物应有 iframe（实际 ${markup}）`).not.toBeNull()
    return frame!
  }

  it('合规 srcdoc 内容原样保留（样式/结构照常）', () => {
    const inner = '<style>.x { color: red; }</style><p>段</p>'
    const out = sanitizeHtmlBlockMarkup(`<iframe srcdoc="${inner.replace(/"/g, '&quot;')}"></iframe>`)
    const value = srcdocOf(out)
    expect(value).toContain('<style>')
    expect(value).toContain('<p>段</p>')
  })

  it('srcdoc 内 script 与事件属性剥除（笔记本体脚本禁执行的属性面）', () => {
    const inner = '<script>evil()</script><img src="x" onerror="evil()"><b>ok</b>'
    const out = sanitizeHtmlBlockMarkup(`<iframe srcdoc="${inner.replace(/"/g, '&quot;')}"></iframe>`)
    const value = srcdocOf(out)
    expect(value).not.toContain('<script')
    expect(value).not.toContain('onerror')
    expect(value).toContain('<b>ok</b>')
  })

  it('srcdoc 内嵌套 iframe 拒绝（递归装载攻击面封死——嵌套帧无既有需求）', () => {
    const inner = '<iframe srcdoc="<i>inner</i>"></iframe><b>ok</b>'
    const out = sanitizeHtmlBlockMarkup(`<iframe srcdoc="${inner.replace(/"/g, '&quot;')}"></iframe>`)
    const value = srcdocOf(out)
    expect(value.toLowerCase()).not.toContain('<iframe')
    expect(value).toContain('<b>ok</b>')
  })

  it('srcdoc 内危险协议链接剥除与系统锚点伪造剥离', () => {
    const inner = '<a href="javascript:evil()">a</a><span data-vsidian-doc-scope="fake">b</span><a href="https://ok">c</a>'
    const out = sanitizeHtmlBlockMarkup(`<iframe srcdoc="${inner.replace(/"/g, '&quot;')}"></iframe>`)
    const value = srcdocOf(out)
    expect(value).not.toContain('javascript:')
    expect(value).not.toContain('data-vsidian-doc-scope')
    expect(value).toContain('href="https://ok"')
  })
})

