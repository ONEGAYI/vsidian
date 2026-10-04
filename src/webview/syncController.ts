// webview 同步控制器：根 chrome（侧栏/顶栏/设置页/查找面板）与宿主消息的
// 单份接收、命令分派（可在 jsdom 下单测）。P2-02（#279）起正文 EditorView
// 的创建/同步/编辑意图/扩展装配提炼至 liveInstance.ts（LiveEditorInstance，
// 下述同步语义的实现随迁，语义注释见该文件）。
//
// 同步模式（依据探索笔记 03 §2/§4/§6）：
// - 本地乐观回显：用户输入立即进入 CM6 状态，同一事务的 changes 以
//   edit.request 发给宿主（不等 ack 即可继续输入）
// - 宿主确认：edit.ack ok 只推进 baseVersion（内容已一致），不重复应用；
//   拒绝时用附带的全文重同步
// - 外部变更：doc.changed 的增量单事务 dispatch（外部注解标记，updateListener
//   对其跳过，防止回发死循环）
// - 撤销/重做：不装 CM6 history 扩展（唯一权威栈在宿主 TextDocument），
//   Mod-Z / Mod-Shift-Z / Mod-Y 经 keymap 转发 history.request，由宿主执行
//   undoRedoService；变更回流走 doc.changed external 路径（无回声）
// - IME 组合缓冲（探索笔记 03 §6 / 05 R1）：组合期间（compositionstart..
//   compositionend）到达的外部增量/全文不直接 dispatch（避免打断组合或破坏
//   组合 DOM），缓冲到组合结束后按最新版本对账；缓冲期间 baseVersion 不
//   推进——组合产生的 edit.request 携带组合前版本，由宿主重定位；
//   flush 时外部增量坐标映射穿过组合编辑（CM6 ChangeSet），区间重叠无法
//   安全映射时进入冲突暂停（#4：保留本地输入并上报，不再全文覆盖丢字）
// - 撤销分段（#153）：撤销粒度由出站节奏决定（每笔 edit.request = 一条
//   宿主 undo 记录），分段从 ack 往返驱动改为时间停顿驱动——连续输入停顿
//   ≥500ms 或用户主动移光标即开新段，组合进行中不切段（原子），组合间按
//   时间分段；触碰暂缓/组合攒批仍承担传输合并但不再决定撤销分段，段边界
//   以切分点记录在暂缓集内，ack 收敛后按切分点拆多笔依次出站
// - 未确认变更集（#4）：本地乐观编辑发出后未收 ack 前，外部增量必须经
//   mapSerGroupThroughCm 平移穿过未确认集再应用（否则静默错位）；区间
//   重叠无法安全映射 → 冲突暂停
// - 冲突暂停（#4）：ok:false ack（conflict/error）且本地有未确认输入时保留
//   本地文本（不重置）、上报 conflict.report 快照、显示横幅、暂停写回
//   （不再发送 edit.request、忽略 doc.changed）；doc.resync 兼作恢复信号
// - seq 持久化：经 bridge.setState 保存，webview 重载（retainContextWhenHidden
//   关闭导致的状态重建）后继续编号，宿主按 seq 幂等去重
import { Annotation, EditorSelection, EditorState, type Extension, type Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { isInlineFormatOp, planFormatOperation, planFormatOperationRanges } from './formatOperations'
import { createQuickActionStateReader } from './quickActionState'
import { TOOLTIP_KEYS_SEPARATOR } from './tooltipCard'
import { FORMAT_OPERATIONS, isFormatOperationId, type FormatOperationId } from '../shared/formatOperations'
import { getEffectiveBindings, type KeybindingOverrides } from '../shared/keybindings'
import { PDF_ZOOM_STEP } from './pdfRender'
import { KeybindingRouter, keyStep } from './keybindingRouter'
import { resolveKeybinding, formatBindingLabel } from '../shared/keybindings'
import { clipboardPlainText, clipboardHasImages, dispatchClipboardPaste, readClipboardSnapshot } from './clipboardPaste'
import { ToastChannel } from './toast'
import { RichPasteDialog } from './richPasteDialog'
import { htmlToMarkdown } from './htmlToMarkdown'
import { planRichPaste, richPasteDistributionMatches } from './richPastePlan'
import type { ClipboardSnapshot } from './clipboardPaste'
import { PASTE_PRESERVE_FORMATTING_KEY, PASTE_ASK_BEFORE_KEY, PASTE_SPLIT_UNDO_KEY } from '../shared/settings'
import { isHttpLinkHref } from '../shared/webLink'
import type { HostToWebview, PasteStage } from '../shared/protocol'
import { chainAt } from '../shared/markdownDoc'
import { LINE_NUMBER_GUTTER_SELECTOR, paintedLineNumbers } from './liveLineNumbers'
import { CODE_CARD_CLASS_NAMES } from './liveCodeCard'
// #314 代码卡扩展族（codeCardConfigFacet/codeCardCopyRequest/codeCardFoldField/
// codeCardHoverReveal/liveCodeCard/CodeCardConfig）的装配位在 liveInstance 的
// extensions()/codeCardExtension()（P2-02 迁移），根仅消费 CODE_CARD_CLASS_NAMES
// （阅读侧卡片增强）；本 import 不再引入扩展族符号
// P2-02（#279）：主正文 Live 实例上下文——创建/同步/编辑意图/扩展装配的
// 最小可复用入口；主面板经此创建唯一正文编辑器。externalSync 注解随同步
// 机制本体迁入 liveInstance，此处 re-export 维持 symbolAutocomplete /
// frontmatterEditing / perfProbe 既有导入路径
import { externalSync, LiveEditorInstance, type LiveEditorInstanceDeps } from './liveInstance'

export { externalSync }
import { decorateReadingCodeCard, isReadingCodeBlock, READING_CODE_NOWRAP_CLASS } from './readingCodeCard'
import {
  isHostToWebview,
  type BacklinkItemPayload,
  type BacklinksProbe,
  type CssProbeReport,
  type FindSessionProbe,
  type ImageSlotProbe,
  type LineGutterAlignment,
  type LineGutterProbe,
  type LiveSyntaxProbe,
  type OccurrenceProbe,
  type OutlineProbe,
  type OutlinkItemPayload,
  type OutlinksProbe,
  type PaintProbe,
  type ReadingSyntaxProbe,
  type SidebarProbe,
  type TypographyInheritSample,
  type TypographyProbe,
  type TypographySample,
  type WebviewToHost,
} from '../shared/protocol'
import {
  READABLE_LINE_WIDTH_DEFAULT,
  READABLE_LINE_WIDTH_KEY,
  READABLE_LINE_WIDTH_MAX,
  READABLE_LINE_WIDTH_MIN,
  EMBED_MAX_HEIGHT_DEFAULT,
  EMBED_MAX_HEIGHT_KEY,
  EMBED_MAX_DEPTH_KEY,
  EMBED_MAX_DEPTH_DEFAULT,
  EMBED_MAX_DEPTH_MIN,
  EMBED_MAX_DEPTH_MAX,
  EMBED_MAX_HEIGHT_MAX,
  EMBED_MAX_HEIGHT_MIN,
  HOVER_ENABLED_KEY,
  HOVER_TARGET_TIP_KEY,
  HOVER_LIVE_DIRECT_KEY,
  HOVER_EXTERNAL_ENABLED_KEY,
  WORD_SEGMENT_ENGINE_DEFAULT,
  WORD_SEGMENT_ENGINE_KEY,
  type SettingsPayload,
} from '../shared/settings'
import { onLocaleChanged, t } from '../shared/i18n'
import { bindLocale, bindLocaleAttrs, bindLocaleFn, bindLocaleFnAttrs, refreshElementLocale } from './localeDom'
import { refreshOnDemandControlLocale } from './localeOnDemand'
import {
  FIND_CLASS_NAMES,
  computeFindMatches,
  computeFindReplaceMatches,
  isFindQueryValid,
  matchIndexFrom,
  planReplaceNext,
  setFindMatches,
  type FindMatch,
} from './findSession'
import { FIND_OPTIONS_DEFAULT, findOptionsEqual, type FindOptions } from '../shared/findOptions'
import { recordDiagnosticMessage, TestDiagnostics } from '../shared/testDiagnostics'
import {
  OCCURRENCE_CLASS_NAMES,
  planExpandWords,
  planSelectAllOccurrences,
  planSelectNext,
  planSelectPrevious,
  planSkipCurrent,
  resolveOccurrenceSeed,
  type OccurrencePlan,
  type OccurrenceRange,
  type OccurrenceSeed,
} from './nextOccurrence'
// 2026-10 浮层锚点跟随：查找面板/选词选项条右缘对齐正文列右缘的计划纯函数
import { planOverlayAnchorRight } from './overlayAnchor'
import { liveDecorationsField, LIVE_CLASS_NAMES, selectionTouchesRange, TaskCheckboxWidget } from './liveDecorations'
import { setOccurrenceHitActive } from './hitReveal'
import { LINK_MOD_CLASS, LINK_CLASS_NAMES, WIKILINK_CLASS_NAMES, activateLinkAtPos, activateLooseLinkAtPos, activateWikilinkAtPos } from './liveLinks'
import { MATH_CLASS_NAMES } from '../shared/math'
import { liveEmbedCardsHostMark, liveEmbedSpansField, setLiveEmbedCards } from './liveEmbed'
// #163 验收反馈：跳转目标高亮（view.locate 通道；半透黄经变量暴露，
// 用户任意操作后消失）
import { anchorFlashClear, anchorFlashRangeOf, anchorFlashSet } from './anchorFlash'
import { resetMermaidLoadFailure, setMermaidDarkTheme } from './mermaidRender'
import {
  closeDiagramPopup,
  DIAGRAM_POPUP_CLASS_NAMES,
  isDiagramPopupOpen,
  openGraphicPopup,
  setDiagramExportSender,
  setDiagramPopupDocSource,
} from './diagramPopup'
import { graphicRendererFor, renderGraphicBlockInto } from './graphicRenderers'
import { GRAPHIC_CHROME_CLASS_NAMES, buildGraphicChrome, markImageFrameSized, wrapGraphicFrame } from './graphicBlockChrome'
import {
  closeImagePopup,
  isImagePopupOpen,
  openImagePopup,
  setImagePopupContext,
  IMAGE_POPUP_EXPORT_CLASS,
} from './imagePopup'
import {
  closeHoverPopup,
  closeHoverPopupIfAnchorWithin,
  hoverPopupProbe,
  hoverPopupSpecOfAnchor,
  hoverPreviewAnchorEnter,
  hoverPreviewAnchorLeave,
  notifyHoverInvalidated,
  invalidateHoverPopupImages,
  isHoverableMdLinkHref,
  notifyHoverImageInvalidate,
  notifyHoverImageResult,
  notifyHoverResult,
  turnHoverPdfPage,
  zoomHoverPdf,
  resetHoverPdfZoom,
  hoverPopupLiveTestAction,
  notifyHoverTokens,
  notifyHoverWatchRejected,
  notifyAppearanceChanged,
  notifyHoverExternalSettings,
  openHoverPopupForKeyboard,
  setHoverPreviewContext,
  type HoverPopupTargetSpec,
} from './hoverPopup'
// #299 跳转目标提示：统一 tooltip 体系承载的目标位置浮标（模块内收敛
// 时序/缓存/联动；上下文与 hoverPopup 同源装配）
import {
  closeTargetTipIfAnchorWithin,
  notifyTargetTipResolved,
  setTargetTipContext,
  targetTipAnchorEnter,
  targetTipAnchorLeave,
  targetTipProbe,
} from './targetTip'
import { EmbedCardManager, EMBED_CARD_CLASS_NAMES } from './embedCard'
import { GRAPHIC_LANG_ATTR, MERMAID_CLASS_NAMES, MERMAID_CODE_ATTR, MERMAID_STATE_ATTR } from '../shared/mermaid'
import { IMAGE_CLASS_NAMES, ImageResourceManager, isDirectImageSrc } from './imageResource'
import { ImageVerifyScheduler } from './imageVerifyScheduler'
import { runPerfProbe } from './perfProbe'
import { runReadingPerfProbe } from './readingProbe'
import { createReadingContainer, prepareReadingImages, READING_CLASS_NAMES } from './readingView'
import { READING_MARKDOWN_CLASS_NAMES } from './readingMarkdown'
import {
  BACKLINK_CLASS_NAMES,
  buildBacklinksDom,
  defaultBacklinkView,
  isBacklinkSortMode,
  renderBacklinksState,
  type BacklinkPanelSnapshot,
  type BacklinkPanelView,
} from './backlinkPanel'
import { allGroupsCollapsed, backlinkGroupKeysOf, type BacklinkSortMode } from './backlinkGrouping'
import {
  OUTLINK_CLASS_NAMES,
  buildOutlinksDom,
  renderOutlinksState,
  type OutlinkPanelSnapshot,
} from './outlinkPanel'
import {
  applyOutlineSliderState,
  buildOutlineDom,
  buildOutlineSlider,
  buildOutlineToolbar,
  extractOutline,
  OUTLINE_CLASS_NAMES,
  type OutlineItem,
  type OutlineSliderDom,
  type OutlineToolbarDom,
  outlineItemsEqual,
  outlineSliderLevelAt,
  renderOutlineItems,
} from './outline'
import {
  migrateOutlineExpanded,
  normalizeOutlineExpandLevel,
  OUTLINE_EXPAND_LEVEL_DEFAULT,
  outlineCollapseFacts,
  type OutlineCollapseFacts,
  outlineExpandAncestors,
  outlineExpandLevelLabel,
  outlineExpandSetForLevel,
  outlineHiddenFlags,
  outlineRepresentativeIndex,
  outlineVisibleIndices,
} from './outlineCollapse'
import {
  outlineFilteredVisibleIndices,
  outlineSearchExpandSet,
  outlineSearchFilter,
  type OutlineSearchFilter,
  outlineSearchRepresentativeIndex,
} from './outlineSearch'
import {
  buildOutlineMenuDom,
  type OutlineMenuCommand,
  OUTLINE_MENU_CLASS_NAMES,
  outlineMenuPosition,
  outlineStructuralExpand,
} from './outlineMenu'
import { applySubmenuFlip, buildMenuDom, CONTEXT_MENU_CLASS_NAMES, focusMenuDom } from './contextMenuDom'
import {
  PLAIN_MENU_LINE,
  buildContextMenuModel,
  contextMenuBlockTargetAt,
  contextMenuHandlerForCommand,
  contextMenuKeybindingHints,
  contextMenuZoneAt,
  menuLineStructureOf,
  menuViewportPosition,
  type ContextMenuBlockTarget,
  type MenuContextSnapshot,
} from '../shared/contextMenu'
import {
  blockIdOfLine,
  collectBlockIds,
  generateBlockId,
  planBlockIdInsertion,
  standaloneBlockIdAfterBlock,
  standaloneBlockIdOf,
} from '../shared/blockId'
import { FM_SCAN_LIMIT, frontmatterRange } from '../shared/markdownDoc'
import {
  outlineChangesOrdered,
  outlineCopyText,
  outlineDeleteChange,
  outlineLevelChanges,
  outlineRenameChange,
} from './outlineSection'
import {
  outlineDropAllowed,
  outlineDropPositionAt,
  outlineMovePlan,
  type OutlineDropPosition,
} from './outlineDrag'
import { locateOutlineIndex } from './outlineLocate'
import { resolveStaleTaskToggle } from './taskToggle'
import { SnippetLoader } from './snippetLoader'
import { applyObsidianDomAlias, OBSIDIAN_ALIAS_PROBES } from '../shared/obsidianAlias'
import { createFontArrivalWatch } from './fontArrival'
import { CHROME_CONTRACT_PROBES } from '../shared/chromeContract'
import { VirtualReadingView } from './readingVirtualView'
import { runCreateTable, runTableEdit } from './tableEditing'
// #237 多光标：上下添加光标命令（@codemirror/commands 内置，webview 本地
// 执行——快捷键路由本地分支与 ui.command 两入口共用 runCursorAdd）
import { addCursorAbove, addCursorBelow } from '@codemirror/commands'
// #239 中文分词词级移动：命令与引擎配置（router 本地分支与 ui.command
// 共用同一命令对象；引擎状态由 settings 快照与 wordSegment.state 两通道
// 汇流驱动）
import {
  activeWordSegmentEngine,
  configureWordSegment,
  cursorWordLeft,
  cursorWordRight,
  selectWordLeft,
  selectWordRight,
  type JiebaResources,
} from './wordMotion'
import { decorateReadingFrontmatterCard, FM_CARD_CLASS_NAMES } from './frontmatterDecorations'
import { FM_POPOVER_CLASS_NAMES, closeFmPopover, isFmPopoverOpen } from './frontmatterPopover'
import { selectTableRegion, tableRegionField } from './tableRegionSelection'
// #292 骨架屏：撤除计划纯逻辑与装配常量（HTML 打点/收编/hold 全局同源）
import {
  planSkeletonExit,
  SKELETON_ELEMENT_ID,
  SKELETON_HOLD_GLOBAL,
  SKELETON_SHOWN_AT_GLOBAL,
} from '../shared/skeletonTiming'

/** rAF 不可用环境（旧 jsdom）退化为短超时（与 readingVirtualView 同款） */
function scheduleFrame(fn: () => void): void {
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => fn())
  } else {
    setTimeout(fn, 16)
  }
}

/** #66 高亮重算去抖（ms）：滚动事件驱动，轻于 250ms 数据刷新链路（只做
 *  定位纯函数 + 一次类切换，不解析文档） */
const OUTLINE_HIGHLIGHT_DEBOUNCE_MS = 100
const VIEWPORT_SAVE_DEBOUNCE_MS = 250
const SELECTION_SAVE_DEBOUNCE_MS = 250

/** #66 防抖动护栏超时（ms）：跳转程序性滚动后一直无滚动事件到达时的
 *  兜底释放（正常路径由首个滚动事件释放） */
const OUTLINE_JUMP_GUARD_MS = 1000



/** 侧栏默认宽度（px）：与 main.css 的 --vsidian-sidebar-width 回退值同源；
 *  默认宽度不写内联变量——保持该变量的公开覆盖入口（外部片段可注入） */
export const SIDEBAR_WIDTH_DEFAULT = 280
/** 侧栏拖宽下限（px）：更窄时工具条/搜索框内容不可用 */
const SIDEBAR_WIDTH_MIN = 200
/** 侧栏拖宽上限（px）：更宽时主编辑区过窄 */
const SIDEBAR_WIDTH_MAX = 720
/** 句柄聚焦时键盘微调步长（px）：ArrowLeft 增宽 / ArrowRight 收窄 */
const SIDEBAR_RESIZE_STEP = 16

/** 拖宽钳制：非有限数回默认（280，走 CSS 回退）；四舍五入取整后钳到区间 */
export function clampSidebarWidth(px: number): number {
  if (!Number.isFinite(px)) {
    return SIDEBAR_WIDTH_DEFAULT
  }
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(px)))
}


/** webview 与宿主的通信通道（由 acquireVsCodeApi 适配） */
export interface VsCodeBridge {
  postMessage(message: unknown): void
  getState<T>(): T | undefined
  setState(state: unknown): void
}

/** 视图模式（#6）：live=实时预览（CM6 编辑），reading=阅读（只读渲染） */
export type ViewMode = 'live' | 'reading'

/** webview 持久化状态（retainContextWhenHidden 关闭时重载恢复） */
interface PersistedState {
  seq?: number
  viewMode?: ViewMode
  /** 最近一次模式锚点（UTF-16 offset）：live=光标主位，reading=锚点块 start */
  anchor?: number
  /** 标签页重载时恢复可见视口：Live 同存中心源码偏移与像素兜底；
   *  独立于模式切换使用的 anchor。 */
  viewport?: { mode: ViewMode; top: number; centerOffset?: number }
  conflictRevision?: number
  /** #53 右侧栏展开态（缺省收起） */
  sidebarOpen?: boolean
  /** #54 大纲面板 active 态（缺省激活：展开侧栏即见大纲，当前唯一面板） */
  outlineActive?: boolean
  /** #67 大纲展开档位（0=No-Expand、1–5=展开到 H1–H5；缺省 5=全展开。
   *  全局记忆（跨文档共享），与 sidebarOpen 同机制；手动折叠集合是
   *  会话内内存态，不持久化（重载回到档位精确展开集） */
  outlineExpandLevel?: number
  /** 侧栏宽度（px，钳制后整数；缺省走 CSS 280px 回退，回到默认时清键）。
   *  全局记忆（跨文档共享），与 sidebarOpen/outlineExpandLevel 同机制 */
  sidebarWidth?: number
  quickActionsOpen?: boolean
  /** #197 反链面板 active 态（缺省关闭——大纲仍是默认面板；与大纲面板
   *  互斥：同域面板区域同一时刻只显示一个） */
  backlinksActive?: boolean
  /** 出链面板 active 态（缺省关闭；与大纲/反链面板互斥） */
  outlinksActive?: boolean
}

/** #238「选下一处相同词」命令事务标记：会话簿记的 updateListener 见到
 *  它即跳过（命令自身改选区不算「选区被外部改变」，不算会话结束信号） */
const occurrenceCmd = Annotation.define<{ occurrence: true }>()

/** 阅读侧独行图判定（#212）：img 所在父元素内它是唯一元素子节点，且
 *  前后兄弟文本节点均为纯空白——等价 live 侧 soloImageLine 的「行内除
 *  图片外全是空白」语义。:only-child 伪类只统计元素子节点（文本节点不
 *  参与），「文字+图」混排段会误命中，故在 JS 完成（P1 评审实证）。
 *  强调包裹（*![图]* / **![图]** / ~~![](i)~~）判非独行——live 侧行内
 *  星号/波浪线是非空白文本、同判非独行，两侧口径一致。 */
const EMPHASIS_TAGS = new Set(['EM', 'STRONG', 'DEL'])

function isSoloImageInParent(img: HTMLImageElement): boolean {
  for (let el: HTMLElement | null = img.parentElement; el; el = el.parentElement) {
    if (EMPHASIS_TAGS.has(el.tagName)) {
      return false
    }
  }
  const parent = img.parentElement
  if (!parent) {
    return false
  }
  let elementCount = 0
  for (const child of parent.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      elementCount += 1
    } else if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim() !== '') {
      return false
    }
  }
  return elementCount === 1
}

export class WebviewSyncController {
  private readonly diagnostics = new TestDiagnostics()
  /** P2-02（#279）：主正文 Live 实例上下文——EditorView 创建/目标文本同步/
   *  编辑意图/实例扩展装配的单一份持有；本类保留根 chrome（侧栏/顶栏/
   *  设置页）、全局消息接收与命令分派。view 经下方 getter 透出（既有
   *  根特性代码的只读消费面不变） */
  private live: LiveEditorInstance | undefined
  private sessionId = ''
  private docUri = ''
  /** 实例存在前的持久化初值兜底（persistState 在 mount 前被调用时使用） */
  private readonly initialSeq: number
  private readonly initialConflictRevision: number

  private get view(): EditorView | undefined {
    return this.live?.getView()
  }

  /** 实例同步态只读投影（根命令门控/探针/persistState 消费） */
  private get suspended(): boolean {
    return this.live?.isSuspended ?? false
  }

  // ---- P2-10（#287）操作目标分派（A/B 焦点路由的单一解析面）----
  /** 打开统一菜单时捕获的目标视图（执行前重验实例存活与文档一致；缺省
   *  = 主正文 view——既有调用方语义不变） */
  private contextMenuView: EditorView | undefined

  /** 焦点所在的嵌入内部 Live 实例（无焦点嵌入 null；编辑器在场才命中——
   *  Reading 态卡片无编辑器天然不命中，阅读零写路径不受影响） */
  private embedFocusedLive(): LiveEditorInstance | null {
    return this.embedCards?.focusedLive() ?? null
  }

  /** 焦点在嵌入内时阻断主文面板/会话类命令（查找/选词/预览——面板会话
   *  绑定主编辑器，实例化前不落 A；键位被吞不执行，命令面板入口因焦点
   *  已离 webview 天然不触发） */
  private embedFocusBlocked(): boolean {
    return this.embedFocusedLive() !== null
  }

  /** 操作目标解析：焦点在嵌入内 → 嵌入实例 B；否则主正文 A。返回 embed
   *  非空表示 view 属于嵌入端口（门控按实例暂停判定，不查宿主 viewMode
   *  ——父 Reading + 嵌入手动 Live 是合法组合） */
  private actionTarget(): { view: EditorView; embed: LiveEditorInstance } | { view: EditorView; embed: null } | null {
    const embed = this.embedFocusedLive()
    if (embed) {
      const view = embed.getView()
      if (view) {
        return { view, embed }
      }
    }
    return this.view ? { view: this.view, embed: null } : null
  }

  /** 目标可编辑门控（A/B 统一）：CM6 只读态共享；A 走宿主 Live + 根暂停，
   *  嵌入走实例暂停（内部 Live 与宿主模式正交） */
  private targetEditable(view: EditorView, embed: LiveEditorInstance | null): boolean {
    if (view.state.readOnly || !view.state.facet(EditorView.editable)) {
      return false
    }
    if (embed) {
      return !embed.isSuspended
    }
    return this.viewMode === 'live' && !this.suspended
  }

  // ---- 视图模式状态（#6）----
  /** 当前模式：不写 TextDocument、不入撤销栈，切换只 dispatch 选区/effects */
  // ---- #292 加载期骨架屏状态 ----
  /** 收编后的骨架元素（撤除后 null；宿主 HTML 未含骨架时保持 null） */
  private skeletonEl: HTMLElement | null = null
  /** 骨架呈现时刻（宿主 HTML 在 main.js 前打点；缺失回退 mount 时刻） */
  private skeletonShownAt: number | null = null
  /** 收编落点（撤除后 null） */
  private skeletonContainer: 'live' | 'reading' | null = null
  private skeletonExitScheduled = false
  private skeletonExitTimer: ReturnType<typeof setTimeout> | undefined
  /** 测试 release 已到（解除宿主 HTML 嵌入的 hold 冻结） */
  private skeletonHoldReleased = false
  private viewMode: ViewMode
  /** 最近模式锚点：live=光标主位；reading=锚点块 src-start（源码位置锚点） */
  private modeAnchor: number | null
  /** 当前模式的滚动像素位置；与 modeAnchor 分开，避免纯滚动移动编辑光标。 */
  private viewport: { mode: ViewMode; top: number; centerOffset?: number } | null
  private viewportSaveTimer: ReturnType<typeof setTimeout> | undefined
  private selectionSaveTimer: ReturnType<typeof setTimeout> | undefined
  private restoringViewport = false
  /** 仅测试注入后开放绘制中心探针，避免常规 view.state 改变 CM6 测量时机。 */
  private viewportProbeEnabled = false
  private readonly flushViewportOnHide = (): void => {
    if (document.visibilityState === 'hidden') this.flushPendingViewState()
  }
  private readonly flushViewportOnPageHide = (): void => this.flushPendingViewState()
  /** live 容器（稳定类名 vsidian-view-live，内含 CM6 编辑器） */
  private liveWrapper: HTMLElement | undefined
  /** 阅读容器（稳定类名 vsidian-view-reading，块级源锚点结构） */
  private readingContainer: HTMLElement | undefined

  // ---- #163 验收反馈：跳转目标高亮的消失监听 ----
  /** 在挂的消失监听卸载器（clearAnchorFlash 时全部执行） */
  private anchorFlashDetachers: Array<() => void> = []
  /** 高亮设置时刻（scroll 事件时间窗过滤——定位自身的程序滚动不误清） */
  private anchorFlashSince = 0
  /** 阅读视图虚拟化控制器（#7：接管阅读容器的按需挂载/回收/锚点定位） */
  private readingView: VirtualReadingView | undefined
  /** #222 嵌入卡片管理器（Reading 正文嵌入：块挂载升级/回收，与 readingView
   *  同生命周期；live 侧嵌入属 #223，不在此装配） */
  private embedCards: EmbedCardManager | undefined
  /** CSS 片段 <link> 装配器（#128）：只增删文档级样式链，不触碰 CM6 状态；
   *  输入/选区/撤销/模式切换与阅读虚拟化天然不受影响（重挂载块继承文档样式） */
  private readonly snippetLoader = new SnippetLoader()
  /** #130 字体晚到补测监听（惰性创建；document.fonts 稳定时机驱动） */
  private snippetFontArrival: ReturnType<typeof createFontArrivalWatch> | undefined
  /** 图片资源管理器（#10：双视图共用；经宿主通道解析工作区图源） */
  private images: ImageResourceManager | undefined
  /** #201 图片周期核验调度器（mount 创建，dispose 释放） */
  private imageVerify: ImageVerifyScheduler | undefined
  /** #201 面板可见性入口（visibilitychange 绑定/摘除成对） */
  private readonly imageVisibilityEntry = (): void => {
    this.imageVerify?.onVisibilityChange()
  }
  private toolbar: HTMLElement | undefined
  /** 语言切换重渲染订阅的退订句柄（#94；dispose 释放） */
  private unsubscribeLocale: (() => void) | undefined
  private quickActionsEl: HTMLElement | undefined
  private quickToggleBtn: HTMLButtonElement | undefined
  /** #141 工具栏双态视图切换按钮（live↔reading；态随 view.mode.set 回流） */
  private viewToggleBtn: HTMLButtonElement | undefined
  /** #208 工具栏刷新嵌入资源按钮（测试钩子 refresh.test.click 的真实点击目标） */
  private refreshBtn: HTMLButtonElement | undefined
  private quickHeadingBtn: HTMLButtonElement | undefined
  private quickHeadingMenu: HTMLElement | undefined
  private quickActionResizeObserver: ResizeObserver | undefined
  private quickActionsOpen: boolean
  private quickBindingHints: (op: FormatOperationId) => readonly string[] = () => []

  // ---- 右侧栏布局状态（#53）----
  /** 水平布局根（稳定类名 vsidian-body）：主编辑区 + 右侧栏 */
  private bodyEl: HTMLElement | undefined
  /** 主编辑区（稳定类名 vsidian-main）：顶栏 + 横幅 + live/reading 容器 */
  private mainEl: HTMLElement | undefined
  /** 右侧栏（稳定类名 vsidian-sidebar）：自有顶栏 + 面板容器（#54 接入内容） */
  private sidebarEl: HTMLElement | undefined
  /** 主编辑区顶栏的侧栏切换按钮（可访问名称随状态变化） */
  private sidebarToggleBtn: HTMLButtonElement | undefined
  /** 侧栏是纯 webview 视图状态（与 viewMode 同类）：切换零写回、
   *  不入撤销栈、不触发出站消息；经 bridge state 持久化（重载恢复） */
  private sidebarOpen: boolean
  /** 侧栏当前宽度（px，钳制后整数；构造期自 PersistedState 恢复）。写
   *  --vsidian-sidebar-width 内联变量驱动 main.css 五处消费点，默认值不写 */
  private sidebarWidth: number
  /** 侧栏左缘的拖宽句柄（role=separator，键盘可达） */
  private sidebarResizerEl: HTMLElement | undefined
  /** 拖宽会话（null=无会话）：pointerdown 武装起点，超 4px 阈值进拖拽态 */
  private sidebarResizeState: {
    pointerId: number
    startX: number
    startWidth: number
    moved: boolean
  } | null = null

  // ---- 反链面板状态（#197；形态改版批次扩出视图态）----
  /** 反链面板 active：纯视图状态（零写回、零出站，bridge state 持久化）；
   *  显隐唯一开关是侧栏容器的 vsidian-backlinks-active 类；与大纲/出链面板互斥 */
  private backlinksActive: boolean
  /** 侧栏顶栏的反链按钮 */
  private backlinksToggleBtn: HTMLButtonElement | undefined
  /** 反链面板容器（内容经 renderBacklinksState 维护） */
  private backlinksPanelEl: HTMLElement | undefined
  /** 最近一次快照（四态渲染依据；面板可见即按此渲染） */
  private backlinksSnapshot: BacklinkPanelSnapshot = { state: 'loading', updating: false, items: [] }
  /** 最近应用的本文档反链快照序号（宿主按文档单调递增；降序帧丢弃） */
  private lastBacklinksSeq = 0
  /** 面板视图状态（排序/搜索/折叠/更多上下文；会话内存即可，不持久化——
   *  规格「已知边界」） */
  private backlinkView: BacklinkPanelView = defaultBacklinkView()
  /** 排序菜单外点关闭监听（菜单打开时挂、关闭时卸） */
  private backlinkSortMenuOutside: ((event: PointerEvent) => void) | null = null

  // ---- 出链面板状态（出链面板批次）----
  /** 出链面板 active：与 backlinksActive 同类的纯视图状态；显隐唯一开关
   *  是侧栏容器的 vsidian-outlinks-active 类；与大纲/反链面板互斥 */
  private outlinksActive: boolean
  /** 侧栏顶栏的出链按钮 */
  private outlinksToggleBtn: HTMLButtonElement | undefined
  /** 出链面板容器（内容经 renderOutlinksState 维护） */
  private outlinksPanelEl: HTMLElement | undefined
  /** 最近一次出链快照（镜像 backlinksSnapshot 语义） */
  private outlinksSnapshot: OutlinkPanelSnapshot = { state: 'loading', updating: false, items: [] }
  /** 最近应用的本文档出链快照序号（宿主按文档单调递增；降序帧丢弃） */
  private lastOutlinksSeq = 0

  // ---- 大纲面板状态（#54）----
  /** 大纲面板 active：与 sidebarOpen 同类的纯视图状态（零写回、零出站、
   *  bridge state 持久化）；面板显隐唯一开关是侧栏容器的 outline-active 类 */
  private outlineActive: boolean
  /** 侧栏顶栏的大纲按钮（可访问名称恒「大纲」，aria-expanded 随 active） */
  private outlineToggleBtn: HTMLButtonElement | undefined
  /** 大纲面板容器（条目内容经 renderOutlineItems 维护） */
  private outlinePanelEl: HTMLElement | undefined
  /** 当前大纲数据（级别 + 文字 + 起始行；序列变化才重建条目 DOM） */
  private outlineItems: OutlineItem[] = []
  /** 大纲计算时的文档快照（Text 不可变，引用比较即版本失效判定） */
  private outlineDoc: Text | null = null
  /** 可见时的大纲去抖刷新句柄（250ms 尾随去抖：定时器随每次调用重置，
   *  连续输入只在停顿 250ms 后解析一次——节流（定时器不重置）会让连续
   *  输入每 250ms 解析一次，不是注释声称的语义） */
  private outlineTimer: ReturnType<typeof setTimeout> | undefined
  /** #66 当前控制域条目索引（视口顶部行向上最近标题；null = 无标题、
   *  首标题之前或无布局环境） */
  private outlineLocatedIndex: number | null = null
  /** 滚动驱动的高亮重算去抖句柄（100ms 尾随：只做定位 + 类切换，轻于
   *  250ms 的数据解析链路） */
  private outlineHighlightTimer: ReturnType<typeof setTimeout> | undefined
  /** #66 防抖动护栏挂起中（跳转程序性滚动期间，滚动联动被吞） */
  private outlineJumpGuarded = false
  /** 护栏超时释放句柄（首个滚动事件先到则取消） */
  private outlineJumpGuardTimer: ReturnType<typeof setTimeout> | undefined

  // ---- 大纲折叠状态（#67）----
  /** 展开档位（0=No-Expand、1–5=展开到 Hn；bridge state 全局记忆） */
  private outlineExpandLevel: number
  /** 展开集合（父节点索引集合）：折叠状态唯一载体——档位切换整体替换、
   *  手动折叠/展开增删单键、滚动 only-expand 并入祖先链、编辑重建迁移 */
  private outlineExpanded: ReadonlySet<number> = new Set()
  /** 父子结构缓存（随 outlineItems 更新；箭头渲染与折叠推导消费） */
  private outlineFacts: OutlineCollapseFacts = { parents: [], hasChildren: [] }
  /** 折叠滑块 DOM（row + 六圆点；档位变化经 applyOutlineSliderState 落类） */
  private outlineSlider: OutlineSliderDom | undefined
  /** 上次高亮滚动落点（代表索引）：同索引不重复滚（用户手动滚面板不打扰） */
  private outlineLastScrolledRep: number | null = null

  // ---- 大纲工具条与标题搜索（#68）----
  /** 工具条 DOM（跳末按钮 + 重置按钮 + 搜索输入框；行为装配在本类） */
  private outlineToolbar: OutlineToolbarDom | undefined
  /** 当前搜索词（工具条输入框实值；空串 = 无过滤。输入即时生效无去抖
   *  ——标题序列量级小，QO 同款按键即时重算口径） */
  private outlineSearchQuery = ''
  /** 进入搜索前的展开集快照（空→非空时机取、清空时原样回放；编辑重建
   *  时随展开集同款迁移；搜索态切档时基准同步为档位精确集） */
  private outlineExpandedBeforeSearch: ReadonlySet<number> | null = null
  /** 搜索过滤缓存（kept/ranges/matchedIndices/noMatch；null = 无搜索态）。
   *  序列重建与词条变化时经 applyOutlineSearch 重算 */
  private outlineSearchState: OutlineSearchFilter | null = null

  // ---- 大纲右键菜单与重命名状态（#69）----
  /** 当前打开的菜单容器（挂侧栏内 absolute；undefined = 未打开） */
  private outlineMenuEl: HTMLElement | undefined
  /** 菜单目标条目索引（items 下标；菜单打开期间的命令分派对象） */
  private outlineMenuIndex: number | null = null
  /** 菜单打开期间菜单数据对应的文档快照（命令执行时 doc 已变则放弃——锚点过期防御） */
  private outlineMenuDoc: Text | null = null
  /** 菜单外点关闭监听（document capture pointerdown；close 时摘除） */
  private outlineMenuDismissPointer: ((e: PointerEvent) => void) | undefined
  /** 菜单 Esc 关闭监听（document capture keydown；close 时摘除） */
  private outlineMenuDismissKey: ((e: KeyboardEvent) => void) | undefined
  /** 两类菜单（大纲/正文统一，互斥打开）共用的还焦宿主：打开菜单夺焦前
   *  记录 activeElement（body 不算，照 frontmatterPopover/diagramPopup 的
   *  prevFocus 模式），关闭时若焦点仍在菜单内则还回——review-loops 修复：
   *  此前硬编码还焦编辑器，大纲搜索框/查找面板输入中途右键再 Esc 会丢焦点 */
  private menuPrevFocus: HTMLElement | null = null

  // ---- 正文统一右键菜单状态（#183 全域接管；blockMenu 已退役并入）----
  /** 当前打开的统一菜单容器（挂 document.body，fixed 定位；undefined = 未打开） */
  private contextMenuEl: HTMLElement | undefined
  /** 菜单目标快照（块区间 + 命中行标题；块链接两项的命令分派对象） */
  private contextMenuTarget: ContextMenuBlockTarget | null = null
  /** 菜单打开时的文档快照（命令执行时 doc 已变则放弃——锚点过期防御） */
  private contextMenuDoc: Text | null = null
  /** 菜单外点关闭监听（document capture pointerdown；close 时摘除） */
  private contextMenuDismissPointer: ((e: PointerEvent) => void) | undefined
  /** 菜单 Esc 关闭监听（document capture keydown；close 时摘除） */
  private contextMenuDismissKey: ((e: KeyboardEvent) => void) | undefined
  /** 剪贴板读（粘贴桥）在途 reqId（陈旧回包丢弃；image.paste 在途表先例） */
  private clipboardReadReqId = 0
  private clipboardReadTarget: { view: EditorView; doc: EditorState['doc']; selection: EditorState['selection']; sessionId: string | undefined; docUri: string; modeRevision: number } | undefined
  private pasteModeRevision = 0
  private toast: ToastChannel | undefined
  private richPasteDialog: RichPasteDialog | undefined
  private pastePreferenceReqId = 0
  private readonly pasteFeedback: { kind: 'rich' | 'fallback' | 'plain-image'; group: string; stage: PasteStage['stage']; landed: boolean }[] = []
  private pasteGroupId = 0
  private recordingPasteStage: PasteStage | undefined
  private recordingPlainPasteFeedback: string | undefined
  private pasteToastKey: string | undefined
  /** 键位覆盖缓存（#183 提示列派生输入；keybindings.snapshot/changed 同步） */
  private keybindingOverrides: KeybindingOverrides = {}
  /** 重命名编辑态的条目索引（null = 无编辑态；条目内容区被 input 替换） */
  private outlineRenameIndex: number | null = null
  /** 重命名打开时的 doc 快照（review-loops C1：提交前锚点防御——外部改写
   *  使行号过期时放弃提交，与菜单/拖拽同口径，防错误行静默替换） */
  private outlineRenameDoc: Text | null = null
  /** #70 拖拽会话态：条目 pointerdown 时记录（源索引 + doc 锚点快照），
   *  超阈值 pointermove 进入拖拽态（moved）并计算落点；pointerup 执行
   *  移动计划写回。null = 无拖拽 */
  private outlineDragState: {
    fromIndex: number
    /** 起始文档快照（终局写回前要求当前 doc 与它内容等价；条目坐标的
     *  派生来源须等价于它，见 onOutlineDragEnd 的条目坐标防线） */
    doc: Text
    /** 起始指针 id（review-loops 第 2 轮：会话只由该指针的移动/释放驱动，
     *  多指针与「窗口外按下后拖入」的异指针事件既不推进也不收尾） */
    pointerId: number
    startX: number
    startY: number
    moved: boolean
    targetIndex: number | null
    position: OutlineDropPosition | null
    /** 当前带落点指示的条目（review-loops C4：增量清除，null = 无指示） */
    hintEl: HTMLElement | null
  } | null = null
  /** #70 拖拽收尾后吞一次面板 click（位移超阈值的拖拽后补发 click 不触发跳转） */
  private outlineSuppressClick = false

  // ---- 查找会话状态（#14；#236 起三开关/替换栏）----
  /** 查找是纯只读视图状态：不写 TextDocument、不入撤销栈；替换是显式
   *  写操作（#236 修订）——经 CM6 事务走标准出站链路（一笔 edit.request =
   *  宿主撤销一次）。匹配基于 webview 全文文本模型（CM6 doc），屏外内容
   *  同样命中 */
  private findPanel: HTMLElement | undefined
  private findInputEl: HTMLInputElement | undefined
  private findCountEl: HTMLElement | undefined
  private findToggleEl: HTMLButtonElement | undefined
  private findCaseBtnEl: HTMLButtonElement | undefined
  private findWordBtnEl: HTMLButtonElement | undefined
  private findRegexpBtnEl: HTMLButtonElement | undefined
  private findReplaceRowEl: HTMLElement | undefined
  private findOpen = false
  /** 首次打开后置位：view.state 从此回报 find 观测（含关闭态 open:false） */
  private findTouched = false
  private findQuery = ''
  /** 三开关（#236 单一事实源 shared/findOptions；经 findOptions.snapshot
   *  与宿主 workspace 级记忆同步，#238 选下一处相同词同源消费） */
  private findOptions: FindOptions = { ...FIND_OPTIONS_DEFAULT }
  /** 查询有效性（正则语法；非法时无匹配、面板红边反馈、替换命令不执行） */
  private findValid = true
  /** 替换栏展开态（替换是 Live 编辑能力：阅读模式恒 false） */
  private findReplaceOpen = false
  /** 替换文本（runFindReplace 经 computeFindReplaceMatches 交给官方展开器展开 $n） */
  private findReplaceText = ''
  private findMatches: FindMatch[] = []
  /** 0 基当前序号（无匹配时无意义） */
  private findIndex = 0
  /** 在选定内容中查找（#241 资产接线：VSCode ☰）：面板局部态、非持久化
   *  （不进 findOptions 三开关通道）——关闭面板或进入阅读即复位；开启时
   *  匹配/导航/替换全部限制在 findRange 内（编辑随文档映射、用户重选跟随） */
  private findInSelection = false
  /** 查找范围（开启时捕获的主选区区间；随 docChanged 映射、select 事务跟随） */
  private findRange: { from: number; to: number } | null = null
  /** 最近一次用户选区（打开面板时的选区 + select 事务更新；findLocate 的
   *  定位选区不计——它是查找自身的产物，不是用户意图）。☰ 的可用性与
   *  范围捕获都以它为准 */
  private findSelectionAnchor: { from: number; to: number } | null = null
  private findInSelectionBtnEl: HTMLButtonElement | undefined
  /** 匹配计算时的文档快照（Text 不可变，引用比较即版本失效判定） */
  private findDoc: Text | null = null
  /** document 级键盘拦截（Mod-F 打开 / Esc 关闭），dispose 时移除 */
  private docKeydown: ((e: KeyboardEvent) => void) | undefined
  /** #217 验收反馈：Ctrl/Cmd 修饰键 keyup 监听（状态类维护；keydown 复用 docKeydown） */
  private docKeyup: ((e: KeyboardEvent) => void) | undefined
  private readonly keybindingRouter: KeybindingRouter
  // ---- #238 选下一处相同词：查找选项条（迷你三按钮）与会话簿记 ----
  /** 选项条 DOM（常驻，显隐由 -open 类控制；非模态：不抢焦点不占弹窗槽） */
  private occurrenceBarEl: HTMLElement | undefined
  private occurrenceCaseBtnEl: HTMLButtonElement | undefined
  private occurrenceWordBtnEl: HTMLButtonElement | undefined
  private occurrenceRegexpBtnEl: HTMLButtonElement | undefined
  /** 会话（对齐 VSCode MultiCursorSession 生命周期）：匹配档与种子词在
   *  创建时决定、存续期间沿用（空选区种子的 override 档不随选区出现漂
   *  移）；ranges 为命令后选区快照——updateListener 检测到非命令事务的
   *  选区变化即结束会话（选项条淡出，下一次按下按新状态重建）。
   *  kind：'add' = Ctrl+D 族（切换开关重建种子）；'all' = 全选型（切换
   *  开关立即按新档重选全部） */
  private occurrenceSession: {
    kind: 'add' | 'all'
    seed: OccurrenceSeed
    ranges: readonly OccurrenceRange[]
  } | null = null
  // ---- 2026-10 浮层锚点跟随：查找面板与选词选项条右缘动态对齐正文列 ----
  /** 锚点观察器（浮层任一在场时挂 .vsidian-main + 正文列元素；关闭即断）。
   *  RO 只报尺寸变化：侧栏开合/窗口缩放（main 宽变）与行宽设置变更
   *  （列宽变）逐帧触发跟随；jsdom 无 ResizeObserver，降级为仅主动同步 */
  private overlayAnchorObserver: ResizeObserver | null = null
  /** 主面板开关闪烁计时（重复按下重启动画；dispose 时清理） */
  private findFlashTimer: ReturnType<typeof setTimeout> | undefined
  private readonly cancelKeybindingOnBlur = () => {
    this.keybindingRouter.cancel()
    this.setLinkModActive(false) // 窗口失焦：修饰键态不可信，回落（keyup 可能丢失）
    // #238 编辑器失焦结束会话（VSCode 口径）：选项条随会话淡出
    this.endOccurrenceSession()
  }

  /** #217 验收反馈：Ctrl/Cmd 修饰键激活态类维护（body.vsidian-mod-link）
   *  ——按住修饰键悬停可跳转链接的下划线与可点击光标反馈。getModifierState
   *  精确处理左右 Ctrl/Cmd 同按与交替（单个 keyup 不代表修饰键全放） */
  private updateLinkModState(e: KeyboardEvent): void {
    this.setLinkModActive(e.getModifierState('Control') || e.getModifierState('Meta'))
  }

  private setLinkModActive(active: boolean): void {
    document.body.classList.toggle(LINK_MOD_CLASS, active)
  }

  // ---- 设置状态（#33）----
  /** 宿主下发的当前设置快照缓存（#34 行号等设置的消费源）；webview 不
   *  持久化设置——每次装载（init）后经 settings.get 向宿主拉取 */
  private settings: SettingsPayload | undefined
  /** 挂载根元素（#175 可读行宽：设置值以内联 CSS 变量落此，全树生效） */
  private rootEl: HTMLElement | undefined

  /** #208 手动刷新：最后发出的 refresh.request reqId（0 = 从未发起）。
   *  宿主回发的 refresh.invalidated 以此配对——刷新后又有新请求时，旧
   *  回执在观测层丢弃（不触发失效重挂）；失效动作本身幂等，防护只挡
   *  迟到回执的误触发 */
  private refreshReqId = 0

  /** #84 阅读侧折叠集合：键 = 块 data-vsidian-src-start（视图态，不持久化；
   *  块卸载重挂载后经此恢复收起形态） */
  private readonly readingCodeFold = new Set<number>()

  /** frontmatter 阅读侧折叠态（视图态，不持久化；FM 单块恒文档首，布尔
   *  承载——live 侧等价物是 CM6 fmFoldField，两视图各自持有不互通，与
   *  代码块折叠同口径） */
  private readingFmFolded = false

  /** #191 阅读侧全文折行开关状态：默认折行（现行行为）；视图态、不跨会话
   *  持久化、不新增设置项（与折叠 chevron 同语义）。关闭态经容器类
   *  vsidian-reading-nowrap 门控 pre 横向滚动；任一块的开关翻转即全文
   *  联动（含大围栏 60 行分片各片——各片独立滚动）。Live 恒折行（CM6
   *  lineWrapping 是编辑器级 facet，无法按块关），不放开关 */
  private readingCodeWrapOn = true

  /** #239 分词引擎资源（wordSegment.state 携带，installed 时非空）：与
   *  settings 快照的引擎选择两通道汇流到 configureWordSegment——到达
   *  顺序不定（设置先到/资源先到都成立），汇流点统一重算 */
  private wordSegmentResources: JiebaResources | null = null

  // ---- 宿主主题明暗自适应（不硬编码 dark，也不硬编码颜色）----
  /** 上次应用值（跳过等值 reconfigure；undefined = 尚未应用过）。CM6
   *  dark 声明的 Compartment 随实例（P2-02），根只存观测值驱动 mermaid */
  private hostDarkApplied: boolean | undefined
  /** body 主题 class 观察者：宿主切换明暗主题时热跟随 */
  private hostThemeObserver: MutationObserver | undefined

  private banner: HTMLElement | undefined

  constructor(private readonly bridge: VsCodeBridge) {
    this.keybindingRouter = new KeybindingRouter({}, (id) => {
      // P2-10：焦点在嵌入内部 Live 内时，绑定主文编辑器状态的面板/会话类
      // 命令（查找、选词、链接预览）不落 A——键位吞掉不执行（面板会话
      // 实例化属后续票；写操作族不受此限，各自经 actionTarget 落 B）
      const embedBlocked = () => this.embedFocusBlocked()
      // #314 粘贴命令经 actionTarget 目标化（嵌入菜单粘贴落 B；正文落根）
      if (id === 'paste' || id === 'pastePlain') {
        this.requestClipboardPaste({ plain: id === 'pastePlain' })
      } else if (id === 'find') { if (!embedBlocked()) this.openFind() }
      else if (id === 'findNext') { if (!embedBlocked()) this.findStep('next') }
      else if (id === 'findPrevious') { if (!embedBlocked()) this.findStep('prev') }

      // #236 查找替换：Ctrl+H 打开面板并展开替换栏；替换操作是面板会话
      // 命令（仅面板开 + live + 合法 query 时执行，本地消化不转发宿主）
      else if (id === 'findReplace') { if (!embedBlocked()) this.openFind(undefined, { replace: true }) }
      else if (id === 'findReplaceNext') { if (!embedBlocked()) this.runFindReplace('next') }
      else if (id === 'findReplaceAll') { if (!embedBlocked()) this.runFindReplace('all') }
      // #221 预览当前链接：纯 webview 域（目标判定与浮层打开都在 webview，
      // 无宿主往返依赖），与命令面板入口（ui.command 回发）共用同一实现
      else if (id === 'hoverPreviewLink') { if (!embedBlocked()) this.previewLinkAtFocus() }
      // #337 PDF 翻页：作用于在场 PDF 悬停浮层（只读；无浮层/翻出界静默）
      else if (id === 'pdfPageNext') { if (!embedBlocked()) turnHoverPdfPage(1) }
      else if (id === 'pdfPagePrev') { if (!embedBlocked()) turnHoverPdfPage(-1) }
      // #339 PDF 缩放：与翻页同款只读浮层域（无 PDF 浮层/触达 scale 上下
      // 限静默无效——受理会谎称缩放生效）
      else if (id === 'pdfZoomIn') { if (!embedBlocked()) zoomHoverPdf(PDF_ZOOM_STEP) }
      else if (id === 'pdfZoomOut') { if (!embedBlocked()) zoomHoverPdf(1 / PDF_ZOOM_STEP) }
      else if (id === 'pdfZoomReset') { if (!embedBlocked()) resetHoverPdfZoom() }
      // #237 上下添加光标：同「本地消化不转发宿主」先例——命令在 webview
      // 的 CM6 上执行（与命令面板 ui.command 回发入口共用 runCursorAdd）
      else if (id === 'addCursorAbove' || id === 'addCursorBelow') this.runCursorAdd(id)
      // #239 词级移动：本地同步执行（词移动高频按键，不出站宿主往返；
      // 命令内部仅 Live 正文可作用——router 的 writes 门控已保证焦点域，
      // 此处只看当前模式）
      else if (id === 'cursorWordLeft') this.runWordMotion(cursorWordLeft)
      else if (id === 'cursorWordRight') this.runWordMotion(cursorWordRight)
      else if (id === 'selectWordLeft') this.runWordMotion(selectWordLeft)
      else if (id === 'selectWordRight') this.runWordMotion(selectWordRight)
      // #238 选下一处相同词族：同「本地消化不转发宿主」先例（选区计划在
      // webview 的 CM6 上执行，与命令面板 ui.command 回发入口共用
      // runOccurrenceSelect）；仅 Live 正文（router writes 门控 + 守卫）
      else if (id === 'findSelectNext') { if (!embedBlocked()) this.runOccurrenceSelect('next') }
      else if (id === 'findSelectPrevious') { if (!embedBlocked()) this.runOccurrenceSelect('prev') }
      else if (id === 'findSkipCurrent') { if (!embedBlocked()) this.runOccurrenceSelect('skip') }
      else if (id === 'findAllOccurrences') { if (!embedBlocked()) this.runOccurrenceSelect('all') }
      else this.bridge.postMessage({ kind: 'keybindings.execute', id })
    })
    const saved = bridge.getState<PersistedState>()
    // seq / conflictRevision 初值：mount 时注入 Live 实例（实例是两者的
    // 权威持有者，persistState 经实例 getter 回读；mount 前持久化用初值）
    this.initialSeq = typeof saved?.seq === 'number' && saved.seq >= 0 ? Math.floor(saved.seq) : 0
    this.initialConflictRevision = typeof saved?.conflictRevision === 'number' && saved.conflictRevision >= 0
      ? Math.floor(saved.conflictRevision) : 0
    this.viewMode = saved?.viewMode === 'reading' ? 'reading' : 'live'
    this.modeAnchor = typeof saved?.anchor === 'number' && saved.anchor >= 0 ? Math.floor(saved.anchor) : null
    this.viewport = saved?.viewport &&
      (saved.viewport.mode === 'live' || saved.viewport.mode === 'reading') &&
      Number.isFinite(saved.viewport.top) && saved.viewport.top >= 0
      ? {
          mode: saved.viewport.mode,
          top: saved.viewport.top,
          ...(typeof saved.viewport.centerOffset === 'number' &&
            Number.isInteger(saved.viewport.centerOffset) && saved.viewport.centerOffset >= 0
            ? { centerOffset: saved.viewport.centerOffset } : {}),
        }
      : null
    this.sidebarOpen = saved?.sidebarOpen === true
    // 宽度恢复：非数值（含缺失）经 clampSidebarWidth 回默认；越界值钳制
    this.sidebarWidth = clampSidebarWidth(saved?.sidebarWidth ?? Number.NaN)
    this.outlineActive = saved?.outlineActive !== false
    this.backlinksActive = saved?.backlinksActive === true
    this.outlinksActive = saved?.outlinksActive === true
    this.outlineExpandLevel = normalizeOutlineExpandLevel(saved?.outlineExpandLevel)
    this.quickActionsOpen = saved?.quickActionsOpen === true
  }

  /** 创建编辑器视图并向宿主发送 ready（HTML 加载完成后调用一次）。
   *  P2-02：正文 EditorView 经 LiveEditorInstance 创建；extraExtensions
   *  透传实例（调用方注入的 defaultKeymap 等照旧生效） */
  mount(parent: HTMLElement, extraExtensions: Extension[] = []): void {
    if (this.view) {
      return
    }
    this.rootEl = parent
    this.toolbar = this.buildToolbar()
    this.quickActionsEl = this.buildQuickActions()
    this.banner = this.buildBanner()
    this.findPanel = this.buildFindPanel()
    this.liveWrapper = document.createElement('div')
    // #132 别名桥：live 容器同时挂 Obsidian 容器/主题三件套
    // （markdown-source-view / mod-cm6 / cm-s-obsidian），片段的容器作用域
    // 与主题容器组合选择器随之命中（清单 container-live 条目）
    this.liveWrapper.className = applyObsidianDomAlias('vsidian-view-live')
    this.readingContainer = createReadingContainer()
    this.readingContainer.tabIndex = 0
    this.readingContainer.style.display = 'none'
    this.images = new ImageResourceManager({
      // http/https 图源直连（可加载性由 webview CSP 决定），其余经宿主解析
      isDirectSrc: isDirectImageSrc,
      requestHost: (src, reqId) => {
        if (!this.sessionId) {
          return // init 前不可能有槽位；防御
        }
        this.bridge.postMessage({
          kind: 'image.request',
          sessionId: this.sessionId,
          docUri: this.docUri,
          reqId,
          src,
        })
      },
      // #201 周期核验调度：首个非直连条目起表、全回收停表
      onBecomeActive: () => this.imageVerify?.onBecomeActive(),
      onBecomeIdle: () => this.imageVerify?.onBecomeIdle(),
    })
    // #201 周期核验：活跃图源合并上报（间隔约 30 秒，工程初值；无活跃停表；
    // 面板恢复可见/宿主唤醒立即核验）。visibilitychange 常驻监听随 dispose 摘除
    this.imageVerify = new ImageVerifyScheduler(
      () =>
        (this.images?.activeEntries() ?? []).map((entry) => ({
          src: entry.src,
          state: entry.state,
          reason: entry.reason,
        })),
      (items) => {
        if (!this.sessionId) {
          return
        }
        this.bridge.postMessage({
          kind: 'image.verify',
          sessionId: this.sessionId,
          docUri: this.docUri,
          items,
        })
      },
    )
    document.addEventListener('visibilitychange', this.imageVisibilityEntry)
    // #218 悬停预览出站上下文：会话身份（init 后可用）+ 只读消息通道。
    // #220 起：B 文档内容自带 B 身份资源管理器（hoverPopup 模块内创建，
    // 图片经 sourceDocUri 走宿主 B 目录解析——不再注入父面板管理器）；
    // codeHighlight 投影面板代码卡片设置的高亮开关（浮层朴素高亮形态）。
    // dispose 时清空（setHoverPreviewContext(null) 同步关浮层）
    setHoverPreviewContext({
      session: () => ({ sessionId: this.sessionId, docUri: this.docUri }),
      send: (message) => {
        recordDiagnosticMessage(this.diagnostics, 'webview.send', message)
        this.bridge.postMessage(message)
      },
      codeHighlight: () => this.live?.codeCardHighlightEnabled ?? true,
      // #298 悬停总开关投影（hover.enabled；门控收敛在 hoverPopup 入口）
      hoverPreviewEnabled: () => this.hoverPreviewEnabled(),
      mountEmbedChild: (parentInstanceId, block, target) =>
        this.embedCards?.mountPopupChild(parentInstanceId, block, target),
      unmountEmbedChild: (block) => this.embedCards?.unmountBlock(block),
      admitRootContent: (instanceId, target, bytes) =>
        this.embedCards?.admitPopupRoot(instanceId, target, bytes) ?? false,
      clearRootContent: (instanceId) => this.embedCards?.clearPopupRoot(instanceId),
      releaseRootContent: (instanceId) => this.embedCards?.releasePopupRoot(instanceId),
      // P2-06（#283）浮窗根引用内部 Live 宿主：目标编辑端口/模式状态机/
      // 显式关闭链路与正文嵌入同源（同一 EmbedCardManager——票面「后续
      // 浮窗使用同一目标操作和结果」）
      mountPopupRoot: (args) => this.embedCards?.mountPopupRoot(args) ?? null,
    })
    // #299 跳转目标提示上下文：与悬停预览同源装配（session/send 同款）；
    // enabled 投影 hover.targetTip（缺省视为开），dispose 清空随会话
    setTargetTipContext({
      session: () => ({ sessionId: this.sessionId, docUri: this.docUri }),
      send: (message) => {
        recordDiagnosticMessage(this.diagnostics, 'webview.send', message)
        this.bridge.postMessage(message)
      },
      enabled: () => this.targetTipEnabled(),
    })
    // #222 嵌入卡片管理器：会话身份 + 只读消息通道 + 高亮/限高投影
    //（dispose 随控制器释放；与 hoverPopup 上下文同源装配）。#223 起
    // requestMeasure 供 Live 挂载的卡片高度联动（内容装载/图片晚到唤醒
    // CM6 视口测量）
    this.embedCards = new EmbedCardManager({
      session: () => ({ sessionId: this.sessionId, docUri: this.docUri }),
      send: (message) => {
        recordDiagnosticMessage(this.diagnostics, 'webview.send', message)
        this.bridge.postMessage(message)
      },
      codeHighlight: () => this.live?.codeCardHighlightEnabled ?? true,
      maxHeightPx: () => this.embedMaxHeightPx(),
      maxDepth: () => this.embedMaxDepth(),
      // P2-04 根面板模式投影：未手动覆盖的根级嵌入内部模式跟随它
      parentMode: () => this.viewMode,
      requestMeasure: () => this.view?.requestMeasure(),
      // P2-10（#287）嵌入内部 Live 的右键菜单转发（打开统一菜单并捕获
      // 实例目标——执行前重验）；实例事务/选区更新联动快速操作条状态刷新
      onLiveContextMenu: (inner, view, event) => this.onEmbedLiveContextMenu(inner, view, event),
      onLiveUpdate: () => {
        if (this.quickActionsOpen) {
          queueMicrotask(() => this.refreshQuickActions())
        }
      },
      // #246 混排占位提升的父文档全文（主文档 Reading 块挂载路径；与
      // readingView.setDocument 同源——CM6 文档即权威文本，LF 坐标一致）
      sourceText: () => this.view?.state.doc.toString() ?? null,
      // P2-05（#282）主编辑器（A 的 Live 视图）：删除活跃引用的拦截重放
      // 在确认后派发（changeFilter 由 rootOwnedViewExtensions 装配）
      mainEditorView: () => this.view ?? null,
    })
    // #223 Live 嵌入 widget 接线（liveEmbed 装饰的 widget 经此挂载共用卡片）
    setLiveEmbedCards(this.embedCards)
    this.readingView = new VirtualReadingView(this.readingContainer, {
      // #10 图片生命周期：块挂载预备装载，卸载释放（src 清空、条目回收）
      // #60 Mermaid：挂载即渲染 pending 容器（DOM 随块卸载 el.remove 释放）
      onBlockMounted: (el) => {
        if (this.images) {
          prepareReadingImages(el, this.images)
        }
        // #111 渲染分派走注册表（登记即继承）：容器语言有管线即渲染，
        // 无管线停留 pending 降级（live 侧由发射 gate 直接降级源码+卡片）
        renderGraphicBlockInto(el)
        this.decorateGraphicChromeBlock(el)
        // #212 图片按钮组：非链接/非表格图片包 frame 挂 popup 按钮
        //（live 侧由 widget 装饰自带；阅读 img 不能有子元素，经 frame 包裹）
        this.decorateImageChromeBlock(el)
        // #84 阅读代码块卡片：挂载即增强（幂等；mermaid 块类不同不命中）
        this.decorateReadingCodeCardBlock(el)
        // frontmatter 折叠：标题栏热区 + chevron（幂等；非 FM 块安全不作为）
        this.decorateReadingFrontmatterBlock(el)
        // #222 嵌入卡片：embed 块升级为引用卡片（占位引用行在此替换；
        // 视口回收由 onBlockUnmounted 释放 B 视图并保留实例状态）
        this.embedCards?.mountBlock(el)
      },
      onBlockUnmounted: (el) => {
        this.images?.detachWithin(el)
        this.embedCards?.unmountBlock(el)
      },
    })
    // 阅读滚动更新锚点（用户滚动即改变"当前位置"语义；短文档滚不动时
    // 锚点保持进入/定位时的值——视口读取无法表达目标，modeAnchor 是权威）。
    // 同一事件驱动 #7 的窗口重算（rAF 合帧）与 #66 的大纲高亮联动
    this.readingContainer.addEventListener('scroll', () => {
      const container = this.readingContainer
      const view = this.readingView
      // 只有真实可滚动（内容超出视口）时才以视口顶块更新锚点：短文档
      // 滚不动，视口读数（首块）无法表达定位目标，保留定位写入的权威锚点
      if (container && view && container.scrollHeight > container.clientHeight + 1) {
        const anchor = view.currentAnchor()
        if (anchor !== null) {
          this.modeAnchor = anchor
        }
      }
      view?.handleScroll()
      this.scheduleViewportSave()
      this.onOutlineScrollSignal()
    })
    // 任务勾选（#9）：阅读模式除任务勾选外只读——checkbox 点击经容器事件
    // 委托处理（虚拟化下元素按需创建/回收，不做逐元素监听）。
    // 点击意图取渲染态锚点（data-vsidian-checked），不受浏览器原生 checkbox
    // 激活时序影响；校验失败（过期锚点）即放弃，保持视图一致
    this.readingContainer.addEventListener('click', (event) => {
      const target = event.target
      if (this.isTaskCheckbox(target)) {
        event.preventDefault() // 取消原生翻转：勾选态由文档驱动重渲染
        this.toggleReadingTask(target)
      }
    })
    this.readingContainer.addEventListener('keydown', (event) => {
      // Enter 在 checkbox 上无原生激活，手动触发；空格依赖原生 click
      const target = event.target
      if (event.key === 'Enter' && this.isTaskCheckbox(target)) {
        event.preventDefault()
        this.toggleReadingTask(target)
      }
    })
    // 阅读链接单击 = 跳转意图上报（#10：执行归宿主；preventDefault 阻断
    // webview 原生导航——相对路径在本 origin 下必然失败且产生控制台噪声）。
    // #11：a.vsidian-wikilink 走双链意图（按名/路径解析），其余走 URI 意图
    this.readingContainer.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null
      const anchor = target?.closest?.('a')
      if (!anchor || !this.readingContainer!.contains(anchor)) {
        return
      }
      event.preventDefault()
      const href = anchor.getAttribute('href')
      if (href === null) {
        return // 渲染层已净化的危险链接（无 href）
      }
      const block = anchor.closest<HTMLElement>('[data-vsidian-src-start]')
      const srcStart = Number(block?.dataset['vsidianSrcStart'] ?? 0)
      const srcEnd = Number(block?.dataset['vsidianSrcEnd'] ?? srcStart)
      if (!this.sessionId) {
        return
      }
      if (anchor.classList.contains(WIKILINK_CLASS_NAMES.wikilink)) {
        // 双链：href 即 `|` 之前的原文 target（markdown-it 规则写入，未 trim）
        this.bridge.postMessage({
          kind: 'wikilink.activate',
          sessionId: this.sessionId,
          docUri: this.docUri,
          target: href,
          srcStart: Number.isInteger(srcStart) ? srcStart : 0,
          srcEnd: Number.isInteger(srcEnd) ? srcEnd : srcStart,
        })
        return
      }
      this.bridge.postMessage({
        kind: 'link.activate',
        sessionId: this.sessionId,
        docUri: this.docUri,
        href,
        srcStart: Number.isInteger(srcStart) ? srcStart : 0,
        srcEnd: Number.isInteger(srcEnd) ? srcEnd : srcStart,
      })
    })
    // #218 悬停预览（Reading 直接悬停）：同一容器上的 mouseover/mouseout
    // 委托（与 click 委托同款 closest 命中，目标口径一致）。#219 起双链与
    // 普通本地 Markdown 链接都接入（a[href] 命中后由 hoverPopup 分流：双链
    // 走 target 原文、普通链接走 linkHref 且外部 scheme 预滤不开浮层）；
    // 命中与否、开闭时延、保活与迟到守卫都在 hoverPopup 模块内收敛。live
    // 侧（Ctrl+悬停）与面板入口属 #221，此处不装配
    this.readingContainer.addEventListener('mouseover', (event) => {
      if (this.viewMode !== 'reading') {
        return
      }
      const target = event.target as HTMLElement | null
      const anchor = target?.closest?.('a[href]')
      if (!(anchor instanceof HTMLElement) || !this.readingContainer!.contains(anchor)) {
        return
      }
      // #299 总开关开 → 浮层将现（原路径，门控在 hoverPopup 入口）；
      // 总开关关 → 浮层不将现，跳转目标提示候选（hoverPopupSpecOfAnchor
      // 同一提取口径：外部 scheme 与非法目标 null 不提示）；spec 经
      // thunk 统一形态（DOM 属性提取廉价，求值时机由 enterHoverOrTip
      // 的两路由决定）
      this.enterHoverOrTip(anchor, () => hoverPopupSpecOfAnchor(anchor, { allowExternalHttp: this.hoverExternalEnabled() }))
    })
    this.readingContainer.addEventListener('mouseout', (event) => {
      const anchor = (event.target as HTMLElement | null)?.closest?.('a[href]')
      if (!(anchor instanceof HTMLElement)) {
        return
      }
      // 锚点内部移动（嵌套行内标记/内嵌图片）不视为离开
      const related = event.relatedTarget
      if (related instanceof Node && anchor.contains(related)) {
        return
      }
      this.leaveHoverAndTip(anchor, related)
    })
    // #53 布局骨架：#app > body(水平) > main(主编辑区：顶栏+横幅+双视图)
    // + sidebar(右侧栏)；findPanel 浮层直接挂 #app（以 #app 为定位包含块；
    // 2026-10 锚点跟随：right 由控制器按正文列右缘测算写内联）
    this.sidebarEl = this.buildSidebar()
    // 拖宽恢复：把构造期恢复的宽度落到侧栏（默认值不写变量，见 applySidebarWidth）
    this.applySidebarWidth(this.sidebarWidth, false)
    this.mainEl = document.createElement('div')
    this.mainEl.className = 'vsidian-main'
    this.mainEl.appendChild(this.toolbar)
    this.mainEl.appendChild(this.quickActionsEl)
    this.mainEl.appendChild(this.banner)
    this.mainEl.appendChild(this.liveWrapper)
    this.mainEl.appendChild(this.readingContainer)
    this.bodyEl = document.createElement('div')
    this.bodyEl.className = 'vsidian-body'
    this.bodyEl.appendChild(this.mainEl)
    this.bodyEl.appendChild(this.sidebarEl)
    parent.appendChild(this.bodyEl)
    parent.appendChild(this.findPanel)
    // #238 查找选项条：与查找面板同定位包含块（parent）、同锚点跟随
    // （2026-10 起右缘对齐正文列，见 syncOverlayAnchors）——与面板互斥
    // 出现（面板开时代之以面板开关闪烁，见 flashFindToggles）
    this.occurrenceBarEl = this.buildOccurrenceBar()
    parent.appendChild(this.occurrenceBarEl)
    this.toast = new ToastChannel(parent)
    this.richPasteDialog = new RichPasteDialog(parent)
    // 侧栏初始态（持久化恢复）落到 DOM 类与按钮可访问名称
    this.applySidebarDom()
    // 大纲面板初始态（持久化恢复）落到侧栏容器类与按钮 aria-expanded
    this.applyOutlineDom()
    this.applyQuickActionsDom()
    // document 捕获先于 VS Code webview 预加载脚本的 window 冒泡转发。
    this.docKeydown = (e: KeyboardEvent) => {
      if (this.richPasteDialog?.isOpen()) return
      // Ctrl/Cmd 按下（非重复）：Live 悬停补触发——指针已在链接上时开浮层
      // （不 preventDefault/stopPropagation：修饰键本身不是键绑定，其余
      // 路由照常）
      if (e.key === 'Control' || e.key === 'Meta') {
        // 修饰键激活态类（下划线/光标反馈）随每次按下重算（repeat 亦幂等）
        this.updateLinkModState(e)
        if (!e.repeat) {
          this.onLiveHoverModifierDown()
        }
      }
      if (e.key === 'Escape' && this.quickHeadingMenu && !this.quickHeadingMenu.hidden) {
        e.preventDefault()
        e.stopPropagation()
        this.keybindingRouter.cancel()
        this.closeQuickHeadingMenu(true)
        return
      }
      if (this.quickHeadingMenu && !this.quickHeadingMenu.hidden &&
          !this.quickHeadingMenu.contains(e.target as Node) &&
          ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
        e.preventDefault()
        e.stopPropagation()
        const options = [...this.quickHeadingMenu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
        const target = e.key === 'ArrowDown' || e.key === 'Home' ? options[0] : options.at(-1)
        target?.focus()
        return
      }
      const target = e.target instanceof Node ? e.target : null
      // P2-04（#281）焦点路由：焦点在嵌入内部 Live 编辑器内时 Ctrl/Cmd+S
      // 只保存目标 B（宿主 TextDocument.save 路线）——capture 阶段
      // preventDefault 使 VSCode 预载脚本不再转发宿主（否则活动面板 A 被
      // 保存）。焦点不在嵌入内则不拦截（宿主默认保存 A 不变）
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's' &&
        this.embedCards?.focusedLiveSave() === true) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      // P2-10（#287）A/B 焦点分派：焦点在嵌入内部 Live 内时，键位路由按
      // 内部模式 live 语义放行写操作（嵌入 Live 与宿主模式正交——父
      // Reading + 手动 Live 下 ctrl+b 等仍可用），allowWrites 同步放开；
      // 写命令的执行体各自经 actionTarget 落到 B（见 runFormatOperation 等）
      const embedFocused = !!target &&
        !!(this.embedCards?.focusedLive()?.getView()?.dom.contains(target) ?? false)
      const liveFocused = this.viewMode === 'live' && !!target &&
        !!this.view?.contentDOM.contains(target) &&
        !this.view.state.readOnly && this.view.state.facet(EditorView.editable) && !this.suspended
      const readingFocused = this.viewMode === 'reading' && !!target &&
        !!this.readingContainer?.contains(target) &&
        !(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)
      const withinEditor = !!target && (target === document ||
        !!this.bodyEl?.contains(target) || !!this.findPanel?.contains(target))
      // 默认普通粘贴保留原生 paste 事件（包括图片文件名/表格处理）。
      // 改绑入口和右键读取多格式快照；两入口最终仍进入同一 paste 处理链。
      // 嵌入焦点（embedFocused）不走根改绑判定——嵌入实例有自身 keymap。
      const step = keyStep(e)
      if (liveFocused && (step === 'ctrl+v' || step === 'meta+v') &&
          resolveKeybinding(this.keybindingOverrides, 'live', step, true).kind === 'command' &&
          getEffectiveBindings(this.keybindingOverrides, 'paste').includes(step)) {
        e.stopPropagation()
        return
      }
      if (this.keybindingRouter.handle(e, embedFocused ? 'live' : this.viewMode,
        liveFocused || readingFocused || withinEditor || embedFocused,
        liveFocused || embedFocused)) return

      if (this.findOpen && e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        this.closeFind()
        return
      }
      // #238 查找选项条 Esc：会话结束、选项条淡出（选区保持——多光标收
      // 敛由下一次 Esc 落到 CM6 simplifySelection，一层消费一次，与浮层
      // 队列同款节奏）。非模态条不抢焦点，Esc 从编辑器正常抵达此处
      if (this.occurrenceSession && e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        this.endOccurrenceSession()
        return
      }
    }
    document.addEventListener('keydown', this.docKeydown, true)
    this.docKeyup = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') {
        this.updateLinkModState(e)
      }
    }
    document.addEventListener('keyup', this.docKeyup, true)
    window.addEventListener('blur', this.cancelKeybindingOnBlur)
    // 宿主明暗主题热跟随：body class 由 VSCode 随主题实时更新
    this.hostThemeObserver = new MutationObserver(() => this.applyHostTheme())
    this.hostThemeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] })
    // P2-02（#279）：主正文经 Live 实例上下文创建——创建/同步/编辑意图/
    //  扩展装配随实例；根 chrome（工具栏/侧栏/查找面板等）仍单份由本类
    //  持有。根特性的三类 updateListener（浮层锚点跟随、#241 查找选区
    //  锚点、#238 选词会话生命周期）经实例 extraExtensions 注入——它们
    //  原寄居 codeCardExtension 仅为装配便利，不随卡片设置热重配语义
    //  变化（listener 次序相对主 updateListener 不变）
    this.live = new LiveEditorInstance(this.liveWrapper, this.liveInstanceDeps(), [
      ...this.rootOwnedViewExtensions(),
      ...extraExtensions,
    ])
    const view = this.live.getView()!
    // #66 大纲高亮联动：live 视口滚动（用户与程序性同源）驱动当前控制域
    // 重算。监听器挂在 view 自身的 scrollDOM 上——dispose 时整棵 view.dom
    // 随 destroy 移除，无需单独解绑
    view.scrollDOM.addEventListener('scroll', () => {
      this.scheduleViewportSave()
      this.onOutlineScrollSignal()
    })
    document.addEventListener('visibilitychange', this.flushViewportOnHide)
    window.addEventListener('pagehide', this.flushViewportOnPageHide)
    // #162 复制块链接：正文 contextmenu 委托（挂在 contentDOM 上——view
    // 生命周期内 DOM 不重建；reading 态 live 容器隐藏天然不触发）。头区/
    // 空行等不接管位不 preventDefault，浏览器原生菜单照常
    view.contentDOM.addEventListener('contextmenu', (event) => {
      this.onContentContextMenu(event)
    })
    // #238 编辑器失焦结束会话：焦点确实离开正文（relatedTarget 不在
    // contentDOM 内——选项条按钮 mousedown 已 preventDefault 保焦，点击
    // 开关不算失焦）；view destroy 时 contentDOM 随之移除，无需解绑
    view.contentDOM.addEventListener('focusout', (event) => {
      const next = event.relatedTarget
      if (!(next instanceof Node) || !view.contentDOM.contains(next)) {
        this.endOccurrenceSession()
      }
    })
    // #221 Live 悬停入口（默认 Ctrl+悬停，设置 hover.liveDirect 开启后
    // 直接悬停）：contentDOM 上的 mouseover/mouseout 委托——目标判定与
    // 点击同一判定族（posAtCoords → 双链 → 树驱动链接 → 宽松链接，围栏/
    // 头区排除与图片排除同口径），开闭时序与保活收敛在 hoverPopup 模块。
    // 锚元素归约到链接装饰 DOM（mark/widget 的 vsidian-link /
    // vsidian-wikilink span——enter/leave 同一归约，保证联合域与重入判定
    // 一致）。Ctrl+点击跳转等既有行为不经此路径（mousedown 通道不变）
    view.contentDOM.addEventListener('mouseover', (event) => {
      if (this.viewMode !== 'live') {
        return
      }
      // 修饰位不足也先记录现场（Ctrl 后按下的补触发依赖它），再决定本次
      // 是否开浮层——「按住 Ctrl 再进入」与「进入后按 Ctrl」两条路径等价
      const hoverAnchor = this.liveHoverAnchorOf(event.target)
      if (hoverAnchor) {
        this.lastLiveHover = { anchor: hoverAnchor }
      }
      const withMod = event.ctrlKey || event.metaKey
      // #299 浮层将现判定并入总开关：总开关关（无论修饰位）或触发条件
      // 未满足（直接悬停关且无 Ctrl）都不开浮层——该悬停成为跳转目标
      // 提示候选（判定族与浮层入口同源，spec null 不提示）。二路由经
      // enterHoverOrTip 单点分派（非链接装饰/无视图零操作）。spec 以
      // thunk 传入（review-loops 第 1 轮懒化）：浮层将现路径立即求值，
      // tip 路径延迟到目标提示的稳定悬停计时到期——默认组合下划过链接
      // 零源码位置解析成本
      if (hoverAnchor) {
        this.enterHoverOrTip(
          hoverAnchor,
          () => this.liveLinkSpecOfAnchor(view, hoverAnchor),
          this.hoverPreviewEnabled() && (this.liveHoverDirect() || withMod),
        )
      }
    })
    view.contentDOM.addEventListener('mouseout', (event) => {
      if (this.viewMode !== 'live') {
        return
      }
      if (this.lastLiveHover) {
        const leaving = this.liveHoverAnchorOf(event.target)
        if (leaving && this.lastLiveHover.anchor === leaving) {
          this.lastLiveHover = null
        }
      }
      this.handleLiveHoverLeave(event)
    })
    // #111 图表导出通道：弹窗 → 宿主另存为（会话字段在此补齐；只读交互，
    // init 前无会话时静默丢弃——按钮在渲染成功后才可点）
    setDiagramExportSender((req) => {
      if (!this.sessionId) {
        return
      }
      this.bridge.postMessage({
        kind: 'diagram.export',
        sessionId: this.sessionId,
        docUri: this.docUri,
        reqId: req.reqId,
        format: req.format,
        fileName: req.fileName,
        content: req.content,
      })
    })
    // #111 弹窗刷新语义：按当前文档全文重定位围栏源码（live CM6 state
    // 是文本权威，阅读视图只是呈现切换，单一注入点两侧共用）
    setDiagramPopupDocSource(() => this.view?.state.doc.toString() ?? null)
    // #212 图片弹窗装配：资源状态机（弹窗 img 是槽位，invalidate/
    // invalidateAll 天然联动）、刷新重定位的文档源、外链判定与导出出站
    //（会话字段在此补齐；init 前无会话时静默丢弃——按钮在 loaded 后才可点）
    setImagePopupContext({
      images: this.images!,
      docSource: () => this.view?.state.doc.toString() ?? null,
      isDirectSrc: isDirectImageSrc,
      sendExport: (req) => {
        if (!this.sessionId) {
          return
        }
        this.bridge.postMessage({
          kind: 'image.export',
          sessionId: this.sessionId,
          docUri: this.docUri,
          reqId: req.reqId,
          src: req.src,
          fileName: req.fileName,
        })
      },
    })
    this.hostDarkApplied = isVscodeDarkBody()
    // #110：初始播种 mermaid 明暗态——MutationObserver 只在 class 变化时
    // 触发，暗色环境从打开起 class 不变，不播种则首渲染按浅色主题出图
    // （浅色墨水叠暗底不可读）
    setMermaidDarkTheme(this.hostDarkApplied)
    this.applyModeDom(this.viewMode)
    // #292 空窗②收编：骨架移入当前模式容器（只盖内容区、与工具栏共存），
    // 在 ready 出站前完成（宿主收到 ready 才发 init 全文）
    this.adoptSkeleton()
    // #94/#101 语言切换：常驻控件文案由 localeDom 注册表单点重刷（各
    // build* 创建点登记）；此处订阅只剩复合工具提示重算与按需控件兜底
    // （首帧装配不触发，installLocale 才通知）
    this.unsubscribeLocale = onLocaleChanged(() => this.applyEditorLocale())
    this.refreshQuickActions()
    this.bridge.postMessage({ kind: 'ready' })
  }

  getView(): EditorView | undefined {
    return this.view
  }

  /** P2-02：Live 实例的依赖注入面——出站/持久化时机/资源来源/模式门控经
   *  此传入，实例不读取本类的 view 或桥状态；根特性联动（横幅、阅读刷新、
   *  模式锚点恢复、事务旁路观测）经可选 hook 随实例内部时机回调 */
  private liveInstanceDeps(): LiveEditorInstanceDeps {
    return {
      send: (message) => {
        this.bridge.postMessage(message)
      },
      persistState: () => this.persistState(),
      images: this.images!,
      isLiveActive: () => this.viewMode === 'live',
      initialDark: isVscodeDarkBody(),
      initialSeq: this.initialSeq,
      initialConflictRevision: this.initialConflictRevision,
      onSuspendedChange: (active) => {
        // #314：进入暂停即作废粘贴现场（对齐 main 版 enterSuspended 开头
        // 的清理——弹窗取消、rich 反馈作废清空；暂停态下粘贴入口全被
        // 守卫拦住，反馈不会再增长，幂等清理无额外影响）
        if (active) {
          this.richPasteDialog?.cancel(false)
          this.invalidatePasteFeedback()
          this.pasteFeedback.length = 0
        }
        this.setBannerVisible(active)
      },
      onExternalTextApplied: () => this.refreshReading(),
      onFullSyncApplied: ({ restoreAnchor }) => {
        this.refreshReading()
        if (restoreAnchor) {
          this.restoreModeAnchorAfterSync()
        }
        // #292：全文落地即读首帧就绪时刻，调度骨架按扫光收束规则撤除（幂等）
        this.scheduleSkeletonExit()
      },
      // #314 粘贴元数据 ack 落定：按事务携带的 paste/组 ID 标记
      // pasteFeedback 的 landed（实例在剥离已确认队列前回读回调）
      onPasteTxnAcked: ({ paste, plainPasteFeedback }) => {
        if (paste) {
          for (const feedback of this.pasteFeedback) {
            if (feedback.group === paste.group && feedback.stage === paste.stage) feedback.landed = true
          }
        }
        if (plainPasteFeedback) {
          for (const feedback of this.pasteFeedback) {
            if (feedback.kind === 'plain-image' && feedback.group === plainPasteFeedback) feedback.landed = true
          }
        }
      },
      // #314 外部增量过版本防线即作废未落定 rich 反馈（doc.changed 的
      // 暂停/暂缓分支同样先作废再退出——语义对齐 main 版）
      onExternalDocArrived: () => this.invalidatePasteFeedback(),
      // #314 外部增量落定：分步撤销选区恢复 + 反馈释放（直发路径每组一次、
      // 组合 flush 收敛时对末组一次；释放守卫随根实例，幂等多调无害）
      onExternalDocSettled: (message) => {
        this.finishPasteHistory(message)
        this.releasePasteFeedback(this.live ?? null)
      },
      // #314 撤销意图进入即作废未落定 rich 反馈
      onHistoryIntent: () => this.invalidatePasteFeedback(),
      // #314 原生 HTML 粘贴接管（实例 paste domEventHandler → 转换管线）
      onRichPasteHtml: ({ view, html, text }) => this.handleRichPasteHtml(view, html, text),
      onViewUpdate: (update) => {
        // #314：本地非粘贴事务作废未落定的 rich 反馈（对齐 main 版
        // updateListener 的 recordingPasteStage 豁免——粘贴 dispatch 由
        // 根级标记豁免，其余本地事务即作废；外部事务不在此列）
        if (!this.recordingPasteStage) {
          for (const tr of update.transactions) {
            if (tr.docChanged && !tr.annotation(externalSync)) {
              this.invalidatePasteFeedback()
              break
            }
          }
        }
        if (this.quickActionsOpen && (update.docChanged || update.selectionSet)) {
          // StateField 已在本事务更新；微任务避免在 CM6 update 生命周期内
          // 再读取旧 EditorView.state。重复信号合并由当前状态读取自然收敛。
          queueMicrotask(() => this.refreshQuickActions())
        }
        if (update.selectionSet && !update.docChanged && this.viewMode === 'live') {
          const anchor = update.state.selection.main.from
          if (anchor !== this.modeAnchor) {
            this.modeAnchor = anchor
            this.scheduleSelectionSave()
          }
        }
        if (!update.docChanged) {
          return
        }
        // 查找会话的匹配失效（#14）：文档变化后标记过期，微任务中重算并
        // 刷新（updateListener 内不可同步 dispatch；纯 effect 事务零写回）
        if (this.findOpen) {
          queueMicrotask(() => {
            if (this.findOpen && this.view) {
              this.findEnsureFresh()
              this.findRender()
            }
          })
        }
        // 大纲刷新调度（#54）：仅面板可见时去抖开启（不可见面板不伴随每次
        // 按键全量解析；数据新鲜度由 view.state 回报前的即时校准兜底）
        if (this.outlineVisible()) {
          this.scheduleOutlineRefresh()
        }
      },
    }
  }

  /** P2-02：根特性的实例事务监听（原寄居 codeCardExtension 的三组
   *  updateListener，等价搬运；随实例装配，不由卡片设置热重配重建） */
  private rootOwnedViewExtensions(): Extension[] {
    return [
      // P2-04（#281）挂卡宿主标记：根正文才发射嵌入卡片装饰（嵌入内部
      // Live 编辑器不挂卡——嵌套结构与命令接线归 P2-10）
      liveEmbedCardsHostMark,
      // P2-05（#282）删除活跃引用拦截：覆盖活跃端口引用区间的 A 事务先
      // 拦截确认（取消不写入 A）；重放事务带豁免注解放行
      ...(this.embedCards ? [this.embedCards.mainDocChangeFilter()] : []),
      // P2-07（#284）嵌入实例键迁移：A 的事务使容器内嵌入区间平移时，把
      // 嵌入实例的状态库键迁移到新坐标——widget 随后按新坐标重挂即命中
      // 迁移实例，装载缓存/内部 Live 端口/选区记忆保持（前后文打字零重载
      // 零重绑）。P2-08（#285）起传入变更前 doc：区间被整段覆盖重写时启用
      // 保文本重定位判定（表格列/行移动等结构编辑的实例迁移）。transactionExtender
      // 在 docView 更新（widget toDOM）前执行，且被 changeFilter 拒绝的事务
      // 不会到达——无「取消事务已迁移」错配
      EditorState.transactionExtender.of((tr) => {
        if (this.embedCards && tr.docChanged) {
          this.embedCards.remapSources(tr.changes, tr.startState.doc)
        }
        return null
      }),
      // 2026-10 浮层锚点跟随：编辑事务轻量补同步——RO 只感知尺寸变化，
      // 打字改行号位数等「仅移动正文列位置、列宽不变」的场景由事务路径
      // 兜底（每事务两次 rect 读取，浮层不在场时零成本短路）
      EditorView.updateListener.of(() => {
        if (this.findOpen || this.occurrenceSession) {
          this.syncOverlayAnchors()
        }
      }),
      // #241 在选定内容中查找：用户选区锚点与开启范围的生命周期——
      // select 事务（鼠标/键盘重选；findLocate 的定位事务不带 userEvent，
      // 不会误跟）更新锚点并在开启中跟随为新范围；docChanged 把锚点与
      // 范围随文档映射（mapPos 钳制到新文档长；编辑把范围吃掉时塌缩区间
      // 自然滤空匹配）。范围变化后重算重绘（findDoc 引用在 docChanged
      // 路径同步失效，findEnsureFresh 按需重算同样吃到新范围——此处统一
      // 主动一次，保证 select 跟随即时可见；未开启时只维护锚点，禁用态
      // 与开启捕获都依赖它）
      EditorView.updateListener.of((update) => {
        if (!this.view) {
          return
        }
        let rangeChanged = false
        let anchorTouched = false
        for (const tr of update.transactions) {
          if (tr.docChanged) {
            const len = this.view.state.doc.length
            const mapClamped = (pos: number, assoc: number) =>
              Math.max(0, Math.min(tr.changes.mapPos(pos, assoc), len))
            if (this.findSelectionAnchor) {
              this.findSelectionAnchor = {
                from: mapClamped(this.findSelectionAnchor.from, -1),
                to: mapClamped(this.findSelectionAnchor.to, 1),
              }
            }
            if (this.findInSelection && this.findRange) {
              const from = mapClamped(this.findRange.from, -1)
              const to = mapClamped(this.findRange.to, 1)
              if (from !== this.findRange.from || to !== this.findRange.to) {
                this.findRange = { from, to }
                rangeChanged = true
              }
            }
          } else if (tr.isUserEvent('select') && this.viewMode === 'live') {
            const sel = tr.state.selection.main
            if (!sel.empty) {
              if (!this.findSelectionAnchor ||
                  sel.from !== this.findSelectionAnchor.from || sel.to !== this.findSelectionAnchor.to) {
                this.findSelectionAnchor = { from: sel.from, to: sel.to }
                anchorTouched = true
              }
              if (this.findInSelection && this.findRange &&
                  (sel.from !== this.findRange.from || sel.to !== this.findRange.to)) {
                this.findRange = { from: sel.from, to: sel.to }
                rangeChanged = true
              }
            } else if (this.findSelectionAnchor) {
              this.findSelectionAnchor = null
              anchorTouched = true
            }
          }
        }
        if (rangeChanged && this.findOpen) {
          this.findRecompute(this.findReferencePos())
          this.findRender()
        }
        if (anchorTouched && this.findOpen) {
          this.findRender()
        }
      }),
      // #238 会话生命周期：选区被外部改变（非本命令事务的选区设置/
      //  docChanged——用户点击/键盘移动/输入/外部同步映射）即结束会话，
      //  选项条淡出（下一次按下按新状态重建）。命令自身事务带
      //  occurrenceCmd 注解，见 dispatchOccurrencePlan。
      //  判据修正（#251 实证）：Transaction.selection 无显式设置时也非 null
      //  （CM6 沿用/映射当前选区，每次新对象）——纯 effect 事务（setFindMatches、
      //  setOccurrenceHitActive 等）不得按「selection 非 null」误判为选区变化；
      //  以 EditorSelection.eq 的内容比较识别真实选区变化（内容未变即无外部改变）
      EditorView.updateListener.of((update) => {
        if (!this.occurrenceSession) {
          return
        }
        for (const tr of update.transactions) {
          // Transaction.selection 类型为 EditorSelection | undefined（未显式
          // 设置即 undefined——不是 null；旧判据 !== null 恒真，纯 effect 事务
          // 会被误判为选区变化）。
          const sel = tr.selection
          if ((tr.docChanged ||
                (sel !== undefined && !tr.startState.selection.eq(sel))) &&
              !tr.annotation(occurrenceCmd)) {
            this.endOccurrenceSession()
            return
          }
        }
      }),
    ]
  }

  /** init 全文装载后的模式锚点恢复（原 handleFullSync 的 restoreAnchor
   *  分支等价搬运；reading 滚到锚点块，live 恢复光标 + 视口） */
  private restoreModeAnchorAfterSync(): void {
    if (this.viewMode === 'reading') {
      if (this.modeAnchor !== null && this.readingView && this.viewport?.mode !== 'reading') {
        this.readingView.scrollToOffset(this.clampToDoc(this.modeAnchor))
      }
    } else if (this.modeAnchor !== null && this.modeAnchor > 0) {
      // 恢复光标：不带 changes 的事务，不产生编辑历史
      const pos = this.clampToDoc(this.modeAnchor)
      this.view?.dispatch({ selection: { anchor: pos } })
    }
    // 光标/模式锚点与阅读视口是两种状态：恢复光标后再恢复离开时视口。
    // 若没有新版 viewport，旧持久状态仍沿用上面的锚点恢复路径。
    this.restoreViewport()
  }

  dispose(): void {
    this.toast?.dispose()
    this.richPasteDialog?.dispose()
    this.richPasteDialog = undefined
    this.pasteFeedback.length = 0
    this.toast = undefined
    this.clipboardReadReqId += 1
    this.flushPendingViewState()
    // #238 会话与闪烁计时清理（选项条 DOM 随 parent 移除）
    this.endOccurrenceSession()
    if (this.findFlashTimer) {
      clearTimeout(this.findFlashTimer)
      this.findFlashTimer = undefined
    }
    document.removeEventListener('visibilitychange', this.flushViewportOnHide)
    window.removeEventListener('pagehide', this.flushViewportOnPageHide)
    // #163 验收反馈：卸载跳转目标高亮的消失监听（window 级监听防泄漏）
    this.detachAnchorFlashDismiss()
    closeDiagramPopup()
    closeImagePopup()
    closeFmPopover()
    // #218 悬停浮层随卸载退出（清空上下文，同步关浮层释放实例）
    setHoverPreviewContext(null)
    // #299 跳转目标提示随卸载退出（清空上下文与目标缓存——缓存随会话）
    setTargetTipContext(null)
    // #223 Live 嵌入 widget 先断开卡片接线（后续 view 销毁触发 widget
    // destroy 时 no-op；卡片 DOM 已由 embedCards.dispose 统一释放）
    setLiveEmbedCards(null)
    // #222 嵌入卡片随卸载退出（释放全部卡片 DOM、B 视图与状态库）
    this.embedCards?.dispose()
    this.embedCards = undefined
    setDiagramExportSender(null)
    setDiagramPopupDocSource(null)
    setImagePopupContext(null)
    this.unsubscribeLocale?.()
    this.unsubscribeLocale = undefined
    // 实例 flush 计时随实例 destroy 清零（见下方 live.destroy）
    // #292 骨架撤除计时清理（元素随 webview 卸载，计时器须显式清除）
    if (this.skeletonExitTimer !== undefined) {
      clearTimeout(this.skeletonExitTimer)
      this.skeletonExitTimer = undefined
    }
    this.cancelOutlineRefresh()
    this.cancelOutlineHighlightUpdate()
    if (this.outlineJumpGuardTimer !== undefined) {
      clearTimeout(this.outlineJumpGuardTimer)
      this.outlineJumpGuardTimer = undefined
    }
    this.outlineJumpGuarded = false
    this.hostThemeObserver?.disconnect()
    this.hostThemeObserver = undefined
    this.quickActionResizeObserver?.disconnect()
    this.quickActionResizeObserver = undefined
    this.overlayAnchorObserver?.disconnect()
    this.overlayAnchorObserver = null
    if (this.docKeydown) {
      document.removeEventListener('keydown', this.docKeydown, true)
      this.docKeydown = undefined
    }
    if (this.docKeyup) {
      document.removeEventListener('keyup', this.docKeyup, true)
      this.docKeyup = undefined
    }
    this.setLinkModActive(false)
    window.removeEventListener('blur', this.cancelKeybindingOnBlur)
    this.keybindingRouter.cancel()
    // P2-02：主正文实例销毁（flush 计时清零 + EditorView destroy，DOM
    // 随 destroy 移除）；根 chrome 各自独立释放
    this.live?.destroy()
    this.live = undefined
    this.banner?.remove()
    this.banner = undefined
    this.toolbar?.remove()
    this.toolbar = undefined
    this.quickActionsEl?.remove()
    this.quickActionsEl = undefined
    this.quickToggleBtn = undefined
    this.viewToggleBtn = undefined
    this.refreshBtn = undefined
    this.quickHeadingBtn = undefined
    this.quickHeadingMenu = undefined
    this.findPanel?.remove()
    this.findPanel = undefined
    this.findInputEl = undefined
    this.findCountEl = undefined
    this.findInSelectionBtnEl = undefined
    this.findToggleEl = undefined
    this.findCaseBtnEl = undefined
    this.findWordBtnEl = undefined
    this.findRegexpBtnEl = undefined
    this.findReplaceRowEl = undefined
    this.liveWrapper?.remove()
    this.liveWrapper = undefined
    this.readingView?.dispose()
    this.readingView = undefined
    this.readingContainer?.remove()
    this.readingContainer = undefined
    this.sidebarToggleBtn = undefined
    this.outlineToggleBtn = undefined
    this.outlinePanelEl = undefined
    this.outlineSlider = undefined
    this.outlineToolbar = undefined
    // #69：菜单浮层与重命名编辑态随卸载退出（document 监听一并摘除）
    this.closeOutlineMenu()
    // #183：统一右键菜单随卸载退出（document 监听一并摘除）
    this.closeContextMenu()
    this.outlineRenameIndex = null
    this.outlineRenameDoc = null
    // #70：拖拽会话随卸载退出（document 监听一并摘除）
    document.removeEventListener('pointerdown', this.outlinePointerdownEntry, true)
    this.cancelOutlineDrag()
    // 拖宽会话随卸载退出（document 常驻捕获入口与 blur/Escape 监听一并摘除）
    document.removeEventListener('pointerdown', this.sidebarResizePointerdownEntry, true)
    this.endSidebarResize(true)
    this.sidebarResizerEl = undefined
    this.sidebarEl?.remove()
    this.sidebarEl = undefined
    this.mainEl?.remove()
    this.mainEl = undefined
    this.bodyEl?.remove()
    this.bodyEl = undefined
    this.images?.dispose()
    this.images = undefined
    // #201 周期核验调度与可见性监听随卸载退出
    this.imageVerify?.dispose()
    this.imageVerify = undefined
    document.removeEventListener('visibilitychange', this.imageVisibilityEntry)
  }

  /** 宿主消息入口（window message 事件转发） */
  handleHostMessage(message: unknown): void {
    if (!isHostToWebview(message)) {
      return
    }
    recordDiagnosticMessage(this.diagnostics, 'webview.receive', message)
    switch (message.kind) {
      case 'diagnostics.test.set':
        this.diagnostics.reset(message.enabled)
        this.readingView?.setDiagnosticSink(message.enabled
          ? (stage, data) => this.diagnostics.record(stage, data) : undefined)
        break
      case 'init':
        this.sessionId = message.sessionId
        this.docUri = message.docUri
        // 目标会话身份同步注入实例（出站消息的实例目标戳记；根 chrome
        // 的会话消费面继续读根持有的同值字段）
        this.live?.setSession(message.sessionId, message.docUri)
        this.live?.handleFullSync(message.version, message.text, {
          restoreAnchor: true,
          source: 'init',
        })
        // init 后主动回报一次视图状态（含持久化恢复的模式）：宿主的模式
        // 缓存尽早建立，重载场景（retainContextWhenHidden 关闭）不留窗口
        this.reportViewState()
        // 拉取当前设置快照（#33）：权威在宿主，webview 不持久化——每次
        // 装载（含重载）都拉取；宿主以 settings.snapshot 响应
        this.bridge.postMessage({ kind: 'settings.get' })
        this.bridge.postMessage({ kind: 'keybindings.get' })
        // #239 分词资源状态：同「init 后拉取」模式——宿主按面板回发
        // wordSegment.state（installed 时携带本面板的 jieba 资源 URI）
        this.bridge.postMessage({ kind: 'wordSegment.get' })
        // #236 查找选项（workspace 级记忆）：权威在宿主，每次装载拉取
        this.bridge.postMessage({ kind: 'findOptions.get' })
        // #128 CSS 片段清单：同「init 后拉取」模式——宿主权威扫描 × 开关
        // 映射经 snippets.snapshot 应答（新面板、重载面板、暂未广播的变更
        // 都在此对齐当前态）
        this.bridge.postMessage({ kind: 'snippets.get' })
        // #197 反链快照：同「init 后拉取」模式——宿主索引权威，每次装载
        //（含重载）对齐当前文档的反链；索引变更后宿主主动推送
        if (this.docUri) {
          this.bridge.postMessage({ kind: 'backlinks.get', sessionId: this.sessionId!, docUri: this.docUri })
          this.bridge.postMessage({ kind: 'outlinks.get', sessionId: this.sessionId!, docUri: this.docUri })
        }
        break
      case '_test.skeleton.release':
        // #292 测试钩子：解除 HTML 嵌入的撤除冻结并立即撤除
        this.skeletonHoldReleased = true
        this.dismissSkeleton()
        break
      case 'keybindings.snapshot':
      case 'keybindings.changed': {
        const overrides = message.overrides
        this.keybindingRouter.update(overrides)
        this.keybindingOverrides = overrides
        this.setQuickActionBindingHints((id) => getEffectiveBindings(overrides, id))
        break
      }
      case 'settings.snapshot':
      case 'settings.changed':
        // 设置快照与变更广播共用同一处理（#33）：snapshot 为设置页请求-
        // 响应与编辑器拉取的回填，changed 为保存成功的全量广播；缓存后由
        // 消费方按需读取关心的键。Live 扩展组（行号/表格网格/代码卡片/
        // 符号三组/多光标）的 Compartment 热重配随实例（P2-02 迁入，
        // 缺键回默认、非法形态忽略）；根侧设置（可读行宽/嵌入限高/分词
        // 引擎）仍在下方处理
        this.settings = message.values
        this.live?.applySettings(message.values)
        // P2-04：嵌入内部 Live 实例的设置热重配（Live 扩展组随实例）
        this.embedCards?.applySettings(message.values)
        this.applyReadableLineWidthSetting()
        this.applyEmbedMaxHeightSetting()
        this.embedCards?.setMaxDepth(this.embedMaxDepth())
        this.applyWordSegmentEngineSetting()
        // #343（P3-11）外链设置联动：总开关关闭或形态切回 card 时销毁
        // 在场原网页 iframe、就地退回卡片（缺键 = 无关变更不动作）
        notifyHoverExternalSettings(message.values)
        break
      case 'wordSegment.state': {
        // #239 jieba 资源状态（宿主下载/删除后推送）：资源 URI 变化驱动
        // wordMotion 重新评估加载；引擎选择仍在 settings 快照（两通道汇流）
        const resources = message.resources
        this.wordSegmentResources = resources && resources.js && resources.wasm
          ? { js: resources.js, wasm: resources.wasm }
          : null
        this.applyWordSegmentEngineSetting()
        break
      }
      case 'findOptions.snapshot': {
        // #236 查找选项（宿主权威回流：get 应答与 set 广播共用形态）。
        // 应用为当前匹配选项并重算（面板按钮态随 findRender 同步）；与
        // #238 选下一处相同词同源——后续消费方经同一通道取选项
        const next = message.options
        if (!findOptionsEqual(next, this.findOptions)) {
          this.findOptions = { ...next }
          this.findDoc = null
          if (this.findOpen) {
            this.findRecompute(this.findReferencePos())
            this.findRender()
            this.findLocate()
          }
          // #238 开关切换结束当前会话并按新档重建（选项条在场则保持在场，
          // 按钮态同步刷新）——下一次 Ctrl+D 匹配行为即时随动
          this.rebuildOccurrenceSessionAfterOptionChange()
        }
        break
      }
      case 'snippets.snapshot': {
        // #128 CSS 片段装载：diff 式装配 <link>（失败保留最近成功样式、
        // 停用立即撤下）；装载结果回报宿主（入口级成败可观测），样式落地
        // 后唤醒测量——行高/字号变化时 live 侧 CM6 需重测视口（阅读侧由
        // ResizeObserver → measureAndStabilize 现成管线自动锚定）。
        // #130 字体晚到：@font-face 字体在链 load 后才异步装载完成，另行
        // 经 document.fonts.ready 稳定时机补一轮重测（见 scheduleSnippetMeasure）
        this.snippetLoader.apply(message, (outcome) => {
          this.diagnostics.record('snippets.outcome', { name: outcome.name, version: outcome.version, ok: outcome.ok })
          this.bridge.postMessage({
            kind: 'snippets.loadResult',
            name: outcome.name,
            version: outcome.version,
            ok: outcome.ok,
          })
          if (outcome.ok) {
            this.scheduleSnippetMeasure()
            this.scheduleSnippetMeasureOnFontArrival()
          }
        })
        break
      }
      case 'backlinks.snapshot': {
        // #197 反链快照：仅当前文档的快照生效（宿主按面板文档定向推送，
        // 多面板/文档切换期间的迟到快照按 docUri 丢弃）；面板可见时即时
        // 重渲染，不可见时只缓存（展开时 applyBacklinksDom 渲染）。
        // review-loops #16：宿主按文档带单调 seq——快照应答为异步
        // fire-and-forget，乱序到达时丢弃降序帧（缺省 seq 不丢弃，兼容）
        if (this.docUri !== message.docUri) {
          break
        }
        if (message.seq !== undefined) {
          if (message.seq < this.lastBacklinksSeq) {
            break
          }
          this.lastBacklinksSeq = message.seq
        }
        this.backlinksSnapshot = {
          state: message.state,
          updating: message.updating ?? false,
          reason: message.reason,
          items: message.items ?? [],
        }
        if (this.backlinksVisible()) {
          // #221 条目 DOM 全量重建：先释放在场悬停浮层（锚点随旧 DOM 脱树）
          closeHoverPopupIfAnchorWithin(this.backlinksPanelEl!)
          renderBacklinksState(this.backlinksPanelEl!, this.backlinksSnapshot, this.backlinkView)
        }
        break
      }
      case 'outlinks.snapshot': {
        // 出链快照（与 backlinks.snapshot 镜像）：docUri 匹配 + seq 降序帧
        // 丢弃 + 可见时即时重渲染
        if (this.docUri !== message.docUri) {
          break
        }
        if (message.seq !== undefined) {
          if (message.seq < this.lastOutlinksSeq) {
            break
          }
          this.lastOutlinksSeq = message.seq
        }
        this.outlinksSnapshot = {
          state: message.state,
          updating: message.updating ?? false,
          reason: message.reason,
          items: message.items ?? [],
        }
        if (this.outlinksVisible()) {
          // #221 条目 DOM 全量重建：先释放在场悬停浮层（与反链快照同款）
          closeHoverPopupIfAnchorWithin(this.outlinksPanelEl!)
          renderOutlinksState(this.outlinksPanelEl!, this.outlinksSnapshot)
        }
        break
      }
      case 'outlinks.test.click': {
        // 测试钩子（出链面板批次）：点击真实出链按钮（与用户点击同一处理器）
        this.outlinksToggleBtn?.click()
        break
      }
      case 'outlinks.test.itemClick': {
        // 测试钩子（出链面板批次）：点击第 index 个真实出链条目（与用户
        // 点击同一委托处理器；条目 DOM 与快照 items 同序；断链条目 disabled
        // ——按钮不派发 click，钩子同样不触发跳转）
        const panel = this.outlinksPanelEl
        if (!panel) {
          break
        }
        const items = Array.from(panel.querySelectorAll<HTMLElement>(`.${OUTLINK_CLASS_NAMES.item}`))
        items[message.index]?.click()
        break
      }
      case 'backlinks.test.click': {
        // 测试钩子（#197）：点击真实反链按钮（与用户点击同一处理器）
        this.backlinksToggleBtn?.click()
        break
      }
      case 'backlinks.test.itemClick': {
        // 测试钩子（#197）：点击第 index 个真实反链条目（与用户点击同一
        // 委托处理器；条目 DOM 与快照 items 同序）
        const panel = this.backlinksPanelEl
        if (!panel) {
          break
        }
        const items = Array.from(panel.querySelectorAll<HTMLElement>(`.${BACKLINK_CLASS_NAMES.item}`))
        items[Math.max(0, message.index)]?.click()
        break
      }
      case 'backlinks.test.toolbarClick': {
        // 测试钩子（形态改版批次）：点击工具栏四按钮之一（与用户点击同一
        // 委托处理器）
        const button = this.backlinksPanelEl?.querySelector<HTMLButtonElement>(
          `button[data-action="${message.action}"]`,
        )
        button?.click()
        break
      }
      case 'backlinks.test.searchInput': {
        // 测试钩子（形态改版批次）：设置搜索词（真实 input 事件链）
        const input = this.backlinksPanelEl?.querySelector<HTMLInputElement>(
          `input.${BACKLINK_CLASS_NAMES.searchInput}`,
        )
        if (input) {
          input.value = message.value
          input.dispatchEvent(new Event('input', { bubbles: true }))
        }
        break
      }
      case 'backlinks.test.sortSelect': {
        // 测试钩子（形态改版批次）：选择排序项（开菜单 → 点对应菜单项，
        // 与用户路径同链）
        this.setBacklinkSortMenuOpen(true)
        const item = this.backlinksPanelEl?.querySelector<HTMLButtonElement>(
          `.${BACKLINK_CLASS_NAMES.sortMenuItem}[data-vsidian-sort="${message.mode}"]`,
        )
        item?.click()
        break
      }
      case 'hover.result': {
        // #218 悬停预览结果：转发浮层模块（instanceId + reqId 双守卫在
        // 模块内——迟到/陈旧回包丢弃，不重开已关闭浮层）。#222 起嵌入
        // 卡片同消息通道。消费者回报是否消费；两者均未命中才释放来源
        // 租约，避免未命中的浮层提前释放仍应交给卡片的成功回包。
        const consumed = notifyHoverResult(message) || this.embedCards?.notifyResult(message)
        this.diagnostics.record('hover.applied', { reqId: message.reqId, instanceId: message.instanceId,
          consumed: consumed === true })
        if (!consumed && message.ok && message.sourceLeaseId !== undefined && this.sessionId && this.docUri) {
          this.bridge.postMessage({ kind: 'hover.source.release', sessionId: this.sessionId, docUri: this.docUri,
            sourceLeaseId: message.sourceLeaseId })
        }
        break
      }
      case 'hover.invalidated': {
        // #224 引用视图同步：宿主对订阅目标的失效推送（未保存修改防抖
        // 合并 / 磁盘事件分态直通）。转发浮层与嵌入卡片——各自按订阅目标
        // 匹配（watchedFsPath / entry.loaded.fsPath），未订阅目标零动作
        notifyHoverInvalidated(message)
        this.embedCards?.notifyInvalidated(message)
        break
      }
      case 'hover.watch.rejected': {
        notifyHoverWatchRejected(message)
        this.embedCards?.notifyWatchRejected(message)
        break
      }
      case 'hover.tokens': {
        // #340（P3-08）文本 token 分层推送：转发浮层模块（instanceId 配
        // 对 + 版本仲裁在 applyTextTokens——迟到/过期 token 不覆盖新正文）；
        // #341（P3-09）嵌入卡片同点转发（notifyTokens 遍历在场挂载，按
        // occurrence/hostId 配对——同 occurrence 双容器各视图分别应用）
        notifyHoverTokens(message)
        this.embedCards?.notifyTokens(message)
        break
      }
      case 'appearance.changed': {
        // #340 外观代次广播：text 浮层静默重载（语言字体随正文载荷刷新、
        // token 随 render 重取）；#341 嵌入卡片同点转发（在场 text 卡静默
        // 重载）。Markdown 侧 CSS 变量自带跟随
        notifyAppearanceChanged()
        this.embedCards?.notifyAppearanceChanged()
        break
      }
      case 'refEdit.bound':
        // P2-04（#281）目标编辑端口绑定回执：嵌入卡片按 reqId 配对创建
        // 内部 Live 实例（失败回退 Reading 呈现）
        this.embedCards?.notifyBound(message)
        break
      case 'refEdit.push':
        // B 会话编辑通道事件（init/ack/doc.changed/resync/suspended）：
        // 按 portId 路由到嵌入实例（释放后的迟到推送查不到端口即丢弃）
        this.embedCards?.notifyPush(message)
        break
      case 'refEdit.dirty':
        // 目标 B 的未保存状态推送（按 fsPath 命中该目标的全部嵌入实例）
        this.embedCards?.notifyDirty(message)
        break
      case 'refEdit.save.result':
        this.embedCards?.notifySaveResult(message)
        break
      case 'refEdit.close.state':
        // P2-05（#282）显式关闭意图的 B 最新状态应答：dirty 弹三项模态，
        // 干净直接完成退出
        this.embedCards?.notifyCloseState(message)
        break
      case 'refEdit.close.result':
        // P2-05（#282）确认后的关闭动作结果：closed 完成退出；失败保留
        // 现场；stale 重新确认
        this.embedCards?.notifyCloseResult(message)
        break
      case 'refEdit.conflictCompare.result':
        // P2-12（#289）「对比并解决」结果：ok = 转交完成（出站 sync.request
        // 重同步解除暂停）；失败保留选择现场并就地提示
        this.embedCards?.notifyConflictCompareResult(message)
        break
      case 'embed.test.mode':
        // P2-04 测试钩子：切换指定嵌入的内部模式（与用户点击头部按钮
        // 同一处理器链路）
        this.embedCards?.testSetMode(message.inner, message.mode, message.occurrence ?? 0)
        break
      case 'embed.test.type':
        // P2-04 测试钩子：向嵌入内部 Live 实例注入一笔输入事务（与真实
        // 键入同一事务管线 → refEdit.message 出站）
        this.embedCards?.typeInEmbed(message.inner, message.pos, message.text, message.occurrence ?? 0)
        break
      case 'embed.test.focus':
        // P2-10 测试钩子：聚焦嵌入内部 Live 编辑器（真实 focus 语义——
        // 格式/表格/菜单等命令随后的目标分派走同一焦点判定）
        this.embedCards?.focusEmbed(message.inner, message.pos, message.to, message.occurrence ?? 0)
        break
      case 'embed.test.save':
        // P2-04 测试钩子：触发指定嵌入的目标保存（与头部保存入口同一出站）
        this.embedCards?.testSave(message.inner, message.occurrence ?? 0)
        break
      case 'embed.test.history':
        // P2-04 测试钩子：向嵌入实例转发撤销/重做（与真实键入 Mod-Z 同一
        // 请求管线——实例竞态守卫后经 refEdit.message 出站）
        this.embedCards?.testHistory(message.inner, message.op, message.occurrence ?? 0)
        break
      case 'embed.test.pasteImage':
        // P2-11 测试钩子：向嵌入实例注入图片粘贴载荷（与真实 paste 拦截
        // 同一实例管线——reqId 分配/在途登记/经目标端口出站）
        this.embedCards?.testPasteImage(
          message.inner,
          {
            mime: message.mime,
            dataBase64: message.dataBase64,
            ...(message.fileNameHint !== undefined ? { fileNameHint: message.fileNameHint } : {}),
          },
          message.occurrence ?? 0,
        )
        break
      case 'embed.test.portWrite':
        // P2-04 测试钩子：以给定端口身份伪造一笔 edit.request 出站（宿主侧
        // 重复 seq 去重 / 释放后拒收 / 不可安全写回暂停的目标文本断言载体）
        this.embedCards?.testPortWrite({
          portId: message.portId,
          fsPath: message.fsPath,
          seq: message.seq,
          baseVersion: message.baseVersion,
          offset: message.offset,
          length: message.length,
          text: message.text,
          ...(message.repeat !== undefined ? { repeat: message.repeat } : {}),
        })
        break
      case 'embed.test.close':
        // P2-05 测试钩子：触发指定嵌入的显式关闭意图（三径同 requestClose）
        this.embedCards?.testClose(message.inner, message.intent, message.occurrence ?? 0)
        break
      case 'embed.test.dialogAction':
        // P2-05 测试钩子：点击关闭确认模态按钮（真实 click 同一处理器）
        this.embedCards?.testDialogAction(message.action)
        break
      case 'embed.test.deleteRef':
        // P2-05 测试钩子：主编辑器派发删除指定引用行事务（真实事务管线）
        this.embedCards?.testDeleteRef(message.inner, message.occurrence ?? 0)
        break
      case 'embed.test.deleteChildRef':
        // #321 测试钩子：指定孙卡的直接父 B 编辑器派发删除其引用行事务
        //（真实事务管线——B 侧拦截确认链路的断言载体）
        this.embedCards?.testDeleteChildRef(message.inner, message.occurrence ?? 0)
        break
      case 'embed.test.conflictAction':
        // P2-12 测试钩子：触发指定嵌入的冲突三项动作（与选择条按钮同一
        // 处理器链路）
        this.embedCards?.testConflictAction(message.inner, message.action, message.occurrence ?? 0)
        break
      case 'hover.test.live': {
        // P2-06（#283）测试钩子：浮窗根内部 Live 操作族（与头部按钮/编辑器
        // 事务管线同一处理器链路——宿主测试无法派发真实点击/键入）
        hoverPopupLiveTestAction(message.action, {
          ...(message.intent !== undefined ? { intent: message.intent } : {}),
          ...(message.pos !== undefined ? { pos: message.pos } : {}),
          ...(message.to !== undefined ? { to: message.to } : {}),
          ...(message.text !== undefined ? { text: message.text } : {}),
        })
        break
      }
      case 'hover.target.resolved': {
        // #299 跳转目标提示轻量解析回包（reqId 配对在 targetTip 模块内
        // 收敛——迟到回包丢弃；失败静默不出提示）
        notifyTargetTipResolved(message)
        break
      }
      case 'hover.test.pointer': {
        // #218 测试钩子：对阅读视图第 index 个真实双链派发 mouseover/
        // mouseout（冒泡经容器委托——与用户悬停同一处理器链路）；宿主
        // 测试无法向 webview 派发真实鼠标事件。#219 起 link='md' 对第
        // index 个普通 Markdown 链接（非双链 a[href]）派发
        // #221 起 link 枚举扩展：'live-wikilink' / 'live-md' 对 Live 正文
        // 第 index 个链接装饰派发（ctrlKey 模拟 Ctrl+悬停修饰位；事件带
        // 装饰中心坐标——Live 判定走 posAtCoords）；'backlink' / 'outlink'
        // 对面板第 index 个条目派发（面板直接悬停）
        const dispatchHoverEvent = (el: HTMLElement, enter: boolean, ctrl = false): void => {
          const rect = el.getBoundingClientRect()
          el.dispatchEvent(new MouseEvent(
            enter ? 'mouseover' : 'mouseout',
            {
              bubbles: true,
              relatedTarget: enter ? document.body : null,
              ctrlKey: ctrl,
              clientX: rect.left + rect.width / 2,
              clientY: rect.top + rect.height / 2,
            },
          ))
        }
        if (message.action === 'modkey') {
          // 真实 keydown Control 经 document 捕获路由（与用户按键同链路，
          // 走 onLiveHoverModifierDown 补触发——「先悬停、后按 Ctrl」路径；
          // ctrlKey 修饰位必带：合成事件的 getModifierState 只认 init 字典，
          // 缺位会把 vsidian-mod-link 状态类反向摘除）
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true, bubbles: true }))
          break
        }
        if (message.link === 'live-wikilink' || message.link === 'live-md') {
          const content = this.view?.contentDOM
          if (!content || this.viewMode !== 'live') {
            break
          }
          const cls = message.link === 'live-wikilink'
            ? `.${WIKILINK_CLASS_NAMES.wikilink}`
            : `.${LINK_CLASS_NAMES.link}`
          const anchors = Array.from(content.querySelectorAll<HTMLElement>(cls))
          const anchor = anchors[message.index]
          if (!anchor) {
            break
          }
          dispatchHoverEvent(anchor, message.action === 'enter', message.ctrlKey === true)
          break
        }
        if (message.link === 'backlink' || message.link === 'outlink') {
          const panel = message.link === 'backlink' ? this.backlinksPanelEl : this.outlinksPanelEl
          const cls = message.link === 'backlink'
            ? `.${BACKLINK_CLASS_NAMES.item}`
            : `.${OUTLINK_CLASS_NAMES.item}`
          const item = panel?.querySelectorAll<HTMLElement>(cls)[message.index]
          if (!item) {
            break
          }
          dispatchHoverEvent(item, message.action === 'enter')
          break
        }
        const container = this.readingContainer
        if (!container || this.viewMode !== 'reading') {
          break
        }
        const selector = message.link === 'md'
          ? `a[href]:not(.${WIKILINK_CLASS_NAMES.wikilink})`
          : `a.${WIKILINK_CLASS_NAMES.wikilink}`
        const anchors = Array.from(container.querySelectorAll<HTMLElement>(selector))
        const anchor = anchors[message.index]
        if (!anchor) {
          break
        }
        anchor.dispatchEvent(new MouseEvent(
          message.action === 'enter' ? 'mouseover' : 'mouseout',
          { bubbles: true, relatedTarget: message.action === 'enter' ? document.body : null },
        ))
        break
      }
      case 'image.test.pending': {
        // #161 测试钩子：补登记在途 reqId（宿主注入 image.paste 绕过拦截侧
        // 登记，见协议注释——webview 侧测试消息不做二次门控属既定分层设计）
        this.live?.noteImagePastePending(message.reqId)
        break
      }
      case 'image.paste.result': {
        // #161 图片粘贴落盘结果：reqId 在途校验（陈旧/未知回包丢弃）；
        // 成功在光标处单事务插入宿主计算好的 markdown（守卫对齐格式操作
        // ——live、非暂停、可编辑；单笔 dispatch = 一笔 edit.request =
        // 撤销一步还原）；失败不插入文本（宿主已弹 i18n 通知）——
        // 在途表与插入守卫随实例（P2-02）
        this.live?.handleImagePasteResult(message)
        break
      }
      case 'edit.ack': {
        // 同步状态机（C-2 基线推进 / ok:false 冲突暂停）随实例（P2-02）；
        // ack 失败附文的重置走实例 handleFullSync，阅读刷新等根联动经
        // 实例 hook 回调。#314 粘贴元数据的 ack 落定经实例
        // onPasteTxnAcked 钩子（剥离前回读）；代理返回即 ok 分支收敛，
        // 此处释放粘贴反馈（时机对齐 main 版 ok 分支末尾——fail 路径
        // 已被 enterSuspended → onSuspendedChange 清空，release 幂等空转）
        this.live?.handleEditAck(message)
        this.releasePasteFeedback(this.live ?? null)
        break
      }
      case 'doc.changed':
        // 外部增量应用（版本单调 / 组合缓冲 / 在途映射 / 冲突暂停）随实例
        //（P2-02）；应用后的阅读刷新经实例 hook 回调
        this.live?.handleDocChanged(message)
        break
      case 'doc.resync':
        this.live?.handleFullSync(message.version, message.text, { source: 'resync' })
        break
      case 'session.suspended':
        // 宿主通知：面板处于暂停状态（典型为 webview 重载后的状态恢复）
        this.live?.handleSessionSuspended()
        break
      case 'view.mode.set':
        // 模式切换指令（宿主命令路径；webview 按钮走同一状态机）
        // #163 验收反馈：切换模式 = 离开当前视图，跳转目标高亮随之消失——
        // 清理置于装载之后（切换同步链内的 dispatch 会干扰阅读装载时序）
        this.setViewMode(message.mode)
        this.clearAnchorFlash()
        break
      case 'view.find.open':
        // 查找会话（#14）：webview 内浮动面板；open/step 为纯只读视图操作。
        // replace 语义（命令面板替换入口，与 Ctrl+H 同命令）在阅读模式
        // 整体禁用（2026-10）：面板都不开，静默忽略——与 view.find.replace
        // 的阅读守卫同口径
        if (message.replace === true && this.viewMode !== 'live') {
          break
        }
        this.openFind(message.query, {
          replace: message.replace === true,
          replacement: typeof message.replacement === 'string' ? message.replacement : undefined,
        })
        break
      case 'view.find.close':
        this.closeFind()
        break
      case 'view.find.step':
        this.findStep(message.direction)
        break
      case 'view.find.replace':
        // #236 替换（显式写操作）：仅 live 执行（阅读只读）；经 CM6 事务
        // 走标准出站链路（一笔 edit.request = 宿主撤销一次）
        this.runFindReplace(message.op)
        break
      case 'table.command': {
        // 表格增删行列（#13）：仅 live 模式执行（阅读除勾选任务外只读）；
        // 操作经 CM6 事务走标准出站链路（一笔 edit.request = 撤销一次），
        // 暂停态下与 live 输入同语义（本地保留、不写回）。P2-10：焦点在
        // 嵌入内部 Live 内时目标为 B（经端口出站）
        const resolved = this.actionTarget()
        if (resolved && this.targetEditable(resolved.view, resolved.embed)) {
          runTableEdit(resolved.view, message.op)
        }
        break
      }
      case 'table.create': {
        const resolved = this.actionTarget()
        if (resolved && this.targetEditable(resolved.view, resolved.embed)) {
          runCreateTable(resolved.view)
        }
        break
      }
      case 'format.command': {
        this.runFormatOperation(message.op)
        break
      }
      case 'blockLink.copy': {
        // #162 复制块链接（快捷键/命令面板入口）：仅 live 执行（阅读只读）；
        // 无 id 时自动补写经 CM6 事务走标准出站链路（一笔 edit.request =
        // 撤销一次），暂停态与 live 输入同语义（本地保留、不写回）
        if (this.view && this.viewMode === 'live') {
          this.runBlockCopyAtCursor()
        }
        break
      }
      case 'ui.command':
        switch (message.op) {
          case 'paste': this.requestClipboardPaste(); break
          case 'pastePlain': this.requestClipboardPaste({ plain: true }); break
          case 'sidebarToggle': this.toggleSidebar(); break
          case 'outlineToggle':
            if (!this.sidebarOpen && !this.outlineActive) this.toggleSidebar()
            this.toggleOutline()
            break
          case 'outlineSearch':
            if (!this.sidebarOpen) this.toggleSidebar()
            if (!this.outlineActive) this.toggleOutline()
            this.outlineToolbar?.search.focus()
            break
          case 'outlineJumpBottom': this.outlineJumpToBottom(); break
          case 'outlineReset': this.resetOutline(); break
          case 'outlineCollapseAll': this.setOutlineExpandLevel(0); break
          case 'outlineExpandAll': this.setOutlineExpandLevel(5); break
          case 'backlinksToggle':
            if (!this.sidebarOpen && !this.backlinksActive) this.toggleSidebar()
            this.toggleBacklinks()
            break
          case 'outlinksToggle':
            if (!this.sidebarOpen && !this.outlinksActive) this.toggleSidebar()
            this.toggleOutlinks()
            break
          // #208 刷新嵌入资源：快捷键/命令面板入口（宿主命令经注册循环
          // 回发此处）——与工具栏按钮共用同一发送实现（出站 refresh.request
          // 后由宿主失效编排回流），不另造路径
          case 'refreshEditor': this.sendEmbeddedRefreshRequest(); break
          // P2-04 切换焦点嵌入的内部模式（命令面板/键位入口；默认未绑定，
          // 与头部模式按钮同一实现——无焦点嵌入零操作）
          case 'embedToggleMode': this.embedCards?.toggleFocusedMode(); break
          // P2-10（#287）+ P2-05（#282）引用 Live 操作族：保存目标（与焦点
          // 内 Ctrl+S 焦点路由共用出站）。显式关闭统一为 P2-05 退出确认
          // 链路（dirty 时三项模态，干净直接关闭；与头部关闭按钮/嵌入内
          // Esc/删除拦截同径）。P2-12（#289）冲突三项接真实执行：compare
          // 出站对比请求（宿主开原生对比页），cancel 收起选择保持暂停与
          // 输入，discard 走恢复通道（sync.request → resync 放弃未提交输入
          // 版本）——与暂停状态行选择条按钮同一处理器
          case 'embedSaveTarget': this.embedCards?.focusedLiveSave(); break
          case 'embedClose': this.embedCards?.closeFocused(); break
          case 'conflictCompare': this.embedCards?.focusedConflictCompare(); break
          case 'conflictDiscard': this.embedCards?.focusedConflictDiscard(); break
          case 'conflictCancel': this.embedCards?.focusedConflictCancel(); break
          // #221 预览当前链接：命令面板/宿主命令入口与快捷键（keybindingRouter
          // 本地分支）共用同一实现（目标判定在 webview，无目标静默不误开）
          case 'hoverPreviewLink': this.previewLinkAtFocus(); break
          case 'pdfPageNext': turnHoverPdfPage(1); break
          case 'pdfPagePrev': turnHoverPdfPage(-1); break
          // #339 PDF 缩放（命令面板/宿主命令入口与快捷键同一实现）
          case 'pdfZoomIn': zoomHoverPdf(PDF_ZOOM_STEP); break
          case 'pdfZoomOut': zoomHoverPdf(1 / PDF_ZOOM_STEP); break
          case 'pdfZoomReset': resetHoverPdfZoom(); break
          // #237 上下添加光标：命令面板/宿主命令入口与快捷键（keybindingRouter
          // 本地分支）共用同一实现（仅 Live 正文生效，边界见 runCursorAdd）
          case 'addCursorAbove': this.runCursorAdd('addCursorAbove'); break
          case 'addCursorBelow': this.runCursorAdd('addCursorBelow'); break
          // #239 词级移动：命令面板入口（快捷键走 router 本地分支直达，
          // 此处是 keybindings.execute → executeCommand → ui.command 回流
          // 的命令面板路径），同一命令对象
          case 'cursorWordLeft': this.runWordMotion(cursorWordLeft); break
          case 'cursorWordRight': this.runWordMotion(cursorWordRight); break
          case 'selectWordLeft': this.runWordMotion(selectWordLeft); break
          case 'selectWordRight': this.runWordMotion(selectWordRight); break
          // #238 选下一处相同词族：命令面板入口（快捷键走 router 本地分支
          // 直达），与 addCursorAbove 同款「本地消化」链路
          case 'findSelectNext': this.runOccurrenceSelect('next'); break
          case 'findSelectPrevious': this.runOccurrenceSelect('prev'); break
          case 'findSkipCurrent': this.runOccurrenceSelect('skip'); break
          case 'findAllOccurrences': this.runOccurrenceSelect('all'); break
        }
        break
      case 'sidebar.test.click': {
        // 测试钩子（#53）：点击真实侧栏切换按钮（与用户点击同一处理器；
        // 纯视图状态翻转，零写回）
        this.sidebarToggleBtn?.click()
        break
      }
      case 'sidebar.test.resize': {
        // 测试钩子：真实拖宽句柄 pointer 序列驱动拖宽链路（与用户拖拽
        // 同一处理器）
        this.runSidebarResizeTest(message.delta)
        break
      }
      case 'fm.test.click': {
        // 测试钩子（#140 Popover 改版）：驱动修改按钮与 Popover 控件（与
        // 用户点击同一处理器；编辑计划走标准 CM6 事务出站）。按钮按类名
        // + DOM 文档序定位；popover-close 与 Esc 走同一关闭函数
        const at = <T extends HTMLElement>(els: T[], index: number): T | undefined =>
          els[Math.max(0, index)]
        const all = <T extends HTMLElement>(sel: string): T[] =>
          [...document.querySelectorAll<T>(sel)]
        if (message.action === 'edit-button') {
          all<HTMLButtonElement>(`.${FM_CARD_CLASS_NAMES.edit}`)[0]?.click()
          break
        }
        if (message.action === 'fold-button' || message.action === 'fold-hotspot') {
          // 折叠链路驱动（与用户点击同一处理器）：fold-button 点 chevron；
          // fold-hotspot 点标题文字（热区非按钮区域，验证整条热区入口）
          const scope = this.viewMode === 'reading' ? this.readingContainer : this.view?.contentDOM
          const target = message.action === 'fold-button'
            ? scope?.querySelector<HTMLButtonElement>(`.${FM_CARD_CLASS_NAMES.fold}`)
            : scope?.querySelector<HTMLElement>(
              `.${FM_CARD_CLASS_NAMES.header} .${FM_CARD_CLASS_NAMES.headerTitle}`,
            )
          target?.click()
          break
        }
        if (message.action === 'popover-close') {
          closeFmPopover()
          break
        }
        if (message.action === 'popover-add-entry') {
          all<HTMLButtonElement>(`.${FM_POPOVER_CLASS_NAMES.add}`)[0]?.click()
          break
        }
        if (message.action === 'popover-add-item') {
          at(all<HTMLButtonElement>(`.${FM_POPOVER_CLASS_NAMES.addItem}`), message.index ?? 0)?.click()
          break
        }
        // 删除按钮两段式二次确认（产品行为）：钩子驱动完整流程——首击
        // 武装确认态、再击执行；用例断言「删除后状态」不因确认步骤改变
        const clickRemoveConfirmed = (btn: HTMLButtonElement | null | undefined): void => {
          if (!btn) return
          btn.click()
          btn.click()
        }
        if (message.action === 'popover-remove-entry') {
          const entries = all<HTMLElement>(`.${FM_POPOVER_CLASS_NAMES.entry}`)
          const entry = at(entries, message.index ?? 0)
          clickRemoveConfirmed(entry?.querySelector<HTMLButtonElement>(
            `:scope > .${FM_POPOVER_CLASS_NAMES.row} > .${FM_POPOVER_CLASS_NAMES.remove}`))
          break
        }
        const itemRemoves = all<HTMLElement>(`.${FM_POPOVER_CLASS_NAMES.itemRow}`)
          .map((row) => row.querySelector<HTMLButtonElement>(`.${FM_POPOVER_CLASS_NAMES.remove}`))
          .filter((btn): btn is HTMLButtonElement => btn !== null)
        clickRemoveConfirmed(at(itemRemoves, message.index ?? 0))
        break
      }
      case 'view.test.click': {
        // 测试钩子（#141）：点击顶栏双态视图切换真实按钮（与用户点击同一
        // 处理器：出站 view.switch.request，切换由宿主编排回流驱动）
        this.viewToggleBtn?.click()
        break
      }
      case 'refresh.test.click': {
        // 测试钩子（#208）：点击顶栏刷新嵌入资源真实按钮（与用户点击同一
        // 处理器：出站 refresh.request，失效重挂由宿主回发的
        // refresh.invalidated 驱动）
        this.refreshBtn?.click()
        break
      }
      case 'quick.test.click': {
        const selector = message.action === 'toggle' ? '.vsidian-quick-toggle'
          : message.action === 'heading' ? '.vsidian-quick-heading'
            : message.action === 'bold' ? '[data-op="bold"]'
              : `[data-heading-op="${message.action}"]`
        ;(this.mainEl?.querySelector(selector) as HTMLButtonElement | null)?.click()
        break
      }
      case 'outline.test.click': {
        // 测试钩子（#54）：点击真实大纲按钮（与用户点击同一处理器；
        // 纯视图状态翻转，零写回）
        this.outlineToggleBtn?.click()
        break
      }
      case 'outline.test.itemClick': {
        // 测试钩子（#66）：点击第 index 个真实大纲条目，驱动与用户点击
        // 同一面板委托处理器（纯视图跳转，零写回）
        const nodes = this.outlinePanelEl
          ?.querySelectorAll<HTMLElement>(`.${OUTLINE_CLASS_NAMES.item}`)
        nodes?.[message.index]?.click()
        break
      }
      case 'outline.test.expandClick': {
        // 测试钩子（#67）：点击第 level 档真实圆点（click 冒泡到滑块行
        // 委托，与用户点击同一处理器；档位整体替换，纯视图状态零写回）
        this.outlineSlider?.dots[message.level]?.click()
        break
      }
      case 'outline.test.chevronClick': {
        // 测试钩子（#67）：点击第 index 个真实条目的折叠箭头（面板委托
        // 按目标分流：箭头折叠/展开，不触发跳转）
        const itemEl = this.outlinePanelEl
          ?.querySelectorAll<HTMLElement>(`.${OUTLINE_CLASS_NAMES.item}`)[message.index]
        itemEl
          ?.querySelector<HTMLButtonElement>(`.${OUTLINE_CLASS_NAMES.chevron}`)
          ?.click()
        break
      }
      case 'outline.test.searchInput': {
        // 测试钩子（#68）：向真实搜索输入框设值并派发 input 事件（与用户
        // 输入同一处理器；搜索过滤与片段高亮即时重算，纯视图零写回）
        const input = this.outlineToolbar?.search
        if (input) {
          input.value = message.text
          input.dispatchEvent(new Event('input', { bubbles: true }))
        }
        break
      }
      case 'outline.test.toolbarClick': {
        // 测试钩子（#68）：点击工具条真实按钮（与用户点击同一处理器；
        // 跳转到末尾 = 纯视图滚动，重置 = 三合一回到面板初始态）
        if (message.action === 'jump-bottom') {
          this.outlineToolbar?.jumpBottom.click()
        } else if (message.action === 'reset') {
          this.outlineToolbar?.reset.click()
        }
        break
      }
      case 'outline.test.contextMenu': {
        // 测试钩子（#69）：对第 index 个真实条目派发 contextmenu（与用户
        // 右键同一面板委托处理器，菜单弹出）
        const itemEl = this.outlinePanelEl
          ?.querySelectorAll<HTMLElement>(`.${OUTLINE_CLASS_NAMES.item}`)[message.index]
        if (itemEl) {
          const rect = itemEl.getBoundingClientRect()
          itemEl.dispatchEvent(new MouseEvent('contextmenu', {
            bubbles: true, cancelable: true,
            clientX: rect.left + 20, clientY: rect.top + 10,
          }))
        }
        break
      }
      case 'outline.test.menuClick': {
        // 测试钩子（#69）：点击菜单中 command 对应的真实按钮（与用户点击
        // 同一处理器；command 已由协议校验器限定为合法菜单命令）
        this.outlineMenuEl
          ?.querySelector<HTMLButtonElement>(`button[data-vsidian-command="${message.command}"]`)
          ?.click()
        break
      }
      case 'outline.test.menuClose': {
        // 测试钩子（#69）：关闭当前菜单（等价 Esc/外点路径）
        this.closeOutlineMenu()
        break
      }
      case 'find.test.toggle': {
        // 测试钩子（#14/#236）：点击查找面板三开关的真实按钮（与用户点击
        // 同一处理器：本地翻转 + 重算 + findOptions.set 上送宿主持久化）
        const el = message.key === 'matchCase' ? this.findCaseBtnEl
          : message.key === 'wholeWord' ? this.findWordBtnEl
            : this.findRegexpBtnEl
        el?.click()
        break
      }
      case 'contextMenu.test.contextMenu': {
        // 测试钩子（#183）：在正文 doc 偏移 pos 处打开统一菜单（与用户右键
        // 同一命中判定与装配链路——posAtCoords 的替代注入点；宿主测试无法
        // 向 webview 派发真实鼠标事件，不接管位同样不开菜单）。目标 = 主
        // 正文（嵌入实例经 embed.test 族 + 真实 contextmenu 事件驱动）
        const view = this.view
        if (!view) {
          break
        }
        const snapshot = this.contextSnapshotAt(view, message.pos)
        if (snapshot) {
          this.openContextMenu(snapshot, 24, 24, view)
        }
        break
      }
      case 'contextMenu.test.menuClick': {
        // 测试钩子（#183）：点击菜单中 command 对应的真实按钮（与用户点击
        // 同一处理器；command 已由协议校验器限定为非空字符串——含运行期
        // 注册项；CSS.escape 防拼接值含选择器元字符时 querySelector 抛错）
        this.contextMenuEl
          ?.querySelector<HTMLButtonElement>(`button[data-vsidian-command="${CSS.escape(message.command)}"]`)
          ?.click()
        break
      }
      case 'contextMenu.test.menuClose': {
        // 测试钩子（#183）：关闭当前统一菜单（等价 Esc/外点路径）
        this.closeContextMenu()
        break
      }
      case 'clipboard.read.result': {
        // #183 粘贴桥回包：reqId 陈旧即丢弃。消费即推进（不回退清零）——
        // 回退会让下一次粘贴复用旧 reqId，旧回包重放成为可能。P2-10：插入
        // 目标 = 发起时捕获的目标（#314 起为身份快照对象；回包时实例已
        // 释放/文档已变则经 clipboardTargetValid 放弃——不落回主编辑器）
        if (message.reqId !== this.clipboardReadReqId) {
          break
        }
        this.clipboardReadReqId += 1
        const target = this.clipboardReadTarget
        this.clipboardReadTarget = undefined
        if (!message.ok) {
          // 只读失败告警不弹窗（与未知命令的 console.warn 同口径——
          // review-loops 修复：此前零日志，粘贴无反应无从定位）
          console.warn('[vsidian] 剪贴板读取失败，粘贴放弃（宿主 readText 失败或端口未接线）')
          break
        }
        if (!target || !this.clipboardTargetValid(target)) {
          break
        }
        // 光标处插入（选区被替换——与原生粘贴同语义）；单笔事务走标准出站
        try {
          if (message.text) dispatchClipboardPaste(target.view.contentDOM, { text: message.text, images: [] }, true)
        } catch (error) {
          console.error('[vsidian] 粘贴插入失败（坐标与当前文档不匹配）', error)
        }
        break
      }
      case 'paste.preferences.result':
        if (!message.ok && message.reqId === this.pastePreferenceReqId) {
          this.toast?.show(t('toast.pastePreferencesFailed'), 'error')
        }
        break
      case 'outline.test.renameKey': {
        // 测试钩子（#69）：向重命名输入框注入文本并以 Enter/Esc 收尾
        // （真实 keydown 链路）
        const input = this.outlinePanelEl?.querySelector<HTMLInputElement>(
          `.${OUTLINE_MENU_CLASS_NAMES.renameInput}`,
        )
        if (input) {
          input.value = message.text
          input.dispatchEvent(new KeyboardEvent('keydown', {
            key: message.key === 'enter' ? 'Enter' : 'Escape',
            bubbles: true, cancelable: true,
          }))
        }
        break
      }
      case 'outline.test.drag': {
        // 测试钩子（#70）：真实条目 pointer 事件序列驱动拖拽链路（与用户
        // 拖拽同一处理器）；宿主测试无法向 webview 派发真实鼠标事件
        this.runOutlineDragTest(message.from, message.to, message.position, message.action)
        break
      }
      case 'viewport.test.position': {
        this.viewportProbeEnabled = true
        const view = this.view
        if (view && this.viewMode === 'live') {
          if (message.cursorLine !== undefined) {
            const line = Math.max(1, Math.min(view.state.doc.lines, message.cursorLine))
            view.dispatch({ selection: { anchor: view.state.doc.line(line).from } })
          }
          if (message.scrollNearLine !== undefined) {
            const line = Math.max(1, Math.min(view.state.doc.lines, message.scrollNearLine))
            const block = view.lineBlockAt(view.state.doc.line(line).from)
            view.scrollDOM.scrollTop = Math.max(0,
              block.top + block.height / 2 - view.scrollDOM.clientHeight / 2 +
              (message.scrollBiasPx ?? 0))
            view.scrollDOM.dispatchEvent(new Event('scroll'))
          }
        }
        break
      }
      case 'table.test.key': {
        // 测试钩子：向真实编辑器派发 keydown，走用户按键的同一 keymap 链路。
        if (this.view) {
          this.view.contentDOM.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: message.key === 'select-all' ? 'a' : message.key === 'backspace' ? 'Backspace'
                : message.key === 'delete' ? 'Delete' : message.key === 'enter' ? 'Enter' : 'Tab',
              ctrlKey: message.key === 'select-all',
              shiftKey: message.key === 'shift-tab',
              bubbles: true,
              cancelable: true,
            }),
          )
        }
        break
      }
      case 'table.test.cellClick': {
        if (this.view && this.viewMode === 'live') {
          const row = this.view.contentDOM.querySelectorAll<HTMLElement>('.vsidian-table-grid-row')[message.rowIndex]
          const cell = row?.querySelectorAll<HTMLElement>(':scope > .vsidian-table-grid-cell')[message.columnIndex]
          if (cell) {
            const rect = cell.getBoundingClientRect()
            const x = rect.left + Math.min(message.point === 'right-edge' ? rect.width - 2
              : message.point === 'middle' ? 35 : 15,
              Math.max(1, rect.width - 1))
            const y = rect.top + rect.height / 2
            cell.dispatchEvent(new MouseEvent('mousedown', {
              bubbles: true, cancelable: true, button: 0, buttons: 1, clientX: x, clientY: y,
            }))
            const settledRow = this.view.contentDOM.querySelectorAll<HTMLElement>('.vsidian-table-grid-row')[message.rowIndex]
            const settledCell = settledRow?.querySelectorAll<HTMLElement>(':scope > .vsidian-table-grid-cell')[message.columnIndex]
            settledCell?.dispatchEvent(new MouseEvent('mouseup', {
              bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y,
            }))
          }
        }
        break
      }
      case 'table.test.crossSelect': {
        if (this.view && message.anchor <= this.view.state.doc.length &&
            message.head <= this.view.state.doc.length) {
          this.view.dispatch({
            selection: EditorSelection.single(message.anchor, message.head),
            userEvent: 'select.pointer',
          })
        }
        break
      }
      case 'table.test.type': {
        if (this.view && this.viewMode === 'live') {
          const range = this.view.state.selection.main
          this.view.dispatch({
            changes: { from: range.from, to: range.to, insert: message.text },
            userEvent: 'input.type',
          })
        }
        break
      }
      case 'table.test.domType': {
        if (this.view && this.viewMode === 'live') {
          // 测试用浏览器内容可编辑输入路径；源码事务注入无法观测原生 DOM caret。
          if (document.activeElement !== this.view.contentDOM) this.view.focus()
          document.execCommand('insertText', false, message.text)
        }
        break
      }
      case 'table.test.history': {
        // 测试钩子（#148）：直调撤销/重做转发入口（keymap 绑定由单元测试
        // 钉住）。不派发 keydown——真宿主内 webview 会把按键事件转发给宿主
        // 键绑定服务，合成 Ctrl+Z 会额外触发一次全局 undo（双撤销）
        this.live?.requestHistory(message.op)
        break
      }
      case 'table.test.compose': {
        // 测试钩子（#148）：派发合成 IME 组合序列——组合净输入攒入
        // deferredLocal 暂缓出站，宿主测试以此驱动真实 webview 的组合
        // 竞态窗口（宿主无法驱动真实 IME）
        if (this.view && this.viewMode === 'live' && message.from <= this.view.state.doc.length) {
          this.view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart'))
          this.view.dispatch({
            changes: { from: message.from, insert: message.text },
            userEvent: 'input.type.compose',
          })
          this.view.contentDOM.dispatchEvent(new CompositionEvent('compositionend'))
        }
        break
      }
      case 'table.test.select': {
        const view = this.view
        if (view && this.viewMode === 'live') queueMicrotask(() => {
          if (this.view !== view) return
          const selector = message.axis === 'row'
            ? '.vsidian-table-row-handle' : '.vsidian-table-column-handle'
          view.dom.querySelectorAll<HTMLButtonElement>(selector)[message.index]?.click()
        })
        break
      }
      case 'table.test.drag': {
        // 测试钩子（#43）：在真实宿主 webview 中向点阵抓手派发鼠标指针序列。
        // 仍经控件的 pointerdown/move/up 与 CM6 标准写回链路。
        const view = this.view
        if (view && this.viewMode === 'live') queueMicrotask(() => {
          if (this.view !== view) return
          const grips = [...view.dom.querySelectorAll<HTMLElement>('.vsidian-table-row-handle')]
          const rows = [...view.contentDOM.querySelectorAll<HTMLElement>('.vsidian-table-grid-row')]
          const source = grips[message.sourceIndex]
          const target = rows[Math.min(message.targetSlot, rows.length - 1)]
          if (!source || !target || message.targetSlot > rows.length) return
          const sourceRect = source.getBoundingClientRect()
          const targetRect = target.getBoundingClientRect()
          const x = targetRect.left + Math.max(1, targetRect.width / 2)
          const startY = sourceRect.top + sourceRect.height / 2
          const endY = message.targetSlot === rows.length
            ? targetRect.bottom - 2 : targetRect.top + 2
          source.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true, cancelable: true, clientX: x, clientY: startY,
          }))
          target.dispatchEvent(new PointerEvent('pointermove', {
            bubbles: true, clientX: x, clientY: endY,
          }))
          document.dispatchEvent(new PointerEvent('pointerup', {
            bubbles: true, clientX: x, clientY: endY,
          }))
        })
        break
      }
      case 'sync.test.edit': {
        if (this.view && this.viewMode === 'live') {
          const at = this.clampToDoc(message.offset)
          this.view.dispatch({ changes: { from: at, insert: message.text } })
          if (message.closeAfter && this.sessionId) {
            this.bridge.postMessage({ kind: 'sync.test.close', sessionId: this.sessionId, docUri: this.docUri })
          }
        }
        break
      }
      case 'sync.test.composition': {
        const view = this.view
        if (!view || this.viewMode !== 'live') break
        if (message.phase === 'start') {
          view.focus()
          view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        } else if (message.phase === 'update') {
          const line = view.contentDOM.querySelector('.cm-line')
          if (line) {
            line.replaceChildren(document.createTextNode(message.text))
            const node = line.firstChild!
            document.getSelection()?.setBaseAndExtent(node, message.text.length, node, message.text.length)
            view.contentDOM.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: message.text, isComposing: true }))
          }
        } else {
          view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: message.text }))
        }
        break
      }
      case 'link.test.mousedown': {
        if (this.view && this.viewMode === 'live') {
          const selector = message.target === 'wikilink'
            ? '[data-vsidian-rendered-wikilink="true"]'
            : '[data-vsidian-rendered-link="true"]'
          const target = this.view.dom.querySelectorAll<HTMLElement>(selector)[message.index]
          if (target) {
            const rect = target.getBoundingClientRect()
            const mouse = {
              bubbles: true,
              cancelable: true,
              button: 0,
              ctrlKey: message.ctrlKey === true,
              clientX: rect.left + rect.width / 2,
              clientY: rect.top + rect.height / 2,
            }
            target.dispatchEvent(new MouseEvent('mousedown', mouse))
            this.view.contentDOM.dispatchEvent(new MouseEvent('mouseup', mouse))
          }
        }
        break
      }
      case 'view.locate': {
        // 定位（#10 查找/跳转入口）：光标移到源 offset；reading 滚动到块。
        // 纯视图操作——事务不带 changes，不产生编辑历史。head（#318）
        // 携带时 live 落位区间选区（外部搜索导航恢复匹配选区）
        this.locateOffset(message.offset, true, message.head)
        // 送达确认（#163 验收反馈）：offset 原样回发（对账不受 clamp/块化
        // 影响）——宿主停发补发，此后重载恢复走持久化锚点，历史程序定位
        // 不再重播、不拉回用户已手动离开的位置
        this.bridge.postMessage({ kind: 'view.locate.ack', offset: message.offset })
        break
      }
      case 'reading.perf': {
        // 阅读视图性能探针（#7）：往返滚动观测挂载/回收/解析；纯视图滚动
        const container = this.readingContainer
        const rview = this.readingView
        if (this.viewMode === 'reading' && rview && container) {
          void runReadingPerfProbe(rview, container, {
            scrollRounds: message.scrollRounds,
          }).then((report) => this.bridge.postMessage(report))
        } else {
          const empty = {
            mountedBlocks: 0,
            contentDomCount: 0,
            scrollTopPx: 0,
            scrollHeightPx: 0,
          }
          this.bridge.postMessage({
            kind: 'reading.perf.report',
            scrollRounds: message.scrollRounds,
            totalBlocks: 0,
            baseline: empty,
            afterScroll: empty,
            parseCount: 0,
            maxMountedBlocks: 0,
            ok: false,
          })
        }
        break
      }
      case 'reading.test.image':
        // 测试钩子（#7）：图片加载后布局变化的模拟载体（不产生写回）
        if (this.viewMode === 'reading' && this.readingView) {
          this.readingView.injectTestImage(
            message.srcStart,
            message.initialHeightPx,
            message.finalHeightPx,
            message.delayMs,
          )
        }
        break
      case 'task.test.click': {
        // 测试钩子（#9）：按视图与序号点击真实任务 checkbox（宿主测试无法
        // 向 webview 派发真实鼠标事件；此通道驱动与用户点击同一处理器）
        const root =
          message.view === 'reading'
            ? this.readingContainer ?? undefined
            : this.view?.dom
        const cls =
          message.view === 'reading'
            ? READING_MARKDOWN_CLASS_NAMES.taskCheckbox
            : LIVE_CLASS_NAMES.taskCheckbox
        const boxes = root?.querySelectorAll<HTMLInputElement>(`input.${cls}`)
        boxes?.[message.index]?.click()
        break
      }
      case 'codecard.test.copy': {
        // 测试钩子（#81）：按序号点击卡片头部复制按钮（驱动与用户点击相同
        // 的处理器链路：effect → codeblock.copy 出站 → 宿主剪贴板写入）
        const scope = this.viewMode === 'reading' ? this.readingContainer : this.view?.contentDOM
        const buttons = scope?.querySelectorAll<HTMLButtonElement>(
          `.${CODE_CARD_CLASS_NAMES.copy}`,
        )
        buttons?.[message.index]?.click()
        break
      }
      case 'codecard.test.fold': {
        // 测试钩子（#82）：按序号点击卡片头部折叠 chevron（驱动与用户点击
        // 相同的处理器链路：effect → codeCardFoldField 视图态切换）
        const scope = this.viewMode === 'reading' ? this.readingContainer : this.view?.contentDOM
        const buttons = scope?.querySelectorAll<HTMLButtonElement>(
          `.${CODE_CARD_CLASS_NAMES.fold}`,
        )
        buttons?.[message.index]?.click()
        break
      }
      case 'graphic.test.popup': {
        // 测试钩子（#111）：按序号点击图形化代码块 popup 按钮（驱动与用户
        // 点击相同的处理器链路：打开图表弹窗）；action 存在时改为点击弹窗
        // 工具条按钮（导出按钮驱动导出链路的消息形态；refresh 驱动弹窗
        // 原地重取源码刷新——#133 样式保持验证）。action 路径不重开弹窗
        // ——单例重开会清空快照，点击会落在装载完成前
        if (message.action) {
          const cls = message.action === 'export-png'
            ? DIAGRAM_POPUP_CLASS_NAMES.exportPng
            : message.action === 'export-svg'
              ? DIAGRAM_POPUP_CLASS_NAMES.exportSvg
              : message.action === 'close'
                ? DIAGRAM_POPUP_CLASS_NAMES.close
                : DIAGRAM_POPUP_CLASS_NAMES.refresh
          document.querySelector<HTMLButtonElement>(`.${cls}`)?.click()
          break
        }
        if (this.viewMode === message.view) {
          const scope = this.viewMode === 'reading' ? this.readingContainer : this.view?.contentDOM
          const buttons = scope?.querySelectorAll<HTMLButtonElement>(
            `.${GRAPHIC_CHROME_CLASS_NAMES.popup}`,
          )
          buttons?.[message.index]?.click()
        }
        break
      }
      case 'diagram.export.result':
        // 通知性消息（#111）：导出失败/取消由宿主通知呈现，弹窗侧无 UI
        // 反馈需求——显式消费为 no-op，避免落入未处理分支
        break
      case 'image.export.result':
        // 通知性消息（#212）：与 diagram.export.result 同口径——失败/取消
        // 由宿主通知呈现，弹窗侧无 UI 反馈需求
        break
      case 'image.test.popup': {
        // 测试钩子（#212）：按序号点击图片 popup 按钮（驱动与用户点击相同
        // 的处理器链路：打开图片弹窗）；action 存在时改为点击弹窗工具条
        // 按钮（export 驱动导出消息形态；refresh 驱动按当前文档重定位
        // 重取）。action 路径不重开弹窗（单例重开会清空快照）。图片按钮
        // 组宿主是 frame.vsidian-image（与 mermaid 的 frame 区分）
        if (message.action) {
          const cls = message.action === 'export'
            ? IMAGE_POPUP_EXPORT_CLASS
            : message.action === 'close'
              ? DIAGRAM_POPUP_CLASS_NAMES.close
              : DIAGRAM_POPUP_CLASS_NAMES.refresh
          document.querySelector<HTMLButtonElement>(`.${cls}`)?.click()
          break
        }
        if (this.viewMode === message.view) {
          const scope = this.viewMode === 'reading' ? this.readingContainer : this.view?.contentDOM
          const buttons = scope?.querySelectorAll<HTMLButtonElement>(
            `.${GRAPHIC_CHROME_CLASS_NAMES.frame}.${IMAGE_CLASS_NAMES.image} .${GRAPHIC_CHROME_CLASS_NAMES.popup}`,
          )
          buttons?.[message.index]?.click()
        }
        break
      }
      case 'image.result':
        // #10 图片解析结果路由（只读显示通道：暂停态同样可用）。#220 起同
        // 步投递悬停浮层的 B 身份管理器（浮层内图片；未知 reqId 由两侧管理
        // 器各自丢弃，双投递安全）
        this.images?.handleResult(message)
        notifyHoverImageResult(message)
        this.embedCards?.notifyImageResult(message)
        break
      case 'image.invalidate':
        // #201 失效通知：作废命中条目并重发请求（新版本 URL；旧 reqId 在途
        // 结果由代次守卫丢弃）。只读显示通道，暂停态同样可用。#220 浮层内
        // B 图片同口径失效（命中条目重发 B 身份请求）
        this.images?.invalidate(message.srcs)
        notifyHoverImageInvalidate(message.srcs)
        this.embedCards?.notifyImageInvalidate(message.srcs)
        break
      case 'image.wake':
        // #201 及时核验：窗口焦点回归/远程重连，有活跃图源立即触发一轮
        this.imageVerify?.wake()
        break
      case 'refresh.invalidated':
        // #208 手动刷新失效通知（refresh.request 的应答，宿主已清解析
        // 缓存并推进代次）：reqId 与面板最后发出的请求配对——刷新后又有
        // 新请求时，旧回执在观测层丢弃（失效动作幂等，防护只挡迟到回执
        // 的误触发）。配对通过后：图片条目全量失效重挂——活跃槽位重新走
        // 解析（新 reqId，新 URI 带新代次戳）；Mermaid 懒加载失败终态重置
        // 并立即重画已降级容器（无需滚动触发）。刷新不触碰文档/撤销栈/
        // 视图状态（光标、滚动、模式原样保持）
        if (message.reqId !== this.refreshReqId) {
          break
        }
        this.images?.invalidateAll()
        // #220 手动刷新全局失效：浮层内 B 图片同口径全量重挂（新代次戳 URI）
        invalidateHoverPopupImages()
        // #222 嵌入卡片内 B 图片同口径全量重挂
        this.embedCards?.invalidateImages()
        resetMermaidLoadFailure()
        break
      case 'view.state.request': {
        // 查找观测前同步校验新鲜度（文档变化后微任务可能尚未执行）；
        // 此处不在 CM6 update 内，可以安全 dispatch 纯 effect 事务
        if (this.findOpen) {
          this.findEnsureFresh()
          this.findRender()
        }
        this.reportViewState()
        break
      }
      case 'perf.probe': {
        // 异步执行（含 rAF 等待），完成后回报 perf.report（#5 性能测量通道）
        const view = this.view
        if (view) {
          void runPerfProbe(view, {
            typingRounds: message.typingRounds,
            scrollRounds: message.scrollRounds,
          }).then((report) => this.bridge.postMessage(report))
        }
        break
      }
    }
  }

  /**
   * 视图状态回报（view.state）：宿主按需请求（view.state.request）与本控制
   * 器主动推送（模式切换后）共用。主动推送让宿主的模式缓存常新——表格
   * 结构命令等宿主侧写操作据此在 reading 面板上给出可见反馈（不再静默
   * 丢弃后虚报成功）。
   */
  private reportViewState(): void {
    const doc = this.view?.state.doc
    const content = this.view?.dom.querySelector('.cm-content')
    let selectedGridRow: HTMLElement | null = null
    if (this.view && this.viewMode === 'live') {
      try {
        const node = this.view.domAtPos(this.view.state.selection.main.from).node
        selectedGridRow = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>('.cm-line') ?? null
      } catch {
        // 屏外选区没有 DOM；表格探针仅报告当前已挂载节点。
      }
    }
    const tableGrid = {
      visibleRows: content?.querySelectorAll('.vsidian-table-grid-row').length ?? 0,
      selectedRowIsGrid: selectedGridRow?.classList.contains('vsidian-table-grid-row') ?? false,
      selectedRowCells: selectedGridRow
        ? [...selectedGridRow.querySelectorAll<HTMLElement>(':scope > .vsidian-table-grid-cell')]
          .map((cell) => cell.textContent ?? '')
        : [],
      rowHandles: this.view?.dom.querySelectorAll('.vsidian-table-row-handle').length ?? 0,
    }
    // 标题装饰的可观测 DOM 文本：活动（源码态）与非活动（隐藏标记）
    // 各取第一个样本，供集成测试断言 Live Preview 语义
    let headingActiveText: string | undefined
    let headingHiddenText: string | undefined
    if (content) {
      for (const el of Array.from(content.querySelectorAll<HTMLElement>('.vsidian-heading-line'))) {
        const text = el.textContent ?? ''
        if (text.startsWith('#')) {
          headingActiveText ??= text
        } else {
          headingHiddenText ??= text
        }
        if (headingActiveText !== undefined && headingHiddenText !== undefined) {
          break
        }
      }
    }
    const headingElement = this.viewMode === 'reading'
      ? this.readingContainer?.querySelector<HTMLElement>('.vsidian-reading-heading-1 h1')
      : content?.querySelector<HTMLElement>('.vsidian-heading-line-1')
    const headingFontPx = headingElement
      ? Number.parseFloat(window.getComputedStyle(headingElement).fontSize)
      : undefined
    const readingActive = this.viewMode === 'reading' && this.readingView
    const rStats = readingActive ? this.readingView!.getStats() : undefined
    const rScroll = readingActive ? this.readingView!.getScrollObservation() : undefined
    // 锚点块 start 经源 offset → 块身份的纯数据映射（不依赖布局；
    // 虚拟化下含未挂载目标——块模型是映射依据）
    const readingAnchorStart =
      readingActive && this.modeAnchor !== null
        ? (this.readingView!.anchorStartFor(this.clampToDoc(this.modeAnchor)) ?? undefined)
        : undefined
    // 锚点块的布局顶部位置（挂载时取真实 offsetTop 语义；未挂载为 undefined）
    let readingAnchorTopPx: number | undefined
    if (readingActive && readingAnchorStart !== undefined && this.readingContainer) {
      const el = this.readingContainer.querySelector<HTMLElement>(
        `.vsidian-reading-block[data-vsidian-src-start="${readingAnchorStart}"]`,
      )
      if (el) {
        const box = this.readingContainer.getBoundingClientRect()
        readingAnchorTopPx = el.getBoundingClientRect().top - box.top + this.readingContainer.scrollTop
      }
    }
    const liveView = this.viewMode === 'live' ? this.view : undefined
    const liveCenterPos = this.viewportProbeEnabled ? this.liveViewportCenterPosition() : null
    // #32：typography 为 view.state 正式可选字段（协议校验器见
    // shared/protocol.ts 的 isTypographyProbe）
    const state: Extract<WebviewToHost, { kind: 'view.state' }> = {
      kind: 'view.state',
      ...(this.diagnostics.enabled ? { diagnostics: this.diagnostics.snapshot() } : {}),
      text: doc?.toString() ?? '',
      docLength: doc?.length ?? 0,
      lineCount: doc?.lines ?? 0,
      renderedLines: this.view?.dom.querySelectorAll('.cm-line').length ?? 0,
      suspended: this.suspended,
      contentDomCount: content ? content.querySelectorAll('*').length : 0,
      headingLineCount: content ? content.querySelectorAll('.vsidian-heading-line').length : 0,
      headingActiveText,
      headingHiddenText,
      headingFontPx,
      viewMode: this.viewMode,
      selectionOffset: this.view?.state.selection.main.from ?? 0,
      wordSegmenter: typeof Intl.Segmenter === 'function',
      wasmCompile: probeWebviewWasmCompile(),
      jiebaEngine: activeWordSegmentEngine(),
      selectionHead: this.view?.state.selection.main.head ?? 0,
      selectionAssoc: this.view?.state.selection.main.assoc ?? 0,
      liveViewportCenterLine: liveCenterPos === null ? undefined : liveView?.state.doc.lineAt(liveCenterPos).number,
      liveScrollTopPx: this.viewportProbeEnabled ? liveView?.scrollDOM.scrollTop : undefined,
      readingBlockCount: rStats?.mountedBlocks ?? 0,
      readingAnchorStart,
      // #7 按需挂载观测：块模型总量/挂载量/DOM 计数/解析次数/虚拟化状态
      readingTotalBlocks: rStats?.totalBlocks,
      readingMountedBlocks: rStats?.mountedBlocks,
      readingContentDomCount: rStats?.contentDomCount,
      readingParseCount: rStats?.parseCount,
      readingVirtualized: rStats?.virtualized,
      readingAnchorTopPx,
      readingScrollTopPx: rScroll?.scrollTop,
      readingScrollHeightPx: rScroll?.scrollHeight,
      readingFindHitBlocks: readingActive && this.readingContainer
        ? this.readingContainer.querySelectorAll('.vsidian-reading-find-hit').length
        : undefined,
      cssProbe: this.collectCssProbe(),
      liveSyntax: this.collectLiveSyntax(),
      tableGrid,
      readingSyntax: this.viewMode === 'reading' ? this.collectReadingSyntax() : undefined,
      // #10 链接/图片观测（DOM 级：live 限视口，reading 限挂载块）
      liveLinkCount: content ? content.querySelectorAll('.vsidian-link').length : 0,
      liveImageCount: content ? content.querySelectorAll('.vsidian-image').length : 0,
      // #11 双链观测（live：范围外 widget + 范围内 mark；reading：a）
      liveWikilinkCount: content
        ? content.querySelectorAll(`.${WIKILINK_CLASS_NAMES.wikilink}`).length
        : 0,
      // #59 公式观测（live：视口内 KaTeX widget/降级 span；reading：挂载块内）
      liveMathCount: content
        ? content.querySelectorAll(`.${MATH_CLASS_NAMES.math}, .${MATH_CLASS_NAMES.mathError}`).length
        : 0,
      readingMathCount: readingActive
        ? this.readingContainer!.querySelectorAll(`.${MATH_CLASS_NAMES.math}, .${MATH_CLASS_NAMES.mathError}`).length
        : 0,
      // #60 Mermaid 观测（live：视口内渲染 widget/降级容器；reading：挂载块内）
      liveMermaidCount: content
        ? content.querySelectorAll(`.${MERMAID_CLASS_NAMES.diagram}`).length
        : 0,
      readingMermaidCount: readingActive
        ? this.readingContainer!.querySelectorAll(`.${MERMAID_CLASS_NAMES.diagram}`).length
        : 0,
      readingLinkCount: readingActive
        ? this.readingContainer!.querySelectorAll('a').length
        : 0,
      readingImageCount: readingActive
        ? this.readingContainer!.querySelectorAll('img').length
        : 0,
      readingWikilinkCount: readingActive
        ? this.readingContainer!.querySelectorAll(`a.${WIKILINK_CLASS_NAMES.wikilink}`).length
        : 0,
      // 图片状态计数按当前视图作用域（隐藏视图的槽位不计入——同一管理器
      // 服务双视图，隐藏侧的 DOM 不代表用户可见状态）
      imageStates: this.collectImageStates(),
      imageEntries: this.images?.activeEntries(),
      imageProbe: this.collectImageProbe(),
      find: this.collectFindProbe(),
      // #238 选词会话观测：选项条在场态与三开关（与 findOptions 同源）
      occurrence: this.collectOccurrenceProbe(),
      typography: this.collectTypography(),
      // #33 设置快照缓存（宿主下发过才有值；缺省向后兼容）
      settings: this.settings,
      // #34 行号栏观测（开关态与视口内渲染结果）
      lineGutter: this.collectLineGutter(),
      // 绘制层探针（P0 回归）：正文可见性 / CM6 注入样式存活 / 行号禁选
      paint: this.collectPaint(),
      // #53 右侧栏观测（布局态与绘制层证据）
      sidebar: this.collectSidebar(),
      // #54 大纲观测（面板态、绘制层证据与全文标题序列）
      outline: this.collectOutline(),
      // #197 反链面板观测（面板态、四态实值与绘制层证据）
      backlinks: this.collectBacklinks(),
      outlinks: this.collectOutlinks(),
      // #140 Popover 改版：属性编辑浮层开态（集成断言用）
      fmPopoverOpen: isFmPopoverOpen(),
      // #218 悬停预览观测：浮层开闭、内容态与块数（集成断言用）
      hoverPreview: hoverPopupProbe(),
      // #299 跳转目标提示观测：在场与路径文本（集成断言用——真实宿主
      // 悬停链路的观测面，轻量解析回包经此可见）
      targetTip: targetTipProbe(),
      // #222 嵌入卡片观测：在场卡片的状态/目标/块数/fm/限高（集成断言用）
      readingEmbed: this.embedCards?.probe() ?? [],
      // #223 Live 嵌入显隐观测：嵌入表逐枚的源码显形态（集成断言用）
      liveEmbedReveal: this.collectLiveEmbedReveal(),
    }
    this.bridge.postMessage(state)
  }

  /** #223 Live 嵌入显隐探针：嵌入表 + 当前选区按 selectionTouchesRange 语义
   *  计算的源码显形态（发射层围栏/fm 排除由单测与浏览器套件钉住，此处为
   *  宿主可观测的显隐面） */
  private collectLiveEmbedReveal(): Array<{ inner: string; line: number; revealed: boolean }> {
    const view = this.view
    if (!view || this.viewMode !== 'live') {
      return []
    }
    const spans = view.state.field(liveEmbedSpansField, false)
    if (!spans) {
      return []
    }
    return spans.map((s) => ({
      inner: s.inner,
      line: view.state.doc.lineAt(Math.min(s.lineFrom, view.state.doc.length)).number,
      revealed: selectionTouchesRange(view.state.selection, s.from, s.to),
    }))
  }


  // ---- #292 加载期骨架屏：收编与撤除（规格 docs/specs/skeleton-screen.md）----
  // 空窗①由宿主内联装配覆盖（skeletonScreen.ts）；这里只承接空窗②——
  // 挂载收编与撤除调度（首帧 + 扫光收束规则）。收编落点是 .vsidian-main
  // （工具栏下方的覆盖层，top 按活跃视图容器实测偏移）：不进视图容器——
  // 阅读虚拟化 setDocument 以 textContent='' 整容器清空子树，进容器会被
  // init 首次渲染误清除。

  /** 空窗②收编：初始 HTML 的骨架移入主编辑区，只盖内容区、与真实工具栏
   *  共存（.vsidian-skeleton-host 提供定位包含块，top 取活跃视图容器相对
   *  主区的偏移，适应 quickActions 展开等行高变化）。宿主 HTML 未含骨架
   *  （设置页/旧产物）时跳过。收编后用户切模式：覆盖层与模式无关，撤除
   *  计时照常走完。 */
  private adoptSkeleton(): void {
    const el = document.getElementById(SKELETON_ELEMENT_ID)
    if (!(el instanceof HTMLElement) || !this.mainEl) {
      return
    }
    const shownAt = (globalThis as Record<string, unknown>)[SKELETON_SHOWN_AT_GLOBAL]
    this.skeletonShownAt = typeof shownAt === 'number' && Number.isFinite(shownAt)
      ? shownAt
      : performance.now()
    this.skeletonContainer = this.viewMode === 'reading' ? 'reading' : 'live'
    this.mainEl.classList.add('vsidian-skeleton-host')
    // 覆盖层顶沿对齐活跃视图容器顶沿（工具栏/快速操作行之下）；jsdom 等
    // 无布局环境矩形全零，退化为 top:0
    const viewEl = this.skeletonContainer === 'reading' ? this.readingContainer : this.liveWrapper
    if (viewEl) {
      const hostTop = this.mainEl.getBoundingClientRect().top
      const viewTop = viewEl.getBoundingClientRect().top
      el.style.top = `${Math.max(0, viewTop - hostTop)}px`
    }
    this.mainEl.appendChild(el)
    this.skeletonEl = el
    this.reportSkeletonState()
  }

  /** 撤除调度：全文落地后双 rAF（readingProbe 同款）取就绪时刻，按
   *  planSkeletonExit 定时移除。幂等；测试冻结期间只回报不撤除。 */
  private scheduleSkeletonExit(): void {
    if (!this.skeletonEl || this.skeletonExitScheduled) {
      return
    }
    this.skeletonExitScheduled = true
    scheduleFrame(() => scheduleFrame(() => {
      if (!this.skeletonEl) {
        return
      }
      if (this.skeletonHoldActive()) {
        this.reportSkeletonState()
        return
      }
      const readyAt = performance.now()
      const reducedMotion = typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const plan = planSkeletonExit({
        shownAt: this.skeletonShownAt ?? readyAt,
        readyAt,
        reducedMotion,
      })
      this.skeletonExitTimer = setTimeout(
        () => this.dismissSkeleton(),
        Math.max(0, plan.removeAt - performance.now()),
      )
    }))
  }

  /** 撤除骨架并还原主区定位包含块（容器布局回到骨架出现前的形态）。 */
  private dismissSkeleton(): void {
    if (this.skeletonExitTimer !== undefined) {
      clearTimeout(this.skeletonExitTimer)
      this.skeletonExitTimer = undefined
    }
    if (!this.skeletonEl) {
      return
    }
    this.skeletonEl.remove()
    this.skeletonEl = null
    this.skeletonContainer = null
    this.mainEl?.classList.remove('vsidian-skeleton-host')
    this.reportSkeletonState()
  }

  /** 测试冻结在位判定：宿主 HTML 嵌入 hold 全局（仅 VSIDIAN_TEST_HOOKS
   *  装配写入）且尚未收到 release。生产环境恒 false。 */
  private skeletonHoldActive(): boolean {
    return !this.skeletonHoldReleased &&
      (globalThis as Record<string, unknown>)[SKELETON_HOLD_GLOBAL] === true
  }

  /** 状态回报（测试钩子）：仅在宿主嵌入 hold 全局时出站——生产零消息。 */
  private reportSkeletonState(): void {
    if ((globalThis as Record<string, unknown>)[SKELETON_HOLD_GLOBAL] !== true) {
      return
    }
    this.bridge.postMessage({
      kind: '_test.skeleton.report',
      present: this.skeletonEl !== null,
      container: this.skeletonContainer,
      shownAt: this.skeletonShownAt,
    })
  }

  // ---- 视图模式状态机（#6）----
  // 模式是纯 webview 视图状态：切换绝不 dispatch 文本变更（不入撤销栈、
  // 不触发保存、未保存内容原地保留），只做容器显隐、锚点映射与选区恢复。
  // 宿主 TextDocument 版本因此不受切换影响。

  /** 切换入口（宿主 view.mode.set 消息驱动；#38 起由宿主标题栏三态命令
   *  与命令面板命令编排，webview 工具栏已移除） */
  private setViewMode(target: 'live' | 'reading' | 'toggle'): void {
    this.keybindingRouter.cancel()
    // #238 切换模式 = 离开 Live 编辑域，选词会话结束（选项条淡出）
    this.endOccurrenceSession()
    const next: ViewMode =
      target === 'toggle' ? (this.viewMode === 'live' ? 'reading' : 'live') : target
    if (next === this.viewMode) {
      this.persistState()
      return
    }
    this.pasteModeRevision += 1
    this.clipboardReadReqId += 1
    this.richPasteDialog?.cancel(false)
    // review-loops B3：命令面板切模式不经鼠标路径（无 pointercancel），
    // 拖拽会话若残留会跨模式存活（落点判定随视图重算漂移）——统一取消
    this.cancelOutlineDrag()
    // #69/#183：右键菜单（大纲与正文统一菜单）不跨模式存活——阅读只读不接管
    this.closeOutlineMenu()
    this.closeContextMenu()
    // #140 Popover 改版：属性编辑浮层仅服务 live 表格卡片，切到阅读即关
    closeFmPopover()
    if (this.view) selectTableRegion(this.view, null)
    if (next === 'reading') {
      // 在选定内容中查找是 live 选区语义（阅读只读无选区交互）：进入即复位
      if (this.findInSelection) {
        this.resetFindInSelection(true)
        this.findRecompute(this.findReferencePos())
      }
      const editorHadFocus = document.activeElement === this.view?.contentDOM
      // #84 切回阅读模式：已挂载块补卡片增强（常驻块不经挂载钩子）
      this.decorateMountedReadingCodeCards()
      // 锚点 = live 光标主位（选区最小 from）；阅读视图按当前 CM6 文本渲染
      // （含未确认输入），不依赖宿主权威。锚点随即规范化为块 start——
      // 短文档滚动无法表达目标时 modeAnchor 仍是权威锚点
      const sel = this.view?.state.selection
      const cursor = sel
        ? Math.min(...sel.ranges.map((r) => r.from))
        : this.modeAnchor ?? 0
      this.modeAnchor = cursor
      this.applyModeDom('reading') // 先更新模式（refreshReading 依赖它）
      if (editorHadFocus) this.readingContainer?.focus()
      this.refreshReading()
      if (this.readingView) {
        const start = this.readingView.anchorStartFor(this.clampToDoc(cursor)) ?? cursor
        this.modeAnchor = start
        this.readingView.scrollToSrcStart(start)
      }
      // #66：模式切换即时重算（reading 以视口顶块锚点换算；切换引发的
      // 滚动属程序性但目标即当前锚点，重算结果稳定，去抖吸收余波）
      this.updateOutlineLocated()
      // 查找会话跨模式保活（#14）：当前匹配位置经源位置锚点映射到新视图
      if (this.findOpen) {
        this.findEnsureFresh()
        this.findRender()
        this.findLocate()
      }
      // 锚点测量源随模式换元素（reading 限宽块）：重挂观察并重同步
      this.refreshOverlayAnchorWatch()
      return
    }
    // reading → live：源码位置锚点 = modeAnchor（用户滚动经 scroll 监听
    // 更新；进入/定位时规范化），非滚动百分比
    if (this.readingView && this.modeAnchor !== null) {
      const mapped = this.readingView.anchorStartFor(this.clampToDoc(this.modeAnchor))
      if (mapped !== null) {
        this.modeAnchor = mapped
      }
    }
    const readingHadFocus = document.activeElement === this.readingContainer
    this.applyModeDom('live')
    if (readingHadFocus) this.view?.focus()
    // 恢复光标到锚点并滚动到视口中部；事务不带 changes → 不产生编辑历史
    const pos = this.clampToDoc(this.modeAnchor ?? 0)
    this.view?.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'center' }),
    })
    // #66：模式切换即时重算（live 以已渲染行的首可见行换算）
    this.updateOutlineLocated()
    // 查找会话跨模式保活（#14）：选区恢复到当前匹配（非仅块首）
    if (this.findOpen) {
      this.findEnsureFresh()
      this.findRender()
      this.findLocate()
    }
    // 锚点测量源随模式换元素（live .cm-content）：重挂观察并重同步
    this.refreshOverlayAnchorWatch()
  }

  /** 容器显隐（稳定类名 vsidian-view-live / vsidian-view-reading） */
  private applyModeDom(mode: ViewMode): void {
    if (mode !== this.viewMode) {
      this.clearViewport()
    }
    this.viewMode = mode
    // P2-04：根面板模式切换联动嵌入卡片的内部模式继承（无手动覆盖的
    // 根级嵌入跟随；子卡级联）——在 viewMode 赋值后、容器显隐前通知
    this.embedCards?.notifyParentModeChanged()
    // Live 悬停现场随模式切换作废（装饰 DOM 随重建脱树，补触发不得复活旧锚）
    this.lastLiveHover = null
    this.closeQuickHeadingMenu(false)
    this.refreshQuickActions()
    // #221 全入口后 Live 悬停与面板悬停同样可开浮层：切模式 = 触发上下文
    // 失效，无条件释放实例（规格「面板销毁、切模式等使触发上下文失效时
    // 释放实例」；Live 锚点几何与阅读块源锚点在模式切换后不再有效）
    closeHoverPopup()
    if (this.liveWrapper) {
      this.liveWrapper.style.display = mode === 'live' ? '' : 'none'
    }
    if (this.readingContainer) {
      this.readingContainer.style.display = mode === 'reading' ? '' : 'none'
    }
    // #141 body 模式类（vsidian-mode-live / vsidian-mode-reading）：双态
    // 切换按钮图标显隐的 CSS 驱动锚点（两图标常驻 DOM，样式失效时同显
    // 可被浏览器断言暴露）；aria/tooltip 随态换词经注册表单点重算
    if (this.bodyEl) {
      this.bodyEl.classList.toggle('vsidian-mode-live', mode === 'live')
      this.bodyEl.classList.toggle('vsidian-mode-reading', mode === 'reading')
    }
    if (this.viewToggleBtn) {
      refreshElementLocale(this.viewToggleBtn)
    }
    this.persistState()
    // 模式变化主动回报（宿主缓存常新：表格结构命令在 reading 面板上据此
    // 给出可见反馈，不再静默丢弃）。握手前（无 sessionId）不回报——宿主
    // 尚不认识此面板，mount 阶段的 DOM 初始化不算模式变化
    if (this.sessionId) {
      this.reportViewState()
    }
  }

  /** 阅读模式下按当前 CM6 文本重建阅读视图（保留滚动锚点）。
   *  调用点：进入 reading、全文重置（init/resync）、外部增量应用后。
   *  #7 起：全文切块（唯一一次解析）后按需挂载窗口；滚动路径不再进入此处 */
  private refreshReading(): void {
    if (this.viewMode !== 'reading' || !this.readingView || !this.view) {
      return
    }
    // 布局可用才读视口锚点（否则保留当前锚点 offset，重建后再映射）
    const hasLayout = (this.readingContainer?.scrollHeight ?? 0) > 0
    const keep = hasLayout ? this.readingView.currentAnchor() : null
    this.readingView.setDocument(this.view.state.doc.toString())
    if (keep !== null) {
      this.readingView.scrollToSrcStart(keep)
      this.modeAnchor = keep
    }
  }

  // ---- 任务勾选（#9）：阅读视图的 checkbox 交互 ----

  private isTaskCheckbox(node: EventTarget | null): node is HTMLInputElement {
    return (
      node instanceof HTMLInputElement &&
      node.type === 'checkbox' &&
      node.classList.contains(READING_MARKDOWN_CLASS_NAMES.taskCheckbox)
    )
  }

  /**
   * 阅读视图任务勾选：checkbox 源锚点严格再校验后，在（隐藏的）CM6 编辑器
   * 上派发替换事务——与手工编辑同一事务管线，出站走标准链路
   * （updateListener → edit.request：seq/baseVersion/未确认参考系/暂缓
   * 语义全部继承）。校验失败（过期锚点/已是目标态）即放弃：零写回、
   * 零历史。派发后乐观重建阅读视图（勾选态源自本地文档；冲突暂停期间
   * 与 live 输入同语义：本地保留、不写回）。
   */
  private toggleReadingTask(box: HTMLInputElement): void {
    const view = this.view
    if (!view) {
      return
    }
    const start = Number(box.dataset['vsidianSrcStart'])
    const end = Number(box.dataset['vsidianSrcEnd'])
    const displayedChecked = box.dataset['vsidianChecked'] === 'true'
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      return
    }
    const target = resolveStaleTaskToggle(view.state.doc.toString(), start, end, displayedChecked)
    if (!target) {
      return
    }
    view.dispatch({
      changes: { from: target.from, to: target.to, insert: target.nextText },
    })
    this.refreshReading()
  }

  private clampToDoc(offset: number): number {
    return Math.max(0, Math.min(offset, this.view?.state.doc.length ?? 0))
  }

  /**
   * 定位执行（#10 view.locate 宿主消息与 #66 大纲点击共用同一实现）：
   * 光标移到源 offset；reading 滚动到锚点块。纯视图操作——事务不带
   * changes，不产生编辑历史。#66 起：程序性滚动前置防抖动护栏（过渡期
   * 中间态视口不参与高亮计算），并以目标位置所在行即时落位常驻高亮
   * （不等滚动事件——被点击条目就是目标控制域）。
   * #163 验收反馈：flash = true（view.locate 链接跳转通道）时目标标题/
   * 段落整体覆盖半透黄高亮，用户任意操作后消失（大纲点击不闪——已有
   * 条目常驻高亮）。
   */
  /** head（#318）：选区右端（LF 坐标），携带时 live 落位为区间选区
   *  [offset, head)；缺省单点，既有单点语义不变。reading 分支按块定位，
   *  head 不适用（块级 flash 语义保持） */
  private locateOffset(offset: number, flash = false, head?: number): void {
    const pos = this.clampToDoc(offset)
    // 新的程序定位应覆盖旧视口记忆；实际滚动事件会重新记录新视口。
    this.clearViewport()
    this.suspendOutlineLinking()
    if (this.viewMode === 'reading' && this.readingView) {
      const start = this.readingView.anchorStartFor(pos) ?? pos
      this.modeAnchor = start
      this.readingView.scrollToSrcStart(start)
      // 定位意图重申（#11 起，#14 findLocate 同款机制）：屏外定位的滚动
      // 事件在挂载窗口重算（rAF）之前同步读取视口锚点，瞬态值不得覆盖
      // 定位目标——帧+宏任务后重申（同一窗口内的用户滚动会被覆盖）
      this.reassertReadingAnchor(start, 2)
      if (flash) {
        this.readingView.flashBlock(start)
        this.scheduleAnchorFlashDismiss()
      }
    } else {
      this.modeAnchor = pos
      // #57：定位离开表格选区语境时清选区（view.locate 与大纲跳转共用）
      if (this.view) selectTableRegion(this.view, null)
      // 聚焦编辑器（#66，QO「jump + 聚焦」语义）：未聚焦时 CM6 不把选区
      // 同步到 DOM Selection，用户看不到光标落位；点击大纲即完成导航，
      // 焦点归还正文（继续输入/滚动）
      this.view?.focus()
      // 区间滚动目标取右端——搜索导航的匹配区间右端更常远离视口（命中
      // 在行中后段时左端可能已在屏内），reveal 右端保证整个区间可见
      const revealPos = head !== undefined ? this.clampToDoc(head) : pos
      this.view?.dispatch({
        selection: head !== undefined
          ? { anchor: pos, head: revealPos }
          : { anchor: pos },
        effects: [
          EditorView.scrollIntoView(revealPos, { y: 'center' }),
          // 高亮并入同一事务（无 changes，仍纯视图操作）
          ...(flash
            ? [anchorFlashSet.of(anchorFlashRangeOf(this.view.state.doc, pos))]
            : []),
        ],
      })
      if (flash) {
        this.scheduleAnchorFlashDismiss()
      }
    }
    const doc = this.view?.state.doc
    this.outlineLocatedIndex = doc
      ? locateOutlineIndex(this.outlineItems, doc.lineAt(pos).number)
      : null
    // #67：跳转落位含 only-expand（目标被折叠遮蔽时展开祖先链——点击
    // 折叠区条目或宿主 view.locate 落进折叠区时目标可见），高亮随代表落位
    if (this.outlineLocatedIndex !== null) {
      this.revealOutlineIndex(this.outlineLocatedIndex)
    }
    this.applyOutlineHighlight()
    // 定位点落盘（#163 验收反馈）：modeAnchor 此前仅内存更新——面板重载后
    // 恢复的是更早的持久锚点。定位是「我在哪」的最新信号，同步持久化使
    // 重载恢复落在最后导航点；此后用户的手动移位不再被历史定位覆盖
    this.persistState()
  }

  /** #66 大纲条目点击跳转：标题行号 → 源 offset（doc.line(n).from）后走
   *  locateOffset 双模式路径。行号为条目渲染时刻的值（大纲 250ms 去抖
   *  窗口内的编辑存在滞后可能，与点击时的可见条目一致） */
  private outlineJumpToItem(index: number): void {
    const view = this.view
    const item = this.outlineItems[index]
    if (!view || !item) {
      return
    }
    const line = Math.min(Math.max(1, item.line), view.state.doc.lines)
    this.locateOffset(view.state.doc.line(line).from)
  }

  /** #163 验收反馈：挂载跳转目标高亮的消失监听——用户任意操作（点击、
   *  滚动、按键、切走页面）后清除。scroll 事件带时间窗（定位自身的程序
   *  滚动在窗口内忽略）；监听一次性（清除即全部卸载，重复定位重挂） */
  private scheduleAnchorFlashDismiss(): void {
    this.detachAnchorFlashDismiss()
    this.anchorFlashSince = Date.now()
    const dismiss = (): void => this.clearAnchorFlash()
    const onScroll = (): void => {
      if (Date.now() - this.anchorFlashSince < 300) {
        return // 定位自身的程序滚动（scrollIntoView/scrollToSrcStart/虚拟化重算）
      }
      dismiss()
    }
    const targets: Array<[EventTarget, string, EventListener]> = []
    if (this.viewMode === 'reading') {
      if (this.readingContainer) {
        targets.push(
          [this.readingContainer, 'pointerdown', dismiss],
          [this.readingContainer, 'wheel', dismiss],
          [this.readingContainer, 'scroll', onScroll],
        )
      }
    } else if (this.view) {
      targets.push(
        [this.view.contentDOM, 'pointerdown', dismiss],
        [this.view.contentDOM, 'wheel', dismiss],
        [this.view.contentDOM, 'keydown', dismiss],
        [this.view.scrollDOM, 'scroll', onScroll],
      )
    }
    for (const target of targets) {
      target[0].addEventListener(target[1], target[2])
      this.anchorFlashDetachers.push(() => target[0].removeEventListener(target[1], target[2]))
    }
    // 切走页面（标签切换/窗口失焦）：window 级监听两模式常挂
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        dismiss()
      }
    }
    window.addEventListener('blur', dismiss)
    document.addEventListener('visibilitychange', onVisibility)
    this.anchorFlashDetachers.push(() => {
      window.removeEventListener('blur', dismiss)
      document.removeEventListener('visibilitychange', onVisibility)
    })
  }

  /** 清除跳转目标高亮并卸载消失监听（重复调用幂等） */
  private clearAnchorFlash(): void {
    this.detachAnchorFlashDismiss()
    if (this.view) {
      this.view.dispatch({ effects: anchorFlashClear.of(null) })
    }
    this.readingView?.flashBlock(null)
  }

  private detachAnchorFlashDismiss(): void {
    for (const detach of this.anchorFlashDetachers.splice(0)) {
      detach()
    }
  }

  /**
   * 阅读定位后的锚点重申（#14 findLocate 机制的 view.locate 复用，#11）：
   * 滚动事件突发期（含虚拟化挂载窗口重算与实测修正的异步阶段）内读到的
   * 瞬态视口锚点不得覆盖定位目标。rounds 轮（帧+宏任务）后仍保持目标锚点。
   */
  private reassertReadingAnchor(start: number, rounds: number): void {
    scheduleFrame(() => {
      setTimeout(() => {
        if (this.viewMode === 'reading') {
          this.modeAnchor = start
          if (rounds > 1) {
            this.reassertReadingAnchor(start, rounds - 1)
          }
        }
      }, 0)
    })
  }

  /** 图片槽位状态计数（#10）：按当前激活视图的作用域统计 DOM 状态标记 */
  private collectImageStates(): { loading: number; loaded: number; error: number } {
    const scope = this.viewMode === 'reading' ? this.readingContainer : this.liveWrapper
    const out = { loading: 0, loaded: 0, error: 0 }
    if (!scope) {
      return out
    }
    for (const el of Array.from(scope.querySelectorAll<HTMLElement>('[data-vsidian-img-state]'))) {
      const s = el.dataset['vsidianImgState']
      if (s === 'loading' || s === 'loaded' || s === 'error') {
        out[s] += 1
      }
    }
    return out
  }

  /** 图片槽位探针（#208）：当前激活视图内活跃槽位的最终 src 与解码宽度
   *  ——live 侧槽位为含 img 的容器 span、阅读侧槽位即 img 自身；src 为
   *  宿主回发的最终地址（含 ?v= 代次戳），naturalWidth 在真实 webview
   *  load 后为位图宽（jsdom 无解码恒 0）。与 imageStates 同元素集 */
  private collectImageProbe(): ImageSlotProbe[] {
    const scope = this.viewMode === 'reading' ? this.readingContainer : this.liveWrapper
    if (!scope) {
      return []
    }
    const out: ImageSlotProbe[] = []
    for (const el of Array.from(scope.querySelectorAll<HTMLElement>('[data-vsidian-img-state]'))) {
      const img = el instanceof HTMLImageElement ? el : el.querySelector('img')
      const state = el.dataset['vsidianImgState']
      out.push({
        src: img?.getAttribute('src') ?? null,
        naturalWidth: img ? img.naturalWidth : null,
        state: state === 'loading' || state === 'loaded' || state === 'error' ? state : 'loading',
      })
    }
    return out
  }

  /** CSS 契约探针（#6 内部测试验证入口；#8 扩展 span 级类）：宿主注入的
   *  测试片段仅经稳定类名定位；此处在 view.state 请求时读取 computed style
   *  回报。jsdom 无样式表计算，值可为空串/空变量（返回 null），真实断言在集成。 */
  private collectCssProbe(): CssProbeReport {
    const liveEl = this.liveWrapper?.querySelector('.vsidian-heading-line-1') ?? null
    const readingEl = this.readingContainer?.querySelector('.vsidian-reading-heading-1') ?? null
    const liveStrong = this.liveWrapper?.querySelector('.vsidian-strong') ?? null
    const liveInlineCode = this.liveWrapper?.querySelector('.vsidian-inline-code') ?? null
    const liveHtmlComment = this.liveWrapper?.querySelector(`.${LIVE_CLASS_NAMES.htmlComment}`) ?? null
    const liveCodeLine = this.liveWrapper?.querySelector('.vsidian-code-line') ?? null
    const liveTablePipe = this.liveWrapper?.querySelector('.vsidian-table-pipe') ?? null
    const readingStrong = this.readingContainer?.querySelector('.vsidian-reading-block strong') ?? null
    const liveTaskBox = this.liveWrapper?.querySelector(`.${LIVE_CLASS_NAMES.taskCheckbox}`) ?? null
    const readingTaskBox = this.readingContainer?.querySelector(
      `.${READING_MARKDOWN_CLASS_NAMES.taskCheckbox}`,
    ) ?? null
    const liveLink = this.liveWrapper?.querySelector('.vsidian-link') ?? null
    const readingLink = this.readingContainer?.querySelector('.vsidian-reading-block a') ?? null
    const readingImage = this.readingContainer?.querySelector('.vsidian-reading-block img.vsidian-image') ?? null
    const readingTable = this.readingContainer?.querySelector('.vsidian-reading-block table') ?? null
    const liveWikilink = this.liveWrapper?.querySelector(`.${WIKILINK_CLASS_NAMES.wikilink}`) ?? null
    const readingWikilink = this.readingContainer?.querySelector(
      `.vsidian-reading-block a.${WIKILINK_CLASS_NAMES.wikilink}`,
    ) ?? null
    // #59 公式字体观测：katex.min.css 生效时 .katex 的 computed font-family
    // 含 KaTeX 字体族（CSP/样式注入失效时回落 body 字体——集成断言依据）
    const liveMathKatex = this.liveWrapper?.querySelector('.vsidian-math .katex') ?? null
    const readingMathKatex = this.readingContainer?.querySelector('.vsidian-reading-block .katex') ?? null
    const readFont = (el: Element | null): string | null =>
      el ? getComputedStyle(el).fontFamily || null : null
    const read = (el: Element | null): string | null =>
      el ? getComputedStyle(el).textDecorationColor : null
    let readingVarProbe: string | null = null
    if (this.readingContainer) {
      const value = getComputedStyle(this.readingContainer)
        .getPropertyValue('--vsidian-probe-var-reading')
        .trim()
      readingVarProbe = value === '' ? null : value
    }
    // #129 片段相对资源观测：@font-face 装载计数（字节级证据——字体按各自
    // CSS 文件路径解析并真实拉取）与阅读容器背景图（图片解析锚点）
    let documentFonts: { total: number; loaded: number } | null = null
    try {
      const fonts = document.fonts
      if (fonts) {
        let loaded = 0
        for (const face of fonts) {
          if (face.status === 'loaded') {
            loaded += 1
          }
        }
        documentFonts = { total: fonts.size, loaded }
      }
    } catch {
      documentFonts = null
    }
    let readingBackgroundImage: string | null = null
    if (this.readingContainer) {
      const image = getComputedStyle(this.readingContainer).backgroundImage
      readingBackgroundImage = image && image !== 'none' ? image : null
    }
    // #132 Obsidian 原名别名桥探针：按探针表（单一事实源）在对应视图容器内
    // 以 **Obsidian 原名选择器** 定位并读 computed text-decoration-color——
    // probe.css 以原名写探针规则，别名类未挂上/挂错节点即 null
    const obsidianAliases: Record<string, string | null> = {}
    for (const probe of OBSIDIAN_ALIAS_PROBES) {
      const root = probe.view === 'live' ? this.liveWrapper : this.readingContainer
      // querySelector 只查后代——容器条目（如 .markdown-source-view.mod-cm6）
      // 的目标可能是 root 自身，先 matches 再查后代
      const el = root
        ? root.matches(probe.selector)
          ? root
          : root.querySelector(probe.selector)
        : null
      // 探针属性统一 outline-color（与既有 text-decoration-color 体系正交）
      obsidianAliases[probe.id] = el ? getComputedStyle(el).outlineColor || null : null
    }
    // #132 变量别名桥观测：--h1-color 驱动的一级标题 computed color（可见效果）
    const liveHeaderSpan = this.liveWrapper?.querySelector('.vsidian-header-1') ?? null
    const readingH1 = this.readingContainer?.querySelector('.vsidian-reading-heading-1 h1') ?? null
    const readColor = (el: Element | null): string | null => (el ? getComputedStyle(el).color : null)
    // #133 界面域样式契约探针：按探针表（单一事实源）在 **document 域**
    // 定位（界面域目标不全在两视图容器内——大纲面板挂侧栏）读 computed
    // outline-color；probe.css 以 vsidian 稳定类名写探针规则，选择器含
    // 结构上下文（.vsidian-math .katex 等）——类未挂上/挂错节点即 null
    const chromeSelectors: Record<string, string | null> = {}
    for (const probe of CHROME_CONTRACT_PROBES) {
      const el = document.querySelector(probe.selector)
      // 自定义属性探针：不可见且与 outline-color / text-decoration-color
      // 两套既有探针正交（双类元素同被多套探针命中时零串扰）
      const value = el ? getComputedStyle(el).getPropertyValue('--vsidian-chrome-probe').trim() : ''
      chromeSelectors[probe.id] = el ? value === '' ? null : value : null
    }
    // #133 界面域可见颜色观测：各区域代表元素的 computed color（随当前
    // viewMode 取对应侧目标——真实片段改写可见属性即被观测到）
    const inLive = this.viewMode === 'live'
    const readDocColor = (selector: string): string | null => {
      const el = document.querySelector(selector)
      return el ? getComputedStyle(el).color || null : null
    }
    const chromePaint = {
      mathKatexColor: readDocColor(inLive
        ? '#app .vsidian-view-live .vsidian-math .katex'
        : '#app .vsidian-view-reading .vsidian-reading-math .katex'),
      codeCardLabelColor: readDocColor(inLive
        ? '#app .vsidian-view-live .vsidian-code-card-header-label'
        : '#app .vsidian-view-reading .vsidian-code-card-header-label'),
      tokKeywordColor: readDocColor(inLive
        ? '#app .vsidian-view-live .tok-keyword'
        : '#app .vsidian-view-reading .tok-keyword'),
      mermaidContainerColor: readDocColor(inLive
        ? '#app .vsidian-view-live .vsidian-mermaid'
        : '#app .vsidian-view-reading .vsidian-reading-mermaid .vsidian-mermaid'),
      outlineLevel1Color: readDocColor('#app .vsidian-sidebar .vsidian-outline-level-1'),
    }
    // #133 图表弹窗样式观测：浮层在场时的 toolbar/stage computed color；
    // 浮层不在场为 null（弹窗 DOM 只在打开期间存在——在场性本身即观测点）
    const popupOverlay = document.querySelector('.vsidian-diagram-overlay')
    const chromePopup = popupOverlay
      ? {
          toolbarColor: readDocColor('.vsidian-diagram-overlay .vsidian-diagram-toolbar'),
          stageColor: readDocColor('.vsidian-diagram-overlay .vsidian-diagram-stage'),
        }
      : null
    return {
      obsidianAliases,
      obsidianVarProbe: {
        liveHeadingColor: readColor(liveHeaderSpan),
        readingHeadingColor: readColor(readingH1),
      },
      chromeSelectors,
      chromePaint,
      chromePopup,
      liveHeadingDecorationColor: read(liveEl),
      readingHeadingDecorationColor: read(readingEl),
      readingVarProbe,
      documentFonts,
      readingBackgroundImage,
      liveStrongDecorationColor: read(liveStrong),
      liveInlineCodeDecorationColor: read(liveInlineCode),
      // #139 HTML 注释淡化探针（live 专属；阅读侧隐藏无对应元素）
      liveHtmlCommentDecorationColor: read(liveHtmlComment),
      liveCodeLineDecorationColor: read(liveCodeLine),
      readingStrongDecorationColor: read(readingStrong),
      liveTaskCheckboxDecorationColor: read(liveTaskBox),
      readingTaskCheckboxDecorationColor: read(readingTaskBox),
      liveLinkDecorationColor: read(liveLink),
      readingLinkDecorationColor: read(readingLink),
      readingImageDecorationColor: read(readingImage),
      // #12 表格样式入口探针（live 管道符 / reading 表格标签）
      liveTablePipeDecorationColor: read(liveTablePipe),
      readingTableDecorationColor: read(readingTable),
      // #11 双链样式入口探针（live widget/mark / reading a）
      liveWikilinkDecorationColor: read(liveWikilink),
      readingWikilinkDecorationColor: read(readingWikilink),
      // #59 公式字体探针（live widget / reading 块内的 KaTeX 层）
      liveMathFontFamily: readFont(liveMathKatex),
      readingMathFontFamily: readFont(readingMathKatex),
    }
  }

  /** #32 排版一致性采样：两模式正文/列表/引用/表格的 computed 基础排版。
   *  只读 DOM 与计算样式，不触发布局写入；隐藏侧（display:none）computed
   *  字体族/字号仍可读（继承链有效），几何口径 textInsetPx 无意义（rect
   *  全 0）——断言端须在对应模式激活态取各自样本。 */
  private collectTypography(): TypographyProbe {
    const scroller = this.liveWrapper?.querySelector<HTMLElement>('.cm-scroller') ?? null
    const readBase = (el: HTMLElement | null, anchor: HTMLElement | null): TypographySample | null => {
      if (!el) {
        return null
      }
      const cs = getComputedStyle(el)
      const fontPx = Number.parseFloat(cs.fontSize)
      const linePx = Number.parseFloat(cs.lineHeight)
      return {
        fontFamily: cs.fontFamily || null,
        fontSizePx: Number.isFinite(fontPx) ? fontPx : null,
        lineHeightPx: Number.isFinite(linePx) ? linePx : null,
        textInsetPx: anchor
          ? el.getBoundingClientRect().left - anchor.getBoundingClientRect().left
          : null,
      }
    }
    const readInherit = (el: HTMLElement | null): TypographyInheritSample | null => {
      if (!el) {
        return null
      }
      const cs = getComputedStyle(el)
      const fontPx = Number.parseFloat(cs.fontSize)
      return {
        fontFamily: cs.fontFamily || null,
        fontSizePx: Number.isFinite(fontPx) ? fontPx : null,
      }
    }
    return {
      live: readBase(
        this.liveWrapper?.querySelector<HTMLElement>('.cm-content') ?? null,
        scroller,
      ),
      reading: readBase(
        this.readingContainer?.querySelector<HTMLElement>('.vsidian-reading-block p') ?? null,
        this.readingContainer ?? null,
      ),
      liveList: readInherit(this.liveWrapper?.querySelector<HTMLElement>('.vsidian-list-line') ?? null),
      readingList: readInherit(this.readingContainer?.querySelector<HTMLElement>('.vsidian-reading-block li') ?? null),
      liveQuote: readInherit(this.liveWrapper?.querySelector<HTMLElement>('.vsidian-quote-line') ?? null),
      readingQuote: readInherit(this.readingContainer?.querySelector<HTMLElement>('.vsidian-reading-block blockquote') ?? null),
      liveTable: readInherit(this.liveWrapper?.querySelector<HTMLElement>('.vsidian-table-line') ?? null),
      readingTable: readInherit(this.readingContainer?.querySelector<HTMLElement>('.vsidian-reading-table td') ?? null),
    }
  }

  /** live 侧语法装饰统计（#8 双视图一致性观测）：直接装饰集合级计数 */
  private collectLiveSyntax(): LiveSyntaxProbe {
    const counts = {
      headingLines: 0,
      headerSpans: 0,
      strongSpans: 0,
      emphasisSpans: 0,
      inlineCodeSpans: 0,
      quoteLines: 0,
      codeLines: 0,
      listLines: 0,
      hrLines: 0,
      frontmatterLines: 0,
      taskGlyphs: 0,
      taskChecked: 0,
      tableLines: 0,
      tableCells: 0,
    }
    const view = this.view
    if (view) {
      view.state
        .field(liveDecorationsField)
        .decos.between(0, view.state.doc.length, (_from, _to, value) => {
          const spec = value.spec as { class?: string; widget?: { checked?: boolean } }
          if (typeof spec['class'] === 'string') {
            // 各类彼此独立计数（#296：行类按行聚合为单条合并 class 装饰，
            // 引用块内表格行同时是引用行与表格行——else-if 链会把表格行
            // 吞进 quoteLines，探针测不到表格行）；各类名无子串包含关系，
            // 独立计数不重复
            const cls = spec['class']
            if (cls.includes('vsidian-heading-line') && !cls.includes('vsidian-heading-inview')) {
              counts.headingLines += 1
            }
            if (cls.includes('vsidian-header-')) {
              counts.headerSpans += 1
            }
            if (cls.includes('vsidian-strong')) {
              counts.strongSpans += 1
            }
            if (cls.includes('vsidian-emphasis')) {
              counts.emphasisSpans += 1
            }
            if (cls.includes('vsidian-inline-code')) {
              counts.inlineCodeSpans += 1
            }
            if (cls.includes('vsidian-quote-line')) {
              counts.quoteLines += 1
            }
            if (cls.includes('vsidian-code-line')) {
              counts.codeLines += 1
            }
            if (cls.includes('vsidian-list-line')) {
              counts.listLines += 1
            }
            if (cls.includes('vsidian-hr-line')) {
              counts.hrLines += 1
            }
            if (cls.includes('vsidian-frontmatter-line')) {
              counts.frontmatterLines += 1
            }
            if (cls.includes('vsidian-table-cell')) {
              // #12：单元格内容 mark（cellHeader/align 修饰并入计数，不重复）
              counts.tableCells += 1
            }
            if (cls.includes('vsidian-table-line')) {
              // 行级类包含全部表格行；cellHeader/align 修饰行已在前序命中
              counts.tableLines += 1
            }
          } else if (spec.widget instanceof TaskCheckboxWidget) {
            // 任务字形只数任务 checkbox widget——#106 起分割线渲染
            // （HorizontalRuleWidget）同为 replace widget，不得混入计数
            counts.taskGlyphs += 1
            if (spec.widget.checked === true) {
              counts.taskChecked += 1
            }
          }
        })
    }
    return counts
  }

  /** reading 侧渲染语义统计（#8：DOM 级计数；虚拟化下仅统计已挂载块，
   *  一致性对拍用小文档（全量挂载）进行） */
  private collectReadingSyntax(): ReadingSyntaxProbe {
    const container = this.readingContainer
    if (!container) {
      return {
        headings: 0,
        strongCount: 0,
        emphasisCount: 0,
        inlineCodeCount: 0,
        blockquoteBlocks: 0,
        codeBlocks: 0,
        hrCount: 0,
        listItems: 0,
        taskCheckboxes: 0,
        taskChecked: 0,
        tables: 0,
      }
    }
    const count = (selector: string): number => container.querySelectorAll(selector).length
    return {
      headings: count(
        '.vsidian-reading-block h1, .vsidian-reading-block h2, .vsidian-reading-block h3, .vsidian-reading-block h4, .vsidian-reading-block h5, .vsidian-reading-block h6',
      ),
      strongCount: count('.vsidian-reading-block strong'),
      emphasisCount: count('.vsidian-reading-block em'),
      inlineCodeCount: count('.vsidian-reading-block code:not(pre code)'),
      blockquoteBlocks: count('.vsidian-reading-block blockquote'),
      codeBlocks: count('.vsidian-reading-block:not(.vsidian-reading-frontmatter) pre'),
      hrCount: count('.vsidian-reading-block hr'),
      listItems: count('.vsidian-reading-block li'),
      taskCheckboxes: count('.vsidian-reading-task-checkbox'),
      taskChecked: Array.from(
        container.querySelectorAll<HTMLInputElement>('.vsidian-reading-task-checkbox'),
      ).filter((b) => b.checked).length,
      // #12：表格语义计数（块级 table 元素；只读呈现）
      tables: count('.vsidian-reading-block table'),
    }
  }

  /** 可见视口按屏幕坐标映射回源码 offset；Mermaid 等替换 widget 的高度
   *  改变时，源码位置比 scrollTop 更能表达用户正在看的内容。 */
  private liveViewportCenterPosition(): number | null {
    const view = this.viewMode === 'live' ? this.view : undefined
    if (!view) return null
    const box = view.scrollDOM.getBoundingClientRect()
    if (box.height <= 0) return null
    const content = view.contentDOM.getBoundingClientRect()
    return view.posAtCoords({
      x: content.left + Math.min(60, content.width / 2),
      y: box.top + box.height / 2,
    })
  }

  /** 滚动事件高频到达：内存状态即时更新，bridge 写入尾随去抖。隐藏或卸载
   *  时同步冲刷，覆盖用户滚动后立刻切标签页的窗口。 */
  private scheduleViewportSave(): void {
    if (!this.sessionId || this.restoringViewport) return
    const scroller = this.viewMode === 'reading'
      ? this.readingContainer : this.view?.scrollDOM
    if (!scroller) return
    const previous = this.viewport?.mode === this.viewMode ? this.viewport : null
    // 高频事件只读廉价的 scrollTop；源码坐标等布局稳定后再测。
    this.viewport = {
      mode: this.viewMode,
      top: Math.max(0, scroller.scrollTop),
      centerOffset: previous?.centerOffset,
    }
    if (this.viewportSaveTimer !== undefined) clearTimeout(this.viewportSaveTimer)
    this.viewportSaveTimer = setTimeout(() => this.flushViewportSave(), VIEWPORT_SAVE_DEBOUNCE_MS)
  }

  private captureViewport(): void {
    const scroller = this.viewMode === 'reading'
      ? this.readingContainer : this.view?.scrollDOM
    if (!scroller) return
    const previous = this.viewport?.mode === this.viewMode ? this.viewport : null
    const hasLayout = scroller.getBoundingClientRect().height > 0
    const centerOffset = this.liveViewportCenterPosition() ?? previous?.centerOffset
    const top = hasLayout || !previous ? scroller.scrollTop : previous.top
    this.viewport = { mode: this.viewMode, top: Math.max(0, top), centerOffset }
  }

  private flushViewportSave(): void {
    if (this.viewportSaveTimer === undefined) return
    clearTimeout(this.viewportSaveTimer)
    this.viewportSaveTimer = undefined
    if (!this.restoringViewport) this.captureViewport()
    this.persistState()
  }

  private scheduleSelectionSave(): void {
    if (this.selectionSaveTimer !== undefined) clearTimeout(this.selectionSaveTimer)
    this.selectionSaveTimer = setTimeout(() => this.flushSelectionSave(), SELECTION_SAVE_DEBOUNCE_MS)
  }

  private flushSelectionSave(): void {
    if (this.selectionSaveTimer === undefined) return
    clearTimeout(this.selectionSaveTimer)
    this.selectionSaveTimer = undefined
    this.persistState()
  }

  private flushPendingViewState(): void {
    const pending = this.viewportSaveTimer !== undefined || this.selectionSaveTimer !== undefined
    if (this.viewportSaveTimer !== undefined) clearTimeout(this.viewportSaveTimer)
    if (this.selectionSaveTimer !== undefined) clearTimeout(this.selectionSaveTimer)
    this.viewportSaveTimer = undefined
    this.selectionSaveTimer = undefined
    if (this.viewport && !this.restoringViewport) this.captureViewport()
    if (pending || this.viewport) this.persistState()
  }

  private clearViewport(): void {
    if (this.viewportSaveTimer !== undefined) {
      clearTimeout(this.viewportSaveTimer)
      this.viewportSaveTimer = undefined
    }
    this.viewport = null
    this.restoringViewport = false
  }

  private restoreViewport(): void {
    const viewport = this.viewport
    if (!viewport || viewport.mode !== this.viewMode) return
    this.restoringViewport = true
    if (viewport.mode === 'reading') {
      const container = this.readingContainer
      if (!container) {
        this.restoringViewport = false
        return
      }
      container.scrollTop = viewport.top
      this.readingView?.handleScroll()
      requestAnimationFrame(() => {
        if (this.viewport === viewport && this.viewMode === 'reading') {
          container.scrollTop = viewport.top
          this.readingView?.handleScroll()
        }
        this.restoringViewport = false
      })
    } else {
      const view = this.view
      if (!view) {
        this.restoringViewport = false
        return
      }
      view.scrollDOM.scrollTop = viewport.top
      requestAnimationFrame(() => {
        if (this.view === view && this.viewport === viewport && this.viewMode === 'live') {
          if (viewport.centerOffset !== undefined) {
            view.dispatch({ effects: EditorView.scrollIntoView(
              this.clampToDoc(viewport.centerOffset), { y: 'center' },
            ) })
          } else {
            view.scrollDOM.scrollTop = viewport.top
          }
        }
        this.restoringViewport = false
      })
    }
  }

  /** 持久化（合并写入）：seq、viewMode、anchor、viewport、sidebarOpen、outlineActive、
   *  outlineExpandLevel（#67 档位全局记忆）、sidebarWidth（拖宽记忆）共存
   *  互不覆盖 */
  private persistState(): void {
    if (this.selectionSaveTimer !== undefined) {
      clearTimeout(this.selectionSaveTimer)
      this.selectionSaveTimer = undefined
    }
    const saved = this.bridge.getState<PersistedState>() ?? {}
    this.bridge.setState({
      ...saved,
      // P2-02：seq / conflictRevision 权威在 Live 实例（实例 deps 的
      // persistState 回调触发本方法；mount 前用构造期恢复的初值兜底）
      seq: this.live?.seqNow ?? this.initialSeq,
      conflictRevision: this.live?.conflictRevisionNow ?? this.initialConflictRevision,
      viewMode: this.viewMode,
      anchor: this.modeAnchor ?? undefined,
      viewport: this.viewport ?? undefined,
      sidebarOpen: this.sidebarOpen,
      outlineActive: this.outlineActive,
      outlineExpandLevel: this.outlineExpandLevel,
      sidebarWidth: this.sidebarWidth === SIDEBAR_WIDTH_DEFAULT ? undefined : this.sidebarWidth,
      quickActionsOpen: this.quickActionsOpen,
      backlinksActive: this.backlinksActive,
      outlinksActive: this.outlinksActive,
    })
  }

  /** #91 的有效绑定快照调用此入口；操作条不保存另一份默认键位。 */
  setQuickActionBindingHints(resolve: (op: FormatOperationId) => readonly string[]): void {
    this.quickBindingHints = resolve
    this.refreshQuickActions()
  }

  /** P2-10：格式操作目标分派——无显式 target 时按焦点解析（嵌入内 B /
   *  主文 A）；右键菜单路径传入打开时捕获并重验过的 target（避免菜单
   *  关闭还焦的时序差）。写回经目标 view 的标准出站链路（嵌入 = 端口
   *  refEdit.message 只写 B） */
  private runFormatOperation(
    op: FormatOperationId,
    target?: { view: EditorView; embed: LiveEditorInstance | null },
  ): void {
    this.closeQuickHeadingMenu(false)
    const resolved = target ?? this.actionTarget()
    const view = resolved?.view
    if (!view || !this.targetEditable(view, resolved?.embed ?? null)) return
    const selection = view.state.selection
    const region = view.state.field(tableRegionField, false)
    // 多选区（#240，多光标设置开时可达；格区 region 与多 range 互斥）：
    // 行内包裹类逐 range 应用；结构性操作（标题/列表/引用/围栏/分割线/
    // HTML 注释）退化主 range（planOnlyIndex 指向主 range，其余 range
    // 原样保留——多光标形态不因退化而收敛）
    if (!region && selection.ranges.length > 1) {
      const ranges = selection.ranges.map((range) => ({ from: range.from, to: range.to }))
      const plan = isInlineFormatOp(op)
        ? planFormatOperationRanges(view.state.doc.toString(), op, ranges)
        : planFormatOperationRanges(view.state.doc.toString(), op, ranges,
          'toggle', selection.mainIndex)
      if (plan) {
        const changeSet = view.state.changes(plan.changes)
        const nextRanges = ranges.map((_, index) => {
          const spec = plan.selections[index]
          // 独立产物选区为终文坐标，直接落入；head 缺失为光标形态。null
          // （未参与规划/无变更/重叠保护丢弃）以原生选区 range 经
          // ChangeSet 映射——与单 range 路径不带 selection 时 CM6 的
          // 自动映射同语义
          if (spec) {
            return spec.head === undefined
              ? EditorSelection.cursor(spec.anchor)
              : EditorSelection.range(spec.anchor, spec.head)
          }
          return selection.ranges[index]!.map(changeSet)
        })
        view.dispatch({ changes: plan.changes,
          selection: EditorSelection.create(nextRanges, selection.mainIndex) })
      }
      view.focus()
      this.refreshQuickActions()
      return
    }
    const range = selection.main
    const plan = planFormatOperation(view.state.doc.toString(), op,
      { from: range.from, to: range.to }, region)
    if (plan?.changes.length) {
      view.dispatch({ changes: plan.changes,
        ...(plan.selection ? { selection: plan.selection } : {}) })
    }
    view.focus()
    this.refreshQuickActions()
  }

  private buildQuickActions(): HTMLElement {
    const bar = document.createElement('div')
    bar.className = 'vsidian-quick-actions'
    bar.id = 'vsidian-quick-actions'
    bar.setAttribute('role', 'toolbar')
    bindLocale(bar, 'aria-label', 'format.toolbarAria')
    const button = (icon: string, className: string, textIcon = false): HTMLButtonElement => {
      const el = document.createElement('button')
      el.type = 'button'
      el.className = className
      const glyph = document.createElement('span')
      glyph.className = textIcon ? 'vsidian-quick-text-icon' : 'vsidian-quick-icon'
      glyph.setAttribute('aria-hidden', 'true')
      if (textIcon) glyph.textContent = icon
      else glyph.dataset['icon'] = icon
      el.appendChild(glyph)
      // 鼠标按下不抢 CM6 焦点；包括标题 popup 与表格矩形选区。
      el.addEventListener('mousedown', (event) => event.preventDefault())
      return el
    }
    const group = (labelKey: 'format.groupText' | 'format.groupParagraph' | 'format.groupInsert'): HTMLElement => {
      const el = document.createElement('div')
      el.className = 'vsidian-quick-action-group'
      el.setAttribute('role', 'group')
      bindLocale(el, 'aria-label', labelKey)
      bar.appendChild(el)
      return el
    }
    const addOperation = (target: HTMLElement, op: FormatOperationId): void => {
      const item = FORMAT_OPERATIONS.find((entry) => entry.id === op)!
      const el = button(op, 'vsidian-quick-action')
      // #101：可访问名称与基名悬停词经注册表登记（动态键 item.titleKey 走
      // 键锚点，落 data-tooltip）——操作条关闭时 refreshQuickActions 早退，
      // 此前悬停词会滞留旧语言；开启后 refreshQuickActions 以两段结构
      // （data-tooltip 基名 + data-tooltip-keys 键位徽章，#300）覆写
      bindLocaleAttrs(el, item.titleKey)
      el.dataset['op'] = op
      el.addEventListener('click', () => this.runFormatOperation(op))
      target.appendChild(el)
    }
    const textGroup = group('format.groupText')
    for (const op of ['bold', 'italic', 'strikethrough', 'highlight', 'inlineCode', 'clearInline'] as const) {
      addOperation(textGroup, op)
    }
    const paragraphGroup = group('format.groupParagraph')
    const heading = button('heading', 'vsidian-quick-heading')
    bindLocaleAttrs(heading, 'format.heading')
    heading.setAttribute('aria-haspopup', 'menu')
    heading.setAttribute('aria-expanded', 'false')
    heading.setAttribute('aria-controls', 'vsidian-quick-heading-menu')
    heading.addEventListener('click', (event) => this.toggleQuickHeadingMenu(event.detail === 0))
    paragraphGroup.appendChild(heading)
    this.quickHeadingBtn = heading
    for (const op of ['bulletList', 'orderedList', 'taskList', 'quote', 'codeBlock'] as const) {
      addOperation(paragraphGroup, op)
    }
    const insertGroup = group('format.groupInsert')
    addOperation(insertGroup, 'link')
    const createTable = button('table', 'vsidian-quick-table')
    bindLocaleAttrs(createTable, 'format.insertTable')
    createTable.addEventListener('click', () => {
      // P2-10：操作条按钮走焦点目标解析（焦点在嵌入内部 Live 内 = B）
      const resolved = this.actionTarget()
      const view = resolved?.view
      if (view && this.targetEditable(view, resolved?.embed ?? null)) {
        runCreateTable(view)
        view.focus()
      }
    })
    insertGroup.appendChild(createTable)
    addOperation(insertGroup, 'inlineMath')
    addOperation(insertGroup, 'blockMath')
    addOperation(insertGroup, 'horizontalRule')
    const menu = document.createElement('div')
    menu.className = 'vsidian-quick-heading-menu'
    menu.id = 'vsidian-quick-heading-menu'
    menu.setAttribute('role', 'menu')
    bindLocale(menu, 'aria-label', 'format.headingMenu')
    menu.hidden = true
    for (const op of [
      'heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6', 'headingNone',
    ] as const) {
      const item = FORMAT_OPERATIONS.find((entry) => entry.id === op)!
      const el = button(op === 'headingNone' ? t('format.bodyText') : op.replace('heading', 'H'),
        'vsidian-quick-heading-item', true)
      bindLocaleAttrs(el, item.titleKey)
      if (op === 'headingNone') {
        // 「正文」档的 glyph 是文案不是图标：换包随注册表换词（其余档 H1–H6
        // 是语言无关的字面）
        const glyph = el.querySelector<HTMLElement>('.vsidian-quick-text-icon')
        if (glyph) {
          bindLocale(glyph, 'text', 'format.bodyText')
        }
      }
      el.dataset['headingOp'] = op
      el.setAttribute('role', 'menuitemradio')
      el.setAttribute('aria-checked', 'false')
      el.addEventListener('click', () => {
        this.closeQuickHeadingMenu(false)
        this.runFormatOperation(op)
      })
      menu.appendChild(el)
    }
    menu.addEventListener('keydown', (event) => {
      const options = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      if (event.key === 'Escape') {
        event.preventDefault()
        this.closeQuickHeadingMenu(true)
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        const index = options.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
          : event.key === 'ArrowDown' ? (index + 1) % options.length
            : (index + options.length - 1) % options.length
        options[next]?.focus()
      }
    })
    bar.appendChild(menu)
    this.quickHeadingMenu = menu
    const actions = [...bar.querySelectorAll<HTMLButtonElement>('.vsidian-quick-action-group button')]
    actions.forEach((action, index) => { action.tabIndex = index === 0 ? 0 : -1 })
    bar.addEventListener('focusin', (event) => {
      const focused = event.target as HTMLButtonElement
      if (!actions.includes(focused)) return
      actions.forEach((action) => { action.tabIndex = action === focused ? 0 : -1 })
    })
    bar.addEventListener('keydown', (event) => {
      if (!actions.includes(event.target as HTMLButtonElement) ||
          !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      const enabled = actions.filter((action) => !action.disabled)
      if (!enabled.length) return
      event.preventDefault()
      const current = enabled.indexOf(event.target as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1
        : event.key === 'ArrowRight' ? (current + 1) % enabled.length
          : (current + enabled.length - 1) % enabled.length
      enabled[next]?.focus()
    })
    if (typeof ResizeObserver !== 'undefined') {
      this.quickActionResizeObserver = new ResizeObserver(() => this.updateQuickActionSeparators())
      this.quickActionResizeObserver.observe(bar)
    }
    return bar
  }

  /** 分组整体换行时隐藏行首竖线，避免分隔线独占新行。 */
  private updateQuickActionSeparators(): void {
    const bar = this.quickActionsEl
    if (!bar || bar.hidden) return
    const groups = [...bar.querySelectorAll<HTMLElement>('.vsidian-quick-action-group')]
    groups.forEach((group, index) => {
      group.dataset['separated'] = String(index > 0 &&
        Math.abs(group.getBoundingClientRect().top - groups[index - 1]!.getBoundingClientRect().top) < 1)
    })
    if (this.quickHeadingMenu && !this.quickHeadingMenu.hidden) this.positionQuickHeadingMenu()
  }

  private positionQuickHeadingMenu(): void {
    const bar = this.quickActionsEl
    const heading = this.quickHeadingBtn
    const menu = this.quickHeadingMenu
    if (!bar || !heading || !menu || menu.hidden) return
    const barRect = bar.getBoundingClientRect()
    const headingRect = heading.getBoundingClientRect()
    const menuWidth = menu.getBoundingClientRect().width
    const visibleLeft = Math.max(0, barRect.left)
    const visibleRight = Math.min(window.innerWidth, barRect.right)
    const menuLeft = Math.max(visibleLeft, Math.min(headingRect.left, visibleRight - menuWidth))
    menu.style.left = `${menuLeft - barRect.left}px`
    menu.style.top = `${headingRect.bottom - barRect.top - 1}px`
  }

  private toggleQuickHeadingMenu(focusFirst: boolean): void {
    const menu = this.quickHeadingMenu
    if (!menu || !this.quickHeadingBtn || this.viewMode !== 'live') return
    if (!menu.hidden) {
      this.closeQuickHeadingMenu(true)
      return
    }
    menu.hidden = false
    this.positionQuickHeadingMenu()
    this.quickHeadingBtn.setAttribute('aria-expanded', 'true')
    if (focusFirst) menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }

  private closeQuickHeadingMenu(returnFocus: boolean): void {
    if (this.quickHeadingMenu) this.quickHeadingMenu.hidden = true
    this.quickHeadingBtn?.setAttribute('aria-expanded', 'false')
    if (returnFocus) this.quickHeadingBtn?.focus()
  }

  private applyQuickActionsDom(): void {
    const open = this.quickActionsOpen
    if (this.quickActionsEl) this.quickActionsEl.hidden = !open
    this.quickToggleBtn?.setAttribute('aria-expanded', String(open))
    if (!open) this.closeQuickHeadingMenu(false)
    if (open) {
      this.refreshQuickActions()
      requestAnimationFrame(() => this.updateQuickActionSeparators())
    }
  }

  private refreshQuickActions(): void {
    const bar = this.quickActionsEl
    // P2-10：操作条状态随操作目标视图（焦点在嵌入内部 Live 内 = B 的
    // 选区/格区；按钮执行同走 actionTarget——工具栏操作不写错目标）
    const embed = this.embedFocusedLive()
    const view = embed?.getView() ?? this.view
    if (!bar || !view || !this.quickActionsOpen) return
    const state = view.state
    const range = state.selection.main
    const region = state.field(tableRegionField, false)
    const editable = this.targetEditable(view, embed)
    const tree = state.field(liveDecorationsField).tree
    const readState = createQuickActionStateReader(state.doc, tree,
      { from: range.from, to: range.to }, region ?? null, editable)
    for (const el of bar.querySelectorAll<HTMLButtonElement>('[data-op], [data-heading-op]')) {
      const op = (el.dataset['op'] ?? el.dataset['headingOp']) as FormatOperationId
      const status = readState(op)
      el.disabled = status === 'disabled'
      el.dataset['formatState'] = status
      if (el.hasAttribute('role')) el.setAttribute('aria-checked', String(status === 'active'))
      else el.setAttribute('aria-pressed', status === 'mixed' ? 'mixed' : String(status === 'active'))
      const base = t(FORMAT_OPERATIONS.find((item) => item.id === op)!.titleKey)
      const bindings = this.quickBindingHints(op)
      const keys = bindings.map((key) => key.split('+').map((part) =>
        part.length === 1 ? part.toUpperCase() : part[0]!.toUpperCase() + part.slice(1)).join('+'))
      const joined = keys.join(t('common.keySeparator'))
      // #300 悬停词两段结构：名称与键位徽章分离（键位段为内部 \n 分隔的
      // 徽章串，显示连接符由徽章样式承担）；aria 侧沿用 keySeparator 显示串
      el.setAttribute('data-tooltip', base)
      if (keys.length) {
        el.setAttribute('data-tooltip-keys', keys.join(TOOLTIP_KEYS_SEPARATOR))
        el.setAttribute('aria-description', t('common.keybindingHint', { keys: joined }))
      } else {
        el.removeAttribute('data-tooltip-keys')
        el.removeAttribute('aria-description')
      }
    }
    const headingOptions = [...bar.querySelectorAll<HTMLElement>('[data-heading-op]')]
    this.quickHeadingBtn!.disabled = !editable || headingOptions.every((item) =>
      (item as HTMLButtonElement).disabled)
    bar.querySelector<HTMLButtonElement>('.vsidian-quick-table')!.disabled = !editable
    // 选区变化可禁用当前 roving Tab 入口（如行内代码内的粗体）。
    // 保留仍可用的入口；否则转移到首个可用按钮，且全条只留一个 Tab 停靠点。
    const actions = [...bar.querySelectorAll<HTMLButtonElement>('.vsidian-quick-action-group button')]
    const tabStop = actions.find((action) => !action.disabled && action.tabIndex === 0) ??
      actions.find((action) => !action.disabled)
    actions.forEach((action) => { action.tabIndex = action === tabStop ? 0 : -1 })
  }

  /** 语言切换（locale.changed → installLocale 通知）后的编辑器面板善后
   *  （#94 起就地刷新常驻文本；#101 起常驻控件文案创建与换包重刷统一经
   *  localeDom 注册表单点完成——顶栏/操作条框架与按钮、查找面板、冲突
   *  横幅、侧栏骨架与大纲骨架不再在此逐项回查，data-group 锚点随之退役，
   *  data-op/data-heading-op 仅保留给 refreshQuickActions）。此处剩三类：
   *  - 悬停词经 refreshQuickActions 重算：data-tooltip 基名 + 键位徽章两
   *    段随选区/输入驱动，与换包重刷互补（操作条关闭时早退，基名已由
   *    注册表就地换词）；
   *  - 表格控件层 aria-label 的就地兜底：tableControls 的控件按钮每轮
   *    render 全量重建取词（探索笔记 101 §4.5），静止窗口只剩层 aria；
   *  - 按需控件（#101 第三部分）：代码卡片/图形按钮/公式降级/图片错误/
   *    mermaid 错误占位/表格空格占位/图表弹窗（overlay 与工具条按钮）的
   *    固化文案经 localeOnDemand 的 document 级扫描就地重刷（含阅读视图
   *    已挂载块与 body 直下的弹窗；右键菜单等瞬态浮层随下次打开自然取
   *    新词，不扫）。 */
  private applyEditorLocale(): void {
    this.refreshQuickActions()
    this.liveWrapper?.querySelector('.vsidian-table-controls')
      ?.setAttribute('aria-label', t('table.controls'))
    refreshOnDemandControlLocale(document)
  }

  /** 主编辑区顶栏（#53 图标化）：左端齿轮设置按钮（打开宿主级 Vsidian
   *  设置页面板——webview 无权自建面板，必须经 settings.open 出站），
   *  其后快速操作 ✎；右端组（#158）= 刷新嵌入资源（#208，持有
   *  margin-left:auto 推靠）+ 双态视图切换（#141）+ 侧栏切换按钮紧随其后，
   *  与左组间弹性空隙。#38 起三态切换（含源码）仍在宿主标题栏命令，
   *  双态按钮不触及源码路径 */
  private buildToolbar(): HTMLElement {
    const bar = document.createElement('div')
    bar.className = 'vsidian-toolbar'
    const settingsBtn = document.createElement('button')
    settingsBtn.type = 'button'
    settingsBtn.className = 'vsidian-settings-toggle'
    bindLocaleAttrs(settingsBtn, 'sidebar.settings')
    settingsBtn.appendChild(createSettingsGearIcon())
    settingsBtn.addEventListener('click', () => this.bridge.postMessage({ kind: 'settings.open' }))
    const quickBtn = document.createElement('button')
    quickBtn.type = 'button'
    quickBtn.className = 'vsidian-quick-toggle'
    bindLocaleAttrs(quickBtn, 'sidebar.quickActions')
    quickBtn.setAttribute('aria-controls', 'vsidian-quick-actions')
    quickBtn.setAttribute('aria-expanded', 'false')
    quickBtn.textContent = '✎'
    // 与操作条内按钮一致：鼠标展开时保留正文焦点及表格矩形格区。
    // 只拦默认聚焦，不拦 click；Tab 聚焦后 Enter/Space 仍由原生按钮激活。
    quickBtn.addEventListener('mousedown', (event) => event.preventDefault())
    quickBtn.addEventListener('click', () => {
      this.quickActionsOpen = !this.quickActionsOpen
      this.applyQuickActionsDom()
      this.persistState()
    })
    this.quickToggleBtn = quickBtn
    // #208 刷新嵌入资源按钮（双态切换左侧、右端组首按钮）：点击出站
    // refresh.request，宿主清图片解析缓存并推进资源代次后回发
    // refresh.invalidated，本侧全量失效重挂（图片取新代次 URI 重载、
    // Mermaid 失败终态重置）。刷新不清文档/撤销栈/视图状态（光标、滚动、
    // 模式原样）；未就绪（无会话）时按钮无操作
    const refreshBtn = document.createElement('button')
    refreshBtn.type = 'button'
    refreshBtn.className = 'vsidian-refresh-toggle'
    bindLocaleAttrs(refreshBtn, 'toolbar.refresh')
    refreshBtn.appendChild(createRefreshIcon())
    refreshBtn.addEventListener('mousedown', (event) => event.preventDefault())
    refreshBtn.addEventListener('click', () => this.sendEmbeddedRefreshRequest())
    this.refreshBtn = refreshBtn
    // #141 双态视图切换按钮（紧邻侧栏按钮左侧）：图标显当前态（阅读=
    // 书本类 / Live=编辑类，显隐由 body 模式类经 CSS 驱动），aria/tooltip
    // 表目标动作（点击切到另一态），随当前态与界面语言双变化（回调登记，
    // 模式翻转经 applyModeDom 的 refreshElementLocale 重算）。切换不本地
    // 执行（#38 收敛宿主）：出站 view.switch.request，按钮态由宿主回流的
    // view.mode.set 驱动
    const viewBtn = document.createElement('button')
    viewBtn.type = 'button'
    viewBtn.className = 'vsidian-view-toggle'
    const viewLabel = (): string => t(this.viewMode === 'reading'
      ? 'toolbar.switchToLive' : 'toolbar.switchToReading')
    bindLocaleFnAttrs(viewBtn, viewLabel)
    viewBtn.appendChild(createViewToggleIcon())
    viewBtn.addEventListener('mousedown', (event) => event.preventDefault())
    viewBtn.addEventListener('click', () => {
      this.bridge.postMessage({
        kind: 'view.switch.request',
        target: this.viewMode === 'live' ? 'reading' : 'live',
      })
    })
    this.viewToggleBtn = viewBtn
    const sidebarBtn = document.createElement('button')
    sidebarBtn.type = 'button'
    sidebarBtn.className = 'vsidian-sidebar-toggle'
    sidebarBtn.setAttribute('aria-controls', 'vsidian-sidebar')
    // 可访问名称随开合态与语言双变化：回调登记（换包重算），开合态翻转由
    // applySidebarDom 调 refreshElementLocale 重算——同一登记点两个触发源
    const sidebarLabel = (): string => t(this.sidebarOpen ? 'sidebar.collapse' : 'sidebar.expand')
    bindLocaleFnAttrs(sidebarBtn, sidebarLabel)
    sidebarBtn.appendChild(createSidebarToggleIcon())
    sidebarBtn.addEventListener('click', () => this.toggleSidebar())
    this.sidebarToggleBtn = sidebarBtn
    bar.appendChild(settingsBtn)
    bar.appendChild(quickBtn)
    bar.appendChild(refreshBtn)
    bar.appendChild(viewBtn)
    bar.appendChild(sidebarBtn)
    return bar
  }

  /** #208 手动刷新请求发送（工具栏按钮与快捷键入口共用——两条入口汇合
   *  于此，宿主编排在 documentSession 的 refresh.request 处理唯一）：
   *  reqId 逐次自增并记录为「最后发出的请求」，回发的 refresh.invalidated
   *  以此配对（陈旧回执观测层丢弃）。未就绪（init 前）无会话身份，不发送。
   *  P2-11（#288）：内部 Live 的 B 图不走 A 会话缓存——同时向全部活跃
   *  目标端口广播 refresh.request（B 会话各自清缓存推进代次，回包经
   *  refEdit.push 信封驱动实例管理器全量失效重挂） */
  private sendEmbeddedRefreshRequest(): void {
    if (!this.sessionId || !this.docUri) {
      return
    }
    const reqId = this.refreshReqId + 1
    this.refreshReqId = reqId
    this.embedCards?.refreshLiveResources()
    this.bridge.postMessage({
      kind: 'refresh.request',
      sessionId: this.sessionId,
      docUri: this.docUri,
      reqId,
    })
  }

  /** 右侧栏骨架（#53）：自有顶栏（#54 起含「大纲」按钮）+ 折叠滑块行
   *  （#67，outline-active 时显示）+ 面板区域（#54 起含大纲面板容器）。
   *  侧栏显隐由 vsidian-body 的 open 类经 CSS 控制；大纲面板与滑块行显隐
   *  由侧栏容器的 outline-active 类经 CSS 控制 */
  private buildSidebar(): HTMLElement {
    const sidebar = document.createElement('div')
    sidebar.className = 'vsidian-sidebar'
    sidebar.id = 'vsidian-sidebar'
    // 就地登记：函数末尾的恢复收敛经 applyBacklinksDom/applyOutlinksDom 落
    // 容器类，彼时调用点（mount 的 this.sidebarEl = this.buildSidebar()）尚未
    // 返回赋值——不在此登记则重载恢复的反链/出链类被守卫跳过（大纲无此
    // 问题：applyOutlineDom 在 mount 后段、赋值之后才调用）
    this.sidebarEl = sidebar
    const bar = document.createElement('div')
    bar.className = 'vsidian-sidebar-toolbar'
    const actions = document.createElement('div')
    actions.className = 'vsidian-sidebar-toolbar-actions'
    // #54 大纲按钮：侧栏顶栏当前唯一一项（点击切换对应面板的显隐）
    const { toggle, panel } = buildOutlineDom()
    toggle.addEventListener('click', () => this.toggleOutline())
    // #66 条目点击跳转 + #67 箭头折叠：面板容器事件委托
    // （renderOutlineItems 重建条目 DOM 不丢监听；条目 DOM 与 outlineItems
    // 同序渲染，DOM 序号即数据索引）。点击按目标分流：箭头 = 单条折叠/
    // 展开（纯视图），文字 = 纯视图定位跳转（零写回、零出站、不入撤销栈）
    panel.addEventListener('click', (event) => {
      // #70：拖拽收尾后浏览器补发的 click 不触发跳转/折叠（只吞一次）
      if (this.outlineSuppressClick) {
        this.outlineSuppressClick = false
        event.stopPropagation()
        return
      }
      const target = event.target as HTMLElement | null
      const chevron = target?.closest?.(`.${OUTLINE_CLASS_NAMES.chevron}`)
      if (chevron instanceof HTMLElement && panel.contains(chevron)) {
        const itemEl = chevron.closest(`.${OUTLINE_CLASS_NAMES.item}`)
        const index = itemEl instanceof HTMLElement
          ? Array.from(
            panel.querySelectorAll<HTMLElement>(`.${OUTLINE_CLASS_NAMES.item}`),
          ).indexOf(itemEl)
          : -1
        if (index >= 0) {
          this.toggleOutlineItemCollapsed(index)
        }
        return
      }
      const item = target?.closest?.(`.${OUTLINE_CLASS_NAMES.item}`)
      if (!(item instanceof HTMLElement) || !panel.contains(item)) {
        return
      }
      const index = Array.from(
        panel.querySelectorAll<HTMLElement>(`.${OUTLINE_CLASS_NAMES.item}`),
      ).indexOf(item)
      if (index >= 0) {
        this.outlineJumpToItem(index)
      }
    })
    // #69 右键菜单：面板容器 contextmenu 委托（与 click 委托同模式——条目
    // DOM 重建不丢监听）。preventDefault 阻断浏览器原生菜单；目标取最近
    // 条目（箭头/文字/标记 span 上右键都算该条目）
    panel.addEventListener('contextmenu', (event) => {
      const target = event.target as HTMLElement | null
      const item = target?.closest?.(`.${OUTLINE_CLASS_NAMES.item}`)
      if (!(item instanceof HTMLElement) || !panel.contains(item)) {
        return
      }
      event.preventDefault()
      const index = Array.from(
        panel.querySelectorAll<HTMLElement>(`.${OUTLINE_CLASS_NAMES.item}`),
      ).indexOf(item)
      if (index >= 0) {
        this.openOutlineMenu(index, event.clientX, event.clientY)
      }
    })
    // #70 拖拽排序：条目 pointerdown 委托（与 click/contextmenu 同模式——
    // 条目 DOM 重建不丢监听）。位移超 4px 才进入拖拽态（点击/箭头操作不受
    // 扰动）；启动即记 doc 锚点快照并校准数据（条目索引与文档坐标对齐）。
    // 命中隐藏条目不启动（折叠遮蔽/搜索过滤的条目不可拖）
    // review-loops 第 2 轮：按下入口清理挂 document capture 层，而非本面板
    // 委托。吞噬标志与残留会话的危害面都是整个 webview 文档——任何 pointerup
    // 都会走到 onOutlineDragEnd 按残留落点写回，任何 click 都可能被残留的
    // 吞噬标志吞掉；而新会话只可能由面板内 pointerdown 启动。capture 先于
    // 本委托兑现，清理后本次按下照常启动新会话
    document.addEventListener('pointerdown', this.outlinePointerdownEntry, true)
    panel.addEventListener('pointerdown', (event) => {
      if (this.view === undefined) {
        return
      }
      // 次指针守卫：只针对**触屏多点**（第二指起 isPrimary=false）——次指针
      // 落在条目上只作无效输入丢弃，否则会直接新建会话、覆盖起始指针的会话
      // （与 document capture 层的残留清理同口径）。判据必须带 pointerType
      // ==='touch' 前提（review-loops 第 4 轮）：`new PointerEvent('pointerdown',
      // {…})` 未显式赋 isPrimary 时引擎默认 false、pointerType 默认空串，只按
      // isPrimary 判会静默拒掉整个合成事件路径（真机鼠标/笔恒 isPrimary=true，
      // 现网不受影响；但未来任何用 PointerEvent 构造拖拽钩子的代码会失效）
      if (event.pointerType === 'touch' && event.isPrimary === false) {
        return
      }
      // 启动判据只看按键位掩码、不限指针类型：触屏接触态 button=0（浏览器
      // 回归实测），照常启动；鼠标右/中键与笔 eraser/barrel（button≥1，按
      // W3C 位掩码）落不进拖拽入口——右键手势走 contextmenu
      if (event.button !== 0) {
        return
      }
      const target = event.target as HTMLElement | null
      const itemEl = target?.closest?.(`.${OUTLINE_CLASS_NAMES.item}`)
      if (!(itemEl instanceof HTMLElement) || !panel.contains(itemEl)) {
        return
      }
      if (itemEl.classList.contains(OUTLINE_CLASS_NAMES.hidden)) {
        return
      }
      const index = Array.from(
        panel.querySelectorAll<HTMLElement>(`.${OUTLINE_CLASS_NAMES.item}`),
      ).indexOf(itemEl)
      if (index < 0) {
        return
      }
      this.outlineEnsureFresh() // 数据与条目 DOM 对齐（拖拽锚点前提）
      if (!panel.contains(itemEl)) {
        return // 校准触发了重建：按下时的元素已脱挂，放弃启动（防错位）
      }
      this.outlineDragState = {
        fromIndex: index,
        doc: this.view.state.doc,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        targetIndex: null,
        position: null,
        hintEl: null,
      }
      document.addEventListener('pointermove', this.onOutlineDragMove)
      document.addEventListener('pointerup', this.onOutlineDragEnd)
      document.addEventListener('pointercancel', this.onOutlineDragCancel)
      document.addEventListener('keydown', this.onOutlineDragEscape, true)
      window.addEventListener('blur', this.onOutlineDragCancel)
    })
    this.outlineToggleBtn = toggle
    this.outlinePanelEl = panel
    actions.appendChild(toggle)
    // #197 反链面板：与大纲同款构建器形态（{toggle, panel}）；面板事件
    // 统一容器委托（renderBacklinksState 重建条目 DOM 不丢监听）——工具
    // 栏按钮/排序菜单项/组头为纯视图操作，卡片点击出站 backlink.activate
    //（宿主打开来源文档并定位），纯只读意图
    const backlinks = buildBacklinksDom()
    backlinks.toggle.addEventListener('click', () => this.toggleBacklinks())
    backlinks.panel.addEventListener('click', (event) => this.handleBacklinkPanelClick(event))
    backlinks.panel.addEventListener('input', (event) => this.handleBacklinkSearchInput(event))
    backlinks.panel.addEventListener('keydown', (event) => this.handleBacklinkPanelKeydown(event))
    // #221 面板悬停入口：条目直接悬停触发预览（面板不随正文模式改变触发
    // 规则——正文 Live 时面板仍是直接悬停）；目标载荷与点击同源（最近快
    // 照 items），开闭时序与保活在 hoverPopup 模块
    backlinks.panel.addEventListener('mouseover', (event) => this.handleBacklinkHover(event, 'enter'))
    backlinks.panel.addEventListener('mouseout', (event) => this.handleBacklinkHover(event, 'leave'))
    this.backlinksToggleBtn = backlinks.toggle
    this.backlinksPanelEl = backlinks.panel
    actions.appendChild(backlinks.toggle)
    // 出链面板（出链面板批次）：与反链同款构建器形态；条目点击委托发
    // outlink.activate（断链条目 disabled 不派发）
    const outlinks = buildOutlinksDom()
    outlinks.toggle.addEventListener('click', () => this.toggleOutlinks())
    outlinks.panel.addEventListener('click', (event) => this.handleOutlinkPanelClick(event))
    // #221 出链面板悬停：与反链同款直接悬停（断链条目同样可悬停——
    // 空串 fsPath 走宿主 not-found 分态显示失效占位）
    outlinks.panel.addEventListener('mouseover', (event) => this.handleOutlinkHover(event, 'enter'))
    outlinks.panel.addEventListener('mouseout', (event) => this.handleOutlinkHover(event, 'leave'))
    this.outlinksToggleBtn = outlinks.toggle
    this.outlinksPanelEl = outlinks.panel
    actions.appendChild(outlinks.toggle)
    bar.appendChild(actions)
    // #67 折叠滑块行：顶栏与面板之间（结绳记事六圆点）。点击走行级 click
    // 委托（圆点冒泡；键盘激活圆点的 click 同路）；拖拽走 pointer 事件——
    // 位移超阈值后捕获指针，逐档换算（outlineSliderLevelAt 最近圆点）。
    // 捕获后 click 目标变为行自身（圆点落空），拖拽选档不会双发
    const slider = buildOutlineSlider(this.outlineExpandLevel, outlineExpandLevelLabel)
    slider.row.addEventListener('click', (event) => {
      const dot = (event.target as HTMLElement | null)?.closest?.(
        `.${OUTLINE_CLASS_NAMES.sliderDot}`,
      )
      if (dot instanceof HTMLButtonElement) {
        const level = Number(dot.dataset['vsidianLevel'])
        if (Number.isInteger(level)) {
          this.setOutlineExpandLevel(level)
        }
      }
    })
    let dragStartX: number | null = null
    let dragging = false
    slider.row.addEventListener('pointerdown', (event) => {
      // 启动判据与面板条目入口同口径（review-loops 第 4 轮对齐）：只看法定
      // 按键（非主键不武装起始坐标），不设指针类型前提——旧判据带
      // pointerType==='mouse' 前缀，笔 barrel（button=2/buttons=2）据此在滑块
      // 行上会武装拖拽起点（实害有限：移动路径的 (buttons & 1) === 0 兜住
      // 后续推进；对齐后连起点都不再武装，且与其余三处判据同一条不变式）
      if (event.button !== 0) {
        return
      }
      dragStartX = event.clientX
      dragging = false
    })
    slider.row.addEventListener('pointermove', (event) => {
      if (dragStartX === null || (event.buttons & 1) === 0) {
        return
      }
      if (!dragging && Math.abs(event.clientX - dragStartX) > 4) {
        dragging = true
        slider.row.setPointerCapture(event.pointerId)
      }
      if (dragging) {
        const level = outlineSliderLevelAt(slider, event.clientX, this.outlineExpandLevel)
        if (level !== this.outlineExpandLevel) {
          this.setOutlineExpandLevel(level)
        }
      }
    })
    const endSliderDrag = (): void => {
      dragStartX = null
      dragging = false
    }
    slider.row.addEventListener('pointerup', endSliderDrag)
    slider.row.addEventListener('pointercancel', endSliderDrag)
    this.outlineSlider = slider
    // #68 工具条行：侧栏顶栏与滑块行之间（跳转到末尾、重置、搜索框）。
    // 按钮与输入均为纯视图操作（零写回、零出站、不入撤销栈）；搜索输入
    // 即时生效（input 事件直调，无去抖）
    const toolbar = buildOutlineToolbar()
    toolbar.jumpBottom.addEventListener('click', () => this.outlineJumpToBottom())
    toolbar.reset.addEventListener('click', () => this.resetOutline())
    toolbar.search.addEventListener('input', () => this.setOutlineSearch(toolbar.search.value))
    this.outlineToolbar = toolbar
    const panelHost = document.createElement('div')
    panelHost.className = 'vsidian-sidebar-panel'
    panelHost.appendChild(panel)
    panelHost.appendChild(this.backlinksPanelEl!)
    panelHost.appendChild(this.outlinksPanelEl!)
    sidebar.appendChild(bar)
    sidebar.appendChild(toolbar.row)
    sidebar.appendChild(slider.row)
    sidebar.appendChild(panelHost)
    // 拖宽句柄：左缘热区（宽度与悬停高亮见 main.css），侧栏收起时随 width:0 +
    // overflow:hidden 裁切（不可交互）。拖拽照折叠滑块模式（#67）：主键
    // pointerdown 武装起点 → 超 4px 进拖拽态捕获指针 → move 换算宽度 →
    // up 落定持久化；Escape/pointercancel 回滚拖前宽度不持久化；双击重置
    // 默认；聚焦时 ArrowLeft/Right 按步长微调（同钳制同持久化）
    const resizer = document.createElement('div')
    resizer.className = 'vsidian-sidebar-resizer'
    resizer.setAttribute('role', 'separator')
    resizer.setAttribute('aria-orientation', 'vertical')
    // #101 漏刷修复：此前创建后无任何换包刷新路径覆盖（探索笔记 §1.4）
    bindLocale(resizer, 'aria-label', 'sidebar.resize')
    resizer.setAttribute('aria-valuemin', String(SIDEBAR_WIDTH_MIN))
    resizer.setAttribute('aria-valuemax', String(SIDEBAR_WIDTH_MAX))
    resizer.setAttribute('aria-valuenow', String(this.sidebarWidth))
    resizer.tabIndex = 0
    resizer.addEventListener('pointerdown', (event) => {
      // 启动判据与其余拖拽入口同口径：只看法定按键，不设指针类型前提
      if (event.button !== 0) {
        return
      }
      // 残留会话先回收再武装新会话：up/cancel 在 webview 外丢失（按住移出
      // 窗口释放、和弦菜单吞事件）时不被新手势收养陈旧起点。document
      // capture 层已先清理，此处防御冗余
      if (this.sidebarResizeState) {
        this.endSidebarResize(true)
      }
      this.sidebarResizeState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startWidth: this.sidebarWidth,
        moved: false,
      }
      // 窗口失焦兜底（与大纲拖拽同口径）：武装时挂 blur，收尾时摘（同引用幂等）
      window.addEventListener('blur', this.onSidebarResizeBlur)
    })
    resizer.addEventListener('pointermove', (event) => {
      const s = this.sidebarResizeState
      if (!s) {
        return
      }
      // 和弦与已释放守卫（对齐 onOutlineDragMove 口径）：非主键位落下
      // （buttons=3 等，第二个按键只报 move）证明手势意图已变；buttons=0
      // 说明释放发生在 webview 之外——都立即回滚收尾，不推进会话
      if ((event.buttons & ~1) !== 0 || event.buttons === 0) {
        this.endSidebarResize(true)
        return
      }
      if (!s.moved) {
        if (Math.abs(event.clientX - s.startX) <= 4) {
          return
        }
        s.moved = true
        // 起点从渲染宽校准：外部片段注入 --vsidian-sidebar-width 时内部
        // sidebarWidth 仍是缺省值，拖宽应从当前渲染宽连续开始而非跳变；
        // jsdom 无布局（rect 宽 0）时跳过校准，保持内部值
        const rect = this.sidebarEl?.getBoundingClientRect()
        if (rect && Number.isFinite(rect.width) && rect.width > 0) {
          s.startWidth = clampSidebarWidth(rect.width)
        }
        // 真实指针捕获（移出热区后 move/up 仍回到句柄）；合成事件无
        // pointerId（undefined），跳过捕获——直派路径照样命中本监听
        if (typeof event.pointerId === 'number') {
          resizer.setPointerCapture(event.pointerId)
        }
        this.sidebarEl?.classList.add('vsidian-sidebar-resizing')
        document.addEventListener('keydown', this.onSidebarResizeEscape, true)
      }
      // 右栏在右侧：向左拖（clientX 减小）增宽
      this.applySidebarWidth(clampSidebarWidth(s.startWidth + (s.startX - event.clientX)), false)
    })
    resizer.addEventListener('pointerup', (event) => {
      const s = this.sidebarResizeState
      if (!s || (typeof event.pointerId === 'number' && event.pointerId !== s.pointerId)) {
        return
      }
      if (s.moved) {
        this.applySidebarWidth(this.sidebarWidth, true)
      }
      this.endSidebarResize()
    })
    resizer.addEventListener('pointercancel', () => this.endSidebarResize(true))
    resizer.addEventListener('dblclick', () => {
      this.applySidebarWidth(SIDEBAR_WIDTH_DEFAULT, true)
    })
    resizer.addEventListener('keydown', (event) => {
      // 收起态句柄被 CSS 裁切且不可聚焦（visibility:hidden，真实浏览器已
      // 移出 tab 序）；语义防御：不可见元素的键盘事件不改变宽度
      if (!this.sidebarOpen) {
        return
      }
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
        return
      }
      // 拖拽会话中键盘微调不介入（move 换算以会话起点为基，混入会互相覆盖）
      if (this.sidebarResizeState) {
        return
      }
      event.preventDefault()
      const step = event.key === 'ArrowLeft' ? SIDEBAR_RESIZE_STEP : -SIDEBAR_RESIZE_STEP
      this.applySidebarWidth(clampSidebarWidth(this.sidebarWidth + step), true)
    })
    this.sidebarResizerEl = resizer
    sidebar.appendChild(resizer)
    // 残留会话清理挂 document 常驻 capture 层（照 outlinePointerdownEntry
    // 先例，#70）：up/cancel 在 webview 外丢失留下的会话会被下次拖拽收养
    // 陈旧起点并持久化错误宽度；任意新按下都证明上一手势已结束，先回收。
    // capture 先于句柄监听兑现，清理后本次按下照常武装新会话
    document.addEventListener('pointerdown', this.sidebarResizePointerdownEntry, true)
    // #197 初始互斥态：持久化恢复可能多个面板都 active（旧状态组合），以
    // 大纲 > 反链 > 出链优先收敛（出链面板的快照到达前显示 loading 占位，
    // 切换即可见）
    if (this.backlinksActive && this.outlineActive) {
      this.backlinksActive = false
    }
    if (this.outlinksActive && (this.outlineActive || this.backlinksActive)) {
      this.outlinksActive = false
    }
    this.applyBacklinksDom()
    this.applyOutlinksDom()
    return sidebar
  }

  /** 侧栏切换（#53）：纯视图状态翻转（零写回、零出站），随后落 DOM 与持久化 */
  private toggleSidebar(): void {
    this.sidebarOpen = !this.sidebarOpen
    this.applySidebarDom()
    // 展开即见大纲：面板从不可见到可见，数据可能滞后（收起期间无刷新调度）
    if (this.sidebarOpen && this.outlineActive) {
      this.outlineEnsureFresh()
    } else if (!this.sidebarOpen) {
      this.cancelOutlineRefresh()
      this.cancelOutlineHighlightUpdate()
      // #69：侧栏收起时浮层（菜单）与重命名编辑态随之退出
      this.closeOutlineMenu()
      this.cancelOutlineRename()
      // #70：拖拽会话随之退出（面板不可见，落点失去意义）
      this.cancelOutlineDrag()
      // 拖宽会话随之退出（侧栏不可见，宽度变化失去意义——回滚拖前宽度）
      this.endSidebarResize(true)
    }
  }

  /** 侧栏状态落 DOM：body 容器的 open 类（CSS 显隐与图标粗细的唯一开关）
   *  与切换按钮的可访问状态同步（名称反映当前可执行的动作，经注册表回调
   *  重算——见 buildToolbar 的 sidebarLabel 登记） */
  private applySidebarDom(): void {
    if (this.bodyEl) {
      this.bodyEl.classList.toggle('vsidian-sidebar-open', this.sidebarOpen)
    }
    const btn = this.sidebarToggleBtn
    if (btn) {
      btn.setAttribute('aria-expanded', String(this.sidebarOpen))
      refreshElementLocale(btn)
    }
    this.persistState()
  }

  // ---- 侧栏拖宽 ----

  /** 宽度落点：状态 + 内联 CSS 变量 + separator aria 值同步 + 可选持久化。
   *  默认宽度不写变量（回到默认即移除）——保持 --vsidian-sidebar-width 的
   *  公开覆盖入口，外部片段仍可注入自定义宽度 */
  private applySidebarWidth(px: number, persist: boolean): void {
    this.sidebarWidth = px
    const el = this.sidebarEl
    if (el) {
      if (px === SIDEBAR_WIDTH_DEFAULT) {
        el.style.removeProperty('--vsidian-sidebar-width')
      } else {
        el.style.setProperty('--vsidian-sidebar-width', `${px}px`)
      }
    }
    this.sidebarResizerEl?.setAttribute('aria-valuenow', String(px))
    if (persist) {
      this.persistState()
    }
  }

  /** 拖宽收尾：清拖拽态类、Escape 与 blur 监听。rollback=true 时恢复拖前
   *  宽度（Escape/pointercancel/残留回收路径，不持久化）；落定路径在收尾前
   *  已持久化。幂等：无会话时纯监听摘除（同引用 removeEventListener 无害） */
  private endSidebarResize(rollback = false): void {
    const s = this.sidebarResizeState
    this.sidebarResizeState = null
    this.sidebarEl?.classList.remove('vsidian-sidebar-resizing')
    document.removeEventListener('keydown', this.onSidebarResizeEscape, true)
    window.removeEventListener('blur', this.onSidebarResizeBlur)
    if (rollback && s) {
      this.applySidebarWidth(s.startWidth, false)
    }
  }

  /** 拖宽按下入口清理（document 常驻 capture pointerdown，仿
   *  outlinePointerdownEntry）：任意新按下都证明上一手势已结束，残留会话
   *  （越界释放、alt-tab 等留下的）先回收——否则下次拖拽收养陈旧起点。
   *  触屏次指针豁免与先例同口径（review-loops 第 4 轮教训）：只排除
   *  touch + isPrimary=false，不限指针类型前提——否则第二指落下会误杀
   *  首指进行中的拖宽 */
  private readonly sidebarResizePointerdownEntry = (event: PointerEvent): void => {
    if (event.pointerType === 'touch' && event.isPrimary === false) {
      return
    }
    if (this.sidebarResizeState) {
      this.endSidebarResize(true)
    }
  }

  /** 拖宽会话的 window blur 兜底（与大纲拖拽同口径）：焦点离开窗口
   *  （按住拖出后 alt-tab 等）时 up/cancel 不再送达，残留会话就地回收 */
  private readonly onSidebarResizeBlur = (): void => {
    this.endSidebarResize(true)
  }

  /** 拖拽中 Escape 取消：document 捕获层监听（进入拖拽态时挂、收尾时摘），
   *  焦点不在句柄上也能取消（与大纲条目拖拽同口径） */
  private readonly onSidebarResizeEscape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.sidebarResizeState) {
      event.preventDefault()
      this.endSidebarResize(true)
    }
  }

  /** 测试钩子实现：真实句柄 pointer 事件序列（down → 超阈值 move 进拖拽
   *  态 → 左移 delta px 的 move → up 落定）。MouseEvent 构造（与
   *  runOutlineDragTest 同手法）：处理器只读坐标/buttons/pointerId，
   *  jsdom 无 PointerEvent 构造器同样可派发 */
  private runSidebarResizeTest(delta: number): void {
    // 侧栏收起态句柄被 CSS 裁切（用户不可交互），钩子同步拒绝——防用例
    // 顺序调整写入不可见持久化
    if (!this.sidebarOpen) {
      return
    }
    const resizer = this.sidebarResizerEl
    if (!resizer) {
      return
    }
    // 会话卫生：上一轮未收尾的会话先回滚（集成用例连续驱动时必需）
    if (this.sidebarResizeState) {
      this.endSidebarResize(true)
    }
    const rect = resizer.getBoundingClientRect()
    const x0 = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const fire = (type: string, x: number): void => {
      resizer.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, clientX: x, clientY: y,
        buttons: type === 'pointerup' ? 0 : 1,
      }))
    }
    fire('pointerdown', x0)
    fire('pointermove', x0 - 5) // 超阈值（>4px）进入拖拽态
    fire('pointermove', x0 - delta)
    fire('pointerup', x0 - delta)
  }

  // ---- 大纲面板（#54）----
  // 与 sidebarOpen / viewMode 同类：纯 webview 视图状态（零写回、零出站、
  // 不入撤销栈），经 bridge state 持久化。数据源是 CM6 全文（含未保存编辑），
  // 与视口渲染、live/reading 模式均无关（CM6 doc 在两模式下都是权威文本模型）。

  // ---- 反链面板（#197）----
  // 与大纲面板互斥：同域面板区域（.vsidian-sidebar-panel）同一时刻只显示
  // 一个面板——切换即互斥（开反链收大纲、开大纲收反链），侧栏开关不受影响。

  /** 反链按钮点击：active 翻转 + 互斥落 DOM（纯视图状态，零写回零出站） */
  private toggleBacklinks(): void {
    this.backlinksActive = !this.backlinksActive
    if (this.backlinksActive) {
      if (this.outlineActive) {
        this.outlineActive = false
        this.applyOutlineDom()
      }
      if (this.outlinksActive) {
        this.outlinksActive = false
        this.applyOutlinksDom()
      }
    }
    this.applyBacklinksDom()
    // 面板展开即见：快照可能滞后（面板不可见期间宿主推送被丢弃——面板
    // 重开重新拉取对齐）
    if (this.backlinksActive && this.docUri && this.sessionId) {
      this.bridge.postMessage({ kind: 'backlinks.get', sessionId: this.sessionId, docUri: this.docUri })
    }
  }

  /** 反链状态落 DOM：侧栏容器的 backlinks-active 类是面板显隐唯一开关
   *  （CSS 控制），按钮 aria-expanded 同步；快照内容随 active 渲染 */
  private applyBacklinksDom(): void {
    if (this.sidebarEl) {
      this.sidebarEl.classList.toggle('vsidian-backlinks-active', this.backlinksActive)
    }
    this.backlinksToggleBtn?.setAttribute('aria-expanded', String(this.backlinksActive))
    if (this.backlinksPanelEl) {
      // #221 面板状态翻转（隐藏失效/激活重建条目）都使悬停锚点失效：
      // 锚点在本面板内的浮层先行释放
      closeHoverPopupIfAnchorWithin(this.backlinksPanelEl)
      if (this.backlinksActive) {
        renderBacklinksState(this.backlinksPanelEl, this.backlinksSnapshot, this.backlinkView)
      }
    }
    this.persistState()
  }

  /** 反链面板当前是否用户可见 */
  private backlinksVisible(): boolean {
    return this.sidebarOpen && this.backlinksActive
  }

  /** 反链面板内容重渲染（视图状态或快照变化时；不可见时只改状态，重开时
   *  applyBacklinksDom 用最新 view 渲染） */
  private rerenderBacklinks(): void {
    if (this.backlinksPanelEl && this.backlinksActive) {
      // #221 条目 DOM 全量重建（replaceChildren）：在场悬停浮层的锚点随旧
      // DOM 脱树，先释放再渲染（面板重渲染不派发 mouseout，不依赖迟到检测）
      closeHoverPopupIfAnchorWithin(this.backlinksPanelEl)
      closeTargetTipIfAnchorWithin(this.backlinksPanelEl)
      renderBacklinksState(this.backlinksPanelEl, this.backlinksSnapshot, this.backlinkView)
    }
  }

  // ---- #221 全入口悬停（Live 正文 / 反链·出链面板 / 键盘命令） ----
  // 三入口共用 hoverPopup 的 openPopup 核心：目标规格由各入口组装
  //（HoverPopupTargetSpec），开闭时序、保活与迟到守卫单点收敛。

  /** Live 直接悬停设置（hover.liveDirect；缺省 false = 默认 Ctrl+悬停） */
  private liveHoverDirect(): boolean {
    return this.settings?.[HOVER_LIVE_DIRECT_KEY] === true
  }

  /** #298 悬停总开关（hover.enabled；缺省/快照未达 = true 开）：关闭时
   *  所有悬停路径不开浮层——经 hoverPreview 上下文投影，门控统一收敛在
   *  hoverPopup 的 hoverPreviewAnchorEnter 入口（阅读/面板/Live 两路/
   *  补按 Ctrl 补触发全部路由该入口） */
  private hoverPreviewEnabled(): boolean {
    return this.settings?.[HOVER_ENABLED_KEY] !== false
  }

  /** #342（P3-10）外链预览开关（hover.externalEnabled；缺省/快照未达 =
   *  false 关）：预滤门控——开启时 Reading/Live 的 http(s) 链接进入悬停
   *  浮层（宿主经 web 通道受限抓取）；关闭态预滤不放行（零 hover.request，
   *  宿主解析层复核兜底——双保险） */
  private hoverExternalEnabled(): boolean {
    return this.settings?.[HOVER_EXTERNAL_ENABLED_KEY] === true
  }

  /** #299 跳转目标提示开关（hover.targetTip；缺省/快照未达 = true 开，
  *  独立于总开关——总开关关闭时提示反而成为悬停的唯一反馈）：经
  *  targetTip 上下文投影，门控收敛在 targetTip 模块入口 */
  private targetTipEnabled(): boolean {
    return this.settings?.[HOVER_TARGET_TIP_KEY] !== false
  }

  /** 悬停二路由收拢（审查修复；review-loops 第 1 轮懒化重构）：spec 以
   *  提供者（thunk）传入——浮层将现路径立即求值，null 直接 return 不进
   *  浮层入口：与 #221 旧版「修饰位足但 spec null 不开浮层」结构等价，
   *  不再依赖浮层开延迟到期后的 DOM 自提取兜底（旧接线把 null 透传为
   *  undefined 进浮层入口，其等价性靠 Live 装饰无 href、自提取恒 null
   *  的巧合成立）；不将现路径把 thunk 原样下传目标提示，求值延迟到其
   *  稳定悬停计时到期回调内——默认组合（总开关开、liveDirect 关、无
   *  Ctrl）下划过链接（计时到期前离开）零解析成本。面板目标不在正文
   *  DOM，浮层无法自提取，spec 必须随进；Reading 传同一提取器。将现
   *  判定缺省为总开关（hover.enabled）；Live 因修饰位参与判定由调用侧
   *  传入。阅读 mouseover / Live mouseover / 反链 / 出链四入口同一形状
   *  单点维护 */
  private enterHoverOrTip(
    anchor: HTMLElement,
    specOf: () => HoverPopupTargetSpec | null,
    popupImminent = this.hoverPreviewEnabled(),
  ): void {
    if (popupImminent) {
      const spec = specOf()
      if (!spec) {
        return
      }
      hoverPreviewAnchorEnter(anchor, spec)
      return
    }
    targetTipAnchorEnter(anchor, specOf)
  }

  /** 离开悬停目标（四入口 mouseout 共用）：浮层与目标提示两通道成对
   *  转发（relatedTarget 落在本体内 = 联合域保活，两模块各自判定；
   *  锚点内部移动的过滤在调用侧） */
  private leaveHoverAndTip(anchor: HTMLElement, related: EventTarget | null): void {
    hoverPreviewAnchorLeave(anchor)
    targetTipAnchorLeave(anchor, related instanceof Node ? related : null)
  }

  /** 指针当前悬停的 Live 链接装饰：mouseover 时总在记录
   *  （修饰位不足也不丢——「先悬停、后按 Ctrl」补触发的现场），mouseout
   *  / 模式切换时清空；目标经装饰 DOM 映射到源码，不依赖指针坐标 */
  private lastLiveHover: { anchor: HTMLElement } | null = null

  /** Ctrl/Cmd 按下补触发（验收反馈：指针已在链接上再按修饰键同样开浮层
   *  ——mouseover 时刻判修饰位只覆盖「按住再进入」，此路径覆盖「进入后
   *  按下」）。锚点经 DOM 映射到实时源码位置；同锚已开
   *  浮层时 enter 幂等（取消待关计时），不同锚换锚重开。#298 总开关
   *  关闭时被前置拦截——本路径与所有悬停入口同收敛于
   *  hoverPreviewAnchorEnter 的 hover.enabled 门控 */
  private onLiveHoverModifierDown(): void {
    if (this.viewMode !== 'live' || this.liveHoverDirect()) {
      return
    }
    const pending = this.lastLiveHover
    if (!pending || !pending.anchor.isConnected) {
      this.lastLiveHover = null
      return
    }
    const view = this.view
    if (!view) {
      return
    }
    const spec = this.liveLinkSpecOfAnchor(view, pending.anchor)
    if (!spec) {
      return
    }
    hoverPreviewAnchorEnter(pending.anchor, spec)
  }

  /** 鼠标已命中链接装饰，按该 DOM 的起点解析目标。替换 widget 的
   *  posAtCoords 在右半段返回源码结束位置（区间外），不能据此缩小热区；
   *  posAtDOM 保留整段可见文字的命中语义，也不会把相邻链接串成另一个
   *  目标。键盘命令仍走 liveLinkSpecAt 的精确源码位置与原有半开区间。 */
  private liveLinkSpecOfAnchor(view: EditorView, anchor: HTMLElement): HoverPopupTargetSpec | null {
    if (!view.contentDOM.contains(anchor)) {
      return null
    }
    return this.liveLinkSpecAt(view, view.posAtDOM(anchor, 0))
  }

  /** Live 悬停锚点归约：链接装饰 DOM（树驱动/宽松链接 mark 的
   *  vsidian-link 与双链 mark/widget 的 vsidian-wikilink span）。enter 与
   *  leave 用同一归约——联合域（锚点 ∪ 浮层）与同锚点重入判定依赖两侧
   *  归约出同一元素。非链接装饰（正文/行号等）返回 null 不触发 */
  private liveHoverAnchorOf(target: EventTarget | null): HTMLElement | null {
    const el = target instanceof Element ? target : null
    const deco = el?.closest?.(`.${LINK_CLASS_NAMES.link}, .${WIKILINK_CLASS_NAMES.wikilink}`)
    return deco instanceof HTMLElement ? deco : null
  }

  /** Live 悬停离开分派（mouseout 委托转发）：归约锚点后成对转发浮层与
   *  目标提示的离开（enter 侧已由 mouseover 直接走 enterHoverOrTip，无
   *  事件重放需求） */
  private handleLiveHoverLeave(event: MouseEvent): void {
    const anchor = this.liveHoverAnchorOf(event.target)
    if (!anchor) {
      return
    }
    const related = event.relatedTarget
    if (related instanceof Node && anchor.contains(related)) {
      return // 装饰内部移动（嵌套行内标记）不视为离开
    }
    this.leaveHoverAndTip(anchor, related)
  }

  /** Live 目标判定（与点击 mousedown 的判定族同序同口径）：双链 → 树驱动
   *  链接 → 宽松链接；图片形态与代码/头区上下文由判定族自身排除，嵌入
   *  `![[…]]` 不命中（双链扫描守卫排除前置 `!`），普通链接外部 scheme 经
   *  isHoverableMdLinkHref 预滤（与 Reading 同口径） */
  private liveLinkSpecAt(view: EditorView, pos: number): HoverPopupTargetSpec | null {
    let spec: HoverPopupTargetSpec | null = null
    activateWikilinkAtPos(view, pos, (target, from, to) => {
      spec = { target, sourceStart: from, sourceEnd: to }
    })
    if (!spec) {
      activateLinkAtPos(view, pos, (href, from, to) => {
        if (isHoverableMdLinkHref(href) || (this.hoverExternalEnabled() && isHttpLinkHref(href))) {
          spec = { target: href, linkHref: href, sourceStart: from, sourceEnd: to }
        }
      })
    }
    if (!spec) {
      activateLooseLinkAtPos(view, pos, (dest, from, to) => {
        if (isHoverableMdLinkHref(dest) || (this.hoverExternalEnabled() && isHttpLinkHref(dest))) {
          spec = { target: dest, linkHref: dest, sourceStart: from, sourceEnd: to }
        }
      })
    }
    return spec
  }

  /** #221 反链面板悬停：条目直接悬停（不随正文模式改变触发规则）；目标 =
   *  来源文档全文（directFsPath 无锚点——引用处不是标题/块语义，full 范围
   *  呈现来源文档），载荷从最近快照 items 取（与点击同源——条目 DOM 只存
   *  相对路径，绝对路径在快照） */
  private handleBacklinkHover(event: MouseEvent, phase: 'enter' | 'leave'): void {
    const panel = this.backlinksPanelEl
    const item = (event.target as HTMLElement | null)?.closest?.(`.${BACKLINK_CLASS_NAMES.item}`)
    if (!(item instanceof HTMLElement) || !panel?.contains(item)) {
      return
    }
    if (phase === 'leave') {
      const related = event.relatedTarget
      if (related instanceof Node && item.contains(related)) {
        return
      }
      this.leaveHoverAndTip(item, related)
      return
    }
    if (!this.sessionId || !this.docUri) {
      return
    }
    const payload = this.backlinkItemPayloadOf(item)
    if (!payload) {
      return
    }
    const spec = {
      target: payload.sourceRelPath,
      sourceStart: 0, // 引用区间在来源文档而非当前文档，给中性值
      sourceEnd: 0,
      directFsPath: payload.sourceFsPath,
      openAction: this.backlinkOpenAction(payload),
    }
    // #299 总开关开 → 浮层将现（面板恒直接悬停）；关 → 目标提示候选
    //（spec 已就地构造，thunk 统一形态——enterHoverOrTip 两路由单点）
    this.enterHoverOrTip(item, () => spec)
  }

  /** #217 验收跟进：面板形态浮层 header 跳转——与条目点击同通道同载荷
   *  （反链定位引用处 / 出链带锚点），经 spec.openAction 闭包交给浮层
   *  （浮层侧不再按双链/linkHref 默认形态分派） */
  private backlinkOpenAction(payload: BacklinkItemPayload): () => void {
    return () => {
      if (!this.sessionId || !this.docUri) {
        return
      }
      this.bridge.postMessage({
        kind: 'backlink.activate',
        sessionId: this.sessionId,
        docUri: this.docUri,
        sourceUri: payload.sourceFsPath,
        offset: payload.start,
      })
    }
  }

  private outlinkOpenAction(payload: OutlinkItemPayload): () => void {
    return () => {
      // 断链条目无目标（与条目点击同守卫不派发）
      if (!this.sessionId || !this.docUri || !payload.targetFsPath) {
        return
      }
      this.bridge.postMessage({
        kind: 'outlink.activate',
        sessionId: this.sessionId,
        docUri: this.docUri,
        targetUri: payload.targetFsPath,
        anchor: payload.anchor ?? '',
      })
    }
  }

  /** #221 出链面板悬停：与反链同款直接悬停；目标 = 条目 fsPath ± 锚点
   *  （断链条目 targetFsPath 为 null → 空串 fsPath 入队，宿主回 not-found
   *  分态显示失效占位）；载荷从快照 items 取（条目 DOM 的 data-* 只在
   *  可点条目写入，统一走快照配对） */
  private handleOutlinkHover(event: MouseEvent, phase: 'enter' | 'leave'): void {
    const panel = this.outlinksPanelEl
    const item = (event.target as HTMLElement | null)?.closest?.(`.${OUTLINK_CLASS_NAMES.item}`)
    if (!(item instanceof HTMLElement) || !panel?.contains(item)) {
      return
    }
    if (phase === 'leave') {
      const related = event.relatedTarget
      if (related instanceof Node && item.contains(related)) {
        return
      }
      this.leaveHoverAndTip(item, related)
      return
    }
    const payload = this.outlinkItemPayloadOf(item)
    if (!payload) {
      return
    }
    const spec = {
      target: payload.targetDisplay,
      sourceStart: payload.start, // 出链标记在当前文档内的区间（语义吻合）
      sourceEnd: payload.end,
      directFsPath: payload.targetFsPath ?? '',
      ...(payload.anchor ? { directAnchor: payload.anchor } : {}),
      openAction: this.outlinkOpenAction(payload),
    }
    // #299 总开关开 → 浮层将现；关 → 目标提示候选（断链条目空串 fsPath
    // 由宿主轻量解析回失败，不出提示——与浮层的 not-found 分态分工不同；
    // spec 已就地构造，thunk 统一形态）
    this.enterHoverOrTip(item, () => spec)
  }

  /** #221 键盘命令「预览当前链接」：手动打开浮层且焦点进入（无目标静默
   *  不误开）。Live 以光标处合法目标为准（主光标 head）；Reading/面板以
   *  键盘聚焦的链接/条目为准。面板入口不随正文模式改变触发规则——Live
   *  光标无目标时继续检查聚焦元素（面板条目在 Live 下同样可达）。不接
   *  管源码编辑器（源码模式不经 webview 键路由天然不可达）与设置页输入
   *  （独立 webview 无此路由） */
  private previewLinkAtFocus(): void {
    if (this.viewMode === 'live' && this.view && this.previewLiveLinkAtCursor()) {
      return
    }
    const focus = document.activeElement
    if (!(focus instanceof HTMLElement)) {
      return
    }
    // Reading 键盘聚焦链接（a[href] 天然可 Tab 聚焦）：排除嵌入卡片内的
    // 链接——嵌入内容已有常驻 Reading 呈现，不重复弹窗（与鼠标路径的
    // stopPropagation 口径一致）
    const anchor = focus.closest?.('a[href]')
    if (
      anchor instanceof HTMLElement &&
      this.readingContainer?.contains(anchor) &&
      !anchor.closest(`.${EMBED_CARD_CLASS_NAMES.card}`)
    ) {
      const spec = hoverPopupSpecOfAnchor(anchor, { allowExternalHttp: this.hoverExternalEnabled() })
      if (spec) {
        openHoverPopupForKeyboard(anchor, spec)
      }
      return
    }
    // 面板条目（出链条目为 button 可 Tab 聚焦；反链卡片键盘聚焦由条目自身
    // 可聚焦性承担——聚焦即目标）
    if (this.backlinksPanelEl?.contains(focus)) {
      const item = focus.closest?.(`.${BACKLINK_CLASS_NAMES.item}`)
      if (item instanceof HTMLElement && this.backlinksPanelEl.contains(item)) {
        const payload = this.backlinkItemPayloadOf(item)
        if (payload) {
          openHoverPopupForKeyboard(item, {
            target: payload.sourceRelPath,
            sourceStart: 0,
            sourceEnd: 0,
            directFsPath: payload.sourceFsPath,
            openAction: this.backlinkOpenAction(payload),
          })
        }
      }
      return
    }
    if (this.outlinksPanelEl?.contains(focus)) {
      const item = focus.closest?.(`.${OUTLINK_CLASS_NAMES.item}`)
      if (item instanceof HTMLElement && this.outlinksPanelEl.contains(item)) {
        const payload = this.outlinkItemPayloadOf(item)
        if (payload) {
          openHoverPopupForKeyboard(item, {
            target: payload.targetDisplay,
            sourceStart: payload.start,
            sourceEnd: payload.end,
            directFsPath: payload.targetFsPath ?? '',
            ...(payload.anchor ? { directAnchor: payload.anchor } : {}),
            openAction: this.outlinkOpenAction(payload),
          })
        }
      }
    }
  }

  /** #237 上下添加光标（快捷键本地分支与 ui.command 回发共用）：CM6
   *  addCursorAbove/Below 在当前全部 range 上逐行加光标（goal column 由
   *  moveVertically 保持）。边界：仅 Live 正文（阅读只读、暂停面板无输入
   *  语义；P2-10 起焦点在嵌入内部 Live 内时目标为 B——多光标设置按目标
   *  实例快照）；多光标设置关闭时不接管（键位仍由注册表持有）；表格格区
   *  region 存在时不接管——region 状态机与多 range 正交，格区维持单选区
   *  语义（批次 §3 已定边界）。frontmatter 成型头区由 frontmatterEditing
   *  的选区引导兜底（加出的 range 双端落头区即被弹回 body 起点） */
  private runCursorAdd(op: 'addCursorAbove' | 'addCursorBelow'): void {
    const resolved = this.actionTarget()
    const view = resolved?.view
    if (!view || !this.targetEditable(view, resolved?.embed ?? null)) {
      return
    }
    const multicursorOn = resolved?.embed
      ? resolved.embed.multicursorEnabled
      : (this.live?.multicursorEnabled ?? false)
    if (!multicursorOn) {
      return
    }
    if (view.state.field(tableRegionField, false)) {
      return
    }
    if (op === 'addCursorAbove') {
      addCursorAbove(view)
    } else {
      addCursorBelow(view)
    }
  }

  /** Live 光标处预览（键盘命令的 Live 分支）：判定族同悬停路径；锚元素
   *  取目标区间内部的 DOM（domAtPos 归约到 HTMLElement——mark 装饰 span
   *  或所在行元素，仅用于浮层定位与联合域）。命令面板路径下 webview 可
   *  能暂无真实焦点——先确保编辑器聚焦（触发处语义），浮层关闭时焦点
   *  返还编辑器（光标原位恢复）。返回是否命中目标（未命中时调用方落到
   *  聚焦元素检查） */
  private previewLiveLinkAtCursor(): boolean {
    const view = this.view
    if (!view) {
      return false
    }
    const spec = this.liveLinkSpecAt(view, view.state.selection.main.head)
    if (!spec) {
      return false
    }
    if (!view.hasFocus) {
      view.focus()
    }
    const domAt = view.domAtPos(Math.min(spec.sourceStart + 1, view.state.doc.length))
    const el = domAt.node.nodeType === 1 ? (domAt.node as HTMLElement) : domAt.node.parentElement
    if (el instanceof HTMLElement) {
      openHoverPopupForKeyboard(el, spec)
      return true
    }
    return false
  }

  /** 反链条目的快照载荷（悬停与键盘命令共用；条目 DOM 只存相对路径，
   *  绝对路径从最近快照按 source + offset 配对） */
  private backlinkItemPayloadOf(item: HTMLElement): BacklinkItemPayload | undefined {
    const source = item.dataset['vsidianSource']
    const offset = Number(item.dataset['vsidianOffset'])
    if (source === undefined) {
      return undefined
    }
    return this.backlinksSnapshot.items.find(
      (entry) => entry.sourceRelPath === source && entry.start === offset,
    )
  }

  /** 出链条目的快照载荷（悬停与键盘命令共用；按条目 data-vsidian-index
   *  的 start 偏移配对） */
  private outlinkItemPayloadOf(item: HTMLElement): OutlinkItemPayload | undefined {
    const start = Number(item.dataset['vsidianIndex'])
    return this.outlinksSnapshot.items.find((entry) => entry.start === start)
  }

  // ---- 反链面板事件（容器统一委托；DOM 重建不丢监听） ----

  /** 面板内点击分发：工具栏按钮 → 排序菜单项 → 组头 → 卡片（跳转意图） */
  private handleBacklinkPanelClick(event: MouseEvent): void {
    const panel = this.backlinksPanelEl
    if (!panel || !(event.target instanceof Node)) {
      return
    }
    const target = event.target as HTMLElement
    const toolbarButton = target.closest?.(`.${BACKLINK_CLASS_NAMES.toolbarButton}`)
    if (toolbarButton instanceof HTMLElement && panel.contains(toolbarButton)) {
      const action = toolbarButton.dataset['action']
      if (action === 'sort') {
        this.setBacklinkSortMenuOpen(!this.backlinkView.sortMenuOpen)
      } else if (action === 'search') {
        this.setBacklinkSearchOpen(!this.backlinkView.searchOpen)
      } else if (action === 'collapse') {
        this.toggleBacklinkCollapseAll()
      } else if (action === 'context') {
        this.backlinkView.contextLong = !this.backlinkView.contextLong
        this.rerenderBacklinks()
      }
      return
    }
    const menuItem = target.closest?.(`.${BACKLINK_CLASS_NAMES.sortMenuItem}`)
    if (menuItem instanceof HTMLElement && panel.contains(menuItem)) {
      const mode = menuItem.dataset['vsidianSort']
      if (mode !== undefined && isBacklinkSortMode(mode)) {
        this.setBacklinkSortMode(mode)
      }
      return
    }
    const groupHeader = target.closest?.(`.${BACKLINK_CLASS_NAMES.groupHeader}`)
    if (groupHeader instanceof HTMLElement && panel.contains(groupHeader)) {
      const source = groupHeader.dataset['vsidianSource']
      if (source !== undefined) {
        this.toggleBacklinkGroupCollapsed(source)
      }
      return
    }
    // 卡片点击（跳转）：card 与 #197 既有 item 类并挂，委托沿用 item 类
    const item = target.closest?.(`.${BACKLINK_CLASS_NAMES.item}`)
    if (!(item instanceof HTMLElement) || !panel.contains(item)) {
      return
    }
    const source = item.dataset['vsidianSource']
    const offset = Number(item.dataset['vsidianOffset'])
    if (source === undefined || !this.sessionId || !this.docUri) {
      return
    }
    // 条目载荷的 sourceFsPath 由宿主快照携带：跳转意图回源文档绝对路径
    //（条目 DOM 只存相对路径——绝对路径从最近快照 items 取）
    const payload = this.backlinksSnapshot.items.find(
      (entry) => entry.sourceRelPath === source && entry.start === offset,
    )
    if (!payload) {
      return
    }
    this.bridge.postMessage({
      kind: 'backlink.activate',
      sessionId: this.sessionId,
      docUri: this.docUri,
      sourceUri: payload.sourceFsPath,
      offset: payload.start,
    })
  }

  /** 搜索输入即时生效（input 事件直调，无去抖；渲染复用 input 节点不丢焦） */
  private handleBacklinkSearchInput(event: Event): void {    const input = event.target
    if (!(input instanceof HTMLInputElement) || !input.classList.contains(BACKLINK_CLASS_NAMES.searchInput)) {
      return
    }
    this.backlinkView.query = input.value
    this.rerenderBacklinks()
  }

  /** 面板内 Esc：排序菜单打开先关菜单；焦点在搜索框时关闭并清空 */
  private handleBacklinkPanelKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') {
      return
    }
    if (this.backlinkView.sortMenuOpen) {
      event.preventDefault()
      this.setBacklinkSortMenuOpen(false)
      return
    }
    if (
      event.target instanceof HTMLInputElement &&
      event.target.classList.contains(BACKLINK_CLASS_NAMES.searchInput)
    ) {
      event.preventDefault()
      this.setBacklinkSearchOpen(false)
    }
  }

  /** 排序下拉菜单开/关（外点关闭监听随开态挂/卸） */
  private setBacklinkSortMenuOpen(open: boolean): void {
    this.backlinkView.sortMenuOpen = open
    if (open && !this.backlinkSortMenuOutside) {
      const handler = (event: PointerEvent): void => {
        // 菜单打开时面板外/其余区域 pointerdown 都收起；但**排序菜单与
        // 排序按钮豁免**——收起会立即重渲动态区、菜单项在 click 派发前被
        // 摘除，委托的 contains 判定失败导致改选失效（按钮则呈「收起又
        // 被点击翻转重新打开」）；两者的开关语义由各自 click 处理器承担
        const target = event.target as HTMLElement | null
        if (target?.closest?.(
          `.${BACKLINK_CLASS_NAMES.sortMenu}, .${BACKLINK_CLASS_NAMES.toolbarButton}[data-action="sort"]`,
        )) {
          return
        }
        if (this.backlinkView.sortMenuOpen) {
          this.setBacklinkSortMenuOpen(false)
        }
      }
      document.addEventListener('pointerdown', handler, true)
      this.backlinkSortMenuOutside = handler
    } else if (!open && this.backlinkSortMenuOutside) {
      document.removeEventListener('pointerdown', this.backlinkSortMenuOutside, true)
      this.backlinkSortMenuOutside = null
    }
    this.rerenderBacklinks()
  }

  /** 排序选择即生效并记住（会话内存） */
  private setBacklinkSortMode(mode: BacklinkSortMode): void {
    this.backlinkView.sortMode = mode
    this.setBacklinkSortMenuOpen(false)
  }

  /** 搜索框可见性切换：关闭即清空过滤词；展开即聚焦（用户意图是输入） */
  private setBacklinkSearchOpen(open: boolean): void {
    this.backlinkView.searchOpen = open
    if (!open) {
      this.backlinkView.query = ''
    }
    this.rerenderBacklinks()
    if (open && this.backlinksPanelEl) {
      const input = this.backlinksPanelEl.querySelector<HTMLInputElement>(
        `input.${BACKLINK_CLASS_NAMES.searchInput}`,
      )
      input?.focus()
    }
  }

  /** 全部折叠/全部展开二态切换（当前全折 → 全展；否则 → 全折） */
  private toggleBacklinkCollapseAll(): void {
    const collapsed = new Set(this.backlinkView.collapsedGroups)
    if (allGroupsCollapsed(this.backlinksSnapshot.items, collapsed)) {
      collapsed.clear()
    } else {
      for (const key of backlinkGroupKeysOf(this.backlinksSnapshot.items)) {
        collapsed.add(key)
      }
    }
    this.backlinkView.collapsedGroups = collapsed
    this.rerenderBacklinks()
  }

  /** 单组折叠/展开切换（组头点击） */
  private toggleBacklinkGroupCollapsed(source: string): void {
    const collapsed = new Set(this.backlinkView.collapsedGroups)
    if (collapsed.has(source)) {
      collapsed.delete(source)
    } else {
      collapsed.add(source)
    }
    this.backlinkView.collapsedGroups = collapsed
    this.rerenderBacklinks()
  }

  // ---- 出链面板（出链面板批次）----
  // 与大纲/反链面板互斥：同域面板区域（.vsidian-sidebar-panel）同一时刻
  // 只显示一个面板，三选一切换即互斥，侧栏开关不受影响。

  /** 出链按钮点击：active 翻转 + 三面板互斥落 DOM（纯视图状态） */
  private toggleOutlinks(): void {
    this.outlinksActive = !this.outlinksActive
    if (this.outlinksActive) {
      if (this.outlineActive) {
        this.outlineActive = false
        this.applyOutlineDom()
      }
      if (this.backlinksActive) {
        this.backlinksActive = false
        this.applyBacklinksDom()
      }
    }
    this.applyOutlinksDom()
    if (this.outlinksActive && this.docUri && this.sessionId) {
      this.bridge.postMessage({ kind: 'outlinks.get', sessionId: this.sessionId, docUri: this.docUri })
    }
  }

  /** 出链状态落 DOM：侧栏容器的 outlinks-active 类是面板显隐唯一开关 */
  private applyOutlinksDom(): void {
    if (this.sidebarEl) {
      this.sidebarEl.classList.toggle('vsidian-outlinks-active', this.outlinksActive)
    }
    this.outlinksToggleBtn?.setAttribute('aria-expanded', String(this.outlinksActive))
    if (this.outlinksPanelEl) {
      // #221 面板状态翻转（隐藏失效/激活重建条目）都使悬停锚点失效
      closeHoverPopupIfAnchorWithin(this.outlinksPanelEl)
      closeTargetTipIfAnchorWithin(this.outlinksPanelEl)
      if (this.outlinksActive) {
        renderOutlinksState(this.outlinksPanelEl, this.outlinksSnapshot)
      }
    }
    this.persistState()
  }

  /** 出链面板当前是否用户可见 */
  private outlinksVisible(): boolean {
    return this.sidebarOpen && this.outlinksActive
  }

  /** 出链面板条目点击：出站 outlink.activate（断链条目 disabled 不派发；
   *  data-* 双检防御） */
  private handleOutlinkPanelClick(event: MouseEvent): void {
    const panel = this.outlinksPanelEl
    if (!panel || !(event.target instanceof Node)) {
      return
    }
    const item = (event.target as HTMLElement).closest?.(`.${OUTLINK_CLASS_NAMES.item}`)
    if (!(item instanceof HTMLElement) || !panel.contains(item)) {
      return
    }
    const fsPath = item.dataset['vsidianTarget']
    const anchor = item.dataset['vsidianAnchor']
    if (fsPath === undefined || fsPath === '' || !this.sessionId || !this.docUri) {
      return
    }
    this.bridge.postMessage({
      kind: 'outlink.activate',
      sessionId: this.sessionId,
      docUri: this.docUri,
      targetUri: fsPath,
      anchor: anchor ?? '',
    })
  }

  /** 大纲按钮点击：active 翻转后落 DOM；再激活时校准数据（隐藏期间无调度） */
  private toggleOutline(): void {
    this.outlineActive = !this.outlineActive
    // #197 与反链面板互斥；出链面板批次扩为三面板互斥（开大纲收其余）
    if (this.outlineActive) {
      if (this.backlinksActive) {
        this.backlinksActive = false
        this.applyBacklinksDom()
      }
      if (this.outlinksActive) {
        this.outlinksActive = false
        this.applyOutlinksDom()
      }
    }
    this.applyOutlineDom()
    if (this.outlineActive) {
      this.outlineEnsureFresh()
    } else {
      this.cancelOutlineRefresh()
      this.cancelOutlineHighlightUpdate()
      // #69：面板关闭时浮层（菜单）与重命名编辑态随之退出
      this.closeOutlineMenu()
      this.cancelOutlineRename()
      // #70：拖拽会话随之退出（面板不可见，落点失去意义）
      this.cancelOutlineDrag()
    }
  }

  /** 大纲状态落 DOM：侧栏容器的 outline-active 类是面板显隐唯一开关
   *  （CSS 控制；与 #53 的 sidebar-open 类同模式），按钮 aria-expanded 同步 */
  private applyOutlineDom(): void {
    if (this.sidebarEl) {
      this.sidebarEl.classList.toggle('vsidian-outline-active', this.outlineActive)
    }
    this.outlineToggleBtn?.setAttribute('aria-expanded', String(this.outlineActive))
    this.persistState()
  }

  /** 大纲面板当前是否用户可见（可见才值得去抖重算；不可见时数据由
   *  view.state 回报前的即时校准兜底） */
  private outlineVisible(): boolean {
    return this.sidebarOpen && this.outlineActive
  }

  /** 取消未决的去抖回调：面板已不可见（侧栏收起或面板关闭）时，迟到触发
   *  只会在隐藏面板上做无谓解析与 DOM 重建——重开路径有校准兜底 */
  private cancelOutlineRefresh(): void {
    if (this.outlineTimer !== undefined) {
      clearTimeout(this.outlineTimer)
      this.outlineTimer = undefined
    }
  }

  /** 文档变化后的去抖刷新调度：仅可见时开启，避免不可见面板伴随每次按键
   *  解析；连续输入只在停顿后解析一次（尾随去抖：定时器随每次调用重置） */
  private scheduleOutlineRefresh(): void {
    if (this.outlineTimer !== undefined) {
      clearTimeout(this.outlineTimer)
    }
    this.outlineTimer = setTimeout(() => {
      this.outlineTimer = undefined
      this.outlineEnsureFresh()
    }, 250)
  }

  /**
   * 大纲新鲜度校准（与 #14 查找的 findEnsureFresh 同模式）：Text 引用比较
   * 判过期，过期则解析。解析复用 liveDecorationsField 维护的增量解析树
   * （TreeFragment.applyChanges + addTree 随每笔文档事务增量更新，见
   * liveDecorations.ts）：该树与当前 state.doc 同步，大纲直接取用，不在
   * 去抖定时器里再做一次全量 parse（10 万行文档全量解析约 256ms，是
   * 主线程卡顿级；增量树的语义等价由单测对照钉住）。field 恒随
   * livePreviewDecorations 装配（extensions 无条件注册），取不到时由
   * extractOutline 内部回退全量解析（防御路径）。序列（级别 + 文字）
   * 未变时只更新数据（行号），不重建条目 DOM——正文编辑不触碰大纲 DOM。
   * #67 序列变化重建时展开集合经 diff 迁移（重命名不扰动、删除丢键、
   * 新增/升格父自动展开——刷新存活，见 outlineCollapse 模块头）。
   */
  private outlineEnsureFresh(): void {
    const view = this.view
    const doc = view?.state.doc
    if (!view || !doc || this.outlineDoc === doc) {
      return
    }
    const firstRender = this.outlineDoc === null // 从未渲染：首场必落 DOM（含空态占位）
    this.outlineDoc = doc
    const tree = view.state.field(liveDecorationsField, false)?.tree
    const items = extractOutline(doc, tree)
    const changed = firstRender || !outlineItemsEqual(items, this.outlineItems)
    const prevItems = this.outlineItems
    const prevExpanded = this.outlineExpanded
    this.outlineItems = items
    this.outlineFacts = outlineCollapseFacts(items)
    if (firstRender || prevItems.length === 0) {
      // 首场或旧序列为空（空文档、或真实宿主装载期先在初始空 doc 上跑过
      // 首场——重载恢复实测路径）：没有可迁移的折叠状态，按档位精确集
      // 初始化（手动折叠是会话态，重载后从这里重置）
      this.outlineExpanded = outlineExpandSetForLevel(items, this.outlineExpandLevel)
      // #68：同场景没有可迁移的搜索快照，快照与档位精确集对齐（清空
      // 回放与档位指示一致）
      if (this.outlineExpandedBeforeSearch !== null) {
        this.outlineExpandedBeforeSearch = outlineExpandSetForLevel(items, this.outlineExpandLevel)
      }
    } else {
      // fallbackLevel 传当前档位（review-loops C2 熔断回退贴近用户意图）
      this.outlineExpanded = migrateOutlineExpanded(
        prevItems, items, prevExpanded, this.outlineExpandLevel,
      )
      // #68：搜索展开快照随编辑同款迁移（重命名/增删不扰动清空回放的
      // 目标视图——快照与展开集是同一坐标系的两个视图）
      if (this.outlineExpandedBeforeSearch !== null) {
        this.outlineExpandedBeforeSearch = migrateOutlineExpanded(
          prevItems,
          items,
          this.outlineExpandedBeforeSearch,
          this.outlineExpandLevel,
        )
      }
    }
    if (changed && this.outlinePanelEl) {
      // #69：条目 DOM 重建使菜单锚点与重命名编辑态过期——先关闭再重建
      // （重命名提交路径已在 finishOutlineRename 先清状态，此处无重入）
      this.closeOutlineMenu()
      // review-loops 第 3 轮：编辑态被重建丢弃要留痕（与提交路径同口径）
      // ——输入框随重建消失且零写回，无诊断时用户无从判断为何没生效
      if (this.outlineRenameIndex !== null) {
        console.warn('[vsidian] 大纲重命名放弃：文档外部改写，重命名编辑态随条目重建退出')
      }
      this.outlineRenameIndex = null
      this.outlineRenameDoc = null
      // #70：条目 DOM 重建使拖拽锚点与落点指示过期——取消拖拽（零写回；
      // 写回路径自身即时 ensureFresh 时序列未变不进此分支，拖拽不被误杀）
      this.cancelOutlineDrag()
      // #68 搜索态：重建后按当前词条重算过滤（新序列的命中链并入展开集）
      if (this.outlineSearchState !== null) {
        this.applyOutlineSearch()
      } else {
        renderOutlineItems(this.outlinePanelEl, items, this.outlineFacts.hasChildren)
        this.applyOutlineCollapseDom()
      }
    } else if (this.outlineExpanded !== prevExpanded) {
      // 序列未变但展开集合被迁移修正（safeFilter 等）：状态类跟随
      this.applyOutlineCollapseDom()
    }
    // #66：文档变化后行号随编辑漂移（序列未变也可能），统一重算并重施加
    // 高亮——重建路径丢了类、未重建路径行号变了也要重定位控制域；
    // #67：重算含 only-expand（located 被折叠遮蔽时展开祖先链）
    this.updateOutlineLocated()
  }

  // ---- 大纲折叠状态机落 DOM（#67）----
  // 状态载体是 outlineExpanded（父节点索引集合）+ outlineExpandLevel（档位，
  // 持久化）；推导纯函数见 outlineCollapse.ts。DOM 上三类状态类：hidden
  // （折叠遮蔽，display:none）、collapsed（折叠中的父节点，箭头旋转）、
  // located（高亮，施加在可见代表上——被遮蔽时为第一个可见祖先）。

  /** 滑块选档：档位记录 + 展开集整体替换为档位精确集（手动微调不保留），
   *  圆点 active 类与可访问状态同步，高亮代表可能变化（重施加）。
   *  #68 搜索态：档位精确集作为新基准（清空回放的快照同步替换——回放
   *  后与档位指示一致），展开集再并入命中祖先链（命中路径保持可见） */
  private setOutlineExpandLevel(level: number): void {
    const next = Math.max(0, Math.min(5, Math.floor(level)))
    this.outlineExpandLevel = next
    const base = outlineExpandSetForLevel(this.outlineItems, next)
    const search = this.outlineSearchState
    if (search !== null) {
      if (this.outlineExpandedBeforeSearch !== null) {
        this.outlineExpandedBeforeSearch = base
      }
      this.outlineExpanded = new Set(
        outlineSearchExpandSet(this.outlineItems, base, search.matchedIndices),
      )
    } else {
      this.outlineExpanded = base
    }
    if (this.outlineSlider) {
      applyOutlineSliderState(this.outlineSlider, next)
    }
    this.applyOutlineCollapseDom()
    this.applyOutlineHighlight()
    this.persistState()
  }

  /** 手动折叠/展开单条（箭头点击）：非父节点忽略；会话态不持久化 */
  private toggleOutlineItemCollapsed(index: number): void {
    if (this.outlineFacts.hasChildren[index] !== true) {
      return
    }
    const next = new Set(this.outlineExpanded)
    if (next.has(index)) {
      next.delete(index)
    } else {
      next.add(index)
    }
    this.outlineExpanded = next
    this.applyOutlineCollapseDom()
    this.applyOutlineHighlight()
  }

  /** 折叠可见性落 DOM：hidden/collapsed 类与箭头 aria-expanded（条目 DOM
   *  与 outlineItems 同序的不变式下按序 toggle；toggle 幂等）。
   *  #68 搜索态下 hidden = 折叠遮蔽 ∨ 搜索过滤（组合可见口径，同一
   *  display:none 类承载），无匹配时挂「无匹配」占位 */
  private applyOutlineCollapseDom(): void {
    const panel = this.outlinePanelEl
    if (!panel) {
      return
    }
    const hidden = outlineHiddenFlags(this.outlineItems, this.outlineExpanded)
    const search = this.outlineSearchState
    const nodes = panel.querySelectorAll<HTMLElement>(`.${OUTLINE_CLASS_NAMES.item}`)
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i]!
      const isParent = this.outlineFacts.hasChildren[i] === true
      const collapsed = isParent && !this.outlineExpanded.has(i)
      el.classList.toggle(OUTLINE_CLASS_NAMES.collapsed, collapsed)
      el.classList.toggle(
        OUTLINE_CLASS_NAMES.hidden,
        hidden[i] === true || (search !== null && !search.kept[i]),
      )
      const chevron = el.querySelector<HTMLButtonElement>(`.${OUTLINE_CLASS_NAMES.chevron}`)
      if (chevron) {
        chevron.setAttribute('aria-expanded', String(!collapsed))
      }
    }
    // 「无匹配」占位：有词条但零命中（空序列的「无标题」占位由
    // renderOutlineItems 承担，两者互斥）；renderOutlineItems 重建会清掉
    // 占位元素，此处在每条折叠落 DOM 路径上幂等补挂
    const nomatch = search !== null && search.noMatch && this.outlineItems.length > 0
    let placeholder = panel.querySelector<HTMLElement>(`.${OUTLINE_CLASS_NAMES.nomatch}`)
    if (nomatch && !placeholder) {
      placeholder = document.createElement('div')
      placeholder.className = OUTLINE_CLASS_NAMES.nomatch
      bindLocale(placeholder, 'text', 'outline.noMatch')
      panel.appendChild(placeholder)
    } else if (!nomatch && placeholder) {
      placeholder.remove()
    }
  }

  /** only-expand（滚动动态展开/跳转落位共用）：目标被折叠遮蔽时并入其
   *  祖先链（只增不减，其他折叠区不动），展开集合变化才重施加状态类 */
  private revealOutlineIndex(index: number): void {
    const next = outlineExpandAncestors(this.outlineItems, this.outlineExpanded, index)
    if (next !== this.outlineExpanded) {
      this.outlineExpanded = next
      this.applyOutlineCollapseDom()
    }
  }

  // ---- 大纲右键菜单与重命名（#69）----
  // 菜单是 webview 自绘浮层（挂侧栏内 absolute，不触 CM6）：结构命令消费
  // 折叠状态机（纯视图）；复制经宿主剪贴板消息桥（clipboard.write）；调级/
  // 重命名/删除是写操作——文本变换由 outlineSection 产出 SerChange，一次
  // CM6 事务 dispatch（单笔 edit.request = 宿主撤销一次），写后即时校准
  // 大纲（不等 250ms 去抖，票面「写回后大纲与正文即时一致」）。

  /** 打开菜单（先关旧菜单与重命名态）。定位：挂载后量尺寸，侧栏坐标系
   *  内 clamp + 点击点落在目标条目内时让位到条目下方（不遮挡目标） */
  private openOutlineMenu(index: number, clientX: number, clientY: number): void {
    const sidebar = this.sidebarEl
    const panel = this.outlinePanelEl
    const item = panel?.querySelectorAll<HTMLElement>(`.${OUTLINE_CLASS_NAMES.item}`)[index]
    if (!sidebar || !panel || !item || !this.view) {
      return
    }
    // review-loops B4：拖拽进行中右键可达此（contextmenu 委托不查拖拽态），
    // 先取消拖拽防两会话并存的指示混乱（数据由锚点防御兜底）
    this.cancelOutlineDrag()
    this.closeOutlineMenu()
    this.closeContextMenu() // 与正文统一菜单互斥（一次只有一个右键菜单）
    this.cancelOutlineRename()
    const hasChildren = this.outlineFacts.hasChildren[index] === true
    // #183 内核装配：描述符模型 + 类名映射（既有 vsidian-outline-menu* 类，
    // 行为与视觉不变）；挂载后装配期翻转子菜单（大纲右置不再溢出屏幕）
    const menu = buildOutlineMenuDom(hasChildren, (command) => {
      this.runOutlineMenuCommand(command)
    })
    this.outlineMenuEl = menu
    this.outlineMenuIndex = index
    this.outlineMenuDoc = this.view.state.doc
    sidebar.appendChild(menu)
    // 定位（jsdom 无布局时退化为左上角；真宿主见 outlineMenuPosition 契约）
    const bounds = sidebar.getBoundingClientRect()
    const targetRect = item.getBoundingClientRect()
    const size = { w: menu.offsetWidth || 200, h: menu.offsetHeight || 260 }
    const pos = outlineMenuPosition(
      { x: clientX, y: clientY },
      size,
      { left: bounds.left, top: bounds.top, width: bounds.width || 280, height: bounds.height || 560 },
      { top: targetRect.top, bottom: targetRect.bottom },
    )
    menu.style.left = `${Math.max(0, pos.left - bounds.left)}px`
    menu.style.top = `${Math.max(0, pos.top - bounds.top)}px`
    // #183 子菜单装配期翻转：右缘放不下翻左（宿主坐标系是视口系——
    // getBoundingClientRect 与窗口宽同系）
    applySubmenuFlip(menu, window.innerWidth || 1200, {
      submenu: OUTLINE_MENU_CLASS_NAMES.submenu,
    })
    // 键盘导航起点：聚焦菜单容器（方向键导航经内核装配自动继承）；夺焦前
    // 记录先前焦点宿主（closeOutlineMenu 还焦——见 menuPrevFocus 注释）
    this.captureMenuFocus()
    focusMenuDom(menu)
    // 关闭通道：菜单外 pointerdown（capture，含其他面板区域）与 Esc
    this.outlineMenuDismissPointer = (e) => {
      if (menu.contains(e.target as Node)) {
        return
      }
      this.closeOutlineMenu()
    }
    this.outlineMenuDismissKey = (e) => {
      if (e.key === 'Escape') {
        this.closeOutlineMenu()
      }
    }
    document.addEventListener('pointerdown', this.outlineMenuDismissPointer, true)
    document.addEventListener('keydown', this.outlineMenuDismissKey, true)
  }

  /** 关闭菜单（幂等；摘除 document 关闭监听；焦点在菜单内时还回编辑器） */
  private closeOutlineMenu(): void {
    if (this.outlineMenuDismissPointer) {
      document.removeEventListener('pointerdown', this.outlineMenuDismissPointer, true)
      this.outlineMenuDismissPointer = undefined
    }
    if (this.outlineMenuDismissKey) {
      document.removeEventListener('keydown', this.outlineMenuDismissKey, true)
      this.outlineMenuDismissKey = undefined
    }
    // 键盘导航还焦：打开菜单聚焦过容器（focusMenuDom），关闭时若焦点仍
    // 在菜单内，还回打开前的焦点宿主（未记录/已移除时回落编辑器）
    if (this.outlineMenuEl && this.outlineMenuEl.contains(document.activeElement)) {
      this.restoreMenuFocus()
    }
    this.outlineMenuEl?.remove()
    this.outlineMenuEl = undefined
    this.outlineMenuIndex = null
    this.outlineMenuDoc = null
  }

  /** 菜单命令分派：结构命令/复制/调级/删除/重命名（见模块头） */
  private runOutlineMenuCommand(command: OutlineMenuCommand): void {
    const index = this.outlineMenuIndex
    const view = this.view
    if (index === null || index >= this.outlineItems.length || !view) {
      this.closeOutlineMenu()
      return
    }
    // 锚点过期防御：菜单打开期间文档被外部变更改写（ensureFresh 会关菜单，
    // 此处是竞态兜底）——坐标与行号失效，放弃执行
    if (this.outlineMenuDoc !== view.state.doc) {
      this.closeOutlineMenu()
      return
    }
    if (command === 'rename') {
      const target = index
      this.closeOutlineMenu()
      this.startOutlineRename(target)
      return
    }
    this.closeOutlineMenu()
    const doc = view.state.doc
    if (command === 'expandRecursively' || command === 'collapseSiblings' || command === 'expandSiblings') {
      const next = outlineStructuralExpand(command, this.outlineItems, this.outlineExpanded, index)
      if (next !== this.outlineExpanded) {
        this.outlineExpanded = next
        this.applyOutlineCollapseDom()
        this.applyOutlineHighlight()
      }
      return
    }
    if (command === 'copyHeading' || command === 'copySiblings' || command === 'copyChildren' || command === 'copySection') {
      const kind = command === 'copyHeading' ? 'heading'
        : command === 'copySiblings' ? 'siblings'
          : command === 'copyChildren' ? 'children' : 'section'
      const text = outlineCopyText(kind, doc, this.outlineItems, index)
      if (text !== null) {
        this.bridge.postMessage({ kind: 'clipboard.write', text })
      }
      return
    }
    if (command === 'copyLink') {
      // `[[笔记名#标题]]` 的拼接在宿主侧（docUri 取笔记名）。标题取条目原文
      // （OutlineItem.text，含行内标记）——宿主 findHeadingOffset 按标题行
      // 字面文本比较，两侧口径同源才能定位回原标题；剥标记可见文本只用于
      // 「复制标题」（copyHeading，纯文本场景）
      this.bridge.postMessage({
        kind: 'clipboard.write',
        linkHeading: { docUri: this.docUri, heading: this.outlineItems[index]!.text },
      })
      return
    }
    if (command === 'levelUp' || command === 'levelUpRecursive' || command === 'levelDown' || command === 'levelDownRecursive') {
      const delta: -1 | 1 = command.startsWith('levelUp') ? 1 : -1
      const recursive = command.endsWith('Recursive')
      this.applyOutlineEdits(outlineLevelChanges(doc, this.outlineItems, index, delta, recursive))
      return
    }
    if (command === 'delete') {
      const change = outlineDeleteChange(doc, this.outlineItems, index)
      this.applyOutlineEdits(change ? [change] : null)
    }
  }

  /** 写操作落 CM6（单事务 = 单笔 edit.request = 撤销一次）；写后即时校准
   *  大纲（折叠状态经 #67 迁移机制存活）。null/空变更静默忽略（钳制等） */
  private applyOutlineEdits(changes: ReadonlyArray<{ offset: number; length: number; text: string }> | null): void {
    const view = this.view
    if (!view || !changes || changes.length === 0) {
      return
    }
    // review-loops C3：「升序互不重叠」是全部大纲写计划生成端的约定，但
    // CM6 ChangeSet 对乱序/重叠段不报错而是 flush 合成（静默错位写入权威
    // 文档）——运行时断言兜底：违例放弃并留诊断（与 confirmSentTxn 的
    // 显式排序同根约束）。判据抽成纯函数以便直接单测（review-loops 第 2 轮）
    if (!outlineChangesOrdered(changes)) {
      console.error(
        `[vsidian] 大纲写回变更段违例（升序互不重叠）：${JSON.stringify(changes)}，放弃写回`,
      )
      // 放弃路径也要回到展示态：调用方（重命名提交）已清编辑态状态，
      // 条目 DOM 里的 input 若不重建会卡在编辑态（review-loops 第 2 轮）
      this.rebuildOutlineItemsDom()
      return
    }
    try {
      view.dispatch({
        changes: changes.map((c) => ({ from: c.offset, to: c.offset + c.length, insert: c.text })),
      })
    } catch (error) {
      // review-loops C6：越界坐标等异常若逃逸只在监听器里静默吞掉——
      // 留诊断线索（大纲与正文不同步时可定位）
      console.error('[vsidian] 大纲写回 dispatch 失败（变更段与当前文档不匹配）', error)
      this.rebuildOutlineItemsDom()
      return
    }
    this.outlineEnsureFresh()
  }

  /** 条目行内重命名编辑态：条目内容区替换为 input（值 = 原文 text——行内
   *  标记是资产，编辑原文不剥标记）。Enter 提交 / Esc 取消 / 失焦提交；
   *  input 上的 click 与 keydown 不外冒（不触发跳转与正文快捷键） */
  private startOutlineRename(index: number): void {
    const panel = this.outlinePanelEl
    const item = this.outlineItems[index]
    const el = panel?.querySelectorAll<HTMLElement>(`.${OUTLINE_CLASS_NAMES.item}`)[index]
    if (!panel || !item || !el) {
      return
    }
    this.cancelOutlineRename()
    this.outlineRenameIndex = index
    this.outlineRenameDoc = this.view?.state.doc ?? null
    const input = document.createElement('input')
    input.type = 'text'
    input.className = OUTLINE_MENU_CLASS_NAMES.renameInput
    input.value = item.text
    input.setAttribute('aria-label', t('outline.renameHeading'))
    input.addEventListener('keydown', (event) => {
      event.stopPropagation()
      if (event.key === 'Enter') {
        this.finishOutlineRename(true)
      } else if (event.key === 'Escape') {
        this.finishOutlineRename(false)
      }
    })
    input.addEventListener('click', (event) => event.stopPropagation())
    input.addEventListener('pointerdown', (event) => event.stopPropagation())
    input.addEventListener('contextmenu', (event) => event.stopPropagation())
    input.addEventListener('focusout', () => this.finishOutlineRename(true))
    // 内容区替换：保留 chevron/spacer（文字对齐锚），其余（含文本节点）移除
    const keep = el.querySelector(`.${OUTLINE_CLASS_NAMES.chevron}, .${OUTLINE_CLASS_NAMES.chevronSpacer}`)
    el.replaceChildren(...(keep ? [keep] : []), input)
    input.focus()
    input.select()
  }

  /** 结束重命名编辑态：commit=true 整标题行替换写回（Setext → ATX 单行）；
   *  false 取消（零写回）。状态先清空（focusout/Enter 双路径防重入） */
  private finishOutlineRename(commit: boolean): void {
    const index = this.outlineRenameIndex
    if (index === null) {
      return
    }
    this.outlineRenameIndex = null
    const input = this.outlinePanelEl?.querySelector<HTMLInputElement>(
      `.${OUTLINE_MENU_CLASS_NAMES.renameInput}`,
    )
    const newText = input?.value ?? ''
    const item = this.outlineItems[index]
    const view = this.view
    // 锚点防御（review-loops C1，与菜单/拖拽同口径）：重命名打开期间文档
    // 被改写（同文件多面板/git checkout 等）则行号过期，提交会改写错误
    // 行——放弃提交视作取消（零写回）。第 2 轮：**内容等价**（doc.eq）的
    // 全文重置（宿主 resync/init 重发同一文本）行号并不过期，不得误放弃
    const docAnchored = view !== undefined && this.outlineRenameDoc !== null &&
      (view.state.doc === this.outlineRenameDoc || view.state.doc.eq(this.outlineRenameDoc))
    // 放弃要留痕：输入被丢弃且零写回，无诊断时用户无从判断为何没生效
    if (commit && item && newText !== item.text && !docAnchored) {
      console.warn('[vsidian] 大纲重命名放弃：编辑期间文档已被改写（行号锚点过期）')
    }
    this.outlineRenameDoc = null
    if (commit && input && item && view && newText !== item.text && docAnchored) {
      const change = outlineRenameChange(view.state.doc, this.outlineItems, index, newText)
      if (change) {
        this.applyOutlineEdits([change]) // 内部 ensureFresh 重建条目（input 随之消失）
        return
      }
    }
    this.rebuildOutlineItemsDom()
  }

  /** 取消重命名编辑态（外部交互转移焦点时的兜底；不写回） */
  private cancelOutlineRename(): void {
    if (this.outlineRenameIndex === null) {
      return
    }
    this.finishOutlineRename(false)
  }

  /** 重建条目 DOM（重命名取消后恢复展示态；与 ensureFresh 的重建同构）。
   *  review-loops 第 2 轮：重建即取消拖拽会话——条目 DOM 被替换后 dragging
   *  提示与 hintEl 都指向脱挂节点，会话继续存活会留下「指示消失但拖拽仍在」
   *  的失同步态（与 ensureFresh changed 分支同口径）
   *  review-loops 第 3 轮：搜索态下重建必须重放命中高亮——命中区间取自
   *  outlineSearchState 缓存（与条目序列同一次计算、同长对齐），只是把
   *  同一次渲染补上 hits 参数：不追加第二次重建，也不走 applyOutlineSearch
   *  （那里会重算过滤并再渲染一遍），无递归风险 */
  private rebuildOutlineItemsDom(): void {
    const panel = this.outlinePanelEl
    if (!panel) {
      return
    }
    this.cancelOutlineDrag()
    renderOutlineItems(panel, this.outlineItems, this.outlineFacts.hasChildren,
      this.outlineSearchState?.ranges)
    this.applyOutlineCollapseDom()
    this.applyOutlineHighlight()
  }

  // ---- 正文统一右键菜单（#183 Live 全域接管；blockMenu #162 已退役并入）----
  // 内核与描述符表是纯函数（shared/contextMenu.ts）；DOM 装配在
  // contextMenuDom.ts。全域接管：空行、普通文本、选区、表格行、围栏代码
  // 内、图形块上均弹统一菜单；frontmatter 头区与阅读态不接管（透传原生
  // 菜单）。安全降级矩阵由注册表谓词承载（zone 判定 → 结构敏感区写操作
  // 置灰）；剪贴板四项：剪切/复制/粘贴经宿主剪贴板桥（clipboard.write /
  // clipboard.read 消息），全选为 CM6 纯选区事务。快捷键与命令面板入口经
  // 宿主 blockLink.copy 消息汇到同一 runBlockCopyAtCursor。

  /** contentDOM contextmenu：坐标 → posAtCoords → 区域与块目标判定；
   *  接管位（全域，头区除外）preventDefault 后弹菜单。P2-10 起嵌入内部
   *  Live 编辑器的 contextmenu 经 onEmbedLiveContextMenu 同一打开路径（目
   *  标视图 = 嵌入实例） */
  private onContentContextMenu(event: MouseEvent): void {
    const view = this.view
    if (!view || this.viewMode !== 'live') {
      return
    }
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
    if (pos === null) {
      return
    }
    const snapshot = this.contextSnapshotAt(view, pos)
    if (snapshot === null) {
      return // 不接管位（frontmatter 头区）：放行浏览器原生菜单
    }
    event.preventDefault()
    this.openContextMenu(snapshot, event.clientX, event.clientY, view)
  }

  /** P2-10（#287）嵌入内部 Live 的 contextmenu 入口（embedCard 经 context
   *  转发）：区域判定按嵌入实例的文档坐标，菜单目标视图捕获为该实例——
   *  执行前重验（runContextMenuCommand），焦点变化/实例释放不落 A */
  private onEmbedLiveContextMenu(_inner: string, view: EditorView, event: MouseEvent): void {
    // precise=false：估计定位——嵌入编辑器在卡片限高滚动容器内，CM6 视口
    // 测量不感知外部裁剪，精确模式对可视但越其视口的行返回 null；右键
    // 菜单只需行级 zone/块目标，估计位置语义充分（主正文路径不变）
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }, false)
    if (pos === null) {
      return
    }
    const snapshot = this.contextSnapshotAt(view, pos)
    if (snapshot === null) {
      return // 不接管位（成型头区）：放行浏览器原生菜单
    }
    event.preventDefault()
    this.openContextMenu(snapshot, event.clientX, event.clientY, view)
  }

  /** doc 偏移 → 打开菜单的判定快照（zone + 块目标 + 选区态 + 行段落结构；
   *  不接管位返回 null）。头区行索引在此推导：frontmatterRange 的字符区间
   *  换算为结束行索引。行结构只在 normal 区解析（#184 勾选接线）——表格/
   *  围栏/图形区整簇置灰且围栏内 `# 行` 是代码内容非结构，采集中性态
   *  不点亮任何勾选。P2-10：view 参数化（嵌入实例与主正文同判定族） */
  private contextSnapshotAt(view: EditorView, pos: number): MenuContextSnapshot | null {
    if (pos < 0 || pos > view.state.doc.length) {
      return null
    }
    const text = view.state.doc.toString()
    const lines = text.split('\n')
    const fm = frontmatterRange(text.slice(0, FM_SCAN_LIMIT))
    const fmEndLine = fm === null ? -1 : text.slice(0, fm.end).split('\n').length - 1
    const lineIndex = view.state.doc.lineAt(pos).number - 1
    const zone = contextMenuZoneAt(lines, lineIndex, fmEndLine)
    if (zone === null) {
      return null // 头区不接管：成型卡片只读；降级源码行写 ^id 只会破坏 YAML
    }
    return {
      zone,
      hasSelection: !view.state.selection.main.empty,
      blockTarget: contextMenuBlockTargetAt(lines, lineIndex, fmEndLine),
      line: zone === 'normal' ? menuLineStructureOf(lines[lineIndex] ?? '') : PLAIN_MENU_LINE,
    }
  }

  /** 打开统一菜单（先关旧菜单；与大纲菜单互斥）。定位：挂载后量尺寸，
   *  视口系 fixed clamp + 底部上翻（jsdom 无布局时退化为点击点）；子菜单
   *  右缘放不下装配期翻左（applySubmenuFlip）。P2-10：targetView 为菜单
   *  命令的目标（缺省主正文）；打开时捕获，执行前重验 */
  private openContextMenu(snapshot: MenuContextSnapshot, clientX: number, clientY: number,
    targetView?: EditorView): void {
    const view = targetView ?? this.view
    if (!view) {
      return
    }
    this.closeContextMenu()
    this.closeOutlineMenu()
    const hints = contextMenuKeybindingHints(this.keybindingOverrides)
    const menu = buildMenuDom(buildContextMenuModel(snapshot, hints), {
      onCommand: (command) => this.runContextMenuCommand(command),
    })
    this.contextMenuEl = menu
    this.contextMenuView = view
    this.contextMenuTarget = snapshot.blockTarget
    this.contextMenuDoc = view.state.doc
    document.body.appendChild(menu)
    const size = { w: menu.offsetWidth || 220, h: menu.offsetHeight || 260 }
    const pos = menuViewportPosition(
      { x: clientX, y: clientY },
      size,
      { width: window.innerWidth || 1200, height: window.innerHeight || 800 },
    )
    menu.style.left = `${Math.max(0, pos.left)}px`
    menu.style.top = `${Math.max(0, pos.top)}px`
    applySubmenuFlip(menu, window.innerWidth || 1200)
    // 键盘导航起点：聚焦菜单容器（打开菜单接管方向键；关闭时还焦先前
    // 宿主——见 menuPrevFocus 注释）
    this.captureMenuFocus()
    focusMenuDom(menu)
    // 关闭通道：菜单外 pointerdown（capture）与 Esc（与大纲菜单同模式）
    this.contextMenuDismissPointer = (e) => {
      if (menu.contains(e.target as Node)) {
        return
      }
      this.closeContextMenu()
    }
    this.contextMenuDismissKey = (e) => {
      if (e.key === 'Escape') {
        this.closeContextMenu()
      }
    }
    document.addEventListener('pointerdown', this.contextMenuDismissPointer, true)
    document.addEventListener('keydown', this.contextMenuDismissKey, true)
  }

  /** 关闭菜单（幂等；摘除 document 关闭监听；焦点在菜单内时还回编辑器） */
  private closeContextMenu(): void {
    if (this.contextMenuDismissPointer) {
      document.removeEventListener('pointerdown', this.contextMenuDismissPointer, true)
      this.contextMenuDismissPointer = undefined
    }
    if (this.contextMenuDismissKey) {
      document.removeEventListener('keydown', this.contextMenuDismissKey, true)
      this.contextMenuDismissKey = undefined
    }
    // 键盘导航还焦：打开菜单聚焦过容器（focusMenuDom），关闭时若焦点仍
    // 在菜单内，还回打开前的焦点宿主（未记录/已移除时回落编辑器）
    if (this.contextMenuEl && this.contextMenuEl.contains(document.activeElement)) {
      this.restoreMenuFocus()
    }
    this.contextMenuEl?.remove()
    this.contextMenuEl = undefined
    this.contextMenuView = undefined
    this.contextMenuTarget = null
    this.contextMenuDoc = null
  }

  /** 菜单夺焦前记录焦点宿主（body 不算——照 frontmatterPopover 先例；
   *  两类菜单互斥打开，共用 menuPrevFocus 一个槽位） */
  private captureMenuFocus(): void {
    this.menuPrevFocus =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : null
  }

  /** 菜单还焦：还回打开前的焦点宿主（已移出文档时回落编辑器）。仅在焦点
   *  仍在菜单内时被调用（关闭路径已有 contains 判定）。P2-10：回落目标 =
   *  菜单捕获的目标视图（嵌入打开则回嵌入选区，不误落主正文） */
  private restoreMenuFocus(): void {
    const prev = this.menuPrevFocus
    this.menuPrevFocus = null
    if (prev && prev.isConnected) {
      prev.focus()
      return
    }
    ;(this.contextMenuView ?? this.view)?.focus()
  }

  /** 菜单命令分派：锚点过期防御后按命令执行——先查运行期 handler（覆写
   *  语义「可换 handler」：register/override 带 handler 即替换执行体），未
   *  命中再走内置白名单：格式操作复用快速操作条同一执行路径
   *  （runFormatOperation）；块链接两项沿用 blockMenu 迁入实现；剪贴板
   *  四项见模块头。无 handler 非白名单命令 console.warn（不再静默）。
   *  P2-10：执行目标是菜单打开时捕获的 contextMenuView（主正文或嵌入
   *  实例），执行前重验——嵌入实例已释放（离屏/切 Reading）或文档换版
   *  即放弃执行，不落回主编辑器 */
  private runContextMenuCommand(command: string): void {
    const target = this.contextMenuTarget
    const menuView = this.contextMenuView
    if (!menuView) {
      this.closeContextMenu()
      return
    }
    // 重验一：嵌入目标实例须仍在场（主正文视图 = this.view 恒在场）
    const embedTarget = menuView === this.view ? null : this.embedCards?.liveViewEntry(menuView) ?? null
    if (menuView !== this.view && !embedTarget) {
      this.closeContextMenu()
      return
    }
    // 重验二（锚点过期防御，与大纲菜单同口径）：菜单打开期间文档被外部
    // 变更改写则块行号失效，放弃执行（CM6 Text 不可变——外部变更必换实例）
    if (this.contextMenuDoc !== menuView.state.doc) {
      this.closeContextMenu()
      return
    }
    const view = menuView
    const embed = embedTarget?.instance ?? null
    this.closeContextMenu()
    // 运行期 handler 优先（含覆写内置 id——替换内置执行体）
    const handler = contextMenuHandlerForCommand(command)
    if (handler !== undefined) {
      handler()
      return
    }
    if (command === 'copyHeadingLink') {
      if (target !== null && target.heading !== null) {
        this.copyHeadingLink(target.heading.text, embedTarget?.docUri ?? this.docUri)
      }
      return
    }
    if (command === 'copyBlockLink') {
      if (target !== null) {
        this.copyBlockLinkOf(target, view, embedTarget?.docUri ?? this.docUri)
      }
      return
    }
    if (command === 'cut' || command === 'copy') {
      this.copySelectionToClipboard(command === 'cut', { view, embed })
      return
    }
    if (command === 'paste' || command === 'pastePlain') {
      this.requestClipboardPaste({ view, embed, plain: command === 'pastePlain' })
      return
    }
    if (command === 'selectAll') {
      // 全选：CM6 纯选区事务（零写回）
      try {
        view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } })
      } catch (error) {
        console.error('[vsidian] 全选失败（选区坐标与当前文档不匹配）', error)
      }
      view.focus()
      return
    }
    if (command === 'insertTable') {
      // 与快速操作条建表同源入口
      if (this.targetEditable(view, embed)) {
        runCreateTable(view)
        view.focus()
      }
      return
    }
    // 其余为 formatOperations id（wikilink/link/bold/…/heading1-6）——复用
    // 快速操作条同一执行路径（含守卫、计划与焦点归还；目标 = 菜单捕获
    // 的重验后视图，不再按当前焦点二次解析——菜单关闭还焦存在时序差）
    if (isFormatOperationId(command)) {
      this.runFormatOperation(command, { view, embed })
      return
    }
    // 运行期注册且无 handler、又不在白名单：开发期告警（注册方应在描述符
    // 带 handler 或对齐内置命令名；不再静默忽略）
    console.warn(`[vsidian] 右键菜单命令无执行器：${command}（注册项未带 handler 且不在内置白名单）`)
  }

  /** 剪切/复制：选区文本经宿主剪贴板桥直写（多行 EOL 归一在会话层）；
   *  剪切再以单笔事务删选区（一笔 edit.request = 宿主撤销一次）。
   *  P2-10：target 参数化（嵌入菜单的目标实例；缺省按焦点解析） */
  private copySelectionToClipboard(cut: boolean, target?: { view: EditorView; embed: LiveEditorInstance | null }): void {
    const resolved = target ?? this.actionTarget()
    const view = resolved?.view
    if (!view || !this.targetEditable(view, resolved?.embed ?? null)) {
      return
    }
    const range = view.state.selection.main
    if (range.empty) {
      return
    }
    const text = view.state.sliceDoc(range.from, range.to)
    this.bridge.postMessage({ kind: 'clipboard.write', text })
    if (cut) {
      try {
        view.dispatch({ changes: { from: range.from, to: range.to } })
      } catch (error) {
        console.error('[vsidian] 剪切删除失败（坐标与当前文档不匹配）', error)
      }
    }
    view.focus()
  }

  /** #314 粘贴目标实例解析：view → 所属 Live 实例（嵌入经 liveViewEntry
   *  反查在场端口，正文回落 this.live）。粘贴的出站元数据通道
   *  （withPasteMeta）、撤销段边界（markUndoSegmentBoundary）与组身份
   *  （sessionId/seq）都取目标实例——P2-02 后出站管线随实例，#314 的
   *  反馈/分段机制随之实例化 */
  private pasteOwnerInstance(view: EditorView): LiveEditorInstance | null {
    if (view !== this.view) {
      return this.embedCards?.liveViewEntry(view)?.instance ?? null
    }
    return this.live ?? null
  }

  /** 粘贴目标身份（reqId 校验与组身份的 sessionId/docUri）：嵌入目标取
   *  实例身份（其 edit.request/ack 均以实例会话为目标），正文取根会话 */
  private pasteTargetIdentity(view: EditorView, instance: LiveEditorInstance): { sessionId: string; docUri: string } {
    return view === this.view
      ? { sessionId: this.sessionId, docUri: this.docUri }
      : { sessionId: instance.targetSessionId, docUri: instance.targetDocUri }
  }

  /** 菜单/可绑定粘贴：优先多格式快照，权限受限时宿主纯文本桥回退。
   *  两路径均固定本次目标并进入既有 paste 处理链。P2-10：发起时捕获目标
   *  视图（嵌入菜单的粘贴经端口写 B；回包重验实例在场）；plain 走纯文本
   *  桥（#314 pastePlain 命令）。#314 移植：目标身份（sessionId/docUri）
   *  按目标实例——嵌入粘贴的 reqId 校验与组身份对齐实例会话，不再取根 */
  private requestClipboardPaste(requestTarget?: { view?: EditorView; embed?: LiveEditorInstance | null; plain?: boolean }): void {
    const plain = requestTarget?.plain === true
    const resolved = requestTarget?.view !== undefined
      ? { view: requestTarget.view, embed: requestTarget.embed ?? null }
      : this.actionTarget()
    if (!resolved) {
      return
    }
    const view = resolved.view
    if (!this.targetEditable(view, resolved.embed)) {
      return
    }
    const instance = this.pasteOwnerInstance(view)
    if (!instance) {
      return
    }
    this.clipboardReadReqId += 1
    const reqId = this.clipboardReadReqId
    const target = { view, doc: view.state.doc, selection: view.state.selection,
      ...this.pasteTargetIdentity(view, instance), modeRevision: this.pasteModeRevision }
    this.clipboardReadTarget = target
    const valid = () => reqId === this.clipboardReadReqId && this.clipboardTargetValid(target)
    if (!navigator.clipboard?.read) {
      this.bridge.postMessage({ kind: 'clipboard.read', reqId })
      return
    }
    void readClipboardSnapshot(navigator.clipboard).then((snapshot) => {
      if (!valid()) return
      if (!plain && snapshot.images.length === 0) {
        void this.processRichPaste(snapshot, target, reqId)
        return
      }
      this.clipboardReadReqId += 1
      this.clipboardReadTarget = undefined
      const text = clipboardPlainText(snapshot)
      const hasImages = clipboardHasImages(snapshot)
      if (plain && !text) {
        if (hasImages) this.showPlainPasteImageToast(false)
        return
      }
      if (plain && hasImages) this.applyPlainPasteWithImageFeedback(view, snapshot)
      else dispatchClipboardPaste(view.contentDOM, snapshot, plain)
      view.focus()
    }).catch(() => {
      // 权限受限时仅回退宿主 text/plain；未读取图片类型，不伪报遇到图片。
      if (valid()) this.bridge.postMessage({ kind: 'clipboard.read', reqId })
    })
  }

  private clipboardTargetValid(target: NonNullable<WebviewSyncController['clipboardReadTarget']>): boolean {
    const instance = this.pasteOwnerInstance(target.view)
    if (!instance || instance.getView() !== target.view) {
      return false
    }
    // 根目标要求根处于 live；嵌入目标不查根模式（父 Reading + 嵌入手动
    // Live 是合法组合——实例侧 Live 激活与可编辑性由实例守卫覆盖）
    if (target.view === this.view && this.viewMode !== 'live') {
      return false
    }
    const identity = this.pasteTargetIdentity(target.view, instance)
    return !!identity.sessionId && !!identity.docUri &&
      identity.sessionId === target.sessionId && identity.docUri === target.docUri &&
      this.pasteModeRevision === target.modeRevision && !instance.isSuspended &&
      target.view.state.doc === target.doc && target.view.state.selection.eq(target.selection) &&
      !target.view.state.readOnly && target.view.state.facet(EditorView.editable)
  }

  /** #314 原生 HTML 粘贴接管（实例 paste domEventHandler → 根转换管线，
   *  与菜单/改绑入口共用 processRichPaste）：构造同构的目标身份并登记
   *  在途 reqId。嵌入实例未接线 onRichPasteHtml（组合边界）——其 HTML
   *  粘贴在实例侧放行默认链，不会到达此处 */
  private handleRichPasteHtml(view: EditorView, html: string, text?: string): boolean {
    const instance = this.pasteOwnerInstance(view)
    if (!instance || instance.getView() !== view ||
        instance.isSuspended || view.state.readOnly || !view.state.facet(EditorView.editable)) {
      return false
    }
    this.clipboardReadReqId += 1
    const reqId = this.clipboardReadReqId
    const target = { view, doc: view.state.doc, selection: view.state.selection,
      ...this.pasteTargetIdentity(view, instance), modeRevision: this.pasteModeRevision }
    this.clipboardReadTarget = target
    this.richPasteDialog?.cancel(false)
    void this.processRichPaste({ html, images: [], ...(text !== undefined ? { text } : {}) }, target, reqId)
    return true
  }

  /** 普通native paste与菜单/改绑快照的同一转换入口；只用一份输入快照。 */
  private async processRichPaste(snapshot: ClipboardSnapshot, target: NonNullable<WebviewSyncController['clipboardReadTarget']>, reqId: number): Promise<void> {
    const valid = () => reqId === this.clipboardReadReqId && this.clipboardTargetValid(target)
    if (!valid()) return
    let plain: string
    try { plain = clipboardPlainText(snapshot) } catch { this.toast?.show(t('toast.pasteNoText'), 'error'); return }
    const state = target.view.state
    const tree = state.field(liveDecorationsField, false)?.tree
    const plainContext = state.selection.ranges.some((range) => tree && [range.from, range.to].some((pos) =>
      chainAt(tree, pos).some((node) => ['FencedCode', 'CodeBlock', 'InlineCode', 'Table', 'TableHeader', 'TableRow', 'TableDelimiter'].includes(node.name))))
    const enabled = this.settings?.[PASTE_PRESERVE_FORMATTING_KEY] !== false
    if (!enabled || plainContext || !snapshot.html) {
      if (plain) dispatchClipboardPaste(target.view.contentDOM, { text: plain, images: [] }, true)
      return
    }
    let converted: ReturnType<typeof htmlToMarkdown>
    try { converted = htmlToMarkdown(snapshot.html) }
    catch {
      if (plain) this.applyRichPaste(plain, plain, 'fallback', target.view)
      else this.toast?.show(t('toast.pasteNoText'), 'error')
      return
    }
    if (!converted.hasFormatting || converted.markdown === plain) {
      if (plain) dispatchClipboardPaste(target.view.contentDOM, { text: plain, images: [] }, true)
      return
    }
    if (!richPasteDistributionMatches(target.view.state, plain, converted.markdown)) {
      this.clipboardReadReqId += 1
      this.clipboardReadTarget = undefined
      if (plain) this.applyRichPaste(plain, plain, 'fallback', target.view)
      else this.toast?.show(t('toast.pasteNoText'), 'error')
      return
    }
    let keep = true
    if (this.settings?.[PASTE_ASK_BEFORE_KEY] !== false) {
      const choice = await this.richPasteDialog?.open()
      if (!valid() || !choice || choice.decision === 'cancel') return
      keep = choice.decision === 'keep'
      if (choice.remember) {
        this.bridge.postMessage({ kind: 'paste.preferences.set', reqId: ++this.pastePreferenceReqId, preserveFormatting: keep })
      }
    }
    if (!valid()) return
    this.clipboardReadReqId += 1
    this.clipboardReadTarget = undefined
    if (keep) this.applyRichPaste(plain, converted.markdown, 'rich', target.view)
    else if (plain) dispatchClipboardPaste(target.view.contentDOM, { text: plain, images: [] }, true)
  }

  /** 同步显示两个本地阶段；既有ACK队列分别提交，不另设撤销历史。
   *  #314 × P2-02：出站元数据经目标实例 withPasteMeta 通道附到
   *  edit.request/sentTxns/暂缓段（根级 recordingPasteStage 仅承担
   *  onViewUpdate 豁免与释放守卫，不再参与出站）；撤销段边界经实例公开
   *  markUndoSegmentBoundary；组身份（sessionId/seq）取目标实例（嵌入
   *  粘贴的组不冒充根会话） */
  private applyRichPaste(plain: string, formatted: string, feedback: 'rich' | 'fallback', view: EditorView): void {
    const instance = this.pasteOwnerInstance(view)
    if (!instance || instance.getView() !== view || !formatted ||
        instance.isSuspended || view.state.readOnly || !view.state.facet(EditorView.editable)) return
    this.invalidatePasteFeedback()
    // seq由bridge持久化并在面板重载后续号，避免新实例复用旧历史的组身份。
    const identity = this.pasteTargetIdentity(view, instance)
    const group = `${identity.sessionId}:${instance.seqNow + 1}:paste-${++this.pasteGroupId}`
    const stages = planRichPaste(view.state, plain, formatted, feedback === 'rich' && this.settings?.[PASTE_SPLIT_UNDO_KEY] !== false, group)
    if (stages.length === 0) return
    this.pasteFeedback.push({ kind: feedback, group, stage: stages.at(-1)!.paste.stage, landed: false })
    try {
      for (const stage of stages) {
        this.recordingPasteStage = stage.paste
        instance.markUndoSegmentBoundary()
        instance.withPasteMeta({ paste: stage.paste }, () => view.dispatch(stage.transaction))
      }
    } finally {
      this.recordingPasteStage = undefined
      instance.markUndoSegmentBoundary()
    }
    view.focus()
    this.releasePasteFeedback(instance)
  }

  /** 反馈释放：落定项弹 toast。「本地全部落定」与暂停态按**目标实例**
   *  判定（main 版根级 hasUnlandedLocalEdits 的实例化——粘贴事务的
   *  在途/暂缓状态在目标实例上） */
  private releasePasteFeedback(target: LiveEditorInstance | null): void {
    if (this.recordingPasteStage || this.recordingPlainPasteFeedback) return
    if (!target || target.hasUnlandedLocalEditsNow() || target.isSuspended) return
    for (const feedback of this.pasteFeedback.splice(0)) {
      if (!feedback.landed) continue
      if (feedback.kind === 'rich') {
        this.pasteToastKey = `paste:${feedback.group}`
        this.toast?.show(t('toast.pasteFormattingKept'), 'neutral', this.pasteToastKey)
      } else if (feedback.kind === 'plain-image') this.showPlainPasteImageToast(true)
      else this.toast?.show(t('toast.pasteFormattingFailed'), 'error')
    }
  }

  /** 仍走原生CM/table粘贴链；本地反馈ID随事务/暂缓段等实际ACK，不进入宿主协议。 */
  private applyPlainPasteWithImageFeedback(view: EditorView, snapshot: ClipboardSnapshot): void {
    const instance = this.pasteOwnerInstance(view)
    if (!instance || instance.getView() !== view) return
    const identity = this.pasteTargetIdentity(view, instance)
    const group = `${identity.sessionId}:${instance.seqNow + 1}:plain-image-${++this.pasteGroupId}`
    const feedback = { kind: 'plain-image' as const, group, stage: 'single' as const, landed: false }
    this.pasteFeedback.push(feedback)
    const before = view.state.doc
    this.recordingPlainPasteFeedback = group
    instance.markUndoSegmentBoundary()
    let handled = false
    try {
      handled = instance.withPasteMeta({ plainPasteFeedback: group }, () =>
        dispatchClipboardPaste(view.contentDOM, snapshot, true))
    }
    finally {
      this.recordingPlainPasteFeedback = undefined
      instance.markUndoSegmentBoundary()
    }
    if (!handled || view.state.doc === before) {
      const index = this.pasteFeedback.indexOf(feedback)
      if (index >= 0) this.pasteFeedback.splice(index, 1)
    }
    this.releasePasteFeedback(instance)
  }

  private invalidatePasteFeedback(): void {
    for (let i = this.pasteFeedback.length - 1; i >= 0; i--) {
      if (this.pasteFeedback[i]!.kind === 'rich') this.pasteFeedback.splice(i, 1)
    }
    if (this.pasteToastKey) this.toast?.dismiss(this.pasteToastKey)
    this.pasteToastKey = undefined
  }

  /** #314 分步撤销的 undo/redo 回流收尾：粘贴历史选区恢复 + 阶段撤销
   *  toast。doc.changed 只路由根实例（P2-02 路由现状），本方法保持根
   *  视角；嵌入粘贴的 undo 选区恢复是组合缺口（嵌入实例的 doc.changed
   *  回流不接 onExternalDocSettled 钩子）——已知边界，不在本票实现 */
  private finishPasteHistory(message: Pick<Extract<HostToWebview, { kind: 'doc.changed' }>, 'reason' | 'paste'>): void {
    this.invalidatePasteFeedback()
    const view = this.view
    const paste = message.paste
    if (!view || !this.live || !message.reason || !paste || this.suspended ||
        this.live.hasUnlandedLocalEditsNow()) return
    if (paste.sessionId === this.sessionId) {
      const selection = message.reason === 'undo' ? paste.before : paste.after
      const clamp = (pos: number) => Math.max(0, Math.min(view.state.doc.length, pos))
      view.dispatch({ selection: EditorSelection.create(selection.ranges.map(r => EditorSelection.range(clamp(r.anchor), clamp(r.head))), selection.mainIndex), annotations: externalSync.of(true) })
    }
    if (message.reason === 'undo' && paste.stage === 'format' && paste.hasTextStep) {
      this.pasteToastKey = `paste:${paste.group}`
      this.toast?.show(t('toast.pasteFormattingUndone'), 'neutral', this.pasteToastKey)
    }
  }

  private showPlainPasteImageToast(inserted: boolean): void {
    const bindings = getEffectiveBindings(this.keybindingOverrides, 'paste')
    const name = t('command.clipboard.paste.title')
    const paste = bindings.length ? `${name} (${formatBindingLabel(bindings[0]!)})` : name
    this.toast?.show(t(inserted ? 'toast.pasteTextOnly' : 'toast.pasteImageOnly', { paste }), 'warning')
  }

  /** 快捷键/命令面板入口（宿主 blockLink.copy 消息）：对光标所在块执行
   *  与右键同款复制（光标在标题行 = 复制标题链接）。P2-10：焦点在嵌入
   *  内部 Live 内时目标为 B（块 id 补写与链接归属按目标文档） */
  private runBlockCopyAtCursor(): void {
    const resolved = this.actionTarget()
    const view = resolved?.view
    if (!view || !this.targetEditable(view, resolved?.embed ?? null)) {
      return
    }
    const target = this.contextSnapshotAt(view, view.state.selection.main.head)?.blockTarget ?? null
    if (target === null) {
      return
    }
    const docUri = (resolved?.embed ? this.embedCards?.liveViewEntry(view)?.docUri : undefined) ?? this.docUri
    if (target.heading !== null) {
      this.copyHeadingLink(target.heading.text, docUri)
      return
    }
    this.copyBlockLinkOf(target, view, docUri)
  }

  /** 复制标题链接：标题取行面字面文本（含行内标记）——与大纲 copyLink 及
   *  宿主 findHeadingOffset 的字面比较口径同源（宿主拼 `[[笔记名#标题]]`） */
  private copyHeadingLink(headingText: string, docUri: string): void {
    this.bridge.postMessage({
      kind: 'clipboard.write',
      linkHeading: { docUri, heading: headingText },
    })
  }

  /** 复制块链接：块已有块 id（行尾 ` ^id` 或独立行 `^id` 双形态——增集
   *  识别，手写任一形态都复用）直接用；没有则先自动补写（6 位随机
   *  [a-z0-9]、全文 id 查重避让；块尾行后空一行写独立行，Obsidian 默认
   *  形态）——单事务 dispatch（一笔 edit.request = 撤销一次），dispatch
   *  成功再写剪贴板。P2-10：view/docUri 参数化（嵌入菜单经端口写 B，
   *  链接归属目标文档） */
  private copyBlockLinkOf(target: ContextMenuBlockTarget, view: EditorView, docUri: string): void {
    const doc = view.state.doc
    const lines = doc.toString().split('\n')
    const lastLine = target.block.end
    const lineText = lines[lastLine] ?? ''
    // 已有 id 三个落点：块尾行行尾（行尾形态）、块尾行自身（紧贴独立行被
    // 块区间吞并）、块尾之后跨空行首个非空行（空行隔开的独立行）
    const existing =
      blockIdOfLine(lineText) ??
      standaloneBlockIdOf(lineText) ??
      standaloneBlockIdAfterBlock(lines, target.block)
    if (existing !== null) {
      this.bridge.postMessage({
        kind: 'clipboard.write',
        linkBlock: { docUri, blockId: existing },
      })
      return
    }
    const id = generateBlockId(collectBlockIds(lines))
    const insert = planBlockIdInsertion(id)
    const lineInfo = doc.line(lastLine + 1)
    try {
      view.dispatch({ changes: { from: lineInfo.to, to: lineInfo.to, insert } })
    } catch (error) {
      // 越界坐标等异常不逃逸（与 applyOutlineEdits 同口径）——写入失败时
      // 不写剪贴板（链接会指向不存在的 id）
      console.error('[vsidian] 块 id 写入失败（块尾行坐标与当前文档不匹配）', error)
      return
    }
    this.bridge.postMessage({
      kind: 'clipboard.write',
      linkBlock: { docUri, blockId: id },
    })
  }

  // ---- 大纲拖拽排序（#70）----
  // 移动原子 = 控制域（outlineDrag.ts 的移动计划纯函数单一事实源）；一次
  // 拖拽 = 一次 CM6 事务 dispatch（applyOutlineEdits，单笔 edit.request =
  // 宿主撤销一次），写后即时 ensureFresh（折叠/搜索/高亮随 #67 迁移与
  // #68 重算自动存活）。交互链路：条目 pointerdown 记锚点 → 超阈值
  // pointermove 进入拖拽态并逐次计算落点（三态命中 + 有效性）→ pointerup
  // 写回 / Esc·pointercancel 取消。落点指示是纯类切换（dragging 源条目
  // 弱化 + drop-before/after 插入线 + drop-inside 包裹高亮），拖拽期间
  // 条目 DOM 不重建（锚点防御兜底）。不可见条目（折叠遮蔽/搜索过滤）
  // 不构成合法落点——用户看不到的位置不构成拖拽意图。

  /** 拖拽 pointermove：超阈值进入拖拽态；计算落点并施加指示类。
   *  命中目标优先取事件目标链（合成事件路径），真实布局回退
   *  elementFromPoint（指针物理位置）。
   *  review-loops 第 2 轮：只认起始指针（pointerId 不符即忽略），且按键已
   *  释放（buttons=0）说明手势在 webview 之外结束——立即取消，避免纯悬停
   *  继续推进会话、画出落点指示，或让随后的释放被当作 drop 写回
   *  review-loops 第 2 轮补（和弦按键）：非主键按下即结束会话。和弦按键
   *  （左键按住时再按右键）不投递 pointerdown——浏览器只在首个按键按下时
   *  报 pointerdown，第二个按键只报 pointermove(button=2, buttons=3)，其
   *  释放也不是 pointerup。若左键先松，右键抬起会成为最后一个按键的真实
   *  pointerup（button=2, buttons=0，且 pointerId 与起始指针相同），残留会话
   *  即按残留落点写出 drop（实测一次误写回）。故该判据只能落在移动路径上；
   *  不变式：仅主键（左键）释放执行落点写回
   *  review-loops 第 3 轮：判据只按 buttons 位掩码、不限指针类型——按 W3C
   *  位掩码，笔的 barrel 键是 bit1（按下 button=2/buttons=2，接触期间按下则
   *  buttons=3），旧判据以 pointerType==='mouse' 为前提，笔据此绕过守卫
   *  （同第 2 轮鼠标和弦的失效模式换输入类别）。接触态的 buttons 只含 bit0
   *  （触屏实测 pointermove buttons=1；笔接触态按 W3C 同为 1），按掩码换算
   *  不进此分支 */
  private readonly onOutlineDragMove = (event: PointerEvent): void => {
    const drag = this.outlineDragState
    const panel = this.outlinePanelEl
    if (!drag || !panel || event.pointerId !== drag.pointerId) {
      return
    }
    // bit0（接触/左键）之外的任一位落下（鼠标右/中键、笔 barrel）即证明
    // 手势意图已变：结束会话（与面板 pointerdown 的启动判据同口径）
    if ((event.buttons & ~1) !== 0) {
      this.cancelOutlineDrag()
      return
    }
    if (event.buttons === 0) {
      this.cancelOutlineDrag()
      return
    }
    if (!drag.moved) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) {
        return
      }
      drag.moved = true
      // review-loops C4：源条目提示只在进入拖拽态时施加一次（原先每 move
      // 全量循环 toggle/removeClassList，数千条目 × 60-120Hz 掉帧）
      const src = panel.querySelectorAll<HTMLElement>(`.${OUTLINE_CLASS_NAMES.item}`)[drag.fromIndex]
      src?.classList.add(OUTLINE_CLASS_NAMES.dragging)
    }
    // 落点指示增量化：只清上一个指示元素（全量清除留给收尾兜底）
    drag.hintEl?.classList.remove(
      OUTLINE_CLASS_NAMES.dropBefore,
      OUTLINE_CLASS_NAMES.dropAfter,
      OUTLINE_CLASS_NAMES.dropInside,
    )
    drag.hintEl = null
    drag.targetIndex = null
    drag.position = null
    const nodes = panel.querySelectorAll<HTMLElement>(`.${OUTLINE_CLASS_NAMES.item}`)
    const hit = (event.target as Element | null)?.closest?.(`.${OUTLINE_CLASS_NAMES.item}`)
      ?? document.elementFromPoint?.(event.clientX, event.clientY)?.closest(`.${OUTLINE_CLASS_NAMES.item}`)
    if (!(hit instanceof HTMLElement) || !panel.contains(hit)) {
      return
    }
    if (hit.classList.contains(OUTLINE_CLASS_NAMES.hidden)) {
      return // 不可见条目不作为落点（口径见区块头）
    }
    const index = Array.from(nodes).indexOf(hit)
    if (index < 0 || !outlineDropAllowed(this.outlineItems, drag.fromIndex, index)) {
      return // 拖入自身控制域内部：无有效落点（不显示指示、drop 无写回）
    }
    const rect = hit.getBoundingClientRect()
    if (rect.height <= 0) {
      return // 无布局环境（防御）：几何不可知，不构成落点
    }
    const position = outlineDropPositionAt(rect.top, rect.height, event.clientY)
    drag.targetIndex = index
    drag.position = position
    drag.hintEl = hit
    hit.classList.add(
      position === 'before' ? OUTLINE_CLASS_NAMES.dropBefore
        : position === 'after' ? OUTLINE_CLASS_NAMES.dropAfter
          : OUTLINE_CLASS_NAMES.dropInside,
    )
  }

  /** 拖拽 pointerup：有效落点执行移动计划写回（一次编辑事务）；锚点过期
   *  （拖拽期间文档被改写）放弃。收尾后吞一次补发 click。
   *  review-loops 第 2 轮：只认起始指针的释放（other pointer 的 up 不收尾，
   *  避免「窗口外按下后拖入 webview」的异指针手势误判为 drop）
   *  review-loops 第 2 轮补（和弦按键）：纵深防线——仅主键（左键）释放执行
   *  drop。和弦路径下右键抬起会以起始指针的 pointerId 送来真实 pointerup
   *  （button=2, buttons=0，见 onOutlineDragMove 的和弦守卫）；合成事件或
   *  其他路径送来非主键释放时同样不得按残留落点写回，会话留给主键释放收尾
   *  review-loops 第 3 轮：判据只按 button、不限指针类型——笔的 barrel 键
   *  释放同样是 button=2（同上，旧判据的 mouse 前提会放它过闸） */
  private readonly onOutlineDragEnd = (event: PointerEvent): void => {
    const drag = this.outlineDragState
    if (!drag || event.pointerId !== drag.pointerId) {
      return
    }
    // 仅主键（button=0）释放收尾：非主键释放（鼠标右/中键、笔 barrel）既不
    // 收尾也不写回（与移动路径守卫同口径）
    if (event.button !== 0) {
      return
    }
    const perform = drag.moved && drag.targetIndex !== null && drag.position !== null
    const { fromIndex, targetIndex, position, doc: snapshot } = drag
    this.cancelOutlineDrag()
    if (!perform) {
      return
    }
    this.outlineSuppressClick = true
    // 锚点防御（#69 菜单同思路；第 3 轮与重命名提交路径同口径）：拖拽期间
    // doc 被改写则索引与坐标失效；但**内容等价**的全文重置（宿主 resync/init
    // 重发同一文本）只是换了 Text 实例、行号并未过期，不得误放弃。放弃留痕
    // （与重命名同口径），否则用户只看到「拖了没反应」
    const doc = this.view?.state.doc
    if (!doc || (doc !== snapshot && !doc.eq(snapshot))) {
      console.warn('[vsidian] 大纲拖拽放弃：编辑期间文档已被改写（锚点过期）')
      return
    }
    // 条目坐标防线（review-loops 第 4 轮，P2 实测）：写回计划按**条目序列**
    // 的行号算搬移范围，而序列的行号由 outlineItems 承载——它可能在拖拽期间
    // 被去抖刷新换成中间态的行号：outlineEnsureFresh 只在序列变化（级别/原文/
    // 可见文本/标记不同）时才 cancelOutlineDrag，序列逐字相同而行号平移
    // （外部插入/删除正文行）时它照常把 items 换成新行号的序列，会话存活。
    // 此时若上面那条判据放行（文档回到原文：实例换代但内容等价、eq 通过），
    // 写回就变成「行号取自中间态 items、改动范围取自起始快照」，把错坐标写进
    // 权威文档（实测：`#### 丁` 段与 `## 丙` 段被切走，文档错位且丢内容）。
    // 故判据补上「items 是快照内容的派生物」这一半：items 的派生来源
    // （outlineDoc，outlineItems 的唯一赋值点即 outlineEnsureFresh，二者恒同源）
    // 必须仍与起始快照**内容等价**。doc.eq 只比内容不比坐标——它证明当前内容
    // 等于起始内容，不证明手上的 items 行号还对应这份内容；而派生来源等价即
    // items 的行号来自等价内容（内容相同 ⇒ 行号相同），可与当前 doc 直接对齐。
    // 只比实例不比内容会误伤：正常 resync 只换 Text 实例（items 未换，或换过但
    // 仍从等价内容派生），那两类坐标都仍然有效，照常写回（第 3 轮容错不回退）。
    const itemsDoc = this.outlineDoc
    if (itemsDoc === null || (itemsDoc !== snapshot && !itemsDoc.eq(snapshot))) {
      console.warn('[vsidian] 大纲拖拽放弃：大纲条目坐标已随外部改写刷新（非起始快照派生）')
      return
    }
    const plan = outlineMovePlan(doc, this.outlineItems, fromIndex, targetIndex!, position!)
    if (plan) {
      this.applyOutlineEdits(plan.changes) // 内部 ensureFresh 即时刷新大纲
    }
  }

  /** pointercancel（系统手势接管等）：视作取消，零写回 */
  private readonly onOutlineDragCancel = (): void => {
    this.cancelOutlineDrag()
  }

  /** 大纲按下入口清理（document capture pointerdown）：
   *  - 复位拖拽吞噬标志：drop 收尾置位的「吞一次浏览器补发 click」标志只在
   *    补发 click 抵达时解除，而写回会在 pointerup 处理内同步重建条目 DOM
   *    ——补发 click 不送达时标志残留，会吞掉用户下一次真实点击（review-loops
   *    第 2 轮：真实鼠标实测 drop 后 flag 仍为 true 且下一次点击被吞）。任何
   *    按下都先复位；补发 click 恒在本次按下之后，故「只吞一次」口径不变
   *  - 清理残留拖拽会话：越界释放（up 不送达 webview，如释放在窗口原生
   *    chrome／另一窗口）留下的会话，任意一次新按下都证明该手势已结束
   *  次指针（触屏多点第二指）跳过第二条，不误杀进行中的拖拽；判据带
   *  pointerType==='touch' 前提（review-loops 第 4 轮）——合成 PointerEvent
   *  的 isPrimary 默认为 false，只按它判会让残留清理在合成事件路径上整体失效 */
  private readonly outlinePointerdownEntry = (event: PointerEvent): void => {
    this.outlineSuppressClick = false
    if (event.pointerType === 'touch' && event.isPrimary === false) {
      return
    }
    if (!this.outlineDragState) {
      return
    }
    this.cancelOutlineDrag()
  }

  /** Esc 取消拖拽（拖拽期间 document capture keydown）：零写回 */
  private readonly onOutlineDragEscape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      this.cancelOutlineDrag()
    }
  }

  /** 结束拖拽会话（幂等）：摘除 document/window 监听、清指示类与状态
   *  （指针捕获只用于折叠滑块行，拖拽链路不经 capture——setPointerCapture
   *  会劫走条目内折叠箭头的 click，浏览器回归实证后已回退） */
  private cancelOutlineDrag(): void {
    const drag = this.outlineDragState
    if (!drag) {
      return
    }
    this.outlineDragState = null
    document.removeEventListener('pointermove', this.onOutlineDragMove)
    document.removeEventListener('pointerup', this.onOutlineDragEnd)
    document.removeEventListener('pointercancel', this.onOutlineDragCancel)
    document.removeEventListener('keydown', this.onOutlineDragEscape, true)
    window.removeEventListener('blur', this.onOutlineDragCancel)
    this.clearOutlineDragDom()
  }

  /** 清拖拽指示类（条目 DOM 全量幂等清除） */
  private clearOutlineDragDom(): void {
    const panel = this.outlinePanelEl
    panel?.querySelectorAll<HTMLElement>(`.${OUTLINE_CLASS_NAMES.item}`).forEach((el) => {
      el.classList.remove(
        OUTLINE_CLASS_NAMES.dragging,
        OUTLINE_CLASS_NAMES.dropBefore,
        OUTLINE_CLASS_NAMES.dropAfter,
        OUTLINE_CLASS_NAMES.dropInside,
      )
    })
  }

  /** #70 测试钩子驱动真实拖拽链路：向真实条目派发 pointer 事件序列
   *  （pointerdown → 超阈值 move → 目标三态区域 move），action 决定收尾
   *  （hover 留悬停态供 probe 观测 / drop 补 pointerup 写回 / escape 按
   *  Esc 取消）。落点 Y 取目标条目的 12%/50%/88% 分位（25% 容差内稳定
   *  命中 before/inside/after） */
  private runOutlineDragTest(
    from: number,
    to: number,
    position: OutlineDropPosition,
    action: 'hover' | 'drop' | 'escape',
  ): void {
    const panel = this.outlinePanelEl
    if (!panel) {
      return
    }
    // 会话卫生：上一轮 hover 留下的悬停会话先取消（否则 pointerdown 守卫
    // 拒绝新会话——集成用例连续驱动时必需）
    if (this.outlineDragState) {
      this.cancelOutlineDrag()
    }
    const nodes = panel.querySelectorAll<HTMLElement>(`.${OUTLINE_CLASS_NAMES.item}`)
    const fromEl = nodes[from]
    const toEl = nodes[to]
    if (!fromEl || !toEl) {
      return
    }
    const fromRect = fromEl.getBoundingClientRect()
    const toRect = toEl.getBoundingClientRect()
    const yRatio = position === 'before' ? 0.12 : position === 'after' ? 0.88 : 0.5
    const y = toRect.top + toRect.height * yRatio
    const fire = (type: string, target: Element, x: number, yy: number): void => {
      // 会话校验（review-loops 第 2 轮）读 pointerId 与 buttons：合成事件按
      // 真实指针形态构造——同一指针 id，移动期间按键为按下态、释放为 0
      target.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, clientX: x, clientY: yy,
        buttons: type === 'pointerup' ? 0 : 1,
      }))
    }
    fire('pointerdown', fromEl, fromRect.left + 20, fromRect.top + fromRect.height / 2)
    // 超阈值 move（起点右下偏移 > 4px，目标链路外先进入拖拽态）
    fire('pointermove', panel, fromRect.left + 60, fromRect.top + fromRect.height / 2 + 12)
    fire('pointermove', toEl, toRect.left + 40, y)
    if (action === 'hover') {
      return
    }
    if (action === 'escape') {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', bubbles: true, cancelable: true,
      }))
      return
    }
    fire('pointerup', toEl, toRect.left + 40, y)
  }

  // ---- 大纲定位与常驻高亮（#66）----
  // 当前控制域 = 视口顶部行向上最近的标题（locateOutlineIndex 单一事实源）。
  // 高亮是常亮位置指示器（半透明横条），不是滚动瞬时反馈：跳转即时落位、
  // 滚动去抖重算（100ms，轻于 250ms 数据链路）、模式切换即时重算；跳转的
  // 程序性滚动经防抖动护栏挂起联动（QO startJumping 同款语义：首个滚动
  // 事件被吞并释放，或超时释放），过渡期中间态不反向改写高亮。

  /** 滚动信号入口（live scrollDOM 与 reading 容器共用）：护栏挂起时吞掉
   *  首个滚动事件并释放（跳转程序性滚动的产物不触发重算）；否则去抖调度 */
  private onOutlineScrollSignal(): void {
    if (this.outlineJumpGuarded) {
      this.outlineJumpGuarded = false
      if (this.outlineJumpGuardTimer !== undefined) {
        clearTimeout(this.outlineJumpGuardTimer)
        this.outlineJumpGuardTimer = undefined
      }
      return
    }
    this.scheduleOutlineHighlightUpdate()
  }

  /** 程序性滚动（跳转/定位）前挂起滚动联动：1 秒超时兜底释放（正常路径
   *  由首个滚动事件释放——被吞的那次就是程序性滚动本身） */
  private suspendOutlineLinking(): void {
    this.outlineJumpGuarded = true
    if (this.outlineJumpGuardTimer !== undefined) {
      clearTimeout(this.outlineJumpGuardTimer)
    }
    this.outlineJumpGuardTimer = setTimeout(() => {
      this.outlineJumpGuardTimer = undefined
      this.outlineJumpGuarded = false
    }, OUTLINE_JUMP_GUARD_MS)
  }

  /** 取消未决的高亮去抖回调（面板不可见/销毁路径；迟到回调只在隐藏面板
   *  上做无谓重算——重开有 ensureFresh 校准兜底） */
  private cancelOutlineHighlightUpdate(): void {
    if (this.outlineHighlightTimer !== undefined) {
      clearTimeout(this.outlineHighlightTimer)
      this.outlineHighlightTimer = undefined
    }
  }

  /** 滚动驱动的高亮重算调度：仅面板可见时开启（不可见面板不伴随滚动
   *  做无谓计算），100ms 尾随去抖（定时器随事件重置，连续滚动只在
   *  停顿后重算一次） */
  private scheduleOutlineHighlightUpdate(): void {
    if (!this.outlineVisible()) {
      return
    }
    if (this.outlineHighlightTimer !== undefined) {
      clearTimeout(this.outlineHighlightTimer)
    }
    this.outlineHighlightTimer = setTimeout(() => {
      this.outlineHighlightTimer = undefined
      if (this.outlineJumpGuarded) {
        return // 护栏挂起：迟到回调不重算（挂起期间的高亮由跳转直接落位）
      }
      this.updateOutlineLocated()
    }, OUTLINE_HIGHLIGHT_DEBOUNCE_MS)
  }

  /** 重算当前控制域并施加高亮（同步即时路径：模式切换、文档校准、跳转）。
   *  #67：重算含 only-expand——located 被折叠遮蔽时展开其祖先链（滚动
   *  联动的动态展开语义），再按可见代表施加高亮 */
  private updateOutlineLocated(): void {
    const line = this.outlineViewportTopLine()
    this.outlineLocatedIndex = line === null ? null : locateOutlineIndex(this.outlineItems, line)
    if (this.outlineLocatedIndex !== null) {
      this.revealOutlineIndex(this.outlineLocatedIndex)
    }
    this.applyOutlineHighlight()
  }

  /** 视口顶部行（1 基）按模式分流：live 在已渲染行 DOM 里找首个底边越过
   *  视口顶的行，经 posAtDOM（文档结构映射，不依赖 viewState 的视口元
   *  数据——其更新依赖 IntersectionObserver 驱动的 measure 循环）换算
   *  行号；reading 以视口顶块锚点（源 start）换算行号（与 reading 自身
   *  滚动锚点同源）。无布局环境（jsdom，矩形全 0）或无已渲染行返回 null */
  private outlineViewportTopLine(): number | null {
    const view = this.view
    if (!view) {
      return null
    }
    if (this.viewMode === 'reading') {
      const anchor = this.readingView?.currentAnchor() ?? null
      if (anchor === null) {
        return null
      }
      return view.state.doc.lineAt(this.clampToDoc(anchor)).number
    }
    const scrollerTop = view.scrollDOM.getBoundingClientRect().top
    const lines = view.contentDOM.querySelectorAll('.cm-line')
    for (const line of lines) {
      const rect = line.getBoundingClientRect()
      if (rect.height > 0 && rect.bottom > scrollerTop + 0.5) {
        try {
          return view.state.doc.lineAt(view.posAtDOM(line, 0)).number
        } catch {
          return null
        }
      }
    }
    return null
  }

  /** 把 located 施加到面板条目（DOM 与 outlineItems 同序渲染的不变式下按
   *  序号 toggle；toggle 幂等，未变化条目零 DOM 写入）。#67 起高亮施加在
   *  「可见代表」上：located 条目被折叠遮蔽时为第一个可见祖先
   *  （outlineRepresentativeIndex；only-expand 已尽量让自身可见，回退
   *  仅在手动折叠/档位切换遮蔽路径生效）。#68 搜索态下代表口径加上过滤
   *  （折叠可见 ∧ 搜索保留，outlineSearchRepresentativeIndex；链上无
   *  可见代表则高亮消失——不强加到无关条目）。代表变化时高亮行滚进面板
   *  可视区（scrollIntoView nearest——已可见零滚动，同代表不重复滚） */
  private applyOutlineHighlight(): void {
    const panel = this.outlinePanelEl
    if (!panel) {
      return
    }
    const search = this.outlineSearchState
    const rep = this.outlineLocatedIndex === null
      ? null
      : search === null
        ? outlineRepresentativeIndex(this.outlineItems, this.outlineExpanded, this.outlineLocatedIndex)
        : outlineSearchRepresentativeIndex(
          this.outlineItems,
          this.outlineExpanded,
          search.kept,
          this.outlineLocatedIndex,
        )
    let index = 0
    for (const el of panel.querySelectorAll<HTMLElement>(`.${OUTLINE_CLASS_NAMES.item}`)) {
      el.classList.toggle(OUTLINE_CLASS_NAMES.located, index === rep)
      index += 1
    }
    if (rep === null || rep === this.outlineLastScrolledRep || !this.outlineVisible()) {
      return
    }
    const el = panel.querySelectorAll<HTMLElement>(`.${OUTLINE_CLASS_NAMES.item}`)[rep]
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' })
      this.outlineLastScrolledRep = rep
    }
  }

  // ---- 大纲工具条与标题搜索（#68）----
  // 纯视图状态（零写回、零出站、不入撤销栈）：搜索词是会话内内存态（不
  // 持久化、不跨文档保留）。语义见 outlineSearch.ts 模块头；可见口径 =
  // 折叠可见 ∩ 搜索过滤；进入搜索时快照展开集、清空时原样回放（QO 同款）。

  /** 搜索态判定（词条非空即活跃；空输入等于无过滤） */
  private outlineSearchActive(): boolean {
    return this.outlineSearchQuery !== ''
  }

  /** 搜索词变更入口（工具条输入框 input 事件；输入即时生效无去抖）：
   *  空→非空取展开快照；非空→空回放快照并清除；词条变化重算过滤并把
   *  命中祖先链并入当前展开集（只增不减——搜索态手动折叠不被覆盖） */
  private setOutlineSearch(query: string): void {
    const wasActive = this.outlineSearchActive()
    const nextActive = query !== ''
    if (!wasActive && nextActive) {
      this.outlineExpandedBeforeSearch = new Set(this.outlineExpanded)
    }
    if (wasActive && !nextActive) {
      const snapshot = this.outlineExpandedBeforeSearch
      this.outlineExpandedBeforeSearch = null
      if (snapshot) {
        this.outlineExpanded = new Set(snapshot)
      }
    }
    this.outlineSearchQuery = query
    this.applyOutlineSearch()
  }

  /** 搜索态全量落 DOM：重算过滤缓存 → 展开集并入命中祖先链 → 条目重渲染
   *  （带片段高亮；mark 生命周期 = 渲染级，词条或序列变化即随重建消失）
   *  → 折叠/过滤 hidden 类与「无匹配」占位 → 高亮代表重施加。
   *  搜索关闭时清缓存并重渲染（去掉 mark），回放的展开集已就位 */
  private applyOutlineSearch(): void {
    // review-loops 第 2 轮：条目 DOM 重建即取消拖拽会话（同 ensureFresh
    // changed 分支口径）——重建后 dragging 提示与 hintEl 均指向脱挂节点
    this.cancelOutlineDrag()
    if (!this.outlineSearchActive()) {
      this.outlineSearchState = null
      if (this.outlinePanelEl) {
        renderOutlineItems(this.outlinePanelEl, this.outlineItems, this.outlineFacts.hasChildren)
      }
      this.applyOutlineCollapseDom()
      this.applyOutlineHighlight()
      return
    }
    const filter = outlineSearchFilter(this.outlineItems, this.outlineSearchQuery)
    this.outlineSearchState = filter
    this.outlineExpanded = new Set(
      outlineSearchExpandSet(this.outlineItems, this.outlineExpanded, filter.matchedIndices),
    )
    if (this.outlinePanelEl) {
      renderOutlineItems(
        this.outlinePanelEl,
        this.outlineItems,
        this.outlineFacts.hasChildren,
        filter.ranges,
      )
    }
    this.applyOutlineCollapseDom()
    this.applyOutlineHighlight()
  }

  /** #68 跳转到笔记末尾：滚动正文到文档末尾（live = 末尾滚进视口下缘、
   *  reading = 滚动到末尾锚点块），不落光标（live 选区不动、不聚焦——
   *  纯滚动语义），零写回；高亮即时落位末尾控制域（不等滚动事件） */
  private outlineJumpToBottom(): void {
    const view = this.view
    const doc = view?.state.doc
    if (!view || !doc) {
      return
    }
    this.suspendOutlineLinking()
    if (this.viewMode === 'reading' && this.readingView) {
      const start = this.readingView.anchorStartFor(doc.length) ?? doc.length
      this.modeAnchor = start
      this.readingView.scrollToSrcStart(start)
      this.reassertReadingAnchor(start, 2)
    } else {
      this.modeAnchor = doc.length
      // 双滚（QO To Bottom 同款）：第一滚走 CM6 标准路径（scrollIntoView
      // 以高度模型定位），虚拟行高估算误差下可能停在「估算底部」；帧+宏
      // 任务后按真实 scrollHeight 补滚（视口渲染挂载、docHeight 收敛后）
      view.dispatch({ effects: EditorView.scrollIntoView(doc.length, { y: 'end' }) })
      scheduleFrame(() => {
        setTimeout(() => {
          if (this.view === view && this.viewMode !== 'reading') {
            const scroller = view.scrollDOM
            scroller.scrollTop = scroller.scrollHeight
          }
        }, 0)
      })
    }
    this.outlineLocatedIndex = locateOutlineIndex(this.outlineItems, doc.lines)
    if (this.outlineLocatedIndex !== null) {
      this.revealOutlineIndex(this.outlineLocatedIndex)
    }
    this.applyOutlineHighlight()
  }

  /** #68 重置三合一：清空搜索词（快照作废，不回放——重置即回初始态）、
   *  档位回默认 5（展开集整体替换为档位精确集，手动折叠随之清空）、
   *  输入框同步清空。全程纯视图零写回 */
  private resetOutline(): void {
    if (this.outlineExpandedBeforeSearch !== null) {
      this.outlineExpandedBeforeSearch = null
    }
    this.setOutlineSearch('')
    if (this.outlineToolbar) {
      this.outlineToolbar.search.value = ''
    }
    this.setOutlineExpandLevel(OUTLINE_EXPAND_LEVEL_DEFAULT)
  }

  // ---- 查找会话（#14；#236 起三开关面板与替换栏）----
  // UI 形态：webview 内浮动层（custom editor webview 不可用 VSCode 原生
  // find 控件，2026-10 批次四路核实）。入口：Mod-F 拦截、宿主
  // view.find.open（命令面板共用）、输入框 Enter/Shift-Enter、F3 循环
  // 导航；Ctrl+H（findReplace，仅 Live）打开并展开替换栏；Esc 关闭归还
  // 焦点。阅读模式整体禁用替换（2026-10）：键位不消费、replace 指令不
  // 开面板、toggle disabled。
  // 匹配引擎（#236）：@codemirror/search 的 SearchQuery（三开关 +
  // literal 字面量口径），匹配集基于 CM6 doc 全文文本模型，文档变化经
  // Text 引用比较判过期；高亮自绘（官方面板未装配，见 findSession
  // 模块头）；替换（#241 评审修复 P0-2）走自研路径——与查找同源的
  // 头区排除匹配集生成 changes 单事务 dispatch，经标准出站链路写回
  // （官方 replaceNext/replaceAll 全文扫描不排除头区，已退役）。

  /** 查找面板 DOM（稳定类名见 FIND_CLASS_NAMES；默认隐藏，open 类控制显隐；
   *  2026-10 对齐 VSCode 原生：grid 双列布局——左列 toggle 跨行全高、右列
   *  主行+替换行堆叠（原 column + absolute toggle + padding-left 让位退役）） */
  private buildFindPanel(): HTMLElement {
    const panel = document.createElement('div')
    panel.className = FIND_CLASS_NAMES.panel
    panel.setAttribute('role', 'search')
    // 替换栏展开/收起切换（左缘竖条；图标为自绘 SVG 挂内嵌 glyph——
    // aria-expanded 翻转经 CSS 旋转 90° 呈现 > / ⌄，与替换行 open 类同步；
    // 点击后焦点归还输入框，浮层内焦点圈互斥——对齐 VSCode 原生）
    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = FIND_CLASS_NAMES.toggle
    const toggleGlyph = document.createElement('span')
    toggleGlyph.className = FIND_CLASS_NAMES.toggleGlyph
    toggle.appendChild(toggleGlyph)
    bindLocaleAttrs(toggle, 'find.toggleReplace')
    toggle.addEventListener('click', () => {
      // 阅读模式整体禁用替换（2026-10）：disabled 灰化挡住真实点击，此处
      // 再守卫 findRender 同步前的陈旧 DOM 边缘——不触碰 live 展开记忆
      if (this.viewMode !== 'live') {
        return
      }
      this.setFindReplaceOpen(!this.findReplaceOpen)
      // 焦点归还输入框（toggle 不驻留焦点圈；输入框 focus 圈与 toggle
      // focus 圈天然互斥）
      this.findInputEl?.focus()
    })
    this.findToggleEl = toggle
    const row = document.createElement('div')
    row.className = FIND_CLASS_NAMES.row
    const input = document.createElement('input')
    input.type = 'text'
    input.className = FIND_CLASS_NAMES.input
    bindLocale(input, 'placeholder', 'find.placeholder')
    bindLocale(input, 'aria-label', 'find.label')
    input.addEventListener('input', () => {
      this.findQuery = input.value
      this.findDoc = null // 查询变化：以当前位置为参考重算
      this.findRecompute(this.findReferencePos())
      this.findRender()
      this.findLocate()
    })
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        this.findStep(e.shiftKey ? 'prev' : 'next')
      }
    })
    const count = document.createElement('span')
    count.className = FIND_CLASS_NAMES.count
    // 计数文案随命中状态变化：登记回调型换包重刷（求值统一走
    // findCountText，findRender 状态更新与 locale.changed 重刷同源）。
    // 位置在输入容器之后（VSCode 原生同序）
    bindLocaleFn(count, 'text', () => this.findCountText())
    // 输入容器（#241 对齐原生）：边框/背景挂容器，三开关嵌入右缘，
    // 聚焦环与非法态红边都落在容器上
    const inputWrap = document.createElement('div')
    inputWrap.className = FIND_CLASS_NAMES.inputWrap
    inputWrap.appendChild(input)
    row.appendChild(inputWrap)
    // 三开关（Aa/ab/.*；点亮 = 选项开启）：切换即重算匹配并把新选项经
    // findOptions.set 上送宿主持久化（workspace 级记忆，多面板广播一致）
    const mkToggle = (
      cls: string, icon: string, key: 'find.matchCase' | 'find.wholeWord' | 'find.regexp',
      flip: (o: FindOptions) => FindOptions,
    ): HTMLButtonElement => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = cls
      b.textContent = icon
      bindLocale(b, 'aria-label', key)
      bindLocale(b, 'title', key)
      b.addEventListener('click', () => {
        this.findOptions = flip(this.findOptions)
        this.findDoc = null
        this.findRecompute(this.findReferencePos())
        this.findRender()
        this.findLocate()
        this.bridge.postMessage({ kind: 'findOptions.set', options: { ...this.findOptions } })
      })
      return b
    }
    const caseBtn = mkToggle(FIND_CLASS_NAMES.caseToggle, 'Aa', 'find.matchCase',
      (o) => ({ ...o, matchCase: !o.matchCase }))
    const wordBtn = mkToggle(FIND_CLASS_NAMES.wordToggle, 'ab', 'find.wholeWord',
      (o) => ({ ...o, wholeWord: !o.wholeWord }))
    const regexpBtn = mkToggle(FIND_CLASS_NAMES.regexpToggle, '.*', 'find.regexp',
      (o) => ({ ...o, regexp: !o.regexp }))
    this.findCaseBtnEl = caseBtn
    this.findWordBtnEl = wordBtn
    this.findRegexpBtnEl = regexpBtn
    // 三开关嵌入输入容器右缘（原生同构）
    inputWrap.appendChild(caseBtn)
    inputWrap.appendChild(wordBtn)
    inputWrap.appendChild(regexpBtn)
    row.appendChild(count)
    // 图标按钮（导航与关闭，#241 对齐 VSCode 原生浮层）：图形由 CSS 按主题载入
    // light/dark SVG；功能词仍在 aria-label 与 hover title（i18n 同键，
    // bindLocaleAttrs 一次登记双目标）
    const mkIconBtn = (cls: string, key: 'find.prev' | 'find.next' | 'find.close',
      onClick: () => void): HTMLButtonElement => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = cls
      bindLocaleAttrs(b, key)
      b.addEventListener('click', onClick)
      return b
    }
    row.appendChild(mkIconBtn(FIND_CLASS_NAMES.prev, 'find.prev', () => this.findStep('prev')))
    row.appendChild(mkIconBtn(FIND_CLASS_NAMES.next, 'find.next', () => this.findStep('next')))
    // 在选定内容中查找（#241 资产接线，原生同位：next 与 close 之间）。
    // 面板局部态（非持久化、不出站 findOptions.set）：开启 = 捕获当前主
    // 选区为查找范围，匹配/导航/替换全部限内；无选区时禁用（原生同款）
    const inSelectionBtn = document.createElement('button')
    inSelectionBtn.type = 'button'
    inSelectionBtn.className = FIND_CLASS_NAMES.inSelection
    bindLocaleAttrs(inSelectionBtn, 'find.inSelection')
    inSelectionBtn.addEventListener('click', () => this.toggleFindInSelection())
    this.findInSelectionBtnEl = inSelectionBtn
    row.appendChild(inSelectionBtn)
    row.appendChild(mkIconBtn(FIND_CLASS_NAMES.close, 'find.close', () => this.closeFind()))
    // 替换行：输入框（Enter = 替换下一个，面板局部键）+ 替换/全部替换按钮
    const replaceRow = document.createElement('div')
    replaceRow.className = FIND_CLASS_NAMES.replace
    const replaceInput = document.createElement('input')
    replaceInput.type = 'text'
    replaceInput.className = FIND_CLASS_NAMES.replaceInput
    bindLocale(replaceInput, 'placeholder', 'find.replaceLabel')
    bindLocale(replaceInput, 'aria-label', 'find.replaceLabel')
    replaceInput.addEventListener('input', () => {
      this.findReplaceText = replaceInput.value
    })
    replaceInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        this.runFindReplace('next')
      }
    })
    const replaceNextBtn = document.createElement('button')
    replaceNextBtn.type = 'button'
    replaceNextBtn.className = FIND_CLASS_NAMES.replaceNext
    bindLocaleAttrs(replaceNextBtn, 'find.replaceNext')
    replaceNextBtn.addEventListener('click', () => this.runFindReplace('next'))
    const replaceAllBtn = document.createElement('button')
    replaceAllBtn.type = 'button'
    replaceAllBtn.className = FIND_CLASS_NAMES.replaceAll
    bindLocaleAttrs(replaceAllBtn, 'find.replaceAll')
    replaceAllBtn.addEventListener('click', () => this.runFindReplace('all'))
    replaceRow.appendChild(replaceInput)
    replaceRow.appendChild(replaceNextBtn)
    replaceRow.appendChild(replaceAllBtn)
    this.findReplaceRowEl = replaceRow
    this.findInputEl = input
    this.findCountEl = count
    panel.appendChild(toggle)
    panel.appendChild(row)
    panel.appendChild(replaceRow)
    return panel
  }

  /** 替换栏展开/收起（open 为 false 时收起；阅读模式强制收起——替换是
   *  Live 编辑能力，模式切换保活时替换行不进入阅读视图） */
  private setFindReplaceOpen(open: boolean): void {
    this.findReplaceOpen = open && this.viewMode === 'live'
    this.findRender()
  }

  /** Ctrl+F 种子行为（#236 对齐 VSCode）：live 单行非空选区文本填为搜索
   *  词；无选区/多行选区/阅读模式返回 null（保持既有查询词） */
  private findSeedFromSelection(): string | null {
    if (this.viewMode !== 'live' || !this.view) {
      return null
    }
    const sel = this.view.state.selection.main
    if (sel.empty) {
      return null
    }
    const text = this.view.state.sliceDoc(sel.from, sel.to)
    if (text === '' || text.includes('\n')) {
      return null
    }
    return text
  }

  /** 打开查找面板（可预置查询词；#236：无预置时按 VSCode 口径取单行选区
   *  作种子；replace=true 展开替换栏——调用方须保证 live（2026-10 阅读模式
   *  整体禁用替换：键位 mode 过滤与 view.find.open 的阅读守卫已把带
   *  replace 的打开收窄到 live，此处条件仅作冗余防御）；replacement 随
   *  replace 预置替换词——与预置查询词同语义）。重复打开重新聚焦输入框
   *  并全选查询 */
  private openFind(query?: string, opts: { replace?: boolean; replacement?: string } = {}): void {
    // P2-10：面板会话绑定主编辑器——焦点（记忆焦点）在嵌入内部 Live 内时
    // 不打开（不落 A；面板实例化属后续票）
    if (this.embedFocusBlocked()) {
      return
    }
    this.findTouched = true
    const wasOpen = this.findOpen
    // #238 面板打开：选项条让位（UI 互斥——面板在场时由面板开关闪烁承担
    // 选项提示），选词会话结束（下一次 Ctrl+D 按面板态重新决策）
    this.endOccurrenceSession()
    let effective = query
    if (typeof effective !== 'string') {
      const seed = this.findSeedFromSelection()
      if (seed !== null) {
        effective = seed
      }
    }
    if (typeof effective === 'string' && effective !== this.findQuery) {
      this.findQuery = effective
      if (this.findInputEl) {
        this.findInputEl.value = effective
      }
      this.findDoc = null
      this.findRecompute(this.findReferencePos())
    } else {
      this.findEnsureFresh()
    }
    this.findOpen = true
    // #241 在选定内容中查找：真正打开（此前关闭）才复位范围——Ctrl+H 在
    // 已开面板上是"展开替换栏"语义，不得复位开启中的范围；用户选区锚点
    // 由 select 事务监听全程维护（跨开关），此处不重建
    if (!wasOpen) {
      this.findInSelection = false
      this.findRange = null
    }
    // 冗余防御（2026-10）：带 replace 的入口已在 case 守卫与键位 mode 过滤
    // 处收窄到 live，此处条件正常路径恒与调用方语义一致
    if (opts.replace === true && this.viewMode === 'live') {
      this.findReplaceOpen = true
    }
    // 预置替换词：输入框同步（后续 runFindReplace 消费；findRender 只管
    // 显隐，值在装配件上）
    if (typeof opts.replacement === 'string') {
      this.findReplaceText = opts.replacement
      const input = this.findPanel?.querySelector<HTMLInputElement>(`.${FIND_CLASS_NAMES.replaceInput}`)
      if (input) {
        input.value = opts.replacement
      }
    }
    // 锚点先行：显示前同步 right（打开路径无变化事件，RO 落位靠这次主动
    // 测算），避免浮层以旧 right 闪现在视口右上角
    this.startOverlayAnchorWatch()
    this.findPanel?.classList.add(FIND_CLASS_NAMES.open)
    this.findRender()
    this.findLocate()
    const el = this.findInputEl
    if (el) {
      el.focus()
      el.select()
    }
  }

  /** 关闭查找：清空装饰与阅读高亮，归还焦点（live → CM6；reading → 失焦输入框） */
  private closeFind(): void {
    if (!this.findOpen) {
      return
    }
    this.findOpen = false
    this.findReplaceOpen = false
    this.resetFindInSelection(false)
    this.findPanel?.classList.remove(FIND_CLASS_NAMES.open)
    this.findMatches = []
    this.findIndex = 0
    // 关闭即失效文档快照：重开同查询也按全新会话重算（旧实现保留引用，
    // freshness 判定跳过重算，重开后计数残留为 0）
    this.findDoc = null
    // 纯 effect 事务：不带 changes，无编辑历史、无出站
    this.view?.dispatch({ effects: setFindMatches.of({ matches: [], index: 0 }) })
    this.readingView?.highlightMatches([], 0)
    if (this.viewMode === 'live') {
      this.view?.focus()
    } else {
      this.findInputEl?.blur()
    }
    // 面板退出即断锚点观察（选项条与面板互斥，此处会话必不在场；判定式
    // 兜底防未来互斥关系变化）
    this.stopOverlayAnchorWatchIfIdle()
  }

  /** 在选定内容中查找开关（#241 资产接线）：开启 = 捕获当前主选区（非空）
   *  为范围并重算（匹配限内）；关闭 = 清范围重算回全量。开启前提是 live
   *  且有活动选区（禁用态由 findRender 维护，此处防御性再判） */
  private toggleFindInSelection(): void {
    const view = this.view
    if (!view || this.viewMode !== 'live') {
      return
    }
    if (this.findInSelection) {
      this.findInSelection = false
      this.findRange = null
    } else {
      // 范围捕获以最近一次用户选区为准（findLocate 的定位选区是查找自身
      // 产物，不得作为范围来源）
      const anchor = this.findSelectionAnchor
      if (!anchor || anchor.to <= anchor.from) {
        return
      }
      this.findInSelection = true
      this.findRange = { ...anchor }
    }
    this.findDoc = null
    this.findRecompute(this.findReferencePos())
    this.findRender()
    this.findLocate()
  }

  /** 复位「在选定内容中查找」（关闭面板 / 进入阅读：面板局部态不跨会话）。
   *  锚点由 select 事务监听全程维护（跨面板开关），此处不清——重开面板
   *  时 ☰ 的可用性仍反映「最近一次用户选区」；进入阅读时全清（阅读无
   *  选区交互语义） */
  private resetFindInSelection(clearAnchor: boolean): void {
    this.findInSelection = false
    this.findRange = null
    if (clearAnchor) {
      this.findSelectionAnchor = null
    }
  }

  /** 范围过滤（开启时命中必须完整落在范围内；闭区间语义 [from, to]） */
  private findMatchesIn<T extends { from: number; to: number }>(matches: readonly T[]): T[] {
    const range = this.findRange
    if (!this.findInSelection || !range) {
      return matches as T[]
    }
    return matches.filter((m) => m.from >= range.from && m.to <= range.to)
  }

  /** 循环导航（上一项/下一项）：步进后重绘并定位到新当前匹配 */
  private findStep(direction: 'next' | 'prev'): void {    if (!this.findOpen || this.embedFocusBlocked()) {
      return
    }
    this.findEnsureFresh()
    const n = this.findMatches.length
    if (n === 0) {
      return
    }
    this.findIndex = (this.findIndex + (direction === 'next' ? 1 : n - 1)) % n
    this.findRender()
    this.findLocate()
  }

  /** 匹配参考位置：live 取光标主位；reading 取当前锚点（源码位置语义） */
  private findReferencePos(): number {
    if (this.viewMode === 'reading') {
      return this.modeAnchor ?? 0
    }
    return this.view?.state.selection.main.from ?? 0
  }

  /** 成型头区排除（#236 批次已定边界：搜索不进入头区）：成型 frontmatter
   *  以只读表格呈现、源文本不可见，命中无落点；降级/无头区不排除 */
  private findExcludeEnd(): number {
    const model = this.view?.state.field(liveDecorationsField, false)?.fmModel ?? null
    return model ? model.closeTo + 1 : 0
  }

  /** 无条件重算匹配集（查询/选项变化路径）：当前匹配取参考位置后首个 */
  private findRecompute(ref: number): void {
    const doc = this.view?.state.doc
    this.findDoc = doc ?? null
    this.findValid = isFindQueryValid(this.findQuery, this.findOptions)
    this.findMatches =
      doc && this.findValid
        ? this.findMatchesIn(computeFindMatches(
            doc.toString(), this.findQuery, this.findOptions, this.findExcludeEnd()))
        : []
    this.findIndex = matchIndexFrom(this.findMatches, ref)
  }

  /** 按需重算（导航/渲染前调用）：文档未变化时零开销；
   *  变化后以旧当前匹配位置为参考就近保持（版本失效策略） */
  private findEnsureFresh(): void {
    const doc = this.view?.state.doc
    if (!doc || doc === this.findDoc) {
      return
    }
    const prevFrom = this.findMatches[this.findIndex]?.from
    this.findRecompute(prevFrom ?? this.findReferencePos())
  }

  /** 计数文案（VSCode 形态）：「第 n 项，共 total 项」；查询非空而零命中
   *  （含非法正则）显示「无结果」，空查询无计数反馈（原生同款留白）。
   *  findRender 的状态刷新与 bindLocaleFn 的换包重刷共用同一求值，杜绝
   *  双写漂移 */
  private findCountText(): string {
    if (this.findQuery === '') {
      return ''
    }
    const total = this.findMatches.length
    if (total === 0) {
      return t('find.noResults')
    }
    return t('find.count', { n: this.findIndex + 1, total })
  }

  /** 重绘可观测状态：live 装饰效应、计数文本、开关按钮态、替换行显隐、
   *  阅读命中块（不改滚动位置） */
  private findRender(): void {
    this.view?.dispatch({
      effects: setFindMatches.of({
        matches: this.findMatches,
        index: this.findIndex,
        selectionRange: this.findInSelection ? this.findRange : null,
      }),
    })
    const total = this.findMatches.length
    if (this.findCountEl) {
      this.findCountEl.textContent = this.findCountText()
      // 空态类仅在「查询非空而零命中」时点亮（空查询是未搜索，不是无结果）
      this.findCountEl.classList.toggle(
        FIND_CLASS_NAMES.countEmpty, total === 0 && this.findQuery !== '')
      // 空查询整体收起（未搜索不预留「当前/总数」空白——min-width 不占位）
      this.findCountEl.classList.toggle(
        FIND_CLASS_NAMES.countHidden, this.findQuery === '')
    }
    // 非法正则可见反馈：输入框红边 + 悬停提示（不崩、计数显示「无结果」）；
    // 空查询不算非法（未搜索，不给红边）。#300 起悬停词承载于 data-tooltip
    const invalid = this.findOpen && this.findQuery !== '' && !this.findValid
    if (this.findInputEl) {
      this.findInputEl.classList.toggle(FIND_CLASS_NAMES.inputInvalid, invalid)
      if (invalid) this.findInputEl.setAttribute('data-tooltip', t('find.invalid'))
      else this.findInputEl.removeAttribute('data-tooltip')
    }
    // 三开关按钮态：active 类与 aria-pressed 同步表示「选项开启」
    const syncToggle = (
      btn: HTMLButtonElement | undefined, activeCls: string, on: boolean,
    ): void => {
      btn?.classList.toggle(activeCls, on)
      btn?.setAttribute('aria-pressed', String(on))
    }
    syncToggle(this.findCaseBtnEl, FIND_CLASS_NAMES.caseActive, this.findOptions.matchCase)
    syncToggle(this.findWordBtnEl, FIND_CLASS_NAMES.wordActive, this.findOptions.wholeWord)
    syncToggle(this.findRegexpBtnEl, FIND_CLASS_NAMES.regexpActive, this.findOptions.regexp)
    // 在选定内容中查找：点亮态 + 禁用态（无用户选区锚点时禁用；开启中
    // 保持可用——导航选区即当前匹配，不能因它禁用）
    if (this.findInSelectionBtnEl) {
      const btn = this.findInSelectionBtnEl
      btn.classList.toggle(FIND_CLASS_NAMES.inSelectionActive, this.findInSelection)
      btn.setAttribute('aria-pressed', String(this.findInSelection))
      btn.disabled = !this.findInSelection &&
        (this.viewMode !== 'live' || this.findSelectionAnchor === null)
    }
    // 替换行显隐与 toggle 禁用（2026-10 阅读模式整体禁用替换——行恒收起、
    // toggle disabled 灰化；live 展开记忆 findReplaceOpen 不被触碰，回
    // live 原样恢复）；aria-expanded 与展开态同步
    const replaceVisible = this.findReplaceOpen && this.viewMode === 'live'
    this.findReplaceRowEl?.classList.toggle(FIND_CLASS_NAMES.replaceOpen, replaceVisible)
    this.findToggleEl?.setAttribute('aria-expanded', String(replaceVisible))
    if (this.findToggleEl) {
      this.findToggleEl.disabled = this.viewMode !== 'live'
    }
    if (this.readingView) {
      this.readingView.highlightMatches(
        this.viewMode === 'reading' && this.findOpen ? this.findMatches : [], this.findIndex)
    }
  }

  /** 替换执行（#236：显式写操作；#241 评审修复 P0-2 改自研）：匹配集与
   *  查找同源（computeFindReplaceMatches：同引擎、同成型头区排除、同码
   *  点过滤），官方 replaceNext/replaceAll 因内部 query.matchAll/
   *  nextMatch 全文扫描会改写成型头区源文本而退役（面板 0 命中时「全部
   *  替换」仍写回头区，违反批次规格「搜索替换不进入头区」）。推进语义
   *  与官方命令同构（planReplaceNext：未覆盖先选中、替换后移到下一处含
   *  wrap；$n 组展开复用官方引擎 getReplacement）。单次 dispatch = 单笔
   *  edit.request = 宿主撤销一次（next 一笔、all 整批一笔——粒度契约与
   *  官方命令一致），事务走 updateListener 的标准出站链路（暂停态与
   *  live 输入同语义）；仅 live（阅读只读）；无效 query 不执行 */
  private runFindReplace(op: 'next' | 'all'): void {
    const view = this.view
    if (!this.findOpen || !view || this.viewMode !== 'live') {
      return
    }
    if (!this.findValid) {
      return
    }
    const matches = this.findMatchesIn(computeFindReplaceMatches(
      view.state.doc.toString(),
      this.findQuery,
      this.findOptions,
      this.findReplaceText,
      this.findExcludeEnd(),
    ))
    if (op === 'all') {
      // 整批单事务：排除后匹配集逐条生成变更（precise 过滤与官方
      // replaceAll 同款——归一化劈开的命中不整段改写），一次 dispatch
      const changes: { from: number; to: number; insert: string }[] = []
      for (const m of matches) {
        if (!m.precise) {
          continue
        }
        changes.push({ from: m.from, to: m.to, insert: m.replacement })
      }
      if (changes.length === 0) {
        return
      }
      view.dispatch({ changes, userEvent: 'input.replace.all' })
    } else {
      const plan = planReplaceNext(
        matches,
        view.state.selection.main.from,
        view.state.selection.main.to,
      )
      if (plan.selectIndex < 0) {
        return
      }
      const changes: { from: number; to: number; insert: string }[] = []
      if (plan.replaceIndex >= 0) {
        const m = matches[plan.replaceIndex]!
        changes.push({ from: m.from, to: m.to, insert: m.replacement })
      }
      // 选区落点随变更映射（官方 replaceNext 的 map(changeSet) 同构：
      // 替换发生在落点之前时位移补偿，wrap 回文档头也正确）
      const changeSet = view.state.changes(changes)
      const target = matches[plan.selectIndex]!
      const selection = EditorSelection.single(target.from, target.to).map(changeSet)
      view.dispatch({ changes: changeSet, selection, userEvent: 'input.replace' })
    }
    // 替换改变了文档：以新选区（next 已移到下一处）为参考重算并重绘
    const ref = op === 'next' ? view.state.selection.main.from : this.findReferencePos()
    this.findRecompute(ref)
    this.findRender()
    this.findLocate()
  }

  /** 定位当前匹配（屏外内容同样定位；与视口/模式位置恢复协同）：
   *  live → 选区+滚动（事务不带 changes）；reading → 源位置锚点映射到块、
   *  滚动挂载目标并施加命中高亮 */
  private findLocate(): void {
    const cur = this.findMatches[this.findIndex]
    if (!cur) {
      return
    }
    this.modeAnchor = cur.from
    if (this.viewMode === 'reading' && this.readingView) {
      const start = this.readingView.anchorStartFor(this.clampToDoc(cur.from)) ?? cur.from
      this.modeAnchor = start
      this.readingView.scrollToSrcStart(start)
      this.readingView.highlightMatches(this.findMatches, this.findIndex)
      // 定位意图重申：滚动事件（异步，含 clamp 后的视口读数）触发的锚点
      // 更新不得覆盖查找定位——帧+宏任务后（滚动事件突发期之后）重申目标
      // 锚点；同一窗口内的用户滚动会被覆盖（一帧内，定位优先）
      scheduleFrame(() => {
        setTimeout(() => {
          if (this.findOpen && this.viewMode === 'reading') {
            const c2 = this.findMatches[this.findIndex]
            if (c2 === cur) {
              this.modeAnchor = start
            }
          }
        }, 0)
      })
    } else {
      if (this.view) selectTableRegion(this.view, null)
      this.view?.dispatch({
        selection: { anchor: cur.from, head: cur.to },
        effects: EditorView.scrollIntoView(cur.from, { y: 'center' }),
      })
    }
  }

  /** view.state 查找观测（#14；#236 起三开关/替换栏/有效性）：首次打开后回报（含关闭态） */
  private collectFindProbe(): FindSessionProbe | undefined {
    if (!this.findTouched) {
      return undefined
    }
    const cur = this.findMatches[this.findIndex]
    return {
      open: this.findOpen,
      query: this.findQuery,
      matchCase: this.findOptions.matchCase,
      wholeWord: this.findOptions.wholeWord,
      regexp: this.findOptions.regexp,
      valid: this.findValid,
      inSelection: this.findInSelection,
      replaceOpen: this.findReplaceOpen && this.viewMode === 'live',
      total: this.findMatches.length,
      index: this.findMatches.length > 0 ? this.findIndex + 1 : 0,
      currentFrom: cur?.from ?? null,
      currentTo: cur?.to ?? null,
    }
  }

  // ---- #238 选下一处相同词（Ctrl+D 族）与查找选项条 ----
  // 匹配语义（nextOccurrence 纯函数单一事实源，对齐 VSCode 1.86.2
  // MultiCursorSession.create）：面板开且词非空沿用面板三开关；面板未开
  // + 无选区以 override 档（敏感+全字）种子选词；面板未开 + 有选区沿用
  // 面板开关记忆档、选区文本为搜索词。会话档在创建时决定、存续期间沿用；
  // 选项条（用户决策：每次按下直接打开的三按钮迷你条）非模态——不抢
  // 编辑器焦点、不占 popupMutex 模态槽位（无互斥、无 Esc 插队，其 Esc
  // 在 find 面板之后消费一次）

  /** 查找选项条 DOM：仅三开关按钮（Aa/ab/.*），无搜索框无计数。按钮态
   *  与主面板开关同源（aria-pressed = this.findOptions）；mousedown
   *  preventDefault 保编辑器焦点（点击开关不算失焦，会话不被打断） */
  private buildOccurrenceBar(): HTMLElement {
    const bar = document.createElement('div')
    bar.className = OCCURRENCE_CLASS_NAMES.bar
    bindLocale(bar, 'aria-label', 'find.optionsBar')
    const mkToggle = (
      cls: string, icon: string, key: 'find.matchCase' | 'find.wholeWord' | 'find.regexp',
      flip: (o: FindOptions) => FindOptions,
    ): HTMLButtonElement => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = cls
      b.textContent = icon
      bindLocale(b, 'aria-label', key)
      bindLocale(b, 'title', key)
      b.addEventListener('mousedown', (e) => e.preventDefault())
      b.addEventListener('click', () => {
        this.findOptions = flip(this.findOptions)
        // 会话按新档重建（选项条保持在场；全选型立即重选全部）后经
        // findOptions.set 上送宿主持久化（与面板开关同一通道）
        this.rebuildOccurrenceSessionAfterOptionChange()
        this.bridge.postMessage({ kind: 'findOptions.set', options: { ...this.findOptions } })
      })
      return b
    }
    this.occurrenceCaseBtnEl = mkToggle(OCCURRENCE_CLASS_NAMES.caseToggle, 'Aa', 'find.matchCase',
      (o) => ({ ...o, matchCase: !o.matchCase }))
    this.occurrenceWordBtnEl = mkToggle(OCCURRENCE_CLASS_NAMES.wordToggle, 'ab', 'find.wholeWord',
      (o) => ({ ...o, wholeWord: !o.wholeWord }))
    this.occurrenceRegexpBtnEl = mkToggle(OCCURRENCE_CLASS_NAMES.regexpToggle, '.*', 'find.regexp',
      (o) => ({ ...o, regexp: !o.regexp }))
    bar.appendChild(this.occurrenceCaseBtnEl)
    bar.appendChild(this.occurrenceWordBtnEl)
    bar.appendChild(this.occurrenceRegexpBtnEl)
    return bar
  }

  /** 选项条按钮态同步（与主面板开关同源——aria-pressed = this.findOptions） */
  private syncOccurrenceBarDom(): void {
    const sync = (btn: HTMLButtonElement | undefined, activeCls: string, on: boolean): void => {
      btn?.classList.toggle(activeCls, on)
      btn?.setAttribute('aria-pressed', String(on))
    }
    sync(this.occurrenceCaseBtnEl, OCCURRENCE_CLASS_NAMES.caseActive, this.findOptions.matchCase)
    sync(this.occurrenceWordBtnEl, OCCURRENCE_CLASS_NAMES.wordActive, this.findOptions.wholeWord)
    sync(this.occurrenceRegexpBtnEl, OCCURRENCE_CLASS_NAMES.regexpActive, this.findOptions.regexp)
  }

  /** 会话在场即显示选项条（每次 Ctrl+D 按下都会走到；主面板打开时改走
   *  flashFindToggles，本方法不被调用——UI 互斥） */
  private showOccurrenceBar(): void {
    this.startOverlayAnchorWatch()
    this.occurrenceBarEl?.classList.add(OCCURRENCE_CLASS_NAMES.barOpen)
    this.syncOccurrenceBarDom()
  }

  /** 结束会话：簿记清空、选项条淡出（选区保持——多光标收敛交给 CM6）；
   *  #251 命中显形：会话选区退出活跃命中集（纯 effect 事务零写回；清空
   *  瞬间选区仍触界的旧显形行由 hitRevealField 的停驻机制接管） */
  private endOccurrenceSession(): void {
    const had = this.occurrenceSession !== null
    this.occurrenceSession = null
    this.occurrenceBarEl?.classList.remove(OCCURRENCE_CLASS_NAMES.barOpen)
    if (had) {
      this.view?.dispatch({ effects: setOccurrenceHitActive.of(false) })
      this.stopOverlayAnchorWatchIfIdle()
    }
  }

  // ---- 2026-10 浮层锚点跟随（方法组）：测算与观察管理 ----

  /** 锚点测量源：当前模式的正文列元素。live 为 .cm-content——#175 整组
   *  居中单位是 [行号列+间距+正文列]，contentDOM 的右缘即正文列真实右缘；
   *  reading 只认限宽块（margin auto 居中，任意块右缘一致）——视口占位
   *  spacer 是 margin 0 靠左的高度占位条，右缘与限宽块差整个右侧留白，
   *  不得作为测量源（review B-1）；空文档/无挂载块降级容器（铺满语义，
   *  right 落保底 14px） */
  private overlayAnchorContentEl(): HTMLElement | null {
    if (this.viewMode === 'reading') {
      const block = this.readingContainer?.querySelector<HTMLElement>('.vsidian-reading-block')
      return block ?? this.readingContainer ?? null
    }
    return this.view?.contentDOM ?? null
  }

  /** 按当前几何同步两个浮层的 style.right（两浮层互斥在场，同值都写无妨；
   *  值未变化时跳过——编辑事务路径每键调用，同字符串赋值也会失效 inline
   *  style 触发下一帧重算，短路消除） */
  private syncOverlayAnchors(): void {
    const root = this.rootEl
    const contentEl = this.overlayAnchorContentEl()
    if (!root || !contentEl) {
      return
    }
    const right = planOverlayAnchorRight({
      appRight: root.getBoundingClientRect().right,
      contentRight: contentEl.getBoundingClientRect().right,
    })
    const value = `${right}px`
    if (this.findPanel && this.findPanel.style.right !== value) {
      this.findPanel.style.right = value
    }
    if (this.occurrenceBarEl && this.occurrenceBarEl.style.right !== value) {
      this.occurrenceBarEl.style.right = value
    }
  }

  /** 浮层任一在场时开观察：先主动同步一次（稳态打开时无变化事件可等），
   *  再挂 ResizeObserver——侧栏开合是 CSS transition，过渡期间 main 宽度
   *  每帧变化即逐帧回调，稳态零触发零开销 */
  private startOverlayAnchorWatch(): void {
    this.syncOverlayAnchors()
    if (this.overlayAnchorObserver || typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver(() => this.syncOverlayAnchors())
    this.overlayAnchorObserver = observer
    this.observeOverlayAnchorTargets(observer)
  }

  /** 挂观察目标：main 恒观察（侧栏开合/窗口缩放），正文列元素跟随观察
   *  （行宽设置变更时 main 宽不变、仅列宽变，漏观察即失准） */
  private observeOverlayAnchorTargets(observer: ResizeObserver): void {
    if (this.mainEl) {
      observer.observe(this.mainEl)
    }
    const contentEl = this.overlayAnchorContentEl()
    if (contentEl) {
      observer.observe(contentEl)
    }
  }

  /** 模式切换后重挂目标并重同步（测量源随模式换元素；查找会话跨模式保活
   *  时调用；选词会话不跨模式，无需） */
  private refreshOverlayAnchorWatch(): void {
    if (!this.overlayAnchorObserver) {
      return
    }
    this.overlayAnchorObserver.disconnect()
    this.observeOverlayAnchorTargets(this.overlayAnchorObserver)
    this.syncOverlayAnchors()
  }

  /** 两个浮层都不在场即断开观察（幂等；面板/会话互斥但都判一遍） */
  private stopOverlayAnchorWatchIfIdle(): void {
    if (this.findOpen || this.occurrenceSession) {
      return
    }
    this.overlayAnchorObserver?.disconnect()
    this.overlayAnchorObserver = null
  }

  /** 开关切换后的会话重建（用户决策「切换即按新选项重建会话」，选项条
   *  在场不打断）：add 型以当前选区为种子换新档；all 型立即按新档重选
   *  全部；无会话/无法重建则结束（淡出） */
  private rebuildOccurrenceSessionAfterOptionChange(): void {
    this.syncOccurrenceBarDom()
    const session = this.occurrenceSession
    if (!session) {
      return
    }
    if (session.kind === 'all') {
      // 全选型：选区本就是命令产物，重建 = 直接按新档重选全部
      this.endOccurrenceSession()
      this.runOccurrenceSelect('all')
      return
    }
    const view = this.view
    if (!view || this.viewMode !== 'live') {
      this.endOccurrenceSession()
      return
    }
    const text = view.state.doc.toString()
    const selection = this.occurrenceSelection()
    const decided = resolveOccurrenceSeed({
      panelOpen: this.findOpen,
      panelQuery: this.findQuery,
      panelOptions: this.findOptions,
      text,
      selection,
      wordAt: (pos) => this.occurrenceWordAt(pos),
    })
    if (decided === null || decided === 'inconsistent') {
      this.endOccurrenceSession()
      return
    }
    this.occurrenceSession = { kind: 'add', seed: decided, ranges: view.state.selection.ranges }
  }

  /** 当前选区（OccurrenceRange 形态；OccurrenceSeed/计划函数输入） */
  private occurrenceSelection(): OccurrenceRange[] {
    const view = this.view
    if (!view) {
      return []
    }
    return view.state.selection.ranges.map((range) => ({ from: range.from, to: range.to }))
  }

  /** CM6 词边界适配（wordAt 注入；pos 所在词或 null） */
  private occurrenceWordAt(pos: number): OccurrenceRange | null {
    const word = this.view?.state.wordAt(pos)
    return word ? { from: word.from, to: word.to } : null
  }

  /** 主面板打开时的替代提示：闪烁「生效档与面板显示脱节」的开关按钮
   *  （VSCode highlightFindOptions 语义——面板开 + 词非空时生效档 = 面板
   *  档，无脱节不闪；词空空选区时 override 档与面板记忆可能脱节） */
  private flashFindToggles(effective: FindOptions): void {
    const buttons: Array<[HTMLButtonElement | undefined, boolean]> = [
      [this.findCaseBtnEl, effective.matchCase !== this.findOptions.matchCase],
      [this.findWordBtnEl, effective.wholeWord !== this.findOptions.wholeWord],
      [this.findRegexpBtnEl, effective.regexp !== this.findOptions.regexp],
    ]
    let flashed = false
    for (const [btn, diverged] of buttons) {
      if (!diverged) {
        continue
      }
      btn?.classList.remove(FIND_CLASS_NAMES.flash)
      btn?.classList.add(FIND_CLASS_NAMES.flash)
      flashed = true
    }
    if (this.findFlashTimer) {
      clearTimeout(this.findFlashTimer)
    }
    if (flashed) {
      // 短促在场后移除（连按时重启：先移除再加类，CSS 动画重放）
      this.findFlashTimer = setTimeout(() => {
        this.findCaseBtnEl?.classList.remove(FIND_CLASS_NAMES.flash)
        this.findWordBtnEl?.classList.remove(FIND_CLASS_NAMES.flash)
        this.findRegexpBtnEl?.classList.remove(FIND_CLASS_NAMES.flash)
      }, 450)
    }
  }

  /** #238 命令族执行体（快捷键本地分支与 ui.command 两入口共用）：
   *  会话在场则沿用会话档（VSCode 会话语义——档与种子词不随选区漂移）；
   *  否则按面板/选区状态决策种子；多选区文本不一致时只扩词不加选。
   *  生效（选区变化）才会话簿记 + 选项条/面板闪烁呈现 */
  private runOccurrenceSelect(op: 'next' | 'prev' | 'skip' | 'all'): void {
    // P2-10：选词会话（选项条/命中显形）绑定主编辑器——焦点在嵌入内部
    // Live 内时不执行（不落 A；会话实例化属后续票）
    if (this.embedFocusBlocked()) {
      return
    }
    const view = this.view
    if (!view || this.viewMode !== 'live' || this.suspended) {
      return
    }
    const text = view.state.doc.toString()
    const selection = this.occurrenceSelection()
    const excludeEnd = this.findExcludeEnd()
    let seed: OccurrenceSeed | null = this.occurrenceSession?.seed ?? null
    if (!seed) {
      const decided = resolveOccurrenceSeed({
        panelOpen: this.findOpen,
        panelQuery: this.findQuery,
        panelOptions: this.findOptions,
        text,
        selection,
        wordAt: (pos) => this.occurrenceWordAt(pos),
      })
      if (decided === null) {
        return
      }
      if (decided === 'inconsistent') {
        // 多选区文本不一致（按会话 matchCase 比较）：不加选，把各空光标
        // 扩为词（无空光标则无操作）；不建会话不显示选项条
        const plan = planExpandWords(selection, (pos) => this.occurrenceWordAt(pos))
        this.dispatchOccurrencePlan(plan)
        return
      }
      seed = decided
    }
    const wordAt = (pos: number) => this.occurrenceWordAt(pos)
    const plan: OccurrencePlan = op === 'next'
      ? planSelectNext(text, selection, seed, excludeEnd, wordAt)
      : op === 'prev'
        ? planSelectPrevious(text, selection, seed, excludeEnd, wordAt)
        : op === 'skip'
          ? planSkipCurrent(text, selection, seed, excludeEnd, wordAt)
          : planSelectAllOccurrences(text, selection, seed, excludeEnd, wordAt)
    if (!this.dispatchOccurrencePlan(plan)) {
      return
    }
    // 会话簿记（命令产物选区快照；updateListener 见 occurrenceCmd 注解
    // 跳过结束检测）与呈现（面板开时闪烁，否则选项条在场）。
    // #251 命中显形：会话在场即选区计入活跃命中集（纯 effect 事务零写回；
    // 幂等——会话续期时 field 值无实质变化不触发下游重建）
    this.occurrenceSession = {
      kind: op === 'all' ? 'all' : 'add',
      seed,
      ranges: view.state.selection.ranges,
    }
    this.view?.dispatch({ effects: setOccurrenceHitActive.of(true) })
    if (this.findOpen) {
      this.flashFindToggles(seed.options)
    } else {
      this.showOccurrenceBar()
    }
  }

  /** 计划落地：CM6 选区事务（occurrenceCmd 注解 + 主光标滚动跟随）。
   *  返回是否实际生效（none 不派发不算按下生效——不显示选项条） */
  private dispatchOccurrencePlan(plan: OccurrencePlan): boolean {
    const view = this.view
    if (plan.kind !== 'select' || !view || !plan.ranges.length) {
      return false
    }
    const ranges = plan.ranges.map((range) => EditorSelection.range(range.from, range.to))
    const mainIndex = Math.min(Math.max(plan.mainIndex, 0), ranges.length - 1)
    view.dispatch({
      selection: EditorSelection.create(ranges, mainIndex),
      annotations: occurrenceCmd.of({ occurrence: true }),
      effects: EditorView.scrollIntoView(ranges[mainIndex]!.from, { y: 'center' }),
    })
    return true
  }

  /** #238 选词会话观测（view.state）：选项条在场（= 会话在场）与三开关
   *  按钮态（与 findOptions 同源；override 会话档不在此暴露——按钮显示
   *  的始终是面板开关记忆档） */
  private collectOccurrenceProbe(): OccurrenceProbe {
    return {
      barOpen: this.occurrenceSession !== null,
      matchCase: this.findOptions.matchCase,
      wholeWord: this.findOptions.wholeWord,
      regexp: this.findOptions.regexp,
    }
  }


  // ---- 行号栏（#34）----

  /**
   * CSS 片段装载成功后的测量唤醒（#128）：外部样式表落地可能改变行高/
   * 字号，live 侧 CM6 视口需要被重新测量（样式变化不产生 CM6 事务，视口
   * 不会自行重排）。立即一次 + 下一帧一次（字体类变更的排版常在帧间才
   * 稳定）。阅读侧无需在此处理：ResizeObserver → measureAndStabilize
   * 管线按块实测回填并做滚动锚定（#7/#59/#60 反复验证的机制）。
   */
  private scheduleSnippetMeasure(): void {
    this.view?.requestMeasure()
    requestAnimationFrame(() => this.view?.requestMeasure())
  }

  /**
   * #130 字体晚到的补测：片段里的 @font-face（本地或 https 远程字体）在
   * <link> load 事件之后才异步装载完成——上方即时重测可能早于字体生效，
   * 行高/字号稳定后的视口测量与滚动锚定需要再补一轮。以 document.fonts
   * .ready 为稳定时机（字体装载失败同样 settle——此时按备用字体重测，
   * 正文可读即达成；错误面见 fontArrival 模块头）。live 侧重测 CM6 视口，
   * 阅读侧显式 updateNow 走 measureAndStabilize 锚定补偿（RO 对挂载块
   * 的尺寸回调是兜底路径，显式调用保证高度表回填必然执行）。
   */
  private scheduleSnippetMeasureOnFontArrival(): void {
    if (!this.snippetFontArrival) {
      this.snippetFontArrival = createFontArrivalWatch(
        () => document.fonts ?? undefined,
        () => {
          this.scheduleSnippetMeasure()
          this.readingView?.updateNow()
        },
      )
    }
    this.snippetFontArrival.schedule()
  }

  /**
   * 应用分词引擎设置（#239；settings 快照与 wordSegment.state 任一到达
   * 时汇流重算）：引擎选择读设置快照（缺键/非法回 builtin），jieba 资源
   * 由 wordSegment.state 维护。engine=jieba 且资源在场时 wordMotion 按
   * 需异步加载（加载完成前命令同步回退 builtin；失败回报宿主通知）。
   */
  private applyWordSegmentEngineSetting(): void {
    const raw = this.settings?.[WORD_SEGMENT_ENGINE_KEY]
    const engine = raw === 'jieba' ? 'jieba' : WORD_SEGMENT_ENGINE_DEFAULT
    configureWordSegment({
      engine,
      resources: this.wordSegmentResources,
      onReportLoadResult: (ok, detail) => {
        if (!ok) {
          this.bridge.postMessage({ kind: 'wordSegment.loadResult', ok: false, detail })
        }
      },
    })
  }

  /** #239 词级移动命令执行口：仅 Live 正文（router 的 writes 门控已限焦
   *  点域；阅读模式只读静默不接管，与格式命令同口径。P2-10 起焦点在嵌入
   *  内部 Live 内时目标为 B（词移动作用于目标实例选区） */
  private runWordMotion(command: (view: EditorView) => boolean): void {
    const resolved = this.actionTarget()
    if (resolved && this.targetEditable(resolved.view, resolved.embed)) {
      command(resolved.view)
    }
  }

  /**
   * 应用可读行宽设置（#175；settings.snapshot / settings.changed 到达时）：
   * - 非 0 档：把两模式限宽变量（--vsidian-reading-max-width /
   *   --vsidian-live-preview-max-width，定义于 #app 层，见 main.css）以
   *   内联形式写到挂载根元素——优先序两级：根级片段（同元素/祖先声明）
   *   需 !important 覆盖；按视图作用域声明的后代级片段继承链更近、常规
   *   规则即可生效（两模式差异化定制路径）
   * - 0 档（铺满，默认）：移除内联，变量落回 CSS 缺省 none——产品零
   *   干预，片段全层级可定制（Q7/Q8 共识）
   * - 避让与居中由 CSS 层自动完成（min(设定宽, 可用宽) + 主区动态居中），
   *   此处仅落值；宽度变化后补 CM6 视口测量（重排不产生 CM6 事务，
   *   与 scheduleSnippetMeasure 同因）
   * - 缺键/越界/非数值回默认 0，非法形态不写值（协议是宽标量容器，
   *   类型语义校验归宿主，webview 侧防御——与其他设置应用器一致）
   */
  private applyReadableLineWidthSetting(): void {
    const raw = this.settings?.[READABLE_LINE_WIDTH_KEY]
    const px = typeof raw === 'number' && Number.isFinite(raw) &&
      raw > READABLE_LINE_WIDTH_MIN && raw <= READABLE_LINE_WIDTH_MAX
      ? raw
      : READABLE_LINE_WIDTH_DEFAULT
    const root = this.rootEl
    if (!root) {
      return // mount 前到达（防御）：快照必在 init 后回填，届时再落值
    }
    if (px === 0) {
      root.style.removeProperty('--vsidian-reading-max-width')
      root.style.removeProperty('--vsidian-live-preview-max-width')
    } else {
      root.style.setProperty('--vsidian-reading-max-width', `${px}px`)
      root.style.setProperty('--vsidian-live-preview-max-width', `${px}px`)
    }
    this.view?.requestMeasure()
    requestAnimationFrame(() => this.view?.requestMeasure())
  }

  /** #222 嵌入限高应用（settings.snapshot / settings.changed）：缺键/
   *  越界/非数值回默认（协议是宽标量容器，类型语义校验归宿主，webview 侧
   *  防御——与其他设置应用器一致）；遍历在场卡片热更内联 max-height */
  private applyEmbedMaxHeightSetting(): void {
    this.embedCards?.setMaxHeight(this.embedMaxHeightPx())
  }

  /** 嵌入限高当前值（设置投影；消费方 EmbedCardContext.maxHeightPx） */
  private embedMaxHeightPx(): number {
    const raw = this.settings?.[EMBED_MAX_HEIGHT_KEY]
    return typeof raw === 'number' && Number.isFinite(raw) &&
      raw >= EMBED_MAX_HEIGHT_MIN && raw <= EMBED_MAX_HEIGHT_MAX
      ? raw
      : EMBED_MAX_HEIGHT_DEFAULT
  }

  private embedMaxDepth(): number {
    const raw = this.settings?.[EMBED_MAX_DEPTH_KEY]
    return typeof raw === 'number' && Number.isInteger(raw) &&
      raw >= EMBED_MAX_DEPTH_MIN && raw <= EMBED_MAX_DEPTH_MAX
      ? raw : EMBED_MAX_DEPTH_DEFAULT
  }

  /** frontmatter 阅读块折叠装饰（挂载钩子与切换重装饰共用入口） */
  private decorateReadingFrontmatterBlock(block: HTMLElement): void {
    decorateReadingFrontmatterCard(block, {
      folded: this.readingFmFolded,
      onFoldToggle: () => {
        this.readingFmFolded = !this.readingFmFolded
        this.decorateReadingFrontmatterBlock(block)
      },
    })
  }

  /** #84 增强单个阅读代码块（挂载钩子与重装饰共用入口） */
  private decorateReadingCodeCardBlock(block: HTMLElement): void {
    if (!isReadingCodeBlock(block)) {
      return
    }
    const srcStart = Number(block.dataset['vsidianSrcStart'] ?? '-1')
    decorateReadingCodeCard(block, {
      config: this.live?.codeCardConfigSnapshot ?? {
        card: true, lineNumbers: true, copyButton: true, highlight: true,
      },
      folded: this.readingCodeFold.has(srcStart),
      onCopy: (code) => this.postCodeCopy(code),
      onFoldToggle: () => {
        if (!this.readingCodeFold.delete(srcStart)) {
          this.readingCodeFold.add(srcStart)
        }
        this.decorateReadingCodeCardBlock(block)
      },
      // #191 折行开关：按钮仅入口，状态在控制器（全文联动）；翻转后容器
      // 类增删 + 全部已挂载块头部重建（各块按钮态同步，pre 行为由容器类承担）
      wrap: this.readingCodeWrapOn,
      onWrapToggle: () => {
        this.readingCodeWrapOn = !this.readingCodeWrapOn
        this.applyReadingCodeWrap()
        this.decorateMountedReadingCodeCards()
      },
    })
    if (this.readingContainer?.contains(block)) this.readingView?.refreshFindHighlights(block)
  }

  /** #191 阅读折行容器类落位（幂等）：仅关闭态挂 vsidian-reading-nowrap，
   *  开启态移除（pre 回 pre-wrap 折行）；切回阅读/块重挂载路径经
   *  decorateMountedReadingCodeCards 每次补挂，容器生命周期内不丢失 */
  private applyReadingCodeWrap(): void {
    const container = this.readingContainer
    if (!container) {
      return
    }
    container.classList.toggle(READING_CODE_NOWRAP_CLASS, !this.readingCodeWrapOn)
  }

  /** #84 刷新全部已挂载阅读块的卡片形态（设置变更/切回阅读模式） */
  private decorateMountedReadingCodeCards(): void {
    // #191 顺路补挂折行容器类（幂等；容器重建/模式切换后状态不丢）
    this.applyReadingCodeWrap()
    this.readingContainer
      ?.querySelectorAll<HTMLElement>('.vsidian-reading-block')
      .forEach((el) => this.decorateReadingCodeCardBlock(el))
  }

  /** #81/#84 复制出站（Live effect 转发与阅读直连共用） */
  private postCodeCopy(text: string): void {
    if (this.sessionId) {
      this.bridge.postMessage({
        kind: 'codeblock.copy',
        sessionId: this.sessionId,
        docUri: this.docUri,
        text,
      })
    }
  }

  /** 行号栏观测（#34 view.state 扩展字段）。过滤 CM6 的隐藏测量探针
   *  单元格（visibility:hidden、用于测量 gutter 文本宽度的 dummy——真实
   *  宿主与 jsdom 均存在，不是行号） */
  private collectLineGutter(): LineGutterProbe {
    const view = this.view
    const lineNumbersOn = this.live?.lineNumbersEnabled ?? false
    if (!view || !lineNumbersOn) {
      return { on: lineNumbersOn, count: 0, first: null, last: null, alignment: null }
    }
    const texts = Array.from(
      view.dom.querySelectorAll(LINE_NUMBER_GUTTER_SELECTOR),
    )
      .filter((el) => (el as HTMLElement).style.visibility !== 'hidden')
      .map((el) => el.textContent ?? '')
    return {
      on: lineNumbersOn,
      count: texts.length,
      first: texts.length > 0 ? texts[0] : null,
      last: texts.length > 0 ? texts[texts.length - 1] : null,
      alignment: this.collectGutterAlignment(),
    }
  }

  /** #116 行号几何对齐采样：每条可见行号取两个口径的偏差——
   *  deltaBaseline（主口径）：数字基线 − 正文行首可见文本基线，由两侧
   *  底边差按各自 computed font 的 fontBoundingBox descent 换算（行号字号
   *  小于正文，底边重合 ≠ 基线重合，光学对齐以基线为准，|值| ≤ 1 视为
   *  对齐）；deltaBottom（次要上报）：底边差（旧基线代理口径，诊断对照）。
   *  依赖真实布局（getBoundingClientRect）与 canvas 2D：jsdom 未实现
   *  Range.getBoundingClientRect（调用即抛错），条目被逐条跳过、整体自然
   *  为空返回 null（非「rect 恒 0 被过滤」）；reading 态 live 容器隐藏或
   *  视口内无可见文本行时无可采条目，返回 null 与空文档的空数组区分。
   *  单条采样相互隔离（#116 flash 审查 F2）：真宿主中个别条目异常（如
   *  单条 Range 查询失败）只跳过该条，不再静默丢弃余下全部行。 */
  private collectGutterAlignment(): LineGutterAlignment[] | null {
    const view = this.view
    if (!view) return null
    const fontMetric = createFontBoundingBoxMeasurer()
    const out: LineGutterAlignment[] = []
    for (const element of Array.from(view.dom.querySelectorAll<HTMLElement>(LINE_NUMBER_GUTTER_SELECTOR))) {
      const entry = collectGutterEntryAlignment(view, element, fontMetric)
      if (entry) out.push(entry)
    }
    return out.length ? out : null
  }

  /**
   * 绘制层探针（P0 回归，语义见 protocol.ts PaintProbe）：首个含文本行的
   * 首字符命中测试落在内容区内（DOM 数量与几何坐标探针测不出的"真的
   * 可见"），附带 CM6 baseTheme 存活与行号禁选观测。
   */
  private collectPaint(): PaintProbe {
    const view = this.view
    const contentEl = view?.dom.querySelector<HTMLElement>('.cm-content')
    if (!view || !contentEl) {
      return {
        textVisible: false,
        scrollerDisplay: null,
        gutterUserSelect: null,
        darkTheme: false,
        caretColor: null,
      }
    }
    // elementFromPoint/几何 rect 依赖真实布局：jsdom（单测宿主）无布局能力
    // 且 elementFromPoint 缺失，任何异常都视为不可见（PaintProbe 语义注记：
    // jsdom 下 textVisible 恒 false，只作真宿主集成断言依据）
    let textVisible = false
    try {
      for (const line of Array.from(view.dom.querySelectorAll<HTMLElement>('.cm-line')).slice(0, 8)) {
        const tn = Array.from(line.getElementsByTagName('*'))
          .flatMap((el) => Array.from(el.childNodes))
          .find((n) => n.nodeType === 3 && (n.nodeValue ?? '').trim().length > 0)
        const direct = Array.from(line.childNodes).find(
          (n) => n.nodeType === 3 && (n.nodeValue ?? '').trim().length > 0,
        )
        const textNode = (tn ?? direct) as ChildNode | undefined
        if (!textNode || !textNode.nodeValue) {
          continue
        }
        const r = document.createRange()
        r.setStart(textNode as unknown as Node, 0)
        r.setEnd(textNode as unknown as Node, 1)
        const cr = r.getBoundingClientRect()
        if (cr.width <= 0 || cr.height <= 0) {
          continue
        }
        const hit = document.elementFromPoint(cr.x + cr.width / 2, cr.y + cr.height / 2)
        if (hit && contentEl.contains(hit)) {
          textVisible = true
          break
        }
      }
    } catch {
      textVisible = false
    }
    const guttersEl = view.dom.querySelector<HTMLElement>('.cm-gutters')
    const gridRow = view.contentDOM.querySelector<HTMLElement>('.vsidian-table-grid-row')
    const delimiterRow = view.contentDOM.querySelector<HTMLElement>('.vsidian-table-grid-delimiter')
    const headerRow = view.contentDOM.querySelector<HTMLElement>(
      '.vsidian-table-grid-row.vsidian-table-header-line')
    const headerCellBackgrounds = headerRow
      ? [...headerRow.querySelectorAll<HTMLElement>(':scope > .vsidian-table-grid-cell')]
        .map((cell) => getComputedStyle(cell).backgroundColor)
      : []
    // #213 数据行/分隔行行级背景探针：行身份 data 属性定位（分隔行同为
    // "row"，随数据行同透明，断言语义一致）；无网格行时为 null
    const dataRowLine = view.contentDOM.querySelector<HTMLElement>(
      '.vsidian-table-grid-row[data-vsidian-table-row="row"]')
    const dataRowLineBackground = dataRowLine
      ? getComputedStyle(dataRowLine).backgroundColor
      : null
    const firstCell = gridRow?.querySelector<HTMLElement>(':scope > .vsidian-table-grid-cell') ?? null
    const selectedRow = view.contentDOM.querySelector<HTMLElement>(
      '.vsidian-table-grid-row.vsidian-table-row-selected',
    )
    const selectedRowCell = selectedRow?.querySelector<HTMLElement>(':scope > .vsidian-table-grid-cell') ?? null
    const selectedColumnCell = view.contentDOM.querySelector<HTMLElement>(
      '.vsidian-table-grid-row > .vsidian-table-grid-cell.vsidian-table-column-selected',
    )
    const regionCells = view.contentDOM.querySelectorAll<HTMLElement>(
      '.vsidian-table-grid-row > .vsidian-table-grid-cell.vsidian-table-region-cell',
    )
    const regionCell = regionCells[0] ?? null
    const columnFirst = view.contentDOM.querySelector<HTMLElement>(
      '.vsidian-table-grid-row > .vsidian-table-grid-cell.vsidian-table-column-first',
    )
    const columnLast = view.contentDOM.querySelector<HTMLElement>(
      '.vsidian-table-grid-row > .vsidian-table-grid-cell.vsidian-table-column-last',
    )
    let cellVisible = false
    try {
      const cells = view.contentDOM.querySelectorAll<HTMLElement>('.vsidian-table-grid-cell')
      // 只取少量已挂载格做绘制命中；长表格的 view.state 不逐格测量。
      for (let index = 0; index < Math.min(cells.length, 12); index++) {
        const cell = cells[index]!
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
        let node: Node | null
        while ((node = walker.nextNode())) {
          const text = node.nodeValue ?? ''
          const at = text.search(/\S/)
          if (at < 0) continue
          const range = document.createRange()
          range.setStart(node, at)
          range.setEnd(node, at + 1)
          const rect = range.getBoundingClientRect()
          if (rect.width <= 0 || rect.height <= 0) continue
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
          if (hit && cell.contains(hit)) {
            cellVisible = true
            break
          }
        }
        if (cellVisible) break
      }
    } catch {
      // jsdom 无布局和 elementFromPoint；真宿主才能证明实际可见。
    }
    let caretGridColumn: number | null = null
    let caretDomColumn: number | null = null
    let caretNativeRectHeight: number | null = null
    try {
      const selection = window.getSelection()
      if (selection?.isCollapsed && selection.rangeCount > 0 &&
          selection.focusNode && view.contentDOM.contains(selection.focusNode)) {
        const rect = selection.getRangeAt(0).getBoundingClientRect()
        caretNativeRectHeight = rect.height
        const focusElement = selection.focusNode instanceof Element
          ? selection.focusNode : selection.focusNode.parentElement
        const domCell = focusElement?.closest<HTMLElement>(
          '.vsidian-table-grid-row > .vsidian-table-grid-cell')
        if (domCell?.parentElement) {
          caretDomColumn = [...domCell.parentElement.querySelectorAll(
            ':scope > .vsidian-table-grid-cell')].indexOf(domCell)
        }
        // 零宽格的 DOM Selection 锚在 .cm-content 上，浏览器给出 0×0 Range；
        // CM6 仍能按光标关联侧返回实际排版坐标。
        const point = rect.height > 0 ? rect : view.coordsAtPos(
          view.state.selection.main.head, view.state.selection.main.assoc || -1)
        if (point) {
          const hit = document.elementFromPoint(point.left + 1,
            (point.top + point.bottom) / 2)
          const cell = hit?.closest<HTMLElement>('.vsidian-table-grid-row > .vsidian-table-grid-cell')
          const row = cell?.parentElement
          if (cell && row) {
            caretGridColumn = [...row.querySelectorAll(':scope > .vsidian-table-grid-cell')].indexOf(cell)
          }
        }
      }
    } catch {
      // jsdom 无绘制位置；只有真实宿主可断言光标所在格。
    }
    const activeEmpty = view.contentDOM.querySelector<HTMLElement>('.vsidian-table-grid-empty-active')
    if (activeEmpty) {
      try {
        const rect = activeEmpty.getBoundingClientRect()
        const caretStyle = getComputedStyle(activeEmpty, '::after')
        const nativeCaret = getComputedStyle(contentEl).caretColor
        const hit = document.elementFromPoint(rect.left + 11, rect.top + 14)
        if (rect.width > 0 && rect.height > 0 &&
            Number.parseFloat(caretStyle.borderLeftWidth) > 0 &&
            (nativeCaret === 'transparent' || nativeCaret === 'rgba(0, 0, 0, 0)') &&
            hit && activeEmpty.contains(hit)) {
          const row = activeEmpty.parentElement
          if (row) caretGridColumn = [...row.querySelectorAll(':scope > .vsidian-table-grid-cell')]
            .indexOf(activeEmpty)
        }
      } catch {
        // 绘制探针不干预编辑状态。
      }
    }
    const cellStyle = firstCell ? getComputedStyle(firstCell) : null
    const rowStyle = selectedRow ? getComputedStyle(selectedRow) : null
    const rowCellStyle = selectedRowCell ? getComputedStyle(selectedRowCell) : null
    const columnStyle = selectedColumnCell ? getComputedStyle(selectedColumnCell) : null
    const columnFirstStyle = columnFirst ? getComputedStyle(columnFirst) : null
    const columnLastStyle = columnLast ? getComputedStyle(columnLast) : null
    const regionStyle = regionCell ? getComputedStyle(regionCell) : null
    // #55 标题行左缘绘制观测：视口内标题行（.vsidian-heading-inview）的
    // computed box-shadow / border-left-width distinct 集合——标题行不得
    // 绘制左缘竖线（真宿主应分别为 'none' / '0px'）；无挂载标题行为 null
    let headingPaint: {
      inviewCount: number
      boxShadowValues: string[]
      borderLeftWidthValues: string[]
    } | null = null
    const inviewHeadings = Array.from(
      view.contentDOM.querySelectorAll<HTMLElement>('.vsidian-heading-inview'),
    )
    if (inviewHeadings.length > 0) {
      const boxShadowValues = new Set<string>()
      const borderLeftWidthValues = new Set<string>()
      for (const el of inviewHeadings) {
        const style = getComputedStyle(el)
        boxShadowValues.add(style.boxShadow)
        borderLeftWidthValues.add(style.borderLeftWidth)
      }
      headingPaint = {
        inviewCount: inviewHeadings.length,
        boxShadowValues: [...boxShadowValues].sort(),
        borderLeftWidthValues: [...borderLeftWidthValues].sort(),
      }
    }
    // 光标取证：#237 多光标开启时 drawSelection 接管光标绘制——原生 caret
    // 被 hideNativeSelection 隐藏（caret-color transparent !important，全
    // 编辑器恒透明，不再随明暗变化），光标颜色证据移至绘制层 .cm-cursor 的
    // borderLeftColor（baseTheme 明暗变体：light=black / dark=#ddd）。关闭
    // 多光标时回退原生 caret（baseTheme caretColor 明暗变体：light=black /
    // dark=white）。darkTheme 取 facet 实值（jsdom 可读），两色取计算值
    // （jsdom 无 CSS 引擎为 null；无 .cm-cursor 元素亦为 null）
    let caretColor: string | null = null
    try {
      caretColor = getComputedStyle(contentEl).caretColor || null
    } catch {
      caretColor = null
    }
    let drawnCursorColor: string | null = null
    try {
      const cursorEl = view.dom.querySelector<HTMLElement>('.cm-cursorLayer .cm-cursor')
      drawnCursorColor = cursorEl ? getComputedStyle(cursorEl).borderLeftColor || null : null
    } catch {
      drawnCursorColor = null
    }
    // #59 公式绘制探针：按当前激活视图取首个公式元素（隐藏侧 display:none
    // 的 rect 全 0 不作依据）；rect 有面积且 elementFromPoint 命中才算画出来
    const mathScope = this.viewMode === 'reading' ? this.readingContainer : view.contentDOM
    const mathEl = mathScope?.querySelector<HTMLElement>(
      `.${MATH_CLASS_NAMES.math}, .${MATH_CLASS_NAMES.mathError}`,
    ) ?? null
    let mathVisible = false
    let mathDisplay: string | null = null
    if (mathEl) {
      mathDisplay = getComputedStyle(mathEl).display
      // 可见性口径统一走 hitPaintedElement（rect 有面积 + elementFromPoint
      // 命中自身；jsdom 无布局恒 false，只作真宿主集成断言依据）
      mathVisible = hitPaintedElement(mathEl)
    }
    const math = mathEl
      ? {
          visible: mathVisible,
          display: mathDisplay,
          count: mathScope
            ? mathScope.querySelectorAll(
                `.${MATH_CLASS_NAMES.math}, .${MATH_CLASS_NAMES.mathError}`,
              ).length
            : 0,
        }
      : undefined
    // #106 分割线绘制探针：live 态取渲染 widget（光标触及该行时源码显形、
    // widget 不在场，计数随之归零），reading 态取阅读块内原生 <hr>。可见性 =
    // rect 有面积且 elementFromPoint 命中，口径为任一候选命中即视为绘制
    // （与 #60 Mermaid 同款；首个候选可能滚出视口——hr.md 插入用例实测
    // 新分割线已绘制而首条在上文滚出，取首条会误判不可见。jsdom 无布局
    // 恒 false，只作真宿主集成断言依据）。无分割线时整个字段缺省
    const hrScope = this.viewMode === 'reading' ? this.readingContainer : view.contentDOM
    const hrSelector = `.${LIVE_CLASS_NAMES.hrRule}, .${READING_CLASS_NAMES.hr} hr`
    const hrEls = hrScope ? Array.from(hrScope.querySelectorAll<HTMLElement>(hrSelector)) : []
    const hrEl = firstPaintedOf(hrEls)
    let hrVisible = false
    let hrDisplay: string | null = null
    let hrBackgroundImage: string | null = null
    let hrBorderTopWidth: string | null = null
    if (hrEl) {
      const hrStyle = getComputedStyle(hrEl)
      hrDisplay = hrStyle.display
      // live 态横线以居中渐变落笔、reading 态原生 <hr> 以 border-top
      // 落笔，两种形态都采集供集成断言区分
      hrBackgroundImage = hrStyle.backgroundImage
      hrBorderTopWidth = hrStyle.borderTopWidth
      // 可见性口径统一走 hitPaintedElement（rect 有面积 + elementFromPoint
      // 命中自身；jsdom 无布局恒 false，只作真宿主集成断言依据）
      hrVisible = hitPaintedElement(hrEl)
    }
    const hr = hrEl
      ? {
          visible: hrVisible,
          display: hrDisplay,
          backgroundImage: hrBackgroundImage,
          borderTopWidth: hrBorderTopWidth,
          count: hrEls.length,
        }
      : undefined
    // #60 Mermaid 绘制探针：按当前激活视图取图表容器（分态计数）；
    // 可见性取视口内任一已渲染 SVG 的 rect + elementFromPoint 命中；
    // 首图可能因 view.locate 滚到文末而离开视口，不代表图表没有绘制。
    const mermaidScope = this.viewMode === 'reading' ? this.readingContainer : view.contentDOM
    const mermaidEl = mermaidScope?.querySelector<HTMLElement>(
      `.${MERMAID_CLASS_NAMES.diagram}`,
    ) ?? null
    let mermaidVisible = false
    const mermaidDisplay = mermaidEl ? getComputedStyle(mermaidEl).display : null
    for (const diagram of mermaidScope?.querySelectorAll<HTMLElement>(
      `.${MERMAID_CLASS_NAMES.diagram}[${MERMAID_STATE_ATTR}="rendered"]`) ?? []) {
      const svg = diagram.querySelector('svg')
      if (!svg) continue
      try {
        if (isSvgPainted(svg)) {
          mermaidVisible = true
          break
        }
      } catch {
        // jsdom 无布局与 elementFromPoint；真宿主才能证明实际可见。
      }
    }
    const mermaidCounts = mermaidScope
      ? {
          rendered: mermaidScope.querySelectorAll(
            `.${MERMAID_CLASS_NAMES.diagram}[${MERMAID_STATE_ATTR}="rendered"]`,
          ).length,
          error: mermaidScope.querySelectorAll(
            `.${MERMAID_CLASS_NAMES.diagram}[${MERMAID_STATE_ATTR}="error"]`,
          ).length,
          count: mermaidScope.querySelectorAll(`.${MERMAID_CLASS_NAMES.diagram}`).length,
        }
      : { rendered: 0, error: 0, count: 0 }
    const mermaid = mermaidEl
      ? { visible: mermaidVisible, display: mermaidDisplay, ...mermaidCounts }
      : undefined
    // #105 高亮绘制探针：live 态取 .vsidian-highlight span、reading 态取
    // mark；底色 computed 证明真实画出（透明 = 样式注入失效信号）。
    // delimitersHidden 用激活视口文本口径（不依赖布局）：唯一 == 定界符
    // 不在文本中即隐藏成功——光标触及显形时为 false。可见性口径为任一
    // 候选命中即视为绘制（firstPaintedOf，与 #106 hr 探针同款——首个
    // 候选可能滚出视口，不代表样式失效）
    const highlightSelector = this.viewMode === 'reading' ? 'mark' : '.vsidian-highlight'
    const highlightScopeEl = this.viewMode === 'reading' ? this.readingContainer : view.contentDOM
    const highlightEls = highlightScopeEl
      ? Array.from(highlightScopeEl.querySelectorAll<HTMLElement>(highlightSelector))
      : []
    const highlightEl = firstPaintedOf(highlightEls)
    let highlightVisible = false
    let highlightBackgroundColor: string | null = null
    let highlightDisplay: string | null = null
    if (highlightEl) {
      const style = getComputedStyle(highlightEl)
      highlightBackgroundColor = style.backgroundColor
      highlightDisplay = style.display
      // 可见性口径统一走 hitPaintedElement（rect 有面积 + elementFromPoint
      // 命中自身；jsdom 无布局恒 false，只作真宿主集成断言依据）
      highlightVisible = hitPaintedElement(highlightEl)
    }
    const highlight = highlightEl
      ? {
        visible: highlightVisible,
        display: highlightDisplay,
        backgroundColor: highlightBackgroundColor,
        count: highlightEls.length,
        delimitersHidden: this.viewMode === 'reading' ? null
          : !(highlightScopeEl?.textContent ?? '').includes('=='),
      }
      : undefined
    // #111 图形化代码块按钮组与图表弹窗探针：当前激活视图内的 frame 与
    // 按钮计数（显隐由 CSS 悬停承担，此处观测 DOM 在场与发射形态）；
    // 浮层为 document 级单例。overlayVisible 钉「正文被遮蔽」：弹窗打开
    // 时 backdrop 几何中心被浮层子树占据（jsdom 无布局恒 false，真宿主
    // 集成断言依据，与 mermaid.visible 同口径）
    const graphicScope = this.viewMode === 'reading' ? this.readingContainer : view.contentDOM
    // 图表 frame 排除图片 frame（#212 起图片槽位也带 frame 类，同类名族；
    // 按钮计数限定在图表 frame 子树，避免与图片按钮互相混计）
    const graphicFrameEls = graphicScope
      ? [...graphicScope.querySelectorAll<HTMLElement>(
          `.${GRAPHIC_CHROME_CLASS_NAMES.frame}:not(.${IMAGE_CLASS_NAMES.image})`)]
      : []
    const graphicFrames = graphicFrameEls.length
    const overlayEl = document.querySelector(`.${DIAGRAM_POPUP_CLASS_NAMES.overlay}`)
    let overlayVisible = false
    if (overlayEl instanceof HTMLElement) {
      const rect = overlayEl.getBoundingClientRect()
      const hit = rect.width > 0 && rect.height > 0
        ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
        : null
      overlayVisible =
        hit !== null &&
        overlayEl.contains(hit) &&
        getComputedStyle(overlayEl).display !== 'none' &&
        getComputedStyle(overlayEl).visibility !== 'hidden'
    }
    const graphic = graphicFrames > 0 || isDiagramPopupOpen()
      ? {
          frames: graphicFrames,
          editButtons: graphicFrameEls.reduce(
            (n, f) => n + f.querySelectorAll(`.${GRAPHIC_CHROME_CLASS_NAMES.edit}`).length, 0),
          popupButtons: graphicFrameEls.reduce(
            (n, f) => n + f.querySelectorAll(`.${GRAPHIC_CHROME_CLASS_NAMES.popup}`).length, 0),
          overlay: isDiagramPopupOpen(),
          overlayVisible,
          overlaySvg: document.querySelector(`.${DIAGRAM_POPUP_CLASS_NAMES.media} svg`) !== null,
        }
      : undefined
    // #212 图片按钮组与图片弹窗探针：图片 frame = frame.vsidian-image
    //（与 mermaid 的 frame 类区分）。计数只统计 loaded 态——frame 类在
    // loading/error 也常在（live 槽位 toDOM 同步设类、阅读挂载钩子无
    // 条件包 frame），而规格语义是「loaded 态才有按钮」，以 frame 内
    // loaded img 为口径使探针与协议注释、断言一致；图片弹窗复用弹窗
    // 类名族，浮层可见性与 graphic.overlayVisible 同口径（elementFromPoint
    // 命中），img 的 loaded 槽位态为装载证据
    const imageFrameSel = `.${GRAPHIC_CHROME_CLASS_NAMES.frame}.${IMAGE_CLASS_NAMES.image}`
    // loaded 判定兼容两种宿主：live 槽位状态属性在 frame（span）自身，
    // 阅读槽位是 img 本身（状态属性在 frame 内的 img 上）
    const isLoadedImageFrame = (f: HTMLElement): boolean =>
      f.dataset['vsidianImgState'] === 'loaded'
      || f.querySelector(`img[data-vsidian-img-state="loaded"]`) !== null
    const imageFrameEls = graphicScope
      ? [...graphicScope.querySelectorAll<HTMLElement>(imageFrameSel)].filter(isLoadedImageFrame)
      : []
    const imageFrames = imageFrameEls.length
    const imageOverlayOpen = isImagePopupOpen()
    let imageOverlayImgLoaded = false
    if (imageOverlayOpen) {
      const popupImg = document.querySelector(`.${DIAGRAM_POPUP_CLASS_NAMES.media} img`)
      imageOverlayImgLoaded =
        popupImg instanceof HTMLImageElement &&
        popupImg.dataset['vsidianImgState'] === 'loaded'
    }
    const imageChrome = imageFrames > 0 || imageOverlayOpen
      ? {
          frames: imageFrames,
          editButtons: imageFrameEls.reduce(
            (n, f) => n + f.querySelectorAll(`.${GRAPHIC_CHROME_CLASS_NAMES.edit}`).length, 0),
          popupButtons: imageFrameEls.reduce(
            (n, f) => n + f.querySelectorAll(`.${GRAPHIC_CHROME_CLASS_NAMES.popup}`).length, 0),
          overlay: imageOverlayOpen,
          overlayVisible: imageOverlayOpen && overlayVisible,
          overlayImgLoaded: imageOverlayImgLoaded,
        }
      : undefined
    // #183 统一右键菜单绘制探针：浮层在场（瞬态挂载）时的实际可见性
    // （elementFromPoint 命中——样式注入失效时 DOM 在场但命中失败）、分组
    // 线与置灰计数（安全降级矩阵的绘制层证据）；菜单关闭时缺省。分组线
    // 计数限定顶级（:scope 直接子级）——子菜单内另有分组线，不计入三簇口径
    const contextMenuEl = this.contextMenuEl
    const contextMenu = contextMenuEl
      ? {
          visible: hitPaintedElement(contextMenuEl),
          display: getComputedStyle(contextMenuEl).display,
          separatorCount: contextMenuEl.querySelectorAll(
            `:scope > .${CONTEXT_MENU_CLASS_NAMES.separator}`).length,
          disabledCount: contextMenuEl.querySelectorAll('button:disabled').length,
        }
      : undefined
    const quickBar = this.quickActionsEl
    const quickBold = quickBar?.querySelector<HTMLElement>('[data-op="bold"]') ?? null
    const quickActive = quickBar?.querySelector<HTMLElement>('[data-format-state="active"]') ?? null
    const barRect = quickBar?.getBoundingClientRect()
    const toolbarRect = this.toolbar?.getBoundingClientRect()
    const editorRect = this.liveWrapper?.getBoundingClientRect()
    const quickActions = {
      open: this.quickActionsOpen,
      togglePainted: hitPaintedElement(this.quickToggleBtn),
      barPainted: hitPaintedElement(quickBar, quickBar),
      boldPainted: hitPaintedElement(quickBold, quickBar),
      activePainted: !!quickActive && paintedWithVisibleBackground(quickActive),
      menuPainted: hitPaintedElement(this.quickHeadingMenu, this.quickHeadingMenu),
      barBelowToolbar: !!barRect && !!toolbarRect && barRect.height > 0 &&
        barRect.top >= toolbarRect.bottom - 1,
      editorBelowBar: !!barRect && !!editorRect && barRect.height > 0 &&
        editorRect.top >= barRect.bottom - 1,
    }
    // #79 代码块卡片绘制探针：当前激活视图取头部横带。CM6 挂载缓冲内的
    // 头部可能滚出可视裁剪区（rect 在视口外，elementFromPoint 不命中），
    // 故遍历取首个「rect 有面积 + 在视口内 + elementFromPoint 命中」的
    // 头部；全部未命中时回落首个（display 探针仍可用）
    const codeScope = this.viewMode === 'reading' ? this.readingContainer : view.contentDOM
    const cardHeaders = codeScope
      ? [...codeScope.querySelectorAll<HTMLElement>(`.${CODE_CARD_CLASS_NAMES.header}`)]
      : []
    let cardHeader: HTMLElement | null = null
    let codeCardVisible = false
    for (const header of cardHeaders) {
      try {
        const rect = header.getBoundingClientRect()
        if (
          rect.width > 0 && rect.height > 0 &&
          rect.bottom > 0 && rect.top < window.innerHeight
        ) {
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
          if (hit && header.contains(hit)) {
            cardHeader = header
            codeCardVisible = true
            break
          }
        }
      } catch {
        // jsdom 无布局与 elementFromPoint；真宿主才能证明实际可见。
      }
      if (!cardHeader) {
        cardHeader = header
      }
    }
    const codeCardDisplay = cardHeader ? getComputedStyle(cardHeader).display : null
    // #83 tok-* token 元素计数（卡片关闭仅高亮时 code 节由 token 驱动存在）
    const tokenCount = codeScope
      ? codeScope.querySelectorAll('[class*="tok-"]').length
      : 0
    // frontmatter 卡片绘制探针（折叠链路断言）：当前激活视图取卡片行数与
    // 折叠/编辑控件在场数（收起态 rowCount 归零、editCount 归零、collapsed
    // chevron 在场——与代码卡 foldedCount 同口径）。rowCount 取**绘制层
    // 口径**（过滤 display:none）：live 收起行从 DOM 消失、阅读收起行由
    // CSS 隐藏，两视图都以「用户可见行数」计数
    const fmScope = this.viewMode === 'reading' ? this.readingContainer : view.contentDOM
    const fmHeaderEl = fmScope?.querySelector<HTMLElement>(`.${FM_CARD_CLASS_NAMES.header}`) ?? null
    const fm = fmHeaderEl
      ? {
        rowCount: fmScope
          ? [...fmScope.querySelectorAll<HTMLElement>(`.${FM_CARD_CLASS_NAMES.row}`)]
            .filter((el) => getComputedStyle(el).display !== 'none').length
          : 0,
        foldedCount: fmScope?.querySelectorAll(`.${FM_CARD_CLASS_NAMES.foldCollapsed}`).length ?? 0,
        editCount: fmScope?.querySelectorAll(`.${FM_CARD_CLASS_NAMES.edit}`).length ?? 0,
        cardFoldedCount: fmScope?.querySelectorAll(`.${FM_CARD_CLASS_NAMES.cardFolded}`).length ?? 0,
        tableFoldedCount: fmScope?.querySelectorAll(`.${FM_CARD_CLASS_NAMES.tableFolded}`).length ?? 0,
      }
      : undefined
    const code = cardHeader || tokenCount > 0
      ? {
        visible: codeCardVisible,
        display: codeCardDisplay,
        label:
          // #83 徽标在标签内：取标签的末文本节点（显示名），不含徽标字形
          cardHeader?.querySelector(`.${CODE_CARD_CLASS_NAMES.headerLabel}`)?.lastChild?.textContent ?? null,
        headerCount: codeScope
          ? codeScope.querySelectorAll(`.${CODE_CARD_CLASS_NAMES.header}`).length
          : 0,
        cardLineCount: codeScope
          ? codeScope.querySelectorAll(`.${CODE_CARD_CLASS_NAMES.line}`).length
          : 0,
        // #80 卡内行号文本序列（视口内；关闭行号子开关后为空数组）
        lineNumberTexts: codeScope
          ? [...codeScope.querySelectorAll(`.${CODE_CARD_CLASS_NAMES.linenumber}`)]
            .map((el) => el.textContent ?? '')
            .filter((t) => t !== '')
          : [],
        // #81 复制按钮在场数（编辑态同样发射、常驻在场；可见性由 CSS 悬停
        // 承担，DOM 常驻才能被此计数与宿主点击钩子命中；收起态不发射）
        copyCount: codeScope
          ? codeScope.querySelectorAll(`.${CODE_CARD_CLASS_NAMES.copy}`).length
          : 0,
        // #82 收起态头部数（chevron -collapsed 计数）
        foldedCount: codeScope
          ? codeScope.querySelectorAll(`.${CODE_CARD_CLASS_NAMES.foldCollapsed}`).length
          : 0,
        // #83 视口内 tok-* token 元素数
        tokenCount,
        // 全部头部语言标签序列（DOM 顺序；断言渲染型围栏的 Mermaid 标签）
        labels: cardHeaders
          .map((h) => h.querySelector(`.${CODE_CARD_CLASS_NAMES.headerLabel}`)?.lastChild?.textContent ?? '')
          .filter((t) => t !== ''),
      }
      : undefined
    const findSource = this.viewMode === 'reading'
      ? this.readingContainer?.closest('#app')?.querySelector<HTMLElement>('.vsidian-reading-find-source')
      : null
    const findSourceCurrent = findSource?.querySelector<HTMLElement>('.vsidian-find-match-current')
    return {
      textVisible,
      scrollerDisplay: view.scrollDOM ? getComputedStyle(view.scrollDOM).display : null,
      gutterUserSelect: guttersEl ? getComputedStyle(guttersEl).userSelect : null,
      visibleLineNumbers: paintedLineNumbers(view),
      darkTheme: view.state.facet(EditorView.darkTheme),
      caretColor,
      drawnCursorColor,
      readingFindSource: {
        visible: !!findSourceCurrent && paintedWithVisibleBackground(findSourceCurrent),
        text: findSource?.querySelector('code')?.textContent ?? '',
        current: findSourceCurrent?.textContent ?? '',
        background: findSourceCurrent ? getComputedStyle(findSourceCurrent).backgroundColor : null,
      },
      table: {
        cellVisible,
        caretGridColumn,
        delimiterDisplay: delimiterRow ? getComputedStyle(delimiterRow).display : null,
        headerCellBackgrounds,
        caretDomColumn,
        caretNativeRectHeight,
        cellBreakDisplay: view.contentDOM.querySelector('.vsidian-table-cell-break')
          ? getComputedStyle(view.contentDOM.querySelector('.vsidian-table-cell-break')!).display : null,
        dataRowLineBackground,
        gridDisplay: gridRow ? getComputedStyle(gridRow).display : null,
        cellBorderWidth: cellStyle?.borderLeftWidth ?? null,
        rowOutlineColor: rowStyle?.outlineColor ?? null,
        rowOutlineWidth: rowStyle?.outlineWidth ?? null,
        rowBackgroundColor: rowCellStyle?.backgroundColor ?? null,
        columnBorderColor: columnStyle?.borderLeftColor ?? null,
        columnBorderWidth: columnStyle?.borderLeftWidth ?? null,
        columnRightBorderWidth: columnStyle?.borderRightWidth ?? null,
        columnTopBorderWidth: columnFirstStyle?.borderTopWidth ?? null,
        columnBottomBorderWidth: columnLastStyle?.borderBottomWidth ?? null,
        columnBackgroundColor: columnStyle?.backgroundColor ?? null,
        regionCellCount: regionCells.length,
        regionBackgroundColor: regionStyle?.backgroundColor ?? null,
        regionTopBorderWidth: regionStyle?.borderTopWidth ?? null,
        regionLeftBorderWidth: regionStyle?.borderLeftWidth ?? null,
      },
      math,
      mermaid,
      hr,
      highlight,
      graphic,
      imageChrome,
      quickActions,
      code,
      fm,
      heading: headingPaint,
      ...(contextMenu ? { contextMenu } : {}),
      toast: this.collectToastPaint(),
    }
  }

  private collectToastPaint(): NonNullable<PaintProbe['toast']> {
    const el = this.rootEl?.querySelector<HTMLElement>('.vsidian-toast')
    const empty = { visible: false, text: '', severity: '', background: '', foreground: '', pointerEvents: '' }
    if (!el) return empty
    try {
      const style = getComputedStyle(el)
      const range = document.createRange()
      range.selectNodeContents(el)
      const rect = range.getBoundingClientRect()
      let ancestorsPainted = true
      for (let node = el.parentElement; node; node = node.parentElement) {
        const parentStyle = getComputedStyle(node)
        if (parentStyle.display === 'none' || parentStyle.contentVisibility === 'hidden' || Number(parentStyle.opacity) === 0) {
          ancestorsPainted = false
          break
        }
      }
      const visible = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight &&
        rect.right > 0 && rect.left < innerWidth && style.display !== 'none' &&
        style.visibility === 'visible' && Number(style.opacity) > 0 && style.color !== 'rgba(0, 0, 0, 0)' && ancestorsPainted
      return { visible, text: el.textContent ?? '', severity: el.dataset['severity'] ?? '',
        background: style.backgroundColor, foreground: style.color, pointerEvents: style.pointerEvents }
    } catch { return empty }
  }

  /**
   * #53 右侧栏观测：布局态与绘制层证据（语义见 protocol.ts SidebarProbe）。
   * 命中类字段走 elementFromPoint——侧栏/按钮只有真实绘制（非 display:none、
   * 非零尺寸、无覆盖遮挡）时才可能命中；线宽为 computed stroke-width 文本
   * （两态差异唯一来源是样式表类规则）。jsdom 无布局与 CSS 引擎：命中恒
   * false、线宽/名称容错为 null，真宿主断言见集成
   */
  private collectSidebar(): SidebarProbe {
    const readStroke = (el: Element | null): string | null => {
      if (!el) {
        return null
      }
      try {
        const value = getComputedStyle(el).strokeWidth
        return value === '' ? null : value
      } catch {
        return null
      }
    }
    const widthOf = (el: HTMLElement | null | undefined): number | null => {
      if (!el) {
        return null
      }
      try {
        return el.getBoundingClientRect().width
      } catch {
        return null
      }
    }
    const sidebarBar = this.sidebarEl?.querySelector<HTMLElement>('.vsidian-sidebar-toolbar') ?? null
    return {
      open: this.sidebarOpen,
      sidebarToolbarPainted: hitPaintedElement(sidebarBar, this.sidebarEl),
      togglePainted: hitPaintedElement(this.sidebarToggleBtn),
      settingsPainted: hitPaintedElement(
        this.toolbar?.querySelector<HTMLButtonElement>('button.vsidian-settings-toggle') ?? null,
      ),
      toggleBarStrokeWidth: readStroke(
        this.sidebarToggleBtn?.querySelector('.vsidian-sidebar-icon-bar') ?? null,
      ),
      toggleFrameStrokeWidth: readStroke(
        this.sidebarToggleBtn?.querySelector('.vsidian-sidebar-icon-frame') ?? null,
      ),
      mainWidthPx: widthOf(this.mainEl),
      sidebarWidthPx: widthOf(this.sidebarEl),
      resizerPainted: hitPaintedElement(this.sidebarResizerEl),
      toggleAriaLabel: this.sidebarToggleBtn?.getAttribute('aria-label') ?? null,
      settingsAriaLabel:
        this.toolbar?.querySelector<HTMLButtonElement>('button.vsidian-settings-toggle')
          ?.getAttribute('aria-label') ?? null,
    }
  }

  /**
   * #54 大纲观测：面板态与绘制层证据（语义见 protocol.ts OutlineProbe）。
   * 回报前先做新鲜度校准（所有 view.state 回报路径统一走这里）：Text 引用
   * 未变时零成本，过期则解析一次（复用 liveDecorationsField 的增量树）。
   * 命中字段走 elementFromPoint——侧栏展开 + 面板 active + 显隐样式表规则
   * 生效（display:none/零尺寸时命中失败），DOM 存在性探不出样式失效。
   * 图标尺寸与滚动几何为 computed/布局度量（长面板裁剪时中心点在宿主外、
   * 命中失败，scrollHeight > clientHeight 证明高度约束生效）。jsdom 无布局
   * 与 CSS 引擎：命中恒 false、几何度量透传 0、图标尺寸容错为 null，名称
   * 在未装配时为 null，真宿主断言见集成。
   */
  /**
   * #197 反链面板观测：面板态、四态实值与绘制层证据（语义见
   * protocol.ts BacklinksProbe）。命中字段走 elementFromPoint——侧栏展开 +
   * 面板 active + 显隐样式表规则生效时才可能命中，DOM 存在性探不出样式
   * 失效。jsdom 无布局与 CSS 引擎：命中恒 false，真宿主断言见集成。
   */
  private collectBacklinks(): BacklinksProbe {
    const panel = this.backlinksPanelEl
    const items = this.backlinksSnapshot.items
    return {
      active: this.backlinksActive,
      togglePainted: hitPaintedElement(this.backlinksToggleBtn),
      panelPainted: hitPaintedElement(panel, panel),
      state: this.backlinksActive ? this.backlinksSnapshot.state : 'none',
      updating: this.backlinksActive ? this.backlinksSnapshot.updating : false,
      items: items.map((item) => ({
        sourceRelPath: item.sourceRelPath,
        kind: item.kind,
        line: item.line,
        snippet: item.snippet,
      })),
      itemPainted: hitPaintedElement(
        panel?.querySelector<HTMLElement>(`.${BACKLINK_CLASS_NAMES.item}`) ?? null,
        panel,
      ),
      emptyPainted: hitPaintedElement(
        panel?.querySelector<HTMLElement>(`.${BACKLINK_CLASS_NAMES.placeholder}`) ?? null,
        panel,
      ),
      toggleAriaLabel: this.backlinksToggleBtn?.getAttribute('aria-label') ?? null,
      panelAriaLabel: panel?.getAttribute('aria-label') ?? null,
      view: {
        sortMode: this.backlinkView.sortMode,
        query: this.backlinkView.query,
        searchOpen: this.backlinkView.searchOpen,
        contextLong: this.backlinkView.contextLong,
        collapsedCount: this.backlinkView.collapsedGroups.size,
        domCards: panel?.querySelectorAll(`.${BACKLINK_CLASS_NAMES.card}`).length ?? 0,
      },
      toolbarPainted: hitPaintedElement(
        panel?.querySelector<HTMLElement>(`.${BACKLINK_CLASS_NAMES.toolbar}`) ?? null,
        panel,
      ),
      hitPainted: hitPaintedElement(
        panel?.querySelector<HTMLElement>(`.${BACKLINK_CLASS_NAMES.hit}`) ?? null,
        panel,
      ),
      hitBg: (() => {
        const mark = panel?.querySelector<HTMLElement>(`.${BACKLINK_CLASS_NAMES.hit}`)
        if (!mark) {
          return null
        }
        try {
          const value = getComputedStyle(mark).backgroundColor
          return value === '' ? null : value
        } catch {
          return null
        }
      })(),
    }
  }

  /** 出链面板观测（语义见 protocol.ts OutlinksProbe；口径与反链镜像） */
  private collectOutlinks(): OutlinksProbe {
    const panel = this.outlinksPanelEl
    const items = this.outlinksSnapshot.items
    return {
      active: this.outlinksActive,
      togglePainted: hitPaintedElement(this.outlinksToggleBtn),
      panelPainted: hitPaintedElement(panel, panel),
      state: this.outlinksActive ? this.outlinksSnapshot.state : 'none',
      updating: this.outlinksActive ? this.outlinksSnapshot.updating : false,
      items: items.map((item) => ({
        targetDisplay: item.targetDisplay,
        targetRelPath: item.targetRelPath,
        kind: item.kind,
        anchor: item.anchor,
        resolved: item.resolved,
      })),
      itemPainted: hitPaintedElement(
        panel?.querySelector<HTMLElement>(`.${OUTLINK_CLASS_NAMES.item}`) ?? null,
        panel,
      ),
      emptyPainted: hitPaintedElement(
        panel?.querySelector<HTMLElement>(`.${OUTLINK_CLASS_NAMES.placeholder}`) ?? null,
        panel,
      ),
      toggleAriaLabel: this.outlinksToggleBtn?.getAttribute('aria-label') ?? null,
      panelAriaLabel: panel?.getAttribute('aria-label') ?? null,
    }
  }

  private collectOutline(): OutlineProbe {
    this.outlineEnsureFresh()
    const iconSizeOf = (el: HTMLElement | null | undefined): number | null => {
      const svg = el?.querySelector('svg')
      if (!svg) {
        return null
      }
      try {
        const value = getComputedStyle(svg).width
        const px = value === '' ? NaN : Number.parseFloat(value)
        return Number.isFinite(px) ? px : null
      } catch {
        return null
      }
    }
    const panel = this.outlinePanelEl
    const dimensionOf = (
      el: HTMLElement | null | undefined,
      key: 'scrollHeight' | 'clientHeight',
    ): number | null => {
      if (!el) {
        return null
      }
      try {
        const value = el[key]
        return Number.isFinite(value) ? value : null
      } catch {
        return null
      }
    }
    /** #65 样式透传绘制证据：computed 字重/字体族/颜色。条目 400 与显式
     *  粗体段 700 的对照是「字重只认显式标记」的用户可见差异；条目与正文
     *  标题的颜色对照是主题色同源证据（同变量族解析同值）。目标元素不在
     *  （无条目/无标记/无标题行）或取值失败时为 null（jsdom 无 CSS 引擎） */
    const outlineStyle = () => {
      const read = (el: Element | null, prop: 'fontWeight' | 'fontFamily' | 'color'): string | null => {
        if (!el) {
          return null
        }
        try {
          const value = getComputedStyle(el)[prop]
          return typeof value === 'string' && value !== '' ? value : null
        } catch {
          return null
        }
      }
      const panel = this.outlinePanelEl ?? null
      const item = panel?.querySelector(`.${OUTLINE_CLASS_NAMES.item}`) ?? null
      const strong = panel?.querySelector(`.${OUTLINE_CLASS_NAMES.item} .${OUTLINE_CLASS_NAMES.span.strong}`) ?? null
      const code = panel?.querySelector(`.${OUTLINE_CLASS_NAMES.item} .${OUTLINE_CLASS_NAMES.span.code}`) ?? null
      const heading = this.liveWrapper?.querySelector('.vsidian-heading-line') ?? null
      return {
        itemFontWeight: read(item, 'fontWeight'),
        strongFontWeight: read(strong, 'fontWeight'),
        codeFontFamily: read(code, 'fontFamily'),
        itemFontFamily: read(item, 'fontFamily'),
        itemColor: read(item, 'color'),
        headingColor: read(heading, 'color'),
      }
    }
    const visibleIndices = outlineVisibleIndices(this.outlineItems, this.outlineExpanded)
    return {
      active: this.outlineActive,
      togglePainted: hitPaintedElement(this.outlineToggleBtn),
      panelPainted: hitPaintedElement(panel, panel),
      toggleIconSizePx: iconSizeOf(this.outlineToggleBtn),
      panelScrollHeightPx: dimensionOf(panel, 'scrollHeight'),
      panelClientHeightPx: dimensionOf(panel, 'clientHeight'),
      items: this.outlineItems.map((item) => ({
        ...item,
        spans: item.spans.map((span) => ({ ...span })),
      })),
      toggleAriaLabel: this.outlineToggleBtn?.getAttribute('aria-label') ?? null,
      panelAriaLabel: this.outlinePanelEl?.getAttribute('aria-label') ?? null,
      style: outlineStyle(),
      // #66 常驻高亮观测：located 索引/文字 + 绘制层证据（中心点命中 +
      // computed 背景非全透明；jsdom 无布局恒 false，真宿主断言见集成）
      locatedItemIndex: this.outlineLocatedIndex,
      locatedText: this.outlineLocatedIndex !== null
        ? this.outlineItems[this.outlineLocatedIndex]?.text ?? null
        : null,
      locatedPainted: this.collectOutlineLocatedPainted(),
      // #67 折叠观测：档位实值 + 可见索引序列（折叠可见性断言权威口径）+
      // 滑块行/当前档圆点/折叠箭头的绘制层证据
      expandLevel: this.outlineExpandLevel,
      visibleIndices: visibleIndices,
      sliderPainted: hitPaintedElement(this.outlineSlider?.row, this.outlineSlider?.row),
      sliderActiveDotPainted: this.collectOutlineSliderActiveDotPainted(),
      chevronPainted: hitPaintedElement(
        this.outlinePanelEl?.querySelector<HTMLElement>(`.${OUTLINE_CLASS_NAMES.chevron}`) ?? null,
        this.outlinePanelEl,
      ),
      // #68 搜索与工具条观测：词条实值/组合可见口径（搜索关闭时与
      // visibleIndices 同值）+ 工具条行、命中片段、无匹配占位的绘制证据
      // 与控件可访问名称（jsdom 无布局：命中恒 false，真宿主断言见集成）
      searchQuery: this.outlineSearchQuery,
      searchActive: this.outlineSearchActive(),
      filteredVisibleIndices: this.outlineSearchState === null
        ? visibleIndices
        : outlineFilteredVisibleIndices(
          this.outlineItems,
          this.outlineExpanded,
          this.outlineSearchState.kept,
        ),
      toolbarPainted: hitPaintedElement(this.outlineToolbar?.row, this.outlineToolbar?.row),
      jumpBottomAriaLabel: this.outlineToolbar?.jumpBottom.getAttribute('aria-label') ?? null,
      resetAriaLabel: this.outlineToolbar?.reset.getAttribute('aria-label') ?? null,
      searchPlaceholder: this.outlineToolbar?.search.getAttribute('placeholder') ?? null,
      searchHitPainted: this.collectOutlineSearchHitPainted(),
      nomatchPainted: hitPaintedElement(
        this.outlinePanelEl?.querySelector<HTMLElement>(`.${OUTLINE_CLASS_NAMES.nomatch}`) ?? null,
        this.outlinePanelEl,
      ),
      // #69 菜单观测：打开态（容器挂载于侧栏）、目标索引、绘制证据（中心点
      // elementFromPoint 命中——侧栏展开 + 样式表浮层规则生效）、级联子菜单
      // 可见（hover/focus 展开：computed display 非 none 且非空）
      menuOpen: this.outlineMenuEl !== undefined,
      menuTargetIndex: this.outlineMenuEl !== undefined ? this.outlineMenuIndex : null,
      menuPainted: hitPaintedElement(this.outlineMenuEl, this.outlineMenuEl),
      submenuVisible: this.collectOutlineSubmenuVisible(),
      renamingIndex: this.outlineRenameIndex,
      // #70 拖拽观测：源/落点索引与三态实值（悬停态经 outline.test.drag
      // action=hover 驱动后采集）+ 落点指示绘制证据
      draggingIndex: this.outlineDragState?.moved ? this.outlineDragState.fromIndex : null,
      dropTargetIndex: this.outlineDragState?.targetIndex ?? null,
      dropPosition: this.outlineDragState?.position ?? null,
      dropHintPainted: this.collectOutlineDropHintPainted(),
    }
  }

  /** #70 落点指示绘制证据：带指示类的条目中心点命中自身（真实布局）且
   *  computed 插入线（box-shadow）或包裹高亮（outline 非虚线宽 > 0 /
   *  背景非全透明）任一可读——样式失效时类在而视觉差异不在，此处捕获。
   *  jsdom 无布局恒 false，真宿主断言见集成 */
  private collectOutlineDropHintPainted(): boolean {
    const panel = this.outlinePanelEl
    if (!panel) {
      return false
    }
    const el = panel.querySelector<HTMLElement>(
      `.${OUTLINE_CLASS_NAMES.dropBefore}, .${OUTLINE_CLASS_NAMES.dropAfter}, ` +
      `.${OUTLINE_CLASS_NAMES.dropInside}`,
    )
    if (!el || !hitPaintedElement(el, el)) {
      return false
    }
    try {
      const cs = getComputedStyle(el)
      if (cs.boxShadow !== '' && cs.boxShadow !== 'none') {
        return true
      }
      const outlineWidth = Number.parseFloat(cs.outlineWidth)
      if (cs.outlineStyle !== 'none' && cs.outlineStyle !== '' &&
          Number.isFinite(outlineWidth) && outlineWidth > 0) {
        return true
      }
      return paintedWithVisibleBackground(el)
    } catch {
      return false
    }
  }

  /** #69 级联子菜单可见证据：任一子菜单 computed display 非 none 且非空串
   *  （CSS 未加载/未 hover 时 display 为 none 或空——jsdom 恒 false） */
  private collectOutlineSubmenuVisible(): boolean {
    const menu = this.outlineMenuEl
    if (!menu) {
      return false
    }
    for (const el of Array.from(menu.querySelectorAll<HTMLElement>(`.${OUTLINE_MENU_CLASS_NAMES.submenu}`))) {
      try {
        const display = getComputedStyle(el).display
        if (display !== '' && display !== 'none') {
          return true
        }
      } catch {
        // 计算失败保守视为不可见
      }
    }
    return false
  }

  /** #66 located 条目的绘制层证据：施加了 located 类的元素（#67 起为
   *  可见代表——被折叠遮蔽时是第一个可见祖先）中心点 elementFromPoint
   *  命中自身（真实布局与显隐规则生效）且 computed background-color 非
   *  全透明（半透明横条规则生效——样式失效时无背景可读）。代表元素在
   *  面板滚动区可视范围外时命中失败；#67 的高亮行滚进可视区使常态下
   *  命中成立（跳转/滚动落位即滚，probe 采集时已就位） */
  private collectOutlineLocatedPainted(): boolean {
    const panel = this.outlinePanelEl
    if (!panel) {
      return false
    }
    const el = panel.querySelector<HTMLElement>(`.${OUTLINE_CLASS_NAMES.located}`)
    return !!el && paintedWithVisibleBackground(el)
  }

  /** #67 当前档圆点绘制证据：active 圆点中心点命中（真实布局 + active
   *  类规则生效——选择器写错时圆点无类可命中）且 computed 背景非全透明
   *  （实心珠真实绘制；jsdom 无布局恒 false，真宿主断言见集成） */
  private collectOutlineSliderActiveDotPainted(): boolean {
    const dot = this.outlineSlider?.dots[this.outlineExpandLevel]
    if (!dot || !dot.classList.contains(OUTLINE_CLASS_NAMES.sliderActive)) {
      return false
    }
    return paintedWithVisibleBackground(dot)
  }

  /** #68 命中片段绘制证据：首个非隐藏条目内的 mark 中心点命中自身且
   *  computed 背景非全透明（片段高亮规则真实绘制——mark 无背景规则时
   *  视觉上不可区分，computed 捕获；无搜索/无命中或 jsdom 无布局恒
   *  false，真宿主断言见集成） */
  private collectOutlineSearchHitPainted(): boolean {
    const panel = this.outlinePanelEl
    if (!panel) {
      return false
    }
    const mark = panel.querySelector<HTMLElement>(
      `.${OUTLINE_CLASS_NAMES.item}:not(.${OUTLINE_CLASS_NAMES.hidden}) ` +
      `mark.${OUTLINE_CLASS_NAMES.searchHit}`,
    )
    return !!mark && paintedWithVisibleBackground(mark)
  }

  /** 暂停提示横幅：说明输入已保留、写回已暂停，提供取回与恢复按钮 */
  private buildBanner(): HTMLElement {
    const banner = document.createElement('div')
    banner.className = 'vsidian-suspend-banner'
    banner.style.display = 'none'
    const label = document.createElement('span')
    label.className = 'vsidian-suspend-banner-text'
    bindLocale(label, 'text', 'conflict.bannerText')
    banner.appendChild(label)
    const copy = document.createElement('button')
    copy.type = 'button'
    copy.dataset['action'] = 'copy'
    bindLocale(copy, 'text', 'conflict.copyUnconfirmed')
    const resume = document.createElement('button')
    resume.type = 'button'
    resume.dataset['action'] = 'resume'
    bindLocale(resume, 'text', 'conflict.resume')
    banner.appendChild(copy)
    banner.appendChild(resume)
    banner.addEventListener('click', (event) => {
      const target = event.target as HTMLElement
      const action = target.closest('button')?.dataset['action']
      if ((action === 'copy' || action === 'resume') && this.sessionId) {
        this.bridge.postMessage({
          kind: 'conflict.action',
          sessionId: this.sessionId,
          docUri: this.docUri,
          action,
        })
      }
    })
    return banner
  }

  private setBannerVisible(visible: boolean): void {
    if (this.banner) {
      this.banner.style.display = visible ? 'flex' : 'none'
    }
  }

  /** #111 阅读视图图形化代码块按钮组：挂载钩子把渲染容器包进定位 frame
   *  并挂 popup 按钮（幂等；仅对 webview 侧有渲染管线的语言生效）。 */
  private decorateGraphicChromeBlock(el: HTMLElement): void {
    if (!(el instanceof HTMLElement)) {
      return
    }
    const targets = [
      ...(el.matches(`.${MERMAID_CLASS_NAMES.diagram}[${MERMAID_CODE_ATTR}]`)
        ? [el as HTMLElement]
        : []),
      ...Array.from(el.querySelectorAll<HTMLElement>(`.${MERMAID_CLASS_NAMES.diagram}[${MERMAID_CODE_ATTR}]`)),
    ]
    for (const inner of targets) {
      if (inner.parentElement?.classList.contains(GRAPHIC_CHROME_CLASS_NAMES.frame)) {
        continue
      }
      const language = (inner.getAttribute(GRAPHIC_LANG_ATTR) ?? 'mermaid').trim()
      if (!graphicRendererFor(language)) {
        continue
      }
      const code = inner.getAttribute(MERMAID_CODE_ATTR) ?? ''
      wrapGraphicFrame(inner, {
        onPopup: () => {
          openGraphicPopup(language, code)
        },
      })
    }
  }

  /** #212 阅读视图图片按钮组（仅 popup，无 edit——阅读无编辑语义）：
   *  挂载钩子把非链接内嵌、非表格内的图片槽位包进 inline frame 并挂
   *  popup 按钮（幂等；img 是 void 元素不能有子元素，chrome 经 frame
   *  挂为其兄弟——与 live 槽位内 chrome/img 兄弟结构同构，CSS 兄弟选择
   *  器共用）。链接内嵌图片不接（点击保留链接跳转语义）、表格网格内
   *  暂不接（规格明确排除）。
   *  独行图（段落内唯一元素子节点且前后无非空白文本）挂既有
   *  vsidian-image-block 修饰类取块级布局——:only-child 伪类只统计元素
   *  子节点，「文字+图」混排段的 frame 也会命中（文本节点不参与），
   *  误将混排图独占一行，故独行判定在 JS 完成（与 live 侧 soloImageLine
   *  同语义）。 */
  private decorateImageChromeBlock(el: HTMLElement): void {
    if (!(el instanceof HTMLElement)) {
      return
    }
    const images = Array.from(el.querySelectorAll<HTMLImageElement>(`img.${IMAGE_CLASS_NAMES.image}`))
    if (el instanceof HTMLImageElement && el.classList.contains(IMAGE_CLASS_NAMES.image)) {
      images.unshift(el)
    }
    for (const img of images) {
      if (img.closest('a') || img.closest('table')) {
        continue // 链接内嵌 / 表格网格内：行为现状钉住（规格排除项）
      }
      if (img.parentElement?.classList.contains(GRAPHIC_CHROME_CLASS_NAMES.frame)) {
        continue // 幂等：已包 frame
      }
      const rawSrc = img.dataset['vsidianImgSrc'] ?? ''
      if (!rawSrc) {
        continue
      }
      const frame = document.createElement('span')
      frame.className = `${GRAPHIC_CHROME_CLASS_NAMES.frame} ${IMAGE_CLASS_NAMES.image}`
      if (isSoloImageInParent(img)) {
        frame.classList.add(IMAGE_CLASS_NAMES.block)
      }
      img.replaceWith(frame)
      frame.append(
        img,
        buildGraphicChrome({
          onPopup: () => {
            openImagePopup(rawSrc, img.alt)
          },
        }),
      )
      // 贴图收缩标记：虚拟化主路径本钩子在块离屏构建期执行（append 在
      // 其后 reorder），首算经 markImageFrameSized 内部 ResizeObserver
      // 兜底；仅独行块级形态挂载（行内混排无按钮贴图诉求，不挂类）
      if (frame.classList.contains(IMAGE_CLASS_NAMES.block)) {
        markImageFrameSized(frame, img)
      }
    }
  }

/** 宿主明暗主题跟随：body class 变化时热重配 dark 声明（等值跳过）；
 *  #60：Mermaid 主题联动（缓存清空 + 在文档容器重渲染，等值跳过）。
 *  P2-02：CM6 dark 声明的 Compartment 随实例（applyDarkTheme 自带等值
 *  跳过），根只保留 mermaid 联动与 body 观察者 */
  private applyHostTheme(): void {
    const dark = isVscodeDarkBody()
    if (dark === this.hostDarkApplied || !this.view) {
      return
    }
    this.hostDarkApplied = dark
    setMermaidDarkTheme(dark)
    this.live?.applyDarkTheme(dark)
    // P2-04：嵌入内部 Live 实例的明暗热跟随
    this.embedCards?.applyDarkTheme(dark)
  }

}

/** 单条行号对齐采样（collectGutterAlignment 的条目体，#116 flash 审查
 *  F2）：try/catch 包裹单条目——真宿主中个别条目异常（如单条 Range 查询
 *  失败）只跳过该条返回 null，调用方继续采样余下行号；跳过条件（隐藏
 *  格、无可解析行号、无可见正文文本、无有效字体度量）同样返回 null。 */
function collectGutterEntryAlignment(
  view: EditorView,
  element: HTMLElement,
  fontMetric: (font: string) => { ascent: number; descent: number } | null,
): LineGutterAlignment | null {
  try {
    if (element.style.visibility === 'hidden') return null
    const text = element.textContent ?? ''
    if (!text.trim()) return null
    const lineNo = Number.parseInt(text.trim(), 10)
    if (!Number.isFinite(lineNo) || lineNo < 1 || lineNo > view.state.doc.lines) return null
    const line = view.state.doc.line(lineNo)
    const pos = view.domAtPos(line.from)
    const anchor = (pos.node.nodeType === 1 ? pos.node : pos.node.parentElement) as HTMLElement | null
    const lineEl = anchor?.closest('.cm-line')
    if (!lineEl) return null
    const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT)
    // 首个可见文本的宿主元素（取 parentElement，避免与 CM6 Text 导入
    // 重名的 DOM Text 类型）；rect 与宿主同点命中
    let firstTextHost: HTMLElement | null = null
    let firstTextRect: DOMRect | null = null
    while (walker.nextNode()) {
      const value = walker.currentNode.nodeValue ?? ''
      const at = value.search(/\S/)
      if (at < 0) continue
      const range = document.createRange()
      range.setStart(walker.currentNode, at)
      range.setEnd(walker.currentNode, at + 1)
      const rect = range.getBoundingClientRect()
      if (rect.height > 0) {
        firstTextHost = walker.currentNode.parentElement
        firstTextRect = rect
        break
      }
    }
    if (!firstTextHost || !firstTextRect) return null
    const numRange = document.createRange()
    numRange.selectNodeContents(element)
    const numRect = numRange.getBoundingClientRect()
    if (numRect.height <= 0) return null
    // 基线换算：基线 = 文本盒底边 − 该字体 fontBoundingBox descent，
    // 两侧各自 computed font 度量（惰性建 canvas；jsdom 条目在 Range
    // 矩形阶段即抛错跳过，不会触达）
    const numMetric = fontMetric(getComputedStyle(element).font)
    const textMetric = fontMetric(getComputedStyle(firstTextHost).font)
    if (!numMetric || !textMetric) return null
    const deltaBaseline =
      (numRect.bottom - numMetric.descent) - (firstTextRect.bottom - textMetric.descent)
    return {
      num: text.trim(),
      deltaBaseline: +deltaBaseline.toFixed(2),
      deltaBottom: +(numRect.bottom - firstTextRect.bottom).toFixed(2),
    }
  } catch {
    return null
  }
}

/** 字体度量盒缓存工厂（#116 基线换算）：font 串 → measureText 的
 *  fontBoundingBoxAscent/Descent。canvas 2D 惰性创建（首次真实换算才
 *  触达——jsdom 未实现 Range.getBoundingClientRect，条目在矩形阶段即
 *  抛错被逐条跳过，不会触达 canvas、不喷「Not implemented」噪音）；
 *  computed font 串按结果缓存，同一采样内每种字体只量一次。空/空白
 *  font 串直接返回 null：canvas 对无效 font 赋值会静默沿用默认
 *  10px sans-serif，量出的是伪度量而非该元素的实际字体。环境无
 *  canvas 2D 或无 fontBoundingBox 度量时同样返回 null（调用方放弃该
 *  条目，不伪造基线值）。导出侢单测钉住防御行为。 */
export function createFontBoundingBoxMeasurer(): (font: string) => { ascent: number; descent: number } | null {
  let ctx: CanvasRenderingContext2D | null | undefined
  const cache = new Map<string, { ascent: number; descent: number } | null>()
  return (font: string): { ascent: number; descent: number } | null => {
    const cached = cache.get(font)
    if (cached !== undefined) return cached
    let metric: { ascent: number; descent: number } | null = null
    if (!font.trim()) {
      // 空/无效 computed font：不触 canvas（默认字体伪度量），直接放弃
      cache.set(font, null)
      return null
    }
    if (ctx === undefined) {
      try {
        ctx = document.createElement('canvas').getContext('2d')
      } catch {
        ctx = null
      }
    }
    if (ctx) {
      try {
        ctx.font = font
        const measured = ctx.measureText('0')
        if (typeof measured.fontBoundingBoxAscent === 'number' &&
            typeof measured.fontBoundingBoxDescent === 'number') {
          metric = { ascent: measured.fontBoundingBoxAscent, descent: measured.fontBoundingBoxDescent }
        }
      } catch {
        metric = null
      }
    }
    cache.set(font, metric)
    return metric
  }
}

/** Mermaid 图的真实可见区域：视口和各层裁切交集内，命中有效图形子节点。 */
function isSvgPainted(svg: SVGSVGElement): boolean {
  const rect = svg.getBoundingClientRect()
  let left = Math.max(0, rect.left)
  let right = Math.min(window.innerWidth, rect.right)
  let top = Math.max(0, rect.top)
  let bottom = Math.min(window.innerHeight, rect.bottom)
  for (let node: Element | null = svg; node; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (style.display === 'none' || style.contentVisibility === 'hidden' ||
        Number(style.opacity) === 0) return false
    // visibility 可由后代覆写；SVG 的计算值才是它自身的有效值。
    if (node === svg && style.visibility !== 'visible') return false
    if (node === svg) continue
    const clipsBoth = style.clipPath !== 'none' || style.contain.split(' ').includes('paint')
    const clipX = clipsBoth || style.overflowX !== 'visible'
    const clipY = clipsBoth || style.overflowY !== 'visible'
    if (!clipX && !clipY) continue
    const boundary = node.getBoundingClientRect()
    if (clipX) {
      left = Math.max(left, boundary.left)
      right = Math.min(right, boundary.right)
    }
    if (clipY) {
      top = Math.max(top, boundary.top)
      bottom = Math.min(bottom, boundary.bottom)
    }
  }
  if (right <= left || bottom <= top) return false
  const selector = 'path,rect,circle,ellipse,line,polyline,polygon,text,tspan,textPath,image,use,foreignObject'
  for (const graphic of svg.querySelectorAll(selector)) {
    const style = getComputedStyle(graphic)
    if (style.visibility !== 'visible') continue
    let hidden = false
    for (let node: Element | null = graphic; node && node !== svg; node = node.parentElement) {
      const nodeStyle = getComputedStyle(node)
      if (nodeStyle.display === 'none' || nodeStyle.contentVisibility === 'hidden' ||
          Number(nodeStyle.opacity) === 0) {
        hidden = true
        break
      }
    }
    if (hidden) continue
    const tag = graphic.localName.toLowerCase()
    const fill = style.fill !== 'none' && Number(style.fillOpacity) > 0
    const strokeWidth = Number.parseFloat(style.strokeWidth)
    const stroke = style.stroke !== 'none' && Number(style.strokeOpacity) > 0 && strokeWidth > 0
    if (tag === 'foreignobject' ? !graphic.firstElementChild
      : tag !== 'image' && !fill && !stroke) continue
    const bounds = graphic.getBoundingClientRect()
    const pad = stroke ? strokeWidth / 2 : 0
    const drawLeft = Math.max(left, bounds.left - pad)
    const drawRight = Math.min(right, bounds.right + pad)
    const drawTop = Math.max(top, bounds.top - pad)
    const drawBottom = Math.min(bottom, bounds.bottom + pad)
    if (drawRight <= drawLeft || drawBottom <= drawTop) continue
    const xs = [drawLeft + (drawRight - drawLeft) * 0.2, (drawLeft + drawRight) / 2,
      drawRight - (drawRight - drawLeft) * 0.2]
    const ys = [drawTop + (drawBottom - drawTop) * 0.2, (drawTop + drawBottom) / 2,
      drawBottom - (drawBottom - drawTop) * 0.2]
    for (const y of ys) for (const x of xs) {
      const hit = document.elementFromPoint(x, y)
      if (hit === graphic || (hit && graphic.contains(hit))) return true
    }
  }
  return false
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/** 绘制层命中探测（#53 起 sidebar/outline 探针共用）：元素中心点
 *  elementFromPoint 命中 scope（缺省元素自身）才算真实绘制——display:none、
 *  零尺寸或覆盖遮挡时命中失败，几何/存在性探针测不出样式失效 */
function hitPaintedElement(
  el: HTMLElement | null | undefined,
  scope?: HTMLElement,
): boolean {
  if (!el) {
    return false
  }
  try {
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) {
      return false
    }
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    const within = scope ?? el
    return !!hit && within.contains(hit)
  } catch {
    return false
  }
}

/** 多候选绘制探针的代表元素选择（#105/#106）：返回首个真实命中
 *  （hitPaintedElement）的候选——多元素场景下首个候选可能滚出视口
 *  （hr.md 插入用例实测：新分割线在视口内已绘制，首条在上文滚出，
 *  elementFromPoint 对视口外坐标返回 null，取首条会误判不可见）；
 *  全不命中时回退首条（display/computed 字段仍可观测，visible 语义
 *  由调用方按命中与否给出）；空候选返回 null */
export function firstPaintedOf(els: HTMLElement[]): HTMLElement | null {
  for (const el of els) {
    if (hitPaintedElement(el)) {
      return el
    }
  }
  return els[0] ?? null
}

/** #66/#67 绘制层证据共用口径：中心点 elementFromPoint 命中自身（真实
 *  布局与显隐规则生效）且 computed background-color 非全透明（背景规则
 *  生效——located 横条与滑块实心圆点共用；样式失效时任一失守即 false） */
function paintedWithVisibleBackground(el: HTMLElement): boolean {
  if (!hitPaintedElement(el, el)) {
    return false
  }
  try {
    const bg = getComputedStyle(el).backgroundColor
    if (bg === '' || bg === 'transparent') {
      return false
    }
    const rgb = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(bg)
    if (!rgb) {
      return false // 异常形态保守视为未绘制
    }
    return rgb[4] === undefined || Number.parseFloat(rgb[4]!) > 0
  } catch {
    return false
  }
}

/** 齿轮设置图标（#53：lucide-cog 意象，内联 SVG，不引入图标库）。
 *  线宽是图标自身笔画的恒定属性（stroke-width=2），不参与两态变化 */
function createSettingsGearIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const circle = document.createElementNS(SVG_NS, 'circle')
  circle.setAttribute('cx', '12')
  circle.setAttribute('cy', '12')
  circle.setAttribute('r', '3.5')
  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute(
    'd',
    'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08'
      + 'a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51'
      + 'a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08'
      + 'a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2'
      + 'v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73'
      + 'l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74'
      + 'l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0'
      + 'l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
  )
  svg.appendChild(path)
  svg.appendChild(circle)
  return svg
}

/** 侧栏切换图标（#53：Obsidian side-bar-right / lucide panel-right 意象）：
 *  矩形外框 + 右侧竖线。两态粗细差异的唯一来源是样式表（收起细线 1.5px /
 *  展开粗线 3px，随 vsidian-sidebar-open 类切换），SVG 属性上不写
 *  stroke-width——样式失效时两态同值，集成绘制断言据此暴露 */
function createSidebarToggleIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const frame = document.createElementNS(SVG_NS, 'rect')
  frame.setAttribute('class', 'vsidian-sidebar-icon-frame')
  frame.setAttribute('x', '1.75')
  frame.setAttribute('y', '2.75')
  frame.setAttribute('width', '12.5')
  frame.setAttribute('height', '10.5')
  frame.setAttribute('rx', '1.5')
  const bar = document.createElementNS(SVG_NS, 'line')
  bar.setAttribute('class', 'vsidian-sidebar-icon-bar')
  bar.setAttribute('x1', '11')
  bar.setAttribute('y1', '2.75')
  bar.setAttribute('x2', '11')
  bar.setAttribute('y2', '13.25')
  svg.appendChild(frame)
  svg.appendChild(bar)
  return svg
}

/** #141 双态视图切换图标（lucide book / pencil 意象，内联 SVG）：书（当前
 *  在阅读）与笔（当前在 Live）两图标常驻按钮，显隐唯一来源是 main.css 按
 *  body 模式类（vsidian-mode-live / vsidian-mode-reading）的切换规则——
 *  样式失效时两图标同显，浏览器绘制断言据此暴露（侧栏两态图标同款哲学） */
function createViewToggleIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const book = document.createElementNS(SVG_NS, 'path')
  book.setAttribute('class', 'vsidian-view-toggle-book')
  book.setAttribute('d', 'M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20')
  const edit = document.createElementNS(SVG_NS, 'path')
  edit.setAttribute('class', 'vsidian-view-toggle-edit')
  edit.setAttribute('d', 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.642 16.374a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z')
  svg.appendChild(book)
  svg.appendChild(edit)
  return svg
}

/** #208 刷新嵌入资源图标（lucide refresh-cw 意象，内联 SVG，不引入图标
 *  库）：顺时针循环双箭头（首尾相衔的圆弧 + 两个端头箭头），线宽与齿轮/
 *  双态图标同为恒定 stroke-width=2 */
function createRefreshIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '2')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  const arcTop = document.createElementNS(SVG_NS, 'path')
  arcTop.setAttribute('d', 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8')
  const headTop = document.createElementNS(SVG_NS, 'path')
  headTop.setAttribute('d', 'M21 3v5h-5')
  const arcBottom = document.createElementNS(SVG_NS, 'path')
  arcBottom.setAttribute('d', 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16')
  const headBottom = document.createElementNS(SVG_NS, 'path')
  headBottom.setAttribute('d', 'M8 16H3v5')
  svg.appendChild(arcTop)
  svg.appendChild(headTop)
  svg.appendChild(arcBottom)
  svg.appendChild(headBottom)
  return svg
}

/** VSCode webview 明暗主题判定：深色（vscode-dark）与暗色高对比
 *  （vscode-high-contrast）为暗；浅色（vscode-light）与亮色高对比
 *  （vscode-high-contrast-light）为亮。body class 由 VSCode 随主题
 *  实时更新，观察者见 WebviewSyncController.applyHostTheme */
export function isVscodeDarkBody(body: HTMLElement = document.body): boolean {
  const cl = body.classList
  return cl.contains('vscode-dark') || cl.contains('vscode-high-contrast')
}

/** webview CSP 下 WebAssembly 编译能力探针（#241 评审修复 P0-1）：8 字节
 *  空模块（\0asm 版本 1）同步编译——CSP script-src 无 'wasm-unsafe-eval'
 *  时同步抛错。结果缓存（能力不随文档变化）；在真实宿主 webview 内执行，
 *  为 jieba wasm 实例化路径提供词法断言之外的行为级证据（#37 教训：
 *  CSP 边界必须在真实 webview 宿主验证）。 */
let webviewWasmCompileCapable: boolean | null = null
function probeWebviewWasmCompile(): boolean {
  if (webviewWasmCompileCapable === null) {
    try {
      void new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))
      webviewWasmCompileCapable = true
    } catch {
      webviewWasmCompileCapable = false
    }
  }
  return webviewWasmCompileCapable
}
