// 父文档 Live 正文嵌入装饰（工单 #223，ADR-0009「展示容器」层的 Live 侧）：
// 独占正文一行的 `![[…]]`（soleEmbedOfLine 识别——与 Reading 侧 #222 同一
// 挂载适配语义：混排/列表/引用/表格格保留源文，1.5 期接入）在 Live 视图
// 以 CM6 装饰挂载共用 Reading 嵌入卡片（EmbedCardManager 装配，容器无关）。
//
// 装饰双形态（光标驱动源码显隐，规格「正文嵌入与源码显隐」节；验收反馈
// 后隐形态的呈现由 CSS 块级化承担）：
// - 隐形态（光标/选区未触及源码区间）：整行 [lineFrom, lineTo] inline
//   replace widget——源文文本视觉退场；「卡片从源码行对齐、不留隐形源码
//   行」由 CSS 承担（宿主 display:block + 隐藏 replace 前后的
//   cm-widgetBuffer），保持 inline replace 是为了键盘垂直导航可进入嵌入
//   行（块级 replace 会被 CM6 跳过整行，实测 ArrowUp 落点越过区间）。
// - 显形态（触及区间，selectionTouchesRange 语义：折叠光标命中内部或
//   两端、非空选区严格重叠、任一 range 命中）：替换撤下、源文可见可编辑，
//   卡片移至行下方 block widget 继续显示（动态下移一行给源码让位）——
//   显隐只作用于源文的视觉呈现，不是撤卡片（与 liveMermaid 显源时撤图
//   的取舍不同，按规格共识保留内容）。
//
// 分层契约（#222 衔接）：
// - 表构建层不排除代码区域：嵌入表是「候选嵌入行」（行局部扫描 + 增量
//   重建，无跨行状态）；围栏/frontmatter 排除在**发射层**做（消费
//   mermaidFencesField 的全语言围栏表与文末开放围栏锚、liveDecorationsField
//   的 fm 区间）——围栏编辑（含上方开栏）即时联动，无需差集窗口。
// - 实例身份与 Reading 侧同源：entry key = 嵌入行行首 offset + 目标原文
//   （EmbedCardManager 状态库语义键）——模式切换（Live↔Reading）时同一
//   嵌入共享 fm 展开与滚动状态；卡片 DOM/装载由 EmbedCardManager 承担
//   （hover.request/result 通道复用），本模块只做 CM6 挂载与显隐。
// - widget 吞事件（ignoreEvent=true）：卡片点击不落父编辑器光标（CM6
//   onSelectionChange 对 ignoreEvent widget 内的选区变化直接忽略——内部
//   浏览器选区不被误当作父文档 CM6 源码选区）；卡片内交互经 embedCard
//   自有监听器（stopPropagation，#222 同款）。
// - 本票不创建目标写入通道：嵌入内容 Reading 禁写语义由共享装配承担
//   （mountRefContentBlock），Live 侧零额外写路径；未保存内容订阅与磁盘
//   变化失效属 #224。
import { RangeSet, StateField, type Extension, type Range, type Text, type Transaction } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { selectionTouchesRange } from './liveDecorations'
import { liveDecorationsField } from './liveDecorations'
import { mermaidFencesField } from './liveMermaid'
import type { FenceSpan } from '../shared/mermaid'
import { soleEmbedOfLine } from '../shared/wikilink'
import type { EmbedCardManager } from './embedCard'

/** #223 Live 嵌入宿主稳定类名（样式契约 content 域 live-embed-widget 条目同源） */
export const LIVE_EMBED_CLASS_NAMES = {
  /** widget 根宿主（卡片壳挂在内；两形态均为块级 div） */
  host: 'vsidian-live-embed',
  /** 下方形态修饰（显形态——源文可见，卡片在行下方独立块） */
  below: 'vsidian-live-embed-below',
} as const

/** 装饰实例缓存上限（键 = 形态 + 行区间 + 目标原文；与卡片渲染缓存同量级） */
export const liveEmbedDecoCacheLimit = 64

