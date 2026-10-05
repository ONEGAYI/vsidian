// #372 两列表格整表高度优化：纯规划层契约（评分 / 折行估算 / 有界搜索 / 预算）。
//
// 输入约定（与 tableColumnWidth.test.ts 同族）：
// - 度量默认等价字符宽度启发式（CJK 计 2、ASCII 计 1）；单元格内容为 GFM
//   切格后的原始内容（含 `<br>` / 转义管道 / 行内代码 / 双链等标记语义）。
// - readability 采用 contentPx = 60（三个 CJK 汉字 × 2 单位 → unitPx = 10）、
//   cellBoxPx = 0、availablePx = 340 的受控输入——内容宽度单位总量 34，
//   便于手推折行数（下文各用例的期望值均由该组常量手算得出）。
import { describe, expect, it } from 'vitest'
import {
  TABLE_OPT_MAX_CANDIDATES,
  TABLE_OPT_MAX_CANDIDATES_MULTI,
  TABLE_OPT_MAX_CELL_EVALS,
  TABLE_OPT_MAX_COLUMNS,
  compareHeightScores,
  estimateCellLines,
  optimizeTableHeight,
  optimizeTwoColumnTable,
  scoreTwoColumnSplit,
  type HeightCandidateScore,
  type HeightRowInput,
} from '../../src/webview/tableHeightPlan'
import { tableGridTemplate } from '../../src/webview/tableColumnWidth'

/** 受控度量输入：unitPx = 10（contentPx 60 = 三汉字 × 2 单位），格盒占位 0 */
const METRICS = { contentPx: 60, cellBoxPx: 0, availablePx: 340 }
/** 内容宽度单位总量（(340 − 2×0) / 10） */
const S = 34
/** CJK 重复器：n 个汉字 = 2n 单位 */
const cjk = (n: number): string => '汉'.repeat(n)

describe('#372 折行估算（estimateCellLines）', () => {
  it('中文：任意字符间可断（贪心逐字装行，字符不可再分）', () => {
    expect(estimateCellLines(cjk(10), 6)).toBe(4) // 每行 3 字（6u），10 字 → 4 行
    expect(estimateCellLines(cjk(10), 8)).toBe(3) // 每行 4 字（8u），10 字 → 3 行
    // 宽 7u：每行仍只装 3 字（第 4 字 2u 放不下）→ 4 行（不是 ceil(20/7)=3）
    expect(estimateCellLines(cjk(10), 7)).toBe(4)
  })

  it('英文：词间断行而非任意字符断行', () => {
    // 三个 word（各 4u）+ 两空格 = 14u：宽 8 时按词断为 3 行，按字符断为 2 行
    expect(estimateCellLines('word word word', 8)).toBe(3)
    // 宽 9：word+空格+word = 9u 恰好同行 → 2 行
    expect(estimateCellLines('word word word', 9)).toBe(2)
  })

  it('混排：CJK 单字成断点、拉丁串按词', () => {
    // tokens 汉(2) a(1) 汉(2) b(1)：宽 4 → 「汉a」+「汉b」两行
    expect(estimateCellLines('汉a汉b', 4)).toBe(2)
  })

  it('行内代码：反引号剔除、内容按词断；超长无空格串按宽度硬断', () => {
    // 代码 span 内容 "code code"（8u + 空格）：宽 5 → 2 行（词断）
    expect(estimateCellLines('`code code`', 5)).toBe(2)
    expect(estimateCellLines('`code code`', 10)).toBe(1)
    // 无空格长串（8u）> 宽 4 → ceil(8/4) = 2 行（overflow-wrap: anywhere 近似）
    expect(estimateCellLines('`aaaaaaaa`', 4)).toBe(2)
  })

  it('空格：行尾空格不提前折行', () => {
    expect(estimateCellLines('aaa   ', 3)).toBe(1)
    // "a a a"：宽 3 → 「a a」+「a」两行（空格随前词，不独占行）
    expect(estimateCellLines('a a a', 3)).toBe(2)
  })

  it('裸 <br>：显式行；连续 br 产生空行；空格单元格占一行', () => {
    expect(estimateCellLines('aaaa<br>bbbb', 10)).toBe(2) // 两段各单行
    expect(estimateCellLines('a<br><br>b', 10)).toBe(3)
    expect(estimateCellLines('', 10)).toBe(1)
    expect(estimateCellLines('   ', 10)).toBe(1)
    // 窄宽下段内继续硬断：4u 词在宽 2u → 各段 2 行，共 4 行
    expect(estimateCellLines('aaaa<br>bbbb', 2)).toBe(4)
  })

  it('br 分段与自然折行叠加：分段内继续按宽度折', () => {
    // 段1 "aaaa"（4u）宽 4 → 1 行；段2 "bb bb"（5u）宽 4 → 2 行 → 共 3 行
    expect(estimateCellLines('aaaa<br>bb bb', 4)).toBe(3)
  })

  it('双链别名/markdown 链接按可见文字折行（隐藏目标不计宽）', () => {
    // [[长目标路径|别名]] 只见「别名」（2 CJK = 4u）：宽 4 单行
    expect(estimateCellLines('[[很长的目标路径|别名]]', 4)).toBe(1)
    expect(estimateCellLines('[文字](https://example.com/a/very/long/url)', 4)).toBe(1)
  })

  it('嵌入/图片/公式按 widget 有界回退宽参与折行', () => {
    // ![[嵌入]] = 6u 回退 + 2 CJK = 10u：宽 6 → 2 行
    expect(estimateCellLines(`![[目标]]${cjk(1)}`, 6)).toBe(2)
  })
})

