// #340（P3-08）可读文本共享内核契约：锚点分词/校验/窗口规划矩阵（规范
// 原文=docs/specs/hover-preview-embed.md 导航边界 2026-10-04 修订）、头部
// 有界探测（UTF-16 BOM 放行/NUL/严格 UTF-8）、行拆分与窗口裁剪、token
// 5 元组编解码往返。
import { describe, expect, it } from 'vitest'
import {
  REF_TEXT_LIMITS,
  clipLinesToWindow,
  decodeTextTokenRuns,
  encodeTextTokenRuns,
  parseTextAnchorSpec,
  resolveTextNav,
  sniffTextHead,
  splitLfLines,
} from '../../src/shared/refText'

describe('parseTextAnchorSpec：分词边界（`;` 与 key=value 仅非 Markdown 锚点段）', () => {
  it('空串 = 无锚点段', () => {
    expect(parseTextAnchorSpec('')).toEqual({})
  })

  it('单键 line/range 与组合（键序无关）', () => {
    expect(parseTextAnchorSpec('line=10')).toEqual({ line: 10 })
    expect(parseTextAnchorSpec('range=3-5')).toEqual({ range: { begin: 3, end: 5 } })
    expect(parseTextAnchorSpec('line=10;range=3-5')).toEqual({ line: 10, range: { begin: 3, end: 5 } })
    expect(parseTextAnchorSpec('range=3-5;line=10')).toEqual({ line: 10, range: { begin: 3, end: 5 } })
  })

  it('开放端：B- 与 -E 以字段缺席表示；B==E 合法', () => {
    expect(parseTextAnchorSpec('range=3-')).toEqual({ range: { begin: 3 } })
    expect(parseTextAnchorSpec('range=-5')).toEqual({ range: { end: 5 } })
    expect(parseTextAnchorSpec('range=7-7')).toEqual({ range: { begin: 7, end: 7 } })
  })

  it('段两侧空白宽容', () => {
    expect(parseTextAnchorSpec(' line=10 ; range=3-5 ')).toEqual({ line: 10, range: { begin: 3, end: 5 } })
  })

  it('非法形态一律 null：0/负数/非数字/未知键/重复键/空段/裸键', () => {
    const invalid = [
      'line=0', 'line=-3', 'line=1.5', 'line=abc', 'line=', 'line',
      'line=10x', 'x=1', 'page=3', 'foo=bar',
      'line=1;line=2', 'range=1-2;range=3-4',
      'line=10;;range=3-5', 'line=10;', ';line=10',
      'range=-', 'range=', 'range=3', 'range=a-5', 'range=3-b', 'range=3-5-7',
      '标题锚点', 'line=10,range=3-5', '  ',
    ]
    for (const anchor of invalid) {
      expect(parseTextAnchorSpec(anchor), `锚点 "${anchor}" 应判非法`).toBeNull()
    }
  })
})

