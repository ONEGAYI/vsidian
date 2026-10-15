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
// - 已选声明语言：只保留有效目录与当前首选的最后成功登记语言；后者
//  随 profile 保存，使停用/卸载/故障跨重启仍按原声明范围回落内置。
//
// 目录不持久化：主题元数据由组件代码在每次接入时注册（加载模型 A——
// 代码是能力单一事实源）；用户首选持久化在宿主设置键（appearance.theme，
// 见 shared/settings），不经本服务。持久语言是该首选的派生数据，不能
// 独立改选主题；切换首选后旧快照回收，未知首选不猜测语言。
import {
  ADDON_THEME_ID_MAX,
  ADDON_THEME_LANGUAGES_MAX,
  DEFAULT_THEME_ID,
  addonThemeCandidateOf,
  parseAddonThemeRef,
  validateAddonThemeBatch,
  type AddonThemeCandidate,
  type AddonThemeDeclaration,
  type AddonThemeRegisterOutcome,
} from '../../shared/addonThemes'
import { normalizeRendererLanguage } from '../../shared/addonRenderers'
import { APPEARANCE_THEME_MAX_LENGTH } from '../../shared/settings'

interface SelectedThemeLanguagesV1 {
  version: 1
  themeRef: string
  languages: readonly string[]
}

export interface AddonThemeServicePorts {
  log(stage: string, addonId: string, detail: string): void
  /** 权威 profile 首选只读入口；本服务不写设置键。 */
  preferred?: () => string
  /** profile 派生快照；undefined 清除旧首选元数据，不保存整个历史目录。 */
  persistence?: {
    read(): unknown
    write(value: SelectedThemeLanguagesV1 | undefined): Promise<boolean>
  }
}

export class AddonThemeService {
  private readonly byAddon = new Map<string, readonly AddonThemeCandidate[]>()
  private readonly providerIds = new Map<string, Set<string>>()
  private selectedLanguages: SelectedThemeLanguagesV1 | undefined
  private currentVersion = 0
  private readonly listeners = new Set<() => void>()

  constructor(private readonly ports: AddonThemeServicePorts) {
    this.selectedLanguages = parseSelectedThemeLanguages(ports.persistence?.read())
    this.refreshPreferred()
  }

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
    }
    this.providerIds.set(addonId, declared)
    const known = this.byAddon.get(addonId)
    if (candidates.length === 0) {
      this.byAddon.delete(addonId)
    } else {
      this.byAddon.set(addonId, candidates)
    }
    this.refreshPreferred()
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
    this.refreshPreferred()
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

  /** 有效目录或当前首选的最后成功登记语言；不保留其他已回收主题。 */
  knownLanguages(themeRef: string): readonly string[] | undefined {
    const current = this.catalog().find((theme) => theme.themeRef === themeRef)
    if (current) return current.languages
    return this.selectedLanguages?.themeRef === themeRef && themeRef === this.preferred()
      ? this.selectedLanguages.languages : undefined
  }

  /** 首选变化时仅从权威设置读取，再以真实登记信息更新派生快照。 */
  refreshPreferred(): void {
    const preferred = this.preferred()
    const theme = this.catalog().find((candidate) => candidate.themeRef === preferred)
    const next: SelectedThemeLanguagesV1 | undefined = theme ? {
      version: 1, themeRef: preferred, languages: [...new Set(theme.languages)].sort(),
    } : this.selectedLanguages?.themeRef === preferred ? this.selectedLanguages : undefined
    if (selectedThemeLanguagesEqual(this.selectedLanguages, next)) return
    this.selectedLanguages = next
    void this.persistSelectedLanguages()
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
    this.refreshPreferred()
    this.changed()
  }

  private preferred(): string {
    return this.ports.preferred?.() ?? DEFAULT_THEME_ID
  }

  private async persistSelectedLanguages(): Promise<void> {
    if (!this.ports.persistence) return
    const selected = this.selectedLanguages
    const ok = await this.ports.persistence.write(selected)
    if (!ok) {
      const addonId = selected ? parseAddonThemeRef(selected.themeRef)!.addonId : ''
      this.ports.log('theme-languages-persist-failed', addonId, 'globalState write rejected')
    }
  }

  private changed(): void {
    this.currentVersion += 1
    for (const listener of [...this.listeners]) {
      listener()
    }
  }
}

function parseSelectedThemeLanguages(value: unknown): SelectedThemeLanguagesV1 | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (record['version'] !== 1 || typeof record['themeRef'] !== 'string' || record['themeRef'].length > APPEARANCE_THEME_MAX_LENGTH) return undefined
  const ref = parseAddonThemeRef(record['themeRef'])
  if (!ref || ref.addonId.trim() === '' || ref.themeId.trim() === '' || ref.themeId.length > ADDON_THEME_ID_MAX) return undefined
  const languages = record['languages']
  if (!Array.isArray(languages) || languages.length === 0 || languages.length > ADDON_THEME_LANGUAGES_MAX ||
    !languages.every((language) => typeof language === 'string' && language.trim() !== '' && language.length <= 64)) return undefined
  return { version: 1, themeRef: record['themeRef'], languages: [...new Set(languages.map(normalizeRendererLanguage))].sort() }
}

function selectedThemeLanguagesEqual(a: SelectedThemeLanguagesV1 | undefined, b: SelectedThemeLanguagesV1 | undefined): boolean {
  if (a === b) return true
  return a !== undefined && b !== undefined && a.themeRef === b.themeRef &&
    a.languages.length === b.languages.length && a.languages.every((language, index) => language === b.languages[index])
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
