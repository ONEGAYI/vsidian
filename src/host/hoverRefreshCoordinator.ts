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
//   磁盘直通先到则单推（取消防抖 pending）；编辑器事件后到时可能在直通
//   推送之后重建 pending 防抖，350ms 后追加一次冗余推送——webview 重发
//   幂等（同实例新 reqId 重载），无正确性影响。
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

/** Provider watch admission is atomic with source retention in one JS turn. */
export function admitHoverWatch(
  coordinator: Pick<HoverRefreshCoordinator, 'canWatch' | 'watch'>,
  source: { retainHoverSource(sessionId: string, fsPath: string, instanceId: string,
    sourceLeaseId?: string): boolean },
  args: { sessionKey: string; sessionId: string; fsPath: string; instanceId: string; sourceLeaseId?: string },
  releaseRejectedLease: () => void,
): 'ok' | 'capacity' | 'source' {
  if (!coordinator.canWatch(args.fsPath)) {
    releaseRejectedLease()
    return 'capacity'
  }
  if (!source.retainHoverSource(args.sessionId, args.fsPath, args.instanceId, args.sourceLeaseId)) {
    releaseRejectedLease()
    return 'source'
  }
  coordinator.watch(args.sessionKey, args.fsPath, args.instanceId)
  return 'ok'
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
  /** 归一键 → 失效代次（单调递增；首观测为 1——与 vaultIndex generation 口径
   *  一致）。**有意不清理**（修 3 显式声明）：观测代次需单调，删除条目会让
   *  后续重新观测从 1 重来（回退）；按归一键积累、provider 级单件生命周期内
   *  量级为「被订阅过的目标数 × 小条目」，接受无界 */
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
  watch(sessionKey: string, fsPath: string, instanceId: string): boolean {
    if (this.disposed) {
      return false
    }
    return this.registry.watch(sessionKey, fsPath, instanceId)
  }

  canWatch(fsPath: string): boolean {
    return !this.disposed && this.registry.canWatch(fsPath)
  }

  /**
   * 目标是否仍有活跃订阅（B-1 / review-loops 波次一）：与 handleDiskEvent
   * 的 registry.has 同一登记表、同键归一——provider 的 TextDocument 事件
   * 转发判据（shouldForwardHoverDocChange）与 text 目标 per-file watcher
   * 的生命周期锚都以「目标在登记表中」为准，不另设第二套口径。
   */
  isWatched(fsPath: string): boolean {
    return !this.disposed && this.registry.has(fsPath)
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
   * 目标 pending 防抖——直通先到则单推；若编辑器事件后到（外部改写的
   * TextDocument 同步晚于 watcher），pending 在直通之后重建、350ms 后
   * 可能追加一次冗余推送（webview 重发幂等，无正确性影响）。
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

/** session 缓存失效目标（provider 层注入 DocumentSession 的结构面；
 *  host/documentSession 不依赖 vscode，本模块经该接口引用而不反向耦合） */
export interface HoverCacheInvalidator {
  invalidateHoverReads(fsPath: string): void
}

/**
 * B-1（review-loops 波次一）：onDidChangeTextDocument 的 hover 域转发
 * 判据——.md 既有域（索引域语义：未订阅也放行，经 connectHoverEvents
 * 无条件广播 session 缓存失效——修 1 语义保持，不得收窄）∪ 已 watch
 * 目标（text 等非 md 载荷按订阅集合放行；#340 票面「未保存修改正确
 * 刷新」对 text 目标的通路）。isWatched 为协调器登记表查询——判据数据
 * 面与推送门控（registry.has 早退）同源，未 watch 目标转发即零开销。
 */
export function shouldForwardHoverDocChange(
  docPath: string,
  fsPath: string,
  isWatched: (fsPath: string) => boolean,
): boolean {
  return /\.md$/i.test(docPath) || isWatched(fsPath)
}

/**
 * provider 层事件接线（修 1，review 第二轮 P2）：onDidChangeTextDocument 与
 * vaultIndex.onTargetChange 两条事件源转发给协调器的**同时**，对全部活跃
 * session 无条件广播缓存失效——失效不依赖订阅在场。此前仅 pushInvalidation
 * 推送路径清缓存，而 handleDocChanged/handleDiskEvent 以 registry.has(fsPath)
 * 早退：浮层/卡片关闭（unwatch）后目标被修改，事件被丢弃、缓存不失效，
 * 再悬停命中陈旧全文（hover.request 缓存命中直接回包无版本比对，且首载
 * appliedVersion=-1 无法仲裁）。
 *
 * invalidateHoverReads 按目标 fsPath 反查缓存，未读取过的目标零副作用；
 * 推送门控保持不变（未订阅目标零推送开销）。
 */
export function connectHoverEvents(
  coordinator: HoverRefreshCoordinator,
  sessions: () => Iterable<HoverCacheInvalidator>,
): {
  onDocChanged(fsPath: string): void
  onDiskEvent(fsPath: string, status: HoverInvalidationStatus): void
} {
  const broadcastInvalidation = (fsPath: string): void => {
    for (const session of sessions()) {
      session.invalidateHoverReads(fsPath)
    }
  }
  return {
    onDocChanged(fsPath) {
      coordinator.handleDocChanged(fsPath)
      broadcastInvalidation(fsPath)
    },
    onDiskEvent(fsPath, status) {
      coordinator.handleDiskEvent(fsPath, status)
      broadcastInvalidation(fsPath)
    },
  }
}
