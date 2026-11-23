// Tab/Shift+Tab 实时预览正文通用行缩进（工单 #120）：live 正文中
// 光标行（无选区）或选区覆盖各行的整行缩进。
//
// 行为（缩进单位的单一事实源在 shared/listPrefix.ts）：
// - Tab：每受影响行调整到目标缩进列；Shift+Tab 从落点删除至多一级宽度
//   的连续空白（不足全删）。列表行一级宽度对齐上方最近项的
//   内容列（未达补齐、已达加深其标记宽，#121）；同一批连续的同级项
//   沿用首项的目标列，不把一同移动的兄弟项当成父项；没有候选父项时整组不动。
//   单光标的空有序项新建子列表时，从 1 开始。
//   Shift+Tab 删至树父项标记列（顶级删全部缩进）。
//   普通行（含纯引用行、代码围栏、缩进代码块与块级公式内）
//   固定 2 空格
// - 光标/选区随缩进平移（锚点与头均向右关联映射，对齐 CM6 命令）
// - 选区内的续行和子孙项随所属项移动；未选中的行不自动携带
// - 不接管（return false 交默认）：表格行——Tab/Shift+Tab 归
//   tableEditing 的单元格导航，边界放行也不缩进表格行（不破坏表格
//   结构与「表格内导航语义优先」）；成型 frontmatter（卡片态，光标被
//   引导弹出）；IME 组合进行中。降级 frontmatter（源码态）不在其列：
//   可编辑源码按普通行缩进（#420）
// - Shift+Tab 无可删空白时仍吞键（return true）：Tab 族按键一旦在
//   Live 正文消费域内放行到 keydown 默认路径，会被宿主 webview 预加
//   载脚本转发为工作台焦点导航（焦点逃逸），故无变化也不放行
//
// 装配顺序约定：置于 tableEditing 之后、defaultKeymap（extraExtensions）
// 之前——表格上下文优先。变换单笔事务派发（一次撤销整体回退）。
import { countColumn, EditorSelection } from '@codemirror/state'
import type { EditorState, Line } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import type { Command, EditorView } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import {
  dedentCutOf,
  indentUnitOf,
  parseLinePrefix,
  tabIndentWidthOf,
  type LinePrefix,
} from '../shared/listPrefix'
import { liveDecorationsField } from './liveDecorations'
import { mathBlocksField } from './liveMath'
import { chainAt } from '../shared/markdownDoc'
import { continuePromotedNumbers, listContentCol, MARKDOWN_TAB_SIZE,
  quoteContentEdge, quoteIndentOffset, resizeListIndent } from './listEditing'

/** 表格节点：行落在其中即不接管（单元格导航优先；边界放行不缩进表格行） */
const TABLE_NODES = new Set([
  'Table', 'TableHeader', 'TableRow', 'TableDelimiter', 'TableCell',
])
/** 代码块节点：围栏/缩进代码块内同普通行语义（不做列表智能对齐） */
const CODE_NODES = new Set(['FencedCode', 'CodeText', 'CodeBlock'])
type IndentPlan = { offset: number; delta: number; restartNumber?: { from: number; to: number } }

/** 使用实际的语法树标记；一行可以同时容纳外层和内层标记。 */
function listMarkCols(
  state: EditorState,
  mark: SyntaxNode | null,
): { markCol: number; contentCol: number } | null {
  if (!mark) return null
  const line = state.doc.lineAt(mark.from)
  const start = mark.from - line.from
  const quoteCol = countColumn(line.text, MARKDOWN_TAB_SIZE, quoteContentEdge(line, mark))
  return {
    markCol: countColumn(line.text, MARKDOWN_TAB_SIZE, start) - quoteCol,
    contentCol: listContentCol(line.text, mark.to - line.from) - quoteCol,
  }
}

/** 标记不同可形成紧邻的两棵列表，但它们的项仍然同层。 */
function siblingListItem(item: SyntaxNode, dir: 1 | -1): SyntaxNode | null {
  const step = (node: SyntaxNode) => dir === 1 ? node.nextSibling : node.prevSibling
  let sibling = step(item)
  while (sibling && sibling.name !== 'ListItem') sibling = step(sibling)
  if (sibling) return sibling
  let block = step(item.parent!)
  while (block?.name === 'QuoteMark') block = step(block)
  if (block?.name !== 'BulletList' && block?.name !== 'OrderedList') return null
  sibling = dir === 1 ? block.firstChild : block.lastChild
  while (sibling && sibling.name !== 'ListItem') sibling = step(sibling)
  return sibling
}

