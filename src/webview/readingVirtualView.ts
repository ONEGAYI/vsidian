// 阅读视图虚拟化装配层（工单 #7）：把 readingBlocks 的块模型按
// readingViewport 的窗口计算真实按需挂载到容器。
//
// 结构（布局可用时，虚拟模式）：
// <div class="vsidian-view-reading">
//   <div class="vsidian-reading-spacer vsidian-reading-spacer-top" style="height:…px">
//   …窗口内块元素（真实按需创建，结构与 #6 全量渲染逐字节一致）…
//   <div class="vsidian-reading-spacer vsidian-reading-spacer-bottom" style="height:…px">
// </div>
//
// 契约要点（ADR-0005 / mvp.md MVP 性能契约）：
// - 屏外块用布局信息占位：上下 spacer 的高度 = 块高度表的前后缀和。
//   高度表 = 未挂载块的估计值 + 挂载块回填的实测值（回收后保留实测）
// - 语法解析与 DOM 挂载分离：全文切块只在 setDocument（外部变更/装载）时
//   一次，滚动路径只做窗口差分与 DOM 增删，绝不重新解析
// - 不用 content-visibility、不整篇渲染后隐藏——挂载即真实创建节点
// - 无布局环境（jsdom、从未可见的容器）回退 #6 全量渲染路径，
// 结构与锚点语义不变
// - 动态尺寸变化（图片加载等）：ResizeObserver 监听挂载块与容器，尺寸
//   变化后实测回填 + 滚动锚定（视口顶块的顶部位置变化平移 scrollTop，
//   保持源位置锚点稳定）
import { splitReadingBlocks, type ReadingBlock } from './readingBlocks'
import {
  READING_CLASS_NAMES,
  createReadingContainer,
  createReadingBlockElement,
  findReadingAnchor,
  readingAnchorStartFor,
} from './readingView'
import {
  createHeadingFoldControlButton,
  hitPainted,
  rangeFoldHidden,
  type HeadingFoldSpan,
} from './headingFold'
import type { ReadingFoldPaintProbe } from '../shared/protocol'
import type { DiagnosticEvent } from '../shared/testDiagnostics'
import type { FindMatch } from './findSession'
import { highlightReadingMatches } from './readingFind'
import { ReadingFindSource } from './readingFindSource'
import {
  DEFAULT_LINE_HEIGHT_PX,
  anchorIndexAtScroll,
  blockIndexForOffset,
  blockTops,
  computeMountWindow,
  diffWindow,
  estimateBlockHeightPx,
  recalibrate,
  type HeightCalibration,
  type HeightSample,
  type MountWindow,
} from './readingViewport'

/** 虚拟化视图的可观测状态（view.state / 性能探针回报） */
export interface ReadingViewStats {
  /** 块模型总数（全文切块结果，与 DOM 无关） */
  totalBlocks: number
  /** 当前挂载的块元素数（窗口内） */
  mountedBlocks: number
  /** 容器内全部元素数（含 spacer；DOM 有界性观测） */
  contentDomCount: number
  /** 本实例触发的全文块解析次数；滚动与共享解析复用不得使其增长 */
  parseCount: number
  /** 是否处于虚拟模式（false = 无布局回退全量渲染） */
  virtualized: boolean
  /** 实例生命周期峰值，包含首次挂载；用于排除先全文建 DOM 再回收。 */
  maxMountedBlocks: number
  mountedEver: number
  unmountedEver: number
}

export interface VirtualReadingViewOptions {
  /** #272 被动观测现有 scroll/rAF 链；没有回调时不取诊断数据。 */
  onDiagnostic?: (stage: string, data: DiagnosticEvent['data']) => void
  /** 滚动及裁剪宿主；缺省为内容容器（主阅读视图既有形态）。 */
  scrollEl?: HTMLElement
  /** 挂载缓冲（px）：窗口在视口两侧外扩的距离；缺省按视口高度自适应 */
  bufferPx?: number
  /** #10 图片生命周期钩子：块挂载后预备其内图片（发起装载）；块卸载/容器
   *  重建前释放其内图片槽位（src 清空、条目回收） */
  onBlockMounted?: (el: HTMLElement) => void
  onBlockUnmounted?: (el: HTMLElement) => void
  /** #419 阅读态折叠交互回调：翻转 Live 折叠键（toggleHeadingFoldAt 同
   *  链路——阅读与 Live 共享同一折叠状态集）；缺省无折叠交互（引用
   *  内容等只读场景）。 */
  onFoldToggle?: (key: number) => void
}

/** 实测块外高：offsetHeight + 上下 margin（jsdom 无计算值时 margin 记 0） */
function outerHeight(el: HTMLElement): number {
  const style = getComputedStyle(el)
  const margin = (v: string): number => {
    const n = Number.parseFloat(v)
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  return el.offsetHeight + margin(style.marginTop) + margin(style.marginBottom)
}

/** rAF 不可用环境（旧 jsdom）退化为短超时 */
function scheduleFrame(fn: () => void): () => void {
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(() => fn())
    return () => cancelAnimationFrame(id)
  } else {
    const id = setTimeout(fn, 16)
    return () => clearTimeout(id)
  }
}

/**
 * 阅读视图虚拟化控制器：一个实例接管一个阅读容器。
 * 生命周期与 syncController 的 reading 容器一致（mount 创建、dispose 清理）。
 */
export class VirtualReadingView {
  private readonly container: HTMLElement
  private readonly scrollEl: HTMLElement
  private readonly fixedBufferPx: number | undefined

  /** 块模型与高度表（解析与挂载分离：滚动只读不改块模型） */
  private blocks: ReadingBlock[] = []
  private blocksByStart = new Map<number, ReadingBlock>()
  private text = ''
  private heights: number[] = []
  private tops: number[] = [0]
  private calib: HeightCalibration = { lineHeightPx: DEFAULT_LINE_HEIGHT_PX }
  private parseCount = 0
  private virtualized = false

  /** #419 全量解析缓存（折叠过滤只作用于可见序列 allBlocks → blocks，
   *  折叠切换不重新解析——parseCount 不变） */
  private allBlocks: ReadingBlock[] = []
  /** #419 折叠消费状态：可折叠标题区间集（foldableSpansCached 产出，
   *  区间派生单一事实源在 headingFold 纯函数族）与折叠键集
   *  （headingFoldField 值——Live 与阅读共享同一状态集） */
  private foldSpans: readonly HeadingFoldSpan[] = []
  private foldedKeys: ReadonlySet<number> = new Set()
  /** foldSpans 的 key → span 索引（标题块装饰的 O(1) 命中） */
  private foldSpanByStart = new Map<number, HeadingFoldSpan>()
  private readonly onFoldToggle: ((key: number) => void) | undefined

