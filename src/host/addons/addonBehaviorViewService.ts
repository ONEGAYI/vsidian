// #474 输入行为管理——视图状态（当前页码 + 积木查询树）的宿主侧持久化
// 服务（纯逻辑，持久层经端口注入）。与 AddonBehaviorStateService 同款
// fail-safe 模式，但更简：
//
// - **webview 自持权威**：视图状态由设置页 webview 驱动写入（翻页/编辑
//   查询树），宿主只存储不推送——不设 onChanged 广播（无权威回显通道），
//   写失败静默（视图状态丢失非灾难：下次装载回退旧值或默认态，不涉
//   行为生效语义；与行为状态存储的「失败回滚 + 推送纠正」不同层）。
// - **不做跨窗口对账**：设置页 retainContextWhenHidden 不开、隐藏即销毁
//   重开重载，重开即重新拉取本存储；跨窗口并发写按最后落盘胜出（页码/
//   查询树为单用户视图偏好，无合并价值）。
// - 存储形态 `{ version: 1, page, query }`（page 正整数；query 为
//   BehaviorQueryFilter 或 null = 无查询）；查询树递归守卫与块数上限的
//   单一事实源在 shared/behaviorFilterQuery。
import { parseBehaviorQueryFilter, type BehaviorQueryFilter } from '../../shared/behaviorFilterQuery'

/** 持久层端口（vscode 层实现：globalState 用户级——跨重启、不分工作区） */
export interface AddonBehaviorViewPersistencePort {
  read(): unknown
  write(value: AddonBehaviorViewStore): Promise<boolean>
}

/** 视图状态持久形态（version 1） */
export interface AddonBehaviorViewStore {
  readonly version: 1
  readonly page: number
  readonly query: BehaviorQueryFilter | null
}

/** 视图状态快照（内存权威；序列化后即 addons.behaviorsView 载荷的 view） */
export interface AddonBehaviorViewSnapshot {
  readonly page: number
  readonly query: BehaviorQueryFilter | null
}

export function parseAddonBehaviorViewStore(v: unknown): AddonBehaviorViewStore | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    return null
  }
  const candidate = v as { version?: unknown; page?: unknown; query?: unknown }
  if (candidate.version !== 1) {
    return null
  }
  if (typeof candidate.page !== 'number' || !Number.isInteger(candidate.page) || candidate.page < 1) {
    return null
  }
  if (candidate.query === null) {
    return { version: 1, page: candidate.page, query: null }
  }
  const query = parseBehaviorQueryFilter(candidate.query)
  if (query === null) {
    return null
  }
  return { version: 1, page: candidate.page, query }
}

export class AddonBehaviorViewService {
  private store: AddonBehaviorViewSnapshot | null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly ports: AddonBehaviorViewPersistencePort) {
    const parsed = parseAddonBehaviorViewStore(ports.read())
    this.store = parsed === null ? null : { page: parsed.page, query: parsed.query }
  }

  /** 当前快照（null = 无存储默认态；调用方据此区分「无持久」与默认值） */
  snapshot(): AddonBehaviorViewSnapshot | null {
    return this.store
  }

  /** 整表写（页码 + 查询树一次落盘）；写失败静默返回 false（见模块头注） */
  setView(page: number, query: BehaviorQueryFilter | null): Promise<boolean> {
    return this.enqueue(async () => {
      const next: AddonBehaviorViewStore = {
        version: 1,
        page: Number.isInteger(page) && page >= 1 ? page : 1,
        query,
      }
      const written = await this.ports.write(next)
      if (written) {
        this.store = { page: next.page, query }
      }
      return written
    })
  }

  /** 从持久层重新装配（新窗口对账入口；并发写最后落盘胜出） */
  refreshFromPersistence(): void {
    const parsed = parseAddonBehaviorViewStore(this.ports.read())
    this.store = parsed === null ? null : { page: parsed.page, query: parsed.query }
  }

  /** 操作串行化（读改写不交错；异常不断链） */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation)
    this.queue = next.catch(() => {})
    return next
  }
}
