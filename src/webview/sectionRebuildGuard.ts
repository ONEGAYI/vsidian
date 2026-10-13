// #467 设置分页整块重渲染的滚动/焦点保持守卫：附加分页（附加组件、
// 文件与链接等）收到宿主推送（addons.state / addons.settingsState /
// addons.behaviors / index.state …）后整块 replaceChildren 重建，两个
// 实测丢失向量都在这条链上——
//  - 定位 scrollIntoView 在渲染中间态（内容塌缩中）强制布局，把主区
//    scrollTop 钳制到顶部，重建完成后无人恢复（回顶）；故触发过定位的
//    分页要把 scrollIntoView 收窄到显式定位渲染，见各分页实现。
//  - 重建销毁持有焦点的控件后焦点落到 BODY（键盘 Tab 序从头——#462 的
//    键盘侧）；恢复焦点必须 preventScroll：无守卫 focus() 落在视口外
//    控件本身就是滚动杀手。
// 用法：render() 入口（replaceChildren 之前）capture，同步重建完成后
// restore——保存/恢复必须留在渲染函数自己的同步块内，跨任务（微任务/
// 观察器）挂钩会漏多消息场景的恢复窗口。分页/搜索切换的复位语义
//（renderKey 变化回顶，#155 契约）不在本守卫职责内：调用方仅在
// focusEntry 为 undefined（同分页推送/本地重渲染）时启用守卫，显式定位
// 渲染的 scrollIntoView 与视图侧焦点语义优先。
//
// data-rebuild-focus 属性契约：需要跨重建恢复焦点的控件携带
// data-rebuild-focus="<分页内唯一键>"；capture 只认渲染前焦点落在分页
// 内且带该键的控件，restore 按 CSS 选择器找同键控件（键含特殊字符经
// CSS.escape 转义）。
//
// 键的取舍边界（评审落档）：无稳定标识的行控件（数组行、索引排除模式
// 行）以位置做键——删行后恢复到新 DOM 等价位置的控件，连续操作符合
// 直觉；数组行的局部恢复在无同键位置（末行删除）时由调用方回退到
// 新末行的移除按钮。重复值场景无法用值做唯一键。自由文本输入框（数组
// 项、对象字段、模式行）不持键：打字中到达的宿主推送重建会丢焦点（值
// 经草稿态恢复不丢数据），焦点保持只覆盖触发重建的按钮类操作；同键
// 控件重建后不可聚焦（如索引模式末空行的 disabled 按钮）时按未命中
// 处理。

/** 焦点恢复锚点属性（各分页设置控件键时引用，避免拼写漂移） */
export const REBUILD_FOCUS_ATTR = 'data-rebuild-focus'

/** 渲染前的滚动与焦点快照（不透明句柄：capture 产出、restore 消费） */
export interface SectionRebuildAnchor {
  /** 主区滚动容器（parent 经 closest 发现；分页独立于设置页装配时为 null） */
  readonly scroller: HTMLElement | null
  readonly scrollTop: number
  /** 焦点控件的同键选择器（无锚点焦点时 null） */
  readonly focusSelector: string | null
}

/** 渲染入口快照：主区 scrollTop 与分页内持有焦点的控件键 */
export function captureSectionRebuildAnchor(parent: HTMLElement): SectionRebuildAnchor {
  const scroller = parent.closest<HTMLElement>('.vsidian-settings-main')
  const active = document.activeElement
  const key = active instanceof HTMLElement && parent !== active && parent.contains(active)
    ? active.getAttribute(REBUILD_FOCUS_ATTR)
    : null
  return {
    scroller,
    scrollTop: scroller?.scrollTop ?? 0,
    focusSelector: key === null ? null : `[${REBUILD_FOCUS_ATTR}="${cssEscape(key)}"]`,
  }
}

/** 渲染出口恢复：scrollTop 按浏览器同款钳制语义写回（内容变矮时下修，
 *  与浏览器自动钳制一致；jsdom 无布局时 max 为 0，按保存值原样写回，
 *  单测可断言机制），焦点经 preventScroll 恢复（不得引入焦点滚动） */
export function restoreSectionRebuildAnchor(parent: HTMLElement, anchor: SectionRebuildAnchor): void {
  if (anchor.scroller) {
    const max = anchor.scroller.scrollHeight - anchor.scroller.clientHeight
    anchor.scroller.scrollTop = max > 0 ? Math.min(anchor.scrollTop, max) : anchor.scrollTop
  }
  if (anchor.focusSelector !== null) {
    parent.querySelector<HTMLElement>(anchor.focusSelector)?.focus({ preventScroll: true })
  }
}

function cssEscape(value: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(value)
    : value.replace(/["\\]/g, '\\$&')
}

/** 局部重建（数组行等不涉滚动容器的小块）的焦点键快照：渲染前焦点不
 *  在容器内或不带键时为 null（调用方重建后按键恢复） */
export function captureLocalFocusKey(container: HTMLElement): string | null {
  const active = document.activeElement
  return active instanceof HTMLElement && container !== active && container.contains(active)
    ? active.getAttribute(REBUILD_FOCUS_ATTR)
    : null
}

/** 局部重建后按键恢复焦点（preventScroll，不引入焦点滚动）；键为 null
 *  或容器内无同键控件时返回 false（调用方可回退到场景内可聚焦控件）；
 *  同键控件存在但不可聚焦（如 disabled）时 focus 无效，同样按未命中
 *  处理返回值不区分 */
export function restoreLocalFocusKey(container: HTMLElement, key: string | null): boolean {
  if (key === null) {
    return false
  }
  const el = container.querySelector<HTMLElement>(`[${REBUILD_FOCUS_ATTR}="${cssEscape(key)}"]`)
  el?.focus({ preventScroll: true })
  return el !== null
}
