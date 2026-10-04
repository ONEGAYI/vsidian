// #337 浏览器/集成测试共用的 PDF 样本生成（不引入二进制样本入库——
// #334 探针 genSamples 同口径）：多页纯色样本（每页一种主导色，供「指定
// 页图像与样本正确对应」的像素断言——中心色即页身份）。
import { readFileSync, statSync } from 'node:fs'
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, PDFName, PDFString, rgb } from 'pdf-lib'

/** 红绿蓝循环（页 1=红、2=绿、3=蓝、4=红……——页身份 = (页码-1) % 3） */
const PAGE_COLORS = [
  rgb(0.85, 0.15, 0.15), // 红
  rgb(0.15, 0.85, 0.15), // 绿
  rgb(0.15, 0.15, 0.85), // 蓝
]

/** 三页样本：红/绿/蓝主导色（页面 612×792 pt） */
export async function buildThreePageColorPdf() {
  return buildMultiPageColorPdf(3)
}

/** #338（P3-06）多页样本：红绿蓝循环（全文滚动/窗口回收断言——首中末
 *  页身份色 + 挂载有界） */
export async function buildMultiPageColorPdf(pageCount) {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pageCount; i++) {
    const page = doc.addPage([612, 792])
    page.drawRectangle({ x: 40, y: 40, width: 532, height: 712, color: PAGE_COLORS[i % 3] })
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

// ---- #339（P3-07）文本 + 链接样本：文本层对齐/选区复制与链接层安全面 ----

/** 可选 CJK 字体候选（浏览器/集成测试运行机上有则嵌入中文文本；无则
 *  样本仅西文——中文选区断言按样本能力条件执行，不虚构） */
const CJK_FONT_CANDIDATES = [
  'C:/Windows/Fonts/simhei.ttf',
  'C:/Windows/Fonts/msyh.ttc',
  '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
]

function loadCjkFontBytes() {
  for (const candidate of CJK_FONT_CANDIDATES) {
    try {
      const stat = statSync(candidate)
      if (stat.isFile() && stat.size > 100_000) {
        return readFileSync(candidate)
      }
    } catch {
      // 候选缺席：下一个
    }
  }
  return null
}

/** #339 文本+链接样本：页 1 白底黑字（西文恒定；运行机有 CJK 字体时另
 *  加一行中文），页 2 淡绿底（内部链接跳转目标的绘制层身份）。链接注解
 *  六枚覆盖分类矩阵：内部 GoTo（页引用 dest → 第 2 页）/ https 外链 /
 *  ftp / javascript: / file:// / Launch 动作——后四者须呈禁用态且点击
 *  零动作（安全面）。文本位置固定（100, 700）供 span↔画布墨迹对齐断言。
 */
export async function buildTextLinkPdf() {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit) // 自定义字体（CJK）嵌入必需
  const p1 = doc.addPage([612, 792])
  const p2 = doc.addPage([612, 792])
  const helvetica = await doc.embedFont('Helvetica')
  // 页 1：白底 + 固定位置文本（黑色，绘制层墨迹源）
  p1.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: rgb(1, 1, 1) })
  p1.drawText('The quick brown fox', { x: 100, y: 700, size: 24, font: helvetica, color: rgb(0.05, 0.05, 0.05) })
  // 页 2：淡绿底 + 文本（内部链接目标的页身份）
  p2.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: rgb(0.78, 0.92, 0.78) })
  p2.drawText('Jumps over the lazy dog', { x: 100, y: 700, size: 24, font: helvetica, color: rgb(0.05, 0.05, 0.05) })
  // 条件中文行（运行机有 CJK 字体才嵌入——WinAnsi 标准字体不可编码中文）
  let cjkText = null
  const cjkBytes = loadCjkFontBytes()
  if (cjkBytes !== null) {
    try {
      const cjk = await doc.embedFont(cjkBytes, { subset: true })
      cjkText = '中文文本可供选择复制'
      p1.drawText(cjkText, { x: 100, y: 640, size: 22, font: cjk, color: rgb(0.05, 0.05, 0.05) })
    } catch {
      cjkText = null // TTC 解析失败等：样本保持西文（诚实降级）
    }
  }
  // 链接注解（低阶 API：Link 注解字典 + GoTo/URI/Launch 动作矩阵）
  const link = (rect, action) => ({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 1] })
  const annots = doc.context.obj([
    // ① 内部跳转：GoTo + 页引用 dest → 第 2 页（合法目标）
    { ...link([100, 500, 360, 532]), A: { Type: 'Action', S: 'GoTo', D: [p2.ref, 'XYZ', 0, 720, null] } },
    // ② https 外链：显式点击 → 宿主 openExternal
    { ...link([100, 440, 360, 472]), A: { Type: 'Action', S: 'URI', URI: PDFString.of('https://example.com/pdf-doc-link') } },
    // ③ ftp：pdfjs 出 url 但非 http(s) → 禁用（protocol）
    { ...link([100, 380, 360, 412]), A: { Type: 'Action', S: 'URI', URI: PDFString.of('ftp://files.example.com/doc') } },
    // ④ javascript：pdfjs 判非法协议（只留 unsafeUrl）→ 禁用（none）
    { ...link([100, 320, 360, 352]), A: { Type: 'Action', S: 'URI', URI: PDFString.of('javascript:alert(1)') } },
    // ⑤ file：同上禁用（不读取工作区任意文件的安全边界）
    { ...link([100, 260, 360, 292]), A: { Type: 'Action', S: 'URI', URI: PDFString.of('file:///c:/windows/win.ini') } },
    // ⑥ Launch 动作：明确不执行（安全边界——外程序启动被禁用）
    { ...link([100, 200, 360, 232]), A: { Type: 'Action', S: 'Launch', F: 'calc.exe' } },
  ])
  p1.node.set(PDFName.of('Annots'), annots)
  return { bytes: Buffer.from(await doc.save()), cjkText }
}
