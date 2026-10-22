// #619（V01）PDF 导出探针 · 手工构造最小 PNG 字节。
// 本地文件图片样本（file:// 引用）需要一个真实 PNG：用 node:zlib 压缩
// raw 像素 + 手写 PNG chunk（IHDR/IDAT/IEND）与 CRC32，零依赖。
// 输出 16x16 纯色（默认品红）矩形，供「图片进入 PDF」的视觉与渲染验证。
// 本文件是探针代码（研究票产物），不进 VSIX，不定义产品行为。

import { deflateSync } from 'node:zlib'

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
  return Buffer.concat([len, typeBuf, data, crc])
}

/** 生成 width x height 的 RGB 纯色 PNG（无 alpha，真彩色）。 */
export function makeSolidPng(width: number, height: number, r: number, g: number, b: number): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 3))
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3)
    raw[rowStart] = 0 // filter: None
    for (let x = 0; x < width; x++) {
      const offset = rowStart + 1 + x * 3
      raw[offset] = r
      raw[offset + 1] = g
      raw[offset + 2] = b
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** data URL 形态（供 <img src="data:image/png;base64,..."> 直接内嵌）。 */
export function makeSolidPngDataUrl(width: number, height: number, r: number, g: number, b: number): string {
  return `data:image/png;base64,${makeSolidPng(width, height, r, g, b).toString('base64')}`
}
