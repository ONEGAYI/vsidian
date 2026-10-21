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
  PDF_EXPORT_OPTIONS_DEFAULTS,
  PDF_ORIENTATIONS,
  PDF_PAPER_SIZES,
  PDF_PAPER_SIZE_KINDS,
  type PdfExportOptions,
} from '../shared/pdfExportOptions'

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
  private scaleRange: HTMLInputElement | null = null
  private scaleValue: HTMLElement | null = null
  private runButton: HTMLButtonElement | null = null
  private cancelButton: HTMLButtonElement | null = null
  private statusEl: HTMLElement | null = null
  private statusDetailEl: HTMLElement | null = null
  private openSettingsButton: HTMLButtonElement | null = null
  private docNameEl: HTMLElement | null = null

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
    if (this.scaleRange) {
      const parsed = Number(this.scaleRange.value)
      if (Number.isFinite(parsed)) this.currentParams.scale = parsed
    }
  }

  private render(): void {
    const parent = this.host
    if (!parent) return
    parent.textContent = ''
    const busy = this.state?.phase === 'generating' || this.state?.phase === 'saving' || this.state?.phase === 'awaiting-resources'
    const params = this.currentParams

    const root = el('div', CLASS.root)
    // ---- 主区：预览占位（T07/#627 接线骨架：state.generation 承载代次） ----
    const preview = el('main', CLASS.preview)
    const placeholder = el('div', CLASS.previewPlaceholder)
    placeholder.appendChild(el('h2', CLASS.previewTitle, t('pdfExport.previewPlaceholderTitle')))
    placeholder.appendChild(el('p', CLASS.previewDescription, t('pdfExport.previewPlaceholderDescription')))
    preview.appendChild(placeholder)
    root.appendChild(preview)

    // ---- 侧区：固定输入 + 参数 + 操作 + 状态 ----
    const side = el('aside', CLASS.side)
    const docRow = el('div', CLASS.docRow)
    docRow.appendChild(el('span', CLASS.docLabel, t('pdfExport.docLabel')))
    this.docNameEl = el('span', CLASS.docName, this.state?.docName || '…')
    docRow.appendChild(this.docNameEl)
    side.appendChild(docRow)

    this.paperSelect = el('select', CLASS.select) as HTMLSelectElement
    for (const kind of PDF_PAPER_SIZE_KINDS) {
      const option = el('option', '', t(PDF_PAPER_SIZES[kind].labelKey))
      option.value = kind
      this.paperSelect.appendChild(option)
    }
    this.paperSelect.value = params.paper
    this.paperSelect.addEventListener('change', () => {
      this.paramsTouched = true
      this.readControlsIntoParams()
    })
    side.appendChild(this.field(t('pdfExport.paper.label'), this.paperSelect))

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
    this.scaleValue = el('span', CLASS.rangeValue, `${Math.round(params.scale * 100)}%`)
    rangeWrap.appendChild(this.scaleRange)
    rangeWrap.appendChild(this.scaleValue)
    side.appendChild(this.field(t('pdfExport.scale.label'), rangeWrap))

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
        scaleRange: probe(this.scaleRange),
        runButton: probe(this.runButton),
        runButtonDisabled: this.runButton?.disabled ?? null,
        cancelButtonHidden: this.cancelButton?.hidden ?? null,
        statusText: this.statusDetailEl?.textContent ?? '',
        status: probe(this.statusEl),
        // T02（#622）缺资源面观测：列表条目文本与继续按钮绘制层状态
        issueItems: Array.from(document.querySelectorAll(`.${CLASS.issueItem}`)).map((li) => li.textContent ?? ''),
        resumeButton: probe(document.querySelector<HTMLElement>(`.${CLASS.resumeButton}`)),
      },
    })
  }
}
