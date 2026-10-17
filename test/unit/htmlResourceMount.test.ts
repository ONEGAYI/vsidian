// #570（T05）HTML 资源 DOM 装配契约（净化产物 → DOM 咽喉的后置管线）：
// img/src+srcset 剥离重解析、媒体 source/src/poster 归属改写、
// a[href] 不改写（导航归点击委托）、解析结果的迟到守卫与释放语义。
// #571（T06）起媒体装载语义收紧：相对 src/poster 解析前剥离（原文记忆
// dataset）、失败恢复原文、dispose 释放媒体（pause + 断流）。
// 身份矩阵：装配依赖注入的订阅端口携带 sourceDocUri（A/B/C 串源负向）。
// 红测纪律：本文件先于实现编写——src/webview/htmlResourceMount.ts 与
// htmlResourceHub.ts 尚不存在，import 即红。
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { ImageResourceManager } from '../../src/webview/imageResource'
import {
  prepareHtmlResources,
  type HtmlResourceSubscribe,
} from '../../src/webview/htmlResourceMount'

/** 记录型订阅端口：捕获请求并允许手动回结果（测试直驱） */
function recorderSubscribe(): { subscribe: HtmlResourceSubscribe; requests: string[]; reply: (i: number, url: string) => void; fail: (i: number) => void } {
  const requests: string[] = []
  const waiters: Array<((o: { ok: true; url: string } | { ok: false }) => void) | undefined> = []
  return {
    subscribe: (url, apply) => {
      const index = requests.length
      requests.push(url)
      waiters[index] = apply
      return () => {
        waiters[index] = undefined
      }
    },
    requests,
    reply: (i, url) => waiters[i]?.({ ok: true, url }),
    fail: (i) => waiters[i]?.({ ok: false }),
  }
}

/** 记录型图片管理器：捕获请求 src 序列，按请求序回包（reqId 自 1 对齐 attach 自增） */
function managerRecorder(): { images: ImageResourceManager; srcs: string[]; reply: (index: number, url: string) => void } {
  const srcs: string[] = []
  const images = new ImageResourceManager({
    isDirectSrc: (s) => /^https?:\/\//i.test(s),
    requestHost: (src) => {
      srcs.push(src)
    },
  })
  let replies = 0
  return {
    images,
    srcs,
    reply: (index, url) => {
      void index
      replies += 1
      void replies
      images.handleResult({ reqId: index + 1, ok: true, src: url })
    },
  }
}

