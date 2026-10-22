// T03（#623）选区切片纯逻辑单元测试：归一化（换向/钳制/去空/排序/去包含）
// 与边界矩阵（段中/半表格行/半围栏/跨块/多选区顺序/邻接不合并）。
// 「不扩大」是硬验收：切片文本必须与原文按位相等（start/end 严格原样）。
import { describe, expect, it } from 'vitest'
import {
  normalizeSelectionRanges,
  sliceSelectionFragments,
} from '../../src/host/pdfExport/pdfExportSelection'

const DOC = [
  '# 标题行',
  '',
  '| 列甲 | 列乙 |',
  '| --- | --- |',
  '| 值一 | 值二 |',
  '',
  '- 列表一',
  '- 列表二',
  '- 列表三',
  '',
  '```js',
  'const x = 1',
  'const y = 2',
  '```',
  '',
  '尾段文本 TAIL-MARK。',
].join('\n')

describe('normalizeSelectionRanges：归一化', () => {
  it('换向（from>to 交换）与钳制到 [0, text.length]', () => {
    expect(normalizeSelectionRanges('abcd', [{ from: 3, to: 1 }])).toEqual([{ from: 1, to: 3 }])
    expect(normalizeSelectionRanges('abcd', [{ from: -5, to: 99 }])).toEqual([{ from: 0, to: 4 }])
  })

  it('空选区（from===to，纯光标）剔除——光标不是有效选区', () => {
    expect(normalizeSelectionRanges('abcd', [{ from: 1, to: 1 }])).toEqual([])
    // 钳制后变空的同样剔除
    expect(normalizeSelectionRanges('abcd', [{ from: 9, to: 12 }])).toEqual([])
  })

  it('乱序输入按文档顺序排序（from 主键）', () => {
    const out = normalizeSelectionRanges('abcdefgh', [
      { from: 5, to: 6 },
      { from: 1, to: 2 },
      { from: 3, to: 4 },
    ])
    expect(out).toEqual([{ from: 1, to: 2 }, { from: 3, to: 4 }, { from: 5, to: 6 }])
  })

  it('邻接选区不合并（两段独立选择保持两个片段）；重叠包含剔除（防御）', () => {
    expect(normalizeSelectionRanges('abcdef', [
      { from: 0, to: 3 },
      { from: 3, to: 6 },
    ])).toEqual([{ from: 0, to: 3 }, { from: 3, to: 6 }])
    expect(normalizeSelectionRanges('abcdef', [
      { from: 0, to: 6 },
      { from: 2, to: 4 },
    ])).toEqual([{ from: 0, to: 6 }])
  })
})

describe('sliceSelectionFragments：边界矩阵（严格原文，不扩大）', () => {
  it('段中间切片：只取选中字符，前后段文字不进入', () => {
    const marker = DOC.indexOf('尾段文本')
    const fragments = sliceSelectionFragments(DOC, [{ from: marker + 2, to: marker + 4 }])
    expect(fragments).toHaveLength(1)
    expect(fragments[0]!.text).toBe('文本')
    expect(fragments[0]).toMatchObject({ start: marker + 2, end: marker + 4 })
  })

  it('半表格行切片：只取行内选中部分，不含整行/表头/相邻行', () => {
    const rowStart = DOC.indexOf('| 值一 | 值二 |')
    const fragments = sliceSelectionFragments(DOC, [{ from: rowStart + 2, to: rowStart + 6 }])
    expect(fragments[0]!.text).toBe('值一 |')
    expect(fragments[0]!.text).not.toContain('列甲')
    expect(fragments[0]!.text).not.toContain('值二')
  })

  it('半围栏切片：围栏标记/闭合行/其余代码行不进入', () => {
    const fenceOpen = DOC.indexOf('```js')
    const fenceClose = DOC.indexOf('```', fenceOpen + 3)
    const inside = DOC.indexOf('const y = 2')
    // 从围栏标记中间到代码行中间：不扩大到闭合围栏
    const fragments = sliceSelectionFragments(DOC, [{ from: fenceOpen + 3, to: inside + 7 }])
    expect(fragments[0]!.text.startsWith('js\n')).toBe(true)
    expect(fragments[0]!.text).toContain('const x = 1')
    expect(fragments[0]!.text.endsWith('const y')).toBe(true)
    expect(fragments[0]!.end).toBe(inside + 7)
    expect(fragments[0]!.end).toBeLessThan(fenceClose)
  })

  it('跨块切片：中间内容整体进入（含边界换行），选区外不进入', () => {
    const listOne = DOC.indexOf('- 列表一')
    const listThreeEnd = DOC.indexOf('- 列表三') + '- 列表三'.length
    const fragments = sliceSelectionFragments(DOC, [{ from: listOne, to: listThreeEnd }])
    expect(fragments[0]!.text).toBe('- 列表一\n- 列表二\n- 列表三')
    expect(fragments[0]!.text).not.toContain('标题行')
    expect(fragments[0]!.text).not.toContain('```')
  })

  it('多选区按文档顺序输出多个片段（乱序输入归序），不拼接', () => {
    const head = DOC.indexOf('# 标题行')
    const tail = DOC.indexOf('尾段文本 TAIL-MARK。')
    const fragments = sliceSelectionFragments(DOC, [
      { from: tail, to: tail + 3 },
      { from: head, to: head + 3 },
    ])
    expect(fragments).toHaveLength(2)
    expect(fragments[0]!.text).toBe('# 标')
    expect(fragments[1]!.text).toBe('尾段文')
    expect(fragments[0]!.start).toBeLessThan(fragments[1]!.start)
  })

  it('片段与原文按位相等：slice 结果与 text.slice 对拍', () => {
    const ranges = [
      { from: 0, to: 4 },
      { from: DOC.length - 8, to: DOC.length },
    ]
    for (const f of sliceSelectionFragments(DOC, ranges)) {
      expect(f.text).toBe(DOC.slice(f.start, f.end))
    }
  })
})
