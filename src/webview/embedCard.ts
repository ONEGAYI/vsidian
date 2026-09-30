// Reading 正文嵌入卡片（工单 #222，ADR-0009「展示容器」层的嵌入侧）：
// 父文档 Reading 正文流中，独占行 `![[…]]` embed 块（readingBlocks 产物）
// 挂载时升级为引用卡片——左侧引用边条 + 顶部文件名 + 右上角打开入口，
// 内容为目标的只读 Reading 视图（独立 VirtualReadingView 实例，经悬停
// 文档访问通道 hover.request/result 装载全文/章节/块）。
//
// 分层契约（#223/#224 的衔接边界）：
// - 本模块做 **Reading 侧挂载适配与容器生命周期**；目标解析与内容服务
//   在 hoverDocAccess（宿主）与 refReadingContent（共享装配）；#224 起
//   未保存变更刷新接入：装载成功登记目标订阅（hover.watch，宿主协调器
//   防抖合并推送），hover.invalidated 到达按分态处理（changed 静默重载、
//   deleted/stale 撤内容显示分态）。接口按容器无关设计（实例身份 = 嵌入
//   行区间 + 目标原文，与容器类型无绑定）。#223 起 Live widget
//   （liveEmbed.ts 的 LiveEmbedWidget）经 mountCardInto 以同一状态库挂载
//   ——语义键同源使模式切换（Live↔Reading）共享装载缓存、fm 展开与
//   滚动状态。#224 起状态库有界（LRU 淘汰死键——父文档文本变更后漂移
//   的旧语义键；仍挂载实例不淘汰），被淘汰条目配对释放订阅。
// - 一层展开：B 内容内的 embed 块**不升级**（readingBlocks 的占位引用行
//   呈现，可点击按 B 身份打开）——不递归装载、不在嵌入内容上叠加悬停
//   浮层（contentEl 停止 mouseover/mouseout 冒泡）。
// - 虚拟化：嵌入块是父文档 VirtualReadingView 的普通块，随窗口挂载/回收
//   ——本模块在回收时释放 B 内容 DOM 与 B 资源管理器、保留 fm 展开与滚动
//   位置（状态库按语义键持有）；重挂优先用装载缓存（会话内零重发，
//   #224 接变更订阅后失效重载）。#243 起卡片内部也按外层
//   .vsidian-embed-card-scroll 的真实视口挂载有限块窗口；未入布局时
//   先由两个 spacer 撑开外壳，随后测量。父视口回收与子窗口回收独立。
// - 只读契约：任务 checkbox 禁用（共享 mountRefContentBlock）、点击不
//   写文档；卡片内点击不冒泡父容器委托（B 内链接按 B 目录解析是唯一
//   正确语义，父容器按 A 解析的委托不得命中）。
import type { HoverPreviewResult, WebviewToHost } from '../shared/protocol'
import { parseWikilinkInner } from '../shared/wikilink'
import { t } from '../shared/i18n'
import { HOVER_REFRESH_DEFAULTS } from '../shared/hoverRefresh'
import { RefContentInstance, type RefContentMount, type RefLoadedContent, type RefSourceContext } from './refContentInstance'
import { applyObsidianDomAlias } from '../shared/obsidianAlias'
import { createReadingContainer, READING_CLASS_NAMES } from './readingView'
import type { ReadingViewStats } from './readingVirtualView'
import { refErrorText, releaseRefSourceLease } from './refReadingContent'
import { WIKILINK_CLASS_NAMES } from '../shared/wikilink'

/** 右上角打开入口图标（验收反馈：按钮本体空壳无图标——外部跳转形态，
 *  graphicBlockChrome 同款内联 SVG 风格；stroke currentColor 随按钮
 *  --vscode-icon-foreground 着色）。#217 验收跟进：悬停浮层 header 的
 *  跳转按钮同款复用（导出共享） */
