// T06（#355）附加组件统一视图注册表（webview 页面级）。
//
// 职责：维护本页面全部可寻址视图实例（主正文 / 嵌入内部 Live / 悬停
// 引用只读），向页面 SDK 的 views 面提供 list/句柄操作；编辑提交的来源
// 身份在此层注入（addonId 由 SDK 装载器传入、opId 由 SDK 生成），组件
// 请求不携带身份字段——不能冒充其他组件。
//
// 事实源：docs/specs/vsidian-addons-tickets/t06.md、设计 §5.1；坐标约定
// UTF-16/LF（webview 全程 LF）。
import type {
  AddonApplyEditsRequest,
  AddonApplyEditsResult,
  AddonEditHistory,
  AddonSelectionRange,
  AddonSnapshotResult,
  AddonViewInfo,
  AddonViewMode,
} from '../shared/addonEditApi'
import { isAddonApplyEditsRequest } from '../shared/addonEditApi'
import type {
  AddonHeadingFoldApplyOptions,
  AddonHeadingFoldCommandResult,
  AddonHeadingFoldOperation,
  AddonHeadingFoldQueryResult,
} from '../shared/addonFoldApi'
import { isAddonHeadingFoldApplyOptions, isAddonHeadingFoldKeyList, isAddonHeadingFoldOperation } from '../shared/addonFoldApi'
import type { EditOriginMeta } from '../shared/editOrigin'
import type { LiveEditorInstance } from './liveInstance'

/** 可写视图（main 主正文 / embed 嵌入内部 Live）：LiveEditorInstance 承载 */
export interface AddonLiveViewEntry {
  viewType: 'main' | 'embed'
  instanceId: string
  targetDocUri: string
  /** 模式查询（主正文随面板双态；嵌入恒 live） */
  mode: () => AddonViewMode
  instance: LiveEditorInstance
}

/** 只读视图（hover 悬停引用）：无写端口，快照为读取成功时登记的目标文本 */
export interface AddonReadonlyViewEntry {
  viewType: 'hover'
  instanceId: string
  targetDocUri: string
  text: string
  version: number
}

/** SDK → 注册表的操作面（装载器 buildSdk 消费；opId 由装载器生成注入） */
export interface AddonViewsRuntime {
  list(): readonly AddonViewInfo[]
  infoOf(instanceId: string): AddonViewInfo | undefined
  snapshotOf(instanceId: string): AddonSnapshotResult
  applyEdits(input: {
    addonId: string
    opId: string
    instanceId: string
    request: AddonApplyEditsRequest
  }): Promise<AddonApplyEditsResult>
  setSelectionOf(instanceId: string, ranges: AddonSelectionRange[]): boolean
  revealOf(instanceId: string, offset: number): boolean
  /** #410 折叠查询（Live-only：非 Live 视图拒绝，实例侧消费 headingFold
   *  纯函数族——不复制派生逻辑） */
  headingFoldsOf(instanceId: string): AddonHeadingFoldQueryResult
  /** #410 可折叠区间全集（同上口径） */
  foldableHeadingSpansOf(instanceId: string): AddonHeadingFoldQueryResult
  /** #410 五操作执行（直传本体执行体；守卫失败 invalid-request） */
  applyHeadingFoldOf(
    instanceId: string,
    operation: AddonHeadingFoldOperation,
    options?: AddonHeadingFoldApplyOptions,
  ): AddonHeadingFoldCommandResult
  /** #410 按区间键折叠（批量组合） */
  foldAtOf(instanceId: string, keys: readonly number[]): AddonHeadingFoldCommandResult
  /** #410 按区间键展开（批量组合） */
  unfoldAtOf(instanceId: string, keys: readonly number[]): AddonHeadingFoldCommandResult
  onCreated(callback: (info: AddonViewInfo) => void): () => void
  onDisposed(callback: (info: AddonViewInfo) => void): () => void
}

/**
 * 页面级视图注册表。一个 webview 页面一份（main.ts 构造注入装载器与
 * 控制器）；注册/注销由各视图创建点驱动（syncController 主正文、
 * embedCard 嵌入、hoverPopup 悬停读取）。
 */
export class AddonViewRegistry implements AddonViewsRuntime {
  private readonly liveViews = new Map<string, AddonLiveViewEntry>()
  private readonly readonlyViews = new Map<string, AddonReadonlyViewEntry>()
  private readonly createdHandlers = new Set<(info: AddonViewInfo) => void>()
  private readonly disposedHandlers = new Set<(info: AddonViewInfo) => void>()

