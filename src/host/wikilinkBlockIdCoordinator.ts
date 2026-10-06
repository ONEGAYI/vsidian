// 块 ID 撤回协调（工单 #380 T05，V01 放行路径的生产编排）：登记「来源
// 接受链接 ↔ 目标自动新增标记」的因果关系，来源 undo/redo 后按引用消长
// 驱动「尽力撤回 / 重核重建」，全部经 withdrawalGuard 双守卫（目标版本
// 未变 + 标记逐字在场）走正向 WorkspaceEdit——绝不借目标 undo（V01
// case 3 反证其会吃掉目标的无关输入，见
// docs/research/wikilink-completion-v01-probe.md）。
//
// 分层（与 hoverDocAccess / wikilinkHeadingSource 同构）：本模块只做登记
// 与决策编排，vscode 依赖经 ports 注入（provider 层传真实适配，node 单测
// 直驱注入桩）。观察点由 provider 接线：
// - 来源文档权威文本变更（onDidChangeTextDocument 回流）→ observeOriginText
//   （单调 everReferenced：来源曾含 `#^id` 引用即置位，不复位——撤回判定
//   只认「曾引用 → undo 后无引用」的翻转，手动删除链接不触发）；
// - 来源会话 undo/redo 实际执行（DocumentSession.onHistoryApplied）→
//   onHistoryApplied；
// - 来源会话退役（全部面板关闭）→ disposeOrigin。
//
// 语义边界（V01 场景矩阵对应）：
// - 只撤回本次自动新增的标记；登记本身就以「本次 planned 写入」为前提，
//   已有 ID（reused）路径不产生记录——既有 ID 永不被清理。
// - 撤回风险（版本/标记变化、已观测新使用）→ 保留 + 结构化结果（i18n
//   toast 归 vscode 层），来源撤销不阻塞（观察点在 undo 落定之后）。
// - 接受放弃（cancel）/来源退役时未落地的 pending → 尽力收尾撤回
//   （V01 场景 6/7）；来源退役时已落地的记录按 origin-closed 移除并保留
//   标记（不动目标、不抛异常）。
// - 撤回成功的记录留存待 redo 重核：id 在场 → 复用；已安全移除 → 按记录
//   块首行与撤回后版本守卫重建**原 id**（链接引用保持有效）；块被用户
//   改写（新标记占了块 / id 被挪用）→ 认用户的，不复活旧标记、静默退出
//   协调（V01 场景 5 及变体）。
import { blockIdOfLine, collectBlockIds, standaloneBlockIdOf } from '../shared/blockId'
import { parseWikilinkInner, scanWikilinksInLine } from '../shared/wikilink'
import { planTargetBlockId, withdrawalGuard, type BlockIdWithdrawRecord } from '../shared/wikilinkBlock'

/** 目标文档访问端口（vscode 层注入：openTextDocument 装载 + WorkspaceEdit）。
 *  text/version 为装载时刻快照；insertAt/deleteRange 后版本推进由调用方
 *  重新装载读取 */
export interface BlockIdTargetPort {
  readonly text: string
  readonly version: number
  /** 目标文档行尾形态（标记写回的 EOL 归一） */
  readonly crlf: boolean
  insertAt(offset: number, text: string): Promise<boolean>
  deleteRange(offset: number, length: number): Promise<boolean>
}

export interface BlockIdCoordinatorPorts {
  /** 来源文档当前 LF 全文（引用消长判定）；来源不可得 null */
  getOriginText(docUri: string): string | null
  /** 装载目标文档访问端口；失败 null（真实状态不吞错） */
  openTarget(fsPath: string): Promise<BlockIdTargetPort | null>
  /** 「已观测新使用」检查：工作区引用索引中是否存在**其他来源**对该 id
   *  的引用（originDocUri 自身不算——刚被 undo）。索引不可用返回 null
   *  （跳过该关，不阻塞撤回——「已观测」限定为可观测事实） */
  hasOtherReferences?(fsPath: string, blockId: string, originDocUri: string): Promise<boolean | null>
  /** 撤回保留提示（结构化 reason → i18n 文案归 vscode 层） */
  notifyKept(reason: 'version-changed' | 'marker-changed' | 'new-use' | 'apply-failed' | 'not-found', blockId: string): void
  /** 重建失败提示（id 被挪用等——链接悬空留待用户处置） */
  notifyRebuildFailed(blockId: string): void
}

