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
  path: string
  kind: VaultFileKind
  /** 最后观测 mtime（毫秒）；mtime+size 仅筛选变化，不是内容一致性证明。 */
  mtimeMs: number
  /** 最后观测字节数。 */
  size: number
  /** 内容/解析版本：每次重新解析递增，旧扫描结果不得覆盖新版本。 */
  contentVersion: number
}

/** 出链种类：双链 / 普通内联链接 / 图片 / 引用式链接定义。 */
export type VaultEdgeKind = 'wikilink' | 'mdlink' | 'image' | 'refdef'

/** 一条出链：来源文档 → 目标（保留断链原样，未命中也入索引）。
 *  target 为链接原文的目标形态（含省略扩展名、相对段等）；
 *  resolvedTarget 为按来源目录解析后的根内相对规范路径，
 *  断链、越出所属根、非文件目标（https 等）为 null。反链聚合用 resolvedTarget。 */
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

/** 全量索引模型：文件表 + 边表（反链由 buildBacklinkIndex 重建）。 */
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

/** 从边表构建反链索引：聚合键为解析后目标（resolvedTarget），断链
 *  （resolvedTarget=null）回退按原始目标聚合——保留「哪些文件断链指向 X」
 *  的可见性，不与任何解析目标合并。列表按 sortEdges 序稳定。 */
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
