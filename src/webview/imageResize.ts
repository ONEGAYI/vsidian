// 图片相框右下角拖动手柄（#636）：拖动即改显示尺寸并把结果写回源文尺寸
// 后缀。规格单一事实源 docs/specs/image-resize.md §5（拖动手柄）、§6（视觉
// 规格）、§7（Shift 提示）。
//
// 设计边界（为什么这样切）：
// - 纯逻辑（computeResizeTarget / glowExtension / resizeHandleLayout /
//   planSizeSuffixRewrite / rewriteImageSourceSuffix）不依赖真实布局与
//   DOM，单测可直驱；DOM 装配只把纯函数接到指针事件上，不重复算尺寸。
// - 拖动期间**只改视觉**（img 内联样式），绝不碰文档；松手才一次性提交。
//   取消（Esc）因此天然无损，且一笔写回 = 宿主撤销栈一步（规格 §5.3）。
// - 尺寸后缀的「是不是尺寸」判定必须复用 shared/imageSize 的
//   parseImageSizeSuffix，不另写正则——否则 `|0`、`|2000%` 这类非法值在
//   解析侧是别名、在写回侧却被当尺寸替换，用户写的别名会被静默吞掉。
// - 「这个 frame 该不该有手柄」由调用方（Live 图片 widget）判定：排除
//   矩阵的单一事实源在 liveLinks.ts / syncController.ts，复制一份必然漂移。
// - 源文区间从 frame 的 dataset 读（widget 在 toDOM 时写入）。widget 自己
//   持有装饰区间，DOM 侧反查只能拿到起点；猜终点会写坏无关正文。

import { EditorView } from '@codemirror/view'
import {
  IMAGE_SIZE_PERCENT_MAX,
  formatImageSizeSuffix,
  parseImageSizeSuffix,
  percentToPxWidth,
  sameImageSize,
  type ImageSize,
} from '../shared/imageSize'
import { t } from '../shared/i18n'

/** 手柄族类名（DOM 契约：样式表与浏览器验收共用同一组字面量） */
export const IMAGE_RESIZE_CLASS_NAMES = {
  /** 手柄本体（pointerdown 的命中面） */
  handle: 'vsidian-image-resize-handle',
  /** 右下角边线光带光晕（纯装饰，不接事件） */
  glow: 'vsidian-image-resize-glow',
  /** 拖动中的尺寸读数（如 `320 × 180`） */
  readout: 'vsidian-image-resize-readout',
} as const

/** 拖动中挂在相框上的修饰类：整框异色描边，且光晕隐去（互斥） */
export const IMAGE_RESIZE_RESIZING_CLASS = 'vsidian-image-resizing'

/** 手柄视觉边长（规格 §5.5） */
export const IMAGE_RESIZE_HANDLE_SIZE = 12
/** 手柄热区边长（热区大于视觉，便于抓取） */
export const IMAGE_RESIZE_HIT_SIZE = 20
/** 手柄热区收出视觉方块的透明边框宽（CSS .vsidian-image-resize-handle 的 border 同源值：
 *  热区 20 − 2×4 = 视觉 12；CSS 侧注释与本常量互为锚点，改任一侧须同步另一侧） */
export const IMAGE_RESIZE_HANDLE_BORDER = 4
/** 最小宽度（规格 §5.4：再小抓不住，与光晕保底同档） */
export const IMAGE_RESIZE_MIN_WIDTH = 24
/** 最小高度（只防 0/负值；等比缩放的小图不应被抬高） */
export const IMAGE_RESIZE_MIN_HEIGHT = 1
/** 光晕保底延伸距离（规格 §6.1） */
const GLOW_MIN_EXTENSION = 24
/** 光晕相对短边的比例（规格 §6.1） */
const GLOW_SHORT_EDGE_RATIO = 0.1

/** 拖动模式：等比（默认）与自由双轴（按住 Shift） */
export type ResizeMode = 'proportional' | 'free'

export interface ComputeResizeTargetArgs {
  /** 拖动起点的渲染宽（px，来自 getBoundingClientRect） */
  startWidth: number
  /** 拖动起点的渲染高（px） */
  startHeight: number
  /** 指针水平位移（px，向右为正） */
  dx: number
  /** 指针垂直位移（px，向下为正） */
  dy: number
  mode: ResizeMode
  /** 源文既有尺寸声明；null = 原本无后缀 */
  declared: ImageSize | null
  /** 图片固有宽（naturalWidth；0 表示未知/未装载） */
  naturalWidth: number
  /** 图片固有高（naturalHeight；0 表示未知/未装载） */
  naturalHeight: number
  /** 容器内容宽（可读行宽）；<=0 或非有限值表示不可知，不做最大宽钳制 */
  containerWidth: number
}

