// Live Callout 装饰契约（#653/T02，T01 路线 A）：行级类 + data-callout +
// 标记 widget + 标题 mark，识别骑 liveDecorationsField 增量树、发射骑
// emitForRange 增量窗口。断言口径与 T01 探针报告 §5.1/§5.4 一致：
// - 容器每行挂 callout 行级类 + data-callout（嵌套最内层胜出）
// - 标题行 callout-title、正文行 callout-content、首末行圆角类
// - 标记以行内 replace widget 隐藏并呈现 .callout-icon；光标/选区端点触及
//   标题行即显形源码（与生产 QuoteMark 同款端点语义）
// - 标题文字 mark 包 .callout-title-inner；无显式标题时以零宽 widget 呈现
//   默认标题（源文派生，不写回）
// - callout 行替代该层引用紫条（内部普通引用仍显示自身样式——最内层
//   引用为普通引用的行不被静默）
// - 未成型按普通引用降级；普通引用与代码内伪标记不受影响
// - 增量：callout 身份翻转（首行编辑）扩展重建到容器边界，增量结果与
//   全量重建对拍一致（RangeSet.eq）
import { describe, it, expect } from 'vitest'
import { EditorSelection, EditorState, RangeSet, Text } from '@codemirror/state'
import type { DecorationSet } from '@codemirror/view'
import { buildLivePreviewDecorations, liveDecorationsField } from '../../src/webview/liveDecorations'

// ---- 断言辅助（与 liveDecorations.test.ts 同形，含行装饰属性） ----

interface DecoItem {
  from: number
  to: number
  cls?: string
  widget?: string
  attrs?: Record<string, string>
}

function collect(set: DecorationSet): DecoItem[] {
  const out: DecoItem[] = []
  set.between(0, Infinity, (from, to, value) => {
    const spec = value.spec as {
      class?: string
      widget?: { constructor: { name: string }; type?: string; text?: string }
      attributes?: Record<string, string>
    }
    if (spec['class'] !== undefined) {
      out.push({ from, to, cls: spec['class'], attrs: spec.attributes })
    } else if (spec.widget !== undefined) {
      out.push({
        from,
        to,
        widget: `${spec.widget.constructor?.name ?? '?'}:${spec.widget.type ?? spec.widget.text ?? ''}`,
      })
    } else {
      out.push({ from, to, attrs: spec.attributes })
    }
  })
  return out
}

function build(doc: string, selection?: { anchor: number; head?: number }): DecorationSet {
  // 默认选区放文档尾：文档首行常是标题行，anchor 0 落在其端点区间内会
  // 触发标记显形（端点语义），干扰「未触及」形态断言
  const anchor = selection ? selection.anchor : doc.length
  return buildLivePreviewDecorations(Text.of(doc.split('\n')), EditorSelection.single(anchor, selection?.head ?? anchor))
}

/** 行号 → 行装饰（from 为行首的零宽项） */
function lineDecorations(set: DecorationSet, doc: string): Map<number, { cls: string; attrs?: Record<string, string> }> {
  const lines = new Map<number, { cls: string; attrs?: Record<string, string> }>()
  for (const item of collect(set)) {
    if (item.cls !== undefined && item.to === item.from) {
      lines.set(doc.slice(0, item.from).split('\n').length, { cls: item.cls, attrs: item.attrs })
    }
  }
  return lines
}

const DOC = ['> [!note] 标题文字', '> 正文第一行', '> 正文第二行', '', '后续段落'].join('\n')