describe('resolveTextNav：校验与窗口规划（规范六条子项对照）', () => {
  const TOTAL = 100

  it('无锚点：全文从头、跳转落文件顶部', () => {
    const r = resolveTextNav({}, TOTAL)
    expect(r).toEqual({
      ok: true,
      nav: { selector: {}, beginLine: 1, endLine: TOTAL, locateLine: 1, jumpLine: 1 },
    })
  })

  it('#line=N：初始起点与跳转锚点均落 N，全文可滚（无 range）', () => {
    const r = resolveTextNav({ line: 10 }, TOTAL)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.nav.beginLine).toBe(1)
      expect(r.nav.endLine).toBe(TOTAL)
      expect(r.nav.locateLine).toBe(10)
      expect(r.nav.jumpLine).toBe(10)
    }
  })

  it('仅 range：窗口 [B,E] 硬边界、跳转落窗口起点 B；开放端按总行数收口', () => {
    const r = resolveTextNav({ range: { begin: 10, end: 20 } }, TOTAL)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.nav.beginLine).toBe(10)
      expect(r.nav.endLine).toBe(20)
      expect(r.nav.locateLine).toBe(10)
      expect(r.nav.jumpLine).toBe(10)
    }
    const openEnd = resolveTextNav({ range: { begin: 90 } }, TOTAL)
    expect(openEnd.ok && openEnd.nav.endLine).toBe(TOTAL)
    const openBegin = resolveTextNav({ range: { end: 5 } }, TOTAL)
    expect(openBegin.ok && openBegin.nav.beginLine).toBe(1)
    expect(openBegin.ok && openBegin.nav.jumpLine).toBe(1)
  })

  it('组合：窗口内定位（line 落窗口内各位置均合法，含边界）', () => {
    for (const line of [3, 4, 5]) {
      const r = resolveTextNav({ line, range: { begin: 3, end: 5 } }, TOTAL)
      expect(r.ok && r.nav.locateLine).toBe(line)
    }
  })

  it('验收示例显式契约（2026-10-04 修正口径）：#line=4;range=3-5 正常定位；#line=10;range=3-5 就地报错', () => {
    // 正常用例：4 在 3–5 窗口内——初始展示与跳转均落第 4 行
    const ok = resolveTextNav({ line: 4, range: { begin: 3, end: 5 } }, TOTAL)
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.nav.locateLine).toBe(4)
      expect(ok.nav.jumpLine).toBe(4)
      expect(ok.nav.beginLine).toBe(3)
      expect(ok.nav.endLine).toBe(5)
    }
    // 报错用例：10 不在 3–5 窗口内——line-outside-window，不静默回顶
    expect(resolveTextNav({ line: 10, range: { begin: 3, end: 5 } }, TOTAL))
      .toEqual({ ok: false, code: 'line-outside-window' })
  })

  it('line 越出 range 窗口：就地报错（line-outside-window）不静默纠正', () => {
    expect(resolveTextNav({ line: 50, range: { begin: 10, end: 20 } }, TOTAL))
      .toEqual({ ok: false, code: 'line-outside-window' })
    expect(resolveTextNav({ line: 2, range: { begin: 3, end: 5 } }, TOTAL))
      .toEqual({ ok: false, code: 'line-outside-window' })
    expect(resolveTextNav({ line: 6, range: { begin: 3, end: 5 } }, TOTAL))
      .toEqual({ ok: false, code: 'line-outside-window' })
  })

  it('B>E：range-order 报错', () => {
    expect(resolveTextNav({ range: { begin: 20, end: 10 } }, TOTAL))
      .toEqual({ ok: false, code: 'range-order' })
  })

  it('越出总行数：out-of-bounds（line/begin/end 任一）', () => {
    expect(resolveTextNav({ line: TOTAL + 1 }, TOTAL)).toEqual({ ok: false, code: 'out-of-bounds' })
    expect(resolveTextNav({ range: { begin: TOTAL + 1, end: TOTAL + 2 } }, TOTAL))
      .toEqual({ ok: false, code: 'out-of-bounds' })
    expect(resolveTextNav({ range: { begin: 1, end: TOTAL + 1 } }, TOTAL))
      .toEqual({ ok: false, code: 'out-of-bounds' })
  })

  it('窗口止合法贴合总行数（E == totalLines 合法）', () => {
    expect(resolveTextNav({ range: { begin: 1, end: TOTAL } }, TOTAL).ok).toBe(true)
    expect(resolveTextNav({ line: TOTAL }, TOTAL).ok).toBe(true)
  })
})

