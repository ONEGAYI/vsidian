// 设置页 webview 启动入口（#33）：装配 acquireVsCodeApi 与设置页视图。
// 页面装载后立即拉取快照（settings.get）——retainContextWhenHidden 不开，
// 面板隐藏即释放、重开即重载，回显每次都以宿主权威值为准。
// #93 i18n：首帧从数据岛装配语言包（早于视图挂载，框架文案首帧即就绪）；
// locale.changed 换包后视图经订阅重渲染常驻文本。
import { SettingsPageView } from './settingsPageView'
import { PRODUCTION_SETTING_DEFINITIONS } from '../shared/settings'
import { KeybindingSettingsSection } from './keybindingSettings'
import { CssSnippetSettingsSection } from './cssSnippetSettings'
import { StyleReferenceSection } from './styleReferenceSettings'
import { AppearanceSection } from './appearanceSettings'
import { IndexMaintenanceSection } from './indexMaintenanceSettings'
import { WordSegmentSection } from './wordSegmentSettings'
import { DefaultEditorSection } from './defaultEditorSettings'
import { AddonSection } from './addonSettingsSection'
import { installAddonPageLoader, type AddonPageLoaderHandle } from './addonPageLoader'
import { bootLocaleFromDocument, handleLocaleChangedMessage } from './localeBoot'
import { installTooltipCard } from './tooltipCard'
import { isTrustedHostMessageSource } from './untrustedFrame'
import { isHostToWebview } from '../shared/protocol'
import { setRuntimeOperations } from '../shared/keybindings'
import './settingsPage.css'

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void
}

// 语言包首帧装配（数据岛由宿主 HTML 生成点注入；缺失时取词回退键名）
bootLocaleFromDocument()

const vscode = acquireVsCodeApi()

// #300 统一自绘悬停提示：document 级委托监听 [data-tooltip]，设置页常驻控件
// 经 keybindingSettings 等写入 data-tooltip，原生 title 已退役）
installTooltipCard()

// #351 T02 附加组件页面装载器（设置页）：无 CM6 共享运行时（设置页 bundle
// 不含 CM6——experimental.cm6 为 undefined，组件设置页不得声明 cm6 入口）。
// 挂载容器为持久 host 元素（不随分页重渲染销毁——AddonSection 按当前打开
// 的组件设置页把它装进分页内容区；面板隐藏即销毁的既有语义不变）
const addonSettingsHost = document.createElement('div')
const addonLoader: AddonPageLoaderHandle = installAddonPageLoader({
  page: 'settings',
  mountContainer: addonSettingsHost,
  send: (outbound) => vscode.postMessage({ kind: 'addonPage.outbound', outbound }),
})

const keybindings = new KeybindingSettingsSection({ postMessage: (message) => vscode.postMessage(message) })
const snippets = new CssSnippetSettingsSection({ postMessage: (message) => vscode.postMessage(message) })
// #132 样式参考：离线渲染公开样式契约指南（数据模块随版本生成）；
// #145 契约 JSON 导出：工具区按钮经消息桥请求宿主另存
const styleRef = new StyleReferenceSection({ postMessage: (message) => vscode.postMessage(message) })
// #231 外观合并：CSS 片段与样式参考合并为一条「外观」（扁平三页签，组合
// 复用上述两个分页作为页签体；侧栏取 CSS 片段原槽位，位于快捷键与索引维护
// 之间）
const appearance = new AppearanceSection(snippets, styleRef)
// #198 索引维护：排除模式编辑与清理/重建操作（状态权威在宿主，index.state
// 推送回显）。#332 起分页改名「文件与链接」并承接图片/引用视图两组标准行
// （defsGroups），本分页自有内容降为页内「索引维护」二级组
const indexMaintenance = new IndexMaintenanceSection({ postMessage: (message) => vscode.postMessage(message) })
// #239 中文分词：引擎选择与 jieba 资源下载管理（设置值与资源状态权威
// 都在宿主，settings.* / wordSegment.state 推送回显）。#264 起分词分页
// 退役：以编辑器页尾二级组委托装配（侧栏无分词入口，focusSection
// 'wordSegment' 兼容路由到编辑器页分词组）
const wordSegment = new WordSegmentSection({ postMessage: (message) => vscode.postMessage(message) })
// #323 默认编辑器守护：常规页「默认编辑器」委托组（状态行四形态 +
// 守护开关 + 手动设为默认；判定权威在宿主，defaultEditor.state 推送回显）
const defaultEditor = new DefaultEditorSection({ postMessage: (message) => vscode.postMessage(message) })
// #350 T01 附加组件：状态列表 + 市场搜索 + VSCode 扩展管理入口（状态
// 权威在宿主，addons.state 推送回显；装载即拉取）。#351 T02 起分页含
// 功能开关与组件设置页挂载区（挂载内容进 addonSettingsHost——装载器
// mountRoot 的容器）。#354 T05 起向侧栏贡献核心/第三方两大组（组件状态
// 推送后经 onSidebarChange 触发视图 refreshSidebar 重建侧栏——经中转
// 函数接线，view 构造晚于分页实例）
let refreshSidebar: () => void = () => {}
const addons = new AddonSection(
  { postMessage: (message) => vscode.postMessage(message) },
  addonSettingsHost,
  () => refreshSidebar(),
)

