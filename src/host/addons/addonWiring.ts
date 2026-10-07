// #350 T01 / #351 T02 附加组件宿主装配（vscode 层）：注册表 + 运行生命
// 周期 + 发现协调 + 公开 registerAddon 入口 + 设置页面板接线 + 编辑器面板
// 桥 + 测试钩子。
//
// 装配职责（ADR-0012 Q25/Q26、设计文档第 2/3/4 节）：
// - Vsidian activate() 返回导出 API（apiVersion + registerAddon）——原生
//   激活完成后 VSCode 公布 exports，组件经
//   extensions.getExtension('onegayi.vsidian').exports 访问（同宿主）。
// - 发现协调 start() 在 activate 内 fire-and-forget 启动（先订阅
//   onDidChange 再扫描；不被自身 activate 等待）。
// - 注册入口核对当前宿主身份、API 范围、实验兼容与重复接入；setup/enable
//   生命周期经 hooks 桥由 AddonRuntime 驱动（#351）。
// - 面板桥（#351）：编辑器面板（textEditorProvider 注册）与设置页面板
//  （settingsPage 注册）各自把 addonPage.* 消息路由到 runtime；runtime
//   状态变化时刷新资源许可面（localResourceRoots）并按 desired 幂等推送
//   装载指令——URI 由各面板自己的 asWebviewUri 铸造（隔离由资源服务按
//   请求面板的许可面实现，V02 实测）。
// - 日常安装态日志写入 VSCode 输出通道（标明组件 ID、阶段与原因）。
import * as vscode from 'vscode'
import path from 'node:path'
import { realpath as fsRealpath } from 'node:fs/promises'
import {
  ADDON_API_VERSION,
  type AddonRegistrationResult,
  type AddonStatusEntry,
} from '../../shared/addonIdentity'
import { type AddonPageDirective, type AddonLoadManifest } from '../../shared/addonPage'
import {
  addonSettingValueMatches,
  resolveAddonSettingLayer,
} from '../../shared/addonSettings'
import type { AddonSettingsStatePayload, AddonSettingsAreaPayload } from '../../shared/protocol'
import { isWebviewToHost } from '../../shared/protocol'
import { AddonCoordinator, type AddonExtensionLike } from './addonCoordinator'
import { AddonRegistry, createDefaultRegistryPorts, type AddonDefinition } from './addonRegistry'
import { AddonRuntime, type AddonPreferenceStore, type AddonEditorLoadPlan, type AddonSettingsLoadPlan } from './addonRuntime'
import { AddonSettingsService, type AddonSettingsPersistencePort, type AddonSettingsUpdateResult } from './addonSettingsService'
import { AddonBehaviorStateService } from './addonBehaviorStateService'
import { createAddonRealpathGuard } from './addonRealpathGuard'
import { t } from '../../shared/i18n'

/** 本扩展自身 ID（附加组件建议声明对它的原生依赖） */
export const VSIDIAN_EXTENSION_ID = 'onegayi.vsidian'

/**
 * 公开导出 API（T02 形状；apiVersion 1.0.0 为首个候选版本——草案，未发布，
 * 不冒充已发布稳定契约）。
 */
export interface VsidianAddonExports {
  /** 宿主当前提供的稳定 API 版本 */
  readonly apiVersion: string
  /**
   * 附加组件接入注册入口。owner 为调用者的原生 Extension 身份（至少含
   * id；组件激活中即可调用）。同一接入代次重复注册返回
   * already-registered（不重跑 setup）；手动重试先 dispose 旧句柄（释放
   * 全部贡献）再注册。成功结果的 dispose 即「所属组件释放句柄」（设计
   * §3），重复调用无害。
   */
  registerAddon(
    owner: { id: string },
    definition?: AddonDefinition,
  ): AddonRegistrationResult & { dispose?(): void }
}

/** 编辑器面板桥（textEditorProvider 消费；#351） */
export interface AddonEditorBridge {
  /** 期望装载组件的资源根（编辑器面板 localResourceRoots 增量；目录去重） */
  editorResourceRoots(): vscode.Uri[]
  /** 面板消息路由（addonPage.*）；返回是否消费（消费后 provider 不再下发会话） */
  handlePanelMessage(sessionId: string, webview: vscode.Webview, message: unknown): boolean
  /** 面板销毁（视图关闭——装载器随 webview 消亡，宿主侧路由回收） */
  panelDisposed(sessionId: string): void
  /** runtime 状态变化订阅（provider 刷新资源根并推送指令 diff） */
  onPanelsChanged(listener: () => void): () => void
  /** 按当前期望装载清单对某面板推送指令（幂等对账：desired 为准） */
  pushDirectives(sessionId: string, webview: vscode.Webview): void
}

/** 设置页面板接线（settingsPage 消费） */
export interface AddonPageWiring {
  /** addons.state 消息载荷（宿主权威状态现算；合并运行生命周期状态） */
  getState(): { kind: 'addons.state' } & { apiVersion: string; draft: true; addons: readonly AddonStatusEntry[]; openAddonSettingsPage: string | null; openAddonSettings: string | null }
  /** #353 T04 addons.settingsState 消息载荷（基础设置区权威状态现算） */
  getSettingsState(): { kind: 'addons.settingsState' } & AddonSettingsStatePayload
  /** 市场搜索（关键词仅搜索辅助：vsidian-addon） */
  openSearch(): void
  /** VSCode 扩展管理视图 */
  openExtensionsView(): void
  /** 某组件的 VSCode 扩展详情页 */
  openExtension(extensionId: string): void
  /** #354 T05 打开附加组件日志输出通道（故障排障入口） */
  openLogs(): void
  /** #354 T05 故障手动重试（先释放旧代次再重新唤醒；状态经推送回显） */
  retryFaulted(addonId: string): Promise<'ok' | 'unknown' | 'host-unavailable'>
  // ---- #351 T02 ----
  /** 设置页面板资源根（全部可打开组件的页面目录；面板 open 时并入） */
  settingsResourceRoots(): vscode.Uri[]
  /** 设置页面板已建立（装载器就绪后消息由此路由；重载再挂即再调） */
  attachSettingsPanel(webview: vscode.Webview): void
  /** 设置页面板销毁（隐藏即释放——装载意图终结） */
  settingsPanelDisposed(): void
  /** 设置页面板消息路由（addonPage.* 与 addons.* 设置族） */
  handleSettingsMessage(webview: vscode.Webview, message: unknown): boolean
  /** 手动打开组件设置页（设置页面板不在场时由调用方先 open） */
  openAddonSettingsPage(addonId: string): 'ok' | 'not-registered' | 'faulted' | 'no-settings-page'
  /** #353 T04 手动打开基础设置区（测试钩子与集成的宿主侧等价入口） */
  openSettingsArea(addonId: string): 'ok' | 'not-registered' | 'no-definitions'
  /** #353 T04 设置服务快照（测试钩子与集成的观测面） */
  settingsServiceSnapshot(): {
    definitions: Readonly<Record<string, readonly unknown[]>>
    userValues: Readonly<Record<string, Readonly<Record<string, unknown>>>>
    workspaceValues: Readonly<Record<string, Readonly<Record<string, unknown>>>> | null
    hasWorkspace: boolean
    settingsAreaOpen: string | undefined
  }
}

