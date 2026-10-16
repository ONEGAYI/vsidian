// #541 T01 / #542 T02 附加组件声明式粘贴规则——共享声明、校验、排序与
// 快照单一事实源。
//
// 事实源：docs/specs/addon-paste-conversion.md（#530 规格冻结）与实施票
// #541（T01 基础链路）、#542（T02 正则/条件/嵌套）。本模块为两端共享纯
// 逻辑：宿主校验（注册时整批拒绝）与页面解释（转换遍历消费）使用同一
// 声明形态，不在两端各写一套规则语言；不依赖 DOM 或 vscode。
//
// 边界（规格 §4）：
// - 规则是可序列化数据：基础匹配（标签/属性存在/属性值相等）＋正则
//   （数据声明 pattern 与受限 flags，注册时编译校验；捕获组取值支持
//   整匹/数字组/命名组）＋条件（all/any/not 组合基础谓词或正则谓词；
//   空组合与非法节点拒绝，不做隐式真值转换）＋嵌套转换（children 槽
//   携带子规则集，只沿子节点下降）＋模板槽产出（字面转义/URL 策略/
//   子转换拼接）。顶层 condition / match.regex / output.nested 等未
//   定义字段一律显式拒绝（invalid-declaration）。
// - 缺失与空字符串区分：属性条件缺 value = 存在性；value 为空串 = 值
//   相等条件。取值侧：属性缺失（getAttribute 为 null）、文本/子内容为
//   空串、正则不匹配与捕获组未参与都是「必需取值缺失」，本规则失败进
//   入下一条。
// - 预算常量集中在此（规格 §4.4）：宿主与页面不得各自取值。正则实现
//   为运行环境原生 RegExp：同步、单次执行不可中断——求值步预算计的是
//   执行次数（含每次正则执行），不是可中断超时；输入长度上限约束的是
//   正则的输入面，不截断不改写。

/** 规则声明每组件数量上限（规格 §4.4：每组件至多 256 条；嵌套子规则计入总量） */
export const ADDON_PASTE_RULES_MAX_PER_ADDON = 256

/** 表达式嵌套深度上限（条件组合层级与规则嵌套层级共用；叶子谓词不另计层） */
export const ADDON_PASTE_RULES_MAX_DEPTH = 16

/** 每次粘贴累计规则/表达式求值步数上限（超限停用规则，内置转换继续） */
export const ADDON_PASTE_RULES_EVAL_STEP_BUDGET = 100_000

/** 单个正则 pattern 长度上限 */
export const ADDON_PASTE_RULES_REGEX_PATTERN_LIMIT = 1024

/** 单次正则执行的输入长度上限（元素文本/属性值超限 → 本规则失败，不截断） */
export const ADDON_PASTE_RULES_REGEX_INPUT_LIMIT = 4096

/** 单条规则条件树节点总数上限（组合节点与叶子谓词合计） */
export const ADDON_PASTE_RULES_CONDITION_NODES_LIMIT = 64

