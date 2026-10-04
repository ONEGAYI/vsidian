// #337 浏览器/集成测试共用的 PDF 样本生成（不引入二进制样本入库——
// #334 探针 genSamples 同口径）：多页纯色样本（每页一种主导色，供「指定
// 页图像与样本正确对应」的像素断言——中心色即页身份）。
import { PDFDocument, rgb } from 'pdf-lib'

/** 三页样本：红/绿/蓝主导色（页面 612×792 pt） */
export async function buildThreePageColorPdf() {
  const doc = await PDFDocument.create()
  const colors = [
    rgb(0.85, 0.15, 0.15), // 页 1：红
    rgb(0.15, 0.85, 0.15), // 页 2：绿
    rgb(0.15, 0.15, 0.85), // 页 3：蓝
  ]
  for (const color of colors) {
    const page = doc.addPage([612, 792])
    page.drawRectangle({ x: 40, y: 40, width: 532, height: 712, color })
  }
  return Buffer.from(await doc.save())
}

/** 单页轻样本（西文文本，最小体积） */
export async function buildSinglePagePdf() {
  const doc = await PDFDocument.create()
  const page = doc.addPage([612, 792])
  page.drawRectangle({ x: 60, y: 650, width: 492, height: 60, color: rgb(0.1, 0.1, 0.1) })
  return Buffer.from(await doc.save())
}
