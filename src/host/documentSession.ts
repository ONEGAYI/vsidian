// 文档会话：宿主侧每个 TextDocument 一份，管理该文档全部 webview 面板的
// 同步。权威文档通过 HostDocumentPort 注入（vscode 层用 WorkspaceEdit 实现），
// 本模块保持纯逻辑、可单元测试。
//
// 职责（依据探索笔记 02 §3/§5/§6）：
// - ready 握手：webview 脚本加载完成前宿主不发送任何消息，ready 后发 init
// - edit.request：结构校验（协议层）+ sessionId/docUri 校验 + seq 幂等去重
//   + baseVersion 过期重定位（可平移则应用）；不可安全应用（区间被覆盖、
//   版本超前、versionLog 截断缺口）或 applyEdit 失败时进入面板级暂停：
//   保留输入片段（conflictFragments / conflict.report 快照）、拒绝后续
//   写回、经 onNotice 提示，恢复走 resumePanel（doc.resync 重置，#4）
// - 自家编辑的 onDidChangeTextDocument 回流识别为确认（edit.ack），其余
//   一切文档变更广播给面板（doc.changed），避免回显死循环；面板存在
//   「已应用未确认」pending 时外部广播先暂存、确认后有序补发（#48，
//   保证 webview 收到 ack(E) → doc.changed(X) 的参考系一致序列）
// - 请求串行处理：同一时刻只有一个 applyEdit 在途，后续请求基于推进后的
//   版本重定位，消除并发窗口
// - 面板关闭/断连（onDidDispose → detachPanel）时存在未确认输入必须通知，
//   不得静默丢弃（SSH 断开不得误报已保存）
import { Text } from '@codemirror/state'
import {
  isWebviewToHost,
  type DiagramExportFailReason,
  type DiagramExportPayload,
  type DocumentChangeReason,
  type PasteHistory,
  type HostToWebview,
  type HoverAnchorInvalidDetail,
  type HoverPreviewRequestPayload,
  type HoverPreviewFailReason,
  type HoverPreviewScope,
  type ImageExportFailReason,
  type ImageExportPayload,
  type ImagePastePayload,
  type SerChange,
  type SettingsPayload,
  type WebviewToHost,
} from '../shared/protocol'
import { hasNetTextChange, isValidMergedOriginList, parseEditOriginField, type EditOriginList, type EditOriginMeta } from '../shared/editOrigin'
import type { HoverTargetTipOutcome, RefReadOutcome } from './hoverDocAccess'
import type { RefImageContent, RefMarkdownContent, RefPdfContent, RefPdfNavSelector, RefTextContent } from '../shared/refContent'
import type { ImagePasteOutcome } from './imagePasteHost'
import { isHttpLinkHref } from '../shared/webLink'
import { mapChangeThroughChanges } from '../shared/changeMapping'
import { NewlineCoordinator } from '../shared/newline'
import { PasteHistoryTracker } from './pasteHistoryTracker'
import type { ImageResolution } from './linkTarget'
import { imageFsKey } from './imageVersioning'
import type { ImageVerifyItem } from '../shared/imageRefresh'
import { HOVER_REFRESH_DEFAULTS, hoverWatchKeyOf } from '../shared/hoverRefresh'
import { REF_EXPANSION_LIMITS, RefExpansionBudget, canonicalRefTargetKey, inExpansionPath,
  validChildSource } from '../shared/refExpansion'

/** T03（#352）组历史执行结果（HostDocumentPort 可选组入口的返回）：
 *  executedSteps 为实际完成的原生步骤数；aborted 携带中止原因时剩余
 *  步骤未执行（版本核对失配或路由不可用） */
export interface HostHistoryGroupResult {
  executedSteps: number
  aborted?: 'version-mismatch' | 'route-unavailable'
}

/** 权威文档适配器：vscode 层实现 */
export interface HostDocumentPort {
  readonly version: number
  /** 权威文档行尾（镜像 vscode.EndOfLine：1=LF、2=CRLF）。#81 复制产物
   *  按此归一（webview 出站恒为 LF）；缺省按 LF 处理 */
  readonly eol?: 1 | 2
  getText(): string
  /** 应用一组全文偏移变更；返回是否成功。T03（#352）起可选 origin：
   *  携带来源元数据的提交经写回层透传（vscode 层按需记账）；缺省
   *  （旧调用）为 undefined，语义不变。T06（#355）起接受数组形态
   *  （同组未提交合并笔，首项组首） */
  applyChanges(changes: SerChange[], origin?: EditOriginMeta | EditOriginList): Promise<boolean>
  /** 对权威文档执行宿主撤销（undoRedoService 文本栈）；返回是否执行。
   *  P2-04（#281）起 origin（请求面板的来源身份）：嵌入目标端口的请求
   *  经 provider 实现「临时激活 B → 全局 undo → 重显来源面板」的 P2-01
   *  验证路由；缺省（根面板请求）为 undefined，语义不变 */
  undo(origin?: { docUri: string }): Promise<boolean>
  /** 对权威文档执行宿主重做（undoRedoService 文本栈）；返回是否执行（origin 语义同 undo） */
  redo(origin?: { docUri: string }): Promise<boolean>
  /** T03（#352）可选组历史入口：一次激活整组执行 steps 个连续原生步骤，
   *  每步核对版本恰 +1、失配中止剩余步骤（V01 F2/F4 生产形态）。生产由
   *  provider 的临时激活路由实现（含 F1 脏态收口禁丢）；未实现时调用方
   *  得到 route-unavailable，不降级为其他撤销语义 */
  undoGroup?(steps: number, origin?: { docUri: string }): Promise<HostHistoryGroupResult>
  /** 组重做入口（语义同 undoGroup） */
  redoGroup?(steps: number, origin?: { docUri: string }): Promise<HostHistoryGroupResult>
}

/** T03（#352）来源归属确认记录：带 origin 的编辑经真实写回/回流确认后
 *  恰好触发一次（onEditAttributed）。version 与该笔 edit.ack(ok) 同源——
 *  历史协调（T06）据此把宿主历史条目与来源/原子组对位，不依赖文本全等。
 *  T06（#355）起 origin 恒为组首（单笔提交即该笔自身）；合并提交（同组
 *  未提交的原子 + 随后 joinPrevious 并为一笔 WorkspaceEdit）时 joined 携
 *  带并入该笔的其余来源——逐次来源记录保留 */
export interface EditAttributionRecord {
  docUri: string
  sessionId: string
  seq: number
  version: number
  /** 落定变更（LF 坐标，与 doc.changed 广播同款） */
  changes: SerChange[]
  origin: EditOriginMeta
  /** 合并笔并入的其余来源（无合并时缺省） */
  joined?: EditOriginMeta[]
}

/** 面板发送通道 */
export interface PanelPort {
  send(message: HostToWebview): void
  /** #10 链接跳转执行（vscode 层注入：URI 解析白名单 + openExternal/
   *  showTextDocument/用户反馈）；只读交互，暂停态同样放行。#220 起 intent
   *  可携 sourceDocUri（悬停浮层内链接以 B 文档为来源解析执行） */
  openLink?(intent: { href: string; srcStart: number; srcEnd: number; sourceDocUri?: string }): void
  /** #11 双链跳转执行（vscode 层注入：wikilinkTarget 按需解析 + 打开/
   *  定位/用户反馈）；只读交互，暂停态同样放行。#220 起 intent 可携
   *  sourceDocUri（语义与 openLink 同） */
  openWikilink?(intent: { target: string; srcStart: number; srcEnd: number; sourceDocUri?: string }): void
  /** #218 悬停预览文档读取（vscode 层注入：hoverDocAccess 无副作用读取——
   *  目标解析 + openTextDocument + LF 转换）；report 回报 hover.result 载荷
   *  （成功携带身份/版本/全文/范围，失败为错误分态）。只读交互，不进
   *  edit.request 通道，暂停态同样放行 */
  readHoverTarget?(
    payload: HoverPreviewRequestPayload & { verifiedSource?: { fsPath: string; version: number } },
    report: (result: RefReadOutcome) => void,
  ): void
  /** #342（P3-10）悬停请求取消（vscode 层注入：定位在途 web 抓取消费者
   *  并中止——WebLinkMetaService 的合并计数减一，最后消费者离开即断开
   *  底层连接；markdown 读取不可中止，无操作）。instanceId/reqId 与被
   *  取消的 hover.request 配对 */
  cancelHoverRead?(identity: { instanceId: string; reqId: number }): void
  /** #340（P3-08）文本 token 计算（vscode 层注入：外观服务——语法层
   *  vscode-textmate + 语义层公开命令；**fsPath 守卫在此端口上游**：调用
   *  方按 hoverSourceFsPaths 复核已送达目标，被攻陷 webview 不能借本通道
   *  探测任意文件）。version 为请求方装载版本——目标已推进回 stale。
   *  只读交互，不进 edit.request 通道 */
  readTextTokens?(
    payload: { fsPath: string; version: number; beginLine: number; endLine: number },
    report: (result:
      | { ok: true; layer: 'textmate'; colors: string[]; tokens: number[]; version: number }
      | { ok: true; layer: 'semantic'; colors: string[]; tokens: number[]; version: number }
      | { ok: false; reason: 'stale' | 'unavailable' }) => void,
  ): void
  readHoverSource?(fsPath: string): Promise<{ version: number; text: string } | null>
  /** #299 跳转目标提示轻量解析（vscode 层注入：hoverDocAccess 的
   *  resolveHoverTargetTip——路径解析与存在性探测，**不读正文**、不建
   *  读取/租约链路）；report 回报 hover.target.resolved 载荷（成功携带
   *  所属根内相对路径与源码形态锚点，失败仅 ok:false）。只读交互，
   *  暂停态同样放行 */
  resolveHoverTarget?(
    payload: { target?: string; linkHref?: string; directTarget?: { fsPath: string; anchor?: string } },
    report: (result: HoverTargetTipOutcome) => void,
  ): void
  /** #10 图片资源解析（vscode 层注入：classifyImageTarget + asWebviewUri）。
   *  #220 起第二可选参 sourceDocUri：悬停浮层内 B 文档图片的来源上下文
   *  （vscode 层按 B 目录构造 LinkContext）；缺省 = 面板自身文档 */
  resolveImage?(src: string, sourceDocUri?: string): Promise<ImageResolution>
  /** #161 图片粘贴落盘（vscode 层注入：设置读取 + 目录解析 + writeFile）；
   *  report 回报成功（携插入文本）/ 目录非法 / 写入失败 */
  pasteImage?(
    payload: ImagePastePayload,
    report: (result: ImagePasteOutcome) => void,
  ): void
  /** #111 图表导出（vscode 层注入：载荷校验 + showSaveDialog + writeFile）；
   *  report 回报取消/校验失败/写盘失败/成功 */
  exportDiagram?(
    payload: DiagramExportPayload,
    report: (result: { ok: boolean; reason?: DiagramExportFailReason }) => void,
  ): void
  /** #212 图片导出（vscode 层注入：目标定位 + 读字节 + showSaveDialog +
   *  writeFile，字节级拷贝保持原格式）；report 回报取消/载荷非法/不可寻址/
   *  读失败/写盘失败/成功 */
  exportImage?(
    payload: ImageExportPayload,
    report: (result: { ok: boolean; reason?: ImageExportFailReason }) => void,
  ): void
  /** #33 打开 Vsidian 设置页（vscode 层注入：createWebviewPanel；设置页
   *  不依赖文档会话，与 link.activate 同为面板级 UI 意图端口） */
  openSettings?(): void
  /** #33 设置快照拉取（vscode 层注入：SettingsService.getSnapshot；面板
   *  init 后的 settings.get 以 settings.snapshot 响应） */
  requestSettings?(): SettingsPayload
  /** #128 CSS 片段装载清单拉取（vscode 层注入：CssSnippetService 状态 ×
   *  本面板 webview.asWebviewUri——每个 webview 的资源前缀私有，清单必须
   *  逐面板构造）；面板 init 后的 snippets.get 以 snippets.snapshot 响应 */
  requestSnippets?(): { version: number; snippets: Array<{ name: string; uri: string }> }
  /** #128 片段链装载结果（vscode 层注入：用户提示与诊断观测；只读交互） */
  onSnippetLoad?(name: string, version: number, ok: boolean): void
  /** #69 剪贴板写（直写）：vscode 层注入 env.clipboard.writeText。只读
   *  交互（不写文档、不入撤销栈），暂停态同样放行。#81 代码块复制同走
   *  此端口——入参 text 已由会话按文档 EOL 归一（CRLF 文档收到 \r\n） */
  writeClipboard?(text: string): void
  /** #69 剪贴板写（标题链接）：`[[笔记名#标题]]` 的拼接在 vscode 层——
   *  笔记名 = docUri 文件名去扩展名（Obsidian 语义），标题为 webview
   *  上报的条目原文（含行内标记，与宿主 findHeadingOffset 的字面匹配同源） */
  writeHeadingLinkClipboard?(docUri: string, heading: string): void
  /** #162 剪贴板写（块链接）：`[[笔记名#^块id]]` 的拼接在 vscode 层——
   *  blockId 为 webview 侧块尾行既有 id 或刚经标准 edit.request 写入的
   *  新 id（写入与复制是两条消息，本端口只管拼接剪贴板） */
  writeBlockLinkClipboard?(docUri: string, blockId: string): void
  /** #183 剪贴板读（粘贴桥）：vscode 层注入 env.clipboard.readText；读回
   *  文本按 LF 归一（webview 全程 LF 坐标）；环境读失败返回 null */
  readClipboard?(): Promise<string | null>
}

/** 会话通知（#4）：冲突暂停、复制请求、面板关闭时存在未确认输入等需要
 *  用户感知的事件；由 vscode 层注入回调呈现（警告通知 + 取回按钮） */
export type SessionNotice =
  | { type: 'conflict'; sessionId: string; docUri: string }
  | { type: 'copy-request'; sessionId: string; docUri: string }
  | {
      type: 'panel-closed-with-input'
      sessionId: string
      docUri: string
      fragments: string[]
      /** webview 防抖重报的最新全文快照（R-1）：含暂停后继续输入与暂缓集
       *  内容，比 fragments 更完整；复制取回时优先 */
      webviewText?: string
      /** P2-13（#290）来源标记：true = 引用编辑端口（虚拟面板，refOrigin
       *  在场）——provider 据此把通知呈现为三项当次选择（对比并解决/
       *  放弃当前版本/取消）；根面板关闭残留维持既有「复制取回」呈现 */
      fromRefPort?: boolean
    }

