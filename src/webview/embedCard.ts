// Reading 正文嵌入卡片（工单 #222，ADR-0009「展示容器」层的嵌入侧）：
// 父文档 Reading 正文流中，独占行 `![[…]]` embed 块（readingBlocks 产物）
// 挂载时升级为引用卡片——左侧引用边条 + 顶部文件名 + 右上角打开入口，
// 内容为目标的只读 Reading 视图（独立 VirtualReadingView 实例，经悬停
// 文档访问通道 hover.request/result 装载全文/章节/块）。
//
// 分层契约（#223/#224 的衔接边界）：
// - 本模块做 **Reading 侧挂载适配与容器生命周期**；目标解析与内容服务
//   在 hoverDocAccess（宿主）与 refReadingContent（共享装配）；#224 起
//   未保存变更刷新接入：装载成功登记目标订阅（hover.watch，宿主协调器
//   防抖合并推送），hover.invalidated 到达按分态处理（changed 静默重载、
//   deleted/stale 撤内容显示分态）。接口按容器无关设计（实例身份 = 嵌入
//   行区间 + 目标原文，与容器类型无绑定）。#223 起 Live widget
//   （liveEmbed.ts 的 LiveEmbedWidget）经 mountCardInto 以同一状态库挂载
//   ——语义键同源使模式切换（Live↔Reading）共享装载缓存、fm 展开与
//   滚动状态。#224 起状态库有界（LRU 淘汰死键——父文档文本变更后漂移
//   的旧语义键；仍挂载实例不淘汰），被淘汰条目配对释放订阅。
// - 一层展开：B 内容内的 embed 块**不升级**（readingBlocks 的占位引用行
//   呈现，可点击按 B 身份打开）——不递归装载、不在嵌入内容上叠加悬停
//   浮层（contentEl 停止 mouseover/mouseout 冒泡）。
// - 虚拟化：嵌入块是父文档 VirtualReadingView 的普通块，随窗口挂载/回收
//   ——本模块在回收时释放 B 内容 DOM 与 B 资源管理器、保留 fm 展开与滚动
//   位置（状态库按语义键持有）；重挂优先用装载缓存（会话内零重发，
//   #224 接变更订阅后失效重载）。#243 起卡片内部也按外层
//   .vsidian-embed-card-scroll 的真实视口挂载有限块窗口；未入布局时
//   先由两个 spacer 撑开外壳，随后测量。父视口回收与子窗口回收独立。
// - 只读契约：任务 checkbox 禁用（共享 mountRefContentBlock）、点击不
//   写文档；卡片内点击不冒泡父容器委托（B 内链接按 B 目录解析是唯一
//   正确语义，父容器按 A 解析的委托不得命中）。
import type { HoverPreviewResult, HostToWebview, WebviewToHost } from '../shared/protocol'
import { parseWikilinkInner } from '../shared/wikilink'
import { t } from '../shared/i18n'
import { bindLocale } from './localeDom'
import type { MessageKey } from '../shared/locales/en'
import { HOVER_REFRESH_DEFAULTS } from '../shared/hoverRefresh'
import { REF_EXPANSION_LIMITS, RefExpansionBudget } from '../shared/refExpansion'
import { RefContentInstance, type RefContentMount, type RefLoadedContent, type RefSourceContext } from './refContentInstance'
import { promoteEmbedSlotsInBlock, promotedHostsOf } from './embedSlots'
import { applyObsidianDomAlias } from '../shared/obsidianAlias'
import { createReadingContainer, READING_CLASS_NAMES } from './readingView'
import type { ReadingViewStats } from './readingVirtualView'
import { refErrorText, releaseRefSourceLease } from './refReadingContent'
import { WIKILINK_CLASS_NAMES } from '../shared/wikilink'
import { LiveEditorInstance } from './liveInstance'
import { ImageResourceManager, isDirectImageSrc } from './imageResource'
import { closeFmPopoverForView } from './frontmatterPopover'
import type { SettingsPayload } from '../shared/settings'
import { EditorView, keymap } from '@codemirror/view'
import { Annotation, EditorState, Prec, type Extension, type Transaction } from '@codemirror/state'

/** 装配时刻宿主明暗判定（与 syncController.isVscodeDarkBody 同源逻辑；
 *  不跨模块引用避免 syncController↔embedCard 循环导入——热跟随经
 *  applyDarkTheme 由根转发） */
function embedHostDark(): boolean {
  const cl = document.body.classList
  return cl.contains('vscode-dark') || cl.contains('vscode-high-contrast')
}

/** 右上角打开入口图标（验收反馈：按钮本体空壳无图标——外部跳转形态，
 *  graphicBlockChrome 同款内联 SVG 风格；stroke currentColor 随按钮
 *  --vscode-icon-foreground 着色）。#217 验收跟进：悬停浮层 header 的
 *  跳转按钮同款复用（导出共享） */
export const OPEN_ICON =
  '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" ' +
  'stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M9 2.5h4.5V7"></path><path d="M13.5 2.5L7.5 8.5"></path>' +
  '<path d="M11.5 9v3.5a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1H6"></path></svg>'

/** P2-04 内部模式切换：铅笔（当前 Reading → 切 Live 编辑） */
const MODE_LIVE_ICON =
  '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" ' +
  'stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M11.8 2.6a1.6 1.6 0 0 1 2.3 2.3L5.7 13.3H3v-2.7z"></path>' +
  '<path d="M10.6 4z"></path><path d="M2.5 14.8h11"></path></svg>'

/** P2-04 内部模式切换：打开的书（当前 Live → 切回 Reading） */
const MODE_READING_ICON =
  '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" ' +
  'stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M8 4C7 3 5.6 2.5 3.2 2.5v9.6c2.4 0 3.8.5 4.8 1.4 1-.9 2.4-1.4 4.8-1.4V2.5C10.4 2.5 9 3 8 4z"></path>' +
  '<path d="M8 4v9.5"></path></svg>'

/** P2-04 保存目标入口：软盘图标 */
const SAVE_ICON =
  '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" ' +
  'stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M2.5 2.5h9L13.5 4.5v9h-11z"></path><path d="M5 2.5v3.2h5V2.5"></path>' +
  '<path d="M5 13.5V9.5h6v4"></path></svg>'

/** P2-05 显式关闭编辑入口：X 图标（内部 Live 在场时显示；点击走脏目标
 *  确认链路——保存并关闭／丢弃修改并关闭／取消） */
const CLOSE_ICON =
  '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" ' +
  'stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M3.5 3.5l9 9"></path><path d="M12.5 3.5l-9 9"></path></svg>'

/** P2-05 关闭确认模态稳定类名（样式契约 ref-close-dialog 条目同源） */
export const REF_CLOSE_DIALOG_CLASS_NAMES = {
  /** 全屏半透明遮罩（body 直接子级；fixed 定位） */
  backdrop: 'vsidian-ref-close-backdrop',
  /** 对话框壳（role=dialog aria-modal） */
  box: 'vsidian-ref-close-dialog',
  /** 标题行 */
  title: 'vsidian-ref-close-title',
  /** 说明行（文件名 + 丢弃影响） */
  message: 'vsidian-ref-close-message',
  /** 就地提示行（stale 重新确认 / 保存失败 / 丢弃失败；缺省隐藏） */
  notice: 'vsidian-ref-close-notice',
  /** 按钮组 */
  actions: 'vsidian-ref-close-actions',
  /** 保存并关闭 */
  save: 'vsidian-ref-close-save',
  /** 丢弃修改并关闭（危险动作；主题警示色） */
  discard: 'vsidian-ref-close-discard',
  /** 取消（默认焦点） */
  cancel: 'vsidian-ref-close-cancel',
} as const

/** P2-05 重放豁免注解：确认删除后重放被拦事务（changeFilter 见注解放行） */
const refCloseReplay = Annotation.define<boolean>()

/** 嵌入卡片稳定类名（样式契约 content 域 reading-embed-card 条目同源） */
export const EMBED_CARD_CLASS_NAMES = {
  /** 卡片壳（左引用边条 + 边框；挂 Obsidian 别名 .markdown-embed） */
  card: 'vsidian-embed-card',
  /** 顶部栏（文件名 + 打开入口） */
  header: 'vsidian-embed-card-header',
  /** P2-04 顶部栏右侧动作组（保存/模式切换/打开） */
  headerActions: 'vsidian-embed-card-header-actions',
  /** 文件名（成功后为根内相对路径；装载前为目标显示形态） */
  title: 'vsidian-embed-card-title',
  /** 右上角跳转目标文档入口（沿用 Vsidian 打开行为） */
  open: 'vsidian-embed-card-open',
  /** P2-04 内部模式切换入口（Reading ↔ Live） */
  mode: 'vsidian-embed-card-mode',
  /** P2-04 保存目标入口（目标未保存时可见） */
  save: 'vsidian-embed-card-save',
  /** P2-05 显式关闭编辑入口（内部 Live 在场时可见） */
  close: 'vsidian-embed-card-close',
  /** P2-04 目标未保存圆点（`·`，目标 dirty 时在场） */
  dirty: 'vsidian-embed-card-dirty',
  /** P2-04 内部 Live 编辑器容器（承载嵌入实例的 CM6 EditorView） */
  live: 'vsidian-embed-card-live',
  /** 内容滚动区（长内容内部滚动；max-height 由设置驱动内联写入） */
  scroll: 'vsidian-embed-card-scroll',
  /** 就地状态行（loading / 错误分态；P2-12 冲突暂停时内嵌冲突选择条） */
  state: 'vsidian-embed-card-state',
  /** 错误分态修饰（验收反馈：错误文案与普通文字区分——主题错误色；
   *  loading 不挂，与悬停浮层 stateError 同口径） */
  stateError: 'vsidian-embed-card-state-error',
  /** P2-12（#289）冲突三项选择条（状态行内，suspended 时在场） */
  conflict: 'vsidian-embed-card-conflict',
  /** 对比并解决（hover 逐字「在临时副本和冲突版本的对比视图中处理冲突」） */
  conflictCompare: 'vsidian-embed-card-conflict-compare',
  /** 放弃当前版本（只放弃本次未提交输入，非文档级回滚） */
  conflictDiscard: 'vsidian-embed-card-conflict-discard',
  /** 取消（保持暂停与输入，收起选择） */
  conflictCancel: 'vsidian-embed-card-conflict-cancel',
  /** 取消后的重新选择入口（收起态唯一按钮） */
  conflictReopen: 'vsidian-embed-card-conflict-reopen',
  /** 对比打开失败的就地提示行 */
  conflictNotice: 'vsidian-embed-card-conflict-notice',
} as const

/** P2-05（#282）显式退出意图三径：close = 头部关闭按钮／键位操作，
 *  escape = 嵌入内 Esc，delete = 删除活跃引用行（A 事务拦截） */
type CloseIntent = 'close' | 'escape' | 'delete'

/** 出站上下文（syncController mount 注入；dispose 清空） */
export interface EmbedCardContext {
  /** 会话身份（init 前为 undefined——此时只升级壳不发请求） */
  session(): { sessionId: string | undefined; docUri: string | undefined }
  /** 出站通道（hover.request / image.request / *.activate 只读消息） */
  send(message: WebviewToHost): void
  /** 代码高亮开关（面板 codeCardConfig.highlight 只读投影；缺省开） */
  codeHighlight?(): boolean
  /** 嵌入限高设置（px；设置页 embed.maxHeight 投影） */
  maxHeightPx(): number
  maxDepth?(): number
  /** P2-04 根面板当前模式（未手动选择的根级嵌入跟随它；子卡跟随直接父
   *  嵌入的内部模式）。缺省 reading（保守：不主动建编辑端口） */
  parentMode?(): 'reading' | 'live'
  /** #246 混排占位提升所需的父文档全文（主文档 Reading 块挂载路径注入；
   *  缺省（无注入）时块内占位保持引用行形态不升级——Live 混排 #247）。
   *  卡片/浮层内容的混排不经此口（RefContentMount 用装载结果自带全文） */
  sourceText?(): string | null
  /** #223 Live 挂载的布局通知（view.requestMeasure）：卡片高度异步变动
   *  （内容装载、图片晚到）须唤醒 CM6 视口测量；Reading 侧无需提供 */
  requestMeasure?(): void
  /** P2-10（#287）嵌入内部 Live 的右键菜单入口：编辑器 contentDOM 的
   *  contextmenu 转发根控制器打开统一菜单（根按传入 view 判定区域快照
   *  并捕获目标——执行前重验实例存活与文档一致，见 syncController 的
   *  openContextMenu/runContextMenuCommand）。未提供时保持现状（浏览器
   *  原生菜单，卡片域 stopPropagation 语义不变——Reading 内容不接管） */
  onLiveContextMenu?(inner: string, view: EditorView, event: MouseEvent): void
  /** P2-10 实例事务/选区更新旁路观测（快速操作条等根 chrome 随焦点嵌入
   *  的编辑联动刷新；轻量回调，重活由根自行调度） */
  onLiveUpdate?(update: { docChanged: boolean; selectionSet: boolean }): void
  /** P2-05（#282）主编辑器（A 的 Live 视图）：删除活跃引用的拦截重放在
   *  确认后派发到主编辑器（生产由 syncController 注入；缺省时删除意图
   *  确认后不重放——引用保留，保守路径） */
  mainEditorView?(): EditorView | null
}

/** 装载结果缓存（父文档会话内；#224 变更订阅推送后按目标失效清除） */
type EmbedLoaded = RefLoadedContent

/** P2-04 嵌入实例的目标编辑端口状态（entry 级——同一 occurrence 的双容器
 *  挂载共享一份；Reading 态不存在，即「Reading 无写端口」） */
interface EmbedLiveState {
  /** binding = 已发 refEdit.bind 待回执；bound = 端口已确认（init 待达或已装载） */
  status: 'binding' | 'bound'
  reqId: number
  portId: string | null
  fsPath: string
  /** B 的规范 docUri（出站消息目标戳记，宿主 refEdit.bound 回执提供） */
  docUri: string | null
  dirty: boolean
  suspended: boolean
  /** P2-12（#289）冲突选择收起标记（取消 = 收起选择保持暂停；重新选择
   *  入口可再展开；解除暂停时复位） */
  conflictChoiceCollapsed: boolean
  /** P2-12（#289）「对比并解决」在途标记（结果未回期间防重入，按钮禁用） */
  conflictComparePending: boolean
  /** P2-12（#289）对比打开失败的就地提示（null = 无提示；重试清空） */
  conflictNotice: string | null
  instance: LiveEditorInstance | null
  /** P2-05 已知最新 B 版本（bound/init/推送取 max——模态确认基线与 stale
   *  判定的 webview 侧参照；最终防线在宿主执行时比对权威 version） */
  lastSeenVersion: number
  /** 实例的图片管理器（P2-11 起请求经目标端口出站、结果经 refEdit.push
   *  信封定向路由——reqId 只在端口空间内，不与 A 面板或其他 B occurrence
   *  的管理器撞号错插） */
  images: ImageResourceManager | null
  /** P2-11（#288）手动刷新 reqId 计数（refresh.request 经端口进 B 会话，
   *  与 refresh.invalidated 回包配对） */
  refreshReqSeq: number
  /** 首开定位完成标记（init 后锚点定位/会话选区恢复只做一次） */
  initialLocated: boolean
}

/** P2-10 嵌入实例的公开目标形状（菜单执行重验与操作分派的观测面） */
export interface EmbedLiveTarget {
  fsPath: string
  portId: string | null
  docUri: string | null
  suspended: boolean
  instance: LiveEditorInstance
}

