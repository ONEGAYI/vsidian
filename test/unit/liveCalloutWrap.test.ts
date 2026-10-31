// T04（#672）BlockWrapper 容器结构：区间派生纯函数 + StateField 增量。
// 断言口径（探针报告 docs/research/callout-blockwrapper-probe.md §5.1/§5.2
// 勘误后版本）：
// - 区间直接消费解析器节点区间：from 对齐标题行行首、to 取尾行行尾
// - 懒延续行（含带较少 `>` 前缀的外层行）留在内层容器——与 Reading 双端
//   一致（calloutParity F17/F38/F44；不是缺陷，见报告 §2.4 勘误）
// - 列表内 callout（Blockquote 位于 ListItem 容器内）v1 不产 wrapper（边界）
// - frontmatter 区域不产 wrapper
// - 增量：文档编辑后字段值与全量重建一致（RangeSet.eq）；纯选区事务不重建
// rank/DOM 嵌套与属性由浏览器套件断言（BlockWrapper 实例不公开 spec）。
import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState, RangeSet, Text } from '@codemirror/state'
import type { Range } from '@codemirror/state'
import type { BlockWrapper } from '@codemirror/view'
import { docInput, markdownTreeParser } from '../../src/shared/markdownDoc'
import { collectCalloutWrappers, liveCalloutWrappersField, calloutWrapRank } from '../../src/webview/liveCalloutWrap'
import { livePreviewDecorations } from '../../src/webview/liveDecorations'

const wrapRanges = (doc: string): Array<[number, number, number, string]> =>
  collectCalloutWrappers(markdownTreeParser.parse(docInput(Text.of(doc.split('\n')))), Text.of(doc.split('\n')))
    .map((w) => [w.from, w.to, w.depth, w.type])

/** 行号区间断言辅助：doc → 各行行首/行尾 offset */
function lineSpan(doc: string, lineNo: number): [number, number] {
  const lines = doc.split('\n')
  const from = lines.slice(0, lineNo - 1).reduce((n, l) => n + l.length + 1, 0)
  return [from, from + lines[lineNo - 1]!.length]
}

describe('collectCalloutWrappers：区间派生（解析器区间 + 行对齐）', () => {
  it('基础容器：from=标题行行首、to=尾行行尾，不吞容器后正文', () => {
    const doc = '> [!note] 标题\n> 正文一\n> 正文二\n\n后续段落'
    expect(wrapRanges(doc)).toEqual([[0, lineSpan(doc, 3)[1], 1, 'note']])
  })

  it('嵌套 + 懒延续：带较少 `>` 的外层行归内层容器（calloutParity F17 口径）', () => {
    const doc = '> [!note] 外层\n> > [!tip] 内层\n> > 内层正文\n> 外层正文'
    expect(wrapRanges(doc)).toEqual([
      [lineSpan(doc, 1)[0], lineSpan(doc, 4)[1], 1, 'note'],
      [lineSpan(doc, 2)[0], lineSpan(doc, 4)[1], 2, 'tip'],
    ])
  })

  it('三层嵌套：外层尾两行均归最内层（V01 §4.1 文档形态，勘误后口径）', () => {
    const doc = [
      '> [!note] 一层', '> 一层正文', '> > [!tip] 二层', '> > 二层正文',
      '> > > [!warning] 三层', '> > > 三层正文', '> 二层尾部', '> 一层尾部',
    ].join('\n')
    expect(wrapRanges(doc)).toEqual([
      [lineSpan(doc, 1)[0], lineSpan(doc, 8)[1], 1, 'note'],
      [lineSpan(doc, 3)[0], lineSpan(doc, 8)[1], 2, 'tip'],
      [lineSpan(doc, 5)[0], lineSpan(doc, 8)[1], 3, 'warning'],
    ])
  })

  it('兄弟 callout 空行分隔：区间不重叠；普通引用不产 wrapper', () => {
    const doc = '> [!note] A\n> a\n\n> [!tip] B\n> b\n\n普通引用：\n> 无声明\n> 续'
    expect(wrapRanges(doc)).toEqual([
      [lineSpan(doc, 1)[0], lineSpan(doc, 2)[1], 1, 'note'],
      [lineSpan(doc, 4)[0], lineSpan(doc, 5)[1], 1, 'tip'],
    ])
  })

  it('仅标题形态：区间即标题行整行', () => {
    const doc = '> [!note] 只有一行'
    expect(wrapRanges(doc)).toEqual([[0, doc.length, 1, 'note']])
  })

  it('空引用行（`>` 独占）与无空格引用标记照常入区间；标题紧贴降级不产', () => {
    const spaced = '> [!note] t\n>\n> b'
    expect(wrapRanges(spaced)).toEqual([[0, spaced.length, 1, 'note']])
    const tight = '>[!note] t\n>b'
    expect(wrapRanges(tight)).toEqual([[0, tight.length, 1, 'note']])
    // 既有降级矩阵（calloutSyntax 口径）：`]` 后紧贴文字不构成声明
    expect(wrapRanges('>[!note]t\n>b')).toEqual([])
  })

  it('列表内 callout：v1 不产 wrapper（边界登记，维持行级形态）', () => {
    const doc = '- > [!info] 列表内标题\n  > 列表内正文\n- 后置'
    expect(wrapRanges(doc)).toEqual([])
  })

  it('类型标识矩阵：13 规范类型 + 别名（小写规范化/原样）+ 未知类型原样（T05 契约承接）', () => {
    for (const type of [
      'note', 'abstract', 'info', 'todo', 'tip', 'success', 'question',
      'warning', 'failure', 'danger', 'bug', 'example', 'quote',
    ]) {
      expect(wrapRanges(`> [!${type}] 标题\n> 正文`), type).toEqual([[0, `> [!${type}] 标题\n> 正文`.length, 1, type]])
    }
    // 别名归一（important 独立变量族但标识原样）、大小写规范化、未知原样
    for (const [src, id] of [
      ['> [!IMPORTANT] t\n> b', 'important'],
      ['> [!summary] t\n> b', 'summary'],
      ['> [!Custom-Question] t\n> b', 'custom-question'],
    ] as const) {
      expect(wrapRanges(src)[0]![3], src).toBe(id)
    }
  })

  it('frontmatter 区域不产 wrapper（fmEnd 守卫）', () => {
    const doc = '---\n> [!note] fm 内伪引用\n---\n\n> [!tip] t\n> b'
    const text = Text.of(doc.split('\n'))
    const tree = markdownTreeParser.parse(docInput(text))
    const fmEnd = lineSpan(doc, 3)[1]
    // fmEnd 之前（frontmatter 区域）的 Blockquote 不产；正文照常
    const kept = collectCalloutWrappers(tree, text, fmEnd)
    expect(kept.map((w) => [w.from, w.to, w.depth, w.type]))
      .toEqual([[lineSpan(doc, 5)[0], doc.length, 1, 'tip']])
    // 守卫缺省（fmEnd=0，裸树消费）行为如实暴露 fm 内节点——装配路径
    // buildWrappers 恒传 fmEnd（见 StateField 用例）
    expect(collectCalloutWrappers(tree, text)).toHaveLength(2)
  })
})

