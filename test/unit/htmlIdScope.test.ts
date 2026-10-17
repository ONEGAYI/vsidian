// @vitest-environment jsdom
// #573（T08）ID 文档作用域的 DOM 装配与 SVG 资源条目（htmlResourceMount
// 咽喉契约）：引用文档（B/C）渲染产物的 id 与片段引用统一前缀化（A/B
// 相同 ID 不串目标、不伪造宿主锚点）；SVG image/use 的 href 与旧
// xlink:href 两形态沿 T05 来源解析矩阵订阅（# 片段与真 scheme 不订阅）。
import { describe, it, expect } from 'vitest'
import { prepareHtmlResources, type HtmlResourceOutcome, type HtmlResourceSubscribe } from '../../src/webview/htmlResourceMount'

/** 伪造订阅端口：记录请求、同步回包 */
function fakeSubscribe(log?: Array<{ url: string; sourceDocUri?: string }>): HtmlResourceSubscribe {
  return (url, onResult, sourceDocUri) => {
    log?.push({ url, ...(sourceDocUri !== undefined ? { sourceDocUri } : {}) })
    const outcome: HtmlResourceOutcome = { ok: true, url: `vscode-webview://resolved/${encodeURIComponent(url)}` }
    onResult(outcome)
    return () => undefined
  }
}

function mount(source: string, opts: { docScope?: string | null; subscribe?: HtmlResourceSubscribe } = {}): HTMLElement {
  const root = document.createElement('div')
  root.innerHTML = source
  prepareHtmlResources(root, {
    images: null,
    ...(opts.docScope !== undefined ? { docScope: opts.docScope } : {}),
    ...(opts.subscribe !== undefined ? { subscribe: opts.subscribe } : {}),
  })
  return root
}

describe('ID 文档作用域装配（applyHtmlIdScope 经 prepareHtmlResources 咽喉）', () => {
  it('B scope：元素 id 加前缀，url(#id) 引用与 use href/#id 同步改写', () => {
    const root = mount(
      '<svg><defs><linearGradient id="g1"><stop/></linearGradient><path id="p1" d="M0,0"/></defs>' +
      '<rect fill="url(#g1)" width="5" height="5"/>' +
      '<use href="#p1"/><use xlink:href="#p1"/></svg>',
      { docScope: 'ref:1a2b3c4d' },
    )
    expect(root.querySelector('linearGradient')!.id).toBe('vsref_1a2b3c4d--g1')
    expect(root.querySelector('path')!.id).toBe('vsref_1a2b3c4d--p1')
    expect(root.querySelector('rect')!.getAttribute('fill')).toBe('url(#vsref_1a2b3c4d--g1)')
    expect(root.querySelector('use')!.getAttribute('href')).toBe('#vsref_1a2b3c4d--p1')
  })

  it('B scope：style 属性内 url(#id) 同步改写', () => {
    const root = mount('<svg><rect id="r" style="fill: url(#r2)" width="4" height="4"/></svg>', { docScope: 'ref:1a2b3c4d' })
    expect(root.querySelector('rect')!.getAttribute('style')).toBe('fill: url(#vsref_1a2b3c4d--r2)')
  })

  it('B scope：未命中的 # 引用同样限定 B 域（不外溢到 A 的同名锚点）', () => {
    const root = mount('<svg><rect fill="url(#nope)" width="4" height="4"/></svg><a href="#nope">x</a>', { docScope: 'ref:1a2b3c4d' })
    expect(root.querySelector('rect')!.getAttribute('fill')).toBe('url(#vsref_1a2b3c4d--nope)')
    expect(root.querySelector('a')!.getAttribute('href')).toBe('#vsref_1a2b3c4d--nope')
  })

  it('B scope：xlink:href 改写后保持命名空间（setAttributeNS 语义）', () => {
    const root = mount('<svg><defs><path id="p" d="M0,0"/></defs><use xlink:href="#p"/></svg>', { docScope: 'ref:1a2b3c4d' })
    const use = root.querySelector('use')!
    expect(use.getAttribute('xlink:href')).toBe('#vsref_1a2b3c4d--p')
    const attr = [...use.attributes].find((a) => a.name === 'xlink:href')
    expect(attr?.namespaceURI).toBe('http://www.w3.org/1999/xlink')
  })

  it('B scope：HTML 元素 id 同样作用域化（foreignObject 混合内容）', () => {
    const root = mount(
      '<svg><foreignObject><div xmlns="http://www.w3.org/1999/xhtml" id="hdr">x</div></foreignObject></svg>',
      { docScope: 'ref:1a2b3c4d' },
    )
    expect(root.querySelector('div')!.id).toBe('vsref_1a2b3c4d--hdr')
  })

  it('B scope：外部 URL 与 data: 引用不受 id 管线影响', () => {
    const root = mount('<svg><image href="pic.png" width="4" height="4"/></svg>', { docScope: 'ref:1a2b3c4d', subscribe: fakeSubscribe() })
    expect(root.querySelector('image')!.getAttribute('href')).toContain('vscode-webview://resolved/')
  })

  it('A 主文档（doc）零改写（HTML 原生全局 ID 语义）', () => {
    const root = mount('<svg><defs><linearGradient id="g1"/></defs><rect fill="url(#g1)" width="4" height="4"/></svg>', { docScope: 'doc' })
    expect(root.querySelector('linearGradient')!.id).toBe('g1')
    expect(root.querySelector('rect')!.getAttribute('fill')).toBe('url(#g1)')
  })

  it('docScope 缺省零改写（既有调用面兼容）', () => {
    const root = mount('<svg><rect id="r" fill="url(#g)" width="4" height="4"/></svg>')
    expect(root.querySelector('rect')!.id).toBe('r')
    expect(root.querySelector('rect')!.getAttribute('fill')).toBe('url(#g)')
  })

  it('幂等：同根二次装配零动作', () => {
    const root = mount('<svg><rect id="r" fill="url(#g)" width="4" height="4"/></svg>', { docScope: 'ref:1a2b3c4d' })
    prepareHtmlResources(root, { images: null, docScope: 'ref:1a2b3c4d' })
    expect(root.querySelector('rect')!.id).toBe('vsref_1a2b3c4d--r')
  })
})

