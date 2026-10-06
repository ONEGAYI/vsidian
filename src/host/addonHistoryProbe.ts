// V01（#348）附加组件历史分组——宿主侧验证探针（**实验件，非生产实现**）。
//
// 仅在 VSIDIAN_TEST_HOOKS=1 时由 textEditorProvider 装配（生产 VSIX 不含
// 任何行为差异）。职责：把 AddonHistoryGrouping 纯逻辑接到**真实的**版本/
// 增量/ack 管线上验证：
// - 包装 HostDocumentPort：applyChanges 记录前向条目（真实 WorkspaceEdit 前
//   后版本/文本快照，按提交意图对位打来源标签）；undo/redo 按「组」展开为
//   连续原生步骤并逐步核对预期回流（版本 +1 且文本恰为记录边界），失配即
//   中止剩余步骤并标记 lost。
// - 修饰提交走真实链路：虚拟面板（attachPanel + ready 注入，引用目标带
//   refOrigin）→ edit.request → 会话队列 → WorkspaceEdit → edit.ack——
//   不绕过 DocumentSession。
// - 外部（原生编辑器/宿主入口）单步 Undo/Redo 回流经 onDidChangeTextDocument
//   对账：命中则完成组内剩余步骤（执行前核对栈顶条目，防止外部写入插入后
//   撤错条目）；未命中 → lost，此后一切协调明确拒绝、不执行任何步骤。
// - 引用 B 的整组历史走「一次临时激活执行全组、结束后才恢复来源 A」的
//   批量路由（对既有单步 historyViaTempActivation 的组化验证）。
//
// 已知边界（票面口径）：探针文本状态固定互不重复以便边界对账；生产实现
// 不依赖文本全等，须接入 T03（#352）的来源元数据管线。
import * as vscode from 'vscode'
import {
  AddonHistoryGrouping,
  type AddonHistoryPlan,
  type AddonHistoryStep,
  type AddonHistorySnapshot,
} from '../shared/addonHistoryGrouping'
import type { DocumentSession, HostDocumentPort, PanelPort } from './documentSession'
import type { HostToWebview, SerChange, WebviewToHost } from '../shared/protocol'

/** 探针依赖（provider 闭包注入，避免探针耦合其内部结构） */
export interface AddonHistoryProbeDeps {
  /** 自定义编辑器 viewType（恢复来源面板用） */
  viewType: string
  /** 目标会话与权威文档；B 目标由该回调按需 openTextDocument + openEntry */
  ensureSession: (uriStr: string) => Promise<{ session: DocumentSession; doc: vscode.TextDocument } | undefined>
  /** 活动 tab 是否为目标文档的 custom editor（C-5 守卫复用） */
  isActiveCustomEditor: (uriStr: string) => boolean
  /** 来源面板是否仍在（恢复 A 前检查；refOrigin 场景） */
  hasSourcePanels: (uriStr: string) => boolean
}

export interface AddonHistorySubmitInput {
  opId: string
  atomic: boolean
  /** LF 坐标变更（与 webview edit.request 同一坐标系；探针 fixture 为 LF 文档） */
  changes: SerChange[]
  /** 引用目标：携带时虚拟面板带 refOrigin（B 的历史走临时激活路由） */
  refOriginUri?: string
}

export type AddonHistorySubmitResult =
  | { ok: true; opId: string; groupId: string; ackVersion: number; entrySeq: number }
  | { ok: false; opId: string; reason: 'boundary-unavailable' | 'mapping-lost' | 'ack-timeout' | 'ack-rejected' | 'no-session' }

export interface AddonHistoryExecReport {
  plan: AddonHistoryPlan
  executedSteps: number
  aborted?: 'version-mismatch' | 'text-mismatch' | 'guard-inactive-tab' | 'completion-precondition'
  finalVersion: number
  finalText: string
  /** 逐步观测（诊断用；history() 派生报告时透传最近一次执行的记录） */
  stepLog?: { expect: string }[]
}

interface ProbePanel {
  virtualSessionId: string
  refOrigin?: { docUri: string }
  seq: number
  lastAck?: { seq: number; ok: boolean; version: number }
}

