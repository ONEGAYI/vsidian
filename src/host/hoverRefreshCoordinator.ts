// 引用视图刷新协调器（工单 #224）：provider 级单件，串起「宿主观测到被
// 订阅目标变化 → 向订阅面板推送 hover.invalidated」的事件路径。本模块
// 保持纯逻辑（事件与推送经端口注入，vscode 层装配在 textEditorProvider；
// 先例：imageRefreshCoordinator——图片失效的同构通道）。
//
// 事件分态（规格「Reading 内容、属性与刷新」+「文档访问与消息约束」）：
// - **宿主文档修改（TextDocument 变更，含未保存）**：防抖合并（debounceMs
//   + maxWaitMs 强制合并，数学复用 vaultIndexSchedule.planFlushAt）——短暂
//   合并刷新，不等待保存；未送达宿主的前端输入不在承诺内。
// - **磁盘/索引事件（vaultIndex onTargetChange：changed/deleted/stale）**：
//   直通推送（vaultIndex 侧已去抖）并取消该目标 pending 防抖（合并为一次）
//   ——deleted 立即撤下内容不等防抖；stale 是权限/断连（不可访问），不得
//   等同删除。
// - 外部改写已打开文档会同时到达两条路径（TextDocument 同步 + watcher）：
//   磁盘直通先推、pending 防抖取消，不双推。
//
// 自引用防循环：推送只出站消息，webview 重载经 hover.request 只读
// （openTextDocument+getText 无副作用）——不产生新事件源，循环收敛。
// 目标自引用（A 嵌入 A）同链路：编辑 → 推送 → 重读 → 停。
//
// 订阅生命周期：面板销毁经 releaseSession 整体释放（webview 重载/关闭
// 由 attachPanel 侧配对）；目标数有界（HoverWatchRegistry LRU）。
import {
  HOVER_REFRESH_DEFAULTS,
  HoverWatchRegistry,
} from '../shared/hoverRefresh'
import { planFlushAt } from '../shared/vaultIndexSchedule'

/** 失效推送分态（与 vaultIndex onTargetChange 的 VaultTargetChangeStatus
 * 同口径；协议 hover.invalidated.status） */
export type HoverInvalidationStatus = 'changed' | 'deleted' | 'stale'

/** 协调器端口（vscode 层注入） */
export interface HoverRefreshPorts {
  /**
   * 失效推送：对订阅该目标的全部会话发送 hover.invalidated（vscode 层
   * 解析 sessionKey → entry.session.postToPanel）。回调内只发消息——
   * 不得触发宿主事件源（自引用防循环的结构前提）。
   */
  pushInvalidation(
    sessionKeys: readonly string[],
    fsPath: string,
    status: HoverInvalidationStatus,
    generation: number,
  ): void
}

/** 防抖窗内状态（per 目标） */
interface PendingFlush {
  /** 首个未冲刷事件时刻（强制合并窗口起点） */
  firstAt: number
  /** 最近事件时刻（防抖窗起点） */
  lastAt: number
  timer: ReturnType<typeof setTimeout>
}

/**
 * 引用视图刷新协调器。事件源由 vscode 层转发（onDidChangeTextDocument →
 * handleDocChanged；vaultIndex.onTargetChange → handleDiskEvent）；订阅由
 * hover.watch / hover.unwatch 消息（经 session 守卫后）登记。
 */
export class HoverRefreshCoordinator {
  private readonly registry: HoverWatchRegistry
  /** 归一键 → 防抖窗状态（编辑器事件与磁盘事件可能仅大小写不同——键归一
   *  保证两路径的 pending 互相可见，磁盘直通能正确取消防抖 pending） */
  private readonly pending = new Map<string, PendingFlush>()
  /** 归一键 → 失效代次（单调递增；首观测为 1——与 vaultIndex generation 口径一致） */
  private readonly generations = new Map<string, number>()
  private readonly keyOf: (fsPath: string) => string
  private disposed = false

  constructor(
    private readonly ports: HoverRefreshPorts,
    private readonly options?: {
      debounceMs?: number
      maxWaitMs?: number
      targetLimit?: number
      /** Windows 宿主文件系统语义（注册表键折叠大小写——编辑器事件与
       *  读取归正的 fsPath 可能仅大小写不同，精确匹配会漏推送） */
      isWindowsHost?: boolean
    },
  ) {
    this.keyOf = options?.isWindowsHost
      ? (fsPath) => fsPath.replaceAll('\\', '/').toLowerCase()
      : (fsPath) => fsPath
    this.registry = new HoverWatchRegistry(options?.targetLimit, this.keyOf)
  }

