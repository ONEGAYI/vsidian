// 命中显形（工单 #251）的活跃命中集单一事实源：
// 查找与选词的匹配忠实源码（竖线、分隔行、转义符、替换块源码都计数），
// 但装饰隐藏区内的命中「计数在、高亮不可见」——本模块把两类活跃命中
// （查找面板的全部匹配（含当前）+ 选词会话（Ctrl+D 族）的全部选区区间）
// 汇成一个状态注册，liveDecorations（grid 行/分隔行/转义符）与替换块
// 装饰（块级公式/Mermaid/代码卡片/独行图片）统一消费：命中触界的最小
// 单位（行或块）临时回源，命中高亮随之可见。
//
// 设计要点（票面设计共识 2026-10-01）：
// - 命中位置驱动，不复用编辑选区通道——grid 行竖线刻意不随编辑选区
//   显形（表格交互核心体验），显形只认命中触界；编辑选区（无面板无
//   会话）永不进命中集
// - 查找部分只读 findStateField.matches（不重算、不改计数语义）；面板
//   关闭时 closeFind 已整组清空 matches，命中集随之清空
// - 选词部分经 setOccurrenceHitActive 由 syncController 会话簿记驱动
//   （会话在场 = 选区计入；五通道结束 = 退出），会话中的命令事务
//   （occurrenceCmd 注解）不改 active，选区追加自然并入
// - 恢复时机：随命中集清空即恢复（零粘滞零记忆）；唯一例外是停驻
//   （sticky）——清空瞬间选区/光标恰好触界旧显形行时该行保持显形
//   （沿用分隔行「光标停驻显形」先例，避免关面板后光标落在隐形文本
//   上），选区离开即移出；编辑事务行号随变更映射并按映射后选区收缩
//   （编辑即离开停驻语义）
// - find 匹配坐标过期防御：编辑后、微任务重算前 matches 引用未变但
//   坐标已漂移——此窗口标记 stale，stale 期间清空不种停驻（宁可少
//   显形，不误显形；命中显形本身在该窗口沿用旧坐标暂态，与
//   findStateField.decos 的兜底映射同款口径，重算后自愈）
import { StateEffect, StateField, type EditorState, type Transaction } from '@codemirror/state'
import { findStateField } from './findSession'

/** 一条活跃命中：全文 UTF-16 code unit 的 [from, to) 区间（与 FindMatch 同构；
 *  occurrence 选区计入时 from < to，零宽防御按点触界） */
export interface HitRange {
  from: number
  to: number
}

/** 选词会话在场切换（syncController 会话簿记处 dispatch；重复同值无害——
 *  field 值无实质变化时保持引用，下游重建判定不触发） */
export const setOccurrenceHitActive = StateEffect.define<boolean>()

const EMPTY_HITS: readonly HitRange[] = []
const EMPTY_LINES: ReadonlySet<number> = new Set<number>()

/** 命中与区间相交（selectionTouchesRange 同谓词的区间版）：
 *  非空命中开区间交（from <= to 闭右端——命中起点落在区间右端也算触界，
 *  该位置仍是区间内可编辑位置）；零宽命中按点闭端触界 */
export function hitIntersectsRange(hits: readonly HitRange[], from: number, to: number): boolean {
  for (const hit of hits) {
    if (hit.to <= hit.from) {
      if (hit.from >= from && hit.from <= to) {
        return true
      }
    } else if (hit.from <= to && hit.to > from) {
      return true
    }
  }
  return false
}

/** 命中与行相交：行区间 [line.from, line.to]（不含行尾换行；行尾位置属于
 *  本行）。行级显形（grid 行回源/分隔行显露）的触界判定 */
export function hitTouchesLine(hits: readonly HitRange[], line: { from: number; to: number }): boolean {
  return hitIntersectsRange(hits, line.from, line.to)
}

/** 选区 range 集是否触界某行（selectionTouchesRange 的数组版语义：
 *  空 range 闭端含行两端；非空严格重叠。不依赖 EditorSelection，
 *  纯环境可测） */
function rangesTouchLine(ranges: readonly HitRange[], line: { from: number; to: number }): boolean {
  for (const range of ranges) {
    if (range.to <= range.from) {
      if (range.from >= line.from && range.from <= line.to) {
        return true
      }
    } else if (range.from < line.to && range.to > line.from) {
      return true
    }
  }
  return false
}

/** 行读取面（doc.line 的最小结构；StateField 内用 Text，纯函数测试用
 *  轻量模拟——planStickyLines/shrinkStickyLines 只读行号与行区间） */
export interface LineReader {
  lines: number
  line(n: number): { from: number; to: number }
}

/** 停驻种子（命中集清空瞬间）：旧命中触界的行 ∩ 当前选区触界行。
 *  只从「曾经显形」的行里筛——正常编辑选区从未显形，不进停驻 */
export function planStickyLines(
  prevHits: readonly HitRange[],
  selectionRanges: readonly HitRange[],
  doc: LineReader,
): ReadonlySet<number> {
  const out = new Set<number>()
  if (prevHits.length === 0) {
    return out
  }
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    if (hitTouchesLine(prevHits, line) && rangesTouchLine(selectionRanges, line)) {
      out.add(n)
    }
  }
  return out
}

/** 停驻收缩（纯选区事务）：保留仍被选区触界的停驻行（离开恢复） */
export function shrinkStickyLines(
  sticky: ReadonlySet<number>,
  selectionRanges: readonly HitRange[],
  doc: LineReader,
): ReadonlySet<number> {
  const out = new Set<number>()
  for (const n of sticky) {
    if (n >= 1 && n <= doc.lines && rangesTouchLine(selectionRanges, doc.line(n))) {
      out.add(n)
    }
  }
  return out
}

