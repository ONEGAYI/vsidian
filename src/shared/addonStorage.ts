// 附加组件数据目录——两端共享的形状、守卫与常量单一事实源。
//
// 语义（票面）：
// - 数据目录在安装目录外、随 Vsidian 扩展生命周期（globalStorage 语义）：
//   `<vsidian globalStorage>/addons/<addonId>/`，组件只能读写自己目录；
// - 富结构数据（规则对象等）超出设置存储的一层嵌套边界，归本面自由
//   读写文件；页面侧组件代码经自己的 channel topic 桥接宿主读写
//   （平台不新做页面 IO API——宿主与页面经公开通道通信的既有架构）；
// - 权限与隔离边界：相对路径守卫（越界 = invalid-path 拒绝）与单文件
//   大小上限在入口拦截；卸载清理策略：组件停用/故障不删数据、组件
//   扩展卸载也不自动删（数据归 Vsidian globalStorage 域，随 Vsidian
//   本体卸载整体清除；组件重装后数据仍在——显式选择，不静默丢失）。

/** 单文件大小上限（字节；writeFile 拒绝超限——防滥用，正常规则文件远小于此） */
export const ADDON_STORAGE_FILE_LIMIT_BYTES = 8 * 1024 * 1024

/** 拒绝码：invalid-path = 越界/非法相对路径；too-large = 单文件超限；
 * error = IO 失败（不存在/权限等，detail 归因） */
export type AddonStorageRejection = 'invalid-path' | 'too-large' | 'error'

export type AddonStorageResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: AddonStorageRejection; detail?: string }

export interface AddonStorageEntryInfo {
  /** 相对组件数据目录的路径（正斜杠） */
  path: string
  kind: 'file' | 'directory'
}

export type AddonStorageListResult =
  | { ok: true; entries: AddonStorageEntryInfo[] }
  | { ok: false; reason: AddonStorageRejection; detail?: string }

export interface AddonStorageWatchHandle {
  dispose(): void
}

/** 相对路径守卫：正斜杠相对路径，段非空且不为 `.`/`..`，无反斜杠、
 * 无盘符/协议头、长度有界。拒绝一切可逃出组件目录的字面形态（编码
 * 变形由宿主侧 URI join 后的包含性判定兜底——本守卫是防呆层，与
 * resourceUri 的分层口径一致）。 */
export function isSafeAddonStoragePath(relativePath: string): boolean {
  if (relativePath.length === 0 || relativePath.length > 512) {
    return false
  }
  if (relativePath.includes('\\') || relativePath.includes(':')) {
    return false
  }
  if (relativePath.startsWith('/') || relativePath.includes('//')) {
    return false
  }
  for (const segment of relativePath.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      return false
    }
  }
  return true
}

/** 组件数据目录面（宿主侧 setup/enable 上下文同形状；组件页面侧经
 * channel 桥接宿主消费）。全部相对路径先过 isSafeAddonStoragePath，
 * 越界形态明确拒绝（普通 API 拒绝，不算组件故障）。 */
export interface AddonStorageFacet {
  /** 本组件数据目录的 URI（显示与同步工具配置用） */
  uri(): string
  /** 读 UTF-8 文本文件 */
  readFile(relativePath: string): Promise<AddonStorageResult<string>>
  /** 覆盖写 UTF-8 文本文件（父目录按需创建；content 超单文件上限拒绝） */
  writeFile(relativePath: string, content: string): Promise<AddonStorageResult<null>>
  /** 列目录（相对路径缺省根；recursive 缺省 false 只列一层） */
  list(relativePath?: string, recursive?: boolean): Promise<AddonStorageListResult>
  /** 删文件（不删目录——目录生命周期归卸载策略） */
  deleteFile(relativePath: string): Promise<AddonStorageResult<null>>
  /** 订阅目录内文件变化（外部同步工具改写后自动重载的支撑面）；
   * 返回取消函数；组件生命周期结束时平台统一注销 watcher */
  onDidChangeFile(callback: (relativePath: string) => void): AddonStorageWatchHandle
}
