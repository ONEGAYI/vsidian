// #371 表格可读度量：视图层测量 + Facet 注入通道。
//
// StateField/装饰构建内零 DOM 测量（liveDecorations 头注释红线）——本模块
// 的 ViewPlugin 负责测量（探针 span + computedStyle + 行 DOM 实测），测得
// **纯数据**经 tableMetricsFacet 注入规划层（tableColumnWidth 的
// readability 输入）；liveDecorationsField 检测 facet 变化走与
// tableContainerRenderFacet 同款的全量重建热重配（#296 先例）。
//
// 测量时机（无监听先例的字号变化由此覆盖）：
// - 每次 update：比较探针的字体签名（fontSize/fontFamily）——宿主 CSS
//   变量注入字号/字体变化后，重排触发 CM6 viewport 变化产生 update，
//   首个后续事务即感知（签名比较是 computedStyle 属性读，无强制布局）；
// - document.fonts.ready：片段字体晚到补一轮（fontArrival 同族时机，
//   一次性——后续任意事务的签名比较持续兜底）；
// - IME 组合期（compositionstart/end 自持标志）不 dispatch：置 pending
//   于组合结束后补测——组合期零重算零发布红线（#153/#371）。
//
// availablePx（#372）：实测首个网格行的轨道区净宽（行盒宽 − 左右
// padding/border——引用行缩进随行盒 padding 扣除，与「容器净宽」口径一
// 致）注入；缺省（无表格行/jsdom 无布局）不注入——轨道内 min(px, share%)
// 的 CSS 双保险继续承接「各列下限放不下按比例收缩」，#372 高度优化在
// availablePx 就绪前保持轻量计划不搜索。容器宽变化经几何变化（非文档
// 变更的 viewport/geometry 更新）补测：值未变不 dispatch（不因滚动/连续
// resize 重复重建），变化即全量重算 + 高度优化签名失效（调度层消费）。
// - 评审 I-6：仅 availablePx 变化（字体度量不变）判定为 resize 拖拽，
//   尾随去抖 RESIZE_DEBOUNCE_MS 后一次 reconfigure（逐档注入会级联装饰
//   全量重建与高度优化签名失效）；字体度量变化仍立即。
// - 评审 I-9：纯纵向滚动（scroller 宽度未变 + 字体签名未变 + 行区宽已
//   注入）跳过整轮重测——geometryChanged 后的 rect 读取是强制布局，滚动
//   逐帧读取得省。
//
// jsdom（单元测试）探针无布局（宽度 0）：不注入，保持 #142 缺省行为——
// 单测的度量驱动走 metricsCompartment 显式 reconfigure（同测试对
// tableContainerRenderFacet 的先例）。
import { Compartment, Facet, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import type { TableReadabilityInput } from './tableColumnWidth'

/**
 * #371 可读度量输入通道：缺省 null（#142 静态 48px 下限行为不变）；
 * 视图层测得 { contentPx, cellBoxPx } 后注入，规划层产出字号感知下限。
 */
export const tableMetricsFacet = Facet.define<TableReadabilityInput | null, TableReadabilityInput | null>({
  combine: (values) => (values.length > 0 ? values[values.length - 1]! : null),
})

/** 度量注入热重配槽位：装配预置 of(null)，测量 ViewPlugin 与测试共同 dispatch */
export const metricsCompartment = new Compartment()

/** 探针类：叠 vsidian-table-line 拿表格行字体族（挂 .cm-scroller 继承正文字号） */
const PROBE_CLASS = 'vsidian-table-metrics-probe'
/** 探针文本：约三个汉字（可读下限的内容宽基准） */
const PROBE_TEXT = '汉汉汉'
/** 格盒占位兜底（px）：无表格行可实测时的 CSS 已知值（padding 4px 10px +
 *  border 1px 左右各一 = 22px，main.css 网格格规则；tablePaintCssContract
 *  钉住该规则，此兜底仅在首帧无表格时短暂使用，出现表格行后实测覆盖） */
const CELL_BOX_FALLBACK_PX = 22
/** #372 评审 I-6：仅 availablePx 变化（resize 拖拽逐档）的尾随去抖窗口
 *  （ms）——静止后一次 reconfigure，拖拽期间不逐档全量重建 */
const RESIZE_DEBOUNCE_MS = 150

/**
 * 装配单元：注入槽位（缺省 null）+ 测量 ViewPlugin。挂 livePreviewDecorations
 * （liveDecorations.ts），根编辑器与嵌入子编辑器共用同一装配（各 view 各自
 * 测量：子编辑器容器不同，探针互不干扰）。
 */
/** 组合中的视图集合（compositionstart/end 维护；#371 组合期零 dispatch 红线） */
const composingViews = new WeakSet<EditorView>()
/** 组合期检测到度量变化、待组合结束补测的视图集合 */
const pendingViews = new WeakSet<EditorView>()

const tableMetricsPlugin = ViewPlugin.fromClass(
  class {
      private probe: HTMLSpanElement | null = null
      /** 已注入度量对应的探针字体签名（等值跳过——防测量风暴） */
      private appliedSignature = ''
      /** 实测格盒占位（null = 尚未见过表格行，用 CSS 字面值兜底） */
      private cellBoxPx: number | null = null
      /** #372 评审 I-9：上次测量时的 scroller 宽度（clientWidth——布局未
       *  脏时零成本读）；纯纵向滚动（宽度未变+签名未变+行区宽已注入）据此
       *  跳过整轮重测（零 rect 读取零强制布局） */
      private lastScrollerWidth = -1
      /** #372 评审 I-6：仅 availablePx 变化的尾随去抖（resize 拖拽合并） */
      private availTimer: ReturnType<typeof setTimeout> | null = null
      private pendingAvail: TableReadabilityInput | null = null
      private disposed = false

      constructor(private view: EditorView) {
        this.refresh()
        // 片段字体晚到：fonts.ready 后补测（一次性；jsdom 无 fonts 静默跳过）
        try {
          void (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready.then(() => {
            this.refresh()
          })
        } catch {
          /* 环境无 fonts API：后续事务的签名比较兜底 */
        }
      }

      update(update: ViewUpdate): void {
        const probe = this.ensureProbe()
        if (!probe) {
          return
        }
        const signature = this.signatureOf(probe)
        if (signature !== this.appliedSignature && !composingViews.has(this.view)) {
          this.refresh()
        }
        // #372 容器宽与行区净宽感知：几何变化（视口/面板尺寸）与文档变更
        // （网格行首次出现——availablePx 无行不可测）都延后一拍补测；值未
        // 变不 dispatch（滚动/键入等连续事件零成本收敛）
        if ((update.geometryChanged || update.docChanged) && !composingViews.has(this.view)) {
          this.refresh()
        }
      }

      destroy(): void {
        this.disposed = true
        this.cancelAvailDebounce()
        this.probe?.remove()
        this.probe = null
      }

      /** 请求重测（update 检测、fonts.ready、组合结束补测共用；宏任务延迟） */
      refresh(): void {
        setTimeout(() => {
          if (!this.disposed) {
            this.measure()
          }
        }, 0)
      }

      /** 探针：挂 contentDOM 的父节点（.cm-scroller）——继承正文字号，
       *  absolute + visibility hidden 不参与文档流与网格放置 */
      private ensureProbe(): HTMLSpanElement | null {
        if (this.probe?.isConnected) {
          return this.probe
        }
        const host = this.view.contentDOM.parentElement
        if (!host) {
          return null
        }
        const span = document.createElement('span')
        span.className = `${PROBE_CLASS} vsidian-table-line`
        span.textContent = PROBE_TEXT
        this.probe = span
        host.appendChild(span)
        return span
      }

      private signatureOf(probe: HTMLSpanElement): string {
        const style = this.view.dom.ownerDocument.defaultView?.getComputedStyle(probe)
        return style ? `${style.fontSize}|${style.fontFamily}` : ''
      }

      private measure(): void {
        if (this.disposed) {
          return
        }
        if (composingViews.has(this.view)) {
          pendingViews.add(this.view)
          return
        }
        const probe = this.ensureProbe()
        if (!probe) {
          return
        }
        const signature = this.signatureOf(probe)
        // #372 评审 I-9 纯滚动早退：字体签名未变 + scroller 宽度未变 +
        // 行区宽已注入 → 本次重测只可能由纵向滚动触发，跳过整轮 rect 读取
        // （每次 geometryChanged 后读 rect 是强制布局）。行区宽未就绪（无
        // 网格行/无布局）不跳过——等行区出现补测；jsdom clientWidth 恒 0
        // → 永不命中，行为同现状（不注入）
        const scroller = probe.parentElement
        const scrollerWidth = scroller ? scroller.clientWidth : -1
        const injected = this.view.state.facet(tableMetricsFacet)
        if (this.lastScrollerWidth === scrollerWidth && scrollerWidth > 0 &&
            signature === this.appliedSignature && injected !== null &&
            (injected.availablePx ?? 0) > 0) {
          // 已知边缘（接受）：scroller 宽与字体签名都不变而首个网格行的行区
          // 净宽变化（引用块内新建/迁入表格、CSS 片段改行盒 padding）时，
          // facet 的 availablePx 滞留旧值直到下次 resize/字体变化才重测——
          // 优化路径由调度层按表实测行区宽兜住，失配只影响轻量下限收缩计算
          return
        }
        const contentPx = probe.getBoundingClientRect().width
        if (!(contentPx > 0)) {
          return // jsdom / 未布局：保持缺省行为
        }
        const cellBox = this.measureCellBox()
        if (cellBox !== null) {
          this.cellBoxPx = cellBox
        }
        const cellBoxPx = this.cellBoxPx ?? CELL_BOX_FALLBACK_PX
        const input: TableReadabilityInput = { contentPx, cellBoxPx }
        const availablePx = this.measureRowAreaPx()
        if (availablePx !== null) {
          input.availablePx = availablePx
        }
        const current = this.view.state.facet(tableMetricsFacet)
        const unchanged = current && current.contentPx === contentPx && current.cellBoxPx === cellBoxPx &&
            (current.availablePx ?? null) === (input.availablePx ?? null)
        this.appliedSignature = signature
        this.lastScrollerWidth = scrollerWidth
        pendingViews.delete(this.view)
        if (unchanged) {
          return
        }
        // #372 评审 I-6 尾随去抖：仅 availablePx 变化（contentPx/cellBoxPx
        // 不变）= 容器 resize 拖拽——逐档 reconfigure 意味着 facet 变化 →
        // 装饰全量重建 + 高度优化签名全部失效，代价与拖拽频率成正比；静止
        // RESIZE_DEBOUNCE_MS 后一次注入（拖拽连发只刷新待注入值与计时）。
        // 字体度量变化（字号/盒模型/字体族）仍立即
        const fontChanged = !current || current.contentPx !== contentPx || current.cellBoxPx !== cellBoxPx
        if (!fontChanged) {
          this.pendingAvail = input
          if (this.availTimer !== null) {
            clearTimeout(this.availTimer)
          }
          this.availTimer = setTimeout(() => {
            this.availTimer = null
            const pending = this.pendingAvail
            this.pendingAvail = null
            if (!pending || this.disposed || composingViews.has(this.view)) {
              return
            }
            this.view.dispatch({
              effects: metricsCompartment.reconfigure(tableMetricsFacet.of(pending)),
            })
          }, RESIZE_DEBOUNCE_MS)
          return
        }
        this.cancelAvailDebounce()
        this.view.dispatch({
          effects: metricsCompartment.reconfigure(tableMetricsFacet.of(input)),
        })
      }

      /** 取消挂起的 availablePx 去抖注入（字体度量立即注入/销毁时） */
      private cancelAvailDebounce(): void {
        if (this.availTimer !== null) {
          clearTimeout(this.availTimer)
          this.availTimer = null
        }
        this.pendingAvail = null
      }

      /** #372 行区净宽：首个网格行 border-box 宽 − 左右 padding/border
       *  （引用行缩进在行盒 padding 内，扣除后即轨道区宽）；无行/无布局 null */
      private measureRowAreaPx(): number | null {
        const row = this.view.dom.querySelector<HTMLElement>('.vsidian-table-grid-row')
        if (!row) {
          return null
        }
        const win = this.view.dom.ownerDocument.defaultView
        if (!win) {
          return null
        }
        const rect = row.getBoundingClientRect()
        if (!(rect.width > 0)) {
          return null
        }
        const style = win.getComputedStyle(row)
        const px = (value: string): number => parseFloat(value) || 0
        const width = rect.width -
          px(style.paddingLeft) - px(style.paddingRight) -
          px(style.borderLeftWidth) - px(style.borderRightWidth)
        return width > 0 ? width : null
      }

      /** 实测格盒占位：视口内首个网格格的左右 padding + border 合计（无表格行返回 null） */
      private measureCellBox(): number | null {
        const cell = this.view.dom.querySelector<HTMLElement>('.vsidian-table-grid-row > .vsidian-table-grid-cell')
        if (!cell) {
          return null
        }
        const win = this.view.dom.ownerDocument.defaultView
        if (!win) {
          return null
        }
        const style = win.getComputedStyle(cell)
        const px = (value: string): number => parseFloat(value) || 0
        return px(style.paddingLeft) + px(style.paddingRight) + px(style.borderLeftWidth) + px(style.borderRightWidth)
      }
    },
    {
      eventHandlers: {
        // 组合态记在模块级 WeakSet（liveDecorations 的 gridPointerDown 同款
        // 先例）：handler 的 this 类型不带私有成员访问权，实例化状态外置
        compositionstart(_event: Event, view: EditorView): void {
          composingViews.add(view)
        },
        compositionend(_event: Event, view: EditorView): void {
          composingViews.delete(view)
          if (pendingViews.has(view)) {
            pendingViews.delete(view)
            // 组合结束补测：宏任务延迟（避免打断 CM6 组合定稿 flush，
            // symbol-input.md 的 IME 时序契约）
            const plugin = view.plugin(tableMetricsPlugin)
            if (plugin) {
              setTimeout(() => plugin.refresh(), 0)
            }
          }
        },
      },
    },
  )

export const tableMetricsExtension: Extension = [
  metricsCompartment.of(tableMetricsFacet.of(null)),
  tableMetricsPlugin,
]
