// #351 T02 附加组件页面装载器（生产实现，编辑器 main 与设置页 settings
// 两入口各自安装）。形状由 V02 验证票（#349）收敛放行，机制边界：
// - 独立 IIFE 经全局登记表暴露工厂（构建辅助工具的 defineAddonPage 写入，
//   全局名与 sdk/ 构建桥同源约定），装载器核对入口身份后调用工厂注入
//   页面 SDK；
// - 共享 CM6 运行时经 experimental.cm6 注入**本页 bundle 的模块命名空间**
//   （装载器由页面产物自身构造，不能是独立 bundle，否则 CM6 会是第二份
//   运行时——安装点在 main.ts/settingsMain.ts，模块命名空间来自同 bundle
//   的 import *）；
// - 代次硬边界：旧代次卸载/故障指令不生效，旧工厂注册不接入新代次，
//   迟到通道回执不回挂；
// - 释放回收注册（扩展/挂载根）、监听（组件经 onDispose 自清）、消息
//  （滞留请求以 released 终结，迟到回执丢弃）；重复释放无害。
// - T12（#361）运行期故障上报（reportRuntimeFault）：组件回调异常经各
//   runtime 上报宿主裁决，本页回收由宿主 unload 指令对账（上报与回收
//   分离——不在组件回调栈内同步触发热切换）。
// 实现陷阱（V02 实证，勿改语义）：宿主侧事件乱序消费（loaded 与工厂内
// 通道请求的到达顺序不保证）；隐藏即销毁的 webview 不可依赖隐藏面板存活。
import type { Extension } from '@codemirror/state'
import type {
  AddonChannelOutcome,
  AddonCm6LanguageRuntime,
  AddonCm6Runtime,
  AddonLoadFailureReason,
  AddonLoadManifest,
  AddonLoadOutcome,
  AddonLoaderStats,
  AddonPageDirective,
  AddonPageKind,
  AddonPageOutbound,
  AddonPageRegistration,
  AddonUnloadOutcome,
  VsidianAddonPageSdk,
} from '../shared/addonPage'
import type { AddonViewHandle, AddonViewsFacet, AddonViewIdentityFacet } from '../shared/addonEditApi'
import type { AddonHeadingFoldFacet } from '../shared/addonFoldApi'
import type { AddonBehaviorsFacet } from '../shared/addonBehaviors'
import type { AddonRendererRegistration } from '../shared/addonRenderers'
import type { AddonRenderersBridgeHandle } from './addonRenderers'
import type { AddonViewsRuntime } from './addonViews'
import { addonInstanceIdField } from './addonViewIdentity'
import type { AddonBehaviorRuntime } from './addonBehaviors'
import type { AddonCommandsRuntime } from './addonCommands'
import type { AddonUiRuntime } from './addonUi'

/** 构建桥 defineAddonPage 写入的全局登记表（数组形态：同一脚本重复执行
 *  会追加新条目，装载器按「本次装载期间注册 + 未消费」规则取用） */
export const ADDON_PAGE_REGISTRY_GLOBAL = '__vsidianAddonPages'

/** #406 从 @codemirror/language 模块命名空间裁出共享运行时的 language
 *  子集——「最小暴露集合」的单一事实源：构造点（生产 main 与各测试
 *  夹具/探针）一律经本函数裁剪，将来调整集合只改此处 */
export function addonCm6LanguageSubset(ns: typeof import('@codemirror/language')): AddonCm6LanguageRuntime {
  return {
    syntaxTree: ns.syntaxTree,
    ensureSyntaxTree: ns.ensureSyntaxTree,
    syntaxTreeAvailable: ns.syntaxTreeAvailable,
  }
}
/** 装载器调用工厂前的 SDK 注入槽（构建桥 currentSdk() 的读取点） */
export const ADDON_SDK_SLOT_GLOBAL = '__vsidianAddonSdk'

type RegistrationBucket = AddonPageRegistration[]

function registryBucket(globalScope: typeof globalThis): RegistrationBucket {
  const holder = globalScope as typeof globalThis & { [key: string]: unknown }
  const existing = holder[ADDON_PAGE_REGISTRY_GLOBAL]
  if (!Array.isArray(existing)) {
    holder[ADDON_PAGE_REGISTRY_GLOBAL] = [] as RegistrationBucket
  }
  return holder[ADDON_PAGE_REGISTRY_GLOBAL] as RegistrationBucket
}

interface PendingChannelRequest {
  addonId: string
  generation: number
  settle: (outcome: AddonChannelOutcome) => void
  settled: boolean
  cancelTimer: () => void
}

interface ActiveLoad {
  addonId: string
  generation: number
  startedAt: number
  disposeCallbacks: Array<() => void>
  mountRoots: HTMLElement[]
  extensionsAttached: boolean
  /** 本装载经 registerExtension 收集的 CM6 扩展（聚合下发——见
   *  aggregateExtensionParts：消费端 Compartment reconfigure 是整体替换，
   *  per-load 直发会让多组件互相覆盖、单组件释放清空全部） */
  extensionParts: Extension[]
  cssLinks: HTMLLinkElement[]
  /** T12 运行期故障已上报（同代次去重——回收指令到达前的重复异常丢弃） */
  faultReported: boolean
}