describe('sniffTextHead：有界探测', () => {
  const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)

  it('纯文本与含中文的 UTF-8 头部放行', () => {
    expect(sniffTextHead(utf8('const x = 1\n'))).toBe('ok')
    expect(sniffTextHead(utf8('# 配置文件\nvalue = 值\n'))).toBe('ok')
  })

  it('UTF-16 BOM 放行（宿主可解码——编码以宿主解码结果为准）', () => {
    expect(sniffTextHead(new Uint8Array([0xff, 0xfe, 0x41, 0x00]))).toBe('ok')
    expect(sniffTextHead(new Uint8Array([0xfe, 0xff, 0x00, 0x41]))).toBe('ok')
  })

  it('含 NUL 字节判二进制（UTF-16 已在前放行，不误伤）', () => {
    expect(sniffTextHead(new Uint8Array([0x31, 0x32, 0x00, 0x33]))).toBe('binary')
  })

  it('非法 UTF-8 序列传非法编码（如实拒绝，不猜编码）', () => {
    // GBK「中文」的典型字节序列与孤立 0xFF
    expect(sniffTextHead(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4, 0x0a]))).toBe('invalid-encoding')
    expect(sniffTextHead(new Uint8Array([0x41, 0xff, 0x42]))).toBe('invalid-encoding')
  })

  it('探测边界处的截断多字节序列按流式宽容（8KiB 切割不误伤）', () => {
    // 「中文」的 UTF-8 六字节被切掉最后一个（探测边界恰在字符中间）
    const partial = new Uint8Array([0xe4, 0xb8, 0xad, 0xe6, 0x96])
    expect(sniffTextHead(partial)).toBe('ok')
  })
})

describe('行拆分与窗口裁剪', () => {
  it('LF 拆分：结尾无换行也成行；空文件单空行', () => {
    expect(splitLfLines('a\nb\nc')).toEqual(['a', 'b', 'c'])
    expect(splitLfLines('a\nb\n')).toEqual(['a', 'b', ''])
    expect(splitLfLines('')).toEqual([''])
  })

  it('窗口裁剪（1-based 闭区间）', () => {
    const lines = ['one', 'two', 'three', 'four', 'five']
    expect(clipLinesToWindow(lines, 2, 4)).toEqual(['two', 'three', 'four'])
    expect(clipLinesToWindow(lines, 3, 3)).toEqual(['three'])
    expect(clipLinesToWindow(lines, 1, 5)).toEqual(lines)
  })
})

describe('token 5 元组编解码', () => {
  it('往返一致（跨行/同行多段/大位移）', () => {
    const runs = [
      { line: 0, start: 0, length: 4, colorIdx: 1, fontStyleBits: 0 },
      { line: 0, start: 5, length: 3, colorIdx: 2, fontStyleBits: 2 },
      { line: 1, start: 0, length: 7, colorIdx: 1, fontStyleBits: 0 },
      { line: 300, start: 12, length: 1, colorIdx: 5, fontStyleBits: 1 },
      { line: 300, start: 20, length: 9, colorIdx: 0, fontStyleBits: 8 },
    ]
    const data = encodeTextTokenRuns(runs)
    expect(data.length).toBe(runs.length * 5)
    expect(decodeTextTokenRuns(data)).toEqual(runs)
  })

  it('空数据解码为空', () => {
    expect(decodeTextTokenRuns([])).toEqual([])
    expect(encodeTextTokenRuns([])).toEqual([])
  })

  it('与语义 token 命令同构的增量语义（手算对照）', () => {
    // [deltaLine, deltaStart, length, colorIdx, bits]
    const data = [0, 0, 2, 1, 0, 0, 3, 4, 2, 0, 1, 0, 1, 3, 0]
    expect(decodeTextTokenRuns(data)).toEqual([
      { line: 0, start: 0, length: 2, colorIdx: 1, fontStyleBits: 0 },
      { line: 0, start: 3, length: 4, colorIdx: 2, fontStyleBits: 0 },
      { line: 1, start: 0, length: 1, colorIdx: 3, fontStyleBits: 0 },
    ])
  })
})

describe('准入参数集中定义', () => {
  it('初值锁定（后续压测票修订须回改本契约）', () => {
    expect(REF_TEXT_LIMITS.maxFileBytes).toBe(2 * 1024 * 1024)
    expect(REF_TEXT_LIMITS.maxLineChars).toBe(20_000)
    expect(REF_TEXT_LIMITS.probeBytes).toBe(8192)
  })
})
