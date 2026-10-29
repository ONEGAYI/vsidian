// Callout 按实例折叠状态机（#655/T04，规格 docs/specs/callout.md §5；
// ADR-0023「视图态按实例」的直接落地）：StateField 承载手动翻转记录 +
// effect 驱动 + 消费点增量树直查的区间派生 + 跨行隐藏装饰 + 标题行箭头
// widget + 光标迁移 + 落点展开 + 外部同步钳制。
//
// 折叠语义（规格 §5 全表）：
// - 源码形态：无符号=展开不可折叠无箭头（切换 no-op）；`+`=默认展开；
//   `-`=默认收起。仅标题（无正文行）不产生折叠占位。
// - 手动开合是**视图态**（overrides）：零源文写入、零 dirty、零宿主撤销
//   项。同实例 Live/阅读共享（状态源随 Live StateField，阅读侧纯消费，
//   对齐 #419 heading fold 的消费链形态）；主正文与每个引用位置独立
//   （StateField 随 EditorState）；重开实例按源码默认值。
// - 状态机矩阵：外层收起不抹内层（键独立）；`+/-` 声明被用户改写时该项
//   采新默认（override 的 declFold 失配即失效）；切类型/编辑正文不重置
//   （行级校验仍命中且符号不变）；标记删除丢弃失效状态（行级校验脱靶
//   即清除）；恢复被删 callout 按源码默认初始化（override 已在删除事务
//   中清除，不复活）。
// - 不复制 heading-fold 的区间定义（docs/specs/heading-fold.md 落档约定
//   的镜像纪律：两者各管自己的区间，定位链依次消费两者展开能力）；
//   不以 DOM class 当折叠状态源——is-collapsed/is-collapsible 类是
//   T01 固定口径的呈现消费面，全部由本 field 派生发射。
//
// effect 驱动纪律（对齐 headingFold）：折叠/展开一律 StateEffect + dispatch，
// 无 DOM-only 路径；查询一律 (field, doc) 纯函数派生。
import { EditorSelection, RangeSet, StateEffect, StateField, type Extension, type Text } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import type { SyntaxNode, Tree } from '@lezer/common'
import {
  CALLOUT_CONTAINER_NAMES,
  calloutHasBody,
  calloutOfBlockquote,
  liveDecorationsField,
  selectionEndpointsTouchRange,
} from './liveDecorations'
import { parseCalloutDecl } from '../shared/calloutSyntax'
import { t } from '../shared/i18n'
import { TOOLTIP_KEYS_SEPARATOR } from './tooltipCard'
import { formatBindingLabel } from '../shared/keybindings'
import type { CalloutFoldPaintProbe } from '../shared/protocol'
import { docInput, markdownTreeParser } from '../shared/markdownDoc'

/** 能包含 Blockquote 的容器块节点名（块级剪枝遍历白名单，headingFold 同族） */


/**
 * 可折叠 callout 区间（派生产物）：declFold 有符号且存在正文行的 callout。
 * 隐藏区间 = (titleLineTo, contentTo]——标题行行尾到容器末行行尾（含中间
 * 空行与 lazy 行；标题行本身保持可见）。
 */
export interface CalloutFoldSpan {
  /** 折叠键：标题行行首（行内编辑不脱靶；随事务 ChangeSet 映射） */
  readonly key: number
  /** 标记首字符位置（markerFrom，paint 探针与命中调试用） */
  readonly markerFrom: number
  /** 标题行行尾：隐藏区间起点 = 光标迁移落点 */
  readonly titleLineTo: number
  /** 容器末行行尾：隐藏区间终点 */
  readonly contentTo: number
  /** 源码折叠符号 */
  readonly declFold: '+' | '-'
}

/** 手动翻转记录：folded = 用户翻转后的当前态；declFold = 翻转时的源声明
 *  符号（声明被改写时失配 → 派生落回新默认，规格「改声明采新默认」） */
export interface CalloutFoldOverride {
  readonly folded: boolean
  readonly declFold: '+' | '-'
}

/** 行级字符串校验：key 所在行是否仍是携带折叠符号的 callout 标题行，
 *  返回当前声明符号（用于失配检测）；否则 null。update 的轻量失效通道
 *  ——只对 override 键逐行检查（数量 ≤ 收起数），不做全文档扫描；识别
 *  单一事实源 parseCalloutDecl 的行级形态（剥引用前缀后的段起点近似）。 */
