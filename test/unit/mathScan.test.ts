// 公式形态学契约测试（工单 #59）：src/shared/math.ts 是 `$…$` / `$$…$$`
// 判定的单一事实源（live 行扫描、阅读渲染语义对照共用）。判定规则与
// @vscode/markdown-it-katex 的 inline/block 规则逐条对齐（贴字规则、
// 转义、空内容、$$ 优先于 $、行内代码 span 排除），保证同一文本在
// 实时预览与阅读模式呈现一致语义。
import { describe, expect, it } from 'vitest'
import { mapContentOffsetToDoc, opensMathBlockLine, scanMathRanges, stripInlineTexTicks } from '../../src/shared/math'
import { scanFencesDetailed } from '../../src/shared/mermaid'

/** 文本按行拆分后扫描（行首 offset 自动累加，与 CM6 行迭代同构） */
function scan(text: string) {
  return scanMathRanges(text.split('\n'), 0)
}

function hits(text: string) {
  return scan(text).map((h) => ({ kind: h.kind, tex: h.tex }))
}

describe('行内公式 $…$（贴字规则与转义）', () => {
  it('基本行内公式命中且区间含定界符', () => {
    const out = scan('价格 $x^2$ 元')
    expect(out).toHaveLength(1)
    expect(out[0]!.kind).toBe('inline')
    expect(out[0]!.tex).toBe('x^2')
    expect(out[0]!.from).toBe(3)
    expect(out[0]!.to).toBe(8)
  })

  it('紧邻拉丁字母的定界符不命中（贴字规则，与 markdown-it-katex 一致）', () => {
    // 闭侧：$ 后紧跟 word 字符不能闭合
    expect(hits('a $x$b c $y$')).toEqual([{ kind: 'inline', tex: 'y' }])
    // 开侧：$ 前是 word 字符不能开启
    expect(hits('a$x$ b')).toEqual([])
  })

  it('全角标点与中文视为非 word 字符，贴字命中', () => {
    expect(hits('（$x^2$）合计')).toEqual([{ kind: 'inline', tex: 'x^2' }])
  })

  it('普通美元数字不误判：闭定界符后紧跟数字时不闭合', () => {
    expect(hits('价格 $5，合计 $10 元')).toEqual([])
    // 与插件一致：首个闭候选不可闭合即放弃开启，$10$ 的 10 独立命中
    expect(hits('价格 $5，合计 $10$ 元')).toEqual([{ kind: 'inline', tex: '10' }])
  })

  it('数字包裹的 $5$ 按公式命中（与插件一致的已知歧义），$5$a 不命中', () => {
    expect(hits('花费 $5$ 元')).toEqual([{ kind: 'inline', tex: '5' }])
    expect(hits('花费 $5$a')).toEqual([])
  })

  it('转义 \\$ 不是定界符，其后公式仍独立命中', () => {
    expect(hits('花费 \\$5 和 $x$ 元')).toEqual([{ kind: 'inline', tex: 'x' }])
    expect(hits('\\$x\\$')).toEqual([])
  })

  it('空内容与相邻定界符不命中', () => {
    expect(hits('a $$ b')).toEqual([])
    expect(hits('$$$$')).toEqual([])
  })

  it('行首 $$ 后恰一对空内容 $$（$$  $$ / $$$$）不开启多行块（B-4 角案）', () => {
    // 空内容的行首闭合形态按原文降级：不产出、也不吞后续行。若当作多行
    // 块开启，后续首个 $$ 行会被误闭合成跨行块（与插件单行闭合语义分叉，
    // 且增量重建的 trailingOpenStart 不认此形态 → 增量窗口漏块）
    expect(hits('$$  $$\nb\n$$')).toEqual([])
    expect(hits('$$$$\nb\n$$')).toEqual([])
    // b 行的行内公式照常命中（不被上方角案吞入跨行块）
    expect(hits('$$$$\n$x$\n$$')).toEqual([{ kind: 'inline', tex: 'x' }])
  })

  it('行内公式 tex 剥首尾反引号谓词（$`1+1`$ 与阅读侧同语义，C5）', () => {
    // 与 @vscode/markdown-it-katex 一致：$`1+1`$ 的内容是 1+1（反引号是
    // 定界装饰不进渲染输入）。MathOccurrence.tex 保留原文，渲染层经此
    // 谓词剥离——live 与阅读共用同一实现
    expect(stripInlineTexTicks('`1+1`')).toBe('1+1')
    expect(stripInlineTexTicks('`a``')).toBe('a`')
    expect(stripInlineTexTicks('`ab')).toBe('`ab')
    expect(stripInlineTexTicks('``')).toBe('``')
    expect(stripInlineTexTicks('x')).toBe('x')
    // live 行扫描与渲染层链路：$`1+1`$ 命中且渲染输入为 1+1
    expect(hits('a $`1+1`$ b')).toEqual([{ kind: 'inline', tex: '`1+1`' }])
    expect(stripInlineTexTicks(scan('a $`1+1`$ b')[0]!.tex)).toBe('1+1')
  })

  it('开启多行块的行谓词（opensMathBlockLine，单一事实源）', () => {
    expect(opensMathBlockLine('$$')).toBe(true)
    expect(opensMathBlockLine('  $$ x')).toBe(true)
    // 最后一对 $$ 恰在行尾 = 单行闭合形态，不开启多行块
    expect(opensMathBlockLine('$$x$$')).toBe(false)
    expect(opensMathBlockLine('$$  $$')).toBe(false)
    expect(opensMathBlockLine('$$$$')).toBe(false)
    expect(opensMathBlockLine('$$x$$y$$')).toBe(false)
    // 对存在但不在行尾：多行块开启（与插件一致，tex 含那对 $$）
    expect(opensMathBlockLine('$$x$$y')).toBe(true)
    expect(opensMathBlockLine('普通行 $$')).toBe(false)
    expect(opensMathBlockLine('')).toBe(false)
  })

  it('单空格内容 $ $ 依插件语义命中（开侧右字符不参与开判定）', () => {
    expect(hits('a $ $ b')).toEqual([{ kind: 'inline', tex: ' ' }])
  })

  it('一行内多个公式互不干扰', () => {
    expect(hits('$a$ 与 $b$ 与 $c$')).toEqual([
      { kind: 'inline', tex: 'a' },
      { kind: 'inline', tex: 'b' },
      { kind: 'inline', tex: 'c' },
    ])
  })

  it('行内代码 span 内的 $ 不命中（与 markdown-it 规则顺序一致）', () => {
    expect(hits('`a $b$ c`')).toEqual([])
    expect(hits('`$x$`')).toEqual([])
    expect(hits('a `b` $x$ c')).toEqual([{ kind: 'inline', tex: 'x' }])
  })

  it('未配对的反引号按普通字符处理，其后公式仍命中', () => {
    expect(hits('`孤立反引号 $x$ 尾')).toEqual([{ kind: 'inline', tex: 'x' }])
  })
})

