// 行内 HTML 片段边界契约（#568/T03）：行内片段事实源（shared/htmlInline）
// 的识别与配对矩阵——成对嵌套、自闭合/空元素、未闭合、孤立闭标签、转义
// 尖括号、含引号属性、跨行不成片段、代码/HTML 块上下文天然排除；两端
// 对拍（Lezer HTMLTag 树派生 ↔ markdown-it vsidian_inline_html 规则的
// 真实 token 产物）对同一文本必须产出同一片段序列（规格「两端核对过的
// 解析规则，不用正则猜测嵌套范围」——token 级标签语法识别是两端解析器
// 自身的规则，配对范围由栈派生）。
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { Text } from '@codemirror/state'
import { docInput, markdownTreeParser, frontmatterRange } from '../../src/shared/markdownDoc'
import {
  inlineHtmlFragmentsOfTree,
  matchHtmlTagAt,
  matchInlineHtmlFragmentAt,
  type HtmlInlineFragment,
} from '../../src/shared/htmlInline'
import { topLevelHtmlBlockSpansOfTree } from '../../src/shared/htmlBlock'
import { createMarkdownRenderer } from '../../src/webview/readingMarkdown'

/** Lezer 侧：树派生的行内片段（绝对 offset；frontmatter 区内的树产物
 *  按发射层同款排除——头区不产正文装饰） */
function lezerFragments(text: string): HtmlInlineFragment[] {
  const doc = Text.of(text.split('\n'))
  const tree = markdownTreeParser.parse(docInput(doc))
  const fm = frontmatterRange(text)
  return inlineHtmlFragmentsOfTree(tree, doc)
    .filter((f) => fm === null || f.from >= fm.end)
}

/** markdown-it 侧：**真实解析管线**（vsidian_inline_html 规则的生产消
 *  费面）产出的片段 token 内容序列——块/行内/tokenizer 的层间边界全部
 *  走真实链（html_block 区域不进行内解析、代码 span 先行消费、表格格
 *  内重解析同产）。前置形态镜像 splitReadingBlocks 的 frontmatter 先行
 *  整块提取（头区等长空白——不进行内解析；语料不含 HTML 注释） */
function mdRuleFragments(text: string): string[] {
  const fm = frontmatterRange(text)
  const parseText = fm
    ? text.slice(0, fm.start) + ' '.repeat(fm.end - fm.start) + text.slice(fm.end)
    : text
  const md = createMarkdownRenderer()
  const tokens = md.parse(parseText, {} as never)
  const out: string[] = []
  const walk = (list: Array<{ type: string; content: string; children?: unknown }>): void => {
    for (const token of list) {
      if (token.type === 'vsidian_inline_html') {
        out.push(token.content)
      }
      if (Array.isArray(token.children)) {
        walk(token.children as Array<{ type: string; content: string; children?: unknown }>)
      }
    }
  }
  walk(tokens as Array<{ type: string; content: string; children?: unknown }>)
  return out
}

const CASES: Array<{ name: string; text: string; want: Array<[number, number]> | null }> = [
  {
    name: '成对 span（含 style 属性）：一个片段覆盖开标签到闭标签',
    text: 'text <span style="color:red">red</span> after',
    want: null, // 期望按切片断言
  },
  {
    name: '嵌套成对：最外层片段（内层被包含，不独立成片段）',
    text: 'nested <span style="color:red">a<b>bi</b>c</span> end',
    want: null,
  },
  {
    name: '兄弟片段互不合并',
    text: 'a <u>u</u> b <b><i>bi</i></b> c',
    want: null,
  },
  {
    name: '同名嵌套：最外层',
    text: 'same <span><span>n</span></span> tail',
    want: null,
  },
  {
    name: '空元素与自闭合：单标签即片段',
    text: 'br test<br>next<br/>self<span/>after',
    want: null,
  },
  {
    name: 'void 元素 img/wbr：单标签即片段',
    text: 'auto <img src="x.png"> tail <wbr> odd',
    want: null,
  },
  {
    name: '未闭合：不成交换（源码字面降级）',
    text: 'unclosed <span style="color:red">tail',
    want: [],
  },
  {
    name: '孤立闭标签：不成片段',
    text: 'orphan </span> text',
    want: [],
  },
  {
    name: '转义尖括号（Entity）：不识别',
    text: 'esc &lt;span&gt; x',
    want: [],
  },
  {
    name: '含单双引号混合属性：成片段',
    text: 'q <span data-x="q \'v\'">attr</span> t',
    want: null,
  },
  {
    name: '未加引号属性：成片段',
    text: 'bare <span data-x=bare>x</span> attr',
    want: null,
  },
  {
    name: '大写标签名与带空格闭标签：大小写不敏感配对；孤立闭不成片段',
    text: 'up <SPAN STYLE="color:red">x</SPAN> and </SPAN > sp',
    want: null,
  },
  {
    name: '错位配对（b 先闭）：b 片段成立，内层 span 被吸收',
    text: 'mix <b><span></b></span> t',
    want: null,
  },
  {
    name: '链接片段（href 属性）',
    text: 'a <a href="https://x.y">link</a> b',
    want: null,
  },
  {
    name: '行内代码中的标签：不成片段（解析器先行消费）',
    text: 'code `<span>` tail',
    want: [],
  },
  {
    name: '跨行配对：不成片段（单行成型边界）',
    text: 'mid <span style="color:red">a\nb</span> tail',
    want: [],
  },
  {
    name: '标题上下文：成片段',
    text: '# head <span style="color:red">x</span> t',
    want: null,
  },
  {
    name: 'Setext 标题上下文：成片段',
    text: 'setext <span style="color:red">x</span>\n===',
    want: null,
  },
  {
    name: '引用内段落：成片段（行内路径不适用容器排除——与块级边界不同）',
    text: '> quote <span style="color:red">q</span> tail',
    want: null,
  },
  {
    name: '列表项内：成片段',
    text: '- item <u>i</u> tail',
    want: null,
  },
  {
    name: '表格格内：成片段',
    text: '| a | b |\n|---|---|\n| <span style="color:red">x</span> | y |',
    want: null,
  },
  {
    name: '块级 HTML 区域内无行内片段（块内行内归块，不重复显形）',
    text: '段落。\n\n<div>\n  <span style="color:red">块内</span>\n</div>\n\n尾段 <u>x</u>',
    want: null,
  },
]

