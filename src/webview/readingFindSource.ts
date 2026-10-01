import type { FindMatch } from './findSession'
import { FIND_CLASS_NAMES } from './findSession'
import { t, onLocaleChanged } from '../shared/i18n'
import { buildLineBounds } from './readingMarkdown'
import { planHoverPopupPlacement } from './hoverPopupGeometry'

export const READING_FIND_SOURCE_CLASSES = {
  popup: 'vsidian-reading-find-source',
  header: 'vsidian-reading-find-source-header',
  location: 'vsidian-reading-find-source-location',
  readonly: 'vsidian-reading-find-source-readonly',
  code: 'vsidian-reading-find-source-code',
} as const

function lineAt(starts: readonly number[], offset: number): number {
  let low = 0, high = starts.length
  while (low + 1 < high) {
    const middle = (low + high) >>> 1
    if (starts[middle]! <= offset) low = middle
    else high = middle
  }
  return low
}

/** Find-owned, non-modal source feedback. It never enters the reading block layout. */
export class ReadingFindSource {
  private popup: HTMLElement | null = null
  private anchor: HTMLElement | null = null
  private title: HTMLElement | null = null
  private location: HTMLElement | null = null
  private readonlyLabel: HTMLElement | null = null
  private source = ''
  private bounds = { lineStarts: [] as number[], lineEnds: [] as number[] }
  private line = 0
  private column = 0
  private disposed = false
  private offLocale = onLocaleChanged(() => { this.label(); this.position() })
  private onPosition = (event?: Event) => {
    if (event?.type === 'scroll' && event.target instanceof Node && this.popup?.contains(event.target)) return
    this.position()
  }

  constructor(private container: HTMLElement) {}

