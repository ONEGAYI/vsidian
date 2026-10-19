// 符号自动补全的编辑器适配层（工单 #123）：把 shared/symbols 的注册表
// 接进 CM6 事务流。
//
// 形态（架构约定：注册表存静态元数据，本层负责事件/选区/事务派发）：
// - 拦截点 EditorState.transactionFilter（先例 tableEditing 的
//   normalizeBlankRowInput）。#597 方案 3 起键入路径与 IME 路径同构
//   （原始输入 → 行为链 → 内置兜底）：键入起始符号的单条插入事务
//   **放行原始单字符**（不再原子改写为 open+close 一笔）——行为链经
//   maybeDriveAddonBehaviors 以原始形态（inputText='('）驱动恰一次，
//   内置兜底在微任务时点补闭合 + addAutoclosePair（自动状态登记移到
//   attempt——与下一按键之间只隔微任务，事件循环保证不可达竞态）；
//   原始事务带 symbolRawInput 注解强制暂缓出站，兜底触碰暂缓并入同段，
//   flush 单笔 edit.request = 宿主撤销一次整体恢复（两笔均在同一事件
//   循环任务内完成，微任务先于渲染，用户不可见中间态）。
// - 闭合越过：紧贴「自动补出的」闭合符号再键入同一符号（括号引号为
//   close 字符，Markdown 自反符为同字符）→ 改写为零插入纯选区事务
//   （零写回、零编辑历史），光标跳过闭合符号。越过只认自动来源
//   （autoclosePairsField 记录），手打的相邻闭合符号照常插入。
//   越过维持 filter 内改写（#597：零 doc 变更、不进驱动面与出站，
//   无坐标问题）。
// - 空对退格：自动补出且仍为空的符号对内部退格同删两侧（keymap，
//   先于表格/默认删除链）；非自动来源与对内已有内容不接管。
// - IME：组合期间（compositionstart..compositionend）不干预（filter 读
//   symbolComposing StateField 拦截组合中间事务；标志经 DOM 事件维护，
//   compositionend 后延迟一个宏任务复位——同步 dispatch 会打断 CM6 的
//   组合定稿 flush 与 DOM 写回，tableComposition 先例同款延迟）。提交
//   补全由 compositionend 钩子的微任务 attempt 统一触发（CM6 InputState
//   的监听先于扩展 handler，定稿 flush 微任务先行完成，attempt 执行时
//   光标左侧已是提交文本；attempt 的 dispatch 与组合净输入在
//   deferredLocal 合并，flush 单笔出站 = 宿主撤销一次整体恢复，幂等检查
//   防双补；dispatch 携带 builtinEditOrigin 注解（#595）——行为链不
//   消费该内置加工事务，IME 定稿已由 #593 补驱动以干净形态驱动过一次）。
//   组合开始时有非空选区则 attempt 让位（读
//   symbolCompositionState 快照——提交归 #124 的包裹重建路径，同一提交
//   只允许一条路径生效）。提交完整符号对（一次两个字符）不命中单字符
//   形态，天然不补。
// - 粘贴/拖放：按 userEvent（input.paste / input.drop）排除。
// - 代码上下文：chainAt 命中围栏/缩进代码块、行内代码、CodeMark/
//   CodeInfo 边界或 frontmatter（liveDecorationsField 的增量树与 fm，
//   不全文重解析）；HTML 块同代码口径。括号引号照补，Markdown 强调
//   抑制（shared/symbols 的 allowInCode 登记）。
// - 表格格区选区（tableRegionField 非 null）不接管：格区替换语义归
//   tableEditing 的 replaceTableRegionInput；普通文本选区同样放行
//   （选区包裹归 #124）。
// - 自动来源状态（autoclosePairsField）：仅本模块的补全事务写入
//   （不把人工输入当自动状态）；文档变化经 mapPos 平移，对内字符被
//   改写或区间越界即失效；外部同步（externalSync 注解的 doc.changed/
//   resync/full sync）整体清空——外部替换或重载不残留过期位置。
//
// 装配顺序：置于 tableEditing 之后（扩展数组靠后者先匹配/先过滤）——
// 符号补全先于表格的空白行规范化与格区替换看到事务（无选区单字符
// 场景与它们互斥，先判先退），Backspace 链先于表格的删除命令（自动
// 空对是更具体的编辑器状态）。
import { EditorSelection, EditorState, StateEffect, StateField, Transaction } from '@codemirror/state'
import { EditorView, keymap, type Command } from '@codemirror/view'
import { findAutocloseEntry, shouldAutoclose } from '../shared/symbols'
import { getCompositionSelectionSnapshot } from './symbolCompositionState'
import { externalSync, builtinEditOrigin, symbolRawInput } from './syncController'
import { liveDecorationsField } from './liveDecorations'
import { tableRegionField } from './tableRegionSelection'
import { chainAt } from '../shared/markdownDoc'

