// 悬停文档预览浮层（工单 #218，ADR-0009「展示容器」层的悬停侧）：父文档
// Reading 中悬停双链/本地 Markdown 链接 → 经文档访问通道（hover.request /
// hover.result）读取目标 → 以只读 Reading 内容显示目标全文/章节/块。
//
// 交互契约（规格 docs/specs/hover-preview-embed.md 一期）：
// - 进入链接延迟开（防扫过误开）；鼠标离开链接与浮层后延迟关；移入浮层
//   保活（可滚动、可选字复制）；Esc 关闭；父容器滚动/浮层锚点脱树即释放。
// - 默认宽 480px / 最大高 400px；四边翻转与视口钳制见 hoverPopupGeometry；
//   内容装载变高与窗口缩放经 ResizeObserver/resize 重定位。
// - 一次一个浮层：经 popupMutex 与图表/图片弹窗互斥（claim 时在场的其他
//   弹窗先关）。鼠标路径零抢焦点（不 focus 任何元素）。
// - 异步迟到响应不得重开已关闭浮层：结果只作用于「在场且 instanceId 与
//   reqId 双匹配」的实例，关闭即释放实例身份。
// - 只读呈现：任务 checkbox 禁用（JS disabled + CSS pointer-events 双保险）
//   ——浮层内容没有任何写回通道。
//
// #221 全入口悬停（本工单）：
// - 显式目标入口 openHoverPopupFor：Live 正文装饰 DOM 与面板条目不是
//   `<a href>`（Live 是 CM6 mark/widget span，面板是卡片/按钮元素），目标
//   形态由调用方组装成 HoverPopupTargetSpec（双链 target / 普通链接
//   linkHref / 面板直接目标 directFsPath±directAnchor）——Reading 锚点
//   路径（hoverPreviewAnchorEnter）内部提取后走同一入口，三入口共用同一
//   开闭时序、保活与迟到守卫。
// - 键盘模态 openHoverPopupForKeyboard：「预览当前链接」命令的手动打开
//   路径——焦点进入浮层（容器 tabIndex=-1 可编程聚焦，不进 Tab 序），
//   Esc 关闭后返还触发处焦点；焦点在浮层内部时不因鼠标离开或父容器滚动
//   销毁键盘操作现场（#220 已知张力的调整——纯键盘遍历不应触发鼠标域
//   的关闭规则）；鼠标悬停路径零抢焦点契约不变。
// - 面板/切模式等触发上下文失效：closeHoverPopupIfAnchorWithin 按锚点
//   所在域释放（面板重渲染 replaceChildren 后锚点脱树，不依赖迟到检测）。
//
// #220 引用 Reading 内容：
// - 来源资源：浮层内容（B 文档）的图片以 **B 身份资源管理器** 装载——
//   image.request 附 sourceDocUri（B 的 fsPath），宿主按 B 目录走同一
//   classifyImageTarget 白名单与 asWebviewUri 机制；https 直连图源不经
//   宿主。B 管理器生命周期 = 浮层实例（关闭即 dispose，无残留订阅）。
// - 浮层内链接可点击：B 内双链/普通链接/外链经既有 open 通道（附
//   sourceDocUri，宿主按 B 解析与分类）；点击即跳转意图 = 上下文切换，
//   浮层关闭。浮层不在 readingContainer 委托域内，不叠加新悬停浮层。
// - 笔记属性区（仅全文引用）：frontmatter 块挂折叠区——默认折叠，标题
//   整行是悬停热区（hover/focus 显示切换按钮，点击按钮切换，非悬停自动
//   展开）；本次打开内保留展开状态（同实例内容重放 = 刷新，不重置），
//   重新打开恢复折叠。降级 frontmatter 合成同构标题行（原文不丢弃）。
//   章节/块引用与无 frontmatter 文档不显示属性区。
// - 代码高亮：沿用现有引擎的朴素形态（token span 注入，无卡片工具条）。
// - 主题与片段：浮层挂 #app 内（fixed 定位不受影响）——#app 的主题变量
//   与 `#app .vsidian-view-reading …` 正文样式、已启用 CSS 片段（别名桥
//   类名）天然命中，不为浮层复制第二套主题环境。
//
// 复用先例：定位/保活参照 frontmatterPopover（fixed、捕获阶段 Esc），异步
// 代次守卫参照 diagramPopup（loadSeq），互斥经 popupMutex，出站上下文经
// setter 注入（imagePopup 的 setImagePopupContext 形态；syncController
// mount 注入、dispose 清空）。
import {
  ImageResourceManager,
  type ImageResultPayload,
} from './imageResource'
import { createReadingContainer, READING_CLASS_NAMES } from './readingView'
import { VirtualReadingView } from './readingVirtualView'
import { claimPopup, releasePopup } from './popupMutex'
import { WIKILINK_CLASS_NAMES } from '../shared/wikilink'
import {
  createSourcedImageManager as createSourcedImageManagerImpl,
  mountRefContentBlock,
  refErrorText,
  REF_FM_CLASS_NAMES,
  type RefFmController,
} from './refReadingContent'
import { t } from '../shared/i18n'
import { shouldApplyHoverVersion } from '../shared/hoverRefresh'
import type { HoverPreviewResult, WebviewToHost } from '../shared/protocol'
import {
  HOVER_POPUP_DEFAULT_WIDTH,
  HOVER_POPUP_MAX_HEIGHT,
  planHoverPopupPlacement,
} from './hoverPopupGeometry'

