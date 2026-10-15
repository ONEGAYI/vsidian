// #546 T07 页面明暗环境 hub（页面级单例；编辑器 main.ts 装配）。
//
// 职责（规格 docs/specs/addon-themes.md §4）：
// - 缓存宿主推送的 VSCode 实际生效主题四态投影（addonThemeEnvironment.
//   changed 消息；面板 ready 直发对账 + 事件驱动推送）；
// - 变化分发：**先更新缓存再通知**订阅者（回调中再次读取拿到相同新状态
//   的契约落点）；等值跳过（重复值不重复广播）；
// - 订阅生命周期：装载器按（addonId, 装载代次）登记——代次释放整组退订
//   （不依赖组件自觉）；显式退订函数幂等。
//
// 数据源是宿主（vscode.window.activeColorTheme 的四态投影），不由页面
// 自行嗅探 body class——手动固定暗色而系统变亮时快照不变，跟随系统时随
// 宿主事件变化；文档图形的重画链路维持既有 body class 观察者
// （syncController.applyHostTheme），本模块只服务 SDK 快照与订阅。
import {
  addonThemeEnvironmentEqual,
  isAddonThemeEnvironmentPayload,
  type AddonThemeEnvironment,
} from '../shared/addonThemes'

type Listener = (env: AddonThemeEnvironment) => void

export interface ThemeEnvironmentHub {
  /** 当前快照（SDK get 的数据源） */
  current(): AddonThemeEnvironment
  /** 宿主消息应用（等值 false；先更新缓存再通知——返回是否接受） */
  applyEnvironment(env: unknown): boolean
  /** 装载器登记订阅（代次键判活；返回退订函数） */
  subscribe(addonId: string, generation: number, listener: Listener): () => void
  /** 装载代次终结：该组件订阅整组回收（重复调用无害） */
  releaseAddon(addonId: string): void
}

export function installThemeEnvironmentHub(initial: AddonThemeEnvironment): ThemeEnvironmentHub {
  let current: AddonThemeEnvironment = initial
  /** addonId → 代次 → 回调集 */
  const subscribers = new Map<string, Map<number, Set<Listener>>>()

  return {
    current: () => current,
    applyEnvironment(env) {
      if (!isAddonThemeEnvironmentPayload(env)) {
        return false
      }
      // 等值跳过：重复值不重复广播
      if (addonThemeEnvironmentEqual(current, env)) {
        return false
      }
      // 先更新缓存再通知（回调中 current 已是新值——契约落点）
      current = env
      for (const listeners of subscribers.values()) {
        for (const set of listeners.values()) {
          for (const listener of [...set]) {
            listener(env)
          }
        }
      }
      return true
    },
    subscribe(addonId, generation, listener) {
      let byGeneration = subscribers.get(addonId)
      if (!byGeneration) {
        byGeneration = new Map()
        subscribers.set(addonId, byGeneration)
      }
      let set = byGeneration.get(generation)
      if (!set) {
        set = new Set()
        byGeneration.set(generation, set)
      }
      set.add(listener)
      return () => {
        set!.delete(listener)
      }
    },
    releaseAddon(addonId) {
      subscribers.delete(addonId)
    },
  }
}

// ---- 页面级单例（编辑器 main.ts 装配；装载器与消息桥消费） ----

let hubSingleton: ThemeEnvironmentHub | null = null

/** 装桥同时登记页面单例（返回句柄供消息桥转发与装载器消费） */
export function setThemeEnvironmentHub(initial: AddonThemeEnvironment): ThemeEnvironmentHub {
  hubSingleton = installThemeEnvironmentHub(initial)
  return hubSingleton
}

/** 当前页面单例（未装配为 null——装载器不提供 SDK 面） */
export function themeEnvironmentHub(): ThemeEnvironmentHub | null {
  return hubSingleton
}
