// 索引维护设置接线（工单 #198）：排除模式持久化（workspaceState）与设置页
// / 命令面板共用的维护操作入口。索引服务本体在 vaultIndexService（纯逻辑
// 可测）；本模块是它的编排壳——存储经接口注入（vscode Memento 结构满足，
// vitest 用内存实现直驱），不直接依赖 vscode。
//
// 职责边界：
// - 排除模式的**持久化权威**在此（workspaceState 键 INDEX_EXCLUDE_PATTERNS_
//   KEY）；生效权威在服务（setExcludePatterns 触发覆盖范围重算）。activate
//   时 store.load() 传入服务构造，此后本模块是唯一生产写入方。
// - 存储空数组 = 用户显式清空（「不排除任何路径」）；无存储（键不存在或
//   损坏）回落 DEFAULT_EXCLUDE_PATTERNS——两者必须区分，不能都当默认。
// - 维护操作结果（notice）经 onStateChanged 推送设置页（extension.ts 接
//   settingsPage.notifyIndexChanged）；命令面板路径的宿主通知由调用方按
//   返回值自行组织。
import { VaultIndexService } from './vaultIndexService'
import type { HostToWebview } from '../shared/protocol'
import {
  DEFAULT_EXCLUDE_PATTERNS,
  sanitizeExcludePatterns,
} from '../shared/vaultIndexExclude'

/** 排除模式持久化键（workspaceState；工作区维度——各工作区独立配置） */
export const INDEX_EXCLUDE_PATTERNS_KEY = 'vsidian.index.excludePatterns'

/** 设置页维护状态消息形态（index.state；协议层稳定契约的宿主侧构造） */
export type IndexStateMessage = Extract<HostToWebview, { kind: 'index.state' }>
type IndexNotice = NonNullable<IndexStateMessage['notice']>

/** 存储端口：vscode Memento 结构满足（结构化注入，单测用内存实现） */
export interface IndexSettingsStorage {
  get<T>(key: string): T | undefined
  update(key: string, value: unknown): Thenable<void>
}

/** 排除模式持久化存取（activate 读入与设置页保存共用） */
export function createIndexSettingsStore(storage: IndexSettingsStorage) {
  return {
    /** 读取持久化模式：返回 null 表示「无有效存储」（调用方回落默认值）；
     *  空数组是合法存储（显式清空），原样返回。 */
    load(): string[] | null {
      const raw = storage.get<unknown>(INDEX_EXCLUDE_PATTERNS_KEY)
      if (!Array.isArray(raw)) {
        return null
      }
      return sanitizeExcludePatterns(raw).patterns
    },
    save(patterns: readonly string[]): Promise<void> {
      return Promise.resolve(storage.update(INDEX_EXCLUDE_PATTERNS_KEY, [...patterns]))
    },
    /** 原始持久化值（测试钩子观测回显链路用） */
    raw(): unknown {
      return storage.get<unknown>(INDEX_EXCLUDE_PATTERNS_KEY)
    },
  }
}

export type IndexSettingsStore = ReturnType<typeof createIndexSettingsStore>

/** 初始排除模式（activate 装配用）：持久化值或默认值 */
export function initialExcludePatterns(store: IndexSettingsStore): string[] {
  return store.load() ?? [...DEFAULT_EXCLUDE_PATTERNS]
}

export interface IndexMaintenance {
  /** 当前维护状态（可直接作 index.state 推送） */
  getState(): IndexStateMessage
  /** 保存排除模式（清洗后持久化 + 触发服务覆盖范围重算；非法项进
   *  notice 回显，合法项照常生效） */
  setPatterns(raw: readonly string[]): Promise<void>
  /** 恢复默认排除模式（等价保存默认清单） */
  resetPatterns(): Promise<void>
  /** 清理当前工作区缓存（安全回收旧代际） */
  cleanup(): Promise<{ removedDirs: number } | 'unavailable' | 'failed'>
  /** 完整重建（进度经 getState 轮次可见） */
  rebuild(): Promise<'done' | 'cancelled' | 'failed' | 'unavailable'>
  /** 取消在途维护操作 */
  cancel(): void
  /** 原始持久化值（测试钩子） */
  persistedRaw(): unknown
  onStateChanged(listener: () => void): () => void
}

