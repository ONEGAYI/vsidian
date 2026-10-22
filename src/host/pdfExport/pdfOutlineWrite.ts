// PDF outline（书签）后处理写入（T05/#625）：pdf-lib 低层手写 /Outlines 树。
//
// pdf-lib 1.17.1 无高层 outline API——低层组装（V01 §7 探针 addOutline
// 实测通过后收编产品化）：PDFHexString.fromText 中文标题 + [pageRef /XYZ
// null null null] dest + Parent/First/Last/Count/Prev/Next 链。树构造用
// shared/pdfOutline 的 outlineTreeOf（纯逻辑可单测，T06 合并多篇时每篇
// 标题挂文档名根即成子树）。
//
// pdf-lib 自本票起为生产依赖（V01 §11 依赖指令；MIT）。

import { PDFDocument, PDFHexString, PDFName, PDFNull, PDFRef } from 'pdf-lib'
import { outlineTreeOf, type PdfOutlineEntry, type PdfOutlineNode } from '../../shared/pdfOutline'

/** 写入 /Outlines 并返回新字节；entries 为空时原样返回（不造空书签树）。
 *  pageIndex 越界的条目防御性跳过（不给伪造目标页）。 */
export async function writePdfOutline(pdfBytes: Uint8Array, entries: readonly PdfOutlineEntry[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes)
  const pageCount = doc.getPageCount()
  const valid = entries.filter((entry) => entry.pageIndex >= 0 && entry.pageIndex < pageCount)
  if (valid.length === 0) {
    return pdfBytes
  }
  const ctx = doc.context
  const pages = doc.getPages()
  const outlinesRef = ctx.nextRef()

  interface WriteNode {
    entry: PdfOutlineEntry
    children: WriteNode[]
    ref: PDFRef
  }
  const assignRefs = (node: PdfOutlineNode): WriteNode => ({
    entry: node.entry,
    children: node.children.map(assignRefs),
    ref: ctx.nextRef(),
  })
  const tops = outlineTreeOf(valid).map(assignRefs)

  const makeDest = (pageIndex: number) =>
    ctx.obj([pages[pageIndex]!.ref, PDFName.of('XYZ'), PDFNull, PDFNull, PDFNull])

  const writeNode = (node: WriteNode, parentRef: PDFRef, prev: WriteNode | undefined, next: WriteNode | undefined): void => {
    ctx.assign(node.ref, ctx.obj({
      Title: PDFHexString.fromText(node.entry.title),
      Parent: parentRef,
      Dest: makeDest(node.entry.pageIndex),
      ...(prev ? { Prev: prev.ref } : {}),
      ...(next ? { Next: next.ref } : {}),
      ...(node.children.length > 0
        ? { First: node.children[0]!.ref, Last: node.children[node.children.length - 1]!.ref, Count: node.children.length }
        : {}),
    }))
    for (let i = 0; i < node.children.length; i++) {
      writeNode(node.children[i]!, node.ref, node.children[i - 1], node.children[i + 1])
    }
  }

  for (let i = 0; i < tops.length; i++) {
    writeNode(tops[i]!, outlinesRef, tops[i - 1], tops[i + 1])
  }

  /** 可见条目总数（顶级 + 全部后代——pdfjs getOutline 展开序读回对齐） */
  const countVisible = (list: WriteNode[]): number =>
    list.reduce((sum, node) => sum + 1 + countVisible(node.children), 0)
  ctx.assign(outlinesRef, ctx.obj({
    Type: 'Outlines',
    First: tops[0]!.ref,
    Last: tops[tops.length - 1]!.ref,
    Count: countVisible(tops),
  }))
  doc.catalog.set(PDFName.of('Outlines'), outlinesRef)
  return doc.save()
}