function foldDeclOfLine(doc: Text, key: number): '+' | '-' | null {
  if (key < 0 || key > doc.length) {
    return null
  }
  const line = doc.lineAt(key)
  if (line.from !== key) {
    return null
  }
  const m = /^(?:\s*>\s?)+/.exec(line.text)
  if (!m) {
    return null
  }
  const decl = parseCalloutDecl(line.text.slice(m[0].length))
  return decl?.fold ?? null
}

/**
 * 全部可折叠 callout 区间（识别单一事实源 calloutOfBlockquote——Live 装饰
 * 同源；块级剪枝遍历消费增量树直查，headingFold collectHeadings 双入口
 * 形态：tree 传入时复用，省略时全量解析）。无符号与标题-only 不产出。
 */
export function collectCalloutFolds(doc: Text, tree?: Tree): CalloutFoldSpan[] {
  const parsed: Tree = tree ?? markdownTreeParser.parse(docInput(doc))
  const out: CalloutFoldSpan[] = []
  const descend = (node: SyntaxNode): void => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.name === 'Blockquote') {
        const info = calloutOfBlockquote(doc, child)
        if (info && info.decl.fold && info.lastLineNo > info.titleLineNo &&
            calloutHasBody(doc, info.titleLineNo, info.lastLineNo)) {
          const titleLine = doc.line(info.titleLineNo)
          out.push({
            key: titleLine.from,
            markerFrom: info.markerFrom,
            titleLineTo: titleLine.to,
            contentTo: doc.line(info.lastLineNo).to,
            declFold: info.decl.fold,
          })
        }
      }
      if (CALLOUT_CONTAINER_NAMES.has(child.name)) {
        descend(child)
      }
    }
  }
  descend(parsed.topNode)
  out.sort((a, b) => a.key - b.key)
  return out
}

/** 有效折叠视图（箭头/阅读消费面）：每 span 的当前态 = 匹配的手动覆盖
 *  ?? 源码默认（`-` 收起、`+` 展开）。覆盖失配（声明被改写）自然落新默认。 */
export function calloutFoldView(
  overrides: ReadonlyMap<number, CalloutFoldOverride>,
  spans: readonly CalloutFoldSpan[],
): Array<{ span: CalloutFoldSpan; folded: boolean }> {
  return spans.map((span) => {
    const override = overrides.get(span.key)
    const folded = override && override.declFold === span.declFold
      ? override.folded
      : span.declFold === '-'
    return { span, folded }
  })
}

/** 折叠中的区间集（隐藏装饰/迁移/钳制的判定面） */
export function effectiveCalloutFolds(
  overrides: ReadonlyMap<number, CalloutFoldOverride>,
  spans: readonly CalloutFoldSpan[],
): CalloutFoldSpan[] {
  return calloutFoldView(overrides, spans).filter((v) => v.folded).map((v) => v.span)
}

// ---- StateField：手动翻转记录 ----

/** 折叠集整体设置 effect（全部操作的唯一生效通道，headingFoldSet 同款单通道纪律） */
export const calloutFoldSet = StateEffect.define<ReadonlyMap<number, CalloutFoldOverride>>()

const EMPTY_FOLDS: ReadonlyMap<number, CalloutFoldOverride> = new Map()

/**
 * 折叠状态（#655/T04）：键 → 手动翻转记录。视图态（零写回、不 dirty、
 * 不进撤销栈、不跨会话持久化）。update 纪律（headingFold「只映射不修剪」
 * 的 callout 增强版）：
 * - docChanged：键随 ChangeSet 映射（mapPos(pos, 1)）后做**行级失效清理**
 *   ——键所在行不再是同符号 callout 标题行（标记被删 / 声明被改写）即
 *   删除该记录。「删标记→撤销恢复按源码默认」与「改 +/- 采新默认」两条
 *   规格语义由此落地；成本仅 O(override 数) 次行级字符串检查。
 * - 全文替换（init / doc.resync）显式清空——重开等价语义。
 */
