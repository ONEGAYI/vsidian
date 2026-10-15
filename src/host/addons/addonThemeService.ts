// #546 T07 附加组件主题目录宿主服务（vscode 经端口注入，单测友好）。
//
// 职责（规格 docs/specs/addon-themes.md §3.1 / ADR-0017）：
// - 会话目录登记：组件 enable 生命周期经 runtime 注册面登记主题声明
//  （按 addonId 整组替换——重复注册/升级 → 同组件换主题集）；登记校验
//  （形状 + 批内 themeId 重复）属普通 API 结果（invalid-theme /
//  duplicate-theme 整批拒绝，不算组件故障）；
// - 回收：代次终结（releaseAddon——停用/故障/注销/卸载经 wiring reconcile
//  驱动）与注册句柄 dispose（整组撤销）；
// - 目录版本：内容变化才递增（等值幂等——重复注册不产生广播噪声）；
// - themedProviderIds：当前运行代次登记过的提供者 ID 集（目录撤销不会让
//  页面残留候选变成普通自动接管；代次结束与候选一起回收）；
// - 已知声明语言：会话内保留最后一次登记值，供主题失效时限定内置回落
//  范围；它不使目录/提供者保持可用，也不持久化未知主题元数据。
//
// 目录不持久化：主题元数据由组件代码在每次接入时注册（加载模型 A——
// 代码是能力单一事实源）；用户首选持久化在宿主设置键（appearance.theme，
// 见 shared/settings），不经本服务。
import {
  addonThemeCandidateOf,
  validateAddonThemeBatch,
  type AddonThemeCandidate,
  type AddonThemeDeclaration,
  type AddonThemeRegisterOutcome,
} from '../../shared/addonThemes'

export interface AddonThemeServicePorts {
  log(stage: string, addonId: string, detail: string): void
}

export class AddonThemeService {
  private readonly byAddon = new Map<string, readonly AddonThemeCandidate[]>()
  private readonly providerIds = new Map<string, Set<string>>()
  private readonly languagesByTheme = new Map<string, readonly string[]>()
  private currentVersion = 0
  private readonly listeners = new Set<() => void>()

  constructor(private readonly ports: AddonThemeServicePorts) {}

  /**
   * 组件主题声明登记（enable 注册面后端；wiring 经 runtime 注入）：
   * 整批校验 → 整组替换该组件目录（空数组 = 撤销）。等值重复注册幂等
   * （版本与通知都不动）。
   */
  register(addonId: string, declarations: readonly unknown[]): AddonThemeRegisterOutcome {
    const verdict = validateAddonThemeBatch(declarations)
    if (verdict !== 'ok') {
      this.ports.log('theme-register-rejected', addonId, verdict)
      return { ok: false, reason: verdict, dispose: () => {} }
    }
    const candidates = (declarations as readonly AddonThemeDeclaration[]).map((decl) => addonThemeCandidateOf(addonId, decl))
    const declared = this.providerIds.get(addonId) ?? new Set<string>()
    for (const candidate of candidates) {
      declared.add(candidate.providerId)
      this.languagesByTheme.set(candidate.themeRef, candidate.languages)
    }
    this.providerIds.set(addonId, declared)
    const known = this.byAddon.get(addonId)
    if (candidates.length === 0) {
      this.byAddon.delete(addonId)
    } else {
      this.byAddon.set(addonId, candidates)
    }
    if (!candidateSetsEqual(known ?? [], candidates)) {
      this.changed()
    }
    return { ok: true, dispose: () => {
      if (this.byAddon.get(addonId) === candidates) {
        this.retract(addonId)
      }
    } }
  }

  /** 代次终结/停用/故障回收（重复调用无害） */
  releaseAddon(addonId: string): void {
    const hadProviders = this.providerIds.delete(addonId)
    if (!this.byAddon.has(addonId) && !hadProviders) {
      return
    }
    this.byAddon.delete(addonId)
    this.changed()
  }

  /** 目录全集快照（wiring 求生效表与设置页载荷用） */
  catalog(): readonly AddonThemeCandidate[] {
    const out: AddonThemeCandidate[] = []
    for (const themes of this.byAddon.values()) {
      out.push(...themes)
    }
    return out
  }

  /** 本会话已登记主题的最后语言快照；目录回收后仍用于原首选的内置回落。 */
  knownLanguages(themeRef: string): readonly string[] | undefined {
    return this.languagesByTheme.get(themeRef)
  }

  /** 目录版本（内容变化才递增；设置页载荷 version 用） */
  version(): number {
    return this.currentVersion
  }

  /** 当前运行代次的主题提供者 ID 集（渲染选择排除表） */
  themedProviderIds(): ReadonlySet<string> {
    return new Set([...this.providerIds.values()].flatMap((ids) => [...ids]))
  }

  /** 当前登记目录的组件 ID 集（wiring reconcile 回收用） */
  registeredAddonIds(): readonly string[] {
    return [...this.providerIds.keys()]
  }

  /** 目录变化订阅（返回退订） */
  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 句柄 dispose：整组撤销（组件仍可再注册重建） */
  private retract(addonId: string): void {
    if (!this.byAddon.has(addonId)) {
      return
    }
    this.byAddon.delete(addonId)
    this.changed()
  }

  private changed(): void {
    this.currentVersion += 1
    for (const listener of [...this.listeners]) {
      listener()
    }
  }
}

function candidateSetsEqual(a: readonly AddonThemeCandidate[], b: readonly AddonThemeCandidate[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  const keyOf = (t: AddonThemeCandidate) =>
    JSON.stringify([t.themeId, t.label, t.rendererId, [...t.languages].map((l) => l.trim()).sort()])
  const keysA = a.map(keyOf).sort()
  const keysB = b.map(keyOf).sort()
  return keysA.every((key, i) => key === keysB[i])
}
