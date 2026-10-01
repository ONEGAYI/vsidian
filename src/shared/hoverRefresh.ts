// 引用视图同步的共享纯逻辑（工单 #224）：工程参数集中定义、目标内容
// 版本仲裁矩阵与订阅注册表。规格 docs/specs/hover-preview-embed.md
// 「Reading 内容、属性与刷新」与「文档访问与消息约束」节：
// - 跟随目标文档未保存修改（以宿主已收到的内容为准，短暂合并刷新）；
// - 请求代次与目标内容版本分别校验，旧响应不覆盖新目标或更新版本；
// - 订阅有容量边界（相同目标合并订阅、各实例独立释放）。
//
// 本模块不依赖 vscode/DOM（两端共用；协调器编排在 host/
// hoverRefreshCoordinator，宿主读取缓存在 host/documentSession）。
/** #224 工程参数（规格：刷新合并间隔、缓存容量等在实现时依据现有约定
 * 与测量确定，集中定义并测试；hoverSourceFsPaths 有界淘汰与
 * vaultIndexSchedule 防抖先例是量级参照） */
export const HOVER_REFRESH_DEFAULTS = {
  /** 未保存编辑防抖 ms（短暂合并刷新——高频输入只触发一轮重载；与
   *  悬停开闭延迟 300/350ms 同工程带） */
  debounceMs: 350,
  /** 连续输入强制合并上限（自首个未冲刷事件起算；沿 vaultIndexSchedule
   *  unsavedMaxWaitMs 的 2s 先例——长输入会话不无限推迟刷新） */
  maxWaitMs: 2000,
  /** 宿主读取缓存条目上限（按请求形态区分；插入序淘汰——imageCache 16
   *  与来源集合上限 64 之间取 24：嵌入卡片 + 浮层并存的活跃目标数量级） */
  cacheEntryLimit: 24,
  /** 宿主读取缓存字节上限（LF 全文累计；超出按插入序淘汰——「容量/
   *  内存有界」的字节维度） */
  cacheByteLimit: 2 * 1024 * 1024,
  /** 订阅注册表目标数上限（provider 内跨面板；满额拒绝新目标） */
  watchTargetLimit: 128,
  /** webview 嵌入实例状态库上限（语义键条目；LRU 淘汰）。修 4（review
   *  第二轮）：宿主侧 hoverSourceFsPaths 来源集合上限（documentSession
   *  的 HOVER_SOURCES_LIMIT）与本值对齐同为 64——同一会话内两套目标
   *  登记同容量基准，不对称会在并存的卡片/浮层目标数上先后触顶淘汰 */
  embedEntryLimit: 64,
} as const

/**
 * 目标内容版本仲裁（#224 双重仲裁的版本维）：applied 为当前实例已应用
 * 的目标 TextDocument.version（null = 从未应用），incoming 为来包版本。
 *
 * - null → 任意版本可应用（首载）；
 * - incoming >= applied → 应用（更新或相同——重复投递幂等，不判旧）；
 * - incoming < applied → 拒绝（慢响应的旧内容不得冒充新目标）。
 *
 * 请求代次维（instanceId + reqId 配对）由各容器模块既有守卫承担；本
 * 函数是第二道防线（版本单调性跨请求成立，reqId 只在单实例内单调）。
 */
export function shouldApplyHoverVersion(applied: number | null, incoming: number): boolean {
  return applied === null || incoming >= applied
}

/**
 * 订阅注册表（#224「相同目标合并读取、各实例订阅独立释放」的数据面）：
 * fsPath → 会话 → 实例集合的三级表。目标级合并（has/targets 以目标为
 * 单位），实例级释放（unwatch 单实例，目标内最后一个实例退场才撤目标）。
 *
 * 「实例」= 视图实例标识（浮层 instanceId / 嵌入 entry 语义键）——与容器
 * 类型无绑定（ADR-0009「实例身份不绑定容器类型」）；「会话」= 面板身份
 * （面板销毁经 releaseSession 一次性释放其全部订阅）。
 *
 * 有界：目标槽满额时拒绝新目标，绝不撤销仍在场的订阅。相同目标的
 * 跨面板 occurrence 仍共享一个槽；调用方须将拒绝反馈给可见实例。
 */