/** 嵌入实例状态（跨挂载保持——视口回收不清除仍可见实例的状态） */
interface EmbedEntry {
  /** 语义键：嵌入行区间 + 目标原文。P2-07 起随 A 的事务映射迁移（平移
   *  稳定——前后文打字不再漂移开新实例）；坍缩（嵌入被改写残缺）不迁移，
   *  死键随 LRU 淘汰回收 */
  key: string
  /** P2-07（#284）稳定宿主身份：面板会话内永不变（键迁移/文本平移均保持）。
   *  对外身份统一走它——hover.watch 的 instanceId、refEdit.bind 的
   *  occurrence、预算 instance 键与 dataKey：宿主 pin 表、来源租约与预算
   *  不随文本编辑失配（若用坐标键，每笔平移都使 pin/退订/重绑失去配对） */
  hostId: string
  inner: string
  sourceStart: number
  sourceEnd: number
  /** P2-04 内部模式手动覆盖（null = 跟随直接父视图；面板会话内按
   *  occurrence 记忆，父模式切换不回滚——「手动选择在父切换后保留」） */
  modeOverride: 'reading' | 'live' | null
  /** P2-04 目标编辑端口（可见且内部 Live 才在场） */
  live: EmbedLiveState | null
  /** P2-05（#282）挂起的显式退出意图（IME 组合中／写入未 ack 时先保留
   *  实例，输入落定后重入检查最新 dirty；一次性） */
  pendingCloseIntent: 'close' | 'escape' | 'delete' | null
  /** P2-07（#284）坍缩死亡标记：嵌入区间被改写吞没（区间倒挂）后置位——
   *  键保持坍缩时刻原始坐标（原位恢复如 undo/删表回填可命中缓存复用），
   *  后续事务不再平移（死键坐标无语义，平移只会错位）；LRU 淘汰回收 */
  collapsed: boolean
  /** P2-04 会话内选区记忆（端口销毁时保存，重绑 init 后恢复） */
  liveSelection: { anchor: number; head: number } | null
  /** P2-04 Live 在场期间的目标失效标记（切回 Reading 时补一次静默重载） */
  pendingReadingRefresh: boolean
  loaded: EmbedLoaded | null
  /** P1-2（review 修复）最近已应用的目标版本（fsPath + version；成功应用
   *  时更新，**不随 loaded 清空**——changed 失效清 loaded 后仍作为回包
   *  新鲜度参照，慢响应旧内容不得覆盖已知更新版本）。TextDocument.version
   *  按文档单调，同目标跨 entry 同一版本空间，可比 */
  lastKnown: { fsPath: string; version: number } | null
  /** 在途请求配对（卸载后的迟到回包仍写入缓存） */
  lastReq: { instanceId: string; reqId: number } | null
  /** P1-2 循环防护：最近一次自愈重发发出的 reqId（该请求的回包若仍过期，
   *  视为版本谱系断点——如目标文档关闭重开后 TextDocument.version 重置
   *  ——终态落地不再重发，避免无限循环；正常请求路径置回 null） */
  healReqId: number | null
  content: RefContentInstance
  /** #224 已登记订阅的目标（hover.watch；与 loaded 解耦——deleted 清
   *  loaded 后订阅保持以感知恢复，dispose/淘汰时据此配对 unwatch） */
  watchedFsPath: string | null
  watchLeaseId: string | null
  parseBytes: number
}

/** 挂载中的卡片实例（DOM 生命周期 = 宿主元素在场期间——Reading 块元素
 *  或 Live widget 根，#223 起两容器同款 handle） */
interface EmbedCardHandle {
  entry: EmbedEntry
  instanceId: string
  hostEl: HTMLElement
  cardEl: HTMLElement
  scrollEl: HTMLElement
  stateEl: HTMLElement
  contentEl: HTMLElement
  /** P2-04 内部 Live 编辑器容器（与 contentEl 并列；显隐随内部模式） */
  liveEl: HTMLElement
  modeBtn: HTMLButtonElement
  saveBtn: HTMLButtonElement
  /** P2-05 显式关闭编辑入口（内部 Live 在场时可见） */
  closeBtn: HTMLButtonElement
  content: RefContentMount
  display: 'loading' | 'content' | 'error'
  note: string
  /** 容器来源（探针观测面；行为路径不分叉——两容器共用装配） */
  host: 'reading' | 'live'
}

/** 嵌入卡片观测探针形态（view.state.readingEmbed 数据源） */
export interface EmbedCardProbe {
  inner: string
  state: 'loading' | 'content' | 'error'
  note: string
  blocks: number
  scope: 'full' | 'heading' | 'block' | ''
  fm: 'none' | 'collapsed' | 'expanded'
  maxHeightPx: number
  /** 容器来源（#223 Live 挂载与 Reading 块挂载的观测区分） */
  host: 'reading' | 'live'
  /** #272 顶层正文归属；递归子卡自身 host=reading 仍可处于 Live 根内。 */
  rootHost: 'reading' | 'live' | 'hover'
  /** #224 内容文本字符数（未保存修改推送后刷新可见性的观测面） */
  textLen: number
  viewStats: ReadingViewStats | null
  /** P2-04 生效内部模式（覆盖优先，缺省跟随直接父） */
  internalMode: 'reading' | 'live'
  /** P2-04 目标编辑端口是否已绑定（可见且内部 Live 才为 true） */
  liveBound: boolean
  livePortId: string | null
  /** P2-11（#288）B 的规范 docUri（端口信封内消息的目标戳记——集成断言
   *  注入资源消息时的身份载体） */
  liveDocUri: string | null
  liveDirty: boolean
  liveSuspended: boolean
  /** P2-04 内部 Live 编辑器文档长度（-1 = 无实例；外部同步/编辑回流观测） */
  liveTextLen: number
  /** P2-11（#288）内部 Live 图片管理器的已应用地址（B 身份解析结果——
   *  「按 B 目录解析才命中」的集成断言面） */
  liveImageSrcs: string[]
  /** P2-05 该嵌入发起的关闭确认模态态（none/open/stale） */
  closeDialog: 'none' | 'open' | 'stale'
  /** P2-05 发起（或挂起）的退出意图径 */
  closeIntent: 'close' | 'escape' | 'delete' | ''
  /** P2-12 冲突选择态（none = 非暂停；open = 三项在场；collapsed = 已取消收起） */
  conflictChoice: 'none' | 'open' | 'collapsed'
  /** P2-12 「对比并解决」在途（防重入观测） */
  conflictComparePending: boolean
  /** P2-12 对比打开失败的就地提示在场 */
  conflictNotice: boolean
}

/** 目标原文（`|` 之前——与阅读双链 a 的 href 同口径） */
function targetOfInner(inner: string): string {
  const pipeAt = inner.indexOf('|')
  return pipeAt >= 0 ? inner.slice(0, pipeAt) : inner
}

/**
 * 嵌入卡片管理器：一个 Reading 视图一个实例（syncController mount 创建、
 * dispose 释放）。父文档块挂载/卸载钩子驱动卡片升级与回收；hover.result
 * 按 entry.lastReq 配对（在场渲染 + 卸载后缓存双路径）。
 */
export class EmbedCardManager {
  private readonly context: EmbedCardContext
  /** 父文档会话内状态库（语义键 → 实例状态；dispose 清空） */
  private readonly entries = new Map<string, EmbedEntry>()
  private readonly budget = new RefExpansionBudget()
  /** 挂载中卡片（宿主元素 → handle；宿主卸载即移除。#223 起宿主可为
   *  Reading 块元素或 Live widget 根，同一 entry 可双容器并存（模式切换
   *  期间视图互不销毁），notifyResult 对全部配对 handle 渲染） */
  private readonly active = new Map<HTMLElement, EmbedCardHandle>()
  /** #223 卡片高度观测（Live 挂载的布局联动）：内容装载/图片晚到改变
   *  cardEl 高度时唤醒 CM6 测量；Reading 侧容器滚动自适应无需通知。
   *  requestMeasure 只读测量不写布局，无 RO 自激发循环风险 */
  private readonly heightObserver: ResizeObserver | null
  private seq = 0
  private reqSeq = 0
  /** P2-04 目标端口 bind 请求自增 id（refEdit.bound 按 reqId 配对） */
  private liveReqSeq = 0
  /** P2-07 稳定宿主身份自增序（面板会话内每 occurrence 唯一且永不变） */
  private hostSeq = 0
  /** P2-11 最近一次设置快照（新实例补发；undefined = 从未收到） */
  private lastSettings: SettingsPayload | undefined

