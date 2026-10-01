// 嵌入（![[…]]）形态学契约（工单 #222）：独立扫描器与独占行判定——
// 与双链扫描器（scanWikilinksInLine）互为镜像：
// - 双链扫描器的前置 `!` 守卫保持不动（嵌入不作为双链命中——两语法角色
//   独立识别，规格「须独立识别语法角色，不能只删除守卫」）
// - 嵌入内部解析复用 parseWikilinkInner（目标语法与双链同源：全文/标题
//   章节/块/别名；非法形态同样降级不命中）
// - soleEmbedOfLine 供阅读挂载适配层判定「独占正文一行」：trim 后整行
//   恰为单个嵌入（首尾空白容忍——≤3 空格缩进仍是段落；混排/行内代码
//   包裹不独占）。行独占限制只属挂载适配，索引抽取不设此限
import { describe, it, expect } from 'vitest'
import {
  embedAtCol,
  parseWikilinkInner,
  scanEmbedsInLine,
  scanWikilinksInLine,
  soleEmbedOfLine,
} from '../../src/shared/wikilink'

describe('scanEmbedsInLine：嵌入单行出现扫描（独立语法角色）', () => {
  it('基础命中：from 含 !、to 含 ]]，inner 为括号内原文', () => {
    const line = '嵌入 ![[目标笔记]] 与 ![[乙/笔记#节|显示]] 结尾'
    const hits = scanEmbedsInLine(line)
    expect(hits.map((h) => h.inner)).toEqual(['目标笔记', '乙/笔记#节|显示'])
    expect(hits[0]!.from).toBe(line.indexOf('![[目标笔记]]'))
    expect(hits[0]!.to).toBe(line.indexOf('![[目标笔记]]') + '![[目标笔记]]'.length)
    expect(hits[1]!.from).toBe(line.indexOf('![[乙/笔记#节|显示]]'))
  })

  it('与双链扫描互斥：![[x]] 只被嵌入扫描命中，[[x]] 只被双链扫描命中', () => {
    const line = '看 [[双链]] 与 ![[嵌入]]'
    expect(scanWikilinksInLine(line).map((h) => h.inner)).toEqual(['双链'])
    expect(scanEmbedsInLine(line).map((h) => h.inner)).toEqual(['嵌入'])
  })

  it('内部目标解析与双链同源：章节/块/别名/本文件锚点照常命中', () => {
    const line = '![[#本文件锚]] ![[笔记#^37066d]]'
    const hits = scanEmbedsInLine(line)
    expect(hits.map((h) => h.inner)).toEqual(['#本文件锚', '笔记#^37066d'])
    expect(parseWikilinkInner(hits[1]!.inner)?.blockId).toBe('37066d')
  })

  it('非法形态不命中（parseWikilinkInner 同款降级）：空别名/多级标题/裸 ^/空目标', () => {
    expect(scanEmbedsInLine('![[笔记|]]')).toHaveLength(0)
    expect(scanEmbedsInLine('![[a#b#c]]')).toHaveLength(0)
    expect(scanEmbedsInLine('![[裸^块]]')).toHaveLength(0)
    expect(scanEmbedsInLine('![[ ]]')).toHaveLength(0)
    expect(scanEmbedsInLine('![[#]]')).toHaveLength(0)
  })

  it('内部含 [ 或 ] 的残缺嵌套不命中；前置 [（[![[x]]] 链接域）不命中', () => {
    expect(scanEmbedsInLine('![[a[b]]')).toHaveLength(0)
    expect(scanEmbedsInLine('![[a]b]]')).toHaveLength(0)
    expect(scanEmbedsInLine('[![[x]]](url)')).toHaveLength(0)
  })

  it('双重感叹 !![[x]] 不命中（首个 ! 为字面前缀）', () => {
    expect(scanEmbedsInLine('!![[x]]')).toHaveLength(0)
  })

  it('未闭合 ![[x 不命中；其后合法嵌入照常命中', () => {
    const hits = scanEmbedsInLine('![[未闭合 后 ![[合法]]')
    expect(hits.map((h) => h.inner)).toEqual(['合法'])
  })

  it('base 偏移：全文行内扫描时 from/to 换算为全文 offset', () => {
    const line = '![[甲]]'
    const hits = scanEmbedsInLine(line, 100)
    expect(hits[0]!.from).toBe(100)
    expect(hits[0]!.to).toBe(100 + line.length)
  })

  it('无嵌入子串的行零命中且不误报', () => {
    expect(scanEmbedsInLine('普通文本 [[双链]] 与 [链接](url)')).toHaveLength(0)
    expect(scanEmbedsInLine('')).toHaveLength(0)
  })
})