export interface DocumentSessionOptions {
  docUri?: string
  /** Root A's filesystem identity, supplied by the provider rather than webview. */
  rootFsPath?: string
  getEmbedDepthLimit?: () => number
  onNotice?: (notice: SessionNotice) => void
  /** #38 面板视图状态回报回调：view.state 缓存后触发（宿主维护
   *  vsidian.activeMode context 与初始 reading 恢复决策的数据源） */
  onViewState?: (
    sessionId: string,
    state: Extract<WebviewToHost, { kind: 'view.state' }>,
  ) => void
  /** #96 R1 ready 即校准的语言供应者：每次 ready（含 webview 重载的重复
   *  ready）按返回值幂等补发一条 locale.changed。数据岛携带的是面板
   *  【创建时】的语言，重载后装回旧语言、未 ready 面板错过切换广播——
   *  都以此对齐当前生效语言（与 init 重发全文同模式）。会话保持纯逻辑：
   *  hostLocale + LOCALE_MESSAGES 的装配由 vscode 层注入；未注入不发 */
  requestLocale?: () => { lang: string; messages: Readonly<Record<string, string>> } | undefined
  /** #316（b2 形态 1）webview 重载信号：同一面板的重复 ready（B-2）即
   *  webview 重建——provider 据此整体释放该 sessionId 名下的目标编辑端口
   *  （webview 侧端口状态库随重建丢失，旧 portId 无人再引用；释放后 re-bind
   *  查不到旧端口直接注册新端口，等价自愈）。会话保持纯逻辑：释放动作在
   *  provider 域；未注入时无行为变化 */
  onPanelReload?: (sessionId: string) => void
  /** #380 T05：本会话文档一次 undo/redo 实际执行后的回调（provider 据此
   *  驱动块 ID 撤回协调——来源撤销撤链接时尽力撤回目标新增标记，V01
   *  放行路径）。仅在权威端口返回已执行（true）时触发；排在 queue 串行
   *  链之后，观察到的是该次历史操作落定后的权威文本 */
  onHistoryApplied?: (op: 'undo' | 'redo') => void
  /** T03（#352）来源归属确认：带 origin 的编辑经真实写回且确认（回流
   *  匹配或兜底确认）后恰好触发一次；失败/拒绝/重放不触发。公开编辑
   *  API 的历史协调（T06）按 version 对位来源记录，替代 V01 探针的文本
   *  全等对账。生产暂不装配（T06 接线）；测试钩子经 VSIDIAN_TEST_HOOKS
   *  消费 */
  onEditAttributed?: (record: EditAttributionRecord) => void
  /** T06（#355）来源提交业务闸门：携带 origin 的写回请求在进入权威写回
   *  之前按来源逐项询问（队列内、applyChanges 前）。返回 false 时该请求
   *  以 conflict ack + originRejection: 'history-boundary' 拒绝——不写回、
   *  不留来源记录。生产由 provider 注入（历史协调器的 joinPrevious 归属
   *  判定）；未注入时不设闸（旧调用行为不变） */
  onOriginGate?: (origin: EditOriginMeta) => boolean
  /** #201 周期核验端口：image.verify 的 items 透传给 provider 协调器
   *  （stat + 版本表决策 + 失效回调走 invalidateImagesByFsPath）。
   *  会话侧只做会话守卫与串行合并（并发有界）；未注入时 verify 静默
   *  丢弃（按需 stat 核验仍可用——verify 只是周期兜底） */
  verifyImages?: (items: ImageVerifyItem[]) => Promise<void>
  /** #201 宿主文件系统语义（vscode 层注入 process.platform === 'win32'）：
   *  归一目标键的大小写与分隔符行为。缺省 false（纯逻辑 POSIX 语义） */
  isWindowsHost?: boolean
  /** #224 悬停读取缓存上限覆盖（测试注入用；缺省取共享参数
   *  HOVER_REFRESH_DEFAULTS——条目与字节双上限集中定义） */
  hoverReadCache?: {
    entryLimit?: number
    byteLimit?: number
  }
}

interface PendingEdit {
  seq: number
  changes: SerChange[]
  confirmed: boolean
  paste?: PasteHistory
  /** T03（#352）/T06（#355）来源元数据（归一化为列表：单笔为单元素，
   *  合并笔首项为组首原子、余项为并入的 joinPrevious——逐次来源保留）：
   *  确认成功时触发归属（onEditAttributed）；失败路径不产生归属记录 */
  origin?: EditOriginList
}

interface PanelEntry {
  sessionId: string
  port: PanelPort
  ready: boolean
  /** P2-04（#281）目标编辑端口的来源面板身份（attachPanel 注入）：宿主
   *  undo/redo 路由据此恢复来源面板活动态；根面板为 undefined */
  refOrigin?: { docUri: string }
  pending: PendingEdit[]
  /** 已收但仍在全局 queue 中等待执行的请求；关闭检查须同步看见。 */
  queued: Map<number, SerChange[]>
  /** seq → 已发送的 ack（幂等去重：重复消息重发同一 ack） */
  ackCache: Map<number, HostToWebview>
  lastViewState?: Extract<WebviewToHost, { kind: 'view.state' }>
  /** 暂停写回状态（#4）：不可安全应用外部更新或写回失败时置位 */
  suspended: boolean
  /** 暂停的真实原因（重载恢复提示透传，协议 session.suspended 的 reason） */
  suspendedReason: 'conflict' | 'host-error'
  /** 被拒绝请求的输入文本片段（用户未确认输入的宿主侧留存） */
  conflictFragments: string[]
  /** webview 冲突上报的本地全文快照（conflict.report） */
  conflictWebviewText?: string
  conflictWebviewVersion?: number
  /** 特殊空白格 IME 在写回前的候选快照；普通冲突快照不参与此判定。 */
  compositionPending?: boolean
  /** 候选快照用 CM6 Text 增量维护；全文只在关闭/复制时生成。 */
  compositionSnapshot?: Text
  /** 单调快照序号：迟到的旧报告不得覆盖更新的全文。 */
  lastConflictRevision: number
  /** 最近一次性能探针回报（#5：测试钩子 perfProbe 轮询读取） */
  lastPerfReport?: Extract<WebviewToHost, { kind: 'perf.report' }>
  /** 最近一次阅读视图探针回报（#7：测试钩子 readingPerf 轮询读取） */
  lastReadingPerfReport?: Extract<WebviewToHost, { kind: 'reading.perf.report' }>
  /** 最近一次骨架屏状态回报（#292：测试钩子 getSkeletonState 轮询读取） */
  lastSkeletonReport?: Extract<WebviewToHost, { kind: '_test.skeleton.report' }>
  /** 冲突通知只发一次（避免通知风暴） */
  conflictNotified: boolean
  /** webview 曾在会话内重载（ready 重复到达，B-2）：暂停面板复制未确认
   *  输入时跳过面板查询（重载后 view.state 是权威全文，不代表冲突前输入） */
  reloaded: boolean
  /** #220/#222 悬停来源记录：本面板经 hover.request 成功读取过的目标
   *  fsPath 集合——来源资源守卫的比对基准（image.request / link.activate /
   *  wikilink.activate 的 sourceDocUri 须为集合成员才放行）。#220 浮层
   *  一次一个目标时单值即够；#222 嵌入卡片与浮层共存，多目标同面板在场
   *  ——集合化后守卫语义收窄为「本面板实际读取过的目标」（不信任前端
   *  任意 URI 的边界不变）。目标本身经 resolveVaultLinkFile 的
   *  ADR-0008 根内语义解析，记录在案 = 来源已受根边界约束。有界：超出
   *  上限时仅淘汰未固定的读取记录，watch 持有的来源配对释放 */
  hoverSourceFsPaths: Set<string>
  /** #242 来源持有者：成功送达后的 watch 按 occurrence 固定，退订配对释放。 */
  hoverSourcePins: Map<string, Set<string>>
  /** 每次成功送达独立；待订阅租约不属于共享读取缓存。 */
  hoverSourceLeases: Map<string, string>
  hoverLeaseGrants: Map<string, HoverSourceGrant>
  hoverParentGrants: Map<string, HoverSourceGrant>
  expansionBudget: RefExpansionBudget
  /** 最近一次成功送达的目标 fsPath（观测面；守卫用集合） */
  hoverSourceFsPath?: string
}

interface HoverSourceGrant {
  fsPath: string
  version: number
  /** P2-03（#280）：初始定位区间参考（锚点命中的锚定区间；宽容重载为全文
   *  区间）——子引用准入已不以它为界（validChildSource 按来源全文校验），
   *  仅随租约保留定位语义。#337 起 pdf 载荷为零区间占位（PDF 无 LF
   *  坐标——定位由 scope.page 承载） */
  range: { start: number; end: number }
  scope: HoverPreviewScope | RefPdfNavSelector
  path: string[]
  depth: number
  treeId: string
  occurrenceId: string
}

const ACK_CACHE_LIMIT = 64
const VERSION_LOG_LIMIT = 256
/** #222 悬停来源记录集合上限（面板级；嵌入卡片 + 浮层并存的会话内目标数
 * 量级上界，超出按插入序淘汰）。修 4（review 第二轮）：与
 * HOVER_REFRESH_DEFAULTS.embedEntryLimit（webview 嵌入实例状态库上限 64）
 * 对齐——同一会话内「嵌入卡片 + 浮层」的目标集合与嵌入实例库同容量基准，
 * 两侧不再不对称 */
const HOVER_SOURCES_LIMIT = 64

/** #224 图源反查登记上限（会话级；#201 建立时无界，来源化路径并入登记
 * 后补上界——条目为小字符串对，条目数计量足够） */
const IMAGE_SRC_TARGET_LIMIT = 256

/** #224 悬停读取缓存的请求形态键（「按规范目标、范围区分」的形态近似：
 *  三种目标形态互斥——直接目标 / 普通链接 href / 双链 target 原文；范围
 *  锚点已含在各自原文内。P2-03（#280）anchorOptional 并入：刷新宽容
 *  读取（锚点缺失回成功全文）与严格读取（anchor-missing 分态）的结果
 *  形态不同，不得共享缓存条目——宽容成功被严格首开命中会跳过锚点验证，
 *  严格失败缓存（不缓存，天然隔离）反向亦然 */
function hoverShapeKeyOf(
  message: Pick<HoverPreviewRequestPayload, 'target' | 'linkHref' | 'directTarget' | 'anchorOptional'>,
  source?: { fsPath: string; version: number },
): string {
  const prefix = `${source ? `s:${source.fsPath}\n${source.version}\n` : ''}${message.anchorOptional === true ? 'a:' : ''}`
  if (message.directTarget !== undefined) {
    return `${prefix}d:${message.directTarget.fsPath}\n${message.directTarget.anchor ?? ''}`
  }
  if (message.linkHref !== undefined) {
    return `${prefix}h:${message.linkHref}`
  }
  return `${prefix}w:${message.target}`
}

/** 变更组相等（顺序无关）：段内区间互不重叠，排序后逐段比较。
 *  VSCode 对多段 WorkspaceEdit 的回流 contentChanges 按偏移降序到达，
 *  而 webview 出站（CM6 iterChanges）为升序——按序比较会把自家确认
 *  误判为外部变更（#13 表格结构操作的多段变更暴露）。 */
