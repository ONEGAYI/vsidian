// 设置页面板的装载对账（#351 单面板 / #354 T05 realpath 门控 / #555 三轮
// 生命周期边界）。pushSettingsPanelDirectives 与 postSettingsLoadIfVerified
// 原驻 addonWiring，#555 评审三轮起提取为无 vscode 依赖的纯模块：
// - 生产（addonWiring）注入 webview 绑定端口运行同一实现；
// - 单元测试（addonSettingsLifecycle.test.ts）注入可控验证 promise 复用
//   同一实现——二轮测试把验证环节同步化（「忠实翻译」漂移）掩盖了验证
//   在途时切换/关闭组件的迟到装载竞态，不再手写第二份对账逻辑。
import type { AddonSettingsLoadPlan } from './addonRuntime'
import type { AddonPageDirective } from '../../shared/addonPage'

/** 指令 → 事件留痕形状（editor/settings 两面板共用的观测面记录） */
export const directiveEventOf = (directive: AddonPageDirective): { kind: string; addonId: string; generation?: number } => {
  switch (directive.type) {
    case 'addon.load':
      return { kind: 'directive.load', addonId: directive.manifest.addonId, generation: directive.manifest.generation }
    case 'addon.unload':
      return { kind: 'directive.unload', addonId: directive.addonId, generation: directive.generation }
    default:
      return { kind: `directive.${directive.type}`, addonId: directive.addonId, generation: directive.generation }
  }
}

/** 设置页面板的对账记录（宿主侧单个设置页面板的全部对账状态） */
export interface SettingsPanelReconcileRecord {
  /** 已推送的装载（desired 对账基线；面板 ready 重载归零重推） */
  pushed: { addonId: string; generation: number } | null
  /** #354 T05 realpath 验证在途的计划（同计划去重；#555 三轮起 desired
   *  变化即失效清空——旧验证的迟到结果不再拥有槽位） */
  pendingVerify: { addonId: string; generation: number; serial: number } | null
  /** 验证发起序号（在途槽位的属主标识——迟到完成只回收自己的槽位，不
   *  误清后继计划已占用的去重标记） */
  verifySerial: number
  /** #555 三轮：装载对账纪元——desired 身份（组件/代次）每次被观察到变化
   *  （切换/关闭/故障/换代）即 +1。验证发起时捕获、返回后核对：迟到结果
   *  严格失效，不把旧验证的结论安到后续装载上 */
  verifyEpoch: number
  /** 上次观察到的 desired 身份（null = 无装载意图） */
  lastDesired: { addonId: string; generation: number } | null
}

export function createSettingsPanelRecord(): SettingsPanelReconcileRecord {
  return { pushed: null, pendingVerify: null, verifySerial: 0, verifyEpoch: 0, lastDesired: null }
}

/** 对账端口（生产按面板 webview 闭包提供；测试注入可控替身） */
export interface SettingsPanelReconcilePorts {
  /** 期望装载的设置页计划（runtime.desiredSettingsLoad——无打开项为 null） */
  desiredLoad(): AddonSettingsLoadPlan | null
  /** 已判逃逸目录的免复核短路（realpathGuard.isEscapedDir） */
  isEscapedDir(fsPath: string): boolean
  /** #354 T05 realpath 装载门控（符号链接指向安装目录外的复核） */
  verifyLoadPlan(plan: AddonSettingsLoadPlan): Promise<'ok' | 'escape'>
  /** 逃逸计划的目录级排除登记（安全事实与纪元无关——迟到结果同样登记） */
  blockEscapePlanRoots(plan: AddonSettingsLoadPlan): void
  /** 装载指令铸造（manifest 的本页资源地址由调用方按面板 webview 铸造） */
  buildLoadDirective(plan: AddonSettingsLoadPlan): AddonPageDirective
  postDirective(directive: AddonPageDirective): void
  recordEvent(event: { kind: string; addonId: string; generation?: number }): void
  /** 行为禁用态广播（先于装载指令到达——工厂执行时已持权威值） */
  postBehaviorEnabledState(): void
}

