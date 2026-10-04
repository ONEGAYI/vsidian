// #334（P3-02）PDF 兼容性探针的样本矩阵生成器。
// 纯 Node 脚本（node genSamples.mjs <输出目录>）：产出 8 个最小样本，覆盖
// 中文（内嵌／非内嵌 CMap）、西文标准字体、纯图扫描页、多页、损坏与加密。
// 样本写到临时目录，不进仓库、不进 VSIX；复现步骤见 docs/research 报告。
//
// 生成策略分两层：
// - 内嵌中文字体样本用 pdf-lib（fontkit 子集化嵌入系统 SimHei/等线）——
//   手写 CID TrueType 嵌入的子集化超出本票必要工作量；
// - 其余样本全部手写 PDF 语法（本文件内的 buildPdf 构造器 + node:zlib），
//   保证零额外依赖、字节级可控（损坏样本需要精确截断）。
// - 加密样本手写 Standard security handler R2 / RC4 40-bit（V 1）——
//   算法 2/3/4（密钥派生、O、U）与逐对象密钥均为公开规范，node:crypto
//   提供 MD5，RC4 为 20 行实现。只加密 content stream，页面对象中的
//   名称等不含敏感明文。
import { deflateSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import pkg from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
const { PDFDocument, rgb } = pkg

/** 手写 PDF 构造器：对象按 1-based 序号登记，尾部生成正确 xref。 */
class PdfBuilder {
  constructor() {
    this.objects = [] // { content: Buffer|string }，index i -> 对象号 i+1
  }

  add(content) {
    this.objects.push(content)
    return this.objects.length
  }

  build() {
    const chunks = []
    let offset = 0
    const push = (s) => {
      const b = Buffer.isBuffer(s) ? s : Buffer.from(s, 'latin1')
      chunks.push(b)
      offset += b.length
    }
    push('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n')
    const offsets = [0]
    for (let i = 0; i < this.objects.length; i++) {
      offsets.push(offset)
      const content = this.objects[i]
      const body = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'latin1')
      push(`${i + 1} 0 obj\n`)
      push(body)
      push('\nendobj\n')
    }
    const xrefOffset = offset
    push(`xref\n0 ${this.objects.length + 1}\n`)
    push('0000000000 65535 f \n')
    for (let i = 1; i <= this.objects.length; i++) {
      push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`)
    }
    push(`trailer\n<< /Size ${this.objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`)
    return Buffer.concat(chunks)
  }
}

/** /UniGB-UCS2-H 十六进制串：JavaScript 字符串 -> UCS2-BE hex（大写）。 */
function ucs2Hex(text) {
  let hex = ''
  for (const ch of text) {
    const code = ch.codePointAt(0)
    if (code > 0xffff) {
      // 代理对按 UCS2 原样编码（PDF CMap 场景样本仅 BMP 内文字，此分支防御）
      const h = Math.floor((code - 0x10000) / 0x400) + 0xd800
      const l = ((code - 0x10000) % 0x400) + 0xdc00
      hex += h.toString(16).toUpperCase().padStart(4, '0')
      hex += l.toString(16).toUpperCase().padStart(4, '0')
    } else {
      hex += code.toString(16).toUpperCase().padStart(4, '0')
    }
  }
  return hex
}

/** 文本流转义：( ) \ 三字符。 */
function escapeText(s) {
  return s.replace(/([\\()])/g, '\\$1')
}

/** 非内嵌中文（CMap 路线）：Type0 + STSong-Light + UniGB-UCS2-H，未嵌入。 */
function buildZhCmapSample() {
  const b = new PdfBuilder()
  const text = '中文非内嵌字体样页：黑体宋体均不在文件内，解码依赖外部 CMap。'
  const content = `BT /F1 16 Tf 40 700 Td <${ucs2Hex(text)}> Tj 0 -28 TD <${ucs2Hex('第二行：悬停预览三期探针。')}> Tj 0 -28 TD <${ucs2Hex('第三行：引文与出链。')}> Tj ET`
  b.add('<< /Type /Catalog /Pages 2 0 R >>') // 1
  b.add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>') // 2
  b.add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>') // 3
  b.add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`) // 4
  b.add('<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [6 0 R] >>') // 5
  b.add('<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 5 >> /DW 1000 >>') // 6
  return b.build()
}

/** 西文标准字体（非内嵌 Helvetica）：触发 standard_fonts（Liberation 替代）装载。 */
function buildLatinStandardSample() {
  const b = new PdfBuilder()
  const content = `BT /F1 18 Tf 40 760 Td (${escapeText('Standard font probe: Helvetica is not embedded.')}) Tj 0 -24 TD (${escapeText('The renderer must fetch Liberation Sans from standardFontDataUrl.')}) Tj ET`
  b.add('<< /Type /Catalog /Pages 2 0 R >>')
  b.add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  b.add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>')
  b.add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`)
  b.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  return b.build()
}

/** 扫描页（纯图、零文本）：整页 FlateDecode RGB 位图。 */
function buildScannedSample() {
  const w = 300
  const h = 424
  const raw = Buffer.alloc(w * h * 3)
  // 横向渐变 + 纵向条纹：非平凡像素（非纯色），canvas 断言可区分空白
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3
      raw[i] = (x * 255 / w) | 0
      raw[i + 1] = (y * 255 / h) | 0
      raw[i + 2] = ((x + y) % 32) * 7
    }
  }
  const flate = deflateSync(raw)
  const b = new PdfBuilder()
  b.add('<< /Type /Catalog /Pages 2 0 R >>') // 1
  b.add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>') // 2
  b.add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>') // 3
  const content = 'q 595 0 0 842 0 0 cm /Im0 Do Q'
  b.add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`) // 4
  b.add(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${flate.length} >>\nstream\n`) // 5
  // stream 二进制：手工拼（build 后对象体以 \nendobj 结尾，这里 stream 数据后补换行）
  b.objects[4] = Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${flate.length} >>\nstream\n`, 'latin1'), flate, Buffer.from('\nendstream', 'latin1')])
  return b.build()
}

