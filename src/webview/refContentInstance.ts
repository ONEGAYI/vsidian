// #242：内容实例不拥有展示壳、布局或写端口。容器提供挂载位置和读取结果，
// 实例持有 occurrence 状态；每次挂载独立配对释放 DOM、资源及异步工作。
//
// #333（P3-01）：RefContentSurface 为**最窄内容挂载生命周期接口**——容器
// （嵌入卡片壳/浮层壳）向内容视图交付的空间（内容/滚动元素与布局策略）、
// 会话与出站通道、挂载回调；焦点、关闭与释放的决定权保留在容器（只读内
// 容不接管父输入与宿主键位——Esc 沿既有优先级）。refLoadedContentOfResult
// 为 webview 侧类型化装载入口（hover.result 成功载荷按 contentKind 分派，
// 本票仅 markdown 通道）；RefContentInstance 为挂载代次的发放者（每次
// mount 递增 generation——释放后的挂载拒绝渲染，「过期挂载」的运行期
// 拒绝点）。后续类型（PDF/图片/文本/网页）的内容视图按同一表面与代次
// 生命周期接入，不另建挂载通道。
import type { HoverPreviewResult, HoverPreviewScope, WebviewToHost } from '../shared/protocol'
import type { ReadingBlock } from './readingBlocks'
import { splitReadingBlocks } from './readingBlocks'
import { createReadingBlockElement } from './readingView'
import { VirtualReadingView, type ReadingViewStats } from './readingVirtualView'
import { createSourcedImageManager, mountRefContentBlock } from './refReadingContent'
import { promoteEmbedSlotsInBlock, promotedHostsOf } from './embedSlots'
import { TextRefView } from './textRefView'
import type { ImageResourceManager } from './imageResource'
import { onLocaleChanged } from '../shared/i18n'

/** 四项、总量 2 MiB、单项 512 KiB；大目标只供当前实例使用。 */
const CACHE_MAX_ENTRIES = 4
const CACHE_MAX_BYTES = 2 * 1024 * 1024
const CACHE_MAX_ENTRY_BYTES = 512 * 1024
const parsedBlockCache = new Map<string, { version: number; text: string; blocks: ReadingBlock[]; bytes: number }>()
let cacheBytes = 0
let sharedParses = 0
let sharedHits = 0
let cacheEvictions = 0
let oversizeSkips = 0
let contentBlockMounts = 0
let contentBlockReleases = 0

// 块 HTML 已含 t() 的属性区文字；同语言重新装配也可能换词，统一失效。
onLocaleChanged(() => { parsedBlockCache.clear(); cacheBytes = 0 })

function discardCached(path: string): void {
  const entry = parsedBlockCache.get(path)
  if (!entry) return
  parsedBlockCache.delete(path)
  cacheBytes -= entry.bytes
}

function parsedBlocksFor(loaded: RefLoadedContent): { blocks: ReadingBlock[]; parsedNow: boolean; bytes: number } {
  const cached = parsedBlockCache.get(loaded.fsPath)
  if (cached?.version === loaded.version && cached.text === loaded.text) {
    parsedBlockCache.delete(loaded.fsPath)
    parsedBlockCache.set(loaded.fsPath, cached)
    sharedHits++
    return { blocks: cached.blocks, parsedNow: false, bytes: cached.bytes }
  }
  const blocks = splitReadingBlocks(loaded.text)
  sharedParses++
  discardCached(loaded.fsPath)
  // UTF-16 字符与每块元数据的保守近似；显式限制已渲染 HTML 驻留量。
  const bytes = 2 * (loaded.text.length + blocks.reduce((sum, block) => sum + block.html.length, 0)) + blocks.length * 128
  if (bytes > CACHE_MAX_ENTRY_BYTES) {
    oversizeSkips++
    return { blocks, parsedNow: true, bytes }
  }
  while (parsedBlockCache.size >= CACHE_MAX_ENTRIES || cacheBytes + bytes > CACHE_MAX_BYTES) {
    discardCached(parsedBlockCache.keys().next().value!)
    cacheEvictions++
  }
  parsedBlockCache.set(loaded.fsPath, { version: loaded.version, text: loaded.text, blocks, bytes })
  cacheBytes += bytes
  return { blocks, parsedNow: true, bytes }
}

/** 引用解析缓存统计，用于性能测量；缓存仅持有块数据，不持有实例资源。 */
export function getRefReadingBlockCacheStats(): {
  parses: number; hits: number; entries: number; blocks: number
  bytes: number; evictions: number; oversizeSkips: number
} {
  return {
    parses: sharedParses, hits: sharedHits, entries: parsedBlockCache.size,
    blocks: [...parsedBlockCache.values()].reduce((sum, entry) => sum + entry.blocks.length, 0),
    bytes: cacheBytes, evictions: cacheEvictions, oversizeSkips,
  }
}

