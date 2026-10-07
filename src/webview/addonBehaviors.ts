// T07（#356）可组合输入行为——webview 页面级 runtime（链执行）。
//
// 职责：
// - 登记各组件经 SDK behaviors.register 注册的输入行为（按组件 ID 命名
//   空间隔离；局部 ID 重复拒绝）；组件卸载/故障释放时整组注销。
// - 输入驱动（liveInstance 的门控检测后调用）：按有效序（默认序或宿主
//   下发覆盖）依次调用适用行为；每个行为读到**当前**快照（已含本次输入
//   与前序修饰结果——后续行为读取前序结果，技术方案 §5.2），返回不处理
//   或文本修饰计划；计划由平台提交（T06 applyEdits 管线），每次修饰按
//   行为自己的原子声明记账（Q29），来源身份（addonId/opId）由平台注入。
// - 独占组：同组件内同组按有效序首个**适用**者生效（返回计划才占用
//   组），其后同组跳过；跨组件不互斥（Q27：不恢复统一先接管者生效）。
// - onChanged 观察与输入修饰分开注册：观察者只收到事件（含快照），
//   无注册行为时不发生任何提交——不是原操作的第二写入口。
// - 行为注册/开关/顺序变化即时生效（runtime 内存表驱动，不经 CM6
//   Compartment 装配——组合期注册的边界见 T05 未决事项，与本面无关）。
//
// 链的容错口径：
// - 行为回调异常：记日志留痕并**升级为全组件故障**（T12 #361：reportFault
//   端口上报宿主裁决，ADR「可捕获且可归因的回调异常按已确认规则暂停
//   组件」）；上报后跳过该行为，链继续——其他组件不受本次故障牵连，
//   本组件贡献由宿主 faultRecord 后的 unload 指令整体回收。
// - 观察者（onChanged）异常：只计数留痕不升级（通知面不是原操作的第二
//   写入口，T07 通知分离口径保持）。
// - 提交拒绝（stale-snapshot/conflict 等）：记轨迹，链继续（下一个行为
//   重新取快照，适用条件重新判断）。
// - 快照不可得（实例销毁）：终止整链。
// - 链在途时新输入不重入：跳过并计数（避免对同一窗口交错修饰）。
import type {
  AddonApplyEditsRequest,
  AddonApplyEditsResult,
  AddonSnapshotResult,
} from '../shared/addonEditApi'
import {
  addonBehaviorExclusiveGroupKey,
  addonBehaviorFullKey,
  addonBehaviorInfoOf,
  isAddonBehaviorRegistration,
  resolveAddonBehaviorOrder,
  type AddonBehaviorChangeEvent,
  type AddonBehaviorInfo,
  type AddonBehaviorInputPlan,
  type AddonBehaviorRegistration,
  type AddonBehaviorRuntimeStats,
  type AddonBehaviorStateStore,
  type AddonBehaviorTraceEntry,
  type AddonInputContext,
} from '../shared/addonBehaviors'

/** 输入修饰计划守卫（非法形态不进提交管线——SerChange 形状由
 * isAddonApplyEditsRequest 在 applyEdits 入口复核，此处提前拦截降低噪音） */
function isUsablePlan(v: unknown): v is AddonBehaviorInputPlan {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    return false
  }
  const candidate = v as { changes?: unknown }
  return Array.isArray(candidate.changes)
}

export interface AddonBehaviorRuntimePorts {
  /** 实例快照（链每步重新取——含前序修饰结果） */
  snapshotOf(instanceId: string): AddonSnapshotResult
  /** 修饰提交（T06 applyEdits 管线；来源身份由本 runtime 注入） */
  applyEdit(addonId: string, opId: string, instanceId: string, request: AddonApplyEditsRequest): Promise<AddonApplyEditsResult>
  /** 归因日志（阶段 + 组件 + 原因） */
  log(stage: string, addonId: string, detail: string): void
  /** T12（#361）可归因回调异常升级上报（main.ts 注入装载器的
   *  reportRuntimeFault；缺省仅留痕不升级——旧装配不受影响） */
  reportFault?(addonId: string, stage: string, detail: string): boolean
  /** T08（#357）注册表全量对账上报（可选——main.ts 注入，单测可缺省）：
   *  注册成功与整组件注销后各发一次该组件当前全表（空表 = 全撤信号），
   *  宿主据此构建行为冲突管理目录。镜像 T10 addonCommands.report 形态。 */
  report?(payload: { addonId: string; generation: number; behaviors: readonly AddonBehaviorInfo[] }): void
}

