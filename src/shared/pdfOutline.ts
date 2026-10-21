// PDF 标题书签纯逻辑（T05/#625）：页码定位游标与 outline 树构造。
//
// 定位语义（V01 §7 方案 1 的产品化）：
// - 输入：装配层标题埋点（文档顺序）+ pdfjs 逐页提取文本；
// - 匹配：双端过 normalizePdfText（NFKC + 部首对照 + 去空白），标题文本
//   在页文本中 contains 命中；
// - 重复标题：按文档顺序游标推进——每个标题从上一命中页起向后搜索，
//   不回退（同文本标题依序匹配到不同页）；
// - 失败如实：标题未命中任何页 → pageIndex undefined（调用方跳过该条，
//   不给伪造页码；全部失败由调用方决定整份不加书签）。
//
// 树构造：H1–H6 按 level 嵌套，深层标题挂最近的更浅祖先；无祖先的深层
// 条目升为顶级（不丢条目——与 V01 探针 addOutline 算法一致）。
// T06 合并多篇扩展位：每篇标题作为子树挂文档名根节点即可复用本构造
//（条目流仍是 (title, level, pageIndex) 扁平序列）。
//
// 零依赖；pdf-lib 写入在宿主模块（shared 不引三方库）。

import { normalizePdfText } from './pdfTextNormalize'

/** 装配层标题埋点（DOM 文档顺序；level 1–6） */
export interface PdfHeadingMark {
  level: number
  /** 标题纯文本（行内标记剥离后的 textContent） */
  text: string
}

/** outline 条目（pageIndex 0 起） */
export interface PdfOutlineEntry {
  title: string
  level: number
  pageIndex: number
}

/** outline 树节点（写入 /Outlines 的中间形态） */
export interface PdfOutlineNode {
  entry: PdfOutlineEntry
  children: PdfOutlineNode[]
}

/** 标题 → 页码定位：逐条返回 pageIndex（0 起）；未命中 undefined。
 *  游标推进含页内偏移：上一命中的 (页, 偏移) 之后搜索——同页多个重复
 *  标题各自命中同页不同偏移，跨页重复标题不再被前次匹配钉住旧页。 */
export function locateHeadingsInPages(
  headings: readonly PdfHeadingMark[],
  pageTexts: readonly string[],
): Array<{ heading: PdfHeadingMark; pageIndex: number | undefined }> {
  const normalizedPages = pageTexts.map((text) => normalizePdfText(text))
  let cursorPage = 0
  let cursorOffset = 0
  return headings.map((heading) => {
    const needle = normalizePdfText(heading.text)
    if (needle === '') return { heading, pageIndex: undefined }
    // 当前游标页的剩余部分
    let offset = normalizedPages[cursorPage]?.indexOf(needle, cursorOffset) ?? -1
    if (offset >= 0) {
      cursorOffset = offset + needle.length
      return { heading, pageIndex: cursorPage }
    }
    // 后续页从头搜索
    for (let page = cursorPage + 1; page < normalizedPages.length; page++) {
      offset = normalizedPages[page]!.indexOf(needle)
      if (offset >= 0) {
        cursorPage = page
        cursorOffset = offset + needle.length
        return { heading, pageIndex: page }
      }
    }
    return { heading, pageIndex: undefined }
  })
}

/** 定位结果 → outline 条目：过滤未命中项（保持文档顺序；不给伪造页码） */
export function outlineEntriesOf(
  located: ReadonlyArray<{ heading: PdfHeadingMark; pageIndex: number | undefined }>,
): PdfOutlineEntry[] {
  return located
    .filter((item) => item.pageIndex !== undefined)
    .map((item) => ({ title: item.heading.text, level: item.heading.level, pageIndex: item.pageIndex! }))
}

/** 扁平条目 → 嵌套树（深层挂最近浅层祖先；孤立深层升顶级不丢条目） */
export function outlineTreeOf(entries: readonly PdfOutlineEntry[]): PdfOutlineNode[] {
  interface BuildNode {
    entry: PdfOutlineEntry
    children: BuildNode[]
    parent: BuildNode | undefined
  }
  const roots: BuildNode[] = []
  let lastByLevel = new Map<number, BuildNode>()
  for (const entry of entries) {
    const node: BuildNode = { entry, children: [], parent: undefined }
    let parent: BuildNode | undefined
    for (let level = entry.level - 1; level >= 1; level--) {
      const candidate = lastByLevel.get(level)
      if (candidate) { parent = candidate; break }
    }
    if (parent) {
      node.parent = parent
      parent.children.push(node)
    } else {
      roots.push(node)
      lastByLevel = new Map([[entry.level, node]])
    }
    lastByLevel.set(entry.level, node)
  }
  const toPlain = (node: BuildNode): PdfOutlineNode =>
    ({ entry: node.entry, children: node.children.map(toPlain) })
  return roots.map(toPlain)
}
