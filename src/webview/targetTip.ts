// 跳转目标提示（#299）：悬停在引用上且本次悬停不会打开引用视图浮层时
// （判定由调用侧 syncController 各悬停入口按「浮层是否将现」门控后调
// 本模块——总开关开且触发条件满足的路径直接走浮层，不经此处），稳定
// 悬停后显示目标位置小浮标。规格 docs/specs/reference-view-group.md
// 「跳转目标提示行为」节（2026-10-02 修订版）。
//
// 呈现层完全复用统一自绘悬停提示体系（#300 tooltipCard）：同一
// vsidian-tooltip 族类名、同一 CSS（零新增类名/规则）、同一几何模块
// （tooltipGeometry 居中优先 + 上下翻转 + 视口钳制）与同一显示延迟变量
// （--vsidian-tooltip-show-delay，jsdom 读不到回 300ms 缺省）。驱动方式
// 为编程式而非 [data-tooltip] 属性委托——提示内容是宿主异步解析的结果
// （hover.target.resolve 回包），属性委托的事件驱动模型无法承载「事件
// 已过后值才就位」的时序，这是不改造 tooltipCard 委托层的唯一差异点；
// 显示后的行为语义（保活/滚动即收/持焦 Esc 收起还焦/悬停态不接管 Esc）
// 与 tooltipCard 逐条对齐。
//
// 轻量硬边界：目标解析经宿主轻量消息 hover.target.resolve（只解析不读
// 正文——不进 hover.request/watch 的文档读取与租约链路）；解析失败或
// 未回包不出提示。同一目标重复悬停命中内存短缓存（成功与失败都缓存，
// 有界 LRU，不落盘），不重复请求。
//
// 不进弹窗互斥锁（popupMutex）：行为矩阵已保证「浮层开则提示关」——
// 浮层打开路径（hoverPopup）联动调 closeTargetTip（含悬停中补按 Ctrl
// 的立即消失），无需互斥协调；与统一 tooltip 体系同款不 claim 不抢占。
import type { HoverPopupTargetSpec } from './hoverPopup'
import type { TargetTipResolved, WebviewToHost } from '../shared/protocol'
import { TOOLTIP_CLASS_NAMES, resolveShowDelay } from './tooltipCard'
import { planTooltipPlacement } from './tooltipGeometry'

/** 出站上下文（syncController mount 注入；dispose 清空） */
export interface TargetTipContext {
  /** 会话身份（init 前为 undefined——此时不出提示） */
  session(): { sessionId: string | undefined; docUri: string | undefined }
  /** 出站通道（hover.target.resolve 只读消息，不进 edit.request 通道） */
  send(message: WebviewToHost): void
  /** hover.targetTip 设置的只读投影：false = 不计时不出提示（缺省视为开） */
  enabled?(): boolean
}

/** 目标缓存容量（同一目标文字重复悬停不重复请求；成功与失败都缓存，
 *  有界防无界增长——插入序 = 淘汰序） */
const TARGET_TIP_CACHE_LIMIT = 32

type CachedTarget = { relPath: string; anchor: string } | null

interface PendingTip {
  anchor: HTMLElement
  spec: HoverPopupTargetSpec
  timer: number | undefined
  /** 已发出的解析请求代次（回包配对；未发出为 undefined） */
  reqId: number | undefined
}

let context: TargetTipContext | null = null
let pending: PendingTip | null = null
let shown: { anchor: HTMLElement; text: string } | null = null
let reqSeq = 0
/** 回包在途查找表（reqId → 归属 pending 代次）；迟到回包据此丢弃 */
const inflight = new Map<number, PendingTip>()
/** 目标解析短缓存（key 含 docUri——跨文档天然分离；null = 已知失败） */
const cache = new Map<string, CachedTarget>()
let container: HTMLElement | null = null
let textEl: HTMLElement | null = null
let listeners: Array<() => void> = []

/** 缓存键：会话文档 + 目标三形态（与 hover.request 的目标语义同源） */
function cacheKeyOf(docUri: string, spec: HoverPopupTargetSpec): string {
  return [
    docUri,
    spec.target,
    spec.linkHref ?? '',
    spec.directFsPath ?? '',
    spec.directAnchor ?? '',
  ].join('|')
}

/** LRU 触达：命中重插队尾（插入序 = 淘汰序，embedCard 先例） */
function cacheGet(key: string): { hit: boolean; value: CachedTarget | undefined } {
  if (!cache.has(key)) {
    return { hit: false, value: undefined }
  }
  const value = cache.get(key)!
  cache.delete(key)
  cache.set(key, value)
  return { hit: true, value }
}

function cachePut(key: string, value: CachedTarget): void {
  if (cache.has(key)) {
    cache.delete(key)
  }
  cache.set(key, value)
  if (cache.size > TARGET_TIP_CACHE_LIMIT) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) {
      cache.delete(oldest)
    }
  }
}

