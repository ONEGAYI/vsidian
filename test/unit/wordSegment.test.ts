// #239 分词域形态学与移动规划纯函数矩阵：域判定（表意/标点/假名/全角/
// 弯引号/emoji/韩文）、边界归一（代理对安全）、引擎边界模型（Intl 形态
// 断言 + jieba 词序列）、planCjkWordTarget 移动矩阵（中英混排/标点独立/
// 段界/代理对——确定性断言全部经注入 boundaries，真实 Intl 引擎只断言
// 形态性质，具体切分随 ICU 版本漂移不进契约）。
import { describe, expect, it } from 'vitest'
import {
  boundariesFromTokens,
  createIntlWordBoundaries,
  cumulativeBoundaries,
  cjkSegmentAround,
  isCjkTextChar,
  normalizeWordBoundaries,
  planCjkWordTarget,
  prevCodePointStart,
} from '../../src/shared/wordSegment'

/** 确定性 mock：按给定词序列产边界（jieba cut 的等价形态） */
const boundariesOfWords = (words: readonly string[]) => (text: string) =>
  boundariesFromTokens(text, words) ?? normalizeWordBoundaries(text, [])

describe('isCjkTextChar 分词域判定', () => {
  const inDomain: Array<[string, number]> = [
    ['中', 0x4e2d], ['漢', 0x6f22], ['𠀀', 0x20000], ['𪚥', 0x2a6a5],
    ['。', 0x3002], ['「', 0x300c], ['々', 0x3005],
    ['，', 0xff0c], ['！', 0xff01], ['ａ', 0xff41],
    ['あ', 0x3042], ['ア', 0x30a2], ['ー', 0x30fc],
    ['—', 0x2014], ['“', 0x201c], ['…', 0x2026],
  ]
  const outOfDomain: Array<[string, number]> = [
    ['A', 0x41], ['a', 0x61], ['0', 0x30], ['.', 0x2e], ['-', 0x2d],
    [' ', 0x20], ['ᄀ', 0x1100], ['한', 0xd55c],
    ['😀', 0x1f600], ['€', 0x20ac], ['·', 0xb7],
  ]
  it.each(inDomain)('%s (U+%X) 在域内', (_s, cp) => {
    expect(isCjkTextChar(cp)).toBe(true)
  })
  it.each(outOfDomain)('%s (U+%X) 在域外（原生 group 语义处理）', (_s, cp) => {
    expect(isCjkTextChar(cp)).toBe(false)
  })
})

describe('normalizeWordBoundaries 边界归一', () => {
  it('升序去重并补齐 0 与 len', () => {
    expect(normalizeWordBoundaries('中文测试', [4, 2, 2, 0])).toEqual([0, 2, 4])
    // len 自动在场
    expect(normalizeWordBoundaries('中文测试', [2])).toEqual([0, 2, 4])
  })
  it('劈开代理对的落点被过滤（emoji 码点安全）', () => {
    // '😀' 占两个 UTF-16 单元：偏移 1 劈开代理对
    expect(normalizeWordBoundaries('😀中', [1, 2])).toEqual([0, 2, 3])
  })
  it('越界与非整数落点被忽略', () => {
    expect(normalizeWordBoundaries('ab', [-1, 3, 1.5, 1])).toEqual([0, 1, 2])
  })
})

describe('cumulativeBoundaries 累计偏移', () => {
  it('长度序列 → 边界序列（含尾界）', () => {
    expect(cumulativeBoundaries([2, 2, 2], 6)).toEqual([0, 2, 4, 6])
    expect(cumulativeBoundaries([], 0)).toEqual([0])
  })
  it('累计与 total 不符返回空（调用方退化）', () => {
    expect(cumulativeBoundaries([2, 3], 6)).toEqual([])
  })
})

describe('createIntlWordBoundaries（真实 Intl.Segmenter，形态断言）', () => {
  const engine = createIntlWordBoundaries()
  it('运行时可用（node18 / chrome118 均有）', () => {
    expect(engine).not.toBeNull()
  })
  it.skipIf(engine === null)('边界升序、含首尾、码点对齐', () => {
    for (const text of ['中华人民共和国', '中文，测试。', 'a😀中b']) {
      const boundaries = engine!(text)
      expect(boundaries[0]).toBe(0)
      expect(boundaries.at(-1)).toBe(text.length)
      for (let i = 1; i < boundaries.length; i++) {
        expect(boundaries[i]!).toBeGreaterThan(boundaries[i - 1]!)
      }
      for (const b of boundaries) {
        // 码点边界：不紧跟高位代理
        if (b > 0 && b < text.length) {
          expect(text.charCodeAt(b - 1) >= 0xd800 && text.charCodeAt(b - 1) <= 0xdbff
            && text.charCodeAt(b) >= 0xdc00).toBe(false)
        }
      }
    }
  })
  it.skipIf(engine === null)('中文标点独立边界（isWordLike=false 的段贡献边界）', () => {
    const text = '好的，继续'
    const boundaries = engine!(text)
    // '，'（U+FF0C）的两侧必须都是边界：标点前有词界、后有词界
    const commaIndex = text.indexOf('，')
    expect(boundaries).toContain(commaIndex)
    expect(boundaries).toContain(commaIndex + 1)
  })
})

describe('boundariesFromTokens（jieba 词序列 → 边界）', () => {
  it('词拼接与原文一致：累计偏移 + 归一', () => {
    expect(boundariesFromTokens('中文测试文档', ['中文', '测试', '文档'])).toEqual([0, 2, 4, 6])
  })
  it('拼接不一致返回 null（防御：调用方退化段首尾）', () => {
    expect(boundariesFromTokens('中文', ['中', '文x'])).toBeNull()
  })
})

