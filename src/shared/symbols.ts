// 符号输入辅助的共享符号元数据（工单 #123）：符号注册表单一事实源。
//
// 设计（规格「代码侧符号注册表」+ #123 非目标交接）：
// - 注册表只保存静态元数据：符号对（open/close）、种类、代码上下文
//   适用性与相邻字符抑制条件。触发/越过/删除的输入规划以纯函数表达
//   （本文件），编辑器事件与事务派发归 webview/symbolAutocomplete.ts。
// - #124（选区包裹）与 #125（Tab 越界）复用本注册表取得符号清单与
//   open/close 形态；登记新符号只需在 SYMBOL_AUTOCLOSE_REGISTRY 追加
//   条目并在 test/unit/symbols.test.ts 的参数化用例中钉住行为，不需要
//   修改本模块以外的条件分支。
// - 抑制条件逐项显式登记（suppressBefore/suppressAfter/mirrorAtRunStartOnly），
//   不能把包裹清单（formatOperations 的 INLINE 表）当作无条件补全清单——
//   两侧语义不同：包裹认「已有选区的围栏标记」，补全认「无选区时的
//   起始符号」，后者受邻接字符与代码上下文约束。
// - 本模块不依赖 vscode/DOM/语法树：代码上下文（inCode）由调用方按
//   语法树判定后传入，保持纯逻辑可单测。

/** 符号对种类：括号（含全角）、引号、Markdown 行内触发符 */
export type SymbolPairKind = 'bracket' | 'quote' | 'markdown'

/** 补全判定上下文（调用方从文档与光标位置构造） */
export interface AutocloseContext {
  /** 光标左侧紧邻字符（'' = 行首或文档首） */
  readonly charBefore: string
  /** 光标右侧紧邻字符（'' = 行尾或文档尾） */
  readonly charAfter: string
  /** 光标左侧紧邻的同字符连续长度（不含本次键入；自反触发符的串首判定用） */
  readonly runBefore: number
  /** 是否处于代码上下文（行内代码/围栏与缩进代码块/frontmatter/HTML 块） */
  readonly inCode: boolean
}

/** 注册项：一个符号对的补全行为描述 */
export interface SymbolPairEntry {
  /** 起始符号（键入触发字符；自反符号与 close 相同） */
  readonly open: string
  /** 闭合符号（自动补出与越过目标） */
  readonly close: string
  readonly kind: SymbolPairKind
  /** 代码上下文内是否允许自动补全：括号引号允许（代码里也要配对），
   *  Markdown 强调抑制（不改写代码内容） */
  readonly allowInCode: boolean
  /** 左邻字符抑制（返回 true 不补全）：转义反斜杠、英文撇号的词内形态 */
  readonly suppressBefore?: (charBefore: string) => boolean
  /** 右邻字符抑制（返回 true 不补全）：Markdown 触发符的词中间防误触 */
  readonly suppressAfter?: (charAfter: string) => boolean
  /** 自反触发符（open === close）仅在连续串首键入时补全——钉住星号
   *  契约 `| → *|* → **| → ***|` 的第三步：左侧已有同字符（如 `**|`）
   *  再键入不补对。括号引号无此字段（连续开括号各自补全） */
  readonly mirrorAtRunStartOnly?: boolean
}

/** 转义抑制：所有注册项共享（Markdown 转义对全部 ASCII 标点有效，
 *  `\(` `\*` `\"` 等按普通文字处理，规格「反斜杠转义后的符号按普通
 *  文字处理」）。不作为围栏起点 */
const escapedSuppress = (charBefore: string): boolean => charBefore === '\\'

/** 词类字符（Unicode 字母/数字）：Markdown 触发符右邻抑制与英文撇号
 *  左邻抑制共用——词中间（含中文词内）键入按普通文字处理 */
const isWordChar = (ch: string): boolean => /\p{L}|\p{N}/u.test(ch)

/** Markdown 触发符的邻接抑制集合（`* _ ~ ` = $` 共用形态）：
 *  左邻转义、右邻词字符（词中间不补——flanking 防误触的保守默认值）、
 *  仅串首补全 */