/** 装载器环境：脚本/样式装载与时器可注入（单元测试模拟授权与拒绝） */
export interface AddonPageLoaderEnv {
  page: AddonPageKind
  /** 编辑器页共享运行时（与生产控制器同一实例；设置页省略） */
  cm6?: AddonCm6Runtime
  /** T06（#355）统一视图注册表的操作面（编辑器页由 main.ts 构造注入；
   *  省略时 SDK 不提供 views 面） */
  addonViews?: AddonViewsRuntime
  /** T07（#356）输入行为 runtime（编辑器页由 main.ts 构造注入；省略时
   *  SDK 不提供 behaviors 面） */
  addonBehaviors?: AddonBehaviorRuntime
  /** T10（#359）命令与菜单注册表（编辑器页由 main.ts 构造注入；省略时
   *  SDK 不提供 commands/menus 面，releaseLoad 时亦不做回收） */
  addonCommands?: AddonCommandsRuntime
  /** T09（#358）渲染提供者桥（编辑器页由 main.ts 构造注入；省略时 SDK
   *  不提供 renderers 面——注册拒绝为 no-op 句柄） */
  addonRenderers?: Pick<AddonRenderersBridgeHandle, 'register' | 'disposeRenderer' | 'releaseGeneration'>
  /** T11（#360）附加组件界面运行时（编辑器页由 main.ts 构造注入；省略时
   *  SDK 不提供 ui 面，releaseLoad 时亦不做回收） */
  addonUi?: AddonUiRuntime
  /** 编辑器页：扩展挂载槽（null = 摘除全部；生产实现为 liveInstance 的
   *  附加组件 Compartment 槽 reconfigure，见 liveInstance.reconfigureAddonExtensions） */
  attachExtensions?: (extension: Extension[] | null) => void
  /** 设置页挂载容器（缺省 document.body） */
  mountContainer?: HTMLElement
  send: (message: AddonPageOutbound) => void
  /** 脚本装载注入点：缺省 DOM <script>（未授权地址被资源服务拒绝时 onerror） */
  loadScript?: (uri: string) => Promise<{ ok: true } | { ok: false; error: string }>
  /** 样式装载注入点：缺省 DOM <link>（onload=authorized / onerror=denied） */
  loadCss?: (uri: string) => Promise<'authorized' | 'denied'>
  now?: () => number
  scheduleTimeout?: (callback: () => void, ms: number) => { cancel: () => void }
}

export interface AddonPageLoaderHandle {
  /** 处理宿主指令（消息桥把 addonPage.directive 的内层转发到这里） */
  handleDirective(directive: AddonPageDirective): void
  /** 直接装载（单元测试入口；结局同时经 send 上报） */
  load(manifest: AddonLoadManifest): Promise<AddonLoadOutcome>
  /** 直接卸载 */
  unload(addonId: string, generation: number): Promise<AddonUnloadOutcome>
  /**
   * T12（#361）运行期故障上报：组件回调（输入/渲染/操作等）抛出可归因
   * 异常时由各 runtime 调用。**只上报、不本页回收**——宿主 faultRecord
   * 全组件暂停后经既有 unload 指令对账完成本页释放（异步时序：组件回调
   * 栈可能处于 CM6 布局期，同步回收会触发渲染热切换重入）。同代次去重
   * （回收指令到达前的重复异常只报首次）。返回 false = 无活跃装载可
   * 归因（未装载/已释放），调用方按普通留痕处理。
   */
  reportRuntimeFault(addonId: string, stage: string, detail: string): boolean
  /** T11（#360）按组件身份构造视图句柄（界面目标路由——与 views.get
   *  同源：代次存活注入 + opId 分配；装载不在场或实例未注册 null） */
  buildViewHandle(addonId: string, instanceId: string): AddonViewHandle | null
  /** 观测快照（宿主断言与测试的序列化面） */
  stats(): AddonLoaderStats
  /** 全量释放（页面卸载/测试收尾；每条按 released 走完整回收） */
  disposeAll(): Promise<void>
}

const DEFAULT_CHANNEL_TIMEOUT_MS = 30_000

interface ScriptLoadResult {
  ok: boolean
  error?: string
}

/** DOM <script> 装载：执行完毕后移除节点（代码已在登记表留厂，节点无需存续） */
function domLoadScript(uri: string): Promise<ScriptLoadResult> {
  return new Promise((resolve) => {
    const script = document.createElement('script')
    let settled = false
    const finish = (result: ScriptLoadResult) => {
      if (settled) return
      settled = true
      script.remove()
      resolve(result)
    }
    script.addEventListener('load', () => finish({ ok: true }))
    script.addEventListener('error', () => finish({ ok: false, error: `script onerror: ${uri}` }))
    script.src = uri
    document.head.appendChild(script)
  })
}

/**
 * DOM <link> 装载（装载器持有元素，释放时撤下）：
 * onload = authorized（表已装载），onerror = denied（资源服务拒绝/404）。
 * 本面只关心「表是否装上」，不读规则内容（跨源表本就不可读）。
 */
