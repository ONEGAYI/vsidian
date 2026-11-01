// 列表与引用的 Enter 前缀延续与退格清层（工单 #119）：live 正文中
// 列表/引用行的 CM6 键位扩展。
//
// 行为（形态学细节的单一事实源在 shared/listPrefix.ts）：
// - Enter：光标在结构前缀之后时，换行并延续完整结构前缀（引用前缀 +
//   缩进 + 标记；有序 +1 保宽、任务重置未勾选）；正文中间回车为分行
//   延续。空项（无正文且无子内容）再回车删除最内层结构前缀，逐层
//   退出还原普通段落；空项带子内容不接管（保守交默认，边界待实测调整）
// - Backspace：折叠光标紧邻前缀右端（正文起点）时分层剥除——嵌套项
//   先升一级（缩进对齐父项标记列，父项信息取自语法树）、顶级一次清
//   整段标记（保留引用前缀）、纯引用行逐层剥除；任务标记与列表标记
//   是一个单元。连续删除防护（2026-11-01）：长按（OS 自动重复）删空
//   引用/callout 正文后停在前缀右端或 callout 标记右端，手动单发才
//   剥除——防长按连拆整段引用结构。其余位置（前缀中间、选区、多光
//   标、IME 组合中）不接管
// - 不接管：块级公式内（源码字面编辑）、表格、代码围栏（顶层；引用内
//   围栏行 Enter 延续引用前缀——2026-10-31 A86 验收，裸行会掉出容器）、
//   frontmatter
//
// 装配顺序约定：置于 tableEditing 之后、defaultKeymap（extraExtensions）
// 之前——表格上下文优先（格内 Enter 仍为 <br> 语义），且先于通用键位
// 拦截 Enter/Backspace。变换全部单笔事务派发（一次撤销整体回退）。
import type { EditorState } from '@codemirror/state'
import { keymap } from '@codemirror/view'
import type { Command } from '@codemirror/view'
import { ViewPlugin } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import {
  blankExitCut,
  continuePrefix,
  parseLinePrefix,
  prefixLength,
  stripLayer,
  type LinePrefix,
} from '../shared/listPrefix'
import { calloutOfBlockquote, liveDecorationsField } from './liveDecorations'
import { mathBlocksField } from './liveMath'
import { chainAt } from '../shared/markdownDoc'

/** 键位不接管的表格上下文节点名（树判定，含独立装配无 tableEditing 的兜底） */
const TABLE_CONTEXT_NODES = new Set([
  'Table', 'TableHeader', 'TableRow', 'TableDelimiter', 'TableCell',
])

interface ListKeyContext {
  prefix: LinePrefix
  /** 光标处下降的节点链（根→叶）；光标不越行尾，链不进下一行节点 */
  chain: SyntaxNode[]
  /** 前缀右端（正文起点，绝对坐标） */
  prefixEnd: number
  lineFrom: number
  lineTo: number
  /** 围栏内（行在 FencedCode/CodeText 中；判定取行内实体位置——行尾
   *  pos 的树解析可能落在节点边界外，PR678-003 实测裸 `>` 行误判） */
  inFence: boolean
}

/** 键位上下文：frontmatter/块级公式/表格/代码上下文与无结构前缀的行返回 null */
function listKeyContext(state: EditorState, pos: number): ListKeyContext | null {
  const field = state.field(liveDecorationsField, false)
  if (!field) {
    return null
  }
  const line = state.doc.lineAt(pos)
  const fm = field.fm
  if (fm && line.from < fm.end && line.to > fm.start) {
    return null // frontmatter 按源码呈现，不参与列表语义
  }
  // 块级公式内的列表形态行（GFM 树里 `- a` 可打断 `$$` 段落成真列表）按
  // 源码字面编辑——结构化改写会破坏 KaTeX 渲染内容
  const mathBlocks = state.field(mathBlocksField, false)
  if (mathBlocks?.some((b) => line.from < b.to && line.to > b.from)) {
    return null
  }
  const chain = chainAt(field.tree, pos)
  if (chain.some((node) => TABLE_CONTEXT_NODES.has(node.name))) {
    return null
  }
  const prefix = parseLinePrefix(line.text)
  if (!prefix) {
    return null
  }
  // 围栏成员资格按 FencedCode **区间**判定（PR678-003 实测：裸 `>` 行的
  // quote 字符属 QuoteMark、行 pos 的 chain 不含 CodeText，链式判定漏判
  // 空代码行；区间判定从链上最近的 Blockquote 起步剪枝，顶层回退根遍历）
  const fenceOwner = [...chain].reverse().find((node) => node.name === 'Blockquote') ??
    field.tree.topNode
  const inFence = fenceContainsLine(fenceOwner, line.from, line.to)
  if (inFence && prefix.quote.length === 0) {
    return null
  }
  return { prefix, chain, prefixEnd: line.from + prefixLength(prefix), lineFrom: line.from, lineTo: line.to, inFence }
}

