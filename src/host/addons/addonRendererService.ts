// #358 T09 附加组件渲染提供者宿主服务（vscode 经端口注入，单测友好）。
//
// 职责（票面 / 技术方案 5.3 / ADR-0012 Q28–Q30）：
// - 会话候选登记：webview 上报的组件提供者声明按 addonId 整组替换
//  （重复注册/升级 → 同 addonId 替换，批次不变故不覆盖既有首选）；
// - 发现批次：候选首次记录时幂等分配（assignDiscoveryBatches），批次变化
//   才写持久层（globalState，用户层——跨窗口 last-write-wins，同一组件
//   一经记录不改写，天然幂等）；
// - 用户首选：按语言显式选择（providerId 或 'builtin'；null 清除回默认
//   序），仅接受已知候选与内置；写入即持久并通知；
// - 生效表：selectEffectiveRenderers 纯逻辑 + 可用性谓词（由 wiring 按
//   runtime 状态注入——registered 且启用且未故障）；内容变化才递增
//   version 并通知（等值广播无副作用）。
//
// 可用性不在本服务内判定：停用（enable 偏好）与整组件故障（faulted）
// 都是 runtime 状态，wiring 每次传谓词进来——「仍运行的渲染 bug」不改变
// 可用性，因此不触发接管（Q30 表二行）。
import {
  BUILTIN_RENDERER_PROVIDER_ID,
  addonRendererCandidateOf,
  assignDiscoveryBatches,
  builtinRendererLanguages,
  emptyAddonRendererStore,
  parseAddonRendererStore,
  rendererProviderId,
  selectEffectiveRenderers,
  type AddonRendererCandidate,
  type AddonRendererProviderInfo,
  type AddonRendererStoreV1,
  type AddonRenderersTablePayload,
} from '../../shared/addonRenderers'

/** 持久层端口（vscode 层实现：globalState 键 vsidian.addons.renderers） */
export interface AddonRendererPersistencePort {
  read(): unknown
  write(data: AddonRendererStoreV1): Promise<boolean>
}

export interface AddonRendererServicePorts {
  persistence: AddonRendererPersistencePort
  log(stage: string, detail: string): void
}

/** 服务观测快照（测试钩子与设置页呈现用） */
export interface AddonRendererServiceSnapshot {
  store: AddonRendererStoreV1
  /** 本会话已知候选（addonId → 声明列表） */
  candidates: Readonly<Record<string, readonly AddonRendererProviderInfo[]>>
  table: AddonRenderersTablePayload | null
}

export class AddonRendererService {
  private store: AddonRendererStoreV1
  private readonly candidates = new Map<string, readonly AddonRendererProviderInfo[]>()
  private tableVersion = 0
  private lastTable: AddonRenderersTablePayload | null = null
  private readonly listeners = new Set<() => void>()

  constructor(private readonly ports: AddonRendererServicePorts) {
    this.store = parseAddonRendererStore(ports.persistence.read())
  }

  /** webview 上报：按 addonId 整组替换候选（空数组 = 该组件候选全部撤销） */
  registerProviders(addonId: string, providers: readonly AddonRendererProviderInfo[]): void {
    const known = providers.filter((info) => info.rendererId !== '' && info.label !== '')
    const changed =
      this.candidates.get(addonId) === undefined ? known.length > 0 : !providerSetsEqual(this.candidates.get(addonId)!, known)
    if (!changed) {
      return
    }
    if (known.length === 0) {
      this.candidates.delete(addonId)
    } else {
      this.candidates.set(addonId, known)
    }
    // 新组件首次记录才分配批次（幂等；批次写持久层）
    const assignment = assignDiscoveryBatches(this.store, [addonId])
    if (assignment.changed) {
      this.store = assignment.store
      void this.persist()
    }
    this.refreshTableAndNotify()
  }

  /** 代次终结（registry release）：该组件候选整体撤销 */
  clearProviders(addonId: string): void {
    if (!this.candidates.has(addonId)) {
      return
    }
    this.candidates.delete(addonId)
    this.refreshTableAndNotify()
  }

  /**
   * 用户按语言显式首选。provider 传 null = 清除（回确定性默认序）；
   * 'builtin' 仅对内置图形语言可选（其余语言无内置管线，选内置不可执行
   * ——拒绝）；未知提供者（非本会话候选、非内置）拒绝。
   */
  setPreferred(language: string, provider: string | null): 'ok' | 'unknown-provider' {
    const lang = language.trim()
    if (provider === null) {
      if (!(lang in this.store.preferred)) {
        return 'ok'
      }
      const preferred = { ...this.store.preferred }
      delete preferred[lang]
      this.store = { ...this.store, preferred }
      void this.persist()
      this.refreshTableAndNotify()
      return 'ok'
    }
    if (!this.isSelectableProvider(lang, provider)) {
      return 'unknown-provider'
    }
    if (this.store.preferred[lang] === provider) {
      return 'ok'
    }
    this.store = { ...this.store, preferred: { ...this.store.preferred, [lang]: provider } }
    void this.persist()
    this.refreshTableAndNotify()
    return 'ok'
  }