/** 撤回结果（V01 WithdrawOutcome 对应 + new-use/not-found 扩展；toast 数据源） */
export type WithdrawOutcome = {
  kept: boolean
  reason: 'withdrawn' | 'version-changed' | 'marker-changed' | 'new-use' | 'apply-failed' | 'not-found'
}

/** 登记记录（V01 AddedIdRecord + 因果与观察态） */
interface BlockIdRecord extends BlockIdWithdrawRecord {
  /** accept 请求配对（linked/cancel 与之匹配） */
  reqId: number
  originDocUri: string
  targetFsPath: string
  /** accept 时块首行（1-based；redo 重建的块锚） */
  blockFirstLine: number
  /** 因果成立（wikilink.block.linked 已到）：历史协调只针对已落地链接 */
  confirmed: boolean
  /** 单调：来源权威文本曾含 `#^id` 引用（撤回判定认「曾引用→消失」翻转） */
  everReferenced: boolean
  /** 撤回成功后的目标版本（redo 重建的行号可信度守卫）；未撤回 -1 */
  versionAfterWithdraw: number
}

/** 标记文本按目标文档行尾归一（LF 形态 '\n\n^id' → CRLF '\r\n\r\n^id'） */
function markerForDoc(lfMarker: string, crlf: boolean): string {
  return crlf ? lfMarker.replace(/\n/g, '\r\n') : lfMarker
}

/** 来源 LF 全文中是否存在**结构上**指向 blockId 的块引用（F7）：逐行扫描
 *  合法双链并经 parseWikilinkInner 全等比对——`#^id` 以纯文本/代码块形态
 *  出现不算引用（不撤回真实链接的标记，也不被文本巧合误留） */
function originTextReferencesBlockId(lfText: string, blockId: string): boolean {
  if (blockId === '') {
    return false
  }
  for (const rawLine of lfText.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    for (const occurrence of scanWikilinksInLine(line)) {
      const parsed = parseWikilinkInner(occurrence.inner)
      if (parsed !== null && parsed.blockId === blockId) {
        return true
      }
    }
  }
  return false
}

export class WikilinkBlockIdCoordinator {
  private readonly ports: BlockIdCoordinatorPorts
  /** 来源 docUri → 活动记录（链接级粒度，少量） */
  private readonly records = new Map<string, BlockIdRecord[]>()
  /** 来源 docUri → 串行队列尾（F1：异步入口互斥——读 records 到 set 的
   *  await 窗口内并发入口会以陈旧快照覆盖写，丢失/复活记录或双 withdraw） */
  private readonly originQueues = new Map<string, Promise<unknown>>()

  constructor(ports: BlockIdCoordinatorPorts) {
    this.ports = ports
  }

  /**
   * per-origin 串行执行（F1 修复）：onHistoryApplied / cancelAccept /
   * disposeOrigin / registerPending 的 records 读写全部入队——同一来源的
   * 操作链式排队，前一任务完成（含失败）后下一个才开始，records 读写天然
   * 互斥。队列尾完成时清 entry（空队列不留泄漏）。不同来源互不阻塞。
   */
  private runExclusive<T>(originDocUri: string, task: () => Promise<T> | T): Promise<T> {
    const prev = this.originQueues.get(originDocUri) ?? Promise.resolve()
    const run = prev.then(task, task)
    const tail = run.then(
      () => { this.releaseQueueTail(originDocUri, tail) },
      () => { this.releaseQueueTail(originDocUri, tail) },
    )
    this.originQueues.set(originDocUri, tail)
    return run
  }

  private releaseQueueTail(originDocUri: string, tail: Promise<void>): void {
    if (this.originQueues.get(originDocUri) === tail) {
      this.originQueues.delete(originDocUri)
    }
  }

