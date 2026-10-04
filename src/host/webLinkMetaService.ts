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
// HTML、不加载第三方缩略图、不触发任何子资源请求。
//
// 缓存：仅内存（键 = 形态 + 归一 URL），条目/字节双上限 + TTL + LRU
// 淘汰，失败不缓存（保留重试语义）；不持久化任何浏览历史。
import * as dns from 'node:dns'
import * as http from 'node:http'
import * as https from 'node:https'
import type { Readable } from 'node:stream'
import {
  assessWebFrameEmbeddability,
  checkWebLinkUrl,
  isAllowedInetAddress,
  type WebFramePrecheck,
  type WebLinkFailReason,
  type WebLinkUrlCheck,
} from '../shared/webLink'
import { parseWebMetaFromHtml } from './webMetaExtract'

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

/** 提取结果（宿主内聚形态；出站载荷在 hoverDocAccess 装配层转换） */
export interface WebLinkMeta {
  /** 最终 URL（重定向后归一；显示与身份） */
  url: string
  /** 最终主机名（展示域名） */
  domain: string
  title: string
  description: string
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
}

const BLOCK_ADDR_CODE = 'VSIDIAN_WEB_BLOCKED_ADDR'

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
  private readonly cache = new Map<string, CacheEntry>()
  private readonly inflight = new Map<string, InFlightEntry>()
  private cacheBytes = 0
  private active = 0
  private readonly queue: Array<() => void> = []

  constructor(options: WebLinkMetaServiceOptions = {}) {
    this.limits = { ...WEB_LINK_LIMITS, ...options.limits }
    this.checkUrl = options.checkUrl ?? checkWebLinkUrl
    this.isAddressAllowed = options.isAddressAllowed ?? isAllowedInetAddress
    this.now = options.now ?? Date.now
  }

  /**
   * 抓取外链元信息（消费者视角）：signal 中止即以 AbortError 拒绝——
   * 同 URL 的其他消费者不受影响，最后一人离开才中止底层连接。取消后
   * 同 URL 的新 fetch 重新发起（在途条目已清除）。shape 参与缓存键区分
   * （card 卡片 / #343 page 原网页——page 形态额外捕获最终响应的嵌入
   * 拒绝头组装 meta.frame，见 assessWebFrameEmbeddability）。
   */
  fetch(url: string, signal?: AbortSignal, shape: 'card' | 'page' = 'card'): Promise<WebLinkMetaOutcome> {
    const check = this.checkUrl(url)
    if (!check.ok) {
      return Promise.resolve({ ok: false, reason: check.reason })
    }
    const key = `${shape}\n${check.url}`
    const cached = this.cacheGet(key)
    if (cached !== null) {
      return Promise.resolve({ ok: true, meta: cached })
    }
    let entry = this.inflight.get(key)
    if (entry === undefined) {
      const controller = new AbortController()
      const pending: InFlightEntry = { consumers: 0, controller, task: Promise.resolve({ ok: false, reason: 'web-unreachable' }) }
      // 任务收敛（成功写缓存之后）即移除在途条目——迟到的同 URL 请求走
      // 缓存命中而非合并到已完成的任务
      pending.task = this.runFetch(check.url, pending, shape).finally(() => {
        this.inflight.delete(key)
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
          this.inflight.delete(key)
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

  private async runFetch(startUrl: string, entry: InFlightEntry, shape: 'card' | 'page'): Promise<WebLinkMetaOutcome> {
    const release = await this.acquireSlot()
    let cause: 'timeout' | 'consumer' | null = null
    entry.controller.signal.addEventListener('abort', () => {
      if (cause === null) {
        cause = 'consumer'
      }
    }, { once: true })
    const timer = setTimeout(() => {
      cause = 'timeout'
      entry.controller.abort()
    }, this.limits.timeoutMs)
    try {
      let current = startUrl
      let redirects = 0
      for (;;) {
        const check = this.checkUrl(current)
        if (!check.ok) {
          return { ok: false, reason: check.reason }
        }
        const step = await this.requestOnce(check.url, entry.controller.signal, () => cause, shape)
        if (step.kind === 'redirect') {
          redirects++
          if (redirects > this.limits.maxRedirects) {
            return { ok: false, reason: 'web-redirects' }
          }
          current = step.location
          continue
        }
        return step.outcome
      }
    } finally {
      clearTimeout(timer)
      release()
    }
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
   *  #343：page 形态在 2xx 最终响应上捕获嵌入拒绝头（X-Frame-Options /
   *  Content-Security-Policy——report-only 不参与强制判定故不读取）与最终
   *  协议，预检结果随 meta 下发 */
  private requestOnce(
    url: string,
    signal: AbortSignal,
    causeOf: () => 'timeout' | 'consumer' | null,
    shape: 'card' | 'page',
  ): Promise<
    | { kind: 'redirect'; location: string }
    | { kind: 'outcome'; outcome: WebLinkMetaOutcome }
  > {
    return new Promise((resolve) => {
      const parsed = new URL(url)
      const mod = parsed.protocol === 'https:' ? https : http
      const req = mod.request(parsed, {
        method: 'GET',
        headers: {
          'user-agent': WEB_LINK_USER_AGENT,
          accept: 'text/html,application/xhtml+xml',
        },
        lookup: this.lookupAdapter.bind(this) as unknown as never,
        signal,
      }, (res) => {
        const status = res.statusCode ?? 0
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
          resolve({ kind: 'outcome', outcome: { ok: false, reason: 'web-unreachable' } })
          return
        }
        const contentType = res.headers['content-type'] ?? ''
        if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
          res.resume()
          req.destroy()
          resolve({ kind: 'outcome', outcome: { ok: false, reason: 'web-not-html' } })
          return
        }
        const declared = Number(res.headers['content-length'])
        if (Number.isFinite(declared) && declared > this.limits.maxBytes) {
          res.resume()
          req.destroy()
          resolve({ kind: 'outcome', outcome: { ok: false, reason: 'web-too-large' } })
          return
        }
        const frame = shape === 'page'
          ? assessWebFrameEmbeddability({
            protocol: parsed.protocol,
            xFrameOptions: res.headers['x-frame-options'],
            contentSecurityPolicy: res.headers['content-security-policy'],
          })
          : undefined
        this.readBody(url, req, res, resolve, frame, causeOf)
      })
      req.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === BLOCK_ADDR_CODE) {
          resolve({ kind: 'outcome', outcome: { ok: false, reason: 'web-invalid-address' } })
          return
        }
        if (causeOf() === 'timeout') {
          resolve({ kind: 'outcome', outcome: { ok: false, reason: 'web-timeout' } })
          return
        }
        if (isAbortError(err)) {
          // 消费者取消：所有消费者已各自 reject，此处 outcome 仅为收敛占位
          resolve({ kind: 'outcome', outcome: { ok: false, reason: 'web-unreachable' } })
          return
        }
        resolve({ kind: 'outcome', outcome: { ok: false, reason: 'web-unreachable' } })
      })
      req.end()
    })
  }

  /** 流式读取响应体：累计超限即中断（web-too-large）；完成即解析元信息
   *  （#343：page 形态的 frame 预检随最终响应组装进 meta 与缓存） */
  private readBody(
    url: string,
    req: http.ClientRequest,
    res: Readable & { statusCode?: number },
    resolve: (value: { kind: 'redirect'; location: string } | { kind: 'outcome'; outcome: WebLinkMetaOutcome }) => void,
    frame: WebFramePrecheck | undefined,
    causeOf: () => 'timeout' | 'consumer' | null,
  ): void {
    const chunks: Buffer[] = []
    let total = 0
    let settled = false
    const finish = (outcome: WebLinkMetaOutcome): void => {
      if (settled) {
        return
      }
      settled = true
      resolve({ kind: 'outcome', outcome })
    }
    res.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > this.limits.maxBytes) {
        req.destroy()
        finish({ ok: false, reason: 'web-too-large' })
        return
      }
      chunks.push(chunk)
    })
    res.on('end', () => {
      const html = Buffer.concat(chunks).toString('utf8')
      const { title, description } = parseWebMetaFromHtml(html)
      const finalUrl = new URL(url)
      finish({
        ok: true,
        meta: {
          url: stripDefaultPort(finalUrl),
          domain: finalUrl.hostname.toLowerCase(),
          title,
          description,
          ...(frame !== undefined ? { frame } : {}),
        },
      })
      this.cacheMeta(url, title, description, frame)
    })
    res.on('error', () => {
      finish({ ok: false, reason: 'web-unreachable' })
    })
    res.on('aborted', () => {
      // 分态收敛（review 修复）：aborted 不再一律误标 web-too-large——
      // 与 req error 的 causeOf 分态对齐，超时按 web-timeout、消费者取消
      // 按 web-unreachable；仅自身截断场景（流式超限 destroy，此处通常已
      // 由 data 处理器先行结算）保留 web-too-large
      const cause = causeOf()
      finish(cause === 'timeout'
        ? { ok: false, reason: 'web-timeout' }
        : cause === 'consumer'
          ? { ok: false, reason: 'web-unreachable' }
          : { ok: false, reason: 'web-too-large' })
    })
  }

  // ---- lookup 层地址准入（DNS 解析后、连接前；重定向每跳同过此层） ----

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

  private cacheMeta(url: string, title: string, description: string, frame?: WebFramePrecheck): void {
    const check = this.checkUrl(url)
    if (!check.ok) {
      return
    }
    const finalUrl = new URL(check.url)
    const meta: WebLinkMeta = {
      url: stripDefaultPort(finalUrl),
      domain: finalUrl.hostname.toLowerCase(),
      title,
      description,
      ...(frame !== undefined ? { frame } : {}),
    }
    const bytes = entryBytesOf(meta)
    if (bytes > this.limits.cacheMaxBytes) {
      return // 单条超限不入缓存（仍可当场返回）
    }
    const key = `${frame !== undefined ? 'page' : 'card'}\n${meta.url}`
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
  return 2 * (meta.url.length + meta.domain.length + meta.title.length + meta.description.length) + 128
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
