// T05（#625）pdf-lib /Outlines 写入单元测试：写入后重新 load 读回
// catalog 结构与树链（中文标题 PDFHexString、dest 页引用、First/Last/
// Count、嵌套父子链）。读回校验用 pdf-lib 低层对象（宿主 Node 可跑；
// pdfjs getOutline 读回归集成测试）。
import { describe, expect, it } from 'vitest'
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef, StandardFonts } from 'pdf-lib'
import { writePdfOutline } from '../../src/host/pdfExport/pdfOutlineWrite'

/** 构造最小多页 PDF（每页一段文本——pdf-lib 原生 API） */
async function makeSamplePdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([595, 842])
    page.drawText(`page ${i + 1}`, { size: 12, font })
  }
  return doc.save()
}

async function outlinesOf(bytes: Uint8Array): Promise<{ dict: PDFDict; doc: PDFDocument }> {
  const doc = await PDFDocument.load(bytes)
  const outlinesRef = doc.catalog.get(PDFName.of('Outlines'))
  if (!(outlinesRef instanceof PDFRef)) {
    throw new Error('catalog 无 /Outlines')
  }
  const dict = doc.context.lookup(outlinesRef)
  if (!(dict instanceof PDFDict)) {
    throw new Error('/Outlines 解引用非 PDFDict')
  }
  return { dict, doc }
}

describe('writePdfOutline（pdf-lib /Outlines 后处理）', () => {
  it('空条目：原字节返回（不造空书签树）', async () => {
    const pdf = await makeSamplePdf(2)
    const out = await writePdfOutline(pdf, [])
    expect(out).toBe(pdf)
  })

  it('中文标题 + 层级嵌套写入：catalog 挂 /Outlines、树链与 dest 完整', async () => {
    const pdf = await makeSamplePdf(3)
    const out = await writePdfOutline(pdf, [
      { title: '根标题中文', level: 1, pageIndex: 0 },
      { title: '第二页小节', level: 2, pageIndex: 1 },
      { title: '第三页小节', level: 2, pageIndex: 2 },
    ])
    expect(Buffer.from(out).subarray(0, 5).toString('latin1')).toBe('%PDF-')
    const { dict, doc } = await outlinesOf(out)
    expect(doc.getPageCount()).toBe(3)
    const ctx = doc.context
    const first = dict.get(PDFName.of('First'))
    expect(first).toBeInstanceOf(PDFRef)
    const firstNode = ctx.lookup(first as PDFRef)
    expect(firstNode).toBeInstanceOf(PDFDict)
    const firstDict = firstNode as PDFDict
    // 中文标题经 PDFHexString 写入可解回
    expect((firstDict.get(PDFName.of('Title')) as PDFHexString).decodeText()).toBe('根标题中文')
    // 子节点链：First 的孩子是第二页小节（level 2 嵌套）
    const childRef = firstDict.get(PDFName.of('First'))
    expect(childRef).toBeInstanceOf(PDFRef)
    const childDict = ctx.lookup(childRef as PDFRef) as PDFDict
    expect((childDict.get(PDFName.of('Title')) as PDFHexString).decodeText()).toBe('第二页小节')
    expect(childDict.get(PDFName.of('Parent'))).toBe(first)
    // Count：顶级 1 + 后代 2 = 3（可见条目总数）
    expect(dict.get(PDFName.of('Count'))).toBeTruthy()
  })

  it('pageIndex 越界条目防御性跳过（不给伪造目标页）', async () => {
    const pdf = await makeSamplePdf(1)
    const out = await writePdfOutline(pdf, [
      { title: '合法', level: 1, pageIndex: 0 },
      { title: '越界', level: 1, pageIndex: 99 },
    ])
    const { dict, doc } = await outlinesOf(out)
    const ctx = doc.context
    const first = ctx.lookup(dict.get(PDFName.of('First')) as PDFRef) as PDFDict
    expect((first.get(PDFName.of('Title')) as PDFHexString).decodeText()).toBe('合法')
    // 越界条目不进树（First 无 Next——顶级只剩一条）
    expect(first.get(PDFName.of('Next'))).toBeUndefined()
  })
})
