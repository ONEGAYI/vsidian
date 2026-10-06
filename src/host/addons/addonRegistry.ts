// #350 T01 附加组件轻量注册表（宿主侧，vscode 依赖经端口注入，单测友好）。
//
// registerAddon 入口的校验链（设计文档 2.2）：当前宿主身份 → 身份声明 →
// API/实验兼容 → 重复接入。同一接入代次重复注册返回 already-registered，
// 不重跑 setup；手动重试先 release 旧代次再建新代次（原生 activate() 的
// 缓存不能代替这层注册管理）。组件尚在自身激活过程中允许注册（不要求
// isActive）。setup 抛错不撤销注册、不吞错——异常归因与故障暂停属后续
// 票（T02+），本票不实现半初始化回滚。
import {
  ADDON_API_VERSION,
  OFFICIAL_ADDON_EXTENSION_IDS,
  checkAddonCompatibility,
  parseAddonDeclaration,
  type AddonRegistrationContext,
  type AddonRegistrationResult,
} from '../../shared/addonIdentity'

/** 注册表宿主端口（vscode 层注入） */
export interface AddonRegistryPorts {
  apiVersion: string
  experimental: Readonly<Record<string, string>>
  officialIds: readonly string[]
  /** 按扩展 ID 查当前扩展宿主中的扩展（查不到 = 当前宿主不可用） */
  findExtension(id: string): { packageJSON: unknown } | undefined
}

/** 组件注册传入的定义（T01 轻量形状：setup 接入回调；后续票扩展
 *  enable/页面入口等运行能力） */
export interface AddonDefinition {
  /** 轻量接入回调：注册成功时在本接入代次恰好调用一次 */
  setup?(context: AddonRegistrationContext): void
}

interface RegistrationRecord {
  context: AddonRegistrationContext
  setupCalls: number
}

/** 注册/释放变化监听（协调器据此刷新状态并推送设置页） */
export type AddonRegistryListener = (addonId: string) => void

export class AddonRegistry {
  private readonly records = new Map<string, RegistrationRecord>()
  private readonly listeners = new Set<AddonRegistryListener>()

  constructor(private readonly ports: AddonRegistryPorts) {}

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
    this.records.set(owner.id, { context, setupCalls: 0 })
    try {
      definition.setup?.(context)
    } finally {
      const record = this.records.get(owner.id)
      if (record) {
        record.setupCalls++
      }
    }
    this.notify(owner.id)
    return { ok: true, addon: context }
  }

  /** 已注册判定 */
  has(addonId: string): boolean {
    return this.records.has(addonId)
  }

  /** setup 调用计数（测试与诊断观测口；未注册为 0） */
  setupCallCount(addonId: string): number {
    return this.records.get(addonId)?.setupCalls ?? 0
  }

  /** 释放一代注册（手动重试先释放旧代次；重复调用无害） */
  release(addonId: string): void {
    if (this.records.delete(addonId)) {
      this.notify(addonId)
    }
  }

  /** 全部已注册组件 ID（协调器状态合并用） */
  registeredIds(): readonly string[] {
    return [...this.records.keys()]
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

/** 生产注册表端口默认值（当前无已发布实验入口——experimental 表为空，
 *  声明 experimental 的组件一律 incompatible-api，如实反映未发布） */
export function createDefaultRegistryPorts(
  findExtension: (id: string) => { packageJSON: unknown } | undefined,
): AddonRegistryPorts {
  return {
    apiVersion: ADDON_API_VERSION,
    experimental: {},
    officialIds: OFFICIAL_ADDON_EXTENSION_IDS,
    findExtension,
  }
}