/**
 * 由指针位移算出**将要写回源文**的尺寸（规格 §5.2/§5.4）。
 *
 * 单位跟随既有写法：原写百分比 → 结果仍百分比（基准是固有宽，规格 §3.1——
 * 换基准会让同一图在不同容器里漂移）；其余一律像素。
 *
 * `|WxH` 的等比拖动保留两轴（用户显式声明了固定框，丢高度等于替用户改
 * 语义）；自由模式一律产出像素双轴（显式框）。
 */
export function computeResizeTarget(args: ComputeResizeTargetArgs): ImageSize {
  const startWidth = positiveOr(args.startWidth, IMAGE_RESIZE_MIN_WIDTH)
  const maxWidth = finitePositive(args.containerWidth) ? args.containerWidth : Number.POSITIVE_INFINITY
  // 最小宽优先于最大宽：容器窄到 24 以下时仍给 24（可操作性不能被容器
  // 宽度抹掉；真溢出由既有 max-width:100% 兜底，不产生横向滚动条）
  const upper = Math.max(IMAGE_RESIZE_MIN_WIDTH, maxWidth)
  const desired = clamp(startWidth + args.dx, IMAGE_RESIZE_MIN_WIDTH, upper)

  if (args.mode === 'free') {
    return {
      width: Math.round(desired),
      height: Math.max(IMAGE_RESIZE_MIN_HEIGHT, Math.round(positiveOr(args.startHeight, 0) + args.dy)),
      unit: 'px',
    }
  }

  // 等比：宽驱动。百分比声明的基准是固有宽——容器/当前渲染宽都不参与
  if (args.declared?.unit === 'percent') {
    const natural = finitePositive(args.naturalWidth) ? args.naturalWidth : startWidth
    const percent = round2((desired / natural) * 100)
    // 写回域守卫（规格 §3.4：1%–1000）：越域改写像素形态——超上限写
    // `|1050%` 会被解析侧判非法降级为别名（垃圾段 `图.png|1050%|210`
    // 累积）；下溢钳 1% 会让松手渲染跳离拖动所见（natural 4000 拖 24 →
    // 1% = 40px）。像素无上限且所见即所得，与拖动视觉一致
    if (percent < 1 || percent > IMAGE_SIZE_PERCENT_MAX) {
      return { width: Math.round(desired), height: null, unit: 'px' }
    }
    return { width: percent, height: null, unit: 'percent' }
  }

  // `|WxH`：按起点宽高的实际比例推进高度。用户手写的 W:H 可能不等于固有
  // 比例——拉伸是规格明示语义，等比拖动应在**用户框**的比例上缩放，而不是
  // 悄悄把框校正成固有比例
  if (args.declared !== null && args.declared.height !== null) {
    const ratio = positiveOr(args.startWidth, 0) > 0 ? args.startHeight / startWidth : 1
    return {
      width: Math.round(desired),
      height: Math.max(IMAGE_RESIZE_MIN_HEIGHT, Math.round(desired * ratio)),
      unit: 'px',
    }
  }

  return { width: Math.round(desired), height: null, unit: 'px' }
}

/**
 * 光晕光带深度（规格 §6.1）：`max(24px, min(宽, 高) × 10%)`。
 *
 * 取 max 不取和——相加会让大图的光带深度难以预期；基数用短边——宽图若
 * 按宽边算，982×169 的图沿底边的光带深度会到 98px、与行高失衡，短边让
 * 光带与图的视觉体量成比例。
 */
export function glowExtension(frameWidth: number, frameHeight: number): number {
  if (!Number.isFinite(frameWidth) || !Number.isFinite(frameHeight)) {
    return GLOW_MIN_EXTENSION
  }
  const shortEdge = Math.min(frameWidth, frameHeight)
  if (shortEdge <= 0) {
    return GLOW_MIN_EXTENSION
  }
  return Math.max(GLOW_MIN_EXTENSION, shortEdge * GLOW_SHORT_EDGE_RATIO)
}

export interface ResizeHandleFrameRect {
  width: number
  height: number
  /** 相框圆角半径（px）；缺省 0（当前图片相框无圆角） */
  radius?: number
}

