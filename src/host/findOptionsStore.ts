// 查找选项持久化存取（#236）：workspaceState 键 vsidian.findOptions。
//
// 语义（与 vaultIndexMaintenance 的 workspaceState 先例同款）：
// - 持久化权威在宿主 activate 装配（extension.ts 注入 context.workspaceState）；
//   webview 每次装载经 findOptions.get 拉取，切换开关经 findOptions.set 写回
// - load() 返回 null 表示「无有效存储」（调用方回默认值）；sanitize 后的
//   完整对象是合法存储（部分字段缺省时已回默认，仍算有效存储）
// - 存储端口抽象（vscode Memento 结构满足），不直接依赖 vscode，单测用
//   内存实现直驱
import {
  FIND_OPTIONS_DEFAULT,
  FIND_OPTIONS_STORAGE_KEY,
  sanitizeFindOptions,
  type FindOptions,
} from '../shared/findOptions'

export interface FindOptionsStorage {
  get<T>(key: string): T | undefined
  update(key: string, value: unknown): Thenable<void> | Promise<void>
}

/** findOptions 持久化存取（宿主侧唯一生产写入方） */
export function createFindOptionsStore(storage: FindOptionsStorage) {
  return {
    /** 读取持久化选项：null 表示无有效存储（回默认）；返回值必为完整三开关 */
    load(): FindOptions | null {
      const raw = storage.get<unknown>(FIND_OPTIONS_STORAGE_KEY)
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return null
      }
      return sanitizeFindOptions(raw)
    },
    save(options: FindOptions): Promise<void> {
      return Promise.resolve(storage.update(FIND_OPTIONS_STORAGE_KEY, { ...options }))
    },
    /** 初始选项（activate 装配用）：持久化值或默认值 */
    initial(): FindOptions {
      return this.load() ?? { ...FIND_OPTIONS_DEFAULT }
    },
  }
}

export type FindOptionsStore = ReturnType<typeof createFindOptionsStore>
