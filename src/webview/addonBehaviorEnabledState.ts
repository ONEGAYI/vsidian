// #476 行为禁用态只读可见面——webview 页面级 runtime（缓存与订阅分发）。
//
// 职责：
// - 缓存宿主广播的禁用态快照（disabled 完整键集 + 各组件运行态表）；
// - 按「本组件」口径出快照（AddonBehaviorEnabledState：运行态 + 局部 id
//   集——过滤经 shared 的 behaviorDisabledLocalIds 单一事实源）；
// - 订阅分发：广播到达时对每个有订阅者的组件对比新旧快照，**本组件快照
//   变化才投递**（等值广播不打扰——无关组件的开关变化不触发他人回调）；
//   回调异常只吞不升级（观察面口径，与 behaviors.onChanged 一致）。
//
// 边界（规格 docs/specs/addon-behavior-disabled-state.md）：
// - 只读面：本模块无任何写回宿主的成员；
// - 广播未到达时默认态 = enabled + 空集（宿主在装载指令同拍或之前推广播，
//   工厂执行时通常已持权威值；缺省回落只在消息乱序窗口出现）；
// - faulted / idle 组件不进广播表（不可达态）——缺省回落 enabled。
import {
  behaviorDisabledLocalIds,
  type AddonBehaviorEnabledState,
  type AddonBehaviorEnabledStateBroadcast,
  type AddonBehaviorRunState,
} from '../shared/addonBehaviors'

/** 页面级 runtime（编辑器 main 与设置页 settingsMain 各构造一份，经装载
 *  器 env 注入 SDK behaviorState 面） */
export class AddonBehaviorEnabledStateRuntime {
  private disabledKeys: readonly string[] = []
  private runStates = new Map<string, AddonBehaviorRunState>()
  private readonly listeners = new Map<string, Set<(state: AddonBehaviorEnabledState) => void>>()

  /** 宿主广播到达（消息桥 addon.behaviorEnabledState 转发；守卫已在桥侧过） */
  applyBroadcast(broadcast: AddonBehaviorEnabledStateBroadcast): void {
    const previousDisabled = this.disabledKeys
    const previousRunStates = this.runStates
    this.disabledKeys = broadcast.disabled
    this.runStates = new Map(broadcast.addons.map((entry) => [entry.addonId, entry.addonRunState]))
    // 只检查有订阅者的组件（快照对比兜底：前缀重叠等极端等值场景不分发）
    for (const [addonId, callbacks] of [...this.listeners]) {
      if (callbacks.size === 0) {
        continue
      }
      const previous: AddonBehaviorEnabledState = {
        addonRunState: previousRunStates.get(addonId) ?? 'enabled',
        disabled: behaviorDisabledLocalIds(previousDisabled, addonId),
      }
      const next = this.enabledStateOf(addonId)
      const changed = previous.addonRunState !== next.addonRunState ||
        previous.disabled.length !== next.disabled.length ||
        previous.disabled.some((id, i) => id !== next.disabled[i])
      if (!changed) {
        continue
      }
      for (const callback of [...callbacks]) {
        try {
          callback(next)
        } catch {
          // 观察者异常不阻断其余订阅者、不升级为故障
        }
      }
    }
  }

  /** 本组件当前快照（广播未到达时默认 enabled + 空集） */
  enabledStateOf(addonId: string): AddonBehaviorEnabledState {
    return {
      addonRunState: this.runStates.get(addonId) ?? 'enabled',
      disabled: behaviorDisabledLocalIds(this.disabledKeys, addonId),
    }
  }

  /** 订阅本组件快照变化；返回退订（重复退订无害） */
  onEnabledChangeOf(addonId: string, callback: (state: AddonBehaviorEnabledState) => void): () => void {
    let callbacks = this.listeners.get(addonId)
    if (callbacks === undefined) {
      callbacks = new Set()
      this.listeners.set(addonId, callbacks)
    }
    const target = callbacks
    target.add(callback)
    return () => {
      target.delete(callback)
    }
  }

  /** 整组件订阅回收（装载器 releaseLoad 驱动——卸载/故障/换代）：该组件
   *  的全部订阅就地移除，不依赖组件自觉退订（与 behaviors/commands/
   *  renderers/ui 四面的整组件回收同款口径）。查询不受影响——已释放
   *  代次的迟到 enabledState 仍返回最后已知快照（只读无副作用）。 */
  releaseAddon(addonId: string): void {
    this.listeners.delete(addonId)
  }
}
