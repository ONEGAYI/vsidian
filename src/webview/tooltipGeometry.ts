// 悬停提示定位几何（#300）：纯函数，node 单测直驱（先例 hoverPopupGeometry
// / frontmatterPopover.positionPopover）。
//
// 策略（规格 docs/specs/tooltip.md「行为规格」）：
// - 锚定触发元素（非鼠标位置）；
// - 垂直：下方优先 → 上方翻转 → 上下均放不下回落下方并钳进下边距；
// - 水平：start（左对齐锚点）→ 越右缘翻 end（右对齐锚点）→ 仍越左缘钳到
//   左边距（tip 宽于视口时左缘优先，不出右缘）；
// - 间距与视口边距沿用悬停预览先例（gap 6 / margin 8）。

export interface TooltipAnchorRect {
  left: number
  top: number
  right: number
  bottom: number
}

export interface TooltipPlacementInput {
  anchor: TooltipAnchorRect
  tip: { width: number; height: number }
  viewport: { width: number; height: number }
  gap?: number
  margin?: number
}

export interface TooltipPlacement {
  top: number
  left: number
  vertical: 'below' | 'above'
  align: 'start' | 'end' | 'clamp'
}

export function planTooltipPlacement(input: TooltipPlacementInput): TooltipPlacement {
  const gap = input.gap ?? 6
  const margin = input.margin ?? 8
  const { anchor, tip, viewport } = input

  // 垂直：下优先，放不下翻上；翻上越顶边距则钳进视口（tip 近视口高的
  // 极端场景以「不出视口」为唯一不变量，标签如实保持翻转态）
  let vertical: TooltipPlacement['vertical'] = 'below'
  let top = anchor.bottom + gap
  if (top + tip.height > viewport.height - margin) {
    vertical = 'above'
    top = anchor.top - gap - tip.height
    if (top < margin) {
      top = Math.max(margin, viewport.height - margin - tip.height)
    }
  }

  // 水平：start → end 翻转 → 钳制（左缘优先：tip 宽于视口时不悬出右缘）
  let align: TooltipPlacement['align'] = 'start'
  let left = anchor.left
  if (left + tip.width > viewport.width - margin) {
    align = 'end'
    left = anchor.right - tip.width
    if (left < margin) {
      align = 'clamp'
      left = margin
    }
  }

  return { top: Math.round(top), left: Math.round(left), vertical, align }
}
