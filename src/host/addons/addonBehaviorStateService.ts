// T07（#356）附加组件输入行为——行为顺序与逐项开关的宿主侧持久化服务
//（纯逻辑，持久层经端口注入）。
//
// 职责（票面「基础管理查询支持逐项开关与排序读写」的存储面；完整管理
// UI 属 T08）：
// - 持久化用户覆盖：排序（order，完整键序列）与关闭集合（disabled）。
//   存储格式见 shared/addonBehaviors.ts 的 AddonBehaviorStateStore 注释
//  （version 1、单层 user、未知项保留）。
// - 构造从持久层装配；坏形态 fail-safe 回空不写回。
// - 写入：读改写经内部 promise 链串行化（并发不丢键）；先写持久层、
//   成功后才更新内存权威并发出变化事件——失败不虚报、内存回滚。
// - 未知项（未注册/已卸载的行为键）保留存储不剔除——展示状态归 T08，
//   存储不因注册清单缺席而丢配置（技术方案 §7）。
//
// 跨窗口边界（与 T04 设置服务同款约束）：Memento 无变更事件，跨窗口不
// 做实时推送；refreshFromPersistence 提供显式对账入口，并发写按最后
// 落盘胜出。下发到 webview（addon.behaviors.state）由 wiring 在编辑器
// 面板就绪与状态变化时推送。
import { parseAddonBehaviorStateStore, type AddonBehaviorStateStore } from '../../shared/addonBehaviors'

/** 持久层端口（vscode 层实现：globalState 单层——存储决策见 shared 注释） */
export interface AddonBehaviorStatePersistencePort {
  read(): unknown
  write(value: AddonBehaviorStateStore): Promise<boolean>
}

export interface AddonBehaviorStateSnapshot {
  readonly order: readonly string[]
  readonly disabled: readonly string[]
}

export type AddonBehaviorStateUpdateResult =
  | { ok: true }
  | { ok: false; reason: 'store-write-failed' }

export class AddonBehaviorStateService {
  private store: { order: string[]; disabled: string[] }
  private readonly listeners = new Set<() => void>()
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly ports: AddonBehaviorStatePersistencePort) {
    const parsed = parseAddonBehaviorStateStore(ports.read())
    this.store = parsed === null
      ? { order: [], disabled: [] }
      : { order: [...parsed.order], disabled: [...parsed.disabled] }
  }

  /** 当前快照（内存权威；序列化后即 addon.behaviors.state 载荷） */
  snapshot(): AddonBehaviorStateSnapshot {
    return { order: [...this.store.order], disabled: [...this.store.disabled] }
  }

  /** 逐项开关写入（批量；只动提及项，未提及项保留；幂等去重） */
  setDisabled(keys: readonly string[], disabled: boolean): Promise<AddonBehaviorStateUpdateResult> {
    return this.enqueue(() => this.persist((store) => {
      const keySet = new Set(keys)
      if (disabled) {
        const existing = new Set(store.disabled)
        for (const key of keySet) {
          existing.add(key)
        }
        store.disabled = [...existing]
      } else {
        store.disabled = store.disabled.filter((key) => !keySet.has(key))
      }
    }))
  }

  /** 排序整表写（管理 UI 的排序结果落库；重复键去重；关闭集不动） */
  setOrder(order: readonly string[]): Promise<AddonBehaviorStateUpdateResult> {
    return this.enqueue(() => this.persist((store) => {
      store.order = [...new Set(order)]
    }))
  }

  /** 变化订阅（只在持久化成功后投递）；返回退订 */
  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 从持久层重新装配内存权威（新窗口对账入口） */
  refreshFromPersistence(): void {
    const parsed = parseAddonBehaviorStateStore(this.ports.read())
    this.store = parsed === null
      ? { order: [], disabled: [] }
      : { order: [...parsed.order], disabled: [...parsed.disabled] }
  }

  // ---- 内部 ----

  /** 写入公共路径：内存改 → 落盘 → 成功才保留并广播；失败回滚 */
  private async persist(mutate: (store: { order: string[]; disabled: string[] }) => void): Promise<AddonBehaviorStateUpdateResult> {
    const previous = { order: [...this.store.order], disabled: [...this.store.disabled] }
    mutate(this.store)
    const written = await this.ports.write({ version: 1, order: this.store.order, disabled: this.store.disabled })
    if (!written) {
      this.store = previous
      return { ok: false, reason: 'store-write-failed' }
    }
    for (const listener of [...this.listeners]) {
      listener()
    }
    return { ok: true }
  }

  /** 操作串行化（读改写不交错；异常不断链） */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation)
    this.queue = next.catch(() => {})
    return next
  }
}
