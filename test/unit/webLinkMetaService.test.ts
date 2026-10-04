// #342（P3-10）外链元信息抓取服务契约：受控本地 HTTP 服务器驱动——
// 网络边界（超时/非 HTML/超限/重定向循环/私网与 DNS 换址）、同 URL 合并
// 与最后消费者取消、内存缓存（键/费用/TTL/淘汰/不持久）、「只在有效
// 触发后请求」（服务不自动发起，零调用零请求）。
//
// 地址校验分层：生产矩阵拒绝回环——受控服务器绑定 127.0.0.1，故网络
// 路径用例注入放行回环的 isAddressAllowed（网络栈真实走 http）；DNS
// 换址用例用 localhost 主机名 + 生产矩阵（lookup 层拦截、服务器零连接），
// 私网矩阵本身在 webLinkUrl.test 已钉。
import http from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WebLinkMetaService, WEB_LINK_LIMITS } from '../../src/host/webLinkMetaService'
import { canonicalWebLinkUrl, checkWebLinkUrl, type WebLinkUrlCheck } from '../../src/shared/webLink'

const PAGE = `<!doctype html><html><head><title>示例站点</title>
<meta name="description" content="一个用于契约测试的页面摘要">
</head><body><p>正文</p></body></html>`

const EVIL_PAGE = `<html><head><title>带脚本的页面</title>
<script>alert(1)</script><meta http-equiv="refresh" content="0;url=http://evil/">
</head><body onload="x()"><img src="http://tracker/pixel"><iframe src="http://evil/f"></iframe></body></html>`

interface CountingServer {
  server: http.Server
  port: number
  hits: string[]
  close(): Promise<void>
}

const openServers: CountingServer[] = []

async function startServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<CountingServer> {
  const hits: string[] = []
  const server = http.createServer((req, res) => {
    hits.push(req.url ?? '')
    handler(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const entry: CountingServer = {
    server,
    port: (server.address() as { port: number }).port,
    hits,
    close: () => new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    }),
  }
  openServers.push(entry)
  return entry
}

let ctx: CountingServer

beforeAll(async () => {
  ctx = await startServer((req, res) => {
    const url = req.url ?? ''
    if (url === '/html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(PAGE)
    } else if (url === '/evil') {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(EVIL_PAGE)
    } else if (url === '/plain') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('just text')
    } else if (url === '/noct') {
      res.writeHead(200)
      res.end(PAGE)
    } else if (url === '/status404') {
      res.writeHead(404, { 'content-type': 'text/html' })
      res.end('<html><title>gone</title></html>')
    } else if (url === '/redirect1' || url === '/redirect2') {
      // /redirect1 → /redirect2 → /html（两跳后成功）
      res.writeHead(302, { location: url === '/redirect1' ? '/redirect2' : '/html' })
      res.end()
    } else if (url === '/redirect-private') {
      res.writeHead(302, { location: 'http://192.168.13.37/inner' })
      res.end()
    } else if (url === '/redirect-creds') {
      res.writeHead(302, { location: `http://user:pw@127.0.0.1:${(res.socket as { localPort: number }).localPort}/html` })
      res.end()
    } else if (url === '/redirect-loop') {
      res.writeHead(302, { location: '/redirect-loop' })
      res.end()
    } else if (url === '/huge-declared') {
      res.writeHead(200, { 'content-type': 'text/html', 'content-length': String(64 * 1024 * 1024) })
      res.end()
    } else if (url === '/huge-stream') {
      res.writeHead(200, { 'content-type': 'text/html' })
      const chunk = 'x'.repeat(64 * 1024)
      let sent = 0
      const timer = setInterval(() => {
        res.write(chunk)
        sent += chunk.length
        if (sent > 8 * 1024 * 1024) {
          clearInterval(timer)
          res.end()
        }
      }, 5)
      res.on('close', () => clearInterval(timer))
    } else if (url.startsWith('/hang')) {
      // 收到请求但不响应（超时样本；连接由客户端中止）
    } else if (url === '/slow-html') {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end(PAGE)
      }, 60)
    } else {
      res.writeHead(404)
      res.end()
    }
  })
})

afterAll(async () => {
  await ctx.close()
  await Promise.all(openServers.map((s) => s.close()))
})

/** 受控测试的 URL 准入：生产语义（scheme/凭据/私网矩阵）+ 回环例外放行
 *  （Node 对字面 IP 不经 lookup，放行必须发生在文本层） */