/**
 * 手柄相对相框的定位（贴右下角内侧，并让热区中心落在圆角弧心上）。
 *
 * 同心推导：弧心距两条边都是 radius，热区半径是 HIT/2；把热区盒的右/下
 * 偏移取 `radius - HIT/2`，热区中心即与弧心重合。半径小于热区半径时钳到
 * 0——负偏移会让手柄探出相框外侧。
 */
export function resizeHandleLayout(frameRect: ResizeHandleFrameRect): { right: number; bottom: number } {
  const radius = Number.isFinite(frameRect.radius) ? Math.max(0, frameRect.radius ?? 0) : 0
  const halfHit = IMAGE_RESIZE_HIT_SIZE / 2
  // 相框本身小于热区时偏移也不能把手柄推出框外
  const width = Number.isFinite(frameRect.width) ? frameRect.width : 0
  const limit = Math.max(0, width - IMAGE_RESIZE_HIT_SIZE)
  const offset = Math.min(Math.max(0, radius - halfHit), limit)
  return { right: offset, bottom: offset }
}

/** 尾缀改写计划：`text` 替换 inner 的 [from, to) 段 */
export interface SizeSuffixRewrite {
  /** 改写后的完整 inner（不含 `[[]]` / `![]()` 包裹） */
  inner: string
  /** inner 内替换区间起点 */
  from: number
  /** inner 内替换区间终点 */
  to: number
  /** 替换文本（通常以 `|` 开头；直链单段尺寸整段替换时为纯尺寸文本） */
  text: string
}

/**
 * `|` 分段尾缀改写（规格 §5.2 写回形态）的纯逻辑。
 *
 * 规则与 `splitAliasAndSize` 同源：**最后一段**能解析为尺寸才替换它，否则
 * 追加新段。只替换末段而不是整串重建，是为了让别名（可能含 `|`）逐字节
 * 保留；「能不能解析」直接调用 parseImageSizeSuffix，不另写正则——否则
 * `|0`、`|2000%` 在解析侧是别名、在写回侧会被当尺寸替换掉。
 *
 * `opts.bareAlt`（Markdown 直链的 alt 段专用）：无 `|` 且**整段**可解析为
 * 尺寸（`![100](图.png)`）时整段替换、不带竖线——追加会产出
 * `![100|160]`，旧数字漏进别名位、alt 从空变 100。双链 inner 无管道时
 * 整段是**目标路径**（`![[100]]` 是文件名），不得整段替换，默认 false。
 */
export function planSizeSuffixRewrite(
  inner: string,
  size: ImageSize,
  opts?: { bareAlt?: boolean },
): SizeSuffixRewrite {
  const bare = `|${formatImageSizeSuffix(size)}`
  // 尾随空段（`|` 或空白）不承载信息：先退到最后一个有内容的字符，否则
  // 会在 `图.png|` 后追加出 `图.png||160`
  let end = inner.length
  while (end > 0) {
    const ch = inner[end - 1]!
    if (ch === '|' || ch === ' ' || ch === '\t') {
      end -= 1
    } else {
      break
    }
  }
  if (end === 0) {
    return { inner: bare, from: 0, to: inner.length, text: bare }
  }
  const pipe = inner.lastIndexOf('|', end - 1)
  if (pipe < 0) {
    // 直链单段尺寸（bareAlt）：整段即尺寸段，整段替换（text 无竖线）
    if (opts?.bareAlt === true && parseImageSizeSuffix(inner.slice(0, end)) !== null) {
      const text = bare.slice(1)
      return { inner: text + inner.slice(end), from: 0, to: end, text }
    }
    // 无别名无尺寸：插入点取 end（尾随空白之前），不把分隔符塞到空白后
    return { inner: inner.slice(0, end) + bare, from: end, to: end, text: bare }
  }
  // 末段是尺寸则连竖线一起替换；否则视为别名，追加新段（别名原样保留）
  if (parseImageSizeSuffix(inner.slice(pipe + 1, end)) === null) {
    return { inner: inner.slice(0, end) + bare, from: end, to: end, text: bare }
  }
  return {
    inner: inner.slice(0, pipe) + bare + inner.slice(end),
    from: pipe,
    to: end,
    text: bare,
  }
}

/** planSizeSuffixRewrite 的便捷壳（返回新 inner） */
export function replaceSizeSuffix(
  inner: string,
  size: ImageSize,
  opts?: { bareAlt?: boolean },
): string {
  return planSizeSuffixRewrite(inner, size, opts).inner
}

