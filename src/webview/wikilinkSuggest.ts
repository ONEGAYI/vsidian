// 双链文件联想会话（工单 #376 T01 + #378 T03 + #379 T04 + #380 T05 +
// #381 T06）：新建闭合双链 `[[]]` / `![[]]`、既有双链目标区重编辑、#／^／|
// 转阶段与输入仲裁——识别、查询、候选 UI、键盘与确认插入。
//
// 职责与边界（规格 docs/specs/wikilink-completion.md「技术设计与实施边界」）：
// - 识别是**新增局部逻辑**（shared/wikilinkField），只服务联想触发；完整
//   渲染解析器（shared/wikilink.ts）语义不动。代码上下文/前端头区不启用
//   候选（inCodeContext 环境守卫）。#381 T06 起表格格内启用：格内容窗口
//   + `\|` 转义分隔符（pipeEscape），矩形蒙版态（tableRegionField 在场）
//   仍不识别。
// - 会话只认单个折叠光标的可编辑 Live 正文：多 range／非空选区、IME 组合
//   期、暂停、源码模式与 Reading 不接管。纯光标移动不发起新查询；移出
//   目标字段（按阶段：文件字段或锚点字段）、切模式、暂停、外部同步与
//   实例释放关闭候选。
// - 再次触发只认目标区（| 之前）的用户输入／删除；显示文字编辑、纯光标
//   移动与用户以外的正文变更不重开（规格「触发、关闭与再次触发」）。
// - 查询经内部消息协议（wikilink.query / wikilink.query.result 与
//   #379 T04 的 wikilink.heading.query / .result）：reqId 请求配对 +
//   generation 查询代次双守卫，迟到响应一律拒收；宿主不可用时显示真实
//   状态、允许手写、不伪装空结果。同一查询的更新帧按候选身份保留手动
//   高亮；身份消失时空查询回无高亮、非空查询取首项。
// - 转阶段（#378 T03）：#／^ 接受文件阶段高亮并切标题/块阶段；块标记
//   形成现有 `#^` 语法且已有 # 不重复补；| 接受当前阶段真实高亮，进显示
//   文字并关闭候选，无高亮保留原输入。占位只作提示（i18n status 行），
//   不可确认、不写正文，Enter/Tab 落穿。
// - 标题阶段（#379 T04）：文件目标明确（target 非空——经 T03 # 转阶段补全
//   或用户手写）时出站标题查询（宿主按来源相对语义解析为明确 Markdown
//   目标并读当前正文）；候选显示标题与层级/行号，重复标题独立身份全部
//   展示不合并，确认/竖线替换整个锚点字段（无手写别名补文件名默认别名），
//   选中规范化同名项以 toast 提示定位风险并**继续接受**（不改跳转语义）；
//   空目标 # 与块阶段 ^ 保持 T03 占位（空目标不猜默认文档；块候选归 T05）。
// - 键位是**候选会话内的固定控件按键**（↑↓ 移动高亮、Enter/Tab 确认、
//   Esc 关闭、#／^／| 转阶段），仅在会话内消费，未命中一律 return false
//   落穿既有围栏越界/表格切格/缩进/列表延续链；不注册快捷键操作表、
//   不经全局 keybindingRouter（评估记录见 docs/specs/keybindings.md）。
// - 候选浮层锚定实际 EditorView 的目标位置（当前阶段字段起点），不夺
//   正文焦点；行结构为 listbox/option 语义 + 键盘高亮类。
//
// 本模块随 LiveEditorInstance 装配（扩展数组置于 fenceEscape 之前——keymap
// 正序尝试，候选确认优先于越界/切格/缩进；关闭时无键位残留）。
import { EditorSelection, EditorState, type Extension, type Transaction } from '@codemirror/state'
import { EditorView, keymap, type ViewUpdate } from '@codemirror/view'
import {
  findWikilinkTargetField,
  planWikilinkFieldEdit,
  type WikilinkBlockPlanItem,
  type WikilinkHeadingPlanItem,
  type WikilinkPhaseKey,
  type WikilinkPlanItem,
  type WikilinkTargetStage,
} from '../shared/wikilinkField'
import type {
  HostToWebview,
  WebviewToHost,
  WikilinkBlockItem,
  WikilinkCandidateItem,
  WikilinkHeadingItem,
} from '../shared/protocol'
import { WIKILINK_QUERY_LIMIT } from '../shared/protocol'
import { t } from '../shared/i18n'
import { inCodeContext } from './symbolAutocomplete'
import { tableRegionField } from './tableRegionSelection'
import { liveDecorationsField } from './liveDecorations'
import { tableRowsAt } from './tableEditing'
import type { TableRowInfo } from './tableStructure'
import { isEscapedAt, scanCodeSpans } from '../shared/tableCells'
import './wikilinkSuggest.css'

/** 浮层类名（公开样式契约 chrome 域 wikilink-suggest 类目；单一事实源
 *  src/shared/styleContract.ts） */
export const WIKILINK_SUGGEST_CLASS_NAMES = {
  popup: 'vsidian-wikilink-suggest',
  list: 'vsidian-wikilink-suggest-list',
  item: 'vsidian-wikilink-suggest-item',
  itemActive: 'vsidian-wikilink-suggest-item-active',
  status: 'vsidian-wikilink-suggest-status',
  hints: 'vsidian-wikilink-suggest-hints',
  name: 'vsidian-wikilink-suggest-name',
  dir: 'vsidian-wikilink-suggest-dir',
  highlight: 'vsidian-wikilink-suggest-hl',
} as const

/** 会话外部依赖（实例注入；不出站通道/会话身份不归本模块所有） */
export interface WikilinkSuggestDeps {
  send(message: WebviewToHost): void
  /** 实例目标会话（未 init 时 null——此时不出站查询） */
  getSession(): { sessionId: string; docUri: string } | null
  isLiveActive(): boolean
  isSuspended(): boolean
  /** 外部同步事务判定（externalSync 注解的实例侧投影）：外部正文变更
   *  不自动重开候选（用户以外的正文变更，规格输入矩阵） */
  isExternal(tr: Transaction): boolean
  /** 轻提示通道（#379 T04 重复标题风险提示；缺省静默跳过——无 toast 面
   *  的装配环境不阻塞确认） */
  showToast?(text: string, severity: 'neutral' | 'warning' | 'error'): void
  /** 本地是否有**尚未出站**的编辑（IME 组合中/空白组合暂缓/暂缓未发集；
   *  F3——无 ID 块接受出站前核对：sameDoc 回包的宿主系 markerLfOffset
   *  基于权威文本，未出站编辑宿主收不到（whenEditsSettled 也不等），
   *  此窗口内接受会让插入点在本地系错位破坏正文。已出站在途的请求不
   *  在此列——宿主会等其应用后再装载，文本与本地一致。缺省视为无
   *  暂缓（不阻塞确认） */
  hasUnsentLocalEdits?(): boolean
  /** 主动推进暂缓编辑出站（flush 定时提前；F3 与核对配套） */
  scheduleFlush?(): void
}

/** 识别快照（字段边界为文档绝对偏移；T03 起阶段化——文件/标题/块） */
interface SuggestOrigin {
  stage: WikilinkTargetStage
  embed: boolean
  openFrom: number
  /** 围栏内部起点（= 文件字段起点） */
  innerFrom: number
  /** 文件字段终点（首个 #/| 前；无则 ] 前） */
  fileTo: number
  closeFrom: number
  hashAt: number
  /** 锚点字段区间（hashAt < 0 时 -1） */
  anchorFrom: number
  anchorTo: number
  pipeAt: number
  /** 分隔符字符数（#381 T06 表格格内为 2——`\|` 转义序列） */
  pipeWidth: 1 | 2
}

/** 最近一次接受的查询结果（真实状态面；阶段化——文件/标题/块） */
type SuggestResult =
  | {
      stage: 'file'
      status: 'ready' | 'noWorkspace' | 'notReady'
      updating: boolean
      items: WikilinkCandidateItem[]
      total: number
      /** 结果携带的清单代次（#377 T02；跨代次的追加页不拼接——重取首页） */
      catalogGen: number
      /** 最近一页是否为满页（F6：items 数 === 页大小；不满页 = 排名穷尽，
       *  触底续页与 remaining 提示以此为终态判据，不信 total 虚高） */
      pageFull: boolean
    }
  | {
      stage: 'heading'
      status: 'ready' | 'noWorkspace' | 'notFound' | 'notMd' | 'readError'
      items: WikilinkHeadingItem[]
    }
  | {
      stage: 'block'
      status: 'ready' | 'noWorkspace' | 'notFound' | 'notMd' | 'readError'
      items: WikilinkBlockItem[]
      /** 查询依据的目标版本（无 ID 块接受时回传——宿主核对淘汰旧候选） */
      targetVersion: number
    }

