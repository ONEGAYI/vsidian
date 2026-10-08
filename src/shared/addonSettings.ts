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

/** 组件设置标量值（普通值三型） */
export type AddonSettingScalarValue = boolean | number | string

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
}

/** 组件设置定义（settings.registerDefinitions 的元素形状） */
export type AddonSettingDefinition =
  | (AddonSettingDefinitionBase & { type: 'boolean'; default: boolean })
  | (AddonSettingDefinitionBase & { type: 'number'; min?: number; max?: number; default: number })
  | (AddonSettingDefinitionBase & { type: 'string'; maxLength?: number; enum?: readonly string[]; default: string })
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
  return typeof value.key === 'string' && value.key.length > 0 && typeof value.title === 'string' && value.title.length > 0
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
