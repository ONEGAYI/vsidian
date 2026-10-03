// 父文档 Live 正文嵌入装饰（工单 #223/#247，ADR-0009「展示容器」层的
// Live 侧）：正文任意容器（段落混排/无序/有序/任务列表/懒续行/引用及组
// 合）内的 `![[…]]` occurrence（#246 的 scanEmbedsInLine 识别——两视图
// 同源）在 Live 视图以 CM6 装饰挂载共用 Reading 嵌入卡片（EmbedCardManager
// 装配，容器无关）。
//
// 装饰双形态（光标驱动源码显隐，规格「正文嵌入与源码显隐」节）：
// - 隐形态（光标/选区未触及源码区间）：**只替换嵌入精确区间 [from, to]**
//   （`![[…]]` 本身，#247 起不再整行替换）——前后文字、列表标记/编号、
//   任务控件、引用前缀与既有缩进保留在行内，宿主为块级 div（CSS 承担
//   「前文 → 块级卡片 → 后文」的流断行呈现，与 Reading 混排拆段同观感）；
//   保持 inline replace 是为了键盘垂直导航可进入嵌入行（块级 replace 会被
//   CM6 跳过整行，实测 ArrowUp 落点越过区间）。实际源文不插入换行。
// - 显形态（触及区间，selectionTouchesRange 语义：折叠光标命中内部或
//   两端、非空选区严格重叠、任一 range 命中）：替换撤下、源文可见可编辑，
//   卡片移至行下方 block widget 继续显示——显隐只作用于源文的视觉呈现，
//   不是撤卡片；**不扩大到相邻文字/整行**，兄弟卡片独立显隐。
//
// 分层契约（#222/#246 衔接）：
// - 表构建层不排除代码区域：嵌入表是「候选嵌入 occurrence」（行局部扫描 +
//   增量重建，无跨行状态）；围栏/frontmatter/代码/行内代码/注释/表格/
//   链接文字域排除在**发射层**做（消费 mermaidFencesField 的全语言围栏表
//   与文末开放围栏锚、liveDecorationsField 的 fm 区间与 lezer 语法树、
//   wikilink.linkLabelRangesInLine 的行内链接域形态学）——与 #246
//   embedSlots.OCCURRENCE_EXCLUDED、refExpansion.validChildSource 同源
//   边界（表格 #248 前排除、链接域与 Reading 呈现对齐不升级）。
// - 实例身份与 Reading 侧同源：entry key = 宿主区间起点 + 目标原文
//   （EmbedCardManager 状态库语义键）——**独占行嵌入取行首..行尾**
//   （Reading 独占行 embed 块的 data-vsidian-src-start/end 同口径），
//   **混排/容器 occurrence 取嵌入精确区间**（Reading #246 混排提升宿主
//   的 occ.start/end 同口径）——模式切换（Live↔Reading）时同一嵌入共享
//   fm 展开与滚动状态；卡片 DOM/装载由 EmbedCardManager 承担
//   （hover.request/result 通道复用），本模块只做 CM6 挂载与显隐。
// - widget 吞事件（ignoreEvent=true）：卡片点击不落父编辑器光标（CM6
//   onSelectionChange 对 ignoreEvent widget 内的选区变化直接忽略——内部
//   浏览器选区不被误当作父文档 CM6 源码选区）；卡片内交互经 embedCard
//   自有监听器（stopPropagation，#222 同款）。
// - 本票不创建目标写入通道：嵌入内容 Reading 禁写语义由共享装配承担
//   （mountRefContentBlock），Live 侧零额外写路径；未保存内容订阅与磁盘
//   变化失效属 #224。
import { Facet, RangeSet, StateField, type Extension, type Range, type Text, type Transaction } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { selectionTouchesRange } from './liveDecorations'
import { liveDecorationsField } from './liveDecorations'
import { mermaidFencesField } from './liveMermaid'
import { chainAt } from '../shared/markdownDoc'
import { scanEmbedsInTableRow } from '../shared/tableCellEmbed'
import type { Tree } from '@lezer/common'
import type { FenceSpan } from '../shared/mermaid'
import { linkLabelRangesInLine, scanEmbedsInLine, soleEmbedOfLine } from '../shared/wikilink'
import type { EmbedCardManager } from './embedCard'

