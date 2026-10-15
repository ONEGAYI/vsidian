// #541 T01 附加组件声明式粘贴规则——共享声明、校验、排序与快照单一事实源。
//
// 事实源：docs/specs/addon-paste-conversion.md（#530 规格冻结）与实施票
// #541（T01 基础链路）。本模块为两端共享纯逻辑：宿主校验（注册时整批
// 拒绝）与页面解释（转换遍历消费）使用同一声明形态，不在两端各写一套
// 规则语言；不依赖 DOM 或 vscode。
//
// 边界（规格 §4）：
// - 规则是可序列化数据；T01 只交付基础匹配（标签/属性存在/属性值相等）、
//   基础取值（元素文本/指定属性/子内容转换结果）与模板槽产出（字面转义/
//   URL 策略/子转换拼接）。正则、条件组合与嵌套转换属 T02（#542）——
//   未知字段一律显式拒绝（invalid-declaration），不静默当成基础声明。
// - 缺失与空字符串区分：属性条件缺 value = 存在性；value 为空串 = 值
//   相等条件。取值侧：属性缺失（getAttribute 为 null）与文本/子内容为
//   空串都是「必需取值缺失」，本规则失败进入下一条。
// - 预算常量集中在此（规格 §4.4）：宿主与页面不得各自取值。

/** 规则声明每组件数量上限（规格 §4.4：每组件至多 256 条） */
export const ADDON_PASTE_RULES_MAX_PER_ADDON = 256

/** 表达式嵌套深度上限（T02 消费；常量随本模块集中定义并测试边界） */
export const ADDON_PASTE_RULES_MAX_DEPTH = 16

/** 每次粘贴累计规则/表达式求值步数上限（超限停用规则，内置转换继续） */
export const ADDON_PASTE_RULES_EVAL_STEP_BUDGET = 100_000

/** 规则稳定局部 ID 上限（对齐 BEHAVIOR_LOCAL_ID_LIMIT 口径） */
const RULE_ID_LIMIT = 128
/** 局部 ID 字符集（首字符字母数字；禁点号——防伪造跨组件身份） */
const RULE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
/** 优先级量级边界（防滥用；缺省 0，规格允许任意整数优先级语义） */
const PRIORITY_LIMIT = 10_000
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

/** 槽引用形态：{{name}}；名字受限以保模板切分无歧义 */
const TEMPLATE_REF_PATTERN = /\{\{([A-Za-z][A-Za-z0-9_-]*)\}\}/g

/** 属性匹配条件：缺 value = 存在性要求；value = 值相等（空串合法） */
export interface AddonPasteRuleAttributeCondition {
  readonly name: string
  readonly value?: string
}

/** 基础匹配：标签名相等 + 属性条件全与（条件组合 all/any/not 属 T02） */
export interface AddonPasteRuleMatch {
  /** 标签名（大写形态与 DOM tagName 对齐；校验时规整） */
  readonly tag: string
  /** 属性条件列表（全部满足才匹配；至多 8 条） */
  readonly attributes?: readonly AddonPasteRuleAttributeCondition[]
}

/** 槽取值来源（正则来源与捕获组属 T02） */
export type AddonPasteSlotSource =
  | { readonly kind: 'text' }
  | { readonly kind: 'attribute'; readonly name: string }
  | { readonly kind: 'children' }

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

/** 校验上下文：现有计数与已占用 ID（重复与超预算判定用） */
export interface AddonPasteRuleValidationContext {
  existingIds?: ReadonlySet<string>
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

/** 严格字段集校验：未知键（含 T02 高级节点）显式拒绝 */
function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): string | undefined {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return key
  }
  return undefined
}

