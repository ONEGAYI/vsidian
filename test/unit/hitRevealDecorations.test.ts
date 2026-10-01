// 命中显形（#251）装饰层契约：活跃命中（查找匹配/选词会话选区）触界的
// 装饰隐藏区回源显形——grid 行不加网格行类（竖线等结构源码可见）、分隔行
// 不加网格隐藏类、表格外转义符换挂显形类；块级公式/Mermaid/代码卡片/
// 独行图片的替换区间命中相交时回源码呈现。恢复时机随命中集清空；关面板
// 瞬间选区仍触界的显形行停驻保持、选区离开恢复。硬边界：编辑选区触界不
// 引发 grid 竖线显形（表格网格核心体验零回归）。
// 断言分两层：装饰构建（buildLivePreviewDecorations 直驱 + hitReveal 参数）
// 与真实 EditorView DOM（livePreviewDecorations + findDecorations 全装配，
// 装饰构建层过不等于 DOM 层挂载）。
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { EditorSelection, EditorState, Text, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  LIVE_CLASS_NAMES,
  buildLivePreviewDecorations,
  livePreviewDecorations,
} from '../../src/webview/liveDecorations'
import { findDecorations, setFindMatches } from '../../src/webview/findSession'
import { setOccurrenceHitActive, type HitRevealContext } from '../../src/webview/hitReveal'

if (typeof Range !== 'undefined' && Range.prototype.getClientRects === undefined) {
  ;(Range.prototype as unknown as { getClientRects(): DOMRectList }).getClientRects =
    () => [] as unknown as DOMRectList
  ;(Range.prototype as unknown as { getBoundingClientRect(): DOMRect }).getBoundingClientRect =
    () => new DOMRect(0, 0, 0, 0)
}

const TABLE_DOC = [
  '# 标题',
  '',
  '| 名字 | 数量 |',
  '| --- | :---: |',
  '| 苹果 | 3 |',
  '| 香蕉 | 4 |',
  '',
  '转义 \\*literal\\* 行',
  '',
].join('\n')

function lineOf(doc: string, n: number): { from: number; to: number } {
  const lines = doc.split('\n')
  const from = lines.slice(0, n - 1).join('\n').length + (n > 1 ? 1 : 0)
  return { from, to: from + lines[n - 1]!.length }
}

function lineClasses(view: EditorView, lineNo: number): string[] {
  const line = view.contentDOM.querySelectorAll<HTMLElement>('.cm-line')[lineNo - 1]!
  return (line.className || '').split(' ').filter(Boolean)
}

function makeView(doc: string, extra: readonly Extension[] = []): EditorView {
  return new EditorView({
    parent: document.body.appendChild(document.createElement('div')),
    state: EditorState.create({
      doc,
      extensions: [
        EditorState.allowMultipleSelections.of(true),
        livePreviewDecorations,
        findDecorations,
        ...extra,
      ],
      selection: EditorSelection.single(doc.length),
    }),
  })
}

// ---- 构建层：显形计划（命中集 → 行/块显形决策） ----