describe('img：src 绑定管理器 + srcset 剥离重解析', () => {
  it('img[src] 无 srcset：走图片管理器（既有语义不变——src 剥离、dataset 记忆）', () => {
    const { images, srcs } = managerRecorder()
    const root = document.createElement('div')
    root.innerHTML = '<img src="pic.png" alt="图">'
    prepareHtmlResources(root, { images, subscribe: recorderSubscribe().subscribe })
    expect(srcs).toEqual(['pic.png'])
    const img = root.querySelector('img')!
    expect(img.getAttribute('src')).toBe(null) // 剥离等宿主解析
    expect(img.dataset['vsidianImgSrc']).toBe('pic.png')
  })

  it('img 同时带 src 与 srcset：管理器绑定首个候选（srcset 命中时 src 仅为回退），srcset 先剥离防坏相对候选', () => {
    const { images, srcs } = managerRecorder()
    const sub = recorderSubscribe()
    const root = document.createElement('div')
    root.innerHTML = '<img src="fallback.png" srcset="a.png 1x, b.png 2x">'
    prepareHtmlResources(root, { images, subscribe: sub.subscribe })
    const img = root.querySelector('img')!
    expect(img.getAttribute('srcset')).toBe(null)
    expect(img.dataset['vsidianSrcset']).toBe('a.png 1x, b.png 2x')
    // 管理器逻辑图源 = 首个候选（浏览器从 srcset 选用时 src 不参与）
    expect(srcs).toEqual(['a.png'])
    // 相对候选经订阅端口解析（按 srcset 语法逐项，不是单字符串）
    expect(sub.requests).toEqual(['a.png', 'b.png'])
  })

  it('srcset 解析完成后按描述符重组回写（直连 https 候选原样保留）', () => {
    const { images } = managerRecorder()
    const sub = recorderSubscribe()
    const root = document.createElement('div')
    root.innerHTML = '<img src="f.png" srcset="a.png 1x, https://cdn/x.png 2x">'
    prepareHtmlResources(root, { images, subscribe: sub.subscribe })
    sub.reply(0, 'https://resolved/a.png')
    const img = root.querySelector('img')!
    expect(img.getAttribute('srcset')).toBe('https://resolved/a.png 1x, https://cdn/x.png 2x')
    expect(img.dataset['vsidianSrcset']).toBe(undefined) // 应用完成即清除记忆
  })

  it('失败的候选保留原 URL（浏览器自然回退到下一候选或 src，不编造地址）', () => {
    const { images } = managerRecorder()
    const sub = recorderSubscribe()
    const root = document.createElement('div')
    root.innerHTML = '<img src="f.png" srcset="bad.png 1x, good.png 2x">'
    prepareHtmlResources(root, { images, subscribe: sub.subscribe })
    sub.fail(0)
    sub.reply(1, 'https://resolved/good.png')
    const img = root.querySelector('img')!
    expect(img.getAttribute('srcset')).toBe('bad.png 1x, https://resolved/good.png 2x')
  })

  it('仅 srcset 无 src 的 img：首个候选作为管理器逻辑图源（真实 srcset 语义）', () => {
    const { images, srcs } = managerRecorder()
    const sub = recorderSubscribe()
    const root = document.createElement('div')
    root.innerHTML = '<img srcset="a.png 1x, b.png 2x">'
    prepareHtmlResources(root, { images, subscribe: sub.subscribe })
    expect(srcs).toEqual(['a.png'])
    expect(sub.requests).toEqual(['a.png', 'b.png'])
  })

  it('https 直连候选不进订阅端口（webview CSP 直接装载）', () => {
    const { images } = managerRecorder()
    const sub = recorderSubscribe()
    const root = document.createElement('div')
    root.innerHTML = '<img src="https://only/cdn.png" srcset="https://only/cdn.png 2x">'
    prepareHtmlResources(root, { images, subscribe: sub.subscribe })
    expect(sub.requests).toEqual([])
  })
})