function validateMatch(value: unknown): { ok: true; match: AddonPasteRuleMatch } | { ok: false; detail: string } {
  if (!isObject(value)) return { ok: false, detail: 'match 须为对象' }
  const unknown = hasOnlyKeys(value, ['tag', 'attributes'])
  if (unknown) return { ok: false, detail: `match 不支持字段 '${unknown}'（正则/条件/嵌套属后续版本）` }
  if (typeof value.tag !== 'string' || !TAG_PATTERN.test(value.tag)) {
    return { ok: false, detail: `match.tag 非法：${String(value.tag)}` }
  }
  let attributes: readonly AddonPasteRuleAttributeCondition[] | undefined
  if (value.attributes !== undefined) {
    if (!Array.isArray(value.attributes)) return { ok: false, detail: 'match.attributes 须为数组' }
    if (value.attributes.length > ATTRIBUTE_CONDITIONS_LIMIT) {
      return { ok: false, detail: `match.attributes 至多 ${ATTRIBUTE_CONDITIONS_LIMIT} 条` }
    }
    const conditions: AddonPasteRuleAttributeCondition[] = []
    for (const raw of value.attributes) {
      if (!isObject(raw)) return { ok: false, detail: '属性条件须为对象' }
      const unknownCondition = hasOnlyKeys(raw, ['name', 'value'])
      if (unknownCondition) return { ok: false, detail: `属性条件不支持字段 '${unknownCondition}'` }
      if (typeof raw.name !== 'string' || !ATTRIBUTE_NAME_PATTERN.test(raw.name) || raw.name.length > ATTRIBUTE_NAME_LIMIT) {
        return { ok: false, detail: `属性名非法：${String(raw.name)}` }
      }
      if (raw.value !== undefined && typeof raw.value !== 'string') return { ok: false, detail: '属性条件 value 须为字符串' }
      if (typeof raw.value === 'string' && raw.value.length > ATTRIBUTE_VALUE_LIMIT) {
        return { ok: false, detail: `属性值超长（>${ATTRIBUTE_VALUE_LIMIT}）` }
      }
      conditions.push(raw.value === undefined ? { name: raw.name } : { name: raw.name, value: raw.value })
    }
    attributes = conditions
  }
  return { ok: true, match: attributes === undefined ? { tag: value.tag.toUpperCase() } : { tag: value.tag.toUpperCase(), attributes } }
}

function validateOutput(value: unknown): { ok: true; output: AddonPasteRuleOutput } | { ok: false; detail: string } {
  if (!isObject(value)) return { ok: false, detail: 'output 须为对象' }
  if (value.kind === 'discard') {
    const unknown = hasOnlyKeys(value, ['kind'])
    if (unknown) return { ok: false, detail: `discard 产出不支持字段 '${unknown}'` }
    return { ok: true, output: { kind: 'discard' } }
  }
  if (value.kind !== 'template') {
    return { ok: false, detail: `未知产出操作：${String(value.kind)}` }
  }
  const unknown = hasOnlyKeys(value, ['kind', 'template', 'slots'])
  if (unknown) return { ok: false, detail: `template 产出不支持字段 '${unknown}'（嵌套转换属后续版本）` }
  if (typeof value.template !== 'string' || value.template.length === 0 || value.template.length > TEMPLATE_LIMIT) {
    return { ok: false, detail: `template 非空字符串且至多 ${TEMPLATE_LIMIT} 字符` }
  }
  const parts = parseAddonPasteTemplate(value.template)
  if (parts === null) return { ok: false, detail: `模板引用形态非法：${value.template}` }
  const referenced = new Set(parts.filter((part): part is { slot: string } => 'slot' in part).map((part) => part.slot))
  if (!isObject(value.slots)) return { ok: false, detail: 'slots 须为对象' }
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
      const unknownSource = hasOnlyKeys(rawSource, ['kind'])
      if (unknownSource) return { ok: false, detail: `槽 '${name}' 来源不支持字段 '${unknownSource}'` }
      source = { kind: 'children' }
    } else {
      return { ok: false, detail: `槽 '${name}' 未知来源：${String(rawSource.kind)}` }
    }
    if (rawSlot.url === true && source.kind === 'children') {
      return { ok: false, detail: `槽 '${name}' children 来源无 URL 语义` }
    }
    slots[name] = rawSlot.url === true ? { source, url: true } : { source }
  }
  for (const name of referenced) {
    if (!(name in slots)) return { ok: false, detail: `模板引用未定义槽 '${name}'` }
  }
  for (const name of Object.keys(slots)) {
    if (!referenced.has(name)) return { ok: false, detail: `槽 '${name}' 未被模板引用` }
  }
  return { ok: true, output: { kind: 'template', template: value.template, slots } }
}

/**
 * 整批校验（规格 §4.1：批内 ID 重复、非法正则、未知操作或超预算声明
 * 整批拒绝，不部分安装）。输入为作者原始声明（unknown）；输出为规整后
 * 的规则（addonId 由宿主注入，不在此伪造）。
 */