interface EvidenceEvent {
  source: 'self' | 'external' | 'foreign-write' | 'route'
  op?: 'undo' | 'redo'
  version: number
  text: string
  note?: string
}

/** 单目标探针 */
class AddonHistoryProbe {
  private grouping = new AddonHistoryGrouping()
  private readonly panels = new Map<string, ProbePanel>()
  private lastKnown: { version: number; text: string }
  private lastRejection: string | undefined
  private lastExec: AddonHistoryExecReport | undefined
  readonly evidence: EvidenceEvent[] = []
  /** 自驱步骤的预期终态（版本唯一）：回流事件据此吸收，避免自驱回流被当外部对账。
   *  条目在单步命令发出**前**压栈——事件可能在命令 resolve 与轮询之间到达 */
  private readonly recentSelfSteps: { op: 'undo' | 'redo'; version: number; text: string }[] = []
  /** wrapper.applyChanges 在途标志：前向事件由 wrapper 记录，listener 不重复记 */
  private applying = 0
  /** 提交意图（变更数组对位）：wrapper 据此给条目打来源标签；到达序与队列序
   *  不保证一致，靠内容对位而不是先来后到 */
  private pendingIntent: { tag: { opId: string; groupId: string; atomic: boolean }; changes: SerChange[] } | undefined
  /** 每目标串行链：历史请求、回流补完、提交对账全部串行（票面要求） */
  chain: Promise<void> = Promise.resolve()

  constructor(
    readonly uriStr: string,
    private readonly doc: vscode.TextDocument,
    private readonly session: DocumentSession,
    private readonly deps: AddonHistoryProbeDeps,
  ) {
    this.lastKnown = { version: doc.version, text: doc.getText() }
  }

  /** 重启模拟：丢弃映射，按宿主实际保留状态从零对账（对不上即 lost） */
  adoptGrouping(fresh: AddonHistoryGrouping): void {
    this.grouping = fresh
    this.recentSelfSteps.length = 0
    this.pendingIntent = undefined
  }

  get lost(): boolean {
    return this.grouping.lost
  }

  /** wrapper.applyChanges 调用（真实 WorkspaceEdit 前后快照 → 条目） */
  async recordApply(base: HostDocumentPort, changes: SerChange[]): Promise<boolean> {
    const before = { version: base.version, text: base.getText() }
    this.applying += 1
    let ok = false
    try {
      ok = await base.applyChanges(changes)
      if (ok) {
        const after = { version: base.version, text: base.getText() }
        const intent = this.pendingIntent
        if (intent && sameChanges(intent.changes, changes)) {
          this.pendingIntent = undefined
          this.grouping.noteForwardEntry({
            owner: 'addon',
            opId: intent.tag.opId,
            groupId: intent.tag.groupId,
            atomic: intent.tag.atomic,
            versionBefore: before.version,
            textBefore: before.text,
            versionAfter: after.version,
            textAfter: after.text,
          })
        } else {
          // 队列中先落地的其他面板写入（真实 webview 用户输入等）：外来条目
          this.grouping.noteForwardEntry({
            owner: 'foreign',
            versionBefore: before.version,
            textBefore: before.text,
            versionAfter: after.version,
            textAfter: after.text,
          })
        }
        this.lastKnown = after
      }
    } finally {
      this.applying -= 1
    }
    return ok
  }

  /** wrapper.undo/redo：按组展开执行（每步验证回流） */
  async executeGroup(op: 'undo' | 'redo', origin: { docUri: string } | undefined): Promise<boolean> {
    const plan = this.grouping.planHistory(op)
    if (plan.kind === 'reject') {
      this.lastRejection = plan.reason
      this.lastExec = { plan, executedSteps: 0, finalVersion: this.doc.version, finalText: this.doc.getText() }
      return false
    }
    const report = await this.runSteps(op, plan.steps, origin)
    this.lastExec = report
    return report.executedSteps > 0
  }