  /**
   * 登记补 ID 记录（accept 补写成功后；sameDoc 合笔路径不登记——同文档
   * undo 一笔回退标记与链接，天然同步无需协调，V01 场景 2）。
   */
  registerPending(input: {
    reqId: number
    originDocUri: string
    targetFsPath: string
    id: string
    /** LF 形态标记文本（'\n\n^id'） */
    markerLf: string
    /** 宿主系插入点 */
    offset: number
    /** 补 ID 生效后的目标版本 */
    versionAfterInsert: number
    /** accept 时块首行（1-based） */
    blockFirstLine: number
    targetCrlf: boolean
  }): void {
    // F1：写点入 per-origin 串行队列（fire-and-forget）——异步入口挂起
    //（读盘 await）期间到达的新登记不被其后的 records.set 陈旧快照覆盖
    // 丢失；调用方无需等待（后续 cancel/undo 消息经消息桥，晚于本微任务）
    void this.runExclusive(input.originDocUri, () => {
      const list = this.records.get(input.originDocUri) ?? []
      list.push({
        reqId: input.reqId,
        originDocUri: input.originDocUri,
        targetFsPath: input.targetFsPath,
        blockFirstLine: input.blockFirstLine,
        id: input.id,
        marker: markerForDoc(input.markerLf, input.targetCrlf),
        offset: input.offset,
        versionAfterInsert: input.versionAfterInsert,
        confirmed: false,
        everReferenced: false,
        versionAfterWithdraw: -1,
      })
      this.records.set(input.originDocUri, list)
    })
  }

  /** 链接落地确认（wikilink.block.linked）：因果成立，历史协调激活 */
  confirmLinked(originDocUri: string, reqId: number): void {
    for (const record of this.recordsOf(originDocUri)) {
      if (record.reqId === reqId) {
        record.confirmed = true
      }
    }
  }

  /** 来源权威文本变更观察（回流广播点）：单调刷新 everReferenced */
  observeOriginText(originDocUri: string): void {
    const list = this.records.get(originDocUri)
    if (!list || list.length === 0) {
      return
    }
    const text = this.ports.getOriginText(originDocUri)
    if (text === null) {
      return
    }
    for (const record of list) {
      if (!record.everReferenced && text.includes(`#^${record.id}`)) {
        record.everReferenced = true
      }
    }
  }

  /**
   * 接受放弃（wikilink.block.cancel）：宿主补 ID 成功但来源侧最终未插入
   * 链接——尽力收尾撤回（V01 场景 6），风险时保留并提示；记录移除。
   */
  async cancelAccept(originDocUri: string, reqId: number): Promise<void> {
    // F1：records 读写入 per-origin 串行队列
    await this.runExclusive(originDocUri, async () => {
      const list = this.recordsOf(originDocUri)
      const keep: BlockIdRecord[] = []
      for (const record of list) {
        if (record.reqId === reqId && !record.confirmed) {
          await this.withdraw(record)
        } else {
          keep.push(record)
        }
      }
      this.records.set(originDocUri, keep)
    })
  }

  /**
   * 来源 undo/redo 落定后的协调（V01 核心）：undo 后引用消失 → 尽力撤回；
   * redo 后引用重现 → 重核目标（在场复用 / 已撤按原 id 重建 / 被改写认
   * 用户的）。来源撤销不被撤回失败阻塞（观察点在 undo 完成之后，全部
   * 动作 best-effort）。
   */
  async onHistoryApplied(originDocUri: string, op: 'undo' | 'redo'): Promise<void> {
    // F1：records 读写入 per-origin 串行队列——连续 undo/redo 交错时后一
    // 操作必在前一操作的撤回/重核与 records.set 完成后才开始（陈旧快照
    // 不再覆盖写、同一记录不双 withdraw）
    await this.runExclusive(originDocUri, async () => {
      const list = this.recordsOf(originDocUri)
      if (list.length === 0) {
        return
      }
      const text = this.ports.getOriginText(originDocUri)
      if (text === null) {
        this.records.delete(originDocUri)
        return
      }
      const keep: BlockIdRecord[] = []
      for (const record of list) {
        if (!record.confirmed) {
          keep.push(record) // linked 未到：不做历史协调（可恢复暂停场景不误撤）
          continue
        }
        const referenced = text.includes(`#^${record.id}`)
        if (op === 'undo' && !referenced && record.everReferenced) {
          // 来源链接被撤销 → 尽力撤回本次新增标记（V01 双守卫）
          const outcome = await this.withdraw(record)
          if (outcome.kept) {
            // 保留（风险/失败）：标记在场，后续 redo 重核可复用
            record.everReferenced = false
            keep.push(record)
          } else {
            // 撤回成功：记录留存待 redo 重核重建（标记已不在，版本守卫换轨）
            const after = await this.ports.openTarget(record.targetFsPath)
            record.versionAfterWithdraw = after !== null ? after.version : -1
            record.everReferenced = false
            keep.push(record)
          }
          continue
        }
        if (op === 'redo' && referenced) {
          // 来源链接重现（重做/再次接受）→ 重核目标
          const next = await this.recheckAfterRedo(record)
          if (next !== null) {
            keep.push(next)
          }
          continue
        }
        keep.push(record)
      }
      this.records.set(originDocUri, keep)
    })
  }

