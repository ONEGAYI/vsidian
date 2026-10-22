// 图片尺寸后缀解析契约（#635）：语法矩阵、分段规则、非法值降级与写回形态。
// 规格单一事实源：docs/specs/image-resize.md §3.1–§3.4、§4.4。
import { describe, expect, it } from 'vitest'
import {
  formatImageSizeSuffix,
  imageSizeAttrs,
  parseImageSizeSuffix,
  percentToPxWidth,
  sameImageSize,
  splitAliasAndSize,
} from '../../src/shared/imageSize'

describe('parseImageSizeSuffix：合法形态', () => {
  it('只写宽度像素 → 等比（height 为 null）', () => {
    expect(parseImageSizeSuffix('100')).toEqual({ width: 100, height: null, unit: 'px' })
    expect(parseImageSizeSuffix('1')).toEqual({ width: 1, height: null, unit: 'px' })
    expect(parseImageSizeSuffix('4096')).toEqual({ width: 4096, height: null, unit: 'px' })
  })

  it('宽x高像素 → 固定双轴（拉伸语义，不保持比例）', () => {
    expect(parseImageSizeSuffix('640x480')).toEqual({ width: 640, height: 480, unit: 'px' })
    // 大小写不敏感（x 与 X 等价）
    expect(parseImageSizeSuffix('640X480')).toEqual({ width: 640, height: 480, unit: 'px' })
  })

  it('百分比 → 固有宽度百分比，等比', () => {
    expect(parseImageSizeSuffix('50%')).toEqual({ width: 50, height: null, unit: 'percent' })
    expect(parseImageSizeSuffix('12.5%')).toEqual({ width: 12.5, height: null, unit: 'percent' })
    // 合法域边界：1% 与 1000% 都在域内
    expect(parseImageSizeSuffix('1%')).toEqual({ width: 1, height: null, unit: 'percent' })
    expect(parseImageSizeSuffix('1000%')).toEqual({ width: 1000, height: null, unit: 'percent' })
  })

  it('段内首尾空白 trim 后同义', () => {
    expect(parseImageSizeSuffix(' 100 ')).toEqual({ width: 100, height: null, unit: 'px' })
    expect(parseImageSizeSuffix('  640x480  ')).toEqual({ width: 640, height: 480, unit: 'px' })
    expect(parseImageSizeSuffix(' 50% ')).toEqual({ width: 50, height: null, unit: 'percent' })
  })
})

describe('parseImageSizeSuffix：非法值一律 null（调用方原样降级）', () => {
  it('零值与空段', () => {
    expect(parseImageSizeSuffix('0')).toBeNull()
    expect(parseImageSizeSuffix('0x100')).toBeNull()
    expect(parseImageSizeSuffix('100x0')).toBeNull()
    expect(parseImageSizeSuffix('0%')).toBeNull()
    expect(parseImageSizeSuffix('')).toBeNull()
    expect(parseImageSizeSuffix('   ')).toBeNull()
  })

  it('超出百分比合法域', () => {
    expect(parseImageSizeSuffix('1000.5%')).toBeNull()
    expect(parseImageSizeSuffix('2000%')).toBeNull()
  })

  it('只写高度（Obsidian 未实现，不自造）', () => {
    expect(parseImageSizeSuffix('x200')).toBeNull()
    expect(parseImageSizeSuffix('X200')).toBeNull()
  })

  it('双百分比（高度百分比无明确基准）', () => {
    expect(parseImageSizeSuffix('50%x30%')).toBeNull()
    expect(parseImageSizeSuffix('50x30%')).toBeNull()
  })

  it('非尺寸文本：别名、负号、小数像素、多余分隔', () => {
    expect(parseImageSizeSuffix('说明文字')).toBeNull()
    expect(parseImageSizeSuffix('-100')).toBeNull()
    expect(parseImageSizeSuffix('100.5')).toBeNull()
    expect(parseImageSizeSuffix('100px')).toBeNull()
    expect(parseImageSizeSuffix('100x')).toBeNull()
    expect(parseImageSizeSuffix('100x80x60')).toBeNull()
    expect(parseImageSizeSuffix('%')).toBeNull()
  })

  it('超出安全整数域的像素值按非法处理（不产出 Infinity）', () => {
    expect(parseImageSizeSuffix('99999999999999999999')).toBeNull()
    expect(parseImageSizeSuffix('99999999999999999999x10')).toBeNull()
  })
})

describe('splitAliasAndSize：最后一段是尺寸，其余拼回别名', () => {
  it('无别名、只有尺寸', () => {
    expect(splitAliasAndSize(['100'])).toEqual({
      alias: null,
      size: { width: 100, height: null, unit: 'px' },
    })
  })

  it('单段别名、无尺寸', () => {
    expect(splitAliasAndSize(['说明文字'])).toEqual({ alias: '说明文字', size: null })
  })

  it('别名 + 尺寸（规格 §3.3 的三个示例）', () => {
    expect(splitAliasAndSize(['说明文字', '100'])).toEqual({
      alias: '说明文字',
      size: { width: 100, height: null, unit: 'px' },
    })
    expect(splitAliasAndSize(['说明文字', '640x480'])).toEqual({
      alias: '说明文字',
      size: { width: 640, height: 480, unit: 'px' },
    })
    expect(splitAliasAndSize(['说明文字', '50%'])).toEqual({
      alias: '说明文字',
      size: { width: 50, height: null, unit: 'percent' },
    })
  })

  it('多段别名：非末段全部拼回（用 | 还原）', () => {
    expect(splitAliasAndSize(['前', '中', '100'])).toEqual({
      alias: '前|中',
      size: { width: 100, height: null, unit: 'px' },
    })
  })

  it('末段非尺寸时整段都是别名，数字段照旧留在别名里', () => {
    expect(splitAliasAndSize(['100', '说明'])).toEqual({ alias: '100|说明', size: null })
    // 末段是合法尺寸形态 → 判尺寸，前段「100」仍是别名（末段规则优先）
    expect(splitAliasAndSize(['100', '200'])).toEqual({
      alias: '100',
      size: { width: 200, height: null, unit: 'px' },
    })
  })

  it('非法尺寸末段不剥离（降级为别名的一部分）', () => {
    expect(splitAliasAndSize(['说明', '0'])).toEqual({ alias: '说明|0', size: null })
    expect(splitAliasAndSize(['说明', 'x200'])).toEqual({ alias: '说明|x200', size: null })
    expect(splitAliasAndSize(['说明', '50%x30%'])).toEqual({ alias: '说明|50%x30%', size: null })
  })

  it('空数组与空白段', () => {
    expect(splitAliasAndSize([])).toEqual({ alias: null, size: null })
    expect(splitAliasAndSize([''])).toEqual({ alias: null, size: null })
    expect(splitAliasAndSize([' 说明 ', ''])).toEqual({ alias: '说明', size: null })
  })
})

