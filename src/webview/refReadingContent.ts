// 引用内容的只读 Reading 装配（工单 #222 从 hoverPopup 提取的共享层）：
// 悬停浮层（#218–#220）与 Reading 正文嵌入卡片（#222）呈现同一形态的
// 引用内容——B 文档 Reading 视图的块挂载装配、B 身份资源管理器、笔记
// 属性区折叠与错误分态文案在此单一实现，两侧消费不各自复制（防漂移）。
//
// 职责边界（ADR-0009「内容视图」层）：本模块只负责「引用内容块进 DOM 时
// 装配成什么」。内容实例与配对释放在 refContentInstance，布局和挂载时机
// 仍归各自容器模块（hoverPopup / embedCard）。
//
// 复用先例与行为来源：#220 的浮层装配（B 身份图片、朴素代码高亮、fm
// 折叠交互——标题行悬停热区 + 按钮唯一操作入口、刷新不重置展开态）；
// 提取为共享模块是 #222 的结构性前置，浮侧行为逐字节保持（回归由
// hoverPopup 单测与浏览器套件钉住）。
import {
  ImageResourceManager,
  isDirectImageSrc,
} from './imageResource'
import { prepareReadingImages, READING_CLASS_NAMES } from './readingView'
import { renderGraphicBlockInto } from './graphicRenderers'
import { decorateReadingCodeCard, isReadingCodeBlock } from './readingCodeCard'
import { buildFrontmatterHeaderHtml, escapeHtml } from '../shared/frontmatterTable'
import { t } from '../shared/i18n'
import type { HoverPreviewFailReason, WebviewToHost } from '../shared/protocol'

/** 每次送达的临时租约单独释放；不把 token 缓存在共享内容数据中。 */
export function releaseRefSourceLease(deps: {
  session(): { sessionId: string | undefined; docUri: string | undefined }
  send(message: WebviewToHost): void
}, sourceLeaseId?: string): void {
  const session = deps.session()
  if (sourceLeaseId === undefined || !session.sessionId || !session.docUri) return
  deps.send({ kind: 'hover.source.release', sessionId: session.sessionId, docUri: session.docUri, sourceLeaseId })
}

/** #220 笔记属性区稳定类名（样式契约 chrome 域 hover-fm-section 条目同源；
 *  #222 起嵌入卡片同款复用——引用内容专属样式入口，主阅读视图不受影响） */