const view = new SettingsPageView(
  { postMessage: (message) => vscode.postMessage(message) },
  PRODUCTION_SETTING_DEFINITIONS,
  [keybindings, appearance, indexMaintenance, addons],
  [wordSegment],
  [defaultEditor],
)
refreshSidebar = () => view.refreshSidebar()
view.mount(document.getElementById('app') ?? document.body)
vscode.postMessage({ kind: 'settings.get' })
vscode.postMessage({ kind: 'keybindings.get' })
// #128 CSS 片段管理状态：与 settings.get 同「装载即拉取」模式（retainContext
// WhenHidden 不开，隐藏释放重开重载，回显每次以宿主权威为准）
vscode.postMessage({ kind: 'snippets.get' })
// #198 索引维护状态：同「装载即拉取」模式
vscode.postMessage({ kind: 'index.get' })
// #239 分词资源状态：同「装载即拉取」模式（wordSegment.state 应答，
// 下载/删除完成后宿主经 onStateChanged 推送）
vscode.postMessage({ kind: 'wordSegment.get' })
// #323 默认编辑器守护状态：同「装载即拉取」模式（defaultEditor.state
// 应答；associations 变化与手动改回后宿主经 onStateChanged 推送）
vscode.postMessage({ kind: 'defaultEditor.get' })
// #350 T01 附加组件状态：同「装载即拉取」模式（addons.state 应答；发现/
// 唤醒/注册变化后宿主经协调器 onStateChanged 推送）
vscode.postMessage({ kind: 'addons.get' })
// #353 T04 基础设置区状态：同「装载即拉取」模式（addons.settingsState
// 应答；定义注册/成功保存/设置区开合后宿主推送回显）
vscode.postMessage({ kind: 'addons.settingsGet' })
// #359 T10 组件命令目录：同「装载即拉取」模式（addons.commandCatalog 应
// 答；命令注册/撤销/停用回收后宿主推送）——快捷键分页据此合并展示组件
// 命令（统一快捷键管理），目录更新经 setRuntimeOperations 进合并视图
vscode.postMessage({ kind: 'addons.commandCatalogGet' })
// T08（#357）行为冲突管理载荷：同「装载即拉取」模式（addons.behaviorsGet
// 应答；注册表对账/回收与用户状态写入后宿主推送 addons.behaviors）
vscode.postMessage({ kind: 'addons.behaviorsGet' })
// #351 T02 装载器就绪上报（设置页 webview 安装装载器后与面板重载后各发
// 一次）：宿主按当前期望装载清单幂等推送组件设置页指令（addon.load）
vscode.postMessage({ kind: 'addonPage.ready' })

window.addEventListener('message', (event) => {
  // #344（P3-12 收口）消息桥隔离与主 webview 对齐：来源非真宿主桥的
  // message 一律丢弃（允许清单判据见 untrustedFrame 模块头）。设置页当前
  // 不承载 iframe，无现实注入向量——此为一致性与纵深防御（两个 webview
  // 同一桥形态同一信任规则，未来向设置页引入嵌入内容时不留静默缺口）
  if (!isTrustedHostMessageSource(event.source, event.origin)) {
    return
  }
  // #351 T02 附加组件装载指令（独立于分页视图——装载器是页面级设施，
  // 代次与释放由装载器自持；指令只在 trusted 桥消息内到达）
  if (isHostToWebview(event.data) && event.data.kind === 'addonPage.directive') {
    addonLoader.handleDirective(event.data.directive)
    return
  }
  // #359 T10 组件命令目录：合并视图更新 + 快捷键分页重渲染（设置页自身
  // 不执行组件命令——命令回调在编辑器页；此处只承载统一键位管理展示）
  if (isHostToWebview(event.data) && event.data.kind === 'addons.commandCatalog') {
    setRuntimeOperations(event.data.commands.map((report) => ({
      id: report.commandId,
      command: report.commandId,
      titleKey: 'command.find.title',
      titleOverride: report.title,
      addonId: report.addonId,
      mode: report.mode,
      writes: report.writes,
      defaults: [...report.defaults],
    })))
    keybindings.handleCatalogChanged()
    return
  }
  view.handleHostMessage(event.data)
  keybindings.handleHostMessage(event.data)
  snippets.handleHostMessage(event.data)
  indexMaintenance.handleHostMessage(event.data)
  wordSegment.handleHostMessage(event.data)
  defaultEditor.handleHostMessage(event.data)
  addons.handleHostMessage(event.data)
  handleLocaleChangedMessage(event.data)
})