  /** 目标当前可用的单步执行上下文（绝不作用于其他文档） */
  private executionContext(origin: { docUri: string } | undefined): 'custom-editor' | 'native-editor' | 'origin-route' | 'none' {
    if (this.deps.isActiveCustomEditor(this.uriStr)) {
      return 'custom-editor'
    }
    const active = vscode.window.activeTextEditor
    if (active && active.document.uri.toString() === this.uriStr) {
      return 'native-editor'
    }
    if (origin !== undefined) {
      return 'origin-route'
    }
    return 'none'
  }

  /** 步骤执行器：路由（root 活动守卫 / B 批量临时激活）+ 每步版本/文本核对 */
  private async runSteps(
    op: 'undo' | 'redo',
    steps: AddonHistoryStep[],
    origin: { docUri: string } | undefined,
  ): Promise<AddonHistoryExecReport> {
    const plan: AddonHistoryPlan = { kind: 'execute', op, steps }
    const doc = this.doc
    const context = this.executionContext(origin)
    if (context === 'none') {
      // C-5 守卫：目标既非活动 custom editor 也非活动文本编辑器、又无来源路由
      // ——明确拒绝，不撤销其他文档
      this.lastRejection = 'guard-inactive-tab'
      return { plan, executedSteps: 0, aborted: 'guard-inactive-tab', finalVersion: doc.version, finalText: doc.getText() }
    }

    let executed = 0
    let aborted: AddonHistoryExecReport['aborted'] | undefined
    // B 批量路由：一次临时激活执行整组，结束后才恢复来源 A（票面口径）
    let tabsBefore: Set<vscode.Tab> | undefined
    if (context === 'origin-route') {
      tabsBefore = new Set(
        vscode.window.tabGroups.all.flatMap((g) => g.tabs).filter((t) =>
          t.input instanceof vscode.TabInputText &&
          t.input.uri.toString() === this.uriStr))
      try {
        await vscode.window.showTextDocument(doc, { preview: true })
      } catch {
        this.lastRejection = 'guard-inactive-tab'
        return { plan, executedSteps: 0, aborted: 'guard-inactive-tab', finalVersion: doc.version, finalText: doc.getText() }
      }
    }

    for (const step of steps) {
      const beforeVersion = doc.version
      // 预期终态先压栈（回流事件可能早于命令 promise resolve 到达）
      this.recentSelfSteps.push({ op, version: beforeVersion + 1, text: step.expectText })
      const ran = await vscode.commands.executeCommand(op).then(() => true, () => false)
      if (!ran) {
        this.dropSelfStep(beforeVersion + 1)
        break
      }
      const settled = await waitDocState(doc, beforeVersion + 1, step.expectText, 4000)
      this.grouping.commitSteps(op, [step])
      executed += 1
      this.lastKnown = { version: doc.version, text: doc.getText() }
      if (!settled) {
        aborted = doc.version === beforeVersion + 1 ? 'text-mismatch' : 'version-mismatch'
        this.grouping.markLost()
        this.lastRejection = aborted
        break
      }
    }

    const stepLog = steps.map((st) => ({ expect: st.expectText }))
    if (context === 'origin-route' && origin) {
      // 整组完成后恢复来源 A（面板仍在一侧时）；失败不回滚 B（与既有路由同语义）
      if (this.deps.hasSourcePanels(origin.docUri)) {
        try {
          await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.parse(origin.docUri), this.deps.viewType)
        } catch {
          // 来源面板关闭竞态：保留当前激活态
        }
      }
      // 收口差分关临时标签——**仅限目标模型非脏**：1.82.3 实测关闭脏文本
      // 标签会静默丢弃未保存修改（版本 +1 回落盘面，重做结果全失）。脏态
      // 保留临时标签（激活态已在 A），生产协议须同样避免脏态收口丢弃——
      // 这是 T03 接入点必须处理的边界
      let keptTempTabs = false
      if (!doc.isDirty) {
        for (const group of vscode.window.tabGroups.all) {
          for (const tab of group.tabs) {
            if (
              tab.input instanceof vscode.TabInputText &&
              tab.input.uri.toString() === this.uriStr &&
              !tabsBefore!.has(tab)
            ) {
              await vscode.window.tabGroups.close(tab).then(undefined, () => undefined)
            }
          }
        }
      } else {
        keptTempTabs = true
      }
      if (keptTempTabs) {
        this.evidence.push({ source: 'route', version: doc.version, text: doc.getText(), note: 'kept-temp-tabs(dirty)' })
      }
    }
    return {
      plan,
      executedSteps: executed,
      ...(aborted !== undefined ? { aborted } : {}),
      finalVersion: doc.version,
      finalText: doc.getText(),
      stepLog,
    }
  }

  private dropSelfStep(version: number): void {
    const idx = this.recentSelfSteps.findIndex((s) => s.version === version)
    if (idx >= 0) {
      this.recentSelfSteps.splice(idx, 1)
    }
  }

  /** 建虚拟面板（ready 注入）——提交与历史请求都经它走真实会话链路 */
  ensurePanel(refOriginUri?: string): string {
    const existing = [...this.panels.values()].find((p) => p.refOrigin?.docUri === refOriginUri)
    if (existing) {
      return existing.virtualSessionId
    }
    const panel: ProbePanel = {
      virtualSessionId: '',
      ...(refOriginUri !== undefined ? { refOrigin: { docUri: refOriginUri } } : {}),
      seq: 1,
    }
    const port: PanelPort = {
      send: (message: HostToWebview) => {
        if (message.kind === 'edit.ack') {
          panel.lastAck = { seq: message.seq, ok: message.ok, version: message.version }
        }
        // init/doc.changed 等广播忽略（真实 webview 消费；探针经权威文档观测）
      },
    }
    panel.virtualSessionId = this.session.attachPanel(port, panel.refOrigin ? { refOrigin: panel.refOrigin } : undefined)
    this.panels.set(panel.virtualSessionId, panel)
    void this.session.handleWebviewMessage({ kind: 'ready' } as WebviewToHost, panel.virtualSessionId)
    return panel.virtualSessionId
  }

  /** 修饰提交：planSubmit → 真实 edit.request → ack 版本对位复核 */
  submit(input: AddonHistorySubmitInput): Promise<AddonHistorySubmitResult> {
    const check = this.grouping.planSubmit(input.opId, input.atomic)
    if (!check.ok) {
      this.lastRejection = check.reason
      return Promise.resolve({ ok: false, opId: input.opId, reason: check.reason })
    }
    const virtualSessionId = this.ensurePanel(input.refOriginUri)
    const panel = this.panels.get(virtualSessionId)!
    const seq = panel.seq++
    panel.lastAck = undefined
    this.pendingIntent = { tag: { opId: input.opId, groupId: check.groupId, atomic: input.atomic }, changes: input.changes }
    const task = this.chain.then(async (): Promise<AddonHistorySubmitResult> => {
      void this.session.handleWebviewMessage({
        kind: 'edit.request',
        sessionId: virtualSessionId,
        docUri: this.uriStr,
        seq,
        baseVersion: this.doc.version,
        changes: input.changes,
      } as WebviewToHost, virtualSessionId)
      const ack = await waitFor(() => panel.lastAck, 5000)
      if (!ack) {
        this.pendingIntent = undefined
        return { ok: false, opId: input.opId, reason: 'ack-timeout' }
      }
      if (!ack.ok) {
        // 冲突/失败：不留成功来源记录（条目未产生——applyChanges 未成功）
        this.pendingIntent = undefined
        return { ok: false, opId: input.opId, reason: 'ack-rejected' }
      }
      const entry = this.grouping.entryAtVersion(ack.version)
      this.pendingIntent = undefined
      if (!entry || entry.opId !== input.opId) {
        // ack 版本对不上提交意图：不认领，避免错标他人条目
        return { ok: false, opId: input.opId, reason: 'ack-rejected' }
      }
      return { ok: true, opId: input.opId, groupId: check.groupId, ackVersion: ack.version, entrySeq: entry.seq }
    })
    this.chain = task.then(() => undefined, () => undefined)
    return task
  }

  /** 组历史请求：经虚拟面板 history.request → 会话队列 → wrapper 展开执行。
   *  报告由权威状态派生（应用指针位移 + lost），不读共享执行报告——并发
   *  连按时后一个请求的执行可能在本次 await 返回前覆写共享字段；基线在
   *  本目标串行链内、请求实际发出前一刻捕获（并发连按下各请求看到前序
   *  请求落定后的指针，在途 ack 场景下能看到已排队编辑）。 */
  async history(op: 'undo' | 'redo', refOriginUri?: string): Promise<AddonHistoryExecReport & { rejected?: string }> {
    const virtualSessionId = this.ensurePanel(refOriginUri)
    const task = this.chain.then(async () => {
      const beforeApplied = this.grouping.appliedCount
      await this.session.handleWebviewMessage({ kind: 'history.request', op } as WebviewToHost, virtualSessionId)
      const executedSteps = Math.abs(this.grouping.appliedCount - beforeApplied)
      const rejected = executedSteps === 0
        ? (this.grouping.lost ? 'mapping-lost' : 'empty')
        : undefined
      if (rejected !== undefined) {
        this.lastRejection = rejected
      }
      return {
        plan: { kind: 'execute', op, steps: [] } as AddonHistoryPlan,
        executedSteps,
        ...(rejected !== undefined ? { rejected } : {}),
        finalVersion: this.doc.version,
        finalText: this.doc.getText(),
        ...(this.lastExec?.stepLog ? { stepLog: this.lastExec.stepLog } : {}),
      }
    })
    this.chain = task.then(() => undefined, () => undefined)
    return task
  }

  /** 外部单步撤销/重做回流对账 + 组完成（listener 调用；补完串行挂 chain） */
  noteBackflow(op: 'undo' | 'redo', version: number, text: string): void {
    // 自驱回流吸收：版本唯一且单调，相等即同一次变更
    const selfIdx = this.recentSelfSteps.findIndex((s) => s.version === version && s.text === text)
    if (selfIdx >= 0) {
      this.recentSelfSteps.splice(selfIdx, 1)
      this.evidence.push({ source: 'self', op, version, text })
      return
    }
    const result = op === 'undo'
      ? this.grouping.noteUndoBackflow(text, version)
      : this.grouping.noteRedoBackflow(text, version)
    this.evidence.push({ source: 'external', op, version, text })
    if (!result.matched) {
      this.grouping.markLost()
      this.lastRejection = 'mapping-lost'
      return
    }
    this.lastKnown = { version, text }
    if (result.completion.length > 0) {
      const entrySeq = result.completion[0].entrySeq
      // 执行前核对（方向按补完类型取位）：undo 补完的下一个被撤对象是
      // 当前已应用栈顶；redo 补完的下一个重做对象是可重做区底。外部写入
      // 若已插入（对象错位），明确拒绝执行、不撤错条目
      const entries = this.grouping.listEntries()
      const target = op === 'undo'
        ? entries[this.grouping.appliedCount - 1]
        : entries[this.grouping.appliedCount]
      if (!target || target.seq !== entrySeq) {
        this.grouping.markLost()
        this.lastRejection = 'completion-precondition'
        return
      }
      const origin = [...this.panels.values()].find((p) => p.refOrigin !== undefined)?.refOrigin
      void this.chain.then(async () => {
        const report = await this.runSteps(op, result.completion, origin)
        this.lastExec = report
      })
    }
  }

  /** 外部前向写入（无 reason）：applying 在途忽略（wrapper 已记），否则记 foreign 条目 */
  noteForeignForward(version: number, text: string): void {
    if (this.applying > 0) {
      return
    }
    if (this.grouping.entryAtVersion(version)) {
      return // wrapper 同步路径已记录
    }
    this.grouping.noteForwardEntry({
      owner: 'foreign',
      versionBefore: this.lastKnown.version,
      textBefore: this.lastKnown.text,
      versionAfter: version,
      textAfter: text,
    })
    this.lastKnown = { version, text }
    this.evidence.push({ source: 'foreign-write', version, text })
  }

  state(): Record<string, unknown> {
    return {
      uri: this.uriStr,
      lost: this.grouping.lost,
      appliedCount: this.grouping.appliedCount,
      lastRejection: this.lastRejection ?? null,
      entries: this.grouping.listEntries().map((e) => ({
        seq: e.seq, owner: e.owner, opId: e.opId ?? null, groupId: e.groupId ?? null,
        atomic: e.atomic ?? null, versionBefore: e.versionBefore, versionAfter: e.versionAfter,
        textBefore: e.textBefore, textAfter: e.textAfter,
      })),
      evidence: this.evidence.slice(-40),
      version: this.doc.version,
      text: this.doc.getText(),
    }
  }

  snapshot(): AddonHistorySnapshot {
    return this.grouping.snapshot()
  }

  restore(snap: AddonHistorySnapshot): void {
    this.grouping.restore(snap, { version: this.doc.version, text: this.doc.getText() })
  }

  resetMapping(): void {
    this.grouping.markLost()
    this.recentSelfSteps.length = 0
    this.pendingIntent = undefined
    this.lastRejection = 'reset'
  }

  dispose(): void {
    for (const virtualSessionId of [...this.panels.keys()]) {
      this.session.detachPanel(virtualSessionId)
    }
    this.panels.clear()
  }
}

