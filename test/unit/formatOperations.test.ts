import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import { isInlineFormatOp, planFormatOperation, planFormatOperationRanges } from '../../src/webview/formatOperations'

function apply(text: string, op: Parameters<typeof planFormatOperation>[1], from: number, to = from,
  region?: Parameters<typeof planFormatOperation>[3], action?: Parameters<typeof planFormatOperation>[4]) {
  const plan = planFormatOperation(text, op, { from, to }, region, action)
  if (!plan) return { text, selection: null }
  let next = text
  for (const change of [...plan.changes].reverse()) {
    next = next.slice(0, change.from) + change.insert + next.slice(change.to)
  }
  return { text: next, selection: plan.selection }
}

describe('格式操作的文本契约', () => {
  it('中文、中英混排及词边界：光标优先右词，行末取左词', () => {
    expect(apply('中文 English', 'bold', 0).text).toBe('**中文** English')
    expect(apply('中文 English', 'bold', 3).text).toBe('中文 **English**')
    expect(apply('中文 English', 'bold', 10).text).toBe('中文 **English**')
  })

  it('无选区包裹单词后光标落在开围栏内侧，再次切换取消而非叠加', () => {
    expect(apply('word', 'bold', 0)).toEqual({ text: '**word**', selection: { anchor: 2 } })
    expect(apply('word', 'italic', 0)).toEqual({ text: '*word*', selection: { anchor: 1 } })
    expect(apply('word', 'strikethrough', 0)).toEqual({ text: '~~word~~', selection: { anchor: 2 } })
    expect(apply('word', 'inlineCode', 0)).toEqual({ text: '`word`', selection: { anchor: 1 } })
    expect(apply('中文 English', 'bold', 0)).toEqual({ text: '**中文** English', selection: { anchor: 2 } })
    expect(apply('中文 English', 'bold', 10)).toEqual({ text: '中文 **English**', selection: { anchor: 5 } })
    expect(apply('word', 'bold', 2)).toEqual({ text: '**word**', selection: { anchor: 2 } })
    expect(apply('- word', 'bold', 2)).toEqual({ text: '- **word**', selection: { anchor: 4 } })
    const wrapped = apply('word', 'bold', 0)
    expect(apply(wrapped.text, 'bold', wrapped.selection!.anchor).text).toBe('word')
  })

  it('无选区在格式内取消整个段，有选区仅取消片段', () => {
    expect(apply('**编辑文字**', 'bold', 4).text).toBe('编辑文字')
    expect(apply('**编辑文字**', 'bold', 3, 5).text).toBe('**编**辑文**字**')
  })

  it('后缀贴边两态：一按包裹携带光标定位，二按只拆光标所在对，三按复原（#107）', () => {
    // 一按：贴边扩词包裹，selection 落新开围栏内侧（旧实现被 rewrite 闭区间误吞）
    expect(apply('**加粗**普通', 'bold', 6))
      .toEqual({ text: '**加粗****普通**', selection: { anchor: 8 } })
    // 二按（光标在「普通」处）：只拆光标所在对，「加粗」一对保留，无 selection
    expect(apply('**加粗****普通**', 'bold', 8))
      .toEqual({ text: '**加粗**普通' })
    // 光标在「加粗」处：拆第一对，第二对保留
    expect(apply('**加粗****普通**', 'bold', 3))
      .toEqual({ text: '加粗**普通**' })
    // 一按后光标不动（贴边产物行尾）再按：拆最后一对
    expect(apply('**加粗****普通**', 'bold', 12))
      .toEqual({ text: '**加粗**普通' })
    // 三按：对二按产物再包裹，复原
    expect(apply('**加粗**普通', 'bold', 6))
      .toEqual({ text: '**加粗****普通**', selection: { anchor: 8 } })
  })

  it('混合名贴邻：光标在 A 围栏终点、右侧是异名围栏起点时，贴邻取消左侧（#107 审查修复）', () => {
    // 右向下降只进最右接触子树（右侧 StrongEmphasis 遮蔽，其内无 Emphasis 节点），
    // 左侧同名 Emphasis to===pos 零间隙贴邻须回探接管取消；
    // 旧行为取不到 active 误插空对，得坏文本 *em*****strong**
    // 取消 *em* 删 [0,1)+[3,4) 单星对，三连星余二归 strong 开标记
    expect(apply('*em***strong**', 'italic', 4)).toEqual({ text: 'em**strong**' })
    expect(new MarkdownIt().renderInline('em**strong**')).toBe('em<strong>strong</strong>')
    // 对称不回归：左侧异名、右侧同名贴邻仍右向命中取消（缝隙归右侧原则不变）
    expect(apply('**bold***em*', 'italic', 8)).toEqual({ text: '**bold**em' })
  })

  it('闭标记起点的归属：光标恰在合并形态第一对闭标记起点时拆右对（#107 右向归属钉住）', () => {
    // **加粗****普通** 的 **** 前半是加粗对的闭标记：光标 @4 落其起点，
    // 零宽缝隙归右——拆「普通」一对、「加粗」保留（文档化确定性行为，不改实现）
    expect(apply('**加粗****普通**', 'bold', 4)).toEqual({ text: '**加粗**普通' })
  })

  it('前缀贴边同规则：包裹产物同样两态化，拆对只动光标所在对（#107）', () => {
    expect(apply('文**后**', 'bold', 0))
      .toEqual({ text: '**文****后**', selection: { anchor: 2 } })
    expect(apply('**文****后**', 'bold', 2))
      .toEqual({ text: '文**后**' })
    expect(apply('**文****后**', 'bold', 6))
      .toEqual({ text: '**文**后' })
  })

  it('围栏开边界贴邻即取消：行首与行尾一按取消，不再落入空对插入（#107）', () => {
    expect(apply('**编辑文字**', 'bold', 0).text).toBe('编辑文字')
    expect(apply('**编辑文字**', 'bold', 8).text).toBe('编辑文字')
    expect(apply('*斜体*', 'italic', 0).text).toBe('斜体')
    expect(apply('*斜体*', 'italic', 4).text).toBe('斜体')
    expect(apply('`码`', 'inlineCode', 0).text).toBe('码')
    expect(apply('`码`', 'inlineCode', 3).text).toBe('码')
  })

  it('升级定界符（多反引号）围栏取消：光标在内容中整拆，不按单反引号误拆对（#107 审查修复）', () => {
    // inlineCode 定界符经 codeDelimiter 升级后，静态单 mark 扫描出的「对」内部
    // 无内容（``码`` 的 [0,1)+[1,2)）——非贴边合并形态，回退整节点摘除
    expect(apply('``码``', 'inlineCode', 2).text).toBe('码')
    expect(apply('```码```', 'inlineCode', 3).text).toBe('码')
  })

  it('内容含字面 mark 的偶数形态不走拆对：按整节点摘除（#107 审查修复）', () => {
    // *a*b*c* 解析为两个独立 Emphasis，光标在 a 命中第一对整拆；该形态
    // 永不进入拆对分支（钉住契约，防解析形态或扫描变化后误删中间区间）
    expect(apply('*a*b*c*', 'italic', 1).text).toBe('ab*c*')
  })

  it('贴边 add 与 toggle 同形：包裹携带 selection，不再产无定位粘连（#107）', () => {
    expect(apply('**加粗**普通', 'bold', 6, 6, undefined, 'add'))
      .toEqual({ text: '**加粗****普通**', selection: { anchor: 8 } })
  })

  it('斜体与行内代码贴边往返：合并形态按 mark 出现顺序配对拆分（#107）', () => {
    expect(apply('*斜体*普通', 'italic', 5))
      .toEqual({ text: '*斜体**普通*', selection: { anchor: 5 } })
    expect(apply('*斜体**普通*', 'italic', 5))
      .toEqual({ text: '*斜体*普通' })
    expect(apply('`码`文', 'inlineCode', 3))
      .toEqual({ text: '`码``文`', selection: { anchor: 4 } })
    expect(apply('`码``文`', 'inlineCode', 4))
      .toEqual({ text: '`码`文' })
  })

  it('删除线与高亮贴边往返：独立节点两态本就正确，一按携带 selection（#107 防回归）', () => {
    expect(apply('~~删除~~普通', 'strikethrough', 6))
      .toEqual({ text: '~~删除~~~~普通~~', selection: { anchor: 8 } })
    expect(apply('~~删除~~~~普通~~', 'strikethrough', 8))
      .toEqual({ text: '~~删除~~普通' })
    expect(apply('==亮==普通', 'highlight', 5))
      .toEqual({ text: '==亮====普通==', selection: { anchor: 7 } })
    expect(apply('==亮====普通==', 'highlight', 7))
      .toEqual({ text: '==亮==普通' })
  })

  it('贴边修复不改变通用空对插入与真重叠重写（#107 回归面）', () => {
    // 非贴边的取不到词场景仍插空对
    expect(apply('甲 乙', 'bold', 1)).toEqual({ text: '甲**** 乙', selection: { anchor: 3 } })
    // 有选区贴边：产物与旧实现同形（旧的 rewrite 退化局部包裹与 fresh-wrap 同产物）
    expect(apply('文**后**', 'bold', 0, 1).text).toBe('**文****后**')
    expect(apply('**前**后文', 'bold', 5, 7).text).toBe('**前****后文**')
    // 真重叠/半重叠仍走行级重写
    expect(apply('前**中**后', 'bold', 0, 7).text).toBe('**前中后**')
    expect(apply('**前**后', 'bold', 0, 6).text).toBe('**前后**')
    expect(apply('**前后**', 'bold', 2, 4).text).toBe('前后')
  })

  it('混合格式统一应用且不叠加标记；重复切换可还原', () => {
    expect(apply('**前**后', 'bold', 0, 6).text).toBe('**前后**')
    expect(apply('前**中**后', 'bold', 0, 7).text).toBe('**前中后**')
    expect(apply('**前后**', 'bold', 2, 4).text).toBe('前后')
    expect(apply('**前后**', 'bold', 0, 6).text).toBe('前后')
    expect(apply('**前中**后', 'bold', 3, 7).text).toBe('**前中后**')
  })

  it('底层添加与清除各自幂等', () => {
    expect(apply('**字**', 'bold', 2, 3, undefined, 'add').text).toBe('**字**')
    expect(apply('字', 'bold', 0, 1, undefined, 'remove').text).toBe('字')
    expect(apply('**字**', 'bold', 2, 3, undefined, 'remove').text).toBe('字')
    expect(apply('字', 'bold', 0, 1, undefined, 'add').text).toBe('**字**')
  })

  it('显式选区严格按选区，不吞相邻文字，跨段保留结构', () => {
    expect(apply('甲乙丙', 'italic', 1, 2).text).toBe('甲*乙*丙')
    expect(apply('# 标题\n\n- 列表', 'bold', 2, 9).text).toBe('# **标题**\n\n- **列**表')
  })

  it('空白插入成对标记并把光标置于中间；公式双链无选区也插入空结构', () => {
    expect(apply('甲 乙', 'inlineCode', 1)).toEqual({ text: '甲`` 乙', selection: { anchor: 2 } })
    expect(apply('', 'inlineMath', 0)).toEqual({ text: '$$', selection: { anchor: 1 } })
    expect(apply('', 'wikilink', 0)).toEqual({ text: '[[]]', selection: { anchor: 2 } })
  })

  it('代码块与行内代码中不写 Markdown 行内样式', () => {
    expect(apply('```\n正文\n```', 'bold', 5).text).toBe('```\n正文\n```')
    expect(apply('`正文`', 'bold', 2).text).toBe('`正文`')
  })

  it('标题同级不变，取消标题保留行内样式；列表与引用转换', () => {
    expect(apply('## **标题**', 'heading2', 5).text).toBe('## **标题**')
    expect(apply('## **标题**', 'headingNone', 5).text).toBe('**标题**')
    expect(apply('正文', 'bulletList', 1).text).toBe('- 正文')
    expect(apply('- 正文', 'taskList', 3).text).toBe('- [ ] 正文')
    expect(apply('正文', 'quote', 1).text).toBe('> 正文')
    expect(apply('- 正文', 'bulletList', 3).text).toBe('正文')
    expect(apply('- [x] 完成', 'taskList', 6).text).toBe('完成')
    expect(apply('> 正文', 'quote', 3).text).toBe('正文')
    expect(apply('标题\n====', 'headingNone', 1).text).toBe('标题')
    expect(apply('标题\n----', 'heading2', 1).text).toBe('标题\n----')
    expect(apply('标题\n----', 'heading3', 1).text).toBe('### 标题')
  })

  it('显式选区围栏精确包裹，前后文独立成段且文首尾无多余空行', () => {
    expect(apply('前中文后', 'codeBlock', 1, 3).text).toBe('前\n\n```\n中文\n```\n\n后')
    expect(apply('文字', 'codeBlock', 0, 2).text).toBe('```\n文字\n```')
    expect(apply('文字', 'blockMath', 0, 0).text).toBe('$$\n文字\n$$')
  })

  it('无选区按段落围栏，取消保留间隔；含反引号内容使用更长围栏', () => {
    expect(apply('前段\n\n后段', 'codeBlock', 1).text).toBe('```\n前段\n```\n\n后段')
    expect(apply('```\n前段\n```\n\n后段', 'codeBlock', 5).text).toBe('前段\n\n后段')
    expect(apply('a`b', 'codeBlock', 0, 3).text).toBe('```\na`b\n```')
    expect(apply('````\na```b\n````', 'codeBlock', 5).text).toBe('a```b')
    expect(apply('```\n前段\n```', 'codeBlock', 0, 10).text).toBe('前段')
  })

  it('列表和引用内围栏保留容器；表格单元格禁用块级围栏', () => {
    expect(apply('- 第一段', 'codeBlock', 4).text).toBe('- ```\n  第一段\n  ```')
    expect(apply('> 引用', 'blockMath', 3).text).toBe('> $$\n> 引用\n> $$')
    expect(apply('- ```\n  第一段\n  ```', 'codeBlock', 9).text).toBe('- 第一段')
    expect(apply('> $$\n> 引用\n> $$', 'blockMath', 7).text).toBe('> 引用')
    expect(apply('- $$\n  公式\n  $$', 'blockMath', 8).text).toBe('- 公式')
    const table = '| A | B |\n| --- | --- |\n| x | y |'
    expect(apply(table, 'codeBlock', table.indexOf('x')).text).toBe(table)
  })

  it('容器内显式选区仍只包裹文字，前后文留在同一容器', () => {
    expect(apply('- 前中文后', 'codeBlock', 3, 5).text)
      .toBe('- 前\n\n  ```\n  中文\n  ```\n\n  后')
    expect(apply('> 前中文后', 'blockMath', 3, 5).text)
      .toBe('> 前\n>\n> $$\n> 中文\n> $$\n>\n> 后')
    expect(apply('- 前甲\n  乙后', 'codeBlock', 3, 8).text)
      .toBe('- 前\n\n  ```\n  甲\n  乙\n  ```\n\n  后')
    expect(apply('> 前甲\n> 乙后', 'blockMath', 3, 8).text)
      .toBe('> 前\n>\n> $$\n> 甲\n> 乙\n> $$\n>\n> 后')
  })

  it('空段插入空结构并定位光标；块级公式再次操作可取消', () => {
    expect(apply('', 'codeBlock', 0)).toEqual({ text: '```\n\n```', selection: { anchor: 4 } })
    expect(apply('$$\n公式\n$$', 'blockMath', 4).text).toBe('公式')
  })

  it('表格矩形选区逐格应用，不改分隔符和其他列', () => {
    const table = '| A | B |\n| --- | --- |\n| x | y |'
    const region = { tableFrom: 0, rowFrom: 0, rowTo: 1, columnFrom: 0, columnTo: 0 }
    expect(apply(table, 'bold', table.indexOf('A'), table.indexOf('A'), region).text)
      .toBe('| **A** | B |\n| --- | --- |\n| **x** | y |')
  })

  it('清除行内格式保留段落，链接仅包裹选中文字', () => {
    expect(apply('# **粗体**与*斜体*', 'clearInline', 2, 13).text).toBe('# 粗体与斜体')
    expect(apply('**前中后**', 'clearInline', 3, 4).text).toBe('**前**中**后**')
    expect(apply('# **标题**\n\n- *列表*', 'clearInline', 2, 16).text)
      .toBe('# 标题\n\n- 列表')
    expect(apply('甲乙', 'link', 0, 2).text).toBe('[甲乙]()')
    expect(apply('[甲乙](目标)', 'link', 2).text).toBe('甲乙')
    expect(apply('a`b', 'inlineCode', 0, 3).text).toBe('``a`b``')
    expect(apply('``a`b`` and **bold**', 'clearInline', 14, 18).text)
      .toBe('``a`b`` and bold')
    expect(apply('``a`b`` and word', 'inlineCode', 12, 16).text)
      .toBe('``a`b`` and `word`')
  })

  it('局部取消多反引号代码时保留未选中字面反引号和代码内容', () => {
    const source = '``a`b``'
    const expected = 'a`` `b ``'
    expect(apply(source, 'inlineCode', 2, 3).text).toBe(expected)
    expect(apply(source, 'clearInline', 2, 3).text).toBe(expected)
    expect(new MarkdownIt().renderInline(expected)).toBe('a<code>`b</code>')
    const leadingTick = apply('`a', 'inlineCode', 0, 2).text
    expect(leadingTick).toBe('`` `a ``')
    expect(new MarkdownIt().renderInline(leadingTick)).toBe('<code>`a</code>')
  })

  it('局部取消斜体保留选区外的原始下划线标记', () => {
    expect(apply('_one_ _two_', 'italic', 7, 10).text).toBe('_one_ two')
    expect(apply('_one_ _two_', 'clearInline', 7, 10).text).toBe('_one_ two')
  })

  it('分割线插入：光标处成段插入 --- 并规整前后空行，光标落在行尾', () => {
    // 空文档：只插入 --- 本体
    expect(apply('', 'horizontalRule', 0)).toEqual({ text: '---', selection: { anchor: 3 } })
    // 行内光标：左右文字各自成段，前后空行隔开
    expect(apply('上文\n下文', 'horizontalRule', 2))
      .toEqual({ text: '上文\n\n---\n\n下文', selection: { anchor: 7 } })
    expect(apply('左字右字', 'horizontalRule', 2))
      .toEqual({ text: '左字\n\n---\n\n右字', selection: { anchor: 7 } })
    // 已有空行不叠加：前侧空行 / 后侧空行 / 空行行内三种位置
    expect(apply('上文\n\n下文', 'horizontalRule', 2))
      .toEqual({ text: '上文\n\n---\n\n下文', selection: { anchor: 7 } })
    expect(apply('上文\n\n下文', 'horizontalRule', 3))
      .toEqual({ text: '上文\n\n---\n\n下文', selection: { anchor: 7 } })
    // 文档末尾：后无内容时不追加尾部空行
    expect(apply('上文', 'horizontalRule', 2))
      .toEqual({ text: '上文\n\n---', selection: { anchor: 7 } })
    // 选区内容保留在分割线之后（与 fencePlan 等兄弟插入操作口径一致）
    expect(apply('前文中段后文', 'horizontalRule', 2, 4))
      .toEqual({ text: '前文\n\n---\n\n中段后文', selection: { anchor: 7 } })
    // 跨行选区：选区整体（含中间行）保留在 --- 之后，不静默丢弃
    expect(apply('第一段\n选中AA\n选中BB\n后续', 'horizontalRule', 6, 13))
      .toEqual({ text: '第一段\n选中\n\n---\n\nAA\n选中BB\n后续', selection: { anchor: 11 } })
  })

  it('分割线插入：表格矩形选区内禁用（块级结构不入格）', () => {
    const table = '| A | B |\n| --- | --- |\n| x | y |'
    const region = { tableFrom: 0, rowFrom: 0, rowTo: 0, columnFrom: 0, columnTo: 0 }
    expect(apply(table, 'horizontalRule', table.indexOf('A'), table.indexOf('A'), region).text).toBe(table)
  })

  it('高亮（#105）：扩词包裹、选区包裹、两态取消与清除均正确', () => {
    expect(apply('中文 English', 'highlight', 0).text).toBe('==中文== English')
    expect(apply('甲乙丙', 'highlight', 1, 2).text).toBe('甲==乙==丙')
    expect(apply('==编辑文字==', 'highlight', 4).text).toBe('编辑文字')
    expect(apply('前==中==后', 'highlight', 0, 7).text).toBe('==前中后==')
    expect(apply('# ==亮== 与 **粗**', 'clearInline', 2, 13).text).toBe('# 亮 与 粗')
  })

  it('高亮（#105）：空白插入成对标记并把光标置于开围栏内侧（按 == 长度）', () => {
    expect(apply('', 'highlight', 0)).toEqual({ text: '====', selection: { anchor: 2 } })
    expect(apply('甲 乙', 'highlight', 1)).toEqual({ text: '甲==== 乙', selection: { anchor: 3 } })
  })

  it('高亮（#105）：行内代码内不写高亮，代码块内不写行内样式', () => {
    expect(apply('`==码==`', 'highlight', 4).text).toBe('`==码==`')
    expect(apply('```\n==文==\n```', 'highlight', 6).text).toBe('```\n==文==\n```')
  })
})