export interface AddonWiring {
  /** 原生激活完成后经 activate() 返回值公布的导出 API */
  exports: VsidianAddonExports
  /** 设置页面板接线 */
  page: AddonPageWiring
  /** 编辑器面板桥（extension.ts 传给 createTextEditorProvider；#351） */
  editorBridge: AddonEditorBridge
  /** 启动发现协调（activate 内调用；内部 fire-and-forget 不阻塞） */
  start(): void
  /** 发现/协调状态变化订阅（extension.ts 接 settingsPage.notifyAddonsChanged） */
  onStateChanged(listener: () => void): () => void
  /** 运行生命周期状态变化订阅（启停/故障/注册/代次——同上接 addons.state
   *  推送；#351） */
  onRuntimeChanged(listener: () => void): () => void
  /** #353 T04 设置变化订阅（成功保存后——接设置页 addons.settingsState
   *  常规推送；变化事件只在持久化成功后到达此处） */
  onSettingsChanged(listener: () => void): () => void
  /** 停用收尾（context.subscriptions 驱动） */
  dispose(): void
}

/** 扩展展示名：displayName 缺失或非字符串时回退 Extension.id */
function extensionLabel(packageJSON: unknown, id: string): string {
  const displayName = (packageJSON as { displayName?: unknown } | undefined)?.displayName
  return typeof displayName === 'string' && displayName.length > 0 ? displayName : id
}

/** 启用偏好持久层键（user = globalState / workspace = workspaceState；
 *  #353 T04 起端口显式暴露 hasWorkspace——read().workspace 为 null 只代表
 *  该层无值） */
const PREFERENCE_KEY = 'vsidian.addons.enabled'

/** #353 T04 组件设置值持久层键（结构 version 1 冻结——shared/addonSettings） */
const ADDON_SETTINGS_KEY = 'vsidian.addons.settings'

/** #353 T04 无工作区判定：文件夹或多根工作区任一在场（空窗口 false） */
function hostHasWorkspace(): boolean {
  return vscode.workspace.workspaceFolders !== undefined || vscode.workspace.workspaceFile !== undefined
}

function createPreferenceStore(context: vscode.ExtensionContext): AddonPreferenceStore {
  const readScope = (scope: 'user' | 'workspace'): Record<string, boolean> | null => {
    const store = scope === 'user' ? context.globalState : context.workspaceState
    const value = store.get<Record<string, boolean>>(`${PREFERENCE_KEY}.${scope}`)
    return value && typeof value === 'object' ? value : null
  }
  return {
    hasWorkspace: hostHasWorkspace(),
    read: () => ({ user: readScope('user') ?? {}, workspace: readScope('workspace') }),
    write: (scope, values) => {
      const store = scope === 'user' ? context.globalState : context.workspaceState
      const key = `${PREFERENCE_KEY}.${scope}`
      const next = { ...(readScope(scope) ?? {}) }
      for (const [addonId, enabled] of Object.entries(values)) {
        if (enabled === undefined) {
          delete next[addonId]
        } else {
          next[addonId] = enabled
        }
      }
      void store.update(key, next)
    },
  }
}

/** #353 T04 组件设置值持久层（user = globalState / workspace = workspaceState） */
function createSettingsPersistence(context: vscode.ExtensionContext): AddonSettingsPersistencePort {
  return {
    get hasWorkspace() {
      return hostHasWorkspace()
    },
    read: (scope) => (scope === 'user' ? context.globalState : context.workspaceState).get(ADDON_SETTINGS_KEY),
    write: async (scope, value) => {
      try {
        await (scope === 'user' ? context.globalState : context.workspaceState).update(ADDON_SETTINGS_KEY, value)
        return true
      } catch (err) {
        return false
      }
    },
  }
}

