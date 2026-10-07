// #351 T02 附加组件运行生命周期管理器（宿主侧纯逻辑，vscode 经端口注入）。
//
// 职责（票面 #351 / ADR-0012「运行与作用范围」）：
// - 两生命周期：setup（设置定义 + 自己的设置入口 + 设置通信）在注册代次
//   内常驻；enable（编辑器页面入口 + 运行通道 + 清理回调）按用户功能
//   开关装配。普通关闭释放运行贡献但保留设置能力；偏好独立持久
//  （用户默认 + 工作区覆盖读优先序；存储格式与 T04 对齐预留——本票钉住
//   持久行为：停用选择跨代次保留，重启后停用状态保持）。
// - 可归因注册（setup）/初始化（enable）/回调（通道 handler）异常 →
//   暂停该组件**全部**注册贡献（运行贡献释放、设置页代码撤下、setup
//   通道注销），保留设置定义、启用偏好与故障原因（状态可观察；完整
//   诊断形态归 T12）。页面侧故障（装载器 factory-error/faulted 上报）
//   同样触发暂停。
// - 通道只传 JSON：回执经结构化克隆防线（函数/DOM 引用拒绝并归因）；
//   未注册 topic 协议性拒绝（不算故障）；同名 topic 重复注册拒绝。
// - 装载意图（面板桥消费）：desiredEditorLoads / desiredSettingsLoad 输出
//   fsPath 层计划（URI 由 vscode 层按各面板铸造）；停用/故障/释放的
//   unload 意图携带最后装载代次。代次在「停用→再启用」时递增；面板
//   重载不递增（同代次幂等重发）。
import type {
  AddonChannelHandler,
  AddonDefinition,
  AddonEnableContext,
  AddonRegistrationHandle,
  AddonRegistryHooks,
  AddonSetupContext,
} from './addonRegistry'
import { resolveAddonPageEntry } from './addonPageRegistry'

/** 登记成功的解析臂（settingsPages/editorPages 只收成功条目） */
type ResolvedPageEntry = import('./addonPageRegistry').AddonPageEntryResolution & { ok: true }
import type { AddonChannelOutcome, AddonPageDirective, AddonPageOutbound } from '../../shared/addonPage'

/** 启用偏好持久层（vscode 层实现：user 层 = globalState，workspace 层 =
 *  workspaceState；具体存储格式 T04 冻结，本端口是读写面） */
export interface AddonPreferenceStore {
  /** 两层显式偏好快照（workspace 为 null = 无工作区层） */
  read(): { user: Record<string, boolean>; workspace: Record<string, boolean> | null }
  /** 覆写一层（值 undefined 表示移除该键——恢复默认） */
  write(scope: 'user' | 'workspace', values: Record<string, boolean | undefined>): void
}

export interface AddonRuntimePorts {
  apiVersion: string
  preferences: AddonPreferenceStore
  /** 组件安装目录（fsPath；解析不到时页面入口登记拒绝——资源授权无锚） */
  installDirOf(addonId: string): string | undefined
  /** 归因日志（写 VSCode 输出通道：组件 ID + 阶段 + 原因） */
  log(stage: string, addonId: string, detail: string): void
}

/** 编辑器页装载计划（fsPath 层；面板桥按各 webview 的 asWebviewUri 铸造 manifest） */
export interface AddonEditorLoadPlan {
  addonId: string
  generation: number
  page: 'editor'
  entryFsPath: string
  cssFsPaths: readonly string[]
  resourceBaseFsPath: string | null
}

/** 设置页装载计划（同上；设置页面板单例） */
export interface AddonSettingsLoadPlan {
  addonId: string
  generation: number
  page: 'settings'
  entryFsPath: string
  cssFsPaths: readonly string[]
  resourceBaseFsPath: string | null
}

/** 运行状态观测（合并进 addons.state 的呈现载荷） */
export interface AddonRuntimeStatus {
  /** 用户偏好生效值（workspace 显式 > user 显式 > 默认启用） */
  enabled: boolean
  runState: 'idle' | 'enabled' | 'disabled' | 'faulted'
  /** 故障原因（可归因异常原文；基础可观察，完整诊断归 T12） */
  faultReason?: string
  /** 设置页入口当前可装载（fault 暂停时撤下） */
  hasSettingsPage: boolean
}

type RunState = AddonRuntimeStatus['runState']

