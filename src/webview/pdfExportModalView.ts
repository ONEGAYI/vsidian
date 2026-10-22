// PDF 导出模态视图（T01/#621）：主区预览占位 + 侧区参数与任务状态。
//
// 布局参考 Better Export PDF 的「主要区域预览、侧区配置」（规格 §2.4）：
// 主区 T01 为占位说明（真实 PDF 预览与过期刷新归 T07/#627——产物句柄与
// 代次概念经 state.generation 骨架先行）；侧区承载固定输入显示与本次
// 参数（纸张/方向/边距/缩放；页码/页眉页脚归 T05/#625）。
//
// 绘制层探针：__vsidianTestHooks 标志（宿主 HTML nonce 注入，钩子门控的
// 被动形态）下每次渲染后上报控件可见性与计算样式摘要——集成断言断
// 「用户看到的东西」（可见性 + 计算色），非 DOM 存在性。
import { t } from '../shared/i18n'
import { isHostToWebview } from '../shared/protocol'
import {
  normalizePdfExportOptions,
  orientedPageSize,
  PDF_EXPORT_OPTIONS_DEFAULTS,
  PDF_ORIENTATIONS,
  PDF_PAGE_NUMBER_POSITION_LABEL_KEYS,
  PDF_PAGE_NUMBER_POSITIONS,
  PDF_PAPER_SIZE_KINDS,
  type PdfExportOptions,
  type PdfPageNumberPosition,
} from '../shared/pdfExportOptions'
import { pdfPreviewFingerprint, type PdfPreviewTarget } from '../shared/pdfExportPreview'
import type { PdfBatchConflictStrategy, PdfBatchItem, PdfBatchMappingEntry, PdfBatchResultEntry } from '../shared/pdfExportBatch'
import { SKELETON_SHIMMER_CYCLE_MS, SKELETON_SHIMMER_DELAY_MS } from '../shared/skeletonTiming'
// T07（#627）预览：复用 #337 PDF 阅读视图（PdfHoverView——分页 canvas、
// 有界挂载窗口、Blob worker 装配与共享文档存储），不另建阅读器
import { PDF_ZOOM_STEP, PdfHoverView, type PdfRenderProbe } from './pdfRender'

interface PdfExportModalStateMessage {
  kind: 'pdfExportModal.state'
  phase: 'idle' | 'generating' | 'awaiting-resources' | 'saving' | 'done' | 'failed' | 'cancelled'
  generation: number
  docName: string
  capturedVersion: number
  defaults: PdfExportOptions
  browserPath: string
  savedPath?: string
  failReason?: string
  cancelKind?: 'user' | 'save-dialog'
  /** T02（#622）awaiting-resources 阶段的失败清单 */
  resourceIssues?: ReadonlyArray<{ kind: string; item: string; reason: string }>
  /** T05（#625）标题书签结果（done 阶段提示数据源） */
  bookmarks?: { written: boolean; total: number; skipped: number; reason?: string }
  /** T07（#627）预览状态：phase/generation 与就绪产物指纹（过期判定数据源
   *  ——webview 以 previewTarget + 本地参数就地合成指纹比较，宿主导出复用
   *  核对同一函数；迟到 artifact 按代次配对丢弃） */
  preview?: {
    phase: 'idle' | 'generating' | 'ready' | 'failed'
    generation: number
    fingerprint?: string
    failReason?: string
    bookmarks?: { written: boolean; total: number; skipped: number; reason?: string }
    failures?: ReadonlyArray<{ kind: string; item: string; reason: string }>
    /** 批量模式生效中的预览条目（选中条目被移除时宿主回退首条） */
    batchItemId?: string
  }
  /** 当前预览目标身份（宿主权威；批量 = 生效选中条目） */
  previewTarget?: PdfPreviewTarget
  /** 宿主侧当日日期（页眉日期开启时的指纹成分——两侧同源） */
  hostToday: string
  /** T04（#624）批量 / T06（#626）合并模式状态（在场即清单模式 UI；
   *  缺省 = 单文档 UI。按 mode 判别的联合形态：批量携带映射面与逐文件
   *  结果表；合并为单产物观测（phase 含 capturing/saving，savedPath/
   *  bookmarks 为产物面，failDetail 携带失败篇名）） */
  batch?:
    | {
        mode: 'batch'
        phase: 'editing' | 'confirm' | 'running' | 'awaiting-resources' | 'done' | 'cancelled' | 'failed'
        items: ReadonlyArray<PdfBatchItem>
        mapping?: ReadonlyArray<PdfBatchMappingEntry>
        targetDir?: string
        strategy: PdfBatchConflictStrategy
        currentIndex: number
        total: number
        currentName?: string
        results: ReadonlyArray<PdfBatchResultEntry>
        resourceIssues?: ReadonlyArray<{ kind: string; item: string; reason: string }>
        failReason?: string
      }
    | {
        mode: 'merge'
        phase: 'editing' | 'capturing' | 'running' | 'awaiting-resources' | 'saving' | 'done' | 'cancelled' | 'failed'
        items: ReadonlyArray<PdfBatchItem>
        currentIndex: number
        total: number
        currentName?: string
        resourceIssues?: ReadonlyArray<{ kind: string; item: string; reason: string }>
        failReason?: string
        failDetail?: string
        savedPath?: string
        bookmarks?: { written: boolean; total: number; skipped: number; reason?: string }
      }
}

export interface PdfExportModalViewOptions {
  postMessage(message: unknown): void
}

const CLASS = {
  root: 'vsidian-pdfexport',
  preview: 'vsidian-pdfexport-preview',
  previewPlaceholder: 'vsidian-pdfexport-preview-placeholder',
  previewTitle: 'vsidian-pdfexport-preview-title',
  previewDescription: 'vsidian-pdfexport-preview-description',
  side: 'vsidian-pdfexport-side',
  docRow: 'vsidian-pdfexport-docrow',
  docLabel: 'vsidian-pdfexport-doc-label',
  docName: 'vsidian-pdfexport-doc-name',
  field: 'vsidian-pdfexport-field',
  fieldLabel: 'vsidian-pdfexport-field-label',
  select: 'vsidian-pdfexport-select',
  numberInput: 'vsidian-pdfexport-number',
  rangeWrap: 'vsidian-pdfexport-range-wrap',
  range: 'vsidian-pdfexport-range',
  rangeValue: 'vsidian-pdfexport-range-value',
  actions: 'vsidian-pdfexport-actions',
  runButton: 'vsidian-pdfexport-run',
  cancelButton: 'vsidian-pdfexport-cancel',
  status: 'vsidian-pdfexport-status',
  statusDetail: 'vsidian-pdfexport-status-detail',
  openSettings: 'vsidian-pdfexport-open-settings',
  /** T02（#622）缺资源列表与继续导出按钮 */
  issues: 'vsidian-pdfexport-issues',
  issuesTitle: 'vsidian-pdfexport-issues-title',
  issuesList: 'vsidian-pdfexport-issues-list',
  issueItem: 'vsidian-pdfexport-issue-item',
  resumeButton: 'vsidian-pdfexport-resume',
  /** T05（#625）开关行（checkbox + 文案）、子选项与书签提示 */
  checkRow: 'vsidian-pdfexport-check',
  checkSub: 'vsidian-pdfexport-check-sub',
  bookmarkNotice: 'vsidian-pdfexport-bookmark-notice',
  /** T04（#624）批量模式：主区清单/映射/结果 + 侧区添加与操作（ui-patterns
   *  §2.6 模态面板档位——按钮 6px、列表 hover list 变量族、徽章 pill） */
  batchList: 'vsidian-pdfexport-batch-list',
  batchItem: 'vsidian-pdfexport-batch-item',
  batchItemOrder: 'vsidian-pdfexport-batch-item-order',
  batchItemMain: 'vsidian-pdfexport-batch-item-main',
  batchItemRel: 'vsidian-pdfexport-batch-item-rel',
  batchItemRoot: 'vsidian-pdfexport-batch-item-root',
  batchItemActions: 'vsidian-pdfexport-batch-item-actions',
  batchItemBtn: 'vsidian-pdfexport-batch-item-btn',
  batchEmpty: 'vsidian-pdfexport-batch-empty',
  batchSectionTitle: 'vsidian-pdfexport-batch-section-title',
  batchTarget: 'vsidian-pdfexport-batch-target',
  batchTable: 'vsidian-pdfexport-batch-table',
  batchConflictBadge: 'vsidian-pdfexport-batch-conflict',
  batchSkipBadge: 'vsidian-pdfexport-batch-skipbadge',
  batchAddRow: 'vsidian-pdfexport-batch-addrow',
  batchAddButton: 'vsidian-pdfexport-batch-add',
  batchRunButton: 'vsidian-pdfexport-batch-run',
  batchStartButton: 'vsidian-pdfexport-batch-start',
  batchBackButton: 'vsidian-pdfexport-batch-back',
  batchSummary: 'vsidian-pdfexport-batch-summary',
  batchResumeAllButton: 'vsidian-pdfexport-batch-resumeall',
  /** 双轴评审 P3：结果表失败行的单项重试按钮（终态可重发——规格 §2.5） */
  batchRetryButton: 'vsidian-pdfexport-batch-retry',
  /** T06（#626）合并模式：合并导出按钮/每篇另起一页开关/单产物状态区 */
  mergeRunButton: 'vsidian-pdfexport-merge-run',
  mergePageBreakCheck: 'vsidian-pdfexport-merge-pagebreak',
  mergeOutcome: 'vsidian-pdfexport-merge-outcome',
  /** T07（#627）预览主区：工具栏/过期徽章/滚动区（承载 PdfHoverView） */
  previewBlock: 'vsidian-pdfexport-previewblock',
  previewBar: 'vsidian-pdfexport-previewbar',
  previewRefresh: 'vsidian-pdfexport-preview-refresh',
  previewStaleBadge: 'vsidian-pdfexport-preview-stale',
  previewNotice: 'vsidian-pdfexport-preview-notice',
  previewScroll: 'vsidian-pdfexport-preview-scroll',
  /** 预览舞台（持久滚动区 + 左下角缩放条 + 加载骨架的共同定位基准） */
  previewStage: 'vsidian-pdfexport-preview-stage',
  /** 预览加载骨架（复用开屏骨架块的扫光配方，按纸面尺寸成形） */
  previewSkeleton: 'vsidian-pdfexport-preview-skeleton',
  skeletonPage: 'vsidian-pdfexport-skeleton-page',
  /** 骨架块类名与开屏骨架同族（视觉配方与共享常量同源） */
  skeletonBlock: 'vsidian-skeleton-block',
  /** 左下角缩放控件（− / 百分比 / +） */
  zoomBar: 'vsidian-pdfexport-zoombar',
  zoomButton: 'vsidian-pdfexport-zoom-btn',
  zoomValue: 'vsidian-pdfexport-zoom-value',
} as const

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

