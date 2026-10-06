// #350 T01 附加组件身份声明与兼容判定（纯逻辑，两端共享基础）。
//
// 事实源：docs/design/vsidian-addon-api.md 第 2 节（2026-10-05 技术提议；
// T01 起落地为生产代码路径，但 API 形状仍是草案——首个候选稳定 API 版本
// 1.0.0 尚未发布，本模块不冒充已发布契约）。
//
// 约定（ADR-0012）：
// - 身份声明只增加一个顶层私有清单字段 vsidianAddon（VSCode 侧不是正式
//   contributes 贡献点，由 Vsidian 自行解析）；组件唯一 ID 沿用 VSCode
//   Extension.id（publisher.name），不在私有清单重复维护；keywords 仅市场
//   搜索辅助，不据此接受接入或认定官方身份。
// - 清单不列输入处理、渲染器、命令、设置或第二套激活条件——能力由组件
//   代码经注册入口表达。
// - 官方组件来自主仓库维护的明确扩展 ID 清单；组件不能自行声明「核心」。
import {
  isValidSemverRange,
  satisfiesSemverRange,
} from './semverRange'

// 范围求值随身份声明一并暴露（兼容判定的公开消费面聚合在本模块）
export { satisfiesSemverRange } from './semverRange'

/** 私有身份声明字段名（package.json 顶层） */
export const ADDON_MANIFEST_FIELD = 'vsidianAddon'

/** 身份声明格式版本（与公开 API 版本分开） */
export const ADDON_IDENTITY_MANIFEST_VERSION = 1

/**
 * 首个候选稳定 API 版本（`^1.0.0` 语义的基准）。当前不存在已发布的公开
 * API——附加组件声明的 api 范围须包含该版本才判兼容；API 版本独立于
 * Vsidian 本体版本号。
 */
export const ADDON_API_VERSION = '1.0.0'

/**
 * 官方（核心）附加组件的扩展 ID 清单：主仓库维护，用于设置页来源分组。
 * 初版为空——清单结构即占位，登记新官方组件只改本表；第三方组件不能自行
 * 声明官方身份（keywords 不参与归属判定）。
 */
export const OFFICIAL_ADDON_EXTENSION_IDS: readonly string[] = []

/** 官方归属判定（唯一入口，来源限于上表） */
export function isOfficialAddon(extensionId: string): boolean {
  return OFFICIAL_ADDON_EXTENSION_IDS.includes(extensionId)
}

/** 合法身份声明形状 */
export interface AddonIdentityDeclaration {
  /** 声明格式版本（当前仅支持 1） */
  manifestVersion: number
  /** 支持的稳定 API 范围（semver range 子集，如 '^1.0.0'） */
  api: string
  /** 确有使用时才声明的实验入口兼容范围（入口名 → 版本范围） */
  experimental?: Readonly<Record<string, string>>
}

/** 声明解析结果：none = 普通扩展（无声明，不入组件列表） */
export type AddonDeclarationParseResult =
  | { kind: 'none' }
  | {
      kind: 'invalid'
      /** 拒绝原因（呈现层组句用） */
      reason: 'field-not-object' | 'manifest-version-unsupported' | 'api-invalid' | 'experimental-invalid'
    }
  | { kind: 'ok'; declaration: AddonIdentityDeclaration }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 解析扩展清单中的私有身份声明。非法形状不抛出——返回 invalid 携带原因，
 *  供状态列表呈现「声明不合法」而非静默忽略或崩溃。 */
export function parseAddonDeclaration(packageJSON: unknown): AddonDeclarationParseResult {
  if (!isRecord(packageJSON)) {
    return { kind: 'none' }
  }
  const raw = packageJSON[ADDON_MANIFEST_FIELD]
  if (raw === undefined) {
    return { kind: 'none' }
  }
  if (!isRecord(raw)) {
    return { kind: 'invalid', reason: 'field-not-object' }
  }
  if (raw.manifestVersion !== ADDON_IDENTITY_MANIFEST_VERSION) {
    return { kind: 'invalid', reason: 'manifest-version-unsupported' }
  }
  if (typeof raw.api !== 'string' || !isUsableRange(raw.api)) {
    return { kind: 'invalid', reason: 'api-invalid' }
  }
  const declaration: AddonIdentityDeclaration = { manifestVersion: ADDON_IDENTITY_MANIFEST_VERSION, api: raw.api }
  if (raw.experimental !== undefined) {
    if (!isRecord(raw.experimental)) {
      return { kind: 'invalid', reason: 'experimental-invalid' }
    }
    const experimental: Record<string, string> = {}
    for (const [entry, range] of Object.entries(raw.experimental)) {
      if (typeof range !== 'string' || !isUsableRange(range)) {
        return { kind: 'invalid', reason: 'experimental-invalid' }
      }
      experimental[entry] = range
    }
    declaration.experimental = experimental
  }
  return { kind: 'ok', declaration }
}

