// 悬停提示几何的契约矩阵（#300）：垂直下优先→上翻转、水平 start 对齐→
// end 翻转→钳制，均以视口 margin 为界。先例 hoverPopupGeometry 单测形态。
import { describe, it, expect } from 'vitest'
import { planTooltipPlacement } from '../../src/webview/tooltipGeometry'

/** 视口 800×600 的便捷锚点构造（默认远缘认为四周空间充足） */
function anchorAt(left: number, top: number, width = 40, height = 24) {
  return { left, top, right: left + width, bottom: top + height, width, height }
}
const TIP = { width: 120, height: 30 }
const VP = { width: 800, height: 600 }
const GAP = 6
const MARGIN = 8

describe('悬停提示几何（#300）', () => {
  it('视口中央：下方呈现、居中于锚点', () => {
    const p = planTooltipPlacement({ anchor: anchorAt(300, 200), tip: TIP, viewport: VP })
    expect(p.vertical).toBe('below')
    expect(p.align).toBe('center')
    expect(p.top).toBe(200 + 24 + GAP)
    expect(p.left).toBe(300 + 40 / 2 - TIP.width / 2)
  })

  it('贴近视口底缘：上方翻转', () => {
    // 锚点底 580：below 需要 580+6+30=616 > 600-8，上方空间 570-30-6 充足
    const p = planTooltipPlacement({ anchor: anchorAt(300, 556), tip: TIP, viewport: VP })
    expect(p.vertical).toBe('above')
    expect(p.top).toBe(556 - GAP - TIP.height)
  })

  it('上下均放不下（矮视口）：上方翻转后钳进视口，不出顶不出底', () => {
    const vp = { width: 800, height: 100 }
    const p = planTooltipPlacement({ anchor: anchorAt(300, 40), tip: TIP, viewport: vp })
    expect(p.top).toBe(vp.height - MARGIN - TIP.height)
    expect(p.top).toBeGreaterThanOrEqual(MARGIN)
    expect(p.top + TIP.height).toBeLessThanOrEqual(vp.height)
  })

  it('居中越出右缘：水平翻转为 end（右对齐锚点）', () => {
    // 中心 770：center left=710，710+120=830 > 792 → 翻右对齐，left=670
    const p = planTooltipPlacement({ anchor: anchorAt(750, 200), tip: TIP, viewport: VP })
    expect(p.vertical).toBe('below')
    expect(p.align).toBe('end')
    expect(p.left).toBe(750 + 40 - TIP.width)
  })

  it('居中越出左缘：对称翻转为 start（左对齐锚点）', () => {
    // 中心 30：center left=-30 < 8 → 翻左对齐，left=10
    const p = planTooltipPlacement({ anchor: anchorAt(10, 200), tip: TIP, viewport: VP })
    expect(p.align).toBe('start')
    expect(p.left).toBe(10)
  })

  it('居中越左翻 start 后仍越出右缘：钳制到左边距（tip 宽于视口）', () => {
    // 锚点贴左缘（left=4）、tip 900 宽于视口 800：center left=24-450=-426
    // 越左 → 翻 start left=4；4+900=904 > 792 仍越右 → 钳制。
    // center 基准下「end 后仍越左」不可达（越右要求锚点偏右、end 越左要求
    // 锚点贴左，互斥），对称场景落在 start 分支
    const p = planTooltipPlacement({
      anchor: anchorAt(4, 200, 40, 24), tip: { width: 900, height: 30 }, viewport: VP,
    })
    expect(p.align).toBe('clamp')
    expect(p.left).toBe(MARGIN)
  })

  it('钳制上限：tip 宽于视口时不出右缘（左缘优先）', () => {
    // 锚点居中（中心 420）：center left=420-450=-30 越左 → 翻 start left=400；
    // 400+900=1300 > 792 → 钳 max(8, 792-900)=8，左缘优先
    const p = planTooltipPlacement({
      anchor: anchorAt(400, 200), tip: { width: 900, height: 30 }, viewport: VP,
    })
    expect(p.align).toBe('clamp')
    expect(p.left).toBe(MARGIN)
  })

  it('上方翻转越顶且 tip 近视口高：钳到顶部边距，不出顶', () => {
    // below 放不下（330+560>592）翻 above；above top=-266 越顶 → 钳到
    // max(margin, vh-margin-560)=32
    const p = planTooltipPlacement({
      anchor: anchorAt(300, 300, 40, 24), tip: { width: 120, height: 560 }, viewport: VP,
    })
    expect(p.vertical).toBe('above')
    expect(p.top).toBe(32)
  })

  it('整数化：分数几何不产生小数定位', () => {
    const p = planTooltipPlacement({ anchor: anchorAt(300.4, 200.6), tip: { width: 120.5, height: 30.5 }, viewport: VP })
    expect(Number.isInteger(p.top)).toBe(true)
    expect(Number.isInteger(p.left)).toBe(true)
  })
})
