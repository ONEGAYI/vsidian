// #535 T08 旧内核 Codex 设置迁移——纯函数与宿主编排（单一事实源；
// 不依赖 vscode/DOM）。迁移语义见 docs/specs/addon-themes.md §6.2。
//
// 判据关键：迁移判定必须读 globalState `vsidian.settings` 的**原始
// overlay**（未经 sanitizeStoredSettings）——旧 Mermaid 键的设置定义随
// 本票删除后，overlay 中残留的 'codex' 会被 sanitize 当未知键忽略、
// 快照层无法区分「曾是 codex」与「从未设置」，一次性引导将永不触发。
// 因此编排直接读写原始 overlay 层（不经 SettingsService.apply——apply
// 按定义表校验，旧键定义删除后任何写入都会被拒）。
//
// 一次性标记（globalState 独立键，与设置同 profile 持久化——参照
// editorGuard #322 版本锁先例：写锁不依赖用户对通知的响应）：标记为
// 可恢复状态机（PR #581 评审修复，发现 1）——
//   undefined          未迁移
//   { state: pending } 迁移已认领、引导欠账（恢复时必补发）
//   { state: done }    迁移收口（幂等短路，不再引导）
// 持久化顺序：**先写 pending、再改设置、发引导、写 done**——任何一次
// 写失败或进程中断后，下次激活都能从 pending 恢复（设置已迁移 → 补发
// 引导；设置未迁移 → 重走完整迁移），引导不会因中途失败而永久丢失。
// 残余崩溃窗口（声明的极端边界）：引导 fire 与 done 写之间无 await
// （同步序）——该窗口内进程被 kill 或 done 持久化失败时，恢复只能按
// pending 补发，可能双弹一次；这比「引导永久丢失」代价小。
//
// 多窗口并发（PR #581 评审修复，发现 2）：迁移与恢复均经 globalStorage
// 目录内锁文件原子认领（fs.open 'wx' = O_EXCL，跨进程原子原语）。认领
// 成功者执行完整序列；认领失败者短等待 done 出现后静默退出（绝不通知），
// 超时也静默退出（本次不引导，待下次激活恢复）。胜者崩溃后锁残留由
// mtime 陈旧接管兜底（超阈值删除重抢），不会永久锁死。
import { APPEARANCE_THEME_DEFAULT, APPEARANCE_THEME_KEY, MERMAID_THEME_KEY } from './settings'

/** 一次性迁移标记的 globalState 键（vsidian.<域> 命名习惯） */
export const CODEX_MIGRATION_MARKER_KEY = 'vsidian.codexThemeMigration'

/**
 * 迁移判定用的旧内核主题身份字面量。addonThemes 的 CODEX_THEME_ID 已降为
 * v1.1.0 兼容的 deprecated 常量（不再代表内置身份），迁移判定自持字面量、
 * 不依赖它的存废（原始 overlay 中的历史值）。
 */
export const CODEX_MIGRATION_LEGACY_THEME_ID = 'codex'

/** 迁移动作：migrate=回落+引导；clean-legacy=只清旧键残留；none=无操作 */
export type CodexMigrationAction = 'migrate' | 'clean-legacy' | 'none'

/** 迁移计划（纯函数产物；overlayPatch 为对原始 overlay 的增量补丁） */
export interface CodexMigrationPlan {
  action: CodexMigrationAction
  overlayPatch: Record<string, string>
  guide: boolean
}

/**
 * 一次性标记（可恢复状态机）：pending = 迁移已认领、引导欠账（恢复时必
 * 补发后收口）；done = 迁移收口（重开/重启/多窗口的幂等短路判据）。
 * version 记录迁移执行时的扩展版本（诊断用）。
 */
export interface CodexMigrationMarker {
  state: 'pending' | 'done'
  version: string
}

/** 标记形态守卫（非对象/未知状态/版本非字符串 → null，视为无标记） */
export function parseCodexMigrationMarker(value: unknown): CodexMigrationMarker | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const state = (value as Record<string, unknown>)['state']
  const version = (value as Record<string, unknown>)['version']
  if (state !== 'pending' && state !== 'done') return null
  if (typeof version !== 'string') return null
  return { state, version }
}

const NOOP_PLAN: CodexMigrationPlan = { action: 'none', overlayPatch: {}, guide: false }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 与 resolveThemePreferred 同款的有意义取值判定：非字符串或 trim 后空串视为未设置 */
function meaningfulThemeValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.trim() === '' ? undefined : value
}

/**
 * 三档迁移矩阵（纯函数；判定只看原始 overlay 与完成标记，不看快照）：
 * 1. 新键为旧内核 codex 身份（T07 过渡内置项），或新键 default/缺失且
 *    原始旧 Mermaid 键 = 'codex' → 双键回落 'default' + 一次性引导；
 * 2. 新键为组件主题身份（用户已作新选择）→ 不动新键；旧键残留 'codex'
 *    清为 'default'；不引导；
 * 3. 其余 → 无操作。
 */
