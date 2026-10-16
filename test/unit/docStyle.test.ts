// @vitest-environment jsdom
// #569（T04）全文文档样式装载契约：收集器（源文顺序 + 语法上下文排除）、
// b2 改写器（:where():is() 零特异性 + 伪元素拆分 + at-rule 递归/保留矩阵
// + CSS 嵌套 & 代换）、身份键派生（主文档 'doc' / 嵌入视图
// canonicalRefTargetKey 派生）。规格「CSS 原意与作用域」；T01 探针
// （docs/research/html-css-scope-probe.md）b2 路线生产化。
//
// 红测纪律：本文件先于实现编写——collectDocumentStyles /
// rewriteDocumentStyleCss / docScopeKeyOf 尚不存在，import 即红。
import { describe, it, expect } from 'vitest'
import {
  collectDocumentStyles,
  docScopeKeyOf,
  rewriteDocStyleRuleTree,
  MAIN_DOC_SCOPE,
} from '../../src/shared/docStyle'
import { rewriteDocumentStyleCss } from '../../src/webview/docStyleLoader'

const cssOf = (text: string): string[] => collectDocumentStyles(text).map((s) => s.css)

describe('收集器：全文源码顺序与语法上下文排除', () => {
  it('纯 style 块：内容与源文区间（from=开标签起点，to=闭标签终点）', () => {
    const text = '前文。\n\n<style>\np { color: red }\n</style>\n\n后文。'
    const out = collectDocumentStyles(text)
    expect(out).toHaveLength(1)
    expect(out[0]!.css).toBe('\np { color: red }\n')
    expect(text.slice(out[0]!.from, out[0]!.to)).toBe('<style>\np { color: red }\n</style>')
  })

  it('多处 style 块按源码顺序收集（层叠顺序的证据基座）', () => {
    const out = collectDocumentStyles('<style>a{color:1}</style>\n\n<style>b{color:2}</style>')
    expect(out.map((s) => s.css)).toEqual(['a{color:1}', 'b{color:2}'])
  })

  it('混排 HTML 块内的 style（div 包裹）也收集', () => {
    expect(cssOf('<div>\n<style>x{}</style>\n</div>')).toEqual(['x{}'])
  })

  it('行内 <style>（段落文字中的 HTMLTag 对之间）收集', () => {
    expect(cssOf('段落 <style>p{color:red}</style> 继续。')).toEqual(['p{color:red}'])
  })

  it('引用块内的 style 收集（容器内降级为源码呈现，但样式仍属全文源文）', () => {
    expect(cssOf('> <style>q{}</style>')).toEqual(['q{}'])
  })

  it('围栏代码排除', () => {
    expect(cssOf('```\n<style>fenced{}</style>\n```')).toEqual([])
  })

  it('缩进代码块排除（独立缩进上下文）', () => {
    expect(cssOf('    <style>indented{}</style>')).toEqual([])
  })

  it('行内代码排除', () => {
    expect(cssOf('文字 `<style>code{}</style>` 字。')).toEqual([])
  })

  it('HTML 注释排除（行内与跨行）', () => {
    expect(cssOf('<!-- <style>c1{}</style> -->')).toEqual([])
    expect(cssOf('<!--\n<style>c2{}</style>\n-->')).toEqual([])
  })

  it('frontmatter 排除', () => {
    expect(cssOf('---\nstyle: x\n<style>fm{}</style>\n---\n\n<style>body{}</style>'))
      .toEqual(['body{}'])
  })

  it('未闭合 style 跳过（不吞后续内容）', () => {
    const out = collectDocumentStyles('<style>a{color:red}\n\n后文段落不进样式。')
    expect(out).toEqual([])
  })

  it('大小写与属性形态：<STYLE> 与 <style type="text/css">', () => {
    expect(cssOf('<STYLE>a{}</STYLE>')).toEqual(['a{}'])
    expect(cssOf('<style type="text/css">b{}</style>')).toEqual(['b{}'])
  })

  it('HTML raw text 语义：内容中的 </style> 提前闭合（与浏览器词法一致）', () => {
    // content: "</style>" 在 HTML 词法中是闭合标签——收集器与浏览器同判定
    const text = '<style>.a::before{content:"</style>"} .z{color:1}</style>'
    const out = collectDocumentStyles(text)
    expect(out).toHaveLength(1)
    expect(out[0]!.css).toBe('.a::before{content:"')
    expect(text.slice(out[0]!.from, out[0]!.to)).toBe('<style>.a::before{content:"</style>')
  })

  it('跨行内容与 CRLF 文本（协议 LF 化后的 CRLF 字面量不参与）', () => {
    expect(cssOf('<style>\n  p {\n    color: red;\n  }\n</style>'))
      .toEqual(['\n  p {\n    color: red;\n  }\n'])
  })
})