/** 悬停稳定类名（样式契约 chrome 域 hover-popup 条目同源） */
export const HOVER_POPUP_CLASS_NAMES = {
  /** 浮层容器（fixed 定位，挂 #app） */
  popup: 'vsidian-hover-popup',
  /** 内容滚动区（移入保活后的滚动承载） */
  scroll: 'vsidian-hover-popup-scroll',
  /** 就地状态行（loading / 错误分态） */
  state: 'vsidian-hover-popup-state',
  /** 错误分态修饰（验收反馈：错误文案与普通文字区分——主题错误色，
   *  一眼可辨「文件问题」而非正文内容；loading 不挂） */
  stateError: 'vsidian-hover-popup-state-error',
} as const

/** 工程初值（规格：悬停开闭延迟按现有约定与测量确定；#221 设置项接入后
 *  仍以此为缺省）——进入链接 300ms 后开（防指针扫过误开），离开联合域
 *  350ms 后关（链接↔浮层间移动的容差） */
export const HOVER_POPUP_OPEN_DELAY_MS = 300
export const HOVER_POPUP_CLOSE_DELAY_MS = 350

/** 普通链接可预览性预滤（#219）：外部网页（带 scheme 或协议相对地址）与
 *  空 href 不接入悬停预览——本地相对路径与页内锚点（#frag）放行，宿主侧
 *  classifyLinkTarget 复核兜底（预滤与宿主判定同口径，双保险）。双链不
 *  经此判定（vsidian-wikilink 类即双链形态，目标原文不是 URL） */
const EXTERNAL_LINK_HREF_RE = /^(?:[a-zA-Z][a-zA-Z0-9+.\-]*:|\/\/)/
export function isHoverableMdLinkHref(href: string): boolean {
  return href !== '' && !EXTERNAL_LINK_HREF_RE.test(href)
}

/** 锚点是否双链（vsidian-wikilink 类 = markdown-it 双链规则写入；普通
 *  Markdown 链接是其余 a[href]） */
function anchorIsWikilink(anchor: HTMLElement): boolean {
  return anchor.classList.contains(WIKILINK_CLASS_NAMES.wikilink)
}

/** #221 显式目标规格：Live 装饰 DOM 与面板条目不是 `<a href>`，目标形态
 *  由调用方组装（双链 target 原文 / 普通链接 linkHref / 面板直接目标
 *  directFsPath±directAnchor）；Reading 锚点路径由 hoverPopupSpecOfAnchor 提取后
 *  走同一入口 */
export interface HoverPopupTargetSpec {
  /** 目标原文（双链 `|` 前 target / 链接 href / 面板条目显示名——错误
   *  分态文案的目标原文取材） */
  target: string
  /** 普通链接形态（宿主走 readHoverMdLinkTarget）；缺省 = 双链形态 */
  linkHref?: string
  /** 面板直接目标 fsPath（宿主直读不走文本解析）；空串 = 断链出链条目
   *  （宿主回 not-found 分态） */
  directFsPath?: string
  /** 面板直接目标锚点（标题原文或 ^块id；缺省/空串 = 全文） */
  directAnchor?: string
  /** 父文档内引用区间（LF 偏移；面板反链条目的引用区间在来源文档而非
   *  当前文档，给 0/0 中性值） */
  sourceStart: number
  sourceEnd: number
}

