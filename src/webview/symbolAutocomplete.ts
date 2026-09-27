// 符号自动补全的编辑器适配层（工单 #123）：把 shared/symbols 的注册表
// 接进 CM6 事务流。
//
// 形态（架构约定：注册表存静态元数据，本层负责事件/选区/事务派发）：
// - 拦截点 EditorState.transactionFilter（先例 tableEditing 的
//   normalizeBlankRowInput）：键入起始符号的单条插入事务被改写为
//   open+close 一笔插入（光标居中、userEvent 保留 input.*）——一次补全
//   即一笔 edit.request，宿主撤销一次整体恢复，不另设编辑器 history。
// - 闭合越过：紧贴「自动补出的」闭合符号再键入同一符号（括号引号为
//   close 字符，Markdown 自反符为同字符）→ 改写为零插入纯选区事务
//   （零写回、零编辑历史），光标跳过闭合符号。越过只认自动来源
//   （autoclosePairsField 记录），手打的相邻闭合符号照常插入。
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
//   防双补）。提交完整符号对（一次两个字符）不命中单字符形态，天然不补。
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
import { findAutocloseEntry, shouldAutoclose, type SymbolPairEntry } from '../shared/symbols'
import { externalSync } from './syncController'
import { liveDecorationsField } from './liveDecorations'
import { tableRegionField } from './tableRegionSelection'
import { chainAt } from './markdownDoc'

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
 *  处理不可靠，返回 true 使 Markdown 触发符被抑制——括号引号不受影响） */
function inCodeContext(state: EditorState, pos: number): boolean {
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

/** 单条纯插入提取：{from===to 的单条变更, 插入文本}，否则 null */
function singleInsertionOf(tr: Transaction): { from: number; text: string } | null {
  if (tr.changes.empty) {
    return null
  }
  let found: { from: number; text: string } | null = null
  tr.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
    if (found || from !== to) {
      found = null
      return
    }
    found = { from, text: inserted.toString() }
  })
  return found
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
  return {
    changes: { from: pos, insert: entry.open + entry.close },
    selection: EditorSelection.cursor(pos + entry.open.length),
    effects: addAutoclosePair.of({
      from: pos,
      to: pos + entry.open.length + entry.close.length,
      open: entry.open,
      close: entry.close,
    }),
    annotations: keepEvent,
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
    scrollIntoView: true,
  })
}

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
 * 头注释——置于 tableEditing 之后） */
export const symbolAutocomplete = [
  symbolComposing,
  autoclosePairs,
  symbolCompositionTracker,
  autocloseInputFilter,
  keymap.of([{ key: 'Backspace', run: deleteAutoclosePair }]),
]

/** 供测试与 #124/#125 观测：当前自动空对区间（事务后坐标，只读快照） */
export function autoclosePairSpans(state: EditorState): readonly AutoclosePairSpan[] {
  return state.field(autoclosePairs, false) ?? []
}

/** 注册项查询透传（#124/#125 复用注册表的便捷入口） */
export { findAutocloseEntry, shouldAutoclose }
export type { SymbolPairEntry }