/** 规则稳定局部 ID 上限（对齐 BEHAVIOR_LOCAL_ID_LIMIT 口径） */
const RULE_ID_LIMIT = 128
/** 局部 ID 字符集（首字符字母数字；禁点号——防伪造跨组件身份） */
const RULE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
/** 标签名：字母开头，字母数字连字符（自定义元素）；比较用大写形态 */
const TAG_PATTERN = /^[A-Za-z][A-Za-z0-9-]*$/
/** 属性名：排除空白、引号、尖括号、斜杠与等号（HTML 属性名字符约束） */
const ATTRIBUTE_NAME_PATTERN = /^[^\s"'>/=]+$/
const ATTRIBUTE_NAME_LIMIT = 128
const ATTRIBUTE_VALUE_LIMIT = 1024
/** 单条规则属性条件数上限 */
const ATTRIBUTE_CONDITIONS_LIMIT = 8
/** 模板长度与槽名边界 */
const TEMPLATE_LIMIT = 4096
const SLOT_NAME_LIMIT = 64
const SLOT_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/
/** 命名捕获组名（ASCII 标识符；与模板槽名同口径） */
const GROUP_NAME_PATTERN = SLOT_NAME_PATTERN
/** 正则 flags 受限集：无状态且无副作用的四个修饰符（禁 g/y 的 lastIndex 状态与 d/v 的扩展面） */
const REGEX_FLAGS_ALLOWED = /^[imsu]*$/

/** 槽引用形态：{{name}}；名字受限以保模板切分无歧义 */
const TEMPLATE_REF_PATTERN = /\{\{([A-Za-z][A-Za-z0-9_-]*)\}\}/g

/** 属性匹配条件：缺 value = 存在性要求；value = 值相等（空串合法） */
export interface AddonPasteRuleAttributeCondition {
  readonly name: string
  readonly value?: string
}

/** 正则声明：数据形态 pattern 与受限 flags（注册时编译校验，不执行字符串代码） */
export interface AddonPasteRegex {
  readonly pattern: string
  readonly flags?: string
}

/** 条件叶子谓词：属性存在/相等（基础谓词）或正则谓词（属性值/元素文本） */
export type AddonPastePredicate =
  | { readonly kind: 'attribute'; readonly name: string; readonly value?: string }
  | { readonly kind: 'attribute-regex'; readonly name: string; readonly regex: AddonPasteRegex }
  | { readonly kind: 'text-regex'; readonly regex: AddonPasteRegex }

/** 条件组合节点：all/any/not（空组合与非法节点在注册时拒绝） */
export type AddonPasteCondition =
  | { readonly all: readonly AddonPasteConditionNode[] }
  | { readonly any: readonly AddonPasteConditionNode[] }
  | { readonly not: AddonPasteConditionNode }

/** 条件树节点：叶子谓词或组合节点 */
export type AddonPasteConditionNode = AddonPastePredicate | AddonPasteCondition

/** 匹配：标签名相等 + 属性条件全与 + 可选条件树（三处同时满足才匹配） */
export interface AddonPasteRuleMatch {
  /** 标签名（大写形态与 DOM tagName 对齐；校验时规整） */
  readonly tag: string
  /** 属性条件列表（全部满足才匹配；至多 8 条） */
  readonly attributes?: readonly AddonPasteRuleAttributeCondition[]
  /** 条件树（#542 T02；根可为组合节点或叶子谓词，与 attributes 全与组合） */
  readonly condition?: AddonPasteConditionNode
}

/**
 * 嵌套规则（children 槽子规则集成员；与顶层规则同一声明语言，id 为槽内
 * 局部）。作者声明形态：priority 可选（缺省 0，排序语义同顶层规则）。
 */
export interface AddonPasteNestedRule {
  /** 槽内局部规则 ID（同集合内唯一；不与顶层或其他集合冲突） */
  readonly id: string
  /** 可选整数优先级（缺省 0；子集内按优先级降序、ID 升序） */
  readonly priority?: number
  readonly match: AddonPasteRuleMatch
  readonly output: AddonPasteRuleOutput
}

/** 槽取值来源：元素文本 / 指定属性 / 子内容转换结果 / 正则捕获组 */
export type AddonPasteSlotSource =
  | { readonly kind: 'text' }
  | { readonly kind: 'attribute'; readonly name: string }
  | {
    /** 子内容转换结果；rules 声明嵌套子规则集（先子规则后内置，仅沿子节点下降） */
    readonly kind: 'children'
    readonly rules?: readonly AddonPasteNestedRule[]
  }
  | { readonly kind: 'text-regex'; readonly regex: AddonPasteRegex; readonly group: number | string }
  | { readonly kind: 'attribute-regex'; readonly name: string; readonly regex: AddonPasteRegex; readonly group: number | string }

/** 模板槽：url=true 经现有 safeUrl 策略（children 来源无 URL 语义，拒绝） */
export interface AddonPasteSlot {
  readonly source: AddonPasteSlotSource
  readonly url?: boolean
}

/** 产出：Markdown 结构模板或显式丢弃（空产出只有显式丢弃才算成功） */
export type AddonPasteRuleOutput =
  | {
    readonly kind: 'template'
    /** 模板中的 {{name}} 引用槽；字面部分是作者声明的静态 Markdown 结构 */
    readonly template: string
    readonly slots: Readonly<Record<string, AddonPasteSlot>>
  }
  | { readonly kind: 'discard' }

/** 作者提交的规则声明（来源组件与代次由平台注入，声明不带身份字段） */
export interface AddonPasteRuleDeclaration {
  /** 组件内稳定规则 ID（禁点号——不伪造跨组件身份） */
  readonly id: string
  /** 可选整数优先级（缺省 0；排序见 orderAddonPasteRules） */
  readonly priority?: number
  readonly match: AddonPasteRuleMatch
  readonly output: AddonPasteRuleOutput
}

/** 校验通过的基础规则（addonId 由宿主注入） */
export interface AddonPasteRule {
  readonly addonId: string
  readonly id: string
  readonly priority: number
  readonly match: AddonPasteRuleMatch
  readonly output: AddonPasteRuleOutput
}

/** 注册结果（普通 API 拒绝不算组件故障；dispose 重复调用无害） */
export type AddonPasteRulesRegisterResult =
  | { ok: true; dispose(): void }
  | { ok: false; reason: 'invalid-declaration' | 'duplicate-id' | 'too-many' | 'released'; detail?: string }

/** 校验上下文：现有递归声明总数与已占用 ID（重复与超预算判定用） */
export interface AddonPasteRuleValidationContext {
  existingIds?: ReadonlySet<string>
  /** 既有规则的递归声明总数（顶层 + 嵌套子规则合计；宿主按此口径传入） */
  currentCount?: number
}

export type AddonPasteRuleValidationResult =
  | { ok: true; rules: readonly Omit<AddonPasteRule, 'addonId'>[] }
  | { ok: false; reason: 'invalid-declaration' | 'duplicate-id' | 'too-many'; detail?: string }

/** 模板切片：字面量或槽引用 */
export type AddonPasteTemplatePart = { literal: string } | { slot: string }

/**
 * 模板切分（宿主校验与页面解释同源）。非法形态（残留 {{ 、槽名非法）
 * 返回 null——校验器据此整批拒绝。
 */
export function parseAddonPasteTemplate(template: string): readonly AddonPasteTemplatePart[] | null {
  const parts: AddonPasteTemplatePart[] = []
  let last = 0
  for (const match of template.matchAll(TEMPLATE_REF_PATTERN)) {
    const index = match.index ?? 0
    const gap = template.slice(last, index)
    // 合法引用之前的字面区不允许再出现 {{（未闭合或非法形态引用）
    if (gap.includes('{{')) return null
    if (gap) parts.push({ literal: gap })
    parts.push({ slot: match[1]! })
    last = index + match[0].length
  }
  const rest = template.slice(last)
  if (rest.includes('{{')) return null
  if (rest) parts.push({ literal: rest })
  return parts
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** 严格字段集校验：未知键显式拒绝 */
function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): string | undefined {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return key
  }
  return undefined
}

