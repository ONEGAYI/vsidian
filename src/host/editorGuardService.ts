// #322 默认编辑器守护——宿主服务：版本锁主动层（安装/升级/降级后的首次
// 窗口启动检测一次）、associations 变更沿被动层、一键修复链路与防骚扰
// 语义（拒绝记录 / 版本绕过 / in-flight 防重弹）的状态机权威。
//
// 纯逻辑 + 端口注入（settingsService / jiebaResourceService 同模式，单测
// 注入假端口），不 import vscode；判定与写回构造的单一事实源在
// shared/editorGuard，vscode 层装配（配置读写 / 通知 / extensions 反查 /
// onDidChangeConfiguration 订阅 / _test 钩子）见 host/editorGuardWiring。
//
// 时机模型（规格第三节）：两层互补——主动层由 globalState 版本锁门控
//（与 context.extension.packageJSON.version 不相等即触发，写锁不依赖
// 用户对通知的响应）；被动层在生效值发生「未接管 → 接管」变更沿时提示
//（规格表述「是我 → 非我」在此宽化为「未接管 → 接管」：未接管含无记录
// 与全是我两形态，覆盖 VSCode 仲裁静默写入通道——规格第一节的原始问题
// 陈述；沿语义保证状态不变期间不重复弹）。两层共用同一提示与修复链路。
import {
  buildEditorAssociationsFix,
  classifyDefaultEditorDisplay,
  detectEditorTakeover,
  isPassiveSuppressedBy,
  sameEditorGuardVersion,
  sanitizeEditorGuardPersisted,
  type DefaultEditorDisplayState,
  type EditorGuardPersisted,
} from '../shared/editorGuard'

/** globalState 存储键（vsidian.<域> 命名习惯；单键存结构化对象） */
export const EDITOR_GUARD_STORAGE_KEY = 'vsidian.editorGuard'

/** 主动层 toast 出现延迟（规格：约 1.5 秒，避开启动通知密集期） */
export const EDITOR_GUARD_STARTUP_PROMPT_DELAY_MS = 1500

/** 宿主交互端口（vscode 层实现；单测注入假端口） */
export interface EditorGuardPorts {
  /** globalState 读（同步——Memento.get 语义） */
  readPersisted(): unknown
  /** globalState 写（守护面唯一持久化通道） */
  writePersisted(value: EditorGuardPersisted): PromiseLike<void>
  /** 当前扩展版本（context.extension.packageJSON.version） */
  getExtensionVersion(): string
  /** associations 合并生效值（get() 视图，接管判定的输入） */
  getAssociations(): unknown
  /** associations 的 global 层值（inspect().globalValue，写回合并基底） */
  getGlobalAssociations(): unknown
  /** 写回 global 层（update(..., ConfigurationTarget.Global)） */
  updateGlobalAssociations(value: Record<string, string>): PromiseLike<void>
  /** 守护开关读取（设置键 general.defaultEditorGuard，默认开） */
  isGuardEnabled(): boolean
  /** 抢占者可读名（内置特判 / extensions.all 反查 / 原值回退，见 wiring） */
  resolveTakerLabel(viewType: string): string
  /** 抢占提示（多按钮 toast）；resolve 'fix' / 'dismiss'，超时 undefined */
  showTakeoverPrompt(label: string): PromiseLike<'fix' | 'dismiss' | undefined>
  /** 修复成功确认通知（无按钮，fire-and-forget） */
  showFixedNotice(): void
  /** 复查失败降级引导（说明 + 打开统一设置中心定位该设置键） */
  showFixFailedGuidance(): void
}

export interface EditorGuardServiceOptions {
  /** 主动层 toast 延迟毫秒（生产缺省 EDITOR_GUARD_STARTUP_PROMPT_DELAY_MS；单测传 0） */
  startupPromptDelayMs?: number
}

/** 修复结果：ok = 写回后复查生效值已是我；!ok = 复查仍非我或写回失败（已降级引导） */
export type EditorGuardFixResult = { ok: true } | { ok: false }

