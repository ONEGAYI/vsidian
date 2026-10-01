import type { HoverPreviewScope } from './protocol'
import { soleEmbedOfLine } from './wikilink'
import { chainAt, frontmatterRange, markdownTreeParser } from '../webview/markdownDoc'
import { stripHtmlComments } from '../webview/htmlComment'

export const REF_EXPANSION_LIMITS = {
  defaultDepth: 3,
  maxDepth: 6,
  treeInstances: 24,
  panelInstances: 64,
  treeBytes: 2 * 1024 * 1024,
  panelBytes: 8 * 1024 * 1024,
  concurrentReads: 8,
} as const

/** A node is the canonical target and its semantic range, not a particular card instance. */
export function canonicalRefTargetKey(fsPath: string, scope: HoverPreviewScope, windows: boolean): string {
  const path = fsPath.replace(/\\/g, '/').replace(/\/+$/g, '')
  const canonicalPath = windows ? path.toLowerCase() : path
  const anchor = scope.kind === 'heading'
    ? scope.anchor.trim().replace(/\s+/g, ' ').toLowerCase()
    : scope.kind === 'block' ? scope.anchor : ''
  return JSON.stringify([canonicalPath, scope.kind, anchor])
}

export function inExpansionPath(path: readonly string[], key: string): boolean {
  return path.includes(key)
}

/** Validate a child against the current authoritative LF source, never a webview URI claim. */
export function validChildSource(
  parent: { version: number; range: { start: number; end: number } },
  current: { version: number; text: string },
  start: number,
  end: number,
  target: string,
): boolean {
  if (current.version !== parent.version || !Number.isInteger(start) || !Number.isInteger(end) ||
    start < parent.range.start || end > parent.range.end || start >= end || end > current.text.length) return false
  const slice = current.text.slice(start, end)
  if (slice.includes('\n') || soleEmbedOfLine(slice)?.inner !== target) return false
  const lineStart = current.text.lastIndexOf('\n', start - 1) + 1
  const lineBreak = current.text.indexOf('\n', end)
  const lineEnd = lineBreak < 0 ? current.text.length : lineBreak
  if (start !== lineStart || end !== lineEnd) return false
  const lineIndex = current.text.slice(0, start).split('\n').length - 1
  if (soleEmbedOfLine(stripHtmlComments(current.text).split('\n')[lineIndex] ?? '')?.inner !== target) return false
  const fm = frontmatterRange(current.text)
  if (fm && start < fm.end) return false
  const excluded = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'CodeText', 'CodeMark',
    'HTMLBlock', 'HTMLComment', 'Blockquote', 'ListItem', 'Table'])
  const tree = markdownTreeParser.parse(current.text)
  return !chainAt(tree, start).some((node) => excluded.has(node.name))
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
