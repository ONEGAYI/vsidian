// #350 T01 附加组件发现与接入协调（宿主侧，vscode 依赖经端口注入）。
//
// 装配约束（ADR-0012 Q25 / 设计文档 2.2，探针已验证基本路线）：
// - Vsidian activate() 返回可访问 API 后再协调扫描唤醒：start() 同步返回
//   （不能被自身 activate 等待），扫描先 await ensureSelfApiPublished()。
// - 先订阅 extensions.onDidChange，再做初始扫描（订阅先于扫描的事件序
//   由单元契约钉住）。
// - 扫描与变化处理按组件 ID 合并：同一组件的在途唤醒共用一个 promise，
//   原生激活可来自 VSCode 也可来自 Vsidian 的主动唤醒，两条路径共用同一
//   注册入口校验。
// - 声明不兼容的组件不唤醒；激活失败记录原因；曾发现后当前宿主查不到
//   显示 host-unavailable（查不到不等于未安装或装错侧——不删记录、不归因）。
import {
  checkAddonCompatibility,
  isOfficialAddon,
  parseAddonDeclaration,
  type AddonStatusEntry,
  type AddonStatusKind,
} from '../../shared/addonIdentity'
import type { AddonRegistry } from './addonRegistry'

/** 发现协调观察到的扩展形状（vscode.Extension 的最小消费面） */
export interface AddonExtensionLike {
  id: string
  label: string
  packageJSON: unknown
  isActive: boolean
  activate(): Promise<unknown>
}

export interface AddonCoordinatorPorts {
  selfExtensionId: string
  /** 等待自身原生激活完成（activate() 幂等；start 内 fire-and-forget） */
  ensureSelfApiPublished(): Promise<void>
  /** 当前扩展宿主的全部扩展（快照语义） */
  getAllExtensions(): readonly AddonExtensionLike[]
  onExtensionsChanged(listener: () => void): { dispose(): void }
}

interface DiscoveryRecord {
  label: string
  official: boolean
  status: AddonStatusKind
  detail?: string
  apiRange?: string
}

export type AddonStateListener = () => void

export class AddonCoordinator {
  private readonly records = new Map<string, DiscoveryRecord>()
  /** 在途唤醒（按组件 ID 合并；resolve 后移除） */
  private readonly waking = new Map<string, Promise<void>>()
  private readonly listeners = new Set<AddonStateListener>()
  private changeSub: { dispose(): void } | undefined
  private started = false
  private disposed = false
  private readonly offRegistryChanged: () => void

  constructor(
    private readonly ports: AddonCoordinatorPorts,
    private readonly registry: AddonRegistry,
  ) {
    // 注册表变化（组件代码经公开入口注册/手动重试释放）→ 状态同步 + 推送
    this.offRegistryChanged = registry.onChanged((addonId) => {
      this.syncRegisteredStatus(addonId)
      this.notifyChanged()
    })
  }

  /** 启动协调：先订阅清单变化，再发起初始扫描（fire-and-forget，不被
   *  自身 activate() 等待） */
  start(): void {
    if (this.started || this.disposed) {
      return
    }
    this.started = true
    this.changeSub = this.ports.onExtensionsChanged(() => {
      void this.rescan()
    })
    void this.rescan()
  }

