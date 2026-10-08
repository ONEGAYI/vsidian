// #358 T09 附加组件渲染提供者契约——两端共享的类型、确定性选择纯逻辑、
// 发现批次存储与消息载荷守卫（单一事实源；不依赖 vscode/DOM/CM6）。
//
// 规则来源（已确认产品规则，不得弱化）：
// - 技术方案 5.3：选择单位是提供者，实际挂载单位是某视图中的某个代码块；
//   同批候选按稳定 ID 升序依次接管、最后一个可用候选生效，后续新增批次
//   优先；不靠脚本装载竞速，不声称拥有 VSCode 未公开的真实安装时间。
// - ADR-0012 Q28：内置实现作为候选保留；新安装、兼容且已启用组件成功
//   接入后自动替换（含内置 Mermaid）；重启、重复注册与普通升级不当作新
//   安装而重新替换；用户可按需调整并改回内置。
// - ADR-0012 Q30：正常停用与整组件故障降级停用后内置接管（无图形内置则
//   普通代码块），首选保留；仍运行的渲染 bug 不自动接管；手动恢复成功后
//   按原选择显示。
//
// 身份约定：提供者稳定 ID = `${addonId}/${rendererId}`；内置实现恒为
// 'builtin'（批次视作 0——任何新安装批次默认序上都排在其后）。
import { ADDON_DISPLAY_TEXT_MAX } from './addonCommands'
import { RENDERED_FENCE_LABELS } from './mermaid'

/** 内置提供者稳定 ID（始终可用；对内置图形语言即 graphicRenderers 注册表） */
export const BUILTIN_RENDERER_PROVIDER_ID = 'builtin'

/** 渲染提供者支持的模式（T06 统一视图口径） */
export type AddonRendererMode = 'live' | 'reading'

/** 单语言声明上限（#395 P3：语言名是围栏 info 串，64 字符已远超合理语言标记长度） */
export const ADDON_RENDERER_LANGUAGE_MAX = 64
/** 语言数组上限（#395 P3：单个提供者声明的支持语言数封顶，防异常大载荷进协议） */
export const ADDON_RENDERER_LANGUAGES_MAX = 32

/** 图形导出格式（可选能力；空数组 = 无图形导出，弹窗与导出降级） */
export type AddonRendererExportFormat = 'svg' | 'png'

/** 组件页面代码注册的提供者声明（可序列化部分——上报宿主参与选择） */
export interface AddonRendererProviderInfo {
  /** 局部稳定 ID（非空；与组件 ID 组成持久提供者身份，不以显示名作存储键） */
  rendererId: string
  /** 用户可读名称（必填——对齐行为注册「名称必填」约定） */
  label: string
  /** 支持语言（trim 后 info 全等、大小写敏感——与 RENDERED_FENCE_LABELS 同口径） */
  languages: readonly string[]
  /** 支持模式（非空子集；未支持的模式不调用其入口） */
  modes: readonly AddonRendererMode[]
  /** 图形导出能力（弹窗/导出链路的降级依据） */
  exportFormats: readonly AddonRendererExportFormat[]
}

/** 宿主侧已知候选（声明 + 归属组件） */
export interface AddonRendererCandidate extends AddonRendererProviderInfo {
  addonId: string
  /** 稳定提供者 ID：`${addonId}/${rendererId}` */
  providerId: string
}

/** 渲染挂载上下文（mount/refresh/release 回调入参；页面端执行） */
export interface AddonRendererMountContext {
  language: string
  /** 目标视图模式（组件未支持的模式不会收到调用） */
  mode: AddonRendererMode
}

/**
 * 组件页面代码注册渲染提供者的完整形状（技术方案 5.3「renderers.register」
 * 的候选草案）。回调留在 webview 内执行——桥只把可序列化声明
 * （AddonRendererProviderInfo）上报宿主参与选择；宿主的生效表广播回来后
 * 才对挂载生效（顺序由宿主决定，不靠脚本装载竞速）。
 */
