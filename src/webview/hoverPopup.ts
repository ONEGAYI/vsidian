// 悬停文档预览浮层（工单 #218，ADR-0009「展示容器」层的悬停侧）：父文档
// Reading 中悬停双链 → 经文档访问通道（hover.request/hover.result）读取
// 目标 → 以只读 Reading 内容显示目标全文。
//
// 交互契约（规格 docs/specs/hover-preview-embed.md 一期）：
// - 进入链接延迟开（防扫过误开）；鼠标离开链接与浮层后延迟关；移入浮层
//   保活（可滚动、可选字复制）；Esc 关闭；父容器滚动/浮层锚点脱树即释放。
// - 默认宽 480px / 最大高 400px；四边翻转与视口钳制见 hoverPopupGeometry；
//   内容装载变高与窗口缩放经 ResizeObserver/resize 重定位。
// - 一次一个浮层：经 popupMutex 与图表/图片弹窗互斥（claim 时在场的其他
//   弹窗先关）。鼠标路径零抢焦点（不 focus 任何元素——键盘打开属 #221）。
// - 异步迟到响应不得重开已关闭浮层：结果只作用于「在场且 instanceId 与
//   reqId 双匹配」的实例，关闭即释放实例身份。
// - 只读呈现：任务 checkbox 禁用（JS disabled + CSS pointer-events 双保险）
//   ——浮层内容没有任何写回通道；图片经注入的父面板资源管理器按现有能力
//   装载（B 文档为来源的资源解析强化属 #220）。
//
// 复用先例：定位/保活参照 frontmatterPopover（fixed 挂 body、捕获阶段
// Esc），异步代次守卫参照 diagramPopup（loadSeq），互斥经 popupMutex，
// 出站上下文经 setter 注入（imagePopup 的 setImagePopupContext 形态；
// syncController mount 注入、dispose 清空）。
import type { ImageResourceManager } from './imageResource'
import { createReadingContainer, prepareReadingImages, READING_CLASS_NAMES } from './readingView'
import { VirtualReadingView } from './readingVirtualView'
import { renderGraphicBlockInto } from './graphicRenderers'
import { claimPopup, releasePopup } from './popupMutex'
import { t } from '../shared/i18n'
import type { HoverPreviewFailReason, HoverPreviewResult, WebviewToHost } from '../shared/protocol'
import {
  HOVER_POPUP_DEFAULT_WIDTH,
  planHoverPopupPlacement,
} from './hoverPopupGeometry'

/** 悬停稳定类名（样式契约 chrome 域 hover-popup 条目同源） */
export const HOVER_POPUP_CLASS_NAMES = {
  /** 浮层容器（fixed 定位，挂 body） */
  popup: 'vsidian-hover-popup',
  /** 内容滚动区（移入保活后的滚动承载） */
  scroll: 'vsidian-hover-popup-scroll',
  /** 就地状态行（loading / 错误分态） */
  state: 'vsidian-hover-popup-state',
} as const

/** 工程初值（规格：悬停开闭延迟按现有约定与测量确定；#221 设置项接入后
 *  仍以此为缺省）——进入链接 300ms 后开（防指针扫过误开），离开联合域
 *  350ms 后关（链接↔浮层间移动的容差） */
export const HOVER_POPUP_OPEN_DELAY_MS = 300
export const HOVER_POPUP_CLOSE_DELAY_MS = 350

/** 出站上下文（syncController mount 注入；dispose 清空） */
export interface HoverPreviewContext {
  /** 会话身份（init 前为 undefined——此时不开浮层） */
  session(): { sessionId: string | undefined; docUri: string | undefined }
  /** 出站通道（hover.request；只读消息，不进 edit.request 通道） */
  send(message: WebviewToHost): void
  /** 父面板图片资源管理器（浮层内图片按现有能力装载；#218 不为 B 文档
   *  另建解析身份——来源资源强化属 #220）。getter 形态：dispose 顺序中
   *  管理器先于上下文清空退场，迟到的块卸载经 undefined 跳过 */
  images?(): ImageResourceManager | undefined
}

