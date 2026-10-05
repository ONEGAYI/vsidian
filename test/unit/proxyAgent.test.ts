// #346（用户裁决改进）外链抓取代理接入契约：resolveProxyConfig 决策矩阵
// （VSCode http.proxy 族语义：proxySupport=off 直连 / 设置优先 / 环境变量
// 兜底 / 非法回退直连信号）与 connectThroughProxy CONNECT 隧道（受控假代理
// + 自签名 TLS 目标——请求行/认证头/送达/取消/非 2xx/证书校验）。
//
// 代理模式下的 SSRF 降级语义（DNS 解析与真实连接发生在代理侧，宿主 lookup
// 层校验不可达）的网络面不在本文件——webLinkMetaService.test.ts 的「代理
// 模式 lookup 校验不可达」用例与既有直连 DNS 换址用例对照钉住该语义。
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import type { Duplex } from 'node:stream'
import { readFileSync } from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  PROXY_TUNNEL_ERROR_CODE,
  connectThroughProxy,
  proxyPortOf,
  resolveProxyConfig,
  type ProxyTarget,
} from '../../src/host/proxyAgent'

const PAGE = `<!doctype html><html><head><title>隧道目标页</title></head><body><p>正文</p></body></html>`

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')

// ---- 受控 TLS 目标（自签名证书，与 webLinkMetaService.test 嵌入预检夹具同源） ----

let targetPort = 0
let targetHits = 0
const targetServer = https.createServer(
  {
    key: readFileSync(path.join(fixturesDir, 'webframe-test-key.pem')),
    cert: readFileSync(path.join(fixturesDir, 'webframe-test-cert.pem')),
  },
  (req, res) => {
    targetHits++
    if (req.url === '/hang') {
      return // 挂起：取消语义样本
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(PAGE)
  },
)

// ---- 受控假代理：CONNECT 隧道放行（策略可换）+ 绝对形态请求观测 ----

interface ConnectRecord {
  authority: string
  authorization?: string
}

const connectRecords: ConnectRecord[] = []
let clientCloses = 0
let connectPolicy: (req: http.IncomingMessage, socket: Duplex, head: Buffer) => void

function grantTunnel(req: http.IncomingMessage, clientSocket: Duplex, head: Buffer): void {
  const authority = req.url ?? ''
  const idx = authority.lastIndexOf(':')
  const host = authority.slice(0, idx)
  const port = Number(authority.slice(idx + 1))
  const upstream = net.connect(port, host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    if (head.length > 0) {
      upstream.write(head)
    }
    upstream.pipe(clientSocket)
    clientSocket.pipe(upstream)
  })
  clientSocket.on('error', () => upstream.destroy())
  clientSocket.on('close', () => upstream.destroy())
  upstream.on('error', () => clientSocket.destroy())
}

const proxyServer = http.createServer()

let proxyPort = 0

// CONNECT 升级后的 socket 脱离 Node 服务端连接追踪，closeAllConnections
// 不覆盖（close 回调将永不触发）——手动追踪，收尾显式销毁
const tunnelSockets = new Set<Duplex>()

beforeAll(async () => {
  proxyServer.on('connect', (req, clientSocket, head) => {
    tunnelSockets.add(clientSocket)
    clientSocket.on('close', () => {
      tunnelSockets.delete(clientSocket)
      clientCloses++
    })
    connectRecords.push({ authority: req.url ?? '', authorization: req.headers['proxy-authorization'] })
    connectPolicy(req, clientSocket, head)
  })
  connectPolicy = grantTunnel
  await new Promise<void>((resolve) => proxyServer.listen(0, '127.0.0.1', resolve))
  proxyPort = (proxyServer.address() as { port: number }).port
  await new Promise<void>((resolve) => targetServer.listen(0, '127.0.0.1', resolve))
  targetPort = (targetServer.address() as { port: number }).port
})

