import { scanEmbedsInLine } from './wikilink'
import { scanEmbedsInTableRow } from './tableCellEmbed'
import { chainAt, frontmatterRange, markdownTreeParser } from './markdownDoc'

export const REF_EXPANSION_LIMITS = {
  defaultDepth: 3,
  maxDepth: 6,
  treeInstances: 24,
  panelInstances: 64,
  treeBytes: 2 * 1024 * 1024,
  panelBytes: 8 * 1024 * 1024,
  concurrentReads: 8,
} as const

/**
 * A node's canonical identity is the target document itself, not a semantic
 * scope or a particular card instance. P2-03 (#280, ADR-0011): full-document
 * access unifies heading/block references with full references, so a different
 * anchor no longer creates a different content node and cannot bypass an
 * ancestor cycle; sibling occurrences of the same target remain legal.
 */
export function canonicalRefTargetKey(fsPath: string, windows: boolean): string {
  const path = fsPath.replace(/\\/g, '/').replace(/\/+$/g, '')
  const canonicalPath = windows ? path.toLowerCase() : path
  return JSON.stringify([canonicalPath])
}

export function inExpansionPath(path: readonly string[], key: string): boolean {
  return path.includes(key)
}

/**
 * Validate a child against the current authoritative LF source, never a webview URI claim.
 *
 * P2-03 (#280): the parent's initial anchor range no longer bounds where a
 * legal child may live — the direct source's full text is the boundary
 * (content scope = full document). Version match, byte-exact occurrence
 * alignment and the syntax-exclusion guards are unchanged.
 *
 * #246 混排准入：区间不再要求独占整行，改为「该行内一个完整嵌入
 * occurrence 的精确边界且 inner 逐字节匹配」；列表/引用（含任务、嵌套、
 * 懒续行与组合）从语法排除中放行——与呈现侧（readingMarkdown 占位规则
 * + embedSlots 提升）和索引侧（vaultLinkExtract 行扫描）同源。语法排除
 * 守卫保留：代码（围栏/缩进/行内）、frontmatter、HTML 注释（lezer 的
 * Comment/CommentBlock 节点——#246 前的 HTMLComment 条目从未命中过，
 * 实测节点名后更正）仍拒绝，不因混排准入而放宽——不通过删守卫把字面量
 * 升级为引用。
 *
 * #248 表格准入：Table 从排除集合退役，表格内容行（TableHeader/TableRow）
 * 的格内嵌入 occurrence 同源放行——对齐口径按格内语义：target 为解码
 * inner（`B|别名`——scanEmbedsInTableRow 逐格解码视图），区间为原始源码
 * 区间（含 `\|` 转义字符）；解码字符串 offset（短于源文）不通过区间
 * 校验。非表格行的 `\|` 形态不进入解码语义（既有边界不扩散）。
 */
export function validChildSource(
  parent: { version: number },
  current: { version: number; text: string },
  start: number,
  end: number,
  target: string,
): boolean {
  if (current.version !== parent.version || !Number.isInteger(start) || !Number.isInteger(end) ||
    start < 0 || end > current.text.length || start >= end) return false
  const lineStart = current.text.lastIndexOf('\n', start - 1) + 1
  const lineBreak = current.text.indexOf('\n', end)
  const lineEnd = lineBreak < 0 ? current.text.length : lineBreak
  const line = current.text.slice(lineStart, lineEnd)
  const tree = markdownTreeParser.parse(current.text)
  const nodeNames = chainAt(tree, start).map((node) => node.name)
  // 区间必须精确对齐行内 occurrence（inner 逐字节匹配——半截/吞字/错位拒绝）。
  // 表格内容行走格内解码扫描（inner 为解码语义），其余行走原始行扫描。
  const tableRow = nodeNames.includes('TableRow') || nodeNames.includes('TableHeader')
  const occurrences = tableRow ? scanEmbedsInTableRow(line, 0) : scanEmbedsInLine(line, 0)
  const aligned = occurrences.some((hit) =>
    lineStart + hit.from === start && lineStart + hit.to === end && hit.inner === target)
  if (!aligned) return false
  const fm = frontmatterRange(current.text)
  if (fm && start < fm.end) return false
  const excluded = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'CodeText', 'CodeMark',
    'CodeInfo', 'HTMLBlock', 'Comment', 'CommentBlock'])
  return !nodeNames.some((name) => excluded.has(name))
}