export const OPEN_ICON =
  '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" ' +
  'stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M9 2.5h4.5V7"></path><path d="M13.5 2.5L7.5 8.5"></path>' +
  '<path d="M11.5 9v3.5a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1H6"></path></svg>'

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
  /** 错误分态修饰（验收反馈：错误文案与普通文字区分——主题错误色；
   *  loading 不挂，与悬停浮层 stateError 同口径） */
  stateError: 'vsidian-embed-card-state-error',
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
  /** #223 Live 挂载的布局通知（view.requestMeasure）：卡片高度异步变动
   *  （内容装载、图片晚到）须唤醒 CM6 视口测量；Reading 侧无需提供 */
  requestMeasure?(): void
}

/** 装载结果缓存（父文档会话内；#224 变更订阅推送后按目标失效清除） */
type EmbedLoaded = RefLoadedContent

/** 嵌入实例状态（跨挂载保持——视口回收不清除仍可见实例的状态） */
interface EmbedEntry {
  /** 语义键：嵌入行区间 + 目标原文（父文档文本不变则稳定；文本变更后
   *  键漂移自然开新实例，旧键随 LRU 淘汰回收） */
  key: string
  inner: string
  sourceStart: number
  sourceEnd: number
  loaded: EmbedLoaded | null
  /** P1-2（review 修复）最近已应用的目标版本（fsPath + version；成功应用
   *  时更新，**不随 loaded 清空**——changed 失效清 loaded 后仍作为回包
   *  新鲜度参照，慢响应旧内容不得覆盖已知更新版本）。TextDocument.version
   *  按文档单调，同目标跨 entry 同一版本空间，可比 */
  lastKnown: { fsPath: string; version: number } | null
  /** 在途请求配对（卸载后的迟到回包仍写入缓存） */
  lastReq: { instanceId: string; reqId: number } | null
  /** P1-2 循环防护：最近一次自愈重发发出的 reqId（该请求的回包若仍过期，
   *  视为版本谱系断点——如目标文档关闭重开后 TextDocument.version 重置
   *  ——终态落地不再重发，避免无限循环；正常请求路径置回 null） */
  healReqId: number | null
  content: RefContentInstance
  /** #224 已登记订阅的目标（hover.watch；与 loaded 解耦——deleted 清
   *  loaded 后订阅保持以感知恢复，dispose/淘汰时据此配对 unwatch） */
  watchedFsPath: string | null
}

/** 挂载中的卡片实例（DOM 生命周期 = 宿主元素在场期间——Reading 块元素
 *  或 Live widget 根，#223 起两容器同款 handle） */
interface EmbedCardHandle {
  entry: EmbedEntry
  instanceId: string
  hostEl: HTMLElement
  cardEl: HTMLElement
  scrollEl: HTMLElement
  stateEl: HTMLElement
  contentEl: HTMLElement
  content: RefContentMount
  display: 'loading' | 'content' | 'error'
  note: string
  /** 容器来源（探针观测面；行为路径不分叉——两容器共用装配） */
  host: 'reading' | 'live'
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
  /** 容器来源（#223 Live 挂载与 Reading 块挂载的观测区分） */
  host: 'reading' | 'live'
  /** #224 内容文本字符数（未保存修改推送后刷新可见性的观测面） */
  textLen: number
  viewStats: ReadingViewStats | null
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
  /** 挂载中卡片（宿主元素 → handle；宿主卸载即移除。#223 起宿主可为
   *  Reading 块元素或 Live widget 根，同一 entry 可双容器并存（模式切换
   *  期间视图互不销毁），notifyResult 对全部配对 handle 渲染） */
  private readonly active = new Map<HTMLElement, EmbedCardHandle>()
  /** #223 卡片高度观测（Live 挂载的布局联动）：内容装载/图片晚到改变
   *  cardEl 高度时唤醒 CM6 测量；Reading 侧容器滚动自适应无需通知。
   *  requestMeasure 只读测量不写布局，无 RO 自激发循环风险 */
  private readonly heightObserver: ResizeObserver | null
  private seq = 0
  private reqSeq = 0

