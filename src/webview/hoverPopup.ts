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
//   弹窗先关）。鼠标路径零抢焦点（不 focus 任何元素——键盘打开属 #221）。
// - 异步迟到响应不得重开已关闭浮层：结果只作用于「在场且 instanceId 与
//   reqId 双匹配」的实例，关闭即释放实例身份。
// - 只读呈现：任务 checkbox 禁用（JS disabled + CSS pointer-events 双保险）
//   ——浮层内容没有任何写回通道。
//
// #220 引用 Reading 内容（本工单）：
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
  isDirectImageSrc,
  type ImageResultPayload,
} from './imageResource'
import { createReadingContainer, prepareReadingImages, READING_CLASS_NAMES } from './readingView'
import { VirtualReadingView } from './readingVirtualView'
import { renderGraphicBlockInto } from './graphicRenderers'
import { decorateReadingCodeCard, isReadingCodeBlock } from './readingCodeCard'
import { claimPopup, releasePopup } from './popupMutex'
import { WIKILINK_CLASS_NAMES } from '../shared/wikilink'
import { buildFrontmatterHeaderHtml, escapeHtml } from '../shared/frontmatterTable'
import { t } from '../shared/i18n'
import type { HoverPreviewFailReason, HoverPreviewResult, WebviewToHost } from '../shared/protocol'
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
} as const

/** #220 笔记属性区稳定类名（样式契约 chrome 域 hover-fm-section 条目同源） */
export const HOVER_FM_CLASS_NAMES = {
  /** 属性区修饰（挂浮层内 frontmatter 块；仅全文引用） */
  section: 'vsidian-hover-fm',
  /** 展开/折叠切换按钮（标题栏内；hover/focus 显示） */
  toggle: 'vsidian-hover-fm-toggle',
  /** 收起态修饰（行与降级源码块隐藏，标题行保留） */
  collapsed: 'vsidian-hover-fm-collapsed',
} as const

/** 与 shared/frontmatterTable 的 buildFrontmatterHeaderHtml 同源的标题栏
 *  类名（查询用；shared 侧为内联字符串无导出常量） */
const FM_HEADER_CLASS = 'vsidian-fm-header'

/** 切换按钮 chevron（向下 = 展开；收起态 CSS 旋转 -90° 指向右） */
const HOVER_FM_TOGGLE_ICON_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" ' +
  'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M4 6l4 4 4-4"></path></svg>'

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
  /** #219 语义范围选择器探针：收到成功回包前为空串 */
  scope: 'full' | 'heading' | 'block' | ''
  /** #220 当前目标 fsPath（成功回包送达；B 身份图片/链接的 sourceDocUri） */
  targetFsPath: string
  /** #220 笔记属性区展开状态：实例内保持（刷新不重置），重开复位（openPopup
   *  置 false）。属性区状态机的单一事实源，DOM 只读此值施加 */
  fmExpanded: boolean
  /** #220 B 身份资源管理器（成功回包时创建；关闭随实例 dispose） */
  bImages: ImageResourceManager | null
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
  /** #220 属性区三态（none = 无属性区：非全文范围或无 frontmatter） */
  fm: 'none' | 'collapsed' | 'expanded'
  /** #220 浮层内已应用 src 的图片地址（B 身份资源解析观测面） */
  imageSrcs: string[]
} {
  if (!popup || popup.display !== 'content') {
    return { open: popup !== null, state: popup?.display ?? 'loading', note: popup?.note ?? '', blocks: 0, scope: popup?.scope ?? '', fm: 'none', imageSrcs: [] }
  }
  const fmSection = popup.contentEl.querySelector(`.${HOVER_FM_CLASS_NAMES.section}`)
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
  if (display === 'content') {
    state.stateEl.style.display = 'none'
    state.scrollEl.style.display = ''
  } else {
    state.stateEl.style.display = ''
    state.scrollEl.style.display = 'none'
    state.stateEl.textContent = note
  }
}

/** #220 B 身份资源管理器：请求一律附 sourceDocUri（宿主按 B 目录解析，
 *  会话守卫字段仍是面板自身）。无周期核验接线——浮层短生命周期（边界：
 *  文件变化的自动失效广播不在本票，手动刷新通道见 invalidateHoverPopupImages） */