/** #223 Live 嵌入宿主稳定类名（样式契约 content 域 live-embed-widget 条目同源） */
export const LIVE_EMBED_CLASS_NAMES = {
  /** widget 根宿主（卡片壳挂在内；两形态均为块级 div） */
  host: 'vsidian-live-embed',
  /** 下方形态修饰（显形态——源文可见，卡片在行下方独立块） */
  below: 'vsidian-live-embed-below',
} as const

/** 装饰实例缓存上限（键 = 形态 + 行区间 + 宿主区间 + 目标原文；与卡片渲染缓存同量级） */
export const liveEmbedDecoCacheLimit = 64

/** 一次嵌入 occurrence（LF 全文 offset）：行区间（独占行 key 源与 below
 *  形态锚）+ 嵌入文本区间（替换与显隐谓词判定域，含 `![[` 到 `]]`）+
 *  独占行标记（宿主 key 区间选择——独占行取行区间与 Reading 独占行块
 *  同源，混排取精确区间与 Reading #246 混排提升宿主同源） */
export interface LiveEmbedSpan {
  /** 嵌入行行首（LF offset） */
  lineFrom: number
  /** 嵌入行行尾（不含换行） */
  lineTo: number
  /** 嵌入文本起（含 `![[`） */
  from: number
  /** 嵌入文本止（含 `]]`） */
  to: number
  /** `![[` 与 `]]` 之间的原文 */
  inner: string
  /** 该行是否为独占嵌入行（soleEmbedOfLine 语义：trim 后整行恰为该嵌入） */
  sole: boolean
}

/** 发射层语法排除上下文（lezer 节点名）——与 #246 embedSlots 的
 *  OCCURRENCE_EXCLUDED、refExpansion.validChildSource 同源集合：
 *  代码族（围栏/缩进/行内）、HTML 块/注释。#248 起 Table 退役——表格
 *  内容行（TableRow/TableHeader）的格内嵌入经 scanEmbedsInTableRow 的
 *  格内解码扫描挂载（inner 解码语义、替换区间为源文精确区间）。
 *  注意：lezer 把 `![[x]]` 解析为 Image 节点（所有嵌入的公共祖先），
 *  Image/LinkMark 不在排除集——否则全部嵌入被排除 */
const EMIT_EXCLUDED = new Set([
  'FencedCode', 'CodeBlock', 'CodeText', 'CodeMark', 'CodeInfo', 'InlineCode',
  'HTMLBlock', 'Comment', 'CommentBlock',
])

/** 表格内容行节点名（#248：spans 表的格内解码扫描行分类） */
const TABLE_ROW_NODE_NAMES = new Set(['TableRow', 'TableHeader'])

/** 单行的嵌入 occurrence（表格内容行走格内解码扫描——inner 解码语义、
 *  区间源文；其余行走原始行扫描）。sole 随行判定。 */
function embedSpansOfLine(line: { text: string; from: number; to: number }, tree: Tree | null): LiveEmbedSpan[] {
  const sole = soleEmbedOfLine(line.text) !== null
  const isTableRow = tree !== null &&
    chainAt(tree, line.from).some((node) => TABLE_ROW_NODE_NAMES.has(node.name))
  const hits = isTableRow ? scanEmbedsInTableRow(line.text, line.from) : scanEmbedsInLine(line.text, line.from)
  return hits.map((hit) => ({
    lineFrom: line.from,
    lineTo: line.to,
    from: hit.from,
    to: hit.to,
    inner: hit.inner,
    sole,
  }))
}

