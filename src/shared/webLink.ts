// #342（P3-10）外链 URL 静态准入与归一（两端共享纯逻辑）：webview 侧
// 预滤（isHttpLinkHref——总开关开启时放行 http(s) 锚点）与宿主侧准入
// （checkWebLinkUrl——scheme/凭据/字面私网地址拒绝 + 缓存键归一）使用
// 同一判别，不各自发明第二套口径。
//
// 边界口径（三期正式规格「外链形态、网络与退回」第 3 条）：
// - 只接 http(s)：ftp/mailto/javascript/file 等一律不开卡片（webview
//   预滤拒绝 + 宿主复核双保险）；
// - 拒绝凭据 URL（userinfo——登录态转移明确排除）；
// - 拒绝私网/回环/链路本地/保留字面地址（isAllowedInetAddress）——
//   URL 文本层先拦字面 IP，域名解析后的地址校验（防 DNS 预查与真正
//   连接脱节）在 webLinkMetaService 的 lookup 层执行，两层同源调用
//   本模块的 isAllowedInetAddress；
// - 本模块不依赖 vscode/DOM/Node 专有 API（node:net 仅类型级使用，
//   实现为自带 IP 解析，宿主与单测直驱）。
import type { HoverPreviewFailReason } from './protocol'

/** 外链悬停预览失败原因（#342 扩展 HoverPreviewFailReason 的 web 族；
 *  语义：真实网络失败如实呈现，不伪装成文件缺失） */
export type WebLinkFailReason = Extract<
  HoverPreviewFailReason,
  'web-disabled' | 'web-invalid-address' | 'web-timeout' | 'web-too-large' | 'web-not-html' | 'web-redirects' | 'web-unreachable'
>

/** webview 预滤同款判定：href 是否 http(s) 绝对地址（协议相对 `//host`
 *  不放行——归宿主分类拦截，与 isHoverableMdLinkHref 的外部 scheme 排除
 *  共存：后者拦一切外部形态，本判定在总开关开启的调用点补放行 http(s)） */
export function isHttpLinkHref(href: string): boolean {
  return /^https?:\/\//i.test(href)
}

/** 内网/保留地址判定（IPv4 段 + IPv6 段 + IPv4 映射 IPv6 展开）：
 *  宿主 URL 文本层（字面 IP 主机名）与 lookup 层（域名解析结果）共用
 *  同一矩阵——「重定向与实际连接地址同时校验」的同源判别。非 IP 文本
 *  （域名等）按非法处理：本函数只回答「这个 IP 地址能否连接」 */
export function isAllowedInetAddress(address: string): boolean {
  const compact = address.trim().toLowerCase()
  if (compact === '') {
    return false
  }
  if (isDottedQuad(compact)) {
    return isAllowedIpv4(compact)
  }
  // IPv6（含 ::ffff:x.x.x.x 映射形态——展开内嵌 IPv4 后按 v4 矩阵判）
  if (!/^[0-9a-f:.]+$/.test(compact)) {
    return false // 非法形态按拒绝处理（防御：lookup 不会给出，字面层兜底）
  }
  return isAllowedIpv6(compact)
}

/** 主机名是否 IP 字面形态（dotted quad 或 IPv6）：URL 文本层只对字面
 *  IP 直接判定，域名放行给 lookup 层（解析后再过同一 isAllowedInetAddress） */
export function isIpLiteralHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase()
  if (h.startsWith('[') && h.endsWith(']')) {
    return true
  }
  return isDottedQuad(h) || (/^[0-9a-f:.]+$/.test(h) && h.includes(':'))
}

function isDottedQuad(value: string): boolean {
  const parts = value.split('.')
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
}

/** IPv4 段（数字）判定：私有/回环/链路本地/CGNAT/未指定/组播/保留/文档段 */
function isAllowedIpv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number) as [number, number, number, number]
  if (a === 0 || a === 10 || a === 127) return false // 未指定/私网/回环
  if (a === 169 && b === 254) return false // 链路本地
  if (a === 172 && b >= 16 && b <= 31) return false // 私网 172.16/12
  if (a === 192 && b === 168) return false // 私网
  if (a === 100 && b >= 64 && b <= 127) return false // CGNAT 100.64/10
  if (a === 192 && (b === 0 || b === 2)) return false // 192.0.0/24 与 192.0.2/24
  if (a === 198 && (b === 18 || b === 19)) return false // 基准测试 198.18/15
  if (a === 198 && b === 51) return false // 198.51.100/24
  if (a === 203 && b === 0) return false // 203.0.113/24
  if (a >= 224) return false // 组播 224/4 + 保留 240/4 + 广播
  return true
}

/** IPv6 展开（BigInt 前缀比较）：回环/未指定/ULA/链路本地/组播拒绝，
 *  ::ffff:0:0/96 映射地址展开内嵌 IPv4 后按 v4 矩阵判 */
