// 编辑器面板的装载对账（#351 多面板 / #354 T05 realpath 门控 / #557 迟到
// 验证竞态收口）。原驻 addonWiring（pushEditorDirectives /
// postEditorLoadIfVerified），#557 起提取为无 vscode 依赖的纯模块（对齐
// 设置面板侧 addonSettingsPanelReconcile 的 #555 三轮模式）：
// - 生产（addonWiring）注入 webview 绑定端口运行同一实现；
// - 单元测试（addonEditorLifecycle.test.ts）注入可控验证 promise 复用
//   同一实现——迟到验证竞态（停用/换代后在途验证返回）须以真实
//   deferred 时序暴露，不再手写第二份对账逻辑。
// 与设置面板侧（单值 desired + 面板级纪元）的本质差异：编辑器面板的
// desired 是多值集合（每启用组件一个入口），失效令牌按**组件**粒度挂在
// 面板记录上——组件 A 的失效/换代不影响组件 B 的在途验证与装载。
import type { AddonEditorLoadPlan } from './addonRuntime'
import type { AddonPageDirective } from '../../shared/addonPage'
import { directiveEventOf } from './addonSettingsPanelReconcile'

/** 编辑器面板的对账记录（宿主侧单个编辑器面板的全部对账状态） */
export interface EditorPanelReconcileRecord {
  /** 已推送的装载（addonId → generation；desired 对账基线，面板 ready
   *  重载归零重推） */
  pushed: Map<string, number>
  /** #354 T05 realpath 验证在途的装载（addonId → 发起信息；同计划去重。
   *  #557 起槽位带属主（serial）——迟到完成只回收自己的槽位，不交叉清掉
   *  后继计划已占用的去重标记） */
  pendingVerify: Map<string, { addonId: string; generation: number; serial: number }>
  /** 验证发起序号（面板级单调——槽位属主标识的来源） */
  verifySerial: number
  /** #557 按组件的验证失效纪元：desired 集合移除该组件或其代次变化时
   *  仅该组件 +1。验证发起时捕获、返回后核对——迟到结果严格失效，不把
   *  旧验证的结论安到后续装载上（多组件并存：纪元彼此独立） */
  verifyEpochs: Map<string, number>
  /** 上次观察到的 desired 代次表（addonId → generation；观察比较用） */
  lastDesiredById: Map<string, number>
}

export function createEditorPanelRecord(): EditorPanelReconcileRecord {
  return { pushed: new Map(), pendingVerify: new Map(), verifySerial: 0, verifyEpochs: new Map(), lastDesiredById: new Map() }
}

/** 对账端口（生产按面板 webview 闭包提供；测试注入可控替身） */
export interface EditorPanelReconcilePorts {
  /** 期望装载的编辑器页计划（runtime.desiredEditorLoads——每启用组件一个入口） */
  desiredLoads(): readonly AddonEditorLoadPlan[]
  /** 已判逃逸目录的免复核短路（realpathGuard.isEscapedDir） */
  isEscapedDir(fsPath: string): boolean
  /** #354 T05 realpath 装载门控（符号链接指向安装目录外的复核） */
  verifyLoadPlan(plan: AddonEditorLoadPlan): Promise<'ok' | 'escape'>
  /** 逃逸计划的目录级排除登记（安全事实与失效纪元无关——迟到结果同样登记） */
  blockEscapePlanRoots(plan: AddonEditorLoadPlan): void
  /** 装载指令铸造（manifest 的本页资源地址由调用方按面板 webview 铸造） */
  buildLoadDirective(plan: AddonEditorLoadPlan): AddonPageDirective
  postDirective(directive: AddonPageDirective): void
  recordEvent(event: { kind: string; addonId: string; generation?: number }): void
  /** 行为状态下发（随装载指令对账同拍——工厂执行时 SDK 已持权威值） */
  postBehaviorState(): void
  /** 行为禁用态广播（先于装载指令到达——工厂执行时已持权威值） */
  postBehaviorEnabledState(): void
}

/**
 * 多值对账：desired 集合移除的组件推 unload 并清 pushed；desired 内的
 * 计划经 realpath 门控推 load（同计划去重）。#557：每组件的 desired 身份
 * （在场与代次）被观察到变化（停用/释放/换代）时仅使**该组件**的在途
 * 验证失效（纪元 +1、槽位回收）——后继计划立即发起全新验证，不等旧验证
 * 返回；其他组件的在途验证与装载不受影响。
 */
