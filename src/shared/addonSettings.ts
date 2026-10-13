// #353 T04 附加组件复杂设置——定义形状、值校验、作用范围解析与存储结构
// 的两端共享单一事实源（纯逻辑，不依赖 vscode/DOM）。
//
// 形状来源：ADR-0012「设置界面与作用范围」（Q21–Q23）、规格 5.4/6.2、
// 技术方案 5.5。仍是草案：字段名随公开声明冻结，不冒充已发布稳定 API。
//
// 设计决策（票面钉住）：
// - 定义**可序列化**：普通值（boolean/number/string）、有限数（min/max
//   可省略，值恒须有限）、数组项与对象字段由定义描述约束——不存在函数
//   校验器形态（消息桥传函数在宿主侧另有结构化克隆防线）。
// - **一层结构**：数组项与对象字段都是标量，不允许嵌套数组/对象。复杂
//   值走本模块独立类型命名空间（AddonSettingValue），与内置标量设置模型
//  （shared/settings.ts 的 SettingsPayloadValue）分离——内置标量类型不
//   能靠类型断言伪装成已支持复杂值。
// - 作用范围：工作区显式 > 用户默认显式 > 出厂默认；显式值非法（定义
//   升级后存量漂移）视为该层未设置，跳过继续下层，不从存储删除。
// - 存储结构冻结 version 1：`{ version, values: { [addonId]: { [key]: value } } }`。
//   解析 fail-safe：version 未知或形态不符整层回 null（宁回默认值，不写
//   回、不删除用户数据）；未来结构变更时按 version 逐版迁移入口在此扩展。
// - 跨窗口边界（1.82.3 API 面核实：Memento 无变更事件）：同窗口以宿主
//   内存为权威并主动推送；跨窗口不做实时推送，读取以新构造（重开/重启）
//   对账，并发写按最后落盘胜出——详见 addonSettingsService.ts 头注。

import { isUsableLocalizedText, type LocalizedText } from './localizedText'

/** 组件设置标量值（普通值三型） */
export type AddonSettingScalarValue = boolean | number | string

/** 枚举档位显示标签的多语言形态（#473）：直值或「语言代码→文本」映射，
 *  选值语义见 localizedText.ts（与 #464 行为名多语言惯例同构） */
export type AddonLocalizedText = LocalizedText

/** 组件设置值：标量 / 标量数组 / 字段为标量的对象（一层结构硬边界） */
export type AddonSettingValue =
  | AddonSettingScalarValue
  | readonly AddonSettingScalarValue[]
  | { readonly [field: string]: AddonSettingScalarValue }

/** 生效值来源（规格 5.4：区分出厂默认、用户默认与工作区覆盖） */
export type AddonSettingSource = 'default' | 'user' | 'workspace'

/** 标量项约束（数组 items 与对象字段共用形状；无嵌套） */
export type AddonScalarItemSpec =
  | { kind: 'boolean' }
  | { kind: 'number'; min?: number; max?: number }
  | { kind: 'string'; maxLength?: number; enum?: readonly string[] }

/** 定义公共字段（展示信息为字符串直值——组件的键不进 Vsidian 内置字典） */
interface AddonSettingDefinitionBase {
  /** 稳定标识（组件内唯一、非空；点分层级为建议不强制） */
  key: string
  /** 展示名（组件代码注册的文案直值；缺失译文时按声明的默认语言呈现） */
  title: string
  /** 可选说明 */
  description?: string
  /** #472 所属分组（组键引用——必须已在 registerDefinitions 载荷的 groups
   *  中声明；引用合法性由注册批校验，本守卫只校验字符串形状） */
  group?: string
}

/**
 * 设置分组声明（#472 引用式分组）：组元数据随注册载荷声明一次，定义以
 * `group` 组键引用。组序 = 声明序；组键组件内唯一；title/description
 * 直值或多语言映射（AddonLocalizedText，与 #464/#473 惯例同构）。
 */