describe('命中显形装饰构建（grid 行/分隔行/转义符）', () => {
  const header = lineOf(TABLE_DOC, 3)
  const delimiter = lineOf(TABLE_DOC, 4)
  const row1 = lineOf(TABLE_DOC, 5)
  const escape = lineOf(TABLE_DOC, 8)

  function buildWith(hits: Array<{ from: number; to: number }>): Map<string, Set<number>> {
    const ctx: HitRevealContext = { hits, stickyLines: new Set<number>() }
    const set = buildLivePreviewDecorations(Text.of(TABLE_DOC.split('\n')), EditorSelection.single(0), null, ctx)
    const out = new Map<string, Set<number>>()
    set.between(0, TABLE_DOC.length, (from, _to, deco) => {
      const cls = deco.spec.class
      if (!cls) return
      for (const c of cls.split(' ')) {
        if (!out.has(c)) out.set(c, new Set())
        out.get(c)!.add(TABLE_DOC.slice(0, from).split('\n').length)
      }
    })
    return out
  }

  it('命中触界 grid 行：该行不加网格行类（回源），未命中行保持网格', () => {
    const got = buildWith([{ from: row1.from + 2, to: row1.from + 4 }])
    expect(got.get(LIVE_CLASS_NAMES.tableGridRow)).toEqual(new Set([3, 6])) // 表头 + 香蕉行
    expect(got.get(LIVE_CLASS_NAMES.tableDelimiterLine)).toBeDefined()
  })

  it('命中分隔行内容：分隔行不加网格隐藏类（与光标停驻同款类缺席）', () => {
    const got = buildWith([{ from: delimiter.from + 1, to: delimiter.from + 5 }])
    expect(got.get(LIVE_CLASS_NAMES.tableGridDelimiter)).toBeUndefined()
    // 其余网格行不受扰
    expect(got.get(LIVE_CLASS_NAMES.tableGridRow)).toEqual(new Set([3, 5, 6]))
  })

  it('命中表头行：表头回源（网格行类缺席）', () => {
    const got = buildWith([{ from: header.from + 1, to: header.from + 3 }])
    expect(got.get(LIVE_CLASS_NAMES.tableGridRow)).toEqual(new Set([5, 6]))
  })

  it('命中转义符所在行：反斜杠换挂显形类（触界来源推广）', () => {
    const star = TABLE_DOC.indexOf('\\*')
    const got = buildWith([{ from: escape.from, to: escape.from + 3 }])
    const set = buildLivePreviewDecorations(Text.of(TABLE_DOC.split('\n')), EditorSelection.single(0), null,
      { hits: [{ from: escape.from, to: escape.from + 3 }], stickyLines: new Set() })
    const revealRanges: string[] = []
    const hiddenRanges: string[] = []
    set.between(escape.from, escape.to, (from, to, deco) => {
      const cls = deco.spec.class ?? ''
      if (cls.split(' ').includes(LIVE_CLASS_NAMES.escapeReveal)) revealRanges.push(TABLE_DOC.slice(from, to))
      if (cls.split(' ').includes(LIVE_CLASS_NAMES.escape)) hiddenRanges.push(TABLE_DOC.slice(from, to))
    })
    expect(star).toBeGreaterThan(0)
    expect(revealRanges).toEqual(['\\', '\\'])
    expect(hiddenRanges).toEqual([])
    expect(got).toBeDefined() // flake guard：上方集合断言为主
  })

  it('未命中时（空命中集）：全部行为既有网格呈现（零变化）', () => {
    const got = buildWith([])
    expect(got.get(LIVE_CLASS_NAMES.tableGridRow)).toEqual(new Set([3, 5, 6]))
    expect(got.get(LIVE_CLASS_NAMES.tableGridDelimiter)).toBeDefined()
  })

  it('停驻行同款回源（stickyLines 参与 grid 行判定）', () => {
    const ctx: HitRevealContext = { hits: [], stickyLines: new Set([5]) }
    const set = buildLivePreviewDecorations(Text.of(TABLE_DOC.split('\n')), EditorSelection.single(0), null, ctx)
    const gridRows: number[] = []
    set.between(0, TABLE_DOC.length, (from, _to, deco) => {
      if (deco.spec.class?.split(' ').includes(LIVE_CLASS_NAMES.tableGridRow)) {
        gridRows.push(TABLE_DOC.slice(0, from).split('\n').length)
      }
    })
    expect(gridRows.sort()).toEqual([3, 6])
  })
})

// ---- DOM 层：全装配驱动（setFindMatches / 会话效应 → 行类与恢复） ----

