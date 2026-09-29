// Reading 正文嵌入卡片（工单 #222，ADR-0009「展示容器」层的嵌入侧）：
// 父文档 Reading 正文流中，独占行 `![[…]]` embed 块（readingBlocks 产物）
// 挂载时升级为引用卡片——左侧引用边条 + 顶部文件名 + 右上角打开入口，
// 内容为目标的只读 Reading 视图（独立 VirtualReadingView 实例，经悬停
// 文档访问通道 hover.request/result 装载全文/章节/块）。
//
// 分层契约（#223/#224 的衔接边界）：
// - 本模块只做 **Reading 侧挂载适配与容器生命周期**；目标解析与内容服务
//   在 hoverDocAccess（宿主）与 refReadingContent（共享装配），Live 侧
//   嵌入（#223）与未保存变更刷新（#224）不在此实现，接口已按容器无关
//   设计（实例身份 = 嵌入行区间 + 目标原文，与容器类型无绑定）。
// - 一层展开：B 内容内的 embed 块**不升级**（readingBlocks 的占位引用行
//   呈现，可点击按 B 身份打开）——不递归装载、不在嵌入内容上叠加悬停
//   浮层（contentEl 停止 mouseover/mouseout 冒泡）。
// - 虚拟化：嵌入块是父文档 VirtualReadingView 的普通块，随窗口挂载/回收
//   ——本模块在回收时释放 B 视图与 B 资源管理器、保留 fm 展开与滚动
//   位置（状态库按语义键持有）；重挂优先用装载缓存（会话内零重发，
//   #224 接变更订阅后失效重载）。
// - 只读契约：任务 checkbox 禁用（共享 mountRefContentBlock）、点击不
//   写文档；卡片内点击不冒泡父容器委托（B 内链接按 B 目录解析是唯一
//   正确语义，父容器按 A 解析的委托不得命中）。
import type { HoverPreviewResult, WebviewToHost } from '../shared/protocol'
import { parseWikilinkInner } from '../shared/wikilink'
import { t } from '../shared/i18n'
import { ImageResourceManager } from './imageResource'
import { applyObsidianDomAlias } from '../shared/obsidianAlias'
import { createReadingContainer, READING_CLASS_NAMES } from './readingView'
import { VirtualReadingView } from './readingVirtualView'
import {
  createSourcedImageManager,
  mountRefContentBlock,
  refErrorText,
  type RefFmController,
} from './refReadingContent'
import { WIKILINK_CLASS_NAMES } from '../shared/wikilink'

/** 嵌入卡片稳定类名（样式契约 content 域 reading-embed-card 条目同源） */
export const EMBED_CARD_CLASS_NAMES = {
  /** 卡片壳（左引用边条 + 边框；挂 Obsidian 别名 .markdown-embed） */
  card: 'vsidian-embed-card',
  /** 顶部栏（文件名 + 打开入口） */
  header: 'vsidian-embed-card-header',
  /** 文件名（成功后为根内相对路径；装载前为目标显示形态） */
  title: 'vsidian-embed-card-title',
  /** 右上角跳转目标文档入口（沿用 Vsidian 打开行为） */
  open: 'vsidian-embed-card-open',
  /** 内容滚动区（长内容内部滚动；max-height 由设置驱动内联写入） */
  scroll: 'vsidian-embed-card-scroll',
  /** 就地状态行（loading / 错误分态） */
  state: 'vsidian-embed-card-state',
} as const

/** 出站上下文（syncController mount 注入；dispose 清空） */
export interface EmbedCardContext {
  /** 会话身份（init 前为 undefined——此时只升级壳不发请求） */
  session(): { sessionId: string | undefined; docUri: string | undefined }
  /** 出站通道（hover.request / image.request / *.activate 只读消息） */
  send(message: WebviewToHost): void
  /** 代码高亮开关（面板 codeCardConfig.highlight 只读投影；缺省开） */
  codeHighlight?(): boolean
  /** 嵌入限高设置（px；设置页 embed.maxHeight 投影） */
  maxHeightPx(): number
}

/** 装载结果缓存（父文档会话内；#224 变更订阅接入前的首载快照） */
interface EmbedLoaded {
  fsPath: string
  relPath: string
  scope: 'full' | 'heading' | 'block'
  text: string
  range: { start: number; end: number }
}

