// T05（#544）附加组件只读引用浮窗请求运行时（webview 页面级）。
//
// 职责：SDK refViews 面的操作后端——来源解析（views 注册表实例 → 目标
// fsPath）、请求形状与触发位置校验、单页单浮窗仲裁下的请求簿记、本次
// 请求关闭句柄与组件代次释放。浮窗本体（几何/互斥/保活/Esc/键盘焦点/
// 错误视图/watch 与租约）全部复用 hoverPopup 既有链路——本模块不建第二
// 套浮窗，只把组件请求接进现有入口（规格 §5：平台按现有 hoverPopup
// Geometry 摆放、沿用 popupMutex 与移出延迟关闭）。
//
// T06（#545）组件容器嵌入挂载同在此运行时（规格 §6）：容器归属校验、
// 同容器重复挂载仲裁、引用子根生命周期（句柄释放/容器脱树观测/组件停用
// 整组释放）与首结局 promise 簿记；卡片本体（装载/watch/预算/递归只读）
// 复用 EmbedCardManager 既有链路经 mountEmbedCard 端口接入。
//
// T06 接缝：目标合成（shared/addonRefViews 的 buildAddonRefHoverTarget）与
// 来源覆盖（addonSource）是浮窗与嵌入共用的内部链路——本模块的端口面
// （resolveSource/openPopup/mountEmbedCard）保持无卡片私有语义。
import type {
  AddonRefEmbedOutcome,
  AddonRefEmbedRequest,
  AddonRefPopupOutcome,
  AddonRefPopupRequest,
} from '../shared/addonRefViews'
import {
  buildAddonRefHoverTarget,
  isAddonRefEmbedRequest,
  isAddonRefPopupRequest,
} from '../shared/addonRefViews'
import type { HoverPreviewFailReason } from '../shared/protocol'

/** 浮窗结局回调（hoverPopup 内部驱动；instanceId 由 open 返回值先行给出）：
 *  - content：内容装载成功（首载；刷新重放不重复回调）；
 *  - error：目标解析/读取/锚点失败（浮窗就地显示真实错误分态）；
 *  - closed：装载中被关闭（新请求替换/移出/域失效/Esc/停用/页面释放——
 *    统一终结为 view-disposed，不区分关闭发起方） */
export interface AddonRefPopupSettle {
  phase: 'content' | 'error' | 'closed'
  reason?: HoverPreviewFailReason
}

/** 来源解析结果：main = 面板主正文（宿主按面板文档解析）；embed/hover =
 * 引用目标（fsPath 为注册表登记的目标身份，宿主按已送达目标校验） */
export type AddonRefSourceResolution =
  | { viewType: 'main' }
  | { viewType: 'embed' | 'hover'; fsPath: string }
  | undefined

/** T06（#545）嵌入挂载的卡片端口输入（生产由 main.ts/syncController 组装
 *  RefSourceContext 后经 EmbedCardManager.mountCardInto 只读挂载） */
export interface AddonRefEmbedCardInput {
  /** 平台管理的引用子根（runtime 创建并挂进组件容器；释放凭据） */
  subRoot: HTMLElement
  /** 本次挂载的唯一 occurrence（RefSourceContext.occurrence / treeId——
   *  同目标多处挂载各自独立实例的键） */
  occurrence: string
  /** 双链目标原文（buildAddonRefHoverTarget 产物——走既有解析链） */
  targetText: string
  /** 来源文档身份（main 来源传空串——生产接线按面板文档补齐） */
  sourceDocUri: string
  /** 来源覆盖（随 hover.request 出站；与浮窗请求同链路） */
  addonSource: { instanceId: string; sourceFsPath: string }
  /** 首次装载结局（content / 真实失败原因；一次性） */
  onFirstOutcome: (outcome: AddonRefEmbedLoadOutcome) => void
}

/** T06 首次装载结局（EmbedAddonFirstOutcome 的端口形态——运行时不依赖
 *  embedCard 模块类型） */
