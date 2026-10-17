// #546 T07 统一组件主题——两端共享的类型、目录校验、唯一选择解析、
// 首选回落与页面明暗环境纯逻辑（单一事实源；不依赖 vscode/DOM/CM6）。
//
// 规则来源（规格 docs/specs/addon-themes.md + ADR-0017，不得弱化）：
// - §3.1 宿主登记：组件在 enable 生命周期登记主题元数据（稳定身份 +
//   多语言名 + 本组件提供者关联）；每个主题对同一语言只关联一个本组件
//   提供者；平台注入命名空间，不接受借主题登记改写其他组件身份；登记
//   校验与批内重复拒绝属普通 API 结果（不算组件故障）；停用、故障、
//   注销、卸载与代次结束回收目录。页面的 renderers 注册仍负责实际执行
//   代码——目录命中但候选未上报（页面未装载）时主题提供者不生效。
// - §3.2 唯一选择：profile 级全局唯一首选（默认内置 default）；主题关
//   联提供者只有其主题被选中时才参与该语言的有效选择，不能经一般渲染
//   候选路径（renderer-selection 的自动接管或用户按语言首选）绕过主题
//   单选；选中主题不可用时回落内置 default（不用其他主题顶替），保留
//   原首选并回显不可用/回落状态；恢复后按原首选继续。
// - §3.3 过渡内置预设（#535 T08 已退役）：内置枚举与实现删除，退役后
//   裸词预设值不再是内置身份，作为未知首选走目录不命中回落（保留首选；
//   无老用户存量，不做激活迁移）。
// - §4 页面明暗：四态取得亮/暗及高对比事实（亮色高对比不为暗）；通知
//   在页面缓存更新后送达（回调中再读拿到相同新状态）；重复值不重复广
//   播；代次释放自动退订；不扩充为任意 VSCode configuration 读取。
import {
  isUsableLocalizedText,
  type LocalizedText,
} from './localizedText'
import { normalizeRendererLanguage, rendererProviderId } from './addonRenderers'

/** 组件侧多语言文本形态（与设置定义/行为名同构——直值或语言映射） */
export type AddonThemeLocalizedText = LocalizedText

/** 组件内稳定主题 ID 长度上限（对齐行为/提供者局部 ID 量级） */
export const ADDON_THEME_ID_MAX = 64
/** 单主题声明语言数上限（主题面向图形语言族，远小于渲染提供者的 32） */
export const ADDON_THEME_LANGUAGES_MAX = 8

/** 组件声明的一个主题（enable 注册载荷的可序列化形状） */
export interface AddonThemeDeclaration {
  /** 组件内稳定主题 ID（非空；与组件 ID 组成持久主题身份 themeRef） */
  themeId: string
  /** 多语言显示名（直值或语言映射，全链路透传不预解析——渲染时按页面语言选值） */
  label: AddonThemeLocalizedText
  /** 关联的本组件渲染提供者（局部 rendererId；平台组合 providerId，不能跨组件） */
  rendererId: string
  /** 主题对该提供者生效的语言（trim 后全等口径，与 RENDERED_FENCE_LABELS 同源） */
  languages: readonly string[]
}

/** 宿主目录条目（声明 + 归属组件注入） */
export interface AddonThemeCandidate {
  addonId: string
  themeId: string
  /** 稳定主题身份：`${addonId}/${themeId}`（持久首选与目录寻址键） */
  themeRef: string
  label: AddonThemeLocalizedText
  rendererId: string
  /** 稳定提供者 ID：`${addonId}/${rendererId}` */
  providerId: string
  languages: readonly string[]
}

/** 稳定主题身份（themeRef） */
export function addonThemeRefOf(addonId: string, themeId: string): string {
  return `${addonId}/${themeId}`
}

