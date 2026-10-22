// T01（#621）PDF 导出参数模型单元测试：默认值、校验收敛、printToPDF
// 换算与 @page 一致性（V01 探针 §6 矩阵的钉住面）。
// T05（#625）扩展：页眉页脚/页码/书签参数、纸张预设补全与自定义宽高、
// 模板构造与校验、displayHeaderFooter 边距抬升。
import { describe, expect, it } from 'vitest'
import {
  buildFooterTemplate,
  buildHeaderTemplate,
  cssAtPageRuleOf,
  normalizePdfExportOptions,
  orientedPageSize,
  printToPdfParamsOf,
  PDF_EXPORT_CUSTOM_MM_MAX,
  PDF_EXPORT_CUSTOM_MM_MIN,
  PDF_EXPORT_HEADER_FOOTER_MARGIN_MIN_MM,
  PDF_EXPORT_OPTIONS_DEFAULTS,
  PDF_PAPER_SIZES,
  type PdfHeaderFooterContext,
} from '../../src/shared/pdfExportOptions'

describe('PDF 导出参数模型', () => {
  it('默认值：A4 纵向 20mm 边距 100% 缩放（T05 新参数全关/安全默认——既有产物形态不变）', () => {
    expect(PDF_EXPORT_OPTIONS_DEFAULTS).toEqual({
      paper: 'a4',
      orientation: 'portrait',
      marginMm: 20,
      scale: 1,
      // T05（#625）：页眉/页码/书签默认关（displayHeaderFooter 缺省、无后处理）
      headerEnabled: false,
      headerTitle: true,
      headerDate: false,
      pageNumberEnabled: false,
      pageNumberPosition: 'footer-center',
      bookmarksEnabled: false,
      // 导出主题默认跟随编辑器（只作用于预览与产物）
      theme: 'follow',
      // 自定义宽高回落 A4（paper !== 'custom' 时不参与换算）
      customWidthMm: 210,
      customHeightMm: 297,
    })
  })

  it('normalize：主题只认 follow/light/dark，其余回落默认', () => {
    expect(normalizePdfExportOptions({ theme: 'dark' }).theme).toBe('dark')
    expect(normalizePdfExportOptions({ theme: 'light' }).theme).toBe('light')
    expect(normalizePdfExportOptions({ theme: 'follow' }).theme).toBe('follow')
    expect(normalizePdfExportOptions({ theme: 'sepia' }).theme).toBe('follow')
    expect(normalizePdfExportOptions({ theme: 1 }).theme).toBe('follow')
  })

  it('normalize：非法字段回落默认、合法字段保留', () => {
    expect(normalizePdfExportOptions({
      paper: 'letter',
      orientation: 'landscape',
      marginMm: 12,
      scale: 0.8,
    })).toEqual({ ...PDF_EXPORT_OPTIONS_DEFAULTS, paper: 'letter', orientation: 'landscape', marginMm: 12, scale: 0.8 })
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
      .toEqual({ ...base, scale: 1.5 })
  })

  it('换算：A4 纵向 printToPDF 参数（V01 §6 实测口径——数字英寸）', () => {
    const params = printToPdfParamsOf(normalizePdfExportOptions({ paper: 'a4', orientation: 'portrait', marginMm: 20, scale: 1 }))
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
    const options = normalizePdfExportOptions({ paper: 'a4', orientation: 'landscape', marginMm: 10, scale: 1 })
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

describe('T05（#625）纸张预设与自定义宽高', () => {
  it('预设枚举补全：b5 物理尺寸（ISO B5 176×250mm）与词条', () => {
    expect(PDF_PAPER_SIZES['b5']).toEqual({ widthIn: 6.93, heightIn: 9.84, labelKey: 'pdfExport.paper.b5' })
    expect(normalizePdfExportOptions({ paper: 'b5' }).paper).toBe('b5')
  })

  it('custom：自定义毫米宽高参与换算（方向互换同语义）', () => {
    const options = normalizePdfExportOptions({
      paper: 'custom', customWidthMm: 148, customHeightMm: 100, orientation: 'landscape',
    })
    expect(orientedPageSize(options)).toEqual({ widthIn: 100 / 25.4, heightIn: 148 / 25.4 })
    const params = printToPdfParamsOf(options)
    expect(params.paperWidth).toBeCloseTo(100 / 25.4, 3)
    expect(params.paperHeight).toBeCloseTo(148 / 25.4, 3)
  })

  it('custom：范围夹紧（Chromium paper 上限 22in≈558mm）与非法回落默认', () => {
    expect(PDF_EXPORT_CUSTOM_MM_MIN).toBe(20)
    expect(PDF_EXPORT_CUSTOM_MM_MAX).toBe(558)
    expect(normalizePdfExportOptions({ customWidthMm: 5, customHeightMm: 9999 }))
      .toMatchObject({ customWidthMm: PDF_EXPORT_CUSTOM_MM_MIN, customHeightMm: PDF_EXPORT_CUSTOM_MM_MAX })
    expect(normalizePdfExportOptions({ customWidthMm: 'x' }).customWidthMm).toBe(210)
  })

  it('custom 缺省尺寸回落 A4（148×100 输入非法时）', () => {
    expect(normalizePdfExportOptions({ paper: 'custom' }))
      .toMatchObject({ paper: 'custom', customWidthMm: 210, customHeightMm: 297 })
  })
})

describe('T05（#625）页眉页脚与页码参数', () => {
  const hf: PdfHeaderFooterContext = {
    docTitle: '我的文档',
    dateText: '2026-10-21',
    dark: false,
    pageLabel: { pre: '第 ', mid: ' 页 / 共 ', post: ' 页' },
  }

  it('normalize：新开关布尔收敛与页码位置枚举', () => {
    expect(normalizePdfExportOptions({
      headerEnabled: 'yes', pageNumberEnabled: true, pageNumberPosition: 'top', bookmarksEnabled: 1,
    })).toMatchObject({ headerEnabled: false, pageNumberEnabled: true, pageNumberPosition: 'footer-center', bookmarksEnabled: false })
    expect(normalizePdfExportOptions({ pageNumberPosition: 'footer-right' }).pageNumberPosition).toBe('footer-right')
  })

  it('printToPdfParamsOf：默认关时不带页眉页脚字段（既有产物形态不变）', () => {
    const params = printToPdfParamsOf(PDF_EXPORT_OPTIONS_DEFAULTS, hf) as Record<string, unknown>
    expect(params['displayHeaderFooter']).toBeUndefined()
    expect(params['headerTemplate']).toBeUndefined()
    expect(params['footerTemplate']).toBeUndefined()
  })

  it('printToPdfParamsOf：开启时接入 displayHeaderFooter 与模板、上下边距抬升', () => {
    const options = normalizePdfExportOptions({ headerEnabled: true, pageNumberEnabled: true, marginMm: 5 })
    const params = printToPdfParamsOf(options, hf)
    expect(params.displayHeaderFooter).toBe(true)
    expect(typeof params.headerTemplate).toBe('string')
    expect(params.headerTemplate).not.toBe('')
    expect(params.footerTemplate).toContain('pageNumber')
    expect(params.footerTemplate).toContain('totalPages')
    // V01 §6：页眉页脚渲染区在边距内——上下边距抬到下限，左右不动
    expect(params.marginTop).toBeCloseTo(PDF_EXPORT_HEADER_FOOTER_MARGIN_MIN_MM / 25.4, 2)
    expect(params.marginBottom).toBe(params.marginTop)
    expect(params.marginLeft).toBeCloseTo(5 / 25.4, 2)
    // 边距本就充足时不抬升
    const ample = printToPdfParamsOf(
      normalizePdfExportOptions({ pageNumberEnabled: true, marginMm: 25 }), hf)
    expect(ample.marginTop).toBeCloseTo(25 / 25.4, 2)
  })

  it('@page 与 printToPDF 边距抬升同步（四值形态）', () => {
    const options = normalizePdfExportOptions({ pageNumberEnabled: true, marginMm: 5 })
    const css = cssAtPageRuleOf(options)
    const params = printToPdfParamsOf(options, hf)
    expect(css).toContain(
      `margin: ${params.marginTop.toFixed(2)}in ${params.marginLeft.toFixed(2)}in ${params.marginBottom.toFixed(2)}in ${params.marginRight.toFixed(2)}in`)
  })

  it('页眉模板：关闭/无内容项时为抑制形态（Chromium 默认页眉含 URL 不得漏出）', () => {
    expect(buildHeaderTemplate(PDF_EXPORT_OPTIONS_DEFAULTS, hf)).toBe('<span></span>')
    const noItems = normalizePdfExportOptions({ headerEnabled: true, headerTitle: false, headerDate: false })
    expect(buildHeaderTemplate(noItems, hf)).toBe('<span></span>')
  })

  it('页眉模板：标题/日期内容与字号显式（V01 §6——inline 样式、字号建议显式）', () => {
    const options = normalizePdfExportOptions({ headerEnabled: true })
    const template = buildHeaderTemplate(options, hf)
    expect(template).toContain('我的文档')
    expect(template).not.toContain('2026-10-21')
    const withDate = buildHeaderTemplate(normalizePdfExportOptions({ headerEnabled: true, headerDate: true }), hf)
    expect(withDate).toContain('我的文档')
    expect(withDate).toContain('2026-10-21')
    for (const t of [template, withDate]) {
      expect(t).toMatch(/font-size:\s*9px/)
      expect(t).not.toContain('<script')
    }
    // 暗色适配色（暗背景 PDF 下页眉可读）
    expect(buildHeaderTemplate(options, { ...hf, dark: true })).toMatch(/color:\s*#b/)
  })

  it('页眉模板：标题 HTML 转义（文件名含特殊字符不逃逸出模板）', () => {
    const evil = { ...hf, docTitle: 'a<b>&"c' }
    const template = buildHeaderTemplate(normalizePdfExportOptions({ headerEnabled: true }), evil)
    expect(template).not.toContain('a<b>')
    expect(template).toContain('a&lt;b&gt;&amp;&quot;c')
  })

  it('页脚模板：关闭为抑制形态；开启含原生页码 class 与位置对齐', () => {
    expect(buildFooterTemplate(PDF_EXPORT_OPTIONS_DEFAULTS, hf)).toBe('<span></span>')
    const center = buildFooterTemplate(normalizePdfExportOptions({ pageNumberEnabled: true }), hf)
    expect(center).toContain('class="pageNumber"')
    expect(center).toContain('class="totalPages"')
    expect(center).toContain('第 ')
    expect(center).toContain(' 页 / 共 ')
    expect(center).toMatch(/font-size:\s*9px/)
    // 位置：flex 容器内 margin 推移（探针实测 margin:0 auto 居中同机制）
    expect(center).toContain('margin:0 auto')
    expect(buildFooterTemplate(normalizePdfExportOptions({ pageNumberEnabled: true, pageNumberPosition: 'footer-right' }), hf))
      .toContain('margin-left:auto')
    expect(buildFooterTemplate(normalizePdfExportOptions({ pageNumberEnabled: true, pageNumberPosition: 'footer-left' }), hf))
      .not.toContain('margin-left:auto')
    // 英文词条形态
    expect(buildFooterTemplate(normalizePdfExportOptions({ pageNumberEnabled: true }),
      { ...hf, pageLabel: { pre: 'Page ', mid: ' of ', post: '' } })).toContain('Page ')
  })
})
