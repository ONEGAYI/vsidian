import type { SyntaxNode } from '@lezer/common'
import type { FormatOperationId } from '../shared/formatOperations'
import { markdownTreeParser } from './markdownDoc'
import { parseTableDelimiter, tableRowCellsForColumns } from './tableCells'
import type { TableRegion } from './tableRegion'

export interface FormatSelection { from: number; to: number }
export interface FormatChange { from: number; to: number; insert: string }
export interface FormatPlan {
  changes: FormatChange[]
  selection?: { anchor: number; head?: number }
}
export type FormatAction = 'toggle' | 'add' | 'remove'

/** 行内围栏单一登记表（#103 两处登记约定）：包裹规划在此消费，
 *  quickActionState 的节点名、mark 字符与包裹判定也一律从本表派生——
 *  新增围栏只登记此处 + shared 注册表，即自动继承全部行为 */
export const INLINE: Partial<Record<FormatOperationId, { mark: string; node: string }>> = {
  bold: { mark: '**', node: 'StrongEmphasis' },
  italic: { mark: '*', node: 'Emphasis' },
  strikethrough: { mark: '~~', node: 'Strikethrough' },
  inlineCode: { mark: '`', node: 'InlineCode' },
  highlight: { mark: '==', node: 'Highlight' },
}

function nodesAt(root: SyntaxNode, pos: number): SyntaxNode[] {
  const result: SyntaxNode[] = []
  for (let node: SyntaxNode | null = root; node; node = node.parent) result.unshift(node)
  // Lezer resolveInner 在边界处有方向性：优先右侧可编辑文本。
  const resolved = root.resolveInner(pos, 1)
  result.length = 0
  for (let node: SyntaxNode | null = resolved; node; node = node.parent) result.unshift(node)
  return result
}

function matchingSpan(root: SyntaxNode, name: string, from: number, to: number): SyntaxNode | null {
  const ancestors = nodesAt(root, from)
  return ancestors.reverse().find((node) => node.name === name &&
    node.from < from && node.to > to) ?? null
}

/** 贴邻围栏（#107）：光标恰在某同类围栏节点的起点或终点（开边界外侧）时
 *  视为位于该围栏——贴邻即切换为取消。光标在节点终点处时该节点不在
 *  resolveInner 的祖先链里（半开区间不含终点），matchingSpan 放宽条件
 *  覆盖不了行尾侧，故独立按节点区间查找；多个贴邻候选时后者覆盖前者，
 *  与 nodesAt 的右向原则一致（缝隙归右侧围栏）。
 *  右向下降只进最右接触子树（childBefore(pos+1) 取 from<=pos 的最右子节点）：
 *  光标在左侧围栏终点、右侧紧接异名围栏起点时（`*em***strong**` @4 取
 *  italic），异名子树遮蔽且其内无同名节点，左侧 to===pos 的同名贴邻不可达
 *  ——此时回探 from<pos 的子树（childBefore(pos)），只认 to===pos 的零间隙
 *  贴邻接管取消；回探仅在上面的右向查找落空后进行，不改变缝隙归右语义。 */
function adjacentSpan(root: SyntaxNode, name: string, pos: number): SyntaxNode | null {
  let found: SyntaxNode | null = null
  const walk = (node: SyntaxNode): void => {
    if (node.to < pos || node.from > pos) return
    if (node.name === name && (node.from === pos || node.to === pos)) found = node
    for (let child = node.childBefore(pos + 1); child && child.from <= pos; child = child.nextSibling) {
      walk(child)
    }
  }
  walk(root)
  if (found) return found
  const walkLeft = (node: SyntaxNode): void => {
    if (node.name === name && node.to === pos) found = node
    for (let child = node.childBefore(pos); child && child.to >= pos; child = child.prevSibling) {
      walkLeft(child)
    }
  }
  walkLeft(root)
  return found
}

function blockedInline(root: SyntaxNode, from: number, to: number, target: string): boolean {
  const blocked = new Set(['FencedCode', 'CodeBlock', 'HTMLBlock'])
  if (target !== 'InlineCode') blocked.add('InlineCode')
  for (const pos of [from, Math.max(from, to - 1)]) {
    if (nodesAt(root, pos).some((node) => blocked.has(node.name))) return true
  }
  return false
}

function inlineSpans(root: SyntaxNode, name: string, from: number, to: number): SyntaxNode[] {
  const spans: SyntaxNode[] = []
  const walk = (node: SyntaxNode): void => {
    if (node.to < from || node.from > to) return
    if (node.name === name && node.from >= from && node.to <= to) spans.push(node)
    for (let child = node.childAfter(from - 1); child && child.from <= to; child = child.nextSibling) {
      walk(child)
    }
  }
  walk(root)
  return spans.sort((a, b) => a.from - b.from)
}

function mergeIntervals(intervals: FormatSelection[]): FormatSelection[] {
  const merged: FormatSelection[] = []
  for (const interval of intervals.sort((a, b) => a.from - b.from)) {
    if (interval.from >= interval.to) continue
    const last = merged.at(-1)
    if (last && interval.from <= last.to) last.to = Math.max(last.to, interval.to)
    else merged.push({ ...interval })
  }
  return merged
}

