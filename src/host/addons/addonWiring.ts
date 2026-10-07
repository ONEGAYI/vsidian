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
import {
  ADDON_API_VERSION,
  type AddonRegistrationResult,
  type AddonStatusEntry,
} from '../../shared/addonIdentity'
import { type AddonPageDirective, type AddonLoadManifest } from '../../shared/addonPage'
import { isWebviewToHost } from '../../shared/protocol'
import { AddonCoordinator, type AddonExtensionLike } from './addonCoordinator'
import { AddonRegistry, createDefaultRegistryPorts, type AddonDefinition } from './addonRegistry'
import { AddonRuntime, type AddonPreferenceStore } from './addonRuntime'
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
  getState(): { kind: 'addons.state' } & { apiVersion: string; draft: true; addons: readonly AddonStatusEntry[]; openAddonSettingsPage: string | null }
  /** 市场搜索（关键词仅搜索辅助：vsidian-addon） */
  openSearch(): void
  /** VSCode 扩展管理视图 */
  openExtensionsView(): void
  /** 某组件的 VSCode 扩展详情页 */
  openExtension(extensionId: string): void
  // ---- #351 T02 ----
  /** 设置页面板资源根（全部可打开组件的页面目录；面板 open 时并入） */
  settingsResourceRoots(): vscode.Uri[]
  /** 设置页面板已建立（装载器就绪后消息由此路由；重载再挂即再调） */
  attachSettingsPanel(webview: vscode.Webview): void
  /** 设置页面板销毁（隐藏即释放——装载意图终结） */
  settingsPanelDisposed(): void
  /** 设置页面板消息路由（addonPage.* 与 addons.setEnabled/openAddonPage/closeAddonPage） */
  handleSettingsMessage(webview: vscode.Webview, message: unknown): boolean
  /** 手动打开组件设置页（设置页面板不在场时由调用方先 open） */
  openAddonSettingsPage(addonId: string): 'ok' | 'not-registered' | 'faulted' | 'no-settings-page'
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
  /** 停用收尾（context.subscriptions 驱动） */
  dispose(): void
}

/** 扩展展示名：displayName 缺失或非字符串时回退 Extension.id */
function extensionLabel(packageJSON: unknown, id: string): string {
  const displayName = (packageJSON as { displayName?: unknown } | undefined)?.displayName
  return typeof displayName === 'string' && displayName.length > 0 ? displayName : id
}

/** 启用偏好持久层键（user = globalState / workspace = workspaceState；
 *  存储格式与 T04 的作用范围 UI 对齐预留——本票钉住持久行为） */
const PREFERENCE_KEY = 'vsidian.addons.enabled'

function createPreferenceStore(context: vscode.ExtensionContext): AddonPreferenceStore {
  const readScope = (scope: 'user' | 'workspace'): Record<string, boolean> | null => {
    const store = scope === 'user' ? context.globalState : context.workspaceState
    const value = store.get<Record<string, boolean>>(`${PREFERENCE_KEY}.${scope}`)
    return value && typeof value === 'object' ? value : null
  }
  return {
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

export function createAddonWiring(context: vscode.ExtensionContext): AddonWiring {
  const channel = vscode.window.createOutputChannel(t('host.addonsChannelName'))
  const log = (message: string): void => {
    channel.appendLine(`[${new Date().toISOString()}] ${message}`)
  }

  // 注册表 + 运行生命周期：findExtension 核对「当前扩展宿主注册表中的记录」
  //（查不到 = 当前宿主不可用——不等于未安装或装错侧）；installDirOf 以
  // 扩展安装目录为资源授权锚（extensionUri.fsPath）
  const preferenceStore = createPreferenceStore(context)
  const runtime = new AddonRuntime({
    apiVersion: ADDON_API_VERSION,
    preferences: preferenceStore,
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
  })

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
    return [...roots].map((dir) => vscode.Uri.file(dir))
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

  // ---- 编辑器面板桥（#351）----
  interface EditorPanelRecord {
    webview: vscode.Webview
    /** 本面板已推送的装载（addonId → generation；desired 对账用） */
    pushed: Map<string, number>
  }
  const editorPanels = new Map<string, EditorPanelRecord>()
  const panelListeners = new Set<() => void>()

  const pushEditorDirectives = (record: EditorPanelRecord): void => {
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
      const directive: AddonPageDirective = { type: 'addon.load', manifest: buildManifest(record.webview, plan) }
      recordEvent('editor', directiveEventOf(directive))
      postDirective(record.webview, directive)
      record.pushed.set(plan.addonId, plan.generation)
    }
  }

  const handleEditorPanelMessage = (record: EditorPanelRecord, message: unknown): boolean => {
    if (!isWebviewToHost(message)) {
      return false
    }
    if (message.kind === 'addonPage.ready') {
      // webview 重载 = 新装载器生命周期的开始：对账基线归零后全量重推
      //（同代次幂等重发；不归零会把重载误判为「已推送」而永远跳过）
      record.pushed.clear()
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
          const fresh: EditorPanelRecord = { webview, pushed: new Map() }
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
      const record = editorPanels.get(sessionId) ?? { webview, pushed: new Map() }
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
    const directive: AddonPageDirective = { type: 'addon.load', manifest: buildManifest(record.webview, desired) }
    recordEvent('settings', directiveEventOf(directive))
    postDirective(record.webview, directive)
    record.pushed = { addonId: desired.addonId, generation: desired.generation }
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
        settingsPanel = { webview, pushed: null }
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
        runtime.setUserEnabled(message.addonId, message.enabled)
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
      default:
        return false
    }
  }

  const page: AddonPageWiring = {
    getState,
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
    settingsResourceRoots: settingsCapableRoots,
    attachSettingsPanel: (webview) => {
      settingsPanel = { webview, pushed: null }
    },
    settingsPanelDisposed: () => {
      settingsPanel = undefined
      runtime.settingsPanelGone()
    },
    handleSettingsMessage,
    openAddonSettingsPage: (addonId) => runtime.openSettingsPage(addonId),
  }

  // ---- runtime 状态变化 → 面板刷新（编辑器：provider 订阅 onPanelsChanged
  //  刷新资源根并推送指令；设置页：此处直推 + addons.state 推送经
  //  extension.ts 的 onRuntimeChanged 接线） ----
  const offRuntimeChanged = runtime.onChanged(() => {
    for (const listener of [...panelListeners]) {
      listener()
    }
    if (settingsPanel) {
      pushSettingsDirectives(settingsPanel)
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
    dispose: () => {
      offRuntimeChanged()
      runtime.dispose()
      coordinator.dispose()
    },
  }
}
