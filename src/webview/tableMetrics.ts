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
// availablePx 暂不注入：轨道内 min(px, share%) 的 CSS 双保险已承接「各列
// 下限放不下按比例收缩、容器恢复即回常规下限」（份额 % 相对容器宽解析，
// 等下限收缩即等分）；T02/T03 高度评分需要确定性像素轨道时在此实测注入。
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

      update(_update: ViewUpdate): void {
        const probe = this.ensureProbe()
        if (!probe) {
          return
        }
        const signature = this.signatureOf(probe)
        if (signature !== this.appliedSignature && !composingViews.has(this.view)) {
          this.refresh()
        }
      }

      destroy(): void {
        this.disposed = true
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
        const current = this.view.state.facet(tableMetricsFacet)
        if (current && current.contentPx === contentPx && current.cellBoxPx === cellBoxPx) {
          this.appliedSignature = signature
          pendingViews.delete(this.view)
          return
        }
        this.appliedSignature = signature
        pendingViews.delete(this.view)
        this.view.dispatch({
          effects: metricsCompartment.reconfigure(tableMetricsFacet.of(input)),
        })
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
