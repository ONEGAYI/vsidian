// CustomTextEditorProvider 实现与文档会话注册表。
//
// 选择 CustomTextEditorProvider（而非 CustomEditorProvider）：保存、dirty、
// Hot Exit 全部由 VSCode 标准文本管线自动处理，扩展只需实现
// resolveCustomTextEditor（探索笔记 02 §1）。
// 权威文本为 TextDocument；webview 编辑经 DocumentSession 校验后以
// WorkspaceEdit 写回；文档事件回流经 session 识别自家确认与外部变更。
import * as vscode from 'vscode'
import { randomUUID } from 'node:crypto'
import * as path from 'node:path'
import { DocumentSession, type HostDocumentPort, type SessionNotice } from './documentSession'
import {
  classifyImageTarget,
  classifyLinkTarget,
  imageBlockReasonOf,
  type ImageResolution,
  type LinkContext,
} from './linkTarget'
import {
  findBlockOffset,
  findHeadingOffset,
} from './wikilinkTarget'
import {
  resolveVaultLinkFile,
  type VaultLinkResolveContext,
} from '../shared/vaultLink'
import { parseWikilinkInner } from '../shared/wikilink'
import { NewlineCoordinator } from '../shared/newline'
import { buildEditorCsp } from './editorCsp'
import { FORMAT_OPERATIONS } from '../shared/formatOperations'
import { KEYBINDING_OPERATIONS, UI_OPERATIONS } from '../shared/keybindings'
import {
  isWebviewToHost,
  type DiagramExportPayload,
  type HostToWebview,
  type ImagePastePayload,
  type SerChange,
  type TableEditOp,
  type WebviewToHost,
} from '../shared/protocol'
import {
  decideReadingRestore,
  decideResolveBehavior,
  isDiffContext,
  isUriInDiffContext,
  LAST_MODE_KEY,
  nextTriMode,
  planViewSwitch,
  readRememberedMode,
  type DiffTabInfo,
  type TabInputKind,
  type TriViewMode,
  type ViewSwitchPlan,
} from './viewCycle'
import type { SettingsService } from './settingsService'
import type { KeybindingService } from './keybindingService'
import type { CssSnippetService } from './cssSnippetService'
import type { VaultIndexService } from './vaultIndexService'
import type { IndexMaintenance } from './vaultIndexMaintenance'
import { ImageRefreshCoordinator } from './imageRefreshCoordinator'
import type { ImageVersionTable } from './imageVersioning'
import {
  IMAGE_EVENT_DEBOUNCE_MS,
  IMAGE_WAKE_MIN_GAP_MS,
  IMAGE_WATCH_GLOB_SEGMENTS,
  isFileNotFound,
  isImageFileExtension,
} from '../shared/imageRefresh'
import type { SnippetLinkList } from '../shared/cssSnippets'
import type { SettingsPageHandle } from './settingsPage'
import { runDiagramExport } from './diagramExportHost'
import { runImagePaste, type ImagePasteOutcome } from './imagePasteHost'
import { installHostLocale, LOCALE_MESSAGES, type LocaleCode } from '../shared/locales'
import { buildLocaleIslandHtml } from '../shared/locales/island'
import { hostLocale } from './hostLocale'
import { t } from '../shared/i18n'

export const VIEW_TYPE = 'onegayi.vsidian.editor'

/** #33 设置链路的 provider 接线（extension.ts 注入）：编辑器面板的设置
 *  消息拦截（settings.open/get）、宿主保存后的变更广播（settings.changed
 *  到全部已打开编辑器面板）与设置页测试钩子的观测/注入通道。
 *  page 直接复用 settingsPage 的面板句柄（open/close/getInfo/injectMessage），
 *  不再逐方法转发展开 */
export interface SettingsWiring {
  service: SettingsService
  keybindings: KeybindingService
  page: SettingsPageHandle
}

/** .md / .markdown 判定（#38）：与 customEditors selector 及标题栏 when 子句
 *  的 resourceExtname 口径一致（大小写敏感，保持与 when 求值同判） */
function isMarkdownFile(uri: vscode.Uri): boolean {
  const ext = path.extname(uri.fsPath)
  return ext === '.md' || ext === '.markdown'
}

/** tab input 形态归纳（#38 D10：diff 语境检测的 vscode 层映射） */
function tabInputKindOf(input: unknown): TabInputKind {
  if (input instanceof vscode.TabInputText) {
    return 'text'
  }
  if (input instanceof vscode.TabInputTextDiff) {
    return 'text-diff'
  }
  if (input instanceof vscode.TabInputCustom) {
    return 'custom'
  }
  return 'other'
}

/** 面板状态复合键（#38）：pendingReadingRestore 的登记/消费/清理共用同一
 *  拼接形状，集中于此避免三处漂移（`${docUri}::${sessionId}`） */
function panelStateKey(docUri: string, sessionId: string): string {
  return `${docUri}::${sessionId}`
}

/** 活动标签是否为指定文档的本扩展 custom editor（C-5）。
 *  webview 转发的 undo/redo 经宿主全局命令执行，而该命令作用于活动
 *  编辑器——请求前必须确认活动 tab 归属本面板文档，否则会撤销其他文档 */
export function isActiveTabCustomEditorOf(
  tab: vscode.Tab | undefined,
  viewType: string,
  uriStr: string,
): boolean {
  const input = tab?.input
  return (
    input instanceof vscode.TabInputCustom &&
    input.viewType === viewType &&
    input.uri.toString() === uriStr
  )
}

/** 图表导出消息日志（#111 测试钩子观测：钩子模式下集成测试断言
 *  webview→宿主导出链路的消息形态；按文档 URI 分桶，查询即取走） */
const diagramExportTestLog = new Map<string, DiagramExportPayload[]>()

/** 图片粘贴消息日志（#161 测试钩子观测：记录宿主收到的 image.paste 载荷
 *  形态；落盘真实执行（无对话框依赖，与 diagram.export 的短路不同），
 *  集成测试另以文件系统断言落盘结果；按文档 URI 分桶，查询即取走） */
const imagePasteTestLog = new Map<string, ImagePastePayload[]>()

/** 链接跳转执行日志（#10 测试钩子观测：VSIDIAN_TEST_HOOKS 下集成测试断言
 *  宿主收到的跳转意图与处置结果） */
export interface LinkLogEntry {
  kind: 'external' | 'doc' | 'anchor' | 'blocked' | 'not-found'
  href: string
  /** blocked 的原因码 */
  reason?: string
  /** blocked-scheme 的协议名 */
  scheme?: string
  /** doc 的实际目标路径 */
  path?: string
  /** #160 doc/anchor 的锚点目标（容错解码后原文） */
  fragment?: string
  /** #160 doc/anchor 的定位方式：custom-panel=本扩展面板挂载定位；
   *  none=无定位（无锚点、
   *  `#^` 块引用定位器缺席降级或目标标题缺失） */
  locate?: 'custom-panel' | 'none'
}

/** 双链跳转执行日志（#11；与 LinkLogEntry 共用 linkLog 通道；#196 起
 *  同名歧义条目随 QuickPick 选择废除，新增越界条目） */
export interface WikilinkLogEntry {
  kind:
    | 'wikilink-doc'
    | 'wikilink-not-found'
    | 'wikilink-no-workspace'
    | 'wikilink-unsupported'
    | 'wikilink-outside-root'
  /** 上报的原始 target（| 之前） */
  target: string
  /** wikilink-doc 的目标绝对路径 */
  path?: string
  /** 请求的标题目标（trim 后） */
  heading?: string
  /** 请求的块引用目标（#159；与 heading 互斥） */
  blockId?: string
  /** wikilink-doc 的定位方式：custom-panel=本扩展面板挂载定位；none=无标题定位 */
  locate?: 'custom-panel' | 'none'
}

interface SessionEntry {
  session: DocumentSession
  doc: vscode.TextDocument
  /** 面板句柄（#13 表格命令需定位活动面板；写操作只作用于光标所在面板） */
  panels: Map<string, vscode.WebviewPanel>
  appliedEdits: number
  /** #10/#11 链接跳转执行日志（容量有界） */
  linkLog: Array<LinkLogEntry | WikilinkLogEntry>
}

/** 文档的资源根（#10）：图片 webview 资源许可面 = 工作区文件夹根
 *  （无工作区时为文档所在目录）——与链接/图片路径不得越过工作区边界的
 *  白名单口径一致 */
function imageResourceRoot(document: vscode.TextDocument): vscode.Uri {
  return (
    vscode.workspace.getWorkspaceFolder(document.uri)?.uri ??
    vscode.Uri.joinPath(document.uri, '..')
  )
}

/** 编辑器面板的 webview 资源根（C-7 收紧口径）：扩展产物 + 工作区图片根 +
 *  #128 CSS 片段目录（用户级任意路径，须在许可面内才能 asWebviewUri 加载） */
function editorResourceRoots(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  snippetDirectory: string | null,
): vscode.Uri[] {
  const roots = [
    vscode.Uri.joinPath(context.extensionUri, 'out'),
    vscode.Uri.joinPath(context.extensionUri, 'media'),
    imageResourceRoot(document),
  ]
  if (snippetDirectory) {
    roots.push(vscode.Uri.file(snippetDirectory))
  }
  return roots
}

/**
 * #128/#129/#131 片段装载清单：宿主权威状态 × 开关映射 × 依赖分析（越界
 * 条目排除）→ 本面板可加载的 <link> URI 有序清单。URI 由宿主逐面板构造
 * （asWebviewUri 前缀是 webview 私有的随机 origin）；`?v=<v>` 缓存击穿
 * 参数取**入口级版本**（#129 依赖归因：入口自身或其 @import 闭包变更时
 * 推进，其他入口启停不扰动其 URI——webview 装配器按 URI diff 幂等跳过）
 * 保证「保存后自动更新」取到新内容（webview 资源服务不承诺无缓存）。
 * 目录未配置/服务未就绪时为空清单。
 * #131 全局暂停（paused）即空清单（version 取当前状态版本以驱动 webview
 * 撤链）：编辑器撤下全部片段链、新面板不装，逐片段开关不受影响（恢复时
 * 重发原清单立即生效，条目 ?v= 仍为各入口的入口级版本）。
 */
function buildSnippetLinkList(
  service: CssSnippetService | undefined,
  webview: vscode.Webview,
): SnippetLinkList {
  const state = service?.getState()
  if (!service || !state?.directory || state.paused) {
    return { version: state?.paused ? state.version : 0, snippets: [] }
  }
  const directoryUri = vscode.Uri.file(state.directory)
  return {
    version: state.version,
    snippets: service.getLinkItems().map(({ name, v }) => ({
      name,
      uri: `${webview.asWebviewUri(vscode.Uri.joinPath(directoryUri, name)).toString()}?v=${v}`,
      v,
    })),
  }
}

/** #69 笔记名（标题链接 `[[笔记名#标题]]` 的锚）：docUri 字符串 → 文件名
 *  去扩展名（Obsidian 语义：不含路径不含 .md）。URI 解析失败回退原文。
 *  review-loops 第 2 轮披露：笔记名不做转义（理由与标题侧 outlineLinkHeading
 *  同口径——形态学不认 `\]`/`\|`/`\#`，转义是空操作），故文件名含 `|`/`]`/`#`
 *  时该链接无法表达这个目标：`|` 被当作别名分隔符（链接静默指向按名解析出的
 *  另一笔记）、`]` 提前闭合、`#` 起标题分隔段。属 wikilink 形态学已知限制，
 *  与标题侧同口径（限制见人工验证清单） */
export function outlineNoteNameOf(docUri: string): string {
  try {
    const fsPath = vscode.Uri.parse(docUri).fsPath
    const base = path.basename(fsPath)
    return base.replace(/\.[^.]+$/, '')
  } catch {
    return docUri
  }
}

/** 标题进 wikilink 的文本：原样拼接，不做反斜杠转义（review-loops 第 2 轮）。
 *  双链形态学（src/shared/wikilink.ts）不认 `\]`/`\|`/`\#`——转义后要么仍切
 *  别名（`\|`），要么整条不命中（`]` 触发扫描守卫、`#` 触发标题内禁字符），
 *  转义只是凭空多出反斜杠；Obsidian 同样没有 wikilink 内的转义语法。故标题
 *  含 `]`/`|`/`#`/`^` 时链接无法表达该标题，属形态学已知限制（构造时不做
 *  无效改写，限制见人工验证清单） */
function outlineLinkHeading(heading: string): string {
  return heading
}

/** 链接目标解析上下文（宿主文件系统语义：扩展宿主进程的平台即工作区
 *  文件系统所在机器——本地 Windows 是 win32，远程 SSH 宿主是远程平台，
 *  两类路径语义天然不混用） */
function linkContextOf(document: vscode.TextDocument): LinkContext {
  const docPath = document.uri.fsPath
  return {
    docDir: path.dirname(docPath),
    rootDir: imageResourceRoot(document).fsPath,
    isWindowsHost: process.platform === 'win32',
  }
}