describe('段内与单行 $$…$$', () => {
  it('段内 $$…$$ 命中为块级语义（displayMode）', () => {
    const out = scan('前文 $$x^2$$ 后文')
    expect(out).toHaveLength(1)
    expect(out[0]!.kind).toBe('block')
    expect(out[0]!.tex).toBe('x^2')
    expect(out[0]!.from).toBe(3)
    expect(out[0]!.to).toBe(10)
  })

  it('行首单行 $$x$$ 命中为块级', () => {
    expect(hits('$$x^2$$')).toEqual([{ kind: 'block', tex: 'x^2' }])
  })

  it('行首 $$x$$y$$ 不当块级，段内规则吃第一对', () => {
    expect(hits('$$x$$y$$')).toEqual([{ kind: 'block', tex: 'x' }])
  })

  it('$$ 与 $ 混排时 $$ 优先消费', () => {
    expect(hits('a $$b$$ c $d$ e')).toEqual([
      { kind: 'block', tex: 'b' },
      { kind: 'inline', tex: 'd' },
    ])
  })

  it('转义 \\$$ 不开启块级', () => {
    expect(hits('a \\$$b$$ c')).toEqual([])
  })
})

describe('跨行 $$ 块', () => {
  it('标准三行块命中，tex 保留定界符之间原文', () => {
    const text = '$$\nx^2 + y^2\n$$'
    const out = scan(text)
    expect(out).toHaveLength(1)
    expect(out[0]!.kind).toBe('block')
    expect(out[0]!.tex).toBe('\nx^2 + y^2\n')
    expect(out[0]!.from).toBe(0)
    expect(out[0]!.to).toBe(text.length)
  })

  it('块前后有正文时区间不含正文与前导缩进', () => {
    const text = '前文\n\n  $$\n  E=mc^2\n  $$\n后文'
    const out = scan(text)
    expect(out).toHaveLength(1)
    expect(out[0]!.tex).toBe('\n  E=mc^2\n  ')
    expect(text.slice(out[0]!.from, out[0]!.to)).toBe('$$\n  E=mc^2\n  $$')
  })

  it('首行带内容的块在末行首个 $$ 处闭合', () => {
    const text = '$$ a\nb $$ 尾文'
    const out = scan(text)
    expect(out).toHaveLength(1)
    expect(out[0]!.tex).toBe(' a\nb ')
  })

  it('未闭合块不命中（稳定降级为源码）', () => {
    expect(hits('$$\nx^2\n')).toEqual([])
    expect(hits('$$ x')).toEqual([])
  })

  it('块内的行内 $ 与反引号不参与行内扫描', () => {
    const text = '$$\n$a$ 与 `b`\n$$'
    const out = scan(text)
    expect(out).toHaveLength(1)
    expect(out[0]!.kind).toBe('block')
  })

  it('连续相邻两块各自命中', () => {
    const out = scan('$$\na\n$$\n$$\nb\n$$')
    expect(out).toHaveLength(2)
    expect(out[0]!.tex).toBe('\na\n')
    expect(out[1]!.tex).toBe('\nb\n')
  })

  it('行内代码 span 跨越块开始定界符时块不启动', () => {
    // 反引号 span 行（含 $$）不影响后续块：span 行按普通行处理
    const out = scan('`code $$ span`\nx\n$$\n闭块 $$')
    expect(out).toHaveLength(1)
    expect(out[0]!.tex).toBe('\n闭块 ') // $$ 前空格属定界符之间原文
  })
})

