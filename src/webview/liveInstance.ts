// Live 实例上下文（P2-02 / #279，规格 docs/specs/hover-preview-embed.md
// 「架构责任与迁移」）：从主控制器提炼的最小可复用 Live 编辑器入口——
// 正文 EditorView 创建、目标文本同步（增量/全文/ack/冲突暂停）、编辑
// 意图（本地出站、IME 组合缓冲、撤销分段、历史转发）与实例拥有的
// CM6 扩展装配（设置 Compartment 热重配）。
//
// 实例不持有侧栏/顶栏/设置页等根 chrome，也不接管全局消息接收；全部
// 外部依赖（出站通道、持久化时机、资源来源、Live 激活态、装配时刻的
// 明暗态）经构造 deps 注入——不默认读取 this.view 之外的唯一全局编辑器
// 或桥状态。根特性（横幅、阅读刷新、模式锚点恢复、事务旁路观测）经
// 可选 hook 随实例内部时机联动；hook 未提供时实例行为自洽（jsdom 契约
// 用例直接以裸实例驱动）。
//
// 同步语义头注释（乐观回显/外部增量映射/冲突暂停/撤销分段/IME 组合
// 缓冲）随本模块自 syncController 迁入，正文见各方法内注释；协议约定
// webview 全程 LF 坐标。本票为准备性 expand 改造：不接入引用目标 B 的
// 生产写端口，不引入独立 history（撤销权威仍在宿主 TextDocument）。
import { Annotation, ChangeSet, Compartment, EditorSelection, EditorState, Prec, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, keymap, type ViewUpdate } from '@codemirror/view'
import { contextMenuClickWithinSelection } from '../shared/contextMenu'
import type { DocumentChangeReason, HostToWebview, PasteHistory, PasteStage, SerChange, WebviewToHost } from '../shared/protocol'
import type { AddonApplyEditsResult, AddonEditorSnapshot, AddonSelectionRange } from '../shared/addonEditApi'
import type { EditOriginMeta } from '../shared/editOrigin'
import {
  CODEBLOCK_CARD_DEFAULT,
  CODEBLOCK_CARD_KEY,
  CODEBLOCK_COPY_BUTTON_DEFAULT,
  CODEBLOCK_COPY_BUTTON_KEY,
  CODEBLOCK_HIGHLIGHT_DEFAULT,
  CODEBLOCK_HIGHLIGHT_KEY,
  CODEBLOCK_LINE_NUMBERS_DEFAULT,
  CODEBLOCK_LINE_NUMBERS_KEY,
  IMAGE_PASTE_DEFAULT,
  IMAGE_PASTE_KEY,
  MULTI_CURSOR_DEFAULT,
  MULTI_CURSOR_KEY,
  SHOW_LINE_NUMBERS_DEFAULT,
  SHOW_LINE_NUMBERS_KEY,
  SYMBOL_AUTOCOMPLETE_DEFAULT,
  SYMBOL_AUTOCOMPLETE_KEY,
  SYMBOL_SELECTION_WRAP_DEFAULT,
  SYMBOL_SELECTION_WRAP_KEY,
  SYMBOL_TAB_ESCAPE_DEFAULT,
  SYMBOL_TAB_ESCAPE_KEY,
  TABLE_BLOCK_RENDER_DEFAULT,
  TABLE_BLOCK_RENDER_KEY,
  type SettingsPayload,
} from '../shared/settings'
import { liveDecorationsField, livePreviewDecorations, tableCompositionSettled, tableContainerRenderFacet } from './liveDecorations'
import { createLinkInteractions } from './liveLinks'
import { liveMath } from './liveMath'
import { liveMermaid, rendererLanguagesChanged } from './liveMermaid'
import { liveEmbed } from './liveEmbed'
import { liveBlockId } from './liveBlockId'
import { anchorFlash } from './anchorFlash'
import { codeCardConfigFacet, codeCardCopyRequest, codeCardFoldField, codeCardHoverReveal, liveCodeCard, type CodeCardConfig } from './liveCodeCard'
import { frontmatterEditing } from './frontmatterEditing'
import { liveLineNumbers } from './liveLineNumbers'
import { symbolAutocomplete } from './symbolAutocomplete'
import { symbolSelectionWrap } from './symbolWrap'
import { multicursorExtensions } from './multicursor'
import { listEditing } from './listEditing'
import { indentEditing } from './indentEditing'
import { fenceEscape } from './fenceEscape'
import { findDecorations } from './findSession'
import { blankRowInputPlan, clampExternalCursor, tableEditing, tableRowsAt } from './tableEditing'
import { prefixLenOf } from './tableStructure'
import { tableRegionField } from './tableRegionSelection'
import { planTableRegionReplace, type TableRegion } from './tableRegion'
import { splitTableRowCells } from '../shared/tableCells'
import { ImageResourceManager } from './imageResource'
import { createImagePaste, imagePasteCanInsertAt } from './imagePaste'
import { registerImagePopupSource, unregisterImagePopupSource, type ImagePopupSource } from './imagePopup'
import { createWikilinkSuggest, type WikilinkSuggestController } from './wikilinkSuggest'

/** 外部同步事务标记：updateListener 见到它即跳过（不回发）。
 *  性能探针（#5）复用同一注解——探针编辑走渲染路径但不写回宿主。
 *  P2-02 起随同步机制本体迁入本模块；symbolAutocomplete /
 *  frontmatterEditing / perfProbe 经 re-export 或直连消费同一实例 */
export const externalSync = Annotation.define<boolean>()

/** T06（#355）附加组件修饰事务标记：applyAddonEdit 派发的事务携带，
 *  出站管线（recordLocalChangeSet）读它把来源元数据附加到 edit.request
 *  的 origin 字段（单笔单值 / 同组未提交合并数组）。来源身份由 SDK 注入
 *  （addonId/opId），作者请求不可携带——不能冒充其他组件 */
export const addonEditOriginTag = Annotation.define<{ origins: EditOriginMeta[] }>()

/** T06（#355）SDK applyEdits 实例侧实现——事务净插入长度（选区边界校验） */
function totalInserted(changes: readonly { text: string }[]): number {
  return changes.reduce((sum, c) => sum + c.text.length, 0)
}

/** T06（#355）SDK applyEdits 的提交凭据路由：opId → 结算回调。出站请求
 *  确认（ack ok / 业务拒绝 / 失败 / 释放）时逐 opId 恰好结算一次 */
type AddonPendingResolver = (result: AddonApplyEditsResult) => void

/** #153 撤销分段停顿阈值（ms）：连续输入停顿达到该时长，或用户主动移
 *  光标（点击 / 方向键选区移动），下一笔输入即开新撤销段——每段独立一笔
 *  edit.request = 一条宿主 undo 记录，对齐 VSCode 原生「停顿数百毫秒或
 *  光标变化即新段」的可预期手感。数值以 VSCode 手感对齐为起点，验收阶段
 *  按真实手感校准仅调此常量；如需暴露为用户设置另开工单。IME 组合进行
 *  中不切段（一次组合的提交永不跨段，切分点最早落在组合提交之后）；
 *  触碰暂缓/组合攒批继续承担传输合并，但不再决定撤销分段（分段边界以
 *  切分点记录，ack 收敛后的出站按切分点拆多笔依次发出）。
 *  判定用 Date.now（fake timers 的 Date 可驱动，测试见 undoSegmentation） */
const UNDO_SEGMENT_PAUSE_MS = 500

/** #153 主动移光标的导航键集合（不含修改键差异——Shift+方向键选区移动
 *  同样开新段）：这些键的 keydown 意味着用户主动移动了插入点/选区；纯
 *  输入导致的光标后移不触发分段 */
const UNDO_SEGMENT_NAV_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'Home', 'End', 'PageUp', 'PageDown',
])

/** ChangeSet 展开的段表（定义域系坐标）：fromA/toA 为定义域区间，insLen 插入长度 */
interface ChainSection {
  fromA: number
  toA: number
  insLen: number
}

function chainSections(cs: ChangeSet): ChainSection[] {
  const out: ChainSection[] = []
  cs.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    out.push({ fromA, toA, insLen: inserted.length })
  })
  return out
}

/**
 * 本地系坐标逆穿段表回定义域（baseVersion）系（C-2 出站方向）。
 * 插入/替换内容内部塌缩到段起点。调用方须先暂缓与插入内容相交的
 * 出站编辑；协议 offset/length 无法表达其内部位置或同点关联侧。
 */
function localPosToBase(p: number, sections: readonly ChainSection[]): number {
  let delta = 0
  for (const s of sections) {
    const afterStart = s.fromA + delta
    const afterEnd = afterStart + s.insLen
    if (p <= afterStart) {
      return p - delta
    }
    if (p >= afterEnd) {
      delta += s.insLen - (s.toA - s.fromA)
      continue
    }
    return s.fromA
  }
  return p - delta
}

/** 新编辑触及未确认变更的插入内容或纯删除塌缩点时，无法安全逆投影。
 *  纯删除虽无插入内容，紧接着在原位置补字（IME 替换选区的常见顺序）
 *  仍依赖前笔删除；若立即发旧基线坐标，宿主会与自己的删除判为冲突。 */
function touchesUnconfirmedChange(
  changes: readonly SerChange[],
  sections: readonly ChainSection[],
): boolean {
  let delta = 0
  for (const s of sections) {
    const afterStart = s.fromA + delta
    const afterEnd = afterStart + s.insLen
    if (changes.some((c) => {
      if (s.insLen > 0) {
        return c.length === 0
          ? c.offset >= afterStart && c.offset <= afterEnd
          : c.offset < afterEnd && c.offset + c.length > afterStart
      }
      return s.fromA < s.toA && (c.length === 0
        ? c.offset === afterStart
        : c.offset <= afterStart && c.offset + c.length > afterStart)
    })) {
      return true
    }
    delta += s.insLen - (s.toA - s.fromA)
  }
  return false
}

/** 逆穿已确认链后的变更：端点携带关联语义（正穿未确认集时保持前后次序） */
interface UnmappedChange extends SerChange {
  fromAssoc: 1 | -1
  toAssoc: 1 | -1
}

/**
 * 把一组「权威系（已含已确认事务）」增量逆平移回 unconfirmed 定义域
 * （baseVersion）系（C-2 入站方向）：外部增量坐标已含已确认编辑，
 * 直接穿未确认集会多平移已确认部分。端点落在已确认段的插入内容
 * 严格内部、或纯删除段的塌缩点上时归属二义，返回 null（冲突暂停）。
 */
function unmapSerGroupThroughAcked(
  changes: readonly SerChange[],
  chain: ChangeSet,
): UnmappedChange[] | null {
  const sections = chainSections(chain)
  const unmapPos = (p: number): { pos: number; assoc: 1 | -1 } | null => {
    let delta = 0
    for (const s of sections) {
      const afterStart = s.fromA + delta
      const afterEnd = afterStart + s.insLen
      if (s.insLen === 0 && p === afterStart) {
        return null // 纯删除段塌缩点：原被删区间内归属二义
      }
      if (p < afterStart) {
        return { pos: p - delta, assoc: -1 }
      }
      if (p === afterStart) {
        return { pos: s.fromA, assoc: -1 }
      }
      if (p === afterEnd) {
        delta += s.insLen - (s.toA - s.fromA)
        return { pos: p - delta, assoc: 1 }
      }
      if (p > afterEnd) {
        delta += s.insLen - (s.toA - s.fromA)
        continue
      }
      return null // 已确认段插入内容严格内部：与已确认内容冲突
    }
    return { pos: p - delta, assoc: -1 }
  }
  const out: UnmappedChange[] = []
  for (const c of changes) {
    const from = unmapPos(c.offset)
    const to = unmapPos(c.offset + c.length)
    if (!from || !to || from.pos > to.pos) {
      return null
    }
    out.push({
      offset: from.pos,
      length: to.pos - from.pos,
      text: c.text,
      fromAssoc: from.assoc,
      toAssoc: to.assoc,
    })
  }
  return out
}

/**
 * 把一组外部增量（坐标基于缓冲开始前的文档）映射穿过缓冲挂起期间累积的
 * 本地变更（通常为组合上屏事务）。真重叠（区间相交、同点双插入或区间
 * 跨过插入点——归属/顺序二义）返回 null，保守交由冲突暂停处理；
 * 端点仅相邻时按关联语义平移（C-3：CM6 touchesRange 对相邻也返回 true，
 * 不能直接用它判定冲突）。
 */
function mapSerGroupThroughCm(
  changes: readonly (SerChange & Partial<UnmappedChange>)[],
  local: ChangeSet,
): SerChange[] | null {
  const out: SerChange[] = []
  for (const c of changes) {
    const from = c.offset
    const to = c.offset + c.length
    if (conflictsWithLocal(from, to, c.fromAssoc ?? -1, local)) {
      return null
    }
    const mappedFrom = local.mapPos(from, c.fromAssoc ?? -1)
    const mappedTo = local.mapPos(to, c.toAssoc ?? 1)
    out.push({ offset: mappedFrom, length: mappedTo - mappedFrom, text: c.text })
  }
  return out
}

/** 外部区间与本地变更段是否真重叠（C-3）。
 *  fromAssoc=1 表示外部插入点语义在段插入内容之后（顺序已由逆穿确定），
 *  同点不再视为顺序二义；默认 -1（无上下文）时同点双插入仍判冲突。 */
function conflictsWithLocal(
  from: number,
  to: number,
  fromAssoc: 1 | -1,
  local: ChangeSet,
): boolean {
  let conflict = false
  local.iterChanges((fromA, toA) => {
    if (fromA === toA) {
      if (from === to) {
        if (from === fromA && fromAssoc !== 1) {
          conflict = true // 同点双插入且顺序未定：二义
        }
      } else if (from < fromA && to > fromA) {
        conflict = true // 外部区间跨过插入点：本地插入内容归属二义
      }
    } else if (from < toA && to > fromA) {
      conflict = true // 标准区间相交（端点相邻不算）
    }
  })
  return conflict
}

interface BufferedIncremental {
  /** #314 分步撤销：doc.changed 的来源与粘贴归属（flush 收敛时随末组
   *  回调根做撤销选区恢复；缓冲期间不丢失） */
  reason?: DocumentChangeReason
  paste?: PasteHistory
  version: number
  /** 增量（权威变更前系；入队时点的参考系） */
  changes: SerChange[]
  /** 入队时逆穿当时已确认链得到的 baseVersion 系增量；null = 与当时已确认
   *  编辑二义，无法安全逆映射（flush 时按冲突暂停处理）。
   *  为何入队即逆穿：组合编辑的 ack 可能在 flush 之前到达并复合进已确认链，
   *  届时缓冲增量的参考系（不含组合编辑）与已确认链（含）不再一致，迟到
   *  的逆穿会多平移组合编辑部分（#12 表格 IME 场景实测暴露） */
  baseChanges: SerChange[] | null
}