  constructor(context: EmbedCardContext) {
    this.context = context
    this.heightObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => this.context.requestMeasure?.())
      : null
  }

  /** 父文档块挂载钩子：embed 块（data-vsidian-embed-inner 在场）升级为卡片；
   *  #246 混排：块内占位 span（context.sourceText 在场时）提升为流内宿主
   *  并逐个挂载卡片——同一识别/挂载适配与卡片内容/悬停内容（经
   *  RefContentMount 的 onEmbedBlockMounted）三处同源 */
  mountBlock(el: HTMLElement): void {
    const inner = el.dataset['vsidianEmbedInner']
    if (inner !== undefined && !this.active.has(el)) {
      const sourceStart = Number(el.dataset['vsidianSrcStart'] ?? 0)
      const sourceEnd = Number(el.dataset['vsidianSrcEnd'] ?? sourceStart)
      this.mountCardInto(el, inner, sourceStart, sourceEnd, 'reading')
    }
    const text = this.context.sourceText?.()
    if (text !== undefined && text !== null) {
      const start = Number(el.dataset['vsidianSrcStart'])
      const end = Number(el.dataset['vsidianSrcEnd'])
      if (Number.isInteger(start) && Number.isInteger(end) && end >= start) {
        for (const host of promoteEmbedSlotsInBlock(el, text, start, end)) {
          this.mountCardInto(host, host.dataset['vsidianEmbedInner']!,
            Number(host.dataset['vsidianSrcStart']), Number(host.dataset['vsidianSrcEnd']), 'reading')
        }
      }
    }
  }

  /**
   * 容器无关挂载（#223 Live widget 消费）：宿主元素内置卡片壳与交互域，
   * entry 按语义键（行首 offset + 目标原文）取用——Reading 块与 Live
   * widget 对同一嵌入共享装载缓存、fm 展开与滚动状态。装载判定三态：
   * 已装载直接渲染、在途请求显示 loading 等回包（双容器并存不重发）、
   * 其余发起新请求。
   */
  mountCardInto(
    el: HTMLElement,
    inner: string,
    sourceStart: number,
    sourceEnd: number,
    host: 'reading' | 'live',
    source?: RefSourceContext,
  ): void {
    if (this.active.has(el)) {
      return
    }
    const key = source?.occurrence ?? `${Number.isInteger(sourceStart) ? sourceStart : 0}::${inner}`
    let entry = this.entries.get(key)
    if (!entry) {
      // P2-07 稳定宿主身份：对外身份（watch/bind/预算/dataKey/父子链）统一
      // 走 hostId——键迁移只动状态库内的坐标键，宿主侧配对不受文本平移影响
      const hostId = `embed-occ-${++this.hostSeq}`
      entry = {
        key,
        hostId,
        inner,
        sourceStart: Number.isInteger(sourceStart) ? sourceStart : 0,
        sourceEnd: Number.isInteger(sourceEnd) ? sourceEnd : sourceStart,
        modeOverride: null,
        live: null,
        pendingCloseIntent: null,
        collapsed: false,
        liveSelection: null,
        pendingReadingRefresh: false,
        loaded: null,
        lastKnown: null,
        lastReq: null,
        healReqId: null,
        content: new RefContentInstance(source ?? {
          panelDocUri: this.context.session().docUri ?? '',
          sourceDocUri: this.context.session().docUri ?? '',
          range: { start: sourceStart, end: sourceEnd },
          occurrence: hostId,
          depth: 1,
          treeId: hostId,
        }),
        watchedFsPath: null,
        watchLeaseId: null,
        parseBytes: 0,
      }
      this.entries.set(key, entry)
      const owned = entry
      entry.content.onDispose(() => {
        owned.lastReq = null
        this.unwatchEntry(owned)
      })
    } else {
      this.touchEntry(entry) // LRU 触达（重挂载 = 仍有效实例）
    }
    this.evictEntriesIfNeeded()

    // 卡片壳 DOM（替换块内占位引用行；块元素的源锚点 dataset 保持）
    el.textContent = ''
    const cardEl = document.createElement('div')
    // #222 别名桥：卡片壳同时挂 Obsidian 嵌入容器名（.markdown-embed）
    //——主题片段的嵌入容器规则天然命中
    cardEl.className = applyObsidianDomAlias(EMBED_CARD_CLASS_NAMES.card)
    const header = document.createElement('div')
    header.className = EMBED_CARD_CLASS_NAMES.header
    const titleEl = document.createElement('span')
    titleEl.className = EMBED_CARD_CLASS_NAMES.title
    titleEl.textContent = parseWikilinkInner(inner)?.display ?? inner
    // P2-04 内部模式切换入口（覆盖按 occurrence 记忆；图标/悬停词随当前
    // 生效模式翻转——指向另一态）与保存目标入口（dirty 时可见）
    const modeBtn = document.createElement('button')
    modeBtn.type = 'button'
    modeBtn.className = EMBED_CARD_CLASS_NAMES.mode
    const saveBtn = document.createElement('button')
    saveBtn.type = 'button'
    saveBtn.className = EMBED_CARD_CLASS_NAMES.save
    const saveLabel = t('embed.saveTarget')
    saveBtn.setAttribute('aria-label', saveLabel)
    saveBtn.setAttribute('data-tooltip', saveLabel)
    saveBtn.innerHTML = SAVE_ICON
    saveBtn.style.display = 'none'
    // P2-05 显式关闭编辑入口（内部 Live 在场时可见；dirty 走确认链路）
    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = EMBED_CARD_CLASS_NAMES.close
    const closeLabel = t('embed.closeEditor')
    closeBtn.setAttribute('aria-label', closeLabel)
    closeBtn.setAttribute('data-tooltip', closeLabel)
    closeBtn.innerHTML = CLOSE_ICON
    closeBtn.style.display = 'none'
    const openBtn = document.createElement('button')
    openBtn.type = 'button'
    openBtn.className = EMBED_CARD_CLASS_NAMES.open
    const openLabel = t('embed.openTarget')
    openBtn.setAttribute('aria-label', openLabel)
    openBtn.setAttribute('data-tooltip', openLabel)

    openBtn.innerHTML = OPEN_ICON
    const headerRight = document.createElement('span')
    headerRight.className = EMBED_CARD_CLASS_NAMES.headerActions
    headerRight.appendChild(saveBtn)
    headerRight.appendChild(modeBtn)
    headerRight.appendChild(closeBtn)
    headerRight.appendChild(openBtn)
    header.appendChild(titleEl)
    header.appendChild(headerRight)
    const scrollEl = document.createElement('div')
    scrollEl.className = EMBED_CARD_CLASS_NAMES.scroll
    scrollEl.style.maxHeight = `${this.context.maxHeightPx()}px`
    const stateEl = document.createElement('div')
    stateEl.className = EMBED_CARD_CLASS_NAMES.state
    const contentEl = createReadingContainer()
    // P2-04 内部 Live 编辑器容器（与 Reading 容器并列；默认隐藏）
    const liveEl = document.createElement('div')
    liveEl.className = EMBED_CARD_CLASS_NAMES.live
    liveEl.style.maxHeight = `${this.context.maxHeightPx()}px`
    liveEl.style.display = 'none'
    scrollEl.appendChild(contentEl)
    scrollEl.appendChild(liveEl)
    cardEl.appendChild(header)
    cardEl.appendChild(scrollEl)
    cardEl.appendChild(stateEl)
    el.appendChild(cardEl)

    const handle: EmbedCardHandle = {
      entry,
      instanceId: `embed-${++this.seq}`,
      hostEl: el,
      cardEl,
      scrollEl,
      stateEl,
      contentEl,
      liveEl,
      modeBtn,
      saveBtn,
      closeBtn,
      content: entry.content.mount({
        contentEl, scrollEl, strategy: 'virtual',
        session: () => this.context.session(),
        send: (message) => this.context.send(message),
        codeHighlight: () => this.context.codeHighlight?.() ?? true,
        onEmbedBlockMounted: (block, target) => this.mountChildBlock(entry!, block, target),
        onEmbedBlockUnmounted: (block) => this.unmountBlock(block),
      }),
      display: 'loading',
      note: '',
      host,
    }
    // P2-04 范围锁：悬停浮层内的卡片不提供内部模式入口（浮层内部 Live 属
    // P2-05）——浮层后代的来源父（浮层实例 id）不是嵌入 hostId，据此结构
    // 判定（挂载时元素可能尚未进 DOM，closest 不可靠）；模式按钮隐藏（Tab
    // 序不新增停留点）且条目锁定 Reading，不随根面板 Live 继承绑定端口
    //（P2-07：parentInstanceId 统一为父 hostId——按 hostId 查在场 entry）
    if (source?.parentInstanceId !== undefined && !this.entryOfHostId(source.parentInstanceId)) {
      modeBtn.style.display = 'none'
      modeBtn.tabIndex = -1
      entry.modeOverride = 'reading'
    }
    this.active.set(el, handle)
    this.heightObserver?.observe(cardEl)
    handle.content.onDispose(() => this.heightObserver?.unobserve(cardEl))

    // 引用正文只读：原生右键停在本卡，不让父 Live/Reading 按 A 的坐标
    // 打开写操作菜单；保留浏览器默认选字/复制菜单。
    handle.content.listen(cardEl, 'contextmenu', (event) => event.stopPropagation())
    // 卡片内交互域：点击不冒泡父容器委托（B 内链接按 B 解析）；悬停不
    // 叠加浮层（阻断 readingContainer 的 mouseover/mouseout 委托）
    handle.content.listen(contentEl, 'click', (event) => {
      event.stopPropagation() // 全部点击停在卡片域内（含 fm 按钮冒泡）
      this.handleContentClick(handle, event)
    })
    handle.content.listen(contentEl, 'mouseover', (event) => event.stopPropagation())
    handle.content.listen(contentEl, 'mouseout', (event) => event.stopPropagation())
    handle.content.listen(scrollEl, 'wheel', (event) => {
      // Chromium/VSCode 的嵌套滚动区到边界时不总会原生接续外层。
      // 只由命中的最内层处理；内层仍有余量时交给浏览器正常滚动。
      if ((event.target as HTMLElement).closest(`.${EMBED_CARD_CLASS_NAMES.scroll}`) !== scrollEl) return
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scrollEl.clientHeight : 1)
      if (delta === 0 || (delta > 0 && scrollEl.scrollTop + scrollEl.clientHeight < scrollEl.scrollHeight - 1) ||
        (delta < 0 && scrollEl.scrollTop > 1)) return
      let outer = scrollEl.parentElement?.closest<HTMLElement>(`.${EMBED_CARD_CLASS_NAMES.scroll}`) ?? null
      while (outer) {
        const before = outer.scrollTop
        outer.scrollTop += delta
        if (outer.scrollTop !== before) {
          event.preventDefault()
          return
        }
        outer = outer.parentElement?.closest<HTMLElement>(`.${EMBED_CARD_CLASS_NAMES.scroll}`) ?? null
      }
    })

    // 右上角打开入口：按父文档身份解析（不带 sourceDocUri，与正文双链
    // 点击同语义）；打开不改写引用原文
    handle.content.listen(openBtn, 'click', (event) => {
      event.stopPropagation()
      const session = this.context.session()
      if (!session.sessionId || !session.docUri) {
        return
      }
      this.context.send({
        kind: 'wikilink.activate',
        sessionId: session.sessionId,
        docUri: session.docUri,
        target: targetOfInner(entry!.inner),
        srcStart: entry!.sourceStart,
        srcEnd: entry!.sourceEnd,
        ...(entry!.content.source.parentInstanceId !== undefined
          ? { sourceDocUri: entry!.content.source.sourceDocUri } : {}),
      })
    })
    // P2-04 内部模式切换（点击不冒泡父容器）；保存目标（同一出站通道）
    handle.content.listen(modeBtn, 'click', (event) => {
      event.stopPropagation()
      this.toggleMode(entry!)
    })
    handle.content.listen(saveBtn, 'click', (event) => {
      event.stopPropagation()
      this.saveLive(entry!)
    })
    // P2-05 显式关闭（点击不冒泡父容器；dirty 检查与三项模态在 manager）
    handle.content.listen(closeBtn, 'click', (event) => {
      event.stopPropagation()
      this.requestClose(entry!, 'close')
    })
    // 双容器并存时编辑器 DOM 归最近挂载的 handle 承载（宿主元素移动）
    if (entry.live?.instance) {
      handle.liveEl.appendChild(entry.live.instance.getView()!.dom)
    }
    this.applyInternalDom(handle)
    this.refreshModeChrome(handle)

    if (entry.loaded) {
      // 重挂载：装载缓存直接渲染，恢复 fm/滚动状态（零新请求）
      this.applyLoaded(handle, entry.loaded)
    } else if (entry.lastReq !== null) {
      // 在途请求：显示 loading 等回包（双容器并存不重发——notifyResult
      // 对全部配对 handle 渲染）
      this.applyDisplay(handle, 'loading', t('embed.loading'))
    } else {
      this.requestLoad(handle)
    }
  }

  private mountChildBlock(parent: EmbedEntry, el: HTMLElement, target: RefLoadedContent): void {
    this.mountChildFrom(parent.hostId, parent.content.source.treeId ?? parent.hostId,
      parent.content.source.depth ?? 1, el, target)
  }

  /** 浮层根 B 与正文卡片共用同一子卡状态库、来源链和面板预算。 */
  mountPopupChild(parentInstanceId: string, el: HTMLElement, target: RefLoadedContent): void {
    this.mountChildFrom(parentInstanceId, parentInstanceId, 1, el, target)
  }

  private mountChildFrom(parentKey: string, treeId: string, parentDepth: number,
    el: HTMLElement, target: RefLoadedContent): void {
    const inner = el.dataset['vsidianEmbedInner']
    if (inner === undefined) return
    const start = Number(el.dataset['vsidianSrcStart'] ?? -1)
    const end = Number(el.dataset['vsidianSrcEnd'] ?? -1)
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) return
    const source: RefSourceContext = {
      panelDocUri: this.context.session().docUri ?? '',
      sourceDocUri: target.fsPath,
      range: { start, end },
      occurrence: `${parentKey}/${start}::${inner}`,
      parentInstanceId: parentKey,
      depth: (target.depth ?? parentDepth) + 1,
      treeId,
    }
    this.mountCardInto(el, inner, start, end, 'reading', source)
  }

  /** 宿主卸载钩子（Reading 块卸载 / Live widget destroy）：保存状态、释放
   *  B 视图与资源管理器（实例状态保留在 entry 状态库）。#246 混排宿主
   *  （块内提升产物）随所属块卸载——先于块根处理（宿主走同一 active
   *  配对路径，重复调用幂等）。P2-04：编辑器 DOM 随 handle 卸载移动到
   *  并存 handle 或随最后一个 handle 销毁端口（「可见才创建」的回收侧）。 */
  unmountBlock(el: HTMLElement): void {
    for (const host of promotedHostsOf(el)) {
      this.unmountBlock(host)
    }
    const handle = this.active.get(el)
    if (!handle) {
      return
    }
    this.active.delete(el)
    handle.content.dispose()
    const remaining = [...this.active.values()].filter((h) => h.entry === handle.entry)
    const live = handle.entry.live
    if (live?.instance && remaining.length > 0) {
      // 双容器并存（模式切换过渡）：编辑器 DOM 移交仍在场的 handle
      remaining[0]!.liveEl.appendChild(live.instance.getView()!.dom)
    }
    if (handle.entry.content.source.parentInstanceId !== undefined && remaining.length === 0) {
      // 子实例仅随父块在场；回收后保留 occurrence 滚动状态，但释放授权
      // 与旧正文。重挂重新读当前父版本，不复活已退订的缓存快照。
      handle.entry.loaded = null
      handle.entry.lastReq = null
      this.unwatchEntry(handle.entry)
      this.budget.release(handle.entry.hostId)
    } else if (remaining.length > 0 && handle.entry.loaded && handle.entry.parseBytes > 0) {
      this.budget.attachContent(handle.entry.hostId,
        this.dataKey(handle.entry, handle.entry.loaded), handle.entry.parseBytes * remaining.length)
    }
    if (remaining.length === 0 && live) {
      // 最后一个宿主卸载（离屏）：销毁编辑器并释放端口（occurrence 会话
      // 记忆保留——模式覆盖与选区）
      this.teardownLive(handle.entry)
    }
    el.textContent = '' // 卡片 DOM（含 B 内容全量块）随宿主卸载丢弃
  }

  /** hover.result 路由（syncController 转发）：按 entry.lastReq 配对——
   *  同一 entry 的全部在场 handle（Reading 块与 Live widget 双容器并存）
   *  逐个渲染（先收集后应用：applyResult/applyError 会清空共享的 lastReq，
   *  边清边配对会漏掉同 entry 的其余容器）；已卸载的迟到回包写入缓存供
   *  重挂使用。#224 版本仲裁（P1-2 改 per-entry）：新鲜度参照 = 全库同目标
   *  已知最新版本（loaded + lastKnown——后者在 changed 失效清 loaded 后
   *  仍持有版本）；回包版本低于参照时**按命中 entry 丢弃并清其 lastReq 后
   *  自愈重发一次**（原全局早退会把同目标其他 entry 的首载回包一并丢弃且
   *  无重试，lastReq 悬挂 → 永久卡 loading；宿主读取缓存按目标失效，重发
   *  读到当前内容，版本单调保证收敛不循环——请求代次守卫之外的第二道
   *  防线） */
  notifyResult(message: HoverPreviewResult): boolean {
    let reference: number | null = null
    if (message.ok) {
      for (const other of this.entries.values()) {
        if (other.loaded !== null && other.loaded.fsPath === message.target.fsPath) {
          reference = Math.max(reference ?? 0, other.loaded.version)
        }
        if (other.lastKnown !== null && other.lastKnown.fsPath === message.target.fsPath) {
          reference = Math.max(reference ?? 0, other.lastKnown.version)
        }
      }
    }
    const stale = message.ok && reference !== null && message.version < reference
    const matched: EmbedCardHandle[] = []
    const matchedEntries = new Set<EmbedEntry>()
    for (const handle of this.active.values()) {
      if (handle.entry.lastReq !== null &&
          handle.entry.lastReq.instanceId === message.instanceId &&
          handle.entry.lastReq.reqId === message.reqId) {
        matched.push(handle)
        matchedEntries.add(handle.entry)
      }
    }
    if (matchedEntries.size > 0) {
      for (const entry of matchedEntries) {
        if (stale && entry.healReqId !== message.reqId) {
          if (message.ok) releaseRefSourceLease(this.context, message.sourceLeaseId)
          // 过期回包按 entry 丢弃：清在途配对并自愈重发一次（有已渲染内容
          // 时静默——不闪 loading；首载无内容则如实 loading）。heal 回包若
          // 仍过期（版本谱系断点）走下方终态落地，不无限重发
          entry.lastReq = null
          const first = matched.find((h) => h.entry === entry)!
          this.requestLoad(first, {
            silent: matched.some((h) => h.entry === entry && h.display === 'content'),
            heal: true,
            reload: true,
          })
          continue
        }
        for (const handle of matched) {
          if (handle.entry !== entry) {
            continue
          }
          if (message.ok) {
            this.applyResult(handle, message)
          } else {
            this.applyError(handle, message.reason, message.anchor)
          }
        }
      }
      return true
    }
    // 卸载后在途：同配对写入缓存（重挂直接用）；过期回包只清 lastReq
    //（缓存不得写入旧版本——重挂会绕过仲裁直接渲染）
    for (const entry of this.entries.values()) {
      if (entry.lastReq !== null &&
          entry.lastReq.instanceId === message.instanceId &&
          entry.lastReq.reqId === message.reqId) {
        if (!stale && message.ok) {
          entry.loaded = {
            fsPath: message.target.fsPath,
            relPath: message.target.relPath,
            scope: message.scope.kind,
            selector: message.scope,
            version: message.version,
            text: message.text,
            range: message.range,
            depth: message.depth,
            expansionPath: message.expansionPath,
          }
          entry.lastKnown = { fsPath: message.target.fsPath, version: message.version }
          this.watchEntry(entry, message.sourceLeaseId)
        }
        entry.lastReq = null
        if (stale && message.ok) releaseRefSourceLease(this.context, message.sourceLeaseId)
        return true
      }
    }
    return false
  }

  /** image.result 路由（A 面板广播的直发回包）：只作用于在场卡片的 Reading
   *  内容管理器（reqId 由各管理器自守卫）。
   *  P2-11：内部 Live 实例的管理器不在此投递——其请求经目标端口出站，
   *  回包经 refEdit.push 信封定向（notifyPush）；两侧 reqId 空间独立，若
   *  广播投递会在撞号时把 A 的解析结果错插进 B 的槽位（错图） */
  notifyImageResult(msg: { reqId: number; ok: boolean; src?: string; reason?: string }): void {
    for (const handle of this.active.values()) {
      handle.content.notifyImageResult(msg)
    }
  }

  /**
   * #224 目标失效推送路由（syncController 转发 hover.invalidated）：命中
   * loaded 目标的全部 entry（同目标多实例一致处理）。
   * - changed：清 loaded（重挂路径重载）+ 在场 handle 静默重发请求（不闪
   *   loading——旧内容保留到新回包重建，滚动位置先保存在场值）。
   * - deleted：撤下内容（清 loaded 与 B 视图 DOM、not-found 分态就地呈现）
   *   ，不无限保留旧内容；订阅保持（恢复 changed 推送可重载）。
   * - stale：读取失败分态（read-failed 文案；权限/断连不等同删除）。
   * fm 展开与滚动状态保留在 entry（有效实例状态不因失效重置）。
   */
  notifyInvalidated(message: {
    fsPath: string
    status: 'changed' | 'deleted' | 'stale'
    generation: number
  }): void {
    // P1-2（review 修复）首载在途前置处理：lastReq 在途但 loaded 与
    // watchedFsPath 皆空的 entry 拿不到下方目标匹配（目标身份要等回包才可
    // 知）——原实现被「未 watch 即 skip」排除，在途回包可能是变更前旧内容
    // 且无重发。失效推送到达时无条件重发一次（幂等读取；新 reqId 覆盖
    // lastReq，旧回包按配对守卫自然丢弃——与本次失效目标无关的在途首载
    // 顶多多一次等价读取）；卸载在途只清 lastReq（重挂路径重载）。
    for (const entry of [...this.entries.values()]) {
      if (entry.lastReq === null || entry.loaded !== null || entry.watchedFsPath !== null) {
        continue
      }
      entry.lastReq = null
      const first = [...this.active.values()].find((h) => h.entry === entry)
      if (first) {
        this.requestLoad(first)
      }
    }
    for (const entry of [...this.entries.values()]) {
      // 目标匹配：装载在场的按 loaded，deleted 已清 loaded 的按订阅记录
      //（watchedFsPath——恢复 changed 推送仍能命中）
      const entryTarget = entry.loaded?.fsPath ?? entry.watchedFsPath
      if (entryTarget !== message.fsPath || entry.watchedFsPath === null) {
        continue
      }
      // P2-04：Live 在场时 Reading 侧不重载——目标变更经端口增量推送驱动
      // 编辑器（B 会话广播），Reading 缓存延迟到切回时静默重载（目标删除
      // 也一样：B 的 TextDocument 驻留，编辑会话继续）
      if (entry.live) {
        entry.pendingReadingRefresh = true
        continue
      }
      // 在场滚动位置先保存（重建后恢复；离屏 entry 保留旧值）
      for (const handle of this.active.values()) {
        if (handle.entry === entry && handle.scrollEl.scrollTop > 0) {
          entry.content.scrollTop = handle.scrollEl.scrollTop
        }
      }
      entry.loaded = null
      entry.lastReq = null
      if (message.status !== 'changed') this.budget.clearContent(entry.hostId)
      const handles = [...this.active.values()].filter((h) => h.entry === entry)
      if (message.status === 'changed') {
        // 每 entry 单笔重发（lastReq 是 entry 级共享——同 entry 的双容器
        // handle 不重复请求，回包对全部配对 handle 渲染，与首载同构）。
        // P2-03：已打开实例的重载带 anchorOptional（锚点缺失不切错误页）
        const first = handles[0]
        if (first) {
          this.requestLoad(first, { silent: true, reload: true })
        }
        this.touchEntry(entry) // 刷新中仍是有效实例
      } else {
        const note = refErrorText(
          message.status === 'deleted' ? 'not-found' : 'read-failed',
          targetOfInner(entry.inner),
        )
        for (const handle of handles) {
          handle.content.clear()
          handle.contentEl.textContent = '' // 旧内容撤下（防 display 反转闪现）
          this.applyDisplay(handle, 'error', note)
        }
      }
    }
  }

  /** 宿主拒绝订阅时撤下已送达正文，避免留下无法刷新的在场快照。 */
  notifyWatchRejected(message: { fsPath: string; instanceId: string; reason: 'capacity' | 'source'; sourceLeaseId?: string }): void {
    // instanceId 为 hostId（P2-07 对外身份统一）——宿主 pin/拒绝按它配对
    const entry = this.entryOfHostId(message.instanceId)
    if (!entry || entry.watchedFsPath !== message.fsPath ||
      (message.sourceLeaseId !== undefined && entry.watchLeaseId !== message.sourceLeaseId)) return
    entry.loaded = null
    entry.lastReq = null
    this.unwatchEntry(entry)
    this.budget.release(entry.hostId)
    const note = t(message.reason === 'capacity' ? 'hover.errorWatchCapacity' : 'hover.errorSourceExpired')
    for (const handle of this.active.values()) {
      if (handle.entry !== entry) continue
      handle.content.clear()
      this.applyDisplay(handle, 'error', note)
    }
  }

  /** image.invalidate 路由：全部在场 B 管理器按 srcs 失效重发 */
  notifyImageInvalidate(srcs: readonly string[]): void {
    for (const handle of this.active.values()) {
      handle.content.invalidateImages(srcs)
    }
  }

  /** 手动刷新（refresh.invalidated）：全部在场 B 管理器全量失效重挂 */
  invalidateImages(): void {
    for (const handle of this.active.values()) {
      handle.content.invalidateImages()
    }
  }

  /** 限高设置热更（settings.snapshot / settings.changed）：遍历在场卡片 */
  setMaxHeight(px: number): void {
    for (const handle of this.active.values()) {
      handle.scrollEl.style.maxHeight = `${px}px`
      handle.liveEl.style.maxHeight = `${px}px`
    }
  }

  /** 设置即时生效：缩小时撤销深层来源与正文，放大时重试深度占位。 */
  setMaxDepth(depth: number): void {
    const handles = [...this.active.values()].sort((a, b) =>
      (b.entry.content.source.depth ?? 1) - (a.entry.content.source.depth ?? 1))
    for (const handle of handles) {
      const level = handle.entry.content.source.depth ?? 1
      if (level > depth) {
        handle.entry.lastReq = null
        handle.entry.loaded = null
        handle.content.clear()
        this.unwatchEntry(handle.entry)
        this.budget.release(handle.entry.hostId)
        this.applyDisplay(handle, 'error', t('hover.errorDepth'))
      } else if (handle.display === 'error' && handle.note === t('hover.errorDepth') &&
        handle.entry.lastReq === null && handle.entry.loaded === null) {
        this.requestLoad(handle)
      }
    }
  }

  // ---- P2-04（#281）内部模式状态机与目标编辑端口 ----

  /** P2-07（#284）嵌入实例键迁移：A 的事务使嵌入区间平移时，把根级 entry
   *  的状态库键与源区间迁移到新坐标（widget 随后按新坐标重挂，mountCardInto
   *  命中迁移后的 entry——装载缓存、内部 Live 端口、选区与 fm/滚动状态全
   *  保持）。独占行因键取行首本就少漂移，混排/列表/引用容器的键取嵌入精确
   *  区间——前后文打字每键平移，不迁移即卡片重载 + 端口销毁重建风暴。
   *  只迁移根级 entry（子卡坐标在直接父 B 的全文坐标空间，A 的事务不可
   *  映射）；坍缩（嵌入被改写残缺、区间倒挂）不迁移——死键留给 LRU 淘汰。
   *  调用时序契约：须在 docView 更新（widget toDOM）前——生产经
   *  appendTransaction 装配（被 changeFilter 拒绝的事务不会到达，天然免除
   *  「取消的事务已迁移」错配）。 */
  remapSources(changes: import('@codemirror/state').ChangeSet): void {
    if (this.entries.size === 0) {
      return
    }
    const moves: Array<{ entry: EmbedEntry; newKey: string; start: number; end: number }> = []
    for (const entry of this.entries.values()) {
      if (entry.content.source.parentInstanceId !== undefined || entry.collapsed) {
        continue // 子卡：坐标属父 B 全文空间；坍缩死键：不再平移（原位恢复
        // 才命中缓存——删表回填/undo 的坐标语义；漂移后重挂按新实例装载）
      }
      const start = changes.mapPos(entry.sourceStart, 1)
      const end = changes.mapPos(entry.sourceEnd, -1)
      if (start === entry.sourceStart && end === entry.sourceEnd) {
        continue
      }
      if (end <= start) {
        // 坍缩（嵌入区间被改写吞没——部分删除倒挂或整段删除钳成零宽）：
        // 键冻结在原坐标，后续事务不再平移
        entry.collapsed = true
        continue
      }
      const newKey = `${start}::${entry.inner}`
      if (newKey === entry.key || this.entries.has(newKey)) {
        continue // 防御：撞键（理论不可达）放弃迁移，保持现状语义
      }
      moves.push({ entry, newKey, start, end })
    }
    for (const { entry, newKey, start, end } of moves) {
      this.entries.delete(entry.key)
      entry.key = newKey
      entry.sourceStart = start
      entry.sourceEnd = end
      entry.content.source.range = { start, end }
      this.entries.set(newKey, entry)
    }
  }

  /** 生效内部模式：手动覆盖优先；缺省跟随直接父视图（根级嵌入取根面板
   *  模式，子卡取直接父嵌入的内部模式——Q19 语义） */
  private effectiveMode(entry: EmbedEntry): 'reading' | 'live' {
    if (entry.modeOverride) {
      return entry.modeOverride
    }
    const parentId = entry.content.source.parentInstanceId
    if (parentId === undefined) {
      return this.context.parentMode?.() ?? 'reading'
    }
    const parent = this.entryOfHostId(parentId)
    return parent ? this.effectiveMode(parent) : this.context.parentMode?.() ?? 'reading'
  }

  /** 手动切换内部模式（头部按钮 / 焦点嵌入的键位入口）：按 occurrence 记
   *  忆，父模式切换不回滚 */
  private toggleMode(entry: EmbedEntry): void {
    entry.modeOverride = this.effectiveMode(entry) === 'live' ? 'reading' : 'live'
    this.applyInternalMode(entry)
  }

  /** 模式施加与级联：本 entry 的 DOM 显隐与端口增删；无覆盖的子卡跟随
   *  直接父（递归——子树模式继承）。幂等：同态重复调用无副作用 */
  private applyInternalMode(entry: EmbedEntry): void {
    const mode = this.effectiveMode(entry)
    const handles = [...this.active.values()].filter((h) => h.entry === entry)
    for (const handle of handles) {
      this.applyInternalDom(handle, mode)
      this.refreshModeChrome(handle)
    }
    if (mode === 'live') {
      if (entry.loaded) {
        this.ensureLivePort(entry)
      }
      // 未装载：等待装载完成（applyLoaded 的 Live 分支再绑定）
    } else if (entry.live) {
      this.teardownLive(entry)
      this.restoreReadingDisplay(entry)
    }
    for (const child of this.entries.values()) {
      if (child.content.source.parentInstanceId === entry.hostId && !child.modeOverride) {
        this.applyInternalMode(child)
      }
    }
  }

  /** 根面板模式切换通知（syncController applyModeDom 联动）：无覆盖的根级
   *  嵌入跟随（子卡随 applyInternalMode 级联）。P2-07（#284）：切换后校正
   *  既有内部 Live 编辑器的容器归属——编辑器 DOM 随「最近挂载 handle」
   *  （mountCardInto/unmountBlock 的移交规则），而模式切换不触发重挂
   *  （隐藏容器 handle 不销毁），不校正则编辑器滞留隐藏容器（端口活跃
   *  但用户不可见） */
  notifyParentModeChanged(): void {
    for (const entry of this.entries.values()) {
      if (entry.content.source.parentInstanceId === undefined && !entry.modeOverride) {
        this.applyInternalMode(entry)
      }
    }
    this.correctLiveDomHomes()
  }

  /** P2-07（#284）编辑器容器归属校正：live 在场的根级 entry，把编辑器
   *  DOM 移到当前父模式容器的 handle（编辑器唯一 DOM 节点，appendChild
   *  移动即迁移——Chromium 移动聚焦节点保持焦点） */
  private correctLiveDomHomes(): void {
    const visibleHost = this.context.parentMode?.() ?? 'reading'
    for (const entry of this.entries.values()) {
      const view = entry.live?.instance?.getView()
      if (!view || !entry.live?.portId) {
        continue
      }
      const handle = [...this.active.values()].find((h) => h.entry === entry && h.host === visibleHost)
      if (handle && !handle.liveEl.contains(view.dom)) {
        handle.liveEl.appendChild(view.dom)
        this.applyInternalDom(handle)
      }
    }
  }

  /** 句柄级内容显隐：Live 态显示编辑器容器（实例已建）并隐藏 Reading
   *  容器；Reading 态反转。mode 传入避免递归重算 */
  private applyInternalDom(handle: EmbedCardHandle, mode = this.effectiveMode(handle.entry)): void {
    const liveOn = mode === 'live' && handle.entry.live?.instance != null
    handle.contentEl.style.display = liveOn ? 'none' : ''
    handle.liveEl.style.display = liveOn ? '' : 'none'
  }

  /** 切回 Reading 的内容恢复：目标失效过（Live 期间挂起）或无缓存时静默
   *  重载；否则从装载缓存直接渲染 */
  private restoreReadingDisplay(entry: EmbedEntry): void {
    const handles = [...this.active.values()].filter((h) => h.entry === entry)
    if (handles.length === 0) {
      return
    }
    if (entry.pendingReadingRefresh || !entry.loaded) {
      entry.pendingReadingRefresh = false
      entry.lastReq = null
      this.requestLoad(handles[0]!, { silent: true, reload: true })
      return
    }
    for (const handle of handles) {
      if (handle.display === 'content' && handle.contentEl.childElementCount === 0) {
        this.applyLoaded(handle, entry.loaded)
      }
    }
  }

  /** 绑定目标编辑端口（可见且内部 Live 且已装载——装载完成的 watch 固定
   *  是宿主 bind 校验的前置）。幂等：已有端口或绑定在途直接返回 */
  private ensureLivePort(entry: EmbedEntry): void {
    if (entry.live || !entry.loaded) {
      return
    }
    const session = this.context.session()
    if (!session.sessionId || !session.docUri) {
      return
    }
    const reqId = ++this.liveReqSeq
    entry.live = {
      status: 'binding',
      reqId,
      portId: null,
      fsPath: entry.loaded.fsPath,
      docUri: null,
      dirty: false,
      suspended: false,
      conflictChoiceCollapsed: false,
      conflictComparePending: false,
      conflictNotice: null,
      instance: null,
      lastSeenVersion: 0,
      images: null,
      refreshReqSeq: 0,
      initialLocated: false,
    }
    this.context.send({
      kind: 'refEdit.bind',
      panelSessionId: session.sessionId,
      panelDocUri: session.docUri,
      fsPath: entry.loaded.fsPath,
      occurrence: entry.hostId,
      reqId,
    })
  }

  /** refEdit.bound 路由：按 reqId 配对（同 fsPath 校验防串目标） */
  notifyBound(message: Extract<HostToWebview, { kind: 'refEdit.bound' }>): void {
    for (const entry of this.entries.values()) {
      const live = entry.live
      if (!live || live.status !== 'binding' || live.reqId !== message.reqId ||
        (message.ok && live.fsPath !== message.fsPath)) {
        continue
      }
      if (!message.ok) {
        // 绑定失败（来源过期 / 目标不可装载）：回退 Reading 呈现，清除
        // 手动覆盖（避免每次重挂都失败重试的循环），就地提示
        entry.live = null
        entry.modeOverride = null
        this.applyInternalMode(entry)
        const note = t(message.reason === 'source' ? 'hover.errorSourceExpired' : 'embed.liveBindFailed')
        for (const handle of this.active.values()) {
          if (handle.entry === entry && !entry.loaded) {
            this.applyDisplay(handle, 'error', note)
          }
        }
        continue
      }
      live.status = 'bound'
      live.portId = message.portId
      live.docUri = message.docUri
      live.dirty = message.dirty
      live.lastSeenVersion = Math.max(live.lastSeenVersion, message.version)
      this.createLiveInstance(entry)
      this.refreshLiveChrome(entry)
    }
  }

  /** 创建嵌入 Live 实例（portId/docUri 已知后；EditorView 空文档，init
   *  推送装载全文）。P2-11（#288）目标资源接线：图片管理器的请求经目标
   *  端口出站（refEdit.message 信封，B 会话按自身身份解析——不再借 A 的
   *  直发通道）；isLiveActive 真实化（内部模式判定，粘贴拦截随之打开）；
   *  图片弹窗按实例注册 B 身份上下文。
   *  P2-10：contentDOM 的 contextmenu 转发根统一菜单（携带 inner 与实例
   *  view——根打开时捕获目标，执行前重验）；实例事务经 onLiveUpdate
   *  通知根联动（快速操作条状态随焦点嵌入的编辑刷新）。 */
  private createLiveInstance(entry: EmbedEntry): void {
    const live = entry.live
    if (!live || !live.portId || !live.docUri || live.instance) {
      return
    }
    // P2-07（#284）可见容器优先：双容器并存（父模式 Live↔Reading 往返，
    // 隐藏容器 handle 不销毁）时，编辑器建在当前父模式对应容器——建在隐藏
    // 容器会让内部 Live 不可见而端口活跃
    const visibleHost = this.context.parentMode?.() ?? 'reading'
    const hostHandle = [...this.active.values()].find((h) => h.entry === entry && h.host === visibleHost)
      ?? [...this.active.values()].find((h) => h.entry === entry)
    if (!hostHandle) {
      return
    }
    const instanceLive = live
    const entryRef = entry
    live.images = new ImageResourceManager({
      isDirectSrc: isDirectImageSrc,
      // P2-11：请求经目标端口（refEdit.message 信封内 image.request，docUri
      // = B 规范 URI——B 会话按自身守卫并以 B 目录/根边界解析；sessionId
      // 沿用端口身份戳记）。结果经 refEdit.push 信封定向回本管理器，与 A
      // 面板广播隔离
      requestHost: (src, reqId) => {
        const session = this.context.session()
        if (!session.sessionId || !session.docUri || !instanceLive.docUri) {
          return
        }
        this.sendRefEditOut(entryRef, {
          kind: 'image.request',
          sessionId: session.sessionId,
          docUri: instanceLive.docUri,
          reqId,
          src,
        })
      },
    })
    // P2-11 实例在场判定：闭包比对实例身份（teardown 置 entry.live = null
    // 或重建实例后，旧闭包不冒充激活态——粘贴守卫/空白格组合规划据此门控）
    const created = new LiveEditorInstance(hostHandle.liveEl, {
      send: (message) => this.sendRefEditOut(entryRef, message),
      persistState: () => undefined, // seq 不跨端口持久化（每次 bind 新面板新 seq 空间）
      images: live.images,
      isLiveActive: (): boolean => entryRef.live?.instance === created,
      initialDark: embedHostDark(),
      onSuspendedChange: () => {
        if (instanceLive.instance) {
          instanceLive.suspended = instanceLive.instance.isSuspended
          this.refreshLiveChrome(entryRef)
        }
      },
      // P2-10：根 chrome 联动（快速操作条状态刷新）——轻量转发，根自行调度
      onViewUpdate: (update) => this.context.onLiveUpdate?.(update),
      // P2-05（#282）输入落定回调：挂起的退出意图重入（检查最新 dirty）
      onLocalInputSettled: () => this.retryPendingClose(entryRef),
      // P2-11 图片弹窗实例上下文：B 管理器 + B 全文 + B 来源导出（打开弹窗
      // 时经 EditorView 反查捕获；sendExport 守卫 entry.live 仍为本实例——
      // 释放后迟到的弹窗操作不产生孤立出站）
      imagePopupSource: {
        images: live.images,
        docSource: () => instanceLive.instance?.getView()?.state.doc.toString() ?? null,
        sendExport: (req) => {
          const session = this.context.session()
          if (entryRef.live !== instanceLive || !session.sessionId || !session.docUri) {
            return
          }
          this.context.send({
            kind: 'image.export',
            sessionId: session.sessionId,
            docUri: session.docUri,
            reqId: req.reqId,
            src: req.src,
            fileName: req.fileName,
            sourceDocUri: instanceLive.fsPath,
          })
        },
      },
    }, [this.embedEscapeKeymap(entryRef)])
    const inst = created
    live.instance = inst
    // P2-11：补发最近设置快照（实例创建晚于面板装载——见 applySettings 注释）
    if (this.lastSettings !== undefined) {
      inst.applySettings(this.lastSettings)
    }
    inst.setSession(live.portId, live.docUri)
    hostHandle.liveEl.appendChild(inst.getView()!.dom)
    // P2-10 嵌入内右键菜单：转发根（根打开统一菜单并捕获实例目标）。
    // 监听随 contentDOM 生命周期（view.destroy 移除 DOM，无需解绑）
    const menuView = inst.getView()!
    const innerRef = entry.inner
    menuView.contentDOM.addEventListener('contextmenu', (event) => {
      if (this.context.onLiveContextMenu) {
        this.context.onLiveContextMenu(innerRef, menuView, event)
      }
    })
    this.applyInternalDom(hostHandle)
    this.refreshModeChrome(hostHandle)
  }

  /** 实例出站包装：编辑通道与资源消息（P2-11）→ refEdit.message（目标
   *  身份 = 端口 B——B 会话按自身 docUri 守卫并以 B 目录/根边界解析执行）；
   *  其余面板级消息不经目标端口，丢弃（宿主侧同款白名单冗余防线） */
  private sendRefEditOut(entry: EmbedEntry, message: WebviewToHost): void {
    const live = entry.live
    const session = this.context.session()
    if (!live || !live.portId || !session.sessionId || !session.docUri) {
      return
    }
    switch (message.kind) {
      case 'edit.request':
      case 'conflict.report':
      case 'composition.changed':
      case 'history.request':
      case 'sync.request':
      case 'conflict.action':
      // P2-11（#288）资源消息经目标端口传身份：链接/双链以 B 为解析语境、
      // 图片粘贴按 B 目录落盘、手动刷新清 B 会话缓存
      case 'link.activate':
      case 'wikilink.activate':
      case 'image.request':
      case 'image.paste':
      case 'refresh.request':
        this.context.send({
          kind: 'refEdit.message',
          panelSessionId: session.sessionId,
          panelDocUri: session.docUri,
          portId: live.portId,
          fsPath: live.fsPath,
          message,
        })
        break
      default:
        break // 面板级消息不经端口（codeblock.copy 等遗留丢弃，归 P2-14 收口核对）
    }
  }

  /** refEdit.push 路由：按 portId 配对驱动实例（释放后的迟到推送查不到
   *  端口即丢弃——「释放后写入禁止」的行为侧）。P2-05：版本推送更新
   *  lastSeenVersion 并驱动模态 stale（确认期间目标被修改须重新确认）；
   *  冲突暂停推送消费挂起的退出意图（suspended guard 使其 no-op——输入
   *  保留，三项冲突处理归 P2-12）。 */
  notifyPush(message: Extract<HostToWebview, { kind: 'refEdit.push' }>): void {
    for (const entry of this.entries.values()) {
      const live = entry.live
      if (!live || live.portId !== message.portId || live.fsPath !== message.fsPath) {
        continue
      }
      const inst = live.instance
      switch (message.message.kind) {
        case 'init':
          live.lastSeenVersion = Math.max(live.lastSeenVersion, message.message.version)
          if (!inst) {
            continue
          }
          inst.handleFullSync(message.message.version, message.message.text, {
            source: 'init',
            restoreAnchor: true,
          })
          this.locateLiveInstance(entry)
          break
        case 'edit.ack':
          if (message.message.ok) {
            live.lastSeenVersion = Math.max(live.lastSeenVersion, message.message.version)
            if (this.closeDialogBelongsTo(entry)) {
              this.markCloseStale()
            }
          }
          if (!inst) {
            continue
          }
          inst.handleEditAck(message.message)
          break
        case 'doc.changed':
          live.lastSeenVersion = Math.max(live.lastSeenVersion, message.message.version)
          if (this.closeDialogBelongsTo(entry)) {
            this.markCloseStale()
          }
          if (!inst) {
            continue
          }
          inst.handleDocChanged(message.message)
          break
        case 'doc.resync':
          live.lastSeenVersion = Math.max(live.lastSeenVersion, message.message.version)
          if (!inst) {
            continue
          }
          inst.handleFullSync(message.message.version, message.message.text, { source: 'resync' })
          live.suspended = false
          // P2-12：暂停解除复位冲突选择状态（收起/在途/失败提示不跨暂停）
          live.conflictChoiceCollapsed = false
          live.conflictComparePending = false
          live.conflictNotice = null
          this.refreshLiveChrome(entry)
          break
        case 'session.suspended':
          live.suspended = true
          // P2-12：新一轮冲突 = 新现场——选择重新展开、提示清空
          live.conflictChoiceCollapsed = false
          live.conflictNotice = null
          // 冲突暂停：挂起的退出意图就地消费（suspended guard 使重入 no-op）
          if (entry.pendingCloseIntent !== null) {
            const intent = entry.pendingCloseIntent
            entry.pendingCloseIntent = null
            this.requestClose(entry, intent)
          }
          if (!inst) {
            continue
          }
          inst.handleSessionSuspended()
          this.refreshLiveChrome(entry)
          break
        // ---- P2-11（#288）资源回包：经信封按 portId 定向路由（reqId 由
        // 各管理器/实例自守卫——释放后迟到推送查不到端口即丢弃，不写 A
        // 或另一 B occurrence）----
        case 'image.paste.result':
          if (!inst) {
            continue
          }
          inst.handleImagePasteResult(message.message)
          break
        case 'image.result':
          live.images?.handleResult(message.message)
          break
        case 'image.invalidate':
          live.images?.invalidate(message.message.srcs)
          break
        case 'refresh.invalidated':
          live.images?.invalidateAll()
          break
      }
    }
  }

  /** init 后定位：会话选区恢复优先（occurrence 记忆），否则标题/块引用
   *  定位到锚点区间起点（P2-03 语义在 Live 侧的落位） */
  private locateLiveInstance(entry: EmbedEntry): void {
    const live = entry.live
    const view = live?.instance?.getView()
    if (!live || !view || live.initialLocated) {
      return
    }
    live.initialLocated = true
    if (entry.liveSelection) {
      const { anchor, head } = entry.liveSelection
      if (anchor <= view.state.doc.length && head <= view.state.doc.length) {
        view.dispatch({ selection: { anchor, head }, scrollIntoView: true })
      }
      return
    }
    const loaded = entry.loaded
    if (loaded && loaded.selector !== undefined && loaded.selector.kind !== 'full' &&
      loaded.range.start > 0 && loaded.range.start <= view.state.doc.length) {
      const at = loaded.range.start
      view.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at) })
    }
  }

  /** refEdit.dirty 路由：按 fsPath 命中全部绑定/绑定中的实例（多
   *  occurrence 一致——目标 dirty 是文档级状态）。P2-05：模态在场时
   *  dirty 翻转 = 确认期间目标被修改（stale 重新确认） */
  notifyDirty(message: Extract<HostToWebview, { kind: 'refEdit.dirty' }>): void {
    for (const entry of this.entries.values()) {
      if (entry.live?.fsPath === message.fsPath) {
        entry.live.dirty = message.dirty
        if (message.dirty && this.closeDialogBelongsTo(entry)) {
          this.markCloseStale()
        }
        this.refreshLiveChrome(entry)
      }
    }
  }

  /** refEdit.save.result 路由：成功清圆点（dirty 推送另发）；失败保留
   *  现场（不误清目标状态） */
  notifySaveResult(message: Extract<HostToWebview, { kind: 'refEdit.save.result' }>): void {
    for (const entry of this.entries.values()) {
      const live = entry.live
      if (!live || live.portId !== message.portId || live.fsPath !== message.fsPath) {
        continue
      }
      if (message.ok) {
        live.dirty = false
        this.refreshLiveChrome(entry)
      }
    }
  }

  /** 销毁目标编辑端口：保存选区（occurrence 会话记忆）→ 销毁实例与图片
   *  管理器 → 出站 unbind → 清内容预算（Reading 重渲染时重新计费）。
   *  P2-10：属该实例的 frontmatter Popover 随实例关闭（浮层单例持有
   *  view——实例释放后迟到输入不得经死视图派发）；
   *  P2-05：该 entry 的在场模态随端口取消（端口释放后确认链路无目标；
   *  离屏回收不弹窗契约不受影响——模态取消不是新弹窗）、挂起意图与
   *  拦截 spec 清空 */
  private teardownLive(entry: EmbedEntry): void {
    const live = entry.live
    if (!live) {
      return
    }
    if (this.closeDialogBelongsTo(entry)) {
      this.closePendingDelete = null
      this.closeCloseDialog()
    }
    entry.pendingCloseIntent = null
    if (this.closePendingDelete?.entry === entry) {
      this.closePendingDelete = null
    }
    if (this.closePendingQuery?.entry === entry) {
      this.closePendingQuery = null
    }
    const view = live.instance?.getView()
    if (view) {
      const sel = view.state.selection.main
      entry.liveSelection = { anchor: sel.anchor, head: sel.head }
      closeFmPopoverForView(view)
    }
    live.instance?.destroy()
    live.images?.dispose()
    entry.live = null
    const session = this.context.session()
    if (live.portId && session.sessionId && session.docUri) {
      this.context.send({
        kind: 'refEdit.unbind',
        panelSessionId: session.sessionId,
        panelDocUri: session.docUri,
        portId: live.portId,
        fsPath: live.fsPath,
      })
    }
    this.budget.clearContent(entry.hostId)
    for (const handle of this.active.values()) {
      if (handle.entry !== entry) {
        continue
      }
      handle.liveEl.textContent = ''
      this.applyInternalDom(handle)
      this.refreshModeChrome(handle)
    }
  }

  /** 头部 live chrome 刷新：dirty 圆点在场性（物理移除——干净态无节点）、
   *  保存入口显隐、暂停态提示（P2-12：暂停现场内嵌三项冲突选择条）、
   *  P2-05 关闭编辑入口显隐（端口在场时） */
  private refreshLiveChrome(entry: EmbedEntry): void {
    for (const handle of this.active.values()) {
      if (handle.entry !== entry) {
        continue
      }
      const live = entry.live
      const portOn = !!live?.portId
      const dirtyOn = portOn && live!.dirty
      handle.closeBtn.style.display = portOn ? '' : 'none'
      let dot = handle.cardEl.querySelector<HTMLElement>(`.${EMBED_CARD_CLASS_NAMES.dirty}`)
      if (dirtyOn) {
        if (!dot) {
          dot = document.createElement('span')
          dot.className = EMBED_CARD_CLASS_NAMES.dirty
          dot.textContent = '·'
          const label = t('embed.dirtyDot')
          dot.setAttribute('aria-label', label)
          dot.setAttribute('data-tooltip', label)
          // 圆点紧随文件名（动作组之前）
          const actions = handle.cardEl.querySelector(`.${EMBED_CARD_CLASS_NAMES.headerActions}`)
          actions?.parentElement?.insertBefore(dot, actions)
        }
      } else {
        dot?.remove()
      }
      handle.saveBtn.style.display = dirtyOn ? '' : 'none'
      if (live?.suspended) {
        handle.stateEl.style.display = ''
        this.buildConflictChoices(handle, entry)
      } else {
        // 非暂停：状态行内容交还 loading/错误分态管理（applyState 重设文案）
        if (handle.display === 'content') {
          handle.stateEl.style.display = 'none'
        }
        if (handle.stateEl.querySelector(`.${EMBED_CARD_CLASS_NAMES.conflict}`)) {
          handle.stateEl.textContent = ''
        }
      }
    }
  }

  /** P2-12（#289）冲突暂停现场的选择条（状态行内重建——文案经 bindLocale
   *  换语言刷新）：暂停提示文字 + 三项（对比并解决／放弃当前版本／取消；
   *  compare 在途禁用）或收起态的「重新选择」入口；失败提示就地呈现。
   *  自绘呈现（真实 button + data-tooltip），不调用 window.alert */
  private buildConflictChoices(handle: EmbedCardHandle, entry: EmbedEntry): void {
    const live = entry.live
    if (!live) {
      return
    }
    handle.stateEl.replaceChildren()
    const pausedText = document.createElement('span')
    bindLocale(pausedText, 'text', 'embed.livePaused')
    handle.stateEl.appendChild(pausedText)
    if (live.conflictNotice) {
      const notice = document.createElement('div')
      notice.className = EMBED_CARD_CLASS_NAMES.conflictNotice
      notice.textContent = live.conflictNotice
      handle.stateEl.appendChild(notice)
    }
    const box = document.createElement('div')
    box.className = EMBED_CARD_CLASS_NAMES.conflict
    const mkBtn = (
      cls: keyof typeof EMBED_CARD_CLASS_NAMES,
      labelKey: MessageKey,
      hintKey: MessageKey,
      onClick: () => void,
    ): HTMLButtonElement => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = EMBED_CARD_CLASS_NAMES[cls]
      bindLocale(btn, 'text', labelKey)
      // 悬停词（tooltip.md 约定：data-tooltip 承载，'title' 目标映射写入）
      bindLocale(btn, 'title', hintKey)
      btn.addEventListener('click', onClick)
      return btn
    }
    if (live.conflictChoiceCollapsed) {
      box.appendChild(mkBtn('conflictReopen', 'embed.conflictReopenLabel', 'embed.conflictReopenHint',
        () => this.onConflictAction(entry, 'reopen')))
    } else {
      const compare = mkBtn('conflictCompare', 'embed.conflictCompareLabel', 'embed.conflictCompareHint',
        () => this.onConflictAction(entry, 'compare'))
      compare.disabled = live.conflictComparePending
      box.appendChild(compare)
      box.appendChild(mkBtn('conflictDiscard', 'embed.conflictDiscardLabel', 'embed.conflictDiscardHint',
        () => this.onConflictAction(entry, 'discard')))
      box.appendChild(mkBtn('conflictCancel', 'embed.conflictCancelLabel', 'embed.conflictCancelHint',
        () => this.onConflictAction(entry, 'cancel')))
    }
    handle.stateEl.appendChild(box)
  }

  /** P2-12（#289）冲突三项动作（选择条按钮 / 键位操作 / 测试钩子同一处理
   *  器）：compare = 出站对比请求（临时副本承载当前输入）；discard = 经端
   *  口出站 sync.request（宿主恢复语义：放弃本次未提交输入并重同步 B，不
   *  回滚整个 B）；cancel = 收起选择（保持暂停与输入）；reopen = 再展开 */
  private onConflictAction(entry: EmbedEntry, action: 'compare' | 'discard' | 'cancel' | 'reopen'): void {
    const live = entry.live
    if (!live || !live.suspended) {
      return // 迟到点击：实例已释放 / 暂停已解除
    }
    switch (action) {
      case 'compare':
        this.conflictCompare(entry)
        break
      case 'discard':
        this.sendRefEditOut(entry, { kind: 'sync.request' })
        break
      case 'cancel':
        live.conflictChoiceCollapsed = true
        this.refreshLiveChrome(entry)
        break
      case 'reopen':
        live.conflictChoiceCollapsed = false
        this.refreshLiveChrome(entry)
        break
    }
  }

  /** P2-12（#289）「对比并解决」：实例当前全文快照（含未提交输入——webview
   *  侧唯一权威来源）经 refEdit.conflictCompare 出站，宿主创建 untitled
   *  临时副本并打开原生对比页（左=临时副本、右=真实 B）。在途防重入；
   *  结果未回/失败前不改变暂停现场 */
  private conflictCompare(entry: EmbedEntry): boolean {
    const live = entry.live
    const session = this.context.session()
    if (!live || !live.suspended || live.conflictComparePending || !live.portId ||
      !session.sessionId || !session.docUri) {
      return false
    }
    const text = live.instance?.getView()?.state.doc.toString()
    if (text === undefined) {
      return false
    }
    live.conflictComparePending = true
    live.conflictNotice = null
    this.refreshLiveChrome(entry)
    this.context.send({
      kind: 'refEdit.conflictCompare',
      panelSessionId: session.sessionId,
      panelDocUri: session.docUri,
      portId: live.portId,
      fsPath: live.fsPath,
      text,
    })
    return true
  }

  /** P2-12（#289）refEdit.conflictCompare.result 路由：ok = 对比页已打开、
   *  输入完成转交 → 恢复由宿主直驱（resumePanel → doc.resync 推送到达时
   *  解除暂停并装载权威全文，旧未提交队列不重放；对比页激活会隐藏本
   *  webview，恢复不依赖 webview 存活，故此处不出站 sync.request——pending
   *  保持到 resync 到达，窗口内防重复对比页）；!ok = 打开/资源失败 → 保
   *  留选择现场并就地提示，可重试 */
  notifyConflictCompareResult(message: Extract<HostToWebview, { kind: 'refEdit.conflictCompare.result' }>): void {
    for (const entry of this.entries.values()) {
      const live = entry.live
      if (!live || live.portId !== message.portId || live.fsPath !== message.fsPath) {
        continue
      }
      if (!message.ok) {
        live.conflictComparePending = false
        live.conflictNotice = t('embed.conflictCompareFailed')
        this.refreshLiveChrome(entry)
      }
      return
    }
  }

  /** 模式按钮 chrome：图标与悬停词指向另一态 */
  private refreshModeChrome(handle: EmbedCardHandle): void {
    const mode = this.effectiveMode(handle.entry)
    const toLive = mode !== 'live'
    const label = t(toLive ? 'embed.modeToLive' : 'embed.modeToReading')
    handle.modeBtn.setAttribute('aria-label', label)
    handle.modeBtn.setAttribute('data-tooltip', label)
    handle.modeBtn.innerHTML = toLive ? MODE_LIVE_ICON : MODE_READING_ICON
  }

  /** P2-04 保存目标（头部入口 / Ctrl+S 焦点路由共用出站） */
  private saveLive(entry: EmbedEntry): void {
    const live = entry.live
    const session = this.context.session()
    if (!live?.portId || !session.sessionId || !session.docUri) {
      return
    }
    this.context.send({
      kind: 'refEdit.save',
      panelSessionId: session.sessionId,
      panelDocUri: session.docUri,
      portId: live.portId,
      fsPath: live.fsPath,
    })
  }

  /** 焦点所在嵌入的目标保存（Ctrl+S 焦点路由；焦点不在任何嵌入编辑器内
   *  返回 false——宿主默认保存 A 不被拦截） */
  focusedLiveSave(): boolean {
    const entry = this.focusedLiveEntry()
    if (!entry) {
      return false
    }
    this.saveLive(entry)
    return true
  }

  /** P2-10 焦点所在嵌入的内部 Live 实例（操作目标解析：焦点在嵌入编辑器
   *  内返回实例，否则 null——根的格式/表格/多光标等操作据此分派 B） */
  focusedLive(): LiveEditorInstance | null {
    const entry = this.focusedLiveEntry()
    return entry?.live?.instance ?? null
  }

  /** P2-10 view → 嵌入实例目标配对（菜单执行前重验：view 仍属于在场端口
   *  才允许执行；实例释放后返回 undefined——已销毁 view 不得接收写事务） */
  liveViewEntry(view: EditorView): EmbedLiveTarget | undefined {
    for (const entry of this.entries.values()) {
      const live = entry.live
      if (live?.instance && live.instance.getView() === view) {
        return {
          fsPath: live.fsPath,
          portId: live.portId,
          docUri: live.docUri,
          suspended: live.suspended,
          instance: live.instance,
        }
      }
    }
    return undefined
  }

  /** P2-10 冲突「放弃当前版本」（conflictDiscard 执行体；P2-12 起与选择条
   *  按钮 / 测试钩子同径 onConflictAction）：焦点嵌入处于冲突暂停时经端口
   *  出站 sync.request（宿主回 doc.resync + 清暂停 = 放弃本次未提交输入版本
   *  并重同步 B，不回滚整个 B——与 P2-05 的文档级丢弃分开建模）。无暂停
   *  现场零操作 */
  focusedConflictDiscard(): boolean {
    const entry = this.focusedLiveEntry()
    const live = entry?.live
    if (!entry || !live || !live.suspended) {
      return false
    }
    this.onConflictAction(entry, 'discard')
    return true
  }

  /** P2-12（#289）「对比并解决」（conflictCompare 键位/命令面板入口）：
   *  焦点嵌入处于冲突暂停时出站对比请求；无暂停现场零操作 */
  focusedConflictCompare(): boolean {
    const entry = this.focusedLiveEntry()
    const live = entry?.live
    if (!entry || !live || !live.suspended) {
      return false
    }
    return this.conflictCompare(entry)
  }

  /** P2-12（#289）「取消」（conflictCancel 键位/命令面板入口）：焦点嵌入
   *  处于冲突暂停时收起选择（保持暂停与输入）；无暂停现场零操作 */
  focusedConflictCancel(): boolean {
    const entry = this.focusedLiveEntry()
    const live = entry?.live
    if (!entry || !live || !live.suspended) {
      return false
    }
    this.onConflictAction(entry, 'cancel')
    return true
  }

  // ---- P2-05（#282）显式关闭确认与输入保护 ----
  // 三径统一入口 requestClose（头部关闭按钮 / 嵌入内 Esc / 删除活跃引用
  // 拦截）：IME 组合中或写入未 ack 先保留实例（挂起意图，落定后重入）；
  // 冲突暂停沿用输入保留（不弹三项模态，P2-12 接入冲突三项）；干净目标
  // 直接完成退出；dirty 时自绘三项模态（默认取消）。后续浮窗（P2-06）
  // 复用同一目标操作与结果。

  /** 关闭请求自增 id（close.query / close.execute 按 reqId 配对） */
  private closeReqSeq = 0
  /** 在场模态上下文（单实例：一次只处理一个退出意图） */
  private closeDialog: {
    entry: EmbedEntry
    intent: CloseIntent
    /** 用户确认基线（webview 侧最新已知版本；stale 时更新） */
    version: number
    relPath: string
    reqId: number
    /** 确认期间目标被修改（重新确认提示在场） */
    stale: boolean
    /** DOM 根（backdrop） */
    root: HTMLElement
    /** 就地提示行（stale / 失败） */
    noticeEl: HTMLElement
  } | null = null
  /** 在途 close.query 的配对上下文（reqId → 发起 entry/intent；回包按
   *  reqId 配对后转模态或直接完成退出） */
  private closePendingQuery: { entry: EmbedEntry; intent: CloseIntent; reqId: number } | null = null
  /** 拦截的删除活跃引用事务（确认后重放到主编辑器；取消即丢弃） */
  private closePendingDelete: {
    entry: EmbedEntry
    /** 被拦事务的变更 spec（A 文档 LF 坐标） */
    changes: { from: number; to: number; insert: string }[]
    /** 拦截时刻的整篇 A 文本快照（重放守卫：拦截以来 A 完全未变才重放） */
    docSnapshot: string
  } | null = null

  /** 显式退出意图统一入口 */
  requestClose(entry: EmbedEntry, intent: CloseIntent): void {
    const live = entry.live
    if (!live || live.status !== 'bound' || !live.portId) {
      return // 无编辑会话（Reading 态）——退出意图无对象
    }
    if (live.suspended) {
      // 冲突暂停沿用输入保留：不弹三项关闭模态（三项冲突处理归 P2-12）；
      // 实例与输入保留（状态行既有暂停提示在场）
      entry.pendingCloseIntent = null
      return
    }
    if (this.closeDialog || (this.closePendingQuery && this.closePendingQuery.entry !== entry)) {
      return // 已有意图在处理（模态在场 / 他 entry 的 query 在途）；同 entry
      // 的在途 query 允许覆盖重发（宿主目标装载失败等无回包形态可自愈）
    }
    if (live.instance?.hasPendingLocalInput()) {
      // IME 组合中／写入未 ack：先保留实例不吞输入，落定后重入检查最新
      // dirty（不把未提交输入误报已保存）
      entry.pendingCloseIntent = intent
      return
    }
    const session = this.context.session()
    if (!session.sessionId || !session.docUri) {
      return
    }
    const reqId = ++this.closeReqSeq
    entry.pendingCloseIntent = null
    this.closePendingQuery = { entry, intent, reqId }
    this.context.send({
      kind: 'refEdit.close.query',
      panelSessionId: session.sessionId,
      panelDocUri: session.docUri,
      portId: live.portId,
      fsPath: live.fsPath,
      intent,
      reqId,
    })
  }

  /** 输入落定回调（LiveEditorInstance.onLocalInputSettled）：重入挂起意图 */
  private retryPendingClose(entry: EmbedEntry): void {
    const intent = entry.pendingCloseIntent
    if (!intent || entry.pendingCloseIntent === null) {
      return
    }
    entry.pendingCloseIntent = null
    this.requestClose(entry, intent)
  }

  /** refEdit.close.state 路由：按在途 query 的 reqId 配对——dirty 弹模态；
   *  干净直接完成退出（回包是宿主权威快照，不依赖 dirty 推送时序） */
  notifyCloseState(message: Extract<HostToWebview, { kind: 'refEdit.close.state' }>): void {
    const pending = this.closePendingQuery
    if (!pending || pending.reqId !== message.reqId) {
      return
    }
    this.closePendingQuery = null
    const { entry, intent } = pending
    const live = entry.live
    if (live && live.fsPath === message.fsPath) {
      live.lastSeenVersion = Math.max(live.lastSeenVersion, message.version)
    }
    if (!message.dirty) {
      // 干净目标：无未保存修改，直接完成退出（不弹模态）
      entry.pendingCloseIntent = null
      this.finishClose(entry, intent)
      return
    }
    this.openCloseDialog(entry, intent, message.version, message.relPath)
  }

  /** refEdit.close.result 路由：closed 完成退出；失败保留现场；stale 重新确认 */
  notifyCloseResult(message: Extract<HostToWebview, { kind: 'refEdit.close.result' }>): void {
    const dialog = this.closeDialog
    if (!dialog || dialog.entry.live?.fsPath !== message.fsPath) {
      return
    }
    if (message.outcome === 'closed') {
      const { entry, intent } = dialog
      this.closeCloseDialog()
      this.finishClose(entry, intent)
      return
    }
    if (message.outcome === 'stale') {
      this.markCloseStale()
      return
    }
    // save-failed / discard-failed：保留现场（模态在场 + 提示行）
    dialog.noticeEl.style.display = ''
    dialog.noticeEl.textContent = t(message.outcome === 'save-failed'
      ? 'embed.closeSaveFailed' : 'embed.closeDiscardFailed')
  }

  /** 打开三项模态（自绘；默认焦点取消——回车/Enter 不会误触保存或丢弃） */
  private openCloseDialog(entry: EmbedEntry, intent: CloseIntent, version: number, relPath: string): void {
    this.closeCloseDialog() // 防御：前一模态残留
    entry.pendingCloseIntent = null
    const root = document.createElement('div')
    root.className = REF_CLOSE_DIALOG_CLASS_NAMES.backdrop
    const box = document.createElement('div')
    box.className = REF_CLOSE_DIALOG_CLASS_NAMES.box
    const titleId = `vsidian-ref-close-title-${++this.closeReqSeq}`
    box.setAttribute('role', 'dialog')
    box.setAttribute('aria-modal', 'true')
    box.setAttribute('aria-labelledby', titleId)
    const title = document.createElement('div')
    title.className = REF_CLOSE_DIALOG_CLASS_NAMES.title
    title.id = titleId
    title.textContent = t('embed.closeDialogTitle')
    const message = document.createElement('div')
    message.className = REF_CLOSE_DIALOG_CLASS_NAMES.message
    message.textContent = t('embed.closeDialogMessage', { file: relPath })
    const scope = document.createElement('div')
    scope.className = REF_CLOSE_DIALOG_CLASS_NAMES.message
    scope.textContent = t('embed.closeDialogDiscardScope')
    const notice = document.createElement('div')
    notice.className = REF_CLOSE_DIALOG_CLASS_NAMES.notice
    notice.style.display = 'none'
    const actions = document.createElement('div')
    actions.className = REF_CLOSE_DIALOG_CLASS_NAMES.actions
    const mkBtn = (kind: 'save' | 'discard' | 'cancel', labelKey: Parameters<typeof t>[0]) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = REF_CLOSE_DIALOG_CLASS_NAMES[kind]
      btn.textContent = t(labelKey)
      btn.addEventListener('click', () => this.onCloseDialogAction(kind))
      return btn
    }
    actions.appendChild(mkBtn('cancel', 'embed.closeCancel'))
    actions.appendChild(mkBtn('save', 'embed.closeSave'))
    actions.appendChild(mkBtn('discard', 'embed.closeDiscard'))
    box.appendChild(title)
    box.appendChild(message)
    box.appendChild(scope)
    box.appendChild(notice)
    box.appendChild(actions)
    root.appendChild(box)
    // 模态键盘语义：Esc = 取消（默认焦点为取消——Enter 落在取消上）
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        this.onCloseDialogAction('cancel')
      }
    })
    document.body.appendChild(root)
    this.closeDialog = {
      entry, intent, version, relPath,
      reqId: 0, // execute 的 reqId 在动作时分配
      stale: false,
      root,
      noticeEl: notice,
    }
    actions.querySelector<HTMLButtonElement>(`.${REF_CLOSE_DIALOG_CLASS_NAMES.cancel}`)?.focus()
  }

  /** 关闭模态（DOM 移除 + 上下文清空） */
  private closeCloseDialog(): void {
    if (!this.closeDialog) {
      return
    }
    this.closeDialog.root.remove()
    this.closeDialog = null
  }

  /** 确认期间目标被修改：stale 提示在场（重新确认；旧确认不丢弃新修改） */
  private markCloseStale(): void {
    const dialog = this.closeDialog
    if (!dialog) {
      return
    }
    dialog.stale = true
    // 基线刷新为 webview 侧最新已知版本（用户在看到提示后再次点击 = 重新
    // 确认；宿主执行时仍比对权威版本——双防线）
    dialog.version = dialog.entry.live?.lastSeenVersion ?? dialog.version
    dialog.noticeEl.style.display = ''
    dialog.noticeEl.textContent = t('embed.closeStale')
  }

  /** 模态按钮动作（真实 click 与测试钩子同一处理器） */
  private onCloseDialogAction(action: 'save' | 'discard' | 'cancel'): void {
    const dialog = this.closeDialog
    if (!dialog) {
      return
    }
    if (action === 'cancel') {
      // 取消：保留引用与当前输入；删除意图不完成（拦截 spec 丢弃，A 原
      // 引用保留）
      this.closePendingDelete = null
      dialog.entry.pendingCloseIntent = null
      this.closeCloseDialog()
      return
    }
    const live = dialog.entry.live
    const session = this.context.session()
    if (!live?.portId || !session.sessionId || !session.docUri) {
      this.closeCloseDialog()
      return
    }
    const reqId = ++this.closeReqSeq
    this.context.send({
      kind: 'refEdit.close.execute',
      panelSessionId: session.sessionId,
      panelDocUri: session.docUri,
      portId: live.portId,
      fsPath: live.fsPath,
      action,
      confirmedVersion: dialog.version,
      reqId,
    })
  }

  /** 完成退出：close/escape 切回 Reading（会话记忆——不随父级联回 Live）；
   *  delete 重放被拦的删除事务（A 写入该删除，端口随引用回收） */
  private finishClose(entry: EmbedEntry, intent: CloseIntent): void {
    if (intent !== 'delete') {
      entry.pendingCloseIntent = null
      if (entry.live) {
        entry.modeOverride = 'reading'
        this.applyInternalMode(entry)
      }
      return
    }
    this.replayPendingDelete()
  }

  /** 重放被拦的删除事务（守卫：拦截以来 A 完全未变才重放——任何漂移都
   *  保守放弃，保持现状由用户重新删除） */
  private replayPendingDelete(): void {
    const pending = this.closePendingDelete
    this.closePendingDelete = null
    if (!pending) {
      return
    }
    pending.entry.pendingCloseIntent = null
    const view = this.context.mainEditorView?.()
    if (!view) {
      return
    }
    const current = view.state.doc.toString()
    if (current !== pending.docSnapshot) {
      return // 模态期间 A 被修改：不重放（保守——引用保留，用户可重删）
    }
    view.dispatch({
      changes: pending.changes,
      annotations: refCloseReplay.of(true),
    })
  }

  /** 删除活跃引用拦截（changeFilter）：变更完整覆盖任一「端口在场的嵌入
   *  引用源区间」时拦截（返回 false 取消变更，事务其余部分照常）并记录
   *  pendingDelete——先确认后写入 A。重放事务带豁免注解放行。 */
  mainDocChangeFilter(): Extension {
    return EditorState.changeFilter.of((tr: Transaction): boolean => {
      if (!tr.docChanged || tr.annotation(refCloseReplay) === true) {
        return true
      }
      // 活跃端口区间（端口在场 = 引用正在编辑；区间即挂载时的源区间）
      const actives: EmbedEntry[] = []
      for (const entry of this.entries.values()) {
        if (entry.live?.portId) {
          actives.push(entry)
        }
      }
      if (actives.length === 0) {
        return true
      }
      let hit: EmbedEntry | null = null
      for (const entry of actives) {
        let matched = false
        tr.changes.iterChanges((fromA, toA) => {
          if (!matched && fromA <= entry.sourceStart && toA >= entry.sourceEnd && toA > fromA) {
            matched = true
          }
        })
        if (matched) {
          hit = entry
          break
        }
      }
      if (!hit) {
        return true // 不相关变更（未覆盖活跃引用区间）：放行
      }
      if (this.closeDialog || this.closePendingDelete) {
        return false // 已有意图在处理：丢弃新命中（先关闭当前模态）
      }
      // 记录被拦事务（变更 spec + 全文快照守卫）并发起删除退出意图
      const changes: { from: number; to: number; insert: string }[] = []
      tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        changes.push({ from: fromA, to: toA, insert: inserted.toString() })
      })
      this.closePendingDelete = {
        entry: hit,
        changes,
        docSnapshot: tr.startState.doc.toString(),
      }
      this.requestClose(hit, 'delete')
      return false
    })
  }

  /** 模态是否属于该 entry（state 路由配对用） */
  private closeDialogBelongsTo(entry: EmbedEntry): boolean {
    return this.closeDialog?.entry === entry
  }

  /** 焦点所在嵌入的显式关闭（键位操作入口 embedClose；无焦点嵌入零操作） */
  closeFocused(): void {
    const active = document.activeElement
    if (!(active instanceof Node)) {
      return
    }
    for (const entry of this.entries.values()) {
      const dom = entry.live?.instance?.getView()?.dom
      if (dom && dom.contains(active)) {
        this.requestClose(entry, 'close')
        return
      }
    }
  }

  /** 嵌入内 Esc：非空选区先收选区（不关闭）；空选区触发显式关闭 */
  private embedEscapeKeymap(entry: EmbedEntry): Extension {
    return Prec.high(keymap.of([{
      key: 'Escape',
      run: (view) => {
        const sel = view.state.selection.main
        if (!sel.empty) {
          // 先收选区（标准编辑器语义：Esc 折叠选区到光标）——默认 keymap
          // 无 Escape 绑定，这里显式处理并拦截
          view.dispatch({ selection: { anchor: sel.head } })
          return true
        }
        this.requestClose(entry, 'escape')
        return true
      },
    }]))
  }

  /** 焦点（document.activeElement）所在嵌入的 entry（无焦点嵌入 null） */
  private focusedLiveEntry(): EmbedEntry | null {

    const active = document.activeElement
    if (!(active instanceof Node)) {
      return null
    }
    for (const entry of this.entries.values()) {
      const dom = entry.live?.instance?.getView()?.dom
      if (dom && dom.contains(active)) {
        return entry
      }
    }
    return null
  }

  /** 焦点所在嵌入的模式切换（键位入口 embedToggleMode；无焦点嵌入编辑器
   *  零操作——P2-04 评估口径保持，Reading 态切换走头部按钮） */
  toggleFocusedMode(): void {
    const entry = this.focusedLiveEntry()
    if (entry) {
      this.toggleMode(entry)
    }
  }

  /** 设置热更转发（Live 扩展组 Compartment 重配随实例） */
  applySettings(values: SettingsPayload | undefined): void {
    // P2-11：留存最近快照——实例创建晚于面板装载（settings.snapshot 在
    // init 后拉取，彼时嵌入实例可能尚未 bind），新实例补发一次避免其设置
    // 回退默认值（图片粘贴总开关等实例内守卫的读取源）
    this.lastSettings = values
    for (const entry of this.entries.values()) {
      entry.live?.instance?.applySettings(values)
    }
  }

  /** 宿主明暗热跟随转发 */
  applyDarkTheme(dark: boolean): void {
    for (const entry of this.entries.values()) {
      entry.live?.instance?.applyDarkTheme(dark)
    }
  }

  /** 观测探针（view.state.readingEmbed 的数据源；host 区分容器） */
  probe(): EmbedCardProbe[] {
    const out: EmbedCardProbe[] = []
    for (const handle of this.active.values()) {
      const fmSection = handle.contentEl.querySelector('.vsidian-hover-fm')
      out.push({
        inner: handle.entry.inner,
        state: handle.display,
        note: handle.note,
        blocks: handle.contentEl.querySelectorAll(`.${READING_CLASS_NAMES.block}`).length,
        scope: handle.entry.loaded?.scope ?? '',
        fm: fmSection ? (handle.entry.content.fmExpanded ? 'expanded' : 'collapsed') : 'none',
        maxHeightPx: Number.parseInt(handle.scrollEl.style.maxHeight, 10) || 0,
        host: handle.host,
        // 浮层包含只读 Reading 子容器，但它的顶层归属不是正文。
        rootHost: handle.cardEl.closest('.vsidian-hover-popup') ? 'hover'
          : handle.cardEl.closest('.vsidian-view-live') ? 'live' : 'reading',
        // #224 内容文本字符数（集成断言未保存修改推送后的刷新可见性）
        textLen: (handle.contentEl.textContent ?? '').length,
        viewStats: handle.content.getStats(),
        internalMode: this.effectiveMode(handle.entry),
        liveBound: handle.entry.live?.portId != null,
        livePortId: handle.entry.live?.portId ?? null,
        liveDocUri: handle.entry.live?.docUri ?? null,
        liveDirty: handle.entry.live?.dirty === true,
        liveSuspended: handle.entry.live?.suspended === true,
        liveTextLen: handle.entry.live?.instance?.getView()?.state.doc.length ?? -1,
        liveImageSrcs: (handle.entry.live?.images?.activeEntries() ?? [])
          .filter((e) => e.appliedSrc !== undefined)
          .map((e) => e.appliedSrc!),
        closeDialog: this.closeDialogBelongsTo(handle.entry)
          ? (this.closeDialog!.stale ? 'stale' : 'open')
          : 'none',
        closeIntent: this.closeDialogBelongsTo(handle.entry)
          ? this.closeDialog!.intent
          : handle.entry.pendingCloseIntent ?? '',
        conflictChoice: handle.entry.live?.suspended
          ? (handle.entry.live.conflictChoiceCollapsed ? 'collapsed' : 'open')
          : 'none',
        conflictComparePending: handle.entry.live?.conflictComparePending === true,
        conflictNotice: handle.entry.live?.conflictNotice != null,
      })
    }
    return out
  }

  budgetStats(): ReturnType<RefExpansionBudget['snapshot']> {
    return this.budget.snapshot()
  }

  /** 悬停根 B 与正文卡树共用面板预算；解析字节在 DOM 挂载前准入。 */
  admitPopupRoot(instanceId: string, loaded: RefLoadedContent, bytes: number): boolean {
    this.budget.setDepthLimit(this.context.maxDepth?.() ?? REF_EXPANSION_LIMITS.defaultDepth)
    if (this.budget.reserve(instanceId, instanceId, 1) !== 'ok' ||
      this.budget.attachContent(instanceId, `${instanceId}\n${loaded.fsPath}\n${loaded.version}`, bytes) !== 'ok') {
      this.budget.release(instanceId)
      return false
    }
    return true
  }

  clearPopupRoot(instanceId: string): void {
    this.budget.clearContent(instanceId)
  }

  releasePopupRoot(instanceId: string): void {
    this.budget.release(instanceId)
  }

  /** 全部释放（syncController dispose）：卡片 DOM、B 视图与状态库。
   *  P2-04：目标端口先于状态库销毁（EditorView 销毁 + unbind 出站） */
  dispose(): void {
    for (const entry of [...this.entries.values()]) {
      if (entry.live) {
        this.teardownLive(entry)
      }
    }
    this.closeCloseDialog()
    this.closePendingDelete = null
    this.closePendingQuery = null
    for (const el of Array.from(this.active.keys())) {
      this.unmountBlock(el)
    }
    // #224 订阅随状态库整体释放（实例订阅计数回落）
    for (const entry of this.entries.values()) {
      entry.content.dispose()
      this.budget.release(entry.hostId)
    }
    this.entries.clear()
    this.heightObserver?.disconnect()
  }

  // ---- P2-04 测试钩子（宿主 embed.test.* 经 syncController 转发；驱动与
  // 用户交互同一处理器链路——模式切换走 toggleMode，输入走实例事务管线）----

  /** 按 inner 与 occurrence 序号切换内部模式（默认第 0 个匹配实例） */
  testSetMode(inner: string, mode: 'reading' | 'live', occurrence = 0): boolean {
    const entry = this.entryOfInner(inner, occurrence)
    if (!entry) {
      return false
    }
    if (this.effectiveMode(entry) !== mode) {
      this.toggleMode(entry)
    }
    return true
  }

  /** 向内部 Live 实例注入一笔输入事务（与真实键入同一管线：
   *  updateListener → recordLocalChangeSet → refEdit.message 出站） */
  typeInEmbed(inner: string, pos: number, text: string, occurrence = 0): boolean {
    const entry = this.entryOfInner(inner, occurrence)
    const view = entry?.live?.instance?.getView()
    if (!entry || !view) {
      return false
    }
    view.dispatch({ changes: { from: pos, to: pos, insert: text } })
    return true
  }

  /** P2-11（#288）手动刷新广播：向全部活跃目标端口发 refresh.request（经
   *  refEdit.message 信封进 B 会话——宿主清 B 解析缓存并推进资源代次后，
   *  refresh.invalidated 经信封回推驱动 live.images 全量失效重挂）。与 A
   *  面板自身的 refresh.request 同发（工具栏刷新按钮的面板级语义：面板内
   *  全部资源刷新，内部 Live 的 B 图不在 A 会话缓存里，不经端口刷不动） */
  refreshLiveResources(): void {
    const session = this.context.session()
    if (!session.sessionId || !session.docUri) {
      return
    }
    for (const entry of this.entries.values()) {
      const live = entry.live
      if (!live?.portId || !live.docUri) {
        continue
      }
      live.refreshReqSeq += 1
      this.context.send({
        kind: 'refEdit.message',
        panelSessionId: session.sessionId,
        panelDocUri: session.docUri,
        portId: live.portId,
        fsPath: live.fsPath,
        message: {
          kind: 'refresh.request',
          sessionId: live.portId,
          docUri: live.docUri,
          reqId: live.refreshReqSeq,
        },
      })
    }
  }

  /** P2-11（#288）测试钩子：向指定嵌入实例注入图片粘贴载荷（与真实 paste
   *  拦截同一实例管线——reqId 分配/在途登记/refEdit.message 信封出站；宿主
   *  测试无法向 webview 派发真实剪贴板事件） */
  testPasteImage(
    inner: string,
    payload: { mime: string; dataBase64: string; fileNameHint?: string },
    occurrence = 0,
  ): boolean {
    const entry = this.entryOfInner(inner, occurrence)
    const instance = entry?.live?.instance
    if (!entry || !instance) {
      return false
    }
    return instance.pasteImageFromTest(payload)
  }

  /** P2-10 测试钩子配套：聚焦指定嵌入的内部 Live 编辑器（可选设置光标/
   *  选区；焦点目标分派按真实 activeElement 判定——与用户点击编辑器同一
   *  语义） */
  focusEmbed(inner: string, pos?: number, to?: number, occurrence = 0): boolean {
    const entry = this.entryOfInner(inner, occurrence)
    const view = entry?.live?.instance?.getView()
    if (!entry || !view) {
      return false
    }
    const anchor = typeof pos === 'number' ? Math.min(pos, view.state.doc.length) : undefined
    if (anchor !== undefined) {
      const head = typeof to === 'number'
        ? Math.min(Math.max(to, 0), view.state.doc.length)
        : anchor
      view.dispatch({ selection: { anchor, head } })
    }
    view.focus()
    return true
  }

  /** 按 inner 与 occurrence 序号保存目标 */
  testSave(inner: string, occurrence = 0): boolean {
    const entry = this.entryOfInner(inner, occurrence)
    if (!entry?.live?.portId) {
      return false
    }
    this.saveLive(entry)
    return true
  }

  /** 按 inner 与 occurrence 序号转发撤销/重做（实例竞态守卫后出站；
   *  与真实键入 Mod-Z 同一请求管线） */
  testHistory(inner: string, op: 'undo' | 'redo', occurrence = 0): boolean {
    const entry = this.entryOfInner(inner, occurrence)
    const instance = entry?.live?.instance
    if (!instance) {
      return false
    }
    return instance.requestHistory(op)
  }

  /** 以给定端口身份伪造一笔 edit.request 出站（宿主侧去重/拒收/暂停的
   *  目标文本断言载体；repeat 同 seq 重复发送） */
  testPortWrite(spec: {
    portId: string
    fsPath: string
    seq: number
    baseVersion: number
    offset: number
    length: number
    text: string
    repeat?: number
  }): boolean {
    const session = this.context.session()
    if (!session.sessionId || !session.docUri) {
      return false
    }
    const message = {
      kind: 'edit.request' as const,
      sessionId: spec.portId,
      docUri: '',
      seq: spec.seq,
      baseVersion: spec.baseVersion,
      changes: [{ offset: spec.offset, length: spec.length, text: spec.text }],
    }
    // docUri 须为端口 B 的规范身份（宿主按会话校验）：从在场端口取同目标值
    for (const entry of this.entries.values()) {
      if (entry.live?.portId === spec.portId && entry.live.fsPath === spec.fsPath) {
        message.docUri = entry.live.docUri ?? ''
        break
      }
    }
    if (!message.docUri) {
      // 端口已释放（迟到写入场景）：docUri 无法从状态库取——宿主在端口
      // 查找阶段即拒收，空串不构成绕过
      message.docUri = ''
    }
    for (let i = 0; i < Math.max(1, spec.repeat ?? 1); i++) {
      this.context.send({
        kind: 'refEdit.message',
        panelSessionId: session.sessionId,
        panelDocUri: session.docUri,
        portId: spec.portId,
        fsPath: spec.fsPath,
        message,
      })
    }
    return true
  }

  private entryOfInner(inner: string, occurrence: number): EmbedEntry | undefined {
    // 测试钩子的 occurrence 序号 = 文档序（sourceStart 排序）在场的第 N 个：
    // entries 的 Map 插入序随 LRU touchEntry 重排（P2-05 实测翻车），且漂移
    // 死键（父文本变更后旧区间 entry，无在场 handle、无 live）会占序号槽位
    // ——两者都让 occurrence:N 指向错误实例
    const matches = [...this.entries.values()]
      .filter((e) => e.inner === inner)
      .filter((e) => [...this.active.values()].some((h) => h.entry === e))
      .sort((a, b) => a.sourceStart - b.sourceStart)
    return matches[occurrence]
  }

  // ---- P2-05（#282）测试钩子（宿主 embed.test.* 经 syncController 转发；
  // 与用户交互同一处理器链路）----

  /** 触发指定嵌入的显式关闭意图（三径同 requestClose） */
  testClose(inner: string, intent: CloseIntent, occurrence = 0): boolean {
    const entry = this.entryOfInner(inner, occurrence)
    if (!entry) {
      return false
    }
    this.requestClose(entry, intent)
    return true
  }

  /** 点击关闭确认模态按钮（真实 click 同一处理器） */
  testDialogAction(action: 'save' | 'discard' | 'cancel'): boolean {
    if (!this.closeDialog) {
      return false
    }
    this.onCloseDialogAction(action)
    return true
  }

  /** P2-12（#289）测试钩子：触发指定嵌入的冲突三项动作（与选择条按钮 /
   *  键位操作同一处理器 onConflictAction；reopen 为收起态的再展开入口） */
  testConflictAction(
    inner: string,
    action: 'compare' | 'discard' | 'cancel' | 'reopen',
    occurrence = 0,
  ): boolean {
    const entry = this.entryOfInner(inner, occurrence)
    if (!entry) {
      return false
    }
    this.onConflictAction(entry, action)
    return true
  }

  /** 在主编辑器派发删除指定引用行的事务（真实事务管线；命中活跃引用
   *  区间走拦截确认链路）。行范围由嵌入源区间所在行推导（整行含换行） */
  testDeleteRef(inner: string, occurrence = 0): boolean {
    const entry = this.entryOfInner(inner, occurrence)
    const view = this.context.mainEditorView?.()
    if (!entry || !view) {
      return false
    }
    const doc = view.state.doc
    if (entry.sourceStart > doc.length || entry.sourceEnd > doc.length) {
      return false
    }
    const line = doc.lineAt(Math.min(entry.sourceStart, doc.length))
    const to = line.number < doc.lines ? line.to + 1 : line.to // 含行尾换行
    view.dispatch({ changes: { from: line.from, to } })
    return true
  }

  /** 设置指定嵌入内部 Live 实例的选区（Esc 分径测试：非空选区先收选区） */
  testSetSelection(inner: string, anchor: number, head: number, occurrence = 0): boolean {
    const view = this.entryOfInner(inner, occurrence)?.live?.instance?.getView()
    if (!view) {
      return false
    }
    view.dispatch({ selection: { anchor, head } })
    return true
  }

  // ---- 内部 ----

  /** P2-07 按 hostId 查在场/状态库 entry（父子链、宿主拒绝与浮层锁的
   *  身份解析——entries 的 Map 键是坐标键，hostId 需遍历；上限 64 条） */
  private entryOfHostId(hostId: string): EmbedEntry | undefined {
    for (const entry of this.entries.values()) {
      if (entry.hostId === hostId) {
        return entry
      }
    }
    return undefined
  }

  /** LRU 触达：重插到 Map 尾部（插入序 = 淘汰序，hoverSourceFsPaths 先例） */
  private touchEntry(entry: EmbedEntry): void {
    this.entries.delete(entry.key)
    this.entries.set(entry.key, entry)
  }

  /** 物理驻留按 occurrence 分开收费；同目标解析缓存命中只省计算与读。 */
  private dataKey(entry: EmbedEntry, loaded: EmbedLoaded): string {
    return `${entry.key}\n${loaded.fsPath}\n${loaded.version}`
  }

  /**
   * 状态库有界淘汰（#224）：语义键条目超上限时按最近触达淘汰死键——
   * 父文档文本变更后漂移的旧键（无在场 handle、长期未挂载）。**仍有效
   * 实例不淘汰**（在场挂载或最近挂载过的 entry 位于 MRU 端；防御性跳过
   * 仍有在场 handle 的条目——视口内的实例状态不受离屏回收与淘汰影响）。
   * 被淘汰条目的目标订阅配对释放。
   */
  private evictEntriesIfNeeded(): void {
    while (this.entries.size > HOVER_REFRESH_DEFAULTS.embedEntryLimit) {
      const victim = this.entries.keys().next().value
      if (victim === undefined) {
        break
      }
      const entry = this.entries.get(victim)!
      const mounted = [...this.active.values()].some((h) => h.entry === entry)
      if (mounted) {
        // 队首仍挂载（全部条目在场的极端文档）：不淘汰有效实例，容忍
        // 超限（在场卡片数由视口窗口约束，实际上界远低于上限）
        break
      }
      this.entries.delete(victim)
      entry.content.dispose()
      this.budget.release(entry.hostId)
    }
  }

  /** #224 目标订阅登记（幂等；成功装载后调用。目标身份变化先释放旧订阅） */
  private watchEntry(entry: EmbedEntry, sourceLeaseId?: string): void {
    if (!entry.loaded) {
      return
    }
    // 同一回包会应用到 Reading/Live 两个 handle；同一 lease 只交接一次。
    if (entry.watchedFsPath === entry.loaded.fsPath &&
      (sourceLeaseId === undefined || entry.watchLeaseId === sourceLeaseId)) {
      return
    }
    const session = this.context.session()
    if (!session.sessionId || !session.docUri) {
      return
    }
    if (entry.watchedFsPath !== null && entry.watchedFsPath !== entry.loaded.fsPath) {
      this.sendUnwatch(entry.watchedFsPath, entry.hostId)
    }
    entry.watchedFsPath = entry.loaded.fsPath
    entry.watchLeaseId = sourceLeaseId ?? null
    this.context.send({
      kind: 'hover.watch',
      sessionId: session.sessionId,
      docUri: session.docUri,
      fsPath: entry.watchedFsPath,
      instanceId: entry.hostId,
      ...(sourceLeaseId !== undefined ? { sourceLeaseId } : {}),
    })
  }

  /** #224 目标订阅释放（dispose / LRU 淘汰；幂等） */
  private unwatchEntry(entry: EmbedEntry): void {
    if (entry.watchedFsPath === null) {
      return
    }
    const fsPath = entry.watchedFsPath
    entry.watchedFsPath = null
    entry.watchLeaseId = null
    this.sendUnwatch(fsPath, entry.hostId)
  }

  /** #224 订阅释放消息出站 */
  private sendUnwatch(fsPath: string, instanceId: string): void {
    const session = this.context.session()
    if (!session.sessionId || !session.docUri) {
      return
    }
    this.context.send({
      kind: 'hover.unwatch',
      sessionId: session.sessionId,
      docUri: session.docUri,
      fsPath,
      instanceId,
    })
  }

  /** 发起装载请求（复用悬停文档访问通道；只读消息不进 edit.request）。
   *  silent = #224 变更刷新的静默重载：不切 loading 态（旧内容保留到新
   *  回包重建，无闪烁）；heal = P1-2 过期回包的自愈重发（循环防护标记） */
  private requestLoad(
    handle: EmbedCardHandle,
    opts?: { silent?: boolean; heal?: boolean; reload?: boolean },
  ): void {
    const session = this.context.session()
    if ((handle.entry.content.source.depth ?? 1) > (this.context.maxDepth?.() ?? REF_EXPANSION_LIMITS.defaultDepth)) {
      this.applyDisplay(handle, 'error', t('hover.errorDepth'))
      return
    }
    this.budget.setDepthLimit(this.context.maxDepth?.() ?? REF_EXPANSION_LIMITS.defaultDepth)
    const admission = this.budget.reserve(handle.entry.content.source.treeId ?? handle.entry.hostId,
      handle.entry.hostId, handle.entry.content.source.depth ?? 1)
    if (admission !== 'ok') {
      this.applyDisplay(handle, 'error', t(admission === 'depth' ? 'hover.errorDepth' : 'hover.errorBudget'))
      return
    }
    if (!session.sessionId || !session.docUri) {
      // 会话未就绪：保持壳与 loading 文案（init 后视图重建触发重挂载发请求）
      this.applyDisplay(handle, 'loading', t('embed.loading'))
      return
    }
    const reqId = ++this.reqSeq
    handle.entry.lastReq = { instanceId: handle.instanceId, reqId }
    handle.entry.healReqId = opts?.heal === true ? reqId : null
    if (!opts?.silent) {
      this.applyDisplay(handle, 'loading', t('embed.loading'))
    }
    this.context.send({
      kind: 'hover.request',
      retainSource: true,
      // P2-03（#280）：changed 失效重载与过期自愈都是已打开实例的重读——
      // 锚点缺失不切成错误页（宿主宽容回全文）；首挂载不带（严格验证）
      ...(opts?.reload === true ? { anchorOptional: true } : {}),
      sessionId: session.sessionId,
      docUri: session.docUri,
      reqId,
      instanceId: handle.instanceId,
      sourceStart: handle.entry.sourceStart,
      sourceEnd: handle.entry.sourceEnd,
      target: handle.entry.inner,
      occurrenceId: handle.entry.hostId,
      ...(handle.entry.content.source.parentInstanceId !== undefined ? { source: {
        parentInstanceId: handle.entry.content.source.parentInstanceId,
        sourceDocUri: handle.entry.content.source.sourceDocUri,
      } } : {}),
    })
  }

  /** 成功回包：缓存 + 渲染（在场路径） */
  private applyResult(handle: EmbedCardHandle, message: Extract<HoverPreviewResult, { ok: true }>): void {
    if ((handle.entry.content.source.depth ?? 1) > (this.context.maxDepth?.() ?? REF_EXPANSION_LIMITS.defaultDepth)) {
      releaseRefSourceLease(this.context, message.sourceLeaseId)
      handle.entry.lastReq = null
      this.applyDisplay(handle, 'error', t('hover.errorDepth'))
      return
    }
    const loaded: EmbedLoaded = {
      fsPath: message.target.fsPath,
      relPath: message.target.relPath,
      scope: message.scope.kind,
      selector: message.scope,
      version: message.version,
      text: message.text,
      range: message.range,
      depth: message.depth,
      expansionPath: message.expansionPath,
    }
    handle.entry.lastReq = null
    handle.entry.lastKnown = { fsPath: loaded.fsPath, version: loaded.version }
    this.applyLoaded(handle, loaded, message.sourceLeaseId)
  }

  /** 装载结果渲染（首载与缓存重挂共用）：B Reading 视图 + 状态恢复。
   *  #224 刷新路径（在场 handle）：滚动位置先取当前值（重挂路径 scrollEl
   *  新建为 0，保留 entry 旧值），重建后经既有 rAF 恢复；目标订阅登记。
   *  P2-04：Reading 呈现**先于端口绑定保留**——bind 回执到达前内容视图
   *  在场（伪宿主/慢宿主不回 bind 时卡片不空白），绑定成功经
   *  applyInternalDom 切换到编辑器容器；生效内部模式为 Live 时随后发起
   *  端口绑定（装载完成的 watch 固定是宿主 bind 校验的前置）。 */
  private applyLoaded(handle: EmbedCardHandle, loaded: EmbedLoaded, sourceLeaseId?: string): void {
    if (handle.scrollEl.scrollTop > 0) {
      handle.entry.content.scrollTop = handle.scrollEl.scrollTop // 刷新前保存
    }
    handle.entry.loaded = loaded
    this.touchEntry(handle.entry) // LRU 触达（仍有效实例）
    const mounted = handle.content.render(loaded, (bytes) => {
      const borrowers = [...this.active.values()].filter((h) => h.entry === handle.entry).length
      if (this.budget.attachContent(handle.entry.hostId, this.dataKey(handle.entry, loaded),
        bytes * Math.max(1, borrowers)) !== 'ok') return false
      handle.entry.parseBytes = bytes
      // 先交接新版本来源，再挂子块；宿主 FIFO 消息中 C 读取不能先于 B 的
      // 新版本关系登记（同 fsPath 未保存刷新尤其需要此顺序）。
      this.watchEntry(handle.entry, sourceLeaseId)
      return true
    })
    if (!mounted) {
      releaseRefSourceLease(this.context, sourceLeaseId)
      handle.entry.loaded = null
      this.budget.release(handle.entry.hostId)
      this.applyDisplay(handle, 'error', t('hover.errorBudget'))
      return
    }
    if (this.effectiveMode(handle.entry) === 'live') {
      this.ensureLivePort(handle.entry)
    }
    // 顶部文件名：装载后为目标根内相对路径
    const titleEl = handle.cardEl.querySelector<HTMLElement>(`.${EMBED_CARD_CLASS_NAMES.title}`)
    if (titleEl) {
      titleEl.textContent = loaded.relPath
    }
    this.applyDisplay(handle, 'content', loaded.relPath)
    // #223 布局联动：loading→content 的高度跳变立即唤醒 CM6 测量（Live
    // 挂载的行高/block widget 高度缓存）；后续异步变化（图片晚到）由
    // ResizeObserver 兜底通知
    this.context.requestMeasure?.()
    // 滚动位置恢复（重挂路径；首载 scrollTop 为 0 无操作）。恢复必须延迟
    // 一帧：宿主元素可能尚未进 DOM（Reading 侧块挂载钩子先于 append、
    // Live 侧 widget toDOM 后续才插入），此刻 scrollEl 无布局（scrollHeight
    // 为 0），同步赋值会被浏览器钳到 0——下一帧宿主已入 DOM，布局可用。
    // 刷新路径（在场 handle）本可同步恢复，但内容重建后的布局重排与
    // rAF 同帧完成，统一走延迟一帧保持两路径一致
    handle.content.restoreScroll(true)
    // #224 目标订阅（成功装载后；幂等——目标身份变化时先释放旧订阅）
  }

  /** 错误分态：就地 i18n 文案（不弹宿主通知；anchor-missing 附锚点原文） */
  private applyError(handle: EmbedCardHandle, reason: Extract<HoverPreviewResult, { ok: false }>['reason'], anchor?: string): void {
    handle.entry.lastReq = null
    this.applyDisplay(handle, 'error', refErrorText(reason, targetOfInner(handle.entry.inner), anchor))
  }

  /** 显示态施加（loading/content 切换与状态行文案） */
  private applyDisplay(handle: EmbedCardHandle, display: 'loading' | 'content' | 'error', note: string): void {
    handle.display = display
    handle.note = note
    // 错误分态挂错误修饰类（主题错误色），loading/content 摘除
    handle.stateEl.classList.toggle(EMBED_CARD_CLASS_NAMES.stateError, display === 'error')
    if (display === 'content') {
      handle.stateEl.style.display = 'none'
      handle.scrollEl.style.display = ''
      // loading 期间外层滚动区无视口，内容只放轻量 spacer；显示后
      // 同步建立首屏窗口，保证紧随其后的 view.state 读到实际内容。
      handle.content.updateNow()
    } else {
      handle.stateEl.style.display = ''
      handle.scrollEl.style.display = 'none'
      handle.stateEl.textContent = note
    }
  }

  /** 卡片内容点击：B 内链接经既有 open 通道（附 sourceDocUri=B——宿主按
   *  B 目录解析与分类）；preventDefault 阻断 webview 原生导航 */
  private handleContentClick(handle: EmbedCardHandle, event: Event): void {
    const hit = event.target as HTMLElement | null
    const anchor = hit?.closest?.('a')
    if (!(anchor instanceof HTMLElement) || !handle.contentEl.contains(anchor)) {
      return
    }
    event.preventDefault()
    const href = anchor.getAttribute('href')
    if (href === null) {
      return // 渲染层已净化的危险链接（无 href）
    }
    const session = this.context.session()
    const loaded = handle.entry.loaded
    if (!session.sessionId || !session.docUri || !loaded) {
      return // 无会话或无 B 身份（loading/错误态无内容链接；防御）
    }
    const linkBlock = anchor.closest<HTMLElement>('[data-vsidian-src-start]')
    const srcStart = Number(linkBlock?.dataset['vsidianSrcStart'] ?? 0)
    const srcEnd = Number(linkBlock?.dataset['vsidianSrcEnd'] ?? srcStart)
    const base = {
      sessionId: session.sessionId,
      docUri: session.docUri,
      srcStart: Number.isInteger(srcStart) ? srcStart : 0,
      srcEnd: Number.isInteger(srcEnd) ? srcEnd : srcStart,
      sourceDocUri: loaded.fsPath,
    }
    if (anchor.classList.contains(WIKILINK_CLASS_NAMES.wikilink)) {
      // 双链与嵌入占位（vsidian-embed-ref 同挂 wikilink 类）：target 原文
      this.context.send({ kind: 'wikilink.activate', target: href, ...base })
    } else {
      this.context.send({ kind: 'link.activate', href, ...base })
    }
  }
}