/** 提示容器：与统一小卡片同结构（容器 + 文本 span；目标提示无键位徽章） */
function ensureContainer(): HTMLElement {
  if (container?.isConnected) {
    return container
  }
  container = document.createElement('div')
  container.className = TOOLTIP_CLASS_NAMES.card
  container.tabIndex = 0
  container.setAttribute('role', 'tooltip')
  textEl = document.createElement('span')
  textEl.className = TOOLTIP_CLASS_NAMES.text
  container.appendChild(textEl)
  const host = document.getElementById('app') ?? document.body
  host.appendChild(container)
  return container
}

/** 定位：统一几何模块（居中优先 + 上下翻转 + 视口钳制） */
function place(anchor: HTMLElement, el: HTMLElement): void {
  const rect = anchor.getBoundingClientRect()
  const plan = planTooltipPlacement({
    anchor: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
    tip: { width: el.offsetWidth, height: el.offsetHeight },
    viewport: { width: window.innerWidth, height: window.innerHeight },
  })
  el.style.left = `${plan.left}px`
  el.style.top = `${plan.top}px`
}

/** 显示提示（回包/缓存命中共用）：锚点仍连接才显示 */
function show(anchor: HTMLElement, relPath: string, anchorSuffix: string): void {
  if (!anchor.isConnected) {
    return
  }
  const el = ensureContainer()
  textEl!.textContent = `${relPath}${anchorSuffix}`
  el.classList.add(TOOLTIP_CLASS_NAMES.shown)
  shown = { anchor, text: `${relPath}${anchorSuffix}` }
  place(anchor, el)
  ensureListeners()
}

/** 收起提示（外部联动/离开/脱树/Esc 共用；幂等） */
function hide(): void {
  if (shown === null) {
    return
  }
  shown = null
  container?.classList.remove(TOOLTIP_CLASS_NAMES.shown)
  if (textEl !== null) {
    textEl.textContent = ''
  }
}

/** 清理待开（含在途登记） */
function cancelPending(): void {
  if (pending === null) {
    return
  }
  if (pending.timer !== undefined) {
    window.clearTimeout(pending.timer)
  }
  if (pending.reqId !== undefined) {
    inflight.delete(pending.reqId)
  }
  pending = null
}

/** 注入/清空出站上下文（syncController mount/dispose） */
export function setTargetTipContext(ctx: TargetTipContext | null): void {
  context = ctx
  if (!ctx) {
    cancelPending()
    hide()
    releaseListeners()
    // 上下文销毁（面板关闭）连带清缓存与容器——缓存不落盘、生命周期
    // 随会话
    cache.clear()
    container?.remove()
    container = null
    textEl = null
  }
}

/** 浮层打开联动收起（hoverPopup 打开路径调用——含悬停中补按 Ctrl 的
 *  立即消失；「浮层开则提示关」，不进互斥锁的行为面表达） */
export function closeTargetTip(): void {
  cancelPending()
  hide()
}

/** 触发上下文失效的域释放（面板重渲染 replaceChildren / 面板隐藏 /
 *  切面板，与 hoverPopup 的 closeHoverPopupIfAnchorWithin 同款）：在场
 *  提示或待开计时的锚点落在失效域内即收；域外提示不动。面板条目 DOM
 *  重建不派发 mouseout，依赖此处显式释放 */
export function closeTargetTipIfAnchorWithin(scope: ParentNode): void {
  if (pending !== null && scope.contains(pending.anchor)) {
    cancelPending()
  }
  if (shown !== null && scope.contains(shown.anchor)) {
    hide()
  }
}

/** 进入悬停目标（调用侧已判定「浮层不将现」：总开关关、Live 修饰位
 *  不足或总开关关时的面板/阅读路径）。spec 与浮层入口同源
 *  （HoverPopupTargetSpec——target/linkHref/directFsPath/directAnchor） */
export function targetTipAnchorEnter(anchor: HTMLElement, spec: HoverPopupTargetSpec): void {
  if (context?.enabled?.() === false) {
    return
  }
  const session = context?.session()
  if (!context || !session?.sessionId || !session.docUri) {
    return
  }
  const sessionId = session.sessionId
  const docUri = session.docUri
  if (pending !== null && pending.anchor === anchor && pending.reqId === undefined) {
    return // 同锚点待开：保留首次进入起算的计时（浮层入口同款语义）
  }
  cancelPending()
  hide() // 换锚点：在场提示先行收起
  const state: PendingTip = { anchor, spec, timer: undefined, reqId: undefined }
  pending = state
  const delay = resolveShowDelay(ensureContainer())
  state.timer = window.setTimeout(() => {
    state.timer = undefined
    if (pending !== state) {
      return
    }
    const cached = cacheGet(cacheKeyOf(docUri, spec))
    if (cached.hit && cached.value !== undefined) {
      if (cached.value !== null) {
        show(anchor, cached.value.relPath, cached.value.anchor)
        pending = null
      } else {
        pending = null // 已知失败：不出提示不重复请求
      }
      return
    }
    const reqId = ++reqSeq
    state.reqId = reqId
    inflight.set(reqId, state)
    context!.send({
      kind: 'hover.target.resolve',
      sessionId,
      docUri,
      reqId,
      ...(spec.linkHref !== undefined
        ? { linkHref: spec.linkHref }
        : spec.directFsPath !== undefined
          ? {
              directTarget: {
                fsPath: spec.directFsPath,
                ...(spec.directAnchor ? { anchor: spec.directAnchor } : {}),
              },
            }
          : { target: spec.target }),
    })
  }, delay)
}