export function createTextEditorProvider(
  context: vscode.ExtensionContext,
  settings?: SettingsWiring,
  snippets?: CssSnippetService,
  vaultIndex?: VaultIndexService,
  /** #198 索引维护接线（测试钩子观测持久化与生效模式用；生产由
   *  extension.ts 注入 createIndexMaintenance 产物） */
  indexMaintenance?: IndexMaintenance,
): vscode.CustomTextEditorProvider {
  const sessions = new Map<string, SessionEntry>()
  let lastClosedInput: { docUri: string; webviewText?: string; fragments: string[] } | undefined

  // ---- #201 图片刷新协调器（provider 级单件：版本表与失效通道跨会话共享） ----
  const isWindowsHost = process.platform === 'win32'
  const imageRefreshEvents: string[] = []
  const IMAGE_EVENT_LOG_LIMIT = 8 // 环形上限（RENAME_LOG_LIMIT 同形态）：会话生命周期内无界增长
  const imageRefresh = new ImageRefreshCoordinator(
    {
      statTarget: async (fsPath) => {
        try {
          const st = await vscode.workspace.fs.stat(vscode.Uri.file(fsPath))
          if ((st.type & vscode.FileType.File) === 0) {
            return { kind: 'missing' } as const
          }
          return { kind: 'ok', mtimeMs: st.mtime, size: st.size } as const
        } catch (err) {
          return isFileNotFound(err)
            ? ({ kind: 'missing' } as const)
            : ({ kind: 'inaccessible' } as const)
        }
      },
      resolveTarget: () => null, // 各会话按自身 linkCtx 覆盖（openEntry 注入）
      invalidateTarget: (fsPath) => {
        imageRefreshEvents.push(fsPath)
        if (imageRefreshEvents.length > IMAGE_EVENT_LOG_LIMIT) {
          imageRefreshEvents.splice(0, imageRefreshEvents.length - IMAGE_EVENT_LOG_LIMIT)
        }
        for (const entry of sessions.values()) {
          entry.session.invalidateImagesByFsPath(fsPath)
        }
      },
    },
    { isWindowsHost },
  )
  /** 图片文件监听（#201）：图片类扩展不经索引域 watcher（只听 *.md），在
   *  此自建。工作区根递归监听（花括号 glob 每根一个 watcher）；根增删整体
   *  重建（先拆旧）；无工作区不建（周期核验与按需 stat 兜底）。事件去抖
   *  归并（保存器写临时文件 + rename 会产生成组事件） */
  const imageWatchTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const scheduleImageEvent = (fsPath: string): void => {
    const prev = imageWatchTimers.get(fsPath)
    if (prev !== undefined) {
      clearTimeout(prev)
    }
    imageWatchTimers.set(
      fsPath,
      setTimeout(() => {
        imageWatchTimers.delete(fsPath)
        void imageRefresh.handleTargetEvent(fsPath)
      }, IMAGE_EVENT_DEBOUNCE_MS),
    )
  }
  let imageWatchers: vscode.FileSystemWatcher[] = []
  const teardownImageWatchers = (): void => {
    for (const watcher of imageWatchers) {
      watcher.dispose() // 其上的事件订阅随之释放
    }
    imageWatchers = []
    // 去抖计时器随之清空（review-loops #21）：拆监听后残留计时器会在
    // 到期时对已失效的 watcher 域发起核验
    for (const timer of imageWatchTimers.values()) {
      clearTimeout(timer)
    }
    imageWatchTimers.clear()
  }
  const setupImageWatchers = (): void => {
    teardownImageWatchers()
    const folders = vscode.workspace.workspaceFolders
    if (!folders || folders.length === 0) {
      return
    }
    const glob = `**/*.{${IMAGE_WATCH_GLOB_SEGMENTS.join(',')}}`
    for (const folder of folders) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder.uri, glob),
      )
      const forward = (uri: vscode.Uri | undefined): void => {
        if (uri && isImageFileExtension(uri.fsPath)) {
          scheduleImageEvent(uri.fsPath)
        }
      }
      watcher.onDidChange(forward)
      watcher.onDidCreate(forward)
      watcher.onDidDelete(forward)
      imageWatchers.push(watcher)
    }
  }
  setupImageWatchers()
  context.subscriptions.push({ dispose: teardownImageWatchers })
  // 根增删：重挂图片监听（新增根纳入、移除根拆除）
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      setupImageWatchers()
    }),
  )
  // 索引目标变化事件（#198 通道）：图片类目标即时核验（md 域事件对图片
  // 管线无匹配登记，天然空操作；未来索引扩展到非 md 目标时自动接通）
  if (vaultIndex) {
    const offTargetChange = vaultIndex.onTargetChange((event) => {
      if (isImageFileExtension(event.fsPath)) {
        scheduleImageEvent(event.fsPath)
      }
    })
    context.subscriptions.push({ dispose: offTargetChange })
  }
  /** 唤醒广播（#201 及时核验）：窗口焦点回归（远程重连后用户回到窗口）
   *  节流后向全部面板广播 image.wake，webview 有活跃图源立即触发一轮核验 */
  let lastImageWakeAt = 0
  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      if (!state.focused) {
        return
      }
      const now = Date.now()
      if (now - lastImageWakeAt < IMAGE_WAKE_MIN_GAP_MS) {
        return
      }
      lastImageWakeAt = now
      const message: HostToWebview = { kind: 'image.wake' }
      for (const entry of sessions.values()) {
        for (const { sessionId } of entry.session.getInfo().panels) {
          entry.session.postToPanel(sessionId, message)
        }
      }
    }),
  )
  const getEntry = (uri: vscode.Uri): SessionEntry | undefined =>
    sessions.get(uri.toString())

  /** 向面板请求最新 view.state（面板存活时的最可靠未确认输入来源） */
  const fetchPanelText = async (
    entry: SessionEntry,
    sessionId: string,
    timeoutMs = 3000,
  ): Promise<string | undefined> => {
    const before = entry.session.getViewState(sessionId)
    entry.session.postToPanel(sessionId, { kind: 'view.state.request' })
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const state = entry.session.getViewState(sessionId)
      if (state && state !== before) {
        return state.text
      }
      await new Promise((r) => setTimeout(r, 100))
    }
    return entry.session.getViewState(sessionId)?.text
  }

  /** 复制未确认输入：优先面板最新文本，回退宿主快照（fragments / report 全文） */
  const copyConflictInput = async (uriStr: string, sessionId: string): Promise<void> => {
    const entry = sessions.get(uriStr)
    if (!entry) {
      return
    }
    const state = entry.session.getConflictState(sessionId)
    // 重载后的暂停面板（B-2）：webview 已装载权威全文（init），view.state
    // 不再代表冲突前的未确认输入——跳过面板查询，直接用宿主留存的快照
    const live =
      state?.suspended && state.reloaded ? undefined : await fetchPanelText(entry, sessionId)
    const text = live ?? state?.webviewText ?? state?.fragments.join('\n') ?? ''
    if (text) {
      await vscode.env.clipboard.writeText(text)
      void vscode.window.showInformationMessage(t('host.conflictInputCopied'))
    } else {
      void vscode.window.showWarningMessage(t('host.noConflictInputToCopy'))
    }
  }

  /** 恢复（放弃本地修改重新同步）：二次确认避免误丢输入 */
  const confirmResume = async (uriStr: string, sessionId: string): Promise<void> => {
    const entry = sessions.get(uriStr)
    if (!entry) {
      return
    }
    const name = vscode.workspace.asRelativePath(entry.doc.uri)
    const discardLabel = t('host.discardAndResync')
    const pick = await vscode.window.showWarningMessage(
      t('host.confirmResume', { name }),
      discardLabel,
    )
    if (pick === discardLabel) {
      entry.session.resumePanel(sessionId)
    }
  }

  /** 会话通知呈现（#4）：冲突暂停、复制请求、面板关闭/断连时的未确认输入提醒 */
  const handleNotice = (uriStr: string, notice: SessionNotice): void => {
    const entry = sessions.get(uriStr)
    const name = entry ? vscode.workspace.asRelativePath(entry.doc.uri) : uriStr
    const copyLabel = t('host.copyConflictInput')
    const discardLabel = t('host.discardAndResync')
    if (notice.type === 'conflict') {
      void vscode.window
        .showWarningMessage(
          t('host.conflictPaused', { name }),
          copyLabel,
          discardLabel,
        )
        .then((pick) => {
          if (pick === copyLabel) {
            void copyConflictInput(uriStr, notice.sessionId)
          } else if (pick === discardLabel) {
            void confirmResume(uriStr, notice.sessionId)
          }
        })
      return
    }
    if (notice.type === 'copy-request') {
      void copyConflictInput(uriStr, notice.sessionId)
      return
    }
    // panel-closed-with-input：面板关闭（或 SSH 断连触发的 dispose）时未确认
    // 输入仍在宿主快照中——提示取回，不得误报已保存。文本优先取 webview
    // 即时上报的全文快照（#21：含暂停后新输入与暂缓集内容），回退逐笔片段
    if (process.env.VSIDIAN_TEST_HOOKS === '1') {
      lastClosedInput = { docUri: notice.docUri, webviewText: notice.webviewText, fragments: notice.fragments }
    }
    const closedText = notice.webviewText ?? notice.fragments.join('\n')
    void vscode.window
      .showWarningMessage(
        t('host.panelClosedWithInput', { name, text: closedText.slice(0, 120) }),
        copyLabel,
      )
      .then((pick) => {
        if (pick === copyLabel) {
          const state = sessions.get(uriStr)?.session.getConflictState(notice.sessionId)
          void vscode.env.clipboard.writeText(
            state?.webviewText ?? notice.webviewText ?? state?.fragments.join('\n') ?? notice.fragments.join('\n'),
          )
        }
      })
  }

  // ---- #38 三态视图编排：全局模式记忆 + 活动模式 context + 恢复决策 ----

  /** 待初始 reading 恢复的面板（resolve 时记忆为 reading；键 `${docUri}::${sessionId}`）。
   *  面板就绪后首份 view.state 到达即消费（见 handlePanelViewState） */
  const pendingReadingRestore = new Set<string>()

  /** 记忆读取/写入（context.globalState；只在成功切换后写入，无历史不写入） */
  const readRemembered = (): TriViewMode =>
    readRememberedMode(context.globalState.get.bind(context.globalState))
  const writeRemembered = async (mode: TriViewMode): Promise<void> => {
    await context.globalState.update(LAST_MODE_KEY, mode)
  }

  /** vsidian.activeMode context（'live'|'reading'）：只反映活动 tab 的实际
   *  模式（不把最近模式误当成当前标签状态）；source 态经核心 key
   *  （activeCustomEditorId / activeWebviewPanelId / resourceExtname）表达，
   *  不依赖本 context。值不变时跳过 setContext（view.state 高频回报） */
  let lastActiveModeContext: 'live' | 'reading' | undefined
  const setActiveModeContext = (mode: 'live' | 'reading'): void => {
    if (lastActiveModeContext === mode) {
      return
    }
    lastActiveModeContext = mode
    void vscode.commands.executeCommand('setContext', 'vsidian.activeMode', mode)
  }

  /** 活动面板的实际模式：宿主缓存的 view.state（缺省 live——面板装载完成前
   *  的安全假设，与 webview 全新面板默认一致） */
  const activePanelMode = (uriStr: string): 'live' | 'reading' | undefined => {
    const entry = sessions.get(uriStr)
    if (!entry) {
      return undefined
    }
    for (const [sessionId, panel] of entry.panels) {
      if (panel.active) {
        return entry.session.getViewState(sessionId)?.viewMode ?? 'live'
      }
    }
    return undefined
  }

  /** 按当前活动 tab 刷新 vsidian.activeMode（非本扩展面板活动时不动作：
   *  when 子句已被 activeCustomEditorId 关断，无需清值） */
  const refreshActiveModeContext = (): void => {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab
    const input = tab?.input
    if (input instanceof vscode.TabInputCustom && input.viewType === VIEW_TYPE) {
      const mode = activePanelMode(input.uri.toString())
      if (mode) {
        setActiveModeContext(mode)
      }
    }
  }

  /** view.state 回报链路（DocumentSession onViewState）：
   *  ① 初始 reading 恢复（#38）：记忆为 reading 的面板在首份回报后决定
   *     是否下发 view.mode.set——面板自身实际状态优先于全局记忆；
   *  ② 活动面板的模式回报刷新 vsidian.activeMode */
  const handlePanelViewState = (
    docUri: string,
    sessionId: string,
    state: Extract<WebviewToHost, { kind: 'view.state' }>,
  ): void => {
    const restoreKey = panelStateKey(docUri, sessionId)
    if (pendingReadingRestore.has(restoreKey)) {
      pendingReadingRestore.delete(restoreKey)
      if (decideReadingRestore(state.viewMode ?? 'live') === 'send-reading') {
        sessions.get(docUri)?.session.postToPanel(sessionId, {
          kind: 'view.mode.set',
          mode: 'reading',
        })
      }
    }
    if (sessions.get(docUri)?.panels.get(sessionId)?.active) {
      setActiveModeContext(state.viewMode ?? 'live')
    }
  }

  /** 本 uri 是否出现在任一 diff 标签（D10 弹回防御）：文本 diff 按
   *  original/modified 精确匹配；custom editor 在 diff 一侧时 input 不透明，
   *  按 label `a ↔ b` 一侧 basename 匹配 */
  const uriInDiffContext = (uri: vscode.Uri): boolean => {
    const tabs: DiffTabInfo[] = []
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input
        if (input instanceof vscode.TabInputTextDiff) {
          tabs.push({
            inputKind: 'text-diff',
            label: tab.label,
            original: input.original.toString(),
            modified: input.modified.toString(),
          })
        } else {
          tabs.push({ inputKind: tabInputKindOf(input), label: tab.label })
        }
      }
    }
    return isUriInDiffContext(uri.toString(), tabs)
  }

  const openEntry = (doc: vscode.TextDocument): SessionEntry => {
    const key = doc.uri.toString()
    let entry = sessions.get(key)
    if (entry) {
      return entry
    }
    const fresh: SessionEntry = { session: undefined as never, doc, panels: new Map(), appliedEdits: 0, linkLog: [] }
    const port: HostDocumentPort = {
      get version() {
        return doc.version
      },
      // #81 复制产物按权威文档行尾归一（documentSession 消费）
      eol: doc.eol as 1 | 2,
      getText: () => doc.getText(),
      applyChanges: async (changes: SerChange[]) => {
        const edit = new vscode.WorkspaceEdit()
        for (const c of changes) {
          edit.replace(
            doc.uri,
            new vscode.Range(doc.positionAt(c.offset), doc.positionAt(c.offset + c.length)),
            c.text,
          )
        }
        const ok = await vscode.workspace.applyEdit(edit)
        if (ok) {
          fresh.appliedEdits += 1
        }
        return ok
      },
      // 撤销/重做走宿主全局命令：活动编辑器为 CustomEditorInput 时，VSCode
      // 1.86 的 undo MultiCommand 含 custom-editor 实现（priority 105），直接
      // 调 undoRedoService.undo(resource) 作用于本文档的权威文本栈；产生的
      // 变更经 onDidChangeTextDocument 回流广播，不经过 applyEdit（无回声）。
      // C-5：webview 请求必须确认活动 tab 是本面板文档的 custom editor——
      // 全局命令作用于活动编辑器，归属不符时静默忽略（不得撤销其他文档）
      undo: async () => {
        if (!isActiveTabCustomEditorOf(vscode.window.tabGroups.activeTabGroup.activeTab, VIEW_TYPE, doc.uri.toString())) {
          return false
        }
        return vscode.commands.executeCommand('undo').then(() => true, () => false)
      },
      redo: async () => {
        if (!isActiveTabCustomEditorOf(vscode.window.tabGroups.activeTabGroup.activeTab, VIEW_TYPE, doc.uri.toString())) {
          return false
        }
        return vscode.commands.executeCommand('redo').then(() => true, () => false)
      },
    }
    // #201 图片周期核验与失效：会话按自身 linkCtx 解析图源目标（同一 src
    // 在不同文档指向不同文件——目标解析必须按文档）；决策与版本表在协调器
    fresh.session = new DocumentSession(port, {
      docUri: key,
      onNotice: (notice) => handleNotice(key, notice),
      onViewState: (sessionId, state) => handlePanelViewState(key, sessionId, state),
      isWindowsHost,
      verifyImages: (items) =>
        imageRefresh.verify(items, {
          resolveTarget: (src) => {
            const target = classifyImageTarget(src, linkContextOf(doc))
            return target.kind === 'workspace' ? target.fsPath : null
          },
        }),
      // #96 R1 ready 即校准：每次 ready 按当前生效语言幂等补发 locale.changed。
      // 供应式注入（会话保持纯逻辑）：与 HTML 数据岛注入同一解析
      // （hostLocale(getSnapshot())），未接线 settings 时按宿主显示语言解析
      requestLocale: () => {
        const locale = hostLocale(settings?.service.getSnapshot())
        return { lang: locale, messages: LOCALE_MESSAGES[locale] }
      },
    })
    sessions.set(key, fresh)
    return fresh
  }

  const releaseEntryIfIdle = (uri: vscode.Uri): void => {
    const entry = sessions.get(uri.toString())
    if (entry && entry.session.getInfo().panels.length === 0) {
      entry.session.dispose()
      sessions.delete(uri.toString())
    }
  }

  // ---- #11 双链跳转执行（ADR-0002：按需 findFiles 解析，不建持久索引） ----

  /** URI 的大小写差异不应让已打开的 Windows 文件面板漏命中。 */
  const findEntry = (uri: vscode.Uri): SessionEntry | undefined => {
    const exact = sessions.get(uri.toString())
    if (exact || process.platform !== 'win32' || uri.scheme !== 'file') return exact
    const fsPath = uri.fsPath.toLowerCase()
    return [...sessions.values()].find((entry) =>
      entry.doc.uri.scheme === 'file' && entry.doc.uri.fsPath.toLowerCase() === fsPath)
  }

  /** openWith 可能先返回、随后才注册新面板；按 URI 等待实际可投递面板。 */
  const waitForReadyPanel = async (
    uri: vscode.Uri,
    timeoutMs = 5000,
  ): Promise<{ entry: SessionEntry; sessionId: string } | undefined> => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const entry = findEntry(uri)
      const panel = entry?.session.getInfo().panels.find((p) => p.ready)
      if (panel) {
        return { entry: entry!, sessionId: panel.sessionId }
      }
      if (Date.now() > deadline) {
        return undefined
      }
      await new Promise((r) => setTimeout(r, 100))
    }
  }

  // ---- #197 反链面板：快照应答与条目跳转（面板级 UI 意图的执行体） ----

  /** 反链广播序号（review-loops #16）：按文档单调递增——快照应答为异步
   *  fire-and-forget，乱序完成时 webview 依 seq 丢弃降序帧 */
  const backlinksSeqByDoc = new Map<string, number>()

  /** 反链快照（backlinks.get 应答与 onChange 广播共用）：结果形态与
   *  backlinks.snapshot 协议一致（items 为空数组兜底） */
  const sendBacklinksSnapshot = async (
    entry: SessionEntry,
    sessionId: string,
    docUri: vscode.Uri,
  ): Promise<void> => {
    const docUriStr = docUri.toString()
    const seq = (backlinksSeqByDoc.get(docUriStr) ?? 0) + 1
    backlinksSeqByDoc.set(docUriStr, seq)
    if (!vaultIndex) {
      entry.session.postToPanel(sessionId, {
        kind: 'backlinks.snapshot',
        docUri: docUriStr,
        state: 'error',
        reason: 'no-workspace',
        items: [],
        seq,
      })
      return
    }
    const result = await vaultIndex.backlinksOf(docUri.fsPath)
    entry.session.postToPanel(sessionId, {
      kind: 'backlinks.snapshot',
      docUri: docUriStr,
      state: result.status,
      updating: result.status === 'ready' ? result.updating : undefined,
      reason: result.status === 'error' ? result.reason : undefined,
      items: result.status === 'ready'
        ? result.items.map((item) => ({
          sourceRelPath: item.sourceRelPath,
          sourceFsPath: item.sourceFsPath,
          kind: item.kind,
          anchor: item.anchor,
          start: item.start,
          end: item.end,
          line: item.line,
          snippet: item.snippet,
        }))
        : [],
      seq,
    })
  }

  /** 反链条目跳转：打开来源文档（Vsidian 面板）并定位到出链标记——
   *  openWith 对已开面板是重显；offset 为来源正文 LF 偏移（宿主抽取侧
   *  已归一），直接作 view.locate 输入（webview 全程 LF 坐标）。
   *  sourceUri 是平台分隔符 fsPath 形态（快照载荷原样回传），经
   *  Uri.file 解析（Uri.parse 会把反斜杠当 URI 字符错误编码） */
  const openBacklinkSource = async (sourceUri: string, offset: number): Promise<void> => {
    const uri = vscode.Uri.file(sourceUri)
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE)
    const ready = await waitForReadyPanel(uri)
    if (ready) {
      ready.entry.session.postToPanel(ready.sessionId, { kind: 'view.locate', offset })
    }
  }

  /**
   * 双链跳转执行（#11；#159 块引用定位与本文件锚点；#196 根内相对路径
   * 解析）：目标一律按来源文档相对路径解析（shared/vaultLink，docDir 基准、
   * 越出所属根拦截、多根互不补查），经 fs.stat 端口探测存在性后打开并定位
   * 锚点（标题或块 id，互斥）。
   * 空 path（[[#标题]] / [[#^块id]]）：目标即当前文档，不查文件。
   * 目标一律由 Vsidian 面板打开（vscode.openWith 对已开面板是重显），
   * 面板就绪后发 view.locate；reading 模式经 #14 的块挂载定位。
   * 全程只读：不触碰 TextDocument、不建索引、不自动创建文件。
   * basename 全根搜索、根相对双候选与 QuickPick 同名选择已随 #196 废除。
   */
  const executeWikilinkIntent = async (
    document: vscode.TextDocument,
    intent: { target: string; srcStart: number; srcEnd: number },
    log: Array<LinkLogEntry | WikilinkLogEntry>,
  ): Promise<void> => {
    const pushLog = (entry: WikilinkLogEntry): void => {
      log.push(entry)
      while (log.length > 64) {
        log.shift()
      }
    }
    const parsed = parseWikilinkInner(intent.target.trim())
    if (!parsed) {
      pushLog({ kind: 'wikilink-unsupported', target: intent.target })
      void vscode.window.showWarningMessage(
        t('host.wikilinkUnsupported', { target: intent.target }),
      )
      return
    }
    // #159 本文件锚点（[[#标题]] / [[#^块id]]）：path 为空串，目标即当前文档
    // ——不查工作区、无候选选择（与无工作区提示无关）
    let targetPath: string
    if (parsed.path === '') {
      targetPath = document.uri.fsPath
    } else {
      // #196 根内相对路径解析：docDir 为基准、所属根（嵌套根取最具体——
      // getWorkspaceFolder 返回最内层 folder）为边界，越出即拦截；存在性经
      // fs.stat 端口探测（大小写语义由宿主文件系统裁决：NTFS 不敏感/POSIX 严格）
      const folder = vscode.workspace.getWorkspaceFolder(document.uri)
      const ctx: VaultLinkResolveContext = {
        docDir: path.dirname(document.uri.fsPath),
        rootDir: (folder ? folder.uri : vscode.Uri.joinPath(document.uri, '..')).fsPath,
        isWindowsHost: process.platform === 'win32',
        hasWorkspace: folder !== undefined,
      }
      const resolution = await resolveVaultLinkFile(parsed.path, ctx, statFileRealPath)
      if (resolution.kind === 'no-workspace') {
        pushLog({ kind: 'wikilink-no-workspace', target: parsed.path })
        void vscode.window.showWarningMessage(t('host.wikilinkNoWorkspace'))
        return
      }
      if (resolution.kind === 'escape') {
        pushLog({ kind: 'wikilink-outside-root', target: parsed.path })
        void vscode.window.showWarningMessage(t('host.wikilinkOutsideRoot', { target: parsed.path }))
        return
      }
      if (resolution.kind === 'not-found') {
        pushLog({ kind: 'wikilink-not-found', target: parsed.path, heading: parsed.heading ?? undefined })
        void vscode.window.showWarningMessage(
          t('host.wikilinkNotFound', { target: parsed.path }),
        )
        return
      }
      targetPath = resolution.fsPath
    }

    const targetUri = vscode.Uri.file(targetPath)
    // 回显拼锚点原文（path 空时即 [[#标题]] / [[#^块ID]]）
    const display = `[[${parsed.path}${
      parsed.heading !== null
        ? `#${parsed.heading}`
        : parsed.blockId !== null
          ? `#^${parsed.blockId}`
          : ''
    }]]`
    // 锚点定位（#159：标题→findHeadingOffset、块 id→findBlockOffset，互斥）：
    // 先读目标内容算 offset（openTextDocument 只装载不显示）。offset 是宿主系
    // （getText 保留 \r\n），发 view.locate 前须转 LF 系（见下）
    let anchorOffset: { offset: number; end: number } | null = null
    let anchorMissing = false
    let anchorDoc: vscode.TextDocument | undefined
    if (parsed.heading !== null || parsed.blockId !== null) {
      anchorDoc = await vscode.workspace.openTextDocument(targetUri)
      const text = anchorDoc.getText()
      anchorOffset =
        parsed.heading !== null
          ? findHeadingOffset(text, parsed.heading)
          : findBlockOffset(text, parsed.blockId!)
      anchorMissing = anchorOffset === null
    }

    // 日志先于打开动作，保留源面板会话中的跳转记录。
    pushLog({
      kind: 'wikilink-doc',
      target: parsed.path,
      path: targetPath,
      heading: parsed.heading ?? undefined,
      blockId: parsed.blockId ?? undefined,
      locate: anchorOffset ? 'custom-panel' : 'none',
    })
    // CRLF 目标先转 LF 坐标。面板重载期间丢失的首投由 DocumentSession
    // 在重握手后补发，送达确认后不再重播历史定位。
    await vscode.commands.executeCommand('vscode.openWith', targetUri, VIEW_TYPE)
    if (anchorOffset && anchorDoc) {
      const ready = await waitForReadyPanel(targetUri)
      if (ready) {
        const lfOffset = new NewlineCoordinator(anchorDoc.getText()).hostOffsetToLf(anchorOffset.offset)
        ready.entry.session.postToPanel(ready.sessionId, { kind: 'view.locate', offset: lfOffset })
      }
    }
    if (anchorMissing) {
      // 缺失反馈与打开同款「打开后提示」语义（规格 2026-09-28 决策 4）
      if (parsed.heading !== null) {
        void vscode.window.showWarningMessage(
          t('host.wikilinkHeadingMissing', { link: display, heading: parsed.heading }),
        )
      } else {
        void vscode.window.showWarningMessage(
          t('host.wikilinkBlockMissing', { link: display, blockId: parsed.blockId ?? '' }),
        )
      }
    }
  }

  const provider: vscode.CustomTextEditorProvider = {
    resolveCustomTextEditor(document, webviewPanel, _token): void {
      // #38：全局记忆为 source 时弹回原生编辑器——priority=default 后 VSCode
      // 默认把 .md 交给本扩展，用户上次停留在源码态则还原该选择。早退：
      // 不建会话、不写 HTML、不 attach 面板（面板 dispose 链路自然回收）；
      // 弹回动作不写记忆。用户显式「Reopen With → Vsidian」时同样被弹回，
      // 属接受的代价（可点标题栏铅笔按钮一步切回，见工单 #38）。
      // D10：本 uri 处于任一 diff 标签时跳过弹回、正常装配——openWith 会
      // 把对比折叠成单文件，diff 完整性优先于模式记忆；跳过不改写记忆
      const remembered = readRemembered()
      const resolveBehavior = decideResolveBehavior(remembered, uriInDiffContext(document.uri))
      if (resolveBehavior === 'bounce-to-source') {
        // 弹回：resolve 运行在 custom input 的 open 管线内，立即操纵标签
        // 会与管线完成时的激活意图竞态（实测 flaky：原生 tab 的激活可被本
        // custom tab 反超或被后续激活覆盖，空白面板滞留并占据活动位，且会
        // 被后续 openWith 重显成永不就绪的面板）。故延迟到本面板激活事件
        // （open 管线收尾的标志）后再弹回；showTextDocument 物化原生编辑器
        // 控件（openWith('default') 对已存在原生 tab 的 reveal 偶发只置活动
        // 标记不物化，实测 activeTextEditor 为空），原生激活后本面板已非活动，
        // dispose 无再激活副作用。preview:false 与 openWith 的 pinned:true
        // 同语义；closeStaleTabs 作残余清扫
        const bounceToSource = (): void => {
          // showTextDocument 返回 1.86 的 Thenable（无 .catch），async 包装
          void (async (): Promise<void> => {
            try {
              await vscode.window.showTextDocument(document, { preview: false })
              // dirty 时跳过 dispose：1.86.2 关 dirty tab 会 revert
              // TextDocument（集成实测，已装配面板的 custom 侧亦然）——Hot
              // Exit 恢复 dirty 面板或原生 dirty + Reopen With 均可达此处。
              // 空面板 dispose 虽实测未触发 revert，但那是无守护的宿主行为
              // 细节；统一走 dirty 保留口径（空面板留存为已知代价，见
              // mvp.md），保存后再次切换复用清理收敛
              if (!document.isDirty) {
                webviewPanel.dispose()
              }
              await closeStaleTabs(document.uri, 'text')
            } catch {
              // showTextDocument 失败（uri 失效/宿主竞态）：dispose 幂等兜底
              // 清场，避免空白面板滞留；面板此时无 dirty 语义，直接可关
              webviewPanel.dispose()
            }
          })()
        }
        if (webviewPanel.active) {
          bounceToSource()
        } else {
          const activateSub = webviewPanel.onDidChangeViewState((e) => {
            if (!e.webviewPanel.active) {
              return
            }
            activateSub.dispose()
            bounceToSource()
          })
          const closeSub = webviewPanel.onDidDispose(() => {
            activateSub.dispose()
            closeSub.dispose()
          })
        }
        return
      }
      const entry = openEntry(document)
      const send = (message: HostToWebview): void => {
        void webviewPanel.webview.postMessage(message)
      }
      // ---- #10 链接跳转与图片资源执行（面板端口注入；URI 解析在宿主侧） ----
      const linkCtx = linkContextOf(document)
      const openLink = (intent: { href: string; srcStart: number; srcEnd: number }): void => {
        // #160 锚点落位的面板双路依赖（会话表 + 就绪等待）经端口注入：
        // executeLinkIntent 保持模块级（与 vscode 层纯函数分工一致）
        void executeLinkIntent(document, linkCtx, intent, entry.linkLog, {
          waitForReadyPanel,
        })
      }
      // #11 双链跳转执行端口（按需 findFiles 解析 + 打开/定位/反馈）
      const openWikilink = (intent: { target: string; srcStart: number; srcEnd: number }): void => {
        void executeWikilinkIntent(document, intent, entry.linkLog)
      }
      const resolveImage = async (src: string): Promise<ImageResolution> => {
        return resolveWorkspaceImage(src, linkCtx, webviewPanel.webview, imageRefresh.versions)
      }
      const sessionId = entry.session.attachPanel({
        send,
        openLink,
        openWikilink,
        resolveImage,
        // #33 设置端口：工具栏 settings.open 与 init 后 settings.get 的
        // 面板级处理（与 link.activate 同模式；settings.set 只存在于
        // 设置页 webview 链路，不经文档会话）
        openSettings: () => settings?.page.open(),
        requestSettings: () => settings?.service.getSnapshot() ?? {},
        // #128 CSS 片段端口：init 后 snippets.get 的面板级应答（清单 URI
        // 逐面板构造）与片段链装载结果回报（失败提示；只读交互）
        requestSnippets: () => buildSnippetLinkList(snippets, webviewPanel.webview),
        onSnippetLoad: (name, version, ok) => notifySnippetLoad(name, version, ok),
        // #69 剪贴板端口：webview 无 navigator.clipboard 权限面，经宿主
        // env.clipboard.writeText。标题链接变体在此拼 `[[笔记名#标题]]`——
        // 笔记名 = docUri 文件名去扩展名（Obsidian 语义），标题为 webview
        // 上报的条目原文（含行内标记，与 findHeadingOffset 的字面比较同源）。
        // #81 代码块复制同走 writeClipboard（text 已由会话按文档 EOL 归一）
        writeClipboard: (text: string) => {
          void vscode.env.clipboard.writeText(text)
        },
        writeHeadingLinkClipboard: (docUri: string, heading: string) => {
          void vscode.env.clipboard.writeText(
            `[[${outlineNoteNameOf(docUri)}#${outlineLinkHeading(heading)}]]`,
          )
        },
        // #162 块链接变体：拼 `[[笔记名#^块id]]`（笔记名与标题链接同源；
        // 块 id 字符集 [A-Za-z0-9-] 不含 ] | # ^，无转义议题）
        writeBlockLinkClipboard: (docUri: string, blockId: string) => {
          void vscode.env.clipboard.writeText(
            `[[${outlineNoteNameOf(docUri)}#^${blockId}]]`,
          )
        },
        // #111 图表导出端口：弹窗工具条 → 载荷校验 + showSaveDialog +
        // writeFile，结果经 diagram.export.result 回来源面板。测试钩子
        // 模式（VSIDIAN_TEST_HOOKS）短路真实对话框：记录消息形态供集成
        // 断言，回报 cancelled（与用户取消同回报形态）
        exportDiagram: (payload, report) => {
          if (process.env.VSIDIAN_TEST_HOOKS === '1') {
            const key = document.uri.toString()
            const log = diagramExportTestLog.get(key) ?? []
            log.push(payload)
            diagramExportTestLog.set(key, log)
            report({ ok: false, reason: 'cancelled' })
            return
          }
          void runDiagramExport(payload, document.uri.toString(), report)
        },
        // #161 图片粘贴落盘端口：读设置快照 → 目录解析（URI path 空间）→
        // 建目录/写盘 → 回发插入文本。测试钩子模式记录载荷形态但不短路
        // 落盘（无对话框依赖，真实写盘可断言）
        pasteImage: (payload, report: (result: ImagePasteOutcome) => void) => {
          if (process.env.VSIDIAN_TEST_HOOKS === '1') {
            const key = document.uri.toString()
            const log = imagePasteTestLog.get(key) ?? []
            log.push(payload)
            imagePasteTestLog.set(key, log)
          }
          void runImagePaste(
            payload,
            {
              settings: settings?.service.getSnapshot() ?? {},
              docUri: document.uri,
              workspaceRootPath:
                vscode.workspace.getWorkspaceFolder(document.uri)?.uri.path ?? null,
            },
            report,
          )
        },
      })
      entry.panels.set(sessionId, webviewPanel)
      // #38：记忆为 reading 的面板登记待恢复——就绪后首份 view.state 到达
      // 时按「面板自身状态优先」决定是否下发 view.mode.set: reading
      if (resolveBehavior === 'restore-reading') {
        pendingReadingRestore.add(panelStateKey(document.uri.toString(), sessionId))
      }

      const messageSub = webviewPanel.webview.onDidReceiveMessage((message) => {
        if (isWebviewToHost(message) && message.kind === 'keybindings.get') {
          void webviewPanel.webview.postMessage({
            kind: 'keybindings.snapshot', overrides: settings?.keybindings.getSnapshot() ?? {},
          })
          return
        }
        if (isWebviewToHost(message) && message.kind === 'keybindings.execute') {
          const operation = KEYBINDING_OPERATIONS.find((op) => op.id === message.id)
          const mode = entry.session.getViewState(sessionId)?.viewMode ?? 'live'
          if (operation && webviewPanel.active &&
            (operation.mode === 'both' || operation.mode === mode) &&
            (!operation.writes || (mode === 'live' &&
              vscode.workspace.fs.isWritableFileSystem(document.uri.scheme) !== false))) {
            void vscode.commands.executeCommand(operation.command)
          }
          return
        }
        // #141 工具栏双态切换按钮：target 由 webview 按自身 viewMode 求值
        // （另一态），宿主复用 runViewSwitch 全套编排（模式记忆、diff 防御、
        // context 刷新、view.mode.set 回流驱动按钮态）。双态裁剪即 target
        // 域只 live/reading（协议校验拒绝 source），源码路径不经本消息
        if (isWebviewToHost(message) && message.kind === 'view.switch.request') {
          void runViewSwitch(message.target, document.uri)
          return
        }
        // #197 反链面板：面板级 UI 意图在 provider 层拦截（索引服务与跳转
        // 执行都在 provider 域；session 对这两类消息显式 return 保持穷尽）
        if (vaultIndex && isWebviewToHost(message) && message.kind === 'backlinks.get' &&
          message.docUri === document.uri.toString()) {
          void sendBacklinksSnapshot(entry, sessionId, document.uri)
          return
        }
        if (isWebviewToHost(message) && message.kind === 'backlink.activate') {
          void openBacklinkSource(message.sourceUri, message.offset)
          return
        }
        if (process.env.VSIDIAN_TEST_HOOKS === '1' && isWebviewToHost(message) &&
          message.kind === 'sync.test.close' && message.sessionId === sessionId &&
          message.docUri === document.uri.toString()) {
          webviewPanel.dispose()
          return
        }
        void entry.session.handleWebviewMessage(message, sessionId)
      })
      // #38：面板激活（tab 切换/分组聚焦）时刷新活动模式 context——
      // custom editor 不触发 onDidChangeActiveTextEditor，靠此事件覆盖
      const viewStateSub = webviewPanel.onDidChangeViewState((e) => {
        if (e.webviewPanel.active) {
          refreshActiveModeContext()
        }
      })
      const closeSub = webviewPanel.onDidDispose(() => {
        entry.session.detachPanel(sessionId)
        entry.panels.delete(sessionId)
        pendingReadingRestore.delete(panelStateKey(document.uri.toString(), sessionId))
        messageSub.dispose()
        viewStateSub.dispose()
        closeSub.dispose()
        releaseEntryIfIdle(document.uri)
      })

      // C-7：显式收紧资源根到扩展产物与样式目录（脚本/CSS 均在其内），
      // 不留整个扩展目录的默认可读面；#10 增补图片资源根（工作区文件
      // 经夹带 asWebviewUri 的地址需在许可面内——口径与路径白名单一致）；
      // #128 增补 CSS 片段目录（须在 html 赋值前设置——webview.options
      // 是 html 装载时的资源许可面快照）
      webviewPanel.webview.options = {
        enableScripts: true,
        localResourceRoots: editorResourceRoots(context, document, snippets?.getState().directory ?? null),
      }
      webviewPanel.webview.html = buildWebviewHtml(
        webviewPanel.webview,
        context.extensionUri,
        // #93 生效语言：读语言设置（#4 注册 general.language 前缺省 auto）
        // 按宿主显示语言解析；数据岛注入当前语言包（webview 零字典字节）
        hostLocale(settings?.service.getSnapshot()),
      )
    },
  }

  // 权威文档变更入口：一切来源（本扩展写回、原生编辑器、其他扩展、
  // undo/redo）的变更都进入 session 识别与广播
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      // #197 索引覆盖层：消费原始事件（不经 session 产物——任何编辑器打开
      // 的 .md 都是索引来源域）；服务内做版本仲裁与去抖，未保存内容不落盘
      if (vaultIndex && event.document.uri.scheme === 'file' && /\.md$/i.test(event.document.uri.path)) {
        vaultIndex.applyUnsaved(
          event.document.uri.fsPath,
          event.document.version,
          event.document.getText(),
        )
      }
      const entry = getEntry(event.document.uri)
      if (!entry) {
        return
      }
      entry.session.handleDocChanged(
        event.contentChanges.map((c) => ({
          offset: c.rangeOffset,
          length: c.rangeLength,
          text: c.text,
        })),
        event.document.version,
      )
    }),
  )

  // ---- #197 索引：保存事件（磁盘基线重扫 + 覆盖层退役；服务内合并提交
  //  快照）。外部修改经服务自身的 watcher 端口到达（onDidChange 对外部
  //  工具不可见，watcher 兜底） ----
  if (vaultIndex) {
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (document.uri.scheme === 'file' && /\.md$/i.test(document.uri.path)) {
          void vaultIndex.documentSaved(document.uri.fsPath)
        }
      }),
    )
    // 文档关闭退役（review-loops #18）：编辑后不保存关闭的面板，其 unsaved
    // 全文与覆盖层边随文档关闭退场（否则幽灵反链滞留至下次保存/重扫）。
    // 同文档仍有 Vsidian 面板（自定义编辑器持有文档）时不退役——面板侧
    // 仍有当前内容域；findEntry（非精确 getEntry）做 Windows 大小写容错
    // ——URI 形态漂移时不得误判「无面板」而提前退役。退役同时清理该文档
    // 的反链广播序号（backlinksSeqByDoc，键与 sessions 同源——面板打开时
    // 的 uri 形态；onDidClose 的 document.uri 为同一 TextDocument，恒命中）
    context.subscriptions.push(
      vscode.workspace.onDidCloseTextDocument((document) => {
        if (document.uri.scheme !== 'file' || !/\.md$/i.test(document.uri.path)) {
          return
        }
        if (findEntry(document.uri)) {
          return
        }
        backlinksSeqByDoc.delete(document.uri.toString())
        vaultIndex.documentClosed(document.uri.fsPath)
      }),
    )
  }

  // ---- 设置变更广播（#33）：宿主保存成功后把新快照推给全部已打开
  // Vsidian 编辑器面板（复用 toggleViewMode 的全 session 遍历样板）。
  // #34 起消费方按需读取关心的键（如 editor.lineNumbers 热重配 CM6）----
  if (settings) {
    // #96 语言变化检测基线：与 activate 的宿主装配同式计算（读快照偏好按
    // 宿主显示语言解析）。解析结果不变的偏好变化（如 en 宿主下 auto→en）
    // 不触发换包——界面语言实际未变
    let lastLocale = hostLocale(settings.service.getSnapshot())
    const offSettings = settings.service.onChange((values) => {
      for (const entry of sessions.values()) {
        for (const panel of entry.session.getInfo().panels) {
          if (panel.ready) {
            entry.session.postToPanel(panel.sessionId, { kind: 'settings.changed', values })
          }
        }
      }
      // #96 切换即生效：检测到生效语言变化 → 宿主先换包（后续通知/确认框
      // 即时取新词），再向全部 ready 编辑器面板与设置页广播 locale.changed
      // （携完整新语言包，webview 原子换包 + 重渲染常驻文本 + <html lang>）。
      // 不提供重载窗口降级；设置页标题由 notifyLocaleChanged 同步
      const locale = hostLocale(values)
      if (locale !== lastLocale) {
        lastLocale = locale
        installHostLocale(locale)
        for (const entry of sessions.values()) {
          for (const panel of entry.session.getInfo().panels) {
            if (panel.ready) {
              entry.session.postToPanel(panel.sessionId, {
                kind: 'locale.changed',
                lang: locale,
                messages: LOCALE_MESSAGES[locale],
              })
            }
          }
        }
        settings.page.notifyLocaleChanged(locale)
      }
    })
    context.subscriptions.push({ dispose: () => offSettings() })
    const offKeys = settings.keybindings.onChange((overrides) => {
      for (const entry of sessions.values()) {
        for (const panel of entry.session.getInfo().panels) {
          if (panel.ready) entry.session.postToPanel(panel.sessionId,
            { kind: 'keybindings.changed', overrides })
        }
      }
    })
    context.subscriptions.push({ dispose: () => offKeys() })
  }

  // ---- #128 CSS 片段：装载失败提示（按 片段+版本 去重——多面板各自回报
  //  同一失败不重复打扰）----
  const snippetLoadNotified = new Map<string, number>()
  const notifySnippetLoad = (name: string, version: number, ok: boolean): void => {
    if (ok) {
      snippetLoadNotified.delete(name)
      return
    }
    if (snippetLoadNotified.get(name) === version) {
      return
    }
    snippetLoadNotified.set(name, version)
    void vscode.window.showWarningMessage(t('host.cssSnippetLoadFailed', { name }))
  }

  // ---- #128 CSS 片段状态广播（照 settings.changed 全面板遍历样板）----
  if (snippets) {
    // 上次广播时的目录：资源许可面（localResourceRoots）只在目录变化时刷新
    // ——开关/内容刷新无需重赋 webview.options（重赋可能触发 webview 资源
    // 状态重置；扫描失败保留最近成功样式的语义不允许额外扰动）
    let lastSnippetDirectory = snippets.getState().directory
    const offSnippets = snippets.onChange((state) => {
      const directoryChanged = state.directory !== lastSnippetDirectory
      lastSnippetDirectory = state.directory
      for (const entry of sessions.values()) {
        for (const [sessionId, panel] of entry.panels) {
          // 换目录后已开面板的资源许可面同步刷新：webview.options 可在运行
          // 期重新赋值，资源服务按请求时点的 roots 校验（集成用例覆盖
          // 「换目录后旧面板能加载新目录资源」）
          if (directoryChanged) {
            panel.webview.options = {
              enableScripts: true,
              localResourceRoots: editorResourceRoots(context, entry.doc, state.directory),
            }
          }
          if (entry.session.getInfo().panels.some((p) => p.sessionId === sessionId && p.ready)) {
            void panel.webview.postMessage({
              kind: 'snippets.snapshot',
              ...buildSnippetLinkList(snippets, panel.webview),
            })
          }
        }
      }
      settings?.page.notifySnippetsChanged()
    })
    context.subscriptions.push({ dispose: () => offSnippets() })
  }

  // ---- #197 反链快照广播：索引模型变化（覆盖层更新/重扫/重建完成）→
  //  全部 ready 面板各自文档的反链快照（面板按 docUri 匹配丢弃他文档快照；
  //  notify 已在服务侧合并——覆盖层 500ms 去抖、重扫 800ms 去抖、快照提交
  //  1.5s 合并，无逐键广播）----
  if (vaultIndex) {
    const offIndex = vaultIndex.onChange(() => {
      for (const entry of sessions.values()) {
        for (const panel of entry.session.getInfo().panels) {
          if (panel.ready) {
            void sendBacklinksSnapshot(entry, panel.sessionId, entry.doc.uri)
          }
        }
      }
    })
    context.subscriptions.push({ dispose: () => offIndex() })
  }

  // ---- 三态视图切换（#38）：标题栏三命令（toReading/toSource/toLive）与
  //  命令面板命令共用编排；onegayi.vsidian.toggleViewMode 保留 id，语义
  //  升级为三态循环。模式是 webview 视图状态，切换不写 TextDocument ----

  /** 活动标签的模式推导：本扩展面板取活动面板缓存（缺省 live）；原生
   *  .md/.markdown 文本编辑器为 source（优先读活动 tab 的 TabInputText——
   *  activeTextEditor 在 1.86.2 双标签脏态保存后可为空（保存会把活动位翻
   *  到原生 tab 而不物化控件，实测），不能作为唯一依据）；其余语境不可切换 */
  const deriveActiveTabMode = (): { mode: TriViewMode; uri: vscode.Uri } | undefined => {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab
    const input = tab?.input
    if (input instanceof vscode.TabInputCustom && input.viewType === VIEW_TYPE) {
      return { mode: activePanelMode(input.uri.toString()) ?? 'live', uri: input.uri }
    }
    if (input instanceof vscode.TabInputText && isMarkdownFile(input.uri)) {
      return { mode: 'source', uri: input.uri }
    }
    const editor = vscode.window.activeTextEditor
    if (editor && isMarkdownFile(editor.document.uri)) {
      return { mode: 'source', uri: editor.document.uri }
    }
    return undefined
  }

  /** #38 单标签清理的 uri 等值判定：Windows 下 Tab API 与 TextDocument
   *  对同一资源的盘符大小写不稳定（实测同一文档在两个 surface 分别为
   *  /C:/ 与 /c:/，取决于 tab 的创建路径），按宿主平台归一化比较
   *  （POSIX 宿主保持大小写敏感） */
  const isSameDocUri = (a: vscode.Uri, b: vscode.Uri): boolean => {
    const x = a.toString()
    const y = b.toString()
    // darwin 默认文件系统（APFS）大小写不敏感，与 win32 同归一化；
    // POSIX（linux 远程宿主）保持大小写敏感
    const caseInsensitive = process.platform === 'win32' || process.platform === 'darwin'
    return caseInsensitive ? x.toLowerCase() === y.toLowerCase() : x === y
  }

  /** 1.86 的 vscode.openWith 对「同资源不同编辑器」是新开 tab 而非原位
   *  替换（实测；T1 查证 1.86.0 源码：workbench.action.reopenWithEditor 虽
   *  内部走 replaceEditors，但硬编码 override: EditorResolution.PICK 必弹
   *  用户选择器，没有可编程指定目标编辑器的命令形态）——切换后关闭被替换
   *  的旧 tab 完成原位切换体验。旧 tab 覆盖两类：本扩展 custom tab（toSource
   *  与弹回方向）与原生文本 tab（toLive 方向，#38 修复源码态与预览态并存
   *  双标签）。
   *  expectKind 为新编辑器的 tab 形态：新 tab 的激活可能晚于打开动作返回
   *  （弹回链路实测在激活前清理会误关刚开的原生 tab），先等它成为活动
   *  tab 再清理其余非活动 tab；等待超时则本次放弃清理（残留旧 tab 不影响
   *  新视图，下次切换复用清理）。
   *  dirty：1.86.2 关闭带未保存内容的旧 tab 会把 TextDocument revert 回
   *  磁盘内容——custom 与原生两个方向皆然，且与另一编辑器是否已打开同一
   *  文档无关（集成用例 A/B 实测裁决）。dirty 时保守保留旧 tab（双标签为
   *  已知代价，见 mvp.md），保存后再次切换复用本清理。检查在入口与每次
   *  关闭前各做一次——等待激活的窗口（上限 3 秒）内文档可能被用户改脏，
   *  入口快照会过时。
   *  并发防御：只清理发起时已存在的 tab（快照）——快速连点三态按钮时，
   *  另一方向的清理会撞上本方向刚创建、尚未激活的新 tab，无快照会把它
   *  误关（用户停在错误视图）。其他组的活动 tab 不清理：split 布局是用户
   *  刻意摆放的视图，切换命令只收敛发起时可见的旧标签 */
  const closeStaleTabs = async (uri: vscode.Uri, expectKind: 'text' | 'custom'): Promise<void> => {
    const docDirty = (): boolean =>
      vscode.workspace.textDocuments.some((d) => isSameDocUri(d.uri, uri) && d.isDirty)
    if (docDirty()) {
      return
    }
    const knownTabs = new Set(vscode.window.tabGroups.all.flatMap((g) => [...g.tabs]))
    const deadline = Date.now() + 3000
    for (;;) {
      const active = vscode.window.tabGroups.activeTabGroup.activeTab
      const activeInput = active?.input
      const newTabActive =
        expectKind === 'text'
          ? activeInput instanceof vscode.TabInputText &&
            isSameDocUri(activeInput.uri, uri)
          : activeInput instanceof vscode.TabInputCustom &&
            activeInput.viewType === VIEW_TYPE &&
            isSameDocUri(activeInput.uri, uri)
      if (newTabActive) {
        break
      }
      if (Date.now() > deadline) {
        return
      }
      await new Promise((r) => setTimeout(r, 50))
    }
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (!knownTabs.has(tab)) {
          continue
        }
        const input = tab.input
        const staleCustom =
          input instanceof vscode.TabInputCustom &&
          input.viewType === VIEW_TYPE &&
          isSameDocUri(input.uri, uri)
        const staleNative =
          input instanceof vscode.TabInputText &&
          isSameDocUri(input.uri, uri)
        if (tab !== group.activeTab && (staleCustom || staleNative)) {
          if (docDirty()) {
            return
          }
          try {
            await vscode.window.tabGroups.close(tab)
          } catch {
            // 新编辑器已就位，残留 tab 不影响切换结果
          }
        }
      }
    }
  }

  /** 向该文档全部就绪面板下发 view.mode.set（open-in-vsidian 与
   *  switch-panel-mode 共用）。openWith 对已存在的同 viewType 面板是重显
   *  （不重置模式）：显式目标命令须把重显面板也切到目标模式（全新面板经
   *  resolve 恢复链路落到目标模式，open-in-vsidian 分支的补发为同值幂等） */
  const postModeToReadyPanels = (uri: vscode.Uri, mode: 'live' | 'reading'): void => {
    const entry = getEntry(uri)
    const panels = entry?.session.getInfo().panels.filter((p) => p.ready) ?? []
    for (const panel of panels) {
      entry!.session.postToPanel(panel.sessionId, {
        kind: 'view.mode.set',
        mode,
      })
    }
  }

  /** 落位原生源码编辑器（#38）：经文本编辑器管线（openTextDocument +
   *  showTextDocument）而非 openWith('default')——后者对「原生 tab 已存在」
   *  的 reveal 偶发只置活动标记而不重建编辑器控件（实测 activeTextEditor/
   *  visibleTextEditors 皆空）；showTextDocument 强制原生（EXCLUSIVE_ONLY）
   *  并返回 TextEditor，控件必然物化。preview:false 与 openWith 的
   *  pinned:true 同语义（不产生预览态标签） */
  const ensureSourceEditor = async (uri: vscode.Uri): Promise<boolean> => {
    const doc = await vscode.workspace.openTextDocument(uri)
    await vscode.window.showTextDocument(doc, { preview: false })
    await closeStaleTabs(uri, 'text')
    return true
  }

  /** 执行动作计划。记忆写入时序（viewCycle 模块约定）：open-in-vsidian
   *  必须先写记忆再 openWith（resolve 的弹回/恢复读最新记忆，后写会被
   *  弹回或落到错误模式）；其余动作成功后写 */
  const applyViewSwitch = async (uri: vscode.Uri, plan: ViewSwitchPlan): Promise<boolean> => {
    switch (plan.kind) {
      case 'open-in-vsidian': {
        await writeRemembered(plan.mode)
        await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE)
        // #38 单标签：关闭被替换的旧原生 tab（dirty 保留，见 closeStaleTabs
        // 注释）
        await closeStaleTabs(uri, 'custom')
        // 重显面板的模式补发语义见 postModeToReadyPanels
        postModeToReadyPanels(uri, plan.mode)
        return true
      }
      case 'open-in-source-editor': {
        await ensureSourceEditor(uri)
        await writeRemembered('source')
        return true
      }
      case 'switch-panel-mode': {
        postModeToReadyPanels(uri, plan.mode)
        await writeRemembered(plan.mode)
        return true
      }
      case 'reject': {
        // 提示不阻塞命令返回：showWarningMessage 的 Promise 在用户交互前
        // 不 resolve，await 会让命令调用方（键绑/测试/其他扩展）挂起
        void vscode.window.showWarningMessage(
          plan.reason === 'diff-context'
            ? t('host.rejectDiffContext')
            : plan.reason === 'panel-not-ready'
              ? t('host.rejectPanelNotReady')
              : t('host.rejectAlreadySource'),
        )
        return false
      }
    }
  }

  /** 三态切换主入口：explicitTarget 缺省时按循环推导下一模式。
   *  commandUri 为 editor/title 菜单传入的资源（命令面板无）：diff 语境
   *  检测中用于不透明标签一侧的 basename 匹配（D10） */
  const runViewSwitch = async (
    explicitTarget?: TriViewMode,
    commandUri?: vscode.Uri,
  ): Promise<boolean> => {
    // D10 前置守卫：活动标签处于 diff 语境（文本 diff 或 custom editor 在
    // diff 一侧的不透明标签）时拒绝——openWith 会把对比折叠成单文件
    const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab
    const inDiffContext = activeTab
      ? isDiffContext({
          inputKind: tabInputKindOf(activeTab.input),
          label: activeTab.label,
          contextUri: commandUri?.toString(),
        })
      : false
    const active = deriveActiveTabMode()
    if (!active) {
      // 同 reject 分支：提示不阻塞命令返回
      void vscode.window.showWarningMessage(t('host.noActiveMarkdown'))
      return false
    }
    const target = explicitTarget ?? nextTriMode(active.mode)
    // 已在源码态的显式 toSource：不做纯 no-op——双标签脏态下保存会把活动
    // 位翻到原生 tab 而不物化编辑器控件（1.86.2 实测 activeTextEditor 为
    // 空，模式推导因此只能依赖 tab input），此路径 re-affirm 落位控件并
    // 复用单标签清理；健康状态下为幂等操作（重激活 + 空清扫）。diff 语境
    // 仍走 planViewSwitch 的拒绝（D10 守卫不得被绕过——diff 侧 activeTextEditor
    // 也是 .md 文档，不门控会落位原生编辑器毁掉对比视图）
    if (!inDiffContext && active.mode === 'source' && target === 'source') {
      await ensureSourceEditor(active.uri)
      await writeRemembered('source')
      return true
    }
    const entry = getEntry(active.uri)
    const hasReadyPanel = entry?.session.getInfo().panels.some((p) => p.ready) ?? false
    const ok = await applyViewSwitch(active.uri, planViewSwitch(active.mode, target, hasReadyPanel, inDiffContext))
    if (ok) {
      refreshActiveModeContext()
    }
    return ok
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('onegayi.vsidian.toggleViewMode', (uri?: vscode.Uri) =>
      runViewSwitch(undefined, uri)),
    vscode.commands.registerCommand(
      'onegayi.vsidian.mode.toReading',
      (uri?: vscode.Uri) => runViewSwitch('reading', uri),
    ),
    vscode.commands.registerCommand(
      'onegayi.vsidian.mode.toSource',
      (uri?: vscode.Uri) => runViewSwitch('source', uri),
    ),
    vscode.commands.registerCommand(
      'onegayi.vsidian.mode.toLive',
      (uri?: vscode.Uri) => runViewSwitch('live', uri),
    ),
    // #141 双态切换（live↔reading）：工具栏按钮（view.switch.request 分支）
    // 与快捷键（keybindings.execute → executeCommand）共用同一目标推导
    // （当前态取反）与同一 runViewSwitch 编排——两条入口不造第二条切换
    // 路径；源码态推导出 open-in-vsidian 回 Vsidian 面板（命令面板调用
    // 场景），不落源码自环
    vscode.commands.registerCommand(
      'onegayi.vsidian.mode.toggleDualView',
      (uri?: vscode.Uri) => {
        const active = deriveActiveTabMode()
        if (!active) {
          void vscode.window.showWarningMessage(t('host.noActiveMarkdown'))
          return false
        }
        return runViewSwitch(active.mode === 'live' ? 'reading' : 'live', uri)
      },
    ),
  )

  // #38：活动编辑器切换（含切到 undefined）时刷新模式 context；面板间
  // 切换经各面板的 onDidChangeViewState 覆盖；activate 时初始化一次
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => refreshActiveModeContext()),
  )
  refreshActiveModeContext()

  // ---- 查找命令（#14）：活动 tab 为本扩展 custom editor 时向其面板发送
  // view.find.open（webview 内浮动查找面板）。查找是纯只读视图操作 ----
  context.subscriptions.push(
    vscode.commands.registerCommand('onegayi.vsidian.find', async () => {
      const tab = vscode.window.tabGroups.activeTabGroup.activeTab
      const input = tab?.input
      if (
        input instanceof vscode.TabInputCustom &&
        input.viewType === VIEW_TYPE
      ) {
        const entry = getEntry(input.uri)
        const panels = entry?.session.getInfo().panels.filter((p) => p.ready) ?? []
        if (panels.length > 0) {
          for (const panel of panels) {
            entry!.session.postToPanel(panel.sessionId, { kind: 'view.find.open' })
          }
          return true
        }
      }
      await vscode.window.showWarningMessage(t('host.noPanelForFind'))
      return false
    }),
  )
  for (const [command, direction] of [
    ['onegayi.vsidian.find.next', 'next'],
    ['onegayi.vsidian.find.previous', 'prev'],
  ] as const) {
    context.subscriptions.push(vscode.commands.registerCommand(command, (): boolean => {
      for (const entry of sessions.values()) for (const [sessionId, panel] of entry.panels) {
        if (panel.active && entry.session.getInfo().panels.some((p) =>
          p.sessionId === sessionId && p.ready)) {
          entry.session.postToPanel(sessionId, { kind: 'view.find.step', direction })
          return true
        }
      }
      return false
    }))
  }

  // ---- 表格结构命令（#13）：活动 tab 为本扩展 custom editor 时向其面板发送
  // table.command（webview 在光标处执行，走标准出站链路）。与模式切换/查找
  // 不同，这是写操作：只发活动面板（表格上下文在各面板光标处独立） ----
  const TABLE_COMMANDS: Array<[string, TableEditOp | 'create']> = [
    ['onegayi.vsidian.table.create', 'create'],
    ['onegayi.vsidian.table.insertRowAbove', 'insertRowAbove'],
    ['onegayi.vsidian.table.insertRowBelow', 'insertRowBelow'],
    ['onegayi.vsidian.table.deleteRow', 'deleteRow'],
    ['onegayi.vsidian.table.insertColumnLeft', 'insertColumnLeft'],
    ['onegayi.vsidian.table.insertColumnRight', 'insertColumnRight'],
    ['onegayi.vsidian.table.deleteColumn', 'deleteColumn'],
  ]
  for (const [command, op] of TABLE_COMMANDS) {
    context.subscriptions.push(
      vscode.commands.registerCommand(command, async (): Promise<boolean> => {
        // 遍历全部会话找活动面板（vscode 无全局「webview 面板焦点」句柄）
        for (const entry of sessions.values()) {
          for (const [sessionId, panel] of entry.panels) {
            if (panel.active && entry.session.getInfo().panels.some((p) => p.sessionId === sessionId && p.ready)) {
              // 阅读模式只读：命令在 webview 侧会被忽略（写操作仅 live 执行），
              // 静默丢弃后仍返回成功属虚报——按宿主缓存的模式给出可见反馈
              // （模式经 view.state 主动回报保持常新；无缓存时不拦截，面板
              // 默认 live）。不 await：命令无需用户选择，通知停留即可
              const viewMode = entry.session.getViewState(sessionId)?.viewMode
              if (viewMode === 'reading') {
                void vscode.window.showWarningMessage(t('host.readOnlyTableOp'))
                return true
              }
              entry.session.postToPanel(sessionId, op === 'create'
                ? { kind: 'table.create' }
                : { kind: 'table.command', op })
              return true
            }
          }
        }
        await vscode.window.showWarningMessage(
          op === 'create' ? t('host.noPanelForTableCreate') : t('host.noPanelForTableOp'),
        )
        return false
      }),
    )
  }

  // ---- 格式命令（#88）：命令面板与后续操作条/快捷键共用 id，活动 Live 面板
  // 在自身选区执行。webview 单事务经 edit.request 写回宿主权威文档。 ----
  for (const operation of FORMAT_OPERATIONS) {
    context.subscriptions.push(vscode.commands.registerCommand(operation.command, async (): Promise<boolean> => {
      for (const entry of sessions.values()) {
        for (const [sessionId, panel] of entry.panels) {
          if (!panel.active || !entry.session.getInfo().panels.some((p) =>
            p.sessionId === sessionId && p.ready)) continue
          if (entry.session.getViewState(sessionId)?.viewMode === 'reading') return false
          if (vscode.workspace.fs.isWritableFileSystem(entry.doc.uri.scheme) === false) return false
          entry.session.postToPanel(sessionId, { kind: 'format.command', op: operation.id })
          return true
        }
      }
      return false
    }))
  }

  // ---- #162 复制块链接命令：快捷键（keybindings.execute 转发）与命令面板
  // 共用 id；与正文右键菜单是同一命令的两个入口。命令在面板 Live 光标所在
  // 块执行（标题行=复制标题链接；无块 id 先自动补写一笔可撤销编辑——写回
  // 链路在 webview，本命令只投递 blockLink.copy）。阅读只读静默不接管
  // （与格式命令同口径），无活动面板返回 false ----
  context.subscriptions.push(
    vscode.commands.registerCommand('onegayi.vsidian.block.copyLink', async (): Promise<boolean> => {
      for (const entry of sessions.values()) {
        for (const [sessionId, panel] of entry.panels) {
          if (!panel.active || !entry.session.getInfo().panels.some((p) =>
            p.sessionId === sessionId && p.ready)) continue
          if (entry.session.getViewState(sessionId)?.viewMode === 'reading') return false
          entry.session.postToPanel(sessionId, { kind: 'blockLink.copy' })
          return true
        }
      }
      return false
    }),
  )
  for (const operation of UI_OPERATIONS) {
    context.subscriptions.push(vscode.commands.registerCommand(operation.command, (): boolean => {
      for (const entry of sessions.values()) for (const [sessionId, panel] of entry.panels) {
        if (panel.active && entry.session.getInfo().panels.some((p) =>
          p.sessionId === sessionId && p.ready)) {
          entry.session.postToPanel(sessionId, { kind: 'ui.command', op: operation.id })
          return true
        }
      }
      return false
    }))
  }

  // ---- 测试钩子命令：仅集成测试经 runTest.mjs 注入 VSIDIAN_TEST_HOOKS=1 时
  // 注册（C-11），生产 VSIX 与常规 F5 开发不暴露 ----
  if (process.env.VSIDIAN_TEST_HOOKS === '1') {
    context.subscriptions.push(
    vscode.commands.registerCommand('onegayi.vsidian._test.getSessionState', (uriStr: string) => {
      const entry = getEntry(vscode.Uri.parse(uriStr))
      if (!entry) {
        return { found: false, panels: [], version: 0, appliedEdits: 0 }
      }
      return {
        found: true,
        panels: entry.session.getInfo().panels,
        version: entry.doc.version,
        appliedEdits: entry.appliedEdits,
      }
    }),
    vscode.commands.registerCommand(
      'onegayi.vsidian._test.injectWebviewMessage',
      async (uriStr: string, message: Record<string, unknown>, panelIndex = 0) => {
        const entry = getEntry(vscode.Uri.parse(uriStr))
        const panel = entry?.session.getInfo().panels[panelIndex]
        if (!entry || !panel) {
          throw new Error(`无可用会话面板：${uriStr}`)
        }
        // 测试注入的消息与真实 webview 消息走同一校验与处理入口；
        // sessionId 由钩子按目标面板填充
        await entry.session.handleWebviewMessage(
          { ...message, sessionId: panel.sessionId },
          panel.sessionId,
        )
      },
    ),
    vscode.commands.registerCommand(
      // 宿主 → webview 方向的消息注入钩子：与 injectWebviewMessage（webview →
      // 宿主）对称，供集成测试驱动 view.mode.set / view.locate 等正式消息
      'onegayi.vsidian._test.postToPanel',
      async (uriStr: string, message: Record<string, unknown>, panelIndex = 0) => {
        const entry = getEntry(vscode.Uri.parse(uriStr))
        const panels = entry?.session.getInfo().panels.filter((p) => p.ready) ?? []
        const panel = panels[panelIndex]
        if (!entry || !panel) {
          throw new Error(`无可用会话面板：${uriStr}`)
        }
        entry.session.postToPanel(panel.sessionId, message as HostToWebview)
        return true
      },
    ),
    vscode.commands.registerCommand(
      'onegayi.vsidian._test.getConflictState',
      (uriStr: string, panelIndex = 0) => {
        const entry = getEntry(vscode.Uri.parse(uriStr))
        const panel = entry?.session.getInfo().panels[panelIndex]
        if (!entry || !panel) {
          return { found: false }
        }
        return { found: true, sessionId: panel.sessionId, ...entry.session.getConflictState(panel.sessionId) }
      },
    ),
    // #201 图片刷新观测钩子：失效事件日志（取走即清空）与版本表快照——
    // 集成测试断言「真实文件变更 → 失效广播 → 新版本 URL」链路的宿主侧证据
    vscode.commands.registerCommand('onegayi.vsidian._test.takeImageRefreshEvents', () => {
      const events = [...imageRefreshEvents]
      imageRefreshEvents.length = 0
      return events
    }),
    vscode.commands.registerCommand('onegayi.vsidian._test.getImageVersions', () =>
      imageRefresh.versions.snapshot()),
    vscode.commands.registerCommand(
      'onegayi.vsidian._test.getLastClosedInput',
      () => lastClosedInput,
    ),
    vscode.commands.registerCommand(
      // 宿主缓存的 view.state（模式主动回报的观测面）：断言宿主侧写命令
      // 拦截所依据的 viewMode 缓存已就位/常新
      'onegayi.vsidian._test.getPanelViewStateCache',
      (uriStr: string, panelIndex = 0) => {
        const entry = getEntry(vscode.Uri.parse(uriStr))
        const panel = entry?.session.getInfo().panels[panelIndex]
        if (!entry || !panel) {
          return { found: false }
        }
        const cached = entry.session.getViewState(panel.sessionId)
        return { found: cached !== undefined, viewMode: cached?.viewMode }
      },
    ),
    vscode.commands.registerCommand(
      'onegayi.vsidian._test.getCachedViewState',
      (uriStr: string, panelIndex = 0) => {
        const entry = getEntry(vscode.Uri.parse(uriStr))
        const panel = entry?.session.getInfo().panels[panelIndex]
        return panel ? entry?.session.getViewState(panel.sessionId) : undefined
      },
    ),
    vscode.commands.registerCommand(
      'onegayi.vsidian._test.resumePanel',
      (uriStr: string, panelIndex = 0) => {
        const entry = getEntry(vscode.Uri.parse(uriStr))
        const panel = entry?.session.getInfo().panels[panelIndex]
        if (!entry || !panel) {
          return false
        }
        return entry.session.resumePanel(panel.sessionId)
      },
    ),
    vscode.commands.registerCommand(
      'onegayi.vsidian._test.requestViewState',
      async (uriStr: string, panelIndex = 0) => {
        const entry = getEntry(vscode.Uri.parse(uriStr))
        const panels = entry?.session.getInfo().panels.filter((p) => p.ready) ?? []
        const panel = panels[panelIndex]
        if (!entry || !panel) {
          return undefined
        }
        const before = entry.session.getViewState(panel.sessionId)
        entry.session.postToPanel(panel.sessionId, { kind: 'view.state.request' })
        const deadline = Date.now() + 5000
        while (Date.now() < deadline) {
          const state = entry.session.getViewState(panel.sessionId)
          if (state && state !== before) {
            return state
          }
          await new Promise((r) => setTimeout(r, 100))
        }
        // 旧缓存不能证明本次请求收到了 webview 回报；由调用者继续等待或报错。
        return undefined
      },
    ),
    vscode.commands.registerCommand(
      'onegayi.vsidian._test.perfProbe',
      async (
        uriStr: string,
        options: { typingRounds: number; scrollRounds: number },
        panelIndex = 0,
      ) => {
        const entry = getEntry(vscode.Uri.parse(uriStr))
        const panels = entry?.session.getInfo().panels.filter((p) => p.ready) ?? []
        const panel = panels[panelIndex]
        if (!entry || !panel) {
          return undefined
        }
        // 首次探针可能发生在上一报告之后：先记录旧值，轮询到新报告
        const before = entry.session.getLastPerfReport(panel.sessionId)
        entry.session.postToPanel(panel.sessionId, {
          kind: 'perf.probe',
          typingRounds: options.typingRounds,
          scrollRounds: options.scrollRounds,
        })
        const deadline = Date.now() + 60000
        while (Date.now() < deadline) {
          const report = entry.session.getLastPerfReport(panel.sessionId)
          if (report && report !== before) {
            return report
          }
          await new Promise((r) => setTimeout(r, 200))
        }
        return entry.session.getLastPerfReport(panel.sessionId)
      },
    ),
    vscode.commands.registerCommand(
      // 阅读视图性能探针（#7）：与 perfProbe 同构的轮询通道
      'onegayi.vsidian._test.readingPerf',
      async (uriStr: string, options: { scrollRounds: number }, panelIndex = 0) => {
        const entry = getEntry(vscode.Uri.parse(uriStr))
        const panels = entry?.session.getInfo().panels.filter((p) => p.ready) ?? []
        const panel = panels[panelIndex]
        if (!entry || !panel) {
          return undefined
        }
        const before = entry.session.getLastReadingPerfReport(panel.sessionId)
        entry.session.postToPanel(panel.sessionId, {
          kind: 'reading.perf',
          scrollRounds: options.scrollRounds,
        })
        const deadline = Date.now() + 60000
        while (Date.now() < deadline) {
          const report = entry.session.getLastReadingPerfReport(panel.sessionId)
          if (report && report !== before) {
            return report
          }
          await new Promise((r) => setTimeout(r, 200))
        }
        return entry.session.getLastReadingPerfReport(panel.sessionId)
      },
    ),
    vscode.commands.registerCommand(
      // 链接跳转执行日志（#10）：集成测试经注入 link.observe 消息断言宿主
      // 收到的意图与处置（external/blocked/doc/not-found）
      'onegayi.vsidian._test.getLinkLog',
      (uriStr: string) => {
        const entry = getEntry(vscode.Uri.parse(uriStr))
        return { found: !!entry, log: entry ? [...entry.linkLog] : [] }
      },
    ),
    vscode.commands.registerCommand(
      // #111 图表导出消息日志（取走即清空）：钩子模式下 exportDiagram 端口
      // 不弹真实另存为对话框，集成测试经 graphic.test.popup 的 action 驱动
      // 导出按钮后，以此断言 webview→宿主链路的消息形态
      'onegayi.vsidian._test.takeDiagramExportLog',
      (uriStr: string) => {
        const log = diagramExportTestLog.get(uriStr) ?? []
        diagramExportTestLog.set(uriStr, [])
        return [...log]
      },
    ),
    vscode.commands.registerCommand(
      // #161 图片粘贴消息日志（取走即清空）：落盘真实执行，此日志供集成
      // 测试断言 webview→宿主链路的载荷形态（mime/base64/hint/reqId）
      'onegayi.vsidian._test.takeImagePasteLog',
      (uriStr: string) => {
        const log = imagePasteTestLog.get(uriStr) ?? []
        imagePasteTestLog.set(uriStr, [])
        return [...log]
      },
    ),
    vscode.commands.registerCommand(
      // #38 全局模式记忆读取（非法值容错同正式链路）：集成测试断言
      // 切换后记忆写入 / 弹回不写记忆等契约
      'onegayi.vsidian._test.getLastMode',
      () => readRemembered(),
    ),
    vscode.commands.registerCommand(
      // #38 全局模式记忆重置（模拟无历史）：globalState 在同一集成进程内
      // 共享，用例须自带前置重置避免跨用例状态泄漏。写入 'live' 而非
      // update(key, undefined)：1.86.2 的删除在 storage 层异步生效，会迟到
      // 覆盖用例内后续写入（实测竞态）；'live' 与「无历史」的容错读取语义
      // 等价且无竞态
      'onegayi.vsidian._test.resetLastMode',
      async () => {
        await context.globalState.update(LAST_MODE_KEY, 'live')
        return true
      },
    ),
    // ---- #33 设置链路测试钩子：fixture 定义注入、快照读写、设置页
    // 观测/关闭/消息注入（生产注册表为空——契约经 fixture 定义覆盖）----
    vscode.commands.registerCommand(
      'onegayi.vsidian._test.installSettingsFixture',
      () =>
        settings
          ? settings.service.addDefinitions([
              { key: 'test.flag', type: 'boolean', default: false, titleKey: 'setting.testFlag.title' },
            ])
          : { ok: false, error: 'settings wiring unavailable' },
    ),
    vscode.commands.registerCommand('onegayi.vsidian._test.getSettings', () =>
      settings ? settings.service.getSnapshot() : {},
    ),
    vscode.commands.registerCommand('onegayi.vsidian._test.getKeybindings', () =>
      settings ? settings.keybindings.getSnapshot() : {},
    ),
    vscode.commands.registerCommand('onegayi.vsidian._test.setKeybindings',
      (id: string, bindings: string[], replace = false) =>
        settings?.keybindings.set(id, bindings, replace)),
    vscode.commands.registerCommand('onegayi.vsidian._test.resetKeybindings',
      () => settings?.keybindings.resetAll()),
    vscode.commands.registerCommand(
      'onegayi.vsidian._test.setSettings',
      async (values: unknown) =>
        settings ? settings.service.apply(values) : { ok: false, rejected: [], reason: 'invalid' as const },
    ),
    vscode.commands.registerCommand('onegayi.vsidian._test.settingsPageInfo', () =>
      settings
        ? settings.page.getInfo()
        : { open: false, ready: false, title: '' },
    ),
    vscode.commands.registerCommand('onegayi.vsidian._test.closeSettingsPage', () => {
      settings?.page.close()
      return true
    }),
    vscode.commands.registerCommand(
      'onegayi.vsidian._test.injectSettingsPageMessage',
      (message: unknown) => {
        settings?.page.injectMessage(message)
        return true
      },
    ),
    // ---- #128 CSS 片段测试钩子：观测（权威状态）+ 注入（目录/开关经正式
    // 服务入口——与设置页按钮同一链路；刷新走真实命令不设钩子）----
    vscode.commands.registerCommand('onegayi.vsidian._test.getSnippetState', () =>
      snippets
        ? { available: true, ...snippets.getState() }
        : { available: false, directory: null, readError: false, paused: false, entries: [], version: 0 },
    ),
    vscode.commands.registerCommand(
      'onegayi.vsidian._test.setSnippetDirectory',
      (directory: string | null) => snippets?.setDirectory(directory),
    ),
    vscode.commands.registerCommand(
      'onegayi.vsidian._test.setSnippetEnabled',
      (name: string, enabled: boolean) => snippets?.setEnabled(name, enabled),
    ),
    // #131 环境身份观测钩子（ADR-0007 证据链的机器侧采集点）：本地集成
    // 测试断言本地语义（remoteName undefined、globalStorageUri 在本机用户
    // 数据目录）；真实 SSH 窗口人工验收时运行此命令记录远端侧读值
    vscode.commands.registerCommand('onegayi.vsidian._test.getSnippetEnv', () => ({
      remoteName: vscode.env.remoteName ?? null,
      machineId: vscode.env.machineId,
      appHost: vscode.env.appHost,
      /** 扩展宿主的 globalState 物理归属目录（隔离证据：本地在用户数据目录，
       *  SSH 窗口在远端 ~/.vscode-server 下） */
      globalStorageUri: context.globalStorageUri.toString(),
      workspaceTrusted: vscode.workspace.isTrusted,
    })),
    // ---- #198 索引维护测试钩子：观测（服务权威状态 + 持久化原始值 +
    //      快照分区根目录——集成用例直接列目录断言代际回收）----
    vscode.commands.registerCommand('onegayi.vsidian._test.getVaultIndexState', () => ({
      available: vaultIndex !== undefined,
      ...(vaultIndex ? vaultIndex.maintenanceInfo() : { roots: [], rebuilding: false }),
      persistedPatterns: indexMaintenance?.persistedRaw() ?? null,
      storageRoot: context.storageUri ? context.storageUri.fsPath : null,
    })),
    vscode.commands.registerCommand(
      'onegayi.vsidian._test.setIndexPatterns',
      (patterns: string[]) => indexMaintenance?.setPatterns(patterns),
    ),
  )
  }

  return provider
}

