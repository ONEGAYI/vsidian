// 标题折叠本体契约测试（#412 T01）：StateField 折叠键集合、effect 驱动、
// 折叠区间派生（标题节边界 / 可折叠判定 / 嵌套独立性）、坐标生命周期
// 六行（本地编辑 / externalSync / 撤销回流同路 / 全文替换清空 / 边界文本
// 进退 / 撤销恢复回未折叠）、光标迁移与五操作目标解析。
// 语义单一事实源在 docs/specs/heading-fold.md「一、折叠区间语义」「二、
// 折叠本体与坐标生命周期」「三、折叠与光标/选区」；本文件按票面验收
// 清单逐条钉住。标题表派生选路线 2（消费点经增量树直查，extractOutline
// 双入口形态），对拍单测见「collectHeadings 一致性」节。
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

// jsdom 无布局：为 CM6 的视口测量（measureTextSize → Range.getClientRects）
// 提供零值 polyfill（#413 用例经真实 EditorView 驱动折叠事务触发测量），
// 真宿主 Chromium 有真实实现（compositionBuffer.test.ts 同款先例）
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
import { extractOutline } from '../../src/webview/outline'
import { installLocale } from '../../src/shared/i18n'
import {
  applyHeadingFoldOperation,
  buildHeadingFoldArrowMarker,
  collectHeadings,
  collectHeadingFoldPaint,
  effectiveHeadingFolds,
  enclosingHeading,
  foldHoverArmed,
  headingFoldArrowStates,
  headingFoldDecorations,
  headingFoldField,
  headingFoldGutterExtension,
  headingFoldSet,
  HeadingFoldEllipsisWidget,
  clampFoldHiddenCursor,
  clampSelectionOutOfFolds,
  foldableHeadingSpans,
  migrateSelectionForFold,
  rangeFoldHidden,
  resolveHeadingFoldTargets,
  resolveHeadingToggleTargets,
  resolveHeadingUnfoldTargets,
  setHeadingFoldBindingHints,
  toggleHeadingFoldAt,
  unfoldAround,
  unfoldAroundKeys,
} from '../../src/webview/headingFold'

/** 最小装配：折叠本体 + 装饰 + 增量树源（liveDecorationsField；装饰与
 *  派生经它复用增量解析树，未装配时退化为全量解析的双入口形态） */
function foldState(doc: string, selections?: number[]): EditorState {
  return EditorState.create({
    doc,
    extensions: [headingFoldField, headingFoldDecorations, liveDecorationsField],
    selection: selections && selections.length > 0
      ? EditorSelection.create(selections.map((p) => EditorSelection.cursor(p)))
      : undefined,
  })
}

/** 折叠若干键（effect 直驱，模拟键位/箭头/API 编程触发同链路） */
function fold(state: EditorState, keys: readonly number[]): EditorState {
  const next = new Set(state.field(headingFoldField))
  for (const k of keys) {
    next.add(k)
  }
  return state.update({ effects: headingFoldSet.of(next) }).state
}

/** 装饰集合快照（隐藏 replace 区间列表） */
function hideRanges(set: DecorationSet): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = []
  set.between(0, Number.MAX_SAFE_INTEGER, (from, to) => {
    out.push({ from, to })
  })
  return out
}

// ---- 一、节边界与区间派生 ----

describe('collectHeadings：标题序列与节边界', () => {
  it('ATX 同级截断：节终止于下一个同级别或更浅标题行首', () => {
    const doc = '# A\nx\n# B\ny\n'
    const hs = collectHeadings(foldState(doc).doc)
    expect(hs.map((h) => [h.key, h.level, h.visibleTo])).toEqual([
      [0, 1, 3],
      [6, 1, 9],
    ])
  })

  it('ATX 跨级辖域：浅标题节覆盖深层标题，深层节终止于其级别边界', () => {
    const doc = '# H1\n## H2\nx\n# H1b\n'
    const state = foldState(doc)
    const folds = effectiveHeadingFolds(new Set([0]), collectHeadings(state.doc), state.doc)
    expect(folds.map((f) => [f.key, f.hideFrom, f.hideTo])).toEqual([[0, 4, 13]])
    const h2 = effectiveHeadingFolds(new Set([5]), collectHeadings(state.doc), state.doc)
    expect(h2.map((f) => [f.key, f.hideFrom, f.hideTo])).toEqual([[5, 10, 13]])
  })

  it('末标题到文档尾：隐藏区间含尾随空行', () => {
    const doc = '# A\nx\n'
    const state = foldState(doc)
    const folds = effectiveHeadingFolds(new Set([0]), collectHeadings(state.doc), state.doc)
    expect(folds.map((f) => [f.hideFrom, f.hideTo])).toEqual([[3, 6]])
  })

  it('Setext 标题块整体可见：隐藏起点在下划线行行尾', () => {
    const doc = 'T\n===\nbody\n'
    const state = foldState(doc)
    const hs = collectHeadings(state.doc)
    expect(hs.map((h) => [h.key, h.level, h.visibleTo])).toEqual([[0, 1, 5]])
    const folds = effectiveHeadingFolds(new Set([0]), hs, state.doc)
    expect(folds.map((f) => [f.hideFrom, f.hideTo])).toEqual([[5, 11]])
  })

  it('frontmatter 头块伪标题与代码围栏内伪标题不产折叠目标', () => {
    const doc = '---\n# fm\n---\n# A\nx\n```\n# not\n```\n'
    const state = foldState(doc)
    const hs = collectHeadings(state.doc)
    expect(hs.map((h) => h.key)).toEqual([13])
    expect(hs.map((h) => h.level)).toEqual([1])
  })

  it('可折叠判定：空节与纯空白节不可折叠', () => {
    const emptyDoc = '# A\n# B\n'
    const state1 = foldState(emptyDoc)
    expect(foldableHeadingSpans(collectHeadings(state1.doc), state1.doc)).toEqual([])
    const blankDoc = '# A\n \n\t\n# B\n'
    const state2 = foldState(blankDoc)
    expect(foldableHeadingSpans(collectHeadings(state2.doc), state2.doc)).toEqual([])
  })

  it('嵌套独立性：折 H1+H2 后展 H1，H2 区间仍在（扁平键集重叠表达嵌套）', () => {
    const doc = '# A\n## B\nx\n## C\ny\n'
    const state = foldState(doc)
    const hs = collectHeadings(state.doc)
    const both = effectiveHeadingFolds(new Set([0, 4]), hs, state.doc)
    expect(both.map((f) => f.key)).toEqual([0, 4])
    const afterUnfoldH1 = effectiveHeadingFolds(new Set([4]), hs, state.doc)
    expect(afterUnfoldH1.map((f) => [f.key, f.hideFrom, f.hideTo])).toEqual([[4, 8, 11]])
  })

  it('脱靶键被派生视图过滤：不在可折叠标题行首的残留键无行为', () => {
    const doc = '# A\nx\n# B\ny\n'
    const state = foldState(doc)
    const folds = effectiveHeadingFolds(new Set([0, 4]), collectHeadings(state.doc), state.doc)
    expect(folds.map((f) => f.key)).toEqual([0])
  })

  it('rangeFoldHidden 开区间语义（#419 阅读侧块过滤）：标题块端点不隐藏、区间内与部分相交隐藏', () => {
    const doc = '# T1\nalpha\n\n# T2\nbeta\n'
    const state = foldState(doc)
    const spans = foldableHeadingSpans(collectHeadings(state.doc), state.doc)
    // T1 节：key 0、hideFrom 4（标题行行尾）、hideTo 12（T2 行首）；
    // T2 节：key 12、hideTo 22（文档末尾）——两节均可折叠
    expect(spans[0]).toEqual({ key: 0, level: 1, hideFrom: 4, hideTo: 12 })
    const folds = [spans[0]!] // 阅读侧传入的有效折叠集（此处取 T1 单折叠）
    expect(rangeFoldHidden(folds, 0, 4)).toBe(false) // T1 标题块 [0,4)：to 恰为 hideFrom
    expect(rangeFoldHidden(folds, 12, 16)).toBe(false) // T2 标题块 [12,16)：from 恰为 hideTo
    expect(rangeFoldHidden(folds, 5, 10)).toBe(true) // alpha 段落块：区间内
    expect(rangeFoldHidden(folds, 4, 11)).toBe(true) // 部分相交（Live replace 覆盖同语义）
    expect(rangeFoldHidden([], 5, 10)).toBe(false) // 空折叠集恒不隐藏
  })
})