/** 右键保选区（#186 关键 bug 1）：Chrome contenteditable 上右键 mousedown
 *  的默认行为会把选区折叠/重定位到点击处——选好的单元格/文本选区被右键
 *  清掉。两类命中都 preventDefault（VSCode 原生编辑器同款），contextmenu
 *  事件不受影响照常触发：右键落在 CM6 选区内（含端点）；或落在活跃表格
 *  矩形蒙版的表格行区间内（蒙版态 CM6 选区折叠在锚格，选区判定不覆盖，
 *  而 caret 跳移会经选区变化清掉蒙版）。点在选区与蒙版外放行默认（右键
 *  前光标落到点击处，菜单作用于右键点） */
const contextMenuSelectionGuard = EditorView.domEventHandlers({
  mousedown(event: MouseEvent, view: EditorView): boolean {
    if (event.button !== 2) return false
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
    if (pos === null) return false
    let keep = contextMenuClickWithinSelection(view.state.selection.ranges, pos)
    if (!keep) {
      const region = view.state.field(tableRegionField, false)
      if (region) {
        // 蒙版行区间：rowTo 是内容行索引（表头 0），分隔行在表头之后——
        // 内容行 n>0 的源行号 = 首行 + n + 1（跳过分隔行）
        const doc = view.state.doc
        const first = doc.lineAt(region.tableFrom).number
        const last = first + region.rowTo + (region.rowTo > 0 ? 1 : 0)
        const lineNo = doc.lineAt(pos).number
        keep = lineNo >= first && lineNo <= last
      }
    }
    if (keep) event.preventDefault()
    return false
  },
})

/** 实例外部依赖：全部经构造注入，实例不自建出站通道/持久化/资源来源，
 *  也不读取唯一全局编辑器（焦点与操作目标由此闭合在实例内） */
export interface LiveEditorInstanceDeps {
  /** 出站通道：edit.request / conflict.report / composition.changed /
   *  history.request / link.activate / wikilink.activate / image.paste /
   *  codeblock.copy 等实例消息（根包装桥或测试采集器） */
  send(message: WebviewToHost): void
  /** seq / conflictRevision 变更后的持久化时机（根合并进面板持久状态） */
  persistState(): void
  /** 图片资源来源（链接/图片装饰消费；生命周期归调用方，P2-11 迁移接线） */
  images: ImageResourceManager
  /** Live 激活态（根模式状态机投影；reading 下编辑意图按既有口径门控） */
  isLiveActive(): boolean
  /** 装配时刻的宿主明暗态（darkCompartment 初始值；热跟随经 applyDarkTheme） */
  initialDark: boolean
  /** webview 重载恢复的持久化初值（seq / conflictRevision） */
  initialSeq?: number
  initialConflictRevision?: number
  /** 冲突暂停横幅等根 chrome 联动（未提供时实例自身状态机照常运转） */
  onSuspendedChange?(active: boolean): void
  /** 外部增量/缓冲应用后（根刷新阅读视图等跟随动作） */
  onExternalTextApplied?(): void
  /** 全文装载完成（根刷新阅读、恢复模式锚点与骨架撤除；restoreAnchor
   *  仅 init 路径为 true——缓冲路径吞掉的锚点恢复是既有行为，不在本票扩面） */
  onFullSyncApplied?(opts: { restoreAnchor: boolean }): void
  /** 根特性的事务旁路观测（快速操作条刷新/模式锚点/查找/大纲随事务联动；
   *  在实例同步簿记之前调用，保持原 updateListener 内的先后次序） */
  onViewUpdate?(update: ViewUpdate): void
  /** P2-05（#282）本地输入从「在途/组合中」翻转到「全部落定」的一次性通知
   *  （关闭/退出意图的输入保护：挂起的意图在此时重新检查最新 dirty）。
   *  只在 pending → idle 翻转时触发；持续 idle 不重复通知 */
  onLocalInputSettled?(): void
  /** P2-11（#288）图片弹窗实例上下文：编辑器内图片弹窗打开时捕获实例
   *  资源身份（B 管理器 / B 全文 / B 来源导出）。生命周期随实例——
   *  构造注册、destroy 注销；缺省不注册（主正文回落全局上下文） */
  imagePopupSource?: ImagePopupSource
  /** #314 粘贴事务 ack 落定（ok 分支、剥离已确认队列**之前**回读）：
   *  根据此标记 pasteFeedback 的 landed；粘贴/纯图粘贴反馈的释放时机
   *  由根在 ack 代理后统一驱动 */
  onPasteTxnAcked?(meta: { paste: PasteStage | null; plainPasteFeedback: string | null }): void
  /** #314 doc.changed 过版本单调防线后回调（对齐 main 版在暂停判定前
   *  作废未落定 rich 反馈的时机；空变更不触发） */
  onExternalDocArrived?(): void
  /** #314 外部增量应用落定后回调（直发路径每组一次；组合 flush 收敛时
   *  对末组一次）：根做分步撤销选区恢复（finishPasteHistory）与粘贴
   *  反馈释放。仅根实例接线——嵌入实例的 undo 回流属已知边界不接 */
  onExternalDocSettled?(message: { reason?: DocumentChangeReason; paste?: PasteHistory }): void
  /** #314 撤销/重做意图进入（requestHistory 守卫前）：根作废未落定
   *  rich 反馈——撤销会回流重写粘贴历史，不再提示「已保留格式」 */
  onHistoryIntent?(): void
  /** #314 原生 paste 事件带 text/html 且无图片文件时的接管钩子（实例
   *  的 paste domEventHandler 拦截后交根：html→markdown 转换、弹窗
   *  决策与快照管线在根）。返回 true = 根接管（实例 preventDefault）；
   *  未提供或返回 false 放行默认粘贴链（嵌入实例缺省回落原生粘贴） */
  onRichPasteHtml?(payload: { view: EditorView; html: string; text?: string }): boolean
  /** #376 T01 双链联想会话启用（#381 T06 起主正文与内部 Live 实例都启用
   *  ——内部 B 的查询经 refEdit.message 信封出站、回包经 refEdit.push 信封
   *  定向回推，接线在 embedCard 侧；缺省 false 供测试等环境显式关闭） */
  enableWikilinkSuggest?: boolean
  /** #379 T04 双链联想的轻提示通道（重复标题风险提示等）：根 toast 面的
   *  注入点；缺省静默跳过（无 toast 面的装配不阻塞确认） */
  notifyToast?(text: string, severity: 'neutral' | 'warning' | 'error'): void
}

/**
 * Live 编辑器实例：一个目标文档正文的可写 CM6 实例及其同步/编辑意图。
 * 主正文由根 WebviewSyncController 经本入口创建（P2-02 起主面板唯一创建
 * 路径）；引用视图实例（悬停/嵌入）由后续切片按同一入口接入。
 */
export class LiveEditorInstance {
  /** 实例编辑器视图（创建后到 destroy 前非空） */
  view: EditorView | undefined
  /** 目标会话身份（init 时由根 setSession；出站消息的目标戳记） */
  private sessionId = ''
  private docUri = ''
  private baseVersion = 0
  private seq: number
  private readonly deps: LiveEditorInstanceDeps

  // ---- 设置状态（Live 扩展组的 Compartment 热重配；快照归实例自持）----
  private settings: SettingsPayload | undefined
  private lineNumbersOn = SHOW_LINE_NUMBERS_DEFAULT
  private readonly lineNumbersCompartment = new Compartment()
  private tableBlockRenderOn = TABLE_BLOCK_RENDER_DEFAULT
  private readonly tableRenderCompartment = new Compartment()
  private codeCardConfig: CodeCardConfig = {
    card: CODEBLOCK_CARD_DEFAULT,
    lineNumbers: true,
    copyButton: true,
    highlight: true,
  }
  private readonly codeCardCompartment = new Compartment()
  private symbolAutocompleteOn = SYMBOL_AUTOCOMPLETE_DEFAULT
  private readonly symbolAutocloseCompartment = new Compartment()
  private symbolSelectionWrapOn = SYMBOL_SELECTION_WRAP_DEFAULT
  private readonly symbolSelectionWrapCompartment = new Compartment()
  private multicursorOn = MULTI_CURSOR_DEFAULT
  private readonly multicursorCompartment = new Compartment()
  private tabEscapeOn = SYMBOL_TAB_ESCAPE_DEFAULT
  private readonly tabEscapeCompartment = new Compartment()
  private readonly darkCompartment = new Compartment()
  /** #351 T02 附加组件扩展槽：V02 放行结论的生产缺口——附加组件的
   *  CM6 扩展经本 Compartment 空槽接入（装载器 registerExtension →
   *  reconfigureAddonExtensions 驱动；null 摘除）。置于扩展数组末尾：
   *  附加组件扩展不参与内置 keymap/filter 的顺序竞争（keymap 正序、
   *  filter 逆序——组件扩展靠后装配即不先于内置看到事务） */
  private readonly addonExtensionCompartment = new Compartment()
  private hostDarkApplied: boolean | undefined
  /** #376 T01 双链联想会话（#381 T06 起主正文与内部 Live 实例都按
   *  deps.enableWikilinkSuggest 装配；关闭时为 null） */
  private readonly wikilinkSuggest: WikilinkSuggestController | null
  /** #161 图片粘贴：面板内自增 reqId 与在途集合（结果按 reqId 路由，
   *  陈旧/未知 reqId 的回包丢弃，防止重复插入）；总开关运行时读设置
   *  快照（handler 每次事件自取，无需 Compartment——未命中直接放行） */
  private imagePasteReqId = 0
  private readonly imagePastePending = new Set<number>()
  /** #314 粘贴元数据通道（随实例）：withPasteMeta 包裹的同步执行期间，
   *  实例内 dispatch 触发的出站（recordLocalChangeSet 直发与暂缓段）附上
   *  这份元数据——edit.request 的 paste 协议字段、sentTxns/deferredSegments
   *  的回读源。P2-02 后出站管线随实例，main 版根级 recordingPasteStage
   *  瞬时标记的职责由此承接（根级同名标记仍存，用于 onViewUpdate 豁免
   *  与反馈释放守卫，不再参与出站） */
  private currentPasteMeta: { paste?: PasteStage; plainPasteFeedback?: string } | undefined

  // ---- 冲突暂停状态（#4）----
  /** 暂停写回：保留本地文本、忽略外部增量、不再发送 edit.request */
  private suspended = false
  private conflictRevision: number
  /** T06（#355）快照修订标记：页面文档代次计数——本地输入与外部同步
   *  （增量/全文重置）都推进。getSnapshot 返回当前值；applyEdits 请求
   *  携带快照值，执行时点失配即拒绝 stale-snapshot（覆盖「宿主版本未变
   *  但页面有未确认输入」窗口——设计 §5.1 修订标记不能只看宿主版本） */
  private docRevision = 0
  /** T06（#355）SDK applyEdits 凭据路由（opId → 结算回调）：出站请求终态
   *  （ack ok/业务拒绝/失败）或释放（destroy/暂停）时逐 opId 恰好一次 */
  private readonly addonPending = new Map<string, AddonPendingResolver>()
  /** 发出后未收 ok ack 的请求 seq 集合（全部确认后未确认集清空） */
  private inFlight = new Set<number>()
  /** 未确认变更集：本地文档相对 baseVersion 权威文本的累积变更；
   *  外部增量到达时必须平移穿过它（否则静默错位） */
  private unconfirmed: ChangeSet | null = null
  /** 已发出未确认事务（FIFO）：坐标为发出时逆穿未确认集的 baseVersion 系
   *  投影（C-2），ack ok 后按序剥离复合进已确认链。#314 粘贴元数据
   *  （paste 协议字段 / plainPasteFeedback 本地反馈 ID）随事务携带：
   *  ack 剥离前回读驱动根的反馈落定。T06（#355）origins：SDK applyEdits
   *  事务的来源列表（凭据路由按 opId 结算） */
  private sentTxns: { seq: number; changes: SerChange[]; paste?: PasteStage; plainPasteFeedback?: string; origins?: EditOriginMeta[] }[] = []
  /** 首笔无法安全逆投影的事务起，后续本地事务合并在同一待发 ChangeSet。
   *  定义域是所有已发送事务之后的本地文档，全部 ack 后可直接作为新请求。 */
  private deferredLocal: ChangeSet | null = null
  /** #153 撤销分段：暂缓集按撤销段切分的 ChangeSet 序列（与 deferredLocal
   *  平行维护，恒满足 composeAll(段序列) === deferredLocal）。每段定义域为
   *  该段开始时的本地文档；sendDeferredLocal 每次只出站队首段（余段留守
   *  暂缓集），队首段 ack 收敛后依次出站——每段一笔 edit.request = 一条
   *  宿主 undo 记录。重置与 deferredLocal 同步。#314 粘贴元数据随段携带
   *  （段出站时附到 sentTxns 与 edit.request）。T06（#355）origins 随段
   *  携带；同组段在此合并（原子段 + 并入的 joinPrevious 段拼接来源列表
   *  出站 = 一条宿主历史项，逐次来源保留） */
  private deferredSegments: { changes: ChangeSet; paste?: PasteStage; plainPasteFeedback?: string; origins?: EditOriginMeta[] }[] = []
  /** #153 撤销分段：最近一笔本地输入（含组合候选事务）的时间戳；null
   *  表示尚无本地输入（不启动停顿计时）。停顿判定是惰性的——只在下一笔
   *  输入/组合开始时回看间隔，不设分段定时器 */
  private lastLocalInputAt: number | null = null
  /** #153 撤销分段：用户主动移过光标（点击/导航键）的一次性边界标记，
   *  由 markUndoSegmentBoundary 置位、recordLocalChangeSet 消费；组合
   *  进行中不置位（组合原子性优先），组合开始时刻的停顿由
   *  markPauseBoundary 单独判定 */
  private undoCursorBoundary = false
  /** deferredLocal 的来源标志（#123）：组合期间暂缓的净输入为 true（外部
   *  增量并存时经 base 系映射应用，不走触碰式保守暂停）；触碰未确认区间
   *  的暂缓为 false（与外部并存时保留 #4 的暂停口径）。出站/清空同步复位 */
  private deferredFromComposition = false
  /** #148 undo 竞态守卫：本地存在未落地宿主的编辑时暂存的撤销/重做意图，
   *  按按下序累积（键盘重复/连按不折叠）。此态下宿主撤销栈顶还不是这些
   *  编辑，先发 history.request 会撤到更早的操作，迟到的本地编辑再经重定位
   *  静默应用。待本地编辑全部落地确认后经 releasePendingHistory 按序发出；
   *  进入冲突暂停时随 B-4 口径丢弃（暂停面板的撤销忽略，不补发） */
  private pendingHistoryOps: ('undo' | 'redo')[] = []
  /** 已确认事务复合（定义域 = unconfirmed 定义域 = baseVersion 系）：
   *  外部增量（权威系坐标）先逆穿它平移回 base 系再穿未确认集（C-2），
   *  避免把「已含已确认编辑」的坐标当 base 系多平移 */
  private ackedChain: ChangeSet | null = null