const FAIL_REASON_KEYS: Record<string, string> = {
  'no-browser': 'pdfExport.fail.noBrowser',
  'configured-path-missing': 'pdfExport.fail.configuredPathMissing',
  'launch-failed': 'pdfExport.fail.launchFailed',
  'navigate-failed': 'pdfExport.fail.navigateFailed',
  'not-ready': 'pdfExport.fail.notReady',
  'print-failed': 'pdfExport.fail.printFailed',
  'write-failed': 'pdfExport.fail.writeFailed',
  busy: 'pdfExport.fail.busy',
  internal: 'pdfExport.fail.internal',
  // T06（#626）合并专用分态：清单篇固定输入失败（篇名经 captureFailedNotice 呈现）
  'capture-failed': 'pdfExport.batch.captureFailed',
  // T08（#628）远程会话专用分态：执行端缺失 / 跨宿主通道不可达（呈现走
  // 既有失败行元素——无新 UI 形态）
  'executor-missing': 'pdfExport.fail.executorMissing',
  'executor-unreachable': 'pdfExport.fail.executorUnreachable',
}

/** 缺资源项的 i18n 键映射（kind × reason → 词条；未知值回退通配词条） */
const ISSUE_KIND_KEYS: Record<string, string> = {
  embed: 'pdfExport.issues.kind.embed',
  image: 'pdfExport.issues.kind.image',
  graphic: 'pdfExport.issues.kind.graphic',
  media: 'pdfExport.issues.kind.media',
}

const ISSUE_REASON_KEYS: Record<string, string> = {
  'not-found': 'pdfExport.issues.reason.notFound',
  inaccessible: 'pdfExport.issues.reason.inaccessible',
  blocked: 'pdfExport.issues.reason.blocked',
  'load-failed': 'pdfExport.issues.reason.loadFailed',
  'anchor-missing': 'pdfExport.issues.reason.anchorMissing',
  ambiguous: 'pdfExport.issues.reason.ambiguous',
  escape: 'pdfExport.issues.reason.blocked',
  'outside-workspace': 'pdfExport.issues.reason.blocked',
  'non-markdown': 'pdfExport.issues.reason.nonMarkdown',
  'read-failed': 'pdfExport.issues.reason.readFailed',
}

export class PdfExportModalView {
  private readonly options: PdfExportModalViewOptions
  private host: HTMLElement | null = null
  private state: PdfExportModalStateMessage | undefined
  /** 用户已手动改过参数：true 后不再用 defaults 回填控件 */
  private paramsTouched = false
  private currentParams: PdfExportOptions = { ...PDF_EXPORT_OPTIONS_DEFAULTS }

  private paperSelect: HTMLSelectElement | null = null
  private orientationSelect: HTMLSelectElement | null = null
  private marginInput: HTMLInputElement | null = null
  private customWidthInput: HTMLInputElement | null = null
  private customHeightInput: HTMLInputElement | null = null
  private scaleRange: HTMLInputElement | null = null
  private scaleValue: HTMLElement | null = null
  private headerCheck: HTMLInputElement | null = null
  private headerTitleCheck: HTMLInputElement | null = null
  private headerDateCheck: HTMLInputElement | null = null
  private pageNumberCheck: HTMLInputElement | null = null
  private pageNumberPositionSelect: HTMLSelectElement | null = null
  private bookmarksCheck: HTMLInputElement | null = null
  private runButton: HTMLButtonElement | null = null
  private cancelButton: HTMLButtonElement | null = null
  private statusEl: HTMLElement | null = null
  private statusDetailEl: HTMLElement | null = null
  private openSettingsButton: HTMLButtonElement | null = null
  private docNameEl: HTMLElement | null = null
  /** T06（#626）每篇另起一页（合并模式专属参数——视图本地态，随合并
   *  run 消息上行；不进持久设置页，导出是单次行为参数） */
  private mergePageBreak = false
  private mergePageBreakCheckEl: HTMLInputElement | null = null
  private mergeRunButtonEl: HTMLButtonElement | null = null
  private mergeOutcomeEl: HTMLElement | null = null
  /** T07（#627）预览控制器：持久滚动区 + PdfHoverView 跨 render 存活
   *  （render 全量重建时重挂载并恢复 scrollTop——canvas 位图随节点保留） */
  private previewScrollEl: HTMLDivElement | null = null
  private previewView: PdfHoverView | null = null
  /** 当前显示产物的 Blob URL（新一轮 show 落定后回收旧 URL） */
  private previewArtifactUrl = ''
  private previewArtifactGen = 0
  /** 存活 Blob URL 计数（释放配对观测——连续刷新后应收敛为 1） */
  private previewBlobUrlsAlive = 0
  /** 预览舞台（跨 render 存活：滚动区 + 缩放条 + 骨架的共同容器） */
  private previewStageEl: HTMLDivElement | null = null
  /** 产物字节已到达、PdfHoverView 首帧尚未落定（骨架覆盖期） */
  private previewLoading = false
  private zoomOutEl: HTMLButtonElement | null = null
  private zoomInEl: HTMLButtonElement | null = null
  private zoomValueEl: HTMLButtonElement | null = null

  constructor(options: PdfExportModalViewOptions) {
    this.options = options
  }

  mount(parent: HTMLElement): void {
    this.host = parent
    this.render()
  }

  applyState(state: PdfExportModalStateMessage): void {
    this.state = state
    if (!this.paramsTouched) {
      this.currentParams = { ...state.defaults }
    }
    this.render()
  }

  /** 语言切换（locale.changed）：常驻文本重渲染 */
  handleLocaleChanged(message: unknown): void {
    if (isHostToWebview(message) && message.kind === 'locale.changed') {
      this.render()
    }
  }

  // ---- T07（#627）预览主区：实际 PDF 页面（PdfHoverView 复用） ----

  /** 持久滚动区（跨 render 存活——render 全量重建时重挂载并恢复 scrollTop） */
  private ensurePreviewScroll(): HTMLDivElement {
    if (this.previewScrollEl === null) {
      this.previewScrollEl = el('div', CLASS.previewScroll)
      // Ctrl+滚轮缩放（用户验收要求）：只接管带 Ctrl 的滚轮——普通滚轮
      // 仍走滚动；内容未就绪时零动作。non-passive 才能 preventDefault，
      // 阻止 webview 级页面缩放。
      this.previewScrollEl.addEventListener('wheel', (event) => {
        if (!event.ctrlKey) return
        const view = this.previewView
        if (view === null || !view.contentReady) return
        event.preventDefault()
        const factor = event.deltaY < 0 ? PDF_ZOOM_STEP : 1 / PDF_ZOOM_STEP
        if (view.zoomBy(factor)) this.updateZoomUi()
      }, { passive: false })
    }
    return this.previewScrollEl
  }

  /** 预览舞台（持久）：滚动区 + 左下角缩放条 + 加载骨架的共同容器 */
  private ensurePreviewStage(): HTMLDivElement {
    if (this.previewStageEl === null) {
      this.previewStageEl = el('div', CLASS.previewStage)
      this.previewStageEl.appendChild(this.ensurePreviewScroll())
      this.previewStageEl.appendChild(this.buildZoomBar())
    }
    return this.previewStageEl
  }

  /** 左下角缩放控件：− / 百分比（点击复位 100%） / + */
  private buildZoomBar(): HTMLElement {
    const bar = el('div', CLASS.zoomBar)
    const out = el('button', CLASS.zoomButton, '−') as HTMLButtonElement
    out.type = 'button'
    out.setAttribute('aria-label', t('pdfExport.preview.zoomOut'))
    out.setAttribute('data-tooltip', t('pdfExport.preview.zoomOut'))
    out.addEventListener('click', () => this.applyPreviewZoom('out'))
    const value = el('button', CLASS.zoomValue, '100%') as HTMLButtonElement
    value.type = 'button'
    value.setAttribute('aria-label', t('pdfExport.preview.zoomReset'))
    value.setAttribute('data-tooltip', t('pdfExport.preview.zoomReset'))
    value.addEventListener('click', () => this.applyPreviewZoom('reset'))
    const inBtn = el('button', CLASS.zoomButton, '+') as HTMLButtonElement
    inBtn.type = 'button'
    inBtn.setAttribute('aria-label', t('pdfExport.preview.zoomIn'))
    inBtn.setAttribute('data-tooltip', t('pdfExport.preview.zoomIn'))
    inBtn.addEventListener('click', () => this.applyPreviewZoom('in'))
    this.zoomOutEl = out
    this.zoomInEl = inBtn
    this.zoomValueEl = value
    bar.appendChild(out)
    bar.appendChild(value)
    bar.appendChild(inBtn)
    this.updateZoomUi()
    return bar
  }

  /** 缩放动作（按钮/百分比复位）——成功后同步百分比与禁用态 */
  private applyPreviewZoom(action: 'in' | 'out' | 'reset'): void {
    const view = this.previewView
    if (view === null) return
    const changed = action === 'in'
      ? view.zoomBy(PDF_ZOOM_STEP)
      : action === 'out'
        ? view.zoomBy(1 / PDF_ZOOM_STEP)
        : view.resetZoom()
    if (changed) this.updateZoomUi()
  }

  /** 缩放条回显：百分比 = 相对打印纸面的达成值（100% = 纸面大小） */
  private updateZoomUi(): void {
    const view = this.previewView
    const ready = view !== null && view.contentReady
    if (this.zoomValueEl !== null) {
      this.zoomValueEl.textContent = `${view?.zoomPercent() ?? 100}%`
    }
    if (this.zoomOutEl !== null) this.zoomOutEl.disabled = !ready
    if (this.zoomInEl !== null) this.zoomInEl.disabled = !ready
    if (this.zoomValueEl !== null) this.zoomValueEl.disabled = !ready
  }

