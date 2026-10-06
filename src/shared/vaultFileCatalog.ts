// 全文件清单快照存储纯逻辑（工单 #377 T02，ADR-0013）。
//
// 与引用索引的分片快照（vaultIndexSnapshot）同一存储分区根（baseDir 直下
// catalog.json），但**单文件原子持久化**：条目只有名称/分类/mtime/size，无
// 多片一致性诉求，临时写 + rename（端口 writeFile 原子性）即满足崩溃安全
// ——复用既有原子写入机制，不建第二套代际目录。损坏（半截/结构不符/版本
// 不符）整体判 null，调用方走全量重建（清单是可重建缓存）。
//
// 行式紧凑 JSON：`{v, complete, entries:[[relPath, catCode, mtimeMs, size]]}`。
// mtimeMs/size 为「已取得/未知」状态的元数据：未知显式存 0（排序沉底），
// **不伪装为当前时间**；complete 标志记录枚举是否无失败目录（部分枚举的
// 清单恢复后不得参与移除 diff——不可访问不冒充删除）。
//
// 本模块零 vscode / node 专属依赖（node 单测直驱）。
import { VAULT_FILE_CATEGORY_CODE, type VaultFileCategory } from './vaultFileCategory'

/** 清单快照格式版本：结构不兼容演进时递增，旧缓存拒读走重建 */
export const CATALOG_FORMAT_VERSION = 1

/** 清单条目（索引域形态：根内相对路径 `/` 分隔） */
export interface VaultCatalogEntry {
  relPath: string
  /** 类型提示（零 IO 后缀派生；other = 仅记名） */
  category: VaultFileCategory
  /** 磁盘修改时间（毫秒）；未知 0（已取得/未知显式建模——沉底排序） */
  mtimeMs: number
  /** 字节数；未知 0 */
  size: number
}

interface CatalogFile {
  v: number
  complete: boolean
  entries: unknown[]
}

const CODE_BY_CATEGORY: ReadonlyMap<VaultFileCategory, number> = new Map(
  VAULT_FILE_CATEGORY_CODE.map((c, i) => [c, i] as const),
)
const CATEGORY_BY_CODE: ReadonlyMap<number, VaultFileCategory> = new Map(
  VAULT_FILE_CATEGORY_CODE.map((c, i) => [i, c] as const),
)

/** 序列化（同步整串；服务侧分批组装时按条目切片让出） */
export function serializeVaultCatalog(
  entries: Iterable<VaultCatalogEntry>,
  complete: boolean,
): string {
  const rows: unknown[][] = []
  for (const e of entries) {
    rows.push([e.relPath, CODE_BY_CATEGORY.get(e.category) ?? CODE_BY_CATEGORY.get('other')!, e.mtimeMs, e.size])
  }
  const file: CatalogFile = { v: CATALOG_FORMAT_VERSION, complete, entries: rows }
  return JSON.stringify(file)
}

/** 解析：结构/版本/行形态任一不符返回 null（整体损坏走重建）；重复
 *  relPath 取末次出现（幂等收敛不判损坏） */
export function parseVaultCatalog(content: string): { entries: VaultCatalogEntry[]; complete: boolean } | null {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    return null
  }
  if (raw === null || typeof raw !== 'object') {
    return null
  }
  const file = raw as Partial<CatalogFile>
  if (file.v !== CATALOG_FORMAT_VERSION || typeof file.complete !== 'boolean' || !Array.isArray(file.entries)) {
    return null
  }
  const byRel = new Map<string, VaultCatalogEntry>()
  for (const row of file.entries) {
    if (!Array.isArray(row) || row.length !== 4) {
      return null
    }
    const [relPath, catCode, mtimeMs, size] = row
    if (typeof relPath !== 'string' || relPath === '' ||
      typeof catCode !== 'number' || !Number.isInteger(catCode) ||
      typeof mtimeMs !== 'number' || !Number.isInteger(mtimeMs) || mtimeMs < 0 ||
      typeof size !== 'number' || !Number.isInteger(size) || size < 0) {
      return null
    }
    const category = CATEGORY_BY_CODE.get(catCode)
    if (category === undefined) {
      return null
    }
    byRel.set(relPath, { relPath, category, mtimeMs, size })
  }
  return { entries: [...byRel.values()], complete: file.complete }
}

/** 清单核验 diff（纯逻辑）：known 为现有清单的元数据视图，current 为本轮
 *  列举+stat 结果。mtime 或 size 任一变化即 changed；仅记名条目（0/0）与
 *  stat 缺失的列举项（0/0）天然不误报。 */
export function diffVaultCatalog(
  known: ReadonlyMap<string, { mtimeMs: number; size: number }>,
  current: ReadonlyArray<{ path: string; mtimeMs: number; size: number }>,
): { added: string[]; changed: string[]; removed: string[] } {
  const currentByPath = new Map(current.map((c) => [c.path, c] as const))
  const added: string[] = []
  const changed: string[] = []
  for (const c of current) {
    const prev = known.get(c.path)
    if (prev === undefined) {
      added.push(c.path)
    } else if (prev.mtimeMs !== c.mtimeMs || prev.size !== c.size) {
      changed.push(c.path)
    }
  }
  const removed: string[] = []
  for (const path of known.keys()) {
    if (!currentByPath.has(path)) {
      removed.push(path)
    }
  }
  return { added, changed, removed }
}