export interface AddonSettingGroup {
  /** 组键（组件内唯一、非空；定义 group 字段引用此键） */
  key: string
  /** 组标题 */
  title: AddonLocalizedText
  /** 可选组说明（组卡片内首行说明色呈现） */
  description?: AddonLocalizedText
}

/** 分组声明的搜索摘要条目（#472 定义级：进全局搜索索引的轻量形状） */
export interface AddonSettingSearchEntry {
  key: string
  title: string
  description?: string
}

/** 全组件设置搜索索引（#472：addons.state 携带，webview 据此建全局搜索条目） */
export interface AddonSettingsSearchIndex {
  /** 定义摘要（注册序；object 字段级不进——定义级即止） */
  definitions: readonly AddonSettingSearchEntry[]
  /** 组声明（声明序；搜索只匹配组标题，description 仅随载荷透传） */
  groups?: readonly AddonSettingGroup[]
}

/** 组件设置定义（settings.registerDefinitions 的元素形状） */
export type AddonSettingDefinition =
  | (AddonSettingDefinitionBase & { type: 'boolean'; default: boolean })
  | (AddonSettingDefinitionBase & { type: 'number'; min?: number; max?: number; default: number })
  | (AddonSettingDefinitionBase & {
    type: 'string'
    maxLength?: number
    enum?: readonly string[]
    /** 枚举档位显示标签（#473，仅呈现层）：键 = enum 值、值 = 直值或多语言
     *  映射；缺失键/缺失整个字段回退渲染枚举值本身。不参与值校验 */
    enumLabels?: Readonly<Record<string, AddonLocalizedText>>
    /** 多行形态声明（#475，仅呈现层）：true 时设置页渲染 textarea，换行符
     *  参与持久化值；缺省/false 保持单行。仅自由文本适用——enum 定义
     *  （档位下拉）拒绝与本声明组合（形状自洽，拼错早失败）。不引入内容校验 */
    multiline?: boolean
    default: string
  })
  | (AddonSettingDefinitionBase & {
    type: 'array'
    /** 重复项约束（一层：只描述标量） */
    items: AddonScalarItemSpec
    default: readonly AddonSettingScalarValue[]
    minItems?: number
    maxItems?: number
  })
  | (AddonSettingDefinitionBase & {
    type: 'object'
    /** 字段表（字段控件的数据源；字段键唯一） */
    fields: ReadonlyArray<AddonSettingDefinitionBase & AddonScalarItemSpec & { default: AddonSettingScalarValue }>
    /** 对象出厂值（缺省按字段 default 组装；显式给出时须逐字段合法且恰好覆盖字段集） */
    default?: Readonly<Record<string, AddonSettingScalarValue>>
  })

// ---- 内部判定 ----

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isStringSpec(value: unknown): value is Extract<AddonScalarItemSpec, { kind: 'string' }> {
  if (!isRecord(value) || value.kind !== 'string') return false
  if (value.maxLength !== undefined && !(Number.isInteger(value.maxLength) && (value.maxLength as number) > 0)) return false
  if (value.enum !== undefined) {
    if (!Array.isArray(value.enum) || value.enum.length === 0) return false
    if (!value.enum.every((entry) => typeof entry === 'string')) return false
    if (new Set(value.enum).size !== value.enum.length) return false
  }
  return true
}

function isNumberSpec(value: unknown): value is Extract<AddonScalarItemSpec, { kind: 'number' }> {
  if (!isRecord(value) || value.kind !== 'number') return false
  if (value.min !== undefined && !isFiniteNumber(value.min)) return false
  if (value.max !== undefined && !isFiniteNumber(value.max)) return false
  if (value.min !== undefined && value.max !== undefined && (value.min as number) > (value.max as number)) return false
  return true
}

function isBooleanSpec(value: unknown): value is Extract<AddonScalarItemSpec, { kind: 'boolean' }> {
  return isRecord(value) && value.kind === 'boolean'
}

/** 标量项约束是否为合法形状（数组 items / 对象字段共用） */
export function isAddonScalarItemSpec(value: unknown): value is AddonScalarItemSpec {
  return isBooleanSpec(value) || isNumberSpec(value) || isStringSpec(value)
}