function changesEqual(a: readonly SerChange[], b: readonly SerChange[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  const sortedA = [...a].sort((x, y) => x.offset - y.offset)
  const sortedB = [...b].sort((x, y) => x.offset - y.offset)
  return sortedA.every(
    (c, i) =>
      c.offset === sortedB[i]!.offset && c.length === sortedB[i]!.length && c.text === sortedB[i]!.text,
  )
}

export class DocumentSession {
  private readonly panels = new Map<string, PanelEntry>()
  /** versionLog 同时保存宿主与 LF 两种形态：重定位在 LF 空间进行（C-1），
   *  行尾分布变化在 LF 空间是 no-op，先转后移会把 no-op 当平移错位 */
  private readonly versionLog: {
    version: number
    changes: SerChange[]
    lfChanges: SerChange[]
  }[] = []
  /** 兜底确认记录（C-4）：applyEdit resolve 后回流迟到时，回流到达按
   *  (version, changes) 匹配识别为自家确认，不作为外部变更重复广播 */
  private readonly confirmedEchoes: { version: number; changes: SerChange[] }[] = []
  /** 归属记账数据源：version → 组首来源（合并笔的 joined 不入查询面——
   *  单版本单组身份；完整列表经 onEditAttributed 传递） */
  private readonly attributed: { version: number; seq: number; sessionId: string; origin: EditOriginMeta; joined?: EditOriginMeta[] }[] = []
  /** #48 已应用未确认窗口的外部广播暂存：面板 pending 存在已应用未确认
   *  条目时，外部增量的坐标参考系（权威文本已含该编辑）与 webview 的
   *  ackedChain（不含）不一致——先行广播会让 webview 逆穿 unconfirmed
   *  时把该编辑的偏移计算两次（不重叠时静默错位 len(E)，重叠时误判冲突
   *  暂停）。暂存到 pending 确认后按 version 有序补发，保证 webview 收到
   *  ack(E) → doc.changed(X) 的参考系一致序列，其既有状态机自然正确。 */
  private readonly pendingExternal: { version: number; changes: SerChange[]; reason?: DocumentChangeReason; paste?: PasteHistory }[] = []
  private readonly pasteHistory: PasteHistoryTracker
  /** 换行协调：webview 侧统一 LF 坐标，宿主侧负责与权威文本的 CRLF 双向转换 */
  private readonly newline = new NewlineCoordinator()
  private queue: Promise<void> = Promise.resolve()
  private nextPanelId = 1
  private disposed = false
  private hoverSourceLeaseSeq = 0

  /**
   * 等待本会话在途 edit.request 全部应用到权威 TextDocument（#379 T04
   * 未保存正文协调）：queue 是 edit.request 的串行应用链，await 它即读到
   * 「webview 已出站编辑全部落地」后的当前有效版本。webview 组合期暂缓
   * 未出站的输入不在协调范围（宿主不可见，规格已知边界）。只读等待，
   * 不触发任何编辑或广播。
   */
  whenEditsSettled(): Promise<void> {
    return this.queue.then(() => undefined)
  }
  /** #10 图片解析：同 src 在途去重与成功结果缓存（失败不缓存，重试重解析） */
  private readonly imageInFlight = new Map<string, Promise<ImageResolution>>()
  private readonly imageCache = new Map<string, ImageResolution>()
  /** #201 图源 → 归一目标键登记（失效通道反查：按文件目标找 src 集合）。
   *  #224 起来源化请求（悬停/嵌入 B 图片）同样登记（registerImageSrcTarget
   *  统一入口，有界）——B 图片文件变化经反查命中，广播 image.invalidate */
  private readonly imageSrcTarget = new Map<string, string>()
  /** #201 缓存世代（失效时推进）：在途请求跨失效窗口完成后不得回写缓存 */
  private readonly imageEpochs = new Map<string, number>()
  /** #201 失效时钟（单调）：归一目标键 → 最近失效时刻。在途请求发起时
   *  记当前时钟，完成时对比目标键的失效时刻——失效先于完成（登记尚未
   *  发生、反查为空的竞态窗口）也能检出并补失效广播 */
  private readonly imageInvalidatedAt = new Map<string, number>()
  private imageClock = 0
  /** #201 周期核验串行链（并发有界：同一时刻至多一轮 verify 在途） */
  private verifyChain: Promise<void> = Promise.resolve()
  /** #208 资源代次：手动刷新时自增，工作区图片 webview URI 的 ?v= 戳取
   *  此值（缓存击穿；0 为未刷新初值，URI 不带戳——与现状形态一致） */
  private imageGeneration = 0
  /** #224 悬停读取缓存（按请求形态区分：双链 target / 普通链接 href /
   *  面板直接目标——「按规范目标、版本、范围区分」的形态近似；范围已含
   *  在形态内（锚点在 target/href/anchor 原文中）。成功缓存 + 在途合并
   *  （同形态并发共享一次读取）+ 世代守卫（失效窗口内完成不回写），
   *  先例：imageCache/imageInFlight/imageEpochs（#201/#208 同构） */
  // #342：web 载荷不经会话缓存（web 元信息缓存归 WebLinkMetaService，
  // 外链请求绕过本缓存路径；#336 起 markdown/image 成功结果入缓存——
  // 图片按身份载荷小常数计量，见 commitHoverRead）
  private readonly hoverReadCache = new Map<string, Extract<RefReadOutcome, { ok: true }>>()
  private readonly hoverReadInFlight = new Map<string, Promise<RefReadOutcome>>()
  /** 目标 fsPath → 形态键集合（失效反查：版本变更按目标清缓存） */
  private readonly hoverShapeTargets = new Map<string, Set<string>>()
  /** 形态键 → 失效世代（单调；在途发起时快照、完成时比对） */
  private readonly hoverEpochs = new Map<string, number>()
  /** #224 失效时钟（单调）：目标 fsPath → 最近失效时刻。在途读取发起时
   *  记当前时钟，完成时对比——失效先于完成（此时形态→fsPath 登记尚未
   *  发生、反查为空的竞态窗口）也能检出并放弃缓存写入（imageClock 先例） */
  private readonly hoverInvalidatedAt = new Map<string, number>()
  private hoverClock = 0
  private hoverCacheBytes = 0
  private hoverCacheHits = 0
  private hoverCacheMisses = 0
  private readonly hoverCacheLimits: { entryLimit: number; byteLimit: number }

  constructor(
    private readonly doc: HostDocumentPort,
    private readonly options: DocumentSessionOptions = {},
  ) {
    this.newline.rebuild(doc.getText())
    this.pasteHistory = new PasteHistoryTracker(this.newline.toLfText(doc.getText()))
    this.hoverCacheLimits = {
      entryLimit: options.hoverReadCache?.entryLimit ?? HOVER_REFRESH_DEFAULTS.cacheEntryLimit,
      byteLimit: options.hoverReadCache?.byteLimit ?? HOVER_REFRESH_DEFAULTS.cacheByteLimit,
    }
  }

  private get docUri(): string {
    return this.options.docUri ?? ''
  }

  /** 注册一个面板（resolveCustomTextEditor 时调用），返回 sessionId。
   *  P2-04 起可选 refOrigin：目标编辑端口（嵌入内部 Live 的虚拟面板）携带
   *  来源面板身份，history.request 执行时透传给权威端口 undo/redo */
  attachPanel(port: PanelPort, opts?: { refOrigin?: { docUri: string } }): string {
    const sessionId = `panel-${this.nextPanelId++}`
    this.panels.set(sessionId, {
      sessionId,
      port,
      ready: false,
      refOrigin: opts?.refOrigin,
      pending: [],
      queued: new Map(),
      ackCache: new Map(),
      suspended: false,
      suspendedReason: 'conflict',
      conflictFragments: [],
      compositionPending: false,
      lastConflictRevision: 0,
      conflictNotified: false,
      reloaded: false,
      hoverSourceFsPaths: new Set(),
      hoverSourcePins: new Map(),
      hoverSourceLeases: new Map(),
      hoverLeaseGrants: new Map(),
      hoverParentGrants: new Map(),
      expansionBudget: new RefExpansionBudget(),
    })
    return sessionId
  }

  /**
   * 注销面板。存在未确认输入（暂停快照或在途请求）时必须通知——
   * 面板关闭与 SSH 断连（dispose）都走这里，不得静默丢弃用户输入。
   */
  detachPanel(sessionId: string): void {
    const panel = this.panels.get(sessionId)
    if (panel) {
      const fragments = [...panel.conflictFragments]
      let queuedChanges = false
      for (const changes of panel.queued.values()) {
        queuedChanges ||= changes.length > 0
        for (const change of changes) {
          if (change.text) fragments.push(change.text) // 入队请求本身已是 LF 坐标与文本
        }
      }
      for (const p of panel.pending) {
        if (!p.confirmed) {
          this.collectFragments(fragments, p.changes)
        }
      }
      const snapshotText = panel.compositionSnapshot?.toString() ?? panel.conflictWebviewText
      const pendingComposition = panel.compositionPending && snapshotText !== undefined &&
        snapshotText !== this.newline.toLfText(this.doc.getText())
      if (panel.suspended || fragments.length > 0 || queuedChanges || pendingComposition) {
        this.notify({
          type: 'panel-closed-with-input',
          sessionId,
          docUri: this.docUri,
          fragments,
          // 快照随通知带走（面板即将注销，事后无从查询）；暂停后新输入
          // 与暂缓集内容只在快照里（R-1）
          webviewText: snapshotText,
          ...(panel.refOrigin ? { fromRefPort: true } : {}),
        })
      }
    }
    this.panels.delete(sessionId)
    // #48 收口说明：此处不立即补发暂存的外部增量。被关闭面板可能持有
    // 「已应用未确认」pending（编辑已在权威文档中，其余面板尚未见过）：
    // 先补发更高 version 的外部增量会让随后到达的本笔回流（version 更低）
    // 被 webview 版本单调防线丢弃、增量落点错位。补发由后续路径完成：
    // apply 成功时本笔回流以外部变更身份有序入队（排在本批暂存量之前）
    // 带动补发，失败时由 processEditRequest 的失败分支收口。
  }

  /** P2-13（#290）在途编辑排空等待面：resolve = 调用时刻已入队（含正在
   *  执行）的全部编辑任务完成。父面板关闭交接在 detach 虚拟面板前调用——
   *  在途写回照常完成（P2-01 §7 验证），settle 之后的未确认输入才是真正
   *  未写入 B 的（暂停快照 / 组合期），dirty 判定也取到在途完成后的最新
   *  状态。此后新入队的任务不属于本次等待范围（调用方语义：dispose 时刻
   *  的「宿主可继续完成的在途请求」） */
  settleEdits(): Promise<void> {
    return this.queue
  }

  dispose(): void {
    this.disposed = true
    this.panels.clear()
    this.versionLog.length = 0
    this.confirmedEchoes.length = 0
    this.pendingExternal.length = 0
    this.imageInFlight.clear()
    this.imageCache.clear()
  }

  /** P2-2（review 修复）来源集合查询面：fsPath 是否为本面板实际送达过
   *  hover.result 成功回包的目标——provider 层 hover.watch 登记前的校验
   *  基准（不信任前端任意路径；watch 总在成功装载后，集合已含目标）。
   *  未知会话一律 false */
  hasHoverSource(sessionId: string, fsPath: string): boolean {
    return this.panels.get(sessionId)?.hoverSourceFsPaths.has(fsPath) ?? false
  }

  /** P2-04（#281）occurrence 级来源固定查询面：fsPath 是否为本面板成功
   *  送达 **且被该 occurrence 的 watch 固定** 的目标——refEdit.bind 的校验
   *  基准（绑定要求「宿主已确认的来源租约」：仅送达不够，该引用位置须仍
   *  持有订阅；unwatch/淘汰后固定释放即拒绝重绑）。未知会话一律 false */
  hasHoverSourcePin(sessionId: string, fsPath: string, instanceId: string): boolean {
    const panel = this.panels.get(sessionId)
    if (!panel?.ready || !panel.hoverSourceFsPaths.has(fsPath)) {
      return false
    }
    return panel.hoverSourcePins.get(fsPath)?.has(instanceId) === true
  }

  /** 只有本面板成功送达的目标可持有；来源租约按目标精确转交到 occurrence。 */
  retainHoverSource(sessionId: string, fsPath: string, instanceId: string, sourceLeaseId?: string): boolean {
    const panel = this.panels.get(sessionId)
    if (!panel?.ready || !panel.hoverSourceFsPaths.has(fsPath)) return false
    let pins = panel.hoverSourcePins.get(fsPath)
    if (sourceLeaseId !== undefined && panel.hoverSourceLeases.get(sourceLeaseId) !== fsPath) {
      return pins?.has(instanceId) ?? false // 已持有者重复 watch 不增权限。
    }
    const grant = sourceLeaseId !== undefined ? panel.hoverLeaseGrants.get(sourceLeaseId) : undefined
    if (grant?.occurrenceId && grant.occurrenceId !== instanceId) return false
    if (!pins) {
      pins = new Set()
      panel.hoverSourcePins.set(fsPath, pins)
    }
    pins.add(instanceId)
    if (sourceLeaseId !== undefined) {
      if (grant) panel.hoverParentGrants.set(instanceId, grant)
      panel.hoverLeaseGrants.delete(sourceLeaseId)
      panel.hoverSourceLeases.delete(sourceLeaseId)
    }
    this.trimHoverSources(panel)
    return true
  }

  /** 仅未订阅的读取记录参与 LRU；活跃来源过限暂时保留，预算由展开层负责。 */
  private trimHoverSources(panel: PanelEntry, justDelivered?: string): void {
    const leasedTargets = new Set(panel.hoverSourceLeases.values())
    for (const fsPath of panel.hoverSourceFsPaths) {
      if (panel.hoverSourceFsPaths.size <= HOVER_SOURCES_LIMIT) break
      if (fsPath !== justDelivered && !panel.hoverSourcePins.has(fsPath) &&
        !leasedTargets.has(fsPath)) {
        panel.hoverSourceFsPaths.delete(fsPath)
      }
    }
  }

  /** webview 消息入口（provider 接到 webview.onDidReceiveMessage 后调用） */
  async handleWebviewMessage(message: unknown, sessionId: string): Promise<void> {
    if (this.disposed) {
      return Promise.resolve()
    }
    const panel = this.panels.get(sessionId)
    if (!panel || !isWebviewToHost(message)) {
      return Promise.resolve()
    }
    switch (message.kind) {
      case 'sync.test.close':
        // 仅由测试模式的 provider 消费；若绕过面板入口则无副作用。
        return Promise.resolve()
      case 'backlinks.get':
      case 'backlink.activate':
        // #197 反链面板：面板级 UI 意图，provider 层拦截消费（索引服务与
        // 跳转执行都在 provider 域）；绕过面板入口则无副作用。
        return Promise.resolve()
      case 'wikilink.query':
        // #376 T01 双链联想查询：provider 层拦截消费（索引服务在 provider
        // 域）；绕过面板入口则无副作用。
        return Promise.resolve()
      case 'wikilink.heading.query':
        // #379 T04 标题联想查询：同 wikilink.query——provider 层拦截消费
        //（目标解析与 TextDocument 读取在 provider 域）；绕过面板入口则
        // 无副作用。
        return Promise.resolve()
      case 'outlinks.get':
      case 'outlink.activate':
        // 出链面板（与反链镜像）：provider 层拦截消费；绕过面板入口无副作用
        return Promise.resolve()
      case 'hover.watch':
      case 'hover.unwatch':
        // provider 消费订阅协调；会话持有来源授权，固定的来源不参与缓存淘汰。
        if (!panel.ready || message.docUri !== this.docUri || message.sessionId !== sessionId) {
          return Promise.resolve()
        }
        if (message.kind === 'hover.watch') {
          this.retainHoverSource(sessionId, message.fsPath, message.instanceId, message.sourceLeaseId)
        } else {
          const pins = panel.hoverSourcePins.get(message.fsPath)
          pins?.delete(message.instanceId)
          if (pins?.size === 0) panel.hoverSourcePins.delete(message.fsPath)
          panel.hoverParentGrants.delete(message.instanceId)
          panel.expansionBudget.release(message.instanceId)
          this.trimHoverSources(panel)
        }
        return Promise.resolve()
      case 'hover.tokens.request': {
        // #340（P3-08）文本 token 请求：会话守卫与 hover.request 同款；
        // **fsPath 来源守卫**——必须是本面板成功送达过的目标
        // （hoverSourceFsPaths，成功读取即入集合），被攻陷 webview 不能借
        // 本通道探测任意文件的内容侧信道。计算经面板端口注入（外观服务），
        // 结果按 reqId+instanceId 回来源面板（webview 侧再做版本配对——
        // 迟到/过期 token 不覆盖新正文）。只读交互：不进 edit.request
        // 通道、不建租约，暂停态同样放行
        if (!panel.ready || message.docUri !== this.docUri) {
          return Promise.resolve()
        }
        if (!panel.hoverSourceFsPaths.has(message.fsPath)) {
          panel.port.send({
            kind: 'hover.tokens', reqId: message.reqId, instanceId: message.instanceId, ok: false, reason: 'stale',
          })
          return Promise.resolve()
        }
        const tokenPort = panel.port.readTextTokens
        if (!tokenPort) {
          panel.port.send({
            kind: 'hover.tokens', reqId: message.reqId, instanceId: message.instanceId, ok: false, reason: 'unavailable',
          })
          return Promise.resolve()
        }
        tokenPort(
          { fsPath: message.fsPath, version: message.version, beginLine: message.beginLine, endLine: message.endLine },
          (result) => {
            if (this.disposed || this.panels.get(sessionId) !== panel) {
              return
            }
            panel.port.send(
              result.ok
                ? {
                    kind: 'hover.tokens',
                    reqId: message.reqId,
                    instanceId: message.instanceId,
                    ok: true,
                    fsPath: message.fsPath,
                    version: result.version,
                    layer: result.layer,
                    colors: result.colors,
                    tokens: result.tokens,
                  }
                : {
                    kind: 'hover.tokens',
                    reqId: message.reqId,
                    instanceId: message.instanceId,
                    ok: false,
                    reason: result.reason,
                  },
            )
          },
        )
        return Promise.resolve()
      }
      case 'hover.target.resolve': {
        // #299 跳转目标提示轻量解析：会话守卫与其余请求同款（就绪且
        // docUri 匹配才放行，否则静默丢弃）；解析执行经面板端口注入
        // （resolveHoverTargetTip——只解析不读正文），结果回来源面板
        //（reqId 配对）。只读交互：不进 edit.request 通道、不建
        // hover.request/watch 的读取与租约链路，暂停态同样放行
        if (!panel.ready || message.docUri !== this.docUri) {
          return Promise.resolve()
        }
        const port = panel.port.resolveHoverTarget
        if (!port) {
          panel.port.send({ kind: 'hover.target.resolved', reqId: message.reqId, ok: false })
          return Promise.resolve()
        }
        port(
          {
            ...(message.target !== undefined ? { target: message.target } : {}),
            ...(message.linkHref !== undefined ? { linkHref: message.linkHref } : {}),
            ...(message.directTarget !== undefined ? { directTarget: message.directTarget } : {}),
          },
          (result) => {
            if (this.disposed || this.panels.get(sessionId) !== panel) return
            panel.port.send(
              result.ok
                ? { kind: 'hover.target.resolved', reqId: message.reqId, ok: true, relPath: result.relPath,
                    ...(result.anchor ? { anchor: result.anchor } : {}) }
                : { kind: 'hover.target.resolved', reqId: message.reqId, ok: false },
            )
          },
        )
        return Promise.resolve()
      }
      case 'hover.source.release':
        if (panel.ready && message.docUri === this.docUri && message.sessionId === sessionId) {
          const grant = panel.hoverLeaseGrants.get(message.sourceLeaseId)
          const otherLease = grant?.occurrenceId && [...panel.hoverLeaseGrants].some(([token, other]) =>
            token !== message.sourceLeaseId && other.occurrenceId === grant.occurrenceId)
          if (grant?.occurrenceId && !panel.hoverParentGrants.has(grant.occurrenceId) &&
            !panel.expansionBudget.hasActiveRead(grant.occurrenceId) && !otherLease) {
            panel.expansionBudget.release(grant.occurrenceId)
          }
          panel.hoverSourceLeases.delete(message.sourceLeaseId)
          panel.hoverLeaseGrants.delete(message.sourceLeaseId)
          this.trimHoverSources(panel)
        }
        return Promise.resolve()
      case 'settings.open':
        // #33 打开设置页：不依赖文档状态（无文档语义在宿主层闭合），
        // 暂停态同样放行（与 link.activate 同口径的只读交互）
        panel.port.openSettings?.()
        return Promise.resolve()
      case 'settings.get':
        // #33 设置快照拉取：响应权威快照（webview 不持久化设置）
        if (panel.port.requestSettings) {
          panel.port.send({ kind: 'settings.snapshot', values: panel.port.requestSettings() })
        }
        return Promise.resolve()
      case 'findOptions.get':
      case 'findOptions.set':
        // #236 查找选项：provider 层拦截消费（持久化与广播在 provider
        // 域）；绕过面板入口则无副作用
        return Promise.resolve()
      case 'diagram.export': {
        // #111 图表导出：只读交互（不写文档、不入撤销栈），暂停态同样
        // 放行（与 clipboard.write 同口径）；结果回来源面板。会话守卫
        // 对齐 codeblock.copy 先例（就绪且 docUri 匹配才放行，否则静默丢弃）
        if (!panel.ready || message.docUri !== this.docUri) {
          return Promise.resolve()
        }
        const report = (result: { ok: boolean; reason?: DiagramExportFailReason }): void => {
          panel.port.send({
            kind: 'diagram.export.result',
            reqId: message.reqId,
            ok: result.ok,
            ...(result.reason !== undefined ? { reason: result.reason } : {}),
          })
        }
        if (panel.port.exportDiagram) {
          panel.port.exportDiagram(message, report)
        } else {
          report({ ok: false, reason: 'invalid' })
        }
        return Promise.resolve()
      }
      case 'image.export': {
        // #212 图片导出：只读交互（不写文档、不入撤销栈），会话守卫与
        // diagram.export 同口径（就绪且 docUri 匹配才放行，否则静默丢弃）；
        // 结果回来源面板（宿主通知呈现，弹窗侧无 UI 反馈需求）。
        // P2-11（#288）sourceDocUri（嵌入内部 Live 弹窗导出的 B 来源）：
        // 与 link.activate / image.request 的来源守卫同口径——须为本面板
        // 实际送达过的目标，不匹配即丢弃（B 内图片按 A 目录导出是错误
        // 文件，宁可不动作不回落）
        if (!panel.ready || message.docUri !== this.docUri) {
          return Promise.resolve()
        }
        if (message.sourceDocUri !== undefined && !panel.hoverSourceFsPaths.has(message.sourceDocUri)) {
          return Promise.resolve()
        }
        const report = (result: { ok: boolean; reason?: ImageExportFailReason }): void => {
          panel.port.send({
            kind: 'image.export.result',
            reqId: message.reqId,
            ok: result.ok,
            ...(result.reason !== undefined ? { reason: result.reason } : {}),
          })
        }
        if (panel.port.exportImage) {
          panel.port.exportImage(message, report)
        } else {
          report({ ok: false, reason: 'invalid' })
        }
        return Promise.resolve()
      }
      case 'settings.set':
      case 'paste.preferences.set':
        // #33 设置保存只在设置页 webview 链路（settingsPage 模块）处理，
        // 编辑器面板不会发出；到达此处无副作用
        return Promise.resolve()
      case 'snippets.get':
        // #128 片段清单拉取：面板端口逐面板构造 URI（webview 资源前缀私有）；
        // 端口未接线（异常装配）时以空清单应答（webview 清空本地装配）
        panel.port.send({ kind: 'snippets.snapshot', ...(panel.port.requestSnippets?.() ?? { version: 0, snippets: [] }) })
        return Promise.resolve()
      case 'snippets.loadResult':
        // #128 片段链装载结果：转发面板端口（宿主用户提示/诊断）；只读交互
        panel.port.onSnippetLoad?.(message.name, message.version, message.ok)
        return Promise.resolve()
      case 'snippets.chooseDirectory':
      case 'snippets.setDirectory':
      case 'snippets.setEnabled':
      case 'snippets.setPaused':
      case 'snippets.refresh':
      case 'snippets.openDirectory':
      case 'styleRef.export':
        // #128 片段管理动作与 #145 契约 JSON 导出只在设置页 webview 链路
        // （settingsPage 模块）处理，编辑器面板不会发出；到达此处无副作用
        // （保持协议穷尽）。#131 setPaused 同口径（编辑器侧暂停/恢复走宿主
        // 命令，不经面板）
        return Promise.resolve()
      case 'index.get':
      case 'index.setPatterns':
      case 'index.resetPatterns':
      case 'index.cleanup':
      case 'index.rebuild':
      case 'index.cancel':
        // #198 索引维护只在设置页 webview 链路（settingsPage 模块）处理，
        // 编辑器面板不会发出；到达此处无副作用（保持协议穷尽）
        return Promise.resolve()
      case 'wordSegment.get':
      case 'wordSegment.loadResult':
        // #239 分词资源状态：wordSegment.get 的应答在 provider 层处理
        //（资源 URI 逐面板经 asWebviewUri 构造）；loadResult 由 provider
        // 转发宿主通知。此处仅保持协议穷尽
        return Promise.resolve()
      case 'wordSegment.download':
      case 'wordSegment.delete':
        // #239 下载/删除只在设置页 webview 链路（settingsPage 模块）处理，
        // 编辑器面板不会发出；到达此处无副作用（保持协议穷尽）
        return Promise.resolve()
      case 'keybindings.get':
      case 'keybindings.set':
      case 'keybindings.reset':
      case 'keybindings.resetAll':
      case 'keybindings.execute':
        // 快捷键端口在 provider / 设置页消费；此处仅保持协议穷尽。
        return Promise.resolve()
      case 'view.switch.request':
        // #141 双态切换端口在 provider 消费（runViewSwitch 编排）；此处
        // 仅保持协议穷尽——会话层不触碰视图切换
        return Promise.resolve()
      case 'clipboard.write':
        // #69 剪贴板写：与 link.activate 同口径的只读交互（不受写回暂停
        // 影响）；三变体（text 直写 / linkHeading 宿主拼标题链接 / linkBlock
        // 宿主拼块链接 #162）分别转发到注入端口
        if ('text' in message) {
          // #81 行尾契约（review-loops 修复：此前 text 变体漏归一）：webview
          // 出站恒 LF（CM6 LF 模型），CRLF 文档按权威行尾归一后写入——与
          // codeblock.copy 同式，剪贴板产物与文档行尾一致
          panel.port.writeClipboard?.(
            this.doc.eol === 2 ? message.text.replace(/\n/g, '\r\n') : message.text,
          )
        } else if ('linkHeading' in message) {
          panel.port.writeHeadingLinkClipboard?.(message.linkHeading.docUri, message.linkHeading.heading)
        } else if ('linkBlock' in message) {
          panel.port.writeBlockLinkClipboard?.(message.linkBlock.docUri, message.linkBlock.blockId)
        }
        return Promise.resolve()
      case 'clipboard.read': {
        // #183 剪贴板读（粘贴桥）：只读交互（与 clipboard.write 同口径，
        // 暂停态同样放行）；端口未接线/读失败回报 read-failed（webview 放弃
        // 粘贴并记告警日志，不弹窗）
        const report = (result: { ok: true; text: string } | { ok: false; reason: 'read-failed' }): void => {
          panel.port.send(result.ok
            ? { kind: 'clipboard.read.result', reqId: message.reqId, ok: true, text: result.text }
            : { kind: 'clipboard.read.result', reqId: message.reqId, ok: false, reason: result.reason })
        }
        if (!panel.port.readClipboard) {
          report({ ok: false, reason: 'read-failed' })
          return Promise.resolve()
        }
        return panel.port.readClipboard().then((text) => {
          report(text === null ? { ok: false, reason: 'read-failed' } : { ok: true, text })
        })
      }
      case 'ready': {
        const wasReady = panel.ready
        this.sendInit(panel)
        if (wasReady) {
          // 重复 ready = webview 重载（B-2）：init 已重发权威全文，此后暂停
          // 面板的 view.state 不再代表冲突前的未确认输入
          panel.reloaded = true
          // #316（b2 形态 1）：重载即该面板旧端口族的逻辑死亡信号——
          // webview 侧端口状态库随重建丢失，旧 portId 无人再引用。provider
          // 据此整体释放（保留 #290 记账）；re-bind 走新端口等价自愈
          this.options.onPanelReload?.(sessionId)
        }
        // #96 R1 ready 即校准：语言变化只广播给切换瞬间 ready 的面板，
        // 重载（数据岛装回创建时语言）与未 ready 面板都会错过——每次
        // ready 按供应者现值幂等补发（webview 收到后原子换包并重渲染）
        const locale = this.options.requestLocale?.()
        if (locale) {
          panel.port.send({
            kind: 'locale.changed',
            lang: locale.lang,
            messages: locale.messages,
          })
        }
        if (panel.suspended) {
          // webview 重载（retainContextWhenHidden 关闭）后恢复暂停提示：
          // 快照保留在宿主侧，取回途径不受重载影响；reason 透传真实暂停
          // 原因（conflict / host-error），不硬编码
          panel.port.send({
            kind: 'session.suspended',
            version: this.doc.version,
            reason: panel.suspendedReason,
          })
        }
        return Promise.resolve()
      }
      case 'edit.request': {
        if (!panel.ready || message.docUri !== this.docUri) {
          return Promise.resolve()
        }
        // 已确认 seq 的重传直接回复原 ack；其他面板可能占住全局队列，
        // 若先登记 queued，关闭本面板时会把已经保存的输入误报为未确认。
        const cached = panel.ackCache.get(message.seq)
        if (cached) {
          panel.port.send(cached)
          return Promise.resolve()
        }
        if (!panel.queued.has(message.seq)) panel.queued.set(message.seq, message.changes)
        const task = this.queue.then(() => {
          // 同一个微任务中从 queued 移入 processEditRequest 的 pending；
          // 关闭面板不会观察到两者都为空的中间窗口。
          panel.queued.delete(message.seq)
          return this.processEditRequest(panel, message)
        })
        this.queue = task.catch(() => undefined)
        return task
      }
      case 'conflict.report': {
        if (message.docUri !== this.docUri) {
          return Promise.resolve() // C-6：与 edit.request 对称的 docUri 校验
        }
        // webview 冲突快照：与请求片段并存（fragments 是逐笔输入，全文是
        // 完整上下文），用户取回时优先最新 view.state，此处留存兜底
        if (message.revision > panel.lastConflictRevision) {
          panel.lastConflictRevision = message.revision
          panel.conflictWebviewText = message.text
          panel.conflictWebviewVersion = message.version
          if (message.compositionPending !== undefined) {
            panel.compositionPending = message.compositionPending
            panel.compositionSnapshot = message.compositionPending
              ? Text.of(message.text.split('\n'))
              : undefined
          }
        }
        return Promise.resolve()
      }
      case 'composition.changed': {
        if (message.docUri !== this.docUri || !panel.compositionPending ||
            !panel.compositionSnapshot || message.revision <= panel.lastConflictRevision) {
          return Promise.resolve()
        }
        let snapshot = panel.compositionSnapshot
        let nextStart = snapshot.length
        for (const change of [...message.changes].sort((a, b) => b.offset - a.offset)) {
          if (change.offset + change.length > nextStart) return Promise.resolve()
          snapshot = snapshot.replace(change.offset, change.offset + change.length,
            Text.of(change.text.split('\n')))
          nextStart = change.offset
        }
        panel.compositionSnapshot = snapshot
        panel.lastConflictRevision = message.revision
        return Promise.resolve()
      }
      case 'conflict.action': {
        if (message.docUri !== this.docUri) {
          return Promise.resolve() // C-6：非本文档的冲突动作不得影响本面板
        }
        if (message.action === 'copy') {
          this.notify({ type: 'copy-request', sessionId, docUri: this.docUri })
        } else {
          this.resumePanel(sessionId)
        }
        return Promise.resolve()
      }
      case 'history.request': {
        // 撤销/重做经队列串行：排在在途 edit.request 之后，保证撤销的是
        // 已完整应用（含回流确认）的编辑；undo/redo 的文档变更经
        // handleDocChanged 回流广播（逆变更不匹配任何 pending 正向变更，
        // 天然走 external 分支，不会作为确认吞掉）。
        // #148：本保证只覆盖「已到达宿主」的请求——webview 手里暂缓未发的
        // 编辑（IME/触碰暂缓集）宿主不可见，由 webview 侧竞态守卫保证
        // history.request 不早于这些编辑的 edit.request 发出
        if (!panel.ready || panel.suspended) {
          // 暂停面板忽略（B-4，与 edit.request 一致）：宿主 undo 命令作用于
          // 活动编辑器，暂停面板的请求会撤销到其他目标文档
          return Promise.resolve()
        }
        const op = message.op
        // P2-04（#281）：目标编辑端口（虚拟面板）携来源身份——provider 的
        // undo/redo 实现据此走 P2-01 验证的激活路由；根面板（无 refOrigin）
        // 传 undefined，既有语义不变
        const origin = panel.refOrigin
        const task = this.queue.then(() =>
          op === 'undo' ? this.doc.undo(origin) : this.doc.redo(origin))
        this.queue = task.then(() => undefined, () => undefined)
        // #380 T05：实际执行的历史操作落定后通知 provider（块 ID 撤回协调
        //  的观察点——undo 撤掉来源链接时尽力撤回目标新增标记）
        void task.then((executed) => {
          if (executed) {
            this.options.onHistoryApplied?.(op)
          }
        })
        return task.then(() => undefined)
      }
      case 'sync.request': {
        if (!panel.ready) {
          return Promise.resolve()
        }
        if (panel.suspended) {
          // P2-12（#289）：暂停面板的重同步请求 = 放弃当前版本／对比转交后
          // 重新对齐 B——走恢复语义（清暂停与冲突快照 + 权威全文 doc.resync）。
          // 只发 doc.resync 不清 suspended 会把后续输入全部落入冲突快照
          // 黑洞（宿主暂停是写回裁决的权威侧，webview 侧标志不替代它）
          this.resumePanel(sessionId)
          return Promise.resolve()
        }
        panel.port.send({
          kind: 'doc.resync',
          version: this.doc.version,
          text: this.newline.toLfText(this.doc.getText()),
        })
        return Promise.resolve()
      }
      case 'view.state':
        panel.lastViewState = message
        this.options.onViewState?.(sessionId, message)
        return Promise.resolve()
      case 'view.locate.ack':
        // 定位送达确认（#163 验收反馈）：offset 对账后清除待送达意图——
        // 陈旧 ack（连续跳转中前一次的迟到回执）不得误清后一次的意图
        if (message.offset === this.lastLocate?.offset) {
          this.lastLocate = null
        }
        return Promise.resolve()
      case 'link.activate': {
        // #10 链接跳转意图：校验归属与 ready 后交面板端口执行。只读交互，
        // 不受写回暂停影响（暂停面板照样可以点链接）。#220 sourceDocUri
        //（悬停浮层内链接）：与面板已送达的悬停来源比对，不匹配即丢弃
        //——B 内链接按 A 目录解析是错误语义，宁可不动作（不回落）
        if (!panel.ready || message.docUri !== this.docUri) {
          return Promise.resolve()
        }
        if (message.sourceDocUri !== undefined && !panel.hoverSourceFsPaths.has(message.sourceDocUri)) {
          return Promise.resolve()
        }
        panel.port.openLink?.({
          href: message.href,
          srcStart: message.srcStart,
          srcEnd: message.srcEnd,
          ...(message.sourceDocUri !== undefined ? { sourceDocUri: message.sourceDocUri } : {}),
        })
        return Promise.resolve()
      }
      case 'wikilink.activate': {
        // #11 双链跳转意图：与 link.activate 同校验口径（归属 + ready），
        // 执行（按名/路径解析、打开与定位）归宿主 vscode 层。#220
        // sourceDocUri（悬停浮层内双链）守卫与 link.activate 同
        if (!panel.ready || message.docUri !== this.docUri) {
          return Promise.resolve()
        }
        if (message.sourceDocUri !== undefined && !panel.hoverSourceFsPaths.has(message.sourceDocUri)) {
          return Promise.resolve()
        }
        panel.port.openWikilink?.({
          target: message.target,
          srcStart: message.srcStart,
          srcEnd: message.srcEnd,
          ...(message.sourceDocUri !== undefined ? { sourceDocUri: message.sourceDocUri } : {}),
        })
        return Promise.resolve()
      }
      case 'codeblock.copy': {
        // #81 代码块复制请求：webview 只上报代码体原文，剪贴板写入执行
        // 归宿主（webview 不触碰剪贴板权限）；只读交互，暂停态同样放行。
        // webview 出站恒为 LF（CM6 LF 模型，代码体不含 \r）——CRLF 文档按
        // 权威行尾归一后写入，复制产物与文档行尾一致
        if (!panel.ready || message.docUri !== this.docUri) {
          return Promise.resolve()
        }
        panel.port.writeClipboard?.(this.doc.eol === 2 ? message.text.replace(/\n/g, '\r\n') : message.text)
        return Promise.resolve()
      }
      case 'image.request': {
        // #10 图片解析请求：同 src 在途去重 + 成功缓存（失败重试重解析）。
        // 返回完成 Promise（image.result 已回发才算处理完，调用方可等待）。
        // #220 来源化请求（sourceDocUri = 悬停浮层 B 文档身份）：守卫通过
        // 后走独立解析路径——不进会话缓存/在途去重表（键为裸 src，跨来源
        // 会串台；浮层短生命周期，跨开缓存属 #224 有界缓存）
        if (!panel.ready || message.docUri !== this.docUri) {
          return Promise.resolve()
        }
        if (message.sourceDocUri !== undefined) {
          return this.resolveSourcedImageRequest(panel, message.reqId, message.src, message.sourceDocUri)
        }
        return this.resolveImageRequest(panel, message.reqId, message.src)
      }
      case 'image.verify': {
        // #201 周期核验：会话守卫对齐 image.request；items 透传注入端口
        // （决策与失效由 provider 协调器执行），串行合并保证并发有界
        if (!panel.ready || message.docUri !== this.docUri) {
          return Promise.resolve()
        }
        return this.enqueueImageVerify(message.items)
      }
      case 'image.paste': {
        // #161 图片粘贴落盘：会话守卫对齐 image.request / diagram.export
        // 先例（就绪且 docUri 匹配才放行，否则静默丢弃）；结果回来源面板。
        // 写文档动作不在会话内发生（落盘是文件系统写入；正文插入由 webview
        // 收结果后走标准 edit.request），暂停面板的粘贴拦截已在 webview 侧
        // 守卫——到达此处的暂停面板请求照常落盘但 webview 不插入（无撕裂）
        if (!panel.ready || message.docUri !== this.docUri) {
          return Promise.resolve()
        }
        const report = (result: ImagePasteOutcome): void => {
          panel.port.send(
            result.ok
              ? { kind: 'image.paste.result', reqId: message.reqId, ok: true, markdown: result.markdown! }
              : {
                  kind: 'image.paste.result',
                  reqId: message.reqId,
                  ok: false,
                  reason: result.reason ?? 'invalid',
                },
          )
        }
        if (panel.port.pasteImage) {
          panel.port.pasteImage(message, report)
        } else {
          report({ ok: false, reason: 'invalid' })
        }
        return Promise.resolve()
      }
      case 'refresh.request': {
        // #208 手动刷新：清图片解析缓存、推进资源代次，回发失效通知
        // （webview 据此全量失效重挂，重新解析取到带新代次戳的 URI）。
        // 只读交互（不写文档、不入撤销栈），暂停态同样放行——与
        // image.request 同口径的会话守卫（就绪且 docUri 匹配才放行）
        if (!panel.ready || message.docUri !== this.docUri) {
          return Promise.resolve()
        }
        const generation = this.invalidateImages()
        panel.port.send({ kind: 'refresh.invalidated', reqId: message.reqId, generation })
        return Promise.resolve()
      }
      case 'hover.cancel': {
        // #342（P3-10）悬停请求取消：webview 浮层关闭/换目标时中止在途
        // 抓取（外链元信息的合并消费者离开；markdown 读取不可中止——迟到
        // 回包由 reqId/instanceId 配对守卫丢弃，行为不变）。只读消息
        if (!panel.ready || message.docUri !== this.docUri) {
          return Promise.resolve()
        }
        panel.port.cancelHoverRead?.({ instanceId: message.instanceId, reqId: message.reqId })
        return Promise.resolve()
      }
      case 'hover.request': {
        // #218 悬停预览文档读取：会话守卫对齐 image.request / diagram.export
        // 先例（就绪且 docUri 匹配才放行，否则静默丢弃）；读取执行经面板
        // 端口注入（hoverDocAccess 无副作用路径），结果回来源面板（reqId +
        // instanceId 双配对——迟到回包由 webview 侧实例守卫丢弃）。只读
        // 交互：不进 edit.request 通道、不写文档，暂停态同样放行。
        // #219 起成功形态透传语义范围选择器（full/heading/block）、失败
        // 形态透传锚点原文（anchor-missing 就地提示用）。
        // #224 读取缓存：同形态合并读取（在途共享）+ 成功缓存（有界双上
        // 限）+ 失效按目标 fsPath 反查清理（invalidateHoverReads，事件通
        // 道由 provider 协调器调用）；失败不缓存（保留重试语义）
        if (!panel.ready || message.docUri !== this.docUri) {
          return Promise.resolve()
        }
        const reject = (reason: HoverPreviewFailReason): void => panel.port.send({
          kind: 'hover.result', reqId: message.reqId, instanceId: message.instanceId, ok: false, reason,
        })
        let parent: HoverSourceGrant | undefined
        let verifiedSource: { fsPath: string; version: number } | undefined
        if (message.source !== undefined) {
          parent = panel.hoverParentGrants.get(message.source.parentInstanceId)
          if (!parent || parent.fsPath !== message.source.sourceDocUri ||
            !panel.hoverSourcePins.get(parent.fsPath)?.has(message.source.parentInstanceId) ||
            message.directTarget !== undefined || message.linkHref !== undefined) {
            reject('source-expired')
            return
          }
          const current = await panel.port.readHoverSource?.(parent.fsPath)
          if (!current || !validChildSource(parent, current, message.sourceStart, message.sourceEnd, message.target)) {
            reject('source-expired')
            return
          }
          verifiedSource = { fsPath: parent.fsPath, version: parent.version }
        }
        const depth = parent ? parent.depth + 1 : 1
        const treeId = parent?.treeId ?? message.occurrenceId ?? message.instanceId
        const occurrenceId = message.occurrenceId
        const readToken = Symbol('hover-read')
        if (occurrenceId !== undefined) {
          panel.expansionBudget.setDepthLimit(this.options.getEmbedDepthLimit?.() ?? REF_EXPANSION_LIMITS.defaultDepth)
          const admission = panel.expansionBudget.admitRead(treeId, occurrenceId, depth, readToken)
          if (admission !== 'ok') {
            reject(admission === 'depth' ? 'depth' : 'budget')
            return
          }
        }
        const report = (result: RefReadOutcome): void => {
          const currentRead = occurrenceId === undefined ||
            panel.expansionBudget.isCurrentRead(occurrenceId, readToken)
          if (occurrenceId !== undefined) panel.expansionBudget.finishRead(occurrenceId, readToken)
          if (this.disposed || this.panels.get(sessionId) !== panel) return
          if (!currentRead) result = { ok: false, reason: 'source-expired' }
          if (message.source !== undefined && panel.hoverParentGrants.get(message.source.parentInstanceId) !== parent) {
            result = { ok: false, reason: 'source-expired' }
          }
          // #342（P3-10）web 通道出站：外链卡片载荷走 hover.result 的 web
          // 形态（Markdown 专属字段为占位值）。无本地文件身份——不进
          // cycle/attachContent/租约/来源集合/expansionPath 链路（网页缓存
          // 按规范 URL 与形态在抓取服务内管理，不伪造宿主文档版本）
          if (result.ok && result.content.kind === 'web') {
            panel.port.send({
              kind: 'hover.result',
              reqId: message.reqId,
              instanceId: message.instanceId,
              ok: true,
              contentKind: 'web',
              web: {
                url: result.content.url,
                domain: result.content.domain,
                title: result.content.title,
                description: result.content.description,
                // #343（P3-11）page 形态嵌入预检透传（card 形态缺席）
                ...(result.content.frame !== undefined ? { frame: result.content.frame } : {}),
              },
              target: { fsPath: '', relPath: '' },
              version: 0,
              text: '',
              range: { start: 0, end: 0 },
              scope: { kind: 'full' },
            })
            // web 无租约、无内容挂载，webview 侧 web 浮层也不 watch——
            // 失败分支与 unwatch/source.release 的释放路径全部不可达，
            // 出站即就地释放读取预留（review 修复：防重复外链悬停后面板
            // 实例预算耗尽，64 次开-关后新悬停一律 budget 拒绝）
            if (occurrenceId !== undefined) panel.expansionBudget.release(occurrenceId)
            return
          }
          // 窄化：web 已出站返回，此后成功结果为 markdown / image / pdf /
          // text 载荷（#336 登记 image；#337 登记 pdf；#340 登记 text）；
          // 未知扩展类型防御性收敛 non-markdown（结构性不可达）
          let outcome: { ok: true; fsPath: string; relPath: string; content: RefMarkdownContent | RefImageContent | RefPdfContent | RefTextContent } | { ok: false; reason: HoverPreviewFailReason; anchor?: string; anchorDetail?: HoverAnchorInvalidDetail }
          if (result.ok) {
            // 解构后判别：TS 判别联合窄化不支持 x.content.kind 嵌套路径，
            // content 单独绑定后 kind 判别为标准形态
            const { fsPath, relPath, content } = result
            outcome = content.kind === 'markdown' || content.kind === 'image' || content.kind === 'pdf' || content.kind === 'text'
              ? { ok: true, fsPath, relPath, content }
              : { ok: false, reason: 'non-markdown' }
          } else {
            outcome = result
          }
          // P2-03（#280，ADR-0011）：祖先循环按规范目标文档身份判定——不同
          // 锚点不能绕过祖先循环，同目标兄弟 occurrence 仍合法。判定只对
          // **链上子引用**（带来源）生效：第一跳（无 parent）不判循环——
          // 页内锚点/自文档引用合法打开（目标即来源文档自身，一期 #219 契约
          // 保持）；其内容中的再引用在链上按文档身份截断（深度与预算兜底）。
          // grant.path/expansionPath 仍从根面板起算——B→A 回指在链上可见。
          const pathToParent = parent?.path ?? [canonicalRefTargetKey(
            this.options.rootFsPath ?? this.docUri, this.options.isWindowsHost ?? false)]
          if (outcome.ok) {
            const key = canonicalRefTargetKey(outcome.fsPath, this.options.isWindowsHost ?? false)
            // 内容字节费用按类型计（#337/#336/#340）：markdown 为 LF 全文
            // UTF-16（+ 小常数开销）；text 为窗口正文 LF UTF-16（#range 硬
            // 窗口只计 B–E 行——范围外结构性不可达，不占预算）；pdf 为源
            // 文件字节（逻辑预算费用，不代表解码内存）；image/web 载荷无
            // 正文——按身份载荷小常数计量（图片解码内存归图片管线，与普通
            // Markdown 图片同口径，不占文本预算大额）
            const contentBytes = (outcome.content.kind === 'markdown' || outcome.content.kind === 'text')
              ? outcome.content.lfText.length * 2 + 128
              : outcome.content.kind === 'pdf'
                ? outcome.content.bytes + 128
                : 256
            if (parent !== undefined && occurrenceId !== undefined && inExpansionPath(pathToParent, key)) outcome = { ok: false, reason: 'cycle' }
            else if (occurrenceId !== undefined && panel.expansionBudget.attachContent(
              occurrenceId, `${occurrenceId}\n${outcome.fsPath}\n${outcome.content.version}`,
              contentBytes) !== 'ok') {
              outcome = { ok: false, reason: 'budget' }
            }
          }
          const sourceLeaseId = outcome.ok && message.retainSource
            ? `${sessionId}:source-${++this.hoverSourceLeaseSeq}` : undefined
          if (outcome.ok) {
            if (sourceLeaseId !== undefined) {
              panel.hoverSourceLeases.set(sourceLeaseId, outcome.fsPath)
              panel.hoverLeaseGrants.set(sourceLeaseId, {
                fsPath: outcome.fsPath, version: outcome.content.version,
                // #336：图片载荷无定位区间与 Markdown 选择器——租约只保留
                // 身份语义（range/scope 退化中性值；图片无锚点定位语义）；
                // #337：pdf 载荷无 LF 区间语义——零区间占位（定位由 pdf
                // 选择器的 page 承载，租约保留 pdf 选择器）；#340：text 载荷
                // 的选择器为 RefTextNavSelector（非 HoverPreviewScope）——
                // 租约的 scope 字段只保留定位语义，text 归 full 形态（观感/
                // 观测面），锚点语义在 textNav 载荷
                range: (outcome.content.kind === 'markdown' || outcome.content.kind === 'text')
                  ? outcome.content.range
                  : { start: 0, end: 0 },
                scope: outcome.content.kind === 'markdown' || outcome.content.kind === 'pdf'
                  ? outcome.content.selector
                  : { kind: 'full' },
                path: [...pathToParent, canonicalRefTargetKey(outcome.fsPath, this.options.isWindowsHost ?? false)],
                depth, treeId, occurrenceId: occurrenceId ?? '',
              })
            }
            // #220/#222 来源记录：成功读取即入集合（嵌入卡片与浮层多目标
            // 共存；有界淘汰防无界增长——过期成员最多放宽一个已不在场目标
            // 的点击守卫，DOM 已不在则点击本就不发生）。P3-2（review 修复）：
            // 已存在成员重读时移到队尾（插入序 = 淘汰序改最近读取序）——
            // #242 watch 持有者固定来源；LRU 只回收未固定记录，刚送达
            // 的目标保留到前端订阅（或下一次读取后回收）。
            if (panel.hoverSourceFsPaths.has(outcome.fsPath)) {
              panel.hoverSourceFsPaths.delete(outcome.fsPath)
            }
            panel.hoverSourceFsPaths.add(outcome.fsPath)
            this.trimHoverSources(panel, outcome.fsPath)
            panel.hoverSourceFsPath = outcome.fsPath
          } else if (occurrenceId !== undefined && !panel.hoverParentGrants.has(occurrenceId) &&
            !panel.expansionBudget.hasActiveRead(occurrenceId) &&
            ![...panel.hoverLeaseGrants.values()].some((grant) => grant.occurrenceId === occurrenceId)) {
            panel.expansionBudget.release(occurrenceId)
          }
          panel.port.send(
            outcome.ok
              ? {
                  kind: 'hover.result',
                  reqId: message.reqId,
                  instanceId: message.instanceId,
                  ok: true,
                  // #333（P3-01）类型化出站：生产读取经 readRefContentTarget
                  // 类型分派，成功显式携带 contentKind（缺省 = markdown 的
                  // 兼容识别留给旧消息——校验器各形态都放行）。#336（P3-04）
                  // image 通道：图源载荷（来源相对 src；字节与版本戳走既有
                  // 图片通道），Markdown 全文/区间/选择器退化形态；#337
                  // （P3-05）pdf 通道：pdf 资源字段 + 空 text + pdf 选择器
                  // scope + 零区间 range（PDF 无 LF 坐标）；#340（P3-08）text
                  // 通道：窗口正文入 text、定位区间入 range；Markdown 语义
                  // 选择器不适用于代码文件（观感探针沿用 full），窗口/落点/
                  // 语言/字体在 textNav
                  contentKind: outcome.content.kind,
                  target: { fsPath: outcome.fsPath, relPath: outcome.relPath },
                  version: outcome.content.version,
                  ...(outcome.content.kind === 'image' ? { imageSrc: outcome.content.src } : {}),
                  ...(outcome.content.kind === 'pdf' ? { pdf: { uri: outcome.content.uri, bytes: outcome.content.bytes } } : {}),
                  text: (outcome.content.kind === 'markdown' || outcome.content.kind === 'text') ? outcome.content.lfText : '',
                  range: (outcome.content.kind === 'markdown' || outcome.content.kind === 'text')
                    ? outcome.content.range
                    : { start: 0, end: 0 },
                  scope: outcome.content.kind === 'image' ? { kind: 'plain' }
                    : outcome.content.kind === 'text' ? { kind: 'full' as const }
                      : outcome.content.selector,
                  ...(outcome.content.kind === 'text'
                    ? {
                        textNav: {
                          languageId: outcome.content.languageId,
                          hasWindow: outcome.content.hasWindow,
                          beginLine: outcome.content.beginLine,
                          endLine: outcome.content.endLine,
                          locateLine: outcome.content.locateLine,
                          jumpLine: outcome.content.jumpLine,
                          totalLines: outcome.content.totalLines,
                          ...(outcome.content.font.family !== undefined ? { fontFamily: outcome.content.font.family } : {}),
                          ...(outcome.content.font.size !== undefined ? { fontSize: outcome.content.font.size } : {}),
                          ...(outcome.content.font.ligatures !== undefined ? { fontLigatures: outcome.content.font.ligatures } : {}),
                          lineNumbers: outcome.content.lineNumbers,
                        },
                      }
                    : {}),
                  expansionPath: [...pathToParent, canonicalRefTargetKey(outcome.fsPath,
                    this.options.isWindowsHost ?? false)],
                  depth,
                  ...(sourceLeaseId !== undefined ? { sourceLeaseId } : {}),
                }
              : {
                  kind: 'hover.result',
                  reqId: message.reqId,
                  instanceId: message.instanceId,
                  ok: false,
                  reason: outcome.reason,
                  ...(outcome.anchor !== undefined ? { anchor: outcome.anchor } : {}),
                  ...(outcome.anchorDetail !== undefined ? { anchorDetail: outcome.anchorDetail } : {}),
                },
          )
        }
        const port = panel.port.readHoverTarget
        if (!port) {
          report({ ok: false, reason: 'read-failed' })
          return Promise.resolve()
        }
        // #342（P3-10）外链请求绕过会话读取缓存/在途合并：web 元信息的
        // 缓存（规范 URL + 形态键）与同 URL 合并在抓取服务（WebLinkMeta
        // Service）内管理——会话级 shapeKey 按目标文本形态区分，URL 微差
        // 产生不同键，合并口径以服务层归一为准。此处仅按 href scheme 预
        // 判路由（安全边界仍由 resolveHoverTargetForm 的开关/准入复核）
        if (message.linkHref !== undefined && isHttpLinkHref(message.linkHref)) {
          port({ ...message, ...(verifiedSource ? { verifiedSource } : {}) }, report)
          return Promise.resolve()
        }
        const shapeKey = hoverShapeKeyOf(message, verifiedSource)
        const cached = this.hoverReadCache.get(shapeKey)
        if (cached) {
          this.hoverCacheHits++
          report(cached)
          return Promise.resolve()
        }
        this.hoverCacheMisses++
        let pending = this.hoverReadInFlight.get(shapeKey)
        if (!pending) {
          // 发起世代快照：完成时校验（失效窗口内完成不回写缓存——回包
          // 照发请求面板，webview 侧按 reqId/版本仲裁丢弃旧内容）。发起
          // 时钟同步记录：目标 fsPath 在发起时未知（解析在读取端口内），
          // 失效时钟补齐「登记尚未发生」的竞态窗口
          const epoch = this.hoverEpochs.get(shapeKey) ?? 0
          const requestClock = this.hoverClock
          pending = new Promise<RefReadOutcome>((resolve) => {
            port({ ...message, ...(verifiedSource ? { verifiedSource } : {}) }, resolve)
          })
          this.hoverReadInFlight.set(shapeKey, pending)
          void pending.then((outcome) => {
            if (this.hoverReadInFlight.get(shapeKey) === pending) {
              this.hoverReadInFlight.delete(shapeKey)
            }
            if ((this.hoverEpochs.get(shapeKey) ?? 0) !== epoch) {
              return // 世代已过：迟到结果不复活旧缓存
            }
            // #342：web 载荷不经会话缓存（外链请求已绕过本路径——防御
            // 性跳过 web 载荷的缓存写回；#336：image 载荷入缓存——图片
            // 按身份载荷小常数计量；#337：pdf 载荷入缓存——按源文件字节
            // 计量；#340：text 载荷入缓存——按窗口 LF 正文 UTF-16 计量，
            // 与 markdown 同款（B-1 补登：#340 登记读取通道时缓存写回
            // 判别漏 text，致 text 目标重复悬停不合并/不缓存，失效通道
            // 也无从钉住））；content 解构后判别（TS 不支持嵌套路径判别，
            // 同 report 处）
            if (outcome.ok) {
              const { fsPath, relPath, content } = outcome
              if (content.kind === 'markdown' || content.kind === 'image' || content.kind === 'pdf' || content.kind === 'text') {
                // 在途竞态补校验：读取期间该目标被失效过（当时形态→fsPath
                // 登记未发生、反查为空）——不写缓存
                const invalidatedAt = this.hoverInvalidatedAt.get(fsPath) ?? 0
                if (invalidatedAt <= requestClock) {
                  this.commitHoverRead(shapeKey, { ok: true, fsPath, relPath, content })
                }
              }
            }
          })
        }
        void pending.then(report)
        return Promise.resolve()
      }
      case 'perf.report':
        panel.lastPerfReport = message
        return Promise.resolve()
      case 'reading.perf.report':
        panel.lastReadingPerfReport = message
        return Promise.resolve()
      case '_test.skeleton.report':
        // #292 骨架状态回报：仅测试装配（hold 全局）会出站，原样存最近一份
        panel.lastSkeletonReport = message
        return Promise.resolve()
    }
  }

  /**
   * 宿主文档变更事件入口（provider 接到 onDidChangeTextDocument 后调用）。
   * 自家 applyEdit 的回流在此被识别为确认并发 ack；其余视为外部变更广播。
   */
  handleDocChanged(changes: SerChange[], version: number, reason?: DocumentChangeReason): void {
    // VSCode 的 dirty 状态变化也触发 onDidChangeTextDocument：没有内容变更，
    // 版本不推进。它不属于文本同步，不能进入版本日志或广播为外部修改；
    // 否则 IME 会缓冲这个空事件，确认时把待发候选误判为外部冲突。
    if (this.disposed || changes.length === 0) {
      return
    }
    // 一切 LF 转换都基于变更前的行尾位置表（changes/pending 坐标均指变更前
    // 文档），全部发送完成后再以变更后的全文重建位置表
    const lfChanges = this.newline.hostChangesToLf(changes)
    this.versionLog.push({ version, changes, lfChanges })
    if (this.versionLog.length > VERSION_LOG_LIMIT) {
      this.versionLog.splice(0, this.versionLog.length - VERSION_LOG_LIMIT)
    }
    // 兜底确认的迟到回流（C-4）：日志仍需完整（重定位依赖变更史），
    // 但不作为外部变更重复广播
    if (this.confirmedEchoes.some((e) => e.version === version && changesEqual(e.changes, changes))) {
      this.newline.rebuild(this.doc.getText())
      return
    }
    try {
      for (const panel of this.panels.values()) {
        const head = panel.pending[0]
        if (!reason && head && !head.confirmed && changesEqual(head.changes, changes)) {
          this.pasteHistory.observe(lfChanges, this.newline.toLfText(this.doc.getText()), undefined, head.paste)
          this.confirmPending(panel, head, version)
          return
        }
      }
      // 外部变更广播（#48）：存在「已应用未确认」pending 的窗口期先暂存，
      // 由确认路径（回流匹配 / applyEdit resolve 兜底）补发
      const paste = this.pasteHistory.observe(lfChanges, this.newline.toLfText(this.doc.getText()), reason)
      this.queueExternalBroadcast(version, lfChanges, { ...(reason ? { reason } : {}), ...(paste ? { paste } : {}) })
    } finally {
      this.newline.rebuild(this.doc.getText())
    }
  }

  /** 最近一次 view.state 诊断（测试钩子与性能观测用） */
  getViewState(sessionId: string): Extract<WebviewToHost, { kind: 'view.state' }> | undefined {
    return this.panels.get(sessionId)?.lastViewState
  }

  /** 最近一次性能探针回报（#5 测试钩子与测量脚本用） */
  getLastPerfReport(
    sessionId: string,
  ): Extract<WebviewToHost, { kind: 'perf.report' }> | undefined {
    return this.panels.get(sessionId)?.lastPerfReport
  }

  /** 最近一次阅读视图探针回报（#7 测试钩子与测量脚本用） */
  getLastReadingPerfReport(
    sessionId: string,
  ): Extract<WebviewToHost, { kind: 'reading.perf.report' }> | undefined {
    return this.panels.get(sessionId)?.lastReadingPerfReport
  }

  /** 最近一次骨架屏状态回报（#292 测试钩子用） */
  getLastSkeletonReport(
    sessionId: string,
  ): Extract<WebviewToHost, { kind: '_test.skeleton.report' }> | undefined {
    return this.panels.get(sessionId)?.lastSkeletonReport
  }

  /** 当前资源代次（#208：provider 层图片 URI ?v= 戳的数据源；0 = 未刷新） */
  getImageGeneration(): number {
    return this.imageGeneration
  }

  /**
   * #208 图片缓存运行期失效入口：清空解析缓存与在途去重表并推进资源代次
   * （返回新代次）。手动刷新通道（refresh.request）在此闭合；后续自动核验
   * 路径（#201）可复用同一入口对齐失效语义。
   *
   * 在途竞态（作废语义）：刷新瞬间的在途解析（imageInFlight）完成后仍会
   * 走原回调——清表拦不住已注册的 then。两道防护缺一不可：其一，清空
   * imageInFlight 让刷新后的重挂请求不与旧代次在途复用（否则经同 src 去重
   * 直接拿到旧 URI）；其二，回调写缓存前校验发起代次（见
   * resolveImageRequest），旧代次结果丢弃——只清表不校验，迟到的旧回调
   * 照样把旧 URI 写回缓存，污染本轮刷新。
   */
  invalidateImages(): number {
    this.imageCache.clear()
    this.imageInFlight.clear()
    this.imageGeneration += 1
    return this.imageGeneration
  }

  /** #10 图片解析请求处理（去重/缓存/回发）；#201 起成功结果登记归一目标
   *  键并按世代防迟到回写；#208 起回调另校验会话代次防手动全量刷新的
   *  迟到回写 */
  private async resolveImageRequest(
    panel: PanelEntry,
    reqId: number,
    src: string,
  ): Promise<void> {
    const send = (resolution: ImageResolution): void => {
      if (resolution.ok) {
        panel.port.send({ kind: 'image.result', reqId, ok: true, src: resolution.src })
      } else {
        panel.port.send({
          kind: 'image.result',
          reqId,
          ok: false,
          reason: resolution.reason,
          detail: resolution.detail,
        })
      }
    }
    const cached = this.imageCache.get(src)
    if (cached) {
      send(cached)
      return
    }
    let pending = this.imageInFlight.get(src)
    if (!pending) {
      // 发起代次快照：回调完成时校验代次未变才写缓存（#208 在途竞态）。
      // 刷新瞬间在途的解析携旧代次 URI，若照写缓存，重挂请求经同 src
      // 命中旧地址、该图本轮不换新；代次已过则丢弃。发起面板仍收到其
      // 请求当次的结果（旧 URI）——webview 条目已被失效重挂重建，未知
      // reqId 的迟到结果在观测层丢弃，不产生污染
      const requestGen = this.imageGeneration
      const resolver = panel.port.resolveImage
      pending = resolver
        ? resolver(src).catch((): ImageResolution => ({ ok: false, reason: 'read-error' }))
        // 防御分支（resolver 未注入仅见于异常装配）：reason 码即全部反馈，
        // detail 无 webview 消费方，不带文案（#95 i18n 清理）
        : Promise.resolve({ ok: false, reason: 'read-error' } as ImageResolution)
      this.imageInFlight.set(src, pending)
      // 完成后清理在途表；成功结果进入小容量缓存（滚动回视口的重复请求
      // 直接命中，避免反复读盘；失败不缓存，保留重试语义）。清理用同一
      // 性判据：invalidateImages 作废在途表后，同 src 可能已有新代次的
      // 在途条目，旧回调不得误删他人的表项
      const epoch = this.imageEpochs.get(src) ?? 0
      const requestClock = this.imageClock
      void pending.then((resolution) => {
        if (this.imageInFlight.get(src) === pending) {
          this.imageInFlight.delete(src)
        }
        // 双守卫（#201 世代 + #208 代次）：解析在途期间该 src 被部分失效
        // 或会话被手动全量刷新（缓存均已删）——迟到结果仍回发请求面板
        // （webview 侧按 reqId 代次守卫丢弃），但不得回写缓存复活旧解析
        if (
          (this.imageEpochs.get(src) ?? 0) !== epoch ||
          requestGen !== this.imageGeneration
        ) {
          return
        }
        if (!resolution.fsPath) {
          this.commitImageResult(src, resolution, null)
          return
        }
        const key = imageFsKey(resolution.fsPath, this.options.isWindowsHost ?? false)
        // 在途竞态补失效：目标在请求发起后被失效过（当时登记未发生、
        // 反查为空）——结果不缓存并补发失效广播（webview 立即重取新版本）
        const invalidatedAt = this.imageInvalidatedAt.get(key) ?? 0
        this.commitImageResult(src, resolution, invalidatedAt > requestClock ? key : null)
      })
    }
    send(await pending)
  }

  /**
   * #220 来源化图片解析（悬停浮层/嵌入卡片内 B 文档图片）：守卫
   * （sourceDocUri 须为本面板已送达 hover.result 成功回包的目标）通过后
   * 直连解析端口——不进会话缓存/在途去重表（键均为裸 src，跨来源会串
   * 台；重复请求的代价是重复 stat，跨开缓存不属本通道）。#224 起成功
   * 结果登记失效反查（B 图片文件变化 → invalidateImagesByFsPath 命中 →
   * image.invalidate 广播 → B 管理器失效重挂；键为裸 src，跨来源同 src
   * 指向不同文件时后登记覆盖前者——失效广播是「无条件失效重取」语义，
   * 多杀自愈，见 imageSrcTarget 注释）。解析异常收敛 read-error 回发。
   */
  private async resolveSourcedImageRequest(
    panel: PanelEntry,
    reqId: number,
    src: string,
    sourceDocUri: string,
  ): Promise<void> {
    if (!panel.hoverSourceFsPaths.has(sourceDocUri)) {
      return // 来源守卫：非本面板读取过的悬停/嵌入目标，静默丢弃（不信任前端任意 URI）
    }
    const resolver = panel.port.resolveImage
    const resolution = resolver
      ? await resolver(src, sourceDocUri).catch((): ImageResolution => ({ ok: false, reason: 'read-error' }))
      : { ok: false, reason: 'read-error' } as ImageResolution
    if (resolution.fsPath) {
      this.registerImageSrcTarget(src, resolution.fsPath)
    }
    if (resolution.ok) {
      panel.port.send({ kind: 'image.result', reqId, ok: true, src: resolution.src })
    } else {
      panel.port.send({
        kind: 'image.result',
        reqId,
        ok: false,
        reason: resolution.reason,
        detail: resolution.detail,
      })
    }
  }

  /** 图源 → 归一目标键登记（#201 反查；#224 起来源化路径同样登记并有界：
   *  条目数上限按插入序淘汰，被淘汰 src 失去失效反查——重挂/重开重新
   *  登记自愈） */
  private registerImageSrcTarget(src: string, fsPath: string): void {
    const key = imageFsKey(fsPath, this.options.isWindowsHost ?? false)
    if (this.imageSrcTarget.get(src) === key) {
      this.imageSrcTarget.delete(src) // 重复登记同目标：移到 MRU（插入序语义）
    }
    this.imageSrcTarget.set(src, key)
    while (this.imageSrcTarget.size > IMAGE_SRC_TARGET_LIMIT) {
      const oldest = this.imageSrcTarget.keys().next().value
      if (oldest === undefined) {
        break
      }
      this.imageSrcTarget.delete(oldest)
    }
  }

  /** 结果落库（#201）：登记反查映射；被失效覆盖（overshadowKey 非空）时
   *  不写缓存并对该 src 补失效广播，成功结果照常仅作登记 */
  private commitImageResult(
    src: string,
    resolution: ImageResolution,
    overshadowKey: string | null,
  ): void {
    if (resolution.fsPath) {
      this.registerImageSrcTarget(src, resolution.fsPath)
    }
    if (resolution.ok && !overshadowKey) {
      this.imageCache.set(src, resolution)
      while (this.imageCache.size > 16) {
        const oldest = this.imageCache.keys().next().value
        if (oldest === undefined) {
          break
        }
        this.imageCache.delete(oldest)
      }
      return
    }
    if (overshadowKey) {
      this.invalidateImageSrcs([src])
    }
  }

  /**
   * #201 图片失效入口（provider 协调器调用：watcher 事件 / onTargetChange /
   * 周期核验 refresh 决策）：按归一目标键反查本会话登记的 src 集合，删除
   * 宿主解析缓存并推进世代（在途请求完成后不回写），向**全部面板**广播
   * image.invalidate（多面板一致；webview 侧作废条目重发请求拿新版本 URL）。
   * 无登记（该文件未被本文档引用）时静默返回（时钟仍推进——在途请求
   *  完成时按目标键检出覆盖）。
   */
  invalidateImagesByFsPath(fsPath: string): void {
    if (this.disposed) {
      return
    }
    const key = imageFsKey(fsPath, this.options.isWindowsHost ?? false)
    this.imageClock++
    this.imageInvalidatedAt.set(key, this.imageClock)
    const srcs: string[] = []
    for (const [src, target] of this.imageSrcTarget) {
      if (target === key) {
        srcs.push(src)
      }
    }
    if (srcs.length === 0) {
      return
    }
    this.invalidateImageSrcs(srcs)
  }

  /** 按(src) 执行失效：删缓存、推进世代、广播全部面板 */
  private invalidateImageSrcs(srcs: string[]): void {
    for (const src of srcs) {
      this.imageCache.delete(src)
      this.imageEpochs.set(src, (this.imageEpochs.get(src) ?? 0) + 1)
    }
    const message: HostToWebview = { kind: 'image.invalidate', srcs }
    for (const panel of this.panels.values()) {
      panel.port.send(message)
    }
  }

  // ---- #224 悬停读取缓存 ----

  /**
   * 按目标 fsPath 失效悬停读取（provider 事件路径调用——修 1 起经
   * connectHoverEvents 无条件广播，不依赖订阅在场）：反查该目标的全部
   * 请求形态，清缓存与在途表并推进世代——在途读取完成后不回写缓存
   * （迟到旧文不复活），请求面板照收回包（webview 侧 reqId/版本仲裁
   * 丢弃）。无登记（该目标未被读取过且无在途读取）时零副作用。
   *
   * 修 3（review 第二轮）：失效钟条目只在「有在途读取」时写入——其唯一
   * 消费方是读取完成回调的竞态补校验（发起时形态→fsPath 登记尚未发生、
   * 反查为空的窗口）；无在途时本目标条目无未来读者，顺带清理（否则随
   * 事件广播只写不删、无界积累）。世代条目同样只读后清（evictHoverRead
   * 同步删除），按清理前的值推进保证形态键内单调不回退——在途快照不因
   * 清理误配对。
   */
  invalidateHoverReads(fsPath: string): void {
    const hasInFlight = this.hoverReadInFlight.size > 0
    if (hasInFlight) {
      this.hoverClock++
      this.hoverInvalidatedAt.set(fsPath, this.hoverClock)
    } else {
      this.hoverInvalidatedAt.delete(fsPath)
    }
    const keys = this.hoverShapeTargets.get(fsPath)
    if (!keys) {
      return
    }
    for (const shapeKey of [...keys]) {
      const nextEpoch = (this.hoverEpochs.get(shapeKey) ?? 0) + 1
      this.evictHoverRead(shapeKey)
      this.hoverReadInFlight.delete(shapeKey)
      this.hoverEpochs.set(shapeKey, nextEpoch)
    }
  }

  /**
   * #344（P3-12 收口）：该目标是否有驻留的悬停读取缓存条目（读取后未
   * 失效/未淘汰）。provider 的 TextDocument 事件转发门控查询面——B-1
   * 的窄代价（未 watch 的 text 目标编辑事件不转发）会把「悬停→关闭→
   * 编辑→再悬停」落进陈旧缓存；缓存目标与已 watch 目标同权转发后，
   * 编辑事件照常广播失效，重开悬停必然重读。md 目标事件域本就恒放行，
   * 不经此查询。
   */
  hasCachedHoverTarget(fsPath: string): boolean {
    const keys = this.hoverShapeTargets.get(fsPath)
    if (keys !== undefined) {
      return keys.size > 0
    }
    if (!this.options.isWindowsHost) {
      return false
    }
    // 查询键漂移兜底（review-loops 三期修复）：登记键来自 outcome.fsPath
    //（生产为 statFileRealPath 归正的磁盘真值，大小写任意），调用方
    //（TextDocument 事件转发门控）传 event.document.uri.fsPath——Windows
    // 上两者可能仅大小写/斜杠方向不同，精确匹配漏报会让未 watch 的 text
    // 目标编辑事件不转发（与 isWatched 的 keyOf 口径不对称）。与
    // coordinator keyOf 共用 hoverWatchKeyOf 同口径归一后线性扫描（表量级
    // = 悬停缓存目标数，小表；幂等——精确命中已由上方 get 覆盖，本分支
    // 只兜漂移查询，不改变既有精确路径）
    const needle = hoverWatchKeyOf(fsPath, true)
    for (const key of this.hoverShapeTargets.keys()) {
      if (hoverWatchKeyOf(key, true) === needle) {
        return true
      }
    }
    return false
  }

  /** 悬停读取缓存观测（测试钩子与性能计量：条目/字节/命中/未命中与
   *  辅助索引条目数——修 3 清理行为的行为断言面） */
  hoverReadCacheStats(): {
    entries: number
    bytes: number
    hits: number
    misses: number
    entryLimit: number
    byteLimit: number
    /** 失效钟条目数（仅在途窗口内有登记；quiescent 失效后为 0） */
    invalidatedAtEntries: number
    /** 世代表条目数（随缓存条目淘汰同步清理；失效推进后保留至再淘汰） */
    epochEntries: number
  } {
    return {
      entries: this.hoverReadCache.size,
      bytes: this.hoverCacheBytes,
      hits: this.hoverCacheHits,
      misses: this.hoverCacheMisses,
      entryLimit: this.hoverCacheLimits.entryLimit,
      byteLimit: this.hoverCacheLimits.byteLimit,
      invalidatedAtEntries: this.hoverInvalidatedAt.size,
      epochEntries: this.hoverEpochs.size,
    }
  }

  /** 成功结果入缓存（字节按内容类型近似计量：markdown/#340 text 为 LF
   *  正文 UTF-16 code unit ×2（text 为窗口正文），#337 起 pdf 为源文件
   *  字节；#336 图片载荷无正文，按身份载荷小常数计量（与读取预算同口
   *  径）；条目/字节双上限按插入序淘汰——单条超字节上限不入缓存。#342：
   *  web 载荷不进本缓存（调用侧过滤，元信息缓存归 WebLinkMetaService） */
  private commitHoverRead(shapeKey: string, outcome: Extract<RefReadOutcome, { ok: true }>): void {
    const bytes = outcome.content.kind === 'markdown' || outcome.content.kind === 'text'
      ? outcome.content.lfText.length * 2
      : outcome.content.kind === 'pdf'
        ? outcome.content.bytes
        : 256
    if (bytes > this.hoverCacheLimits.byteLimit) {
      return
    }
    if (this.hoverReadCache.has(shapeKey)) {
      this.evictHoverRead(shapeKey) // 覆盖写：先计回旧条目字节
    }
    this.hoverReadCache.set(shapeKey, outcome)
    let keys = this.hoverShapeTargets.get(outcome.fsPath)
    if (!keys) {
      keys = new Set()
      this.hoverShapeTargets.set(outcome.fsPath, keys)
    }
    keys.add(shapeKey)
    this.hoverCacheBytes += bytes
    while (
      (this.hoverReadCache.size > this.hoverCacheLimits.entryLimit ||
        this.hoverCacheBytes > this.hoverCacheLimits.byteLimit) &&
      this.hoverReadCache.size > 0
    ) {
      const oldest = this.hoverReadCache.keys().next().value
      if (oldest === undefined) {
        break
      }
      this.evictHoverRead(oldest)
    }
  }

  /** 淘汰单条缓存条目（字节与反查登记一并回收；修 3：世代表条目随缓存
   *  条目淘汰同步清理——失效路径的世代推进按清理前的值计算，键内单调
   *  不回退） */
  private evictHoverRead(shapeKey: string): void {
    const hit = this.hoverReadCache.get(shapeKey)
    if (!hit) {
      return
    }
    this.hoverReadCache.delete(shapeKey)
    this.hoverCacheBytes -= hit.content.kind === 'markdown' || hit.content.kind === 'text'
      ? hit.content.lfText.length * 2
      : hit.content.kind === 'pdf'
        ? hit.content.bytes
        : 256
    const keys = this.hoverShapeTargets.get(hit.fsPath)
    if (keys) {
      keys.delete(shapeKey)
      if (keys.size === 0) {
        this.hoverShapeTargets.delete(hit.fsPath)
      }
    }
    this.hoverEpochs.delete(shapeKey)
  }

  /** #201 周期核验串行入链（并发有界：同会话至多一轮 verify 在途） */
  private enqueueImageVerify(items: ImageVerifyItem[]): Promise<void> {
    const verifier = this.options.verifyImages
    if (!verifier) {
      return Promise.resolve()
    }
    const run = this.verifyChain.then(() => verifier(items))
    // 链尾自愈：verifier 异常不断链（下一轮照常入链）
    this.verifyChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /** 会话观测信息（测试钩子与调试用） */
  getInfo(): { panels: Array<{ sessionId: string; ready: boolean }> } {
    return {
      panels: [...this.panels.values()].map((p) => ({
        sessionId: p.sessionId,
        ready: p.ready,
      })),
    }
  }

  /** 向指定面板发送宿主消息（诊断请求等）；经此通道的 view.locate 记录
   *  为「待送达定位意图」（webview LF 坐标原样）——送达确认（ack）到达前
   *  面板重握手时补发兜底 */
  postToPanel(sessionId: string, message: HostToWebview): void {
    this.panels.get(sessionId)?.port.send(message)
    if (message.kind === 'view.locate') {
      // head（#318）随定位意图一并留存——补发不降级为单点
      this.lastLocate = { offset: message.offset, head: message.head }
    }
  }

  /** 待送达定位意图（null=无未送达意图）。面板重载（retainContextWhenHidden
   *  关闭，隐藏即销毁）可能让 view.locate 随旧 webview 实例丢失——重握手
   *  sendInit 后补发兜住这个竞态窗口。**已送达**的定位经 view.locate.ack
   *  对账清除（#163 验收反馈）：此后不再补发，重载恢复交给 webview 持久化
   *  锚点（定位点随 locateOffset 落盘）——用户送达后的手动移位不被历史
   *  程序定位重播 */
  private lastLocate: { offset: number; head?: number } | null = null

  private sendInit(panel: PanelEntry): void {
    panel.ready = true
    panel.port.send({
      kind: 'init',
      sessionId: panel.sessionId,
      docUri: this.docUri,
      version: this.doc.version,
      text: this.newline.toLfText(this.doc.getText()),
    })
    if (this.lastLocate !== null) {
      // 仅补发「从未送达」的定位（送达即被 ack 清除）——竞态兜底窗口之外的
      // 重载恢复一律走 webview 持久化锚点
      panel.port.send({
        kind: 'view.locate',
        offset: this.lastLocate.offset,
        ...(this.lastLocate.head !== undefined ? { head: this.lastLocate.head } : {}),
      })
    }
  }

  private async processEditRequest(
    panel: PanelEntry,
    message: Extract<WebviewToHost, { kind: 'edit.request' }>,
  ): Promise<void> {
    const cached = panel.ackCache.get(message.seq)
    if (cached) {
      panel.port.send(cached)
      return
    }
    if (panel.suspended) {
      // 暂停写回：请求不写入权威文档，输入片段留存到快照（不丢字）。
      // collectFragments 以宿主系为入参口径（B-6 统一 LF 入库）
      this.collectFragments(panel.conflictFragments, this.newline.lfChangesToHost(message.changes))
      this.sendAck(panel, {
        kind: 'edit.ack',
        seq: message.seq,
        ok: false,
        reason: 'conflict',
        version: this.doc.version,
        text: this.newline.toLfText(this.doc.getText()),
      })
      return
    }
    // T03（#352）纯选区事务：携带 origin 且无净文本变更（选区设置类）的
    // 请求不写回、不造宿主历史项、不留来源记录——直接以当前版本确认。
    // 无 origin 的空请求保持既有行为（webview 出站前已过滤空变更，此处
    // 防御性维持原路径，契约等价）
    // T06（#355）origin 归一化为列表（单值/数组同构处理）
    const parsedOrigin = parseEditOriginField(message.origin)
    const origins: EditOriginList | undefined =
      parsedOrigin.status === 'ok' ? parsedOrigin.origins : undefined
    if (origins !== undefined && !hasNetTextChange(message.changes)) {
      this.sendAck(panel, { kind: 'edit.ack', seq: message.seq, ok: true, version: this.doc.version })
      return
    }
    // T06（#355）来源业务闸门（队列内、写回前）：joinPrevious 无可确认前项
    // 等业务拒绝在此拦截——不写回、不留来源记录、面板不进冲突暂停（业务
    // 声明错误 ≠ 同步冲突；ack 附带权威全文供 webview 回滚本地效果）
    // 合并笔结构防御复核（数组多元素形态）：共享层约束「全部同组件、首项
    //  atomic、其余 joinPrevious」由 webview 出站层构造保证，此处兜底防
    // 伪造——非法整条拒绝（不写回、不留来源；通道复用 origin 业务拒绝
    //  的 conflict ack + history-boundary，webview 侧映射为可辨认拒绝）
    if (origins !== undefined && origins.length >= 2 && !isValidMergedOriginList(origins)) {
      this.sendAck(panel, {
        kind: 'edit.ack',
        seq: message.seq,
        ok: false,
        reason: 'conflict',
        version: this.doc.version,
        text: this.newline.toLfText(this.doc.getText()),
        originRejection: 'history-boundary',
      })
      return
    }
    if (origins !== undefined && this.options.onOriginGate) {
      const gate = this.options.onOriginGate
      if (origins.some((origin) => !gate(origin))) {
        this.sendAck(panel, {
          kind: 'edit.ack',
          seq: message.seq,
          ok: false,
          reason: 'conflict',
          version: this.doc.version,
          text: this.newline.toLfText(this.doc.getText()),
          originRejection: 'history-boundary',
        })
        return
      }
    }
    let mapped: SerChange[] | null
    if (message.baseVersion === this.doc.version) {
      // webview 消息为 LF 坐标，先转换为宿主坐标再校验/应用
      mapped = this.newline.lfChangesToHost(message.changes)
    } else if (message.baseVersion < this.doc.version) {
      // 重定位全程在 LF 空间进行（C-1）：versionLog 的 LF 形态变更组与
      // webview 的 LF 坐标同一参考系（行尾变化在 LF 空间是 no-op，不会被
      // 当作平移）；完成后再以当前行尾表一次性转宿主坐标
      const relocatedLf = this.relocateLfChanges(message.baseVersion, message.changes)
      mapped = relocatedLf === null ? null : this.newline.lfChangesToHost(relocatedLf)
    } else {
      // webview 版本超前（迟到异常），按不可安全应用处理
      mapped = null
    }
    if (!mapped) {
      // 不可安全应用：保留输入、暂停写回、提示——不再以全文覆盖 webview
      this.suspendPanel(panel)
      this.collectFragments(panel.conflictFragments, this.newline.lfChangesToHost(message.changes))
      this.sendAck(panel, {
        kind: 'edit.ack',
        seq: message.seq,
        ok: false,
        reason: 'conflict',
        version: this.doc.version,
        text: this.newline.toLfText(this.doc.getText()),
      })
      this.notifyConflict(panel)
      // #48 收口：与写回失败分支保持同一收口语义。请求串行化（全局队列）
      // 下本分支运行时不可能是任何 apply 窗口，暂存队列为空，此调用为
      // 防御性补发
      this.flushPendingExternal()
      return
    }
    const pending: PendingEdit = { seq: message.seq, changes: mapped, confirmed: false,
      ...(message.paste ? { paste: { ...message.paste, sessionId: panel.sessionId } } : {}),
      ...(origins !== undefined ? { origin: origins } : {}) }
    panel.pending.push(pending)
    // #52：快照 apply 前版本——兜底确认时据此推导 E 实际落地的权威版本
    //（apply 窗口内到达的外部增量会把 doc.version 推进到高于 E 的值）
    const versionBeforeApply = this.doc.version
    const ok = await this.doc.applyChanges(
      mapped,
      origins !== undefined
        ? (origins.length === 1 ? origins[0] : origins)
        : undefined,
    )
    const entry = panel.pending.find((p) => p === pending)
    if (!entry) {
      // 已被其他路径处理（resumePanel 清空 pending 等）。apply 失败时该编辑
      // 不进权威文档、不会有回流事件来触发补发，暂存的外部增量只能在此
      // 收口；成功时本笔回流将以外部变更身份按 version 有序入队，自然
      // 带动补发（见 queueExternalBroadcast 的有序插入）
      if (!ok) {
        this.flushPendingExternal()
      }
      return
    }
    if (!ok) {
      // 写回通道失败：编辑未进入权威文档，同样保留输入并暂停（不虚报成功）
      panel.pending.splice(panel.pending.indexOf(entry), 1)
      this.suspendPanel(panel, 'host-error')
      this.collectFragments(panel.conflictFragments, mapped)
      this.sendAck(panel, {
        kind: 'edit.ack',
        seq: message.seq,
        ok: false,
        reason: 'error',
        version: this.doc.version,
        text: this.newline.toLfText(this.doc.getText()),
      })
      this.notifyConflict(panel)
      // #48 收口：失败 ack 已发（本面板将进入暂停、忽略后续外部增量），
      // 暂存的外部增量立即可见给其余面板——不会有回流事件来触发补发，
      // 不在此收口将滞留至下一次外部变更或任意 confirmPending
      this.flushPendingExternal()
      return
    }
    if (!entry.confirmed) {
      // applyEdit 已 resolve 但回流事件尚未到达（或被合并），以 E 实际落地的
      // 权威版本兜底确认；记录 (version, changes) 供迟到回流匹配，防止重复
      // 广播（C-4）。版本不得取 resolve 时点的 doc.version（#52）：窗口内
      // 到达的外部增量已把它推进，E 的广播会与随后补发的暂存增量同版本，
      // 被旁观面板的版本单调防线永久丢弃
      const version = this.fallbackConfirmVersion(versionBeforeApply)
      // 无回流时只按确切增量更新解释表；版本/全文不能对齐时表会保守失效。
      this.pasteHistory.observe(this.newline.hostChangesToLf(mapped), this.newline.toLfText(this.doc.getText()), undefined, entry.paste)
      this.confirmPending(panel, entry, version)
      this.confirmedEchoes.push({ version, changes: mapped })
      while (this.confirmedEchoes.length > ACK_CACHE_LIMIT) {
        this.confirmedEchoes.shift()
      }
    }
  }

  /** 兜底确认的版本推导（#52）：E 的回流未到达时，(apply 前版本, 当前版本]
   *  内的其余版本号都已作为外部回流进过 versionLog（每次文档变更恰产生
   *  一个携带其版本的回流事件，全局队列串行化保证同一时刻至多一笔「已
   *  应用未确认」pending），E 实际应用的版本是区间内唯一缺失的版本号。
   *  取该值广播/确认，保证随后按 version 有序补发的暂存增量不被 webview
   *  的 C-4 单调防线丢弃。推导不出（版本号无一缺失，如回流被合并成单
   * 事件）时退回当前版本，维持既有兜底语义。
   *
   *  排序假设（换宿主适配层需重新验证）：apply 窗口内落地的外部变更，其
   *  回流事件先于 applyEdit 的 resolve 送达本会话——扩展宿主的同通道 RPC
   *  按序投递、onDidChangeTextDocument 事件同步派发共同保证这一先后。
   *  该假设成立，「resolve 时点的 versionLog」才完整覆盖窗口内除 E 外的
   *  全部外部版本，缺失值才是 E 的实际版本；反之（回流晚于 resolve）会把
   *  外部变更的版本误判给 E。 */
  private fallbackConfirmVersion(versionBeforeApply: number): number {
    const logged = new Set(this.versionLog.map((g) => g.version))
    for (let v = versionBeforeApply + 1; v < this.doc.version; v++) {
      if (!logged.has(v)) {
        return v
      }
    }
    return this.doc.version
  }

  /** 日志覆盖检查：baseVersion..current 之间的变更组必须连续可见。
   *  versionLog 超限截断后对更早版本存在缺口，穿越不完整组会静默错位，
   *  必须拒绝并走冲突保留路径（不能拿不完整信息冒充安全重定位）。 */
  private logCovers(baseVersion: number): boolean {
    if (this.versionLog.length === 0) {
      return false // 版本落后但无日志可依据
    }
    return this.versionLog[0].version <= baseVersion + 1
  }

  /** 把 baseVersion 系的 LF 变更组穿过 versionLog 的 LF 形态变更组；
   *  日志不覆盖或区间不可安全映射时返回 null。 */
  private relocateLfChanges(baseVersion: number, lfChanges: SerChange[]): SerChange[] | null {
    if (!this.logCovers(baseVersion)) {
      return null
    }
    const groups = this.versionLog
      .filter((g) => g.version > baseVersion)
      .map((g) => g.lfChanges)
    const mapped: SerChange[] = []
    for (const change of lfChanges) {
      const result = mapChangeThroughChanges(change, groups)
      if (result === null) {
        return null
      }
      mapped.push(result)
    }
    return mapped
  }

  /** 暂停面板写回：在途未确认请求一并拒绝并留存输入（reason 记录真实
   *  暂停原因，供 webview 重载后的 session.suspended 透传） */
  private suspendPanel(panel: PanelEntry, reason: 'conflict' | 'host-error' = 'conflict'): void {
    if (panel.suspended) {
      return
    }
    panel.suspended = true
    panel.suspendedReason = reason
    for (const p of panel.pending) {
      if (!p.confirmed) {
        this.collectFragments(panel.conflictFragments, p.changes)
        this.sendAck(panel, {
          kind: 'edit.ack',
          seq: p.seq,
          ok: false,
          reason: 'conflict',
          version: this.doc.version,
          text: this.newline.toLfText(this.doc.getText()),
        })
      }
    }
    panel.pending.length = 0
    // #48 收口说明：暂存外部增量的补发不在此处统一执行——两个调用点的
    // 失败 ack 在 suspendPanel 返回后才发出，先补发会让失败面板以含失败
    // 编辑的未确认参考系应用外部增量（短暂错位）；由调用点在 ack 发出后
    // 收口（见 processEditRequest）
  }

  /** 恢复面板写回：清空快照并以权威全文重置 webview（doc.resync 兼作恢复信号） */
  resumePanel(sessionId: string): boolean {
    const panel = this.panels.get(sessionId)
    if (!panel) {
      return false
    }
    panel.suspended = false
    panel.conflictFragments = []
    panel.conflictWebviewText = undefined
    panel.conflictWebviewVersion = undefined
    panel.compositionPending = false
    panel.compositionSnapshot = undefined
    panel.conflictNotified = false
    panel.reloaded = false
    panel.pending.length = 0
    if (panel.ready) {
      panel.port.send({
        kind: 'doc.resync',
        version: this.doc.version,
        text: this.newline.toLfText(this.doc.getText()),
      })
    }
    return true
  }

  /** 面板冲突/暂停状态（测试钩子与通知按钮取回用） */
  getConflictState(
    sessionId: string,
  ): {
    suspended: boolean
    fragments: string[]
    webviewText: string | undefined
    webviewVersion: number | undefined
    /** webview 曾重载（B-2）：暂停面板的 view.state 是重载装载的权威全文，
     *  复制未确认输入时应跳过面板查询、直接用宿主快照 */
    reloaded: boolean
  } | undefined {
    const panel = this.panels.get(sessionId)
    if (!panel) {
      return undefined
    }
    return {
      suspended: panel.suspended,
      fragments: [...panel.conflictFragments],
      webviewText: panel.compositionSnapshot?.toString() ?? panel.conflictWebviewText,
      webviewVersion: panel.conflictWebviewVersion,
      reloaded: panel.reloaded,
    }
  }

  /** 留存输入片段：入参为宿主系变更组，统一转 LF 形态入库（B-6）——
   *  片段面向用户取回（剪贴板/通知），与 webview 输入的 LF 形态一致 */
  private collectFragments(into: string[], hostChanges: SerChange[]): void {
    for (const c of this.newline.hostChangesToLf(hostChanges)) {
      if (c.text.length > 0) {
        into.push(c.text)
      }
    }
  }

  private notifyConflict(panel: PanelEntry): void {
    if (panel.conflictNotified) {
      return
    }
    panel.conflictNotified = true
    this.notify({ type: 'conflict', sessionId: panel.sessionId, docUri: this.docUri })
  }

  private notify(notice: SessionNotice): void {
    this.options.onNotice?.(notice)
  }

  private confirmPending(panel: PanelEntry, pending: PendingEdit, version: number): void {
    pending.confirmed = true
    const index = panel.pending.indexOf(pending)
    if (index >= 0) {
      panel.pending.splice(index, 1)
    }
    this.sendAck(panel, { kind: 'edit.ack', seq: pending.seq, ok: true, version })
    // 其他面板需要看到这次变更（split 多实例广播），坐标转换为 LF 形态
    const lfChanges = this.newline.hostChangesToLf(pending.changes)
    // T03（#352）来源归属：确认成功的单一汇合点（回流匹配与兜底确认都在
    // 此触发）；每笔 pending 恰好一次，失败/重放路径不经过此处
    if (pending.origin !== undefined) {
      this.noteAttribution(panel, pending, version, lfChanges)
    }
    this.broadcastExternal(version, lfChanges, panel)
    // #48：确认后参考系一致（本面板 ack 已发、其他面板已见本笔广播），
    // 暂存的外部增量可按序补发
    this.flushPendingExternal()
  }

  /** T03（#352）/T06（#355）归属记账：回调通知（origin 为组首，合并笔
   *  joined 携带并入来源——逐次记录保留）+ 按版本登记组首（有界，与
   *  版本日志同窗） */
  private noteAttribution(
    panel: PanelEntry,
    pending: PendingEdit,
    version: number,
    lfChanges: SerChange[],
  ): void {
    const originHead = pending.origin![0]!
    const record: EditAttributionRecord = {
      docUri: this.docUri,
      sessionId: panel.sessionId,
      seq: pending.seq,
      version,
      changes: lfChanges,
      origin: originHead,
      ...(pending.origin!.length > 1 ? { joined: pending.origin!.slice(1) } : {}),
    }
    this.attributed.push({
      version,
      seq: pending.seq,
      sessionId: panel.sessionId,
      origin: originHead,
      ...(pending.origin!.length > 1 ? { joined: pending.origin!.slice(1) } : {}),
    })
    while (this.attributed.length > VERSION_LOG_LIMIT) {
      this.attributed.shift()
    }
    this.options.onEditAttributed?.(record)
  }

  /** T03（#352）按落定版本查询来源归属（未携带 origin 的版本返回
   *  undefined——外来条目；重放不重复计入：同版本只登记一次） */
  editOriginAtVersion(version: number): { seq: number; sessionId: string; origin: EditOriginMeta; joined?: EditOriginMeta[] } | undefined {
    return this.attributed.find((e) => e.version === version)
  }

  /** T03（#352）组历史窄适配点：排在会话队列（在途 edit.request 之后）
   *  串行执行，调用权威端口的可选组入口。steps 为计划的原生步骤数（计划
   *  在执行时点由调用方计算——V01 F2）；端口未实现组入口时明确
   *  route-unavailable，不降级为逐次单步（不改变单步 history.request 的
   *  既有语义）。origin 语义同 undo/redo（引用 B 的临时激活路由） */
  runHistorySteps(
    op: 'undo' | 'redo',
    steps: number,
    origin?: { docUri: string },
  ): Promise<HostHistoryGroupResult> {
    const run = this.queue.then(() => {
      // 显式分支调用：三元取方法引用会丢 this 绑定
      if (op === 'undo') {
        return this.doc.undoGroup ? this.doc.undoGroup(steps, origin) : undefined
      }
      return this.doc.redoGroup ? this.doc.redoGroup(steps, origin) : undefined
    })
    this.queue = run.then(() => undefined, () => undefined)
    return run.then((result) => result ?? { executedSteps: 0, aborted: 'route-unavailable' })
  }

  /** 广播一笔外部变更（doc.changed）给全部 ready 面板；exclude 排除变更
   *  发起面板（其以 edit.ack 获知本笔）。暂停面板照发：webview 侧忽略
   *  并在恢复时以全文对齐（版本单调防线不受过期增量影响）。 */
  private broadcastExternal(version: number, changes: SerChange[], exclude?: PanelEntry, history?: { reason?: DocumentChangeReason; paste?: PasteHistory }): void {
    for (const other of this.panels.values()) {
      if (other !== exclude && other.ready) {
        other.port.send({
          kind: 'doc.changed',
          version,
          changes,
          origin: 'external',
          ...history,
        })
      }
    }
  }

  /** 外部增量广播入口（#48）：无「已应用未确认」pending 时立即广播（与
   *  原行为一致）；否则按 version 有序暂存，由 pending 确认路径补发。
   *  有序插入兜住迟到回流（编辑回流晚于外部回流被处理）的乱序到达。 */
  private queueExternalBroadcast(version: number, lfChanges: SerChange[], history?: { reason?: DocumentChangeReason; paste?: PasteHistory }): void {
    let index = this.pendingExternal.length
    while (index > 0 && this.pendingExternal[index - 1]!.version > version) {
      index--
    }
    this.pendingExternal.splice(index, 0, { version, changes: lfChanges, ...history })
    this.flushPendingExternal()
  }

  /** 暂存的外部增量是否已可广播：所有面板均无已应用未确认的 pending 条目 */
  private hasUnconfirmedPending(): boolean {
    for (const panel of this.panels.values()) {
      if (panel.pending.some((p) => !p.confirmed)) {
        return true
      }
    }
    return false
  }

  /** 补发暂存的外部增量（#48）：仅在无未确认 pending 时执行，按 version
   *  有序广播给全部 ready 面板（暂停面板在 webview 侧忽略，版本单调防线
   *  保证恢复时全文对齐不受过期增量影响）。原位清空（splice）保持数组
   *  引用稳定，广播期间重入的入队写进同一数组、不会重复消费。 */
  private flushPendingExternal(): void {
    if (this.pendingExternal.length === 0 || this.hasUnconfirmedPending()) {
      return
    }
    const queued = this.pendingExternal.splice(0)
    for (const item of queued) {
      this.broadcastExternal(item.version, item.changes, undefined, item)
    }
  }

  private sendAck(panel: PanelEntry, ack: HostToWebview): void {
    if (ack.kind === 'edit.ack') {
      panel.ackCache.set(ack.seq, ack)
      while (panel.ackCache.size > ACK_CACHE_LIMIT) {
        const oldest = panel.ackCache.keys().next().value
        if (oldest === undefined) {
          break
        }
        panel.ackCache.delete(oldest)
      }
    }
    panel.port.send(ack)
  }
}
