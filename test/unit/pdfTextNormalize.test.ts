// T05（#625）PDF 文本归一单元测试：NFKC + CJK 部首对照双归一
//（V01 §7/§10.4：Chromium ToUnicode 把「页」映射到「⻚」U+2E9A，NFKC 盲区；
// 江区部首（U+2F00–2FDF）NFKC 可归一——双归一缺一不可）。
import { describe, expect, it } from 'vitest'
import { normalizePdfText } from '../../src/shared/pdfTextNormalize'

describe('PDF 文本归一（NFKC + 部首对照）', () => {
  it('普通中英文原样（空白全去）', () => {
    expect(normalizePdfText('PDF-T05 标题 甲')).toBe('PDF-T05标题甲')
  })

  it('CJK 部首补充区（NFKC 盲区）经对照表归一：「⻚」→「页」', () => {
    expect(normalizePdfText('第 1 ⻚')).toBe('第1页')
    expect(normalizePdfText('⻉⻛⻜⻝⻢⻥⻦⻩⻰⻲')).toBe('贝风飞食马鱼鸟黄龙龟')
  })

  it('康熙部首区（U+2F00–2FDF）NFKC 自归一：「⽂」→「文」', () => {
    expect(normalizePdfText('⽂⽅⽇⽉')).toBe('文方日月')
  })

  it('双区混排真实形态（Chromium 提取产物）', () => {
    // 江区「⻆」+ 部首补充区「⻚」同页出现：归一后与原文档标题一致
    expect(normalizePdfText('⻆⾊与⻚⾯')).toBe('角色与页面')
  })

  it('全角/半角与空白一律收敛（NFKC + 去空白）', () => {
    expect(normalizePdfText('ＡＢＣ１２３')).toBe('ABC123')
    expect(normalizePdfText('a b\tc\nd')).toBe('abcd')
  })

  it('对照表只覆盖部首区（不误伤原文档正常汉字）', () => {
    // 原文档标题本身含「页」等正常汉字：归一幂等
    expect(normalizePdfText('页面设计')).toBe('页面设计')
  })
})
