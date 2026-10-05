// #372/#373 离开编辑后的整表高度优化调度层（ViewPlugin）。
//
// 职责分工（规格 #371「实现边界与缓存」）：
// - 纯函数算候选（tableHeightPlan.optimizeTableHeight——两列 #372 粗搜+
//   细搜，三列及以上 #373 有限候选+阈值转移）；本插件只做调度与一次发布
//   ——效果事务（applyTableHeightPlan）经 liveDecorations 验证后套用，
//   模板变化 → 行装饰键变 → CM6 重绘。不写回源文本、不新增宿主消息
//   与撤销记录。
// - 活动定义以整表为单位：任一光标在表内（含分隔行，端点侧向解析）、
//   任一线性选区与网格段相交、或矩形格区属于该表——任一成立即「活动」，
//   完整搜索调用次数为零。表内切格仅局部处理；焦点短暂进工具栏/右键
//   菜单/格内嵌入卡而源选区未离表不触发；主编辑器失焦不等同离开。
// - 触发：最后一个表内光标/选区离开后对有变化的表一次完整优化（同版本
//   去重：内容指纹 + 度量签名 + 列数 + 表格身份）。初次挂载的非活动可见
//   表允许一次；离屏表延至可见且非活动（viewportChanged 扫描）——纯滚动
//   的连发扫描复用上次指纹（doc 未变即不重扫全表）。回表、
//   删表/区间迁移（docChanged）、模式切换（视图隐藏）、实例销毁取消待执行
//   任务；迟到结果按载荷四元组在字段 update 复核丢弃。
// - IME 组合期搜索与发布均为零（组合结束监听重排待执行任务）；格内引用
//   编辑期间父表暂停（嵌入子编辑器持焦不算父表离开信号）。
// - 缓存随视图释放：逐格折行指标缓存（TABLE_OPT_CACHE_ROWS 上限清空）与
//   已优化签名登记（TABLE_OPT_TRACKED_TABLES 上限清空），无持久存储。
import { type EditorState, type Extension, StateEffect, type Text } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import type { SyntaxNode, Tree } from '@lezer/common'
import {
  liveDecorationsField,
  tableContainerRenderFacet,
  tableGridRowsInfo,
  tableNodeClosest,
} from './liveDecorations'
import { tableMetricsFacet } from './tableMetrics'
import { tableRegionField } from './tableRegionField'
import { blankContainerPrefix, tableRowCellsForColumns } from '../shared/tableCells'
import { collectColumnSamples, type TableReadabilityInput } from './tableColumnWidth'
import {
  TABLE_OPT_CACHE_ROWS,
  TABLE_OPT_TRACKED_TABLES,
  applyTableHeightPlan,
  noteTableOptimizeDiscard,
  noteTableOptimizeSearch,
  noteTableSignatureScan,
  noteTableStructureScan,
  optimizeTableHeight,
  tableMetricsSig,
  type CellWrapProfile,
  type HeightRowInput,
  type TableHeightPlanPayload,
} from './tableHeightPlan'

/** PR #383 验收反馈（结构操作后立即重算）：把手拖拽重排（行/列）、删除
 *  整行、删除整列的编辑事务自带本效果——载荷为表格 from（事务前坐标，
 *  消费侧随变更映射）。三个操作离散且落定即结构终态：即使表仍活动
 *  （光标/把手跟随留在表内）也立即一次完整重算，不与「连续键入活动表
 *  零搜索」契约冲突；插入行/列、退格删空行、格区删除不携带（操作后
 *  通常继续在表内输入，立即重算会在空结构上定格） */
export const requestTableReworkOptimize = StateEffect.define<number>()