interface HoverPopupState {
  instanceId: string
  reqId: number
  anchor: HTMLElement
  container: HTMLElement
  scrollEl: HTMLElement
  stateEl: HTMLElement
  contentEl: HTMLElement
  view: VirtualReadingView
  /** loading → content / error（结果只接受一次：陈旧回包丢弃） */
  display: 'loading' | 'content' | 'error'
  note: string
  /** #219 语义范围选择器探针：收到成功回包前为空串 */
  scope: 'full' | 'heading' | 'block' | ''
  closeTimer: number | undefined
  cleanups: Array<() => void>
}

let context: HoverPreviewContext | null = null
let popup: HoverPopupState | null = null
let pendingOpen: { anchor: HTMLElement; timer: number } | null = null
let instanceSeq = 0
let reqSeq = 0

/** 注入/清空出站上下文（syncController mount/dispose） */
export function setHoverPreviewContext(ctx: HoverPreviewContext | null): void {
  context = ctx
  if (!ctx) {
    cancelPendingOpen()
    closeHoverPopup()
  }
}

export function isHoverPopupOpen(): boolean {
  return popup !== null
}

/** 悬停预览观测探针（view.state.hoverPreview 的数据源） */
export function hoverPopupProbe(): {
  open: boolean
  state: 'loading' | 'content' | 'error'
  note: string
  blocks: number
  scope: 'full' | 'heading' | 'block' | ''
} {
  if (!popup) {
    return { open: false, state: 'loading', note: '', blocks: 0, scope: '' }
  }
  return {
    open: true,
    state: popup.display,
    note: popup.note,
    blocks: popup.contentEl.querySelectorAll(`.${READING_CLASS_NAMES.block}`).length,
    scope: popup.scope,
  }
}

function cancelPendingOpen(): void {
  if (pendingOpen !== null) {
    window.clearTimeout(pendingOpen.timer)
    pendingOpen = null
  }
}

function cancelCloseTimer(): void {
  if (popup && popup.closeTimer !== undefined) {
    window.clearTimeout(popup.closeTimer)
    popup.closeTimer = undefined
  }
}

function scheduleClose(): void {
  if (!popup) {
    return
  }
  cancelCloseTimer()
  popup.closeTimer = window.setTimeout(() => {
    if (popup) {
      popup.closeTimer = undefined
      closeHoverPopup()
    }
  }, HOVER_POPUP_CLOSE_DELAY_MS)
}

/** 锚点与浮层联合域之外的指针位置判定（保活边界） */
function insideJointDomain(state: HoverPopupState, node: Node | null): boolean {
  if (!node) {
    return false
  }
  return state.container.contains(node) || state.anchor.contains(node)
}

/** 摆放：按锚点实测包围盒 + 当前内容自然尺寸计划并落位（内容变高、窗口
 *  缩放、锚点脱树均经此收敛） */
function position(state: HoverPopupState): void {
  if (!state.anchor.isConnected) {
    // 锚点块被虚拟化回收/视图重建：触发上下文失效，释放实例
    closeHoverPopup()
    return
  }
  const anchorRect = state.anchor.getBoundingClientRect()
  const width = state.container.offsetWidth || HOVER_POPUP_DEFAULT_WIDTH
  const height = state.container.offsetHeight || 96
  const placement = planHoverPopupPlacement({
    anchor: {
      left: anchorRect.left,
      top: anchorRect.top,
      right: anchorRect.right,
      bottom: anchorRect.bottom,
    },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    size: { width, height },
  })
  state.container.style.left = `${placement.left}px`
  state.container.style.top = `${placement.top}px`
  state.container.style.width = `${placement.width}px`
  // 最大高由几何计划钳制（常规 = 400 上限；小视口收缩）
  state.container.style.maxHeight = `${placement.height}px`
}

function applyDisplay(state: HoverPopupState, display: 'loading' | 'content' | 'error', note: string): void {
  state.display = display
  state.note = note
  if (display === 'content') {
    state.stateEl.style.display = 'none'
    state.scrollEl.style.display = ''
  } else {
    state.stateEl.style.display = ''
    state.scrollEl.style.display = 'none'
    state.stateEl.textContent = note
  }
}

