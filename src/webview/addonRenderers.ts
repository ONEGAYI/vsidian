// #358 T09 附加组件渲染提供者 webview 桥（页面级单例；编辑器 main.ts 装配）。
//
// 职责（技术方案 5.3 / ADR-0012 Q28–Q30 的 webview 侧落点）：
// - 本地候选：装载器 SDK renderers.register 把回调形态的提供者按
//   addonId+装载代次收存；可序列化声明经 send 上报宿主参与确定性选择；
//   代次释放（unload/fault）整体撤销并上报空集；
// - 生效表：宿主广播的 AddonRenderersTablePayload 权威生效提供者——本表
//   未到或等值重复时零动作；对每语言解析「本地可执行管线」：
//   生效为组件提供者且本页已装载且支持该模式 → 组件管线；否则回内置
//   注册表（graphicRenderers——内置实现作为候选保留）；内置也没有 →
//   undefined（调用方降级普通代码块）。组件页面未装载完成前的短暂内置
//   显示即「成功接入后自动替换」的前置态，顺序由宿主表决定、不靠竞速；
// - 生效代次（epoch）：某语言的生效提供者变化（含消失/恢复）时递增——
//   热切换守卫消费，旧代次容器与迟到结果不回潮；
// - 渲染型围栏语言集：内置语言 ∪ 表内可用组件提供者语言（'none' 不算
//   ——无可用候选的附加语言回落普通代码块）。该集经 shared/mermaid 的
//   动态集驱动 fence 判定（FenceSpan.rendered / 阅读切块 / 右键菜单）。
//
// 该模块不接触 CM6：热切换的正文重派发由 syncController 订阅 onTableChanged
// 执行（live 装饰重建 + 阅读重渲染 + 文档容器扫描），本桥只提供决策面。
import {
  isAddonRendererProviderInfo,
  isAddonRenderersTablePayload,
  rendererProviderId,
  type AddonRendererMode,
  type AddonRendererProviderInfo,
  type AddonRendererRegistration,
  type AddonRenderersRegisteredPayload,
  type AddonRenderersTablePayload,
} from '../shared/addonRenderers'
import { builtinRendererLanguages } from '../shared/addonRenderers'
import { RENDERED_FENCE_LABELS } from '../shared/mermaid'

/** 本页某组件某代次的已登记提供者集 */
interface GenerationProviders {
  generation: number
  providers: Map<string, AddonRendererRegistration>
}

/** 生效表变化通知载荷（syncController 热切换消费） */
export interface AddonRenderersTableChange {
  table: AddonRenderersTablePayload
  /** 生效提供者发生变化的语言（含新增/消失；epoch 已为其递增） */
  changedLanguages: readonly string[]
}

/** 出站消息形状（main.ts 经 vscode.postMessage 桥接宿主） */
export type AddonRenderersOutboundMessage = {
  kind: 'addonRenderers.registered'
  payload: AddonRenderersRegisteredPayload
}

export interface AddonRenderersBridgeHandle {
  /** SDK renderers.register 的后端（装载器注入）：声明非法拒绝返回 false */
  register(addonId: string, generation: number, spec: AddonRendererRegistration): boolean
  /** 句柄 dispose：撤销单个提供者（同代次其余保留） */
  disposeRenderer(addonId: string, generation: number, rendererId: string): void
  /** 装载代次终结：该组件本页候选整体撤销（loader release 路径调用） */
  releaseGeneration(addonId: string, generation: number): void
  /** 宿主生效表广播（等值跳过；变化时递增受影响语言 epoch 并通知） */
  applyTable(payload: unknown): boolean
  /** 某语言当前生效代次（迟到结果拒收守卫） */
  epochOf(language: string): number
  /** 渲染型围栏语言集（内置 ∪ 可用组件语言；fence 判定与卡片标签消费） */
  renderedFenceLanguages(): ReadonlySet<string>
  /** 渲染型围栏显示名（内置标签表优先，附加语言取生效候选声明；无则 undefined） */
  renderedFenceLabel(language: string): string | undefined
  /** 当前生效表观测（探针与测试） */
  currentTable(): AddonRenderersTablePayload | null
  /** 生效表变化订阅；返回退订 */
  onTableChanged(listener: (change: AddonRenderersTableChange) => void): () => void
  /** 本地候选观测（测试与探针） */
  localProvidersOf(addonId: string): readonly AddonRendererProviderInfo[]
  /**
   * 某语言某模式的生效判定（确定性规则，见 installAddonRenderersBridge 头注释）：
   * 生效组件提供者本页已装载且支持该模式 → 'addon'；其余回 'builtin' 或
   * 'none'（内置是否有管线由调用方 graphicRenderers 判定——本桥不依赖它）
   */
  resolve(language: string, mode: AddonRendererMode): EffectiveRendererResolution
  /** 按稳定身份取本页已装载的注册（热切换释放与刷新联动用；无则 undefined） */
  registrationOf(addonId: string, rendererId: string): AddonRendererRegistration | undefined
}

