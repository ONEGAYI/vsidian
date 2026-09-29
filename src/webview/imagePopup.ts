// 图片弹窗（工单 #212，规格 docs/specs/image-popup.md）：Markdown 图片的
// 全屏模态查看浮层——复用图表弹窗（#111）的浮层骨架与 CSS 类名族
// （overlay/backdrop/stage/media/toolbar/note），平行单例、与图表弹窗互斥
// （互斥经 popupMutex 去中心化协调，避免两模块循环依赖）。
//
// 与图表弹窗的三处差异（规格决策表）：
// - 内容是 <img>（已解析地址），缩放走 CSS transform（位图无矢量重排可
//   言，不写 width/height）；几何内核（contain-fit/锚点缩放/平移钳制）
//   复用 diagramPopupGeometry 纯函数，放大沿用 0.05–40× 不特判位图。
// - 弹窗图片本身是 ImageResourceManager 的一个槽位（同一资源状态机）：
//   #201 image.invalidate 与 #208 invalidateAll 天然联动弹窗内重载；
//   弹窗关闭即 detach 槽位。「打开时快照」由浏览器对同 URI 的缓存语义
//   承担（正文已装载的地址直接复用，不重新请求字节）。
// - 工具条五钮：缩放（−/标签/+）/ 重置 / 刷新 / 导出 / 关闭。「刷新」按
//   当前文档重定位该图（rawSrc 仍在文档中才算定位到）后走 image.invalidate
//   单源失效重取；定位不到（图被删/改写）维持快照。导出经宿主字节级拷贝
//   （image.export 消息对），外链图禁用 + 悬停提示。
//
// 零写回：点击/hover/开关弹窗/刷新/导出均不触碰文档与撤销栈。
import { t } from '../shared/i18n'
import { IMAGE_PASTE_LIMITS } from '../shared/protocol'
import { normalizeImgSrc, type ImageResourceManager } from './imageResource'
import { closeDiagramPopup, DIAGRAM_POPUP_CLASS_NAMES } from './diagramPopup'
import { claimPopup, releasePopup } from './popupMutex'
import {
  POPUP_DRAG_SLOP,
  POPUP_FALLBACK_SIZE,
  containFitTransform,
  panTransform,
  POPUP_PAN_KEY_STEP,
  POPUP_ZOOM_STEP,
  zoomAtTransform,
  type PopupTransform,
} from './diagramPopupGeometry'

/** 图片弹窗在弹窗类名族内的新增导出钮类名（其余全部复用图表弹窗） */
export const IMAGE_POPUP_EXPORT_CLASS = 'vsidian-diagram-export-image'

/** 装配上下文（syncController.mount 注入，dispose 清空） */
export interface ImagePopupContext {
  images: ImageResourceManager
  /** 当前文档全文（刷新的重定位数据源；live CM6 state 是文本权威） */
  docSource: () => string | null
  /** 外链判定（与 ImageResourceManager.isDirectSrc 同源正则） */
  isDirectSrc: (src: string) => boolean
  /** 导出出站（宿主侧补 sessionId/docUri 后走 image.export） */
  sendExport: (req: { reqId: number; src: string; fileName: string }) => void
}

let context: ImagePopupContext | null = null

export function setImagePopupContext(ctx: ImagePopupContext | null): void {
  context = ctx
}

/** 导出建议文件名限长（与宿主 sanitize 及粘贴 fileNameHint 同限，单一值源） */
const IMAGE_EXPORT_FILE_NAME_MAX = IMAGE_PASTE_LIMITS.fileNameHintMaxChars

/** 导出建议文件名：rawSrc 取 basename（输入已是 normalizeImgSrc 解码
 *  形态——openImagePopup 归一后的身份，不得再 decode 一次，否则与显示
 *  通道口径分叉），剥 query/fragment（定位侧同口径）与两种路径分隔符；
 *  纯点段（`.`/`..`）与超长名回退默认，与宿主 sanitize 同值 */
