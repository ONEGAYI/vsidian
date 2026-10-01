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
import type { FindMatch } from './findSession'
import { highlightReadingMatches } from './readingFind'
import { ReadingFindSource } from './readingFindSource'
import {
  READING_CLASS_NAMES,
  createReadingContainer,
  createReadingBlockElement,
  findReadingAnchor,
  readingAnchorStartFor,
} from './readingView'
import {
  DEFAULT_LINE_HEIGHT_PX,
  anchorIndexAtScroll,
  blockIndexForOffset,
  blockTops,
  computeMountWindow,
  diffWindow,
  estimateBlockHeightPx,
  estimateHeights,
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
  /** 滚动及裁剪宿主；缺省为内容容器（主阅读视图既有形态）。 */
  scrollEl?: HTMLElement
  /** 挂载缓冲（px）：窗口在视口两侧外扩的距离；缺省按视口高度自适应 */
  bufferPx?: number
  /** #10 图片生命周期钩子：块挂载后预备其内图片（发起装载）；块卸载/容器
   *  重建前释放其内图片槽位（src 清空、条目回收） */
  onBlockMounted?: (el: HTMLElement) => void
  onBlockUnmounted?: (el: HTMLElement) => void
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

  /** 当前挂载窗口与元素表（索引 → 元素） */
  private mounted: MountWindow | null = null
  private elements = new Map<number, HTMLElement>()
  /** 已获得真实高度的块；新块首次替代估计值不应拖动外层滚动区。 */
  private measured = new Set<number>()
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
  private disposed = false
  /** #10 图片生命周期钩子（构造注入） */
  private hooks: VirtualReadingViewOptions
/** 最近一次有效视口高度（隐藏期保持虚拟模式用） */
  private lastViewportHeight = 0

  constructor(container: HTMLElement, options: VirtualReadingViewOptions = {}) {
    this.container = container ?? createReadingContainer()
    this.scrollEl = options.scrollEl ?? this.container
    this.fixedBufferPx = options.bufferPx
    this.hooks = options
    this.findSource = new ReadingFindSource(this.container)
    this.spacerTop = document.createElement('div')
    this.spacerTop.className = `${READING_CLASS_NAMES.spacer} ${READING_CLASS_NAMES.spacerTop}`
    this.spacerBottom = document.createElement('div')
    this.spacerBottom.className = `${READING_CLASS_NAMES.spacer} ${READING_CLASS_NAMES.spacerBottom}`
    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(() => this.scheduleUpdate())
      this.observer.observe(this.container)
      if (this.scrollEl !== this.container) this.observer.observe(this.scrollEl)
    }
  }

  /** 全文装载/重建（init、resync、外部增量后的重建路径）：全文切块一次。
   *  #219 悬停局部预览：opts.range 存在时切块后按块区间**求交过滤**——
   *  解析仍吃全文（保留全文解析上下文，不丢章节外引用式链接定义），范围
   *  选取在块模型上做（跨界块整块保留，不孤立解析截取字符串）；range 为
   *  LF 坐标（宿主经 NewlineCoordinator 换算后随 hover.result 下发） */
  setDocument(text: string, opts?: {
    range?: { start: number; end: number }
    /** 已在来源缓存完成全文解析的块；各实例只共享只读数据，不共享 DOM。 */
    blocks?: readonly ReadingBlock[]
    parsedNow?: boolean
  }): void {
    if (this.disposed) return
    this.findSource.hide()
    if (opts?.parsedNow !== false) this.parseCount += 1
    this.text = text
    this.blocks = opts?.blocks ? [...opts.blocks] : splitReadingBlocks(text)
    if (opts?.range) {
      const { start, end } = opts.range
      this.blocks = this.blocks.filter((b) => b.start <= end && b.end >= start)
    }
    this.blocksByStart = new Map(this.blocks.map(block => [block.start, block]))
    this.heights = estimateHeights(this.blocks, text, this.calib)
    this.tops = blockTops(this.heights)
    this.measured.clear()
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
        const el = createReadingBlockElement(block, text)
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
  }

  /** 滚动入口（scroll 事件）：rAF 合帧后重算窗口 */
  handleScroll(): void {
    // 外部宿主刚发生滚动时，其 scrollTop 是用户意图；首次窗口实测
    // 的估计修正不应把该值平移。后续独立 RO（如图片晚到）仍会锚定。
    if (this.scrollEl !== this.container) this.skipStabilizeOnce = true
    this.scheduleUpdate()
  }

  /** 立即重算窗口（同步；测试与 handleScroll 的落点） */
  updateNow(): void {
    if (this.disposed) return
    if (this.blocks.length === 0) {
      this.clearAll()
      this.updateFindSource()
      return
    }
    if (!this.layoutAvailable()) {
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
    this.scheduleLocateSnap(idx, 2)
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
      this.scrollEl.scrollTop += delta
      this.updateNow()
      return true
    }
    return false
  }

  /** 定位后的异步吸附：等过滚动事件与 rAF 窗口重算的突发期再校准 */
  private scheduleLocateSnap(idx: number, rounds: number): void {
    scheduleFrame(() => {
      setTimeout(() => {
        if (this.snapToBlockTop(idx) && rounds > 1) {
          this.scheduleLocateSnap(idx, rounds - 1)
        }
      }, 0)
    })
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

  /** 释放当前文档及资源，不将清空计为一次 Markdown 解析。 */
  clearDocument(): void {
    if (this.disposed) return
    this.blocks = []
    this.text = ''
    this.heights = []
    this.tops = [0]
    this.measured.clear()
    this.clearAll()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.cancelFrame?.()
    this.cancelFrame = null
    this.pendingFrame = false
    this.findSource.dispose()
    this.observer?.disconnect()
    this.observer = null
    this.clearAll()
  }

  // ---- 内部 ----

  private scheduleUpdate(): void {
    if (this.disposed || this.pendingFrame) {
      return
    }
    this.pendingFrame = true
    this.cancelFrame = scheduleFrame(() => {
      this.cancelFrame = null
      this.pendingFrame = false
      if (!this.disposed) this.updateNow()
    })
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

  /** 窗口元素按块序重排到两个 spacer 之间（appendChild 移动既有节点，不重建） */
  private reorderChildren(): void {
    if (this.mounted === null) {
      return
    }
    this.container.appendChild(this.spacerTop)
    for (let i = this.mounted.first; i <= this.mounted.last; i++) {
      const el = this.elements.get(i)
      if (el) {
        this.container.appendChild(el)
      }
    }
    this.container.appendChild(this.spacerBottom)
  }

  /**
   * 实测挂载块回填高度表，并做滚动锚定：视口顶块顶部位置因实测/尺寸变化
   * 发生偏移时平移 scrollTop 同量，保持视觉位置（图片加载防抖动的机制）。
   * 行高标定漂移超阈值时重估未挂载块（远距离跳转的估计误差由此收敛），
   * 重估引起的上方内容位移同样被锚定补偿。
   */
  private measureAndStabilize(prevScrollTop: number, allowStabilize: boolean): void {
    const oldTops = this.tops
    const refIdx = anchorIndexAtScroll(oldTops, this.heights, prevScrollTop)
    const samples: HeightSample[] = []
    let measuredAboveChanged = false
    for (const [i, el] of this.elements) {
      const h = outerHeight(el)
      if (h > 0) {
        if (refIdx !== null && i < refIdx && this.measured.has(i) && h !== this.heights[i]) {
          measuredAboveChanged = true
        }
        this.heights[i] = h
        this.measured.add(i)
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
        // 重估全部「从未实测」的块（#259：判 measured 而非 elements）：
        // 已实测但被窗口回收的块必须保留实测值——若按「当前未挂载」判，
        // 标定中位数随窗口样本摆动时，回收带的实测值被换回估计值再随
        // 下一轮窗口实测换回，形成估计↔实测翻转的自持闭环，稳定化平移
        // 把翻转转译成对用户滚轮的回吐（长文档滚不到底的恒差根因）
        for (let i = 0; i < this.blocks.length; i++) {
          if (!this.measured.has(i)) {
            this.heights[i] = estimateBlockHeightPx(this.blocks[i]!, this.text, this.calib)
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
      }
      idx += 1
    }
    this.tops = blockTops(this.heights)
    // 全量块退场：释放图片槽位（后续由窗口挂载路径重新预备）
    this.releaseAllBlocks()
    this.container.textContent = ''
    this.elements.clear()
    this.mounted = null
    this.updateNow()
  }
}