describe('媒体 source/src 与 poster：归属改写 + T06 装载语义（相对目标先剥离）', () => {
  it('picture 内 source[srcset] 同 srcset 管线', () => {
    const sub = recorderSubscribe()
    const root = document.createElement('div')
    root.innerHTML = '<picture><source srcset="a.webp 1w, b.webp 2w"><img src="f.png"></picture>'
    prepareHtmlResources(root, { images: null, subscribe: sub.subscribe })
    expect(sub.requests).toEqual(['a.webp', 'b.webp'])
    const source = root.querySelector('source')!
    expect(source.getAttribute('srcset')).toBe(null)
    expect(source.dataset['vsidianSrcset']).toBe('a.webp 1w, b.webp 2w')
  })

  it('T06 装载语义：相对 src/poster 先剥离（防 webview origin 坏相对请求），原文记忆 dataset，成功后回写绝对地址', () => {
    const sub = recorderSubscribe()
    const root = document.createElement('div')
    root.innerHTML = '<video src="clip.mp4" poster="cover.png"></video><audio src="tone.ogg"></audio>'
    prepareHtmlResources(root, { images: null, subscribe: sub.subscribe })
    expect(sub.requests).toEqual(['clip.mp4', 'cover.png', 'tone.ogg'])
    // 解析前剥离（img/srcset 同纪律——#571 起 CSP 放行媒体装载，保留原文
    // 会先向 webview origin 发坏相对请求再被改写覆盖）
    const video = root.querySelector('video')!
    expect(video.getAttribute('src')).toBe(null)
    expect(video.dataset['vsidianMediaSrc']).toBe('clip.mp4')
    expect(video.getAttribute('poster')).toBe(null)
    expect(video.dataset['vsidianMediaPoster']).toBe('cover.png')
    expect(root.querySelector('audio')!.getAttribute('src')).toBe(null)
    sub.reply(0, 'https://resolved/clip.mp4')
    sub.reply(1, 'https://resolved/cover.png')
    sub.reply(2, 'https://resolved/tone.ogg')
    expect(video.getAttribute('src')).toBe('https://resolved/clip.mp4')
    expect(video.getAttribute('poster')).toBe('https://resolved/cover.png')
    expect(video.dataset['vsidianMediaSrc']).toBe(undefined) // 应用完成即清除记忆
    expect(video.dataset['vsidianMediaPoster']).toBe(undefined)
    expect(root.querySelector('audio')!.getAttribute('src')).toBe('https://resolved/tone.ogg')
  })

  it('解析失败恢复原文（T05 失败语义保持——最终 DOM 与源文一致，不编造地址）', () => {
    const sub = recorderSubscribe()
    const root = document.createElement('div')
    root.innerHTML = '<video src="gone.mp4"></video>'
    prepareHtmlResources(root, { images: null, subscribe: sub.subscribe })
    sub.fail(0)
    const video = root.querySelector('video')!
    expect(video.getAttribute('src')).toBe('gone.mp4')
    expect(video.dataset['vsidianMediaSrc']).toBe(undefined)
  })

  it('source[src]（video/audio 内）：同剥离与改写；非资源属性不动', () => {
    const sub = recorderSubscribe()
    const root = document.createElement('div')
    root.innerHTML = '<video controls><source src="a.mp4" type="video/mp4"></video>'
    prepareHtmlResources(root, { images: null, subscribe: sub.subscribe })
    const source = root.querySelector('source')!
    expect(source.getAttribute('src')).toBe(null)
    expect(source.dataset['vsidianMediaSrc']).toBe('a.mp4')
    sub.reply(0, 'https://resolved/a.mp4')
    expect(source.getAttribute('src')).toBe('https://resolved/a.mp4')
    expect(source.getAttribute('type')).toBe('video/mp4')
  })

  it('https 直连媒体属性不改写不剥离', () => {
    const sub = recorderSubscribe()
    const root = document.createElement('div')
    root.innerHTML = '<video src="https://cdn/clip.mp4"></video>'
    prepareHtmlResources(root, { images: null, subscribe: sub.subscribe })
    expect(sub.requests).toEqual([])
    expect(root.querySelector('video')!.getAttribute('src')).toBe('https://cdn/clip.mp4')
  })
})

describe('a[href]：导航归点击委托，资源装配层不改写', () => {
  it('锚元素保持原 href（Reading 点击委托/宿主分类是单一权威）', () => {
    const sub = recorderSubscribe()
    const root = document.createElement('div')
    root.innerHTML = '<a href="./note.md">内链</a><a href="https://x/">外链</a>'
    prepareHtmlResources(root, { images: null, subscribe: sub.subscribe })
    expect(root.querySelectorAll('a')[0]!.getAttribute('href')).toBe('./note.md')
    expect(root.querySelectorAll('a')[1]!.getAttribute('href')).toBe('https://x/')
    expect(sub.requests).toEqual([])
  })
})

