// @vitest-environment jsdom
// #573（T08）SVG/MathML 与混合命名空间的净化矩阵（第一道闸 DOMPurify
// 配置面契约）：命名空间内浏览器可用语义保留（几何/文字/渐变引用/滤镜/
// 动画/use 引用/foreignObject 混合 HTML/MathML 结构），命名空间内脚本/
// 事件/危险资源拒绝（不能只查 HTMLElement 就放过其他命名空间）。证据链：
// out/test/t08-purify-probe*.log（DOMPurify 3.4.16 默认面不含 foreignObject/
// use/SMIL 动画；HTML_INTEGRATION_POINTS 默认只有 annotation-xml，配置须
// 对象形态 + 小写键才命中——见 htmlSanitize.ts 实施注释）。
import { describe, it, expect } from 'vitest'
import { sanitizeHtmlBlockMarkup } from '../../src/webview/htmlSanitize'

describe('SVG/MathML 命名空间净化：浏览器可用语义保留', () => {
  it('SVG 基本几何与呈现属性（fill/stroke/rx/viewBox）', () => {
    const out = sanitizeHtmlBlockMarkup('<svg width="40" height="40" viewBox="0 0 40 40"><rect x="2" y="2" width="20" height="20" rx="3" fill="#0a0"/><circle cx="30" cy="10" r="8" stroke="blue" stroke-width="2"/></svg>')
    expect(out).toContain('<rect')
    expect(out).toContain('rx="3"')
    expect(out).toContain('viewBox="0 0 40 40"')
    expect(out).toContain('stroke-width="2"')
  })

  it('SVG 文字（text x/y/dx/dy/textPath path/startOffset）', () => {
    const out = sanitizeHtmlBlockMarkup('<svg><text x="1" y="10" font-size="12" text-anchor="middle" dx="1" dy="2">hi</text><textPath path="M0,0" startOffset="10%">t</textPath></svg>')
    expect(out).toContain('<text')
    expect(out).toContain('text-anchor="middle"')
    expect(out).toContain('<textPath')
    expect(out).toContain('startOffset="10%"')
  })

  it('SVG 渐变/滤镜/裁剪引用（linearGradient/stop/filter/clipPath + url(#id)）', () => {
    const out = sanitizeHtmlBlockMarkup('<svg><defs><linearGradient id="g" gradientTransform="rotate(90)"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient><filter id="f"><feGaussianBlur stdDeviation="2"/><feOffset dx="1" dy="1"/></filter><clipPath id="c"><rect width="10" height="10"/></clipPath></defs><rect fill="url(#g)" filter="url(#f)" clip-path="url(#c)" width="10" height="10"/></svg>')
    expect(out).toContain('<linearGradient')
    expect(out).toContain('gradientTransform="rotate(90)"')
    expect(out).toContain('<stop')
    expect(out).toContain('<feGaussianBlur')
    expect(out).toContain('<clipPath')
    expect(out).toContain('fill="url(#g)"')
    expect(out).toContain('filter="url(#f)"')
    expect(out).toContain('clip-path="url(#c)"')
  })

  it('SMIL 动画几何语义（animate/animateTransform 的 attributeName=几何目标）', () => {
    const out = sanitizeHtmlBlockMarkup('<svg><rect width="10" height="10"><animate attributeName="x" from="0" to="10" dur="2s" repeatCount="indefinite" begin="0s"/><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="4s"/></rect></svg>')
    expect(out).toContain('<animate')
    expect(out).toContain('attributeName="x"')
    expect(out).toContain('repeatCount="indefinite"')
    expect(out).toContain('<animateTransform')
    expect(out).toContain('type="rotate"')
  })

  it('use 同文档引用（href 与旧 xlink:href 两形态）', () => {
    const out = sanitizeHtmlBlockMarkup('<svg><defs><path id="p" d="M0,0 L10,10"/></defs><use href="#p"/><use xlink:href="#p"/></svg>')
    expect(out).toContain('<use href="#p"')
    expect(out).toContain('<use xlink:href="#p"')
  })

  it('SVG image 外部引用属性（href 与 xlink:href）', () => {
    const out = sanitizeHtmlBlockMarkup('<svg><image href="pic.png" width="10" height="10"/><image xlink:href="pic2.png" width="10" height="10"/></svg>')
    expect(out).toContain('<image href="pic.png"')
    expect(out).toContain('xlink:href="pic2.png"')
  })

  it('SVG image 的 data:image 引用保留（等同 img data: 白名单）', () => {
    const out = sanitizeHtmlBlockMarkup('<svg><image href="data:image/png;base64,iVBORw0KGgo=" width="10" height="10"/></svg>')
    expect(out).toContain('data:image/png')
  })

  it('SVG style 属性与 class 保留（含 url(#id) 引用）', () => {
    const out = sanitizeHtmlBlockMarkup('<svg><rect class="cls" style="fill: url(#g); stroke: red" width="5" height="5"/></svg>')
    expect(out).toContain('class="cls"')
    expect(out).toContain('fill: url(#g)')
    expect(out).toContain('stroke: red')
  })

  it('SVG a 链接（svg 命名空间 a 的 https href 保留）', () => {
    const out = sanitizeHtmlBlockMarkup('<svg><a href="https://example.com"><text>x</text></a></svg>')
    expect(out).toContain('href="https://example.com"')
  })

  it('foreignObject 混合 HTML（div/p/b/style 属性按 HTML 白名单放行）', () => {
    const out = sanitizeHtmlBlockMarkup('<svg><foreignObject width="50" height="20"><div xmlns="http://www.w3.org/1999/xhtml"><p style="color:red">html</p><b>bold</b></div></foreignObject></svg>')
    expect(out).toContain('<foreignObject')
    expect(out).toContain('<div')
    expect(out).toContain('<p style="color:red"')
    expect(out).toContain('<b>bold</b>')
  })

  it('foreignObject 内 img 的 src/srcset 保留（资源管线可装配）', () => {
    const out = sanitizeHtmlBlockMarkup('<svg><foreignObject width="50" height="20"><div xmlns="http://www.w3.org/1999/xhtml"><img src="pic.png" alt="x" srcset="a.png 1x, b.png 2x"></div></foreignObject></svg>')
    expect(out).toContain('src="pic.png"')
    expect(out).toContain('srcset="a.png 1x, b.png 2x"')
  })

  it('MathML 结构（mrow/msup/mfrac/msqrt/mi/mo/mn）', () => {
    const out = sanitizeHtmlBlockMarkup('<math display="block"><mrow><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mfrac><mn>1</mn><mi>y</mi></mfrac><msqrt><mn>2</mn></msqrt></mrow></math>')
    expect(out).toContain('<math')
    expect(out).toContain('display="block"')
    expect(out).toContain('<msup>')
    expect(out).toContain('<mfrac>')
    expect(out).toContain('<msqrt>')
    expect(out).toContain('<mi>x</mi>')
  })

  it('MathML 属性（mathvariant/lspace/mstyle displaystyle）', () => {
    const out = sanitizeHtmlBlockMarkup('<math><mi mathvariant="bold">x</mi><mo lspace="thinmathspace">+</mo><mstyle displaystyle="true"><mrow/></mstyle></math>')
    expect(out).toContain('mathvariant="bold"')
    expect(out).toContain('lspace="thinmathspace"')
    expect(out).toContain('displaystyle="true"')
  })
})

