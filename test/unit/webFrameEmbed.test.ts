// #343（P3-11）原网页形态 iframe 预检纯逻辑矩阵：X-Frame-Options
// （DENY/SAMEORIGIN 已知拒绝；ALLOW-FROM Chromium 忽略不可判）、CSP
// frame-ancestors（在场且不含通配 = 已知拒绝；缺席不限制）、HTTP 最终
// 地址（安全上下文无法内嵌 = 混合内容退回）。语义边界：
// - 本判定只回答「已知头是否明确拒绝」——不可观察的登录/脚本失败不归
//   此处（webview 侧诚实呈现「无法确认」，不编造检测结果）；
// - 恶意头形态（重复指令、垃圾 token）不放大为拒绝——预检退回必须基于
//   站点的明确拒绝声明，误判方向只能是「放行后尽力显示」。
import { describe, expect, it } from 'vitest'
import { assessWebFrameEmbeddability } from '../../src/shared/webLink'

const httpsInput = (headers: {
  xFrameOptions?: string | string[]
  contentSecurityPolicy?: string | string[]
}) => ({ protocol: 'https:', ...headers })

describe('HTTP 混合内容（最终地址非 https 无法安全内嵌）', () => {
  it('http 最终地址 → 拒绝 reason=http（与任何头无关）', () => {
    expect(assessWebFrameEmbeddability({ protocol: 'http:' })).toEqual({ embeddable: false, reason: 'http' })
  })

  it('http 最终地址即便站点无任何拒绝头也退回', () => {
    expect(assessWebFrameEmbeddability({
      protocol: 'http:',
      contentSecurityPolicy: "default-src 'self'",
    })).toEqual({ embeddable: false, reason: 'http' })
  })

  it('https 无头 → 可内嵌', () => {
    expect(assessWebFrameEmbeddability(httpsInput({}))).toEqual({ embeddable: true })
  })
})

describe('X-Frame-Options 已知拒绝形态', () => {
  it.each(['DENY', 'deny', 'Deny'])('XFO=%s → 拒绝 reason=denied', (value) => {
    expect(assessWebFrameEmbeddability(httpsInput({ xFrameOptions: value })))
      .toEqual({ embeddable: false, reason: 'denied' })
  })

  it.each(['SAMEORIGIN', 'sameorigin', 'SameOrigin'])('XFO=%s → 拒绝', (value) => {
    expect(assessWebFrameEmbeddability(httpsInput({ xFrameOptions: value })))
      .toEqual({ embeddable: false, reason: 'denied' })
  })

  it('XFO 带空白与逗号拼接（多值归一形态）→ 识别其中的 deny', () => {
    expect(assessWebFrameEmbeddability(httpsInput({ xFrameOptions: ' SAMEORIGIN, DENY ' })))
      .toEqual({ embeddable: false, reason: 'denied' })
  })

  it('多条 XFO 头（数组形态）任一拒绝即拒绝', () => {
    expect(assessWebFrameEmbeddability(httpsInput({ xFrameOptions: ['ALLOW-FROM https://a', 'deny'] })))
      .toEqual({ embeddable: false, reason: 'denied' })
  })

  it('XFO=ALLOW-FROM（Chromium 忽略的废弃形态）→ 不构成已知拒绝', () => {
    expect(assessWebFrameEmbeddability(httpsInput({ xFrameOptions: 'ALLOW-FROM https://partner' })))
      .toEqual({ embeddable: true })
  })

  it('XFO 未知 token → 不构成已知拒绝（不编造检测）', () => {
    expect(assessWebFrameEmbeddability(httpsInput({ xFrameOptions: 'banana' })))
      .toEqual({ embeddable: true })
  })
})

describe('CSP frame-ancestors 已知拒绝形态', () => {
  it("frame-ancestors 'none' → 拒绝", () => {
    expect(assessWebFrameEmbeddability(httpsInput({ contentSecurityPolicy: "frame-ancestors 'none'" })))
      .toEqual({ embeddable: false, reason: 'denied' })
  })

  it("frame-ancestors 'self' → 拒绝（webview 父源不可能与站点同源）", () => {
    expect(assessWebFrameEmbeddability(httpsInput({ contentSecurityPolicy: "frame-ancestors 'self'" })))
      .toEqual({ embeddable: false, reason: 'denied' })
  })

  it('frame-ancestors 具体主机源 → 拒绝', () => {
    expect(assessWebFrameEmbeddability(httpsInput({
      contentSecurityPolicy: 'frame-ancestors https://partner.example.com',
    }))).toEqual({ embeddable: false, reason: 'denied' })
  })

  it('frame-ancestors https: scheme 源 → 拒绝（桌面 webview 父源 scheme 非 https）', () => {
    expect(assessWebFrameEmbeddability(httpsInput({ contentSecurityPolicy: 'frame-ancestors https:' })))
      .toEqual({ embeddable: false, reason: 'denied' })
  })

  it('frame-ancestors * → 允许', () => {
    expect(assessWebFrameEmbeddability(httpsInput({
      contentSecurityPolicy: "default-src 'self'; frame-ancestors *",
    }))).toEqual({ embeddable: true })
  })

  it('frame-ancestors vscode-webview: scheme 源 → 允许（显式放行桌面 webview 父源）', () => {
    expect(assessWebFrameEmbeddability(httpsInput({ contentSecurityPolicy: 'frame-ancestors vscode-webview:' })))
      .toEqual({ embeddable: true })
  })

  it('指令名大小写不敏感', () => {
    expect(assessWebFrameEmbeddability(httpsInput({ contentSecurityPolicy: "FRAME-ANCESTORS 'none'" })))
      .toEqual({ embeddable: false, reason: 'denied' })
  })

  it('CSP 有其他指令但无 frame-ancestors → 不限制内嵌', () => {
    expect(assessWebFrameEmbeddability(httpsInput({
      contentSecurityPolicy: "default-src 'none'; img-src 'self'",
    }))).toEqual({ embeddable: true })
  })

  it('多条 CSP 头取交集语义：一条放行一条拒绝 → 拒绝', () => {
    expect(assessWebFrameEmbeddability(httpsInput({
      contentSecurityPolicy: ['frame-ancestors *', "frame-ancestors 'none'"],
    }))).toEqual({ embeddable: false, reason: 'denied' })
  })

  it('同一头内重复 frame-ancestors 指令 → 该策略按 CSP 规范整体作废（不据此拒绝）', () => {
    expect(assessWebFrameEmbeddability(httpsInput({
      contentSecurityPolicy: "frame-ancestors 'none'; frame-ancestors *",
    }))).toEqual({ embeddable: true })
  })

  it('XFO 拒绝 + CSP 放行 → 仍拒绝（XFO 独立生效）', () => {
    expect(assessWebFrameEmbeddability(httpsInput({
      xFrameOptions: 'DENY',
      contentSecurityPolicy: 'frame-ancestors *',
    }))).toEqual({ embeddable: false, reason: 'denied' })
  })
})