  /** 预览纸面的 CSS 像素尺寸（96 dpi 打印实际尺寸）——页面显示上限与
   *  骨架成形尺寸的共同来源。 */
  private printPageSize(): { widthPx: number; heightPx: number } {
    const size = orientedPageSize(this.currentParams)
    return {
      widthPx: Math.max(1, Math.round(size.widthIn * 96)),
      heightPx: Math.max(1, Math.round(size.heightIn * 96)),
    }
  }

  /** 布局度量写到根元素：预览列宽按纸面宽封顶（右侧栏吸收剩余宽度），
   *  骨架页按同一尺寸成形；CSS 侧 transition 负责尺寸变化的滑动动画。 */
  private applyRootMetrics(root: HTMLElement): void {
    const { widthPx } = this.printPageSize()
    root.style.setProperty('--vsidian-pdfexport-print-width', `${widthPx}px`)
    root.classList.toggle('vsidian-pdfexport--list', this.state?.batch !== undefined)
    this.previewView?.setMaxRenderWidth(widthPx)
  }

  /** 预览加载骨架（复用开屏骨架屏的灰块 + 扫光配方；尺寸贴合当前纸面）。 */
  private buildPreviewSkeleton(): HTMLElement {
    const wrap = el('div', CLASS.previewSkeleton)
    wrap.setAttribute('aria-hidden', 'true')
    // 扫光节拍与开屏骨架同源（shared/skeletonTiming 常量），CSS 只消费变量
    wrap.style.setProperty('--vsidian-pdfexport-skeleton-cycle', `${SKELETON_SHIMMER_CYCLE_MS}ms`)
    wrap.style.setProperty('--vsidian-pdfexport-skeleton-delay', `${SKELETON_SHIMMER_DELAY_MS}ms`)
    const page = el('div', CLASS.skeletonPage)
    const { widthPx, heightPx } = this.printPageSize()
    page.style.setProperty('--vsidian-pdfexport-skeleton-width', `${widthPx}px`)
    page.style.setProperty('--vsidian-pdfexport-skeleton-ratio', String(widthPx / heightPx))
    for (let i = 0; i < 9; i++) {
      page.appendChild(el('div', CLASS.skeletonBlock))
    }
    wrap.appendChild(page)
    return wrap
  }

  private ensurePreviewView(): PdfHoverView {
    if (this.previewView === null) {
      this.previewView = new PdfHoverView(this.ensurePreviewScroll())
    }
    return this.previewView
  }

  /** 过期判定（无状态计算——每次 render 重估）：当前参数 + 当前目标身份
   *  合成指纹与就绪产物指纹比较。参数、清单、选中条目、输入版本任一变化
   *  即失配；生成在途时旧产物仍按其指纹比较（过期徽章持续可见直至新产物
   *  落地配对成功）。 */
  private computePreviewStale(): boolean {
    const s = this.state
    if (s?.preview?.fingerprint === undefined || s.previewTarget === undefined) return false
    if (this.previewArtifactUrl === '') return false
    const fingerprint = pdfPreviewFingerprint({
      options: this.currentParams,
      target: s.previewTarget,
      ...(s.batch?.mode === 'merge' ? { pageBreak: this.mergePageBreak } : {}),
      today: s.hostToday,
    })
    return fingerprint !== s.preview.fingerprint
  }

  /** 预览产物落地（宿主 previewArtifact 消息）：代次配对丢弃迟到/旧会话
   *  产物；Blob URL 生命周期配对（新一轮 show 落定后回收旧 URL）。
   *  首帧落定前保持骨架覆盖（不出现空白画布），落定后撤除并回显缩放条。 */
  applyPreviewArtifact(generation: number, base64: string): void {
    const s = this.state
    if (s?.preview === undefined || generation !== s.preview.generation) return
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
    this.previewBlobUrlsAlive++
    const prevUrl = this.previewArtifactUrl
    this.previewArtifactUrl = url
    this.previewArtifactGen = generation
    this.previewLoading = true
    this.previewView?.setMaxRenderWidth(this.printPageSize().widthPx)
    // 先挂载舞台（骨架覆盖空滚动区），再以真实容器宽发起装载——避免
    // 离屏 clientWidth=0 时用回退宽渲染一轮
    this.render()
    const scroll = this.ensurePreviewScroll()
    const view = this.ensurePreviewView()
    const width = Math.max(240, scroll.clientWidth - 16 || this.printPageSize().widthPx)
    void view.show(url, 1, width).finally(() => {
      this.previewLoading = false
      if (prevUrl !== '') {
        URL.revokeObjectURL(prevUrl)
        this.previewBlobUrlsAlive--
      }
      this.updateZoomUi()
      this.render()
    })
  }

  /** 测试钩子：参数控件置值并走真实 change 路径（仅 __vsidianTestHooks 下
   *  由宿主 _test 转发到达——驱动 paramsTouched → 过期徽章断言） */
  applyTestSetParam(patch: { field?: unknown; value?: unknown }): void {
    if (!(globalThis as { __vsidianTestHooks?: boolean }).__vsidianTestHooks) return
    const field = typeof patch.field === 'string' ? patch.field : ''
    const value = patch.value
    const setSelect = (select: HTMLSelectElement | null, v: string): void => {
      if (select === null || select.value === v) return
      select.value = v
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }
    const setCheck = (box: HTMLInputElement | null, v: boolean): void => {
      if (box === null || box.checked === v) return
      box.checked = v
      box.dispatchEvent(new Event('change', { bubbles: true }))
    }
    switch (field) {
      case 'paper': setSelect(this.paperSelect, String(value)); return
      case 'orientation': setSelect(this.orientationSelect, String(value)); return
      case 'pageNumberPosition': setSelect(this.pageNumberPositionSelect, String(value)); return
      case 'marginMm':
      case 'customWidthMm':
      case 'customHeightMm': {
        const input = field === 'marginMm' ? this.marginInput : field === 'customWidthMm' ? this.customWidthInput : this.customHeightInput
        if (input === null || typeof value !== 'number' || input.value === String(value)) return
        input.value = String(value)
        input.dispatchEvent(new Event('change', { bubbles: true }))
        return
      }
      case 'scale': {
        if (this.scaleRange === null || typeof value !== 'number') return
        this.scaleRange.value = String(value)
        this.scaleRange.dispatchEvent(new Event('input', { bubbles: true }))
        return
      }
      case 'headerEnabled': setCheck(this.headerCheck, value === true); return
      case 'headerTitle': setCheck(this.headerTitleCheck, value === true); return
      case 'headerDate': setCheck(this.headerDateCheck, value === true); return
      case 'pageNumberEnabled': setCheck(this.pageNumberCheck, value === true); return
      case 'bookmarksEnabled': setCheck(this.bookmarksCheck, value === true); return
      case 'mergePageBreak': setCheck(this.mergePageBreakCheckEl, value === true); return
      default: return
    }
  }

  /** 预览目标可用（空清单/固定输入未就位时刷新不可用） */
  private previewTargetAvailable(): boolean {
    const s = this.state
    if (s?.batch !== undefined) return s.batch.items.length > 0
    return s?.docName !== undefined && s.docName !== ''
  }

  /** 预览主区（工具栏 + 滚动区/空态占位）；split = 清单编辑态上下分栏 */
  private buildPreviewArea(): HTMLElement {
    const block = el('div', CLASS.previewBlock)
    const bar = el('div', CLASS.previewBar)
    const s = this.state
    const preview = s?.preview
    const previewBusy = preview?.phase === 'generating'
    const exportBusy = s?.batch !== undefined
      ? s.batch.phase === 'running' || s.batch.phase === 'awaiting-resources'
        || (s.batch.mode === 'merge' && (s.batch.phase === 'capturing' || s.batch.phase === 'saving'))
      : s?.phase === 'generating' || s?.phase === 'saving' || s?.phase === 'awaiting-resources'

    const refresh = el('button', CLASS.previewRefresh, t('pdfExport.preview.refresh')) as HTMLButtonElement
    // 生成在途/导出运行中禁用（不因重复输入反复启动生成任务）
    refresh.disabled = previewBusy || exportBusy || !this.previewTargetAvailable()
    refresh.addEventListener('click', () => {
      this.paramsTouched = true
      this.readControlsIntoParams()
      this.currentParams = normalizePdfExportOptions(this.currentParams)
      this.options.postMessage({
        kind: 'pdfExportModal.preview.refresh',
        params: this.currentParams,
        ...(s?.batch?.mode === 'merge' ? { pageBreak: this.mergePageBreak } : {}),
      })
    })
    bar.appendChild(refresh)

    // 过期徽章（刷新完成前持续可见——指纹失配即显示）
    if (this.computePreviewStale()) {
      bar.appendChild(el('span', CLASS.previewStaleBadge, t('pdfExport.preview.stale')))
    }

    // 阶段/结果提示（失败分态经 T01 词条映射；书签计数为就绪产物观测面）
    let notice = ''
    if (preview?.phase === 'failed' && preview.failReason !== undefined) {
      const key = preview.failReason === 'capture-failed'
        ? 'pdfExport.batch.captureFailed'
        : FAIL_REASON_KEYS[preview.failReason] ?? 'pdfExport.fail.internal'
      notice = `${t('pdfExport.preview.failed')} ${t(key)}`
    } else if (previewBusy) {
      notice = t('pdfExport.preview.generating')
    } else if (preview?.bookmarks?.written === true) {
      notice = t('pdfExport.preview.bookmarks', {
        count: String(Math.max(0, preview.bookmarks.total - preview.bookmarks.skipped)),
      })
    }
    if (notice !== '') {
      bar.appendChild(el('span', CLASS.previewNotice, notice))
    }

    // 批量条目选择器（按清单选择预览项——不一次常驻所有 PDF 的页面）
    const batch = s?.batch
    if (batch?.mode === 'batch' && batch.phase === 'editing' && batch.items.length > 0) {
      const select = el('select', CLASS.select) as HTMLSelectElement
      const selectedId = preview?.batchItemId ?? batch.items[0]!.id
      for (const item of batch.items) {
        const option = el('option', '', item.relPath)
        option.value = item.id
        select.appendChild(option)
      }
      select.value = selectedId
      select.addEventListener('change', () => {
        this.options.postMessage({ kind: 'pdfExportModal.preview.select', itemId: select.value })
      })
      const field = el('div', CLASS.field)
      field.appendChild(el('label', CLASS.fieldLabel, t('pdfExport.preview.itemLabel')))
      field.appendChild(select)
      bar.appendChild(field)
    }

    block.appendChild(bar)

    // 内容区舞台（持久）：滚动区 + 左下角缩放条；空态/生成态以覆盖层
    // 呈现（骨架或说明），避免整块建了又拆。
    const stage = this.ensurePreviewStage()
    stage.querySelectorAll(`:scope > .${CLASS.previewSkeleton}, :scope > .${CLASS.previewPlaceholder}`)
      .forEach((node) => node.remove())
    if (this.previewArtifactUrl === '') {
      stage.classList.add('vsidian-pdfexport-preview-stage--empty')
      if (previewBusy) {
        // 生成在途且尚无产物：扫光骨架（复用开屏骨架的配方与节拍常量），
        // 不再停留在一行静态说明上
        stage.appendChild(this.buildPreviewSkeleton())
      } else {
        const placeholder = el('div', CLASS.previewPlaceholder)
        placeholder.appendChild(el('h2', CLASS.previewTitle, t('pdfExport.previewPlaceholderTitle')))
        placeholder.appendChild(el('p', CLASS.previewDescription, t('pdfExport.previewPlaceholderDescription')))
        stage.appendChild(placeholder)
      }
    } else {
      stage.classList.remove('vsidian-pdfexport-preview-stage--empty')
      // 产物已到达但首帧未落定：骨架覆盖空滚动区（不出现白屏）
      if (this.previewLoading) stage.appendChild(this.buildPreviewSkeleton())
    }
    block.appendChild(stage)
    this.updateZoomUi()
    return block
  }