/** blocked 链接的用户可见反馈文案（拦截不静默——验收标准要求） */
function blockedLinkMessage(
  target: Extract<ReturnType<typeof classifyLinkTarget>, { kind: 'blocked' }>,
): string {
  switch (target.reason) {
    case 'empty':
      return t('host.blockedLinkEmpty')
    case 'scheme':
      return t('host.blockedLinkScheme', { scheme: target.scheme || '//' })
    case 'escape':
      return t('host.blockedLinkEscape', { detail: target.detail ?? '' })
    case 'windows-drive-on-posix':
      return t('host.blockedLinkWindowsDrive')
  }
}

/**
 * #160 锚点落位的面板依赖：executeLinkIntent 是模块级函数，会话表与
 * 面板就绪等待在 provider 闭包内——经此端口注入（与 executeWikilinkIntent
 * 的闭包内直取同一份状态，不复制）
 */
interface LinkAnchorPort {
  /** 目标面板就绪等待（新建或隐藏重载），返回可投递面板 */
  waitForReadyPanel: (uri: vscode.Uri) => Promise<{ entry: SessionEntry; sessionId: string } | undefined>
}

/**
 * #160 fragment → 文档内定位区间（宿主系坐标，getText 保留 \r\n）：
 * 标题 fragment 复用 #11 的 findHeadingOffset（与双链锚点同源比较口径）；
 * `#^块id` 走 #159 的 findBlockOffset（同源块定位器，批次合并后接通）。
 * 调用方以 isBlockIdFragment 区分「块引用」与「标题引用」——两者的
 * 缺失提示词条不同（块缺失复用双链的块 id 提示，语义一致）。
 */