export type AddonRefEmbedLoadOutcome = { ok: true } | { ok: false; reason: HoverPreviewFailReason }

/** 运行时端口（生产由 main.ts 装配：views 注册表 + hoverPopup 入口 +
 *  EmbedCardManager 只读挂载端口 + 容器归属判定） */
export interface AddonRefViewsRuntimePorts {
  /** 来源实例解析（undefined = 实例不在场） */
  resolveSource(instanceId: string): AddonRefSourceResolution
  /** 打开浮窗：成功返回浮窗实例身份（instanceId），失败（页面会话缺失）
   *  返回 null。onSettled 由浮窗模块在结局落定时回调（至多一次） */
  openPopup(input: {
    trigger: HTMLElement
    spec: { target: string; sourceStart: number; sourceEnd: number }
    keyboard: boolean
    addonSource: { instanceId: string; sourceFsPath: string }
    onSettled: (settle: AddonRefPopupSettle) => void
  }): string | null
  /** 当前浮窗实例身份（null = 无浮窗） */
  currentPopupInstanceId(): string | null
  /** 关闭当前浮窗（幂等；一切关闭路径统一收口） */
  closePopup(): void
  /** T06：容器归属（本组件已取得的面板内容根或渲染内容根，可为其后代） */
  ownsContainer(addonId: string, el: HTMLElement): boolean
  /** T06：只读挂载引用子根（false = 页面会话缺失——未挂载，调用方撤下
   *  子根；首结局经 onFirstOutcome 一次性回调，pending 被释放则不再回调） */
  mountEmbedCard(input: AddonRefEmbedCardInput): boolean
  /** T06：整组释放一次挂载（卸载卡片 + 订阅/预算/实例彻底终结；幂等） */
  releaseEmbedCard(subRoot: HTMLElement): void
}

interface RefRequestRecord {
  addonId: string
  generation: number
  source: string
  /** 浮窗实例身份（openPopup 成功即回填——句柄活性与代次释放的判定锚） */
  instanceId: string | null
  phase: 'pending' | 'content' | 'error' | 'closed'
  settle: (outcome: AddonRefPopupOutcome) => void
}

/** T06 嵌入挂载簿记（容器 → 挂载一一对应；phase 终结后条目离场） */
interface RefEmbedRecord {
  addonId: string
  generation: number
  /** 组件容器（重复挂载仲裁键——同一位置未释放前只属一次有效挂载） */
  container: HTMLElement
  /** 平台管理的引用子根（挂进容器；释放凭据与脱树观测锚） */
  subRoot: HTMLElement
  phase: 'pending' | 'content' | 'error' | 'terminated'
  settle: ((outcome: AddonRefEmbedOutcome) => void) | null
}

/**
 * 页面级运行时（main.ts 构造一份，注入装载器 env.addonRefViews——SDK
 * refViews 面的后端）。组件身份与代次由装载器注入 requestPopup 参数；
 * 本运行时按 addonId 记账，releaseAddon 随组件停用/故障/代次终结关闭其
 * 拥有的浮窗（重复释放无害）。
 */
export class AddonRefViewsRuntime {
  private readonly ports: AddonRefViewsRuntimePorts
  /** 最新请求（请求替换仲裁的簿记锚；旧句柄只认自己的 instanceId） */
  private current: RefRequestRecord | null = null
  /** T06 活跃嵌入挂载（容器 → 记录；释放即离场——重复挂载仲裁键） */
  private readonly embeds = new Map<HTMLElement, RefEmbedRecord>()
  /** T06 挂载 occurrence 序（同目标多处挂载各自独立实例） */
  private embedSeq = 0
  /** T06 子根脱树观测（文档级 childList/subtree——组件容器/外层面板/
   *  渲染根移除都收敛为子根在树性变化；与 hoverPopup 锚点观测同款）。
   *  仅挂载在场期间观测（有挂载才连接——常驻文档级观测对大文档编辑
   *  是无谓开销；全部释放即断开） */
  private readonly detachObserver: MutationObserver | null =
    typeof MutationObserver === 'function' ? new MutationObserver(() => this.sweepDetachedEmbeds()) : null

