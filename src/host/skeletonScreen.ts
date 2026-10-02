// #292 编辑器初开骨架屏的内联装配纯逻辑：样式与标记由 buildWebviewHtml
// 拼入初始 HTML——外链 main.css/main.js 到达前（空窗①）即呈现，样式内联
// 自包含（CSP style-src 已放行 unsafe-inline，editorCsp.ts）；挂载后的收编
// 与撤除调度在 webview 控制器（syncController）。
// 纯字符串构造、不依赖 vscode/DOM——期望形态由 test/unit/skeletonScreen.test.ts
// 钉住；公开类名登记于 src/shared/styleContract.ts（skeleton / skeleton-block）。
import {
  SKELETON_ELEMENT_ID,
  SKELETON_SHIMMER_CYCLE_MS,
  SKELETON_SHIMMER_DELAY_MS,
} from '../shared/skeletonTiming'

/** 骨架内联样式：单一样式源（main.css 不重复承载骨架规则），供 head 内
 *  <style> 原样拼接。宽度口径引用 #app 层 --vsidian-live-preview-max-width
 *  （规格 Q4/Q9：不复制读值，设置内联与铺满态变化自动传导）。 */
export function buildSkeletonStyleHtml(): string {
  return `<style>
/* ---- #292 加载期骨架屏（内联自包含；契约条目 skeleton / skeleton-block）---- */
.vsidian-skeleton {
  position: absolute;
  inset: 0;
  z-index: 30;
  background: var(--vscode-editor-background);
  overflow: hidden;
  pointer-events: none;
}
.vsidian-skeleton-column {
  box-sizing: border-box;
  height: 100%;
  max-width: var(--vsidian-live-preview-max-width);
  margin-inline: auto;
  padding: 36px var(--vsidian-content-padding-inline) 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.vsidian-skeleton-block {
  position: relative;
  overflow: hidden;
  width: 88%;
  height: 14px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--vscode-editor-foreground, #808080) 9%, transparent);
}
/* 通用固定形态：标题条 + 段落条交错 + 代码块条，不读文档内容 */
.vsidian-skeleton-block:nth-child(1) { width: 42%; height: 24px; border-radius: 8px; background: color-mix(in srgb, var(--vscode-editor-foreground, #808080) 16%, transparent); }
.vsidian-skeleton-block:nth-child(2) { width: 96%; }
.vsidian-skeleton-block:nth-child(3) { width: 88%; }
.vsidian-skeleton-block:nth-child(4) { width: 93%; }
.vsidian-skeleton-block:nth-child(5) { width: 64%; }
.vsidian-skeleton-block:nth-child(6) { width: 100%; height: 88px; border-radius: 10px; }
.vsidian-skeleton-block:nth-child(7) { width: 91%; }
.vsidian-skeleton-block:nth-child(8) { width: 76%; }
.vsidian-skeleton-block:nth-child(9) { width: 38%; }
/* 扫光：启动延时后循环播放；相位锚定元素样式计算时刻（≈呈现打点） */
.vsidian-skeleton-block::after {
  content: '';
  position: absolute;
  inset: 0;
  transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--vscode-editor-foreground, #808080) 8%, transparent), transparent);
  animation: vsidian-skeleton-sweep ${SKELETON_SHIMMER_CYCLE_MS}ms linear infinite;
  animation-delay: ${SKELETON_SHIMMER_DELAY_MS}ms;
}
@keyframes vsidian-skeleton-sweep {
  to { transform: translateX(100%); }
}
@media (prefers-reduced-motion: reduce) {
  .vsidian-skeleton-block::after { animation: none; }
}
/* 挂载收编（空窗②）：宿主类把模式容器变为定位包含块，骨架只盖内容区 */
.vsidian-skeleton-host {
  position: relative;
}
</style>`
}

/** 骨架标记：#app 初始子元素（挂载收编前整页覆盖，收编后仅盖内容区）。 */
export function buildSkeletonBodyHtml(): string {
  return `<div id="${SKELETON_ELEMENT_ID}" class="vsidian-skeleton" aria-hidden="true">
  <div class="vsidian-skeleton-column">
    <div class="vsidian-skeleton-block"></div>
    <div class="vsidian-skeleton-block"></div>
    <div class="vsidian-skeleton-block"></div>
    <div class="vsidian-skeleton-block"></div>
    <div class="vsidian-skeleton-block"></div>
    <div class="vsidian-skeleton-block"></div>
    <div class="vsidian-skeleton-block"></div>
    <div class="vsidian-skeleton-block"></div>
    <div class="vsidian-skeleton-block"></div>
  </div>
</div>`
}

/**
 * #292 可读行宽预注入取值（实施要点 4，消除骨架期宽度回跳）：非 0 有效
 * 档返回整数像素（写 #app 内联 style，后续 applyReadableLineWidthSetting
 * 的 0 档移除 / 非 0 档覆写语义不变）；0（铺满档）、缺失与非数值不预注入。
 */
export function readableLineWidthPreset(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }
  return Math.round(value)
}