export interface AddonRendererRegistration extends AddonRendererProviderInfo {
  /** 容器内挂载（同步入口；异步装载由组件自行管理，结果只进本容器——
   *  平台保证容器不跨生效代次复用，旧代次容器退场即与组件代码无关） */
  mount(container: HTMLElement, code: string, ctx: AddonRendererMountContext): void
  /** 就地刷新（热切换重派发等；缺省走 release + mount） */
  refresh?(container: HTMLElement, code: string, ctx: AddonRendererMountContext): void
  /** 释放（接管切换、容器退场、停用或故障；重复释放无害） */
  release?(container: HTMLElement, ctx: AddonRendererMountContext): void
  /** 取导出 SVG 字符串（exportFormats 含 'svg' 时必须提供；弹窗与导出共用） */
  exportSvg?(code: string, language: string): Promise<string>
}

/** SDK renderers 面（仅编辑器页提供）：登记提供者，返回释放句柄 */
export interface AddonRenderersFacet {
  /** 声明非法或代次已终结时拒绝（no-op 句柄；不构成组件故障） */
  register(spec: AddonRendererRegistration): { dispose(): void }
}

/** 发现批次与用户首选的持久化形状（v1 冻结 fail-safe） */
export interface AddonRendererStoreV1 {
  version: 1
  /** 已记录组件的发现批次（addonId → 批次号；一经记录不改写——重启/重复
   *  注册/普通升级不重新分配，新安装语义据此识别） */
  batches: Record<string, number>
  /** 下一批次号（从 1 起单调递增） */
  nextBatch: number
  /** 用户按语言的显式首选（language → providerId，含 'builtin'）；
   *  内置接管不清除——恢复后按原选择显示 */
  preferred: Record<string, string>
}

export const ADDON_RENDERERS_STORE_VERSION = 1

/** 语言规范化：trim 后全等（大小写敏感，与 isRenderedFenceInfo 同口径） */
export function normalizeRendererLanguage(language: string): string {
  return language.trim()
}

/** 提供者稳定 ID（`${addonId}/${rendererId}`） */
export function rendererProviderId(addonId: string, rendererId: string): string {
  return `${addonId}/${rendererId}`
}

/** 声明 → 候选（补归属与稳定 ID；语言 trim 归一） */
export function addonRendererCandidateOf(addonId: string, info: AddonRendererProviderInfo): AddonRendererCandidate {
  return {
    addonId,
    rendererId: info.rendererId,
    providerId: rendererProviderId(addonId, info.rendererId),
    label: info.label,
    languages: info.languages.map((l) => normalizeRendererLanguage(l)),
    modes: info.modes,
    exportFormats: info.exportFormats,
  }
}

/** 内置图形语言集（RENDERED_FENCE_LABELS 键集 = 内置提供者的支持语言） */
export function builtinRendererLanguages(): readonly string[] {
  return Object.keys(RENDERED_FENCE_LABELS)
}

/** 单语言选择结果（effective='none' = 无可用提供者且非内置语言 → 普通代码块） */
export interface AddonRendererLanguageSelection {
  language: string
  effective: string
  /** 生效来源：'user' = 用户显式首选且当前可用；'auto' = 确定性默认序 */
  source: 'user' | 'auto'
}

/** 宿主 → 编辑器 webview 的生效提供者表（广播载荷） */
export interface AddonRenderersTablePayload {
  /** 表版本（内容变化才递增；webview 等值跳过） */
  version: number
  /** 本会话已知候选（含不可用——webview 侧标签/观测用） */
  providers: readonly AddonRendererCandidate[]
  /** 逐语言生效提供者（只含被候选声明过的语言；未列语言默认内置注册表） */
  languages: readonly AddonRendererLanguageSelection[]
}

/** 选择输入（纯函数：候选、可用性谓词、内置语言、首选与批次） */
export interface RendererSelectionInput {
  candidates: readonly AddonRendererCandidate[]
  isAvailable: (candidate: AddonRendererCandidate) => boolean
  /** 内置图形语言（graphicRenderers 注册表键集） */
  builtinLanguages: readonly string[]
  preferred: Readonly<Record<string, string>>
  batches: Readonly<Record<string, number>>
}