  // ---- IME 组合缓冲状态 ----
  /** 组合进行中（DOM compositionstart..compositionend） */
  private composing = false
  /** 空白格或矩形区域的组合暂缓：宿主只接收结束后的净变更。 */
  private blankComposition: { startState: EditorState; changes: ChangeSet | null; region?: TableRegion } | null = null
  private compositionCommittedText: string | null = null
  /** 组合期间到达、待 flush 的外部增量（按到达序） */
  private pendingExternal: BufferedIncremental[] = []
  /** 组合期间到达、待 flush 的全文消息（覆盖增量形态）。source 记录来源
   *  （B-1）：resync 对暂停面板兼作恢复信号，flush 的暂停分支据此解除暂停；
   *  ack 失败附文与 init 只重置文本、不解除暂停 */
  private pendingFull:
    | { version: number; text: string; source: 'resync' | 'init' | 'ack-fail' }
    | undefined
  /** 缓冲挂起期间收到的 ack 版本（flush 时与缓冲版本取 max） */
  private pendingVersionAck: number | undefined
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  /** 最近一次接受的 doc.changed 版本（C-4 单调防线：重复/迟到广播直接
   *  丢弃，覆盖直发与组合排队两条路径，防止同版本增量重复应用） */
  private lastDocChangedVersion = 0

  constructor(parent: HTMLElement, deps: LiveEditorInstanceDeps, extraExtensions: Extension[] = []) {
    this.deps = deps
    this.seq = typeof deps.initialSeq === 'number' && deps.initialSeq >= 0 ? Math.floor(deps.initialSeq) : 0
    this.conflictRevision = typeof deps.initialConflictRevision === 'number' && deps.initialConflictRevision >= 0
      ? Math.floor(deps.initialConflictRevision) : 0
    this.hostDarkApplied = deps.initialDark
    this.wikilinkSuggest = deps.enableWikilinkSuggest === true
      ? createWikilinkSuggest({
        send: (message) => this.deps.send(message),
        getSession: () => this.sessionId ? { sessionId: this.sessionId, docUri: this.docUri } : null,
        isLiveActive: () => this.deps.isLiveActive(),
        isSuspended: () => this.suspended,
        isExternal: (tr) => tr.annotation(externalSync) === true,
        // #379 T04 重复标题风险提示（根 toast 面经 deps 注入；缺省静默）
        showToast: (text, severity) => this.deps.notifyToast?.(text, severity),
        // F3 无 ID 块接受的未出站编辑核对：宿主系 markerLfOffset 基于权威
        // 文本，本地有未出站编辑时先推进出站并刷新查询，落定后重按确认
        hasUnsentLocalEdits: () => this.hasUnsentLocalEditsNow(),
        scheduleFlush: () => this.requestFlushNow(),
      })
      : null
    this.view = new EditorView({
      parent,
      state: EditorState.create({ doc: '', extensions: this.extensions(extraExtensions) }),
    })
    this.wikilinkSuggest?.attach(this.view)
    // P2-11：图片弹窗实例上下文随实例注册（按 EditorView 反查——widget
    // 的 popup 按钮打开弹窗时捕获所属实例的资源身份，不读主正文）
    if (deps.imagePopupSource && this.view) {
      registerImagePopupSource(this.view, deps.imagePopupSource)
    }
  }

  // ---- 会话身份与观测（根 chrome / 探针消费；只读透出）----

  /** 目标会话身份（init 时由根设置；未初始化返回空串） */
  get targetSessionId(): string {
    return this.sessionId
  }

  get targetDocUri(): string {
    return this.docUri
  }

  /** 撤销分段持久化字段（根合并进面板 PersistedState） */
  get seqNow(): number {
    return this.seq
  }

  get conflictRevisionNow(): number {
    return this.conflictRevision
  }

  /** 冲突暂停态（根命令门控/探针消费） */
  get isSuspended(): boolean {
    return this.suspended
  }

  /** P2-05（#282）本地输入是否在途/组合中：IME 组合、空白格组合暂缓、
   *  未 ack 的 edit.request、暂缓未发集任一在场即 true——显式退出意图
   *  在此态下先保留实例，落定后重新检查最新 dirty（不吞输入、不把未
   *  提交输入误报已保存） */
  hasPendingLocalInput(): boolean {
    return this.composing || this.blankComposition !== null ||
      this.inFlight.size > 0 || this.deferredLocal !== null
  }

  /** P2-05：pending → idle 翻转检测（翻转时一次性通知 deps） */
  private pendingInputNotified = false

  private notifyInputSettle(): void {
    if (this.hasPendingLocalInput()) {
      this.pendingInputNotified = true
      return
    }
    if (this.pendingInputNotified) {
      this.pendingInputNotified = false
      this.deps.onLocalInputSettled?.()
    }
  }

  /** 行号开关生效态（行号探针消费） */
  get lineNumbersEnabled(): boolean {
    return this.lineNumbersOn
  }

  /** 多光标开关生效态（上下加光标命令门控消费） */
  get multicursorEnabled(): boolean {
    return this.multicursorOn
  }

  /** 代码块卡片高亮开关（悬停/嵌入投影面板的浮层朴素高亮消费） */
  get codeCardHighlightEnabled(): boolean {
    return this.codeCardConfig.highlight
  }

  /** 代码块卡片配置快照（阅读侧卡片增强消费；live 权威配置的唯一来源） */
  get codeCardConfigSnapshot(): CodeCardConfig {
    return this.codeCardConfig
  }

  getView(): EditorView | undefined {
    return this.view
  }

  /** 目标会话身份（根在收到 init 时设置；出站消息自此携带实例目标） */
  setSession(sessionId: string, docUri: string): void {
    this.sessionId = sessionId
    this.docUri = docUri
  }

  /** #161 测试钩子配套：宿主注入 image.paste 绕过拦截侧登记时补记在途
   *  reqId（协议注释；webview 侧测试消息不做二次门控属既定分层设计） */
  noteImagePastePending(reqId: number): void {
    this.imagePastePending.add(reqId)
  }

  /** #161 粘贴总开关 + Live 激活 + 非暂停（createImagePaste 的 isEnabled
   *  与测试注入共用同一守卫口径；设置快照运行时读取）。阅读模式不接管
   *  （只读语义）；暂停面板不产生新写回链路 */
  private imagePasteEnabledNow(): boolean {
    const raw = this.settings?.[IMAGE_PASTE_KEY]
    const enabled = typeof raw === 'boolean' ? raw : IMAGE_PASTE_DEFAULT
    return enabled && this.deps.isLiveActive() && !this.suspended
  }

  /** P2-11（#288）测试钩子配套：以实例真实管线注入粘贴载荷（宿主测试无法
   *  向 webview 派发真实剪贴板事件）——守卫与 createImagePaste 拦截同口径，
   *  reqId 分配与在途登记同实例空间（结果路由的配对守卫由此成立） */
  pasteImageFromTest(payload: { mime: string; dataBase64: string; fileNameHint?: string }): boolean {
    const view = this.view
    if (!view || !this.sessionId || !this.imagePasteEnabledNow() ||
      view.state.readOnly || !view.state.facet(EditorView.editable)) {
      return false
    }
    const reqId = ++this.imagePasteReqId
    this.imagePastePending.add(reqId)
    this.deps.send({
      kind: 'image.paste',
      sessionId: this.sessionId,
      docUri: this.docUri,
      reqId,
      mime: payload.mime,
      dataBase64: payload.dataBase64,
      ...(payload.fileNameHint !== undefined ? { fileNameHint: payload.fileNameHint } : {}),
    })
    return true
  }

  /** 实例释放：flush 计时清零 + EditorView 销毁（DOM 随 destroy 移除）+
   *  图片弹窗实例上下文注销（P2-11——释放后的弹窗操作回落全局上下文，
   *  不持死实例资源）。不触碰根 chrome 与其他实例 */
  destroy(): void {
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    // T06（#355）实例销毁：全部在途 SDK 凭据以 view-disposed 终结（不泄漏
    // pending Promise；之后到达的 ack 无可结算对象）
    this.settleAllAddonPending('view-disposed')
    this.wikilinkSuggest?.destroy()
    if (this.view) {
      unregisterImagePopupSource(this.view)
    }
    this.view?.destroy()
    this.view = undefined
  }

  // ---- T06（#355）附加组件统一视图编辑面（SDK views 的实例侧实现） ----

  /** seq → 来源列表（ack 结算路由；仅 SDK 事务携带。暂停清理后查不到，
   *  对应凭据已在 enterSuspended 以 suspended 结算——幂等不重复） */
  private originsOfSeq(seq: number): EditOriginMeta[] | undefined {
    return this.sentTxns.find((t) => t.seq === seq)?.origins
  }

  /** 逐 opId 恰好一次结算（重复/未知 opId 静默丢弃） */
  private settleAddonOrigin(opId: string, result: AddonApplyEditsResult): void {
    const resolve = this.addonPending.get(opId)
    if (resolve !== undefined) {
      this.addonPending.delete(opId)
      resolve(result)
    }
  }

  /** 全部在途凭据终结（destroy / 暂停） */
  private settleAllAddonPending(reason: 'view-disposed' | 'suspended' | 'conflict'): void {
    for (const opId of [...this.addonPending.keys()]) {
      this.settleAddonOrigin(opId, { ok: false, reason })
    }
  }

  /** 快照修订标记（getSnapshot 的 revision 源） */
  addonDocRevision(): number {
    return this.docRevision
  }

  /** SDK getSnapshot：文本（含页面未确认输入）、多选区、权威版本与修订
   *  标记（UTF-16/LF）。视图不在场（reading/销毁）返回 null */
  snapshotForAddon(): AddonEditorSnapshot | null {
    const view = this.view
    if (!view) {
      return null
    }
    return {
      text: view.state.doc.toString(),
      selections: view.state.selection.ranges.map((r) => ({ anchor: r.anchor, head: r.head })),
      version: this.baseVersion,
      revision: this.docRevision,
    }
  }

  /** SDK applyEdits 实例侧执行：快照校验 → 本地原子事务（changes + 可选
   *  selection + 来源标记）→ 出站管线携带 origin → 凭据在 ack 终态结算。
   *  来源列表由 SDK 层构造注入（首项 = 本次提交声明：atomic 或单笔
   *  joinPrevious；合并并入发生在暂缓窗口的段拼接）。 */
  applyAddonEdit(input: {
    request: { revision: number; changes: SerChange[]; selection?: AddonSelectionRange }
    origins: EditOriginMeta[]
  }): Promise<AddonApplyEditsResult> {
    const view = this.view
    if (!view) {
      return Promise.resolve({ ok: false, reason: 'view-disposed' })
    }
    if (this.suspended) {
      return Promise.resolve({ ok: false, reason: 'suspended' })
    }
    // 空白格组合缓冲在场：程序化写入会被组合缓冲吸收（来源丢失）——
    // 保守拒绝（组合结束后可重试；已知边界，不静默错位）
    if (this.blankComposition !== null) {
      return Promise.resolve({ ok: false, reason: 'suspended' })
    }
    // 快照修订失配（旧快照）：明确拒绝，不自动重定位重试（设计 §5.1：
    // 内核输入重定位与 API 旧快照拒绝是两件事，不混成任意自动重试）
    if (input.request.revision !== this.docRevision) {
      return Promise.resolve({ ok: false, reason: 'stale-snapshot' })
    }
    // 变更边界校验（非法请求不进 CM6 事务——dispatch 会抛出而非拒绝）
    const docLength = view.state.doc.length
    for (const c of input.request.changes) {
      if (c.offset < 0 || c.length < 0 || c.offset + c.length > docLength) {
        return Promise.resolve({ ok: false, reason: 'invalid-request' })
      }
    }
    if (input.request.selection !== undefined) {
      const growth = totalInserted(input.request.changes) - input.request.changes.reduce((sum, c) => sum + c.length, 0)
      const maxPos = Math.max(input.request.selection.anchor, input.request.selection.head)
      if (maxPos > docLength + growth) {
        return Promise.resolve({ ok: false, reason: 'invalid-request' })
      }
    }
    const netChanged = input.request.changes.some((c) => c.length > 0 || c.text.length > 0)
    if (!netChanged) {
      // 零文本变更：选区类操作——本地原子应用（可选 selection 事务）、不
      // 出站、不造文本撤销项，凭据以当前基线签发（宿主无对应条目）
      if (input.request.selection !== undefined) {
        view.dispatch({
          selection: EditorSelection.single(input.request.selection.anchor, input.request.selection.head),
          annotations: addonEditOriginTag.of({ origins: input.origins }),
        })
      }
      return Promise.resolve({
        ok: true,
        credential: { opId: input.origins[0]!.opId, version: this.baseVersion },
      })
    }
    return new Promise<AddonApplyEditsResult>((resolve) => {
      for (const o of input.origins) {
        this.addonPending.set(o.opId, resolve)
      }
      const changes = input.request.changes.map((c) => ({ from: c.offset, to: c.offset + c.length, insert: c.text }))
      view.dispatch({
        changes,
        ...(input.request.selection !== undefined
          ? { selection: EditorSelection.single(input.request.selection.anchor, input.request.selection.head) }
          : {}),
        annotations: addonEditOriginTag.of({ origins: input.origins }),
      })
    })
  }

  /** SDK setSelection：本地选区事务（零文本变更，不出发站、不造撤销项）；
   *  返回是否接受（视图不在场或暂停拒绝） */
  setSelectionForAddon(ranges: AddonSelectionRange[]): boolean {
    const view = this.view
    if (!view || this.suspended || ranges.length === 0) {
      return false
    }
    const docLength = view.state.doc.length
    for (const r of ranges) {
      if (Math.max(r.anchor, r.head) > docLength) {
        return false
      }
    }
    view.dispatch({ selection: EditorSelection.create(
      ranges.map((r) => EditorSelection.range(r.anchor, r.head)),
      0,
    ) })
    return true
  }

  /** SDK reveal：滚动定位（零文本变更；不移动光标——只读定位语义） */
  revealForAddon(offset: number): boolean {
    const view = this.view
    if (!view) {
      return false
    }
    if (offset < 0 || offset > view.state.doc.length) {
      return false
    }
    view.dispatch({ effects: EditorView.scrollIntoView(offset, { y: 'center' }) })
    return true
  }

  // ---- #376 T01 双链联想会话（根路由与模式切换消费） ----

  /** 查询结果入站（根按实例路由；控制器内 reqId/generation/会话三重守卫） */
  handleWikilinkQueryResult(message: Extract<HostToWebview, { kind: 'wikilink.query.result' }>): void {
    this.wikilinkSuggest?.handleResult(message)
  }

  /** 标题查询结果入站（#379 T04；根按实例路由，控制器内同构守卫） */
  handleWikilinkHeadingQueryResult(
    message: Extract<HostToWebview, { kind: 'wikilink.heading.query.result' }>,
  ): void {
    this.wikilinkSuggest?.handleHeadingResult(message)
  }

