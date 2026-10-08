// V01（#348）附加组件「原子修饰独立撤回 + 非原子随同上次原子操作撤回」的
// 纯逻辑分组状态机——**实验验证件，不是已发布 SDK**。
//
// 事实源：docs/design/vsidian-addon-api.md 第 6 节、ADR-0012 Q29、票面
// docs/specs/vsidian-addons-tickets/v01.md。职责边界：
// - 只维护「宿主历史条目 ↔ 来源/原子组」映射与撤回/重做计划，不执行任何
//   原生命令；版本与文本观测由宿主侧探针（src/host/addonHistoryProbe.ts）
//   从真实版本/增量/ack 管线喂入。
// - 每条宿主历史条目 = 一笔 WorkspaceEdit（VSCode 1.82.3 建立并关闭原生
//   历史项，既有最小探针已核实）。一次原子操作的撤回单位可能对应多条宿主
//   条目（原子后追加的非原子修饰各自成条、同组连续撤回）。
// - 非原子归属规则（保守实现）：目标当前已应用条目栈顶须为附加组件条目
//   （其原子组未被外来写入打断）才可归属；否则拒绝 boundary-unavailable
//   ——不静默省略跟踪或换成另一种撤销语义。
// - 映射失配（lost）后一切协调请求明确拒绝，恢复快照必须能对上宿主实际
//   保留的边界状态，否则同样 lost。
//
// 该模块无 vscode/DOM 依赖（shared 纯逻辑），生产扩展当前不装配它——仅
// VSIDIAN_TEST_HOOKS 探针与单测引用；T03（#352）放行后以其收敛形状为参考。

/** 条目来源：addon = 附加组件修饰提交；foreign = 其余一切写入（用户输入、
 *  外部扩展 WorkspaceEdit、原生编辑器键入）——外来条目是独立单步撤回单位 */
export type AddonHistoryOwner = 'addon' | 'foreign'

export type AddonHistoryRejectReason =
  /** 历史为空（无可撤/可重做内容） */
  | 'empty'
  /** 版本/历史映射已失配或快照对不上宿主实际状态：停止协调 */
  | 'mapping-lost'
  /** 非原子提交无可确认的同目标前项（HistoryBoundaryUnavailable 语义） */
  | 'boundary-unavailable'

/** 一条宿主历史条目的映射记录（before/after 来自真实版本/文本观测） */
export interface AddonHistoryEntry {
  seq: number
  owner: AddonHistoryOwner
  /** 修饰操作 ID（owner=addon 必填）：逐次来源跟踪 */
  opId?: string
  /** 原子组 ID（owner=addon 必填）：同组 = 一个撤回单位 */
  groupId?: string
  /** 是否本组首条（原子提交） */
  atomic?: boolean
  versionBefore: number
  textBefore: string
  versionAfter: number
  textAfter: string
}

/** 单个原生步骤的预期回流：本步落定后权威文本应恰好等于 expectText */
export interface AddonHistoryStep {
  expectText: string
  entrySeq: number
  groupId?: string
}

export type AddonHistoryPlan =
  | { kind: 'execute'; op: 'undo' | 'redo'; steps: AddonHistoryStep[] }
  | { kind: 'reject'; op: 'undo' | 'redo'; reason: AddonHistoryRejectReason }

export type AddonHistorySubmitCheck =
  | { ok: true; groupId: string }
  | { ok: false; reason: 'boundary-unavailable' | 'mapping-lost' }

/** 外部（原生编辑器/宿主入口）单步撤销/重做回流的对账结果 */
export interface AddonHistoryBackflowResult {
  matched: boolean
  /** 组未完成时按执行序给出的剩余步骤（调用方执行后经 commitSteps 提交） */
  completion: AddonHistoryStep[]
  entrySeq?: number
}

/** 快照：重载恢复验证用（entries + 应用指针 + lost 标志） */
export interface AddonHistorySnapshot {
  entries: AddonHistoryEntry[]
  appliedCount: number
  lost: boolean
  nextSeq: number
  nextGroup: number
}

/**
 * 单目标文档的历史分组状态机。实例按目标一一对应；线程模型由调用方
 * （宿主探针）保证串行喂入。
 */
export class AddonHistoryGrouping {
  private entries: AddonHistoryEntry[] = []
  /** entries[0..appliedCount-1] 已应用；其余为已撤销（可重做）区域，
   *  新前向写入会截断可重做尾部 */
  private applied = 0
  private lostFlag = false
  private nextSeq = 1
  private nextGroup = 1

  get lost(): boolean {
    return this.lostFlag
  }