/** 探针集线器：目标注册表 + 端口包装 + 文档事件路由（provider 注入依赖） */
export class AddonHistoryProbeHub {
  private readonly probes = new Map<string, AddonHistoryProbe>()
  private listener: vscode.Disposable | undefined

  constructor(private readonly deps: AddonHistoryProbeDeps) {}

  /** provider openEntry 调用：包装端口（未 attach 的目标纯透传，零行为差异） */
  wrapPort(base: HostDocumentPort, doc: vscode.TextDocument): HostDocumentPort {
    const uriStr = doc.uri.toString()
    const hub = this
    const wrapper: HostDocumentPort = {
      get version() {
        return base.version
      },
      eol: base.eol,
      getText: () => base.getText(),
      applyChanges: (changes) => {
        const probe = hub.probes.get(uriStr)
        if (!probe) {
          return base.applyChanges(changes)
        }
        return probe.recordApply(base, changes)
      },
      undo: (origin) => {
        const probe = hub.probes.get(uriStr)
        if (!probe) {
          return base.undo(origin)
        }
        return probe.executeGroup('undo', origin)
      },
      redo: (origin) => {
        const probe = hub.probes.get(uriStr)
        if (!probe) {
          return base.redo(origin)
        }
        return probe.executeGroup('redo', origin)
      },
    }
    return wrapper
  }

