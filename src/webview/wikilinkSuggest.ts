// 双链文件联想会话（工单 #376 T01）：主正文新建闭合双链 `[[]]` / `![[]]`
// 及文件前缀输入的候选闭环——识别、查询、候选 UI、键盘与确认插入。
//
// 职责与边界（规格 docs/specs/wikilink-completion.md「技术设计与实施边界」）：
// - 识别是**新增局部逻辑**（shared/wikilinkField），只服务联想触发；完整
//   渲染解析器（shared/wikilink.ts）语义不动。代码上下文/前端头区/表格
//   格区不启用候选（inCodeContext + tableRegionField 环境守卫）。
// - 会话只认单个折叠光标的可编辑 Live 正文：多 range／非空选区、IME 组合
//   期、暂停、源码模式与 Reading 不接管。纯光标移动不发起新查询；移出
//   目标字段、切模式、暂停、外部同步与实例释放关闭候选。
// - 查询经内部消息协议（wikilink.query / wikilink.query.result）：reqId
//   请求配对 + generation 查询代次双守卫，迟到响应一律拒收；宿主不可用
//   时显示真实状态、允许手写、不伪装空结果。
// - 键位是**候选会话内的固定控件按键**（↑↓ 移动高亮、Enter/Tab 确认、
//   Esc 关闭），仅在会话内有可确认项/在会话开启时消费，未命中一律 return
//   false 落穿既有围栏越界/表格切格/缩进/列表延续链；不注册快捷键操作表、
//   不经全局 keybindingRouter（评估记录见 docs/specs/keybindings.md）。
// - 候选浮层锚定实际 EditorView 的目标位置（字段开标记处），不夺正文
//   焦点；行结构为 listbox/option 语义 + 键盘高亮类。
//
// 本模块随 LiveEditorInstance 装配（扩展数组置于 fenceEscape 之前——keymap
// 正序尝试，候选确认优先于越界/切格/缩进；关闭时无键位残留）。
import { EditorSelection, EditorState, type Extension, type Transaction } from '@codemirror/state'
import { EditorView, keymap, type ViewUpdate } from '@codemirror/view'
import { findWikilinkFileField } from '../shared/wikilinkField'
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

/** 识别快照（字段边界为文档绝对偏移） */
interface SuggestOrigin {
  fieldFrom: number
  fieldTo: number
  closeFrom: number
  embed: boolean
  /** 字段与闭围栏之间是否已有别名分隔符（确认时决定是否补默认别名） */
  hasDisplay: boolean
}

/** 最近一次接受的查询结果（真实状态面） */
interface SuggestResult {
  status: 'ready' | 'noWorkspace' | 'notReady'
  updating: boolean
  items: WikilinkCandidateItem[]
  total: number
  /** 结果携带的清单代次（#377 T02；跨代次的追加页不拼接——重取首页） */
  catalogGen: number
}