  /** 块查询结果入站（#380 T05；根按实例路由，控制器内同构守卫） */
  handleWikilinkBlockQueryResult(
    message: Extract<HostToWebview, { kind: 'wikilink.block.query.result' }>,
  ): void {
    this.wikilinkSuggest?.handleBlockResult(message)
  }

  /** 无 ID 块接受结果入站（#380 T05；控制器内 reqId/会话守卫与字段复核） */
  handleWikilinkBlockAcceptResult(
    message: Extract<HostToWebview, { kind: 'wikilink.block.accept.result' }>,
  ): void {
    this.wikilinkSuggest?.handleBlockAcceptResult(message)
  }

  /** 候选失效信号（#377 T02）：索引/清单变更——控制器去抖后重发当前查询 */
  handleWikilinkInvalidate(): void {
    this.wikilinkSuggest?.handleInvalidate()
  }

  /** 候选会话是否在场（#381 T06：嵌入 Esc 链的豁免判定——候选先关一次，
   *  下一次 Esc 才走引用关闭链路；未装配联想的实例恒 false） */
  hasActiveWikilinkSuggest(): boolean {
    return this.wikilinkSuggest !== null && this.wikilinkSuggest.hasActiveSession()
  }

  /** 显式关闭候选（模式切换等根时机；幂等） */
  closeWikilinkSuggest(): void {
    this.wikilinkSuggest?.close()
  }

  // ---- 设置热重配（Live 扩展组；快照由根在 settings 消息到达时传入）----

  /** 应用 Live 侧设置（行号/表格网格/代码卡片/符号三组/多光标）：
   *  缺键回定义默认（向后兼容）；非布尔形态忽略（协议是宽标量容器，
   *  类型语义校验归宿主，webview 侧防御）。经 Compartment.reconfigure
   *  增删扩展组，EditorView 不重建 */
  applySettings(values: SettingsPayload | undefined): void {
    this.settings = values
    this.applyLineNumbersSetting()
    this.applyTableBlockRenderSetting()
    this.applyCodeCardSetting()
    this.applySymbolAutocompleteSetting()
    this.applySymbolSelectionWrapSetting()
    this.applyMulticursorSetting()
    this.applyTabEscapeSetting()
  }

  /** 宿主明暗热跟随（body class 判定在根；等值跳过——初始值取装配时刻） */
  applyDarkTheme(dark: boolean): void {
    if (dark === this.hostDarkApplied || !this.view) {
      return
    }
    this.hostDarkApplied = dark
    this.view.dispatch({
      effects: this.darkCompartment.reconfigure(EditorView.darkTheme.of(dark)),
    })
  }

  /** #358 T09 生效渲染提供者变化（附加组件接管/交还）：派发围栏表全量
   *  重扫 + 装饰重建效应（装饰实例缓存在字段更新路径清空——widget 换新
   *  DOM，旧提供者容器随旧 widget 退场，迟到结果写脱离节点不回潮） */
  applyRendererLanguagesChanged(): void {
    this.view?.dispatch({ effects: rendererLanguagesChanged.of(null) })
  }

  private applyLineNumbersSetting(): void {
    const raw = this.settings?.[SHOW_LINE_NUMBERS_KEY]
    const on = typeof raw === 'boolean' ? raw : SHOW_LINE_NUMBERS_DEFAULT
    if (on === this.lineNumbersOn) {
      return
    }
    this.lineNumbersOn = on
    this.view?.dispatch({
      effects: this.lineNumbersCompartment.reconfigure(on ? liveLineNumbers() : []),
    })
  }

  private applyTableBlockRenderSetting(): void {
    const raw = this.settings?.[TABLE_BLOCK_RENDER_KEY]
    const on = typeof raw === 'boolean' ? raw : TABLE_BLOCK_RENDER_DEFAULT
    if (on === this.tableBlockRenderOn) {
      return
    }
    this.tableBlockRenderOn = on
    this.view?.dispatch({
      effects: this.tableRenderCompartment.reconfigure(tableContainerRenderFacet.of(on)),
    })
  }

  private applyCodeCardSetting(): void {
    const bool = (raw: unknown, fallback: boolean): boolean =>
      typeof raw === 'boolean' ? raw : fallback
    const next: CodeCardConfig = {
      card: bool(this.settings?.[CODEBLOCK_CARD_KEY], CODEBLOCK_CARD_DEFAULT),
      lineNumbers: bool(this.settings?.[CODEBLOCK_LINE_NUMBERS_KEY], CODEBLOCK_LINE_NUMBERS_DEFAULT),
      copyButton: bool(this.settings?.[CODEBLOCK_COPY_BUTTON_KEY], CODEBLOCK_COPY_BUTTON_DEFAULT),
      highlight: bool(this.settings?.[CODEBLOCK_HIGHLIGHT_KEY], CODEBLOCK_HIGHLIGHT_DEFAULT),
    }
    if (
      next.card === this.codeCardConfig.card &&
      next.lineNumbers === this.codeCardConfig.lineNumbers &&
      next.copyButton === this.codeCardConfig.copyButton &&
      next.highlight === this.codeCardConfig.highlight
    ) {
      return
    }
    this.codeCardConfig = next
    this.view?.dispatch({
      effects: this.codeCardCompartment.reconfigure(this.codeCardExtension()),
    })
  }

  private applySymbolAutocompleteSetting(): void {
    const raw = this.settings?.[SYMBOL_AUTOCOMPLETE_KEY]
    const on = typeof raw === 'boolean' ? raw : SYMBOL_AUTOCOMPLETE_DEFAULT
    if (on === this.symbolAutocompleteOn) {
      return
    }
    this.symbolAutocompleteOn = on
    this.view?.dispatch({
      effects: this.symbolAutocloseCompartment.reconfigure(on ? symbolAutocomplete : []),
    })
  }

  private applySymbolSelectionWrapSetting(): void {
    const raw = this.settings?.[SYMBOL_SELECTION_WRAP_KEY]
    const on = typeof raw === 'boolean' ? raw : SYMBOL_SELECTION_WRAP_DEFAULT
    if (on === this.symbolSelectionWrapOn) {
      return
    }
    this.symbolSelectionWrapOn = on
    this.view?.dispatch({
      effects: this.symbolSelectionWrapCompartment.reconfigure(on ? symbolSelectionWrap : []),
    })
  }

  private applyMulticursorSetting(): void {
    const raw = this.settings?.[MULTI_CURSOR_KEY]
    const on = typeof raw === 'boolean' ? raw : MULTI_CURSOR_DEFAULT
    if (on === this.multicursorOn) {
      return
    }
    this.multicursorOn = on
    this.view?.dispatch({
      effects: this.multicursorCompartment.reconfigure(on ? multicursorExtensions : []),
    })
  }

  private applyTabEscapeSetting(): void {
    const raw = this.settings?.[SYMBOL_TAB_ESCAPE_KEY]
    const on = typeof raw === 'boolean' ? raw : SYMBOL_TAB_ESCAPE_DEFAULT
    if (on === this.tabEscapeOn) {
      return
    }
    this.tabEscapeOn = on
    this.view?.dispatch({
      effects: this.tabEscapeCompartment.reconfigure(on ? fenceEscape : []),
    })
  }

  // ---- 宿主消息入口（根路由到实例；全局接收仍归根单份）----

  /** 全文同步（init / doc.resync）：组合中缓冲，否则立即重置。
   *  doc.resync 对暂停面板兼作恢复信号：重置文本并解除暂停（#4）。
   *  组合中的恢复（含暂停解除）延后到 flush。装载完成经
   *  deps.onFullSyncApplied 通知根做阅读刷新/锚点恢复/骨架撤除；
   *  restoreAnchor 的具体恢复动作归根（模式状态机与阅读视图在根）。 */
  handleFullSync(
    version: number,
    text: string,
    opts: { restoreAnchor?: boolean; source?: 'resync' | 'init' | 'ack-fail' } = {},
  ): void {
    if (opts.source === 'resync' && this.deferredLocal && !this.suspended) {
      // 主动全文与尚未发送的本地输入无法自动合并；保留本地快照供恢复。
      this.enterSuspended()
      return
    }
    if (this.composing || this.blankComposition || this.hasBufferedSync()) {
      if (!this.pendingFull || version >= this.pendingFull.version) {
        this.pendingFull = { version, text, source: opts.source ?? 'init' }
      }
      this.pendingExternal = this.pendingExternal.filter((group) => group.version > version)
      return
    }
    this.baseVersion = version
    // 全文重置即权威基线（C-4）：早于该版本的迟到增量一律丢弃
    this.lastDocChangedVersion = Math.max(this.lastDocChangedVersion, version)
    this.replaceDoc(text)
    this.exitSuspended()
    this.deps.onFullSyncApplied?.({ restoreAnchor: opts.restoreAnchor === true })
    // #148：全文落地即权威基线（本地未落地编辑已被权威文本取代）——
    // 撤销意图此刻发出，撤销的是宿主栈上最后已完成的操作
    this.releasePendingHistory()
    // P2-05：全文落地可能清空输入挂起态（resync 恢复等），通知 settle
    this.notifyInputSettle()
  }

  /** edit.ack（ok 推进基线；fail 保留文本进暂停，干净时以附文重置） */
  handleEditAck(message: Extract<HostToWebview, { kind: 'edit.ack' }>): void {
    // T06（#355）SDK 凭据结算先行：暂停态的迟到 ack 也须终结 pending
    // Promise（出站在暂停前已发生；宿主可能已发出失败 ack）
    if (!message.ok) {
      const originsOfSeq = this.originsOfSeq(message.seq)
      if (originsOfSeq !== undefined) {
        const reason: 'history-boundary' | 'error' | 'conflict' =
          message.originRejection === 'history-boundary' ? 'history-boundary' :
          message.reason === 'error' ? 'error' : 'conflict'
        for (const o of originsOfSeq) {
          this.settleAddonOrigin(o.opId, { ok: false, reason })
        }
      }
    }
    if (this.suspended) {
      // 暂停态：写回已停，任何 ack 结果都不再改变本地状态
      return
    }
    if (message.ok) {
      this.inFlight.delete(message.seq)
      {
        // T06（#355）SDK 凭据结算：version 与 ack 同源（宿主确认后的凭据）
        const originsOfSeq = this.originsOfSeq(message.seq)
        if (originsOfSeq !== undefined) {
          for (const o of originsOfSeq) {
            this.settleAddonOrigin(o.opId, { ok: true, credential: { opId: o.opId, version: message.version } })
          }
        }
      }
      // #314 粘贴元数据回读：剥离已确认队列**之前**找本事务（confirmSentTxn
      //  会 splice 掉），根据此标记 pasteFeedback 落定（时机对齐 main 版
      //  ok 分支开头；无元数据的事务零回调）
      const txn = this.sentTxns.find((t) => t.seq === message.seq)
      if (txn && (txn.paste || txn.plainPasteFeedback)) {
        this.deps.onPasteTxnAcked?.({
          paste: txn.paste ?? null,
          plainPasteFeedback: txn.plainPasteFeedback ?? null,
        })
      }
      // 按 seq 剥离已确认事务并复合进已确认链（C-2）：外部增量逆穿
      // 它平移回 baseVersion 系；宿主按序确认，通常命中队首
      this.confirmSentTxn(message.seq)
      // 未确认集的清空延后到缓冲 flush（组合输入映射仍需它）；
      // 全部确认且无缓冲挂起时本地与权威一致
      if (this.inFlight.size === 0 && !this.hasBufferedSync() && !this.deferredLocal) {
        this.unconfirmed = null
        this.ackedChain = null
        this.sentTxns = []
      }
      if (this.hasBufferedSync()) {
        this.pendingVersionAck = Math.max(this.pendingVersionAck ?? 0, message.version)
      } else if (this.inFlight.size === 0) {
        // 全部确认：基线推进到最新确认版本（C-2：部分确认时保持
        // unconfirmed 定义域版本，出站坐标经逆穿统一参考系）
        this.baseVersion = Math.max(this.baseVersion, message.version)
      }
      if (this.inFlight.size === 0 && !this.hasBufferedSync()) {
        this.sendDeferredLocal()
      }
      // #148：在途编辑全部确认且暂缓集已出站（sendDeferredLocal 发出的
      // 新请求会留在 inFlight，下方释放自会判定继续等待）——此刻撤销
      // 意图可安全发出
      this.releasePendingHistory()
      // P2-05：ack 收敛可能清空在途输入（触发挂起意图重新检查 dirty）
      this.notifyInputSettle()
      return
    }
    // T06（#355）业务拒绝（joinPrevious 无可确认前项）：面板不进冲突暂停
    // ——业务声明错误 ≠ 同步冲突。无其他叠加输入时以权威全文重置（回滚
    // 被拒事务的本地效果）；有叠加输入（其他在途/暂缓/组合）时保留输入
    // 走暂停（用户输入优先）
    if (message.originRejection === 'history-boundary') {
      this.inFlight.delete(message.seq)
      this.sentTxns = this.sentTxns.filter((t) => t.seq !== message.seq)
      const hasOther =
        this.inFlight.size > 0 || this.deferredLocal !== null || this.composing ||
        this.blankComposition !== null || this.hasBufferedSync()
      if (!hasOther) {
        this.unconfirmed = null
        this.ackedChain = null
        this.sentTxns = []
        if (typeof message.text === 'string') {
          this.handleFullSync(message.version, message.text, { source: 'ack-fail' })
        }
        this.notifyInputSettle()
        return
      }
      this.enterSuspended()
      return
    }
    // ok:false（conflict/error）：本地有未确认输入时保留文本并暂停；
    // 无未确认输入时以附带全文重置（干净恢复），随后同样进入暂停
    const hasUnconfirmed = this.unconfirmed !== null || this.inFlight.size > 0
    if (!hasUnconfirmed && typeof message.text === 'string') {
      this.handleFullSync(message.version, message.text, { source: 'ack-fail' })
    }
    this.enterSuspended()
  }