  /**
   * 来源会话退役（全部面板关闭）：未落地 pending 尽力收尾撤回（V01 场景
   * 6/7 收尾）；已落地记录按 origin-closed 移除并保留标记（迟到协调拒收
   * ——不动目标、不抛异常）。
   * F7 修复：unconfirmed 记录先核对来源权威文本——linked 回包晚于 dispose
   * 到达（已 post 未投递）时链接已落权威文本，此时链接真实在场，按
   * origin-closed **保留标记**收尾（撤回会把用户可见的有效引用打成悬空）；
   * 权威文本结构上确无该块引用（parseWikilinkInner 全等比对）才收尾撤回。
   */
  async disposeOrigin(originDocUri: string): Promise<void> {
    // F1：records 读写入 per-origin 串行队列
    await this.runExclusive(originDocUri, async () => {
      const list = this.records.get(originDocUri)
      if (!list) {
        return
      }
      const text = this.ports.getOriginText(originDocUri)
      for (const record of list) {
        if (!record.confirmed) {
          const referenced = text !== null && originTextReferencesBlockId(text, record.id)
          if (!referenced) {
            await this.withdraw(record)
          }
        }
      }
      this.records.delete(originDocUri)
    })
  }

  /** 全量退役（扩展停用） */
  async disposeAll(): Promise<void> {
    for (const docUri of [...this.records.keys()]) {
      await this.disposeOrigin(docUri)
    }
  }

  private recordsOf(originDocUri: string): BlockIdRecord[] {
    return this.records.get(originDocUri) ?? []
  }

  /** 尽力撤回（V01 双守卫 + 新使用检查；正向 delete，绝不 undo）。
   *  F2 修复：openTarget 快照经 hasOtherReferences 读盘 await 后守卫仍用
   *  旧快照——deleteRange 执行前以活文档重读复核双守卫（版本不等或标记
   *  不在记录 offset 逐字在场即放弃并走保留分支），不按陈旧 offset
   *  positionAt 删错正文；复核读与 WorkspaceEdit 构造在同一同步段。 */
  private async withdraw(record: BlockIdRecord): Promise<WithdrawOutcome> {
    const target = await this.ports.openTarget(record.targetFsPath)
    if (target === null) {
      this.ports.notifyKept('not-found', record.id)
      return { kept: true, reason: 'not-found' }
    }
    if (this.ports.hasOtherReferences !== undefined) {
      const otherUse = await this.ports.hasOtherReferences(
        record.targetFsPath, record.id, record.originDocUri)
      if (otherUse === true) {
        this.ports.notifyKept('new-use', record.id)
        return { kept: true, reason: 'new-use' }
      }
    }
    const verdict = withdrawalGuard(record, { text: target.text, version: target.version })
    if (verdict.action === 'keep') {
      this.ports.notifyKept(verdict.reason, record.id)
      return { kept: true, reason: verdict.reason }
    }
    // F2 TOCTOU 复核：读盘窗口内目标可能已变——重新装载活文档复核双守卫
    const live = await this.ports.openTarget(record.targetFsPath)
    if (live === null) {
      this.ports.notifyKept('not-found', record.id)
      return { kept: true, reason: 'not-found' }
    }
    const liveVerdict = withdrawalGuard(record, { text: live.text, version: live.version })
    if (liveVerdict.action === 'keep') {
      this.ports.notifyKept(liveVerdict.reason, record.id)
      return { kept: true, reason: liveVerdict.reason }
    }
    const ok = await live.deleteRange(liveVerdict.offset, liveVerdict.length)
    if (!ok) {
      this.ports.notifyKept('apply-failed', record.id)
      return { kept: true, reason: 'apply-failed' }
    }
    return { kept: false, reason: 'withdrawn' }
  }

