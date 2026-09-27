// 围栏内两步 Tab 越界的定位纯逻辑（工单 #125）：行内括号/引号配对扫描、
// 与语法树围栏（webview 适配层提取后传入）合并取最内层、两步目标推导。
//
// 设计（规格「注册表保存静态元数据；围栏定位和输入计划以纯逻辑表达」）：
// - 坐标一律为**行内偏移**（0 = 行首字符前），doc 偏移换算归 webview
//   适配层（fenceEscape.ts）；本模块不依赖 CM6/Lezer/vscode/DOM。
// - 两类有效围栏（注册表 tabEscape 集合，三集合不无条件等同）：
//   1. 行内括号/引号（语法树里是纯文本）：matchInlineFences 栈式配对，
//      自反符号（英文单双引号）按出现顺序交替开闭；孤立 close 与
//      栈顶不匹配的 close 按普通字符忽略（保守，不猜用户意图）。
//   2. Markdown 树围栏（Emphasis/StrongEmphasis/Strikethrough/
//      Highlight/InlineCode）：webview 从增量树提取后以同一区间形态传入。
// - 两步语义无跨按键状态机：光标 < 闭合左边界 → 目标 = 闭合左边界；
//   光标已贴闭合左边界 → 目标 = 闭合右边界（越过整个闭合标记，不停在
//   多字符标记中间——停在标记中间的光标不命中，交落穿）。
// - 嵌套逐层退出：每次按键即时取「包含光标的**最内层**围栏」，越出后
//   下一次自然取外层（最内层按内容区间宽度取最窄）。
import { SYMBOL_AUTOCLOSE_REGISTRY } from './symbols'

/** 围栏区间（行内偏移）：两侧标记的四个边界 */
export interface TabEscapeFenceSpan {
  /** 围栏起点（开标记左边界） */
  readonly openFrom: number
  /** 开标记右边界（内容起点） */
  readonly openTo: number
  /** 闭标记左边界（内容终点） */
  readonly closeFrom: number
  /** 闭标记右边界（围栏终点） */
  readonly closeTo: number
}

/** 行内配对的字符对（tabEscape 且非 markdown 的注册项形态） */
export interface InlineEscapePair {
  readonly open: string
  readonly close: string
}

/** Tab 越界行内匹配的字符对清单：注册表 tabEscape 登记的括号/引号项
 *  （markdown 项走树围栏路径，不参与行内扫描）。模块级常量——注册表
 *  是编译期常量，运行期不变 */
const INLINE_PAIRS: readonly InlineEscapePair[] = SYMBOL_AUTOCLOSE_REGISTRY
  .filter((entry) => entry.tabEscape && entry.kind !== 'markdown')
  .map((entry) => ({ open: entry.open, close: entry.close }))

export function inlineTabEscapePairs(): readonly InlineEscapePair[] {
  return INLINE_PAIRS
}

/**
 * 行内括号/引号配对扫描：返回该行全部配对区间（嵌套由区间宽度比较
 * 处理）。未闭合的 open、孤立/失配的 close 不产出（没有可靠闭合边界
 * 可越过）。自反符号按出现顺序交替（奇数个视为 open，遇同字符栈顶
 * 闭合）。pairs 参数允许单测注入自定义清单，生产恒为注册表缓存。
 */
export function matchInlineFences(
  line: string,
  pairs: readonly InlineEscapePair[],
): TabEscapeFenceSpan[] {
  if (pairs.length === 0) {
    return []
  }
  const openOfClose = new Map<string, string>()
  const selfMirror = new Set<string>()
  const known = new Set<string>()
  for (const pair of pairs) {
    known.add(pair.open)
    known.add(pair.close)
    if (pair.open === pair.close) {
      selfMirror.add(pair.open)
    } else {
      openOfClose.set(pair.close, pair.open)
    }
  }
  const stack: { open: string; from: number }[] = []
  const out: TabEscapeFenceSpan[] = []
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (!known.has(ch)) {
      continue
    }
    if (selfMirror.has(ch)) {
      const top = stack[stack.length - 1]
      if (top && top.open === ch) {
        stack.pop()
        out.push({ openFrom: top.from, openTo: top.from + 1, closeFrom: i, closeTo: i + 1 })
      } else {
        stack.push({ open: ch, from: i })
      }
      continue
    }
    const openForClose = openOfClose.get(ch)
    if (openForClose !== undefined) {
      const top = stack[stack.length - 1]
      if (top && top.open === openForClose) {
        stack.pop()
        out.push({ openFrom: top.from, openTo: top.from + 1, closeFrom: i, closeTo: i + 1 })
      }
      // 失配 close（栈空或栈顶是别类开符）：按普通字符忽略
      continue
    }
    // 非自反 open：压栈（注册表当前无「某项 open 同时是另一项 close」的
    // 字符重叠；若有，close 分支已在前处理，剩余形态按 open 压栈）
    stack.push({ open: ch, from: i })
  }
  return out
}

/**
 * 包含 pos 的最内层围栏：内容区间（openTo..closeFrom）宽度最窄者；
 * 包含口径 openTo <= pos <= closeFrom（贴开标记右侧与贴闭标记左侧都算
 * 内部；停在开/闭标记字符中间不命中——多字符标记不产生中间停点）。
 */
export function innermostFenceAt(
  fences: readonly TabEscapeFenceSpan[],
  pos: number,
): TabEscapeFenceSpan | null {
  let best: TabEscapeFenceSpan | null = null
  let bestWidth = Infinity
  for (const fence of fences) {
    if (pos < fence.openTo || pos > fence.closeFrom) {
      continue
    }
    const width = fence.closeFrom - fence.openTo
    if (width < bestWidth) {
      best = fence
      bestWidth = width
    }
  }
  return best
}

/**
 * 两步目标推导（#125 主判定）：pos 在某围栏内部时返回 Tab 应落到的
 * 行内偏移——pos < 闭合左边界 → closeFrom（到当前围栏闭合边界，不是
 * 词尾）；pos 已贴闭合左边界 → closeTo（越过整个闭合标记）。pos 不在
 * 任何有效围栏内返回 null（调用方 return false 落穿：围栏外不向右
 * 搜索，交既有表格导航/缩进）。
 */
export function planTabEscapeTarget(
  fences: readonly TabEscapeFenceSpan[],
  pos: number,
): number | null {
  const fence = innermostFenceAt(fences, pos)
  if (!fence) {
    return null
  }
  return pos === fence.closeFrom ? fence.closeTo : fence.closeFrom
}