describe('SVG/MathML 命名空间净化：脚本/事件/危险资源拒绝', () => {
  it('svg 命名空间内 script 移除（不能只查 HTMLElement）', () => {
    const out = sanitizeHtmlBlockMarkup('<svg><circle r="8"/><script>alert(1)</script></svg>')
    expect(out).not.toContain('<script')
    expect(out).toContain('<circle')
  })

  it('svg 根与图形元素的事件属性移除（onload/onclick）', () => {
    const out = sanitizeHtmlBlockMarkup('<svg onload="alert(1)"><rect onclick="evil()" width="5" height="5"/></svg>')
    expect(out).not.toContain('onload')
    expect(out).not.toContain('onclick')
    expect(out).toContain('<rect')
  })

  it('svg a 的危险协议拒绝（href 与 xlink:href 两形态）', () => {
    const out = sanitizeHtmlBlockMarkup('<svg><a href="javascript:alert(1)"><text>x</text></a><a xlink:href="javascript:alert(1)"><text>y</text></a></svg>')
    expect(out).not.toContain('javascript:')
    expect(out).toContain('<a')
  })

  it('use 引用危险目标拒绝（javascript:/data:image/svg+xml）', () => {
    const out = sanitizeHtmlBlockMarkup('<svg><use href="javascript:alert(1)"/><use href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="/><use xlink:href="javascript:alert(1)"/></svg>')
    expect(out).not.toContain('javascript:')
    expect(out).not.toContain('data:image/svg+xml')
  })

  it('动画目标劫持拒绝（attributeName 指向 href 族——含大小写与带前缀形态）', () => {
    const out = sanitizeHtmlBlockMarkup('<svg><a><text>x</text><animate attributeName="href" values="javascript:alert(1)" dur="1s"/></a><a><text>y</text><animate attributeName="XLINK:HREF" from="javascript:alert(1)"/></a><rect width="5" height="5"><animate attributeName="xlink:href" from="javascript:alert(1)" to="x"/></rect></svg>')
    // 劫持向量 = attributeName 完整保留 + 动画值在场；两条件同时在场才危险
    expect(out).not.toMatch(/attributeName="(href|XLINK:HREF|xlink:href)"/)
    expect(out).not.toContain('javascript:')
  })

  it('动画事件属性劫持拒绝（set/animate attributeName=onload）', () => {
    const out = sanitizeHtmlBlockMarkup('<svg><rect width="5" height="5"><set attributeName="onload" to="alert(1)"/></rect><circle r="4"><animate attributeName="onclick" to="evil()"/></circle></svg>')
    expect(out).not.toMatch(/attributeName="on(load|click)"/)
    expect(out).not.toContain('alert(1)')
    expect(out).not.toContain('evil()')
  })

  it('image 的 data:text/html 拒绝（HTML 载荷不可经 SVG image 洗白）', () => {
    const out = sanitizeHtmlBlockMarkup('<svg><image href="data:text/html,<script>alert(1)</script>" width="10" height="10"/></svg>')
    expect(out).not.toContain('data:text/html')
  })

  it('foreignObject 内 HTML 走同一净化管线（script/事件/iframe/危险协议拒）', () => {
    const out = sanitizeHtmlBlockMarkup('<svg><foreignObject width="50" height="20"><div xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script><img src="x" onerror="evil()"><p onclick="evil()">p</p><iframe src="https://evil.example"></iframe><a href="javascript:evil()">a</a></div></foreignObject></svg>')
    expect(out).toContain('<foreignObject')
    expect(out).toContain('<div')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('onerror')
    expect(out).not.toContain('onclick')
    // #572（T07）合并语义：foreignObject 内 iframe 走同一白名单与
    // sandbox 系统强制面（https 远端帧仅 allow-scripts + 系统标记——
    // 与正文 iframe 同一净化管线；写于 iframe 全局禁时代的「整体拒绝」
    // 期望随 T07 白名单放行而对齐合并契约，两票在同一工作树交汇的
    // 调整，见 INBOX-t07）
    expect(out).toContain('<iframe')
    expect(out).toContain('sandbox="allow-scripts"')
    expect(out).toContain('data-vsidian-iframe="1"')
    expect(out).not.toContain('javascript:')
    expect(out).toContain('<p>p</p>')
  })

  it('foreignObject 内伪造系统锚点剥离（data-vsidian-* 同一 hook）', () => {
    const out = sanitizeHtmlBlockMarkup('<svg><foreignObject><div xmlns="http://www.w3.org/1999/xhtml" data-vsidian-doc-scope="fake">x</div></foreignObject></svg>')
    expect(out).not.toContain('data-vsidian-doc-scope')
    expect(out).toContain('>x<')
  })

  it('svg/foreignObject 内 style 元素不随 DOM 放行（T04 收集器双通道）', () => {
    const out = sanitizeHtmlBlockMarkup('<svg><style>rect{fill:red}</style><rect width="5" height="5"/><foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><style>p{color:red}</style><p>x</p></div></foreignObject></svg>')
    expect(out).not.toContain('<style')
    expect(out).toContain('<rect')
    expect(out).toContain('<p>x</p>')
  })

  it('MathML maction 的 actiontype 脚本向量拒绝', () => {
    const out = sanitizeHtmlBlockMarkup('<math><maction actiontype="statusline#javascript:alert(1)"><mi>x</mi></maction></math>')
    expect(out).not.toContain('javascript:')
    expect(out).not.toContain('actiontype')
  })

  it('script-only SVG 净化后无脚本残留（空 svg 壳零内容无害）', () => {
    const out = sanitizeHtmlBlockMarkup('<svg><script>alert(1)</script></svg>')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('alert')
  })
})
