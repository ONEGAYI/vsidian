// PDF 导出参数模型（T01/#621 建立；T05/#625 扩展页眉页脚/页码/书签与
// 纸张预设补全）：模态 webview 与宿主共用的参数形态、校验收敛与
// Page.printToPDF 换算的单一事实源。
//
// webview 安全零依赖（不 import node:path 等——沿用 wikilinkInsertMode 的
// 先例：该模块会进 webview bundle）。纸张尺寸取自 V01 探针实测矩阵
//（docs/research/pdf-export-browser-probe.md §6：8.27×11.69in → 595.92×
// 841.92pt），方向渗透坑（§6/§10.5）由装配层剥离用户 @page 规则配合
// preferCSSPageSize:false 承接，本模块只提供一致的两参数换算。
//
// T05 语义（V01 §6 页眉页脚实测）：
// - displayHeaderFooter 开启时 header/footer 渲染区在页边距内——上下边距
//   不足会与正文争抢空间，归一换算统一抬到下限（探针实测用 1in 留足，
//   Chrome 打印默认 0.4in 边距即可承载页眉页脚，产品取 12mm≈0.47in 留余量）；
// - headerTemplate/footerTemplate 只认 inline 样式且字号需显式（探针 9px）；
// - Chromium 的 pageNumber/totalPages 原生 class 负责页码替换；
// - 开关关闭时必须显式给抑制模板（`<span></span>`）——displayHeaderFooter
//   下缺省模板是 Chromium 默认页眉（含文档 URL，不得漏出到产物）。
import type { MessageKey } from './locales/en'

export type PdfPaperSizeKind = 'a3' | 'a4' | 'a5' | 'b5' | 'letter' | 'legal' | 'custom'
export type PdfOrientation = 'portrait' | 'landscape'
/** 页码在页脚内的对齐位置（Chromium 模板容器为 flex，经 margin 推移） */
export type PdfPageNumberPosition = 'footer-left' | 'footer-center' | 'footer-right'
/** 导出主题：follow = 跟随当前编辑器主题；light / dark = 强制亮/暗。
 *  **只影响预览与最终产物**，不改变编辑器自身主题（用户可在模态里对照
 *  两种观感，不必先切编辑器主题）。 */
export type PdfThemeMode = 'follow' | 'light' | 'dark'
export const PDF_THEME_MODES: readonly PdfThemeMode[] = ['follow', 'light', 'dark']

export interface PdfExportOptions {
  paper: PdfPaperSizeKind
  /** 自定义纸张宽（毫米；paper === 'custom' 时参与换算，否则仅存参数） */
  customWidthMm: number
  /** 自定义纸张高（毫米；方向为 landscape 时与宽互换） */
  customHeightMm: number
  orientation: PdfOrientation
  /** 四边基础页边距（毫米；页眉页脚开启时上下边距按下限抬升） */
  marginMm: number
  /** 缩放（printToPDF scale 语义，1 = 100%） */
  scale: number
  /** 页眉开关（默认关——T01/T02 既有产物形态不变） */
  headerEnabled: boolean
  /** 页眉含文档标题（页眉开启时的内容项；默认开） */
  headerTitle: boolean
  /** 页眉含导出日期（默认关） */
  headerDate: boolean
  /** 页码开关（默认关） */
  pageNumberEnabled: boolean
  /** 页码在页脚内的对齐位置 */
  pageNumberPosition: PdfPageNumberPosition
  /** 标题书签开关（默认关——书签经 pdf-lib 后处理写入） */
  bookmarksEnabled: boolean
  /** 导出主题（默认跟随编辑器；强制亮/暗只作用于预览与产物） */
  theme: PdfThemeMode
}

/** 纸张物理尺寸（英寸；V01 探针实测矩阵的输入面）与设置页/模态选项词条。
 *  custom 不在此表（无固定物理尺寸——select 选项清单经
 *  PDF_PAPER_SIZE_KINDS 单独枚举）。 */
export const PDF_PAPER_SIZES: Record<
  Exclude<PdfPaperSizeKind, 'custom'>,
  { widthIn: number; heightIn: number; labelKey: MessageKey }
> = {
  a3: { widthIn: 11.69, heightIn: 16.54, labelKey: 'pdfExport.paper.a3' },
  a4: { widthIn: 8.27, heightIn: 11.69, labelKey: 'pdfExport.paper.a4' },
  a5: { widthIn: 5.83, heightIn: 8.27, labelKey: 'pdfExport.paper.a5' },
  b5: { widthIn: 6.93, heightIn: 9.84, labelKey: 'pdfExport.paper.b5' },
  letter: { widthIn: 8.5, heightIn: 11, labelKey: 'pdfExport.paper.letter' },
  legal: { widthIn: 8.5, heightIn: 14, labelKey: 'pdfExport.paper.legal' },
}

