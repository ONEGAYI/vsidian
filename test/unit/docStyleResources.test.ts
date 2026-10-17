// #570（T05）文档样式资源归属契约：CSS url()/@import/@font-face 的来源
// 文档解析基准校准——产物内相对 URL 按**样式所属 Markdown** 解析为 webview
// 可装载地址（T04 矩阵移交项：此前按 head 产物基准解析必然失效）。
// 注册表资源生命周期：按 docScope 共享解析映射、失败不重试风暴、
// 释放后迟到结果丢弃、失效重取。
// 环境边界：jsdom 的 CSSOM 会丢 @font-face 的 src 描述符（Chromium 保留
// ——T04 同款测试环境边界），font-face 的 url 改写语法在 shared 层直测，
// 全链字体绘制归 browser 套件（真实 Chromium）。
// 红测纪律：本文件先于实现编写——docStyleLoader 的资源扩展尚不存在。
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { rewriteCssUrls, needsDocumentBaseResolution } from '../../src/shared/htmlResource'
import {
  DocumentStyleBinding,
  documentStyleRegistry,
  rewriteDocumentStyleCss,
} from '../../src/webview/docStyleLoader'
import type { HtmlResourceOutcome } from '../../src/webview/htmlResourceHub'

type Apply = (o: HtmlResourceOutcome) => void
interface PortRecorder {
  port: { subscribe(raw: string, apply: Apply): () => void }
  requests: string[]
  reply: (index: number, url: string) => void
  fail: (index: number) => void
}

function portRecorder(): PortRecorder {
  const requests: string[] = []
  const waiters: Array<Apply | undefined> = []
  return {
    port: {
      subscribe: (raw, apply) => {
        const index = requests.length
        requests.push(raw)
        waiters[index] = apply
        return () => {
          waiters[index] = undefined
        }
      },
    },
    requests,
    reply: (i, url) => waiters[i]?.({ ok: true, url }),
    fail: (i) => waiters[i]?.({ ok: false }),
  }
}

const styleTextOf = (css: string): string => `<style>\n${css}\n</style>`

describe('rewriteDocumentStyleCss：URL 资源改写（文档基准校准）', () => {
  it('相对 url() 经映射表替换为解析地址；https/data/# 原样（CSSOM 归一引号形态）', () => {
    const css = [
      '.a { background: url(bg.png); }',
      '.b { background: url("https://cdn/x.png"); }',
      '.c { mask: url(#grad); }',
      '.d { list-style-image: url(data:image/png;base64,AA); }',
    ].join('\n')
    const out = rewriteDocumentStyleCss(css, 'doc', {
      get: (raw) => (raw === 'bg.png' ? 'https://webview/asset/bg.png?v=1' : null),
    })
    expect(out).toContain('url("https://webview/asset/bg.png?v=1")')
    expect(out).toContain('url("https://cdn/x.png")')
    expect(out).toContain('url("#grad")')
    expect(out).toContain('url("data:image/png;base64,AA")')
  })

  it('@font-face src 的字体相对路径改写（shared 语法层直测——jsdom CSSOM 丢 src 描述符）', () => {
    const css = '@font-face { font-family: X; src: url(f.woff2) format("woff2"), url(f.woff) format("woff"); }'
    const out = rewriteCssUrls(css, (t) =>
      needsDocumentBaseResolution(t.url) ? `url("https://webview/asset/${t.url}")` : null)
    expect(out).toContain('url("https://webview/asset/f.woff2")')
    expect(out).toContain('url("https://webview/asset/f.woff")')
    expect(out).toContain('format("woff2")')
  })

  it('@import url() 与字符串形态都改写', () => {
    const out = rewriteCssUrls('@import "t.css";\n@import url(u.css);', (t) =>
      /\.css$/.test(t.url) ? (t.form === 'import-string' ? `"https://webview/asset/${t.url}"` : `url("https://webview/asset/${t.url}")`) : null)
    expect(out).toContain('"https://webview/asset/t.css"')
    expect(out).toContain('url("https://webview/asset/u.css")')
  })

  it('无映射（未解析/失败）保持原文——不编造地址，浏览器按原生语义失败', () => {
    const out = rewriteDocumentStyleCss('.a { background: url(missing.png); }', 'doc')
    expect(out).toContain('url("missing.png")')
  })

  it('未解析不报错：改写不改变隔离选择器产物（资源改写与隔离正交）', () => {
    const withMap = rewriteDocumentStyleCss('.hero { background: url(bg.png); }', 'doc', {
      get: () => 'https://resolved/bg.png',
    })
    expect(withMap).toContain(':where([data-vsidian-doc-scope="doc"])')
  })
})

