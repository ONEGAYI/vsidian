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
import type { ImageResultPayload } from './imageResource'
import { IMAGE_CLASS_NAMES, ImageResourceManager, isDirectImageSrc } from './imageResource'
import { GRAPHIC_CHROME_CLASS_NAMES, buildGraphicChrome } from './graphicBlockChrome'
import { openImagePopup } from './imagePopup'
import { isImageFileExtension } from '../shared/imageRefresh'
import { refEmbedTargetIsImage } from '../shared/refContent'
import {
  RefContentInstance,
  isRefLoadedMarkdown,
  refLoadedContentOfResult,
  type RefContentMount,
  type RefLoadedAny,
  type RefLoadedContent,
  type RefLoadedImageContent,
} from './refContentInstance'
import { createReadingContainer, READING_CLASS_NAMES } from './readingView'
import type { ReadingViewStats } from './readingVirtualView'
import { claimPopup, releasePopup } from './popupMutex'
// #342（P3-10）外链卡片内容视图与 http(s) 预滤判定（与 shared/webLink 同源）
import { buildWebCardEl, WEB_CARD_CLASS_NAMES } from './webCard'
import { isHttpLinkHref } from '../shared/webLink'
import type { RefWebContent } from '../shared/refContent'
// #299 跳转目标提示联动：浮层打开路径收起提示（「浮层开则提示关」，
// 含悬停中补按 Ctrl 的立即消失——不进互斥锁的行为面表达）
import { closeTargetTip } from './targetTip'
import {
  CLOSE_ICON,
  MODE_LIVE_ICON,
  OPEN_ICON,
  SAVE_ICON,
  type HoverPopupRootMountArgs,
  type HoverPopupRootSession,
} from './embedCard'
import { WIKILINK_CLASS_NAMES } from '../shared/wikilink'
import { EditorView } from '@codemirror/view'
import {
  refErrorText,
  releaseRefSourceLease,
  REF_FM_CLASS_NAMES,
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
  /** 标题条（目标显示名 + 跳转入口；嵌入卡片同款，浮层生命周期常驻） */
  header: 'vsidian-hover-popup-header',
  /** 标题（目标显示名 = spec.target，不随回包换） */
  title: 'vsidian-hover-popup-title',
  /** P2-06 头部右侧动作组（保存/模式切换/关闭编辑 + 打开入口） */
  actions: 'vsidian-hover-popup-actions',
  /** P2-06 保存目标入口（目标未保存时可见） */
  save: 'vsidian-hover-popup-save',
  /** P2-06 内部模式切换入口（Reading ↔ Live） */
  mode: 'vsidian-hover-popup-mode',
  /** P2-06 显式关闭编辑入口（内部 Live 端口在场时可见） */
  close: 'vsidian-hover-popup-close',
  /** P2-06 目标未保存圆点（`·`，目标 dirty 时在场——嵌入卡片同款语义） */
  dirty: 'vsidian-hover-popup-dirty',
  /** 跳转入口（打开目标文档；嵌入卡片打开按钮同款图标与语义） */
  open: 'vsidian-hover-popup-open',
  /** 内容滚动区（移入保活后的滚动承载） */
  scroll: 'vsidian-hover-popup-scroll',
  /** P2-06 内部 Live 编辑器容器（与 Reading 容器并列；限高随几何计划） */
  live: 'vsidian-hover-popup-live',
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
  /** 标题条跳转入口的调用方通道（面板形态专用）：反链/出链条目的跳转
   *  语义与条目点击同源（backlink.activate 定位引用处 / outlink.activate
   *  带锚点），载荷由 syncController 组装闭包自带——浮层侧不重复发默认
   *  激活消息；缺省按双链/linkHref 形态分派（验收反馈 2026-09-30） */
  openAction?: () => void
}

/** 从 Reading 锚点提取目标规格（href 原文 + 所在块源锚点；预滤口径见
 *  isHoverableMdLinkHref——外部链接不开浮层）；非法目标返回 null。
 *  #342（P3-10）：opts.allowExternalHttp = 外链预览开关投影（hover.
 *  externalEnabled）——开启时放行 http(s) 绝对地址（isHttpLinkHref 与
 *  宿主准入同源；其余外部 scheme 仍拒）。#221 导出：键盘命令的 Reading
 *  分支复用同一提取（聚焦链接 → spec） */