/** select 选项清单（预设 + custom；顺序即呈现序） */
export const PDF_PAPER_SIZE_KINDS: readonly PdfPaperSizeKind[] = [
  'a3', 'a4', 'a5', 'b5', 'letter', 'legal', 'custom',
]
export const PDF_ORIENTATIONS: readonly PdfOrientation[] = ['portrait', 'landscape']
export const PDF_PAGE_NUMBER_POSITIONS: readonly PdfPageNumberPosition[] = [
  'footer-left', 'footer-center', 'footer-right',
]

/** 页码位置 → 词条键（i18n 点分键不允许连字符——枚举值与词条键解耦） */
export const PDF_PAGE_NUMBER_POSITION_LABEL_KEYS: Record<
  PdfPageNumberPosition,
  MessageKey
> = {
  'footer-left': 'pdfExport.pageNumber.position.footerLeft',
  'footer-center': 'pdfExport.pageNumber.position.footerCenter',
  'footer-right': 'pdfExport.pageNumber.position.footerRight',
}

/** 导出主题三档词条（跟随编辑器 / 强制亮 / 强制暗） */
export const PDF_THEME_MODE_LABEL_KEYS: Record<PdfThemeMode, MessageKey> = {
  follow: 'pdfExport.theme.follow',
  light: 'pdfExport.theme.light',
  dark: 'pdfExport.theme.dark',
}

export const PDF_EXPORT_MARGIN_MM_MIN = 0
export const PDF_EXPORT_MARGIN_MM_MAX = 50
export const PDF_EXPORT_SCALE_MIN = 0.1
export const PDF_EXPORT_SCALE_MAX = 2
/** 自定义宽高范围（毫米）：Chromium printToPDF paper 参数上限 22in≈558.8mm，
 *  上限取整 558；下限 20mm 防纸张退化不可用（V01 §6 只实测常规尺寸，
 *  边界值属协议约束内推） */
export const PDF_EXPORT_CUSTOM_MM_MIN = 20
export const PDF_EXPORT_CUSTOM_MM_MAX = 558
/** 页眉页脚开启时上下边距下限（毫米）——渲染区在边距内（V01 §6 实测
 *  记录边距须留足；左右边距不受影响） */
export const PDF_EXPORT_HEADER_FOOTER_MARGIN_MIN_MM = 12

export const PDF_EXPORT_OPTIONS_DEFAULTS: Readonly<PdfExportOptions> = {
  paper: 'a4',
  customWidthMm: 210,
  customHeightMm: 297,
  orientation: 'portrait',
  marginMm: 20,
  scale: 1,
  headerEnabled: false,
  headerTitle: true,
  headerDate: false,
  pageNumberEnabled: false,
  pageNumberPosition: 'footer-center',
  bookmarksEnabled: false,
  theme: 'follow',
}

const MM_PER_IN = 25.4

export function isPdfPaperSizeKind(value: unknown): value is PdfPaperSizeKind {
  return typeof value === 'string' && (PDF_PAPER_SIZE_KINDS as readonly string[]).includes(value)
}

export function isPdfOrientation(value: unknown): value is PdfOrientation {
  return value === 'portrait' || value === 'landscape'
}