  constructor(ports: AddonRefViewsRuntimePorts) {
    this.ports = ports
  }

  /** 页面/测试收尾：断开观测（挂载经 releaseAddon 释放，此处只回收观测
   *  本身——页面级运行时随页面存活，生产不显式调用） */
  dispose(): void {
    this.detachObserver?.disconnect()
  }

  private ensureEmbedObserver(): void {
    if (this.detachObserver !== null && this.embeds.size > 0) {
      this.detachObserver.observe(document.documentElement ?? document, { childList: true, subtree: true })
    }
  }

  requestPopup(addonId: string, generation: number, request: AddonRefPopupRequest): Promise<AddonRefPopupOutcome> {
    return new Promise((resolve) => {
      // 形状与触发位置：非法即普通拒绝（invalid-request），不创建浮窗、
      // 不猜测另一处位置（规格 §5.1——连触发位置都无效的请求不建空浮窗）
      if (!isAddonRefPopupRequest(request) ||
        !(request.trigger instanceof HTMLElement) || request.trigger.ownerDocument !== document || !request.trigger.isConnected) {
        resolve({ ok: false, reason: 'invalid-request' })
        return
      }
      const rect = request.trigger.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) {
        resolve({ ok: false, reason: 'invalid-request' })
        return
      }
      const targetText = buildAddonRefHoverTarget(request.target)
      if (targetText === null) {
        resolve({ ok: false, reason: 'invalid-request' })
        return
      }
      // 来源实例：不在场（未注册/已销毁）→ view-disposed（规格 §7：来源
      // 失效的迟到/无效请求拒收）
      const source = this.ports.resolveSource(request.source)
      if (source === undefined) {
        resolve({ ok: false, reason: 'view-disposed' })
        return
      }
      const record: RefRequestRecord = {
        addonId,
        generation,
        source: request.source,
        instanceId: null,
        phase: 'pending',
        settle: resolve,
      }
      // 先记账再开浮窗：openPopup 内部替换旧浮窗会同步触发旧请求的
      // closed 结局（applySettle 按传入记录定位，不依赖 current）
      this.current = record
      const instanceId = this.ports.openPopup({
        trigger: request.trigger,
        spec: { target: targetText, sourceStart: 0, sourceEnd: 0 },
        keyboard: request.keyboard === true,
        addonSource: {
          instanceId: request.source,
          sourceFsPath: source.viewType === 'main' ? '' : source.fsPath,
        },
        onSettled: (settle) => this.applySettle(record, settle),
      })
      if (instanceId === null) {
        // 页面会话缺失（未 init/已 dispose）：浮窗未创建
        if (this.current === record) {
          this.current = null
        }
        resolve({ ok: false, reason: 'view-disposed' })
        return
      }
      record.instanceId = instanceId
    })
  }

  /** 组件停用/故障/代次终结：关闭该组件拥有的浮窗（浮窗已换主或已关时
   *  不误关——按当前浮窗实例身份比对；重复释放无害）并整组释放其嵌入
   *  挂载（含错误分态挂载——组件停用后不滞留） */
  releaseAddon(addonId: string, generation?: number): void {
    const record = this.current
    if (record && record.addonId === addonId && (generation === undefined || record.generation === generation) && record.instanceId !== null &&
      this.ports.currentPopupInstanceId() === record.instanceId) {
      this.ports.closePopup()
    }
    for (const embed of [...this.embeds.values()]) {
      if (embed.addonId === addonId && (generation === undefined || embed.generation === generation)) {
        this.releaseEmbedRecord(embed)
      }
    }
  }

  /** 来源视图销毁时结束其引用请求；平台自身的其他浮窗保持原生命周期。
   *  T06 嵌入挂载不随来源实例销毁释放（规格 §6 的释放触发不含来源关闭——
   *  数据订阅按 fsPath 绑定，目标身份在来源视图销毁后仍然有效） */
  releaseSource(instanceId: string): void {
    const record = this.current
    if (record?.source === instanceId && record.instanceId !== null &&
      this.ports.currentPopupInstanceId() === record.instanceId) {
      this.ports.closePopup()
    }
  }

  /**
   * T06（#545）组件容器嵌入挂载（规格 §6）：容器归属与在树性校验 → 同
   * 容器重复挂载仲裁 → 创建平台管理的引用子根并经端口只读挂载。promise
   * 在首次装载结局落定时兑现（content → 句柄；目标失败 → 真实原因，子根
   * 留在场以错误分态显示随组释放）；挂载在结局前被释放 → view-disposed。
   */
  mountEmbed(addonId: string, generation: number, request: AddonRefEmbedRequest): Promise<AddonRefEmbedOutcome> {
    return new Promise((resolve) => {
      // 形状/在树性：非法即普通拒绝（不建子根）
      if (!isAddonRefEmbedRequest(request) ||
        !(request.container instanceof HTMLElement) ||
        request.container.ownerDocument !== document || !request.container.isConnected) {
        resolve({ ok: false, reason: 'invalid-request' })
        return
      }
      // 容器归属：仅本组件已取得的面板内容根/渲染内容根（可为其后代）；
      // 平台管理的引用子根内容不是组件容器空间（嵌套挂载拒绝）
      if (!this.ports.ownsContainer(addonId, request.container) ||
        this.isWithinEmbedSubRoot(request.container)) {
        resolve({ ok: false, reason: 'invalid-request' })
        return
      }
      const targetText = buildAddonRefHoverTarget(request.target)
      if (targetText === null) {
        resolve({ ok: false, reason: 'invalid-request' })
        return
      }
      // 来源实例：不在场（未注册/已销毁）→ view-disposed
      const source = this.ports.resolveSource(request.source)
      if (source === undefined) {
        resolve({ ok: false, reason: 'view-disposed' })
        return
      }
      // 重复挂载仲裁：容器已被有效挂载占用（含错误分态）——先释放旧实例
      this.sweepDetachedEmbeds()
      if (this.embeds.has(request.container)) {
        resolve({ ok: false, reason: 'duplicate-mount' })
        return
      }
      const subRoot = document.createElement('div')
      const record: RefEmbedRecord = {
        addonId,
        generation,
        container: request.container,
        subRoot,
        phase: 'pending',
        settle: resolve,
      }
      this.embeds.set(request.container, record)
      this.ensureEmbedObserver()
      request.container.appendChild(subRoot)
      const mounted = this.ports.mountEmbedCard({
        subRoot,
        occurrence: `addon-ref-${++this.embedSeq}`,
        targetText,
        sourceDocUri: source.viewType === 'main' ? '' : source.fsPath,
        addonSource: {
          instanceId: request.source,
          sourceFsPath: source.viewType === 'main' ? '' : source.fsPath,
        },
        onFirstOutcome: (outcome) => this.applyEmbedOutcome(record, outcome),
      })
      if (!mounted) {
        // 页面会话缺失（未 init/已 dispose）：撤下子根不留半装配（T05 浮窗
        // 同口径 view-disposed；容器不被占用，可立即重试）
        this.embeds.delete(request.container)
        subRoot.remove()
        resolve({ ok: false, reason: 'view-disposed' })
      }
    })
  }

  /** 首次装载结局：content 兑现句柄；error 兑现真实原因（子根留在场随组
   *  释放）；已终结（释放先于结局）不改变结果 */
  private applyEmbedOutcome(record: RefEmbedRecord, outcome: AddonRefEmbedLoadOutcome): void {
    if (record.phase !== 'pending' || record.settle === null) {
      return
    }
    if (outcome.ok) {
      record.phase = 'content'
      const handle = this.makeEmbedHandle(record)
      record.settle({ ok: true, handle })
      record.settle = null
      return
    }
    record.phase = 'error'
    record.settle({ ok: false, reason: outcome.reason })
    record.settle = null
  }

  /** 整组释放一次挂载（句柄释放/组件停用/页面结束共用；幂等）：端口彻底
   *  终结（卡片/订阅/预算）+ 子根撤下 + pending promise 以 view-disposed
   *  终结（迟到结局不再兑现） */
  private releaseEmbedRecord(record: RefEmbedRecord): void {
    if (record.phase === 'terminated') {
      return
    }
    record.phase = 'terminated'
    if (this.embeds.get(record.container) === record) {
      this.embeds.delete(record.container)
    }
    if (this.embeds.size === 0) {
      this.detachObserver?.disconnect()
    }
    this.ports.releaseEmbedCard(record.subRoot)
    record.subRoot.remove()
    if (record.settle !== null) {
      record.settle({ ok: false, reason: 'view-disposed' })
      record.settle = null
    }
  }

  /** 子根脱树回收（MutationObserver 批量复核 + 查询/挂载前惰性复核）：
   *  容器/外层面板/渲染根卸载或组件移除子根都收敛为 subRoot 在树性变化 */
  private sweepDetachedEmbeds(): void {
    for (const embed of [...this.embeds.values()]) {
      if (!embed.subRoot.isConnected) {
        this.releaseEmbedRecord(embed)
      }
    }
  }

  /** 容器是否落在平台管理的引用子根内（引用内容不是组件容器空间） */
  private isWithinEmbedSubRoot(el: HTMLElement): boolean {
    for (const embed of this.embeds.values()) {
      if (embed.subRoot === el || embed.subRoot.contains(el)) {
        return true
      }
    }
    return false
  }

  private makeEmbedHandle(record: RefEmbedRecord): { release(): boolean; isActive(): boolean } {
    return {
      release: () => {
        if (record.phase === 'terminated') {
          return false
        }
        // 惰性复核：子根可能已被移除（观测未触发前查询）
        if (!record.subRoot.isConnected) {
          this.releaseEmbedRecord(record)
          return false
        }
        this.releaseEmbedRecord(record)
        return true
      },
      isActive: () => {
        if (record.phase === 'terminated') {
          return false
        }
        if (!record.subRoot.isConnected) {
          this.releaseEmbedRecord(record)
          return false
        }
        return true
      },
    }
  }

  private applySettle(record: RefRequestRecord, settle: AddonRefPopupSettle): void {
    // 迟到/重复结局幂等：首落定后不再改变结果（迟到回包不重开浮窗的
    // 簿记侧对应）
    if (record.phase !== 'pending') {
      return
    }
    record.phase = settle.phase
    if (settle.phase === 'content') {
      record.settle({ ok: true, handle: this.makeHandle(record) })
      return
    }
    if (settle.phase === 'error') {
      record.settle({ ok: false, reason: settle.reason ?? 'read-failed' })
      return
    }
    if (this.current === record) {
      this.current = null
    }
    // closed：装载中被关闭（替换/移出/域失效/Esc/停用/页面释放）——
    // 统一 view-disposed（规格 §7 的终结口径）
    record.settle({ ok: false, reason: 'view-disposed' })
  }

  private isRecordActive(record: RefRequestRecord): boolean {
    if (record.instanceId === null || (record.phase !== 'pending' && record.phase !== 'content')) {
      return false
    }
    return this.ports.currentPopupInstanceId() === record.instanceId
  }

  private makeHandle(record: RefRequestRecord): { close(): boolean; isActive(): boolean } {
    return {
      close: () => {
        if (!this.isRecordActive(record)) {
          return false
        }
        this.ports.closePopup()
        return true
      },
      isActive: () => this.isRecordActive(record),
    }
  }
}
