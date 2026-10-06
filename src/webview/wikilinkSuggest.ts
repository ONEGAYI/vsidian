// 双链文件联想会话（工单 #376 T01 + #378 T03）：新建闭合双链 `[[]]` /
// `![[]]`、既有双链目标区重编辑、#／^／| 转阶段与输入仲裁——识别、查询、
// 候选 UI、键盘与确认插入。
//
// 职责与边界（规格 docs/specs/wikilink-completion.md「技术设计与实施边界」）：
// - 识别是**新增局部逻辑**（shared/wikilinkField），只服务联想触发；完整
//   渲染解析器（shared/wikilink.ts）语义不动。代码上下文/前端头区/表格
//   格区不启用候选（inCodeContext + tableRegionField 环境守卫）。
// - 会话只认单个折叠光标的可编辑 Live 正文：多 range／非空选区、IME 组合
//   期、暂停、源码模式与 Reading 不接管。纯光标移动不发起新查询；移出
//   目标字段（按阶段：文件字段或锚点字段）、切模式、暂停、外部同步与
//   实例释放关闭候选。
// - 再次触发只认目标区（| 之前）的用户输入／删除；显示文字编辑、纯光标
//   移动与用户以外的正文变更不重开（规格「触发、关闭与再次触发」）。
// - 查询经内部消息协议（wikilink.query / wikilink.query.result）：reqId
//   请求配对 + generation 查询代次双守卫，迟到响应一律拒收；宿主不可用
//   时显示真实状态、允许手写、不伪装空结果。同一查询的更新帧按候选
//   身份保留手动高亮；身份消失时空查询回无高亮、非空查询取首项。
// - 转阶段（#378 T03）：#／^ 接受文件阶段高亮并切标题/块**占位**阶段
//   （标题/块真实候选归 T04/T05，本票不读目标文档）；块标记形成现有
//   `#^` 语法且已有 # 不重复补；| 接受当前阶段真实高亮（T03 仅文件
//   阶段有），进显示文字并关闭候选，无高亮保留原输入。占位只作提示
//   （i18n status 行），不可确认、不写正文，Enter/Tab 落穿。
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
  type WikilinkPhaseKey,
  type WikilinkPlanItem,
  type WikilinkTargetStage,
} from '../shared/wikilinkField'
import type { HostToWebview, WebviewToHost, WikilinkCandidateItem } from '../shared/protocol'
import { t } from '../shared/i18n'
import { inCodeContext } from './symbolAutocomplete'
import { tableRegionField } from './tableRegionSelection'
import './wikilinkSuggest.css'

/** 浮层类名（公开样式契约 chrome 域 wikilink-suggest 类目；单一事实源
 *  src/shared/styleContract.ts） */
export const WIKILINK_SUGGEST_CLASS_NAMES = {
  popup: 'vsidian-wikilink-suggest',
  item: 'vsidian-wikilink-suggest-item',
  itemActive: 'vsidian-wikilink-suggest-item-active',
  status: 'vsidian-wikilink-suggest-status',
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
}

/** 最近一次接受的查询结果（真实状态面；仅文件阶段使用） */
interface SuggestResult {
  status: 'ready' | 'noWorkspace' | 'notReady'
  updating: boolean
  items: WikilinkCandidateItem[]
  total: number
}

/** 字段身份全量比较（去重守卫用）：任何边界变化（如光标右侧闭围栏被删）
 *  都产生新 origin——陈旧边界会让「移出字段关闭」误判在界内 */
function sameOrigin(a: SuggestOrigin, b: SuggestOrigin): boolean {
  return a.stage === b.stage && a.embed === b.embed && a.innerFrom === b.innerFrom &&
    a.fileTo === b.fileTo && a.closeFrom === b.closeFrom && a.hashAt === b.hashAt &&
    a.anchorFrom === b.anchorFrom && a.anchorTo === b.anchorTo && a.pipeAt === b.pipeAt
}

export class WikilinkSuggestController {
  private view: EditorView | null = null
  private session: { origin: SuggestOrigin; query: string; generation: number } | null = null
  /** 出站请求序号（实例内单调；应答配对键） */
  private reqSeq = 0
  private lastReqId = -1
  private result: SuggestResult | null = null
  /** 键盘高亮行（null = 无高亮；空查询初始即 null） */
  private activeIndex: number | null = null
  /** 键盘高亮的候选身份（id；更新帧按身份保留手动高亮，#378 T03） */
  private activeId: string | null = null
  /** 确认/转阶段 dispatch 期间抑制识别（会话内编辑不得重开会话） */
  private confirming = false
  private popup: HTMLDivElement | null = null
  private readonly deps: WikilinkSuggestDeps
  private readonly scrollListeners: Array<() => void> = []