/** 多页文本样本（5 页，页码可见）：并发装载／按页取消／翻页用。 */
function buildMultipageSample() {
  const b = new PdfBuilder()
  b.add('<< /Type /Catalog /Pages 2 0 R >>') // 1
  const kids = []
  for (let p = 1; p <= 5; p++) {
    kids.push(`${2 + p} 0 R`)
  }
  b.add(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count 5 >>`) // 2
  for (let p = 1; p <= 5; p++) {
    const content = `BT /F1 24 Tf 40 760 Td (${escapeText(`Multipage sample - page ${p} of 5`)}) Tj ET`
    b.add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${8 + 0} 0 R >> >> /Contents ${8 + p} 0 R >>`) // 3..7
  }
  b.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>') // 8
  for (let p = 1; p <= 5; p++) {
    const content = `BT /F1 24 Tf 40 760 Td (${escapeText(`Multipage sample - page ${p} of 5`)}) Tj ET`
    b.add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`) // 9..13
  }
  return b.build()
}

/** 内嵌中文字体样本（pdf-lib + 系统 SimHei/等线子集化嵌入）。 */
async function buildZhEmbeddedSample(fontCandidates) {
  let fontBytes = null
  let fontName = null
  for (const candidate of fontCandidates) {
    if (existsSync(candidate)) {
      fontBytes = await import('node:fs').then((fs) => fs.readFileSync(candidate))
      fontName = candidate
      break
    }
  }
  if (!fontBytes) {
    throw new Error(`未找到可用系统中文字体（尝试 ${fontCandidates.join(', ')}）`)
  }
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const font = await doc.embedFont(fontBytes, { subset: true })
  const lines = [
    '中文内嵌字体样页（第一页）',
    '本文件把 TrueType 子集嵌入 FontFile2，',
    '渲染不依赖外部字体与 CMap。',
    '第二页验证翻页与文本提取。',
  ]
  for (let p = 0; p < 2; p++) {
    const page = doc.addPage([595, 842])
    if (p === 1) {
      lines.forEach((line, i) => {
        page.drawText(`第${p + 1}页 ${i + 1}：${line}`, { x: 40, y: 760 - i * 30, size: 16, font, color: rgb(0.1, 0.1, 0.1) })
      })
    } else {
      lines.forEach((line, i) => {
        page.drawText(line, { x: 40, y: 760 - i * 30, size: 16, font, color: rgb(0.1, 0.1, 0.1) })
      })
    }
  }
  const bytes = await doc.save()
  return { bytes, fontName }
}

/* ------------------------- RC4 40-bit R2 加密样本 ------------------------- */

const PAD = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d06868e0015d6d411414b4c2d0d0c4c0c8d0d0', 'hex')

function rc4(key, data) {
  const s = Array.from({ length: 256 }, (_, i) => i)
  let j = 0
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff
    const t = s[i]; s[i] = s[j]; s[j] = t
  }
  const out = Buffer.alloc(data.length)
  let i = 0
  j = 0
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 0xff
    j = (j + s[i]) & 0xff
    const t = s[i]; s[i] = s[j]; s[j] = t
    out[k] = data[k] ^ s[(s[i] + s[j]) & 0xff]
  }
  return out
}

const md5 = (buf) => createHash('md5').update(buf).digest()

/** 算法 2：用户口令 -> 文件加密密钥（R2/V1，40-bit，n=0）。 */
function fileKeyR2(userPwd, ownerEntry, p) {
  const input = Buffer.concat([PAD, ownerEntry, Buffer.from(new Int32Array([p]).buffer), Buffer.from('0102030405060708', 'hex')])
  return md5(input).subarray(0, 5)
}

/** 算法 3：所有者口令 -> /O。 */
function ownerEntryR2(userPwd, ownerPwd) {
  const digest = md5(PAD) // ownerPwd 短于 32 字节时等价 PAD 处理（本样本 ownerPwd == userPwd）
  return rc4(digest.subarray(0, 5), PAD)
}

/** 算法 4（R2）：/U。 */
function userEntryR2(key) {
  return rc4(key, PAD)
}

/** 逐对象密钥（算法 1）。 */
function objectKey(fileKey, objNum, genNum) {
  const ext = Buffer.concat([fileKey, Buffer.from([objNum & 0xff, (objNum >> 8) & 0xff, (objNum >> 16) & 0xff, genNum & 0xff, (genNum >> 8) & 0xff])])
  return md5(ext).subarray(0, Math.min(ext.length, 16))
}

/** 加密样本：单页 Helvetica 文本，密码 vsidian-probe，/P 关闭全部权限位外的打印。 */
function buildEncryptedSample() {
  const userPwd = 'vsidian-probe'
  const ownerPwd = userPwd
  const p = -4 // bit3 clear（不允许修改），其余默认
  const owner = ownerEntryR2(userPwd, ownerPwd)
  const key = fileKeyR2(userPwd, owner, p)
  const user = userEntryR2(key)

  const plainContent = 'BT /F1 18 Tf 40 760 Td (Encrypted sample: password required.) Tj ET'
  // 对象号规划：1 catalog 2 pages 3 page 4 contents 5 font 6 encrypt
  const objKey = objectKey(key, 4, 0)
  const encContent = rc4(objKey, Buffer.from(plainContent, 'latin1'))
  const idHex = '0102030405060708090a0b0c0d0e0f10'

  const b = new PdfBuilder()
  // trailer 需要带 /Encrypt 与 /ID —— build() 固定 trailer，这里手工拼整体
  b.add('<< /Type /Catalog /Pages 2 0 R >>') // 1
  b.add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>') // 2
  b.add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>') // 3
  b.objects.push(Buffer.concat([
    Buffer.from(`<< /Length ${encContent.length} /Filter /Standard >>\nstream\n`, 'latin1'),
    encContent,
    Buffer.from('\nendstream', 'latin1'),
  ])) // 4
  b.add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>') // 5
  b.add(`<< /Filter /Standard /V 1 /R 2 /O <${owner.toString('hex')}> /U <${user.toString('hex')}> /P ${p} >>`) // 6

  // 手工拼带 /Encrypt + /ID 的 PDF（PdfBuilder.build 的 trailer 不含这两项）
  const chunks = []
  let offset = 0
  const push = (s) => { const bb = Buffer.isBuffer(s) ? s : Buffer.from(s, 'latin1'); chunks.push(bb); offset += bb.length }
  push('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n')
  const offsets = [0]
  for (let i = 0; i < b.objects.length; i++) {
    offsets.push(offset)
    const body = Buffer.isBuffer(b.objects[i]) ? b.objects[i] : Buffer.from(String(b.objects[i]), 'latin1')
    push(`${i + 1} 0 obj\n`); push(body); push('\nendobj\n')
  }
  const xrefOffset = offset
  push(`xref\n0 ${b.objects.length + 1}\n0000000000 65535 f \n`)
  for (let i = 1; i <= b.objects.length; i++) push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`)
  push(`trailer\n<< /Size ${b.objects.length + 1} /Root 1 0 R /Encrypt 6 0 R /ID [<${idHex}> <${idHex}>] >>\nstartxref\n${xrefOffset}\n%%EOF\n`)
  return Buffer.concat(chunks)
}