afterAll(async () => {
  for (const socket of tunnelSockets) {
    socket.destroy()
  }
  await new Promise<void>((resolve) => {
    proxyServer.close(() => resolve())
    proxyServer.closeAllConnections()
  })
  await new Promise<void>((resolve) => {
    targetServer.close(() => resolve())
    targetServer.closeAllConnections()
  })
})

const proxyTarget = (extra: Partial<ProxyTarget> = {}): ProxyTarget => ({
  url: new URL(`http://127.0.0.1:${proxyPort}`),
  rejectUnauthorized: false,
  ...extra,
})

const noEnv: Record<string, string | undefined> = {}

// ---- 决策矩阵（纯函数：无网络） ----

describe('resolveProxyConfig 决策矩阵（VSCode http.proxy 族语义）', () => {
  it('proxySupport=off：不使用代理（http.proxy 在场也直连，环境变量同样忽略）', () => {
    const decision = resolveProxyConfig(
      { proxy: `http://127.0.0.1:${proxyPort}`, proxySupport: 'off' },
      { HTTPS_PROXY: 'http://env:1' },
      'https:',
    )
    expect(decision).toEqual({ mode: 'direct' })
  })

  it('http.proxy 在场：走代理，默认严格证书校验', () => {
    const decision = resolveProxyConfig({ proxy: `http://127.0.0.1:${proxyPort}` }, noEnv, 'https:')
    expect(decision.mode).toBe('proxy')
    if (decision.mode === 'proxy') {
      expect(decision.target.url.hostname).toBe('127.0.0.1')
      expect(decision.target.url.port).toBe(String(proxyPort))
      expect(decision.target.authorization).toBeUndefined()
      expect(decision.target.rejectUnauthorized).toBe(true)
    }
  })

  it('无 scheme 的 host:port 按 http:// 处理（VSCode 惯例宽容形态）', () => {
    const decision = resolveProxyConfig({ proxy: `127.0.0.1:${proxyPort}` }, noEnv, 'https:')
    expect(decision.mode).toBe('proxy')
    if (decision.mode === 'proxy') {
      expect(decision.target.url.protocol).toBe('http:')
    }
  })

  it('端口缺省：决策不虚构端口（WHATWG URL 剥 http 默认端口），消费侧按 80 归一', () => {
    const decision = resolveProxyConfig({ proxy: 'http://proxy.internal' }, noEnv, 'https:')
    expect(decision.mode).toBe('proxy')
    if (decision.mode === 'proxy') {
      expect(decision.target.url.port).toBe('')
      expect(proxyPortOf(decision.target)).toBe(80)
    }
  })

  it('代理 URL 的 userinfo 拆为 Basic Proxy-Authorization（VSCode 惯例）', () => {
    const decision = resolveProxyConfig({ proxy: `http://u:p@127.0.0.1:${proxyPort}` }, noEnv, 'https:')
    expect(decision.mode).toBe('proxy')
    if (decision.mode === 'proxy') {
      expect(decision.target.authorization).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`)
    }
  })

  it('proxyAuthorization 设置在场时优先于 userinfo 派生值', () => {
    const decision = resolveProxyConfig(
      { proxy: `http://u:p@127.0.0.1:${proxyPort}`, proxyAuthorization: 'Bearer corp-token' },
      noEnv,
      'https:',
    )
    expect(decision.mode).toBe('proxy')
    if (decision.mode === 'proxy') {
      expect(decision.target.authorization).toBe('Bearer corp-token')
    }
  })

  it('proxyStrictSSL=false → rejectUnauthorized=false（MITM 型代理需要）', () => {
    const decision = resolveProxyConfig(
      { proxy: `http://127.0.0.1:${proxyPort}`, proxyStrictSSL: false },
      noEnv,
      'https:',
    )
    expect(decision.mode).toBe('proxy')
    if (decision.mode === 'proxy') {
      expect(decision.target.rejectUnauthorized).toBe(false)
    }
  })

  it('proxySupport 其他值（on/override/onRequest）照常走代理', () => {
    for (const support of ['on', 'override', 'onRequest', undefined]) {
      const decision = resolveProxyConfig({ proxy: `http://127.0.0.1:${proxyPort}`, proxySupport: support }, noEnv, 'https:')
      expect(decision.mode, `proxySupport=${String(support)}`).toBe('proxy')
    }
  })

  it('设置缺席：https 目标走 HTTPS_PROXY 环境变量兜底', () => {
    const decision = resolveProxyConfig({}, { HTTPS_PROXY: `http://10.0.0.2:8080` }, 'https:')
    expect(decision.mode).toBe('proxy')
    if (decision.mode === 'proxy') {
      expect(decision.target.url.hostname).toBe('10.0.0.2')
    }
  })

  it('设置缺席：小写 https_proxy 同样兜底（Node 惯例大小写双收）', () => {
    const decision = resolveProxyConfig({}, { https_proxy: `http://10.0.0.3:8080` }, 'https:')
    expect(decision.mode).toBe('proxy')
  })

  it('设置缺席：http 目标走 HTTP_PROXY（协议感知），不误用 HTTPS_PROXY', () => {
    const decision = resolveProxyConfig({}, { HTTPS_PROXY: 'http://s:1', HTTP_PROXY: 'http://h:2', http_proxy: 'http://h3:3' }, 'http:')
    expect(decision.mode).toBe('proxy')
    if (decision.mode === 'proxy') {
      expect(decision.target.url.hostname).toBe('h')
    }
  })

  it('设置与环境变量都没有：维持直连', () => {
    expect(resolveProxyConfig({}, noEnv, 'https:')).toEqual({ mode: 'direct' })
  })

  it('代理 URL 解析失败（http://[）：按 invalid 回退直连并携带原始值（warn 去抖键）', () => {
    const decision = resolveProxyConfig({ proxy: 'http://[' }, noEnv, 'https:')
    expect(decision).toEqual({ mode: 'invalid', source: 'http://[' })
  })

  it('不支持的 scheme（socks5）：同样按 invalid 回退直连', () => {
    const decision = resolveProxyConfig({ proxy: 'socks5://127.0.0.1:1080' }, noEnv, 'https:')
    expect(decision).toEqual({ mode: 'invalid', source: 'socks5://127.0.0.1:1080' })
  })
})