// ---- 二、StateField 语义与坐标生命周期 ----

describe('headingFoldField：StateField 语义与坐标生命周期', () => {
  it('折叠是视图态：effect 事务零写回（无文档变更）', () => {
    const state = foldState('# A\nx\n')
    const tr = state.update({ effects: headingFoldSet.of(new Set([0])) })
    expect(tr.changes.empty).toBe(true)
    expect(tr.docChanged).toBe(false)
    expect(tr.state.field(headingFoldField).has(0)).toBe(true)
  })

  it('headingFoldSet 整体设置（unfoldAll = 空集；单键翻转经 toggleHeadingFoldAt 组合本 effect——#418 移除裸 toggle effect 后单一通道）', () => {
    let state = foldState('# A\nx\n')
    state = state.update({ effects: headingFoldSet.of(new Set([0])) }).state
    expect(state.field(headingFoldField).size).toBe(1)
    state = state.update({ effects: headingFoldSet.of(new Set()) }).state
    expect(state.field(headingFoldField).size).toBe(0)
  })

  it('本地编辑：键随 ChangeSet 映射（mapPos assoc=1），折叠保持', () => {
    let state = foldState('# A\nx\nmore\n')
    state = fold(state, [0])
    // 在标题行内追加文字：键（行首 0）不动，折叠保持
    const edited = state.update({ changes: { from: 3, to: 3, insert: '!' } }).state
    expect(edited.field(headingFoldField).has(0)).toBe(true)
    // 在节内插入文本：键不动（编辑在键之后）
    const edited2 = state.update({ changes: { from: 4, to: 4, insert: 'pre ' } }).state
    expect(edited2.field(headingFoldField).has(0)).toBe(true)
    // 在文档头（键之前）插入文本：键随映射前移
    const edited3 = state.update({ changes: { from: 0, to: 0, insert: 'note\n' } }).state
    expect(edited3.field(headingFoldField).has(5)).toBe(true)
    expect(edited3.doc.sliceString(5, 9)).toBe('# A\n')
  })

  it('标题行行首拆行：键随内容下移仍命中同一标题，折叠保持（3e4855db 定案）', () => {
    let state = foldState('# A\nx\nmore\n')
    state = fold(state, [0])
    // 标题行行首 Enter：键（0）随内容下移到新行首（mapPos assoc=1 语义），
    // 仍命中同一标题——折叠保持（规格生命周期表 T01 实测定案格）
    const split = state.update({ changes: { from: 0, to: 0, insert: '\n' } }).state
    expect(split.field(headingFoldField).has(1)).toBe(true)
    expect(split.doc.sliceString(1, 5)).toBe('# A\n')
  })

  it('外部同步增量（externalSync 注解事务）：折叠跨同步保持，区间按新文档重派生', () => {
    let state = foldState('# A\nx\n# B\ny\n')
    state = fold(state, [0])
    // 另一编辑器在 B 标题行前插入新行（外部增量，带 externalSync 注解）
    const synced = state.update({
      changes: { from: 6, to: 6, insert: 'z\n' },
      annotations: externalSync.of(true),
    }).state
    expect(synced.field(headingFoldField).has(0)).toBe(true)
    // A 节边界随 B 行首移动（6 → 8）
    const folds = effectiveHeadingFolds(synced.field(headingFoldField), collectHeadings(synced.doc), synced.doc)
    expect(folds.map((f) => f.hideTo)).toEqual([8])
  })

  it('宿主撤销/重做回流：走同一增量路径，折叠保持；被删标题恢复后回到未折叠', () => {
    // 折叠 B 后，宿主撤销「B 节内的编辑」：webview 收到回流增量（externalSync
    // 事务，撤销栈归宿主文本管线的架构既定），折叠不丢
    let state = foldState('# A\nx\n# B\ny extra\n')
    state = fold(state, [6])
    const undoFlow = state.update({
      changes: { from: 11, to: 17, insert: '' },
      annotations: externalSync.of(true),
    }).state
    expect(undoFlow.field(headingFoldField).has(6)).toBe(true)
    // 删除标题行 B：键映射后落到非标题行首（y 行行首），折叠消失
    const deleted = undoFlow.update({ changes: { from: 6, to: 10, insert: '' } }).state
    expect([...deleted.field(headingFoldField)]).toEqual([6])
    expect(effectiveHeadingFolds(deleted.field(headingFoldField), collectHeadings(deleted.doc), deleted.doc)).toEqual([])
    // 撤销恢复被删标题（外部增量加回）：键映射后不再命中标题行首，节回到未折叠
    //（StateField 无 inverted-effect 可挂——既定架构边界，非缺陷）
    const restored = deleted.update({
      changes: { from: 6, to: 6, insert: '# B\n' },
      annotations: externalSync.of(true),
    }).state
    expect(restored.doc.toString()).toBe('# A\nx\n# B\ny\n')
    expect([...restored.field(headingFoldField)]).toEqual([10])
    expect(effectiveHeadingFolds(restored.field(headingFoldField), collectHeadings(restored.doc), restored.doc)).toEqual([])
  })

  it('全文替换（init / doc.resync 形态）：折叠集显式清空', () => {
    let state = foldState('# A\nx\n# B\ny\n')
    state = fold(state, [0, 6])
    const replaced = state.update({
      changes: { from: 0, to: state.doc.length, insert: '# A\nx\n# B\ny\n' },
      annotations: externalSync.of(true),
    }).state
    expect(replaced.field(headingFoldField).size).toBe(0)
    // 对照：局部替换不是全文替换，不清空
    const local = state.update({ changes: { from: 4, to: 5, insert: 'z' } }).state
    expect(local.field(headingFoldField).size).toBe(2)
  })

  it('边界文本进退：标题行内改字保持；升降级折叠保持且区间按新级别重派生', () => {
    // 标题行内改字
    let state = foldState('# A\nx\n# B\ny\n')
    state = fold(state, [0])
    const retyped = state.update({ changes: { from: 2, to: 3, insert: 'Z' } }).state
    expect(retyped.field(headingFoldField).has(0)).toBe(true)
    // 升降级：# A → ## A（行首键不动，折叠保持，区间按 level 2 重派生）
    const demoted = state.update({ changes: { from: 0, to: 1, insert: '##' } }).state
    expect(demoted.field(headingFoldField).has(0)).toBe(true)
    const folds = effectiveHeadingFolds(demoted.field(headingFoldField), collectHeadings(demoted.doc), demoted.doc)
    expect(folds.map((f) => f.level)).toEqual([2])
  })

  it('节前插入新同级标题：原节区间收缩到新标题前，折叠保持', () => {
    let state = foldState('# A\nx\n')
    state = fold(state, [0])
    // 原节区间 [3,6)（到文档尾）；节内尾部插入新同级标题后收缩到新标题前
    const inserted = state.update({ changes: { from: 6, to: 6, insert: '# N\ny\n' } }).state
    expect(inserted.doc.toString()).toBe('# A\nx\n# N\ny\n')
    expect(inserted.field(headingFoldField).has(0)).toBe(true)
    const folds = effectiveHeadingFolds(inserted.field(headingFoldField), collectHeadings(inserted.doc), inserted.doc)
    expect(folds.map((f) => [f.hideFrom, f.hideTo])).toEqual([[3, 6]])
  })
})