export class WikilinkSuggestController {
  private view: EditorView | null = null
  private session: { origin: SuggestOrigin; query: string; generation: number } | null = null
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
  /** 确认 dispatch 期间抑制识别（确认编辑本身不得重开会话） */
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
    if (this.invalidateTimer !== undefined) {
      clearTimeout(this.invalidateTimer)
      this.invalidateTimer = undefined
    }
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
    if (message.status === 'unavailable') {
      this.result = {
        status: message.reason === 'not-ready' ? 'notReady' : 'noWorkspace',
        updating: false, items: [], total: 0, catalogGen: 0,
      }
      this.morePending = false
    } else {
      const pageItems = message.items ?? []
      const pageGen = message.catalogGen ?? 0
      const prev = this.result
      if (this.lastReqOffset > 0 && prev !== null && prev.status === 'ready') {
        if (prev.catalogGen !== pageGen) {
          // 清单代次已变：追加页序位失效，重取首页（同查询同代次）
          this.sendQuery(this.session.query, this.session.generation, 0)
          return
        }
        this.result = {
          status: 'ready',
          updating: message.updating === true,
          items: prev.items.concat(pageItems),
          total: message.total ?? prev.total,
          catalogGen: pageGen,
        }
        this.morePending = false
        this.render()
        return
      }
      this.result = {
        status: 'ready',
        updating: message.updating === true,
        items: pageItems,
        total: message.total ?? 0,
        catalogGen: pageGen,
      }
      this.morePending = false
    }
    // 初始高亮规则：空查询不高亮；有查询且有结果自动高亮首项
    this.activeIndex = this.session.query !== '' && this.result.items.length > 0 ? 0 : null
    this.render()
  }

  /**
   * 候选失效信号（#377 T02，wikilink.invalidate）：索引/全文件清单变更后
   * 宿主广播。会话在场时去抖 300ms 重发当前查询（同查询新 reqId，结果按
   * 既有守卫整体替换——旧枚举/旧查询不得复活已删除身份）；无会话零动作。
   * notify 在扫描/核验期间高频到达，去抖把重查合并为每 300ms 至多一次
   * （查询为宿主内存同步执行，单次费用低）。
   */
  handleInvalidate(): void {
    if (!this.session || this.deps.isSuspended() || !this.deps.isLiveActive()) {
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
      this.morePending = false
      this.sendQuery(session.query, session.generation, 0)
    }, 300)
  }

  /** 显式关闭（模式切换/暂停/实例收尾由调用方触发；幂等） */
  close(): void {
    if (!this.session && this.result === null && !this.popup) {
      return
    }
    this.session = null
    this.result = null
    this.activeIndex = null
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
      // 纯光标移动不发起新查询；移出目标字段关闭候选
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
    const field = this.recognizeAt(update.state, head)
    if (!field) {
      this.close()
      return
    }
    const origin: SuggestOrigin = field
    const line = update.state.doc.lineAt(head)
    const query = line.text.slice(origin.fieldFrom - line.from, head - line.from)
    const prev = this.session
    if (prev && prev.origin.fieldFrom === origin.fieldFrom && prev.origin.fieldTo === origin.fieldTo &&
      prev.origin.embed === origin.embed && prev.query === query) {
      return // 同字段同查询（如无关位置的并发编辑）：不重复出站
    }
    const generation = prev ? prev.generation + 1 : 1
    this.session = { origin, query, generation }
    this.result = null
    this.activeIndex = null
    this.sendQuery(query, generation, 0)
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
    const field = findWikilinkFileField(line.text, pos - line.from)
    if (!field) {
      return null
    }
    return {
      fieldFrom: line.from + field.fieldFrom,
      fieldTo: line.from + field.fieldTo,
      closeFrom: line.from + field.closeFrom,
      embed: field.embed,
      hasDisplay: line.text.slice(field.fieldFrom, field.closeFrom).includes('|'),
    }
  }

  private caretInField(pos: number): boolean {
    const origin = this.session?.origin
    if (!origin) {
      return false
    }
    // 快速判定：光标仍在原字段区间内（识别边界已由开启时把关；字段内
    // 纯光标移动不重识别、不重查询）
    return pos >= origin.fieldFrom && pos <= origin.fieldTo
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

  // ---- 会话键位（候选控件按键；未命中一律落穿） ----

  private moveActive(delta: number): boolean {
    if (!this.session || !this.view || this.view.compositionStarted) {
      return false
    }
    if (!this.result || this.result.status !== 'ready' || this.result.items.length === 0) {
      return false
    }
    const count = this.result.items.length
    const from = this.activeIndex
    // #377 T02 触底续页：高亮在末项且总数未尽时，↓ 触发下一页加载（同
    // 查询同代次；应答追加，高亮保持）。仍在途时不重复发。
    if (
      delta > 0 && from === count - 1 && !this.morePending &&
      this.result.total > count
    ) {
      this.morePending = true
      this.sendQuery(this.session.query, this.session.generation, count)
      return true
    }
    this.activeIndex = from === null
      ? (delta > 0 ? 0 : count - 1)
      : Math.min(count - 1, Math.max(0, from + delta))
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

  /** Enter/Tab 确认：仅在有可确认高亮项时接管；确认替换整个文件字段
   *  （保留已有显示文字/锚点），无分隔符时补默认别名；一笔事务=一笔
   *  宿主撤销记录，确认后关闭会话 */
  private confirm(): boolean {
    const view = this.view
    const session = this.session
    if (!view || !session || view.compositionStarted) {
      return false
    }
    if (this.deps.isSuspended() || !this.deps.isLiveActive()) {
      return false
    }
    const item = this.result?.status === 'ready' && this.activeIndex !== null
      ? this.result.items[this.activeIndex]
      : undefined
    if (!item || item.insertPath === '') {
      return false
    }
    const selection = view.state.selection
    if (selection.ranges.length !== 1 || !selection.main.empty) {
      return false
    }
    // 确认前复核字段身份：识别漂移（边界变化）即放弃确认并关闭，不误写
    const field = this.recognizeAt(view.state, selection.main.head)
    if (!field || field.fieldFrom !== session.origin.fieldFrom || field.embed !== session.origin.embed) {
      this.close()
      return false
    }
    const insert = session.origin.hasDisplay ? item.insertPath : `${item.insertPath}|${item.alias}`
    const cursorTo = session.origin.fieldFrom + item.insertPath.length
    this.confirming = true
    try {
      view.dispatch({
        changes: { from: session.origin.fieldFrom, to: session.origin.fieldTo, insert },
        selection: EditorSelection.cursor(cursorTo),
        scrollIntoView: true,
      })
    } finally {
      this.confirming = false
    }
    this.close()
    return true
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
    if (result === null) {
      popup.appendChild(this.buildStatusRow(t('wikilinkSuggest.status.loading')))
    } else if (result.status === 'noWorkspace') {
      popup.appendChild(this.buildStatusRow(t('wikilinkSuggest.status.noWorkspace')))
    } else if (result.status === 'notReady') {
      popup.appendChild(this.buildStatusRow(t('wikilinkSuggest.status.notReady')))
    } else {
      for (let i = 0; i < result.items.length; i++) {
        popup.appendChild(this.buildItemRow(result.items[i]!, i === this.activeIndex))
      }
      const remaining = result.total - result.items.length
      if (result.items.length === 0 && !result.updating) {
        popup.appendChild(this.buildStatusRow(t('wikilinkSuggest.status.empty')))
      }
      if (remaining > 0) {
        // 分页续载提示（#377 T02）：总数未尽时提示按 ↓ 继续（触底加载）
        popup.appendChild(this.buildStatusRow(t('wikilinkSuggest.status.more', { count: remaining })))
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
    let coords: { left: number; top: number; bottom: number } | null = null
    try {
      coords = view.coordsAtPos(origin.fieldFrom) as { left: number; top: number; bottom: number } | null
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
