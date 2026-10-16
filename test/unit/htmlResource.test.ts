// #570（T05）HTML 链接图片与 CSS 资源的文档归属——纯语法层契约：
// srcset 真实语法解析/重组、CSS url()/@import 词法扫描与改写、
// 「需按文档基准解析」判定矩阵（spec html-rendering.md「资源与原生交互」：
// 不同 URL 属性按真实语法处理，不能统一当单个 src 字符串）。
//
// 红测纪律：本文件先于实现编写——src/shared/htmlResource.ts 尚不存在，
// import 即红。
import { describe, it, expect } from 'vitest'
import {
  parseSrcsetCandidates,
  buildSrcsetValue,
  scanCssUrls,
  rewriteCssUrls,
  needsDocumentBaseResolution,
} from '../../src/shared/htmlResource'

describe('srcset 解析：按真实语法（HTML 规范算法）', () => {
  it('多项候选 + 宽度/倍率描述符', () => {
    expect(parseSrcsetCandidates('a.png 1x, b.png 2x')).toEqual([
      { url: 'a.png', descriptor: '1x' },
      { url: 'b.png', descriptor: '2x' },
    ])
    expect(parseSrcsetCandidates('small.png 480w, large.png 1080w')).toEqual([
      { url: 'small.png', descriptor: '480w' },
      { url: 'large.png', descriptor: '1080w' },
    ])
  })

  it('无描述符（单候选与多候选皆可）', () => {
    expect(parseSrcsetCandidates('only.png')).toEqual([{ url: 'only.png', descriptor: '' }])
    expect(parseSrcsetCandidates('a.png, b.png')).toEqual([
      { url: 'a.png', descriptor: '' },
      { url: 'b.png', descriptor: '' },
    ])
  })

  it('候选间任意空白（换行/制表/多空格）与尾逗号容错', () => {
    expect(parseSrcsetCandidates('a.png 1x,\n b.png\t2x, ')).toEqual([
      { url: 'a.png', descriptor: '1x' },
      { url: 'b.png', descriptor: '2x' },
    ])
  })

  it('URL 内含空格的候选不合法（srcset 的 URL 不可含空白）——该项跳过', () => {
    expect(parseSrcsetCandidates('has space.png 1x, ok.png 2x')).toEqual([
      { url: 'ok.png', descriptor: '2x' },
    ])
  })

  it('URL 可含中位逗号（规范：URL 取连续非空白串，仅末位逗号截断）', () => {
    expect(parseSrcsetCandidates('a.png?s=1,2 1x')).toEqual([
      { url: 'a.png?s=1,2', descriptor: '1x' },
    ])
  })

  it('描述符与 URL 之间多空白归一；URL 前导空白剥除', () => {
    expect(parseSrcsetCandidates('   a.png    2x   ')).toEqual([
      { url: 'a.png', descriptor: '2x' },
    ])
  })

  it('空值/全空白产出空数组', () => {
    expect(parseSrcsetCandidates('')).toEqual([])
    expect(parseSrcsetCandidates('   ')).toEqual([])
  })

  it('重组：URL + 描述符单空格拼接，多项逗号分隔；空描述符不带尾空格', () => {
    expect(buildSrcsetValue([
      { url: 'a.png', descriptor: '1x' },
      { url: 'b.png', descriptor: '' },
    ])).toBe('a.png 1x, b.png')
  })
})