function openPopup(anchor: HTMLElement): void {
  const session = context?.session()
  const target = anchor.getAttribute('href')
  if (!context || !session?.sessionId || !session.docUri || target === null) {
    return
  }
  closeHoverPopup()
  const container = document.createElement('div')
  container.className = HOVER_POPUP_CLASS_NAMES.popup
  const stateEl = document.createElement('div')
  stateEl.className = HOVER_POPUP_CLASS_NAMES.state
  const scrollEl = document.createElement('div')
  scrollEl.className = HOVER_POPUP_CLASS_NAMES.scroll
  const contentEl = createReadingContainer()
  scrollEl.appendChild(contentEl)
  container.appendChild(stateEl)
  container.appendChild(scrollEl)
  document.body.appendChild(container)

  const instanceId = `hover-${++instanceSeq}`
  const reqId = ++reqSeq
  // 父引用区间：锚点所在阅读块的源锚点（与点击委托同款取值）
  const block = anchor.closest<HTMLElement>('[data-vsidian-src-start]')
  const sourceStart = Number(block?.dataset['vsidianSrcStart'] ?? 0)
  const sourceEnd = Number(block?.dataset['vsidianSrcEnd'] ?? sourceStart)

  const state: HoverPopupState = {
    instanceId,
    reqId,
    anchor,
    container,
    scrollEl,
    stateEl,
    contentEl,
    view: new VirtualReadingView(contentEl, {
      // 只读装配：图片按现有能力装载 + 图形块渲染；任务禁写在挂载钩子内
      // 逐块施加（虚拟化下滚动新挂的块同样覆盖）
      onBlockMounted: (el) => {
        for (const box of Array.from(el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
          box.disabled = true
        }
        const images = context?.images?.()
        if (images) {
          prepareReadingImages(el, images)
        }
        renderGraphicBlockInto(el)
      },
      onBlockUnmounted: (el) => context?.images?.()?.detachWithin(el),
    }),
    display: 'loading',
    note: '',
    scope: '',
    closeTimer: undefined,
    cleanups: [],
  }
  popup = state
  claimPopup(closeHoverPopup)
  applyDisplay(state, 'loading', t('hover.loading'))
  position(state)

  // 键盘：Esc 关闭（捕获阶段拦截，不外溢宿主键绑定）；键盘打开浮层属
  // #221——当前路径零抢焦点，Esc 是唯一的键盘出口
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      closeHoverPopup()
    }
  }
  document.addEventListener('keydown', onKeydown, true)
  state.cleanups.push(() => document.removeEventListener('keydown', onKeydown, true))

  // 移入保活 / 移出延迟关闭（联合域 = 锚点 ∪ 浮层）
  container.addEventListener('mouseenter', () => cancelCloseTimer())
  container.addEventListener('mouseleave', () => scheduleClose())
  // 联合域内的指针按下不关闭（选字复制起点）；域外按下立即关（点击别处
  // = 明确的上下文切换）
  const onPointerDown = (event: PointerEvent): void => {
    if (popup && event.target instanceof Node && !insideJointDomain(popup, event.target)) {
      closeHoverPopup()
    }
  }
  document.addEventListener('pointerdown', onPointerDown, true)
  state.cleanups.push(() => document.removeEventListener('pointerdown', onPointerDown, true))

  // 父容器滚动：锚点视口位置失效，立即关闭（浮层自身滚动区在联合域内不受影响）
  const onScroll = (event: Event): void => {
    if (popup && event.target instanceof Node && !popup.container.contains(event.target)) {
      closeHoverPopup()
    }
  }
  window.addEventListener('scroll', onScroll, true)
  state.cleanups.push(() => window.removeEventListener('scroll', onScroll, true))

  // 窗口缩放 / 内容变高重定位
  const onResize = (): void => {
    if (popup) {
      position(popup)
    }
  }
  window.addEventListener('resize', onResize)
  state.cleanups.push(() => window.removeEventListener('resize', onResize))
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => {
      if (popup) {
        position(popup)
      }
    })
    observer.observe(container)
    state.cleanups.push(() => observer.disconnect())
  }

  // 出站读取请求（只读消息：不进 edit.request 通道）
  context.send({
    kind: 'hover.request',
    sessionId: session.sessionId,
    docUri: session.docUri,
    reqId,
    instanceId,
    sourceStart: Number.isInteger(sourceStart) ? sourceStart : 0,
    sourceEnd: Number.isInteger(sourceEnd) ? sourceEnd : sourceStart,
    target,
  })
}

