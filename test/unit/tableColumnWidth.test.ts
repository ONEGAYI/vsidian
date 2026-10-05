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
  TABLE_WIDGET_FALLBACK_UNITS,
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

/** 从轨道串解析保底（min(48px, X%) 形态；#371 起 px 可为小数） */
function minOf(track: string): { px: number; share: number } {
  const m = /minmax\(min\(([\d.]+)px,\s*([\d.]+)%\),/.exec(track)
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

  it('行内代码内的管道不切分（GFM 语义，tableCells 同源），反引号按隐藏计（#371 对齐 CodeMark 隐藏呈现）', () => {
    // 管道仍在代码 span 内不切列；Live 呈现上 CodeMark 反引号隐藏
    // （liveDecorations CodeMark case），可见文字是 `a|b` → 3 而非 5
    const samples = collectColumnSamples(['| `a|b` | c |'], 2)
    expect(samples).toEqual([3, 1])
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

// ---- #371 短列可读下限与字号适配（docs/specs 载票契约） ----
// 可读下限 = 视图层实测的「约三汉字内容宽 + 格左右 padding/border」随字号
// 变化；下限之和放不下时按比例收缩；采样口径对齐可见文字（隐藏链接目标
// 与格式标记不计入，widget 有界回退）。

describe('#371 可读下限（readability 输入）', () => {
  it('缺省 readability 保持 #142 静态 48px 下限现状（行为不变式）', () => {
    const tracks = planColumnTracks([5, 5])
    for (const track of tracks) {
      expect(minOf(track).px).toBe(TABLE_MIN_COLUMN_PX)
    }
    // 同输入与显式 minColumnPx 逐字节一致（缺省回落）
    expect(tableGridTemplate([5, 5])).toBe(tableGridTemplate([5, 5], { minColumnPx: 48 }))
  })

  it('下限 = 三汉字内容宽 + 格盒占位：min(contentPx + cellBoxPx, 等分份额%)', () => {
    const tracks = planColumnTracks([5, 5], { readability: { contentPx: 42, cellBoxPx: 22 } })
    expect(tracks).toHaveLength(2)
    for (const track of tracks) {
      expect(minOf(track).px).toBe(64) // 42 + 22
      expect(minOf(track).share).toBe(50)
    }
  })

  it('字号变大下限变大（contentPx 单调递增 → px 下限单调递增）——本票立身之本', () => {
    const sizes = [12, 18, 24, 32]
    let prevPx = 0
    for (const contentPx of sizes) {
      const track = planColumnTracks([10, 10], { readability: { contentPx, cellBoxPx: 22 } })[0]!
      const px = minOf(track).px
      expect(px).toBe(contentPx + 22)
      expect(px).toBeGreaterThan(prevPx)
      prevPx = px
    }
    // 大字号下限不再被静态 48px 钳制
    expect(prevPx).toBeGreaterThan(TABLE_MIN_COLUMN_PX)
  })

  it('availablePx 充足时不收缩：下限保持常规可读值', () => {
    const tracks = planColumnTracks([5, 5], {
      readability: { contentPx: 42, cellBoxPx: 22, availablePx: 880 },
    })
    expect(minOf(tracks[0]!).px).toBe(64)
    expect(minOf(tracks[1]!).px).toBe(64)
  })

  it('availablePx 放不下时按比例收缩：每列下限 = 常规下限 × (可用宽/下限总和)，保持非负', () => {
    // 2 列 × 64px = 128 > 100 → scale = 100/128 → 每列 50px
    const tracks = planColumnTracks([5, 5], {
      readability: { contentPx: 42, cellBoxPx: 22, availablePx: 100 },
    })
    for (const track of tracks) {
      expect(minOf(track).px).toBeCloseTo(50, 2)
      expect(minOf(track).px).toBeGreaterThanOrEqual(0)
    }
    // 收缩后下限之和不超可用宽（浮点按 3 位小数规整的容差）
    const sum = tracks.reduce((acc, t) => acc + minOf(t).px, 0)
    expect(sum).toBeLessThanOrEqual(100 + 0.01)
  })

  it('容器恢复宽后恢复常规下限：同函数同输入确定性（收缩不是单向棘轮）', () => {
    const opts = (availablePx?: number) => ({ readability: { contentPx: 42, cellBoxPx: 22, availablePx } })
    const narrow = tableGridTemplate([5, 5], opts(100))
    const narrowAgain = tableGridTemplate([5, 5], opts(100))
    const wide = tableGridTemplate([5, 5], opts(880))
    const wideAgain = tableGridTemplate([5, 5], opts(880))
    expect(narrow).toBe(narrowAgain)
    expect(wide).toBe(wideAgain)
    expect(minOf(wide.split(/(?=minmax\()/)[0]!).px).toBe(64)
    expect(minOf(narrow.split(/(?=minmax\()/)[0]!).px).toBeLessThan(64)
  })

  it('availablePx 缺省时轨道仍写 min(px, share%)：CSS 双保险承接「保底合计不超容器」', () => {
    // 6 列窄面板：每列份额 16.666% < 常规下限——min() 使 CSS 按份额兜底
    const tracks = planColumnTracks(Array.from({ length: 6 }, () => 5),
      { readability: { contentPx: 42, cellBoxPx: 22 } })
    let shareSum = 0
    for (const track of tracks) {
      const min = minOf(track)
      expect(min.px).toBe(64)
      shareSum += min.share
    }
    expect(shareSum).toBeLessThanOrEqual(100 + 1e-9)
  })

  it('确定性：含 readability 与收缩的输出逐字节相同；fr 权重不受下限影响', () => {
    const samples = [3, 40]
    const a = tableGridTemplate(samples, { readability: { contentPx: 40, cellBoxPx: 22, availablePx: 90 } })
    const b = tableGridTemplate([...samples], { readability: { contentPx: 40, cellBoxPx: 22, availablePx: 90 } })
    expect(a).toBe(b)
    // fr 权重 = 样本 + 保底加成，与 #142 口径一致（下限只影响 min 部分）
    for (const [i, track] of planColumnTracks(samples).entries()) {
      expect(weightOf(track)).toBeCloseTo(samples[i]! + TABLE_WEIGHT_PADDING_UNITS, 5)
    }
  })
})

describe('#371 可见文字采样（隐藏链接目标与格式标记不计入）', () => {
  it('双链别名：[[长目标路径|别名]] 只计别名宽度（隐藏目标不撑宽短列）', () => {
    // 别名「跳转」4 单位；字面 `[[目录/笔记#锚点|跳转]]` 是 2 倍以上
    const samples = collectColumnSamples(['| [[目录/笔记文件#锚点\\|跳转]] | x |'], 2)
    expect(samples[0]).toBe(4)
    // 字面宽度确实更大（口径确实剔除了隐藏部分）
    const literal = collectColumnSamples(['| [[目录/笔记文件#锚点]] | x |'], 2)
    expect(literal[0]).toBeGreaterThan(samples[0]!)
  })

  it('双链无别名：[[笔记#标题]] 计显示文字（路径 + 锚点）', () => {
    // display = `笔记#标题` → 8 单位（4 汉字宽 8 + # 1 + 标题 4……按字符计）
    const samples = collectColumnSamples(['| [[笔记#标题]] | x |'], 2)
    expect(samples[0]).toBe(defaultCellWidthMeasurer('笔记#标题'))
  })

  it('markdown 链接：[文字](url) 只计文字，长 url 不撑宽短列', () => {
    const samples = collectColumnSamples(['| [说明文字](https://example.com/a/very/long/path) | x |'], 2)
    expect(samples[0]).toBe(defaultCellWidthMeasurer('说明文字'))
  })

  it('未闭合链接形态按字面计（与渲染语义一致——markdown-it 不产链接）', () => {
    const text = 'a[b](unclosed'
    const samples = collectColumnSamples([`| ${text} | x |`], 2)
    expect(samples[0]).toBe(defaultCellWidthMeasurer(text))
  })

  it('格式标记剥离：**粗体** / *斜体* / ==高亮== / ~~删除~~ 计纯文字', () => {
    const samples = collectColumnSamples(['| **粗体文字** | x |'], 2)
    expect(samples[0]).toBe(8) // 粗体文字 = 4 汉字 = 8 单位
    expect(collectColumnSamples(['| *斜* | x |'], 2)[0]).toBe(2)
    expect(collectColumnSamples(['| ==高亮== | x |'], 2)[0]).toBe(4)
    expect(collectColumnSamples(['| ~~删除~~ | x |'], 2)[0]).toBe(4)
  })

  it('snake_case 名字不剥下划线（词内下划线不是斜体标记）', () => {
    const samples = collectColumnSamples(['| snake_case_name | x |'], 2)
    expect(samples[0]).toBe(defaultCellWidthMeasurer('snake_case_name'))
  })

  it('intraword 星号按字面保留计宽（a*b*c 的 * 不剥——保守方向宁可略宽）', () => {
    // #372 评审 I-12：`*` 分支与 `_` 同款词边界判定——CommonMark 星号其实
    // 允许词内强调，此处从宽不剥（高估有界于标记字符数，不裁切格内容）
    const samples = collectColumnSamples(['| a*b*c | x |'], 2)
    expect(samples[0]).toBe(defaultCellWidthMeasurer('a*b*c'))
  })

  it('嵌入 ![[…]] 按有界回退计，不随目标长度增长（#248 格内卡不主导父列宽）', () => {
    const short = collectColumnSamples(['| ![[笔记]] | x |'], 2)
    const long = collectColumnSamples(['| ![[目录/超长目标文件名/更长路径#深锚点\\|还有别名]] | x |'], 2)
    expect(short[0]).toBe(TABLE_WIDGET_FALLBACK_UNITS)
    expect(long[0]).toBe(TABLE_WIDGET_FALLBACK_UNITS)
  })

  it('图片 ![alt](url) 与行内公式 $…$ 同按有界回退计（呈现宽不可估）', () => {
    expect(collectColumnSamples(['| ![替代文字](https://host/a/b/c.png) | x |'], 2)[0])
      .toBe(TABLE_WIDGET_FALLBACK_UNITS)
    expect(collectColumnSamples(['| $x^2 + \\\\frac{a}{b}$ | x |'], 2)[0])
      .toBe(TABLE_WIDGET_FALLBACK_UNITS)
  })

  it('结构替换产物不再剥格式标记（Live 别名按字面呈现，口径对齐）', () => {
    // Live 双链别名 widget 以 textContent 字面呈现 → `**加粗**` 六字符可见
    const samples = collectColumnSamples(['| [[目标\\|**加粗**]] | x |'], 2)
    expect(samples[0]).toBe(defaultCellWidthMeasurer('**加粗**'))
  })

  it('链接文字域内格式标记仍剥离（域内呈现走行内装饰，标记隐藏）', () => {
    const samples = collectColumnSamples(['| [**粗体**](https://example.com) | x |'], 2)
    expect(samples[0]).toBe(4) // 粗体 = 4 单位
  })

  it('混排：结构替换与普通文本宽度累加（同一视觉行水平排列）', () => {
    // 前缀「见」2 + 双链 display `笔记` 4 + 尾注「条目」4 = 10
    const samples = collectColumnSamples(['| 见[[笔记]]条目 | x |'], 2)
    expect(samples[0]).toBe(10)
  })

  it('格内换行分段的可见文字按最宽段计（br 分段与可见化叠加）', () => {
    // 段 1：`[[长目标|短名]]` → 4；段 2：`很长的普通文本行` → 16 → 最宽 16
    const samples = collectColumnSamples(['| [[很长很长的目标\\|短名]]<br>很长的普通文本行 | x |'], 2)
    expect(samples[0]).toBe(16)
  })

  it('纯文本无结构字符时走现状口径（零变化不变式）', () => {
    const samples = collectColumnSamples(['| 普通文本内容 | abc |'], 2)
    expect(samples).toEqual([12, 3])
  })

  it('转义管道反斜杠仍剔除（与 #142 采样口径叠加不回退）', () => {
    const samples = collectColumnSamples(['| a\\|b | x |'], 2)
    expect(samples[0]).toBe(3)
  })
})