/** 离开悬停目标（调用侧 mouseout 委托转发；relatedTarget 落在提示本体
 *  内 = 联合域保活不收——统一 tooltip 语义） */
export function targetTipAnchorLeave(anchor: HTMLElement, relatedTarget?: Node | null): void {
  if (pending !== null && pending.anchor === anchor) {
    cancelPending()
  }
  if (shown !== null && shown.anchor === anchor) {
    if (relatedTarget instanceof Node && container?.contains(relatedTarget)) {
      return // 移入提示本体：保活（文字可选中复制）
    }
    hide()
  }
}

/** 宿主解析结果路由（syncController handleHostMessage 转发）：reqId
 *  配对在途请求才生效——迟到/陈旧回包丢弃；成功显示（锚点仍连接），
 *  失败静默（不出提示）；两种结果都进缓存（同目标不重复请求）。消息
 *  形状取协议单点类型 TargetTipResolved（hover.target.resolved 成员），
 *  协议演进与本函数签名联动 */
export function notifyTargetTipResolved(message: TargetTipResolved): void {
  const state = inflight.get(message.reqId)
  if (state === undefined) {
    return
  }
  inflight.delete(message.reqId)
  const docUri = context?.session().docUri
  if (!docUri) {
    return
  }
  cachePut(
    cacheKeyOf(docUri, state.spec),
    message.ok ? { relPath: message.relPath, anchor: message.anchor ?? '' } : null,
  )
  if (pending === state) {
    pending = null
  }
  if (!message.ok) {
    return
  }
  if (!state.anchor.isConnected) {
    return // 悬停目标已脱树（视口虚拟化回收）：不显示
  }
  if (shown !== null) {
    hide()
  }
  show(state.anchor, message.relPath, message.anchor ?? '')
}

/** 悬停态不接管 Esc（统一 tooltip 语义：不与其他浮层的 Esc 链冲突）；
 *  提示自身持有焦点时 Esc 收起并还焦触发元素 */
function onKeydownCapture(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || shown === null || container === null) {
    return
  }
  if (document.activeElement !== container) {
    return // 悬停态：不拦截（外层浮层/编辑器的 Esc 语义照常）
  }
  event.stopImmediatePropagation()
  const returnFocus = shown.anchor
  hide()
  cancelPending()
  if (returnFocus instanceof HTMLElement && returnFocus.isConnected) {
    returnFocus.focus()
  }
}

/** 滚动即收（capture 各滚动容器）——统一 tooltip 语义；同时覆盖「目标
 *  脱树」（视口虚拟化回收伴随滚动）的消失触发 */
function onScrollCapture(): void {
  cancelPending()
  hide()
}

/** 焦点进入提示外的元素：收起（让位键盘焦点路径——统一委托层 focusin
 *  即显其他提示时目标提示不同屏滞留） */
function onFocusIn(event: FocusEvent): void {
  if (shown === null || container === null) {
    return
  }
  const target = event.target
  if (target instanceof Node && container.contains(target)) {
    return
  }
  hide()
}

function ensureListeners(): void {
  if (listeners.length > 0) {
    return
  }
  document.addEventListener('keydown', onKeydownCapture, true)
  document.addEventListener('scroll', onScrollCapture, true)
  document.addEventListener('focusin', onFocusIn)
  listeners = [
    () => document.removeEventListener('keydown', onKeydownCapture, true),
    () => document.removeEventListener('scroll', onScrollCapture, true),
    () => document.removeEventListener('focusin', onFocusIn),
  ]
}

function releaseListeners(): void {
  for (const cleanup of listeners.splice(0)) cleanup()
}

/** 提示在场观测（view.state 探针与测试共用素材） */
export function targetTipProbe(): { open: boolean; text: string } {
  return { open: shown !== null, text: shown?.text ?? '' }
}

/** 测试隔离：清空模块级单例状态（生产不调用） */
export function __resetTargetTipForTest(): void {
  cancelPending()
  hide()
  releaseListeners()
  inflight.clear()
  cache.clear()
  container?.remove()
  container = null
  textEl = null
  context = null
  reqSeq = 0
}
