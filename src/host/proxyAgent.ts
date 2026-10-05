// #346（用户裁决改进）外链抓取代理接入：宿主受限抓取（webLinkMetaService）
// 尊重 VSCode http.proxy 配置族——TUN/企业代理环境下宿主 Node 网络栈与
// 系统浏览器网络路径分叉（宿主直连不可达而浏览器可达），接上代理后宿主
// 抓取与浏览器同路。零新依赖：手写 CONNECT 隧道（https 目标）与绝对形态
// 转发（http 目标，URL 准入同收 http）。
//
// 本模块纯 Node、不依赖 vscode——决策解析（resolveProxyConfig）为纯函数，
// vscode 配置读取由接线侧（textEditorProvider）注入；隧道（connectThroughProxy）
// 只负责建连，超时预算与取消由调用方经 AbortSignal 贯穿。
//
// SSRF 防线降级语义（安全关键，如实落档；规格「外链形态、网络与退回」第 3 条）：
// - 直连模式（未配置代理）：webLinkMetaService 的 lookup 层校验（域名解析
//   结果过 isAllowedInetAddress 矩阵，防 DNS 预查与真连换址脱节）完整保持，
//   本模块零改动该路径；
// - 代理模式：DNS 解析与真实连接发生在代理侧，宿主 lookup 层校验不可达
//   （本地不再解析目标域名）——准入退为 URL 文本层（checkWebLinkUrl）+
//   重定向链每跳文本复核，实际 IP 安全由代理侧承担。这是企业/本机代理
//   语义下已接受的取舍（用户显式配置的代理即信任边界），与浏览器代理行为
//   一致；代理监听地址本身不做私网拒绝（127.0.0.1:7890 是常见形态，且是
//   用户配置而非 URL 注入面）。
// - 代理模式下目标 TLS 证书校验默认保持（rejectUnauthorized=true）；
//   http.proxyStrictSSL=false 时放宽——MITM 型代理（TUN 出口、企业中间盒）
//   会改写证书链，严格校验将全数失败，该开关即为此场景准备。
import * as http from 'node:http'
import * as tls from 'node:tls'

/** 隧道失败错误的 code 标记（CONNECT 非 2xx / 隧道中断归因用） */
export const PROXY_TUNNEL_ERROR_CODE = 'VSIDIAN_PROXY_TUNNEL'

/** 决策输入：VSCode `http` 配置族的原始读值（unknown 容忍读取失败形态） */
export interface ProxyConfigInput {
  /** http.proxy：代理 URL（支持 host:port 无 scheme 形态与 userinfo 认证） */
  proxy?: unknown
  /** http.proxyAuthorization：显式 Proxy-Authorization 头值（优先于 userinfo 派生） */
  proxyAuthorization?: unknown
  /** http.proxyStrictSSL：false 时放宽目标 TLS 证书校验（默认严格） */
  proxyStrictSSL?: unknown
  /** http.proxySupport：'off' 时不使用代理；其余值照常 */
  proxySupport?: unknown
}

/** 解析后的代理目标（决策 mode=proxy 时携带） */
export interface ProxyTarget {
  /** 代理监听地址（scheme 恒 http:——https/socks 代理本实现不支持，解析期按非法回退） */
  url: URL
  /** Proxy-Authorization 头值（userinfo 派生 Basic 或显式设置） */
  authorization?: string
  /** 目标 TLS 证书校验开关（http.proxyStrictSSL=false → false） */
  rejectUnauthorized: boolean
}

/** 代理决策：direct = 直连（现行为）；proxy = 走代理；invalid = 配置无法
 *  应用（携带原始值作 warn 去抖键——同会话同错只提示一次），消费侧回退
 *  直连 */
export type ProxyDecision =
  | { mode: 'direct' }
  | { mode: 'proxy'; target: ProxyTarget }
  | { mode: 'invalid'; source: string }

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/**
 * 代理决策解析（纯函数）：
 * - `proxySupport === 'off'` → 直连（设置与环境变量一并忽略）；
 * - 其余值：`http.proxy` 设置优先；缺席时按目标协议取环境变量兜底
 *   （https → HTTPS_PROXY/https_proxy，http → HTTP_PROXY/http_proxy——Node
 *   惯例协议感知）；都没有 → 直连；
 * - 代理 URL 支持 `http://host:port`（端口缺省补 80）与无 scheme 的
 *   `host:port`（按 http:// 处理）；userinfo 按 VSCode 惯例拆为 Basic
 *   Proxy-Authorization，显式 proxyAuthorization 在场时优先；
 * - 解析失败或 scheme 不支持（https/socks 代理）→ `{ mode: 'invalid',
 *   source }`：调用方回退直连并对同值 warn 去抖。
 */
