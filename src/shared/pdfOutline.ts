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
// T06（#626）合并多篇：locateMergeHeadingsInPages 按篇分段定位（游标
// 重置 + 篇首下界），mergeOutlineEntries 以文档名顶级拼接条目流——
// outlineTreeOf/writePdfOutline 原样复用，写入层零改动。
//
// 零依赖；pdf-lib 写入在宿主模块（shared 不引三方库）。

import { normalizePdfText } from './pdfTextNormalize'

/** 装配层标题埋点（DOM 文档顺序；level 1–6） */
export interface PdfHeadingMark {
  level: number
  /** 标题纯文本（行内标记剥离后的 textContent） */
  text: string
  /** T06（#626）合并导出：所属篇序（merge.docs 下标）。单文档导出缺省
   *  不携带；locateHeadingsInPages 不消费此字段——按篇分段的消费面在
   *  locateMergeHeadingsInPages。 */
  docIndex?: number
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
 *  标题各自命中同页不同偏移，跨页重复标题不再被前次匹配钉住旧页。
 *  startPage（T06）：游标起始页（篇首偏移下界——该页之前的搜索域不
 *  进入；缺省 0 = 从头，既有调用方语义不变；越界钳制到末页防御）。 */
export function locateHeadingsInPages(
  headings: readonly PdfHeadingMark[],
  pageTexts: readonly string[],
  startPage = 0,
): Array<{ heading: PdfHeadingMark; pageIndex: number | undefined }> {
  const normalizedPages = pageTexts.map((text) => normalizePdfText(text))
  let cursorPage = Math.max(0, Math.min(Math.floor(startPage), Math.max(0, normalizedPages.length - 1)))
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

/** T06（#626）合并导出的按篇定位输入：一篇的标题埋点组（docIndex 由
 *  调用方按篇分段，本函数不读该字段） */
export interface PdfMergeHeadingGroup {
  marks: readonly PdfHeadingMark[]
}

/** T06（#626）合并书签定位：按篇分段 + 篇首偏移下界。
 *
 * 语义（相对单游标整卷定位的两处强化）：
 * - **按篇重置游标**：每篇从自己的篇首下界起匹配，篇内重复标题仍按
 *   locateHeadingsInPages 的游标推进依序命中；后篇的同名标题不会再被
 *   前篇区域钉住（单游标会把跨篇重复标题匹配进前篇正文）。
 * - **篇首下界单调推进**：篇 k 的下界 = 篇 k-1 的**最后命中页**（连续
 *   排版两篇可同页）；每篇另起一页（pageBreak）时下界 = 最后命中页 + 1
 *   ——篇 k-1 尾部正文里的同文本不再被误认为篇 k 的标题。某篇全部未
 *   命中时下界不回退（保持上一篇的下界——未命中不构成位置证据）。
 * - 失败如实：各篇未命中的标题 pageIndex undefined（调用方跳过，不伪造）。 */
export function locateMergeHeadingsInPages(
  docs: readonly PdfMergeHeadingGroup[],
  pageTexts: readonly string[],
  pageBreak: boolean,
): Array<Array<{ heading: PdfHeadingMark; pageIndex: number | undefined }>> {
  let lowerBound = 0
  return docs.map(({ marks }) => {
    const located = locateHeadingsInPages(marks, pageTexts, lowerBound)
    let lastHit = -1
    for (const item of located) {
      if (item.pageIndex !== undefined && item.pageIndex > lastHit) lastHit = item.pageIndex
    }
    if (lastHit >= 0) {
      lowerBound = pageBreak ? Math.max(lowerBound, lastHit + 1) : Math.max(lowerBound, lastHit)
    }
    return located
  })
}

/** T06（#626）合并 outline 条目流拼接：每篇以**文档名**（建议传去扩展名
 * 的显示名）为顶级条目（level 1），篇内各标题整体降一级（level + 1），
 * 篇内层级关系原样保持——outlineTreeOf 在此流上按 level 重建嵌套，写入
 * 层零改动。顶级条目页码 = 该篇首个命中标题的页（条目依序生成即首条）；
 * 该篇无任何命中条目时不产生子树（不给伪造目标页）。多篇同名顶级条目
 * 各自保留（书签标题不要求唯一）。 */
export function mergeOutlineEntries(
  docs: ReadonlyArray<{ docName: string; entries: readonly PdfOutlineEntry[] }>,
): PdfOutlineEntry[] {
  const out: PdfOutlineEntry[] = []
  for (const { docName, entries } of docs) {
    if (entries.length === 0) continue
    out.push({ title: docName, level: 1, pageIndex: entries[0]!.pageIndex })
    for (const entry of entries) {
      out.push({ title: entry.title, level: entry.level + 1, pageIndex: entry.pageIndex })
    }
  }
  return out
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