type LimitKey = 'treeInstances' | 'panelInstances' | 'treeBytes' | 'panelBytes' | 'concurrentReads'
type Limits = Partial<Record<LimitKey, number>>

interface Reservation {
  id: symbol
  tree: string
  depth: number
  dataKey?: string
}

interface DataEntry {
  bytes: number
  refs: number
}

export class RefExpansionBudget {
  depthLimit: number = REF_EXPANSION_LIMITS.defaultDepth
  private readonly limits: Record<keyof typeof REF_EXPANSION_LIMITS, number>
  private readonly reservations = new Map<string, Reservation>()
  /** 端口读取可在实例卸载后仍运行；token 生命周期独立于 DOM/reservation。 */
  private readonly activeReads = new Map<string, Map<symbol | string | number, symbol>>()
  private readonly panelData = new Map<string, DataEntry>()
  private readonly treeData = new Map<string, Map<string, DataEntry>>()
  private inFlight = 0

  constructor(limits: Limits = {}) {
    this.limits = { ...REF_EXPANSION_LIMITS, ...limits }
  }

  setDepthLimit(value: number): void {
    this.depthLimit = Number.isFinite(value)
      ? Math.max(1, Math.min(REF_EXPANSION_LIMITS.maxDepth, Math.trunc(value)))
      : REF_EXPANSION_LIMITS.defaultDepth
  }

  reserve(tree: string, instance: string, depth: number): 'ok' | 'depth' | 'instances' {
    if (depth < 1 || depth > this.depthLimit) return 'depth'
    if (this.reservations.has(instance)) return 'ok'
    if (this.reservations.size >= this.limits.panelInstances) return 'instances'
    let treeInstances = 0
    for (const reservation of this.reservations.values()) {
      if (reservation.tree === tree) treeInstances++
    }
    if (treeInstances >= this.limits.treeInstances) return 'instances'
    this.reservations.set(instance, { id: Symbol('ref-occurrence'), tree, depth })
    return 'ok'
  }

  /** 读取准入与新槽回滚一并完成；刷新已有实例被拒时保留其正文预算。 */
  admitRead(tree: string, instance: string, depth: number, token: symbol | string | number = 'legacy'):
    'ok' | 'depth' | 'instances' | 'concurrency' {
    const existed = this.reservations.has(instance)
    const reserved = this.reserve(tree, instance, depth)
    if (reserved !== 'ok') return reserved
    const admitted = this.beginRead(instance, token)
    if (admitted !== 'ok' && !existed) this.release(instance)
    return admitted
  }

  attachContent(instance: string, dataKey: string, bytes: number): 'ok' | 'bytes' {
    const reservation = this.reservations.get(instance)
    if (!reservation || !Number.isSafeInteger(bytes) || bytes < 0) return 'bytes'
    if (reservation.dataKey === dataKey) {
      const treeEntry = this.treeData.get(reservation.tree)?.get(dataKey)
      const panelEntry = this.panelData.get(dataKey)
      if (!treeEntry || !panelEntry) return 'bytes'
      if (treeEntry.bytes === bytes) return 'ok'
      if (treeEntry.refs !== 1 || panelEntry.refs !== 1 ||
        this.sumBytes(this.treeData.get(reservation.tree)) - treeEntry.bytes + bytes > this.limits.treeBytes ||
        this.sumBytes(this.panelData) - panelEntry.bytes + bytes > this.limits.panelBytes) return 'bytes'
      treeEntry.bytes = bytes
      panelEntry.bytes = bytes
      return 'ok'
    }
    const old = reservation.dataKey
    const treeEntries = this.treeData.get(reservation.tree)
    const oldTreeSavings = old && treeEntries?.get(old)?.refs === 1 ? treeEntries.get(old)!.bytes : 0
    const oldPanelSavings = old && this.panelData.get(old)?.refs === 1 ? this.panelData.get(old)!.bytes : 0
    const treeIncrease = treeEntries?.has(dataKey) ? 0 : bytes
    const panelIncrease = this.panelData.has(dataKey) ? 0 : bytes
    if (this.sumBytes(treeEntries) - oldTreeSavings + treeIncrease > this.limits.treeBytes
      || this.sumBytes(this.panelData) - oldPanelSavings + panelIncrease > this.limits.panelBytes) return 'bytes'
    if (old) this.detach(reservation)
    const targetTreeEntries = this.treeData.get(reservation.tree) ?? new Map<string, DataEntry>()
    this.treeData.set(reservation.tree, targetTreeEntries)
    this.addRef(targetTreeEntries, dataKey, bytes)
    this.addRef(this.panelData, dataKey, bytes)
    reservation.dataKey = dataKey
    return 'ok'
  }

