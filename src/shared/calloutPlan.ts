// Callout 源文转换规划器（#656/T05，规格 docs/specs/callout.md §6；T01
// 探针报告 §9 的窄模块建议落地）：插入／转换（普通正文包裹）、类型切换
// （最内层声明区间替换）与「无 Callout」移除的精确变更集派生。纯文本
// LF 坐标、零 vscode/DOM/树依赖——两端理论可共用，消费方在 webview
// （syncController 菜单与键位执行体）。目标解析（包含位置的最内层
// callout）消费解析树，归 webview 端（liveDecorations.innermostCalloutAt）
// ——识别单一事实源仍是 calloutSyntax.parseCalloutDecl，本模块不复制
// 识别规则。
//
// 产物纪律（规格 §6.1）：
// - 每次 创建/转换/切类型/移除 = 一份变更集 = 调用方一笔 CM6 事务 =
//   一笔 edit.request = 宿主一步撤销；同类型改写等无实质变化返回 null
//   （零编辑零撤销项）。
// - 完成后选区一律选中类型名（`> [!x]` 的 x 区间），用户可直接键入替换。
// - 只产变更不 dispatch；多选区沿主选区口径（调用方传 selection.main）。
import { CALLOUT_TYPES, type CalloutDecl } from './calloutSyntax'

/** 菜单类型列表派生：13 规范类型 id（注册表序；别名经源文或自定义输入使用，
 *  不重复排成菜单——规格 §7） */
export const CALLOUT_TYPE_IDS: readonly string[] = CALLOUT_TYPES.map((entry) => entry.id)

/** 转换目标 callout（webview 端 innermostCalloutAt 的解析产物；规划器不
 *  自行识别——字段语义与 liveDecorations.LiveCalloutInfo 对齐） */
export interface CalloutPlanTarget {
  /** 声明（识别单一事实源产物） */
  readonly decl: CalloutDecl
  /** 声明 `[` 的文档偏移（段起点） */
  readonly markerFrom: number
  /** 标题行（= 首段首行）行号，1-based */
  readonly titleLineNo: number
  /** 容器末行行号，1-based */
  readonly lastLineNo: number
  /** 容器内标题行之后存在正文行（剥引用前缀非空白——calloutFold.hasBodyLine
   *  同口径；「只有声明无正文」判定输入） */
  readonly hasBody: boolean
}

/** 规划产物：变更集（from 升序无重叠，CM6 changes 直用）+ 完成后选区 */
export interface CalloutEditPlan {
  readonly changes: ReadonlyArray<{ from: number; to: number; insert: string }>
  /** 选中类型名（`> [!x]` 的 x）；移除路径无选区（由 CM6 坐标映射落点） */
  readonly selection?: { anchor: number; head: number }
}

/** 类型名在声明串内的区间：`[!` 之后（`> [!note]` 的 note 相对 markerFrom
 *  偏移 +2 起） */
function typeRangeOf(markerFrom: number, type: string): { anchor: number; head: number } {
  return { anchor: markerFrom + 2, head: markerFrom + 2 + type.length }
}

/**
 * 类型切换（§6.1）：只替换目标层声明的类型名区间——显式标题、折叠符号、
 * 正文与引用层级原样保留（变更集天然只覆盖类型名）。与当前类型一致返回
 * null（幂等零编辑）；写入值须为规范化小写标识（调用方经
 * parseCalloutDecl 同一 TYPE_RE 语义校验，本模块不重复校验）。
 */
export function planCalloutRetype(
  target: CalloutPlanTarget,
  newType: string,
): CalloutEditPlan | null {
  if (newType === target.decl.type) {
    return null
  }
  const from = target.markerFrom + 2
  return {
    changes: [{ from, to: from + target.decl.type.length, insert: newType }],
    selection: typeRangeOf(target.markerFrom, newType),
  }
}

/**
 * 无 Callout（§6.2）：仅移除目标层 `[!类型]` 及紧邻折叠符号。
 * - 显式标题：声明 + 折叠符号 + 其后紧邻空白剥除，标题成为首段；
 * - 无显式标题且有正文：删空标题行（正文保留引用层级）；
 * - 无显式标题且无正文：保留可编辑的空引用行（`> ` 前缀 + 剥声明）。
 * 引用层级与内层内容由「只动声明行」天然保留；普通正文（无目标）不进入
 * 本函数——调用方判 null 目标后无操作。
 */
