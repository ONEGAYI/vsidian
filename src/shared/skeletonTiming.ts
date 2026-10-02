// #292 骨架屏共享纯逻辑：撤除时刻计算与装配常量（无 DOM/vscode 依赖）。
// 常量同时被宿主 buildWebviewHtml 的内联 CSS 模板引用（扫光 animation-delay
// 与周期）——CSS 动画时钟与撤除计划共用同一组常量，保证「等当前周期播完」
// 的收束与实际扫光相位对齐（相位锚点为元素样式计算时刻，宿主在 main.js
// 之前打点 SKELETON_SHOWN_AT_GLOBAL）。

/** 骨架元素稳定 id（初始 HTML 内；挂载收编与撤除都按它定位） */
export const SKELETON_ELEMENT_ID = 'vsidian-skeleton'

/** 骨架呈现时刻打点的全局名：宿主内联脚本在 main.js 之前写 performance.now() */
export const SKELETON_SHOWN_AT_GLOBAL = '__vsidianSkeletonShownAt'

/** 集成测试冻结撤除的全局名：VSIDIAN_TEST_HOOKS=1 时由宿主 HTML 嵌入
 *  （webview 被动读取；生产构建不含该赋值，见 provider 装配门控） */
export const SKELETON_HOLD_GLOBAL = '__vsidianSkeletonHold'

/** 扫光启动延时（ms）：骨架先以静态灰块呈现，延时走完才开始扫光——瞬间
 *  载好的文档全程无动画。取值须短于大文档载入耗时（大文件必须能看到扫光，
 *  规格 docs/specs/skeleton-screen.md 三节；定稿前对照 docs/perf 复核）。 */
export const SKELETON_SHIMMER_DELAY_MS = 300

/** 扫光周期（ms）：单次扫光时长，循环播放。 */
export const SKELETON_SHIMMER_CYCLE_MS = 1500

export interface SkeletonExitPlanInput {
  /** 骨架呈现时刻（performance.now 口径，宿主 HTML 内联脚本打点） */
  shownAt: number
  /** 正文就绪时刻（全文落地后的首个绘制帧） */
  readyAt: number
  /** 启动延时（缺省 SKELETON_SHIMMER_DELAY_MS） */
  delayMs?: number
  /** 扫光周期（缺省 SKELETON_SHIMMER_CYCLE_MS） */
  cycleMs?: number
  /** prefers-reduced-motion：不播扫光，等价「动画未开始」 */
  reducedMotion?: boolean
}

export interface SkeletonExitPlan {
  /** false = 撤除无需等待周期收束（动画未开始，或被系统减少动态关闭） */
  animationStarted: boolean
  /** 撤除时刻；不早于 readyAt（调用方将等待时长钳制到 ≥0） */
  removeAt: number
}

/**
 * #292 撤除时刻计划（规格三节「退出规则」的形式化）：
 * - readyAt ≤ shownAt + delay（动画未开始）：就绪即撤；
 * - 动画已开始：撤除时刻 = 动画起点 + ⌈(readyAt − 动画起点) ÷ 周期⌉ × 周期
 *   ——等当前周期播完才撤（1.5 周期载完 → 第 2 周期末退出）。
 */
export function planSkeletonExit(input: SkeletonExitPlanInput): SkeletonExitPlan {
  // 防御：非有限入参按「动画未开始」处理——撤除时刻退化为就绪时刻；
  // readyAt 本身非有限时取 0（立即撤，最坏退化为现状空白，不产生 NaN 计时）
  if (!Number.isFinite(input.readyAt) || !Number.isFinite(input.shownAt)) {
    return { animationStarted: false, removeAt: Number.isFinite(input.readyAt) ? input.readyAt : 0 }
  }
  const delayMs = typeof input.delayMs === 'number' && Number.isFinite(input.delayMs) &&
    input.delayMs >= 0
    ? input.delayMs
    : SKELETON_SHIMMER_DELAY_MS
  const cycleMs = typeof input.cycleMs === 'number' && Number.isFinite(input.cycleMs) &&
    input.cycleMs > 0
    ? input.cycleMs
    : SKELETON_SHIMMER_CYCLE_MS
  const readyAt = input.readyAt
  if (input.reducedMotion === true || readyAt <= input.shownAt + delayMs) {
    return { animationStarted: false, removeAt: readyAt }
  }
  const animationStart = input.shownAt + delayMs
  const cycles = Math.ceil((readyAt - animationStart) / cycleMs)
  return { animationStarted: true, removeAt: animationStart + cycles * cycleMs }
}