describe('改写器：:where():is() 零特异性与矩阵', () => {
  const S = 'doc'

  it('基础选择器逐类：标签/类/ID/属性/后代/子/相邻', () => {
    expect(rewriteDocumentStyleCss('h1 { color: red }', S))
      .toBe(`:where([data-vsidian-doc-scope="doc"]) :is(h1) { color: red; }`)
    expect(rewriteDocumentStyleCss('.cls { color: red }', S))
      .toBe(`:where([data-vsidian-doc-scope="doc"]) :is(.cls) { color: red; }`)
    expect(rewriteDocumentStyleCss('#main td { color: red }', S))
      .toBe(`:where([data-vsidian-doc-scope="doc"]) :is(#main td) { color: red; }`)
    expect(rewriteDocumentStyleCss('.a > .b { color: red }', S))
      .toBe(`:where([data-vsidian-doc-scope="doc"]) :is(.a > .b) { color: red; }`)
    expect(rewriteDocumentStyleCss('.sib + .tgt { color: red }', S))
      .toBe(`:where([data-vsidian-doc-scope="doc"]) :is(.sib + .tgt) { color: red; }`)
  })

  it('逗号列表拆项逐项改写', () => {
    expect(rewriteDocumentStyleCss('h1, .cls, #id { color: red }', S))
      .toBe(`:where([data-vsidian-doc-scope="doc"]) :is(h1), :where([data-vsidian-doc-scope="doc"]) :is(.cls), :where([data-vsidian-doc-scope="doc"]) :is(#id) { color: red; }`)
  })

  it('伪元素拆到 :is() 之外（:is 参数禁伪元素——T01 探针警示）', () => {
    expect(rewriteDocumentStyleCss('.pe::before { content: "x" }', S))
      .toBe(`:where([data-vsidian-doc-scope="doc"]) :is(.pe)::before { content: "x"; }`)
  })

  it('伪类保留在 :is() 内', () => {
    expect(rewriteDocumentStyleCss('a:hover { color: red }', S))
      .toBe(`:where([data-vsidian-doc-scope="doc"]) :is(a:hover) { color: red; }`)
  })

  it('纯伪元素选择器（::selection）：拆分后主体为 *', () => {
    expect(rewriteDocumentStyleCss('::selection { color: red }', S))
      .toBe(`:where([data-vsidian-doc-scope="doc"]) :is(*)::selection { color: red; }`)
  })

  it(':root/body/html 规则改写后失活（决策点 1：维持失活并文档化）', () => {
    // 改写产物 :where([doc]) :is(:root) —— 标记块不是根元素后代，永不命中
    const out = rewriteDocumentStyleCss(':root { --mark: 1 }', S)
    expect(out).toBe(`:where([data-vsidian-doc-scope="doc"]) :is(:root) { --mark: 1; }`)
  })

  it('@media 递归下钻改写内层', () => {
    expect(rewriteDocumentStyleCss('@media (min-width: 1px) { p { color: green } }', S))
      .toBe(`@media (min-width: 1px) {\n:where([data-vsidian-doc-scope="doc"]) :is(p) { color: green; }\n}`)
  })

  it('@supports 递归下钻改写内层', () => {
    const out = rewriteDocumentStyleCss('@supports (display: grid) { .g { display: grid } }', S)
    expect(out).toContain('@supports (display: grid)')
    expect(out).toContain(':is(.g)')
  })

  it('@keyframes 原样保留（文档级名字空间——既有 CSS 语义，嵌套同名冲突落档）', () => {
    const out = rewriteDocumentStyleCss('@keyframes spin { from { transform: rotate(0) } to { transform: rotate(1turn) } }', S)
    expect(out).toContain('@keyframes spin')
    expect(out).not.toContain(':where(')
  })

  it('@font-face 原样保留（url() 资源解析归 T05）', () => {
    const out = rewriteDocumentStyleCss('@font-face { font-family: X; src: url(./f.woff2); }', S)
    expect(out).toContain('@font-face')
    expect(out).not.toContain(':where(')
  })

  it('@import 原样保留（位置语义：仅产物内首位有效，CSS 原生规则落档）', () => {
    const out = rewriteDocumentStyleCss('@import url("https://example.com/a.css");', S)
    expect(out).toContain('@import')
  })

  it('CSS 嵌套 & 后代形态代换（& p → 父规则项 :is(parent) 组合）', () => {
    const out = rewriteDocumentStyleCss('.parent { color: red; & p { color: blue } }', S)
    expect(out).toContain(`:where([data-vsidian-doc-scope="doc"]) :is(.parent) { color: red;`)
    expect(out).toContain(`:where([data-vsidian-doc-scope="doc"]) :is(:is(.parent) p) { color: blue;`)
  })

  it('CSS 嵌套 &.cls 自身复合形态', () => {
    const out = rewriteDocumentStyleCss('.parent { &.active { color: blue } }', S)
    expect(out).toContain(`:is(:is(.parent).active) { color: blue;`)
  })

  it('CSS 嵌套 & > 子组合器形态', () => {
    const out = rewriteDocumentStyleCss('.parent { & > li { color: blue } }', S)
    expect(out).toContain(`:is(:is(.parent) > li) { color: blue;`)
  })

  it('CSS 嵌套无 & 隐式后代形态', () => {
    const out = rewriteDocumentStyleCss('.parent { p { color: blue } }', S)
    expect(out).toContain(`:is(:is(.parent) p) { color: blue;`)
  })

  it('多层嵌套递归代换', () => {
    const out = rewriteDocumentStyleCss('.a { .b { .c { color: blue } } }', S)
    expect(out).toContain(`:is(:is(:is(.a) .b) .c) { color: blue;`)
  })

  it('嵌套内 @media 递归下钻（裸声明归父选择器）', () => {
    const out = rewriteDocumentStyleCss('.a { @media (min-width: 1px) { color: blue } }', S)
    expect(out).toContain('@media (min-width: 1px)')
    expect(out).toContain(`:where([data-vsidian-doc-scope="doc"]) :is(:is(.a)) { color: blue;`)
  })

  it('父选择器为逗号列表时嵌套逐项展开', () => {
    const out = rewriteDocumentStyleCss('.a, .b { p { color: blue } }', S)
    expect(out).toContain(':is(:is(.a) p)')
    expect(out).toContain(':is(:is(.b) p)')
  })

  it('父选择器为复杂链（.x .y）时 & 代换整体（:is 包裹保持后代语义）', () => {
    const out = rewriteDocumentStyleCss('.x .y { & p { color: blue } }', S)
    expect(out).toContain(':is(:is(.x .y) p) { color: blue;')
  })

  it('嵌套伪元素：&::before 拆分在代换后', () => {
    const out = rewriteDocumentStyleCss('.a { &::before { content: "x" } }', S)
    expect(out).toContain(':is(:is(.a))::before { content: "x";')
  })

  it('未知 at-rule 不进隔离改写（CSSOM 原生容错：引擎丢弃或保留均不抛）', () => {
    // jsdom 丢弃未知 at-rule、Chromium 保留为未知规则——两形态都不进
    // :where 改写（保守边界）；browser 测试覆盖 Chromium 侧
    let out = ''
    expect(() => { out = rewriteDocumentStyleCss('@unknown-rule x { p { color: red } }', S) }).not.toThrow()
    expect(out).not.toContain(':where(')
  })

  it('非法 CSS 不抛异常（CSS 解析容错：坏规则被引擎丢弃是原生行为）', () => {
    expect(() => rewriteDocumentStyleCss('}}}garbage{{{', S)).not.toThrow()
  })
})