export function planCodexThemeMigration(rawOverlay: unknown, migrationDone: boolean): CodexMigrationPlan {
  if (migrationDone) {
    // done 标记在场即迁移已收口——幂等短路，保证引导只发一次
    return NOOP_PLAN
  }
  if (!isRecord(rawOverlay)) {
    return NOOP_PLAN
  }
  const theme = meaningfulThemeValue(rawOverlay[APPEARANCE_THEME_KEY])
  const legacyIsCodex = rawOverlay[MERMAID_THEME_KEY] === CODEX_MIGRATION_LEGACY_THEME_ID
  if (theme === CODEX_MIGRATION_LEGACY_THEME_ID ||
      ((theme === undefined || theme === APPEARANCE_THEME_DEFAULT) && legacyIsCodex)) {
    return {
      action: 'migrate',
      overlayPatch: { [APPEARANCE_THEME_KEY]: APPEARANCE_THEME_DEFAULT, [MERMAID_THEME_KEY]: 'default' },
      guide: true,
    }
  }
  if (theme !== undefined && legacyIsCodex) {
    return {
      action: 'clean-legacy',
      overlayPatch: { [MERMAID_THEME_KEY]: 'default' },
      guide: false,
    }
  }
  return NOOP_PLAN
}

/** 宿主编排端口（vscode 层实现见 host/codexMigrationWiring；单测注入假端口） */
export interface CodexMigrationPorts {
  /** globalState.get('vsidian.settings')——原始 overlay，未经 sanitize */
  readRawOverlay(): unknown
  /**
   * P2-A（PR #581 三审）：与 SettingsService.apply 同一进程内串行化的
   * 「读-判-写」——step 在互斥内收到**当前**原始 overlay，返回最小主题
   * 键补丁（null = 不写）与回传值。pending 持久化的等待窗口内，用户
   * 保存与迁移写回经同一互斥串行：重判基于最新快照、只合并主题键，
   * 用户的新选择（组件主题/其他设置）不再被 await 前捕获的旧快照覆盖。
   */
  applyExclusiveOverlayStep<R>(
    step: (overlay: unknown) => { patch: Record<string, unknown> | null; result: R },
  ): Promise<R>
  /** globalState.get(标记键)——undefined 即未迁移（形态见 parseCodexMigrationMarker） */
  readMarker(): unknown
  /** globalState.update(标记键, marker)——pending/done 状态机的唯一写入通道 */
  writeMarker(marker: CodexMigrationMarker): Promise<void>
  /** context.extension.packageJSON.version（标记值，诊断用） */
  extensionVersion(): string
  /** 一次性安装引导通知（VSIDIAN_TEST_HOOKS=1 时短路，wiring 层实现） */
  requestGuide(): void
  /** 原子认领锁文件（O_EXCL）：true = 认领成功（本窗口为迁移胜者） */
  tryAcquireLock(): Promise<boolean>
  /** 锁文件年龄（ms；不存在 = null）——陈旧接管判据 */
  lockAgeMs(): Promise<number | null>
  /** 删除锁文件（陈旧接管 / 胜者正常完成或异常退出时释放） */
  releaseLock(): Promise<void>
}

/** 编排结果：action 同计划；guide = 本次是否请求了引导 */
export interface CodexMigrationRunResult {
  action: CodexMigrationAction
  guide: boolean
}

/** 并发认领参数（默认值见 runCodexThemeMigration；单测注入小间隔/超时） */
export interface CodexMigrationRunOptions {
  /** 锁 mtime 陈旧阈值（ms）：超过即视胜者已崩溃，删除重抢 */
  lockStaleMs?: number
  /** 认领失败者等待 done 的超时（ms）：超时静默退出（本次不引导） */
  waitTimeoutMs?: number
  /** 等待轮询间隔（ms） */
  pollIntervalMs?: number
}

const NONE_RESULT: CodexMigrationRunResult = { action: 'none', guide: false }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** 尝试认领；失败时检查陈旧并接管（删除重抢）。true = 认领成功 */
async function tryAcquireOrTakeover(
  ports: CodexMigrationPorts,
  staleMs: number,
): Promise<boolean> {
  if (await ports.tryAcquireLock()) return true
  const age = await ports.lockAgeMs()
  if (age !== null && age > staleMs) {
    await ports.releaseLock()
    return ports.tryAcquireLock()
  }
  return false
}

/**
 * 胜者序列（认领成功后执行）：重读状态 → 按恢复规则补完。
 * - plan migrate → 完整序列：写 pending → 改设置 → 发引导（同步序）→ 写 done；
 * - plan clean-legacy → 只清旧键（pending 欠账则补发引导并收口）；
 * - plan none 且 pending 在场 → 补发引导后写 done（引导欠账必达）；
 * - plan none 且无 pending → 静默收尾。
 * 异常时立即释放锁（下次激活可立即重试）；真实进程崩溃不走 finally，
 * 锁残留由 mtime 陈旧接管兜底。
 */