/**
 * 列表行按语法树上下文计算缩进单位：Tab 对齐上方最近项内容列
 * （tabIndentWidthOf；跨族不取自身标记宽，防越界脱离列表结构）；
 * Shift+Tab 升一级删至父项标记列（顶级删全部缩进）
 */
function listUnitOf(
  state: EditorState,
  line: Line,
  chain: SyntaxNode[],
  prefix: LinePrefix,
  dir: 1 | -1,
  batch: { lines: ReadonlySet<number>; targets: Map<number, number | null> },
): IndentPlan {
  const mark = chain.at(-1)
  const onItemMark = mark?.name === 'ListMark'
  const offset = onItemMark ? quoteContentEdge(line, mark) : prefix.quote.length
  const cur = countColumn(line.text, MARKDOWN_TAB_SIZE, prefix.quote.length + prefix.indent.length) -
    countColumn(line.text, MARKDOWN_TAB_SIZE, offset)
  const items = chain.filter((node) => node.name === 'ListItem')
  const self = items[items.length - 1]
  if (dir > 0) {
    const prev = self ? siblingListItem(self, -1) : null
    // 只从直接前驱兄弟继承同一批的目标。父子项与未选中的间隔不合组。
    let column = onItemMark && prev ? batch.targets.get(prev.from) : undefined
    let restartNumber
    if (column === undefined && !prev && onItemMark && self) {
      const nextMark = siblingListItem(self, 1)?.getChild('ListMark')
      if (nextMark && batch.lines.has(state.doc.lineAt(nextMark.from).number)) {
        // 没有能成为父项的上一同级项时，整组不移动；继续加空格可能变成代码块。
        column = null
      }
    }
    if (column === undefined) {
      let target: SyntaxNode | null = prev ?? items[items.length - 2] ?? null
      if (!target && self) {
        let node: SyntaxNode | null = chain[0]!.resolveInner(Math.max(0, self.from - 1), -1)
        while (node && node.name !== 'ListItem') node = node.parent
        target = node && node.from !== self.from ? node : null
      }
      const cols = listMarkCols(state, target?.getChild('ListMark') ?? null)
      column = tabIndentWidthOf(cur, cols?.contentCol ?? null, cols ? cols.contentCol - cols.markCol : 0)
      const list = prefix.list
      if (prev && cols && cur < cols.contentCol && onItemMark && self && self.to <= line.to &&
          list?.digits && list.digits !== '1' && /^[ \t]*$/u.test(state.doc.sliceString(mark.to, line.to)) &&
          state.selection.ranges.length === 1 && state.selection.main.empty) {
        // 空项在当前位置新开有序子列表才从 1 开始，保留已有列表和非空编号。
        const child = prev.lastChild
        const lastMark = child?.name === 'OrderedList' ? child.lastChild?.getChild('ListMark') : null
        if (!lastMark || state.doc.sliceString(lastMark.to - 1, lastMark.to) !== list.delim) {
          restartNumber = { from: mark.from, to: mark.from + list.digits.length }
        }
      }
    }
    if (self && onItemMark) batch.targets.set(self.from, column)
    return { offset, delta: column === null ? 0 : column - cur, restartNumber }
  }
  const parent = self?.parent?.parent
  const parentMark = parent?.name === 'ListItem' ? parent.getChild('ListMark') : null
  const parentCol = listMarkCols(state, parentMark)?.markCol ?? 0
  return { offset, delta: Math.min(0, parentCol - cur) }
}

