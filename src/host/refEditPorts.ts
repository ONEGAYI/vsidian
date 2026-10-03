// P2-04（#281）目标编辑端口绑定表（宿主纯逻辑）：嵌入内部 Live 与宿主 B
// 会话之间的虚拟面板登记簿。provider 负责校验来源（会话 + hoverSourcePin）
// 与 B 会话接入；本模块只管端口簿记——portId 分配、按面板/端口索引、
// 出站推送白名单信封（B 会话的编辑通道事件 → refEdit.push）、释放后迟到
// 消息的拒收判定。纯逻辑可单测；vscode API 依赖留 provider。
import type { HostToWebview, RefEditHostEvent, WebviewToHost } from '../shared/protocol'
import { isHostToWebview } from '../shared/protocol'

/** 一条目标编辑端口绑定：B 会话上的一个虚拟面板 */
export interface RefEditBinding {
  /** B 会话（DocumentSession）上的虚拟面板 id（= webview 侧 portId） */
  portId: string
  /** B 的规范 file URI 串（B 会话注册键） */
  targetUri: string
  /** B 的平台分隔符 fsPath（dirty 推送与 webview 侧目标身份） */
  fsPath: string
  /** B 会话内的虚拟面板 sessionId（attachPanel 分配——会话消息路由用；
   *  与 portId（webview 侧端口身份）分开建模） */
  virtualSessionId: string
  /** 来源面板：A 的会话 id 与文档 URI（认证与回包路由） */
  panelSessionId: string
  panelDocUri: string
  /** occurrence 标识（嵌入实例键；bind 校验用） */
  occurrence: string
  /** 最近推送的 dirty 值（去重：dirty 推送只在变化时发） */
  lastDirty: boolean | undefined
}

/** 出站推送白名单：B 会话对虚拟面板 send 的消息中，仅编辑通道事件进入
 *  refEdit.push 信封；其余（locale.changed / settings.snapshot /
 *  view.state.request 等面板级消息）不进目标端口通道——它们经 ready 注入
 *  的 init 之后的补发只对根面板有意义。返回 null = 不推送。 */
export function wrapRefEditPush(
  binding: RefEditBinding,
  message: HostToWebview,
): HostToWebview | null {
  switch (message.kind) {
    case 'init':
    case 'edit.ack':
    case 'doc.changed':
    case 'doc.resync':
    case 'session.suspended':
      return { kind: 'refEdit.push', portId: binding.portId, fsPath: binding.fsPath, message: message as RefEditHostEvent }
    default:
      return null
  }
}

/**
 * 目标编辑端口绑定表：portId → 绑定；面板（A docUri + sessionId）→ 端口集。
 * 生命周期：bind 登记（同面板同 occurrence 重复 bind 先释放旧端口——幂等
 * 重挂）；unbind / 面板销毁整体释放。释放后 portId 不复用（迟到消息按
 * portId 查不到即拒收，无需代次）。
 */
export class RefEditPortRegistry {
  private readonly byPort = new Map<string, RefEditBinding>()
  private readonly byPanel = new Map<string, Set<string>>()
  /** P2-13（#290）面板级「曾成功写入」记账：panelKey → 该面板端口
   *  edit.ack(ok) 过的目标集合。端口释放（离屏回收 / 切 Reading）不清——
   *  父标签关闭交接的判定集合 = 关闭时活跃端口 ∪ 本记账（ADR-0010
   *  「引用编辑涉及且仍有未保存修改的 B」）。随 releasePanel 整体清账 */
  private readonly editAckByPanel = new Map<string, Set<string>>()
  private nextPortSeq = 1

  /** P2-13（#290）登记一次成功写入（该面板的端口编辑已确认写入目标） */
  noteEditAck(panelSessionId: string, panelDocUri: string, targetUri: string): void {
    const key = `${panelDocUri}\n${panelSessionId}`
    let targets = this.editAckByPanel.get(key)
    if (!targets) {
      targets = new Set()
      this.editAckByPanel.set(key, targets)
    }
    targets.add(targetUri)
  }