/** 无 ID 块接受在途（#380 T05）：reqId 配对 + 接受键语义 + 会话身份快照。
 *  在途期间浮层显示「正在补写块 ID…」；会话重建/关闭时发 cancel 让宿主
 *  守卫撤回已补写的标记（V01 场景 6 收尾） */
interface PendingBlockAccept {
  reqId: number
  /** 接受键（Enter/Tab=confirm、|=进显示文字）——结果到达时按原语义组计划 */
  key: 'confirm' | '|'
  /** 出站时的会话身份（cancel 时可能当前会话已重建，用快照） */
  sessionId: string
  docUri: string
}

/** 字段身份全量比较（去重守卫用）：任何边界变化（如光标右侧闭围栏被删）
 *  都产生新 origin——陈旧边界会让「移出字段关闭」误判在界内 */
function sameOrigin(a: SuggestOrigin, b: SuggestOrigin): boolean {
  return a.stage === b.stage && a.embed === b.embed && a.innerFrom === b.innerFrom &&
    a.fileTo === b.fileTo && a.closeFrom === b.closeFrom && a.hashAt === b.hashAt &&
    a.anchorFrom === b.anchorFrom && a.anchorTo === b.anchorTo && a.pipeAt === b.pipeAt &&
    a.pipeWidth === b.pipeWidth
}

export class WikilinkSuggestController {
  private view: EditorView | null = null
  private session: { origin: SuggestOrigin; query: string; generation: number; target: string } | null = null
  /** 出站请求序号（实例内单调；应答配对键） */
  private reqSeq = 0
  private lastReqId = -1
  /** 最近一次出站请求的分页起点（#377 T02；>0 时应答按追加页处理） */
  private lastReqOffset = 0
  /** 追加请求在途（moveActive 触底触发一次，应答前不重复发） */
  private morePending = false
  /** 失效信号去抖定时器（#377 T02 wikilink.invalidate） */
  private invalidateTimer: ReturnType<typeof setTimeout> | undefined
  private result: SuggestResult | null = null
  /** 键盘高亮行（null = 无高亮；空查询初始即 null） */
  private activeIndex: number | null = null
  /** 键盘高亮的候选身份（id；更新帧按身份保留手动高亮，#378 T03） */
  private activeId: string | null = null
  /** 确认/转阶段 dispatch 期间抑制识别（会话内编辑不得重开会话） */
  private confirming = false
  /** 无 ID 块接受在途（#380 T05） */
  private pendingBlockAccept: PendingBlockAccept | null = null
  private popup: HTMLDivElement | null = null
  private readonly deps: WikilinkSuggestDeps
  private readonly scrollListeners: Array<() => void> = []

  constructor(deps: WikilinkSuggestDeps) {
    this.deps = deps
  }

  /** CM6 扩展组：会话键位 + 更新监听。装配次序由实例决定（fenceEscape 之前）。
   *  #381 T06 起 focusout 关闭候选：焦点真正离开本编辑器（主正文 → 嵌入 B
   *  或反向）即关闭会话——多实例并存时浮层不残留（候选 UI 仅操作当前
   *  焦点实例）；候选行的 pointerdown 已 preventDefault 不触发 focusout */
  get extension(): Extension {
    return [
      keymap.of([
        { key: 'ArrowUp', run: () => this.moveActive(-1) },
        { key: 'ArrowDown', run: () => this.moveActive(1) },
        { key: 'Enter', run: () => this.confirm() },
        { key: 'Tab', run: () => this.confirm() },
        { key: 'Escape', run: () => this.escape() },
        { key: '#', run: () => this.phase('#') },
        { key: '^', run: () => this.phase('^') },
        { key: '|', run: () => this.phase('|') },
      ]),
      EditorView.updateListener.of((update) => this.onUpdate(update)),
      EditorView.domEventHandlers({
        focusout: (event, view) => {
          const next = event.relatedTarget
          if (next instanceof Node && view.contentDOM.contains(next)) {
            return false // 焦点仍在编辑器域内（widget 内等）
          }
          if (next instanceof Node) {
            this.close()
            return false
          }
          // 无 relatedTarget 的浏览器路径：微任务后核对 activeElement（Tab
          // 导航离开时 relatedTarget 为 null 但焦点确已离开）
          queueMicrotask(() => {
            if (!view.contentDOM.contains(document.activeElement)) {
              this.close()
            }
          })
          return false
        },
      }),
    ]
  }

  /** 绑定视图（实例创建后调用；滚动/缩放重定位监听随会话开关挂摘） */
  attach(view: EditorView): void {
    this.view = view
  }

  /** 实例释放（视图销毁随调用方；浮层 DOM 移除归本模块） */
  destroy(): void {
    if (this.invalidateTimer !== undefined) {
      clearTimeout(this.invalidateTimer)
      this.invalidateTimer = undefined
    }
    this.cancelPendingBlockAccept('closed')
    this.detachScrollListeners()
    this.removePopup()
    this.view = null
    this.session = null
    this.result = null
  }

  /** 查询结果入站（根路由）：reqId + generation + 会话三重守卫，任一
   *  不符即迟到响应，拒收不改状态。#377 T02 起区分首页/追加页：追加页
   *  （请求 offset>0）拼接条目并保留手动高亮；清单代次与当前结果不一致
   *  的追加页不拼接——按新代次重取首页（不复活旧清单条目） */

  /** 结果回包五重守卫（#386 收敛：reqId／代次／会话身份／挂起与活跃／
   *  阶段）——file/heading/block 三个回包入口共用；不符即迟到或错位
   *  响应，拒收不改状态 */
  private resultAdmissible(
    message: { reqId: number; generation: number; sessionId: string; docUri: string },
    stage: 'file' | 'heading' | 'block',
  ): boolean {
    if (!this.session || this.lastReqId < 0 || message.reqId !== this.lastReqId) {
      return false
    }
    if (this.session.generation !== message.generation) {
      return false
    }
    const current = this.deps.getSession()
    if (!current || current.sessionId !== message.sessionId || current.docUri !== message.docUri) {
      return false
    }
    if (this.deps.isSuspended() || !this.deps.isLiveActive()) {
      return false
    }
    return this.session.origin.stage === stage
  }

  handleResult(message: Extract<HostToWebview, { kind: 'wikilink.query.result' }>): void {
    if (!this.resultAdmissible(message, 'file')) {
      return // 守卫不符即迟到/错位响应（五重守卫见 resultAdmissible）
    }
    // 同一查询的更新帧（此前已有该代次结果）：手动高亮按候选身份保留
    const sameQueryUpdate = this.result !== null
    const prevActiveId = this.activeId
    if (message.status === 'unavailable') {
      this.result = {
        stage: 'file',
        status: message.reason === 'not-ready' ? 'notReady' : 'noWorkspace',
        updating: false, items: [], total: 0, catalogGen: 0, pageFull: false,
      }
      this.morePending = false
    } else {
      const pageItems = message.items ?? []
      const pageGen = message.catalogGen ?? 0
      // F6：满页判定（items 数 === 页大小）——不满页即排名穷尽（宿主侧
      // 病态补位后的终态信号）；updating 部分数据不判穷尽（构建完成后经
      // invalidate 整页刷新）
      const pageFull = !message.updating && pageItems.length >= WIKILINK_QUERY_LIMIT
      const prev = this.result
      if (this.lastReqOffset > 0 && prev !== null && prev.stage === 'file' && prev.status === 'ready') {
        if (prev.catalogGen !== pageGen) {
          // 清单代次已变：追加页序位失效，重取首页（同查询同代次）
          this.sendQuery(this.session.query, this.session.generation, 0)
          return
        }
        // F6：追加页按候选 id 去重兜底（宿主滑动补位后不应重复；防御性
        // 挡住跨页身份复现造成的重复行）
        const seen = new Set(prev.items.map((item) => item.id))
        const fresh = pageItems.filter((item) => !seen.has(item.id))
        this.result = {
          stage: 'file',
          status: 'ready',
          updating: message.updating === true,
          items: prev.items.concat(fresh),
          total: message.total ?? prev.total,
          catalogGen: pageGen,
          pageFull,
        }
        this.morePending = false
        this.render()
        return
      }
      this.result = {
        stage: 'file',
        status: 'ready',
        updating: message.updating === true,
        items: pageItems,
        total: message.total ?? 0,
        catalogGen: pageGen,
        pageFull,
      }
      this.morePending = false
    }
    // 高亮规则：更新帧按身份找位（身份消失时空查询回无高亮、非空查询取
    // 首项）；新查询首帧执行初始规则（空查询无高亮、非空高亮首项）
    this.applyHighlightRule(sameQueryUpdate, prevActiveId)
    this.render()
  }

