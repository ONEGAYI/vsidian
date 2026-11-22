import type { Range } from '@codemirror/state'
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import MarkdownIt from 'markdown-it'
import { scanMathInMarkdownLine, visitRange } from '../shared/markdownDoc'
import { hitIntersectsRange, hitRevealField } from './hitReveal'
import { inlineCompositionSelection, inlineSourceTouchesRange, liveDecorationsField } from './liveDecorations'
import { liveInlineHtmlSpansField } from './liveInlineHtml'
import { mathBlocksField } from './liveMath'

// 与阅读端使用同一 Markdown 实体规则，不把解码后的字符再解释成 HTML。
const parser = new MarkdownIt('zero').enable('entity')

class EntityWidget extends WidgetType {
  constructor(readonly decoded: string) { super() }
  eq(other: EntityWidget): boolean { return this.decoded === other.decoded }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'vsidian-inline-entity'
    span.textContent = this.decoded
    return span
  }
  ignoreEvent(): boolean { return false }
}

/** 已登记的独立片段按位置排序；避免每条可见实体遍历整篇文档的公式/HTML。 */
function inside(ranges: readonly { from: number; to: number }[], pos: number): boolean {
  let lo = 0, hi = ranges.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (ranges[mid]!.to <= pos) lo = mid + 1
    else hi = mid
  }
  return lo < ranges.length && ranges[lo]!.from <= pos
}

function build(view: EditorView): DecorationSet {
  const { state, visibleRanges } = view
  const { doc, selection } = state
  const { tree, fm } = state.field(liveDecorationsField)
  const composition = state.field(inlineCompositionSelection)
  const reveal = state.field(hitRevealField, false)
  const findHits = reveal?.findSource ?? []
  const occurrenceHits = reveal?.occSelection?.ranges ?? []
  const blockMath = state.field(mathBlocksField)
  const inlineHtml = state.field(liveInlineHtmlSpansField)
  const out: Range<Decoration>[] = []
  let lineNumber = 0, lineMath: ReturnType<typeof scanMathInMarkdownLine> = []
  for (const { from, to } of visibleRanges) {
    visitRange(tree, from, to, (node, path) => {
      if (node.name !== 'Entity' || node.from < (fm?.end ?? 0) ||
          path.some(parent => parent.name === 'Image' || parent.name === 'LinkReference') ||
          inlineSourceTouchesRange(selection, node.from, node.to, composition) ||
          hitIntersectsRange(findHits, node.from, node.to, true) ||
          hitIntersectsRange(occurrenceHits, node.from, node.to, true) ||
          inside(blockMath, node.from) || inside(inlineHtml, node.from)) return
      const line = doc.lineAt(node.from)
      if (line.number !== lineNumber) {
        lineNumber = line.number
        lineMath = scanMathInMarkdownLine(line.text, line.from, { doc, tree, fm })
      }
      if (inside(lineMath, node.from)) return
      const source = doc.sliceString(node.from, node.to)
      const decoded = parser.parseInline(source, {})[0]!.children![0]!.content
      if (decoded !== source) out.push(Decoration.replace({ widget: new EntityWidget(decoded) }).range(node.from, node.to))
    })
  }
  return Decoration.set(out, true)
}

/** 实时预览只物化视口内的 Markdown 实体；触及范围后恢复原文编辑。 */
export const liveEntities = ViewPlugin.fromClass(class {
  decorations: DecorationSet
  constructor(view: EditorView) { this.decorations = build(view) }
  update(update: ViewUpdate): void {
    if (update.docChanged || update.selectionSet || update.viewportChanged ||
        update.startState.field(inlineCompositionSelection) !== update.state.field(inlineCompositionSelection) ||
        update.startState.field(hitRevealField, false) !== update.state.field(hitRevealField, false)) {
      this.decorations = build(update.view)
    }
  }
}, { decorations: plugin => plugin.decorations })