describe('命中显形 DOM 层（查找面板链路）', () => {
  const row1 = lineOf(TABLE_DOC, 5)

  it('命中 grid 行：DOM 行无网格行类；面板关闭（matches 清空）即恢复网格', () => {
    const view = makeView(TABLE_DOC)
    view.dispatch({ effects: setFindMatches.of({ matches: [{ from: row1.from + 2, to: row1.from + 4 }], index: 0 }) })
    expect(lineClasses(view, 5)).not.toContain(LIVE_CLASS_NAMES.tableGridRow)
    expect(lineClasses(view, 3)).toContain(LIVE_CLASS_NAMES.tableGridRow)
    expect(lineClasses(view, 6)).toContain(LIVE_CLASS_NAMES.tableGridRow)
    view.dispatch({ effects: setFindMatches.of({ matches: [], index: 0 }) })
    expect(lineClasses(view, 5)).toContain(LIVE_CLASS_NAMES.tableGridRow)
    view.destroy()
  })

  it('硬边界：编辑选区覆盖 grid 行不引发竖线显形（既有网格体验零回归）', () => {
    const view = makeView(TABLE_DOC)
    // 空光标进入 + 跨行非空选区覆盖——两条路径都不显形
    view.dispatch({ selection: { anchor: row1.from + 3 } })
    expect(lineClasses(view, 5)).toContain(LIVE_CLASS_NAMES.tableGridRow)
    view.dispatch({ selection: EditorSelection.single(row1.from - 2, row1.to + 2) })
    expect(lineClasses(view, 5)).toContain(LIVE_CLASS_NAMES.tableGridRow)
    expect(lineClasses(view, 3)).toContain(LIVE_CLASS_NAMES.tableGridRow)
    view.destroy()
  })

  it('选词会话在场：选区触界 grid 行回源；会话结束转停驻、选区离开恢复', () => {
    const view = makeView(TABLE_DOC)
    view.dispatch({
      selection: EditorSelection.range(row1.from + 2, row1.from + 4),
      effects: setOccurrenceHitActive.of(true),
    })
    expect(lineClasses(view, 5)).not.toContain(LIVE_CLASS_NAMES.tableGridRow)
    // 会话结束（选区未动）：与面板关闭同款停驻——光标仍触界保持显形
    view.dispatch({ effects: setOccurrenceHitActive.of(false) })
    expect(lineClasses(view, 5)).not.toContain(LIVE_CLASS_NAMES.tableGridRow)
    view.dispatch({ selection: { anchor: 0 } })
    expect(lineClasses(view, 5)).toContain(LIVE_CLASS_NAMES.tableGridRow)
    view.destroy()
  })

  it('停驻：清空瞬间选区停在显形行 → 保持回源；选区离开 → 恢复', () => {
    const view = makeView(TABLE_DOC)
    // 查找驱动选区落在命中行（分隔行场景同款），面板关闭
    view.dispatch({ selection: { anchor: row1.from + 3 } })
    view.dispatch({ effects: setFindMatches.of({ matches: [{ from: row1.from + 2, to: row1.from + 4 }], index: 0 }) })
    expect(lineClasses(view, 5)).not.toContain(LIVE_CLASS_NAMES.tableGridRow)
    view.dispatch({ effects: setFindMatches.of({ matches: [], index: 0 }) })
    // 光标仍触界该行：停驻保持显形（避免关面板后光标落在隐形文本）
    expect(lineClasses(view, 5)).not.toContain(LIVE_CLASS_NAMES.tableGridRow)
    view.dispatch({ selection: { anchor: 0 } })
    expect(lineClasses(view, 5)).toContain(LIVE_CLASS_NAMES.tableGridRow)
    view.destroy()
  })

  it('编辑选区无停驻副作用：无命中的选区清空后不显形（粘滞只来自旧显形行）', () => {
    const view = makeView(TABLE_DOC)
    view.dispatch({ selection: EditorSelection.single(row1.from - 2, row1.to + 2) })
    view.dispatch({ selection: { anchor: row1.from + 3 } })
    expect(lineClasses(view, 5)).toContain(LIVE_CLASS_NAMES.tableGridRow)
    view.destroy()
  })
})

// ---- DOM 层：替换块回源 ----

