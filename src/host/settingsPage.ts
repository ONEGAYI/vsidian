// Vsidian 独立设置页面板（#33）：createWebviewPanel 装配的宿主级 webview
// （非 custom editor——打开设置页不要求任何文档）。
//
// 装配照抄 custom editor 的成熟链路（textEditorProvider.buildWebviewHtml）：
// randomUUID nonce、四段 CSP、asWebviewUri 产物地址、资源根收紧到 out。
// 单例策略：已开着设置面板时再执行命令 reveal 已有面板而非叠加；
// retainContextWhenHidden 不开——隐藏即释放，重开时页面经 settings.get
// 重新拉取权威快照回显（与「重新打开后回显」验收天然对齐）。
//
// 持久化权威在宿主（SettingsService + globalState）：页面只回显与上送，
// 保存成功回 settings.changed、被拒回 settings.snapshot 恢复显示。
// #93 i18n：面板标题经 t() 取词（激活时已按生效语言装配宿主语言包）；
// HTML 生成点同步注入语言数据岛与 <html lang>（首帧文案即就绪）。
import * as vscode from 'vscode'
import { randomUUID } from 'node:crypto'
import { isWebviewToHost } from '../shared/protocol'
import { t } from '../shared/i18n'
import { LOCALE_MESSAGES, type LocaleCode } from '../shared/locales'
import { buildLocaleIslandHtml } from '../shared/locales/island'
import { hostLocale } from './hostLocale'
import type { SettingsService } from './settingsService'
import type { KeybindingService } from './keybindingService'
import type { CssSnippetState } from '../shared/cssSnippets'
import type { IndexStateMessage } from './vaultIndexMaintenance'
import type { JiebaWiring } from './jiebaResourceWiring'
import type { EditorGuardWiring } from './editorGuardWiring'

/** #128 CSS 片段管理接线（extension.ts 注入）：设置页面板的片段消息处理
 *  与状态推送。目录选择对话框（chooseDirectory）经回调进宿主 vscode 层——
 *  本模块不直接弹窗，测试钩子模式由注入方短路 */
export interface SnippetPageWiring {
  getState(): CssSnippetState
  setDirectory(directory: string | null): Promise<unknown>
  setEnabled(name: string, enabled: boolean): Promise<unknown>
  /** #131 全局暂停/恢复（设置页按钮与宿主命令共用服务入口） */
  setPaused(paused: boolean): Promise<unknown>
  refresh(): Promise<unknown>
  /** 弹文件夹选择器并应用所选目录；返回所选路径（取消为 null） */
  chooseDirectory(): Promise<string | null>
  /** 在系统文件管理器中打开当前片段目录 */
  openDirectory(): void
}

/** #198 索引维护接线（extension.ts 注入）：设置页面板的索引维护消息处理
 *  与状态推送（排除模式/清理/重建/取消）。操作结果经 index.state 推送，
 *  不逐次应答 */
export interface IndexPageWiring {
  getState(): IndexStateMessage
  setPatterns(patterns: string[]): Promise<unknown>
  resetPatterns(): Promise<unknown>
  cleanup(): Promise<unknown>
  rebuild(): Promise<unknown>
  cancel(): void
}

/** 设置页面板 viewType（createWebviewPanel 无需清单声明，customEditors 才要求） */
export const SETTINGS_VIEW_TYPE = 'onegayi.vsidian.settings'

/** 面板标题：界面与标题栏明确归属 Vsidian（#93 起经语言包取词，随装配语言） */
export function settingsPageTitle(): string {
  return t('settings.pageTitle')
}

/** 设置页观测信息（测试钩子与集成断言用） */
export interface SettingsPageInfo {
  open: boolean
  /** webview 已装载并请求过快照（ready 握手完成） */
  ready: boolean
  title: string
  /** 会话内恢复：webview 最近上报的 UI 态（分页 + 主区滚动）；undefined =
   *  本会话尚无上报。面板关闭/隐藏重载后按它经 focusSection{scroll} 恢复 */
  uiState?: { section: string; scrollTop: number }
}

