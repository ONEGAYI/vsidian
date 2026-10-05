// #142 Live 表格列宽内容比例分配（规格 docs/specs/live-table-column-width.md）：
// 逐列度量单元格与表头的内容宽度，按占比产出 grid 轨道计划（同表各行共享）。
//
// 机制选型（工单记录，2026-09-27）：
// - 度量 = 等价字符宽度启发式（宽字符计 2、其余计 1），不依赖 DOM/字体度量
//   ——表格行是 StateField 装饰（纯态，禁 DOM 测量），启发式使列宽计划与装饰
//   构建同步完成：无异步测量窗口即无「输入时列宽跳动」（重算时机随表格网格
//   的增量重建，IME 组合期间沿用 compositionPreview 只平移不重算的既有策略）；
//   度量函数经 options.measure 注入，测试可替换口径。
// - 分配 = CSS grid 原生 minmax(保底, fr)：fr 权重即内容占比、minmax 保底即
//   最小列宽下限，「总和恰为网格总宽」由 grid 对 fr 的解析承担（总宽
//   min(100%,880px) 不变）；保底写 min(下限px, 等分份额%) 而非裸 px——保底
//   合计被钳制在容器宽内，多列/窄面板下不横向溢出。
// - 权重加固定保底加成（TABLE_WEIGHT_PADDING_UNITS）：近似阅读模式 auto 布局
//   的格内边距占位，并使全空表头退化为等分观感（各列权重相等）。
//
// #371 短列可读下限与字号适配（两处扩展，缺省时保持 #142 行为不变）：
// - 下限输入（readability）：视图层实测的「约三汉字内容宽 + 格左右
//   padding/border」普通数据注入（StateField/装饰构建内零 DOM 测量的红线
//   不破——测量在 ViewPlugin 层，见 tableMetrics.ts）。静态 48px 降为缺省
//   回退；注入后下限随字号变化，README「引用与反链」类六字短标签在大字号
//   下不再被拆成逐字竖排。
// - 「保底合计不超容器」由新机制承接：JS 侧按 availablePx 比例收缩（各列
//   下限 × 可用宽/下限总和，等下限时即等分）；生产轨道仍写
//   min(px, share%) 双保险——测量缺位/滞后时 CSS 按等分份额兜底，容器宽
//   变化（窄面板/恢复）无需 JS 重算即动态生效。
// - 采样口径对齐「可见文字」：隐藏链接目标（[[目标|别名]] 计别名、
//   [文字](url) 计文字）与格式标记（成对 `**` 等）不计入；嵌入/图片/
//   公式等无法可靠估算的 widget 按有界回退计，格内卡不主导父列宽
//   （#248「不测量目标全文」边界保持）。形态学一律复用既有单一事实源
//   （shared/wikilink、shared/math、shared/tableCells），不新增语法。
import {
  escapedPipeBackslashes,
  scanCodeSpans,
  tableCellBreaks,
  tableRowCellsForColumns,
} from '../shared/tableCells'
import {
  linkLabelDomainRangesInLine,
  parseWikilinkInner,
  scanEmbedsInLine,
  scanWikilinksInLine,
} from '../shared/wikilink'
import { scanMathInLine } from '../shared/math'

/** 最小列宽下限（px）：#371 起为缺省回退值（readability 未注入时的保底） */
export const TABLE_MIN_COLUMN_PX = 48

/** 每列权重的固定保底加成（字符宽度单位）：近似格内边距，全空表退化等分 */
export const TABLE_WEIGHT_PADDING_UNITS = 4

/**
 * widget 有界回退宽（度量单位）：约三个汉字的等价字符宽（宽字符计 2 × 3）。
 * 嵌入卡片/图片/公式的实际呈现宽不可靠估算（卡内滚动、图片自然尺寸、
 * KaTeX 排版各不相同）——按此有界值兜底：与「短内容优先完整显示」的
 * 下限基准同量级，短标签列不被长目标源文主导（#248/#285「格内卡不主导
 * 父列宽、不测量目标全文」的采样侧落点）。
 */
export const TABLE_WIDGET_FALLBACK_UNITS = 6

/** 单元格内容宽度度量（可注入）：文本 → 宽度单位数 */
export type CellWidthMeasurer = (text: string) => number

/**
 * #371 可读下限输入（纯数据）：视图层（tableMetrics.ts）测量后经
 * tableMetricsFacet 注入规划层；StateField 只消费数值，不读 DOM。
 */
