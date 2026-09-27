// #142 Live 表格列宽内容比例分配：纯函数契约（规格 docs/specs/live-table-column-width.md）。
//
// 机制选型（工单记录）：度量 = 等价字符宽度启发式（宽字符计 2，可注入替换）；
// 分配 = CSS grid 原生 minmax(保底, fr)——fr 权重即内容占比、保底即最小列宽，
// 「总和恰为网格总宽」由 grid 对 fr 的解析承担（规格总宽 min(100%,880px) 不变），
// 不做像素级 JS 分配，容器宽度变化由 CSS 自动重解（无需 JS 重算）。
//
// 核心断言（用户可观察行为）：
// - 占比分配：fr 权重与内容宽度样本成比例（宽内容列宽于窄内容列）；
// - 最小下限：每列轨道保底 48px 且不超过等分份额（min(48px, N 分之一)，
//   任何容器宽度下保底合计不超总宽——不横向溢出）；
// - 极端列：超长内容不产生像素撑爆（fr 无绝对宽度）；空列权重只取保底加成；
// - 跨行一致：同一样本集产出相同轨道计划（同表各行内联同一字符串的前提）。
import { describe, expect, it } from 'vitest'
import {
  TABLE_MIN_COLUMN_PX,
  TABLE_WEIGHT_PADDING_UNITS,
  collectColumnSamples,
  defaultCellWidthMeasurer,
  planColumnTracks,
  tableGridTemplate,
} from '../../src/webview/tableColumnWidth'

/** 从轨道串解析权重（第 n 列的 Nfr 数值） */
function weightOf(track: string): number {
  const m = /([\d.]+)fr\)$/.exec(track)
  if (!m) throw new Error(`轨道无 fr 权重: ${track}`)
  return Number(m[1])
}