/** 解析稳定主题身份；非 `a/b` 形态返回 null */
export function parseAddonThemeRef(ref: string): { addonId: string; themeId: string } | null {
  const separator = ref.indexOf('/')
  if (separator <= 0 || separator === ref.length - 1) {
    return null
  }
  return { addonId: ref.slice(0, separator), themeId: ref.slice(separator + 1) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 单条声明守卫（形状 + 上限；languages 内空串/超长拒绝） */
export function isAddonThemeDeclaration(value: unknown): value is AddonThemeDeclaration {
  if (!isRecord(value)) return false
  if (typeof value['themeId'] !== 'string' || value['themeId'].trim() === '' || value['themeId'].length > ADDON_THEME_ID_MAX) {
    return false
  }
  if (!isUsableLocalizedText(value['label'])) {
    return false
  }
  if (typeof value['rendererId'] !== 'string' || value['rendererId'].trim() === '' || value['rendererId'].length > ADDON_THEME_ID_MAX) {
    return false
  }
  if (
    !Array.isArray(value['languages']) || value['languages'].length === 0 ||
    value['languages'].length > ADDON_THEME_LANGUAGES_MAX ||
    !value['languages'].every(
      (l) => typeof l === 'string' && l.trim() !== '' && l.length <= 64,
    )
  ) {
    return false
  }
  return true
}

/**
 * 批内校验（普通 API 结果的判据）：任一条目形状非法 → invalid-theme；
 * 同批 themeId 重复（同一主题两次声明）→ duplicate-theme。整批拒绝。
 */
export function validateAddonThemeBatch(declarations: readonly unknown[]): 'ok' | 'invalid-theme' | 'duplicate-theme' {
  if (!Array.isArray(declarations)) return 'invalid-theme'
  const seenThemeIds = new Set<string>()
  for (const value of declarations) {
    if (!isAddonThemeDeclaration(value)) {
      return 'invalid-theme'
    }
    const decl = value as AddonThemeDeclaration
    if (seenThemeIds.has(decl.themeId)) {
      return 'duplicate-theme'
    }
    seenThemeIds.add(decl.themeId)
  }
  return 'ok'
}

/** 声明 → 目录候选（注入归属与稳定身份；语言 trim 归一） */
export function addonThemeCandidateOf(addonId: string, decl: AddonThemeDeclaration): AddonThemeCandidate {
  return {
    addonId,
    themeId: decl.themeId,
    themeRef: addonThemeRefOf(addonId, decl.themeId),
    label: typeof decl.label === 'string' ? decl.label : { ...decl.label },
    rendererId: decl.rendererId,
    providerId: rendererProviderId(addonId, decl.rendererId),
    languages: decl.languages.map((l) => normalizeRendererLanguage(l)),
  }
}

// ---- 唯一首选与回落 ----

/** 内置默认主题身份（内置显示；始终可用） */
export const DEFAULT_THEME_ID = 'default'

/**
 * 内核过渡 Codex 主题身份（v1.1.0 已发行导出）。
 *
 * @deprecated #535 T08 内核 Codex 退役：'codex' 不再是内置主题身份，
 * 本常量仅为 v1.1.0 调用形状兼容保留（弃用与移除受双门槛约束：两个
 * 后续 API 次版本且满 30 天）。存量旧值在扩展激活时经原始 overlay
 * 迁移回落 default 并引导（shared/codexMigration）；新代码不要引用。
 */
export const CODEX_THEME_ID = 'codex'

/**
 * 首选解析现行语义（内部实现，非导出面）：appearance.theme 是唯一权威
 * ——值非 default 且非空时原样生效；default / 缺失 / 空串回落 default。
 */
function resolvePreferredThemeValue(themeValue: string | undefined): string {
  if (typeof themeValue === 'string' && themeValue.trim() !== '' && themeValue !== DEFAULT_THEME_ID) {
    return themeValue
  }
  return DEFAULT_THEME_ID
}

/**
 * 首选解析（纯函数；v1.1.0 兼容调用形状）。#546 T07 曾有「新键 default
 * 且旧 Mermaid 键 codex 回显 codex」的过渡分支，#535 T08 退役后删除：
 * 不做激活迁移与引导（2026-10-17 用户终局裁决，规格 addon-themes.md
 * §10.0）——存量旧值按目录不命中的未知首选回落 default 显示。
 *
 * @param legacyMermaidValue 旧键 `appearance.mermaidTheme` 的取值。
 *   @deprecated #535 后旧键设置定义已删除、不再参与首选解析——传任何
 *   值（含 'codex'）都不影响结果，参数仅为 v1.1.0 双参调用形状兼容
 *   保留；新代码单参调用即可。
 */
export function resolveThemePreferred(
  themeValue: string | undefined,
  legacyMermaidValue?: string | undefined,
): string {
  void legacyMermaidValue
  return resolvePreferredThemeValue(themeValue)
}

/** 主题选择解析输入 */
export interface AddonThemeSelectionInput {
  /** 宿主目录全集 */
  themes: readonly AddonThemeCandidate[]
  /** 用户唯一首选（resolveThemePreferred 的产物：default / themeRef） */
  preferred: string
  /** 目录条目可用性（组件 enabled 且未故障；候选是否已上报由渲染选择层另行判定） */
  isThemeAvailable: (theme: AddonThemeCandidate) => boolean
}

/** 主题选择解析结果 */
export interface AddonThemeSelection {
  /** 原样保留的首选（不可用不清除——恢复后按原选择继续） */
  preferred: string
  /** 首选组件主题当前是否可用（default 恒 true） */
  available: boolean
  /** 实际生效主题（回落后）：default / themeRef */
  effective: string
  /** 生效主题关联的提供者 ID（仅组件主题生效时在场；渲染选择层注入） */
  activeProviderId?: string
  /** 选中主题声明的语言；提供者支持的额外语言不会随主题一并接管 */
  activeLanguages?: readonly string[]
}

/**
 * 唯一选择与回落解析（纯函数）：
 * - default（内置）：恒可用、effective 同值；
 * - themeRef：目录命中且可用 → 生效该主题（activeProviderId 给渲染选择
 *   层注入）；命中但不可用（组件停用/故障）→ 回落内置 default 显示，
 *   preferred 保留、available=false；目录不命中（组件卸载/未注册，含
 *   #535 退役后的 codex 历史值）→ 同回落（保留首选，恢复注册后继续原
 *   选择）。
 * 回落一律回 default——不用另一组件主题顶替（规格 §3.2：不静默选中另
 * 一主题）。
 */
export function resolveActiveTheme(input: AddonThemeSelectionInput): AddonThemeSelection {
  const { preferred } = input
  if (preferred === DEFAULT_THEME_ID) {
    return { preferred, available: true, effective: preferred }
  }
  const theme = input.themes.find((t) => t.themeRef === preferred)
  if (theme && input.isThemeAvailable(theme)) {
    return { preferred, available: true, effective: preferred, activeProviderId: theme.providerId, activeLanguages: theme.languages }
  }
  return { preferred, available: false, effective: DEFAULT_THEME_ID }
}

/** 目录全集中主题关联的提供者 ID 集（渲染选择层的排除表） */
export function themedProviderIdsOf(themes: readonly AddonThemeCandidate[]): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const theme of themes) {
    ids.add(theme.providerId)
  }
  return ids
}