  constructor(deps: WikilinkSuggestDeps) {
    this.deps = deps
  }

  /** CM6 扩展组：会话键位 + 更新监听。装配次序由实例决定（fenceEscape 之前） */
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
    ]
  }

  /** 绑定视图（实例创建后调用；滚动/缩放重定位监听随会话开关挂摘） */
  attach(view: EditorView): void {
    this.view = view
  }

  /** 实例释放（视图销毁随调用方；浮层 DOM 移除归本模块） */
  destroy(): void {
    this.detachScrollListeners()
    this.removePopup()
    this.view = null
    this.session = null
    this.result = null
  }

  /** 查询结果入站（根路由）：reqId + generation + 会话三重守卫，任一
   *  不符即迟到响应，拒收不改状态 */
  handleResult(message: Extract<HostToWebview, { kind: 'wikilink.query.result' }>): void {
    if (!this.session || this.lastReqId < 0 || message.reqId !== this.lastReqId) {
      return
    }
    if (this.session.generation !== message.generation) {
      return
    }
    const current = this.deps.getSession()
    if (!current || current.sessionId !== message.sessionId || current.docUri !== message.docUri) {
      return
    }
    if (this.deps.isSuspended() || !this.deps.isLiveActive()) {
      return
    }
    // 同一查询的更新帧（此前已有该代次结果）：手动高亮按候选身份保留
    const sameQueryUpdate = this.result !== null
    const prevActiveId = this.activeId
    if (message.status === 'unavailable') {
      this.result = {
        status: message.reason === 'not-ready' ? 'notReady' : 'noWorkspace',
        updating: false, items: [], total: 0,
      }
    } else {
      this.result = {
        status: 'ready',
        updating: message.updating === true,
        items: message.items ?? [],
        total: message.total ?? 0,
      }
    }
    // 高亮规则：更新帧按身份找位（身份消失时空查询回无高亮、非空查询取
    // 首项）；新查询首帧执行初始规则（空查询无高亮、非空高亮首项）
    if (sameQueryUpdate && prevActiveId !== null) {
      const at = this.result.items.findIndex((item) => item.id === prevActiveId)
      this.activeIndex = at >= 0 ? at
        : this.session.query !== '' && this.result.items.length > 0 ? 0 : null
    } else {
      this.activeIndex = this.session.query !== '' && this.result.items.length > 0 ? 0 : null
    }
    this.activeId = this.activeIndex !== null ? this.result.items[this.activeIndex]!.id : null
    this.render()
  }

  /** 显式关闭（模式切换/暂停/实例收尾由调用方触发；幂等） */
  close(): void {
    if (!this.session && this.result === null && !this.popup) {
      return
    }
    this.session = null
    this.result = null
    this.activeIndex = null
    this.activeId = null
    this.lastReqId = -1
    this.detachScrollListeners()
    this.removePopup()
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
    const query = origin.stage === 'file'
      ? line.text.slice(origin.innerFrom - line.from, head - line.from)
      : ''
    const prev = this.session
    if (prev && sameOrigin(prev.origin, origin) && prev.query === query) {
      return // 同字段同阶段同查询：不重复出站/重建（纯定位等价变更）
    }
    const generation = prev ? prev.generation + 1 : 1
    this.session = { origin, query, generation }
    this.result = null
    this.activeIndex = null
    this.activeId = null
    if (origin.stage === 'file') {
      this.sendQuery(query, generation)
    } else {
      this.lastReqId = -1 // 标题/块占位阶段不出站（真实候选归 T04/T05）
    }
    this.render()
  }

  /** 光标处识别（叠加环境守卫：代码上下文/frontmatter 与表格格区不启用） */
  private recognizeAt(state: EditorState, pos: number): SuggestOrigin | null {
    const view = this.view
    if (!view) {
      return null
    }
    if (inCodeContext(view.state, pos)) {
      return null
    }
    if (view.state.field(tableRegionField, false)) {
      return null // 表格格区归表格编辑语义（T01 主正文）
    }
    const line = state.doc.lineAt(pos)
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

  private sendQuery(query: string, generation: number): void {
    const current = this.deps.getSession()
    if (!current) {
      return
    }
    const reqId = ++this.reqSeq
    this.lastReqId = reqId
    this.deps.send({
      kind: 'wikilink.query',
      sessionId: current.sessionId,
      docUri: current.docUri,
      reqId,
      generation,
      query,
    })
  }

  // ---- 会话键位（候选控件按键；未命中一律落穿） ----

  private moveActive(delta: number): boolean {
    if (!this.session || !this.view || this.view.compositionStarted) {
      return false
    }
    if (this.session.origin.stage !== 'file') {
      return false // 占位阶段无候选可高亮：方向键落穿移动光标
    }
    if (!this.result || this.result.status !== 'ready' || this.result.items.length === 0) {
      return false
    }
    const count = this.result.items.length
    const from = this.activeIndex
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
    session: { origin: SuggestOrigin; query: string; generation: number }
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

  /** Enter/Tab 确认：仅文件阶段有可确认高亮项时接管（占位/无高亮落穿）；
   *  确认替换整个文件字段（保留已有锚点/显示文字），无分隔符时在目标区
   *  末补默认别名；光标落目标区末端；一笔事务=一笔宿主撤销记录，确认后
   *  关闭会话 */
  private confirm(): boolean {
    const guard = this.guardedField()
    if (!guard) {
      return false
    }
    const { view, field, head } = guard
    if (field.stage !== 'file') {
      return false // 占位不是候选：Enter/Tab 继续按无可确认项处理（落穿）
    }
    const item = this.result?.status === 'ready' && this.activeIndex !== null
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

  /** #／^／| 转阶段（#378 T03）：接受文件阶段高亮（| 接受当前阶段真实
   *  高亮——T03 标题/块为占位无高亮），未命中阶段或无会话 return false
   *  落穿普通输入；编辑计划一笔事务，产物阶段重建会话（占位）或关闭 */
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
      this.result?.status === 'ready' && this.activeIndex !== null
      ? this.result.items[this.activeIndex] ?? null
      : null
    const plan = planWikilinkFieldEdit(field, key, head, item)
    if (!plan) {
      return false
    }
    this.dispatchPlan(view, plan.changes, plan.cursorTo)
    if (plan.nextStage === null) {
      // | ：进显示文字——显示文字区不触发候选，关闭会话
      this.close()
      return true
    }
    // 转阶段：在编辑后状态按新光标重识别，重建会话（占位阶段不出站）
    const next = this.recognizeAt(view.state, plan.cursorTo)
    if (!next || next.stage === 'file') {
      this.close()
      return true
    }
    this.session = { origin: next, query: '', generation: session.generation + 1 }
    this.result = null
    this.activeIndex = null
    this.activeId = null
    this.lastReqId = -1
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
    const result = this.result
    if (this.session.origin.stage === 'heading') {
      // 标题占位（T03：不读目标文档，仅提示；占位不可确认）
      popup.appendChild(this.buildStatusRow(t('wikilinkSuggest.placeholder.heading')))
    } else if (this.session.origin.stage === 'block') {
      popup.appendChild(this.buildStatusRow(t('wikilinkSuggest.placeholder.block')))
    } else if (result === null) {
      popup.appendChild(this.buildStatusRow(t('wikilinkSuggest.status.loading')))
    } else if (result.status === 'noWorkspace') {
      popup.appendChild(this.buildStatusRow(t('wikilinkSuggest.status.noWorkspace')))
    } else if (result.status === 'notReady') {
      popup.appendChild(this.buildStatusRow(t('wikilinkSuggest.status.notReady')))
    } else {
      for (let i = 0; i < result.items.length; i++) {
        popup.appendChild(this.buildItemRow(result.items[i]!, i === this.activeIndex))
      }
      if (result.items.length === 0 && !result.updating) {
        popup.appendChild(this.buildStatusRow(t('wikilinkSuggest.status.empty')))
      }
      if (result.updating) {
        // 部分数据在场：可用项继续候选 + 明确标注仍在构建（不冒充完整）
        popup.appendChild(this.buildStatusRow(t('wikilinkSuggest.status.updating')))
      }
    }
    this.attachScrollListeners()
    this.placePopup()
    this.scrollActiveIntoView()
  }

  private buildStatusRow(text: string): HTMLDivElement {
    const row = document.createElement('div')
    row.className = WIKILINK_SUGGEST_CLASS_NAMES.status
    row.textContent = text
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
    popup.style.display = 'block'
    const height = popup.offsetHeight
    const width = popup.offsetWidth
    let top = coords.bottom + 4
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, coords.top - height - 4)
    }
    const left = Math.min(Math.max(8, coords.left), Math.max(8, window.innerWidth - width - 8))
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
