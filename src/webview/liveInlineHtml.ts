// Live 行内原生 HTML 装饰（#568/T03，规格「Live 的状态与选区」表）：
// - 片段表：Lezer HTMLTag 节点派生（shared/htmlInline 单一事实源——同行
//   分组栈式配对、最外层、单行成型；与 Reading 侧 markdown-it 规则
//   对拍钉住），增量重建（种子 = 变更区间 ∪ 相交旧片段，rebuildHtmlSpans
//   同款纪律）。
// - 片段替换装饰：未触及 = **精确区间 [from, to] inline replace widget**
//   （行内宿主 span，display:inline——前后正文同行流不断行，不隐藏前后
//   正文）；触及（selectionTouchesRange 语义：折叠光标含两端、非空选区
//   严格相交、任一 range 命中）= 撤下 widget 源码显形；查找/锚点命中
//   （hitIntersectsRange）同列触发。兄弟片段独立显隐；嵌套片段只有最
//   外层装饰（确定性区间——点击/显形粒度均为最外层完整源码）。
// - 普通点击进入源码：widget ignoreEvent=false + mousedown 拦截器
//   （makeHtmlWidgetMousedown——与块级 T02 同一执行体工厂）把无修饰左键
//   点击转成「选中该片段完整源码」；修饰键放行默认链（正反向跨片段
//   选择不扩选）。
// - IME：与块级 T02 同一推断——组合发生在 CM6 文本层，组合期光标在已
//   显形源码内（触及恒成立不重挂 widget）或片段外（widget 与组合节点
//   不同 DOM 区域），无需额外冻结。
// - 显隐切换零写回零独立撤销项（纯装饰派生）。docScope 消费 T02 已挂
//   的 liveHtmlDocScope 通道（读取面 liveHtmlDocScopeOf——不新建装载面）。
import { RangeSet, StateField, type Extension, type Range, type Text, type Transaction } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { selectionTouchesRange } from './liveDecorations'
import { liveDecorationsField } from './liveDecorations'
import { hitIntersectsRange, hitRangesOf, hitRevealField, type HitRange } from './hitReveal'
import { inlineHtmlFragmentsOfTree, type HtmlInlineFragment } from '../shared/htmlInline'
import { htmlInlineRenderHtml } from './htmlSanitize'
import { makeHtmlWidgetMousedown, liveHtmlDocScopeOf, prepareHtmlWidgetContent, topLevelStructureStable } from './liveHtml'
import { disposeHtmlResourcesOf } from './htmlResourceMount'
import type { Tree } from '@lezer/common'

/** #568 Live 行内 HTML 宿主稳定类名（样式契约 live-inline-html-widget
 *  条目同源） */
export const LIVE_INLINE_HTML_CLASS_NAMES = {
  /** widget 根宿主（inline replace 的替换物，行内 span；携带源码区间
   *  dataset 供点击拦截器定位） */
  host: 'vsidian-live-inline-html',
  /** 净化内容容器（原生语义 DOM 的直接父级——docScope 标记面） */
  content: 'vsidian-live-inline-html-content',
} as const

/** 装饰实例缓存上限（键 = 源文 + 区间 + docScope；与块级同量级） */
export const liveInlineHtmlDecoCacheLimit = 128

/** 一个 Live 行内 HTML 片段（LF 全文 offset，end 不含；source 为源文全量） */
export interface LiveInlineHtmlSpan extends HtmlInlineFragment {
  source: string
}

/** 树窗口内行内片段扫描（表构建/增量重建共用） */
function scanInlineHtmlSpans(doc: Text, tree: Tree, from: number, to: number): LiveInlineHtmlSpan[] {
  return inlineHtmlFragmentsOfTree(tree, doc, from, to)
    .filter((f) => f.to > from && f.from < to)
    .map((f) => ({ from: f.from, to: f.to, source: doc.sliceString(f.from, f.to) }))
}

/** 全树扫描（文档装载/resync 的全量路径） */
function scanAllInlineHtmlSpans(doc: Text, tree: Tree | null): LiveInlineHtmlSpan[] {
  if (!tree) {
    return []
  }
  return inlineHtmlFragmentsOfTree(tree, doc)
    .map((f) => ({ from: f.from, to: f.to, source: doc.sliceString(f.from, f.to) }))
}

