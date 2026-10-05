// #372 两列表格整表高度优化：纯规划层（折行估算 / 评分 / 有界搜索 / 预算）。
//
// 职责边界（与 #371/#142 的纯规划层同族约束）：
// - 本模块零 DOM、零视图依赖：输入是普通数据（行格文本 + 轻量样本 +
//   readability 度量），输出 grid 轨道串；StateField/装饰构建内可直接消费。
// - 评分模型：整表高度 = 逐行「该行各格估算高度最大值」之和（含表头）；
//   统一行高时等价逐行最大折行数之和。**不是**各格折行数相加，也不追求
//   浏览器真实高度的全局最优（不宣称精确最优——图片/公式/嵌入卡内部
//   高度按 #248/#285 有界回退口径，不进精确模型）。
// - 折行估算区分可折行位置与显式换行：中文任意字符间可断、拉丁按词、
//   行内代码内容按词（超长无空格串按宽度硬断——overflow-wrap: anywhere
//   近似）、空格随前词（换行时丢弃）、裸 <br> 是显式行（连续 br 间的
//   空行也计行）。可见文字口径与 #371 采样同源（cellVisibleLines）。
// - 候选集必须含轻量基线候选，同模型评分不劣于基线；同分决胜序：
//   ① 总折行数少 → ② 表头折行 + 短标签超一行折行少 → ③ 距轻量基线
//   的列宽变化小 → ④ 列宽字典序（同输入同输出逐字节确定）。
// - 预算集中定义（候选数 / 单轮格评估量 / 行缓存容量）；超预算降级保留
//   T01 可读轻量计划，不反复触发无效搜索（由调度层按签名去重）。
//
// 发布通道：applyTableHeightPlan 携带表格身份（Table 节点 from）、文档
// 引用、列数与度量签名，由 liveDecorations 的字段 update 验证后一次性
// 应用（模板变化 → 行装饰键变 → CM6 重绘；不写回源文本、不新增宿主消息
// 与撤销记录）。
import { StateEffect, type Text } from '@codemirror/state'
import {
  TABLE_WEIGHT_PADDING_UNITS,
  TABLE_WIDGET_FALLBACK_UNITS,
  cellVisibleLines,
  defaultCellWidthMeasurer,
  effectiveColumnFloorPx,
  tableGridTemplate,
  type CellWidthMeasurer,
  type TableReadabilityInput,
} from './tableColumnWidth'

// ---- 预算常量（集中定义；调度层与测试共同消费） ----

/** 粗搜点位数（含区间两端） */
export const TABLE_OPT_COARSE_POINTS = 9
/** 细搜点位数（最优点两侧各半） */
export const TABLE_OPT_FINE_POINTS = 8
/** 候选总数上限（粗搜 + 内容锚点 + 基线 + 细搜的去重结果） */
export const TABLE_OPT_MAX_CANDIDATES = 24
/** 单轮单元格评估量上限（行 × 列 × 候选的折行估算次数） */
export const TABLE_OPT_MAX_CELL_EVALS = 20000
/** 逐行折行指标缓存容量（条目；随视图释放，无持久存储） */
export const TABLE_OPT_CACHE_ROWS = 4096
/** 调度层已优化签名登记容量（表格数） */
export const TABLE_OPT_TRACKED_TABLES = 256
/** 短标签判定（度量单位）：单行自然宽 ≤ 此值视为短标签（约 6 汉字） */
export const TABLE_SHORT_LABEL_UNITS = 12
/**
 * 折行评分安全系数（#372）：评分时内容宽按此比例收缩——字符启发式的
 * 单位宽（contentPx/6）与真实字体 advance 存在约 1–2% 偏差，恰在
 * 「N 字整」的刀口宽度上模型判 2 行而真实渲染折 3 行（README 24px 样例
 * 实证）。收缩使评分对刀口宽度悲观，优化器自然避开这些候选；发布的
 * 轨道宽仍为原始值。
 */
export const TABLE_OPT_WRAP_SAFETY = 0.98

// ---- 折行估算 ----

/** 折行原子：不可断单元（词 / CJK 单字 / widget）宽 + 其后随空格宽（换行时丢弃） */
interface WrapToken {
  units: number
  trailingUnits: number
}

/** 单元格折行指标：逐显式行的 token 序列 + 单行自然宽（短标签判定用） */
export interface CellWrapProfile {
  /** 逐显式行（含空行——空行为空数组） */
  lines: WrapToken[][]
  /** 单行自然宽：各显式行（units + trailing）的最大值 */
  naturalUnits: number
}