/** 嵌入实例状态（跨挂载保持——视口回收不清除仍可见实例的状态） */
interface EmbedEntry {
  /** 语义键：嵌入行区间 + 目标原文（父文档文本不变则稳定；文本变更后
   *  键漂移自然开新实例，旧键随会话 dispose 回收） */
  key: string
  inner: string
  sourceStart: number
  sourceEnd: number
  loaded: EmbedLoaded | null
  /** 在途请求配对（卸载后的迟到回包仍写入缓存） */
  lastReq: { instanceId: string; reqId: number } | null
  fmExpanded: boolean
  scrollTop: number
}

/** 挂载中的卡片实例（DOM 生命周期 = 块元素在场期间） */
interface EmbedCardHandle {
  entry: EmbedEntry
  instanceId: string
  hostEl: HTMLElement
  cardEl: HTMLElement
  scrollEl: HTMLElement
  stateEl: HTMLElement
  contentEl: HTMLElement
  view: VirtualReadingView
  bImages: ImageResourceManager | null
  display: 'loading' | 'content' | 'error'
  note: string
  /** fm 控制器（容器状态机实现，entry 为单一事实源） */
  fm: RefFmController
}

/** 嵌入卡片观测探针形态（view.state.readingEmbed 数据源） */
export interface EmbedCardProbe {
  inner: string
  state: 'loading' | 'content' | 'error'
  note: string
  blocks: number
  scope: 'full' | 'heading' | 'block' | ''
  fm: 'none' | 'collapsed' | 'expanded'
  maxHeightPx: number
}

/** 目标原文（`|` 之前——与阅读双链 a 的 href 同口径） */
function targetOfInner(inner: string): string {
  const pipeAt = inner.indexOf('|')
  return pipeAt >= 0 ? inner.slice(0, pipeAt) : inner
}

/**
 * 嵌入卡片管理器：一个 Reading 视图一个实例（syncController mount 创建、
 * dispose 释放）。父文档块挂载/卸载钩子驱动卡片升级与回收；hover.result
 * 按 entry.lastReq 配对（在场渲染 + 卸载后缓存双路径）。
 */
export class EmbedCardManager {
  private readonly context: EmbedCardContext
  /** 父文档会话内状态库（语义键 → 实例状态；dispose 清空） */
  private readonly entries = new Map<string, EmbedEntry>()
  /** 挂载中卡片（块元素 → handle；块卸载即移除） */
  private readonly active = new Map<HTMLElement, EmbedCardHandle>()
  private seq = 0
  private reqSeq = 0

  constructor(context: EmbedCardContext) {
    this.context = context
  }