  /** 登记实例订阅（幂等；sessionKey = docUri::sessionId） */
  watch(sessionKey: string, fsPath: string, instanceId: string): void {
    if (this.disposed) {
      return
    }
    this.registry.watch(sessionKey, fsPath, instanceId)
  }

  /** 释放实例订阅（目标内最后一个实例退场才撤目标） */
  unwatch(sessionKey: string, fsPath: string, instanceId: string): void {
    this.registry.unwatch(sessionKey, fsPath, instanceId)
    if (!this.registry.has(fsPath)) {
      this.cancelPending(fsPath)
    }
  }

  /** 会话整体释放（面板销毁：订阅计数回落）；退场目标的 pending 一并取消 */
  releaseSession(sessionKey: string): void {
    for (const fsPath of this.registry.releaseSession(sessionKey)) {
      this.cancelPending(fsPath)
    }
  }

  /**
   * 宿主文档修改（onDidChangeTextDocument 转发；version 单调由 VSCode
   * 保证——协调器只关心「变了」）。未被订阅目标零开销返回。
   */
  handleDocChanged(fsPath: string): void {
    if (this.disposed || !this.registry.has(fsPath)) {
      return
    }
    const key = this.keyOf(fsPath)
    const now = Date.now()
    const prev = this.pending.get(key)
    if (prev) {
      clearTimeout(prev.timer)
    }
    const firstAt = prev?.firstAt ?? now
    const debounceMs = this.options?.debounceMs ?? HOVER_REFRESH_DEFAULTS.debounceMs
    const maxWaitMs = this.options?.maxWaitMs ?? HOVER_REFRESH_DEFAULTS.maxWaitMs
    const flushAt = planFlushAt(firstAt, now, debounceMs, maxWaitMs)
    const timer = setTimeout(() => {
      this.pending.delete(key)
      this.push(fsPath, 'changed')
    }, Math.max(0, flushAt - now))
    this.pending.set(key, { firstAt, lastAt: now, timer })
  }

  /**
   * 磁盘/索引事件（vaultIndex onTargetChange 转发）：直通推送并取消该
   * 目标 pending 防抖（外部改写已打开文档的双路径到达只推一次）。
   * vaultIndex 侧已去抖（rescanTimers），此处不再加窗——deleted 不等待。
   */
  handleDiskEvent(fsPath: string, status: HoverInvalidationStatus): void {
    if (this.disposed || !this.registry.has(fsPath)) {
      return
    }
    this.cancelPending(fsPath)
    this.push(fsPath, status)
  }

  /** 目标当前失效代次（观测面；未观测为 0） */
  generationOf(fsPath: string): number {
    return this.generations.get(this.keyOf(fsPath)) ?? 0
  }

  /** 订阅观测（集成断言订阅计数回落） */
  stats(): { targets: number; subscriptions: number } {
    return { targets: this.registry.targets(), subscriptions: this.registry.totalSubscriptions() }
  }

  /** 全量释放（扩展停用）：清定时器与订阅 */
  dispose(): void {
    this.disposed = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
    }
    this.pending.clear()
    this.registry.clear()
  }

  // ---- 内部 ----

  /** 推送失效（代次推进 + 路由订阅会话） */
  private push(fsPath: string, status: HoverInvalidationStatus): void {
    const sessionKeys = this.registry.subscribersOf(fsPath)
    if (sessionKeys.length === 0) {
      return // 推送瞬间订阅已退场（unwatch 竞态）：静默
    }
    const key = this.keyOf(fsPath)
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1)
    // 载荷用登记形态（canonicalOf）——与 webview 侧 loaded.fsPath 同源，
    // 事件源形态（编辑器/索引）仅大小写不同也能命中
    this.ports.pushInvalidation(
      sessionKeys,
      this.registry.canonicalOf(fsPath),
      status,
      this.generations.get(key)!,
    )
  }

  private cancelPending(fsPath: string): void {
    const key = this.keyOf(fsPath)
    const pending = this.pending.get(key)
    if (pending) {
      clearTimeout(pending.timer)
      this.pending.delete(key)
    }
  }
}