/** owner 子树内是否存在 FencedCode 区间覆盖该行（闭围栏行计入） */
function fenceContainsLine(owner: SyntaxNode, lineFrom: number, lineTo: number): boolean {
  if (owner.name === 'FencedCode') {
    return owner.from <= lineFrom && lineTo <= owner.to + 1
  }
  if (owner.from > lineTo || owner.to < lineFrom) {
    return false
  }
  for (let child = owner.firstChild; child; child = child.nextSibling) {
    if (fenceContainsLine(child, lineFrom, lineTo)) {
      return true
    }
  }
  return false
}

/** 链上最深的结构节点（ListItem 优先于 Blockquote）——空项子内容的载体 */
function deepestStructNode(chain: SyntaxNode[]): SyntaxNode | null {
  for (let i = chain.length - 1; i >= 0; i--) {
    const name = chain[i]!.name
    if (name === 'ListItem' || name === 'Blockquote') {
      return chain[i]!
    }
  }
  return null
}

/** 空项是否带真子内容：结构节点越过行尾且首个非空后续行的前缀列达内容列 */
function blankItemHasChild(state: EditorState, ctx: ListKeyContext): boolean {
  const owner = deepestStructNode(ctx.chain)
  if (!owner || owner.to <= ctx.lineTo) {
    return false
  }
  const contentCol = ctx.prefixEnd - ctx.lineFrom
  let pos = ctx.lineTo + 1
  while (pos < state.doc.length) {
    const line = state.doc.lineAt(pos)
    if (line.text.trim() === '') {
      pos = line.to + 1
      continue
    }
    const prefix = parseLinePrefix(line.text)
    return (prefix ? prefixLength(prefix) : /^\s*/u.exec(line.text)![0].length) >= contentCol
  }
  return false
}

/**
 * 父项标记列（相对引用前缀之后的缩进宽度；调用方从语法树取），顶级或
 * 跨结构返回 null。退格清层与 Shift+Tab 反向缩进共用的层级查询
 */
export function parentIndentWidth(state: EditorState, chain: SyntaxNode[], prefix: LinePrefix): number | null {
  const lists = chain.filter((node) => node.name === 'BulletList' || node.name === 'OrderedList')
  if (!lists.length) {
    return null
  }
  const parentItem = lists[lists.length - 1]!.parent
  if (!parentItem || parentItem.name !== 'ListItem') {
    return null // 父级是 Blockquote/Document：当前项即（引用内的）顶级
  }
  const parentMark = parentItem.getChild('ListMark')
  if (!parentMark) {
    return null
  }
  const parentLineFrom = state.doc.lineAt(parentItem.from).from
  const width = parentMark.from - parentLineFrom - prefix.quote.length
  return width >= 0 ? width : null
}

/** 引用内围栏行的 Enter 延续（PR678-003）：只延续容器引用前缀（quote
 *  规范补一空格），代码字面内容中的列表/任务标记不参与 Markdown 续写 */
function quoteOnlyContinuation(prefix: LinePrefix): string {
  return prefix.quote === '' || / $/u.test(prefix.quote) ? prefix.quote : prefix.quote + ' '
}

/** Enter：列表/引用前缀延续与空项退出 */
export const continueListMarkup: Command = (view) => {
  if (view.compositionStarted || view.state.selection.ranges.length !== 1) return false
  const range = view.state.selection.main
  if (!range.empty) return false
  const ctx = listKeyContext(view.state, range.head)
  if (!ctx || range.head < ctx.prefixEnd) return false
  // 围栏内代码字面标记（PR678-003）：parseLinePrefix 会把代码内容的
  // `- `/`1. ` 形态解析为列表 mark——围栏内行只延续引用容器前缀，不把
  // 字面标记当 Markdown 列表续写（有序 +1/任务重置同禁）
  const inFence = ctx.inFence
  // 结构合法性：行须确实在列表项/引用内（`- - -` 这类伪前缀由树排除）
  const hasStruct = ctx.chain.some((node) => node.name === 'ListItem' || node.name === 'Blockquote')
  if (!hasStruct) return false
  // 空项：无正文时看子内容。Lezer 的项/引用节点越过行尾只是 lazy
  // continuation 的宽容（如 `- [ ] \nnext` 的 next 缩进 0 达不到内容列），
  // 再按首个非空后续行的前缀列复核——达内容列才算真子内容。围栏内的
  // 空/裸行是代码内容（PR678-003）：不走空项退出，照常延续 quote
  if (!inFence && view.state.doc.sliceString(ctx.prefixEnd, ctx.lineTo).trim() === '') {
    if (blankItemHasChild(view.state, ctx)) return false
    const cut = blankExitCut(ctx.prefix)
    const cursor = ctx.lineFrom + cut.cursor
    view.dispatch({
      changes: { from: ctx.lineFrom + cut.from, to: ctx.lineFrom + cut.to },
      selection: { anchor: cursor },
      userEvent: 'input.type', scrollIntoView: true,
    })
    return true
  }
  const insert = inFence ? quoteOnlyContinuation(ctx.prefix) : continuePrefix(ctx.prefix)
  view.dispatch({
    changes: { from: range.head, insert: '\n' + insert },
    selection: { anchor: range.head + 1 + insert.length },
    userEvent: 'input.type', scrollIntoView: true,
  })
  return true
}

