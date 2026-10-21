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
  JIEBA_LOCAL_READ_LIMIT_BYTES,
  JiebaResourceService,
  sha256Hex,
  type JiebaManifestEntry,
  type JiebaResourcePort,
} from '../../src/host/jiebaResourceService'
import { extractTarEntries } from '../../src/host/jiebaTar'
import { planJiebaDownload, planJiebaLocalInstall } from '../../src/shared/jiebaManifest'

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
  /** 评审 C1 测试钩子：按路径覆盖 statExternal 报告的 size（构造超限
   *  场景不必真的分配 64 MB 字节） */
  readonly externalSizeOverrides = new Map<string, number>()

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

  /** 宿主装配层 Uri.file 语义近似：分隔符统一为 /（服务侧 `\` 拼接的
   *  Windows 路径经归一后命中同一键） */
  private static norm(path: string): string {
    return path.replace(/\\/g, '/')
  }

  async statExternal(path: string): Promise<{ kind: 'file' | 'directory'; size: number } | null> {
    const key = FakeVscodeFs.norm(path)
    if (this.externalDirs.has(key)) return { kind: 'directory', size: 0 }
    const bytes = this.externalFiles.get(key)
    if (bytes) {
      return { kind: 'file', size: this.externalSizeOverrides.get(key) ?? bytes.length }
    }
    return null
  }

  async readExternal(path: string): Promise<Uint8Array> {
    const bytes = this.externalFiles.get(FakeVscodeFs.norm(path))
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

  it('planJiebaDownload 显式拒绝 local 档（评审 A3：不落入 custom 分支产出误导 reason）', () => {
    expect(planJiebaDownload('local', '')).toEqual({ ok: false, reason: 'local-mode' })
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

  it('Windows 风格路径（尾反斜杠、混合分隔符）：归一后命中同一目录（评审 A5）', async () => {
    const fs = new FakeVscodeFs(PAYLOAD_A)
    fs.externalDirs.add('D:/offline/pkg')
    fs.externalFiles.set('D:/offline/pkg/a.js', PAYLOAD_A)
    const service = createLocalService(fs, 'D:\\offline\\pkg\\')
    await service.download()
    expect(service.getState().notice?.kind).toBe('installed')
    expect(fs.files.get(`${JIEBA_INSTALL_DIR}/a.js`)).toEqual(PAYLOAD_A)
  })

  it('退化路径形态（`/` 与裸盘符 `C:\\`）：按无效路径拒绝而非读盘根（评审 C4）', async () => {
    for (const degenerate of ['/', 'C:\\']) {
      const fs = new FakeVscodeFs(PAYLOAD_A)
      const service = createLocalService(fs, degenerate)
      await service.download()
      const notice = service.getState().notice
      expect(notice?.kind).toBe('install-failed')
      expect((notice as { detail?: string }).detail).toContain('invalid local path')
    }
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

  it('哈希不符（等长篡改，真正触发 sha256 分支）：install-failed 且无半成品', async () => {
    const fs = new FakeVscodeFs(PAYLOAD_A)
    fs.externalDirs.add('D:/offline/tampered')
    // 与 PAYLOAD_A 等长（20 字节）不同内容——size 先行的校验不再拦截，
    // 断言落到 sha256 分支（评审 A1：原 14 字节用例实际走的是 size 分支）
    fs.externalFiles.set('D:/offline/tampered/a.js', new TextEncoder().encode('tampered payload !!!'))
    const service = createLocalService(fs, 'D:/offline/tampered')
    await service.download()
    const notice = service.getState().notice
    expect(notice?.kind).toBe('install-failed')
    expect((notice as { detail?: string }).detail).toContain('sha256 mismatch')
    expect(fs.files.has(`${JIEBA_INSTALL_DIR}/a.js`)).toBe(false)
  })

  it('已有安装时离线重装失败：notice install-failed 但 installed 保持 true、既有文件字节不变（评审 A1）', async () => {
    const fs = new FakeVscodeFs(PAYLOAD_A)
    fs.externalDirs.add('D:/offline/pkg')
    fs.externalFiles.set('D:/offline/pkg/a.js', PAYLOAD_A)
    const service = createLocalService(fs, 'D:/offline/pkg')
    await service.download()
    expect(service.getState().installed).toBe(true)
    // 改指向等长篡改目录重装：收集阶段即失败，未触碰既有安装
    fs.externalDirs.add('D:/offline/tampered')
    fs.externalFiles.set('D:/offline/tampered/a.js', new TextEncoder().encode('tampered payload !!!'))
    const service2 = new JiebaResourceService(
      fs, () => ({ mode: 'local', customUrl: '', localPath: 'D:/offline/tampered' }), MINIFEST_ONE_FILE)
    await service2.download()
    expect(service2.getState().notice?.kind).toBe('install-failed')
    expect(service2.getState().installed).toBe(true)
    expect(fs.files.get(`${JIEBA_INSTALL_DIR}/a.js`)).toEqual(PAYLOAD_A)
  })

  it('超上限的 tarball 文件：stat size 先行拒绝，不读入内存（评审 C1）', async () => {
    const fs = new FakeVscodeFs(PAYLOAD_A)
    fs.externalFiles.set('D:/offline/huge.tgz', buildTarball([['package/pkg/web/a.js', PAYLOAD_A]]))
    fs.externalSizeOverrides.set('D:/offline/huge.tgz', JIEBA_LOCAL_READ_LIMIT_BYTES + 1)
    const service = createLocalService(fs, 'D:/offline/huge.tgz')
    await service.download()
    const notice = service.getState().notice
    expect(notice?.kind).toBe('install-failed')
    expect((notice as { detail?: string }).detail).toContain('exceeds local read limit')
  })

  it('目录内单文件超上限：逐文件 stat 先行拒绝（评审 C1）', async () => {
    const fs = new FakeVscodeFs(PAYLOAD_A)
    fs.externalDirs.add('D:/offline/bigdir')
    fs.externalFiles.set('D:/offline/bigdir/a.js', PAYLOAD_A)
    fs.externalSizeOverrides.set('D:/offline/bigdir/a.js', JIEBA_LOCAL_READ_LIMIT_BYTES + 1)
    const service = createLocalService(fs, 'D:/offline/bigdir')
    await service.download()
    expect(service.getState().notice?.kind).toBe('install-failed')
    expect((service.getState().notice as { detail?: string }).detail).toContain('exceeds local read limit')
  })

  it('tarball 解压输出上限：超限 gzip 在 gunzip 阶段抛错（评审 C1 zip bomb 防御）', () => {
    const tgz = buildTarball([['package/pkg/web/a.js', PAYLOAD_A]])
    // 输出 2048 字节（512 头 + 512 数据 + 1024 收尾），注入 512 上限
    expect(() => extractTarEntries(tgz, 512)).toThrow()
  })

  it('采集中途切档：入口源快照决定采集路径与 notice 归类（评审 C2）', async () => {
    const fs = new FakeVscodeFs(PAYLOAD_A)
    let reads = 0
    const service = new JiebaResourceService(
      fs,
      () => {
        reads += 1
        // 第二次起模拟用户已把源切到 local——若采集器重新读设置即会走错路径
        return { mode: reads > 1 ? 'local' : 'jsdelivr', customUrl: '', localPath: '' }
      },
      MINIFEST_ONE_FILE)
    await service.download()
    expect(service.getState().notice?.kind).toBe('downloaded')
    expect(fs.files.get(`${JIEBA_INSTALL_DIR}/a.js`)).toEqual(PAYLOAD_A)
  })

  it('非 tar 普通文件：install-failed（gunzip 失败归入安装失败）', async () => {
    const fs = new FakeVscodeFs(PAYLOAD_A)
    fs.externalFiles.set('D:/offline/not-a-tarball.txt', new TextEncoder().encode('plain text'))
    const service = createLocalService(fs, 'D:/offline/not-a-tarball.txt')
    await service.download()
    expect(service.getState().notice?.kind).toBe('install-failed')
  })
})