describe('身份与生命周期', () => {
  it('订阅端口携带 sourceDocUri（B/C 嵌入身份——A/B/C 串源负向的装配面证据）', () => {
    const seen: string[] = []
    const subscribe: HtmlResourceSubscribe = (url, apply, sourceDocUri) => {
      seen.push(`${url}@${sourceDocUri ?? 'A'}`)
      apply({ ok: true, url: 'https://resolved/' + url })
      return () => undefined
    }
    const root = document.createElement('div')
    root.innerHTML = '<img src="same-name.png" srcset="s.png 1x">'
    prepareHtmlResources(root, { images: null, subscribe, sourceDocUri: '/vault/sub/b.md' })
    expect(seen).toEqual(['s.png@/vault/sub/b.md'])
  })

  it('同一 raw 在不同来源文档可解析到不同地址（不共享缓存键）', () => {
    let n = 0
    const subscribe: HtmlResourceSubscribe = (url, apply) => {
      n += 1
      apply({ ok: true, url: `https://resolved-${n}/${url}` })
      return () => undefined
    }
    const rootB = document.createElement('div')
    rootB.innerHTML = '<video src="same.mp4"></video>'
    prepareHtmlResources(rootB, { images: null, subscribe, sourceDocUri: '/v/b.md' })
    const rootC = document.createElement('div')
    rootC.innerHTML = '<video src="same.mp4"></video>'
    prepareHtmlResources(rootC, { images: null, subscribe, sourceDocUri: '/v/deep/c.md' })
    const urls = [rootB.querySelector('video')!.getAttribute('src'), rootC.querySelector('video')!.getAttribute('src')]
    expect(urls[0]).not.toBe(urls[1])
  })

  it('重复 prepare 幂等（已处理的元素不二次剥离/订阅）', () => {
    const sub = recorderSubscribe()
    const root = document.createElement('div')
    root.innerHTML = '<img src="f.png" srcset="a.png 1x">'
    prepareHtmlResources(root, { images: null, subscribe: sub.subscribe })
    prepareHtmlResources(root, { images: null, subscribe: sub.subscribe })
    expect(sub.requests).toEqual(['a.png'])
  })

  it('脱离文档后的迟到结果不写回（binding dispose 守卫）；dispose 同时释放媒体（#571：pause + src 剥除 + 记忆清理）', async () => {
    const sub = recorderSubscribe()
    const root = document.createElement('div')
    root.innerHTML = '<video src="late.mp4"></video>'
    const video = root.querySelector('video')!
    const pause = vi.spyOn(video, 'pause')
    const binding = prepareHtmlResources(root, { images: null, subscribe: sub.subscribe })
    binding.dispose()
    expect(pause).toHaveBeenCalledTimes(1) // #571：释放即停（无持续播放）
    expect(video.getAttribute('src')).toBe(null)
    expect(video.dataset['vsidianMediaSrc']).toBe(undefined)
    sub.reply(0, 'https://resolved/late.mp4')
    expect(video.getAttribute('src')).toBe(null) // 迟到结果丢弃
  })
})

describe('#572（T07）iframe src：归属改写（本地可控页面经资源解析）', () => {
  it('iframe[src] 相对路径经订阅端口解析，成功后改写为绝对地址', () => {
    const sub = recorderSubscribe()
    const root = document.createElement('div')
    root.innerHTML = '<iframe src="page.html" sandbox="" data-vsidian-iframe="1"></iframe>'
    prepareHtmlResources(root, { images: null, subscribe: sub.subscribe })
    expect(sub.requests).toEqual(['page.html'])
    expect(root.querySelector('iframe')!.getAttribute('src')).toBe('page.html') // 解析前保持原文
    sub.reply(0, 'https://resolved/page.html')
    expect(root.querySelector('iframe')!.getAttribute('src')).toBe('https://resolved/page.html')
    // sandbox 等系统属性不被资源管线触碰
    expect(root.querySelector('iframe')!.getAttribute('sandbox')).toBe('')
  })

  it('https 直连 iframe 不进订阅端口（远端帧直载）', () => {
    const sub = recorderSubscribe()
    const root = document.createElement('div')
    root.innerHTML = '<iframe src="https://example.com/embed" sandbox="allow-scripts" data-vsidian-iframe="1"></iframe>'
    prepareHtmlResources(root, { images: null, subscribe: sub.subscribe })
    expect(sub.requests).toEqual([])
    expect(root.querySelector('iframe')!.getAttribute('src')).toBe('https://example.com/embed')
  })

  it('srcdoc 在场跳过 src 解析（内容非资源引用 + 浏览器忽略 src）', () => {
    const sub = recorderSubscribe()
    const root = document.createElement('div')
    root.innerHTML = '<iframe src="page.html" srcdoc="<b>x</b>" sandbox="" data-vsidian-iframe="1"></iframe>'
    prepareHtmlResources(root, { images: null, subscribe: sub.subscribe })
    expect(sub.requests).toEqual([])
    expect(root.querySelector('iframe')!.getAttribute('src')).toBe('page.html')
  })

  it('解析失败保持原文（无效地址矩阵——不编造地址，浏览器按原生语义失败）', () => {
    const sub = recorderSubscribe()
    const root = document.createElement('div')
    root.innerHTML = '<iframe src="missing.html" sandbox="" data-vsidian-iframe="1"></iframe>'
    prepareHtmlResources(root, { images: null, subscribe: sub.subscribe })
    sub.fail(0)
    expect(root.querySelector('iframe')!.getAttribute('src')).toBe('missing.html')
  })

  it('迟到结果不写回（iframe 订阅随 binding 退订）', () => {
    const sub = recorderSubscribe()
    const root = document.createElement('div')
    root.innerHTML = '<iframe src="late.html" sandbox="" data-vsidian-iframe="1"></iframe>'
    const binding = prepareHtmlResources(root, { images: null, subscribe: sub.subscribe })
    binding.dispose()
    sub.reply(0, 'https://resolved/late.html')
    expect(root.querySelector('iframe')!.getAttribute('src')).toBe('late.html')
  })
})