export function hoverPopupSpecOfAnchor(
  anchor: HTMLElement,
  opts?: { allowExternalHttp?: boolean },
): HoverPopupTargetSpec | null {
  const target = anchor.getAttribute('href')
  if (target === null) {
    return null
  }
  if (!anchorIsWikilink(anchor) && !isHoverableMdLinkHref(target) &&
    !(opts?.allowExternalHttp === true && isHttpLinkHref(target))) {
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
  /** #298 悬停总开关（hover.enabled）的只读投影：false = 所有悬停路径
   *  不开浮层（阅读正文/面板/Live 两路/补按 Ctrl 补触发，统一在本模块
   *  hoverPreviewAnchorEnter 入口前置拦截）；#298 跟进（2026-10-02 用户
   *  裁定扩权）「预览当前链接」键盘命令同辖——openHoverPopupForKeyboard
   *  入口同门（命令执行但静默不弹浮层）；缺省（未提供）视为开 */
  hoverPreviewEnabled?(): boolean
  /** #245 复用正文卡片管理器升级浮层内子引用，不创建第二个浮窗。 */
  mountEmbedChild?(parentInstanceId: string, block: HTMLElement, target: RefLoadedContent): void
  unmountEmbedChild?(block: HTMLElement): void
  /** #336：target 联合收宽——图片载荷同样经面板预算准入（小常数计量） */
  admitRootContent?(instanceId: string, target: RefLoadedAny, bytes: number): boolean
  clearRootContent?(instanceId: string): void
  releaseRootContent?(instanceId: string): void
  /** P2-06（#283）浮窗根引用的内部 Live 宿主（EmbedCardManager 挂载）：
   *  目标编辑端口/内部模式状态机/显式关闭链路与正文嵌入同源；缺省（未
   *  提供）浮窗保持纯 Reading 形态（chrome 隐藏） */
  mountPopupRoot?(args: HoverPopupRootMountArgs): { session: HoverPopupRootSession; content: RefContentMount } | null
}

interface HoverPopupState {
  instanceId: string
  reqId: number
  anchor: HTMLElement
  container: HTMLElement
  scrollEl: HTMLElement
  stateEl: HTMLElement
  contentEl: HTMLElement
  /** P2-06 内部 Live 编辑器容器（与 contentEl 并列于 scrollEl） */
  liveEl: HTMLElement
  /** P2-06 浮窗根引用宿主会话（null = 上下文未提供：纯 Reading 浮窗） */
  root: HoverPopupRootSession | null
  /** P2-06 watch 身份：根会话在场 = 引用位置语义键（bind 来源固定同源）；
   *  否则回落 instanceId（纯 Reading 形态的既有身份） */
  watchInstanceId: string
  /** P2-06 指针在浮层容器内（dirty 清零后恢复常规关闭的重估依据） */
  pointerInside: boolean
  /** P2-06 Esc 消隐意图：显式退出链路完成后关浮窗（模态取消则清除） */
  dismissPending: boolean
  /** P2-06 上一次保活重估值（resist→clean 转变时恢复关闭计时） */
  liveResistPrev: boolean
  /** 纯 Reading 形态的实例（root 在场时为 null——实例归管理器驻留 entry，
   *  跨开合记忆滚动/fm） */
  instance: RefContentInstance | null
  content: RefContentMount
  /** #336 图片目标装载（image 载荷渲染的槽位管理器；markdown 目标为 null
   *  ——内容图片归 RefContentMount 自有管理器）。关闭/撤下即 dispose */
  image: ImageResourceManager | null
  /** #336 图片目标渲染宿主（挂 scrollEl 层——虚拟视图重建 contentEl 不
   *  触碰该层；撤下随 image 一并移除） */
  imageFrame: HTMLElement | null
  /** loading → content / error（结果只接受一次：陈旧回包丢弃） */
  display: 'loading' | 'content' | 'error'
  note: string
  /** #342（P3-10）外链卡片元信息（contentKind=web 成功回包送达；null =
   *  非 web 形态——卡片内容视图与 Reading 装载互斥，web 卡片不进
   *  RefContentInstance/watch/租约链路） */
  webMeta: RefWebContent | null
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
  watchLeaseId: string | null
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
  if (ctx) {
    ensureInactiveListener()
  } else {
    cancelPendingOpen()
    closeHoverPopup()
    releaseInactiveListener()
  }
}

// 窗口失焦 / 文档不可见即刻释放（验收反馈 2026-09-30 切窗失效）：
// Chromium 对未聚焦窗口不派发 mouseout（electron/electron#45246），切窗
// 期间 mouseleave 缺失会让关闭计时永不启动——浮层滞留后台，fixed
// 480×400 遮挡正文拦截 mouseover，切回后悬停完全失效（点侧栏/切页释放
// 才恢复）。瞬态 UI 失焦即关（在场实例与待开计时一并清），与宿主 hover
// 语义一致；键盘模态不豁免——窗口失焦时键盘现场已断，关闭返还 prevFocus
// 无副作用。P2-06（Q18）例外：dirty Live 保活——目标 B 有未保存修改时
// 移出/外点/切应用等普通关闭条件不销毁（「切应用仍在」，P2-A08），窗口
// 回焦时按最新 dirty 重估（保活失效且指针不在联合域则恢复关闭语义）。
// 监听随上下文装配惰性挂载（模块顶层 DOM 访问会炸 node 环境的纯逻辑
// 测试 import 链），卸载幂等
let inactiveListenerCleanup: (() => void) | null = null
function ensureInactiveListener(): void {
  if (inactiveListenerCleanup) {
    return
  }
  const release = (): void => {
    cancelPendingOpen()
    if (!liveKeepAlive()) {
      closeHoverPopup()
    }
  }
  const onWindowFocus = (): void => {
    // 回焦重估：dirty 已清（别处保存）且指针不在联合域 → 恢复常规关闭
    if (popup && !liveKeepAlive() && !popup.pointerInside && !keyboardKeepAlive() && !editorFocusKeepAlive()) {
      scheduleClose()
    }
  }
  const onVisibilityChange = (): void => {
    if (document.hidden) {
      release()
    }
  }
  window.addEventListener('blur', release)
  window.addEventListener('focus', onWindowFocus)
  document.addEventListener('visibilitychange', onVisibilityChange)
  inactiveListenerCleanup = () => {
    window.removeEventListener('blur', release)
    window.removeEventListener('focus', onWindowFocus)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    inactiveListenerCleanup = null
  }
}
function releaseInactiveListener(): void {
  inactiveListenerCleanup?.()
}

export function isHoverPopupOpen(): boolean {
  return popup !== null
}

/** 悬停预览观测探针（view.state.hoverPreview 的数据源）。P2-06 起含根
 *  引用内部 Live 观测（生效模式/端口绑定/dirty/暂停） */
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
  viewStats: ReadingViewStats | null
  /** P2-06 生效内部模式（覆盖优先；缺省跟随根面板模式） */
  internalMode: 'reading' | 'live'
  /** P2-06 目标编辑端口是否已绑定 */
  liveBound: boolean
  /** P2-06 目标 B 未保存状态（圆点观测面；纯 Reading 形态恒 false） */
  liveDirty: boolean
  /** P2-06 编辑暂停（冲突）状态 */
  liveSuspended: boolean
  /** P2-06/P2-05 三项关闭确认模态在场 */
  closeDialogOpen: boolean
} {
  const liveProbe = () => {
    const st = popup?.root?.liveState()
    return {
      internalMode: popup?.root?.effectiveMode() ?? 'reading',
      liveBound: popup?.root?.hasLivePort() ?? false,
      liveDirty: st?.dirty ?? false,
      liveSuspended: st?.suspended ?? false,
      /** 该引用的三项关闭确认模态在场（P2-05 链路观测面） */
      closeDialogOpen: popup?.root?.isCloseDialogOpen() ?? false,
    }
  }
  if (!popup || popup.display !== 'content') {
    return {
      open: popup !== null, state: popup?.display ?? 'loading', note: popup?.note ?? '', blocks: 0,
      scope: popup?.scope ?? '', fm: 'none', imageSrcs: [], viewStats: null,
      ...liveProbe(),
    }
  }
  const fmSection = popup.contentEl.querySelector(`.${REF_FM_CLASS_NAMES.section}`)
  const imageSrcs: string[] = []
  // #336 图片目标的渲染帧在 scrollEl 层（虚拟视图拥有 contentEl）——采集范围扩到浮层容器（已应用 src 口径不变）
  for (const img of Array.from(popup.container.querySelectorAll('img'))) {
    const src = img.getAttribute('src')
    if (src !== null && src !== '') {
      imageSrcs.push(src)
    }
  }
  // fm 态从 DOM 观测（切换按钮 aria-expanded 随态）——legacy 读实例字段，
  // 根会话形态实例归管理器驻留 entry，DOM 侧写两形态同源
  const fmToggle = fmSection?.querySelector('button[aria-expanded]')
  const fmExpanded = popup.instance
    ? popup.instance.fmExpanded
    : fmToggle?.getAttribute('aria-expanded') === 'true'
  return {
    open: true,
    state: popup.display,
    note: popup.note,
    blocks: popup.contentEl.querySelectorAll(`.${READING_CLASS_NAMES.block}`).length,
    scope: popup.scope,
    fm: fmSection ? (fmExpanded ? 'expanded' : 'collapsed') : 'none',
    imageSrcs,
    viewStats: popup.content.getStats(),
    ...liveProbe(),
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
  // 鼠标离开而销毁」；焦点离开浮层后恢复常规鼠标关闭语义。
  // 输入现场保活（鼠标打开路径同样成立）：用户点击浮窗内编辑器开始
  // 输入（键盘/IME 组合）后鼠标移出——去够输入法候选窗等——不销毁
  // 打字现场；按钮副作用焦点不构成键盘现场（保存/切换后按普通悬停规则）
  if (keyboardKeepAlive() || editorFocusKeepAlive()) {
    return
  }
  if (liveKeepAlive()) {
    // P2-06（Q18）：dirty Live 抵抗普通关闭条件（移出延迟关）。抵抗态
    // 就地记录——后续端口态信号（dirty 清零/在途落定）翻转时据此恢复
    // 关闭语义（reevaluateLiveKeepAlive）
    popup.liveResistPrev = true
    return
  }
  cancelCloseTimer()
  popup.closeTimer = window.setTimeout(() => {
    if (popup) {
      popup.closeTimer = undefined
      // 排程后现场翻转复查：关延迟排定（干净 + 无现场）后用户才开始
      // 输入（组合/在途/dirty 起）或聚焦编辑器——鼠标未归场（无
      // mouseenter 抵消）时不得按早前排定的延迟销毁输入现场
      if (keyboardKeepAlive() || editorFocusKeepAlive() || liveKeepAlive() || popup.pointerInside) {
        return
      }
      closeHoverPopup()
    }
  }, HOVER_POPUP_CLOSE_DELAY_MS)
}

/** #221 键盘模态在场判定：命令手动打开且焦点在浮层内（Tab 遍历浮层内容
 *  时同样成立——focus 落在浮层内任意后代） */
function keyboardKeepAlive(): boolean {
  return popup !== null && popup.keyboardOpened && popup.container.contains(document.activeElement)
}

/** 输入现场保活：浮窗内 CM6 编辑器持有焦点（根编辑器或嵌卡/孙卡编辑器
 *  ——孙卡 DOM 在浮窗容器任意层）。只认编辑器焦点：打字现场（键盘/IME
 *  输入中）值得保活；点击按钮/头部后的副作用焦点不算（P2-U18 干净目标
 *  普通悬停关闭语义不被滞留焦点劫持） */
function editorFocusKeepAlive(): boolean {
  const active = document.activeElement
  return popup !== null && active !== null && popup.container.contains(active) &&
    active.closest('.cm-content') !== null
}

/** P2-06（Q18）dirty 保活判定：浮窗根内部 Live 端口在场且（目标 dirty／
 *  输入未落定／冲突暂停）——移出、外点、失焦等普通关闭条件不销毁。
 *  目标 dirty 与未提交输入分开观测：组合期/在途/暂停不按「B 干净」销毁 */
function liveKeepAlive(): boolean {
  return popup !== null && popup.root !== null && popup.root.resistsNormalClose()
}

/** P2-06 端口态变化重估（onLiveStateChanged）：保活失效转变（resist→
 *  clean）且指针不在联合域时恢复常规关闭语义——dirty 消除后浮窗不再
 *  滞留（键盘模态保活另行判定） */
function reevaluateLiveKeepAlive(): void {
  const state = popup
  if (!state) {
    return
  }
  const resisting = liveKeepAlive()
  const was = state.liveResistPrev
  state.liveResistPrev = resisting
  if (!was && resisting) {
    // 抵抗上升（输入开始/在途起）：撤销已排定的关延迟——排程时干净、
    // 排程后现场翻转的时序缺口
    cancelCloseTimer()
    return
  }
  if (was && !resisting && !state.pointerInside && !keyboardKeepAlive() && !editorFocusKeepAlive()) {
    scheduleClose()
  }
}

/** P2-06 引用位置语义键：面板会话内跨开合稳定（模式/选区/滚动记忆与
 *  refEdit.bind occurrence、hover.watch 身份同源）；面板条目等中性区间
 *  （sourceStart=0）以目标区分——同目标条目共享会话记忆 */
function hoverRootKey(spec: HoverPopupTargetSpec): string {
  return `hover@${spec.sourceStart}::${spec.target}`
}

/** P2-06 显式退出链路完成回调（onExplicitCloseSettled）：浮窗去留按意图
 *  决定——Esc 消隐意图（焦点不在编辑器内发起）与删除引用（锚点随 A 的
 *  删除事务消失）在链路完成后关浮窗；头部关闭按钮（close）与编辑器内
 *  Esc 只退出编辑回 Reading，浮窗保留。键盘模态下编辑器销毁后焦点落回
 *  浮窗容器（避免掉 body） */
function onRootCloseSettled(intent: 'close' | 'escape' | 'delete'): void {
  const state = popup
  if (!state) {
    return
  }
  const dismiss = state.dismissPending || intent === 'delete'
  state.dismissPending = false
  if (dismiss) {
    closeHoverPopup()
    return
  }
  if (state.keyboardOpened && state.container.isConnected) {
    state.container.focus()
  }
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
  // P2-06 内部 Live 容器限高：总高扣头部/边框等固定 chrome（外壳实测差）
  // ——CM6 自身 scroller 滚动（视口测量依赖 cm-scroller 为滚动元素，
  // 嵌入卡片同款口径）；外壳未入布局时用保守缺省
  const chromeH = state.container.offsetHeight > 0 && state.scrollEl.clientHeight > 0
    ? state.container.offsetHeight - state.scrollEl.clientHeight
    : 48
  // 用内部滚动内容的自然高度规划贴锚位置：外壳 offsetHeight 可能已被
  // 旧 max-height 裁切，直接读它会把后续异步增高永久冻结在 loading 高。
  // scrollHeight 不受外壳裁切；扣掉当前滚动口再加回自然内容即可恢复全高。
  // P2-06 视觉验收回归：内部 Live 在场时外壳差值法失效（liveEl 被自身
  // max-height 钳住，scrollEl.scrollHeight 随之被钳）——自然高度改取
  // cm-scroller 的内容全高（不受 max-height 裁切）
  let measured: number
  const liveScroller = state.liveEl.querySelector<HTMLElement>('.cm-scroller')
  if (liveScroller && getComputedStyle(state.liveEl).display !== 'none') {
    measured = chromeH + liveScroller.scrollHeight
  } else {
    measured = state.container.offsetHeight > 0
      ? state.container.offsetHeight - state.scrollEl.clientHeight + state.scrollEl.scrollHeight
      : HOVER_POPUP_MAX_HEIGHT
  }
  const height = Math.min(HOVER_POPUP_MAX_HEIGHT, Math.max(1, measured))
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
  state.liveEl.style.maxHeight = `${Math.max(140, placement.height - chromeH)}px`
}

function applyDisplay(state: HoverPopupState, display: 'loading' | 'content' | 'error', note: string): void {
  state.display = display
  state.note = note
  // 错误分态挂错误修饰类（主题错误色），loading/content 摘除
  state.stateEl.classList.toggle(HOVER_POPUP_CLASS_NAMES.stateError, display === 'error')
  if (display === 'content') {
    state.stateEl.style.display = 'none'
    state.scrollEl.style.display = ''
    state.content.updateNow()
  } else {
    state.stateEl.style.display = ''
    state.scrollEl.style.display = 'none'
    state.stateEl.textContent = note
  }
}

/** #221 打开选项：键盘模态（命令手动打开——焦点进入浮层，关闭返还） */
interface HoverPopupOpenOptions {
  keyboard?: boolean
  prevFocus?: HTMLElement | null
}

/**
 * #336（P3-04）悬停目标的图片预判（webview 渲染路径分流）：三形态按
 * 扩展名判图片（与宿主 classifyLocalRefContentKind 同口径——带扩展名目
 * 标书写扩展名即解析后扩展名，预判与宿主回包 contentKind 结构性一致；
 * 宿主仍是权威，预判只决定浮层先走哪条渲染形态——图片目标不接 P2-06
 * 根会话（无内部模式切换语义），以纯 Reading 形态开浮层）。
 */
function hoverSpecTargetsImage(spec: HoverPopupTargetSpec): boolean {
  if (spec.directFsPath !== undefined) {
    // 空串 fsPath = 断链条目（not-found 分态照常走文档通道）
    return spec.directFsPath !== '' && isImageFileExtension(spec.directFsPath)
  }
  if (spec.linkHref !== undefined) {
    const pathText = spec.linkHref.split('#')[0]!.split('?')[0]!.trim()
    return pathText !== '' && isImageFileExtension(pathText)
  }
  return refEmbedTargetIsImage(spec.target)
}

/** 打开浮层（三入口共用核心）：目标规格由调用方给出——Reading 锚点路径
 *  经 hoverPopupSpecOfAnchor 提取，Live 装饰/面板条目由 syncController 组装（见
 *  HoverPopupTargetSpec）。非法目标（null spec）不开 */
function openPopup(anchor: HTMLElement, spec: HoverPopupTargetSpec | null, options?: HoverPopupOpenOptions): void {
  const session = context?.session()
  if (!context || !session?.sessionId || !session.docUri || spec === null) {
    return
  }
  closeTargetTip() // #299 浮层打开：提示收起（键盘/显式入口兜底联动）
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
  // P2-06 内部 Live 编辑器容器（与 Reading 容器并列；默认隐藏——生效
  // 内部模式为 Live 且端口装载后由管理器 applyInternalDom 翻转）
  const liveEl = document.createElement('div')
  liveEl.className = HOVER_POPUP_CLASS_NAMES.live
  liveEl.style.display = 'none'
  scrollEl.appendChild(liveEl)
  // 标题条（验收反馈 2026-09-30：嵌入卡片同款 header——目标显示名常驻
  // 不随回包换；跳转按钮与嵌入打开入口同图标同语义）。P2-06：右侧动作
  // 组新增保存/模式切换/关闭编辑入口（与嵌入卡片同款图标与语义；根会话
  // 未接入（纯 Reading 形态）时隐藏）
  const header = document.createElement('div')
  header.className = HOVER_POPUP_CLASS_NAMES.header
  const titleEl = document.createElement('span')
  titleEl.className = HOVER_POPUP_CLASS_NAMES.title
  titleEl.textContent = spec.target
  const headerActions = document.createElement('span')
  headerActions.className = HOVER_POPUP_CLASS_NAMES.actions
  const mkChromeBtn = (
    className: string,
    icon: string,
    labelKey: Parameters<typeof t>[0],
  ): HTMLButtonElement => {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = className
    const label = t(labelKey)
    btn.setAttribute('aria-label', label)
    btn.setAttribute('data-tooltip', label)
    btn.innerHTML = icon
    return btn
  }
  const saveBtn = mkChromeBtn(HOVER_POPUP_CLASS_NAMES.save, SAVE_ICON, 'embed.saveTarget')
  saveBtn.style.display = 'none'
  const modeBtn = mkChromeBtn(HOVER_POPUP_CLASS_NAMES.mode, MODE_LIVE_ICON, 'embed.modeToLive')
  const closeBtn = mkChromeBtn(HOVER_POPUP_CLASS_NAMES.close, CLOSE_ICON, 'embed.closeEditor')
  closeBtn.style.display = 'none'
  const openBtn = document.createElement('button')
  openBtn.type = 'button'
  openBtn.className = HOVER_POPUP_CLASS_NAMES.open
  const openLabel = t('embed.openTarget')
  openBtn.setAttribute('aria-label', openLabel)
  openBtn.setAttribute('data-tooltip', openLabel)
  openBtn.innerHTML = OPEN_ICON
  headerActions.appendChild(saveBtn)
  headerActions.appendChild(modeBtn)
  headerActions.appendChild(closeBtn)
  headerActions.appendChild(openBtn)
  header.appendChild(titleEl)
  header.appendChild(headerActions)
  container.appendChild(header)
  container.appendChild(stateEl)
  container.appendChild(scrollEl)
  // #220 主题与片段：挂 #app 内（生产 webview 恒有 #app；jsdom 测试环境
  // 回退 body）——#app 的主题变量与正文样式（#app .vsidian-view-reading …）
  // 随之命中，fixed 定位不受祖先影响（#app 无 transform/filter 包含块）
  const host = document.getElementById('app') ?? document.body
  host.appendChild(container)

  const instanceId = `hover-${++instanceSeq}`
  const reqId = ++reqSeq
  const ctx = context
  // P2-06：子引用挂载的父身份 = watch 身份（宿主对子请求按父 watch 固定
  // 校验来源）。根会话在场为引用位置语义键（与 bind occurrence 同源），
  // 否则 instanceId（纯 Reading 形态）；闭包晚绑定——mountPopupRoot 结果
  // 出来后赋值
  let embedParentIdentity = instanceId
  const mountOptions = {
    contentEl, scrollEl, strategy: 'virtual' as const,
    session: () => ctx.session(),
    send: (message: WebviewToHost) => ctx.send(message),
    codeHighlight: () => ctx.codeHighlight?.() ?? true,
    onEmbedBlockMounted: (block: HTMLElement, target: RefLoadedContent) =>
      ctx.mountEmbedChild?.(embedParentIdentity, block, target),
    onEmbedBlockUnmounted: (block: HTMLElement) => ctx.unmountEmbedChild?.(block),
  }
  // P2-06 浮窗根引用宿主接入：entry 按引用位置语义键驻留管理器状态库
  // （跨开合记忆模式/选区/滚动/fm）；Reading 挂载经 entry.content（同一
  // RefContentInstance）。上下文未提供（纯 Reading 形态）时回落自建实例。
  // #336（P3-04）图片目标不接根会话：图片无内部模式切换/dirty 语义，浮层
  // 以纯 Reading 形态开（chrome 隐藏）；载荷到达经 image 通道渲染
  const targetsImage = hoverSpecTargetsImage(spec)
  const rootKey = hoverRootKey(spec)
  const mounted = targetsImage ? null : ctx.mountPopupRoot?.({
    key: rootKey,
    inner: spec.target,
    sourceStart: spec.sourceStart,
    sourceEnd: spec.sourceEnd,
    container,
    scrollEl,
    stateEl,
    contentEl,
    liveEl,
    modeBtn,
    saveBtn,
    closeBtn,
    headerActionsEl: headerActions,
    dirtyClass: HOVER_POPUP_CLASS_NAMES.dirty,
    contentMount: mountOptions,
    reloadContent: (silent) => {
      if (popup) {
        requestReload(popup, silent)
      }
    },
    onExplicitCloseSettled: (intent) => onRootCloseSettled(intent),
    onExplicitCloseCanceled: () => {
      if (popup) {
        popup.dismissPending = false
      }
    },
    onLiveStateChanged: () => reevaluateLiveKeepAlive(),
  }) ?? null
  const root = mounted?.session ?? null
  embedParentIdentity = root ? rootKey : instanceId
  const instance = root ? null : new RefContentInstance({
    panelDocUri: session.docUri,
    sourceDocUri: session.docUri,
    range: { start: spec.sourceStart, end: spec.sourceEnd },
    occurrence: instanceId,
  })
  const content = mounted?.content ?? instance!.mount(mountOptions)
  if (!root) {
    // 纯 Reading 形态：chrome 隐藏（Tab 序不新增停留点）
    saveBtn.style.display = 'none'
    modeBtn.style.display = 'none'
    modeBtn.tabIndex = -1
    closeBtn.style.display = 'none'
  }
  const state: HoverPopupState = {
    instanceId,
    reqId,
    anchor,
    container,
    scrollEl,
    stateEl,
    contentEl,
    liveEl,
    root,
    watchInstanceId: root ? rootKey : instanceId,
    pointerInside: false,
    dismissPending: false,
    liveResistPrev: false,
    instance,
    content,
    image: null,
    imageFrame: null,
    display: 'loading',
    note: '',
    webMeta: null,
    target: spec.target,
    spec,
    scope: '',
    targetFsPath: '',
    appliedVersion: -1,
    watchedFsPath: null,
    watchLeaseId: null,
    keyboardOpened: options?.keyboard === true,
    prevFocus: options?.prevFocus ?? null,
    closeTimer: undefined,
    cleanups: [],
  }
  popup = state
  claimPopup(closeHoverPopup)
  applyDisplay(state, 'loading', t('hover.loading'))
  position(state)
  if (state.keyboardOpened) {
    // 键盘打开：焦点进入浮层（Esc 关闭后返还 prevFocus——见 closeHoverPopup）
    container.focus()
  }
  // P2-06 头部 chrome 接线（根会话在场）：与嵌入卡片头部按钮同一处理器
  // 语义——模式切换/保存目标/显式关闭（dirty 弹三项模态、干净直接退出）
  if (root) {
    content.listen(modeBtn, 'click', (event) => {
      event.stopPropagation()
      root.toggleMode()
    })
    content.listen(saveBtn, 'click', (event) => {
      event.stopPropagation()
      root.save()
    })
    content.listen(closeBtn, 'click', (event) => {
      event.stopPropagation()
      root.requestClose('close')
    })
  }

  // #220 浮层内链接点击：B 内双链/普通链接/外链经既有 open 通道（附
  // sourceDocUri，宿主按 B 解析与分类）——preventDefault 阻断 webview
  // 原生导航（与主视图点击委托同口径）；点击即上下文切换，浮层关闭。
  // 浮层不在 readingContainer 委托域内：悬停不叠加新浮层（规格一期）
  content.listen(contentEl, 'click', (event) => {
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
    // #342（P3-10）web 卡片内的显式安全链接：以父文档身份发 link.activate
    //（external → 宿主 openExternal 浏览器打开；无 B 身份——卡片不是文档
    // 引用，href 为宿主归一后的 http(s) 最终地址）。点击即上下文切换关闭
    if (state.webMeta !== null) {
      if (ctx && session?.sessionId && session.docUri) {
        ctx.send({
          kind: 'link.activate',
          sessionId: session.sessionId,
          docUri: session.docUri,
          href,
          srcStart: state.spec.sourceStart,
          srcEnd: state.spec.sourceEnd,
        })
      }
      closeHoverPopup()
      return
    }
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

  // #342（P3-10）web 卡片链接点击（卡片挂 scrollEl——虚拟视图地盘之外，
  // contentEl 委托不覆盖）：域名链接 preventDefault 阻断 webview 原生导航，
  // 经 link.activate 外开浏览器（无 sourceDocUri——卡片不是文档引用）；
  // 点击即上下文切换，浮层关闭（与浮层内链接点击同款）
  content.listen(scrollEl, 'click', (event) => {
    const hit = event.target as HTMLElement | null
    const linkAnchor = hit?.closest?.('a')
    if (!(linkAnchor instanceof HTMLAnchorElement) || !scrollEl.contains(linkAnchor) ||
      linkAnchor.closest(`.${WEB_CARD_CLASS_NAMES.card}`) === null) {
      return // 仅 web 卡片内的链接（contentEl 正文链接归既有委托；liveEl 编辑器不受影响）
    }
    event.preventDefault()
    const href = linkAnchor.getAttribute('href')
    const ctx = context
    const session = ctx?.session()
    if (href !== null && ctx && session?.sessionId && session.docUri) {
      ctx.send({
        kind: 'link.activate',
        sessionId: session.sessionId,
        docUri: session.docUri,
        href,
        srcStart: spec.sourceStart,
        srcEnd: spec.sourceEnd,
      })
    }
    closeHoverPopup()
  })

  // 标题条跳转入口（验收反馈 2026-09-30）：打开浮层预览的目标文档。
  // 分派按 spec 形态：openAction（面板形态，调用方闭包自带通道——反链
  // 定位引用处/出链带锚点）→ linkHref（普通链接）→ 双链默认；与嵌入卡片
  // 打开入口同语义（不带 sourceDocUri，按父文档身份解析）。点击即上下文
  // 切换，浮层关闭（与浮层内链接点击同款）
  content.listen(openBtn, 'click', (event) => {
    event.stopPropagation()
    const ctx = context
    const session = ctx?.session()
    if (!ctx || !session?.sessionId || !session.docUri) {
      return
    }
    if (spec.openAction) {
      spec.openAction()
    } else if (spec.linkHref !== undefined) {
      ctx.send({
        kind: 'link.activate',
        sessionId: session.sessionId,
        docUri: session.docUri,
        href: spec.linkHref,
        srcStart: spec.sourceStart,
        srcEnd: spec.sourceEnd,
      })
    } else {
      ctx.send({
        kind: 'wikilink.activate',
        sessionId: session.sessionId,
        docUri: session.docUri,
        target: spec.target,
        srcStart: spec.sourceStart,
        srcEnd: spec.sourceEnd,
      })
    }
    closeHoverPopup()
  })

  // 键盘：Esc 关闭（捕获阶段拦截，不外溢宿主键绑定；关闭时键盘模态返还
  // 触发处焦点——见 closeHoverPopup）。P2-06 分层：三项关闭确认模态在场
  // 归模态（Esc=取消）；内部 Live 端口在场且焦点在编辑器内归编辑器
  // keymap（收选区后走同一显式退出链路——捕获阶段不拦截，事件继续到
  // 编辑器）；端口在场但焦点在编辑器外 = 消隐意图，经显式退出链路（dirty
  // 弹三项模态、干净直接退出编辑，完成后关浮窗）；无端口保持原瞬态语义
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') {
      return
    }
    if (popup?.root?.isCloseDialogOpen()) {
      return // 模态自身的 Esc = 取消（模态根监听处理，不重复消费）
    }
    if (popup?.root?.hasLivePort()) {
      if (popup.liveEl.contains(document.activeElement)) {
        return // 编辑器 keymap 处理（非空选区先收选区，再走退出链路）
      }
      event.stopPropagation()
      popup.dismissPending = true
      popup.root.requestClose('escape')
      return
    }
    event.stopPropagation()
    closeHoverPopup()
  }
  document.addEventListener('keydown', onKeydown, true)
  state.cleanups.push(() => document.removeEventListener('keydown', onKeydown, true))

  // 移入保活 / 移出延迟关闭（联合域 = 锚点 ∪ 浮层；键盘模态的保活豁免
  // 在 scheduleClose 内判定——焦点在浮层内时鼠标离开不销毁键盘现场；
  // P2-06 dirty Live 的抵抗同样在 scheduleClose 内判定）。pointerInside
  // 供 dirty 清零后的保活重估（reevaluateLiveKeepAlive）
  content.listen(container, 'mouseenter', () => {
    state.pointerInside = true
    cancelCloseTimer()
  })
  content.listen(container, 'mouseleave', () => {
    state.pointerInside = false
    scheduleClose()
  })
  // 联合域内的指针按下不关闭（选字复制起点）；域外按下立即关（点击别处
  // = 明确的上下文切换）——P2-06 dirty Live 抵抗（Q18「外点仍在」）
  const onPointerDown = (event: PointerEvent): void => {
    if (popup && event.target instanceof Node && !insideJointDomain(popup, event.target) && !liveKeepAlive()) {
      closeHoverPopup()
    }
  }
  document.addEventListener('pointerdown', onPointerDown, true)
  state.cleanups.push(() => document.removeEventListener('pointerdown', onPointerDown, true))

  // 父容器滚动：锚点视口位置失效，立即关闭（浮层自身滚动区在联合域内不受影响）；
  // #221 键盘模态且焦点在浮层内时豁免——Tab 遍历浮层内容触发的程序性滚动
  // 不得销毁键盘操作现场（#220 已知张力的调整）；编辑器输入现场（scrollIntoView
  // 等程序性滚动）与 P2-06 dirty Live 同豁免（键盘模态先例：保持浮层驻留，
  // 不重贴锚——普通条件恢复后按常规重定位）
  const onScroll = (event: Event): void => {
    if (popup && event.target instanceof Node && !popup.container.contains(event.target) &&
      !keyboardKeepAlive() && !editorFocusKeepAlive() && !liveKeepAlive()) {
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
      if (popup === state) {
        position(state)
      }
    })
    observer.observe(container)
    observer.observe(contentEl)
    // P2-06 视觉验收回归：内部 Live 编辑器异步建立/装载撑高 liveEl 时同样
    // 重定位——否则浮窗冻结在 Reading 期测量高度，编辑器溢出被裁
    //（用户实测 251px 编辑器被 148px 容器裁掉一截）
    observer.observe(state.liveEl)
    state.cleanups.push(() => observer.disconnect())
  }

  // 出站读取请求（只读消息：不进 edit.request 通道）。#219 普通链接形态
  // 附 linkHref（宿主走 readHoverMdLinkTarget）；#221 面板直接目标附
  // directTarget（宿主直读）；target 恒为目标原文（双链即 `|` 前原文，
  // 链接即 href，面板条目即显示名——错误分态文案的目标原文来源）
  context.send({
    kind: 'hover.request',
    retainSource: true,
    sessionId: session.sessionId,
    docUri: session.docUri,
    reqId,
    instanceId,
    // P2-06：occurrenceId 与 watch 身份同源（宿主来源租约按 occurrence
    // 转交固定——语义键或 instanceId 二者必须一致，否则 watch 被拒）
    occurrenceId: state.watchInstanceId,
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
 *  打开后焦点进入浮层；Esc 关闭后返还（body/脱树不返还）。#298 跟进
 *  （2026-10-02 用户裁定扩权）：总开关关闭时本入口同拦——命令执行但
 *  静默不弹浮层（与「无目标静默不误开」同形态），不弹任何提示 */
export function openHoverPopupForKeyboard(anchor: HTMLElement, spec: HoverPopupTargetSpec): void {
  if (context?.hoverPreviewEnabled?.() === false) {
    return
  }
  const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null
  openPopup(anchor, spec, { keyboard: true, prevFocus: prev })
}

/** 进入链接（Reading 容器 mouseover 委托转发；#221 Live 悬停同入口——
 *  装饰 DOM 无 href，spec 由调用方组装传入）：同锚点重入取消待关；换
 *  锚点先关旧再延迟开新。修 6（review 第二轮）：同一锚点已有 pendingOpen
 *  时不重建开设计时——嵌套行内标记链接（如 [**粗体**](x.md)）内跨子
 *  元素移动触发多次 mouseover（联合域内移动的 mouseout 被调用方过滤，
 *  无对应 leave），每次重建 300ms timer 会把浮层推迟到指针静止。
 *  #298 总开关门控：hover.enabled 关闭时所有悬停路径（含补按 Ctrl 补
 *  触发——其调用点同样收敛到本入口）前置拦截，不建待开计时不开浮层；
 *  正文嵌入卡片不经本入口（常驻呈现不受总开关影响） */
export function hoverPreviewAnchorEnter(anchor: HTMLElement, spec?: HoverPopupTargetSpec): void {
  if (context?.hoverPreviewEnabled?.() === false) {
    return
  }
  // #299 浮层将现：跳转目标提示立即收起（含悬停中补按 Ctrl 的补触发
  // 路径——矩阵「补触发开 → 立即消失」，不等开延迟）
  closeTargetTip()
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
 *  程序化打开时无真实先前焦点可回）。P2-06：根会话在场时端口与挂载经
 *  session.close 释放（occurrence 记忆驻留管理器状态库——模式/选区/
 *  滚动跨开合）；订阅与根预算释放两路径同款（legacy 原经 instance.onDispose） */
export function closeHoverPopup(): void {
  cancelPendingOpen()
  const state = popup
  if (!state) {
    return
  }
  popup = null
  // #342（P3-10）在途请求取消：loading 态关浮层（换目标/移出/Esc/域
  // 失效等一切关闭路径）发 hover.cancel——宿主中止外链抓取（同 URL 合并
  // 的最后消费者离开即断开底层连接）；markdown 读取不可中止，迟到回包由
  // 既有 instanceId+reqId 配对守卫丢弃，行为不变
  if (state.display === 'loading') {
    sendHoverCancel(state)
  }
  if (state.root) {
    state.root.close()
  } else {
    state.instance?.dispose()
  }
  state.image?.dispose() // #336 图片目标管理器（槽位/条目整体释放）
  state.image = null
  state.imageFrame?.remove()
  state.imageFrame = null
  if (state.watchedFsPath !== null) {
    sendWatchMessage(state.watchedFsPath, state.watchInstanceId, 'hover.unwatch')
    state.watchedFsPath = null
    state.watchLeaseId = null
  }
  context?.releaseRootContent?.(state.instanceId)
  if (state.closeTimer !== undefined) {
    window.clearTimeout(state.closeTimer)
  }
  for (const cleanup of state.cleanups.splice(0)) cleanup()
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

/** #221/#224 内容应用（成功回包 / 同实例刷新共用入口）：**不重置
 *  fmExpanded**——刷新（目标内容变化引发的重建，#224 经 hover.invalidated
 *  驱动同实例重发请求）保留属性展开状态；重开恢复默认折叠（#220 既有
 *  契约保持——P2-06 根会话实例跨开合驻留只为滚动记忆，fm 在挂载时复位）。
 *  #224 起刷新保持滚动位置（内容重建前保存
 *  scrollTop、重建后回写——内容缩短时浏览器按 scrollHeight 合法钳制）
 *  并登记目标订阅（hover.watch）。P2-06：装载成功送达根会话（entry.loaded
 *  填充；生效内部 Live 时绑定目标编辑端口）。
 *  #333（P3-01）：loaded 由 refLoadedContentOfResult 类型化转换产出
 *  （contentKind 分派——markdown 通道；非 markdown 载荷在转换处被拒，
 *  不进入本应用路径，refEdit 写端口结构上不可达）。 */
function applyHoverContent(state: HoverPopupState, message: Extract<HoverPreviewResult, { ok: true }>, loaded: RefLoadedContent): void {
  const keepScroll = state.scrollEl.scrollTop // #224 刷新前保存（首载为 0）
  // markdown 载荷的 scope 恒为 full/heading/block（协议校验器保证）；
  // plain 只随 image 载荷出现（不进本路径）——此处按探针枚举收窄
  state.scope = message.scope.kind === 'full' ? 'full'
    : message.scope.kind === 'heading' ? 'heading' : 'block'
  state.targetFsPath = message.target.fsPath
  state.appliedVersion = message.version
  const rendered = state.content.render(loaded, (bytes) => {
    if (context?.admitRootContent && !context.admitRootContent(state.instanceId, loaded, bytes)) return false
    // 同 fsPath 未保存刷新也必须先续交根 B 的来源，再挂子卡发 C 请求。
    ensureWatch(state, message.target.fsPath, message.sourceLeaseId)
    return true
  })
  if (!rendered) {
    if (context) releaseRefSourceLease(context, message.sourceLeaseId)
    context?.releaseRootContent?.(state.instanceId)
    if (state.watchedFsPath !== null) {
      sendWatchMessage(state.watchedFsPath, state.watchInstanceId, 'hover.unwatch')
      state.watchedFsPath = null
      state.watchLeaseId = null
    }
    applyDisplay(state, 'error', t('hover.errorBudget'))
    return
  }
  applyDisplay(state, 'content', message.target.relPath)
  // #224 滚动位置恢复（刷新路径：内容重建后回写；内容缩短合法钳制）
  if (keepScroll > 0) {
    state.scrollEl.scrollTop = keepScroll
    state.content.updateNow()
  }
  // P2-06：引用位置会话记忆的滚动恢复（重开路径——根会话实例跨开合
  // 驻留，与嵌入卡片 applyLoaded 的 restoreScroll 同口径；首载/无记忆
  // scrollTop 0 无操作，延迟一帧等宿主布局建立后回写）
  state.content.restoreScroll(true)
  state.root?.contentLoaded(loaded)
}

/** #342（P3-10）web 卡片内容应用：纯文字 + 域名安全链接（本地 DOM 构建，
 *  非远程内容渲染——不执行 HTML、不加载子资源）。无 B 身份（targetFsPath
 *  置空：卡片内链接点击走 link.activate 无来源通道）、不进 watch/租约
 *  链路（网页无宿主文档版本可订阅）；note 为域名（状态行隐藏，供观测） */
function applyHoverWebContent(state: HoverPopupState, meta: RefWebContent): void {
  state.webMeta = meta
  state.targetFsPath = ''
  state.scope = 'full'
  state.appliedVersion = 0
  applyDisplay(state, 'content', meta.domain)
  // 卡片挂 scrollEl（与 contentEl/liveEl 平级）：contentEl 是虚拟 Reading
  // 视图的管辖地盘（updateNow 的块渲染会重建其子树——手动挂载的节点
  // 会被冲掉），web 卡片无块语义，挂滚动区直下；容器销毁（浮层关闭）
  // 随 DOM 树整体移除，无独立清理路径
  state.scrollEl.appendChild(buildWebCardEl(meta))
}
/**
 * #336（P3-04）image 载荷应用：浮层内容委托普通图片挂载——经
 * ImageResourceManager 装载（与正文 `![](图.png)` 同一加载/重试/失效管
 * 线），frame chrome 提供查看大图入口（图片弹窗经既有 openImagePopup）。
 * 图源请求按面板文档身份发非来源化 image.request（宿主 imageSrc 即按面
 * 板文档目录计算，同一基准解析回同一目标）；目标订阅与失效刷新沿用既有
 * watch 通道。刷新路径：旧管理器整体重建（条目/URI 重解析，不复活旧图）。
 */
function applyHoverImageContent(
  state: HoverPopupState,
  message: Extract<HoverPreviewResult, { ok: true }>,
  loaded: RefLoadedImageContent,
): void {
  state.targetFsPath = message.target.fsPath
  state.appliedVersion = message.version
  state.scope = ''
  state.image?.dispose()
  state.image = null
  state.imageFrame?.remove()
  state.imageFrame = null
  state.content.clear()
  state.contentEl.textContent = ''
  const manager = new ImageResourceManager({
    isDirectSrc: isDirectImageSrc,
    requestHost: (src, reqId) => {
      const ctx = context
      const session = ctx?.session()
      if (!ctx || !session?.sessionId || !session.docUri) {
        return
      }
      // 非来源化请求：按面板文档目录解析（宿主 imageSrc 同基准）；不附
      // sourceDocUri（图片目标不是已送达的 B 内容来源）
      ctx.send({ kind: 'image.request', sessionId: session.sessionId, docUri: session.docUri, reqId, src })
    },
  })
  state.image = manager
  const frame = document.createElement('span')
  frame.className = `${GRAPHIC_CHROME_CLASS_NAMES.frame} ${IMAGE_CLASS_NAMES.image} ${IMAGE_CLASS_NAMES.block}`
  const img = document.createElement('img')
  img.alt = ''
  frame.appendChild(img)
  const popupSrc = loaded.src
  frame.appendChild(buildGraphicChrome({
    onPopup: () => { openImagePopup(popupSrc, '') },
  }))
  // 挂 scrollEl 层（contentEl 由虚拟视图全权重建——updateNow 会清外来
  // 子节点；空 Reading 容器零高度不干扰布局）
  state.scrollEl.appendChild(frame)
  state.imageFrame = frame
  manager.attach(img, popupSrc)
  const ctx = context
  if (ctx?.admitRootContent && !ctx.admitRootContent(state.instanceId, loaded, 256)) {
    // 预算拒绝：不入场（释放租约与已建管理器，就地错误分态——与 markdown
    // 路径同口径）
    if (message.sourceLeaseId !== undefined) releaseRefSourceLease(ctx, message.sourceLeaseId)
    manager.dispose()
    state.image = null
    frame.remove()
    state.imageFrame = null
    ctx.releaseRootContent?.(state.instanceId)
    if (state.watchedFsPath !== null) {
      sendWatchMessage(state.watchedFsPath, state.watchInstanceId, 'hover.unwatch')
      state.watchedFsPath = null
      state.watchLeaseId = null
    }
    applyDisplay(state, 'error', t('hover.errorBudget'))
    return
  }
  ensureWatch(state, message.target.fsPath, message.sourceLeaseId)
  applyDisplay(state, 'content', message.target.relPath)
}

/** P2-06/#224 重发读取请求（刷新与 Live 切回的静默重载共用）：新 reqId
 *  推进（旧回包按配对守卫丢弃）；silent 不切 loading 态（旧内容保留）；
 *  已打开实例的重读带 anchorOptional（锚点缺失不切错误页——P2-03） */
function requestReload(state: HoverPopupState, silent: boolean): void {
  const session = context?.session()
  if (!context || !session?.sessionId || !session.docUri) {
    return
  }
  state.reqId = ++reqSeq
  // 版本谱系断点自愈（修 7 同款）：watch 目标文档被宿主释放重开时让版本
  // 防线短暂让位——迟到的旧回包仍由 instanceId + reqId 配对守卫拦截
  state.appliedVersion = -1
  if (!silent) {
    applyDisplay(state, 'loading', t('hover.loading'))
  }
  context.send({
    kind: 'hover.request',
    retainSource: true,
    anchorOptional: true,
    sessionId: session.sessionId,
    docUri: session.docUri,
    reqId: state.reqId,
    instanceId: state.instanceId,
    occurrenceId: state.watchInstanceId,
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
}

/** #224 登记目标订阅（成功装载后；目标身份变化先释放旧订阅）。P2-06：
 *  watch 身份 = watchInstanceId（根会话在场为引用位置语义键——refEdit.bind
 *  来源固定校验同源；纯 Reading 形态为 instanceId 既有身份） */
function ensureWatch(state: HoverPopupState, fsPath: string, sourceLeaseId?: string): void {
  if (state.watchedFsPath === fsPath && sourceLeaseId === undefined) {
    return
  }
  if (state.watchedFsPath !== null && state.watchedFsPath !== fsPath) {
    sendWatchMessage(state.watchedFsPath, state.watchInstanceId, 'hover.unwatch')
  }
  state.watchedFsPath = fsPath
  state.watchLeaseId = sourceLeaseId ?? null
  sendWatchMessage(fsPath, state.watchInstanceId, 'hover.watch', sourceLeaseId)
}

/** #224 订阅消息出站（会话守卫字段与 hover.request 同款） */
function sendWatchMessage(
  fsPath: string,
  instanceId: string,
  kind: 'hover.watch' | 'hover.unwatch',
  sourceLeaseId?: string,
): void {
  const session = context?.session()
  if (!context || !session?.sessionId || !session.docUri) {
    return
  }
  context.send({ kind, sessionId: session.sessionId, docUri: session.docUri, fsPath, instanceId,
    ...(kind === 'hover.watch' && sourceLeaseId !== undefined ? { sourceLeaseId } : {}),
  })
}

/** #342（P3-10）在途悬停请求取消出站（instanceId+reqId 与 hover.request
 *  配对；loading 态关闭浮层时发出——宿主据此中止外链抓取） */
function sendHoverCancel(state: HoverPopupState): void {
  const session = context?.session()
  if (!context || !session?.sessionId || !session.docUri) {
    return
  }
  context.send({
    kind: 'hover.cancel',
    sessionId: session.sessionId,
    docUri: session.docUri,
    instanceId: state.instanceId,
    reqId: state.reqId,
  })
}

/** 宿主读取结果（syncController handleHostMessage 转发）：
 *  仅当场内实例、instanceId 与 reqId 双匹配的结果生效——迟到/陈旧回包
 *  丢弃，绝不重开已关闭浮层。#224 版本仲裁：成功回包的目标版本低于已
 *  应用版本（慢响应旧内容）整体丢弃，不冒充新目标。
 *  #333（P3-01）：成功回包经 refLoadedContentOfResult 类型化装载入口
 *  （contentKind 分派）——kind 与载荷不匹配（本票防御路径：宿主与消息
 *  校验器已拦）返回 null，按不可应用处理：释放来源租约、就地错误分态
 *  （不悬挂 loading、不重开） */
export function notifyHoverResult(message: HoverPreviewResult): boolean {
  if (!popup || message.instanceId !== popup.instanceId || message.reqId !== popup.reqId) {
    return false
  }
  if (message.ok && !shouldApplyHoverVersion(popup.appliedVersion, message.version)) {
    if (context) releaseRefSourceLease(context, message.sourceLeaseId)
    return true
  }
  if (message.ok) {
    // #342（P3-10）web 分派：外链卡片载荷不经 Markdown 装载通道
    //（refLoadedContentOfResult 对 web 返回 null 是消息级防线——此处先于
    // 其分派，卡片内容视图与 Reading 装载互斥）
    if (message.contentKind === 'web') {
      if (message.web === undefined) {
        applyDisplay(popup, 'error', refErrorText('read-failed', popup.target))
        position(popup)
        return true
      }
      applyHoverWebContent(popup, { kind: 'web', ...message.web })
      position(popup)
      return true
    }
    const loaded: RefLoadedAny | null = refLoadedContentOfResult(message)
    if (loaded === null) {
      if (context) releaseRefSourceLease(context, message.sourceLeaseId)
      applyDisplay(popup, 'error', refErrorText('read-failed', popup.target))
      position(popup)
      return true
    }
    if (!isRefLoadedMarkdown(loaded)) {
      // #336（P3-04）image 载荷：委托普通图片挂载（与 ![](图.png) 同一
      // 加载/重试/弹窗行为源），不走 Markdown Reading 渲染路径
      applyHoverImageContent(popup, message, loaded)
    } else {
      applyHoverContent(popup, message, loaded)
    }
  } else {
    // #221 目标原文取 state（三入口同源——面板条目/Live 装饰无 href 属性）
    applyDisplay(popup, 'error', refErrorText(message.reason, popup.target, message.anchor))
  }
  position(popup)
  return true
}

/** 订阅容量／来源校验失败时，立即撤掉不能再获得失效推送的正文。
 *  P2-06：内部 Live 端口在场时不撤编辑现场（编辑经目标端口独立于
 *  hover.watch——失效标记挂起，切回 Reading 时重载） */
export function notifyHoverWatchRejected(message: {
  fsPath: string; instanceId: string; reason: 'capacity' | 'source'; sourceLeaseId?: string
}): void {
  const state = popup
  if (!state || state.watchInstanceId !== message.instanceId || state.watchedFsPath !== message.fsPath ||
    (message.sourceLeaseId !== undefined && state.watchLeaseId !== message.sourceLeaseId)) return
  if (state.root?.hasLivePort()) {
    state.root.markPendingReadingRefresh()
    return
  }
  state.watchedFsPath = null
  state.watchLeaseId = null
  state.content.clear()
  context?.clearRootContent?.(state.instanceId)
  applyDisplay(state, 'error', t(message.reason === 'capacity' ? 'hover.errorWatchCapacity' : 'hover.errorSourceExpired'))
  position(state)
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
 * P2-06：内部 Live 端口在场时不重载 Reading（目标变更经端口增量推送驱动
 *  编辑器——B 会话广播；挂起 pendingReadingRefresh，切回 Reading 时由
 *  管理器 reloadContent 补一次静默重载），deleted/stale 也不撤编辑现场
 *  （B 的 TextDocument 驻留，编辑会话继续——与正文嵌入同款语义）
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
  if (state.root?.hasLivePort()) {
    state.root.markPendingReadingRefresh()
    return
  }
  if (message.status === 'changed') {
    requestReload(state, true)
    return
  }
  // deleted / stale：撤下内容显示分态（视图清空防 display 反转后旧内容
  // 闪现；fm/滚动状态在实例 state 保留，恢复重载后无需重取）
  state.content.clear()
  if (state.image !== null) {
    // #336 图片目标：管理器与图 DOM 一并撤下（分态就地呈现，不残留旧图）
    state.image.dispose()
    state.image = null
    state.imageFrame?.remove()
    state.imageFrame = null
  }
  context?.clearRootContent?.(state.instanceId)
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
 *  器——未知 reqId 由管理器自身丢弃（主面板管理器同款守卫，双投递安全）。
 *  #336：图片目标浮层的管理器同路由（markdown 内容管理器之外的第二消费方） */
export function notifyHoverImageResult(msg: ImageResultPayload): void {
  popup?.image?.handleResult(msg)
  popup?.content.notifyImageResult(msg)
}

/** #220 image.invalidate 路由（syncController 转发）：命中条目撤旧图重发
 *  （B 身份新请求；未命中条目由管理器忽略）。#336：图片目标管理器同路由 */
export function notifyHoverImageInvalidate(srcs: readonly string[]): void {
  popup?.image?.invalidate(srcs)
  popup?.content.invalidateImages(srcs)
}

/** #220 手动刷新失效（refresh.invalidated 路由）：B 管理器全量失效重挂
 *  （活跃槽位重新走宿主解析，新 URI 带新代次戳） */
export function invalidateHoverPopupImages(): void {
  popup?.image?.invalidateAll() // #336 图片目标管理器（手动刷新全量失效）
  popup?.content.invalidateImages()
}

/** P2-06 测试钩子（宿主 hover.test.live 经 syncController 转发）：浮窗根
 *  内部 Live 的操作族——与头部按钮（mode/save/close）与编辑器事务管线
 *  同一处理器链路；无浮窗或无根会话返回 false */
export function hoverPopupLiveTestAction(
  action: 'mode' | 'type' | 'focus' | 'save' | 'close',
  opts?: { intent?: 'close' | 'escape'; pos?: number; to?: number; text?: string },
): boolean {
  const state = popup
  if (!state?.root) {
    return false
  }
  switch (action) {
    case 'mode':
      state.root.toggleMode()
      return true
    case 'type': {
      const view = popupEditorView(state)
      if (!view) {
        return false
      }
      const at = Math.min(opts?.pos ?? 0, view.state.doc.length)
      view.dispatch({ changes: { from: at, to: at, insert: opts?.text ?? '' } })
      return true
    }
    case 'focus': {
      const view = popupEditorView(state)
      if (!view) {
        return false
      }
      if (typeof opts?.pos === 'number') {
        const anchor = Math.min(opts.pos, view.state.doc.length)
        const head = typeof opts.to === 'number'
          ? Math.min(Math.max(opts.to, 0), view.state.doc.length)
          : anchor
        view.dispatch({ selection: { anchor, head } })
      }
      view.focus()
      return true
    }
    case 'save':
      state.root.save()
      return true
    case 'close':
      state.root.requestClose(opts?.intent ?? 'close')
      return true
  }
}

/** 浮窗内编辑器视图（测试钩子与观测共用；不在场 null） */
function popupEditorView(state: HoverPopupState): EditorView | null {
  const editor = state.liveEl.querySelector('.cm-editor')
  return editor instanceof HTMLElement ? EditorView.findFromDOM(editor) : null
}

/** 测试隔离：清空模块级单例状态（生产不调用） */
export function __resetHoverPopupForTest(): void {
  closeHoverPopup()
  releaseInactiveListener()
  context = null
  instanceSeq = 0
  reqSeq = 0
}