export const calloutFoldField = StateField.define<ReadonlyMap<number, CalloutFoldOverride>>({
  create: () => EMPTY_FOLDS,
  update(value, tr) {
    if (tr.docChanged) {
      const oldLength = tr.startState.doc.length
      let fullReplace = false
      tr.changes.iterChangedRanges((fromA, toA) => {
        if (fromA === 0 && toA === oldLength) {
          fullReplace = true
        }
      })
      if (fullReplace) {
        return EMPTY_FOLDS
      }
    }
    let next = value
    let changed = false
    for (const eff of tr.effects) {
      if (eff.is(calloutFoldSet)) {
        next = eff.value
        changed = true
      }
    }
    if (!tr.docChanged) {
      return changed ? next : value
    }
    if (next.size === 0) {
      return EMPTY_FOLDS
    }
    const mapped = new Map<number, CalloutFoldOverride>()
    for (const [key, override] of next) {
      const mappedKey = tr.changes.mapPos(key, 1)
      const declNow = foldDeclOfLine(tr.state.doc, mappedKey)
      // 行级失效：不再是 callout 标题行（标记删除）或声明符号已改写 → 丢弃
      if (declNow === null || declNow !== override.declFold) {
        continue
      }
      mapped.set(mappedKey, override)
    }
    return mapped
  },
})

// ---- 光标迁移（收起瞬间） ----

/**
 * 落点复核（规格 §5「不能留在不可见区域」，评审修复 P3）：嵌套双收起时
 * 最深收起区间的标题行行尾本身可能落在外层隐藏区 (titleLineTo, contentTo)
 * 内——落点须迭代上浮到包含它的收起区标题行行尾，直至不再落在任何收起
 * 隐藏区。每轮 dest 严格左移（titleLineTo 严格小于当前落点），有限轮
 * 收敛；guard 防御异常区间数据下的死循环。
 */
function visibleLandingPos(pos: number, folds: readonly CalloutFoldSpan[]): number {
  let dest = pos
  for (let guard = folds.length; guard >= 0; guard--) {
    let hit: CalloutFoldSpan | null = null
    for (const f of folds) {
      if (dest > f.titleLineTo && dest < f.contentTo) {
        hit = f
        break
      }
    }
    if (!hit) {
      break
    }
    dest = hit.titleLineTo
  }
  return dest
}

/**
 * 收起事务的选区迁移计算（migrateSelectionForFold 同构）：任一 range 与
 * 被隐藏区间 (titleLineTo, contentTo) 开区间相交时迁移到标题行行尾
 * （collapse 空选区）；嵌套取包含该 range 的最深区间，落点经
 * visibleLandingPos 复核（外层同时收起时上浮到可见标题行行尾）。
 * 返回 null 无需迁移。
 */
export function migrateSelectionForCalloutFold(
  selection: EditorSelection,
  folds: readonly CalloutFoldSpan[],
): EditorSelection | null {
  let ranges: ReturnType<typeof EditorSelection.cursor>[] | null = null
  for (let i = 0; i < selection.ranges.length; i++) {
    const r = selection.ranges[i]!
    let hit: CalloutFoldSpan | null = null
    for (const f of folds) {
      if (r.to > f.titleLineTo && r.from < f.contentTo) {
        if (!hit || f.contentTo - f.titleLineTo < hit.contentTo - hit.titleLineTo) {
          hit = f
        }
      }
    }
    if (hit) {
      ;(ranges ??= selection.ranges.slice())[i] = EditorSelection.cursor(visibleLandingPos(hit.titleLineTo, folds))
    }
  }
  return ranges ? EditorSelection.create(ranges, selection.mainIndex) : null
}

// ---- 折叠集应用与操作执行 ----

/** 可折叠集共享缓存（foldableSpansCached 同款）：同一 doc 版本（Text 对象
 *  身份——每笔编辑即新对象，天然失效）与同一增量树引用下，装饰重建、
 *  触及集比较（选区事务的箭头退场判定）、toggle 目标解析、落点展开与
 *  阅读同步（syncReadingCalloutFolds，评审修复 P4）共享一次派生——选区
 *  事务高频，缓存把每笔光标移动的全文档遍历压成每 doc 版本一次。 */
const calloutSpansCache = new WeakMap<Text, { tree: Tree | undefined; spans: CalloutFoldSpan[] }>()

/**
 * 缓存派生入口（headingFold foldableSpansCached 同构，评审修复 P4）：
 * 阅读同步链与 Live 侧共用同一 WeakMap 缓存——此前 syncReadingCalloutFolds
 * 直调 collectCalloutFolds 绕过缓存，每次折叠侦测闭环全量重解析。缓存键
 * = Text 实例身份 + 增量树引用，主文 Live state 与阅读同步读的是同一
 * view.state（同 doc 同树），天然命中。
 */