export function isPdfPageNumberPosition(value: unknown): value is PdfPageNumberPosition {
  return typeof value === 'string' && (PDF_PAGE_NUMBER_POSITIONS as readonly string[]).includes(value)
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function clampedInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** 校验并收敛为合法参数：字段缺失/非法回落 defaults 同名字段；边距取整
 *  毫米并夹在 [0,50]；缩放保留两位小数并夹在 [0.1,2]；自定义宽高取整
 *  毫米并夹在 [20,558]。 */
export function normalizePdfExportOptions(
  input: unknown,
  defaults: Readonly<PdfExportOptions> = PDF_EXPORT_OPTIONS_DEFAULTS,
): PdfExportOptions {
  const raw = (input && typeof input === 'object' ? input : {}) as Partial<Record<keyof PdfExportOptions, unknown>>
  const margin = typeof raw.marginMm === 'number' && Number.isFinite(raw.marginMm)
    ? raw.marginMm
    : defaults.marginMm
  const scale = typeof raw.scale === 'number' && Number.isFinite(raw.scale)
    ? raw.scale
    : defaults.scale
  const customWidth = typeof raw.customWidthMm === 'number' && Number.isFinite(raw.customWidthMm)
    ? raw.customWidthMm
    : defaults.customWidthMm
  const customHeight = typeof raw.customHeightMm === 'number' && Number.isFinite(raw.customHeightMm)
    ? raw.customHeightMm
    : defaults.customHeightMm
  return {
    paper: isPdfPaperSizeKind(raw.paper) ? raw.paper : defaults.paper,
    customWidthMm: clampedInt(customWidth, PDF_EXPORT_CUSTOM_MM_MIN, PDF_EXPORT_CUSTOM_MM_MAX),
    customHeightMm: clampedInt(customHeight, PDF_EXPORT_CUSTOM_MM_MIN, PDF_EXPORT_CUSTOM_MM_MAX),
    orientation: isPdfOrientation(raw.orientation) ? raw.orientation : defaults.orientation,
    marginMm: clampedInt(margin, PDF_EXPORT_MARGIN_MM_MIN, PDF_EXPORT_MARGIN_MM_MAX),
    scale: Math.round(
      Math.min(PDF_EXPORT_SCALE_MAX, Math.max(PDF_EXPORT_SCALE_MIN, scale)) * 100,
    ) / 100,
    headerEnabled: boolOr(raw.headerEnabled, defaults.headerEnabled),
    headerTitle: boolOr(raw.headerTitle, defaults.headerTitle),
    headerDate: boolOr(raw.headerDate, defaults.headerDate),
    pageNumberEnabled: boolOr(raw.pageNumberEnabled, defaults.pageNumberEnabled),
    pageNumberPosition: isPdfPageNumberPosition(raw.pageNumberPosition)
      ? raw.pageNumberPosition
      : defaults.pageNumberPosition,
    bookmarksEnabled: boolOr(raw.bookmarksEnabled, defaults.bookmarksEnabled),
    theme: typeof raw.theme === 'string' && (PDF_THEME_MODES as readonly string[]).includes(raw.theme)
      ? raw.theme as PdfThemeMode
      : defaults.theme,
  }
}

/** 换算后的打印边距（毫米）：页眉页脚开启时上下边距抬到下限（左右不动） */
export function effectiveMarginsMm(options: PdfExportOptions): {
  topMm: number; bottomMm: number; leftMm: number; rightMm: number
} {
  const lift = options.headerEnabled || options.pageNumberEnabled
  const topBottom = lift
    ? Math.max(options.marginMm, PDF_EXPORT_HEADER_FOOTER_MARGIN_MIN_MM)
    : options.marginMm
  return { topMm: topBottom, bottomMm: topBottom, leftMm: options.marginMm, rightMm: options.marginMm }
}

/** 方向化纸张尺寸（landscape 互换宽高；custom 用毫米换算英寸）——@page
 *  CSS 与 printToPDF 参数共用，保证两侧永不分歧（V01 §6：landscape 由
 *  printToPDF 参数生效） */
export function orientedPageSize(options: PdfExportOptions): { widthIn: number; heightIn: number } {
  if (options.paper === 'custom') {
    const widthIn = options.customWidthMm / MM_PER_IN
    const heightIn = options.customHeightMm / MM_PER_IN
    return options.orientation === 'landscape'
      ? { widthIn: heightIn, heightIn: widthIn }
      : { widthIn, heightIn }
  }
  const size = PDF_PAPER_SIZES[options.paper]
  return options.orientation === 'landscape'
    ? { widthIn: size.heightIn, heightIn: size.widthIn }
    : { widthIn: size.widthIn, heightIn: size.heightIn }
}

/** 页面内 @page 声明（与 printToPDF 参数逐字段一致：显式尺寸对 + 边距；
 *  页眉页脚抬升时输出四值 margin，否则维持单值——T01/T02 既有产物形态
 *  不变） */
export function cssAtPageRuleOf(options: PdfExportOptions): string {
  const size = orientedPageSize(options)
  const margin = effectiveMarginsMm(options)
  const topIn = (margin.topMm / MM_PER_IN).toFixed(2)
  const rightIn = (margin.rightMm / MM_PER_IN).toFixed(2)
  const bottomIn = (margin.bottomMm / MM_PER_IN).toFixed(2)
  const leftIn = (margin.leftMm / MM_PER_IN).toFixed(2)
  const marginValue = margin.topMm === margin.leftMm && margin.topMm === margin.bottomMm && margin.topMm === margin.rightMm
    ? `${topIn}in`
    : `${topIn}in ${rightIn}in ${bottomIn}in ${leftIn}in`
  return `@page { size: ${size.widthIn}in ${size.heightIn}in; margin: ${marginValue} }`
}

/** 页眉页脚模板的装配上下文（宿主层填充：标题/日期/明暗/页码词条） */
export interface PdfHeaderFooterContext {
  /** 主文档标题（文件名去扩展名） */
  docTitle: string
  /** 导出日期文本（YYYY-MM-DD） */
  dateText: string
  /** 暗色主题适配（暗背景页眉用浅色字） */
  dark: boolean
  /** 页码词条（i18n）：pre + 页号 + mid + 总页数 + post */
  pageLabel: { pre: string; mid: string; post: string }
}

function escapeHtmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 抑制模板：displayHeaderFooter 下 Chromium 缺省模板含文档 URL——必须
 *  显式空模板抑制（V01 §6 实测后产品口径） */
const SUPPRESS_TEMPLATE = '<span></span>'

/** 页眉模板：inline 样式 + 显式字号（V01 §6）；标题/日期按内容项组合；
 *  关闭或无内容项时为抑制模板。 */
export function buildHeaderTemplate(options: PdfExportOptions, ctx: PdfHeaderFooterContext): string {
  if (!options.headerEnabled || (!options.headerTitle && !options.headerDate)) {
    return SUPPRESS_TEMPLATE
  }
  const color = ctx.dark ? '#bbbbbb' : '#333333'
  const base = `font-size:9px;color:${color};`
  const parts: string[] = []
  if (options.headerTitle) {
    parts.push(`<span style="${base}">${escapeHtmlText(ctx.docTitle)}</span>`)
  }
  if (options.headerDate) {
    parts.push(`<span style="${base}">${escapeHtmlText(ctx.dateText)}</span>`)
  }
  return parts.join('')
}

/** 页脚模板：页码走 Chromium 原生 class（pageNumber/totalPages——页码由
 *  打印引擎替换，无需自算）；位置经 flex 容器 margin 推移（探针实测
 *  margin:0 auto 居中同机制）。关闭时为抑制模板。 */
export function buildFooterTemplate(options: PdfExportOptions, ctx: PdfHeaderFooterContext): string {
  if (!options.pageNumberEnabled) {
    return SUPPRESS_TEMPLATE
  }
  const color = ctx.dark ? '#bbbbbb' : '#333333'
  const position = options.pageNumberPosition === 'footer-right'
    ? 'margin-left:auto;'
    : options.pageNumberPosition === 'footer-center'
      ? 'margin:0 auto;'
      : ''
  const label = ctx.pageLabel
  return `<span style="font-size:9px;color:${color};${position}">${escapeHtmlText(label.pre)}<span class="pageNumber"></span>${escapeHtmlText(label.mid)}<span class="totalPages"></span>${escapeHtmlText(label.post)}</span>`
}

/** displayHeaderFooter（页眉或页码任一开启） */
export function headerFooterActive(options: PdfExportOptions): boolean {
  return options.headerEnabled || options.pageNumberEnabled
}

/** Page.printToPDF 参数（V01 §6 矩阵：printBackground 默认开——阅读样式
 *  背景需要；preferCSSPageSize:false——纸张分页样式由导出装配单独负责；
 *  纸张/边距为数字英寸——CDP 协议定义 number，字符串 '8.27in' 形态会被
 *  -32602 Invalid parameters 拒绝，探针实测口径即数字）。
 *  T05：displayHeaderFooter 激活时附加模板并抬升上下边距；ctx 缺省视为
 *  无页眉页脚（与开关全关一致）。 */
export function printToPdfParamsOf(options: PdfExportOptions, ctx?: PdfHeaderFooterContext): {
  landscape: boolean
  paperWidth: number
  paperHeight: number
  marginTop: number
  marginBottom: number
  marginLeft: number
  marginRight: number
  scale: number
  printBackground: boolean
  preferCSSPageSize: boolean
  displayHeaderFooter?: boolean
  headerTemplate?: string
  footerTemplate?: string
} {
  const size = orientedPageSize(options)
  const marginMm = effectiveMarginsMm(options)
  const roundIn = (mm: number): number => Math.round((mm / MM_PER_IN) * 100) / 100
  const active = ctx !== undefined && headerFooterActive(options)
  return {
    landscape: options.orientation === 'landscape',
    paperWidth: size.widthIn,
    paperHeight: size.heightIn,
    marginTop: roundIn(marginMm.topMm),
    marginBottom: roundIn(marginMm.bottomMm),
    marginLeft: roundIn(marginMm.leftMm),
    marginRight: roundIn(marginMm.rightMm),
    scale: options.scale,
    printBackground: true,
    preferCSSPageSize: false,
    ...(active
      ? {
        displayHeaderFooter: true,
        headerTemplate: buildHeaderTemplate(options, ctx!),
        footerTemplate: buildFooterTemplate(options, ctx!),
      }
      : {}),
  }
}