  /** 预览滚动区重挂载后恢复滚动位置（render 全量重建不丢浏览位置） */
  private restorePreviewScroll(top: number): void {
    if (this.previewScrollEl !== null && top > 0) {
      this.previewScrollEl.scrollTop = top
    }
  }

  private sendRun(): void {
    this.options.postMessage({ kind: 'pdfExportModal.run', params: this.currentParams })
  }

  private readControlsIntoParams(): void {
    if (this.paperSelect) this.currentParams.paper = this.paperSelect.value as PdfExportOptions['paper']
    if (this.orientationSelect) this.currentParams.orientation = this.orientationSelect.value as PdfExportOptions['orientation']
    if (this.marginInput) {
      const parsed = Number(this.marginInput.value)
      if (Number.isFinite(parsed)) this.currentParams.marginMm = parsed
    }
    if (this.customWidthInput) {
      const parsed = Number(this.customWidthInput.value)
      if (Number.isFinite(parsed)) this.currentParams.customWidthMm = parsed
    }
    if (this.customHeightInput) {
      const parsed = Number(this.customHeightInput.value)
      if (Number.isFinite(parsed)) this.currentParams.customHeightMm = parsed
    }
    if (this.scaleRange) {
      const parsed = Number(this.scaleRange.value)
      if (Number.isFinite(parsed)) this.currentParams.scale = parsed
    }
    if (this.headerCheck) this.currentParams.headerEnabled = this.headerCheck.checked
    if (this.headerTitleCheck) this.currentParams.headerTitle = this.headerTitleCheck.checked
    if (this.headerDateCheck) this.currentParams.headerDate = this.headerDateCheck.checked
    if (this.pageNumberCheck) this.currentParams.pageNumberEnabled = this.pageNumberCheck.checked
    if (this.pageNumberPositionSelect) {
      this.currentParams.pageNumberPosition = this.pageNumberPositionSelect.value as PdfPageNumberPosition
    }
    if (this.bookmarksCheck) this.currentParams.bookmarksEnabled = this.bookmarksCheck.checked
  }

  private render(): void {
    const parent = this.host
    if (!parent) return
    // 预览滚动区跨 render 存活：重建前捕获滚动位置，重挂载后恢复
    const keptPreviewScrollTop = this.previewScrollEl?.scrollTop ?? 0
    parent.textContent = ''
    // T04（#624）批量 / T06（#626）合并：清单模式内容承载于主区（T07 预览
    // 落位前的清单内容区），侧区为添加入口与参数——与单文档渲染完全分治
    if (this.state?.batch) {
      if (this.state.batch.mode === 'merge') {
        this.renderMerge(parent)
      } else {
        this.renderBatch(parent)
      }
      this.restorePreviewScroll(keptPreviewScrollTop)
      return
    }
    const busy = this.state?.phase === 'generating' || this.state?.phase === 'saving' || this.state?.phase === 'awaiting-resources'
    const params = this.currentParams

    const root = el('div', CLASS.root)
    this.applyRootMetrics(root)
    // ---- 主区：实际 PDF 页面预览（T07/#627——PdfHoverView 分页 canvas） ----
    const preview = el('main', CLASS.preview)
    preview.appendChild(this.buildPreviewArea())
    root.appendChild(preview)
    this.restorePreviewScroll(keptPreviewScrollTop)

    // ---- 侧区：固定输入 + 参数 + 操作 + 状态 ----
    const side = el('aside', CLASS.side)
    const docRow = el('div', CLASS.docRow)
    docRow.appendChild(el('span', CLASS.docLabel, t('pdfExport.docLabel')))
    this.docNameEl = el('span', CLASS.docName, this.state?.docName || '…')
    docRow.appendChild(this.docNameEl)
    side.appendChild(docRow)

    this.appendParamFields(side, params)

    // ---- T05（#625）页眉 / 页码 / 标题书签（单文档与 T06 合并共用） ----
    this.appendHeaderFooterFields(side, params)

    const actions = el('div', CLASS.actions)
    this.runButton = el('button', CLASS.runButton, t('pdfExport.run')) as HTMLButtonElement
    this.runButton.disabled = busy || !this.state?.docName
    this.runButton.addEventListener('click', () => {
      this.paramsTouched = true
      this.readControlsIntoParams()
      const normalized = normalizePdfExportOptions(this.currentParams)
      this.currentParams = normalized
      this.sendRun()
      this.render()
    })
    actions.appendChild(this.runButton)
    this.cancelButton = el('button', CLASS.cancelButton, t('pdfExport.cancel')) as HTMLButtonElement
    this.cancelButton.addEventListener('click', () => {
      this.options.postMessage({ kind: 'pdfExportModal.cancel' })
    })
    this.cancelButton.hidden = !busy
    actions.appendChild(this.cancelButton)
    side.appendChild(actions)

    this.statusEl = el('div', CLASS.status)
    this.statusEl.setAttribute('role', 'status')
    this.statusDetailEl = el('div', CLASS.statusDetail)
    this.statusEl.appendChild(this.statusDetailEl)
    side.appendChild(this.statusEl)

    const phase = this.state?.phase ?? 'idle'
    if (phase === 'awaiting-resources') {
      // T02（#622）缺资源选择：失败清单（i18n）+ 继续导出/取消——继续时
      // 正文保留可见降级说明（页面侧已渲染说明块），取消走既有释放链路
      const issues = el('div', CLASS.issues)
      issues.appendChild(el('div', CLASS.issuesTitle, t('pdfExport.issues.title')))
      const list = el('ul', CLASS.issuesList)
      for (const issue of this.state?.resourceIssues ?? []) {
        const item = el('li', CLASS.issueItem)
        const kindText = t(ISSUE_KIND_KEYS[issue.kind] ?? 'pdfExport.issues.kind.unknown')
        const reasonText = t(ISSUE_REASON_KEYS[issue.reason] ?? 'pdfExport.issues.reason.unknown')
        item.textContent = `${kindText} · ${issue.item} · ${reasonText}`
        list.appendChild(item)
      }
      issues.appendChild(list)
      const resumeButton = el('button', CLASS.resumeButton, t('pdfExport.resume')) as HTMLButtonElement
      resumeButton.addEventListener('click', () => {
        this.options.postMessage({ kind: 'pdfExportModal.resume' })
      })
      issues.appendChild(resumeButton)
      side.appendChild(issues)
      this.statusDetailEl.textContent = t('pdfExport.phase.awaitingResources')
    } else if (phase === 'failed' && this.state?.failReason) {
      const key = FAIL_REASON_KEYS[this.state.failReason] ?? 'pdfExport.fail.internal'
      this.statusDetailEl.textContent = `${t('pdfExport.phase.failed')} ${t(key)}`
      if (this.state.failReason === 'no-browser' || this.state.failReason === 'configured-path-missing') {
        this.openSettingsButton = el('button', CLASS.openSettings, t('pdfExport.openSettings')) as HTMLButtonElement
        this.openSettingsButton.addEventListener('click', () => {
          this.options.postMessage({ kind: 'settings.open' })
        })
        side.appendChild(this.openSettingsButton)
      }
    } else if (phase === 'done') {
      this.statusDetailEl.textContent = t('pdfExport.savedTo', { path: this.state?.savedPath ?? '' })
      this.appendBookmarkNotice(side, this.state?.bookmarks)
    } else if (phase === 'cancelled') {
      const kindKey = this.state?.cancelKind === 'save-dialog' ? 'pdfExport.cancelKind.saveDialog' : 'pdfExport.cancelKind.user'
      this.statusDetailEl.textContent = `${t('pdfExport.phase.cancelled')} ${t(kindKey)}`
    } else {
      this.statusDetailEl.textContent = t(`pdfExport.phase.${phase}`)
    }

    root.appendChild(side)
    parent.appendChild(root)
    this.reportPaint()
  }

  private field(label: string, control: HTMLElement): HTMLElement {
    const field = el('div', CLASS.field)
    field.appendChild(el('label', CLASS.fieldLabel, label))
    field.appendChild(control)
    return field
  }

  /** 纸张选项词条（custom 无物理预设表条目——单独词条） */
  private paperLabelOf(kind: Exclude<PdfExportOptions['paper'], 'custom'>): string {
    const table: Record<string, string> = {
      a3: t('pdfExport.paper.a3'),
      a4: t('pdfExport.paper.a4'),
      a5: t('pdfExport.paper.a5'),
      b5: t('pdfExport.paper.b5'),
      letter: t('pdfExport.paper.letter'),
      legal: t('pdfExport.paper.legal'),
    }
    return table[kind] ?? kind
  }