function permissiveLoopbackCheck(href: string): WebLinkUrlCheck {
  const result = checkWebLinkUrl(href)
  if (result.ok) {
    return result
  }
  try {
    const parsed = new URL(href)
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.username === '' && parsed.password === '' &&
      (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')) {
      return { ok: true, url: canonicalWebLinkUrl(href), host: parsed.hostname }
    }
  } catch {
    // 畸形按原拒绝返回
  }
  return result
}

/** 网络路径真实、地址校验放行回环（生产矩阵拒回环，本地服务器例外注入） */
function makeService(overrides?: Partial<typeof WEB_LINK_LIMITS>): WebLinkMetaService {
  return new WebLinkMetaService({
    limits: { ...WEB_LINK_LIMITS, ...overrides },
    checkUrl: permissiveLoopbackCheck,
    isAddressAllowed: () => true,
  })
}

const url = (path: string): string => `http://127.0.0.1:${ctx.port}${path}`

describe('WebLinkMetaService 触发与成功路径', () => {
  it('服务构造后零请求（不自动预抓；打开文档/扫描链接/滚动不触发）', () => {
    makeService()
    expect(ctx.hits.length).toBe(0)
  })

  it('成功提取 title/description 与最终域名', async () => {
    const before = ctx.hits.length
    const service = makeService()
    const outcome = await service.fetch(url('/html'))
    expect(outcome).toEqual({
      ok: true,
      meta: { url: url('/html'), domain: '127.0.0.1', title: '示例站点', description: '一个用于契约测试的页面摘要' },
    })
    expect(ctx.hits.length - before).toBe(1)
  })

  it('恶意 HTML：仅一次请求，零子资源请求（script/img/iframe 不触发网络）', async () => {
    const before = ctx.hits.length
    const service = makeService()
    const outcome = await service.fetch(url('/evil'))
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.meta.title).toBe('带脚本的页面')
    }
    expect(ctx.hits.length - before).toBe(1)
  })

  it('请求头只带 UA/Accept 族，不带 cookie 与文档信息', async () => {
    const seen: string[] = []
    const srv = await startServer((req, res) => {
      seen.push(...Object.keys(req.headers).map((k) => k.toLowerCase()))
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(PAGE)
    })
    const service = makeService()
    await service.fetch(`http://127.0.0.1:${srv.port}/`)
    expect(seen).not.toContain('cookie')
    expect(seen).not.toContain('referer')
    expect(seen.filter((h) => h.startsWith('x-'))).toEqual([])
    expect(seen).toContain('user-agent')
    expect(seen).toContain('accept')
  })

  it('慢响应在总预算内成功（默认 8s 预算）', async () => {
    const service = makeService()
    const outcome = await service.fetch(url('/slow-html'))
    expect(outcome.ok).toBe(true)
  })

  it('重定向链正常跟随，url/domain 取最终地址', async () => {
    const before = ctx.hits.length
    const service = makeService()
    const outcome = await service.fetch(url('/redirect1'))
    expect(outcome).toEqual({
      ok: true,
      meta: { url: url('/html'), domain: '127.0.0.1', title: '示例站点', description: '一个用于契约测试的页面摘要' },
    })
    expect(ctx.hits.length - before).toBe(3) // 两跳重定向 + 最终页
  })
})

