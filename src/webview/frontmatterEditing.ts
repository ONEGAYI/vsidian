// frontmatter 成型头区的光标引导（工单 #140 Popover 改版，2026-09-27
// 用户决策：成型态不暴露源码——卡片只读，编辑收敛到修改按钮的 Popover）。
//
// 机制（transactionFilter 硬拦 + updateListener 兜底，两级等价）：
// - transactionFilter：纯选区事务的主锚与拖尾**都**落入成型头区
//   （model.from ≤ pos ≤ closeTo）时改写选区到 body 起点（闭合行之后的
//   第一个正文位置）——鼠标点击被替换呈现的围栏行、方向键向上走出正文、
//   点击表格行，都在这里被一次性弹回头区外
// - 「两端都在」口径（#183 修订，原为任一端）：全选/跨头区拖选（一端在
//   头区、一端在正文）放行——全选必须产生全文选区（剪切/复制全部的语义
//   前提，Ctrl+A 同受益），跨区选区的高亮落在呈现层（卡片行）不暴露源码
//   编辑入口；完全落入头区的选区（双击选词、头区内拖选）仍被引导
// - updateListener 兜底：初始选区（文档装载默认 0，恰在头区内）、带
//   变更事务（undo 恢复的选区、外部同步映射）落回头区时补一次纯选区
//   事务弹出——纯选区事务零写回零 dirty，不进撤销栈（同「两端都在」
//   口径，跨区选区不弹）
// - 豁免面：外部同步事务（externalSync，选区随映射语义不走引导）、
//   undo/redo（filter 豁免、兜底接管）、带变更的用户事务（filter 不
//   干涉其变更，选区由兜底判断——Popover 派发的头区写回不带选区，
//   正文选区经映射不落头区）
// - 降级形态（model null）：不干预，源码可编辑（既有降级语义）
//
// 文档变更通知：Popover 打开期间按最新模型重建（fmPopoverNotifyDocChanged）。
// 旧格内键位（Tab/Enter 格导航、末行加行）随格内编辑方案退役——编辑入口
// 收敛到修改按钮的 Popover。

import { EditorSelection, EditorState, Transaction, type Extension, type TransactionSpec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import type { Text } from '@codemirror/state'
import { fmPopoverNotifyDocChanged } from './frontmatterPopover'
// 循环依赖约定：syncController 装配本模块并派发外部同步事务；本模块在
// 回调运行时读其 externalSync 注解定义（顶层零执行对方代码），与
// frontmatterDecorations 的既有循环先例同款。
import { externalSync } from './syncController'
import { liveDecorationsField } from './liveDecorations'
import type { FmTableModel } from '../shared/frontmatterTable'

function modelOf(state: EditorState): FmTableModel | null {
  return state.field(liveDecorationsField, false)?.fmModel ?? null
}

/** 头区内位置判定（含首尾围栏行；闭区间口径同旧 touches 语义） */
function inFmRange(model: FmTableModel, pos: number): boolean {
  return pos >= model.from && pos <= model.closeTo
}

/** body 起点：闭合行之后（闭合行为末行时即文档尾） */
function bodyStartOf(doc: Text, closeTo: number): number {
  return doc.sliceString(closeTo, closeTo + 1) === '\n' ? closeTo + 1 : closeTo
}

/** 主选区两端都落入成型头区时，收敛为 body 起点单光标（已在目标则返回
 *  null 放行，防自环）。跨头区选区（一端头区一端正文，含全选）放行——
 *  见模块头「两端都在」口径 */
function escapeSelection(tr: Transaction): TransactionSpec | null {
  const model = modelOf(tr.startState)
  if (!model) return null
  const main = tr.selection!.main
  if (!inFmRange(model, main.anchor) || !inFmRange(model, main.head)) return null
  const target = bodyStartOf(tr.startState.doc, model.closeTo)
  if (main.anchor === target && main.head === target) return null
  return { selection: EditorSelection.cursor(target) }
}

export const frontmatterEditing: Extension = [
  EditorState.transactionFilter.of((tr) => {
    if (!tr.selection || tr.docChanged) return tr
    if (tr.annotation(externalSync)) return tr
    const userEvent = tr.annotation(Transaction.userEvent)
    if (userEvent && (userEvent.startsWith('undo') || userEvent.startsWith('redo'))) return tr
    const escaped = escapeSelection(tr)
    return escaped ?? tr
  }),
  EditorView.updateListener.of((u) => {
    if (u.docChanged) {
      fmPopoverNotifyDocChanged(u.view)
    }
    if (!u.selectionSet) return
    const model = modelOf(u.state)
    if (!model) return
    const main = u.state.selection.main
    // 兜底同「两端都在」口径：跨头区选区（含全选）不弹（filter 已放行，
    // 兜底再弹会与显式全选意图打架）
    if (!inFmRange(model, main.anchor) || !inFmRange(model, main.head)) return
    // update 途中禁止再 dispatch（CM6 update-in-progress 约束）：推迟到
    // 微任务重读最新状态——选区可能已被后续事务移出头区
    queueMicrotask(() => {
      const view = u.view
      const current = modelOf(view.state)
      if (!current) return
      const sel = view.state.selection.main
      if (!inFmRange(current, sel.anchor) && !inFmRange(current, sel.head)) return
      const target = bodyStartOf(view.state.doc, current.closeTo)
      if (sel.anchor === target && sel.head === target) return
      view.dispatch({ selection: EditorSelection.cursor(target) })
    })
  }),
]
