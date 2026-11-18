// #342（P3-10）外链元信息受限抓取服务（宿主侧；Remote SSH 下抓取自然
// 发生在远端宿主——本模块随扩展宿主进程运行）：悬停触发后的有界 HTTP(S)
// 抓取 + 同 URL 合并 + 最后消费者取消 + 内存 LRU 缓存。
//
// 网络边界（三期正式规格「外链形态、网络与退回」第 3 条，默认值见
// WEB_LINK_LIMITS）：
// - 只接 HTTP(S)；拒绝凭据 URL、私网/回环/链路本地地址——URL 文本层
//   （字面 IP）与 lookup 层（域名解析结果）共用 shared/webLink 的同一
//   isAllowedInetAddress 矩阵，**重定向每一跳都重新过全套准入**：校验
//   发生在实际连接的 DNS 解析点上，杜绝「预查合法、真连换址」脱节；
// - MIME 白名单（text/html / application/xhtml+xml）、响应字节上限
//   （Content-Length 预检 + 流式累计中断）、总预算超时（含重定向链）、
//   重定向跳数上限、并发上限（超出排队，不占超时预算）；
// - 请求头只带 UA/Accept：不带 cookie、不带文档路径/正文/身份凭据。
//
// 抓取结果经 webMetaExtract 非执行解析（htmlparser2）——不执行远程
// HTML，只额外读取页面声明的站点图标和显式开启的封面。两者均复用
// URL、重定向与连接校验，不发送来源页或登录凭据。
//
// 缓存：仅内存（键 = 形态 + 归一 URL），条目/字节双上限 + TTL + LRU
// 淘汰，失败不缓存（保留重试语义）；不持久化任何浏览历史。
//
// #346（用户裁决改进）代理接入：接线侧注入 getProxy 决策器（VSCode
// http.proxy 族），在场时 https 目标走 CONNECT 隧道、http 目标走绝对
// 形态转发（proxyAgent.ts），消除宿主 Node 栈与系统浏览器网络路径分叉；
// proxySupport=off / 未配置 / 配置非法（回退直连 + warn 去抖）时维持直连。
// **代理模式 SSRF 降级语义**：DNS 解析与真实连接发生在代理侧，本服务的
// lookup 层校验不可达——准入退为 URL 文本层 + 重定向链文本复核，实际 IP
// 安全由代理侧承担（企业/本机代理语义下接受，语义对照测试钉住）；直连
// 模式（未配置代理）的 lookup 校验一字不动。详见 proxyAgent.ts 头注与
// 规格「外链形态、网络与退回」第 3 条。
import * as dns from 'node:dns'
import * as http from 'node:http'
import * as https from 'node:https'
import type { Readable } from 'node:stream'
import type { TLSSocket } from 'node:tls'
import {
  assessWebFrameEmbeddability,
  checkWebLinkUrl,
  isAllowedInetAddress,
  WEB_PREVIEW_IMAGES,
  type WebFramePrecheck,
  type WebLinkFailReason,
  type WebLinkUrlCheck,
} from '../shared/webLink'
import { connectThroughProxy, proxyPortOf, PROXY_TUNNEL_ERROR_CODE, type ProxyDecision, type ProxyTarget } from './proxyAgent'
import { parseWebMetaFromHtml } from './webMetaExtract'

/** 代理配置串的 userinfo 脱敏（review-loops #346 增量轮）：剥「scheme://
 *  user:pass@」中的凭据段再进日志。按形态正则剥除——对合法与无法解析的
 *  原串同样适用（invalid 的常见成因恰是 https/socks 代理形态携带凭据）；
 *  主机与端口保留（定位配置问题所需），去抖键不受影响（用原始值） */