function isBlockIdFragment(fragment: string): boolean {
  return fragment.startsWith('^')
}

/**
 * 链接跳转意图执行（#10；#160 补锚点定位）：分类 → external 经
 * env.openExternal 外开（URL 含 `#` 原样外开——网页锚点语义不接管）；
 * anchor（`#frag`）页内定位当前文档；doc 按候选探测存在性（精确优先、
 * 无扩展名补 .md）后打开并按 fragment 定位；blocked/not-found 给用户
 * 可见反馈。目标一律用本扩展面板打开，随后 view.locate（LF 偏移经
 * NewlineCoordinator 转换）。全程只读：不触碰 TextDocument
 * 写路径、不建索引、不自动创建文件。
 */
/** 文件存在性端口（fs 适配）：双链跳转链路经 shared/vaultLink 的 exists
 *  端口注入（#196）。stat 验证存在且为普通文件；返回**磁盘真实路径**——
 *  Windows 宿主（NTFS 不敏感）命中后逐段 readDirectory 归正大小写，
 *  避免以注入形态建立 URI 与真实文档/面板身份漂移（集成实测教训）；
 *  远程 POSIX 宿主 stat 严格命中即真实路径，原样返回。#197 引用索引
 *  落地后可换传索引查询（索引持磁盘真实路径，直接返回）。 */
