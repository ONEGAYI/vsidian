// JiebaResourceService 下载/删除全链路单测。起因：线上 fatal 报告
// 「下载失败：无法删除不存在的文件 '…/jieba-wasm/.staging'」——首次下载
// 时 staging 从未存在，rmdir 的 ENOENT 把本该成功的下载误报为失败。
// 假端口复刻 vscode.workspace.fs 真实语义：对不存在路径的 delete 抛
// FileNotFound（消息与宿主报告同源），下载/提交/删除路径必须在该语义下
// 保持可用（幂等清理由服务层兑现）。
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  JIEBA_INSTALL_DIR,
  JiebaResourceService,
  sha256Hex,
  type JiebaManifestEntry,
  type JiebaResourcePort,
} from '../../src/host/jiebaResourceService'
import { planJiebaLocalInstall } from '../../src/shared/jiebaManifest'

const STAGING_DIR = 'jieba-wasm/.staging'
const PAYLOAD_A = new TextEncoder().encode('jieba test payload a')

const MINIFEST_ONE_FILE: readonly JiebaManifestEntry[] = [
  { name: 'a.js', npmPath: 'pkg/web/a.js', sha256: sha256Hex(PAYLOAD_A), size: PAYLOAD_A.length },
]

/** 复刻 vscode.workspace.fs 语义的内存文件系统：删除不存在路径抛
 *  FileNotFound 同义错误（消息复刻宿主报告形态），写文件要求父目录
 *  在场，rename 按 overwrite 语义替换目标子树。 */
class FakeVscodeFs implements JiebaResourcePort {
  readonly files = new Map<string, Uint8Array>()
  readonly dirs = new Set<string>()
  /** local 源外部路径面（绝对路径键，与 globalStorage 相对路径命名空间隔离） */
  readonly externalFiles = new Map<string, Uint8Array>()
  readonly externalDirs = new Set<string>()

  constructor(private readonly payload: Uint8Array) {}

  private static notFound(path: string): Error {
    return new Error(`无法删除不存在的文件 'vscode-userdata:/c:/fake/globalStorage/onegayi.vsidian/${path}'`)
  }

  private static exists(path: string, self: FakeVscodeFs): boolean {
    return self.files.has(path) || self.dirs.has(path)
  }

  async fetchBytes(): Promise<Uint8Array> {
    return this.payload
  }

  async stat(path: string): Promise<boolean> {
    return FakeVscodeFs.exists(path, this)
  }

  async read(path: string): Promise<Uint8Array> {
    const bytes = this.files.get(path)
    if (!bytes) throw new Error(`无法读取不存在的文件 '${path}'`)
    return bytes
  }

  async write(path: string, bytes: Uint8Array): Promise<void> {
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    if (parent && !this.dirs.has(parent)) {
      throw new Error(`无法写入：父目录不存在 '${parent}'`)
    }
    this.files.set(path, bytes)
  }

  async mkdirp(path: string): Promise<void> {
    this.dirs.add(path)
  }

  async rmdir(path: string): Promise<void> {
    if (!FakeVscodeFs.exists(path, this)) throw FakeVscodeFs.notFound(path)
    this.deleteSubtree(path)
  }

  async rename(from: string, to: string): Promise<void> {
    if (!FakeVscodeFs.exists(from, this)) throw FakeVscodeFs.notFound(from)
    this.deleteSubtree(to)
    const moved: [string, Uint8Array][] = []
    for (const [key, bytes] of this.files) {
      if (key === from || key.startsWith(`${from}/`)) moved.push([key, bytes])
    }
    for (const [key, bytes] of moved) {
      this.files.delete(key)
      this.files.set(key === from ? to : `${to}/${key.slice(from.length + 1)}`, bytes)
    }
    if (this.dirs.has(from)) {
      this.dirs.delete(from)
      this.dirs.add(to)
    }
  }

  async statExternal(path: string): Promise<'file' | 'directory' | null> {
    if (this.externalDirs.has(path)) return 'directory'
    if (this.externalFiles.has(path)) return 'file'
    return null
  }

  async readExternal(path: string): Promise<Uint8Array> {
    const bytes = this.externalFiles.get(path)
    if (!bytes) throw new Error(`无法读取不存在的文件 '${path}'`)
    return bytes
  }

  private deleteSubtree(path: string): void {
    for (const key of [...this.files.keys()]) {
      if (key === path || key.startsWith(`${path}/`)) this.files.delete(key)
    }
    for (const dir of [...this.dirs]) {
      if (dir === path || dir.startsWith(`${path}/`)) this.dirs.delete(dir)
    }
  }
}