export const REF_FM_CLASS_NAMES = {
  /** 属性区修饰（挂引用内容内 frontmatter 块；仅全文引用） */
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
const REF_FM_TOGGLE_ICON_SVG =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" ' +
  'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M4 6l4 4 4-4"></path></svg>'

/** 属性区折叠状态机（容器实例状态的读写端口）：展开态的单一事实源在
 *  容器实例（浮层/嵌入卡片各自的 state），DOM 只读此值施加——「刷新不
 *  重置、重开/重挂载按实例状态恢复」语义由容器侧持有状态实现 */
export interface RefFmController {
  /** 当前展开态 */
  expanded(): boolean
  /** 切换并返回新值 */
  toggle(): boolean
}

/** B 身份资源管理器工厂：请求一律附 sourceDocUri（宿主按 B 目录解析，
 *  会话守卫字段仍是面板自身）。无周期核验接线——引用容器生命周期内
 *  手动刷新通道由容器侧自行接（#224 接变更订阅） */
export function createSourcedImageManager(deps: {
  session(): { sessionId: string | undefined; docUri: string | undefined }
  send(message: WebviewToHost): void
  /** 当前引用目标 fsPath（成功回包送达后非空；空串时请求侧自行放弃） */
  sourceDocUri(): string
}): ImageResourceManager {
  return new ImageResourceManager({
    isDirectSrc: isDirectImageSrc,
    requestHost: (src, reqId) => {
      const session = deps.session()
      const source = deps.sourceDocUri()
      if (!session.sessionId || !session.docUri || !source) {
        return // 无会话或无 B 身份：不发（宿主无从解析）
      }
      deps.send({
        kind: 'image.request',
        sessionId: session.sessionId,
        docUri: session.docUri,
        reqId,
        src,
        sourceDocUri: source,
      })
    },
  })
}

/** 引用内容块挂载装配（虚拟化与无布局回退两路径共用）：只读装配 +
 *  B 身份图片 + 图形块渲染 + 代码高亮 + 笔记属性区（fmActive 且块为
 *  frontmatter 时施加——章节/块引用不附带属性区，由调用方以 fmActive
 *  表达） */
export function mountRefContentBlock(
  el: HTMLElement,
  opts: {
    images: ImageResourceManager | null
    /** 朴素代码高亮开关（#220：无卡片工具条——token span 直接注入） */
    codeHighlight: boolean
    /** 属性区折叠状态机；null = 非全文范围（不施加属性区） */
    fm: RefFmController | null
    /** 内容挂载的配对释放入口；旧调用方可继续只做装配。 */
    onDispose?: (cleanup: () => void) => void
  },
): void {
  for (const box of Array.from(el.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
    box.disabled = true
  }
  if (opts.images) {
    prepareReadingImages(el, opts.images)
  }
  renderGraphicBlockInto(el)
  // #220 代码高亮：朴素形态（card=false——无头部/行号/按钮；token span
  // 直接注入 code）。卡片工具条不进引用内容：复制按钮的会话语义
  // （codeblock.copy 按面板文档 EOL 归一）与折叠/折行的全局联动属主视图行为
  if (isReadingCodeBlock(el)) {
    decorateReadingCodeCard(el, {
      config: {
        card: false,
        lineNumbers: false,
        copyButton: false,
        highlight: opts.codeHighlight,
      },
      folded: false,
      onCopy: () => undefined,
      onFoldToggle: () => undefined,
    })
  }
  if (opts.fm) {
    applyRefFmSection(el, opts.fm, opts.onDispose)
  }
}

/** #220 笔记属性区施加（幂等；虚拟化重挂载时按 controller.expanded()
 *  重建）：仅全文引用（fmActive 由调用方判定）；成型态复用阅读侧标题栏，
 *  降级态合成同构标题栏（源码原文不丢弃，仅收起时隐藏） */
export function applyRefFmSection(el: HTMLElement, fm: RefFmController, onDispose?: (cleanup: () => void) => void): void {
  if (!el.classList.contains(READING_CLASS_NAMES.frontmatter)) {
    return
  }
  el.classList.add(REF_FM_CLASS_NAMES.section)
  let header = el.querySelector<HTMLElement>(`.${FM_HEADER_CLASS}`)
  if (!header) {
    // 降级 frontmatter：合成与成型态同构的标题栏（图标 + 标题同源构件）
    header = document.createElement('div')
    header.className = FM_HEADER_CLASS
    header.innerHTML = buildFrontmatterHeaderHtml(escapeHtml(t('frontmatter.title')))
    el.insertBefore(header, el.firstChild)
  }
  let btn = header.querySelector<HTMLButtonElement>(`.${REF_FM_CLASS_NAMES.toggle}`)
  if (!btn) {
    btn = document.createElement('button')
    btn.type = 'button'
    btn.className = REF_FM_CLASS_NAMES.toggle
    btn.innerHTML = REF_FM_TOGGLE_ICON_SVG
    const toggleBtn = btn
    const onClick = (event: MouseEvent): void => {
      // 热区语义：按钮是唯一操作入口（标题行 hover 只负责显示按钮）；
      // 阻断冒泡以免触发容器级点击语义
      event.stopPropagation()
      const expanded = fm.toggle()
      const section = toggleBtn.closest<HTMLElement>(`.${REF_FM_CLASS_NAMES.section}`)
      if (section) {
        applyFmCollapsedTo(section, expanded)
      }
    }
    toggleBtn.addEventListener('click', onClick)
    onDispose?.(() => toggleBtn.removeEventListener('click', onClick))
    header.appendChild(btn)
  }
  applyFmCollapsedTo(el, fm.expanded())
}

/** 折叠态施加到属性区块（类 + 按钮的 aria 与文案） */
function applyFmCollapsedTo(section: HTMLElement, expanded: boolean): void {
  section.classList.toggle(REF_FM_CLASS_NAMES.collapsed, !expanded)
  const btn = section.querySelector<HTMLButtonElement>(`.${REF_FM_CLASS_NAMES.toggle}`)
  if (btn) {
    btn.setAttribute('aria-expanded', String(expanded))
    const label = expanded ? t('hover.content.fmCollapse') : t('hover.content.fmExpand')
    btn.setAttribute('aria-label', label)
    btn.title = label
  }
}

/** 引用读取错误分态 → 就地 i18n 文案（不弹宿主通知；anchor-missing 附
 *  锚点原文）——悬停浮层与嵌入卡片共用同一文案面 */
export function refErrorText(reason: HoverPreviewFailReason, target: string, anchor?: string): string {
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