export function getRefContentLifecycleStats(): { mounts: number; releases: number; activeBlocks: number } {
  return { mounts: contentBlockMounts, releases: contentBlockReleases,
    activeBlocks: contentBlockMounts - contentBlockReleases }
}

export interface RefSourceContext {
  /** 面板会话仍由父适配器提供；直接来源可与面板文档不同。 */
  panelDocUri: string
  sourceDocUri: string
  range: { start: number; end: number }
  occurrence: string
  parentInstanceId?: string
  depth?: number
  treeId?: string
  expansionPath?: readonly RefTargetIdentity[]
  /** 后续预算控制器的注入点，本票不作展开或预算判定。 */
  budget?: { acquire(identity: RefTargetIdentity): (() => void) | null }
}

export interface RefTargetIdentity {
  fsPath: string
  scope: 'full' | 'heading' | 'block'
  /** 语义选择器保留锚点原文；range 是当前版本中的物理区间。 */
  selector?: HoverPreviewScope
  range: { start: number; end: number }
}

export interface RefLoadedContent extends RefTargetIdentity {
  relPath: string
  version: number
  text: string
  depth?: number
  expansionPath?: readonly string[]
}

/** #340（P3-08）text 装载形态（refLoadedContentOfResult 的 text 投影）：
 *  text 为**窗口内** LF 正文（#range 硬窗口范围外不进载荷——结构性不可
 *  滚达）；行号字段为 1-based 绝对行；font 为语言级生效值。嵌入卡片
 *  （#341 接入前）按不可应用处理，悬停浮层本票消费 */
export interface RefLoadedTextContent {
  kind: 'text'
  fsPath: string
  relPath: string
  version: number
  /** 窗口内 LF UTF-16 正文 */
  text: string
  languageId: string
  hasWindow: boolean
  beginLine: number
  endLine: number
  locateLine: number
  totalLines: number
  font: { family?: string; size?: number; ligatures?: boolean }
  lineNumbers: boolean
  depth?: number
  expansionPath?: readonly string[]
}

/** #340 token 请求序（webview 侧独立配对空间——与 hover.request 的 reqId 互不干扰） */
let textTokenReqSeq = 0

/**
 * #336（P3-04）图片装载形态：image 载荷的 webview 侧已装载内容——身份
 * （fsPath/relPath）+ 来源相对图源（image.request 的 src）+ 文件资源版
 * 本。无正文/定位区间/Markdown 选择器（图片无锚点定位语义）；渲染由容
 * 器委托普通图片挂载（ImageResourceManager 槽位），不走 Markdown Reading
 * 视图的 render 路径。
 */
export interface RefLoadedImageContent {
  kind: 'image'
  fsPath: string
  relPath: string
  /** 来源文档相对图源（hover.result 的 imageSrc；面板文档身份解析） */
  src: string
  version: number
  depth?: number
  expansionPath?: readonly string[]
}

/**
 * #338（P3-06）PDF 装载形态：pdf 载荷的 webview 侧已装载内容——身份
 * （fsPath/relPath）+ 资源 URI（含 `?v=` 代次戳）+ 文件状态代次 + 初始
 * 定位页（双链 #page=N 解析产物；无 page = 第一页）。无 LF 正文/定位区间
 * （PDF 无文本坐标）；渲染由容器侧挂 PDF 视图实例（PdfHoverView——共享
 * 文档存储按 URI 复用，各 occurrence 滚动独立），不走 Markdown Reading
 * 视图的 render 路径。
 */
export interface RefLoadedPdfContent {
  kind: 'pdf'
  fsPath: string
  relPath: string
  /** webview 资源 URI（含 ?v= 代次戳——版本隔离与缓存击穿） */
  uri: string
  version: number
  /** 初始定位页（1-based；undefined = 第一页） */
  page?: number
  /** 源文件字节（逻辑预算费用——RefExpansionBudget 按 bytes 计） */
  bytes: number
  depth?: number
  expansionPath?: readonly string[]
}

/** 类型化装载结果（按 kind 分派的 loaded 形态联合） */
export type RefLoadedAny = RefLoadedContent | RefLoadedImageContent | RefLoadedTextContent | RefLoadedPdfContent

/** Markdown 装载形态判别（RefLoadedContent 无 kind 判别位——#336/#340/#338 起
 *  联合收宽，消费方经此收窄；image/text/pdf 形态各由自己的装载路径消费） */