export function calloutFoldSpansCached(doc: Text, tree: Tree | undefined): CalloutFoldSpan[] {
  const hit = calloutSpansCache.get(doc)
  if (hit && hit.tree === tree) {
    return hit.spans
  }
  const spans = collectCalloutFolds(doc, tree)
  calloutSpansCache.set(doc, { tree, spans })
  return spans
}

/** 状态集派生辅助：(state) → 全部可折叠区间（增量树复用 + 共享缓存） */
function spansOfState(state: import('@codemirror/state').EditorState): CalloutFoldSpan[] {
  const tree = state.field(liveDecorationsField, false)?.tree
  return calloutFoldSpansCached(state.doc, tree)
}

/**
 * 折叠集应用入口（effect 直驱 + 光标迁移；箭头/键位/落点展开共用）：
 * 新集生效后的有效折叠区间若与选区相交，同笔事务内迁移到标题行行尾。
 * 零写回（事务无 changes）。
 */
export function setCalloutFolds(view: EditorView, next: ReadonlyMap<number, CalloutFoldOverride>): void {
  const spec: import('@codemirror/state').TransactionSpec = {
    effects: calloutFoldSet.of(next),
  }
  if (next.size > 0) {
    const folds = effectiveCalloutFolds(next, spansOfState(view.state))
    const migrated = migrateSelectionForCalloutFold(view.state.selection, folds)
    if (migrated) {
      spec.selection = migrated
    }
  }
  view.dispatch(spec)
}

/** 箭头点击的统一翻转入口：当前态取反（override 重写为新翻转 + 当前声明符号） */
export function toggleCalloutFoldAt(view: EditorView, key: number): void {
  const spans = spansOfState(view.state)
  const current = calloutFoldView(view.state.field(calloutFoldField, false) ?? EMPTY_FOLDS, spans)
    .find((v) => v.span.key === key)
  if (!current) {
    return
  }
  const next = new Map(view.state.field(calloutFoldField, false) ?? EMPTY_FOLDS)
  next.set(key, { folded: !current.folded, declFold: current.span.declFold })
  setCalloutFolds(view, next)
}

/**
 * 「切换当前 callout 折叠」的落点执行体（键位/命令面板共用）：pos 所在
 * **最内层**可折叠 callout 两态取反（规格 §5——焦点实例的最内层目标）。
 * 最内层 = 包含 pos 的区间中最小者（嵌套时内层区间严格更小）。无目标
 * （普通文本 / 无符号 / 标题-only）返回 false 静默 no-op。
 */
export function applyCalloutToggleAt(view: EditorView, pos: number): boolean {
  const spans = spansOfState(view.state)
  let target: CalloutFoldSpan | null = null
  for (const span of spans) {
    if (pos >= span.key && pos <= span.contentTo) {
      if (!target || span.contentTo - span.key < target.contentTo - target.key) {
        target = span
      }
    }
  }
  if (!target) {
    return false
  }
  toggleCalloutFoldAt(view, target.key)
  return true
}

// ---- 落点展开（reveal 族，规格 §5「定位展开」） ----

/**
 * 落点展开键集派生（纯函数）：落点 [from, to] 任一端在折叠隐藏区
 * (titleLineTo, contentTo) 内的全部 callout 置为展开（含嵌套祖先全展开）；
 * 默认收起（`-` 无覆盖）的项写入手动展开覆盖。无需变更返回 null。
 */
export function unfoldCalloutAroundKeys(
  overrides: ReadonlyMap<number, CalloutFoldOverride>,
  spans: readonly CalloutFoldSpan[],
  from: number,
  to?: number,
): ReadonlyMap<number, CalloutFoldOverride> | null {
  const effective = effectiveCalloutFolds(overrides, spans)
  if (effective.length === 0) {
    return null
  }
  const toPos = to ?? from
  let hit = false
  const next = new Map(overrides)
  for (const f of effective) {
    const inside =
      (from > f.titleLineTo && from < f.contentTo) || (toPos > f.titleLineTo && toPos < f.contentTo)
    if (inside) {
      next.set(f.key, { folded: false, declFold: f.declFold })
      hit = true
    }
  }
  return hit ? next : null
}

/** 落点展开（视图驱动）：展开包含落点的全部折叠 callout（嵌套全展开），
 *  effect 直驱。返回是否发生展开；定位事务由接线点随后派发。 */