/**
 * 行窗口嵌入扫描（create 全量 / 增量重建共用；纯数据输入可单测直驱）：
 * 逐行全部 occurrence（#246 识别、#248 起表格内容行走格内解码扫描——
 * inner 为解码语义）；tree 提供表格行分类（缺省 null 时全部按原始行扫描
 * ——嵌入表只作候选，发射层仍有语法排除兜底）。sole 标记随行判定
 * （soleEmbedOfLine——宿主 key 区间选择）。本层不做语法排除。
 */
export function scanEmbedSpansInLines(
  doc: Text,
  firstLine: number,
  lastLine: number,
  tree: Tree | null = null,
): LiveEmbedSpan[] {
  const out: LiveEmbedSpan[] = []
  for (let n = firstLine; n <= lastLine; n += 1) {
    const line = doc.line(n)
    if (!line.text.includes('![[')) {
      continue
    }
    out.push(...embedSpansOfLine(line, tree))
  }
  return out
}

/**
 * 嵌入表增量重建：种子 = 变更区间（新坐标）∪ 映射后与之相交（含相邻行
 * 边界放宽 1，合行/拆行场景）的旧条目；窗口内重扫、窗口外映射保留；
 * 坍缩条目（整行被删映射出倒挂区间）丢弃——嵌入是行局部语法，无跨行
 * 状态（对照 mermaid 围栏表的开放状态锚，此处无此复杂度）。窗口外条目
 * 以行内 occurrence 重扫精确对齐校验（from/to/inner 全匹配才保留——
 * 同行多嵌入互不串位；表格行按格内解码扫描同款对齐）。
 */
export function rebuildEmbedSpans(
  doc: Text,
  tr: Transaction,
  prev: readonly LiveEmbedSpan[],
  tree: Tree | null = null,
): LiveEmbedSpan[] {
  const changes = tr.changes
  let seedFrom = doc.length + 1
  let seedTo = -1
  changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    seedFrom = Math.min(seedFrom, fromB)
    seedTo = Math.max(seedTo, toB)
  })
  if (seedTo < 0) {
    return prev as LiveEmbedSpan[]
  }
  const mapped = prev.map((s) => ({
    lineFrom: changes.mapPos(s.lineFrom, 1),
    lineTo: changes.mapPos(s.lineTo, -1),
    from: changes.mapPos(s.from, 1),
    to: changes.mapPos(s.to, -1),
    inner: s.inner,
    sole: s.sole,
  }))
  for (const m of mapped) {
    if (m.lineTo + 1 >= seedFrom && m.lineFrom <= seedTo + 1) {
      seedFrom = Math.min(seedFrom, m.lineFrom)
      seedTo = Math.max(seedTo, m.lineTo)
    }
  }
  const firstLine = doc.lineAt(Math.min(Math.max(seedFrom, 0), doc.length)).number
  const lastLine = doc.lineAt(Math.min(Math.max(seedTo, 0), doc.length)).number
  const windowStart = doc.line(firstLine).from
  const windowEnd = doc.line(lastLine).to
  const out: LiveEmbedSpan[] = []
  for (const m of mapped) {
    if (m.lineFrom >= m.lineTo) {
      continue // 坍缩产物（整行删除；mermaid 表同款防御）
    }
    if (m.lineTo < windowStart || m.lineFrom > windowEnd) {
      // 窗口外保留：重扫该行 occurrence，精确对齐（from/to/inner）才保留
      //（同行多嵌入按精确区间配对，不吞位、不漂移；表格行解码扫描同款）
      const line = doc.lineAt(m.lineFrom)
      if (line.from === m.lineFrom) {
        const hit = embedSpansOfLine(line, tree)
          .find((h) => h.from === m.from && h.to === m.to && h.inner === m.inner)
        if (hit) {
          out.push({ ...hit })
        }
      }
      // 行边界漂移（理论不可达，防御丢弃）
    }
  }
  out.push(...scanEmbedSpansInLines(doc, firstLine, lastLine, tree))
  out.sort((a, b) => a.lineFrom - b.lineFrom || a.from - b.from)
  return out
}