describe('liveCalloutWrappersField：StateField 增量与装配', () => {
  const DOC = '> [!note] 外层\n> > [!tip] 内层\n> > 内层正文\n> 外层正文'

  const items = (set: RangeSet<BlockWrapper>): Array<Range<BlockWrapper>> => {
    const out: Array<Range<BlockWrapper>> = []
    set.between(0, Infinity, (from, to, value) => {
      out.push({ from, to, value } as Range<BlockWrapper>)
    })
    return out
  }

  it('全装配（livePreviewDecorations 之后注册）产出预期区间', () => {
    const state = EditorState.create({ doc: DOC, extensions: [livePreviewDecorations, liveCalloutWrappersField] })
    const got = items(state.field(liveCalloutWrappersField)).map((r) => [r.from, r.to])
    expect(got).toEqual([[0, lineSpan(DOC, 4)[1]], [lineSpan(DOC, 2)[0], lineSpan(DOC, 4)[1]]])
  })

  it('独立装配（liveDecorationsField 缺席）走全量解析回退，与全装配一致', () => {
    const standalone = EditorState.create({ doc: DOC, extensions: [liveCalloutWrappersField] })
    const full = EditorState.create({ doc: DOC, extensions: [livePreviewDecorations, liveCalloutWrappersField] })
    expect(RangeSet.eq([standalone.field(liveCalloutWrappersField)], [full.field(liveCalloutWrappersField)])).toBe(true)
  })

  it('编辑后增量值与全量重建一致（RangeSet.eq）', () => {
    let state = EditorState.create({ doc: DOC, extensions: [livePreviewDecorations, liveCalloutWrappersField] })
    // 序列：内层正文键入 / 首行改类型 / 删声明降级 / 文档尾补兄弟 callout
    const edits: Array<(t: string) => [number, number, string]> = [
      (t) => [t.indexOf('内层正文') + 2, t.indexOf('内层正文') + 2, '字'],
      (t) => [t.indexOf('[!tip]') + 3, t.indexOf('[!tip]') + 6, 'hint'],
      (t) => [2, t.indexOf('] ', 2) + 1, ''],
      (t) => [t.length, t.length, '\n\n> [!example] 兄弟\n> 兄弟正文'],
    ]
    let text = DOC
    for (const locate of edits) {
      const [from, to, insert] = locate(text)
      state = state.update({ changes: { from, to, insert }, selection: EditorSelection.single(from + insert.length) }).state
      text = text.slice(0, from) + insert + text.slice(to)
      const rebuilt = EditorState.create({ doc: text, extensions: [livePreviewDecorations, liveCalloutWrappersField] })
      expect(RangeSet.eq([state.field(liveCalloutWrappersField)], [rebuilt.field(liveCalloutWrappersField)]),
        `编辑后漂移: ${JSON.stringify({ from, to, insert })}`).toBe(true)
    }
  })

  it('纯选区事务不重建（值恒等）', () => {
    let state = EditorState.create({ doc: DOC, extensions: [livePreviewDecorations, liveCalloutWrappersField] })
    const before = state.field(liveCalloutWrappersField)
    state = state.update({ selection: EditorSelection.single(3) }).state
    expect(state.field(liveCalloutWrappersField)).toBe(before)
  })

  it('rank：外层大内层小（60 − 10 × 深度）', () => {
    expect(calloutWrapRank(1)).toBe(50)
    expect(calloutWrapRank(2)).toBe(40)
    expect(calloutWrapRank(3)).toBe(30)
  })

  it('frontmatter 内伪引用不产 wrapper（buildWrappers 恒传 fmEnd）', () => {
    const doc = '---\n> [!note] fm 内伪引用\n---\n\n> [!tip] t\n> b'
    const state = EditorState.create({ doc, extensions: [livePreviewDecorations, liveCalloutWrappersField] })
    const got = items(state.field(liveCalloutWrappersField)).map((r) => [r.from, r.to])
    expect(got).toEqual([[lineSpan(doc, 5)[0], doc.length]])
  })
})
