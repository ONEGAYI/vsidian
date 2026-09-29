// 图片资源版本表（工单 #201）：宿主侧「目标 URI → 已观测代次与元数据」的
// 单一状态源，供三层失效通道（宿主解析缓存 / webview 图源条目 / 资源 URL
// 版本）共享同一份真相。
//
// 语义来自 #194「图片定期刷新与删除态」节：
// - 解析请求路径（recordObservation / recordMissing）：mtime/size 与最后
//   已知不同才推进代次；相同不推进——URI 稳定让浏览器/资源服务缓存可用
//   （「元数据未变不强制下载/解码」）。缺失→存在即使元数据回到缺失前的
//   值也推进（删除重建检出：lastKnown 置空过就视为变化）。
// - 事件路径（recordEvent）：收到变更事件即使元数据相同仍失效（防 mtime
//   粒度漏检），**无条件**推进代次并更新最后已知。
// - 代次单调递增，直接拼 `?v=<generation>` 作缓存击穿参数（先例：CSS 片段
//   buildSnippetLinkList——webview 资源服务不承诺无缓存）。
//
// 表是进程内状态（provider 级单例，随扩展宿主生命周期），不持久化图片
// 内容，也不落盘：重启后代次从 1 重新起算，URI 与重启前不同属可接受
// （击穿参数只要求同一进程内单调）。
import * as path from 'node:path'

/**
 * fsPath 归一键（「按规范化目标 URI 去重」）：与 vaultIndexService.normKey
 * 同语义（resolve + 反斜杠归一 + 去尾分隔符），Windows 宿主额外做小写归一
 * （NTFS 不敏感，与 statFileRealPath 的大小写归正口径一致）；POSIX 宿主
 * 保持大小写敏感（远程 Linux 文件系统敏感，反斜杠是合法文件名字符）。
 */
export function imageFsKey(fsPath: string, isWindowsHost: boolean): string {
  const ops = isWindowsHost ? path.win32 : path.posix
  const resolved = ops.resolve(fsPath)
  const unified = isWindowsHost ? resolved.replace(/\//g, '\\').toLowerCase() : resolved
  return unified.replace(/[\\/]$/, '')
}

/** 一次成功的 stat 观察（workspace.fs.stat 的 mtime/size 保留值） */
export interface ImageStatObservation {
  mtimeMs: number
  size: number
}

interface ImageVersionEntry {
  /** 已观测变化代次（单调递增；首观测为 1）——?v= 缓存击穿参数 */
  generation: number
  /** 最后已知成功 stat；null = 最后已知为缺失（曾观察到 not-found） */
  lastKnown: ImageStatObservation | null
}

export interface ObservationOutcome {
  generation: number
  /** 代次是否推进（推进 = URL 版本变化 = 需要击穿缓存） */
  changed: boolean
}

/** 图片版本表：纯内存状态机，无 fs 依赖（stat 结果由调用方喂入） */
export class ImageVersionTable {
  private readonly entries = new Map<string, ImageVersionEntry>()

  constructor(private readonly isWindowsHost: boolean = process.platform === 'win32') {}

  private key(fsPath: string): string {
    return imageFsKey(fsPath, this.isWindowsHost)
  }

  /**
   * 解析请求路径的成功观察：与最后已知不同（或曾缺失）→ 推进代次；
   * 相同 → 不推进。返回代次供 `?v=` 拼接。
   */
  recordObservation(fsPath: string, stat: ImageStatObservation): ObservationOutcome {
    const key = this.key(fsPath)
    const prev = this.entries.get(key)
    if (!prev) {
      this.entries.set(key, { generation: 1, lastKnown: stat })
      return { generation: 1, changed: false }
    }
    const sameMeta =
      prev.lastKnown !== null &&
      prev.lastKnown.mtimeMs === stat.mtimeMs &&
      prev.lastKnown.size === stat.size
    if (sameMeta) {
      return { generation: prev.generation, changed: false }
    }
    const generation = prev.generation + 1
    this.entries.set(key, { generation, lastKnown: stat })
    return { generation, changed: true }
  }

  /**
   * 缺失观察（请求/核验发现明确不存在）：存在→缺失推进代次并把最后已知
   * 置空（恢复时必检出）；已缺失 → 不变（周期核验维持态零扰动）。
   * 注意：不可访问（SSH 断连/权限错误）**不走这里**——不动版本表，文件
   * 可能未变，恢复后按元数据对比自然回到 current。
   */
  recordMissing(fsPath: string): ObservationOutcome {
    const key = this.key(fsPath)
    const prev = this.entries.get(key)
    if (!prev) {
      // 首次观察即缺失：登记代次 1（无旧 URI 需要击穿，代次仅作占位）
      this.entries.set(key, { generation: 1, lastKnown: null })
      return { generation: 1, changed: false }
    }
    if (prev.lastKnown === null) {
      return { generation: prev.generation, changed: false }
    }
    const generation = prev.generation + 1
    this.entries.set(key, { generation, lastKnown: null })
    return { generation, changed: true }
  }

  /**
   * 事件路径观察（watcher / vaultIndex.onTargetChange）：**无条件**推进代次
   * （「收到变更事件即使元数据相同仍失效」——仅靠 mtime 无法检出所有内容
   * 变化，事件本身就是变化正证据）。stat 为 null 表示删除/不可访问事件，
   * lastKnown 置空（恢复时必检出）。返回新代次。
   */
  recordEvent(fsPath: string, stat: ImageStatObservation | null): number {
    const key = this.key(fsPath)
    const prev = this.entries.get(key)
    const generation = (prev?.generation ?? 0) + 1
    this.entries.set(key, { generation, lastKnown: stat })
    return generation
  }

  /** 当前代次（未登记为 0；解析路径总会先走 recordObservation，此值供观测与防御） */
  generationOf(fsPath: string): number {
    return this.entries.get(this.key(fsPath))?.generation ?? 0
  }

  /** 最后已知成功 stat（未登记/最后已知缺失为 null） */
  lastKnownOf(fsPath: string): ImageStatObservation | null {
    return this.entries.get(this.key(fsPath))?.lastKnown ?? null
  }

  /** 是否登记过（观测面） */
  has(fsPath: string): boolean {
    return this.entries.has(this.key(fsPath))
  }

  /** 全表快照（测试钩子与诊断观测；fsKey → 代次与最后已知） */
  snapshot(): Record<string, { generation: number; lastKnown: ImageStatObservation | null }> {
    const out: Record<string, { generation: number; lastKnown: ImageStatObservation | null }> = {}
    for (const [key, entry] of this.entries) {
      out[key] = { generation: entry.generation, lastKnown: entry.lastKnown }
    }
    return out
  }
}