describe('替换块命中回源（DOM 层）', () => {
  const MATH_DOC = [
    '前文',
    '',
    '$$',
    'a + b',
    '$$',
    '',
    '```mermaid',
    'graph TD; A-->B;',
    '```',
    '',
    '```js',
    'let x = 1',
    '```',
    '',
    '![alt](pic.png)',
    '',
  ].join('\n')

  it('块级公式命中：源码 mark 在场、渲染 widget 退场；清空恢复', async () => {
    const { liveMath } = await import('../../src/webview/liveMath')
    const { MATH_CLASS_NAMES } = await import('../../src/shared/math')
    const view = makeView(MATH_DOC, [liveMath])
    const fence = MATH_DOC.indexOf('a + b')
    expect(view.contentDOM.querySelector(`.${MATH_CLASS_NAMES.math}`)).not.toBeNull()
    view.dispatch({ effects: setFindMatches.of({ matches: [{ from: fence, to: fence + 1 }], index: 0 }) })
    expect(view.contentDOM.querySelector(`.${MATH_CLASS_NAMES.math}`)).toBeNull()
    expect(view.contentDOM.querySelector(`.${MATH_CLASS_NAMES.mathSource}`)).not.toBeNull()
    view.dispatch({ effects: setFindMatches.of({ matches: [], index: 0 }) })
    expect(view.contentDOM.querySelector(`.${MATH_CLASS_NAMES.math}`)).not.toBeNull()
    view.destroy()
  })

  it('Mermaid 围栏命中：渲染装饰退场；清空恢复', async () => {
    const mermaid = await import('../../src/webview/liveMermaid')
    const view = makeView(MATH_DOC, [mermaid.liveMermaid])
    const code = MATH_DOC.indexOf('graph TD')
    expect(view.state.field(mermaid.mermaidDecorations).size).toBe(1)
    view.dispatch({ effects: setFindMatches.of({ matches: [{ from: code, to: code + 5 }], index: 0 }) })
    expect(view.state.field(mermaid.mermaidDecorations).size).toBe(0)
    view.dispatch({ effects: setFindMatches.of({ matches: [], index: 0 }) })
    expect(view.state.field(mermaid.mermaidDecorations).size).toBe(1)
    view.destroy()
  })

  it('代码卡片命中：围栏行源码可见（编辑态），不再命中恢复卡片清空形态', async () => {
    const { liveCodeCard, codeCardConfigFacet } = await import('../../src/webview/liveCodeCard')
    const { mermaidFencesField } = await import('../../src/webview/liveMermaid')
    const view = makeView(MATH_DOC, [
      mermaidFencesField,
      liveCodeCard,
      codeCardConfigFacet.of({ card: true, lineNumbers: true, copyButton: true, highlight: false }),
    ])
    const code = MATH_DOC.indexOf('let x')
    // 呈现态：开围栏行（第 11 行，index 10）内容被清空装饰覆盖
    const fenceLine = () => view.contentDOM.querySelectorAll<HTMLElement>('.cm-line')[10]!
    expect(fenceLine().textContent).not.toContain('```js')
    view.dispatch({ effects: setFindMatches.of({ matches: [{ from: code, to: code + 3 }], index: 0 }) })
    // 命中回源：围栏行源码显形（editing 形态）
    expect(fenceLine().textContent).toContain('```js')
    view.dispatch({ effects: setFindMatches.of({ matches: [], index: 0 }) })
    expect(fenceLine().textContent).not.toContain('```js')
    view.destroy()
  })

  it('独行图片命中：图片 widget 退场、源码可见；清空恢复', async () => {
    const { createLinkInteractions } = await import('../../src/webview/liveLinks')
    const { ImageResourceManager } = await import('../../src/webview/imageResource')
    const images = new ImageResourceManager({
      isDirectSrc: () => true,
      requestHost: () => {},
    })
    const view = makeView(MATH_DOC, [
      createLinkInteractions({ postActivate: () => {}, images, postActivateWikilink: () => {} }),
    ])
    expect(view.contentDOM.querySelector('img')).not.toBeNull()
    const src = MATH_DOC.indexOf('pic.png')
    view.dispatch({ effects: setFindMatches.of({ matches: [{ from: src, to: src + 3 }], index: 0 }) })
    expect(view.contentDOM.querySelector('img')).toBeNull()
    expect(view.contentDOM.querySelectorAll('.cm-line')[14]!.textContent).toContain('![alt](pic.png)')
    view.dispatch({ effects: setFindMatches.of({ matches: [], index: 0 }) })
    expect(view.contentDOM.querySelector('img')).not.toBeNull()
    view.destroy()
  })

  // ---- 负向边界（票面钉住：行内公式/行内混排图片不计入回源） ----

  it('行内公式命中：渲染装饰保持（不回源——票面块级口径）', async () => {
    const { liveMath } = await import('../../src/webview/liveMath')
    const { MATH_CLASS_NAMES } = await import('../../src/shared/math')
    const doc = ['前文 $x + 1$ 后文', ''].join('\n')
    const view = makeView(doc, [liveMath])
    expect(view.contentDOM.querySelector(`.${MATH_CLASS_NAMES.math}`)).not.toBeNull()
    const x = doc.indexOf('x')
    view.dispatch({ effects: setFindMatches.of({ matches: [{ from: x, to: x + 1 }], index: 0 }) })
    // 行内命中不触发回源：渲染装饰在场、源码 mark 不出现
    expect(view.contentDOM.querySelector(`.${MATH_CLASS_NAMES.math}`)).not.toBeNull()
    expect(view.contentDOM.querySelector(`.${MATH_CLASS_NAMES.mathSource}`)).toBeNull()
    view.destroy()
  })

  it('行内混排图片命中：图片 widget 保持（不回源——独行口径）', async () => {
    const { createLinkInteractions } = await import('../../src/webview/liveLinks')
    const { ImageResourceManager } = await import('../../src/webview/imageResource')
    const images = new ImageResourceManager({
      isDirectSrc: () => true,
      requestHost: () => {},
    })
    const doc = ['文字 ![alt](pic.png) 后文', ''].join('\n')
    const view = makeView(doc, [
      createLinkInteractions({ postActivate: () => {}, images, postActivateWikilink: () => {} }),
    ])
    expect(view.contentDOM.querySelector('img')).not.toBeNull()
    const alt = doc.indexOf('alt')
    view.dispatch({ effects: setFindMatches.of({ matches: [{ from: alt, to: alt + 3 }], index: 0 }) })
    expect(view.contentDOM.querySelector('img')).not.toBeNull()
    view.destroy()
  })
})