export function isRefLoadedMarkdown(loaded: RefLoadedAny): loaded is RefLoadedContent {
  // 运行期防御判别：RefLoadedContent（markdown）无 kind 字段，联合的
  // image/text/pdf 成员带字面量 kind——按可选字段读出后比对（未知 kind 按
  // markdown 放行给既有 markdown 消费面，由各容器自行安全处理）
  const kind = (loaded as { kind?: string }).kind
  return kind !== 'image' && kind !== 'text' && kind !== 'pdf'
}

/** PDF 装载形态判别（#338：嵌入卡与浮层的 PDF 视图分派依据；null/
 *  undefined（未装载）恒 false——调用方可直接传 entry.loaded） */
export function isRefLoadedPdf(loaded: RefLoadedAny | null | undefined): loaded is RefLoadedPdfContent {
  return (loaded as { kind?: string } | null | undefined)?.kind === 'pdf'
}

/**
 * #333（P3-01）webview 侧类型化装载入口：hover.result 成功回包按
 * contentKind 分派转换为已装载内容——
 * - 缺省或 'markdown'：转换为 RefLoadedContent（Markdown Reading 视图
 *   的既有装载形态；身份/版本/全文/定位区间/选择器语义不变）；
 * - 'image'（#336 / P3-04）：转换为 RefLoadedImageContent（身份 + 来源
 *   相对图源 + 文件资源版本）——消费方（悬停浮层）据此委托普通图片挂载；
 * - 'pdf'（#338 / P3-06）：转换为 RefLoadedPdfContent（身份 + 资源 URI +
 *   文件状态代次 + 初始定位页）——消费方（悬停浮层的 pdf 形态与嵌入卡
 *   片的 PDF 视图）据此侧挂 PdfHoverView 实例；**RefContentMount.render
 *   仍不接受 pdf 形态**（PDF 无 Markdown Reading 装载链——防线语义从
 *   「装载入口拒收」收窄为「Reading 挂载面拒收」，由各容器在 render 前
 *   经 isRefLoadedPdf 分派）；
 * - 'text'（#340 / P3-08）：转换为 RefLoadedTextContent（窗口正文 + 导航
 *   字段 + 语言身份/字体/行号）；
 * - 其余 kind（web）：未登记装载形态，返回 null——调用方按
 *   「不可应用的回包」处理（释放来源租约、呈现错误分态、不入装载缓存、
 *   不绑定任何写端口）。这是消息级校验（isHostToWebview 拒绝类型与载荷
 *   不匹配）之外的消费端第二道防线。
 */
export function refLoadedContentOfResult(
  message: Extract<HoverPreviewResult, { ok: true }>,
): RefLoadedAny | null {
  const kind = message.contentKind ?? 'markdown'
  if (kind === 'image') {
    return {
      kind: 'image',
      fsPath: message.target.fsPath,
      relPath: message.target.relPath,
      src: message.imageSrc ?? '',
      version: message.version,
      depth: message.depth,
      expansionPath: message.expansionPath,
    }
  }
  if (kind === 'text') {
    const nav = message.textNav
    if (nav === undefined) {
      return null // 消息校验已拦（text 必带 textNav）——防御性第二道防线
    }
    return {
      kind: 'text',
      fsPath: message.target.fsPath,
      relPath: message.target.relPath,
      version: message.version,
      text: message.text,
      languageId: nav.languageId,
      hasWindow: nav.hasWindow,
      beginLine: nav.beginLine,
      endLine: nav.endLine,
      locateLine: nav.locateLine,
      totalLines: nav.totalLines,
      font: {
        ...(nav.fontFamily !== undefined ? { family: nav.fontFamily } : {}),
        ...(nav.fontSize !== undefined ? { size: nav.fontSize } : {}),
        ...(nav.fontLigatures !== undefined ? { ligatures: nav.fontLigatures } : {}),
      },
      lineNumbers: nav.lineNumbers,
      depth: message.depth,
      expansionPath: message.expansionPath,
    }
  }
  if (kind === 'pdf') {
    if (message.pdf === undefined) {
      return null // 消息级校验已拦（防御：载荷缺席不装载）
    }
    return {
      kind: 'pdf',
      fsPath: message.target.fsPath,
      relPath: message.target.relPath,
      uri: message.pdf.uri,
      version: message.version,
      ...(message.scope.kind === 'pdf' && message.scope.page !== undefined ? { page: message.scope.page } : {}),
      bytes: message.pdf.bytes,
      depth: message.depth,
      expansionPath: message.expansionPath,
    }
  }
  if (kind !== 'markdown' || message.scope.kind !== 'full' && message.scope.kind !== 'heading' && message.scope.kind !== 'block') {
    return null
  }
  const rawScope = message.scope as HoverPreviewScope
  const scope: HoverPreviewScope = rawScope.kind === 'full'
    ? { kind: 'full' }
    : rawScope.kind === 'heading'
      ? { kind: 'heading', anchor: rawScope.anchor }
      : { kind: 'block', anchor: rawScope.anchor }
  return {
    fsPath: message.target.fsPath,
    relPath: message.target.relPath,
    scope: scope.kind,
    selector: scope,
    version: message.version,
    text: message.text,
    range: message.range,
    depth: message.depth,
    expansionPath: message.expansionPath,
  }
}