describe('引用内块公式：前缀剥离（#674 T06）', () => {
  it('一层前缀多行块：开启判定输入裸行，from/to 折算全文坐标，tex 剥前缀', () => {
    const text = ['> [!note] 标题', '> $$', '> x = a^2 + b', '> $$', '> 尾部'].join('\n')
    const out = scan(text)
    expect(out).toHaveLength(1)
    expect(out[0]!.kind).toBe('block')
    // from 为开定界符位置（> 之后）、to 为闭定界符行尾——全文坐标
    expect(text.slice(out[0]!.from, out[0]!.to)).toBe('$$\n> x = a^2 + b\n> $$')
    expect(out[0]!.tex).toBe('\nx = a^2 + b\n')
  })

  it('lineMap 把 tex 各段锚回原文坐标（开启行 rest、内容行、闭合行前段）', () => {
    const text = ['> $$', '> x = a^2', '> tail $$'].join('\n')
    const out = scan(text)
    expect(out).toHaveLength(1)
    expect(out[0]!.tex).toBe('\nx = a^2\ntail ')
    const m = out[0]!.lineMap
    expect(m).toHaveLength(3)
    expect(m[0]).toEqual({ contentOffset: 0, lineStart: 0, prefixLen: '> $$'.length })
    expect(m[1]).toEqual({ contentOffset: 1, lineStart: '> $$\n'.length, prefixLen: 2 })
    expect(m[2]).toEqual({ contentOffset: 1 + 'x = a^2'.length + 1, lineStart: '> $$\n> x = a^2\n'.length, prefixLen: 2 })
    // 换算契约：tex 任一 offset 折算回原文位置 = lineStart + prefixLen + (offset − contentOffset)
    for (const e of m) {
      const nl = out[0]!.tex.indexOf('\n', e.contentOffset)
      const seg = out[0]!.tex.slice(e.contentOffset, nl < 0 ? undefined : nl)
      const docStart = e.lineStart + e.prefixLen
      expect(text.slice(docStart, docStart + seg.length)).toBe(seg)
    }
  })

  it('单行闭合形态 > $$x^2$$：命中为块级，区间为裸定界符段', () => {
    const text = '> 前文 $$x^2$$ 后文不进'
    const out = scan(text)
    expect(out).toHaveLength(1)
    expect(out[0]!.kind).toBe('block')
    expect(text.slice(out[0]!.from, out[0]!.to)).toBe('$$x^2$$')
    expect(out[0]!.tex).toBe('x^2')
  })

  it('段内形态 > a $$b$$ c：行内规则吃裸行，坐标折算前缀', () => {
    const text = '> a $$b$$ c'
    const out = scan(text)
    expect(out).toHaveLength(1)
    expect(out[0]!.kind).toBe('block')
    expect(text.slice(out[0]!.from, out[0]!.to)).toBe('$$b$$')
  })

  it('行内公式路径不动：> a $x$ b 仍按原行扫描命中（坐标含前缀偏移）', () => {
    const text = '> a $x$ b'
    const out = scan(text)
    expect(out).toHaveLength(1)
    expect(out[0]!.kind).toBe('inline')
    expect(out[0]!.tex).toBe('x')
    expect(text.slice(out[0]!.from, out[0]!.to)).toBe('$x$')
    expect(out[0]!.lineMap).toEqual([]) // 行内命中无跨行映射
  })

  it('2/3 层前缀与 > 无空格形态同样识别；tex 剥同层数前缀、保留其余缩进', () => {
    expect(scan('> > $$\n> > x\n> > $$')[0]!.tex).toBe('\nx\n')
    expect(scan('>>>$$\n>>>x\n>>>$$')[0]!.tex).toBe('\nx\n')
    // 前缀后的内容缩进保留（与 markdown-it-katex content 口径一致）
    expect(scan('> $$\n>   indented\n> $$')[0]!.tex).toBe('\n  indented\n')
  })

  it('内容行层数多于开启行：剥开启层数后的剩余（含 >）原样进 tex（嵌套引用语义）', () => {
    expect(scan('> $$\n> > x\n> $$')[0]!.tex).toBe('\n> x\n')
  })

  it('容器断开不终止块：无前缀内容行原样进 tex（与 markdown-it-katex 跨容器贪婪一致）', () => {
    // 插件实现是 src 级匹配：引用内开块后跨引用边界吃到闭合 $$，断开行不剥前缀
    const out = scan('> $$\nx\n> $$')
    expect(out).toHaveLength(1)
    expect(out[0]!.tex).toBe('\nx\n')
    expect(out[0]!.lineMap).toEqual([
      { contentOffset: 0, lineStart: 0, prefixLen: 4 },
      { contentOffset: 1, lineStart: '> $$\n'.length, prefixLen: 0 },
      { contentOffset: 3, lineStart: '> $$\nx\n'.length, prefixLen: 2 },
    ])
  })

  it('未闭合引用内块不产出（稳定降级为源码）', () => {
    expect(scan('> $$\n> x')).toEqual([])
    expect(scan('> $$ x')).toEqual([])
  })

  it('闭合行前缀层数多于开启行：剥开启层数后行内 $$ 仍闭合（含 > 的段进 tex）', () => {
    // '> > $$' 剥 1 层剩 '> $$'：行内含 $$ 即闭合候选（与现状「行内任意 $$ 可
    // 闭合」同构），闭合段是 '> '——与 fence 的纯闭合行判定不同源，各自对齐
    // 对应 Reading 引擎（math=插件贪婪 / fence=CommonMark 核心）
    const out = scan('> $$\n> > $$\n> $$')
    expect(out).toHaveLength(1)
    expect(out[0]!.tex).toBe('\n> ')
    // 行3 的裸 $$ 不再开新块配对（已闭合后的普通行，无开启态）
    expect(scan('> $$\n> > $$\n> $$\n> x\n> $$')).toHaveLength(2)
  })

  it('空内容单行 > $$ $$ 与 > $$$$ 按原文降级不产出（既有口径随前缀平移）', () => {
    expect(scan('> $$  $$')).toEqual([])
    expect(scan('> $$$$')).toEqual([])
  })

  it('firstLineStart 基值平移引用内块区间（增量窗口直驱）', () => {
    const out = scanMathRanges(['> $$', '> x', '> $$'], 100)
    expect(out).toHaveLength(1)
    expect(out[0]!.from).toBe(100 + 2)
    expect(out[0]!.to).toBe(100 + '> $$\n> x\n> $$'.length)
  })
})

