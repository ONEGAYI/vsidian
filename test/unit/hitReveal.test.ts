// 命中显形（#251）状态机契约：活跃命中集 = 查找全部匹配（含当前）+
// 选词会话全部选区；面板关闭/会话结束即清空，清空瞬间选区仍触界的显形行
// 转入停驻（沿用分隔行「光标停驻显形」先例），选区离开即移出；编辑事务
// 行号随变更映射并按映射后选区收缩。匹配集与计数语义零变更（本模块只读
// findStateField 的 matches，不重算）。编辑选区（无面板无会话）不进命中集
// ——显形只认命中触界，不认编辑选区触界（与既有 grid 编辑体验的硬边界）。
import { describe, it, expect } from 'vitest'
import { EditorSelection, EditorState } from '@codemirror/state'
import {
  findStateField,
  setFindMatches,
  type FindMatch,
} from '../../src/webview/findSession'
import {
  hitIntersectsRange,
  hitRevealField,
  hitTouchesLine,
  planStickyLines,
  setOccurrenceHitActive,
  shrinkStickyLines,
  type HitRange,
} from '../../src/webview/hitReveal'

const DOC_LINES = ['alpha beta', '| a | b |', '| --- | --- |', '| c | d |', 'tail']
const DOC = DOC_LINES.join('\n')

/** 行首 offset（test doc 内） */
function lineFrom(n: number): number {
  return DOC.split('\n').slice(0, n - 1).join('\n').length + (n > 1 ? 1 : 0)
}

function state0(): EditorState {
  return EditorState.create({
    doc: DOC,
    selection: EditorSelection.single(0),
    // 多选区用例需要显式开启（CM6 缺省把多 range 过滤为 main 单选区）
    extensions: [EditorState.allowMultipleSelections.of(true), findStateField, hitRevealField],
  })
}

function hitsOf(state: EditorState): HitRange[] {
  return [...state.field(hitRevealField).hits]
}

function stickyOf(state: EditorState): number[] {
  return [...state.field(hitRevealField).stickyLines].sort((a, b) => a - b)
}

describe('命中相交判定（纯函数）', () => {
  const line = { from: 5, to: 12 }

  it('非空命中与区间开区间相交：覆盖/部分重叠/跨界命中', () => {
    expect(hitIntersectsRange([{ from: 0, to: 5 }], 5, 12)).toBe(false) // 止于区间左端（左侧）
    expect(hitIntersectsRange([{ from: 0, to: 6 }], 5, 12)).toBe(true) // 跨左端
    expect(hitIntersectsRange([{ from: 6, to: 8 }], 5, 12)).toBe(true) // 含于区间
    expect(hitIntersectsRange([{ from: 11, to: 20 }], 5, 12)).toBe(true) // 跨右端
    expect(hitIntersectsRange([{ from: 12, to: 20 }], 5, 12)).toBe(true) // 起于区间右端（闭端）
    expect(hitIntersectsRange([{ from: 13, to: 20 }], 5, 12)).toBe(false) // 完全在右
  })

  it('零宽命中按点触界（闭区间两端都算）', () => {
    expect(hitIntersectsRange([{ from: 5, to: 5 }], 5, 12)).toBe(true)
    expect(hitIntersectsRange([{ from: 12, to: 12 }], 5, 12)).toBe(true)
    expect(hitIntersectsRange([{ from: 13, to: 13 }], 5, 12)).toBe(false)
  })

  it('行触界与区间同谓词；空集恒 false', () => {
    expect(hitTouchesLine([{ from: line.from, to: line.from + 1 }], line)).toBe(true)
    expect(hitTouchesLine([], line)).toBe(false)
  })
})

