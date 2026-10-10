// #350 T01 / #351 T02 附加组件注册表（宿主侧，vscode 依赖经端口注入，
// 单测友好）。
//
// registerAddon 入口的校验链（设计文档 2.2）：当前宿主身份 → 身份声明 →
// API/实验兼容 → 重复接入。同一接入代次重复注册返回 already-registered，
// 不重跑接入回调；手动重试先 release 旧代次再建新代次（原生 activate() 的
// 缓存不能代替这层注册管理）。组件尚在自身激活过程中允许注册（不要求
// isActive）。
//
// #351 T02 起 setup/enable 生命周期经 hooks 桥交给 AddonRuntime 驱动：
// registry 只负责校验与记录（纯逻辑），runtime 构造带注册面的上下文、
// 捕获可归因异常为故障暂停（不再让 setup 异常冒泡到组件 activate——
// T01 的「不吞错」语义升级为「捕获 + 归因记录 + 全组件暂停」，见票面）。
import {
  ADDON_API_VERSION,
  OFFICIAL_ADDON_EXTENSION_IDS,
  checkAddonCompatibility,
  parseAddonDeclaration,
  type AddonRegistrationContext,
  type AddonRegistrationResult,
} from '../../shared/addonIdentity'
import type { AddonPageEntryInput } from './addonPageRegistry'
import type { AddonSettingsUpdateResult } from './addonSettingsService'
import type { AddonSettingSource, AddonSettingValue } from '../../shared/addonSettings'
import type { AddonStorageFacet } from '../../shared/addonStorage'

/** 注册表宿主端口（vscode 层注入） */
export interface AddonRegistryPorts {
  apiVersion: string
  experimental: Readonly<Record<string, string>>
  officialIds: readonly string[]
  /** 按扩展 ID 查当前扩展宿主中的扩展（查不到 = 当前宿主不可用） */
  findExtension(id: string): { packageJSON: unknown } | undefined
}

/** 通道处理器（宿主组件代码注册；载荷与结果都是 JSON 数据） */
export type AddonChannelHandler = (payload: unknown) => unknown | Promise<unknown>

/** 注册面返回的释放句柄（重复 dispose 无害；迟到登记被拒时为 no-op） */
export interface AddonRegistrationHandle {
  dispose(): void
}

/** 设置读取快照（settings.get() 的结果：生效值与来源） */
export interface AddonSettingsGetSnapshot {
  readonly values: Readonly<Record<string, AddonSettingValue>>
  readonly sources: Readonly<Record<string, AddonSettingSource>>
}

/** 设置变化事件（settings.onChanged 的载荷） */
export interface AddonSettingsChangeEventData {
  readonly scope: 'user' | 'workspace'
  readonly keys: readonly string[]
}

/**
 * 设置能力面（setup 生命周期常驻——普通停用后保留；技术方案 5.5 形状）。
 * T02 先立 registerPage/registerDefinitions；T04 起接入读写与事件。
 */
export interface AddonSettingsContextApi {
  /** 设置页入口登记（自身安装目录内的相对路径；越界拒绝） */
  registerPage(entry: AddonPageEntryInput): AddonRegistrationHandle
  /** 设置定义收集（可序列化定义；形状校验矩阵见 shared/addonSettings） */
  registerDefinitions(defs: readonly unknown[]): AddonRegistrationHandle
  /** 生效值与来源快照（工作区显式 > 用户默认 > 出厂默认） */
  get(): AddonSettingsGetSnapshot
  /** 单键来源（未定义键为 undefined） */
  getSource(key: string): AddonSettingSource | undefined
  /** 按批校验并保存到指定层（失败不虚报；变化事件只在持久化成功后发出） */
  update(scope: 'user' | 'workspace', patch: Record<string, unknown>): Promise<AddonSettingsUpdateResult>
  /** 清除工作区对某键的覆盖（恢复继承用户默认，不是恢复出厂值） */
  clearWorkspaceOverride(key: string): Promise<AddonSettingsUpdateResult>
  /** 订阅成功保存后的变化（所属组件设置生命周期内有效） */
  onChanged(listener: (change: AddonSettingsChangeEventData) => void): AddonRegistrationHandle
}

/** 轻量接入上下文（setup 生命周期：设置定义 + 自己的设置入口 + 设置通信。
 *  普通功能停用后保留；故障暂停时回收组件代码——迟到注册被拒） */