/** 源文中的图片引用区间（[from, to) 为全文坐标，含两端包裹标记） */
export interface ImageSourceRange {
  from: number
  to: number
}

/**
 * 整段图片源文的尾缀改写：识别 `![[…]]` 与 `![alt](dest)` 两种包裹形态，
 * 只改「内层」文本，包裹标记与目标路径逐字节保留。
 *
 * 形态不可识别返回 null（调用方不提交，保持源文不变——不猜）。
 */
export function rewriteImageSourceSuffix(sourceText: string, size: ImageSize): string | null {
  if (sourceText.startsWith('![[') && sourceText.endsWith(']]')) {
    const inner = sourceText.slice(3, -2)
    return `![[${replaceSizeSuffix(inner, size)}]]`
  }
  if (!sourceText.startsWith('![')) {
    return null
  }
  // `![alt](dest)`：alt 到首个 `]`，其后必须是 `(`（与 markdown 图片形态
  // 一致）。目标内可能含 `)`，不参与改写，从尾部找最后一个 `)` 即可
  const closeLabel = sourceText.indexOf(']')
  if (closeLabel < 0 || sourceText[closeLabel + 1] !== '(' || !sourceText.endsWith(')')) {
    return null
  }
  const alt = sourceText.slice(2, closeLabel)
  // 直链 inner 是裸 alt 段：单段尺寸整段替换（bareAlt，见 plan 注释）
  return `![${replaceSizeSuffix(alt, size, { bareAlt: true })}]${sourceText.slice(closeLabel + 1)}`
}

/** 拖动起点的尺寸声明来源 */
export interface ResizeStart {
  /** 源文既有尺寸（null = 无后缀） */
  declared: ImageSize | null
  /** 源文区间（可选；缺省时提交阶段由调用方自行定位） */
  source?: ImageSourceRange
  /**
   * beginDrag 时刻的源文整段快照（B6 滑移守卫）：提交时重读比对，不一致
   * 即安全放弃——并发编辑滑移后固定区间可能覆盖无关文本。调用方自定义
   * resolveStart 时缺省（undefined），守卫退位给形态校验兜底。
   */
  sourceText?: string | null
}

/** toast 的最小接口（不引 toast.ts，避免把 toast.css 拖进本模块的依赖图） */
export interface ResizeToastLike {
  show(text: string, severity?: 'neutral' | 'warning' | 'error', key?: string): void
}

export interface AttachResizeHandleOptions {
  /** 拖动开始时读取起点声明（每次拖动都取，账户外改写后的最新源文） */
  resolveStart: () => ResizeStart
  /** 松手且尺寸确有变化时调用（一次拖动一次；单位/形态已按规格归一） */
  onCommit?: (size: ImageSize, start: ResizeStart) => void
  /** 容器内容宽（最大宽钳制基准）；缺省不可知 → 不钳制 */
  containerWidth?: () => number
  /** 轻提示通道（Shift 提示）；缺省不提示 */
  toast?: ResizeToastLike
  /** 相框圆角半径（px），缺省 0 */
  cornerRadius?: number
}

const ATTACHED_FLAG = 'vsidianResizeAttached'
/** Shift 提示的 toast 去重键（连续拖动不排队堆积，规格 §7.2） */
const SHIFT_HINT_TOAST_KEY = 'imageResize.shiftHint'

/**
 * 在图片相框内装配拖动手柄、光晕与读数（幂等）。
 *
 * 只做 DOM 装配；「这个 frame 该不该有手柄」由调用方判定（Live 的非排除
 * 图片）。返回 true 表示装配完成或此前已装配。
 */
