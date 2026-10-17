// 宿主设置服务（#33）：设置定义注册表 + 持久化 + 变更通知的唯一宿主侧入口。
//
// 存储决策（工单 #33 + AGENTS.md「插件设置入口」约定）：context.globalState
// （按用户 profile 持久、跨窗口一致、重启保留，无同步语义）+ 纯代码 schema
// ——不用 workspace.getConfiguration、不声明 contributes.configuration，设置
// 与 VSCode 统一设置中心完全解耦。存储形如 overlay：只记用户显式设置过的
// 键值，默认值永远来自定义表（定义演进时不固化旧默认）。
//
// 本模块不依赖 vscode（SettingsStorage 抽象），可在单测注入假持久层；
// 纯校验逻辑在 shared/settings（单一事实源）。#95 i18n：注册拒绝原因经
// t() 取词（shared/i18n 不引字典，宿主装配后即就绪；未装配回退键名）。
import {
  applySettingsPatch,
  isSettingDefinition,
  sanitizeStoredSettings,
  type SettingDefinition,
  type SettingsPayload,
  type SettingsPayloadValue,
} from '../shared/settings'
import { t } from '../shared/i18n'

/** 持久层抽象：vscode 层以 context.globalState 实现（Memento 子集） */
export interface SettingsStorage {
  get<T>(key: string): T | undefined
  update(key: string, value: unknown): Thenable<void>
}

/** 设置 overlay 的 globalState 存储键（#535 起宿主侧多处消费：服务私有层 + T08 迁移直写原始层） */
export const SETTINGS_STORAGE_KEY = 'vsidian.settings'

/** 变更监听者：保存成功后以新快照调用 */
export type SettingsListener = (values: SettingsPayload) => void

/** 保存结果：ok 时 values 为保存后的完整快照 */
export type SettingsApplyResult =
  | { ok: true; values: SettingsPayload }
  | { ok: false; rejected: string[]; reason: 'invalid' | 'storage' }

/** 运行时定义注册结果 */
export interface AddDefinitionsResult {
  ok: boolean
  error?: string
}