export function resolveProxyConfig(
  input: ProxyConfigInput,
  env: Record<string, string | undefined>,
  targetProtocol: string,
): ProxyDecision {
  if (input.proxySupport === 'off') {
    return { mode: 'direct' }
  }
  const setting = nonEmptyString(input.proxy)
  const envNames = targetProtocol === 'http:'
    ? ['HTTP_PROXY', 'http_proxy']
    : ['HTTPS_PROXY', 'https_proxy']
  const source = setting ?? envNames.map((name) => nonEmptyString(env[name])).find((v) => v !== undefined)
  if (source === undefined) {
    return { mode: 'direct' }
  }
  // URL 构造对「host:port」形态会误读 scheme（如 127.0.0.1:7890 → 协议
  // 「127.0.0.1:」），无 scheme 时补 http://（curl 同语义）
  const normalized = source.includes('://') ? source : `http://${source}`
  let url: URL
  try {
    url = new URL(normalized)
  } catch {
    return { mode: 'invalid', source }
  }
  if (url.protocol !== 'http:' || url.port !== '' && !Number.isFinite(Number(url.port))) {
    return { mode: 'invalid', source }
  }
  const authorization = nonEmptyString(input.proxyAuthorization)
    ?? ((url.username !== '' || url.password !== '')
      ? `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64')}`
      : undefined)
  return {
    mode: 'proxy',
    target: {
      url,
      ...(authorization !== undefined ? { authorization } : {}),
      rejectUnauthorized: input.proxyStrictSSL !== false,
    },
  }
}

/** 代理监听端口（URL 缺省时按 80 归一——WHATWG URL 会剥除 http 默认端口，
 *  归一统一放在消费侧，ProxyTarget 不另存冗余字段） */
export function proxyPortOf(target: ProxyTarget): number {
  return target.url.port === '' ? 80 : Number(target.url.port)
}

/**
 * CONNECT 隧道建连：向代理发 `CONNECT host:port`，2xx 应答后在代理 socket
 * 上做目标 TLS 握手，返回已就绪的 TLSSocket（供 https.request 经
 * createConnection 注入消费——Node 惯例：https 请求的连接即 TLS socket）。
 *
 * - AbortSignal 同时覆盖 CONNECT 阶段与 TLS 握手阶段（中断即销毁半成品
 *   连接，代理侧可观测断开）；超时预算由调用方的总预算 signal 贯穿，
 *   本函数不自设定时器；
 * - IP 字面量目标省略 servername（RFC 6066 不允许 IP 作 SNI；证书校验
 *   仍由 rejectUnauthorized 执行——链校验不依赖 SNI）；
 * - CONNECT 非 2xx → code=VSIDIAN_PROXY_TUNNEL、message 含状态码。
 */
export function connectThroughProxy(
  target: ProxyTarget,
  host: string,
  port: number,
  tlsOptions: { servername?: string; rejectUnauthorized: boolean },
  signal: AbortSignal,
): Promise<tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('This operation was aborted', 'AbortError'))
      return
    }
    const proxyHost = target.url.hostname.replace(/^\[|\]$/g, '')
    const proxyPort = proxyPortOf(target)
    const authority = `${host}:${port}`
    const connectReq = http.request({
      host: proxyHost,
      port: proxyPort,
      method: 'CONNECT',
      path: authority,
      headers: {
        host: authority,
        ...(target.authorization !== undefined ? { 'proxy-authorization': target.authorization } : {}),
      },
    })
    let tlsSocket: tls.TLSSocket | null = null
    let settled = false
    const onAbort = (): void => {
      if (settled) {
        return
      }
      settled = true
      signal.removeEventListener('abort', onAbort)
      connectReq.destroy()
      tlsSocket?.destroy()
      reject(new DOMException('This operation was aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
    connectReq.on('connect', (res, socket) => {
      const status = res.statusCode ?? 0
      if (status < 200 || status >= 300) {
        if (settled) {
          socket.destroy()
          return
        }
        settled = true
        signal.removeEventListener('abort', onAbort)
        socket.destroy()
        connectReq.destroy()
        const err = new Error(`proxy CONNECT rejected with status ${status}`) as NodeJS.ErrnoException
        err.code = PROXY_TUNNEL_ERROR_CODE
        reject(err)
        return
      }
      if (settled) {
        socket.destroy()
        return
      }
      // IP 字面量目标不带 servername（RFC 6066：SNI 不得为 IP——带 IP 会触发
      // Node DEP0123 弃用警告；证书校验由 rejectUnauthorized 独立执行）
      const isIpLiteral = /^\[.*\]$/.test(host) || /^[0-9.]+$/.test(host)
      tlsSocket = tls.connect({
        socket,
        rejectUnauthorized: tlsOptions.rejectUnauthorized,
        ...(isIpLiteral ? {} : { servername: tlsOptions.servername ?? host }),
      }, () => {
        if (settled) {
          tlsSocket?.destroy()
          return
        }
        settled = true
        signal.removeEventListener('abort', onAbort)
        resolve(tlsSocket!)
      })
      tlsSocket.on('error', (err) => {
        if (settled) {
          return
        }
        settled = true
        signal.removeEventListener('abort', onAbort)
        tlsSocket?.destroy()
        reject(err)
      })
    })
    connectReq.on('error', (err) => {
      if (settled) {
        return
      }
      settled = true
      signal.removeEventListener('abort', onAbort)
      tlsSocket?.destroy()
      reject(err)
    })
    connectReq.end()
  })
}