  get appliedCount(): number {
    return this.applied
  }

  listEntries(): readonly AddonHistoryEntry[] {
    return this.entries
  }

  /** ack 版本定位条目（宿主探针用 edit.ack(ok) 的 version 给条目打来源标签） */
  entryAtVersion(versionAfter: number): AddonHistoryEntry | undefined {
    return this.entries.find((e) => e.versionAfter === versionAfter)
  }

  /**
   * 提交前检查：原子开新组；非原子要求已应用栈顶是附加组件条目（并入其
   * 组）。空栈 / 仅外来写入 / 组顶被外来写入打断 → 拒绝提交。
   */
  planSubmit(_opId: string, atomic: boolean): AddonHistorySubmitCheck {
    if (this.lostFlag) {
      return { ok: false, reason: 'mapping-lost' }
    }
    if (atomic) {
      return { ok: true, groupId: `g${this.nextGroup}` }
    }
    const top = this.entries[this.applied - 1]
    if (!top || top.owner !== 'addon' || top.groupId === undefined) {
      return { ok: false, reason: 'boundary-unavailable' }
    }
    return { ok: true, groupId: top.groupId }
  }

  /** 分配下一个组号（原子提交记账用；与 planSubmit 返回一致） */
  allocateGroupId(): string {
    return `g${this.nextGroup}`
  }

  /** 记录一条前向条目（截断可重做尾部 + 推进应用指针） */
  noteForwardEntry(input: {
    owner: AddonHistoryOwner
    opId?: string
    groupId?: string
    atomic?: boolean
    versionBefore: number
    textBefore: string
    versionAfter: number
    textAfter: string
  }): AddonHistoryEntry {
    this.entries.length = this.applied
    const entry: AddonHistoryEntry = {
      seq: this.nextSeq++,
      owner: input.owner,
      ...(input.opId !== undefined ? { opId: input.opId } : {}),
      ...(input.groupId !== undefined ? { groupId: input.groupId } : {}),
      ...(input.atomic !== undefined ? { atomic: input.atomic } : {}),
      versionBefore: input.versionBefore,
      textBefore: input.textBefore,
      versionAfter: input.versionAfter,
      textAfter: input.textAfter,
    }
    if (entry.owner === 'addon' && entry.atomic === true) {
      this.nextGroup += 1
    }
    this.entries.push(entry)
    this.applied = this.entries.length
    return entry
  }

  /** 给已记录条目补来源标签（ack 版本对位；重复打标返回 false） */
  tagEntryByVersion(versionAfter: number, tag: { opId: string; groupId: string; atomic: boolean }): boolean {
    const entry = this.entryAtVersion(versionAfter)
    if (!entry || entry.opId !== undefined) {
      return false
    }
    entry.opId = tag.opId
    entry.groupId = tag.groupId
    entry.atomic = tag.atomic
    return true
  }

  /**
   * 撤回/重做计划：栈顶（或可重做区底）起按连续同组条目给出全部步骤。
   * 外来条目恒为单步单位；空区拒绝；lost 拒绝。
   */
  planHistory(op: 'undo' | 'redo'): AddonHistoryPlan {
    if (this.lostFlag) {
      return { kind: 'reject', op, reason: 'mapping-lost' }
    }
    if (op === 'undo') {
      if (this.applied === 0) {
        return { kind: 'reject', op, reason: 'empty' }
      }
      const steps: AddonHistoryStep[] = []
      let i = this.applied - 1
      const group = this.entries[i].groupId
      // 外来条目（无组）恒为单步单位；附加组件条目按连续同组扩展
      if (group === undefined) {
        steps.push(stepOf(this.entries[i], 'undo'))
      } else {
        while (i >= 0) {
          const entry = this.entries[i]
          if (entry.groupId !== group) {
            break
          }
          steps.push(stepOf(entry, 'undo'))
          i -= 1
        }
      }
      return { kind: 'execute', op, steps }
    }
    if (this.applied === this.entries.length) {
      return { kind: 'reject', op, reason: 'empty' }
    }
    const steps: AddonHistoryStep[] = []
    let i = this.applied
    const group = this.entries[i].groupId
    if (group === undefined) {
      steps.push(stepOf(this.entries[i], 'redo'))
    } else {
      while (i < this.entries.length) {
        const entry = this.entries[i]
        if (entry.groupId !== group) {
          break
        }
        steps.push(stepOf(entry, 'redo'))
        i += 1
      }
    }
    return { kind: 'execute', op, steps }
  }