function codeSpanMarkers(content: string): { open: string; close: string } {
  const delimiter = codeDelimiter(content)
  // CommonMark 在内容以反引号起止时要求用空格隔开定界符；两侧均有
  // 原始空格时也要各补一个，抵消代码段解析器对首尾各一个空格的裁剪。
  const padding = content.startsWith('`') || content.endsWith('`') ||
    content.startsWith(' ') && content.endsWith(' ') ? ' ' : ''
  return { open: delimiter + padding, close: padding + delimiter }
}

function rewriteInlineLine(text: string, root: SyntaxNode, name: string, mark: string,
  lineFrom: number, lineTo: number, from: number, to: number,
  action: FormatAction): FormatChange | null {
  const touched = inlineSpans(root, name, lineFrom, lineTo).filter((span) =>
    span.firstChild && span.lastChild && span.firstChild.to < to && span.lastChild.from > from)
  const changeFrom = Math.min(from, ...touched.map((span) => span.from))
  const changeTo = Math.max(to, ...touched.map((span) => span.to))
  const line = text.slice(changeFrom, changeTo)
  const spans = inlineSpans(root, name, changeFrom, changeTo)
  const masked = new Array<boolean>(line.length).fill(false)
  for (const span of spans) {
    if (!span.firstChild || !span.lastChild || span.firstChild === span.lastChild) continue
    for (const marker of [span.firstChild, span.lastChild]) {
      for (let i = marker.from; i < marker.to; i++) masked[i - changeFrom] = true
    }
  }
  const positions = new Array<number>(line.length + 1).fill(0)
  let plain = ''
  for (let i = 0; i < line.length; i++) {
    positions[i + 1] = positions[i] + (masked[i] ? 0 : 1)
    if (!masked[i]) plain += line[i]
  }
  const selected = { from: positions[from - changeFrom]!, to: positions[to - changeFrom]! }
  if (selected.from >= selected.to) return null
  const existing = mergeIntervals(spans.map((span) => ({
    from: positions[span.firstChild!.to - changeFrom]!,
    to: positions[span.lastChild!.from - changeFrom]!,
  })))
  const allApplied = existing.some((span) => span.from <= selected.from && span.to >= selected.to)
  const shouldRemove = action === 'remove' || action === 'toggle' && allApplied
  const next = shouldRemove
    ? mergeIntervals(existing.flatMap((span) => span.to <= selected.from || span.from >= selected.to
      ? [span] : [
        { from: span.from, to: Math.min(span.to, selected.from) },
        { from: Math.max(span.from, selected.to), to: span.to },
      ]))
    : mergeIntervals([...existing, selected])
  let rendered = ''
  let cursor = 0
  for (const span of next) {
    const content = plain.slice(span.from, span.to)
    const markers = name === 'InlineCode'
      ? codeSpanMarkers(content) : { open: mark, close: mark }
    rendered += plain.slice(cursor, span.from) + markers.open + content + markers.close
    cursor = span.to
  }
  rendered += plain.slice(cursor)
  return rendered === line ? null : { from: changeFrom, to: changeTo, insert: rendered }
}

function clearInlineLine(text: string, root: SyntaxNode, lineFrom: number, lineTo: number,
  from: number, to: number): FormatChange | null {
  const found: Array<{ node: SyntaxNode; first: SyntaxNode; last: SyntaxNode }> = []
  for (const config of Object.values(INLINE)) {
    if (!config) continue
    for (const node of inlineSpans(root, config.node, lineFrom, lineTo)) {
      if (node.firstChild && node.lastChild && node.firstChild !== node.lastChild) {
        found.push({ node, first: node.firstChild, last: node.lastChild })
      }
    }
  }
  const touched = found.filter((span) => span.first.to < to && span.last.from > from)
  if (!touched.length) return null
  const changeFrom = Math.min(from, ...touched.map((span) => span.node.from))
  const changeTo = Math.max(to, ...touched.map((span) => span.node.to))
  const line = text.slice(changeFrom, changeTo)
  const masked = new Array<boolean>(line.length).fill(false)
  const styles: Array<{ from: number; to: number; open: string; close: string; kind: string }> = []
  for (const span of found) {
    if (span.node.from < changeFrom || span.node.to > changeTo) continue
    for (const marker of [span.first, span.last]) {
      for (let i = marker.from; i < marker.to; i++) masked[i - changeFrom] = true
    }
    styles.push({ from: span.first.to, to: span.last.from,
      open: text.slice(span.first.from, span.first.to),
      close: text.slice(span.last.from, span.last.to), kind: span.node.name })
  }
  const positions = new Array<number>(line.length + 1).fill(0)
  let plain = ''
  for (let i = 0; i < line.length; i++) {
    positions[i + 1] = positions[i] + (masked[i] ? 0 : 1)
    if (!masked[i]) plain += line[i]
  }
  const chosen = { from: positions[from - changeFrom]!, to: positions[to - changeFrom]! }
  const remaining = styles.flatMap((style) => {
    const start = positions[style.from - changeFrom]!
    const end = positions[style.to - changeFrom]!
    if (end <= chosen.from || start >= chosen.to) return [{ from: start, to: end,
      open: style.open, close: style.close }]
    return [
      { from: start, to: Math.min(end, chosen.from) },
      { from: Math.max(start, chosen.to), to: end },
    ].filter((item) => item.from < item.to)
      .map((item) => ({ ...item, ...(
        style.kind === 'InlineCode' ? codeSpanMarkers(plain.slice(item.from, item.to))
          : { open: style.open, close: style.close }) }))
  })
  const opens = new Map<number, typeof remaining>()
  const closes = new Map<number, typeof remaining>()
  for (const style of remaining) {
    opens.set(style.from, [...(opens.get(style.from) ?? []), style])
    closes.set(style.to, [...(closes.get(style.to) ?? []), style])
  }
  let rendered = ''
  for (let pos = 0; pos <= plain.length; pos++) {
    for (const style of (closes.get(pos) ?? []).sort((a, b) => b.from - a.from)) rendered += style.close
    for (const style of (opens.get(pos) ?? []).sort((a, b) => b.to - a.to)) rendered += style.open
    if (pos < plain.length) rendered += plain[pos]
  }
  return rendered === line ? null : { from: changeFrom, to: changeTo, insert: rendered }
}