/**
 * 捕获组探测（注册校验消费；宿主与页面同源事实）。编译失败返回 null；
 * 成功返回捕获组数与命名组名集合。实现：以 `(?:pattern)|` 包装后对空串
 * 执行一次——空右枝保证匹配必然成功，结果数组长度减一即捕获组数，
 * groups 键即命名组集合。
 */
export function addonPasteRegexGroupInfo(pattern: string, flags?: string): { count: number; names: ReadonlySet<string> } | null {
  try {
    const probe = new RegExp(`(?:${pattern})|`, flags ?? '')
    const result = probe.exec('')
    if (result === null) return null
    return { count: result.length - 1, names: new Set(result.groups ? Object.keys(result.groups) : []) }
  } catch {
    return null
  }
}

/** 正则声明校验：受限 flags、长度上限与编译校验（不执行字符串代码） */
function validateRegex(value: unknown): { ok: true; regex: AddonPasteRegex } | { ok: false; detail: string } {
  if (!isObject(value)) return { ok: false, detail: 'regex must be an object' }
  const unknown = hasOnlyKeys(value, ['pattern', 'flags'])
  if (unknown) return { ok: false, detail: `regex 不支持字段 '${unknown}'` }
  if (typeof value.pattern !== 'string' || value.pattern.length === 0 || value.pattern.length > ADDON_PASTE_RULES_REGEX_PATTERN_LIMIT) {
    return { ok: false, detail: `pattern 非空字符串且至多 ${ADDON_PASTE_RULES_REGEX_PATTERN_LIMIT} 字符` }
  }
  let flags: string | undefined
  if (value.flags !== undefined) {
    if (typeof value.flags !== 'string' || !REGEX_FLAGS_ALLOWED.test(value.flags) || new Set(value.flags).size !== value.flags.length) {
      return { ok: false, detail: `flags 仅支持 i/m/s/u 且不重复：${String(value.flags)}` }
    }
    if (value.flags.length > 0) flags = value.flags
  }
  try {
    new RegExp(value.pattern, flags ?? '')
  } catch {
    return { ok: false, detail: `正则编译失败：${value.pattern}` }
  }
  return { ok: true, regex: flags === undefined ? { pattern: value.pattern } : { pattern: value.pattern, flags } }
}

/** 捕获组引用校验：非负整数不越组界；命名组须在 pattern 中声明 */
function validateGroupRef(group: unknown, regex: AddonPasteRegex): string | undefined {
  const info = addonPasteRegexGroupInfo(regex.pattern, regex.flags)
  if (info === null) return `正则编译失败：${regex.pattern}`
  if (typeof group === 'number') {
    if (!Number.isInteger(group) || group < 0) return `group 须为非负整数或命名组名：${String(group)}`
    if (group > info.count) return `group ${group} 超出捕获组数 ${info.count}`
    return undefined
  }
  if (typeof group === 'string') {
    if (!GROUP_NAME_PATTERN.test(group)) return `命名组名非法：${group}`
    if (!info.names.has(group)) return `命名组 '${group}' 未在 pattern 中声明`
    return undefined
  }
  return `group 须为非负整数或命名组名：${typeof group}`
}

/** 条件树节点计数器（整树节点总数预算） */
interface ConditionBudget {
  nodes: number
}

/**
 * 条件树校验（#542 T02）：叶子谓词与 all/any/not 组合；空组合、非法
 * 节点、未知字段与隐式真值形态整批拒绝。depth 为组合层号（根组合为 1，
 * 叶子谓词不占层号），受 ADDON_PASTE_RULES_MAX_DEPTH 约束。
 */
