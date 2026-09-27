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
//   组合中间与定稿窗口，filter 一律不改写；IME 选区的包裹重建不走 filter，
//   由下方 wrapCompositionTracker 在定稿后主动派发）→ 变更形态与选区对齐
//   （每条单字符替换恰覆盖一个 range，全部 range 非空）→ 非表格格区
//   （tableRegionField 归 tableEditing）→ 注册表包裹命中
//   （findSelectionWrapEntry：只认 open）→ 代码上下文（选区任一端在代码
//   内按代码处理，Markdown 强调整笔不接管、括号引号照常）→
//   planSelectionWrap 拆段改写。
// - 粘贴/拖放/IME 完整对（多字符插入）不命中「单字符」形态，天然不包裹。
// - IME 定稿提交单个起始符号的选区包裹（修复）：组合开始时浏览器已把
//   DOM 选区替换为组合串，filter 无从包裹——wrapCompositionTracker 在
//   compositionstart 快照非空选区（原文 + 代码上下文判定），compositionend
//   后微任务 attempt（#123 同款时序：CM6 定稿 flush 微任务先行完成，
//   同步 dispatch 会打断定稿）按快照重建 open+原文+close 并保持原文
//   选中。组合中间与定稿事务本身仍不改写（input.type.compose 排除不变）。
//
// 装配顺序：置于 symbolAutocomplete 之后（扩展数组靠后者先过滤）——
// 包裹先于补全看到事务（两者分支互斥：包裹只认非空选区），tableEditing
// 的格区替换在更后仍能收到放行的格区事务。composition tracker 的微任务
// 与 #123 提交补全 attempt 的互斥经 symbolCompositionState 快照让位
// （#123 handler 在扩展序先执行，attempt 先入队，读到快照即让位）。
import { EditorSelection, EditorState, Transaction } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  findSelectionWrapEntry,
  shouldSelectionWrap,
  type SymbolPairEntry,
} from '../shared/symbols'
import { planSelectionWrap } from '../shared/symbolWrap'
import { inCodeContext } from './symbolAutocomplete'
import {
  getCompositionSelectionSnapshot,
  setCompositionSelectionSnapshot,
  type CompositionSelectionSnapshot,
} from './symbolCompositionState'
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

/** IME 定稿提交重建：按组合开始时的选区快照恢复原文并两侧插入 open/
 *  close（与直接键入路径同构——同用 planSelectionWrap 的拆段计划与
 *  原文选区语义，支持连续叠加）。全部短路条件见内注释；任一不满足即
 *  放弃，保持组合提交的原有结果（普通替换语义）。 */