// ---- 三、装饰发射 ----

describe('headingFoldDecorations：隐藏装饰', () => {
  it('折叠发射多行 Decoration.replace 区间（标题行保持可见）', () => {
    let state = foldState('# A\nbody\nmore\n')
    state = fold(state, [0])
    const ranges = hideRanges(state.field(headingFoldDecorations))
    expect(ranges).toEqual([{ from: 3, to: state.doc.length }])
  })

  it('未折叠与空键集：装饰为空', () => {
    const state = foldState('# A\nbody\n')
    expect(hideRanges(state.field(headingFoldDecorations))).toEqual([])
    const foldedEmpty = state.update({ effects: headingFoldSet.of(new Set()) }).state
    expect(hideRanges(foldedEmpty.field(headingFoldDecorations))).toEqual([])
  })

  it('不可折叠标题的键：装饰不发射（可折叠判定在派生视图）', () => {
    let state = foldState('# A\n# B\n')
    state = fold(state, [0])
    expect(hideRanges(state.field(headingFoldDecorations))).toEqual([])
  })

  it('docChanged 后装饰区间按新结构重派生', () => {
    let state = foldState('# A\nx\n')
    state = fold(state, [0])
    const edited = state.update({ changes: { from: 4, to: 4, insert: 'more ' } }).state
    expect(edited.doc.toString()).toBe('# A\nmore x\n')
    expect(hideRanges(edited.field(headingFoldDecorations))).toEqual([{ from: 3, to: 11 }])
  })
})

// ---- 四、光标迁移 ----