/** 停驻行号随文档变更映射，再按映射后选区收缩（编辑即离开：选区跟随
 *  编辑映射，编辑后不再触界的停驻行移出——用户焦点已离开的判定） */
function mapStickyLines(sticky: ReadonlySet<number>, tr: Transaction): ReadonlySet<number> {
  if (sticky.size === 0) {
    return EMPTY_LINES
  }
  const doc = tr.state.doc
  const mapped = new Set<number>()
  for (const n of sticky) {
    if (n < 1 || n > tr.startState.doc.lines) {
      continue
    }
    const pos = tr.changes.mapPos(tr.startState.doc.line(n).from, -1)
    mapped.add(doc.lineAt(Math.min(pos, doc.length)).number)
  }
  return shrinkStickyLines(mapped, tr.state.selection.ranges, doc)
}

/** 活跃命中集状态（liveDecorations 与替换块装饰的统一消费源） */
export interface HitRevealState {
  /** 活跃命中区间（查找匹配在前、会话选区在后；均为纯 {from,to} 物化） */
  hits: readonly HitRange[]
  /** 选词会话在场（在场时选区区间计入命中集） */
  occurrenceActive: boolean
  /** 停驻行号（新坐标系；命中集非空时恒空） */
  stickyLines: ReadonlySet<number>
  /** find 部分来源引用（findStateField.matches；引用比较驱动 hits 重建） */
  findSource: readonly HitRange[] | null
  /** 选区部分来源引用（occurrenceActive 时的 selection 对象；null = 无。
   *  Selection 引用在无选区变化的事务间稳定，比较语义与 matches 同构） */
  occSelection: { ranges: readonly { from: number; to: number }[] } | null
  /** find 匹配坐标过期标记：docChanged 后引用未变（重算未到）时置位，
   *  新引用（重算落位）时复位；stale 期间不种停驻 */
  findStale: boolean
}

export const hitRevealField = StateField.define<HitRevealState>({
  create(state) {
    const findSource = state.field(findStateField, false)?.matches ?? EMPTY_HITS
    return {
      hits: [...findSource],
      occurrenceActive: false,
      stickyLines: EMPTY_LINES,
      findSource,
      occSelection: null,
      findStale: false,
    }
  },
  update(value, tr) {
    let occurrenceActive = value.occurrenceActive
    for (const e of tr.effects) {
      if (e.is(setOccurrenceHitActive)) {
        occurrenceActive = e.value
      }
    }
    const findSource = tr.state.field(findStateField, false)?.matches ?? EMPTY_HITS
    const occSelection = occurrenceActive ? tr.state.selection : null

    // find 匹配坐标新鲜度：编辑后引用未变 = 旧坐标漂移窗口（微任务重算
    // 落位后恢复 fresh）；新引用 = 重算已落位
    let findStale = value.findStale
    if (tr.docChanged && findSource === value.findSource && findSource.length > 0) {
      findStale = true
    }
    if (findSource !== value.findSource) {
      findStale = false
    }

    const hitsUnchanged = findSource === value.findSource && occSelection === value.occSelection
    const hits = hitsUnchanged
      ? value.hits
      : [
          ...findSource,
          ...(occSelection ? occSelection.ranges.map((range) => ({ from: range.from, to: range.to })) : []),
        ]

    // 停驻管理（见模块头「恢复时机」）
    let sticky = value.stickyLines
    if (tr.docChanged) {
      sticky = mapStickyLines(value.stickyLines, tr)
    } else if (hits.length > 0) {
      if (sticky.size > 0) {
        sticky = EMPTY_LINES
      }
    } else if (value.hits.length > 0) {
      // 命中集清空瞬间（面板关闭/会话结束且 find 坐标可信）
      sticky = value.findStale
        ? EMPTY_LINES
        : planStickyLines(value.hits, tr.state.selection.ranges, tr.state.doc)
    } else if (sticky.size > 0 && tr.selection !== undefined) {
      sticky = shrinkStickyLines(value.stickyLines, tr.state.selection.ranges, tr.state.doc)
    }

    if (hitsUnchanged && occurrenceActive === value.occurrenceActive &&
        sticky === value.stickyLines && findStale === value.findStale) {
      return value
    }
    return { hits, occurrenceActive, stickyLines: sticky, findSource, occSelection, findStale }
  },
})

/** 行级显形消费上下文（liveDecorations 的 emitForRange 输入）：
 *  命中区间 + 停驻行号。null = hitRevealField 未装配（单测裸装配场景），
 *  显形关闭、既有行为零变化 */
export interface HitRevealContext {
  hits: readonly HitRange[]
  stickyLines: ReadonlySet<number>
}

/** 行是否显形（命中触界或停驻在场）——grid 行回源/分隔行显露的统一谓词 */
export function hitRevealTouchesLine(ctx: HitRevealContext | null, lineNo: number, line: { from: number; to: number }): boolean {
  if (!ctx) {
    return false
  }
  return ctx.stickyLines.has(lineNo) || hitTouchesLine(ctx.hits, line)
}

/** 从 EditorState 提取消费上下文（各装饰 StateField/ViewPlugin 的读取口） */
export function hitRevealContextOf(state: EditorState): HitRevealContext | null {
  const field = state.field(hitRevealField, false)
  return field ? { hits: field.hits, stickyLines: field.stickyLines } : null
}

/** 命中区间读取口（替换块装饰的 widget 回源判定用；未装配返回空集） */
export function hitRangesOf(state: EditorState): readonly HitRange[] {
  return state.field(hitRevealField, false)?.hits ?? EMPTY_HITS
}