/** 每个引用位置独立；数据可共享，挂载、滚动、属性状态不跨 occurrence。 */
export class RefContentInstance {
  fmExpanded = false
  scrollTop = 0
  private released = false
  /** #333 挂载代次序列（同实例每次 mount 递增——挂载身份的可观测发放） */
  private mountSeq = 0
  private readonly mounts = new Set<RefContentMount>()
  private readonly cleanups: Array<() => void> = []

  constructor(readonly source: RefSourceContext) {}

  get disposed(): boolean { return this.released }
  get mountedCount(): number { return this.mounts.size }

  onDispose(cleanup: () => void): void {
    if (this.released) cleanup()
    else this.cleanups.push(cleanup)
  }

  mount(surface: RefContentSurface): RefContentMount {
    if (this.released) throw new Error('Released reference instance')
    const mount = new RefContentMount(this, surface, ++this.mountSeq, () => this.mounts.delete(mount))
    this.mounts.add(mount)
    return mount
  }

  dispose(): void {
    if (this.released) return
    this.released = true
    for (const mount of [...this.mounts]) mount.dispose()
    for (const cleanup of this.cleanups.splice(0).reverse()) cleanup()
  }
}

/**
 * #333（P3-01）最窄内容挂载生命周期接口：容器（嵌入卡片壳/浮层壳）向
 * 内容视图交付的表面——空间（内容/滚动元素与布局策略）、会话与出站
 * 通道、块级挂载回调。焦点、关闭与释放由容器保留决定权（内容视图不
 * 自持这些能力——只读内容不接管父输入与宿主键位）。本票为
 * Markdown Reading 视图的既有装配面（RefMountOptions 与之同构）；后续
 * 类型（PDF/图片/文本/网页）的内容视图按同一表面接入。
 */
export interface RefContentSurface {
  contentEl: HTMLElement
  scrollEl: HTMLElement
  /** 引用内容的布局策略；生产卡片与浮层均按外层视口虚拟挂载。 */
  strategy: 'full' | 'virtual'
  session(): { sessionId: string | undefined; docUri: string | undefined }
  send(message: WebviewToHost): void
  codeHighlight(): boolean
  onEmbedBlockMounted?(el: HTMLElement, target: RefLoadedContent): void
  onEmbedBlockUnmounted?(el: HTMLElement): void
}

export interface RefMountOptions extends RefContentSurface {}

/** 窄挂载接口：容器负责位置、可用空间、requestMeasure 与请求仲裁。 */
export class RefContentMount {
  private released = false
  private target: RefLoadedContent | RefLoadedTextContent | null = null
  private images: ImageResourceManager | null = null
  private view: VirtualReadingView | null
  /** #340（P3-08）text 内容视图（与 markdown 的 VirtualReadingView 互斥） */
  private textView: TextRefView | null = null
  private readonly blocks = new Map<HTMLElement, Array<() => void>>()
  private readonly cleanups: Array<() => void> = []
  private frame: number | null = null
  // P2-03 首开锚点定位帧：与 restoreScroll 的恢复帧分离（定位不受
  // restoreScroll 的取消语义影响，用户滚动/交互两者一并取消）
  private locateFrame: number | null = null
  // #258：最后已知滚动位置——卡内 scroll 事件与本类程序写回同步它。
  // 宿主块被主视图窗口差分后的 reorder 移动时，Chromium 表格布局重排
  // 会静默重置 td 内滚动容器的 scrollTop（引擎行为：无 scroll 事件、
  // 无 JS 写入，浏览器取证见 #258）。它与实际值的不一致即静默丢失的
  // 判别信号，用于停歇核对与回收保存。
  private lastKnownScrollTop = 0
  private settleTimer: number | null = null

  /** #333 挂载代次（同实例内单调递增的挂载身份；释放后的挂载拒绝渲染） */
  readonly generation: number

