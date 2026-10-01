import { describe, expect, it } from 'vitest'
import { OVERLAY_ANCHOR_MIN_MARGIN, planOverlayAnchorRight } from '../../src/webview/overlayAnchor'

// 浮层右缘锚点计划（2026-10 锚点跟随）：查找面板与选词选项条的 right
// 不再是静态 14px，改为「#app 右缘 − 正文列右缘」实时计算（ResizeObserver
// 逐帧同步），铺满档正文右缘贴近视口右缘时回退旧保底边距。

describe('overlayAnchor：浮层右缘锚点计划', () => {
  it('限宽档：right = 视口右缘与正文列右缘之差（浮层右缘对齐正文列）', () => {
    // 视口 1000、限宽 600 居中：正文列右缘距视口右缘 200
    expect(planOverlayAnchorRight({ appRight: 1000, contentRight: 800 })).toBe(200)
  })

  it('贴边场景：差值小于保底边距时取保底（最小 14px 边距兜底）', () => {
    expect(planOverlayAnchorRight({ appRight: 1000, contentRight: 995 })).toBe(
      OVERLAY_ANCHOR_MIN_MARGIN,
    )
  })

  it('正文列右缘越出包含块（防御负差值）时取保底', () => {
    expect(planOverlayAnchorRight({ appRight: 1000, contentRight: 1200 })).toBe(
      OVERLAY_ANCHOR_MIN_MARGIN,
    )
  })

  it('差值恰好等于保底边距时取该差值', () => {
    expect(planOverlayAnchorRight({ appRight: 1000, contentRight: 1000 - OVERLAY_ANCHOR_MIN_MARGIN })).toBe(
      OVERLAY_ANCHOR_MIN_MARGIN,
    )
  })
})