describe('migrateSelectionForFold：折叠瞬间的选区迁移', () => {
  it('光标在隐藏区内：迁移到标题行行尾（collapse 空选区）', () => {
    const state = foldState('# A\nbody text\n')
    const folds = effectiveHeadingFolds(new Set([0]), collectHeadings(state.doc), state.doc)
    expect(folds.map((f) => [f.hideFrom, f.hideTo])).toEqual([[3, 14]])
    const moved = migrateSelectionForFold(EditorSelection.single(6), folds)
    expect(moved).not.toBeNull()
    expect(moved!.ranges[0]!.from).toBe(3)
    expect(moved!.ranges[0]!.empty).toBe(true)
  })

  it('光标在标题行行尾：不迁移（标题行本身不算隐藏区）', () => {
    const state = foldState('# A\nbody text\n')
    const folds = effectiveHeadingFolds(new Set([0]), collectHeadings(state.doc), state.doc)
    expect(migrateSelectionForFold(EditorSelection.single(3), folds)).toBeNull()
  })

  it('非空选区与隐藏区相交：该 range 迁移，其余 range 保留', () => {
    const state = foldState('# A\nbody text\n')
    const folds = effectiveHeadingFolds(new Set([0]), collectHeadings(state.doc), state.doc)
    // 两个标题行内 range 保留 + 一个隐藏区 range 迁移（迁移目标与保留
    // range 不叠加——CM6 create 对叠加空选区会归一合并，属固有行为）
    const sel = EditorSelection.create([
      EditorSelection.range(0, 1),      // 标题行内：不相交，保留
      EditorSelection.range(1, 2),      // 标题行内：不相交，保留
      EditorSelection.range(5, 8),      // 隐藏区内：迁移
    ], 2)
    const moved = migrateSelectionForFold(sel, folds)
    expect(moved).not.toBeNull()
    const rs = moved!.ranges
    expect(rs.length).toBe(3)
    expect(rs[0]!.from).toBe(0)
    expect(rs[0]!.to).toBe(1)
    expect(rs[1]!.from).toBe(1)
    expect(rs[1]!.to).toBe(2)
    expect(rs[2]!.from).toBe(3)
    expect(rs[2]!.to).toBe(3)
    expect(moved!.mainIndex).toBe(2)
  })

  it('选区与隐藏区不相交：整体不迁移', () => {
    const state = foldState('# A\nbody text\n')
    const folds = effectiveHeadingFolds(new Set([0]), collectHeadings(state.doc), state.doc)
    expect(migrateSelectionForFold(EditorSelection.single(1), folds)).toBeNull()
  })

  it('多区间嵌套折叠：迁移到包含该 range 的最深区间标题行行尾', () => {
    const state = foldState('# A\n## B\nx\n')
    const nested = effectiveHeadingFolds(new Set([0, 4]), collectHeadings(state.doc), state.doc)
    // H1 区间 [3,11) 包裹 H2 区间 [8,11)；光标在 x（pos 9）同时落在两区，
    // 迁移到最深（H2）标题行行尾 8
    expect(nested.map((f) => [f.key, f.hideFrom, f.hideTo])).toEqual([[0, 3, 11], [4, 8, 11]])
    const moved = migrateSelectionForFold(EditorSelection.single(9), nested)
    expect(moved!.ranges[0]!.from).toBe(8)
  })
})

// ---- 五、折叠目标解析（五操作） ----

describe('目标解析纯函数', () => {
  it('辖域解析：光标在标题行 → 该标题；否则向上最近标题', () => {
    const doc = '# A\n## B\nx\n# C\n'
    const state = foldState(doc)
    const hs = collectHeadings(state.doc)
    // pos 5：B 标题行内 → B（key 4）
    expect(enclosingHeading(hs, 5)!.key).toBe(4)
    // pos 0：A 标题行首 → A
    expect(enclosingHeading(hs, 0)!.key).toBe(0)
    // pos 9（x 行）：向上最近 = B
    expect(enclosingHeading(hs, 9)!.key).toBe(4)
    // pos 11（# C 行）：C（key 11）
    expect(enclosingHeading(hs, 11)!.key).toBe(11)
    // 无上方标题（首个标题之前）：null
    const doc2 = 'intro\n# A\n'
    expect(enclosingHeading(collectHeadings(foldState(doc2).doc), 2)).toBeNull()
  })

  it('折叠：辖域可折叠且未折叠 → 折之；已折叠 → 上溯最近未折叠祖先（逐层外扩）', () => {
    const doc = '# A\n## B\n### C\nx\n'
    const state = foldState(doc)
    const hs = collectHeadings(state.doc)
    // 光标在 x（pos 14，辖域 C）未折叠 → 折 C（key 9）
    expect(resolveHeadingFoldTargets(hs, new Set(), state.doc, EditorSelection.single(14))).toEqual([9])
    // C 已折叠 → 上溯最近未折叠祖先 B（key 4）
    expect(resolveHeadingFoldTargets(hs, new Set([9]), state.doc, EditorSelection.single(14))).toEqual([4])
    // C、B 均折叠 → 上溯 A（key 0）
    expect(resolveHeadingFoldTargets(hs, new Set([9, 4]), state.doc, EditorSelection.single(14))).toEqual([0])
    // 全链折叠 → 无目标（静默 no-op）
    expect(resolveHeadingFoldTargets(hs, new Set([9, 4, 0]), state.doc, EditorSelection.single(14))).toEqual([])
  })

  it('展开：辖域已折叠 → 展之；否则展开包含光标的最深已折叠区间；再无 → 空', () => {
    const doc = '# A\n## B\nx\n'
    const state = foldState(doc)
    const hs = collectHeadings(state.doc)
    // 光标在 B 标题行（pos 4），B 已折叠 → 展 B
    expect(resolveHeadingUnfoldTargets(hs, new Set([4]), state.doc, EditorSelection.single(4))).toEqual([4])
    // 光标在 x（pos 9，辖域 B 未折叠），A 折叠包含之 → 最深已折叠区间 = A
    expect(resolveHeadingUnfoldTargets(hs, new Set([0]), state.doc, EditorSelection.single(9))).toEqual([0])
    // A、B 均折叠，光标在 x：辖域 B 已折叠 → 展 B（最深）
    expect(resolveHeadingUnfoldTargets(hs, new Set([0, 4]), state.doc, EditorSelection.single(9))).toEqual([4])
    // 无折叠 → 空
    expect(resolveHeadingUnfoldTargets(hs, new Set(), state.doc, EditorSelection.single(9))).toEqual([])
  })

  it('切换：辖域标题两态取反（不外扩）', () => {
    const doc = '# A\n## B\nx\n'
    const state = foldState(doc)
    const hs = collectHeadings(state.doc)
    // 辖域 B（光标在 x）未折叠 → 折 B
    expect(resolveHeadingToggleTargets(hs, state.doc, EditorSelection.single(9))).toEqual([4])
    // B 已折叠 → 展 B（不上溯；toggle 只解析辖域，翻转归调用方）
    expect(resolveHeadingToggleTargets(hs, state.doc, EditorSelection.single(9))).toEqual([4])
  })

  it('非空选区/多光标：逐 range 解析并集去重，一次生效', () => {
    const doc = '# A\nx\n# B\ny\n'
    const state = foldState(doc)
    const hs = collectHeadings(state.doc)
    const sel = EditorSelection.create([
      EditorSelection.cursor(4),   // A 节内
      EditorSelection.range(7, 8), // B 标题行内非空选区
    ])
    expect(resolveHeadingFoldTargets(hs, new Set(), state.doc, sel).sort((a, b) => a - b)).toEqual([0, 6])
    // 同一目标的重复 range 去重
    const dup = EditorSelection.create([EditorSelection.cursor(4), EditorSelection.cursor(5)])
    expect(resolveHeadingFoldTargets(hs, new Set(), state.doc, dup)).toEqual([0])
  })

  it('无可折叠目标（辖域空节且无未折叠可折叠祖先）：静默空集', () => {
    const doc = '# A\n# B\n'
    const state = foldState(doc)
    const hs = collectHeadings(state.doc)
    // 辖域 B（光标在 B 行内 pos 4）为空白节；祖先 A 节只含换行，均不可折叠
    expect(resolveHeadingFoldTargets(hs, new Set(), state.doc, EditorSelection.single(4))).toEqual([])
  })
})

