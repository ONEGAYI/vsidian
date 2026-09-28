// webview 图片资源管理器（工单 #10）：双视图共用的图片生命周期状态机。
//
// 状态机（槽位级，槽位 = 阅读视图的 <img> 或 live 视图 widget 的容器 span）：
//   loading（占位）→ loaded（宿主/直连 src 应用且 img load 事件确认）
//                  → error（宿主解析失败或 img 加载失败；点击可重试）
//
// 通道分工：
// - http/https 图源（deps.isDirectSrc）：不经宿主，直接应用原始 src——
//   可加载性由 webview CSP 决定（https 放行、http 被拦 → error 态可重试）
// - 其余（工作区相对路径）：经宿主 image.request / image.result 通道解析为
//   webview 资源 URI（asWebviewUri；本地与远程工作区同通道）
//
// 释放（「离开视口卸载释放节点」）：
// - detach/detachWithin：解绑监听、清空 img src（释放解码位图）、状态归零、
//   槽位从条目移除；条目无槽位时整体回收（解析结果字符串一并释放）
// - sweep：CM6 widget 无销毁回调——以 isConnected 兜底清理脱离文档的槽位
//
// 本层不触碰编辑器状态与文档文本（图片是纯显示资源，零写回契约的使用方
// 由 syncController 保证；重试点击会阻断冒泡以免触发外层链接导航）。
import { t } from '../shared/i18n'

/** 槽位状态（stable class/data 入口，样式见 main.css 与选择器映射表） */
export type ImageSlotState = 'loading' | 'loaded' | 'error'

export const IMAGE_CLASS_NAMES = {
  /** 图片槽位基类（阅读 img 与 live widget 容器共用） */
  image: 'vsidian-image',
  /** 状态修饰类（与 data-vsidian-img-state 同步） */
  state: (s: ImageSlotState) => `vsidian-image-${s}`,
  /** 失败态细分（#201，叠加在 error 基类上）：明确删除（磁盘正证据 missing） */
  notfound: 'vsidian-image-notfound',
  /** 失败态细分（#201）：不可访问（SSH 断连/权限错误，不冒充找不到） */
  unreachable: 'vsidian-image-unreachable',
} as const

export interface ImageManagerDeps {
  /** 远程直连图源判定（http/https）：true 时应用原始 src，不经宿主 */
  isDirectSrc(src: string): boolean
  /** 发起宿主解析请求（非直连图源；reqId 由管理器分配并自增） */
  requestHost(src: string, reqId: number): void
  /** 首个非直连条目建立（#201 周期核验调度启动数据源） */
  onBecomeActive?(): void
  /** 非直连条目全部回收（#201「无活跃槽位则停止计时」） */
  onBecomeIdle?(): void
}

/** 图源规范化：容错 percent-decode 一次。CommonMark 语义下链接目标就是
 *  解码值——live 源文原样（部分编码）与 markdown-it 全编码形态由此归一为
 *  同一逻辑图源（去重请求、同键缓存）；非法转义序列按原样保留。 */
function normalizeImgSrc(src: string): string {
  try {
    return decodeURIComponent(src)
  } catch {
    return src
  }
}

/** 宿主 image.result 消息的数据形态（协议层已校验） */
export interface ImageResultPayload {
  reqId: number
  ok: boolean
  src?: string
  reason?: string
  detail?: string
}

/** 活跃图源上报条目（image.verify 的数据源；直连图源除外） */
export interface ActiveImageEntry {
  src: string
  state: 'loaded' | 'loading' | 'error'
  reason?: string
  /** 已应用的可加载地址（loading/error 时缺省） */
  appliedSrc?: string
}

interface ImageEntry {
  status: 'pending' | 'ok' | 'error'
  /** 解析成功后的可加载地址（直连图源为原始 src） */
  src?: string
  reason?: string
  reqId?: number
  /** 直连图源（http/https 外链）标记：不参与失效/核验管线（#201 边界） */
  direct?: boolean
  waiters: Set<HTMLElement>
}

interface SlotRecord {
  rawSrc: string
  entry: ImageEntry
  /** 实际承载图片的元素（阅读 = 槽位自身；live = render 回调创建的 img） */
  img: HTMLImageElement | null
  render?: (slot: HTMLElement, src: string) => HTMLImageElement
  onLoad: (event: Event) => void
  onError: (event: Event) => void
  onClick: (event: MouseEvent) => void
}