  /**
   * 扫描 + 唤醒一轮。先等自身 API 发布，再读清单快照：声明解析与兼容
   * 判定纯逻辑；兼容且未注册的组件主动唤醒（已 isActive 的不再调
   * activate——原生路径已激活）。并发调用安全（唤醒按 ID 合并）。
   */
  async rescan(): Promise<void> {
    if (this.disposed) {
      return
    }
    await this.ports.ensureSelfApiPublished()
    if (this.disposed) {
      return
    }
    const extensions = this.ports.getAllExtensions()
    const seen = new Set<string>()
    for (const extension of extensions) {
      if (extension.id === this.ports.selfExtensionId) {
        continue
      }
      const parsed = parseAddonDeclaration(extension.packageJSON)
      if (parsed.kind === 'none') {
        // 普通扩展不入组件列表
        continue
      }
      seen.add(extension.id)
      if (parsed.kind === 'invalid') {
        this.updateRecord(extension.id, {
          label: extension.label,
          official: isOfficialAddon(extension.id),
          status: 'invalid-declaration',
          detail: parsed.reason,
        })
        continue
      }
      const compatibility = checkAddonCompatibility(parsed.declaration, {
        apiVersion: this.registryApiVersion(),
        experimental: this.registryExperimental(),
      })
      if (!compatibility.compatible) {
        this.updateRecord(extension.id, {
          label: extension.label,
          official: isOfficialAddon(extension.id),
          status: 'incompatible',
          detail: compatibility.entry !== undefined
            ? `experimental '${compatibility.entry}'`
            : undefined,
          apiRange: parsed.declaration.api,
        })
        continue
      }
      if (this.registry.has(extension.id)) {
        this.updateRecord(extension.id, {
          label: extension.label,
          official: isOfficialAddon(extension.id),
          status: 'registered',
        })
        continue
      }
      // 已尝试过唤醒（失败或等待注册）不自动重试（须先于 isActive 判定）：
      // VSCode 1.82.3 的 isActive 表示「已尝试激活」而非「激活成功」——激
      // 活失败的扩展 isActive 仍为 true，且再次 activate() 会假成功（resolve
      // 而非重抛）；不按状态短路会把真实失败掩盖成 awaiting-registration。
      // ADR「不自动重试故障组件」——重试走后续票的手动入口（先释放旧代次）
      const existing = this.records.get(extension.id)
      if (existing && (existing.status === 'activation-failed' || existing.status === 'awaiting-registration')) {
        continue
      }
      if (this.waking.has(extension.id)) {
        // 在途唤醒：保持 activating（按 ID 合并，不重复唤醒；须先于 isActive
        // 判定——activate 被调过 isActive 即为 true，在途窗口会误判）
        this.updateRecord(extension.id, {
          label: extension.label,
          official: isOfficialAddon(extension.id),
          status: 'activating',
        })
        continue
      }
      if (extension.isActive) {
        // 已被 VSCode 原生激活（另一条路径先到）：不重复调 activate，
        // 等待组件代码经注册入口接入
        this.updateRecord(extension.id, {
          label: extension.label,
          official: isOfficialAddon(extension.id),
          status: 'awaiting-registration',
        })
        continue
      }
      this.updateRecord(extension.id, {
        label: extension.label,
        official: isOfficialAddon(extension.id),
        status: 'activating',
      })
      const wake = Promise.resolve()
        .then(() => extension.activate())
        .then(
          () => {
            // 唤醒完成：组件代码通常已在 activate 内注册；未注册如实呈现
            this.updateRecord(extension.id, (prev) => ({
              label: extension.label,
              official: prev.official,
              status: this.registry.has(extension.id) ? 'registered' : 'awaiting-registration',
            }))
          },
          (error: unknown) => {
            this.updateRecord(extension.id, (prev) => ({
              label: extension.label,
              official: prev.official,
              status: 'activation-failed',
              detail: error instanceof Error ? error.message : String(error),
            }))
          },
        )
        .finally(() => {
          this.waking.delete(extension.id)
          this.notifyChanged()
        })
      this.waking.set(extension.id, wake as Promise<void>)
    }
    // 曾发现、本轮查不到：当前宿主不可用（保留记录；不归因未安装/装错侧）
    for (const id of [...this.records.keys()]) {
      if (!seen.has(id) && !this.waking.has(id)) {
        this.updateRecord(id, (prev) => ({
          label: prev.label,
          official: prev.official,
          status: 'host-unavailable',
          detail: undefined,
          apiRange: undefined,
        }))
      }
    }
    this.notifyChanged()
  }

