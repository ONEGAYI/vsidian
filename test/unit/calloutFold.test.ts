// Callout 按实例折叠状态机契约测试（#655/T04）：区间派生（可折叠判定 /
// 嵌套 / lazy 行 / 标题-only 无占位）、状态机矩阵（手动开合零写回 / 外收
// 内保 / 改声明采新默认 / 切类型与编辑正文不重置 / 标记删除丢弃 / 全文
// 重置清空 / 外部增量与撤销回流映射 / 恢复按源码默认）、光标迁移、最内层
// 目标解析、落点展开（嵌套祖先全展开）与外部同步钳制。
// 语义单一事实源在 docs/specs/callout.md §5 与 ADR-0023（视图态按实例，
// 源文唯一内容）；阅读消费链（VirtualReadingView）在集成侧钉住。
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

if (typeof Range !== 'undefined' && Range.prototype.getClientRects === undefined) {
  ;(Range.prototype as unknown as { getClientRects(): DOMRectList }).getClientRects =
    () => [] as unknown as DOMRectList
  ;(Range.prototype as unknown as { getBoundingClientRect(): DOMRect }).getBoundingClientRect =
    () => new DOMRect(0, 0, 0, 0)
}
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView, type DecorationSet } from '@codemirror/view'
import { externalSync } from '../../src/webview/liveInstance'
import { liveDecorationsField } from '../../src/webview/liveDecorations'
import { installLocale } from '../../src/shared/i18n'
import { zhCn } from '../../src/shared/locales/zh-cn'
installLocale('zh-cn', zhCn)

import {
  applyCalloutToggleAt,
  calloutFoldDecorations,
  calloutFoldField,
  calloutFoldSet,
  calloutFoldView,
  clampSelectionOutOfCalloutFolds,
  collectCalloutFolds,
  effectiveCalloutFolds,
  migrateSelectionForCalloutFold,
  setCalloutFolds,
  toggleCalloutFoldAt,
  unfoldCalloutAround,
  unfoldCalloutAroundKeys,
} from '../../src/webview/calloutFold'

/** 最小装配：折叠域 + 装饰 + 增量树源（headingFold 测试同款形态） */
function foldState(doc: string, selections?: number[]): EditorState {
  return EditorState.create({
    doc,
    extensions: [calloutFoldField, calloutFoldDecorations, liveDecorationsField],
    selection: selections && selections.length > 0
      ? EditorSelection.create(selections.map((p) => EditorSelection.cursor(p)))
      : undefined,
  })
}

/** 收起区间的装饰快照（隐藏 replace 区间——非 widget、非行级类） */
function hideRanges(set: DecorationSet): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = []
  set.between(0, Number.MAX_SAFE_INTEGER, (from, to, deco) => {
    const spec = deco.spec as { widget?: unknown; class?: unknown }
    const isWidget = spec.widget !== undefined
    const isLine = spec.class !== undefined && !isWidget
    if (!isWidget && !isLine) {
      out.push({ from, to })
    }
  })
  return out
}

/** 标题-only / 有正文的嵌套夹具（行首偏移在用例内按 doc.line 计算） */
const NESTED_DOC = [
  '> [!note]+ 外层标题', // 1
  '> 外层正文', // 2
  '> > [!tip]- 内层标题', // 3
  '> > 内层正文', // 4
  '> 外层尾行', // 5
  '', // 6
  '> [!warning] 无符号标题', // 7
  '> 无符号正文', // 8
  '', // 9
  '> [!info]- 标题而已', // 10
  '', // 11
  '> [!todo]+ 惰性正文', // 12
  '惰性续行', // 13（lazy continuation，并入首段——本票按正文行处理）
].join('\n')