function attemptCompositionWrap(
  view: EditorView,
  data: string,
  snapshot: CompositionSelectionSnapshot,
): void {
  if (data.length !== 1) {
    return // 完整符号对（一次提交两个字符）与多字符选字：不重建
  }
  const entry = findSelectionWrapEntry(data)
  if (!entry) {
    return // 提交的不是注册表 open（闭合符、尖括号等）：普通提交语义
  }
  if (view.compositionStarted || view.state.readOnly) {
    return
  }
  const state = view.state
  if (state.field(tableRegionField, false)) {
    return
  }
  if (!shouldSelectionWrap(entry, { inCode: snapshot.inCode })) {
    return // 代码上下文沿 allowInCode（Markdown 强调不进代码）
  }
  // 定稿形态校验：main 区间此刻应为「原文被提交符号替换」且光标紧随
  // 其后（追加式提交）；不符视为异常时序（外部并发改写等），不接管
  if (state.sliceDoc(snapshot.mainFrom, snapshot.mainFrom + data.length) !== data) {
    return
  }
  const selection = state.selection
  if (selection.ranges.length !== 1 + snapshot.restRanges.length || !selection.main.empty ||
      selection.main.head !== snapshot.mainFrom + data.length) {
    return
  }
  // 其余 range 原文须原样保留（DOM 原生选区只表达 main，组合不触碰
  // 它们——但坐标随 main 替换平移：main 之后的 range 按提交净长度差移动）
  const commitDelta = data.length - snapshot.mainText.length
  const mainEnd = snapshot.mainFrom + snapshot.mainText.length
  for (const range of snapshot.restRanges) {
    const shift = range.from >= mainEnd ? commitDelta : 0
    if (state.sliceDoc(range.from + shift, range.to + shift) !== range.text) {
      return
    }
  }
  // 快照原文上的包裹计划（相对坐标：[0, mainText.length)）
  const plan = planSelectionWrap(snapshot.mainText, [{ from: 0, to: snapshot.mainText.length }], entry)
  if (!plan) {
    return // 纯空白选区：不重建（保持提交替换结果）
  }
  // 计划应用到原文得到重建文本（plan.changes 是 from 升序纯插入组）
  let rebuilt = ''
  let at = 0
  for (const change of plan.changes) {
    rebuilt += snapshot.mainText.slice(at, change.from) + change.insert
    at = change.from
  }
  rebuilt += snapshot.mainText.slice(at)
  // 重建事务：提交符号区间 → 重建文本；选区 = 各段原文（main 平移）+
  // 其余 range（快照坐标经「替换+重建」总平移映射：main 之后的按
  // rebuilt 与原文的净长度差移动，之前的原样）。userEvent 用 input.type
  // （编程式派发不经 DOM 回流，不带 compose 标记；多字符替换形态不命中
  // 本组 filter 的单字符门控，不会递归改写）
  const insertDelta = rebuilt.length - snapshot.mainText.length
  const ranges = [
    ...plan.selection.map((range) =>
      EditorSelection.range(range.anchor + snapshot.mainFrom, range.head + snapshot.mainFrom)),
    ...snapshot.restRanges.map((range) => {
      const shift = range.from >= mainEnd ? insertDelta : 0
      return EditorSelection.range(range.from + shift, range.to + shift)
    }),
  ].sort((a, b) => a.from - b.from || a.to - b.to)
  view.dispatch({
    changes: { from: snapshot.mainFrom, to: snapshot.mainFrom + data.length, insert: rebuilt },
    selection: EditorSelection.create(ranges, 0),
    userEvent: 'input.type',
    scrollIntoView: true,
  })
}

/** IME 组合状态跟踪（选区快照与定稿重建）：组合开始时非空选区已被浏览器
 *  替换为组合串——原文只能此刻快照；定稿后微任务 attempt 重建（时序与
 *  #123 提交补全同款：CM6 定稿 flush 微任务先入队，本 attempt 执行时
 *  文档已是提交文本；dispatch 经 deferredLocal 与组合净输入合并单笔
 *  出站 = 宿主撤销一次整体恢复）。快照在 attempt 的 finally 清除——
 *  生命周期严格 start..end，期间 #123 的补全 attempt 读到快照即让位。 */
const wrapCompositionTracker = EditorView.domEventHandlers({
  compositionstart: (_event, view) => {
    setCompositionSelectionSnapshot(view, null)
    const state = view.state
    const selection = state.selection
    // 快照条件：全部 range 非空（混合光标形态与直接键入路径同判不接管）、
    // 非表格格区（格区 main 是空光标，天然不快照；此处再判属防御）
    if (selection.ranges.some((range) => range.empty)) {
      return
    }
    if (state.field(tableRegionField, false)) {
      return
    }
    const main = selection.main
    const restRanges = selection.ranges
      .filter((range) => range !== main)
      .map((range) => ({ from: range.from, to: range.to, text: state.sliceDoc(range.from, range.to) }))
    setCompositionSelectionSnapshot(view, {
      mainFrom: main.from,
      mainText: state.sliceDoc(main.from, main.to),
      restRanges,
      inCode: selectionTouchesCode(state, selection.ranges),
    })
  },
  compositionend: (event, view) => {
    const snapshot = getCompositionSelectionSnapshot(view)
    if (!snapshot) {
      return
    }
    const data = (event as CompositionEvent).data ?? ''
    queueMicrotask(() => {
      try {
        attemptCompositionWrap(view, data, snapshot)
      } finally {
        setCompositionSelectionSnapshot(view, null)
      }
    })
  },
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
  wrapCompositionTracker,
]
