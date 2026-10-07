// #351 T02 附加组件页面 SDK 与装载协议——两端共享的单一契约。
//
// 形状来源：V02 验证票（#349）收敛的提议形状（docs/research/
// vsidian-addons-v02-page-sdk-probe.md），对应设计文档 §4（docs/design/
// vsidian-addon-api.md）。仍是草案：字段与接口名随公开声明冻结，不冒充
// 已发布稳定 API；本模块只承载协议类型与纯守卫（不依赖 vscode/DOM）。
//
// 机制要点（V02 实测放行）：
// - 组件提供独立浏览器 IIFE（chrome114 目标），执行后经构建辅助工具的
//   defineAddonPage 把工厂推入全局登记表；装载器核对入口身份后调用工厂
//   注入页面 SDK；
// - 共享 CM6 运行时位于 experimental.cm6——装载器由页面 bundle 自身构造，
//   注入的模块命名空间与生产控制器同一实例（组件不得重打包 CM6）；
// - 每 webview 资源授权（localResourceRoots + asWebviewUri），隔离由资源
//   服务按请求面板的许可面实现（1.82.3 桌面本地形态 URI 字符串跨面板相同）；
// - 代次硬边界：旧工厂注册、旧消息、迟到结果不能接入新代次。
import type { Extension } from '@codemirror/state'
import type { AddonRenderersFacet } from './addonRenderers'
import type { AddonViewsFacet } from './addonEditApi'

/** 页面提供的共享 CM6 运行时（experimental.cm6 的内容）。值为本页 bundle
 *  内的模块命名空间对象——装载器由页面产物自身构造，因此与生产控制器
 *  共享同一份实例（构造器身份一致的机制来源）。 */
export interface AddonCm6Runtime {
  readonly state: typeof import('@codemirror/state')
  readonly view: typeof import('@codemirror/view')
}

/** 通道请求结果：普通拒绝与组件异常分开（装载器只报协议性结束态；
 *  rejected = 宿主侧未注册 topic 或业务拒绝；timeout/released 由装载器
 *  本地终结——不依赖宿主存活） */
export type AddonChannelOutcome =
  | { ok: true; result: unknown }
  | { ok: false; reason: 'timeout' | 'released' | 'rejected' }

/** 注入组件工厂的页面 SDK（T02 子集：页面装配、共享运行时、资源与通信
 * 生命周期；T06（#355）起编辑器页提供 views 面——统一视图句柄、快照与
 *  文本提交；T09（#358）起编辑器页提供 renderers 面——代码块渲染提供者
 *  候选登记；六组稳定能力的其余部分属后续票） */
export interface VsidianAddonPageSdk {
  /** 本次装载身份：组件 ID + 装载代次 + 页面种类 */
  readonly addon: { id: string; generation: number; page: AddonPageKind }
  /** 实验入口：CM6 共享运行时（仅编辑器页提供；设置页为 undefined） */
  readonly experimental: { readonly cm6?: AddonCm6Runtime }
  /** T06（#355）统一视图面（仅编辑器页；设置页为 undefined）：主正文、
   *  嵌入内部 Live 与悬停引用的句柄列表、快照读取、文本提交（默认原子
   *  或显式 joinPrevious）与选区/定位——来源身份由 SDK 注入 */
  readonly views?: AddonViewsFacet
  /** T09（#358）渲染提供者面（仅编辑器页；设置页为 undefined）：登记
   *  代码块渲染候选——可序列化声明上报宿主参与确定性选择，回调留在
   *  本页执行；生效表广播回来后才承担挂载（顺序不靠装载竞速） */
  readonly renderers?: AddonRenderersFacet
  /** 编辑器页：登记 CM6 扩展（经页面装配槽挂载；返回是否被接受） */
  registerExtension(extension: Extension): boolean
  /** 设置页：取得本组件的挂载根（编辑器页返回 null；重复调用各建新根） */
  mountRoot(): HTMLElement | null
  /** 取组件安装目录内资源的本页地址（宿主装载时已按本 webview 授权；
   *  越出资源子目录的相对路径返回 null——组件不得自造越界地址） */
  resourceUri(relativePath: string): string | null
  /** 页面 → 宿主 JSON 请求（载荷与结果可序列化；结束态见 AddonChannelOutcome） */
  readonly channel: {
    request(topic: string, payload: unknown, opts?: { timeoutMs?: number }): Promise<AddonChannelOutcome>
  }
  /** 登记释放回调（停用/故障/代次回收时执行；重复释放无害） */
  onDispose(callback: () => void): void
}

export type AddonPageKind = 'editor' | 'settings'

