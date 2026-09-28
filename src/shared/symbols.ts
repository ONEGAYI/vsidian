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
// - #151：右邻抑制为差异化双口径——括号引号登记生态口径（isBodyChar：
//   右邻非空白且非注册表闭合字符即不补全），Markdown 触发符维持既有
//   词字符口径（isWordChar）不动。
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
  /** 选区包裹能力（#124）：有非空选区时键入 open 在选区两侧包裹
   *  open/close 并保持原文选中。与补全能力是不同集合的显式登记——
   *  包裹判定不做邻接抑制（选区已圈定范围，词中/转义防误触是无选区
   *  场景的规则），代码上下文沿用 allowInCode（强调符号不进代码）；
   *  英文尖括号两项能力都不登记 */
  readonly selectionWrap?: boolean
  /** Tab 越界能力（#125）：光标在该符号对内部时 Tab 两步越出（闭合
   *  标记左边界 → 越过整个闭合标记）。与补全/包裹是第三个显式集合：
   *  括号/引号项表示「行内配对扫描参与」（语法树里是纯文本，无节点）；
   *  markdown 项表示「其对应的树围栏结构参与」（见
   *  TAB_ESCAPE_TREE_NODE_NAMES，webview 侧从语法树取边界）。
   *  显式决策（#125 登记）：$ 美元符不登记——行内公式无语法节点，
   *  行内扫描的 $..$ 配对边界与公式形态学（KaTeX 渲染范围、转义与
   *  货币歧义）不一致，最小样例不含；wikilink 经方括号的行内配对
   *  天然纳入（[[..]] 的栈式配对逐层退出）。英文尖括号不登记 */
  readonly tabEscape?: boolean
  /** 左邻字符抑制（返回 true 不补全）：转义反斜杠、英文撇号的词内形态 */
  readonly suppressBefore?: (charBefore: string) => boolean
  /** 右邻字符抑制（返回 true 不补全）：括号引号登记生态口径（#151——
   *  右邻为非空白且非闭合类字符的「正文中间形态」不补全，isBodyChar）；
   *  Markdown 触发符登记词中间防误触（isWordChar，既有行为） */
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

/** 正文中间字符（#151 括号引号的右邻抑制口径）：非空白且非注册表
 *  闭合字符——词字符与普通标点都算。右邻为这类字符（`|word`、`|,x`）
 *  时不补全，避免闭合符越界补到正文中间；右邻空白/行尾/闭合类字符
 *  （`) ] }`、引号、Markdown 标记符等，含 `[（|）]` 嵌套形态）放行。
 *  与先例的关系（核实 @codemirror/autocomplete 6.20.3 源码）：CM6
 *  closeBrackets 同样抑制右邻普通标点（放行集为固定 `)]}:;>`，见
 *  defaults.before），本项目放行集从注册表派生——方向一致、集合构成
 *  不同；VSCode autoClosingBefore 按语言词字符判定（右邻普通标点放
 *  行），本项目仅比 VSCode 更保守。标点也抑制是 #151 落档的显式决
 *  策，不是先例复刻。闭合类集合 REGISTRY_CLOSE_CHARS 从注册表派生，
 *  定义在注册表之后——本函数只在运行时被调用（模块初始化后），
 *  后置引用无 TDZ 风险 */
const isBodyChar = (ch: string): boolean =>
  ch !== '' && !/\s/u.test(ch) && !REGISTRY_CLOSE_CHARS.has(ch)

/** Markdown 触发符的邻接抑制集合（`* _ ~ ` = $` 共用形态）：
 *  左邻转义、右邻词字符（词中间不补——flanking 防误触的保守默认值）、
 *  仅串首补全 */
function markdownTrigger(open: string): SymbolPairEntry {
  return {
    open,
    close: open,
    kind: 'markdown',
    allowInCode: false,
    selectionWrap: true,
    // Tab 越界：树围栏路径（$ 由调用方逐项改写为不登记，见注册表注释）
    tabEscape: true,
    suppressBefore: escapedSuppress,
    suppressAfter: isWordChar,
    mirrorAtRunStartOnly: true,
  }
}

/**
 * 符号自动补全注册表（#123 首次登记）：
 * - 括号 8 对：() [] {} 与全角 （）【】《》「」『』
 * - 引号 4 对：弯引号 “” ‘’ 与英文单双引号（英文引号自反：open === close）
 * - Markdown 触发符 6 项：* _ ~ ` = $（自反，串首补全；块级结构如
 *   三反引号围栏与 $$ 块不自动创建——非目标，保留原输入）
 * - #151：括号引号逐项登记 suppressAfter（isBodyChar）——右邻为非空白
 *   且非闭合类字符（词字符/普通标点）不补全，对齐生态惯例（此前
 *   `|word` 键 [ 会越界补出 `[|]word`）；Markdown 触发符维持词字符
 *   口径不变（右邻普通标点照常补全）
 * - #124 起逐项登记 selectionWrap（有选区键入的包裹能力）：括号引号
 *   与 Markdown 触发符当前全部登记（方括号重复输入形成 [[wikilink]]
 *   类结构，星号重复包裹形成粗体），与补全清单是两个显式集合
 * - 英文尖括号 <> 默认不登记（不自动补全）；后续新增符号在此追加并
 *   以 test/unit/symbols.test.ts 参数化用例钉住
 */