  /** 开关行（label 包裹 checkbox + 文案，点击整行可切换）；onChange 额外
   *  联动（如子项显隐重建）。cls 缺省常规行，子选项传缩进类。返回行节点
   *  与 checkbox（paramsTouched/readControls 由调用方持有的 box 驱动）。 */
  private checkRow(label: string, checked: boolean, onChange?: () => void, cls: string = CLASS.checkRow): { row: HTMLLabelElement; box: HTMLInputElement } {
    const row = el('label', cls) as HTMLLabelElement
    const box = el('input', '') as HTMLInputElement
    box.type = 'checkbox'
    box.checked = checked
    box.addEventListener('change', () => {
      this.paramsTouched = true
      this.readControlsIntoParams()
      onChange?.()
      // T07（#627）：参数变化即时重渲染——过期徽章随指纹失配立即可见
      //（子项显隐联动的 onChange 自带 render 时为无害重复）
      this.render()
    })
    row.appendChild(box)
    row.appendChild(el('span', '', label))
    return { row, box }
  }

  /** 参数字段行（纸张/方向/边距/缩放）——单文档与批量共用（T04 提取；
   *  T05 页眉页脚参数沿此追加，两模式同步生效） */
  private appendParamFields(side: HTMLElement, params: PdfExportOptions): void {
    this.paperSelect = el('select', CLASS.select) as HTMLSelectElement
    for (const kind of PDF_PAPER_SIZE_KINDS) {
      const label = kind === 'custom'
        ? t('pdfExport.paper.custom')
        : this.paperLabelOf(kind)
      const option = el('option', '', label)
      option.value = kind
      this.paperSelect.appendChild(option)
    }
    this.paperSelect.value = params.paper
    this.paperSelect.addEventListener('change', () => {
      this.paramsTouched = true
      this.readControlsIntoParams()
      // 自定义宽高输入显隐联动（custom 时呈现）；重建保持其余控件状态一致
      this.render()
    })
    side.appendChild(this.field(t('pdfExport.paper.label'), this.paperSelect))

    // 自定义宽高（paper === 'custom' 时呈现；默认隐藏不占视觉位）
    if (params.paper === 'custom') {
      this.customWidthInput = el('input', CLASS.numberInput) as HTMLInputElement
      this.customWidthInput.type = 'number'
      this.customWidthInput.min = '20'
      this.customWidthInput.max = '558'
      this.customWidthInput.step = '1'
      this.customWidthInput.value = String(params.customWidthMm)
      this.customWidthInput.addEventListener('change', () => {
        this.paramsTouched = true
        this.readControlsIntoParams()
        this.render() // T07：过期徽章随参数变化即时可见
      })
      side.appendChild(this.field(t('pdfExport.customWidth.label'), this.customWidthInput))
      this.customHeightInput = el('input', CLASS.numberInput) as HTMLInputElement
      this.customHeightInput.type = 'number'
      this.customHeightInput.min = '20'
      this.customHeightInput.max = '558'
      this.customHeightInput.step = '1'
      this.customHeightInput.value = String(params.customHeightMm)
      this.customHeightInput.addEventListener('change', () => {
        this.paramsTouched = true
        this.readControlsIntoParams()
        this.render() // T07：过期徽章随参数变化即时可见
      })
      side.appendChild(this.field(t('pdfExport.customHeight.label'), this.customHeightInput))
    }

    this.orientationSelect = el('select', CLASS.select) as HTMLSelectElement
    for (const orientation of PDF_ORIENTATIONS) {
      const option = el('option', '', t(`pdfExport.orientation.${orientation}`))
      option.value = orientation
      this.orientationSelect.appendChild(option)
    }
    this.orientationSelect.value = params.orientation
    this.orientationSelect.addEventListener('change', () => {
      this.paramsTouched = true
      this.readControlsIntoParams()
      this.render() // T07：过期徽章随参数变化即时可见
    })
    side.appendChild(this.field(t('pdfExport.orientation.label'), this.orientationSelect))

    this.marginInput = el('input', CLASS.numberInput) as HTMLInputElement
    this.marginInput.type = 'number'
    this.marginInput.min = '0'
    this.marginInput.max = '50'
    this.marginInput.step = '1'
    this.marginInput.value = String(params.marginMm)
    this.marginInput.addEventListener('change', () => {
      this.paramsTouched = true
      this.readControlsIntoParams()
      this.render() // T07：过期徽章随参数变化即时可见
    })
    side.appendChild(this.field(t('pdfExport.margin.label'), this.marginInput))

    const rangeWrap = el('div', CLASS.rangeWrap)
    this.scaleRange = el('input', CLASS.range) as HTMLInputElement
    this.scaleRange.type = 'range'
    this.scaleRange.min = '0.1'
    this.scaleRange.max = '2'
    this.scaleRange.step = '0.05'
    this.scaleRange.value = String(params.scale)
    this.scaleRange.addEventListener('input', () => {
      this.paramsTouched = true
      this.readControlsIntoParams()
      if (this.scaleValue) this.scaleValue.textContent = `${Math.round(this.currentParams.scale * 100)}%`
    })
    // T07（#627）：拖动提交（change）时重渲染——过期徽章即时可见；不在
    // input 逐 tick 重渲染（拖动中的整树重建会打断滑杆交互）
    this.scaleRange.addEventListener('change', () => {
      this.render()
    })
    this.scaleValue = el('span', CLASS.rangeValue, `${Math.round(params.scale * 100)}%`)
    rangeWrap.appendChild(this.scaleRange)
    rangeWrap.appendChild(this.scaleValue)
    side.appendChild(this.field(t('pdfExport.scale.label'), rangeWrap))
  }

  /** T05（#625）页眉/页码/书签参数区（单文档与 T06 合并共用——合并产物
   *  同样承载页眉页脚与合并书签；T04 批量逐文件参数面不变，不含此区） */
  private appendHeaderFooterFields(side: HTMLElement, params: PdfExportOptions): void {
    // 页眉：开关 + 内容子项（标题/日期——开关开时呈现）
    const header = this.checkRow(t('pdfExport.header.label'), params.headerEnabled, () => {
      this.render() // 子项显隐联动
    })
    this.headerCheck = header.box
    side.appendChild(header.row)
    if (params.headerEnabled) {
      const titleItem = this.checkRow(t('pdfExport.header.title'), params.headerTitle, undefined, CLASS.checkSub)
      this.headerTitleCheck = titleItem.box
      side.appendChild(titleItem.row)
      const dateItem = this.checkRow(t('pdfExport.header.date'), params.headerDate, undefined, CLASS.checkSub)
      this.headerDateCheck = dateItem.box
      side.appendChild(dateItem.row)
    }

    // 页码：开关 + 页脚内位置（开时呈现）
    const pageNumber = this.checkRow(t('pdfExport.pageNumber.label'), params.pageNumberEnabled, () => {
      this.render() // 位置 select 显隐联动
    })
    this.pageNumberCheck = pageNumber.box
    side.appendChild(pageNumber.row)
    if (params.pageNumberEnabled) {
      this.pageNumberPositionSelect = el('select', CLASS.select) as HTMLSelectElement
      for (const position of PDF_PAGE_NUMBER_POSITIONS) {
        const option = el('option', '', t(PDF_PAGE_NUMBER_POSITION_LABEL_KEYS[position]))
        option.value = position
        this.pageNumberPositionSelect.appendChild(option)
      }
      this.pageNumberPositionSelect.value = params.pageNumberPosition
      this.pageNumberPositionSelect.addEventListener('change', () => {
        this.paramsTouched = true
        this.readControlsIntoParams()
        this.render() // T07：过期徽章随参数变化即时可见
      })
      side.appendChild(this.field(t('pdfExport.pageNumber.position'), this.pageNumberPositionSelect))
    }

    // 标题书签开关
    const bookmarks = this.checkRow(t('pdfExport.bookmarks.label'), params.bookmarksEnabled)
    this.bookmarksCheck = bookmarks.box
    side.appendChild(bookmarks.row)
  }

  /** 书签结果提示（T05 语义：disabled 不提示——用户未开启时静默；失败/
   *  跳过如实呈现，不冒充成功；单文档 done 与 T06 合并 done 共用） */
  private appendBookmarkNotice(side: HTMLElement, bookmarks: { written: boolean; total: number; skipped: number; reason?: string } | undefined): void {
    if (bookmarks === undefined) return
    let notice: string | undefined
    if (bookmarks.written) {
      const count = bookmarks.total - bookmarks.skipped
      notice = bookmarks.skipped > 0
        ? t('pdfExport.bookmarks.partial', { count, skipped: bookmarks.skipped })
        : t('pdfExport.bookmarks.added', { count })
    } else if (bookmarks.reason === 'no-headings') {
      notice = t('pdfExport.bookmarks.noHeadings')
    } else if (bookmarks.reason === 'none-located' || bookmarks.reason === 'locate-failed' || bookmarks.reason === 'write-failed') {
      notice = t('pdfExport.bookmarks.locateFailed')
    }
    if (notice !== undefined) {
      side.appendChild(el('div', CLASS.bookmarkNotice, notice))
    }
  }

  // ---- T04（#624）批量模式渲染（主区清单/映射/结果 + 侧区添加与操作） ----