describe('多行输入与 offset 基值', () => {
  it('firstLineStart 基值平移全部区间', () => {
    const out = scanMathRanges(['$$', 'x', '$$'], 100)
    expect(out).toHaveLength(1)
    expect(out[0]!.from).toBe(100)
    expect(out[0]!.to).toBe(100 + '$$\nx\n$$'.length)
  })

  it('首行即块中段（上方未闭合）时不产出错误配对', () => {
    // 调用方只传入行窗口：窗口首行已在块内时，扫描以非块态起步，
    // 不得把窗口内的闭合定界符误配为新的块开始
    const out = scanMathRanges(['y $$', '后文 $a$'], 0)
    expect(out).toEqual([{ kind: 'inline', from: 8, to: 11, tex: 'a', lineMap: [] }])
  })

  it('空输入与无 $ 文本零成本返回', () => {
    expect(scanMathRanges([], 0)).toEqual([])
    expect(scanMathRanges(['纯文本', '没有公式'], 0)).toEqual([])
  })
})

// #675（T07）：ContentLineMapEntry 折算的纯函数契约——裸内容 offset →
// 原文全文 offset。期望值按源文手算（段起点/段中/段尾/零长段/空表）。
describe('mapContentOffsetToDoc：lineMap 逐段折算（#675 T07）', () => {
  // 原文：`> $$\n> a+b\n> > c\n> $$`（块 depth=1；第三行剩一层 `> ` 属内容）
  // tex = '\na+b\n> c\n'，lineMap 段（手算）：
  //   开行余段 ''：contentOffset=0,  lineStart=0,  prefixLen=4（`> $$` 后即段尾）
  //   a+b 行：     contentOffset=1,  lineStart=5,  prefixLen=2
  //   > c 行：     contentOffset=5,  lineStart=11, prefixLen=2（剩 `> ` 入内容）
  //   闭行前段 ''：contentOffset=9,  lineStart=16, prefixLen=2
  const LM = scanMathRanges(['> $$', '> a+b', '> > c', '> $$'], 0)[0]!.lineMap

  it('段内 offset 折算（含保留的嵌套 > 前缀与内容缩进的越过量）', () => {
    // tex offset 1 = 'a'（a+b 行段首）→ 原文 5+2=7（行首 `> ` 之后）
    expect(mapContentOffsetToDoc(LM, 1)).toBe(7)
    // tex offset 3 = '+' → 原文 9
    expect(mapContentOffsetToDoc(LM, 3)).toBe(9)
    // 第三行段首 offset 5 = '>'（保留前缀入内容）→ 原文 13
    expect(mapContentOffsetToDoc(LM, 5)).toBe(13)
  })

  it('段尾 offset 属本段（不落入下一段——段间由 \n 分隔）', () => {
    // tex offset 4 = 'b'（a+b 段尾）→ 原文 10；offset 5 已是下一段
    expect(mapContentOffsetToDoc(LM, 4)).toBe(10)
    expect(mapContentOffsetToDoc(LM, 5)).not.toBe(10)
  })

  it('零长段（空内容行）不劫持后续 offset', () => {
    // `>\n` 行：剥 depth=1 层后 consumed=''，零长段；其后 offset 属下一段
    const lm = scanMathRanges(['> $$', '>', '> x', '> $$'], 0)[0]!.lineMap
    // 段序列：''(开行余), ''(空行), 'x'；tex='\n\nx\n'
    // 'x' 段 contentOffset=2 → 折算到第三行 `> x` 的 x 处 = 行首+2
    const thirdLineStart = '> $$\n>\n'.length
    expect(mapContentOffsetToDoc(lm, 2)).toBe(thirdLineStart + 2)
  })

  it('空 lineMap（行内命中/空内容）返回 -1（调用方按不可折算丢弃）', () => {
    expect(mapContentOffsetToDoc([], 0)).toBe(-1)
  })

  it('FenceSpan.lineMap（mermaid 侧同语义）逐行折算一致', () => {
    // 手算：`> ```js`(7字符) + 换行 + `> const a = 1`(13字符) + 换行 +
    // `> const bb = 2` + 换行 + `> ```；code='const a = 1' + LF + 'const bb = 2'，
    // 段1 contentOffset=0/lineStart=8/prefixLen=2，
    // 段2 contentOffset=12/lineStart=22/prefixLen=2
    const spans = scanFencesDetailed(['> ```js', '> const a = 1', '> const bb = 2', '> ```'], 0).spans
    expect(spans).toHaveLength(1)
    const lm = spans[0]!.lineMap
    // code offset 0（'c'）→ 第二行行首+2
    expect(mapContentOffsetToDoc(lm, 0)).toBe(8 + 2)
    // code offset 12（第二行 'c'）→ 第三行行首+2
    expect(mapContentOffsetToDoc(lm, 12)).toBe(22 + 2)
    // code offset 10（第一段尾 '1'）→ 第二行的 '1'
    expect(mapContentOffsetToDoc(lm, 10)).toBe(8 + 2 + 10)
    // code offset 11 = 段间换行符本身：归前段（折到该行行尾 8+2+11=21，
    // 第二行长 13 → 行内 13 即行尾）；段 2 自 contentOffset=12 起
    expect(mapContentOffsetToDoc(lm, 11)).toBe(21)
  })
})