export interface SettingsPageHandle {
  /** 打开（或 reveal 已有面板） */
  open(): void
  close(): void
  isOpen(): boolean
  getInfo(): SettingsPageInfo
  /** 经正式处理入口注入设置页 webview → 宿主消息（测试钩子通道） */
  injectMessage(message: unknown): void
  /**
   * 语言切换通知（#96）：设置页自身面板同步换包（locale.changed 携完整
   * 新语言包）并更新面板标题（宿主侧 t() 已由调用方先换包，标题取词即时
   * 为新语言）。面板未开时为 no-op（下次 open 按新快照语言生成 HTML）
   */
  notifyLocaleChanged(lang: LocaleCode): void
  /**
   * #128 CSS 片段状态推送：宿主片段状态变更后向已开设置页发 snippets.state
   * （面板未开时 no-op——重开经 snippets.get 重新拉取权威状态回显）
   */
  notifySnippetsChanged(): void
  /**
   * #198 索引维护：宿主维护状态变更后向已开设置页发 index.state
   * （面板未开时 no-op——重开经 index.get 重新拉取权威状态回显）
   */
  notifyIndexChanged(): void
  /**
   * #239 分词资源：宿主下载/删除状态变更后向已开设置页发 wordSegment.state
   * （面板未开时 no-op——重开经 wordSegment.get 重新拉取权威状态回显）
   */
  notifyWordSegmentChanged(): void
  /**
   * #323 默认编辑器守护：宿主生效判定可能变化后（associations 配置变更、
   * 手动改回）向已开设置页发 defaultEditor.state（面板未开时 no-op——重开
   * 经 defaultEditor.get 重新拉取权威状态回显）
   */
  notifyDefaultEditorChanged(): void
  /**
   * #132 样式参考：打开（或 reveal）设置页并定位到指定附加分页。
   * 面板未 ready 时在握手完成后补发（webview 装载是异步的）。
   * #231：entry 可选——分页内进一步定位的条目 id（外观分页按条目归属
   * 路由页内页签），缺省时消息不带该字段（向后兼容）
   */
  openWithSection(section: string, entry?: string): void
}