  /** 当前挂载窗口与元素表（索引 → 元素） */
  private mounted: MountWindow | null = null
  private elements = new Map<number, HTMLElement>()
  /** #419 实测高度按块 start 保留（keyed by block.start——折叠过滤使可见
   *  序列索引漂移，按索引的实测集会失真；重建时先取实测再回估计。语义
   *  对象于旧 measured 索引集：heights 为实测 ⟺ 本表有记录） */
  private measuredHeights = new Map<number, number>()
  private maxMountedBlocks = 0
  private mountedEver = 0
  private unmountedEver = 0

  /** #14 查找命中块的源 start（null 无高亮）：挂载/重建后自动重新施加 */
  private highlightSrcStart: number | null = null
  private findMatches: readonly FindMatch[] = []
  private findIndex = 0
  private findCurrentVisible = false
  private readonly findSource: ReadingFindSource

  /** #163 验收反馈：跳转目标高亮块的源 start（null 无）；挂载/重建后
   *  保持（与 highlightSrcStart 同机制），清除由 syncController 的消失
   *  监听驱动（用户任意操作后消失） */
  private flashSrcStart: number | null = null

  private spacerTop: HTMLElement
  private spacerBottom: HTMLElement
  private observer: ResizeObserver | null = null
  private pendingFrame = false
  private skipStabilizeOnce = false
  private cancelFrame: (() => void) | null = null
  /** 延迟定位校准只属于发起它的那次定位；top 记录本视图最后写入的位置。 */
  private locateSnap: { top: number } | null = null
  private disposed = false
  /** #10 图片生命周期钩子（构造注入） */
  private hooks: VirtualReadingViewOptions
  private onDiagnostic: VirtualReadingViewOptions['onDiagnostic']
/** 最近一次有效视口高度（隐藏期保持虚拟模式用） */
  private lastViewportHeight = 0
  /** RO 观测到的容器最近内容宽度（0 = 尚未记录） */
  private lastContainerWidth = 0
  /** 容器横向宽度显著变化待处理旗（RO 回调只置旗，清空动作在
   *  measureAndStabilize 内消费——回调内直接改共享状态与「update 途中
   *  不得同步改」同族，避免重入） */
  private widthDriftPending = false

