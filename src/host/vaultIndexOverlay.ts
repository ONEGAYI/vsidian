// 索引覆盖层与反链查询纯逻辑（工单 #197）：未保存文档的当前内容只作内存
// 覆盖层（#194 规格「索引模型与存储决策门槛」），不写入磁盘基线快照；
// 变更版本单调递增仲裁——旧扫描 / 旧请求的结果不得覆盖新版本。
//
// 事实源分层：磁盘基线（VaultIndexModel，来自快照恢复或全量扫描）+ 每文档
// 覆盖条目（TextDocument.version 作 contentVersion——宿主保证单调）。查询时
// 合成两层的反链结果：覆盖层在场的文档，其基线出链整体被覆盖层的边替代。
//
// 本模块不依赖 vscode / DOM（node 单测直驱）。
import { buildBacklinkIndex } from '../shared/vaultIndexSnapshot'
import { sortEdges, type VaultEdge, type VaultIndexModel } from '../shared/vaultIndexModel'

/** 单文档的覆盖条目（未保存内容的内存索引结果） */
export interface VaultOverlayEntry {
  /** 采信该结果时的文档版本（TextDocument.version，单调递增） */
  contentVersion: number
  /** 该文档的全部出链（整文件抽取结果——基线边被整体替代，不做增量合并） */
  edges: VaultEdge[]
}

/** 未保存内容内存覆盖层：按文档路径登记，版本仲裁写入 */
export class VaultIndexOverlay {
  private readonly entries = new Map<string, VaultOverlayEntry>()

  /** 采信一条覆盖结果：版本不高于已存版本即丢弃（旧扫描不覆盖新内容）。
   *  返回是否采信。 */
  apply(docPath: string, contentVersion: number, edges: readonly VaultEdge[]): boolean {
    const prev = this.entries.get(docPath)
    if (prev && contentVersion <= prev.contentVersion) {
      return false
    }
    this.entries.set(docPath, { contentVersion, edges: [...edges] })
    return true
  }

  /** 退役覆盖条目（文档保存、磁盘基线已更新后回到基线）；未登记幂等 */
  clear(docPath: string): void {
    this.entries.delete(docPath)
  }

  get(docPath: string): VaultOverlayEntry | undefined {
    return this.entries.get(docPath)
  }

  /** 覆盖层全部条目（文档路径 → 条目） */
  entriesOf(): ReadonlyMap<string, VaultOverlayEntry> {
    return this.entries
  }
}

/**
 * 反链查询：目标（根内相对路径）的反向引用边合成。
 *
 * 基线反链索引按解析后目标聚合（resolvedTarget ?? target，#195 语义）；
 * 覆盖层在场的文档，其基线边跳过、由覆盖层该文档的边接管——未保存编辑
 * （增删引用）即时反映。结果按 sortEdges 稳定排序（来源路径 → 区间）。
 * overlay 传 null 时退化为纯基线查询。
 */
export function queryBacklinks(
  base: VaultIndexModel,
  baseIndex: ReadonlyMap<string, readonly VaultEdge[]>,
  overlay: VaultIndexOverlay | null,
  targetRelPath: string,
): VaultEdge[] {
  const overlayEntries = overlay?.entriesOf()
  const out: VaultEdge[] = []
  const matches = (e: VaultEdge): boolean => e.resolvedTarget === targetRelPath
    || (e.resolvedTarget === null && e.target === targetRelPath)
  for (const e of baseIndex.get(targetRelPath) ?? []) {
    if (overlayEntries?.has(e.source)) {
      continue // 该文档有覆盖层：基线边由覆盖层接管
    }
    if (matches(e)) {
      out.push(e)
    }
  }
  if (overlayEntries) {
    for (const entry of overlayEntries.values()) {
      for (const e of entry.edges) {
        if (matches(e)) {
          out.push(e)
        }
      }
    }
  }
  return sortEdges(out)
}

export { buildBacklinkIndex }