export function suggestImageExportFileName(rawSrc: string): string {
  // 剥离顺序与定位侧 planPathTextOf 同口径（先 fragment 后 query，即取
  // 较前分隔符）：a.png?v=2#sec 两层都剥净，避免预填名剩 a.png?v=2
  let name = rawSrc.split('#')[0]!.split('?')[0]!
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'))
  if (slash >= 0) {
    name = name.slice(slash + 1)
  }
  const cleaned = name.trim()
  if (cleaned === '' || /^\.+$/.test(cleaned) || cleaned.length > IMAGE_EXPORT_FILE_NAME_MAX) {
    return 'image.png'
  }
  return cleaned
}

/**
 * 图片出现定位（刷新重定位的形态学）：rawSrc（解码形态）在文档中以图片
 * 目标出现——标准形态 `](目标)`（后随 `)` / 空白 / `>` 标题边界）或尖括号
 * 形态 `](<目标>)`（含空格路径的标准写法，live linkHrefOf 与 markdown-it
 * 两侧均剥尖括号取内部值）即定位到。文档存的是源文原样（可能是 %20
 * 编码形态），解码值直接找不到时以 encodeURI 回查原文形态（markdown-it
 * normalizeLink 同款编码面）。图片的「身份」就是 rawSrc——src 被改写即
 * 旧身份消失（新图是新弹窗语境），与图表弹窗按「语言+源码」重定位的
 * 语义对偶。
 */
export function locateImageOccurrence(doc: string, rawSrc: string): boolean {
  if (rawSrc.length === 0) {
    return false
  }
  const candidates = rawSrc === encodeURI(rawSrc) ? [rawSrc] : [rawSrc, encodeURI(rawSrc)]
  for (const candidate of candidates) {
    let at = doc.indexOf(`](${candidate}`)
    while (at >= 0) {
      const end = at + ']('.length + candidate.length
      const next = doc[end]
      if (next === undefined || next === ')' || next === ' ' || next === '>') {
        return true
      }
      at = doc.indexOf(`](${candidate}`, at + 1)
    }
    // 尖括号形态：`](<目标>)`——目标整体在尖括号内，无标题边界跟随
    if (doc.includes(`](<${candidate}>)`)) {
      return true
    }
  }
  return false
}

// ---- 单例浮层状态 ----

/** 导出请求序号（会话面板内自增；sessionId/docUri 由装配层补齐） */
let exportReqSeq = 0

interface ImagePopupState {
  overlay: HTMLElement
  stage: HTMLElement
  media: HTMLElement
  toolbar: HTMLElement
  zoomLabel: HTMLElement
  /** 弹窗图片（管理器槽位；attach/detach 与弹窗同生命周期） */
  img: HTMLImageElement
  rawSrc: string
  intrinsic: { w: number; h: number }
  transform: PopupTransform
  prevFocus: HTMLElement | null
  prevBodyOverflow: string
  cleanups: Array<() => void>
}

let popup: ImagePopupState | null = null

export function isImagePopupOpen(): boolean {
  return popup !== null
}

export function closeImagePopup(): void {
  if (!popup) {
    return
  }
  const p = popup
  popup = null
  releasePopup(closeImagePopup)
  for (const cleanup of p.cleanups) {
    cleanup()
  }
  context?.images.detach(p.img)
  p.overlay.remove()
  document.body.style.overflow = p.prevBodyOverflow
  if (p.prevFocus && p.prevFocus.isConnected) {
    p.prevFocus.focus()
  }
}

function applyTransform(p: ImagePopupState): void {
  // 位图缩放走 transform（无矢量重排）；media 是 flex 居中元素，scale 围绕
  // 中心（默认 origin）与 translate 组合——几何公式的锚点语义照常成立
  p.media.style.transform = `translate(${p.transform.panX}px, ${p.transform.panY}px) scale(${p.transform.scale})`
  p.zoomLabel.textContent = `${Math.round(p.transform.scale * 100)}%`
}

function zoomBy(p: ImagePopupState, factor: number, anchor?: { x: number; y: number }): void {
  const point = anchor ?? { x: 0, y: 0 }
  p.transform = zoomAtTransform(p.transform, point, factor)
  applyTransform(p)
}