/** 文本片 → 折行原子：CJK 单字各为可断原子，拉丁串按词，空格随前词 */
function tokenizeText(text: string, measure: CellWidthMeasurer, out: WrapToken[]): void {
  let wordUnits = 0
  let pendingSpaces = 0
  let hasWord = false
  const flush = (): void => {
    if (hasWord) {
      out.push({ units: wordUnits, trailingUnits: pendingSpaces })
    }
    // 行首无前词的空格不计宽（pre-wrap 悬挂近似的保守侧：少算折行）
    wordUnits = 0
    pendingSpaces = 0
    hasWord = false
  }
  for (const ch of text) {
    if (ch === ' ') {
      if (hasWord) {
        pendingSpaces += 1
      }
      continue
    }
    const cp = ch.codePointAt(0) ?? 0
    if (isWideCodePoint(cp)) {
      // CJK 单字是独立可断原子：先落前词
      flush()
      out.push({ units: measure(ch), trailingUnits: 0 })
      continue
    }
    // 词边界：空格后的新拉丁词另起原子（空格宽归属前词，换行时丢弃）
    if (pendingSpaces > 0 && hasWord) {
      flush()
    }
    hasWord = true
    wordUnits += measure(ch)
  }
  flush()
}

/** 东亚宽字符判定（与 tableColumnWidth 的启发式同口径，模块内复用避免循环导出） */
function isWideCodePoint(cp: number): boolean {
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

/** 单元格折行指标：可见分片（cellVisibleLines 同源）→ 逐行 token + 自然宽 */
export function cellWrapProfile(content: string, measure: CellWidthMeasurer = defaultCellWidthMeasurer): CellWrapProfile {
  const visibleLines = cellVisibleLines(content)
  const lines: WrapToken[][] = []
  let naturalUnits = 0
  for (const pieces of visibleLines) {
    const tokens: WrapToken[] = []
    for (const piece of pieces) {
      if (piece.kind === 'widget') {
        tokens.push({ units: TABLE_WIDGET_FALLBACK_UNITS, trailingUnits: 0 })
        continue
      }
      tokenizeText(piece.text, measure, tokens)
    }
    let lineUnits = 0
    for (const t of tokens) {
      lineUnits += t.units + t.trailingUnits
    }
    naturalUnits = Math.max(naturalUnits, lineUnits)
    lines.push(tokens)
  }
  return { lines, naturalUnits }
}

/**
 * 贪心折行行数（token 序列按宽度装行）：词边界优先；多字符 token 超宽时按
 * 宽度硬断（ceil(units/width) 行——格内 overflow-wrap: anywhere 近似）；
 * 单字符原子（≤2 单位）不可再分，超宽时独占一行（溢出而非断字）；行尾随
 * 空格在换行时丢弃；空 token 序列占一行。
 */
function countWrappedLines(tokens: readonly WrapToken[], widthUnits: number): number {
  if (tokens.length === 0) {
    return 1
  }
  if (!(widthUnits > 0)) {
    return tokens.length
  }
  const breakable = (t: WrapToken): boolean => t.units > widthUnits && t.units > 2
  const placeFresh = (t: WrapToken, lines: { n: number }): { cur: number; trail: number } => {
    if (breakable(t)) {
      const extra = Math.ceil(t.units / widthUnits) - 1
      lines.n += extra
      return { cur: t.units - extra * widthUnits + t.trailingUnits, trail: t.trailingUnits }
    }
    return { cur: t.units + t.trailingUnits, trail: t.trailingUnits }
  }
  const lines = { n: 1 }
  let placed = placeFresh(tokens[0]!, lines)
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i]!
    if (placed.cur + t.units <= widthUnits) {
      placed.cur += t.units + t.trailingUnits
      placed.trail = t.trailingUnits
      continue
    }
    lines.n += 1
    placed = placeFresh(t, lines)
  }
  return lines.n
}

/** 折行指标在某内容宽下的估算行数（含空段与空格占行语义） */
function profileLines(profile: CellWrapProfile, widthUnits: number): number {
  let total = 0
  for (const line of profile.lines) {
    total += countWrappedLines(line, widthUnits)
  }
  return Math.max(1, total)
}

/**
 * 单元格估算折行数（便捷入口，测试与调度层观测口径）：内容按可见口径
 * 分片（br 分段 / 标记剥离 / widget 回退）后贪心折行。
 */