describe('CSS url()/@import 词法扫描：跳过字符串与注释', () => {
  it('裸 url() 与引号形态（双/单引号）', () => {
    const css = 'a{background:url(bg.png)} b{background:url("q.png")} c{src:url(\'z.woff2\')}'
    const tokens = scanCssUrls(css)
    expect(tokens.map((t) => t.url)).toEqual(['bg.png', 'q.png', 'z.woff2'])
    expect(tokens.map((t) => t.quote)).toEqual([null, '"', "'"])
  })

  it('字符串字面量内的 url( 不算 token（content: "url(x)"）', () => {
    expect(scanCssUrls('a{content:"url(fake.png)"}')).toEqual([])
    expect(scanCssUrls("a{content:'url(fake.png)'}")).toEqual([])
  })

  it('注释内的 url( 不算 token', () => {
    expect(scanCssUrls('/* url(no.png) */ a{background:url(yes.png)}').map((t) => t.url))
      .toEqual(['yes.png'])
  })

  it('url() 内空白容错（url( x.png )）与空 url() 跳过', () => {
    expect(scanCssUrls('a{background:url( x.png )}').map((t) => t.url)).toEqual(['x.png'])
    expect(scanCssUrls('a{background:url()}')).toEqual([])
    expect(scanCssUrls('a{background:url( "" )}')).toEqual([])
  })

  it('@import 的字符串形态与 url() 形态都产 token', () => {
    const css = '@import "t.css";\n@import url(u.css);'
    const tokens = scanCssUrls(css)
    expect(tokens.map((t) => t.url)).toEqual(['t.css', 'u.css'])
    expect(tokens.map((t) => t.form)).toEqual(['import-string', 'url'])
  })

  it('媒体查询等 at-rule 头与功能记法内的 url() 正常命中（image-set 多项）', () => {
    const css = '@media (min-width:1px){a{background:image-set(url(1x.png) 1x, url(2x.png) 2x)}}'
    expect(scanCssUrls(css).map((t) => t.url)).toEqual(['1x.png', '2x.png'])
  })

  it('token 区间 [start, end) 覆盖整个 url() 产（替换用）', () => {
    const css = 'a{background:url("x.png")}'
    const [t] = scanCssUrls(css)
    expect(css.slice(t!.start, t!.end)).toBe('url("x.png")')
  })

  it('data: 与片段 URL 也被扫描（改写层决定去留）', () => {
    expect(scanCssUrls('a{background:url(data:image/png;base64,AAA)}').map((t) => t.url))
      .toEqual(['data:image/png;base64,AAA'])
    expect(scanCssUrls('a{mask:url(#grad)}').map((t) => t.url)).toEqual(['#grad'])
  })
})

describe('CSS url 改写：逐 token 替换、未命中保持原样', () => {
  it('相对 URL 替换为解析产物，https/data/# 保持原样', () => {
    const out = rewriteCssUrls(
      'a{background:url(bg.png)} b{background:url("https://x/y.png")} c{mask:url(#g)} d{list-style:url(data:image/png;base64,AA)}',
      (t) => (needsDocumentBaseResolution(t.url) ? 'url("https://resolved/bg.png")' : null),
    )
    expect(out).toBe(
      'a{background:url("https://resolved/bg.png")} b{background:url("https://x/y.png")} c{mask:url(#g)} d{list-style:url(data:image/png;base64,AA)}',
    )
  })

  it('@import 字符串形态同样改写（含引号重装）', () => {
    const out = rewriteCssUrls('@import "t.css"; a{}', (t) =>
      t.form === 'import-string' ? '"https://resolved/t.css"' : null)
    expect(out).toBe('@import "https://resolved/t.css"; a{}')
  })

  it('改写不破坏相邻声明与注释', () => {
    const out = rewriteCssUrls(
      '/* url(keep.png) */ a{color:red;background:url( real.png );border:0}',
      (t) => (t.url === 'real.png' ? 'url(https://resolved/real.png)' : null),
    )
    expect(out).toBe(
      '/* url(keep.png) */ a{color:red;background:url(https://resolved/real.png);border:0}',
    )
  })

  it('空 CSS / 无 token 原样返回', () => {
    expect(rewriteCssUrls('a{color:red}', () => 'x')).toBe('a{color:red}')
    expect(rewriteCssUrls('', () => 'x')).toBe('')
  })
})

describe('needsDocumentBaseResolution：需按文档基准解析的判定矩阵', () => {
  it('相对路径（./、../、裸名、子目录、根相对）→ true', () => {
    expect(needsDocumentBaseResolution('bg.png')).toBe(true)
    expect(needsDocumentBaseResolution('./bg.png')).toBe(true)
    expect(needsDocumentBaseResolution('../img/bg.png')).toBe(true)
    expect(needsDocumentBaseResolution('assets/bg with space.png')).toBe(true)
    expect(needsDocumentBaseResolution('/root-relative.png')).toBe(true)
  })

  it('http/https/data（任意大小写 scheme）→ false（直连/自足）', () => {
    expect(needsDocumentBaseResolution('https://x/y.png')).toBe(false)
    expect(needsDocumentBaseResolution('HTTP://x/y.png')).toBe(false)
    expect(needsDocumentBaseResolution('data:image/png;base64,AA')).toBe(false)
  })

  it('片段（#frag）与空白 → false（无目标语义）', () => {
    expect(needsDocumentBaseResolution('#grad')).toBe(false)
    expect(needsDocumentBaseResolution('')).toBe(false)
    expect(needsDocumentBaseResolution('   ')).toBe(false)
  })

  it('危险/其他 scheme（javascript:、file:、vbscript:）→ false（资源层不越权解析，净化层已拒）', () => {
    expect(needsDocumentBaseResolution('javascript:alert(1)')).toBe(false)
    expect(needsDocumentBaseResolution('file:///c:/x.png')).toBe(false)
    expect(needsDocumentBaseResolution('vbscript:x')).toBe(false)
  })
})