/** 代码上下文节点（含边界标记）：CodeMark/CodeInfo 归入围栏内部口径 */
const CODE_CONTEXT_NODES = new Set([
  'FencedCode', 'CodeText', 'CodeBlock', 'InlineCode', 'CodeMark', 'CodeInfo', 'HTMLBlock',
])

/** 自动补出的空符号对区间（open.from .. close.to，事务后坐标）；携带
 * open/close 文本用于后续失效校验（对内字符不再是 open+close 即失效） */
interface AutoclosePairSpan {
  from: number
  to: number
  open: string
  close: string
}

const setSymbolComposing = StateEffect.define<boolean>()
const addAutoclosePair = StateEffect.define<AutoclosePairSpan>()

/** #597 键入路径兜底材料：filter 时点判定（注册表命中 + shouldAutoclose
 *  通过 + 格区/选区/组合等全部门控已过），随放行事务经 effect 流动到
 *  本组 updateListener——filter 无 view 句柄（CM6 transactionFilter 只
 *  见事务），per-view WeakMap 暂存不可达，事务内载体是唯一通道；微任务
 *  同一事件循环内消费即逝，无跨事务残留 */
interface TypedAutoclosePending {
  /** 原始插入点：open 字符在放行事务后占据 [pos, pos + open.length) */
  readonly pos: number
  readonly open: string
  readonly close: string
}

const pendingTypedAutoclose = StateEffect.define<TypedAutoclosePending>()

/** 组合进行中标志（compositionstart..compositionend；end 同步复位——
 * 见头注释 IME 节：定稿事务晚于 compositionend，若延迟复位会把提交
 * 单个起始符号的补全一并吞掉） */
const symbolComposing = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setSymbolComposing)) value = effect.value
    }
    return value
  },
})

/** 自动来源跟踪：补全事务追加、常规变更平移并校验、外部同步清空 */
const autoclosePairs = StateField.define<readonly AutoclosePairSpan[]>({
  create: () => [],
  update(pairs, tr) {
    if (tr.annotation(externalSync)) {
      // 外部增量/全文重载：位置语义不可靠，整体失效
      return []
    }
    let next: AutoclosePairSpan[] = [...pairs]
    if (tr.docChanged) {
      // 旧对按本事务变更平移（旧坐标 → 新坐标）；删穿/越界即失效
      next = []
      for (const pair of pairs) {
        const from = tr.changes.mapPos(pair.from, 1)
        const to = tr.changes.mapPos(pair.to, -1)
        if (from < to && to <= tr.newDoc.length) {
          next.push({ ...pair, from, to })
        }
      }
    }
    const add = tr.effects.find((effect) => effect.is(addAutoclosePair))
    if (add) {
      // 补全事务自带新坐标（本事务产物），不再经 mapPos 平移
      next = [...next, add.value as AutoclosePairSpan]
    }
    // 对内字符不再是 open+close（对内输入了内容或被改写）：失效。
    // 逐项 sliceString 的成本与自动对数量同阶（每次补全至多 +1，用户
    // 消费即越过/删除），不随文档体量增长
    return next.filter((pair) => tr.newDoc.sliceString(pair.from, pair.to) === pair.open + pair.close)
  },
})

/** 代码上下文判定（#123 口径：增量树 + frontmatter；树未就绪按代码
 *  处理不可靠，返回 true 使 Markdown 触发符被抑制——括号引号不受影响）。
 *  #124 选区包裹复用同一口径（导出共享，不另设判定） */
export function inCodeContext(state: EditorState, pos: number): boolean {
  const field = state.field(liveDecorationsField, false)
  if (!field) {
    return true
  }
  if (field.fm && pos >= field.fm.start && pos <= field.fm.end) {
    return true
  }
  const chain = chainAt(field.tree, pos)
  return chain.some((node) => CODE_CONTEXT_NODES.has(node.name))
}

/** 光标左侧紧邻的同字符连续长度（键入前状态；pos 为插入点） */
function runBeforeOf(state: EditorState, pos: number, ch: string): number {
  let count = 0
  let at = pos - 1
  while (at >= 0 && count < 64 && state.sliceDoc(at, at + 1) === ch) {
    count++
    at--
  }
  return count
}