export function estimateCellLines(
  content: string,
  widthUnits: number,
  options: { measure?: CellWidthMeasurer } = {},
): number {
  return profileLines(cellWrapProfile(content, options.measure ?? defaultCellWidthMeasurer), widthUnits)
}

// ---- 评分模型 ----

/** 评分输入行：header 标记 + 逐列格文本（GFM 切格后的原始内容） */
export interface HeightRowInput {
  header: boolean
  cells: readonly string[]
}

/** 候选评分：total = 逐行最大折行数之和；headerLines / shortWrapLines 为同分决胜指标 */
export interface HeightCandidateScore {
  /** 整表估算高度（行数）：逐行各格最大值之和（含表头行） */
  total: number
  /** 表头各格行数之和（短表头优先单行） */
  headerLines: number
  /** 短标签（单行自然宽 ≤ TABLE_SHORT_LABEL_UNITS 的数据格）超一行部分之和 */
  shortWrapLines: number
  /** 第一列内容宽（度量单位）——决胜第三级（距基线变化）与第四级（字典序）用 */
  c1Units: number
}

/** 已 tokenize 的评分输入（调度层缓存逐行指标后零重 tokenize 评分） */
interface ProfiledRow {
  header: boolean
  profiles: CellWrapProfile[]
}

function profileRows(
  rows: readonly HeightRowInput[],
  measure: CellWidthMeasurer,
  cache?: Map<string, CellWrapProfile>,
): ProfiledRow[] {
  return rows.map((row) => ({
    header: row.header,
    profiles: row.cells.map((cell) => {
      if (cache) {
        const hit = cache.get(cell)
        if (hit) {
          return hit
        }
        const profile = cellWrapProfile(cell, measure)
        if (cache.size >= TABLE_OPT_CACHE_ROWS) {
          cache.clear()
        }
        cache.set(cell, profile)
        return profile
      }
      return cellWrapProfile(cell, measure)
    }),
  }))
}

/** 评分核心：两列内容宽（度量单位）下的整表评分（profile 零重 tokenize） */
function scoreProfiledRows(
  rows: readonly ProfiledRow[],
  s1Units: number,
  s2Units: number,
): Omit<HeightCandidateScore, 'c1Units'> {
  let total = 0
  let headerLines = 0
  let shortWrapLines = 0
  for (const row of rows) {
    let rowLines = 0
    for (let col = 0; col < row.profiles.length; col++) {
      const width = col === 0 ? s1Units : s2Units
      const lines = profileLines(row.profiles[col]!, width)
      if (row.header) {
        headerLines += lines
      } else if (row.profiles[col]!.naturalUnits <= TABLE_SHORT_LABEL_UNITS) {
        shortWrapLines += Math.max(0, lines - 1)
      }
      if (lines > rowLines) {
        rowLines = lines
      }
    }
    total += Math.max(1, rowLines)
  }
  return { total, headerLines, shortWrapLines }
}

/**
 * 两列切分的整表评分（测试口径入口）：s1Units 为第一列内容宽（度量单位），
 * totalUnits 为两列内容宽之和。逐行取各格最大折行数、含表头。
 */
export function scoreTwoColumnSplit(
  rows: readonly HeightRowInput[],
  s1Units: number,
  totalUnits: number,
  options: { measure?: CellWidthMeasurer } = {},
): HeightCandidateScore {
  const measure = options.measure ?? defaultCellWidthMeasurer
  const scored = scoreProfiledRows(profileRows(rows, measure), s1Units, totalUnits - s1Units)
  return { ...scored, c1Units: s1Units }
}

/**
 * 候选全序比较（同分决胜序）：① total 少者优 → ② headerLines+shortWrapLines
 * 少者优 → ③ 距轻量基线第一列宽（度量单位）的变化小者优 → ④ c1Units
 * 字典序小者优（保证全序确定：同输入同输出）。
 */
export function compareHeightScores(
  a: HeightCandidateScore,
  b: HeightCandidateScore,
  baselineC1Units: number,
): number {
  if (a.total !== b.total) {
    return a.total - b.total
  }
  const sa = a.headerLines + a.shortWrapLines
  const sb = b.headerLines + b.shortWrapLines
  if (sa !== sb) {
    return sa - sb
  }
  const da = Math.abs(a.c1Units - baselineC1Units)
  const db = Math.abs(b.c1Units - baselineC1Units)
  if (da !== db) {
    return da - db
  }
  return a.c1Units - b.c1Units
}

