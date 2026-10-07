// T06（#355）附加组件历史协调器（宿主侧，per 目标文档）。
//
// 职责（T03 留下的本体工作 + V01 放行边界 F1–F6 的生产形态）：
// - **条目流重建**：以版本对位模型（expectedNextVersion 单调链）观察目标
//   文档的全部变更回流——前向写入按归属（DocumentSession.editOriginAtVersion
//   对位，外来写入无归属）记 addon/foreign 条目；不依赖文本全等（V01 探针
//   语义由来源元数据管线替代）。
// - **非原子归属判定（HistoryBoundaryUnavailable）**：joinPrevious 提交的
//   业务闸门——已应用栈顶是附加组件条目（组顶未被外来写入打断）才接受；
//   空日志 / 仅外来写入 / 组顶被打断 / 映射失配四种形态都拒绝。
// - **外部回流补完（F3 前置检查 + F4 版本吸收）**：原生入口（webview
//   Ctrl+Z / 宿主单步）撤销/重做落在修饰组中部时，协调器自动补完剩余
//   组步骤（经 DocumentSession.runHistorySteps 串行执行）；自驱步骤的
//   回流按预期版本集合吸收，不当作外部对账。
// - **撤回单位**：同组条目（组首 atomic 提交 + 其后 joinPrevious 各自成条
//   或合并笔）连续撤回/重做；外来条目恒为单步单位。
// - **持久化快照**：条目边界文本指纹（FNV-1a 64）+ 应用指针；重启恢复
//   以当前权威文本指纹对账——恰为某条目边界即归位继续，否则保守 lost
//   （V01 矩阵 12 语义：拒绝分组协调 ≠ 历史为空，宿主原生单步仍可用）。
//
// 事实源：docs/specs/vsidian-addons-tickets/t03.md「实施落档」（留 T06
// 清单）、docs/research/vsidian-addons-v01-history-probe.md（F1–F6 与放行
// 协议七条）、docs/design/vsidian-addon-api.md §6、ADR-0012 Q29。
//
// 纯逻辑（无 vscode/DOM 依赖）：回流/归属查询/组执行/持久化经端口注入。
import type { EditOriginMeta } from '../shared/editOrigin'
import type { HostHistoryGroupResult } from './documentSession'

/** 归属查询结果（外来写入返回 undefined；joined 为合并笔并入来源） */
export type CoordinatorOriginLookup = (version: number) =>
  { origin: EditOriginMeta; joined?: EditOriginMeta[] } | undefined

export interface AddonHistoryCoordinatorPorts {
  /** 组历史执行（DocumentSession.runHistorySteps——session 队列串行链） */
  runHistorySteps(op: 'undo' | 'redo', steps: number): Promise<HostHistoryGroupResult>
  /** 版本 → 来源归属查询（DocumentSession.editOriginAtVersion + joined） */
  originAt: CoordinatorOriginLookup
  /** 持久化快照保存（provider 注入 workspaceState；缺省不存） */
  save?(snapshot: AddonHistorySnapshotData): void
  /** 诊断日志（provider 注入；缺省静默） */
  log?(stage: string, detail: string): void
}

/** 一条宿主历史条目的协调器记录（版本对位；无文本） */
interface CoordinatorEntry {
  /** 落定版本（归属对位锚 = 该笔 edit.ack(ok) 同源 version） */
  version: number
  owner: 'addon' | 'foreign'
  /** 组身份（owner=addon 必填）：组首 atomic 提交的 opId——同组 = 一个撤回单位 */
  groupId?: string
  /** 本条目是否组首（atomic 建组） */
  atomic?: boolean
  /** 并入本条目的 joinPrevious opId 列表（合并笔：逐次来源保留） */
  joinedOpIds?: string[]
}

/** 持久化快照（workspaceState 载荷形态）：entries + 应用指针 + 保存时刻
 *  的权威文本指纹（恢复对账锚——当前文本与保存态一致才采信指针） */
export interface AddonHistorySnapshotData {
  entries: CoordinatorEntry[]
  applied: number
  lost: boolean
  /** 快照保存时刻的权威版本（恢复后仅作观测） */
  version: number
  /** 保存时刻权威全文指纹（恢复对账：当前文本一致 = 指针仍有效） */
  textHash?: string
}

/** 拒绝原因（与 V01 探针语义对齐：empty ≠ mapping-lost） */
export type CoordinatorReject = 'empty' | 'mapping-lost' | 'boundary-unavailable'

/** 文本指纹（FNV-1a 64 位十六进制；碰撞概率对恢复对账足够） */
export function textFingerprint(text: string): string {
  let hash = 0xcbf29ce484222325n
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i))
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return hash.toString(16)
}