/** 单条纯插入提取：{from===to 的单条变更, 插入文本}，否则 null。
 *  独立 mismatch 标志判废（同 symbolWrap.singleCharReplacements 写法）：
 *  直接置 found=null 会在「插、替、插」多变更序列下被第三条纯插入复活 */
function singleInsertionOf(tr: Transaction): { from: number; text: string } | null {
  if (tr.changes.empty) {
    return null
  }
  let found: { from: number; text: string } | null = null
  let mismatch = false
  tr.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
    if (mismatch) {
      return
    }
    if (found || from !== to) {
      mismatch = true
      return
    }
    found = { from, text: inserted.toString() }
  })
  return mismatch ? null : found
}

/**
 * 补全/越过的输入改写 filter。门控链（全部短路条件，规格 #123）：
 * 设置开（扩展经 Compartment 热重配增删，关闭时本 filter 不在装配中）
 * → input 类事务 → 非粘贴/拖放 → 非组合中 → 单条单字符纯插入 →
 * 单 range 空选区 → 非表格格区 → 注册表命中 → 越过或补全判定。
 */
const autocloseInputFilter = EditorState.transactionFilter.of((tr) => {
  if (!tr.isUserEvent('input') || tr.isUserEvent('input.paste') || tr.isUserEvent('input.drop')) {
    return tr
  }
  if (tr.startState.field(symbolComposing, false)) {
    return tr
  }
  const insertion = singleInsertionOf(tr)
  if (!insertion || insertion.text.length !== 1) {
    return tr
  }
  const state = tr.startState
  const selection = state.selection
  if (selection.ranges.length !== 1 || !selection.main.empty) {
    return tr
  }
  const pos = selection.main.head
  if (pos !== insertion.from) {
    return tr // 插入点与光标分离（异常形态）：不接管
  }
  if (state.field(tableRegionField, false)) {
    return tr // 表格格区：替换语义归 replaceTableRegionInput
  }
  const ch = insertion.text
  const entry = findAutocloseEntry(ch)
  if (!entry) {
    return tr
  }
  const event = tr.annotation(Transaction.userEvent)
  const keepEvent = event ? Transaction.userEvent.of(event) : undefined

  // 闭合越过：键入字符等于**该自动对**的 close，且光标恰在其 open 之后
  // （右侧紧邻自动补出的闭合符号）。键入字符必须是这个对的闭合字符
  // 本身——不能按「命中任一注册项的 close」放行（否则在 `(|)` 内键入
  // Markdown 自反符 `*` 会被误当作 `)` 越过）。零插入纯选区：不产生写回。
  if (ch === entry.close) {
    const pairs = state.field(autoclosePairs, false) ?? []
    for (const pair of pairs) {
      if (ch === pair.close && pos === pair.from + pair.open.length && pos < pair.to &&
          state.sliceDoc(pos, pair.to) === pair.close) {
        return {
          changes: [],
          selection: EditorSelection.cursor(pair.to),
          annotations: keepEvent,
        }
      }
    }
  }

  // 触发补全（仅键入 open；自反符号 open === close 先经越过分支）
  if (ch !== entry.open) {
    return tr
  }
  const charBefore = pos > 0 ? state.sliceDoc(pos - 1, pos) : ''
  const charAfter = pos < state.doc.length ? state.sliceDoc(pos, pos + 1) : ''
  const ctx = {
    charBefore,
    charAfter,
    runBefore: entry.mirrorAtRunStartOnly ? runBeforeOf(state, pos, ch) : 0,
    inCode: inCodeContext(state, pos),
  }
  if (!shouldAutoclose(entry, ctx)) {
    return tr
  }
  // #597 方案 3：放行原始单字符插入（不再原子改写）——链驱动以原始形态
  // （inputText 单字符）恰一次驱动，内置兜底在微任务时点补闭合（M1 链
  // 先、M3 内置后，ADR-0020 裁决一）。重指定同形事务（变更/选区/滚动
  // 原样重建，userEvent 经 keepEvent 保留）+ symbolRawInput 注解：出站
  // 强制暂缓，兜底触碰暂缓并入同段，flush 单笔出站 = 一条宿主撤销记录。
  // 兜底材料经 effect 流动（filter 无 view 句柄，无法写 per-view 暂存）
  return {
    changes: tr.changes,
    selection: tr.selection,
    effects: pendingTypedAutoclose.of({ pos, open: entry.open, close: entry.close }),
    annotations: [...(keepEvent ? [keepEvent] : []), symbolRawInput.of(true)],
    scrollIntoView: tr.scrollIntoView,
  }
})

