// jieba-wasm 下载链路的 tar 提取纯函数（#239）：npmmirror 源按 registry
// tarball 单 URL 下载（registry 的 /files/ 镜像对非白名单包 403），解包
// 提取 pkg/web/ 两文件。npm tarball 为标准 ustar 格式（512 字节头 +
// 数据块 512 对齐 + 全零结束块）；本模块自写最小读取器（零新依赖——
// 不引入 tar 包），只读普通文件条目，不处理 symlink/目录（npm 包产物
// 用不到，遇到即跳过）。
//
// GNU 扩展防御：size 的 base-256 形态（首字节 0x80）理论上不出现在
// npm tarball（八进制足够表达），读取器仍支持——损坏或恶意构造的包
// 以「提取不到目标条目」失败，由调用方按清单缺失处理。
import { gunzipSync } from 'node:zlib'

const tarTextDecoder = new TextDecoder('utf-8')

/** 解 gzip + 提取全部普通文件条目：Map<条目路径, 字节>（package/ 前缀
 *  保留在键中）。输入不是合法 tar/gzip 时抛错（调用方按下载失败处理） */
export function extractTarEntries(gzipped: Uint8Array): Map<string, Uint8Array> {
  const tar = gunzipSync(gzipped)
  const out = new Map<string, Uint8Array>()
  const headerSize = 512
  for (let offset = 0; offset + headerSize <= tar.length; offset += headerSize) {
    if (isZeroBlock(tar, offset)) break
    const name = readString(tar, offset, 100)
    if (name === '') continue
    const size = readOctalOrBase256(tar, offset + 124, 12)
    if (size < 0 || offset + headerSize + size > tar.length) {
      throw new Error('tar entry size out of range')
    }
    const typeflag = tar[offset + 156] ?? 0
    const prefix = readString(tar, offset + 345, 155)
    const path = prefix !== '' ? `${prefix}/${name}` : name
    // 只收普通文件（'0' 与 NUL）；目录（'5'）与 symlink（'2'）等跳过
    if (typeflag === 0x30 || typeflag === 0x00) {
      out.set(path, tar.subarray(offset + headerSize, offset + headerSize + size))
    }
    offset += Math.ceil(size / headerSize) * headerSize
  }
  return out
}

function isZeroBlock(tar: Uint8Array, offset: number): boolean {
  for (let i = offset; i < offset + 512; i++) {
    if (tar[i] !== 0) return false
  }
  return true
}

/** NUL/空格结尾的字符串字段读取（去尾填充后 decode） */
function readString(tar: Uint8Array, offset: number, length: number): string {
  let end = offset
  const limit = offset + length
  while (end < limit && tar[end] !== 0) end++
  return tarTextDecoder.decode(tar.subarray(offset, end)).trim()
}

/** 八进制字段解析（NUL/空格填充）；首字节 0x80 时按 GNU base-256 解析 */
function readOctalOrBase256(tar: Uint8Array, offset: number, length: number): number {
  if (tar[offset] === 0x80) {
    let value = 0
    for (let i = offset + 1; i < offset + length; i++) {
      value = value * 256 + (tar[i] ?? 0)
      if (!Number.isSafeInteger(value)) return -1
    }
    return value
  }
  let text = ''
  for (let i = offset; i < offset + length; i++) {
    const byte = tar[i] ?? 0
    if (byte === 0 || byte === 0x20) break
    text += String.fromCharCode(byte)
  }
  const parsed = Number.parseInt(text, 8)
  return Number.isFinite(parsed) ? parsed : -1
}