const ENTRY_LIMIT = 512

/**
 * 单目标文档的历史协调器。线程模型：回流观察与补完发起由 provider 在
 * onDidChangeTextDocument 同步链调用（VSCode 事件循环内串行）；补完执行
 * 异步挂 session 队列，其回流经自驱吸收分支处理。
 */
export class AddonHistoryCoordinator {
  private entries: CoordinatorEntry[] = []
  private applied = 0
  private lostFlag = false
  /** 版本对位链：下一条预期回流的版本号（缺口/超前即失配） */
  private expectedNextVersion: number
  /** 协调器创建前旧历史区的已撤深度（外部 undo 越过条目区底部时累计，
   *  redo 先消费旧区再回条目区——宿主栈序的精确镜像，防止指针错位） */
  private oldRegionDepth = 0
  /** 在途自驱组执行（F4 吸收集合 + 核对材料） */
  private selfDriven: { op: 'undo' | 'redo'; expectVersions: Set<number>; absorbed: number } | null = null
  /** 补完链（防重入：上一次补完未落定不再叠发） */
  private completionChain: Promise<void> = Promise.resolve()

  constructor(
    private readonly ports: AddonHistoryCoordinatorPorts,
    initial: { version: number; restore?: AddonHistorySnapshotData; initialText?: string },
  ) {
    this.expectedNextVersion = initial.version + 1
    if (initial.restore && !initial.restore.lost && initial.initialText !== undefined) {
      // 持久化恢复：当前权威文本与保存态一致（指纹对账）→ 采信应用指针
      // 继续；不一致 → 保守 lost（不猜测、不重建——V01 restore 语义：
      // 拒绝分组协调 ≠ 历史为空，宿主原生单步仍可用）
      const snap = initial.restore
      if (snap.textHash !== undefined && snap.textHash === textFingerprint(initial.initialText)) {
        this.entries = snap.entries.map((e) => ({ ...e }))
        this.applied = Math.min(snap.applied, this.entries.length)
        this.expectedNextVersion = initial.version + 1
        this.ports.log?.('addon-history-restored', `entries=${this.entries.length} applied=${this.applied}`)
      } else {
        this.lostFlag = true
        this.ports.log?.('addon-history-restore-lost', 'current text differs from persisted state')
      }
    }
  }

  get lost(): boolean {
    return this.lostFlag
  }

  get appliedCount(): number {
    return this.applied
  }

  /** 观测快照（测试钩子与诊断） */
  observe(): { entries: readonly CoordinatorEntry[]; applied: number; lost: boolean; expectedNextVersion: number } {
    return { entries: this.entries, applied: this.applied, lost: this.lostFlag, expectedNextVersion: this.expectedNextVersion }
  }

  /**
   * 业务闸门（joinPrevious 归属判定——DocumentSession.onOriginGate 的后端）：
   * 已应用栈顶是附加组件条目才可归属（V01 保守口径：组顶被外来写入打断
   * 即无可确认前项）；atomic 恒放行（自建新组与协调无关——文本管线照常）。
   * lost 状态下 joinPrevious 同样拒绝（映射不可验证 ≠ 有可确认前项）。
   */
  gateSubmit(origin: EditOriginMeta): boolean {
    if (origin.undo !== 'joinPrevious') {
      return true
    }
    if (this.lostFlag) {
      return false
    }
    const top = this.entries[this.applied - 1]
    return top !== undefined && top.owner === 'addon' && top.groupId !== undefined
  }

  /**
   * 变更回流观察（provider 在 session.handleDocChanged 之后同步喂入；
   * contentChanges 为空的事件不喂）。返回是否保持健康（lost 后仍可喂，
   * 幂等拒绝）。
   */
  observeChange(change: { version: number; reason?: 'undo' | 'redo' }): void {
    if (this.lostFlag) {
      return
    }
    // F4 自驱吸收：版本恰为本次补完的预期步骤——按方向推进指针，不作
    // 外部对账（否则指针双移动，V01 F4）
    if (this.selfDriven !== null && this.selfDriven.expectVersions.has(change.version)) {
      this.selfDriven.expectVersions.delete(change.version)
      this.selfDriven.absorbed += 1
      this.expectedNextVersion = change.version + 1
      if (this.selfDriven.op === 'undo') {
        this.applied = Math.max(0, this.applied - 1)
      } else {
        this.applied = Math.min(this.entries.length, this.applied + 1)
      }
      return
    }
    if (change.version !== this.expectedNextVersion) {
      // 版本链缺口/超前（协调器未见的变更或重启重排）：映射不可验证
      this.markLost(`版本链失配：期望 ${this.expectedNextVersion} 实到 ${change.version}`)
      return
    }
    this.expectedNextVersion = change.version + 1
    if (change.reason === undefined) {
      this.noteForward(change.version)
      return
    }
    this.noteHistoryBackflow(change.reason)
  }