// ---- span 预算（大文档多命中时查找键入路径的成本上界） ----

describe('命中显形重建预算（纯文本命中零重发射）', () => {
  it('大量纯文本命中：行级类别零触界 → 零行重发射（文本过滤）；grid 行命中恰增一行', async () => {
    const { getHeadingStats } = await import('../../src/webview/liveDecorations')
    const doc = ['# 标题', '', '正文甲', '正文甲', '正文甲', ''].join('\n')
    const view = makeView(doc)
    // 基线：空 matches 事务只重发射选区行（selectionSpans 既有行为）
    view.dispatch({ effects: setFindMatches.of({ matches: [], index: 0 }) })
    const baseline = getHeadingStats().lastUpdateScannedLines
    expect(baseline).toBeGreaterThanOrEqual(1)
    // 30 处纯文本命中（行内无 | 与 \）：重发射必为空转 → 过滤后不增扫描行
    const matches: Array<{ from: number; to: number }> = []
    let at = doc.indexOf('正文甲')
    while (at >= 0) {
      for (let i = 0; i < 10; i++) {
        matches.push({ from: at + (i % 3), to: at + (i % 3) + 1 })
      }
      at = doc.indexOf('正文甲', at + 1)
    }
    expect(matches.length).toBeGreaterThanOrEqual(30)
    view.dispatch({ effects: setFindMatches.of({ matches, index: 0 }) })
    expect(getHeadingStats().lastUpdateScannedLines).toBe(baseline)
    view.destroy()
    // 对照：命中落在 grid 行（含 |）→ 恰增该行重发射
    const tableView = makeView(TABLE_DOC)
    tableView.dispatch({ effects: setFindMatches.of({ matches: [], index: 0 }) })
    const tableBaseline = getHeadingStats().lastUpdateScannedLines
    const tableRow = lineOf(TABLE_DOC, 5)
    tableView.dispatch({
      effects: setFindMatches.of({ matches: [{ from: tableRow.from + 2, to: tableRow.from + 4 }], index: 0 }),
    })
    expect(getHeadingStats().lastUpdateScannedLines).toBe(tableBaseline + 1)
    tableView.destroy()
  })
})