describe('SVG 资源条目（image/use 的 href 与 xlink:href）', () => {
  it('image href 相对路径经订阅解析并回写（沿 T05 媒体同款管线）', () => {
    const root = mount('<svg><image href="pic.png" width="4" height="4"/></svg>', { subscribe: fakeSubscribe() })
    expect(root.querySelector('image')!.getAttribute('href')).toBe('vscode-webview://resolved/pic.png')
  })

  it('image xlink:href 相对路径同样订阅解析（旧形态）', () => {
    const root = mount('<svg><image xlink:href="pic.png" width="4" height="4"/></svg>', { subscribe: fakeSubscribe() })
    const image = root.querySelector('image')!
    expect(image.getAttribute('xlink:href')).toBe('vscode-webview://resolved/pic.png')
    const attr = [...image.attributes].find((a) => a.name === 'xlink:href')
    expect(attr?.namespaceURI).toBe('http://www.w3.org/1999/xlink')
  })

  it('订阅携带来源文档身份（sourceDocUri 透传）', () => {
    const log: Array<{ url: string; sourceDocUri?: string }> = []
    mount('<svg><image href="sub/pic.png" width="4" height="4"/></svg>', {
      subscribe: fakeSubscribe(log),
      docScope: 'ref:1a2b3c4d',
    })
    expect(log.some((e) => e.url === 'sub/pic.png')).toBe(true)
  })

  it('use 的外部文档引用（真 scheme）不订阅（浏览器原生语义处置）', () => {
    const log: Array<{ url: string; sourceDocUri?: string }> = []
    const root = mount('<svg><use href="https://e.com/x.svg#y"/></svg>', { subscribe: fakeSubscribe(log) })
    expect(log.length).toBe(0)
    expect(root.querySelector('use')!.getAttribute('href')).toBe('https://e.com/x.svg#y')
  })

  it('use 同文档片段引用不进资源订阅（归 id 管线）', () => {
    const log: Array<{ url: string; sourceDocUri?: string }> = []
    mount('<svg><use href="#p"/></svg>', { subscribe: fakeSubscribe(log) })
    expect(log.length).toBe(0)
  })

  it('失败解析保持原文（不编造地址）', () => {
    const fail: HtmlResourceSubscribe = (url, onResult) => {
      void url
      onResult({ ok: false, reason: 'not-found' })
      return () => undefined
    }
    const root = mount('<svg><image href="missing.png" width="4" height="4"/></svg>', { subscribe: fail })
    expect(root.querySelector('image')!.getAttribute('href')).toBe('missing.png')
  })
})
