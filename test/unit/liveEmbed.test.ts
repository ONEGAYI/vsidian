// 父文档 Live 正文嵌入装饰契约（工单 #223）：独占行 ![[…]] 的嵌入表
// StateField（行级扫描 + 增量重建）、跨容器卡片装饰（隐形态整行替换
// widget / 显形态行下方 block widget——光标/选区触及源码区间显形，离开
// 隐藏；显隐谓词复用 selectionTouchesRange 语义）、代码围栏与 frontmatter
// 抑制边界、装饰实例缓存。真实指针/IME/绘制验证在 test/browser 与集成层。
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import {
  LIVE_EMBED_CLASS_NAMES,
  LiveEmbedWidget,
  liveEmbed,
  liveEmbedDecoCacheLimit,
  liveEmbedDecorations,
  liveEmbedSpansField,
  liveEmbedWidgetDeco,
  setLiveEmbedCards,
} from '../../src/webview/liveEmbed'
import { liveDecorationsField } from '../../src/webview/liveDecorations'
import { mermaidFencesField } from '../../src/webview/liveMermaid'
import type { EmbedCardManager } from '../../src/webview/embedCard'

/** 装饰观测：StateField 直驱（跨行/block 装饰来自 StateField 的 CM6 约束） */
function buildDecos(
  text: string,
  selection: EditorSelection,
): Array<{ from: number; to: number; block: boolean; widget: LiveEmbedWidget }> {
  const state = EditorState.create({
    doc: text,
    extensions: [
      // 多选区场景（任一 range 命中显形）需要显式开启（CM6 缺省把 create
      // 时的多 range selection 规约为单 range）
      EditorState.allowMultipleSelections.of(true),
      liveDecorationsField,
      mermaidFencesField,
      liveEmbed,
    ],
    selection,
  })
  const decos = state.field(liveEmbedDecorations)
  const out: Array<{ from: number; to: number; block: boolean; widget: LiveEmbedWidget }> = []
  decos.between(0, text.length, (from, to, value) => {
    const spec = value.spec as { widget?: LiveEmbedWidget; block?: boolean }
    if (spec.widget) {
      out.push({ from, to, block: Boolean(spec.block), widget: spec.widget })
    }
  })
  return out.sort((a, b) => a.from - b.from)
}

const DOC = [
  '前文段。',          // 行1
  '',                 // 行2
  '![[目标笔记]]',      // 行3：lineFrom = 6
  '',                 // 行4
  '尾段。',            // 行5
].join('\n')

const LINE_FROM = DOC.indexOf('![[目标笔记]]')
const EMBED_TO = LINE_FROM + '![[目标笔记]]'.length
const LINE_TO = EMBED_TO

describe('Live 嵌入装饰：显隐切换', () => {
  it('光标在嵌入行之外 → 整行替换为卡片 widget（inline replace，覆盖行首到行尾）', () => {
    const items = buildDecos(DOC, EditorSelection.single(0))
    expect(items).toHaveLength(1)
    expect(items[0]!.from).toBe(LINE_FROM)
    expect(items[0]!.to).toBe(LINE_TO)
    expect(items[0]!.block).toBe(false)
    expect(items[0]!.widget).toBeInstanceOf(LiveEmbedWidget)
    expect(items[0]!.widget!.inner).toBe('目标笔记')
    expect(items[0]!.widget!.below).toBe(false)
  })

  it('折叠光标命中嵌入源码区间内部或两端 → 源码显形（无替换装饰 + 行下方 block widget）', () => {
    for (const at of [LINE_FROM, LINE_FROM + 3, EMBED_TO]) {
      const items = buildDecos(DOC, EditorSelection.single(at))
      expect(items, `at=${at}`).toHaveLength(1)
      expect(items[0]!.block, `at=${at}`).toBe(true)
      expect(items[0]!.from, `at=${at}`).toBe(LINE_TO)
      expect(items[0]!.to, `at=${at}`).toBe(LINE_TO)
      expect(items[0]!.widget!.below, `at=${at}`).toBe(true)
    }
  })

  it('光标在区间相邻位置（! 前一格 / ]] 后一格）不显形（保持替换隐藏）', () => {
    const before = buildDecos(DOC, EditorSelection.single(LINE_FROM - 1))
    expect(before[0]!.block).toBe(false)
    const after = buildDecos(DOC, EditorSelection.single(EMBED_TO + 1))
    expect(after[0]!.block).toBe(false)
  })

  it('非空选区与区间严格重叠才显形：端点相接不重叠保持隐藏', () => {
    // 选区 [0, LINE_FROM)——止于区间左端（不含端点）：不重叠 → 隐藏
    const touching = buildDecos(DOC, EditorSelection.create([EditorSelection.range(0, LINE_FROM)]))
    expect(touching[0]!.block).toBe(false)
    // 选区 [0, LINE_FROM + 1)——跨过左端：严格重叠 → 显形
    const overlap = buildDecos(DOC, EditorSelection.create([EditorSelection.range(0, LINE_FROM + 1)]))
    expect(overlap[0]!.block).toBe(true)
  })

  it('多选区任一 range 命中即显形', () => {
    const items = buildDecos(
      DOC,
      EditorSelection.create([
        EditorSelection.range(0, 1),
        EditorSelection.range(LINE_FROM + 2, LINE_FROM + 3),
      ]),
    )
    expect(items).toHaveLength(1)
    expect(items[0]!.block).toBe(true)
  })

  it('多枚嵌入：光标在第一枚内 → 其余保持隐藏形态（各自独立显隐）', () => {
    const text = '![[A]]\n![[B]]\n'
    const first = text.indexOf('![[A]]')
    const items = buildDecos(text, EditorSelection.single(first + 3))
    expect(items).toHaveLength(2)
    expect(items.filter((i) => i.block)).toHaveLength(1)
    expect(items[0]!.block).toBe(true)
    expect(items[1]!.block).toBe(false)
  })

  it('行前缩进（≤3 空格）与尾随空白容忍：替换覆盖整行（含缩进）', () => {
    const text = '  ![[A]]  \n尾行'
    const items = buildDecos(text, EditorSelection.single(text.length))
    expect(items).toHaveLength(1)
    expect(items[0]!.from).toBe(0)
    expect(items[0]!.to).toBe(text.indexOf('\n'))
  })
})