describe('HTML 注释操作（#139）', () => {
  // 取消分支节点命中（以 Lezer markdown 实际产出为准，2026-09-27 实测钉住）：
  // 行内位置 `<!-- x -->` 产出 Comment 节点；整段（可跨行）产出 CommentBlock；
  // 无内容空对 `<!---->` 不产节点——空插形态须带一个空格（`<!-- -->`）
  // 才能进入 Comment 节点、两态闭环成立。

  it('选区包裹：定界符包裹选区，原文保持选中（wikilink 同款）', () => {
    expect(apply('前言 内容 后缀', 'htmlComment', 3, 5))
      .toEqual({ text: '前言 <!--内容--> 后缀', selection: { anchor: 7, head: 9 } })
  })

  it('无选区插入空对（带空格保 Comment 解析）：光标落开围栏内侧（按 <!-- 长度）', () => {
    // 空对形态 <!-- | -->：纯 <!----> 不解析为 Comment（实测），两态闭环断
    expect(apply('字词', 'htmlComment', 1))
      .toEqual({ text: '字<!-- -->词', selection: { anchor: 5 } })
    expect(apply('', 'htmlComment', 0))
      .toEqual({ text: '<!-- -->', selection: { anchor: 4 } })
  })

  it('光标在行内注释（Comment 节点）内取消：剥定界符保留内容', () => {
    expect(apply('a <!-- 注释 --> b', 'htmlComment', 7).text).toBe('a  注释  b')
    expect(apply('<!--纯文字-->', 'htmlComment', 6).text).toBe('纯文字')
  })

  it('光标在块级注释（CommentBlock 节点，含跨行）内取消', () => {
    const block = '段前\n<!-- 跨行\n注释 -->\n段后'
    expect(apply(block, 'htmlComment', 9).text).toBe('段前\n 跨行\n注释 \n段后')
    const bare = '段前\n<!--\n块\n-->\n段后'
    expect(apply(bare, 'htmlComment', 9).text).toBe('段前\n\n块\n\n段后')
  })

  it('空对（内容纯空白）取消：整节点删除不留残留空格', () => {
    expect(apply('字<!-- -->词', 'htmlComment', 5).text).toBe('字词')
    expect(apply('字<!--\n-->词', 'htmlComment', 6).text).toBe('字\n词')
  })

  it('选区与注释节点区间完全重合时取消（link 先例同款口径）', () => {
    const text = 'a <!-- 注释 --> b'
    // Comment 节点区间为 [2,13)（`<!-- 注释 -->`），选区与之重合
    expect(apply(text, 'htmlComment', 2, 13).text).toBe('a  注释  b')
  })

  it('add 行为：已在注释内不叠加（toggle 的取消面之外显式 add 为无操作）', () => {
    expect(apply('a <!-- x --> b', 'htmlComment', 7, 7, null, 'add').text).toBe('a <!-- x --> b')
  })

  it('代码上下文不接管：围栏、缩进代码与行内代码内返回 null', () => {
    expect(apply('```\n<!-- 码 -->\n```', 'htmlComment', 8).text).toBe('```\n<!-- 码 -->\n```')
    expect(apply('    <!-- 缩进 -->', 'htmlComment', 6).text).toBe('    <!-- 缩进 -->')
    expect(apply('`<!-- 码 -->`', 'htmlComment', 6).text).toBe('`<!-- 码 -->`')
  })

  it('真 HTML 块（HTMLBlock）内不接管：维持既有禁用上下文语义', () => {
    const html = '<div>\n<!-- 内嵌 -->\n</div>'
    expect(apply(html, 'htmlComment', 12).text).toBe(html)
  })

  it('表格矩形格区内禁用（插入型不入格，与 wikilink 不同、与块级围栏一致）', () => {
    const table = '| A | B |\n| --- | --- |\n| x | y |'
    const region = { tableFrom: 0, rowFrom: 0, rowTo: 0, columnFrom: 0, columnTo: 0 }
    expect(apply(table, 'htmlComment', 2, 3, region).text).toBe(table)
  })
})