/** 一次独占行嵌入（LF 全文 offset）：行区间（装饰覆盖与 entry key 的
 *  sourceStart/End 同源）+ 嵌入文本区间（显隐谓词判定域，含 `![[` 到 `]]`） */
export interface LiveEmbedSpan {
  /** 嵌入行行首（LF offset；Reading 侧 data-vsidian-src-start 同口径——跨模式实例键同源） */
  lineFrom: number
  /** 嵌入行行尾（不含换行） */
  lineTo: number
  /** 嵌入文本起（含 `![[`） */
  from: number
  /** 嵌入文本止（含 `]]`） */
  to: number
  /** `![[` 与 `]]` 之间的原文 */
  inner: string
}

/**
 * 行窗口嵌入扫描（create 全量 / 增量重建共用；纯数据输入可单测直驱）：
 * 逐行 soleEmbedOfLine（混排/列表/引用/表格格/未闭合不命中——shared 识别
 * 器语义，两视图同源）。本层不做围栏/frontmatter 排除（发射层职责）。
 */
export function scanEmbedSpansInLines(doc: Text, firstLine: number, lastLine: number): LiveEmbedSpan[] {
  const out: LiveEmbedSpan[] = []
  for (let n = firstLine; n <= lastLine; n += 1) {
    const line = doc.line(n)
    const sole = soleEmbedOfLine(line.text)
    if (sole === null) {
      continue
    }
    const indent = line.text.length - line.text.trimStart().length
    out.push({
      lineFrom: line.from,
      lineTo: line.to,
      from: line.from + indent + sole.from,
      to: line.from + indent + sole.to,
      inner: sole.inner,
    })
  }
  return out
}

/**
 * 嵌入表增量重建：种子 = 变更区间（新坐标）∪ 映射后与之相交（含相邻行
 * 边界放宽 1，合行/拆行场景）的旧条目；窗口内重扫、窗口外映射保留；
 * 坍缩条目（整行被删映射出倒挂区间）丢弃——嵌入是行局部语法，无跨行
 * 状态（对照 mermaid 围栏表的开放状态锚，此处无此复杂度）。
 */
export function rebuildEmbedSpans(
  doc: Text,
  tr: Transaction,
  prev: readonly LiveEmbedSpan[],
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
    inner: s.inner,
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
      // 窗口外保留：重取精确文本区间（inner 与行内容一致，映射行区间足够）
      const line = doc.lineAt(m.lineFrom)
      const sole = soleEmbedOfLine(line.text)
      if (sole !== null && sole.inner === m.inner) {
        const indent = line.text.length - line.text.trimStart().length
        out.push({
          lineFrom: line.from,
          lineTo: line.to,
          from: line.from + indent + sole.from,
          to: line.from + indent + sole.to,
          inner: sole.inner,
        })
      }
      // 行内容已非该嵌入（异校验失败丢弃——理论不可达，防御漂移）
    }
  }
  out.push(...scanEmbedSpansInLines(doc, firstLine, lastLine))
  out.sort((a, b) => a.lineFrom - b.lineFrom)
  return out
}

