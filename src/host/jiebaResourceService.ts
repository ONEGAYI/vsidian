// jieba-wasm 资源宿主服务（#239）：下载（按锁定清单 sha256 校验）→
// globalStorage 落盘 → 删除与状态权威。纯逻辑 + 端口注入（settingsService
// 同模式，单测注入假端口/假 fetch），vscode 层装配见
// host/jiebaResourceWiring.ts。
//
// 下载执行在宿主侧（Remote SSH 场景在远程机执行，用户决策钉住）；失败
// 或校验不符清理 staging 不留半成品文件。提交原子性：写满 staging 目录
// 后一次性 rename 到版本目录（旧版本先删）——中断最坏残留整个 staging
// 目录，下次下载前先清。
//
// 已安装判定：版本目录两文件在场且 sha256 逐一与清单相符（启动时校验
// 一次；磁盘损坏/篡改视为未安装）。资源 URI 由 vscode 层逐 webview 构造
// （asWebviewUri 前缀面板私有），本服务只管文件与状态。
import { createHash } from 'node:crypto'
import {
  JIEBA_MANIFEST_FILES,
  JIEBA_WASM_VERSION,
  planJiebaDownload,
  type JiebaSourceMode,
} from '../shared/jiebaManifest'
import { extractTarEntries } from './jiebaTar'

/** globalStorage 相对路径（端口实现负责拼到存储根） */
export const JIEBA_INSTALL_DIR = `jieba-wasm/${JIEBA_WASM_VERSION}`
const JIEBA_STAGING_DIR = 'jieba-wasm/.staging'

/** 文件系统/下载端口（vscode 层用 vscode.workspace.fs + 全局 fetch 实现；
 *  relative path 相对 globalStorage 根；vscode.workspace.fs 返回
 *  Thenable，端口契约放宽为 PromiseLike（服务内 await 消费） */
export interface JiebaResourcePort {
  fetchBytes(url: string): Promise<Uint8Array>
  stat(relativePath: string): Promise<boolean>
  read(relativePath: string): Promise<Uint8Array>
  write(relativePath: string, bytes: Uint8Array): PromiseLike<void>
  mkdirp(relativePath: string): PromiseLike<void>
  /** 目录删除（不存在视为成功——幂等清理） */
  rmdir(relativePath: string): PromiseLike<void>
  rename(fromPath: string, toPath: string): PromiseLike<void>
}

export type JiebaNotice =
  | { kind: 'downloaded'; version: string }
  | { kind: 'download-failed'; detail: string }
  | { kind: 'deleted' }
  | { kind: 'delete-failed'; detail: string }
  | { kind: 'load-failed'; detail?: string }

export interface JiebaResourceState {
  installed: boolean
  version: string
  status: 'idle' | 'downloading'
  notice: JiebaNotice | null
}

export type JiebaSourceReader = () => { mode: JiebaSourceMode; customUrl: string }

export interface JiebaManifestEntry {
  name: string
  npmPath: string
  sha256: string
  size: number
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export class JiebaResourceService {
  private state: JiebaResourceState = {
    installed: false,
    version: JIEBA_WASM_VERSION,
    status: 'idle',
    notice: null,
  }
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly port: JiebaResourcePort,
    private readonly sourceOf: JiebaSourceReader,
    /** 清单注入（测试用小清单；生产缺省用锁定清单） */
    private readonly manifest: readonly JiebaManifestEntry[] = JIEBA_MANIFEST_FILES,
  ) {}

  getState(): JiebaResourceState {
    return { ...this.state }
  }

  onStateChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
  }

  /** 启动校验：版本目录两文件在场且哈希相符才视为已安装（篡改/损坏视为
   *  未安装，不自动删除——用户可显式重下或删除） */
  async verifyInstalled(): Promise<boolean> {
    let installed = false
    try {
      installed = await this.verifyFiles()
    } catch {
      installed = false
    }
    if (installed !== this.state.installed) {
      this.state = { ...this.state, installed }
      this.changed()
    }
    return installed
  }

  /** 目录删除（不存在视为成功——幂等清理）。幂等由两侧兑现：服务层
   *  stat 前检避免常规路径对不存在目标发起删除（首次下载 staging/版本
   *  目录均不存在，直接 rmdir 会以 ENOENT 误报下载失败）；实现侧仍须
   *  容忍 FileNotFound（覆盖 stat→rmdir 竞态窗口）。 */
  private async rmdirIfExists(path: string): Promise<void> {
    if (await this.port.stat(path)) {
      await this.port.rmdir(path)
    }
  }

  private async verifyFiles(): Promise<boolean> {
    for (const file of this.manifest) {
      const path = `${JIEBA_INSTALL_DIR}/${file.name}`
      if (!(await this.port.stat(path))) return false
      const bytes = await this.port.read(path)
      if (bytes.length !== file.size || sha256Hex(bytes) !== file.sha256) return false
    }
    return true
  }

  /**
   * 下载（设置页按钮驱动）：按当前下载源设置取 URL 集 → 下载 → 文件级
   * sha256 校验 → staging 落盘 → rename 提交。任一步失败清理 staging，
   * 状态 notice 记 detail（宿主层据此通知）。并发调用（downloading 中）
   * 直接忽略。
   */
  async download(): Promise<void> {
    if (this.state.status === 'downloading') return
    this.state = { ...this.state, status: 'downloading', notice: null }
    this.changed()
    try {
      const { mode, customUrl } = this.sourceOf()
      const plan = planJiebaDownload(mode, customUrl, this.manifest)
      if (!plan.ok) {
        throw new Error(`invalid download source: ${plan.reason}`)
      }
      const files = new Map<string, Uint8Array>()
      if (plan.kind === 'files') {
        for (const { file, url } of plan.files) {
          const bytes = await this.port.fetchBytes(url)
          assertManifestFile(file, bytes)
          files.set(file.name, bytes)
        }
      } else {
        const entries = extractTarEntries(await this.port.fetchBytes(plan.tarballUrl))
        for (const file of this.manifest) {
          const bytes = entries.get(`package/${file.npmPath}`)
          if (!bytes) {
            throw new Error(`tarball missing entry: package/${file.npmPath}`)
          }
          assertManifestFile(file, bytes)
          files.set(file.name, bytes)
        }
      }
      await this.rmdirIfExists(JIEBA_STAGING_DIR)
      await this.port.mkdirp(JIEBA_STAGING_DIR)
      for (const [name, bytes] of files) {
        await this.port.write(`${JIEBA_STAGING_DIR}/${name}`, bytes)
      }
      await this.rmdirIfExists(JIEBA_INSTALL_DIR)
      await this.port.rename(JIEBA_STAGING_DIR, JIEBA_INSTALL_DIR)
      this.state = { ...this.state, installed: true, notice: { kind: 'downloaded', version: JIEBA_WASM_VERSION } }
    } catch (error) {
      try {
        await this.port.rmdir(JIEBA_STAGING_DIR)
      } catch {
        // 清理失败不掩盖下载失败本身（残留目录下次下载前再清）
      }
      this.state = {
        ...this.state,
        installed: await this.verifyFiles().catch(() => false),
        notice: { kind: 'download-failed', detail: errorMessage(error) },
      }
    } finally {
      this.state = { ...this.state, status: 'idle' }
      this.changed()
    }
  }

  /** 删除已下载资源（引擎回退 builtin 由编辑器侧按 installed=false 处理） */
  async delete(): Promise<void> {
    if (this.state.status === 'downloading') return
    try {
      await this.rmdirIfExists(JIEBA_INSTALL_DIR)
      this.state = { ...this.state, installed: false, notice: { kind: 'deleted' } }
    } catch (error) {
      this.state = { ...this.state, notice: { kind: 'delete-failed', detail: errorMessage(error) } }
    }
    this.changed()
  }

  /** 编辑器侧加载失败回报（wordSegment.loadResult）：宿主转发用户提示并
   *  记入 notice（资源在宿主侧校验通过、webview 运行时不兼容的场景） */
  reportLoadFailed(detail?: string): void {
    this.state = { ...this.state, notice: { kind: 'load-failed', detail } }
    this.changed()
  }
}

function assertManifestFile(file: { name: string; sha256: string; size: number }, bytes: Uint8Array): void {
  if (bytes.length !== file.size) {
    throw new Error(`${file.name}: size ${bytes.length} != manifest ${file.size}`)
  }
  if (sha256Hex(bytes) !== file.sha256) {
    throw new Error(`${file.name}: sha256 mismatch`)
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
