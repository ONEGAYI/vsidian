// T05（#544）附加组件只读引用浮窗请求运行时（webview 页面级）。
//
// 职责：SDK refViews 面的操作后端——来源解析（views 注册表实例 → 目标
// fsPath）、请求形状与触发位置校验、单页单浮窗仲裁下的请求簿记、本次
// 请求关闭句柄与组件代次释放。浮窗本体（几何/互斥/保活/Esc/键盘焦点/
// 错误视图/watch 与租约）全部复用 hoverPopup 既有链路——本模块不建第二
// 套浮窗，只把组件请求接进现有入口（规格 §5：平台按现有 hoverPopup
// Geometry 摆放、沿用 popupMutex 与移出延迟关闭）。
//
// T06 接缝：目标合成（shared/addonRefViews 的 buildAddonRefHoverTarget）与
// 来源覆盖（addonSource）是组件容器嵌入将复用的内部链路——本模块的
// 端口面（resolveSource/openPopup）保持无浮窗私有语义。
import type { AddonRefPopupOutcome, AddonRefPopupRequest } from '../shared/addonRefViews'
import { buildAddonRefHoverTarget, isAddonRefPopupRequest } from '../shared/addonRefViews'
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

/** 运行时端口（生产由 main.ts 装配：views 注册表 + hoverPopup 入口） */
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

  constructor(ports: AddonRefViewsRuntimePorts) {
    this.ports = ports
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
   *  不误关——按当前浮窗实例身份比对；重复释放无害） */
  releaseAddon(addonId: string, generation?: number): void {
    const record = this.current
    if (record && record.addonId === addonId && (generation === undefined || record.generation === generation) && record.instanceId !== null &&
      this.ports.currentPopupInstanceId() === record.instanceId) {
      this.ports.closePopup()
    }
  }

  /** 来源视图销毁时结束其引用请求；平台自身的其他浮窗保持原生命周期。 */
  releaseSource(instanceId: string): void {
    const record = this.current
    if (record?.source === instanceId && record.instanceId !== null &&
      this.ports.currentPopupInstanceId() === record.instanceId) {
      this.ports.closePopup()
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