export function unfoldCalloutAround(view: EditorView, from: number, to?: number): boolean {
  const overrides = view.state.field(calloutFoldField, false)
  if (!overrides || overrides.size === 0) {
    // 默认收起（`-`）项可能零覆盖：仍需检查（不能只看 override 数）
    const spans = spansOfState(view.state)
    if (!spans.some((s) => s.declFold === '-')) {
      return false
    }
  }
  const next = unfoldCalloutAroundKeys(
    view.state.field(calloutFoldField, false) ?? EMPTY_FOLDS,
    spansOfState(view.state),
    from,
    to,
  )
  if (!next) {
    return false
  }
  view.dispatch({ effects: calloutFoldSet.of(next) })
  return true
}

/**
 * 外部同步光标钳制（clampSelectionOutOfFolds 同构）：pos 落入收起隐藏区
 * → 钳到该 callout 标题行行尾；嵌套取最深区间，落点经 visibleLandingPos
 * 复核（评审修复 P3：外层同时收起时上浮到可见标题行行尾）。可见区返回
 * null。
 */
export function clampSelectionOutOfCalloutFolds(view: EditorView): EditorSelection | null {
  const overrides = view.state.field(calloutFoldField, false)
  const spans = spansOfState(view.state)
  const folds = effectiveCalloutFolds(overrides ?? EMPTY_FOLDS, spans)
  if (folds.length === 0) {
    return null
  }
  const sel = view.state.selection
  let ranges: ReturnType<typeof EditorSelection.cursor>[] | null = null
  for (let i = 0; i < sel.ranges.length; i++) {
    const r = sel.ranges[i]!
    let hit: CalloutFoldSpan | null = null
    for (const f of folds) {
      if (r.head > f.titleLineTo && r.head < f.contentTo) {
        if (!hit || f.contentTo - f.titleLineTo < hit.contentTo - hit.titleLineTo) {
          hit = f
        }
      }
    }
    if (hit) {
      if (!ranges) {
        ranges = sel.ranges.slice()
      }
      ranges[i] = EditorSelection.cursor(visibleLandingPos(hit.titleLineTo, folds))
    }
  }
  return ranges ? EditorSelection.create(ranges, sel.mainIndex) : null
}

// ---- 隐藏装饰与标题行箭头（Live 侧呈现） ----

/** 键位徽章数据源（syncController 经宿主 keybindings 快照注入；缺省空 = 无徽章） */
let calloutFoldBindingHints: () => readonly string[] = () => []

/** 注入「切换当前 callout 折叠」的生效绑定（data-tooltip-keys 徽章数据源） */
export function setCalloutFoldBindingHints(resolve: () => readonly string[]): void {
  calloutFoldBindingHints = resolve
}

/**
 * 折叠箭头按钮 DOM 工厂（Live 标题行 widget 与 #阅读态标题装饰共用）：
 * `.callout-fold`（T01 固定口径，data-callout-fold 携带源声明符号；折叠
 * 态挂 is-collapsed——callout 根侧的行级 is-collapsed 行类由装饰另发）。
 * 可访问形态对齐 headingFold 控件工厂先例（aria-label + aria-expanded +
 * data-tooltip + data-tooltip-keys 结构化键位徽章）；防夺焦 mousedown
 * （#190/#414 同口径）。click 回调由调用方给定（Live widget 与阅读箭头
 * 各自接线同一翻转链路）。
 */
export function createCalloutFoldArrow(spec: {
  folded: boolean
  declFold: '+' | '-'
  onToggle: () => void
}): HTMLElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = spec.folded ? 'callout-fold is-collapsed' : 'callout-fold'
  btn.dataset['calloutFold'] = spec.declFold
  const word = spec.folded ? 'calloutfold.unfold' : 'calloutfold.fold'
  btn.setAttribute('aria-label', t(word))
  btn.setAttribute('aria-expanded', spec.folded ? 'false' : 'true')
  btn.setAttribute('data-tooltip', t(word))
  const bindings = calloutFoldBindingHints()
  if (bindings.length > 0) {
    btn.setAttribute('data-tooltip-keys', bindings.map(formatBindingLabel).join(TOOLTIP_KEYS_SEPARATOR))
  }
  btn.innerHTML =
    '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" ' +
    'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M4 6l4 4 4-4"></path></svg>'
  // 防夺焦（#190/#414 同口径）：mousedown 阻止 CM6 落选区与点击夺焦
  btn.addEventListener('mousedown', (event) => {
    event.preventDefault()
    event.stopPropagation()
  })
  btn.addEventListener('click', (event) => {
    event.stopPropagation()
    spec.onToggle()
  })
  return btn
}