export class SettingsService {
  private readonly defs = new Map<string, SettingDefinition>()
  private readonly listeners = new Set<SettingsListener>()
  /**
   * overlay 读-改-写段的进程内串行链（#535 T08 PR #581 三审 P2-A）：
   * apply 与迁移的互斥写步骤共用同一链——迁移在 pending 持久化的等待
   * 窗口内，用户保存与迁移写回若各自基于旧读全量写会互相覆盖（丢失
   * 更新，评审方 pending 屏障反例）。链式互斥：每段等待前一段落定后再
   * 进入；只覆盖「读-合并-写」段，通知（listeners）留在链外。
   */
  private overlayWriteChain: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly storage: SettingsStorage,
    defs: readonly SettingDefinition[] = [],
    private readonly storageKey: string = SETTINGS_STORAGE_KEY,
  ) {
    // 构造期定义直接信任（编译期类型 + 单一调用点）；运行时注册走
    // addDefinitions 的完整校验
    for (const def of defs) {
      this.defs.set(def.key, def)
    }
  }

  /**
   * 运行时注册定义（#33 集成测试钩子的 fixture 定义经此并入；后续工单
   * 也可用于懒注册场景）。原子：任一定义非法或键已存在则整批拒绝。
   */
  addDefinitions(defs: readonly unknown[]): AddDefinitionsResult {
    for (const candidate of defs) {
      if (!isSettingDefinition(candidate)) {
        return { ok: false, error: t('host.invalidSettingDefinition', { definition: JSON.stringify(candidate) }) }
      }
      if (this.defs.has(candidate.key)) {
        return { ok: false, error: t('host.duplicateSettingKey', { key: candidate.key }) }
      }
    }
    for (const def of defs as readonly SettingDefinition[]) {
      this.defs.set(def.key, def)
    }
    return { ok: true }
  }

  /** 当前定义表（设置页渲染依据） */
  getDefinitions(): readonly SettingDefinition[] {
    return [...this.defs.values()]
  }

  /** 当前生效快照：默认值 + 存量 overlay 清洗（无效恢复默认、未知忽略） */
  getSnapshot(): SettingsPayload {
    return sanitizeStoredSettings(
      this.getDefinitions(),
      this.storage.get<Record<string, unknown>>(this.storageKey),
    )
  }

  /**
   * 保存补丁（设置页 settings.set / 测试钩子入口）：
   * 1. 纯函数整批校验（未知键、类型不符拒绝——半批落地会让「无效值恢复
   *    默认」漂移为部分生效）
   * 2. overlay 合并后持久化；写失败返回 storage 失败且不通知
   * 3. 成功后以新快照通知全部监听者（宿主层在此接广播到编辑器面板）
   */
  /** 已知环境特性（记录，#38 合并实测）：1.86.2 的 globalState 存在跨键
   *  storage 广播迟到回翻——本方法写入后，紧邻的其他键写入（如 #38 模式
   *  记忆）可触发旧值广播把刚写入的 overlay 盖回旧值。生产触发条件苛刻
   *  （设置保存与模式切换近乎同时），后果为单次开关回退、用户可再操作，
   *  不做写后自愈；集成测试侧经 cases.ts 的 waitSettings 与 runner 的每
   *  用例设置重置防护（读回校验，同 resetLastMode 的稳定窗先例） */
  async apply(patch: unknown): Promise<SettingsApplyResult> {
    const current = this.getSnapshot()
    const result = applySettingsPatch(this.getDefinitions(), current, patch)
    if (!result.ok) {
      return { ok: false, rejected: result.rejected, reason: 'invalid' }
    }
    try {
      // P2-A（PR #581 三审）：读-合并-写经串行链执行——与迁移的互斥写
      // 步骤串行，双方都在最新 overlay 上合并，等待窗口内的用户保存不再
      // 被迁移的旧快照覆盖（也不反向覆盖迁移补丁）
      await this.enqueueOverlayWrite(async () => {
        const overlay = {
          ...this.storage.get<Record<string, unknown>>(this.storageKey),
          // applySettingsPatch 已验证 patch 为对象且键全部已定义（收窄安全）
          ...(patch as Record<string, SettingsPayloadValue>),
        }
        await this.storage.update(this.storageKey, overlay)
      })
    } catch {
      return { ok: false, rejected: [], reason: 'storage' }
    }
    const values = this.getSnapshot()
    for (const listener of this.listeners) {
      listener(values)
    }
    return { ok: true, values }
  }

  /**
   * 迁移接线的互斥读-判-写步骤（#535 T08 PR #581 三审 P2-A；仅供
   * legacyThemeMigrationWiring 消费）：step 在串行链内收到**当前**原始
   * overlay（未经 sanitize），返回要落盘的最小补丁（null = 不写）与
   * 回传值。不做定义校验——迁移要写的旧 Mermaid 键定义已删，经 apply
   * 的整批校验会被拒（判据见 shared/legacyThemeMigration 头注释）。step 必须
   * 是同步纯函数，不得再入本服务写路径（链式互斥不可重入）。
   */
  async runExclusiveOverlayStep<R>(
    step: (overlay: unknown) => { patch: Record<string, unknown> | null; result: R },
  ): Promise<R> {
    return this.enqueueOverlayWrite(async () => {
      const overlay = this.storage.get<Record<string, unknown>>(this.storageKey)
      const { patch, result } = step(overlay)
      if (patch !== null) {
        await this.storage.update(this.storageKey, { ...overlay, ...patch })
      }
      return result
    })
  }

  /** 把「读-合并-写」段排入串行链（P2-A）：后进者等待先进者落定 */
  private enqueueOverlayWrite<T>(step: () => Promise<T>): Promise<T> {
    const next = this.overlayWriteChain.then(step, step)
    this.overlayWriteChain = next.catch(() => undefined)
    return next
  }

  /** 订阅变更；返回取消函数 */
  onChange(listener: SettingsListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}