describe('cjkSegmentAround 段扩展', () => {
  it('域字符连续段取极大区间，域外字符截断', () => {
    // 'a中文b'：段 [1,3)
    expect(cjkSegmentAround('a中文b', 1, true)).toEqual([1, 3])
    expect(cjkSegmentAround('a中文b', 3, false)).toEqual([1, 3])
  })
  it('emoji 劈开段（emoji 非域字符）', () => {
    // '中😀文'（中=0，😀=1..2，文=3）：两个独立单字段
    expect(cjkSegmentAround('中😀文', 0, true)).toEqual([0, 1])
    expect(cjkSegmentAround('中😀文', 3, true)).toEqual([3, 4])
    // offset 3 的前一码点是 emoji（域外）：规划返回 null 交原生处理
    expect(planCjkWordTarget('中😀文', 3, false, boundariesOfWords(['文']))).toBeNull()
  })
  it('弯引号/全角标点与表意同段（整段进引擎，标点独立边界由引擎产出）', () => {
    expect(cjkSegmentAround('好的，继续', 0, true)).toEqual([0, 5])
  })
})

describe('prevCodePointStart 码点安全回退', () => {
  it('代理对整体回退两个单元', () => {
    expect(prevCodePointStart('😀', 2)).toBe(0)
    expect(prevCodePointStart('中😀', 3)).toBe(1)
  })
  it('BMP 字符回退一个单元', () => {
    expect(prevCodePointStart('中', 1)).toBe(0)
  })
})

describe('planCjkWordTarget 移动规划矩阵（注入确定性边界）', () => {
  const text = '中文测试文档'
  const boundaries = boundariesOfWords(['中文', '测试', '文档'])
  const wholeSegment = boundariesOfWords(['中文测试文档'])

  it('前向：段内逐词右移（词界 2/4/6）', () => {
    expect(planCjkWordTarget(text, 0, true, boundaries)).toBe(2)
    expect(planCjkWordTarget(text, 1, true, boundaries)).toBe(2)
    expect(planCjkWordTarget(text, 2, true, boundaries)).toBe(4)
    expect(planCjkWordTarget(text, 5, true, boundaries)).toBe(6)
  })
  it('后向：段内逐词左移（词界 4/2/0）', () => {
    expect(planCjkWordTarget(text, 6, false, boundaries)).toBe(4)
    expect(planCjkWordTarget(text, 4, false, boundaries)).toBe(2)
    expect(planCjkWordTarget(text, 2, false, boundaries)).toBe(0)
    expect(planCjkWordTarget(text, 1, false, boundaries)).toBe(0)
  })
  it('引擎整段不切时退化为段界（等同原生整段跳，词典未收录形态）', () => {
    expect(planCjkWordTarget(text, 0, true, wholeSegment)).toBe(6)
    expect(planCjkWordTarget(text, 6, false, wholeSegment)).toBe(0)
  })
  it('拉丁/空白/ASCII 标点一律 null（交 CM6 原生 group 语义）', () => {
    for (const [line, offset, forward] of [
      ['hello world', 0, true], ['hello world', 5, false],
      ['foo_bar baz', 3, true], ['  spaced', 1, true],
      ['a.b.c', 1, true], ['123abc 456', 3, true],
    ] as const) {
      expect(planCjkWordTarget(line, offset, forward, boundaries)).toBeNull()
    }
  })
  it('中英混排：域外起点 null、域内起点进入中文段', () => {
    const mixed = 'abc中文def'
    const mixedBounds = boundariesOfWords(['中文'])
    expect(planCjkWordTarget(mixed, 0, true, mixedBounds)).toBeNull() // 'a' 域外
    expect(planCjkWordTarget(mixed, 3, true, mixedBounds)).toBe(5) // '中' 段尾
    expect(planCjkWordTarget(mixed, 5, false, mixedBounds)).toBe(3) // 左移入段首
    expect(planCjkWordTarget(mixed, 5, true, mixedBounds)).toBeNull() // 'd' 域外
  })
  it('中文标点独立边界（注入 [0,2,3,5]：好的|，|继续）', () => {
    const punct = '好的，继续'
    const b = boundariesOfWords(['好的', '，', '继续'])
    expect(b(punct)).toEqual([0, 2, 3, 5])
    expect(planCjkWordTarget(punct, 2, true, b)).toBe(3) // 词尾 → 标点前界
    expect(planCjkWordTarget(punct, 3, true, b)).toBe(5) // 跨过标点到下一词
    expect(planCjkWordTarget(punct, 5, false, b)).toBe(3)
  })
  it('emoji 邻接：emoji 侧 null（原生处理），中文侧入段且不劈代理对', () => {
    const line = '😀中文'
    const b = boundariesOfWords(['中文'])
    expect(planCjkWordTarget(line, 0, true, b)).toBeNull() // emoji 域外
    expect(planCjkWordTarget(line, 2, true, b)).toBe(4)
    expect(planCjkWordTarget(line, 4, false, b)).toBe(2) // 落在 emoji 之后（不劈）
  })
  it('行界防御：offset 越界/行首后向/行尾前向均 null', () => {
    expect(planCjkWordTarget(text, 0, false, boundaries)).toBeNull()
    expect(planCjkWordTarget(text, text.length, true, boundaries)).toBeNull()
    expect(planCjkWordTarget(text, -1, true, boundaries)).toBeNull()
    expect(planCjkWordTarget(text, 99, true, boundaries)).toBeNull()
  })
  it('空段防御：空文本任意方向 null', () => {
    expect(planCjkWordTarget('', 0, true, boundaries)).toBeNull()
    expect(planCjkWordTarget('', 0, false, boundaries)).toBeNull()
  })
})