export class ImageResourceManager {
  private readonly deps: ImageManagerDeps
  private readonly slots = new Map<HTMLElement, SlotRecord>()
  private readonly entries = new Map<string, ImageEntry>()
  private nextReqId = 0
  /** 活跃度通知状态（防抖：状态翻转才回调） */
  private activityNotified = false

  constructor(deps: ImageManagerDeps) {
    this.deps = deps
  }

  /**
   * 绑定一个图片槽位。阅读视图：槽位即 <img>（原 src 已剥离），解析成功
   * 后直接写回 src 属性。live 视图：传 render 回调构建内部 <img>
   * （widget 重建时由回调恢复），返回值用于监听 load/error。
   */
  attach(
    slot: HTMLElement,
    rawSrc: string,
    render?: (slot: HTMLElement, src: string) => HTMLImageElement,
  ): void {
    if (this.slots.has(slot)) {
      return
    }
    rawSrc = normalizeImgSrc(rawSrc)
    slot.classList.add(IMAGE_CLASS_NAMES.image)
    slot.dataset['vsidianImgSrc'] = rawSrc
    let entry = this.entries.get(rawSrc)
    if (!entry) {
      if (this.deps.isDirectSrc(rawSrc)) {
        entry = { status: 'ok', src: rawSrc, direct: true, waiters: new Set() }
        this.entries.set(rawSrc, entry)
      } else {
        const reqId = ++this.nextReqId
        entry = { status: 'pending', reqId, direct: false, waiters: new Set() }
        // 先入表再发请求：同步实现的 requestHost（测试直驱）产出的结果
        // 才能路由回本条目
        this.entries.set(rawSrc, entry)
        this.notifyActivity() // 首个非直连条目：启动周期核验（#201）
        this.deps.requestHost(rawSrc, reqId)
      }
    }
    const record: SlotRecord = {
      rawSrc,
      entry,
      img: null,
      render,
      // #201 代次守卫：load/error 只对「当前承载图片的元素」生效（事件目标
      // 不是 record.img 时为旧世代在途事件——阅读槽位 img 即 slot、监听与
      // 槽位同生命周期，invalidate 撤下旧图后 slot 上迟到的旧事件须忽略）
      onLoad: (event) => {
        if (event.currentTarget === record.img) {
          this.setSlotState(slot, 'loaded')
        }
      },
      onError: (event) => {
        if (event.currentTarget === record.img) {
          this.setSlotState(slot, 'error', 'load-failed')
        }
      },
      onClick: (event) => this.handleRetryClick(slot, event),
    }
    this.slots.set(slot, record)
    entry.waiters.add(slot)
    slot.addEventListener('load', record.onLoad)
    slot.addEventListener('error', record.onError)
    slot.addEventListener('click', record.onClick)
    if (entry.status === 'ok') {
      this.applyToSlot(slot, record, entry.src!)
    } else if (entry.status === 'error') {
      this.setSlotState(slot, 'error', entry.reason)
    } else {
      this.setSlotState(slot, 'loading')
    }
  }

  /** 解绑并释放一个槽位 */
  detach(slot: HTMLElement): void {
    const record = this.slots.get(slot)
    if (!record) {
      return
    }
    this.slots.delete(slot)
    record.entry.waiters.delete(slot)
    slot.removeEventListener('load', record.onLoad)
    slot.removeEventListener('error', record.onError)
    slot.removeEventListener('click', record.onClick)
    this.releaseImages(record)
    delete slot.dataset['vsidianImgState']
    slot.classList.remove(
      IMAGE_CLASS_NAMES.state('loading'),
      IMAGE_CLASS_NAMES.state('loaded'),
      IMAGE_CLASS_NAMES.state('error'),
      IMAGE_CLASS_NAMES.notfound,
      IMAGE_CLASS_NAMES.unreachable,
    )
    if (record.entry.waiters.size === 0) {
      // 条目回收：解析结果字符串一并释放（回视口时重新请求）
      this.entries.delete(record.rawSrc)
      this.notifyActivity() // 非直连条目可能归零：停止周期核验（#201）
    }
  }

  /** 释放容器（阅读块卸载/容器重建）内全部图片槽位 */
  detachWithin(root: HTMLElement): void {
    for (const slot of [...this.slots.keys()]) {
      if (root === slot || root.contains(slot)) {
        this.detach(slot)
      }
    }
  }

