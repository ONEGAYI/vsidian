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
import { bootLocaleFromDocument, handleLocaleChangedMessage } from './localeBoot'
import './settingsPage.css'

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void
}

// 语言包首帧装配（数据岛由宿主 HTML 生成点注入；缺失时取词回退键名）
bootLocaleFromDocument()

const vscode = acquireVsCodeApi()
const keybindings = new KeybindingSettingsSection({ postMessage: (message) => vscode.postMessage(message) })
const snippets = new CssSnippetSettingsSection({ postMessage: (message) => vscode.postMessage(message) })
// #132 样式参考：离线渲染公开样式契约指南（数据模块随版本生成）；
// #145 契约 JSON 导出：工具区按钮经消息桥请求宿主另存
const styleRef = new StyleReferenceSection({ postMessage: (message) => vscode.postMessage(message) })
// #231 外观合并：CSS 片段与样式参考合并为一条「外观」（扁平三页签，组合
// 复用上述两个分页作为页签体；侧栏取 CSS 片段原槽位，位于快捷键与索引维护
// 之间）
const appearance = new AppearanceSection(snippets, styleRef)
// #198 索引维护：排除模式编辑与清理/重建操作（状态权威在宿主，index.state 推送回显）
const indexMaintenance = new IndexMaintenanceSection({ postMessage: (message) => vscode.postMessage(message) })
// #239 中文分词：引擎选择与 jieba 资源下载管理（设置值与资源状态权威
// 都在宿主，settings.* / wordSegment.state 推送回显）
const wordSegment = new WordSegmentSection({ postMessage: (message) => vscode.postMessage(message) })

const view = new SettingsPageView(
  { postMessage: (message) => vscode.postMessage(message) },
  PRODUCTION_SETTING_DEFINITIONS,
  [keybindings, appearance, indexMaintenance, wordSegment],
)
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

window.addEventListener('message', (event) => {
  view.handleHostMessage(event.data)
  keybindings.handleHostMessage(event.data)
  snippets.handleHostMessage(event.data)
  indexMaintenance.handleHostMessage(event.data)
  wordSegment.handleHostMessage(event.data)
  handleLocaleChangedMessage(event.data)
})