  constructor(container: HTMLElement, options: VirtualReadingViewOptions = {}) {
    this.container = container ?? createReadingContainer()
    this.scrollEl = options.scrollEl ?? this.container
    this.fixedBufferPx = options.bufferPx
    this.hooks = options
    this.onFoldToggle = options.onFoldToggle
    this.onDiagnostic = options.onDiagnostic
    this.findSource = new ReadingFindSource(this.container)
    this.spacerTop = document.createElement('div')
    this.spacerTop.className = `${READING_CLASS_NAMES.spacer} ${READING_CLASS_NAMES.spacerTop}`
    this.spacerBottom = document.createElement('div')
    this.spacerBottom.className = `${READING_CLASS_NAMES.spacer} ${READING_CLASS_NAMES.spacerBottom}`
    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver((entries) => {
        this.noteWidthDrift(entries)
        this.scheduleUpdate()
      })
      this.observer.observe(this.container)
      if (this.scrollEl !== this.container) this.observer.observe(this.scrollEl)
    }
  }

  /** 全文装载/重建（init、resync、外部增量后的重建路径）：全文切块一次。
   *  解析吃全文（保留全文解析上下文，不丢章节外引用式链接定义）。P2-03
   * （#280）起引用内容不再按区间过滤——标题/块引用全文可达，初始定位由
   *  调用方经 scrollToSrcStart 按锚点区间起点执行（原 range 求交过滤随
   *  局部范围契约退役） */
  setDocument(text: string, opts?: {
    /** 已在来源缓存完成全文解析的块；各实例只共享只读数据，不共享 DOM。 */
    blocks?: readonly ReadingBlock[]
    parsedNow?: boolean
  }): void {
    if (this.disposed) return
    if (opts?.parsedNow !== false) this.parseCount += 1
    this.text = text
    this.allBlocks = opts?.blocks ? [...opts.blocks] : splitReadingBlocks(text)
    // 新文档：实测缓存按 start 键可能碰撞（不同文档同 start），保守清空
    this.measuredHeights.clear()
    this.rebuildBlocks(false)
  }

  /**
   * #419 折叠状态更新：foldables = 可折叠全集（foldableSpansCached 产出）、
   * foldedKeys = 折叠键集（headingFoldField 值）。文档在场且状态真实变化
   * 时轻重建（保视觉位置的块序列重过滤——不重新解析，parseCount 不变，
   * 实测高度按块 start 保留）；`rebuild: false` 形态供调用方在
   * setDocument 前更新状态（随后的全量重建统一消费，避免双重建）。
   */
  setFoldState(
    foldables: readonly HeadingFoldSpan[],
    foldedKeys: ReadonlySet<number>,
    opts?: { rebuild?: boolean },
  ): void {
    const sameSpans = foldables.length === this.foldSpans.length &&
      foldables.every((s, i) => s === this.foldSpans[i])
    const sameKeys = foldedKeys === this.foldedKeys ||
      (foldedKeys.size === this.foldedKeys.size &&
        [...foldedKeys].every((k) => this.foldedKeys.has(k)))
    this.foldSpans = foldables
    this.foldedKeys = foldedKeys
    this.foldSpanByStart = new Map(foldables.map((s) => [s.key, s]))
    if (opts?.rebuild === false) {
      return
    }
    if (sameSpans && sameKeys) {
      return // 状态未变：零重建（外部增量链的重复同步短路）
    }
    if (this.blocks.length > 0 || this.allBlocks.length > 0) {
      this.rebuildBlocks(true)
    }
  }

  /** 可见块序列过滤：折叠隐藏区内的块不进入（#419）——隐藏判定经
   *  rangeFoldHidden（headingFold 区间语义单一事实源），标题块端点不落
   *  开区间天然保持可见；无折叠数据全量直通。 */
  private filterVisibleBlocks(all: readonly ReadingBlock[]): ReadingBlock[] {
    if (this.foldSpans.length === 0) {
      return [...all]
    }
    let effective: HeadingFoldSpan[] | null = null
    for (const s of this.foldSpans) {
      if (this.foldedKeys.has(s.key)) {
        ;(effective ??= []).push(s)
      }
    }
    if (!effective) {
      return [...all]
    }
    return all.filter((b) => !rangeFoldHidden(effective, b.start, b.end))
  }

  /**
   * 块序列重建（setDocument 与 setFoldState 共用后半段）：可见序列过滤 →
   * 高度表重建（实测按 start 保留）→ 容器清空重挂。preserveViewport 时
   * 记录锚点块及其块内偏移，重建后恢复同一视觉位置——折叠交互期望标题
   * 行原地收放，不是 scrollToSrcStart 的吸附视口顶。
   */
  private rebuildBlocks(preserveViewport: boolean): void {
    this.locateSnap = null
    this.findSource.hide()
    // 视口锚定信息（折叠切换的视觉位置保持）：锚点块 start + 块内偏移
    let anchorStart: number | null = null
    let offsetInBlock = 0
    if (preserveViewport) {
      const scrollTop = this.contentScrollTop()
      const idx = anchorIndexAtScroll(this.tops, this.heights, scrollTop)
      if (idx !== null && this.blocks[idx]) {
        anchorStart = this.blocks[idx]!.start
        offsetInBlock = scrollTop - this.tops[idx]!
      }
    }
    this.blocks = this.filterVisibleBlocks(this.allBlocks)
    this.blocksByStart = new Map(this.blocks.map(block => [block.start, block]))
    this.heights = this.blocks.map(
      (b) => this.measuredHeights.get(b.start) ?? estimateBlockHeightPx(b, this.text, this.calib),
    )
    this.tops = blockTops(this.heights)
    // C-9：旧挂载元素逐个解除观察后再丢弃——ResizeObserver 对元素是
    // 强引用，直接清空会留下游离观察并阻碍节点回收；同时释放块内图片
    // 槽位（#10：旧文档节点连同其资源状态一并回收）
    this.releaseAllBlocks()
    if (this.observer) {
      for (const el of this.elements.values()) {
        this.observer.unobserve(el)
      }
    }
    this.elements.clear()
    this.mounted = null
    this.detachSpacers()
    this.container.textContent = '' // 旧文档的全部节点（含 spacer）先行移除
    if (!this.layoutAvailable()) {
      if (this.scrollEl !== this.container) {
        // 引用卡片可在附着 DOM 前先收到缓存内容。等待外层视口出现，
        // 只放估计高度的 spacer 来撑开滚动壳并唤醒 RO，绝不先建全文块。
        this.virtualized = true
        this.spacerTop.style.height = '0px'
        this.spacerBottom.style.height = `${this.tops[this.blocks.length] ?? 0}px`
        this.container.append(this.spacerTop, this.spacerBottom)
        return
      }
      // 无布局回退：#6 全量渲染路径（结构与锚点语义不变；图片照常预备）
      this.virtualized = false
      for (const block of this.blocks) {
        const el = createReadingBlockElement(block, this.text)
        this.decorateFoldControls(el, block)
        this.container.appendChild(el)
        this.hooks.onBlockMounted?.(el)
      }
      this.applyHighlightToDom()
      this.highlightMatches(this.findMatches, this.findIndex)
      this.applyFlashToDom()
      return
    }
    this.virtualized = true
    this.updateNow()
    if (anchorStart !== null) {
      // 视觉位置恢复：锚点块若被折叠隐藏则 floor 到其前可见块（折叠标题）
      const idx = blockIndexForOffset(this.blocks, anchorStart)
      if (idx !== null) {
        this.setContentScrollTop(this.tops[idx]! + offsetInBlock)
        this.updateNow()
      }
    }
  }

  /** 滚动入口（scroll 事件）：rAF 合帧后重算窗口 */
  handleScroll(): void {
    this.onDiagnostic?.('reading.scroll', { top: this.scrollEl.scrollTop })
    // 外部宿主刚发生滚动时，其 scrollTop 是用户意图；首次窗口实测
    // 的估计修正不应把该值平移。后续独立 RO（如图片晚到）仍会锚定。
    if (this.scrollEl !== this.container) this.skipStabilizeOnce = true
    this.scheduleUpdate()
  }

  /** 立即重算窗口（同步；测试与 handleScroll 的落点） */
  updateNow(): void {
    this.onDiagnostic?.('reading.update', { disposed: this.disposed, blocks: this.blocks.length,
      pendingFrame: this.pendingFrame, virtualized: this.virtualized, top: this.scrollEl.scrollTop })
    if (this.disposed) return
    const locateSnap = this.currentLocateSnap()
    if (this.blocks.length === 0) {
      this.clearAll()
      this.updateFindSource()
      return
    }
    if (!this.layoutAvailable()) {
      this.onDiagnostic?.('reading.hidden', {})
      return // 隐藏期：保持现状（曾虚拟化则 DOM 冻结，不回退重建）
    }
    if (!this.virtualized) {
      this.promoteToVirtual()
      return
    }
    const viewport = this.effectiveViewport()
    const scrollTop = this.contentScrollTop()
    // 末尾意图保持（#259 起主视图同享）：进入本轮时已滚到滚动末端的，
    // 尾部窗口推进中的回收-占位中间态会让布局短暂变矮、浏览器把
    // scrollTop clamp 压低，之后 spacer 恢复总高但损失无人补回——主
    // 视图与外部宿主（#243）同样需要把「滚到末尾」的意图顶回末端。
    const atBottom = this.scrollEl.scrollHeight > this.scrollEl.clientHeight &&
      this.scrollEl.scrollTop >= this.scrollEl.scrollHeight - this.scrollEl.clientHeight - 2
    const next = computeMountWindow(this.heights, scrollTop, viewport, this.bufferPx())
    const { mount, recycle } = diffWindow(this.mounted, next)
    for (const i of recycle) {
      this.unmountBlock(i)
    }
    for (const i of mount) {
      this.mountBlock(i)
    }
    const windowChanged = mount.length > 0 || recycle.length > 0
    this.mounted = next
    this.onDiagnostic?.('reading.window', { from: next?.first ?? -1, to: next?.last ?? -1, mount: mount.length,
      recycle: recycle.length, top: scrollTop, mounted: this.elements.size,
      mountedFirst: this.elements.size ? Math.min(...this.elements.keys()) : -1,
      mountedLast: this.elements.size ? Math.max(...this.elements.keys()) : -1 })
    // 只在窗口真实变化时重排：无变化路径零 DOM 写入——否则容器
    // ResizeObserver 会对自身布局变化再次回调，形成每帧空转循环
    if (windowChanged) {
      this.reorderChildren()
    }
    this.measureAndStabilize(scrollTop, !this.skipStabilizeOnce)
    this.skipStabilizeOnce = false
    this.updateSpacers()
    if (atBottom) {
      // 尾部首次实测可能把估计总高增大；保持“滚到末尾”的意图，
      // 并让新坐标再触发一次有限窗口差分。
      const end = Math.max(0, this.scrollEl.scrollHeight - this.scrollEl.clientHeight)
      if (end > this.scrollEl.scrollTop + 1) {
        this.scrollEl.scrollTop = end
        this.scheduleUpdate()
      }
    }
    this.updateFindSource()
    if (locateSnap && this.locateSnap === locateSnap) locateSnap.top = this.scrollEl.scrollTop
  }

  /** 视口顶锚点块的源 start（真实布局优先；无布局环境回退高度表模型） */
  currentAnchor(): number | null {
    if (!this.virtualized) {
      return findReadingAnchor(this.container)
    }
    // 真实布局判定：首个底边越过视口顶的挂载块（与 #6 的 DOM 判定同语义，
    // 免疫未测前缀的估计残差）。容器 rect 退化（jsdom 无布局）时回退模型版
    const cRect = this.scrollEl.getBoundingClientRect()
    if (cRect.height > 0 && this.mounted !== null) {
      for (let i = this.mounted.first; i <= this.mounted.last; i++) {
        const el = this.elements.get(i)
        if (el && el.getBoundingClientRect().bottom - cRect.top > 0.5) {
          return this.blocks[i]!.start
        }
      }
      return this.blocks[this.mounted.last]!.start
    }
    const idx = anchorIndexAtScroll(this.tops, this.heights, this.contentScrollTop())
    return idx === null ? null : this.blocks[idx]!.start
  }

  /** 源 offset → 锚点（含屏外目标；floor 语义与 #6 一致）。
   *  列表块内按 li 子锚点归位到项级（光标恢复精度），挂载单位仍为整块 */
  anchorStartFor(offset: number): number | null {
    if (!this.virtualized) {
      return readingAnchorStartFor(this.container, offset)
    }
    const idx = blockIndexForOffset(this.blocks, offset)
    if (idx === null) {
      return null
    }
    const block = this.blocks[idx]!
    const anchors = block.itemAnchors
    if (anchors && anchors.length > 0) {
      let prev = block.start
      for (const a of anchors) {
        if (a <= offset) {
          prev = a
        } else {
          break
        }
      }
      return prev
    }
    return block.start
  }

  /** 滚动到源 start 对应块（虚拟模式下先按高度表估计定位再实测修正） */
  scrollToSrcStart(srcStart: number): void {
    this.locateSnap = null
    if (!this.virtualized) {
      const el = this.container.querySelector<HTMLElement>(
        `.${READING_CLASS_NAMES.block}[data-vsidian-src-start="${srcStart}"]`,
      )
      if (el) {
        this.scrollEl.scrollTop += el.getBoundingClientRect().top - this.scrollEl.getBoundingClientRect().top
      }
      return
    }
    const idx = blockIndexForOffset(this.blocks, srcStart)
    if (idx === null) {
      return
    }
    // 第一遍：按当前高度表估计定位 → 挂载目标窗口并实测（含标定重估，
    // 远距离跳转时未测前缀的累计估计误差被压缩到缓冲范围内）
    this.setContentScrollTop(this.tops[idx] ?? 0)
    this.updateNow()
    // 第二遍：实测/重估后的顶部位置修正
    const corrected = this.tops[idx] ?? 0
    if (Math.abs(this.contentScrollTop() - corrected) > 0.5) {
      this.setContentScrollTop(corrected)
      this.updateNow()
    }
    // 终校准：目标块已挂载时按其真实布局位置吸附（消除残余估计误差；
    // 吸附后目标块恰在视口顶，锚点判定稳定命中目标）
    this.snapToBlockTop(idx)
    // 异步兜底（#14）：挂载窗口的后续重算（滚动事件/rAF/RO 触发的
    // updateNow）中，实测回填与滚动锚定补偿以模型 tops 为基准——与真实
    // 布局（容器 padding、边距合并）存在系统性残差，可能把同步校准好的
    // 位置再次拖偏且无人纠正（锚点监听随即读取错位视口）。帧+宏任务后
    // 按目标块真实位置再吸附，未命中（仍偏）则再补一轮
    const request = this.locateSnap = { top: this.scrollEl.scrollTop }
    this.scheduleLocateSnap(idx, 2, request)
  }

  /** 目标块真实布局位置吸附 scrollTop（返回是否发生了校正） */
  private snapToBlockTop(idx: number): boolean {
    const el = this.elements.get(idx)
    if (!el || this.blocks[idx] === undefined) {
      return false
    }
    const box = this.scrollEl.getBoundingClientRect()
    if (box.height <= 0) {
      return false
    }
    const delta = el.getBoundingClientRect().top - box.top
    if (Math.abs(delta) > 0.5) {
      const request = this.currentLocateSnap()
      this.scrollEl.scrollTop += delta
      if (request) request.top = this.scrollEl.scrollTop
      this.updateNow()
      return true
    }
    return false
  }

  /** 定位后的异步吸附：等过滚动事件与 rAF 窗口重算的突发期再校准 */
  private scheduleLocateSnap(idx: number, rounds: number, request: { top: number }): void {
    scheduleFrame(() => {
      if (this.currentLocateSnap() !== request) return
      setTimeout(() => {
        if (this.currentLocateSnap() !== request) return
        if (this.snapToBlockTop(idx) && rounds > 1) {
          this.scheduleLocateSnap(idx, rounds - 1, request)
        } else if (this.locateSnap === request) {
          this.locateSnap = null
        }
      }, 0)
    })
  }

  /** scroll 事件可能尚未派发，校准前必须读取位置，不能只靠事件取消旧请求。 */
  private currentLocateSnap(): { top: number } | null {
    if (this.disposed || this.scrollEl.clientHeight <= 0 ||
      (this.locateSnap && this.scrollEl.scrollTop !== this.locateSnap.top)) {
      this.locateSnap = null
    }
    return this.locateSnap
  }

  /** 源 offset → 锚点块 → 滚动（view.locate / 模式切换定位链） */
  scrollToOffset(offset: number): void {
    const start = this.anchorStartFor(offset)
    if (start !== null) {
      this.scrollToSrcStart(start)
    }
  }

  /** 查找命中块高亮（#14）：块级类，null 清除；挂载/全文重建后自动保持 */
  highlightBlock(srcStart: number | null): void {
    this.highlightSrcStart = srcStart
    this.applyHighlightToDom()
  }

  /** 字符高亮只装配已挂载块；旧命中块类保留，供现有片段继续命中。 */
  highlightMatches(matches: readonly FindMatch[], index: number): void {
    this.findMatches = matches
    this.findIndex = index
    this.findCurrentVisible = false
    this.highlightSrcStart = matches[index] ? this.anchorStartFor(matches[index]!.from) : null
    this.applyHighlightToDom()
    for (const el of this.container.querySelectorAll<HTMLElement>(`.${READING_CLASS_NAMES.block}`)) {
      this.paintFindBlock(el)
    }
    this.updateFindSource()
  }

  /** 代码卡重绘等局部 DOM 更新后恢复字符标记，不触发全文解析。 */
  refreshFindHighlights(el: HTMLElement): void {
    this.paintFindBlock(el)
    this.updateFindSource()
  }

  private paintFindBlock(el: HTMLElement): void {
    const block = this.blocksByStart.get(Number(el.dataset['vsidianSrcStart']))
    if (block) {
      const visible = highlightReadingMatches(el, block, this.text, this.findMatches, this.findIndex)
      const current = this.findMatches[this.findIndex]
      if (current && current.from >= block.start && current.from < block.end) this.findCurrentVisible = visible
    }
  }

  private updateFindSource(): void {
    const current = this.findMatches[this.findIndex]
    if (!current || this.findCurrentVisible) { this.findSource.hide(); return }
    if (!this.blocks.length) { this.findSource.show(this.container, this.text, this.findMatches, this.findIndex); return }
    const block = this.blocks[blockIndexForOffset(this.blocks, current.from) ?? -1]
    const el = block && this.container.querySelector<HTMLElement>(`.${READING_CLASS_NAMES.block}[data-vsidian-src-start="${block.start}"]`)
    if (!el || (block.kind === 'frontmatter' && !el.querySelector('pre'))) { this.findSource.hide(); return }
    this.findSource.show(el, this.text, this.findMatches, this.findIndex)
  }

  /** 跳转目标高亮（#163 验收反馈）：块级类，null 清除；挂载/全文重建后
   *  保持——与 highlightBlock 同机制，但生命周期归 syncController 的
   *  消失监听（用户任意操作后清除），不随查找会话 */
  flashBlock(srcStart: number | null): void {
    this.flashSrcStart = srcStart
    this.applyFlashToDom()
  }

  /** 把当前 flashSrcStart 施加到容器内既有块（两条路径通用） */
  private applyFlashToDom(): void {
    if (!this.virtualized) {
      const els = this.container.querySelectorAll<HTMLElement>(
        `.${READING_CLASS_NAMES.block}[data-vsidian-src-start]`,
      )
      for (const el of els) {
        el.classList.toggle(
          READING_CLASS_NAMES.anchorFlash,
          Number(el.dataset['vsidianSrcStart']) === this.flashSrcStart,
        )
      }
      return
    }
    for (const [i, el] of this.elements) {
      el.classList.toggle(
        READING_CLASS_NAMES.anchorFlash,
        this.blocks[i]?.start === this.flashSrcStart,
      )
    }
  }

  /** 把当前 highlightSrcStart 施加到容器内既有块（两条路径通用） */
  private applyHighlightToDom(): void {
    if (!this.virtualized) {
      const els = this.container.querySelectorAll<HTMLElement>(
        `.${READING_CLASS_NAMES.block}[data-vsidian-src-start]`,
      )
      for (const el of els) {
        el.classList.toggle(
          READING_CLASS_NAMES.findHit,
          Number(el.dataset['vsidianSrcStart']) === this.highlightSrcStart,
        )
      }
      return
    }
    for (const [i, el] of this.elements) {
      el.classList.toggle(
        READING_CLASS_NAMES.findHit,
        this.blocks[i]?.start === this.highlightSrcStart,
      )
    }
  }

  /**
   * 测试钩子：向包含 srcStart 的挂载块注入图片元素并延迟改高，模拟图片
   * 加载后的布局变化（#10 图片显示前的尺寸变化机制载体）。
   * 形态：空 src（宿主 CSP 拦截其加载，无网络请求）+ display:block 的
   * 显式宽高——Chromium 中该形态按 CSS 尺寸占据布局（无 src 属性的 img
   * 不占布局，实测如此）；尺寸变化由 ResizeObserver 捕获。返回是否命中挂载块。
   */
  injectTestImage(srcStart: number, initialHeightPx: number, finalHeightPx: number, delayMs: number): boolean {
    let host: HTMLElement | null = null
    for (const el of this.elements.values()) {
      const s = Number(el.dataset['vsidianSrcStart'])
      const e = Number(el.dataset['vsidianSrcEnd'])
      if (s <= srcStart && srcStart < e) {
        host = el
        break
      }
    }
    if (!host) {
      return false
    }
    const img = document.createElement('img')
    img.setAttribute('src', '') // 空 src：CSP 拦截加载，保留替换元素占位形态
    img.alt = 'vsidian-perf-test'
    img.style.display = 'block'
    img.style.width = '120px'
    img.style.height = `${initialHeightPx}px`
    host.appendChild(img)
    setTimeout(() => {
      img.style.height = `${finalHeightPx}px`
      this.scheduleUpdate() // ResizeObserver 之外的兜底（宿主均有 RO，此为防御）
    }, Math.max(0, delayMs))
    return true
  }

  getStats(): ReadingViewStats {
    return {
      totalBlocks: this.blocks.length,
      mountedBlocks: this.virtualized
        ? this.elements.size
        : this.container.querySelectorAll(`.${READING_CLASS_NAMES.block}`).length,
      contentDomCount: this.container.querySelectorAll('*').length,
      parseCount: this.parseCount,
      virtualized: this.virtualized,
      maxMountedBlocks: this.maxMountedBlocks,
      mountedEver: this.mountedEver,
      unmountedEver: this.unmountedEver,
    }
  }

  /** 容器滚动位置观测（集成断言：锚点视觉稳定性） */
  getScrollObservation(): { scrollTop: number; scrollHeight: number } {
    return { scrollTop: this.scrollEl.scrollTop, scrollHeight: this.scrollEl.scrollHeight }
  }

  /**
   * #419 阅读态折叠绘制观测（view.state.paint 探针族 readingFold 字段的
   * 采集体，协议 ReadingFoldPaintProbe）：折叠区间数、可折叠标题箭头
   * 计数、首折叠标题的省略号/箭头绘制态与隐藏内容是否仍被绘制。
   * 结构性字段（计数/文字/文本包含）jsdom 可断言；visible 类字段
   * （elementFromPoint 中心命中）jsdom 无布局恒 false，只作真宿主/
   * 浏览器断言依据——视觉层断言约定（AGENTS.md）的绘制层口径。
   */
  collectFoldPaint(): ReadingFoldPaintProbe {
    let foldCount = 0
    let firstFoldedText: string | null = null
    for (const s of this.foldSpans) {
      if (this.foldedKeys.has(s.key)) {
        foldCount += 1
        if (firstFoldedText === null) {
          // 首折叠区间的隐藏文本行（容器 textContent 是否仍含——结构性
          // 「不可见」断言面：块被移出可见序列即不含）
          firstFoldedText = this.hiddenTextSample(s)
        }
      }
    }
    const hiddenTextInDom = firstFoldedText !== null
      ? this.container.textContent != null && this.container.textContent.includes(firstFoldedText)
      : null
    const ellipsisEl = this.container.querySelector<HTMLElement>(
      `.${READING_CLASS_NAMES.foldEllipsis}`,
    )
    const firstFoldedArrow = this.container.querySelector<HTMLElement>(
      `.${READING_CLASS_NAMES.foldTarget}.${READING_CLASS_NAMES.foldCollapsed} .${READING_CLASS_NAMES.foldArrow}`,
    )
    // 隐藏区首个非空行的 elementFromPoint 绘制层断言：隐藏块不在 DOM，
    // 落点坐标命中的应是其他内容或空——以文本采样是否在命中节点判定
    let hiddenLinePainted: boolean | null = null
    if (firstFoldedText !== null) {
      try {
        const hit = document.elementFromPoint(
          this.scrollEl.getBoundingClientRect().left + this.scrollEl.clientWidth / 2,
          this.scrollEl.getBoundingClientRect().top + this.scrollEl.clientHeight / 2,
        )
        hiddenLinePainted =
          !!hit && hit.textContent != null && hit.textContent.includes(firstFoldedText)
      } catch {
        hiddenLinePainted = false
      }
    }
    return {
      foldCount,
      foldableArrowCount: this.foldSpans.length,
      ellipsisVisible: !!ellipsisEl && hitPainted(ellipsisEl),
      ellipsisText: ellipsisEl ? ellipsisEl.textContent : null,
      arrowVisible: !!firstFoldedArrow && hitPainted(firstFoldedArrow),
      arrowCollapsed: firstFoldedArrow != null,
      hiddenTextInDom,
      hiddenLinePainted,
    }
  }

  /** 折叠区间隐藏侧首个非空行的文本采样（trim 后；全空白节取 null——
   *  可折叠判定保证有效折叠必有非空行，防御兜底） */
  private hiddenTextSample(span: HeadingFoldSpan): string | null {
    let pos = span.hideFrom + 1
    while (pos < span.hideTo && pos < this.text.length) {
      const lineEnd = this.text.indexOf('\n', pos)
      const end = lineEnd === -1 || lineEnd > span.hideTo ? span.hideTo : lineEnd
      const line = this.text.slice(pos, end).trim()
      if (line !== '') {
        return line
      }
      pos = end + 1
    }
    return null
  }

  /** 释放当前文档及资源，不将清空计为一次 Markdown 解析。 */
  clearDocument(): void {
    if (this.disposed) return
    this.locateSnap = null
    this.blocks = []
    this.allBlocks = []
    this.text = ''
    this.heights = []
    this.tops = [0]
    this.measuredHeights.clear()
    this.clearAll()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.locateSnap = null
    this.cancelFrame?.()
    this.cancelFrame = null
    this.pendingFrame = false
    this.findSource.dispose()
    this.observer?.disconnect()
    this.observer = null
    this.clearAll()
  }

  // ---- 内部 ----

  /** 测试门控开启后接入，被动回报既有调度；关闭后不读取诊断数据。 */
  setDiagnosticSink(sink: VirtualReadingViewOptions['onDiagnostic']): void { this.onDiagnostic = sink }

  private scheduleUpdate(): void {
    this.onDiagnostic?.('reading.schedule', { disposed: this.disposed, pendingFrame: this.pendingFrame })
    if (this.disposed || this.pendingFrame) {
      return
    }
    this.pendingFrame = true
    this.cancelFrame = scheduleFrame(() => {
      this.onDiagnostic?.('reading.frame', {})
      this.cancelFrame = null
      this.pendingFrame = false
      if (!this.disposed) this.updateNow()
    })
  }

  /** RO 回调同步路径只做标记（PR #268 审查 P1-2）：容器内容宽度相对变化
   *  超过 2%（与 drift 阈值同族）时置旗，实测集的清空推迟到
   *  measureAndStabilize 消费——拆分窗口/侧栏开合/可读行宽变更会改变全部
   *  块的真实高度，旧宽度的实测值不再可信。只比宽度：纵向尺寸变化（窗口
   *  差分、图片晚到的既有通道）不置旗，纯滚动路径零影响；宽度非正（隐藏）
   *  忽略不入册，显示/隐藏周期不把同宽复原误判为漂移。只看容器条目——
   *  外部宿主形态下 scrollEl 与容器宽度本就不同（滚动条），跨目标比较会
   *  把固定差误判成漂移。 */
  private noteWidthDrift(entries: ResizeObserverEntry[]): void {
    for (const entry of entries) {
      if (entry.target !== this.container) {
        continue
      }
      const w = entry.contentRect.width
      if (w <= 0) {
        continue
      }
      if (this.lastContainerWidth > 0 && Math.abs(w / this.lastContainerWidth - 1) > 0.02) {
        this.widthDriftPending = true
      }
      this.lastContainerWidth = w
    }
  }

  private layoutAvailable(): boolean {
    return this.scrollEl.clientHeight > 0 || this.lastViewportHeight > 0
  }

  private effectiveViewport(): number {
    const h = this.scrollEl.clientHeight
    if (h > 0) {
      this.lastViewportHeight = h
      return h
    }
    return this.lastViewportHeight
  }

  /** 将外层 scrollport 的滚动坐标换成内容容器局部坐标。 */
  private contentScrollTop(): number {
    if (this.scrollEl === this.container) return this.scrollEl.scrollTop
    const scrollRect = this.scrollEl.getBoundingClientRect()
    const contentRect = this.container.getBoundingClientRect()
    // 真实布局中 contentRect.top 已随 scrollTop 移动，不能再叠加 scrollTop。
    // jsdom 的两个 rect 均为零时，以宿主 scrollTop 作无几何回退。
    if (scrollRect.height <= 0 || contentRect.height <= 0) return this.scrollEl.scrollTop
    return scrollRect.top + this.scrollEl.clientTop - contentRect.top
  }

  private setContentScrollTop(value: number): void {
    this.scrollEl.scrollTop += value - this.contentScrollTop()
  }

  private bufferPx(): number {
    if (this.fixedBufferPx !== undefined) {
      return this.fixedBufferPx
    }
    return Math.max(600, Math.round(this.effectiveViewport() * 1.5))
  }

  private clearAll(): void {
    this.findSource.hide()
    this.observer && this.disconnectElements()
    this.releaseAllBlocks()
    this.elements.clear()
    this.mounted = null
    this.detachSpacers()
    this.container.textContent = ''
  }

  private disconnectElements(): void {
    if (!this.observer) {
      return
    }
    for (const el of this.elements.values()) {
      this.observer.unobserve(el)
    }
  }

  private detachSpacers(): void {
    this.spacerTop.remove()
    this.spacerBottom.remove()
  }

  private mountBlock(i: number): void {
    const block = this.blocks[i]!
    const el = createReadingBlockElement(block, this.text)
    this.decorateFoldControls(el, block)
    if (block.start === this.highlightSrcStart) {
      // #14 查找命中块：滚动窗口平移导致重挂载后高亮保持
      el.classList.add(READING_CLASS_NAMES.findHit)
    }
    if (block.start === this.flashSrcStart) {
      // #163 验收反馈：跳转目标高亮块重挂载后保持
      el.classList.add(READING_CLASS_NAMES.anchorFlash)
    }
    this.elements.set(i, el)
    this.mountedEver++
    this.maxMountedBlocks = Math.max(this.maxMountedBlocks, this.elements.size)
    this.observer?.observe(el)
    // #10：挂载即预备图片（进入挂载窗口 = 进入装载时机）
    this.hooks.onBlockMounted?.(el)
    this.paintFindBlock(el)
  }

  private unmountBlock(i: number): void {
    const el = this.elements.get(i)
    if (el) {
      // #10：卸载前释放块内图片槽位（src 清空、资源条目回收）
      this.hooks.onBlockUnmounted?.(el)
      this.observer?.unobserve(el)
      el.remove()
      this.elements.delete(i)
      this.unmountedEver++
    }
  }

  /** 既有内容块的图片释放（虚拟化与回退两条路径共用；不改动 DOM 结构） */
  private releaseAllBlocks(): void {
    if (this.virtualized) {
      for (const el of this.elements.values()) {
        this.hooks.onBlockUnmounted?.(el)
      }
      return
    }
    for (const el of Array.from(
      this.container.querySelectorAll<HTMLElement>(`.${READING_CLASS_NAMES.block}`),
    )) {
      this.hooks.onBlockUnmounted?.(el)
    }
  }

  /**
   * #419 折叠态标题装饰（挂载与无布局全量渲染两路径共用）：可折叠标题
   * 块标记 foldTarget（标题元素成为箭头定位上下文）并注入折叠箭头（块
   * hover 显现/折叠态常显，CSS 驱动）；折叠态加 collapsed 修饰类与行尾
   * 省略号占位（点击展开）。DOM 形态经 createHeadingFoldControlButton
   * 工厂（与 Live 箭头/省略号同源）；点击回调走构造注入的 onFoldToggle
   * （翻转 Live StateField——呈现刷新由控制器的折叠侦测闭环驱动）。
   * 非可折叠标题（空节）与列表/引用内标题（无阅读标题块身份，隐藏
   * 判定照常、仅无交互入口——规格已知边界）不装饰。
   */
  private decorateFoldControls(el: HTMLElement, block: ReadingBlock): void {
    if (block.kind !== 'heading' || this.foldSpans.length === 0 || !this.onFoldToggle) {
      return
    }
    const span = this.foldSpanByStart.get(block.start)
    if (!span) {
      return
    }
    const heading = el.querySelector<HTMLElement>('h1, h2, h3, h4, h5, h6')
    if (!heading) {
      return
    }
    const folded = this.foldedKeys.has(block.start)
    el.classList.add(READING_CLASS_NAMES.foldTarget)
    const onToggle = () => this.onFoldToggle?.(block.start)
    const arrow = createHeadingFoldControlButton({
      folded,
      ellipsis: false,
      className: READING_CLASS_NAMES.foldArrow,
      onToggle,
    })
    heading.insertBefore(arrow, heading.firstChild)
    if (folded) {
      el.classList.add(READING_CLASS_NAMES.foldCollapsed)
      heading.appendChild(createHeadingFoldControlButton({
        folded: true,
        ellipsis: true,
        className: READING_CLASS_NAMES.foldEllipsis,
        onToggle,
      }))
    }
  }

  /** 窗口元素按块序最小移动到两个 spacer 之间（reconciliation 式）：
   *  期望序 [spacerTop, first..last, spacerBottom] 游标对位——节点已在
   *  游标紧后（同父且 previousSibling 命中）则零移动，块集合与块序不变
   *  的窗口平移不再触碰既有块节点。#258 根因侧：此前无条件 appendChild
   *  全部挂载块会移动表格块根 div，Chromium 表格布局重排静默重置 td 内
   *  滚动容器的 scrollTop（无 scroll 事件、无 JS 写入；table-layout:fixed
   *  / contain / will-change 等 CSS 缓解实测全部无效）——最小移动后表格
   *  块只要留在窗口内就不被移动，格内嵌入卡的内层滚动全程稳定（第一轮
   *  的 120ms 停歇恢复兜底保留为受害者侧防线）。mountBlock 创建的块是
   *  游离节点（不预先插入），游离节点 parentElement 非本容器，必然走
   *  insertBefore 入位；cursor 为 null 时插入参照取 firstChild。窗口
   *  不变路径不进本方法（零 DOM 写、防 RO 空转的既有约定不变）。 */
  private reorderChildren(): void {
    if (this.mounted === null) {
      return
    }
    let cursor: ChildNode | null = null
    const place = (el: HTMLElement): void => {
      if (el.parentElement !== this.container || el.previousSibling !== cursor) {
        this.container.insertBefore(el, cursor === null ? this.container.firstChild : cursor.nextSibling)
      }
      cursor = el
    }
    place(this.spacerTop)
    for (let i = this.mounted.first; i <= this.mounted.last; i++) {
      const el = this.elements.get(i)
      if (el) {
        place(el)
      }
    }
    place(this.spacerBottom)
  }

  /**
   * 实测挂载块回填高度表，并做滚动锚定：视口顶块顶部位置因实测/尺寸变化
   * 发生偏移时平移 scrollTop 同量，保持视觉位置（图片加载防抖动的机制）。
   * 行高标定漂移超阈值时重估未挂载块（远距离跳转的估计误差由此收敛），
   * 重估引起的上方内容位移同样被锚定补偿。
   */
  private measureAndStabilize(prevScrollTop: number, allowStabilize: boolean): void {
    if (this.widthDriftPending) {
      // 容器横向宽度已显著变化：旧宽度的实测值不再可信，清空实测集——
      // 本轮窗口内块照常实测回填，回收块交由下方 drift 重估刷成新标定
      // 估计（宽度变化通常改变行数分布，标定随之漂移触发重估）
      this.widthDriftPending = false
      this.measuredHeights.clear()
    }
    const oldTops = this.tops
    const refIdx = anchorIndexAtScroll(oldTops, this.heights, prevScrollTop)
    const samples: HeightSample[] = []
    let measuredAboveChanged = false
    for (const [i, el] of this.elements) {
      const h = outerHeight(el)
      if (h > 0) {
        const blockStart = this.blocks[i]!.start
        if (refIdx !== null && i < refIdx && this.measuredHeights.has(blockStart) && h !== this.heights[i]) {
          measuredAboveChanged = true
        }
        this.heights[i] = h
        this.measuredHeights.set(blockStart, h)
      }
      const block = this.blocks[i]!
      if (block.kind === 'paragraph') {
        let lines = 1
        for (let p = block.start; p < block.end; p++) {
          if (this.text.charCodeAt(p) === 10) {
            lines += 1
          }
        }
        samples.push({ lines, heightPx: this.heights[i]! })
      }
    }
    if (samples.length > 0) {
      const next = recalibrate(samples, this.calib)
      const drift = Math.abs(next.lineHeightPx / this.calib.lineHeightPx - 1)
      this.calib = next
      if (drift > 0.02) {
        // 重估全部「从未实测」的块（#259：判实测缓存而非 elements）：
        // 已实测但被窗口回收的块必须保留实测值——若按「当前未挂载」判，
        // 标定中位数随窗口样本摆动时，回收带的实测值被换回估计值再随
        // 下一轮窗口实测换回，形成估计↔实测翻转的自持闭环，稳定化平移
        // 把翻转转译成对用户滚轮的回吐（长文档滚不到底的恒差根因）
        for (let i = 0; i < this.blocks.length; i++) {
          const block = this.blocks[i]!
          if (!this.measuredHeights.has(block.start)) {
            this.heights[i] = estimateBlockHeightPx(block, this.text, this.calib)
          }
        }
      }
    }
    this.tops = blockTops(this.heights)
    if (allowStabilize && refIdx !== null && this.contentScrollTop() === prevScrollTop &&
      (this.scrollEl === this.container || measuredAboveChanged)) {
      const delta = this.tops[refIdx]! - oldTops[refIdx]!
      if (delta !== 0) {
        this.setContentScrollTop(prevScrollTop + delta)
      }
    }
  }

  private updateSpacers(): void {
    if (this.mounted === null) {
      return
    }
    const n = this.heights.length
    const topPx = Math.max(0, this.tops[this.mounted.first] ?? 0)
    const bottomPx = Math.max(0, (this.tops[n] ?? 0) - (this.tops[this.mounted.last + 1] ?? 0))
    // 值未变化时不写 style：避免每帧无效布局失效（RO 反馈循环诱因之一）
    const topValue = `${topPx}px`
    if (this.spacerTop.style.height !== topValue) {
      this.spacerTop.style.height = topValue
    }
    const bottomValue = `${bottomPx}px`
    if (this.spacerBottom.style.height !== bottomValue) {
      this.spacerBottom.style.height = bottomValue
    }
  }

  /**
   * 全量回退 → 虚拟化转换（隐藏期全量渲染、可见后首个滚动/更新触发）：
   * 全部既有块先实测（此时它们都在 DOM 中），再按窗口收缩。
   */
  private promoteToVirtual(): void {
    this.virtualized = true
    const els = Array.from(
      this.container.querySelectorAll<HTMLElement>(`.${READING_CLASS_NAMES.block}`),
    )
    let idx = 0
    for (const el of els) {
      const h = outerHeight(el)
      if (h > 0 && idx < this.heights.length) {
        this.heights[idx] = h
        // 与 measureAndStabilize 实测路径成对回填：heights 为实测 ⟺
        // measuredHeights 有记录（#259 判据的不变量）。缺此回填时，隐藏期全量
        // 渲染 → 可见晋升的块在 heights 持实测值、measuredHeights 无记录，其后
        // 首次 drift 重估会把实测值换回估计值。
        this.measuredHeights.set(this.blocks[idx]!.start, h)
      }
      idx += 1
    }
    // 晋升实测发生在可见后的当前宽度：实测值即新宽度真值，无需宽度清空
    this.widthDriftPending = false
    this.tops = blockTops(this.heights)
    // 全量块退场：释放图片槽位（后续由窗口挂载路径重新预备）
    this.releaseAllBlocks()
    this.container.textContent = ''
    this.elements.clear()
    this.mounted = null
    this.updateNow()
  }
}
