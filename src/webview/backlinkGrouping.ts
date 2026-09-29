// 反链面板分组纯逻辑（反链面板形态改版批次）：宿主快照 items → 面板
// 视图模型（分组数组）。分组聚合、四种排序键 × 方向（未知时间沉底）、
// 搜索过滤（来源文件名 + 片段文本，不区分大小写）与折叠键派生全部在此
// 纯函数化——单测直驱，渲染层（backlinkPanel）只消费不重算。
//
// 排序语义（验收反馈规格）：
// - 文件名：组（来源文件）按显示名码位升 / 降
// - 编辑时间：组按来源文件 mtimeMs（从新到旧 / 从旧到新）
// - 创建时间：组按来源文件 birthtimeMs（从新到旧 / 从旧到新）；未知
//   （0/缺省——POSIX 常不可得）沉底并保持稳定序（同键按显示名码位）
// - 组内条目固定稳定序（来源路径 → 区间起点，宿主 sortEdges 序原样保持）
import type { BacklinkItemPayload } from '../shared/protocol'
import { backlinkSourceLabel } from './backlinkPanel'

/** 排序六项（排序下拉菜单项与排序键的一一对应） */
export type BacklinkSortMode =
  | 'name-asc'
  | 'name-desc'
  | 'mtime-desc'
  | 'mtime-asc'
  | 'birth-desc'
  | 'birth-asc'

/** 排序菜单项清单（文档序 = 菜单渲染序：文件名组 / 编辑时间组 / 创建时间组） */
export const BACKLINK_SORT_MODES: readonly BacklinkSortMode[] = [
  'name-asc',
  'name-desc',
  'mtime-desc',
  'mtime-asc',
  'birth-desc',
  'birth-asc',
]

/** 分组视图选项（面板交互状态；由 syncController 持有，渲染时传入） */
export interface BacklinkViewOptions {
  sortMode: BacklinkSortMode
  /** 搜索词（trim 后空串 = 不过滤） */
  query: string
  /** 折叠组键集合（sourceRelPath） */
  collapsedGroups: ReadonlySet<string>
}

/** 一个来源文件的分组（组头信息 + 组内条目，宿主稳定序） */
export interface BacklinkGroup {
  /** 组键 = 来源根内相对路径（折叠标记的数据键） */
  key: string
  /** 组头显示名（去 .md 扩展，目录段保留） */
  label: string
  /** 来源文件 mtime（毫秒；未知 0） */
  mtimeMs: number
  /** 来源文件创建时间（毫秒；未知 0——排序沉底） */
  birthtimeMs: number
  items: readonly BacklinkItemPayload[]
}

/** 分组结果（matched = 过滤后计数，页头计数用它） */
export interface BacklinkGroupingResult {
  groups: BacklinkGroup[]
  /** 过滤前条目总数（快照 items 长度） */
  totalCount: number
  /** 过滤后条目数（当前渲染的卡片数） */
  matchedCount: number
}

/** 单条目搜索匹配：来源路径 + 短/长片段，不区分大小写（空词恒匹配） */
function itemMatches(item: BacklinkItemPayload, needle: string): boolean {
  if (needle === '') {
    return true
  }
  return (
    item.sourceRelPath.toLowerCase().includes(needle) ||
    item.snippet.toLowerCase().includes(needle) ||
    (item.snippetLong ?? '').toLowerCase().includes(needle)
  )
}

/** 显示名码位比较（升序；稳定序的兜底键） */
function compareLabel(a: BacklinkGroup, b: BacklinkGroup): number {
  return a.label < b.label ? -1 : a.label > b.label ? 1 : 0
}

/** 时间键排序：未知（≤0）沉底（与方向无关）；已知之间按方向 */
function compareTime(a: BacklinkGroup, b: BacklinkGroup, key: 'mtimeMs' | 'birthtimeMs', desc: boolean): number {
  const av = a[key]
  const bv = b[key]
  const aUnknown = !(av > 0)
  const bUnknown = !(bv > 0)
  if (aUnknown !== bUnknown) {
    return aUnknown ? 1 : -1
  }
  if (av === bv) {
    return compareLabel(a, b)
  }
  return desc ? bv - av : av - bv
}

/**
 * 按视图选项分组快照条目：过滤（搜索词）→ 按来源聚合 → 组间排序 →
 * 折叠标记由渲染层按 options.collapsedGroups 消费（组内条目无论折叠都
 * 参与计数与匹配，折叠只影响呈现）。
 */
export function groupBacklinks(
  items: readonly BacklinkItemPayload[],
  options: Pick<BacklinkViewOptions, 'sortMode' | 'query'>,
): BacklinkGroupingResult {
  const needle = options.query.trim().toLowerCase()
  const bySource = new Map<string, BacklinkItemPayload[]>()
  let matched = 0
  for (const item of items) {
    if (!itemMatches(item, needle)) {
      continue
    }
    matched++
    let list = bySource.get(item.sourceRelPath)
    if (!list) {
      bySource.set(item.sourceRelPath, (list = []))
    }
    list.push(item)
  }
  const groups: BacklinkGroup[] = [...bySource.entries()].map(([key, list]) => ({
    key,
    label: backlinkSourceLabel(key),
    mtimeMs: list[0]?.sourceMtimeMs ?? 0,
    birthtimeMs: list[0]?.sourceBirthtimeMs ?? 0,
    items: list,
  }))
  switch (options.sortMode) {
    case 'name-asc':
      groups.sort((a, b) => compareLabel(a, b))
      break
    case 'name-desc':
      groups.sort((a, b) => compareLabel(b, a))
      break
    case 'mtime-desc':
      groups.sort((a, b) => compareTime(a, b, 'mtimeMs', true))
      break
    case 'mtime-asc':
      groups.sort((a, b) => compareTime(a, b, 'mtimeMs', false))
      break
    case 'birth-desc':
      groups.sort((a, b) => compareTime(a, b, 'birthtimeMs', true))
      break
    case 'birth-asc':
      groups.sort((a, b) => compareTime(a, b, 'birthtimeMs', false))
      break
  }
  return { groups, totalCount: items.length, matchedCount: matched }
}

/** 全部组键（「折叠全部/全部展开」的集合派生；快照序去重） */
export function backlinkGroupKeysOf(items: readonly BacklinkItemPayload[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    if (!seen.has(item.sourceRelPath)) {
      seen.add(item.sourceRelPath)
      out.push(item.sourceRelPath)
    }
  }
  return out
}

/** 是否全部组处于折叠态（无组视为未全折） */
export function allGroupsCollapsed(items: readonly BacklinkItemPayload[], collapsed: ReadonlySet<string>): boolean {
  const keys = backlinkGroupKeysOf(items)
  return keys.length > 0 && keys.every((key) => collapsed.has(key))
}