  show(anchor: HTMLElement, text: string, matches: readonly FindMatch[], index: number): void {
    const current = matches[index]
    if (this.disposed || !anchor.isConnected || !current || current.to > text.length) {
      this.hide()
      return
    }
    if (this.source !== text || !this.bounds.lineStarts.length) {
      this.source = text
      this.bounds = buildLineBounds(text)
    }
    this.line = lineAt(this.bounds.lineStarts, current.from)
    const lineFrom = this.bounds.lineStarts[this.line]!
    const lineTo = this.bounds.lineEnds[this.line]!
    this.column = current.from - lineFrom
    this.anchor = anchor
    // A table's delimiter row has no DOM row; use its header as the anchor.
    if (anchor.classList.contains('vsidian-reading-table')) {
      const blockLine = lineAt(this.bounds.lineStarts, Number(anchor.dataset['vsidianSrcStart']))
      const row = Math.max(0, this.line - blockLine - 1)
      this.anchor = anchor.querySelectorAll<HTMLElement>('tr')[row] ?? anchor
    }
    if (!this.popup) this.create()
    const code = this.popup!.querySelector('code')!
    code.replaceChildren()
    // Bound long-line feedback around the current hit without splitting a surrogate pair.
    let start = Math.max(lineFrom, current.from - 60)
    let end = Math.min(lineTo, start + 320)
    if (/^[\uDC00-\uDFFF]$/.test(text[start] ?? '')) start--
    if (/^[\uDC00-\uDFFF]$/.test(text[end] ?? '')) end++
    if (current.from <= lineTo && current.to > lineTo && lineTo < text.length && end === lineTo) end++
    if (start > lineFrom) code.append(document.createTextNode('...'))
    let at = start, low = 0, high = matches.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (matches[middle]!.to <= start) low = middle + 1
      else high = middle
    }
    const appendText = (from: number, to: number) => document.createTextNode(text.slice(from, to).replace(/\n/g, '\\n'))
    for (let i = low; i < matches.length && matches[i]!.from < end; i++) {
      const match = matches[i]!
      const from = Math.max(start, match.from), to = Math.min(end, match.to)
      code.append(appendText(at, from))
      const mark = document.createElement('span')
      mark.className = FIND_CLASS_NAMES.match + (i === index ? ` ${FIND_CLASS_NAMES.matchCurrent}` : '')
      mark.dataset['vsidianFindIndex'] = String(i)
      mark.append(appendText(from, to))
      code.append(mark)
      at = to
    }
    code.append(appendText(at, end))
    if (end < lineTo || current.to > end) code.append(document.createTextNode('...'))
    this.label()
    this.position()
  }

  hide(): void {
    this.popup?.remove()
    this.popup = this.anchor = this.title = this.location = this.readonlyLabel = null
    window.removeEventListener('scroll', this.onPosition, true)
    window.removeEventListener('resize', this.onPosition)
  }

  dispose(): void {
    this.disposed = true
    this.hide()
    this.offLocale()
  }

  private create(): void {
    const popup = document.createElement('aside')
    popup.className = READING_FIND_SOURCE_CLASSES.popup
    popup.setAttribute('role', 'region')
    const header = document.createElement('div')
    header.className = READING_FIND_SOURCE_CLASSES.header
    this.title = document.createElement('span')
    this.location = document.createElement('span')
    this.location.className = READING_FIND_SOURCE_CLASSES.location
    this.readonlyLabel = document.createElement('span')
    this.readonlyLabel.className = READING_FIND_SOURCE_CLASSES.readonly
    header.append(this.title, this.location, this.readonlyLabel)
    const pre = document.createElement('pre')
    pre.className = READING_FIND_SOURCE_CLASSES.code
    pre.append(document.createElement('code'))
    popup.append(header, pre)
    ;(this.container.closest('#app') ?? this.container.parentElement ?? document.body).append(popup)
    this.popup = popup
    window.addEventListener('scroll', this.onPosition, true)
    window.addEventListener('resize', this.onPosition)
  }

  private label(): void {
    if (!this.popup) return
    this.title!.textContent = t('find.sourceHit')
    this.readonlyLabel!.textContent = t('find.sourceReadonly')
    this.location!.textContent = t('find.sourceLocation', { line: this.line + 1, column: this.column + 1 })
    this.popup.setAttribute('aria-label', `${t('find.sourceHit')} ${this.location!.textContent}`)
  }

  private position(): void {
    if (!this.popup || !this.anchor) return
    if (!this.anchor.isConnected) { this.hide(); return }
    const anchorBox = this.anchor.getBoundingClientRect()
    const box = this.anchor === this.container
      ? { left: anchorBox.left, right: anchorBox.right, top: anchorBox.top, bottom: anchorBox.top + 1 }
      : anchorBox
    const container = this.container.getBoundingClientRect()
    const find = this.container.closest('#app')?.querySelector('.vsidian-find-open')?.getBoundingClientRect()
    const top = Math.max(0, container.top, find?.bottom ?? 0)
    const bottom = Math.min(window.innerHeight, container.bottom)
    // No-layout unit environments still expose source content; real offscreen anchors hide.
    if (container.height > 0 && (box.bottom <= Math.max(0, container.top) || box.top >= bottom || bottom <= top)) {
      this.popup.hidden = true
      return
    }
    this.popup.hidden = false
    this.popup.style.height = ''
    this.popup.style.width = `${Math.max(1, Math.min(420, window.innerWidth - 16))}px`
    const height = Math.min(160, this.popup.getBoundingClientRect().height || 80)
    const availableTop = container.height > 0 ? top : 0
    const availableBottom = container.height > 0 ? bottom : window.innerHeight
    const placement = planHoverPopupPlacement({
      anchor: { left: box.left, right: box.right, top: Math.max(0, box.top - availableTop), bottom: Math.max(0, Math.min(availableBottom - availableTop, box.bottom - availableTop)) },
      viewport: { width: window.innerWidth, height: availableBottom - availableTop },
      size: { width: 420, height },
    })
    this.popup.style.left = `${placement.left}px`
    this.popup.style.top = `${placement.top + availableTop}px`
    this.popup.style.width = `${placement.width}px`
    this.popup.style.height = `${placement.height}px`
  }
}
