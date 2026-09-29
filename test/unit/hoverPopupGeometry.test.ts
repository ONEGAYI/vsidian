// 悬停浮层几何纯函数（#218）：四边翻转、空间不足收缩与视口钳制——
// U6 小窗口可用性的数学内核（diagramPopupGeometry 同模式，node 直驱）。
import { describe, expect, it } from 'vitest'
import {
  HOVER_POPUP_ANCHOR_GAP,
  HOVER_POPUP_DEFAULT_WIDTH,
  HOVER_POPUP_MAX_HEIGHT,
  HOVER_POPUP_VIEWPORT_MARGIN,
  planHoverPopupPlacement,
} from '../../src/webview/hoverPopupGeometry'

const VIEWPORT = { width: 1200, height: 800 }
const SIZE = { width: HOVER_POPUP_DEFAULT_WIDTH, height: HOVER_POPUP_MAX_HEIGHT }

describe('planHoverPopupPlacement：默认侧与对齐', () => {
  it('锚点居中时置于下方、左对齐锚点（首选摆放）', () => {
    const out = planHoverPopupPlacement({
      anchor: { left: 400, top: 300, right: 520, bottom: 320 },
      viewport: VIEWPORT,
      size: SIZE,
    })
    expect(out).toEqual({
      left: 400,
      top: 320 + HOVER_POPUP_ANCHOR_GAP,
      width: HOVER_POPUP_DEFAULT_WIDTH,
      height: HOVER_POPUP_MAX_HEIGHT,
    })
  })

  it('尺寸常量钉住：默认宽 480 / 最大高 400 / 边距 8 / 锚点间距 6', () => {
    expect(HOVER_POPUP_DEFAULT_WIDTH).toBe(480)
    expect(HOVER_POPUP_MAX_HEIGHT).toBe(400)
    expect(HOVER_POPUP_VIEWPORT_MARGIN).toBe(8)
    expect(HOVER_POPUP_ANCHOR_GAP).toBe(6)
  })
})

describe('planHoverPopupPlacement：四边翻转与钳制', () => {
  it('下边缘放不下 → 翻转上方（底边避让）', () => {
    const out = planHoverPopupPlacement({
      anchor: { left: 400, top: 500, right: 520, bottom: 780 },
      viewport: VIEWPORT,
      size: SIZE,
    })
    // 下方剩余 800-8-780-6 < 400，翻上方
    expect(out.top).toBe(500 - HOVER_POPUP_ANCHOR_GAP - HOVER_POPUP_MAX_HEIGHT)
    expect(out.top + out.height).toBeLessThanOrEqual(500 - HOVER_POPUP_ANCHOR_GAP)
  })

  it('上方也放不下（锚点贴近底边且上空间不足）→ 取空间较大侧并钳制高度于视口内', () => {
    // 视口高 500：锚点 bottom=470，下方剩 500-8-470-6=16；上方 = 300-8-6=286
    const out = planHoverPopupPlacement({
      anchor: { left: 100, top: 300, right: 200, bottom: 470 },
      viewport: { width: 1200, height: 500 },
      size: SIZE,
    })
    expect(out.top).toBeGreaterThanOrEqual(HOVER_POPUP_VIEWPORT_MARGIN)
    expect(out.top + out.height).toBeLessThanOrEqual(500 - HOVER_POPUP_VIEWPORT_MARGIN)
    expect(out.height).toBeLessThanOrEqual(500 - 2 * HOVER_POPUP_VIEWPORT_MARGIN)
  })

  it('右边缘越界 → 左移钳制在视口内（右边避让）', () => {
    const out = planHoverPopupPlacement({
      anchor: { left: 1150, top: 300, right: 1190, bottom: 320 },
      viewport: VIEWPORT,
      size: SIZE,
    })
    expect(out.left + out.width).toBeLessThanOrEqual(VIEWPORT.width - HOVER_POPUP_VIEWPORT_MARGIN)
    expect(out.left).toBeGreaterThanOrEqual(HOVER_POPUP_VIEWPORT_MARGIN)
  })

  it('左边缘越界 → 右向钳制（左边避让）', () => {
    const out = planHoverPopupPlacement({
      anchor: { left: 2, top: 300, right: 40, bottom: 320 },
      viewport: VIEWPORT,
      size: SIZE,
    })
    expect(out.left).toBe(HOVER_POPUP_VIEWPORT_MARGIN)
  })

  it('视口窄于默认宽 → 宽度收缩（两端各留边距）', () => {
    const out = planHoverPopupPlacement({
      anchor: { left: 10, top: 50, right: 100, bottom: 70 },
      viewport: { width: 300, height: 800 },
      size: SIZE,
    })
    expect(out.width).toBe(300 - 2 * HOVER_POPUP_VIEWPORT_MARGIN)
    expect(out.left).toBeGreaterThanOrEqual(HOVER_POPUP_VIEWPORT_MARGIN)
    expect(out.left + out.width).toBeLessThanOrEqual(300 - HOVER_POPUP_VIEWPORT_MARGIN)
  })

  it('视口既窄又矮 → 宽高同时收缩且完全落入可用视口', () => {
    const out = planHoverPopupPlacement({
      anchor: { left: 60, top: 120, right: 120, bottom: 140 },
      viewport: { width: 260, height: 240 },
      size: SIZE,
    })
    expect(out.width).toBe(260 - 2 * HOVER_POPUP_VIEWPORT_MARGIN)
    expect(out.height).toBeLessThanOrEqual(240 - 2 * HOVER_POPUP_VIEWPORT_MARGIN)
    expect(out.top).toBeGreaterThanOrEqual(HOVER_POPUP_VIEWPORT_MARGIN)
    expect(out.top + out.height).toBeLessThanOrEqual(240 - HOVER_POPUP_VIEWPORT_MARGIN)
  })

  it('内容比视口矮 → 保持自然高度不放大', () => {
    const out = planHoverPopupPlacement({
      anchor: { left: 400, top: 300, right: 520, bottom: 320 },
      viewport: VIEWPORT,
      size: { width: 480, height: 120 },
    })
    expect(out.height).toBe(120)
  })
})