export function attachResizeHandle(frame: HTMLElement, opts: AttachResizeHandleOptions): boolean {
  if ((frame as HTMLElement & Record<string, unknown>)[ATTACHED_FLAG] === true) {
    return true
  }
  const img = frame.querySelector<HTMLImageElement>('img')
  if (!img) {
    return false
  }
  ;(frame as HTMLElement & Record<string, unknown>)[ATTACHED_FLAG] = true

  const glow = document.createElement('span')
  glow.className = IMAGE_RESIZE_CLASS_NAMES.glow
  glow.setAttribute('aria-hidden', 'true')

  const readout = document.createElement('span')
  readout.className = IMAGE_RESIZE_CLASS_NAMES.readout
  readout.setAttribute('aria-hidden', 'true')

  const handle = document.createElement('button')
  handle.type = 'button'
  handle.className = IMAGE_RESIZE_CLASS_NAMES.handle
  const label = t('imageResize.handleAria')
  handle.setAttribute('aria-label', label)
  handle.setAttribute('data-tooltip', label)
  // 阻断 CM6 的点击落位（与图形按钮组同款防误触）——否则按下手柄会把
  // 选区打到 widget 起点、触发源码显形，手柄当场消失
  handle.addEventListener('mousedown', (event) => {
    event.preventDefault()
  })

  frame.append(glow, readout, handle)

  /** 光晕延伸距离与手柄贴合位：布局就绪前 rect 为 0，先写保底值，布局
   *  到位（img load / ResizeObserver）后收敛 */
  const applyGeometry = (): void => {
    const rect = frame.getBoundingClientRect()
    frame.style.setProperty('--vsidian-image-resize-glow', `${glowExtension(rect.width, rect.height)}px`)
    const layout = resizeHandleLayout({
      width: rect.width,
      height: rect.height,
      radius: opts.cornerRadius ?? 0,
    })
    handle.style.right = `${layout.right}px`
    handle.style.bottom = `${layout.bottom}px`
    positionReadout(layout.right, layout.bottom)
  }
  const positionReadout = (right: number, bottom: number): void => {
    // 读数浮在手柄上方，右缘与手柄右缘对齐（不遮住拖动的那个角）
    readout.style.right = `${right}px`
    readout.style.bottom = `${bottom + IMAGE_RESIZE_HIT_SIZE + 2}px`
  }
  applyGeometry()
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => {
      // widget 退场后 observer 必须自撤（否则闭包钉住整棵 DOM）
      if (!frame.isConnected) {
        observer.disconnect()
        return
      }
      applyGeometry()
    })
    observer.observe(frame)
  }
  img.addEventListener('load', applyGeometry)

  let drag: ActiveDrag | null = null

  const beginDrag = (event: PointerEvent): void => {
    if (event.button !== 0 || drag !== null) {
      return
    }
    const rect = img.getBoundingClientRect()
    if (!(rect.width > 0) || !(rect.height > 0)) {
      return // 未装载/不可见：无尺寸语义可拖
    }
    event.preventDefault()
    // 不 stopPropagation：拖动只是视觉操作，不应截断上层（如浮层关闭）
    // 的正常事件流；真正需要吞掉的是 mousedown 的落位（上面已 preventDefault）
    const start = opts.resolveStart()
    // F5：容器宽在拖动期间不变，beginDrag 解析一次缓存——move 路径的
    // 端口解析（findFromDOM + getComputedStyle + clientWidth）是纯浪费
    const containerWidthCache = opts.containerWidth?.() ?? Number.POSITIVE_INFINITY
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: rect.width,
      startHeight: rect.height,
      startDeclared: start.declared,
      start,
      startInlineWidth: img.style.width,
      startInlineHeight: img.style.height,
      containerWidth: containerWidthCache,
      moved: false,
      last: null,
    }
    handle.setPointerCapture?.(event.pointerId)
    frame.classList.add(IMAGE_RESIZE_RESIZING_CLASS)
    readout.dataset['visible'] = 'true'
    // Shift 已按住的人不需要被告知（规格 §7.2）
    if (!event.shiftKey) {
      opts.toast?.show(t('imageResize.toast.shiftHint'), 'neutral', SHIFT_HINT_TOAST_KEY)
    }
    // 移动/抬起挂 window：setPointerCapture 会把事件重定向到 handle，挂
    // img 上的监听收不到；window 同时覆盖「指针移出窗口」与无 capture
    // 环境，且捕获目标仍是本 handle（按 pointerId 守卫）
    window.addEventListener('pointermove', onPointerMove, true)
    window.addEventListener('pointerup', onPointerUp, true)
    window.addEventListener('pointercancel', onPointerCancel, true)
    window.addEventListener('keydown', onKeyDown, true)
  }

  const applyVisual = (size: ImageSize, event: PointerEvent): void => {
    const current = drag
    if (!current) {
      return
    }
    // 视觉一律折算为像素：百分比声明写 style.width='N%' 会让拖动跟随容器
    // 而非指针，指针位移与视觉反馈脱节；折算口径与装载链路同源
    // （percentToPxWidth：naturalWidth × N%，不取整）
    const naturalWidth = img.naturalWidth > 0 ? img.naturalWidth : current.startWidth
    const visualWidth = size.unit === 'percent'
      ? (percentToPxWidth(naturalWidth, size.width) ?? size.width)
      : size.width
    let visualHeight: number
    if (size.height !== null) {
      visualHeight = size.height
    } else if (current.startWidth > 0) {
      // 等比：按拖动起点的实际渲染比例跟随（与 computeResizeTarget 的
      // WxH 分支同一比例基准，视觉与写回不会两套数）
      visualHeight = (current.startHeight / current.startWidth) * visualWidth
    } else {
      visualHeight = img.naturalHeight > 0 && img.naturalWidth > 0
        ? (img.naturalHeight / img.naturalWidth) * visualWidth
        : visualWidth
    }
    img.style.width = `${visualWidth}px`
    img.style.height = `${visualHeight}px`
    readout.textContent = t('imageResize.readout', {
      width: Math.round(visualWidth),
      height: Math.max(1, Math.round(visualHeight)),
    })
    current.last = size
    current.moved =
      current.moved ||
      Math.abs(event.clientX - current.startX) > 0 ||
      Math.abs(event.clientY - current.startY) > 0
  }

  const onPointerMove = (event: PointerEvent): void => {
    const current = drag
    if (!current || event.pointerId !== current.pointerId) {
      return
    }
    event.preventDefault()
    applyVisual(
      computeResizeTarget({
        startWidth: current.startWidth,
        startHeight: current.startHeight,
        dx: event.clientX - current.startX,
        dy: event.clientY - current.startY,
        mode: event.shiftKey ? 'free' : 'proportional',
        declared: current.startDeclared,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        // F5：move 只用 beginDrag 的缓存值（容器宽拖动期间不变）
        containerWidth: current.containerWidth,
      }),
      event,
    )
  }

  const onPointerUp = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) {
      return
    }
    event.preventDefault()
    finish(true)
  }

  const onPointerCancel = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) {
      return
    }
    finish(false)
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !drag) {
      return
    }
    // 捕获阶段 + stopPropagation：拖动中的 Esc 属于「取消本次拖动」，不得
    // 同时被浮层/查找会话等上层消费（否则一次按键两处响应）
    event.preventDefault()
    event.stopPropagation()
    finish(false)
  }

  const finish = (commit: boolean): void => {
    const current = drag
    if (!current) {
      return
    }
    drag = null
    const size = current.last
    // 未移动 / Esc 中止 / 与起点声明等价：不写文档。`sameImageSize` 比的是
    // 源文声明而非渲染值——「原本无后缀、拖后恰好等于原渲染宽」仍算变化
    // （用户显式落了一个尺寸）；纯按下松手（moved=false）不产生空撤销步
    const changed = size !== null && current.moved && !sameImageSize(current.startDeclared, size)
    if (!commit) {
      img.style.width = current.startInlineWidth
      img.style.height = current.startInlineHeight
    } else if (changed) {
      // 提交时保留内联视觉：宿主写回 → doc.changed 回流之前不闪回旧尺寸
      opts.onCommit?.(size, current.start)
    } else {
      img.style.width = current.startInlineWidth
      img.style.height = current.startInlineHeight
    }
    cleanupDrag(current)
  }

  const cleanupDrag = (current: ActiveDrag): void => {
    try {
      if (handle.hasPointerCapture?.(current.pointerId)) {
        handle.releasePointerCapture(current.pointerId)
      }
    } catch {
      // 指针已释放（pointercancel / 元素退场）时 release 会抛
    }
    frame.classList.remove(IMAGE_RESIZE_RESIZING_CLASS)
    delete readout.dataset['visible']
    readout.textContent = ''
    window.removeEventListener('pointermove', onPointerMove, true)
    window.removeEventListener('pointerup', onPointerUp, true)
    window.removeEventListener('pointercancel', onPointerCancel, true)
    window.removeEventListener('keydown', onKeyDown, true)
  }

  handle.addEventListener('pointerdown', beginDrag)

  return true
}

