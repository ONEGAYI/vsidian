// webview 启动入口：装配 acquireVsCodeApi、同步控制器与基础编辑键。
// CM6 扩展装配在 syncController 内（不含 history/basicSetup——撤销栈归宿主，
// 探索笔记 03 §3；撤销/重做转发 keymap 亦在 syncController 内装配，
// 优先于 defaultKeymap 的本地 no-op undo/redo 绑定）。
// #93 i18n：首帧从 HTML 数据岛装配语言包（早于任何视图挂载，t() 首帧即
// 就绪）；locale.changed 原子换包，编辑器文案消费方随 #94 迁移接入重渲染。
// #351 T02：安装附加组件页面装载器（编辑器页）——共享 CM6 运行时注入本
// 页 bundle 的模块命名空间（esbuild 单 bundle 去重，与生产控制器同一实例），
// 扩展挂载槽为 liveInstance 的附加组件 Compartment 空槽；宿主装载指令经
// addonPage.directive 到达，出站经 addonPage.outbound 桥回宿主。
// #358 T09：渲染提供者桥与装载器同页装配——SDK renderers 面的候选经桥
// 上报宿主（addonRenderers.registered），宿主生效表广播（addonRenderers.
// table）到达即热切换已开文档；控制器订阅生效表变化执行正文重派发。
import { keymap } from '@codemirror/view'
import * as cmState from '@codemirror/state'
import * as cmView from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { WebviewSyncController } from './syncController'
import { AddonViewRegistry } from './addonViews'
import { AddonBehaviorRuntime } from './addonBehaviors'
import { AddonCommandsRuntime } from './addonCommands'
import { AddonUiRuntime } from './addonUi'
import { installAddonPageLoader } from './addonPageLoader'
import { setAddonRenderersBridge } from './addonRenderers'
import { bindAddonFaultReporter } from './graphicRenderers'
import { bootLocaleFromDocument, handleLocaleChangedMessage } from './localeBoot'
import { t } from '../shared/i18n'
import { installTooltipCard } from './tooltipCard'
import { isTrustedHostMessageSource } from './untrustedFrame'
import { isHostToWebview, isWebviewToHost } from '../shared/protocol'
import './main.css'
// #59 KaTeX 基础样式：esbuild 合并进 main.css，字体（仅 woff2）经 CSS url()
// 产物化到 out/webview/assets/（CSP font-src 已放行 cspSource 域）
import 'katex/dist/katex.min.css'

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void
  getState<T>(): T | undefined
  setState(state: unknown): void
}

// 语言包首帧装配（数据岛由宿主 HTML 生成点注入；缺失时取词回退键名）
bootLocaleFromDocument()

const vscode = acquireVsCodeApi()

// #300 统一自绘悬停提示：document 级委托监听 [data-tooltip]，独立于
// 控制器生命周期（webview 存续期常驻）
installTooltipCard()

const controller = new WebviewSyncController({
  postMessage: (message) => vscode.postMessage(message),
  getState: <T,>() => vscode.getState<T>(),
  setState: (state) => vscode.setState(state),
})
// 基础编辑键（光标移动、删除、换行等）；撤销/重做绑定被 syncController
// 内更高优先级的转发 keymap（Mod-Z / Mod-Shift-Z / Mod-Y → history.request）
// 截获，权威撤销栈归宿主文本管线
controller.mount(document.getElementById('app') ?? document.body, [
  keymap.of(defaultKeymap),
])

// #351 T02 附加组件页面装载器（编辑器页）：mount 完成后安装——扩展挂载槽
// 经 controller.reconfigureAddonExtensions 驱动 liveInstance 的 Compartment；
// 出站消息（loaded/unloaded/faulted/channel.request）经消息桥回宿主路由。
// T06（#355）：统一视图注册表（页面级一份）同时注入装载器（SDK views 面
// 的操作后端）与控制器（主正文句柄随 init 注册/注销）。
// T07（#356）：输入行为 runtime（页面级一份）——behaviors 面的操作后端
// （快照/提交走统一视图注册表；链驱动经 controller 注入主正文与嵌入实例），
// 宿主状态（顺序覆盖/逐项开关）经 addon.behaviors.state 到达。
// T08（#357）：注册表变化后全量对账上报宿主（行为冲突管理目录的数据源）
// T12（#361）：各 runtime 的可归因回调异常经 faultReporter 槽升级上报
// （构造先于装载器——闭包转发到装载器安装后绑定的目标，沿 bindHandleFactory
// 先例解装配环；上报只经宿主裁决，本页回收由 unload 指令对账）
let reportAddonRuntimeFault: (addonId: string, stage: string, detail: string) => boolean = () => false
const addonViews = new AddonViewRegistry()
const addonBehaviors = new AddonBehaviorRuntime({
  snapshotOf: (instanceId) => addonViews.snapshotOf(instanceId),
  applyEdit: (addonId, opId, instanceId, request) => addonViews.applyEdits({ addonId, opId, instanceId, request }),
  log: (stage, addonId, detail) => console.warn(`[vsidian-addon-behavior] ${stage} ${addonId}: ${detail}`),
  report: (payload) => vscode.postMessage({ kind: 'addon.behaviors.report', ...payload }),
  reportFault: (addonId, stage, detail) => reportAddonRuntimeFault(addonId, stage, detail),
})