  constructor(context: EmbedCardContext) {
    this.context = context
    this.heightObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => this.context.requestMeasure?.())
      : null
  }

  /** 父文档块挂载钩子：embed 块（data-vsidian-embed-inner 在场）升级为卡片 */
  mountBlock(el: HTMLElement): void {
    const inner = el.dataset['vsidianEmbedInner']
    if (inner === undefined || this.active.has(el)) {
      return
    }
    const sourceStart = Number(el.dataset['vsidianSrcStart'] ?? 0)
    const sourceEnd = Number(el.dataset['vsidianSrcEnd'] ?? sourceStart)
    this.mountCardInto(el, inner, sourceStart, sourceEnd, 'reading')
  }

  /**
   * 容器无关挂载（#223 Live widget 消费）：宿主元素内置卡片壳与交互域，
   * entry 按语义键（行首 offset + 目标原文）取用——Reading 块与 Live
   * widget 对同一嵌入共享装载缓存、fm 展开与滚动状态。装载判定三态：
   * 已装载直接渲染、在途请求显示 loading 等回包（双容器并存不重发）、
   * 其余发起新请求。
   */
  mountCardInto(
    el: HTMLElement,
    inner: string,
    sourceStart: number,
    sourceEnd: number,
    host: 'reading' | 'live',
    source?: RefSourceContext,
  ): void {
    if (this.active.has(el)) {
      return
    }
    const key = source?.occurrence ?? `${Number.isInteger(sourceStart) ? sourceStart : 0}::${inner}`
    let entry = this.entries.get(key)
    if (!entry) {
      entry = {
        key,
        inner,
        sourceStart: Number.isInteger(sourceStart) ? sourceStart : 0,
        sourceEnd: Number.isInteger(sourceEnd) ? sourceEnd : sourceStart,
        loaded: null,
        lastKnown: null,
        lastReq: null,
        healReqId: null,
        content: new RefContentInstance(source ?? {
          panelDocUri: this.context.session().docUri ?? '',
          sourceDocUri: this.context.session().docUri ?? '',
          range: { start: sourceStart, end: sourceEnd },
          occurrence: key,
        }),
        watchedFsPath: null,
      }
      this.entries.set(key, entry)
      const owned = entry
      entry.content.onDispose(() => {
        owned.lastReq = null
        this.unwatchEntry(owned)
      })
    } else {
      this.touchEntry(entry) // LRU 触达（重挂载 = 仍有效实例）
    }
    this.evictEntriesIfNeeded()

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
    openBtn.innerHTML = OPEN_ICON
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
      content: entry.content.mount({
        contentEl, scrollEl, strategy: 'virtual',
        session: () => this.context.session(),
        send: (message) => this.context.send(message),
        codeHighlight: () => this.context.codeHighlight?.() ?? true,
      }),
      display: 'loading',
      note: '',
      host,
    }
    this.active.set(el, handle)
    this.heightObserver?.observe(cardEl)
    handle.content.onDispose(() => this.heightObserver?.unobserve(cardEl))

    // 卡片内交互域：点击不冒泡父容器委托（B 内链接按 B 解析）；悬停不
    // 叠加浮层（阻断 readingContainer 的 mouseover/mouseout 委托）
    handle.content.listen(contentEl, 'click', (event) => {
      event.stopPropagation() // 全部点击停在卡片域内（含 fm 按钮冒泡）
      this.handleContentClick(handle, event)
    })
    handle.content.listen(contentEl, 'mouseover', (event) => event.stopPropagation())
    handle.content.listen(contentEl, 'mouseout', (event) => event.stopPropagation())

    // 右上角打开入口：按父文档身份解析（不带 sourceDocUri，与正文双链
    // 点击同语义）；打开不改写引用原文
    handle.content.listen(openBtn, 'click', (event) => {
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
    } else if (entry.lastReq !== null) {
      // 在途请求：显示 loading 等回包（双容器并存不重发——notifyResult
      // 对全部配对 handle 渲染）
      this.applyDisplay(handle, 'loading', t('embed.loading'))
    } else {
      this.requestLoad(handle)
    }
  }

  /** 宿主卸载钩子（Reading 块卸载 / Live widget destroy）：保存状态、释放
   *  B 视图与资源管理器（实例状态保留在 entry 状态库） */
  unmountBlock(el: HTMLElement): void {
    const handle = this.active.get(el)
    if (!handle) {
      return
    }
    this.active.delete(el)
    handle.content.dispose()
    el.textContent = '' // 卡片 DOM（含 B 内容全量块）随宿主卸载丢弃
  }

  /** hover.result 路由（syncController 转发）：按 entry.lastReq 配对——
   *  同一 entry 的全部在场 handle（Reading 块与 Live widget 双容器并存）
   *  逐个渲染（先收集后应用：applyResult/applyError 会清空共享的 lastReq，
   *  边清边配对会漏掉同 entry 的其余容器）；已卸载的迟到回包写入缓存供
   *  重挂使用。#224 版本仲裁（P1-2 改 per-entry）：新鲜度参照 = 全库同目标
   *  已知最新版本（loaded + lastKnown——后者在 changed 失效清 loaded 后
   *  仍持有版本）；回包版本低于参照时**按命中 entry 丢弃并清其 lastReq 后
   *  自愈重发一次**（原全局早退会把同目标其他 entry 的首载回包一并丢弃且
   *  无重试，lastReq 悬挂 → 永久卡 loading；宿主读取缓存按目标失效，重发
   *  读到当前内容，版本单调保证收敛不循环——请求代次守卫之外的第二道
   *  防线） */
  notifyResult(message: HoverPreviewResult): boolean {
    let reference: number | null = null
    if (message.ok) {
      for (const other of this.entries.values()) {
        if (other.loaded !== null && other.loaded.fsPath === message.target.fsPath) {
          reference = Math.max(reference ?? 0, other.loaded.version)
        }
        if (other.lastKnown !== null && other.lastKnown.fsPath === message.target.fsPath) {
          reference = Math.max(reference ?? 0, other.lastKnown.version)
        }
      }
    }
    const stale = message.ok && reference !== null && message.version < reference
    const matched: EmbedCardHandle[] = []
    const matchedEntries = new Set<EmbedEntry>()
    for (const handle of this.active.values()) {
      if (handle.entry.lastReq !== null &&
          handle.entry.lastReq.instanceId === message.instanceId &&
          handle.entry.lastReq.reqId === message.reqId) {
        matched.push(handle)
        matchedEntries.add(handle.entry)
      }
    }
    if (matchedEntries.size > 0) {
      for (const entry of matchedEntries) {
        if (stale && entry.healReqId !== message.reqId) {
          if (message.ok) releaseRefSourceLease(this.context, message.sourceLeaseId)
          // 过期回包按 entry 丢弃：清在途配对并自愈重发一次（有已渲染内容
          // 时静默——不闪 loading；首载无内容则如实 loading）。heal 回包若
          // 仍过期（版本谱系断点）走下方终态落地，不无限重发
          entry.lastReq = null
          const first = matched.find((h) => h.entry === entry)!
          this.requestLoad(first, {
            silent: matched.some((h) => h.entry === entry && h.display === 'content'),
            heal: true,
          })
          continue
        }
        for (const handle of matched) {
          if (handle.entry !== entry) {
            continue
          }
          if (message.ok) {
            this.applyResult(handle, message)
          } else {
            this.applyError(handle, message.reason, message.anchor)
          }
        }
      }
      return true
    }
    // 卸载后在途：同配对写入缓存（重挂直接用）；过期回包只清 lastReq
    //（缓存不得写入旧版本——重挂会绕过仲裁直接渲染）
    for (const entry of this.entries.values()) {
      if (entry.lastReq !== null &&
          entry.lastReq.instanceId === message.instanceId &&
          entry.lastReq.reqId === message.reqId) {
        if (!stale && message.ok) {
          entry.loaded = {
            fsPath: message.target.fsPath,
            relPath: message.target.relPath,
            scope: message.scope.kind,
            selector: message.scope,
            version: message.version,
            text: message.text,
            range: message.range,
          }
          entry.lastKnown = { fsPath: message.target.fsPath, version: message.version }
          this.watchEntry(entry, message.sourceLeaseId)
        }
        entry.lastReq = null
        if (stale && message.ok) releaseRefSourceLease(this.context, message.sourceLeaseId)
        return true
      }
    }
    return false
  }

  /** image.result 路由：作用于在场卡片的 B 管理器（reqId 由管理器自守卫） */
  notifyImageResult(msg: { reqId: number; ok: boolean; src?: string; reason?: string }): void {
    for (const handle of this.active.values()) {
      handle.content.notifyImageResult(msg)
    }
  }

  /**
   * #224 目标失效推送路由（syncController 转发 hover.invalidated）：命中
   * loaded 目标的全部 entry（同目标多实例一致处理）。
   * - changed：清 loaded（重挂路径重载）+ 在场 handle 静默重发请求（不闪
   *   loading——旧内容保留到新回包重建，滚动位置先保存在场值）。
   * - deleted：撤下内容（清 loaded 与 B 视图 DOM、not-found 分态就地呈现）
   *   ，不无限保留旧内容；订阅保持（恢复 changed 推送可重载）。
   * - stale：读取失败分态（read-failed 文案；权限/断连不等同删除）。
   * fm 展开与滚动状态保留在 entry（有效实例状态不因失效重置）。
   */
  notifyInvalidated(message: {
    fsPath: string
    status: 'changed' | 'deleted' | 'stale'
    generation: number
  }): void {
    // P1-2（review 修复）首载在途前置处理：lastReq 在途但 loaded 与
    // watchedFsPath 皆空的 entry 拿不到下方目标匹配（目标身份要等回包才可
    // 知）——原实现被「未 watch 即 skip」排除，在途回包可能是变更前旧内容
    // 且无重发。失效推送到达时无条件重发一次（幂等读取；新 reqId 覆盖
    // lastReq，旧回包按配对守卫自然丢弃——与本次失效目标无关的在途首载
    // 顶多多一次等价读取）；卸载在途只清 lastReq（重挂路径重载）。
    for (const entry of [...this.entries.values()]) {
      if (entry.lastReq === null || entry.loaded !== null || entry.watchedFsPath !== null) {
        continue
      }
      entry.lastReq = null
      const first = [...this.active.values()].find((h) => h.entry === entry)
      if (first) {
        this.requestLoad(first)
      }
    }
    for (const entry of [...this.entries.values()]) {
      // 目标匹配：装载在场的按 loaded，deleted 已清 loaded 的按订阅记录
      //（watchedFsPath——恢复 changed 推送仍能命中）
      const entryTarget = entry.loaded?.fsPath ?? entry.watchedFsPath
      if (entryTarget !== message.fsPath || entry.watchedFsPath === null) {
        continue
      }
      // 在场滚动位置先保存（重建后恢复；离屏 entry 保留旧值）
      for (const handle of this.active.values()) {
        if (handle.entry === entry && handle.scrollEl.scrollTop > 0) {
          entry.content.scrollTop = handle.scrollEl.scrollTop
        }
      }
      entry.loaded = null
      entry.lastReq = null
      const handles = [...this.active.values()].filter((h) => h.entry === entry)
      if (message.status === 'changed') {
        // 每 entry 单笔重发（lastReq 是 entry 级共享——同 entry 的双容器
        // handle 不重复请求，回包对全部配对 handle 渲染，与首载同构）
        const first = handles[0]
        if (first) {
          this.requestLoad(first, { silent: true })
        }
        this.touchEntry(entry) // 刷新中仍是有效实例
      } else {
        const note = refErrorText(
          message.status === 'deleted' ? 'not-found' : 'read-failed',
          targetOfInner(entry.inner),
        )
        for (const handle of handles) {
          handle.content.clear()
          handle.contentEl.textContent = '' // 旧内容撤下（防 display 反转闪现）
          this.applyDisplay(handle, 'error', note)
        }
      }
    }
  }

  /** image.invalidate 路由：全部在场 B 管理器按 srcs 失效重发 */
  notifyImageInvalidate(srcs: readonly string[]): void {
    for (const handle of this.active.values()) {
      handle.content.invalidateImages(srcs)
    }
  }

  /** 手动刷新（refresh.invalidated）：全部在场 B 管理器全量失效重挂 */
  invalidateImages(): void {
    for (const handle of this.active.values()) {
      handle.content.invalidateImages()
    }
  }

  /** 限高设置热更（settings.snapshot / settings.changed）：遍历在场卡片 */
  setMaxHeight(px: number): void {
    for (const handle of this.active.values()) {
      handle.scrollEl.style.maxHeight = `${px}px`
    }
  }

  /** 观测探针（view.state.readingEmbed 的数据源；host 区分容器） */
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
        fm: fmSection ? (handle.entry.content.fmExpanded ? 'expanded' : 'collapsed') : 'none',
        maxHeightPx: Number.parseInt(handle.scrollEl.style.maxHeight, 10) || 0,
        host: handle.host,
        // #224 内容文本字符数（集成断言未保存修改推送后的刷新可见性）
        textLen: (handle.contentEl.textContent ?? '').length,
        viewStats: handle.content.getStats(),
      })
    }
    return out
  }

  /** 全部释放（syncController dispose）：卡片 DOM、B 视图与状态库 */
  dispose(): void {
    for (const el of Array.from(this.active.keys())) {
      this.unmountBlock(el)
    }
    // #224 订阅随状态库整体释放（实例订阅计数回落）
    for (const entry of this.entries.values()) {
      entry.content.dispose()
    }
    this.entries.clear()
    this.heightObserver?.disconnect()
  }

  // ---- 内部 ----

  /** LRU 触达：重插到 Map 尾部（插入序 = 淘汰序，hoverSourceFsPaths 先例） */
  private touchEntry(entry: EmbedEntry): void {
    this.entries.delete(entry.key)
    this.entries.set(entry.key, entry)
  }

  /**
   * 状态库有界淘汰（#224）：语义键条目超上限时按最近触达淘汰死键——
   * 父文档文本变更后漂移的旧键（无在场 handle、长期未挂载）。**仍有效
   * 实例不淘汰**（在场挂载或最近挂载过的 entry 位于 MRU 端；防御性跳过
   * 仍有在场 handle 的条目——视口内的实例状态不受离屏回收与淘汰影响）。
   * 被淘汰条目的目标订阅配对释放。
   */
  private evictEntriesIfNeeded(): void {
    while (this.entries.size > HOVER_REFRESH_DEFAULTS.embedEntryLimit) {
      const victim = this.entries.keys().next().value
      if (victim === undefined) {
        break
      }
      const entry = this.entries.get(victim)!
      const mounted = [...this.active.values()].some((h) => h.entry === entry)
      if (mounted) {
        // 队首仍挂载（全部条目在场的极端文档）：不淘汰有效实例，容忍
        // 超限（在场卡片数由视口窗口约束，实际上界远低于上限）
        break
      }
      this.entries.delete(victim)
      entry.content.dispose()
    }
  }

  /** #224 目标订阅登记（幂等；成功装载后调用。目标身份变化先释放旧订阅） */
  private watchEntry(entry: EmbedEntry, sourceLeaseId?: string): void {
    if (!entry.loaded) {
      return
    }
    if (entry.watchedFsPath === entry.loaded.fsPath) {
      releaseRefSourceLease(this.context, sourceLeaseId)
      return
    }
    const session = this.context.session()
    if (!session.sessionId || !session.docUri) {
      return
    }
    if (entry.watchedFsPath !== null) {
      this.sendUnwatch(entry.watchedFsPath, entry.key)
    }
    entry.watchedFsPath = entry.loaded.fsPath
    this.context.send({
      kind: 'hover.watch',
      sessionId: session.sessionId,
      docUri: session.docUri,
      fsPath: entry.watchedFsPath,
      instanceId: entry.key,
      ...(sourceLeaseId !== undefined ? { sourceLeaseId } : {}),
    })
  }

  /** #224 目标订阅释放（dispose / LRU 淘汰；幂等） */
  private unwatchEntry(entry: EmbedEntry): void {
    if (entry.watchedFsPath === null) {
      return
    }
    const fsPath = entry.watchedFsPath
    entry.watchedFsPath = null
    this.sendUnwatch(fsPath, entry.key)
  }

  /** #224 订阅释放消息出站 */
  private sendUnwatch(fsPath: string, instanceId: string): void {
    const session = this.context.session()
    if (!session.sessionId || !session.docUri) {
      return
    }
    this.context.send({
      kind: 'hover.unwatch',
      sessionId: session.sessionId,
      docUri: session.docUri,
      fsPath,
      instanceId,
    })
  }

  /** 发起装载请求（复用悬停文档访问通道；只读消息不进 edit.request）。
   *  silent = #224 变更刷新的静默重载：不切 loading 态（旧内容保留到新
   *  回包重建，无闪烁）；heal = P1-2 过期回包的自愈重发（循环防护标记） */
  private requestLoad(
    handle: EmbedCardHandle,
    opts?: { silent?: boolean; heal?: boolean },
  ): void {
    const session = this.context.session()
    if (!session.sessionId || !session.docUri) {
      // 会话未就绪：保持壳与 loading 文案（init 后视图重建触发重挂载发请求）
      this.applyDisplay(handle, 'loading', t('embed.loading'))
      return
    }
    const reqId = ++this.reqSeq
    handle.entry.lastReq = { instanceId: handle.instanceId, reqId }
    handle.entry.healReqId = opts?.heal === true ? reqId : null
    if (!opts?.silent) {
      this.applyDisplay(handle, 'loading', t('embed.loading'))
    }
    this.context.send({
      kind: 'hover.request',
      retainSource: true,
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
      selector: message.scope,
      version: message.version,
      text: message.text,
      range: message.range,
    }
    handle.entry.lastReq = null
    handle.entry.lastKnown = { fsPath: loaded.fsPath, version: loaded.version }
    this.applyLoaded(handle, loaded, message.sourceLeaseId)
  }

  /** 装载结果渲染（首载与缓存重挂共用）：B Reading 视图 + 状态恢复。
   *  #224 刷新路径（在场 handle）：滚动位置先取当前值（重挂路径 scrollEl
   *  新建为 0，保留 entry 旧值），重建后经既有 rAF 恢复；目标订阅登记 */
  private applyLoaded(handle: EmbedCardHandle, loaded: EmbedLoaded, sourceLeaseId?: string): void {
    if (handle.scrollEl.scrollTop > 0) {
      handle.entry.content.scrollTop = handle.scrollEl.scrollTop // 刷新前保存
    }
    handle.entry.loaded = loaded
    this.touchEntry(handle.entry) // LRU 触达（仍有效实例）
    handle.content.render(loaded)
    // 顶部文件名：装载后为目标根内相对路径
    const titleEl = handle.cardEl.querySelector<HTMLElement>(`.${EMBED_CARD_CLASS_NAMES.title}`)
    if (titleEl) {
      titleEl.textContent = loaded.relPath
    }
    this.applyDisplay(handle, 'content', loaded.relPath)
    // #223 布局联动：loading→content 的高度跳变立即唤醒 CM6 测量（Live
    // 挂载的行高/block widget 高度缓存）；后续异步变化（图片晚到）由
    // ResizeObserver 兜底通知
    this.context.requestMeasure?.()
    // 滚动位置恢复（重挂路径；首载 scrollTop 为 0 无操作）。恢复必须延迟
    // 一帧：宿主元素可能尚未进 DOM（Reading 侧块挂载钩子先于 append、
    // Live 侧 widget toDOM 后续才插入），此刻 scrollEl 无布局（scrollHeight
    // 为 0），同步赋值会被浏览器钳到 0——下一帧宿主已入 DOM，布局可用。
    // 刷新路径（在场 handle）本可同步恢复，但内容重建后的布局重排与
    // rAF 同帧完成，统一走延迟一帧保持两路径一致
    handle.content.restoreScroll(true)
    // #224 目标订阅（成功装载后；幂等——目标身份变化时先释放旧订阅）
    this.watchEntry(handle.entry, sourceLeaseId)
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
    // 错误分态挂错误修饰类（主题错误色），loading/content 摘除
    handle.stateEl.classList.toggle(EMBED_CARD_CLASS_NAMES.stateError, display === 'error')
    if (display === 'content') {
      handle.stateEl.style.display = 'none'
      handle.scrollEl.style.display = ''
      // loading 期间外层滚动区无视口，内容只放轻量 spacer；显示后
      // 同步建立首屏窗口，保证紧随其后的 view.state 读到实际内容。
      handle.content.updateNow()
    } else {
      handle.stateEl.style.display = ''
      handle.scrollEl.style.display = 'none'
      handle.stateEl.textContent = note
    }
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