/**
 * 折叠箭头 widget（`.callout-fold`，T01 固定口径）：标题行行尾零宽呈现，
 * 单独负责开合（标题文字维持编辑/链接语义——箭头是独立控件，不吞标题
 * 点击）。折叠态挂 is-collapsed（T01 口径：callout 根与 fold 元素双挂
 * ——根侧即标题行级 is-collapsed 行类，由装饰同 field 发射）。ignoreEvent
 * 吞事件：widget 内交互自处理。eq 按 (key, folded, declFold) 判等。
 */
export class CalloutFoldArrowWidget extends WidgetType {
  constructor(
    readonly key: number,
    readonly folded: boolean,
    readonly declFold: '+' | '-',
  ) {
    super()
  }

  override eq(other: CalloutFoldArrowWidget): boolean {
    return other instanceof CalloutFoldArrowWidget &&
      other.key === this.key && other.folded === this.folded && other.declFold === this.declFold
  }

  override toDOM(view: EditorView): HTMLElement {
    return createCalloutFoldArrow({
      folded: this.folded,
      declFold: this.declFold,
      onToggle: () => toggleCalloutFoldAt(view, this.key),
    })
  }

  /** 吞事件（liveEmbed 宿主同先例）：widget 内交互自处理，CM6 不当正文点击 */
  override ignoreEvent(): boolean {
    return true
  }
}

/** 标题行 is-collapsed 行级类（T01 口径的「callout 根」侧挂点）——
 *  Live 行级形态下根 = 标题行；收起态补下圆角（容器末行已被隐藏） */
const collapsedLineDeco = Decoration.line({ class: 'is-collapsed' })

/**
 * 折叠装饰构建（纯 (state) 派生）：折叠中区间发射跨行 Decoration.replace
 * （标题行保持可见）+ 标题行 is-collapsed 行级类；全部可折叠 callout 的
 * 标题行行尾发射箭头 widget（无符号不产箭头；光标/选区端点触及标题行时
 * 退场——源码显形供编辑 +/- 符号，与标记 widget 同款端点语义）。
 */
function buildCalloutFoldDecos(state: import('@codemirror/state').EditorState): DecorationSet {
  const overrides = state.field(calloutFoldField, false) ?? EMPTY_FOLDS
  const spans = spansOfState(state)
  if (spans.length === 0) {
    return RangeSet.empty
  }
  const view = calloutFoldView(overrides, spans)
  const out: Array<ReturnType<Decoration['range']>> = []
  for (const { span, folded } of view) {
    const titleLine = state.doc.lineAt(span.key)
    if (folded) {
      out.push(Decoration.replace({}).range(span.titleLineTo, span.contentTo))
      out.push(collapsedLineDeco.range(titleLine.from))
    }
    // 箭头：触及标题行（端点语义）时退场——源码态不叠加呈现控件
    if (!selectionEndpointsTouchRange(state.selection, titleLine.from, titleLine.to)) {
      out.push(
        Decoration.widget({
          widget: new CalloutFoldArrowWidget(span.key, folded, span.declFold),
          side: 1,
        }).range(titleLine.to),
      )
    }
  }
  return RangeSet.of(out, true)
}

/**
 * 折叠装饰（StateField；跨行块 replace 必须经 StateField 的 CM6 硬约束，
 * headingFoldDecorations 同款）。重建触发 = docChanged / 折叠集变化 /
 * 增量树变化 / **选区端点触及的标题行变化**（箭头退场谓词依赖选区——
 * 触及集未变的纯选区移动零重建）。
 */
export const calloutFoldDecorations = StateField.define<DecorationSet>({
  create: buildCalloutFoldDecos,
  update(value, tr) {
    const foldChanged =
      tr.startState.field(calloutFoldField, false) !== tr.state.field(calloutFoldField, false)
    const treeChanged =
      tr.startState.field(liveDecorationsField, false)?.tree !==
      tr.state.field(liveDecorationsField, false)?.tree
    const touchedChanged =
      tr.selection !== undefined && !touchedTitlesEqual(tr.startState, tr.state)
    if (!tr.docChanged && !foldChanged && !treeChanged && !touchedChanged) {
      return value
    }
    return buildCalloutFoldDecos(tr.state)
  },
  provide: (f) => EditorView.decorations.from(f),
})