  /** 父文档块挂载钩子：embed 块（data-vsidian-embed-inner 在场）升级为卡片 */
  mountBlock(el: HTMLElement): void {
    const inner = el.dataset['vsidianEmbedInner']
    if (inner === undefined || this.active.has(el)) {
      return
    }
    const sourceStart = Number(el.dataset['vsidianSrcStart'] ?? 0)
    const sourceEnd = Number(el.dataset['vsidianSrcEnd'] ?? sourceStart)
    const key = `${Number.isInteger(sourceStart) ? sourceStart : 0}::${inner}`
    let entry = this.entries.get(key)
    if (!entry) {
      entry = {
        key,
        inner,
        sourceStart: Number.isInteger(sourceStart) ? sourceStart : 0,
        sourceEnd: Number.isInteger(sourceEnd) ? sourceEnd : sourceStart,
        loaded: null,
        lastReq: null,
        fmExpanded: false,
        scrollTop: 0,
      }
      this.entries.set(key, entry)
    }

    // 卡片壳 DOM（替换块内占位引用行；块元素的源锚点 dataset 保持）
    el.textContent = ''
    const cardEl = document.createElement('div')
    // #222 别名桥：卡片壳同时挂 Obsidian 嵌入容器名（.markdown-embed）
    //——主题片段的嵌入容器规则天然命中
    cardEl.className = applyObsidianDomAlias(EMBED_CARD_CLASS_NAMES.card)
    const header = document.createElement('div')
    header.className = EMBED_CARD_CLASS_NAMES.header
    const titleEl = document.createElement('span')
    titleEl.className = EMBED_CARD_CLASS_NAMES.title
    titleEl.textContent = parseWikilinkInner(inner)?.display ?? inner
    const openBtn = document.createElement('button')
    openBtn.type = 'button'
    openBtn.className = EMBED_CARD_CLASS_NAMES.open
    const openLabel = t('embed.openTarget')
    openBtn.setAttribute('aria-label', openLabel)
    openBtn.title = openLabel
    header.appendChild(titleEl)
    header.appendChild(openBtn)
    const scrollEl = document.createElement('div')
    scrollEl.className = EMBED_CARD_CLASS_NAMES.scroll
    scrollEl.style.maxHeight = `${this.context.maxHeightPx()}px`
    const stateEl = document.createElement('div')
    stateEl.className = EMBED_CARD_CLASS_NAMES.state
    const contentEl = createReadingContainer()
    scrollEl.appendChild(contentEl)
    cardEl.appendChild(header)
    cardEl.appendChild(scrollEl)
    cardEl.appendChild(stateEl)
    el.appendChild(cardEl)

    const handle: EmbedCardHandle = {
      entry,
      instanceId: `embed-${++this.seq}`,
      hostEl: el,
      cardEl,
      scrollEl,
      stateEl,
      contentEl,
      view: null as unknown as VirtualReadingView,
      bImages: null,
      display: 'loading',
      note: '',
      fm: {
        expanded: () => entry!.fmExpanded,
        toggle: () => (entry!.fmExpanded = !entry!.fmExpanded),
      },
    }
    handle.view = new VirtualReadingView(contentEl, {
      onBlockMounted: (blockEl) => this.mountContentBlock(handle, blockEl),
      onBlockUnmounted: (blockEl) => handle.bImages?.detachWithin(blockEl),
    })
    this.active.set(el, handle)

    // 卡片内交互域：点击不冒泡父容器委托（B 内链接按 B 解析）；悬停不
    // 叠加浮层（阻断 readingContainer 的 mouseover/mouseout 委托）
    contentEl.addEventListener('click', (event) => {
      event.stopPropagation() // 全部点击停在卡片域内（含 fm 按钮冒泡）
      this.handleContentClick(handle, event)
    })
    contentEl.addEventListener('mouseover', (event) => event.stopPropagation())
    contentEl.addEventListener('mouseout', (event) => event.stopPropagation())

    // 右上角打开入口：按父文档身份解析（不带 sourceDocUri，与正文双链
    // 点击同语义）；打开不改写引用原文
    openBtn.addEventListener('click', (event) => {
      event.stopPropagation()
      const session = this.context.session()
      if (!session.sessionId || !session.docUri) {
        return
      }
      this.context.send({
        kind: 'wikilink.activate',
        sessionId: session.sessionId,
        docUri: session.docUri,
        target: targetOfInner(entry!.inner),
        srcStart: entry!.sourceStart,
        srcEnd: entry!.sourceEnd,
      })
    })

    if (entry.loaded) {
      // 重挂载：装载缓存直接渲染，恢复 fm/滚动状态（零新请求）
      this.applyLoaded(handle, entry.loaded)
    } else {
      this.requestLoad(handle)
    }
  }

  /** 父文档块卸载钩子：保存状态、释放 B 视图与资源管理器（实例状态保留） */
  unmountBlock(el: HTMLElement): void {
    const handle = this.active.get(el)
    if (!handle) {
      return
    }
    this.active.delete(el)
    handle.entry.scrollTop = handle.scrollEl.scrollTop
    handle.view.dispose()
    handle.bImages?.dispose()
    el.textContent = '' // 卡片 DOM 随块卸载丢弃（真实路径 el 随即 remove）
  }

  /** hover.result 路由（syncController 转发）：按 entry.lastReq 配对——
   *  在场卡片立即渲染；已卸载的迟到回包写入缓存供重挂使用 */
  notifyResult(message: HoverPreviewResult): void {
    for (const handle of this.active.values()) {
      if (handle.entry.lastReq !== null &&
          handle.entry.lastReq.instanceId === message.instanceId &&
          handle.entry.lastReq.reqId === message.reqId) {
        if (message.ok) {
          this.applyResult(handle, message)
        } else {
          this.applyError(handle, message.reason, message.anchor)
        }
        return
      }
    }
    // 卸载后在途：同配对写入缓存（重挂直接用）
    for (const entry of this.entries.values()) {
      if (entry.lastReq !== null &&
          entry.lastReq.instanceId === message.instanceId &&
          entry.lastReq.reqId === message.reqId) {
        if (message.ok) {
          entry.loaded = {
            fsPath: message.target.fsPath,
            relPath: message.target.relPath,
            scope: message.scope.kind,
            text: message.text,
            range: message.range,
          }
        }
        entry.lastReq = null
        return
      }
    }
  }