/** 最近一次 Backspace keydown 是否为 OS 自动重复（长按；手动单发 false） */
let backspaceAutoRepeat = false

/** 光标是否贴 callout 标记右端（标题行 `[!note]` 的 `]` 或吞并的尾空格处） */
function atCalloutMarkerEdge(state: EditorState, ctx: ListKeyContext, head: number): boolean {
  const bq = [...ctx.chain].reverse().find((n) => n.name === 'Blockquote')
  if (!bq) {
    return false
  }
  const info = calloutOfBlockquote(state.doc, bq)
  if (!info || state.doc.line(info.titleLineNo).from !== ctx.lineFrom) {
    return false
  }
  const declEnd = info.markerFrom + info.decl.markerTo
  if (head === declEnd) {
    return true
  }
  return declEnd < ctx.lineTo && state.doc.sliceString(declEnd, declEnd + 1) === ' ' &&
    head === declEnd + 1
}

/** Backspace：折叠光标紧邻前缀右端时分层剥除结构 */
export const stripListLayer: Command = (view) => {
  if (view.compositionStarted || view.state.selection.ranges.length !== 1) return false
  const range = view.state.selection.main
  if (!range.empty) return false
  const ctx = listKeyContext(view.state, range.head)
  if (!ctx) return false
  // 围栏内代码字面标记（PR678-003）：字面 `- `/`1. ` 不是 Markdown 列
  // 表——Backspace 不做结构剥层（纯字面逐字符）；长按防护点相应前移
  // 到 quote 右端（字面标记由长按逐字删尽后才停在引用结构边界）
  const inFence = ctx.inFence
  // 连续删除防护（2026-11-01 验收反馈）：长按 backspace（OS 自动重复）
  // 删空引用/callout 正文后停在结构边界——前缀右端（将剥层）或 callout
  // 标记右端（默认路径将逐字符吃标记）拦截不动，手动单发（repeat=false）
  // 才执行剥除/继续。防护范围限引用结构（quote 前缀在场）：纯列表行不
  // 拦（引用块/callout 之外的既有剥层节奏不变）。标记右端不在 prefixEnd，
  // 判定须在 prefixEnd 收口之前
  const guardPoint = inFence ? ctx.lineFrom + ctx.prefix.quote.length : ctx.prefixEnd
  if (backspaceAutoRepeat && ctx.prefix.quote.length > 0 &&
      (range.head === guardPoint || atCalloutMarkerEdge(view.state, ctx, range.head))) {
    return true
  }
  if (inFence) return false
  if (range.head !== ctx.prefixEnd) return false
  // 结构合法性：列表项行须在列表项内，纯引用行须在 Blockquote 内
  const hasStruct = ctx.prefix.mark
    ? ctx.chain.some((node) => node.name === 'ListItem')
    : ctx.chain.some((node) => node.name === 'Blockquote')
  if (!hasStruct) return false
  const plan = stripLayer(ctx.prefix, parentIndentWidth(view.state, ctx.chain, ctx.prefix))
  if (plan.kind === 'clear') {
    const from = ctx.lineFrom + ctx.prefix.quote.length
    view.dispatch({
      changes: { from, to: ctx.prefixEnd },
      selection: { anchor: from },
      userEvent: 'delete.backward', scrollIntoView: true,
    })
    return true
  }
  if (plan.kind === 'dedent') {
    view.dispatch({
      changes: { from: ctx.lineFrom, to: ctx.prefixEnd, insert: plan.insert },
      selection: { anchor: ctx.lineFrom + plan.insert.length },
      userEvent: 'delete.backward', scrollIntoView: true,
    })
    return true
  }
  view.dispatch({
    changes: { from: ctx.lineFrom, to: ctx.lineFrom + plan.width },
    selection: { anchor: range.head - plan.width },
    userEvent: 'delete.backward', scrollIntoView: true,
  })
  return true
}

/** 装配入口：置于 tableEditing 之后、defaultKeymap 之前（顺序约束见头注释）。
 *  repeat 标记经 capture 阶段原生监听记录——无条件先于 keymap 的冒泡
 *  keydown，同一按键事件内 stripListLayer 可读 */
const trackBackspaceRepeat = ViewPlugin.define((view) => {
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Backspace') {
      backspaceAutoRepeat = event.repeat
    }
  }
  view.contentDOM.addEventListener('keydown', onKey, true)
  return {
    destroy() {
      view.contentDOM.removeEventListener('keydown', onKey, true)
    },
  }
})

export const listEditing = [
  trackBackspaceRepeat,
  keymap.of([
    { key: 'Enter', run: continueListMarkup, shift: continueListMarkup },
    { key: 'Backspace', run: stripListLayer },
  ]),
]