/**
 * 片段表增量重建（liveHtml.rebuildHtmlSpans 同款纪律）：种子 = 变更区间
 * ∪ 映射后与之相交的旧片段；窗口内树扫描（片段界定来自解析器 + 共享
 * 配对，不猜嵌套），窗口外映射保留；坍缩条目丢弃。树缺席时保守只做
 * 映射（降级方向 = 不渲染新片段，源码可见）。#576 评审 P2-5：prevTree
 * 在场且顶层结构签名不稳定时退全量重扫（围栏开闭使行内片段随所在块
 * 整体重分类为代码字面，窗口外旧片段与缺口都不在变更区间内）。
 */
export function rebuildInlineHtmlSpans(
  doc: Text,
  tr: Transaction,
  prev: readonly LiveInlineHtmlSpan[],
  tree: Tree | null,
  prevTree?: Tree | null,
): LiveInlineHtmlSpan[] {
  const changes = tr.changes
  let seedFrom = doc.length + 1
  let seedTo = -1
  changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    seedFrom = Math.min(seedFrom, fromB)
    seedTo = Math.max(seedTo, toB)
  })
  if (seedTo < 0) {
    return prev as LiveInlineHtmlSpan[]
  }
  const mapped = prev.map((s) => ({
    from: changes.mapPos(s.from, 1),
    to: changes.mapPos(s.to, -1),
    source: s.source,
  }))
  // #576 二轮复审 P2：行级失效——段内上下文变化（InlineCode 开闭吞标签、新外层标签吸收内层）不改变顶层结构签名，但使同一行的片段表失效。变更行整行并入窗口（重建后的片段可在行内任意位置）。剪枝：行内配对只依赖本行字符（单行成型边界）——变更行的新行文本不含 '<' 与 '`' 且旧表在该行无片段时，编辑前后片段集均为空，无需扩窗（纯文字键击零额外成本；块级上下文变化由顶层签名守卫覆盖）。
  const linesWithOldSpan = new Set<number>()
  for (const m of mapped) {
    if (m.to > m.from) {
      linesWithOldSpan.add(doc.lineAt(m.from).number)
    }
  }
  const changedLines = new Set<number>()
  changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    const lo = doc.lineAt(Math.max(0, Math.min(fromB, doc.length))).number
    const hi = doc.lineAt(Math.max(0, Math.min(toB, doc.length))).number
    for (let n = lo; n <= hi; n++) {
      changedLines.add(n)
    }
  })
  for (const n of changedLines) {
    const line = doc.line(n)
    if (linesWithOldSpan.has(n)) {
      seedFrom = Math.min(seedFrom, line.from)
      seedTo = Math.max(seedTo, line.to)
      continue
    }
    const text = doc.sliceString(line.from, line.to)
    if (text.includes('<') || text.includes('`')) {
      seedFrom = Math.min(seedFrom, line.from)
      seedTo = Math.max(seedTo, line.to)
    }
  }
  for (const m of mapped) {
    if (m.to + 1 >= seedFrom && m.from <= seedTo + 1) {
      seedFrom = Math.min(seedFrom, m.from)
      seedTo = Math.max(seedTo, m.to)
    }
  }
  if (tree === null) {
    return mapped.filter((m) => m.to > m.from)
  }
  if (prevTree != null && tree !== prevTree && !topLevelStructureStable(changes, prevTree, tree)) {
    // 块级重分类（围栏开闭的传播影响）：窗口策略不安全——全量重扫
    return scanAllInlineHtmlSpans(doc, tree)
  }
  const out: LiveInlineHtmlSpan[] = []
  for (const m of mapped) {
    if (m.to <= m.from) {
      continue
    }
    if (m.to < seedFrom || m.from > seedTo) {
      out.push(m)
    }
  }
  out.push(...scanInlineHtmlSpans(doc, tree, Math.max(0, seedFrom), Math.min(doc.length, seedTo)))
  out.sort((a, b) => a.from - b.from)
  // 表引用短路：重建结果与旧表逐项相等时返回旧引用——装饰 field 的
  // spansChanged 判定走引用比较，纯文内键击（片段表无变化）时跳过
  // RangeSet 重建与 view 装饰 diff（帧预算敏感路径的成本归零）
  if (out.length === prev.length) {
    let same = true
    for (let i = 0; i < out.length && same; i++) {
      same = out[i]!.from === prev[i]!.from && out[i]!.to === prev[i]!.to && out[i]!.source === prev[i]!.source
    }
    if (same) {
      return prev as LiveInlineHtmlSpan[]
    }
  }
  return out
}