  /** 文档事件路由（TEST_HOOKS 装配时注册一次） */
  start(): void {
    if (this.listener) {
      return
    }
    this.listener = vscode.workspace.onDidChangeTextDocument((event) => {
      const uriStr = event.document.uri.toString()
      const probe = this.probes.get(uriStr)
      if (!probe || event.contentChanges.length === 0) {
        return
      }
      const version = event.document.version
      const text = event.document.getText()
      const reason = event.reason === vscode.TextDocumentChangeReason.Undo
        ? 'undo' as const
        : event.reason === vscode.TextDocumentChangeReason.Redo
          ? 'redo' as const
          : undefined
      if (reason) {
        probe.noteBackflow(reason, version, text)
      } else {
        probe.noteForeignForward(version, text)
      }
    })
  }

  dispose(): void {
    this.listener?.dispose()
    this.listener = undefined
    for (const probe of this.probes.values()) {
      probe.dispose()
    }
    this.probes.clear()
  }

  async attach(uriStr: string): Promise<Record<string, unknown>> {
    const entry = await this.deps.ensureSession(uriStr)
    if (!entry) {
      throw new Error(`无可用会话：${uriStr}`)
    }
    let probe = this.probes.get(uriStr)
    if (!probe) {
      probe = new AddonHistoryProbe(uriStr, entry.doc, entry.session, this.deps)
      this.probes.set(uriStr, probe)
    }
    probe.ensurePanel()
    return probe.state()
  }

