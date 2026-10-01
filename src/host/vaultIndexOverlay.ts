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
import { sortEdges, type VaultEdge } from '../shared/vaultIndexModel'

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

  /** 世界变化后的同版本重算（#269 慢时序兜底）：rename 批末新路径登记完成
   *  后重算现存未保存条目——「冲刷早于登记」落层的断链边无后续冲刷时机
   *  （防抖定时器已消费），apply 的同版本拒绝会把它永久钉死。本入口只对
   *  迟到旧扫描（版本更低）保持拒绝；相等（同 buffer 在新世界下的重算）
   *  或更高接受。 */
  reapply(docPath: string, contentVersion: number, edges: readonly VaultEdge[]): boolean {
    const prev = this.entries.get(docPath)
    if (prev && contentVersion < prev.contentVersion) {
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
 *
 * fold（review-loops #11）：目标键归一函数（Windows 宿主大小写折叠；
 * POSIX 缺省 identity 不折叠）——查询路径与磁盘形态大小写漂移时按
 * fold 命中桶与覆盖层边，与 renameCandidatesOf 的桶匹配同口径。
 * 缺省严格相等（既有调用方语义不变）。
 */
export function queryBacklinks(
  baseIndex: ReadonlyMap<string, readonly VaultEdge[]>,
  overlay: VaultIndexOverlay | null,
  targetRelPath: string,
  fold: (relPath: string) => string = (p) => p,
): VaultEdge[] {
  const overlayEntries = overlay?.entriesOf()
  const out: VaultEdge[] = []
  const targetKey = fold(targetRelPath)
  const matches = (e: VaultEdge): boolean => fold(e.resolvedTarget ?? '') === targetKey
    || (e.resolvedTarget === null && fold(e.target) === targetKey)
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
