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
//   min(100%,880px) 不变）；保底写 min(48px, 等分份额%) 而非裸 48px——保底
//   合计被钳制在容器宽内，多列/窄面板下不横向溢出。
// - 权重加固定保底加成（TABLE_WEIGHT_PADDING_UNITS）：近似阅读模式 auto 布局
//   的格内边距占位，并使全空表头退化为等分观感（各列权重相等）。
import { escapedPipeBackslashes, tableCellBreaks, tableRowCellsForColumns } from '../shared/tableCells'

/** 最小列宽下限（px）：空列/空表头的保底可读宽度 */
export const TABLE_MIN_COLUMN_PX = 48

/** 每列权重的固定保底加成（字符宽度单位）：近似格内边距，全空表退化等分 */
export const TABLE_WEIGHT_PADDING_UNITS = 4

/** 单元格内容宽度度量（可注入）：文本 → 宽度单位数 */
export type CellWidthMeasurer = (text: string) => number

/** 等价字符宽度启发式：宽字符（CJK 全角等）计 2，其余计 1 */
export function defaultCellWidthMeasurer(text: string): number {
  let width = 0
  for (const ch of text) {
    width += isWideChar(ch.codePointAt(0) ?? 0) ? 2 : 1
  }
  return width
}

/** 东亚宽字符判定（简化范围表：CJK 统一表意、全角形式、假名、谚文等） */
function isWideChar(cp: number): boolean {
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
  /** 最小列宽下限（px，默认 48） */
  minColumnPx?: number
  /** 每列权重固定加成（默认 4） */
  weightPaddingUnits?: number
}

/**
 * 逐列采集内容宽度样本：输入为表头与数据行文本（**不含分隔行**——GFM 对齐
 * 标记不参与列宽），按 GFM 语义切格（tableCells 同源：转义/代码内管道不切
 * 分），每格按最宽视觉段计（裸 `<br>` 换行分段、`\|` 按显示形态 `|` 计），
 * 逐列取各行最大值。空列样本为 0。
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

/** 单格最宽视觉段：裸 <br> 分段（tableCellBreaks 判定），段内剔除转义管道反斜杠 */
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
    let display = ''
    for (let i = from; i < to; i++) {
      if (!escaped.has(i)) {
        display += content[i]
      }
    }
    const width = measure(display)
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

/**
 * 产出 grid 轨道计划：每列 `minmax(min(<下限>px, <等分份额>%), <占比>fr)`。
 * - 占比：fr 权重 = 内容样本 + 固定加成（比例保留，浮点按 3 位小数规整）；
 * - 下限：px 下限与「100/列数 %」取小——保底合计不超容器宽（不横向溢出），
 *   份额向下取 4 位小数保证合计 ≤ 100%；
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
  const minPx = options.minColumnPx ?? TABLE_MIN_COLUMN_PX
  const padding = options.weightPaddingUnits ?? TABLE_WEIGHT_PADDING_UNITS
  // 等分保底份额：floor 到 3 位小数（与 formatNumber 的输出精度一致，
  // 16.666…% × 6 列经格式化也不越过 100%——保底合计恒不超容器宽）
  const share = Math.floor((100 / n) * 1000) / 1000
  return samples.map((sample) => {
    const weight = Math.round((Math.max(0, sample) + padding) * 1000) / 1000
    return `minmax(min(${minPx}px, ${formatNumber(share)}%), ${formatNumber(weight)}fr)`
  })
}

/** grid-template-columns 值：轨道函数空格连接（行装饰内联消费） */
export function tableGridTemplate(
  samples: readonly number[],
  options: TableColumnWidthOptions = {},
): string {
  return planColumnTracks(samples, options).join(' ')
}

/** 数值规整输出：去多余小数尾零（504.000 → 504、4.123 → 4.123） */
function formatNumber(value: number): string {
  const fixed = value.toFixed(3).replace(/(\.\d*?)0+$/, '$1')
  return fixed.endsWith('.') ? fixed.slice(0, -1) : fixed
}