/** 生效解析结果：'addon' = 组件管线（含回调）；'builtin' = 用内置注册表
 *  管线（graphicRenderers——内置实现作为候选保留）；'none' = 普通代码块 */
export type EffectiveRendererResolution =
  | { kind: 'addon'; registration: AddonRendererRegistration; providerId: string }
  | { kind: 'builtin' }
  | { kind: 'none' }

/** 宿主 → webview 生效表消息形状（消息桥转发到 applyTable） */
export type AddonRenderersTableMessage = { kind: 'addonRenderers.table'; table: AddonRenderersTablePayload }

export function installAddonRenderersBridge(
  send: (message: AddonRenderersOutboundMessage) => void,
): AddonRenderersBridgeHandle {
  /** addonId → 当前装载代次的提供者集（装载器同一组件同时只有一个活跃代次） */
  const local = new Map<string, GenerationProviders>()
  let table: AddonRenderersTablePayload | null = null
  const epochs = new Map<string, number>()
  const listeners = new Set<(change: AddonRenderersTableChange) => void>()

  const report = (addonId: string): void => {
    const entry = local.get(addonId)
    const providers: AddonRendererProviderInfo[] = []
    if (entry) {
      for (const spec of entry.providers.values()) {
        providers.push({
          rendererId: spec.rendererId,
          label: spec.label,
          languages: spec.languages,
          modes: spec.modes,
          exportFormats: spec.exportFormats,
        })
      }
    }
    send({ kind: 'addonRenderers.registered', payload: { addonId, providers } })
  }

  /** 本地候选变化后的生效解析快照（`语言#模式` → resolve 结果） */
  const resolutionSnapshot = (): Map<string, string> => {
    const out = new Map<string, string>()
    for (const entry of table?.languages ?? []) {
      const live = resolveOf(entry.language, 'live') ?? entry.effective
      const reading = resolveOf(entry.language, 'reading') ?? entry.effective
      out.set(`${entry.language}#live`, live)
      out.set(`${entry.language}#reading`, reading)
    }
    return out
  }

  const resolveOf = (language: string, mode: AddonRendererMode): string | undefined => {
    const effective = table?.languages.find((entry) => entry.language === language)?.effective
    if (effective === undefined) {
      return undefined
    }
    if (effective === 'builtin' || effective === 'none') {
      return effective
    }
    const separator = effective.indexOf('/')
    const addonId = separator > 0 ? effective.slice(0, separator) : ''
    const rendererId = separator > 0 ? effective.slice(separator + 1) : ''
    const registration = addonId !== '' ? local.get(addonId)?.providers.get(rendererId) : undefined
    if (!registration || !registration.modes.includes(mode)) {
      return 'builtin'
    }
    return effective
  }

  /**
   * 本地候选变化（register/dispose/release）后的解析变化通知：宿主生效表
   * 权威**哪个提供者生效**，本页**该提供者是否可执行**——后者变化（页面
   * 装载完成、代次释放）不改变宿主表版本，但会改变本页实际显示（如面板
   * 重开：表已到位、页面注册晚到——不通知则停留内置显示）。与 applyTable
   * 共用同一条热切换通知路径（epoch 递增 + changedLanguages）。等值零通知。
   */
  const notifyResolutionChange = (before: Map<string, string>): void => {
    const after = resolutionSnapshot()
    const changed: string[] = []
    for (const [key, value] of after) {
      if (before.get(key) !== value) {
        const language = key.slice(0, key.lastIndexOf('#'))
        if (!changed.includes(language)) {
          changed.push(language)
        }
      }
    }
    for (const key of before.keys()) {
      if (!after.has(key)) {
        const language = key.slice(0, key.lastIndexOf('#'))
        if (!changed.includes(language)) {
          changed.push(language)
        }
      }
    }
    if (changed.length === 0 || !table) {
      return
    }
    for (const language of changed) {
      epochs.set(language, (epochs.get(language) ?? 0) + 1)
    }
    const change: AddonRenderersTableChange = { table, changedLanguages: changed }
    for (const listener of [...listeners]) {
      listener(change)
    }
  }

  const generationEntry = (addonId: string, generation: number): GenerationProviders => {
    const existing = local.get(addonId)
    if (existing && existing.generation === generation) {
      return existing
    }
    const fresh: GenerationProviders = { generation, providers: new Map() }
    local.set(addonId, fresh)
    return fresh
  }

  return {
    register(addonId, generation, spec) {
      // 声明校验（形状 + 回调约束）：非法整条拒绝（协议性拒绝，不算故障）
      if (!isAddonRendererProviderInfo(spec)) {
        return false
      }
      if (typeof spec.mount !== 'function') {
        return false
      }
      if (spec.exportFormats.includes('svg') && typeof spec.exportSvg !== 'function') {
        return false
      }
      const entry = generationEntry(addonId, generation)
      if (entry.providers.has(spec.rendererId)) {
        // 同代次同局部 ID 重复注册：拒绝（首个保留）
        return false
      }
      entry.providers.set(spec.rendererId, spec)
      const before = resolutionSnapshot()
      report(addonId)
      notifyResolutionChange(before)
      return true
    },
    disposeRenderer(addonId, generation, rendererId) {
      const entry = local.get(addonId)
      if (!entry || entry.generation !== generation) {
        return
      }
      if (entry.providers.delete(rendererId)) {
        const before = resolutionSnapshot()
        report(addonId)
        notifyResolutionChange(before)
      }
    },
    releaseGeneration(addonId, generation) {
      const entry = local.get(addonId)
      if (!entry || entry.generation !== generation) {
        return
      }
      local.delete(addonId)
      const before = resolutionSnapshot()
      report(addonId)
      notifyResolutionChange(before)
    },
    applyTable(payload) {
      if (!isAddonRenderersTablePayload(payload)) {
        return false
      }
      if (table !== null && table.version === payload.version) {
        return false
      }
      const changedLanguages: string[] = []
      const markChanged = (language: string): void => {
        if (!changedLanguages.includes(language)) {
          changedLanguages.push(language)
          epochs.set(language, (epochs.get(language) ?? 0) + 1)
        }
      }
      if (table !== null) {
        const before = new Map(table.languages.map((entry) => [entry.language, entry.effective]))
        for (const entry of payload.languages) {
          if (before.get(entry.language) !== entry.effective) {
            markChanged(entry.language)
          }
          before.delete(entry.language)
        }
        for (const removed of before.keys()) {
          markChanged(removed)
        }
      } else {
        // 首次应用：此前页面按「空表默认态」解析（内置管线/普通代码块），
        // builtin/none 行与该基线零显示差异——不通知（否则每个新面板装载
        // 后都多一次无意义热切换：阅读整篇重渲染，#7/#14 解析计数被打破）；
        // 组件接管行才可能改变显示（已装载 → addon；未装载 → 装载完成的
        // register 路径会精确通知）
        for (const entry of payload.languages) {
          if (entry.effective !== 'builtin' && entry.effective !== 'none') {
            markChanged(entry.language)
          }
        }
      }
      table = payload
      const change: AddonRenderersTableChange = { table: payload, changedLanguages }
      for (const listener of [...listeners]) {
        listener(change)
      }
      return true
    },
    epochOf(language) {
      return epochs.get(language) ?? 0
    },
    renderedFenceLanguages() {
      const languages = new Set<string>(builtinRendererLanguages())
      if (table) {
        for (const entry of table.languages) {
          // 可用组件提供者生效（非 'none'/非内置）才计入——无可用候选的
          // 附加语言回落普通代码块；内置语言已在内置集
          if (entry.effective !== 'none' && entry.effective !== 'builtin') {
            languages.add(entry.language)
          }
        }
      }
      return languages
    },
    renderedFenceLabel(language) {
      const lang = language.trim()
      // 生效组件提供者优先展示其声明名称；其余（内置生效/无表项）取内置
      // 标签表（RENDERED_FENCE_LABELS——卡片头与弹窗标题的原口径）
      if (table) {
        const effective = table.languages.find((entry) => entry.language === lang)
        if (effective && effective.effective !== 'builtin' && effective.effective !== 'none') {
          const candidate = table.providers.find(
            (provider) => provider.providerId === effective.effective && provider.languages.some((l) => l.trim() === lang),
          )
          if (candidate) {
            return candidate.label
          }
        }
      }
      return RENDERED_FENCE_LABELS[lang]
    },
    currentTable() {
      return table
    },
    onTableChanged(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    localProvidersOf(addonId) {
      const entry = local.get(addonId)
      if (!entry) {
        return []
      }
      return [...entry.providers.values()].map((spec) => ({
        rendererId: spec.rendererId,
        label: spec.label,
        languages: spec.languages,
        modes: spec.modes,
        exportFormats: spec.exportFormats,
      }))
    },
    resolve(language, mode) {
      const lang = language.trim()
      const effective = table?.languages.find((entry) => entry.language === lang)?.effective
      if (effective === undefined || effective === 'builtin') {
        // 无表项/内置生效：走内置注册表口径（是否真有管线由调用方判定）
        return { kind: 'builtin' }
      }
      if (effective === 'none') {
        return { kind: 'none' }
      }
      const separator = effective.indexOf('/')
      const addonId = separator > 0 ? effective.slice(0, separator) : ''
      const rendererId = separator > 0 ? effective.slice(separator + 1) : ''
      const registration = addonId !== '' ? local.get(addonId)?.providers.get(rendererId) : undefined
      if (!registration) {
        // 生效提供者本页尚未装载（页面装载在途）：先按内置显示（无内置由
        // 调用方降级普通代码块）——接入完成后随生效表热切换升级
        return { kind: 'builtin' }
      }
      if (!registration.modes.includes(mode)) {
        // 组件未支持的模式不调用其入口（技术方案 5.3；内置可补位则补位）
        return { kind: 'builtin' }
      }
      return { kind: 'addon', registration, providerId: rendererProviderId(addonId, registration.rendererId) }
    },
    registrationOf(addonId, rendererId) {
      return local.get(addonId)?.providers.get(rendererId)
    },
  }
}

// ---- 页面级单例（main.ts 装配；graphicRenderers 与 syncController 消费） ----

let bridgeSingleton: AddonRenderersBridgeHandle | null = null

/** 装桥同时登记页面单例（返回句柄供消息桥转发与探针） */
export function setAddonRenderersBridge(send: (message: AddonRenderersOutboundMessage) => void): AddonRenderersBridgeHandle {
  const handle = installAddonRenderersBridge(send)
  bridgeSingleton = handle
  return handle
}

/** 当前页面单例（未装配为 null——消费方退内置注册表口径） */
export function addonRenderersBridge(): AddonRenderersBridgeHandle | null {
  return bridgeSingleton
}
