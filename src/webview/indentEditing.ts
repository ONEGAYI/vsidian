// Tab/Shift+Tab 实时预览正文通用行缩进（工单 #120）：live 正文中
// 光标行（无选区）或选区覆盖各行的整行缩进。
//
// 行为（缩进单位的单一事实源在 shared/listPrefix.ts）：
// - Tab：每受影响行在缩进落点插入一级宽度；Shift+Tab 从落点删除至多
//   一级宽度的连续空白（不足全删）。列表行一级宽度对齐上方最近项的
//   内容列（树上前驱兄弟/父项，跨列表块按位置回退；未达补齐、已达
//   加深其标记宽——跨族不取自身标记宽，防越界脱离列表结构成续行或
//   代码块，#121 验收修正）；Shift+Tab 删至树父项标记列（顶级删全部
//   缩进）。普通行（含纯引用行、代码围栏、缩进代码块与块级公式内）
//   固定 2 空格
// - 光标/选区随缩进平移（锚点与头均向右关联映射，对齐 CM6 命令）
// - 不自动携带子孙项；整体移动由用户用选区覆盖表达
// - 不接管（return false 交默认）：表格行——Tab/Shift+Tab 归
//   tableEditing 的单元格导航，边界放行也不缩进表格行（不破坏表格
//   结构与「表格内导航语义优先」）；frontmatter（按源码呈现）；
//   IME 组合进行中
// - Shift+Tab 无可删空白时仍吞键（return true）：Tab 族按键一旦在
//   Live 正文消费域内放行到 keydown 默认路径，会被宿主 webview 预加
//   载脚本转发为工作台焦点导航（焦点逃逸），故无变化也不放行
//
// 装配顺序约定：置于 tableEditing 之后、defaultKeymap（extraExtensions）
// 之前——表格上下文优先。变换单笔事务派发（一次撤销整体回退）。
import { EditorSelection } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import type { Command, EditorView } from '@codemirror/view'
import type { EditorState } from '@codemirror/state'
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
import { parentIndentWidth } from './listEditing'
import { chainAt } from './markdownDoc'

/** 表格节点：行落在其中即不接管（单元格导航优先；边界放行不缩进表格行） */
const TABLE_NODES = new Set([
  'Table', 'TableHeader', 'TableRow', 'TableDelimiter', 'TableCell',
])
/** 代码块节点：围栏/缩进代码块内同普通行语义（不做列表智能对齐） */
const CODE_NODES = new Set(['FencedCode', 'CodeText', 'CodeBlock'])

/**
 * 上方最近列表项的内容列与标记总宽（均相对引用前缀右端）。取树上前驱
 * 兄弟项；无前驱（首子项）取父项（祖先链上最近的 ListItem）；两级皆无
 * 时按位置回退——项前文档位置上最近的 ListItem（跨列表块的视觉上方
 * 最近项，如同为无序的松散列表本就有前驱，走到这里的是异族邻块）。
 * 仍无（文档首项）返回 null
 */
function prevItemColsOf(
  state: EditorState,
  chain: readonly SyntaxNode[],
): { contentCol: number; markWidth: number } | null {
  const items = chain.filter((node) => node.name === 'ListItem')
  const self = items[items.length - 1]
  if (!self) return null
  let prev = self.prevSibling
  while (prev && prev.name !== 'ListItem') prev = prev.prevSibling
  let target: SyntaxNode | null = prev ?? items[items.length - 2] ?? null
  if (!target) {
    let node: SyntaxNode | null = chain[0]!.resolveInner(Math.max(0, self.from - 1), -1)
    while (node && node.name !== 'ListItem') node = node.parent
    target = node && node !== self ? node : null
  }
  if (!target) return null
  const mark = target.getChild('ListMark')
  if (!mark) return null
  const targetPrefix = parseLinePrefix(state.doc.lineAt(mark.from).text)
  const shape = targetPrefix?.list
  if (!targetPrefix || !shape) return null
  // 子项嵌套列按 CommonMark 内容列：父项「标记+一空格」的宽度——任务
  // 标记属内容不计（`- [ ] p` 的内容列是 2，不是 `- [ ] ` 总宽 6；按
  // 总宽缩进会越过内容列+4 的边界，令子行脱离列表结构失去全部样式）
  const coreMark = shape.bullet
    ? shape.bullet + shape.gap1
    : shape.digits + shape.delim + shape.gap1
  return {
    contentCol: targetPrefix.indent.length + coreMark.length,
    markWidth: coreMark.length,
  }
}

/**
 * 列表行按语法树上下文计算缩进单位：Tab 对齐上方最近项内容列
 * （tabIndentWidthOf；跨族不取自身标记宽，防越界脱离列表结构）；
 * Shift+Tab 升一级删至父项标记列（顶级删全部缩进）
 */
function listUnitOf(
  state: EditorState,
  chain: readonly SyntaxNode[],
  prefix: LinePrefix,
  dir: 1 | -1,
): { offset: number; width: number } {
  const cur = prefix.indent.length
  if (dir > 0) {
    const prev = prevItemColsOf(state, chain)
    const target = tabIndentWidthOf(cur, prev?.contentCol ?? null, prev?.markWidth ?? 0)
    return { offset: prefix.quote.length, width: Math.max(0, target - cur) }
  }
  const parentCol = parentIndentWidth(state, chain as SyntaxNode[], prefix)
  return { offset: prefix.quote.length, width: Math.max(0, cur - (parentCol ?? 0)) }
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
  const mathBlocks = state.field(mathBlocksField, false)
  for (const num of [...lineNumbers].sort((a, b) => a - b)) {
    const line = state.doc.line(num)
    const fm = field.fm
    if (fm && line.from < fm.end && line.to > fm.start) return false
    // 行内首个非空白字符处探测容器链（空行取行首）：缩进代码块的节点
    // 起点在内容列，行首探测永远落在缩进空白上（CodeBlock 成死条目）
    const lead = /^\s*/u.exec(line.text)![0].length
    const chain = chainAt(field.tree, Math.min(line.to, line.from + lead))
    if (chain.some((node) => TABLE_NODES.has(node.name))) return false
    // 块级公式内的列表形态行同代码块口径：普通行语义，不做智能对齐
    const plain = (mathBlocks?.some((b) => line.from < b.to && line.to > b.from) ?? false)
      || chain.some((node) => CODE_NODES.has(node.name))
    const prefix = plain ? null : parseLinePrefix(line.text)
    const unit = prefix?.mark
      ? listUnitOf(state, chain, prefix, dir)
      : indentUnitOf(prefix)
    if (dir > 0) {
      changes.push({ from: line.from + unit.offset, insert: ' '.repeat(unit.width) })
    } else {
      const cut = dedentCutOf(line.text, unit)
      if (cut) changes.push({ from: line.from + cut.from, to: line.from + cut.to })
    }
  }
  if (changes.length > 0) {
    const changeSet = state.changes(changes)
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