  /** 注册可写视图（同 ID 重复注册以新代旧——实例重建场景，旧条目触发
   *  onDisposed 后新条目触发 onCreated，订阅方按序刷新） */
  registerLive(entry: AddonLiveViewEntry): void {
    if (this.liveViews.has(entry.instanceId) || this.readonlyViews.has(entry.instanceId)) {
      this.unregister(entry.instanceId)
    }
    this.liveViews.set(entry.instanceId, entry)
    this.emitCreated(this.infoOf(entry.instanceId)!)
  }

  /** 注册只读视图（hover 读取成功时登记） */
  registerReadonly(entry: AddonReadonlyViewEntry): void {
    if (this.liveViews.has(entry.instanceId) || this.readonlyViews.has(entry.instanceId)) {
      this.unregister(entry.instanceId)
    }
    this.readonlyViews.set(entry.instanceId, entry)
    this.emitCreated(this.infoOf(entry.instanceId)!)
  }

  /** 注销视图（实例销毁 / 浮层关闭 / 切回 Reading） */
  unregister(instanceId: string): void {
    const info = this.infoOf(instanceId)
    this.liveViews.delete(instanceId)
    this.readonlyViews.delete(instanceId)
    if (info) {
      for (const handler of this.disposedHandlers) {
        try {
          handler(info)
        } catch {
          // 订阅方异常不阻断其余订阅
        }
      }
    }
  }

  list(): readonly AddonViewInfo[] {
    return [...this.liveViews.values()].map((e) => this.liveInfoOf(e))
      .concat([...this.readonlyViews.values()].map((e) => this.readonlyInfoOf(e)))
  }

  infoOf(instanceId: string): AddonViewInfo | undefined {
    const live = this.liveViews.get(instanceId)
    if (live) {
      return this.liveInfoOf(live)
    }
    const readonly = this.readonlyViews.get(instanceId)
    return readonly ? this.readonlyInfoOf(readonly) : undefined
  }

  snapshotOf(instanceId: string): AddonSnapshotResult {
    const live = this.liveViews.get(instanceId)
    if (live) {
      const snapshot = live.instance.snapshotForAddon()
      if (snapshot) {
        return { ok: true, snapshot }
      }
      return { ok: false, reason: 'view-disposed' }
    }
    const readonly = this.readonlyViews.get(instanceId)
    if (readonly) {
      return {
        ok: true,
        snapshot: { text: readonly.text, selections: [], version: readonly.version, revision: 0 },
      }
    }
    return { ok: false, reason: 'view-disposed' }
  }

  /** 编辑提交：来源注入（addonId/opId 由装载器层生成），请求形状与快照
   *  校验在实例侧（liveInstance.applyAddonEdit） */
  async applyEdits(input: {
    addonId: string
    opId: string
    instanceId: string
    request: AddonApplyEditsRequest
  }): Promise<AddonApplyEditsResult> {
    const live = this.liveViews.get(input.instanceId)
    if (!live) {
      const readonly = this.readonlyViews.has(input.instanceId)
      return { ok: false, reason: readonly ? 'read-only' : 'view-disposed' }
    }
    if (live.mode() !== 'live') {
      return { ok: false, reason: 'read-only' }
    }
    if (!isAddonApplyEditsRequest(input.request)) {
      return { ok: false, reason: 'invalid-request' }
    }
    const undo: AddonEditHistory = input.request.history ?? 'atomic'
    const origins: EditOriginMeta[] = [{ addonId: input.addonId, opId: input.opId, undo }]
    return live.instance.applyAddonEdit({
      request: {
        revision: input.request.revision,
        changes: input.request.changes,
        ...(input.request.selection !== undefined ? { selection: input.request.selection } : {}),
      },
      origins,
    })
  }

  setSelectionOf(instanceId: string, ranges: AddonSelectionRange[]): boolean {
    const live = this.liveViews.get(instanceId)
    if (!live || live.mode() !== 'live') {
      return false
    }
    return live.instance.setSelectionForAddon(ranges)
  }

  revealOf(instanceId: string, offset: number): boolean {
    const live = this.liveViews.get(instanceId)
    if (!live || live.mode() !== 'live') {
      return false
    }
    return live.instance.revealForAddon(offset)
  }

  // ---- #410 标题折叠面（experimental.headingFold 的注册表分派） ----
  // 拒绝分层对齐 applyEdits：实例不存在 view-disposed；非 Live（reading
  // 态或 hover 只读登记）read-only；请求形状非法 invalid-request——
  // 实例侧（liveInstance.*ForAddon）只认 view 在场。

