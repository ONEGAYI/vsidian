// 选区包裹的编辑器适配层（工单 #124）：把 shared/symbolWrap 的包裹计划
// 接进 CM6 事务流。
//
// 形态（架构约定：注册表存静态元数据、计划用纯函数，本层负责事件/
// 选区/事务派发）：
// - 拦截点 EditorState.transactionFilter（#123 同款先例）。#597 方案 3
//   起键入路径与 IME 路径同构（原始输入 → 行为链 → 内置兜底）：有非空
//   选区时键入注册包裹符号的「选区替换」事务**放行原始替换**（不再
//   原子改写为「各段两侧插入 + 原文保持选中」）——链驱动以原始形态
//   （inputText 单字符 + replaced 原文区间）恰一次驱动，内置兜底在微
//   任务时点按段重建并恢复原文选中；原始事务带 symbolRawInput 注解
//   强制暂缓出站，兜底触碰暂缓并入同段，flush 单笔 edit.request = 宿主
//   撤销一次整体恢复。多 range 时 SelectKey 管线让位（selections>1
//   既有门）、兜底承担重建。
// - 两种输入形态都认（真实键盘在 CM6 中的产物）：
//   1) 单 range 非空选区：事务为「选区替换为单字符、光标落插入后」
//      （浏览器 DOM 替换 → applyDOMChange 的选区替换识别）。
//   2) 多 range 非空选区：事务为「每 range 一条单字符替换」（CM6
//      applyDefaultInsert 的 replaceSelection 分支——多光标输入的底层
//      机制）。跨段包裹第一轮后选区即多 range（各段原文），第二轮键入
//      走本形态，标记不进原文。
// - 多 range 选区依赖 allowMultipleSelections facet（EditorState 否则会
//      把任何事务选区 asSingle 砍成单 range）；#237 起该 facet 由多光标
//      扩展组（multicursor.ts，独立设置默认开）装配并随 drawSelection 呈现
//      多 range 选区/副光标——多光标关闭时跨段包裹文本仍生效，产物选区
//      被折回主 range（降级边界，规格 keybindings.md #237 节）。
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
//   compositionstart 捕获阶段快照非空选区（先于 CM6 内建跨行删除，记录原文
//   与代码上下文），compositionend
//   后微任务 attempt（#123 同款时序：CM6 定稿 flush 微任务先行完成，
//   同步 dispatch 会打断定稿）按快照重建 open+原文+close 并保持原文
//   选中；多 range 时各段同步叠加。组合中间与定稿事务本身仍不改写
//   （input.type.compose 排除不变）。
//
// 装配顺序：置于 symbolAutocomplete 之后（扩展数组靠后者先过滤）——
// 包裹先于补全看到事务（两者分支互斥：包裹只认非空选区），tableEditing
// 的格区替换在更后仍能收到放行的格区事务。composition tracker 的微任务
// 与 #123 提交补全 attempt 的互斥经 symbolCompositionState 快照让位
// （#123 handler 在扩展序先执行，attempt 先入队，读到快照即让位）。
import { EditorSelection, EditorState, StateEffect, Transaction } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import {
  findSelectionWrapEntry,
  shouldSelectionWrap,
  type SymbolPairEntry,
} from '../shared/symbols'
import { planSelectionWrap } from '../shared/symbolWrap'
import { inCodeContext } from './symbolAutocomplete'
import { builtinEditOrigin, symbolRawInput } from './syncController'
import {
  getCompositionSelectionSnapshot,
  setCompositionSelectionSnapshot,
  type CompositionSelectionSnapshot,
} from './symbolCompositionState'
import { tableRegionField } from './tableRegionSelection'

/** #597 键入路径包裹兜底的选区快照（filter 时点判定）：原文段（键入前
 *  LF 坐标与文本）、键入字符与代码上下文门控结果（原始事务会清空
 *  tableRegionField，attempt 侧无法复查——门控随快照携带，镜像
 *  compositionInTableRegion 模式）。经 effect 随放行事务流动（filter 无
 *  view 句柄，per-view WeakMap 暂存不可达），微任务同一事件循环内消费
 *  即逝，无跨事务残留 */