describe('imageSizeAttrs：像素走属性，百分比走内联样式', () => {
  it('像素等比只写 width 属性', () => {
    expect(imageSizeAttrs({ width: 300, height: null, unit: 'px' })).toEqual({
      width: '300',
      height: null,
      styleWidth: null,
      percentWidth: null,
    })
  })

  it('像素双轴写 width 与 height', () => {
    expect(imageSizeAttrs({ width: 640, height: 480, unit: 'px' })).toEqual({
      width: '640',
      height: '480',
      styleWidth: null,
      percentWidth: null,
    })
  })

  it('百分比只能走 style.width（HTML width 属性不接受百分比）', () => {
    expect(imageSizeAttrs({ width: 50, height: null, unit: 'percent' })).toEqual({
      width: null,
      height: null,
      styleWidth: '50%',
      percentWidth: 50,
    })
    expect(imageSizeAttrs({ width: 12.5, height: null, unit: 'percent' })).toEqual({
      width: null,
      height: null,
      styleWidth: '12.5%',
      percentWidth: 12.5,
    })
  })
})

describe('percentToPxWidth：百分比按固有宽折算像素（规格 §3.1 基准）', () => {
  it('值域矩阵：1% / 12.5% / 100% / 1000% 按固有宽折算', () => {
    expect(percentToPxWidth(200, 1)).toBe(2)
    expect(percentToPxWidth(200, 12.5)).toBe(25)
    expect(percentToPxWidth(200, 100)).toBe(200)
    expect(percentToPxWidth(200, 1000)).toBe(2000)
  })

  it('小数结果不取整（与拖动 applyVisual 的视觉折算同口径）', () => {
    expect(percentToPxWidth(300, 33.333)).toBeCloseTo(99.999, 3)
  })

  it('naturalWidth 未知（0 / 负 / NaN / Infinity）返回 null，不产出伪像素', () => {
    expect(percentToPxWidth(0, 50)).toBeNull()
    expect(percentToPxWidth(-10, 50)).toBeNull()
    expect(percentToPxWidth(Number.NaN, 50)).toBeNull()
    expect(percentToPxWidth(Number.POSITIVE_INFINITY, 50)).toBeNull()
  })

  it('percent 非有限值返回 null（防御：装载链路的标记值可能被外部污染）', () => {
    expect(percentToPxWidth(200, Number.NaN)).toBeNull()
    expect(percentToPxWidth(200, Number.POSITIVE_INFINITY)).toBeNull()
  })
})

describe('formatImageSizeSuffix：写回源文形态', () => {
  it('三种形态各自还原', () => {
    expect(formatImageSizeSuffix({ width: 300, height: null, unit: 'px' })).toBe('300')
    expect(formatImageSizeSuffix({ width: 640, height: 480, unit: 'px' })).toBe('640x480')
    expect(formatImageSizeSuffix({ width: 50, height: null, unit: 'percent' })).toBe('50%')
  })

  it('小数去掉尾随零，整数不带小数点', () => {
    expect(formatImageSizeSuffix({ width: 33.333, height: null, unit: 'percent' })).toBe('33.33%')
    expect(formatImageSizeSuffix({ width: 50.0, height: null, unit: 'percent' })).toBe('50%')
  })

  it('写回结果可被重新解析为等价尺寸（往返闭合）', () => {
    for (const size of [
      { width: 1, height: null, unit: 'px' as const },
      { width: 1024, height: 768, unit: 'px' as const },
      { width: 25, height: null, unit: 'percent' as const },
    ]) {
      expect(parseImageSizeSuffix(formatImageSizeSuffix(size))).toEqual(size)
    }
  })
})

describe('sameImageSize：拖动提交的无变化判定', () => {
  it('完全相等为 true；单位不同为 false', () => {
    const px = { width: 100, height: null, unit: 'px' as const }
    expect(sameImageSize(px, { width: 100, height: null, unit: 'px' })).toBe(true)
    expect(sameImageSize(px, { width: 100, height: null, unit: 'percent' })).toBe(false)
    expect(sameImageSize(px, { width: 101, height: null, unit: 'px' })).toBe(false)
    expect(sameImageSize(px, { width: 100, height: 80, unit: 'px' })).toBe(false)
  })

  it('null 与 null 为 true，null 与非 null 为 false', () => {
    expect(sameImageSize(null, null)).toBe(true)
    expect(sameImageSize(null, { width: 100, height: null, unit: 'px' })).toBe(false)
    expect(sameImageSize({ width: 100, height: null, unit: 'px' }, null)).toBe(false)
  })
})