async function statFileRealPath(fsPath: string): Promise<string | null> {
  const uri = vscode.Uri.file(fsPath)
  try {
    const st = await vscode.workspace.fs.stat(uri)
    if ((st.type & vscode.FileType.File) === 0) {
      return null
    }
  } catch {
    return null
  }
  if (process.platform !== 'win32') {
    return fsPath
  }
  // Windows：逐段归正用户输入段的大小写（docDir 段来自已打开文档的真实
  // URI，天然真实；归正从盘符根走一遍最稳——段数少，跳转单击频率可承受）
  const ops = path.win32
  let current = ops.parse(fsPath).root
  for (const seg of fsPath.slice(current.length).split(/[\\/]+/)) {
    if (seg === '') {
      continue
    }
    try {
      const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(current))
      const hit = entries.find(([name]) => name.toLowerCase() === seg.toLowerCase())
      current = ops.join(current, hit ? hit[0] : seg)
    } catch {
      return fsPath // 目录列举失败（不应发生——stat 已过）：退回注入形态
    }
  }
  return current
}

async function executeLinkIntent(
  document: vscode.TextDocument,
  ctx: LinkContext,
  intent: { href: string; srcStart: number; srcEnd: number },
  log: Array<LinkLogEntry | WikilinkLogEntry>,
  anchors: LinkAnchorPort,
): Promise<void> {
  const pushLog = (entry: LinkLogEntry): void => {
    log.push(entry)
    while (log.length > 64) {
      log.shift()
    }
  }
  // fragment 定位失败的用户提示（anchor 与 doc 两分支共用）：块引用缺失
  // 复用双链的块 id 词条、标题缺失用链接锚点词条——两分支语义一致不分写
  const fragmentMissingMessage = (fragment: string): string =>
    isBlockIdFragment(fragment)
      ? t('host.wikilinkBlockMissing', { link: intent.href, blockId: fragment.slice(1) })
      : t('host.linkAnchorMissing', { href: intent.href, heading: fragment })
  const target = classifyLinkTarget(intent.href, ctx)
  if (target.kind === 'external') {
    pushLog({ kind: 'external', href: intent.href })
    if (process.env.VSIDIAN_TEST_HOOKS === '1') {
      // 集成测试环境不真开系统浏览器（CI 无浏览器且产生噪声）；
      // 分类正确性已由单测钉死，真实外开留给人工验收（#15）
      return
    }
    const ok = await vscode.env.openExternal(vscode.Uri.parse(target.url))
    if (!ok) {
      void vscode.window.showWarningMessage(t('host.externalOpenFailed', { url: target.url }))
    }
    return
  }
  if (target.kind === 'blocked') {
    pushLog({ kind: 'blocked', href: intent.href, reason: target.reason, scheme: target.scheme })
    void vscode.window.showWarningMessage(blockedLinkMessage(target))
    return
  }
  if (target.kind === 'anchor') {
    // #160 页内锚点：目标即当前文档（意图源面板），不查文件系统。
    // #^ 前缀为块引用（#159 同源定位器）：块首行落位，标题行落位标题
    const isBlock = isBlockIdFragment(target.fragment)
    const text = document.getText()
    const offset = isBlock
      ? findBlockOffset(text, target.fragment.slice(1))
      : findHeadingOffset(text, target.fragment)
    pushLog({
      kind: 'anchor',
      href: intent.href,
      fragment: target.fragment,
      locate: offset ? 'custom-panel' : 'none',
    })
    await revealLinkAnchor(anchors, document.uri, document, offset)
    if (offset === null) {
      void vscode.window.showWarningMessage(fragmentMissingMessage(target.fragment))
    }
    return
  }
  for (const fsPath of target.candidates) {
    const uri = vscode.Uri.file(fsPath)
    try {
      await vscode.workspace.fs.stat(uri)
    } catch {
      continue
    }
    // openTextDocument 只装载不显示；fragment 定位区间与日志先于打开动作
    const targetDoc = await vscode.workspace.openTextDocument(uri)
    const isBlock = target.fragment !== null && isBlockIdFragment(target.fragment)
    const targetText = targetDoc.getText()
    const offset =
      target.fragment === null ? null
        : isBlock
          ? findBlockOffset(targetText, target.fragment.slice(1))
          : findHeadingOffset(targetText, target.fragment)
    pushLog({
      kind: 'doc',
      href: intent.href,
      path: fsPath,
      fragment: target.fragment ?? undefined,
      locate: offset ? 'custom-panel' : 'none',
    })
    await revealLinkAnchor(anchors, uri, targetDoc, offset)
    if (target.fragment !== null && offset === null) {
      void vscode.window.showWarningMessage(fragmentMissingMessage(target.fragment))
    }
    return
  }
  pushLog({ kind: 'not-found', href: intent.href })
  void vscode.window.showWarningMessage(
    t('host.linkNotFound', { href: intent.href }),
  )
}