function validateConditionNode(value: unknown, depth: number, budget: ConditionBudget): { ok: true; node: AddonPasteConditionNode } | { ok: false; detail: string } {
  if (!isObject(value)) return { ok: false, detail: `条件节点须为对象：${typeof value}` }
  const keys = Object.keys(value)
  if (keys.includes('kind')) {
    // 叶子谓词：基础谓词或正则谓词（kind 判别，其余字段严格校验）
    const kind = value.kind
    if (kind === 'attribute') {
      const unknown = hasOnlyKeys(value, ['kind', 'name', 'value'])
      if (unknown) return { ok: false, detail: `attribute 谓词不支持字段 '${unknown}'` }
      if (typeof value.name !== 'string' || !ATTRIBUTE_NAME_PATTERN.test(value.name) || value.name.length > ATTRIBUTE_NAME_LIMIT) {
        return { ok: false, detail: `attribute 谓词属性名非法：${String(value.name)}` }
      }
      if (value.value !== undefined && typeof value.value !== 'string') return { ok: false, detail: `attribute 谓词 value 须为字符串：${String(value.value)}` }
      if (typeof value.value === 'string' && value.value.length > ATTRIBUTE_VALUE_LIMIT) {
        return { ok: false, detail: `属性值超长（>${ATTRIBUTE_VALUE_LIMIT}）` }
      }
      return { ok: true, node: value.value === undefined ? { kind: 'attribute', name: value.name } : { kind: 'attribute', name: value.name, value: value.value } }
    }
    if (kind === 'attribute-regex') {
      const unknown = hasOnlyKeys(value, ['kind', 'name', 'regex'])
      if (unknown) return { ok: false, detail: `attribute-regex 谓词不支持字段 '${unknown}'` }
      if (typeof value.name !== 'string' || !ATTRIBUTE_NAME_PATTERN.test(value.name) || value.name.length > ATTRIBUTE_NAME_LIMIT) {
        return { ok: false, detail: `attribute-regex 谓词属性名非法：${String(value.name)}` }
      }
      const regex = validateRegex(value.regex)
      if (!regex.ok) return { ok: false, detail: `attribute-regex 谓词${regex.detail}` }
      return { ok: true, node: { kind: 'attribute-regex', name: value.name, regex: regex.regex } }
    }
    if (kind === 'text-regex') {
      const unknown = hasOnlyKeys(value, ['kind', 'regex'])
      if (unknown) return { ok: false, detail: `text-regex 谓词不支持字段 '${unknown}'` }
      const regex = validateRegex(value.regex)
      if (!regex.ok) return { ok: false, detail: `text-regex 谓词${regex.detail}` }
      return { ok: true, node: { kind: 'text-regex', regex: regex.regex } }
    }
    return { ok: false, detail: `未知谓词 kind：${String(kind)}` }
  }
  // 组合节点：恰含 all/any/not 之一（多键或零键都拒绝，不做隐式真值转换）
  if (keys.length === 1 && (keys[0] === 'all' || keys[0] === 'any')) {
    const combinator = keys[0]
    const items = value[combinator]
    if (!Array.isArray(items) || items.length === 0) return { ok: false, detail: `${combinator} 须为非空数组（空组合拒绝）` }
    if (depth > ADDON_PASTE_RULES_MAX_DEPTH) return { ok: false, detail: `条件组合嵌套深度至多 ${ADDON_PASTE_RULES_MAX_DEPTH}` }
    budget.nodes += items.length
    if (budget.nodes > ADDON_PASTE_RULES_CONDITION_NODES_LIMIT) {
      return { ok: false, detail: `条件节点总数至多 ${ADDON_PASTE_RULES_CONDITION_NODES_LIMIT}` }
    }
    const nodes: AddonPasteConditionNode[] = []
    for (const raw of items) {
      const child = validateConditionNode(raw, depth + 1, budget)
      if (!child.ok) return child
      nodes.push(child.node)
    }
    return { ok: true, node: combinator === 'all' ? { all: nodes } : { any: nodes } }
  }
  if (keys.length === 1 && keys[0] === 'not') {
    if (value.not === undefined) return { ok: false, detail: `not 须携带子节点：${String(value.not)}` }
    if (depth > ADDON_PASTE_RULES_MAX_DEPTH) return { ok: false, detail: `条件组合嵌套深度至多 ${ADDON_PASTE_RULES_MAX_DEPTH}` }
    budget.nodes += 1
    if (budget.nodes > ADDON_PASTE_RULES_CONDITION_NODES_LIMIT) {
      return { ok: false, detail: `条件节点总数至多 ${ADDON_PASTE_RULES_CONDITION_NODES_LIMIT}` }
    }
    const inner = validateConditionNode(value.not, depth + 1, budget)
    if (!inner.ok) return inner
    return { ok: true, node: { not: inner.node } }
  }
  if (keys.length === 0) return { ok: false, detail: `条件节点为空对象（不做隐式真值转换）：${keys.length} 个字段` }
  return { ok: false, detail: `条件节点非法（须为谓词或恰含 all/any/not 之一）：${keys.join(',')}` }
}

