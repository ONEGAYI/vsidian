// PDF 导航锚点解析契约（#337 / P3-05）：`#page=N` 语法按 2026-10-04 修订
// 落地——双链限定的锚点分词（`;` 与 `key=value` 形态仅对非 Markdown 目标
// 启用），page 为 1-based 正整数，仅初始定位；非法形态（0/负数/小数/非
// 数字/未知键/重复键/裸数字/空段）就地报错，不静默回落第一页。
// 范围校验（越出总页数）在装载后由 webview 渲染器分态，不在本解析层。
import { describe, expect, it } from 'vitest'
import { parsePdfNavAnchor } from '../../src/shared/pdfNav'

describe('PDF 锚点解析（#337 双链限定 #page=N）', () => {
  it('空锚点 → 无页码（从第一页开始）', () => {
    expect(parsePdfNavAnchor('')).toEqual({ ok: true, selector: { kind: 'pdf' } })
    expect(parsePdfNavAnchor(null)).toEqual({ ok: true, selector: { kind: 'pdf' } })
  })

  it('page=N（1-based 正整数）→ 初始定位页', () => {
    expect(parsePdfNavAnchor('page=1')).toEqual({ ok: true, selector: { kind: 'pdf', page: 1 } })
    expect(parsePdfNavAnchor('page=3')).toEqual({ ok: true, selector: { kind: 'pdf', page: 3 } })
    expect(parsePdfNavAnchor('page=999999')).toEqual({ ok: true, selector: { kind: 'pdf', page: 999999 } })
  })

  it('页码格式非法：0 / 负数 / 小数 / 非数字 / 空值 / 前导零 → 报错不回落', () => {
    for (const bad of ['page=0', 'page=-1', 'page=1.5', 'page=abc', 'page=', 'page=007', 'page=1e3', 'page= 3', 'page=3 ']) {
      expect(parsePdfNavAnchor(bad), `锚点 "${bad}" 应报格式错误`).toEqual({ ok: false, reason: 'invalid', anchor: bad })
    }
  })

  it('不支持的 fragment：未知键 / 裸数字 / 纯文本锚点 → 报错（不静默跳过）', () => {
    for (const bad of ['zoom=2', 'pages=3-5', '3', 'page', '=3', '第一章']) {
      expect(parsePdfNavAnchor(bad), `锚点 "${bad}" 应按不支持 fragment 报错`).toEqual({ ok: false, reason: 'invalid', anchor: bad })
    }
  })

  it('分词边界：page 是唯一键；重复键与空段非法', () => {
    expect(parsePdfNavAnchor('page=3;')).toEqual({ ok: false, reason: 'invalid', anchor: 'page=3;' })
    expect(parsePdfNavAnchor(';page=3')).toEqual({ ok: false, reason: 'invalid', anchor: ';page=3' })
    expect(parsePdfNavAnchor('page=1;page=2')).toEqual({ ok: false, reason: 'invalid', anchor: 'page=1;page=2' })
    expect(parsePdfNavAnchor('page=3;;')).toEqual({ ok: false, reason: 'invalid', anchor: 'page=3;;' })
  })

  it('非法锚点保留原文供就地错误文案（anchor 字段）', () => {
    const result = parsePdfNavAnchor('page=0')
    expect(result).toEqual({ ok: false, reason: 'invalid', anchor: 'page=0' })
  })
})
