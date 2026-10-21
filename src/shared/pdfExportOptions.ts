// PDF 导出参数模型（T01/#621）：模态 webview 与宿主共用的参数形态、
// 校验收敛与 Page.printToPDF 换算的单一事实源。
//
// webview 安全零依赖（不 import node:path 等——沿用 wikilinkInsertMode 的
// 先例：该模块会进 webview bundle）。纸张尺寸取自 V01 探针实测矩阵
//（docs/research/pdf-export-browser-probe.md §6：8.27×11.69in → 595.92×
// 841.92pt），方向渗透坑（§6/§10.5）由装配层剥离用户 @page 规则配合
// preferCSSPageSize:false 承接，本模块只提供一致的两参数换算。
import type { MessageKey } from './locales/en'

export type PdfPaperSizeKind = 'a3' | 'a4' | 'a5' | 'letter' | 'legal'
export type PdfOrientation = 'portrait' | 'landscape'

export interface PdfExportOptions {
  paper: PdfPaperSizeKind
  orientation: PdfOrientation
  /** 四边统一页边距（毫米） */
  marginMm: number
  /** 缩放（printToPDF scale 语义，1 = 100%） */
  scale: number
}

/** 纸张物理尺寸（英寸；V01 探针实测矩阵的输入面）与设置页/模态选项词条 */
export const PDF_PAPER_SIZES: Record<
  PdfPaperSizeKind,
  { widthIn: number; heightIn: number; labelKey: MessageKey }
> = {
  a3: { widthIn: 11.69, heightIn: 16.54, labelKey: 'pdfExport.paper.a3' },
  a4: { widthIn: 8.27, heightIn: 11.69, labelKey: 'pdfExport.paper.a4' },
  a5: { widthIn: 5.83, heightIn: 8.27, labelKey: 'pdfExport.paper.a5' },
  letter: { widthIn: 8.5, heightIn: 11, labelKey: 'pdfExport.paper.letter' },
  legal: { widthIn: 8.5, heightIn: 14, labelKey: 'pdfExport.paper.legal' },
}

export const PDF_PAPER_SIZE_KINDS = Object.keys(PDF_PAPER_SIZES) as readonly PdfPaperSizeKind[]
export const PDF_ORIENTATIONS: readonly PdfOrientation[] = ['portrait', 'landscape']

export const PDF_EXPORT_MARGIN_MM_MIN = 0
export const PDF_EXPORT_MARGIN_MM_MAX = 50
export const PDF_EXPORT_SCALE_MIN = 0.1
export const PDF_EXPORT_SCALE_MAX = 2

export const PDF_EXPORT_OPTIONS_DEFAULTS: Readonly<PdfExportOptions> = {
  paper: 'a4',
  orientation: 'portrait',
  marginMm: 20,
  scale: 1,
}

const MM_PER_IN = 25.4

export function isPdfPaperSizeKind(value: unknown): value is PdfPaperSizeKind {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PDF_PAPER_SIZES, value)
}

export function isPdfOrientation(value: unknown): value is PdfOrientation {
  return value === 'portrait' || value === 'landscape'
}

/** 校验并收敛为合法参数：字段缺失/非法回落 defaults 同名字段；边距取整
 *  毫米并夹在 [0,50]；缩放保留两位小数并夹在 [0.1,2]。 */
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
  return {
    paper: isPdfPaperSizeKind(raw.paper) ? raw.paper : defaults.paper,
    orientation: isPdfOrientation(raw.orientation) ? raw.orientation : defaults.orientation,
    marginMm: Math.min(PDF_EXPORT_MARGIN_MM_MAX, Math.max(PDF_EXPORT_MARGIN_MM_MIN, Math.round(margin))),
    scale: Math.round(
      Math.min(PDF_EXPORT_SCALE_MAX, Math.max(PDF_EXPORT_SCALE_MIN, scale)) * 100,
    ) / 100,
  }
}

/** 方向化纸张尺寸（landscape 互换宽高）——@page CSS 与 printToPDF 参数
 *  共用，保证两侧永不分歧（V01 §6：landscape 由 printToPDF 参数生效） */
export function orientedPageSize(options: PdfExportOptions): { widthIn: number; heightIn: number } {
  const size = PDF_PAPER_SIZES[options.paper]
  return options.orientation === 'landscape'
    ? { widthIn: size.heightIn, heightIn: size.widthIn }
    : { widthIn: size.widthIn, heightIn: size.heightIn }
}

/** 页面内 @page 声明（与 printToPDF 参数逐字段一致：显式尺寸对 + 边距） */
export function cssAtPageRuleOf(options: PdfExportOptions): string {
  const size = orientedPageSize(options)
  const marginIn = (options.marginMm / MM_PER_IN).toFixed(2)
  return `@page { size: ${size.widthIn}in ${size.heightIn}in; margin: ${marginIn}in }`
}

/** Page.printToPDF 参数（V01 §6 矩阵：printBackground 默认开——阅读样式
 *  背景需要；preferCSSPageSize:false——纸张分页样式由导出装配单独负责；
 *  纸张/边距为数字英寸——CDP 协议定义 number，字符串 '8.27in' 形态会被
 *  -32602 Invalid parameters 拒绝，探针实测口径即数字） */
export function printToPdfParamsOf(options: PdfExportOptions): {
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
} {
  const size = orientedPageSize(options)
  const marginIn = Math.round((options.marginMm / MM_PER_IN) * 100) / 100
  return {
    landscape: options.orientation === 'landscape',
    paperWidth: size.widthIn,
    paperHeight: size.heightIn,
    marginTop: marginIn,
    marginBottom: marginIn,
    marginLeft: marginIn,
    marginRight: marginIn,
    scale: options.scale,
    printBackground: true,
    preferCSSPageSize: false,
  }
}