// ---- 页面明暗环境（编辑器页 SDK 只读面） ----

/**
 * VSCode 实际生效主题四态（vscode.ColorThemeKind 的可序列化投影）。
 * 状态来源是实际生效主题——手动固定暗色时系统变亮仍为暗；跟随系统时
 * 随系统变化（由宿主事件驱动）。
 */
export type AddonThemeEnvironmentKind = 'light' | 'dark' | 'high-contrast' | 'high-contrast-light'

/** 明暗快照（四态两轴投影；亮色高对比 ≠ 暗） */
export interface AddonThemeEnvironment {
  /** 暗色：dark 与暗色高对比为 true；亮色与亮色高对比为 false */
  readonly dark: boolean
  /** 高对比：两种高对比形态为 true */
  readonly highContrast: boolean
}

/** 四态 → 快照（纯函数；「亮色高对比不误判为暗」的单一判定点） */
export function addonThemeEnvironmentOf(kind: AddonThemeEnvironmentKind): AddonThemeEnvironment {
  switch (kind) {
    case 'dark':
      return { dark: true, highContrast: false }
    case 'high-contrast':
      return { dark: true, highContrast: true }
    case 'high-contrast-light':
      return { dark: false, highContrast: true }
    case 'light':
      return { dark: false, highContrast: false }
  }
}