export function pushEditorPanelDirectives(ports: EditorPanelReconcilePorts, record: EditorPanelReconcileRecord): void {
  // T07（#356）行为状态下发（随装载指令对账同拍：ready/状态变化/显式
  // pushDirectives 都经此处）；#476 行为禁用态广播（先于装载指令：工厂
  // 执行时 behaviorState 已持权威值）
  ports.postBehaviorState()
  ports.postBehaviorEnabledState()
  const desired = ports.desiredLoads()
  const desiredIds = new Set<string>()
  const desiredById = new Map<string, number>()
  for (const plan of desired) {
    desiredIds.add(plan.addonId)
    // 每组件单编辑器入口（runtime registerEditor 第二个拒绝），同组件
    // 多计划（防御性）取首见代次
    if (!desiredById.has(plan.addonId)) {
      desiredById.set(plan.addonId, plan.generation)
    }
  }
  // #557 按组件失效：desired 移除或代次变化 → 仅该组件纪元 +1 并回收其
  // 在途验证槽位（迟到结果按纪元丢弃）
  for (const addonId of new Set([...record.lastDesiredById.keys(), ...desiredIds])) {
    if (record.lastDesiredById.get(addonId) !== desiredById.get(addonId)) {
      record.verifyEpochs.set(addonId, (record.verifyEpochs.get(addonId) ?? 0) + 1)
      record.pendingVerify.delete(addonId)
    }
  }
  record.lastDesiredById = desiredById
  // 停用/故障/释放的组件：推送 unload（携带最后装载代次；装载器幂等）
  for (const [addonId, generation] of [...record.pushed.entries()]) {
    if (!desiredIds.has(addonId)) {
      const directive: AddonPageDirective = { type: 'addon.unload', addonId, generation }
      ports.recordEvent(directiveEventOf(directive))
      ports.postDirective(directive)
      record.pushed.delete(addonId)
    }
  }
  for (const plan of desired) {
    const pushed = record.pushed.get(plan.addonId)
    if (pushed === plan.generation) {
      continue // 同代次已推送（webview 重载由 ready 重推）
    }
    void postEditorLoadIfVerified(ports, record, plan)
  }
}

/**
 * #354 T05 编辑器面板的 realpath 门控推送（验证在途按 addonId+代次去重；
 * escape 拒绝并登记目录排除）。#557：await 返回后按组件双核对——失效
 * 纪元未变 **且** 该组件仍在当前 desired 集合（代次一致）才推 load；
 * 停用/释放/换代的迟到验证丢弃并留痕（不推旧计划的 load：停用组件会整
 * 页迟到装载，旧代次指令会让装载器释放已装好的新代次——「不同代次先
 * 释放旧再装新」的换代信号不得被迟到的旧计划触发）。
 */
async function postEditorLoadIfVerified(ports: EditorPanelReconcilePorts, record: EditorPanelReconcileRecord, plan: AddonEditorLoadPlan): Promise<void> {
  if (record.pushed.get(plan.addonId) === plan.generation) return
  if (record.pendingVerify.get(plan.addonId)?.generation === plan.generation) return
  // 已判逃逸的入口/样式/资源基址：直接拒绝（免文件系统复核）
  if (
    ports.isEscapedDir(plan.entryFsPath) ||
    plan.cssFsPaths.some((css) => ports.isEscapedDir(css)) ||
    (plan.resourceBaseFsPath !== null && ports.isEscapedDir(plan.resourceBaseFsPath))
  ) {
    ports.recordEvent({ kind: 'directive.load-rejected-realpath', addonId: plan.addonId, generation: plan.generation })
    return
  }
  record.verifySerial += 1
  const serial = record.verifySerial
  record.pendingVerify.set(plan.addonId, { addonId: plan.addonId, generation: plan.generation, serial })
  const epoch = record.verifyEpochs.get(plan.addonId) ?? 0
  const verdict = await ports.verifyLoadPlan(plan)
  // 槽位回收带属主：迟到完成只回收自己发起的槽位（后继计划已占用的
  // 去重标记不被交叉清掉）
  if (record.pendingVerify.get(plan.addonId)?.serial === serial) {
    record.pendingVerify.delete(plan.addonId)
  }
  if (verdict === 'escape') {
    // 文件系统事实迟到照登（先于失效核对——与设置面板侧同口径：目录
    // 排除表是安全事实，与 desired 纪元无关）
    ports.blockEscapePlanRoots(plan)
    ports.recordEvent({ kind: 'directive.load-rejected-realpath', addonId: plan.addonId, generation: plan.generation })
    return
  }
  // #557 双核对：验证令牌未失效 + 组件仍在当前 desired 集合（代次一致）
  const stillDesired = ports.desiredLoads().some((p) => p.addonId === plan.addonId && p.generation === plan.generation)
  if ((record.verifyEpochs.get(plan.addonId) ?? 0) !== epoch || !stillDesired) {
    // 迟到且失效：desired 已离开本计划（停用/释放/换代——折返同身份也作
    // 废，realpath 复核只读无副作用，重开的计划走全新验证）
    ports.recordEvent({ kind: 'directive.load-dropped-stale', addonId: plan.addonId, generation: plan.generation })
    return
  }
  if (record.pushed.get(plan.addonId) === plan.generation) return
  const directive = ports.buildLoadDirective(plan)
  ports.recordEvent(directiveEventOf(directive))
  ports.postDirective(directive)
  record.pushed.set(plan.addonId, plan.generation)
}
