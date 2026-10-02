// 悬停提示定位几何（#300）：纯函数，node 单测直驱（先例 hoverPopupGeometry
// / frontmatterPopover.positionPopover）。
//
// 策略（规格 docs/specs/tooltip.md「行为规格」）：
// - 锚定触发元素（非鼠标位置）；
// - 垂直：下方优先 → 上方翻转 → 翻上仍越顶边距则钳进视口；
// - 水平：**居中优先**（锚点中心对齐提示中心，参照 Obsidian 观感）→ 越出
//   右缘翻 end（右对齐锚点）→ 仍越左缘钳到左边距；越出左缘对称翻 start
//   （左对齐锚点）→ 仍越右缘钳到右边距（tip 宽于视口时左缘优先）；
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
  align: 'center' | 'start' | 'end' | 'clamp'
}

export function planTooltipPlacement(input: TooltipPlacementInput): TooltipPlacement {
  const gap = input.gap ?? 6
  const margin = input.margin ?? 8
  const { anchor, tip, viewport } = input

  // 垂直：下优先，放不下翻上；翻上越顶边距则钳进视口（tip 近视口高的
  // 极端场景以「不出视口」为唯一不变量，标签如实保持翻转态）。锚点滚出
  // 视口顶部时 below 的 top 同样可能越顶边距，一并钳制（对齐先例
  // hoverPopupGeometry 的「任何结果不溢出可用视口」承诺）
  let vertical: TooltipPlacement['vertical'] = 'below'
  let top = anchor.bottom + gap
  if (top + tip.height > viewport.height - margin) {
    vertical = 'above'
    top = anchor.top - gap - tip.height
    if (top < margin) {
      top = Math.max(margin, viewport.height - margin - tip.height)
    }
  } else if (top < margin) {
    top = margin
  }

  // 水平：居中优先 → 越缘侧翻转对齐 → 钳制（tip 宽于视口时左缘优先，
  // 不悬出右缘）
  const centerX = (anchor.left + anchor.right) / 2
  let align: TooltipPlacement['align'] = 'center'
  let left = centerX - tip.width / 2
  if (left + tip.width > viewport.width - margin) {
    // 居中越出右缘：翻右对齐锚点
    align = 'end'
    left = anchor.right - tip.width
    if (left < margin) {
      align = 'clamp'
      left = margin
    }
  } else if (left < margin) {
    // 居中越出左缘：对称翻左对齐锚点；锚点本身贴/越左缘时 start 仍越左，
    // 同样钳制（与 end 分支的兜底对称，任何结果不悬出视口）
    align = 'start'
    left = anchor.left
    if (left + tip.width > viewport.width - margin) {
      align = 'clamp'
      left = Math.max(margin, viewport.width - margin - tip.width)
    } else if (left < margin) {
      align = 'clamp'
      left = margin
    }
  }

  return { top: Math.round(top), left: Math.round(left), vertical, align }
}
