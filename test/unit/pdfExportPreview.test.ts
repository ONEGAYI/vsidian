// PDF 导出预览指纹纯逻辑单元测试（T07/#627）：归一参数口径、四种输入
// 形态的身份区分、代次语义（页眉日期）与两侧一致性。
import { describe, expect, it } from 'vitest'
import { pdfPreviewFingerprint, pdfPreviewTargetKey, type PdfPreviewTarget } from '../../src/shared/pdfExportPreview'

const DOC_TARGET: PdfPreviewTarget = {
  kind: 'document',
  doc: { docName: '笔记甲.md', capturedVersion: 3 },
}
const PARAMS = { paper: 'a4', orientation: 'portrait', marginMm: 20, scale: 1 }

describe('pdfPreviewFingerprint：参数归一口径', () => {
  it('等价参数（缺省补全/非法回落/对象键序无关）指纹相同', () => {
    const a = pdfPreviewFingerprint({ options: PARAMS, target: DOC_TARGET })
    const b = pdfPreviewFingerprint({
      options: { ...PARAMS, unknownField: true, customWidthMm: 'x' },
      target: { kind: 'document', doc: { docName: '笔记甲.md', capturedVersion: 3, fragments: undefined } },
    })
    expect(b).toBe(a)
  })

  it('任一归一化字段变化即指纹不同（参数面）', () => {
    const base = pdfPreviewFingerprint({ options: PARAMS, target: DOC_TARGET })
    for (const changed of [
      { ...PARAMS, orientation: 'landscape' },
      { ...PARAMS, marginMm: 10 },
      { ...PARAMS, scale: 1.5 },
      { ...PARAMS, headerEnabled: true },
      { ...PARAMS, bookmarksEnabled: true },
      { ...PARAMS, theme: 'dark' },
    ]) {
      expect(pdfPreviewFingerprint({ options: changed, target: DOC_TARGET })).not.toBe(base)
    }
  })

  it('越界值归一为同值后指纹相同（与导出发起同口径）', () => {
    const a = pdfPreviewFingerprint({ options: { ...PARAMS, marginMm: 999 }, target: DOC_TARGET })
    const b = pdfPreviewFingerprint({ options: { ...PARAMS, marginMm: 50 }, target: DOC_TARGET })
    expect(a).toBe(b)
  })
})