describe('#372 整表评分（scoreTwoColumnSplit / compareHeightScores）', () => {
  /** 评分反例表：表头短（各 1 行），数据行 A=50 汉字（100u）、B=4 汉字（8u）。
   * 评分函数是纯数学（不夹 T01 下限——候选合法性另由下限用例钉住） */
  const counterExample: HeightRowInput[] = [
    { header: true, cells: [cjk(1), cjk(1)] },
    { header: false, cells: [cjk(50), cjk(4)] },
  ]

  it('评分反例：每行高度取各格最大值，而非格行数相加（6/1 vs 4/4）', () => {
    // s1=18：A 每行 9 字 → 6 行；B（4 字）在 16u 宽单行 → 行高 6（格行数和为 7）
    const wide = scoreTwoColumnSplit(counterExample, 18, S)
    // s1=32：A 每行 16 字 → 4 行；B 在 2u 宽逐字 4 行 → 行高 4（格行数和为 8）
    const balanced = scoreTwoColumnSplit(counterExample, 32, S)
    expect(wide.total).toBe(6 + 1) // 数据行 6 + 表头 1
    expect(balanced.total).toBe(4 + 1)
    // 按格行数相加的错序：7 < 8 会偏好 6/1；按行最大值：4 < 6 偏好 4/4
    expect(compareHeightScores(balanced, wide, 0)).toBeLessThan(0)
  })

  it('统一行高时等价逐行最大折行数之和：多行表按行取 max 后累加', () => {
    const rows: HeightRowInput[] = [
      { header: true, cells: [cjk(1), cjk(1)] },
      { header: false, cells: [cjk(10), cjk(1)] }, // 宽 10：2 行 / 1 行 → 2
      { header: false, cells: [cjk(1), cjk(7)] },  // 1 行 / ceil(14/24)=1 → 1
    ]
    const score = scoreTwoColumnSplit(rows, 10, S)
    expect(score.total).toBe(1 + 2 + 1)
  })

  it('同分决胜一：先减少表头折行', () => {
    // 表头 A=16u、B=2u；d3 的 B=20u 在宽侧不折——两分法总分相同（5），
    // s=17 表头 1 行、s=10 表头 2 行 → 偏好 s=17
    const rows: HeightRowInput[] = [
      { header: true, cells: [cjk(8), cjk(1)] }, // 16u / 2u
      { header: false, cells: [cjk(1), cjk(1)] },
      { header: false, cells: [cjk(1), cjk(1)] },
      { header: false, cells: [cjk(1), cjk(10)] }, // B=20u：s=17 → 2 行；s=10 → 1 行
    ]
    const at17 = scoreTwoColumnSplit(rows, 17, S)
    const at10 = scoreTwoColumnSplit(rows, 10, S)
    expect(at17.total).toBe(5)
    expect(at10.total).toBe(5)
    expect(at17.headerLines).toBe(2)
    expect(at10.headerLines).toBe(3)
    expect(compareHeightScores(at17, at10, 0)).toBeLessThan(0)
  })

  it('同分决胜二：表头相同再减少相对基线的变化', () => {
    // 镜像表（header 2u/2u，d1 18u/18u）：s=12 与 s=20 总分同（3）、表头同（1）
    const rows: HeightRowInput[] = [
      { header: true, cells: [cjk(1), cjk(1)] },
      { header: false, cells: [cjk(9), cjk(9)] },
    ]
    const at12 = scoreTwoColumnSplit(rows, 12, S)
    const at20 = scoreTwoColumnSplit(rows, 20, S)
    expect(at12.total).toBe(3)
    expect(at20.total).toBe(3)
    // 基线 s=17（c1=170px）：|200−170| = 30 < |120−170| = 50 → 偏好 s=20（c1=200px）
    expect(compareHeightScores(at20, at12, 17)).toBeLessThan(0)
  })

  it('同分决胜三：仍同分时按确定性次序（列宽字典序，小者胜出）', () => {
    const rows: HeightRowInput[] = [
      { header: true, cells: [cjk(1), cjk(1)] },
      { header: false, cells: [cjk(9), cjk(9)] },
    ]
    const a = scoreTwoColumnSplit(rows, 12, S)
    const b = scoreTwoColumnSplit(rows, 22, S)
    // 镜像候选（12/22 对基线 17 等距）总分与表头相同 → 末级按 c1 取小
    expect(compareHeightScores(a, b, 17)).toBeLessThan(0)
    expect(compareHeightScores(b, a, 17)).toBeGreaterThan(0)
  })
})