/**
 * #160 锚点落位（与 executeWikilinkIntent 同款）：openWith 打开或重显
 * Vsidian 面板后 view.locate。offset 为宿主系坐标；发送前经
 * NewlineCoordinator 转 LF 系（webview 全程 LF 坐标，CRLF 按行数漂移）。
 */
async function revealLinkAnchor(
  anchors: LinkAnchorPort,
  uri: vscode.Uri,
  doc: vscode.TextDocument,
  offset: { offset: number; end: number } | null,
): Promise<void> {
  await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE)
  if (offset) {
    const ready = await anchors.waitForReadyPanel(uri)
    if (ready) {
      const lfOffset = new NewlineCoordinator(doc.getText()).hostOffsetToLf(offset.offset)
      ready.entry.session.postToPanel(ready.sessionId, { kind: 'view.locate', offset: lfOffset })
    }
  }
}

/**
 * 工作区图片解析（#10；#201 升级）：白名单分类 → stat 三态探测（保留
 * mtime/size 进版本表——不再只验存在性；FileNotFound=not-found，其他失败
 * =inaccessible 不冒充删除）→ asWebviewUri 拼 `?v=<代次>` 缓存击穿参数
 * （版本表已观测变化代次，单调递增；webview 资源服务不承诺无缓存——
 * buildSnippetLinkList 同款防御）。本地与远程（SSH）工作区同通道。
 */