  /**
   * 标题查询结果入站（#379 T04）：reqId + generation + 会话三重守卫（与
   * handleResult 同构），任一不符即迟到响应，拒收不改状态；仅标题阶段
   * 会话消费（块阶段占位不出站，无回包路径）。重复标题候选独立身份全部
   * 展示；同一查询的重发帧（invalidate 去抖后同 generation）按候选身份
   * 保留手动高亮。
   */
  handleHeadingResult(message: Extract<HostToWebview, { kind: 'wikilink.heading.query.result' }>): void {
    if (!this.resultAdmissible(message, 'heading')) {
      return // 守卫不符即迟到/错位响应（五重守卫见 resultAdmissible）
    }
    const sameQueryUpdate = this.result !== null
    const prevActiveId = this.activeId
    if (message.status === 'unavailable') {
      this.result = {
        stage: 'heading',
        status: message.reason === 'no-workspace' ? 'noWorkspace'
          : message.reason === 'target-not-md' ? 'notMd'
          : message.reason === 'read-error' ? 'readError'
          : 'notFound',
        items: [],
      }
    } else {
      this.result = { stage: 'heading', status: 'ready', items: message.items ?? [] }
    }
    this.applyHighlightRule(sameQueryUpdate, prevActiveId)
    this.render()
  }

  /**
   * 块查询结果入站（#380 T05）：reqId + generation + 会话三重守卫（与
   * handleResult 同构），任一不符即迟到响应，拒收不改状态；仅块阶段会话
   * 消费。无 ID 块照常列出（接受经宿主补写通道）；同一查询的重发帧按候选
   * 身份保留手动高亮。
   */
  handleBlockResult(message: Extract<HostToWebview, { kind: 'wikilink.block.query.result' }>): void {
    if (!this.resultAdmissible(message, 'block')) {
      return // 守卫不符即迟到/错位响应（五重守卫见 resultAdmissible）
    }
    const sameQueryUpdate = this.result !== null
    const prevActiveId = this.activeId
    if (message.status === 'unavailable') {
      this.result = {
        stage: 'block',
        status: message.reason === 'no-workspace' ? 'noWorkspace'
          : message.reason === 'target-not-md' ? 'notMd'
          : message.reason === 'read-error' ? 'readError'
          : 'notFound',
        items: [],
        targetVersion: 0,
      }
    } else {
      this.result = {
        stage: 'block',
        status: 'ready',
        items: message.items ?? [],
        targetVersion: message.targetVersion ?? 0,
      }
    }
    this.applyHighlightRule(sameQueryUpdate, prevActiveId)
    this.render()
  }

  /**
   * 无 ID 块接受结果入站（#380 T05）：pendingBlockAccept 的 reqId 配对 +
   * 会话身份/generation 守卫。ok=true → 复核字段身份后按原接受键组编辑
   * 计划一笔 dispatch（sameDoc 时标记插入并入同一事务——一笔受控操作），
   * 关闭会话并回 linked（因果登记）；字段漂移/守卫不符 → cancel 让宿主守卫
   * 撤回；ok=false → toast 保留输入（会话与候选原样，可重试或 Esc）。
   */
  handleBlockAcceptResult(message: Extract<HostToWebview, { kind: 'wikilink.block.accept.result' }>): void {
    const pending = this.pendingBlockAccept
    if (pending === null || message.reqId !== pending.reqId) {
      return
    }
    const current = this.deps.getSession()
    if (!current || current.sessionId !== message.sessionId || current.docUri !== message.docUri) {
      this.cancelPendingBlockAccept('stale-result')
      return
    }
    if (this.deps.isSuspended() || !this.deps.isLiveActive()) {
      this.cancelPendingBlockAccept('stale-result')
      return
    }
    if (!message.ok) {
      // 失败保留输入并提示（规格：不能先写虚构 ID；目标变化/只读/失败真实分态）。
      // F4：target-changed（目标版本已变——典型为 IME 定稿/暂缓编辑落地
      // 晚于查询结果）不 toast 也不就此了结——重发当前阶段查询刷新 result
      // （含新 targetVersion），用户重按确认即成功；否则过期版本重试恒败
      this.pendingBlockAccept = null
      if (message.reason === 'target-changed' && this.session !== null) {
        this.refreshCurrentStageQuery()
      } else {
        this.deps.showToast?.(t('wikilinkSuggest.toast.blockAcceptFailed'), 'warning')
      }
      this.render()
      return
    }
    const blockId = message.blockId ?? ''
    if (blockId === '') {
      this.cancelPendingBlockAccept('stale-result')
      return
    }
    const guard = this.guardedField()
    if (!guard || guard.session.origin.stage !== 'block') {
      // 字段身份漂移/会话已重建：放弃本地插入，宿主守卫撤回已补写标记
      this.cancelPendingBlockAccept('stale-result')
      return
    }
    const { view, field, head } = guard
    const blockItem: WikilinkBlockPlanItem = { blockId, alias: message.alias ?? '' }
    const plan = planWikilinkFieldEdit(field, pending.key, head, null, null, blockItem)
    if (!plan) {
      this.cancelPendingBlockAccept('stale-result')
      return
    }
    const changes = [...plan.changes]
    let cursorTo = plan.cursorTo
    if (message.sameDoc === true &&
      typeof message.markerLfOffset === 'number' && typeof message.markerText === 'string') {
      // 同文档合笔：标记插入并入同一事务（一次 undo 同时回退标记与链接，
      // V01 场景 2 验证路径；两段编辑不重叠——标记在块尾行行尾，链接在
      // 当前行字段内；CM6 changes 乱序自动排序）。
      // F8：cursorTo 为字段内编辑后的新坐标，标记插入点在字段上方
      // （markerLfOffset < 字段起点）时，字段整体右移——selection 坐标
      // 按新文档语义需平移 markerText.length，否则光标落链接内部（早
      // markerText.length 处）
      changes.push({ from: message.markerLfOffset, to: message.markerLfOffset, insert: message.markerText })
      if (message.markerLfOffset < field.innerFrom) {
        cursorTo += message.markerText.length
      }
    }
    this.pendingBlockAccept = null
    this.dispatchPlan(view, changes, cursorTo)
    this.close()
    this.deps.send({
      kind: 'wikilink.block.linked',
      sessionId: pending.sessionId,
      docUri: pending.docUri,
      reqId: pending.reqId,
    })
  }

  /** 高亮规则（文件/标题共用）：更新帧按身份找位（身份消失时空查询回无
   *  高亮、非空查询取首项）；新查询首帧执行初始规则（空查询无高亮、非空
   *  高亮首项） */
  private applyHighlightRule(sameQueryUpdate: boolean, prevActiveId: string | null): void {
    const result = this.result
    if (result === null || result.status !== 'ready') {
      this.activeIndex = null
      this.activeId = null
      return
    }
    if (sameQueryUpdate && prevActiveId !== null) {
      const at = result.items.findIndex((item) => item.id === prevActiveId)
      this.activeIndex = at >= 0 ? at
        : this.session !== null && this.session.query !== '' && result.items.length > 0 ? 0 : null
    } else {
      this.activeIndex = this.session !== null && this.session.query !== '' && result.items.length > 0 ? 0 : null
    }
    this.activeId = this.activeIndex !== null ? result.items[this.activeIndex]!.id : null
  }