describe('停驻计划（纯函数）', () => {
  const doc = { line: (n: number) => ({ from: lineFrom(n), to: lineFrom(n) + DOC_LINES[n - 1]!.length }), lines: DOC_LINES.length }

  it('清空瞬间：旧命中行 ∩ 选区触界行 → 停驻行号集合', () => {
    // 命中覆盖第 2、3 行（grid 表头与分隔行）；选区触界第 3 行 → 只停驻第 3 行
    const hits: HitRange[] = [
      { from: lineFrom(2), to: lineFrom(2) + 2 },
      { from: lineFrom(3), to: lineFrom(3) + 2 },
    ]
    const sel = [{ from: lineFrom(3), to: lineFrom(3) + 3 }]
    expect([...planStickyLines(hits, sel, doc)].sort((a, b) => a - b)).toEqual([3])
  })

  it('选区不触界任何旧命中行 → 空停驻（无粘滞）', () => {
    const hits: HitRange[] = [{ from: lineFrom(2), to: lineFrom(2) + 2 }]
    const sel = [{ from: lineFrom(5), to: lineFrom(5) + 1 }]
    expect(planStickyLines(hits, sel, doc).size).toBe(0)
  })

  it('空光标闭端触界（停驻先例：光标停在行内任意位置含行首行尾）', () => {
    const hits: HitRange[] = [{ from: lineFrom(2), to: lineFrom(2) + 2 }]
    const caretAtLineStart = [{ from: lineFrom(2), to: lineFrom(2) }]
    expect(planStickyLines(hits, caretAtLineStart, doc).size).toBe(1)
  })

  it('收缩：选区离开的行移出、仍触界的保留', () => {
    const selOn3 = [{ from: lineFrom(3), to: lineFrom(3) + 1 }]
    const shrunk = shrinkStickyLines(new Set([2, 3]), selOn3, doc)
    expect([...shrunk]).toEqual([3])
    const selOn5 = [{ from: lineFrom(5), to: lineFrom(5) + 1 }]
    expect(shrinkStickyLines(new Set([3]), selOn5, doc).size).toBe(0)
  })
})