  private renderBatch(parent: HTMLElement): void {
    const batch = this.state?.batch
    if (!batch || batch.mode !== 'batch') return
    const running = batch.phase === 'running' || batch.phase === 'awaiting-resources'
    const params = this.currentParams
    const root = el('div', CLASS.root)
    this.applyRootMetrics(root)

    // ---- 主区：编辑态 = 清单 + 预览上下分栏（按清单选择预览项）；其余
    // 阶段维持既有清单/映射/结果承载（T07 预览不在执行态呈现） ----
    const main = el('main', CLASS.preview)
    if (batch.phase === 'editing') {
      main.classList.add('vsidian-pdfexport-preview-split')
      main.appendChild(this.buildBatchList(batch, running, 'pdfExport.batch.listTitle', 'pdfExport.batch.empty'))
      main.appendChild(this.buildPreviewArea())
    } else if (batch.phase === 'confirm') {
      main.appendChild(this.buildBatchConfirm(batch))
    } else {
      main.appendChild(this.buildBatchResults(batch))
      if (batch.phase === 'awaiting-resources') {
        main.appendChild(this.buildBatchIssues(batch))
      }
    }
    root.appendChild(main)

    // ---- 侧区：添加入口 + 参数 + 操作 + 状态 ----
    const side = el('aside', CLASS.side)
    const docRow = el('div', CLASS.docRow)
    docRow.appendChild(el('span', CLASS.docLabel, t('pdfExport.batch.listTitle')))
    const count = el('span', CLASS.docName, String(batch.items.length))
    docRow.appendChild(count)
    side.appendChild(docRow)

    const addRow = el('div', CLASS.batchAddRow)
    const addFiles = el('button', CLASS.batchAddButton, t('pdfExport.batch.addFiles')) as HTMLButtonElement
    addFiles.disabled = running
    addFiles.addEventListener('click', () => {
      this.options.postMessage({ kind: 'pdfExportModal.batch.addFiles' })
    })
    addRow.appendChild(addFiles)
    const addDir = el('button', CLASS.batchAddButton, t('pdfExport.batch.addDir')) as HTMLButtonElement
    addDir.disabled = running
    addDir.addEventListener('click', () => {
      this.options.postMessage({ kind: 'pdfExportModal.batch.addDir' })
    })
    addRow.appendChild(addDir)
    side.appendChild(addRow)

    this.appendParamFields(side, params)

    const actions = el('div', CLASS.actions)
    if (batch.phase === 'editing') {
      const run = el('button', CLASS.batchRunButton, t('pdfExport.batch.run')) as HTMLButtonElement
      run.disabled = batch.items.length === 0
      run.addEventListener('click', () => {
        this.paramsTouched = true
        this.readControlsIntoParams()
        this.currentParams = normalizePdfExportOptions(this.currentParams)
        this.options.postMessage({ kind: 'pdfExportModal.batch.run' })
      })
      actions.appendChild(run)
    } else if (batch.phase === 'confirm') {
      const start = el('button', CLASS.batchStartButton, t('pdfExport.batch.start')) as HTMLButtonElement
      start.addEventListener('click', () => {
        this.paramsTouched = true
        this.readControlsIntoParams()
        this.currentParams = normalizePdfExportOptions(this.currentParams)
        this.options.postMessage({ kind: 'pdfExportModal.batch.confirm', params: this.currentParams })
      })
      actions.appendChild(start)
      const back = el('button', CLASS.batchBackButton, t('pdfExport.batch.back')) as HTMLButtonElement
      back.addEventListener('click', () => {
        this.options.postMessage({ kind: 'pdfExportModal.batch.cancel' })
      })
      actions.appendChild(back)
    } else if (running) {
      const cancel = el('button', CLASS.cancelButton, t('pdfExport.cancel')) as HTMLButtonElement
      cancel.addEventListener('click', () => {
        this.options.postMessage({ kind: 'pdfExportModal.batch.cancel' })
      })
      actions.appendChild(cancel)
    } else {
      const back = el('button', CLASS.batchBackButton, t('pdfExport.batch.back')) as HTMLButtonElement
      back.addEventListener('click', () => {
        this.options.postMessage({ kind: 'pdfExportModal.batch.cancel' })
      })
      actions.appendChild(back)
    }
    side.appendChild(actions)

    this.statusEl = el('div', CLASS.status)
    this.statusEl.setAttribute('role', 'status')
    this.statusDetailEl = el('div', CLASS.statusDetail)
    this.statusEl.appendChild(this.statusDetailEl)
    side.appendChild(this.statusEl)
    this.statusDetailEl.textContent = this.batchStatusText(batch)

    root.appendChild(side)
    parent.appendChild(root)
    this.reportPaint()
  }

  // ---- T06（#626）合并模式渲染（主区清单/进度/结果 + 侧区添加、参数与
  //  每篇另起一页——全部复用批量清单与单文档参数档位，零新档位） ----

  private renderMerge(parent: HTMLElement): void {
    const batch = this.state?.batch
    if (!batch || batch.mode !== 'merge') return
    const running = batch.phase === 'capturing' || batch.phase === 'running' || batch.phase === 'saving' || batch.phase === 'awaiting-resources'
    const params = this.currentParams
    const root = el('div', CLASS.root)
    this.applyRootMetrics(root)

    // ---- 主区：编辑态 = 清单 + 预览上下分栏（合并单产物预览）；在途与
    // 终态维持既有进度/结果承载 ----
    const main = el('main', CLASS.preview)
    if (batch.phase === 'editing') {
      main.classList.add('vsidian-pdfexport-preview-split')
      main.appendChild(this.buildBatchList(batch, running, 'pdfExport.merge.listTitle', 'pdfExport.merge.empty'))
      main.appendChild(this.buildPreviewArea())
    } else if (running) {
      main.appendChild(this.buildMergeProgress(batch))
      if (batch.phase === 'awaiting-resources') {
        main.appendChild(this.buildBatchIssues(batch))
      }
    } else {
      main.appendChild(this.buildMergeOutcome(batch))
    }
    root.appendChild(main)

    // ---- 侧区：添加入口 + 参数（单文档全参数面 + 每篇另起一页） ----
    const side = el('aside', CLASS.side)
    const docRow = el('div', CLASS.docRow)
    docRow.appendChild(el('span', CLASS.docLabel, t('pdfExport.merge.listTitle')))
    const count = el('span', CLASS.docName, String(batch.items.length))
    docRow.appendChild(count)
    side.appendChild(docRow)

    const addRow = el('div', CLASS.batchAddRow)
    const addFiles = el('button', CLASS.batchAddButton, t('pdfExport.batch.addFiles')) as HTMLButtonElement
    addFiles.disabled = running
    addFiles.addEventListener('click', () => {
      this.options.postMessage({ kind: 'pdfExportModal.batch.addFiles' })
    })
    addRow.appendChild(addFiles)
    const addDir = el('button', CLASS.batchAddButton, t('pdfExport.batch.addDir')) as HTMLButtonElement
    addDir.disabled = running
    addDir.addEventListener('click', () => {
      this.options.postMessage({ kind: 'pdfExportModal.batch.addDir' })
    })
    addRow.appendChild(addDir)
    side.appendChild(addRow)

    this.appendParamFields(side, params)
    this.appendHeaderFooterFields(side, params)

    // 每篇另起一页（合并专属参数——视图本地态随 merge.run 上行）
    const pageBreak = this.checkRow(t('pdfExport.merge.pageBreak'), this.mergePageBreak, () => {
      this.mergePageBreak = pageBreak.box.checked
    })
    pageBreak.row.classList.add(CLASS.mergePageBreakCheck)
    this.mergePageBreakCheckEl = pageBreak.box
    side.appendChild(pageBreak.row)

    const actions = el('div', CLASS.actions)
    if (batch.phase === 'editing') {
      const run = el('button', CLASS.mergeRunButton, t('pdfExport.merge.run')) as HTMLButtonElement
      run.disabled = batch.items.length === 0
      run.addEventListener('click', () => {
        this.paramsTouched = true
        this.readControlsIntoParams()
        this.currentParams = normalizePdfExportOptions(this.currentParams)
        this.options.postMessage({ kind: 'pdfExportModal.merge.run', params: this.currentParams, pageBreak: this.mergePageBreak })
      })
      this.mergeRunButtonEl = run
      actions.appendChild(run)
    } else if (running) {
      const cancel = el('button', CLASS.cancelButton, t('pdfExport.cancel')) as HTMLButtonElement
      cancel.addEventListener('click', () => {
        this.options.postMessage({ kind: 'pdfExportModal.batch.cancel' })
      })
      actions.appendChild(cancel)
    } else {
      const back = el('button', CLASS.batchBackButton, t('pdfExport.batch.back')) as HTMLButtonElement
      back.addEventListener('click', () => {
        this.options.postMessage({ kind: 'pdfExportModal.batch.cancel' })
      })
      actions.appendChild(back)
    }
    side.appendChild(actions)

    this.statusEl = el('div', CLASS.status)
    this.statusEl.setAttribute('role', 'status')
    this.statusDetailEl = el('div', CLASS.statusDetail)
    this.statusEl.appendChild(this.statusDetailEl)
    side.appendChild(this.statusEl)
    this.statusDetailEl.textContent = this.mergeStatusText(batch)

    root.appendChild(side)
    parent.appendChild(root)
    this.reportPaint()
  }

  /** 合并在途进度区（capturing 逐篇固定输入 / running 单会话生成 / saving
   *  保存对话框与写盘——按实际阶段与篇计数呈现，不编造整体百分比） */
  private buildMergeProgress(batch: Extract<NonNullable<PdfExportModalStateMessage['batch']>, { mode: 'merge' }>): HTMLElement {
    const wrap = el('div', CLASS.previewPlaceholder)
    wrap.classList.add(CLASS.batchList)
    const label = batch.phase === 'capturing'
      ? t('pdfExport.merge.progress', {
        current: String(Math.min(batch.currentIndex + 1, batch.total)),
        total: String(batch.total),
        name: batch.currentName ?? '',
      })
      : batch.phase === 'saving'
        ? t('pdfExport.phase.saving')
        : t('pdfExport.merge.generating')
    wrap.appendChild(el('h2', CLASS.batchSectionTitle, label))
    return wrap
  }

  /** 合并终态区（done 保存路径与书签提示 / failed 失败分态与篇名 /
   *  cancelled 取消——不伪装成功） */
  private buildMergeOutcome(batch: Extract<NonNullable<PdfExportModalStateMessage['batch']>, { mode: 'merge' }>): HTMLElement {
    const wrap = el('div', CLASS.previewPlaceholder)
    wrap.classList.add(CLASS.batchList)
    wrap.appendChild(el('h2', CLASS.batchSectionTitle, this.mergeStatusText(batch)))
    const detail = el('p', CLASS.mergeOutcome)
    if (batch.phase === 'done' && batch.savedPath !== undefined) {
      detail.textContent = t('pdfExport.savedTo', { path: batch.savedPath })
    } else if (batch.phase === 'failed') {
      detail.textContent = batch.failReason === 'capture-failed' && batch.currentName
        ? t('pdfExport.merge.captureFailedNotice', { name: batch.currentName })
        : t(FAIL_REASON_KEYS[batch.failReason ?? 'internal'] ?? 'pdfExport.fail.internal')
    } else {
      detail.textContent = t('pdfExport.phase.cancelled')
    }
    this.mergeOutcomeEl = detail
    wrap.appendChild(detail)
    return wrap
  }