export function createSettingsPage(
  context: vscode.ExtensionContext,
  service: SettingsService,
  keybindings: KeybindingService,
  snippets?: SnippetPageWiring,
  /** #145 样式契约 JSON 导出（extension.ts 注入 runStyleReferenceExport；
   *  设置页按钮与命令面板命令共用同一入口，测试可短路） */
  styleRefExport?: () => void | Promise<void>,
  /** #198 索引维护接线（extension.ts 注入 createIndexMaintenance 产物） */
  index?: IndexPageWiring,
  /** #239 分词资源接线（extension.ts 注入 createJiebaWiring 产物）：
   *  设置页「中文分词」分页的状态拉取与下载/删除操作 */
  jieba?: JiebaWiring,
  /** #323 默认编辑器守护接线（extension.ts 注入 createEditorGuardWiring
   *  产物）：设置页常规页「默认编辑器」委托组的状态拉取与手动改回 */
  editorGuard?: EditorGuardWiring,
): SettingsPageHandle {
  let panel: vscode.WebviewPanel | undefined
  let ready = false
  // #132：ready 前收到的分页定位请求（settings.get 应答后补发）；
  // #231：定位携带可选 entry（外观分页内页签/条目路由），挂起与补发同形态
  let pendingSection: { section: string; entry?: string } | undefined
  // 会话内恢复：webview 最近上报的 UI 态（settings.uiState）。存活于扩展
  // 宿主内存（会话级，非 workspaceState——跨会话不恢复）；面板关闭不清除，
  // 重开/隐藏重载的 settings.get 握手时按它补发恢复定位
  let lastUiState: { section: string; scrollTop: number } | undefined

  /** 设置页 webview 消息处理（onDidReceiveMessage 与测试注入共用入口） */
  const handleMessage = (message: unknown): void => {
    if (!isWebviewToHost(message)) {
      return
    }
    const current = panel
    switch (message.kind) {
      case 'keybindings.get':
        void current?.webview.postMessage({ kind: 'keybindings.snapshot', overrides: keybindings.getSnapshot() })
        return
      case 'keybindings.set':
      case 'keybindings.reset':
      case 'keybindings.resetAll': {
        const result = message.kind === 'keybindings.set'
          ? keybindings.set(message.id, message.bindings, message.replaceConflicts)
          : message.kind === 'keybindings.reset'
            ? keybindings.reset(message.id, message.replaceConflicts)
            : keybindings.resetAll()
        void result.then((saved) => {
          if (!current || panel !== current) return
          void current.webview.postMessage({
            kind: saved.ok ? 'keybindings.changed' : 'keybindings.snapshot',
            overrides: saved.ok ? saved.overrides : keybindings.getSnapshot(),
            requestId: message.requestId, ok: saved.ok,
            ...(!saved.ok ? { reason: saved.reason, conflicts: saved.conflicts } : {}),
          })
        })
        return
      }
      case 'settings.get':
        ready = true
        void current?.webview.postMessage({
          kind: 'settings.snapshot',
          values: service.getSnapshot(),
        })
        // #132 补发分页定位（openWithSection 先于 ready 到达时）
        if (pendingSection !== undefined) {
          const pending = pendingSection
          pendingSection = undefined
          void current?.webview.postMessage({
            kind: 'settings.focusSection',
            section: pending.section,
            ...(pending.entry !== undefined ? { entry: pending.entry } : {}),
          })
        } else if (lastUiState) {
          // 会话内恢复：无显式定位请求时按 webview 上报的记忆恢复分页与
          // 滚动（面板关闭重开与隐藏重载共用 settings.get 握手时机，每次
          // 握手都补发——同值幂等；显式 openWithSection 优先于恢复）
          void current?.webview.postMessage({
            kind: 'settings.focusSection',
            section: lastUiState.section,
            scroll: lastUiState.scrollTop,
          })
        }
        // #96 R1 ready 即校准（设置页路径）：settings.get 是设置页的 ready
        // 握手——应答链附带当前语言包（幂等补发，复用 locale.changed 消息，
        // 协议零新增）。面板隐藏重载后 HTML 数据岛装回 open() 时的旧语言，
        // 以此对齐当前生效语言；与编辑器面板 ready 补发同一模式
        {
          const locale = hostLocale(service.getSnapshot())
          void current?.webview.postMessage({
            kind: 'locale.changed',
            lang: locale,
            messages: LOCALE_MESSAGES[locale],
          })
        }
        return
      case 'snippets.get':
        // #128 片段管理状态拉取（设置页装载/重载时的 ready 回填）
        if (snippets) {
          ready = true
          const state = snippets.getState()
          void current?.webview.postMessage({ kind: 'snippets.state', directory: state.directory,
            readError: state.readError, paused: state.paused, version: state.version,
            entries: [...state.entries], rejections: state.rejections })
        }
        return
      case 'snippets.chooseDirectory':
        // 选择对话框 + 应用目录（wiring 内完成 setDirectory）；结果经
        // notifySnippetsChanged 的 snippets.state 推送，不逐次应答
        void snippets?.chooseDirectory()
        return
      case 'snippets.setDirectory':
        void snippets?.setDirectory(message.directory)
        return
      case 'snippets.setEnabled':
        void snippets?.setEnabled(message.name, message.enabled)
        return
      case 'snippets.setPaused':
        // #131 暂停/恢复：结果经 notifySnippetsChanged 推送（onChange 广播）
        void snippets?.setPaused(message.paused)
        return
      case 'snippets.refresh':
        void snippets?.refresh()
        return
      case 'snippets.openDirectory':
        snippets?.openDirectory()
        return
      case 'styleRef.export':
        // #145 契约 JSON 导出：结果以宿主通知回报，不逐次应答
        void styleRefExport?.()
        return
      case 'index.get':
        // #198 索引维护状态拉取（设置页装载/重载的 ready 回填）
        if (index) {
          ready = true
          void current?.webview.postMessage(index.getState())
        }
        return
      case 'wordSegment.get':
        // #239 分词资源状态拉取（设置页装载回填；结果经 notifyWordSegmentChanged
        // 同款推送——下载/删除完成后服务 onStateChanged 广播）
        if (jieba) {
          void current?.webview.postMessage({
            kind: 'wordSegment.state',
            ...jieba.stateFor(current.webview),
          })
        }
        return
      case 'wordSegment.download':
        // 结果经服务 onStateChanged → notifyWordSegmentChanged 推送
        void jieba?.service.download()
        return
      case 'wordSegment.delete':
        void jieba?.service.delete()
        return
      case 'wordSegment.loadResult':
        return // 编辑器面板链路（provider 消费），设置页不会发出
      case 'defaultEditor.get':
        // #323 守护状态拉取（设置页装载/重载的 ready 回填；结果经
        // notifyDefaultEditorChanged 同款推送——associations 变化与手动改回
        // 后服务 onStateChanged 广播）
        if (editorGuard) {
          ready = true
          void current?.webview.postMessage({
            kind: 'defaultEditor.state',
            ...editorGuard.stateFor(),
          })
        }
        return
      case 'defaultEditor.fix':
        // 手动「设为默认」：守护修复链路（合并写回 + 复查 + 失败降级引导）；
        // 结果经 defaultEditor.state 推送与宿主通知呈现，不逐次应答
        void editorGuard?.fixNow()
        return
      case 'index.setPatterns':
        // 结果（含被拒项回显）经 notifyIndexChanged 的 index.state 推送
        void index?.setPatterns(message.patterns)
        return
      case 'index.resetPatterns':
        void index?.resetPatterns()
        return
      case 'index.cleanup':
        void index?.cleanup()
        return
      case 'index.rebuild':
        void index?.rebuild()
        return
      case 'index.cancel':
        index?.cancel()
        return
      case 'settings.uiState':
        // 会话内恢复上报：仅面板存活期间的上报才记忆（disposeSub 已清
        // panel，旧面板迟到上报天然拦住）；空 section（尚无激活分页）忽略
        if (panel && message.section) {
          lastUiState = { section: message.section, scrollTop: message.scrollTop }
        }
        return
      case 'settings.set': {
        void service.apply(message.values).then((result) => {
          // 持久化期间设置页可能已关闭或重新打开；旧面板的 webview getter
          // 在 dispose 后会抛错，旧保存结果也不应回信给新面板。
          if (!current || panel !== current) return
          // 成功：onChange 广播（provider 层接编辑器面板）之外，直接回发
          // 设置页自身 settings.changed 刷新回显；拒绝：以权威快照恢复显示
          const kind = result.ok ? 'settings.changed' : 'settings.snapshot'
          void current?.webview.postMessage({
            kind,
            values: result.ok ? result.values : service.getSnapshot(),
          })
        })
        return
      }
      default:
        return // 设置页不会发出其余消息，忽略
    }
  }

  const disposeSub = () => {
    panel = undefined
    ready = false
  }

  const open = (): void => {
    if (panel) {
      panel.reveal()
      return
    }
    const created = vscode.window.createWebviewPanel(
      SETTINGS_VIEW_TYPE,
      settingsPageTitle(),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        // C-7 同口径收紧：设置页只加载自身产物（out/webview/settings.js|css）
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out')],
      },
    )
    panel = created
    created.webview.html = buildSettingsPageHtml(
      created.webview,
      context.extensionUri,
      hostLocale(service.getSnapshot()),
    )
    const messageSub = created.webview.onDidReceiveMessage(handleMessage)
    // retainContextWhenHidden 不开：面板切后台 webview 即释放重载。隐藏即
    // 重置 ready——stale-ready 窗口（webview 已卸载、重载握手未到）内
    // openWithSection 的立即 postMessage 会落入已卸载的 webview 而丢失，
    // 改走 pendingSection 挂起、重载握手补发；重载完成经 settings.get 重新
    // 置位。重置同时让恢复补发不覆盖此期间的显式定位请求
    const viewStateSub = created.onDidChangeViewState((event) => {
      if (!event.webviewPanel.visible) ready = false
    })
    created.onDidDispose(() => {
      messageSub.dispose()
      viewStateSub.dispose()
      disposeSub()
    })
  }

  /**
   * 打开设置页并定位到指定附加分页；entry（#231 外观合并，可选）为分页内
   * 进一步定位的条目 id（外观分页按条目归属路由页内页签）。entry 缺省时
   * 消息不带该字段（#132 起的既有形态，向后兼容）
   */
  const openWithSection = (section: string, entry?: string): void => {
    open()
    const current = panel
    if (!current) return
    if (ready) {
      void current.webview.postMessage({
        kind: 'settings.focusSection',
        section,
        ...(entry !== undefined ? { entry } : {}),
      })
    } else {
      pendingSection = { section, entry }
    }
  }

  return {
    open,
    openWithSection,
    close: () => {
      panel?.dispose()
    },
    isOpen: () => panel !== undefined,
    // #96 title 优先读真实面板标题（面板开着时即用户在 VSCode 标签上看到
    // 的文字）；未开时按当前装配语言计算（与下次 open 的标题一致）；
    // uiState 供测试与诊断观测会话内恢复的记忆值
    getInfo: () => ({
      open: panel !== undefined,
      ready,
      title: panel?.title ?? settingsPageTitle(),
      ...(lastUiState ? { uiState: { ...lastUiState } } : {}),
    }),
    injectMessage: handleMessage,
    notifyLocaleChanged: (lang: LocaleCode) => {
      if (!panel) {
        return
      }
      void panel.webview.postMessage({
        kind: 'locale.changed',
        lang,
        messages: LOCALE_MESSAGES[lang],
      })
      panel.title = settingsPageTitle()
    },
    notifySnippetsChanged: () => {
      if (!panel || !snippets) {
        return
      }
      const state = snippets.getState()
      void panel.webview.postMessage({ kind: 'snippets.state', directory: state.directory,
        readError: state.readError, paused: state.paused, version: state.version,
        entries: [...state.entries], rejections: state.rejections })
    },
    notifyIndexChanged: () => {
      if (!panel || !index) {
        return
      }
      void panel.webview.postMessage(index.getState())
    },
    // #239 分词资源状态推送（服务 onStateChanged → extension.ts 接线）：
    // 面板未开时 no-op（重开经 wordSegment.get 重新拉取）
    notifyWordSegmentChanged: () => {
      if (!panel || !jieba) {
        return
      }
      void panel.webview.postMessage({
        kind: 'wordSegment.state',
        ...jieba.stateFor(panel.webview),
      })
    },
    // #323 默认编辑器守护状态推送（服务 onStateChanged → extension.ts 接线）：
    // 面板未开时 no-op（重开经 defaultEditor.get 重新拉取）
    notifyDefaultEditorChanged: () => {
      if (!panel || !editorGuard) {
        return
      }
      void panel.webview.postMessage({
        kind: 'defaultEditor.state',
        ...editorGuard.stateFor(),
      })
    },
  }
}

/** 设置页 HTML：CSP 四段与产物地址装配（照抄 buildWebviewHtml 模式）；
 *  #93 同步注入 <html lang> 与语言数据岛（首帧文案即就绪，零字典字节进
 *  settings.js——语言包只经数据岛进入 webview） */
function buildSettingsPageHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  locale: LocaleCode,
): string {
  const nonce = randomUUID()
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'settings.js'),
  )
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'settings.css'),
  )
  const csp = [
    `default-src 'none'`,
    // 本页无图片资源（视图全 createElement/textContent），不放行远程图源
    `img-src ${webview.cspSource}`,
    `script-src ${webview.cspSource} 'nonce-${nonce}'`,
    `style-src ${webview.cspSource}`,
  ].join('; ')
  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="${styleUri}" rel="stylesheet">
<title>${settingsPageTitle()}</title>
</head>
<body>
<div id="app"></div>
${buildLocaleIslandHtml(locale, LOCALE_MESSAGES[locale])}
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
}