function createSourcedImageManager(state: HoverPopupState): ImageResourceManager {
  return new ImageResourceManager({
    isDirectSrc: isDirectImageSrc,
    requestHost: (src, reqId) => {
      const ctx = context
      const session = ctx?.session()
      if (!ctx || !session?.sessionId || !session.docUri || !state.targetFsPath) {
        return // 无会话或无 B 身份：不发（宿主无从解析）
      }
      ctx.send({
        kind: 'image.request',
        sessionId: session.sessionId,
        docUri: session.docUri,
        reqId,
        src,
        sourceDocUri: state.targetFsPath,
      })
    },
  })
}

/** 块挂载钩子（虚拟化与无布局回退两路径共用）：只读装配 + B 身份图片 +
 *  图形块渲染 + 代码高亮 + 笔记属性区 */
function mountBlockInto(state: HoverPopupState, el: HTMLElement): void {
  for (const box of Array.from(el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
    box.disabled = true
  }
  if (state.bImages) {
    prepareReadingImages(el, state.bImages)
  }
  renderGraphicBlockInto(el)
  // #220 代码高亮：朴素形态（card=false——无头部/行号/按钮；token span 直
  // 接注入 code）。卡片工具条不进浮层：复制按钮的会话语义（codeblock.copy
  // 按面板文档 EOL 归一）与折叠/折行的全局联动属主视图行为
  if (isReadingCodeBlock(el)) {
    decorateReadingCodeCard(el, {
      config: {
        card: false,
        lineNumbers: false,
        copyButton: false,
        highlight: context?.codeHighlight?.() ?? true,
      },
      folded: false,
      onCopy: () => undefined,
      onFoldToggle: () => undefined,
    })
  }
  applyHoverFmSection(state, el)
}

/** #220 笔记属性区施加（幂等；虚拟化重挂载时按 state.fmExpanded 重建）：
 *  仅全文引用（章节/块引用不附带属性区）；成型态复用阅读侧标题栏，降级
 *  态合成同构标题栏（源码原文不丢弃，仅收起时隐藏） */
function applyHoverFmSection(state: HoverPopupState, el: HTMLElement): void {
  if (state.scope !== 'full' || !el.classList.contains(READING_CLASS_NAMES.frontmatter)) {
    return
  }
  el.classList.add(HOVER_FM_CLASS_NAMES.section)
  let header = el.querySelector<HTMLElement>(`.${FM_HEADER_CLASS}`)
  if (!header) {
    // 降级 frontmatter：合成与成型态同构的标题栏（图标 + 标题同源构件）
    header = document.createElement('div')
    header.className = FM_HEADER_CLASS
    header.innerHTML = buildFrontmatterHeaderHtml(escapeHtml(t('frontmatter.title')))
    el.insertBefore(header, el.firstChild)
  }
  let btn = header.querySelector<HTMLButtonElement>(`.${HOVER_FM_CLASS_NAMES.toggle}`)
  if (!btn) {
    btn = document.createElement('button')
    btn.type = 'button'
    btn.className = HOVER_FM_CLASS_NAMES.toggle
    btn.innerHTML = HOVER_FM_TOGGLE_ICON_SVG
    const toggleBtn = btn
    toggleBtn.addEventListener('click', (event) => {
      // 热区语义：按钮是唯一操作入口（标题行 hover 只负责显示按钮）；
      // 阻断冒泡以免触发浮层级点击语义
      event.stopPropagation()
      state.fmExpanded = !state.fmExpanded
      const section = toggleBtn.closest<HTMLElement>(`.${HOVER_FM_CLASS_NAMES.section}`)
      if (section) {
        applyFmCollapsedTo(section, state.fmExpanded)
      }
    })
    header.appendChild(btn)
  }
  applyFmCollapsedTo(el, state.fmExpanded)
}

/** 折叠态施加到属性区块（类 + 按钮的 aria 与文案） */
function applyFmCollapsedTo(section: HTMLElement, expanded: boolean): void {
  section.classList.toggle(HOVER_FM_CLASS_NAMES.collapsed, !expanded)
  const btn = section.querySelector<HTMLButtonElement>(`.${HOVER_FM_CLASS_NAMES.toggle}`)
  if (btn) {
    btn.setAttribute('aria-expanded', String(expanded))
    const label = expanded ? t('hover.content.fmCollapse') : t('hover.content.fmExpand')
    btn.setAttribute('aria-label', label)
    btn.title = label
  }
}

function openPopup(anchor: HTMLElement): void {
  const session = context?.session()
  const target = anchor.getAttribute('href')
  if (!context || !session?.sessionId || !session.docUri || target === null) {
    return
  }
  // #219 普通链接预滤：外部网页与空 href 不开浮层（宿主侧复核兜底）；
  // 双链不经此判定
  if (!anchorIsWikilink(anchor) && !isHoverableMdLinkHref(target)) {
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
  // #220 主题与片段：挂 #app 内（生产 webview 恒有 #app；jsdom 测试环境
  // 回退 body）——#app 的主题变量与正文样式（#app .vsidian-view-reading …）
  // 随之命中，fixed 定位不受祖先影响（#app 无 transform/filter 包含块）
  const host = document.getElementById('app') ?? document.body
  host.appendChild(container)

  const instanceId = `hover-${++instanceSeq}`
  const reqId = ++reqSeq
  // 父引用区间：锚点所在阅读块的源锚点（与点击委托同款取值）
  const block = anchor.closest<HTMLElement>('[data-vsidian-src-start]')
  const sourceStart = Number(block?.dataset['vsidianSrcStart'] ?? 0)
  const sourceEnd = Number(block?.dataset['vsidianSrcEnd'] ?? sourceStart)

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
    scope: '',
    targetFsPath: '',
    fmExpanded: false,
    bImages: null,
    closeTimer: undefined,
    cleanups: [],
  }
  stateRef = state
  popup = state
  claimPopup(closeHoverPopup)
  applyDisplay(state, 'loading', t('hover.loading'))
  position(state)

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

  // 出站读取请求（只读消息：不进 edit.request 通道）。#219 普通链接形态
  // 附 linkHref（宿主走 readHoverMdLinkTarget）；target 恒为 href 原文
  //（双链即 `|` 前原文，链接即 href——错误分态文案的目标原文来源）
  context.send({
    kind: 'hover.request',
    sessionId: session.sessionId,
    docUri: session.docUri,
    reqId,
    instanceId,
    sourceStart: Number.isInteger(sourceStart) ? sourceStart : 0,
    sourceEnd: Number.isInteger(sourceEnd) ? sourceEnd : sourceStart,
    target,
    ...(anchorIsWikilink(anchor) ? {} : { linkHref: target }),
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
  state.bImages?.dispose() // #220 B 管理器随实例释放（兜底；槽位已随块卸载释放）
  state.container.remove()
  releasePopup(closeHoverPopup)
}

/** #220 内容应用（成功回包 / 同实例刷新共用入口）：**不重置 fmExpanded**
 *  ——刷新（目标内容变化引发的重建，#224 接入推送前以同 instanceId+reqId
 *  重放为载体）保留属性展开状态；重开（新实例）才恢复默认折叠 */
function applyHoverContent(state: HoverPopupState, message: Extract<HoverPreviewResult, { ok: true }>): void {
  state.scope = message.scope.kind
  state.targetFsPath = message.target.fsPath
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
}

/** 宿主读取结果（syncController handleHostMessage 转发）：
 *  仅当场内实例、instanceId 与 reqId 双匹配的结果生效——迟到/陈旧回包
 *  丢弃，绝不重开已关闭浮层 */
export function notifyHoverResult(message: HoverPreviewResult): void {
  if (!popup || message.instanceId !== popup.instanceId || message.reqId !== popup.reqId) {
    return
  }
  if (message.ok) {
    applyHoverContent(popup, message)
  } else {
    applyDisplay(popup, 'error', hoverErrorText(message.reason, popup.anchor.getAttribute('href') ?? '', message.anchor))
  }
  position(popup)
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