describe('行内 HTML 片段：识别与配对矩阵（两端一致）', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const lezer = lezerFragments(c.text)
      // 两端对拍：片段源文序列一致（md 侧是真实解析管线的 token 内容，
      // Lezer 侧是树派生区间的源文切片——序列即文档序）
      expect(mdRuleFragments(c.text)).toEqual(lezer.map((f) => c.text.slice(f.from, f.to)))
      // 切片起止必须是标签边界（from 为 '<'，to 前一字符为 '>'）
      for (const f of lezer) {
        expect(c.text.slice(f.from, f.from + 1)).toBe('<')
        expect(c.text.slice(f.to - 1, f.to)).toBe('>')
      }
      if (c.want !== null) {
        expect(lezer.map((f) => [f.from, f.to] as [number, number])).toEqual(c.want)
      }
    })
  }

  it('切片内容抽验：片段文本与源文一致（含完整开闭标签）', () => {
    const text = 'a <span style="color:red">r</span> b <u>u</u> c'
    const frags = lezerFragments(text)
    expect(text.slice(frags[0]!.from, frags[0]!.to)).toBe('<span style="color:red">r</span>')
    expect(text.slice(frags[1]!.from, frags[1]!.to)).toBe('<u>u</u>')
  })

  it('块内行内归块：行内片段与顶层块事实源区间不重叠', () => {
    const text = [
      '段落 <u>行内</u>。',
      '',
      '<div>',
      '  块内 <span style="color:red">内容</span>',
      '</div>',
      '',
      '尾段 <span style="color:red">x</span>。',
    ].join('\n')
    const doc = Text.of(text.split('\n'))
    const tree = markdownTreeParser.parse(docInput(doc))
    const blocks = topLevelHtmlBlockSpansOfTree(tree)
    const inlines = inlineHtmlFragmentsOfTree(tree, doc)
    expect(blocks).toHaveLength(1)
    for (const f of inlines) {
      for (const b of blocks) {
        const overlap = f.from < b.to && f.to > b.from
        expect(overlap).toBe(false)
      }
    }
    // 行内片段只在块外的两个段落里
    expect(inlines).toHaveLength(2)
  })

  it('独占行带内容的 span 走行内路径；纯标签独占行走块路径（类型 7）——边界由解析器界定',
    () => {
      // 独占行但开标签后有内容（非「仅标签 + 空白」）→ 不满足类型 7 → 行内
      const withContent = lezerFragments('<span style="color:red">x</span>')
      expect(withContent).toHaveLength(1)
      // 开标签独占一行（其后仅换行）→ 类型 7 HTMLBlock → 块路径（无行内片段）
      const tagAlone = lezerFragments('<span class="c">\nx</span> tail')
      expect(tagAlone).toHaveLength(0)
      // 前后文字同行 → 行内
      const mixed = lezerFragments('前 <span style="color:red">x</span> 后')
      expect(mixed).toHaveLength(1)
    })

  it('#576 评审 P2-6：片段内的反斜杠 escape 不吞闭标签（Lezer 把 \\< 组合成 Escape 吞掉 </span> 的 <，树配对遗漏闭标签而两端原始语法一致）', () => {
    const text = 'a <span style="color:red">\\</span> tail'
    const lezer = lezerFragments(text)
    expect(lezer.map((f) => text.slice(f.from, f.to))).toEqual(['<span style="color:red">\\</span>'])
    // 两端对拍：Reading 生产管线同产完整片段
    expect(mdRuleFragments(text)).toEqual(['<span style="color:red">\\</span>'])
  })

  it('#576 二轮复审 P2：HTML 内的反引号不污染后续候选（span 先消费——内部反引号是字面，其后 b 正常渲染）', () => {
    const text = 'a <span>`</span> <b>x</b> ` tail'
    const want = ['<span>`</span>', '<b>x</b>']
    expect(lezerFragments(text).map((f) => text.slice(f.from, f.to))).toEqual(want)
    expect(mdRuleFragments(text)).toEqual(want)
  })

  it('#576 二轮复审 P2：HTML 内反引号与后续反引号配对成行内代码（b 是代码字面非片段）', () => {
    const text = 'a <span>`</span> `<b>x</b>` tail'
    const want = ['<span>`</span>']
    expect(lezerFragments(text).map((f) => text.slice(f.from, f.to))).toEqual(want)
    expect(mdRuleFragments(text)).toEqual(want)
  })

  it('#576 评审 P2-6 边界：HTML 外部的转义开标签不成片段（真正的外部 escape 排除保持）', () => {
    // \\< 的 < 被 escape 吞——不是行内 HTML 起点，两端一致降级为字面
    expect(lezerFragments('a \\<span>x\\</span> b')).toEqual([])
    expect(mdRuleFragments('a \\<span>x\\</span> b')).toEqual([])
  })
})