/**
 * 单值对账：desired=null 且 pushed 在场 → 推 unload 并清 pushed；desired
 * 变化 → 经 realpath 门控推 load（同计划去重）。desired 身份变化即递增纪元
 * 并清在途验证——新 desired 立即发起全新验证，不等旧验证返回。
 */
export function pushSettingsPanelDirectives(ports: SettingsPanelReconcilePorts, record: SettingsPanelReconcileRecord): void {
  // #476 行为禁用态广播（同 webview postMessage 保序：停用后新装载/保持
  // 装载的设置页，工厂里 enabledState() 即读到 user-disabled，不等下一次
  // 状态变化）
  ports.postBehaviorEnabledState()
  const desired = ports.desiredLoad()
  const desiredKey = desired === null ? null : { addonId: desired.addonId, generation: desired.generation }
  if (record.lastDesired?.addonId !== desiredKey?.addonId || record.lastDesired?.generation !== desiredKey?.generation) {
    record.verifyEpoch += 1
    record.lastDesired = desiredKey
    record.pendingVerify = null // 在途验证立即失效（迟到结果按纪元丢弃）
  }
  if (desired === null) {
    if (record.pushed) {
      const directive: AddonPageDirective = { type: 'addon.unload', addonId: record.pushed.addonId, generation: record.pushed.generation }
      ports.recordEvent(directiveEventOf(directive))
      ports.postDirective(directive)
      record.pushed = null
    }
    return
  }
  if (record.pushed && record.pushed.addonId === desired.addonId && record.pushed.generation === desired.generation) {
    return
  }
  // #354 T05 realpath 装载门控（逃逸计划不装载）
  void postSettingsLoadIfVerified(ports, record, desired)
}

/**
 * #354 T05 设置面板的 realpath 门控推送（验证在途去重；escape 拒绝并登记
 * 目录排除）；#555 三轮：await 返回后核对纪元与 desired——验证在途期间
 * desired 已变化（切换/关闭/故障/换代）的迟到结果丢弃，不推旧计划的
 * load（旧计划覆盖 pushed 会造成装载器侧新旧组件并存、共享挂载容器双根）。
 */
async function postSettingsLoadIfVerified(ports: SettingsPanelReconcilePorts, record: SettingsPanelReconcileRecord, plan: AddonSettingsLoadPlan): Promise<void> {
  if (record.pushed?.addonId === plan.addonId && record.pushed.generation === plan.generation) return
  if (record.pendingVerify?.addonId === plan.addonId && record.pendingVerify.generation === plan.generation) return
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
  record.pendingVerify = { addonId: plan.addonId, generation: plan.generation, serial }
  const epoch = record.verifyEpoch
  const verdict = await ports.verifyLoadPlan(plan)
  if (record.pendingVerify?.serial === serial) {
    record.pendingVerify = null
  }
  if (verdict === 'escape') {
    ports.blockEscapePlanRoots(plan)
    ports.recordEvent({ kind: 'directive.load-rejected-realpath', addonId: plan.addonId, generation: plan.generation })
    return
  }
  const current = ports.desiredLoad()
  if (
    record.verifyEpoch !== epoch ||
    current === null ||
    current.addonId !== plan.addonId ||
    current.generation !== plan.generation
  ) {
    // 迟到且失效：desired 已离开本计划（或经变化后折返——折返同身份也作废，
    // realpath 复核只读无副作用，重开的计划走全新验证）
    ports.recordEvent({ kind: 'directive.load-dropped-stale', addonId: plan.addonId, generation: plan.generation })
    return
  }
  if (record.pushed?.addonId === plan.addonId && record.pushed.generation === plan.generation) return
  const directive = ports.buildLoadDirective(plan)
  ports.recordEvent(directiveEventOf(directive))
  ports.postDirective(directive)
  record.pushed = { addonId: plan.addonId, generation: plan.generation }
}