interface RunContributions {
  editorPages: ResolvedPageEntry[]
  handlers: Map<string, AddonChannelHandler>
  disposeCallbacks: Array<() => void>
}

interface RuntimeRecord {
  definition: AddonDefinition
  installDir: string | undefined
  settingsPages: ResolvedPageEntry[]
  collectedDefinitions: unknown[]
  setupHandlers: Map<string, AddonChannelHandler>
  run: RunContributions | null
  runState: RunState
  faultReason: string | undefined
  /** 最近一次 enable 分配的编辑器装载代次（0 = 从未装载） */
  editorGeneration: number
  /** 设置页装载代次（openSettingsPage 时分配） */
  settingsGeneration: number
}

const NOOP_HANDLE: AddonRegistrationHandle = { dispose: () => {} }

export class AddonRuntime {
  private readonly records = new Map<string, RuntimeRecord>()
  private readonly listeners = new Set<() => void>()
  /** 当前打开的组件设置页（单设置页面板） */
  private settingsOpenAddon: string | undefined

  constructor(private readonly ports: AddonRuntimePorts) {}

  /** registry hooks（构造 AddonRegistry 时注入；异常在此捕获为故障） */
  registryHooks(): AddonRegistryHooks {
    return {
      onAccepted: (addonId, definition) => this.attachRegistration(addonId, definition),
      onReleased: (addonId) => this.releaseGeneration(addonId),
    }
  }

  // ---- 用户功能开关（普通关闭：释放运行贡献、保留设置能力） ----

  /** 写入启用偏好（user 层；workspace 覆盖层的 UI 入口属 T04）并同步运行态 */
  setUserEnabled(addonId: string, enabled: boolean): void {
    const current = this.ports.preferences.read()
    this.ports.preferences.write('user', { ...current.user, [addonId]: enabled })
    const record = this.records.get(addonId)
    if (record) {
      this.syncRunState(record)
    }
    this.notify()
  }

  /** 生效启用判定：workspace 显式 > user 显式 > 默认启用（ADR 默认状态） */
  effectiveEnabled(addonId: string): boolean {
    const { user, workspace } = this.ports.preferences.read()
    if (workspace && addonId in workspace) return workspace[addonId]
    if (addonId in user) return user[addonId]
    return true
  }

  // ---- 装载意图（面板桥消费） ----

  /** 期望装载的编辑器页计划（每启用组件一个入口；面板 ready 与状态变化时拉取） */
  desiredEditorLoads(): readonly AddonEditorLoadPlan[] {
    const plans: AddonEditorLoadPlan[] = []
    for (const [addonId, record] of this.records) {
      if (record.runState !== 'enabled' || !record.run || record.editorGeneration === 0) continue
      for (const page of record.run.editorPages) {
        plans.push({
          addonId,
          generation: record.editorGeneration,
          page: 'editor',
          entryFsPath: page.entryFsPath,
          cssFsPaths: page.cssFsPaths,
          resourceBaseFsPath: page.resourceBaseFsPath,
        })
      }
    }
    return plans
  }

  /** 停用/故障/释放时的编辑器 unload 意图（携带最后装载代次；从未装载为 null） */
  lastEditorUnloadDirective(addonId: string): AddonPageDirective | null {
    const record = this.records.get(addonId)
    if (!record || record.editorGeneration === 0) return null
    return { type: 'addon.unload', addonId, generation: record.editorGeneration }
  }

  /** 打开某组件自己的设置页（设置页面板装载其页面产物） */
  openSettingsPage(addonId: string): 'ok' | 'not-registered' | 'faulted' | 'no-settings-page' {
    const record = this.records.get(addonId)
    if (!record) return 'not-registered'
    if (record.runState === 'faulted') return 'faulted'
    if (record.settingsPages.length === 0) return 'no-settings-page'
    record.settingsGeneration++
    this.settingsOpenAddon = addonId
    this.notify()
    return 'ok'
  }

  /** 关闭当前组件设置页（分页切换/用户关闭；重复关闭无害） */
  closeSettingsPage(): void {
    if (this.settingsOpenAddon === undefined) return
    this.settingsOpenAddon = undefined
    this.notify()
  }

  /** 设置页面板销毁（retainContextWhenHidden 关闭——隐藏即释放）：终结装载意图 */
  settingsPanelGone(): void {
    this.closeSettingsPage()
  }

  /** 当前打开的组件设置页 ID（无打开项为 undefined；addons.state 呈现） */
  openSettingsAddonId(): string | undefined {
    return this.settingsOpenAddon
  }