/** 标量值是否满足项约束（有限数恒须成立；enum 外/超长/超界拒绝） */
export function addonScalarValueMatchesSpec(value: unknown, spec: AddonScalarItemSpec): boolean {
  if (spec.kind === 'boolean') {
    return typeof value === 'boolean'
  }
  if (spec.kind === 'number') {
    if (!isFiniteNumber(value)) return false
    if (spec.min !== undefined && value < spec.min) return false
    if (spec.max !== undefined && value > spec.max) return false
    return true
  }
  if (typeof value !== 'string') return false
  if (spec.maxLength !== undefined && value.length > spec.maxLength) return false
  if (spec.enum !== undefined && !spec.enum.includes(value)) return false
  return true
}

// ---- 定义形状校验 ----

function definitionBaseValid(value: Record<string, unknown>): boolean {
  if (!(typeof value.key === 'string' && value.key.length > 0 && typeof value.title === 'string' && value.title.length > 0)) return false
  // #472 组键引用形状（非空字符串；引用已声明的组由注册批校验负责）
  if (value.group !== undefined && !(typeof value.group === 'string' && value.group.length > 0)) return false
  return true
}

/**
 * 分组声明形状守卫（#472）：key 非空字符串；title 经多语言文本守卫；
 * description 可选、同守卫。组键唯一性与定义引用合法性由服务层注册批
 * 校验（单条声明无全集上下文）。
 */
export function isAddonSettingGroupDeclaration(value: unknown): value is AddonSettingGroup {
  if (!isRecord(value)) return false
  if (!(typeof value.key === 'string' && value.key.length > 0)) return false
  if (!isUsableLocalizedText(value.title)) return false
  if (value.description !== undefined && !isUsableLocalizedText(value.description)) return false
  return true
}

/**
 * 枚举档位标签形状守卫（#473）：仅在 enum 存在时可选；键必须是 enum 成员
 * （拼错早失败——定义形状自洽），值经多语言文本守卫（直值或合法映射）。
 */
function isEnumLabelsValid(value: unknown, enumValues: readonly string[] | undefined): boolean {
  if (value === undefined) return true
  if (enumValues === undefined) return false
  if (!isRecord(value)) return false
  for (const [key, label] of Object.entries(value)) {
    if (!enumValues.includes(key)) return false
    if (!isUsableLocalizedText(label)) return false
  }
  return true
}

