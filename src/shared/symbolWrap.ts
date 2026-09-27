// 选区包裹计划纯函数（工单 #124）：把「非空选区集合 + 键入的包裹符号」
// 规划为一组插入变更与新的原文选区（多 range）。注册表取符号形态
// （shared/symbols 的 selectionWrap 登记），本模块不做输入事件与事务
// 派发（归 webview/symbolWrap.ts）。
//
// 拆段规则（规格「有选中文字：包裹」）：
// - 段落边界 = 空行序列（\n + 可选空白 + 至少再一个 \n 的连续空白行）；
//   各段内的选中部分分别包裹，空段与段间空行原样保留、数量不变。
// - 单换行属于同段（软换行语义），屏幕自动折行不产生换行符天然不拆段。
// - 纯空白块（空段、选区首尾的空白行）不包裹，只保留。
// - 产物选区 = 各段原文的新坐标（多 range）：下一次键入继续在原文两侧
//   叠加包裹，第一轮生成的标记不会被当作原文。
// - 本模块不依赖 vscode/DOM/语法树：代码上下文由调用方判定后提前不接管。
import type { SymbolPairEntry } from './symbols'

/** 输入选区（LF 坐标；from < to，方向由选区层表达，计划产物一律正向） */
export interface WrapRange {
  from: number
  to: number
}

/** 计划内的一条变更（纯插入：from === to） */
export interface WrapChangeSpec {
  from: number
  to: number
  insert: string
}

/** 计划产物的一个原文选区（包裹后原文的新坐标） */
export interface WrapSelectionSpec {
  anchor: number
  head: number
}

/** 包裹计划：变更组（可直接作为 CM6 事务 changes）与原文选区集 */
export interface SelectionWrapPlan {
  changes: WrapChangeSpec[]
  selection: WrapSelectionSpec[]
}

/** 空行序列（段间空白）：\n 开头 + 至少一个空白行（\n + 行内空白）。
 *  序列结束于最后一个 \n——下一非空行的前导空白属于下一块（块首从
 *  行首算起，「只包裹被选部分」不吞掉段内容的任何字符） */
const BLANK_RUN = /\n[ \t]*\n(?:[ \t]*\n)*/g

/** 块内容是否纯空白（空段：不包裹） */
const isBlank = (text: string): boolean => /^\s*$/.test(text)

/** 把一个 range 按空行序列拆为非空白块（LF 坐标，绝对位置） */
function splitBlocks(text: string, from: number, to: number): { from: number; to: number }[] {
  const blocks: { from: number; to: number }[] = []
  let blockStart = from
  BLANK_RUN.lastIndex = 0
  for (const match of text.substring(from, to).matchAll(BLANK_RUN)) {
    const runFrom = from + match.index!
    if (runFrom > blockStart && !isBlank(text.slice(blockStart, runFrom))) {
      blocks.push({ from: blockStart, to: runFrom })
    }
    // 空行序列后的新块从序列末尾开始；序列含前导 \n（属上一行行尾），
    // 块起点取 match 结束位置（下一行行首）
    blockStart = from + match.index! + match[0].length
  }
  if (to > blockStart && !isBlank(text.slice(blockStart, to))) {
    blocks.push({ from: blockStart, to })
  }
  return blocks
}

/**
 * 规划选区包裹（#124）。输入：LF 全文、非空选区集合、注册表命中的包裹项。
 * 输出：每块两侧插入 open/close 的变更组（from 升序）+ 各块原文的新坐标
 * 选区。返回 null 表示无可包裹内容（纯空白选区、无 range 或含空 range），
 * 调用方应不接管、保留原输入语义。
 */
export function planSelectionWrap(
  text: string,
  ranges: readonly WrapRange[],
  entry: SymbolPairEntry,
): SelectionWrapPlan | null {
  if (ranges.length === 0) {
    return null
  }
  if (ranges.some((range) => range.from >= range.to)) {
    return null // 空 range（光标）混入：混合形态不接管
  }
  const changes: WrapChangeSpec[] = []
  const selection: WrapSelectionSpec[] = []
  let delta = 0 // 已规划插入的累计长度（旧坐标 → 新坐标平移量）
  for (const range of ranges) {
    for (const block of splitBlocks(text, range.from, range.to)) {
      changes.push(
        { from: block.from, to: block.from, insert: entry.open },
        { from: block.to, to: block.to, insert: entry.close },
      )
      selection.push({
        anchor: block.from + delta + entry.open.length,
        head: block.to + delta + entry.open.length,
      })
      delta += entry.open.length + entry.close.length
    }
  }
  if (changes.length === 0) {
    return null
  }
  changes.sort((a, b) => a.from - b.from)
  return { changes, selection }
}