function createService(fs: FakeVscodeFs): JiebaResourceService {
  return new JiebaResourceService(fs, () => ({ mode: 'jsdelivr', customUrl: '', localPath: '' }), MINIFEST_ONE_FILE)
}

function createLocalService(fs: FakeVscodeFs, localPath: string): JiebaResourceService {
  return new JiebaResourceService(fs, () => ({ mode: 'local', customUrl: '', localPath }), MINIFEST_ONE_FILE)
}

/** 最小 ustar 构造（512 头 + 数据 512 对齐 + 全零收尾两块）——checksum
 *  按规范填充；提取器（extractTarEntries）不校验 checksum，此处仍按
 *  真实形态构造，保证离线 tarball 场景与生产同构 */
function buildTarball(entries: readonly [name: string, data: Uint8Array][]): Uint8Array {
  const encoder = new TextEncoder()
  const blocks: Uint8Array[] = []
  for (const [name, data] of entries) {
    const header = new Uint8Array(512)
    const nameBytes = encoder.encode(name)
    header.set(nameBytes.subarray(0, Math.min(100, nameBytes.length)), 0)
    header.set(encoder.encode(`${data.length.toString(8).padStart(11, '0')}\0`), 124)
    header[156] = 0x30 // typeflag '0'（普通文件）
    header.set(encoder.encode(' '.repeat(8)), 148)
    let sum = 0
    for (const byte of header) sum += byte
    header.set(encoder.encode(`${sum.toString(8).padStart(6, '0')}\0 `), 148)
    const padded = new Uint8Array(Math.ceil(data.length / 512) * 512)
    padded.set(data)
    blocks.push(Uint8Array.from([...header, ...padded]))
  }
  const end = new Uint8Array(1024)
  const total = blocks.reduce((size, block) => size + block.length, 0) + end.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const block of blocks) {
    out.set(block, offset)
    offset += block.length
  }
  out.set(end, offset)
  return gzipSync(out)
}

describe('JiebaResourceService.download（真实 fs 语义下）', () => {
  it('首次下载：staging 与版本目录均不存在时下载成功且无 staging 残留', async () => {
    const fs = new FakeVscodeFs(PAYLOAD_A)
    const service = createService(fs)
    await service.download()
    const notice = service.getState().notice
    expect(notice?.kind).toBe('downloaded')
    expect(service.getState().installed).toBe(true)
    expect(fs.files.get(`${JIEBA_INSTALL_DIR}/a.js`)).toEqual(PAYLOAD_A)
    expect(fs.dirs.has(STAGING_DIR)).toBe(false)
    expect(fs.files.has(`${STAGING_DIR}/a.js`)).toBe(false)
  })

  it('staging 残留孤儿文件：下载前被清理，版本目录只含清单文件', async () => {
    const fs = new FakeVscodeFs(PAYLOAD_A)
    await fs.mkdirp(STAGING_DIR)
    await fs.write(`${STAGING_DIR}/orphan.tmp`, new TextEncoder().encode('stale'))
    const service = createService(fs)
    await service.download()
    expect(service.getState().notice?.kind).toBe('downloaded')
    expect([...fs.files.keys()]).toEqual([`${JIEBA_INSTALL_DIR}/a.js`])
  })

  it('重下已安装版本：旧版本目录被替换，内容为新字节', async () => {
    const fs = new FakeVscodeFs(PAYLOAD_A)
    const service = createService(fs)
    await service.download()
    const stale = new TextEncoder().encode('stale old bytes')
    await fs.write(`${JIEBA_INSTALL_DIR}/a.js`, stale)
    await service.download()
    expect(service.getState().notice?.kind).toBe('downloaded')
    expect(fs.files.get(`${JIEBA_INSTALL_DIR}/a.js`)).toEqual(PAYLOAD_A)
  })
})

describe('JiebaResourceService.delete（真实 fs 语义下）', () => {
  it('资源不存在时删除幂等成功（deleted 而非 delete-failed）', async () => {
    const fs = new FakeVscodeFs(PAYLOAD_A)
    const service = createService(fs)
    await service.delete()
    expect(service.getState().notice?.kind).toBe('deleted')
    expect(service.getState().installed).toBe(false)
  })
})

