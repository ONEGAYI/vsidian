// 围栏内两步 Tab 越界的编辑器适配层（工单 #125）：把 shared/tabEscape
// 的定位纯逻辑接进 CM6 keymap。
//
// 行为（规格「Tab 越界」节）：
// - 光标在有效成对围栏内部且无文本选区时，Tab 先到闭合标记左边界、
//   再按一次越过整个闭合标记；嵌套按最内层到外层逐层退出（每次按键
//   即时取包含光标的最窄围栏，无跨按键状态机）。导航覆盖文档中既有
//   围栏（语法树 + 行内扫描），不限自动补出的符号对。
// - 命中时派发**纯选区事务**（零 changes）：不产生文本写回与 dirty
//   变更；未命中 return false 自然落穿——表格格内落 tableEditing 切格、
//   正文落 indentEditing 缩进，优先级「越界 → 表格导航 → 缩进」由
//   keymap 装配顺序实现（见装配注释与 CM6 源码依据）。
// - 门控链（全部短路）：IME 组合中（compositionStarted，tableEditing/
//   indentEditing 同款让位）→ 增量树未就绪 → 多 range 或非空选区
//   （多 range 显式决策：只处理单 range，多光标 Tab 保持既有行并集
//   缩进/切格语义，见 tabEscapeInteraction 用例）→ 表格格区选区
//   （tableRegionField 非 null，格区语义不改写）→ frontmatter（按源码
//   呈现）→ 块级代码上下文（代码块内 Tab 继续缩进；InlineCode 不在
//   排除集——行内代码本身是有效树围栏）。
// - Shift+Tab 不绑定（shift 槽留空）：落穿保持 tableTabBackward 与
//   indentEditing.dedentLine 的原行为，不新增反向越界。
//
// 装配顺序（优先级的实现方式，syncController 扩展数组）：置于
// **tableEditing 之前**——CM6 keymap 的匹配顺序与 transactionFilter
// 相反：keymap 把全部绑定按扩展顺序正序拼接后依序尝试（@codemirror/view
// keymap buildKeymap/runHandlers 正序遍历，靠前的扩展先匹配、return
// false 落穿给后者），transactionFilter 逆序应用（靠后者先过滤——
// symbolAutocomplete/symbolWrap 排在 tableEditing 之后即为此故）。勿据
// 后者经验误摆本模块位置。defaultKeymap（extraExtensions）在最后兜底。
import { EditorSelection } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import type { Command, EditorView } from '@codemirror/view'
import { TAB_ESCAPE_TREE_NODE_NAMES } from '../shared/symbols'
import {
  inlineTabEscapePairs,
  matchInlineFences,
  planTabEscapeTarget,
  type TabEscapeFenceSpan,
} from '../shared/tabEscape'
import { liveDecorationsField } from './liveDecorations'
import { tableRegionField } from './tableRegionSelection'
import { chainAt, visitRange } from './markdownDoc'

/** 块级代码上下文（排除集）：光标链命中即不接管——代码块内 Tab 继续
 *  缩进（indentEditing 的 CODE_NODES 同族口径，另含围栏语言行 CodeInfo
 *  与 HTML 块）。InlineCode 刻意不在其中（行内代码是树围栏） */
const BLOCK_CODE_NODES = new Set(['FencedCode', 'CodeText', 'CodeBlock', 'CodeInfo', 'HTMLBlock'])

/** 树围栏节点两侧标记的节点名（首/末子节点须为 mark 才是成对围栏形态） */
const FENCE_MARK_NODES = new Set([
  'EmphasisMark', 'StrikethroughMark', 'HighlightMark', 'CodeMark',
])

/** 光标所在行的树围栏区间（行内偏移）：visitRange 该行相交节点，命中
 *  TAB_ESCAPE_TREE_NODE_NAMES 且首/末子节点是 mark（嵌套结构里内外层
 *  节点都产出，逐层退出由最窄区间比较实现） */
function treeFencesAtLine(
  view: EditorView,
  lineFrom: number,
  lineTo: number,
): TabEscapeFenceSpan[] {
  const field = view.state.field(liveDecorationsField, false)!
  const fences: TabEscapeFenceSpan[] = []
  visitRange(field.tree, lineFrom, lineTo, (node) => {
    if (!TAB_ESCAPE_TREE_NODE_NAMES.includes(node.name)) {
      return
    }
    const first = node.firstChild
    const last = node.lastChild
    // 成对围栏形态校验：首/末子节点是 mark（无两侧标记的异常形态跳过，
    // 保守不接管）；空围栏（`` `|` `` 无内容）first !== last 仍成立
    if (!first || !last || first === last ||
        !FENCE_MARK_NODES.has(first.name) || !FENCE_MARK_NODES.has(last.name)) {
      return
    }
    fences.push({
      openFrom: node.from - lineFrom,
      openTo: first.to - lineFrom,
      closeFrom: last.from - lineFrom,
      closeTo: last.to - lineFrom,
    })
  })
  return fences
}

/** Tab：有效围栏内两步越界（纯选区移动零写回），未命中 return false
 *  落穿既有链路（表格导航 → #120 缩进 → defaultKeymap） */
export const tabEscapeFence: Command = (view) => {
  if (view.compositionStarted) return false
  const state = view.state
  const field = state.field(liveDecorationsField, false)
  if (!field) return false
  const selection = state.selection
  if (selection.ranges.length !== 1 || !selection.main.empty) return false
  if (state.field(tableRegionField, false)) return false
  const pos = selection.main.head
  if (field.fm && pos >= field.fm.start && pos <= field.fm.end) return false
  const chain = chainAt(field.tree, pos)
  if (chain.some((node) => BLOCK_CODE_NODES.has(node.name))) return false

  const line = state.doc.lineAt(pos)
  const fences = treeFencesAtLine(view, line.from, line.to)
  fences.push(...matchInlineFences(line.text, inlineTabEscapePairs()))
  const target = planTabEscapeTarget(fences, pos - line.from)
  if (target === null) return false
  view.dispatch({
    selection: EditorSelection.cursor(line.from + target),
    scrollIntoView: true,
  })
  return true
}

/** 装配入口（syncController 经 Compartment 按设置热重配；顺序约束见
 *  头注释——置于 tableEditing 之前，keymap 靠前者先匹配）。shift 槽
 *  不绑定：Shift+Tab 落穿保持既有反向切格/反向缩进 */
export const fenceEscape = [
  keymap.of([{ key: 'Tab', run: tabEscapeFence }]),
]