// ---- 六、collectHeadings 一致性（路线 2 对拍） ----

describe('collectHeadings 一致性', () => {
  it('增量树直查与全量解析对拍（liveDecorationsField 树传入 vs 省略）', () => {
    const doc = '---\ntitle: x\n---\n# A\n## B\n> ## Q\n\n> body\n\ntext\n===\n```\n# fake\n```\n# C\n'
    const withTree = foldState(doc)
    const tree = withTree.field(liveDecorationsField).tree
    const viaTree = collectHeadings(withTree.doc, tree)
    const viaParse = collectHeadings(withTree.doc)
    expect(viaTree).toEqual(viaParse)
  })

  it('编辑后增量树与全量解析持续对拍', () => {
    let state = foldState('# A\nx\n')
    state = fold(state, [0])
    state = state.update({ changes: { from: 4, to: 4, insert: '## N\n' } }).state
    const tree = state.field(liveDecorationsField).tree
    expect(collectHeadings(state.doc, tree)).toEqual(collectHeadings(state.doc))
  })

  it('与 extractOutline 标题序列对拍（键 = 条目起始行行首；级别一致）', () => {
    const doc = [
      '---',
      '# fm',
      '---',
      '# A',
      '## B',
      '### C',
      '',
      '> # Q1',
      '> ## Q2',
      '',
      '- item',
      '',
      'Setext',
      '======',
      '',
      '```',
      '# fenced',
      '```',
      '',
      '# D',
      '',
    ].join('\n')
    const state = foldState(doc)
    const hs = collectHeadings(state.doc)
    const outline = extractOutline(state.doc)
    expect(hs.map((h) => h.level)).toEqual(outline.map((o) => o.level))
    expect(hs.map((h) => state.doc.lineAt(h.key).number)).toEqual(outline.map((o) => o.line))
  })

  it('docChanged 消费点直查形态：函数以增量树为可选输入（省略时全量解析双入口）', () => {
    const doc = '# A\nx\n'
    const state = foldState(doc)
    const tree = state.field(liveDecorationsField).tree
    expect(collectHeadings(state.doc, tree).length).toBe(1)
    expect(collectHeadings(state.doc).length).toBe(1)
  })
})

// ---- 七、effect 直驱事务形态 ----

describe('effect 驱动（无 DOM-only 路径）', () => {
  it('headingFoldSet 为 StateEffect 实例（编程触发与用户触发同链路的单一生效通道）', () => {
    const setEff = headingFoldSet.of(new Set([1]))
    expect(setEff.is(headingFoldSet)).toBe(true)
  })
})