/** 从 Reading 锚点提取目标规格（href 原文 + 所在块源锚点；预滤口径见
 *  isHoverableMdLinkHref——外部链接不开浮层）；非法目标返回 null。
 *  #221 导出：键盘命令的 Reading 分支复用同一提取（聚焦链接 → spec） */
export function hoverPopupSpecOfAnchor(anchor: HTMLElement): HoverPopupTargetSpec | null {
  const target = anchor.getAttribute('href')
  if (target === null) {
    return null
  }
  if (!anchorIsWikilink(anchor) && !isHoverableMdLinkHref(target)) {
    return null
  }
  const block = anchor.closest<HTMLElement>('[data-vsidian-src-start]')
  const sourceStart = Number(block?.dataset['vsidianSrcStart'] ?? 0)
  const sourceEnd = Number(block?.dataset['vsidianSrcEnd'] ?? sourceStart)
  return {
    target,
    ...(anchorIsWikilink(anchor) ? {} : { linkHref: target }),
    sourceStart: Number.isInteger(sourceStart) ? sourceStart : 0,
    sourceEnd: Number.isInteger(sourceEnd) ? sourceEnd : sourceStart,
  }
}

/** 出站上下文（syncController mount 注入；dispose 清空） */
export interface HoverPreviewContext {
  /** 会话身份（init 前为 undefined——此时不开浮层） */
  session(): { sessionId: string | undefined; docUri: string | undefined }
  /** 出站通道（hover.request / image.request / link.activate 等只读消息，
   *  不进 edit.request 通道） */
  send(message: WebviewToHost): void
  /** #220 代码高亮开关（面板 codeCardConfig.highlight 的只读投影；缺省开） */
  codeHighlight?(): boolean
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
  /** #221 目标原文（错误分态文案取材；三入口同源——不再读锚点 href） */
  target: string
  /** #224 打开时的目标规格（订阅刷新重发 hover.request 的载荷来源） */
  spec: HoverPopupTargetSpec
  /** #219 语义范围选择器探针：收到成功回包前为空串 */
  scope: 'full' | 'heading' | 'block' | ''
  /** #220 当前目标 fsPath（成功回包送达；B 身份图片/链接的 sourceDocUri） */
  targetFsPath: string
  /** #224 已应用的目标内容版本（-1 = 从未应用；旧回包按版本仲裁丢弃） */
  appliedVersion: number
  /** #224 订阅目标（hover.watch 登记后的 fsPath；null = 未订阅——成功
   *  装载前无目标身份。变更刷新经 hover.invalidated 推送，关闭即 unwatch） */
  watchedFsPath: string | null
  /** #220 笔记属性区展开状态：实例内保持（刷新不重置），重开复位（openPopup
   *  置 false）。属性区状态机的单一事实源，DOM 只读此值施加 */
  fmExpanded: boolean
  /** #220 B 身份资源管理器（成功回包时创建；关闭随实例 dispose） */
  bImages: ImageResourceManager | null
  /** #221 键盘模态：命令手动打开（焦点进入浮层 + Esc 返还触发处） */
  keyboardOpened: boolean
  /** #221 键盘打开前的焦点元素（关闭时返还；body/脱树不返还） */
  prevFocus: HTMLElement | null
  closeTimer: number | undefined
  cleanups: Array<() => void>
}