  /**
   * 候选失效信号（#377 T02，wikilink.invalidate）：索引/全文件清单变更后
   * 宿主广播。会话在场时去抖 300ms 重发当前查询（同查询新 reqId，结果按
   * 既有守卫整体替换——旧枚举/旧查询不得复活已删除身份）；无会话零动作。
   * #379 T04 起标题阶段同样重查（覆盖层冲刷含目标正文未保存变化——目标
   * 改动后旧候选淘汰）。块阶段占位（T05 前）与空目标标题占位不出站（占位
   * 无查询语义，出站只会污染 result 状态），零动作。notify 在扫描/核验
   * 期间高频到达，去抖把重查合并为每 300ms 至多一次。
   */
  handleInvalidate(): void {
    if (!this.session || this.deps.isSuspended() || !this.deps.isLiveActive()) {
      return
    }
    const stage = this.session.origin.stage
    // 占位无查询语义（空目标标题/块占位），出站只会污染 result 状态
    if ((stage === 'block' || stage === 'heading') && this.session.target.trim() === '') {
      return
    }
    if (this.invalidateTimer !== undefined) {
      clearTimeout(this.invalidateTimer)
    }
    this.invalidateTimer = setTimeout(() => {
      this.invalidateTimer = undefined
      const session = this.session
      if (!session || this.deps.isSuspended() || !this.deps.isLiveActive()) {
        return
      }
      const curStage = session.origin.stage
      if ((curStage === 'block' || curStage === 'heading') && session.target.trim() === '') {
        return
      }
      this.morePending = false
      if (curStage === 'file') {
        this.sendQuery(session.query, session.generation, 0)
      } else if (curStage === 'heading') {
        this.sendHeadingQuery(session.query, session.target, session.generation)
      } else {
        this.sendBlockQuery(session.query, session.target, session.generation)
      }
    }, 300)
  }

  /** 显式关闭（模式切换/暂停/实例收尾由调用方触发；幂等） */
  close(): void {
    if (!this.session && this.result === null && !this.popup && this.pendingBlockAccept === null) {
      return
    }
    // 在途接受作废：宿主守卫撤回已补写标记（V01 场景 6 收尾语义）
    this.cancelPendingBlockAccept('closed')
    this.session = null
    this.result = null
    this.activeIndex = null
    this.activeId = null
    this.lastReqId = -1
    this.lastReqOffset = 0
    this.morePending = false
    if (this.invalidateTimer !== undefined) {
      clearTimeout(this.invalidateTimer)
      this.invalidateTimer = undefined
    }
    this.detachScrollListeners()
    this.removePopup()
  }

  /** 候选会话是否在场（#381 T06：实例的 Esc 链豁免判定——候选先关一次，
   *  下一次 Esc 才进入引用关闭/选区收起链路） */
  hasActiveSession(): boolean {
    return this.session !== null
  }

  // ---- 事务观测 ----

  private onUpdate(update: ViewUpdate): void {
    if (this.confirming) {
      return
    }
    if (update.docChanged) {
      for (const tr of update.transactions) {
        if (this.deps.isExternal(tr)) {
          // 用户以外的正文变更：候选关闭，不自动重开（规格输入矩阵）
          this.close()
          return
        }
      }
      this.afterUserChange(update)
      return
    }
    if (this.session && update.selectionSet) {
      // 纯光标移动不发起新查询；移出当前阶段的目标字段关闭候选
      const head = update.state.selection.main.head
      if (!this.caretInField(head)) {
        this.close()
      }
    }
  }

  private afterUserChange(update: ViewUpdate): void {
    if (!this.editableNow(update)) {
      this.close()
      return
    }
    const selection = update.state.selection
    if (selection.ranges.length !== 1 || !selection.main.empty) {
      // 多 range／非空选区不接管（既有输入契约，不扩大）
      this.close()
      return
    }
    const head = selection.main.head
    const origin = this.recognizeAt(update.state, head)
    if (!origin) {
      this.close()
      return
    }
    const line = update.state.doc.lineAt(head)
    let query: string
    /** 标题/块阶段的文件目标原文（#379 T04/#380 T05；宿主按来源相对语义解析） */
    let target = ''
    if (origin.stage === 'file') {
      query = line.text.slice(origin.innerFrom - line.from, head - line.from)
    } else if (origin.stage === 'heading') {
      query = line.text.slice(origin.anchorFrom - line.from, head - line.from)
      target = line.text.slice(origin.innerFrom - line.from, origin.fileTo - line.from)
    } else {
      // 块阶段（#380 T05）：^ 后前缀按显示片段与已有 id 搜索
      query = line.text.slice(origin.anchorFrom - line.from, head - line.from)
      target = line.text.slice(origin.innerFrom - line.from, origin.fileTo - line.from)
    }
    const prev = this.session
    if (prev && sameOrigin(prev.origin, origin) && prev.query === query && prev.target === target) {
      return // 同字段同阶段同查询：不重复出站/重建（纯定位等价变更）
    }
    // 会话重建（查询/字段身份变化）：在途的无 ID 块接受作废——宿主守卫
    // 撤回已补写标记（用户已改变意图，旧结果不落正文）
    this.cancelPendingBlockAccept('session-rebuilt')
    const generation = prev ? prev.generation + 1 : 1
    this.session = { origin, query, generation, target }
    this.result = null
    this.activeIndex = null
    this.activeId = null
    if (origin.stage === 'file') {
      this.sendQuery(query, generation, 0)
    } else if (origin.stage === 'heading' && target.trim() !== '') {
      // 文件目标明确才读标题（空目标 # 保持占位——T03 语义不动，不猜默认文档）
      this.sendHeadingQuery(query, target, generation)
    } else if (origin.stage === 'block' && target.trim() !== '') {
      // #380 T05：文件目标明确才读块（空目标 ^ 保持占位，不猜默认文档）
      this.sendBlockQuery(query, target, generation)
    } else {
      this.lastReqId = -1 // 占位阶段不出站（空目标标题/块占位）
    }
    this.render()
  }

  /** 光标处识别（叠加环境守卫：代码上下文/frontmatter 不启用）。
   *  #381 T06 表格格接入：光标所在行为表格行（live 解析树）时以**格内容
   *  窗口**识别——窗口由两侧最近裸管（格边界，代码 span 与转义语义同
   *  splitTableRowCells）截断，窗口内 `\|` 按转义分隔符识别与写回（不
   *  写裸竖线破坏网格）；矩形蒙版态（tableRegionField 在场）保持不识别
   *  （格区选取归表格语义；蒙版随输入清除后正常识别） */
  private recognizeAt(state: EditorState, pos: number): SuggestOrigin | null {
    const view = this.view
    if (!view) {
      return null
    }
    if (inCodeContext(view.state, pos)) {
      return null
    }
    if (view.state.field(tableRegionField, false)) {
      return null // 矩形蒙版态归表格选取语义（T01 守卫保持）
    }
    const line = state.doc.lineAt(pos)
    const row = tableRowOfCaret(state, pos)
    if (row !== null) {
      const win = tableCellWindowOf(line.text, pos - line.from, row.prefixLen ?? 0)
      const field = findWikilinkTargetField(
        line.text.slice(win.from, win.to), pos - line.from - win.from, { pipeEscape: true })
      if (!field) {
        return null
      }
      const shift = line.from + win.from
      return {
        stage: field.stage,
        embed: field.embed,
        openFrom: shift + field.openFrom,
        innerFrom: shift + field.innerFrom,
        fileTo: shift + field.fileTo,
        closeFrom: shift + field.closeFrom,
        hashAt: field.hashAt >= 0 ? shift + field.hashAt : -1,
        anchorFrom: field.anchorFrom >= 0 ? shift + field.anchorFrom : -1,
        anchorTo: field.anchorTo >= 0 ? shift + field.anchorTo : -1,
        pipeAt: field.pipeAt >= 0 ? shift + field.pipeAt : -1,
        pipeWidth: field.pipeWidth,
      }
    }
    const field = findWikilinkTargetField(line.text, pos - line.from)
    if (!field) {
      return null
    }
    return {
      stage: field.stage,
      embed: field.embed,
      openFrom: line.from + field.openFrom,
      innerFrom: line.from + field.innerFrom,
      fileTo: line.from + field.fileTo,
      closeFrom: line.from + field.closeFrom,
      hashAt: field.hashAt >= 0 ? line.from + field.hashAt : -1,
      anchorFrom: field.anchorFrom >= 0 ? line.from + field.anchorFrom : -1,
      anchorTo: field.anchorTo >= 0 ? line.from + field.anchorTo : -1,
      pipeAt: field.pipeAt >= 0 ? line.from + field.pipeAt : -1,
      pipeWidth: field.pipeWidth,
    }
  }

