// 索引维护调度纯逻辑（工单 #198）：调度初值常量、编辑防抖 + 强制合并的
// 冲刷时刻规划、有界去重增量队列、mtime+size 清单比对。
//
// 定位（#194「生命周期与设置」）：这些数值是**待测调度初值**，不是完成
// 时限承诺——集中在此一处，调整不动散落代码；文档不得把初值写成保证。
// 服务（vaultIndexService）只消费这里的决策函数与常量，不自行复制规则。
//
// 语义要点：
// - planFlushAt：编辑停止约 debounceMs 后更新内存关系；自首个未冲刷事件
//   起 maxWaitMs 内必冲刷一次（连续输入强制合并）——取两者较早时刻；
// - BoundedKeyQueue：保存/外部事件进入的有界队列。容量上限 + 溢出策略
//   「报 overflow 不入队」——调用方收到 overflow 后放弃逐文件增量，降级
//   为一次清单核验（批量 Git 切换不产生无界任务）；
// - diffManifest：mtime+size 双字段比对，**仅筛选变化候选，不是内容一致
//   性证明**（mtime 粒度/回拨与同尺寸改写都可能漏检——完整重建是兜底）。
//
// 本模块零 vscode / node 专属依赖（vitest 直测）。

/** 调度初值（全部可在构造参数覆盖；#194 待测初值，非时限承诺） */
export const SCHEDULE_DEFAULTS = {
  /** 编辑停止后更新内存关系的防抖窗 */
  unsavedDebounceMs: 500,
  /** 连续输入的强制合并上限（自首个未冲刷事件起算） */
  unsavedMaxWaitMs: 2000,
  /** watcher 事件（外部/批量变更）的单文件去抖窗 */
  rescanDebounceMs: 800,
  /** 快照合并提交（磁盘写）去抖窗 */
  commitDebounceMs: 1500,
  /** 活跃期周期核验间隔（低优先级清单补漏） */
  verifyIntervalMs: 10 * 60 * 1000,
  /** 长时间离开（窗口失焦）后恢复焦点时的核验最小间隔 */
  verifyFocusRegainMinGapMs: 30 * 1000,
  /** 增量重扫队列容量上限（溢出降级为一次清单核验） */
  rescanQueueCapacity: 2000,
  /** 增量队列每批处理文件数（批间让出事件循环） */
  rescanBatchFiles: 8,
  /** 核验 stat 清单每批文件数（批间让出事件循环） */
  verifyBatchFiles: 64,
} as const

/** 兼容再导出：队列容量（服务选项缺省值引用） */
export const RESCAN_QUEUE_CAPACITY = SCHEDULE_DEFAULTS.rescanQueueCapacity

/**
 * 冲刷时刻决策：编辑事件流的下一次 flush 时点。
 * 取「末次事件 + 防抖窗」与「首个未冲刷事件 + 强制合并上限」的较早者：
 * 持续输入时前者不断后移，后者封顶——连续输入不超过 maxWaitMs 必合并一次。
 * 返回值可能早于当前时刻（决策迟到时），调用方应立即冲刷。
 */
export function planFlushAt(
  firstPendingAt: number,
  lastEventAt: number,
  debounceMs: number,
  maxWaitMs: number,
): number {
  return Math.min(lastEventAt + debounceMs, firstPendingAt + maxWaitMs)
}

/** 入队结果：added=新入队；present=已在队内（幂等）；overflow=队满未入队 */
export type EnqueueResult = 'added' | 'present' | 'overflow'

/**
 * 有界去重键队列（增量重扫任务队列的纯数据面）：插入序 FIFO、重复键保位、
 * 容量上限。溢出不抛错——返回 'overflow' 由调用方执行降级策略（放弃逐文件
 * 增量，改为一次清单核验）。定时/让出等执行面由调用方负责（不为测试新造
 * 定时器 seam）。
 */
export class BoundedKeyQueue {
  private readonly items: string[] = []
  private readonly member = new Set<string>()

  constructor(readonly capacity: number) {}

  get size(): number {
    return this.items.length
  }

  has(key: string): boolean {
    return this.member.has(key)
  }

  enqueue(key: string): EnqueueResult {
    if (this.member.has(key)) {
      return 'present'
    }
    if (this.items.length >= this.capacity) {
      return 'overflow'
    }
    this.items.push(key)
    this.member.add(key)
    return 'added'
  }

  /** 取出前 max 个（从队列移除）；不足取出全部 */
  drain(max: number): string[] {
    const out = this.items.splice(0, Math.max(0, max))
    for (const key of out) {
      this.member.delete(key)
    }
    return out
  }

  clear(): void {
    this.items.length = 0
    this.member.clear()
  }
}

/** 清单比对差异：三类候选（相对路径键；仅筛选，不作一致性证明） */
export interface ManifestDiff {
  changed: string[]
  added: string[]
  removed: string[]
}

/**
 * mtime+size 清单比对：已知条目（模型文件表）× 磁盘现势（清单 stat）→
 * 变更/新增/移除候选。mtime 与 size 任一不同即算变更；已知未在清单出现
 * 算移除候选。注意：清单项 stat 失败（不可访问）**不应**进入 current——
 * 调用方必须先区分「不存在」与「不可访问」（后者不得当移除，SSH 断连
 * 不得等同删除）。
 */
export function diffManifest(
  known: ReadonlyMap<string, { mtimeMs: number; size: number }>,
  current: ReadonlyArray<{ path: string; mtimeMs: number; size: number }>,
): ManifestDiff {
  const changed: string[] = []
  const added: string[] = []
  const seen = new Set<string>()
  for (const item of current) {
    seen.add(item.path)
    const prev = known.get(item.path)
    if (prev === undefined) {
      added.push(item.path)
    } else if (prev.mtimeMs !== item.mtimeMs || prev.size !== item.size) {
      changed.push(item.path)
    }
  }
  const removed: string[] = []
  for (const key of known.keys()) {
    if (!seen.has(key)) {
      removed.push(key)
    }
  }
  return { changed, added, removed }
}