// ---- T02（#413）：五操作执行体（applyHeadingFoldOperation）----
// 双入口（键位本地分支与 ui.command 回发）共用同一执行实现的契约钉住：
// 操作语义落 effect（headingFoldSet），零写回；无目标静默（不 dispatch）。
describe('applyHeadingFoldOperation（T02 五操作执行体）', () => {
  // 跨级辖域：T2（##）是 T1（#）的子节——T1 节 [标题行尾, T3 行首) 覆盖
  // T2；T3（#）与 T1 同级，T1 节终止于 T3 行首
  const DOC = '# T1\n\nalpha\n\n## T2\n\nbeta\n\n# T3\n\ngamma\n'
  const T1 = 0
  const T2 = DOC.indexOf('## T2')
  const T3 = DOC.indexOf('# T3')

  function viewOf(doc: string, cursor: number): EditorView {
    const state = foldState(doc, [cursor])
    return new EditorView({ state, parent: document.body })
  }

  it('折叠 → 再按外扩；展开取辖域；切换取反：全程零写回', () => {
    const view = viewOf(DOC, DOC.indexOf('beta'))
    applyHeadingFoldOperation(view, 'headingFold')
    expect([...view.state.field(headingFoldField)]).toEqual([T2])
    // 光标迁移：beta 在 T2 隐藏区 → 迁到标题行行尾
    expect(view.state.selection.main.head).toBe(T2 + 5)
    applyHeadingFoldOperation(view, 'headingFold')
    expect([...view.state.field(headingFoldField)].sort((a, b) => a - b)).toEqual([T1, T2])
    // 外扩折叠把光标迁到 T1 标题行行尾 → 辖域 = T1，展开 T1（内层 T2 保持）
    expect(view.state.selection.main.head).toBe(T1 + 4)
    applyHeadingFoldOperation(view, 'headingUnfold')
    expect([...view.state.field(headingFoldField)]).toEqual([T2])
    applyHeadingFoldOperation(view, 'headingToggleFold')
    expect([...view.state.field(headingFoldField)].sort((a, b) => a - b)).toEqual([T1, T2])
    applyHeadingFoldOperation(view, 'headingToggleFold')
    expect([...view.state.field(headingFoldField)]).toEqual([T2])
    applyHeadingFoldOperation(view, 'headingFoldAll')
    expect([...view.state.field(headingFoldField)].sort((a, b) => a - b)).toEqual([T1, T2, T3])
    applyHeadingFoldOperation(view, 'headingUnfoldAll')
    expect([...view.state.field(headingFoldField)]).toEqual([])
    // 零写回：文档全程未变
    expect(view.state.doc.toString()).toBe(DOC)
    view.destroy()
  })

  it('箭头统一入口 toggleHeadingFoldAt：折叠方向迁移光标到标题行行尾，展开方向不迁移（审查轮 F1）', () => {
    // 光标先落在 T2 隐藏区内（beta）——箭头/省略号点击路径旧行为是直接
    // toggle 裸 effect（光标困在隐藏区），修复后统一走 setHeadingFolds
    const view = viewOf(DOC, DOC.indexOf('beta'))
    toggleHeadingFoldAt(view, T2)
    expect([...view.state.field(headingFoldField)]).toEqual([T2])
    expect(view.state.selection.main.head).toBe(T2 + 5)
    // 展开方向：光标已不在任何隐藏区，选区原样（迁移只在折叠方向发生）
    const headBefore = view.state.selection.main.head
    toggleHeadingFoldAt(view, T2)
    expect([...view.state.field(headingFoldField)]).toEqual([])
    expect(view.state.selection.main.head).toBe(headBefore)
    expect(view.state.doc.toString()).toBe(DOC)
    view.destroy()
  })

  it('无目标静默：首个标题之前折叠/切换 no-op（不 dispatch、键集引用不变）', () => {
    const view = viewOf('前置正文\n\n# T1\n\n正文\n', 0)
    const before = view.state.field(headingFoldField)
    applyHeadingFoldOperation(view, 'headingFold')
    applyHeadingFoldOperation(view, 'headingUnfold')
    applyHeadingFoldOperation(view, 'headingToggleFold')
    expect(view.state.field(headingFoldField)).toBe(before)
    view.destroy()
  })

  it('foldAll 目标 = 全部可折叠标题（同级相邻空节排除）', () => {
    // T1 与 T2 同级相邻：T1 节 [行尾, T2 行首) 仅一个换行 → 不可折叠；
    // T2 节含 beta → 可折叠——foldAll 只含 T2
    const doc = '# T1\n# T2\n\nbeta\n'
    const view = viewOf(doc, doc.indexOf('beta'))
    applyHeadingFoldOperation(view, 'headingFoldAll')
    expect([...view.state.field(headingFoldField)]).toEqual([doc.indexOf('# T2')])
    view.destroy()
  })
})

// ---- T03（#414）：省略号占位 widget 与 gutter 折叠箭头 ----
// 票面交付：折叠态标题行行尾 ⋯ 占位（Decoration.replace({widget})，点击
// 展开）、gutter 箭头（悬停显现/折叠态常显）、可访问形态与探针数据。
// 绘制层可见性断言归浏览器套件 headingFoldUi（jsdom 无布局，探针 visible
// 类字段不作依据）；此处钉住 widget 形态、箭头态集合、悬停判定纯函数与
// 探针的结构性字段。