export function planCalloutRemove(text: string, target: CalloutPlanTarget): CalloutEditPlan {
  const lines = text.split('\n')
  const line = lines[target.titleLineNo - 1]!
  const lineStart = lineOffsetOf(lines, target.titleLineNo)
  const lineEnd = lineStart + line.length
  if (target.decl.title !== undefined) {
    // 显式标题：剥 [声明+折叠符号+紧邻空白]，标题文字上移接前缀。
    // decl.markerTo 是识别输入子串（剥引用前缀后的段起点子串）内偏移，
    // 换算文档绝对坐标须加 markerFrom（calloutSyntax 的相对偏移语义）
    const markerToAbs = target.markerFrom + target.decl.markerTo
    const afterMarker = line.slice(markerToAbs - lineStart)
    const ws = /^\s*/.exec(afterMarker)![0]
    return {
      changes: [{ from: target.markerFrom, to: markerToAbs + ws.length, insert: '' }],
    }
  }
  if (!target.hasBody) {
    // 只有声明：保留空引用行（前缀 `> ` 原样，声明段剥除）
    return { changes: [{ from: target.markerFrom, to: lineEnd, insert: '' }] }
  }
  // 无标题空行整行删除（带走其后换行；末行无换行时删到行尾）
  const nextLineStart = lineEnd + 1
  const to = nextLineStart <= text.length ? nextLineStart : lineEnd
  return { changes: [{ from: lineStart, to, insert: '' }] }
}

/** 行号（1-based）→ 文档偏移（行首） */
function lineOffsetOf(lines: readonly string[], lineNo: number): number {
  let offset = 0
  for (let i = 0; i < lineNo - 1; i++) {
    offset += lines[i]!.length + 1
  }
  return offset
}

/** LF 偏移 → 行号（1-based）。isTo（选区终点语义）：恰落行首（前一字符
 *  为换行）时归前一行——行起点 < to 才算选区行，与 formatOperations
 *  的行收集口径一致；起点/空选区光标语义不受影响 */
export function docLinesOf(text: string, pos: number, isTo: boolean): number {
  const newlines = text.slice(0, pos).split('\n').length - 1
  if (isTo && pos > 0 && text[pos - 1] === '\n') {
    return newlines
  }
  return newlines + 1
}

/**
 * 普通正文插入／转换（§6.1）：
 * - 空行（无选区，光标行空白）：创建骨架 `> [!类型]`（保留行内缩进——
 *   引用空行插入同口径），完成后选中类型名；
 * - 无选区的非空行：转换当前段落（空行分界的连续行块，含引用/列表行）；
 * - 有选区：扩展到完整行（终点恰在行首归前一行），逐行补容器前缀 `> `
 *   （空白行补 `>`——空行留在所建容器内），列表/代码/引用源文原样进
 *   容器（内部结构保持；已有引用行再加一层形成嵌套）。
 * 声明行插在首个容器行之前（同缩进层级的外层引用容器）。
 */
export function planCalloutWrap(
  text: string,
  from: number,
  to: number,
  type: string,
): CalloutEditPlan {
  const lines = text.split('\n')
  const firstLine = docLinesOf(text, from, false)
  const lastLine = docLinesOf(text, to, true)
  const changes: Array<{ from: number; to: number; insert: string }> = []
  const decl = `> [!${type}]`

  const cursorLine = lines[firstLine - 1] ?? ''
  if (from === to && cursorLine.trim() === '') {
    // 空行骨架：替换空白为声明（缩进保留）
    const lineStart = lineOffsetOf(lines, firstLine)
    const indent = /^\s*/.exec(cursorLine)![0]
    const insert = indent + decl
    changes.push({ from: lineStart, to: lineStart + cursorLine.length, insert })
    return { changes, selection: { anchor: lineStart + indent.length + 4, head: lineStart + indent.length + 4 + type.length } }
  }

  // 段落扩展（无选区）：空行分界的连续行块
  let first = firstLine
  let last = lastLine
  if (from === to) {
    while (first > 1 && (lines[first - 2] ?? '').trim() !== '') {
      first--
    }
    while (last < lines.length && (lines[last] ?? '').trim() !== '') {
      last++
    }
  }

  for (let lineNo = first; lineNo <= last; lineNo++) {
    const line = lines[lineNo - 1] ?? ''
    const lineStart = lineOffsetOf(lines, lineNo)
    const prefix = line.trim() === '' ? '>' : '> '
    const insert = lineNo === first ? `${decl}\n${prefix}` : prefix
    changes.push({ from: lineStart, to: lineStart, insert })
  }
  const firstStart = lineOffsetOf(lines, first)
  return {
    changes,
    selection: { anchor: firstStart + 4, head: firstStart + 4 + type.length },
  }
}