async function resolveWorkspaceImage(
  src: string,
  ctx: LinkContext,
  webview: vscode.Webview,
  versions: ImageVersionTable,
): Promise<ImageResolution> {
  const target = classifyImageTarget(src, ctx)
  if (target.kind === 'blocked') {
    return {
      ok: false,
      reason: imageBlockReasonOf(target),
      detail: target.scheme ?? target.detail,
    }
  }
  const uri = vscode.Uri.file(target.fsPath)
  let stat: vscode.FileStat
  try {
    stat = await vscode.workspace.fs.stat(uri)
  } catch (err) {
    if (isFileNotFound(err)) {
      versions.recordMissing(target.fsPath)
      return { ok: false, reason: 'not-found', detail: target.fsPath, fsPath: target.fsPath }
    }
    // SSH 断连/权限错误等不可访问：不得冒充文件删除（#194 图片节）
    return { ok: false, reason: 'inaccessible', detail: target.fsPath, fsPath: target.fsPath }
  }
  if ((stat.type & vscode.FileType.File) === 0) {
    // 目录等非普通文件：按找不到处理（不是可呈现的图片目标）
    versions.recordMissing(target.fsPath)
    return { ok: false, reason: 'not-found', detail: target.fsPath, fsPath: target.fsPath }
  }
  const { generation } = versions.recordObservation(target.fsPath, {
    mtimeMs: stat.mtime,
    size: stat.size,
  })
  return {
    ok: true,
    src: `${webview.asWebviewUri(uri).toString()}?v=${generation}`,
    fsPath: target.fsPath,
  }
}

function buildWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  locale: LocaleCode,
): string {
  const nonce = randomUUID()
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'main.js'),
  )
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'main.css'),
  )
  // #60 Mermaid 独立产物：约 2.7MB 不进主 bundle（避免每个 webview 启动都
  // 付出解析成本），webview 侧按需懒加载。webview 无法自行构造
  // asWebviewUri 前缀（cspSource 为宿主私有随机 origin），经此 nonce 内联
  // 脚本把资源 URI 写入全局变量（改动面最小的 URI 传递机制——无需扩协议
  // 消息；CSP script-src 的 nonce 分支放行该内联脚本）
  const mermaidUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'mermaid.js'),
  ).toString()
  // 稳定样式契约内部测试片段（#6）：验证外部样式表可经稳定类名/变量
  // 定位两种视图；一期不提供用户 CSS 加载（见 docs/design/obsidian-selector-map.md）
  const probeCssUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'media', 'css-contract-probe.css'),
  )
  // #130 起抽纯逻辑模块（style-src/font-src 追加 https: 放行 HTTPS 导入与
  // 联网字体；脚本面维持 nonce 门控）——期望形态由 test/unit/editorCsp.test.ts
  // 钉住，真实宿主内生效由集成测试验证
  const csp = buildEditorCsp(webview.cspSource, nonce)
  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link href="${styleUri}" rel="stylesheet">
<link href="${probeCssUri}" rel="stylesheet">
<title>Vsidian</title>
</head>
<body>
<div id="app"></div>
${buildLocaleIslandHtml(locale, LOCALE_MESSAGES[locale])}
<script nonce="${nonce}">window.__vsidianMermaidUri = "${mermaidUri}";</script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
}
