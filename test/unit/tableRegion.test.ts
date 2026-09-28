import { describe, expect, it } from 'vitest'
import MarkdownIt from 'markdown-it'
import { parseTableRegionClipboard, planTableRegionDelete, planTableRegionPaste, planTableRegionReplace, serializeTableRegion, type TableRegion } from '../../src/webview/tableRegion'
import { parseTableDelimiter as parseTableDelimiterForTest } from '../../src/webview/tableCells'
import type { TableRowInfo } from '../../src/webview/tableStructure'

const doc = '正文前\n\n| 名字 | 数量 | 备注 |\n| --- | :---: | ---: |\n| 苹果 | 3 | 甲 |\n| 香蕉 | 5 | 乙\\|丙 |\n| 樱桃 | 7 | `a|b` |\n\n正文后'
const starts = doc.split('\n').reduce<number[]>((out) => {
  out.push((out.at(-1) ?? -1) + (out.length ? doc.split('\n')[out.length - 1]!.length + 1 : 1))
  return out
}, [])
const rows: TableRowInfo[] = [2, 3, 4, 5, 6].map((line, index) => ({
  kind: index === 0 ? 'header' : index === 1 ? 'delimiter' : 'row',
  lineFrom: starts[line]!, lineTo: starts[line]! + doc.split('\n')[line]!.length,
}))
const apply = (changes: Array<{ from: number; to: number; insert: string }>) =>
  [...changes].sort((a, b) => b.from - a.from).reduce((text, change) =>
    text.slice(0, change.from) + change.insert + text.slice(change.to), doc)
const region = (r0: number, r1: number, c0: number, c1: number): TableRegion =>
  ({ tableFrom: rows[0]!.lineFrom, rowFrom: r0, rowTo: r1, columnFrom: c0, columnTo: c1 })

describe('矩形单元格区域', () => {
  it('复制任意 2×2 区域：首选行成为表头，转义和中文原样保留', () => {
    expect(serializeTableRegion(doc, rows, region(1, 2, 1, 2))).toBe(
      '| 3 | 甲 |\n| --- | --- |\n| 5 | 乙\\|丙 |',
    )
  })

  it('复制含代码片段裸管道的格区仍能被标准 Markdown 解析成表格', () => {
    const markdown = serializeTableRegion(doc, rows, region(2, 3, 1, 2))!
    const html = new MarkdownIt().render(markdown)
    expect(html).toContain('<table>')
    expect(html).toContain('a|b')
    expect(html).toContain('乙|丙')
  })

  it('局部矩形只清被选格，保留其余格和表格结构', () => {
    const plan = planTableRegionDelete(doc, rows, region(1, 2, 1, 2))!
    const after = apply(plan.changes)
    expect(after).toContain('| 苹果 |  |  |\n| 香蕉 |  |  |\n| 樱桃 | 7 | `a|b` |')
    expect(after).toMatch(/^正文前\n\n/)
    expect(after).toMatch(/\n\n正文后$/)
  })

  it('整行删除包含表头时，下一行晋升并保留原分隔行', () => {
    const after = apply(planTableRegionDelete(doc, rows, region(0, 0, 0, 2))!.changes)
    expect(after).toContain('| 苹果 | 3 | 甲 |\n| --- | :---: | ---: |\n| 香蕉 |')
    expect(after).not.toContain('| 名字 |')
  })

  it('满列删除同步删除对齐段，未选列原样保留', () => {
    const after = apply(planTableRegionDelete(doc, rows, region(0, 3, 1, 1))!.changes)
    expect(after).toContain('| 名字 | 备注 |\n| --- | ---: |\n| 苹果 | 甲 |')
    expect(after).toContain('| 香蕉 | 乙\\|丙 |')
  })

  it('整表与最后一列删除表格，保留前后正文', () => {
    const after = apply(planTableRegionDelete(doc, rows, region(0, 3, 0, 2))!.changes)
    expect(after).toBe('正文前\n\n\n\n正文后')
  })

  it('无 padding 的紧凑表格清首格仍保持两列可解析', () => {
    const compact = 'H1|H2\n---|---\nB1|B2'
    const compactRows: TableRowInfo[] = [
      { kind: 'header', lineFrom: 0, lineTo: 5 },
      { kind: 'delimiter', lineFrom: 6, lineTo: 13 },
      { kind: 'row', lineFrom: 14, lineTo: 19 },
    ]
    const change = planTableRegionDelete(compact, compactRows,
      { tableFrom: 0, rowFrom: 1, rowTo: 1, columnFrom: 0, columnTo: 0 })!.changes
    const after = [...change].sort((a, b) => b.from - a.from).reduce((text, item) =>
      text.slice(0, item.from) + item.insert + text.slice(item.to), compact)
    expect(after).toBe('H1|H2\n---|---\n| |B2|')
  })

  it('区域键入只在左上格插字，其余被选格清空，未选格保持且不删行列', () => {
    const plan = planTableRegionReplace(doc, rows, region(1, 2, 1, 2), 'X|换行\n后续')!
    const after = apply(plan.changes)
    expect(after).toContain('| 苹果 | X\\|换行<br>后续 |  |\n| 香蕉 |  |  |')
    expect(after).toContain('| 樱桃 | 7 | `a|b` |')
    expect(after.slice(plan.selection - 2, plan.selection)).toBe('后续')
  })
})