  /** doc.changed（外部增量）：版本单调、组合缓冲、在途映射与冲突暂停 */
  handleDocChanged(message: Extract<HostToWebview, { kind: 'doc.changed' }>): void {
    if (message.version <= this.lastDocChangedVersion) {
      // 版本单调防线（C-4）：同版本重复/迟到广播（宿主兜底确认竞态等）
      // 直接丢弃——版本与变更一一对应，重复应用会静默错位
      return
    }
    if (message.changes.length === 0) {
      // 无内容变更（#44：宿主侧已过滤空 dirty 事件，此处为第二道防线）。
      // 直接丢弃且不占用版本号：若空事件与真实增量同版本，后者仍须应用；
      // 也不得让暂缓态把它当成外部修改而升级为暂停。
      return
    }
    this.lastDocChangedVersion = message.version
    // #314：外部增量过版本防线即作废未落定的 rich 粘贴反馈（对齐 main
    // 版在暂停判定前的时机；暂停/暂缓分支同样先作废再退出）
    this.deps.onExternalDocArrived?.()
    if (this.suspended) {
      // 暂停：外部增量不应用（保留本地输入，恢复时以全文对齐）
      return
    }
    if (this.deferredLocal && !this.composing && !this.blankComposition && !this.hasBufferedSync()) {
      // 待发集定义域未随外部增量重定位；保守暂停并保留本地全文，
      // 避免确认后用旧坐标覆盖权威文本。
      this.enterSuspended()
      return
    }
    if (this.composing || this.blankComposition || this.hasBufferedSync()) {
      // 组合中不打断输入；缓冲挂起期间到达的增量一并对齐到 flush。
      // 入队即逆穿到 base 系（参考系一致性见 BufferedIncremental 注释）；
      // #314 分步撤销的 reason/paste 随组缓冲（flush 收敛时随末组回调根）
      this.pendingExternal.push({
        version: message.version,
        changes: message.changes,
        baseChanges: this.ackedChain
          ? unmapSerGroupThroughAcked(message.changes, this.ackedChain)
          : message.changes,
        ...(message.reason !== undefined ? { reason: message.reason } : {}),
        ...(message.paste !== undefined ? { paste: message.paste } : {}),
      })
    } else if (this.unconfirmed || this.ackedChain) {
      // 在途未确认编辑：外部增量（权威系）先逆穿已确认链回 base 系再
      // 穿未确认集（C-2），真重叠则冲突暂停
      const mapped = this.applyExternalGroup(message.changes)
      if (!mapped) {
        this.enterSuspended()
        return
      }
      this.dispatchExternal(mapped)
      this.baseVersion = message.version
      this.deps.onExternalDocSettled?.({ reason: message.reason, paste: message.paste })
    } else {
      this.baseVersion = message.version
      this.dispatchExternal(message.changes)
      this.deps.onExternalDocSettled?.({ reason: message.reason, paste: message.paste })
    }
  }

  /** session.suspended（宿主通知：面板处于暂停状态，典型为 webview
   *  重载后的状态恢复） */
  handleSessionSuspended(): void {
    this.enterSuspended()
  }