  /** 归属登记（onEditAttributed 观测面——前向条目的归属对位补充；正常
   *  顺序下 observeChange 已按查询面对位，本方法兜底迟到的兜底确认归属） */
  noteAttribution(version: number, origin: EditOriginMeta, joined?: EditOriginMeta[]): void {
    if (this.lostFlag) {
      return
    }
    const entry = this.entries.find((e) => e.version === version)
    if (!entry || entry.owner !== 'foreign') {
      return // addon 条目已在 noteForward 对位（或版本未知——版本链已守）
    }
    const classified = this.classifyAddonEntry(origin, joined)
    if (classified) {
      Object.assign(entry, classified)
    }
  }

  /** 补完剩余步数查询面（测试钩子与诊断）：当前指针状态下所属组在作用
   *  方向上的连续条目数（外来条目/无组身份为 0；指针越界为 empty） */
  planCompletion(op: 'undo' | 'redo'): { steps: number } | { reject: CoordinatorReject } {
    if (this.lostFlag) {
      return { reject: 'mapping-lost' }
    }
    if (op === 'undo' && this.applied === 0) {
      return { reject: 'empty' }
    }
    if (op === 'redo' && this.applied >= this.entries.length) {
      return { reject: 'empty' }
    }
    const head = op === 'undo' ? this.entries[this.applied - 1] : this.entries[this.applied]
    if (head === undefined || head.groupId === undefined) {
      return { steps: 0 }
    }
    return { steps: this.contiguousGroupCount(op) }
  }

  /** 持久化快照：以当前权威全文指纹为对账锚（保存态 = 指针态——恢复
   *  时文本一致才采信指针；条目本身不持文本，纯版本模型不变） */
  serialize(version: number, text: string): AddonHistorySnapshotData {
    return {
      entries: this.entries.map((e) => ({ ...e })),
      applied: this.applied,
      lost: this.lostFlag,
      version,
      textHash: textFingerprint(text),
    }
  }

  /** 显式标失（外部失配信号） */
  markLost(reason: string): void {
    if (this.lostFlag) {
      return
    }
    this.lostFlag = true
    this.ports.log?.('addon-history-lost', reason)
  }

  // ---- 内部 ----

  /** 前向写入条目（归属对位：查询面命中即 addon，否则 foreign） */
  private noteForward(version: number): void {
    // 新写入截断可重做尾部（Undo 后新写的宿主语义——V01 场景 6）：协调器
    // 条目的 redo 区与旧区已撤条目（oldRegionDepth）一并作废
    if (this.applied < this.entries.length) {
      this.entries.length = this.applied
    }
    this.oldRegionDepth = 0
    const attribution = this.ports.originAt(version)
    let entry: CoordinatorEntry
    if (attribution) {
      const classified = this.classifyAddonEntry(attribution.origin, attribution.joined)
      entry = classified === null
        // 理论不可达（joinPrevious 无前项已被 gate 拒绝）；防御退 foreign，
        // 迟到归属兜底（noteAttribution）可矫正
        ? { version, owner: 'foreign' }
        : { version, owner: 'addon', ...classified }
    } else {
      entry = { version, owner: 'foreign' }
    }
    this.entries.push(entry)
    this.applied = this.entries.length
    while (this.entries.length > ENTRY_LIMIT) {
      this.entries.shift()
      this.applied -= 1
    }
  }

  /** addon 条目的组归类：atomic 开新组（组 ID = opId）；joinPrevious 并入
   *  当前已应用栈顶的组（gate 已保证栈顶为 addon 条目——防御失配时退
   *  foreign，由 noteAttribution 兜底矫正） */
  private classifyAddonEntry(
    origin: EditOriginMeta,
    joined?: EditOriginMeta[],
  ): Partial<CoordinatorEntry> | null {
    if (origin.undo === 'atomic') {
      return {
        owner: 'addon',
        groupId: origin.opId,
        atomic: true,
        ...(joined && joined.length > 0 ? { joinedOpIds: joined.map((j) => j.opId) } : {}),
      }
    }
    const top = this.entries[this.applied - 1]
    if (top !== undefined && top.owner === 'addon' && top.groupId !== undefined) {
      return {
        owner: 'addon',
        groupId: top.groupId,
        ...(joined && joined.length > 0 ? { joinedOpIds: joined.map((j) => j.opId) } : {}),
      }
    }
    return null
  }

