// 设置页 webview 启动入口（#33）：装配 acquireVsCodeApi 与设置页视图。
// 页面装载后立即拉取快照（settings.get）——retainContextWhenHidden 不开，
// 面板隐藏即释放、重开即重载，回显每次都以宿主权威值为准。
// #93 i18n：首帧从数据岛装配语言包（早于视图挂载，框架文案首帧即就绪）；
// locale.changed 换包后视图经订阅重渲染常驻文本。
import { SettingsPageView } from './settingsPageView'
import { PRODUCTION_SETTING_DEFINITIONS } from '../shared/settings'
import { KeybindingSettingsSection } from './keybindingSettings'
import { CssSnippetSettingsSection } from './cssSnippetSettings'
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

const view = new SettingsPageView(
  { postMessage: (message) => vscode.postMessage(message) },
  PRODUCTION_SETTING_DEFINITIONS,
  [keybindings, snippets],
)
view.mount(document.getElementById('app') ?? document.body)
vscode.postMessage({ kind: 'settings.get' })
vscode.postMessage({ kind: 'keybindings.get' })
// #128 CSS 片段管理状态：与 settings.get 同「装载即拉取」模式（retainContext
// WhenHidden 不开，隐藏释放重开重载，回显每次以宿主权威为准）
vscode.postMessage({ kind: 'snippets.get' })

window.addEventListener('message', (event) => {
  view.handleHostMessage(event.data)
  keybindings.handleHostMessage(event.data)
  snippets.handleHostMessage(event.data)
  handleLocaleChangedMessage(event.data)
})
