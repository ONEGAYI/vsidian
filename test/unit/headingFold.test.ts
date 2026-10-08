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
import { EditorSelection, EditorState } from '@codemirror/state'
import type { DecorationSet } from '@codemirror/view'
import { externalSync } from '../../src/webview/liveInstance'
import { liveDecorationsField } from '../../src/webview/liveDecorations'
import { extractOutline } from '../../src/webview/outline'
import {
  collectHeadings,
  effectiveHeadingFolds,
  enclosingHeading,
  headingFoldDecorations,
  headingFoldField,
  headingFoldSet,
  headingFoldToggle,
  foldableHeadingSpans,
  migrateSelectionForFold,
  resolveHeadingFoldTargets,
  resolveHeadingToggleTargets,
  resolveHeadingUnfoldTargets,
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
})

// ---- 二、StateField 语义与坐标生命周期 ----

describe('headingFoldField：StateField 语义与坐标生命周期', () => {
  it('折叠是视图态：effect 事务零写回（无文档变更）', () => {
    const state = foldState('# A\nx\n')
    const tr = state.update({ effects: headingFoldToggle.of(0) })
    expect(tr.changes.empty).toBe(true)
    expect(tr.docChanged).toBe(false)
    expect(tr.state.field(headingFoldField).has(0)).toBe(true)
  })

  it('headingFoldToggle 翻转单键；headingFoldSet 整体设置（unfoldAll = 空集）', () => {
    let state = foldState('# A\nx\n')
    state = state.update({ effects: headingFoldToggle.of(0) }).state
    expect(state.field(headingFoldField).has(0)).toBe(true)
    state = state.update({ effects: headingFoldToggle.of(0) }).state
    expect(state.field(headingFoldField).size).toBe(0)
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
  it('headingFoldSet 与 headingFoldToggle 均为 StateEffect 实例（编程触发与用户触发同链路）', () => {
    const setEff = headingFoldSet.of(new Set([1]))
    expect(setEff.is(headingFoldSet)).toBe(true)
    const toggleEff = headingFoldToggle.of(1)
    expect(toggleEff.is(headingFoldToggle)).toBe(true)
  })
})