function domLoadCssLink(uri: string): Promise<{ status: 'authorized' | 'denied'; element: HTMLLinkElement }> {
  return new Promise((resolve) => {
    const link = document.createElement('link')
    let settled = false
    const finish = (status: 'authorized' | 'denied') => {
      if (settled) return
      settled = true
      if (status === 'denied') link.remove()
      resolve({ status, element: link })
    }
    link.addEventListener('load', () => finish('authorized'))
    link.addEventListener('error', () => finish('denied'))
    link.rel = 'stylesheet'
    link.href = uri
    document.head.appendChild(link)
  })
}

/**
 * 安装页面装载器（每页面一次；编辑器 main 与设置页 settings 各自调用）。
 * 返回句柄供消息桥转发指令与读取观测；同一页面重复安装返回各自独立
 * 句柄（不依赖单例语义）。
 */
export function installAddonPageLoader(env: AddonPageLoaderEnv): AddonPageLoaderHandle {
  const page = env.page
  const now = env.now ?? (() => Date.now())
  const scheduleTimeout =
    env.scheduleTimeout ??
    ((callback: () => void, ms: number) => {
      const timer = setTimeout(callback, ms)
      return { cancel: () => clearTimeout(timer) }
    })
  const loadScript = env.loadScript ?? domLoadScript
  const bucket = registryBucket(globalThis)
  /** 已消费（或已丢弃）的登记条目——同一工厂不得接入两个代次 */
  const consumedRegistrations = new Set<AddonPageRegistration>()
  const active = new Map<string, ActiveLoad>()
  /** 页面级扩展聚合：全部活跃装载的 extensionParts 按装载序拼接。
   *  消费端（liveInstance.reconfigureAddonExtensions）是 Compartment 的
   *  整体替换语义——任何注册/释放都重发全量聚合，多组件互不覆盖、单个
   *  释放只摘自身段（active.delete 先行，聚合自然不含本装载） */
  const aggregateExtensionParts = (): Extension[] => {
    const merged: Extension[] = []
    for (const load of active.values()) {
      merged.push(...load.extensionParts)
    }
    return merged
  }
  /** 终结留痕（释放/故障/装载失败均记）：环形上限防反复启停/装载失败
   *  循环下的无界增长（stats() 全量序列化——对齐 addonPageEvents 200） */
  const pushHistory = (entry: AddonLoaderStats['history'][number]): void => {
    history.push(entry)
    while (history.length > 200) {
      history.shift()
    }
  }
  const pendingRequests = new Map<string, PendingChannelRequest>()
  const history: AddonLoaderStats['history'] = []
  const counters = {
    staleUnloadRejected: 0,
    lateChannelRepliesDropped: 0,
    lateRegistrationsDropped: 0,
    unsolicitedRegistrationsDropped: 0,
    releasedChannelRequests: 0,
    channelTimeouts: 0,
  }
  let nextRequestSeq = 0

  /** 按组件串行化的装载/卸载链（#395 P3）：load 是异步流（样式/脚本 await
   *  期间未落 active），同 addonId 的后到指令并发执行会双双越过 already-
   *  loaded 检查、后落者覆盖 active 条目——前代次的样式 link/扩展/回调成
   *  孤儿，宿主与页面失同步。链保证同组件指令按到达序逐个执行：后到 load
   *  在前序落定后按既有规则判定（在场 → already-loaded），unload 排队后
   *  能释放在途 load 刚落地的代次（宿主指令序语义保持）。跨组件互不阻塞。 */
  const loadChains = new Map<string, Promise<unknown>>()
  const enqueueForAddon = <T>(addonId: string, operation: () => Promise<T>): Promise<T> => {
    const previous = loadChains.get(addonId) ?? Promise.resolve()
    const next = previous.then(operation, operation)
    loadChains.set(addonId, next.catch(() => {}))
    return next
  }

  // T06（#355）编辑提交的操作身份计数器：opId = 装载代次 + 序号（组件
  // 不可自报——来源身份由 SDK 层注入，伪来源请求结构上不可表达）。
  // 计数器为页面级（同一 webview 内多次装载共享递增，同页唯一）；跨面板
  // （同组件多 webview 同时提交）同代次序号可能重名——协调器条目流的组
  // 语义按连续段与声明归类、不按名匹配，重名无行为危害（仅诊断展示层
  // 混淆），已知边界
  let opSeq = 0

  /**
   * 取「本次装载期间新注册且未消费」的首个条目；本次装载开始前的遗留
   * 未消费条目（旧工厂）就地丢弃并计数——旧工厂注册不接入新代次。
   * 返回 null = 本次装载期间没有任何登记（no-factory-registered）。
   */
  const takeFreshRegistration = (loadStartedAt: number): AddonPageRegistration | null => {
    let matched: AddonPageRegistration | null = null
    for (const entry of bucket) {
      if (consumedRegistrations.has(entry)) continue
      if (entry.registeredAt < loadStartedAt) {
        consumedRegistrations.add(entry)
        counters.lateRegistrationsDropped++
        continue
      }
      if (matched === null) {
        matched = entry
      } else {
        // 同批多余登记：丢弃（一次装载只接入一个工厂）
        counters.unsolicitedRegistrationsDropped++
      }
      consumedRegistrations.add(entry)
    }
    return matched
  }

  /** 按组件身份构造视图句柄（views.get 与 T11 界面目标路由同源）：代次
   *  存活注入 isReleased、opId 由本装载器分配（来源身份组件不可自报）。
   *  组件装载不在场或实例未注册时 null */
  const buildViewHandleFor = (addonId: string, generation: number, instanceId: string): AddonViewHandle | null => {
    if (!env.addonViews) {
      return null
    }
    const info = env.addonViews.infoOf(instanceId)
    if (!info) {
      return null
    }
    // 代次比对而非在场比对：同组件 gen1→gen2 交替后，gen1 发放的旧句柄
    // 不得复活（在场条目代次不等 = 旧代次已终结，提交拒绝）
    const isReleased = () => {
      const entry = active.get(addonId)
      return entry === undefined || entry.generation !== generation
    }
    return {
      info,
      editor: {
        getSnapshot: () => (isReleased()
          ? { ok: false, reason: 'view-disposed' }
          : env.addonViews!.snapshotOf(instanceId)),
        applyEdits: (request) => {
          if (isReleased()) {
            // 组件已释放：其编辑请求不再有有效来源（僵尸写入拒绝，
            // 与视图释放共用 view-disposed 拒绝类型——可辨认、不歧义）
            return Promise.resolve({ ok: false, reason: 'view-disposed' as const })
          }
          return env.addonViews!.applyEdits({
            addonId,
            opId: `g${generation}-op${++opSeq}`,
            instanceId,
            request,
          })
        },
        setSelection: (ranges) => !isReleased() && env.addonViews!.setSelectionOf(instanceId, ranges),
        reveal: (offset) => !isReleased() && env.addonViews!.revealOf(instanceId, offset),
      },
    }
  }

  /** SDK 守卫：按记录身份判活（#395 P3 追加收紧，registerExtension 同款
   *  契约扩展到全部 SDK 面）——active.has(addonId) 在同组件新代次在场时
   *  会让已释放代次句柄的迟到调用误放行（句柄穿越：旧代次注册进入新代次
   *  下游注册表、或经桥的整体替换语义顶掉新代次候选、或在已脱离 active
   *  的旧记录上滞留回调）。比对 active 条目是否为本装载记录本身，不符即
   *  拒绝；releaseLoad 的回收路径按 loadRecord 自身执行，不受此守卫约束。 */
  const isLoadActive = (loadRecord: ActiveLoad): boolean => active.get(loadRecord.addonId) === loadRecord

  const buildSdk = (loadRecord: ActiveLoad, manifest: AddonLoadManifest): VsidianAddonPageSdk => {
    const viewsFacet: AddonViewsFacet | undefined = env.addonViews
      ? {
          list: () => env.addonViews!.list(),
          get: (instanceId: string) =>
            buildViewHandleFor(loadRecord.addonId, loadRecord.generation, instanceId),
          onCreated: (callback) => env.addonViews!.onCreated(callback),
          onDisposed: (callback) => env.addonViews!.onDisposed(callback),
        }
      : undefined
    // #410 标题折叠实验入口（仅编辑器页 + 视图注册表在场提供；对齐 cm6
    // 的「入口键恒在、内容按页给」形态）。方法过 isLoadActive 守卫：已
    // 终结代次的迟到折叠请求/查询拒绝 view-disposed（僵尸调用不落视图）。
    const headingFoldFacet: AddonHeadingFoldFacet | undefined =
      page === 'editor' && env.addonViews
        ? {
            folds: (instanceId) => (isLoadActive(loadRecord)
              ? env.addonViews!.headingFoldsOf(instanceId)
              : { ok: false, reason: 'view-disposed' }),
            foldable: (instanceId) => (isLoadActive(loadRecord)
              ? env.addonViews!.foldableHeadingSpansOf(instanceId)
              : { ok: false, reason: 'view-disposed' }),
            apply: (instanceId, operation, options) => (isLoadActive(loadRecord)
              ? env.addonViews!.applyHeadingFoldOf(instanceId, operation, options)
              : { ok: false, reason: 'view-disposed' }),
            foldAt: (instanceId, keys) => (isLoadActive(loadRecord)
              ? env.addonViews!.foldAtOf(instanceId, keys)
              : { ok: false, reason: 'view-disposed' }),
            unfoldAt: (instanceId, keys) => (isLoadActive(loadRecord)
              ? env.addonViews!.unfoldAtOf(instanceId, keys)
              : { ok: false, reason: 'view-disposed' }),
          }
        : undefined
    // #426 视图身份反查面（仅编辑器页提供；与 headingFold 同款「入口键
    // 恒在、内容按页给」形态）。闭包实现无 this 依赖——解构裸传安全
    // （#426 第 4 条实现形态契约，单测钉住）
    const viewIdentityFacet: AddonViewIdentityFacet | undefined =
      page === 'editor'
        ? {
            instanceIdOf: (view) => view.state.field(addonInstanceIdField, false) ?? null,
          }
        : undefined
    const behaviorsFacet: AddonBehaviorsFacet | undefined = env.addonBehaviors
      ? {
          register: (registration) => {
            if (page !== 'editor') {
              return { ok: false, reason: 'not-editor-page' }
            }
            if (!isLoadActive(loadRecord)) {
              return { ok: false, reason: 'released' }
            }
            return env.addonBehaviors!.register(loadRecord.addonId, loadRecord.generation, registration)
          },
          onChanged: (callback) => env.addonBehaviors!.onChanged(callback),
        }
      : undefined
    const sdk: VsidianAddonPageSdk = {
      addon: { id: loadRecord.addonId, generation: loadRecord.generation, page },
      experimental: { cm6: env.cm6, headingFold: headingFoldFacet, viewIdentity: viewIdentityFacet },
      ...(viewsFacet ? { views: viewsFacet } : {}),
      ...(behaviorsFacet ? { behaviors: behaviorsFacet } : {}),
      ...(env.addonCommands && page === 'editor' ? {
        commands: {
          register: (def, handler) => {
            if (!isLoadActive(loadRecord) || page !== 'editor') {
              return { ok: false, reason: 'released', dispose: () => {} }
            }
            return env.addonCommands!.registerCommand(loadRecord.addonId, loadRecord.generation, def, handler)
          },
        },
        menus: {
          registerItem: (def) => {
            if (!isLoadActive(loadRecord) || page !== 'editor') {
              return { ok: false, reason: 'released', dispose: () => {} }
            }
            return env.addonCommands!.registerMenuItem(loadRecord.addonId, def, (commandId) => {
              // 菜单执行回调只在装载在场时有效（释放后的菜单项随 cleanup
              // 撤下——不会迟到；守卫是防御性复核，记录身份口径同上）
              if (!isLoadActive(loadRecord)) return
              env.addonCommands!.execute(commandId)
            })
          },
        },
      } : {}),
      // T09（#358）渲染提供者面（仅编辑器页且桥在场；其余页面 undefined）
      ...(page === 'editor' && env.addonRenderers
        ? {
            renderers: {
              register: (spec: AddonRendererRegistration) => {
                const bridge = env.addonRenderers!
                if (!isLoadActive(loadRecord)) {
                  // 已终结代次的迟到注册：no-op 句柄（不接入新代次——
                  // 记录身份口径，防止旧句柄经桥整体替换顶掉新代次候选）
                  return { dispose: () => {} }
                }
                const accepted = bridge.register(loadRecord.addonId, loadRecord.generation, spec)
                if (!accepted) {
                  return { dispose: () => {} }
                }
                const rendererId = spec.rendererId
                return {
                  dispose: () => {
                    if (!isLoadActive(loadRecord)) {
                      return
                    }
                    bridge.disposeRenderer(loadRecord.addonId, loadRecord.generation, rendererId)
                  },
                }
              },
            },
          }
        : {}),
      // T11（#360）界面面：按钮/面板注册转发 runtime；目标句柄经
      // buildViewHandleFor 与 views.get 同源构造（代次存活 + opId 注入）
      ...(env.addonUi && page === 'editor' ? {
        ui: {
          registerButton: (def, onClick) => {
            if (!isLoadActive(loadRecord) || page !== 'editor') {
              return { ok: false, reason: 'released', dispose: () => {} }
            }
            return env.addonUi!.registerButton(loadRecord.addonId, loadRecord.generation, def, onClick)
          },
          registerPanel: (def) => {
            if (!isLoadActive(loadRecord) || page !== 'editor') {
              return {
                ok: false, reason: 'released',
                dispose: () => {}, open: () => false, close: () => false, isOpen: () => false,
              }
            }
            return env.addonUi!.registerPanel(loadRecord.addonId, loadRecord.generation, def)
          },
        },
      } : {}),
      registerExtension: (extension) => {
        // 守卫按记录身份（#395 P3，isLoadActive 同款内联）：active.has
        // (addonId) 在同组件新代次在场时会让已释放代次的迟到调用误放行——
        // 扩展 push 进旧记录却永不进聚合（聚合只遍历 active），返回 true
        // 但扩展不生效。比对 active 条目是否为本装载记录本身，不符即拒绝。
        if (!isLoadActive(loadRecord) || page !== 'editor' || !env.attachExtensions) {
          return false
        }
        loadRecord.extensionParts.push(extension)
        env.attachExtensions(aggregateExtensionParts())
        loadRecord.extensionsAttached = true
        return true
      },
      mountRoot: () => {
        if (!isLoadActive(loadRecord) || page !== 'settings') {
          return null
        }
        const root = document.createElement('div')
        root.dataset.addonId = loadRecord.addonId
        root.dataset.addonGeneration = String(loadRecord.generation)
        ;(env.mountContainer ?? document.body).appendChild(root)
        loadRecord.mountRoots.push(root)
        return root
      },
      resourceUri: (relativePath) => {
        if (!manifest.resourceBase) return null
        // #395 P3：字面形态拦截是防呆层而非安全边界——只拦字面 `..`，
        // 编码变形（%2e%2e）与同 realm 直连 webview URI 不在本层防线内；
        // 有效边界是本 webview 的 localResourceRoots 包含性与宿主侧
        // realpath 符号链接守卫（ADR-0012：不构成安全沙箱）
        if (
          typeof relativePath !== 'string' || relativePath === '' || relativePath.startsWith('/') ||
          /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(relativePath) || relativePath.split('/').includes('..')
        ) {
          return null
        }
        const base = manifest.resourceBase.endsWith('/') ? manifest.resourceBase : `${manifest.resourceBase}/`
        return base + relativePath
      },
      channel: {
        request: (topic, payload, opts) => {
          if (!isLoadActive(loadRecord)) {
            counters.releasedChannelRequests++
            return Promise.resolve({ ok: false as const, reason: 'released' as const })
          }
          const requestId = `${loadRecord.addonId}#${loadRecord.generation}#${nextRequestSeq++}`
          return new Promise<AddonChannelOutcome>((resolve) => {
            const entry: PendingChannelRequest = {
              addonId: loadRecord.addonId,
              generation: loadRecord.generation,
              settled: false,
              cancelTimer: () => {},
              settle: (outcome) => {
                if (entry.settled) return
                entry.settled = true
                entry.cancelTimer()
                pendingRequests.delete(requestId)
                resolve(outcome)
              },
            }
            pendingRequests.set(requestId, entry)
            entry.cancelTimer = scheduleTimeout(() => {
              counters.channelTimeouts++
              entry.settle({ ok: false, reason: 'timeout' })
            }, opts?.timeoutMs ?? DEFAULT_CHANNEL_TIMEOUT_MS).cancel
            env.send({
              type: 'addon.channel.request',
              addonId: loadRecord.addonId,
              generation: loadRecord.generation,
              page,
              requestId,
              topic,
              payload,
            })
          })
        },
      },
      onDispose: (callback) => {
        if (!isLoadActive(loadRecord)) {
          // 已终结代次的迟到登记：立即执行清理，不滞留（重复释放无害；
          // 记录身份口径——addonId 在场不等于本代次在场，滞留进已脱离
          // active 的旧记录会让回调永不执行）
          try {
            callback()
          } catch {
            // 该代次已终结，清理回调异常不再升级为新故障
          }
          return
        }
        loadRecord.disposeCallbacks.push(callback)
      },
    }
    return sdk
  }

  /**
   * 完整释放路径（卸载/故障共用）：回调 → 扩展摘除 → 挂载根与授权样式
   * 撤下 → 滞留请求以 released 终结 → 历史留痕。登记消费位保留（旧工厂
   * 不得经再次装载接入新代次——takeFreshRegistration 的时间界已排除）。
   */
  const releaseLoad = (loadRecord: ActiveLoad, ended: 'released' | 'faulted', reason?: string): { disposals: number; releasedRequests: number } => {
    active.delete(loadRecord.addonId)
    // T07（#356）行为注册整组注销（opId 分配器随卸载解绑——释放后该组件
    // 的行为不再有可注入来源，提交路径结构上不可用）
    env.addonBehaviors?.unregisterAddon(loadRecord.addonId)
    // T10（#359）命令与菜单整组件回收（本页闭环——不依赖宿主消息到达）：
    // 撤命令、菜单与运行期操作表，并向宿主上报空表
    if (env.addonCommands) {
      try {
        env.addonCommands.releaseAddon(loadRecord.addonId)
      } catch {
        // 回收异常不阻断其余释放路径
      }
    }
    // T09（#358）：本页该组件的渲染候选整体撤销（代次硬边界——候选不跨
    // 代次存活；桥上报空集，宿主据此重算生效表）
    try {
      env.addonRenderers?.releaseGeneration(loadRecord.addonId, loadRecord.generation)
    } catch {
      // 候选撤销异常不阻断其余回收
    }
    // T11（#360）界面贡献整组件回收（本页闭环）：撤按钮、关面板、清注册
    if (env.addonUi) {
      try {
        env.addonUi.releaseAddon(loadRecord.addonId)
      } catch {
        // 回收异常不阻断其余释放路径
      }
    }
    let disposals = 0
    for (const callback of loadRecord.disposeCallbacks.splice(0)) {
      try {
        callback()
        disposals++
      } catch {
        // 清理回调异常不阻断其余回收
      }
    }
    if (loadRecord.extensionsAttached) {
      try {
        // active.delete 已先行：重发剩余活跃装载的聚合（可能为空数组），
        // 不再发 null——多组件并存时单个释放不得清掉其余组件的扩展
        env.attachExtensions?.(aggregateExtensionParts())
      } catch {
        // 装配槽异常不阻断其余回收
      }
    }
    for (const root of loadRecord.mountRoots.splice(0)) {
      root.remove()
    }
    for (const link of loadRecord.cssLinks.splice(0)) {
      link.remove()
    }
    let releasedRequests = 0
    for (const entry of [...pendingRequests.values()]) {
      if (entry.addonId === loadRecord.addonId && entry.generation === loadRecord.generation) {
        releasedRequests++
        entry.settle({ ok: false, reason: 'released' })
      }
    }
    pushHistory({ addonId: loadRecord.addonId, generation: loadRecord.generation, ended, reason, disposals })
    return { disposals, releasedRequests }
  }

  /** 装载实现（串行链内执行；直接调用入口 load 经 enqueueForAddon 排队） */
  const loadImpl = async (manifest: AddonLoadManifest): Promise<AddonLoadOutcome> => {
    const fail = (reason: AddonLoadFailureReason, detail?: string): AddonLoadOutcome => {
      pushHistory({ addonId: manifest.addonId, generation: manifest.generation, ended: 'load-failed', reason, detail })
      const outcome: AddonLoadOutcome = { ok: false, reason, detail }
      env.send({ type: 'addon.loaded', addonId: manifest.addonId, generation: manifest.generation, page, outcome })
      return outcome
    }

    const resident = active.get(manifest.addonId)
    if (resident && resident.generation === manifest.generation) {
      // 对齐设计 §2.2：同一接入代次再次注册返回 AlreadyRegistered
      const outcome: AddonLoadOutcome = { ok: false, reason: 'already-loaded' }
      env.send({ type: 'addon.loaded', addonId: manifest.addonId, generation: manifest.generation, page, outcome })
      return outcome
    }
    if (resident) {
      // 换代指令（#395 回归）：宿主恢复时 setEnabled→notify 先推旧代次
      // load、enable 完成递增代次后再推新代次 load（T09 集成实证的 g1→g2
      // 连推）——不同代次的 load 是换代信号，先释放在场旧代次再装载新
      // 代次（宿主最新代次为准；旧代次指令不得回收新代次的对称边界在
      // unload 侧 stale-generation，两向各自成立）
      releaseLoad(resident, 'released')
    }
    const loadStartedAt = now()

    // 样式先行逐条装载（互不牵连：授权条目保留生效、拒绝条目只记录状态）
    const cssOutcomes: Array<{ uri: string; status: 'authorized' | 'denied' }> = []
    const cssLinks: HTMLLinkElement[] = []
    const cssEntries = manifest.cssUris ?? []
    if (cssEntries.length > 0) {
      if (env.loadCss) {
        const statuses = await Promise.all(cssEntries.map((uri) => env.loadCss!(uri)))
        statuses.forEach((status, i) => cssOutcomes.push({ uri: cssEntries[i], status }))
      } else {
        const results = await Promise.all(cssEntries.map((uri) => domLoadCssLink(uri)))
        for (const result of results) {
          cssOutcomes.push({ uri: result.element.href, status: result.status })
          if (result.status === 'authorized') cssLinks.push(result.element)
        }
      }
    }

    const script = await loadScript(manifest.scriptUri)
    if (!script.ok) {
      // 未授权脚本 = 整次拒绝：授权样式一并撤下，不留半装配状态
      for (const link of cssLinks) link.remove()
      return fail('script-load-failed', script.error)
    }

    const registered = takeFreshRegistration(loadStartedAt)
    if (registered === null) {
      for (const link of cssLinks) link.remove()
      return fail('no-factory-registered')
    }
    if (registered.addonId !== manifest.addonId) {
      for (const link of cssLinks) link.remove()
      return fail('identity-mismatch', `registered=${registered.addonId}`)
    }

    const loadRecord: ActiveLoad = {
      addonId: manifest.addonId,
      generation: manifest.generation,
      startedAt: loadStartedAt,
      disposeCallbacks: [],
      mountRoots: [],
      extensionsAttached: false,
      extensionParts: [],
      cssLinks,
      faultReported: false,
    }
    active.set(manifest.addonId, loadRecord)
    // T07（#356）行为链提交的 opId 分配器随装载绑定（与 views.applyEdits
    // 同源计数器；factory 执行前就位——工厂注册行为后链即可提交）
    env.addonBehaviors?.bindOpIdAllocator(manifest.addonId, () => `g${manifest.generation}-op${++opSeq}`)
    const sdk = buildSdk(loadRecord, manifest)
    ;(globalThis as typeof globalThis & { [key: string]: unknown })[ADDON_SDK_SLOT_GLOBAL] = sdk
    try {
      // #430：async 工厂（官方样例形态：await 通道握手后再注册）的
      // rejection 与同步异常同路径归因 factory-error——装载结局按工厂
      // 同步段判定（不等待工厂 promise：驻留型工厂/长握手不得挂起装载
      // 指令流），rejection 到达时若本代次仍在场则整代次回滚并上报
      // faulted；代次已终结（unload/换代/故障先行）则只吞不回收——迟到
      // 异常不接入新代次（与迟到通道回执同一代次硬边界）。
      Promise.resolve(registered.factory(sdk)).catch((err) => {
        if (!isLoadActive(loadRecord)) {
          return
        }
        releaseLoad(loadRecord, 'faulted', `factory-error: ${String(err)}`)
        env.send({ type: 'addon.faulted', addonId: manifest.addonId, generation: manifest.generation, page, reason: `factory-error: ${String(err)}` })
      })
    } catch (err) {
      // 故障释放已留痕（releaseLoad 记 ended:'faulted'），此处只补装载结局
      releaseLoad(loadRecord, 'faulted', `factory-error: ${String(err)}`)
      env.send({ type: 'addon.faulted', addonId: manifest.addonId, generation: manifest.generation, page, reason: `factory-error: ${String(err)}` })
      const outcome: AddonLoadOutcome = { ok: false, reason: 'factory-error', detail: String(err) }
      env.send({ type: 'addon.loaded', addonId: manifest.addonId, generation: manifest.generation, page, outcome })
      return outcome
    }
    const outcome: AddonLoadOutcome = { ok: true, css: cssOutcomes }
    env.send({ type: 'addon.loaded', addonId: manifest.addonId, generation: manifest.generation, page, outcome })
    return outcome
  }

  const load = (manifest: AddonLoadManifest): Promise<AddonLoadOutcome> =>
    enqueueForAddon(manifest.addonId, () => loadImpl(manifest))

  /** 卸载实现（串行链内执行；排队后可释放在途 load 刚落地的代次） */
  const unloadImpl = (addonId: string, generation: number): Promise<AddonUnloadOutcome> => {
    const record = active.get(addonId)
    const finish = (outcome: AddonUnloadOutcome, disposals = 0, releasedRequests = 0): AddonUnloadOutcome => {
      env.send({ type: 'addon.unloaded', addonId, generation, outcome, disposals, releasedRequests })
      return outcome
    }
    if (!record) {
      return Promise.resolve(finish({ ok: false, reason: 'not-loaded' }))
    }
    if (record.generation !== generation) {
      // 旧代次指令不生效：当前装载保持原状（旧代次不得回收新代次）
      counters.staleUnloadRejected++
      return Promise.resolve(finish({ ok: false, reason: 'stale-generation' }))
    }
    const { disposals, releasedRequests } = releaseLoad(record, 'released')
    return Promise.resolve(finish({ ok: true }, disposals, releasedRequests))
  }

  const unload = (addonId: string, generation: number): Promise<AddonUnloadOutcome> =>
    enqueueForAddon(addonId, () => unloadImpl(addonId, generation))

  const handleDirective = (directive: AddonPageDirective): void => {
    switch (directive.type) {
      case 'addon.load':
        void load(directive.manifest)
        return
      case 'addon.unload':
        void unload(directive.addonId, directive.generation)
        return
      case 'addon.channel.reply': {
        const entry = pendingRequests.get(directive.requestId)
        if (!entry || entry.settled || entry.addonId !== directive.addonId || entry.generation !== directive.generation) {
          // 迟到回执（请求已终结/代次不符）不回挂——旧代次结果不得接入
          counters.lateChannelRepliesDropped++
          return
        }
        entry.settle(directive.outcome)
        return
      }
      case 'addon.fault': {
        const record = active.get(directive.addonId)
        if (!record || record.generation !== directive.generation) {
          return
        }
        const reason = directive.reason ?? 'host-directed-fault'
        releaseLoad(record, 'faulted', reason)
        env.send({ type: 'addon.faulted', addonId: directive.addonId, generation: directive.generation, page, reason })
        return
      }
    }
  }

  return {
    handleDirective,
    load,
    unload,
    /** T12（#361）运行期故障上报：只上报宿主裁决（stage 与 detail 拼进
     *  reason）；本页回收由宿主 faultRecord 后的 unload 指令驱动 */
    reportRuntimeFault: (addonId: string, stage: string, detail: string): boolean => {
      const record = active.get(addonId)
      if (!record || record.faultReported) {
        return false
      }
      record.faultReported = true
      env.send({
        type: 'addon.faulted',
        addonId,
        generation: record.generation,
        page,
        reason: `${stage}: ${detail}`,
      })
      return true
    },
    /** T11（#360）按组件身份构造视图句柄（界面目标路由用——与 views.get
     *  同源：代次存活注入 + opId 分配；装载不在场或实例未注册 null） */
    buildViewHandle: (addonId: string, instanceId: string) => {
      const record = active.get(addonId)
      if (!record) {
        return null
      }
      return buildViewHandleFor(addonId, record.generation, instanceId)
    },
    stats: () => ({
      page,
      cm6Shared: env.cm6 !== undefined,
      active: [...active.values()].map((record) => ({ addonId: record.addonId, generation: record.generation })),
      cssLinksActive: [...active.values()].reduce((sum, record) => sum + record.cssLinks.length, 0),
      history: [...history],
      counters: { ...counters },
    }),
    disposeAll: async () => {
      // #395 P3：在途装载一并对口——对每个有活跃装载或串行链的组件排队
      // 释放，链上在途 load 落定后才执行（页面销毁/测试收尾不留孤儿）
      const addonIds = new Set<string>([...active.keys(), ...loadChains.keys()])
      await Promise.all(
        [...addonIds].map((addonId) =>
          enqueueForAddon(addonId, async () => {
            const record = active.get(addonId)
            if (record) {
              releaseLoad(record, 'released')
            }
          }),
        ),
      )
    },
  }
}