interface TypedWrapPending {
  /** 键入的包裹字符（注册表 open） */
  readonly ch: string
  readonly open: string
  readonly close: string
  /** 选区任一端处于代码上下文（filter 时点判定） */
  readonly inCode: boolean
  /** 长度基准（放行事务后的文档长度）：同步组件以同前缀形态改写（区间
   *  首字符仍是键入符、光标位置不变——评审 001）时占据/选区校验都仍
   *  满足、无法分辨，长度基准是「无人净改写」的唯一可验证证据 */
  readonly docLength: number
  /** 键入前各 range 的原文段（LF 坐标，升序与选区一致） */
  readonly segments: readonly { from: number; to: number; text: string }[]
}

const pendingTypedWrap = StateEffect.define<TypedWrapPending>()

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
 * 选区包裹的输入改写 filter（#124）。门控链见文件头注释；#597 方案 3
 * 起不再原子改写——命中即放行原始替换事务（重指定同形 + symbolRawInput
 * 出站强制暂缓）并经 effect 携带兜底快照，微任务 attempt 按段重建
 * （M1 链先、M3 内置后）；纯空白选区（plan null）保持普通替换语义。
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
  const inCode = selectionTouchesCode(state, ranges)
  if (!shouldSelectionWrap(entry, { inCode })) {
    return tr
  }
  const plan = planSelectionWrap(state.doc.toString(), ranges, entry)
  if (!plan) {
    return tr // 纯空白选区：不接管，保留普通替换语义
  }
  // #597 方案 3：放行原始替换（不再改写）——链驱动以原始形态（inputText
  // 单字符 + replaced 原文区间）恰一次驱动，内置兜底在微任务时点按段
  // 重建（多 range 时链让位、兜底承担，数学原型见 #597 探针第 5 例）。
  // 重指定同形事务（变更/选区/滚动原样重建，userEvent 保留）+
  // symbolRawInput 注解：出站强制暂缓，兜底触碰暂缓并入同段，flush
  // 单笔出站 = 一条宿主撤销记录。快照经 effect 流动（filter 无 view
  // 句柄，无法写 per-view WeakMap 暂存）；格区等门控在 filter 时点判定
  // 并随快照携带——原始事务会清空 tableRegionField，attempt 侧无法复查
  // （镜像 compositionInTableRegion 模式）
  const event = tr.annotation(Transaction.userEvent)
  return {
    changes: tr.changes,
    selection: tr.selection,
    effects: pendingTypedWrap.of({
      ch,
      open: entry.open,
      close: entry.close,
      inCode,
      docLength: tr.newDoc.length,
      segments: ranges.map((range) => ({ from: range.from, to: range.to, text: state.doc.sliceString(range.from, range.to) })),
    }),
    annotations: [...(event ? [Transaction.userEvent.of(event)] : []), symbolRawInput.of(true)],
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
  // 其余 range 原文在组合提交时须原样保留（DOM 原生选区只表达 main，
  // 组合不触碰它们；下方重建事务再给各 range 叠加包裹符号）
  const commitDelta = data.length - snapshot.mainText.length
  const mainEnd = snapshot.mainFrom + snapshot.mainText.length
  for (const range of snapshot.restRanges) {
    const shift = range.from >= mainEnd ? commitDelta : 0
    if (state.sliceDoc(range.from + shift, range.to + shift) !== range.text) {
      return
    }
  }
  // 每个原文 range 独立套用同一拆段计划。组合只替换 main，其他 range
  // 仍在文档内；其坐标先按组合提交的净长度映射到当前文档。
  const mainPlan = planSelectionWrap(snapshot.mainText, [{ from: 0, to: snapshot.mainText.length }], entry)
  if (!mainPlan) {
    return // 纯空白选区：不重建（保持提交替换结果）
  }
  const segments = [
    { from: snapshot.mainFrom, to: snapshot.mainFrom + data.length, text: snapshot.mainText, plan: mainPlan },
    ...snapshot.restRanges.map((range) => {
      const shift = range.from >= mainEnd ? commitDelta : 0
      return {
        from: range.from + shift,
        to: range.to + shift,
        text: range.text,
        plan: planSelectionWrap(range.text, [{ from: 0, to: range.text.length }], entry),
      }
    }),
  ].sort((a, b) => a.from - b.from)
  const changes: { from: number; to: number; insert: string }[] = []
  const ranges: ReturnType<typeof EditorSelection.range>[] = []
  let delta = 0
  for (const segment of segments) {
    const start = segment.from + delta
    if (!segment.plan) {
      ranges.push(EditorSelection.range(start, start + segment.text.length))
      continue
    }
    let rebuilt = ''
    let at = 0
    for (const change of segment.plan.changes) {
      rebuilt += segment.text.slice(at, change.from) + change.insert
      at = change.from
    }
    rebuilt += segment.text.slice(at)
    changes.push({ from: segment.from, to: segment.to, insert: rebuilt })
    ranges.push(...segment.plan.selection.map((range) =>
      EditorSelection.range(start + range.anchor, start + range.head)))
    delta += rebuilt.length - (segment.to - segment.from)
  }
  // 编程式派发不经 DOM 回流；多字符替换形态不命中 filter 的单字符门控。
  // builtinEditOrigin（#595）：行为链不消费本事务（IME 定稿已由 #593 补
  // 驱动以干净形态驱动过一次——行为修饰先改写区间时，下方形态校验自然
  // 让位）；userEvent 保留 input.* 维持撤销惯例与「一次包裹=一笔
  // edit.request」出站合并不变
  view.dispatch({
    changes,
    selection: EditorSelection.create(ranges, 0),
    userEvent: 'input.type',
    annotations: builtinEditOrigin.of(true),
    scrollIntoView: true,
  })
}