  /** image.result 路由：作用于在场卡片的 B 管理器（reqId 由管理器自守卫） */
  notifyImageResult(msg: { reqId: number; ok: boolean; src?: string; reason?: string }): void {
    for (const handle of this.active.values()) {
      handle.bImages?.handleResult(msg)
    }
  }

  /** image.invalidate 路由：全部在场 B 管理器按 srcs 失效重发 */
  notifyImageInvalidate(srcs: readonly string[]): void {
    for (const handle of this.active.values()) {
      handle.bImages?.invalidate(srcs)
    }
  }

  /** 手动刷新（refresh.invalidated）：全部在场 B 管理器全量失效重挂 */
  invalidateImages(): void {
    for (const handle of this.active.values()) {
      handle.bImages?.invalidateAll()
    }
  }

  /** 限高设置热更（settings.snapshot / settings.changed）：遍历在场卡片 */
  setMaxHeight(px: number): void {
    for (const handle of this.active.values()) {
      handle.scrollEl.style.maxHeight = `${px}px`
    }
  }

  /** 观测探针（view.state.readingEmbed 的数据源） */
  probe(): EmbedCardProbe[] {
    const out: EmbedCardProbe[] = []
    for (const handle of this.active.values()) {
      const fmSection = handle.contentEl.querySelector('.vsidian-hover-fm')
      out.push({
        inner: handle.entry.inner,
        state: handle.display,
        note: handle.note,
        blocks: handle.contentEl.querySelectorAll(`.${READING_CLASS_NAMES.block}`).length,
        scope: handle.entry.loaded?.scope ?? '',
        fm: fmSection ? (handle.entry.fmExpanded ? 'expanded' : 'collapsed') : 'none',
        maxHeightPx: Number.parseInt(handle.scrollEl.style.maxHeight, 10) || 0,
      })
    }
    return out
  }

  /** 全部释放（syncController dispose）：卡片 DOM、B 视图与状态库 */
  dispose(): void {
    for (const el of Array.from(this.active.keys())) {
      this.unmountBlock(el)
    }
    this.entries.clear()
  }

  // ---- 内部 ----

  /** 发起装载请求（复用悬停文档访问通道；只读消息不进 edit.request） */
  private requestLoad(handle: EmbedCardHandle): void {
    const session = this.context.session()
    if (!session.sessionId || !session.docUri) {
      // 会话未就绪：保持壳与 loading 文案（init 后视图重建触发重挂载发请求）
      this.applyDisplay(handle, 'loading', t('embed.loading'))
      return
    }
    const reqId = ++this.reqSeq
    handle.entry.lastReq = { instanceId: handle.instanceId, reqId }
    this.applyDisplay(handle, 'loading', t('embed.loading'))
    this.context.send({
      kind: 'hover.request',
      sessionId: session.sessionId,
      docUri: session.docUri,
      reqId,
      instanceId: handle.instanceId,
      sourceStart: handle.entry.sourceStart,
      sourceEnd: handle.entry.sourceEnd,
      target: handle.entry.inner,
    })
  }

  /** 成功回包：缓存 + 渲染（在场路径） */
  private applyResult(handle: EmbedCardHandle, message: Extract<HoverPreviewResult, { ok: true }>): void {
    const loaded: EmbedLoaded = {
      fsPath: message.target.fsPath,
      relPath: message.target.relPath,
      scope: message.scope.kind,
      text: message.text,
      range: message.range,
    }
    handle.entry.lastReq = null
    this.applyLoaded(handle, loaded)
  }

