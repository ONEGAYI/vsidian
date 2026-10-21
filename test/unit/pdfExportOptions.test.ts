// T01（#621）PDF 导出参数模型单元测试：默认值、校验收敛、printToPDF
// 换算与 @page 一致性（V01 探针 §6 矩阵的钉住面）。
import { describe, expect, it } from 'vitest'
import {
  PDF_EXPORT_OPTIONS_DEFAULTS,
  PDF_PAPER_SIZES,
  cssAtPageRuleOf,
  normalizePdfExportOptions,
  orientedPageSize,
  printToPdfParamsOf,
} from '../../src/shared/pdfExportOptions'

describe('PDF 导出参数模型', () => {
  it('默认值：A4 纵向 20mm 边距 100% 缩放', () => {
    expect(PDF_EXPORT_OPTIONS_DEFAULTS).toEqual({
      paper: 'a4',
      orientation: 'portrait',
      marginMm: 20,
      scale: 1,
    })
  })

  it('normalize：非法字段回落默认、合法字段保留', () => {
    expect(normalizePdfExportOptions({
      paper: 'letter',
      orientation: 'landscape',
      marginMm: 12,
      scale: 0.8,
    })).toEqual({ paper: 'letter', orientation: 'landscape', marginMm: 12, scale: 0.8 })
    expect(normalizePdfExportOptions({ paper: 'b6', orientation: 'diagonal', marginMm: 'x', scale: null }))
      .toEqual(PDF_EXPORT_OPTIONS_DEFAULTS)
    expect(normalizePdfExportOptions(undefined)).toEqual(PDF_EXPORT_OPTIONS_DEFAULTS)
    expect(normalizePdfExportOptions('junk')).toEqual(PDF_EXPORT_OPTIONS_DEFAULTS)
  })

  it('normalize：边距夹在 0–50mm 取整、缩放夹在 0.1–2 保留两位', () => {
    expect(normalizePdfExportOptions({ marginMm: -5 }).marginMm).toBe(0)
    expect(normalizePdfExportOptions({ marginMm: 999 }).marginMm).toBe(50)
    expect(normalizePdfExportOptions({ marginMm: 12.6 }).marginMm).toBe(13)
    expect(normalizePdfExportOptions({ scale: 0 }).scale).toBe(0.1)
    expect(normalizePdfExportOptions({ scale: 5 }).scale).toBe(2)
    expect(normalizePdfExportOptions({ scale: 0.755 }).scale).toBe(0.76)
  })

  it('normalize：自定义 defaults 基准生效', () => {
    const base = { ...PDF_EXPORT_OPTIONS_DEFAULTS, paper: 'a5' as const, marginMm: 8 }
    expect(normalizePdfExportOptions({ scale: 1.5 }, base))
      .toEqual({ paper: 'a5', orientation: 'portrait', marginMm: 8, scale: 1.5 })
  })

  it('换算：A4 纵向 printToPDF 参数（V01 §6 实测口径——数字英寸）', () => {
    const params = printToPdfParamsOf({ paper: 'a4', orientation: 'portrait', marginMm: 20, scale: 1 })
    expect(params.paperWidth).toBe(8.27)
    expect(params.paperHeight).toBe(11.69)
    expect(params.landscape).toBe(false)
    expect(params.scale).toBe(1)
    expect(params.printBackground).toBe(true)
    expect(params.preferCSSPageSize).toBe(false)
    // 20mm ≈ 0.79in（四边统一；CDP 参数为数字英寸，字符串形态被拒）
    expect(params.marginTop).toBeCloseTo(20 / 25.4, 2)
    expect(params.marginLeft).toBe(params.marginTop)
    expect(params.marginRight).toBe(params.marginTop)
    expect(params.marginBottom).toBe(params.marginTop)
  })

  it('换算：landscape 互换宽高且 orientedPageSize 与参数一致', () => {
    const options = { paper: 'a4' as const, orientation: 'landscape' as const, marginMm: 10, scale: 1 }
    const params = printToPdfParamsOf(options)
    expect(params.paperWidth).toBe(11.69)
    expect(params.paperHeight).toBe(8.27)
    expect(params.landscape).toBe(true)
    const size = orientedPageSize(options)
    expect(params.paperWidth).toBe(size.widthIn)
    expect(params.paperHeight).toBe(size.heightIn)
  })

  it('一致性：@page CSS 与 printToPDF 纸张/边距同值（防方向渗透分歧）', () => {
    for (const orientation of ['portrait', 'landscape'] as const) {
      for (const paper of Object.keys(PDF_PAPER_SIZES)) {
        const options = normalizePdfExportOptions({ paper, orientation, marginMm: 18, scale: 1 })
        const css = cssAtPageRuleOf(options)
        const params = printToPdfParamsOf(options)
        expect(css).toContain(`size: ${params.paperWidth}in ${params.paperHeight}in`)
        expect(css).toContain(`margin: ${params.marginTop.toFixed(2)}in`)
      }
    }
  })
})