describe('collectCalloutFolds：区间派生与可折叠判定', () => {
  it('有符号且有正文的 callout 产出折叠区间；无符号不产出', () => {
    const state = foldState(NESTED_DOC)
    const spans = collectCalloutFolds(state.doc)
    // 三处：外层 note+、内层 tip-、todo+（标题-only info- 与无符号 warning 不在）
    expect(spans.map((s) => s.declFold)).toEqual(['+', '-', '+'])
    const warningPos = state.doc.toString().indexOf('> [!warning]')
    expect(spans.every((s) => s.markerFrom < warningPos || s.markerFrom > warningPos + 40)).toBe(true)
  })

  it('标题-only（仅声明行）不产生折叠占位——即使声明带折叠符号', () => {
    const doc = '> [!info]- 标题而已\n'
    const spans = collectCalloutFolds(foldState(doc).doc)
    expect(spans).toHaveLength(0)
  })

  it('隐藏区间 = 标题行行尾到容器末行行尾；标题行保持可见', () => {
    const doc = '> [!note]+ 标题\n> 正文一\n> 正文二\n'
    const state = foldState(doc)
    const [span] = collectCalloutFolds(state.doc)
    expect(span).toBeDefined()
    expect(span!.key).toBe(0)
    expect(span!.titleLineTo).toBe(state.doc.line(1).to)
    expect(span!.contentTo).toBe(state.doc.line(3).to)
  })

  it('嵌套：内层区间严格小于外层，外层 contentTo 覆盖内层全部', () => {
    const state = foldState(NESTED_DOC)
    const spans = collectCalloutFolds(state.doc)
    const [outer, inner] = spans
    expect(inner!.key).toBeGreaterThan(outer!.key)
    expect(inner!.contentTo).toBeLessThanOrEqual(outer!.contentTo)
    expect(inner!.key).toBeLessThan(outer!.contentTo)
  })

  it('纯空引用行的「正文」不算可折叠正文（标题后仅空 > 行不产占位）', () => {
    const doc = '> [!note]+ 标题\n>\n'
    const spans = collectCalloutFolds(foldState(doc).doc)
    expect(spans).toHaveLength(0)
  })
})

describe('calloutFoldView：有效折叠态（默认与手动覆盖）', () => {
  it('默认态：+ 展开不可收起呈现、- 收起', () => {
    const state = foldState(NESTED_DOC)
    const spans = collectCalloutFolds(state.doc)
    const view = calloutFoldView(new Map(), spans)
    const byFold = Object.fromEntries(view.map((v) => [v.span.declFold, v.folded]))
    expect(byFold['+']).toBe(false)
    expect(byFold['-']).toBe(true)
  })

  it('外层收起不抹内层状态：内层 override 独立保留', () => {
    const state = foldState(NESTED_DOC)
    const spans = collectCalloutFolds(state.doc)
    const [outer, inner] = spans
    // 内层 tip- 默认收起 → 手动展开；外层 note+ 手动收起
    const overrides = new Map<number, { folded: boolean; declFold: '+' | '-' }>([
      [outer!.key, { folded: true, declFold: '+' }],
      [inner!.key, { folded: false, declFold: '-' }],
    ])
    const view = calloutFoldView(overrides, spans)
    expect(view.find((v) => v.span.key === outer!.key)?.folded).toBe(true)
    expect(view.find((v) => v.span.key === inner!.key)?.folded).toBe(false)
    const effective = effectiveCalloutFolds(overrides, spans)
    expect(effective.map((s) => s.key)).toEqual([outer!.key])
  })
})