  /** P2-13（#290）该面板曾成功写入的目标集合（未登记面板为空数组）。
   *  releasePanel 清账前读取——交接判定的第二来源 */
  panelEditTargets(panelSessionId: string, panelDocUri: string): string[] {
    return [...(this.editAckByPanel.get(`${panelDocUri}\n${panelSessionId}`) ?? [])]
  }

  allocate(): string {
    return `refport-${this.nextPortSeq++}`
  }

  /** 登记绑定（同面板同 occurrence 已有绑定时返回旧 portId 由调用方先释放） */
  register(binding: RefEditBinding): void {
    this.byPort.set(binding.portId, binding)
    const panelKey = this.panelKeyOf(binding)
    let ports = this.byPanel.get(panelKey)
    if (!ports) {
      ports = new Set()
      this.byPanel.set(panelKey, ports)
    }
    ports.add(binding.portId)
  }

  /** 按 portId 查询；面板身份不符（跨面板伪造）返回 null */
  lookup(portId: string, panelSessionId: string, panelDocUri: string): RefEditBinding | null {
    const binding = this.byPort.get(portId)
    if (!binding || binding.panelSessionId !== panelSessionId || binding.panelDocUri !== panelDocUri) {
      return null
    }
    return binding
  }

  /** 同面板同 occurrence 的既有绑定（重复 bind 幂等释放用） */
  findOccurrence(panelSessionId: string, panelDocUri: string, occurrence: string): RefEditBinding | null {
    for (const binding of this.byPort.values()) {
      if (binding.panelSessionId === panelSessionId && binding.panelDocUri === panelDocUri &&
        binding.occurrence === occurrence) {
        return binding
      }
    }
    return null
  }

  /** 某目标 fsPath 的全部活跃绑定（dirty 推送按目标路由到来源面板） */
  byTarget(fsPath: string): RefEditBinding[] {
    return [...this.byPort.values()].filter((b) => b.fsPath === fsPath)
  }

  /** 释放端口；返回被释放的绑定（调用方据此 detach B 会话面板） */
  release(portId: string): RefEditBinding | undefined {
    const binding = this.byPort.get(portId)
    if (!binding) {
      return undefined
    }
    this.byPort.delete(portId)
    const ports = this.byPanel.get(this.panelKeyOf(binding))
    ports?.delete(portId)
    if (ports?.size === 0) {
      this.byPanel.delete(this.panelKeyOf(binding))
    }
    return binding
  }

  /** 面板（A）销毁时整体释放：返回全部该面板的绑定；P2-13 记账同清 */
  releasePanel(panelSessionId: string, panelDocUri: string): RefEditBinding[] {
    const key = `${panelDocUri}\n${panelSessionId}`
    this.editAckByPanel.delete(key)
    const released: RefEditBinding[] = []
    for (const portId of [...(this.byPanel.get(key) ?? [])]) {
      const binding = this.release(portId)
      if (binding) {
        released.push(binding)
      }
    }
    return released
  }

  /** B 文档会话释放（B 面板全部关闭）时整体释放指向它的端口 */
  releaseTarget(targetUri: string): RefEditBinding[] {
    const released: RefEditBinding[] = []
    for (const [portId, binding] of [...this.byPort]) {
      if (binding.targetUri === targetUri) {
        this.release(portId)
        released.push(binding)
      }
    }
    return released
  }

  size(): number {
    return this.byPort.size
  }

  private panelKeyOf(binding: RefEditBinding): string {
    return `${binding.panelDocUri}\n${binding.panelSessionId}`
  }
}

/** refEdit.message 的内消息是否属于编辑通道（冗余防线：协议校验已白名单，
 *  provider 路由前再判定一次——错误路由直接写 B 的代价高） */
export function isRefEditClientMessage(message: WebviewToHost): boolean {
  switch (message.kind) {
    case 'edit.request':
    case 'conflict.report':
    case 'composition.changed':
    case 'history.request':
    case 'sync.request':
    case 'conflict.action':
      return true
    default:
      return false
  }
}

/** 出站信封校验（wrapRefEditPush 产物自检；防御性） */
export function isRefEditPushMessage(message: HostToWebview): boolean {
  return message.kind === 'refEdit.push' && isHostToWebview(message)
}
