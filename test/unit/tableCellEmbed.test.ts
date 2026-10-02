// #248 表格格内嵌入的三套区间映射（模块级纯函数直驱）：
// - decodeCellView：格内容文本的「解码视图」——非行内代码 span 内的 `\|`
//   解码为 `|`（escapeCellText 的逆，GFM 格内语义），逐解码位置保留到源码
//   位置的映射（解码字符串短于源文，绝不能用解码 offset 直接写回）
// - scanEmbedsInTableRow：表格内容行（表头/数据行）的格内嵌入 occurrence
//   ——逐 cell 解码视图扫描，命中区间映射回**原始源码区间**，inner 为解码
//   语义（`B|别名`——别名管道不误切列、不把 `\` 吞进目标路径）
// 与 tableCells 的切列判定、wikilink 的嵌入形态学同源不另起一套。
import { describe, expect, it } from 'vitest'
import {
  decodeCellView,
  scanEmbedsInTableRow,
} from '../../src/shared/tableCellEmbed'
import { parseWikilinkInner } from '../../src/shared/wikilink'
import { splitTableRowCells } from '../../src/shared/tableCells'

describe('decodeCellView：格内解码视图与源码位置映射', () => {
  it('无转义管道的行：文本原样、映射恒等', () => {
    const view = decodeCellView('| a | b |')
    expect(view.text).toBe('| a | b |')
    expect(view.toSourceAt).toHaveLength('| a | b |'.length + 1)
    for (let i = 0; i <= view.text.length; i++) {
      expect(view.toSourceAt[i]).toBe(i)
    }
  })

  it('转义管道解码：\\| → |，其后位置映射回源码位置（偏移 +1）', () => {
    const line = '| a \\| b |'
    const view = decodeCellView(line)
    expect(view.text).toBe('| a | b |')
    // 解码位 4 的 `|` 来自源码位 5（`\` 在源码位 4）
    expect(line[4]).toBe('\\')
    expect(view.toSourceAt[4]).toBe(5)
    // 尾部逐位对齐：解码位 i → 源码位 i + 1（一处解码缩短 1）
    for (let i = 4; i < view.text.length; i++) {
      expect(view.toSourceAt[i]).toBe(i + 1)
    }
    // 越界端点 = 源行尾
    expect(view.toSourceAt[view.text.length]).toBe(line.length)
  })

  it('多处转义管道逐一解码（偏移累加）', () => {
    const line = '| x\\|y \\| z\\|w |'
    const view = decodeCellView(line)
    expect(view.text).toBe('| x|y | z|w |')
    expect(view.toSourceAt[view.text.length]).toBe(line.length)
    // 解码文本按映射截回源文逐位可还原
    for (let i = 0; i < view.text.length; i++) {
      const src = view.toSourceAt[i]!
      expect(line[src]).toBe(view.text[i])
    }
  })

  it('行内代码 span 内的 \\| 不解码（字面呈现语义）', () => {
    const line = '| `a\\|b` |'
    const view = decodeCellView(line)
    expect(view.text).toBe(line)
    for (let i = 0; i <= view.text.length; i++) {
      expect(view.toSourceAt[i]).toBe(i)
    }
  })

  it('中文、锚点与 URL 编码字符原样保留（不在解码范围）', () => {
    const line = '| ![[笔 记#标题^abc\\|别名%20x]] |'
    const view = decodeCellView(line)
    expect(view.text).toBe('| ![[笔 记#标题^abc|别名%20x]] |')
    // 除解码的 `\|` 外（含 %20、^、#、空格、中文）全部原样
    expect(view.text).not.toContain('\\')
  })
})