describe('#372 两列有界搜索（optimizeTwoColumnTable）', () => {
  /** 基线可改进表：d1 A=88u/B=10u，d2 A=2u/B=16u——基线（s≈27.9）把宽度
   * 过度分给 A 列，d1/d2 的 B 列都多折；最优（s≈22.5 附近）B 列少折一行 */
  const improvable: HeightRowInput[] = [
    { header: true, cells: [cjk(1), cjk(1)] },
    { header: false, cells: [cjk(44), cjk(5)] },
    { header: false, cells: [cjk(1), cjk(8)] },
  ]
  const samplesOf = (rows: HeightRowInput[], n: number): number[] => {
    const out = new Array<number>(n).fill(0)
    for (const r of rows) {
      for (let c = 0; c < n; c++) {
        const w = [...r.cells[c]!].reduce((acc, ch) => acc + (/[\u4e00-\u9fff]/.test(ch) ? 2 : 1), 0)
        out[c] = Math.max(out[c]!, w)
      }
    }
    return out
  }

  it('含轻量基线候选且不劣于基线：可改进表优化后总分更低', () => {
    const result = optimizeTwoColumnTable({
      rows: improvable,
      samples: samplesOf(improvable, 2),
      readability: METRICS,
    })
    // 基线（样本 88/16 → 权重占比）s1≈27.9：评分含 TABLE_OPT_WRAP_SAFETY
    // 收缩（B 列 2 字/行）→ 总分 9；最优（s1≈22.5 粗搜点附近）d1 B 单行、
    // d2 B 折 2 → 总分 7
    expect(result.baselineLines).toBe(9)
    expect(result.totalLines).toBeLessThanOrEqual(result.baselineLines)
    expect(result.totalLines).toBe(7)
    expect(result.origin).toBe('optimized')
    expect(result.template).toMatch(/^minmax\(min\(/)
  })

  it('候选集受预算约束：候选数与格评估量不超上限', () => {
    const result = optimizeTwoColumnTable({
      rows: improvable,
      samples: samplesOf(improvable, 2),
      readability: METRICS,
    })
    expect(result.candidates).toBeLessThanOrEqual(TABLE_OPT_MAX_CANDIDATES)
    expect(result.candidates).toBeGreaterThanOrEqual(3) // 粗搜 + 锚点 + 基线
    expect(result.cellEvals).toBeLessThanOrEqual(TABLE_OPT_MAX_CELL_EVALS)
  })

  it('确定性：同输入产出逐字节相同的模板（两次调用一致）', () => {
    const input = {
      rows: improvable,
      samples: samplesOf(improvable, 2),
      readability: METRICS,
    }
    expect(optimizeTwoColumnTable(input).template)
      .toBe(optimizeTwoColumnTable(input).template)
  })

  it('T01 下限约束保持：两列宽均不小于有效可读下限（px）', () => {
    const result = optimizeTwoColumnTable({
      rows: improvable,
      samples: samplesOf(improvable, 2),
      readability: METRICS,
    })
    const floorPx = METRICS.contentPx + METRICS.cellBoxPx
    expect(result.widthsPx?.[0]).toBeGreaterThanOrEqual(floorPx - 0.5)
    expect(result.widthsPx?.[1]).toBeGreaterThanOrEqual(floorPx - 0.5)
    expect(result.widthsPx?.[0]! + result.widthsPx?.[1]!).toBeLessThanOrEqual(METRICS.availablePx + 0.5)
  })

  it('窄容器：各列下限之和超可用宽时按比例收缩，总宽不超网格', () => {
    const narrow = { contentPx: 60, cellBoxPx: 0, availablePx: 100 } // 下限和 120 > 100
    const result = optimizeTwoColumnTable({
      rows: improvable,
      samples: samplesOf(improvable, 2),
      readability: narrow,
    })
    expect(result.widthsPx?.[0]).toBeGreaterThanOrEqual(50 - 0.5) // 60 × 100/120
    expect(result.widthsPx?.[1]).toBeGreaterThanOrEqual(50 - 0.5)
    expect(result.widthsPx?.[0]! + result.widthsPx?.[1]!).toBeLessThanOrEqual(100.5)
  })

  it('无改进时不发布：与基线同分的赢家返回基线模板（字节相同，零重绘）', () => {
    // 短表：基线即最优（各格单行）→ origin=baseline、模板与 #142/#371 轻量计划一致
    const tiny: HeightRowInput[] = [
      { header: true, cells: [cjk(1), cjk(1)] },
      { header: false, cells: [cjk(2), cjk(2)] },
    ]
    const samples = samplesOf(tiny, 2)
    const result = optimizeTwoColumnTable({ rows: tiny, samples, readability: METRICS })
    expect(result.origin).toBe('baseline')
    expect(result.template).toBe(tableGridTemplate(samples, { readability: METRICS }))
  })

  it('三列及以上不走两列搜索（T03 前保持轻量计划）', () => {
    const rows: HeightRowInput[] = [
      { header: true, cells: [cjk(1), cjk(1), cjk(1)] },
      { header: false, cells: [cjk(2), cjk(2), cjk(2)] },
    ]
    const result = optimizeTwoColumnTable({
      rows,
      samples: samplesOf(rows, 3),
      readability: METRICS,
    })
    expect(result.origin).toBe('baseline')
    expect(result.candidates).toBe(0)
  })

  it('缺 availablePx 或无效度量：不搜索，回落轻量基线', () => {
    const rows: HeightRowInput[] = [
      { header: true, cells: [cjk(1), cjk(1)] },
      { header: false, cells: [cjk(30), cjk(5)] },
    ]
    const samples = samplesOf(rows, 2)
    for (const readability of [
      { contentPx: 60, cellBoxPx: 0 },
      { contentPx: 60, cellBoxPx: 0, availablePx: 0 },
      { contentPx: 0, cellBoxPx: 0, availablePx: 340 },
    ]) {
      const result = optimizeTwoColumnTable({ rows, samples, readability })
      expect(result.origin).toBe('baseline')
      expect(result.candidates).toBe(0)
    }
  })

  it('预算耗尽降级：大表保留轻量计划，评估量有界', () => {
    // 601 行 × 2 格 × ≤24 候选 > 20000 评估上限 → 降级（不跑搜索）
    const big: HeightRowInput[] = [
      { header: true, cells: [cjk(1), cjk(1)] },
      ...Array.from({ length: 600 }, () => ({
        header: false,
        cells: [cjk(2), cjk(2)] as string[],
      })),
    ]
    const samples = samplesOf(big, 2)
    const result = optimizeTwoColumnTable({ rows: big, samples, readability: METRICS })
    expect(result.origin).toBe('degraded')
    expect(result.template).toBe(tableGridTemplate(samples, { readability: METRICS }))
    expect(result.cellEvals).toBeLessThanOrEqual(TABLE_OPT_MAX_CELL_EVALS)
    expect(result.candidates).toBe(0)
  })
})


// ---- #373 多列表格高度优化（纯规划层契约） ----

describe('#373 多列高度优化（optimizeTableHeight）', () => {
  const cjk = (n: number): string => '汉'.repeat(n)
  /** 逐列最大样本（与调度层 collectColumnSamples 同口径：宽字符计 2） */
  const samplesOf = (rows: HeightRowInput[], n: number): number[] => {
    const out = new Array<number>(n).fill(0)
    for (const r of rows) {
      for (let c = 0; c < n; c++) {
        const w = [...r.cells[c]!].reduce((acc, ch) => acc + (/[\u4e00-\u9fff]/.test(ch) ? 2 : 1), 0)
        out[c] = Math.max(out[c]!, w)
      }
    }
    return out
  }

  /**
   * 三列可改进表（冻结样例）：列 1 全部为六字短标签（12u），列 2/3 各有
   * 一个 30 字长段落交替驱动行高，末行全短。轻量基线（样本 12/60/60 →
   * 下限钉 60px + 长列均分 140/140）下短标签列 3 行/行，全短行被拉到 3 行；
   * 把列 1 拓宽到单行宽（≈122.4px）后整表估算高度 16 → 14（严格下降）。
   */
  const multi3: HeightRowInput[] = [
    { header: true, cells: [cjk(6), cjk(2), cjk(2)] },
    { header: false, cells: [cjk(6), cjk(30), cjk(1)] },
    { header: false, cells: [cjk(6), cjk(1), cjk(30)] },
    { header: false, cells: [cjk(6), cjk(1), cjk(1)] },
  ]

  it('三列：含轻量基线且严格不劣——可改进表优化后总分更低', () => {
    const result = optimizeTableHeight({
      rows: multi3,
      samples: samplesOf(multi3, 3),
      readability: METRICS,
    })
    expect(result.origin).toBe('optimized')
    expect(result.baselineLines).toBe(16)
    expect(result.totalLines).toBe(14)
    expect(result.totalLines).toBeLessThanOrEqual(result.baselineLines)
    // 模板形态：三段 minmax（保底 = T01 有效下限 60px，份额 = 100/3 向下 3 位）
    expect(result.template)
      .toMatch(/^minmax\(min\(60px, 33\.333%\), [\d.]+fr\) minmax\(min\(60px, 33\.333%\), [\d.]+fr\) minmax\(min\(60px, 33\.333%\), [\d.]+fr\)$/)
  })

  it('三列：列宽满足 T01 下限且总和不超网格', () => {
    const result = optimizeTableHeight({
      rows: multi3,
      samples: samplesOf(multi3, 3),
      readability: METRICS,
    })
    const floorPx = METRICS.contentPx + METRICS.cellBoxPx
    expect(result.widthsPx).not.toBeNull()
    for (const w of result.widthsPx!) {
      expect(Number.isFinite(w)).toBe(true)
      expect(w).toBeGreaterThanOrEqual(floorPx - 0.5)
    }
    const sum = result.widthsPx!.reduce((s, v) => s + v, 0)
    expect(sum).toBeLessThanOrEqual(METRICS.availablePx! + 0.5)
    expect(sum).toBeGreaterThanOrEqual(METRICS.availablePx! - 0.5)
  })

  it('候选与评估受集中预算约束：三列候选 ≤32、评估 = 候选×行×列', () => {
    const result = optimizeTableHeight({
      rows: multi3,
      samples: samplesOf(multi3, 3),
      readability: METRICS,
    })
    expect(result.candidates).toBeGreaterThanOrEqual(4) // 基线 + 等分 + 内容锚点
    expect(result.candidates).toBeLessThanOrEqual(TABLE_OPT_MAX_CANDIDATES_MULTI)
    expect(result.candidates).toBeLessThanOrEqual(TABLE_OPT_MAX_CANDIDATES)
    expect(result.cellEvals).toBe(result.candidates * multi3.length * 3)
    expect(result.cellEvals).toBeLessThanOrEqual(TABLE_OPT_MAX_CELL_EVALS)
  })

  it('六列：确定性与不劣于基线（同输入同预算逐字节相同）', () => {
    const rows: HeightRowInput[] = [
      { header: true, cells: [cjk(6), cjk(2), cjk(2), cjk(2), cjk(2), cjk(2)] },
      { header: false, cells: [cjk(6), cjk(30), cjk(1), cjk(20), cjk(1), cjk(1)] },
      { header: false, cells: [cjk(6), cjk(1), cjk(30), cjk(1), cjk(20), cjk(1)] },
      { header: false, cells: [cjk(6), cjk(1), cjk(1), cjk(1), cjk(1), cjk(1)] },
    ]
    const samples = samplesOf(rows, 6)
    const input = { rows, samples, readability: METRICS }
    const first = optimizeTableHeight(input)
    const second = optimizeTableHeight(input)
    expect(first.template).toBe(second.template)
    expect(first.candidates).toBe(second.candidates)
    expect(['optimized', 'baseline']).toContain(first.origin)
    if (first.widthsPx) {
      for (const w of first.widthsPx) {
        expect(Number.isFinite(w)).toBe(true)
        expect(w).toBeGreaterThan(0)
      }
      const sum = first.widthsPx.reduce((s, v) => s + v, 0)
      expect(sum).toBeLessThanOrEqual(METRICS.availablePx! + 0.5)
    }
    // 不劣于基线：基线在候选集内，赢家总分不高于基线
    expect(first.totalLines).toBeLessThanOrEqual(first.baselineLines)
  })

  it('两列表经统一入口走既有两列搜索（结果与 optimizeTwoColumnTable 逐字节一致）', () => {
    const rows: HeightRowInput[] = [
      { header: true, cells: [cjk(1), cjk(1)] },
      { header: false, cells: [cjk(44), cjk(5)] },
      { header: false, cells: [cjk(1), cjk(8)] },
    ]
    const samples = samplesOf(rows, 2)
    const viaUnified = optimizeTableHeight({ rows, samples, readability: METRICS })
    const viaTwoColumn = optimizeTwoColumnTable({ rows, samples, readability: METRICS })
    expect(viaUnified.template).toBe(viaTwoColumn.template)
    expect(viaUnified.origin).toBe(viaTwoColumn.origin)
    expect(viaUnified.candidates).toBe(viaTwoColumn.candidates)
  })

  it('空列与空表头：无 NaN/负宽/裁切撑破；恢复空间后恢复常规可读下限', () => {
    const rows: HeightRowInput[] = [
      { header: true, cells: ['', cjk(2), cjk(2)] },
      { header: false, cells: [cjk(6), cjk(30), cjk(1)] },
      { header: false, cells: [cjk(6), '', cjk(30)] },
    ]
    const samples = samplesOf(rows, 3)
    // 窄容器：三列下限和 180 > 100 → 按比例收缩（T01 口径）
    const narrow = { contentPx: 60, cellBoxPx: 0, availablePx: 100 }
    const narrowResult = optimizeTableHeight({ rows, samples, readability: narrow })
    expect(narrowResult.widthsPx).not.toBeNull()
    for (const w of narrowResult.widthsPx!) {
      expect(Number.isFinite(w)).toBe(true)
      expect(w).toBeGreaterThanOrEqual(100 / 3 - 0.5)
    }
    expect(narrowResult.widthsPx!.reduce((s, v) => s + v, 0)).toBeLessThanOrEqual(100.5)
    // 恢复宽容器：常规下限（60px）重新生效
    const wide = optimizeTableHeight({ rows, samples, readability: METRICS })
    for (const w of wide.widthsPx!) {
      expect(w).toBeGreaterThanOrEqual(60 - 0.5)
    }
  })

  it('预算三类输入均有确定结果：预算内 / 恰到预算 / 超预算', () => {
    const makeRows = (count: number): HeightRowInput[] => [
      { header: true, cells: [cjk(6), cjk(2), cjk(2), cjk(2), cjk(2)] },
      ...Array.from({ length: count - 1 }, (_v, i) => ({
        header: false,
        cells: [cjk(6), cjk(2 + (i % 3)), cjk(1), cjk(2), cjk(1)] as string[],
      })),
    ]
    const once = (count: number) => {
      const rows = makeRows(count)
      return optimizeTableHeight({ rows, samples: samplesOf(rows, 5), readability: METRICS })
    }
    // 预算内：125 行 × 5 列 × 32 = 20000 恰好不超 → 执行搜索（候选非零）
    const atLimit = once(125)
    expect(atLimit.origin).not.toBe('degraded')
    expect(atLimit.candidates).toBeGreaterThan(0)
    // 超预算：126 行 → 20160 > 20000 → 稳定降级（不跑搜索、评估为零）
    const over = once(126)
    expect(over.origin).toBe('degraded')
    expect(over.candidates).toBe(0)
    expect(over.cellEvals).toBe(0)
    // 确定性：同类输入两次调用结果一致
    expect(once(126).template).toBe(over.template)
  })

  it('千行表：确定降级到轻量计划（大表有界路径）', () => {
    const rows: HeightRowInput[] = [
      { header: true, cells: [cjk(6), cjk(2), cjk(2)] },
      ...Array.from({ length: 999 }, (_v, i) => ({
        header: false,
        cells: [cjk(6), cjk(2 + (i % 5)), cjk(1)] as string[],
      })),
    ]
    const samples = samplesOf(rows, 3)
    const result = optimizeTableHeight({ rows, samples, readability: METRICS })
    expect(result.origin).toBe('degraded')
    expect(result.template).toBe(tableGridTemplate(samples, { readability: METRICS }))
    expect(result.candidates).toBe(0)
    expect(result.cellEvals).toBe(0)
  })

  it('密集 br / 超长单元格 / 中英混排：结果确定且有界', () => {
    const rows: HeightRowInput[] = [
      { header: true, cells: ['label', '中文 mixed text', '备注'] },
      { header: false, cells: [cjk(6), 'a<br>b<br>c<br>d<br>e<br>f<br>g', 'x'.repeat(300)] },
      { header: false, cells: [cjk(6), `中文english混合${cjk(10)}段落`, cjk(3)] },
    ]
    const samples = samplesOf(rows, 3)
    const input = { rows, samples, readability: METRICS }
    const first = optimizeTableHeight(input)
    const second = optimizeTableHeight(input)
    expect(first.template).toBe(second.template)
    expect(first.candidates).toBeLessThanOrEqual(TABLE_OPT_MAX_CANDIDATES_MULTI)
    expect(first.cellEvals).toBeLessThanOrEqual(TABLE_OPT_MAX_CELL_EVALS)
    if (first.widthsPx) {
      for (const w of first.widthsPx) {
        expect(Number.isFinite(w)).toBe(true)
        expect(w).toBeGreaterThan(0)
        expect(w).toBeLessThanOrEqual(METRICS.availablePx! + 0.5)
      }
    }
  })

  it('列数超上限：直接走轻量计划（不搜索）', () => {
    const columns = TABLE_OPT_MAX_COLUMNS + 1
    const rows: HeightRowInput[] = [
      { header: true, cells: Array.from({ length: columns }, () => cjk(2)) },
      { header: false, cells: Array.from({ length: columns }, () => cjk(2)) },
    ]
    const samples = samplesOf(rows, columns)
    const result = optimizeTableHeight({ rows, samples, readability: METRICS })
    expect(result.origin).toBe('degraded')
    expect(result.template).toBe(tableGridTemplate(samples, { readability: METRICS }))
    expect(result.candidates).toBe(0)
  })

  it('同分决胜（多列分支）：先比距基线变化，再按列宽字典序', () => {
    const mk = (dist: number, widths: number[]): HeightCandidateScore => ({
      total: 10, headerLines: 3, shortWrapLines: 0, c1Units: 0,
      multi: { baselineDistPx: dist, widthsPx: widths },
    })
    const near = mk(10, [100, 120, 120])
    const far = mk(20, [110, 110, 120])
    expect(compareHeightScores(near, far, 0)).toBeLessThan(0)
    expect(compareHeightScores(far, near, 0)).toBeGreaterThan(0)
    // 距基线相同 → 列宽字典序（首差列小者胜）
    const lexSmall = mk(10, [100, 120, 120])
    const lexLarge = mk(10, [110, 110, 120])
    expect(compareHeightScores(lexSmall, lexLarge, 0)).toBeLessThan(0)
    expect(compareHeightScores(lexLarge, lexSmall, 0)).toBeGreaterThan(0)
    // 多列候选与两列候选混合比较时退回两列语义（multi 双侧才生效）
    const twoCol: HeightCandidateScore = { total: 9, headerLines: 3, shortWrapLines: 0, c1Units: 5 }
    expect(compareHeightScores(twoCol, near, 0)).toBeLessThan(0) // total 更小直接胜
  })
})