describe('Live callout：全量构建', () => {
  const set = build(DOC)

  it('容器行挂 callout 家族类与 data-callout（标题行/正文行/首末行圆角）', () => {
    const lines = lineDecorations(set, DOC)
    const title = lines.get(1)!
    expect(title.cls.split(' ')).toEqual(expect.arrayContaining([
      'callout', 'callout-title', 'vsidian-callout-first', 'vsidian-quote-line',
    ]))
    expect(title.attrs?.['data-callout']).toBe('note')
    const body1 = lines.get(2)!
    expect(body1.cls.split(' ')).toEqual(expect.arrayContaining(['callout', 'callout-content']))
    expect(body1.attrs?.['data-callout']).toBe('note')
    const body2 = lines.get(3)!
    expect(body2.cls.split(' ')).toContain('vsidian-callout-last')
    expect(lines.get(5)?.cls ?? '').not.toContain('callout')
  })

  it('单行容器首末行圆角类同挂', () => {
    const single = build(['> [!note] 单行'].join('\n'))
    const lines = lineDecorations(single, '> [!note] 单行')
    const cls = lines.get(1)!.cls.split(' ')
    expect(cls).toContain('vsidian-callout-first')
    expect(cls).toContain('vsidian-callout-last')
  })

  it('未触及标题行：标记（含尾随空格与 fold 符号）隐藏为 callout 图标 widget', () => {
    const items = collect(set)
    const marker = items.find((i) => i.widget?.startsWith('CalloutMarkerWidget:'))
    expect(marker).toBeDefined()
    // `> [!note] ` → [2, 10)：标记 7 字符 + 吞并一个空格（markerEnd 语义）
    expect(marker!.from).toBe(2)
    expect(marker!.to).toBe(10)
    expect(marker!.widget).toBe('CalloutMarkerWidget:note')
    const fold = build(['> [!note]+ 标题', '> 正文'].join('\n'))
    const foldMarker = collect(fold).find((i) => i.widget?.startsWith('CalloutMarkerWidget:'))
    // `> [!note]+ ` → [2, 11)
    expect([foldMarker!.from, foldMarker!.to]).toEqual([2, 11])
  })

  it('标题文字 mark 包 callout-title-inner', () => {
    const items = collect(set)
    const inner = items.find((i) => i.cls?.split(' ').includes('callout-title-inner'))
    expect(inner).toBeDefined()
    expect(DOC.slice(inner!.from, inner!.to)).toBe('标题文字')
  })

  it('无显式标题：零宽默认标题 widget（源文派生，不写回源文）', () => {
    const bare = build(['> [!note]', '> 正文'].join('\n'))
    const items = collect(bare)
    const fallback = items.find((i) => i.widget?.startsWith('CalloutDefaultTitleWidget:'))
    expect(fallback).toBeDefined()
    expect(fallback!.widget).toBe('CalloutDefaultTitleWidget:Note')
    expect(fallback!.from).toBe(fallback!.to) // 零宽：无对应源文
    const unknown = build(['> [!custom-x]', '> 正文'].join('\n'))
    expect(collect(unknown).find((i) => i.widget?.startsWith('CalloutDefaultTitleWidget:'))?.widget)
      .toBe('CalloutDefaultTitleWidget:Custom x')
  })

  it('未知类型保留原标识进 data-callout（回落 note 外观由 CSS 承载）', () => {
    const set2 = build(['> [!Custom-Question] 自定义', '> 正文'].join('\n'))
    const lines = lineDecorations(set2, '> [!Custom-Question] 自定义\n> 正文')
    expect(lines.get(1)!.attrs?.['data-callout']).toBe('custom-question')
  })

  it('光标端点触及标题行：标记不隐藏（显形源码），默认标题不重复呈现', () => {
    const touched = build(DOC, { anchor: 12 }) // 标题文字内
    const items = collect(touched)
    expect(items.find((i) => i.widget?.startsWith('CalloutMarkerWidget:'))).toBeUndefined()
    const touchedHead = build(DOC, { anchor: 2 }) // 标记首字符（行端点内）
    expect(collect(touchedHead).find((i) => i.widget?.startsWith('CalloutMarkerWidget:'))).toBeUndefined()
    const bare = build(['> [!note]', '> 正文'].join('\n'), { anchor: 4 })
    expect(collect(bare).find((i) => i.widget?.startsWith('CalloutDefaultTitleWidget:'))).toBeUndefined()
    // 离开标题行（正文行）恢复隐藏
    const elsewhere = build(DOC, { anchor: 22 }) // 行 2（正文）内
    expect(collect(elsewhere).find((i) => i.widget?.startsWith('CalloutMarkerWidget:'))).toBeDefined()
  })

  it('callout 行静默该层引用紫条（quiet 类），内部普通引用行不被静默', () => {
    const lines = lineDecorations(set, DOC)
    expect(lines.get(1)!.cls.split(' ')).toContain('vsidian-callout-quiet')
    expect(lines.get(3)!.cls.split(' ')).toContain('vsidian-callout-quiet')
    // F19：callout 内普通引用（行 2-3 属内层引用）——最内层引用为普通引用的行不 quiet
    const nested = build(['> [!note] 标题', '> > 内层普通引用', '> 正文'].join('\n'))
    const nestedLines = lineDecorations(nested, '> [!note] 标题\n> > 内层普通引用\n> 正文')
    expect(nestedLines.get(2)!.cls.split(' ')).not.toContain('vsidian-callout-quiet')
    expect(nestedLines.get(2)!.cls.split(' ')).toContain('vsidian-quote-line')
    expect(nestedLines.get(2)!.cls.split(' ')).toContain('callout') // 外层 content 身份保留
  })

  it('嵌套 callout：内外层类同挂，data-callout 最内层胜出', () => {
    const nested = build(['> [!note] 外层', '> > [!tip] 内层', '> > 内层正文', '> 外层正文'].join('\n'))
    const text = '> [!note] 外层\n> > [!tip] 内层\n> > 内层正文\n> 外层正文'
    const lines = lineDecorations(nested, text)
    expect(lines.get(1)!.attrs?.['data-callout']).toBe('note')
    // 行 2 是外层 content + 内层 title；行 3 是外层 content + 内层 content
    expect(lines.get(2)!.cls.split(' ')).toEqual(expect.arrayContaining([
      'callout', 'callout-title', 'callout-content', 'vsidian-callout-first',
    ]))
    expect(lines.get(2)!.attrs?.['data-callout']).toBe('tip')
    expect(lines.get(3)!.attrs?.['data-callout']).toBe('tip')
    // 行 4 `> 外层正文` 是内层容器的 lazy 续行（对拍 F17：内层 toLine=4）
    expect(lines.get(4)!.attrs?.['data-callout']).toBe('tip')
    // 内层标记同样以 widget 呈现（内层首段在行 2）
    const inner = collect(nested).find((i) => i.widget === 'CalloutMarkerWidget:tip')
    expect(inner).toBeDefined()
    expect(text.slice(inner!.from, inner!.from + 6)).toBe('[!tip]')
  })

  it('未成型矩阵降级为普通引用（无 callout 类、无 data-callout）', () => {
    for (const bad of [
      '> [!] 空类型\n> 正文',
      '> [!note extra] 含空格\n> 正文',
      '> [!note 标题未闭合\n> 正文',
      '> [!note]-标题紧贴\n> 正文',
      '> 普通引用\n> [!note] 后段标记不升级',
      '> \\[!note\\] 转义\n> 正文',
    ]) {
      const set2 = build(bad)
      for (const item of collect(set2)) {
        expect(item.cls?.split(' ') ?? [], bad).not.toContain('callout')
        expect(item.attrs?.['data-callout'], bad).toBeUndefined()
      }
    }
  })

  it('代码内伪标记不升级：callout 身份仍是首段声明，代码行照常代码类', () => {
    const doc = ['> [!note] 标题', '> ```md', '> [!tip] 代码里的伪标记', '> ```'].join('\n')
    const set2 = build(doc)
    const lines = lineDecorations(set2, doc)
    expect(lines.get(1)!.attrs?.['data-callout']).toBe('note')
    expect(lines.get(3)!.cls.split(' ')).toContain('vsidian-code-line')
    expect(collect(set2).find((i) => i.widget === 'CalloutMarkerWidget:tip')).toBeUndefined()
  })

  it('仅标题形态（只有声明行）整容器即标题行', () => {
    const doc = ['> [!note] 提示一下'].join('\n')
    const lines = lineDecorations(build(doc), doc)
    const cls = lines.get(1)!.cls.split(' ')
    expect(cls).toContain('callout-title')
    expect(cls).not.toContain('callout-content')
  })
})

