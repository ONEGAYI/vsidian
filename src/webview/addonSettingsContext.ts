// #553 设置页上下文 runtime——设置页 webview 的页面级缓存与订阅分发。
//
// 职责（与 AddonBehaviorEnabledStateRuntime 同构的观察面口径）：
// - 缓存「组件设置」详情的平台侧上下文：作用域标签状态（user/workspace
//   + 工作区在场）与搜索定位目标（def/group 键）；
// - 数据源是 AddonSettingsAreaSection（作用域切换点击、settingsState
//   推送的 hasWorkspace、#472 定位链路的 locatedTarget/pendingFocus）——
//   上抛写入本 runtime，页面级单份；
// - 订阅分发：经装载器 env 注入 SDK settingsContext 面（按组件订阅；
//   广播到达时逐订阅者分发，回调异常只吞不升级——观察面口径，与
//   behaviorState 一致）；
// - 释放回收：装载器 releaseLoad 调 releaseAddon 整组件回收订阅（不依赖
//   组件自觉退订）；查询不受影响（已释放代次的迟到读取返回页面级当前值）。
//
// 边界（docs/specs/addon-settings-detail.md）：
// - 定位目标按「最新一份」持有，直到被替换或清除（详情关闭/切换组件）——
//   页面重装载时订阅即回放当前目标（补投语义），不设一次性消费时限；
// - 本模块不写回宿主状态——只读观察面的页面级缓存。
import type {
  AddonSettingsLocateTarget,
  AddonSettingsScopeSnapshot,
} from '../shared/addonSettingsContextApi'

type ScopeListener = (state: AddonSettingsScopeSnapshot) => void
type LocateListener = (target: AddonSettingsLocateTarget | null) => void

/** 页面级 runtime（设置页 settingsMain 构造一份，经装载器 env 注入） */
export class AddonSettingsContextRuntime {
  private scope: AddonSettingsScopeSnapshot = { scope: 'user', hasWorkspace: true }
  private locate: AddonSettingsLocateTarget | null = null
  private readonly scopeListeners = new Map<string, Set<ScopeListener>>()
  private readonly locateListeners = new Map<string, Set<LocateListener>>()

  /** 作用域/工作区状态上抛（等值不分发——推送重渲染不扰动订阅者） */
  applyScope(next: { scope: 'user' | 'workspace'; hasWorkspace: boolean }): void {
    if (next.scope === this.scope.scope && next.hasWorkspace === this.scope.hasWorkspace) {
      return
    }
    this.scope = next
    for (const callbacks of [...this.scopeListeners.values()]) {
      for (const callback of [...callbacks]) {
        try {
          callback(next)
        } catch {
          // 观察者异常不阻断其余订阅者、不升级为故障
        }
      }
    }
  }

  /** 定位目标交付（null = 清除——组件据此退场页内定位态） */
  deliverLocateTarget(target: AddonSettingsLocateTarget | null): void {
    this.locate = target
    for (const callbacks of [...this.locateListeners.values()]) {
      for (const callback of [...callbacks]) {
        try {
          callback(target)
        } catch {
          // 观察者异常不阻断其余订阅者、不升级为故障
        }
      }
    }
  }

  /** 当前作用域快照（页面级当前值——查询不受代次影响） */
  scopeSnapshot(): AddonSettingsScopeSnapshot {
    return this.scope
  }

  /** 当前未消费的定位目标（null = 无挂起目标） */
  currentLocateTarget(): AddonSettingsLocateTarget | null {
    return this.locate
  }

  /** 订阅本组件作用域变化；返回退订（重复退订无害） */
  subscribeScope(addonId: string, callback: ScopeListener): () => void {
    let callbacks = this.scopeListeners.get(addonId)
    if (callbacks === undefined) {
      callbacks = new Set()
      this.scopeListeners.set(addonId, callbacks)
    }
    const target = callbacks
    target.add(callback)
    return () => {
      target.delete(callback)
    }
  }

  /** 订阅本组件定位目标交付；返回退订（重复退订无害） */
  subscribeLocate(addonId: string, callback: LocateListener): () => void {
    let callbacks = this.locateListeners.get(addonId)
    if (callbacks === undefined) {
      callbacks = new Set()
      this.locateListeners.set(addonId, callbacks)
    }
    const target = callbacks
    target.add(callback)
    return () => {
      target.delete(callback)
    }
  }

  /** 整组件订阅回收（装载器 releaseLoad 驱动——卸载/故障/换代）：该组件
   *  的全部订阅就地移除，不依赖组件自觉退订。查询不受影响。 */
  releaseAddon(addonId: string): void {
    this.scopeListeners.delete(addonId)
    this.locateListeners.delete(addonId)
  }
}