/** 设置定义形状校验（必需字段与约束自洽；多余字段忽略——组件升级新增元数据不炸老平台） */
export function isAddonSettingDefinition(value: unknown): value is AddonSettingDefinition {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  if (!definitionBaseValid(value)) return false
  switch (value.type) {
    case 'boolean':
      return typeof value.default === 'boolean'
    case 'number':
      return isNumberSpec({ kind: 'number', min: value.min, max: value.max }) &&
        isFiniteNumber(value.default) &&
        addonScalarValueMatchesSpec(value.default, {
          kind: 'number',
          ...(value.min !== undefined ? { min: value.min as number } : {}),
          ...(value.max !== undefined ? { max: value.max as number } : {}),
        })
    case 'string':
      return isStringSpec({ kind: 'string', maxLength: value.maxLength, enum: value.enum }) &&
        isEnumLabelsValid(value.enumLabels, value.enum as readonly string[] | undefined) &&
        (value.multiline === undefined || typeof value.multiline === 'boolean') &&
        // enum（档位下拉）与 multiline（自由文本多行）语义互斥——组合即拒绝
        !(value.multiline !== undefined && value.enum !== undefined) &&
        typeof value.default === 'string' &&
        addonScalarValueMatchesSpec(value.default, {
          kind: 'string',
          ...(value.maxLength !== undefined ? { maxLength: value.maxLength as number } : {}),
          ...(value.enum !== undefined ? { enum: value.enum as readonly string[] } : {}),
        })
    case 'array': {
      if (!isAddonScalarItemSpec(value.items)) return false
      if (!Array.isArray(value.default)) return false
      if (value.minItems !== undefined && !isFiniteNumber(value.minItems)) return false
      if (value.maxItems !== undefined && !isFiniteNumber(value.maxItems)) return false
      if (value.minItems !== undefined && value.maxItems !== undefined && (value.minItems as number) > (value.maxItems as number)) {
        return false
      }
      const items = value.items as AddonScalarItemSpec
      if (value.minItems !== undefined && value.default.length < (value.minItems as number)) return false
      if (value.maxItems !== undefined && value.default.length > (value.maxItems as number)) return false
      return value.default.every((entry) => addonScalarValueMatchesSpec(entry, items))
    }
    case 'object': {
      if (!Array.isArray(value.fields) || value.fields.length === 0) return false
      const seenKeys = new Set<string>()
      for (const field of value.fields) {
        if (!isRecord(field)) return false
        // 先取 base 字段（isRecord 收窄下可访问），再做标量项形状判定
        const fieldKey = field.key as string
        const fieldDefault = field.default
        if (!definitionBaseValid(field)) return false
        if (!isAddonScalarItemSpec(field)) return false
        if (seenKeys.has(fieldKey)) return false
        seenKeys.add(fieldKey)
        if (!addonScalarValueMatchesSpec(fieldDefault, field as AddonScalarItemSpec)) return false
      }
      if (value.default === undefined) return true
      if (!isRecord(value.default)) return false
      const objectDefault = value.default as Record<string, unknown>
      const fieldKeys = new Set(value.fields.map((field) => (field as Record<string, unknown>).key as string))
      const defaultKeys = Object.keys(objectDefault)
      if (defaultKeys.length !== fieldKeys.size || !defaultKeys.every((key) => fieldKeys.has(key))) return false
      return value.fields.every((field) => {
        const record = field as Record<string, unknown>
        return addonScalarValueMatchesSpec(objectDefault[record.key as string], field as AddonScalarItemSpec)
      })
    }
    default:
      return false
  }
}

// ---- 值校验与范围解析 ----

/** 值是否满足定义（数组/对象为一层结构：项与字段值必须是标量） */
export function addonSettingValueMatches(def: AddonSettingDefinition, value: unknown): boolean {
  switch (def.type) {
    case 'boolean':
      return typeof value === 'boolean'
    case 'number':
      return addonScalarValueMatchesSpec(value, { kind: 'number', ...(def.min !== undefined ? { min: def.min } : {}), ...(def.max !== undefined ? { max: def.max } : {}) })
    case 'string':
      return addonScalarValueMatchesSpec(value, {
        kind: 'string',
        ...(def.maxLength !== undefined ? { maxLength: def.maxLength } : {}),
        ...(def.enum !== undefined ? { enum: def.enum } : {}),
      })
    case 'array': {
      if (!Array.isArray(value)) return false
      if (def.minItems !== undefined && value.length < def.minItems) return false
      if (def.maxItems !== undefined && value.length > def.maxItems) return false
      return value.every((entry) => addonScalarValueMatchesSpec(entry, def.items))
    }
    case 'object': {
      if (!isRecord(value)) return false
      const fieldKeys = new Set(def.fields.map((field) => field.key))
      const valueKeys = Object.keys(value)
      if (valueKeys.length !== fieldKeys.size || !valueKeys.every((key) => fieldKeys.has(key))) return false
      return def.fields.every((field) => addonScalarValueMatchesSpec(value[field.key], field))
    }
  }
}

/**
 * 数组批量粘贴拆分（#475 纯函数）：按 LF/CRLF/CR 拆行、逐行 trim、丢弃
 * 空行（批量粘贴的空行是噪声）、各行经 maxLength 截断（对齐浏览器单行
 * 粘贴的截断语义）。全空输入得空数组（调用方判空跳过，不改动草稿）。
 */
export function splitAddonArrayPasteText(text: string, maxLength?: number): string[] {
  const lines: string[] = []
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const trimmed = raw.trim()
    if (trimmed.length === 0) continue
    lines.push(maxLength !== undefined && maxLength > 0 ? trimmed.slice(0, maxLength) : trimmed)
  }
  return lines
}