describe('#576 评审 P2-4：style 属性的相对 URL 接入来源资源管线（CSS URL 语法面）', () => {
  it('background-image 相对 URL 经订阅解析改写（携带来源文档身份，重装引号形态）', () => {
    const seen: Array<{ url: string; sourceDocUri?: string }> = []
    const sub = recorderSubscribe()
    const subscribe: HtmlResourceSubscribe = (url, apply, sourceDocUri) => {
      seen.push({ url, ...(sourceDocUri !== undefined ? { sourceDocUri } : {}) })
      return sub.subscribe(url, apply, sourceDocUri)
    }
    const root = document.createElement('div')
    root.innerHTML = '<div style="background-image:url(bg.png)">x</div>'
    prepareHtmlResources(root, { images: null, subscribe, sourceDocUri: '/B/note.md' })
    expect(seen).toEqual([{ url: 'bg.png', sourceDocUri: '/B/note.md' }])
    sub.reply(0, 'https://resolved/bg.png')
    expect(root.querySelector('div')!.getAttribute('style')).toBe('background-image:url("https://resolved/bg.png")')
  })

  it('引号形态 url(＇b.png＇) 同样扫描订阅；直连 URL 不请求', () => {
    const sub = recorderSubscribe()
    const root = document.createElement('div')
    root.innerHTML = '<div style="background:url(\'b.png\');border-image:url(https://cdn.example/x.png)">x</div>'
    prepareHtmlResources(root, { images: null, subscribe: sub.subscribe })
    expect(sub.requests).toEqual(['b.png'])
    sub.reply(0, 'https://resolved/b.png')
    const style = root.querySelector('div')!.getAttribute('style')!
    expect(style).toContain('url("https://resolved/b.png")')
    expect(style).toContain('url(https://cdn.example/x.png)')
  })

  it('解析失败保持原文（不编造地址）；多 URL 部分失败只改成功者', () => {
    const sub = recorderSubscribe()
    const root = document.createElement('div')
    root.innerHTML = '<div style="background:url(a.png);mask-image:url(bad.png)">x</div>'
    prepareHtmlResources(root, { images: null, subscribe: sub.subscribe })
    sub.reply(0, 'https://resolved/a.png')
    sub.fail(1)
    const style = root.querySelector('div')!.getAttribute('style')!
    expect(style).toContain('url("https://resolved/a.png")')
    expect(style).toContain('url(bad.png)')
  })

  it('B scope：片段引用（ID 作用域）与相对资源共存——前缀化与订阅改写互不冲掉', () => {
    const sub = recorderSubscribe()
    const root = document.createElement('div')
    root.innerHTML = '<svg><style>.k{fill:url(#g)}</style></svg><rect style="fill:url(#g);background:url(bg.png)" width="4" height="4"/>'
    prepareHtmlResources(root, { images: null, subscribe: sub.subscribe, docScope: 'ref:1a2b3c4d' })
    expect(sub.requests).toEqual(['bg.png'])
    sub.reply(0, 'https://resolved/bg.png')
    const style = root.querySelector('rect')!.getAttribute('style')!
    expect(style).toContain('fill:url(#vsref_1a2b3c4d--g)')
    expect(style).toContain('url("https://resolved/bg.png")')
  })

  it('迟到结果不写回（style 订阅随 binding 退订）', () => {
    const sub = recorderSubscribe()
    const root = document.createElement('div')
    root.innerHTML = '<div style="background:url(late.png)">x</div>'
    const binding = prepareHtmlResources(root, { images: null, subscribe: sub.subscribe })
    binding.dispose()
    sub.reply(0, 'https://resolved/late.png')
    expect(root.querySelector('div')!.getAttribute('style')).toBe('background:url(late.png)')
  })
})