/** 进入链接（Reading 容器 mouseover 委托转发）：同锚点重入取消待关；
 *  换锚点先关旧再延迟开新 */
export function hoverPreviewAnchorEnter(anchor: HTMLElement): void {
  if (popup && popup.anchor === anchor) {
    cancelCloseTimer()
    return
  }
  cancelPendingOpen()
  if (popup) {
    closeHoverPopup()
  }
  const timer = window.setTimeout(() => {
    pendingOpen = null
    openPopup(anchor)
  }, HOVER_POPUP_OPEN_DELAY_MS)
  pendingOpen = { anchor, timer }
}

/** 离开链接（Reading 容器 mouseout 委托转发；联合域内的移动由调用方过滤） */
export function hoverPreviewAnchorLeave(anchor: HTMLElement): void {
  if (pendingOpen && pendingOpen.anchor === anchor) {
    cancelPendingOpen()
  }
  if (popup && popup.anchor === anchor) {
    scheduleClose()
  }
}

/** 关闭并释放实例（显式关闭 / 上下文失效 / dispose 路径共用；幂等） */
export function closeHoverPopup(): void {
  cancelPendingOpen()
  const state = popup
  if (!state) {
    return
  }
  popup = null
  if (state.closeTimer !== undefined) {
    window.clearTimeout(state.closeTimer)
  }
  for (const cleanup of state.cleanups) {
    cleanup()
  }
  state.view.dispose() // 卸载块 → onBlockUnmounted 释放图片槽位
  state.container.remove()
  releasePopup(closeHoverPopup)
}

/** 宿主读取结果（syncController handleHostMessage 转发）：
 *  仅当场内实例、instanceId 与 reqId 双匹配的结果生效——迟到/陈旧回包
 *  丢弃，绝不重开已关闭浮层 */
export function notifyHoverResult(message: HoverPreviewResult): void {
  if (!popup || message.instanceId !== popup.instanceId || message.reqId !== popup.reqId) {
    return
  }
  if (message.ok) {
    popup.scope = message.scope.kind
    popup.view.setDocument(message.text)
    popup.view.updateNow()
    // 全部任务 checkbox 禁用（挂载钩子已覆盖虚拟化路径；此处为无布局
    // 回退全量渲染路径的兜底——双保险，幂等）
    for (const box of Array.from(popup.contentEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
      box.disabled = true
    }
    applyDisplay(popup, 'content', message.target.relPath)
  } else {
    applyDisplay(popup, 'error', hoverErrorText(message.reason, popup.anchor.getAttribute('href') ?? '', message.anchor))
  }
  position(popup)
}

/** 错误分态 → 就地 i18n 文案（不弹宿主通知；anchor-missing 附锚点原文） */
function hoverErrorText(reason: HoverPreviewFailReason, target: string, anchor?: string): string {
  switch (reason) {
    case 'unsupported':
      return t('hover.errorUnsupported')
    case 'no-workspace':
      return t('hover.errorNoWorkspace')
    case 'escape':
      return t('hover.errorEscape')
    case 'not-found':
      return t('hover.errorNotFound', { target })
    case 'non-markdown':
      return t('hover.errorNonMarkdown', { target })
    case 'read-failed':
      return t('hover.errorReadFailed')
    case 'anchor-missing':
      return t('hover.errorAnchorMissing', { target, anchor: anchor ?? '' })
  }
}

/** 测试隔离：清空模块级单例状态（生产不调用） */
export function __resetHoverPopupForTest(): void {
  closeHoverPopup()
  context = null
  instanceSeq = 0
  reqSeq = 0
}