interface RegisteredBehavior {
  addonId: string
  generation: number
  registration: AddonBehaviorRegistration
}

const TRACE_LIMIT = 64

export class AddonBehaviorRuntime {
  private readonly behaviors = new Map<string, RegisteredBehavior>()
  private hostState: AddonBehaviorStateStore | null = null
  private readonly changeListeners = new Set<(event: AddonBehaviorChangeEvent) => void>()
  private readonly opIdAllocators = new Map<string, () => string>()
  private chainRunning = false
  private readonly counters = {
    drives: 0,
    drivesSkippedWhileRunning: 0,
    callbackErrors: 0,
    observerErrors: 0,
    invalidPlans: 0,
    submitsRejected: 0,
  }
  private readonly trace: AddonBehaviorTraceEntry[] = []

  constructor(private readonly ports: AddonBehaviorRuntimePorts) {}

  // ---- 注册（SDK behaviors.register 的后端） ----

  register(addonId: string, generation: number, input: unknown): { ok: true; key: string } | { ok: false; reason: 'invalid-registration' | 'duplicate-id' } {
    if (!isAddonBehaviorRegistration(input)) {
      this.ports.log('behavior-rejected', addonId, 'invalid-registration')
      return { ok: false, reason: 'invalid-registration' }
    }
    const key = addonBehaviorFullKey(addonId, input.id)
    if (this.behaviors.has(key)) {
      this.ports.log('behavior-rejected', addonId, `duplicate-id:${input.id}`)
      return { ok: false, reason: 'duplicate-id' }
    }
    this.behaviors.set(key, { addonId, generation, registration: input })
    this.reportOf(addonId)
    return { ok: true, key }
  }

  /** 组件释放（卸载/故障）时整组注销（装载器 releaseLoad 驱动） */
  unregisterAddon(addonId: string): void {
    let removed = false
    for (const [key, entry] of [...this.behaviors]) {
      if (entry.addonId === addonId) {
        this.behaviors.delete(key)
        removed = true
      }
    }
    this.opIdAllocators.delete(addonId)
    if (removed) {
      this.reportOf(addonId)
    }
  }

  /** 绑定该组件的 opId 分配器（装载器装载成功时注入；opId 体系与 T06
   *  applyEdits 同源：`g<代次>-op<N>`，页面级计数器共享） */
  bindOpIdAllocator(addonId: string, allocate: () => string): void {
    this.opIdAllocators.set(addonId, allocate)
  }

  // ---- 宿主状态（顺序覆盖 + 逐项开关的下发面） ----

  applyHostState(state: AddonBehaviorStateStore | null): void {
    this.hostState = state
  }

  // ---- 观察（通知分离：无修饰权） ----

  onChanged(callback: (event: AddonBehaviorChangeEvent) => void): () => void {
    this.changeListeners.add(callback)
    return () => this.changeListeners.delete(callback)
  }

  // ---- 输入驱动（liveInstance 门控检测后调用） ----