/** 快照相等（重复值不广播的判据） */
export function addonThemeEnvironmentEqual(a: AddonThemeEnvironment, b: AddonThemeEnvironment): boolean {
  return a.dark === b.dark && a.highContrast === b.highContrast
}

/** SDK 只读面（仅编辑器页提供）：同步快照 + 变化订阅（重复值不通知；
 *  代次释放自动退订；通知在页面缓存更新后送达——回调中 get 拿新值） */
export interface AddonThemeEnvironmentFacet {
  get(): AddonThemeEnvironment
  onChange(listener: (env: AddonThemeEnvironment) => void): () => void
}

/** 宿主 → 编辑器 webview 明暗快照消息载荷守卫 */
export function isAddonThemeEnvironmentPayload(value: unknown): value is AddonThemeEnvironment {
  return (
    isRecord(value) &&
    typeof value['dark'] === 'boolean' &&
    typeof value['highContrast'] === 'boolean'
  )
}

// ---- 目录载荷（宿主 → 设置页） ----

/** 目录条目可用性标注（设置页呈现「不可用/回落」状态的判据） */
export interface AddonThemeEntryState extends AddonThemeCandidate {
  /** 归属组件当前可用（enabled 且未故障） */
  available: boolean
}

/** 宿主 → 设置页的主题目录状态载荷 */
export interface AddonThemesStatePayload {
  /** 目录代次（内容变化才递增；设置页等值跳过） */
  version: number
  /** 组件主题目录（含不可用条目——呈现不可用状态而非隐藏） */
  themes: readonly AddonThemeEntryState[]
  /** 当前唯一首选（resolveThemePreferred 产物；不可用时保留） */
  preferred: string
  /** 首选组件主题当前可用（default 恒 true） */
  preferredAvailable: boolean
}

function isAddonThemeEntryState(value: unknown): value is AddonThemeEntryState {
  return (
    isRecord(value) &&
    typeof value['addonId'] === 'string' && value['addonId'] !== '' &&
    typeof value['themeId'] === 'string' && value['themeId'] !== '' &&
    typeof value['themeRef'] === 'string' && value['themeRef'] !== '' &&
    isUsableLocalizedText(value['label']) &&
    typeof value['rendererId'] === 'string' && value['rendererId'] !== '' &&
    typeof value['providerId'] === 'string' && value['providerId'] !== '' &&
    Array.isArray(value['languages']) &&
    typeof value['available'] === 'boolean'
  )
}

/** 目录状态载荷守卫（消息桥消费） */
export function isAddonThemesStatePayload(value: unknown): value is AddonThemesStatePayload {
  if (!isRecord(value)) return false
  if (typeof value['version'] !== 'number' || !Number.isInteger(value['version']) || value['version'] < 0) return false
  if (!Array.isArray(value['themes']) || !value['themes'].every(isAddonThemeEntryState)) return false
  if (typeof value['preferred'] !== 'string' || value['preferred'] === '') return false
  if (typeof value['preferredAvailable'] !== 'boolean') return false
  return true
}

// ---- enable 生命周期注册面 ----

/** 主题注册结果：ok=false 时 dispose 为 no-op（登记校验与批内重复拒绝属普通 API 结果，不算组件故障） */
export type AddonThemeRegisterOutcome =
  | { ok: true; dispose(): void }
  | { ok: false; reason: 'invalid-theme' | 'duplicate-theme'; dispose(): void }

/** enable 上下文的主题注册面（组件宿主代码声明主题元数据——目录与
 *  选择归平台，实际渲染执行仍归页面 renderers 注册） */
export interface AddonThemesRegistrationFacet {
  register(declarations: readonly unknown[]): AddonThemeRegisterOutcome
}