  /** #161 图片粘贴落盘结果：reqId 在途校验（陈旧/未知回包丢弃）；
   *  成功在光标处单事务插入宿主计算好的 markdown（守卫对齐格式操作
   *  ——live、非暂停、可编辑；单笔 dispatch = 一笔 edit.request =
   *  撤销一步还原）；失败不插入文本（宿主已弹 i18n 通知） */
  handleImagePasteResult(message: Extract<HostToWebview, { kind: 'image.paste.result' }>): void {
    if (!this.imagePastePending.delete(message.reqId)) {
      return
    }
    if (!message.ok) {
      return
    }
    const view = this.view
    if (
      !view ||
      !imagePasteCanInsertAt({
        live: this.deps.isLiveActive(),
        suspended: this.suspended,
        editable: !view.state.readOnly && view.state.facet(EditorView.editable),
      })
    ) {
      return
    }
    const range = view.state.selection.main
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: message.markdown },
      selection: { anchor: range.from + message.markdown.length },
      scrollIntoView: true,
    })
  }

  // ---- 冲突暂停 ----

  /**
   * 进入冲突暂停：保留本地文本，上报快照（有未确认输入时），根横幅经
   * hook 联动，停止一切写回与外部同步；恢复唯一途径是 doc.resync。
   */
  private enterSuspended(): void {
    if (this.suspended) {
      return
    }
    const hasUnconfirmed =
      this.unconfirmed !== null || this.inFlight.size > 0 || this.deferredLocal !== null || this.composing
    this.suspended = true
    // T06（#355）在途 SDK 凭据以 suspended 终结（暂停后 ack 结果不再改变
    // 本地状态；宿主的拒绝 ack 到达时幂等不重复结算）
    this.settleAllAddonPending('suspended')
    this.wikilinkSuggest?.close()
    this.deps.onSuspendedChange?.(true)
    if (hasUnconfirmed) {
      this.reportConflictSnapshot()
    }
    // 暂停后这些状态不再参与同步；恢复时由 doc.resync 全量对齐。
    // pendingFull 保留：暂停前的全文重置（恢复内容）在 flush 时仍应用
    this.unconfirmed = null
    this.ackedChain = null
    this.sentTxns = []
    this.deferredLocal = null
    this.deferredSegments = []
    this.undoCursorBoundary = false
    this.deferredFromComposition = false
    this.inFlight.clear()
    this.pendingExternal = []
    // #148：持有的撤销/重做意图随之丢弃——暂停面板的撤销忽略（B-4），
    // 恢复后不补发（补发会撤到用户无法预期的操作）
    this.pendingHistoryOps = []
  }

  /** 解除暂停（doc.resync / init 全文装载后调用）：状态全量对齐 */
  private exitSuspended(): void {
    if (!this.suspended && !this.inFlight.size && this.unconfirmed === null) {
      return
    }
    this.suspended = false
    this.inFlight.clear()
    this.unconfirmed = null
    this.ackedChain = null
    this.sentTxns = []
    this.deferredLocal = null
    this.deferredSegments = []
    this.undoCursorBoundary = false
    this.deferredFromComposition = false
    this.pendingExternal = []
    this.pendingFull = undefined
    this.pendingVersionAck = undefined
    this.deps.onSuspendedChange?.(false)
  }

  private hasBufferedSync(): boolean {
    return this.pendingExternal.length > 0 || this.pendingFull !== undefined
  }

  /**
   * 暂停/暂缓态每笔输入立即刷新宿主快照。两种状态的输入不在宿主 pending
   * 内，延后发送会在快速关闭或断连时留下无法取回的窗口。正常输入仍走
   * 增量 edit.request，不发送全文。
   *
   * #49 唯一例外：组合期间的暂缓输入不逐笔上报（见 recordLocalChangeSet
   * 暂缓分支注释）。暂停态（enterSuspended 进入时与暂停中的每笔输入）不受
   * 该例外影响，仍立即快照——暂停非高频路径，且组合中进入暂停时本地文本
   * 已脱离正常出站链路（inFlight/deferredLocal 均被清空），快照是此时唯一
   * 的取回通道，不放宽。
   */
  private reportConflictSnapshot(): void {
    if (!this.sessionId || (!this.suspended && !this.deferredLocal)) {
      return
    }
    this.conflictRevision += 1
    this.deps.persistState()
    this.deps.send({
      kind: 'conflict.report',
      sessionId: this.sessionId,
      docUri: this.docUri,
      version: this.baseVersion,
      revision: this.conflictRevision,
      text: this.view?.state.doc.toString() ?? '',
    })
  }

  // ---- 外部增量应用 ----

  /** 把 SerChange 组转为 clamp 到当前文档长度的 CM change spec */
  private clampedSpec(changes: readonly SerChange[]) {
    const len = this.view?.state.doc.length ?? 0
    return changes.map((c) => ({
      from: Math.min(c.offset, len),
      to: Math.min(c.offset + c.length, len),
      insert: c.text,
    }))
  }

  /**
   * 外部增量以单事务应用（externalSync 注解，不回发）；
   * 区间 clamp 到当前文档长度（宿主与本地状态的毫秒级竞态防御，
   * 避免超范围坐标抛错）。应用后经 hook 通知根（阅读视图刷新）。
   */
  private dispatchExternal(changes: readonly SerChange[]): void {
    const view = this.view
    if (!view) {
      return
    }
    this.dispatchExternalChanges(view, changes)
    this.deps.onExternalTextApplied?.()
  }

  /** CM6 把非空选区映射穿过覆盖整段的宿主替换时，可能产生 from > to
   *  的 SelectionRange（两端分别映到替换后区间的右、左边界）。视觉上仍
   *  高亮，但下一次输入会用反向 change range。须在同一笔外部事务内
   *  指定规范化选区，避免先渲染无效 range 后被 DOM 观察器折叠。 */
  private dispatchExternalChanges(view: EditorView, changes: readonly SerChange[]): void {
    const specs = this.clampedSpec(changes)
    // #296 审查轮二：钳制命中判定在 dispatch 前做（旧 selection 对旧区间
    // [from,to]，坐标系自洽）——dispatch 后的 head 已映射到新文档，与旧
    // 区间比较会在「净删除 + 区间外右侧近处光标」时误钳（映射后数值恰落
    // 旧区间，但字符身份仍是区间外内容——远处前缀显形光标被拽走）、
    // 「净插入 + 区间右端点光标」时漏钳
    const hitMask = view.state.selection.ranges.map((range) =>
      range.empty && specs.some((c) => range.head >= c.from && range.head <= c.to))
    const mapped = view.state.selection.map(ChangeSet.of(specs, view.state.doc.length))
    const selection = mapped.ranges.some((range) => range.from > range.to)
      ? EditorSelection.create(mapped.ranges.map((range) =>
        range.from > range.to ? EditorSelection.range(range.to, range.from) : range),
      mapped.mainIndex)
      : undefined
    view.dispatch({
      changes: specs,
      selection,
      annotations: externalSync.of(true),
    })
    // #296 六轮 + 审查轮：undo/外部整行替换会把格内容里的光标归到区间左端
    // （前缀或隐藏管道端点），触发前缀显形、网格破裂。用变更后 state 的
    // 网格信息钳回最近格内容；只处理 dispatch 前命中（端点在被替换文本上）
    // 的折叠光标——区间内光标才会被映射重定位，区间外（用户主动放置的
    // 远处光标，如前缀显形编辑态）不动（审查轮 F4）；逐 range 钳制、其余
    // range 保留（单 anchor spec 会整体替换选区、坍缩多光标——审查轮 F2）。
    // selection-only 补事务与上一笔同步连发，浏览器只渲染最终态。
    const sel = view.state.selection
    let ranges: ReturnType<typeof EditorSelection.cursor>[] | null = null
    for (let i = 0; i < sel.ranges.length; i++) {
      if (!hitMask[i]) {
        continue
      }
      const clamped = clampExternalCursor(view.state, sel.ranges[i]!.head)
      if (clamped === null || clamped === sel.ranges[i]!.head) {
        continue
      }
      if (!ranges) {
        ranges = sel.ranges.slice()
      }
      ranges[i] = EditorSelection.cursor(clamped)
    }
    if (ranges) {
      view.dispatch({ selection: EditorSelection.create(ranges, sel.mainIndex) })
    }
  }

  /**
   * 外部增量组（坐标 = 权威当前系，直发路径）应用的统一入口：
   * 1. 有已确认事务时先逆穿已确认链，平移回 unconfirmed 定义域（baseVersion
   *    系）——外部坐标已含已确认编辑，直接穿未确认集会多平移已确认部分（C-2）
   * 2. 再穿未确认集映射到本地系；两阶段任一二义（真重叠）返回 null（冲突暂停）
   * 3. 应用成功后，未确认集与已确认链都以 base 系增量 rebase（定义域推进，
   *    CM6 mapDesc 精确保持段语义），baseVersion 由调用方推进
   *
   * 组合缓冲 flush 路径不经过此入口的逆穿阶段（缓冲增量已在入队时逆穿，
   * 见 BufferedIncremental.baseChanges），直接调 applyBaseChanges。
   */
  private applyExternalGroup(changes: readonly SerChange[]): SerChange[] | null {
    let baseChanges: readonly (SerChange & Partial<UnmappedChange>)[] = changes
    if (this.ackedChain) {
      const rev = unmapSerGroupThroughAcked(changes, this.ackedChain)
      if (!rev) {
        return null
      }
      baseChanges = rev
    }
    return this.applyBaseChanges(baseChanges)
  }

  /**
   * baseVersion 系增量穿未确认集映射到本地系并 rebase 参考系
   * （直发与组合 flush 共用的后半段；返回本地系增量，二义返回 null）。
   */
  private applyBaseChanges(
    baseChanges: readonly (SerChange & Partial<UnmappedChange>)[],
  ): SerChange[] | null {
    if (!this.unconfirmed) {
      // 已确认链非空时未确认集必非空（同源清空）；异常态自愈
      this.ackedChain = null
      this.sentTxns = []
      return [...baseChanges]
    }
    const mapped = mapSerGroupThroughCm(baseChanges, this.unconfirmed)
    if (!mapped) {
      return null
    }
    const gCs = ChangeSet.of(
      [...baseChanges]
        .sort((a, b) => a.offset - b.offset)
        .map((c) => ({ from: c.offset, to: c.offset + c.length, insert: c.text })),
      this.unconfirmed.length,
    )
    // 待确认事务与 unconfirmed/ackedChain 共用定义域；外部增量推进定义域时
    // 也要同步平移其坐标，否则稍后 ack 会把旧位置复合进 ackedChain。
    this.sentTxns = this.sentTxns.map((txn) => {
      const cs = ChangeSet.of(
        txn.changes.map((c) => ({ from: c.offset, to: c.offset + c.length, insert: c.text })),
        this.unconfirmed!.length,
      ).mapDesc(gCs, false) as ChangeSet
      const rebased: SerChange[] = []
      cs.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        rebased.push({
          offset: fromA,
          length: toA - fromA,
          text: inserted.sliceString(0, inserted.length),
        })
      })
      // #314：rebase 只重算坐标，粘贴元数据原样随事务保留
      return { ...txn, changes: rebased }
    })
    this.unconfirmed = this.unconfirmed.mapDesc(gCs, false) as ChangeSet
    if (this.ackedChain) {
      this.ackedChain = this.ackedChain.mapDesc(gCs, false) as ChangeSet
    }
    return mapped
  }

  /** ack ok(seq)：把该事务从待确认队列剥离并复合进已确认链（C-2）。
   *  事务坐标为 base 系投影，与已确认链同定义域，经 mapDesc rebase 后
   *  compose（该事务发出晚于已确认事务，mapDesc before=false） */
  private confirmSentTxn(seq: number): void {
    const idx = this.sentTxns.findIndex((t) => t.seq === seq)
    if (idx < 0) {
      return // 未知 seq（暂停清理后的迟到 ack）：忽略
    }
    const [txn] = this.sentTxns.splice(idx, 1)
    if (!txn) {
      return
    }
    const baseLen = this.ackedChain ? this.ackedChain.length : this.unconfirmed?.length
    if (baseLen === undefined) {
      return
    }
    const cs = ChangeSet.of(
      [...txn.changes]
        .sort((a, b) => a.offset - b.offset)
        .map((c) => ({ from: c.offset, to: c.offset + c.length, insert: c.text })),
      baseLen,
    )
    this.ackedChain = this.ackedChain
      ? (this.ackedChain.compose(cs.mapDesc(this.ackedChain, false) as ChangeSet))
      : cs
  }

  // ---- 本地编辑意图（出站链）----

  /** #314 粘贴元数据通道：包裹 fn 的同步执行期间，实例内 dispatch 触发
   *  的出站与暂缓段都附上这份元数据（edit.request 的 paste 字段 +
   *  sentTxns/deferredSegments 的回读源）。根的 applyRichPaste /
   *  applyPlainPasteWithImageFeedback 经此包裹粘贴事务（替代 main 版
   *  根级瞬时标记直接读出站管线的机制；嵌套包裹内层胜出、退出恢复） */
  withPasteMeta<T>(meta: { paste?: PasteStage; plainPasteFeedback?: string }, fn: () => T): T {
    const prev = this.currentPasteMeta
    this.currentPasteMeta = meta
    try {
      return fn()
    } finally {
      this.currentPasteMeta = prev
    }
  }

  /** 普通事务与空白格组合净变更共用同一出站/未确认坐标链。
   *  T06（#355）origins：SDK applyEdits 事务（addonEditOriginTag）的来源
   *  列表随事务传入；暂缓窗口内 joinPrevious 并入同组队尾段（合并笔），
   *  正常路径逐笔出站（各自成条目、同组连续撤回）。 */
  private recordLocalChangeSet(changeSet: ChangeSet, changes: SerChange[], origins?: EditOriginMeta[]): void {
    if (changes.length === 0 || !this.sessionId) {
      if (origins !== undefined) {
        // 无净文本变更的 SDK 请求不进文本管线（纯选区语义，不造文本
        // 历史）：逐 opId 以当前基线版本签发凭据；本地派发时 selection-only
        // 事务本就不触发本方法，此为防御分支
        for (const o of origins) {
          this.settleAddonOrigin(o.opId, { ok: true, credential: { opId: o.opId, version: this.baseVersion } })
        }
      }
      this.unconfirmed = this.unconfirmed ? this.unconfirmed.compose(changeSet) : changeSet
      return
    }
    // #314：粘贴事务（withPasteMeta 包裹的 dispatch）强制开新撤销段——
    // 每个粘贴阶段独立一笔 edit.request = 一条宿主 undo 记录
    const paste = this.currentPasteMeta?.paste
    const plainPasteFeedback = this.currentPasteMeta?.plainPasteFeedback
    // #153 撤销段边界判定（先于本笔累积，比较用上一笔时间戳）：光标边界
    // 标记来自用户主动移光标（或组合开始时刻的停顿回看）；时间停顿仅在
    // 非组合态回看——组合进行中不切段（原子性），组合间停顿已在
    // compositionstart 的 markPauseBoundary 判定过
    const segmentBoundary = !!paste || !!plainPasteFeedback || this.undoCursorBoundary ||
      (!this.composing && this.lastLocalInputAt !== null &&
        Date.now() - this.lastLocalInputAt >= UNDO_SEGMENT_PAUSE_MS)
    this.undoCursorBoundary = false
    this.lastLocalInputAt = Date.now()
    if (this.composing || this.deferredLocal || (
      this.unconfirmed && touchesUnconfirmedChange(changes, chainSections(this.unconfirmed))
    )) {
      // T06（#355）同组未提交合并（技术方案 §6 表格第一行）：joinPrevious
      // 事务在暂缓窗口并入队尾同组段（组首 atomic 段未被外来写入打断的
      // 本地镜像 = 段仍在暂缓集且带组首来源），合成一笔出站 = 一条宿主
      // 历史项；组首 atomic 事务开新段
      const mergeIntoPreviousSegment =
        origins !== undefined && origins.length === 1 && origins[0]!.undo === 'joinPrevious' &&
        this.deferredSegments.length > 0
      // SDK 修饰事务（带来源）不并入用户输入段（不同撤回单位）：atomic
      // 强制开新段；joinPrevious 仅并入「同组队尾 SDK 段」（上方合并判定）
      if (this.deferredLocal && (segmentBoundary || origins !== undefined) && !mergeIntoPreviousSegment) {
        // #153：分段边界落地——本笔开新撤销段（切分点落在字符边界，两段
        // 定义域依次衔接，出站坐标由 sendDeferredLocal 依次映射）
        this.deferredSegments.push({ changes: changeSet, ...(paste ? { paste } : {}), ...(plainPasteFeedback ? { plainPasteFeedback } : {}), ...(origins ? { origins } : {}) })
      } else if (this.deferredSegments.length > 0) {
        const last = this.deferredSegments.length - 1
        const segment = this.deferredSegments[last]!
        if (mergeIntoPreviousSegment && segment.origins !== undefined) {
          // 并入：来源列表拼接（首项仍为组首 atomic）；变更复合
          this.deferredSegments[last] = {
            ...segment,
            changes: segment.changes.compose(changeSet),
            origins: [...segment.origins, ...origins!],
          }
        } else if (mergeIntoPreviousSegment) {
          // 队尾段无来源（用户输入段）：joinPrevious 无本地可并入前项——
          // 逐笔出站（宿主闸门按真实栈顶判定归属）
          this.deferredSegments.push({ changes: changeSet, ...(origins ? { origins } : {}) })
        } else {
          this.deferredSegments[last] = { ...segment, changes: segment.changes.compose(changeSet) }
        }
      } else {
        this.deferredSegments = [{ changes: changeSet, ...(paste ? { paste } : {}), ...(plainPasteFeedback ? { plainPasteFeedback } : {}), ...(origins ? { origins } : {}) }]
      }
      this.deferredLocal = this.deferredLocal
        ? this.deferredLocal.compose(changeSet)
        : changeSet
      if (this.composing) {
        this.deferredFromComposition = true
      }
      this.unconfirmed = this.unconfirmed ? this.unconfirmed.compose(changeSet) : changeSet
      // 组合期间不逐笔上报全文快照（#49）：组合中的候选事务一律暂缓
      //（#123 起含首笔——首笔立即出站会让组合结束点的符号补全成为第二
      // 笔，破坏「一次补全一笔事务」），逐笔 conflict.report 意味着大文档
      // 下每个候选都全文序列化 + postMessage。组合结束 flush 后
      // deferredLocal 经 sendDeferredLocal 以单笔 edit.request 出站、文本
      // 进入宿主权威文档，取回语义由 VSCode 文本管线兜底；丢失窗口仅限
      // 组合进行中（候选未上屏）快速关闭/断连，与 VSCode 原生编辑器同类
      // 行为一致。组合外（composing === false）的暂缓输入保持逐笔快照，
      // 取回兜底不放宽。
      if (!this.composing) {
        this.reportConflictSnapshot()
      }
      // P2-05：暂缓集增长 = 输入挂起态（组合/触碰暂缓）——置位 settle 检测
      this.notifyInputSettle()
      return
    }
    const baseChanges = this.toBaseChanges(changes)
    this.unconfirmed = this.unconfirmed ? this.unconfirmed.compose(changeSet) : changeSet
    this.seq += 1
    this.deps.persistState()
    this.inFlight.add(this.seq)
    const originField = origins === undefined ? {} :
      origins.length === 1 ? { origin: origins[0] } : { origin: origins }
    this.sentTxns.push({ seq: this.seq, changes: baseChanges, ...(paste ? { paste } : {}), ...(plainPasteFeedback ? { plainPasteFeedback } : {}), ...(origins ? { origins } : {}) })
    this.deps.send({
      kind: 'edit.request', sessionId: this.sessionId, docUri: this.docUri,
      seq: this.seq, baseVersion: this.baseVersion, changes: baseChanges,
      ...(paste ? { paste } : {}),
      ...originField,
    })
    // P2-05：在途请求 = 输入挂起态——置位 settle 检测（ack 收敛时翻转通知）
    this.notifyInputSettle()
  }

  private reportBlankCompositionSnapshot(pending: boolean): void {
    if (!this.sessionId) return
    this.conflictRevision += 1
    this.deps.persistState()
    this.deps.send({
      kind: 'conflict.report', sessionId: this.sessionId, docUri: this.docUri,
      version: this.baseVersion, revision: this.conflictRevision,
      text: this.view?.state.doc.toString() ?? '', compositionPending: pending,
    })
  }

  /** 候选期间只跨桥传变更片段；宿主以组合开始时的全文快照为基线增量应用。 */
  private reportBlankCompositionChanges(changeSet: ChangeSet): void {
    if (!this.sessionId) return
    const changes: SerChange[] = []
    changeSet.iterChanges((from, to, _fromB, _toB, inserted) => {
      changes.push({ offset: from, length: to - from, text: inserted.sliceString(0, inserted.length) })
    })
    if (changes.length === 0) return
    this.conflictRevision += 1
    this.deps.persistState()
    this.deps.send({
      kind: 'composition.changed', sessionId: this.sessionId, docUri: this.docUri,
      revision: this.conflictRevision, changes,
    })
  }

  /** 已发请求全部确认后，以确认后的权威版本发送待发本地净变更。
   *  #153 撤销分段：暂缓集按撤销段切分出站——队首段即本笔 edit.request
   *  （一条宿主 undo 记录），余段留守暂缓集；队首段 ack 收敛后本方法再次
   *  被调用，依次出站下一笔。分段只改撤销粒度：传输合并语义不变（段内
   *  仍单笔传输），暂缓/冲突/缓冲守卫全部沿用。 */
  private sendDeferredLocal(): void {
    // 队首段净抵消时余段继续出站：连续多段恒净抵消以循环处理（原递归
    // 深度 = 段数，行为等价；每轮迭代重新评估出站守卫）
    while (this.deferredSegments.length > 0 && !this.suspended && !this.blankComposition &&
        this.inFlight.size === 0 && !this.hasBufferedSync()) {
      const segment = this.deferredSegments[0]!
      const head = segment.changes
      const rest = this.deferredSegments.slice(1)
      const restComposed = rest.length > 0
        ? rest.map((seg) => seg.changes).reduce((acc, seg) => acc.compose(seg))
        : null
      const changes: SerChange[] = []
      head.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        changes.push({
          offset: fromA,
          length: toA - fromA,
          text: inserted.sliceString(0, inserted.length),
        })
      })
      this.deferredSegments = rest
      this.deferredLocal = restComposed
      if (!restComposed) {
        this.deferredFromComposition = false
      }
      // 进入出站流程即清已确认链（先于净抵消判定，对齐分段改造前语义）：
      // 净抵消段跳过出站时同样清空——否则段耗尽路径遗留 ackedChain，
      // hasUnlandedLocalEdits 恒真且无收敛点释放，Ctrl+Z 被无限期暂缓
      this.ackedChain = null
      this.sentTxns = []
      if (changes.length === 0) {
        // 队首段净变更完全抵消（段内输入自相抵消）：跳过出站，余段继续
        this.unconfirmed = restComposed
        continue
      }
      // 未确认集重挂到「全部已确认 + 暂缓集」复合：发送段计入在途、余段
      // 留守，整体仍等于原复合（队首段 ∘ 余段）；末段出站时退化为旧语义
      // （unconfirmed = 该段本身）
      this.unconfirmed = restComposed ? head.compose(restComposed) : head
      this.seq += 1
      this.deps.persistState()
      this.inFlight.add(this.seq)
      this.sentTxns.push({ seq: this.seq, changes, ...(segment.paste ? { paste: segment.paste } : {}), ...(segment.plainPasteFeedback ? { plainPasteFeedback: segment.plainPasteFeedback } : {}), ...(segment.origins ? { origins: segment.origins } : {}) })
      const originField = segment.origins === undefined ? {} :
        segment.origins.length === 1 ? { origin: segment.origins[0] } : { origin: segment.origins }
      this.deps.send({
        kind: 'edit.request',
        sessionId: this.sessionId,
        docUri: this.docUri,
        seq: this.seq,
        baseVersion: this.baseVersion,
        changes,
        ...(segment.paste ? { paste: segment.paste } : {}),
        ...originField,
      })
      return
    }
  }

  /** #153 撤销分段：组合开始时刻回看与上一笔本地输入的停顿——停顿达阈值
   *  即置位段边界（本组合的净输入落到新段）。组合间分段只能在此判定：
   *  组合进行中的候选事务不回看停顿（原子性），组合结束后再输入则由
   *  recordLocalChangeSet 的常规判定覆盖 */
  private markPauseBoundary(): void {
    if (this.lastLocalInputAt !== null &&
        Date.now() - this.lastLocalInputAt >= UNDO_SEGMENT_PAUSE_MS) {
      this.undoCursorBoundary = true
    }
  }

  /** #153 撤销分段：用户主动移光标（点击 / 导航键）开新段。组合进行中
   *  不置位——真实浏览器里点击通常直接取消组合（触发 compositionend），
   *  新一轮组合开始时由 markPauseBoundary 重新判定。
   *  #314 起公开：根的粘贴分步落段（applyRichPaste 每阶段前置边界，
   *  对齐 main 版根级同名方法的调用面——边界标记随实例，经实例 API
   *  显式置位） */
  markUndoSegmentBoundary(): void {
    if (!this.composing) {
      this.undoCursorBoundary = true
    }
  }

  /**
   * 出站请求坐标转换：本地系 → baseVersion 系（C-2）。宿主重定位把请求
   * 坐标解释为 baseVersion 系，有未确认编辑时本地系与其不一致（多笔在途
   * 的连续输入会被静默错位），必须先逆穿未确认集。未确认集为空时本地系
   * 即 base 系，原样返回。
   */
  private toBaseChanges(changes: SerChange[]): SerChange[] {
    const u = this.unconfirmed
    if (!u || changes.length === 0) {
      return changes
    }
    const sections = chainSections(u)
    return changes.map((c) => {
      const from = localPosToBase(c.offset, sections)
      const to = localPosToBase(c.offset + c.length, sections)
      return { offset: from, length: to - from, text: c.text }
    })
  }

  private beginBlankComposition(): void {
    if (this.blankComposition || !this.deps.isLiveActive() || !this.view) return
    const state = this.view.state
    const selection = state.selection.main
    if (!selection.empty || (!blankRowInputPlan(state, selection.from, selection.to, 'x') &&
        !state.field(tableRegionField, false))) return
    this.blankComposition = { startState: state, changes: null,
      region: state.field(tableRegionField, false) ?? undefined }
    this.compositionCommittedText = null
    this.reportBlankCompositionSnapshot(true)
  }

  /** 仅空白网格组合：结束后取净输入，一笔规范化并沿既有出站链提交。 */
  private finishBlankComposition(): boolean {
    const pending = this.blankComposition
    const view = this.view
    if (!pending || !view) return false
    let net = pending.changes
    if (!net) {
      this.blankComposition = null
      view.dispatch({ selection: view.state.selection, annotations: tableCompositionSettled.of(true) })
      this.reportBlankCompositionSnapshot(false)
      return false
    }
    const initial: SerChange[] = []
    net.iterChanges((from, to, _fromB, _toB, inserted) => {
      initial.push({ offset: from, length: to - from, text: inserted.sliceString(0, inserted.length) })
    })
    let normalized = false
    if (pending.region) {
      const start = pending.startState
      const field = start.field(liveDecorationsField, false)
      const rows = field && tableRowsAt(start, pending.region.tableFrom, field.tree)
      const header = start.doc.lineAt(pending.region.tableFrom)
      const lineNumber = header.number + pending.region.rowFrom + (pending.region.rowFrom > 0 ? 1 : 0)
      const initialLine = lineNumber <= start.doc.lines ? start.doc.line(lineNumber) : null
      const currentLine = lineNumber <= view.state.doc.lines ? view.state.doc.line(lineNumber) : null
      // 格定位按行身份 prefixLen 前缀感知切分（#296 审查轮）：原文直切会
      // 把 `>` 算进首格，typed 回退推导与 selection 锚点错位
      const rowInfo = rows && rows[pending.region.rowFrom + (pending.region.rowFrom > 0 ? 1 : 0)]
      const rowPrefix = rowInfo ? prefixLenOf(rowInfo) : 0
      const initialCell = initialLine && splitTableRowCells(initialLine.text, initialLine.from, rowPrefix)[pending.region.columnFrom]
      const currentCell = currentLine && splitTableRowCells(currentLine.text, currentLine.from, rowPrefix)[pending.region.columnFrom]
      if (rows && initialCell && currentCell) {
        const oldContent = start.doc.sliceString(initialCell.contentFrom, initialCell.contentTo)
        const newContent = view.state.doc.sliceString(currentCell.contentFrom, currentCell.contentTo)
        const typed = this.compositionCommittedText ??
          (newContent.endsWith(oldContent) ? newContent.slice(0, newContent.length - oldContent.length) : newContent)
        const plan = typed ? planTableRegionReplace(start.doc.toString(), rows, pending.region, typed) : null
        if (plan || !typed) {
          const desired = plan ? [...plan.changes].reverse().reduce((doc, change) =>
            doc.slice(0, change.from) + change.insert + doc.slice(change.to), start.doc.toString())
            : start.doc.toString()
          const current = view.state.doc.toString()
          if (desired !== current) {
            let prefix = 0
            while (prefix < current.length && prefix < desired.length && current[prefix] === desired[prefix]) prefix++
            let suffix = 0
            while (suffix < current.length - prefix && suffix < desired.length - prefix &&
              current[current.length - 1 - suffix] === desired[desired.length - 1 - suffix]) suffix++
            view.dispatch({ changes: { from: prefix, to: current.length - suffix,
              insert: desired.slice(prefix, desired.length - suffix) },
              selection: { anchor: plan?.selection ?? initialCell.contentFrom },
              annotations: tableCompositionSettled.of(true) })
            net = pending.changes
          }
          normalized = true
        }
      }
    }
    if (initial.length === 1 && initial[0]!.length === 0 && initial[0]!.text) {
      const edit = initial[0]!
      const plan = blankRowInputPlan(pending.startState, edit.offset, edit.offset, edit.text)
      if (plan) {
        const line = view.state.doc.lineAt(plan.from)
        view.dispatch({
          changes: { from: line.from, to: line.to, insert: plan.insert },
          selection: { anchor: plan.selection },
        })
        net = pending.changes
        normalized = true
      }
    }
    this.blankComposition = null
    this.compositionCommittedText = null
    const changes: SerChange[] = []
    net!.iterChanges((from, to, _fromB, _toB, inserted) => {
      changes.push({ offset: from, length: to - from, text: inserted.sliceString(0, inserted.length) })
    })
    // 组合取消可能先插后删；ChangeSet 仍可包含文本相同的替换。
    const effective = changes.some((change) =>
      pending.startState.doc.sliceString(change.offset, change.offset + change.length) !== change.text)
    if (!effective) {
      view.dispatch({ selection: view.state.selection, annotations: tableCompositionSettled.of(true) })
      this.reportBlankCompositionSnapshot(false)
      return false
    }
    if (!normalized) {
      view.dispatch({ selection: view.state.selection, annotations: tableCompositionSettled.of(true) })
    }
    // 并发全文没有可证明的局部重定位，留给暂停态取回，不能覆盖候选。
    if (this.pendingFull) {
      this.reportBlankCompositionSnapshot(true)
      return true
    }
    if (this.suspended) {
      this.reportConflictSnapshot()
      this.reportBlankCompositionSnapshot(true)
      return true
    }
    this.recordLocalChangeSet(net!, changes)
    this.reportBlankCompositionSnapshot(false)
    return true
  }

  /**
   * 应用缓冲的外部同步。compositionend 后宏任务晚于 CM6 最终上屏微任务；
   * 空白网格组合先提交净本地变更，再将外部变更穿过它做重定位。
   */
  private flushBufferedExternal(): void {
    this.flushTimer = undefined
    if (this.composing || !this.view) {
      // 新一轮组合进行中：缓冲保持，待下一轮 compositionend 重新调度
      return
    }
    const blankInput = this.finishBlankComposition()
    if (blankInput && this.pendingFull) {
      this.pendingFull = undefined
      this.pendingExternal = []
      this.pendingVersionAck = undefined
      this.enterSuspended()
      this.reportConflictSnapshot()
      return
    }
    if (this.suspended) {
      // 暂停期间外部增量作废（保留本地输入，恢复时以全文对齐）；
      // 暂停前缓冲的全文重置仍应用（保留恢复内容，不静默丢弃）
      const suspendedAckVersion = this.pendingVersionAck
      this.pendingVersionAck = undefined
      const groups = this.pendingExternal
      this.pendingExternal = []
      if (this.pendingFull) {
        const { version, text, source } = this.pendingFull
        this.pendingFull = undefined
        this.replaceDoc(text)
        this.baseVersion = Math.max(version, suspendedAckVersion ?? version)
        this.lastDocChangedVersion = Math.max(this.lastDocChangedVersion, version)
        if (source === 'resync') {
          // 协议明文 doc.resync 对暂停面板兼作恢复信号（B-1）：组合中的
          // 恢复延后到这里生效——全文装载并解除暂停
          this.exitSuspended()
          for (const group of groups) {
            if (group.version > version) {
              this.dispatchExternal(group.changes)
              this.baseVersion = Math.max(this.baseVersion, group.version)
            }
          }
          this.deps.onExternalTextApplied?.()
        }
      }
      return
    }
    const ackVersion = this.pendingVersionAck
    this.pendingVersionAck = undefined
    if (this.pendingFull) {
      const { version, text } = this.pendingFull
      this.pendingFull = undefined
      this.unconfirmed = null
      this.ackedChain = null
      this.sentTxns = []
      this.deferredLocal = null
      this.deferredSegments = []
      this.undoCursorBoundary = false
      this.deferredFromComposition = false
      this.replaceDoc(text)
      this.baseVersion = Math.max(version, ackVersion ?? version)
      this.lastDocChangedVersion = Math.max(this.lastDocChangedVersion, version)
    }
    const groups = this.pendingExternal
    this.pendingExternal = []
    let lastVersion = this.baseVersion
    for (const group of groups) {
      if (this.deferredLocal && !this.deferredFromComposition) {
        // 非组合的触碰式暂缓与外部并存：保留输入并暂停（#4 既有保守
        // 口径，suspendResume/compositionBuffer 钉住）。组合暂缓净输入
        // （#123 起含首笔）不在此列——它与 unconfirmed 同步复合、定义域
        // 一致，经下方 base 系映射应用，真重叠由 mapped 判定兜底
        this.enterSuspended()
        return
      }
      // 外部增量已在入队时逆穿到 base 系（迟到逆穿会多平移组合编辑，见
      // BufferedIncremental 注释）；base 系增量直接穿未确认集应用（C-2 后半段）
      const mapped = group.baseChanges
        ? this.applyBaseChanges(group.baseChanges)
        : null // 入队时即与已确认编辑二义：无法安全映射
      if (!mapped) {
        // 外部区间与本地未确认编辑真重叠：无法安全映射。保留本地输入、
        // 暂停写回并上报冲突（#4；不再 sync.request 全文覆盖丢组合输入）
        this.enterSuspended()
        return
      }
      this.dispatchExternalChanges(this.view, mapped)
      lastVersion = group.version
    }
    if (this.inFlight.size === 0) {
      // 缓冲应用完且无在途请求：本地与权威一致
      this.unconfirmed = null
      this.ackedChain = null
      this.sentTxns = []
    }
    this.deps.onExternalTextApplied?.()
    this.baseVersion = Math.max(lastVersion, ackVersion ?? lastVersion)
    this.sendDeferredLocal()
    // #314 分步撤销：缓冲收敛时对末组回放 doc.changed 的 reason/paste
    // （对齐 main 版 flush 末尾的 finishPasteHistory 时机——根做撤销
    // 选区恢复与反馈释放）
    if (groups.length) {
      const last = groups[groups.length - 1]!
      this.deps.onExternalDocSettled?.({ reason: last.reason, paste: last.paste })
    }
    // #148：缓冲收敛且暂缓集已出站（或本就无暂缓输入）——撤销意图可
    // 安全发出（若 sendDeferredLocal 刚发出新请求，释放判定继续等待其 ack）
    this.releasePendingHistory()
    // P2-05：组合 flush 完成可能清空输入挂起态（触发挂起意图重新检查）
    this.notifyInputSettle()
  }

  private scheduleFlush(): void {
    // deferredLocal 计入（#123）：组合期间一律暂缓的本地净输入在
    // compositionend 后也由 flush 定时出站（原先仅靠 edit.ack 到达兜底）
    if (this.flushTimer === undefined && (this.deferredLocal || this.hasBufferedSync() || this.blankComposition)) {
      this.flushTimer = setTimeout(() => this.flushBufferedExternal(), 0)
    }
  }

  /** 撤销/重做转发：宿主持有唯一权威栈，本地不装 history 扩展。
   *  #148 竞态守卫：本地还有未落地宿主的编辑时（在途未确认请求、IME/触碰
   *  暂缓集、未确认坐标链任一非空）不立即发出——宿主队列按到达序串行，
   *  此刻 undo/redo 撤到的是更早的操作，迟到的本地编辑再经重定位静默应用。
   *  意图按下序暂存，待全部落地后由 releasePendingHistory 发出；暂停面板
   *  不持有（B-4 口径不变：照发由宿主忽略）。 */
  requestHistory(op: 'undo' | 'redo'): boolean {
    if (!this.sessionId) {
      return false // 未初始化：让事件继续传播（defaultKeymap 的本地 no-op undo）
    }
    // #314：撤销意图进入即作废未落定的 rich 反馈（对齐 main 版时机——
    // 撤销回流会重写粘贴历史，不再提示「已保留格式」）
    this.deps.onHistoryIntent?.()
    if (!this.suspended && this.hasUnlandedLocalEdits()) {
      this.pendingHistoryOps.push(op)
      // 主动推进出站（暂缓集/缓冲有 flush 定时兜底，这里确保已调度）
      this.scheduleFlush()
      return true
    }
    this.deps.send({ kind: 'history.request', op })
    return true
  }

  /** #148：本地是否存在尚未落地宿主的编辑。在途未确认请求（inFlight/
   *  sentTxns）、IME/触碰暂缓集（deferredLocal）、未确认坐标链（unconfirmed/
   *  ackedChain）、组合中未定稿输入或待 flush 的缓冲任一非空即真。 */
  private hasUnlandedLocalEdits(): boolean {
    return this.inFlight.size > 0 ||
      this.sentTxns.length > 0 ||
      this.deferredLocal !== null ||
      this.unconfirmed !== null ||
      this.ackedChain !== null ||
      this.composing ||
      this.blankComposition !== null ||
      this.hasBufferedSync()
  }

  /** #314 粘贴反馈守卫的只读投影（根 releasePasteFeedback /
   *  finishPasteHistory 的「本地全部落定」判定随目标实例） */
  hasUnlandedLocalEditsNow(): boolean {
    return this.hasUnlandedLocalEdits()
  }

  /** F3（双链联想无 ID 块接受）：本地是否有**尚未出站**的编辑——组合中
   *  （composition 文本不出站）、空白组合暂缓、暂缓未发集任一在场。已
   *  出站在途的请求不在此列：宿主 whenEditsSettled 会等其应用后再装载
   *  文本，权威文本与本地一致、宿主系坐标可直接使用 */
  hasUnsentLocalEditsNow(): boolean {
    return this.composing || this.blankComposition !== null || this.deferredLocal !== null
  }

  /** F3（双链联想无 ID 块接受）：主动推进暂缓编辑出站——联想确认前
   *  核对到未出站编辑时由建议会话触发（宿主系坐标须待权威文本收敛） */
  requestFlushNow(): void {
    this.scheduleFlush()
  }

  private releasePendingHistory(): void {
    if (this.pendingHistoryOps.length === 0) {
      return
    }
    if (this.suspended || this.hasUnlandedLocalEdits()) {
      return
    }
    const ops = this.pendingHistoryOps
    this.pendingHistoryOps = []
    for (const op of ops) {
      this.deps.send({ kind: 'history.request', op })
    }
  }

  private replaceDoc(text: string): void {
    const view = this.view
    if (!view) {
      return
    }
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      annotations: externalSync.of(true),
    })
  }

  // ---- 扩展装配 ----

  /** #81/#84 复制出站（Live effect 转发；阅读侧直连由根自带） */
  private postCodeCopy(text: string): void {
    if (this.sessionId) {
      this.deps.send({
        kind: 'codeblock.copy',
        sessionId: this.sessionId,
        docUri: this.docUri,
        text,
      })
    }
  }

  /** 卡片扩展装配（#79–#82/#190 实例侧）：facet + 折叠状态 + 装饰
   *  StateField + 复制请求转发监听 + 整卡悬停显现追踪（#190：头部与
   *  卡片行无公共 DOM 祖先，reveal 类经 JS 指针追踪挂载）。初次装配与
   *  设置热重配共用，保证监听器在默认配置下同样在场。根特性的浮层
   *  锚点/查找选区/选词会话监听不在此组（由根经 extraExtensions 注入，
   *  不随卡片设置热重配重建） */
  private codeCardExtension() {
    return [
      codeCardConfigFacet.of(this.codeCardConfig),
      codeCardFoldField,
      liveCodeCard,
      codeCardHoverReveal(),
      // #81 复制请求转发：零写回事务携带 effect → codeblock.copy 出站
      EditorView.updateListener.of((update) => {
        for (const tr of update.transactions) {
          for (const eff of tr.effects) {
            if (eff.is(codeCardCopyRequest)) {
              this.postCodeCopy(eff.value)
            }
          }
        }
      }),
    ]
  }

  /** 实例扩展装配：与主正文原 extensions() 同序迁移（P2-02 等价搬运；
   *  顺序语义见 symbol-input.md「装配顺序陷阱」——keymap 正序拼接、
   *  filter 逆序应用，fenceEscape 必须在 tableEditing 之前）。 */
  private extensions(extraExtensions: Extension[]) {
    const captureCompositionStart = () => {
      // #153：组合开始时刻（捕获阶段、置组合态之前）回看与上一笔本地
      // 输入的停顿——组合间分段的唯一判定点。必须在 composing 置 true 前
      // 判定（ViewPlugin 捕获阶段先于 domEventHandlers 冒泡运行）；组合
      // 进行中的候选更新不再回看，否则组合中长停顿后继续选候选会把一次
      // 组合拆成两段（违反原子性）
      this.markPauseBoundary()
      // CM6 的内建 observer 在冒泡阶段会先删除跨行选区；必须在捕获
      // 阶段标记组合，首笔删除才能进入 deferredLocal 与定稿重建合并。
      this.composing = true
      this.beginBlankComposition()
      // P2-05：组合开始 = 输入挂起态——置位 settle 检测
      this.notifyInputSettle()
    }
    return [
      EditorView.lineWrapping,
      // 宿主明暗主题声明：初始按装配时刻 deps.initialDark，切换时热重配
      // （applyDarkTheme）。baseTheme 内建变体接管 caret 等颜色——不硬编码
      this.darkCompartment.of(EditorView.darkTheme.of(this.hostDarkApplied === true)),
      // 行号栏（#34）：源文件行号经 Compartment 装配（设置开关热重配，
      // 装配时按定义默认开）；列在流内、与正文以固定间距相隔的布局
      // 见 main.css 的 #34 段（行号列宽随位数自适应，无降级机制）
      this.lineNumbersCompartment.of(this.lineNumbersOn ? liveLineNumbers() : []),
      // #296 三轮「块内表格渲染」：容器内表格网格化开关（默认开，设置
      // 快照/变更到达后热重配；liveDecorationsField 检测 facet 变化全量重建）
      this.tableRenderCompartment.of(tableContainerRenderFacet.of(this.tableBlockRenderOn)),
      // 标题实时预览装饰（#5 切片）：直接装饰（StateField）+ 间接装饰
      // （ViewPlugin 按 visibleRanges），见 liveDecorations.ts 头注释
      livePreviewDecorations,
      // 右键保选区（#186 bug 1）：右键 mousedown 在选区内 preventDefault
      contextMenuSelectionGuard,
      // #10 链接/图片：视口间接装饰（链接 span、图片 widget）+ Ctrl/Cmd
      // 单击跳转意图上报（执行归宿主）；#11 双链同通道（原始 target 上报）
      createLinkInteractions({
        postActivate: (href, srcStart, srcEnd) => {
          if (this.sessionId) {
            this.deps.send({
              kind: 'link.activate',
              sessionId: this.sessionId,
              docUri: this.docUri,
              href,
              srcStart,
              srcEnd,
            })
          }
        },
        postActivateWikilink: (target, srcStart, srcEnd) => {
          if (this.sessionId) {
            this.deps.send({
              kind: 'wikilink.activate',
              sessionId: this.sessionId,
              docUri: this.docUri,
              target,
              srcStart,
              srcEnd,
            })
          }
        },
        images: this.deps.images,
      }),
      // #59 公式：跨行块表（StateField 增量）+ 视口装饰（光标进入显源码、
      // 离开恢复 KaTeX 排版；渲染与装饰实例均按源文缓存）
      liveMath,
      // #60 Mermaid：围栏表 + 跨行块 replace 装饰（光标进入围栏显源码、
      // 离开恢复渲染图；渲染容器与阅读侧共用 mermaidRender 管线）
      liveMermaid,
      // #223/#247 Live 正文嵌入：嵌入表 + 双形态装饰（隐形态只替换嵌入
      // 精确区间 [from, to] 呈卡片——#247 起不再整行替换，前后文与父结构
      // 保留 / 显形态源文可见 + 行下方卡片；光标/选区触及源码区间显形，
      // 离开隐藏）。纯装饰 StateField 无键位语义；卡片内容经 embedCards
      // （EmbedCardManager）与 Reading 侧同状态库装载（接线归根，
      // P2-11 迁移实例化）
      liveEmbed,
      // #163 验收反馈：块 id 标记淡化（行尾 ` ^id` 与独立行 `^id` 双形态
      // mark 装饰；围栏内部不命中；docChanged 全量行扫描重建）
      liveBlockId,
      // #163 验收反馈：跳转目标高亮（行级 line 装饰，effect 驱动）
      anchorFlash,
      // #79 代码块卡片：呈现态围栏收起 + 头部横带 + 卡片行类（配置经
      // Compartment 热重配，围栏表复用上方 mermaidFencesField）
      this.codeCardCompartment.of(this.codeCardExtension()),
      // #140 frontmatter 光标引导：成型头区不暴露源码——选区进入被弹到
      // 闭合行后（filter 硬拦 + updateListener 兜底），编辑收敛到标题栏
      // 「修改」按钮的 Popover；文档变更同时驱动浮层按最新模型重建
      frontmatterEditing,
      // #376 T01 双链联想候选：keymap 必须置于 fenceEscape 之前（keymap
      // 正序尝试——候选确认/导航仅在会话内消费，未命中 return false 落穿
      // 越界/切格/缩进/列表延续链）。#381 T06 起主正文与嵌入实例统一装配；
      // 嵌入的 Esc 与本 keymap 的次序协调在 embedCard.embedEscapeKeymap
      //（Prec.high 先尝试——候选在场时豁免落穿到本组）
      ...(this.wikilinkSuggest ? [this.wikilinkSuggest.extension] : []),
      // #125 围栏内两步 Tab 越界：必须置于 tableEditing **之前**——CM6
      // keymap 与 transactionFilter 的顺序语义相反：keymap 把全部绑定按
      // 扩展数组顺序正序拼接后依序尝试（@codemirror/view buildKeymap/
      // runHandlers 正序遍历，靠前者先匹配、return false 落穿给后者；
      // filter 是逆序应用——#123/#124 排在 tableEditing 之后即彼故）。
      // 靠前装配使「格内有效围栏先越界、越出后 Tab 切格、正文未命中落
      // 缩进」三段优先级无需改 tableEditing/indentEditing 一行代码；
      // 未命中 return false 自然落穿。关闭时经 tabEscapeCompartment
      // 整组退出装配
      this.tabEscapeCompartment.of(this.tabEscapeOn ? fenceEscape : []),
      // 表格单元格输入钩子（#12）：表格行内键入 | 转义写回 \|；
      // 编辑面即 CM6 源文本行，同步链路复用本实例的标准出站路径
      tableEditing,
      // #123 符号自动补全：置于 tableEditing 之后（扩展数组靠后者先
      // 过滤/先匹配）——符号补全先于表格的空白行规范化与格区替换看到
      // 事务（无选区单字符场景与它们互斥），Backspace 链先于表格删除
      // 命令（自动空对是更具体的编辑器状态）；设置关闭时经
      // symbolAutocloseCompartment 整组退出装配
      this.symbolAutocloseCompartment.of(this.symbolAutocompleteOn ? symbolAutocomplete : []),
      // #124 选区包裹：置于 symbolAutocomplete 之后（靠后者先过滤）——
      // 包裹只认非空选区（与补全分支互斥），改写后补全 filter 按
      // startState 选区门控自然放行；多 range 原文选区的存续依赖
      // #237 多光标组的 allowMultipleSelections（独立设置，默认开）；
      // 关闭时经 compartment 整组退出
      this.symbolSelectionWrapCompartment.of(this.symbolSelectionWrapOn ? symbolSelectionWrap : []),
      // #237 多光标：allowMultipleSelections + drawSelection（副光标/多选区
      // 可见）+ alt+click 添加选区 + defaultKeymap 内建 Ctrl+Alt+方向键接管
      // （键位所有权归操作注册表）。组内无 keymap/filter 顺序语义（facet/
      // 绘制层/吞键 keymap 与其他扩展不竞争事务），关闭时整组退出装配
      this.multicursorCompartment.of(this.multicursorOn ? multicursorExtensions : []),
      // #119 列表/引用 Enter 前缀延续与退格清层：必须排在 tableEditing
      // 之后（表格上下文优先，格内 Enter 仍为 <br>）、extraExtensions 的
      // defaultKeymap 之前（先于通用键位拦截）
      listEditing,
      // #120 Tab/Shift+Tab 通用行缩进：排在 tableEditing 之后（表格
      // 单元格导航优先，表格行不缩进）、defaultKeymap 之前
      indentEditing,
      // #314 富文本粘贴接管（paste domEventHandler）：带 text/html 且无
      // 图片文件的原生粘贴交根钩子（html→markdown 转换、弹窗决策与
      // clipboardReadTarget 在途登记在根，见 WebviewSyncController.
      // handleRichPasteHtml）；根未接管（含嵌入实例未提供钩子——组合
      // 边界）放行默认粘贴链。无 keymap/filter 顺序语义（paste 与其他
      // DOM handler 互不竞争），置于 createImagePaste 之前仅作分组
      EditorView.domEventHandlers({ paste: (event, view) => {
        if (!this.deps.isLiveActive() || this.suspended || view.compositionStarted ||
            view.state.readOnly || !view.state.facet(EditorView.editable)) return false
        const data = event.clipboardData
        if (!data || Array.from(data.items).some((item) => item.kind === 'file' && item.type.startsWith('image/'))) return false
        const html = data.getData('text/html')
        if (!html) return false
        const text = Array.from(data.types).includes('text/plain')
          ? data.getData('text/plain')
          : undefined
        if (this.deps.onRichPasteHtml?.({ view, html, text }) !== true) return false
        event.preventDefault()
        return true
      } }),
      // #161 图片粘贴拦截（paste domEventHandler）：无 keymap/filter 顺序
      // 语义（paste 与其他 DOM handler 互不竞争），置于装饰与编辑钩子之后
      // 仅作分组；命中 image/* 剪贴板项即出站宿主落盘，未命中放行默认粘贴
      createImagePaste({
        isEnabled: () => this.imagePasteEnabledNow(),
        getSession: () => (this.sessionId ? { sessionId: this.sessionId, docUri: this.docUri } : null),
        nextReqId: () => ++this.imagePasteReqId,
        post: (message) => {
          if (message.kind === 'image.paste') {
            this.imagePastePending.add(message.reqId)
          }
          this.deps.send(message)
        },
      }),
      // 查找装饰（#14）：当前匹配（直接）+ 全部匹配（视口内间接）。
      // #236 引擎：@codemirror/search 的 SearchQuery 作匹配引擎（findSession
      // 内构造，官方面板与 searchKeymap 不装——高亮自绘）；#241 评审修复
      // 起官方 replaceNext/replaceAll 命令与 search() query 状态整体退役，
      // 替换走 computeFindReplaceMatches/planReplaceNext 自研路径（头区
      // 排除，见 runFindReplace）
      findDecorations,
      ...extraExtensions,
      EditorView.updateListener.of((update) => {
        // 根特性的事务旁路观测先行（快速操作条/模式锚点/查找/大纲），
        // 与原 updateListener 内「根联动在前、同步簿记在后」的次序一致
        this.deps.onViewUpdate?.(update)
        for (const tr of update.transactions) {
          // T06（#355）快照修订标记：文档代次推进（本地输入与外部同步
          // 都算——页面文本任何变化都让旧快照失效）
          if (tr.docChanged) {
            this.docRevision += 1
          }
          if (!tr.docChanged || tr.annotation(externalSync)) {
            continue
          }
          if (this.blankComposition) {
            const buffered = this.blankComposition
            buffered.changes = buffered.changes ? buffered.changes.compose(tr.changes) : tr.changes
            // #153：空白格组合候选也是本地输入——刷新停顿计时的基准
            this.lastLocalInputAt = Date.now()
            this.reportBlankCompositionChanges(tr.changes)
            continue
          }
          if (this.suspended) {
            // 暂停写回：本地文本继续保留累积，但不回传、不追踪同步状态；
            // 立即刷新宿主全文快照，快速关闭时也能取回这笔输入。
            this.reportConflictSnapshot()
            continue
          }
          const changes: SerChange[] = []
          tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
            changes.push({
              offset: fromA,
              length: toA - fromA,
              text: inserted.sliceString(0, inserted.length),
            })
          })
          // T06（#355）SDK 修饰事务：来源列表随事务透传出站
          const addonTag = tr.annotation(addonEditOriginTag)
          this.recordLocalChangeSet(tr.changes, changes, addonTag?.origins)
        }
      }),
      // 撤销/重做转发 keymap：置于数组末尾——CM6 同优先级 keymap 按数组
      // 先后依次尝试（先者先匹配），调用方传入的 defaultKeymap（其本地
      // undo/redo 绑定在未装 history 扩展时返回 false）先于本转发落穿，
      // 之后才轮到转发请求宿主权威栈。#314 起 stopPropagation：撤销意图
      // 不得落穿到 webview 预载脚本的宿主键位转发（宿主 undo 会绕开
      // 本实例的粘贴历史回流语义）
      keymap.of([
        { key: 'Mod-z', run: () => this.requestHistory('undo'), stopPropagation: true },
        { key: 'Shift-Mod-z', run: () => this.requestHistory('redo'), stopPropagation: true },
        { key: 'Mod-y', run: () => this.requestHistory('redo'), stopPropagation: true },
      ]),
      ViewPlugin.fromClass(class {
        private readonly onStart = captureCompositionStart

        constructor(private readonly view: EditorView) {
          view.contentDOM.addEventListener('compositionstart', this.onStart, true)
        }

        destroy() {
          this.view.contentDOM.removeEventListener('compositionstart', this.onStart, true)
        }
      }),
      // IME 组合状态跟踪：compositionend 后调度缓冲 flush
      Prec.highest(EditorView.domEventHandlers({
        compositionstart: () => {
          // 停顿回看在 captureCompositionStart（捕获阶段）已完成——到达
          // 冒泡 handler 时 composing 已置 true，此处只保留既有标记逻辑
          this.composing = true
          this.beginBlankComposition()
        },
        compositionupdate: () => {
          // 未观察到 start 的迟入组合（missed start 兜底）：捕获阶段未回看
          // 停顿，这里在置组合态前补判；组合中的候选更新不再回看（原子性）
          if (!this.composing) {
            this.markPauseBoundary()
            this.composing = true
          }
          this.beginBlankComposition()
          // P2-05：组合开始 = 输入挂起态——置位 settle 检测
          this.notifyInputSettle()
        },
        compositionend: (event) => {
          this.compositionCommittedText = event.data || null
          this.composing = false
          this.scheduleFlush()
        },
        // #153：用户主动移光标开新撤销段（点击 / 导航键选区移动）；纯输入
        // 导致的光标后移不在此列（不派发 DOM 事件信号）
        mousedown: () => {
          this.markUndoSegmentBoundary()
        },
        keydown: (event) => {
          if (UNDO_SEGMENT_NAV_KEYS.has(event.key)) {
            this.markUndoSegmentBoundary()
          }
        },
      })),
      // #351 T02 附加组件扩展槽（数组末尾，见 addonExtensionCompartment 注释）
      this.addonExtensionCompartment.of([]),
    ]
  }

  /** #351 T02：附加组件扩展槽重配（装载器 registerExtensions/释放驱动；
   *  null = 摘除全部组件扩展。文档状态跨 reconfigure 保留——输入不落格
   *  （V02 浏览器套件钉住的硬边界），未初始化实例为无操作） */
  reconfigureAddonExtensions(extensions: Extension[] | null): void {
    this.view?.dispatch({ effects: this.addonExtensionCompartment.reconfigure(extensions ?? []) })
  }
}
