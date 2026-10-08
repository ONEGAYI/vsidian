// V02 验证票（#349）：页面 SDK 与装载协议的提议形状。
// 这是**验证用原型**，不是已发布 API——字段与接口名仍待 T02 实施冻结；
// 本模块同时供页面装载器（webview 侧）、探针套件（宿主侧）、浏览器夹具
// 与单元测试共享，保证三处驱动的同一契约。
//
// 对应设计（docs/design/vsidian-addon-api.md §4）：
// - 组件提供独立 IIFE，执行后经构建辅助工具提供的 defineAddonPage 登记
//   工厂；加载器核对入口身份后调用工厂注入页面 SDK；
// - CM6 接入位于 experimental.cm6，使用本页提供的同一套构造器与工厂
//   （组件不得重打包运行时）；
// - 加载器记录组件 ID、页面实例与装载代次；旧工厂注册、旧消息与迟到
//   结果不能接入新代次。
import type { Extension } from '@codemirror/state'

/** #406 language 语法树读取子集（与生产 src/shared/addonPage.ts 的
 *  AddonCm6LanguageRuntime 同形——原型保持自包含，形状变更两处同步）：
 *  只纳入「读树」函数，注册类成员（LRLanguage/foldGutter 等）不暴露。 */
export interface AddonCm6LanguageRuntime {
  readonly syntaxTree: (typeof import('@codemirror/language'))['syntaxTree']
  readonly ensureSyntaxTree: (typeof import('@codemirror/language'))['ensureSyntaxTree']
  readonly syntaxTreeAvailable: (typeof import('@codemirror/language'))['syntaxTreeAvailable']
}

/** 页面提供的共享 CM6 运行时（experimental.cm6 的内容）。
 *  值为本页 bundle 内的模块命名空间对象——装载器由页面产物自身构造，
 *  因此与生产控制器共享同一份实例（构造器身份一致的机制来源）。 */
export interface AddonCm6Runtime {
  readonly state: typeof import('@codemirror/state')
  readonly view: typeof import('@codemirror/view')
  readonly language: AddonCm6LanguageRuntime
}

/** 通道请求结果：普通拒绝与组件异常分开（装载器只报协议性结束态） */
export type AddonChannelOutcome =
  | { ok: true; result: unknown }
  | { ok: false; reason: 'timeout' | 'released' | 'rejected' }

/** 注入组件工厂的页面 SDK（提议形状的最小子集：V02 只验证页面装配、
 *  共享运行时、资源与通信生命周期；六组稳定能力的其余部分属后续票） */
export interface VsidianAddonPageSdk {
  /** 本次装载身份：组件 ID + 装载代次 + 页面种类 */
  readonly addon: { id: string; generation: number; page: AddonPageKind }
  /** 实验入口：CM6 共享运行时（仅编辑器页提供；设置页为 undefined） */
  readonly experimental: { readonly cm6?: AddonCm6Runtime }
  /** 编辑器页：登记 CM6 扩展（经页面装配槽挂载；返回是否被接受） */
  registerExtension(extension: Extension): boolean
  /** 设置页：取得本组件的挂载根（编辑器页返回 null；重复调用同根） */
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

/** 装载器观测快照（宿主断言与证据 JSON 的序列化面） */
export interface AddonLoaderStats {
  page: AddonPageKind
  /** cm6 共享运行时是否由本页注入（构造器身份一致的装载器侧证据） */
  cm6Shared: boolean
  /** 活跃装载（按组件 ID） */
  active: Array<{ addonId: string; generation: number }>
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