  private caretInField(pos: number): boolean {
    const origin = this.session?.origin
    if (!origin) {
      return false
    }
    // 快速判定：光标仍在当前阶段的目标字段区间内（识别边界已由开启时把关；
    // 字段内纯光标移动不重识别、不重查询——移出即关闭，返回需输入/删除重开）
    if (origin.stage === 'file') {
      return pos >= origin.innerFrom && pos <= origin.fileTo
    }
    return pos >= origin.anchorFrom && pos <= origin.anchorTo
  }

  private editableNow(update: ViewUpdate): boolean {
    // IME 组合期不在此排除：组合文本是用户输入，查询随组合更新（中文文件
    // 名输入期间候选保持可用）；组合期的按键接管由各键命令的
    // compositionStarted 守卫单独拒绝（候选不消费选词确认）
    return this.deps.isLiveActive() && !this.deps.isSuspended() &&
      !update.state.readOnly &&
      update.state.facet(EditorView.editable)
  }

  private sendQuery(query: string, generation: number, offset: number): void {
    const current = this.deps.getSession()
    if (!current) {
      return
    }
    const reqId = ++this.reqSeq
    this.lastReqId = reqId
    this.lastReqOffset = offset
    this.deps.send({
      kind: 'wikilink.query',
      sessionId: current.sessionId,
      docUri: current.docUri,
      reqId,
      generation,
      query,
      ...(offset > 0 ? { offset } : {}),
    })
  }

  /** 标题查询出站（#379 T04）：target 为文件字段原文（宿主解析） */
  private sendHeadingQuery(query: string, target: string, generation: number): void {
    const current = this.deps.getSession()
    if (!current) {
      return
    }
    const reqId = ++this.reqSeq
    this.lastReqId = reqId
    this.lastReqOffset = 0
    this.deps.send({
      kind: 'wikilink.heading.query',
      sessionId: current.sessionId,
      docUri: current.docUri,
      reqId,
      generation,
      query,
      target,
    })
  }

  /** 块查询出站（#380 T05）：target 为文件字段原文（宿主解析）；query 为
   *  ^ 后的块字段前缀（按显示片段与已有 id 搜索） */
  private sendBlockQuery(query: string, target: string, generation: number): void {
    const current = this.deps.getSession()
    if (!current) {
      return
    }
    const reqId = ++this.reqSeq
    this.lastReqId = reqId
    this.lastReqOffset = 0
    this.deps.send({
      kind: 'wikilink.block.query',
      sessionId: current.sessionId,
      docUri: current.docUri,
      reqId,
      generation,
      query,
      target,
    })
  }

  /** 无 ID 块接受出站（#380 T05）：宿主先按目标写入守卫补写 ^id（V01
   *  放行路径——不能先写虚构 ID），成功回包后本地接受链接 */
  private sendBlockAccept(
    key: 'confirm' | '|',
    line: number,
    targetVersion: number,
    target: string,
    generation: number,
  ): boolean {
    const current = this.deps.getSession()
    if (!current) {
      return false
    }
    if (this.pendingBlockAccept !== null) {
      return true // 防重：在途期间重复确认不再出站
    }
    const reqId = ++this.reqSeq
    this.lastReqId = reqId
    this.lastReqOffset = 0
    this.pendingBlockAccept = { reqId, key, sessionId: current.sessionId, docUri: current.docUri }
    this.deps.send({
      kind: 'wikilink.block.accept',
      sessionId: current.sessionId,
      docUri: current.docUri,
      reqId,
      generation,
      target,
      line,
      targetVersion,
    })
    this.render()
    return true
  }

  /** 在途接受放弃（#380 T05）：宿主按撤回守卫尽力移除本次新增标记 */
  private cancelPendingBlockAccept(reason: 'session-rebuilt' | 'closed' | 'stale-result'): void {
    const pending = this.pendingBlockAccept
    if (pending === null) {
      return
    }
    this.pendingBlockAccept = null
    this.deps.send({
      kind: 'wikilink.block.cancel',
      sessionId: pending.sessionId,
      docUri: pending.docUri,
      reqId: pending.reqId,
    })
    void reason
  }

  // ---- 会话键位（候选控件按键；未命中一律落穿） ----

  private moveActive(delta: number): boolean {
    if (!this.session || !this.view || this.view.compositionStarted) {
      return false
    }
    if (this.pendingBlockAccept !== null) {
      return true // 接受在途：方向键不移动高亮（等待宿主补写回包）
    }
    if (this.session.origin.stage === 'heading' && this.session.target.trim() === '') {
      return false // 空目标标题占位：方向键落穿
    }
    if (this.session.origin.stage === 'block' && this.session.target.trim() === '') {
      return false // 空目标块占位：方向键落穿（#380 T05 保持占位口径）
    }
    // F11：浮层可见的加载/真实状态/零命中态——方向键一律消费不落穿：
    // 落穿会移动正文光标移出目标字段，会话随即销毁、在途查询结果被弃；
    // 此时无 items 可移动，不动作（与「接受在途方向键吞掉」口径统一）
    if (!this.result || this.result.status !== 'ready' || this.result.items.length === 0) {
      return true
    }
    const count = this.result.items.length
    const from = this.activeIndex
    // #377 T02 触底续页（仅文件阶段——标题查询无分页）：高亮在末项且总数
    // 未尽时 ↓ 触发下一页加载（同查询同代次；应答追加，高亮保持）。
    // F6：续页仅在最近一页为满页时发起（不满页 = 排名穷尽——尾部病态
    // 候选被宿主滑动跳过后 total 虚高，按 total 续页会空页死循环）
    if (
      this.result.stage === 'file' &&
      delta > 0 && from === count - 1 && !this.morePending &&
      this.result.total > count && this.result.pageFull
    ) {
      this.morePending = true
      this.sendQuery(this.session.query, this.session.generation, count)
      return true
    }
    this.activeIndex = from === null
      ? (delta > 0 ? 0 : count - 1)
      : Math.min(count - 1, Math.max(0, from + delta))
    this.activeId = this.result.items[this.activeIndex]!.id
    this.render()
    return true
  }

  private escape(): boolean {
    if (!this.session || (this.view !== null && this.view.compositionStarted)) {
      return false
    }
    this.close()
    return true
  }

  /** 会话按键前置守卫（#378 T03）：单折叠光标 + 识别复核（字段身份漂移
   *  即放弃并关闭，不误写）——确认与转阶段共用。返回的字段与光标均为
   *  文档绝对坐标（编辑计划按同坐标系计算，可直接组装事务） */
  private guardedField(): {
    view: EditorView
    session: { origin: SuggestOrigin; query: string; generation: number; target: string }
    field: SuggestOrigin
    head: number
  } | null {
    const view = this.view
    const session = this.session
    if (!view || !session || view.compositionStarted) {
      return null
    }
    if (this.deps.isSuspended() || !this.deps.isLiveActive()) {
      return null
    }
    const selection = view.state.selection
    if (selection.ranges.length !== 1 || !selection.main.empty) {
      return null
    }
    const head = selection.main.head
    const field = this.recognizeAt(view.state, head)
    if (!field || field.innerFrom !== session.origin.innerFrom ||
      field.embed !== session.origin.embed || field.stage !== session.origin.stage) {
      this.close()
      return null
    }
    return { view, session, field, head }
  }