describe('WebLinkMetaService 网络边界', () => {
  it('超时：挂起响应按 web-timeout 失败', async () => {
    const service = makeService({ timeoutMs: 200 })
    const outcome = await service.fetch(url('/hang?t=1'))
    expect(outcome).toEqual({ ok: false, reason: 'web-timeout' })
  })

  it('非 HTML：text/plain 按 web-not-html 失败', async () => {
    const service = makeService()
    expect(await service.fetch(url('/plain'))).toEqual({ ok: false, reason: 'web-not-html' })
  })

  it('缺失 Content-Type 同样按 web-not-html 失败（MIME 白名单严格）', async () => {
    const service = makeService()
    expect(await service.fetch(url('/noct'))).toEqual({ ok: false, reason: 'web-not-html' })
  })

  it('声明超限（Content-Length 巨大）：零 body 读取即拒 web-too-large', async () => {
    const service = makeService({ maxBytes: 1024 * 1024 })
    expect(await service.fetch(url('/huge-declared'))).toEqual({ ok: false, reason: 'web-too-large' })
  })

  it('流式超限：读取中断按 web-too-large 失败', async () => {
    const service = makeService({ maxBytes: 256 * 1024 })
    expect(await service.fetch(url('/huge-stream'))).toEqual({ ok: false, reason: 'web-too-large' })
  })

  it('重定向循环按 web-redirects 失败', async () => {
    const service = makeService()
    expect(await service.fetch(url('/redirect-loop'))).toEqual({ ok: false, reason: 'web-redirects' })
  })

  it('重定向到私网字面地址被拒（重定向目标一并校验）', async () => {
    const service = makeService()
    expect(await service.fetch(url('/redirect-private'))).toEqual({ ok: false, reason: 'web-invalid-address' })
  })

  it('重定向到凭据 URL 被拒', async () => {
    const service = makeService()
    expect(await service.fetch(url('/redirect-creds'))).toEqual({ ok: false, reason: 'web-invalid-address' })
  })

  it('HTTP 状态非 2xx 按 web-unreachable 失败', async () => {
    const service = makeService()
    expect(await service.fetch(url('/status404'))).toEqual({ ok: false, reason: 'web-unreachable' })
  })

  it('连接不可达（无服务端口）按 web-unreachable 失败', async () => {
    const service = makeService({ timeoutMs: 1500 })
    expect(await service.fetch('http://127.0.0.1:1/unreachable')).toEqual({ ok: false, reason: 'web-unreachable' })
  })
})

describe('WebLinkMetaService DNS 换址防护（生产矩阵，无放行注入）', () => {
  it('localhost 域名解析到回环：lookup 层拒绝且受控服务器零连接', async () => {
    const before = ctx.hits.length
    // 生产矩阵：无 isAddressAllowed 注入 → 回环在 lookup 处被拒
    const service = new WebLinkMetaService({ limits: { ...WEB_LINK_LIMITS, timeoutMs: 1500 } })
    const outcome = await service.fetch(`http://localhost:${ctx.port}/dns-rebind`)
    expect(outcome).toEqual({ ok: false, reason: 'web-invalid-address' })
    expect(ctx.hits.length).toBe(before) // 零连接：拒绝发生在 DNS 解析后、连接前
  })

  it('字面 IP 主机名在生产矩阵下同样拒绝（文本层准入）', async () => {
    const service = new WebLinkMetaService({ limits: { ...WEB_LINK_LIMITS, timeoutMs: 1500 } })
    expect(await service.fetch(`http://10.1.2.3:${ctx.port}/x`)).toEqual({ ok: false, reason: 'web-invalid-address' })
  })
})

// ---- #343（P3-11）page 形态抓取附带 iframe 嵌入预检 ----
// 已知拒绝头（X-Frame-Options / CSP frame-ancestors）与 HTTP 混合内容的
// 判定需要 https 最终地址才能真实走到 denied 分支——自签名受控 TLS 服务器
// 提供 DENY/SAMEORIGIN/frame-ancestors 样本矩阵（纯判定矩阵在
// webFrameEmbed.test.ts；此处钉「抓取层从真实响应头组装 meta.frame」）。
// NODE_TLS_REJECT_UNAUTHORIZED 仅本测试文件（vitest 独立 worker）放行
// 自签名证书；生产代码不带任何测试 CA。
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'

import * as https from 'node:https'
import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')

let tls: CountingServer & { tlsUrl: (p: string) => string }

