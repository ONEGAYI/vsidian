// 宽松内联链接/图片形态学契约（工单 #152）：`[文字](含空格 路径.md)` 与
// `![alt](图片 名字.png)` 这类「目标含未编码空格」的形态——lezer 与
// markdown-it 均按严格 CommonMark 拒绝（裸目标不许含空格），本形态学以
// Obsidian 为基准提供两视图共用的宽松判定：
// - 接管边界：仅当括号内容含空格/制表符且标准目标语法（ws* 目标 ws* 标题?
//   ws*，含 <> 尖括号）无法解析时才匹配；%20 编码、<> 包裹、合法标题等
//   标准形态一律返回 null 交还标准层（行为不变）
// - 目标语义：括号内整段字面文本（两侧空白 trim、内部空格保留）；
//   `[t](a b "标题")` 的目标是 `a b "标题"`（完整渲染为一条链接，不产生
//   部分链接——「标题」不拆分）
// - 不支持（返回 null，按原文降级）：反斜杠（含 `\!` 转义前缀，属标准层
//   语义）、标签内含 [ ]、`[` 前紧贴 `[`（双链/三连括号域）、`[` 前紧贴
//   `!` 的链接形态（该括号只按图片形态尝试）、括号未同行闭合（含嵌套
//   括号不平衡）、控制字符、空白内容
// - 单行形态：出现不跨行
import { describe, it, expect } from 'vitest'
import {
  looseLinkAtCol,
  parseLooseLinkAt,
  scanLooseLinksInLine,
  standardInlineDestParses,
} from '../../src/shared/looseLink'

describe('standardInlineDestParses：标准内联目标语法门（宽松层只接管标准层拒绝的形态）', () => {
  it('标准可解析形态返回 true（宽松层不接管）', () => {
    // 裸目标（无空白）与尾随空白
    expect(standardInlineDestParses('a.md')).toBe(true)
    expect(standardInlineDestParses(' a.md ')).toBe(true)
    expect(standardInlineDestParses('  ')).toBe(true) // 空内容属标准层（[t]() 行为）
    // 尖括号形态（合法与否均归标准层处置）
    expect(standardInlineDestParses('<a b.md>')).toBe(true)
    expect(standardInlineDestParses('<a b')).toBe(true)
    // 目标 + 合法标题（三种引号形态，标题可含空格）
    expect(standardInlineDestParses('a "ti tle"')).toBe(true)
    expect(standardInlineDestParses("a 'ti tle'")).toBe(true)
    expect(standardInlineDestParses('a (ti tle)')).toBe(true)
    expect(standardInlineDestParses(' a "t" ')).toBe(true)
  })

  it('标准不可解析形态返回 false（宽松层接管）', () => {
    expect(standardInlineDestParses('a b')).toBe(false)
    expect(standardInlineDestParses('a b "标题"')).toBe(false)
    expect(standardInlineDestParses('a b.md')).toBe(false)
    expect(standardInlineDestParses(' a b ')).toBe(false)
    expect(standardInlineDestParses('a b "未闭合')).toBe(false)
    expect(standardInlineDestParses('a b x"t"')).toBe(false)
  })
})

