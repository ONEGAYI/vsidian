// 双链文件字段识别器单测（#376 T01）：闭合空双链 [[]] / ![[]]、文件前缀
// 输入、别名/锚点字段边界与残缺形态降级。识别器是新增局部逻辑——既有
// 完整渲染解析器（wikilink.ts）的命中集合不因本模块扩大（对照断言）。
import { describe, expect, it } from 'vitest'
import { findWikilinkFileField } from '../../src/shared/wikilinkField'
import { parseWikilinkInner, scanEmbedsInLine, scanWikilinksInLine } from '../../src/shared/wikilink'

/** 便于断言：返回 {embed, openFrom, fieldFrom, fieldTo, closeFrom} 简写 */
const at = (line: string, col: number) => findWikilinkFileField(line, col)

describe('findWikilinkFileField（新建闭合空双链）', () => {
  it('[[]] 空字段命中，查询为空', () => {
    expect(at('[[]]', 2)).toEqual({ embed: false, openFrom: 0, fieldFrom: 2, fieldTo: 2, closeFrom: 2 })
  })

  it('![[]] 嵌入前缀命中，openFrom 含 !', () => {
    expect(at('![[]]', 3)).toEqual({ embed: true, openFrom: 0, fieldFrom: 3, fieldTo: 3, closeFrom: 3 })
  })

  it('行内前置文字不影响（openFrom/字段为行内偏移）', () => {
    expect(at('正文 [[]] 尾', 5)).toEqual({ embed: false, openFrom: 3, fieldFrom: 5, fieldTo: 5, closeFrom: 5 })
  })
})

describe('findWikilinkFileField（文件前缀输入与光标位置）', () => {
  it('目标中部光标：查询为光标左侧前缀', () => {
    // [[方案¦]] —— col = 4（'方案' 之后、]] 之前）
    expect(at('[[方案]]', 4)).toEqual({ embed: false, openFrom: 0, fieldFrom: 2, fieldTo: 4, closeFrom: 4 })
  })

  it('目标中部编辑已有别名链接：[[A¦a|B]] 命中且 fieldTo 在 | 前', () => {
    // col = 3（A 之后）：fieldTo = 首个 | 的位置 4
    expect(at('[[Aa|B]]', 3)).toEqual({ embed: false, openFrom: 0, fieldFrom: 2, fieldTo: 4, closeFrom: 6 })
  })

  it('显示文字区不命中（[[Aa|B¦]]）', () => {
    expect(at('[[Aa|B]]', 7)).toBeNull()
  })

  it('别名分隔符左侧光标（[[Aa¦|B]]）命中', () => {
    expect(at('[[Aa|B]]', 4)).toEqual({ embed: false, openFrom: 0, fieldFrom: 2, fieldTo: 4, closeFrom: 6 })
    // 分隔符右侧（显示区）不命中
    expect(at('[[Aa|B]]', 5)).toBeNull()
  })

  it('空字段键入 # 后不命中（锚点字段归后续票）', () => {
    expect(at('[[#]]', 3)).toBeNull()
  })

  it('标题字段中部不命中（[[Aa#标¦题]]）', () => {
    expect(at('[[Aa#标题]]', 6)).toBeNull()
  })

  it('嵌入前缀输入中部命中（![[]] 内键入）', () => {
    expect(at('![[方案]]', 5)).toEqual({ embed: true, openFrom: 0, fieldFrom: 3, fieldTo: 5, closeFrom: 5 })
  })

  it('闭合之后光标不命中（[[Aa]]¦）', () => {
    expect(at('[[Aa]]', 6)).toBeNull()
  })

  it('同一行第二处围栏独立命中', () => {
    // [[a]] [[b¦]] —— 光标在第二处闭围栏前（col=9）
    expect(at('[[a]] [[b]]', 9)).toEqual({ embed: false, openFrom: 6, fieldFrom: 8, fieldTo: 9, closeFrom: 9 })
    // 光标在第一处同样命中第一处
    expect(at('[[a]] [[b]]', 3)).toEqual({ embed: false, openFrom: 0, fieldFrom: 2, fieldTo: 3, closeFrom: 3 })
    // 落在闭围栏中间（两 ] 之间）不命中
    expect(at('[[a]] [[b]]', 10)).toBeNull()
  })
})

describe('findWikilinkFileField（残缺形态降级）', () => {
  it('未闭合（[[Aa）不命中', () => {
    expect(at('[[Aa', 4)).toBeNull()
  })

  it('三连括号（[[[¦]]）不命中', () => {
    expect(at('[[[]]', 3)).toBeNull()
  })

  it('内部残缺方括号（[[a[b]]）不命中', () => {
    expect(at('[[a[b]]', 7)).toBeNull()
  })

  it('围栏外光标不命中', () => {
    expect(at('正文', 2)).toBeNull()
    expect(at('[[a]] [[b]]', 5)).toBeNull()
  })

  it('!![[ 与 [![[ 前置守卫不命中', () => {
    expect(at('!![[]]', 5)).toBeNull()
    expect(at('[![[]]', 6)).toBeNull()
  })

  it('越界 col 返回 null（防御）', () => {
    expect(at('[[a]]', -1)).toBeNull()
    expect(at('[[a]]', 7)).toBeNull()
  })
})

describe('识别器不放宽既有完整渲染解析器', () => {
  it('识别器命中的空字段在渲染解析器中仍非法（parseWikilinkInner null）', () => {
    expect(at('[[]]', 2)).not.toBeNull()
    expect(parseWikilinkInner('')).toBeNull()
  })

  it('识别器命中的显示文字区在渲染解析器中仍合法（互为补充不互改）', () => {
    expect(parseWikilinkInner('方案|显示')).not.toBeNull()
    expect(at('[[方案|显示]]', 7)).toBeNull() // 显示区不触发联想
  })

  it('既有扫描器命中集合不变（双链/嵌入互斥照旧）', () => {
    const line = '[[a]] ![[b.png]]'
    expect(scanWikilinksInLine(line)).toHaveLength(1)
    expect(scanEmbedsInLine(line)).toHaveLength(1)
  })
})