describe('T03：省略号占位 widget（headingFoldDecorations 升级）', () => {
  it('折叠发射带 widget 的 replace（HeadingFoldEllipsisWidget，区间语义不变）', () => {
    let state = foldState('# A\nbody\nmore\n')
    state = fold(state, [0])
    const decos: Array<{ from: number; to: number; widget: unknown }> = []
    state.field(headingFoldDecorations).between(0, Number.MAX_SAFE_INTEGER, (from, to, deco) => {
      decos.push({ from, to, widget: deco.spec.widget })
    })
    expect(decos.length).toBe(1)
    expect(decos[0]!.from).toBe(3)
    expect(decos[0]!.to).toBe(state.doc.length)
    expect(decos[0]!.widget).toBeInstanceOf(HeadingFoldEllipsisWidget)
    // 效果语义不变：T01 的零宽隐藏升级为带占位，区间仍 = 标题块行尾到节末
  })

  it('widget eq 按 key 判等（同 key 复用 DOM、异 key 重绘）', () => {
    expect(new HeadingFoldEllipsisWidget(0).eq(new HeadingFoldEllipsisWidget(0))).toBe(true)
    expect(new HeadingFoldEllipsisWidget(0).eq(new HeadingFoldEllipsisWidget(5))).toBe(false)
  })

  it('widget DOM 形态：button + ⋯ 文字 + aria/tooltip 双语词（buildFoldButton 同口径）', () => {
    installLocale('test', {
      'headingfold.fold': '折叠此节',
      'headingfold.unfold': '展开此节',
    })
    const dom = new HeadingFoldEllipsisWidget(0).toDOM(null as never)
    expect(dom.tagName).toBe('BUTTON')
    expect(dom.className).toBe('vsidian-fold-ellipsis')
    expect(dom.getAttribute('aria-expanded')).toBe('false') // 折叠态：内容收起
    expect(dom.getAttribute('aria-label')).toBe('展开此节')
    expect(dom.getAttribute('data-tooltip')).toBe('展开此节')
    expect(dom.textContent).toContain('⋯')
    installLocale('test', {})
  })

  it('widget 点击经 toggleHeadingFoldAt 派发 headingFoldSet（effect 直驱，无 DOM-only 状态改动）', () => {
    const view = viewOfT03('# A\nbody\n', 6)
    const dom = new HeadingFoldEllipsisWidget(0).toDOM(view)
    ;(dom as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect([...view.state.field(headingFoldField)]).toEqual([0])
    // 再点（新 widget，同 key）：展开
    const dom2 = new HeadingFoldEllipsisWidget(0).toDOM(view)
    ;(dom2 as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect([...view.state.field(headingFoldField)]).toEqual([])
    view.destroy()
  })
})

describe('T03：gutter 箭头态集合（headingFoldArrowStates 纯函数）', () => {
  const DOC = '# T1\n\nalpha\n\n## T2\n\nbeta\n\n# T3\n\ngamma\n\n# Empty\n# Blank\n   \n'
  // T1/T2/T3 可折叠；Empty 与 Blank 相邻（Empty 节仅空白）不可折叠

  it('可折叠标题行 → 未折叠箭头；已折叠 → 折叠态箭头；空节不产生箭头', () => {
    const doc = DOC
    const state = EditorState.create({ doc })
    const headings = collectHeadings(state.doc)
    const states = headingFoldArrowStates(headings, new Set([doc.indexOf('## T2')]), state.doc)
    expect(states).toEqual([
      { lineFrom: 0, folded: false },                   // T1
      { lineFrom: doc.indexOf('## T2'), folded: true }, // T2（折叠态常显）
      { lineFrom: doc.indexOf('# T3'), folded: false }, // T3
    ])
  })

  it('全展开：全部可折叠行为未折叠态', () => {
    const state = EditorState.create({ doc: DOC })
    const states = headingFoldArrowStates(collectHeadings(state.doc), new Set(), state.doc)
    expect(states.every((s) => s.folded === false)).toBe(true)
    expect(states.length).toBe(3)
  })

  it('箭头 marker DOM：折叠态右向修饰类 + aria/tooltip 两态词 + 键位徽章属性', () => {
    installLocale('test', {
      'headingfold.fold': '折叠此节',
      'headingfold.unfold': '展开此节',
    })
    setHeadingFoldBindingHints((op) => (op === 'headingUnfold' ? ['ctrl+shift+]'] : ['ctrl+shift+[']))
    const unfolded = buildHeadingFoldArrowMarker(false).toDOM!(null as never) as HTMLElement
    expect(unfolded.tagName).toBe('BUTTON')
    expect(unfolded.className).toBe('vsidian-fold-arrow')
    expect(unfolded.getAttribute('aria-expanded')).toBe('true')
    expect(unfolded.getAttribute('aria-label')).toBe('折叠此节')
    expect(unfolded.getAttribute('data-tooltip')).toBe('折叠此节')
    expect(unfolded.getAttribute('data-tooltip-keys')).toBe('ctrl+shift+[')
    const folded = buildHeadingFoldArrowMarker(true).toDOM!(null as never) as HTMLElement
    expect(folded.className).toContain('vsidian-fold-arrow-collapsed')
    expect(folded.getAttribute('aria-expanded')).toBe('false')
    expect(folded.getAttribute('aria-label')).toBe('展开此节')
    expect(folded.getAttribute('data-tooltip-keys')).toBe('ctrl+shift+]')
    setHeadingFoldBindingHints(() => [])
    installLocale('test', {})
  })

  it('无绑定时省略号与箭头均不写 data-tooltip-keys（无徽章）', () => {
    installLocale('test', { 'headingfold.fold': '折叠此节', 'headingfold.unfold': '展开此节' })
    const unfolded = buildHeadingFoldArrowMarker(false).toDOM!(null as never) as HTMLElement
    expect(unfolded.hasAttribute('data-tooltip-keys')).toBe(false)
    installLocale('test', {})
  })
})

describe('T03：悬停显现判定（foldHoverArmed 纯函数）', () => {
  it('指针在正文列左缘以左 → 武装；箭头带整体属武装区（停在箭头上保持武装）', () => {
    expect(foldHoverArmed(10, 100)).toBe(true)
    expect(foldHoverArmed(99, 100)).toBe(true)
    expect(foldHoverArmed(100, 100)).toBe(false) // 恰在左缘：不武装
    expect(foldHoverArmed(150, 100)).toBe(false)
  })
})

describe('T03：paint 探针数据（collectHeadingFoldPaint 结构性字段）', () => {
  it('无折叠：foldCount 0、可折叠行计数、箭头字段缺省态', () => {
    const view = viewOfT03('# A\nbody\n\n# B\nmore\n', 0)
    const probe = collectHeadingFoldPaint(view)
    expect(probe.foldCount).toBe(0)
    expect(probe.foldableArrowCount).toBe(2)
    expect(probe.ellipsisText).toBeNull()
    view.destroy()
  })

  it('折叠后：foldCount、省略号文字、折叠态箭头与悬停武装字段', () => {
    const view = viewOfT03('# A\nbody\n\n# B\nmore\n', 0)
    view.dispatch({ effects: headingFoldSet.of(new Set([0])) })
    const probe = collectHeadingFoldPaint(view)
    expect(probe.foldCount).toBe(1)
    expect(probe.ellipsisText).toContain('⋯')
    expect(probe.arrowCollapsed).toBe(true)
    expect(probe.hoverArmed).toBe(false) // jsdom 未派发指针事件
    view.destroy()
  })
})

/** T03 装配视图：折叠本体 + 装饰（含省略号 widget）+ 箭头 gutter + 悬停插件 */
function viewOfT03(doc: string, cursor: number): EditorView {
  const state = EditorState.create({
    doc,
    extensions: [
      headingFoldField, headingFoldDecorations, headingFoldGutterExtension, liveDecorationsField,
    ],
    selection: EditorSelection.cursor(cursor),
  })
  return new EditorView({ state, parent: document.body })
}

// ---- T04（#415）：落点展开（reveal 族统一机制）与外部同步光标钳制 ----
// 规格「七、落点展开」「三、折叠与光标/选区（折叠后进入）」：任何把选区/
// 滚动定位到折叠隐藏区内的链路先展开包含落点的全部已折叠区间（嵌套全
// 展开，effect 直驱）再定位；外部同步把光标映射进隐藏区时钳制到辖域
// 标题行行尾。接线点（findLocate / locateOffset / setViewMode 回切）在
// syncController，浏览器套件端到端；本节钉住纯函数与 view 级行为。

/** T04 测试文档：T2（##）是 T1（#）的子节；T3（#）与 T1 同级截断 */
const R_DOC = '# T1\n\nalpha\n\n## T2\n\nbeta\n\n# T3\n\ngamma\n'
const R_T1 = 0
const R_T2 = R_DOC.indexOf('## T2')
const R_T3 = R_DOC.indexOf('# T3')
const R_ALPHA = R_DOC.indexOf('alpha')
const R_BETA = R_DOC.indexOf('beta')
const R_GAMMA = R_DOC.indexOf('gamma')

describe('T04：落点展开键集派生（unfoldAroundKeys 纯函数）', () => {
  const state = () => foldState(R_DOC)
  const headings = () => collectHeadings(state().doc)

  it('落点同时在嵌套外层与内层隐藏区 → 全部展开（嵌套全展开）', () => {
    // 折 T1+T2（beta 落点同时在两隐藏区内）：locate 进折叠区应两者皆展开
    const next = unfoldAroundKeys(new Set([R_T1, R_T2]), headings(), state().doc, R_BETA)
    expect(next).not.toBeNull()
    expect([...next!].sort((a, b) => a - b)).toEqual([])
  })

  it('落点仅在外层隐藏区（内层子节外）→ 只展开外层，其余折叠保持', () => {
    // alpha 在 T1 隐藏区内、T2 节外；T3 另行折叠应保持
    const next = unfoldAroundKeys(new Set([R_T1, R_T2, R_T3]), headings(), state().doc, R_ALPHA)
    expect(next).not.toBeNull()
    expect([...next!].sort((a, b) => a - b)).toEqual([R_T2, R_T3])
  })

  it('落点在可见区（未折叠节/标题行）→ null（零事务）', () => {
    const keys = new Set([R_T1])
    // gamma 在 T3 节内（未折叠）：T1 折叠保持
    expect(unfoldAroundKeys(keys, headings(), state().doc, R_GAMMA)).toBeNull()
    // 落点恰在折叠标题行行首（可见区）：不展开
    expect(unfoldAroundKeys(keys, headings(), state().doc, R_T1)).toBeNull()
  })

  it('区间落点：from 可见、to 落入隐藏区 → 展开（查找匹配跨折叠边界）', () => {
    // 模拟查找选区 [R_T1（标题行首可见）, R_ALPHA（隐藏区内）]
    const next = unfoldAroundKeys(new Set([R_T1]), headings(), state().doc, R_T1, R_ALPHA)
    expect(next).not.toBeNull()
    expect([...next!]).toEqual([])
  })

  it('脱靶键不因落点展开被清理（update 只做映射不修剪纪律）', () => {
    // 脱靶键 3（非标题行行首）：落点展开产出集保留原样（派生视图过滤语义）
    const next = unfoldAroundKeys(new Set([3, R_T1]), headings(), state().doc, R_BETA)
    expect(next).not.toBeNull()
    expect([...next!].sort((a, b) => a - b)).toEqual([3])
  })
})

describe('T04：落点展开（unfoldAround view 级 effect 直驱）', () => {
  it('真实 EditorView：落点在隐藏区 → dispatch 后键集移除（headingFoldSet）', () => {
    const view = viewOfT03(R_DOC, R_GAMMA)
    view.dispatch({ effects: headingFoldSet.of(new Set([R_T1, R_T2])) })
    expect(unfoldAround(view, R_BETA)).toBe(true)
    expect([...view.state.field(headingFoldField)]).toEqual([])
    view.destroy()
  })

  it('无包含折叠 → 返回 false 零事务（键集不变）', () => {
    const view = viewOfT03(R_DOC, R_GAMMA)
    view.dispatch({ effects: headingFoldSet.of(new Set([R_T1, R_T2])) })
    const before = view.state.field(headingFoldField)
    expect(unfoldAround(view, R_GAMMA)).toBe(false)
    expect(view.state.field(headingFoldField)).toBe(before) // 同一引用：未 dispatch
    view.destroy()
  })

  it('未装配折叠域 → 返回 false（无 headingFoldField 的视图安全）', () => {
    const view = new EditorView({ state: EditorState.create({ doc: R_DOC }), parent: document.body })
    expect(unfoldAround(view, R_BETA)).toBe(false)
    view.destroy()
  })
})

describe('T04：外部同步光标钳制（clampFoldHiddenCursor / clampSelectionOutOfFolds）', () => {
  const state = () => foldState(R_DOC)
  const headings = () => collectHeadings(state().doc)

  it('光标落入隐藏区 → 钳到辖域标题块行尾；可见区与端点边界 → null', () => {
    const folds = effectiveHeadingFolds(new Set([R_T1, R_T2]), headings(), state().doc)
    // beta 同时在 T1 与 T2 隐藏区：取最深（T2）→ 钳到 T2 标题块行尾 16
    expect(clampFoldHiddenCursor(folds, R_BETA)).toBe(R_T2 + '## T2'.length)
    // alpha 仅在 T1 隐藏区 → 钳到 T1 标题块行尾 4
    expect(clampFoldHiddenCursor(folds, R_ALPHA)).toBe(R_T1 + '# T1'.length)
    // 可见区（gamma 在未折叠 T3 节）与边界端点（hideFrom/hideTo 本身）→ null
    expect(clampFoldHiddenCursor(folds, R_GAMMA)).toBeNull()
    expect(clampFoldHiddenCursor(folds, R_T1 + '# T1'.length)).toBeNull()
    expect(clampFoldHiddenCursor(folds, R_T3)).toBeNull()
  })

  it('clampSelectionOutOfFolds：外部事务映射后光标进隐藏区 → 返回钳制选区；全可见 → null', () => {
    const view = viewOfT03(R_DOC, R_GAMMA)
    view.dispatch({ effects: headingFoldSet.of(new Set([R_T1])) })
    // 模拟外部同步映射产物：selection-only 事务把光标放进隐藏区（运行期
    // 唯一漏网路径——正常进入路径已被落点展开接住），随后钳制恢复
    view.dispatch({ selection: EditorSelection.range(R_ALPHA, R_BETA) })
    const clamped = clampSelectionOutOfFolds(view)
    expect(clamped).not.toBeNull()
    expect(clamped!.main.head).toBe(R_T1 + '# T1'.length)
    // 全可见：无需补事务
    view.dispatch({ selection: EditorSelection.cursor(R_GAMMA) })
    expect(clampSelectionOutOfFolds(view)).toBeNull()
    view.destroy()
  })

  it('无折叠域 → null（未装配视图安全）', () => {
    const view = new EditorView({ state: EditorState.create({ doc: R_DOC }), parent: document.body })
    expect(clampSelectionOutOfFolds(view)).toBeNull()
    view.destroy()
  })
})