  /** 宿主 image.result 路由（协议层已校验的消息体） */
  handleResult(msg: ImageResultPayload): void {
    let matched: ImageEntry | undefined
    for (const entry of this.entries.values()) {
      if (entry.status === 'pending' && entry.reqId === msg.reqId) {
        matched = entry
        break
      }
    }
    if (!matched) {
      return // 未知/迟到 reqId：无在途条目，丢弃（#201 代次守卫）
    }
    if (msg.ok && typeof msg.src === 'string') {
      matched.status = 'ok'
      matched.src = msg.src
      for (const slot of matched.waiters) {
        const record = this.slots.get(slot)
        if (record) {
          this.applyToSlot(slot, record, msg.src!)
        }
      }
      return
    }
    matched.status = 'error'
    matched.reason = msg.reason ?? 'read-error'
    for (const slot of matched.waiters) {
      this.setSlotState(slot, 'error', matched.reason)
    }
  }

  /**
   * 宿主失效通知（#201 image.invalidate）：作废图源条目并重发请求。
   * 每个槽位撤下旧图（释放解码位图）回到 loading；旧 reqId 的在途结果
   * 因条目重建（新 reqId）被丢弃——旧版本在途响应与 load/error 事件都
   * 不能复活旧图或覆盖新状态。直连图源（外链）与未挂载图源忽略。
   */
  invalidate(srcs: readonly string[]): void {
    for (const raw of srcs) {
      this.rebuildEntry(normalizeImgSrc(raw))
    }
  }

  /**
   * 活跃图源上报（#201 image.verify 的数据源）：非直连条目的
   * src/呈现态/原因/已应用地址。条目存在 ⇔ 有活跃槽位（无 waiter 的条目
   * 在 detach 时已回收）——空列表即「无活跃槽位」，调度器据此停止计时。
   */
  activeEntries(): ActiveImageEntry[] {
    const out: ActiveImageEntry[] = []
    for (const [src, entry] of this.entries) {
      if (entry.direct) {
        continue
      }
      const slot = entry.waiters.values().next().value as HTMLElement | undefined
      const slotState = slot?.dataset['vsidianImgState']
      const state: ActiveImageEntry['state'] =
        slotState === 'loaded' || slotState === 'error' ? slotState : 'loading'
      out.push({
        src,
        state,
        reason: entry.status === 'error' ? entry.reason : undefined,
        appliedSrc: entry.status === 'ok' ? entry.src : undefined,
      })
    }
    return out
  }

  /** 清理已脱离文档的槽位（CM6 widget 移出视口无销毁回调的兜底）。
   *  只清理 live 视图槽位（attach 时带 render 回调者）：阅读视图槽位的
   *  生命周期由块挂载/卸载钩子显式管理，且 jsdom 测试环境容器可不在
   *  文档树内（isConnected 不可作为阅读槽位的存活判据） */
  sweep(): void {
    for (const slot of [...this.slots.keys()]) {
      const record = this.slots.get(slot)
      if (record && record.render !== undefined && !slot.isConnected) {
        this.detach(slot)
      }
    }
  }

  /** 状态计数（view.state 的 imageStates 观测数据源） */
  getStates(): { loading: number; loaded: number; error: number } {
    const out = { loading: 0, loaded: 0, error: 0 }
    for (const slot of this.slots.keys()) {
      const s = slot.dataset['vsidianImgState']
      if (s === 'loading' || s === 'loaded' || s === 'error') {
        out[s] += 1
      }
    }
    return out
  }

  dispose(): void {
    for (const slot of [...this.slots.keys()]) {
      this.detach(slot)
    }
    this.entries.clear()
    this.notifyActivity()
  }

  // ---- 内部 ----

  /** 活跃度通知（防抖语义：状态翻转才回调；重建/重试不改变计数不触发） */
  private notifyActivity(): void {
    let has = false
    for (const entry of this.entries.values()) {
      if (!entry.direct) {
        has = true
        break
      }
    }
    if (has && !this.activityNotified) {
      this.activityNotified = true
      this.deps.onBecomeActive?.()
    } else if (!has && this.activityNotified) {
      this.activityNotified = false
      this.deps.onBecomeIdle?.()
    }
  }