function validateMatch(value: unknown): { ok: true; match: AddonPasteRuleMatch } | { ok: false; detail: string } {
  if (!isObject(value)) return { ok: false, detail: 'match must be an object' }
  const unknown = hasOnlyKeys(value, ['tag', 'attributes', 'condition'])
  if (unknown) return { ok: false, detail: `match 不支持字段 '${unknown}'` }
  if (typeof value.tag !== 'string' || !TAG_PATTERN.test(value.tag)) {
    return { ok: false, detail: `match.tag 非法：${String(value.tag)}` }
  }
  let attributes: readonly AddonPasteRuleAttributeCondition[] | undefined
  if (value.attributes !== undefined) {
    if (!Array.isArray(value.attributes)) return { ok: false, detail: 'match.attributes must be an array' }
    if (value.attributes.length > ATTRIBUTE_CONDITIONS_LIMIT) {
      return { ok: false, detail: `match.attributes 至多 ${ATTRIBUTE_CONDITIONS_LIMIT} 条` }
    }
    const conditions: AddonPasteRuleAttributeCondition[] = []
    for (const raw of value.attributes) {
      if (!isObject(raw)) return { ok: false, detail: 'attribute condition must be an object' }
      const unknownCondition = hasOnlyKeys(raw, ['name', 'value'])
      if (unknownCondition) return { ok: false, detail: `属性条件不支持字段 '${unknownCondition}'` }
      if (typeof raw.name !== 'string' || !ATTRIBUTE_NAME_PATTERN.test(raw.name) || raw.name.length > ATTRIBUTE_NAME_LIMIT) {
        return { ok: false, detail: `属性名非法：${String(raw.name)}` }
      }
      if (raw.value !== undefined && typeof raw.value !== 'string') return { ok: false, detail: 'attribute condition value must be a string' }
      if (typeof raw.value === 'string' && raw.value.length > ATTRIBUTE_VALUE_LIMIT) {
        return { ok: false, detail: `属性值超长（>${ATTRIBUTE_VALUE_LIMIT}）` }
      }
      conditions.push(raw.value === undefined ? { name: raw.name } : { name: raw.name, value: raw.value })
    }
    attributes = conditions
  }
  let condition: AddonPasteConditionNode | undefined
  if (value.condition !== undefined) {
    const validated = validateConditionNode(value.condition, 1, { nodes: 0 })
    if (!validated.ok) return { ok: false, detail: `match.condition ${validated.detail}` }
    condition = validated.node
  }
  const match: AddonPasteRuleMatch = {
    tag: value.tag.toUpperCase(),
    ...(attributes !== undefined ? { attributes } : {}),
    ...(condition !== undefined ? { condition } : {}),
  }
  return { ok: true, match }
}

interface OutputBudget {
  /** 组件内规则声明总量计数器（顶层 + 嵌套共享引用；初值含既有计数） */
  readonly count: { value: number }
  /** 当前声明的规则嵌套层号（顶层为 1） */
  readonly depth: number
}

/** 批校验失败形态（整批拒绝的三种可辨认原因） */
type AddonPasteRuleBatchFailure =
  | { ok: false; reason: 'invalid-declaration' | 'duplicate-id' | 'too-many'; detail?: string }