describe('格对格粘贴（2026-09-28 决策：剥包装、扩表容纳、永不删行列）', () => {
  it('parseTableRegionClipboard：复制产物可解析，剥掉表头包装首行也是数据，转义管道保真', () => {
    const clipboard = serializeTableRegion(doc, rows, region(1, 2, 1, 2))!
    const matrix = parseTableRegionClipboard(clipboard)!
    expect(matrix).toEqual([[' 3 ', ' 甲 '], [' 5 ', ' 乙\\|丙 ']])
  })

  it('parseTableRegionClipboard：缺分隔行 / 列不齐 / 空文本一律不判为表格', () => {
    expect(parseTableRegionClipboard('| a | b |')).toBeNull()
    expect(parseTableRegionClipboard('| a | b |\n| --- |\n| c | d |')).toBeNull()
    expect(parseTableRegionClipboard('')).toBeNull()
    expect(parseTableRegionClipboard('普通段落\n不是表格')).toBeNull()
  })

  it('同尺寸 2×2：四格逐一替换，行列结构与其他格不动', () => {
    const matrix = [[' 一 ', ' 二 '], [' 三 ', ' 四 ']]
    const after = apply(planTableRegionPaste(doc, rows, region(1, 2, 1, 2), matrix)!.changes)
    expect(after).toContain('| 名字 | 数量 | 备注 |\n| --- | :---: | ---: |\n| 苹果 | 一 | 二 |\n| 香蕉 | 三 | 四 |\n| 樱桃 | 7 | `a|b` |')
  })

  it('源小于选区：选区内未覆盖格清空，行数不变（粘贴永不删行列）', () => {
    const matrix = [[' 一 ']]
    const after = apply(planTableRegionPaste(doc, rows, region(1, 2, 1, 2), matrix)!.changes)
    expect(after).toContain('| 苹果 | 一 | |\n| 香蕉 | | |')
    expect(after).toContain('| 樱桃 | 7 | `a|b` |')
  })

  it('源越过选区：以选区左上为锚铺开，覆盖表内已有格（不删行列）', () => {
    const matrix = [[' 一 ', ' 二 '], [' 三 ', ' 四 '], [' 五 ', ' 六 ']]
    const after = apply(planTableRegionPaste(doc, rows, region(1, 1, 1, 1), matrix)!.changes)
    expect(after).toContain('| 苹果 | 一 | 二 |\n| 香蕉 | 三 | 四 |\n| 樱桃 | 五 | 六 |')
  })

  it('源行数超表：表格末尾扩行容纳，选区外行与表头不动', () => {
    const matrix = [[' 一 ', ' 二 '], [' 三 ', ' 四 '], [' 五 ', ' 六 '], [' 七 ', ' 八 ']]
    const after = apply(planTableRegionPaste(doc, rows, region(1, 1, 0, 0), matrix)!.changes)
    const lines = after.split('\n')
    expect(lines.slice(2, 8).join('\n')).toBe(
      '| 名字 | 数量 | 备注 |\n| --- | :---: | ---: |\n| 一 | 二 | 甲 |\n| 三 | 四 | 乙\\|丙 |\n| 五 | 六 | `a|b` |\n| 七 | 八 | |')
    expect(after).toContain('正文后')
  })

  it('源列数超表：全表加列，分隔行原对齐保真并补默认对齐格', () => {
    const matrix = [[' 一 ', ' 二 ', ' 三 '], [' 四 ', ' 五 ', ' 六 ']]
    const after = apply(planTableRegionPaste(doc, rows, region(1, 2, 1, 1), matrix)!.changes)
    expect(after).toContain('| 名字 | 数量 | 备注 | |\n| --- | :---: | ---: | --- |\n| 苹果 | 一 | 二 | 三 |\n| 香蕉 | 四 | 五 | 六 |\n| 樱桃 | 7 | `a|b` | |')
  })

  it('格内 <br> 字面与行内格式原样保真', () => {
    const matrix = [[' a<br>b ', ' **粗** ']]
    const after = apply(planTableRegionPaste(doc, rows, region(0, 0, 0, 1), matrix)!.changes)
    expect(after).toContain('| a<br>b | **粗** | 备注 |')
  })

  it('非扩列粘贴不规范化选区上方行：无尾管道的历史源形态字节级保留', () => {
    const loose = '| a | b\n| --- | ---\n| c | x'
    const looseRows: TableRowInfo[] = [
      { kind: 'header', lineFrom: 0, lineTo: 7 },
      { kind: 'delimiter', lineFrom: 8, lineTo: 19 },
      { kind: 'row', lineFrom: 20, lineTo: 27 },
    ]
    const plan = planTableRegionPaste(loose, looseRows,
      { tableFrom: 0, rowFrom: 1, rowTo: 1, columnFrom: 1, columnTo: 1 }, [[' 新 ']])!
    const after = [...plan.changes].sort((a, b) => b.from - a.from).reduce((text, item) =>
      text.slice(0, item.from) + item.insert + text.slice(item.to), loose)
    expect(after.split('\n').slice(0, 2).join('\n')).toBe('| a | b\n| --- | ---')
    expect(after).toContain('| c | 新 |')
  })

  it('无尾管道分隔行上扩列：分隔行按原对齐重建为显式边界，产物仍是合法表格', () => {
    const loose = '| a | b\n| :--- | ---:\n| c | x'
    const looseRows: TableRowInfo[] = [
      { kind: 'header', lineFrom: 0, lineTo: 7 },
      { kind: 'delimiter', lineFrom: 8, lineTo: 21 },
      { kind: 'row', lineFrom: 22, lineTo: 29 },
    ]
    const plan = planTableRegionPaste(loose, looseRows,
      { tableFrom: 0, rowFrom: 1, rowTo: 1, columnFrom: 1, columnTo: 1 },
      [[' 一 ', ' 二 ']])!
    const after = [...plan.changes].sort((a, b) => b.from - a.from).reduce((text, item) =>
      text.slice(0, item.from) + item.insert + text.slice(item.to), loose)
    const lines = after.split('\n')
    expect(lines[1]).toBe('| :--- | ---: | --- |')
    expect(lines[2]).toBe('| c | 一 | 二 |')
    // 产物整表可再解析：对齐声明非空且各行列数一致
    const aligns = parseTableDelimiterForTest(lines[1]!)
    expect(aligns).toEqual(['left', 'right', null])
  })
})