/**
 * 确定性生效提供者选择（纯函数；技术方案 5.3 默认序 + 用户首选）：
 * - 每语言候选 = 可用附加组件候选 + 内置（仅内置图形语言）；
 * - 默认序：按 (批次升序, providerId 升序) 排列取末位生效——内置批次视作
 *   0（新安装默认接管内置语言）、同批末位 = 稳定 ID 最大者、新批次覆盖旧；
 * - 用户首选优先：首选提供者当前可用（含显式选内置）即生效且 source='user'；
 *   不可用则按默认序回退（source='auto'），首选记录不在此清除（Q30 恢复）。
 */
export function selectEffectiveRenderers(input: RendererSelectionInput): { languages: AddonRendererLanguageSelection[] } {
  const languageSet = new Set<string>()
  for (const candidate of input.candidates) {
    for (const language of candidate.languages) {
      const normalized = normalizeRendererLanguage(language)
      if (normalized !== '') {
        languageSet.add(normalized)
      }
    }
  }
  for (const language of input.builtinLanguages) {
    languageSet.add(normalizeRendererLanguage(language))
  }
  const batchOf = (candidate: AddonRendererCandidate): number => input.batches[candidate.addonId] ?? 0
  const languages: AddonRendererLanguageSelection[] = []
  for (const language of [...languageSet].sort()) {
    const available = input.candidates.filter(
      (candidate) =>
        candidate.languages.some((l) => normalizeRendererLanguage(l) === language) && input.isAvailable(candidate),
    )
    const builtinAvailable = input.builtinLanguages.some((l) => normalizeRendererLanguage(l) === language)
    const preferred = input.preferred[language]
    if (preferred === BUILTIN_RENDERER_PROVIDER_ID && builtinAvailable) {
      languages.push({ language, effective: BUILTIN_RENDERER_PROVIDER_ID, source: 'user' })
      continue
    }
    const preferredCandidate = preferred === undefined ? undefined : available.find((c) => c.providerId === preferred)
    if (preferredCandidate) {
      languages.push({ language, effective: preferredCandidate.providerId, source: 'user' })
      continue
    }
    // 确定性默认序：内置视作批次 0、ID 'builtin'，与组件候选合并排序取末位
    const ordered = [...available].sort((a, b) => batchOf(a) - batchOf(b) || (a.providerId < b.providerId ? -1 : 1))
    const last = ordered[ordered.length - 1]
    if (last !== undefined && batchOf(last) > 0) {
      languages.push({ language, effective: last.providerId, source: 'auto' })
      continue
    }
    languages.push({
      language,
      effective: builtinAvailable ? BUILTIN_RENDERER_PROVIDER_ID : 'none',
      source: 'auto',
    })
  }
  return { languages }
}

/**
 * 发现批次分配（幂等）：未见过的 addonId 依次取 nextBatch 起的递增批次；
 * 已记录的不改写（重启、重复注册与普通升级不产生新批次——新安装语义只
 * 认 Vsidian 自己的记录，不声称拿到真实安装时间）。无变化时原引用返回。
 */
export function assignDiscoveryBatches(
  store: AddonRendererStoreV1,
  addonIds: readonly string[],
): { store: AddonRendererStoreV1; changed: boolean } {
  const missing = addonIds.filter((addonId) => !(addonId in store.batches))
  if (missing.length === 0) {
    return { store, changed: false }
  }
  let nextBatch = store.nextBatch
  const batches = { ...store.batches }
  for (const addonId of missing) {
    batches[addonId] = nextBatch
    nextBatch += 1
  }
  return {
    store: { version: store.version, batches, nextBatch, preferred: { ...store.preferred } },
    changed: true,
  }
}

/** 默认空存储 */
export function emptyAddonRendererStore(): AddonRendererStoreV1 {
  return { version: ADDON_RENDERERS_STORE_VERSION, batches: {}, nextBatch: 1, preferred: {} }
}