  /** 期望装载的设置页计划（无打开项为 null） */
  desiredSettingsLoad(): AddonSettingsLoadPlan | null {
    const addonId = this.settingsOpenAddon
    if (addonId === undefined) return null
    const record = this.records.get(addonId)
    if (!record || record.runState === 'faulted' || record.settingsPages.length === 0 || record.settingsGeneration === 0) {
      return null
    }
    const page = record.settingsPages[0]
    if (!page.ok) return null
    return {
      addonId,
      generation: record.settingsGeneration,
      page: 'settings',
      entryFsPath: page.entryFsPath,
      cssFsPaths: page.cssFsPaths,
      resourceBaseFsPath: page.resourceBaseFsPath,
    }
  }

  // ---- webview 出站消息（面板桥转发） ----

  handleOutbound(message: AddonPageOutbound): void {
    if (message.type === 'addon.loaded' && !message.outcome.ok && message.outcome.reason === 'factory-error') {
      const record = this.records.get(message.addonId)
      if (record) {
        this.faultRecord(record, `页面工厂异常：${message.outcome.detail ?? 'unknown'}`)
      }
      return
    }
    if (message.type === 'addon.faulted') {
      const record = this.records.get(message.addonId)
      if (record) {
        this.faultRecord(record, message.reason)
      }
      return
    }
    // addon.loaded（成功/其余失败）与 addon.unloaded 的权威在装载器侧，
    // 宿主不重复记账（面板桥按 desired 幂等刷新）
  }

  // ---- 通道（页面 → 宿主 JSON 请求的路由） ----

  /** 路由通道请求：run scope 优先、setup scope 兜底（停用后仍服务设置页） */
  async dispatchChannelRequest(addonId: string, topic: string, payload: unknown): Promise<AddonChannelOutcome> {
    const record = this.records.get(addonId)
    if (!record || record.runState === 'faulted') {
      return { ok: false, reason: 'rejected' }
    }
    const handler = record.run?.handlers.get(topic) ?? record.setupHandlers.get(topic)
    if (!handler) {
      return { ok: false, reason: 'rejected' }
    }
    let result: unknown
    try {
      result = await handler(payload)
    } catch (err) {
      this.faultRecord(record, `通道回调异常（${topic}）：${String(err)}`)
      return { ok: false, reason: 'rejected' }
    }
    try {
      // JSON 防线：函数/DOM/内部控制器不可结构化克隆——拒绝回执并归因
      return { ok: true, result: structuredClone(result) }
    } catch {
      this.faultRecord(record, `通道回执不可序列化（${topic}）——通信只传 JSON 数据`)
      return { ok: false, reason: 'rejected' }
    }
  }

  // ---- 观测 ----

  /** 运行状态（未注册为 undefined；合并进 addons.state 呈现） */
  runtimeStatus(addonId: string): AddonRuntimeStatus | undefined {
    const record = this.records.get(addonId)
    if (!record) return undefined
    return {
      enabled: this.effectiveEnabled(addonId),
      runState: record.runState,
      ...(record.faultReason !== undefined ? { faultReason: record.faultReason } : {}),
      hasSettingsPage: record.runState !== 'faulted' && record.settingsPages.length > 0,
    }
  }

  /** setup 收集的设置定义（故障后保留——平台基础控件呈现属 T04/T06） */
  collectedDefinitions(addonId: string): readonly unknown[] {
    return this.records.get(addonId)?.collectedDefinitions ?? []
  }

  /** 某组件已登记的设置页入口解析（设置页面板许可面预先授权用；未登记
   *  或故障暂停时为 null） */
  settingsPagePlanFor(addonId: string): { entryFsPath: string; cssFsPaths: readonly string[]; resourceBaseFsPath: string | null } | null {
    const record = this.records.get(addonId)
    if (!record || record.runState === 'faulted' || record.settingsPages.length === 0) return null
    const page = record.settingsPages[0]
    return { entryFsPath: page.entryFsPath, cssFsPaths: page.cssFsPaths, resourceBaseFsPath: page.resourceBaseFsPath }
  }

  /** 状态/装载意图变化订阅（面板桥与设置页桥刷新）；返回退订函数 */
  onChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 全量释放（扩展停用收尾） */
  dispose(): void {
    for (const addonId of [...this.records.keys()]) {
      this.releaseGeneration(addonId)
    }
    this.listeners.clear()
  }