describe('Live 嵌入装饰：抑制边界（表构建层不排除、发射层排除）', () => {
  it('闭合围栏内的嵌入行不发射（代码区域字面文本）', () => {
    const text = ['```text', '![[围栏内]]', '```', '', '正文'].join('\n')
    expect(buildDecos(text, EditorSelection.single(0))).toHaveLength(0)
  })

  it('文末开放围栏之后的嵌入行不发射（未闭合围栏内容语义）', () => {
    const text = ['```text', '![[开放内]]'].join('\n')
    expect(buildDecos(text, EditorSelection.single(0))).toHaveLength(0)
  })

  it('frontmatter 内的嵌入形态行不发射（头区不产正文嵌入）', () => {
    const text = ['---', 'key:', '  ![[头区内]]', '---', '', '正文'].join('\n')
    expect(buildDecos(text, EditorSelection.single(text.length))).toHaveLength(0)
  })

  it('混排/列表/引用/表格格/未闭合行不产出（soleEmbedOfLine 语义，源文保留）', () => {
    const text = [
      '前 ![[混排]] 后',
      '- ![[列表]]',
      '> ![[引用]]',
      '| ![[表格]] |',
      '![[未闭合',
      '尾段',
    ].join('\n')
    expect(buildDecos(text, EditorSelection.single(0))).toHaveLength(0)
  })

  it('围栏编辑联动：上方打开围栏使下方嵌入行即时撤下装饰', () => {
    let state = EditorState.create({
      doc: '![[A]]\n',
      extensions: [liveDecorationsField, mermaidFencesField, liveEmbed],
      selection: EditorSelection.single(2),
    })
    expect(state.field(liveEmbedDecorations).size).toBe(1)
    // 行首插入 ``` 开启围栏（未闭合）→ 嵌入行落入开放围栏内容区
    state = state.update({ changes: { from: 0, insert: '```\n' } }).state
    expect(state.field(liveEmbedDecorations).size).toBe(0)
  })
})

