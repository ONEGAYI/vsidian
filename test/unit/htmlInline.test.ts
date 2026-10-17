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
import { maskCodeSpanPipes } from '../../src/shared/tableCells'

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
 *  整块提取（头区等长空白——不进行内解析；语料不含 HTML 注释）与表格
 *  code span 管道遮蔽（shared/tableCells 的 maskCodeSpanPipes 同一实现
 *  ——裸 parser 的表格规则先于 inline code 切格，生产管线靠遮蔽保护；
 *  产物切片还原原字）。 */
const MD_PIPE_MASK = String.fromCharCode(0xe000)
function mdRuleFragments(text: string): string[] {
  const fm = frontmatterRange(text)
  const fmMasked = fm
    ? text.slice(0, fm.start) + ' '.repeat(fm.end - fm.start) + text.slice(fm.end)
    : text
  const parseText = fmMasked.split('\n').map((l) => maskCodeSpanPipes(l, MD_PIPE_MASK)).join('\n')
  const md = createMarkdownRenderer()
  const tokens = md.parse(parseText, {} as never)
  const out: string[] = []
  const walk = (list: Array<{ type: string; content: string; children?: unknown }>): void => {
    for (const token of list) {
      if (token.type === 'vsidian_inline_html') {
        out.push(token.content.split(MD_PIPE_MASK).join('|'))
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
  // ---- #576 三轮复审 P2-1：跨行 code span 状态（行内容器内维持，两端一致）----
  {
    name: '跨行 code span：行 2 的 span 是代码字面（容器内状态维持）',
    text: 'a `start\n<span>x</span> end` z',
    want: [],
  },
  {
    name: '引用内跨行 code span：同样字面',
    text: '> a `start\n> <span>x</span> end` z',
    want: [],
  },
  {
    name: 'Setext 标题容器内的跨行 code span：同样字面',
    text: 'a `x\n<span>y</span>` z\n===',
    want: [],
  },
  {
    name: '反引号开串与闭串隔行：中间行的 span 是字面（状态跨两行传播）',
    text: 'a `open\n<span>x</span>\nmore` end',
    want: [],
  },
  {
    name: 'code span 跨行闭合后：同容器后续片段正常（状态不泄漏到闭合之后）',
    text: 'a `x\ny` <span>ok</span>',
    want: null,
  },
  {
    name: '容器边界重置状态：下一段落的片段不受前段未闭合串影响',
    text: 'a `open\n\n<span>ok</span>',
    want: null,
  },
  // ---- #576 三轮复审 P2-2：缩进代码（行首点查不到缩进后才开始的块）----
  {
    name: '缩进代码内的 span：字面（块起点在缩进之后）',
    text: '    a <span>x</span>',
    want: [],
  },
  {
    name: '引用内缩进代码：同样字面',
    text: '>     a <span>x</span>',
    want: [],
  },
  // ---- #576 三轮复审 P2-3：非正文上下文（链接标题/引用定义/行内注释/PI/声明/CDATA）----
  {
    name: '链接标题内的 span：字面（title 是字面串，不内解析）',
    text: 'a [label](target "t <span>x</span>") z',
    want: [],
  },
  {
    name: '引用定义行：label 与 title 均字面（定义被块级消费，不产正文内容）',
    text: '[label]: /url "t <span>x</span>"\n\n[<span>x</span>]: /url2',
    want: [],
  },
  {
    name: '行内注释内的 span：字面（注释是单个原始 HTML token）',
    text: 'a <!-- <span>x</span> --> b',
    want: [],
  },
  {
    name: '跨行行内注释内的 span：字面（注释 token 可跨行）',
    text: 'a <!-- x\ny <span>x</span> --> b',
    want: [],
  },
  {
    name: 'PI/声明/CDATA 内的 span：字面（单 token 消费到各自闭串）',
    text: 'a <? <span>x</span> ?> b <!DOCTYPE f <span>y</span>> c <![CDATA[ <span>z</span> ]]> d',
    want: [],
  },
  {
    name: '对照组：链接 label 内的 span 正常成片段（label 是内联内容）',
    text: 'a [<span>x</span>](t) z',
    want: null,
  },
  {
    name: '对照组：破坏的尖括号目的地（两端都不成链接）——span 正常成片段',
    text: 'a [label](<t <span>x</span>) z',
    want: null,
  },
  // ---- #576 四轮复审 P2-2：PI 结束位置（真实闭串长度）----
  {
    name: 'PI 紧邻标签：PI 后紧跟的 span 正常成片段（闭串 ?> 为两字符）',
    text: 'a <?ok?><span>x</span> z',
    want: null,
  },
  {
    name: 'PI 带空格紧邻标签（对照）',
    text: 'a <?ok?> <span>x</span> z',
    want: null,
  },
  {
    name: 'PI 闭在容器末：下一行的 span 不被吞（跨行不越界）',
    text: 'a <?x?>\n<span>y</span>',
    want: null,
  },
  {
    name: '未闭合 PI：字面继续——其后的 span 正常成片段（两端一致）',
    text: 'a <?ok <span>x</span> z',
    want: null,
  },
  // ---- #576 四轮复审 P2-3：非正文区反引号不参与正文配对（扫描期跳过，非事后过滤）----
  {
    name: '链接 title 内的反引号是字面：title 后的 span 正常成片段',
    text: 'a [label](url "`") <span>x</span> ` z',
    want: null,
  },
  {
    name: '尖括号目的地内的反引号是字面：其后的 span 正常成片段',
    text: 'a [l](<a`b>) <span>y</span> ` z',
    want: null,
  },
  {
    name: '裸目的地内的反引号是字面：其后的 span 正常成片段',
    text: 'a [l](a`b) <span>y</span> ` z',
    want: null,
  },
  {
    name: 'autolink 内的反引号是字面：其后的 span 正常成片段',
    text: 'a <https://x`y> <span>z</span> ` t',
    want: null,
  },
  // ---- #576 五轮复审 P2-1：孤岛行（ATX 标题/表格格）同样接入字面区 ----
  {
    name: '#576 五轮 P2-1：ATX 标题内链接 title 反引号是字面——其后 span 成片段（孤岛行字面区）',
    text: '# a [label](url "`") <span>x</span> ` z',
    want: null,
  },
  {
    name: '#576 五轮 P2-1：表格格内链接 title 反引号是字面——格内 span 成片段（孤岛行字面区）',
    text: '| a [l](url "`") <span>x</span> ` z | b |\n| --- | --- |',
    want: null,
  },
  // ---- #576 五轮复审 P2-2：HTML 片段内部的 Markdown 伪上下文不否决已成型片段 ----
  {
    name: '#576 五轮 P2-2：片段内部的链接伪 title 不否决片段（md-it 位置序先消费 span 到首个闭标签，树把片段内部文本误标 LinkTitle——只认片段起点上下文）',
    text: 'a <span>[label](url "</span>") <b>x</b> z',
    want: null,
  },
  // ---- #576 六轮复审 P2-1：伪字面区跨出已消费 HTML 后不吞后续正文 ----
  {
    name: '#576 六轮 P2-1：片段消费越过后，与其相交的伪 LinkTitle 失效——后续 b 正常成片段（链接开界已被 HTML 消费覆盖，链接从未成立）',
    text: 'a <span>[x](url "</span> <b>y</b>")',
    want: null,
  },
  // ---- #576 六轮复审 P2-2：孤岛行按 TableCell 边界配对，不跨格拼片段 ----
  {
    name: '#576 六轮 P2-2：开闭标签分处两格——各格字面不成片段（Reading 两格各自字面）',
    text: '| <span>x | y</span> |\n| --- | --- |',
    want: [],
  },
  {
    name: '#576 六轮 P2-2 负控：同格成对片段正常（格内配对不受分段影响）',
    text: '| a <span>x</span> b | <b>c</b> |\n| --- | --- |',
    want: null,
  },
  {
    name: '#576 六轮 P2-2 负控：转义管道不分割格——格内片段正常',
    text: '| a \\| b <span>x</span> | c |\n| --- | --- |',
    want: null,
  },
  {
    name: '#576 六轮 P2-2 负控：两格各自独立片段',
    text: '| <span>x</span> | <span>y</span> |\n| --- | --- |',
    want: null,
  },
  // ---- #576 六轮复审 P2-3：片段配对按 HTML 词法跳过非元素 token ----
  {
    name: '#576 六轮 P2-3：注释内的同名开标签不参与嵌套深度（外层 span 正常闭合，片段含注释原文）',
    text: 'a <span><!-- <span> -->x</span> z',
    want: [[2, 31]],
  },
  {
    name: '#576 六轮 P2-3：注释内的同名闭标签不闭合外层（片段到真闭标签，含注释原文）',
    text: 'a <span><!-- </span> -->x</span> z',
    want: [[2, 32]],
  },
  {
    name: '#576 六轮 P2-3：PI 内的标签同理是字面（非元素 token 整体跳过）',
    text: 'a <span><?pi <span> ?>x</span> z',
    want: [[2, 30]],
  },
  // ---- #576 七轮复审 P2-1：宿主链接开界被吞则整个链接上下文失效 ----
  {
    name: '#576 七轮 P2-1：HTML 吞掉链接 `[` 开界——链接从未成立，其 title 不是字面区（后续 b 正常成片段）',
    text: 'a <span>[x</span>](url "<b>y</b>")',
    want: null,
  },
  {
    name: '#576 七轮 P2-1 负控：真链接 label 内的 HTML 不破坏链接——title 仍是字面区（i 不成片段）',
    text: 'a [l <b>x</b>](url "<i>y</i>") t',
    want: null,
  },
  // ---- #576 七轮复审 P2-2：格边界沿用 protectCodePipes 口径（code span 内管道不切格）----
  {
    name: '#576 七轮 P2-2：code span 内管道不切格——同格完整 span 不被截断（裸 Lezer TableCell 会切在 span 管道处）',
    text: '| a | b |\n| --- | --- |\n| <span>x `|` y</span> | z |',
    want: [[26, 46]],
  },
  // ---- #576 八轮复审 P2-1：链接成立性按真实 HTML 消费顺序判定（占位重解析事实源）----
  {
    name: '#576 八轮 P2-1a：HTML 吞掉链接闭界与目的地（开界 `[` 在片段外）——链接从未成立，title 不是字面区（b 正常成片段）',
    text: 'a [x <span>](url "</span> <b>y</b>")',
    want: [[5, 25], [26, 34]],
  },
  {
    name: '#576 八轮 P2-1b：真实成立的外层链接（HTML 只在 label 内、闭界未吞）——title 是字面区（b 不成片段；Lezer 内层伪 `[` 不得当宿主）',
    text: 'a [l <span>[x</span>](https://example.test "<b>no</b>")',
    want: [[5, 20]],
  },
  // ---- #576 八轮复审 P2-2：表格字面区来自生产同源解析（mask 护格界 + 格内占位重解析）----
  {
    name: '#576 八轮 P2-2：真实链接 title 内反引号+管道——格界受 mask 保护，title 反引号不与格末配对成 code span（b 正常成片段）',
    text: '| a | b |\n| --- | --- |\n| [x](https://example.test "`|") <b>y</b> ` | z |',
    want: [[57, 65]],
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