/**
 * 组装索引维护接线。vaultIndex 为 undefined（无工作区）时：模式仍可编辑
 * 持久化（打开工作区后 activate 读入生效），清理/重建返回 'unavailable'。
 */
export function createIndexMaintenance(
  store: IndexSettingsStore,
  vaultIndex: VaultIndexService | undefined,
): IndexMaintenance {
  let patterns = initialExcludePatterns(store)
  let status: IndexStateMessage['status'] = 'idle'
  let progress: IndexStateMessage['progress'] = null
  let notice: IndexNotice | null = null
  const listeners = new Set<() => void>()
  /** 进度推送节流：大库逐文件回调不逐条 postMessage */
  let lastPushedDone = -1

  const push = (): void => {
    for (const listener of [...listeners]) {
      listener()
    }
  }

  const rootsOf = (): number =>
    vaultIndex?.maintenanceInfo().roots.length ?? 0

  return {
    getState(): IndexStateMessage {
      return {
        kind: 'index.state',
        available: vaultIndex !== undefined,
        patterns: [...patterns],
        defaults: [...DEFAULT_EXCLUDE_PATTERNS],
        status,
        progress,
        roots: rootsOf(),
        notice,
      }
    },
    async setPatterns(raw: readonly string[]): Promise<void> {
      const { patterns: valid, invalid } = sanitizeExcludePatterns(raw)
      patterns = valid
      await store.save(valid)
      if (vaultIndex) {
        await vaultIndex.setExcludePatterns(valid)
      }
      notice = invalid.length > 0
        ? { kind: 'patterns-invalid', detail: invalid.join(', ') }
        : { kind: 'patterns-saved' }
      push()
    },
    async resetPatterns(): Promise<void> {
      await this.setPatterns([...DEFAULT_EXCLUDE_PATTERNS])
    },
    async cleanup(): Promise<{ removedDirs: number } | 'unavailable' | 'failed'> {
      if (!vaultIndex) {
        notice = null
        return 'unavailable'
      }
      if (status !== 'idle') {
        return 'failed' // 重建进行中：不并行清理
      }
      status = 'cleaning'
      notice = null
      push()
      try {
        const result = await vaultIndex.cleanupCache()
        status = 'idle'
        notice = { kind: 'cleanup-done', detail: String(result.removedDirs) }
        push()
        return result
      } catch (err) {
        status = 'idle'
        notice = { kind: 'cleanup-failed', detail: errorMessageOf(err) }
        push()
        return 'failed'
      }
    },
    async rebuild(): Promise<'done' | 'cancelled' | 'failed' | 'unavailable'> {
      if (!vaultIndex) {
        notice = null
        return 'unavailable'
      }
      if (status !== 'idle') {
        return 'failed' // 已有维护操作进行中（按钮应已禁用，此处兜底）
      }
      status = 'rebuilding'
      progress = null
      notice = null
      lastPushedDone = -1
      push()
      try {
        const result = await vaultIndex.rebuildAll((p) => {
          progress = { ...p }
          // 节流：约每 2% 或收尾帧推送一次
          const step = Math.max(1, Math.floor(p.total / 50))
          if (p.done === p.total || p.done - lastPushedDone >= step) {
            lastPushedDone = p.done
            push()
          }
        })
        status = 'idle'
        progress = null
        notice = result === 'done'
          ? { kind: 'rebuild-done' }
          : result === 'cancelled'
            ? { kind: 'rebuild-cancelled' }
            : { kind: 'rebuild-failed' }
        push()
        return result === 'busy' ? 'failed' : result
      } catch (err) {
        status = 'idle'
        progress = null
        notice = { kind: 'rebuild-failed', detail: errorMessageOf(err) }
        push()
        return 'failed'
      }
    },
    cancel(): void {
      vaultIndex?.cancelMaintenance()
    },
    persistedRaw(): unknown {
      return store.raw()
    },
    onStateChanged(listener: () => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

function errorMessageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