/** 全文档嵌入表（#223）：docChanged 时增量重建；选区/视口变化零成本。
 *  树取自 liveDecorationsField（装配序在其后，增量解析与 state.doc 同步
 *  ——表格行的格内解码扫描行分类来源） */
export const liveEmbedSpansField = StateField.define<readonly LiveEmbedSpan[]>({
  create(state) {
    return scanEmbedSpansInLines(state.doc, 1, state.doc.lines,
      state.field(liveDecorationsField, false)?.tree ?? null)
  },
  update(value, tr) {
    if (!tr.docChanged) {
      return value
    }
    return rebuildEmbedSpans(tr.state.doc, tr, value,
      tr.state.field(liveDecorationsField, false)?.tree ?? null)
  },
})

/** 嵌入行是否整体落在已闭合围栏内容区（围栏表按 from 升序不重叠——
 *  唯一候选是最后一个 from <= lineFrom 的围栏；二分定位） */
function fenceContains(fences: readonly FenceSpan[], lineFrom: number, lineTo: number): boolean {
  let lo = 0
  let hi = fences.length - 1
  let hit = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (fences[mid]!.from <= lineFrom) {
      hit = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return hit >= 0 && fences[hit]!.to >= lineTo
}

/**
 * 嵌入装饰构建（#223/#247/#248 契约入口；纯数据输入，可单测直驱）：
 * 逐 occurrence 发射——触及源码区间 → 行下方 block widget（源码显形）；
 * 未触及 → **嵌入精确区间** [from, to] inline replace widget（#247：前后
 * 文/列表标记/任务控件/引用前缀/缩进保留，卡片块级断行呈现由 CSS 承担，
 * 见 main.css 的 live-embed 段；#248 起表格内容行同款——widget 嵌在网格
 * 格 mark span 内（CM6 inline replace widget 不切开 mark），网格列布局
 * 不因格内卡破坏）。排除（发射层）：frontmatter 内（头区不产正文嵌入）、
 * 已闭合围栏内与文末开放围栏后（代码区域字面文本不作为嵌入——与阅读侧
 * markdown-it 块语义对齐）、lezer 语法上下文（行内代码/HTML 块/注释——
 * #246 同源排除集合；#248 起 Table 开放为格内挂载）、行内链接/图片文字域
 * （与 Reading 呈现对齐：链接域内嵌入不升级）。
 * P2-09（#286）：child 在场（嵌入内部 Live 编辑器装配孙卡上下文）时，
 * widget 携带该上下文——孙卡以直接父 B 的来源身份挂载（parentInstanceId/
 * occurrence 键/depth/来源文档），不落根级语义键。
 */
export function buildLiveEmbedDecorationRanges(
  selection: import('@codemirror/state').EditorSelection,
  spans: readonly LiveEmbedSpan[],
  fences: readonly FenceSpan[],
  trailingOpenStart: number | null,
  fm: { end: number } | null,
  doc: Text,
  tree: Tree | null,
  child?: LiveEmbedChildContext | null,
): Array<Range<Decoration>> {
  const out: Array<Range<Decoration>> = []
  for (const span of spans) {
    if (fm && span.lineFrom < fm.end) {
      continue
    }
    if (trailingOpenStart !== null && span.lineFrom >= trailingOpenStart) {
      continue
    }
    if (fenceContains(fences, span.lineFrom, span.lineTo)) {
      continue
    }
    if (tree !== null && chainAt(tree, span.from).some((node) => EMIT_EXCLUDED.has(node.name))) {
      continue
    }
    // 行内链接/图片文字域排除（保守形态学——误判方向为保持源文）
    const line = doc.lineAt(span.lineFrom)
    const inLinkLabel = linkLabelRangesInLine(line.text, line.from)
      .some((r) => span.from >= r.from && span.from < r.to)
    if (inLinkLabel) {
      continue
    }
    const keyFrom = span.sole ? span.lineFrom : span.from
    const keyTo = span.sole ? span.lineTo : span.to
    const touched = selectionTouchesRange(selection, span.from, span.to)
    const deco = liveEmbedWidgetDeco(span.inner, span.lineFrom, span.lineTo, keyFrom, keyTo, touched, child)
    out.push(touched ? deco.range(span.lineTo) : deco.range(span.from, span.to))
  }
  return out
}

// ---- widget 与装饰实例缓存 ----

/** 卡片管理器接线（syncController mount 注入、dispose 清空——模块级单例
 *  经 setter 接收，diagramPopup setDiagramPopupDocSource 同款注入形态） */
let cards: EmbedCardManager | null = null

export function setLiveEmbedCards(manager: EmbedCardManager | null): void {
  cards = manager
}

/**
 * Live 嵌入卡片 widget：toDOM 经 EmbedCardManager 挂载共用卡片（容器无关
 * 语义键——与 Reading 侧同一 entry 状态库），destroy 随装饰退场卸载（实例
 * 状态保留，重挂优先装载缓存）。ignoreEvent=true 吞事件——点击不落父
 * 编辑器光标、CM6 忽略卡片内选区变化（选区隔离），卡片交互走 embedCard
 * 自有监听器。两形态均为块级（隐形态 = 嵌入精确区间 inline replace 的
 * 替换物，流断行呈现「前文 → 卡片 → 后文」；显形态 = 行下方 block
 * widget）；高度由 CM6 测量 + ResizeObserver→requestMeasure 兜底回填。
 * P2-09（#286）：child 在场时（嵌入内部 Live 编辑器的孙卡装饰），挂载走
 * 直接父来源身份（parentInstanceId / occurrence 键 / depth / 来源文档
 * = 直接父 B）——坐标在本 widget 所属编辑器的全文空间（= B 全文），与
 * Reading 侧孙卡（mountChildFrom）的语义键同源，跨模式共享实例状态。
 */
export class LiveEmbedWidget extends WidgetType {
  constructor(
    readonly inner: string,
    readonly lineFrom: number,
    readonly lineTo: number,
    /** 宿主 key 区间（独占行 = 行区间，混排 = 嵌入精确区间——跨模式状态共享口径） */
    readonly keyFrom: number,
    readonly keyTo: number,
    readonly below: boolean,
    /** P2-09 孙卡挂载上下文（缺省 = 根正文嵌入——无来源链） */
    readonly child?: LiveEmbedChildContext,
  ) {
    super()
  }

  eq(other: LiveEmbedWidget): boolean {
    return (
      other.inner === this.inner && other.lineFrom === this.lineFrom &&
      other.lineTo === this.lineTo && other.keyFrom === this.keyFrom &&
      other.keyTo === this.keyTo && other.below === this.below &&
      other.child?.parentHostId === this.child?.parentHostId
    )
  }

  get lineBreaks(): number {
    return 1
  }

  toDOM(): HTMLElement {
    // 两形态宿主均为块级 div：显形态是 .cm-content 直接子块；隐形态是块级
    // 替换物（嵌入精确区间——#247 前后文保留在行内，块级宿主断行呈现）
    const host = document.createElement('div')
    host.className = this.below
      ? `${LIVE_EMBED_CLASS_NAMES.host} ${LIVE_EMBED_CLASS_NAMES.below}`
      : LIVE_EMBED_CLASS_NAMES.host
    if (this.child) {
      // P2-09 孙卡：经直接父来源身份挂载（occurrence 键与 mountChildFrom
      // 同源——B 的 Reading 侧与 Live 编辑器侧命中同一 entry 实例）
      cards?.mountCardInto(host, this.inner, this.keyFrom, this.keyTo, 'live', {
        panelDocUri: this.child.panelDocUri,
        sourceDocUri: this.child.sourceDocUri,
        range: { start: this.keyFrom, end: this.keyTo },
        occurrence: `${this.child.parentHostId}/${this.keyFrom}::${this.inner}`,
        parentInstanceId: this.child.parentHostId,
        depth: this.child.parentDepth + 1,
        treeId: this.child.treeId,
      })
    } else {
      cards?.mountCardInto(host, this.inner, this.keyFrom, this.keyTo, 'live')
    }
    return host
  }

  destroy(dom: HTMLElement): void {
    cards?.unmountBlock(dom)
  }

  ignoreEvent(): boolean {
    return true // 卡片域自持交互（滚动/选字/链接/fm 按钮），不落父编辑器光标
  }
}

const decoCache = new Map<string, ReturnType<typeof liveEmbedWidgetDeco>>()

/** widget 装饰实例缓存（同键复用，RangeSet.eq 前提；mermaidWidgetDeco 先例）。
 *  P2-09：孙卡 widget 的缓存键含父身份——同一坐标/inner 在不同父编辑器
 *  中是不同实例（来源链不同），不得跨视图复用。 */
export function liveEmbedWidgetDeco(
  inner: string,
  lineFrom: number,
  lineTo: number,
  keyFrom: number,
  keyTo: number,
  below: boolean,
  child?: LiveEmbedChildContext | null,
): ReturnType<typeof Decoration.replace> | ReturnType<typeof Decoration.widget> {
  const key = `${child ? `c:${child.parentHostId}:` : ''}${below ? 1 : 0}::${lineFrom}::${lineTo}::${keyFrom}::${keyTo}::${inner}`
  const hit = decoCache.get(key)
  if (hit) {
    decoCache.delete(key)
    decoCache.set(key, hit) // LRU 重排到最新端
    return hit
  }
  const deco = below
    ? Decoration.widget({ widget: new LiveEmbedWidget(inner, lineFrom, lineTo, keyFrom, keyTo, true, child ?? undefined), block: true, side: 1 })
    // 隐形态保持 inline replace（行结构保留——键盘垂直导航可进入嵌入行，
    // 块级 replace 会被 CM6 当不可停靠块直接跳过，实测 ArrowUp 越过整行）；
    // #247 起替换区间为嵌入精确区间（前后文/标记/缩进保留），「前文 →
    // 卡片 → 后文」的流断行呈现由 CSS 承担（宿主块级化 + 隐藏 replace
    // widget 前后的 cm-widgetBuffer）
    : Decoration.replace({ widget: new LiveEmbedWidget(inner, lineFrom, lineTo, keyFrom, keyTo, false, child ?? undefined) })
  decoCache.set(key, deco)
  while (decoCache.size > liveEmbedDecoCacheLimit) {
    const oldest = decoCache.keys().next().value
    if (oldest === undefined) {
      break
    }
    decoCache.delete(oldest)
  }
  return deco
}

/** P2-04（#281）挂卡宿主标记：只有装配该标记的 Live 视图（根正文）才
 *  发射嵌入卡片装饰——P2-09 起嵌入内部 Live 编辑器经**孙卡上下文 facet**
 *  （liveEmbedChildCards）发射：孙卡以直接父来源身份挂载（不落根级语义
 *  键，不与根面板嵌入串位）；无标记且无孙卡上下文的视图仍不发射。 */
const embedCardsHostView = Facet.define<boolean, boolean>({ combine: (values) => values.some(Boolean) })

/** 根正文装配标记（syncController 经 extraExtensions 注入主编辑器实例） */
export const liveEmbedCardsHostMark = embedCardsHostView.of(true)

/** P2-09（#286）孙卡挂载上下文：嵌入内部 Live 编辑器（B 的编辑器）装配
 *  后，其正文中的嵌入以「B 的子引用」挂载——直接父身份、深度与家族树
 *  取 B 的稳定宿主身份；来源文档 = B 的目标 fsPath（孙卡来源链沿 B）。 */
export interface LiveEmbedChildContext {
  /** 直接父 B 的稳定宿主身份（hostId——对外身份永不变，P2-07） */
  parentHostId: string
  /** 面板会话文档（面板身份仍为根 A 面板——请求/端口出站都经它） */
  panelDocUri: string
  /** 直接来源文档 = B 的目标 fsPath（孙卡 hover.request 的 sourceDocUri） */
  sourceDocUri: string
  /** B 的深度（孙卡 depth = parentDepth + 1；预算与深度截断沿用） */
  parentDepth: number
  /** 家族树（预算与实例分组——与 B 自身的 treeId 同源） */
  treeId: string
}

const liveEmbedChildCardsFacet = Facet.define<LiveEmbedChildContext, LiveEmbedChildContext | null>({
  combine: (values) => values[values.length - 1] ?? null,
})

/** P2-09 孙卡装配扩展：嵌入内部 Live 编辑器（LiveEditorInstance 经
 *  extraExtensions 注入——embedCard.createLiveInstance）发射孙卡装饰 */
export function liveEmbedChildCards(ctx: LiveEmbedChildContext): Extension {
  return liveEmbedChildCardsFacet.of(ctx)
}

/** 嵌入装饰（StateField，#223）：block widget 与跨行 replace 均须来自
 *  StateField（CM6 硬约束）；表/围栏/frontmatter/语法树任一变化或选区
 *  变化时全量重建（装饰实例缓存使 RangeSet.eq 可命中） */
export const liveEmbedDecorations = StateField.define<DecorationSet>({
  create(state) {
    const child = state.facet(liveEmbedChildCardsFacet)
    if (!state.facet(embedCardsHostView) && !child) {
      return RangeSet.empty
    }
    const deco = state.field(liveDecorationsField, false)
    if (!deco) {
      return RangeSet.empty
    }
    const fences = state.field(mermaidFencesField, false)
    return RangeSet.of(
      buildLiveEmbedDecorationRanges(
        state.selection,
        state.field(liveEmbedSpansField, false) ?? [],
        fences?.spans ?? [],
        fences?.trailingOpenStart ?? null,
        deco.fm,
        state.doc,
        deco.tree,
        child,
      ),
      true,
    )
  },
  update(value, tr) {
    const spansChanged =
      tr.startState.field(liveEmbedSpansField, false) !== tr.state.field(liveEmbedSpansField, false)
    const fencesChanged =
      tr.startState.field(mermaidFencesField, false) !== tr.state.field(mermaidFencesField, false)
    const liveDecoChanged =
      tr.startState.field(liveDecorationsField, false) !== tr.state.field(liveDecorationsField, false)
    if (!tr.docChanged && tr.selection === undefined && !spansChanged && !fencesChanged && !liveDecoChanged) {
      return value
    }
    const child = tr.state.facet(liveEmbedChildCardsFacet)
    if (!tr.state.facet(embedCardsHostView) && !child) {
      return RangeSet.empty
    }
    const deco = tr.state.field(liveDecorationsField, false)
    if (!deco) {
      return RangeSet.empty
    }
    const fences = tr.state.field(mermaidFencesField, false)
    return RangeSet.of(
      buildLiveEmbedDecorationRanges(
        tr.state.selection,
        tr.state.field(liveEmbedSpansField, false) ?? [],
        fences?.spans ?? [],
        fences?.trailingOpenStart ?? null,
        deco.fm,
        tr.state.doc,
        deco.tree,
        child,
      ),
      true,
    )
  },
  provide: (f) => EditorView.decorations.from(f),
})

/** live 嵌入扩展装配：嵌入表 StateField + 装饰 StateField（纯装饰无键位
 *  语义，装配于 liveMermaid 之后同组；卡片管理器接线由 syncController 注入） */
export const liveEmbed: Extension = [liveEmbedSpansField, liveEmbedDecorations]