// ---- 轨道像素解析（CSS grid minmax(min, fr) 的确定性近似） ----

/**
 * 解析 minmax(floor, w fr) 轨道在可用宽 A 下的实际像素宽：fr 份额低于
 * 下限的轨道钉在下限并作为非弹性参与剩余分配（CSS Grid §12.7 迭代近似，
 * 两列 ≤ 2 轮）。确定性：同输入同输出。
 */
export function resolveTracksPx(
  weights: readonly number[],
  floors: readonly number[],
  availablePx: number,
): number[] {
  const n = weights.length
  const out = new Array<number>(n).fill(0)
  const fixed = new Array<boolean>(n).fill(false)
  let fixedTotal = 0
  let flexWeight = 0
  for (let i = 0; i < n; i++) {
    flexWeight += weights[i]!
  }
  for (let round = 0; round <= n; round++) {
    let clamped = false
    if (flexWeight > 0) {
      const fr = (availablePx - fixedTotal) / flexWeight
      for (let i = 0; i < n; i++) {
        if (fixed[i]) {
          continue
        }
        const share = weights[i]! * fr
        if (share < floors[i]!) {
          fixed[i] = true
          out[i] = floors[i]!
          fixedTotal += floors[i]!
          flexWeight -= weights[i]!
          clamped = true
        }
      }
    }
    if (!clamped || flexWeight <= 0) {
      if (flexWeight > 0) {
        const fr = (availablePx - fixedTotal) / flexWeight
        for (let i = 0; i < n; i++) {
          if (!fixed[i]) {
            out[i] = weights[i]! * fr
          }
        }
      } else {
        // 全部钉下限：等分余量给未钉轨道（权重 0 的空列组不出现于两列场景）
        const free = availablePx - fixedTotal
        const rest = fixed.filter((f) => !f).length
        for (let i = 0; i < n; i++) {
          if (!fixed[i]) {
            out[i] = rest > 0 ? free / rest : floors[i]!
          }
        }
      }
      return out
    }
  }
  return out
}

// ---- 两列有界搜索 ----

export interface TableHeightOptimizeInput {
  /** 表头与数据行（含表头；调度层按解析树行身份构造） */
  rows: readonly HeightRowInput[]
  /** 轻量计划的逐列最大样本（基线候选与锚点用；与 #142/#371 同口径） */
  samples: readonly number[]
  /** 度量输入：availablePx 必须有效（>0）才进入搜索 */
  readability: TableReadabilityInput
}

export interface TableHeightOptimizeResult {
  /** 最终轨道串（optimized=按高度优化的权重；baseline/degraded=轻量计划原样） */
  template: string
  /** optimized：搜索找到严格不劣且不同于基线的布局；baseline：无改进或输入受限；degraded：超预算降级 */
  origin: 'optimized' | 'baseline' | 'degraded'
  /** 赢家布局的整表估算行数（无搜索时为 0） */
  totalLines: number
  /** 轻量基线候选的整表估算行数（无搜索时为 0） */
  baselineLines: number
  /** 实际评估的候选数（去重后） */
  candidates: number
  /** 格折行估算次数（预算记账） */
  cellEvals: number
  /** 解析出的逐列像素宽（无效输入为 null） */
  widthsPx: number[] | null
}

export interface TableHeightOptimizeOptions {
  measure?: CellWidthMeasurer
  /** 逐格折行指标缓存（调度层持有；容量 TABLE_OPT_CACHE_ROWS 由写入侧约束） */
  tokenCache?: Map<string, CellWrapProfile>
}

/** 数值规整输出：去多余小数尾零（与 tableColumnWidth 的 formatNumber 同精度） */
function formatNumber(value: number): string {
  const fixed = value.toFixed(3).replace(/(\.\d*?)0+$/, '$1')
  return fixed.endsWith('.') ? fixed.slice(0, -1) : fixed
}

/**
 * 两列表格整表高度优化（粗搜 + 内容锚点 + 基线 + 细搜的有界候选集）。
 * 三列及以上、缺有效度量或超预算时返回轻量计划（T03 前的边界）。
 */