export interface AddonSetupContext extends AddonRegistrationContext {
  /** 设置能力面（T04 起含读写与事件；定义归组件隔离范围） */
  readonly settings: AddonSettingsContextApi
  /** #404 组件数据目录（globalStorage 语义的隔离可写目录 + 文件监听；
   *  富结构数据（规则对象等）归本面，不并入设置存储的一层边界） */
  readonly storage: AddonStorageFacet
  /** 设置生命周期通道（归 setup 所在的生命周期） */
  readonly channel: AddonChannelRegistry
}

/** 运行上下文（enable 生命周期：编辑器页面入口 + 运行通道 + 清理回调。
 *  开启时装配；关闭或故障时释放所属注册） */
export interface AddonEnableContext extends AddonRegistrationContext {
  /** 编辑器页入口登记（自身安装目录内的相对路径；每组件一个编辑器入口，
   *  第二个登记拒绝） */
  readonly pages: {
    registerEditor(entry: AddonPageEntryInput): AddonRegistrationHandle
  }
  /** #404 组件数据目录（与 setup 上下文同一实例——数据能力与功能开关无关） */
  readonly storage: AddonStorageFacet
  /** 运行生命周期通道（停用即注销） */
  readonly channel: AddonChannelRegistry
  /** 登记清理回调（停用/故障/代次终结时执行；重复释放无害） */
  onDispose(callback: () => void): void
}

/** 通道注册面（setup/enable 上下文同形状；同名 topic 重复注册拒绝） */
export interface AddonChannelRegistry {
  handle(topic: string, handler: AddonChannelHandler): AddonRegistrationHandle
}

/** 组件注册传入的定义（T02 形状：setup 轻量接入 + enable 运行装配） */
export interface AddonDefinition {
  /** 轻量接入回调：注册成功时在本接入代次恰好调用一次 */
  setup?(context: AddonSetupContext): void
  /** 运行装配回调：按用户功能开关开启时调用；关闭或故障时释放所属注册 */
  enable?(context: AddonEnableContext): void
}

/** registry → runtime 桥（注册通过/代次释放的生命周期驱动） */
export interface AddonRegistryHooks {
  /** 注册通过校验后调用一次（setup/enable 由 runtime 驱动；实现须自捕获
   *  异常为故障，不向 register 调用方冒泡） */
  onAccepted(addonId: string, definition: AddonDefinition): void
  /** 代次释放（release / 重新注册前）调用；重复调用无害 */
  onReleased(addonId: string): void
}

/** 注册/释放变化监听（协调器据此刷新状态并推送设置页） */
export type AddonRegistryListener = (addonId: string) => void

const NOOP_HOOKS: AddonRegistryHooks = {
  onAccepted: () => {},
  onReleased: () => {},
}

export class AddonRegistry {
  private readonly records = new Set<string>()
  private readonly listeners = new Set<AddonRegistryListener>()

  constructor(
    private readonly ports: AddonRegistryPorts,
    private readonly hooks: AddonRegistryHooks = NOOP_HOOKS,
  ) {}

  /**
   * 注册入口（公开 API registerAddon 的实现核心）。owner 为调用者的原生
   * Extension 身份（仅使用 id；协议一致性核对沿用普通 VSCode 扩展信任
   * 模型——组件激活中同样允许，不检查 isActive）。
   */
  register(owner: { id: string }, definition: AddonDefinition): AddonRegistrationResult {
    const extension = this.ports.findExtension(owner.id)
    if (!extension) {
      return { ok: false, reason: 'extension-not-in-host' }
    }
    const parsed = parseAddonDeclaration(extension.packageJSON)
    if (parsed.kind === 'none' || parsed.kind === 'invalid') {
      const detail = parsed.kind === 'invalid' ? parsed.reason : 'no addon declaration'
      return { ok: false, reason: 'not-addon-extension', detail }
    }
    const compatibility = checkAddonCompatibility(parsed.declaration, {
      apiVersion: this.ports.apiVersion,
      experimental: this.ports.experimental,
    })
    if (!compatibility.compatible) {
      const detail = compatibility.reason === 'api-range'
        ? `declared api ${parsed.declaration.api}, host ${this.ports.apiVersion}`
        : `experimental entry '${compatibility.entry ?? '?'}' not available on host`
      return { ok: false, reason: 'incompatible-api', detail }
    }
    if (this.records.has(owner.id)) {
      // 同一接入代次：不重复调用接入回调
      return { ok: false, reason: 'already-registered' }
    }
    const context: AddonRegistrationContext = { addonId: owner.id, apiVersion: this.ports.apiVersion }
    this.records.add(owner.id)
    // 生命周期驱动交 runtime（异常在 hooks 内捕获为故障，不冒泡）
    this.hooks.onAccepted(owner.id, definition)
    this.notify(owner.id)
    return { ok: true, addon: context }
  }