  // ---- 内部：注册装配与状态机 ----

  private attachRegistration(addonId: string, definition: AddonDefinition): void {
    const record: RuntimeRecord = {
      definition,
      installDir: this.ports.installDirOf(addonId),
      settingsPages: [],
      collectedDefinitions: [],
      setupHandlers: new Map(),
      run: null,
      runState: 'idle',
      faultReason: undefined,
      editorGeneration: 0,
      settingsGeneration: 0,
    }
    this.records.set(addonId, record)
    try {
      definition.setup?.(this.buildSetupContext(addonId, record))
    } catch (err) {
      this.faultRecord(record, `setup 异常：${String(err)}`)
      return
    }
    this.syncRunState(record)
    this.notify()
  }

  private isLive(record: RuntimeRecord, addonId: string): boolean {
    return this.records.get(addonId) === record && record.runState !== 'faulted'
  }

  private buildSetupContext(addonId: string, record: RuntimeRecord): AddonSetupContext {
    return {
      addonId,
      apiVersion: this.ports.apiVersion,
      settings: {
        registerPage: (entry) => {
          if (!this.isLive(record, addonId)) {
            this.ports.log('late-registration-rejected', addonId, 'settings-page')
            return NOOP_HANDLE
          }
          const resolved = this.resolveEntry(addonId, record, entry, 'settings.registerPage')
          if (!resolved.ok) return NOOP_HANDLE
          record.settingsPages.push(resolved)
          this.notify()
          return {
            dispose: () => {
              const index = record.settingsPages.indexOf(resolved)
              if (index >= 0) {
                record.settingsPages.splice(index, 1)
                this.notify()
              }
            },
          }
        },
        registerDefinitions: (defs) => {
          if (!this.isLive(record, addonId)) {
            this.ports.log('late-registration-rejected', addonId, 'definitions')
            return NOOP_HANDLE
          }
          const stored = safeClone(defs)
          if (stored === CLONE_FAILED) {
            this.ports.log('definitions-rejected', addonId, 'definitions not serializable')
            return NOOP_HANDLE
          }
          record.collectedDefinitions.push(...(stored as unknown[]))
          return {
            dispose: () => {
              const index = record.collectedDefinitions.indexOf(stored)
              if (index >= 0) record.collectedDefinitions.splice(index, 1)
            },
          }
        },
      },
      channel: this.buildChannelRegistry(addonId, record, 'setup', record.setupHandlers),
    }
  }

  private buildChannelRegistry(
    addonId: string,
    record: RuntimeRecord,
    scope: 'setup' | 'run',
    table: Map<string, AddonChannelHandler>,
  ): { handle(topic: string, handler: AddonChannelHandler): AddonRegistrationHandle } {
    return {
      handle: (topic, handler) => {
        if (!this.isLive(record, addonId)) {
          this.ports.log('late-registration-rejected', addonId, `${scope}-channel:${topic}`)
          return NOOP_HANDLE
        }
        if (table.has(topic)) {
          // 同名 topic 重复注册：拒绝（普通 API 拒绝，不算故障；首个继续服务）
          this.ports.log('channel-duplicate-rejected', addonId, `${scope}:${topic}`)
          return NOOP_HANDLE
        }
        table.set(topic, handler)
        return {
          dispose: () => {
            if (table.get(topic) === handler) {
              table.delete(topic)
            }
          },
        }
      },
    }
  }

  private buildEnableContext(addonId: string, record: RuntimeRecord, run: RunContributions): AddonEnableContext {
    return {
      addonId,
      apiVersion: this.ports.apiVersion,
      pages: {
        registerEditor: (entry) => {
          if (!this.isLive(record, addonId) || record.run !== run) {
            this.ports.log('late-registration-rejected', addonId, 'editor-page')
            return NOOP_HANDLE
          }
          if (run.editorPages.length > 0) {
            // 每组件一个编辑器入口（一次装载一个工厂）；第二个拒绝
            this.ports.log('editor-page-duplicate-rejected', addonId, entry.entry)
            return NOOP_HANDLE
          }
          const resolved = this.resolveEntry(addonId, record, entry, 'pages.registerEditor')
          if (!resolved.ok) return NOOP_HANDLE
          run.editorPages.push(resolved)
          this.notify()
          return {
            dispose: () => {
              const index = run.editorPages.indexOf(resolved)
              if (index >= 0) {
                run.editorPages.splice(index, 1)
                this.notify()
              }
            },
          }
        },
      },
      channel: this.buildChannelRegistry(addonId, record, 'run', run.handlers),
      onDispose: (callback) => {
        if (!this.isLive(record, addonId) || record.run !== run) {
          // 已终结代次的迟到登记：立即执行（重复释放无害，对齐页面侧语义）
          try {
            callback()
          } catch {
            // 清理回调异常不升级为新故障
          }
          return
        }
        run.disposeCallbacks.push(callback)
      },
    }
  }