  constructor(
    readonly instance: RefContentInstance,
    private readonly options: RefMountOptions,
    generation: number,
    private readonly onRelease: () => void,
  ) {
    this.generation = generation
    this.view = options.strategy === 'virtual' ? new VirtualReadingView(options.contentEl, {
      scrollEl: options.scrollEl,
      onBlockMounted: (el) => this.mountBlock(el),
      onBlockUnmounted: (el) => this.unmountBlock(el),
    }) : null
    // #258：滚轮事件可能只是驱动外层（卡已到边由滚动链接续外层，或事件
    // target 在卡域边界附近穿过）——内层未实际滚动就不构成新阅读意图。
    // wheel 只记在场见证，由随后的内层 scroll 事件证实后才取消恢复；
    // 见证在场时滚回顶部的零位同样是用户意图。
    let wheelWitness = false
    if (this.view) this.listen(options.scrollEl, 'scroll', () => {
      this.lastKnownScrollTop = options.scrollEl.scrollTop
      // 恢复帧尚未执行时，外层已有新的非零滚动位置即交还用户意图。
      // 内容清空导致的零位钳制不取消恢复位置；滚轮在场时除外
      //（用户主动滚回顶部，零位也是新阅读意图）。
      if (this.frame !== null && options.scrollEl.scrollTop !== this.instance.scrollTop &&
        (wheelWitness || options.scrollEl.scrollTop > 0)) {
        this.cancelPendingRestore()
      }
      this.cancelPendingLocate()
      wheelWitness = false
      this.view?.handleScroll()
    })
    if (this.view) {
      this.listen(options.scrollEl, 'wheel', () => { wheelWitness = true; this.cancelPendingLocate() })
      this.listen(options.scrollEl, 'pointerdown', () => { this.cancelPendingRestore(); this.cancelPendingLocate() })
      this.listen(options.scrollEl, 'touchstart', () => { this.cancelPendingRestore(); this.cancelPendingLocate() })
      this.listen(options.scrollEl, 'keydown', (event) => {
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
          this.cancelPendingRestore()
          this.cancelPendingLocate()
        }
      })
      // #258：外部滚动（主容器或任何非本卡滚动区，捕获阶段接收不冒泡的
      // scroll）可能伴随宿主块重排引发的静默重置。滚动中反复重排-恢复
      // 会来回闪动，核对放在外层停歇后进行。
      const onOuterScroll = (event: Event): void => {
        const target = event.target
        if (target === options.scrollEl ||
          (target instanceof Node && options.scrollEl.contains(target))) return
        if (this.settleTimer !== null) window.clearTimeout(this.settleTimer)
        this.settleTimer = window.setTimeout(() => {
          this.settleTimer = null
          this.verifyNotSilentlyReset()
        }, 120)
      }
      document.addEventListener('scroll', onOuterScroll, { capture: true, passive: true })
      this.onDispose(() => document.removeEventListener('scroll', onOuterScroll, true))
    }
  }

  /** #258：外部滚动停歇后核对卡内滚动。归零且与最后已知值不符（用户
   * 滚回顶部必有 scroll 事件见证，lastKnown 已同步为 0）即判定为宿主
   * 重排造成的引擎静默重置，恢复最后已知值。恢复写回等价一次用户滚动
   *（走同一 scroll 监听），不影响虚拟化窗口语义。 */
  private verifyNotSilentlyReset(): void {
    if (this.released || this.frame !== null) return
    if (this.options.scrollEl.scrollTop === 0 && this.lastKnownScrollTop > 0) {
      this.writeScrollTop(this.lastKnownScrollTop)
    }
  }

  /** 程序写回滚动位置：同步最后已知值（scroll 事件的异步到达不影响判别）。 */
  private writeScrollTop(value: number): void {
    this.options.scrollEl.scrollTop = value
    this.lastKnownScrollTop = value
  }

  get disposed(): boolean { return this.released }
  /** #340：当前装载内容是否为 text（外观广播的重载判定——Markdown 浮层
   *  CSS 变量自带跟随，不响应 appearance.changed） */
  get isTextContent(): boolean {
    return this.target !== null && 'kind' in this.target && this.target.kind === 'text'
  }
  getStats(): ReadingViewStats | null { return this.view?.getStats() ?? null }
  /** #341：text 视图虚拟化统计（markdown 装载返回 null——探针按形态分派，
   *  DOM 常驻受视口/窗口约束的观测面） */
  getTextStats(): { renderedLines: number; totalLines: number } | null {
    return this.textView?.getStats() ?? null
  }
  updateNow(): void { this.view?.updateNow(); this.textView?.updateNow() }

  onDispose(cleanup: () => void): void {
    if (this.released) cleanup()
    else this.cleanups.push(cleanup)
  }

  listen<K extends keyof HTMLElementEventMap>(el: HTMLElement, type: K, listener: (event: HTMLElementEventMap[K]) => void): void {
    if (this.released) return
    el.addEventListener(type, listener)
    this.onDispose(() => el.removeEventListener(type, listener))
  }

  render(loaded: RefLoadedContent | RefLoadedTextContent, beforeMount?: (bytes: number) => boolean): boolean {
    if (this.released) return false
    if ('kind' in loaded && loaded.kind === 'text') {
      return this.renderTextContent(loaded, beforeMount)
    }
    // 刷新前保存真实当前位置，重挂的新壳为 0 时沿用 occurrence 保存值
    //（#242 契约：滚回顶部后刷新不恢复旧非零位置——保存实时值）。
    if (this.target !== null || this.options.scrollEl.scrollTop > 0) {
      this.instance.scrollTop = this.options.scrollEl.scrollTop
    }
    this.clear()
    this.target = loaded
    // text 分支已在前置 return 分派；此处 loaded 收窄为 Markdown 形态
    const mdLoaded = loaded as RefLoadedContent
    const parsed = parsedBlocksFor(mdLoaded)
    if (beforeMount && !beforeMount(parsed.bytes)) {
      this.target = null
      return false
    }
    this.images = createSourcedImageManager({
      session: this.options.session,
      send: this.options.send,
      sourceDocUri: () => this.target?.fsPath ?? '',
    })
    // P2-03（#280，ADR-0011）：内容范围恒为目标全文——块不再按 range 过滤；
    // range 只作初始定位区间（无保存滚动位置的首开滚动到锚点）
    if (this.view) {
      this.view.setDocument(mdLoaded.text, {
        blocks: parsed.blocks, parsedNow: parsed.parsedNow,
      })
      this.view.updateNow()
    } else {
      for (const block of parsed.blocks) {
        const el = createReadingBlockElement(block, mdLoaded.text)
        this.options.contentEl.appendChild(el)
        this.mountBlock(el)
      }
    }
    // P2-03 首开定位：标题/块引用且无保存滚动位置时定位到锚点区间起点；
    // 刷新/重挂（有保存位置）优先恢复阅读位置，不重新定位
    if (this.instance.scrollTop === 0 && mdLoaded.selector !== undefined &&
      mdLoaded.selector.kind !== 'full' && mdLoaded.range.start > 0) {
      const locateAt = mdLoaded.range.start
      this.scheduleRefLocate(() => {
        if (this.released || this.target !== loaded) return
        if (this.view) {
          this.view.scrollToSrcStart(locateAt)
        } else if (this.options.scrollEl.scrollTop === 0) {
          // 无布局回退路径：定位到锚点块元素的顶部
          const el = this.options.contentEl.querySelector<HTMLElement>(
            `[data-vsidian-src-start="${locateAt}"]`,
          ) ?? this.nearestBlockElementFrom(locateAt)
          if (el) {
            this.options.scrollEl.scrollTop = el.offsetTop
          }
        }
      })
    }
    return true
  }

  /**
   * #340（P3-08）text 内容渲染：定高虚拟化（TextRefView 挂 contentEl，
   * 纵向滚动归 surface.scrollEl）；首开无保存滚动位置时定位到 locateLine
   *（刷新/重挂优先恢复阅读位置——与 markdown 首开定位同款调度）；装载后
   * 发 hover.tokens.request（宿主外观服务分层回包，applyTextTokens 按
   * version 配对应用——迟到/过期 token 不覆盖新正文）。
   */
  private renderTextContent(loaded: RefLoadedTextContent, beforeMount?: (bytes: number) => boolean): boolean {
    if (this.target !== null || this.options.scrollEl.scrollTop > 0) {
      this.instance.scrollTop = this.options.scrollEl.scrollTop
    }
    this.clear()
    // text 内容接管 contentEl：释放 Markdown 虚拟视图——VirtualReadingView
    // 复用 contentEl 作为块容器，其 updateNow/clearAll 会重建容器内容并
    // 清掉文本视图（挂载期互斥的结构性表达；同挂载点切回 markdown 走
    // render 的无布局回退路径，行为不回归）
    if (this.view !== null) {
      this.view.dispose()
      this.view = null
    }
    this.target = loaded
    const bytes = loaded.text.length * 2 + 512
    if (beforeMount && !beforeMount(bytes)) {
      this.target = null
      return false
    }
    this.textView = new TextRefView(this.options.contentEl, this.options.scrollEl)
    this.textView.setDocument({
      text: loaded.text,
      languageId: loaded.languageId,
      hasWindow: loaded.hasWindow,
      beginLine: loaded.beginLine,
      endLine: loaded.endLine,
      locateLine: loaded.locateLine,
      font: loaded.font,
      lineNumbers: loaded.lineNumbers,
    })
    this.listen(this.options.scrollEl, 'scroll', () => {
      this.textView?.updateNow()
    })
    // 首开定位（延迟一帧等浮层布局建立；与 markdown 的 scheduleRefLocate
    // 同款取消语义——用户滚动/交互取消定位）
    if (this.instance.scrollTop === 0 && loaded.locateLine > loaded.beginLine) {
      const locateAt = loaded.locateLine
      this.scheduleRefLocate(() => {
        if (this.released || this.target !== loaded) return
        this.textView?.locateToLine(locateAt)
      })
    }
    this.requestTextTokens(loaded)
    return true
  }

  /**
   * #340 token 请求出站（reqId 递增；回包按 instanceId+reqId 配对、版本
   * 与当前 target 比对——见 applyTextTokens）。请求带当前窗口与装载版本，
   * 宿主据此配对计算（目标已推进回 stale，webview 等失效重载）。
   */
  private requestTextTokens(loaded: RefLoadedTextContent): void {
    const session = this.options.session()
    if (!session.sessionId || !session.docUri) {
      return
    }
    this.options.send({
      kind: 'hover.tokens.request',
      sessionId: session.sessionId,
      docUri: session.docUri,
      reqId: ++textTokenReqSeq,
      instanceId: this.instance.source.occurrence,
      fsPath: loaded.fsPath,
      version: loaded.version,
      beginLine: loaded.beginLine,
      endLine: loaded.endLine,
    })
  }

  /**
   * #340 token 分层应用：语法层先染、语义层按字符区间覆盖（原生同构
   * 叠加）。守卫三重：目标在场且为 text、版本与当前装载一致（过期/迟到
   * token 整体丢弃——A/B 两种版本竞态的 webview 侧拒绝点）、层枚举已知。
   */
  applyTextTokens(message: {
    instanceId: string
    ok: boolean
    layer?: 'textmate' | 'semantic'
    version?: number
    colors?: string[]
    tokens?: number[]
  }): boolean {
    if (this.released || message.instanceId !== this.instance.source.occurrence) {
      return false
    }
    const target = this.target
    if (target === null || !('kind' in target) || target.kind !== 'text') {
      return false
    }
    if (!message.ok || message.layer === undefined || message.version !== target.version) {
      return true // 配对成功但版本不匹配：丢弃（不覆盖新正文）
    }
    if (message.colors === undefined || message.tokens === undefined) {
      return true
    }
    this.textView?.applyTokens(message.layer, message.colors, message.tokens)
    return true
  }

  /** P2-03 首开定位帧调度（延迟一帧等宿主入 DOM 建立布局，与
   *  restoreScroll 的延迟一帧口径一致） */
  private scheduleRefLocate(fn: () => void): void {
    if (this.locateFrame !== null) cancelAnimationFrame(this.locateFrame)
    this.locateFrame = requestAnimationFrame(() => {
      this.locateFrame = null
      fn()
    })
  }

  /** 用户已有滚动/交互意图时取消待执行的锚点定位 */
  private cancelPendingLocate(): void {
    if (this.locateFrame === null) return
    cancelAnimationFrame(this.locateFrame)
    this.locateFrame = null
  }

  /** 无布局回退路径：按定位起点找首个起点不早于它的块元素（近似落点） */
  private nearestBlockElementFrom(offset: number): HTMLElement | null {
    let best: HTMLElement | null = null
    for (const el of this.options.contentEl.children) {
      if (!(el instanceof HTMLElement)) continue
      const start = Number(el.dataset['vsidianSrcStart'])
      if (Number.isInteger(start) && start >= offset) {
        best = el
        break
      }
    }
    return best
  }

  restoreScroll(deferred: boolean): void {
    if (this.released || this.instance.scrollTop <= 0) return
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    const restore = (): void => {
      this.frame = null
      if (!this.released) {
        // 缓存重挂可能先于卡片附着：先让外层真实视口建立占位高度，
        // 然后恢复滚动并立即切到目标窗口。
        this.view?.updateNow()
        this.writeScrollTop(this.instance.scrollTop)
        this.view?.updateNow()
        // 首次实测可能修正占位高度并平移宿主 scrollTop；恢复请求的
        // occurrence 位置以合法 scrollTop 为准，再落一次最终值。
        this.writeScrollTop(this.instance.scrollTop)
      }
    }
    if (deferred) this.frame = requestAnimationFrame(restore)
    else restore()
  }

  clear(): void {
    if (this.released) return
    this.cancelPendingLocate()
    this.view?.clearDocument()
    this.textView?.dispose()
    this.textView = null
    for (const el of [...this.blocks.keys()]) this.unmountBlock(el)
    this.images?.dispose()
    this.images = null
    this.target = null
    if (!this.view) this.options.contentEl.textContent = ''
  }

  notifyImageResult(msg: { reqId: number; ok: boolean; src?: string; reason?: string }): void { this.images?.handleResult(msg) }
  invalidateImages(srcs?: readonly string[]): void {
    if (srcs) this.images?.invalidate(srcs)
    else this.images?.invalidateAll()
  }

  dispose(): void {
    if (this.released) return
    if (this.settleTimer !== null) {
      window.clearTimeout(this.settleTimer)
      this.settleTimer = null
    }
    if (this.locateFrame !== null) {
      cancelAnimationFrame(this.locateFrame)
      this.locateFrame = null
    }
    if (this.target !== null) {
      // #258：回收时内层可能已被宿主重排静默重置（无 scroll 事件见证，
      // 实际归零但 lastKnown 停在丢失前的值）——按最后已知值保存，重挂
      // 才能恢复真实阅读位置。用户主动滚回顶部的 scroll 见证会同步
      // lastKnown 为 0，不触发此兜底。
      this.instance.scrollTop = this.options.scrollEl.scrollTop === 0 && this.lastKnownScrollTop > 0
        ? this.lastKnownScrollTop
        : this.options.scrollEl.scrollTop
    }
    if (this.frame !== null) cancelAnimationFrame(this.frame)
    this.clear()
    this.view?.dispose()
    this.view = null
    this.options.contentEl.textContent = ''
    this.released = true
    for (const cleanup of this.cleanups.splice(0).reverse()) cleanup()
    this.onRelease()
  }

  private cancelPendingRestore(): void {
    if (this.frame === null) return
    cancelAnimationFrame(this.frame)
    this.frame = null
    this.instance.scrollTop = this.options.scrollEl.scrollTop
  }

  private mountBlock(el: HTMLElement): void {
    const cleanups: Array<() => void> = []
    this.blocks.set(el, cleanups)
    contentBlockMounts++
    mountRefContentBlock(el, {
      images: this.images,
      codeHighlight: this.options.codeHighlight(),
      // P2-03（#280）：内容范围恒全文——frontmatter 属性区随全文内容
      // 在场（折叠状态机仍按 occurrence 实例独立）
      fm: this.target ? {
        expanded: () => this.instance.fmExpanded,
        toggle: () => (this.instance.fmExpanded = !this.instance.fmExpanded),
      } : null,
      onDispose: (cleanup) => cleanups.push(cleanup),
    })
    // #340：text 内容无 Markdown 嵌入块语义（块挂载仅 markdown 路径可达）
    const mdTarget = this.target !== null && !('kind' in this.target) ? this.target : null
    if (mdTarget && el.dataset['vsidianEmbedInner'] !== undefined) {
      this.options.onEmbedBlockMounted?.(el, mdTarget)
    }
    // #246 混排：块内占位提升为块级宿主（B 全文坐标回算 occurrence），
    // 各宿主独立触发回调——同段/行多个嵌入各有位置身份，不共享块根身份
    if (mdTarget !== null) {
      const start = Number(el.dataset['vsidianSrcStart'])
      const end = Number(el.dataset['vsidianSrcEnd'])
      if (Number.isInteger(start) && Number.isInteger(end) && end >= start) {
        for (const host of promoteEmbedSlotsInBlock(el, mdTarget.text, start, end)) {
          this.options.onEmbedBlockMounted?.(host, mdTarget)
        }
      }
    }
  }

  private unmountBlock(el: HTMLElement): void {
    if (!this.blocks.has(el)) return
    // #246 混排宿主先于块根卸载（孙卡随父内容块在场；重复通知幂等）
    for (const host of promotedHostsOf(el)) {
      this.options.onEmbedBlockUnmounted?.(host)
    }
    this.options.onEmbedBlockUnmounted?.(el)
    this.images?.detachWithin(el)
    for (const cleanup of this.blocks.get(el) ?? []) cleanup()
    this.blocks.delete(el)
    contentBlockReleases++
  }
}