  async submit(uriStr: string, input: AddonHistorySubmitInput): Promise<AddonHistorySubmitResult> {
    const probe = this.probes.get(uriStr)
    if (!probe) {
      throw new Error(`探针未 attach：${uriStr}`)
    }
    return probe.submit(input)
  }

  async history(uriStr: string, op: 'undo' | 'redo', refOriginUri?: string): Promise<Record<string, unknown>> {
    const probe = this.probes.get(uriStr)
    if (!probe) {
      throw new Error(`探针未 attach：${uriStr}`)
    }
    return probe.history(op, refOriginUri) as unknown as Record<string, unknown>
  }

  state(uriStr: string): Record<string, unknown> {
    const probe = this.probes.get(uriStr)
    if (!probe) {
      return { found: false }
    }
    return probe.state()
  }

  snapshot(uriStr: string): unknown {
    const probe = this.probes.get(uriStr)
    if (!probe) {
      throw new Error(`探针未 attach：${uriStr}`)
    }
    return probe.snapshot()
  }

  restore(uriStr: string, snap: unknown): Record<string, unknown> {
    const probe = this.probes.get(uriStr)
    if (!probe) {
      throw new Error(`探针未 attach：${uriStr}`)
    }
    probe.restore(snap as AddonHistorySnapshot)
    return probe.state()
  }