/** 选区端点触及的 callout 标题行键集（箭头退场谓词的廉价比较面） */
function touchedTitleKeys(state: import('@codemirror/state').EditorState): ReadonlySet<number> {
  const spans = spansOfState(state)
  const out = new Set<number>()
  for (const span of spans) {
    const line = state.doc.lineAt(span.key)
    if (selectionEndpointsTouchRange(state.selection, line.from, line.to)) {
      out.add(span.key)
    }
  }
  return out
}

function touchedTitlesEqual(
  a: import('@codemirror/state').EditorState,
  b: import('@codemirror/state').EditorState,
): boolean {
  const ka = touchedTitleKeys(a)
  const kb = touchedTitleKeys(b)
  if (ka.size !== kb.size) {
    return false
  }
  for (const k of ka) {
    if (!kb.has(k)) {
      return false
    }
  }
  return true
}

/** Callout 折叠扩展总装配（liveInstance 扩展组消费；全部 Live 实例含嵌入共享） */
export const calloutFoldExtension: Extension = [
  calloutFoldField,
  calloutFoldDecorations,
]

// ---- 阅读块折叠装饰（共享实现，T08 起引用实例与主文阅读同源） ----

/**
 * 块内 callout 折叠装饰（阅读块挂载/重装饰共用）：strip 注入的箭头与
 * 状态类后，块内 div.callout 按源锚点（data-vsidian-src-start = 标题行
 * 行首 = span.key，渲染期 readingMarkdown 变换挂点）精确匹配折叠视图——
 * 挂 is-collapsible/is-collapsed 状态类（T01 固定口径）、向 .callout-title
 * 尾部注入箭头（click 回调走 onToggle 翻转状态源）。range 限定 span 命中
 * 域（块区间过滤——主文虚拟化按块装饰）；缺省全部（无布局全量容器一次
 * 装饰，T08 引用实例回退路径）。按序 zip 会把不可折叠 callout（无符号/
 * 标题-only）错配进可折叠序列；锚点缺失（防御）不装饰不崩溃。
 *
 * #659（T08）：从 VirtualReadingView 私有方法提取为共享实现——主文阅读
 * 视图与引用实例（RefContentMount 的两路径）不建第二份装饰规则。
 */
export function decorateCalloutFoldControlsIn(
  el: HTMLElement | ParentNode,
  folds: ReadonlyArray<{ span: CalloutFoldSpan; folded: boolean }>,
  onToggle: (key: number) => void,
  range?: { start: number; end: number },
): void {
  for (const arrow of el.querySelectorAll('.callout-fold')) {
    arrow.remove()
  }
  for (const dom of el.querySelectorAll('div.callout')) {
    dom.classList.remove('is-collapsible', 'is-collapsed')
  }
  if (folds.length === 0) {
    return
  }
  const inRange = range === undefined
    ? folds
    : folds.filter((v) => v.span.markerFrom >= range.start && v.span.markerFrom <= range.end)
  if (inRange.length === 0) {
    return
  }
  const doms = el.querySelectorAll<HTMLElement>('div.callout[data-vsidian-src-start]')
  const domByKey = new Map<string, HTMLElement>()
  for (const dom of doms) {
    domByKey.set(dom.getAttribute('data-vsidian-src-start') ?? '', dom)
  }
  for (const v of inRange) {
    const dom = domByKey.get(String(v.span.key))
    if (!dom) {
      continue
    }
    dom.classList.add('is-collapsible')
    const title = dom.querySelector<HTMLElement>('.callout-title')
    if (!title) {
      continue
    }
    if (v.folded) {
      dom.classList.add('is-collapsed')
    }
    title.appendChild(createCalloutFoldArrow({
      folded: v.folded,
      declFold: v.span.declFold,
      onToggle: () => onToggle(v.span.key),
    }))
  }
}

/**
 * 折叠 overrides 的失效清理（T08 引用实例重载面）：只保留仍命中当前
 * spans（键在场且声明符号未变）的记录——Reading 侧没有 Live StateField
 * 的 ChangeSet 映射链，重载（目标外部修改广播）按新文本重派生时，旧
 * 坐标键自然脱靶丢弃（「标记删除/全文重新初始化丢弃失效状态」的 Reading
 * 侧保守近似——Live 侧另有 mapPos 坐标迁移，本面无 ChangeSet 映射链，
 * 目标前部删行时旧键可能错配到同符号 callout（低概率、纯视图态）；
 * 纯函数与 calloutFoldView 同源判定）。
 */