function validateOutput(value: unknown, budget: OutputBudget): { ok: true; output: AddonPasteRuleOutput } | ({ ok: false; detail: string } & Partial<AddonPasteRuleBatchFailure>) | AddonPasteRuleBatchFailure {
  if (!isObject(value)) return { ok: false, detail: 'output must be an object' }
  if (value.kind === 'discard') {
    const unknown = hasOnlyKeys(value, ['kind'])
    if (unknown) return { ok: false, detail: `discard 产出不支持字段 '${unknown}'` }
    return { ok: true, output: { kind: 'discard' } }
  }
  if (value.kind !== 'template') {
    return { ok: false, detail: `未知产出操作：${String(value.kind)}` }
  }
  const unknown = hasOnlyKeys(value, ['kind', 'template', 'slots'])
  if (unknown) return { ok: false, detail: `template 产出不支持字段 '${unknown}'` }
  if (typeof value.template !== 'string' || value.template.length === 0 || value.template.length > TEMPLATE_LIMIT) {
    return { ok: false, detail: `template 非空字符串且至多 ${TEMPLATE_LIMIT} 字符` }
  }
  const parts = parseAddonPasteTemplate(value.template)
  if (parts === null) return { ok: false, detail: `模板引用形态非法：${value.template}` }
  const referenced = new Set(parts.filter((part): part is { slot: string } => 'slot' in part).map((part) => part.slot))
  if (!isObject(value.slots)) return { ok: false, detail: 'slots must be an object' }
  const slots: Record<string, AddonPasteSlot> = {}
  for (const [name, rawSlot] of Object.entries(value.slots)) {
    if (!SLOT_NAME_PATTERN.test(name) || name.length > SLOT_NAME_LIMIT) {
      return { ok: false, detail: `槽名非法：${name}` }
    }
    if (!isObject(rawSlot)) return { ok: false, detail: `槽 '${name}' 须为对象` }
    const unknownSlot = hasOnlyKeys(rawSlot, ['source', 'url'])
    if (unknownSlot) return { ok: false, detail: `槽 '${name}' 不支持字段 '${unknownSlot}'` }
    if (rawSlot.url !== undefined && typeof rawSlot.url !== 'boolean') {
      return { ok: false, detail: `槽 '${name}' 的 url 须为布尔` }
    }
    const rawSource = rawSlot.source
    if (!isObject(rawSource)) return { ok: false, detail: `槽 '${name}' 缺来源` }
    let source: AddonPasteSlotSource
    if (rawSource.kind === 'text') {
      const unknownSource = hasOnlyKeys(rawSource, ['kind'])
      if (unknownSource) return { ok: false, detail: `槽 '${name}' 来源不支持字段 '${unknownSource}'` }
      source = { kind: 'text' }
    } else if (rawSource.kind === 'attribute') {
      const unknownSource = hasOnlyKeys(rawSource, ['kind', 'name'])
      if (unknownSource) return { ok: false, detail: `槽 '${name}' 来源不支持字段 '${unknownSource}'` }
      if (typeof rawSource.name !== 'string' || !ATTRIBUTE_NAME_PATTERN.test(rawSource.name) || rawSource.name.length > ATTRIBUTE_NAME_LIMIT) {
        return { ok: false, detail: `槽 '${name}' 属性名非法：${String(rawSource.name)}` }
      }
      source = { kind: 'attribute', name: rawSource.name }
    } else if (rawSource.kind === 'children') {
      const unknownSource = hasOnlyKeys(rawSource, ['kind', 'rules'])
      if (unknownSource) return { ok: false, detail: `槽 '${name}' 来源不支持字段 '${unknownSource}'` }
      let rules: readonly AddonPasteNestedRule[] | undefined
      if (rawSource.rules !== undefined) {
        if (!Array.isArray(rawSource.rules)) return { ok: false, detail: `槽 '${name}' 的 rules 须为数组` }
        // 嵌套只能向子节点下降：子规则集沿用同一声明语言与校验，层号 +1
        //（计数器共享引用——嵌套子规则并入组件 256 条总量）
        const nested = validateRuleBatch(rawSource.rules, new Set<string>(), { count: budget.count, depth: budget.depth + 1 })
        if (!nested.ok) return nested
        rules = nested.rules
      }
      source = rules === undefined ? { kind: 'children' } : { kind: 'children', rules }
    } else if (rawSource.kind === 'text-regex' || rawSource.kind === 'attribute-regex') {
      const isText = rawSource.kind === 'text-regex'
      const allowedSource = isText ? ['kind', 'regex', 'group'] : ['kind', 'name', 'regex', 'group']
      const unknownSource = hasOnlyKeys(rawSource, allowedSource)
      if (unknownSource) return { ok: false, detail: `槽 '${name}' 来源不支持字段 '${unknownSource}'` }
      if (!isText) {
        if (typeof rawSource.name !== 'string' || !ATTRIBUTE_NAME_PATTERN.test(rawSource.name) || rawSource.name.length > ATTRIBUTE_NAME_LIMIT) {
          return { ok: false, detail: `槽 '${name}' 属性名非法：${String(rawSource.name)}` }
        }
      }
      const regex = validateRegex(rawSource.regex)
      if (!regex.ok) return { ok: false, detail: `槽 '${name}' ${regex.detail}` }
      const groupIssue = validateGroupRef(rawSource.group, regex.regex)
      if (groupIssue !== undefined) return { ok: false, detail: `槽 '${name}' ${groupIssue}` }
      source = isText
        ? { kind: 'text-regex', regex: regex.regex, group: rawSource.group as number | string }
        : { kind: 'attribute-regex', name: rawSource.name as string, regex: regex.regex, group: rawSource.group as number | string }
    } else {
      return { ok: false, detail: `槽 '${name}' 未知来源：${String(rawSource.kind)}` }
    }
    if (rawSlot.url === true && source.kind === 'children') {
      return { ok: false, detail: `槽 '${name}' children 来源无 URL 语义` }
    }
    slots[name] = rawSlot.url === true ? { source, url: true } : { source }
  }
  for (const name of referenced) {
    if (!Object.hasOwn(slots, name)) return { ok: false, detail: `模板引用未定义槽 '${name}'` }
  }
  for (const name of Object.keys(slots)) {
    if (!referenced.has(name)) return { ok: false, detail: `槽 '${name}' 未被模板引用` }
  }
  return { ok: true, output: { kind: 'template', template: value.template, slots } }
}

/**
 * 规则批校验（顶层与嵌套子规则集共用；ids 为本批局部 ID 集，budget 携
 * 带组件总量与当前层号）。批内 ID 重复整批拒绝，不部分安装；嵌套层级
 * 只能向子节点下降，超过深度上限整批拒绝。
 */
function validateRuleBatch(
  declarations: readonly unknown[],
  ids: ReadonlySet<string>,
  budget: OutputBudget,
): { ok: true; rules: readonly Omit<AddonPasteRule, 'addonId'>[] } | AddonPasteRuleBatchFailure {
  if (budget.depth > ADDON_PASTE_RULES_MAX_DEPTH) {
    return { ok: false, reason: 'invalid-declaration', detail: `规则嵌套深度至多 ${ADDON_PASTE_RULES_MAX_DEPTH}（只能向子节点下降）` }
  }
  const rules: Omit<AddonPasteRule, 'addonId'>[] = []
  const seen = new Set(ids)
  for (const [index, raw] of declarations.entries()) {
    if (!isObject(raw)) return { ok: false, reason: 'invalid-declaration', detail: `第 ${index + 1} 条声明须为对象` }
    const unknown = hasOnlyKeys(raw, ['id', 'priority', 'match', 'output'])
    if (unknown) return { ok: false, reason: 'invalid-declaration', detail: `声明不支持字段 '${unknown}'` }
    if (typeof raw.id !== 'string' || !RULE_ID_PATTERN.test(raw.id) || raw.id.length > RULE_ID_LIMIT) {
      return { ok: false, reason: 'invalid-declaration', detail: `规则 ID 非法：${String(raw.id)}` }
    }
    if (seen.has(raw.id)) {
      return { ok: false, reason: 'duplicate-id', detail: `规则 ID 重复：${raw.id}` }
    }
    let priority = 0
    if (raw.priority !== undefined) {
      if (typeof raw.priority !== 'number' || !Number.isInteger(raw.priority)) {
        return { ok: false, reason: 'invalid-declaration', detail: `优先级须为整数：${String(raw.priority)}` }
      }
      priority = raw.priority
    }
    const match = validateMatch(raw.match)
    if (!match.ok) return { ok: false, reason: 'invalid-declaration', detail: `第 ${index + 1} 条（${raw.id}）：${match.detail}` }
    budget.count.value += 1
    if (budget.count.value > ADDON_PASTE_RULES_MAX_PER_ADDON) {
      return { ok: false, reason: 'too-many', detail: `每组件至多 ${ADDON_PASTE_RULES_MAX_PER_ADDON} 条规则（含嵌套子规则）` }
    }
    const output = validateOutput(raw.output, budget)
    if (!output.ok) {
      if (output.reason !== undefined && output.reason !== 'invalid-declaration') {
        return { ok: false, reason: output.reason, detail: output.detail }
      }
      return { ok: false, reason: 'invalid-declaration', detail: `第 ${index + 1} 条（${raw.id}）：${output.detail}` }
    }
    seen.add(raw.id)
    rules.push({ id: raw.id, priority, match: match.match, output: output.output })
  }
  return { ok: true, rules }
}