describe('活跃命中集状态机（StateField）', () => {
  it('查找匹配进入命中集（面板在场 = matches 非空）', () => {
    const matches: FindMatch[] = [{ from: lineFrom(2), to: lineFrom(2) + 3 }]
    const s2 = state0().update({ effects: setFindMatches.of({ matches, index: 0 }) }).state
    expect(hitsOf(s2)).toEqual(matches)
  })

  it('occurrence 会话在场时选区区间并入；多选区全部计入', () => {
    const matches: FindMatch[] = [{ from: lineFrom(2), to: lineFrom(2) + 3 }]
    let s = state0().update({ effects: setFindMatches.of({ matches, index: 0 }) }).state
    s = s.update({
      selection: EditorSelection.create([
        EditorSelection.range(lineFrom(3), lineFrom(3) + 2),
        EditorSelection.range(lineFrom(5), lineFrom(5) + 1),
      ], 1),
      effects: setOccurrenceHitActive.of(true),
    }).state
    expect(hitsOf(s)).toEqual([
      { from: lineFrom(2), to: lineFrom(2) + 3 },
      { from: lineFrom(3), to: lineFrom(3) + 2 },
      { from: lineFrom(5), to: lineFrom(5) + 1 },
    ])
  })

  it('会话结束：选区退出命中集（编辑选区不再是命中）', () => {
    let s = state0().update({
      selection: EditorSelection.range(lineFrom(3), lineFrom(3) + 2),
      effects: setOccurrenceHitActive.of(true),
    }).state
    expect(hitsOf(s)).toEqual([{ from: lineFrom(3), to: lineFrom(3) + 2 }])
    s = s.update({ effects: setOccurrenceHitActive.of(false) }).state
    expect(hitsOf(s)).toEqual([])
  })

  it('编辑选区（无面板无会话）永不进命中集（硬边界）', () => {
    let s = state0()
    s = s.update({ selection: EditorSelection.range(lineFrom(2), lineFrom(2) + 9) }).state
    expect(hitsOf(s)).toEqual([])
    expect(stickyOf(s)).toEqual([])
  })

  it('面板关闭（matches 清空）瞬间：选区触界的旧命中行转入停驻', () => {
    const matches: FindMatch[] = [
      { from: lineFrom(2), to: lineFrom(2) + 3 },
      { from: lineFrom(3), to: lineFrom(3) + 3 },
    ]
    let s = state0().update({ effects: setFindMatches.of({ matches, index: 0 }) }).state
    // 关面板不动选区；模拟查找驱动选区停在分隔行（第 3 行）的场景
    s = s.update({ selection: { anchor: lineFrom(3) + 2 } }).state
    s = s.update({ effects: setFindMatches.of({ matches: [], index: 0 }) }).state
    expect(hitsOf(s)).toEqual([])
    expect(stickyOf(s)).toEqual([3])
  })

  it('停驻随选区离开移出（离开恢复）', () => {
    const matches: FindMatch[] = [{ from: lineFrom(3), to: lineFrom(3) + 3 }]
    let s = state0().update({ effects: setFindMatches.of({ matches, index: 0 }) }).state
    s = s.update({ selection: { anchor: lineFrom(3) + 2 } }).state
    s = s.update({ effects: setFindMatches.of({ matches: [], index: 0 }) }).state
    expect(stickyOf(s)).toEqual([3])
    s = s.update({ selection: { anchor: lineFrom(5) } }).state
    expect(stickyOf(s)).toEqual([])
  })

  it('停驻在场期间再次命中（面板重开）→ 停驻清空、显形由命中驱动', () => {
    const matches: FindMatch[] = [{ from: lineFrom(3), to: lineFrom(3) + 3 }]
    let s = state0().update({ effects: setFindMatches.of({ matches, index: 0 }) }).state
    s = s.update({ selection: { anchor: lineFrom(3) + 2 } }).state
    s = s.update({ effects: setFindMatches.of({ matches: [], index: 0 }) }).state
    expect(stickyOf(s)).toEqual([3])
    s = s.update({ effects: setFindMatches.of({ matches, index: 0 }) }).state
    expect(stickyOf(s)).toEqual([])
    expect(hitsOf(s)).toEqual(matches)
  })

  it('编辑文档：停驻行号随变更映射，且按映射后选区收缩（编辑即离开）', () => {
    const matches: FindMatch[] = [{ from: lineFrom(3), to: lineFrom(3) + 3 }]
    let s = state0().update({ effects: setFindMatches.of({ matches, index: 0 }) }).state
    s = s.update({ selection: { anchor: lineFrom(3) + 2 } }).state
    s = s.update({ effects: setFindMatches.of({ matches: [], index: 0 }) }).state
    expect(stickyOf(s)).toEqual([3])
    // 在停驻行上方插入一行（\n）：第 3 行变第 4 行，光标跟随映射仍触界
    s = s.update({ changes: { from: lineFrom(2), insert: 'new row\n' } }).state
    expect(stickyOf(s)).toEqual([4])
    // 远处键入（真实键盘路径：光标随输入落在编辑点）→ 停驻行不再被选区
    // 触界 → 移出。纯 changes 不带选区时映射后选区仍触界则保守保留
    s = s.update({
      changes: { from: 0, insert: 'x' },
      selection: { anchor: 1 },
    }).state
    expect(stickyOf(s)).toEqual([])
  })

  it('find 匹配坐标过期（编辑后未重算）期间清空不误种停驻', () => {
    const matches: FindMatch[] = [{ from: lineFrom(3), to: lineFrom(3) + 3 }]
    let s = state0().update({ effects: setFindMatches.of({ matches, index: 0 }) }).state
    s = s.update({ selection: { anchor: lineFrom(3) + 2 } }).state
    // 编辑使 matches 坐标过期（引用未变），随后才整组清空（替换整批的时序）
    s = s.update({ changes: { from: lineFrom(1), insert: 'z' } }).state
    s = s.update({ effects: setFindMatches.of({ matches: [], index: 0 }) }).state
    // 过期坐标不可信：不种停驻（宁可少显形，不误显形）
    expect(stickyOf(s)).toEqual([])
  })

  it('occurrence 会话中 Ctrl+D 追加选区：命中集随之增长', () => {
    let s = state0().update({
      selection: EditorSelection.range(lineFrom(2), lineFrom(2) + 1),
      effects: setOccurrenceHitActive.of(true),
    }).state
    s = s.update({
      selection: EditorSelection.create([
        EditorSelection.range(lineFrom(2), lineFrom(2) + 1),
        EditorSelection.range(lineFrom(5), lineFrom(5) + 1),
      ], 1),
    }).state
    expect(hitsOf(s)).toEqual([
      { from: lineFrom(2), to: lineFrom(2) + 1 },
      { from: lineFrom(5), to: lineFrom(5) + 1 },
    ])
  })
})