export function pruneCalloutOverrides(
  overrides: ReadonlyMap<number, CalloutFoldOverride>,
  spans: readonly CalloutFoldSpan[],
): ReadonlyMap<number, CalloutFoldOverride> {
  if (overrides.size === 0) {
    return overrides
  }
  const out = new Map<number, CalloutFoldOverride>()
  for (const [key, override] of overrides) {
    const span = spans.find((s) => s.key === key)
    if (span && span.declFold === override.declFold) {
      out.set(key, override)
    }
  }
  return out
}

// ---- paint 探针折叠观测 ----

/** 元素中心点命中（hitPainted 同口径；jsdom 无布局恒 false） */
function hitPaintedEl(el: HTMLElement): boolean {
  try {
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      return false
    }
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return !!hit && (hit === el || el.contains(hit))
  } catch {
    return false
  }
}

/**
 * Callout 折叠 UI 绘制观测（view.state.paint 探针族的 calloutFold 字段
 * 采集体，协议 PaintProbe.calloutFold）：可折叠箭头计数、收起数、首收起
 * callout 的箭头绘制态/标题可见、隐藏正文行是否仍被绘制。结构性字段
 * jsdom 可断言；visible 类字段只作真宿主/浏览器断言依据。
 */
export function collectCalloutFoldPaint(view: EditorView): CalloutFoldPaintProbe {
  const state = view.state
  const overrides = state.field(calloutFoldField, false) ?? EMPTY_FOLDS
  const spans = spansOfState(state)
  const foldsView = calloutFoldView(overrides, spans)
  const foldedSpans = foldsView.filter((v) => v.folded).map((v) => v.span)

  const firstFoldedArrow = view.dom.querySelector<HTMLElement>('.callout-fold.is-collapsed')
  let titleVisible: boolean | null = null
  let hiddenBodyPainted: boolean | null = null
  if (foldedSpans.length > 0) {
    const f = foldedSpans[0]!
    // 标题行文字可见（标题行本身不进隐藏区；取标题行行内文本命中的
    // elementFromPoint——真宿主断言面）
    const titleLine = state.doc.lineAt(f.key)
    const titleText = titleLine.text.replace(/^(?:\s*>\s?)+/, '').replace(/^\[![^\]]*\][+-]?\s*/, '')
    try {
      const coords = view.coordsAtPos(Math.min(f.markerFrom, titleLine.to))
      if (coords) {
        const hit = document.elementFromPoint((coords.left + coords.right) / 2, (coords.top + coords.bottom) / 2)
        titleVisible = !!hit && (hit.textContent ?? '').includes(titleText.trim().slice(0, 2))
      } else {
        titleVisible = false
      }
    } catch {
      titleVisible = false
    }
    // 隐藏区首个非空行文本是否仍被绘制
    let pos = f.titleLineTo + 1
    while (pos < f.contentTo) {
      const line = state.doc.lineAt(pos)
      if (line.text.replace(/^(?:\s*>\s?)+/, '').trim() !== '') {
        try {
          const coords = view.coordsAtPos(Math.min(line.from + 1, line.to))
          if (coords) {
            const hit = document.elementFromPoint((coords.left + coords.right) / 2, (coords.top + coords.bottom) / 2)
            hiddenBodyPainted = !!hit && (hit.textContent ?? '').includes(line.text.replace(/^(?:\s*>\s?)+/, '').trim().slice(0, 2))
          } else {
            hiddenBodyPainted = false
          }
        } catch {
          hiddenBodyPainted = false
        }
        break
      }
      pos = line.to + 1
    }
    if (hiddenBodyPainted === null) {
      hiddenBodyPainted = false
    }
  }

  return {
    foldableCount: spans.length,
    foldCount: foldedSpans.length,
    arrowCount: view.contentDOM.querySelectorAll('.callout-fold').length,
    firstArrowVisible: !!firstFoldedArrow && hitPaintedEl(firstFoldedArrow),
    firstArrowCollapsedClass: firstFoldedArrow?.classList.contains('is-collapsed') ?? false,
    titleVisible,
    hiddenBodyPainted,
  }
}