/** 对象定义的出厂值组装（default 缺省的单一来源：字段 default） */
export function composeObjectDefault(def: Extract<AddonSettingDefinition, { type: 'object' }>): Record<string, AddonSettingScalarValue> {
  if (def.default !== undefined) {
    return { ...def.default }
  }
  const composed: Record<string, AddonSettingScalarValue> = {}
  for (const field of def.fields) {
    composed[field.key] = field.default
  }
  return composed
}

/** 定义的出厂值（标量/数组直取；对象经 compose） */
export function addonSettingDefault(def: AddonSettingDefinition): AddonSettingValue {
  if (def.type === 'object') {
    return composeObjectDefault(def)
  }
  return def.default
}

/**
 * 作用范围解析：工作区显式合法值 > 用户默认显式合法值 > 出厂默认。
 * 显式值非法（定义升级后存量漂移）视为该层未设置——跳过继续下层，
 * 不从存储删除（存储原值保留，定义回退后自动恢复生效）。
 */
export function resolveAddonSettingLayer(
  def: AddonSettingDefinition,
  userValue: unknown,
  workspaceValue: unknown,
): { value: AddonSettingValue; source: AddonSettingSource } {
  if (workspaceValue !== undefined && addonSettingValueMatches(def, workspaceValue)) {
    return { value: workspaceValue as AddonSettingValue, source: 'workspace' }
  }
  if (userValue !== undefined && addonSettingValueMatches(def, userValue)) {
    return { value: userValue as AddonSettingValue, source: 'user' }
  }
  return { value: addonSettingDefault(def), source: 'default' }
}

// ---- 存储结构（version 1 冻结） ----

/** 存储结构版本（冻结；未来结构变更时按 version 逐版迁移） */
export const ADDON_SETTINGS_STORE_VERSION = 1

/** 持久层结构：两层同构（user = globalState / workspace = workspaceState） */
export interface AddonSettingsStoreV1 {
  readonly version: typeof ADDON_SETTINGS_STORE_VERSION
  readonly values: Readonly<Record<string, Readonly<Record<string, AddonSettingValue>>>>
}

/** 存储值形态守卫：一层 JSON 安全值（拒绝 undefined/函数/null/嵌套/非有限数） */
export function isAddonSettingStoredValue(value: unknown): value is AddonSettingValue {
  if (typeof value === 'boolean' || typeof value === 'string') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) {
    return value.every((entry) => typeof entry === 'boolean' || typeof entry === 'string' || (typeof entry === 'number' && Number.isFinite(entry)))
  }
  if (isRecord(value)) {
    return Object.values(value).every(
      (entry) => typeof entry === 'boolean' || typeof entry === 'string' || (typeof entry === 'number' && Number.isFinite(entry)),
    )
  }
  return false
}

/** 序列化整层存储（写入持久层的唯一形态） */
export function serializeAddonSettingsStore(values: Record<string, Record<string, AddonSettingValue>>): AddonSettingsStoreV1 {
  return { version: ADDON_SETTINGS_STORE_VERSION, values }
}

/**
 * 解析整层存储（fail-safe）：version 未知、形态不符或任何键的值形态非法
 * → 整层回 null（调用方按空层处理，不写回、不删除用户数据）。
 * version 1 为首个格式，无存量迁移；未来 v2 起在此按旧版逐级转换。
 */
export function parseAddonSettingsStore(raw: unknown): Record<string, Record<string, AddonSettingValue>> | null {
  if (!isRecord(raw) || raw.version !== ADDON_SETTINGS_STORE_VERSION || !isRecord(raw.values)) {
    return null
  }
  const values: Record<string, Record<string, AddonSettingValue>> = {}
  for (const [addonId, layer] of Object.entries(raw.values)) {
    if (!isRecord(layer)) return null
    const perAddon: Record<string, AddonSettingValue> = {}
    for (const [key, value] of Object.entries(layer)) {
      if (!isAddonSettingStoredValue(value)) return null
      perAddon[key] = value
    }
    values[addonId] = perAddon
  }
  return values
}