  headingFoldsOf(instanceId: string): AddonHeadingFoldQueryResult {
    const live = this.liveViews.get(instanceId)
    if (!live) {
      return this.readonlyViews.has(instanceId)
        ? { ok: false, reason: 'read-only' }
        : { ok: false, reason: 'view-disposed' }
    }
    if (live.mode() !== 'live') {
      return { ok: false, reason: 'read-only' }
    }
    const spans = live.instance.headingFoldsForAddon()
    return spans === null ? { ok: false, reason: 'view-disposed' } : { ok: true, spans }
  }

  foldableHeadingSpansOf(instanceId: string): AddonHeadingFoldQueryResult {
    const live = this.liveViews.get(instanceId)
    if (!live) {
      return this.readonlyViews.has(instanceId)
        ? { ok: false, reason: 'read-only' }
        : { ok: false, reason: 'view-disposed' }
    }
    if (live.mode() !== 'live') {
      return { ok: false, reason: 'read-only' }
    }
    const spans = live.instance.foldableHeadingSpansForAddon()
    return spans === null ? { ok: false, reason: 'view-disposed' } : { ok: true, spans }
  }

  applyHeadingFoldOf(
    instanceId: string,
    operation: AddonHeadingFoldOperation,
    options?: AddonHeadingFoldApplyOptions,
  ): AddonHeadingFoldCommandResult {
    const live = this.liveViews.get(instanceId)
    if (!live) {
      return this.readonlyViews.has(instanceId)
        ? { ok: false, reason: 'read-only' }
        : { ok: false, reason: 'view-disposed' }
    }
    if (live.mode() !== 'live') {
      return { ok: false, reason: 'read-only' }
    }
    // upToLevel 仅 foldAll 接受（其余操作携带即形状非法——契约窄而明确）
    if (options !== undefined && (operation !== 'foldAll' || !isAddonHeadingFoldApplyOptions(options))) {
      return { ok: false, reason: 'invalid-request' }
    }
    if (!isAddonHeadingFoldOperation(operation)) {
      return { ok: false, reason: 'invalid-request' }
    }
    const outcome = live.instance.applyHeadingFoldForAddon(operation, options)
    return outcome === 'view-disposed' ? { ok: false, reason: 'view-disposed' } : { ok: true, applied: outcome.applied }
  }

  foldAtOf(instanceId: string, keys: readonly number[]): AddonHeadingFoldCommandResult {
    return this.foldKeysOf(instanceId, keys, true)
  }

  unfoldAtOf(instanceId: string, keys: readonly number[]): AddonHeadingFoldCommandResult {
    return this.foldKeysOf(instanceId, keys, false)
  }

  private foldKeysOf(instanceId: string, keys: readonly number[], fold: boolean): AddonHeadingFoldCommandResult {
    const live = this.liveViews.get(instanceId)
    if (!live) {
      return this.readonlyViews.has(instanceId)
        ? { ok: false, reason: 'read-only' }
        : { ok: false, reason: 'view-disposed' }
    }
    if (live.mode() !== 'live') {
      return { ok: false, reason: 'read-only' }
    }
    if (!isAddonHeadingFoldKeyList(keys)) {
      return { ok: false, reason: 'invalid-request' }
    }
    const outcome = live.instance.foldAtForAddon(keys, fold)
    return outcome === 'view-disposed' ? { ok: false, reason: 'view-disposed' } : { ok: true, applied: outcome.applied }
  }

  onCreated(callback: (info: AddonViewInfo) => void): () => void {
    this.createdHandlers.add(callback)
    return () => this.createdHandlers.delete(callback)
  }

  onDisposed(callback: (info: AddonViewInfo) => void): () => void {
    this.disposedHandlers.add(callback)
    return () => this.disposedHandlers.delete(callback)
  }

  private liveInfoOf(entry: AddonLiveViewEntry): AddonViewInfo {
    const mode = entry.mode()
    return {
      instanceId: entry.instanceId,
      targetDocUri: entry.targetDocUri,
      mode,
      viewType: entry.viewType,
      editable: mode === 'live',
    }
  }

  private readonlyInfoOf(entry: AddonReadonlyViewEntry): AddonViewInfo {
    return {
      instanceId: entry.instanceId,
      targetDocUri: entry.targetDocUri,
      mode: 'reading',
      viewType: entry.viewType,
      editable: false,
    }
  }

  private emitCreated(info: AddonViewInfo): void {
    for (const handler of this.createdHandlers) {
      try {
        handler(info)
      } catch {
        // 订阅方异常不阻断其余订阅
      }
    }
  }
}