/** 持久化内容解析（fail-safe：任何非法形态回默认空存储，不抛错） */
export function parseAddonRendererStore(value: unknown): AddonRendererStoreV1 {
  if (typeof value !== 'object' || value === null) {
    return emptyAddonRendererStore()
  }
  const record = value as Record<string, unknown>
  if (record['version'] !== ADDON_RENDERERS_STORE_VERSION) {
    return emptyAddonRendererStore()
  }
  const batches: Record<string, number> = {}
  if (typeof record['batches'] === 'object' && record['batches'] !== null) {
    for (const [addonId, batch] of Object.entries(record['batches'] as Record<string, unknown>)) {
      if (typeof batch === 'number' && Number.isInteger(batch) && batch >= 1) {
        batches[addonId] = batch
      }
    }
  }
  const preferred: Record<string, string> = {}
  if (typeof record['preferred'] === 'object' && record['preferred'] !== null) {
    for (const [language, provider] of Object.entries(record['preferred'] as Record<string, unknown>)) {
      if (typeof provider === 'string' && provider !== '') {
        preferred[language] = provider
      }
    }
  }
  const nextBatch =
    typeof record['nextBatch'] === 'number' && Number.isInteger(record['nextBatch']) && record['nextBatch'] >= 1
      ? Math.max(record['nextBatch'] as number, ...Object.values(batches).map((b) => b + 1), 1)
      : 1
  return { version: ADDON_RENDERERS_STORE_VERSION, batches, nextBatch, preferred }
}

// ---- 消息载荷守卫（消息桥 addonRenderers.* 分支消费） ----

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMode(value: unknown): value is AddonRendererMode {
  return value === 'live' || value === 'reading'
}

function isExportFormat(value: unknown): value is AddonRendererExportFormat {
  return value === 'svg' || value === 'png'
}

/** 提供者声明守卫（上报与广播共用的内层形状；#395 P3 封顶：label 256、
 *  languages 32 项且单项 64——超限整体拒绝，webview 注册与宿主上报同面生效） */
export function isAddonRendererProviderInfo(value: unknown): value is AddonRendererProviderInfo {
  if (!isRecord(value)) return false
  if (typeof value['rendererId'] !== 'string' || value['rendererId'] === '') return false
  if (typeof value['label'] !== 'string' || value['label'] === '') return false
  if (value['label'].length > ADDON_DISPLAY_TEXT_MAX) return false
  if (
    !Array.isArray(value['languages']) || value['languages'].length === 0 ||
    value['languages'].length > ADDON_RENDERER_LANGUAGES_MAX ||
    !value['languages'].every((l) => typeof l === 'string' && l.trim() !== '' && l.length <= ADDON_RENDERER_LANGUAGE_MAX)
  ) {
    return false
  }
  if (!Array.isArray(value['modes']) || value['modes'].length === 0 || !value['modes'].every(isMode)) {
    return false
  }
  if (!Array.isArray(value['exportFormats']) || !value['exportFormats'].every(isExportFormat)) {
    return false
  }
  return true
}

/** 候选守卫（表载荷内层） */
function isAddonRendererCandidate(value: unknown): value is AddonRendererCandidate {
  return isAddonRendererProviderInfo(value) && typeof (value as AddonRendererCandidate)['addonId'] === 'string' && (value as AddonRendererCandidate)['addonId'] !== ''
}

/** webview → 宿主：某组件当前装载代次内注册的提供者集（空数组 = 全部撤销） */
export interface AddonRenderersRegisteredPayload {
  addonId: string
  providers: readonly AddonRendererProviderInfo[]
}

export function isAddonRenderersRegisteredPayload(value: unknown): value is AddonRenderersRegisteredPayload {
  if (!isRecord(value)) return false
  if (typeof value['addonId'] !== 'string' || value['addonId'] === '') return false
  if (!Array.isArray(value['providers']) || !value['providers'].every(isAddonRendererProviderInfo)) {
    return false
  }
  return true
}

/** 宿主 → webview：生效提供者表守卫 */
export function isAddonRenderersTablePayload(value: unknown): value is AddonRenderersTablePayload {
  if (!isRecord(value)) return false
  if (typeof value['version'] !== 'number' || !Number.isInteger(value['version']) || value['version'] < 1) return false
  if (!Array.isArray(value['providers']) || !value['providers'].every(isAddonRendererCandidate)) return false
  if (!Array.isArray(value['languages'])) return false
  return value['languages'].every(
    (entry) =>
      isRecord(entry) &&
      typeof entry['language'] === 'string' &&
      entry['language'] !== '' &&
      typeof entry['effective'] === 'string' &&
      (entry['source'] === 'user' || entry['source'] === 'auto'),
  )
}