/** 从轨道串解析保底（min(48px, X%) 形态） */
function minOf(track: string): { px: number; share: number } {
  const m = /minmax\(min\((\d+)px,\s*([\d.]+)%\),/.exec(track)
  if (!m) throw new Error(`轨道无 minmax 保底: ${track}`)
  return { px: Number(m[1]), share: Number(m[2]) }
}

describe('默认度量（等价字符宽度启发式）', () => {
  it('宽字符（CJK 全角等）计 2、ASCII 计 1、空串为 0', () => {
    expect(defaultCellWidthMeasurer('')).toBe(0)
    expect(defaultCellWidthMeasurer('abc')).toBe(3)
    expect(defaultCellWidthMeasurer('中文')).toBe(4)
    expect(defaultCellWidthMeasurer('a中b')).toBe(4)
    // 全角标点与假名同为宽字符
    expect(defaultCellWidthMeasurer('，。')).toBe(4)
    expect(defaultCellWidthMeasurer('カナ')).toBe(4)
  })

  it('度量函数可注入：样本采集口径跟随注入的度量函数', () => {
    // 注入「ASCII 字符 ×10」度量：ab → 20、c → 10（planColumnTracks 只消费数值样本）
    const samples = collectColumnSamples(['| ab | c |'], 2, { measure: (text) => text.length * 10 })
    expect(samples).toEqual([20, 10])
  })
})

describe('列样本采集（collectColumnSamples）', () => {
  it('逐列取各单元格与表头的最大内容宽度', () => {
    // 列 0：max(2, 10, 1) = 10；列 1：max(30, 1, 5) = 30（默认度量即字符权重）
    const samples = collectColumnSamples([
      '| ab | xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx |',
      '| aaaaaaaaaa | x |',
      '| a | abcde |',
    ], 2)
    expect(samples).toEqual([10, 30])
  })

  it('GFM 对齐标记（分隔行）不参与：调用方只传表头与数据行', () => {
    // 分隔行文本形态（---）按约定不传入；传入同等形态验证其内容照常度量
    const samples = collectColumnSamples(['| --- | abc |'], 2)
    expect(samples).toEqual([3, 3])
  })

  it('转义管道按显示形态计（\\| 显示为 |，1 宽）', () => {
    // 内容 `a\|b` 显示为 `a|b`（反斜杠隐藏）→ 3 而非 4
    const samples = collectColumnSamples(['| a\\|b | c |'], 2)
    expect(samples[0]).toBe(3)
  })

  it('格内换行 <br> 按最宽视觉段计（宽松裸 br 才换行，带属性是字面文本）', () => {
    // `aaaaaaaaaa<br>bb` → 段 max(10, 2) = 10；`<br class="x">是`（带属性，
    // 字面文本 14 字符）→ 14 + 2 = 16；`<br />`（宽松自闭合）也是换行 → 段 max(0, 2) = 2
    const samples = collectColumnSamples([
      '| aaaaaaaaaa<br>bb | x |',
      '| <br class="x">是 | y |',
      '| <br />是 | z |',
    ], 2)
    expect(samples[0]).toBe(16)
  })

  it('空格占位与首尾空白不计入：取 trim 后内容', () => {
    const samples = collectColumnSamples(['|   | ab |'], 2)
    expect(samples).toEqual([0, 2])
  })

  it('行内代码内的管道不切分（GFM 语义，tableCells 同源）', () => {
    const samples = collectColumnSamples(['| `a|b` | c |'], 2)
    expect(samples).toEqual([5, 1])
  })
})

describe('轨道计划（planColumnTracks / tableGridTemplate）', () => {
  it('占比分配：fr 权重与「样本 + 保底加成」成比例（宽内容列宽于窄内容列）', () => {
    const tracks = planColumnTracks([10, 30])
    const p = TABLE_WEIGHT_PADDING_UNITS
    expect(weightOf(tracks[0]!) / weightOf(tracks[1]!)).toBeCloseTo((10 + p) / (30 + p), 5)
    // 保底加成为固定常数，不改变大小关系：样本大的列权重必然更大
    for (const [small, big] of [[1, 2], [5, 500], [0, 1]] as const) {
      const pair = planColumnTracks([small, big])
      expect(weightOf(pair[1]!)).toBeGreaterThan(weightOf(pair[0]!))
    }
  })

  it('最小下限：每列保底 48px，且保底份额合计不超 100%（任何容器宽不横向溢出）', () => {
    for (const n of [1, 2, 3, 6, 7, 12]) {
      const tracks = planColumnTracks(Array.from({ length: n }, () => 5))
      expect(tracks).toHaveLength(n)
      let shareSum = 0
      for (const track of tracks) {
        const min = minOf(track)
        expect(min.px).toBe(TABLE_MIN_COLUMN_PX)
        // 保底份额向下取整到 3 位小数，保证合计 ≤ 100%
        expect(min.share * 10000 - Math.floor(min.share * 10000)).toBeLessThan(1e-6)
        shareSum += min.share
      }
      expect(shareSum).toBeLessThanOrEqual(100 + 1e-9)
      expect(minOf(tracks[0]!).share).toBeGreaterThan(0)
    }
  })

  it('极端列：超长内容不产生绝对像素宽度（fr 相对量，折行由格内 pre-wrap 承担）', () => {
    const tracks = planColumnTracks([10000, 2])
    expect(tracks[0]!).not.toMatch(/\d{4,}px/)
    // 超长列权重仍占绝对主导
    expect(weightOf(tracks[0]!)).toBeGreaterThan(weightOf(tracks[1]!) * 100)
  })

  it('空列取最小列宽：权重只剩保底加成（fr 为 0 时轨道落在 minmax 保底）', () => {
    const tracks = planColumnTracks([0, 40])
    expect(weightOf(tracks[0]!)).toBe(TABLE_WEIGHT_PADDING_UNITS)
    expect(weightOf(tracks[1]!)).toBe(40 + TABLE_WEIGHT_PADDING_UNITS)
  })

  it('全空表头/全空表：各列权重相等（退化为等分观感）', () => {
    const tracks = planColumnTracks([0, 0, 0])
    const weights = tracks.map((t) => weightOf(t))
    expect(new Set(weights).size).toBe(1)
  })

  it('跨行一致：同一样本集产出逐字节相同的计划（纯函数确定性）', () => {
    const samples = [12, 3, 45]
    expect(tableGridTemplate(samples)).toBe(tableGridTemplate([...samples]))
    // 权重浮点噪声收敛：样本加成后按 3 位小数规整
    expect(tableGridTemplate([0.123456789, 1])).toBe(tableGridTemplate([0.123, 1]))
  })

  it('单列：份额 100%，长内容折行不撑破总宽', () => {
    const tracks = planColumnTracks([500])
    expect(tracks).toHaveLength(1)
    expect(minOf(tracks[0]!).share).toBe(100)
    expect(tracks[0]!).toBe('minmax(min(48px, 100%), 504fr)')
  })

  it('模板串是合法 grid-template-columns 值形态（空格分隔的轨道函数）', () => {
    const template = tableGridTemplate([10, 20, 30])
    const tracks = template.split(/(?=minmax\()/)
    expect(tracks).toHaveLength(3)
    for (const track of tracks) {
      expect(track.trim()).toMatch(/^minmax\(min\(\d+px,\s*[\d.]+%\),\s*[\d.]+fr\)$/)
    }
  })
})
