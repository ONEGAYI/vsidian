import type { FindMatch } from './findSession'
import { FIND_CLASS_NAMES } from './findSession'
import { hasReadingReference, type ReadingBlock } from './readingBlocks'
import { markdownTreeParser } from './markdownDoc'
import { stripHtmlComments } from './htmlComment'
import { stripBlockIdMarks } from './blockIdStrip'
import { scanMathRanges } from '../shared/math'
import { parseWikilinkInner, scanWikilinksInLine } from '../shared/wikilink'
import { scanLooseLinksInLine } from '../shared/looseLink'

interface Projection {
  text: string
  from: number[]
  to: number[]
}
interface Replacement { from: number; to: number; text: string; contentFrom?: number }
const projections = new WeakMap<ReadingBlock, Projection>()
const hiddenMarks = new Set([
  'HeaderMark', 'EmphasisMark', 'StrikethroughMark', 'HighlightMark',
  'CodeMark', 'CodeInfo', 'ListMark', 'QuoteMark', 'TaskMarker', 'TableDelimiter', 'LinkTitle',
])
const ignoredText = 'button, svg, .katex, .vsidian-mermaid, .vsidian-embed-card, ' +
  '.vsidian-code-card-header, .vsidian-code-card-linenumber'

function sourceProjection(block: ReadingBlock, fullText: string): Projection {
  const cached = projections.get(block)
  if (cached) return cached
  const source = fullText.slice(block.start, block.end)
  const changes: Replacement[] = []
  const literal: { from: number; to: number }[] = []
  const remove = (from: number, to: number) => changes.push({ from, to, text: '' })
  if (block.kind === 'code-block' || block.kind === 'frontmatter') {
    const holder = document.createElement('div')
    holder.innerHTML = block.html
    const pre = holder.querySelector('pre')
    const code = (pre?.textContent ?? '').replace(/\n$/, '')
    // 后续分片从正文起始，字面围栏不能重新解释为开围栏。
    const continued = Number(pre?.dataset['vsidianCodeStart'] ?? 0) > 0
    const first = continued ? null : markdownTreeParser.parse(source).topNode.firstChild
    const codeText = block.kind === 'code-block' && first?.name === 'FencedCode' ? first.getChild('CodeText') : null
    const from = continued ? 0 : codeText?.from ?? source.indexOf(code)
    const to = codeText?.to ?? from + code.length
    if (from >= 0) {
      remove(0, from)
      remove(to, source.length)
    }
  } else {
    const chars = source.split('')
    const omit = (from: number, to: number) => {
      let start = from
      for (let i = from; i < to; i++) {
        if (source[i] === '\n') { remove(start, i); start = i + 1 }
        else chars[i] = ' '
      }
      remove(start, to)
    }
    stripHtmlComments(source, omit)
    stripBlockIdMarks(chars.join(''), omit)
    const masked = chars.join('')
    const unresolved: { from: number; to: number }[] = []
    const isUnresolved = (from: number) => unresolved.some(range => range.from <= from && from < range.to)
    markdownTreeParser.parse(masked).iterate({ enter(node) {
      if (node.name === 'LinkReference') {
        const accepted = block.referenceDefinitions?.some(range =>
          range.from <= block.start + node.from && block.start + node.to <= range.to)
        if (!accepted) unresolved.push({ from: node.from, to: node.to })
      } else if ((node.name === 'Link' || node.name === 'Image') && !node.node.getChild('URL')) {
        const label = node.node.getChild('LinkLabel')
        const marks = node.node.getChildren('LinkMark')
        const explicit = label ? source.slice(label.from + 1, label.to - 1) : ''
        const implicit = marks.length >= 2 ? source.slice(marks[0]!.to, marks[1]!.from) : ''
        if (!hasReadingReference(block, explicit || implicit)) unresolved.push({ from: node.from, to: node.to })
      }
      if ((node.name === 'Image' || node.name === 'LinkReference') && !isUnresolved(node.from)) {
        remove(node.from, node.to)
        return false
      }
      if (node.name === 'InlineCode' || node.name === 'CodeText') literal.push({ from: node.from, to: node.to })
      const parent = node.node.parent
      const linkMarker = node.name === 'LinkMark' && !isUnresolved(node.from) &&
        (parent?.name === 'Autolink' || parent?.name === 'Link' || parent?.getChild('URL') || parent?.getChild('LinkLabel'))
      if ((hiddenMarks.has(node.name) && (node.name !== 'LinkTitle' || !isUnresolved(node.from))) || linkMarker ||
          (node.name === 'LinkLabel' && !isUnresolved(node.from)) ||
          (node.name === 'URL' && parent?.name !== 'Autolink' && !isUnresolved(node.from))) remove(node.from, node.to)
      if (node.name === 'Escape') {
        changes.push({ from: node.from, to: node.to, text: source.slice(node.from + 1, node.to), contentFrom: node.from + 1 })
      }
      if (node.name === 'Entity') {
        const decoder = document.createElement('textarea')
        decoder.innerHTML = source.slice(node.from, node.to)
        changes.push({ from: node.from, to: node.to, text: decoder.value })
      }
    } })
    const inLiteral = (from: number) => literal.some(range => range.from <= from && from < range.to)
    for (const math of scanMathRanges(masked.split('\n'), 0)) {
      if (!inLiteral(math.from)) remove(math.from, math.to)
    }
    let lineFrom = 0
    for (const line of masked.split('\n')) {
      for (const wiki of scanWikilinksInLine(line, lineFrom)) {
        if (inLiteral(wiki.from)) continue
        const display = parseWikilinkInner(wiki.inner)!.display
        const pipe = wiki.inner.indexOf('|')
        const contentFrom = wiki.from + 2 + (pipe >= 0 ? pipe + 1 : 0) +
          wiki.inner.slice(pipe >= 0 ? pipe + 1 : 0).indexOf(display)
        changes.push({ from: wiki.from, to: wiki.to, text: display, contentFrom })
      }
      for (const link of scanLooseLinksInLine(line, lineFrom)) {
        if (inLiteral(link.from)) continue
        if (link.image) remove(link.from, link.to)
        else {
          remove(link.from, link.labelFrom)
          remove(link.labelTo, link.to)
        }
      }
      lineFrom += line.length + 1
    }
  }
  changes.sort((a, b) => a.from - b.from || b.to - a.to)
  const projection: Projection = { text: '', from: [], to: [] }
  const append = (value: string, from: number, end?: number) => {
    projection.text += value
    for (let i = 0; i < value.length; i++) {
      projection.from.push(block.start + from + (end === undefined ? i : 0))
      projection.to.push(block.start + (end ?? from + i + 1))
    }
  }
  let at = 0
  for (const change of changes) {
    if (change.from < at) continue
    append(source.slice(at, change.from), at)
    if (change.text) append(change.text, change.contentFrom ?? change.from,
      change.contentFrom === undefined ? change.to : undefined)
    at = change.to
  }
  append(source.slice(at), at)
  projections.set(block, projection)
  return projection
}