async function executeOwnerSequence(ports: CodexMigrationPorts): Promise<CodexMigrationRunResult> {
  try {
    // 认领后重读状态（等待期间其他窗口可能已完成收口）
    const marker = parseCodexMigrationMarker(ports.readMarker())
    if (marker?.state === 'done') {
      return NONE_RESULT
    }
    const rawOverlay = ports.readRawOverlay()
    const plan = planCodexThemeMigration(rawOverlay, false)
    const version = ports.extensionVersion()

    if (plan.action === 'migrate') {
      // 持久化顺序（发现 1）：pending 先于设置改写落盘——中途任何失败都
      // 能从 pending 恢复，引导不会永久丢失
      await ports.writeMarker({ state: 'pending', version })
      // P2-A（PR #581 三审）：pending 落盘后在串行化路径内重读最新
      // overlay 并按三档矩阵重新判定，只写主题相关键的最小补丁（不做
      // 全量 overlay 回写）——等待窗口内用户经 SettingsService.apply
      // 保存的新选择与其他设置都在互斥内的最新快照上合并
      const revisedAction = await ports.applyExclusiveOverlayStep((latest) => {
        const revised = planCodexThemeMigration(latest, false)
        if (revised.action === 'none') {
          return { patch: null, result: 'none' as const }
        }
        return { patch: revised.overlayPatch, result: revised.action }
      })
      if (revisedAction === 'migrate') {
        // 引导 fire 与 done 写之间无 await（同步序）：残余崩溃窗口见文件头
        ports.requestGuide()
        await ports.writeMarker({ state: 'done', version })
        return { action: plan.action, guide: true }
      }
      // 等待期间用户已自行处置（改选组件主题 → 档 2 清旧键、保留新键；
      // 双键到位 → 档 3 无操作）：按重判档位语义不引导——引导的原始
      // 理由（旧 codex 待回落并告知去向）已消失，用户的选择优先。本次
      // pending 非历史欠账（是本运行刚写），直接写 done 收口
      await ports.writeMarker({ state: 'done', version })
      return revisedAction === 'clean-legacy'
        ? { action: 'clean-legacy', guide: false }
        : NONE_RESULT
    }
    if (plan.action === 'clean-legacy') {
      await ports.applyExclusiveOverlayStep(() => ({ patch: plan.overlayPatch, result: undefined }))
      if (marker?.state === 'pending') {
        // pending = 引导欠账：清旧键之外补发引导并收口
        ports.requestGuide()
        await ports.writeMarker({ state: 'done', version })
        return { action: plan.action, guide: true }
      }
      return { action: plan.action, guide: false }
    }
    // plan none：设置已迁移（或本就无需迁移）——只有 pending 欠账需要补发
    if (marker?.state === 'pending') {
      ports.requestGuide()
      await ports.writeMarker({ state: 'done', version })
      return { action: 'none', guide: true }
    }
    return NONE_RESULT
  } finally {
    // 释放失败不传播（陈旧接管兜底；done 标记才是收口判据）
    await ports.releaseLock().catch(() => undefined)
  }
}

/**
 * 宿主编排：done 短路（快速路径不抢锁）→ 需迁移或恢复时跨进程原子认领
 * （发现 2）→ 胜者执行 owner 序列；败者短等待 done 出现后静默退出
 * （绝不通知），等待期间锁陈旧则接管补完。超时静默退出：本次不引导，
 * 待下次激活按恢复规则补完。
 */
export async function runCodexThemeMigration(
  ports: CodexMigrationPorts,
  options: CodexMigrationRunOptions = {},
): Promise<CodexMigrationRunResult> {
  const lockStaleMs = options.lockStaleMs ?? 10_000
  const waitTimeoutMs = options.waitTimeoutMs ?? 5_000
  const pollIntervalMs = options.pollIntervalMs ?? 100

  // 快速路径：done 在场（重开/重启/多窗口常规形态）——不抢锁直接退出
  const marker = parseCodexMigrationMarker(ports.readMarker())
  if (marker?.state === 'done') {
    return NONE_RESULT
  }
  const pending = marker?.state === 'pending'
  const plan = planCodexThemeMigration(ports.readRawOverlay(), false)
  if (plan.action === 'none' && !pending) {
    return NONE_RESULT
  }

  if (await tryAcquireOrTakeover(ports, lockStaleMs)) {
    return executeOwnerSequence(ports)
  }
  // 认领失败：等待 done（期间锁陈旧则接管补完——胜者崩溃不留死锁）
  const start = Date.now()
  for (;;) {
    if (parseCodexMigrationMarker(ports.readMarker())?.state === 'done') {
      return NONE_RESULT
    }
    if (Date.now() - start > waitTimeoutMs) {
      // 超时静默退出：绝不通知（本次不引导，待下次激活恢复）
      return NONE_RESULT
    }
    const age = await ports.lockAgeMs()
    if (age === null || age > lockStaleMs) {
      // 锁不存在（胜者异常退出已释放）或已陈旧（胜者崩溃残留）——接力或
      // 接管：owner 序列重读状态，幂等安全
      if (age !== null) await ports.releaseLock()
      if (await ports.tryAcquireLock()) {
        return executeOwnerSequence(ports)
      }
    }
    await sleep(pollIntervalMs)
  }
}