  /** 提交自驱计划的指针移动（自驱步骤的回流事件由调用方吞掉，不走对账） */
  commitPlan(plan: AddonHistoryPlan): boolean {
    if (plan.kind !== 'execute') {
      return false
    }
    return this.commitSteps(plan.op, plan.steps)
  }

  /** 提交回流补完步骤（noteUndoBackflow/noteRedoBackflow 的 completion） */
  commitCompletion(op: 'undo' | 'redo', steps: AddonHistoryStep[]): boolean {
    return this.commitSteps(op, steps)
  }

  /** 单步推进应用指针（宿主探针在每步回流核对通过后调用） */
  commitSteps(op: 'undo' | 'redo', steps: AddonHistoryStep[]): boolean {
    if (op === 'undo') {
      this.applied = Math.max(0, this.applied - steps.length)
    } else {
      this.applied = Math.min(this.entries.length, this.applied + steps.length)
    }
    return true
  }

  /**
   * 外部单步撤销回流对账：文本应等于（对账前）栈顶条目的 textBefore。
   * 命中 → 指针退一；若新栈顶与被撤条目同组（组未撤完）→ 给出补完步骤。
   * 未命中 → lost（映射失配，后续一切协调拒绝）。
   */
  noteUndoBackflow(text: string, _version: number): AddonHistoryBackflowResult {
    return this.noteBackflow('undo', text)
  }

  /** 外部单步重做回流对账（noteUndoBackflow 的镜像） */
  noteRedoBackflow(text: string, _version: number): AddonHistoryBackflowResult {
    return this.noteBackflow('redo', text)
  }

  private noteBackflow(op: 'undo' | 'redo', text: string): AddonHistoryBackflowResult {
    if (this.lostFlag) {
      return { matched: false, completion: [] }
    }
    if (op === 'undo') {
      const top = this.entries[this.applied - 1]
      if (!top || top.textBefore !== text) {
        this.lostFlag = true
        return { matched: false, completion: [] }
      }
      this.applied -= 1
      // 组剩余步骤：被撤条目之下连续同组条目全部给出（执行序 = 自顶向下）
      const completion: AddonHistoryStep[] = []
      for (let i = this.applied - 1; i >= 0; i--) {
        const next = this.entries[i]
        if (next.groupId === undefined || next.groupId !== top.groupId) {
          break
        }
        completion.push(stepOf(next, 'undo'))
      }
      return { matched: true, completion, entrySeq: top.seq }
    }
    const bottom = this.entries[this.applied]
    if (!bottom || bottom.textAfter !== text) {
      this.lostFlag = true
      return { matched: false, completion: [] }
    }
    this.applied += 1
    // 组剩余步骤：重做区底部起连续同组条目（执行序 = 自底向上）
    const completion: AddonHistoryStep[] = []
    for (let i = this.applied; i < this.entries.length; i++) {
      const next = this.entries[i]
      if (next.groupId === undefined || next.groupId !== bottom.groupId) {
        break
      }
      completion.push(stepOf(next, 'redo'))
    }
    return { matched: true, completion, entrySeq: bottom.seq }
  }

  markLost(): void {
    this.lostFlag = true
  }

  snapshot(): AddonHistorySnapshot {
    return {
      entries: this.entries.map((e) => ({ ...e })),
      appliedCount: this.applied,
      lost: this.lostFlag,
      nextSeq: this.nextSeq,
      nextGroup: this.nextGroup,
    }
  }

  /**
   * 重载恢复：以宿主当前权威文本对账快照边界——恰为某条目的 textAfter
   * （或初态空栈）则指针归位继续可用；否则 lost（不猜测、不重建）。
   */
  restore(snap: AddonHistorySnapshot, current: { version: number; text: string }): void {
    this.entries = snap.entries.map((e) => ({ ...e }))
    this.nextSeq = snap.nextSeq
    this.nextGroup = snap.nextGroup
    this.lostFlag = snap.lost
    this.applied = 0
    if (this.lostFlag) {
      return
    }
    if (current.text === (this.entries[0]?.textBefore ?? '')) {
      this.applied = 0
      return
    }
    for (let i = 0; i < this.entries.length; i++) {
      if (this.entries[i].textAfter === current.text) {
        this.applied = i + 1
        return
      }
    }
    this.lostFlag = true
  }
}

function stepOf(entry: AddonHistoryEntry, op: 'undo' | 'redo'): AddonHistoryStep {
  return {
    expectText: op === 'undo' ? entry.textBefore : entry.textAfter,
    entrySeq: entry.seq,
    ...(entry.groupId !== undefined ? { groupId: entry.groupId } : {}),
  }
}