  private mergeStatusText(batch: Extract<NonNullable<PdfExportModalStateMessage['batch']>, { mode: 'merge' }>): string {
    if (batch.phase === 'editing') return t('pdfExport.phase.idle')
    if (batch.phase === 'capturing') {
      return t('pdfExport.merge.progress', {
        current: String(Math.min(batch.currentIndex + 1, batch.total)),
        total: String(batch.total),
        name: batch.currentName ?? '',
      })
    }
    if (batch.phase === 'running') return t('pdfExport.merge.generating')
    if (batch.phase === 'saving') return t('pdfExport.phase.saving')
    if (batch.phase === 'awaiting-resources') return t('pdfExport.batch.awaitingResources')
    if (batch.phase === 'done') return t('pdfExport.phase.done')
    if (batch.phase === 'cancelled') return t('pdfExport.phase.cancelled')
    if (batch.phase === 'failed' && batch.failReason) {
      const key = FAIL_REASON_KEYS[batch.failReason] ?? 'pdfExport.fail.internal'
      return `${t('pdfExport.phase.failed')} ${t(key)}`
    }
    return t('pdfExport.phase.failed')
  }

  /** 可编辑清单（顺序即执行/合篇顺序；增删调序经消息上行——宿主为清单
   *  权威；标题与空态词条由模式传入——批量/合并各自文案） */
  private buildBatchList(
    batch: NonNullable<PdfExportModalStateMessage['batch']>,
    running: boolean,
    titleKey: 'pdfExport.batch.listTitle' | 'pdfExport.merge.listTitle',
    emptyKey: 'pdfExport.batch.empty' | 'pdfExport.merge.empty',
  ): HTMLElement {
    const wrap = el('div', CLASS.previewPlaceholder)
    wrap.classList.add(CLASS.batchList)
    wrap.appendChild(el('h2', CLASS.batchSectionTitle, t(titleKey)))
    if (batch.items.length === 0) {
      wrap.appendChild(el('p', CLASS.batchEmpty, t(emptyKey)))
      return wrap
    }
    const list = el('ul', CLASS.batchList)
    batch.items.forEach((item, index) => {
      const row = el('li', CLASS.batchItem)
      row.appendChild(el('span', CLASS.batchItemOrder, String(index + 1)))
      const main = el('div', CLASS.batchItemMain)
      main.appendChild(el('span', CLASS.batchItemRel, item.relPath))
      main.appendChild(el('span', CLASS.batchItemRoot, item.rootFsPath))
      row.appendChild(main)
      const actions = el('div', CLASS.batchItemActions)
      for (const [label, kind] of [
        [t('pdfExport.batch.itemMoveUp'), 'up'],
        [t('pdfExport.batch.itemMoveDown'), 'down'],
      ] as const) {
        const btn = el('button', CLASS.batchItemBtn, label) as HTMLButtonElement
        btn.disabled = running
        btn.addEventListener('click', () => {
          this.options.postMessage({ kind: 'pdfExportModal.batch.move', id: item.id, direction: kind })
        })
        actions.appendChild(btn)
      }
      const remove = el('button', CLASS.batchItemBtn, t('pdfExport.batch.itemRemove')) as HTMLButtonElement
      remove.disabled = running
      remove.addEventListener('click', () => {
        this.options.postMessage({ kind: 'pdfExportModal.batch.remove', id: item.id })
      })
      actions.appendChild(remove)
      row.appendChild(actions)
      list.appendChild(row)
    })
    wrap.appendChild(list)
    return wrap
  }

  /** 映射预览（真实输出路径 + 冲突标注）与重名策略选择 */
  private buildBatchConfirm(batch: Extract<NonNullable<PdfExportModalStateMessage['batch']>, { mode: 'batch' }>): HTMLElement {
    const wrap = el('div', CLASS.previewPlaceholder)
    wrap.classList.add(CLASS.batchList)
    wrap.appendChild(el('h2', CLASS.batchSectionTitle, t('pdfExport.batch.confirmTitle')))
    if (batch.targetDir !== undefined) {
      const target = el('div', CLASS.batchTarget)
      target.appendChild(el('span', CLASS.docLabel, t('pdfExport.batch.confirmTarget')))
      target.appendChild(el('span', CLASS.docName, batch.targetDir))
      wrap.appendChild(target)
    }
    const strategy = el('select', CLASS.select) as HTMLSelectElement
    for (const value of ['skip', 'overwrite', 'rename'] as const) {
      const option = el('option', '', t(`pdfExport.batch.strategy.${value}`))
      option.value = value
      strategy.appendChild(option)
    }
    strategy.value = batch.strategy
    strategy.addEventListener('change', () => {
      this.options.postMessage({ kind: 'pdfExportModal.batch.setStrategy', strategy: strategy.value as PdfBatchConflictStrategy })
    })
    wrap.appendChild(this.field(t('pdfExport.batch.strategy.label'), strategy))
    const table = el('table', CLASS.batchTable)
    const head = el('thead', '')
    const headRow = el('tr', '')
    for (const label of [t('pdfExport.batch.listTitle'), t('pdfExport.batch.confirmTitle')]) {
      headRow.appendChild(el('th', '', label))
    }
    head.appendChild(headRow)
    table.appendChild(head)
    const body = el('tbody', '')
    for (const entry of batch.mapping ?? []) {
      const row = el('tr', '')
      row.appendChild(el('td', CLASS.batchItemRel, entry.fsPath.split('/').pop() ?? entry.fsPath))
      const targetCell = el('td', CLASS.batchItemRoot, entry.targetPath)
      row.appendChild(targetCell)
      const markCell = el('td', '')
      if (entry.action === 'skip') {
        markCell.appendChild(el('span', CLASS.batchSkipBadge, t('pdfExport.batch.skipMark')))
      } else if (entry.renamed) {
        markCell.appendChild(el('span', CLASS.batchSkipBadge, t('pdfExport.batch.renamedMark')))
      }
      if (entry.conflict !== 'none') {
        markCell.appendChild(el('span', CLASS.batchConflictBadge, t(`pdfExport.batch.conflict.${entry.conflict}`)))
      }
      row.appendChild(markCell)
      body.appendChild(row)
    }
    table.appendChild(body)
    wrap.appendChild(table)
    return wrap
  }

  /** 结果表（成功/失败/跳过/取消 + 真实输出路径；失败分态经 T01 词条映射）。
   *  终态阶段（done/cancelled/failed）的失败行附单项重试入口（双轴评审 P3
   *  ——规格 §2.5「失败项可据清单重新发起」；参数取当前控件值随消息上行） */
  private buildBatchResults(batch: Extract<NonNullable<PdfExportModalStateMessage['batch']>, { mode: 'batch' }>): HTMLElement {
    const wrap = el('div', CLASS.previewPlaceholder)
    wrap.classList.add(CLASS.batchList)
    wrap.appendChild(el('h2', CLASS.batchSectionTitle, t('pdfExport.batch.resultsTitle')))
    const counts = { total: batch.results.length, success: 0, failed: 0, skipped: 0, cancelled: 0 }
    for (const entry of batch.results) counts[entry.status]++
    wrap.appendChild(el('p', CLASS.batchSummary, t('pdfExport.batch.summary', {
      success: String(counts.success),
      failed: String(counts.failed),
      skipped: String(counts.skipped),
      cancelled: String(counts.cancelled),
      total: String(counts.total),
    })))
    const retryable = batch.phase === 'done' || batch.phase === 'cancelled' || batch.phase === 'failed'
    const table = el('table', CLASS.batchTable)
    const body = el('tbody', '')
    for (const entry of batch.results) {
      const row = el('tr', '')
      row.appendChild(el('td', CLASS.batchItemRel, entry.docName))
      const statusKey = entry.status === 'failed' && entry.failReason === 'capture-failed'
        ? 'pdfExport.batch.captureFailed'
        : `pdfExport.batch.status.${entry.status}`
      const statusCell = el('td', '', t(statusKey))
      row.appendChild(statusCell)
      const pathCell = el('td', CLASS.batchItemRoot, entry.targetPath ?? (entry.failReason ? t(FAIL_REASON_KEYS[entry.failReason] ?? 'pdfExport.fail.internal') : ''))
      row.appendChild(pathCell)
      if (retryable && entry.status === 'failed') {
        const actionCell = el('td', '')
        const retry = el('button', CLASS.batchRetryButton, t('pdfExport.batch.retryItem')) as HTMLButtonElement
        retry.addEventListener('click', () => {
          this.paramsTouched = true
          this.readControlsIntoParams()
          this.currentParams = normalizePdfExportOptions(this.currentParams)
          this.options.postMessage({ kind: 'pdfExportModal.batch.retryItem', id: entry.id, params: this.currentParams })
        })
        actionCell.appendChild(retry)
        row.appendChild(actionCell)
      }
      body.appendChild(row)
    }
    table.appendChild(body)
    wrap.appendChild(table)
    return wrap
  }

  /** 批量缺资源清单（当前文件）+ 继续/继续全部/取消（T02 缺资源语义） */
  private buildBatchIssues(batch: NonNullable<PdfExportModalStateMessage['batch']>): HTMLElement {
    const issues = el('div', CLASS.issues)
    issues.appendChild(el('div', CLASS.issuesTitle, t('pdfExport.batch.awaitingResources')))
    const list = el('ul', CLASS.issuesList)
    for (const issue of batch.resourceIssues ?? []) {
      const item = el('li', CLASS.issueItem)
      const kindText = t(ISSUE_KIND_KEYS[issue.kind] ?? 'pdfExport.issues.kind.unknown')
      const reasonText = t(ISSUE_REASON_KEYS[issue.reason] ?? 'pdfExport.issues.reason.unknown')
      item.textContent = `${kindText} · ${issue.item} · ${reasonText}`
      list.appendChild(item)
    }
    issues.appendChild(list)
    const actions = el('div', CLASS.batchAddRow)
    const resume = el('button', CLASS.resumeButton, t('pdfExport.resume')) as HTMLButtonElement
    resume.addEventListener('click', () => {
      this.options.postMessage({ kind: 'pdfExportModal.batch.resume', all: false })
    })
    actions.appendChild(resume)
    const resumeAll = el('button', CLASS.batchResumeAllButton, t('pdfExport.batch.resumeAll')) as HTMLButtonElement
    // #300 悬停提示唯一承载 data-tooltip（原生 title 已退役，防回潮扫描拦截）
    resumeAll.setAttribute('data-tooltip', t('pdfExport.batch.resumeAllHint'))
    resumeAll.addEventListener('click', () => {
      this.options.postMessage({ kind: 'pdfExportModal.batch.resume', all: true })
    })
    actions.appendChild(resumeAll)
    issues.appendChild(actions)
    return issues
  }