beforeAll(async () => {
  const key = readFileSync(path.join(fixturesDir, 'webframe-test-key.pem'))
  const cert = readFileSync(path.join(fixturesDir, 'webframe-test-cert.pem'))
  const hits: string[] = []
  const server = https.createServer({ key, cert }, (req, res) => {
    const u = req.url ?? ''
    hits.push(u)
    if (u === '/ok' || u === '/fa-wild') {
      const headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' }
      if (u === '/fa-wild') {
        headers['content-security-policy'] = "default-src 'self'; frame-ancestors *"
      }
      res.writeHead(200, headers)
      res.end(PAGE)
    } else if (u === '/xfo-deny') {
      res.writeHead(200, { 'content-type': 'text/html', 'x-frame-options': 'DENY' })
      res.end(PAGE)
    } else if (u === '/xfo-sameorigin') {
      res.writeHead(200, { 'content-type': 'text/html', 'x-frame-options': 'SAMEORIGIN' })
      res.end(PAGE)
    } else if (u === '/fa-none') {
      res.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': "frame-ancestors 'none'" })
      res.end(PAGE)
    } else if (u === '/redirect-ok' || u === '/redirect-xfo') {
      res.writeHead(302, { location: u === '/redirect-ok' ? '/ok' : '/xfo-deny' })
      res.end()
    } else if (u.startsWith('/hang')) {
      // 挂起不响应（page 形态超时样本）
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const entry: CountingServer = {
    server,
    port: (server.address() as { port: number }).port,
    hits,
    close: () => new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    }),
  }
  openServers.push(entry)
  tls = Object.assign(entry, { tlsUrl: (p: string) => `https://127.0.0.1:${entry.port}${p}` })
})

describe('WebLinkMetaService page 形态嵌入预检（#343）', () => {
  it('无拒绝头的 https 页面 → embeddable=true（已知头未拒绝）', async () => {
    const service = makeService()
    const outcome = await service.fetch(tls.tlsUrl('/ok'), undefined, 'page')
    expect(outcome).toEqual({
      ok: true,
      meta: {
        url: tls.tlsUrl('/ok'), domain: '127.0.0.1', title: '示例站点',
        description: '一个用于契约测试的页面摘要',
        frame: { embeddable: true },
      },
    })
  })

  it('X-Frame-Options: DENY → 退回原因 denied', async () => {
    const service = makeService()
    const outcome = await service.fetch(tls.tlsUrl('/xfo-deny'), undefined, 'page')
    expect(outcome.ok && outcome.meta.frame).toEqual({ embeddable: false, reason: 'denied' })
  })

  it('X-Frame-Options: SAMEORIGIN → 退回原因 denied', async () => {
    const service = makeService()
    const outcome = await service.fetch(tls.tlsUrl('/xfo-sameorigin'), undefined, 'page')
    expect(outcome.ok && outcome.meta.frame).toEqual({ embeddable: false, reason: 'denied' })
  })

  it("CSP frame-ancestors 'none' → 退回原因 denied", async () => {
    const service = makeService()
    const outcome = await service.fetch(tls.tlsUrl('/fa-none'), undefined, 'page')
    expect(outcome.ok && outcome.meta.frame).toEqual({ embeddable: false, reason: 'denied' })
  })

  it('CSP frame-ancestors * → embeddable=true', async () => {
    const service = makeService()
    const outcome = await service.fetch(tls.tlsUrl('/fa-wild'), undefined, 'page')
    expect(outcome.ok && outcome.meta.frame).toEqual({ embeddable: true })
  })

  it('HTTP 最终地址（http 受控服务器）→ 退回原因 http（混合内容）', async () => {
    const service = makeService()
    const outcome = await service.fetch(url('/html'), undefined, 'page')
    expect(outcome.ok && outcome.meta.frame).toEqual({ embeddable: false, reason: 'http' })
  })

  it('重定向链：预检取最终响应头（跳到 DENY 样本 → denied）', async () => {
    const service = makeService()
    const outcome = await service.fetch(tls.tlsUrl('/redirect-xfo'), undefined, 'page')
    expect(outcome.ok && outcome.meta.frame).toEqual({ embeddable: false, reason: 'denied' })
    expect(outcome.ok && outcome.meta.url).toBe(tls.tlsUrl('/xfo-deny'))
  })

  it('card 形态抓取不带 frame（同 URL 两形态缓存键分离）', async () => {
    const service = makeService()
    const card = await service.fetch(tls.tlsUrl('/ok'), undefined, 'card')
    expect(card.ok && card.meta.frame).toBeUndefined()
    const page = await service.fetch(tls.tlsUrl('/ok'), undefined, 'page')
    expect(page.ok && page.meta.frame).toEqual({ embeddable: true })
  })

  it('page 形态缓存命中复用 frame（两次抓取一次网络）', async () => {
    const before = tls.hits.length
    const service = makeService()
    const a = await service.fetch(tls.tlsUrl('/xfo-deny'), undefined, 'page')
    const b = await service.fetch(tls.tlsUrl('/xfo-deny'), undefined, 'page')
    expect(a.ok && a.meta.frame).toEqual({ embeddable: false, reason: 'denied' })
    expect(b).toEqual(a)
    expect(tls.hits.length - before).toBe(1)
  })

  it('page 形态超时仍按 web-timeout 失败（预检不豁免网络边界）', async () => {
    const service = makeService({ timeoutMs: 200 })
    const outcome = await service.fetch(tls.tlsUrl('/hang?page=1'), undefined, 'page')
    expect(outcome).toEqual({ ok: false, reason: 'web-timeout' })
  })
})

describe('WebLinkMetaService 合并与取消', () => {
  it('同 URL 并发请求合并为一次网络请求', async () => {
    const before = ctx.hits.length
    const service = makeService()
    const [a, b] = await Promise.all([service.fetch(url('/html')), service.fetch(url('/html'))])
    expect(a).toEqual(b)
    expect(ctx.hits.length - before).toBe(1)
  })

  it('URL 归一后合并：大小写/fragment 差异共享请求与缓存', async () => {
    const before = ctx.hits.length
    const service = makeService()
    const base = url('/html')
    const variants = [
      base,
      `http://127.0.0.1:${ctx.port}/html#frag`,
      `http://127.0.0.1:${ctx.port}/./html`,
    ]
    const results = await Promise.all(variants.map((u) => service.fetch(u)))
    expect(ctx.hits.length - before).toBe(1)
    for (const r of results) {
      expect(r).toEqual(results[0])
    }
  })

  it('最后消费者取消时中止底层连接（服务端观测请求中断）', async () => {
    let onInterrupted!: () => void
    const interrupted = new Promise<void>((resolve) => {
      onInterrupted = resolve
    })
    const srv = await startServer((req, res) => {
      // 不响应：等待客户端中止；服务端观测请求中断（req aborted / res close）
      req.on('aborted', onInterrupted)
      res.on('close', onInterrupted)
    })
    const service = makeService({ timeoutMs: 5000 })
    const c1 = new AbortController()
    const c2 = new AbortController()
    const p1 = service.fetch(`http://127.0.0.1:${srv.port}/merge`, c1.signal)
    const p2 = service.fetch(`http://127.0.0.1:${srv.port}/merge`, c2.signal)
    await new Promise((r) => setTimeout(r, 150))
    c1.abort() // 第一个消费者离开：不中止（还有 p2 在场）
    const settle1 = expect(p1).rejects.toThrow() // 先挂 handler（abort 后的定时器窗口内不悬空 rejected promise）
    await new Promise((r) => setTimeout(r, 200))
    c2.abort() // 最后消费者：中止底层
    await settle1
    await expect(p2).rejects.toThrow()
    await interrupted
  })

  it('取消后同 URL 新请求重新发起（在途条目已清除）', async () => {
    const srv = await startServer(() => {
      // 挂起：保证取消发生在完成前，新请求才能证明在途条目已清除
    })
    const service = makeService({ timeoutMs: 1500 })
    const c = new AbortController()
    const p = service.fetch(`http://127.0.0.1:${srv.port}/re`, c.signal)
    await new Promise((r) => setTimeout(r, 100))
    const settle = expect(p).rejects.toThrow()
    c.abort()
    await settle
    expect(srv.hits.length).toBe(1) // 第一连接已到达（随后被中止）
    const again = service.fetch(`http://127.0.0.1:${srv.port}/re`)
    await new Promise((r) => setTimeout(r, 150))
    expect(srv.hits.length).toBe(2) // 在途条目清除后重新发起
    await expect(again).resolves.toEqual({ ok: false, reason: 'web-timeout' }) // 挂起服务器最终超时
  })

  it('cancelAll：中止全部在途（开关关闭语义；未传 signal 的消费者收敛为失败分态）', async () => {
    const srv = await startServer(() => {
      // 挂起
    })
    const service = makeService({ timeoutMs: 5000 })
    const p = service.fetch(`http://127.0.0.1:${srv.port}/x`)
    await new Promise((r) => setTimeout(r, 120))
    service.cancelAll()
    await expect(p).resolves.toEqual({ ok: false, reason: 'web-unreachable' })
  })
})

describe('WebLinkMetaService 并发限制', () => {
  it('并发上限内排队：concurrency=1 时请求串行到达服务器', async () => {
    const overlaps: Array<{ url: string; start: number; end: number }> = []
    const srv = await startServer((_req, res) => {
      const entry = { url: String(_req?.url ?? ''), start: Date.now(), end: 0 }
      overlaps.push(entry)
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end(PAGE)
        entry.end = Date.now()
      }, 120)
    })
    const service = makeService({ concurrency: 1 })
    const [a, b] = await Promise.all([
      service.fetch(`http://127.0.0.1:${srv.port}/a`),
      service.fetch(`http://127.0.0.1:${srv.port}/b`),
    ])
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    const [first, second] = overlaps
    expect(second.start).toBeGreaterThanOrEqual(first.end)
  })
})