  beginRead(instance: string, token: symbol | string | number = 'legacy'): 'ok' | 'concurrency' {
    const reservation = this.reservations.get(instance)
    const tokens = this.activeReads.get(instance)
    if (!reservation || tokens?.has(token) || this.inFlight >= this.limits.concurrentReads) return 'concurrency'
    if (tokens) tokens.set(token, reservation.id)
    else this.activeReads.set(instance, new Map([[token, reservation.id]]))
    this.inFlight++
    return 'ok'
  }

  finishRead(instance: string, token: symbol | string | number = 'legacy'): void {
    const tokens = this.activeReads.get(instance)
    if (!tokens?.delete(token)) return
    if (tokens.size === 0) this.activeReads.delete(instance)
    this.inFlight--
  }

  hasActiveRead(instance: string): boolean {
    return (this.activeReads.get(instance)?.size ?? 0) > 0
  }

  /** 卸载后重建的同名 occurrence 不接纳旧读取的迟到结果。 */
  isCurrentRead(instance: string, token: symbol | string | number): boolean {
    const id = this.activeReads.get(instance)?.get(token)
    return id !== undefined && this.reservations.get(instance)?.id === id
  }

  release(instance: string): void {
    const reservation = this.reservations.get(instance)
    if (!reservation) return
    this.detach(reservation)
    this.reservations.delete(instance)
  }

  clearContent(instance: string): void {
    const reservation = this.reservations.get(instance)
    if (reservation) this.detach(reservation)
  }

  snapshot(): { panelInstances: number; panelBytes: number; treeBytes: Record<string, number>; inFlight: number } {
    const treeBytes: Record<string, number> = {}
    for (const [tree, data] of this.treeData) treeBytes[tree] = this.sumBytes(data)
    return { panelInstances: this.reservations.size, panelBytes: this.sumBytes(this.panelData), treeBytes, inFlight: this.inFlight }
  }

  private detach(reservation: Reservation): void {
    if (!reservation.dataKey) return
    const dataKey = reservation.dataKey
    const treeEntries = this.treeData.get(reservation.tree)
    if (treeEntries) {
      this.dropRef(treeEntries, dataKey)
      if (treeEntries.size === 0) this.treeData.delete(reservation.tree)
    }
    this.dropRef(this.panelData, dataKey)
    reservation.dataKey = undefined
  }

  private addRef(entries: Map<string, DataEntry>, key: string, bytes: number): void {
    const entry = entries.get(key)
    if (entry) entry.refs++
    else entries.set(key, { bytes, refs: 1 })
  }

  private dropRef(entries: Map<string, DataEntry>, key: string): void {
    const entry = entries.get(key)
    if (!entry) return
    if (--entry.refs === 0) entries.delete(key)
  }

  private sumBytes(entries?: Map<string, DataEntry>): number {
    let bytes = 0
    if (entries) for (const entry of entries.values()) bytes += entry.bytes
    return bytes
  }
}
