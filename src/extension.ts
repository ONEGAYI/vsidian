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
import { runStyleReferenceExport } from './host/styleReferenceExport'
import { createVaultIndexService, currentRootRefs } from './host/vaultIndexWiring'
import { installRenameRefUpdater } from './host/vaultRenameWiring'
import { createIndexMaintenance, createIndexSettingsStore, initialExcludePatterns } from './host/vaultIndexMaintenance'
import { createJiebaWiring } from './host/jiebaResourceWiring'
import { createEditorGuardWiring } from './host/editorGuardWiring'
import { createFindOptionsStore } from './host/findOptionsStore'
import { createAddonWiring, type VsidianAddonExports } from './host/addons/addonWiring'
import { t } from './shared/i18n'

export function activate(context: vscode.ExtensionContext): VsidianAddonExports {
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
    // #129 越界/符号链接逃逸：启用条目被拒时提示（服务只在拒绝态变化时
    // 触发一次，不逐 watcher 事件重复打扰）
    onEntryRejected: (name, reason, path) => {
      void vscode.window.showWarningMessage(
        t(
          reason === 'symlink-escape'
            ? 'host.cssSnippetRejectedSymlink'
            : 'host.cssSnippetRejectedEscape',
          { name, path },
        ),
      )
    },
  })
  // #198 索引维护接线：排除模式持久化（workspaceState，工作区维度）+
  // 设置页/命令面板共用的清理与重建入口。先于设置页装配（设置页构造要
  // 收 index wiring）；状态变更 → 设置页 index.state 推送的订阅在其后接线
  const indexStore = createIndexSettingsStore(context.workspaceState)
  // #197 引用索引：activate 装配的服务级单例（不进 SessionEntry——面板全关
  // 不销毁）；恢复或重建各根索引并挂监听（分批让出，不饿死宿主）。无工作区
  // 时不建（既有编辑不因索引不可用而阻塞）。后台初始化：面板先拿 loading，
  // 索引就绪后经 onChange 广播自愈（snippetService.initialize 同模式）。
  // #198：构造时读入持久化排除模式（无有效存储回落默认值）
  const vaultIndex = createVaultIndexService(context, initialExcludePatterns(indexStore))
  const indexMaintenance = createIndexMaintenance(indexStore, vaultIndex)
  // #239 分词资源（jieba-wasm 按需下载）：宿主侧下载存 globalStorage
  //（Remote SSH 在远程机执行），锁定版本 + sha256 清单校验（清单随 VSIX
  // 发布、资源本体不进包体）；状态变更 → 设置页推送与用户通知
  const jieba = createJiebaWiring(context, settingsService)
  // #322 默认编辑器守护：两层时机（globalState 版本锁门控的启动主动检测
  // + associations「未接管 → 接管」变更沿被动监听）+ 一键改回修复链路。
  // onStartupFinished 常驻激活后每窗口装配（空窗口也检测）；通知文案走
  // host.defaultEditor* 词条，_test 钩子在 wiring 内门控注册。#323 起设置页
  // 常规页「默认编辑器」委托组消费其 stateFor/fixNow（下方传参接线）
  const editorGuard = createEditorGuardWiring(context, settingsService)
  // #350 T01 附加组件：注册表 + 发现协调 + 公开 registerAddon 导出。
  // start() 内部 fire-and-forget（先订阅 extensions.onDidChange 再扫描；
  // 协调先等自身 API 公布——不被下方 activate 返回等待，无互等）
  const addons = createAddonWiring(context)
  const settingsPage = createSettingsPage(
    context,
    settingsService,
    keybindingService,
    createSnippetPageWiring(snippetService),
    // #145 样式契约 JSON 导出：设置页按钮与命令面板命令共用同一入口
    () => runStyleReferenceExport(context),
    // #198 索引维护：设置页按钮和宿主命令共用同一 wiring
    indexMaintenance,
    // #239 分词资源：设置页「中文分词」分页的状态与下载管理
    jieba,
    // #323 默认编辑器守护：设置页常规页「默认编辑器」委托组的状态与手动改回
    editorGuard,
    // #350 T01 附加组件：设置页「附加组件」分页的状态与 VSCode 管理入口
    addons.page,
  )
  indexMaintenance.onStateChanged(() => settingsPage.notifyIndexChanged())
  jieba.service.onStateChanged(() => settingsPage.notifyWordSegmentChanged())
  // #323 生效判定变化（associations 变更 / 手动改回）→ 设置页状态行推送
  editorGuard.service.onStateChanged(() => settingsPage.notifyDefaultEditorChanged())
  // #350 T01 附加组件：协调器状态变化（发现/唤醒/注册）→ 设置页 addons.state 推送
  addons.onStateChanged(() => settingsPage.notifyAddonsChanged())
  // #351 T02：运行生命周期变化（启停/故障/代次/注册贡献）→ 同款推送回显
  addons.onRuntimeChanged(() => settingsPage.notifyAddonsChanged())
  const provider = createTextEditorProvider(context, {
    service: settingsService,
    keybindings: keybindingService,
    page: settingsPage,
    // #236 查找选项持久化：workspaceState（工作区级记忆——对齐 VSCode
    // storageService WORKSPACE 级口径；各工作区独立记忆）
    findOptions: createFindOptionsStore(context.workspaceState),
  }, snippetService, vaultIndex, indexMaintenance, jieba, addons.editorBridge)
  // F13：停用收尾接线（deactivate 返回其 Promise）
  providerDispose = () => provider.dispose()
  // #350 T01：启动附加组件发现协调（fire-and-forget，不阻塞激活返回）
  addons.start()
  void snippetService.initialize()
  if (vaultIndex) {
    // 后台初始化（不阻塞激活）；#198 根增删与窗口焦点由下方订阅接线
    void vaultIndex.initialize(currentRootRefs())
    context.subscriptions.push(
      vaultIndex,
      // #198 重连/长时间离开：窗口焦点回归触发核验（服务内做间隔保护）
      vscode.window.onDidChangeWindowState((state) => vaultIndex.setActive(state.focused)),
      // #198 根增删（onDidChangeWorkspaceFolders 域）：新增根扫描纳入、
      // 移除根停监听退出索引域（快照留存，显式清理才回收）
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void vaultIndex.setRoots(currentRootRefs())
      }),
      // #199 单文件更名/移动的引用自动更新：will 通道改写（WorkspaceEdit
      // 随 rename 原子应用、可撤销）+ did 通道索引刷新；外部工具改名无
      // 事件，只经 watcher 增量维护（通道语义见 vaultRenameWiring 头注释）
      ...installRenameRefUpdater(vaultIndex, process.platform === 'win32'),
    )
  }
  context.subscriptions.push(
    // enableScripts 在每个面板的 webview.options 上设置（provider 内）；
    // 注册选项仅接受 retainContextWhenHidden 等（1.86 类型契约）
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider),
    // #33 设置页入口：打开（或 reveal 已有）Vsidian 设置面板
    // #231 外观合并：打开外观分页并定位「样式参考」页签（entry 用总表
    // overview；分页 id 随合并改为 appearance，命令 id 与标题不变）
    vscode.commands.registerCommand('onegayi.vsidian.openStyleReference', () => {
      settingsPage.openWithSection('appearance', 'overview')
    }),
    // #145 导出样式参考 JSON：把 VSIX 内机器可读契约清单（与设置页「样式
    // 参考」分页同源）另存到用户路径（命令面板直接可达，无需打开设置页）
    vscode.commands.registerCommand('onegayi.vsidian.exportStyleReference', () =>
      void runStyleReferenceExport(context)),
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
    // #198 索引维护命令：设置页按钮与命令面板共用同一 wiring；宿主侧注册
    // （不依赖 webview 健康度）。默认未绑定键位（评估记录见
    // docs/specs/keybindings.md）——索引维护是低频操作，设置页入口常驻
    vscode.commands.registerCommand('onegayi.vsidian.index.rebuild', () =>
      void indexMaintenance.rebuild().then((result) => {
        if (result === 'done') {
          void vscode.window.showInformationMessage(t('host.indexRebuildDone'))
        } else if (result === 'cancelled') {
          void vscode.window.showInformationMessage(t('host.indexRebuildCancelled'))
        } else if (result === 'failed') {
          const detail = indexMaintenance.getState().notice?.detail ?? ''
          void vscode.window.showWarningMessage(t('host.indexRebuildFailed', { detail }))
        } else if (result === 'busy') {
          // 维护进行中不是失败（不再冒充失败弹空详情）
          void vscode.window.showInformationMessage(t('host.indexMaintenanceBusy'))
        }
      })),
    vscode.commands.registerCommand('onegayi.vsidian.index.cleanup', () =>
      void indexMaintenance.cleanup().then((result) => {
        if (result === 'unavailable') {
          return
        }
        if (result === 'failed') {
          const detail = indexMaintenance.getState().notice?.detail ?? ''
          void vscode.window.showWarningMessage(t('host.indexCleanupFailed', { detail }))
          return
        }
        if (result === 'busy') {
          void vscode.window.showInformationMessage(t('host.indexMaintenanceBusy'))
          return
        }
        void vscode.window.showInformationMessage(
          t('host.indexCleanupDone', { count: String(result.removedDirs) }))
      })),
    snippetService,
    // #350 T01 附加组件：停用收尾（退订清单变化与注册表联动）
    addons,
  )
  // #350 T01：原生激活完成后经返回值公布附加组件 API（apiVersion 1.0.0
  // 为首个候选版本——草案，未发布；组件经 exports.registerAddon 接入）
  return addons.exports
}

/** 停用收尾（F13）：provider.dispose 驱动块 ID 协调器全量退役——未落地
 *  的补 ID pending 尽力撤回，不留孤儿 ^id。deactivate 返回 thenable 时
 * VSCode 等待（约 5s 窗口）；activate 未跑完（provider 未建）时无收尾 */
let providerDispose: (() => Promise<void>) | undefined

export function deactivate(): Promise<void> | undefined {
  return providerDispose?.()
}