  /** Enter/Tab 确认：文件/标题/块阶段有可确认高亮项时接管（占位/无高亮落穿）；
   *  文件确认替换整个文件字段（保留已有锚点/显示文字），无分隔符时在目标区
   *  末补默认别名；标题确认（#379 T04）替换整个锚点字段；块确认（#380
   *  T05）替换 ^ 后锚点字段——已有 ID 本地直确认，无 ID 经宿主补写 ^id
   *  后回包再确认；光标落目标区末端；一笔事务=一笔宿主撤销记录，确认后
   *  关闭会话 */
  private confirm(): boolean {
    const guard = this.guardedField()
    if (!guard) {
      return false
    }
    const { view, session, field, head } = guard
    if (field.stage === 'block') {
      // #380 T05 块确认：有 ID 块本地直确认（零宿主往返）；无 ID 块出站
      // accept——宿主先按目标写入守卫补写 ^id（不能先写虚构 ID），回包后
      // 按原键语义组计划
      return this.confirmBlock(view, session, field, head, 'confirm')
    }
    if (field.stage === 'heading') {
      // #379 T04 标题确认：有真实高亮项时接管（占位/无高亮落穿）——替换
      // 整个锚点字段，无手写别名补文件名默认别名；选中规范化同名项以
      // toast 提示定位风险并**继续接受**（不改跳转语义、不合并候选）
      const headingItem = this.headingActiveItem()
      if (!headingItem) {
        return false
      }
      const plan = planWikilinkFieldEdit(field, 'confirm', head, null, {
        heading: headingItem.heading, alias: headingItem.alias,
      })
      if (!plan) {
        return false
      }
      if (headingItem.duplicate) {
        this.deps.showToast?.(t('wikilinkSuggest.toast.duplicateHeading'), 'warning')
      }
      this.dispatchPlan(view, plan.changes, plan.cursorTo)
      this.close()
      return true
    }
    if (field.stage !== 'file') {
      return false // 防御：非文件/标题/块阶段的形态不接管
    }
    const item = this.result?.stage === 'file' && this.result.status === 'ready' && this.activeIndex !== null
      ? this.result.items[this.activeIndex]
      : undefined
    const plan = planWikilinkFieldEdit(field, 'confirm', head, item ?? null)
    if (!plan) {
      return false
    }
    this.dispatchPlan(view, plan.changes, plan.cursorTo)
    this.close()
    return true
  }

  /** 标题阶段当前键盘高亮的候选（无会话/无结果/无高亮返回 null） */
  private headingActiveItem(): WikilinkHeadingItem | null {
    if (this.result === null || this.result.stage !== 'heading' || this.result.status !== 'ready') {
      return null
    }
    return this.activeIndex !== null ? this.result.items[this.activeIndex] ?? null : null
  }

  /** 块阶段当前键盘高亮的候选（#380 T05；无会话/无结果/无高亮返回 null） */
  private blockActiveItem(): WikilinkBlockItem | null {
    if (this.result === null || this.result.stage !== 'block' || this.result.status !== 'ready') {
      return null
    }
    return this.activeIndex !== null ? this.result.items[this.activeIndex] ?? null : null
  }

  /** 块候选确认执行（#380 T05，Enter/Tab 与 | 共用）：已有 ID 本地一笔
   *  确认；无 ID 出站 accept（宿主补写 ^id 后回包再按原键组计划——
   *  handleBlockAcceptResult）。无高亮/占位返回 false 落穿 */
  private confirmBlock(
    view: EditorView,
    session: { origin: SuggestOrigin; query: string; generation: number; target: string },
    field: SuggestOrigin,
    head: number,
    key: 'confirm' | '|',
  ): boolean {
    const item = this.blockActiveItem()
    if (!item) {
      return false // 占位/无高亮不是候选：Enter/Tab 继续按无可确认项处理（落穿）
    }
    if (item.blockId !== '') {
      if (this.pendingBlockAccept !== null) {
        return true
      }
      const plan = planWikilinkFieldEdit(field, key, head, null, null, {
        blockId: item.blockId, alias: item.alias,
      })
      if (!plan) {
        return false
      }
      this.dispatchPlan(view, plan.changes, plan.cursorTo)
      this.close()
      return true
    }
    // F3：本地存在**尚未出站**的编辑（IME 组合/暂缓集——宿主收不到、
    // whenEditsSettled 也不等）时不立即出站：sameDoc 回包的宿主系
    // markerLfOffset 基于权威文本，此窗口内接受会让插入点在本地系错位
    // 破坏正文。消费本次按键、推进 flush 出站并重发当前查询（宿主
    // whenEditsSettled 等编辑落地后装载最新文本，targetVersion 随之刷新）；
    // 落定后重按确认即正常接受。已出站在途请求不推迟（宿主会等其应用）
    if (this.deps.hasUnsentLocalEdits?.() === true) {
      this.deps.scheduleFlush?.()
      this.refreshCurrentStageQuery()
      return true
    }
    // 无 ID 块：宿主先补写（V01 放行路径），在途浮层显示补写状态
    const result = this.result
    const targetVersion = result !== null && result.stage === 'block' ? result.targetVersion : 0
    return this.sendBlockAccept(key, item.line, targetVersion, session.target, session.generation)
  }

  /** 按当前会话阶段重发查询（同查询新 reqId，结果按守卫整体替换——含
   *  targetVersion 刷新；F4 接受失败 target-changed 与 F3 暂缓编辑推进
   *  出站后的刷新共用） */
  private refreshCurrentStageQuery(): void {
    const session = this.session
    if (!session) {
      return
    }
    this.morePending = false
    if (session.origin.stage === 'file') {
      this.sendQuery(session.query, session.generation, 0)
    } else if (session.origin.stage === 'heading' && session.target.trim() !== '') {
      this.sendHeadingQuery(session.query, session.target, session.generation)
    } else if (session.origin.stage === 'block' && session.target.trim() !== '') {
      this.sendBlockQuery(session.query, session.target, session.generation)
    }
  }

  /** #／^／| 转阶段（#378 T03；#379 T04 起 | 接受标题阶段真实高亮）：
   *  未命中阶段或无会话 return false 落穿普通输入；编辑计划一笔事务，
   *  产物阶段重建会话（转标题时按目标明确性出站查询）或关闭 */
  private phase(key: WikilinkPhaseKey): boolean {
    const guard = this.guardedField()
    if (!guard) {
      return false
    }
    const { view, session, field, head } = guard
    if (key === '#' && field.stage !== 'file') {
      return false
    }
    if (key === '^' && field.stage === 'block') {
      return false
    }
    const item: WikilinkPlanItem | null = field.stage === 'file' &&
      this.result?.stage === 'file' && this.result.status === 'ready' && this.activeIndex !== null
      ? this.result.items[this.activeIndex] ?? null
      : null
    // #379 T04：| 在标题阶段接受真实高亮（替换锚点字段）
    const headingItem: WikilinkHeadingPlanItem | null = key === '|' && field.stage === 'heading'
      ? this.headingActiveItem()
      : null
    // #380 T05：| 在块阶段有真实高亮走确认路径（confirmBlock 内分已有 ID
    // 本地确认/无 ID 宿主补写两路）；无高亮保持 T03 语义——保留锚点、
    // 插 | 进显示文字（关闭候选）
    if (key === '|' && field.stage === 'block') {
      if (this.blockActiveItem() !== null) {
        return this.confirmBlock(view, session, field, head, '|')
      }
      const fallback = planWikilinkFieldEdit(field, '|', head, null, null, null)
      if (!fallback) {
        return false
      }
      this.dispatchPlan(view, fallback.changes, fallback.cursorTo)
      this.close()
      return true
    }
    const plan = planWikilinkFieldEdit(field, key, head, item, headingItem)
    if (!plan) {
      return false
    }
    this.dispatchPlan(view, plan.changes, plan.cursorTo)
    if (plan.nextStage === null) {
      // | ：进显示文字——显示文字区不触发候选，关闭会话
      this.close()
      return true
    }
    // 转阶段：在编辑后状态按新光标重识别，重建会话——标题/块阶段且文件
    // 目标明确时出站对应查询（#379 T04/#380 T05；空目标保持占位不出站）
    const next = this.recognizeAt(view.state, plan.cursorTo)
    if (!next || next.stage === 'file') {
      this.close()
      return true
    }
    const nextLine = view.state.doc.lineAt(plan.cursorTo)
    const nextTarget = nextLine.text.slice(next.innerFrom - nextLine.from, next.fileTo - nextLine.from)
    this.session = { origin: next, query: '', generation: session.generation + 1, target: nextTarget }
    this.result = null
    this.activeIndex = null
    this.activeId = null
    if (next.stage === 'heading' && nextTarget.trim() !== '') {
      this.sendHeadingQuery('', nextTarget, session.generation + 1)
    } else if (next.stage === 'block' && nextTarget.trim() !== '') {
      this.sendBlockQuery('', nextTarget, session.generation + 1)
    } else {
      this.lastReqId = -1 // 空目标标题/块占位不出站
    }
    this.render()
    return true
  }

  /** 一笔事务应用编辑计划（confirming 抑制会话内编辑重开） */
  private dispatchPlan(
    view: EditorView,
    changes: ReadonlyArray<{ from: number; to: number; insert: string }>,
    cursorTo: number,
  ): void {
    this.confirming = true
    try {
      view.dispatch({
        changes: changes.map((change) => ({ ...change })),
        selection: EditorSelection.cursor(cursorTo),
        scrollIntoView: true,
      })
    } finally {
      this.confirming = false
    }
  }

