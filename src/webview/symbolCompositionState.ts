// IME 组合开始时选区快照的共享状态（#124 IME 选区包裹修复）：组合开始
// 时浏览器已把 DOM 选区替换为组合串，原文只能此刻快照。symbolWrap 的
// composition tracker 写入，symbolAutocomplete 的提交补全 attempt 读取
// 让位——同一提交只允许一条路径生效（有选区走包裹重建，无选区走补全）。
//
// 本模块只存取状态不做判定（codeCardState 同款中立模块先例）：判定与
// 重建归 symbolWrap，让位归 symbolAutocomplete；type-only 导入 EditorView
// 不产生运行时依赖环。
import type { EditorView } from '@codemirror/view'

/** 组合开始时的选区快照（LF 坐标，组合前文档系） */
export interface CompositionSelectionSnapshot {
  /** main range 起点（组合替换区间的预期起点） */
  readonly mainFrom: number
  /** main range 原文（组合会把整个 main 选区替换为最终提交文本） */
  readonly mainText: string
  /** 其余非空 range 的原文（DOM 原生选区只表达 main，组合不触碰它们；
   *  重建后按事务坐标映射恢复选中） */
  readonly restRanges: readonly { from: number; to: number; text: string }[]
  /** 选区任一端处于代码上下文（快照时刻判定——原文仍在文档，语法树
   *  判定准确；定稿后区间已被替换，事后判定不可靠） */
  readonly inCode: boolean
}

const snapshots = new WeakMap<EditorView, CompositionSelectionSnapshot>()

export function setCompositionSelectionSnapshot(
  view: EditorView,
  snapshot: CompositionSelectionSnapshot | null,
): void {
  if (snapshot) {
    snapshots.set(view, snapshot)
  } else {
    snapshots.delete(view)
  }
}

export function getCompositionSelectionSnapshot(view: EditorView): CompositionSelectionSnapshot | null {
  return snapshots.get(view) ?? null
}