describe('matchHtmlTagAt：token 级标签语法（CommonMark 原始 HTML 标签形态）', () => {
  it('合法开标签（含属性）/闭标签/自闭合', () => {
    const openTag = '<span style="color:red">'
    expect(matchHtmlTagAt(openTag, 0, openTag.length)).toEqual({
      end: openTag.length, name: 'span', kind: 'open',
    })
    expect(matchHtmlTagAt('</span>', 0, 7)).toEqual({ end: 7, name: 'span', kind: 'close' })
    expect(matchHtmlTagAt('</SPAN >', 0, 8)).toEqual({ end: 8, name: 'span', kind: 'close' })
    expect(matchHtmlTagAt('<br/>', 0, 5)).toEqual({ end: 5, name: 'br', kind: 'atomic' })
    expect(matchHtmlTagAt('<br />', 0, 6)).toEqual({ end: 6, name: 'br', kind: 'atomic' })
    // void 元素无斜杠也是原子片段（不配对）
    const imgTag = '<img src="x.png">'
    expect(matchHtmlTagAt(imgTag, 0, imgTag.length)).toEqual({
      end: imgTag.length, name: 'img', kind: 'atomic',
    })
    const bareTag = '<span data-x=bare>'
    expect(matchHtmlTagAt(bareTag, 0, bareTag.length)).toEqual({
      end: bareTag.length, name: 'span', kind: 'open',
    })
    const quoteTag = `<span data-x="q 'v'">`
    expect(matchHtmlTagAt(quoteTag, 0, quoteTag.length)).toEqual({
      end: quoteTag.length, name: 'span', kind: 'open',
    })
  })

  it('非法形态返回 null（留给默认链处理）', () => {
    expect(matchHtmlTagAt('<1a>', 0, 4)).toBeNull()
    expect(matchHtmlTagAt('< span>', 0, 7)).toBeNull()
    expect(matchHtmlTagAt('<span', 0, 5)).toBeNull() // 未闭合语法
    expect(matchHtmlTagAt('<span x=>', 0, 9)).toBeNull() // 属性值缺失
    expect(matchHtmlTagAt('</span x>', 0, 9)).toBeNull() // 闭标签不带属性
    expect(matchHtmlTagAt('x<span>', 0, 7)).toBeNull() // pos 不在 '<'
  })

  it('limit 边界：标签越出 limit 不识别（单行成型边界）', () => {
    expect(matchHtmlTagAt('<span>', 0, 3)).toBeNull()
    expect(matchHtmlTagAt('<span>', 0, 6)).toEqual({ end: 6, name: 'span', kind: 'open' })
  })
})

describe('matchInlineHtmlFragmentAt：markdown-it 规则驱动面', () => {
  it('完整片段返回终点；不成型返回 null', () => {
    const src = 'a <span style="color:red">r</span> b'
    expect(matchInlineHtmlFragmentAt(src, 2)).toBe(src.indexOf('</span>') + 7)
    expect(matchInlineHtmlFragmentAt(src, 0)).toBeNull()
    expect(matchInlineHtmlFragmentAt('unclosed <span style="color:red">tail', 9)).toBeNull()
    expect(matchInlineHtmlFragmentAt('br<br>next', 2)).toBe(6) // 原子单标签（<br> 四字符）
  })

  it('跨行扫描以首段行为界（src 含换行时开标签后的换行即终止）', () => {
    const src = '<span style="color:red">a\nb</span> tail'
    expect(matchInlineHtmlFragmentAt(src, 0)).toBeNull()
  })
})
