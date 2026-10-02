// 悬停提示定位几何（#300）：纯函数，node 单测直驱（先例 hoverPopupGeometry
// / frontmatterPopover.positionPopover）。
//
// 策略（规格 docs/specs/tooltip.md「行为规格」）：
// - 锚定触发元素（非鼠标位置）；
// - 垂直：下方优先 → 上方翻转 → 翻上仍越顶边距则钳进视口（#299 起调用
//   方可传 preferVertical:'above' 定向上优先——见 TooltipPlacementInput）；
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
  /** 垂直主位（默认 'below' 下优先）：'above' 上优先、放不下翻下——
   * #299 跳转目标提示的定向裁定（链接下方常是后续正文与链接，气泡向
   * 上弹出不遮挡阅读动线）；统一体系其余场景不传、默认往下不变 */
  preferVertical?: 'below' | 'above'
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

  // 垂直：默认下优先、放不下翻上；preferVertical:'above' 上优先、放不下
  // 翻下（镜像）。翻转后仍越边距则钳进视口（tip 近视口高的极端场景以
  // 「不出视口」为唯一不变量，标签如实保持翻转态）。锚点滚出视口顶部时
  // below 的 top 同样可能越顶边距，一并钳制（对齐先例 hoverPopupGeometry
  // 的「任何结果不溢出可用视口」承诺）
  const preferAbove = input.preferVertical === 'above'
  let vertical: TooltipPlacement['vertical'] = preferAbove ? 'above' : 'below'
  let top = preferAbove ? anchor.top - gap - tip.height : anchor.bottom + gap
  if (preferAbove ? top < margin : top + tip.height > viewport.height - margin) {
    vertical = preferAbove ? 'below' : 'above'
    top = preferAbove ? anchor.bottom + gap : anchor.top - gap - tip.height
    if (preferAbove ? top + tip.height > viewport.height - margin : top < margin) {
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