const tableHeightSchedulerPlugin = ViewPlugin.fromClass(
  class {
    /** 上一事务的活动表集合（Table 节点 from；docChanged 时随变更映射） */
    private prevActive = new Set<number>()
    /** 离开触发的待执行任务（表格身份集合；0ms 冲量消费） */
    private pendingLeave = new Set<number>()
    /** 结构操作（重排/删行/删列）携带的立即重算任务（表格身份集合；
     *  与 pendingLeave 同 flush 消费，唯一差别：不因活动态取消） */
    private pendingForce = new Set<number>()
    /** 待执行刷新定时器（0ms；组合期/嵌入编辑期挂起） */
    private flushTimer: ReturnType<typeof setTimeout> | null = null
    /** 可见扫描请求（挂载/度量变化/viewport 非 doc 变更时置位） */
    private scanQueued = false
    /** 已优化签名登记：表格身份 → 仲裁键（内容指纹+列数+度量签名） */
    private tracked = new Map<number, { sig: string }>()
    /** 内容指纹缓存：表格身份 → 上次仲裁键及其文档引用与度量签名——
     *  doc 未变（Text 引用相等）且度量签名相同时复用上次指纹直接比对
     *  tracked，跳过全行重扫（纯滚动的 viewportChanged 连发不重复构造
     *  千行指纹；doc 变化/度量变化/容量上限自然或显式失效） */
    private fingerCache = new Map<number, { doc: Text; metricsSig: string; sig: string }>()
    /** 逐格折行指标缓存（行文本 → profile；随视图释放） */
    private profileCache = new Map<string, CellWrapProfile>()
    private destroyed = false

    constructor(private view: EditorView) {
      this.prevActive = this.activeTables(view.state)
      // 初次挂载的非活动可见表允许一次（度量未就绪时本轮自然空转）
      this.queueScan()
      // 组合结束后重排挂起的待执行任务（组合期零搜索零发布的补位）
      this.view.contentDOM.addEventListener('compositionend', this.onCompositionEnd)
    }

    destroy(): void {
      this.destroyed = true
      this.disarmFlush()
      this.pendingLeave.clear()
      this.pendingForce.clear()
      this.tracked.clear()
      this.fingerCache.clear()
      this.profileCache.clear()
      this.view.contentDOM.removeEventListener('compositionend', this.onCompositionEnd)
    }

    private readonly onCompositionEnd = (): void => {
      if (this.pendingLeave.size > 0 || this.pendingForce.size > 0 || this.scanQueued) {
        this.armFlush()
      }
    }

    update(u: import('@codemirror/view').ViewUpdate): void {
      if (this.destroyed) {
        return
      }
      // 度量（字号/盒模型/容器净宽）变化：签名全部失效；合并到可见扫描
      // （活动表由离开事件处理——「活动表轻量适配、非活动可见表合并重算」）
      if (u.startState.facet(tableMetricsFacet) !== u.state.facet(tableMetricsFacet)) {
        this.tracked.clear()
        this.fingerCache.clear()
        this.queueScan()
      }
      if (u.docChanged) {
        // 区间迁移/删除/表前编辑：待执行任务全部取消（效果侧另有文档引用
        // 复核兜底）；不请求扫描——内容编辑后的重算由下一次离开/滚动/度量
        // 事件承接，避免每次键入全表指纹评估。结构操作自带的立即重算
        // （pendingForce）不在此列：载荷已按本次变更映射，由 flush 消费
        this.pendingLeave.clear()
        const mapped = new Set<number>()
        for (const from of this.prevActive) {
          mapped.add(u.changes.mapPos(from, -1))
        }
        this.prevActive = mapped
      }
      // 结构操作（把手重排/删行/删列）事务自带：载荷为事务前表格 from，
      // 随本次变更映射后入队（置于 docChanged 处理之后——先取消陈旧离开
      // 任务再收新任务，两队列互不干扰）。effects 挂在事务上：经
      // u.transactions 逐笔读取（ViewUpdate 无顶层 effects 快捷属性）
      for (const tr of u.transactions) {
        for (const e of tr.effects) {
          if (e.is(requestTableReworkOptimize)) {
            this.pendingForce.add(tr.docChanged ? tr.changes.mapPos(e.value, -1) : e.value)
          }
        }
      }
      const regionChanged =
        u.startState.field(tableRegionField, false) !== u.state.field(tableRegionField, false)
      if (u.selectionSet || u.docChanged || regionChanged || u.viewportChanged) {
        const active = this.activeTables(u.state)
        // 回表：取消该表的待执行任务
        for (const from of active) {
          if (!this.prevActive.has(from)) {
            this.pendingLeave.delete(from)
          }
        }
        // 离开整表：调度一次完整优化（表格身份仍有效才入队）
        for (const from of this.prevActive) {
          if (!active.has(from)) {
            this.scheduleLeave(u.state, from)
          }
        }
        this.prevActive = active
        // 离屏表延至可见且非活动：滚动/resize（非文档变更）触发的几何更新
        if (u.viewportChanged && !u.docChanged) {
          this.queueScan()
        }
      }
      // #372 评审 I-8：flush 因嵌入编辑挂起的任务没有专属事件（嵌入退出只
      // 带来父视图的常规事务）——挂起条件解除且任务仍在时重排一次 flush。
      // 视图隐藏（editorHidden）在 flush 内已丢弃任务（模式切换语义保持），
      // 此处对 hidden 的检查只是不无谓 arm
      if ((this.pendingLeave.size > 0 || this.pendingForce.size > 0) && !this.embedEditing() && !this.editorHidden()) {
        this.armFlush()
      }
    }

    // ---- 活动定义（以整表为单位） ----

    private activeTables(state: EditorState): Set<number> {
      const out = new Set<number>()
      const field = state.field(liveDecorationsField, false)
      if (!field) {
        return out
      }
      const addAt = (pos: number, side: 1 | -1): void => {
        const node = tableNodeClosest(field.tree, pos, side)
        if (node) {
          out.add(node.from)
        }
      }
      for (const r of state.selection.ranges) {
        // 折叠光标两侧解析（恰在表边界视作表内——与 selectionTouchesRange 同语义）
        if (r.empty) {
          addAt(r.head, -1)
          addAt(r.head, 1)
          continue
        }
        // 非空选区：端点在表内即活动
        addAt(r.from, 1)
        addAt(r.to, -1)
      }
      // 跨越选区（端点在表外但覆盖表格行）：与网格段相交即活动
      const spanning = state.selection.ranges.some((r) => !r.empty)
      if (spanning) {
        for (const seg of field.gridSegments) {
          for (const r of state.selection.ranges) {
            if (!r.empty && seg.to >= r.from && seg.from <= r.to) {
              addAt(seg.from, 1)
              break
            }
          }
        }
      }
      // 矩形格区属于该表
      const region = state.field(tableRegionField, false)
      if (region) {
        addAt(region.tableFrom, 1)
      }
      return out
    }

    // ---- 调度与消费 ----

    private scheduleLeave(state: EditorState, tableFrom: number): void {
      const field = state.field(liveDecorationsField, false)
      if (!field) {
        return
      }
      // 表格身份仍有效（未被删除/未被结构改写移位）才入队
      const node = tableNodeClosest(field.tree, tableFrom, 1)
      if (!node || node.from !== tableFrom) {
        return
      }
      this.pendingLeave.add(tableFrom)
      this.armFlush()
    }

    private queueScan(): void {
      this.scanQueued = true
      this.armFlush()
    }

    private armFlush(): void {
      if (this.flushTimer === null && !this.destroyed) {
        this.flushTimer = setTimeout(() => {
          this.flushTimer = null
          this.flush()
        }, 0)
      }
    }

    private disarmFlush(): void {
      if (this.flushTimer !== null) {
        clearTimeout(this.flushTimer)
        this.flushTimer = null
      }
    }

    private flush(): void {
      if (this.destroyed) {
        return
      }
      // IME 组合期：搜索与发布均为零——保留任务，compositionend 后重排
      if (this.view.compositionStarted) {
        return
      }
      // 格内引用编辑：嵌入子编辑器持焦期间父表暂停（不算离开信号）
      if (this.embedEditing()) {
        return
      }
      // 模式切换/隐藏（liveWrapper display:none）：丢弃待执行任务
      if (this.editorHidden()) {
        this.pendingLeave.clear()
        this.pendingForce.clear()
        this.scanQueued = false
        return
      }
      const state = this.view.state
      const field = state.field(liveDecorationsField, false)
      if (!field) {
        return
      }
      const metrics = state.facet(tableMetricsFacet)
      const active = this.activeTables(state)
      const effects: Array<StateEffect<TableHeightPlanPayload>> = []
      for (const from of [...this.pendingLeave]) {
        this.pendingLeave.delete(from)
        if (active.has(from)) {
          continue // 回表：取消
        }
        const table = tableNodeClosest(field.tree, from, 1)
        if (!table || table.from !== from) {
          noteTableOptimizeDiscard()
          continue
        }
        const payload = this.optimizeTable(state, table, metrics)
        if (payload) {
          effects.push(applyTableHeightPlan.of(payload))
        }
      }
      // 结构操作自带的立即重算：与离开触发的唯一差别是不因活动态取消
      // （三个操作离散且落定即结构终态）；表格身份/度量/指纹仲裁与发布
      // 复核同一流程——同版本去重兜底 force 与 leave 对同表的重复入队
      for (const from of [...this.pendingForce]) {
        this.pendingForce.delete(from)
        const table = tableNodeClosest(field.tree, from, 1)
        if (!table || table.from !== from) {
          noteTableOptimizeDiscard()
          continue
        }
        const payload = this.optimizeTable(state, table, metrics)
        if (payload) {
          effects.push(applyTableHeightPlan.of(payload))
        }
      }
      if (this.scanQueued) {
        this.scanQueued = false
        if (metrics) {
          for (const table of this.visibleTables(field.tree, field.gridSegments)) {
            if (this.pendingLeave.has(table.from) || active.has(table.from)) {
              continue
            }
            const payload = this.optimizeTable(state, table, metrics)
            if (payload) {
              effects.push(applyTableHeightPlan.of(payload))
            }
          }
        }
      }
      if (effects.length > 0) {
        // 一次发布：全部载荷并入单一纯效果事务（无 doc/选区变化——零写回）
        this.view.dispatch({ effects })
      }
    }

    /** 嵌入子编辑器持焦（格内引用编辑）：activeElement 在本视图内容内的嵌入宿主里 */
    private embedEditing(): boolean {
      const active = this.view.dom.ownerDocument.activeElement
      if (!(active instanceof Element) || !this.view.contentDOM.contains(active)) {
        return false
      }
      return active.closest('.vsidian-live-embed, .vsidian-embed-card') !== null
    }

    /** 视图被隐藏（模式切换 liveWrapper display:none 等）：先查内联样式
     *  （applyModeDom 的机制）再查计算样式兜底——jsdom 对带样式表的元素
     *  getComputedStyle 不反映内联 display，两级判定 */
    private editorHidden(): boolean {
      const doc = this.view.dom.ownerDocument
      const win = doc.defaultView
      if (!win) {
        return false
      }
      let el: HTMLElement | null = this.view.dom
      while (el && el !== doc.body) {
        if (el.style.display === 'none' || win.getComputedStyle(el).display === 'none') {
          return true
        }
        el = el.parentElement
      }
      return false
    }

    /** 可见表（视口∩网格段 → Table 节点，按 from 去重升序） */
    private visibleTables(
      tree: Tree,
      segments: ReadonlyArray<{ from: number; to: number }>,
    ): SyntaxNode[] {
      const out: SyntaxNode[] = []
      const seen = new Set<number>()
      for (const range of this.view.visibleRanges) {
        for (const seg of segments) {
          if (seg.to < range.from) {
            continue
          }
          if (seg.from > range.to) {
            break
          }
          const node = tableNodeClosest(tree, seg.from, 1)
          if (node && !seen.has(node.from)) {
            seen.add(node.from)
            out.push(node)
          }
        }
      }
      return out
    }

    // ---- 单表优化（含缓存仲裁与预算降级登记） ----

    private optimizeTable(
      state: EditorState,
      table: SyntaxNode,
      metrics: TableReadabilityInput | null,
    ): TableHeightPlanPayload | null {
      // availablePx 未就绪（测量缺位/滞后）：不搜索也不登记，度量就绪后重评
      if (!metrics || !(metrics.availablePx && metrics.availablePx > 0)) {
        return null
      }
      // 指纹缓存命中（零扫描早退，先于结构扫描）：doc 未变（Text 引用相等，
      // 与发布载荷的文档复核同机制）且度量签名相同 → 上次仲裁键仍有效，
      // tracked 同签名即零结构扫描零行重扫（纯滚动的 viewportChanged 连发
      // 连 tableGridRowsInfo 的行身份提取都不必做——行身份随 doc/列数不变）
      const metricsSig = tableMetricsSig(metrics)
      const cached = this.fingerCache.get(table.from)
      if (cached && cached.doc === state.doc && cached.metricsSig === metricsSig) {
        if (this.tracked.get(table.from)?.sig === cached.sig) {
          return null
        }
      }
      noteTableStructureScan()
      const info = tableGridRowsInfo(state.doc, table, state.facet(tableContainerRenderFacet))
      if (!info) {
        return null
      }
      // 行数据与内容指纹（任一行内容/换行分布变化都改变指纹——不能仅凭
      // 逐列最大样本判缓存有效）
      noteTableSignatureScan()
      const rows: HeightRowInput[] = []
      const samples = new Array<number>(info.columns).fill(0)
      const fingerParts: string[] = []
      for (const row of info.rows) {
        const line = state.doc.line(row.lineNo)
        const blank = blankContainerPrefix(line.text, row.prefixLen)
        const cells = tableRowCellsForColumns(blank, 0, info.columns)
        const cellTexts = cells
          ? cells.map((cell) => blank.slice(cell.contentFrom, cell.contentTo))
          : []
        fingerParts.push(`${row.header ? 'h' : 'd'}:${cellTexts.join('\u0002')}`)
        rows.push({ header: row.header, cells: cellTexts })
        const widths = collectColumnSamples([blank], info.columns)
        for (let col = 0; col < info.columns; col++) {
          if (widths[col]! > samples[col]!) {
            samples[col] = widths[col]!
          }
        }
      }
      // 仲裁键 = 列数 + 度量签名 + 内容指纹（表格身份 = Map 键）
      const sig = `${info.columns}|${metricsSig}|${fingerParts.join('\u0001')}`
      if (this.tracked.get(table.from)?.sig === sig) {
        return null // 同版本去重：未变内容再次进出不重复搜索
      }
      if (this.tracked.size >= TABLE_OPT_TRACKED_TABLES) {
        this.tracked.clear()
      }
      this.tracked.set(table.from, { sig })
      if (this.fingerCache.size >= TABLE_OPT_TRACKED_TABLES) {
        this.fingerCache.clear()
      }
      this.fingerCache.set(table.from, { doc: state.doc, metricsSig, sig })
      if (this.profileCache.size >= TABLE_OPT_CACHE_ROWS) {
        this.profileCache.clear()
      }
      // #373 统一入口：两列走 #372 粗搜+细搜，三列及以上走多列有限候选 +
      // 阈值转移（超列数上限/超预算在纯层稳定降级——同源机制，无独立的
      // 多列调度口径）。
      // #372 评审 I-7：availablePx 按表实测——视图级 facet 单值对引用/顶层
      // 表错配（引用缩进/容器差异），优化前对该表首个网格行实测行区宽
      // （一次优化一次查询；查不到回退 facet 值）。仲裁签名仍用 facet 纲：
      // 表级宽差不触发重搜，随 facet 变化（resize/度量）统一重评
      const tableAvailPx = this.measureTableRowAreaPx(state, table) ?? metrics.availablePx!
      const result = optimizeTableHeight(
        { rows, samples, readability: { ...metrics, availablePx: tableAvailPx } },
        { tokenCache: this.profileCache },
      )
      noteTableOptimizeSearch(result.cellEvals, result.candidates)
      if (result.origin !== 'optimized') {
        return null // 无改进或降级：轻量计划保持（一次降级不反复重试）
      }
      return {
        tableFrom: table.from,
        doc: state.doc,
        columns: info.columns,
        metricsSig,
        template: result.template,
      }
    }

    /** #372 评审 I-7：该表首个网格行的实测行区宽（border-box 宽 − 左右
     *  padding/border——引用缩进随行盒 padding 扣除，与 tableMetrics 的
     *  measureRowAreaPx 同源口径）。沿表区间行序取行首 DOM 判网格行
     * （表头行即首个，一般 1-2 次 domAtPos）；无网格行 DOM（未渲染/无
     *  布局/jsdom）返回 null，调用方回退 facet 的视图级单值 */
    private measureTableRowAreaPx(state: EditorState, table: SyntaxNode): number | null {
      const win = this.view.dom.ownerDocument.defaultView
      if (!win) {
        return null
      }
      for (let pos = table.from; pos < table.to; ) {
        const line = state.doc.lineAt(pos)
        const at = this.view.domAtPos(line.from)
        const rowEl = (at.node instanceof Element ? at.node : at.node.parentElement)
          ?.closest('.vsidian-table-grid-row')
        if (rowEl instanceof HTMLElement) {
          const rect = rowEl.getBoundingClientRect()
          if (rect.width > 0) {
            const style = win.getComputedStyle(rowEl)
            const px = (value: string): number => parseFloat(value) || 0
            const width = rect.width -
              px(style.paddingLeft) - px(style.paddingRight) -
              px(style.borderLeftWidth) - px(style.borderRightWidth)
            return width > 0 ? width : null
          }
          return null // 行在 DOM 但无布局：与 tableMetrics 的无布局口径一致
        }
        if (line.to >= table.to) {
          break
        }
        pos = line.to + 1
      }
      return null
    }
  },
)

/** #372 高度优化调度装配：挂在 livePreviewDecorations（根编辑器与嵌入子
 *  编辑器共用——各 view 各自的选区/容器/缓存，嵌入表格按自身编辑器优化） */
export const tableHeightScheduler: Extension = tableHeightSchedulerPlugin