interface ActiveDrag {
  pointerId: number
  startX: number
  startY: number
  startWidth: number
  startHeight: number
  startDeclared: ImageSize | null
  start: ResizeStart
  startInlineWidth: string
  startInlineHeight: string
  /** F5：beginDrag 解析一次的容器宽缓存（move 路径复用） */
  containerWidth: number
  /** 指针是否真的位移过（纯按下松手不产生空写回） */
  moved: boolean
  /** 最近一次算出的目标尺寸（pointerup 提交它） */
  last: ImageSize | null
}

export interface LiveImageResizeContext {
  /** 轻提示通道（缺省不提示：无 toast 面的装配不阻塞拖动） */
  toast?: ResizeToastLike
  /** 最大宽钳制基准（可读行宽）；缺省不钳制 */
  containerWidth?: () => number
  /** 相框圆角半径（px），缺省 0 */
  cornerRadius?: number
  /** 源文区间读取（缺省读 dataset 的 vsidian-src-from/to） */
  sourceRangeOf?: (frame: HTMLElement) => ImageSourceRange | null
  /**
   * 读源文整段（`![[…]]` 或 `![alt](dest)` 原文）。
   *
   * 提供时优先于内置的 CM6 文档读取——调用方（liveLinks 的 widget）已持有
   * 所属视图，且嵌入内部 Live 要走 B 实例自己的文档；本模块不猜视图。
   */
  readInner?: (frame: HTMLElement, range: ImageSourceRange) => string | null
  /**
   * 提交内层标签文本（已含新尺寸尾缀，不含 `![[ ]]` / `![ ]( )` 包裹）。
   *
   * 叫 inner 而非 source：包裹形态的还原由调用方的形态学负责（它知道
   * 原写法是双链还是直链、目标路径原样保留），本模块只负责尾缀段。
   */
  commitInner?: (frame: HTMLElement, range: ImageSourceRange, inner: string) => void
  /** 起点尺寸声明（缺省从 readInner 结果解析） */
  resolveDeclared?: (frame: HTMLElement, range: ImageSourceRange) => ImageSize | null
}