export const SYMBOL_AUTOCLOSE_REGISTRY: readonly SymbolPairEntry[] = [
  { open: '(', close: ')', kind: 'bracket', allowInCode: true, selectionWrap: true, tabEscape: true, suppressBefore: escapedSuppress, suppressAfter: isBodyChar },
  { open: '[', close: ']', kind: 'bracket', allowInCode: true, selectionWrap: true, tabEscape: true, suppressBefore: escapedSuppress, suppressAfter: isBodyChar },
  { open: '{', close: '}', kind: 'bracket', allowInCode: true, selectionWrap: true, tabEscape: true, suppressBefore: escapedSuppress, suppressAfter: isBodyChar },
  { open: '（', close: '）', kind: 'bracket', allowInCode: true, selectionWrap: true, tabEscape: true, suppressBefore: escapedSuppress, suppressAfter: isBodyChar },
  { open: '【', close: '】', kind: 'bracket', allowInCode: true, selectionWrap: true, tabEscape: true, suppressBefore: escapedSuppress, suppressAfter: isBodyChar },
  { open: '《', close: '》', kind: 'bracket', allowInCode: true, selectionWrap: true, tabEscape: true, suppressBefore: escapedSuppress, suppressAfter: isBodyChar },
  { open: '「', close: '」', kind: 'bracket', allowInCode: true, selectionWrap: true, tabEscape: true, suppressBefore: escapedSuppress, suppressAfter: isBodyChar },
  { open: '『', close: '』', kind: 'bracket', allowInCode: true, selectionWrap: true, tabEscape: true, suppressBefore: escapedSuppress, suppressAfter: isBodyChar },
  { open: '“', close: '”', kind: 'quote', allowInCode: true, selectionWrap: true, tabEscape: true, suppressBefore: escapedSuppress, suppressAfter: isBodyChar },
  { open: '‘', close: '’', kind: 'quote', allowInCode: true, selectionWrap: true, tabEscape: true, suppressBefore: escapedSuppress, suppressAfter: isBodyChar },
  {
    open: '"', close: '"', kind: 'quote', allowInCode: true, selectionWrap: true, tabEscape: true,
    suppressBefore: escapedSuppress,
    suppressAfter: isBodyChar,
  },
  {
    // 英文单引号：左邻字母/数字视为撇号（it's / dogs' / 中文词内），
    // 按普通文字处理；行首与空白后照常配对（选区包裹不受此抑制）
    open: "'", close: "'", kind: 'quote', allowInCode: true, selectionWrap: true, tabEscape: true,
    suppressBefore: (charBefore) => escapedSuppress(charBefore) || isWordChar(charBefore),
    suppressAfter: isBodyChar,
  },
  markdownTrigger('*'),
  markdownTrigger('_'),
  markdownTrigger('~'),
  markdownTrigger('`'),
  markdownTrigger('='),
  // $ 的 Tab 越界显式不登记（tabEscape 覆盖为空）：行内公式无语法节点，
  // 扫描配对的边界与公式形态学不一致（决策见 SymbolPairEntry.tabEscape 注释）
  { ...markdownTrigger('$'), tabEscape: undefined },
]

/** 闭合类字符集合（#151）：注册表全部 close 字符（自反符号 open ===
 *  close 天然在内，Markdown 标记符即自反项）。括号引号右邻抑制经
 *  isBodyChar 引用本集合——新增符号自动获得「右邻贴其闭合/标记字符
 *  时照常补全」语义，不另设第二份清单 */
const REGISTRY_CLOSE_CHARS = new Set(SYMBOL_AUTOCLOSE_REGISTRY.map((entry) => entry.close))

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

/** 选区包裹判定上下文（#124；比补全上下文简单——邻接抑制不适用） */
export interface SelectionWrapContext {
  /** 包裹范围（或其边界）是否处于代码上下文（行内代码/代码块等） */
  readonly inCode: boolean
}

/**
 * 键入字符是否命中选区包裹（#124 纯判定）：必须等于某注册项的 open
 * 且该项显式登记了 selectionWrap。键入 close 字符不包裹（`（text` 后
 * 键 `）` 是普通输入）；英文尖括号不命中。
 */
export function findSelectionWrapEntry(ch: string): SymbolPairEntry | null {
  const entry = ENTRY_BY_CHAR.get(ch) ?? null
  return entry && entry.selectionWrap && ch === entry.open ? entry : null
}

/**
 * 命中的包裹项在给定上下文是否执行包裹（#124 纯判定）：代码上下文沿用
 * allowInCode（Markdown 强调不进代码，括号引号照常）。邻接字符
 * 抑制（词中/转义）不适用——选区已圈定范围，用户意图明确。
 */
export function shouldSelectionWrap(entry: SymbolPairEntry, ctx: SelectionWrapContext): boolean {
  return !(ctx.inCode && !entry.allowInCode)
}

/**
 * Tab 越界认定的 Markdown 行内围栏语法节点名（#125）：webview 侧 chainAt/
 * visitRange 命中这些节点的光标处于有效树围栏内（闭合边界取节点末子
 * mark 节点）。与注册表 markdown 项的 tabEscape 对应——Emphasis 对应 *
 * 与 _ 两种触发符，故节点集合与触发符集合不是一一映射，登记在此为
 * 单一事实源（节点名只是字符串，本模块仍不依赖语法树）。InlineCode 在
 * 集合内：行内代码本身是成对围栏（块级代码 FencedCode/CodeText/
 * CodeBlock 不在——块内 Tab 继续缩进）；$ 与 wikilink 无专用节点，
 * 决策见 SymbolPairEntry.tabEscape 注释。
 */
export const TAB_ESCAPE_TREE_NODE_NAMES: readonly string[] = [
  'Emphasis', 'StrongEmphasis', 'Strikethrough', 'Highlight', 'InlineCode',
]
