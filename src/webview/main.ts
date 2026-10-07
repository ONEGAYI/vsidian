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
import { keymap } from '@codemirror/view'
import * as cmState from '@codemirror/state'
import * as cmView from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { WebviewSyncController } from './syncController'
import { installAddonPageLoader } from './addonPageLoader'
import { bootLocaleFromDocument, handleLocaleChangedMessage } from './localeBoot'
import { installTooltipCard } from './tooltipCard'
import { isTrustedHostMessageSource } from './untrustedFrame'
import { isHostToWebview } from '../shared/protocol'
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
// 出站消息（loaded/unloaded/faulted/channel.request）经消息桥回宿主路由
const addonLoader = installAddonPageLoader({
  page: 'editor',
  cm6: { state: cmState, view: cmView },
  attachExtensions: (extensions) => controller.reconfigureAddonExtensions(extensions),
  send: (outbound) => vscode.postMessage({ kind: 'addonPage.outbound', outbound }),
})
// 装载器观测挂进 view.state 探针（集成断言面：活跃代次/授权样式表/释放
// 历史与拒收计数；宿主经 view.state.request 拉取）
controller.attachAddonPageProbe(() => addonLoader.stats())
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
  controller.handleHostMessage(event.data)
  // 语言切换：换包 + <html lang> 同步；常驻文本重渲染订阅方各自处理
  handleLocaleChangedMessage(event.data)
})