describe('pdfPreviewFingerprint：固定输入身份', () => {
  it('文档版本或选区切片变化即不同代次', () => {
    const base = pdfPreviewFingerprint({ options: PARAMS, target: DOC_TARGET })
    expect(pdfPreviewFingerprint({
      options: PARAMS, target: { kind: 'document', doc: { docName: '笔记甲.md', capturedVersion: 4 } },
    })).not.toBe(base)
    expect(pdfPreviewFingerprint({
      options: PARAMS,
      target: { kind: 'document', doc: { docName: '笔记甲.md', capturedVersion: 3, fragments: [[0, 5]] } },
    })).not.toBe(base)
  })

  it('批量条目：fsPath 变化即不同；同条目同版本即相同', () => {
    const target = (fsPath: string): PdfPreviewTarget =>
      ({ kind: 'batchItem', fsPath, doc: { docName: 'a.md', capturedVersion: 7 } })
    const base = pdfPreviewFingerprint({ options: PARAMS, target: target('D:/vault/a.md') })
    expect(pdfPreviewFingerprint({ options: PARAMS, target: target('D:/vault/b.md') })).not.toBe(base)
    expect(pdfPreviewFingerprint({ options: PARAMS, target: target('D:/vault/a.md') })).toBe(base)
  })

  it('合并：清单序、逐篇版本与每篇另起一页都是代次面', () => {
    const target = (fsPaths: string[], versions: number[]): PdfPreviewTarget =>
      ({ kind: 'merge', fsPaths, versions })
    const base = pdfPreviewFingerprint({ options: PARAMS, target: target(['a.md', 'b.md'], [1, 2]), pageBreak: true })
    expect(pdfPreviewFingerprint({ options: PARAMS, target: target(['b.md', 'a.md'], [2, 1]), pageBreak: true })).not.toBe(base)
    expect(pdfPreviewFingerprint({ options: PARAMS, target: target(['a.md', 'b.md'], [1, 3]), pageBreak: true })).not.toBe(base)
    expect(pdfPreviewFingerprint({ options: PARAMS, target: target(['a.md', 'b.md'], [1, 2]), pageBreak: false })).not.toBe(base)
    expect(pdfPreviewFingerprint({ options: PARAMS, target: target(['a.md', 'b.md'], [1, 2]), pageBreak: true })).toBe(base)
  })

  it('页眉日期开启：宿主日期参与指纹；关闭时不参与', () => {
    const withDate = { ...PARAMS, headerEnabled: true, headerDate: true }
    const a = pdfPreviewFingerprint({ options: withDate, target: DOC_TARGET, today: '2026-10-21' })
    expect(pdfPreviewFingerprint({ options: withDate, target: DOC_TARGET, today: '2026-10-22' })).not.toBe(a)
    expect(pdfPreviewFingerprint({ options: withDate, target: DOC_TARGET, today: '2026-10-21' })).toBe(a)
    const noDate = { ...PARAMS, headerEnabled: true, headerTitle: true }
    const b = pdfPreviewFingerprint({ options: noDate, target: DOC_TARGET, today: '2026-10-21' })
    expect(pdfPreviewFingerprint({ options: noDate, target: DOC_TARGET, today: '2026-10-22' })).toBe(b)
  })

  it('形态混杂（document vs batchItem 同文档）不误判相等', () => {
    const doc = { docName: 'a.md', capturedVersion: 1 }
    expect(pdfPreviewFingerprint({ options: PARAMS, target: { kind: 'document', doc } }))
      .not.toBe(pdfPreviewFingerprint({ options: PARAMS, target: { kind: 'batchItem', fsPath: 'D:/vault/a.md', doc } }))
  })
})

describe('pdfPreviewTargetKey：目标选择身份键（不含参数、日期与版本）', () => {
  it('参数/版本推进不改变目标键；换条目/换文档才改变', () => {
    const doc = { docName: 'a.md', capturedVersion: 2 }
    const target: PdfPreviewTarget = { kind: 'document', doc }
    const base = pdfPreviewTargetKey(target)
    expect(pdfPreviewTargetKey({ kind: 'document', doc: { ...doc } })).toBe(base)
    // 捕获推进版本（同一篇的输入更新）不算换目标
    expect(pdfPreviewTargetKey({ kind: 'document', doc: { docName: 'a.md', capturedVersion: 3 } })).toBe(base)
    expect(pdfPreviewTargetKey({
      kind: 'batchItem', fsPath: 'D:/vault/a.md', doc,
    })).not.toBe(base)
    // 同一目标的完整指纹随参数变化，但目标键不变——参数变化不撤旧画面
    expect(pdfPreviewFingerprint({ options: PARAMS, target })).not.toBe(
      pdfPreviewFingerprint({ options: { ...PARAMS, orientation: 'landscape' }, target }),
    )
    expect(pdfPreviewTargetKey(target)).toBe(base)
  })

  it('批量条目换文件、合并清单增删/换序都算换目标', () => {
    const item = (fsPath: string): PdfPreviewTarget =>
      ({ kind: 'batchItem', fsPath, doc: { docName: 'a.md', capturedVersion: 1 } })
    expect(pdfPreviewTargetKey(item('D:/v/a.md'))).not.toBe(pdfPreviewTargetKey(item('D:/v/b.md')))
    const merge = (fsPaths: string[]): PdfPreviewTarget => ({ kind: 'merge', fsPaths, versions: fsPaths.map(() => 1) })
    expect(pdfPreviewTargetKey(merge(['a.md', 'b.md'])))
      .not.toBe(pdfPreviewTargetKey(merge(['b.md', 'a.md'])))
    expect(pdfPreviewTargetKey(merge(['a.md', 'b.md'])))
      .not.toBe(pdfPreviewTargetKey(merge(['a.md'])))
  })
})