export function createAddonWiring(context: vscode.ExtensionContext): AddonWiring {
  const channel = vscode.window.createOutputChannel(t('host.addonsChannelName'))
  const log = (message: string): void => {
    channel.appendLine(`[${new Date().toISOString()}] ${message}`)
  }

  // 注册表 + 运行生命周期：findExtension 核对「当前扩展宿主注册表中的记录」
  //（查不到 = 当前宿主不可用——不等于未安装或装错侧）；installDirOf 以
  // 扩展安装目录为资源授权锚（extensionUri.fsPath）
  // #353 T04：设置服务（定义注册/按批读写/变化事件）随 runtime 装配
  const preferenceStore = createPreferenceStore(context)
  const settingsLog = (stage: string, addonId: string, detail: string): void => {
    log(`addon ${addonId} settings ${stage}: ${detail}`)
  }
  const settingsService = new AddonSettingsService(createSettingsPersistence(context), settingsLog)
  // T07（#356）行为顺序与逐项开关：宿主侧持久化（globalState 单层——存储
  // 决策见 shared/addonBehaviors；变化推送下方 wiring 内接线）
  const ADDON_BEHAVIOR_STATE_KEY = 'vsidian.addonBehaviors.state.v1'
  const behaviorStateService = new AddonBehaviorStateService({
    read: () => context.globalState.get(ADDON_BEHAVIOR_STATE_KEY),
    write: async (value) => {
      try {
        await context.globalState.update(ADDON_BEHAVIOR_STATE_KEY, value)
        return true
      } catch {
        return false
      }
    },
  })
  const runtime = new AddonRuntime({
    apiVersion: ADDON_API_VERSION,
    preferences: preferenceStore,
    settings: settingsService,
    installDirOf: (addonId) => vscode.extensions.getExtension(addonId)?.extensionUri.fsPath,
    log: (stage, addonId, detail) => log(`addon ${addonId} ${stage}: ${detail}`),
  })
  const registry = new AddonRegistry(
    createDefaultRegistryPorts((id) => vscode.extensions.getExtension(id)),
    runtime.registryHooks(),
  )

  const toExtensionLike = (extension: vscode.Extension<unknown>): AddonExtensionLike => ({
    id: extension.id,
    label: extensionLabel(extension.packageJSON, extension.id),
    packageJSON: extension.packageJSON,
    isActive: extension.isActive,
    // 1.82.3 的 Extension.activate 返回 Thenable——统一为 Promise（协调器
    // 内按 ID 合并与异常捕获）
    activate: async () => extension.activate(),
  })

  // 发现协调端口：ensureSelfApiPublished 等自身原生激活完成（activate()
  // 幂等——start() 未被自身 activate 等待，此处 await 不构成互等）
  const selfExtension = vscode.extensions.getExtension(VSIDIAN_EXTENSION_ID)
  const coordinator = new AddonCoordinator(
    {
      selfExtensionId: VSIDIAN_EXTENSION_ID,
      ensureSelfApiPublished: async () => {
        if (selfExtension) {
          await selfExtension.activate()
        }
      },
      getAllExtensions: () => vscode.extensions.all.map(toExtensionLike),
      onExtensionsChanged: (listener) => vscode.extensions.onDidChange(listener),
    },
    registry,
  )

  // 协调状态进入失败态时留日志（组件 ID + 阶段 + 原因）；正常轮换不打扰
  coordinator.onStateChanged(() => {
    for (const entry of coordinator.stateEntries()) {
      if (entry.status === 'activation-failed') {
        log(`addon ${entry.id} activation failed: ${entry.detail ?? 'unknown error'}`)
      }
    }
  })

  const exportsApi: VsidianAddonExports = {
    apiVersion: ADDON_API_VERSION,
    registerAddon: (owner, definition) => {
      const result = registry.register(owner, definition ?? {})
      if (!result.ok) {
        log(`addon ${owner.id} register rejected: ${result.reason}${result.detail ? ` (${result.detail})` : ''}`)
      }
      // 所属组件释放句柄（设计 §3）：dispose 释放本接入代次的全部贡献；
      // 组件手动重新接入 = dispose 后再次 registerAddon
      return { ...result, ...(result.ok ? { dispose: () => registry.release(owner.id) } : {}) }
    },
  }

  // ---- 状态呈现（合并运行生命周期；设置页 addons.state 载荷） ----
  const mergeRuntimeStatus = (entry: AddonStatusEntry): AddonStatusEntry => {
    const status = runtime.runtimeStatus(entry.id)
    if (!status) {
      return entry
    }
    return {
      ...entry,
      enabled: status.enabled,
      hasSettingsPage: status.hasSettingsPage,
      // #353 T04 定义保留（故障暂停仍在——基础控件可用）
      hasSettingsDefinitions: settingsService.hasDefinitions(entry.id),
      ...(status.faultReason !== undefined ? { fault: { reason: status.faultReason } } : {}),
    }
  }

  const getState = () => ({
    kind: 'addons.state' as const,
    apiVersion: ADDON_API_VERSION,
    draft: true as const,
    addons: [...coordinator.stateEntries()].map(mergeRuntimeStatus),
    // #351 T02 当前打开的组件设置页（权威在 runtime；设置页分页挂载区依据）
    openAddonSettingsPage: runtime.openSettingsAddonId() ?? null,
    // #353 T04 基础设置区当前打开的组件（定义驱动平台控件区）
    openAddonSettings: runtime.settingsAreaAddonId() ?? null,
  })

  // ---- #353 T04 基础设置区载荷（addons.settingsState） ----

  /** 构造单组件设置区载荷（层显式值仅当通过当前定义校验时下发——UI 不显示漂移值） */
  const buildSettingsArea = (addonId: string): AddonSettingsAreaPayload | null => {
    const entry = coordinator.stateEntries().find((item) => item.id === addonId)
    if (!entry) return null
    const status = runtime.runtimeStatus(addonId)
    const snapshot = settingsService.effectiveSnapshot(addonId)
    const definitions = settingsService.definitionsOf(addonId)
    const values: Record<string, AddonSettingsAreaPayload['values'][string]> = {}
    for (const def of definitions) {
      const userValue = snapshot.userValues[def.key]
      const workspaceValue = snapshot.workspaceValues?.[def.key]
      const resolved = resolveAddonSettingLayer(def, userValue, workspaceValue)
      values[def.key] = {
        effective: resolved.value,
        ...(userValue !== undefined && addonSettingValueMatches(def, userValue) ? { user: userValue } : {}),
        ...(workspaceValue !== undefined && addonSettingValueMatches(def, workspaceValue) ? { workspace: workspaceValue } : {}),
        source: resolved.source,
      }
    }
    const preferences = preferenceStore.read()
    const userExplicit = addonId in preferences.user ? preferences.user[addonId] : null
    const workspaceExplicit = preferences.workspace !== null && addonId in preferences.workspace ? preferences.workspace[addonId] : null
    const source = workspaceExplicit !== null ? 'workspace' : userExplicit !== null ? 'user' : 'default'
    return {
      addonId,
      label: entry.label,
      faulted: status?.runState === 'faulted',
      ...(status?.faultReason !== undefined ? { faultReason: status.faultReason } : {}),
      hasCustomPage: status?.hasSettingsPage === true,
      enabled: {
        effective: runtime.effectiveEnabled(addonId),
        userExplicit,
        workspaceExplicit,
        source,
      },
      definitions,
      values,
    }
  }

  const getSettingsState = (): { kind: 'addons.settingsState' } & AddonSettingsStatePayload => {
    const open = runtime.settingsAreaAddonId() ?? null
    return {
      kind: 'addons.settingsState',
      apiVersion: ADDON_API_VERSION,
      draft: true,
      open,
      hasWorkspace: hostHasWorkspace(),
      addon: open === null ? null : buildSettingsArea(open),
      openAddonSettingsPage: runtime.openSettingsAddonId() ?? null,
    }
  }

  /** 设置区保存/清除操作的应答推送（带操作结局提示——失败不虚报） */
  const postSettingsState = (webview: vscode.Webview, notice?: AddonSettingsStatePayload['notice']): void => {
    const state = getSettingsState()
    const payload = notice === undefined ? state : { ...state, notice }
    try {
      void webview.postMessage(payload).then(undefined, () => {})
    } catch {
      // 面板已销毁：下次装载经 addons.settingsGet 拉取权威状态
    }
  }

  // ---- 面板桥公共：manifest 铸造（各面板自己的 asWebviewUri）与回执 ----
  const buildManifest = (
    webview: vscode.Webview,
    plan: { addonId: string; generation: number; page: 'editor' | 'settings'; entryFsPath: string; cssFsPaths: readonly string[]; resourceBaseFsPath: string | null },
  ): AddonLoadManifest => ({
    addonId: plan.addonId,
    generation: plan.generation,
    page: plan.page,
    scriptUri: webview.asWebviewUri(vscode.Uri.file(plan.entryFsPath)).toString(),
    cssUris: plan.cssFsPaths.map((fsPath) => webview.asWebviewUri(vscode.Uri.file(fsPath)).toString()),
    ...(plan.resourceBaseFsPath !== null
      ? { resourceBase: webview.asWebviewUri(vscode.Uri.file(plan.resourceBaseFsPath)).toString() }
      : {}),
  })

  /** 出站消息处理（loaded/faulted → runtime 故障；channel.request → 路由回执） */
  const handleOutboundFor = (panel: 'editor' | 'settings', post: (directive: AddonPageDirective) => void) => (message: unknown): void => {
    if (!isWebviewToHost(message) || message.kind !== 'addonPage.outbound') {
      return
    }
    const outbound = message.outbound
    if (outbound.type === 'addon.channel.request') {
      recordEvent(panel, { kind: 'outbound.request', addonId: outbound.addonId, generation: outbound.generation, topic: outbound.topic })
      void runtime
        .dispatchChannelRequest(outbound.addonId, outbound.topic, outbound.payload)
        .then((outcome) => {
          post({
            type: 'addon.channel.reply',
            addonId: outbound.addonId,
            generation: outbound.generation,
            requestId: outbound.requestId,
            outcome,
          })
        })
      return
    }
    if (outbound.type === 'addon.loaded') {
      recordEvent(panel, {
        kind: 'outbound.loaded',
        addonId: outbound.addonId,
        generation: outbound.generation,
        ok: outbound.outcome.ok,
        ...(outbound.outcome.ok ? {} : { reason: outbound.outcome.reason }),
      })
    } else if (outbound.type === 'addon.unloaded') {
      recordEvent(panel, {
        kind: 'outbound.unloaded',
        addonId: outbound.addonId,
        generation: outbound.generation,
        ok: outbound.outcome.ok,
        ...(outbound.outcome.ok ? {} : { reason: outbound.outcome.reason }),
      })
    } else if (outbound.type === 'addon.faulted') {
      recordEvent(panel, { kind: 'outbound.faulted', addonId: outbound.addonId, generation: outbound.generation, reason: outbound.reason })
    }
    runtime.handleOutbound(outbound)
  }

  const directiveRootsOf = (plans: Iterable<{ entryFsPath: string; cssFsPaths: readonly string[]; resourceBaseFsPath: string | null }>): vscode.Uri[] => {
    const roots = new Set<string>()
    const addFileDir = (fsPath: string): void => {
      roots.add(path.dirname(path.resolve(fsPath)))
    }
    // 入口/样式取所在目录；资源基址本身是目录
    for (const plan of plans) {
      addFileDir(plan.entryFsPath)
      for (const css of plan.cssFsPaths) {
        addFileDir(css)
      }
      if (plan.resourceBaseFsPath !== null) {
        roots.add(path.resolve(plan.resourceBaseFsPath))
      }
    }
    // #354 T05 realpath 逃逸目录不进资源许可面（已判逃逸的计划目录全撤）
    return [...roots]
      .filter((dir) => !realpathEscapeRoots.has(dir))
      .map((dir) => vscode.Uri.file(dir))
  }

  // ---- #354 T05 realpath 符号链接逃逸守卫（V02 未验项收口） ----
  // 词法包含性（addonPageRegistry 第一层）挡不住「安装目录内符号链接指向
  // 目录外」；装载意图（addon.load 推送）前对入口/样式/资源基址取真实
  // 路径复核，任一逃逸整计划拒绝（组件页面代码不装载）。已判逃逸的目录
  // 同步从资源许可面排除。
  const realpathGuard = createAddonRealpathGuard(
    { realpath: (fsPath) => fsRealpath(fsPath) },
    (stage, addonId, detail) => log(`addon ${addonId} ${stage}: ${detail}`),
  )
  /** 已判逃逸计划的目录级排除表（资源根授权排除用；词法路径） */
  const realpathEscapeRoots = new Set<string>()
  const blockEscapePlanRoots = (plan: { entryFsPath: string; cssFsPaths: readonly string[]; resourceBaseFsPath: string | null }): void => {
    realpathEscapeRoots.add(path.dirname(path.resolve(plan.entryFsPath)))
    for (const css of plan.cssFsPaths) {
      realpathEscapeRoots.add(path.dirname(path.resolve(css)))
    }
    if (plan.resourceBaseFsPath !== null) {
      realpathEscapeRoots.add(path.resolve(plan.resourceBaseFsPath))
    }
  }
  /** 面板刷新触发（验证完成/escape 登记后由装载门控链调用） */
  const notifyAddonPanels = (): void => {
    for (const listener of [...panelListeners]) {
      listener()
    }
    if (settingsPanel) {
      pushSettingsDirectives(settingsPanel)
    }
  }

  // ---- #351 T02 面板桥事件观测（集成断言面：指令推送与出站结局留痕；
  //  最近 200 条，_test.addonPageEvents 读取/清空——仅测试钩子消费） ----
  const addonPageEvents: Array<{ panel: 'editor' | 'settings'; kind: string; addonId: string; generation?: number; ok?: boolean; reason?: string; topic?: string }> = []
  const recordEvent = (panel: 'editor' | 'settings', event: { kind: string; addonId: string; generation?: number; ok?: boolean; reason?: string; topic?: string }): void => {
    addonPageEvents.push({ panel, ...event })
    if (addonPageEvents.length > 200) {
      addonPageEvents.splice(0, addonPageEvents.length - 200)
    }
  }
  const directiveEventOf = (directive: AddonPageDirective): { kind: string; addonId: string; generation?: number } => {
    switch (directive.type) {
      case 'addon.load':
        return { kind: 'directive.load', addonId: directive.manifest.addonId, generation: directive.manifest.generation }
      case 'addon.unload':
        return { kind: 'directive.unload', addonId: directive.addonId, generation: directive.generation }
      default:
        return { kind: `directive.${directive.type}`, addonId: directive.addonId, generation: directive.generation }
    }
  }

  /** 面板指令投递（disposed webview 不炸状态机链路——记录后吞掉异常） */
  const postDirective = (webview: vscode.Webview, directive: AddonPageDirective): void => {
    try {
      void webview.postMessage({ kind: 'addonPage.directive', directive }).then(undefined, () => {})
    } catch {
      // 面板已销毁：装载器随 webview 消亡，无需投递
    }
  }

  /** T07（#356）行为状态下发（顺序覆盖 + 逐项开关；面板销毁静默容忍） */
  const postBehaviorState = (webview: vscode.Webview): void => {
    try {
      const snapshot = behaviorStateService.snapshot()
      const state = snapshot.order.length === 0 && snapshot.disabled.length === 0
        ? null
        : { version: 1 as const, order: snapshot.order, disabled: snapshot.disabled }
      void webview.postMessage({ kind: 'addon.behaviors.state', state }).then(undefined, () => {})
    } catch {
      // 面板已销毁：下次对账（ready/状态变化）重推
    }
  }

  // ---- 编辑器面板桥（#351）----
  interface EditorPanelRecord {
    webview: vscode.Webview
    /** 本面板已推送的装载（addonId → generation；desired 对账用） */
    pushed: Map<string, number>
    /** #354 T05 realpath 验证在途的装载（addonId → generation；去重用） */
    pendingVerify: Map<string, number>
  }
  const editorPanels = new Map<string, EditorPanelRecord>()
  const panelListeners = new Set<() => void>()

  const pushEditorDirectives = (record: EditorPanelRecord): void => {
    // T07（#356）行为状态下发（随装载指令对账同拍：ready/状态变化/显式
    // pushDirectives 都经此处；null = 无用户覆盖——默认序全开启）
    postBehaviorState(record.webview)
    const desired = runtime.desiredEditorLoads()
    const desiredIds = new Set(desired.map((plan) => plan.addonId))
    // 停用/故障/释放的组件：推送 unload（携带最后装载代次；装载器幂等）
    for (const [addonId, generation] of [...record.pushed.entries()]) {
      if (!desiredIds.has(addonId)) {
        const directive: AddonPageDirective = { type: 'addon.unload', addonId, generation }
        recordEvent('editor', directiveEventOf(directive))
        postDirective(record.webview, directive)
        record.pushed.delete(addonId)
      }
    }
    for (const plan of desired) {
      const pushed = record.pushed.get(plan.addonId)
      if (pushed === plan.generation) {
        continue // 同代次已推送（webview 重载由 ready 重推）
      }
      void postEditorLoadIfVerified(record, plan)
    }
  }

  /**
   * #354 T05 realpath 装载门控：addon.load 推送前对计划路径取真实路径
   * 复核（逃逸 = 符号链接指向组件安装目录外）。验证在途按 addonId+代次
   * 去重；escape 整计划拒绝（不装载、不授权资源根）并登记目录排除表；
   * 验证通过才推送装载指令（面板 ready 重推与状态变化重推走缓存，幂等）。
   */
  const postEditorLoadIfVerified = async (record: EditorPanelRecord, plan: AddonEditorLoadPlan): Promise<void> => {
    if (record.pushed.get(plan.addonId) === plan.generation) return
    if (record.pendingVerify.get(plan.addonId) === plan.generation) return
    // 已判逃逸的入口/样式/资源基址：直接拒绝（免文件系统复核）
    if (
      realpathGuard.isEscapedDir(plan.entryFsPath) ||
      plan.cssFsPaths.some((css) => realpathGuard.isEscapedDir(css)) ||
      (plan.resourceBaseFsPath !== null && realpathGuard.isEscapedDir(plan.resourceBaseFsPath))
    ) {
      recordEvent('editor', { kind: 'directive.load-rejected-realpath', addonId: plan.addonId, generation: plan.generation })
      return
    }
    record.pendingVerify.set(plan.addonId, plan.generation)
    const verdict = await verifyLoadPlan(plan)
    record.pendingVerify.delete(plan.addonId)
    if (verdict === 'escape') {
      blockEscapePlanRoots(plan)
      recordEvent('editor', { kind: 'directive.load-rejected-realpath', addonId: plan.addonId, generation: plan.generation })
      return
    }
    if (record.pushed.get(plan.addonId) === plan.generation) return
    const directive: AddonPageDirective = { type: 'addon.load', manifest: buildManifest(record.webview, plan) }
    recordEvent('editor', directiveEventOf(directive))
    postDirective(record.webview, directive)
    record.pushed.set(plan.addonId, plan.generation)
  }

  /** realpath 守卫的统一装载计划输入（安装目录锚从扩展注册表解析） */
  const verifyLoadPlan = (plan: { addonId: string; entryFsPath: string; cssFsPaths: readonly string[]; resourceBaseFsPath: string | null }): Promise<'ok' | 'escape'> => {
    const installDir = vscode.extensions.getExtension(plan.addonId)?.extensionUri.fsPath
    if (installDir === undefined) {
      return Promise.resolve('escape')
    }
    return realpathGuard.verifyPlan({
      addonId: plan.addonId,
      installDir,
      fileFsPaths: [plan.entryFsPath, ...plan.cssFsPaths],
      dirFsPaths: [plan.resourceBaseFsPath],
    })
  }

  const handleEditorPanelMessage = (record: EditorPanelRecord, message: unknown): boolean => {
    if (!isWebviewToHost(message)) {
      return false
    }
    if (message.kind === 'addonPage.ready') {
      // webview 重载 = 新装载器生命周期的开始：对账基线归零后全量重推
      //（同代次幂等重发；不归零会把重载误判为「已推送」而永远跳过）
      record.pushed.clear()
      record.pendingVerify.clear()
      pushEditorDirectives(record)
      return true
    }
    if (message.kind === 'addonPage.outbound') {
      handleOutboundFor('editor', (directive) => {
        postDirective(record.webview, directive)
      })(message)
      return true
    }
    return false
  }

  const editorBridge: AddonEditorBridge = {
    editorResourceRoots: () => directiveRootsOf(runtime.desiredEditorLoads()),
    handlePanelMessage: (sessionId, webview, message) => {
      const record = editorPanels.get(sessionId)
      if (!record) {
        // 未注册面板（首条消息即 addonPage.ready 时就地登记）
        if (isWebviewToHost(message) && message.kind === 'addonPage.ready') {
          const fresh: EditorPanelRecord = { webview, pushed: new Map(), pendingVerify: new Map() }
          editorPanels.set(sessionId, fresh)
          return handleEditorPanelMessage(fresh, message)
        }
        return false
      }
      return handleEditorPanelMessage(record, message)
    },
    panelDisposed: (sessionId) => {
      editorPanels.delete(sessionId)
    },
    onPanelsChanged: (listener) => {
      panelListeners.add(listener)
      return () => panelListeners.delete(listener)
    },
    pushDirectives: (sessionId, webview) => {
      const record = editorPanels.get(sessionId) ?? { webview, pushed: new Map(), pendingVerify: new Map() }
      if (!editorPanels.has(sessionId)) {
        editorPanels.set(sessionId, record)
      }
      pushEditorDirectives(record)
    },
  }

  // ---- 设置页面板桥（#351；单面板，隐藏即销毁重开重载） ----
  interface SettingsPanelRecord {
    webview: vscode.Webview
    pushed: { addonId: string; generation: number } | null
    /** #354 T05 realpath 验证在途（null = 无） */
    pendingVerify: { addonId: string; generation: number } | null
  }
  let settingsPanel: SettingsPanelRecord | undefined

  const pushSettingsDirectives = (record: SettingsPanelRecord): void => {
    const desired = runtime.desiredSettingsLoad()
    if (desired === null) {
      if (record.pushed) {
        const directive: AddonPageDirective = { type: 'addon.unload', addonId: record.pushed.addonId, generation: record.pushed.generation }
        recordEvent('settings', directiveEventOf(directive))
        postDirective(record.webview, directive)
        record.pushed = null
      }
      return
    }
    if (record.pushed && record.pushed.addonId === desired.addonId && record.pushed.generation === desired.generation) {
      return
    }
    // #354 T05 realpath 装载门控（同编辑器面板：逃逸计划不装载）
    void postSettingsLoadIfVerified(record, desired)
  }

  /** #354 T05 设置面板的 realpath 门控推送（验证在途去重；escape 拒绝并登记目录排除） */
  const postSettingsLoadIfVerified = async (record: SettingsPanelRecord, plan: AddonSettingsLoadPlan): Promise<void> => {
    if (record.pushed?.addonId === plan.addonId && record.pushed.generation === plan.generation) return
    if (record.pendingVerify?.addonId === plan.addonId && record.pendingVerify.generation === plan.generation) return
    if (
      realpathGuard.isEscapedDir(plan.entryFsPath) ||
      plan.cssFsPaths.some((css) => realpathGuard.isEscapedDir(css)) ||
      (plan.resourceBaseFsPath !== null && realpathGuard.isEscapedDir(plan.resourceBaseFsPath))
    ) {
      recordEvent('settings', { kind: 'directive.load-rejected-realpath', addonId: plan.addonId, generation: plan.generation })
      return
    }
    record.pendingVerify = { addonId: plan.addonId, generation: plan.generation }
    const verdict = await verifyLoadPlan(plan)
    record.pendingVerify = null
    if (verdict === 'escape') {
      blockEscapePlanRoots(plan)
      recordEvent('settings', { kind: 'directive.load-rejected-realpath', addonId: plan.addonId, generation: plan.generation })
      return
    }
    if (record.pushed?.addonId === plan.addonId && record.pushed.generation === plan.generation) return
    const directive: AddonPageDirective = { type: 'addon.load', manifest: buildManifest(record.webview, plan) }
    recordEvent('settings', directiveEventOf(directive))
    postDirective(record.webview, directive)
    record.pushed = { addonId: plan.addonId, generation: plan.generation }
  }

  /** 全部可打开设置页的组件资源根（面板 open 时并入许可面——避免运行中
   *  重赋 options；目录集合只增不减直至重开） */
  const settingsCapableRoots = (): vscode.Uri[] => {
    const plans: Array<{ entryFsPath: string; cssFsPaths: readonly string[]; resourceBaseFsPath: string | null }> = []
    for (const entry of getState().addons) {
      if (entry.hasSettingsPage) {
        const capable = runtime.settingsPagePlanFor(entry.id)
        if (capable) {
          plans.push(capable)
        }
      }
    }
    return directiveRootsOf(plans)
  }

  const handleSettingsMessage = (webview: vscode.Webview, message: unknown): boolean => {
    if (!isWebviewToHost(message)) {
      return false
    }
    const ensureRecord = (): SettingsPanelRecord => {
      if (!settingsPanel || settingsPanel.webview !== webview) {
        settingsPanel = { webview, pushed: null, pendingVerify: null }
      }
      return settingsPanel
    }
    switch (message.kind) {
      case 'addonPage.ready': {
        const record = ensureRecord()
        // 面板重载 = 新装载器：对账基线归零后全量重推（同编辑器面板语义）
        record.pushed = null
        pushSettingsDirectives(record)
        return true
      }
      case 'addonPage.outbound': {
        const record = ensureRecord()
        handleOutboundFor('settings', (directive) => {
          postDirective(record.webview, directive)
        })(message)
        return true
      }
      case 'addons.setEnabled': {
        // #351 T02 功能开关；#353 T04 起可选 scope（缺省 user 保持语义）
        runtime.setEnabledScope(message.addonId, message.scope ?? 'user', message.enabled)
        postSettingsState(webview)
        return true
      }
      case 'addons.clearEnabledOverride': {
        // #353 T04 清除功能开关的工作区覆盖
        runtime.clearEnabledOverride(message.addonId)
        postSettingsState(webview)
        return true
      }
      // ---- #353 T04 基础设置区：开合与按批写入 ----
      case 'addons.settingsOpen': {
        runtime.openSettingsArea(message.addonId)
        postSettingsState(webview)
        return true
      }
      case 'addons.settingsClose': {
        runtime.closeSettingsArea()
        postSettingsState(webview)
        return true
      }
      case 'addons.settingsUpdate': {
        // 按批写入：结果应答推送（失败带原因码——不虚报）；成功后服务
        // onChanged 的常规推送由 extension.ts 接线补发（不带 notice）
        void settingsService.update(message.addonId, message.scope, message.values).then((result: AddonSettingsUpdateResult) => {
          if (result.ok) {
            postSettingsState(webview, { kind: 'saved', scope: message.scope, keys: Object.keys(message.values) })
          } else {
            postSettingsState(webview, {
              kind: 'save-failed',
              reason: result.reason,
              ...(result.invalidKeys !== undefined ? { keys: result.invalidKeys } : {}),
              scope: message.scope,
            })
          }
        })
        return true
      }
      case 'addons.settingsClearOverride': {
        void settingsService.clearWorkspaceOverride(message.addonId, message.key).then((result: AddonSettingsUpdateResult) => {
          if (result.ok) {
            postSettingsState(webview, { kind: 'saved', keys: [message.key] })
          } else {
            postSettingsState(webview, { kind: 'save-failed', ...(result.reason !== 'no-workspace' ? { reason: result.reason } : {}), keys: [message.key] })
          }
        })
        return true
      }
      case 'addons.openAddonPage': {
        runtime.openSettingsPage(message.addonId)
        const record = settingsPanel
        if (record) {
          pushSettingsDirectives(record)
        }
        return true
      }
      case 'addons.closeAddonPage': {
        runtime.closeSettingsPage()
        const record = settingsPanel
        if (record) {
          pushSettingsDirectives(record)
        }
        return true
      }
      // ---- #354 T05 故障排障入口（日志 + 手动重试；状态经推送回显） ----
      case 'addons.openLogs': {
        channel.show()
        return true
      }
      case 'addons.retry': {
        void coordinator.retry(message.addonId)
        return true
      }
      default:
        return false
    }
  }

  const page: AddonPageWiring = {
    getState,
    getSettingsState,
    openSearch: () => {
      // 关键词仅帮助市场寻找（vsidian-addon）；不代表接入协议或官方身份
      void vscode.commands.executeCommand('workbench.extensions.search', '@keyword:"vsidian-addon"')
    },
    openExtensionsView: () => {
      void vscode.commands.executeCommand('workbench.view.extensions')
    },
    openExtension: (extensionId) => {
      void vscode.commands.executeCommand('extension.open', extensionId)
    },
    // #354 T05 故障排障入口：日志输出通道（安装态日志标明组件 ID/阶段/原因）
    openLogs: () => {
      channel.show()
    },
    // #354 T05 故障手动重试：释放旧代次 + 重新唤醒（协调器如实呈现结局）
    retryFaulted: (addonId) => coordinator.retry(addonId),
    settingsResourceRoots: settingsCapableRoots,
    attachSettingsPanel: (webview) => {
      settingsPanel = { webview, pushed: null, pendingVerify: null }
    },
    settingsPanelDisposed: () => {
      settingsPanel = undefined
      runtime.settingsPanelGone()
    },
    handleSettingsMessage,
    openAddonSettingsPage: (addonId) => runtime.openSettingsPage(addonId),
    openSettingsArea: (addonId) => runtime.openSettingsArea(addonId),
    settingsServiceSnapshot: () => {
      const definitions: Record<string, readonly unknown[]> = {}
      const userValues: Record<string, Readonly<Record<string, unknown>>> = {}
      const workspaceValues: Record<string, Readonly<Record<string, unknown>>> | null = hostHasWorkspace() ? {} : null
      for (const entry of coordinator.stateEntries()) {
        definitions[entry.id] = settingsService.definitionsOf(entry.id)
        const snapshot = settingsService.effectiveSnapshot(entry.id)
        userValues[entry.id] = snapshot.userValues
        if (workspaceValues !== null) {
          workspaceValues[entry.id] = snapshot.workspaceValues ?? {}
        }
      }
      return {
        definitions,
        userValues,
        workspaceValues,
        hasWorkspace: hostHasWorkspace(),
        settingsAreaOpen: runtime.settingsAreaAddonId(),
      }
    },
  }

  // ---- runtime 状态变化 → 面板刷新（编辑器：provider 订阅 onPanelsChanged
  //  刷新资源根并推送指令；设置页：此处直推 + addons.state 推送经
  //  extension.ts 的 onRuntimeChanged 接线） ----
  const offRuntimeChanged = runtime.onChanged(() => {
    notifyAddonPanels()
  })

  // T07（#356）行为状态变化（排序/开关成功落库后）→ 全部活跃编辑器面板
  // 即时推送（webview runtime applyHostState 即时生效——不经 CM6 装配）
  behaviorStateService.onChanged(() => {
    for (const record of [...editorPanels.values()]) {
      postBehaviorState(record.webview)
    }
  })

  // ---- 测试钩子命令：仅集成测试经 runTest.mjs 注入 VSIDIAN_TEST_HOOKS=1
  //  时注册（判据与 textEditorProvider / editorGuardWiring 门控块一致），
  //  生产 VSIX 与常规 F5 开发不暴露 ----
  if (process.env.VSIDIAN_TEST_HOOKS === '1') {
    context.subscriptions.push(
      vscode.commands.registerCommand('onegayi.vsidian._test.getAddonsState', () => getState()),
      // 清单刷新/重复扫描入口（真宿主验证协调幂等：重复请求不重复注册）
      vscode.commands.registerCommand('onegayi.vsidian._test.addonsRescan', () => coordinator.rescan()),
      // #351 功能开关与通道观测（设置页 UI 驱动的宿主侧等价入口）
      vscode.commands.registerCommand('onegayi.vsidian._test.addonSetEnabled', (args: { addonId: string; enabled: boolean }) => {
        runtime.setUserEnabled(args.addonId, args.enabled)
        return getState()
      }),
      vscode.commands.registerCommand('onegayi.vsidian._test.addonChannelRequest', (args: { addonId: string; topic: string; payload?: unknown }) =>
        runtime.dispatchChannelRequest(args.addonId, args.topic, args.payload ?? null)),
      vscode.commands.registerCommand('onegayi.vsidian._test.addonRuntimeStatus', (args: { addonId: string }) =>
        runtime.runtimeStatus(args.addonId) ?? null),
      // 手动重新接入原语：release 旧代次（组件侧随后 re-register；激活
      // 失败过的 activate() 假成功——不自动重试，见 T01 实证）
      vscode.commands.registerCommand('onegayi.vsidian._test.addonReleaseGeneration', (args: { addonId: string }) => {
        registry.release(args.addonId)
        return true
      }),
      // #351 面板桥事件观测（指令推送与出站结局留痕；clear=true 清空）
      vscode.commands.registerCommand('onegayi.vsidian._test.addonPageEvents', (args?: { clear?: boolean }) => {
        const snapshot = [...addonPageEvents]
        if (args?.clear) {
          addonPageEvents.splice(0)
        }
        return snapshot
      }),
      // #351 打开/关闭组件设置页（设置页 UI 的宿主侧等价入口——面板须
      // 已打开，装载意图变化由 runtime.onChanged 驱动推送）
      vscode.commands.registerCommand('onegayi.vsidian._test.addonOpenSettingsPage', (args: { addonId: string }) =>
        runtime.openSettingsPage(args.addonId)),
      vscode.commands.registerCommand('onegayi.vsidian._test.addonCloseSettingsPage', () => {
        runtime.closeSettingsPage()
        return true
      }),
      // #351 启用偏好持久层快照（user/workspace 两层显式值——「停用选择
      // 持久保留」的集成断言面；重启语义由单元测试「同 store 新实例」钉住）
      vscode.commands.registerCommand('onegayi.vsidian._test.addonPreferences', () => {
        const preferences = preferenceStore.read()
        return { user: preferences.user, workspace: preferences.workspace }
      }),
      // ---- #353 T04 设置服务与基础设置区（集成的宿主侧断言面） ----
      vscode.commands.registerCommand('onegayi.vsidian._test.addonSettingsState', () => page.settingsServiceSnapshot()),
      vscode.commands.registerCommand('onegayi.vsidian._test.addonSettingsGet', (args: { addonId: string }) => {
        const snapshot = settingsService.effectiveSnapshot(args.addonId)
        return { values: snapshot.values, sources: snapshot.sources, userValues: snapshot.userValues, workspaceValues: snapshot.workspaceValues }
      }),
      vscode.commands.registerCommand('onegayi.vsidian._test.addonSettingsUpdate', (args: { addonId: string; scope: 'user' | 'workspace'; values: Record<string, unknown> }) =>
        settingsService.update(args.addonId, args.scope, args.values)),
      vscode.commands.registerCommand('onegayi.vsidian._test.addonSettingsClearOverride', (args: { addonId: string; key: string }) =>
        settingsService.clearWorkspaceOverride(args.addonId, args.key)),
      vscode.commands.registerCommand('onegayi.vsidian._test.addonSettingsArea', (args?: { addonId?: string }) => {
        if (args?.addonId !== undefined) {
          return { open: runtime.openSettingsArea(args.addonId), settingsAreaOpen: runtime.settingsAreaAddonId() ?? null }
        }
        return { settingsAreaOpen: runtime.settingsAreaAddonId() ?? null }
      }),
      vscode.commands.registerCommand('onegayi.vsidian._test.addonSettingsCloseArea', () => {
        runtime.closeSettingsArea()
        return true
      }),
      vscode.commands.registerCommand('onegayi.vsidian._test.addonSetEnabledScope', (args: { addonId: string; scope: 'user' | 'workspace'; enabled: boolean }) => {
        const result = runtime.setEnabledScope(args.addonId, args.scope, args.enabled)
        return { result, state: getState() }
      }),
      vscode.commands.registerCommand('onegayi.vsidian._test.addonClearEnabledOverride', (args: { addonId: string }) => {
        const result = runtime.clearEnabledOverride(args.addonId)
        return { result, state: getState() }
      }),
      // #354 T05 故障手动重试（设置页 UI 的宿主侧等价入口——释放旧代次
      // 并重新唤醒；activation-failed 短路被手动意图越过）
      vscode.commands.registerCommand('onegayi.vsidian._test.addonRetry', (args: { addonId: string }) =>
        coordinator.retry(args.addonId)),
      // ---- T07（#356）行为状态（排序/开关）的宿主侧读写面：管理 UI 的
      // 等价入口（完整 UI 属 T08）；写入成功即推送全部活跃编辑器面板 ----
      vscode.commands.registerCommand('onegayi.vsidian._test.addonBehaviorState', () => {
        const snapshot = behaviorStateService.snapshot()
        return { order: [...snapshot.order], disabled: [...snapshot.disabled] }
      }),
      vscode.commands.registerCommand('onegayi.vsidian._test.addonBehaviorSetDisabled', (args: { keys: string[]; disabled: boolean }) =>
        behaviorStateService.setDisabled(args.keys, args.disabled)),
      vscode.commands.registerCommand('onegayi.vsidian._test.addonBehaviorSetOrder', (args: { order: string[] }) =>
        behaviorStateService.setOrder(args.order)),
    )
  }

  context.subscriptions.push(channel)

  return {
    exports: exportsApi,
    page,
    editorBridge,
    start: () => coordinator.start(),
    onStateChanged: (listener) => coordinator.onStateChanged(listener),
    onRuntimeChanged: (listener) => {
      const off = runtime.onChanged(listener)
      // 订阅期与 wiring 同生命周期（extension.ts 均不退订——由 dispose 收口）
      return off
    },
    // #353 T04：设置变化（成功保存后）→ 设置页 addons.settingsState 常规推送
    onSettingsChanged: (listener) => settingsService.onChanged(() => listener()),
    dispose: () => {
      offRuntimeChanged()
      runtime.dispose()
      coordinator.dispose()
    },
  }
}