export function optimizeTwoColumnTable(
  input: TableHeightOptimizeInput,
  options: TableHeightOptimizeOptions = {},
): TableHeightOptimizeResult {
  const { rows, samples, readability } = input
  const measure = options.measure ?? defaultCellWidthMeasurer
  const baselineTemplate = tableGridTemplate(samples, { readability })
  const baselineOnly = (widthsPx: number[] | null): TableHeightOptimizeResult => ({
    template: baselineTemplate,
    origin: 'baseline',
    totalLines: 0,
    baselineLines: 0,
    candidates: 0,
    cellEvals: 0,
    widthsPx,
  })
  if (samples.length !== 2 || rows.length === 0) {
    return baselineOnly(null)
  }
  const validMetrics = Number.isFinite(readability.contentPx) && readability.contentPx > 0 &&
    Number.isFinite(readability.cellBoxPx) && readability.cellBoxPx >= 0 &&
    Number.isFinite(readability.availablePx) && readability.availablePx! > 0
  if (!validMetrics) {
    return baselineOnly(null)
  }
  // 预算预检：行 × 列 × 候选上限超预算 → 降级（不跑搜索、不反复重试）
  const estimatedEvals = rows.length * samples.length * TABLE_OPT_MAX_CANDIDATES
  if (estimatedEvals > TABLE_OPT_MAX_CELL_EVALS) {
    return {
      template: baselineTemplate,
      origin: 'degraded',
      totalLines: 0,
      baselineLines: 0,
      candidates: 0,
      cellEvals: 0,
      widthsPx: null,
    }
  }

  const availablePx = readability.availablePx!
  const cellBoxPx = readability.cellBoxPx
  const unitPx = readability.contentPx / 6
  const floorPx = effectiveColumnFloorPx(2, readability)
  const lo = floorPx
  const hi = availablePx - floorPx
  if (!(hi >= lo - 1e-6)) {
    return baselineOnly(resolveTracksPx(
      samples.map((s) => s + TABLE_WEIGHT_PADDING_UNITS),
      [floorPx, floorPx],
      availablePx,
    ))
  }

  const profiled = profileRows(rows, measure, options.tokenCache)
  const cellEvals = { count: 0 }
  const evalAt = (c1Px: number): { score: HeightCandidateScore; c1Px: number } => {
    // 评分宽带安全系数收缩（刀口宽度悲观化）；决胜第三级的基线距离仍用原始宽
    const s1Units = ((c1Px - cellBoxPx) / unitPx) * TABLE_OPT_WRAP_SAFETY
    const s2Units = ((availablePx - c1Px - cellBoxPx) / unitPx) * TABLE_OPT_WRAP_SAFETY
    const scored = scoreProfiledRows(profiled, s1Units, s2Units)
    cellEvals.count += rows.length * samples.length
    return { score: { ...scored, c1Units: s1Units }, c1Px }
  }

  // 基线候选（当前轻量分配的像素解析——CSS minmax 迭代近似）
  const baselineWeights = samples.map((s) => Math.max(0, s) + TABLE_WEIGHT_PADDING_UNITS)
  const baselineWidths = resolveTracksPx(baselineWeights, [floorPx, floorPx], availablePx)
  const baselineC1Px = baselineWidths[0]!
  const baselineC1Units = (baselineC1Px - cellBoxPx) / unitPx

  // 候选集：粗搜 + 内容锚点（各列单行宽）+ 基线；细搜围绕当前最优
  const seen = new Set<number>()
  const tryCandidate = (px: number, list: Array<{ score: HeightCandidateScore; c1Px: number }>): void => {
    const clamped = Math.min(hi, Math.max(lo, px))
    const key = Math.round(clamped * 1e6)
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    list.push(evalAt(clamped))
  }
  const coarseStep = (hi - lo) / (TABLE_OPT_COARSE_POINTS - 1)
  const evaluated: Array<{ score: HeightCandidateScore; c1Px: number }> = []
  for (let i = 0; i < TABLE_OPT_COARSE_POINTS; i++) {
    tryCandidate(lo + coarseStep * i, evaluated)
  }
  const anchor1 = samples[0]! * unitPx + cellBoxPx
  const anchor2 = availablePx - (samples[1]! * unitPx + cellBoxPx)
  tryCandidate(anchor1, evaluated)
  tryCandidate(anchor2, evaluated)
  tryCandidate(baselineC1Px, evaluated)

  let best = evaluated[0]!
  for (const cand of evaluated) {
    if (compareHeightScores(cand.score, best.score, baselineC1Units) < 0) {
      best = cand
    }
  }
  // 细搜：最优点两侧各 TABLE_OPT_FINE_POINTS/2 个半步点（局部模式搜索，
  // best 随发现前移——确定性：同输入同候选序）
  const fineStep = coarseStep / 2
  for (let k = 1; k <= TABLE_OPT_FINE_POINTS / 2; k++) {
    for (const offset of [-k, k]) {
      if (evaluated.length >= TABLE_OPT_MAX_CANDIDATES) {
        break
      }
      const lengthBefore = evaluated.length
      tryCandidate(best.c1Px + fineStep * offset, evaluated)
      if (evaluated.length > lengthBefore) {
        const added = evaluated[evaluated.length - 1]!
        if (compareHeightScores(added.score, best.score, baselineC1Units) < 0) {
          best = added
        }
      }
    }
  }

  // 不劣于基线（基线在候选集内）且与基线重合（±0.5px）时不发布：返回轻量
  // 模板原样（字节相同 → 行装饰键不变 → 零重绘）
  const baselineCand = evaluated.find((c) => Math.abs(c.c1Px - baselineC1Px) < 1e-6)
  const baselineLines = baselineCand?.score.total ?? 0
  if (Math.abs(best.c1Px - baselineC1Px) <= 0.5) {
    return {
      template: baselineTemplate,
      origin: 'baseline',
      totalLines: best.score.total,
      baselineLines,
      candidates: evaluated.length,
      cellEvals: cellEvals.count,
      widthsPx: baselineWidths,
    }
  }
  const c1 = Math.min(hi, Math.max(lo, best.c1Px))
  const c2 = availablePx - c1
  const template = `minmax(min(${formatNumber(floorPx)}px, ${formatNumber(50)}%), ${formatNumber(c1)}fr) ` +
    `minmax(min(${formatNumber(floorPx)}px, ${formatNumber(50)}%), ${formatNumber(c2)}fr)`
  return {
    template,
    origin: 'optimized',
    totalLines: best.score.total,
    baselineLines,
    candidates: evaluated.length,
    cellEvals: cellEvals.count,
    widthsPx: [c1, c2],
  }
}

