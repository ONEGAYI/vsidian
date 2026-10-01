// 父文档 Live 正文嵌入装饰契约（工单 #223/#247）：嵌入表 StateField（行级
// occurrence 扫描 + 增量重建——#247 起混排/列表/引用容器内嵌入同接入，不再
// 限于独占行）、跨容器卡片装饰（#247 起隐形态只替换嵌入精确区间 ![[…]] 本身，
// 前后文/列表标记/任务控件/引用前缀/缩进保留；显形态行下方 block widget——
// 光标/选区触及源码区间显形，离开隐藏；显隐谓词复用 selectionTouchesRange
// 语义）、代码/行内代码/注释/表格/链接文字域与 frontmatter 抑制边界、装饰
// 实例缓存。真实指针/IME/绘制验证在 test/browser 与集成层。
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
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

/** 装饰观测：StateField 直驱（跨行/block 装饰来自 StateField 的 CM6 约束）。
 *  hidden = 隐形态（块级整行 replace，from<to 区间）；显形态是行下方
 *  block widget（from===to 点位 + widget.below）——两形态块级化后以
 *  区间形态而非 block 位区分 */
function buildDecos(
  text: string,
  selection: EditorSelection,
): Array<{ from: number; to: number; block: boolean; hidden: boolean; widget: LiveEmbedWidget }> {
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
  const out: Array<{ from: number; to: number; block: boolean; hidden: boolean; widget: LiveEmbedWidget }> = []
  decos.between(0, text.length, (from, to, value) => {
    const spec = value.spec as { widget?: LiveEmbedWidget; block?: boolean }
    if (spec.widget) {
      out.push({ from, to, block: Boolean(spec.block), hidden: from < to, widget: spec.widget })
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
    expect(items[0]!.hidden).toBe(true)
    // inline replace（非 block）：行结构保留是键盘垂直导航可进入嵌入行的
    // 前提（块级 replace 被 CM6 跳过整行，实测 ArrowUp 落点越过区间）
    expect(items[0]!.block).toBe(false)
    expect(items[0]!.widget).toBeInstanceOf(LiveEmbedWidget)
    expect(items[0]!.widget!.inner).toBe('目标笔记')
    expect(items[0]!.widget!.below).toBe(false)
  })

  it('折叠光标命中嵌入源码区间内部或两端 → 源码显形（无替换装饰 + 行下方 block widget）', () => {
    for (const at of [LINE_FROM, LINE_FROM + 3, EMBED_TO]) {
      const items = buildDecos(DOC, EditorSelection.single(at))
      expect(items, `at=${at}`).toHaveLength(1)
      expect(items[0]!.hidden, `at=${at}`).toBe(false)
      expect(items[0]!.from, `at=${at}`).toBe(LINE_TO)
      expect(items[0]!.to, `at=${at}`).toBe(LINE_TO)
      expect(items[0]!.widget!.below, `at=${at}`).toBe(true)
    }
  })

  it('光标在区间相邻位置（! 前一格 / ]] 后一格）不显形（保持替换隐藏）', () => {
    const before = buildDecos(DOC, EditorSelection.single(LINE_FROM - 1))
    expect(before[0]!.hidden).toBe(true)
    const after = buildDecos(DOC, EditorSelection.single(EMBED_TO + 1))
    expect(after[0]!.hidden).toBe(true)
  })

  it('非空选区与区间严格重叠才显形：端点相接不重叠保持隐藏', () => {
    // 选区 [0, LINE_FROM)——止于区间左端（不含端点）：不重叠 → 隐藏
    const touching = buildDecos(DOC, EditorSelection.create([EditorSelection.range(0, LINE_FROM)]))
    expect(touching[0]!.hidden).toBe(true)
    // 选区 [0, LINE_FROM + 1)——跨过左端：严格重叠 → 显形
    const overlap = buildDecos(DOC, EditorSelection.create([EditorSelection.range(0, LINE_FROM + 1)]))
    expect(overlap[0]!.hidden).toBe(false)
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
    expect(items[0]!.hidden).toBe(false)
  })

  it('多枚嵌入：光标在第一枚内 → 其余保持隐藏形态（各自独立显隐）', () => {
    const text = '![[A]]\n![[B]]\n'
    const first = text.indexOf('![[A]]')
    const items = buildDecos(text, EditorSelection.single(first + 3))
    expect(items).toHaveLength(2)
    expect(items.filter((i) => !i.hidden)).toHaveLength(1)
    expect(items[0]!.hidden).toBe(false)
    expect(items[1]!.hidden).toBe(true)
  })

  it('行前缩进（≤3 空格）与尾随空白容忍：#247 起只替换嵌入精确区间（缩进/尾随空白保留）', () => {
    const text = '  ![[A]]  \n尾行'
    const items = buildDecos(text, EditorSelection.single(text.length))
    expect(items).toHaveLength(1)
    // 嵌入精确区间（`![[A]]` 本身）——缩进与尾随空白是行内容的一部分，
    // 不被整行替换吞掉（票据：既有缩进不被吞）
    expect(items[0]!.from).toBe(2)
    expect(items[0]!.to).toBe(2 + '![[A]]'.length)
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

  it('P2-1 跨模式分叉钉（Live 半边）：引用式链接 ref 未定义 → label 域排除不挂卡（Reading 半边在 embedSlots.test.ts 钉住挂卡）', () => {
    const text = '[foo ![[甲]] bar][undef] end'
    expect(buildDecos(text, EditorSelection.single(0))).toHaveLength(0)
  })

  it('图片 alt 域内嵌入不挂卡、同行他嵌入照常挂卡（与 Reading 终审 P1-1 修复对齐钉）', () => {
    const text = '![alt ![[甲]] alt2](http://u) then ![[乙]] more'
    const items = buildDecos(text, EditorSelection.single(0))
    expect(items.map((i) => i.widget!.inner)).toEqual(['乙'])
  })

  it('#247 起混排/列表/引用行照常产出（容器上下文接入）；#248 起表格格照常产出；未闭合仍不产出', () => {
    const text = [
      '前 ![[混排]] 后',
      '- ![[列表]]',
      '> ![[引用]]',
      '| ![[表格]] |',
      '| --- |',
      '![[未闭合',
      '尾段',
    ].join('\n')
    const items = buildDecos(text, EditorSelection.single(0))
    // 混排 + 无序 + 引用 + 表格格（#248 开放）四处挂卡；未闭合保持源文
    expect(items).toHaveLength(4)
    expect(items.map((i) => i.widget!.inner)).toEqual(['混排', '列表', '引用', '表格'])
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

  it('DOM 层：隐形态整行替换（源文文本退场，宿主块级 div 在行内）', () => {
    const view = new EditorView({
      parent: document.body.appendChild(document.createElement('div')),
      state: EditorState.create({
        doc: DOC,
        extensions: [liveDecorationsField, mermaidFencesField, liveEmbed],
        selection: EditorSelection.single(0), // 未触及 → 隐形态
      }),
    })
    const host = view.contentDOM.querySelector('.vsidian-live-embed')
    expect(host).not.toBeNull()
    // inline replace：宿主在 .cm-line 内（行结构保留——键盘垂直导航前提），
    // 块级对齐与 buffer 隐藏由 CSS 承担（embedCardCssContract 钉住规则）
    expect(host!.tagName).toBe('DIV')
    expect(host!.classList.contains('vsidian-live-embed-below')).toBe(false)
    const embedLine = Array.from(view.contentDOM.querySelectorAll('.cm-line'))
      .find((line) => line.textContent?.includes('目标笔记') && !line.contains(host))
    expect(embedLine).toBeUndefined()
    view.destroy()
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
    const a = liveEmbedWidgetDeco('X', 10, 20, 10, 20, false)
    const b = liveEmbedWidgetDeco('X', 10, 20, 10, 20, false)
    expect(a).toBe(b)
    for (let i = 0; i < liveEmbedDecoCacheLimit + 4; i += 1) {
      liveEmbedWidgetDeco(`K${i}`, 100 + i, 110 + i, 100 + i, 110 + i, false)
    }
    const stale = liveEmbedWidgetDeco('X', 10, 20, 10, 20, false)
    expect(stale).not.toBe(a) // 已被淘汰，重建
  })

  it('below 形态与 inline 形态是不同装饰（eq 含 below/区间/key 区间）', () => {
    const inline = liveEmbedWidgetDeco('X', 10, 20, 10, 20, false)
    const below = liveEmbedWidgetDeco('X', 10, 20, 10, 20, true)
    expect(inline).not.toBe(below)
    const w1 = new LiveEmbedWidget('X', 10, 20, 10, 20, false)
    expect(w1.eq(new LiveEmbedWidget('X', 10, 20, 10, 20, false))).toBe(true)
    expect(w1.eq(new LiveEmbedWidget('X', 10, 20, 10, 20, true))).toBe(false)
    expect(w1.eq(new LiveEmbedWidget('Y', 10, 20, 10, 20, false))).toBe(false)
    expect(w1.eq(new LiveEmbedWidget('X', 11, 20, 11, 20, false))).toBe(false)
    // key 区间（sole/occurrence 语义）不同即不同实例——跨模式状态键隔离
    expect(w1.eq(new LiveEmbedWidget('X', 10, 20, 12, 18, false))).toBe(false)
  })

  it('widget 吞事件（ignoreEvent=true：点击不落父编辑器光标）与行高声明', () => {
    const w = new LiveEmbedWidget('X', 10, 20, 10, 20, false)
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
    const w = new LiveEmbedWidget('目标', 6, 17, 6, 17, true)
    const dom = w.toDOM()
    expect(mounted).toEqual([{ inner: '目标', host: 'live' }])
    expect(dom.className).toContain(LIVE_EMBED_CLASS_NAMES.host)
    expect(dom.className).toContain(LIVE_EMBED_CLASS_NAMES.below)
    const inline = new LiveEmbedWidget('目标', 6, 17, 6, 17, false)
    const dom2 = inline.toDOM()
    expect(dom2.className).toContain(LIVE_EMBED_CLASS_NAMES.host)
    expect(dom2.className).not.toContain(LIVE_EMBED_CLASS_NAMES.below)
    w.destroy(dom)
    expect(unmounted).toHaveLength(1)
    setLiveEmbedCards(null)
  })

  it('setLiveEmbedCards(null) 后 toDOM 产空壳宿主不崩（dispose 时序防御）', () => {
    setLiveEmbedCards(null)
    const w = new LiveEmbedWidget('目标', 6, 17, 6, 17, false)
    const dom = w.toDOM()
    expect(dom.className).toContain(LIVE_EMBED_CLASS_NAMES.host)
    expect(w.destroy(dom)).toBeUndefined()
  })
})

describe('#247 Live 混排与容器：occurrence 精确替换', () => {
  /** 混排文档：段落混排 / 无序 / 任务 / 引用 / 同行双嵌入 */
  const MIXED_DOC = [
    '# 标题',
    '',
    '前文 ![[目标笔记]] 后文',
    '',
    '- 无序项 ![[目标笔记]] 余文',
    '- [ ] 任务项 ![[目标笔记]] 余文',
    '',
    '> 引文 ![[目标笔记]] 引后',
    '',
    '起 ![[甲笔记]] 中 ![[乙笔记]] 末',
    '',
    '尾段。',
  ].join('\n')
  const MIXED_AT = (inner: string, nth = 0): number => {
    let from = -1
    for (let i = 0; i <= nth; i += 1) {
      from = MIXED_DOC.indexOf(`![[${inner}]]`, from + 1)
    }
    return from
  }

  it('段落混排隐形态只替换嵌入精确区间（前后文不被吞）', () => {
    const at = MIXED_AT('目标笔记')
    const items = buildDecos(MIXED_DOC, EditorSelection.single(0))
    const para = items.find((i) => i.from === at)!
    expect(para).toBeDefined()
    expect(para.to).toBe(at + '![[目标笔记]]'.length)
    expect(para.hidden).toBe(true)
    expect(para.block).toBe(false)
  })

  it('列表标记/任务控件/引用前缀所在行的嵌入照常挂卡且区间精确', () => {
    const items = buildDecos(MIXED_DOC, EditorSelection.single(0))
    expect(items).toHaveLength(6)
    for (const inner of ['目标笔记', '甲笔记', '乙笔记']) {
      const hit = MIXED_DOC.indexOf(`![[${inner}]]`)
      expect(items.some((i) => i.from === hit), `${inner} 精确起点`).toBe(true)
    }
    // 每条替换区间都与嵌入原文等长（不吞列表标记/任务控件/引用前缀）
    for (const i of items) {
      expect(i.to - i.from).toBe(`![[${i.widget!.inner}]]`.length)
    }
  })

  it('DOM 层：混排行前文与后文文本仍渲染在行内（源文不丢字）', () => {
    const view = new EditorView({
      parent: document.body.appendChild(document.createElement('div')),
      state: EditorState.create({
        doc: MIXED_DOC,
        extensions: [liveDecorationsField, mermaidFencesField, liveEmbed],
        selection: EditorSelection.single(0),
      }),
    })
    const lines = Array.from(view.contentDOM.querySelectorAll('.cm-line'))
    const para = lines.find((l) => (l.textContent ?? '').includes('前文'))
    expect(para).toBeDefined()
    expect(para!.textContent).toContain('前文')
    expect(para!.textContent).toContain('后文')
    // 嵌入原文文本退场（卡片宿主取代），前后文保留
    expect(para!.textContent).not.toContain('![[目标笔记]]')
    expect(para!.querySelector(`.${LIVE_EMBED_CLASS_NAMES.host}`)).not.toBeNull()
    view.destroy()
  })

  it('同行双嵌入互不吞并：两枚独立替换、兄弟独立显隐', () => {
    const aAt = MIXED_AT('甲笔记')
    const bAt = MIXED_AT('乙笔记')
    // 光标远端：两枚都隐藏
    let items = buildDecos(MIXED_DOC, EditorSelection.single(0))
    expect(items.filter((i) => i.from === aAt || i.from === bAt)).toHaveLength(2)
    // 光标进甲区间 → 甲显形（below widget 在行尾），乙保持隐藏
    items = buildDecos(MIXED_DOC, EditorSelection.single(aAt + 4))
    const a = items.find((i) => i.widget!.inner === '甲笔记')!
    const b = items.find((i) => i.widget!.inner === '乙笔记')!
    expect(a.hidden).toBe(false)
    expect(a.from).toBe(a.to) // 显形态是行下方 block widget（点位）
    expect(b.hidden).toBe(true)
    expect(b.from).toBe(bAt)
  })

  it('相邻文字光标不显形（反例：不扩大到相邻文字/整行）', () => {
    const text = '前 ![[A]] 间 ![[B]] 尾'
    const aAt = text.indexOf('![[A]]')
    const bAt = text.indexOf('![[B]]')
    // 光标在两嵌入之间的文字「间」上：都不显形
    const items = buildDecos(text, EditorSelection.single(aAt + '![[A]]'.length + 1))
    expect(items).toHaveLength(2)
    expect(items.every((i) => i.hidden)).toBe(true)
    // 光标在 A 区间两端点（from/to）→ A 显形、B 仍隐藏
    for (const at of [aAt, aAt + '![[A]]'.length]) {
      const sel = buildDecos(text, EditorSelection.single(at))
      expect(sel.find((i) => i.widget!.inner === 'A')!.hidden, `at=${at}`).toBe(false)
      expect(sel.find((i) => i.widget!.inner === 'B')!.hidden, `at=${at}`).toBe(true)
    }
    // 票据反例：bAt 恰好相邻场景文字——光标在 B 前一格（A 区间外与 B 区间外）
    const between = bAt - 1
    const selBetween = buildDecos(text, EditorSelection.single(between))
    expect(selBetween.every((i) => i.hidden), 'B 左侧相邻文字不使 B 显形').toBe(true)
  })

  it('链接文字域内嵌入不挂卡（保持源文，与 Reading 呈现对齐）', () => {
    const text = '链接 [文字 ![[甲]] 形态](https://e.example/x) 不升级。'
    expect(buildDecos(text, EditorSelection.single(0))).toHaveLength(0)
  })

  it('表格格内嵌入挂卡（#248 开放）；行内代码与注释内不挂卡', () => {
    const text = [
      '| a | b |',
      '| --- | --- |',
      '| 格内 ![[甲]] | x |',
      '',
      '`code ![[乙]] end` 与正文。',
      '',
      '<!-- 注释 ![[丙]] -->',
      '',
      '正文 ![[丁]] 尾。',
    ].join('\n')
    const items = buildDecos(text, EditorSelection.single(0))
    expect(items).toHaveLength(2)
    expect(items.map((i) => i.widget!.inner)).toEqual(['甲', '丁'])
  })

  it('嵌套列表/懒续行/引用内列表组合的嵌入照常挂卡', () => {
    const text = [
      '- 外层',
      '  - 内层 ![[甲]] 余',
      '  懒续 ![[乙]] 续余',
      '',
      '> - 引用列表 ![[丙]] 余',
      '>   嵌套懒续 ![[丁]] 余',
    ].join('\n')
    const items = buildDecos(text, EditorSelection.single(0))
    expect(items.map((i) => i.widget!.inner).sort()).toEqual(['丙', '乙', '丁', '甲'].sort())
  })
})

describe('#247 Live 嵌入表：occurrence 化增量与宿主 key', () => {
  it('混排嵌入表：编辑前后文不影响嵌入区间（窗口外映射不漂移）', () => {
    const text = '前 ![[甲]] 后\n\n中间段。\n\n起 ![[乙]] 末\n'
    let state = EditorState.create({
      doc: text,
      extensions: [liveDecorationsField, mermaidFencesField, liveEmbedSpansField],
    })
    const bAt = text.indexOf('![[乙]]')
    state = state.update({ changes: { from: text.indexOf('中间段。'), insert: '改' } }).state
    const spans = state.field(liveEmbedSpansField)
    expect(spans).toHaveLength(2)
    expect(spans[1]!.from).toBe(bAt + 1)
    expect(spans[1]!.to).toBe(bAt + 1 + '![[乙]]'.length)
  })

  it('混排未闭合撤下、恢复闭合重载（同行其余嵌入不受牵连）', () => {
    const text = '前 ![[甲]] 中 ![[乙]] 后'
    const bAt = text.indexOf('![[乙]]')
    let state = EditorState.create({
      doc: text,
      extensions: [liveDecorationsField, mermaidFencesField, liveEmbedSpansField],
    })
    expect(state.field(liveEmbedSpansField)).toHaveLength(2)
    // 删除乙的闭合括号 → 乙撤下、甲保留
    state = state.update({ changes: { from: bAt + '![[乙]]'.length - 2, to: bAt + '![[乙]]'.length, insert: '' } }).state
    let spans = state.field(liveEmbedSpansField)
    expect(spans).toHaveLength(1)
    expect(spans[0]!.inner).toBe('甲')
    // 恢复闭合（`乙` 之后）→ 乙按新引用回归
    state = state.update({ changes: { from: bAt + 4, insert: ']]' } }).state
    spans = state.field(liveEmbedSpansField)
    expect(spans).toHaveLength(2)
    expect(spans[1]!.inner).toBe('乙')
  })

  it('目标改写（inner 变更）→ 旧 occurrence 撤下、新 occurrence 入表', () => {
    const text = '前 ![[甲]] 后'
    let state = EditorState.create({
      doc: text,
      extensions: [liveDecorationsField, mermaidFencesField, liveEmbedSpansField],
    })
    const at = text.indexOf('甲')
    state = state.update({ changes: { from: at, to: at + 1, insert: '乙' } }).state
    const spans = state.field(liveEmbedSpansField)
    expect(spans).toHaveLength(1)
    expect(spans[0]!.inner).toBe('乙')
  })

  it('独占行 key 语义保持行首（跨模式状态共享），混排 key 为嵌入起点', () => {
    const mounted: Array<{ inner: string; start: number; end: number }> = []
    const manager = {
      mountCardInto(el: HTMLElement, inner: string, start: number, end: number) {
        mounted.push({ inner, start, end })
        el.appendChild(document.createElement('div'))
      },
      unmountBlock() {},
    } as unknown as EmbedCardManager
    setLiveEmbedCards(manager)
    const view = new EditorView({
      parent: document.body.appendChild(document.createElement('div')),
      state: EditorState.create({
        doc: '  ![[独占行]]\n\n前 ![[混排]] 后\n',
        extensions: [liveDecorationsField, mermaidFencesField, liveEmbed],
        selection: EditorSelection.single(0),
      }),
    })
    try {
      expect(mounted).toHaveLength(2)
      // 独占行（含缩进）：key 区间 = 行首..行尾（Reading 独占行块同源）
      expect(mounted[0]!.inner).toBe('独占行')
      expect(mounted[0]!.start).toBe(0)
      expect(mounted[0]!.end).toBe('  ![[独占行]]'.length)
      // 混排：key 区间 = 嵌入精确区间（Reading 混排提升宿主同源）
      const mixAt = '  ![[独占行]]\n\n前 '.length
      expect(mounted[1]!.inner).toBe('混排')
      expect(mounted[1]!.start).toBe(mixAt)
      expect(mounted[1]!.end).toBe(mixAt + '![[混排]]'.length)
    } finally {
      view.destroy()
      setLiveEmbedCards(null)
    }
  })

  it('显隐探针口径（collectLiveEmbedReveal 数据源）：混排 occurrence 的 revealed 按精确区间', () => {
    const text = '前 ![[甲]] 后'
    const aAt = text.indexOf('![[甲]]')
    const far = EditorState.create({
      doc: text,
      extensions: [liveDecorationsField, mermaidFencesField, liveEmbedSpansField],
    })
    expect(far.field(liveEmbedSpansField)[0]!.from).toBe(aAt)
    const near = far.update({ selection: { anchor: aAt + 2 } }).state
    expect(near.field(liveEmbedSpansField)[0]!.from).toBe(aAt)
  })
})

describe('#248 表格格内嵌入：解码 inner 与精确显隐', () => {
  const TABLE = [
    '| 头 | 头 |',
    '| --- | --- |',
    '| a | ![[B\\|别名]] |',
  ].join('\n')
  const EMBED_AT = TABLE.indexOf('![[B\\|别名]]')
  const EMBED_END = EMBED_AT + '![[B\\|别名]]'.length

  it('表格行的嵌入表条目为解码 inner、源码区间（scanEmbedSpansInLines 表格感知）', () => {
    let state = EditorState.create({
      doc: TABLE,
      extensions: [liveDecorationsField, mermaidFencesField, liveEmbedSpansField],
    })
    const spans = state.field(liveEmbedSpansField)
    expect(spans).toHaveLength(1)
    expect(spans[0]!.inner).toBe('B|别名')
    expect(spans[0]!.from).toBe(EMBED_AT)
    expect(spans[0]!.to).toBe(EMBED_END)
    // sole 为 false（混排格——宿主 key 取嵌入精确区间）
    expect(spans[0]!.sole).toBe(false)
  })

  it('格内嵌入隐形态：发射 inline replace（widget.inner 解码语义）', () => {
    const items = buildDecos(TABLE, EditorSelection.single(0))
    expect(items).toHaveLength(1)
    expect(items[0]!.hidden).toBe(true)
    expect(items[0]!.block).toBe(false)
    expect(items[0]!.from).toBe(EMBED_AT)
    expect(items[0]!.to).toBe(EMBED_END)
    expect(items[0]!.widget!.inner).toBe('B|别名')
  })

  it('光标触及格内嵌入区间 → 源码显形（行下方 block widget）；未触及保持隐藏', () => {
    const touched = buildDecos(TABLE, EditorSelection.single(EMBED_AT + 4))
    expect(touched[0]!.hidden).toBe(false)
    expect(touched[0]!.widget!.below).toBe(true)
    const idle = buildDecos(TABLE, EditorSelection.single(TABLE.indexOf('头')))
    expect(idle[0]!.hidden).toBe(true)
  })

  it('同格多引用：各自独立替换与显隐', () => {
    const text = '| x ![[A]] y ![[B\\|b]] z |\n| --- |'
    const idle = buildDecos(text, EditorSelection.single(0))
    expect(idle.map((i) => i.widget!.inner)).toEqual(['A', 'B|b'])
    const inSecond = text.indexOf('![[B\\|b]]') + 5
    const touched = buildDecos(text, EditorSelection.single(inSecond))
    const hiddenStates = touched.map((i) => i.hidden)
    expect(hiddenStates).toEqual([true, false])
  })

  it('表格行内 code span 中的嵌入字面量不发射', () => {
    const text = '| `![[C]]` | b |\n| --- | --- |\n| c | d |'
    expect(buildDecos(text, EditorSelection.single(0))).toHaveLength(0)
  })

  it('增量重建：格内嵌入编辑后表更新（区间随源文变化）', () => {
    let state = EditorState.create({
      doc: TABLE,
      extensions: [liveDecorationsField, mermaidFencesField, liveEmbedSpansField],
    })
    // 把别名改为更短的 inner（区间缩短）
    state = state
      .update({ changes: { from: EMBED_AT + 3, to: EMBED_END - 2, insert: 'C' } })
      .state
    const spans = state.field(liveEmbedSpansField)
    expect(spans).toHaveLength(1)
    expect(spans[0]!.inner).toBe('C')
    expect(state.doc.sliceString(spans[0]!.from, spans[0]!.to)).toBe('![[C]]')
  })
})

describe('#248 P1-1 消费者一致性：`]]` 紧贴转义管道的端点映射', () => {
  it('嵌入表与发射区间 slice 严格等于嵌入原文（不多含转义反斜杠）', () => {
    const text = '| ![[B]]\\|尾 | y |\n| --- | --- |\n| a | b |'
    let state = EditorState.create({
      doc: text,
      extensions: [liveDecorationsField, mermaidFencesField, liveEmbedSpansField],
    })
    const spans = state.field(liveEmbedSpansField)
    expect(spans).toHaveLength(1)
    expect(text.slice(spans[0]!.from, spans[0]!.to)).toBe('![[B]]')
    expect(text[spans[0]!.to]).toBe('\\')
    // 隐形态 replace 区间 = 同一 span 区间（buildDecos 发射层）
    const items = buildDecos(text, EditorSelection.single(0))
    expect(items).toHaveLength(1)
    expect(items[0]!.from).toBe(spans[0]!.from)
    expect(items[0]!.to).toBe(spans[0]!.to)
    expect(items[0]!.widget!.inner).toBe('B')
  })
})