export interface TableReadabilityInput {
  /** 正文显示字体下约三个汉字的内容宽度 px（探针实测「汉汉汉」） */
  contentPx: number
  /** 单格左右 padding 与 border 合计 px（.vsidian-table-grid-cell 实测） */
  cellBoxPx: number
  /**
   * 容器可用宽 px（可选）：下限之和放不下时按比例收缩的判据。缺省时
   * 由轨道内 min(px, share%) 的 CSS 双保险在浏览器侧动态承接（份额随
   * 容器宽解析，等下限收缩即等分，效果等价）；T02/T03 高度评分需要
   * 确定性像素轨道时由视图层实测注入。
   */
  availablePx?: number
}

/** 等价字符宽度启发式：宽字符（CJK 全角等）计 2，其余计 1 */
export function defaultCellWidthMeasurer(text: string): number {
  let width = 0
  for (const ch of text) {
    width += isWideChar(ch.codePointAt(0) ?? 0) ? 2 : 1
  }
  return width
}

/** 东亚宽字符判定（简化范围表：CJK 统一表意、全角形式、假名、谚文等；
 *  #372 高度规划同源消费——列宽采样与折行估算共用同一范围口径） */
export function isWideChar(cp: number): boolean {
  return (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
}

export interface TableColumnWidthOptions {
  /** 内容宽度度量（默认等价字符宽度启发式） */
  measure?: CellWidthMeasurer
  /** 最小列宽下限（px，默认 48；#371 起为缺省回退，readability 优先） */
  minColumnPx?: number
  /** 每列权重固定加成（默认 4） */
  weightPaddingUnits?: number
  /** #371 可读下限输入（缺省保持 #142 静态下限行为） */
  readability?: TableReadabilityInput
}

/** 段内可见替换件：文本片（按度量计）或 widget 占位（按回退常量计） */
type VisiblePiece = { kind: 'text'; text: string } | { kind: 'widget' }

/**
 * 单元格可见分片（#372 导出）：段的可见替换件序列——文本片按度量计宽、
 * widget 按回退常量计。类型随 #372 折行估算导出（tableHeightPlan 消费，
 * 与列宽采样同源同一形态学）。
 */
export type TableVisiblePiece = VisiblePiece

/**
 * 单元格的显式可见行（#372）：裸 `<br>` 分段后的每行可见分片序列，**空段
 * 也占一 entries**（连续 br 间的空行）；内容为空返回空数组（调用方按
 * 「占一行」处理）。与 measureWidestSegment 同一形态学（br 判定 / 转义
 * 反斜杠剔除 / 结构替换），区别在保留空段与逐段完整输出而非只取最宽。
 */
export function cellVisibleLines(content: string): TableVisiblePiece[][] {
  if (!content) {
    return []
  }
  const breaks = tableCellBreaks(content)
  const escaped = new Set(escapedPipeBackslashes(content))
  const lines: TableVisiblePiece[][] = []
  let segStart = 0
  const push = (from: number, to: number): void => {
    if (to <= from) {
      lines.push([])
      return
    }
    if (!VISIBLE_TRANSFORM_CHARS.test(content.slice(from, to))) {
      // 快路径：段内无结构/标记语法字符——displaySlice 剔转义反斜杠（segBase=0：段坐标即整格坐标）
      lines.push([{ kind: 'text', text: displaySlice(content, from, to, 0, escaped) }])
      return
    }
    lines.push(visiblePiecesOfSegment(content.slice(from, to), from, escaped))
  }
  for (const br of breaks) {
    push(segStart, br.from)
    segStart = br.to
  }
  push(segStart, content.length)
  return lines
}

/**
 * 逐列采集内容宽度样本：输入为表头与数据行文本（**不含分隔行**——GFM 对齐
 * 标记不参与列宽），按 GFM 语义切格（tableCells 同源：转义/代码内管道不切
 * 分），每格按最宽视觉段计（裸 `<br>` 换行分段、`\|` 按显示形态 `|` 计），
 * 逐列取各行最大值。空列样本为 0。
 *
 * #371 起「最宽视觉段」以**可见文字**口径度量：隐藏链接目标（双链别名、
 * markdown 链接文字域）与格式标记（成对 `**` 等，含行内代码反引号——
 * CodeMark 在 Live 呈现中隐藏）不计入；嵌入/图片/公式按 widget 有界回退。
 */
export function collectColumnSamples(
  rows: readonly string[],
  columns: number,
  options: TableColumnWidthOptions = {},
): number[] {
  const measure = options.measure ?? defaultCellWidthMeasurer
  const samples = new Array<number>(columns).fill(0)
  for (const line of rows) {
    const cells = tableRowCellsForColumns(line, 0, columns)
    if (!cells) {
      continue
    }
    for (let col = 0; col < columns; col++) {
      const cell = cells[col]
      if (!cell) {
        continue
      }
      const width = measureWidestSegment(line.slice(cell.contentFrom, cell.contentTo), measure)
      if (width > samples[col]!) {
        samples[col] = width
      }
    }
  }
  return samples
}

/** 单格最宽视觉段：裸 <br> 分段（tableCellBreaks 判定），段按可见文字口径计宽 */
function measureWidestSegment(content: string, measure: CellWidthMeasurer): number {
  if (!content) {
    return 0
  }
  const breaks = tableCellBreaks(content)
  const escaped = new Set(escapedPipeBackslashes(content))
  let widest = 0
  let segStart = 0
  const consume = (from: number, to: number): void => {
    if (to <= from) {
      return
    }
    if (!VISIBLE_TRANSFORM_CHARS.test(content.slice(from, to))) {
      // 快路径：段内无结构/标记语法字符，维持 #142 拼接口径（displaySlice 剔转义反斜杠，segBase=0）
      const width = measure(displaySlice(content, from, to, 0, escaped))
      if (width > widest) {
        widest = width
      }
      return
    }
    const width = widthOfVisibleSegment(content, from, to, escaped, measure)
    if (width > widest) {
      widest = width
    }
  }
  for (const br of breaks) {
    consume(segStart, br.from)
    segStart = br.to
  }
  consume(segStart, content.length)
  return widest
}

/** 段内出现结构/标记语法字符时才走可见化变换（绝大多数格零成本） */
const VISIBLE_TRANSFORM_CHARS = /[$*_~=`[\]]/

/** 段的可见宽度：可见化分片（文本度量 + widget 回退）累加——同视觉行水平排列 */
function widthOfVisibleSegment(
  content: string,
  from: number,
  to: number,
  escaped: Set<number>,
  measure: CellWidthMeasurer,
): number {
  const segment = content.slice(from, to)
  const pieces = visiblePiecesOfSegment(segment, from, escaped)
  let width = 0
  for (const piece of pieces) {
    width += piece.kind === 'widget' ? TABLE_WIDGET_FALLBACK_UNITS : measure(piece.text)
  }
  return width
}

/**
 * 段的可见分片：结构区间（嵌入/双链/图片/链接/公式/行内代码，复用 shared
 * 形态学）替换或占位，裸文本剥格式标记与转义反斜杠。替换产物（双链
 * display、代码 span 内容、链接文字域）不再二次剥标记——Live 双链别名按
 * 字面呈现（widget textContent）、代码内容原样，口径与呈现一致。
 * escaped 为**整格 0 基**转义反斜杠位置集合，segBase 为段在格内的起点。
 */
function visiblePiecesOfSegment(
  segment: string,
  segBase: number,
  escaped: Set<number>,
): VisiblePiece[] {
  // 代码 span 先划禁区：span 内字面量不解析任何结构语法（与切格、嵌入
  // 扫描的 code span 排除同源）；反引号标记剔除（CodeMark 隐藏）、内容
  // 原样照计（代码内 `\|` 字面显示，不剔转义）
  const inCode = scanCodeSpans(segment)
  interface Replacement { from: number; to: number; piece: VisiblePiece }
  const replacements: Replacement[] = []
  let spanStart = -1
  const flushCodeSpan = (end: number): void => {
    if (spanStart >= 0 && segment[spanStart] === '`' && segment[end - 1] === '`' && end - spanStart >= 2) {
      replacements.push({
        from: spanStart,
        to: end,
        piece: { kind: 'text', text: segment.slice(spanStart + 1, end - 1) },
      })
    }
    spanStart = -1
  }
  for (let i = 0; i <= segment.length; i++) {
    if (inCode[i] && i < segment.length) {
      if (spanStart < 0) {
        spanStart = i
      }
    } else if (spanStart >= 0) {
      flushCodeSpan(i)
    }
  }
  // 嵌入与双链（两扫描器命中集互斥，前置 ! 守卫镜像）；代码 span 内字面量跳过
  for (const hit of scanEmbedsInLine(segment)) {
    if (!inCode[hit.from]) {
      replacements.push({ from: hit.from, to: hit.to, piece: { kind: 'widget' } })
    }
  }
  for (const hit of scanWikilinksInLine(segment)) {
    if (inCode[hit.from]) {
      continue
    }
    const parsed = parseWikilinkInner(hit.inner)
    if (parsed) {
      replacements.push({ from: hit.from, to: hit.to, piece: { kind: 'text', text: parsed.display } })
    }
  }
  // 链接/图片文字域（闭合才算——markdown-it 对未闭合形态按字面渲染；
  // 域区间 [from, to) 不含两侧括号，to 为 `]` 的开区间端点）；
  // 图片整体按 widget 回退（alt 渲染为属性不落 DOM，图片自然宽不可估）
  for (const domain of linkLabelDomainRangesInLine(segment)) {
    if (inCode[domain.from - 1] ?? false) {
      continue
    }
    if (!domain.closed) {
      continue
    }
    const to = indexAfterTarget(segment, domain)
    if (domain.image) {
      // `!` 前缀与图片 widget 一并替换（Live 图片 widget 吞整个 ![alt](src)）
      const from = domain.from - 1 - (segment[domain.from - 2] === '!' ? 1 : 0)
      replacements.push({ from, to, piece: { kind: 'widget' } })
    } else {
      // 链接文字域：目标 url 不可见，计文字域（域内格式标记照剥——域内
      // 行内装饰照常渲染、标记隐藏）
      replacements.push({
        from: domain.from - 1,
        to,
        piece: { kind: 'text', text: stripInlineMarks(displaySlice(segment, domain.from, domain.to, segBase, escaped)) },
      })
    }
  }
  // 行内公式（scanMathInLine 自带代码 span 排除与转义判定）
  for (const hit of scanMathInLine(segment)) {
    replacements.push({ from: hit.from, to: hit.to, piece: { kind: 'widget' } })
  }
  // 区间重叠时保守丢弃后到者（字面近似是安全侧：宁可略宽不可裁切）
  replacements.sort((a, b) => a.from - b.from || b.to - a.to)
  const merged: Replacement[] = []
  let coverEnd = -1
  for (const rep of replacements) {
    if (rep.from >= coverEnd) {
      merged.push(rep)
      coverEnd = rep.to
    }
  }
  const pieces: VisiblePiece[] = []
  let at = 0
  for (const rep of merged) {
    if (rep.from > at) {
      pieces.push({
        kind: 'text',
        text: stripInlineMarks(displaySlice(segment, at, rep.from, segBase, escaped)),
      })
    }
    pieces.push(rep.piece)
    at = rep.to
  }
  if (at < segment.length) {
    pieces.push({
      kind: 'text',
      text: stripInlineMarks(displaySlice(segment, at, segment.length, segBase, escaped)),
    })
  }
  return pieces
}

/** 段内 [from, to) 的显示文本：剔除转义反斜杠（escaped 为整格坐标，经 segBase 换算） */
function displaySlice(segment: string, from: number, to: number, segBase: number, escaped: Set<number>): string {
  if (escaped.size === 0) {
    return segment.slice(from, to)
  }
  let display = ''
  for (let i = from; i < to; i++) {
    if (!escaped.has(segBase + i)) {
      display += segment[i]
    }
  }
  return display
}

/**
 * 图片/链接域外围的右端：吞掉闭合目标（行内式 `(...)` 到 `)`、引用式
 * `[...]` 到 `]`）。domain.to 是 `]` 的开区间端点，目标起判在 to + 1；
 * 未定位到闭合括号时退回域右端（保守不吞）。
 */
function indexAfterTarget(
  segment: string,
  domain: { from: number; to: number; closed: boolean },
): number {
  const after = segment[domain.to + 1]
  if (after === '(') {
    const close = segment.indexOf(')', domain.to + 2)
    return close >= 0 ? close + 1 : domain.to
  }
  if (after === '[') {
    const close = segment.indexOf(']', domain.to + 2)
    return close >= 0 ? close + 1 : domain.to
  }
  return domain.to + 1
}

/**
 * 成对行内格式标记剥离（**…** / __…__ / ==…== / ~~…~~ / *…* / _…_，内容
 * 非空且首尾非空白——CommonMark 强调规则近似）。这些标记在 Live 呈现中
 * 隐藏（EmphasisMark/HighlightMark 的 hideDeco），可见文字不含标记符号。
 * `_` 带词边界近似（两侧同为词字符时不剥——snake_case 不是斜体）；嵌套
 * 标记循环到不动点。列宽启发式的保守方向是低估（多折行、不裁切），与
 * 呈现层精确语义的偏差有界于标记字符数。
 */
function stripInlineMarks(text: string): string {
  if (!/[*_=~]/.test(text)) {
    return text
  }
  let prev = ''
  let out = text
  while (out !== prev) {
    prev = out
    out = out.replace(/\*\*(\S(?:[\s\S]*?\S)?)\*\*/g, '$1')
    out = out.replace(/__(\S(?:[\s\S]*?\S)?)__/g, '$1')
    out = out.replace(/==(\S(?:[\s\S]*?\S)?)==/g, '$1')
    out = out.replace(/~~(\S(?:[\s\S]*?\S)?)~~/g, '$1')
    out = out.replace(/\*([^*\s](?:[^*]*[^*\s])?)\*/g, '$1')
    out = out.replace(/(^|[^\w\\])_([^_\s](?:[^_]*[^_\s])?)_(?![\w])/g, '$1$2')
  }
  return out
}

/**
 * 有效列下限 px（#372 导出，planColumnTracks 与高度优化两处同源）：#371
 * readability 注入时 = 三汉字内容宽 + 格盒占位，各列下限之和超 availablePx
 * 时按比例收缩（保持非负、总宽不超网格；恢复宽容器后同输入回常规下限，
 * 收缩不是单向棘轮）；缺省回落 #142 静态 minColumnPx。
 */
export function effectiveColumnFloorPx(
  columns: number,
  readability?: TableReadabilityInput,
  minColumnPx?: number,
): number {
  const valid = readability &&
      Number.isFinite(readability.contentPx) && Number.isFinite(readability.cellBoxPx) &&
      readability.contentPx > 0 && readability.cellBoxPx >= 0
  const minPx = valid
    ? Math.max(0, readability!.contentPx + readability!.cellBoxPx)
    : minColumnPx ?? TABLE_MIN_COLUMN_PX
  if (valid && Number.isFinite(readability!.availablePx) && readability!.availablePx! > 0) {
    const total = minPx * columns
    if (total > readability!.availablePx!) {
      return (minPx * readability!.availablePx!) / total
    }
  }
  return minPx
}

/**
 * 产出 grid 轨道计划：每列 `minmax(min(<下限>px, <等分份额>%), <占比>fr)`。
 * - 占比：fr 权重 = 内容样本 + 固定加成（比例保留，浮点按 3 位小数规整）；
 * - 下限：#371 readability 注入时 = 三汉字内容宽 + 格盒占位（随字号变化），
 *   各列下限之和超 availablePx 时按比例收缩（保持非负、总宽不超网格）；
 *   缺省回落 #142 静态 minColumnPx。px 值与「100/列数 %」取小——份额向下
 *   取 3 位小数保证保底合计 ≤ 100%（测量缺位/滞后时 CSS 侧双保险承接，
 *   容器宽变化无需 JS 重算即动态生效）；
 * - 确定性：同一样本集产出逐字节相同计划（同表各行内联同一字符串）。
 */
export function planColumnTracks(
  samples: readonly number[],
  options: TableColumnWidthOptions = {},
): string[] {
  const n = samples.length
  if (n === 0) {
    return []
  }
  // #371 可读下限：注入时替代静态下限；有效值须为正（非有限/非正视为缺省）
  const floorPx = effectiveColumnFloorPx(n, options.readability, options.minColumnPx)
  const padding = options.weightPaddingUnits ?? TABLE_WEIGHT_PADDING_UNITS
  // 等分保底份额：floor 到 3 位小数（与 formatNumber 的输出精度一致，
  // 16.666…% × 6 列经格式化也不越过 100%——保底合计恒不超容器宽）
  const share = Math.floor((100 / n) * 1000) / 1000
  return samples.map((sample) => {
    const weight = Math.round((Math.max(0, sample) + padding) * 1000) / 1000
    return `minmax(min(${formatNumber(floorPx)}px, ${formatNumber(share)}%), ${formatNumber(weight)}fr)`
  })
}

/** grid-template-columns 值：轨道函数空格连接（行装饰内联消费） */
export function tableGridTemplate(
  samples: readonly number[],
  options: TableColumnWidthOptions = {},
): string {
  return planColumnTracks(samples, options).join(' ')
}

/** 数值规整输出：去多余小数尾零（504.000 → 504、4.123 → 4.123）；
 *  #372 高度规划同源消费——轨道串的数值精度两侧一致 */
export function formatNumber(value: number): string {
  const fixed = value.toFixed(3).replace(/(\.\d*?)0+$/, '$1')
  return fixed.endsWith('.') ? fixed.slice(0, -1) : fixed
}