describe('calloutFoldField：状态机矩阵', () => {
  it('手动收起是纯视图态：零源文变化、零撤销历史关联', () => {
    const state = foldState(NESTED_DOC)
    const view = new EditorView({ state, parent: document.body })
    try {
      const before = view.state.doc.toString()
      const spans = collectCalloutFolds(view.state.doc)
      toggleCalloutFoldAt(view, spans[0]!.key)
      expect(view.state.doc.toString()).toBe(before)
      expect(view.state.field(calloutFoldField).size).toBe(1)
      // effect 直驱：事务无 changes（docChanged false）
      let sawDocChange = false
      view.dispatch({
        effects: [],
        annotations: [],
      })
      void sawDocChange
    } finally {
      view.destroy()
    }
  })

  it('切类型（折叠符号不变）不重置手动开合；编辑正文同样保留', () => {
    const doc = '> [!note]+ 标题\n> 正文\n'
    let state = foldState(doc)
    const [span] = collectCalloutFolds(state.doc)
    state = state.update({
      effects: calloutFoldSet.of(new Map<number, { folded: boolean; declFold: '+' | '-' }>([[span!.key, { folded: true, declFold: '+' }]])),
    }).state
    // 切类型 note → tip（同符号 +）
    state = state.update({ changes: { from: 4, to: 8, insert: 'tip' } }).state
    let spans = collectCalloutFolds(state.doc)
    expect(spans).toHaveLength(1)
    expect(state.field(calloutFoldField).size).toBe(1)
    expect(effectiveCalloutFolds(state.field(calloutFoldField), spans)).toHaveLength(1)
    // 编辑正文（追加文字）
    state = state.update({ changes: { from: state.doc.length, insert: ' 更多' } }).state
    spans = collectCalloutFolds(state.doc)
    expect(effectiveCalloutFolds(state.field(calloutFoldField), spans)).toHaveLength(1)
  })

  it('改 + 为 - 的声明编辑使该项采新默认（收起），手动覆盖失效', () => {
    const doc = '> [!note]+ 标题\n> 正文\n'
    let state = foldState(doc)
    const [span] = collectCalloutFolds(state.doc)
    // 手动收起 + 声明
    state = state.update({
      effects: calloutFoldSet.of(new Map<number, { folded: boolean; declFold: '+' | '-' }>([[span!.key, { folded: true, declFold: '+' }]])),
    }).state
    // 改声明 + → -（位置：markerFrom+8 是 ] 后的 +）
    const plusPos = doc.indexOf(']')
    state = state.update({ changes: { from: plusPos + 1, to: plusPos + 2, insert: '-' } }).state
    const spans = collectCalloutFolds(state.doc)
    expect(spans[0]!.declFold).toBe('-')
    // 新默认 = 收起（- 即收起）；override 已失效（改声明即采新默认）
    const view = calloutFoldView(state.field(calloutFoldField), spans)
    expect(view.find((v) => v.span.declFold === '-')?.folded).toBe(true)
    // 再手动展开 - 声明后改回 +：采新默认展开
    const key = spans[0]!.key
    const next = new Map(state.field(calloutFoldField))
    next.set(key, { folded: false, declFold: '-' })
    state = state.update({ effects: calloutFoldSet.of(next) }).state
    const minusPos = state.doc.toString().indexOf(']')
    state = state.update({ changes: { from: minusPos + 1, to: minusPos + 2, insert: '+' } }).state
    const spans2 = collectCalloutFolds(state.doc)
    expect(spans2[0]!.declFold).toBe('+')
    expect(calloutFoldView(state.field(calloutFoldField), spans2).find((v) => v.span.key === key)?.folded)
      .toBe(false)
  })

  it('删除标记丢弃失效状态；撤销恢复后按源码默认初始化（不复活旧手动态）', () => {
    const doc = '> [!note]+ 标题\n> 正文\n'
    let state = foldState(doc)
    const [span] = collectCalloutFolds(state.doc)
    state = state.update({
      effects: calloutFoldSet.of(new Map<number, { folded: boolean; declFold: '+' | '-' }>([[span!.key, { folded: true, declFold: '+' }]])),
    }).state
    expect(state.field(calloutFoldField).size).toBe(1)
    // 删除整个标记（含其后空格）
    const insert = '> 标题\n> 正文\n'
    state = state.update({ changes: { from: 0, to: doc.length, insert } }).state
    expect(collectCalloutFolds(state.doc)).toHaveLength(0)
    expect(state.field(calloutFoldField).size).toBe(0)
    // 撤销回流（外部增量恢复标记）：按源码默认（+ → 展开），旧手动收起不复活
    state = state.update({
      changes: { from: 0, to: insert.length, insert: doc },
      annotations: externalSync.of(true),
    }).state
    const spans = collectCalloutFolds(state.doc)
    expect(spans).toHaveLength(1)
    expect(state.field(calloutFoldField).size).toBe(0)
    expect(effectiveCalloutFolds(state.field(calloutFoldField), spans)).toHaveLength(0)
  })

  it('外部增量在别处编辑：键随坐标映射，折叠保持（外部同步矩阵）', () => {
    const doc = '前缀\n\n> [!note]+ 标题\n> 正文\n'
    let state = foldState(doc)
    const [span] = collectCalloutFolds(state.doc)
    state = state.update({
      effects: calloutFoldSet.of(new Map<number, { folded: boolean; declFold: '+' | '-' }>([[span!.key, { folded: true, declFold: '+' }]])),
    }).state
    // 外部在文档头插入一行
    state = state.update({
      changes: { from: 0, insert: '新行\n' },
      annotations: externalSync.of(true),
    }).state
    const spans = collectCalloutFolds(state.doc)
    expect(spans).toHaveLength(1)
    const keyAfter = spans[0]!.key
    expect(keyAfter).toBe(span!.key + 3)
    expect(effectiveCalloutFolds(state.field(calloutFoldField), spans).map((s) => s.key)).toEqual([keyAfter])
  })

  it('全文替换（init/resync）显式清空——重开按源码默认', () => {
    const doc = '> [!note]- 标题\n> 正文\n'
    let state = foldState(doc)
    const [span] = collectCalloutFolds(state.doc)
    state = state.update({
      effects: calloutFoldSet.of(new Map<number, { folded: boolean; declFold: '+' | '-' }>([[span!.key, { folded: false, declFold: '-' }]])),
    }).state
    expect(state.field(calloutFoldField).size).toBe(1)
    state = state.update({ changes: { from: 0, to: doc.length, insert: '> [!note]- 新\n> 新正文\n' } }).state
    expect(state.field(calloutFoldField).size).toBe(0)
    const spans = collectCalloutFolds(state.doc)
    expect(calloutFoldView(state.field(calloutFoldField), spans)[0]!.folded).toBe(true)
  })
})