describe('多 range 逐段规划（#240）', () => {
  /** 多 range 应用：变更按原文坐标展开为终文（产物选区映射归生产链路测试） */
  function applyRanges(text: string, op: Parameters<typeof planFormatOperation>[1],
    ranges: Array<{ from: number; to: number }>) {
    const plan = planFormatOperationRanges(text, op, ranges)
    if (!plan) return null
    let next = text
    for (const change of [...plan.changes].sort((a, b) => a.from - b.from).reverse()) {
      next = next.slice(0, change.from) + change.insert + next.slice(change.to)
    }
    return { text: next, selections: plan.selections, changes: plan.changes }
  }

  it('分类谓词：行内包裹类与格区白名单同源（INLINE 表 + clearInline/link/inlineMath/wikilink）', () => {
    for (const op of ['bold', 'italic', 'strikethrough', 'inlineCode', 'highlight',
      'clearInline', 'link', 'inlineMath', 'wikilink'] as const) {
      expect(isInlineFormatOp(op), op).toBe(true)
    }
    for (const op of ['heading1', 'headingNone', 'bulletList', 'orderedList', 'taskList', 'quote',
      'codeBlock', 'blockMath', 'horizontalRule', 'htmlComment'] as const) {
      expect(isInlineFormatOp(op), op).toBe(false)
    }
  })

  it('两非空选区各自包裹：两次独立计划合入一份变更组（原文坐标）', () => {
    const plan = planFormatOperationRanges('甲乙 丙丁', 'bold', [{ from: 0, to: 2 }, { from: 3, to: 5 }])
    expect(plan).not.toBeNull()
    expect(plan!.changes).toEqual([
      { from: 0, to: 2, insert: '**甲乙**' },
      { from: 3, to: 5, insert: '**丙丁**' },
    ])
    // 非空选区包裹无独立产物选区（null = 保持原选区语义，调用方映射原 range）
    expect(plan!.selections).toEqual([null, null])
  })

  it('两空光标各自扩词包裹：产物选区各自给出（原文坐标，互不加 delta）', () => {
    const plan = planFormatOperationRanges('中文 English 别的', 'bold',
      [{ from: 0, to: 0 }, { from: 3, to: 3 }])
    expect(plan!.changes).toEqual([
      { from: 0, to: 2, insert: '**中文**' },
      { from: 3, to: 10, insert: '**English**' },
    ])
    expect(plan!.selections).toEqual([
      { anchor: 2 },
      { anchor: 3 + 2 + 4 },
    ])
  })

  it('混合形态独立判定：一 range 在围栏内取消、一 range 普通扩词包裹', () => {
    const text = '**加粗** 普通'
    const plan = planFormatOperationRanges(text, 'bold', [{ from: 3, to: 3 }, { from: 8, to: 8 }])
    expect(plan!.changes).toEqual([
      { from: 0, to: 6, insert: '加粗' },
      { from: 7, to: 9, insert: '**普通**' },
    ])
    // 取消分支无 selection；扩词包裹给出光标（终文坐标：本 range 产物
    // 7+2 再叠加 range0 取消的净 -4）
    expect(plan!.selections).toEqual([null, { anchor: 7 + 2 - 4 }])
  })

  it('跨行选区逐段包裹：与单 range 路径同语义（逐行包裹、跳过前缀）', () => {
    const doc = '- 甲乙\n- 丙丁'
    const single = apply(doc, 'bold', 2, 9)
    const multi = applyRanges(doc, 'bold', [{ from: 2, to: 9 }])
    expect(multi!.text).toBe(single.text)
  })

  it('变更与已收集区间重叠的 range 丢弃变更：产物选区退化为原 range 映射', () => {
    // range 0 空光标取消整段围栏（变更区间 [0,6]），range 1 非空选区 [2,4] 落在
    // 其中——独立计划的包裹变更与取消变更重叠，保守丢弃后者
    const text = '**加粗** 尾巴'
    const plan = planFormatOperationRanges(text, 'bold', [{ from: 3, to: 3 }, { from: 2, to: 4 }])
    expect(plan!.changes).toEqual([{ from: 0, to: 6, insert: '加粗' }])
    expect(plan!.selections).toEqual([null, null])
  })

  it('相邻不重叠：选区端点相接（前 to === 后 from）不视为重叠', () => {
    const plan = planFormatOperationRanges('甲乙丙', 'bold', [{ from: 0, to: 2 }, { from: 2, to: 3 }])
    expect(plan!.changes).toEqual([
      { from: 0, to: 2, insert: '**甲乙**' },
      { from: 2, to: 3, insert: '**丙**' },
    ])
  })

  it('link/inlineMath/wikilink 插入型同走逐 range：产物选区独立偏移（原文坐标）', () => {
    const plan = planFormatOperationRanges('甲乙 丙丁', 'link', [{ from: 0, to: 2 }, { from: 3, to: 5 }])
    expect(plan!.changes).toEqual([
      { from: 0, to: 2, insert: '[甲乙]()' },
      { from: 3, to: 5, insert: '[丙丁]()' },
    ])
    // link 产物选区 = 替换括号内（终文坐标：range0 产物 () 间 5；
    // range1 产物 8 叠加 range0 的 +4 净位移 = 12）
    expect(plan!.selections).toEqual([{ anchor: 5 }, { anchor: 12 }])
  })

  it('全部 range 无变更返回 null（如都落在代码上下文）', () => {
    expect(planFormatOperationRanges('`甲` 乙', 'bold', [{ from: 1, to: 2 }])).toBeNull()
    expect(planFormatOperationRanges('', 'bold', [])).toBeNull()
  })

  it('部分 range 无变更不拖累其他 range（null 产物选区补位对齐）', () => {
    const plan = planFormatOperationRanges('`甲` 乙 丙', 'bold', [{ from: 1, to: 2 }, { from: 4, to: 5 }])
    expect(plan!.changes).toEqual([{ from: 4, to: 5, insert: '**乙**' }])
    expect(plan!.selections).toHaveLength(2)
    expect(plan!.selections[0]).toBeNull()
  })
})

describe('引用块内表格区域格式化（#296 审查轮）', () => {
  it('引用表格分隔行与格内容按前缀感知解析：格区加粗真实生效', () => {
    const doc = '> | 甲 | 乙 |\n> | --- | --- |\n> | a | b |'
    const region = { tableFrom: doc.indexOf('> | 甲'), rowFrom: 1, rowTo: 1, columnFrom: 0, columnTo: 0 }
    const out = apply(doc, 'bold', 0, 0, region)
    expect(out.text).toBe('> | 甲 | 乙 |\n> | --- | --- |\n> | **a** | b |')
  })

  it('无边界引用行的格区加粗同样生效', () => {
    const doc = '> | 甲 | 乙 |\n> | --- | --- |\n> a | b'
    const region = { tableFrom: doc.indexOf('> | 甲'), rowFrom: 1, rowTo: 1, columnFrom: 0, columnTo: 0 }
    const out = apply(doc, 'bold', 0, 0, region)
    expect(out.text).toBe('> | 甲 | 乙 |\n> | --- | --- |\n> **a** | b')
  })
})