  /**
   * 驱动一次输入的行为链。门控（只读/IME/表格/Tab/代码上下文等内核
   * 情境）由调用方在 liveInstance 侧先行判定——本方法只处理已放行的
   * 用户输入。fire-and-forget（返回 Promise 仅供测试同步）。
   */
  async driveInput(instanceId: string, input: { userEvent: string; inputText: string }): Promise<void> {
    this.counters.drives++
    // 观察者先行投递（即使无行为注册——通知与修饰分离）
    if (this.changeListeners.size > 0) {
      const snapshotResult = this.ports.snapshotOf(instanceId)
      if (snapshotResult.ok) {
        for (const listener of [...this.changeListeners]) {
          try {
            listener({ userEvent: input.userEvent, inputText: input.inputText, snapshot: snapshotResult.snapshot })
          } catch {
            this.counters.observerErrors++
          }
        }
      }
    }
    const order = this.effectiveOrder()
    if (order.length === 0) {
      return
    }
    if (this.chainRunning) {
      this.counters.drivesSkippedWhileRunning++
      return
    }
    this.chainRunning = true
    try {
      const handledExclusiveGroups = new Set<string>()
      for (const key of order) {
        const entry = this.behaviors.get(key)
        if (!entry) continue
        const groupKey = entry.registration.exclusiveGroup !== undefined
          ? addonBehaviorExclusiveGroupKey(entry.addonId, entry.registration.exclusiveGroup)
          : null
        if (groupKey !== null && handledExclusiveGroups.has(groupKey)) {
          continue
        }
        const snapshotResult = this.ports.snapshotOf(instanceId)
        if (!snapshotResult.ok) {
          // 实例销毁：整链终止（后续行为无作用目标）
          break
        }
        const context: AddonInputContext = {
          userEvent: input.userEvent,
          inputText: input.inputText,
          snapshot: snapshotResult.snapshot,
        }
        let plan: AddonBehaviorInputPlan | null | undefined
        try {
          plan = entry.registration.onInput(context)
        } catch (err) {
          this.counters.callbackErrors++
          this.ports.log('behavior-callback-error', entry.addonId, `${entry.registration.id}: ${String(err)}`)
          // T12（#361）：可归因回调异常升级为全组件故障上报（组件 + 行为
          // ID + 原因）；链继续——其他组件不受牵连，本组件贡献由宿主
          // faultRecord 后的 unload 指令整体回收
          this.ports.reportFault?.(entry.addonId, 'behavior-onInput', `${entry.registration.id}: ${String(err)}`)
          continue
        }
        if (plan === null || plan === undefined) {
          continue
        }
        if (!isUsablePlan(plan)) {
          this.counters.invalidPlans++
          this.ports.log('behavior-plan-rejected', entry.addonId, `${entry.registration.id}: invalid shape`)
          continue
        }
        if (groupKey !== null) {
          handledExclusiveGroups.add(groupKey)
        }
        const allocate = this.opIdAllocators.get(entry.addonId)
        if (allocate === undefined) {
          // 组件已释放（opId 源随卸载解绑）：跳过该行为（不冒充来源）
          continue
        }
        const opId = allocate()
        const request: AddonApplyEditsRequest = {
          revision: snapshotResult.snapshot.revision,
          changes: plan.changes,
          ...(plan.selection !== undefined ? { selection: plan.selection } : {}),
          ...(entry.registration.history !== undefined ? { history: entry.registration.history } : {}),
        }
        let outcome: 'ok' | string
        try {
          const result = await this.ports.applyEdit(entry.addonId, opId, instanceId, request)
          outcome = result.ok ? 'ok' : result.reason
          if (!result.ok) {
            this.counters.submitsRejected++
            this.ports.log('behavior-submit-rejected', entry.addonId, `${entry.registration.id}: ${result.reason}`)
          }
        } catch (err) {
          outcome = 'error'
          this.ports.log('behavior-submit-error', entry.addonId, `${entry.registration.id}: ${String(err)}`)
        }
        this.trace.push({ behaviorKey: key, opId, outcome })
        if (this.trace.length > TRACE_LIMIT) {
          this.trace.shift()
        }
        // 拒绝不终止链：下一行为重新取快照、适用条件重新判断
      }
    } finally {
      this.chainRunning = false
    }
  }

  // ---- 观测 ----

  stats(): AddonBehaviorRuntimeStats {
    return {
      registrations: [...this.behaviors.values()].map((entry) =>
        addonBehaviorInfoOf(entry.addonId, entry.registration)),
      hostState: this.hostState === null
        ? null
        : { order: this.hostState.order, disabled: this.hostState.disabled },
      counters: { ...this.counters },
      trace: [...this.trace],
    }
  }

  /** 有效序（默认序 + 宿主覆盖；关闭项剔除） */
  private effectiveOrder(): string[] {
    return resolveAddonBehaviorOrder([...this.behaviors.keys()], this.hostState)
  }

  /** 该组件当前全表上报（空表 = 全撤信号；代次取该组件在场条目——空表
   *  时无从取得，置 0 表示「不携带有效代次」，与 T10 reportOf 同口径） */
  private reportOf(addonId: string): void {
    const report = this.ports.report
    if (report === undefined) {
      return
    }
    const entries = [...this.behaviors.values()].filter((entry) => entry.addonId === addonId)
    const generation = entries[0]?.generation ?? 0
    report({
      addonId,
      generation,
      behaviors: entries.map((entry) => addonBehaviorInfoOf(entry.addonId, entry.registration)),
    })
  }
}