/** IME 组合状态跟踪（选区快照与定稿重建）：捕获阶段先于 CM6 内建
 *  observer 快照原文；定稿后微任务 attempt 重建（时序与
 *  #123 提交补全同款：CM6 定稿 flush 微任务先入队，本 attempt 执行时
 *  文档已是提交文本；dispatch 经 deferredLocal 与组合净输入合并单笔
 *  出站 = 宿主撤销一次整体恢复）。快照在 attempt 的 finally 清除——
 *  生命周期严格 start..end，期间 #123 的补全 attempt 读到快照即让位。 */
function captureCompositionSelection(view: EditorView): void {
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
}

// 捕获阶段先于 CM6 的冒泡阶段 compositionstart observer；后者会同步删除
// 跨行选区，因此普通 domEventHandlers 此时已无法读取原文。
const wrapCompositionCapture = ViewPlugin.fromClass(class {
  private readonly onStart: () => void

  constructor(private readonly view: EditorView) {
    this.onStart = () => captureCompositionSelection(view)
    view.contentDOM.addEventListener('compositionstart', this.onStart, true)
  }

  destroy() {
    this.view.contentDOM.removeEventListener('compositionstart', this.onStart, true)
    setCompositionSelectionSnapshot(this.view, null)
  }
})

const wrapCompositionTracker = EditorView.domEventHandlers({
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

/** #597 键入路径包裹兜底（filter 放行原始替换后的微任务时点）：镜像
 *  attemptCompositionWrap 的结构与防御。形态校验：各段区间在原始替换后
 *  文档中仍恰为键入字符占据、选区仍为各段的追加式光标——链（M1 微
 *  任务先执行）已改写区间或移动选区即让位（组件产出为终态，零重复
 *  内容）；通过则按段重建：每段独立套用同一拆段计划，变更组批量同时
 *  坐标（全部相对原始替换后文档，offset 不加 delta）、delta 只平移批后
 *  选区（CM6 变更/选区坐标系分界——数学原型 #597 探针第 5 例，终态与
 *  选区覆盖文本和现行 filter 改写逐字一致）。纯空白段恢复原文不包裹
 *  （原文已被键入字符替换，换回即与现行改写的「不产生变更」对齐），
 *  且不设选区 range（现行改写的 selection 只含非空段，逐字对齐）。 */
function attemptTypedWrap(view: EditorView, pending: TypedWrapPending): void {
  if (view.compositionStarted || view.state.readOnly) {
    return
  }
  const state = view.state
  if (state.field(tableRegionField, false)) {
    return // 防御（键入事务已清空 region，正常不可达）
  }
  const entry = findSelectionWrapEntry(pending.ch)
  if (!entry || entry.open !== pending.open || entry.close !== pending.close) {
    return // 注册表与快照不一致（防御）
  }
  if (!shouldSelectionWrap(entry, { inCode: pending.inCode })) {
    return
  }
  // 段在原始替换后文档中的位置（前方段落净长差 = ch 长度 - 原文长度）
  let postShift = 0
  const segments = pending.segments.map((seg) => {
    const pos = seg.from + postShift
    postShift += pending.ch.length - (seg.to - seg.from)
    return { ...seg, pos }
  })
  // 形态校验：选区 range 数与段一致、全部为追加式光标（head === 段起点
  // + ch 长度）、各段区间恰被键入字符占据
  const selection = state.selection
  if (selection.ranges.length !== segments.length || state.doc.length !== pending.docLength) {
    return // 选区结构已变 / 文档被净改写（评审 001 同前缀改写）：让位
  }
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!
    const range = selection.ranges[i]!
    if (!range.empty || range.head !== seg.pos + pending.ch.length ||
        state.sliceDoc(seg.pos, seg.pos + pending.ch.length) !== pending.ch) {
      return // 区间/选区已被链改写：让位
    }
  }
  const changes: { from: number; to: number; insert: string }[] = []
  const ranges: ReturnType<typeof EditorSelection.range>[] = []
  let delta = 0
  for (const seg of segments) {
    const start = seg.pos + delta
    const plan = planSelectionWrap(seg.text, [{ from: 0, to: seg.text.length }], entry)
    if (!plan) {
      // 纯空白段：恢复原文（现行 filter 改写对该段不产生变更——原文
      // 未动；放行使其被替换为键入字符，此处换回）。选区不设 range——
      // 现行改写的 plan.selection 只含非空段（该段选区消失是旧形态既有
      // 行为，「终态与选区覆盖文本逐字一致」硬边界，是否保留另立票据）
      changes.push({ from: seg.pos, to: seg.pos + pending.ch.length, insert: seg.text })
      delta += seg.text.length - pending.ch.length
      continue
    }
    // 段内重建合成（attemptCompositionWrap 同款循环）
    let rebuilt = ''
    let at = 0
    for (const change of plan.changes) {
      rebuilt += seg.text.slice(at, change.from) + change.insert
      at = change.from
    }
    rebuilt += seg.text.slice(at)
    changes.push({ from: seg.pos, to: seg.pos + pending.ch.length, insert: rebuilt })
    ranges.push(...plan.selection.map((range) =>
      EditorSelection.range(start + range.anchor, start + range.head)))
    delta += rebuilt.length - pending.ch.length
  }
  // 编程式派发不经 DOM 回流；多字符替换形态不命中 filter 的单字符门控。
  // builtinEditOrigin（#595/#597）：行为链不消费本事务（键入路径已由
  // 放行的原始事务以干净形态驱动过一次）；userEvent 保留 input.* 维持
  // 撤销惯例与「一次包裹=一笔 edit.request」出站合并不变（symbolRawInput
  // 强制暂缓下与原始替换并入同段）
  view.dispatch({
    changes,
    selection: EditorSelection.create(ranges, 0),
    userEvent: 'input.type',
    annotations: builtinEditOrigin.of(true),
    scrollIntoView: true,
  })
}

/** #597 兜底入队点：键入路径包裹兜底的 updateListener（不得从 filter
 *  入队——filter 先于 updateListener 执行，attempt 会抢在链驱动前落地
 *  打破坐标不变量，反证见 #597 验证报告第二节）。装配序与
 *  symbolAutocomplete 的 typedAutocloseScheduler 同款：updateListener 按
 *  扩展数组正序执行（#597 实施实证，原「靠后者先执行」假设不成立），
 *  故由 liveInstance 装配在主簿记 listener（链驱动入队点）之后——M1
 *  链驱动微任务先入队、M3 兜底后入队（ADR-0020 裁决一）。常驻装配：
 *  filter 关闭时无 pending effect 在途，零成本。两组 filter 互斥（选区
 *  有无），同一时刻至多一组有快照在途（symbolTypedPath 测试钉住） */
export const typedWrapScheduler = EditorView.updateListener.of((update) => {
  for (const tr of update.transactions) {
    const effect = tr.effects.find((e) => e.is(pendingTypedWrap))
    if (effect) {
      const pending = effect.value
      queueMicrotask(() => attemptTypedWrap(update.view, pending))
    }
  }
})

/**
 * 装配入口（syncController 经 Compartment 按设置热重配；顺序约束见
 * 文件头——置于 symbolAutocomplete 之后）。#237 起 allowMultipleSelections
 * 不再随本组装配——多选区存续由多光标扩展组（multicursor.ts，独立设置
 * 默认开）承载，符号包裹开关不影响多选区可用性；多光标关闭时跨段包裹
 * 的文本改写仍生效，仅产物选区被 asSingle 折回主 range（降级边界）。
 */
export const symbolSelectionWrap = [
  selectionWrapFilter,
  wrapCompositionCapture,
  wrapCompositionTracker,
]