// #359 T10 组件命令/菜单注册表（页面级一份）：SDK commands/menus 面的操作
// 后端；注册/撤销后全量对账上报宿主（宿主注册命令面板命令并推设置页目录）
const addonCommands = new AddonCommandsRuntime({
  report: (payload) => vscode.postMessage({ kind: 'addonCommands.report', ...payload }),
  reportFault: (addonId, stage, detail) => reportAddonRuntimeFault(addonId, stage, detail),
})

// T09（#358）：渲染提供者桥先于装载器装配（SDK renderers 面后端），候选
// 上报与控制器热切换订阅同一桥实例
const addonRenderers = setAddonRenderersBridge((message) => {
  if (isWebviewToHost(message)) {
    vscode.postMessage(message)
  }
})
// #360 T11 附加组件界面运行时（页面级一份）：SDK ui 面的操作后端——按钮/
// 面板挂载、目标路由（当前活动视图句柄经装载器同源构造——bindHandleFactory
// 在装载器安装后绑定，沿 bindOpIdAllocator 先例解装配环）与回收矩阵
const addonUi = new AddonUiRuntime({
  toolbarSlot: controller.addonToolbarSlot() ?? document.body,
  panelDock: controller.addonPanelDock() ?? document.body,
  currentMode: () => controller.viewModeNow(),
  activeInstanceId: () => controller.addonActiveInstanceId(),
  executeCommand: (commandId) => controller.runAddonCommand(commandId),
  bindingHints: (commandId) => controller.addonEffectiveBindings(commandId),
  panelCloseLabel: () => t('addonUi.panelClose'),
  log: (detail) => console.warn(`[vsidian-addon-ui] ${detail}`),
  reportFault: (addonId, stage, detail) => reportAddonRuntimeFault(addonId, stage, detail),
})
const addonLoader = installAddonPageLoader({
  page: 'editor',
  cm6: { state: cmState, view: cmView },
  attachExtensions: (extensions) => controller.reconfigureAddonExtensions(extensions),
  addonViews,
  addonBehaviors,
  addonCommands,
  addonRenderers,
  addonUi,
  send: (outbound) => vscode.postMessage({ kind: 'addonPage.outbound', outbound }),
})
// T12（#361）：故障上报槽接线（装载器在场后升级生效）——各 runtime 与
// 渲染提供者挂载异常统一经装载器上报宿主裁决
reportAddonRuntimeFault = (addonId, stage, detail) => addonLoader.reportRuntimeFault(addonId, stage, detail)
bindAddonFaultReporter(reportAddonRuntimeFault)
addonUi.bindHandleFactory((addonId, instanceId) => addonLoader.buildViewHandle(addonId, instanceId))
controller.attachAddonUi(addonUi)
controller.attachAddonViews(addonViews)
controller.attachAddonBehaviorDrive((input) => {
  void addonBehaviors.driveInput(input.instanceId, { userEvent: input.userEvent, inputText: input.inputText })
})
controller.attachAddonCommands(addonCommands)
// T09（#358）：控制器订阅生效表变化（已开文档热切换：动态语言集、容器
// 所有权扫描、live 效应派发、阅读整篇重渲染）
controller.attachAddonRenderers()
// 装载器观测挂进 view.state 探针（集成断言面：活跃代次/授权样式表/释放
// 历史与拒收计数；宿主经 view.state.request 拉取）
controller.attachAddonPageProbe(() => addonLoader.stats())
// 行为 runtime 观测挂进 view.state 探针（T07 集成断言面：注册清单/宿主
// 状态/链执行轨迹与计数；与装载器探针同面并列返回）
controller.attachAddonBehaviorProbe(() => addonBehaviors.stats())
// 就绪上报（webview 重载后亦发）：宿主按期望装载清单幂等推送指令
vscode.postMessage({ kind: 'addonPage.ready' })

window.addEventListener('message', (event) => {
  // #343（P3-11）消息桥隔离：允许清单——来源非真宿主桥的 message 一律
  // 丢弃。原网页沙箱 iframe 及其嵌套帧、移除竞态的旧窗口引用全部落选
  //（判定依据与边界见 untrustedFrame 模块头）
  if (!isTrustedHostMessageSource(event.source, event.origin)) {
    return
  }
  // #351 T02：附加组件装载指令（独立于控制器消息管线——装载器是页面级
  // 设施，代次与释放由装载器自持）
  if (isHostToWebview(event.data) && event.data.kind === 'addonPage.directive') {
    addonLoader.handleDirective(event.data.directive)
    return
  }
  // T07（#356）：输入行为状态下发（页面级 runtime 消费；null = 无用户
  // 覆盖——默认序全开启）
  if (isHostToWebview(event.data) && event.data.kind === 'addon.behaviors.state') {
    addonBehaviors.applyHostState(event.data.state)
    return
  }
  // T09（#358）：宿主渲染提供者生效表广播（等值跳过；变化即热切换）
  if (isHostToWebview(event.data) && event.data.kind === 'addonRenderers.table') {
    addonRenderers.applyTable(event.data.table)
    return
  }
  controller.handleHostMessage(event.data)
  // 语言切换：换包 + <html lang> 同步；常驻文本重渲染订阅方各自处理
  handleLocaleChangedMessage(event.data)
})