  // ---- 候选浮层（document 级单例；不夺正文焦点） ----

  private ensurePopup(): HTMLDivElement {
    if (!this.popup) {
      const el = document.createElement('div')
      el.className = WIKILINK_SUGGEST_CLASS_NAMES.popup
      el.setAttribute('role', 'listbox')
      el.setAttribute('aria-label', t('wikilinkSuggest.list.ariaLabel'))
      el.addEventListener('pointerdown', (event) => {
        // 按下即拦默认：候选选择不夺正文焦点、不折叠 CM6 选区
        event.preventDefault()
        const row = (event.target as HTMLElement | null)?.closest(`.${WIKILINK_SUGGEST_CLASS_NAMES.item}`)
        if (!row) {
          return
        }
        const rows = [...(this.popup?.querySelectorAll(`.${WIKILINK_SUGGEST_CLASS_NAMES.item}`) ?? [])]
        const index = rows.indexOf(row)
        if (index >= 0) {
          this.activeIndex = index
          this.confirm()
        }
      })
      document.body.appendChild(el)
      this.popup = el
    }
    return this.popup
  }

  private removePopup(): void {
    this.popup?.remove()
    this.popup = null
  }

  private detachScrollListeners(): void {
    for (const off of this.scrollListeners.splice(0)) {
      off()
    }
  }

  private attachScrollListeners(): void {
    if (this.scrollListeners.length > 0 || !this.view) {
      return
    }
    const reposition = () => this.placePopup()
    this.view.scrollDOM.addEventListener('scroll', reposition)
    window.addEventListener('resize', reposition)
    this.scrollListeners.push(
      () => this.view?.scrollDOM.removeEventListener('scroll', reposition),
      () => window.removeEventListener('resize', reposition),
    )
  }

  private render(): void {
    if (!this.session || !this.view) {
      this.removePopup()
      return
    }
    const popup = this.ensurePopup()
    popup.replaceChildren()
    // 条目主体收进列表滚动区（与底部键提示条分离，验收反馈 2026-10-06）；
    // 浮层 max-height 留在容器（契约 example 的覆盖形态不变），list 在
    // flex 约束下自行滚动
    const list = document.createElement('div')
    list.className = WIKILINK_SUGGEST_CLASS_NAMES.list
    popup.appendChild(list)
    const result = this.result
    const stage = this.session.origin.stage
    const targetEmpty = this.session.target.trim() === ''
    if (stage === 'heading' && targetEmpty) {
      // 空目标标题占位（T03 语义保持：不猜默认文档，仅提示；占位不可确认）
      list.appendChild(this.buildStatusRow(t('wikilinkSuggest.placeholder.heading')))
    } else if (stage === 'block' && targetEmpty) {
      // 空目标块占位（T03 语义保持：不猜默认文档；占位不可确认）
      list.appendChild(this.buildStatusRow(t('wikilinkSuggest.placeholder.block')))
    } else if (stage === 'block' && this.pendingBlockAccept !== null) {
      // 无 ID 块接受在途（#380 T05）：宿主补写 ^id 中——占位状态行不可确认
      list.appendChild(this.buildStatusRow(t('wikilinkSuggest.status.blockAccepting')))
    } else if (stage === 'block' && result !== null && result.stage === 'block') {
      // 块阶段（#380 T05）：失败真实状态或候选列表（无 ID 块照常列出）
      if (result.status === 'noWorkspace') {
        list.appendChild(this.buildStatusRow(t('wikilinkSuggest.status.noWorkspace')))
      } else if (result.status === 'notFound') {
        list.appendChild(this.buildStatusRow(t('wikilinkSuggest.status.blockNotFound')))
      } else if (result.status === 'notMd') {
        list.appendChild(this.buildStatusRow(t('wikilinkSuggest.status.blockNotMd')))
      } else if (result.status === 'readError') {
        list.appendChild(this.buildStatusRow(t('wikilinkSuggest.status.blockReadError')))
      } else {
        for (let i = 0; i < result.items.length; i++) {
          list.appendChild(this.buildBlockRow(result.items[i]!, i === this.activeIndex))
        }
        if (result.items.length === 0) {
          list.appendChild(this.buildStatusRow(t('wikilinkSuggest.status.blockEmpty')))
        }
      }
    } else if (stage === 'heading' && result !== null && result.stage === 'heading') {
      // 标题阶段（#379 T04）：失败真实状态或候选列表（重复标题独立身份
      // 全部展示，层级/行号随行显示）；result 未到（null）显示加载
      if (result.status === 'noWorkspace') {
        list.appendChild(this.buildStatusRow(t('wikilinkSuggest.status.noWorkspace')))
      } else if (result.status === 'notFound') {
        list.appendChild(this.buildStatusRow(t('wikilinkSuggest.status.headingNotFound')))
      } else if (result.status === 'notMd') {
        list.appendChild(this.buildStatusRow(t('wikilinkSuggest.status.headingNotMd')))
      } else if (result.status === 'readError') {
        list.appendChild(this.buildStatusRow(t('wikilinkSuggest.status.headingReadError')))
      } else {
        for (let i = 0; i < result.items.length; i++) {
          list.appendChild(this.buildHeadingRow(result.items[i]!, i === this.activeIndex))
        }
        if (result.items.length === 0) {
          list.appendChild(this.buildStatusRow(t('wikilinkSuggest.status.headingEmpty')))
        }
      }
    } else if (stage === 'heading' || stage === 'block' || result === null) {
      // 标题/块阶段的查询在途（结果未到）
      list.appendChild(this.buildStatusRow(stage === 'heading'
        ? t('wikilinkSuggest.status.headingLoading')
        : stage === 'block'
          ? t('wikilinkSuggest.status.blockLoading')
          : t('wikilinkSuggest.status.loading')))
    } else if (result.stage !== 'file') {
      // 防御：文件会话的 result 恒为 file 变体（阶段与结果同生不变式）；
      // 形态不符零渲染（不把未知变体当文件候选）
    } else if (result.status === 'noWorkspace') {
      list.appendChild(this.buildStatusRow(t('wikilinkSuggest.status.noWorkspace')))
    } else if (result.status === 'notReady') {
      list.appendChild(this.buildStatusRow(t('wikilinkSuggest.status.notReady')))
    } else {
      for (let i = 0; i < result.items.length; i++) {
        list.appendChild(this.buildItemRow(result.items[i]!, i === this.activeIndex))
      }
      // F6：remaining 提示以满页终态为口径——不满页即穷尽，不为病态占位
      // 的 total 虚高显示「还有 N 项」
      const remaining = result.pageFull ? result.total - result.items.length : 0
      if (result.items.length === 0 && !result.updating) {
        list.appendChild(this.buildStatusRow(t('wikilinkSuggest.status.empty')))
      }
      if (remaining > 0) {
        // 分页续载提示（#377 T02）：总数未尽时提示按 ↓ 继续（触底加载）
        list.appendChild(this.buildStatusRow(t('wikilinkSuggest.status.more', { count: remaining })))
      }
      if (result.updating) {
        // 部分数据在场：可用项继续候选 + 明确标注仍在构建（不冒充完整）
        list.appendChild(this.buildStatusRow(t('wikilinkSuggest.status.updating')))
      }
    }
    this.attachScrollListeners()
    // 底部键提示条（验收反馈 2026-10-06）：与条目主体分离的固定底栏，
    // 顶部 1px 分割线由契约样式提供；按阶段裁剪当前仍可用的进阶键
    popup.appendChild(this.buildHintsRow(stage))
    this.placePopup()
    this.scrollActiveIntoView()
  }

  /** 底部键提示条：file 阶段三段全显；heading 阶段 # 已消费只余 ^ 与 |；
   *  block 阶段只余 |（| 三阶段通用） */
  private buildHintsRow(stage: 'file' | 'heading' | 'block'): HTMLDivElement {
    const row = document.createElement('div')
    row.className = WIKILINK_SUGGEST_CLASS_NAMES.hints
    const parts = stage === 'file'
      ? [
          t('wikilinkSuggest.hint.heading'),
          t('wikilinkSuggest.hint.block'),
          t('wikilinkSuggest.hint.alias'),
        ]
      : stage === 'heading'
        ? [t('wikilinkSuggest.hint.block'), t('wikilinkSuggest.hint.alias')]
        : [t('wikilinkSuggest.hint.alias')]
    for (const part of parts) {
      const seg = document.createElement('span')
      seg.textContent = part
      row.appendChild(seg)
    }
    return row
  }