let context: HoverPreviewContext | null = null
let popup: HoverPopupState | null = null
let pendingOpen: { anchor: HTMLElement; timer: number; spec?: HoverPopupTargetSpec } | null = null
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
  /** #220 属性区三态（none = 无属性区：非全文范围或无 frontmatter） */
  fm: 'none' | 'collapsed' | 'expanded'
  /** #220 浮层内已应用 src 的图片地址（B 身份资源解析观测面） */
  imageSrcs: string[]
} {
  if (!popup || popup.display !== 'content') {
    return { open: popup !== null, state: popup?.display ?? 'loading', note: popup?.note ?? '', blocks: 0, scope: popup?.scope ?? '', fm: 'none', imageSrcs: [] }
  }
  const fmSection = popup.contentEl.querySelector(`.${REF_FM_CLASS_NAMES.section}`)
  const imageSrcs: string[] = []
  for (const img of Array.from(popup.contentEl.querySelectorAll('img'))) {
    const src = img.getAttribute('src')
    if (src !== null && src !== '') {
      imageSrcs.push(src)
    }
  }
  return {
    open: true,
    state: popup.display,
    note: popup.note,
    blocks: popup.contentEl.querySelectorAll(`.${READING_CLASS_NAMES.block}`).length,
    scope: popup.scope,
    fm: fmSection ? (popup.fmExpanded ? 'expanded' : 'collapsed') : 'none',
    imageSrcs,
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
  // #221 键盘模态保活：焦点在浮层内部时不因鼠标离开（联合域 mouseleave
  // 的延迟关闭源）而销毁键盘操作现场——规格「焦点在浮层内部时不能仅因
  // 鼠标离开而销毁」；焦点离开浮层后恢复常规鼠标关闭语义
  if (keyboardKeepAlive()) {
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

/** #221 键盘模态在场判定：命令手动打开且焦点在浮层内（Tab 遍历浮层内容
 *  时同样成立——focus 落在浮层内任意后代） */
function keyboardKeepAlive(): boolean {
  return popup !== null && popup.keyboardOpened && popup.container.contains(document.activeElement)
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
  // 期望高按最大高常量规划（400 上限；内容更矮时 max-height 不抬高度，
  // 自然高度不受影响）。不得喂加载期实测高：inline maxHeight 会把
  // offsetHeight 钳在旧值，后续重定位永远读到冻结值——浮层在内容装载后
  // 塌缩成 loading 态高度（#218 遗留缺陷，#220 浏览器属性区场景暴露：
  // 指针落点被推出浮层外触发误关闭；按 400 规划后翻转决策也取最坏情况，
  // 内容长高不再跳变）
  const height = HOVER_POPUP_MAX_HEIGHT
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
  // 错误分态挂错误修饰类（主题错误色），loading/content 摘除
  state.stateEl.classList.toggle(HOVER_POPUP_CLASS_NAMES.stateError, display === 'error')
  if (display === 'content') {
    state.stateEl.style.display = 'none'
    state.scrollEl.style.display = ''
  } else {
    state.stateEl.style.display = ''
    state.scrollEl.style.display = 'none'
    state.stateEl.textContent = note
  }
}

/** #220 B 身份资源管理器（共享工厂 refReadingContent.createSourcedImageManager；
 *  无周期核验接线——浮层短生命周期，文件变化的自动失效广播不在本票，
 *  手动刷新通道见 invalidateHoverPopupImages） */
function createSourcedImageManager(state: HoverPopupState): ImageResourceManager {
  const ctx = context
  return createSourcedImageManagerImpl({
    session: () => (ctx ? ctx.session() : { sessionId: undefined, docUri: undefined }),
    send: (message) => ctx?.send(message),
    sourceDocUri: () => state.targetFsPath,
  })
}

/** 块挂载钩子（虚拟化与无布局回退两路径共用）：共享只读装配（#222 提取
 *  至 refReadingContent.mountRefContentBlock——嵌入卡片同款消费） */
function mountBlockInto(state: HoverPopupState, el: HTMLElement): void {
  mountRefContentBlock(el, {
    images: state.bImages,
    codeHighlight: context?.codeHighlight?.() ?? true,
    fm: state.scope === 'full' ? fmControllerOf(state) : null,
  })
}

/** 属性区折叠状态机（容器侧实现：fmExpanded 单一事实源在本实例 state） */
function fmControllerOf(state: HoverPopupState): RefFmController {
  return {
    expanded: () => state.fmExpanded,
    toggle: () => (state.fmExpanded = !state.fmExpanded),
  }
}

/** #221 打开选项：键盘模态（命令手动打开——焦点进入浮层，关闭返还） */
interface HoverPopupOpenOptions {
  keyboard?: boolean
  prevFocus?: HTMLElement | null
}

/** 打开浮层（三入口共用核心）：目标规格由调用方给出——Reading 锚点路径
 *  经 hoverPopupSpecOfAnchor 提取，Live 装饰/面板条目由 syncController 组装（见
 *  HoverPopupTargetSpec）。非法目标（null spec）不开 */
function openPopup(anchor: HTMLElement, spec: HoverPopupTargetSpec | null, options?: HoverPopupOpenOptions): void {
  const session = context?.session()
  if (!context || !session?.sessionId || !session.docUri || spec === null) {
    return
  }
  closeHoverPopup()
  const container = document.createElement('div')
  container.className = HOVER_POPUP_CLASS_NAMES.popup
  // #221 可编程聚焦锚（键盘模态 focus 进浮层；tabIndex=-1 不进 Tab 序，
  // 鼠标路径不受影响）
  container.tabIndex = -1
  const stateEl = document.createElement('div')
  stateEl.className = HOVER_POPUP_CLASS_NAMES.state
  const scrollEl = document.createElement('div')
  scrollEl.className = HOVER_POPUP_CLASS_NAMES.scroll
  const contentEl = createReadingContainer()
  scrollEl.appendChild(contentEl)
  container.appendChild(stateEl)
  container.appendChild(scrollEl)
  // #220 主题与片段：挂 #app 内（生产 webview 恒有 #app；jsdom 测试环境
  // 回退 body）——#app 的主题变量与正文样式（#app .vsidian-view-reading …）
  // 随之命中，fixed 定位不受祖先影响（#app 无 transform/filter 包含块）
  const host = document.getElementById('app') ?? document.body
  host.appendChild(container)

  const instanceId = `hover-${++instanceSeq}`
  const reqId = ++reqSeq
  // 钩子闭包经 stateRef 延迟取值（构造后立即赋值；挂载钩子只会在
  // setDocument 之后触发，无空窗）
  let stateRef: HoverPopupState
  const view = new VirtualReadingView(contentEl, {
    onBlockMounted: (el) => mountBlockInto(stateRef, el),
    onBlockUnmounted: (el) => stateRef.bImages?.detachWithin(el),
  })
  const state: HoverPopupState = {
    instanceId,
    reqId,
    anchor,
    container,
    scrollEl,
    stateEl,
    contentEl,
    view,
    display: 'loading',
    note: '',
    target: spec.target,
    spec,
    scope: '',
    targetFsPath: '',
    appliedVersion: -1,
    watchedFsPath: null,
    fmExpanded: false,
    bImages: null,
    keyboardOpened: options?.keyboard === true,
    prevFocus: options?.prevFocus ?? null,
    closeTimer: undefined,
    cleanups: [],
  }
  stateRef = state
  popup = state
  claimPopup(closeHoverPopup)
  applyDisplay(state, 'loading', t('hover.loading'))
  position(state)
  if (state.keyboardOpened) {
    // 键盘打开：焦点进入浮层（Esc 关闭后返还 prevFocus——见 closeHoverPopup）
    container.focus()
  }

  // #220 浮层内链接点击：B 内双链/普通链接/外链经既有 open 通道（附
  // sourceDocUri，宿主按 B 解析与分类）——preventDefault 阻断 webview
  // 原生导航（与主视图点击委托同口径）；点击即上下文切换，浮层关闭。
  // 浮层不在 readingContainer 委托域内：悬停不叠加新浮层（规格一期）
  contentEl.addEventListener('click', (event) => {
    const hit = event.target as HTMLElement | null
    const linkAnchor = hit?.closest?.('a')
    if (!(linkAnchor instanceof HTMLElement) || !contentEl.contains(linkAnchor)) {
      return
    }
    event.preventDefault()
    const href = linkAnchor.getAttribute('href')
    if (href === null) {
      return // 渲染层已净化的危险链接（无 href）
    }
    const ctx = context
    const session = ctx?.session()
    if (!ctx || !session?.sessionId || !session.docUri || !state.targetFsPath) {
      return // 无会话或无 B 身份（loading/错误态无内容链接；防御）
    }
    const linkBlock = linkAnchor.closest<HTMLElement>('[data-vsidian-src-start]')
    const srcStart = Number(linkBlock?.dataset['vsidianSrcStart'] ?? 0)
    const srcEnd = Number(linkBlock?.dataset['vsidianSrcEnd'] ?? srcStart)
    const base = {
      sessionId: session.sessionId,
      docUri: session.docUri,
      srcStart: Number.isInteger(srcStart) ? srcStart : 0,
      srcEnd: Number.isInteger(srcEnd) ? srcEnd : srcStart,
      sourceDocUri: state.targetFsPath,
    }
    if (anchorIsWikilink(linkAnchor)) {
      ctx.send({ kind: 'wikilink.activate', target: href, ...base })
    } else {
      ctx.send({ kind: 'link.activate', href, ...base })
    }
    closeHoverPopup()
  })

  // 键盘：Esc 关闭（捕获阶段拦截，不外溢宿主键绑定；关闭时键盘模态返还
  // 触发处焦点——见 closeHoverPopup）
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      closeHoverPopup()
    }
  }
  document.addEventListener('keydown', onKeydown, true)
  state.cleanups.push(() => document.removeEventListener('keydown', onKeydown, true))

  // 移入保活 / 移出延迟关闭（联合域 = 锚点 ∪ 浮层；键盘模态的保活豁免
  // 在 scheduleClose 内判定——焦点在浮层内时鼠标离开不销毁键盘现场）
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

  // 父容器滚动：锚点视口位置失效，立即关闭（浮层自身滚动区在联合域内不受影响）；
  // #221 键盘模态且焦点在浮层内时豁免——Tab 遍历浮层内容触发的程序性滚动
  // 不得销毁键盘操作现场（#220 已知张力的调整）
  const onScroll = (event: Event): void => {
    if (popup && event.target instanceof Node && !popup.container.contains(event.target) && !keyboardKeepAlive()) {
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

  // 出站读取请求（只读消息：不进 edit.request 通道）。#219 普通链接形态
  // 附 linkHref（宿主走 readHoverMdLinkTarget）；#221 面板直接目标附
  // directTarget（宿主直读）；target 恒为目标原文（双链即 `|` 前原文，
  // 链接即 href，面板条目即显示名——错误分态文案的目标原文来源）
  context.send({
    kind: 'hover.request',
    sessionId: session.sessionId,
    docUri: session.docUri,
    reqId,
    instanceId,
    sourceStart: spec.sourceStart,
    sourceEnd: spec.sourceEnd,
    target: spec.target,
    ...(spec.linkHref !== undefined ? { linkHref: spec.linkHref } : {}),
    ...(spec.directFsPath !== undefined
      ? {
          directTarget: {
            fsPath: spec.directFsPath,
            ...(spec.directAnchor ? { anchor: spec.directAnchor } : {}),
          },
        }
      : {}),
  })
}

/** #221 显式目标入口（Live 装饰 / 面板条目 / 键盘命令共用）：目标形态由
 *  调用方组装（普通链接的外部 scheme 预滤由调用方用 isHoverableMdLinkHref
 *  判定——与 Reading 路径同口径） */
export function openHoverPopupFor(anchor: HTMLElement, spec: HoverPopupTargetSpec): void {
  openPopup(anchor, spec)
}

/** #221 键盘命令入口（「预览当前链接」的手动打开）：记录触发处焦点，
 *  打开后焦点进入浮层；Esc 关闭后返还（body/脱树不返还） */
export function openHoverPopupForKeyboard(anchor: HTMLElement, spec: HoverPopupTargetSpec): void {
  const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null
  openPopup(anchor, spec, { keyboard: true, prevFocus: prev })
}

/** 进入链接（Reading 容器 mouseover 委托转发；#221 Live 悬停同入口——
 *  装饰 DOM 无 href，spec 由调用方组装传入）：同锚点重入取消待关；换
 *  锚点先关旧再延迟开新。修 6（review 第二轮）：同一锚点已有 pendingOpen
 *  时不重建开设计时——嵌套行内标记链接（如 [**粗体**](x.md)）内跨子
 *  元素移动触发多次 mouseover（联合域内移动的 mouseout 被调用方过滤，
 *  无对应 leave），每次重建 300ms timer 会把浮层推迟到指针静止 */
export function hoverPreviewAnchorEnter(anchor: HTMLElement, spec?: HoverPopupTargetSpec): void {
  if (popup && popup.anchor === anchor) {
    cancelCloseTimer()
    return
  }
  if (pendingOpen && pendingOpen.anchor === anchor) {
    return // 同锚点待开：保留首次进入起算的计时（目标由锚点身份决定）
  }
  cancelPendingOpen()
  if (popup) {
    closeHoverPopup()
  }
  const timer = window.setTimeout(() => {
    pendingOpen = null
    openPopup(anchor, spec ?? hoverPopupSpecOfAnchor(anchor))
  }, HOVER_POPUP_OPEN_DELAY_MS)
  pendingOpen = { anchor, timer, spec }
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

/** 关闭并释放实例（显式关闭 / 上下文失效 / dispose 路径共用；幂等）。
 *  #221 键盘模态：关闭后返还触发处焦点（prevFocus 脱树或 body 不返还——
 *  程序化打开时无真实先前焦点可回） */
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
  // #224 订阅随实例释放（关闭浮层 = 订阅计数回落；宿主侧按实例退订）
  if (state.watchedFsPath !== null) {
    sendWatchMessage(state.watchedFsPath, state.instanceId, 'hover.unwatch')
  }
  for (const cleanup of state.cleanups) {
    cleanup()
  }
  state.view.dispose() // 卸载块 → onBlockUnmounted 释放图片槽位
  state.bImages?.dispose() // #220 B 管理器随实例释放（兜底；槽位已随块卸载释放）
  state.container.remove()
  releasePopup(closeHoverPopup)
  if (state.keyboardOpened && state.prevFocus !== null && state.prevFocus.isConnected) {
    state.prevFocus.focus()
  }
}

/** #221 触发上下文失效的域释放（面板重渲染 replaceChildren / 面板隐藏 /
 *  切面板）：在场浮层的锚点落在失效域内即释放实例；域外浮层不动。面板
 *  条目 DOM 重建不派发 mouseout，依赖此处显式释放 */
export function closeHoverPopupIfAnchorWithin(scope: ParentNode): void {
  if (popup && scope.contains(popup.anchor)) {
    closeHoverPopup()
  }
}

/** #220 内容应用（成功回包 / 同实例刷新共用入口）：**不重置 fmExpanded**
 *  ——刷新（目标内容变化引发的重建，#224 经 hover.invalidated 驱动同实例
 *  重发请求）保留属性展开状态；重开（新实例）才恢复默认折叠。#224 起
 *  刷新保持滚动位置（内容重建前保存 scrollTop、重建后回写——内容缩短时
 *  浏览器按 scrollHeight 合法钳制）并登记目标订阅（hover.watch） */
function applyHoverContent(state: HoverPopupState, message: Extract<HoverPreviewResult, { ok: true }>): void {
  const keepScroll = state.scrollEl.scrollTop // #224 刷新前保存（首载为 0）
  state.scope = message.scope.kind
  state.targetFsPath = message.target.fsPath
  state.appliedVersion = message.version
  if (!state.bImages) {
    state.bImages = createSourcedImageManager(state)
  }
  // #219 局部范围：全文切块后按块区间求交过滤（保留全文解析上下文，
  // 不孤立解析截取字符串；范围选取见 VirtualReadingView.setDocument）
  state.view.setDocument(message.text, message.scope.kind === 'full' ? undefined : { range: message.range })
  state.view.updateNow()
  // 全部任务 checkbox 禁用（挂载钩子已覆盖虚拟化路径；此处为无布局
  // 回退全量渲染路径的兜底——双保险，幂等）
  for (const box of Array.from(state.contentEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
    box.disabled = true
  }
  applyDisplay(state, 'content', message.target.relPath)
  // #224 滚动位置恢复（刷新路径：内容重建后回写；内容缩短合法钳制）
  if (keepScroll > 0) {
    state.scrollEl.scrollTop = keepScroll
  }
  ensureWatch(state, message.target.fsPath)
}

/** #224 登记目标订阅（成功装载后；目标身份变化先释放旧订阅） */
function ensureWatch(state: HoverPopupState, fsPath: string): void {
  if (state.watchedFsPath === fsPath) {
    return
  }
  if (state.watchedFsPath !== null) {
    sendWatchMessage(state.watchedFsPath, state.instanceId, 'hover.unwatch')
  }
  state.watchedFsPath = fsPath
  sendWatchMessage(fsPath, state.instanceId, 'hover.watch')
}

/** #224 订阅消息出站（会话守卫字段与 hover.request 同款） */
function sendWatchMessage(
  fsPath: string,
  instanceId: string,
  kind: 'hover.watch' | 'hover.unwatch',
): void {
  const session = context?.session()
  if (!context || !session?.sessionId || !session.docUri) {
    return
  }
  context.send({ kind, sessionId: session.sessionId, docUri: session.docUri, fsPath, instanceId })
}

/** 宿主读取结果（syncController handleHostMessage 转发）：
 *  仅当场内实例、instanceId 与 reqId 双匹配的结果生效——迟到/陈旧回包
 *  丢弃，绝不重开已关闭浮层。#224 版本仲裁：成功回包的目标版本低于已
 *  应用版本（慢响应旧内容）整体丢弃，不冒充新目标 */
export function notifyHoverResult(message: HoverPreviewResult): void {
  if (!popup || message.instanceId !== popup.instanceId || message.reqId !== popup.reqId) {
    return
  }
  if (message.ok && !shouldApplyHoverVersion(popup.appliedVersion, message.version)) {
    return
  }
  if (message.ok) {
    applyHoverContent(popup, message)
  } else {
    // #221 目标原文取 state（三入口同源——面板条目/Live 装饰无 href 属性）
    applyDisplay(popup, 'error', refErrorText(message.reason, popup.target, message.anchor))
  }
  position(popup)
}

/**
 * #224 目标失效推送（syncController 转发 hover.invalidated）：仅作用于
 * 订阅该目标的在场浮层实例。分态：
 * - changed：同实例新 reqId 重发读取（迟到的旧 reqId 回包被守卫丢弃）；
 *   刷新期间保留当前内容与滚动（不闪 loading），回包到达重建。
 * - deleted：确认删除撤下内容（清空视图 + not-found 分态就地呈现），
 *   不无限保留旧内容；订阅保持（恢复 changed 推送可重载）。
 * - stale：权限/断连读取失败分态（read-failed 文案；不等同删除）。
 * 同面板消息 FIFO，代次单调由宿主协调器保证——不做乱序丢弃。
 */
export function notifyHoverInvalidated(message: {
  fsPath: string
  status: 'changed' | 'deleted' | 'stale'
  generation: number
}): void {
  const state = popup
  if (!state || state.watchedFsPath !== message.fsPath) {
    return
  }
  if (message.status === 'changed') {
    const session = context?.session()
    if (!context || !session?.sessionId || !session.docUri) {
      return
    }
    state.reqId = ++reqSeq // 新请求代次：旧 reqId 迟到回包因配对失败丢弃
    // 修 7（review 第二轮）：版本谱系断点自愈——watch 目标文档被宿主
    // 释放重开（TextDocument.version 重置变小）时，回包 version <
    // appliedVersion 会被版本仲裁恒拒且无重发通道，旧内容滞留。changed
    // 重发前置 appliedVersion = -1 让版本防线短暂让位：迟到的旧回包仍由
    // instanceId + reqId 配对守卫拦截（上一行已推进 reqId），安全
    state.appliedVersion = -1
    context.send({
      kind: 'hover.request',
      sessionId: session.sessionId,
      docUri: session.docUri,
      reqId: state.reqId,
      instanceId: state.instanceId,
      sourceStart: state.spec.sourceStart,
      sourceEnd: state.spec.sourceEnd,
      target: state.spec.target,
      ...(state.spec.linkHref !== undefined ? { linkHref: state.spec.linkHref } : {}),
      ...(state.spec.directFsPath !== undefined
        ? {
            directTarget: {
              fsPath: state.spec.directFsPath,
              ...(state.spec.directAnchor ? { anchor: state.spec.directAnchor } : {}),
            },
          }
        : {}),
    })
    return
  }
  // deleted / stale：撤下内容显示分态（视图清空防 display 反转后旧内容
  // 闪现；fm/滚动状态在实例 state 保留，恢复重载后无需重取）
  state.view.setDocument('')
  state.view.updateNow()
  state.bImages?.dispose()
  state.bImages = null
  state.targetFsPath = ''
  state.scope = ''
  applyDisplay(
    state,
    'error',
    refErrorText(message.status === 'deleted' ? 'not-found' : 'read-failed', state.target),
  )
  position(state)
}

/** #220 image.result 路由（syncController 转发）：作用于在场浮层的 B 管理
 *  器——未知 reqId 由管理器自身丢弃（主面板管理器同款守卫，双投递安全） */
export function notifyHoverImageResult(msg: ImageResultPayload): void {
  popup?.bImages?.handleResult(msg)
}

/** #220 image.invalidate 路由（syncController 转发）：命中条目撤旧图重发
 *  （B 身份新请求；未命中条目由管理器忽略） */
export function notifyHoverImageInvalidate(srcs: readonly string[]): void {
  popup?.bImages?.invalidate(srcs)
}

/** #220 手动刷新失效（refresh.invalidated 路由）：B 管理器全量失效重挂
 *  （活跃槽位重新走宿主解析，新 URI 带新代次戳） */
export function invalidateHoverPopupImages(): void {
  popup?.bImages?.invalidateAll()
}

/** 测试隔离：清空模块级单例状态（生产不调用） */
export function __resetHoverPopupForTest(): void {
  closeHoverPopup()
  context = null
  instanceSeq = 0
  reqSeq = 0
}