/** 组件工厂：由构建辅助工具的 defineAddonPage 登记，装载器注入 SDK 调用 */
export type AddonPageFactory = (sdk: VsidianAddonPageSdk) => void

/** IIFE 执行后的登记形态（构建桥的 defineAddonPage 写入全局登记表） */
export interface AddonPageRegistration {
  addonId: string
  factory: AddonPageFactory
  /** 登记时刻的时间戳（装载器判定迟到注册用） */
  registeredAt: number
}

/** 宿主下发的装载指令载荷（URI 均由宿主经本 webview 的 asWebviewUri 构造） */
export interface AddonLoadManifest {
  addonId: string
  generation: number
  page: AddonPageKind
  /** 入口脚本的本页地址（须在 localResourceRoots 许可面内，否则资源服务拒绝） */
  scriptUri: string
  /** 随装载注入的样式表地址（逐条独立装载，互不牵连） */
  cssUris?: string[]
  /** 资源子目录的本页基址（resourceUri 的解析锚；缺省时 resourceUri 恒 null） */
  resourceBase?: string
}

/** 装载结果（授权脚本 + 身份核对 + 工厂装配的复合结局） */
export type AddonLoadOutcome =
  | {
      ok: true
      /** 逐条样式的装载结局：authorized = 表已装载可读；denied = 拒绝/失败 */
      css: Array<{ uri: string; status: 'authorized' | 'denied' }>
    }
  | { ok: false; reason: AddonLoadFailureReason; detail?: string }

export type AddonLoadFailureReason =
  /** 同一组件已在装载中（对齐设计 §2.2 的 AlreadyRegistered 语义） */
  | 'already-loaded'
  /** 脚本装载失败：未授权路径被资源服务拒绝、404 或网络失败 */
  | 'script-load-failed'
  /** 登记身份与本次入口身份不符（加载器核对组件 ID） */
  | 'identity-mismatch'
  /** 脚本执行完成但没有登记任何工厂 */
  | 'no-factory-registered'
  /** 工厂或同步装配抛出可归因异常——已按故障释放全部注册 */
  | 'factory-error'

/** 卸载结果（代次核对是硬边界：旧代次指令不生效） */
export type AddonUnloadOutcome =
  | { ok: true }
  | { ok: false; reason: 'not-loaded' | 'stale-generation' | 'already-released' }

/** 宿主 → 页面装载指令 */
export type AddonPageDirective =
  | { type: 'addon.load'; manifest: AddonLoadManifest }
  | { type: 'addon.unload'; addonId: string; generation: number }
  | {
      type: 'addon.channel.reply'
      addonId: string
      generation: number
      requestId: string
      outcome: AddonChannelOutcome
    }
  | { type: 'addon.fault'; addonId: string; generation: number; reason?: string }

/** 页面 → 宿主出站消息 */
export type AddonPageOutbound =
  | {
      type: 'addon.loaded'
      addonId: string
      generation: number
      outcome: AddonLoadOutcome
    }
  | {
      type: 'addon.unloaded'
      addonId: string
      generation: number
      outcome: AddonUnloadOutcome
      /** 释放时已执行的回调数与仍滞留的通道请求数（释放完整性证据） */
      disposals: number
      releasedRequests: number
    }
  | {
      type: 'addon.faulted'
      addonId: string
      generation: number
      reason: string
    }
  | {
      type: 'addon.channel.request'
      addonId: string
      generation: number
      requestId: string
      topic: string
      payload: unknown
    }

/** 装载器观测快照（宿主断言与测试的序列化面） */
export interface AddonLoaderStats {
  page: AddonPageKind
  /** cm6 共享运行时是否由本页注入（构造器身份一致的装载器侧证据） */
  cm6Shared: boolean
  /** 活跃装载（按组件 ID） */
  active: Array<{ addonId: string; generation: number }>
  /** 活跃装载持有的授权样式表数（释放撤下的观测面） */
  cssLinksActive: number
  /** 历史终结记录（释放/故障/拒绝均留痕） */
  history: Array<{
    addonId: string
    generation: number
    ended: 'released' | 'faulted' | 'load-failed'
    reason?: string
    detail?: string
    disposals?: number
  }>
  counters: {
    staleUnloadRejected: number
    lateChannelRepliesDropped: number
    lateRegistrationsDropped: number
    unsolicitedRegistrationsDropped: number
    releasedChannelRequests: number
    channelTimeouts: number
  }
}

// ---- 协议守卫（消息桥 isHostToWebview/isWebviewToHost 的 addon 分支消费） ----

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAddonChannelOutcome(value: unknown): value is AddonChannelOutcome {
  if (!isRecord(value)) return false
  if (value.ok === true) return 'result' in value
  return value.ok === false && (value.reason === 'timeout' || value.reason === 'released' || value.reason === 'rejected')
}