/** 自动空对内部退格：同删两侧（单笔事务走宿主撤销链） */
const deleteAutoclosePair: Command = (view) => {
  if (view.compositionStarted) return false
  const state = view.state
  const selection = state.selection
  if (selection.ranges.length !== 1 || !selection.main.empty) return false
  const head = selection.main.head
  for (const pair of state.field(autoclosePairs, false) ?? []) {
    if (head === pair.from + pair.open.length && head < pair.to &&
        state.sliceDoc(pair.from, pair.to) === pair.open + pair.close) {
      view.dispatch({
        changes: { from: pair.from, to: pair.to },
        selection: EditorSelection.cursor(pair.from),
        userEvent: 'delete.symbolPair',
        scrollIntoView: true,
      })
      return true
    }
  }
  return false
}

/** IME 提交补全（compositionend 主动路径）：Chromium 链路里组合的最终
 * 提交文本与最后候选一致时 DOM 无变化，CM6 不派发定稿事务——补全只能
 * 在组合结束点主动触发。提交 ≠ 最后候选时 CM6 会派发带 compose 标记的
 * 定稿事务（由 filter 处理），本路径的幂等检查（右侧已是闭合符号则
 * 跳过）防止双补。只认「追加式提交」：光标紧邻左侧即提交符号。 */
function attemptCompositionCommitClose(view: EditorView, data: string): void {
  if (data.length !== 1) {
    return // 完整符号对（一次提交两个字符）不补；多字符提交不适用
  }
  const entry = findAutocloseEntry(data)
  if (!entry || entry.open !== data) {
    return
  }
  if (view.compositionStarted || view.state.readOnly) {
    return
  }
  if (getCompositionSelectionSnapshot(view)) {
    return // 组合开始时有非空选区：提交归 #124 包裹重建路径（互斥，
    // 同一提交只允许一条路径生效；本 attempt 先入队须让位）
  }
  const state = view.state
  const selection = state.selection
  if (selection.ranges.length !== 1 || !selection.main.empty) {
    return
  }
  if (state.field(tableRegionField, false)) {
    return
  }
  const pos = selection.main.head
  if (pos < 1 || state.sliceDoc(pos - 1, pos) !== data) {
    return
  }
  if (state.sliceDoc(pos, pos + entry.close.length) === entry.close) {
    return // 定稿事务已补过（或手打已有闭合符号）：幂等跳过
  }
  const ctx = {
    charBefore: pos >= 2 ? state.sliceDoc(pos - 2, pos - 1) : '',
    charAfter: pos < state.doc.length ? state.sliceDoc(pos, pos + 1) : '',
    runBefore: entry.mirrorAtRunStartOnly ? runBeforeOf(state, pos - 1, data) : 0,
    inCode: inCodeContext(state, pos),
  }
  if (!shouldAutoclose(entry, ctx)) {
    return
  }
  view.dispatch({
    changes: { from: pos, insert: entry.close },
    selection: EditorSelection.cursor(pos),
    effects: addAutoclosePair.of({
      from: pos - entry.open.length,
      to: pos + entry.close.length,
      open: entry.open,
      close: entry.close,
    }),
    userEvent: 'input.type',
    // #595 内置来源标记：行为链不消费本事务（IME 定稿已由 #593 补驱动
    // 以干净形态驱动过一次）；userEvent 保留 input.* 维持撤销惯例与
    // 「一次补全=一笔 edit.request」出站合并不变
    annotations: builtinEditOrigin.of(true),
    scrollIntoView: true,
  })
}

/** #597 键入路径兜底补全（filter 放行原始 open 键入后的微任务时点）：
 *  镜像 attemptCompositionCommitClose 的结构与防御。形态校验（追加式）：
 *  光标仍紧邻原始 open 之后且左侧字符未被改写——链（M1 微任务先执行）
 *  已改写区间或移动光标时让位（组件产出为终态，零重复内容）。通过则
 *  在光标处补 close + addAutoclosePair（自动状态登记移到 attempt，
 *  filter 不再写 effect——与下一按键之间只隔微任务，事件循环保证
 *  不可达竞态）。 */
function attemptTypedAutoclose(view: EditorView, pending: TypedAutoclosePending): void {
  if (view.compositionStarted || view.state.readOnly) {
    return
  }
  const state = view.state
  const selection = state.selection
  if (selection.ranges.length !== 1 || !selection.main.empty) {
    return
  }
  const pos = selection.main.head
  if (pos !== pending.pos + pending.open.length ||
      state.sliceDoc(pos - pending.open.length, pos) !== pending.open) {
    return // 原始插入已被链改写 / 光标已移动：让位
  }
  view.dispatch({
    changes: { from: pos, insert: pending.close },
    selection: EditorSelection.cursor(pos),
    effects: addAutoclosePair.of({
      from: pending.pos,
      to: pos + pending.close.length,
      open: pending.open,
      close: pending.close,
    }),
    userEvent: 'input.type',
    // #595/#597 内置来源标记：行为链不消费本事务（键入路径已由放行的
    // 原始事务以干净形态驱动过一次）；userEvent 保留 input.* 维持撤销
    // 惯例与「一次补全=一笔 edit.request」出站合并不变
    annotations: builtinEditOrigin.of(true),
    scrollIntoView: true,
  })
}