function isAllowedIpv6(ip: string): boolean {
  const expanded = expandIpv6(ip)
  if (expanded === null) {
    return false
  }
  const hi = expanded >> 64n
  const lo = expanded & 0xffffffffffffffffn
  const top16 = hi >> 48n
  if (expanded === 0n) return false // ::
  if (expanded === 1n) return false // ::1
  if (hi === 0n && (lo >> 32n) === 0xffffn) {
    // ::ffff:a.b.c.d 映射：内嵌 IPv4 走 v4 矩阵（映射本身不是合法连接目标）
    return isAllowedIpv4(v4OfLow(lo))
  }
  if (top16 >= 0xfc00n && top16 <= 0xfdffn) return false // fc00::/7（ULA）
  if (top16 >= 0xfe80n && top16 <= 0xfebfn) return false // fe80::/10 链路本地
  if (top16 >= 0xff00n) return false // ff00::/8 组播
  return true
}

/** IPv6 文本展开为 128-bit BigInt；非法形态返回 null */
function expandIpv6(ip: string): bigint | null {
  let text = ip
  // 剥方括号（URL hostname 场景调用方已剥，防御性再剥）
  if (text.startsWith('[') && text.endsWith(']')) {
    text = text.slice(1, -1)
  }
  // IPv4 结尾形态（::ffff:1.2.3.4）：先展开尾部 v4 为两段 hex
  const lastColon = text.lastIndexOf(':')
  if (lastColon >= 0 && text.includes('.')) {
    const v4part = text.slice(lastColon + 1)
    if (!isDottedQuad(v4part)) {
      return null
    }
    const [a, b, c, d] = v4part.split('.').map(Number) as [number, number, number, number]
    text = `${text.slice(0, lastColon + 1)}${(a * 256 + b).toString(16)}:${(c * 256 + d).toString(16)}`
  }
  const halves = text.split('::')
  if (halves.length > 2) {
    return null
  }
  const parseGroups = (s: string): number[] | null => {
    if (s === '') {
      return []
    }
    const groups = s.split(':')
    for (const g of groups) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) {
        return null
      }
    }
    return groups.map((g) => parseInt(g, 16))
  }
  const head = parseGroups(halves[0])
  const tail = halves.length === 2 ? parseGroups(halves[1]) : null
  if (head === null || (halves.length === 2 && tail === null)) {
    return null
  }
  let groups: number[]
  if (halves.length === 2) {
    const fill = 8 - head!.length - tail!.length
    if (fill < 0) {
      return null
    }
    groups = [...head!, ...new Array(fill).fill(0), ...tail!]
  } else {
    groups = head!
    if (groups.length !== 8) {
      return null // 无 :: 缩写必须恰好 8 组
    }
  }
  let value = 0n
  for (const g of groups) {
    value = (value << 16n) | BigInt(g)
  }
  return value
}

/** ::ffff:a.b.c.d 低 64 位还原 IPv4 文本 */
function v4OfLow(lo: bigint): string {
  const third = Number((lo >> 24n) & 0xffn)
  const fourth = Number(lo & 0xffffffn)
  return `${third >> 8}.${third & 0xff}.${fourth >> 16}.${fourth & 0xff}`
}

/** 宿主侧 URL 准入结果：ok 携带归一 URL（缓存键与连接地址同源）；拒绝
 *  统一 web-invalid-address（就地文案不区分细节，日志层不展开） */
export type WebLinkUrlCheck =
  | { ok: true; url: string; host: string }
  | { ok: false; reason: WebLinkFailReason }

/** 宿主侧外链 URL 准入：http(s) scheme + 无凭据 + 字面地址合法 + 归一
 *  （协议/主机小写、默认端口剥除、fragment 剥除——query 保留，不同 query
 *  不共享缓存）。域名（非字面 IP）的解析后校验在连接层 lookup 执行 */
export function checkWebLinkUrl(href: string): WebLinkUrlCheck {
  let parsed: URL
  try {
    parsed = new URL(href)
  } catch {
    return { ok: false, reason: 'web-invalid-address' }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, reason: 'web-invalid-address' }
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return { ok: false, reason: 'web-invalid-address' }
  }
  // URL 已剥 IPv6 方括号（hostname 为 ::1 形态）；字面 IP 在文本层直接判
  // （域名放行给连接层 lookup——解析后过同一 isAllowedInetAddress 矩阵）
  if (isIpLiteralHost(parsed.hostname) && !isAllowedInetAddress(parsed.hostname)) {
    return { ok: false, reason: 'web-invalid-address' }
  }
  return { ok: true, url: canonicalUrlOf(parsed), host: parsed.hostname }
}

/** 规范化缓存键：协议/主机小写、默认端口剥除、fragment 剥除、query 保留 */
export function canonicalWebLinkUrl(href: string): string {
  const parsed = new URL(href)
  return canonicalUrlOf(parsed)
}

function canonicalUrlOf(parsed: URL): string {
  const clone = new URL(parsed.toString())
  clone.hash = ''
  clone.protocol = clone.protocol.toLowerCase()
  clone.hostname = clone.hostname.toLowerCase()
  if ((clone.protocol === 'http:' && clone.port === '80') ||
    (clone.protocol === 'https:' && clone.port === '443')) {
    clone.port = ''
  }
  return clone.toString()
}
