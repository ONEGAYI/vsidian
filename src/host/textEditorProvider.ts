// CustomTextEditorProvider 实现与文档会话注册表。
//
// 选择 CustomTextEditorProvider（而非 CustomEditorProvider）：保存、dirty、
// Hot Exit 全部由 VSCode 标准文本管线自动处理，扩展只需实现
// resolveCustomTextEditor（探索笔记 02 §1）。
// 权威文本为 TextDocument；webview 编辑经 DocumentSession 校验后以
// WorkspaceEdit 写回；文档事件回流经 session 识别自家确认与外部变更。
import * as vscode from 'vscode'
import { randomUUID } from 'node:crypto'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import { DocumentSession, type HostDocumentPort, type SessionNotice } from './documentSession'
import { isRefEditClientMessage, RefEditPortRegistry, wrapRefEditPush, type RefEditBinding } from './refEditPorts'
import { WebLinkMetaService } from './webLinkMetaService'
import { resolveProxyConfig, type ProxyDecision } from './proxyAgent'
import { HOVER_EXTERNAL_ENABLED_KEY, HOVER_EXTERNAL_SHAPE_KEY, type HoverExternalShapeMode } from '../shared/settings'
import {
  appendImageVersionStamp,
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
import { queryWikilinkHeadings } from './wikilinkHeadingSource'
import {
  resolveVaultLinkFile,
  type VaultLinkResolveContext,
} from '../shared/vaultLink'
import { parseWikilinkInner } from '../shared/wikilink'
import { classifyLocalRefContentKind } from '../shared/refContent'
import { parseTextAnchorSpec, resolveTextNav } from '../shared/refText'
import { NewlineCoordinator } from '../shared/newline'
import { buildEditorCsp } from './editorCsp'
// #292 骨架屏内联装配（样式/#app 开标签含骨架标记/可读行宽预注入取值）
import {
  buildAppOpenTag,
  buildSkeletonStyleHtml,
  readableLineWidthPreset,
} from './skeletonScreen'
import { SKELETON_HOLD_GLOBAL, SKELETON_SHOWN_AT_GLOBAL } from '../shared/skeletonTiming'
import { FORMAT_OPERATIONS } from '../shared/formatOperations'
import { KEYBINDING_OPERATIONS, UI_OPERATIONS } from '../shared/keybindings'
import {
  isWebviewToHost,
  type DiagramExportPayload,
  type HostToWebview,
  type HoverPreviewRequestPayload,
  type ImageExportPayload,
  type ImagePastePayload,
  type SerChange,
  type TableEditOp,
  type WebviewToHost,
} from '../shared/protocol'
import {
  decideModeMemoryHeal,
  decideReadingRestore,
  decideResolveBehavior,
  isDiffContext,
  isUriInDiffContext,
  LAST_MODE_KEY,
  MODE_MEMORY_HEAL,
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
import { admitHoverWatch, connectHoverEvents, HoverRefreshCoordinator, shouldForwardHoverDocChange } from './hoverRefreshCoordinator'
import { selectTextWatchEvictions } from '../shared/hoverRefresh'
import { escapeGlobFilenameLiteral } from '../shared/globLiteral'
import { TextAppearanceService } from './textAppearance/appearanceService'
import { ImageVersionTable } from './imageVersioning'
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
import { runImageExport } from './imageExportHost'
import { runImagePaste, type ImagePasteOutcome } from './imagePasteHost'
import { matchHostOffset, parseCopyMatch, shouldShowSearchRevealHint } from './searchReveal'
import {
  readRefContentTarget,
  resolveHoverTargetTip,
  type HoverDocAccessContext,
  type RefReadOutcome,
} from './hoverDocAccess'
import { installHostLocale, LOCALE_MESSAGES, type LocaleCode } from '../shared/locales'
import { buildLocaleIslandHtml } from '../shared/locales/island'
import { hostLocale } from './hostLocale'
import type { FindOptionsStore } from './findOptionsStore'
import { sanitizeFindOptions, type FindOptions } from '../shared/findOptions'
import { t } from '../shared/i18n'
import { EMBED_MAX_DEPTH_DEFAULT, EMBED_MAX_DEPTH_KEY, READABLE_LINE_WIDTH_KEY, PASTE_PRESERVE_FORMATTING_KEY, PASTE_ASK_BEFORE_KEY, SEARCH_REVEAL_HINT_DEFAULT, SEARCH_REVEAL_HINT_KEY } from '../shared/settings'
import type { JiebaWiring } from './jiebaResourceWiring'
import { JIEBA_WASM_VERSION } from '../shared/jiebaManifest'
import { recordDiagnosticMessage, TestDiagnostics } from '../shared/testDiagnostics'

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
  /** #236 查找选项持久化（workspaceState 工作区级记忆）：get 应答与
   *  set 保存后广播的存储权威 */
  findOptions: FindOptionsStore
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

/** 图片导出消息日志（#212 测试钩子观测：记录宿主收到的 image.export 载荷
 *  形态；与 diagram.export 同款短路（不弹真实另存为对话框），集成测试经
 *  image.test.popup 的 action 驱动导出按钮后以此断言消息形态；按文档
 *  URI 分桶，查询即取走） */
const imageExportTestLog = new Map<string, ImageExportPayload[]>()

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
  // #239 修复：jieba 资源的宿主权威目录进 webview 资源服务许可面。
  // asWebviewUri 只构造 URL；VSCode 资源服务（resourceLoading）对每个请求
  // 做 localResourceRoots 包含性检查（scheme 须与某个 root 一致），缺失时
  // 请求被 AccessDenied 拒绝、webview 动态 import 必抛「Failed to fetch
  // dynamically imported module」回退 builtin——1.86.2 实测 globalStorageUri
  // 即为 vscode-userdata: scheme，root 与资源同 scheme 即通过检查。只放行
  // jieba-wasm 子树（最小许可面），目录未下载时无副作用
  roots.push(vscode.Uri.joinPath(context.globalStorageUri, 'jieba-wasm'))
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

/**
 * #220 来源文档的解析上下文（悬停浮层 B 身份）：与 linkContextOf 同款
 * 语义（docDir 基准、所属工作区文件夹根边界、宿主平台语义），但由 fsPath
 * 构造——B 只经 openTextDocument 只装载，不打开面板。B 经
 * resolveVaultLinkFile 的 ADR-0008 根内语义送达（会话侧 hoverSourceFsPath
 * 守卫已比对），此处按其目录解析图片/链接。
 */
function linkContextOfPath(fsPath: string): LinkContext {
  const uri = vscode.Uri.file(fsPath)
  const folder = vscode.workspace.getWorkspaceFolder(uri)
  return {
    docDir: path.dirname(fsPath),
    rootDir: (folder ? folder.uri : vscode.Uri.joinPath(uri, '..')).fsPath,
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
  /** #239 分词资源接线（jieba 下载/删除宿主权威；编辑器面板消费
   *  wordSegment.get 应答与 loadResult 转发、状态变化广播） */
  jieba?: JiebaWiring,
): vscode.CustomTextEditorProvider {
  const sessions = new Map<string, SessionEntry>()
  const diagnostics = new TestDiagnostics()
  // ---- #342（P3-10）外链元信息服务：provider 级单例（跨面板共享缓存与
  // 合并计数——同一 URL 的多个悬停请求只发一次网络请求）。设置开关关闭
  // 时经 cancelAll 中止全部在途并清缓存（关闭态零请求的宿主侧防线）。
  // Remote SSH 下本服务随扩展宿主进程在远端运行——抓取自然发生在远端 ----
  // #346（用户裁决改进）：抓取尊重 VSCode http.proxy 配置族（TUN/企业代理
  // 环境下宿主 Node 栈与系统浏览器网络路径分叉的修复）。每跳请求前读取
  // （配置变更无需重启生效）；proxySupport=off / 未配置时维持直连；非法代
  // 理值回退直连 + warn 去抖。代理模式 SSRF 降级语义见 proxyAgent.ts 头注
  // 与规格「外链形态、网络与退回」第 3 条——直连 lookup 校验不受影响。
  const webLinkProxyDecision = (targetProtocol: string): ProxyDecision => resolveProxyConfig(
    {
      proxy: vscode.workspace.getConfiguration('http').get('proxy'),
      proxyAuthorization: vscode.workspace.getConfiguration('http').get('proxyAuthorization'),
      proxyStrictSSL: vscode.workspace.getConfiguration('http').get('proxyStrictSSL'),
      proxySupport: vscode.workspace.getConfiguration('http').get('proxySupport'),
    },
    process.env,
    targetProtocol,
  )
  const webLinkMeta = new WebLinkMetaService({ getProxy: webLinkProxyDecision })
  /** 在途 web 抓取的取消注册表：hover.request（webview 关浮层/换目标的
   *  hover.cancel）→ documentSession 路由 → 此处按 instanceId+reqId 定位
   *  消费者中止（最后消费者离开即断开底层连接）。key 为面板会话内唯一 */
  const pendingWebFetches = new Map<string, AbortController>()
  /** 外链预览开关（hover.externalEnabled）的宿主侧门控：false = 解析层
   *  维持 unsupported（被攻陷 webview 无法绕过开关发起抓取） */
  const externalHoverEnabled = (): boolean =>
    settings !== undefined && settings.service.getSnapshot()[HOVER_EXTERNAL_ENABLED_KEY] === true
  const externalHoverShape = (): HoverExternalShapeMode => {
    const value = settings?.service.getSnapshot()[HOVER_EXTERNAL_SHAPE_KEY]
    return value === 'page' ? 'page' : 'card'
  }
  // 开关关闭即中止在途并清缓存（含「设置页关闭时编辑器有在途抓取」的
  // 跨面板场景；迟到结果无从产生——服务层消费者已全部取消）
  if (settings !== undefined) {
    context.subscriptions.push({
      dispose: () => webLinkMeta.cancelAll(),
    })
    const releaseSettingsWatch = settings.service.onChange((values) => {
      if (values[HOVER_EXTERNAL_ENABLED_KEY] !== true) {
        webLinkMeta.cancelAll()
        pendingWebFetches.clear()
      }
    })
    context.subscriptions.push({ dispose: releaseSettingsWatch })
  }
  /** P2-13（#290）最近一条「面板关闭残留输入」快照（宿主留存）：无条件记录
   *  ——「取消不静默清除宿主已收到快照」的可观测实现；测试钩子
   *  getLastClosedInput 暴露，放弃当前版本时清除 */
  let lastClosedInput:
    | { docUri: string; webviewText?: string; fragments: string[]; fromRefPort?: boolean }
    | undefined

  // ---- P2-04（#281）目标编辑端口：嵌入内部 Live 与 B 会话的绑定簿记 ----
  // provider 持注册表；B 会话接入复用 openEntry（B 打开为 custom editor 时
  // 同一会话——「宿主每个 B 只有一个权威 DocumentSession」），虚拟面板的
  // send 把编辑通道事件包成 refEdit.push 回来源面板（白名单见 refEditPorts）。
  const refPorts = new RefEditPortRegistry()
  /** P2-11（#288）测试钩子配套：会话面板 → 真实 webview 消息处理器（与
   *  onDidReceiveMessage 同一函数；refEdit.* 在 provider 层拦截，会话入口
   *  注入无法触达——injectWebviewReceived 经此以完全一致的处理入口注入） */
  const panelMessageHandlers = new Map<string, (message: unknown) => void>()
  // #316 测试缝（VSIDIAN_TEST_HOOKS 门控注册，见 _test.armRefEditBindSuspend）：
  // bind handler 在 openTextDocument 恢复后、register 前的可武装屏障——把
  // 面板 dispose 精确排进「releasePanel 已消费 / register 未发生」的竞态窗口
  let refEditBindSuspend: Promise<void> | null = null
  let refEditBindSuspendRelease: (() => void) | null = null
  let refEditBindSuspendHits = 0

  /** 释放一个目标端口：B 会话 detach 虚拟面板；B 无面板时释放会话 */
  const releaseRefPort = (portId: string): void => {
    const binding = refPorts.release(portId)
    if (!binding) {
      return
    }
    const bEntry = sessions.get(binding.targetUri)
    bEntry?.session.detachPanel(binding.virtualSessionId)
    if (bEntry) {
      releaseEntryIfIdle(vscode.Uri.parse(binding.targetUri))
    }
  }

  /** #316（b2）webview 重建时整体释放该面板名下的目标编辑端口：webview
   *  侧端口状态库（embedCard 的 entries Map）随重建整体丢失，旧 portId
   *  无论在屏离屏都无人再引用——重建即端口族的逻辑死亡信号。不用
   *  releasePanel：其会连带清 #290「曾成功写入」记账（面板关闭时 dirty
   *  交接的判定集合），重载→关闭链路会漏交接 dirty B——走保留记账变体。
   *  释放后可见 occurrence 的 re-bind 经 findOccurrence 查不到旧端口，
   *  直接注册新端口（等价自愈）；B 会话无其他面板时随之回收（re-bind 重建） */
  const releaseRefPortsOnWebviewReload = (panelDocUri: string, panelSessionId: string): void => {
    for (const binding of refPorts.releasePanelKeepAck(panelSessionId, panelDocUri)) {
      const bEntry = sessions.get(binding.targetUri)
      bEntry?.session.detachPanel(binding.virtualSessionId)
      if (bEntry) {
        releaseEntryIfIdle(vscode.Uri.parse(binding.targetUri))
      }
    }
  }

  /** P2-04 dirty 推送：B 文档 dirty 变化时按目标路由到全部绑定来源面板
   *  （变化去重——content 与 dirty-state 两类事件都会到达，只发翻转） */
  const pushRefEditDirty = (doc: vscode.TextDocument): void => {
    const bindings = refPorts.byTarget(doc.uri.fsPath)
    if (bindings.length === 0) {
      return
    }
    const dirty = doc.isDirty
    for (const binding of bindings) {
      if (binding.lastDirty === dirty) {
        continue
      }
      binding.lastDirty = dirty
      sessions.get(binding.panelDocUri)?.session.postToPanel(binding.panelSessionId, {
        kind: 'refEdit.dirty',
        fsPath: binding.fsPath,
        dirty,
      })
    }
  }

  /** P2-13（#290）父标签关闭交接：把本面板引用编辑涉及且仍 dirty 的 B 打开
   *  为独立普通文本标签（showTextDocument 现有 TextDocument、preview:false
   *  钉住；已有 B 标签时宿主复用不重复开——P2-01 §7 真宿主验证路线）。
   *  判定集合 = 关闭时活跃端口（含在途写回的目标）∪ 该面板「曾成功写入」
   *  记账（端口已释放的离屏回收/切 Reading 场景——ADR-0010「引用编辑涉及
   *  且仍有未保存修改的 B」）。
   *  顺序（票据契约）：① 等 B 会话在途提交排空（写回照常完成）→ ② 再
   *  detach 虚拟面板——此刻的未确认输入才是真正未写入 B 的（暂停快照/
   *  组合期），经 detachPanel 通知走 P2-12 三项当次选择；B 文档交接与该
   *  输入分开，B 标签不冒称包含它 → ③ 最新 dirty 判定（dirty 模型即使无
   *  编辑器也驻留 textDocuments——P2-01 §8；不在 = 已干净回收，不打开）
   *  → ④ dirty 才 showTextDocument；干净 B 不打开，不自动保存/丢弃/另建
   *  副本，也不把 A 伪造 dirty。仅覆盖普通标签关闭（onDidDispose 路径）：
   *  窗口退出/重载时扩展主机停机，showTextDocument 不可用即自然失效，不
   *  承诺退出后自动重开（Hot Exit 归宿主）。 */
  const handoffDirtyTargetsOnClose = async (info: {
    editTargets: string[]
    releasedBindings: RefEditBinding[]
  }): Promise<void> => {
    // targetUri 去重（同一 B 多 occurrence 只交接一次）；值为该目标的活跃
    // 绑定（可能为空——只剩记账的目标）
    const targets = new Map<string, RefEditBinding[]>()
    for (const binding of info.releasedBindings) {
      const list = targets.get(binding.targetUri) ?? []
      list.push(binding)
      targets.set(binding.targetUri, list)
    }
    for (const targetUri of info.editTargets) {
      if (!targets.has(targetUri)) {
        targets.set(targetUri, [])
      }
    }
    for (const [targetUri, bindings] of targets) {
      const uri = vscode.Uri.parse(targetUri)
      let entry = sessions.get(targetUri)
      if (entry) {
        // ① 在途提交排空（带超时兜底：queue 异常滞留不阻塞交接与释放）
        await Promise.race([
          entry.session.settleEdits(),
          new Promise<void>((resolve) => setTimeout(resolve, 5000)),
        ]).catch(() => undefined)
        // ② settle 后再 detach：未确认输入 = 真正未写入的（若有则经
        // detachPanel 触发「关闭残留输入」三项通知——与 B 文档交接分开）
        for (const binding of bindings) {
          entry!.session.detachPanel(binding.virtualSessionId)
        }
      }
      // ③ 最新 dirty 判定（dispose 时刻旧状态不作数；不从磁盘重读生成副本）
      const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === targetUri)
      if (doc && doc.isDirty) {
        // ④ 交接打开（失败：可操作当次反馈，宿主现场保留，不标记已保存）
        try {
          await vscode.window.showTextDocument(doc, { preview: false })
        } catch {
          showHandoffOpenFailure(doc)
        }
      }
      // detach 已完成（或目标只剩记账）→ 判 idle 释放（B 会话可能仍被其他
      // 面板/端口持有，此时为 no-op）
      entry = sessions.get(targetUri)
      if (entry) {
        releaseEntryIfIdle(uri)
      }
    }
  }

  /** P2-13（#290）交接打开失败反馈：当次可操作（重试），保留宿主可用现场
   *  （dirty 文档不受影响），不标记已保存 */
  const showHandoffOpenFailure = (doc: vscode.TextDocument): void => {
    const name = vscode.workspace.asRelativePath(doc.uri, false)
    const retryLabel = t('host.handoffRetry')
    void vscode.window
      .showWarningMessage(t('host.handoffFailed', { name }), retryLabel)
      .then((pick) => {
        if (pick === retryLabel) {
          // showTextDocument 返回 1.86 的 Thenable（无 .catch），async 包装
          void (async (): Promise<void> => {
            try {
              await vscode.window.showTextDocument(doc, { preview: false })
            } catch {
              showHandoffOpenFailure(doc)
            }
          })()
        }
      })
  }

  /** P2-01 验证路由（用户已确认取舍）：为 B 撤销/重做的唯一公开路线是临时
   *  激活 B 为文本编辑器（showTextDocument 恒开文本编辑器——默认编辑器解析
   *  .md 会落回本扩展 custom editor）→ 全局 undo/redo → 重显来源面板 A →
   *  收掉 B 预览标签（只收 isPreview 的——用户已开的钉住文本标签不动）。
   *  标签栏短暂切换与键盘焦点离开 A 是已接受的可见代价。 */
  const historyViaTempActivation = async (
    bDoc: vscode.TextDocument,
    originUri: vscode.Uri,
    op: 'undo' | 'redo',
  ): Promise<boolean> => {
    try {
      // 打开前快照 B 的既有文本标签：收口只关本次激活新增的差集——
      // 1.82.3 实测 Tab.isPreview 对 showTextDocument({preview:true}) 不可靠
      // （恒 false），按差分关标签既收掉临时标签，也不动用户已开的 B 标签
      const tabsBefore = new Set(
        vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) =>
          t.input instanceof vscode.TabInputText &&
          t.input.uri.toString() === bDoc.uri.toString()))
      await vscode.window.showTextDocument(bDoc, { preview: true })
      const executed = await vscode.commands
        .executeCommand(op)
        .then(() => true, () => false)
      // 重显来源面板：openWith 对已开 custom editor 是重显（不新建）；来源
      // 面板可能已关闭（绑定随面板销毁释放，此处为防御）——失败不回滚 B
      if (sessions.get(originUri.toString())?.panels.size) {
        try {
          await vscode.commands.executeCommand('vscode.openWith', originUri, VIEW_TYPE)
        } catch {
          // 来源面板关闭竞态：保留当前激活态
        }
      }
      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
          if (
            tab.input instanceof vscode.TabInputText &&
            tab.input.uri.toString() === bDoc.uri.toString() &&
            !tabsBefore.has(tab)
          ) {
            await vscode.window.tabGroups.close(tab)
          }
        }
      }
      return executed
    } catch {
      return false
    }
  }

  /** P2-05（#282）文档级丢弃路线（P2-01 §5.2 已验证）：激活 B 为文本编辑
   *  （showTextDocument 恒开文本编辑器——默认编辑器解析 .md 会落回本扩展
   *  custom editor）→ **无参** `workbench.action.files.revert`（带 URI 参数
   *  的形态在 1.82.3 证伪且有害——误清活动编辑器 + 多余标签，禁用）→
   *  重显来源面板 A → 差分收掉 B 临时标签（与撤销路由同款收口）。丢弃
   *  恢复整个 B（含其他视图的未保存修改）；revert 不清 undo 历史（宿主
   *  合法语义，用户已确认接受）。激活期间 A 的 webview 可能隐藏卸载、
   *  恢复后重载（P2-04 实测取舍的自然延伸——端口随面板销毁释放，重载
   *  后嵌入重新绑定，最终状态一致）。 */
  const revertViaTempActivation = async (
    bDoc: vscode.TextDocument,
    originUri: vscode.Uri,
  ): Promise<boolean> => {
    try {
      const tabsBefore = new Set(
        vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) =>
          t.input instanceof vscode.TabInputText &&
          t.input.uri.toString() === bDoc.uri.toString()))
      await vscode.window.showTextDocument(bDoc, { preview: true })
      const reverted = await vscode.commands
        .executeCommand('workbench.action.files.revert')
        .then(() => true, () => false)
      if (sessions.get(originUri.toString())?.panels.size) {
        try {
          await vscode.commands.executeCommand('vscode.openWith', originUri, VIEW_TYPE)
        } catch {
          // 来源面板关闭竞态：保留当前激活态
        }
      }
      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
          if (
            tab.input instanceof vscode.TabInputText &&
            tab.input.uri.toString() === bDoc.uri.toString() &&
            !tabsBefore.has(tab)
          ) {
            await vscode.window.tabGroups.close(tab)
          }
        }
      }
      return reverted
    } catch {
      return false
    }
  }

  // ---- P2-12（#289）冲突三项「对比并解决」：untitled 临时副本 + 原生对比
  // 页（P2-01 §6 已验证路线）。临时副本承载 webview 送来的当前未提交输入
  // 全文（LF 形态直接承载——untitled 行尾即 LF）；对比页打开后其编辑/保
  // 存/关闭由宿主管理，扩展不自建解决界面，也不主动关闭已打开的对比页
  //（revert 类命令会误伤 diff 编辑器右侧 B 的未保存修改）。释放闭环：
  // 对比页关闭时 untitled 随之从 textDocuments 释放（宿主生命周期，P2-01
  // §6.3 验证）；打开失败的孤儿副本由扩展自驱清理（showTextDocument +
  // revertAndCloseActiveEditor——作用于 untitled 独立标签，只丢副本自身）。
  // conflictTempUris 只做记账（观察与防泄漏核查），不延长文档寿命。 ----

  /** 冲突临时副本（untitled）记账：在场集合，随 onDidCloseTextDocument 移除 */
  const conflictTempUris = new Set<string>()
  /** 测试钩子注入（VSIDIAN_TEST_HOOKS=1 经 _test.failNextConflictDiff 置位）：
   *  下一次 compare 请求短路为失败——集成测试「API／资源打开失败原现场
   *  可继续选择」断言载体；生产路径恒 false */
  let conflictDiffFailOnce = false

  /** 打开失败的孤儿临时副本清理：副本从未被对比页持有时（executeCommand
   *  抛错形态），自驱关闭其独立标签使其从 textDocuments 释放 */
  const cleanupOrphanConflictTemp = async (temp: vscode.TextDocument): Promise<void> => {
    try {
      if (!vscode.workspace.textDocuments.some((d) => d.uri.toString() === temp.uri.toString())) {
        return // 已释放（宿主生命周期先行）
      }
      await vscode.window.showTextDocument(temp, { preview: true, preserveFocus: true })
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor')
    } catch {
      // 清理失败：副本驻留但无编辑器持有（不可见），单次失败不累计
    } finally {
      conflictTempUris.delete(temp.uri.toString())
    }
  }

  /** 「对比并解决」核心：以给定文本创建 untitled 临时副本并打开 vscode.diff
   *  （左=临时副本、右=真实 B）。P2-13 起两个入口共用——webview 实例的
   *  refEdit.conflictCompare（text 为实例当前全文快照）与父标签关闭后
   *  「关闭残留输入」通知的对比动作（text 为 detachPanel 通知带走的宿主
   *  快照，面板已注销无从回查）。返回 ok = 临时资源完整就绪且对比成功打开；
   *  失败不消耗输入（孤儿副本自驱清理） */
  const openConflictDiffForText = async (
    targetUriStr: string,
    text: string,
  ): Promise<boolean> => {
    let bDoc: vscode.TextDocument | undefined = sessions.get(targetUriStr)?.doc
    if (!bDoc) {
      try {
        bDoc = await vscode.workspace.openTextDocument(vscode.Uri.parse(targetUriStr))
      } catch {
        return false // 目标不可装载：原现场可继续选择（不清输入）
      }
    }
    if (conflictDiffFailOnce) {
      conflictDiffFailOnce = false
      return false // 注入失败：不消耗任何资源
    }
    let temp: vscode.TextDocument
    try {
      temp = await vscode.workspace.openTextDocument({ content: text, language: 'markdown' })
    } catch {
      return false // 临时资源创建失败：原现场可继续选择
    }
    conflictTempUris.add(temp.uri.toString())
    try {
      await vscode.commands.executeCommand(
        'vscode.diff',
        temp.uri,
        bDoc.uri,
        t('host.conflictDiffTitle', { name: vscode.workspace.asRelativePath(bDoc.uri, false) }),
        // P2-01 §6.1 验证形态：override 避免 .md 落回本扩展 custom editor。
        // 不带 preview:false——1.82.3 实测 pinned diff 被 revertAndClose 关闭
        // 时左侧 untitled 会弹独立标签驻留不释放（探针只验证过默认 preview
        // 形态的免提示关闭与释放）；preview 形态下对比页被后续预览替换即随
        // 宿主生命周期释放，与用户关闭同语义
        { override: true },
      )
      return true
    } catch {
      await cleanupOrphanConflictTemp(temp)
      return false
    }
  }

  /** 「对比并解决」执行（webview 实例入口）：临时副本承载实例当前未提交输入
   *  全文（webview 是未提交输入的唯一权威来源——宿主不回查）。结果回
   *  refEdit.conflictCompare.result：ok 前提是临时资源完整就绪且对比成功
   *  打开（webview 收 ok 后才解除暂停重同步）；失败保留原现场。成功后宿主
   *  直驱恢复（对比页激活会隐藏来源面板 webview，恢复不能依赖 webview 再
   *  出站 sync.request：resumePanel 清暂停与旧未提交队列（不重放）；活
   *  webview 由随后的 doc.resync 推送解除暂停 UI，已销毁的 webview 重载后
   *  以 init 全文恢复（暂停已清，不补发 suspended） */
  const openConflictDiff = async (
    binding: RefEditBinding,
    text: string,
    reply: (ok: boolean) => void,
  ): Promise<void> => {
    const ok = await openConflictDiffForText(binding.targetUri, text)
    reply(ok)
    if (ok) {
      sessions.get(binding.targetUri)?.session.resumePanel(binding.virtualSessionId)
    }
  }


  // ---- #201 图片刷新协调器（provider 级单件：版本表与失效通道跨会话共享） ----
  const isWindowsHost = process.platform === 'win32'
  const imageRefreshEvents: string[] = []
  // #337（P3-05）PDF 文件状态版本表（provider 级单件，图片版本表同款语义
  // ——mtime/size 观测推进单调代次；hover.result 的 pdf version 与资源 URI
  // 的 ?v= 戳同源）。独立于图片表：失效通道与代次语义不混用（图片的周期
  // 核验/事件推进不扰动 PDF 目标；PDF 变化经 hover.invalidated 通道刷新）
  const pdfVersions = new ImageVersionTable(isWindowsHost)
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
  /** #338 PDF 磁盘事件去抖计时器（与图片同窗——保存器 rename 成组归并） */
  const pdfWatchTimers = new Map<string, ReturnType<typeof setTimeout>>()
  /** #338 PDF 目标磁盘事件分流：索引域 watcher 只盯 *.md、图片自建管线
   *  只覆盖图片扩展——PDF 的 changed/deleted 在此自建去抖后送 #224 刷新
   *  协调器（hover.invalidated 推送的事件源；闭包晚绑定 hoverEvents——
   *  事件触发恒晚于其声明，与 md 域接线同款前提）。stale 的周期核验挂
   *  图片管线，PDF 事件驱动为一期边界（装载时 stat 三态已覆盖 inaccessible） */
  const schedulePdfEvent = (fsPath: string, status: 'changed' | 'deleted'): void => {
    const prev = pdfWatchTimers.get(fsPath)
    if (prev !== undefined) {
      clearTimeout(prev)
    }
    pdfWatchTimers.set(
      fsPath,
      setTimeout(() => {
        pdfWatchTimers.delete(fsPath)
        hoverEvents.onDiskEvent(fsPath, status)
      }, IMAGE_EVENT_DEBOUNCE_MS),
    )
  }
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
    for (const timer of pdfWatchTimers.values()) {
      clearTimeout(timer)
    }
    pdfWatchTimers.clear()
  }
  const setupImageWatchers = (): void => {
    teardownImageWatchers()
    const folders = vscode.workspace.workspaceFolders
    if (!folders || folders.length === 0) {
      return
    }
    // #338：glob 追加 pdf 段（PDF 磁盘事件与图片共用自建 watcher——分流
    //  在 forward；pdf 不进图片刷新管线，走 #224 协调器）
    const glob = `**/*.{${IMAGE_WATCH_GLOB_SEGMENTS.join(',')},pdf}`
    for (const folder of folders) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder.uri, glob),
      )
      const forward = (uri: vscode.Uri | undefined, pdfStatus: 'changed' | 'deleted'): void => {
        if (!uri) {
          return
        }
        if (isImageFileExtension(uri.fsPath)) {
          scheduleImageEvent(uri.fsPath)
          return
        }
        if (classifyLocalRefContentKind(uri.fsPath) === 'pdf') {
          schedulePdfEvent(uri.fsPath, pdfStatus)
        }
      }
      watcher.onDidChange((uri) => forward(uri, 'changed'))
      watcher.onDidCreate((uri) => forward(uri, 'changed'))
      watcher.onDidDelete((uri) => forward(uri, 'deleted'))
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
  // 管线无匹配登记，天然空操作；未来索引扩展到非 md 目标时自动接通）。
  // #224 引用视图同步：md 域事件直通刷新协调器（changed/deleted/stale
  // 分态——vaultIndex 侧已去抖，deleted 不等防抖窗）；修 1（review 第二轮
  // P2）起经 connectHoverEvents 接线：转发协调器的同时无条件广播全部活跃
  // session 的悬停读取缓存失效（未订阅期间目标修改不留陈旧缓存）——
  // 回调闭包引用 hoverEvents（下方声明），事件触发恒晚于注册
  if (vaultIndex) {
    const offTargetChange = vaultIndex.onTargetChange((event) => {
      diagnostics.record('hover.disk', { fsPath: event.fsPath, status: event.status })
      if (isImageFileExtension(event.fsPath)) {
        scheduleImageEvent(event.fsPath)
      }
      hoverEvents.onDiskEvent(event.fsPath, event.status)
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

  // ---- #224 引用视图刷新协调器（provider 级单件：悬停/嵌入目标订阅与
  //  失效推送跨会话共享；事件源在本文件接线——onDidChangeTextDocument 的
  //  未保存防抖与 vaultIndex.onTargetChange 的磁盘分态直通） ----
  /** sessionKey 编码（docUri 与 sessionId 以 \n 分隔——file URI 不含换行） */
  const hoverSessionKeyOf = (docUri: string, sessionId: string): string => `${docUri}\n${sessionId}`
  /** P2-2（review 修复）越界 hover.watch 忽略计数（debug 日志观测面；
   *  正常链路 watch 总在成功装载后，非零即前端异常或攻陷迹象） */
  let hoverWatchRejected = 0
  const hoverRefresh = new HoverRefreshCoordinator(
    {
      pushInvalidation: (sessionKeys, fsPath, status, generation) => {
        diagnostics.record('hover.invalidate', { fsPath, status, generation, recipients: sessionKeys.length })
        // 只出站消息与清缓存——不得触发宿主事件源（自引用防循环的结构前提）
        for (const sessionKey of sessionKeys) {
          const newlineAt = sessionKey.indexOf('\n')
          const docUri = newlineAt >= 0 ? sessionKey.slice(0, newlineAt) : sessionKey
          const sessionId = newlineAt >= 0 ? sessionKey.slice(newlineAt + 1) : ''
          const entry = sessions.get(docUri)
          if (!entry) {
            continue
          }
          entry.session.invalidateHoverReads(fsPath)
          entry.session.postToPanel(sessionId, { kind: 'hover.invalidated', fsPath, status, generation })
        }
      },
    },
    { isWindowsHost },
  )
  context.subscriptions.push({ dispose: () => hoverRefresh.dispose() })
  // 修 1（review 第二轮 P2）：事件接线——两条事件源经此转发，缓存失效
  // 无条件广播全部活跃 session（不依赖订阅在场），推送门控仍在协调器内
  const hoverEvents = connectHoverEvents(hoverRefresh, () =>
    Array.from(sessions.values(), (entry) => entry.session),
  )

  // ---- B-1（review-loops 波次一）：text 引用目标磁盘事件源 ----
  // 缺陷：#338 自建 watcher 的 glob 只含图片扩展与 pdf，text 目标（#340
  // 的 .txt/.json/代码文件等开放扩展集）的磁盘替换/删除/恢复无事件源
  // ——P3-U7「附件替换、删除／恢复有正确刷新或提示」对 text 不成立。
  // 不为全部 text 扩展建工作区级监听（.json/.ts 在工作区内海量存在），
  // 按已 watch 目标驱动：hover.watch 登记成功时为该目标建 per-file
  // watcher（base=目标所在目录 + 转义文件名，非递归——vs/base/common/
  // glob 的精确匹配形态，1.82.3 源码核对的 API 用法），事件与 pdf 分流
  // 同窗去抖后送 #224 刷新协调器（schedulePdfEvent 同构）。text 目标
  // 扩展判定复用 classifyLocalRefContentKind 的 text 通道口径，不自造
  // 扩展清单。
  // watcher 生命周期独立于订阅登记：常驻至 LRU 淘汰/provider 释放——
  // 退场目标的磁盘事件仍广播 session 缓存失效（修 1 的「unwatch 后修改
  // 不留陈旧缓存」对 text 载荷同样成立），推送门控由协调器 registry.has
  // 早退兜住（未订阅零推送）。挂起去抖计时器随 watcher 语义：事件本身
  // 真实，到期转发正确；teardown 时统一清（review-loops #21 同款边界）
  interface TextWatchSlot {
    watcher: vscode.FileSystemWatcher
  }
  /** 归一键（与协调器 keyOf 同口径：Windows 折叠大小写 + 正斜杠） */
  const textWatchKeyOf = (fsPath: string): string =>
    isWindowsHost ? fsPath.replaceAll('\\', '/').toLowerCase() : fsPath
  /** Map 插入序 = LRU 触达序（HoverWatchRegistry 淘汰同款手法）。上限
   *  语义（#344 RB-1 起）：**无订阅陈旧条目**的淘汰上限——仍有活跃订阅
   *  的目标跳过淘汰（订阅注册表上限 128 为总量的另一道上界，全在 watch
   *  时表可临时超过本值但不无界增长） */
  const textWatchers = new Map<string, TextWatchSlot>()
  const TEXT_WATCHER_LIMIT = 64
  /** text 目标磁盘事件去抖计时器（与 pdf 同窗——保存器 rename 成组归并） */
  const textWatchTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const scheduleTextDiskEvent = (fsPath: string, status: 'changed' | 'deleted'): void => {
    const prev = textWatchTimers.get(fsPath)
    if (prev !== undefined) {
      clearTimeout(prev)
    }
    textWatchTimers.set(
      fsPath,
      setTimeout(() => {
        textWatchTimers.delete(fsPath)
        hoverEvents.onDiskEvent(fsPath, status)
      }, IMAGE_EVENT_DEBOUNCE_MS),
    )
  }
  /** watch 登记成功后调用：text 目标建 per-file watcher（幂等，LRU 触达） */
  const ensureTextWatch = (fsPath: string): void => {
    if (classifyLocalRefContentKind(fsPath) !== 'text') {
      return // md 域走索引 watcher、pdf/image 走自建分流——各有事件源
    }
    const key = textWatchKeyOf(fsPath)
    const prev = textWatchers.get(key)
    if (prev !== undefined) {
      textWatchers.delete(key) // LRU 触达：移到队尾
      textWatchers.set(key, prev)
      return
    }
    const fileUri = vscode.Uri.file(fsPath)
    const slash = fileUri.path.lastIndexOf('/')
    const dirUri = fileUri.with({ path: slash > 0 ? fileUri.path.slice(0, slash) : '/' })
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(dirUri, escapeGlobFilenameLiteral(fileUri.path.slice(slash + 1))),
    )
    watcher.onDidChange((uri) => scheduleTextDiskEvent(uri.fsPath, 'changed'))
    watcher.onDidCreate((uri) => scheduleTextDiskEvent(uri.fsPath, 'changed'))
    watcher.onDidDelete((uri) => scheduleTextDiskEvent(uri.fsPath, 'deleted'))
    textWatchers.set(key, { watcher })
    // #344（P3-12 收口·RB-1）淘汰选取：跳过仍有活跃订阅的目标（订阅在
    // 登记表而事件源被盲 LRU 淘汰 = 磁盘推送承诺落空的不对称修复）。
    // isWatched 传归一键幂等（协调器内部再归一，见纯函数注释）
    for (const victim of selectTextWatchEvictions(
      [...textWatchers.keys()],
      (victimKey) => hoverRefresh.isWatched(victimKey),
      TEXT_WATCHER_LIMIT,
    )) {
      const slot = textWatchers.get(victim)
      textWatchers.delete(victim)
      slot?.watcher.dispose()
    }
  }
  const teardownTextWatches = (): void => {
    for (const slot of textWatchers.values()) {
      slot.watcher.dispose()
    }
    textWatchers.clear()
    for (const timer of textWatchTimers.values()) {
      clearTimeout(timer)
    }
    textWatchTimers.clear()
  }
  context.subscriptions.push({ dispose: teardownTextWatches })

  const getEntry = (uri: vscode.Uri): SessionEntry | undefined =>
    sessions.get(uri.toString())

  // ---- #340（P3-08）文本外观服务（provider 级单件）：语法层 vscode-
  //  textmate + 语义层公开命令 + 主题链复刻（#335 验证路线）；onig WASM
  //  随 VSIX 打包（esbuild 复制到 out/onig.wasm，运行时按扩展目录定位）。
  //  主题/颜色自定义/扩展清单变化 → 失效缓存并广播 appearance.changed
  //  （webview 在场文本视图静默重载——正文载荷含语言级字体，token 随
  //  render 重取；Markdown 侧 CSS 变量自带跟随，忽略该广播） ----
  const appearanceService = new TextAppearanceService(
    vscode.Uri.joinPath(context.extensionUri, 'out', 'onig.wasm').fsPath,
  )
  let appearanceGeneration = 0
  const broadcastAppearanceChanged = (): void => {
    appearanceService.invalidateAppearance()
    appearanceGeneration++
    const message: HostToWebview = { kind: 'appearance.changed', generation: appearanceGeneration }
    for (const entry of sessions.values()) {
      for (const { sessionId } of entry.session.getInfo().panels) {
        entry.session.postToPanel(sessionId, message)
      }
    }
  }
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration('workbench.colorTheme') ||
      event.affectsConfiguration('workbench.preferredDarkColorTheme') ||
      event.affectsConfiguration('workbench.preferredLightColorTheme') ||
      event.affectsConfiguration('window.autoDetectColorScheme') ||
      event.affectsConfiguration('editor.tokenColorCustomizations') ||
      event.affectsConfiguration('editor.semanticTokenColorCustomizations') ||
      event.affectsConfiguration('editor.fontFamily') ||
      event.affectsConfiguration('editor.fontSize') ||
      event.affectsConfiguration('editor.fontLigatures') ||
      event.affectsConfiguration('editor.lineNumbers')) {
      broadcastAppearanceChanged()
    }
  }))
  context.subscriptions.push(vscode.window.onDidChangeActiveColorTheme(() => {
    // 生效主题变化（跟随系统深浅的自动切换、主题预览回落）：此路径
    // workbench.colorTheme 配置值不动、无 configuration 事件——主题身份
    // 复刻（appearanceService 按深浅取 preferred）依赖本事件触发失效与
    // 广播，否则已装配引擎停留旧主题（#340 着色发灰根因修复面）
    broadcastAppearanceChanged()
  }))
  context.subscriptions.push(vscode.extensions.onDidChange(() => {
    // 扩展安装/卸载：grammar/主题贡献集变化（#335 韧性口径——清单重扫）
    broadcastAppearanceChanged()
  }))

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
    // 即时上报的全文快照（#21：含暂停后新输入与暂缓集内容），回退逐笔片段。
    // P2-13（#290）：快照无条件留存（lastClosedInput）——「取消不静默清除
    // 宿主已收到快照」；引用编辑端口（虚拟面板）来源的通知呈现三项当次选择
    // （复用 P2-12 语义），根面板来源维持既有「复制取回」
    lastClosedInput = {
      docUri: notice.docUri,
      webviewText: notice.webviewText,
      fragments: notice.fragments,
      ...(notice.fromRefPort ? { fromRefPort: true } : {}),
    }
    const closedText = notice.webviewText ?? notice.fragments.join('\n')
    if (notice.fromRefPort) {
      // 三项当次选择（与 webview 暂停现场同义）：对比并解决（宿主快照 →
      // 原生对比页，转交不消除快照、不宣称已合并）；放弃当前版本（只丢弃
      // 本次未写入的输入——面板已注销，宿主侧即清除留存快照，B 文档不动，
      // 不借用文档级回滚）；取消（快照原样留存，不自动清除）
      const compareLabel = t('host.conflictCompareLabel')
      const discardVersionLabel = t('host.conflictDiscardLabel')
      void vscode.window
        .showWarningMessage(
          t('host.refClosedWithInput', { name, text: closedText.slice(0, 120) }),
          compareLabel,
          discardVersionLabel,
        )
        .then((pick) => {
          if (pick === compareLabel) {
            void runClosedInputCompare()
          } else if (pick === discardVersionLabel) {
            discardClosedInput()
          }
        })
      return
    }
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

  /** P2-13（#290）「关闭残留输入」的对比并解决：以 lastClosedInput 快照打开
   *  原生对比页（通知按钮与 _test.closedInputConflictDiff 钩子共用同一执行
   *  路径）。转交成功不清除快照（不宣称已合并；临时副本由宿主生命周期释放） */
  const runClosedInputCompare = async (): Promise<boolean> => {
    if (!lastClosedInput) {
      return false
    }
    const text = lastClosedInput.webviewText ?? lastClosedInput.fragments.join('\n')
    if (!text) {
      return false
    }
    return openConflictDiffForText(lastClosedInput.docUri, text)
  }

  /** P2-13（#290）「关闭残留输入」的放弃当前版本：只丢弃本次未写入目标的
   *  输入（宿主侧即清除留存快照）；B 文档与其他视图的修改不受影响，不借用
   *  文档级回滚（放弃语义只作用于未提交版本——P2-12 同款） */
  const discardClosedInput = (): boolean => {
    if (!lastClosedInput) {
      return false
    }
    lastClosedInput = undefined
    return true
  }

  // ---- #38 三态视图编排：全局模式记忆 + 活动模式 context + 恢复决策 ----

  /** 待初始 reading 恢复的面板（resolve 时记忆为 reading；键 `${docUri}::${sessionId}`）。
   *  面板就绪后首份 view.state 到达即消费（见 handlePanelViewState） */
  const pendingReadingRestore = new Set<string>()

  /** 记忆读取/写入（context.globalState；只在成功切换后写入，无历史不写入）。
   *  #169 写后自愈：1.86.2 storage 的旧值迟到回翻会把刚确认的值盖回旧值
   *  （集成宿主仪表化时间线：ack 后被前次写入的迟到回声覆盖、无扩展侧
   *  写入参与）。所有写入方（切换链路与 _test.resetLastMode）统一走
   *  writeRemembered 入口：每次写入前移代数并启动守卫，稳定窗内复查、
   *  翻回且未被更新写入取代时重写（决策纯函数见 viewCycle）。 */
  const readRemembered = (): TriViewMode =>
    readRememberedMode(context.globalState.get.bind(context.globalState))
  let rememberedWriteGeneration = 0
  const healRememberedWrite = (mode: TriViewMode, generation: number): void => {
    let rewritesUsed = 0
    let checksLeft = MODE_MEMORY_HEAL.maxChecks
    const tick = async (): Promise<void> => {
      if (checksLeft <= 0) {
        return
      }
      checksLeft -= 1
      const step = decideModeMemoryHeal({
        target: mode,
        current: readRemembered(),
        isLatestWrite: generation === rememberedWriteGeneration,
        rewritesUsed,
      })
      if (step.action === 'yield' || step.action === 'give-up') {
        if (step.action === 'give-up') {
          console.warn(`[vsidian] mode memory self-heal gave up: target=${mode} current=${readRemembered()}`)
        }
        return
      }
      if (step.action === 'rewrite') {
        rewritesUsed += 1
        await context.globalState.update(LAST_MODE_KEY, mode)
      }
      setTimeout(() => void tick(), MODE_MEMORY_HEAL.checkIntervalMs)
    }
    setTimeout(() => void tick(), MODE_MEMORY_HEAL.checkIntervalMs)
  }
  const writeRemembered = async (mode: TriViewMode): Promise<void> => {
    const generation = ++rememberedWriteGeneration
    await context.globalState.update(LAST_MODE_KEY, mode)
    healRememberedWrite(mode, generation)
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
      // 全局命令作用于活动编辑器，归属不符时静默忽略（不得撤销其他文档）。
      // P2-04（#281）：目标编辑端口在场（origin 携来源面板）时走 P2-01
      // 验证的临时激活路由——B 无 custom editor tab 时撤销归属 B 的唯一
      // 公开路线；带 URI 参数的 files.revert 与 Tab API 关脏标签均禁用
      undo: async (origin?: { docUri: string }) => {
        if (isActiveTabCustomEditorOf(vscode.window.tabGroups.activeTabGroup.activeTab, VIEW_TYPE, doc.uri.toString())) {
          return vscode.commands.executeCommand('undo').then(() => true, () => false)
        }
        if (origin === undefined || refPorts.byTarget(doc.uri.fsPath).length === 0) {
          return false
        }
        return historyViaTempActivation(doc, vscode.Uri.parse(origin.docUri), 'undo')
      },
      redo: async (origin?: { docUri: string }) => {
        if (isActiveTabCustomEditorOf(vscode.window.tabGroups.activeTabGroup.activeTab, VIEW_TYPE, doc.uri.toString())) {
          return vscode.commands.executeCommand('redo').then(() => true, () => false)
        }
        if (origin === undefined || refPorts.byTarget(doc.uri.fsPath).length === 0) {
          return false
        }
        return historyViaTempActivation(doc, vscode.Uri.parse(origin.docUri), 'redo')
      },
    }
    // #201 图片周期核验与失效：会话按自身 linkCtx 解析图源目标（同一 src
    // 在不同文档指向不同文件——目标解析必须按文档）；决策与版本表在协调器
    fresh.session = new DocumentSession(port, {
      docUri: key,
      rootFsPath: doc.uri.fsPath,
      getEmbedDepthLimit: () => {
        const value = settings?.service.getSnapshot()[EMBED_MAX_DEPTH_KEY]
        return typeof value === 'number' ? value : EMBED_MAX_DEPTH_DEFAULT
      },
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
      // #316（b2 形态 1）：webview 重载（同一面板重复 ready）→ 该 sessionId
      // 名下目标编辑端口整体释放（保留 #290 记账——重载→关闭链路的 dirty
      // 交接判定不漏）。本回调只在真实 webview 面板的重复 ready 触发；B 会话
      // 虚拟面板的重复 ready 以 virtualSessionId 调用，注册表按面板键查不到
      // 为无害 no-op
      onPanelReload: (sessionId) => releaseRefPortsOnWebviewReload(key, sessionId),
    })
    sessions.set(key, fresh)
    return fresh
  }

  const releaseEntryIfIdle = (uri: vscode.Uri): void => {
    const entry = sessions.get(uri.toString())
    if (entry && entry.session.getInfo().panels.length === 0) {
      // P2-04：目标端口全部释放后才可能到 idle（虚拟面板计入 panels）；
      // 到此仍指向本目标的端口是异常残留，防御性释放
      for (const binding of refPorts.releaseTarget(uri.toString())) {
        sessions.get(binding.panelDocUri)?.session.postToPanel(binding.panelSessionId, {
          kind: 'refEdit.push',
          portId: binding.portId,
          fsPath: binding.fsPath,
          message: { kind: 'session.suspended', version: entry.doc.version, reason: 'host-error' },
        })
      }
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

  /** openWith 可能先返回、随后才注册新面板；按 URI 等待实际可投递面板。
   *  P2-04：只认真实 webview 面板（entry.panels 内的 sessionId）——B 会话
   *  上的目标编辑虚拟面板虽 ready，但 view.locate 等面板消息不进 refEdit
   *  通道，投给它等于丢失。 */
  const waitForReadyPanel = async (
    uri: vscode.Uri,
    timeoutMs = 5000,
  ): Promise<{ entry: SessionEntry; sessionId: string } | undefined> => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const entry = findEntry(uri)
      const panel = entry?.session
        .getInfo()
        .panels.find((p) => p.ready && entry.panels.has(p.sessionId))
      if (panel) {
        return { entry: entry!, sessionId: panel.sessionId }
      }
      if (Date.now() > deadline) {
        return undefined
      }
      await new Promise((r) => setTimeout(r, 100))
    }
  }

  /** 测试钩子的面板定位口径（与 waitForReadyPanel 同一过滤）：只认真实
   *  webview 面板——P2-04 起被嵌入目标的会话里还有嵌入内部 Live 绑定
   *  attachPanel 的虚拟面板（无 webview 承载），panelIndex 命中虚拟面板
   *  时 view.state.request / sidebar.test.click 等 UI 消息无处理者等于
   *  丢失（CI 回归实证：嵌入样例面板先开、其目标面板的 panels[0] 全为
   *  虚拟面板，反链面板指令从未到达真实面板）。 */
  const realPanelsOf = (entry: SessionEntry | undefined): Array<{ sessionId: string; ready: boolean }> =>
    entry?.session.getInfo().panels.filter((p) => entry.panels.has(p.sessionId)) ?? []

  // ---- #318 外部搜索导航定位恢复（显式命令路径） ----
  // VSCode 不向 custom editor 透传 openEditor 的 selection（公开 API 缺口，
  // microsoft/vscode#289785，#318 跟踪）；恢复路径＝回读搜索树保留的
  // 选中条目（search.action.copyMatch 输出「1-based 行列 + 匹配行全文」
  // 到剪贴板），与目标文档行文本配对恢复位置后经 view.locate 落位
  // （双链锚点同一通道）。仅由用户显式触发（命令/自配键位）——自动捕获
  // 因歧义与副作用已按票面停止条件移除（裁定与证据见 #318 评论）。

  /** 定位恢复结果态：located=已发 view.locate；no-panel=触发时无活动
   *  Vsidian 面板（或 5s 内未就绪）；no-match=copyMatch 无匹配级输出
   *  （命令缺失 / 无选中 / no-op）；no-fit=选中条目与本文件行文本不吻合
   *  （文件身份校验拦截——残留条目不得误定位） */
  type SearchRevealResult = 'located' | 'no-panel' | 'no-match' | 'no-fit'

  /** 观测记录（仅 VSIDIAN_TEST_HOOKS 下留存，供 #318 集成矩阵断言） */
  const searchRevealLog: Array<{ at: number; result: SearchRevealResult }> = []
  const recordSearchReveal = (result: SearchRevealResult): void => {
    if (process.env.VSIDIAN_TEST_HOOKS === '1') {
      searchRevealLog.push({ at: Date.now(), result })
      while (searchRevealLog.length > 64) {
        searchRevealLog.shift()
      }
    }
  }

  /** 剪贴板三步捕获：哨兵 → copyMatch → 回读 → 恢复原文本。no-op（非
   *  匹配级选中不写剪贴板）经哨兵未变识别为无输出。已知副作用：恢复只能
   *  写回文本——捕获前的非文本剪贴板（图片等）被覆盖，#318 矩阵记录该代价 */
  const SEARCH_REVEAL_SENTINEL = '\u0000vsidian-search-reveal\u0000'
  const captureSearchMatch = async (): Promise<string | null> => {
    // before 只在成功读到后恢复：readText 即失败（剪贴板 API reject 极少）
    // 时不执行写回，不把异常路径变成覆盖用户剪贴板
    let before: string | undefined
    try {
      before = await vscode.env.clipboard.readText()
      await vscode.env.clipboard.writeText(SEARCH_REVEAL_SENTINEL)
      await vscode.commands.executeCommand('search.action.copyMatch')
      // copyMatch 写剪贴板在慢环境可能晚于任何固定等待（假阴性）——20ms
      // 短间隔轮询，哨兵一变即返回；超时（500ms）哨兵未变按 no-op 处理
      const deadline = Date.now() + 500
      for (;;) {
        await new Promise((r) => setTimeout(r, 20))
        const value = await vscode.env.clipboard.readText()
        if (value !== SEARCH_REVEAL_SENTINEL) {
          return value
        }
        if (Date.now() >= deadline) {
          return null
        }
      }
    } catch {
      // 剪贴板 API reject / 命令未注册（宿主版本差异）或执行失败：视为无输出
      return null
    } finally {
      if (before !== undefined) {
        // Thenable 无 catch：包 Promise 吞掉恢复写回的 reject（不落未处理 rejection）
        void Promise.resolve(vscode.env.clipboard.writeText(before)).catch(() => {})
      }
    }
  }

  /** 对触发时活动的 Vsidian 面板应用搜索树选中条目位置。目标 uri 在入口
   *  快照（快速连击时旧任务不得把位置落到后来激活的文件上）；首次打开
   *  init 握手未完由 waitForReadyPanel 兜。offset 转 LF 后经 view.locate
   *  发送——flash 高亮由该通道既有语义提供 */
  const searchRevealLocate = async (): Promise<SearchRevealResult> => {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab
    if (!(tab?.input instanceof vscode.TabInputCustom) || tab.input.viewType !== VIEW_TYPE) {
      recordSearchReveal('no-panel')
      return 'no-panel'
    }
    const targetUri = tab.input.uri
    const ready = await waitForReadyPanel(targetUri, 5000)
    if (!ready) {
      recordSearchReveal('no-panel')
      return 'no-panel'
    }
    const raw = await captureSearchMatch()
    const probe = raw === null ? null : parseCopyMatch(raw)
    if (!probe) {
      recordSearchReveal('no-match')
      return 'no-match'
    }
    const docText = ready.entry.doc.getText()
    const hostOffset = matchHostOffset(docText, probe)
    if (hostOffset === null) {
      recordSearchReveal('no-fit')
      return 'no-fit'
    }
    const lfOffset = new NewlineCoordinator(docText).hostOffsetToLf(hostOffset)
    // 分屏同 URI 多面板时 waitForReadyPanel 取首个 ready 面板，定位可能
    // 落在非活动侧——优先活动 tab 的面板（UI_OPERATIONS 同口径：panels
    // 映射的 WebviewPanel.active + session ready），未命中维持既有取值
    const activeSessionId = [...ready.entry.panels.entries()]
      .find(([sessionId, panel]) => panel.active &&
        ready.entry.session.getInfo().panels.some((p) => p.sessionId === sessionId && p.ready))?.[0]
    ready.entry.session.postToPanel(activeSessionId ?? ready.sessionId, {
      kind: 'view.locate',
      offset: lfOffset,
    })
    recordSearchReveal('located')
    return 'located'
  }

  /** 触发串行化链尾：快速重复触发时两个捕获任务交错——B 读到 A 的哨兵、
   *  A 恢复原文后 B 的 finally 又把哨兵写回剪贴板（污染用户剪贴板）。后到
   *  触发排队等待前次完成后执行：幂等场景下重复定位无害，不放弃（放弃会
   *  让双击用户看到误导性失败通知） */
  let searchRevealChain: Promise<void> = Promise.resolve()
  const queuedSearchRevealLocate = (): Promise<SearchRevealResult> => {
    const run = searchRevealChain.then(searchRevealLocate, searchRevealLocate)
    // 链尾吞掉前次结果（含意外 reject），后续触发不因前次失败而断链
    searchRevealChain = run.then(() => undefined, () => undefined)
    return run
  }

  /** 显式触发的统一执行体（命令 / 打开提示按钮共用）：成功由 view.locate
   *  通道的 flash 高亮呈现，失败按结果分型通知——按钮点击 = 显式触发，
   *  与命令同权同反馈，不另写路径 */
  const searchRevealLocateWithFeedback = (): void => {
    void queuedSearchRevealLocate().then((result) => {
      if (result !== 'located') {
        void vscode.window.showWarningMessage(t(result === 'no-panel'
          ? 'host.searchRevealNoPanel'
          : 'host.searchRevealNotFound'))
      }
    }).catch(() => {
      // 意外异常兜底（剪贴板 API reject 等，capture 内部已兜后的残余路径）：
      // 归入安全路径记 no-match 并通知放弃，不落未处理 rejection 到宿主日志
      recordSearchReveal('no-match')
      void vscode.window.showWarningMessage(t('host.searchRevealNotFound'))
    })
  }

  // ---- #318 打开提示（增强入口；2026-10-04 PR #328 验收反馈） ----
  // 从搜索结果打开文档、面板首次激活时弹宿主通知气泡（带「定位」按钮），
  // 把「打开后需手动执行命令」的一步前置为可见入口。**零副作用边界**：
  // 弹出提示本身不做任何剪贴板/捕获/定位动作——这是它与被停止的自动捕获
  // 路径的本质区别（自动捕获在激活时刻就 copyMatch 扰动剪贴板并可能误
  // 定位；本提示只在用户点击按钮后才进入既有显式链路，意图由点击确认）。
  // 已知边界（不实现绕过）：宿主无打开来源信号，提示是猜测性的（资源
  // 管理器/双链打开也弹，去重限频）；恢复会话时启动即激活的面板会弹一条；
  // 已开 tab 上的重复搜索点击无激活翻转事件（原型实证盲区）不弹——命令
  // 与键位入口仍是完整退路。详见 docs/specs/search-reveal.md「打开提示」节。

  /** 会话内已提示过的文档 URI（内存去重不持久化——每文档每会话最多一条：
   *  带按钮通知不自动消失，去重是噪音上限）。仅在实际弹出时记账（设置
   *  关闭期间的激活不占用名额） */
  const searchRevealHintShown = new Set<string>()

  /** 提示观测记录（仅 VSIDIAN_TEST_HOOKS 下留存，供 #318 集成用例断言；
   *  与定位观测记录分开——提示弹出与定位执行是两条独立事件） */
  const searchRevealHintLog: Array<{ at: number; uri: string }> = []
  const recordSearchRevealHint = (uri: string): void => {
    if (process.env.VSIDIAN_TEST_HOOKS === '1') {
      searchRevealHintLog.push({ at: Date.now(), uri })
      while (searchRevealHintLog.length > 64) {
        searchRevealHintLog.shift()
      }
    }
  }

  /** 面板激活分支的提示判定：门控纯函数（去重 × 设置开关）通过即弹通知，
   *  按钮回调走显式定位统一执行体。测试钩子模式下不弹通知本体（避免真
   *  通知堆积干扰自动化），观测记录照常保留供断言（editorGuard 先例） */
  const maybeShowSearchRevealHint = (docUri: vscode.Uri): void => {
    const uriString = docUri.toString()
    const enabled = settings
      ? settings.service.getSnapshot()[SEARCH_REVEAL_HINT_KEY] === true
      : SEARCH_REVEAL_HINT_DEFAULT
    if (!shouldShowSearchRevealHint(searchRevealHintShown, uriString, enabled)) {
      return
    }
    searchRevealHintShown.add(uriString)
    recordSearchRevealHint(uriString)
    if (process.env.VSIDIAN_TEST_HOOKS === '1') {
      return
    }
    const locateButton = t('host.searchRevealHintLocate')
    void vscode.window.showInformationMessage(t('host.searchRevealHint'), locateButton)
      .then((picked) => {
        if (picked === locateButton) {
          searchRevealLocateWithFeedback()
        }
      })
  }

  // ---- #376 T01 双链联想：查询应答（面板级查询意图的执行体） ----

  /** 双链联想查询应答（wikilink.query 同步执行）：无索引服务按无工作区
   *  真实报状态；候选条目为协议稳定契约形态（含经 vaultLink 往返核对的
   *  插入路径与默认别名，均在服务侧完成）。#377 T02 起透传 offset（分页
   *  继续加载）并回传 catalogGen（清单代次——webview 拒收跨代次追加页） */
  const respondWikilinkQuery = (
    doc: vscode.TextDocument,
    message: Extract<WebviewToHost, { kind: 'wikilink.query' }>,
  ): Extract<HostToWebview, { kind: 'wikilink.query.result' }> => {
    const result = vaultIndex
      ? vaultIndex.queryWikilinkFileCandidates(doc.uri.fsPath, message.query, message.offset ?? 0)
      : ({ status: 'unavailable', reason: 'no-workspace' } as const)
    const base = {
      kind: 'wikilink.query.result' as const,
      sessionId: message.sessionId,
      docUri: message.docUri,
      reqId: message.reqId,
      generation: message.generation,
    }
    if (result.status === 'unavailable') {
      return { ...base, status: 'unavailable', reason: result.reason }
    }
    return {
      ...base,
      status: 'ready',
      updating: result.updating,
      total: result.total,
      catalogGen: result.catalogGen,
      items: result.items,
    }
  }

  // ---- #379 T04 双链联想：标题查询应答（面板级查询意图的执行体） ----

  /** 双链联想标题查询应答（wikilink.heading.query 异步执行——目标解析与
   *  正文读取含 IO）：先等本会话在途 edit.request 全部应用（未保存正文
   *  协调——目标==来源文档时候选反映当前有效版本，不以陈旧 TextDocument
   *  枚举；目标==其他文档不受影响，统一等待代价可忽略——queue 通常已空）。
   *  正文依据：已打开 TextDocument 优先（未保存内容不被磁盘替代），未打开
   *  读磁盘最新内容；读取经 queryWikilinkHeadings 编排（shared/vaultLink
   *  同一解析 + shared/wikilinkHeading 同一 ATX 口径）。reqId/generation
   *  原样回显，迟到/乱序由 webview 侧守卫拒收 */
  const respondWikilinkHeadingQuery = async (
    entry: SessionEntry,
    sessionId: string,
    doc: vscode.TextDocument,
    message: Extract<WebviewToHost, { kind: 'wikilink.heading.query' }>,
  ): Promise<void> => {
    await entry.session.whenEditsSettled()
    const folder = vscode.workspace.getWorkspaceFolder(doc.uri)
    const ctx: VaultLinkResolveContext = {
      docDir: path.dirname(doc.uri.fsPath),
      rootDir: (folder ? folder.uri : vscode.Uri.joinPath(doc.uri, '..')).fsPath,
      isWindowsHost: process.platform === 'win32',
      hasWorkspace: folder !== undefined,
    }
    const result = await queryWikilinkHeadings(message.target, message.query, ctx, {
      exists: statFileRealPath,
      openTextDocument: (fsPath) => {
        // 已打开文档优先：未保存内容不被磁盘替代（大小写折叠兜底——
        // Windows 宿主 fsPath 形态可能漂移，真实形态对齐）
        const fold = process.platform === 'win32'
          ? (p: string) => p.toLowerCase()
          : (p: string) => p
        const hit = vscode.workspace.textDocuments.find((d) =>
          d.uri.scheme === 'file' && (d.uri.fsPath === fsPath || fold(d.uri.fsPath) === fold(fsPath)))
        return hit ? { text: hit.getText(), version: hit.version } : null
      },
      openTextDocumentFromDisk: async (fsPath) => {
        const opened = await vscode.workspace.openTextDocument(vscode.Uri.file(fsPath))
        return { text: opened.getText(), version: opened.version }
      },
    })
    const base = {
      kind: 'wikilink.heading.query.result' as const,
      sessionId: message.sessionId,
      docUri: message.docUri,
      reqId: message.reqId,
      generation: message.generation,
    }
    await entry.session.postToPanel(sessionId, result.status === 'unavailable'
      ? { ...base, status: 'unavailable', reason: result.reason }
      : { ...base, status: 'ready', targetVersion: result.targetVersion, items: result.items })
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
      // 形态改版批次字段（snippetStart/snippetLong 等高亮与排序键载荷）随
      // 条目透传——协议侧可选，旧 webview 忽略
      items: result.status === 'ready' ? result.items : [],
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

  // ---- 出链面板：快照应答与条目跳转（与反链镜像；锚点定位复用双链跳转
  //      的 findHeadingOffset / findBlockOffset，不重造） ----

  /** 出链广播序号：按文档单调递增（与 backlinksSeq 独立计数，webview 侧
   *  各自比较降序帧丢弃） */
  const outlinksSeqByDoc = new Map<string, number>()

  /** 出链快照（outlinks.get 应答与 onChange 广播共用） */
  const sendOutlinksSnapshot = async (
    entry: SessionEntry,
    sessionId: string,
    docUri: vscode.Uri,
  ): Promise<void> => {
    const docUriStr = docUri.toString()
    const seq = (outlinksSeqByDoc.get(docUriStr) ?? 0) + 1
    outlinksSeqByDoc.set(docUriStr, seq)
    if (!vaultIndex) {
      entry.session.postToPanel(sessionId, {
        kind: 'outlinks.snapshot',
        docUri: docUriStr,
        state: 'error',
        reason: 'no-workspace',
        items: [],
        seq,
      })
      return
    }
    const result = await vaultIndex.outlinksOf(docUri.fsPath)
    entry.session.postToPanel(sessionId, {
      kind: 'outlinks.snapshot',
      docUri: docUriStr,
      state: result.status,
      updating: result.status === 'ready' ? result.updating : undefined,
      reason: result.status === 'error' ? result.reason : undefined,
      items: result.status === 'ready' ? result.items : [],
      seq,
    })
  }

  /**
   * 出链条目跳转：打开目标并按该链接的实际锚点定位。
   * - Markdown 目标：Vsidian 面板打开（openWith 对已开面板是重显），锚点
   *   命中（标题→findHeadingOffset、#^块id→findBlockOffset，与双链跳转同
   *   一定位器）发 view.locate（LF 坐标换算同双链）；无锚点或未命中回落
   *   文档顶（打开即顶部，不发 locate）。
   * - 非 Markdown 目标（图片等附件）：vscode.open 原生打开（内置预览器），
   *   Vsidian 自定义编辑器不接非 md 文档。
   * targetUri 是平台分隔符 fsPath 形态（快照载荷原样回传），经 Uri.file
   * 解析（与 openBacklinkSource 同口径）。
   */
  const openOutlinkTarget = async (targetUri: string, anchor: string): Promise<void> => {
    const uri = vscode.Uri.file(targetUri)
    if (!/\.md$/i.test(uri.path)) {
      await vscode.commands.executeCommand('vscode.open', uri)
      return
    }
    let anchorOffset: { offset: number; end: number } | null = null
    let anchorDoc: vscode.TextDocument | undefined
    if (anchor !== '') {
      anchorDoc = await vscode.workspace.openTextDocument(uri)
      const text = anchorDoc.getText()
      anchorOffset = anchor.startsWith('^')
        ? findBlockOffset(text, anchor.slice(1))
        : findHeadingOffset(text, anchor)
    }
    await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE)
    if (anchorOffset && anchorDoc) {
      const ready = await waitForReadyPanel(uri)
      if (ready) {
        const lfOffset = new NewlineCoordinator(anchorDoc.getText()).hostOffsetToLf(anchorOffset.offset)
        ready.entry.session.postToPanel(ready.sessionId, { kind: 'view.locate', offset: lfOffset })
      }
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

    // #340（P3-08）text 目标跳转：原生编辑器打开（reveal 到行）——跳转
    // 锚点落点由 #line 决定（仅 range 落窗口起点 B、无锚点落文件顶部）；
    // 双链限定的 #line/#range 锚点在此解析（分词与校验单一事实源在
    // shared/refText）。锚点非法仍打开（顶部）+ 警告提示（同锚点缺失的
    // 「打开后提示」语义）；Markdown 锚点定位保持既有 Vsidian 面板路径
    if (classifyLocalRefContentKind(targetPath) === 'text') {
      let jumpLine = 1
      let anchorInvalid: string | null = null
      if (parsed.heading !== null || parsed.blockId !== null) {
        const anchorRaw = parsed.heading !== null ? parsed.heading : `^${parsed.blockId}`
        const anchorSpec = parsed.heading !== null ? parseTextAnchorSpec(parsed.heading) : null
        if (anchorSpec === null) {
          anchorInvalid = anchorRaw
        } else {
          const textDoc = await vscode.workspace.openTextDocument(targetUri)
          const resolved = resolveTextNav(anchorSpec, textDoc.lineCount)
          if (resolved.ok) {
            jumpLine = resolved.nav.jumpLine
          } else {
            anchorInvalid = anchorRaw
          }
        }
      }
      pushLog({
        kind: 'wikilink-doc',
        target: parsed.path,
        path: targetPath,
        heading: parsed.heading ?? undefined,
        blockId: parsed.blockId ?? undefined,
        locate: jumpLine > 1 ? 'custom-panel' : 'none',
      })
      const textEditor = await vscode.window.showTextDocument(targetUri, { preview: false })
      const lineIdx = Math.min(jumpLine - 1, Math.max(0, textEditor.document.lineCount - 1))
      textEditor.revealRange(
        new vscode.Range(lineIdx, 0, lineIdx, 0),
        vscode.TextEditorRevealType.InCenter,
      )
      if (anchorInvalid !== null) {
        void vscode.window.showWarningMessage(
          t('host.wikilinkTextAnchorInvalid', { link: display, anchor: anchorInvalid }),
        )
      }
      return
    }

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

  /** #218 悬停预览读取上下文：与 executeWikilinkIntent 同款解析语境
   *  （docDir 基准、所属根边界、无工作区判定），供 hoverDocAccess 纯逻辑
   *  装配——读取不依赖写入，不触碰编辑会话 */
  const hoverAccessContextOf = (document: vscode.TextDocument): HoverDocAccessContext => {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri)
    const rootDir = (folder ? folder.uri : vscode.Uri.joinPath(document.uri, '..')).fsPath
    return {
      resolve: {
        docDir: path.dirname(document.uri.fsPath),
        rootDir,
        isWindowsHost: process.platform === 'win32',
        hasWorkspace: folder !== undefined,
      },
      sourceFsPath: document.uri.fsPath,
      rootFsPath: rootDir,
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
      // #316（b2 形态 2）：重显 re-resolve 收编。retainContextWhenHidden 关闭
      // 时 tab 隐藏卸载、重显会再次 resolve 同一 webviewPanel 并分配新
      // sessionId——旧 sessionId 的会话面板条目、entry.panels 条目与
      // panelMessageHandlers 登记只挂 onDidDispose 清理，而该对象若不真正
      // dispose 则旧 binding 的释放通道随旧 sessionId 失效（findOccurrence
      // 三字段含 sessionId，重绑闭环在新 sessionId 下查不到旧端口）。按
      // 【对象同一性】收编同面板旧代：split 场景一个 entry 合法存在多个
      // 不同面板对象的 sessionId，不得按「非当前 sessionId」盲收编；宿主
      // re-resolve 若传入新对象则此处为 no-op（旧对象 dispose 走 closeSub
      // 兜底，同样正确；1.82.3 实测隐藏重显走同对象重复 ready，即形态 1
      // 路径，本收编为防御性正确）。收编释放走保留记账变体（#290 交接
      // 不漏），旧代若有未确认输入经 detachPanel 走「关闭残留输入」通知
      // ——重载场景输入确实已丢失，语义可接受。收编同时消掉旧死条目对
      // getInfo().panels / realPanelsOf 口径的污染（P2-04 起虚拟面板计数
      // 依赖 entry.panels.has 过滤）
      for (const [staleSessionId, stalePanel] of [...entry.panels]) {
        if (stalePanel !== webviewPanel) {
          continue
        }
        releaseRefPortsOnWebviewReload(document.uri.toString(), staleSessionId)
        entry.session.detachPanel(staleSessionId)
        entry.panels.delete(staleSessionId)
        panelMessageHandlers.delete(staleSessionId)
        pendingReadingRestore.delete(panelStateKey(document.uri.toString(), staleSessionId))
        hoverRefresh.releaseSession(hoverSessionKeyOf(document.uri.toString(), staleSessionId))
      }
      const send = (message: HostToWebview): void => {
        if (message.kind === 'init' && diagnostics.enabled) {
          void webviewPanel.webview.postMessage({ kind: 'diagnostics.test.set', enabled: true })
        }
        if (diagnostics.enabled) recordDiagnosticMessage(diagnostics, 'host.send', { ...message, docUri: document.uri.toString() })
        void webviewPanel.webview.postMessage(message)
      }
      // ---- #10 链接跳转与图片资源执行（面板端口注入；URI 解析在宿主侧） ----
      const linkCtx = linkContextOf(document)
      const openLink = (
        intent: { href: string; srcStart: number; srcEnd: number; sourceDocUri?: string },
      ): void => {
        // #160 锚点落位的面板双路依赖（会话表 + 就绪等待）经端口注入：
        // executeLinkIntent 保持模块级（与 vscode 层纯函数分工一致）。
        // #220 来源链接（悬停浮层内）：以 B 文档为解析语境（B 的目录/根
        // 边界；页内 #frag 锚点目标即 B），B 打开失败（悬停后文件被删）时
        // 静默不动作
        const sourceFsPath = intent.sourceDocUri
        if (sourceFsPath !== undefined) {
          void (async () => {
            try {
              const sourceDoc = await vscode.workspace.openTextDocument(
                vscode.Uri.file(sourceFsPath),
              )
              await executeLinkIntent(
                sourceDoc,
                linkContextOf(sourceDoc),
                intent,
                entry.linkLog,
                { waitForReadyPanel },
              )
            } catch {
              // 来源文档不可装载：跳转意图无从解析，丢弃（不回退到面板
              // 自身文档——错误语义）
            }
          })()
          return
        }
        void executeLinkIntent(document, linkCtx, intent, entry.linkLog, {
          waitForReadyPanel,
        })
      }
      // #11 双链跳转执行端口（按需 findFiles 解析 + 打开/定位/反馈）。
      // #220 来源双链（悬停浮层内）：以 B 文档为解析基准（[[#锚点]] 自
      // 引用 B、相对路径按 B 目录），B 打开失败时静默不动作
      const openWikilink = (
        intent: { target: string; srcStart: number; srcEnd: number; sourceDocUri?: string },
      ): void => {
        const sourceFsPath = intent.sourceDocUri
        if (sourceFsPath !== undefined) {
          void (async () => {
            try {
              const sourceDoc = await vscode.workspace.openTextDocument(
                vscode.Uri.file(sourceFsPath),
              )
              await executeWikilinkIntent(sourceDoc, intent, entry.linkLog)
            } catch {
              // 来源文档不可装载：同 openLink 的丢弃语义
            }
          })()
          return
        }
        void executeWikilinkIntent(document, intent, entry.linkLog)
      }
      // #218 悬停预览文档读取端口：hoverDocAccess 无副作用路径（目标解析 +
      // openTextDocument 只装载不显示 + LF 转换）；报告回 hover.result（经
      // 会话 report 闭包回来源面板）。读取异常一律收敛为 read-failed 分态
      // ——就地 i18n 呈现，不弹宿主通知。目标三形态择一：directTarget
      // （#221 反链/出链面板条目的直接目标——宿主快照身份直读；断链条目
      // 空串 fsPath 回 not-found）> linkHref（#219 普通本地 Markdown 链接，
      // 外部网页 webview 已预滤、宿主复核兜底）> target（双链原文）。
      // #333（P3-01）起读取走 readRefContentTarget 类型化分派入口（成功
      // 载荷按 kind 标记；旧扁平入口保留为兼容适配）
      const readHoverTargetPort = (
        payload: HoverPreviewRequestPayload & { verifiedSource?: { fsPath: string; version: number } },
        report: (result: RefReadOutcome) => void,
      ): void => {
        void (async (): Promise<void> => {
          let outcome: RefReadOutcome
          // 在途抓取登记键（try 外声明：finally 清理与 try 内注册共用）
          const webFetchKey = `${document.uri.toString()}#${payload.instanceId}:${payload.reqId}`
          try {
            let sourceDoc = document
            if (payload.source !== undefined) {
              if (!payload.verifiedSource || payload.verifiedSource.fsPath !== payload.source.sourceDocUri) {
                report({ ok: false, reason: 'source-expired' })
                return
              }
              sourceDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(payload.verifiedSource.fsPath))
              if (sourceDoc.version !== payload.verifiedSource.version) {
                report({ ok: false, reason: 'source-expired' })
                return
              }
            }
            const access = hoverAccessContextOf(sourceDoc)
            // #342（P3-10）外链抓取端口与取消注册：开关开（hover.external
            // Enabled）才提供 web 通道——关闭态解析层 unsupported，零网络
            // 请求；在途抓取登记取消句柄（hover.cancel → documentSession
            // 路由 → abort——同 URL 合并的最后消费者离开即断开底层连接）
            const webEnabled = externalHoverEnabled()
            const webAbort = webEnabled ? new AbortController() : undefined
            if (webAbort !== undefined) {
              pendingWebFetches.set(webFetchKey, webAbort)
              webAbort.signal.addEventListener('abort', () => {
                pendingWebFetches.delete(webFetchKey)
              }, { once: true })
            }
            const ports = {
              resolveVaultFile: (rawPath: string) =>
                resolveVaultLinkFile(rawPath, access.resolve, statFileRealPath),
              openTextDocument: async (fsPath: string) => {
                try {
                  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fsPath))
                  // #340：languageId 随读取携带（text 通道的语言身份——
                  // 高亮按用户已装语言插件的原生身份分派）
                  return { version: doc.version, text: doc.getText(), languageId: doc.languageId }
                } catch {
                  return null
                }
              },
              // #340（P3-08）text 通道准入端口：stat 大小与有界头部读取
              //（node fs 直读——workspace.fs 无部分读取；大小超限不打开）
              statFileSize: async (fsPath: string) => {
                try {
                  return (await fsp.stat(fsPath)).size
                } catch {
                  return null
                }
              },
              readFileHead: async (fsPath: string, maxBytes: number) => {
                try {
                  const handle = await fsp.open(fsPath, 'r')
                  try {
                    const buffer = Buffer.alloc(Math.max(0, maxBytes))
                    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
                    return new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead)
                  } finally {
                    await handle.close()
                  }
                } catch {
                  return null
                }
              },
              // #340 语言级生效外观（getConfiguration('editor', doc) 合并读取）
              readTextEditorConfig: async (fsPath: string) => {
                try {
                  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fsPath))
                  const editor = vscode.workspace.getConfiguration('editor', doc)
                  const family = editor.get<string | undefined>('fontFamily')
                  const size = editor.get<number | undefined>('fontSize')
                  const ligatures = editor.get<boolean | string | undefined>('fontLigatures')
                  const lineNumbers = editor.get<string>('lineNumbers', 'on')
                  return {
                    ...(family !== undefined ? { family } : {}),
                    ...(size !== undefined ? { size } : {}),
                    ...(ligatures !== undefined ? { ligatures: ligatures === true } : {}),
                    lineNumbers: lineNumbers !== 'off',
                  }
                } catch {
                  return null
                }
              },
              ...(webAbort !== undefined
                ? {
                  fetchWebMeta: (url: string, signal?: AbortSignal) =>
                    webLinkMeta.fetch(url, signal ?? webAbort.signal, externalHoverShape()),
                }
                : {}),
              // #336（P3-04）图片目标的文件资源版本（mtimeMs——图片不是
              // TextDocument 权威语义；stat 失败由访问层退 0 不构成读取失败）
              statFile: async (fsPath: string) => {
                try {
                  const stat = await vscode.workspace.fs.stat(vscode.Uri.file(fsPath))
                  return { mtimeMs: stat.mtime }
                } catch {
                  return null
                }
              },
              // #337（P3-05）PDF 文件资源端口：stat 三态（FileNotFound =
              // not-found；权限/断连 = inaccessible 不冒充删除）+ asWebviewUri
              // + 文件状态代次戳。本地与 Remote SSH 同通道（webview 资源
              // 服务按远程权威路由）。不装载正文字节——宿主侧零 PDF 解析
              // 代码，PDF 源由 webview 按需 fetch
              readPdfFileResource: async (fsPath: string) => {
                const uri = vscode.Uri.file(fsPath)
                let stat: vscode.FileStat
                try {
                  stat = await vscode.workspace.fs.stat(uri)
                } catch (err) {
                  return isFileNotFound(err) ? { kind: 'not-found' } as const : { kind: 'inaccessible' } as const
                }
                if ((stat.type & vscode.FileType.File) === 0) {
                  return { kind: 'not-found' } as const
                }
                const { generation } = pdfVersions.recordObservation(fsPath, {
                  mtimeMs: stat.mtime,
                  size: stat.size,
                })
                return {
                  kind: 'ok' as const,
                  uri: appendImageVersionStamp(
                    webviewPanel.webview.asWebviewUri(uri).toString(),
                    generation,
                  ),
                  version: generation,
                  bytes: stat.size,
                }
              },
            }
            // #333（P3-01）生产读取走类型化分派入口 readRefContentTarget：
            // 三形态（directTarget/linkHref/target 择一）在共用解析层归一，
            // 按解析出的目标类型分派（markdown 通道装载既有全文载荷；
            // web 通道 #342 装载外链卡片载荷；其余类型 non-markdown 分态
            // ——附件载荷由三期后续票登记）。
            // 旧三入口保留为兼容适配（测试与既有调用等价使用）
            outcome = await readRefContentTarget(
              {
                ...(payload.directTarget !== undefined ? { directTarget: payload.directTarget } : {}),
                ...(payload.linkHref !== undefined ? { linkHref: payload.linkHref } : {}),
                ...(payload.directTarget === undefined && payload.linkHref === undefined
                  ? { target: payload.target }
                  : {}),
              },
              access,
              ports,
              {
                ...(payload.anchorOptional === true ? { anchorOptional: true } : {}),
                ...(webAbort !== undefined ? { web: { enabled: true } } : {}),
              },
            )
          } catch {
            outcome = { ok: false, reason: 'read-failed' }
          } finally {
            // review 修复：登记的取消句柄在 finally 清理——读取抛异常时
            // Map 条目不再残留（残留会滞留已死的 AbortController，阻碍同
            // 键后续抓取的取消注册）
            pendingWebFetches.delete(webFetchKey)
          }
          report(outcome)
        })()
      }
      const resolveImage = async (
        src: string,
        sourceDocUri?: string,
      ): Promise<ImageResolution> => {
        // #208：代次在解析时取值——手动刷新后同 src 的新请求得到新代次戳。
        // #220 来源化解析（悬停浮层 B 身份图片）：以 B 的目录/根边界构造
        // 上下文（同一 classifyImageTarget 白名单与 asWebviewUri 机制）；
        // 缺省 = 面板自身文档
        return resolveWorkspaceImage(
          src,
          sourceDocUri !== undefined ? linkContextOfPath(sourceDocUri) : linkCtx,
          webviewPanel.webview,
          imageRefresh.versions,
          entry.session.getImageGeneration(),
        )
      }
      const sessionId = entry.session.attachPanel({
        send,
        openLink,
        openWikilink,
        readHoverTarget: readHoverTargetPort,
        // #342（P3-10）悬停请求取消路由：webview hover.cancel → 在途 web
        // 抓取消费者中止（markdown 读取不可中止——迟到回包由既有配对守卫
        // 丢弃，行为不变）；key 与 readHoverTargetPort 的登记同构
        cancelHoverRead: (identity) => {
          pendingWebFetches.get(`${document.uri.toString()}#${identity.instanceId}:${identity.reqId}`)?.abort()
        },
        // #340（P3-08）文本 token 计算（外观服务）：版本配对在计算前
        // （目标已推进回 stale，webview 等失效重载）与语义层回包前（3s
        // 计算窗内文档可能再变）各核一次；语义层无 provider/超时/失败
        // 静默不发（语法层保持——「语义暂不可用不抹掉已验证语法层」）
        readTextTokens: (payload, report) => {
          void (async (): Promise<void> => {
            let doc: vscode.TextDocument
            try {
              doc = await vscode.workspace.openTextDocument(vscode.Uri.file(payload.fsPath))
            } catch {
              report({ ok: false, reason: 'stale' })
              return
            }
            if (doc.version !== payload.version) {
              report({ ok: false, reason: 'stale' })
              return
            }
            const tm = await appearanceService.computeTextmateTokens(doc, payload.beginLine, payload.endLine)
            if (doc.version !== payload.version) {
              report({ ok: false, reason: 'stale' })
              return
            }
            if (tm === null) {
              report({ ok: false, reason: 'unavailable' })
              return
            }
            report({ ok: true, layer: 'textmate', colors: tm.colors, tokens: tm.data, version: doc.version })
            const semantic = await appearanceService.computeSemanticTokens(doc, payload.beginLine, payload.endLine)
            if (semantic !== null && doc.version === payload.version) {
              report({ ok: true, layer: 'semantic', colors: semantic.colors, tokens: semantic.data, version: doc.version })
            }
          })()
        },
        // #299 跳转目标提示轻量解析：纯路径计算、零文件系统请求——不读
        // 正文、不建读取与租约链路（用户裁定：诚实反映链接目标，不做存在性探测）
        resolveHoverTarget: (payload, report) => {
          resolveHoverTargetTip(payload, hoverAccessContextOf(document)).then(report)
        },
        readHoverSource: async (fsPath) => {
          try {
            const source = await vscode.workspace.openTextDocument(vscode.Uri.file(fsPath))
            const text = source.getText()
            return { version: source.version, text: new NewlineCoordinator(text).toLfText(text) }
          } catch {
            return null
          }
        },
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
        // #81 代码块复制同走 writeClipboard（text 已由会话按文档 EOL 归一）。
        // 写方向无回执协议（review-loops 已知边界）：写入失败仅记日志——
        // 剪切的选区删除不等回执，失败时文档可 Ctrl+Z 恢复
        writeClipboard: (text: string) => {
          void vscode.env.clipboard.writeText(text).then(undefined, (error: unknown) => {
            console.error('[vsidian] 剪贴板写入失败（text）', error)
          })
        },
        writeHeadingLinkClipboard: (docUri: string, heading: string) => {
          void vscode.env.clipboard.writeText(
            `[[${outlineNoteNameOf(docUri)}#${outlineLinkHeading(heading)}]]`,
          ).then(undefined, (error: unknown) => {
            console.error('[vsidian] 剪贴板写入失败（标题链接）', error)
          })
        },
        // #162 块链接变体：拼 `[[笔记名#^块id]]`（笔记名与标题链接同源；
        // 块 id 字符集 [A-Za-z0-9-] 不含 ] | # ^，无转义议题）
        writeBlockLinkClipboard: (docUri: string, blockId: string) => {
          void vscode.env.clipboard.writeText(
            `[[${outlineNoteNameOf(docUri)}#^${blockId}]]`,
          ).then(undefined, (error: unknown) => {
            console.error('[vsidian] 剪贴板写入失败（块链接）', error)
          })
        },
        // #183 剪贴板读（粘贴桥）：env.clipboard.readText 读回后按 LF 归一
        // （webview 全程 LF 坐标——Windows 剪贴板常见 CRLF；写方向由会话
        // 按文档 EOL 归一，读方向恒 LF）；读失败返回 null（webview 静默放弃）
        readClipboard: async () => {
          try {
            const text = await vscode.env.clipboard.readText()
            return text.replace(/\r\n?/g, '\n')
          } catch {
            return null
          }
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
        // #212 图片导出端口：目标定位 + 读字节 + showSaveDialog + writeFile
        //（字节级拷贝保持原格式）。测试钩子模式短路真实对话框（记录消息
        // 形态供集成断言，与 diagram.export 同款回报 cancelled）
        exportImage: (payload, report) => {
          if (process.env.VSIDIAN_TEST_HOOKS === '1') {
            const key = document.uri.toString()
            const log = imageExportTestLog.get(key) ?? []
            log.push(payload)
            imageExportTestLog.set(key, log)
            report({ ok: false, reason: 'cancelled' })
            return
          }
          // P2-11 sourceDocUri（嵌入内部 Live 弹窗导出）：按 B 目录/根边界
          // 定位导出文件（会话侧已守卫来源为面板送达过的目标）；缺省 = 面板
          // 自身文档
          void runImageExport(
            payload,
            payload.sourceDocUri !== undefined ? linkContextOfPath(payload.sourceDocUri) : linkCtx,
            document.uri.toString(),
            report,
          )
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

      const panelMessageHandler = (message: unknown): void => {
        recordDiagnosticMessage(diagnostics, 'host.receive', message)
        // 粘贴模态记忆只允许更新两个既定偏好，复用现有持久化与广播。
        if (isWebviewToHost(message) && message.kind === 'paste.preferences.set') {
          void (settings?.service.apply({ [PASTE_PRESERVE_FORMATTING_KEY]: message.preserveFormatting,
            [PASTE_ASK_BEFORE_KEY]: false }) ?? Promise.resolve({ ok: false })).then((result) => {
            void webviewPanel.webview.postMessage({ kind: 'paste.preferences.result', reqId: message.reqId, ok: result.ok })
          })
          return
        }
        if (isWebviewToHost(message) && message.kind === 'keybindings.get') {
          void webviewPanel.webview.postMessage({
            kind: 'keybindings.snapshot', overrides: settings?.keybindings.getSnapshot() ?? {},
          })
          return
        }
        // #236 查找选项：get 按面板应答（每次装载拉取）；set 清洗后持久化
        // （workspaceState 工作区级记忆）并广播全部 ready 编辑器面板——
        // 选项是共享状态（多面板一致，#238 选下一处相同词同源消费）
        if (isWebviewToHost(message) && message.kind === 'findOptions.get') {
          void webviewPanel.webview.postMessage({
            kind: 'findOptions.snapshot',
            options: sanitizeFindOptions(settings?.findOptions.load()),
          })
          return
        }
        if (isWebviewToHost(message) && message.kind === 'findOptions.set') {
          if (settings) {
            const options: FindOptions = sanitizeFindOptions(message.options)
            void settings.findOptions.save(options).then(() => {
              for (const entry of sessions.values()) {
                for (const panel of entry.session.getInfo().panels) {
                  if (panel.ready) {
                    void entry.session.postToPanel(panel.sessionId, {
                      kind: 'findOptions.snapshot',
                      options: { ...options },
                    })
                  }
                }
              }
            })
          }
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
        // #239 分词资源状态：面板装载时拉取（应答逐面板构造资源 URI——
        // asWebviewUri 前缀面板私有）；loadResult 为 webview 侧 jieba 动态
        // 加载失败回报（宿主校验通过但 webview 运行时不兼容的场景），
        // 转服务记 notice 并通知用户
        if (jieba && isWebviewToHost(message) && message.kind === 'wordSegment.get') {
          void webviewPanel.webview.postMessage({ kind: 'wordSegment.state', ...jieba.stateFor(webviewPanel.webview) })
          return
        }
        if (jieba && isWebviewToHost(message) && message.kind === 'wordSegment.loadResult') {
          if (!message.ok) {
            jieba.service.reportLoadFailed(message.detail)
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
        // 出链面板（与反链镜像）：快照拉取应答与条目跳转意图
        if (vaultIndex && isWebviewToHost(message) && message.kind === 'outlinks.get' &&
          message.docUri === document.uri.toString()) {
          void sendOutlinksSnapshot(entry, sessionId, document.uri)
          return
        }
        if (isWebviewToHost(message) && message.kind === 'outlink.activate') {
          void openOutlinkTarget(message.targetUri, message.anchor)
          return
        }
        // #376 T01 双链联想查询：主正文经原会话（嵌入实例不出站本消息）。
        // 会话守卫：docUri 归属本面板文档；查询为内存模型同步执行（无 IO），
        // reqId/generation 原样回显，迟到/乱序由 webview 侧守卫拒收
        if (isWebviewToHost(message) && message.kind === 'wikilink.query' &&
          message.docUri === document.uri.toString()) {
          entry.session.postToPanel(sessionId, respondWikilinkQuery(document, message))
          return
        }
        // #379 T04 标题联想查询：主正文经原会话（同 wikilink.query 边界）。
        // 会话守卫：docUri 归属本面板文档；异步执行（目标解析与正文读取含
        // IO），先等本会话在途编辑应用（未保存正文协调），迟到/乱序由
        // webview 侧 reqId+generation 守卫拒收
        if (isWebviewToHost(message) && message.kind === 'wikilink.heading.query' &&
          message.docUri === document.uri.toString()) {
          void respondWikilinkHeadingQuery(entry, sessionId, document, message)
          return
        }
        // #224 引用视图订阅：provider 层拦截（协调器与订阅表在 provider 域，
        // 与 backlinks 先例同位）。会话守卫：docUri 归属本面板文档且 sessionId
        // 为本面板（不信任前端任意身份）；P2-2（review 修复）watch 的 fsPath
        // 须为该会话 hoverSourceFsPaths 集合成员（watch 总在成功装载后，集合
        // 已含目标——被攻陷 webview 伪造的越界 watch 静默忽略并计数），与
        // #220 来源资源守卫同一信任边界；unwatch 只释放既有登记，无越界增益
        // 不设校验
        if (isWebviewToHost(message) &&
          (message.kind === 'hover.watch' || message.kind === 'hover.unwatch') &&
          message.docUri === document.uri.toString() && message.sessionId === sessionId) {
          const sessionKey = hoverSessionKeyOf(message.docUri, message.sessionId)
          if (message.kind === 'hover.watch') {
            const admitted = admitHoverWatch(hoverRefresh, entry.session,
              { sessionKey, sessionId, fsPath: message.fsPath, instanceId: message.instanceId,
                sourceLeaseId: message.sourceLeaseId }, () => {
              if (message.sourceLeaseId !== undefined) {
                void entry.session.handleWebviewMessage({ kind: 'hover.source.release',
                  sessionId, docUri: message.docUri, sourceLeaseId: message.sourceLeaseId }, sessionId)
              }
              })
            if (admitted !== 'ok') {
              send({ kind: 'hover.watch.rejected', fsPath: message.fsPath,
                instanceId: message.instanceId, reason: admitted,
                ...(message.sourceLeaseId !== undefined ? { sourceLeaseId: message.sourceLeaseId } : {}) })
              hoverWatchRejected += 1
              console.debug(
                '[vsidian] hover.watch 目标不在本面板来源集合，已忽略',
                message.fsPath,
                `累计 ${hoverWatchRejected} 次`,
              )
            } else {
              // B-1：text 目标的磁盘事件源按登记驱动建立（md/pdf/image
              // 各有事件源，内部按扩展分类空操作）
              ensureTextWatch(message.fsPath)
            }
          } else {
            void entry.session.handleWebviewMessage(message, sessionId)
            hoverRefresh.unwatch(sessionKey, message.fsPath, message.instanceId)
          }
          return
        }
        if (process.env.VSIDIAN_TEST_HOOKS === '1' && isWebviewToHost(message) &&
          message.kind === 'sync.test.close' && message.sessionId === sessionId &&
          message.docUri === document.uri.toString()) {
          webviewPanel.dispose()
          return
        }
        // ---- P2-04（#281）目标编辑端口：bind/unbind/message/save 在 provider
        // 层拦截（B 会话接入与端口簿记都在 provider 域；不进 A 的会话通道）。
        // 面板身份先认证（panelSessionId/panelDocUri 须为本面板），后续按
        // portId 查绑定——释放后的迟到消息查不到即静默拒收
        if (isWebviewToHost(message) &&
          (message.kind === 'refEdit.bind' || message.kind === 'refEdit.unbind' ||
            message.kind === 'refEdit.message' || message.kind === 'refEdit.save' ||
            message.kind === 'refEdit.close.query' || message.kind === 'refEdit.close.execute' ||
            message.kind === 'refEdit.conflictCompare')) {
          if (message.panelSessionId !== sessionId || message.panelDocUri !== document.uri.toString()) {
            // #319 拒收观测面：合法时序（面板释放后迟到）与伪造不可区分，
            // 留一行日志定位（不回喂——防伪造语义不变）
            console.debug('[vsidian] refEdit 族消息面板身份不符拒收', {
              kind: message.kind,
              panelSessionId: message.panelSessionId,
              panelDocUri: message.panelDocUri,
              expectSessionId: sessionId,
            })
            return
          }
          switch (message.kind) {
            case 'refEdit.bind': {
              const reject = (reason: 'source' | 'open-failed' | 'not-markdown'): void => {
                send({ kind: 'refEdit.bound', reqId: message.reqId, ok: false, reason })
              }
              // 来源校验（不信任前端自报 URI）：目标须为本面板成功送达且被
              // 该 occurrence 的 watch 固定（P2-A04「从已确认的来源租约绑定」）
              if (!entry.session.hasHoverSourcePin(sessionId, message.fsPath, message.occurrence)) {
                reject('source')
                return
              }
              void (async (): Promise<void> => {
                let bDoc: vscode.TextDocument
                try {
                  bDoc = await vscode.workspace.openTextDocument(vscode.Uri.file(message.fsPath))
                } catch {
                  reject('open-failed')
                  return
                }
                // #316 测试缝（生产恒 false 走不到）：bind 在途屏障——await
                // 恢复后挂起，供集成用例在窗口内注入面板 dispose（red 证据：
                // 复查缺位时 register 照常执行成为孤儿）
                if (process.env.VSIDIAN_TEST_HOOKS === '1' && refEditBindSuspend) {
                  refEditBindSuspendHits += 1
                  await refEditBindSuspend
                }
                if (!isMarkdownFile(bDoc.uri)) {
                  reject('not-markdown')
                  return
                }
                // #316 方案 a：await 恢复后复查来源面板仍存活。openTextDocument
                // 的 await 区间内面板可能已 dispose——closeSub 的 releasePanel
                // 查不到在途 binding 静默返回，此处不复查则 register 照常执行，
                // 而该 binding 的释放通道（onDidDispose）已消费，成为钉住 B
                // 会话的永久孤儿。复查通过后到 register 全同步无交错点。
                // 判定依据 entry.panels.has：closeSub 先删该条目再做释放；闭包
                // 捕获的 entry 对象即使已被 releaseEntryIfIdle 从 sessions 移除，
                // Map.delete 只删映射不动对象内容，判定依然正确。回包不发——
                // 面板已死收不到
                if (!entry.panels.has(sessionId)) {
                  // #319 拒收观测面：回包不发（面板已死收不到），日志留痕
                  console.debug('[vsidian] refEdit.bind 来源面板已释放，放弃注册端口', {
                    fsPath: message.fsPath,
                    occurrence: message.occurrence,
                    panelSessionId: sessionId,
                  })
                  return
                }
                // 同 occurrence 幂等重绑：先释放旧端口（重挂路径）
                const stale = refPorts.findOccurrence(sessionId, document.uri.toString(), message.occurrence)
                if (stale) {
                  releaseRefPort(stale.portId)
                }
                const bEntry = openEntry(bDoc)
                const portId = refPorts.allocate()
                const binding = {
                  portId,
                  virtualSessionId: '',
                  targetUri: bDoc.uri.toString(),
                  fsPath: message.fsPath,
                  panelSessionId: sessionId,
                  panelDocUri: document.uri.toString(),
                  occurrence: message.occurrence,
                  lastDirty: bDoc.isDirty,
                }
                // attachPanel 分配 B 会话内的面板 id（panel-N）——会话消息
                // 路由（ready 注入 / refEdit.message / detach）用它；portId
                // 只是 webview 侧的端口身份，两者分开（根因修正：曾误用
                // portId 注入 ready，会话查不到面板被静默丢弃）。
                // P2-11（#288）资源端口随虚拟面板注入（全部按 B 身份构造）：
                // - resolveImage：B 目录/根边界解析，URI 在来源面板 A 的
                //   webview 构造（asWebviewUri 前缀面板私有——B 的结果最终
                //   在 A 内加载）
                // - pasteImage：目录解析与相对路径基准 = B 的 URI、工作区
                //   folder 按 B 归属（粘贴资产按 B 的配置落盘，不写父文档）
                // - openLink/openWikilink：以 B 为解析语境执行（B 打开失败
                //   静默不动作，与 #220 来源路径同语义）
                const bLinkCtx = linkContextOf(bDoc)
                binding.virtualSessionId = bEntry.session.attachPanel({
                  send: (m) => {
                    if (!refPorts.lookup(portId, sessionId, document.uri.toString())) {
                      return
                    }
                    // P2-13（#290）「曾成功写入」记账：本端口发起的编辑经 B 会话
                    // 确认（edit.ack ok）即登记——端口后续释放（离屏回收/切
                    // Reading）后，父标签关闭交接的判定集合仍含该目标
                    if (m.kind === 'edit.ack' && m.ok) {
                      refPorts.noteEditAck(sessionId, document.uri.toString(), binding.targetUri)
                    }
                    const wrapped = wrapRefEditPush(binding, m)
                    if (wrapped) {
                      send(wrapped)
                    }
                  },
                  resolveImage: (src) =>
                    resolveWorkspaceImage(
                      src,
                      bLinkCtx,
                      webviewPanel.webview,
                      imageRefresh.versions,
                      bEntry.session.getImageGeneration(),
                    ),
                  pasteImage: (payload, report) => {
                    if (process.env.VSIDIAN_TEST_HOOKS === '1') {
                      const key = bDoc.uri.toString()
                      const log = imagePasteTestLog.get(key) ?? []
                      log.push(payload)
                      imagePasteTestLog.set(key, log)
                    }
                    void runImagePaste(
                      payload,
                      {
                        settings: settings?.service.getSnapshot() ?? {},
                        docUri: bDoc.uri,
                        workspaceRootPath:
                          vscode.workspace.getWorkspaceFolder(bDoc.uri)?.uri.path ?? null,
                      },
                      report,
                    )
                  },
                  openLink: (intent) => {
                    void executeLinkIntent(bDoc, bLinkCtx, intent, bEntry.linkLog, {
                      waitForReadyPanel,
                    })
                  },
                  openWikilink: (intent) => {
                    void executeWikilinkIntent(bDoc, intent, bEntry.linkLog)
                  },
                  // P2-14（#291）#81 复制端口随虚拟面板注入：嵌入内代码卡
                  // 复制经端口进 B 会话（codeblock.copy 按自身 docUri 守卫
                  // + B 文档 EOL 归一）后由剪贴板端口执行——与根面板同语义
                  writeClipboard: (text: string) => {
                    void vscode.env.clipboard.writeText(text).then(undefined, (error: unknown) => {
                      console.error('[vsidian] 剪贴板写入失败（嵌入代码卡复制）', error)
                    })
                  },
                }, { refOrigin: { docUri: document.uri.toString() } })
                refPorts.register(binding)
                send({
                  kind: 'refEdit.bound',
                  reqId: message.reqId,
                  ok: true,
                  portId,
                  fsPath: message.fsPath,
                  docUri: bDoc.uri.toString(),
                  version: bDoc.version,
                  dirty: bDoc.isDirty,
                })
                // 注入 ready 握手：B 会话发 init（经虚拟面板 → refEdit.push）
                void bEntry.session.handleWebviewMessage({ kind: 'ready' }, binding.virtualSessionId)
              })()
              return
            }
            case 'refEdit.unbind': {
              const binding = refPorts.lookup(message.portId, sessionId, document.uri.toString())
              if (binding && binding.fsPath === message.fsPath) {
                releaseRefPort(message.portId)
              }
              return
            }
            case 'refEdit.message': {
              const binding = refPorts.lookup(message.portId, sessionId, document.uri.toString())
              if (!binding || binding.fsPath !== message.fsPath || !isRefEditClientMessage(message.message)) {
                // 释放后迟到消息 / 伪造端口 / 非编辑通道：静默拒收（不回喂）
                console.debug('[vsidian] refEdit.message 静默拒收', {
                  portId: message.portId,
                  fsPath: message.fsPath,
                  reason: !binding ? 'port-not-found'
                    : binding.fsPath !== message.fsPath ? 'fsPath-mismatch' : 'inner-not-whitelisted',
                  innerKind: message.message.kind,
                })
                return
              }
              const bEntry = sessions.get(binding.targetUri)
              if (!bEntry) {
                console.debug('[vsidian] refEdit.message 目标会话缺失拒收', {
                  portId: message.portId,
                  targetUri: binding.targetUri,
                })
                return
              }
              // 内消息的 docUri 由 B 会话按自身校验（= B 规范 URI）；面板
              // 身份用绑定的虚拟面板 id（webview 侧 portId 仅作路由键）
              void bEntry.session.handleWebviewMessage(message.message, binding.virtualSessionId)
              return
            }
            case 'refEdit.save': {
              const binding = refPorts.lookup(message.portId, sessionId, document.uri.toString())
              if (!binding || binding.fsPath !== message.fsPath) {
                console.debug('[vsidian] refEdit.save 静默拒收', {
                  portId: message.portId,
                  fsPath: message.fsPath,
                  reason: !binding ? 'port-not-found' : 'fsPath-mismatch',
                })
                return
              }
              void (async (): Promise<void> => {
                // P2-01 验证路线：TextDocument.save() 无需激活 B 即落盘
                //（保存失败返回 false——保留现场，dirty 推送另行对齐）
                const bDoc = sessions.get(binding.targetUri)?.doc ??
                  (await vscode.workspace.openTextDocument(vscode.Uri.parse(binding.targetUri)))
                let ok = false
                try {
                  ok = (await bDoc.save()) === true
                } catch {
                  ok = false
                }
                if (ok) {
                  binding.lastDirty = false
                }
                send({ kind: 'refEdit.save.result', portId: message.portId, fsPath: message.fsPath, ok })
              })()
              return
            }
            case 'refEdit.close.query': {
              // P2-05（#282）显式关闭意图开始：统一检查目标 B 最新权威状态
              //（dirty/version——模态呈现与确认基线的单一事实源，不信任
              // webview 缓存的 dirty 推送时序）
              const binding = refPorts.lookup(message.portId, sessionId, document.uri.toString())
              if (!binding || binding.fsPath !== message.fsPath) {
                console.debug('[vsidian] refEdit.close.query 静默拒收', {
                  portId: message.portId,
                  fsPath: message.fsPath,
                  reqId: message.reqId,
                  reason: !binding ? 'port-not-found' : 'fsPath-mismatch',
                })
                return
              }
              void (async (): Promise<void> => {
                let bDoc: vscode.TextDocument | undefined = sessions.get(binding.targetUri)?.doc
                if (!bDoc) {
                  try {
                    bDoc = await vscode.workspace.openTextDocument(vscode.Uri.parse(binding.targetUri))
                  } catch {
                    // 目标不可装载（极罕见——bind 成功过）：#319 回干净态
                    // 闭环——webview 走「干净目标直接完成退出」，closePendingQuery
                    // 即时清槽，他 entry 的关闭/Esc/删除意图不再被挡至离屏。
                    // version 无权威可取填 0（消费侧 Math.max 聚合，不回退
                    // 基线）；relPath 退化填 fsPath（仅 dirty 模态文案使用，
                    // dirty=false 不触达）
                    console.warn('[vsidian] refEdit.close.query 目标装载失败，回干净态闭环',
                      { reqId: message.reqId, fsPath: message.fsPath, targetUri: binding.targetUri })
                    send({
                      kind: 'refEdit.close.state',
                      reqId: message.reqId,
                      fsPath: message.fsPath,
                      dirty: false,
                      version: 0,
                      relPath: message.fsPath,
                    })
                    return
                  }
                }
                send({
                  kind: 'refEdit.close.state',
                  reqId: message.reqId,
                  fsPath: message.fsPath,
                  dirty: bDoc.isDirty,
                  version: bDoc.version,
                  relPath: vscode.workspace.asRelativePath(bDoc.uri, false),
                })
              })()
              return
            }
            case 'refEdit.close.execute': {
              // P2-05（#282）确认后的关闭动作执行。版本守卫（双防线第二道）：
              // B 当前版本 ≠ 用户确认基线即回 stale 重新确认——不得用旧确认
              // 丢弃新修改。save：TextDocument.save 失败保留现场；保存后再验
              // dirty/版本（保存期间又有新修改 → stale）。discard：P2-01 已验证
              // 的激活 B → 无参 revert → 重显 A → 收临时标签（恢复整个 B，
              // 含其他视图的未保存修改）。多 occurrence 同目标重复 execute 因
              // revert 推进版本，第二次到达即 stale——不重复回滚。
              const binding = refPorts.lookup(message.portId, sessionId, document.uri.toString())
              if (!binding || binding.fsPath !== message.fsPath) {
                console.debug('[vsidian] refEdit.close.execute 静默拒收', {
                  portId: message.portId,
                  fsPath: message.fsPath,
                  reqId: message.reqId,
                  action: message.action,
                  reason: !binding ? 'port-not-found' : 'fsPath-mismatch',
                })
                return
              }
              void (async (): Promise<void> => {
                const reply = (outcome: 'closed' | 'save-failed' | 'discard-failed' | 'stale'): void => {
                  send({ kind: 'refEdit.close.result', reqId: message.reqId, fsPath: message.fsPath, outcome })
                }
                let bDoc: vscode.TextDocument | undefined = sessions.get(binding.targetUri)?.doc
                if (!bDoc) {
                  try {
                    bDoc = await vscode.workspace.openTextDocument(vscode.Uri.parse(binding.targetUri))
                  } catch {
                    reply(message.action === 'save' ? 'save-failed' : 'discard-failed')
                    return
                  }
                }
                if (bDoc.version !== message.confirmedVersion) {
                  reply('stale')
                  return
                }
                if (message.action === 'save') {
                  let ok = false
                  try {
                    ok = (await bDoc.save()) === true
                  } catch {
                    ok = false
                  }
                  if (!ok) {
                    reply('save-failed')
                    return
                  }
                  // 保存成功后再验：另一视图又有新修改（dirty 重现/版本前移）
                  // 时不关闭，重新确认
                  if (bDoc.isDirty || bDoc.version !== message.confirmedVersion) {
                    reply('stale')
                    return
                  }
                  binding.lastDirty = false
                  reply('closed')
                  return
                }
                const reverted = await revertViaTempActivation(bDoc, document.uri)
                if (!reverted) {
                  reply('discard-failed')
                  return
                }
                if (bDoc.isDirty) {
                  // revert 后仍有未保存修改（异常形态）：不宣称关闭成功
                  reply('stale')
                  return
                }
                binding.lastDirty = false
                reply('closed')
              })()
              return
            }
            case 'refEdit.conflictCompare': {
              // P2-12（#289）「对比并解决」：临时副本 + 原生对比页（P2-01 §6
              //  验证路线）。身份校验与 refEdit.save 同口径；text 为 webview
              //  送来的实例当前全文快照（宿主不回查——webview 是未提交输入
              //  的唯一权威来源）
              const binding = refPorts.lookup(message.portId, sessionId, document.uri.toString())
              if (!binding || binding.fsPath !== message.fsPath) {
                console.debug('[vsidian] refEdit.conflictCompare 静默拒收', {
                  portId: message.portId,
                  fsPath: message.fsPath,
                  reason: !binding ? 'port-not-found' : 'fsPath-mismatch',
                })
                return
              }
              void openConflictDiff(binding, message.text, (ok) => {
                send({
                  kind: 'refEdit.conflictCompare.result',
                  portId: message.portId,
                  fsPath: message.fsPath,
                  ok,
                })
              })
              return
            }
          }
        }
        void entry.session.handleWebviewMessage(message, sessionId)
      }
      const messageSub = webviewPanel.webview.onDidReceiveMessage(panelMessageHandler)
      // P2-11（#288）测试钩子配套：按会话面板登记处理器——refEdit.* 在
      // provider 层拦截（进会话之前），injectWebviewMessage 走会话入口
      // 无法触达；本登记供 injectWebviewReceived 以真实 webview 消息的
      // 同一处理入口注入（校验与路由完全一致）
      panelMessageHandlers.set(sessionId, panelMessageHandler)
      // #38：面板激活（tab 切换/分组聚焦）时刷新活动模式 context——
      // custom editor 不触发 onDidChangeActiveTextEditor，靠此事件覆盖；
      // #318 打开提示：同一激活分支顺带做提示判定（门控不通过时零动作）。
      // 「打开即激活」形态无 viewState 变化事件（1.82.3 实测：vscode.open
      // 创建面板即 active，事件零触发；上方弹回源码的 bounceToSource 对
      // 同形态同样直接查初始态）——resolve 时刻补一次判定，去重 Set 保证
      // 与后续事件路径每会话至多合计一条
      if (webviewPanel.active) {
        maybeShowSearchRevealHint(document.uri)
      }
      const viewStateSub = webviewPanel.onDidChangeViewState((e) => {
        if (e.webviewPanel.active) {
          refreshActiveModeContext()
          maybeShowSearchRevealHint(document.uri)
        }
      })
      const closeSub = webviewPanel.onDidDispose(() => {
        entry.session.detachPanel(sessionId)
        entry.panels.delete(sessionId)
        pendingReadingRestore.delete(panelStateKey(document.uri.toString(), sessionId))
        // #224 引用视图订阅随面板销毁整体释放（订阅计数回落）
        hoverRefresh.releaseSession(hoverSessionKeyOf(document.uri.toString(), sessionId))
        // P2-04：本面板的目标编辑端口簿记立即释放（来源 webview 已销毁，
        // 释放后迟到消息按 portId 查不到即拒收）。
        // P2-13（#290）：虚拟面板 detach 与 dirty 交接移入异步流程——先等
        // 宿主可继续完成的在途提交再判最新 dirty（不能只看 dispose 时刻的
        // 旧状态）；先取「曾成功写入」记账再 releasePanel（其内部清账）
        const editTargets = refPorts.panelEditTargets(sessionId, document.uri.toString())
        const releasedBindings = refPorts.releasePanel(sessionId, document.uri.toString())
        void handoffDirtyTargetsOnClose({ editTargets, releasedBindings })
        messageSub.dispose()
        panelMessageHandlers.delete(sessionId)
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
      // 快照取一次（#93 语言与 #292 可读行宽预注入共用）
      const settingsSnapshot = settings?.service.getSnapshot()
      webviewPanel.webview.html = buildWebviewHtml(
        webviewPanel.webview,
        context.extensionUri,
        // #93 生效语言：读语言设置（#4 注册 general.language 前缺省 auto）
        // 按宿主显示语言解析；数据岛注入当前语言包（webview 零字典字节）
        hostLocale(settingsSnapshot),
        {
          // #292 非 0 档可读行宽预写 #app 内联变量（消除骨架期宽度回跳）；
          // 后续 applyReadableLineWidthSetting 的 0 档移除/非 0 覆写语义不变
          readableLineWidthPx: readableLineWidthPreset(settingsSnapshot?.[READABLE_LINE_WIDTH_KEY]),
          // #292 集成测试冻结骨架撤除（C-11 同款宿主侧门控：生产不嵌入）
          holdSkeleton: process.env.VSIDIAN_TEST_HOOKS === '1',
        },
      )
    },
  }

  // #270 dirty 丢弃/还原的覆盖层通用退役信号：「空 contentChanges 且文档
  // 转 clean」的 dirty-state 事件是 1.86 宿主对「未保存内容不复存在」的
  // 必达广播——丢弃无回滚 change、普通文本编辑器丢弃无 close 事件且文档
  // 滞留 textDocuments（#270 集成实证），此前该终态无任何退役通道（幽灵
  // 反链窗口）。保存路径另有 onDidSaveTextDocument → documentSaved 先行/
  // 后至皆幂等无害；延迟一个宽限窗执行只为合并保存流的紧随事件。Vsidian
  // 面板丢弃另有 close 事件路径（既有接线），本信号对齐同一终态、双保险。
  const cleanRetireTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const cancelCleanRetire = (fsPath: string): void => {
    const timer = cleanRetireTimers.get(fsPath)
    if (timer !== undefined) {
      clearTimeout(timer)
      cleanRetireTimers.delete(fsPath)
    }
  }
  const scheduleCleanRetire = (fsPath: string): void => {
    cancelCleanRetire(fsPath)
    cleanRetireTimers.set(fsPath, setTimeout(() => {
      cleanRetireTimers.delete(fsPath)
      vaultIndex?.documentClosed(fsPath)
    }, 800))
  }
  context.subscriptions.push({
    dispose: () => {
      for (const timer of cleanRetireTimers.values()) {
        clearTimeout(timer)
      }
      cleanRetireTimers.clear()
    },
  })

  // 权威文档变更入口：一切来源（本扩展写回、原生编辑器、其他扩展、
  // undo/redo）的变更都进入 session 识别与广播
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      diagnostics.record('document.changed', { fsPath: event.document.uri.fsPath,
        version: event.document.version, changes: event.contentChanges.length, dirty: event.document.isDirty })
      // #197 索引覆盖层：消费原始事件（不经 session 产物——任何编辑器打开
      // 的 .md 都是索引来源域）；服务内做版本仲裁与去抖，未保存内容不落盘
      if (vaultIndex && event.document.uri.scheme === 'file' && /\.md$/i.test(event.document.uri.path)) {
        vaultIndex.applyUnsaved(
          event.document.uri.fsPath,
          event.document.version,
          event.document.getText(),
        )
        // #270：转 clean 的 dirty-state 事件（空 contentChanges）= 未保存
        // 内容终结（丢弃/还原实测必发；undo 回保存态时若宿主另发该信号
        // 同样覆盖——undo 自身是内容事件，走作废分支）——调度覆盖层退役；
        // 反之（内容事件或转 dirty）作废在途信号——文档再入未保存态，先前
        // 的 clean 信号已过期（否则丢弃后排定的退役会误清紧随的新编辑暂存）
        if (event.contentChanges.length === 0 && !event.document.isDirty) {
          scheduleCleanRetire(event.document.uri.fsPath)
        } else {
          cancelCleanRetire(event.document.uri.fsPath)
        }
      }
      // #224 引用视图跟随：被订阅目标的未保存修改进防抖窗（短暂合并刷新；
      // 空 contentChanges 是 dirty 状态事件，无内容变更不触发）。目标自
      // 引用（A 嵌入 A）同链路收敛：推送只读重载，不产生新事件。修 1 起
      // 经 connectHoverEvents 接线：未订阅目标同时广播 session 缓存失效
      // B-1（review-loops 波次一）：转发判据改为 shouldForwardHoverDocChange
      // ——.md 既有域不变（未订阅也放行，缓存失效广播语义），text 目标
      //（.txt/.json/代码文件等）按订阅集合放行（#340「未保存修改正确刷新」
      // 对 text 的通路；此前 /\.md$/i 硬过滤把已 watch 的 text 编辑拦死）
      // #344（P3-12 收口）：text 放行集合扩至「订阅中 ∪ 读取缓存驻留」
      // ——未 watch 的 text 目标编辑事件不转发是 B-1 的窄代价，但「悬停
      // →关闭→编辑→再悬停」会命中陈旧缓存；缓存目标同权转发后编辑事件
      // 照常广播失效（推送门控仍在协调器内——未订阅零推送开销不变）
      if (event.contentChanges.length > 0 &&
        event.document.uri.scheme === 'file' &&
        shouldForwardHoverDocChange(event.document.uri.path, event.document.uri.fsPath,
          (fsPath) => hoverRefresh.isWatched(fsPath) ||
            Array.from(sessions.values(), (e) => e.session).some((s) => s.hasCachedHoverTarget(fsPath)))) {
        hoverEvents.onDocChanged(event.document.uri.fsPath)
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
        event.reason === vscode.TextDocumentChangeReason.Undo ? 'undo' : event.reason === vscode.TextDocumentChangeReason.Redo ? 'redo' : undefined,
      )
      // P2-04：B 的 dirty 变化（content 与 dirty-state 两类事件）推送到
      // 绑定中的来源面板（pushRefEditDirty 内按值去重，翻转才发）
      pushRefEditDirty(event.document)
    }),
  )

  // P2-12（#289）：冲突临时副本（untitled）关闭记账——对比页关闭时副本随
  // 之释放（宿主生命周期），此处只同步移除在场集合（不延长文档寿命）
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      conflictTempUris.delete(document.uri.toString())
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
        outlinksSeqByDoc.delete(document.uri.toString())
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

  // ---- #239 分词资源状态广播（照 settings.changed 全面板遍历样板）：
  //      下载/删除完成后推送（installed 与资源 URI 变化驱动编辑器侧
  //      wordMotion 重评估加载）。资源 URI 逐面板构造（asWebviewUri
  //      前缀面板私有），故不能复用单条消息的 postToPanel 广播 ----
  if (jieba) {
    const offJieba = jieba.service.onStateChanged(() => {
      for (const entry of sessions.values()) {
        for (const [sessionId, panel] of entry.panels) {
          if (entry.session.getInfo().panels.some((p) => p.sessionId === sessionId && p.ready)) {
            void panel.webview.postMessage({
              kind: 'wordSegment.state',
              ...jieba.stateFor(panel.webview),
            })
          }
        }
      }
    })
    context.subscriptions.push({ dispose: () => offJieba() })
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
    const offSnippets = snippets.onChange((state, reason) => {
      diagnostics.record('snippets.broadcast', { reason, version: state.version })
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
  //  1.5s 合并，无逐键广播）。出链快照同点一并推送（出链面板批次） ----
  if (vaultIndex) {
    const offIndex = vaultIndex.onChange(() => {
      for (const entry of sessions.values()) {
        for (const panel of entry.session.getInfo().panels) {
          if (panel.ready) {
            void sendBacklinksSnapshot(entry, panel.sessionId, entry.doc.uri)
            void sendOutlinksSnapshot(entry, panel.sessionId, entry.doc.uri)
            // #377 T02：索引/全文件清单变更——候选会话在场的 webview 自行
            // 重发当前查询（控制器侧去抖；无会话时零动作）
            void entry.session.postToPanel(panel.sessionId, { kind: 'wikilink.invalidate' })
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

  // ---- #236 查找替换命令：find.replace 打开面板并展开替换栏（活动 tab
  //  为本扩展 custom editor 时向其面板发送；阅读模式整体禁用替换（2026-10
  //  用户决策）——webview 侧守卫带 replace 指令不开面板，静默忽略）。
  //  替换执行命令复用活动面板查找
  //  命令的定向逻辑（view.find.replace；webview 侧守卫面板开 + live +
  //  合法 query，阅读/未开会话时静默忽略）----
  context.subscriptions.push(
    vscode.commands.registerCommand('onegayi.vsidian.find.replace', async () => {
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
            entry!.session.postToPanel(panel.sessionId, { kind: 'view.find.open', replace: true })
          }
          return true
        }
      }
      await vscode.window.showWarningMessage(t('host.noPanelForFind'))
      return false
    }),
  )
  for (const [command, op] of [
    ['onegayi.vsidian.find.replaceNext', 'next'],
    ['onegayi.vsidian.find.replaceAll', 'all'],
  ] as const) {
    context.subscriptions.push(vscode.commands.registerCommand(command, (): boolean => {
      for (const entry of sessions.values()) for (const [sessionId, panel] of entry.panels) {
        if (panel.active && entry.session.getInfo().panels.some((p) =>
          p.sessionId === sessionId && p.ready)) {
          entry.session.postToPanel(sessionId, { kind: 'view.find.replace', op })
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
  // ---- 可绑定的视图中按钮动作（命令面板/快捷键共用）：校验活动面板后回发
  //      ui.command，webview 与对应按钮共用同一实现。#208 刷新嵌入资源亦经
  //      此注册（onegayi.vsidian.editor.refresh）——快捷键链路
  //      keybindings.execute → executeCommand → 本循环回发 → webview 与
  //      工具栏按钮共用同一发送实现（出站 refresh.request），宿主失效编排
  //      在 documentSession 的 refresh.request 处理唯一，不另造路径 ----
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

  // #318 外部搜索导航定位恢复——显式触发（命令面板可达；键位注册表已
  // 登记、默认未绑定，见 docs/specs/keybindings.md 与 docs/specs/search-reveal.md）。
  // 成功落位由 view.locate 通道的 flash 高亮呈现；失败按结果分型通知：
  // no-panel（活动 tab 非 Vsidian 面板）提示先打开/切换面板，no-match /
  // no-fit（无匹配输出 / 行文本不吻合）提示先在搜索结果中选中匹配。
  // 反馈逻辑已抽 searchRevealLocateWithFeedback（打开提示按钮同链路共用）
  context.subscriptions.push(vscode.commands.registerCommand(
    'onegayi.vsidian.searchReveal.locate',
    searchRevealLocateWithFeedback,
  ))

  // ---- 测试钩子命令：仅集成测试经 runTest.mjs 注入 VSIDIAN_TEST_HOOKS=1 时
  // 注册（C-11），生产 VSIX 与常规 F5 开发不暴露 ----
  if (process.env.VSIDIAN_TEST_HOOKS === '1') {
    context.subscriptions.push(
      vscode.commands.registerCommand('onegayi.vsidian._test.setDiagnostics', (enabled: boolean) => {
        diagnostics.reset(enabled === true)
        snippets?.setTestDiagnostics(enabled === true)
        for (const entry of sessions.values()) for (const panel of entry.panels.values()) {
          void panel.webview.postMessage({ kind: 'diagnostics.test.set', enabled: enabled === true })
        }
      }),
      vscode.commands.registerCommand('onegayi.vsidian._test.getDiagnostics', () => ({
        host: diagnostics.snapshot(), snippets: snippets?.getTestDiagnostics(),
        // 缓存是最后一次真实回报，不以失败后额外调度改变现场。无回报如实留空。
        panels: [...sessions.values()].flatMap((entry) => [...entry.panels.keys()].map((sessionId) => {
          const state = entry.session.getViewState(sessionId)
          return { docUri: entry.doc.uri.toString(), sessionId, cached: true,
            trace: state?.diagnostics, viewMode: state?.viewMode,
            css: state?.cssProbe, readingTotalBlocks: state?.readingTotalBlocks,
            readingMountedBlocks: state?.readingMountedBlocks,
            readingScrollTopPx: state?.readingScrollTopPx,
            embeds: state?.readingEmbed?.slice(0, 32).map((card) => ({
              inner: card.inner, state: card.state, host: card.host, rootHost: card.rootHost, blocks: card.blocks,
              textLen: card.textLen, viewStats: card.viewStats,
            })) }
        })).slice(0, 8),
      })),
    )
    context.subscriptions.push(
    vscode.commands.registerCommand('onegayi.vsidian._test.getSessionState', (uriStr: string) => {
      const entry = getEntry(vscode.Uri.parse(uriStr))
      if (!entry) {
        return { found: false, panels: [], version: 0, appliedEdits: 0 }
      }
      return {
        found: true,
        // 只报真实 webview 面板（realPanelsOf 口径）——集成用例的
        // waitSessionReady/面板数断言以「用户可见面板」为语义，虚拟面板
        // 计入会让就绪判据被无 UI 承载的面板提前满足
        panels: realPanelsOf(entry),
        version: entry.doc.version,
        appliedEdits: entry.appliedEdits,
        // #208 资源代次（0 = 未刷新；每次手动刷新 +1，图片 URI ?v= 戳同源）
        imageGeneration: entry.session.getImageGeneration(),
      }
    }),
    vscode.commands.registerCommand('onegayi.vsidian._test.getSkeletonState', (uriStr: string, panelIndex = 0) => {
      // #292 骨架状态查询：读最近一次 webview 回报（hold 装配下 adopt/
      // release 都会回报；调用方按需重试）
      const entry = getEntry(vscode.Uri.parse(uriStr))
      const panel = entry?.session.getInfo().panels[panelIndex]
      if (!entry || !panel) {
        return undefined
      }
      return entry.session.getLastSkeletonReport(panel.sessionId) ?? null
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
      // P2-11（#288）：以真实 webview 消息的同一处理入口注入（provider 层的
      // refEdit.* 拦截、校验与路由完全一致）——injectWebviewMessage 走会话
      // 入口触达不了 provider 拦截的 refEdit 族；panelIndex 口径与 postToPanel
      // 同（真实 webview 面板）
      'onegayi.vsidian._test.injectWebviewReceived',
      (uriStr: string, message: Record<string, unknown>, panelIndex = 0): boolean => {
        const entry = getEntry(vscode.Uri.parse(uriStr))
        const panel = realPanelsOf(entry).filter((p) => p.ready)[panelIndex]
        const handler = panel ? panelMessageHandlers.get(panel.sessionId) : undefined
        if (!entry || !panel || !handler) {
          return false
        }
        handler(message)
        return true
      },
    ),
    vscode.commands.registerCommand(
      // #316 测试缝：bind 在途屏障武装——此后首个到达 openTextDocument 恢复点
      // 的 refEdit.bind 挂起（hits 计数供用例确认已挂住）；release 放行
      'onegayi.vsidian._test.armRefEditBindSuspend', () => {
        refEditBindSuspendHits = 0
        refEditBindSuspend = new Promise((resolve) => {
          refEditBindSuspendRelease = resolve
        })
      }),
    vscode.commands.registerCommand(
      'onegayi.vsidian._test.releaseRefEditBindSuspend', () => {
        refEditBindSuspendRelease?.()
        refEditBindSuspendRelease = null
        refEditBindSuspend = null
      }),
    vscode.commands.registerCommand(
      'onegayi.vsidian._test.refEditBindSuspendState', () => ({
        armed: refEditBindSuspend !== null,
        hits: refEditBindSuspendHits,
      })),
    vscode.commands.registerCommand(
      // #316 观测面：refEdit 端口注册表快照（活跃 portId 清单）——面板
      // 销毁/重载后旧端口消失与孤儿不产生的断言证据
      'onegayi.vsidian._test.refPortStats', () => refPorts.stats()),
    vscode.commands.registerCommand(
      // 宿主 → webview 方向的消息注入钩子：与 injectWebviewMessage（webview →
      // 宿主）对称，供集成测试驱动 view.mode.set / view.locate 等正式消息
      'onegayi.vsidian._test.postToPanel',
      async (uriStr: string, message: Record<string, unknown>, panelIndex = 0) => {
        const entry = getEntry(vscode.Uri.parse(uriStr))
        // panelIndex 在真实 webview 面板中计数（realPanelsOf 口径）——
        // 虚拟面板不承载 UI 消息处理者，投给它等于丢失
        const panels = realPanelsOf(entry).filter((p) => p.ready)
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
    // #224 引用视图订阅与读取缓存观测钩子：订阅计数（目标数/实例数——
    // 集成断言「面板销毁/浮层关闭后订阅计数回落」）与宿主读取缓存计量
    //（条目/字节/命中/未命中——重复引用合并读取的性能证据）
    vscode.commands.registerCommand('onegayi.vsidian._test.hoverWatchStats', () =>
      hoverRefresh.stats()),
    vscode.commands.registerCommand('onegayi.vsidian._test.hoverReadCacheStats', (uriStr: string) => {
      const entry = getEntry(vscode.Uri.parse(uriStr))
      return entry ? entry.session.hoverReadCacheStats() : { found: false }
    }),
    vscode.commands.registerCommand(
      'onegayi.vsidian._test.getLastClosedInput',
      () => lastClosedInput,
    ),
    // P2-13（#290）「关闭残留输入」三项选择的执行路径驱动（宿主通知按钮
    // 无法在集成测试中点击；钩子与按钮走同一函数——行为等价的执行载体）
    vscode.commands.registerCommand('onegayi.vsidian._test.closedInputConflictDiff', () =>
      runClosedInputCompare()),
    vscode.commands.registerCommand('onegayi.vsidian._test.discardClosedInput', () => ({
      discarded: discardClosedInput(),
    })),
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
      // P2-12（#289）：置位下一次 refEdit.conflictCompare 短路为失败（不消
      // 耗 untitled/对比页资源）——「API／资源打开失败原现场可继续选择」
      // 的注入断言载体
      'onegayi.vsidian._test.failNextConflictDiff',
      () => {
        conflictDiffFailOnce = true
        return true
      },
    ),
    vscode.commands.registerCommand(
      // P2-12（#289）：冲突临时副本（untitled）记账观测（资源释放闭环断言）
      'onegayi.vsidian._test.getConflictTempUris',
      () => [...conflictTempUris],
    ),
    vscode.commands.registerCommand(
      'onegayi.vsidian._test.requestViewState',
      async (uriStr: string, panelIndex = 0) => {
        const entry = getEntry(vscode.Uri.parse(uriStr))
        // panelIndex 在真实 webview 面板中计数（realPanelsOf 口径）——虚拟
        // 面板无 view.state 回报者，命中即恒 undefined（观测面假超时）
        const panels = realPanelsOf(entry).filter((p) => p.ready)
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
      // #212 图片导出消息日志（取走即清空）：钩子模式下 exportImage 端口
      // 不弹真实另存为对话框，集成测试经 image.test.popup 的 action 驱动
      // 导出按钮后，以此断言 webview→宿主链路的消息形态
      'onegayi.vsidian._test.takeImageExportLog',
      (uriStr: string) => {
        const log = imageExportTestLog.get(uriStr) ?? []
        imageExportTestLog.set(uriStr, [])
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
        await writeRemembered('live')
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
    // #239 jieba 宿主权威状态观测：installed（下载 + sha256 校验落
    // globalStorage 完成）与 notice（含 webview loadResult 回报的装载失败
    // detail）——集成用例等待下载就绪与红灯诊断输出
    vscode.commands.registerCommand('onegayi.vsidian._test.getJiebaState', () =>
      jieba ? jieba.service.getState()
        : { installed: false, version: JIEBA_WASM_VERSION, status: 'idle', notice: null }),
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
    // ---- #318 测试钩子：定位恢复观测记录（take 语义取后清空），
    //      供显式命令集成矩阵断言 ----
    vscode.commands.registerCommand('onegayi.vsidian._test.takeSearchRevealLog', () => {
      const snapshot = [...searchRevealLog]
      searchRevealLog.length = 0
      return snapshot
    }),
    // ---- #318 测试钩子：打开提示观测记录（take 语义取后清空；提示弹
    //      出与定位执行是独立事件——通知本体在钩子模式下不弹，记录照常），
    //      供打开提示集成用例断言 ----
    vscode.commands.registerCommand('onegayi.vsidian._test.takeSearchRevealHintLog', () => {
      const snapshot = [...searchRevealHintLog]
      searchRevealHintLog.length = 0
      return snapshot
    }),
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
    // #340（P3-08）text 目标（普链）：原生编辑器打开——fragment 不解析
    //（锚点控制仅双链可用，普链 fragment 原样交宿主打开，2026-10-04 规范
    // 修订口径），不带行定位、不弹锚点警告
    if (classifyLocalRefContentKind(fsPath) === 'text') {
      pushLog({
        kind: 'doc',
        href: intent.href,
        path: fsPath,
        fragment: target.fragment ?? undefined,
        locate: 'none',
      })
      await vscode.window.showTextDocument(uri, { preview: false })
      return
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
 * buildSnippetLinkList 同款防御）。本地与远程（SSH）工作区同通道——
 * webview 资源服务按远程权威路由（真实远程宿主表现属 #15 人工验证项）。
 * #208：generation 为会话资源代次（手动刷新自增；0 = 未刷新初值），URI
 * 戳取「版本表观测代次 + 会话代次」之和——两个失效源（自动观测 / 手动
 * 刷新）任一推进，和必换新（CSP 匹配不含 query，不受影响）。仅工作区
 * 相对路径图源经此通道——HTTPS 直连不经宿主，无代次语义。
 */
async function resolveWorkspaceImage(
  src: string,
  ctx: LinkContext,
  webview: vscode.Webview,
  versions: ImageVersionTable,
  generation: number,
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
  const { generation: observed } = versions.recordObservation(target.fsPath, {
    mtimeMs: stat.mtime,
    size: stat.size,
  })
  return {
    ok: true,
    // 戳 = 版本表观测代次 + 会话代次（两个单调失效源之和）：自动观测与
    // 手动刷新任一推进，和必增大——URI 换新即击穿 webview 资源缓存
    src: appendImageVersionStamp(
      webview.asWebviewUri(uri).toString(),
      observed + generation,
    ),
    fsPath: target.fsPath,
  }
}

function buildWebviewHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  locale: LocaleCode,
  // #292 装配参数：readableLineWidthPx = 非 0 档可读行宽预写 #app 内联变量
  // （消除骨架期宽度回跳）；holdSkeleton 供集成测试冻结骨架撤除（宿主侧
  // 门控，调用侧仅在 VSIDIAN_TEST_HOOKS=1 传真值）
  initial: { readableLineWidthPx?: number | null; holdSkeleton?: boolean } = {},
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
  // #337（P3-05）PDF 装配资源 URI（mermaid 同款全局传递机制）：pdfMain/
  // pdfWorker 双产物 + cmaps/standard_fonts/wasm/iccs 资产目录（尾斜杠由
  // webview 渲染器按 PDF.js 参数约定补齐）。webview 无法自行构造
  // asWebviewUri 前缀，经此内联注入
  const pdfAssets = {
    mainJs: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'pdfMain.js')).toString(),
    workerJs: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'pdfWorker.js')).toString(),
    cMapUrl: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'pdfjs', 'cmaps')).toString(),
    fontUrl: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'pdfjs', 'standard_fonts')).toString(),
    wasmUrl: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'pdfjs', 'wasm')).toString(),
    iccUrl: webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', 'webview', 'pdfjs', 'iccs')).toString(),
  }
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
${buildSkeletonStyleHtml()}
<link href="${styleUri}" rel="stylesheet">
<link href="${probeCssUri}" rel="stylesheet">
<title>Vsidian</title>
</head>
<body>
${buildAppOpenTag(initial.readableLineWidthPx)}
${buildLocaleIslandHtml(locale, LOCALE_MESSAGES[locale])}
<script nonce="${nonce}">window.__vsidianMermaidUri = "${mermaidUri}";window.__vsidianPdfAssets = ${JSON.stringify(pdfAssets)};${initial.holdSkeleton ? `window.${SKELETON_HOLD_GLOBAL} = true;` : ''}window.${SKELETON_SHOWN_AT_GLOBAL} = performance.now();</script>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
}