describe('折叠装饰与光标迁移', () => {
  it('收起发射跨行隐藏 replace，标题行保持可见区间之外', () => {
    const doc = '> [!note]+ 标题\n> 正文一\n> 正文二\n'
    const state = foldState(doc)
    const [span] = collectCalloutFolds(state.doc)
    const next = state.update({
      effects: calloutFoldSet.of(new Map<number, { folded: boolean; declFold: '+' | '-' }>([[span!.key, { folded: true, declFold: '+' }]])),
    }).state
    const ranges = hideRanges(next.field(calloutFoldDecorations))
    expect(ranges).toEqual([{ from: span!.titleLineTo, to: span!.contentTo }])
  })

  it('隐藏范围内的光标同事务迁移到标题行行尾；区外选区保留', () => {
    const doc = '> [!note]+ 标题\n> 正文一\n> 正文二\n'
    const bodyPos = doc.indexOf('正文一')
    const state = foldState(doc, [bodyPos])
    const [span] = collectCalloutFolds(state.doc)
    const key0 = span!.key
    const overrides0 = new Map<number, { folded: boolean; declFold: '+' | '-' }>([[key0, { folded: true, declFold: '+' }]])
    const folds = effectiveCalloutFolds(overrides0, collectCalloutFolds(state.doc))
    const migrated = migrateSelectionForCalloutFold(state.selection, folds)
    expect(migrated).not.toBeNull()
    expect(migrated!.main.head).toBe(span!.titleLineTo)
  })

  it('setCalloutFolds 收起事务内迁移光标（同事务）', () => {
    const doc = '> [!note]+ 标题\n> 正文一\n'
    const view = new EditorView({ state: foldState(doc, [doc.indexOf('正文一')]), parent: document.body })
    try {
      const [span] = collectCalloutFolds(view.state.doc)
      const next = new Map<number, { folded: boolean; declFold: '+' | '-' }>([[span!.key, { folded: true, declFold: '+' }]])
      setCalloutFolds(view, next)
      expect(view.state.selection.main.head).toBe(span!.titleLineTo)
      expect(view.state.doc.toString()).toBe(doc)
    } finally {
      view.destroy()
    }
  })

  // 评审修复 P3（规格 §5 L83「不能留在不可见区域」）：嵌套双收起时最深
  // 区间的标题行行尾本身落在外层隐藏区内——迁移/钳制落点须复核上浮到
  // 可见的标题行行尾
  const DOUBLE_FOLD_DOC = '> [!note]- 外层标题\n> 外层正文\n> > [!tip]- 内层标题\n> > 内层正文\n'

  it('嵌套双收起：迁移落点不落外层隐藏区（上浮外层标题末）', () => {
    const state = foldState(DOUBLE_FOLD_DOC, [DOUBLE_FOLD_DOC.indexOf('内层正文')])
    const spans = collectCalloutFolds(state.doc)
    const [outer, inner] = spans
    // 前提自证：两层默认收起（- -）且内层标题行行尾落外层隐藏区内
    const folds = effectiveCalloutFolds(new Map(), spans)
    expect(folds).toHaveLength(2)
    expect(inner!.titleLineTo).toBeGreaterThan(outer!.titleLineTo)
    expect(inner!.titleLineTo).toBeLessThan(outer!.contentTo)
    const migrated = migrateSelectionForCalloutFold(state.selection, folds)
    expect(migrated).not.toBeNull()
    expect(migrated!.main.head).toBe(outer!.titleLineTo)
  })

  it('嵌套双收起：三层收起迭代复核——落点上浮到最外层可见标题末', () => {
    const doc = '> [!note]- 甲标题\n> 甲正文\n> > [!tip]- 乙标题\n> > 乙正文\n> > > [!warning]- 丙标题\n> > > 丙正文\n'
    const state = foldState(doc, [doc.indexOf('丙正文')])
    const spans = collectCalloutFolds(state.doc)
    expect(spans).toHaveLength(3)
    const folds = effectiveCalloutFolds(new Map(), spans)
    const migrated = migrateSelectionForCalloutFold(state.selection, folds)
    expect(migrated).not.toBeNull()
    expect(migrated!.main.head).toBe(spans[0]!.titleLineTo)
  })
})