  /** 外部单步撤销/重做回流对账 + 组补完发起（F3 前置检查在补完执行时点） */
  private noteHistoryBackflow(reason: 'undo' | 'redo'): void {
    if (reason === 'undo') {
      if (this.applied === 0) {
        // 条目区已撤空：外部 undo 作用于协调器创建前的旧历史区——累计
        // 深度（redo 先回旧区再回条目区；宿主栈序镜像），不 lost
        this.oldRegionDepth += 1
        return
      }
      const undone = this.entries[this.applied - 1]!
      this.applied -= 1
      this.considerCompletion('undo', undone.groupId)
      return
    }
    // redo：先消费旧区已撤条目（宿主栈序），再进条目区
    if (this.oldRegionDepth > 0) {
      this.oldRegionDepth -= 1
      return
    }
    if (this.applied >= this.entries.length) {
      this.markLost('external redo hit entry invisible to coordinator (pointer at top, no old-region depth)')
      return
    }
    const redone = this.entries[this.applied]!
    this.applied += 1
    this.considerCompletion('redo', redone.groupId)
  }

  /** 组未完则补完：剩余 = 指针当前组在作用方向上的连续条目数（被撤/
   *  重做的那条已由外部完成，指针已越过）；防重入链——上一次补完未落定
   *  不叠发（其执行期间的外部回流由 F4 吸收/对账处理） */
  private considerCompletion(op: 'undo' | 'redo', undoneGroupId: string | undefined): void {
    if (undoneGroupId === undefined) {
      return // 外来条目：恒单步撤回单位，无补完
    }
    const remaining = this.contiguousGroupCount(op)
    if (remaining <= 0) {
      return
    }
    // F2：计划在执行时点计算（此处即执行前一刻的当前栈状态）
    this.completionChain = this.completionChain.then(() => this.runCompletion(op, remaining))
  }

  /** 自驱补完执行（runHistorySteps 串行链；F3 前置检查 + F4 吸收） */
  private async runCompletion(op: 'undo' | 'redo', steps: number): Promise<void> {
    if (this.lostFlag || steps <= 0) {
      return
    }
    // F3 前置检查：下一个将被原生命令作用的条目 === 补完目标（undo 看已
    // 应用栈顶 / redo 看可重做区底；外部写入若已插入即对象错位——明确
    // 拒绝并 lost，绝不撤错条目）
    const expect = op === 'undo' ? this.entries[this.applied - 1] : this.entries[this.applied]
    if (expect === undefined) {
      this.markLost(`补完前置检查失败：${op} 方向无目标条目`)
      return
    }
    const startVersion = this.expectedNextVersion - 1
    this.selfDriven = {
      op,
      expectVersions: new Set(Array.from({ length: steps }, (_, i) => startVersion + 1 + i)),
      absorbed: 0,
    }
    let result: HostHistoryGroupResult
    try {
      result = await this.ports.runHistorySteps(op, steps)
    } catch (err) {
      this.selfDriven = null
      this.markLost(`补完执行异常：${String(err)}`)
      return
    }
    const absorbed = this.selfDriven.absorbed
    this.selfDriven = null
    if (this.lostFlag) {
      return
    }
    if (result.aborted !== undefined) {
      if (absorbed !== result.executedSteps) {
        this.markLost(`补完核对失配：absorbed=${absorbed} executed=${result.executedSteps}`)
      }
      this.ports.log?.('addon-history-aborted', `${op} steps=${steps} executed=${result.executedSteps} reason=${result.aborted}`)
      return
    }
    if (absorbed !== result.executedSteps || result.executedSteps !== steps) {
      this.markLost(`补完核对失配：absorbed=${absorbed} executed=${result.executedSteps} planned=${steps}`)
    }
  }

  /** 指针起连续同组条目数（undo 向下数已应用栈；redo 向上数可重做区） */
  private contiguousGroupCount(op: 'undo' | 'redo'): number {
    if (op === 'undo') {
      if (this.applied === 0) {
        return 0
      }
      const group = this.entries[this.applied - 1]!.groupId
      if (group === undefined) {
        return 1
      }
      let count = 0
      for (let i = this.applied - 1; i >= 0; i--) {
        if (this.entries[i]!.groupId !== group) {
          break
        }
        count += 1
      }
      return count
    }
    if (this.applied === this.entries.length) {
      return 0
    }
    const group = this.entries[this.applied]!.groupId
    if (group === undefined) {
      return 1
    }
    let count = 0
    for (let i = this.applied; i < this.entries.length; i++) {
      if (this.entries[i]!.groupId !== group) {
        break
      }
      count += 1
    }
    return count
  }
}