/**
 * 整批校验（规格 §4.1：批内 ID 重复、非法正则、未知操作或超预算声明
 * 整批拒绝，不部分安装）。输入为作者原始声明（unknown）；输出为规整后
 * 的规则（addonId 由宿主注入，不在此伪造）。规则总量按「顶层 + 嵌套
 * 子规则」合计对照每组件 256 条预算。
 */
export function validateAddonPasteRuleDeclarations(
  declarations: readonly unknown[],
  context: AddonPasteRuleValidationContext = {},
): AddonPasteRuleValidationResult {
  if (!Array.isArray(declarations)) {
    return { ok: false, reason: 'invalid-declaration', detail: 'declarations must be an array' }
  }
  if (declarations.length + (context.currentCount ?? 0) > ADDON_PASTE_RULES_MAX_PER_ADDON) {
    return { ok: false, reason: 'too-many', detail: `每组件至多 ${ADDON_PASTE_RULES_MAX_PER_ADDON} 条规则` }
  }
  const budget: OutputBudget = { count: { value: context.currentCount ?? 0 }, depth: 1 }
  return validateRuleBatch(declarations, new Set(context.existingIds ?? []), budget)
}

/**
 * 递归统计规则声明总数（顶层 + children 槽内嵌套子规则逐层合计）。这是
 * 「每组件至多 256 条规则（含嵌套子规则合计）」预算的计量口径单一事实
 * 源：宿主登记簿跨批、释放与代次更迭都按本函数对当前存量计数（PR #564
 * 评审：登记簿曾只数顶层，分批登记可绕过总量上限）。
 */
export function countAddonPasteRuleDeclarations(rules: readonly (AddonPasteRule | AddonPasteNestedRule)[]): number {
  let count = 0
  const visit = (rule: AddonPasteRule | AddonPasteNestedRule): void => {
    count += 1
    if (rule.output.kind !== 'template') return
    for (const slot of Object.values(rule.output.slots)) {
      if (slot.source.kind === 'children' && slot.source.rules !== undefined) {
        for (const nested of slot.source.rules) visit(nested)
      }
    }
  }
  for (const rule of rules) visit(rule)
  return count
}

/** 求值序比较：优先级降序、（组件稳定 ID 升序）、规则稳定 ID 升序 */
const compareRuleOrder = (
  a: { priority?: number; addonId?: string; id: string },
  b: { priority?: number; addonId?: string; id: string },
): number =>
  (b.priority ?? 0) - (a.priority ?? 0) ||
  ((a.addonId ?? '') < (b.addonId ?? '') ? -1 : (a.addonId ?? '') > (b.addonId ?? '') ? 1 : 0) ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** 嵌套子规则集递归规整（子集内按优先级降序、ID 升序；同集合单组件，无 addonId 键） */
function normalizeNestedRule(rule: AddonPasteNestedRule): AddonPasteNestedRule {
  if (rule.output.kind !== 'template') return rule
  let changed = false
  const slots: Record<string, AddonPasteSlot> = {}
  for (const [name, slot] of Object.entries(rule.output.slots)) {
    const source = slot.source
    if (source.kind === 'children' && source.rules !== undefined) {
      const ordered = [...source.rules].sort(compareRuleOrder).map(normalizeNestedRule)
      changed = changed || ordered.some((item, index) => item !== source.rules![index])
      slots[name] = { ...slot, source: { kind: 'children', rules: ordered } }
    } else {
      slots[name] = slot
    }
  }
  return changed ? { ...rule, output: { ...rule.output, slots } } : rule
}

/**
 * 有效规则确定性排序（规格 §4.3）：优先级降序、组件稳定 ID 升序、规则
 * 稳定 ID 升序；缺省优先级 0。顺序不取决于异步页面脚本装载先后——宿主
 * 构造快照与页面求值共用本函数；children 槽的嵌套子规则集同步递归规整
 * （子集内同序语义，#542 T02）。
 */