  /** 某语言当前持久首选（无显式选择为 undefined） */
  preferredOf(language: string): string | undefined {
    return this.store.preferred[language.trim()]
  }

  /** 已知提供者 ID 全集（候选 + 持久批次记录过的组件当前候选） */
  knownProviderIds(): readonly string[] {
    const ids = new Set<string>([BUILTIN_RENDERER_PROVIDER_ID])
    for (const [addonId, providers] of this.candidates) {
      for (const info of providers) {
        ids.add(rendererProviderId(addonId, info.rendererId))
      }
    }
    return [...ids]
  }

  /**
   * 当前生效表（可用性谓词由 wiring 按 runtime 状态注入）。内容与上次
   * 相同则返回旧表（version 不递增、不通知——等值广播幂等）。
   */
  effectiveTable(isAddonAvailable: (addonId: string) => boolean): AddonRenderersTablePayload {
    const candidates: AddonRendererCandidate[] = []
    for (const [addonId, providers] of this.candidates) {
      for (const info of providers) {
        candidates.push(addonRendererCandidateOf(addonId, info))
      }
    }
    const selection = selectEffectiveRenderers({
      candidates,
      isAvailable: (candidate) => isAddonAvailable(candidate.addonId),
      builtinLanguages: builtinRendererLanguages(),
      preferred: this.store.preferred,
      batches: this.store.batches,
    })
    if (this.lastTable !== null && tablesEqual(this.lastTable, { providers: candidates, languages: selection.languages })) {
      return this.lastTable
    }
    this.tableVersion += 1
    this.lastTable = { version: this.tableVersion, providers: candidates, languages: selection.languages }
    return this.lastTable
  }

  /** 表内容变化并已推进时通知订阅者（wiring 广播生效表） */
  refreshTableAndNotify(): void {
    // effectiveTable 的引用比较依赖 lastTable：先以恒真可用性探测是否有
    // 内容差异不可行（可用性影响 languages），因此由调用方传入当前可用性；
    // 这里只负责事件分发——wiring 每次重算并比较 version。
    for (const listener of [...this.listeners]) {
      listener()
    }
  }

  /** 状态变化订阅（候选/首选变化；返回退订函数） */
  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 观测快照（测试钩子；store 为持久形状） */
  snapshot(isAddonAvailable: (addonId: string) => boolean): AddonRendererServiceSnapshot {
    const candidates: Record<string, readonly AddonRendererProviderInfo[]> = {}
    for (const [addonId, providers] of this.candidates) {
      candidates[addonId] = providers
    }
    return { store: this.store, candidates, table: this.effectiveTable(isAddonAvailable) }
  }

  /** 空存储观测（单测断言用） */
  static emptyStore(): AddonRendererStoreV1 {
    return emptyAddonRendererStore()
  }

  private isSelectableProvider(language: string, provider: string): boolean {
    if (provider === BUILTIN_RENDERER_PROVIDER_ID) {
      // 内置只对内置图形语言可选（其余语言无内置管线）
      return builtinRendererLanguages().includes(language)
    }
    const separator = provider.indexOf('/')
    if (separator <= 0) {
      return false
    }
    const addonId = provider.slice(0, separator)
    const rendererId = provider.slice(separator + 1)
    return this.candidates.get(addonId)?.some((info) => info.rendererId === rendererId && info.languages.some((l) => l.trim() === language)) === true
  }

  private async persist(): Promise<void> {
    const ok = await this.ports.persistence.write(this.store)
    if (!ok) {
      this.ports.log('renderers-persist-failed', 'globalState write rejected')
    }
  }
}

function providerSetsEqual(a: readonly AddonRendererProviderInfo[], b: readonly AddonRendererProviderInfo[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  const keyOf = (info: AddonRendererProviderInfo) =>
    JSON.stringify([info.rendererId, info.label, [...info.languages].map((l) => l.trim()).sort(), [...info.modes].sort(), [...info.exportFormats].sort()])
  const keysA = a.map(keyOf).sort()
  const keysB = b.map(keyOf).sort()
  return keysA.every((key, i) => key === keysB[i])
}

function tablesEqual(
  a: AddonRenderersTablePayload,
  b: { providers: readonly AddonRendererCandidate[]; languages: AddonRenderersTablePayload['languages'] },
): boolean {
  const keyOf = (table: typeof b) =>
    JSON.stringify([
      table.providers
        .map((p) => [p.addonId, p.rendererId, p.label, [...p.languages].map((l) => l.trim()).sort(), [...p.modes].sort(), [...p.exportFormats].sort()])
        .sort(),
      table.languages.map((l) => [l.language, l.effective, l.source]).sort(),
    ])
  return keyOf(a) === keyOf(b)
}