function markdownTrigger(open: string): SymbolPairEntry {
  return {
    open,
    close: open,
    kind: 'markdown',
    allowInCode: false,
    suppressBefore: escapedSuppress,
    suppressAfter: isWordChar,
    mirrorAtRunStartOnly: true,
  }
}

/**
 * 符号自动补全注册表（#123 首次登记）：
 * - 括号 9 对：() [] {} 与全角 （）【】《》「」『』
 * - 引号 4 对：弯引号 “” ‘’ 与英文单双引号（英文引号自反：open === close）
 * - Markdown 触发符 6 项：* _ ~ ` = $（自反，串首补全；块级结构如
 *   三反引号围栏与 $$ 块不自动创建——非目标，保留原输入）
 * - 英文尖括号 <> 默认不登记（不自动补全）；后续新增符号在此追加并
 *   以 test/unit/symbols.test.ts 参数化用例钉住
 */
export const SYMBOL_AUTOCLOSE_REGISTRY: readonly SymbolPairEntry[] = [
  { open: '(', close: ')', kind: 'bracket', allowInCode: true, suppressBefore: escapedSuppress },
  { open: '[', close: ']', kind: 'bracket', allowInCode: true, suppressBefore: escapedSuppress },
  { open: '{', close: '}', kind: 'bracket', allowInCode: true, suppressBefore: escapedSuppress },
  { open: '（', close: '）', kind: 'bracket', allowInCode: true, suppressBefore: escapedSuppress },
  { open: '【', close: '】', kind: 'bracket', allowInCode: true, suppressBefore: escapedSuppress },
  { open: '《', close: '》', kind: 'bracket', allowInCode: true, suppressBefore: escapedSuppress },
  { open: '「', close: '」', kind: 'bracket', allowInCode: true, suppressBefore: escapedSuppress },
  { open: '『', close: '』', kind: 'bracket', allowInCode: true, suppressBefore: escapedSuppress },
  { open: '“', close: '”', kind: 'quote', allowInCode: true, suppressBefore: escapedSuppress },
  { open: '‘', close: '’', kind: 'quote', allowInCode: true, suppressBefore: escapedSuppress },
  {
    open: '"', close: '"', kind: 'quote', allowInCode: true,
    suppressBefore: escapedSuppress,
  },
  {
    // 英文单引号：左邻字母/数字视为撇号（it's / dogs' / 中文词内），
    // 按普通文字处理；行首与空白后照常配对
    open: "'", close: "'", kind: 'quote', allowInCode: true,
    suppressBefore: (charBefore) => escapedSuppress(charBefore) || isWordChar(charBefore),
  },
  markdownTrigger('*'),
  markdownTrigger('_'),
  markdownTrigger('~'),
  markdownTrigger('`'),
  markdownTrigger('='),
  markdownTrigger('$'),
]

const ENTRY_BY_CHAR = new Map<string, SymbolPairEntry>()
for (const entry of SYMBOL_AUTOCLOSE_REGISTRY) {
  // 自反符号 open === close 只登记一次；括号以 open 与 close 双键命中
  // （闭合越过时按键入的 close 字符查同一注册项）
  if (!ENTRY_BY_CHAR.has(entry.open)) {
    ENTRY_BY_CHAR.set(entry.open, entry)
  }
  if (!ENTRY_BY_CHAR.has(entry.close)) {
    ENTRY_BY_CHAR.set(entry.close, entry)
  }
}

/** 键入字符 → 注册项（open 或 close 命中同一项；未登记返回 null，
 *  如英文尖括号） */
export function findAutocloseEntry(ch: string): SymbolPairEntry | null {
  return ENTRY_BY_CHAR.get(ch) ?? null
}

/**
 * 无选区键入 entry.open 是否自动补全（纯判定，#123 的触发契约）。
 * 判定顺序：转义 → 代码上下文 → 左邻抑制 → 右邻抑制 → 自反串首。
 */
export function shouldAutoclose(entry: SymbolPairEntry, ctx: AutocloseContext): boolean {
  if (entry.suppressBefore?.(ctx.charBefore)) {
    return false
  }
  if (ctx.inCode && !entry.allowInCode) {
    return false
  }
  if (entry.suppressAfter?.(ctx.charAfter)) {
    return false
  }
  if (entry.mirrorAtRunStartOnly && ctx.runBefore > 0) {
    return false
  }
  return true
}