describe('planJiebaLocalInstall（local 源规划纯函数）', () => {
  it('空白路径拒绝（ok=false invalid-local-path）；常规路径 trim 后透传', () => {
    expect(planJiebaLocalInstall('')).toEqual({ ok: false, reason: 'invalid-local-path' })
    expect(planJiebaLocalInstall('   ')).toEqual({ ok: false, reason: 'invalid-local-path' })
    expect(planJiebaLocalInstall('  D:/pkg  ')).toEqual({ ok: true, kind: 'local', path: 'D:/pkg' })
  })
})

describe('JiebaResourceService.download（local 源离线安装，#630）', () => {
  it('目录形态：目录内同名清单文件逐个校验后落盘，notice 为 installed', async () => {
    const fs = new FakeVscodeFs(PAYLOAD_A)
    fs.externalDirs.add('D:/offline/jieba-2.4.0')
    fs.externalFiles.set('D:/offline/jieba-2.4.0/a.js', PAYLOAD_A)
    const service = createLocalService(fs, 'D:/offline/jieba-2.4.0/')
    await service.download()
    expect(service.getState().notice?.kind).toBe('installed')
    expect(service.getState().installed).toBe(true)
    expect(fs.files.get(`${JIEBA_INSTALL_DIR}/a.js`)).toEqual(PAYLOAD_A)
    expect(fs.dirs.has(STAGING_DIR)).toBe(false)
  })

  it('tgz 形态：npm tarball 解包提取 package/ 前缀条目并校验落盘', async () => {
    const fs = new FakeVscodeFs(PAYLOAD_A)
    fs.externalFiles.set('D:/offline/jieba-wasm-2.4.0.tgz',
      buildTarball([['package/pkg/web/a.js', PAYLOAD_A]]))
    const service = createLocalService(fs, 'D:/offline/jieba-wasm-2.4.0.tgz')
    await service.download()
    expect(service.getState().notice?.kind).toBe('installed')
    // tarball 提取产物是 Buffer 视图（gunzipSync 返回 Buffer），按字节内容断言
    expect(new Uint8Array(fs.files.get(`${JIEBA_INSTALL_DIR}/a.js`)!)).toEqual(PAYLOAD_A)
  })

  it('路径不可达：install-failed 且不留半成品', async () => {
    const fs = new FakeVscodeFs(PAYLOAD_A)
    const service = createLocalService(fs, 'E:/missing')
    await service.download()
    const notice = service.getState().notice
    expect(notice?.kind).toBe('install-failed')
    expect(service.getState().installed).toBe(false)
    expect(fs.dirs.has(STAGING_DIR)).toBe(false)
  })

  it('空路径：install-failed（invalid local path）', async () => {
    const fs = new FakeVscodeFs(PAYLOAD_A)
    const service = createLocalService(fs, '  ')
    await service.download()
    expect(service.getState().notice?.kind).toBe('install-failed')
    expect((service.getState().notice as { detail?: string }).detail).toContain('invalid local path')
  })

  it('目录缺清单文件：install-failed 且无 staging 残留', async () => {
    const fs = new FakeVscodeFs(PAYLOAD_A)
    fs.externalDirs.add('D:/offline/empty')
    const service = createLocalService(fs, 'D:/offline/empty')
    await service.download()
    expect(service.getState().notice?.kind).toBe('install-failed')
    expect(fs.dirs.has(STAGING_DIR)).toBe(false)
    expect(fs.files.has(`${JIEBA_INSTALL_DIR}/a.js`)).toBe(false)
  })

  it('哈希不符：install-failed 且无半成品（不覆盖既有安装的判定）', async () => {
    const fs = new FakeVscodeFs(PAYLOAD_A)
    fs.externalDirs.add('D:/offline/tampered')
    fs.externalFiles.set('D:/offline/tampered/a.js', new TextEncoder().encode('tampered bytes'))
    const service = createLocalService(fs, 'D:/offline/tampered')
    await service.download()
    expect(service.getState().notice?.kind).toBe('install-failed')
    expect(fs.files.has(`${JIEBA_INSTALL_DIR}/a.js`)).toBe(false)
  })

  it('非 tar 普通文件：install-failed（gunzip 失败归入安装失败）', async () => {
    const fs = new FakeVscodeFs(PAYLOAD_A)
    fs.externalFiles.set('D:/offline/not-a-tarball.txt', new TextEncoder().encode('plain text'))
    const service = createLocalService(fs, 'D:/offline/not-a-tarball.txt')
    await service.download()
    expect(service.getState().notice?.kind).toBe('install-failed')
  })
})