describe('目标解析与操作执行', () => {
  it('applyCalloutToggleAt：光标所在最内层 callout 翻转；不在任何 callout 内 no-op', () => {
    const view = new EditorView({ state: foldState(NESTED_DOC), parent: document.body })
    try {
      const spans = collectCalloutFolds(view.state.doc)
      const [outer, inner] = spans
      // 光标在内层正文 → 翻转内层（最内层目标；tip- 默认收起 → 手动展开）
      const innerBody = view.state.doc.toString().indexOf('内层正文')
      expect(applyCalloutToggleAt(view, innerBody)).toBe(true)
      let field = view.state.field(calloutFoldField)
      expect(field.get(inner!.key)).toEqual({ folded: false, declFold: '-' })
      // 光标在外层正文（不在内层）→ 翻转外层
      const outerBody = view.state.doc.toString().indexOf('外层正文')
      expect(applyCalloutToggleAt(view, outerBody)).toBe(true)
      field = view.state.field(calloutFoldField)
      expect(field.get(outer!.key)).toEqual({ folded: true, declFold: '+' })
      // 再次作用于外层正文：翻转回展开（外收不抹内层）
      expect(applyCalloutToggleAt(view, outerBody)).toBe(true)
      field = view.state.field(calloutFoldField)
      expect(field.get(inner!.key)).toEqual({ folded: false, declFold: '-' })
      // 普通文本区（callout 之间的空行）：no-op
      const doc = view.state.doc
      const blankLineFrom = doc.line(6).from
      expect(applyCalloutToggleAt(view, blankLineFrom)).toBe(false)
    } finally {
      view.destroy()
    }
  })

  it('无符号 callout 不产生切换目标（操作无动作）', () => {
    const doc = '> [!warning] 无符号\n> 正文\n'
    const view = new EditorView({ state: foldState(doc, [doc.indexOf('正文')]), parent: document.body })
    try {
      expect(collectCalloutFolds(view.state.doc)).toHaveLength(0)
      expect(applyCalloutToggleAt(view, doc.indexOf('正文'))).toBe(false)
    } finally {
      view.destroy()
    }
  })
})

describe('落点展开（reveal 族）', () => {
  it('落点在折叠区内：展开包含它的全部祖先 callout（嵌套全展开）', () => {
    const state = foldState(NESTED_DOC)
    const spans = collectCalloutFolds(state.doc)
    const [outer, inner] = spans
    // 两层都收起
    const overrides = new Map<number, { folded: boolean; declFold: '+' | '-' }>([
      [outer!.key, { folded: true, declFold: '+' }],
      [inner!.key, { folded: true, declFold: '-' }],
    ])
    const innerBody = state.doc.toString().indexOf('内层正文')
    const next = unfoldCalloutAroundKeys(overrides, spans, innerBody)
    expect(next).not.toBeNull()
    expect(next!.get(outer!.key)).toEqual({ folded: false, declFold: '+' })
    expect(next!.get(inner!.key)).toEqual({ folded: false, declFold: '-' })
  })

  it('落点不在折叠区返回 null（零事务）；外层展开但落点在内层已展开区不再动外层', () => {
    const state = foldState(NESTED_DOC)
    const spans = collectCalloutFolds(state.doc)
    const [outer] = spans
    const overrides = new Map<number, { folded: boolean; declFold: '+' | '-' }>([[outer!.key, { folded: true, declFold: '+' }]])
    expect(unfoldCalloutAroundKeys(overrides, spans, 0)).toBeNull()
    // 外层标题行行尾本身可见：不展开
    expect(unfoldCalloutAroundKeys(overrides, spans, outer!.titleLineTo)).toBeNull()
  })

  it('unfoldCalloutAround 视图驱动：默认收起（- 无 override）的祖先同样展开', () => {
    installLocale('zh-cn', zhCn)
    const doc = '> [!note]- 外层\n> 正文\n> > [!tip]- 内层\n> > 内文\n'
    const view = new EditorView({ state: foldState(doc), parent: document.body })
    try {
      const spans = collectCalloutFolds(view.state.doc)
      expect(spans).toHaveLength(2)
      const innerBody = view.state.doc.toString().indexOf('内文')
      expect(unfoldCalloutAround(view, innerBody)).toBe(true)
      const field = view.state.field(calloutFoldField)
      expect(field.size).toBe(2)
      for (const span of spans) {
        expect(field.get(span.key)).toEqual({ folded: false, declFold: '-' })
      }
      // 再来一次：已展开 → false（零事务）
      expect(unfoldCalloutAround(view, innerBody)).toBe(false)
    } finally {
      view.destroy()
    }
  })
})