function clearInlinePlan(text: string, range: FormatSelection, root: SyntaxNode): FormatPlan | null {
  let { from, to } = range
  if (from === to) {
    const active = nodesAt(root, from).find((node) =>
      Object.values(INLINE).some((config) => config?.node === node.name))
    if (!active?.firstChild || !active.lastChild) return null
    from = active.firstChild.to
    to = active.lastChild.from
  }
  const changes: FormatChange[] = []
  let lineFrom = text.lastIndexOf('\n', from - 1) + 1
  while (lineFrom <= to) {
    const eol = text.indexOf('\n', lineFrom)
    const lineTo = eol < 0 ? text.length : eol
    const partFrom = Math.max(lineFrom, from)
    const partTo = Math.min(lineTo, to)
    if (partFrom < partTo) {
      const change = clearInlineLine(text, root, lineFrom, lineTo, partFrom, partTo)
      if (change) changes.push(change)
    }
    if (eol < 0 || eol >= to) break
    lineFrom = eol + 1
  }
  return changes.length ? { changes } : null
}

function wordRange(text: string, pos: number): FormatSelection | null {
  const lineFrom = text.lastIndexOf('\n', pos - 1) + 1
  const breakAt = text.indexOf('\n', pos)
  const lineTo = breakAt < 0 ? text.length : breakAt
  const line = text.slice(lineFrom, lineTo)
  const offset = pos - lineFrom
  const Segmenter = Intl.Segmenter
  if (Segmenter) {
    const segments = [...new Segmenter(undefined, { granularity: 'word' }).segment(line)]
      .filter((segment) => segment.isWordLike)
    const right = segments.find((segment) => segment.index <= offset &&
      segment.index + segment.segment.length > offset || segment.index === offset)
    const left = segments.find((segment) => segment.index + segment.segment.length === offset)
    const picked = right ?? (offset === line.length ? left : null)
    if (picked) return { from: lineFrom + picked.index, to: lineFrom + picked.index + picked.segment.length }
  }
  // 仅旧运行时缺少 Segmenter 时降级；VSCode 1.86 的 Chromium 运行时有该 API。
  const regex = /[\p{L}\p{N}_]+/gu
  for (const match of line.matchAll(regex)) {
    const start = match.index
    const end = start + match[0].length
    if (start <= offset && offset < end || offset === line.length && end === offset) {
      return { from: lineFrom + start, to: lineFrom + end }
    }
  }
  return null
}