/** 全文档行内片段表：docChanged 时增量重建；树变化（增量解析推进）同样
 *  重建；纯选区移动零成本。树取自 liveDecorationsField（装配序在其后） */
export const liveInlineHtmlSpansField = StateField.define<readonly LiveInlineHtmlSpan[]>({
  create(state) {
    return scanAllInlineHtmlSpans(state.doc, state.field(liveDecorationsField, false)?.tree ?? null)
  },
  update(value, tr) {
    const treeChanged =
      tr.startState.field(liveDecorationsField, false) !== tr.state.field(liveDecorationsField, false)
    if (!tr.docChanged && !treeChanged) {
      return value
    }
    if (!tr.docChanged && treeChanged) {
      return scanAllInlineHtmlSpans(tr.state.doc, tr.state.field(liveDecorationsField, false)?.tree ?? null)
    }
    return rebuildInlineHtmlSpans(tr.state.doc, tr, value,
      tr.state.field(liveDecorationsField, false)?.tree ?? null,
      tr.startState.field(liveDecorationsField, false)?.tree ?? null)
  },
})

/**
 * 装饰构建（纯数据输入，可单测直驱）：逐片段发射——未触及 → 精确区间
 * inline replace widget；触及（选区或命中显形）→ 不发射（源码可见）。
 * frontmatter 内不发射（头区不产正文装饰）。
 */
export function buildLiveInlineHtmlDecorationRanges(
  selection: import('@codemirror/state').EditorSelection,
  spans: readonly LiveInlineHtmlSpan[],
  fm: { end: number } | null,
  docScope: string | null,
  hits: readonly HitRange[] = [],
): Array<Range<Decoration>> {
  const out: Array<Range<Decoration>> = []
  for (const span of spans) {
    if (fm && span.from < fm.end) {
      continue
    }
    const touched = selectionTouchesRange(selection, span.from, span.to) ||
      hitIntersectsRange(hits, span.from, span.to)
    if (!touched) {
      out.push(liveInlineHtmlWidgetDeco(span.source, span.from, span.to, docScope)
        .range(span.from, span.to))
    }
  }
  return out
}

// ---- widget 与装饰实例缓存 ----

/**
 * Live 行内 HTML 片段 widget：行内宿主 span（display:inline——前后正文
 * 同行流不断行）内挂净化后的原生语义 DOM。ignoreEvent=false：点击落父
 * 编辑器选区管线（规格「HTML 内部普通点击仍优先进入源码」）；无修饰
 * 左键由 mousedown 拦截器转完整源码选区（与块级同一执行体工厂）。
 * 宿主携带源码区间 dataset；内容容器携带 docScope 标记（T02 通道）。
 * 无悬停边框/编辑按钮（规格悬停 chrome 行只对块级渲染区——行内是正文
 * 文字流，不加浮层噪音）。
 */
export class LiveInlineHtmlWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly from: number,
    readonly to: number,
    readonly docScope: string | null,
  ) {
    super()
  }

  eq(other: LiveInlineHtmlWidget): boolean {
    return other.source === this.source && other.from === this.from &&
      other.to === this.to && other.docScope === this.docScope
  }

  toDOM(view?: import('@codemirror/view').EditorView): HTMLElement {
    const host = document.createElement('span')
    host.className = LIVE_INLINE_HTML_CLASS_NAMES.host
    host.dataset['vsidianHtmlFrom'] = String(this.from)
    host.dataset['vsidianHtmlTo'] = String(this.to)
    const content = document.createElement('span')
    content.className = LIVE_INLINE_HTML_CLASS_NAMES.content
    if (this.docScope !== null) {
      content.dataset['vsidianDocScope'] = this.docScope
    }
    content.innerHTML = htmlInlineRenderHtml(this.source)
    // #570（T05）：资源装配与链接防跳转——与块级 widget 同一执行体
    //（行内 img/srcset/媒体属性按视图身份解析；a 点击不意外跳转）
    prepareHtmlWidgetContent(content, view)
    host.append(content)
    return host
  }

  ignoreEvent(): boolean {
    return false // 点击不吞——普通点击进入源码（与块级同红线）
  }

  /**
   * #571（T06）widget 退场：释放内容根的资源 binding（dispose 即媒体释放
   * ——显形撤下后无持续播放）+ 订阅即时退订（与块级同一执行体形状）。
   */
  destroy(dom: HTMLElement): void {
    const content = dom.querySelector(`.${LIVE_INLINE_HTML_CLASS_NAMES.content}`)
    if (content instanceof HTMLElement) {
      disposeHtmlResourcesOf(content)
    }
  }
}