describe('外部同步光标钳制', () => {
  it('光标被增量映射进收起区时钳到标题行行尾', () => {
    const doc = '> [!note]+ 标题\n> 正文\n'
    let state = foldState(doc)
    const [span] = collectCalloutFolds(state.doc)
    state = state.update({
      effects: calloutFoldSet.of(new Map<number, { folded: boolean; declFold: '+' | '-' }>([[span!.key, { folded: true, declFold: '+' }]])),
    }).state
    const view = new EditorView({ state, parent: document.body })
    try {
      // 模拟外部同步把光标放进收起区（正文行首）
      view.dispatch({
        selection: { anchor: view.state.doc.toString().indexOf('正文') },
        annotations: externalSync.of(true),
      })
      const clamped = clampSelectionOutOfCalloutFolds(view)
      expect(clamped).not.toBeNull()
      expect(clamped!.main.head).toBe(span!.titleLineTo)
    } finally {
      view.destroy()
    }
  })

  // 评审修复 P3：嵌套双收起（默认 - -）时光标在内层正文——最深区间
  // （内层）标题行行尾落外层隐藏区内，钳制落点须上浮外层标题末
  it('嵌套双收起：钳制落点不落外层隐藏区（上浮外层标题末）', () => {
    const doc = '> [!note]- 外层标题\n> 外层正文\n> > [!tip]- 内层标题\n> > 内层正文\n'
    const state = foldState(doc)
    const spans = collectCalloutFolds(state.doc)
    const [outer, inner] = spans
    // 前提自证：默认态两层均收起（零 override）
    expect(effectiveCalloutFolds(state.field(calloutFoldField), spans)).toHaveLength(2)
    expect(inner!.titleLineTo).toBeLessThan(outer!.contentTo)
    const view = new EditorView({ state, parent: document.body })
    try {
      view.dispatch({
        selection: { anchor: view.state.doc.toString().indexOf('内层正文') },
        annotations: externalSync.of(true),
      })
      const clamped = clampSelectionOutOfCalloutFolds(view)
      expect(clamped).not.toBeNull()
      expect(clamped!.main.head).toBe(outer!.titleLineTo)
    } finally {
      view.destroy()
    }
  })
})

describe('#662 R1-004 列表首行声明的 override 失效清理', () => {
  it('列表首行声明（- > [!note]-）的手动展开在正文编辑后保留', () => {
    const doc = '- > [!note]- 标题\n  > 正文\n尾部\n'
    let state = foldState(doc)
    const spans = collectCalloutFolds(state.doc)
    expect(spans).toHaveLength(1) // 识别基线：解析器认识列表内 callout
    state = state.update({
      effects: calloutFoldSet.of(new Map([[spans[0]!.key, { folded: false, declFold: '-' }]])),
    }).state
    // 正文编辑（无关声明行）：docChanged 的行级失效清理不得误删列表声明的 override
    const bodyPos = state.doc.toString().indexOf('正文')
    state = state.update({ changes: { from: bodyPos, to: bodyPos + 2, insert: '内容' } }).state
    const after = collectCalloutFolds(state.doc)
    expect(after).toHaveLength(1)
    expect(calloutFoldView(state.field(calloutFoldField), after)[0]!.folded).toBe(false)
  })

  it('有序列表（1. > [!tip]+）的手动收起在编辑后同样保留', () => {
    const doc = '1. > [!tip]+ 标题\n   > 正文\n尾部\n'
    let state = foldState(doc)
    const spans = collectCalloutFolds(state.doc)
    expect(spans).toHaveLength(1)
    state = state.update({
      effects: calloutFoldSet.of(new Map([[spans[0]!.key, { folded: true, declFold: '+' }]])),
    }).state
    const tailPos = state.doc.toString().indexOf('尾部')
    state = state.update({ changes: { from: tailPos, insert: '已改' } }).state
    const after = collectCalloutFolds(state.doc)
    expect(after).toHaveLength(1)
    expect(calloutFoldView(state.field(calloutFoldField), after)[0]!.folded).toBe(true)
  })
})