export function validateAddonPasteRuleDeclarations(
  declarations: readonly unknown[],
  context: AddonPasteRuleValidationContext = {},
): AddonPasteRuleValidationResult {
  if (!Array.isArray(declarations)) {
    return { ok: false, reason: 'invalid-declaration', detail: '声明列表须为数组' }
  }
  if (declarations.length + (context.currentCount ?? 0) > ADDON_PASTE_RULES_MAX_PER_ADDON) {
    return { ok: false, reason: 'too-many', detail: `每组件至多 ${ADDON_PASTE_RULES_MAX_PER_ADDON} 条规则` }
  }
  const rules: Omit<AddonPasteRule, 'addonId'>[] = []
  const seen = new Set<string>(context.existingIds ?? [])
  for (const [index, raw] of declarations.entries()) {
    if (!isObject(raw)) return { ok: false, reason: 'invalid-declaration', detail: `第 ${index + 1} 条声明须为对象` }
    const unknown = hasOnlyKeys(raw, ['id', 'priority', 'match', 'output'])
    if (unknown) return { ok: false, reason: 'invalid-declaration', detail: `声明不支持字段 '${unknown}'（条件/嵌套属后续版本）` }
    if (typeof raw.id !== 'string' || !RULE_ID_PATTERN.test(raw.id) || raw.id.length > RULE_ID_LIMIT) {
      return { ok: false, reason: 'invalid-declaration', detail: `规则 ID 非法：${String(raw.id)}` }
    }
    if (seen.has(raw.id)) {
      return { ok: false, reason: 'duplicate-id', detail: `规则 ID 重复：${raw.id}` }
    }
    let priority = 0
    if (raw.priority !== undefined) {
      if (typeof raw.priority !== 'number' || !Number.isInteger(raw.priority) || Math.abs(raw.priority) > PRIORITY_LIMIT) {
        return { ok: false, reason: 'invalid-declaration', detail: `优先级须为 |n|≤${PRIORITY_LIMIT} 的整数：${String(raw.priority)}` }
      }
      priority = raw.priority
    }
    const match = validateMatch(raw.match)
    if (!match.ok) return { ok: false, reason: 'invalid-declaration', detail: `第 ${index + 1} 条（${raw.id}）：${match.detail}` }
    const output = validateOutput(raw.output)
    if (!output.ok) return { ok: false, reason: 'invalid-declaration', detail: `第 ${index + 1} 条（${raw.id}）：${output.detail}` }
    seen.add(raw.id)
    rules.push({ id: raw.id, priority, match: match.match, output: output.output })
  }
  return { ok: true, rules }
}

/**
 * 有效规则确定性排序（规格 §4.3）：优先级降序、组件稳定 ID 升序、规则
 * 稳定 ID 升序；缺省优先级 0。顺序不取决于异步页面脚本装载先后——宿主
 * 构造快照与页面求值共用本函数。
 */
export function orderAddonPasteRules(rules: readonly AddonPasteRule[]): readonly AddonPasteRule[] {
  return [...rules].sort((a, b) =>
    b.priority - a.priority ||
    (a.addonId < b.addonId ? -1 : a.addonId > b.addonId ? 1 : 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

/** 广播到编辑器页面的有效规则快照（version 单调递增，内容等值不递增） */
export interface AddonPasteRulesSnapshot {
  readonly version: number
  readonly rules: readonly AddonPasteRule[]
}

/** 快照载荷守卫（协议内层单一事实源：宿主发送与 webview 接收共用） */
export function isAddonPasteRulesSnapshot(value: unknown): value is AddonPasteRulesSnapshot {
  if (!isObject(value)) return false
  if (typeof value.version !== 'number' || !Number.isInteger(value.version) || value.version < 0) return false
  if (!Array.isArray(value.rules)) return false
  return value.rules.every((rule) => {
    if (!isObject(rule)) return false
    if (typeof rule.addonId !== 'string' || rule.addonId === '') return false
    if (typeof rule.id !== 'string' || rule.id === '') return false
    if (typeof rule.priority !== 'number' || !Number.isInteger(rule.priority)) return false
    const match = rule.match
    if (!isObject(match) || typeof match.tag !== 'string' || !TAG_PATTERN.test(match.tag)) return false
    if (match.attributes !== undefined && (!Array.isArray(match.attributes) || !match.attributes.every((condition) =>
      isObject(condition) && typeof condition.name === 'string' && ATTRIBUTE_NAME_PATTERN.test(condition.name) &&
      (condition.value === undefined || typeof condition.value === 'string'),
    ))) return false
    const output = rule.output
    if (!isObject(output)) return false
    if (output.kind === 'discard') return true
    if (output.kind !== 'template') return false
    if (typeof output.template !== 'string' || output.template === '') return false
    if (parseAddonPasteTemplate(output.template) === null) return false
    if (!isObject(output.slots)) return false
    return Object.entries(output.slots).every(([name, slot]) =>
      SLOT_NAME_PATTERN.test(name) && isObject(slot) && isObject(slot.source) &&
      (slot.source.kind === 'text' || slot.source.kind === 'children' ||
        (slot.source.kind === 'attribute' && typeof slot.source.name === 'string')) &&
      (slot.url === undefined || typeof slot.url === 'boolean'),
    )
  })
}
