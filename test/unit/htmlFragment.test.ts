// #573（T08）ID 文档作用域纯逻辑契约（src/shared/htmlFragment.ts）：
// 主文档与引用文档的相同 ID 不串目标（docScope 键作用域）——引用文档
// 渲染产物的内部 ID 与片段引用（url(#id)/href="#id"）统一加 scope 前缀，
// CSS 侧（#id 选择器与 url(#id)）按同前缀协同改写；主文档（'doc'）保持
// HTML 原生全局 ID 语义零改写。不伪造宿主锚点：B 域内 # 引用一律限定 B
// 域（未命中目标不外溢到 A）。
import { describe, it, expect } from 'vitest'
import {
  htmlIdScopePrefix,
  rewriteHrefFragmentValue,
  scopeCssFragmentRefs,
  scopeSelectorIdTokens,
} from '../../src/shared/htmlFragment'

describe('htmlIdScopePrefix：前缀派生', () => {
  it('主文档（doc）与空值不改写（null）', () => {
    expect(htmlIdScopePrefix('doc')).toBeNull()
    expect(htmlIdScopePrefix(null)).toBeNull()
    expect(htmlIdScopePrefix(undefined)).toBeNull()
  })

  it('引用文档 scope 键产 CSS ident 安全前缀（ref:abc → 清洗冒号）', () => {
    expect(htmlIdScopePrefix('ref:1a2b3c4d')).toBe('vsref_1a2b3c4d--')
  })

  it('前缀对 CSS ident 与 HTML id 均合法（无转义需求）', () => {
    const p = htmlIdScopePrefix('ref:1a2b3c4d')!
    expect(p).toMatch(/^[A-Za-z][-A-Za-z0-9_]*$/)
  })
})

describe('rewriteHrefFragmentValue：href 属性的整值片段引用（URI 值语法）', () => {
  const prefix = 'vsref_1a2b3c4d--'

  it('整值片段引用（#id）加前缀', () => {
    expect(rewriteHrefFragmentValue('#g1', prefix)).toBe(`#${prefix}g1`)
  })

  it('空串与空片段（#）不动作', () => {
    expect(rewriteHrefFragmentValue('', prefix)).toBe('')
    expect(rewriteHrefFragmentValue('#', prefix)).toBe('#')
  })

  it('外部 URL 与非引用值不动作（http/相对路径/data:）', () => {
    expect(rewriteHrefFragmentValue('https://example.com/a.svg#frag', prefix)).toBe('https://example.com/a.svg#frag')
    expect(rewriteHrefFragmentValue('pic.png', prefix)).toBe('pic.png')
    expect(rewriteHrefFragmentValue('data:image/png;base64,iVBORw0KGgo=', prefix)).toBe('data:image/png;base64,iVBORw0KGgo=')
  })

  it('值内 url(#id) 不是 href 语义（URL 属性不含 CSS 函数——归 CSS 值面处理，此处不动作）', () => {
    expect(rewriteHrefFragmentValue('url(#grad)', prefix)).toBe('url(#grad)')
  })

  it('前缀为 null（主文档）原样返回', () => {
    expect(rewriteHrefFragmentValue('#g1', null)).toBe('#g1')
  })
})

describe('scopeCssFragmentRefs：CSS 文本内 url(#id) 协同', () => {
  const prefix = 'vsref_1a2b3c4d--'

  it('url(#id) 产加前缀（裸与引号形态）', () => {
    expect(scopeCssFragmentRefs('.a { fill: url(#g) }', prefix)).toBe(`.a { fill: url(#${prefix}g) }`)
    expect(scopeCssFragmentRefs('.a { fill: url("#g") }', prefix)).toBe(`.a { fill: url("#${prefix}g") }`)
    expect(scopeCssFragmentRefs(".a { fill: url('#g') }", prefix)).toBe(`.a { fill: url('#${prefix}g') }`)
  })

  it('字符串字面量内的 url(#x) 不是产（content: "url(#x)" 不改写）', () => {
    expect(scopeCssFragmentRefs('.a { content: "url(#x)" }', prefix)).toBe('.a { content: "url(#x)" }')
  })

  it('注释内不改写；http/相对 url() 不动作', () => {
    expect(scopeCssFragmentRefs('.a { /* url(#x) */ fill: red }', prefix)).toBe('.a { /* url(#x) */ fill: red }')
    expect(scopeCssFragmentRefs('.a { background: url(bg.png) }', prefix)).toBe('.a { background: url(bg.png) }')
    expect(scopeCssFragmentRefs('.a { background: url(https://e.com/x#f) }', prefix)).toBe('.a { background: url(https://e.com/x#f) }')
  })

  it('前缀为 null（主文档）原样返回', () => {
    expect(scopeCssFragmentRefs('.a { fill: url(#g) }', null)).toBe('.a { fill: url(#g) }')
  })

  it('paint 属性值面（#576 评审 P2）：整值 #rrggbb 是颜色不是片段引用——零动作', () => {
    expect(scopeCssFragmentRefs('#ff0000', 'vsref_1a2b3c4d--')).toBe('#ff0000')
    expect(scopeCssFragmentRefs('#0f0', 'vsref_1a2b3c4d--')).toBe('#0f0')
  })

  it('paint 属性值面：url(#id) 引号形态改写且引号保形（单双引号）', () => {
    expect(scopeCssFragmentRefs("url('#g')", 'vsref_1a2b3c4d--')).toBe(`url('#vsref_1a2b3c4d--g')`)
    expect(scopeCssFragmentRefs('url("#g")', 'vsref_1a2b3c4d--')).toBe(`url("#vsref_1a2b3c4d--g")`)
  })

  it('paint 属性值面：颜色与片段引用共存只动引用（url(#g1) #fff）', () => {
    expect(scopeCssFragmentRefs('url(#g1) #fff', 'vsref_1a2b3c4d--')).toBe(`url(#vsref_1a2b3c4d--g1) #fff`)
  })
})

describe('scopeSelectorIdTokens：选择器 #id 协同', () => {
  const prefix = 'vsref_1a2b3c4d--'

  it('简单 id 选择器加前缀', () => {
    expect(scopeSelectorIdTokens('#hdr', prefix)).toBe(`#${prefix}hdr`)
  })

  it('复合选择器内 id 项（div > #a:hover）', () => {
    expect(scopeSelectorIdTokens('div > #a:hover', prefix)).toBe(`div > #${prefix}a:hover`)
  })

  it('逗号列表与 :is() 内 id', () => {
    expect(scopeSelectorIdTokens('#a, .b', prefix)).toBe(`#${prefix}a, .b`)
    expect(scopeSelectorIdTokens(':is(#a, .b) p', prefix)).toBe(`:is(#${prefix}a, .b) p`)
  })

  it('属性选择器字符串内的 # 不动作（[href="#x"]）', () => {
    expect(scopeSelectorIdTokens('[href="#x"]', prefix)).toBe('[href="#x"]')
  })

  it('类选择器（.a）与标签不受影响', () => {
    expect(scopeSelectorIdTokens('.a p', prefix)).toBe('.a p')
    expect(scopeSelectorIdTokens('rect[fill]', prefix)).toBe('rect[fill]')
  })

  it('前缀为 null（主文档）原样返回', () => {
    expect(scopeSelectorIdTokens('#hdr .a', null)).toBe('#hdr .a')
  })
})