describe('Live 嵌入表：增量重建', () => {
  it('编辑嵌入 inner → 表更新（新 inner）', () => {
    let state = EditorState.create({
      doc: DOC,
      extensions: [liveDecorationsField, mermaidFencesField, liveEmbedSpansField],
    })
    const before = state.field(liveEmbedSpansField)
    expect(before).toHaveLength(1)
    state = state
      .update({ changes: { from: LINE_FROM + 3, to: LINE_FROM + 7, insert: '笔记B' } })
      .state
    const after = state.field(liveEmbedSpansField)
    expect(after).toHaveLength(1)
    expect(after[0]!.inner).not.toBe('目标笔记')
  })

  it('删除闭合括号（引用未闭合）→ 表即时撤下（保留可编辑原文）', () => {
    let state = EditorState.create({
      doc: DOC,
      extensions: [liveDecorationsField, mermaidFencesField, liveEmbedSpansField],
    })
    state = state.update({ changes: { from: EMBED_TO - 2, to: EMBED_TO, insert: '' } }).state
    expect(state.field(liveEmbedSpansField)).toHaveLength(0)
  })

  it('窗口外嵌入行编辑无关（区间随变更映射不漂移）', () => {
    const text = '![[A]]\n\n中间段。\n\n![[B]]\n'
    let state = EditorState.create({
      doc: text,
      extensions: [liveDecorationsField, mermaidFencesField, liveEmbedSpansField],
    })
    const b = text.indexOf('![[B]]')
    state = state.update({ changes: { from: text.indexOf('中间段。'), insert: '改' } }).state
    const spans = state.field(liveEmbedSpansField)
    expect(spans).toHaveLength(2)
    expect(spans[1]!.lineFrom).toBe(b + 1)
  })

  it('普通行成嵌入（用户输入闭合）→ 表即时新增', () => {
    let state = EditorState.create({
      doc: '![[A\n尾段\n',
      extensions: [liveDecorationsField, mermaidFencesField, liveEmbedSpansField],
    })
    expect(state.field(liveEmbedSpansField)).toHaveLength(0)
    state = state.update({ changes: { from: 4, insert: ']]' } }).state
    const spans = state.field(liveEmbedSpansField)
    expect(spans).toHaveLength(1)
    expect(spans[0]!.inner).toBe('A')
  })
})

describe('Live 嵌入 widget 与装饰实例', () => {
  it('装饰实例缓存：同键复用、超限淘汰（RangeSet.eq 前提）', () => {
    const a = liveEmbedWidgetDeco('X', 10, 20, false)
    const b = liveEmbedWidgetDeco('X', 10, 20, false)
    expect(a).toBe(b)
    for (let i = 0; i < liveEmbedDecoCacheLimit + 4; i += 1) {
      liveEmbedWidgetDeco(`K${i}`, 100 + i, 110 + i, false)
    }
    const stale = liveEmbedWidgetDeco('X', 10, 20, false)
    expect(stale).not.toBe(a) // 已被淘汰，重建
  })

  it('below 形态与 inline 形态是不同装饰（eq 含 below/区间）', () => {
    const inline = liveEmbedWidgetDeco('X', 10, 20, false)
    const below = liveEmbedWidgetDeco('X', 10, 20, true)
    expect(inline).not.toBe(below)
    const w1 = new LiveEmbedWidget('X', 10, 20, false)
    expect(w1.eq(new LiveEmbedWidget('X', 10, 20, false))).toBe(true)
    expect(w1.eq(new LiveEmbedWidget('X', 10, 20, true))).toBe(false)
    expect(w1.eq(new LiveEmbedWidget('Y', 10, 20, false))).toBe(false)
    expect(w1.eq(new LiveEmbedWidget('X', 11, 20, false))).toBe(false)
  })

  it('widget 吞事件（ignoreEvent=true：点击不落父编辑器光标）与行高声明', () => {
    const w = new LiveEmbedWidget('X', 10, 20, false)
    expect(w.ignoreEvent()).toBe(true)
    expect(w.lineBreaks).toBe(1)
  })

  it('toDOM 经 setLiveEmbedCards 挂载卡片宿主（类名与 below 修饰），destroy 卸载', () => {
    const mounted: Array<{ inner: string; host: string }> = []
    const unmounted: HTMLElement[] = []
    const manager = {
      mountCardInto(el: HTMLElement, inner: string, _s: number, _e: number, host: string) {
        mounted.push({ inner, host })
        el.appendChild(document.createElement('div'))
      },
      unmountBlock(el: HTMLElement) {
        unmounted.push(el)
      },
    } as unknown as EmbedCardManager
    setLiveEmbedCards(manager)
    const w = new LiveEmbedWidget('目标', 6, 17, true)
    const dom = w.toDOM()
    expect(mounted).toEqual([{ inner: '目标', host: 'live' }])
    expect(dom.className).toContain(LIVE_EMBED_CLASS_NAMES.host)
    expect(dom.className).toContain(LIVE_EMBED_CLASS_NAMES.below)
    const inline = new LiveEmbedWidget('目标', 6, 17, false)
    const dom2 = inline.toDOM()
    expect(dom2.className).toContain(LIVE_EMBED_CLASS_NAMES.host)
    expect(dom2.className).not.toContain(LIVE_EMBED_CLASS_NAMES.below)
    w.destroy(dom)
    expect(unmounted).toHaveLength(1)
    setLiveEmbedCards(null)
  })

  it('setLiveEmbedCards(null) 后 toDOM 产空壳宿主不崩（dispose 时序防御）', () => {
    setLiveEmbedCards(null)
    const w = new LiveEmbedWidget('目标', 6, 17, false)
    const dom = w.toDOM()
    expect(dom.className).toContain(LIVE_EMBED_CLASS_NAMES.host)
    expect(w.destroy(dom)).toBeUndefined()
  })
})
