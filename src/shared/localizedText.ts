// #473 枚举档位本地化标签——组件侧多语言文本的选值纯函数单一事实源。
// 语义与 #464 行为名多语言（resolveAddonBehaviorName）对齐：键规整
// trim+小写、zh 系页面语言候选链 'zh-cn'→'zh'→'en'、非 zh 只试 'en'、
// 全缺取规整后字典序最小的键（兜底非空、确定性）。
//
// addonBehaviors.ts 本批不迁移到本模块（其实现随 #464 落地，限制常量
// 与注册语义独立演进）；第三处消费方出现时再统一收口。

/** 多语言文本形态：直值（不随语言切换）或「语言代码 → 文本」映射 */
export type LocalizedText = string | Readonly<Record<string, string>>

/** 守卫上限（对齐 #464 行为名常量：文本 256 / 语言键 64 / 映射 32 项） */
export interface LocalizedTextLimits {
  readonly textLimit: number
  readonly localeKeyLimit: number
  readonly localesLimit: number
}

export const LOCALIZED_TEXT_DEFAULT_LIMITS: LocalizedTextLimits = {
  textLimit: 256,
  localeKeyLimit: 64,
  localesLimit: 32,
}

/** 语言键规整（trim + 小写——'ZH-CN' 与 ' zh-cn ' 同键） */
export function normalizeLocaleKey(key: string): string {
  return key.trim().toLowerCase()
}

/** 文本单语言口径：trim 非空且不超上限 */
function isUsableText(value: unknown, textLimit: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= textLimit
}

/**
 * 多语言文本形状守卫：直值（trim 非空、≤ textLimit）或合法映射
 * （非数组对象、1..localesLimit 项、键规整后非空且 ≤ localeKeyLimit、
 * 值同直值口径、规整后键不重复——'zh' 与 'ZH' 共存产生选值歧义，拒绝）。
 */
export function isUsableLocalizedText(value: unknown, limits: LocalizedTextLimits = LOCALIZED_TEXT_DEFAULT_LIMITS): boolean {
  if (typeof value === 'string') {
    return isUsableText(value, limits.textLimit)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length < 1 || entries.length > limits.localesLimit) {
    return false
  }
  const seen = new Set<string>()
  for (const [key, text] of entries) {
    const normalized = normalizeLocaleKey(key)
    if (normalized.length === 0 || normalized.length > limits.localeKeyLimit) {
      return false
    }
    if (!isUsableText(text, limits.textLimit)) {
      return false
    }
    if (seen.has(normalized)) {
      return false
    }
    seen.add(normalized)
  }
  return true
}

/**
 * 多语言文本选值（纯函数）：按页面语言求显示文本。
 * - 纯字符串直值原样返回；
 * - 映射形态：键规整 trim+小写；zh 系页面语言依次试 'zh-cn'、'zh'、
 *  'en'，非 zh 只试 'en'（候选链是固定清单，其余键不参与匹配）；
 * - 全部候选缺失：取规整后字典序最小的键的值（兜底非空呈现、确定性）。
 * 输入应先经守卫（合法映射至少一项）；守卫外的空映射返回空串（防御
 * 早退——不靠非空断言把 undefined 静默传播给消费方）。
 */
export function resolveLocalizedText(text: LocalizedText, localeLang: string): string {
  if (typeof text === 'string') {
    return text
  }
  const byNormalizedKey = new Map<string, string>()
  for (const [key, value] of Object.entries(text)) {
    byNormalizedKey.set(normalizeLocaleKey(key), value)
  }
  const candidates = localeLang.toLowerCase().startsWith('zh')
    ? ['zh-cn', 'zh', 'en']
    : ['en']
  for (const candidate of candidates) {
    const value = byNormalizedKey.get(candidate)
    if (value !== undefined) {
      return value
    }
  }
  if (byNormalizedKey.size === 0) {
    return ''
  }
  const fallbackKey = [...byNormalizedKey.keys()].sort()[0]!
  return byNormalizedKey.get(fallbackKey)!
}