const decoCache = new Map<string, ReturnType<typeof Decoration.replace>>()

/** widget 装饰实例缓存（同键复用，RangeSet.eq 前提；块级同款 LRU） */
export function liveInlineHtmlWidgetDeco(
  source: string,
  from: number,
  to: number,
  docScope: string | null,
): ReturnType<typeof Decoration.replace> {
  const key = `${docScope ?? ''}::${from}::${to}::${source}`
  const hit = decoCache.get(key)
  if (hit) {
    decoCache.delete(key)
    decoCache.set(key, hit)
    return hit
  }
  const deco = Decoration.replace({ widget: new LiveInlineHtmlWidget(source, from, to, docScope) })
  decoCache.set(key, deco)
  while (decoCache.size > liveInlineHtmlDecoCacheLimit) {
    const oldest = decoCache.keys().next().value
    if (oldest === undefined) {
      break
    }
    decoCache.delete(oldest)
  }
  return deco
}

/** 行内 HTML 片段装饰（StateField——块级 liveHtml 同款触发面：片段表/
 *  树/选区/命中集任一变化时重建） */
export const liveInlineHtmlDecorations = StateField.define<DecorationSet>({
  create(state) {
    const deco = state.field(liveDecorationsField, false)
    if (!deco) {
      return RangeSet.empty
    }
    return RangeSet.of(
      buildLiveInlineHtmlDecorationRanges(
        state.selection,
        state.field(liveInlineHtmlSpansField, false) ?? [],
        deco.fm,
        liveHtmlDocScopeOf(state),
        hitRangesOf(state),
      ),
      true,
    )
  },
  update(value, tr) {
    const spansChanged =
      tr.startState.field(liveInlineHtmlSpansField, false) !== tr.state.field(liveInlineHtmlSpansField, false)
    const liveDecoChanged =
      tr.startState.field(liveDecorationsField, false) !== tr.state.field(liveDecorationsField, false)
    const hitsChanged =
      tr.startState.field(hitRevealField, false) !== tr.state.field(hitRevealField, false)
    if (!tr.docChanged && tr.selection === undefined && !spansChanged && !liveDecoChanged && !hitsChanged) {
      return value
    }
    const deco = tr.state.field(liveDecorationsField, false)
    if (!deco) {
      return RangeSet.empty
    }
    return RangeSet.of(
      buildLiveInlineHtmlDecorationRanges(
        tr.state.selection,
        tr.state.field(liveInlineHtmlSpansField, false) ?? [],
        deco.fm,
        liveHtmlDocScopeOf(tr.state),
        hitRangesOf(tr.state),
      ),
      true,
    )
  },
  provide: (f) => EditorView.decorations.from(f),
})

/**
 * 「编辑当前 HTML 源码」行内目标解析（键位/命令面板执行体的行内分支，
 * 与块级 revealHtmlSourceAtCursor 同语义）：光标（主 range head）落在
 * 任一行内片段区间内（含边界）→ 选中该片段完整源码；无命中静默。
 */
export function revealInlineHtmlSourceAtCursor(view: EditorView): boolean {
  const spans = view.state.field(liveInlineHtmlSpansField, false)
  if (!spans || spans.length === 0) {
    return false
  }
  const head = view.state.selection.main.head
  const hit = spans.find((s) => s.from <= head && head <= s.to)
  if (!hit) {
    return false
  }
  view.dispatch({ selection: { anchor: hit.from, head: hit.to } })
  return true
}

/** Live 行内 HTML 扩展装配：片段表 + 装饰 + 点击拦截（纯装饰无键位语义，
 *  装配于 liveHtml 之后同组；点击拦截器与块级共用工厂） */
export const liveInlineHtml: Extension = [
  liveInlineHtmlSpansField,
  liveInlineHtmlDecorations,
  EditorView.domEventHandlers({ mousedown: makeHtmlWidgetMousedown(LIVE_INLINE_HTML_CLASS_NAMES.host) }),
]