function isAddonLoadOutcome(value: unknown): value is AddonLoadOutcome {
  if (!isRecord(value)) return false
  if (value.ok === true) return Array.isArray(value.css)
  return (
    value.ok === false &&
    typeof value.reason === 'string' &&
    ['already-loaded', 'script-load-failed', 'identity-mismatch', 'no-factory-registered', 'factory-error']
      .includes(value.reason) &&
    (value.detail === undefined || typeof value.detail === 'string')
  )
}

function isAddonUnloadOutcome(value: unknown): value is AddonUnloadOutcome {
  if (!isRecord(value)) return false
  if (value.ok === true) return true
  return (
    value.ok === false &&
    (value.reason === 'not-loaded' || value.reason === 'stale-generation' || value.reason === 'already-released')
  )
}

function isAddonLoadManifest(value: unknown): value is AddonLoadManifest {
  if (!isRecord(value)) return false
  if (typeof value.addonId !== 'string' || typeof value.generation !== 'number' ||
    (value.page !== 'editor' && value.page !== 'settings') || typeof value.scriptUri !== 'string') {
    return false
  }
  if (value.cssUris !== undefined &&
    (!Array.isArray(value.cssUris) || !value.cssUris.every((uri) => typeof uri === 'string'))) {
    return false
  }
  return value.resourceBase === undefined || typeof value.resourceBase === 'string'
}

/** 宿主 → 页面装载指令守卫（addonPage.directive 消息体内层） */
export function isAddonPageDirective(value: unknown): value is AddonPageDirective {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  switch (value.type) {
    case 'addon.load':
      return isAddonLoadManifest(value.manifest)
    case 'addon.unload':
    case 'addon.fault':
      return typeof value.addonId === 'string' && typeof value.generation === 'number' &&
        (value.reason === undefined || typeof value.reason === 'string')
    case 'addon.channel.reply':
      return typeof value.addonId === 'string' && typeof value.generation === 'number' &&
        typeof value.requestId === 'string' && isAddonChannelOutcome(value.outcome)
    default:
      return false
  }
}

/** 页面 → 宿主出站消息守卫（addonPage.outbound 消息体内层） */
export function isAddonPageOutbound(value: unknown): value is AddonPageOutbound {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  switch (value.type) {
    case 'addon.loaded':
      return typeof value.addonId === 'string' && typeof value.generation === 'number' &&
        isAddonLoadOutcome(value.outcome)
    case 'addon.unloaded':
      return typeof value.addonId === 'string' && typeof value.generation === 'number' &&
        isAddonUnloadOutcome(value.outcome) && typeof value.disposals === 'number' &&
        typeof value.releasedRequests === 'number'
    case 'addon.faulted':
      return typeof value.addonId === 'string' && typeof value.generation === 'number' &&
        typeof value.reason === 'string'
    case 'addon.channel.request':
      return typeof value.addonId === 'string' && typeof value.generation === 'number' &&
        typeof value.requestId === 'string' && typeof value.topic === 'string' && 'payload' in value
    default:
      return false
  }
}

/** 装载器观测快照守卫（view.state.addonPage 探针字段；集成断言面） */
export function isAddonLoaderStats(value: unknown): value is AddonLoaderStats {
  if (!isRecord(value)) return false
  if (value.page !== 'editor' && value.page !== 'settings') return false
  if (typeof value.cm6Shared !== 'boolean' || !Array.isArray(value.active) ||
    typeof value.cssLinksActive !== 'number' || !Array.isArray(value.history) || !isRecord(value.counters)) {
    return false
  }
  if (!value.active.every((entry) => isRecord(entry) && typeof entry.addonId === 'string' && typeof entry.generation === 'number')) {
    return false
  }
  if (!value.history.every((entry) => isRecord(entry) && typeof entry.addonId === 'string' &&
    typeof entry.generation === 'number' &&
    (entry.ended === 'released' || entry.ended === 'faulted' || entry.ended === 'load-failed') &&
    (entry.reason === undefined || typeof entry.reason === 'string') &&
    (entry.detail === undefined || typeof entry.detail === 'string') &&
    (entry.disposals === undefined || typeof entry.disposals === 'number'))) {
    return false
  }
  const counters = value.counters as Record<string, unknown>
  return ['staleUnloadRejected', 'lateChannelRepliesDropped', 'lateRegistrationsDropped',
    'unsolicitedRegistrationsDropped', 'releasedChannelRequests', 'channelTimeouts']
    .every((key) => typeof counters[key] === 'number')
}
