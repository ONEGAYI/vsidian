// 扩展激活入口：注册 CustomTextEditorProvider（#38 起 priority: default，
// .md 默认打开即本扩展；可经「重新打开方式」或编辑器关联设置改回原生；
// 全局模式记忆为 source 时新开 .md 自动弹回原生编辑器）与文档事件监听、
// 三态视图命令、测试钩子。
// #33 起：装配 Vsidian 独立设置链路（globalState 持久化 + 纯代码 schema
// + 设置页面板）并注册「打开设置」命令——命令不要求当前有任何文档，
// 空窗口同样可用。
// #93 i18n：激活即按生效语言装配宿主侧语言包（auto 缺省按宿主显示语言
// 解析；#4 注册 general.language 后由此读用户偏好），宿主通知/标题等
// t() 取词随之就绪。
import * as vscode from 'vscode'
import { createTextEditorProvider, VIEW_TYPE } from './host/textEditorProvider'
import { SettingsService } from './host/settingsService'
import { createSettingsPage } from './host/settingsPage'
import { CssSnippetService } from './host/cssSnippetService'
import { createSnippetFsPort, createSnippetPageWiring } from './host/cssSnippetWiring'
import { cssSnippetEnvStamp } from './shared/cssSnippetEnv'
import { PRODUCTION_SETTING_DEFINITIONS } from './shared/settings'
import { installHostLocale } from './shared/locales'
import { hostLocale } from './host/hostLocale'
import { KeybindingService } from './host/keybindingService'
import { t } from './shared/i18n'

export function activate(context: vscode.ExtensionContext): void {
  // 设置存储：context.globalState（用户级，跨窗口一致、重启保留）+ 纯代码
  // schema——不使用 workspace.getConfiguration、不声明 contributes.
  // configuration，与 VSCode 统一设置中心完全解耦（AGENTS.md「插件设置入口」）
  const settingsService = new SettingsService(context.globalState, PRODUCTION_SETTING_DEFINITIONS)
  // #93 语言装配（宿主路径）：en 包同时登记为运行时回退
  installHostLocale(hostLocale(settingsService.getSnapshot()))
  const keybindingService = new KeybindingService(context.globalState)
  // #128 CSS 片段：用户级目录 + 逐片段开关的宿主权威服务（globalState 独立
  // key；文件系统/监听经 vscode 层端口注入）。initialScan 在监听者（编辑器
  // 面板广播、设置页推送）接线完成后启动——早于扫描完成打开的面板先拿空
  // 清单，扫描完成后经 onChange 广播自愈。
  // #131 环境隔离：本地与 Remote SSH 的 globalState 分属两台机器的扩展
  // 宿主（ADR-0007 证据链），天然各存各的；存储值内另落环境桶戳
  // （remoteName + machineId 推导）作防御层——异桶读取视为未配置
  const snippetService = new CssSnippetService(context.globalState, createSnippetFsPort(), 'vsidian.cssSnippets', {
    environmentStamp: cssSnippetEnvStamp({
      remoteName: vscode.env.remoteName,
      machineId: vscode.env.machineId,
    }),
    onUserVisibleReadError: (directory) => {
      void vscode.window.showWarningMessage(
        t('host.cssSnippetReadFailed', { directory }),
      )
    },
  })
  const settingsPage = createSettingsPage(
    context,
    settingsService,
    keybindingService,
    createSnippetPageWiring(snippetService),
  )
  const provider = createTextEditorProvider(context, {
    service: settingsService,
    keybindings: keybindingService,
    page: settingsPage,
  }, snippetService)
  void snippetService.initialize()
  context.subscriptions.push(
    // enableScripts 在每个面板的 webview.options 上设置（provider 内）；
    // 注册选项仅接受 retainContextWhenHidden 等（1.86 类型契约）
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider),
    // #33 设置页入口：打开（或 reveal 已有）Vsidian 设置面板
    vscode.commands.registerCommand('onegayi.vsidian.openSettings', () => {
      settingsPage.open()
    }),
    // #128 CSS 片段刷新：全局命令（命令面板与快捷键共用 id；无面板也可
    // 刷新，状态变更经 onChange 广播到全部已开面板与设置页）
    vscode.commands.registerCommand('onegayi.vsidian.cssSnippets.refresh', () =>
      snippetService.refresh()),
    // #131 暂停/恢复全部片段：宿主侧注册——不依赖任何 webview（正文工具
    // 栏隐藏、编辑器面板异常时命令面板仍可用）。全局冻结保留逐片段开关，
    // 恢复按原配置立即生效；与逐项停用语义正交
    vscode.commands.registerCommand('onegayi.vsidian.cssSnippets.pause', () =>
      void snippetService.setPaused(true).then((result) => {
        if (result.ok) {
          void vscode.window.showInformationMessage(t('host.cssSnippetsPaused'))
        }
      })),
    vscode.commands.registerCommand('onegayi.vsidian.cssSnippets.resume', () =>
      void snippetService.setPaused(false).then((result) => {
        if (result.ok) {
          void vscode.window.showInformationMessage(t('host.cssSnippetsResumed'))
        }
      })),
    snippetService,
  )
}

export function deactivate(): void {
  // 资源经 context.subscriptions 自动释放
}