describe('scanEmbedsInTableRow：表格内容行的格内嵌入 occurrence', () => {
  it('别名管道形态：inner 为解码语义，from/to 为原始源码区间', () => {
    const line = '| 前文 ![[B\\|别名]] 后文 |'
    const hits = scanEmbedsInTableRow(line, 0)
    expect(hits).toHaveLength(1)
    const hit = hits[0]!
    // inner 解码语义：目标与别名正确拆分（`\` 不进路径）
    expect(hit.inner).toBe('B|别名')
    const parsed = parseWikilinkInner(hit.inner)
    expect(parsed!.path).toBe('B')
    expect(parsed!.alias).toBe('别名')
    // 区间是原始源码区间：slice 回源文恰为嵌入原文（含 `\|`）
    expect(line.slice(hit.from, hit.to)).toBe('![[B\\|别名]]')
  })

  it('别名管道不误切列：该行按 tableCells 语义仍为 2 列', () => {
    const line = '| ![[B\\|别名]] | 单元格 |'
    const cells = splitTableRowCells(line, 0)
    expect(cells).toHaveLength(2)
    expect(cells[0]!.contentTo - cells[0]!.contentFrom).toBe('![[B\\|别名]]'.length)
  })

  it('锚点 + 别名组合形态保真', () => {
    const line = '| ![[B#标题\\|显示]] |'
    const hits = scanEmbedsInTableRow(line, 0)
    expect(hits).toHaveLength(1)
    expect(hits[0]!.inner).toBe('B#标题|显示')
    expect(line.slice(hits[0]!.from, hits[0]!.to)).toBe('![[B#标题\\|显示]]')
    const parsed = parseWikilinkInner(hits[0]!.inner)
    expect(parsed!.path).toBe('B')
    expect(parsed!.heading).toBe('标题')
    expect(parsed!.alias).toBe('显示')
  })

  it('块引用形态（#^id）与别名组合保真', () => {
    const line = '| ![[B#^blk-1\\|别名]] |'
    const hits = scanEmbedsInTableRow(line, 0)
    expect(hits).toHaveLength(1)
    expect(hits[0]!.inner).toBe('B#^blk-1|别名')
    const parsed = parseWikilinkInner(hits[0]!.inner)
    expect(parsed!.blockId).toBe('blk-1')
  })

  it('无管道形态照常命中（与 scanEmbedsInLine 同语义）', () => {
    const line = '| ![[B]] | ![[C#h]] |'
    const hits = scanEmbedsInTableRow(line, 0)
    expect(hits).toHaveLength(2)
    expect(hits.map((h) => h.inner)).toEqual(['B', 'C#h'])
    expect(line.slice(hits[0]!.from, hits[0]!.to)).toBe('![[B]]')
    expect(line.slice(hits[1]!.from, hits[1]!.to)).toBe('![[C#h]]')
  })

  it('同格多引用按源顺序命中', () => {
    const line = '| 一 ![[A]] 二 ![[B\\|b]] 三 ![[C]] |'
    const hits = scanEmbedsInTableRow(line, 0)
    expect(hits.map((h) => h.inner)).toEqual(['A', 'B|b', 'C'])
  })

  it('跨格伪形态不命中：嵌入开闭标记跨 cell 边界时不产生 occurrence', () => {
    // `![[x` 与 `y]]` 分属两格——格内逐 cell 扫描，任何单格不构成完整嵌入
    const line = '| a ![[x | y]] b |'
    expect(scanEmbedsInTableRow(line, 0)).toHaveLength(0)
  })

  it('格内行内代码中的嵌入字面量不命中', () => {
    const line = '| `![[B]]` |'
    expect(scanEmbedsInTableRow(line, 0)).toHaveLength(0)
  })

  it('base 偏移：from/to 为全文 LF offset（含 lineStart）', () => {
    const line = '| ![[B\\|别名]] |'
    const lineStart = 42
    const hits = scanEmbedsInTableRow(line, lineStart)
    expect(hits[0]!.from).toBe(lineStart + line.indexOf('![['))
    expect(hits[0]!.to).toBe(lineStart + line.indexOf('![[') + '![[B\\|别名]]'.length)
  })

  it('分隔行形态（无嵌入内容）返回空', () => {
    expect(scanEmbedsInTableRow('| --- | :-: |', 0)).toHaveLength(0)
  })

  it('残缺形态（未闭合）不命中且不影响后续合法命中', () => {
    const line = '| ![[B 后 ![[C\\|c]] |'
    const hits = scanEmbedsInTableRow(line, 0)
    expect(hits.map((h) => h.inner)).toEqual(['C|c'])
  })

  it('P1-1 端点映射：`]]` 紧贴 \\| 时区间不含转义反斜杠（slice 严格等于嵌入原文）', () => {
    const line = '| ![[B]]\\|尾 | y |'
    const hits = scanEmbedsInTableRow(line, 0)
    expect(hits).toHaveLength(1)
    const hit = hits[0]!
    expect(hit.inner).toBe('B')
    expect(hit.from).toBe(line.indexOf('![[B]]'))
    // 开区间端点取末字符源位 +1——不得多含 `\`（解码缩短点的直接映射
    // 指向源码管道字符，会吞掉转义反斜杠）
    expect(line.slice(hit.from, hit.to)).toBe('![[B]]')
    expect(line[hit.to]).toBe('\\')
  })

  it('P1-1 端点映射：from 侧紧贴 \\|（前格转义管道紧邻嵌入起点）同样严格', () => {
    const line = '| a\\|![[B]] | y |'
    const hits = scanEmbedsInTableRow(line, 0)
    expect(hits).toHaveLength(1)
    expect(hits[0]!.inner).toBe('B')
    expect(line.slice(hits[0]!.from, hits[0]!.to)).toBe('![[B]]')
  })

  it('P1-1 端点映射：别名形态后紧贴尾文与转义管道的复合形态', () => {
    const line = '| x ![[B\\|别名]]\\|尾 | y |'
    const hits = scanEmbedsInTableRow(line, 0)
    expect(hits).toHaveLength(1)
    expect(hits[0]!.inner).toBe('B|别名')
    expect(line.slice(hits[0]!.from, hits[0]!.to)).toBe('![[B\\|别名]]')
    expect(line[hits[0]!.to]).toBe('\\')
  })

  it('全部命中区间的 slice 严格等于嵌入原文（含转义管道形态的通用不变量）', () => {
    const lines = [
      '| ![[B]]\\|尾 | ![[B\\|a]]\\|尾 | a\\|![[C]] | ![[D#h\\|x]]\\|t |',
    ]
    for (const line of lines) {
      for (const hit of scanEmbedsInTableRow(line, 0)) {
        const raw = line.slice(hit.from, hit.to)
        expect(raw.startsWith('![[')).toBe(true)
        expect(raw.endsWith(']]')).toBe(true)
        // inner 为解码语义：原文中的 `\|` 在 inner 中为 `|`
        expect(raw.slice(3, -2).replaceAll('\\|', '|')).toBe(hit.inner)
      }
    }
  })
})
