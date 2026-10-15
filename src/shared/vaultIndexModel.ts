// 引用索引内存模型类型（工单 #194 批次：#195 快照存储 / #196 抽取 / #197 服务共用）。
//
// 事实源约定（#194 规格「索引模型与存储决策门槛」节）：Markdown 与打开文档
// 的当前内容为事实来源，索引仅为可重建缓存。模型保存文件清单、mtime、size、
// 内容/解析版本、出链的原始目标与可定位区间；不复制全文、不持久化 AST 或
// 图片。反链关系不持久化，由边表重建。
/** 索引登记的文件条目。kind 区分 Markdown（有出链，需解析）与附件
 *  （仅登记元数据与被引用关系，不解析其内部内容，#194 规格）。 */
export type VaultFileKind = 'markdown' | 'asset'

export interface VaultFileEntry {
  /** 根内相对路径（`/` 分隔）；#556 T2 起跨根/工作区外的被引用目标存
   *  规范绝对身份（仅登记元数据与被引用关系，不递归解析内容） */
  path: string
  kind: VaultFileKind
  /** 最后观测 mtime（毫秒）；mtime+size 仅筛选变化，不是内容一致性证明。 */
  mtimeMs: number
  /** 最后观测字节数。 */
  size: number
  /** 内容/解析版本：每次重新解析递增，旧扫描结果不得覆盖新版本。 */
  contentVersion: number
  /** 文件创建时间（毫秒；可选）。Windows stat birthtime；POSIX 宿主常取
   *  不到（0/缺省）——面板按创建时间排序时未知值沉底。旧快照缺字段容忍，
   *  不升格式版本（增量重扫自愈补齐）。 */
  birthtimeMs?: number
}

/** 出链种类：双链 / 普通内联链接 / 图片 / 引用式链接定义 / 嵌入（#222：
 *  `![[…]]` 独立语法角色——解析锚点拆列与改写语义同 wikilink，快照码表
 *  尾追 code 4 兼容旧快照）。 */
export type VaultEdgeKind = 'wikilink' | 'mdlink' | 'image' | 'refdef' | 'embed'

/** 一条出链：来源文档 → 目标（保留断链原样，未命中也入索引）。
 *  target 为链接原文的目标形态（含省略扩展名、相对段等）；
 *  resolvedTarget 为解析后的**规范绝对身份**（#556 T2 起：磁盘真实形态、
 *  `/` 分隔、normKey 归一语义——跨根/工作区外目标以其绝对形态表达，
 *  不同根同名相对路径不合并；反链聚合键随身份走）；断链、越出所属根、
 *  非文件目标（https 等）与补查歧义/未就绪（不归任一候选）为 null。 */
export interface VaultEdge {
  source: string
  target: string
  resolvedTarget: string | null
  kind: VaultEdgeKind
  /** 标题/块锚点文本，空串表示无。 */
  anchor: string
  /** 出链标记在来源正文中的 LF 偏移区间（可定位区间）。 */
  start: number
  end: number
}

/** 全量索引模型：文件表 + 边表（反链由 buildBacklinkIndex 重建）。
 *  #556 T2 起文件表键为混合域：根内条目为根内相对路径（`/` 分隔），
 *  跨根/工作区外的被引用目标为规范绝对身份（不递归解析其内容）。 */
export interface VaultIndexModel {
  files: Map<string, VaultFileEntry>
  edges: VaultEdge[]
}

/** 稳定排序键：来源路径 → 区间起点 → 终点 → 目标；同输入任意顺序结果一致。 */
export function sortEdges(edges: readonly VaultEdge[]): VaultEdge[] {
  return edges.slice().sort((a, b) =>
    a.source < b.source ? -1
      : a.source > b.source ? 1
        : a.start - b.start || a.end - b.end || (a.target < b.target ? -1 : a.target > b.target ? 1 : 0),
  )
}

/** 从边表构建反链索引：聚合键为解析后目标（resolvedTarget——#556 T2 起
 *  为规范绝对身份），断链（resolvedTarget=null）回退按原始目标聚合——
 *  保留「哪些文件断链指向 X」的可见性，不与任何解析目标合并。列表按
 *  sortEdges 序稳定。 */
export function buildBacklinkIndex(edges: readonly VaultEdge[]): Map<string, VaultEdge[]> {
  const index = new Map<string, VaultEdge[]>()
  for (const e of sortEdges(edges)) {
    const key = e.resolvedTarget ?? e.target
    let list = index.get(key)
    if (!list) index.set(key, (list = []))
    list.push(e)
  }
  return index
}
