// 选区包裹的编辑器适配层（工单 #124）：把 shared/symbolWrap 的包裹计划
// 接进 CM6 事务流。
//
// 形态（架构约定：注册表存静态元数据、计划用纯函数，本层负责事件/
// 选区/事务派发）：
// - 拦截点 EditorState.transactionFilter（#123 同款先例）：有非空选区时
//   键入注册包裹符号的「选区替换」事务被改写为「各段两侧插入 + 原文
//   保持选中」的一笔事务（userEvent 保留 input.*）——一次包裹（含跨段
//   多块）即一笔 edit.request，宿主撤销一次整体恢复。
// - 两种输入形态都认（真实键盘在 CM6 中的产物）：
//   1) 单 range 非空选区：事务为「选区替换为单字符、光标落插入后」
//      （浏览器 DOM 替换 → applyDOMChange 的选区替换识别）。
//   2) 多 range 非空选区：事务为「每 range 一条单字符替换」（CM6
//      applyDefaultInsert 的 replaceSelection 分支——多光标输入的底层
//      机制）。跨段包裹第一轮后选区即多 range（各段原文），第二轮键入
//      走本形态，标记不进原文。
// - 多 range 选区依赖 allowMultipleSelections facet（EditorState 否则会
//      把任何事务选区 asSingle 砍成单 range）；随本扩展组装配，关闭
//      「选区包裹」设置即整组退出。已知视觉边界：本扩展未启用
//      drawSelection，多 range 只有 main range 反映为 DOM 原生选区高亮
//      （功能不受影响——继续键入经 replaceSelection 覆盖全部 range）。
// - 门控链：input 类事务 → 非粘贴/拖放 → 非组合（input.type.compose 涵盖
//   组合中间与定稿窗口；IME 组合链路里选区已被候选替换，包裹天然不
//   发生）→ 变更形态与选区对齐（每条单字符替换恰覆盖一个 range，全部
//   range 非空）→ 非表格格区（tableRegionField 归 tableEditing）→
//   注册表包裹命中（findSelectionWrapEntry：只认 open）→ 代码上下文
//   （选区任一端在代码内按代码处理，Markdown 强调整笔不接管、括号引号
//   照常）→ planSelectionWrap 拆段改写。
// - 粘贴/拖放/IME 完整对（多字符插入）不命中「单字符」形态，天然不包裹。
//
// 装配顺序：置于 symbolAutocomplete 之后（扩展数组靠后者先过滤）——
// 包裹先于补全看到事务（两者分支互斥：包裹只认非空选区），tableEditing
// 的格区替换在更后仍能收到放行的格区事务。
import { EditorSelection, EditorState, Transaction } from '@codemirror/state'
import {
  findSelectionWrapEntry,
  shouldSelectionWrap,
  type SymbolPairEntry,
} from '../shared/symbols'
import { planSelectionWrap } from '../shared/symbolWrap'
import { inCodeContext } from './symbolAutocomplete'
import { tableRegionField } from './tableRegionSelection'

/** 提取事务的全部纯替换条目；任一条不是「单字符替换」返回 null */
function singleCharReplacements(tr: Transaction): { from: number; to: number; ch: string }[] | null {
  if (tr.changes.empty) {
    return null
  }
  const items: { from: number; to: number; ch: string }[] = []
  let mismatch = false
  tr.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
    if (mismatch) {
      return
    }
    const text = inserted.toString()
    if (text.length !== 1) {
      mismatch = true
      return
    }
    items.push({ from, to, ch: text })
  })
  return mismatch ? null : items
}

/** 变更条目与选区 range 一一对齐（每条替换恰覆盖一个 range）且全部
 *  range 非空、插入同一字符 */
function replacementsMatchRanges(
  items: readonly { from: number; to: number; ch: string }[],
  ranges: readonly { from: number; to: number }[],
): string | null {
  if (items.length !== ranges.length || items.length === 0) {
    return null
  }
  let ch: string | null = null
  for (let i = 0; i < items.length; i++) {
    if (items[i]!.from !== ranges[i]!.from || items[i]!.to !== ranges[i]!.to) {
      return null
    }
    if (ranges[i]!.from >= ranges[i]!.to) {
      return null // 空 range（光标）混入：混合形态不接管
    }
    if (ch === null) {
      ch = items[i]!.ch
    } else if (ch !== items[i]!.ch) {
      return null
    }
  }
  return ch
}

/** 选区任一端处于代码上下文即按代码处理（混合选区整笔不接管，
 *  规格「未知混合块选区不自动转换块结构，优先保留原输入」） */
function selectionTouchesCode(state: EditorState, ranges: readonly { from: number; to: number }[]): boolean {
  return ranges.some((range) => inCodeContext(state, range.from) || inCodeContext(state, range.to))
}

/**
 * 选区包裹的输入改写 filter（#124）。门控链见文件头注释；返回改写事务
 * 或原事务（不接管时保留普通「键入替换选区」编辑语义）。
 */
const selectionWrapFilter = EditorState.transactionFilter.of((tr) => {
  if (!tr.isUserEvent('input') || tr.isUserEvent('input.paste') || tr.isUserEvent('input.drop')) {
    return tr
  }
  if (tr.isUserEvent('input.type.compose')) {
    return tr // 组合中间与定稿（选区已被组合替换，包裹不发生）
  }
  const items = singleCharReplacements(tr)
  if (!items) {
    return tr
  }
  const state = tr.startState
  const ranges = state.selection.ranges.map((range) => ({ from: range.from, to: range.to }))
  const ch = replacementsMatchRanges(items, ranges)
  if (ch === null) {
    return tr
  }
  if (state.field(tableRegionField, false)) {
    return tr // 表格格区：替换语义归 tableEditing
  }
  const entry: SymbolPairEntry | null = findSelectionWrapEntry(ch)
  if (!entry) {
    return tr
  }
  if (!shouldSelectionWrap(entry, { inCode: selectionTouchesCode(state, ranges) })) {
    return tr
  }
  const plan = planSelectionWrap(state.doc.toString(), ranges, entry)
  if (!plan) {
    return tr
  }
  const event = tr.annotation(Transaction.userEvent)
  return {
    changes: plan.changes,
    selection: EditorSelection.create(
      plan.selection.map((range) => EditorSelection.range(range.anchor, range.head)),
      0,
    ),
    annotations: event ? Transaction.userEvent.of(event) : undefined,
    scrollIntoView: tr.scrollIntoView,
  }
})

/**
 * 装配入口（syncController 经 Compartment 按设置热重配；顺序约束见
 * 文件头——置于 symbolAutocomplete 之后）。allowMultipleSelections 随组
 * 装配：多 range 原文选区的存续前提（也顺带启用 CM6 原生 Alt+click
 * 多光标，属已接受的伴生行为）。
 */
export const symbolSelectionWrap = [
  EditorState.allowMultipleSelections.of(true),
  selectionWrapFilter,
]