/**
 * Live 图片 frame 的接线入口。
 *
 * 区间来源二选一：调用方给 `sourceRangeOf`，或 widget 在 toDOM 时写了
 * `data-vsidian-src-from/to`。两者都没有则返回 false、不挂手柄——猜一个
 * 区间会写坏无关正文，安全降级优于「看起来接线完整」。
 *
 * 提交路径（默认）：读源文整段 → 只改内层尾缀 → 经该 frame 所属 CM6 视图
 * dispatch 一笔文档变更。变更走实例既有 updateListener → 单笔
 * edit.request（宿主聚合成一次 applyEdit），因此一次拖动天然是宿主撤销栈
 * 的一步（规格 §5.3）。调用方提供 `commitInner` 时改走它（嵌入内部 Live
 * 等自有出站通道）。
 */
/** 直链（`![alt](dest)`，非双链 `![[…]]`）的 inner 是裸 alt 段：单段尺寸
 *  走整段替换（bareAlt）；双链 inner 无管道时整段是目标路径，不得整段替换 */
function bareAltOfSource(sourceText: string): { bareAlt?: boolean } {
  return sourceText.startsWith('![') && !sourceText.startsWith('![[') ? { bareAlt: true } : {}
}

export function attachResizeHandleToLiveImage(
  frame: HTMLElement,
  ctx: LiveImageResizeContext = {},
): boolean {
  const range = ctx.sourceRangeOf?.(frame) ?? sourceRangeFromDataset(frame)
  if (range === null) {
    return false
  }
  const read = (target: HTMLElement, span: ImageSourceRange): string | null =>
    ctx.readInner ? ctx.readInner(target, span) : readLiveSource(target, span)
  return attachResizeHandle(frame, {
    resolveStart: () => {
      const sourceText = read(frame, range)
      return {
        declared: ctx.resolveDeclared
          ? ctx.resolveDeclared(frame, range)
          : declaredSizeOfSource(sourceText),
        source: range,
        // B6 滑移快照：commit 时重读比对，不一致即安全放弃（并发编辑会
        // 让固定区间覆盖到无关文本，写回会破坏正文）
        sourceText,
      }
    },
    onCommit: (size, start) => {
      const sourceText = read(frame, range)
      if (sourceText === null) {
        return
      }
      // B6：拖动期间源文滑移（区间读出与快照不一致）→ 放弃本次提交。
      // start.sourceText undefined 表示调用方自定义 resolveStart 未提供
      // 快照（旧用法不破坏），null 表示 beginDrag 时已读不到——两种都
      // 交给下方既有形态校验兜底
      if (start.sourceText !== undefined && sourceText !== start.sourceText) {
        return
      }
      if (ctx.commitInner) {
        // 调用方负责包裹还原：本模块只交出内层标签文本
        const inner = innerTextOfImageSource(sourceText)
        if (inner === null) {
          return
        }
        ctx.commitInner(frame, range, replaceSizeSuffix(inner, size, bareAltOfSource(sourceText)))
        return
      }
      commitLiveFrameSize(frame, range, size, sourceText)
    },
    ...(ctx.containerWidth ? { containerWidth: ctx.containerWidth } : {}),
    ...(ctx.toast ? { toast: ctx.toast } : {}),
    ...(ctx.cornerRadius !== undefined ? { cornerRadius: ctx.cornerRadius } : {}),
  })
}