// ---- CONNECT 隧道（受控假代理 + 自签名 TLS 目标） ----

describe('connectThroughProxy CONNECT 隧道', () => {
  it('CONNECT 请求行与 authority 正确、认证头拼装送达假代理', async () => {
    const before = connectRecords.length
    const socket = await connectThroughProxy(
      proxyTarget({ authorization: `Basic ${Buffer.from('u:p').toString('base64')}` }),
      '127.0.0.1',
      targetPort,
      { servername: '127.0.0.1', rejectUnauthorized: false },
      new AbortController().signal,
    )
    socket.destroy()
    expect(connectRecords.length - before).toBe(1)
    expect(connectRecords[connectRecords.length - 1]).toEqual({
      authority: `127.0.0.1:${targetPort}`,
      authorization: `Basic ${Buffer.from('u:p').toString('base64')}`,
    })
  })

  it('隧道后请求送达目标：TLS 握手成功且 HTTP 响应经隧道回流', async () => {
    const hitsBefore = targetHits
    const socket = await connectThroughProxy(
      proxyTarget(),
      '127.0.0.1',
      targetPort,
      { servername: '127.0.0.1', rejectUnauthorized: false },
      new AbortController().signal,
    )
    const response = await new Promise<string>((resolve, reject) => {
      let data = ''
      socket.on('data', (chunk: Buffer) => {
        data += chunk.toString('utf8')
      })
      socket.on('end', () => resolve(data))
      socket.on('error', reject)
      socket.write(`GET /tunnel HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`)
    })
    expect(response).toContain('200')
    expect(response).toContain('隧道目标页')
    expect(targetHits - hitsBefore).toBe(1)
  })

  it('IP 字面量目标省略 servername 亦可完成 TLS 握手（不触发 RFC 6066 弃用路径）', async () => {
    const socket = await connectThroughProxy(
      proxyTarget(),
      '127.0.0.1',
      targetPort,
      { servername: '127.0.0.1', rejectUnauthorized: false },
      new AbortController().signal,
    )
    expect(typeof socket.getProtocol()).toBe('string') // TLS 会话已建立
    socket.destroy()
  })

  it('CONNECT 非 2xx（407）：按隧道失败拒绝，错误码与状态可见', async () => {
    connectPolicy = (_req, clientSocket) => {
      clientSocket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n')
    }
    try {
      await connectThroughProxy(
        proxyTarget(),
        '127.0.0.1',
        targetPort,
        { servername: '127.0.0.1', rejectUnauthorized: false },
        new AbortController().signal,
      )
      expect.unreachable('407 CONNECT 应拒绝')
    } catch (err) {
      expect((err as NodeJS.ErrnoException).code).toBe(PROXY_TUNNEL_ERROR_CODE)
      expect((err as Error).message).toContain('407')
    } finally {
      connectPolicy = grantTunnel
    }
  })

  it('取消中断 CONNECT 阶段（代理挂起不答）：AbortError 且客户端连接关闭被代理观测', async () => {
    connectPolicy = () => {
      // 不应答：等待客户端取消
    }
    const controller = new AbortController()
    const closesBefore = clientCloses
    const attempt = connectThroughProxy(
      proxyTarget(),
      '127.0.0.1',
      targetPort,
      { servername: '127.0.0.1', rejectUnauthorized: false },
      controller.signal,
    )
    setTimeout(() => controller.abort(), 120)
    await expect(attempt).rejects.toMatchObject({ name: 'AbortError' })
    await new Promise((r) => setTimeout(r, 80))
    expect(clientCloses).toBeGreaterThan(closesBefore)
    connectPolicy = grantTunnel
  })

  it('取消中断 TLS 握手阶段（代理放行但目标静默）：AbortError', async () => {
    connectPolicy = (_req, clientSocket) => {
      // 放行但不上连目标：握手等待 ServerHello 永不到来
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    }
    const controller = new AbortController()
    const attempt = connectThroughProxy(
      proxyTarget(),
      '127.0.0.1',
      targetPort,
      { servername: '127.0.0.1', rejectUnauthorized: false },
      controller.signal,
    )
    setTimeout(() => controller.abort(), 120)
    await expect(attempt).rejects.toMatchObject({ name: 'AbortError' })
    connectPolicy = grantTunnel
  })

  it('代理端口不可达：按连接失败拒绝（非 abort、非隧道状态码）', async () => {
    // 绑定后立即关闭的端口：ECONNREFUSED
    const dead = net.createServer()
    await new Promise<void>((resolve) => dead.listen(0, '127.0.0.1', resolve))
    const deadPort = (dead.address() as { port: number }).port
    await new Promise<void>((resolve) => dead.close(() => resolve()))
    await expect(connectThroughProxy(
      { url: new URL(`http://127.0.0.1:${deadPort}`), rejectUnauthorized: false },
      '127.0.0.1',
      targetPort,
      { servername: '127.0.0.1', rejectUnauthorized: false },
      new AbortController().signal,
    )).rejects.toMatchObject({ code: 'ECONNREFUSED' })
  })

  it('rejectUnauthorized=true 对自签名目标证书：TLS 失败（证书校验保持）', async () => {
    await expect(connectThroughProxy(
      proxyTarget(),
      '127.0.0.1',
      targetPort,
      { servername: '127.0.0.1', rejectUnauthorized: true },
      new AbortController().signal,
    )).rejects.toSatisfy((err: unknown) => {
      const code = (err as NodeJS.ErrnoException).code ?? ''
      return /CERT|SSL|TLS/i.test(code) || /certificate|SSL|TLS/i.test((err as Error).message)
    })
  })
})