  private buildStatusRow(text: string): HTMLDivElement {
    const row = document.createElement('div')
    row.className = WIKILINK_SUGGEST_CLASS_NAMES.status
    row.textContent = text
    return row
  }

  /** 标题候选行（#379 T04）：主文字 = 标题原文；右侧弱化段 = 层级/行号
   *  元信息（复用 dir 槽位类——契约描述按「文件阶段=目录、标题阶段=层级
   *  行号」更新，样式规则零新增）。重复标题不合并，各候选独立行 */
  private buildHeadingRow(item: WikilinkHeadingItem, active: boolean): HTMLDivElement {
    const row = document.createElement('div')
    row.className = active
      ? `${WIKILINK_SUGGEST_CLASS_NAMES.item} ${WIKILINK_SUGGEST_CLASS_NAMES.itemActive}`
      : WIKILINK_SUGGEST_CLASS_NAMES.item
    row.setAttribute('role', 'option')
    row.setAttribute('aria-selected', active ? 'true' : 'false')
    const name = document.createElement('span')
    name.className = WIKILINK_SUGGEST_CLASS_NAMES.name
    name.textContent = item.heading
    row.appendChild(name)
    const meta = document.createElement('span')
    meta.className = WIKILINK_SUGGEST_CLASS_NAMES.dir
    meta.textContent = t('wikilinkSuggest.heading.meta', { level: item.level, line: item.line })
    row.appendChild(meta)
    return row
  }

  /** 块候选行（#380 T05）：主文字 = 块首行文本片段；右侧弱化段 = 块首行
   *  行号与行数元信息（复用 dir 槽位类，样式规则零新增——契约描述按
   *  「文件=目录、标题=层级行号、块=行号/行数」扩展） */
  private buildBlockRow(item: WikilinkBlockItem, active: boolean): HTMLDivElement {
    const row = document.createElement('div')
    row.className = active
      ? `${WIKILINK_SUGGEST_CLASS_NAMES.item} ${WIKILINK_SUGGEST_CLASS_NAMES.itemActive}`
      : WIKILINK_SUGGEST_CLASS_NAMES.item
    row.setAttribute('role', 'option')
    row.setAttribute('aria-selected', active ? 'true' : 'false')
    const name = document.createElement('span')
    name.className = WIKILINK_SUGGEST_CLASS_NAMES.name
    name.textContent = item.blockId !== '' ? `${item.snippet} ^${item.blockId}` : item.snippet
    row.appendChild(name)
    const meta = document.createElement('span')
    meta.className = WIKILINK_SUGGEST_CLASS_NAMES.dir
    meta.textContent = t('wikilinkSuggest.block.meta', { line: item.line, count: item.lineCount })
    row.appendChild(meta)
    return row
  }

  private buildItemRow(item: WikilinkCandidateItem, active: boolean): HTMLDivElement {
    const row = document.createElement('div')
    row.className = active
      ? `${WIKILINK_SUGGEST_CLASS_NAMES.item} ${WIKILINK_SUGGEST_CLASS_NAMES.itemActive}`
      : WIKILINK_SUGGEST_CLASS_NAMES.item
    row.setAttribute('role', 'option')
    row.setAttribute('aria-selected', active ? 'true' : 'false')
    const name = document.createElement('span')
    name.className = WIKILINK_SUGGEST_CLASS_NAMES.name
    this.appendWithHighlights(name, item.name, item.labelHighlights)
    row.appendChild(name)
    if (item.dir !== '') {
      const dir = document.createElement('span')
      dir.className = WIKILINK_SUGGEST_CLASS_NAMES.dir
      this.appendWithHighlights(dir, item.dir, item.dirHighlights)
      row.appendChild(dir)
    }
    return row
  }

  /** 高亮区间渲染（UTF-16 偏移；无区间时整段 textContent） */
  private appendWithHighlights(target: HTMLElement, text: string, highlights: ReadonlyArray<{ start: number; end: number }>): void {
    let at = 0
    for (const range of highlights) {
      const start = Math.min(range.start, text.length)
      const end = Math.min(range.end, text.length)
      if (start < at) {
        continue
      }
      if (start > at) {
        target.appendChild(document.createTextNode(text.slice(at, start)))
      }
      if (end > start) {
        const mark = document.createElement('span')
        mark.className = WIKILINK_SUGGEST_CLASS_NAMES.highlight
        mark.textContent = text.slice(start, end)
        target.appendChild(mark)
      }
      at = Math.max(at, end)
    }
    if (at < text.length) {
      target.appendChild(document.createTextNode(text.slice(at)))
    }
  }

  private placePopup(): void {
    const popup = this.popup
    const view = this.view
    const origin = this.session?.origin
    if (!popup || !view || !origin) {
      return
    }
    // 锚定当前阶段字段起点（文件字段 / 锚点字段）
    const anchorPos = origin.stage === 'file' ? origin.innerFrom : origin.anchorFrom
    let coords: { left: number; top: number; bottom: number } | null = null
    try {
      coords = view.coordsAtPos(anchorPos) as { left: number; top: number; bottom: number } | null
    } catch {
      coords = null // 字段越出视口（滚动中）：隐藏，滚动停止后经 scroll 事件复位
    }
    if (!coords || coords.top < 0 || coords.top > window.innerHeight) {
      popup.style.display = 'none'
      return
    }
    popup.style.visibility = 'hidden'
    popup.style.display = 'flex'
    const height = popup.offsetHeight
    const width = popup.offsetWidth
    let top = coords.bottom + 4
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, coords.top - height - 4)
    }
    // 水平锚点 = 光标（用户输入处）且浮层居中对齐（验收反馈 2026-10-06，
    // 原左对齐字段起点）；光标坐标不可得（组合/滚动边缘）回退字段起点。
    // 垂直仍以字段行坐标为准（光标与字段同行）
    let anchorLeft = coords.left
    try {
      const caret = view.coordsAtPos(view.state.selection.main.head)
      if (caret) {
        anchorLeft = caret.left
      }
    } catch {
      // 光标越视口：回退字段起点
    }
    const left = Math.min(Math.max(8, anchorLeft - width / 2), Math.max(8, window.innerWidth - width - 8))
    popup.style.left = `${Math.round(left)}px`
    popup.style.top = `${Math.round(top)}px`
    popup.style.visibility = 'visible'
  }

  private scrollActiveIntoView(): void {
    if (this.activeIndex === null || !this.popup) {
      return
    }
    const rows = this.popup.querySelectorAll(`.${WIKILINK_SUGGEST_CLASS_NAMES.item}`)
    rows[this.activeIndex]?.scrollIntoView({ block: 'nearest' })
  }
}

/** 会话工厂（实例装配入口）：返回控制器与 CM6 扩展组的持有者 */
export function createWikilinkSuggest(deps: WikilinkSuggestDeps): WikilinkSuggestController {
  return new WikilinkSuggestController(deps)
}

/** 光标所在行的表格行身份（#381 T06）：live 解析树中包含光标行的表格行
 *  信息（含 #296 容器前缀宽）；非表格行（或解析树缺席）返回 null */
function tableRowOfCaret(state: EditorState, pos: number): TableRowInfo | null {
  const live = state.field(liveDecorationsField, false)
  if (!live) {
    return null
  }
  const rows = tableRowsAt(state, pos, live.tree)
  if (!rows) {
    return null
  }
  const lineFrom = state.doc.lineAt(pos).from
  return rows.find((row) => row.lineFrom === lineFrom) ?? null
}

/** 格内容窗口（#381 T06）：光标两侧最近的裸管（格边界）截断的行内区间
 *  ——窗口内无裸管（识别不跨格）；前缀区（引用层/缩进/列表标记，#296）
 *  排除在窗口外。裸管判定与 splitTableRowCells 同语义（代码 span 内与
 *  已转义 `\|` 的竖线不是格边界） */
export function tableCellWindowOf(lineText: string, col: number, prefixLen: number): { from: number; to: number } {
  const inSpan = scanCodeSpans(lineText)
  let from = prefixLen
  let to = lineText.length
  for (let i = prefixLen; i < lineText.length; i++) {
    if (lineText[i] === '|' && !inSpan[i] && !isEscapedAt(lineText, i)) {
      if (i < col) {
        from = i + 1
      } else {
        to = i
        break
      }
    }
  }
  return { from, to }
}