export function redactProxyCredentials(source: string): string {
  return source.replace(/(^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^@/:?#]+(?::[^@/?#]*)?)@/, '$1[redacted]@')
}

/** 抓取与缓存界限（默认值的依据见 #342 报告参数表；契约测试钉住） */
export interface WebLinkLimits {
  /** 总预算超时（毫秒，含全部重定向跳；排队等待不占预算） */
  timeoutMs: number
  /** 单次响应体字节上限（Content-Length 预检 + 流式累计中断） */
  maxBytes: number
  /** 重定向跳数上限（浏览器惯例 20 过宽；元信息链路短，4 跳覆盖常见跳转） */
  maxRedirects: number
  /** 在途抓取并发上限（超出排队；一次一个浮层场景下 3 足够） */
  concurrency: number
  /** 缓存条目上限 */
  cacheMaxEntries: number
  /** 缓存总字节上限（UTF-16 近似 + 固定开销） */
  cacheMaxBytes: number
  /** 缓存 TTL（毫秒） */
  cacheTtlMs: number
}

/** 默认界限：悬停是瞬态交互，8s 总预算接近用户等待上限；2 MiB 响应上限
 *  对齐引用面板 8 MiB 文本预算的保守量级（绝大多数 HTML < 1 MiB）；缓存
 *  32 条 / 256 KiB 覆盖典型阅读会话，10 min TTL 为新鲜度折衷 */
export const WEB_LINK_LIMITS: WebLinkLimits = {
  timeoutMs: 8_000,
  maxBytes: 2 * 1024 * 1024,
  maxRedirects: 4,
  concurrency: 3,
  cacheMaxEntries: 32,
  cacheMaxBytes: 256 * 1024,
  cacheTtlMs: 10 * 60 * 1000,
}

/** 请求 UA：诚实标识工具身份（不伪装浏览器、不携带版本以外的信息） */
const WEB_LINK_USER_AGENT = 'vsidian-link-preview/1.0 (+https://github.com/ONEGAYI/vsidian)'
const WEB_HTML_ACCEPT = 'text/html,application/xhtml+xml'
const WEB_REQUEST_ACCEPT = {
  card: WEB_HTML_ACCEPT,
  page: WEB_HTML_ACCEPT,
  icon: WEB_PREVIEW_IMAGES.icon.mimeTypes.join(','),
  cover: WEB_PREVIEW_IMAGES.cover.mimeTypes.join(','),
}

/** 提取结果（宿主内聚形态；出站载荷在 hoverDocAccess 装配层转换） */
export interface WebLinkMeta {
  /** 最终 URL（重定向后归一；显示与身份） */
  url: string
  /** 最终主机名（展示域名） */
  domain: string
  title: string
  description: string
  coverSrc?: string
  iconSrc?: string
  /** #343（P3-11）page 形态抓取附带的 iframe 嵌入预检（card 形态缺席）：
   *  最终响应的 X-Frame-Options / frame-ancestors / 最终协议判定——
   *  embeddable=true 仅代表已知头未拒绝，不是内容可见的承诺 */
  frame?: WebFramePrecheck
}

export type WebLinkMetaOutcome =
  | { ok: true; meta: WebLinkMeta }
  | { ok: false; reason: WebLinkFailReason }

interface CacheEntry {
  meta: WebLinkMeta
  at: number
  bytes: number
}

interface InFlightEntry {
  consumers: number
  controller: AbortController
  task: Promise<WebLinkMetaOutcome>
  includeCover: boolean
  coverController?: AbortController
}

/** 构造注入（测试用：受控服务器放行回环、时钟与限值覆盖） */
export interface WebLinkMetaServiceOptions {
  limits?: Partial<WebLinkLimits>
  /** URL 文本层准入覆盖（默认 = checkWebLinkUrl 生产矩阵；受控服务器场景
   *  注入放行回环——Node 对字面 IP 不经 lookup，放行必须发生在文本层） */
  checkUrl?: (href: string) => import('../shared/webLink').WebLinkUrlCheck
  /** 地址准入覆盖（默认 = shared/webLink 生产矩阵；lookup 层——域名解析后） */
  isAddressAllowed?: (address: string) => boolean
  now?: () => number
  /** #346 代理决策注入（默认 = 恒直连；生产接线传 VSCode http.proxy 读取
   *  器）。每跳请求前调用——配置变更无需重启生效。返回 mode=invalid 时回
   *  退直连并对同值 warn 去抖；代理模式下 lookup 层地址校验不可达（SSRF
   *  降级语义见模块头与 proxyAgent.ts） */
  getProxy?: (targetProtocol: string) => ProxyDecision
}

const BLOCK_ADDR_CODE = 'VSIDIAN_WEB_BLOCKED_ADDR'

type WebLinkResponse =
  | { kind: 'body'; url: string; mime: string; bytes: Buffer; frame?: WebFramePrecheck }
  | { kind: 'outcome'; outcome: Extract<WebLinkMetaOutcome, { ok: false }> }

type WebLinkRequestStep = WebLinkResponse | { kind: 'redirect'; location: string }
type WebImageKind = keyof typeof WEB_PREVIEW_IMAGES
type WebLinkRequestMode = 'card' | 'page' | WebImageKind

/** 页面声明的图片地址可能包含签名；诊断只保留资源类型和站点。 */
function webImageLogScope(url: string, mode: WebLinkRequestMode): string | undefined {
  if (mode === 'card' || mode === 'page') return undefined
  return `${mode === 'icon' ? '图标' : '封面'} ${new URL(url).origin}`
}

/** 网络错误归因（诊断日志细分 cause；不参与 outcome 分态判定） */
type WebFetchErrorKind = 'dns' | 'tcp' | 'tunnel' | 'tls' | 'network'

function classifyWebFetchError(err: NodeJS.ErrnoException): WebFetchErrorKind {
  const code = err.code ?? ''
  if (code === PROXY_TUNNEL_ERROR_CODE) {
    return 'tunnel'
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EAI_NODATA' || code === 'EAI_FAIL' || code === 'EAI_NONAME' || code === 'ENODATA') {
    return 'dns'
  }
  if (/CERT|SSL|TLS/i.test(code) || /certificate|SSL|TLS/i.test(err.message ?? '')) {
    return 'tls'
  }
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH' ||
    code === 'ECONNRESET' || code === 'EPIPE' || code === 'ENETDOWN' || code === 'EADDRNOTAVAIL') {
    return 'tcp'
  }
  return 'network'
}

/**
 * 外链元信息服务：fetch 由有效悬停触发（服务自身不预抓——打开文档、
 * 扫描链接、滚动零调用零请求）；同 URL（归一后）合并请求，最后消费者
 * 取消时中止底层连接；开关关闭经 cancelAll 中止全部在途并清空缓存。
 */
export class WebLinkMetaService {
  private readonly limits: WebLinkLimits
  private readonly checkUrl: (href: string) => WebLinkUrlCheck
  private readonly isAddressAllowed: (address: string) => boolean
  private readonly now: () => number
  private readonly getProxy: (targetProtocol: string) => ProxyDecision
  /** 非法代理配置的 warn 去抖（同会话同值只刷一次） */
  private readonly warnedInvalidProxy = new Set<string>()
  private readonly cache = new Map<string, CacheEntry>()
  private readonly inflight = new Map<string, InFlightEntry>()
  private coverGeneration = 0
  private cacheBytes = 0
  private active = 0
  private readonly queue: Array<() => void> = []

  constructor(options: WebLinkMetaServiceOptions = {}) {
    this.limits = { ...WEB_LINK_LIMITS, ...options.limits }
    this.checkUrl = options.checkUrl ?? checkWebLinkUrl
    this.isAddressAllowed = options.isAddressAllowed ?? isAllowedInetAddress
    this.now = options.now ?? Date.now
    this.getProxy = options.getProxy ?? (() => ({ mode: 'direct' }))
  }

  /**
   * 抓取外链元信息（消费者视角）：signal 中止即以 AbortError 拒绝——
   * 同 URL 的其他消费者不受影响，最后一人离开才中止底层连接。取消后
   * 同 URL 的新 fetch 重新发起（在途条目已清除）。shape 参与缓存键区分
   * （card 卡片 / #343 page 原网页——page 形态额外捕获最终响应的嵌入
   * 拒绝头组装 meta.frame，见 assessWebFrameEmbeddability）。
   */
  fetch(url: string, signal?: AbortSignal, shape: 'card' | 'page' = 'card', includeCover = false): Promise<WebLinkMetaOutcome> {
    const check = this.checkUrl(url)
    if (!check.ok) {
      return Promise.resolve({ ok: false, reason: check.reason })
    }
    const variant = includeCover ? `${shape}+cover` : shape
    const cacheKey = `${variant}\n${check.url}`
    const cached = this.cacheGet(cacheKey)
    if (cached !== null) {
      return Promise.resolve({ ok: true, meta: cached })
    }
    // 撤销配图后，旧任务继续服务原消费者，但不与重新开启的请求合并。
    const key = includeCover ? `${this.coverGeneration}\n${cacheKey}` : cacheKey
    let entry = this.inflight.get(key)
    if (entry === undefined) {
      const controller = new AbortController()
      const pending: InFlightEntry = {
        consumers: 0, controller, includeCover,
        task: Promise.resolve({ ok: false, reason: 'web-unreachable' }),
      }
      // 任务收敛（成功写缓存之后）即移除在途条目——迟到的同 URL 请求走
      // 缓存命中而非合并到已完成的任务
      pending.task = this.runFetch(check.url, pending, shape, variant).finally(() => {
        // 取消后同键可立即有新请求；旧任务收尾不能撤掉新任务的取消登记。
        if (this.inflight.get(key) === pending) this.inflight.delete(key)
      })
      this.inflight.set(key, pending)
      entry = pending
    }
    entry.consumers++
    const consumer = entry
    return new Promise<WebLinkMetaOutcome>((resolve, reject) => {
      const onAbort = (): void => {
        cleanup()
        consumer.consumers--
        if (consumer.consumers <= 0) {
          consumer.controller.abort()
          if (this.inflight.get(key) === consumer) this.inflight.delete(key)
        }
        reject(new DOMException('This operation was aborted', 'AbortError'))
      }
      const cleanup = (): void => {
        signal?.removeEventListener('abort', onAbort)
      }
      if (signal !== undefined) {
        if (signal.aborted) {
          onAbort()
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }
      void consumer.task.then((outcome) => {
        cleanup()
        resolve(outcome)
      })
    })
  }

  /** 开关关闭语义：中止全部在途请求并清空缓存（迟到结果无从产生） */
  cancelAll(): void {
    for (const [, entry] of this.inflight) {
      entry.controller.abort()
    }
    this.inflight.clear()
    this.clearCache()
  }

  /** 停止在途配图，不中断仍在读取的页面 HTML。 */
  cancelCovers(): void {
    this.coverGeneration++
    for (const entry of this.inflight.values()) {
      if (entry.includeCover) {
        entry.includeCover = false
        entry.coverController?.abort()
      }
    }
  }

  /** 显式清空缓存（保留在途） */
  clearCache(): void {
    this.cache.clear()
    this.cacheBytes = 0
  }

  /** 观测（性能测量/诊断） */
  stats(): { cacheEntries: number; cacheBytes: number; activeFetches: number; queued: number } {
    return {
      cacheEntries: this.cache.size,
      cacheBytes: this.cacheBytes,
      activeFetches: this.active,
      queued: this.queue.length,
    }
  }

  // ---- 底层任务（永不 reject：取消/超时/失败一律收敛为 outcome） ----

  private async runFetch(startUrl: string, entry: InFlightEntry, shape: 'card' | 'page', variant: string): Promise<WebLinkMetaOutcome> {
    const release = await this.acquireSlot()
    const signal = entry.controller.signal
    let cause: 'timeout' | 'consumer' | null = null
    signal.addEventListener('abort', () => {
      if (cause === null) {
        cause = 'consumer'
      }
    }, { once: true })
    const onTimeout = (): void => {
      cause = 'timeout'
      entry.controller.abort()
    }
    const timer = setTimeout(onTimeout, this.limits.timeoutMs)
    try {
      const page = await this.requestFollowingRedirects(startUrl, signal, () => cause, shape)
      if (page.kind === 'outcome') return page.outcome

      const finalUrl = new URL(page.url)
      const { title, description, coverUrl, iconUrl } = parseWebMetaFromHtml(page.bytes.toString('utf8'))
      const meta: WebLinkMeta = {
        url: stripDefaultPort(finalUrl),
        domain: finalUrl.hostname.toLowerCase(),
        title,
        description,
        ...(page.frame !== undefined ? { frame: page.frame } : {}),
      }
      // 已知可内嵌时尽快交给 iframe，既不预取卡片图片，也不拖慢网页显示。
      if (page.frame?.embeddable !== true) {
        if (iconUrl !== undefined) {
          const iconSrc = await this.fetchPreviewImage(iconUrl, finalUrl, 'icon', entry, () => cause)
          if (iconSrc !== undefined) meta.iconSrc = iconSrc
        }
        if (entry.includeCover && coverUrl !== undefined) {
          const coverSrc = await this.fetchPreviewImage(coverUrl, finalUrl, 'cover', entry, () => cause)
          if (coverSrc !== undefined && entry.includeCover) meta.coverSrc = coverSrc
        }
      }
      if (!signal.aborted && (variant === shape || entry.includeCover)) {
        this.cacheMeta(`${variant}\n${meta.url}`, meta)
      }
      return { ok: true, meta }
    } finally {
      clearTimeout(timer)
      release()
    }
  }

  /** 单个可选图片失败不影响文字。局部超时或关闭封面不会中止另一张图片。 */
  private async fetchPreviewImage(
    href: string,
    base: URL,
    kind: WebImageKind,
    entry: InFlightEntry,
    causeOf: () => 'timeout' | 'consumer' | null,
  ): Promise<string | undefined> {
    const parentSignal = entry.controller.signal
    if (parentSignal.aborted) return undefined
    let url: URL
    try {
      url = new URL(href, base)
    } catch {
      return undefined // 页面声明的地址无效，保留可用的卡片内容。
    }
    const controller = new AbortController()
    if (kind === 'cover') entry.coverController = controller
    const abort = () => controller.abort()
    parentSignal.addEventListener('abort', abort, { once: true })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      abort()
    }, WEB_PREVIEW_IMAGES[kind].timeoutMs)
    try {
      const image = await this.requestFollowingRedirects(url.href, controller.signal,
        () => causeOf() ?? (timedOut ? 'timeout' : controller.signal.aborted ? 'consumer' : null), kind)
      if (image.kind === 'body' && image.bytes.length > 0 && !controller.signal.aborted) {
        return `data:${image.mime};base64,${image.bytes.toString('base64')}`
      }
    } finally {
      clearTimeout(timer)
      parentSignal.removeEventListener('abort', abort)
    }
  }

  private async requestFollowingRedirects(
    startUrl: string,
    signal: AbortSignal,
    causeOf: () => 'timeout' | 'consumer' | null,
    mode: WebLinkRequestMode,
  ): Promise<WebLinkResponse> {
    let current = startUrl
    for (let redirects = 0; redirects <= this.limits.maxRedirects; redirects++) {
      const check = this.checkUrl(current)
      if (!check.ok) return { kind: 'outcome', outcome: { ok: false, reason: check.reason } }
      const step = await this.requestOnce(check.url, signal, causeOf, mode)
      if (step.kind !== 'redirect') return step
      current = step.location
    }
    return { kind: 'outcome', outcome: { ok: false, reason: 'web-redirects' } }
  }

  /** 并发槽：超出上限排队等待（FIFO；等待不占超时预算） */
  private async acquireSlot(): Promise<() => void> {
    if (this.active >= this.limits.concurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve))
    }
    this.active++
    let released = false
    return () => {
      if (released) {
        return
      }
      released = true
      this.active--
      const next = this.queue.shift()
      if (next !== undefined) {
        next()
      }
    }
  }

  /** 单次请求（含响应头边界与响应体读取）：redirect / fail / meta 三态。
   *  #346：按代理决策三路分派——https 目标走 CONNECT 隧道、http 目标走
   *  绝对形态转发、无代理维持直连（lookup 层校验仅直连路径装配）。
   *  #343：page 形态在 2xx 最终响应上捕获嵌入拒绝头（X-Frame-Options /
   *  Content-Security-Policy——report-only 不参与强制判定故不读取）与最终
   *  协议，预检结果随 meta 下发 */
  private requestOnce(
    url: string,
    signal: AbortSignal,
    causeOf: () => 'timeout' | 'consumer' | null,
    mode: WebLinkRequestMode,
  ): Promise<WebLinkRequestStep> {
    const parsed = new URL(url)
    const decision = this.resolveProxyDecision(parsed.protocol)
    if (decision.mode === 'proxy' && parsed.protocol === 'https:') {
      return this.requestViaTunnel(parsed, decision.target, signal, causeOf, mode)
    }
    if (decision.mode === 'proxy') {
      return this.requestViaProxyHttp(parsed, decision.target, signal, causeOf, mode)
    }
    return this.requestDirect(url, parsed, signal, causeOf, mode)
  }

  /** #346：每跳请求前解析代理决策（接线侧每调用读一次 VSCode 配置——配置
   *  变更无需重启生效）；非法代理值归一为直连并按原始值去抖告警一次
   *  （告警文案脱敏 userinfo——原始值常含 https/socks 形态代理的用户名
   *  密码，明文进日志属凭据泄漏；去抖键仍用原始值保持会话内一次） */
  private resolveProxyDecision(protocol: string): ProxyDecision {
    const decision = this.getProxy(protocol)
    if (decision.mode === 'invalid') {
      if (!this.warnedInvalidProxy.has(decision.source)) {
        this.warnedInvalidProxy.add(decision.source)
        console.warn(`[vsidian] 外链抓取代理配置无法应用，已回退直连：${redactProxyCredentials(decision.source)}`)
      }
      return { mode: 'direct' }
    }
    return decision
  }

  /** 直连路径（现行为原样：URL 对象直入 mod.request，lookup 层地址准入装配） */
  private requestDirect(
    url: string,
    parsed: URL,
    signal: AbortSignal,
    causeOf: () => 'timeout' | 'consumer' | null,
    mode: WebLinkRequestMode,
  ): Promise<WebLinkRequestStep> {
    const mod = parsed.protocol === 'https:' ? https : http
    return this.openRequest(url, parsed, (onResponse, onError) => {
      const req = mod.request(parsed, {
        method: 'GET',
        headers: {
          'user-agent': WEB_LINK_USER_AGENT,
          accept: WEB_REQUEST_ACCEPT[mode],
        },
        lookup: this.lookupAdapter.bind(this) as unknown as never,
        signal,
      }, onResponse)
      req.on('error', onError)
      return req
    }, causeOf, mode)
  }

  /** #346：https 目标走 CONNECT 隧道——先建隧道（超时预算与取消经同一
   *  signal 贯穿，AbortSignal 同时覆盖 CONNECT 与 TLS 握手阶段），再以
   *  createConnection 注入隧道 socket 发 https 请求（Node 惯例：https
   *  请求的连接即 TLS socket，https.Agent 的 createConnection 同构） */
  private async requestViaTunnel(
    parsed: URL,
    target: ProxyTarget,
    signal: AbortSignal,
    causeOf: () => 'timeout' | 'consumer' | null,
    mode: WebLinkRequestMode,
  ): Promise<WebLinkRequestStep> {
    const url = parsed.toString()
    const host = parsed.hostname // 含 IPv6 方括号（CONNECT authority 形态）
    const port = parsed.port === '' ? 443 : Number(parsed.port)
    let socket: TLSSocket
    try {
      socket = await connectThroughProxy(target, host, port, {
        servername: host.replace(/^\[|\]$/g, ''),
        rejectUnauthorized: target.rejectUnauthorized,
      }, signal)
    } catch (err) {
      return this.requestErrorOutcome(url, err as NodeJS.ErrnoException, causeOf, mode)
    }
    return this.openRequest(url, parsed, (onResponse, onError) => {
      const req = https.request({
        protocol: 'https:',
        host: host.replace(/^\[|\]$/g, ''),
        port,
        path: `${parsed.pathname}${parsed.search}`,
        method: 'GET',
        headers: {
          'user-agent': WEB_LINK_USER_AGENT,
          accept: WEB_REQUEST_ACCEPT[mode],
        },
        createConnection: () => socket,
        signal,
      }, onResponse)
      req.on('error', onError)
      return req
    }, causeOf, mode)
  }

  /** #346：http 目标经代理绝对形态转发（URL 准入同收 http，绝对形态是
   *  正向代理对明文目标的标准路径）：请求行带完整 URL、Host 头为目标
   *  权威；本路径无本地 lookup——目标域名解析在代理侧 */
  private requestViaProxyHttp(
    parsed: URL,
    target: ProxyTarget,
    signal: AbortSignal,
    causeOf: () => 'timeout' | 'consumer' | null,
    mode: WebLinkRequestMode,
  ): Promise<WebLinkRequestStep> {
    const url = parsed.toString()
    return this.openRequest(url, parsed, (onResponse, onError) => {
      const req = http.request({
        host: target.url.hostname.replace(/^\[|\]$/g, ''),
        port: proxyPortOf(target),
        path: url,
        method: 'GET',
        headers: {
          'user-agent': WEB_LINK_USER_AGENT,
          accept: WEB_REQUEST_ACCEPT[mode],
          host: parsed.host,
          ...(target.authorization !== undefined ? { 'proxy-authorization': target.authorization } : {}),
        },
        signal,
      }, onResponse)
      req.on('error', onError)
      return req
    }, causeOf, mode)
  }

  /** 统一请求骨架：build 产生 ClientRequest（三路分派各自的连接形态），
   *  响应与错误收敛同源（handleResponse / requestErrorOutcome） */
  private openRequest(
    url: string,
    parsed: URL,
    build: (
      onResponse: (res: http.IncomingMessage) => void,
      onError: (err: NodeJS.ErrnoException) => void,
    ) => http.ClientRequest,
    causeOf: () => 'timeout' | 'consumer' | null,
    mode: WebLinkRequestMode,
  ): Promise<WebLinkRequestStep> {
    return new Promise((resolve) => {
      const req = build(
        (res) => this.handleResponse(url, parsed, req, res, resolve, causeOf, mode),
        (err) => resolve(this.requestErrorOutcome(url, err, causeOf, mode)),
      )
      req.end()
    })
  }

  /** 响应头边界与分态收敛（三路共用）：redirect / 边界拒绝 / 读取移交 */
  private handleResponse(
    url: string,
    parsed: URL,
    req: http.ClientRequest,
    res: http.IncomingMessage,
    resolve: (step: WebLinkRequestStep) => void,
    causeOf: () => 'timeout' | 'consumer' | null,
    mode: WebLinkRequestMode,
  ): void {
    const status = res.statusCode ?? 0
    const logTarget = webImageLogScope(url, mode) ?? url
    if (status === 301 || status === 302 || status === 303 || status === 307 || status === 308) {
      const location = res.headers.location
      res.resume() // 丢弃重定向响应体
      if (typeof location !== 'string' || location === '') {
        resolve({ kind: 'outcome', outcome: { ok: false, reason: 'web-redirects' } })
        return
      }
      // 畸形 Location（如 `http://[`）按重定向失败分态收敛——new URL
      // 在响应回调内同步抛 TypeError 会逸出为进程级异常（review 修复），
      // 该次抓取悬置至总预算超时误报 web-timeout
      let redirectTarget: URL
      try {
        redirectTarget = new URL(location, url)
      } catch {
        resolve({ kind: 'outcome', outcome: { ok: false, reason: 'web-redirects' } })
        return
      }
      resolve({ kind: 'redirect', location: redirectTarget.toString() })
      return
    }
    if (status < 200 || status >= 300) {
      res.resume()
      req.destroy()
      console.warn(`[vsidian] 外链抓取失败（状态码非 2xx）：${logTarget}：HTTP ${status}`)
      resolve({ kind: 'outcome', outcome: { ok: false, reason: 'web-unreachable' } })
      return
    }
    const contentType = res.headers['content-type'] ?? ''
    const mime = contentType.split(';', 1)[0].trim().toLowerCase()
    const image = mode === 'icon' || mode === 'cover' ? WEB_PREVIEW_IMAGES[mode] : undefined
    if (image ? !image.mimeTypes.includes(mime) : !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      res.resume()
      req.destroy()
      resolve({ kind: 'outcome', outcome: { ok: false, reason: 'web-not-html' } })
      return
    }
    const maxBytes = image?.maxBytes ?? this.limits.maxBytes
    const declared = Number(res.headers['content-length'])
    if (Number.isFinite(declared) && declared > maxBytes) {
      res.resume()
      req.destroy()
      resolve({ kind: 'outcome', outcome: { ok: false, reason: 'web-too-large' } })
      return
    }
    const frame = mode === 'page'
      ? assessWebFrameEmbeddability({
        protocol: parsed.protocol,
        xFrameOptions: res.headers['x-frame-options'],
        contentSecurityPolicy: res.headers['content-security-policy'],
      })
      : undefined
    this.readBody(url, req, res, resolve, mime, maxBytes, frame, causeOf, logTarget)
  }

  /** 请求/隧道错误收敛（三路共用）：outcome 分态保持既有语义，另发细分
   *  cause 诊断日志（DNS/TCP/隧道/TLS/网络——扩展宿主日志可辨真实原因，
   *  用户 TUN 场景重测依据）；消费者取消不发日志（非失败） */
  private requestErrorOutcome(
    url: string,
    err: NodeJS.ErrnoException,
    causeOf: () => 'timeout' | 'consumer' | null,
    mode: WebLinkRequestMode,
  ): WebLinkRequestStep {
    if (err.code === BLOCK_ADDR_CODE) {
      return { kind: 'outcome', outcome: { ok: false, reason: 'web-invalid-address' } }
    }
    const imageLogScope = webImageLogScope(url, mode)
    if (causeOf() === 'timeout') {
      console.warn(`[vsidian] 外链抓取失败（超时）：${imageLogScope ?? url}`)
      return { kind: 'outcome', outcome: { ok: false, reason: 'web-timeout' } }
    }
    if (isAbortError(err)) {
      // 消费者取消：所有消费者已各自 reject，此处 outcome 仅为收敛占位
      return { kind: 'outcome', outcome: { ok: false, reason: 'web-unreachable' } }
    }
    const kind = classifyWebFetchError(err)
    const detail = imageLogScope === undefined
      ? (err.code === PROXY_TUNNEL_ERROR_CODE ? err.message : err.code ?? err.message)
      : (err.code ?? kind)
    console.warn(`[vsidian] 外链抓取失败（${kind === 'dns' ? 'DNS 解析失败' : kind === 'tcp' ? 'TCP 连接失败' : kind === 'tunnel' ? '代理隧道失败' : kind === 'tls' ? 'TLS 失败' : '网络失败'}）：${imageLogScope ?? url}：${detail}`)
    return { kind: 'outcome', outcome: { ok: false, reason: 'web-unreachable' } }
  }

  /** HTML 与配图共用有界读体；仅在完整读到响应后交给各自的消费者。 */
  private readBody(
    url: string,
    req: http.ClientRequest,
    res: Readable & { statusCode?: number },
    resolve: (value: WebLinkRequestStep) => void,
    mime: string,
    maxBytes: number,
    frame: WebFramePrecheck | undefined,
    causeOf: () => 'timeout' | 'consumer' | null,
    logTarget: string,
  ): void {
    const chunks: Buffer[] = []
    let total = 0
    let settled = false
    const finish = (response: WebLinkResponse): void => {
      if (settled) {
        return
      }
      settled = true
      resolve(response)
    }
    res.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > maxBytes) {
        req.destroy()
        finish({ kind: 'outcome', outcome: { ok: false, reason: 'web-too-large' } })
        return
      }
      chunks.push(chunk)
    })
    res.on('end', () => {
      finish({ kind: 'body', url, mime, bytes: Buffer.concat(chunks, total), frame })
    })
    res.on('error', () => {
      finish({ kind: 'outcome', outcome: { ok: false, reason: 'web-unreachable' } })
    })
    res.on('aborted', () => {
      // 分态收敛（review 修复）：aborted 不再一律误标 web-too-large——
      // 与 req error 的 causeOf 分态对齐，超时按 web-timeout、消费者取消
      // 按 web-unreachable；仅自身截断场景（流式超限 destroy，此处通常已
      // 由 data 处理器先行结算）保留 web-too-large
      const cause = causeOf()
      if (cause === null) {
        console.warn(`[vsidian] 外链抓取失败（截断）：${logTarget}`)
      }
      finish({
        kind: 'outcome',
        outcome: { ok: false, reason: cause === 'timeout' ? 'web-timeout' : cause === 'consumer' ? 'web-unreachable' : 'web-too-large' },
      })
    })
  }

  // ---- lookup 层地址准入（DNS 解析后、连接前；重定向每跳同过此层） ----
  // #346 边界：本层仅直连路径装配（requestDirect）——代理模式下目标域名
  // 在代理侧解析，本地 lookup 不发生（防 DNS 换址校验不可达，属已落档的
  // 代理模式 SSRF 降级；对照测试：直连 localhost 被 web-invalid-address
  // 拒绝、代理模式同 URL 经隧道成功）

  private readonly lookupAdapter = (
    hostname: string,
    options: dns.LookupOptions,
    callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
  ): void => {
    dns.lookup(hostname, { ...options, all: false }, (err, address, family) => {
      if (err !== null) {
        callback(err, '', 0)
        return
      }
      if (!this.isAddressAllowed(address)) {
        const blocked = new Error(`web link target address rejected: ${address}`) as NodeJS.ErrnoException
        blocked.code = BLOCK_ADDR_CODE
        callback(blocked, '', 0)
        return
      }
      callback(null, address, family)
    })
  }

  // ---- 内存缓存（键 = 形态 + 归一 URL；LRU + TTL + 双上限） ----

  private cacheMeta(key: string, meta: WebLinkMeta): void {
    const bytes = entryBytesOf(meta)
    if (bytes > this.limits.cacheMaxBytes) {
      return // 单条超限不入缓存（仍可当场返回）
    }
    const existing = this.cache.get(key)
    if (existing !== undefined) {
      this.cache.delete(key)
      this.cacheBytes -= existing.bytes
    }
    while (this.cache.size >= this.limits.cacheMaxEntries || this.cacheBytes + bytes > this.limits.cacheMaxBytes) {
      const oldest = this.cache.keys().next().value
      if (oldest === undefined) {
        break
      }
      this.cacheBytes -= this.cache.get(oldest)?.bytes ?? 0
      this.cache.delete(oldest)
    }
    this.cache.set(key, { meta, at: this.now(), bytes })
    this.cacheBytes += bytes
  }

  private cacheGet(key: string): WebLinkMeta | null {
    const entry = this.cache.get(key)
    if (entry === undefined) {
      return null
    }
    if (this.now() - entry.at > this.limits.cacheTtlMs) {
      this.cache.delete(key)
      this.cacheBytes -= entry.bytes
      return null
    }
    // LRU touch（Map 插入序 = 淘汰序）
    this.cache.delete(key)
    this.cache.set(key, entry)
    return entry.meta
  }
}

function entryBytesOf(meta: WebLinkMeta): number {
  return 2 * (meta.url.length + meta.domain.length + meta.title.length + meta.description.length +
    (meta.coverSrc?.length ?? 0) + (meta.iconSrc?.length ?? 0)) + 128
}

function stripDefaultPort(url: URL): string {
  const clone = new URL(url.toString())
  clone.hash = ''
  if ((clone.protocol === 'http:' && clone.port === '80') || (clone.protocol === 'https:' && clone.port === '443')) {
    clone.port = ''
  }
  return clone.toString()
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || (err as NodeJS.ErrnoException).code === 'ABORT_ERR')
}