  /**
   * #354 T05 故障手动重试（ADR「先释放旧代次」）：清「不自动重试」短路
   * 并重新唤醒该组件。已注册的先经 registry.release 释放旧代次（贡献/
   * 故障吸持随代次终结）；再调 extension.activate()——1.82.3 实证失败过的
   * activate 会假成功，唤醒后状态如实呈现（awaiting-registration 等组件
   * 重新注册，不虚报成功）。返回 'unknown' = 从未发现过该组件；
   * 'host-unavailable' = 当前宿主查不到（不归因）。
   */
  async retry(addonId: string): Promise<'ok' | 'unknown' | 'host-unavailable'> {
    if (this.disposed) {
      return 'unknown'
    }
    await this.ports.ensureSelfApiPublished()
    if (this.disposed) {
      return 'unknown'
    }
    if (!this.records.has(addonId)) {
      return 'unknown'
    }
    const extension = this.getAllExtensionsSnapshot().find((item) => item.id === addonId)
    if (!extension) {
      this.updateRecord(addonId, (prev) => ({
        label: prev.label,
        official: prev.official,
        status: 'host-unavailable',
        detail: undefined,
        apiRange: undefined,
      }))
      this.notifyChanged()
      return 'host-unavailable'
    }
    // 旧代次释放（runtime 记录随 hooks.onRemoved 移除；故障吸持解除）
    this.registry.release(addonId)
    // 重新唤醒（按 ID 合并在途唤醒；activation-failed 短路被本次手动意图越过）
    if (!this.waking.has(addonId)) {
      this.updateRecord(addonId, (prev) => ({
        label: extension.label,
        official: prev.official,
        status: 'activating',
        detail: undefined,
        apiRange: undefined,
      }))
      const wake = Promise.resolve()
        .then(() => extension.activate())
        .then(
          () => {
            this.updateRecord(addonId, (prev) => ({
              label: extension.label,
              official: prev.official,
              status: this.registry.has(addonId) ? 'registered' : 'awaiting-registration',
            }))
          },
          (error: unknown) => {
            this.updateRecord(addonId, (prev) => ({
              label: extension.label,
              official: prev.official,
              status: 'activation-failed',
              detail: error instanceof Error ? error.message : String(error),
            }))
          },
        )
        .finally(() => {
          this.waking.delete(addonId)
          this.notifyChanged()
        })
      this.waking.set(addonId, wake as Promise<void>)
    }
    this.notifyChanged()
    return 'ok'
  }

  /** 设置页状态列表（发现记录与注册表合并后的呈现载荷） */
  stateEntries(): readonly AddonStatusEntry[] {
    return [...this.records.entries()]
      .map(([id, record]) => ({
        id,
        label: record.label,
        official: record.official,
        status: record.status,
        ...(record.detail !== undefined ? { detail: record.detail } : {}),
        ...(record.apiRange !== undefined ? { apiRange: record.apiRange } : {}),
      }))
      .sort((a, b) => (a.official === b.official ? a.id.localeCompare(b.id) : a.official ? -1 : 1))
  }

  /** 状态变化订阅（设置页推送数据源）；返回退订函数 */
  onStateChanged(listener: AddonStateListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 停用收尾：退订清单变化与注册表联动 */
  dispose(): void {
    this.disposed = true
    this.changeSub?.dispose()
    this.changeSub = undefined
    this.offRegistryChanged()
    this.listeners.clear()
  }

  private registryApiVersion(): string {
    return this.registryPorts().apiVersion
  }

  /** 当前扩展宿主快照（retry 的唤醒目标查找；扫描共用同一端口） */
  private getAllExtensionsSnapshot(): readonly AddonExtensionLike[] {
    return this.ports.getAllExtensions()
  }

  private registryExperimental(): Readonly<Record<string, string>> {
    return this.registryPorts().experimental
  }

  /** 注册表端口访问（构造注入的 registry 携带兼容输入） */
  private registryPorts(): { apiVersion: string; experimental: Readonly<Record<string, string>> } {
    return this.registry.portsView()
  }

  private syncRegisteredStatus(addonId: string): void {
    const record = this.records.get(addonId)
    if (!record) {
      return
    }
    if (this.registry.has(addonId)) {
      this.records.set(addonId, { ...record, status: 'registered' })
    }
  }

  private updateRecord(
    id: string,
    next: DiscoveryRecord | ((prev: DiscoveryRecord) => DiscoveryRecord),
  ): void {
    const prev = this.records.get(id)
    const value = typeof next === 'function' ? next(prev ?? {
      label: id, official: isOfficialAddon(id), status: 'invalid-declaration',
    }) : next
    const changed = prev === undefined ||
      prev.status !== value.status || prev.label !== value.label ||
      prev.official !== value.official || prev.detail !== value.detail ||
      prev.apiRange !== value.apiRange
    if (changed) {
      this.records.set(id, value)
    }
  }

  private notifyChanged(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }
}