describe('身份键派生', () => {
  it('主文档常量', () => {
    expect(MAIN_DOC_SCOPE).toBe('doc')
  })

  it('嵌入视图键从 canonicalRefTargetKey 派生（大小写折叠一致）', () => {
    const a = docScopeKeyOf('D:\\Vault\\B.md')
    const b = docScopeKeyOf('d:\\vault\\b.md')
    expect(a).toBe(b)
    expect(a).not.toBe('doc')
    expect(a).toMatch(/^ref:/)
  })

  it('不同路径不同键；分隔符规范化与 POSIX 形态一致', () => {
    const a = docScopeKeyOf('D:\\Vault\\B.md')
    const c = docScopeKeyOf('D:/vault/B.md')
    expect(a).toBe(c)
    expect(a).not.toBe(docScopeKeyOf('D:/vault/C.md'))
  })

  it('POSIX 路径不做大小写折叠（形态内派 windows 判定）', () => {
    expect(docScopeKeyOf('/vault/B.md')).not.toBe(docScopeKeyOf('/vault/b.md'))
  })

  it('键为 CSS 属性选择器安全形态（无引号/反斜杠/换行）', () => {
    for (const p of ['D:\\Vault\\子 目录\\"quoted".md', '/a/b].md', "it's.md"]) {
      expect(docScopeKeyOf(p)).toMatch(/^ref:[0-9a-z]+$/)
    }
  })
})

describe('改写核心直驱（DocStyleRule 数据树，纯逻辑）', () => {
  it('规则树递归：组块透传 parents、嵌套累积祖先链', () => {
    const out = rewriteDocStyleRuleTree([
      { rawCssText: '@font-face { font-family: X }' },
      { groupHead: '@media (min-width: 1px)', cssRules: [{ selectorText: 'p', declarations: 'color: green' }] },
      { selectorText: '.a', declarations: 'color: red', cssRules: [
        { selectorText: '& .b', declarations: 'color: blue' },
      ] },
    ], 'doc')
    const lines = out.split('\n')
    expect(lines[0]).toBe('@font-face { font-family: X }')
    expect(lines[1]).toBe('@media (min-width: 1px) {')
    expect(lines[2]).toBe(':where([data-vsidian-doc-scope="doc"]) :is(p) { color: green }')
    expect(lines[4]).toBe(':where([data-vsidian-doc-scope="doc"]) :is(.a) { color: red }')
    expect(lines[5]).toBe(':where([data-vsidian-doc-scope="doc"]) :is(:is(.a) .b) { color: blue }')
  })
})