/** #597 兜底入队点：键入路径兜底 attempt 的 updateListener。不得从
 *  filter 入队——filter 先于 updateListener 执行，attempt 会抢在链驱动
 *  前落地，打破 SelectKey「键入文本在快照中占据 [replaced.from,
 *  +inputText.length)」坐标不变量（#597 验证报告第二节反证：内置先改写
 *  后补发原始载荷必产出重复内容）。
 *  **装配序实证修正（#597 实施发现）**：updateListener 按扩展数组**正序**
 *  执行（靠前者先，裸 CM6 与 liveInstance 装配双重实验钉住——原方案
 *  「数组靠后者先执行」的假设不成立），因此本 listener **不在符号组内
 *  装配**，而由 liveInstance 装配在主簿记 listener（链驱动入队点）之后
 *  （数组更后段 = 更晚执行）——主簿记先入队链驱动微任务（M1），本
 *  listener 后入队兜底微任务（M3），微任务 FIFO 保证执行序（ADR-0020
 *  裁决一；symbolTypedPath 测试钉住）。常驻装配（不随设置 Compartment
 *  退出）：filter 关闭时无 pending effect 在途，本 listener 零成本。 */
export const typedAutocloseScheduler = EditorView.updateListener.of((update) => {
  for (const tr of update.transactions) {
    const effect = tr.effects.find((e) => e.is(pendingTypedAutoclose))
    if (effect) {
      const pending = effect.value
      queueMicrotask(() => attemptTypedAutoclose(update.view, pending))
    }
  }
})

/** 组合标志复位的延迟句柄（compositionend 后一个宏任务复位——CM6 的
 * 组合定稿 flush 与 DOM 写回发生在这窗口内，同步 dispatch 会打断定稿
 * （tableComposition 先例同款延迟；tableCaret 的 IME 回归实证） */
const composingResetTimers = new WeakMap<EditorView, ReturnType<typeof setTimeout>>()

/** IME 组合状态跟踪：compositionstart/update 置位；compositionend 延迟
 * 一个宏任务复位（composingResetTimers 注释）。时序设计（写回一笔的
 * 关键）：CM6 InputState 的 compositionend 监听先于扩展 handler 注册，
 * 其定稿 flush 微任务先入队——本 handler 的微任务 attempt 随后执行，
 * 此时文档已是提交文本（提交==候选：组合事务已写入；提交≠候选：定稿
 * flush 已替换），attempt 补全的 dispatch 又因 deferredLocal 存在与组合
 * 净输入合并，flush 时单笔 edit.request 出站 = 宿主撤销一次整体恢复。 */
const symbolCompositionTracker = EditorView.domEventHandlers({
  compositionstart: (_event, view) => {
    const timer = composingResetTimers.get(view)
    if (timer !== undefined) {
      clearTimeout(timer)
      composingResetTimers.delete(view)
    }
    if (!view.state.field(symbolComposing, false)) {
      view.dispatch({ effects: setSymbolComposing.of(true) })
    }
  },
  compositionend: (event, view) => {
    if (!view.state.field(symbolComposing, false)) {
      return
    }
    const data = (event as CompositionEvent).data ?? ''
    queueMicrotask(() => attemptCompositionCommitClose(view, data))
    composingResetTimers.set(view, setTimeout(() => {
      composingResetTimers.delete(view)
      if (view.state.field(symbolComposing, false)) {
        view.dispatch({ effects: setSymbolComposing.of(false) })
      }
    }, 0))
  },
})

/** 装配入口（syncController 经 Compartment 按设置热重配；顺序约束见
 * 头注释——置于 tableEditing 之后）。#597 兜底入队点
 * typedAutocloseScheduler 不在此装配——见其注释（liveInstance 装配在
 * 主簿记 listener 之后）。 */
export const symbolAutocomplete = [
  symbolComposing,
  autoclosePairs,
  symbolCompositionTracker,
  autocloseInputFilter,
  keymap.of([{ key: 'Backspace', run: deleteAutoclosePair }]),
]