  /**
   * 作废并重建一个非直连条目（invalidate 与 error 重试共用的重建路径）：
   * 槽位不解绑（click/load/error 监听保留），旧 img 释放、槽位回 loading，
   * 新 reqId 重发请求。旧 reqId 的迟到结果匹配不到任何 pending 条目，
   * 自然丢弃。
   */
  private rebuildEntry(rawSrc: string): ImageEntry | null {
    const old = this.entries.get(rawSrc)
    if (!old || old.direct) {
      return null
    }
    this.entries.delete(rawSrc)
    const reqId = ++this.nextReqId
    const fresh: ImageEntry = { status: 'pending', reqId, waiters: old.waiters, direct: false }
    for (const slot of [...fresh.waiters]) {
      const record = this.slots.get(slot)
      if (!record) {
        fresh.waiters.delete(slot)
        continue
      }
      record.entry = fresh
      this.releaseImages(record)
      this.setSlotState(slot, 'loading')
    }
    if (fresh.waiters.size === 0) {
      // 重建瞬间槽位已全部离场：直接回收（notifyActivity 保持计数一致）
      this.entries.delete(rawSrc)
      this.notifyActivity()
      return null
    }
    this.entries.set(rawSrc, fresh)
    this.deps.requestHost(rawSrc, reqId)
    return fresh
  }

  private applyToSlot(slot: HTMLElement, record: SlotRecord, src: string): void {
    this.releaseImages(record)
    if (record.render) {
      const img = record.render(slot, src)
      record.img = img
      img.addEventListener('load', record.onLoad)
      img.addEventListener('error', record.onError)
    } else if (slot instanceof HTMLImageElement) {
      record.img = slot
      slot.setAttribute('src', src)
    }
    this.setSlotState(slot, 'loading') // src 已应用，等 img load/error 确认
  }

  private releaseImages(record: SlotRecord): void {
    if (record.img) {
      // live 槽位（有 render 回调）：img 是回调创建的内部元素，load/error
      // 监听随 img 动态绑定，释放时解绑。阅读槽位的 img 即 slot 本身，
      // load/error 监听绑在 slot 上与槽位同生命周期（attach/detach 管理），
      // 这里只清 src——否则重建/重试后再应用 src 会永远停在 loading
      // （#201 修复：原实现无条件解绑，阅读槽位 invalidate 后监听丢失）
      if (record.render) {
        record.img.removeEventListener('load', record.onLoad)
        record.img.removeEventListener('error', record.onError)
      }
      // 清空 src：释放解码位图（离开视口即不再占用内存）
      record.img.removeAttribute('src')
      record.img = null
    }
  }

  private setSlotState(slot: HTMLElement, state: ImageSlotState, reason?: string): void {
    slot.dataset['vsidianImgState'] = state
    for (const s of ['loading', 'loaded', 'error'] as const) {
      slot.classList.toggle(IMAGE_CLASS_NAMES.state(s), s === state)
    }
    // #201 失败态细分：明确删除与不可访问在 error 基类上叠加修饰类，
    // 片段与测试可按细分态精确呈现/断言（不冒充彼此）
    slot.classList.toggle(
      IMAGE_CLASS_NAMES.notfound,
      state === 'error' && reason === 'not-found',
    )
    slot.classList.toggle(
      IMAGE_CLASS_NAMES.unreachable,
      state === 'error' && reason === 'inaccessible',
    )
    if (state === 'error') {
      slot.dataset['vsidianImgReason'] = reason ?? 'unknown'
      slot.title = imageErrorTitle(reason)
    } else {
      delete slot.dataset['vsidianImgReason']
    }
  }

  private handleRetryClick(slot: HTMLElement, event: MouseEvent): void {
    const record = this.slots.get(slot)
    if (!record || slot.dataset['vsidianImgState'] !== 'error') {
      return
    }
    // 阻断冒泡：错误态重试不得触发外层 <a> 导航或容器级点击语义
    event.stopPropagation()
    event.preventDefault()
    this.setSlotState(slot, 'loading')
    const entry = record.entry
    if (entry.status === 'ok') {
      // 解析成功但加载失败（坏数据/网络）：重新应用同一地址
      this.applyToSlot(slot, record, entry.src!)
      return
    }
    if (entry.status === 'error') {
      // 宿主解析失败：条目作废重建发起新请求（同 src 的其他槽位一并刷新；
      // 旧 reqId 结果因重建被丢弃——与 #201 invalidate 同一代次守卫）
      this.rebuildEntry(record.rawSrc)
    }
    // pending：在途请求到达后自然迁移，不重复发起
  }
}

/** 失败态提示文案：细分原因专属词条，其余沿用通用失败词条 */
function imageErrorTitle(reason: string | undefined): string {
  if (reason === 'not-found') {
    return t('decor.imageNotFound')
  }
  if (reason === 'inaccessible') {
    return t('decor.imageInaccessible')
  }
  return t('decor.imageError', { reason: reason ?? t('decor.unknownReason') })
}
