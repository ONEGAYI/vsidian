// 浮层右缘锚点计划纯函数（2026-10 锚点跟随）：查找面板（.vsidian-find）
// 与选词选项条（.vsidian-occurrence-bar）的 right 不再钉死视口右上角
// 14px，而是对齐可读行宽限宽后正文列的右缘——测算由 syncController 的
// ResizeObserver 逐帧同步驱动，本模块只负责单一决策：给两端几何求 right。

/** 最小边距下限：差值异常趋零或为负（正文列右缘贴住/越出包含块右缘，
 *  如零内边距+overlay 滚动条的平台组合）时兜住最小 14px 边距。注意铺满
 *  档的 diff 计入滚动条与内容边距余量（经典滚动条平台实测 ≈24px），走
 *  正常差值分支——面板贴正文列右缘即正文右上角语义 */
export const OVERLAY_ANCHOR_MIN_MARGIN = 14

export interface OverlayAnchorGeometry {
  /** 定位包含块（#app）右缘的视口 x 坐标 */
  appRight: number
  /** 正文列右缘的视口 x 坐标（live 为 .cm-content，reading 为限宽块） */
  contentRight: number
}

/** 求浮层 style.right 像素值：正文列右缘与包含块右缘之差，下限保底边距。
 *  限宽档差值即右侧留白（浮层右缘贴正文列）；铺满档差值含滚动条与内容
 *  边距余量，同样取差值（面板贴正文列右缘） */
export function planOverlayAnchorRight(geometry: OverlayAnchorGeometry): number {
  return Math.max(geometry.appRight - geometry.contentRight, OVERLAY_ANCHOR_MIN_MARGIN)
}