  resetMapping(uriStr: string): Record<string, unknown> {
    const probe = this.probes.get(uriStr)
    if (!probe) {
      throw new Error(`探针未 attach：${uriStr}`)
    }
    probe.resetMapping()
    return probe.state()
  }

  /** 重建映射（模拟重启后按宿主实际保留历史重建协调器）：无快照可对账时
   *  直接 lost——宿主可能仍保留历史，但分组归属不可验证，一切协调拒绝 */
  rebuildMapping(uriStr: string): Record<string, unknown> {
    const probe = this.probes.get(uriStr)
    if (!probe) {
      throw new Error(`探针未 attach：${uriStr}`)
    }
    const fresh = new AddonHistoryGrouping()
    fresh.markLost()
    probe.adoptGrouping(fresh)
    return probe.state()
  }

  /** 外部前向写入（真实 WorkspaceEdit，不经会话端口） */
  async externalWrite(uriStr: string, text: string): Promise<Record<string, unknown>> {
    const entry = await this.deps.ensureSession(uriStr)
    if (!entry) {
      throw new Error(`无可用会话：${uriStr}`)
    }
    const edit = new vscode.WorkspaceEdit()
    const full = entry.doc.getText()
    edit.replace(
      entry.doc.uri,
      new vscode.Range(entry.doc.positionAt(0), entry.doc.positionAt(full.length)),
      text,
    )
    const ok = await vscode.workspace.applyEdit(edit)
    await sleep(120) // 事件路由窗口
    return { ok, version: entry.doc.version, text: entry.doc.getText() }
  }

  /** 原生文本编辑器外部单步撤销/重做（外部历史入口；不恢复原激活态） */
  async nativeHistory(uriStr: string, op: 'undo' | 'redo'): Promise<Record<string, unknown>> {
    const entry = await this.deps.ensureSession(uriStr)
    if (!entry) {
      throw new Error(`无可用会话：${uriStr}`)
    }
    await vscode.window.showTextDocument(entry.doc, { preview: true })
    await vscode.commands.executeCommand(op)
    await sleep(200) // 回流对账 + 组补完窗口
    return { version: entry.doc.version, text: entry.doc.getText() }
  }
}

function sameChanges(a: SerChange[], b: SerChange[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  return a.every((c, i) => c.offset === b[i].offset && c.length === b[i].length && c.text === b[i].text)
}

/** 等待权威文档到达预期版本与文本（事件驱动更新，轮询读取） */
async function waitDocState(doc: vscode.TextDocument, version: number, text: string, timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (doc.version === version && doc.getText() === text) {
      return true
    }
    await sleep(40)
  }
  return doc.version === version && doc.getText() === text
}

async function waitFor<T>(read: () => T | undefined, timeoutMs: number): Promise<T | undefined> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    const value = read()
    if (value !== undefined) {
      return value
    }
    await sleep(40)
  }
  return undefined
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
