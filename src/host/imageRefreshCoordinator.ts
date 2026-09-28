// 图片刷新协调器（工单 #201）：provider 级单件，串起三层失效通道的宿主侧
// 执行——版本表代次（?v= 击穿参数）、事件路径与周期核验路径。本模块保持
// 纯逻辑（stat 与目标解析经端口注入，vscode 层装配在 textEditorProvider）。
//
// 两条触发路径（#194「图片定期刷新与删除态」节）：
// - 事件路径（handleTargetEvent）：图片文件 watcher 与 vaultIndex.
//   onTargetChange 的「变更正证据」——**无条件**失效（收到变更事件即使
//   元数据相同仍失效，防 mtime 粒度漏检）；stat 三态决定版本表写法
//   （ok → recordEvent 带 stat；missing → recordEvent 置空；
//   inaccessible → 不动表，仅广播——重发请求按 inaccessible 呈现）。
// - 周期核验路径（verify）：webview 活跃图源合并上报 → 目标解析按 fsKey
//   去重 → 逐目标 stat（串行 await，并发有界）→ 决策纯函数
//   （planImageVerification）→ refresh 目标写回版本表（recordObservation
//   语义：变化 bump 新 URI；断连恢复元数据相同不 bump——URI 不变，浏览器
//   缓存命中即可恢复）并广播失效。
//
// 边界：HTTP(S) 直连图源不经本管线（webview 侧已过滤）；无工作区时无
// watcher，周期核验与按需 stat 兜底（不依赖全库索引）。
import { imageFsKey, ImageVersionTable } from './imageVersioning'
import {
  planImageVerification,
  type ImageStatOutcome,
  type ImageVerifyItem,
} from '../shared/imageRefresh'

/** 协调器端口（vscode 层注入） */
export interface ImageRefreshPorts {
  /** stat 三态探测（workspace.fs.stat + 错误码归类） */
  statTarget(fsPath: string): Promise<ImageStatOutcome>
  /** 图源 → 目标磁盘路径（classifyImageTarget 语义）；解析失败
   *  （blocked/越界）返回 null（不参与核验） */
  resolveTarget(src: string): string | null
  /** 失效广播（遍历全部文档会话 invalidateImagesByFsPath） */
  invalidateTarget(fsPath: string): void
}

export class ImageRefreshCoordinator {
  readonly versions: ImageVersionTable
  private readonly isWindowsHost: boolean

  constructor(
    private readonly ports: ImageRefreshPorts,
    options?: { isWindowsHost?: boolean },
  ) {
    this.isWindowsHost = options?.isWindowsHost ?? process.platform === 'win32'
    this.versions = new ImageVersionTable(this.isWindowsHost)
  }

  private keyOf(fsPath: string): string {
    return imageFsKey(fsPath, this.isWindowsHost)
  }

  /**
   * 事件路径（watcher / onTargetChange 变更正证据）：无条件失效。
   * stat 成功更新版本表（代次推进）；missing 置空 lastKnown（恢复必检出）；
   * 不可访问不动版本表（文件可能未变）——仅广播，重发请求由 stat 结果
   * 呈现 inaccessible。
   */
  async handleTargetEvent(fsPath: string): Promise<void> {
    let outcome: ImageStatOutcome | null = null
    try {
      outcome = await this.ports.statTarget(fsPath)
    } catch {
      outcome = null // 探测通道自身失败：按不可访问处理（不冒充删除）
    }
    if (outcome?.kind === 'ok') {
      this.versions.recordEvent(fsPath, { mtimeMs: outcome.mtimeMs, size: outcome.size })
    } else if (outcome?.kind === 'missing') {
      this.versions.recordEvent(fsPath, null)
    }
    this.ports.invalidateTarget(fsPath)
  }

  /**
   * 周期核验路径（image.verify 的会话端口透传到此）：目标解析 → fsKey
   * 去重 → 逐目标 stat（串行：并发有界）→ 决策 → refresh 执行。
   * 维持态（current）零副作用——不重载、不广播。
   * targetOverride：会话级目标解析覆盖（同一 src 在不同文档指向不同文件，
   * 各会话按自身 linkCtx 注入；stat 与失效广播用全局端口）。
   */
  async verify(
    items: readonly ImageVerifyItem[],
    targetOverride?: { resolveTarget(src: string): string | null },
  ): Promise<void> {
    const targets = new Map<string, string>() // fsKey → 代表 fsPath（失效调用用）
    const inputs = []
    for (const item of items) {
      const fsPath = targetOverride
        ? targetOverride.resolveTarget(item.src)
        : this.ports.resolveTarget(item.src)
      if (!fsPath) {
        continue
      }
      const key = this.keyOf(fsPath)
      if (!targets.has(key)) {
        targets.set(key, fsPath)
      }
      inputs.push({ ...item, fsKey: key })
    }
    if (inputs.length === 0) {
      return
    }
    const statOf = new Map<string, ImageStatOutcome>()
    for (const [key, fsPath] of targets) {
      try {
        statOf.set(key, await this.ports.statTarget(fsPath))
      } catch {
        statOf.set(key, { kind: 'inaccessible' })
      }
    }
    const plan = planImageVerification(
      inputs,
      (key) => statOf.get(key) ?? { kind: 'inaccessible' },
      (key) => this.versions.lastKnownOf(key),
    )
    for (const [key, action] of plan) {
      if (action !== 'refresh') {
        continue
      }
      const fsPath = targets.get(key)
      if (!fsPath) {
        continue
      }
      const stat = statOf.get(key)
      if (stat?.kind === 'ok') {
        // 变化 → bump（新 URI）；断连恢复且元数据相同 → 不 bump（URI 不变，
        // 浏览器缓存命中恢复——不强制重取）
        this.versions.recordObservation(fsPath, { mtimeMs: stat.mtimeMs, size: stat.size })
      } else if (stat?.kind === 'missing') {
        this.versions.recordMissing(fsPath)
      }
      // inaccessible：不动版本表
      this.ports.invalidateTarget(fsPath)
    }
  }
}