/** 读 widget 写入源文区间的 dataset 约定（缺少或非法即 null） */
export function sourceRangeFromDataset(frame: HTMLElement): ImageSourceRange | null {
  const rawFrom = frame.dataset['vsidianSrcFrom']
  const rawTo = frame.dataset['vsidianSrcTo']
  if (rawFrom === undefined || rawTo === undefined) {
    return null
  }
  const from = Number.parseInt(rawFrom, 10)
  const to = Number.parseInt(rawTo, 10)
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || to <= from) {
    return null
  }
  return { from, to }
}

/** 从 frame 所属视图读源文整段（视图缺失或区间越界即 null） */
function readLiveSource(frame: HTMLElement, range: ImageSourceRange): string | null {
  const view = EditorView.findFromDOM(frame)
  if (!view) {
    return null
  }
  const length = view.state.doc.length
  if (range.from < 0 || range.to > length || range.to <= range.from) {
    return null
  }
  return view.state.doc.sliceString(range.from, range.to)
}

/** 起点尺寸声明：从源文整段解析（解析不出即 null = 视为无后缀） */
function declaredSizeOfSource(sourceText: string | null): ImageSize | null {
  if (sourceText === null) {
    return null
  }
  const inner = innerTextOfImageSource(sourceText)
  if (inner === null) {
    return null
  }
  const parts = inner.split('|')
  // 与 shared/imageSize 的 splitAliasAndSize 同口径：只认末段，非法值归
  // 别名（`|0` 不是尺寸，后续写回也不会替换它）
  for (let end = parts.length; end > 0; end--) {
    const segment = parts[end - 1]!
    if (segment.trim() === '') {
      continue
    }
    return parseImageSizeSuffix(segment)
  }
  return null
}

/**
 * 图片源文的「内层」文本与其在整段中的起点偏移。
 *
 * 尺寸后缀只活在内层（`![[` 之后 / `![` 之后、`](` 之前），定位到内层才
 * 能做最小编辑——整段替换会把用户写的包裹形态与目标路径也卷进一次变更，
 * 一旦形态学判断有偏差就会连带改写无关字符。
 */
export function innerSpanOfImageSource(sourceText: string): { text: string; start: number } | null {
  if (sourceText.startsWith('![[') && sourceText.endsWith(']]')) {
    return { text: sourceText.slice(3, -2), start: 3 }
  }
  if (!sourceText.startsWith('![')) {
    return null
  }
  const closeLabel = sourceText.indexOf(']')
  if (closeLabel < 0 || sourceText[closeLabel + 1] !== '(' || !sourceText.endsWith(')')) {
    return null
  }
  return { text: sourceText.slice(2, closeLabel), start: 2 }
}

/** 图片源文的「内层」文本（尺寸后缀所在层）；形态不可识别即 null */
function innerTextOfImageSource(sourceText: string): string | null {
  return innerSpanOfImageSource(sourceText)?.text ?? null
}

/** 提交：一笔文档变更只替换尾缀段（包裹形态与目标路径不进变更） */
function commitLiveFrameSize(
  frame: HTMLElement,
  range: ImageSourceRange,
  size: ImageSize,
  sourceText: string,
): void {
  const view = EditorView.findFromDOM(frame)
  if (!view) {
    return
  }
  const span = innerSpanOfImageSource(sourceText)
  if (span === null) {
    return // 形态不可识别：不写文档
  }
  const plan = planSizeSuffixRewrite(span.text, size, bareAltOfSource(sourceText))
  if (plan.inner === span.text) {
    return // 改写无变化：不产生空撤销步
  }
  // 最小编辑：只换 [from,to) 这一段（坐标由内层起点平移回全文）
  const from = range.from + span.start + plan.from
  const to = range.from + span.start + plan.to
  view.dispatch({ changes: { from, to, insert: plan.text } })
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function positiveOr(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