export class HoverWatchRegistry {
  /** 归一键 → Map<sessionKey, Set<instanceId>>（Map 插入序 = 触达序） */
  private readonly table = new Map<string, Map<string, Set<string>>>()
  /** 归一键 → 最近登记的原始形态（推送载荷用——与 webview 侧 loaded.fsPath
   *  同源；Windows 宿主下事件源（编辑器/索引）与读取归正的形态可能仅
   *  大小写不同，内部键归一、载荷保持登记形态） */
  private readonly canonical = new Map<string, string>()

  constructor(
    private readonly targetLimit: number = HOVER_REFRESH_DEFAULTS.watchTargetLimit,
    /** 键归一（Windows 宿主折叠大小写；缺省恒等——POSIX 语义） */
    private readonly keyOf: (fsPath: string) => string = (fsPath) => fsPath,
  ) {}

  canWatch(fsPath: string): boolean {
    return this.table.has(this.keyOf(fsPath)) || this.table.size < this.targetLimit
  }

  /** 登记订阅（幂等：同实例重复登记不虚增计数） */
  watch(sessionKey: string, fsPath: string, instanceId: string): boolean {
    const key = this.keyOf(fsPath)
    let sessions = this.table.get(key)
    if (!sessions) {
      if (!this.canWatch(fsPath)) return false
      sessions = new Map()
      this.table.set(key, sessions)
    } else {
      // 触达：移到 MRU（Map 插入序语义）
      this.table.delete(key)
      this.table.set(key, sessions)
    }
    this.canonical.set(key, fsPath)
    let instances = sessions.get(sessionKey)
    if (!instances) {
      instances = new Set()
      sessions.set(sessionKey, instances)
    }
    instances.add(instanceId)
    return true
  }

  /** 释放单实例订阅；目标内最后一个实例退场时撤目标 */
  unwatch(sessionKey: string, fsPath: string, instanceId: string): void {
    const key = this.keyOf(fsPath)
    const sessions = this.table.get(key)
    if (!sessions) {
      return
    }
    const instances = sessions.get(sessionKey)
    if (!instances) {
      return
    }
    instances.delete(instanceId)
    if (instances.size === 0) {
      sessions.delete(sessionKey)
    }
    if (sessions.size === 0) {
      this.table.delete(key)
      this.canonical.delete(key)
    } else {
      this.touch(key)
    }
  }

  /** 会话整体释放（面板销毁：订阅计数回落）；返回因本次释放而退场的
   *  目标清单（原始形态——调用方据此清理挂起任务，如防抖定时器） */
  releaseSession(sessionKey: string): string[] {
    const retired: string[] = []
    for (const [key, sessions] of [...this.table.entries()]) {
      if (!sessions.delete(sessionKey)) {
        continue
      }
      if (sessions.size === 0) {
        this.table.delete(key)
        const form = this.canonical.get(key)
        this.canonical.delete(key)
        if (form !== undefined) {
          retired.push(form)
        }
      } else {
        this.touch(key)
      }
    }
    return retired
  }

  /** 目标是否有任何订阅（键归一匹配） */
  has(fsPath: string): boolean {
    return (this.table.get(this.keyOf(fsPath))?.size ?? 0) > 0
  }

  /** 订阅该目标的会话键列表（失效推送路由；键归一匹配） */
  subscribersOf(fsPath: string): string[] {
    const sessions = this.table.get(this.keyOf(fsPath))
    return sessions ? [...sessions.keys()] : []
  }

  /** 最近登记的原始形态（推送载荷——与 webview 侧 loaded.fsPath 同源）；
   *  未登记目标原样返回 */
  canonicalOf(fsPath: string): string {
    return this.canonical.get(this.keyOf(fsPath)) ?? fsPath
  }

  /** 目标数（观测探针） */
  targets(): number {
    return this.table.size
  }

  /** 实例订阅总数（观测探针；含跨目标去重前的原始计数） */
  totalSubscriptions(): number {
    let total = 0
    for (const sessions of this.table.values()) {
      for (const instances of sessions.values()) {
        total += instances.size
      }
    }
    return total
  }

  /** 全量清空（协调器 dispose：订阅与目标一并退场） */
  clear(): void {
    this.table.clear()
    this.canonical.clear()
  }

  /** 触达目标（LRU 移到队尾） */
  private touch(key: string): void {
    const sessions = this.table.get(key)
    if (sessions) {
      this.table.delete(key)
      this.table.set(key, sessions)
    }
  }

}
