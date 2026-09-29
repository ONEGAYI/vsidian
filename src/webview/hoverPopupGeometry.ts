// 悬停预览浮层几何纯函数（工单 #218）：四边翻转、空间不足收缩与可用
// 视口钳制的数学内核，与 DOM 解耦（node 单测直驱；diagramPopupGeometry
// 同模式）。尺寸契约（规格初值）：默认宽 480px、最大高 400px——#221 起
// 嵌入/浮层设置项接入后仍以此为缺省。
//
// 摆放策略（首选 → 逐边避让）：
// 1. 首选置于锚点下方、左对齐锚点左缘（阅读流的自然阅读位）；
// 2. 下边缘放不下（含锚点间距）→ 翻转到锚点上方；
// 3. 上下都放不下（小窗口）→ 取空间较大一侧，高度收缩并整体钳制在
//    [margin, viewport - margin] 内；
// 4. 水平方向：越出右缘左移、越出左缘右移（宽度不足时收缩为
//    viewport - 2*margin），任何结果不溢出可用视口。

/** 默认宽（px；规格一期初值） */
export const HOVER_POPUP_DEFAULT_WIDTH = 480
/** 最大高（px；规格一期初值——内容更矮时自然高度） */
export const HOVER_POPUP_MAX_HEIGHT = 400
/** 视口四边安全边距（px） */
export const HOVER_POPUP_VIEWPORT_MARGIN = 8
/** 浮层与锚点的间距（px） */
export const HOVER_POPUP_ANCHOR_GAP = 6

/** 锚点包围盒（viewport 坐标；由 getBoundingClientRect 提供） */
export interface HoverPopupAnchorBox {
  left: number
  top: number
  right: number
  bottom: number
}

export interface HoverPopupPlacementInput {
  anchor: HoverPopupAnchorBox
  viewport: { width: number; height: number }
  /** 期望尺寸（自然尺寸或上限；实际可能收缩） */
  size: { width: number; height: number }
}

/** 摆放结果（取整后的 px 坐标与最终尺寸） */
export interface HoverPopupPlacement {
  left: number
  top: number
  width: number
  height: number
}

/** 悬停浮层摆放计划（纯函数） */
export function planHoverPopupPlacement(input: HoverPopupPlacementInput): HoverPopupPlacement {
  const margin = HOVER_POPUP_VIEWPORT_MARGIN
  const gap = HOVER_POPUP_ANCHOR_GAP
  const { anchor, viewport } = input
  // 水平：宽度钳制在可用视口内（窄视口收缩，不小于 1px）
  const width = Math.max(1, Math.min(input.size.width, viewport.width - 2 * margin))
  // 垂直：期望高度先钳到可用视口高，再按上下空间翻转/收缩
  const desiredHeight = Math.min(input.size.height, viewport.height - 2 * margin)
  const belowTop = anchor.bottom + gap
  const aboveTop = anchor.top - gap - desiredHeight
  const fitsBelow = belowTop + desiredHeight <= viewport.height - margin
  const fitsAbove = aboveTop >= margin
  let top: number
  let height: number
  if (fitsBelow) {
    top = belowTop
    height = desiredHeight
  } else if (fitsAbove) {
    top = aboveTop
    height = desiredHeight
  } else {
    // 两侧都放不下：取空间较大侧，钳制在可用视口内（高度相应收缩）
    const spaceBelow = viewport.height - margin - belowTop
    const spaceAbove = anchor.top - gap - margin
    if (spaceBelow >= spaceAbove) {
      top = Math.max(margin, belowTop)
      height = Math.min(desiredHeight, viewport.height - margin - top)
    } else {
      height = Math.min(desiredHeight, Math.max(1, spaceAbove))
      top = Math.max(margin, anchor.top - gap - height)
      height = Math.min(height, viewport.height - margin - top)
    }
  }
  // 水平平移 + 钳制（右缘优先保左对齐，越界才左移）
  let left = anchor.left
  if (left + width > viewport.width - margin) {
    left = viewport.width - margin - width
  }
  if (left < margin) {
    left = margin
  }
  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(width),
    height: Math.round(height),
  }
}