  private resolveEntry(
    addonId: string,
    record: RuntimeRecord,
    entry: { entry: string; css?: readonly string[]; resources?: readonly string[] },
    stage: string,
  ): ResolvedPageEntry | { ok: false } {
    if (record.installDir === undefined) {
      this.ports.log('page-entry-rejected', addonId, `${stage}: 安装目录不可解析`)
      return { ok: false }
    }
    const resolved = resolveAddonPageEntry(record.installDir, entry)
    if (!resolved.ok) {
      this.ports.log('page-entry-rejected', addonId, `${stage}: ${resolved.reason} ${resolved.detail ?? ''}`)
      return { ok: false }
    }
    return resolved
  }

  /** 期望（偏好）与现状对齐：faulted 吸持（手动重试先 release 旧代次） */
  private syncRunState(record: RuntimeRecord): void {
    const addonId = this.entryOf(record)
    if (record.runState === 'faulted') return
    const want = this.effectiveEnabled(addonId) && typeof record.definition.enable === 'function'
    if (want && record.runState !== 'enabled') {
      this.enableAddon(addonId, record)
    } else if (!want && record.runState === 'enabled') {
      this.disableAddon(record)
    }
  }

  private enableAddon(addonId: string, record: RuntimeRecord): void {
    const run: RunContributions = { editorPages: [], handlers: new Map(), disposeCallbacks: [] }
    record.run = run
    record.runState = 'enabled'
    record.faultReason = undefined
    try {
      record.definition.enable?.(this.buildEnableContext(addonId, record, run))
    } catch (err) {
      // 半初始化回收：已收集贡献（含清理回调）释放后转故障
      this.releaseRun(record)
      this.faultRecord(record, `enable 异常：${String(err)}`)
      return
    }
    if (run.editorPages.length > 0) {
      record.editorGeneration++
    }
    this.notify()
  }

  private disableAddon(record: RuntimeRecord): void {
    this.releaseRun(record)
    record.runState = 'disabled'
    this.notify()
  }

  private faultRecord(record: RuntimeRecord, reason: string): void {
    // 全部注册贡献暂停：运行贡献释放 + setup 通道注销 + 设置页装载撤下；
    // 保留设置定义、启用偏好与故障原因（状态可观察）
    this.releaseRun(record)
    record.setupHandlers.clear()
    record.runState = 'faulted'
    record.faultReason = reason
    if (this.settingsOpenAddon !== undefined && this.records.get(this.settingsOpenAddon) === record) {
      this.settingsOpenAddon = undefined
    }
    this.ports.log('fault', this.entryOf(record), reason)
    this.notify()
  }

  private releaseRun(record: RuntimeRecord): void {
    const run = record.run
    if (!run) return
    record.run = null
    for (const callback of run.disposeCallbacks.splice(0)) {
      try {
        callback()
      } catch (err) {
        this.ports.log('dispose-callback-error', this.entryOf(record), String(err))
      }
    }
  }

  /** 代次终结（registry.release / 手动重试入口）：全部贡献释放，记录移除 */
  private releaseGeneration(addonId: string): void {
    const record = this.records.get(addonId)
    if (!record) return
    this.releaseRun(record)
    if (this.settingsOpenAddon === addonId) {
      this.settingsOpenAddon = undefined
    }
    this.records.delete(addonId)
    this.notify()
  }

  private entryOf(record: RuntimeRecord): string {
    for (const [addonId, candidate] of this.records) {
      if (candidate === record) return addonId
    }
    return '<released>'
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      listener()
    }
  }
}

const CLONE_FAILED = Symbol('clone-failed')

/** 结构化克隆防线（设置定义入参同样只收 JSON 数据） */
function safeClone(value: unknown): unknown | typeof CLONE_FAILED {
  try {
    return structuredClone(value)
  } catch {
    return CLONE_FAILED
  }
}