  private batchStatusText(batch: NonNullable<PdfExportModalStateMessage['batch']>): string {
    if (batch.phase === 'running') {
      return t('pdfExport.batch.progress', {
        current: String(Math.min(batch.currentIndex + 1, batch.total)),
        total: String(batch.total),
        name: batch.currentName ?? '',
      })
    }
    if (batch.phase === 'awaiting-resources') {
      return t('pdfExport.batch.awaitingResources')
    }
    if (batch.phase === 'failed' && batch.failReason) {
      const key = FAIL_REASON_KEYS[batch.failReason] ?? 'pdfExport.fail.internal'
      return `${t('pdfExport.phase.failed')} ${t(key)}`
    }
    if (batch.phase === 'cancelled') {
      return t('pdfExport.phase.cancelled')
    }
    if (batch.phase === 'done') {
      return t('pdfExport.phase.done')
    }
    return t('pdfExport.phase.idle')
  }

  /** 绘制层探针（测试钩子门控）：控件可见性与计算样式摘要——可见性断言
   *  落「用户看到的东西」（offsetParent 命中 + 计算样式非空），样式注入
   *  失效时（offsetParent 为 null / display:none）探针如实可见。 */
  private reportPaint(): void {
    if (!(globalThis as { __vsidianTestHooks?: boolean }).__vsidianTestHooks) return
    const probe = (node: HTMLElement | null): { visible: boolean; display: string; color: string } | null => {
      if (!node) return null
      const computed = window.getComputedStyle(node)
      return {
        visible: node.offsetParent !== null,
        display: computed.display,
        color: computed.color,
      }
    }
    this.options.postMessage({
      kind: '_test.pdfExportModal.report',
      paint: {
        docNameText: this.docNameEl?.textContent ?? '',
        paperSelect: probe(this.paperSelect),
        orientationSelect: probe(this.orientationSelect),
        marginInput: probe(this.marginInput),
        customWidthInput: probe(this.customWidthInput),
        customHeightInput: probe(this.customHeightInput),
        scaleRange: probe(this.scaleRange),
        headerCheck: probe(this.headerCheck),
        headerTitleCheck: probe(this.headerTitleCheck),
        headerDateCheck: probe(this.headerDateCheck),
        pageNumberCheck: probe(this.pageNumberCheck),
        pageNumberPositionSelect: probe(this.pageNumberPositionSelect),
        bookmarksCheck: probe(this.bookmarksCheck),
        headerChecked: this.headerCheck?.checked ?? null,
        pageNumberChecked: this.pageNumberCheck?.checked ?? null,
        bookmarksChecked: this.bookmarksCheck?.checked ?? null,
        paperValue: this.paperSelect?.value ?? '',
        pageNumberPositionValue: this.pageNumberPositionSelect?.value ?? null,
        bookmarkNoticeText: document.querySelector(`.${CLASS.bookmarkNotice}`)?.textContent ?? '',
        runButton: probe(this.runButton),
        runButtonDisabled: this.runButton?.disabled ?? null,
        cancelButtonHidden: this.cancelButton?.hidden ?? null,
        statusText: this.statusDetailEl?.textContent ?? '',
        status: probe(this.statusEl),
        // T02（#622）缺资源面观测：列表条目文本与继续按钮绘制层状态
        issueItems: Array.from(document.querySelectorAll(`.${CLASS.issueItem}`)).map((li) => li.textContent ?? ''),
        resumeButton: probe(document.querySelector<HTMLElement>(`.${CLASS.resumeButton}`)),
        // T04（#624）批量面观测：清单条目文本/按钮可见性/映射行/结果行——
        // 断言「用户看到的东西」（列表行文本与可见性，非 DOM 存在性）
        batchItemRels: Array.from(document.querySelectorAll(`.${CLASS.batchItemRel}`)).map((n) => n.textContent ?? ''),
        batchAddButtons: Array.from(document.querySelectorAll(`.${CLASS.batchAddButton}`)).map((n) => probe(n as HTMLElement)),
        batchRunButton: probe(document.querySelector<HTMLElement>(`.${CLASS.batchRunButton}`)),
        batchStartButton: probe(document.querySelector<HTMLElement>(`.${CLASS.batchStartButton}`)),
        batchBackButton: probe(document.querySelector<HTMLElement>(`.${CLASS.batchBackButton}`)),
        batchResumeAllButton: probe(document.querySelector<HTMLElement>(`.${CLASS.batchResumeAllButton}`)),
        batchSummaryText: document.querySelector(`.${CLASS.batchSummary}`)?.textContent ?? '',
        // 双轴评审 P3：失败行重试按钮绘制层状态（可见性 + 文本——终态才在场）
        batchRetryButtons: Array.from(document.querySelectorAll(`.${CLASS.batchRetryButton}`)).map((n) => ({
          visible: (n as HTMLElement).offsetParent !== null,
          text: (n.textContent ?? ''),
        })),
        // T06（#626）合并面观测：合并按钮/每篇另起一页开关/终态文本
        mergeRunButton: probe(this.mergeRunButtonEl),
        mergeRunButtonDisabled: this.mergeRunButtonEl?.disabled ?? null,
        mergePageBreakCheck: probe(this.mergePageBreakCheckEl),
        mergePageBreakChecked: this.mergePageBreakCheckEl?.checked ?? null,
        mergeOutcomeText: this.mergeOutcomeEl?.textContent ?? '',
        // T07（#627）预览面观测：刷新按钮/过期徽章绘制层状态 + PdfHoverView
        // 探针（页数/有界挂载/画布字节/非白像素比——实际 PDF 页面证据，
        // 非 DOM 存在性）+ Blob URL 存活计数（释放配对）
        previewRefreshButton: probe(document.querySelector<HTMLElement>(`.${CLASS.previewRefresh}`)),
        previewRefreshDisabled: (document.querySelector(`.${CLASS.previewRefresh}`) as HTMLButtonElement | null)?.disabled ?? null,
        previewStale: this.computePreviewStale(),
        previewStaleBadge: probe(document.querySelector<HTMLElement>(`.${CLASS.previewStaleBadge}`)),
        previewStaleBadgeText: document.querySelector(`.${CLASS.previewStaleBadge}`)?.textContent ?? '',
        previewNoticeText: document.querySelector(`.${CLASS.previewNotice}`)?.textContent ?? '',
        previewEmptyDescription: document.querySelector(`.${CLASS.previewDescription}`)?.textContent ?? '',
        previewBatchSelect: probe(document.querySelector<HTMLElement>(`.${CLASS.previewBar} .${CLASS.select}`)),
        previewBatchSelectValue: (document.querySelector(`.${CLASS.previewBar} .${CLASS.select}`) as HTMLSelectElement | null)?.value ?? '',
        // 验收修复轮：缩放条/加载骨架/纸面宽变量的绘制层观测
        previewZoomBar: probe(document.querySelector<HTMLElement>(`.${CLASS.zoomBar}`)),
        previewZoomValueText: this.zoomValueEl?.textContent ?? '',
        previewZoomButtons: [this.zoomOutEl, this.zoomInEl].map((node) => probe(node)),
        previewSkeleton: probe(document.querySelector<HTMLElement>(`.${CLASS.previewSkeleton}`)),
        previewPrintWidth: (() => {
          const root = document.querySelector<HTMLElement>(`.${CLASS.root}`)
          return root?.style.getPropertyValue('--vsidian-pdfexport-print-width') ?? ''
        })(),
        previewArtifactGeneration: this.previewArtifactGen,
        previewBlobUrlsAlive: this.previewBlobUrlsAlive,
        // 诊断观测：滚动区几何与 DOM 画布在场数（canvas 计数对绘制层探针
        // 的补充——集成失败排查用，非用户可见面）
        previewScrollBox: this.previewScrollEl !== null
          ? `${this.previewScrollEl.clientWidth}x${this.previewScrollEl.clientHeight}`
          : '',
        previewPageSlots: Array.from(
          document.querySelectorAll(`.${CLASS.previewScroll} .vsidian-hover-pdf-page`),
        ).map((node) => `${(node as HTMLElement).dataset['page'] ?? '?'}:${node.querySelector('canvas') !== null ? 'c' : '-'}`),
        previewCanvasCount: document.querySelectorAll(`.${CLASS.previewScroll} canvas`).length,
        previewFirstCanvasSize: (() => {
          const canvas = document.querySelector(`.${CLASS.previewScroll} canvas`) as HTMLCanvasElement | null
          return canvas !== null ? `${canvas.width}x${canvas.height}` : ''
        })(),
        previewFirstCanvasCssWidth: (() => {
          const canvas = document.querySelector(`.${CLASS.previewScroll} canvas`) as HTMLCanvasElement | null
          const width = canvas !== null ? Number.parseFloat(canvas.style.width) : Number.NaN
          return Number.isFinite(width) ? width : 0
        })(),
        previewPdf: this.previewView !== null && this.previewArtifactUrl !== ''
          ? this.previewPdfProbeOf(this.previewView.probe())
          : null,
      },
    })
  }

  /** PdfHoverView 探针的观测子集（集成断言面：页数/挂载有界/画布费用/非白比） */
  private previewPdfProbeOf(p: PdfRenderProbe): {
    phase: PdfRenderProbe['phase']
    page: number
    totalPages: number
    mountedPages: number
    canvasBytes: number
    nonWhiteRatio: number
    canvasWidth: number
    canvasHeight: number
    zoom: number
    scrollHeight: number
    scrollTop: number
    textLayerPages: number
  } {
    return {
      phase: p.phase,
      page: p.page,
      totalPages: p.totalPages,
      mountedPages: p.mountedPages,
      canvasBytes: p.canvasBytes,
      nonWhiteRatio: p.nonWhiteRatio,
      canvasWidth: p.canvasWidth,
      canvasHeight: p.canvasHeight,
      zoom: p.zoom,
      scrollHeight: p.scrollHeight,
      scrollTop: p.scrollTop,
      textLayerPages: p.textLayerPages,
    }
  }
}