describe('WebLinkMetaService 内存缓存', () => {
  it('命中：同 URL 二次 fetch 零网络请求', async () => {
    const before = ctx.hits.length
    const service = makeService()
    await service.fetch(url('/html'))
    await service.fetch(url('/html'))
    expect(ctx.hits.length - before).toBe(1)
  })

  it('TTL 过期后重新请求', async () => {
    const before = ctx.hits.length
    const service = makeService({ cacheTtlMs: 60 })
    await service.fetch(url('/html'))
    await new Promise((r) => setTimeout(r, 90))
    await service.fetch(url('/html'))
    expect(ctx.hits.length - before).toBe(2)
  })

  it('容量淘汰：超条目数后最旧条目重取', async () => {
    const srv = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(PAGE)
    })
    const service = makeService({ cacheMaxEntries: 2 })
    await service.fetch(`http://127.0.0.1:${srv.port}/one`)
    await service.fetch(`http://127.0.0.1:${srv.port}/two`)
    await service.fetch(`http://127.0.0.1:${srv.port}/three`) // 淘汰 one
    const countBefore = srv.hits.length
    await service.fetch(`http://127.0.0.1:${srv.port}/one`) // 重取
    expect(srv.hits.length).toBe(countBefore + 1)
  })

  it('字节费用淘汰：总字节上限触发最旧条目淘汰', async () => {
    const srv = await startServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(PAGE)
    })
    // PAGE 元信息条目费用 ~240 字节；上限 256 → 第二条（480 > 256）触发淘汰
    const service = makeService({ cacheMaxBytes: 256, cacheMaxEntries: 10 })
    await service.fetch(`http://127.0.0.1:${srv.port}/one`)
    await service.fetch(`http://127.0.0.1:${srv.port}/two`) // 淘汰 one
    const countBefore = srv.hits.length
    await service.fetch(`http://127.0.0.1:${srv.port}/one`)
    expect(srv.hits.length).toBe(countBefore + 1)
  })

  it('失败不缓存：失败后重试重新请求（保留重试语义）', async () => {
    const before = ctx.hits.length
    const service = makeService()
    expect(await service.fetch(url('/status404'))).toEqual({ ok: false, reason: 'web-unreachable' })
    expect(await service.fetch(url('/status404'))).toEqual({ ok: false, reason: 'web-unreachable' })
    expect(ctx.hits.length - before).toBe(2)
  })

  it('不持久：新服务实例缓存为空（零磁盘、零跨实例浏览历史）', async () => {
    const before = ctx.hits.length
    const first = makeService()
    await first.fetch(url('/html'))
    const second = makeService()
    await second.fetch(url('/html'))
    expect(ctx.hits.length - before).toBe(2)
  })

  it('clearCache：显式清空后重取', async () => {
    const before = ctx.hits.length
    const service = makeService()
    await service.fetch(url('/html'))
    service.clearCache()
    await service.fetch(url('/html'))
    expect(ctx.hits.length - before).toBe(2)
  })
})

describe('WebLinkMetaService 默认参数契约（报告参数表的钉子）', () => {
  it('默认界限：8s 超时 / 2MiB 字节 / 4 跳重定向 / 并发 3 / 缓存 32 条 256KiB 10min', () => {
    expect(WEB_LINK_LIMITS.timeoutMs).toBe(8000)
    expect(WEB_LINK_LIMITS.maxBytes).toBe(2 * 1024 * 1024)
    expect(WEB_LINK_LIMITS.maxRedirects).toBe(4)
    expect(WEB_LINK_LIMITS.concurrency).toBe(3)
    expect(WEB_LINK_LIMITS.cacheMaxEntries).toBe(32)
    expect(WEB_LINK_LIMITS.cacheMaxBytes).toBe(256 * 1024)
    expect(WEB_LINK_LIMITS.cacheTtlMs).toBe(10 * 60 * 1000)
  })
})