  /**
   * 重做重核（V01 场景 1/5）：id 标记在场 → 复用（含用户挪动标记位置时
   * 刷新记录坐标）；已安全撤回 → 按记录块首行重建**原 id**（行号可信度
   * 由「目标版本 == 撤回后版本」守卫，块结构变化即放弃）；块被用户改写
   * （新标记占了块）→ 认用户的、静默退出；id 被挪用到他块 → 提示并退出
   * （不复活他人改写）。返回更新后的记录（null = 退出协调）。
   */
  private async recheckAfterRedo(record: BlockIdRecord): Promise<BlockIdRecord | null> {
    const target = await this.ports.openTarget(record.targetFsPath)
    if (target === null) {
      return record // 目标暂不可读（竞态）：留存记录，下次历史操作再核
    }
    // 1) 标记在场（原 id）→ 复用，刷新坐标（用户可能挪过标记位置）
    const anchorLine = findBlockFirstLineById(target.text, record.id)
    if (anchorLine !== null) {
      const plan = planTargetBlockId(target.text, anchorLine)
      if (plan !== null && plan.kind === 'reused' && plan.id === record.id) {
        return { ...record, everReferenced: true, versionAfterWithdraw: -1 }
      }
    }
    // 2) 已撤回路径：行号可信度守卫（目标自撤回后未变）
    if (record.versionAfterWithdraw < 0 || target.version !== record.versionAfterWithdraw) {
      // 标记不在场且无法安全锚定（未走过撤回 / 块结构已变）：静默退出
      return null
    }
    const plan = planTargetBlockId(target.text, record.blockFirstLine)
    if (plan === null) {
      return null // 块首行已非可引用块（结构变化）：静默退出
    }
    if (plan.kind === 'reused') {
      // 块已有别的标记（用户改写/挪用）→ 认用户的，不复活旧标记（V01
      // 场景 5 变体：认用户新标记）
      return null
    }
    if (collectBlockIds(target.text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))).has(record.id)) {
      // 原 id 已被他块挪用：不复活（链接将指到用户的块，留待用户处置）
      this.ports.notifyRebuildFailed(record.id)
      return null
    }
    // 重建原 id（链接引用保持有效；V01 场景 1 重做重建路径）
    const markerLf = `\n\n^${record.id}`
    const ok = await target.insertAt(plan.insertOffset, markerForDoc(markerLf, target.crlf))
    if (!ok) {
      this.ports.notifyRebuildFailed(record.id)
      return record
    }
    const after = await this.ports.openTarget(record.targetFsPath)
    return {
      ...record,
      marker: markerForDoc(markerLf, target.crlf),
      offset: plan.insertOffset,
      versionAfterInsert: after !== null ? after.version : record.versionAfterInsert,
      versionAfterWithdraw: -1,
      everReferenced: true,
    }
  }
}

/** 按块 id 反查块首行（1-based；三形态行扫描，独立行标记归属上方块——
 *  与 findBlockOffset 的 locateBlockAnchor 同口径的行号版）。未命中 null */
function findBlockFirstLineById(text: string, blockId: string): number | null {
  if (blockId === '') {
    return null
  }
  const lines = text.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (blockIdOfLine(line) === blockId) {
      return i + 1
    }
    if (standaloneBlockIdOf(line) === blockId) {
      let above = i - 1
      while (above >= 0 && lines[above]!.trim() === '') {
        above -= 1
      }
      return above >= 0 ? above + 1 : null
    }
  }
  return null
}