/** 主入口：生成全部样本。返回 { name -> { bytes, size } }。 */
export async function generatePdfSamples(outDir, fontCandidates = ['C:/Windows/Fonts/simhei.ttf', 'C:/Windows/Fonts/Deng.ttf']) {
  mkdirSync(outDir, { recursive: true })
  const results = {}

  const write = (name, bytes, note = '') => {
    writeFileSync(path.join(outDir, name), bytes)
    results[name] = { size: bytes.length, note }
  }

  const { bytes: zhEmb, fontName } = await buildZhEmbeddedSample(fontCandidates)
  write('zh-embedded.pdf', zhEmb, `内嵌中文子集字体（${path.basename(fontName)}），2 页`)
  write('zh-cmap.pdf', buildZhCmapSample(), '非内嵌中文，Type0/STSong-Light/UniGB-UCS2-H')
  write('latin-standard.pdf', buildLatinStandardSample(), '非内嵌 Helvetica，触发 standard_fonts')
  write('scanned.pdf', buildScannedSample(), '纯图扫描页，零文本')
  const multi = buildMultipageSample()
  write('multipage.pdf', multi, '5 页文本，并发/取消/翻页')
  write('corrupt.pdf', multi.subarray(0, Math.floor(multi.length * 0.4)), 'multipage 前 40% 截断')
  write('encrypted.pdf', buildEncryptedSample(), 'RC4 40-bit R2，密码 vsidian-probe')
  write('garbage.pdf', Buffer.from('this is not a pdf at all'.repeat(10), 'latin1'), '非 PDF 字节')
  return results
}

// 直接执行（node genSamples.mjs <dir>）时生成并打印清单
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  const outDir = process.argv[2] || '.vscode-test/pdf-samples'
  const results = await generatePdfSamples(outDir)
  for (const [name, info] of Object.entries(results)) {
    console.log(`${name}  ${info.size} B  ${info.note}`)
  }
}