/** 范围可用性：解析器能识别且非空（不预判兼容——兼容由 checkAddonCompatibility） */
function isUsableRange(range: string): boolean {
  return range.trim().length > 0 && isValidSemverRange(range)
}

/** 兼容判定的宿主侧输入 */
export interface AddonCompatibilityHost {
  /** 宿主当前提供的稳定 API 版本 */
  apiVersion: string
  /** 宿主当前支持的实验入口表（入口名 → 宿主侧版本范围；未发布的入口不在表内） */
  experimental: Readonly<Record<string, string>>
}

export type AddonCompatibility =
  | { compatible: true }
  | {
      compatible: false
      reason: 'api-range' | 'experimental-unsupported' | 'experimental-incompatible'
      /** experimental 拒绝时点名入口名 */
      entry?: string
    }

/** 兼容判定：声明范围须包含宿主稳定 API 版本；声明的实验入口须宿主已提供
 *  且版本匹配。当前宿主实验入口表为空——任何 experimental 声明都会被判
 *  experimental-unsupported（如实反映「实验入口未发布」）。 */
export function checkAddonCompatibility(
  declaration: AddonIdentityDeclaration,
  host: AddonCompatibilityHost,
): AddonCompatibility {
  if (!satisfiesSemverRange(declaration.api, host.apiVersion)) {
    return { compatible: false, reason: 'api-range' }
  }
  for (const [entry, range] of Object.entries(declaration.experimental ?? {})) {
    const hosted = host.experimental[entry]
    if (hosted === undefined) {
      return { compatible: false, reason: 'experimental-unsupported', entry }
    }
    if (!satisfiesSemverRange(range, hosted)) {
      return { compatible: false, reason: 'experimental-incompatible', entry }
    }
  }
  return { compatible: true }
}

/** 注册入口拒绝原因（公开协议结果；详见 design 文档第 2.2 节） */
export type AddonRegisterRejection =
  /** 调用者扩展无合法身份声明（普通扩展或声明形状非法） */
  | 'not-addon-extension'
  /** 当前扩展宿主查不到调用者扩展（不等于未安装或装错侧） */
  | 'extension-not-in-host'
  /** 声明合法但 API 范围/实验兼容与宿主不符 */
  | 'incompatible-api'
  /** 同一接入代次重复注册（不重跑 setup；手动重试先释放旧代次） */
  | 'already-registered'

/** 注册成功时返回给组件的接入上下文（轻量形状，后续票扩展） */
export interface AddonRegistrationContext {
  addonId: string
  apiVersion: string
}

export type AddonRegistrationResult =
  | { ok: true; addon: AddonRegistrationContext }
  | { ok: false; reason: AddonRegisterRejection; detail?: string }

/** 设置页状态列表条目（发现/注册协调的呈现载荷；协议 addons.state 使用） */
export type AddonStatusKind =
  /** 已注册（setup 已在本接入代次执行） */
  | 'registered'
  /** 唤醒在途（Vsidian 主动 activate 进行中） */
  | 'activating'
  /** 已激活（原生或唤醒）但组件尚未调用注册入口 */
  | 'awaiting-registration'
  /** 合法声明但 API 范围/实验兼容不符（不唤醒） */
  | 'incompatible'
  /** 主动唤醒失败（激活抛错） */
  | 'activation-failed'
  /** 曾发现，当前宿主已查不到（原因不可判——不等于未安装或装错侧） */
  | 'host-unavailable'
  /** 声明形状非法 */
  | 'invalid-declaration'

export interface AddonStatusEntry {
  /** 组件 ID（沿用 Extension.id） */
  id: string
  /** 展示名（displayName 或 id 回退） */
  label: string
  /** 官方归属（仅 OFFICIAL_ADDON_EXTENSION_IDS 判定） */
  official: boolean
  status: AddonStatusKind
  /** 原因/摘要原文（错误消息、声明范围等；呈现层原样展示或组句） */
  detail?: string
  /** 不兼容时携带的声明 api 范围（组句呈现） */
  apiRange?: string
}