/** Rebuild only find-owned spans. Links, tasks, and code-card elements retain their identity. */
export function highlightReadingMatches(
  el: HTMLElement, block: ReadingBlock, fullText: string, matches: readonly FindMatch[], current: number,
): boolean {
  for (const mark of Array.from(el.querySelectorAll('[data-vsidian-find-highlight]'))) {
    mark.replaceWith(...Array.from(mark.childNodes))
  }
  el.normalize()
  if (!matches.length || (block.kind === 'frontmatter' && !el.querySelector('pre')) || block.kind === 'math' ||
      block.kind === 'mermaid' || block.kind === 'embed') return false
  // Match coordinates remain source coordinates, including invisible Markdown syntax.
  let low = 0, high = matches.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (matches[middle]!.to <= block.start) low = middle + 1
    else high = middle
  }
  if (!matches[low] || matches[low]!.from >= block.end) return false
  const projection = sourceProjection(block, fullText)
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return node.parentElement?.closest(ignoredText) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    },
  })
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text)
  let sourceAt = 0
  let matchIndex = low
  const currentMatch = matches[current]
  let coveredTo = currentMatch?.from ?? -1
  for (const node of nodes) {
    if (!node.data || (!node.data.trim() && node.data.includes('\n'))) continue
    const positions: number[] = []
    let at = sourceAt
    for (const char of node.data.split('')) {
      const found = projection.text.indexOf(char, at)
      if (found < 0) {
        if (/\s/u.test(char)) { positions.push(-1); continue }
        positions.length = 0
        break
      }
      positions.push(found)
      at = found + 1
    }
    if (!positions.length) continue
    sourceAt = at
    const ranges: { from: number; to: number; index: number }[] = []
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i]!
      if (pos < 0) continue
      const from = projection.from[pos]!, to = projection.to[pos]!
      while (matches[matchIndex] && matches[matchIndex]!.to <= from) matchIndex++
      const match = matches[matchIndex]
      if (!match || match.from >= to || match.to <= from) continue
      if (matchIndex === current && from <= coveredTo) coveredTo = Math.max(coveredTo, to)
      const last = ranges[ranges.length - 1]
      if (last?.index === matchIndex && last.to === i) last.to = i + 1
      else ranges.push({ from: i, to: i + 1, index: matchIndex })
    }
    for (const range of ranges.reverse()) {
      node.splitText(range.to)
      const content = node.splitText(range.from)
      const span = document.createElement('span')
      span.className = FIND_CLASS_NAMES.match + (range.index === current ? ` ${FIND_CLASS_NAMES.matchCurrent}` : '')
      span.dataset['vsidianFindHighlight'] = 'true'
      span.dataset['vsidianFindIndex'] = String(range.index)
      content.replaceWith(span)
      span.appendChild(content)
    }
  }
  return !!currentMatch && currentMatch.from >= block.start && currentMatch.to <= block.end && coveredTo >= currentMatch.to
}
