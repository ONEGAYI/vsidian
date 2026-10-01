// JiebaResourceService 下载/删除全链路单测。起因：线上 fatal 报告
// 「下载失败：无法删除不存在的文件 '…/jieba-wasm/.staging'」——首次下载
// 时 staging 从未存在，rmdir 的 ENOENT 把本该成功的下载误报为失败。
// 假端口复刻 vscode.workspace.fs 真实语义：对不存在路径的 delete 抛
// FileNotFound（消息与宿主报告同源），下载/提交/删除路径必须在该语义下
// 保持可用（幂等清理由服务层兑现）。
import { describe, expect, it } from 'vitest'
import {
  JIEBA_INSTALL_DIR,
  JiebaResourceService,
  sha256Hex,
  type JiebaManifestEntry,
  type JiebaResourcePort,
} from '../../src/host/jiebaResourceService'

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
  return new JiebaResourceService(fs, () => ({ mode: 'jsdelivr', customUrl: '' }), MINIFEST_ONE_FILE)
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