  /** 已注册判定 */
  has(addonId: string): boolean {
    return this.records.has(addonId)
  }

  /** 释放一代注册（手动重试先释放旧代次；重复调用无害） */
  release(addonId: string): void {
    if (this.records.delete(addonId)) {
      this.hooks.onReleased(addonId)
      this.notify(addonId)
    }
  }

  /** 全部已注册组件 ID（协调器状态合并用） */
  registeredIds(): readonly string[] {
    return [...this.records]
  }

  /** 兼容判定输入的只读视图（协调器扫描复用注册表的宿主参数，避免两处配置漂移） */
  portsView(): { apiVersion: string; experimental: Readonly<Record<string, string>> } {
    return { apiVersion: this.ports.apiVersion, experimental: this.ports.experimental }
  }

  /** 注册/释放变化订阅；返回退订函数 */
  onChanged(listener: AddonRegistryListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(addonId: string): void {
    for (const listener of this.listeners) {
      listener(addonId)
    }
  }
}

/** 生产注册表端口默认值（experimental 表含 T02 起提供的 cm6 实验入口、
 *  #410 起提供的 headingFold 实验入口、#426 起提供的 viewIdentity 实验
 *  入口与 #433 起提供的 syntax 实验入口——cm6 1.1.0 = #406 起暴露面含
 *  language 语法树子集，页面 SDK 的 experimental.* 形状随公开声明冻结） */
export function createDefaultRegistryPorts(
  findExtension: (id: string) => { packageJSON: unknown } | undefined,
): AddonRegistryPorts {
  return {
    apiVersion: ADDON_API_VERSION,
    experimental: {
      cm6: ADDON_EXPERIMENTAL_CM6_VERSION,
      headingFold: ADDON_EXPERIMENTAL_HEADING_FOLD_VERSION,
      viewIdentity: ADDON_EXPERIMENTAL_VIEW_IDENTITY_VERSION,
      syntax: ADDON_EXPERIMENTAL_SYNTAX_VERSION,
    },
    officialIds: OFFICIAL_ADDON_EXTENSION_IDS,
    findExtension,
  }
}

/** T02 实验入口版本：experimental.cm6（页面共享 CM6 运行时）——组件声明
 *  `experimental: { cm6: '<range>' }` 且范围含本版本才判兼容。
 *  1.1.0（#406）：暴露面追加 language 语法树子集（minor 扩展——
 *  `^1.0.0` 声明保持兼容，精确 `1.0.0` 判不兼容） */
export const ADDON_EXPERIMENTAL_CM6_VERSION = '1.1.0'

/** #410 实验入口版本：experimental.headingFold（页面 SDK 的标题折叠查询
 *  与命令）——组件声明 `experimental: { headingFold: '<range>' }` 且范围
 *  含本版本才判兼容。1.0.0：首版候选（folds/foldable 查询 + apply 五
 *  操作与 foldAt/unfoldAt 批量组合、upToLevel 参数化），Live-only */
export const ADDON_EXPERIMENTAL_HEADING_FOLD_VERSION = '1.0.0'

/** #426 实验入口版本：experimental.viewIdentity（页面 SDK 的视图身份
 *  反查面）——组件声明 `experimental: { viewIdentity: '<range>' }` 且范围
 *  含本版本才判兼容。1.0.0：首版候选（instanceIdOf：CM6 EditorView →
 *  views 面实例 ID，未装配身份的 view 返回 null） */
export const ADDON_EXPERIMENTAL_VIEW_IDENTITY_VERSION = '1.0.0'

/** #433 实验入口版本：experimental.syntax（页面 SDK 的行类型与行内标记
 *  查询面）——组件声明 `experimental: { syntax: '<range>' }` 且范围含本
 *  版本才判兼容。1.0.0：首版候选（lineTypeAt 八种行类型 + inlineAt 三
 *  值行内标记 + nodeNames 非稳定诊断载荷），Live-only，不暴露树/节点
 *  句柄 */
export const ADDON_EXPERIMENTAL_SYNTAX_VERSION = '1.0.0'