/** Tab/Shift+Tab 共用主体。dir 为 +1 缩进 / -1 反缩进 */
function indentByDirection(view: EditorView, dir: 1 | -1): boolean {
  if (view.compositionStarted) return false
  const state = view.state
  const field = state.field(liveDecorationsField, false)
  if (!field) return false
  // 受影响行：各 range 覆盖行取并集；选区末端恰在行首不含该行
  // （对齐 CM6 changeBySelectedLine 的选区行口径）
  const lineNumbers = new Set<number>()
  for (const range of state.selection.ranges) {
    for (let pos = range.from; pos <= range.to;) {
      const line = state.doc.lineAt(pos)
      if (range.empty || range.to > line.from) lineNumbers.add(line.number)
      pos = line.to + 1
    }
  }
  const changes: { from: number; to?: number; insert?: string }[] = []
  const promoted: SyntaxNode[] = []
  const batch = { lines: lineNumbers, targets: new Map<number, number | null>() }
  let movedItem: { end: number; delta: number; quoteDepth: number } | null = null
  const mathBlocks = state.field(mathBlocksField, false)
  for (const num of [...lineNumbers].sort((a, b) => a - b)) {
    const line = state.doc.line(num)
    // fm 门控只拦成型卡片态（fmModel 非空——卡片只读、光标被引导弹出）；
    // 降级源码态（fmModel null）是可编辑源码，YAML 嵌套缩进走普通行
    // 2 空格制（#420：此前对 fm range 整体放行，降级头区内 Tab 落穿
    // 默认路径被宿主预加载脚本转发为工作台焦点导航——焦点逃逸）
    const fm = field.fm
    if (fm && field.fmModel && line.from < fm.end && line.to > fm.start) return false
    // 行内首个非空白字符处探测容器链（空行取行首）：缩进代码块的节点
    // 起点在内容列，行首探测永远落在缩进空白上（CodeBlock 成死条目）
    const lead = /^\s*/u.exec(line.text)![0].length
    const chain = chainAt(field.tree, Math.min(line.to, line.from + lead))
    if (chain.some((node) => TABLE_NODES.has(node.name))) return false
    // 块级公式内的列表形态行同代码块口径：普通行语义，不做智能对齐
    const plain = (mathBlocks?.some((b) => line.from < b.to && line.to > b.from) ?? false)
      || chain.some((node) => CODE_NODES.has(node.name))
    const prefix = plain ? null : parseLinePrefix(line.text)
    // 查标记的右侧，避免 >- 贴在一起时命中左侧的 QuoteMark。
    const quotedListChain = prefix?.mark && prefix.quote
      ? chainAt(field.tree, line.from + prefix.quote.length + prefix.indent.length + 1)
      : null
    const listChain = quotedListChain?.at(-1)?.name === 'ListMark' ? quotedListChain : chain
    const mark = listChain.at(-1)
    const item = mark?.name === 'ListMark' ? mark.parent : null
    if (movedItem && line.from >= movedItem.end) movedItem = null
    let unit: IndentPlan
    if (movedItem) {
      const offset = quoteIndentOffset(line.text, movedItem.quoteDepth)
      // 空行和省略外层引用前缀的惰性续行不必补缩进，其余行沿用所属项的位移。
      if (offset < 0 || /^[ \t]*$/u.test(line.text.slice(offset))) continue
      unit = { offset, delta: movedItem.delta }
    } else if (prefix?.mark) {
      unit = listUnitOf(state, line, listChain, prefix, dir, batch)
      if (dir < 0 && unit.delta && item?.parent?.parent?.name === 'ListItem') promoted.push(item)
      if (item && item.to > line.to) {
        movedItem = { end: item.to, delta: unit.delta, quoteDepth: prefix.quote.split('>').length - 1 }
      }
    } else {
      const { offset, width } = indentUnitOf(prefix)
      unit = { offset, delta: dir * width }
    }
    const { offset, delta } = unit
    if (!delta) continue
    const indent = /^[ \t]*/u.exec(line.text.slice(offset))![0]
    const structural = !!prefix?.mark || movedItem !== null
    if (structural && indent.includes('\t')) {
      changes.push(resizeListIndent(line, offset, indent, delta))
    } else if (delta > 0) {
      // 裸 > 新增空白后第一格会成为引用分隔符，不计入列表的缩进量。
      const separator = (item || movedItem) && line.text[offset - 1] === '>' ? 1 : 0
      changes.push({ from: line.from + offset, insert: ' '.repeat(delta + separator) })
    } else {
      // 列表的位移只消费 Markdown 缩进。惰性续行开头的 NBSP 等仍属正文。
      const width = structural ? Math.min(-delta, indent.length) : -delta
      const cut = dedentCutOf(line.text, { offset, width })
      if (cut) changes.push({ from: line.from + cut.from, to: line.from + cut.to })
    }
    if (unit.restartNumber) changes.push({ ...unit.restartNumber, insert: '1' })
  }
  if (changes.length > 0) {
    const changeSet = continuePromotedNumbers(state, state.changes(changes), promoted)
    view.dispatch({
      changes: changeSet,
      selection: EditorSelection.create(
        state.selection.ranges.map((range) =>
          EditorSelection.range(changeSet.mapPos(range.anchor, 1), changeSet.mapPos(range.head, 1))),
        state.selection.mainIndex,
      ),
      userEvent: dir > 0 ? 'input.indent' : 'delete.dedent',
      scrollIntoView: true,
    })
  }
  return true
}

/** Tab：整行缩进一级（列表行对齐父项内容起点） */
export const indentLine: Command = (view) => indentByDirection(view, 1)

/** Shift+Tab：整行反向缩进一级（至多删一级，不足全删） */
export const dedentLine: Command = (view) => indentByDirection(view, -1)

/** 装配入口：置于 tableEditing 之后、defaultKeymap 之前（顺序约束见头注释） */
export const indentEditing = [
  keymap.of([{ key: 'Tab', run: indentLine, shift: dedentLine }]),
]
