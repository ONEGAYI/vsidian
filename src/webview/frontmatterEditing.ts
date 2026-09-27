// frontmatter 表格键盘导航与结构命令（工单 #140）。
//
// 键位语义（对齐表格网格 #13；与 fenceEscape/tableEditing 的装配顺序见
// syncController 的 extensions 注释——keymap 正序拼接，本组靠前）：
// - Tab / Shift+Tab：头区格间往返（key → value → 下行 key → …）；末格
//   前向越出到闭合行行尾；首格后向返回 false 落穿既有行为
// - Enter：下行同列导航（值列把数组宿主空值格与项视为同列）；末行时
//   数组末项 → 加项、其余 → 加键值对（编辑计划来自
//   shared/frontmatterTable，事务走标准出站链路）
// - 门控：多 range / 非空选区不接管；IME 组合中让位（compositionStarted，
//   与 tableEditing 同款先判）；头区外（fmCellAt null）落穿
// - 全部命令要么纯选区事务（零写回零 dirty），要么单笔编辑事务
//   （一次写回 = 宿主撤销一次整体恢复）
import { EditorSelection } from '@codemirror/state'
import { EditorView, keymap, type Command } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import {
  fmCellAt,
  fmCellDownTarget,
  fmCellNavTarget,
  planAddFmArrayItem,
  planAddFmEntry,
  type FmEditPlan,
  type FmTableModel,
} from '../shared/frontmatterTable'
import { liveDecorationsField } from './liveDecorations'

/** 当前成型模型（降级 null——键位整体落穿） */
function fmModelOf(view: EditorView): FmTableModel | null {
  return view.state.field(liveDecorationsField, false)?.fmModel ?? null
}

/** 单折叠光标才接管（表格导航同款门控） */
function fmCursor(view: EditorView): number | null {
  const sel = view.state.selection
  if (sel.ranges.length !== 1 || !sel.main.empty) {
    return null
  }
  return sel.main.head
}

function dispatchPlan(view: EditorView, plan: FmEditPlan): void {
  view.dispatch({
    changes: plan.changes.map((c) => ({ from: c.from, to: c.to ?? c.from, insert: c.insert })),
    selection: plan.selection
      ? { anchor: plan.selection.anchor, head: plan.selection.head ?? plan.selection.anchor }
      : undefined,
    scrollIntoView: true,
  })
}

/** Tab / Shift+Tab 格间往返（纯选区事务） */
export const fmTabKeyHandler: Command = (view: EditorView): boolean => {
  if (view.compositionStarted) return false
  const model = fmModelOf(view)
  const pos = fmCursor(view)
  if (!model || pos === null) return false
  const target = fmCellNavTarget(model, pos, false)
  if (target === null) return false
  view.dispatch({ selection: EditorSelection.cursor(target) })
  return true
}

export const fmShiftTabKeyHandler: Command = (view: EditorView): boolean => {
  if (view.compositionStarted) return false
  const model = fmModelOf(view)
  const pos = fmCursor(view)
  if (!model || pos === null) return false
  const target = fmCellNavTarget(model, pos, true)
  if (target === null) return false
  view.dispatch({ selection: EditorSelection.cursor(target) })
  return true
}

/** Enter：下行同列；末行按格语义加项/加行 */
export const fmEnterKeyHandler: Command = (view: EditorView): boolean => {
  if (view.compositionStarted) return false
  const model = fmModelOf(view)
  const pos = fmCursor(view)
  if (!model || pos === null) return false
  const cell = fmCellAt(model, pos)
  if (!cell) return false
  const down = fmCellDownTarget(model, pos)
  if (down !== null) {
    view.dispatch({ selection: EditorSelection.cursor(down) })
    return true
  }
  // 末行：数组项 → 加项；其余（key/value 格）→ 加键值对
  let plan: FmEditPlan | null = cell.kind === 'item' ? planAddFmArrayItem(model, cell.entryIndex) : null
  if (!plan) {
    plan = planAddFmEntry(model, view.state.doc.sliceString(model.from, model.to))
  }
  if (!plan) return false
  dispatchPlan(view, plan)
  return true
}

/** frontmatter 表格键位组（syncController 装配于 fenceEscape 之前） */
export const frontmatterEditing: Extension = keymap.of([
  { key: 'Tab', run: fmTabKeyHandler, shift: fmShiftTabKeyHandler },
  { key: 'Enter', run: fmEnterKeyHandler },
])