// ---- 观测口（千行表预算契约同族：差分断言，不提供重置） ----

/** #372 调度层统计：searches=完整搜索次数；publishes=实际应用次数（效果
 *  验证通过）；discards=迟到/无效载荷丢弃；cellEvals/candidates=预算记账 */
const optimizeStats = { searches: 0, publishes: 0, discards: 0, cellEvals: 0, candidates: 0 }

export function getTableOptimizeStats(): Readonly<typeof optimizeStats> {
  return { ...optimizeStats }
}

/** 完整搜索记账（调度层每次调用 optimizeTwoColumnTable 后上报） */
export function noteTableOptimizeSearch(cellEvals: number, candidates: number): void {
  optimizeStats.searches += 1
  optimizeStats.cellEvals += cellEvals
  optimizeStats.candidates = Math.max(optimizeStats.candidates, candidates)
}

/** 发布成功记账（liveDecorations 应用效果时上报） */
export function noteTableOptimizePublish(): void {
  optimizeStats.publishes += 1
}

/** 载荷丢弃记账（验证失败路径上报） */
export function noteTableOptimizeDiscard(): void {
  optimizeStats.discards += 1
}

/**
 * 度量签名（发布载荷的验证字段）：contentPx/cellBoxPx 捕捉字体族与字号
 * （探针实测「三汉字」宽随两者变化），availablePx 捕捉容器净宽。
 */
export function tableMetricsSig(metrics: TableReadabilityInput): string {
  return `${metrics.contentPx}|${metrics.cellBoxPx}|${metrics.availablePx ?? ''}`
}

// ---- 发布通道（效果定义；liveDecorations 字段验证后应用） ----

/** 高度计划发布载荷：调度层验证后携带，字段 update 逐一复核（过期即丢弃） */
export interface TableHeightPlanPayload {
  /** Table 树节点 from（文档位置——表格身份） */
  tableFrom: number
  /** 调度时的文档引用（应用前必须仍等于当前 doc——区间迁移即过期） */
  doc: Text
  /** 列数（列数变化即过期） */
  columns: number
  /** 调度时的度量签名（contentPx/cellBoxPx/availablePx——度量变化即过期） */
  metricsSig: string
  /** 优化后的 grid-template-columns 值 */
  template: string
}

/** 应用表格高度计划：liveDecorationsField 消费（验证身份/版本/列数/度量） */
export const applyTableHeightPlan = StateEffect.define<TableHeightPlanPayload>()