/** 全文档嵌入表（#223）：docChanged 时增量重建；选区/视口变化零成本 */
export const liveEmbedSpansField = StateField.define<readonly LiveEmbedSpan[]>({
  create(state) {
    return scanEmbedSpansInLines(state.doc, 1, state.doc.lines)
  },
  update(value, tr) {
    if (!tr.docChanged) {
      return value
    }
    return rebuildEmbedSpans(tr.state.doc, tr, value)
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
 * 嵌入装饰构建（#223 契约入口；纯数据输入，可单测直驱）：
 * 逐 span 发射——触及源码区间 → 行下方 block widget（源文显形）；未触及
 * → 整行 inline replace widget（源文退场；卡片块级对齐与 buffer 隐藏由
 * CSS 承担，见 main.css 的 live-embed 段——验收反馈「不留隐形源码行」的
 * 呈现修复）。排除：frontmatter 内（头区不产正文嵌入）、已闭合围栏内与
 * 文末开放围栏后（代码区域字面文本不作为嵌入——与阅读侧 markdown-it
 * 块语义对齐）。
 */
export function buildLiveEmbedDecorationRanges(
  selection: import('@codemirror/state').EditorSelection,
  spans: readonly LiveEmbedSpan[],
  fences: readonly FenceSpan[],
  trailingOpenStart: number | null,
  fm: { end: number } | null,
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
    const touched = selectionTouchesRange(selection, span.from, span.to)
    const deco = liveEmbedWidgetDeco(span.inner, span.lineFrom, span.lineTo, touched)
    out.push(touched ? deco.range(span.lineTo) : deco.range(span.lineFrom, span.lineTo))
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
 * 自有监听器。两形态均为块级（隐形态 = 块级整行 replace 的替换物，显形态
 * = 行下方 block widget）；高度由 CM6 测量 + ResizeObserver→requestMeasure
 * 兜底回填。
 */
export class LiveEmbedWidget extends WidgetType {
  constructor(
    readonly inner: string,
    readonly lineFrom: number,
    readonly lineTo: number,
    readonly below: boolean,
  ) {
    super()
  }

  eq(other: LiveEmbedWidget): boolean {
    return (
      other.inner === this.inner && other.lineFrom === this.lineFrom &&
      other.lineTo === this.lineTo && other.below === this.below
    )
  }

  get lineBreaks(): number {
    return 1
  }

  toDOM(): HTMLElement {
    // 两形态宿主均为块级 div：显形态是 .cm-content 直接子块；隐形态是块级
    // replace 的替换物（验收反馈：块级宿主独占行位，不留 inline 宿主的
    // 隐形源码行）
    const host = document.createElement('div')
    host.className = this.below
      ? `${LIVE_EMBED_CLASS_NAMES.host} ${LIVE_EMBED_CLASS_NAMES.below}`
      : LIVE_EMBED_CLASS_NAMES.host
    cards?.mountCardInto(host, this.inner, this.lineFrom, this.lineTo, 'live')
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

/** widget 装饰实例缓存（同键复用，RangeSet.eq 前提；mermaidWidgetDeco 先例） */
export function liveEmbedWidgetDeco(
  inner: string,
  lineFrom: number,
  lineTo: number,
  below: boolean,
): ReturnType<typeof Decoration.replace> | ReturnType<typeof Decoration.widget> {
  const key = `${below ? 1 : 0}::${lineFrom}::${lineTo}::${inner}`
  const hit = decoCache.get(key)
  if (hit) {
    decoCache.delete(key)
    decoCache.set(key, hit) // LRU 重排到最新端
    return hit
  }
  const deco = below
    ? Decoration.widget({ widget: new LiveEmbedWidget(inner, lineFrom, lineTo, true), block: true, side: 1 })
    // 隐形态保持 inline replace（行结构保留——键盘垂直导航可进入嵌入行，
    // 块级 replace 会被 CM6 当不可停靠块直接跳过，实测 ArrowUp 越过整行）；
    // 「不留隐形源码行」由 CSS 承担：宿主块级化 + 隐藏 replace widget 前后
    // 的 cm-widgetBuffer（frontmatter 标题栏行同款先例）
    : Decoration.replace({ widget: new LiveEmbedWidget(inner, lineFrom, lineTo, false) })
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

/** 嵌入装饰（StateField，#223）：block widget 与跨行 replace 均须来自
 *  StateField（CM6 硬约束）；表/围栏/frontmatter 任一变化或选区变化时
 *  全量重建（装饰实例缓存使 RangeSet.eq 可命中） */
export const liveEmbedDecorations = StateField.define<DecorationSet>({
  create(state) {
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
      ),
      true,
    )
  },
  provide: (f) => EditorView.decorations.from(f),
})

/** live 嵌入扩展装配：嵌入表 StateField + 装饰 StateField（纯装饰无键位
 *  语义，装配于 liveMermaid 之后同组；卡片管理器接线由 syncController 注入） */
export const liveEmbed: Extension = [liveEmbedSpansField, liveEmbedDecorations]