describe('parseLooseLinkAt：单点解析', () => {
  it('链接基础形态：命中并给出全文相对区间与字面目标', () => {
    const src = '前[文字](含空格 路径.md)后'
    const hit = parseLooseLinkAt(src, src.indexOf('['))
    expect(hit).toEqual({
      from: src.indexOf('['),
      to: src.indexOf(')') + 1,
      labelFrom: src.indexOf('文'),
      labelTo: src.indexOf(']'),
      dest: '含空格 路径.md',
      image: false,
    })
  })

  it('图片形态：! 前缀计入区间起点', () => {
    const src = '![说明](图片 名字.png)'
    const hit = parseLooseLinkAt(src, 0)
    expect(hit).toMatchObject({
      from: 0,
      to: src.length,
      labelFrom: 2,
      labelTo: 4,
      dest: '图片 名字.png',
      image: true,
    })
  })

  it('目标两侧空白 trim、内部空格保留（与双链规范化同族契约）', () => {
    const src = '[t](  a  b  )'
    expect(parseLooseLinkAt(src, 0)).toMatchObject({ dest: 'a  b' })
  })

  it('嵌套平衡括号计入目标；未平衡或未闭合返回 null', () => {
    expect(parseLooseLinkAt('[t](a (b) c)', 0)).toMatchObject({ dest: 'a (b) c' })
    expect(parseLooseLinkAt('[t](a (b c)', 0)).toBeNull()
    expect(parseLooseLinkAt('[t](a b', 0)).toBeNull()
  })

  it('带引号组合形态整段作为目标（不产生部分链接）', () => {
    expect(parseLooseLinkAt('[t](a b "标题")', 0)).toMatchObject({
      dest: 'a b "标题"',
      to: '[t](a b "标题")'.length,
    })
  })

  it('制表符与中文混排目标同样接管', () => {
    expect(parseLooseLinkAt('[t](a\tb.md)', 0)).toMatchObject({ dest: 'a\tb.md' })
    expect(parseLooseLinkAt('[中文](子 目录/目标 二.md)', 0)).toMatchObject({
      dest: '子 目录/目标 二.md',
    })
  })

  it('标准层职责形态返回 null：无空白、%20、尖括号、合法标题、纯尾随空白', () => {
    expect(parseLooseLinkAt('[t](a.md)', 0)).toBeNull()
    expect(parseLooseLinkAt('[t](./目标%20文档.md)', 0)).toBeNull()
    expect(parseLooseLinkAt('[t](<a b.md>)', 0)).toBeNull()
    expect(parseLooseLinkAt('[t](a "ti tle")', 0)).toBeNull()
    expect(parseLooseLinkAt("[t](a 'ti tle')", 0)).toBeNull()
    expect(parseLooseLinkAt('[t](a (ti tle))', 0)).toBeNull()
    expect(parseLooseLinkAt('[t]( a )', 0)).toBeNull()
    expect(parseLooseLinkAt('[t]()', 0)).toBeNull()
  })

  it('反斜杠形态不接管（转义属标准层语义，维持现状）', () => {
    expect(parseLooseLinkAt('[t](a\\ b)', 0)).toBeNull()
    expect(parseLooseLinkAt('[t](a b\\ c)', 0)).toBeNull()
    // 标签内反斜杠（转义闭括号会破坏「首个 ]」判定）同样归标准层
    expect(parseLooseLinkAt('[a\\](b c)', 0)).toBeNull()
    expect(parseLooseLinkAt('[a\\_b](c d.md)', 0)).toBeNull()
    // \![…]：转义前缀不构成图片；同一括号也不按链接形态回退
    const src = '\\![t](a b.md)'
    expect(parseLooseLinkAt(src, src.indexOf('!'))).toBeNull()
    expect(parseLooseLinkAt(src, src.indexOf('['))).toBeNull()
  })

  it('标签与前置守卫：内部含 []、前置 [（双链域）、前置 ! 的链接形态均拒绝', () => {
    expect(parseLooseLinkAt('[a [b] c](x y.md)', 0)).toBeNull()
    expect(parseLooseLinkAt('[a [b](x y.md)', 0)).toBeNull()
    expect(parseLooseLinkAt('[[a b]](x y.md)', 0)).toBeNull()
    // 前置 ! 的括号只按图片形态尝试（在 ! 处解析），在 [ 处不回退为链接
    const src = '![alt](a b.png)'
    expect(parseLooseLinkAt(src, src.indexOf('['))).toBeNull()
    expect(parseLooseLinkAt(src, 0)).not.toBeNull()
  })

  it('控制字符、空白内容、跨行不匹配', () => {
    expect(parseLooseLinkAt('[t](a\u0001b c)', 0)).toBeNull()
    expect(parseLooseLinkAt('[t](   )', 0)).toBeNull()
    expect(parseLooseLinkAt('[t]( \t )', 0)).toBeNull()
    // limit 截断（阅读规则以行尾为界）：闭括号越界即不匹配
    expect(parseLooseLinkAt('[t](a b)', 0, 6)).toBeNull()
  })
})

describe('scanLooseLinksInLine / looseLinkAtCol：单行扫描与定位', () => {
  it('一行内多个出现（链接与图片混合）互不重叠、base 偏移正确', () => {
    const line = '前 [甲](one two.md) 中 ![乙](three four.png) 后'
    const hits = scanLooseLinksInLine(line)
    expect(hits).toHaveLength(2)
    expect(hits[0]).toMatchObject({ image: false, dest: 'one two.md' })
    expect(hits[1]).toMatchObject({ image: true, dest: 'three four.png' })
    expect(hits[0]!.to).toBeLessThanOrEqual(hits[1]!.from)
    // base 偏移：全文 offset 语义
    const shifted = scanLooseLinksInLine(line, 100)
    expect(shifted[0]).toMatchObject({ from: 100 + line.indexOf('['), to: 100 + line.indexOf(')', line.indexOf('[')) + 1 })
  })

  it('扫描跳过未命中括号后继续（残缺形态不吞噬后续合法出现）', () => {
    const line = '[未闭合](a b 后 [合法](x y.md)'
    const hits = scanLooseLinksInLine(line)
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ dest: 'x y.md' })
  })

  it('looseLinkAtCol：from <= col < to 命中（含闭括号）；区间外返回 null', () => {
    const line = '前 [文字](a b.md) 后'
    const open = line.indexOf('[')
    const hit = looseLinkAtCol(line, open + 1)
    expect(hit).toMatchObject({ dest: 'a b.md' })
    expect(looseLinkAtCol(line, open)).toMatchObject({ dest: 'a b.md' })
    expect(looseLinkAtCol(line, line.indexOf(')'))).toMatchObject({ dest: 'a b.md' })
    expect(looseLinkAtCol(line, line.indexOf(')') + 1)).toBeNull()
    expect(looseLinkAtCol(line, 0)).toBeNull()
  })
})