describe('embedAtCol：col 命中查找（#217 验收反馈——嵌入链接跳转判定）', () => {
  it('col 落在 ![[…]] 区间内命中（含 ! 前缀端）；双链位置不命中', () => {
    const line = '看 [[双链]] 与 ![[嵌入目标]]'
    const at = line.indexOf('![[嵌入目标]]')
    expect(embedAtCol(line, at)?.inner).toBe('嵌入目标')
    expect(embedAtCol(line, at + 4)?.inner).toBe('嵌入目标')
    expect(embedAtCol(line, at + '![[嵌入目标]]'.length)).toBeNull() // 右端点外
    expect(embedAtCol(line, line.indexOf('双链'))).toBeNull()
  })
})

describe('soleEmbedOfLine：独占正文一行判定（阅读挂载适配）', () => {
  it('整行恰为单个嵌入命中（trim 后覆盖全行）', () => {
    const hit = soleEmbedOfLine('![[目标笔记]]')
    expect(hit?.inner).toBe('目标笔记')
    expect(soleEmbedOfLine('  ![[目标#章节]]  ')?.inner).toBe('目标#章节')
    expect(soleEmbedOfLine('![[笔记#^b1]]')?.inner).toBe('笔记#^b1')
  })

  it('混排（行内有其他内容）不独占', () => {
    expect(soleEmbedOfLine('前缀 ![[目标]]')).toBeNull()
    expect(soleEmbedOfLine('![[目标]] 后缀')).toBeNull()
  })

  it('行内代码包裹不独占（反引号是行内容的一部分）', () => {
    expect(soleEmbedOfLine('`![[目标]]`')).toBeNull()
  })

  it('多个嵌入不独占（首期一次一个目标）', () => {
    expect(soleEmbedOfLine('![[甲]] ![[乙]]')).toBeNull()
  })

  it('非法/残缺嵌入形态不独占（按源文降级）', () => {
    expect(soleEmbedOfLine('![[ ]]')).toBeNull()
    expect(soleEmbedOfLine('![[未闭合')).toBeNull()
    expect(soleEmbedOfLine('![[a#b#c]]')).toBeNull()
  })

  it('纯双链/纯文本行不命中', () => {
    expect(soleEmbedOfLine('[[双链]]')).toBeNull()
    expect(soleEmbedOfLine('普通段落')).toBeNull()
    expect(soleEmbedOfLine('')).toBeNull()
  })
})

describe('#246 embedAtPosition：位置精确命中（inline 渲染规则与扫描器同源）', () => {
  it('从 ![[ 起点命中：区间与 inner 与 scanEmbedsInLine 完全一致', async () => {
    const { embedAtPosition } = await import('../../src/shared/wikilink')
    const line = '看 ![[甲]] 与 ![[乙/丙#节|显]] 及 [[双链]]'
    const hits = scanEmbedsInLine(line)
    expect(embedAtPosition(line, hits[0]!.from, line.length)?.inner).toBe('甲')
    expect(embedAtPosition(line, hits[1]!.from, line.length)?.inner).toBe('乙/丙#节|显')
    expect(embedAtPosition(line, hits[1]!.from, line.length)?.to).toBe(hits[1]!.to)
  })

  it('非起点/越界/前置守卫形态返回 null', async () => {
    const { embedAtPosition } = await import('../../src/shared/wikilink')
    const line = 'x [![[甲]]](u) 与 !![[乙]] 及 ![[丙]]'
    const hit = scanEmbedsInLine(line)[0]!
    expect(hit.inner).toBe('丙') // 前两者被守卫跳过（与扫描器一致）
    expect(embedAtPosition(line, line.indexOf('![[丙]]'), line.length)?.inner).toBe('丙')
    expect(embedAtPosition(line, line.indexOf('[![[甲]]') + 1, line.length)).toBeNull() // prev [
    expect(embedAtPosition(line, line.indexOf('!![[乙]]') + 1, line.length)).toBeNull() // prev !
    expect(embedAtPosition(line, line.indexOf('![[丙]]') + 1, line.length)).toBeNull() // 非起点
    expect(embedAtPosition(line, line.indexOf('![[丙]]'), line.length - 2)).toBeNull() // 越上界
  })

  it('对拍：任意文本上两入口的命中集合逐字节一致', async () => {
    const { embedAtPosition } = await import('../../src/shared/wikilink')
    const lines = [
      '!![[x]] [![[y]]] ![[z]] 混排 ![[未闭合',
      'a ![[b|c]] d ![[e#f]] ![[ ]g]]',
      '!!![[h]] ![[i]]![[j]] ![[k]]]',
      '空串与普通行',
    ]
    for (const line of lines) {
      const scanned = scanEmbedsInLine(line)
      const perPos: typeof scanned = []
      for (let i = 0; i <= line.length; i++) {
        const hit = embedAtPosition(line, i, line.length)
        if (hit) perPos.push(hit)
      }
      expect(perPos, line).toEqual(scanned)
    }
  })
})