/** 装载后的 contain-fit：intrinsic 取自然尺寸（未解码/0 尺寸兜底），并
 *  重置平移——刷新/invalidate 重取的新图从整图可见开始 */
function fitToStage(p: ImagePopupState): void {
  const w = p.img.naturalWidth || POPUP_FALLBACK_SIZE.w
  const h = p.img.naturalHeight || POPUP_FALLBACK_SIZE.h
  p.intrinsic = { w, h }
  p.transform = containFitTransform(
    { w: p.stage.clientWidth, h: p.stage.clientHeight },
    p.intrinsic,
  )
  applyTransform(p)
}

/** 刷新语义（规格决策表）：按当前文档重定位该图（rawSrc 仍在文档中）后
 *  走 image.invalidate 单源失效重取——弹窗 img 是管理器槽位，重挂后的新
 *  地址自动应用并触发 load 重新 fit。定位不到（文档不可得/图被删改）或
 *  直连外链（无失效语义）维持快照 */
function refreshImage(p: ImagePopupState): void {
  const ctx = context
  if (!ctx) {
    return
  }
  const doc = ctx.docSource()
  if (doc === null || !locateImageOccurrence(doc, p.rawSrc)) {
    return
  }
  ctx.images.invalidate([p.rawSrc])
}

const TB_ICON = {
  minus:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M3.5 8h9"></path></svg>',
  plus:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"></path></svg>',
  reset:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.6-3.7"></path><path d="M13 2.8v2.4h-2.4"></path></svg>',
  refresh:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 8a5.5 5.5 0 0 1 9.4-3.9L13.5 5.5"></path><path d="M13.5 2.5v3h-3"></path><path d="M13.5 8a5.5 5.5 0 0 1-9.4 3.9L2.5 10.5"></path><path d="M2.5 13.5v-3h3"></path></svg>',
  download:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><path d="M8 2.5v7.5"></path><path d="M5 7.5l3 3 3-3"></path><path d="M2.5 13.5h11"></path></svg>',
  close:
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"></path></svg>',
}

function toolbarButton(
  className: string,
  label: string,
  icon: string,
  onClick: () => void,
  disabled = false,
): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.className = className
  btn.setAttribute('aria-label', label)
  btn.title = label
  btn.innerHTML = icon
  btn.disabled = disabled
  btn.addEventListener('click', onClick)
  return btn
}

/** 外链导出钮的悬停提示宿主（disabled button 不派发鼠标事件） */
function wrapExportHint(btn: HTMLButtonElement): HTMLElement {
  const hint = document.createElement('span')
  hint.title = t('graphic.popupExportImageDisabled')
  hint.appendChild(btn)
  return hint
}

/** 打开图片弹窗（单例：再次打开先关闭旧的；与图表弹窗互斥）。rawSrc 统一
 *  归一为解码形态（与 image.request 的 src 同口径）：live 装饰传入源文
 *  原样（可能是 %20 编码），阅读 dataset 已是解码值——归一后装载、刷新
 *  定位与导出消息共用同一身份 */