describe('Live callout：增量维护（身份翻转扩展到容器边界）', () => {
  it('在声明行键入使容器成为 callout：全部容器行更新（与全量一致）', () => {
    const before = ['> 普通引用标题', '> 正文行'].join('\n')
    // 模拟用户编辑首行：`> [!note] 普通引用标题`
    const edited = ['> [!note] 普通引用标题', '> 正文行'].join('\n')
    let state = EditorState.create({ doc: before, extensions: [liveDecorationsField] })
    state = state.update({ changes: { from: 0, to: before.length, insert: edited } }).state
    // 对拍用 state 自身选区（既有惯例——编辑事务的默认选区映射参与对拍）
    const full = buildLivePreviewDecorations(state.doc, state.selection)
    expect(RangeSet.eq([state.field(liveDecorationsField).decos], [full])).toBe(true)
    const lines = lineDecorations(state.field(liveDecorationsField).decos, edited)
    expect(lines.get(2)!.cls.split(' ')).toContain('callout-content')
  })

  it('删除声明使容器失去 callout：容器行回退普通引用（与全量一致）', () => {
    const before = ['> [!note] 标题', '> 正文行'].join('\n')
    let state = EditorState.create({ doc: before, extensions: [liveDecorationsField] })
    state = state.update({ changes: { from: 2, to: 10, insert: '' } }).state // 删 `[!note] `
    const full = buildLivePreviewDecorations(state.doc, state.selection)
    expect(RangeSet.eq([state.field(liveDecorationsField).decos], [full])).toBe(true)
    for (const item of collect(state.field(liveDecorationsField).decos)) {
      expect(item.cls?.split(' ') ?? []).not.toContain('callout')
    }
  })

  it('正文行键入不扩散重建（增量结果仍与全量一致）', () => {
    const before = ['> [!note] 标题', '> 正文行'].join('\n')
    const pos = before.length
    // 真实键入形态：光标先落在正文行尾再插入
    let state = EditorState.create({
      doc: before,
      extensions: [liveDecorationsField],
      selection: EditorSelection.single(pos),
    })
    state = state.update({ changes: { from: pos, insert: '补充' } }).state
    const full = buildLivePreviewDecorations(state.doc, state.selection)
    expect(RangeSet.eq([state.field(liveDecorationsField).decos], [full])).toBe(true)
  })

  it('常规编辑序列增量与全量对拍一致（固定编辑路径）', () => {
    let state = EditorState.create({ doc: DOC, extensions: [liveDecorationsField] })
    // 坐标经当前文本动态定位（编辑序列中文档长度在变）
    const edits: Array<(text: string) => [number, number, string]> = [
      (t) => [t.indexOf('标题文字') + 2, t.indexOf('标题文字') + 2, '更多'], // 标题行追加
      (t) => [t.indexOf('标题文字') + 4, t.indexOf('标题文字') + 6, ''],   // 删标题部分文字
      (t) => [t.length, t.length, '\n> [!custom-x] 未知类型'],            // 新 callout 段
      () => [2, 9, '[!NoTe'],                                            // 改类型（大小写）
      (t) => [t.indexOf('未知类型') + 4, t.indexOf('未知类型') + 4, 'x'], // 未知类型段标题输入
      (t) => [t.length, t.length, '\n> 未知段正文'],                      // 未知类型段补正文
    ]
    let text = DOC
    for (const locate of edits) {
      const [from, to, insert] = locate(text)
      state = state.update({ changes: { from, to, insert } }).state
      text = text.slice(0, from) + insert + text.slice(to)
      const full = buildLivePreviewDecorations(Text.of(text.split('\n')), state.selection)
      expect(RangeSet.eq([state.field(liveDecorationsField).decos], [full]),
        `编辑后漂移: ${JSON.stringify({ from, to, insert })}`).toBe(true)
    }
  })
})