  /** 装载结果渲染（首载与缓存重挂共用）：B Reading 视图 + 状态恢复 */
  private applyLoaded(handle: EmbedCardHandle, loaded: EmbedLoaded): void {
    handle.entry.loaded = loaded
    if (!handle.bImages) {
      handle.bImages = createSourcedImageManager({
        session: () => this.context.session(),
        send: (message) => this.context.send(message),
        sourceDocUri: () => handle.entry.loaded?.fsPath ?? '',
      })
    }
    // #219 局部范围同款：全文切块后按块区间求交过滤（保留全文解析上下文）
    handle.view.setDocument(
      loaded.text,
      loaded.scope === 'full' ? undefined : { range: loaded.range },
    )
    handle.view.updateNow()
    // 任务 checkbox 禁用兜底（无布局回退全量渲染路径；双保险，幂等）
    for (const box of Array.from(handle.contentEl.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))) {
      box.disabled = true
    }
    // 顶部文件名：装载后为目标根内相对路径
    const titleEl = handle.cardEl.querySelector<HTMLElement>(`.${EMBED_CARD_CLASS_NAMES.title}`)
    if (titleEl) {
      titleEl.textContent = loaded.relPath
    }
    this.applyDisplay(handle, 'content', loaded.relPath)
    // 滚动位置恢复（重挂路径；首载 scrollTop 为 0 无操作）
    if (handle.entry.scrollTop > 0) {
      handle.scrollEl.scrollTop = handle.entry.scrollTop
    }
  }

  /** 错误分态：就地 i18n 文案（不弹宿主通知；anchor-missing 附锚点原文） */
  private applyError(handle: EmbedCardHandle, reason: Extract<HoverPreviewResult, { ok: false }>['reason'], anchor?: string): void {
    handle.entry.lastReq = null
    this.applyDisplay(handle, 'error', refErrorText(reason, targetOfInner(handle.entry.inner), anchor))
  }

  /** 显示态施加（loading/content 切换与状态行文案） */
  private applyDisplay(handle: EmbedCardHandle, display: 'loading' | 'content' | 'error', note: string): void {
    handle.display = display
    handle.note = note
    if (display === 'content') {
      handle.stateEl.style.display = 'none'
      handle.scrollEl.style.display = ''
    } else {
      handle.stateEl.style.display = ''
      handle.scrollEl.style.display = 'none'
      handle.stateEl.textContent = note
    }
  }

  /** B 内容块挂载钩子：共享只读装配 + fm 属性区（仅全文引用）。
   *  一层展开：B 内 embed 块不在此升级（占位引用行由块 html 呈现） */
  private mountContentBlock(handle: EmbedCardHandle, el: HTMLElement): void {
    const loaded = handle.entry.loaded
    mountRefContentBlock(el, {
      images: handle.bImages,
      codeHighlight: this.context.codeHighlight?.() ?? true,
      fm: loaded !== null && loaded.scope === 'full' ? handle.fm : null,
    })
  }

  /** 卡片内容点击：B 内链接经既有 open 通道（附 sourceDocUri=B——宿主按
   *  B 目录解析与分类）；preventDefault 阻断 webview 原生导航 */
  private handleContentClick(handle: EmbedCardHandle, event: Event): void {
    const hit = event.target as HTMLElement | null
    const anchor = hit?.closest?.('a')
    if (!(anchor instanceof HTMLElement) || !handle.contentEl.contains(anchor)) {
      return
    }
    event.preventDefault()
    const href = anchor.getAttribute('href')
    if (href === null) {
      return // 渲染层已净化的危险链接（无 href）
    }
    const session = this.context.session()
    const loaded = handle.entry.loaded
    if (!session.sessionId || !session.docUri || !loaded) {
      return // 无会话或无 B 身份（loading/错误态无内容链接；防御）
    }
    const linkBlock = anchor.closest<HTMLElement>('[data-vsidian-src-start]')
    const srcStart = Number(linkBlock?.dataset['vsidianSrcStart'] ?? 0)
    const srcEnd = Number(linkBlock?.dataset['vsidianSrcEnd'] ?? srcStart)
    const base = {
      sessionId: session.sessionId,
      docUri: session.docUri,
      srcStart: Number.isInteger(srcStart) ? srcStart : 0,
      srcEnd: Number.isInteger(srcEnd) ? srcEnd : srcStart,
      sourceDocUri: loaded.fsPath,
    }
    if (anchor.classList.contains(WIKILINK_CLASS_NAMES.wikilink)) {
      // 双链与嵌入占位（vsidian-embed-ref 同挂 wikilink 类）：target 原文
      this.context.send({ kind: 'wikilink.activate', target: href, ...base })
    } else {
      this.context.send({ kind: 'link.activate', href, ...base })
    }
  }
}