export function orderAddonPasteRules(rules: readonly AddonPasteRule[]): readonly AddonPasteRule[] {
  const ordered = [...rules].sort(compareRuleOrder)
  // 嵌套子规则集递归排序（仅当存在 children 槽携带规则时重建对象）
  return ordered.map((rule) => {
    const normalized = normalizeNestedRule(rule)
    return normalized === (rule as unknown as AddonPasteNestedRule) ? rule : ({ ...normalized, addonId: rule.addonId } as AddonPasteRule)
  })
}

/** 广播到编辑器页面的有效规则快照（version 单调递增，内容等值不递增） */
export interface AddonPasteRulesSnapshot {
  readonly version: number
  readonly rules: readonly AddonPasteRule[]
}

/**
 * 条件树形状检查（守卫用，深度受 MAX_DEPTH 约束——敌意载荷不无限递归）。
 * 层号语义与注册端 validateConditionNode 对齐：组合层号从 1 起计（叶子
 * 谓词不占层号），第 16 层组合合法、第 17 层拒绝——注册成功的合法声明
 * 必能穿过本守卫（PR #564 评审：两端口径不一致曾使 16 层全量快照被弃）。
 */
function isConditionShape(value: unknown, depth: number): boolean {
  if (!isObject(value)) return false
  const keys = Object.keys(value)
  if (keys.includes('kind')) {
    const kind = value.kind
    if (kind === 'attribute') {
      return typeof value.name === 'string' && (value.value === undefined || typeof value.value === 'string')
    }
    if (kind === 'attribute-regex') {
      return typeof value.name === 'string' && isRegexShape(value.regex)
    }
    if (kind === 'text-regex') return isRegexShape(value.regex)
    return false
  }
  if (keys.length !== 1) return false
  if (keys[0] === 'not') return depth <= ADDON_PASTE_RULES_MAX_DEPTH && isConditionShape(value.not, depth + 1)
  if (keys[0] === 'all' || keys[0] === 'any') {
    if (depth > ADDON_PASTE_RULES_MAX_DEPTH) return false
    const items = value[keys[0]]
    return Array.isArray(items) && items.length > 0 && items.every((item) => isConditionShape(item, depth + 1))
  }
  return false
}

/** 正则声明形状检查（守卫用；不在此编译——求值期失败按单条规则回退） */
function isRegexShape(value: unknown): boolean {
  return isObject(value) &&
    typeof value.pattern === 'string' && value.pattern !== '' &&
    (value.flags === undefined || typeof value.flags === 'string')
}

/** 槽来源形状检查（守卫用；requireGroup 区分正则来源） */
function isSlotSourceShape(value: unknown, depth: number): boolean {
  if (!isObject(value)) return false
  if (value.kind === 'text' || value.kind === 'children') {
    if (value.kind === 'children') {
      if (value.rules !== undefined) {
        if (!Array.isArray(value.rules)) return false
        if (depth >= ADDON_PASTE_RULES_MAX_DEPTH) return false
        return value.rules.every((rule) => isRuleShape(rule, depth + 1))
      }
    }
    return true
  }
  if (value.kind === 'attribute') return typeof value.name === 'string'
  if (value.kind === 'text-regex') {
    return isRegexShape(value.regex) && (typeof value.group === 'number' || typeof value.group === 'string')
  }
  if (value.kind === 'attribute-regex') {
    return typeof value.name === 'string' && isRegexShape(value.regex) &&
      (typeof value.group === 'number' || typeof value.group === 'string')
  }
  return false
}

/** 规则形状检查（守卫用；顶层要求 addonId，嵌套规则不要求） */
function isRuleShape(value: unknown, depth: number): boolean {
  if (!isObject(value)) return false
  if (typeof value.id !== 'string' || value.id === '') return false
  if (typeof value.priority !== 'number' || !Number.isInteger(value.priority)) return false
  const match = value.match
  if (!isObject(match) || typeof match.tag !== 'string' || !TAG_PATTERN.test(match.tag)) return false
  if (match.attributes !== undefined && (!Array.isArray(match.attributes) || !match.attributes.every((condition) =>
    isObject(condition) && typeof condition.name === 'string' && ATTRIBUTE_NAME_PATTERN.test(condition.name) &&
    (condition.value === undefined || typeof condition.value === 'string'),
  ))) return false
  if (match.condition !== undefined && !isConditionShape(match.condition, 1)) return false
  const output = value.output
  if (!isObject(output)) return false
  if (output.kind === 'discard') return true
  if (output.kind !== 'template') return false
  if (typeof output.template !== 'string' || output.template === '') return false
  if (parseAddonPasteTemplate(output.template) === null) return false
  if (!isObject(output.slots)) return false
  return Object.entries(output.slots).every(([name, slot]) =>
    SLOT_NAME_PATTERN.test(name) && isObject(slot) && isSlotSourceShape(slot.source, depth) &&
    (slot.url === undefined || typeof slot.url === 'boolean'),
  )
}

/** 快照载荷守卫（协议内层单一事实源：宿主发送与 webview 接收共用） */
export function isAddonPasteRulesSnapshot(value: unknown): value is AddonPasteRulesSnapshot {
  if (!isObject(value)) return false
  if (typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 0) return false
  if (!Array.isArray(value.rules)) return false
  return value.rules.every((rule) => {
    if (!isRuleShape(rule, 1)) return false
    return isObject(rule) && typeof rule.addonId === 'string' && rule.addonId !== ''
  })
}