function codeDelimiter(content: string): string {
  return '`'.repeat(Math.max(1, ...[...content.matchAll(/`+/gu)].map((match) => match[0].length + 1)))
}

/** 节点区间内 mark 的全部非重叠出现（#107）：贴边包裹产物被解析为合并
 *  节点时，中间那对标记是字面内容文本，「两对各自的标记位置」不在语法树
 *  里，只能按 INLINE[op].mark 做形态学扫描（非重叠贪心，从表派生，
 *  不按操作名写死，保持登记即继承）。 */
function markOccurrences(text: string, span: SyntaxNode, mark: string): FormatSelection[] {
  const found: FormatSelection[] = []
  let pos = span.from
  while (pos + mark.length <= span.to) {
    if (text.startsWith(mark, pos)) {
      found.push({ from: pos, to: pos + mark.length })
      pos += mark.length
    } else {
      pos += 1
    }
  }
  return found
}

/** 贴边合并形态判定（#107 审查修复）：mark 出现序列可还原为「贴边包裹
 *  产物」当且仅当两两配对后，每对内部有内容（开.to < 闭.from）且相邻
 *  对零间隙（前闭.to === 后开.from）。inlineCode 变长定界按静态单 mark
 *  扫出的「对」内部无内容，内容含字面 mark 的序列对间有间隙——均非
 *  贴边形态，取消回退整节点摘除；校验只看形态，不感知定界符变长，
 *  也不接入 per-op marker 函数（保持从 INLINE[op].mark 派生的路径级承诺）。 */
function adjacentMergedMarks(marks: FormatSelection[]): boolean {
  if (marks.length <= 2 || marks.length % 2 !== 0) return false
  for (let pair = 0; pair < marks.length / 2; pair++) {
    if (marks[2 * pair]!.to >= marks[2 * pair + 1]!.from) return false
    if (pair > 0 && marks[2 * pair - 1]!.to !== marks[2 * pair]!.from) return false
  }
  return true
}

/** 取消计划（#107）：单对整节点摘除；贴边合并形态（贴边包裹产物，经
 *  adjacentMergedMarks 校验）按 mark 出现顺序配对还原用户意图模型，只拆
 *  光标所在对、其余保留。归属取第一个闭标记仍在光标右侧的对；两对间零
 *  宽缝隙与最末闭标记之后（贴邻右外侧）分别归右、归最后一对，与 nodesAt
 *  右向原则一致。非贴边形态（变长定界、内容含字面 mark 的偶数序列、奇数
 *  残缺）无从可靠配对，一律回退整拆。 */
function unwrapSpanPlan(text: string, active: SyntaxNode, pos: number, mark: string): FormatPlan | null {
  const first = active.firstChild
  const last = active.lastChild
  if (!first || !last) return null
  const marks = markOccurrences(text, active, mark)
  if (adjacentMergedMarks(marks)) {
    let target = marks.length / 2 - 1
    for (let pair = 0; pair < marks.length / 2; pair++) {
      if (pos < marks[2 * pair + 1]!.from) { target = pair; break }
    }
    return { changes: [
      { from: marks[2 * target]!.from, to: marks[2 * target]!.to, insert: '' },
      { from: marks[2 * target + 1]!.from, to: marks[2 * target + 1]!.to, insert: '' },
    ] }
  }
  return { changes: [{ from: active.from, to: active.to,
    insert: text.slice(first.to, last.from) }] }
}

function inlinePlan(text: string, op: FormatOperationId, range: FormatSelection,
  root: SyntaxNode, action: FormatAction): FormatPlan | null {
  const config = INLINE[op]!
  let { from, to } = range
  if (blockedInline(root, from, to, config.node)) return null
  const isCursor = from === to
  const word = isCursor && action !== 'remove' ? wordRange(text, from) : null
  // 围栏内优先取消（现状语义）；贴邻即取消只在「取不到词」时接管
  // （#107）：能取到词的贴邻位置（`**加粗**普通` 光标在普通处）按场景
  // 一扩词包裹，mark 边界（行首 `|**词**`、行尾 `**词**|`）才切换为取消。
  const active = matchingSpan(root, config.node, from, to) ??
    (isCursor && action !== 'remove' && !word ? adjacentSpan(root, config.node, from) : null)
  if (isCursor && active) {
    if (action === 'add') return null
    return unwrapSpanPlan(text, active, from, config.mark)
  }
  // 无选区扩词包裹时光标须落进开围栏内侧，下一次切换才能命中上方取消分支。
  let wordWrapped = false
  let selection: { anchor: number } | undefined
  if (isCursor) {
    if (action === 'remove') return null
    if (word) { from = word.from; to = word.to; wordWrapped = true }
  }
  const mark = op === 'inlineCode' ? codeDelimiter(text.slice(from, to)) : config.mark
  if (from === to) {
    return { changes: [{ from, to, insert: mark + mark }],
      selection: { anchor: from + mark.length } }
  }
  const changes: FormatChange[] = []
  let lineFrom = text.lastIndexOf('\n', from - 1) + 1
  while (lineFrom <= to) {
    const lineBreak = text.indexOf('\n', lineFrom)
    const lineTo = lineBreak < 0 ? text.length : lineBreak
    const partFrom = Math.max(from, lineFrom)
    const partTo = Math.min(to, lineTo)
    if (partFrom < partTo) {
      const line = text.slice(lineFrom, lineTo)
      const prefix = /^(\s*(?:#{1,6}\s+|(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?|>\s*))/u.exec(line)?.[0].length ?? 0
      const start = Math.max(partFrom, lineFrom + prefix)
      if (start < partTo && !blockedInline(root, start, partTo, config.node)) {
        let change: FormatChange | null = null
        // 真重叠才走行级重写（开区间相交，#107）：贴边相邻（选区与既有
        // 围栏零字符交叠）改走下方 fresh-wrap，扩词包裹的 selection 才不
        // 会被 rewrite 吞掉
        if (inlineSpans(root, config.node, lineFrom, lineTo).some((span) =>
          span.to > start && span.from < partTo)) {
          change = rewriteInlineLine(text, root, config.node, mark,
            lineFrom, lineTo, start, partTo, action)
        } else if (action !== 'remove') {
          const content = text.slice(start, partTo)
          const markers = op === 'inlineCode' ? codeSpanMarkers(content)
            : { open: mark, close: mark }
          change = { from: start, to: partTo,
            insert: markers.open + content + markers.close }
          if (wordWrapped) selection = { anchor: start + markers.open.length }
        }
        if (change) changes.push(change)
      }
    }
    if (lineBreak < 0 || lineBreak >= to) break
    lineFrom = lineBreak + 1
  }
  return changes.length ? { changes, ...(selection ? { selection } : {}) } : null
}

function linePlan(text: string, op: FormatOperationId, range: FormatSelection): FormatPlan | null {
  const lines: FormatChange[] = []
  let start = text.lastIndexOf('\n', range.from - 1) + 1
  while (start <= range.to) {
    const eol = text.indexOf('\n', start)
    const end = eol < 0 ? text.length : eol
    if (start < range.to || range.from === range.to) {
      const line = text.slice(start, end)
      if (line.trim()) {
        const indent = /^\s*/u.exec(line)![0]
        const body = line.slice(indent.length)
        const heading = /^(?:#{1,6}\s+|[^\n]+\n[=-]+$)/u.exec(body)
        const clean = body.replace(/^#{1,6}\s+/u, '')
          .replace(/^(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/u, '')
          .replace(/^>\s?/u, '')
        let next = line
        if (op.startsWith('heading')) {
          const level = op === 'headingNone' ? 0 : Number(op.slice(7))
          next = indent + (level ? '#'.repeat(level) + ' ' : '') +
            (op === 'headingNone' ? clean : clean)
          if (op === 'headingNone' && !heading) next = line
        } else if (op === 'bulletList') next = indent +
          (/^[-+*]\s+(?!\[[ xX]\]\s)/u.test(body) ? clean : '- ' + clean)
        else if (op === 'orderedList') next = indent +
          (/^\d+[.)]\s+/u.test(body) ? clean : '1. ' + clean)
        else if (op === 'taskList') next = indent +
          (/^[-+*]\s+\[[ xX]\]\s+/u.test(body) ? clean : '- [ ] ' + clean)
        else if (op === 'quote') next = indent +
          (/^>\s?/u.test(body) ? clean : '> ' + clean)
        if (next !== line) lines.push({ from: start, to: end, insert: next })
      }
    }
    if (eol < 0 || eol >= range.to) break
    start = eol + 1
  }
  return lines.length ? { changes: lines } : null
}

function fencePlan(text: string, op: 'codeBlock' | 'blockMath', range: FormatSelection, root: SyntaxNode): FormatPlan | null {
  let { from, to } = range
  const selected = from !== to
  const initialNodes = nodesAt(root, from)
  const inTable = initialNodes.some((node) => node.name === 'TableCell' || node.name === 'TableHeader' || node.name === 'Table')
  if (inTable) return null
  const inList = initialNodes.some((node) => node.name === 'ListItem')
  const inQuote = initialNodes.some((node) => node.name === 'Blockquote')
  const unwrap = (node: SyntaxNode): FormatPlan | null => {
    const lines = text.slice(node.from, node.to).split('\n')
    if (lines.length < 3) return null
    const lineStart = text.lastIndexOf('\n', node.from - 1) + 1
    const prefix = text.slice(lineStart, node.from)
    const continuation = inQuote ? prefix : inList ? ' '.repeat(prefix.length) : ''
    const content = lines.slice(1, -1).map((line) =>
      line.startsWith(continuation) ? line.slice(continuation.length) : line)
    return { changes: [{ from: node.from, to: node.to,
      insert: content.join('\n' + continuation) }] }
  }
  if (op === 'codeBlock' && selected) {
    const fence = initialNodes.find((node) => node.name === 'FencedCode')
    if (fence && from === fence.from && to === fence.to) return unwrap(fence)
  }
  if (!selected) {
    if (op === 'blockMath') {
      const math = [...initialNodes].reverse().find((node) => node.name === 'Paragraph')
      if (math) {
        const lines = text.slice(math.from, math.to).split('\n')
        const last = lines.at(-1)?.replace(/^\s*>\s?|^\s+/u, '')
        if (lines.length >= 3 && lines[0] === '$$' && last === '$$') return unwrap(math)
      }
    }
    const fence = initialNodes.find((node) => node.name === 'FencedCode')
    if (op === 'codeBlock' && fence) {
      const plan = unwrap(fence)
      if (plan) return plan
    }
    const paragraph = [...initialNodes].reverse().find((node) => node.name === 'Paragraph')
    if (paragraph) { from = paragraph.from; to = paragraph.to }
  }
  if (selected && (inList || inQuote)) {
    const kind = inList ? 'ListItem' : 'Blockquote'
    const startContainer = initialNodes.find((node) => node.name === kind)
    const endContainer = nodesAt(root, Math.max(from, to - 1)).find((node) => node.name === kind)
    if (!startContainer || !endContainer || startContainer.from !== endContainer.from ||
        startContainer.to !== endContainer.to) return null
    const sourceFrom = text.lastIndexOf('\n', from - 1) + 1
    const eol = text.indexOf('\n', to)
    const sourceTo = eol < 0 ? text.length : eol
    const source = text.slice(sourceFrom, sourceTo)
    const match = /^(\s*(?:[-+*]|\d+[.)])\s+|\s*>\s?)/u.exec(source)
    if (match && from >= sourceFrom + match[0].length) {
      const prefix = match[0]
      const continuation = inQuote ? '> ' : ' '.repeat(prefix.length)
      const separator = inQuote ? '\n>\n' : '\n\n'
      const left = text.slice(sourceFrom + prefix.length, from)
      const picked = text.slice(from, to)
      const right = text.slice(to, sourceTo)
      const marker = op === 'blockMath' ? '$$' : '`'.repeat(Math.max(3,
        ...[...picked.matchAll(/`+/gu)].map((m) => m[0].length + 1)))
      const replacement = (left ? prefix + left + separator + continuation + marker : prefix + marker) +
        '\n' + continuation + picked + '\n' + continuation + marker +
        (right ? separator + continuation + right : '')
      return { changes: [{ from: sourceFrom, to: sourceTo, insert: replacement }] }
    }
  }
  if (!selected && (inList || inQuote)) {
    const sourceFrom = text.lastIndexOf('\n', from - 1) + 1
    const source = text.slice(sourceFrom, to)
    const match = /^(\s*(?:[-+*]|\d+[.)])\s+|\s*>\s?)/u.exec(source)
    if (match) {
      const prefix = match[0]
      const content = source.slice(prefix.length)
      const marker = op === 'blockMath' ? '$$' : '`'.repeat(Math.max(3,
        ...[...content.matchAll(/`+/gu)].map((m) => m[0].length + 1)))
      const continuation = inQuote ? prefix : ' '.repeat(prefix.length)
      return { changes: [{ from: sourceFrom, to,
        insert: prefix + marker + '\n' + continuation + content + '\n' + continuation + marker }] }
    }
  }
  const content = text.slice(from, to)
  const marker = op === 'blockMath' ? '$$' : '`'.repeat(Math.max(3, ...[...content.matchAll(/`+/gu)].map((m) => m[0].length + 1)))
  const left = text.slice(0, from)
  const right = text.slice(to)
  const lineFrom = left.lastIndexOf('\n') + 1
  const leading = left.slice(lineFrom)
  const nextBreak = right.indexOf('\n')
  const trailing = nextBreak < 0 ? right : right.slice(0, nextBreak)
  const atLineStart = leading.length === 0
  const atLineEnd = trailing.length === 0
  const leftBreak = atLineStart ? (left && !left.endsWith('\n\n') ? '\n' : '') : '\n\n'
  const rightBreak = atLineEnd ? (right && !right.startsWith('\n\n') ? '\n' : '') : '\n\n'
  const wrapped = marker + '\n' + content + '\n' + marker
  return { changes: [{ from, to, insert: leftBreak + wrapped + rightBreak }],
    ...(content ? {} : { selection: { anchor: from + leftBreak.length + marker.length + 1 } }) }
}

/** 分割线插入（#106）：块级插入、无两态语义。光标所在行的左右文字各自
 *  成段，分割线前后各留一空行（已有空行不叠加，口径对齐 tableCreate）；
 *  选区折叠到起点——选区内容（含跨行选区的中间行）保留在分割线之后，
 *  与 fencePlan 等兄弟插入操作的保留口径一致；光标落在分割线行尾——
 *  该行是控制域（触及显源码），插入后立即可续改。 */
function horizontalRulePlan(text: string, range: FormatSelection): FormatPlan {
  const lineStart = text.lastIndexOf('\n', range.from - 1) + 1
  const nextBreak = text.indexOf('\n', range.to)
  const lineEnd = nextBreak < 0 ? text.length : nextBreak
  const before = text.slice(0, lineStart)
  const after = text.slice(lineEnd)
  const left = text.slice(lineStart, range.from)
  const right = text.slice(range.from, lineEnd)
  const leftText = left.trim() ? left : ''
  const rightText = right.trim() ? right : ''
  const previousLine = before.endsWith('\n') ? before.slice(0, -1).split('\n').at(-1) ?? '' : ''
  const nextLine = after.startsWith('\n') ? after.slice(1).split('\n', 1)[0] ?? '' : ''
  const prefix = leftText ? `${leftText}\n\n` : previousLine.trim() ? '\n' : ''
  const suffix = rightText ? `\n\n${rightText}` : nextLine.trim() ? '\n' : ''
  const marker = '---'
  return {
    changes: [{ from: lineStart, to: lineEnd, insert: prefix + marker + suffix }],
    selection: { anchor: lineStart + prefix.length + marker.length },
  }
}

/** HTML 注释两态规划（#139）：插入型结构（同 wikilink 一类分派，不走
 *  INLINE 表），取消分支为本规格新增设计。
 *  节点命中（Lezer markdown 实测钉住，契约测试 formatOperations.test.ts）：
 *  行内位置的 `<!-- x -->` 产出 Comment、整段（可跨行）产出 CommentBlock；
 *  无内容空对 `<!---->` 不产节点——空插形态带一个空格（`<!-- -->`）保持
 *  Comment 解析，两态闭环成立。`<div>` 等真 HTML 块整体是 HTMLBlock，
 *  内部注释不可达：维持 HTMLBlock 既有「格式操作禁用上下文」语义不放宽
 *  （注释操作在注释块内可取消 = Comment/CommentBlock 不在禁用集，天然
 *  满足；真 HTML 块内不接管）。 */
const HTML_COMMENT_OPEN = '<!--'
const HTML_COMMENT_CLOSE = '-->'
const HTML_COMMENT_BLOCKED = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'HTMLBlock'])

function htmlCommentPlan(text: string, range: FormatSelection,
  root: SyntaxNode, action: FormatAction): FormatPlan | null {
  const { from, to } = range
  // 代码上下文与真 HTML 块内不接管（围栏/缩进/行内代码保持字面语义，
  // 与其余格式操作的禁用口径一致；frontmatter 裸解析器不识别，与既有
  // 插入型操作同口径不加特判）
  for (const pos of [from, Math.max(from, to - 1)]) {
    if (nodesAt(root, pos).some((node) => HTML_COMMENT_BLOCKED.has(node.name))) return null
  }
  // 取消：光标严格在注释内部（matchingSpan 同款口径——[from+1, to-1]
  // 全程命中，空对插入后的光标即落在该区间），或选区与注释节点区间完全
  // 重合（link 先例同款；matchingSpan 的严格内部条件覆盖不了重合，经
  // inlineSpans 显式找重合节点）
  const exactCover = (name: string): SyntaxNode | null => {
    for (const node of inlineSpans(root, name, from, to)) {
      if (node.from === from && node.to === to) return node
    }
    return null
  }
  const active = matchingSpan(root, 'Comment', from, to) ??
    matchingSpan(root, 'CommentBlock', from, to) ??
    (from === to ? null : exactCover('Comment') ?? exactCover('CommentBlock'))
  if (active && (from === to || from === active.from && to === active.to)) {
    if (action === 'add') return null
    const content = text.slice(active.from + HTML_COMMENT_OPEN.length,
      active.to - HTML_COMMENT_CLOSE.length)
    // 空对（内容纯空白）取消：行内删整节点（无残留空格）；块级（内容
    // 含 \n）与非空内容一样只剥定界符——行结构不因取消而坍缩
    if (content.trim() === '' && !content.includes('\n')) {
      return { changes: [{ from: active.from, to: active.to, insert: '' }] }
    }
    return { changes: [
      { from: active.from, to: active.from + HTML_COMMENT_OPEN.length, insert: '' },
      { from: active.to - HTML_COMMENT_CLOSE.length, to: active.to, insert: '' },
    ] }
  }
  // 插入：无选区插空对（带空格保 Comment 解析），光标落开围栏内侧
  // （锚点按 open 长度 4 从实际定界符计算）；有选区包裹并保持原文选中
  const value = text.slice(from, to)
  const open = HTML_COMMENT_OPEN
  const close = value ? HTML_COMMENT_CLOSE : ` ${HTML_COMMENT_CLOSE}`
  return { changes: [{ from, to, insert: open + value + close }],
    selection: value
      ? { anchor: from + open.length, head: from + open.length + value.length }
      : { anchor: from + open.length } }
}


export function planFormatOperation(
  text: string, op: FormatOperationId, range: FormatSelection, region?: TableRegion | null,
  action: FormatAction = 'toggle',
): FormatPlan | null {
  if (range.from < 0 || range.to < range.from || range.to > text.length) return null
  // 与 liveDecorations/outline 同一解析器（markdownTreeParser 含 #105
  // Highlight 扩展）：两态切换按节点命中依赖同一语义源
  const root = markdownTreeParser.parse(text).topNode
  if (region) {
    if (!isInlineFormatOp(op)) return null
    const offsets: number[] = []
    let cursor = region.tableFrom
    while (cursor <= text.length && offsets.length < region.rowTo + 3) {
      offsets.push(cursor)
      const eol = text.indexOf('\n', cursor)
      if (eol < 0) break
      cursor = eol + 1
    }
    const delimiter = offsets[1] === undefined ? '' : text.slice(offsets[1], text.indexOf('\n', offsets[1]) < 0
      ? text.length : text.indexOf('\n', offsets[1]))
    const columns = parseTableDelimiter(delimiter)?.length
    if (!columns || region.columnTo >= columns) return null
    const changes: FormatChange[] = []
    for (let row = region.rowFrom; row <= region.rowTo; row++) {
      const at = offsets[row === 0 ? 0 : row + 1]
      if (at === undefined) return null
      const eol = text.indexOf('\n', at)
      const line = text.slice(at, eol < 0 ? text.length : eol)
      const cells = tableRowCellsForColumns(line, at, columns)
      if (!cells) return null
      for (let col = region.columnFrom; col <= region.columnTo; col++) {
        const cell = cells[col]
        if (!cell) return null
        const cellText = text.slice(cell.contentFrom, cell.contentTo)
        const plan = planFormatOperation(cellText, op, { from: 0, to: cellText.length }, null, action)
        if (plan?.changes.length) {
          let rewritten = cellText
          for (const change of [...plan.changes].reverse()) {
            rewritten = rewritten.slice(0, change.from) + change.insert + rewritten.slice(change.to)
          }
          changes.push({ from: cell.contentFrom, to: cell.contentTo, insert: rewritten })
        }
      }
    }
    return changes.length ? { changes: changes.sort((a, b) => a.from - b.from) } : null
  }
  if (INLINE[op]) return inlinePlan(text, op, range, root, action)
  if (op === 'clearInline') return clearInlinePlan(text, range, root)
  if (op === 'codeBlock' || op === 'blockMath') return fencePlan(text, op, range, root)
  if (op === 'horizontalRule') return horizontalRulePlan(text, range)
  if (op === 'htmlComment') return htmlCommentPlan(text, range, root, action)
  if (op.startsWith('heading')) {
    const setext = nodesAt(root, range.from).find((node) => /^SetextHeading[12]$/u.test(node.name))
    if (setext && (range.from === range.to || range.to <= setext.to)) {
      const level = Number(setext.name.at(-1))
      const target = op === 'headingNone' ? 0 : Number(op.slice(7))
      if (level === target) return null
      const heading = text.slice(setext.from, setext.to).split('\n')[0]!
      return { changes: [{ from: setext.from, to: setext.to,
        insert: target ? '#'.repeat(target) + ' ' + heading : heading }] }
    }
  }
  if (op.startsWith('heading') || op === 'bulletList' || op === 'orderedList' ||
      op === 'taskList' || op === 'quote') return linePlan(text, op, range)
  if (op === 'link' || op === 'inlineMath' || op === 'wikilink') {
    let { from, to } = range
    if (op === 'link') {
      const link = nodesAt(root, from).find((node) => node.name === 'Link')
      if (link && (from === to || from === link.from && to === link.to)) {
        const closeLabel = link.firstChild?.nextSibling
        if (closeLabel?.name === 'LinkMark') {
          return { changes: [{ from: link.from, to: link.to,
            insert: text.slice(link.from + 1, closeLabel.from) }] }
        }
      }
      if (from === to) {
        const word = wordRange(text, from)
        if (word) { from = word.from; to = word.to }
      }
    }
    const value = text.slice(from, to)
    const open = op === 'link' ? '[' : op === 'wikilink' ? '[[' : '$'
    const close = op === 'link' ? ']()' : op === 'wikilink' ? ']]' : '$'
    return { changes: [{ from, to, insert: open + value + close }],
      selection: value ? op === 'link' ? { anchor: from + open.length + value.length + 2 }
        : { anchor: from + open.length, head: from + open.length + value.length }
        : { anchor: from + open.length } }
  }
  return null
}

/** 行内包裹类格式操作判定（#240）：INLINE 表五项 + 清除行内格式 + 三种
 *  插入型行内包裹（link / inlineMath / wikilink）。与表格格区白名单
 *  同源（格区批量路径即「逐格逐 range 应用」的既有先例）——多选区下
 *  这类操作逐 range 应用；标题、列表、引用、围栏、分割线、HTML 注释
 *  等结构性操作退化主 range（planOnlyIndex 指向主 range）。 */
export function isInlineFormatOp(op: FormatOperationId): boolean {
  return !!INLINE[op] || op === 'clearInline' || op === 'link' ||
    op === 'inlineMath' || op === 'wikilink'
}

/** 多 range 逐段规划产物（#240）：changes 为原文坐标；selections 与入参
 *  ranges 按下标对齐且坐标为**终文坐标**（已叠加该 range 之前全部已接受
 *  变更的净位移），可直接落入产物选区。null 表示该 range 无独立产物选区
 *  （未参与规划、无变更或变更被重叠保护丢弃）——调用方以原生选区 range
 *  经 ChangeSet 映射（等价复刻单 range 路径「不带 selection 时 CM6 自动
 *  映射」的语义）。 */
export interface MultiFormatPlan {
  changes: FormatChange[]
  selections: Array<{ anchor: number; head?: number } | null>
}

/** 多选区逐 range 规划（#240）：行内包裹类操作的多光标形态——每个
 *  range 独立走 planFormatOperation 单 range 语义（扩词、两态取消、
 *  逐行包裹等互不干扰），变更合入一份组（单事务 = 一笔 edit.request =
 *  宿主撤销一次整批回退，与 #124 跨段包裹同构）。
 *  planOnlyIndex（结构性操作退化主 range）：只规划该下标的 range，其余
 *  range 保持原样（selections 记 null，调用方原样映射——多光标形态
 *  不因退化而收敛）。
 *  边界：变更与已收集区间**严格重叠**（from < 占用区 to）的 range 丢弃
 *  其变更（同一行内独立计划的重写区间可能交叠，无从可靠合并——保守
 *  跳过，产物选区退化为原 range 映射）；端点相接（前 to === 后 from）
 *  不算重叠。格区 region 与多 range 互斥（region 状态机维持单选区），
 *  本函数不接收 region。 */
export function planFormatOperationRanges(
  text: string, op: FormatOperationId, ranges: readonly FormatSelection[],
  action: FormatAction = 'toggle',
  planOnlyIndex?: number,
): MultiFormatPlan | null {
  if (ranges.length === 0) return null
  const changes: FormatChange[] = []
  const selections: Array<{ anchor: number; head?: number } | null> =
    new Array(ranges.length).fill(null)
  // 已收集变更的占用右边界（原文坐标，粗粒度：同一 range 内部变更由
  // 单 range 计划自洽，跨 range 只需防交叠——处理序按 range from 升序，
  // 记录已接受变更的最大 to 即可）
  let usedTo = -Infinity
  // 已接受变更的累计净位移：把「仅本 range 变更」视角的产物选区换算成
  // 全部变更依序应用后的终文坐标（不重叠保证：此前 range 的变更区间
  // 都在本 range 之前，位移直接累加）
  let deltaBefore = 0
  const order = ranges.map((range, index) => ({ range, index }))
    .sort((a, b) => a.range.from - b.range.from)
  for (const { range, index } of order) {
    if (planOnlyIndex !== undefined && index !== planOnlyIndex) continue
    const plan = planFormatOperation(text, op, range, null, action)
    if (!plan || !plan.changes.length) continue
    const from = Math.min(...plan.changes.map((change) => change.from))
    const to = Math.max(...plan.changes.map((change) => change.to))
    if (from < usedTo) {
      // 与已收集区间重叠：丢弃本 range 变更（保守），选区保持 null
      continue
    }
    changes.push(...plan.changes)
    if (plan.selection) {
      const spec = plan.selection
      selections[index] = {
        anchor: spec.anchor + deltaBefore,
        ...(spec.head !== undefined ? { head: spec.head + deltaBefore } : {}),
      }
    }
    usedTo = Math.max(usedTo, to)
    deltaBefore += plan.changes.reduce(
      (sum, change) => sum + change.insert.length - (change.to - change.from), 0)
  }
  if (!changes.length) return null
  changes.sort((a, b) => a.from - b.from)
  return { changes, selections }
}