export function openImagePopup(rawSrc: string, alt: string): void {
  const ctx = context
  if (!ctx) {
    return
  }
  // 归一为解码身份（live 槽位传入源文原样；阅读 dataset 已是归一值，再
  // 归一为幂等空操作——除非身份含合法 %XX 字面，见规格「已知边界」）
  rawSrc = normalizeImgSrc(rawSrc)
  closeImagePopup()
  closeDiagramPopup() // 互斥：同时只允许一个弹窗实例（规格）
  claimPopup(closeImagePopup)
  const overlay = document.createElement('div')
  overlay.className = DIAGRAM_POPUP_CLASS_NAMES.overlay
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-label', t('graphic.popup'))
  const backdrop = document.createElement('div')
  backdrop.className = DIAGRAM_POPUP_CLASS_NAMES.backdrop
  const stage = document.createElement('div')
  stage.className = DIAGRAM_POPUP_CLASS_NAMES.stage
  stage.tabIndex = -1
  const media = document.createElement('div')
  media.className = DIAGRAM_POPUP_CLASS_NAMES.media
  const img = document.createElement('img')
  img.alt = alt
  // 禁原生拖拽：img 默认 draggable=true，按住拖动会启动浏览器原生 drag
  // （ghost 缩略图跟随鼠标 + 宿主 copy 徽标），并吞掉平移手势的输入流
  img.draggable = false
  media.appendChild(img)
  stage.appendChild(media)
  const toolbar = document.createElement('div')
  toolbar.className = DIAGRAM_POPUP_CLASS_NAMES.toolbar
  toolbar.setAttribute('role', 'toolbar')
  const zoomLabel = document.createElement('span')
  zoomLabel.className = DIAGRAM_POPUP_CLASS_NAMES.zoomLabel
  zoomLabel.textContent = '100%'
  const state: ImagePopupState = {
    overlay,
    stage,
    media,
    toolbar,
    zoomLabel,
    img,
    rawSrc,
    intrinsic: POPUP_FALLBACK_SIZE,
    transform: { scale: 1, panX: 0, panY: 0 },
    prevFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    prevBodyOverflow: document.body.style.overflow,
    cleanups: [],
  }
  // 导出钮：外链（http/https 直连）禁用——无宿主可寻址的工作区文件，不做
  // 网络下载（规格明确排除）。disabled 按钮不派发鼠标事件（悬停 title 无
  // 从显示），外层 span 承担悬停提示（规格「禁用 + 悬停提示」）
  const exportBtn = toolbarButton(
    IMAGE_POPUP_EXPORT_CLASS,
    t('graphic.popupExportImage'),
    TB_ICON.download,
    () => {
      ctx.sendExport({
        reqId: ++exportReqSeq,
        src: rawSrc,
        fileName: suggestImageExportFileName(rawSrc),
      })
    },
    ctx.isDirectSrc(rawSrc),
  )
  const exportHost = ctx.isDirectSrc(rawSrc) ? wrapExportHint(exportBtn) : exportBtn
  toolbar.append(
    toolbarButton(DIAGRAM_POPUP_CLASS_NAMES.zoomOut, t('graphic.popupZoomOut'), TB_ICON.minus, () =>
      zoomBy(state, 1 / POPUP_ZOOM_STEP)),
    zoomLabel,
    toolbarButton(DIAGRAM_POPUP_CLASS_NAMES.zoomIn, t('graphic.popupZoomIn'), TB_ICON.plus, () =>
      zoomBy(state, POPUP_ZOOM_STEP)),
    toolbarButton(DIAGRAM_POPUP_CLASS_NAMES.reset, t('graphic.popupReset'), TB_ICON.reset, () => {
      fitToStage(state)
    }),
    toolbarButton(DIAGRAM_POPUP_CLASS_NAMES.refresh, t('graphic.popupRefresh'), TB_ICON.refresh, () => {
      refreshImage(state)
    }),
    exportHost,
    toolbarButton(DIAGRAM_POPUP_CLASS_NAMES.close, t('graphic.popupClose'), TB_ICON.close, () =>
      closeImagePopup()),
  )
  overlay.append(backdrop, stage, toolbar)
  document.body.appendChild(overlay)
  document.body.style.overflow = 'hidden'

  // 弹窗图片 = 管理器槽位（同一资源状态机）：装载/失效/全量刷新联动；
  // load 后按自然尺寸 contain-fit（刷新重取的新图重新 fit）
  const onImgLoad = () => fitToStage(state)
  img.addEventListener('load', onImgLoad)
  ctx.images.attach(img, rawSrc)

  // 滚轮缩放（光标锚点；preventDefault 阻止页面滚动）
  const onWheel = (event: WheelEvent) => {
    event.preventDefault()
    const rect = stage.getBoundingClientRect()
    zoomBy(
      state,
      event.deltaY < 0 ? POPUP_ZOOM_STEP : 1 / POPUP_ZOOM_STEP,
      { x: event.clientX - (rect.left + rect.width / 2), y: event.clientY - (rect.top + rect.height / 2) },
    )
  }
  stage.addEventListener('wheel', onWheel, { passive: false })

  // 拖拽平移 + 点空白关闭（拖拽落点不算点击；与图表弹窗同款判定）
  let dragging = false
  let moved = false
  let downX = 0
  let downY = 0
  let downTarget: EventTarget | null = null
  let lastX = 0
  let lastY = 0
  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || event.target === toolbar || toolbar.contains(event.target as Node)) {
      return
    }
    dragging = true
    moved = false
    downTarget = event.target
    downX = event.clientX
    downY = event.clientY
    lastX = event.clientX
    lastY = event.clientY
    stage.setPointerCapture?.(event.pointerId)
    stage.classList.add('vsidian-diagram-stage--dragging') // 拖拽光标态（CSS 修饰类，随 stage 类名族）
  }
  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) {
      return
    }
    const dx = event.clientX - lastX
    const dy = event.clientY - lastY
    if (
      !moved &&
      Math.abs(event.clientX - downX) + Math.abs(event.clientY - downY) > POPUP_DRAG_SLOP
    ) {
      moved = true
    }
    lastX = event.clientX
    lastY = event.clientY
    state.transform = panTransform(state.transform, dx, dy)
    applyTransform(state)
  }
  const onPointerUp = (event: PointerEvent) => {
    if (!dragging) {
      return
    }
    dragging = false
    stage.classList.remove('vsidian-diagram-stage--dragging')
    if (stage.hasPointerCapture?.(event.pointerId)) {
      stage.releasePointerCapture?.(event.pointerId)
    }
    // 空白关闭判定用按下时的原始 target（setPointerCapture 重定向规避，
    // 与图表弹窗同款）：点在图上不关闭
    if (!moved && downTarget === stage) {
      closeImagePopup()
    }
  }
  stage.addEventListener('pointerdown', onPointerDown)
  stage.addEventListener('pointermove', onPointerMove)
  stage.addEventListener('pointerup', onPointerUp)
  backdrop.addEventListener('click', () => closeImagePopup())

  // 键盘：+/-/0 缩放、方向平移、Esc 关闭；只在弹窗内生效
  const onKeyDown = (event: KeyboardEvent) => {
    switch (event.key) {
      case '+':
      case '=':
        event.preventDefault()
        event.stopPropagation()
        zoomBy(state, POPUP_ZOOM_STEP)
        break
      case '-':
        event.preventDefault()
        event.stopPropagation()
        zoomBy(state, 1 / POPUP_ZOOM_STEP)
        break
      case '0':
        event.preventDefault()
        event.stopPropagation()
        fitToStage(state)
        break
      case 'ArrowLeft':
        event.preventDefault()
        event.stopPropagation()
        state.transform = panTransform(state.transform, POPUP_PAN_KEY_STEP, 0)
        applyTransform(state)
        break
      case 'ArrowRight':
        event.preventDefault()
        event.stopPropagation()
        state.transform = panTransform(state.transform, -POPUP_PAN_KEY_STEP, 0)
        applyTransform(state)
        break
      case 'ArrowUp':
        event.preventDefault()
        event.stopPropagation()
        state.transform = panTransform(state.transform, 0, POPUP_PAN_KEY_STEP)
        applyTransform(state)
        break
      case 'ArrowDown':
        event.preventDefault()
        event.stopPropagation()
        state.transform = panTransform(state.transform, 0, -POPUP_PAN_KEY_STEP)
        applyTransform(state)
        break
      case 'Escape':
        event.preventDefault()
        event.stopPropagation()
        closeImagePopup()
        break
      default:
        break
    }
  }
  overlay.addEventListener('keydown', onKeyDown)

  state.cleanups.push(() => {
    img.removeEventListener('load', onImgLoad)
    stage.removeEventListener('wheel', onWheel)
    stage.removeEventListener('pointerdown', onPointerDown)
    stage.removeEventListener('pointermove', onPointerMove)
    stage.removeEventListener('pointerup', onPointerUp)
    overlay.removeEventListener('keydown', onKeyDown)
  })

  popup = state
  stage.focus()
}