/** 运行时状态快照（_test 钩子与 #323 设置页状态行的数据源；判定现算不缓存） */
export interface EditorGuardRuntimeState {
  takenOver: boolean
  takerViewType: string | null
  takerLabel: string | null
  versionLock: string | null
  rejections: readonly string[]
  guardEnabled: boolean
  promptInFlight: boolean
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class EditorGuardService {
  private persisted: EditorGuardPersisted
  /** 被动层沿基线：上一次生效判定（null = 尚未初始化，不参与沿检测） */
  private baselineTakenOver: boolean | null = null
  private promptInFlight = false
  private readonly startupPromptDelayMs: number
  /** 判定状态变化订阅者（#323 设置页推送接线，jieba onStateChanged 同款） */
  private readonly stateListeners = new Set<() => void>()

  constructor(
    private readonly ports: EditorGuardPorts,
    opts: EditorGuardServiceOptions = {},
  ) {
    this.persisted = sanitizeEditorGuardPersisted(ports.readPersisted())
    this.startupPromptDelayMs = opts.startupPromptDelayMs ?? EDITOR_GUARD_STARTUP_PROMPT_DELAY_MS
  }

  /**
   * 判定状态变化订阅（#323）：生效判定可能变化的链路（配置变更被动层、
   * fixNow 修复）完成后通知。推送内容消费方现算（getDisplayState），本事件
   * 只承担「该重读了」的信号；返回取消订阅函数。
   */
  onStateChanged(listener: () => void): () => void {
    this.stateListeners.add(listener)
    return () => {
      this.stateListeners.delete(listener)
    }
  }

  private notifyStateChanged(): void {
    for (const listener of this.stateListeners) {
      listener()
    }
  }

  /**
   * 主动层（激活时调用；#322 起每窗口常驻激活）：版本锁与当前版本不相等
   * （首装 / 升级 / 降级均含）→ 检测一次（可提示，绕过拒绝记录——主动升级
   * 是「仍想要它」的强信号，每版本至多一次由锁写回保证）→ 无条件写锁为
   * 当前版本（不依赖用户对通知的响应）。锁相同时仅初始化沿基线。
   */
  async runStartupCheck(): Promise<void> {
    if (this.baselineTakenOver === null) {
      this.baselineTakenOver = detectEditorTakeover(this.ports.getAssociations()).takenOver
    }
    const currentVersion = this.ports.getExtensionVersion()
    if (sameEditorGuardVersion(this.persisted.versionLock, currentVersion)) {
      return
    }
    const verdict = detectEditorTakeover(this.ports.getAssociations())
    if (verdict.takenOver) {
      // fire 不 await：写锁不等用户响应；延迟由 delayedPrompt 承担
      void this.delayedPrompt(verdict.takerViewType, { bypassRejections: true })
    }
    this.persisted = { ...this.persisted, versionLock: currentVersion }
    await this.persistState()
  }

  /**
   * 被动层（wiring 的 onDidChangeConfiguration 过滤 workbench.
   * editorAssociations 后调用）：基线始终更新为最新判定（状态是事实）；
   * 仅在「未接管 → 接管」变更沿提示（状态不变化不重复弹），经拒绝记录
   * 压制与 in-flight 防重弹门控。#323：判定可能变化，完成即通知状态
   * 订阅者（设置页状态行实时更新；通知不区分形态是否翻转——消费方现算）。
   */
  async handleAssociationsChanged(): Promise<void> {
    const verdict = detectEditorTakeover(this.ports.getAssociations())
    const previous = this.baselineTakenOver
    this.baselineTakenOver = verdict.takenOver
    this.notifyStateChanged()
    if (previous === null) {
      return
    }
    if (!previous && verdict.takenOver) {
      void this.promptTakeover(verdict.takerViewType, { bypassRejections: false })
    }
  }

  /**
   * 一键改回（提示按钮 / _test 钩子 / #323 手动按钮共用）：基于
   * inspect().globalValue 为基底合并写回 global 层（不得用 get() 合并值
   * 直接写回——会把 workspace 层值提升到 global 层），写后复查 get() 生效
   * 值：已是我 → 成功确认；仍非我（workspace 层同 key 覆盖等）→ 降级
   * 引导统一设置中心。写回抛异常与复查失败同通道降级。
   */
  async fixNow(): Promise<EditorGuardFixResult> {
    try {
      const next = buildEditorAssociationsFix(this.ports.getGlobalAssociations())
      await this.ports.updateGlobalAssociations(next)
    } catch {
      this.ports.showFixFailedGuidance()
      this.notifyStateChanged()
      return { ok: false }
    }
    const verdict = detectEditorTakeover(this.ports.getAssociations())
    this.baselineTakenOver = verdict.takenOver
    // #323：写回与复查后生效判定可能变化（成功 → vsidian；失败维持他者）
    this.notifyStateChanged()
    if (!verdict.takenOver) {
      this.ports.showFixedNotice()
      return { ok: true }
    }
    this.ports.showFixFailedGuidance()
    return { ok: false }
  }

  /** 当前状态快照（判定现算；#323 设置页状态行与 _test 钩子的读取面） */
  getState(): EditorGuardRuntimeState {
    const verdict = detectEditorTakeover(this.ports.getAssociations())
    return {
      takenOver: verdict.takenOver,
      takerViewType: verdict.takenOver ? verdict.takerViewType : null,
      takerLabel: verdict.takenOver ? this.ports.resolveTakerLabel(verdict.takerViewType) : null,
      versionLock: this.persisted.versionLock,
      rejections: [...this.persisted.rejections],
      guardEnabled: this.ports.isGuardEnabled(),
      promptInFlight: this.promptInFlight,
    }
  }

  /**
   * 设置页状态行载荷（#323 defaultEditor.state 消息体）：四形态判定现算；
   * 「其他扩展」形态经 resolveTakerLabel 端口反查可读名（反查失败由端口
   * 回退关联值原文），其余形态 label 为 null——展示文本由设置页经自身
   * 语言包组句（换语言重渲染无宿主取词滞留）。
   */
  getDisplayState(): DefaultEditorDisplayState {
    const verdict = classifyDefaultEditorDisplay(this.ports.getAssociations())
    if (verdict.status === 'other') {
      return {
        status: 'other',
        viewType: verdict.takerViewType,
        label: this.ports.resolveTakerLabel(verdict.takerViewType!),
      }
    }
    if (verdict.status === 'builtin') {
      return { status: 'builtin', viewType: verdict.takerViewType, label: null }
    }
    return { status: verdict.status, viewType: null, label: null }
  }

  /**
   * 重置守护面（集成测试钩子 _test.resetEditorGuardState 与 runner 每用例
   * 重置序列消费）：清空版本锁与拒绝记录并重建沿基线——「首装检测」在
   * 同一集成进程内跨用例不被前序写锁污染的前提。
   */
  async reset(): Promise<void> {
    this.persisted = { versionLock: null, rejections: [] }
    await this.persistState()
    this.baselineTakenOver = detectEditorTakeover(this.ports.getAssociations()).takenOver
  }

  /** 主动层 toast 延迟后的提示（delayMs 0 = 立即，单测直连语义） */
  private async delayedPrompt(
    takerViewType: string,
    opts: { bypassRejections: boolean },
  ): Promise<void> {
    if (this.startupPromptDelayMs > 0) {
      await sleep(this.startupPromptDelayMs)
    }
    await this.promptTakeover(takerViewType, opts)
  }

  /**
   * 提示入口（两层共用）：守护开关整体关闭提示（关闭不影响检测、写锁与
   * 手动修复）；被动层经拒绝记录按抢占者压制（主动层的版本变化分支绕过
   * ——bypassRejections）；通知在途（in-flight）不重复弹。用户点「忽略」
   * 才记拒绝（按抢占者 viewType，换抢占者重新具备资格）；toast 自然超时
   * （undefined）不记；点「改回」走 fixNow 同一链路。
   */
  private async promptTakeover(
    takerViewType: string,
    opts: { bypassRejections: boolean },
  ): Promise<void> {
    if (this.promptInFlight) {
      return
    }
    if (!this.ports.isGuardEnabled()) {
      return
    }
    if (!opts.bypassRejections && isPassiveSuppressedBy(this.persisted.rejections, takerViewType)) {
      return
    }
    this.promptInFlight = true
    try {
      const label = this.ports.resolveTakerLabel(takerViewType)
      const answer = await this.ports.showTakeoverPrompt(label)
      if (answer === 'fix') {
        await this.fixNow()
      } else if (answer === 'dismiss') {
        if (!this.persisted.rejections.includes(takerViewType)) {
          this.persisted = {
            ...this.persisted,
            rejections: [...this.persisted.rejections, takerViewType],
          }
          await this.persistState()
        }
      }
    } finally {
      this.promptInFlight = false
    }
  }

  private async persistState(): Promise<void> {
    await this.ports.writePersisted(this.persisted)
  }
}
