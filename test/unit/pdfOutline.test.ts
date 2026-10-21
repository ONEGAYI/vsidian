// T05（#625）标题书签纯逻辑单元测试：页码定位游标（重复标题按文档顺序
// 推进）、跳过失败标题不给伪造页码、outline 树构造（H1–H6 嵌套）。
import { describe, expect, it } from 'vitest'
import {
  locateHeadingsInPages,
  outlineEntriesOf,
  outlineTreeOf,
  type PdfHeadingMark,
  type PdfOutlineEntry,
} from '../../src/shared/pdfOutline'

describe('标题 → 页码定位（游标推进）', () => {
  it('基本定位：标题文本在对应页命中', () => {
    const headings: PdfHeadingMark[] = [
      { level: 1, text: '根标题' },
      { level: 2, text: '小节甲' },
      { level: 2, text: '小节乙' },
    ]
    const pages = ['根标题 正文', '填充内容', '小节甲 内容', '小节乙 内容']
    expect(locateHeadingsInPages(headings, pages).map((l) => l.pageIndex))
      .toEqual([0, 2, 3])
  })

  it('重复标题：按文档顺序游标推进，不重复命中同一页', () => {
    const headings: PdfHeadingMark[] = [
      { level: 1, text: '重复标题' },
      { level: 2, text: '中间节' },
      { level: 1, text: '重复标题' },
      { level: 1, text: '重复标题' },
    ]
    const pages = ['重复标题 首次', '中间节', '重复标题 第二次', '填充', '重复标题 第三次']
    expect(locateHeadingsInPages(headings, pages).map((l) => l.pageIndex))
      .toEqual([0, 1, 2, 4])
  })

  it('定位失败：pageIndex 为 undefined（不给伪造页码），不影响后续标题', () => {
    const headings: PdfHeadingMark[] = [
      { level: 1, text: '存在标题' },
      { level: 2, text: '不存在的标题' },
      { level: 2, text: '后续标题' },
    ]
    const pages = ['存在标题', '后续标题 在第二页']
    const located = locateHeadingsInPages(headings, pages)
    expect(located[0]!.pageIndex).toBe(0)
    expect(located[1]!.pageIndex).toBeUndefined()
    expect(located[2]!.pageIndex).toBe(1)
  })

  it('匹配前过文本归一：Chromium 部首兼容码位不阻断命中', () => {
    const headings: PdfHeadingMark[] = [{ level: 1, text: '页面设计' }]
    // 模拟 Chromium ToUnicode 把「页」「面」落在部首兼容码位
    expect(locateHeadingsInPages(headings, ['⻚⾯设计 正文'])[0]!.pageIndex).toBe(0)
  })

  it('空文本标题跳过（undefined——不伪造）', () => {
    expect(locateHeadingsInPages([{ level: 2, text: '' }], ['正文'])[0]!.pageIndex).toBeUndefined()
  })
})

describe('outline 条目与树构造', () => {
  it('outlineEntriesOf 过滤定位失败项（保持文档顺序）', () => {
    const headings: PdfHeadingMark[] = [
      { level: 1, text: '甲' },
      { level: 2, text: '失' },
      { level: 2, text: '乙' },
    ]
    const pages = ['甲 乙']
    const located = locateHeadingsInPages(headings, pages)
    expect(outlineEntriesOf(located)).toEqual([
      { title: '甲', level: 1, pageIndex: 0 },
      { title: '乙', level: 2, pageIndex: 0 },
    ])
  })

  it('H1–H6 嵌套：深层标题挂最近浅层祖先', () => {
    const entries: PdfOutlineEntry[] = [
      { title: 'H1 甲', level: 1, pageIndex: 0 },
      { title: 'H2 甲一', level: 2, pageIndex: 0 },
      { title: 'H3 甲一(1)', level: 3, pageIndex: 1 },
      { title: 'H2 甲二', level: 2, pageIndex: 2 },
      { title: 'H1 乙', level: 1, pageIndex: 3 },
      { title: 'H4 乙一', level: 4, pageIndex: 3 },
    ]
    const tree = outlineTreeOf(entries)
    expect(tree.map((n) => n.entry.title)).toEqual(['H1 甲', 'H1 乙'])
    expect(tree[0]!.children.map((n) => n.entry.title)).toEqual(['H2 甲一', 'H2 甲二'])
    expect(tree[0]!.children[0]!.children.map((n) => n.entry.title)).toEqual(['H3 甲一(1)'])
    expect(tree[1]!.children[0]!.children).toEqual([])
    // 深层无浅层祖先（首条即 H4）：挂前一个顶级（探针算法语义——不丢条目）
    const oddTree = outlineTreeOf([{ title: '孤立深', level: 4, pageIndex: 0 }])
    expect(oddTree.map((n) => n.entry.title)).toEqual(['孤立深'])
  })

  it('层级跳降后再升（H3 → H1 → H2）按 level 语义重建', () => {
    const entries: PdfOutlineEntry[] = [
      { title: 'a1', level: 1, pageIndex: 0 },
      { title: 'a3', level: 3, pageIndex: 0 },
      { title: 'b1', level: 1, pageIndex: 1 },
      { title: 'b2', level: 2, pageIndex: 1 },
    ]
    const tree = outlineTreeOf(entries)
    expect(tree.map((n) => n.entry.title)).toEqual(['a1', 'b1'])
    expect(tree[0]!.children[0]!.entry.title).toBe('a3')
    expect(tree[1]!.children[0]!.entry.title).toBe('b2')
  })

  it('空表与空标题：空树 / 无伪造', () => {
    expect(outlineTreeOf([])).toEqual([])
  })
})
