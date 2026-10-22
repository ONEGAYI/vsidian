// T05（#625）标题书签纯逻辑单元测试：页码定位游标（重复标题按文档顺序
// 推进）、跳过失败标题不给伪造页码、outline 树构造（H1–H6 嵌套）。
// T06（#626）：startPage 篇首偏移、按篇分段定位（游标重置 + 下界推进）
// 与合并条目流拼接（文档名顶级 + 篇内标题降一级）。
import { describe, expect, it } from 'vitest'
import {
  locateHeadingsInPages,
  locateMergeHeadingsInPages,
  mergeOutlineEntries,
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

  it('T06 startPage 篇首偏移：下界之前的页不进入搜索域（游标不回看）', () => {
    const headings: PdfHeadingMark[] = [{ level: 1, text: '重复标题' }]
    // 单游标整卷定位会把该标题匹配进第 0 页；startPage=2 后从第 2 页起搜
    const pages = ['重复标题 前篇区域', '填充', '重复标题 本篇区域']
    expect(locateHeadingsInPages(headings, pages).map((l) => l.pageIndex)).toEqual([0])
    expect(locateHeadingsInPages(headings, pages, 2).map((l) => l.pageIndex)).toEqual([2])
    // 越界钳制（末页防御）与 0 缺省语义不变
    expect(locateHeadingsInPages(headings, pages, 99).map((l) => l.pageIndex)).toEqual([2])
    expect(locateHeadingsInPages(headings, pages, 0).map((l) => l.pageIndex)).toEqual([0])
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

describe('T06（#626）合并书签：按篇分段定位', () => {
  it('跨篇重复标题：后篇不被前篇区域钉住（游标按篇重置 + 下界推进）', () => {
    // 篇 1 与篇 2 的首标题同名「概述」；单游标会把篇 2 的「概述」匹配进
    // 篇 1 的第 0 页——按篇分段后各自命中自己的页
    const docs = [
      { marks: [{ level: 1, text: '概述' }, { level: 2, text: '篇一尾节' }] },
      { marks: [{ level: 1, text: '概述' }] },
    ]
    const pages = ['概述 篇一', '篇一尾节', '概述 篇二']
    const located = locateMergeHeadingsInPages(docs, pages, true)
    expect(located[0]!.map((l) => l.pageIndex)).toEqual([0, 1])
    expect(located[1]!.map((l) => l.pageIndex)).toEqual([2])
  })

  it('pageBreak 开：后篇下界 = 前篇最后命中页 + 1——前篇尾部同文本不误认', () => {
    // 篇 1 最后命中标题在第 0 页，其尾部正文含「附录」字样；篇 2 首标题
    // 也是「附录」。每篇另起一页时篇 2 从第 1 页起搜（第 0 页的前篇尾部
    // 不再进入搜索域）
    const docs = [
      { marks: [{ level: 1, text: '篇一标题' }] },
      { marks: [{ level: 1, text: '附录' }] },
    ]
    const pages = ['篇一标题 尾部提到附录', '附录 篇二正文']
    const located = locateMergeHeadingsInPages(docs, pages, true)
    expect(located[1]![0]!.pageIndex).toBe(1)
  })

  it('pageBreak 关：连续排版两篇可同页（下界不越页推进）', () => {
    const docs = [
      { marks: [{ level: 1, text: '篇一标题' }] },
      { marks: [{ level: 2, text: '篇二标题' }] },
    ]
    const pages = ['篇一标题 篇二标题 同页连续']
    const located = locateMergeHeadingsInPages(docs, pages, false)
    expect(located[0]![0]!.pageIndex).toBe(0)
    expect(located[1]![0]!.pageIndex).toBe(0)
  })

  it('某篇全部未命中：下界不回退，后续篇仍按既有下界定位', () => {
    const docs = [
      { marks: [{ level: 1, text: '篇一标题' }] },
      { marks: [{ level: 1, text: '篇二无正文命中' }] },
      { marks: [{ level: 1, text: '篇三标题' }] },
    ]
    const pages = ['篇一标题', '篇三标题']
    const located = locateMergeHeadingsInPages(docs, pages, true)
    expect(located[1]![0]!.pageIndex).toBeUndefined()
    expect(located[2]![0]!.pageIndex).toBe(1)
  })

  it('篇内重复标题：仍按篇内游标依序推进', () => {
    const docs = [{ marks: [{ level: 2, text: '小节' }, { level: 2, text: '小节' }] }]
    const pages = ['小节 首次', '小节 第二次']
    const located = locateMergeHeadingsInPages(docs, pages, true)
    expect(located[0]!.map((l) => l.pageIndex)).toEqual([0, 1])
  })
})

describe('T06（#626）合并书签：条目流拼接（文档名顶级）', () => {
  it('每篇文档名 level 1，篇内标题整体降一级，篇内层级保持', () => {
    const entries = mergeOutlineEntries([
      {
        docName: '甲篇',
        entries: [
          { title: '甲根标题', level: 1, pageIndex: 0 },
          { title: '甲小节', level: 2, pageIndex: 1 },
        ],
      },
      {
        docName: '乙篇',
        entries: [
          { title: '乙根标题', level: 1, pageIndex: 2 },
        ],
      },
    ])
    expect(entries).toEqual([
      { title: '甲篇', level: 1, pageIndex: 0 },
      { title: '甲根标题', level: 2, pageIndex: 0 },
      { title: '甲小节', level: 3, pageIndex: 1 },
      { title: '乙篇', level: 1, pageIndex: 2 },
      { title: '乙根标题', level: 2, pageIndex: 2 },
    ])
    // 树构造：文档名互为顶级，篇内标题成子树（写入层零改动的实证）
    const tree = outlineTreeOf(entries)
    expect(tree.map((n) => n.entry.title)).toEqual(['甲篇', '乙篇'])
    expect(tree[0]!.children.map((n) => n.entry.title)).toEqual(['甲根标题'])
    expect(tree[0]!.children[0]!.children.map((n) => n.entry.title)).toEqual(['甲小节'])
  })

  it('多篇同名文档名与同篇内重复标题：各自保留（书签标题不要求唯一）', () => {
    const entries = mergeOutlineEntries([
      { docName: 'a', entries: [{ title: '小节', level: 2, pageIndex: 0 }, { title: '小节', level: 2, pageIndex: 1 }] },
      { docName: 'a', entries: [{ title: '小节', level: 2, pageIndex: 2 }] },
    ])
    expect(entries.map((e) => `${e.title}@${e.pageIndex}`).join('|'))
      .toBe('a@0|小节@0|小节@1|a@2|小节@2')
  })

  it('无命中条目的篇不产生子树（不给伪造目标页）；全空为空流', () => {
    expect(mergeOutlineEntries([{ docName: '甲', entries: [] }, { docName: '乙', entries: [{ title: '乙标题', level: 1, pageIndex: 3 }] }]))
      .toEqual([
        { title: '乙', level: 1, pageIndex: 3 },
        { title: '乙标题', level: 2, pageIndex: 3 },
      ])
    expect(mergeOutlineEntries([])).toEqual([])
  })
})