describe('DocumentStyleBinding 资源生命周期（按 docScope 共享）', () => {
  it('sync 后产物内的相对 URL 触发订阅请求；结果到达重渲染产物', () => {
    const rec = portRecorder()
    const binding = new DocumentStyleBinding('doc', rec.port)
    binding.sync(styleTextOf('.hero { background: url(img/bg.png); }'))
    expect(rec.requests).toEqual(['img/bg.png'])
    // 解析前：产物保持原文（未编造）
    const el = document.querySelector<HTMLStyleElement>('style[data-vsidian-doc-style="doc"]')
    expect(el?.textContent).toContain('url("img/bg.png")')
    rec.reply(0, 'https://webview/asset/img/bg.png?v=1')
    expect(el?.textContent).toContain('url("https://webview/asset/img/bg.png?v=1")')
    binding.dispose()
    expect(document.querySelector('style[data-vsidian-doc-style="doc"]')).toBe(null)
  })

  it('同 docScope 多实例共享请求（同 raw 去重，不重复订阅）', () => {
    const rec = portRecorder()
    const b1 = new DocumentStyleBinding('ref:abc', rec.port)
    const b2 = new DocumentStyleBinding('ref:abc', rec.port)
    const text = styleTextOf('.x { background: url(shared.png); }')
    b1.sync(text)
    b2.sync(text)
    expect(rec.requests).toHaveLength(1)
    rec.reply(0, 'https://resolved/shared.png')
    const el = document.querySelector<HTMLStyleElement>('style[data-vsidian-doc-style="ref:abc"]')
    expect(el?.textContent).toContain('https://resolved/shared.png')
    b1.dispose()
    expect(document.querySelector('style[data-vsidian-doc-style="ref:abc"]')).not.toBe(null) // b2 仍持有
    b2.dispose()
    expect(document.querySelector('style[data-vsidian-doc-style="ref:abc"]')).toBe(null)
  })

  it('失败登记后不再重复请求（避免重试风暴），文本保持原文', () => {
    const rec = portRecorder()
    const binding = new DocumentStyleBinding('doc', rec.port)
    const text = styleTextOf('.x { background: url(bad.png); }')
    binding.sync(text)
    expect(rec.requests).toHaveLength(1)
    rec.fail(0)
    // 再 sync 同文本（例如重挂载）：失败已登记不重发
    binding.sync(text)
    expect(rec.requests).toHaveLength(1)
    binding.dispose()
  })

  it('释放后的迟到结果丢弃（不复活产物）', () => {
    const rec = portRecorder()
    const binding = new DocumentStyleBinding('doc', rec.port)
    binding.sync(styleTextOf('.x { background: url(late.png); }'))
    binding.dispose()
    rec.reply(0, 'https://resolved/late.png')
    expect(document.querySelector('style[data-vsidian-doc-style="doc"]')).toBe(null)
  })

  it('#576 P2-2：端口同步回调（hub 缓存命中形态）不当作迟到丢弃——先登记订阅状态再 subscribe', () => {
    const port = {
      subscribe(raw: string, apply: Apply) {
        apply({ ok: true, url: `https://sync-cache/${raw}` }) // 同步回包（htmlResourceHub 缓存命中语义）
        return () => undefined
      },
    }
    const binding = new DocumentStyleBinding('doc', port)
    binding.sync(styleTextOf('.x { background: url(cached.png); }'))
    const el = document.querySelector<HTMLStyleElement>('style[data-vsidian-doc-style="doc"]')
    expect(el?.textContent).toContain('https://sync-cache/cached.png')
    binding.dispose()
  })

  it('#576 P2-3：已完成的订阅持续保留（成功回调不删退订句柄），dispose 全退订不泄漏', () => {
    let unsubCalls = 0
    const waiters: Array<Apply | undefined> = []
    const port = {
      subscribe(_raw: string, apply: Apply) {
        waiters.push(apply)
        return () => {
          unsubCalls += 1
        }
      },
    }
    const binding = new DocumentStyleBinding('doc', port)
    binding.sync(styleTextOf('.x { background: url(keep.png); }'))
    waiters[0]!({ ok: true, url: 'https://resolved/keep.png' })
    const el = document.querySelector<HTMLStyleElement>('style[data-vsidian-doc-style="doc"]')
    expect(el?.textContent).toContain('https://resolved/keep.png')
    binding.dispose()
    expect(unsubCalls).toBe(1)
  })

  it('失效通知重置解析映射并重取（hub 经既有订阅重取——不重复 subscribe 防监听器累积）', () => {
    const rec = portRecorder()
    const binding = new DocumentStyleBinding('doc', rec.port)
    binding.sync(styleTextOf('.x { background: url(changed.png); }'))
    rec.reply(0, 'https://resolved/changed.png?v=1')
    expect(rec.requests).toHaveLength(1)
    documentStyleRegistry.notifyResourceInvalidate(['changed.png'])
    // 失效后：hub 对仍有订阅者的条目经既有 listener 重取（真 hub 语义），
    // registry 不重复 subscribe——重复订阅会向 hub 累积监听器（#576 P2-3）
    expect(rec.requests).toHaveLength(1)
    const el = document.querySelector<HTMLStyleElement>('style[data-vsidian-doc-style="doc"]')
    expect(el?.textContent).toContain('url("changed.png")') // 映射清除即回退原文
    rec.reply(0, 'https://resolved/changed.png?v=2') // hub 重取结果经同一订阅回调
    expect(el?.textContent).toContain('?v=2')
    binding.dispose()
  })

  it('端口缺省（无注册端口）不请求、产物保持原文（降级方向：无资源而非报错）', () => {
    const binding = new DocumentStyleBinding('doc')
    binding.sync(styleTextOf('.x { background: url(noport.png); }'))
    const el = document.querySelector<HTMLStyleElement>('style[data-vsidian-doc-style="doc"]')
    expect(el?.textContent).toContain('url("noport.png")')
    binding.dispose()
  })
})
