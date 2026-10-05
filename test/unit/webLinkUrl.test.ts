// #342（P3-10）外链 URL 准入契约：悬停外链卡片的第一道静态边界——
// 只接 http(s)、拒绝凭据 URL、拒绝私网/回环/链路本地/保留字面地址、
// 规范化缓存键（大小写/默认端口/fragment）。DNS 换址防护（域名解析后
// 校验）在 webLinkMetaService 契约中另测；此处只钉纯 URL 文本层。
import { describe, expect, it } from 'vitest'
import {
  canonicalWebLinkUrl,
  checkWebLinkUrl,
  isAllowedInetAddress,
  isHttpLinkHref,
} from '../../src/shared/webLink'

describe('isHttpLinkHref（webview 预滤同款判定）', () => {
  it.each([
    ['https://example.com/page', true],
    ['http://example.com', true],
    ['HTTPS://EXAMPLE.COM/x', true],
    ['ftp://example.com/file', false],
    ['mailto:someone@example.com', false],
    ['javascript:alert(1)', false],
    ['file:///d:/notes/a.md', false],
    ['//example.com/protocol-relative', false],
    ['/relative/path', false],
    ['notes/page.md', false],
    ['#fragment', false],
    ['', false],
  ])('%s → %s', (href, expected) => {
    expect(isHttpLinkHref(href)).toBe(expected)
  })
})

describe('checkWebLinkUrl（宿主侧准入）', () => {
  it('公网域名放行并返回归一 URL', () => {
    const result = checkWebLinkUrl('https://Example.COM:443/path?q=1#frag')
    expect(result.ok).toBe(true)
    if (result.ok) {
      // 协议/主机小写、默认端口剥除、fragment 剥除、query 保留
      expect(result.url).toBe('https://example.com/path?q=1')
      expect(result.host).toBe('example.com')
    }
  })

  it('http 默认端口同样剥除', () => {
    const result = checkWebLinkUrl('http://example.com:80/a')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.url).toBe('http://example.com/a')
    }
  })

  it('非默认端口保留', () => {
    const result = checkWebLinkUrl('http://example.com:8080/a')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.url).toBe('http://example.com:8080/a')
    }
  })

  it.each([
    ['凭据 URL（userinfo）拒绝', 'https://user:pass@example.com/'],
    ['仅用户名也拒绝', 'http://user@example.com/'],
    ['非 http(s) scheme 拒绝', 'ftp://example.com/'],
    ['IPv4 回环拒绝', 'http://127.0.0.1/'],
    ['IPv4 回环高位拒绝', 'http://127.1.2.3/'],
    ['IPv4 私网 10/8 拒绝', 'http://10.0.0.1/'],
    ['IPv4 私网 172.16/12 拒绝', 'http://172.31.255.1/'],
    ['IPv4 私网 192.168/16 拒绝', 'http://192.168.1.1/'],
    ['IPv4 链路本地拒绝', 'http://169.254.169.254/'],
    ['IPv4 CGNAT 拒绝', 'http://100.64.0.1/'],
    ['IPv4 未指定地址拒绝', 'http://0.0.0.0/'],
    ['IPv4 组播拒绝', 'http://224.0.0.1/'],
    ['IPv6 回环拒绝', 'http://[::1]/'],
    ['IPv6 链路本地拒绝', 'http://[fe80::1]/'],
    ['IPv6 ULA 拒绝', 'http://[fc00::1]/'],
    ['IPv6 组播拒绝', 'http://[ff02::1]/'],
    ['IPv4 映射 IPv6 私网拒绝', 'http://[::ffff:192.168.1.1]/'],
    ['畸形 URL 拒绝', 'http://'],
  ])('%s：%s', (_label, href) => {
    expect(checkWebLinkUrl(href)).toEqual({ ok: false, reason: 'web-invalid-address' })
  })

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '172.32.0.1', // 172.16/12 之外（172.32 属公网段）
    '172.15.0.1',
    '192.169.0.1',
  ])('公网 IPv4 字面地址 %s 放行', (ip) => {
    expect(isAllowedInetAddress(ip)).toBe(true)
  })

  it.each([
    '127.0.0.1', '127.255.255.254',
    '10.0.0.1', '10.255.0.1',
    '172.16.0.1', '172.31.255.254',
    '192.168.0.1', '192.168.255.4',
    '169.254.0.1', '169.254.169.254',
    '100.64.0.1', '100.127.255.254',
    '0.0.0.0', '0.1.2.3',
    '224.0.0.1', '239.1.1.1',
    '240.0.0.1', '255.255.255.255',
    '192.0.2.1', '198.51.100.1', '203.0.113.1', // TEST-NET 文档段
    '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1',
  ])('非法地址 %s 被拒', (ip) => {
    expect(isAllowedInetAddress(ip)).toBe(false)
  })

  it('IPv6 公网地址放行（2001:db8 文档段以外的真实公网段）', () => {
    expect(isAllowedInetAddress('2606:4700::1111')).toBe(true)
  })

  it('IPv4 映射 IPv6 合法公网形态放行（review 修复：v4OfLow 字节序）', () => {
    // 旧实现还原为 "0.8.8.8"，全部映射形态被 a===0 误拒
    expect(isAllowedInetAddress('::ffff:8.8.8.8')).toBe(true)
    expect(isAllowedInetAddress('::ffff:1.1.1.1')).toBe(true)
  })

  it.each([
    '::ffff:192.168.1.1', '::ffff:127.0.0.1', '::ffff:10.0.0.1',
  ])('IPv4 映射私网形态 %s 仍拒绝', (ip) => {
    expect(isAllowedInetAddress(ip)).toBe(false)
  })

  it('NAT64 前缀覆盖（review 修复）：64:ff9b 内嵌 v4 按 v4 矩阵判', () => {
    // 内嵌 8.8.8.8 放行（v4OfLow 修复后不再错位为 0.8.8.8 误拒）
    expect(isAllowedInetAddress('64:ff9b::808:808')).toBe(true)
    // 内嵌 127.0.0.1 拒绝（NAT64 网关可能翻译为私网目标）
    expect(isAllowedInetAddress('64:ff9b::7f00:1')).toBe(false)
    // 64:ff9b:1::/48 本地网络前缀整段拒绝（低 32 位即便内嵌公网形态也拒）
    expect(isAllowedInetAddress('64:ff9b:1::1')).toBe(false)
    expect(isAllowedInetAddress('64:ff9b:1::808:808')).toBe(false)
  })

  it('非 IP 字符串按非法处理（防御）', () => {
    expect(isAllowedInetAddress('example.com')).toBe(false)
    expect(isAllowedInetAddress('')).toBe(false)
    expect(isAllowedInetAddress('999.999.999.999')).toBe(false)
  })
})

describe('canonicalWebLinkUrl（缓存键归一）', () => {
  it('大小写/默认端口/fragment 归一到同一键，query 保留区分', () => {
    expect(canonicalWebLinkUrl('https://EXAMPLE.com:443/A?x=1#top')).toBe('https://example.com/A?x=1')
    expect(canonicalWebLinkUrl('https://example.com/A?x=1')).toBe('https://example.com/A?x=1')
    expect(canonicalWebLinkUrl('https://example.com/A?x=2')).not.toBe('https://example.com/A?x=1')
  })
})
