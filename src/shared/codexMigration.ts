// #535 T08 旧内核 Codex 设置迁移——纯函数与宿主编排（单一事实源；
// 不依赖 vscode/DOM）。迁移语义见 docs/specs/addon-themes.md §6.2。
//
// 判据关键：迁移判定必须读 globalState `vsidian.settings` 的**原始
// overlay**（未经 sanitizeStoredSettings）——旧 Mermaid 键的设置定义随
// 本票删除后，overlay 中残留的 'codex' 会被 sanitize 当未知键忽略、
// 快照层无法区分「曾是 codex」与「从未设置」，一次性引导将永不触发。
// 因此编排直接读写原始 overlay 层（读经 readRawOverlay；写经
// applyExclusiveOverlayStep——与 SettingsService.apply 同一进程内串行链
// 的最小主题键补丁，PR #581 三审 P2-A：pending 持久化等待窗口内的用户
// 保存不被旧快照覆盖）。
//
// 完成标记（PR #581 三审 P2-B + 五审 P2-C 方案 B'）：**按 profile 身份
// 命名的磁盘权威状态文件**（globalStorageUri 下 `codex-theme-migration.
// <profileId>.state.json`，wiring 层 tmp+rename 原子写）——判据完全不依赖
// 各窗口 globalState memento 缓存。1.82.3 的 Memento.get 只读本地 _value，
// 存储写入与跨窗广播是分离通道：A 窗口写 done 删锁后，B 窗口缓存过期时会
// 按旧 codex/空标记再次迁移再次引导（评审方受控缓存模拟实测 guides=2）。
//
// **为什么状态文件名要带 profileId（五审 P2-C 的平台事实）**：目标
// VSCode 1.82.3 没有任何存储通道同时满足「profile 隔离 + 跨窗即时一致」：
// - globalState（StorageScope.PROFILE）按 profile 隔离，但读取走各窗口
//   memento 本地缓存，跨窗靠 storage 广播（有延迟窗）——不即时；
// - globalStorageUri 磁盘即时且跨窗一致，但**恒为默认 profile 目录**（跨
//   profile 共享）——不隔离（四审实测：profile A 的固定名 done 会永久
//   短路 profile B 的迁移与引导）；
// - context.secrets 每次 RPC 即时，但 StorageScope.APPLICATION 跨全部
//   profile 共享——不隔离。
// 因此 B' 以 globalState（PROFILE 域）持久化 profile 身份（随机 UUID，
// 首次需要时在锁内生成；两处载体：globalState 独立键 + 迁移 overlay 补丁
// 同批原子写入），磁盘即时判据按身份命名分居——双 profile 各自独立完成
// 迁移与引导，同 profile 多窗收敛到同一状态文件。
//
// **声明的有界边界（如实落档，不虚饰）**：同一 profile 两窗口在**首次
// 生成 profileId 的历史唯一时刻**，若 storage 广播延迟超出败者（锁内
// 身份等待窗 + 败者等待超时）的等待窗，败者可能自生成另一 id 并多引导
// 一次——一次性、有界，后续激活时 memento 从 db 初始化读到已收敛的 id，
// 永不重复。该边界源于上述平台通道的固有缺口（不存在「profile 隔离 +
// 跨窗即时」双满足通道），不承诺「任意延迟下恰 1」。
//
// 状态机沿用可恢复形态（PR #581 评审修复，发现 1）：
//   无文件                 未迁移
//   { state: pending }    迁移已认领、引导欠账（恢复时必补发）
//   { state: done }       迁移收口（幂等短路，不再引导）
// 持久化顺序：**先写 pending、再改设置、发引导、写 done**——任何一次
// 写失败或进程中断后，下次激活都能从 pending 恢复（设置已迁移 → 补发
// 引导；设置未迁移 → 重走完整迁移），引导不会因中途失败而永久丢失。
// 残余崩溃窗口（声明的极端边界）：引导 fire 与 done 写之间无 await
// （同步序）——该窗口内进程被 kill 或 done 持久化失败时，恢复只能按
// pending 补发，可能双弹一次；这比「引导永久丢失」代价小。
//
// 多窗口并发（PR #581 评审修复发现 2 + 三审同修 + 四审 P2-D）：迁移与
// 恢复经 globalStorage 目录的代次锁（fencing）原子认领（当前代次指针
// tmp+rename 原子推进 + 对 lock.<gen+1> 的 fs.open 'wx' = O_EXCL，见
// codexMigrationLock 文件头不变量）。认领成功者执行完整序列；认领失败
// 者短等待磁盘 done 出现后静默退出（绝不通知），超时也静默退出（本次
// 不引导，待下次激活恢复）。胜者崩溃后锁残留由 mtime 陈旧接管兜底
// （超阈值接管），不会永久锁死。
import { APPEARANCE_THEME_DEFAULT, APPEARANCE_THEME_KEY, MERMAID_THEME_KEY } from './settings'
import type { CodexMigrationLockHandle } from './codexMigrationLock'

/**
 * 迁移判定用的旧内核主题身份字面量。addonThemes 的 CODEX_THEME_ID 已降为
 * v1.1.0 兼容的 deprecated 常量（不再代表内置身份），迁移判定自持字面量、
 * 不依赖它的存废（原始 overlay 中的历史值）。
 */
export const CODEX_MIGRATION_LEGACY_THEME_ID = 'codex'

/**
 * 原始 overlay 内的迁移 profile 身份键（五审 P2-C B' 第二载体）：与迁移
 * 主题补丁**同一次原子 overlay 写**带入（同 PROFILE 域同写——两载体其一
 * 丢失时仍可恢复身份，状态文件名不漂移）。下划线前缀表机制键非设置键，
 * sanitize 快照层按未知键忽略、不污染生效值。
 */
export const CODEX_MIGRATION_PROFILE_ID_OVERLAY_KEY = '_legacyThemeMigration.profileId'

/** 迁移动作：migrate=回落+引导；clean-legacy=只清旧键残留；none=无操作 */
export type CodexMigrationAction = 'migrate' | 'clean-legacy' | 'none'

/** 迁移计划（纯函数产物；overlayPatch 为对原始 overlay 的增量补丁） */
export interface CodexMigrationPlan {
  action: CodexMigrationAction
  overlayPatch: Record<string, string>
  guide: boolean
}

/**
 * 一次性标记（可恢复状态机，磁盘权威形态）：pending = 迁移已认领、引导
 * 欠账（恢复时必补发后收口）；done = 迁移收口（重开/重启/多窗口的幂等
 * 短路判据）。version 记录迁移执行时的扩展版本（诊断用）。
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
  /**
   * B'（PR #581 五审 P2-C）：profile 身份读取。读序 = globalState 独立键
   * （PROFILE 域）→ 原始 overlay 内部键（CODEX_MIGRATION_PROFILE_ID_
   * OVERLAY_KEY，迁移补丁同批写入的第二载体）。返回 null = 本 profile
   * 尚无身份——生成只发生在锁内 owner 序列（唯一生成点，见文件头）。
   */
  readProfileId(): Promise<string | null>
  /** profileId 持久化（globalState 独立键；overlay 载体由迁移补丁同批承载） */
  writeProfileId(id: string): Promise<void>
  /**
   * P2-B/P2-C 磁盘权威状态读（按 profileId 命名的状态文件；即时跨窗、
   * 跨 profile 分居）——不依赖本窗口 memento 缓存（无标记/损坏按 null）。
   */
  readMarker(profileId: string): Promise<CodexMigrationMarker | null>
  /** 磁盘权威状态文件原子写（wiring 层 tmp+rename） */
  writeMarker(profileId: string, marker: CodexMigrationMarker): Promise<void>
  /** context.extension.packageJSON.version（标记值，诊断用） */
  extensionVersion(): string
  /** 一次性安装引导通知（VSIDIAN_TEST_HOOKS=1 时短路，wiring 层实现） */
  requestGuide(): void
  /** 跨窗口锁句柄（代次锁/fencing 协议见 codexMigrationLock） */
  lock: CodexMigrationLockHandle
}

/** 编排结果：action 同计划；guide = 本次是否请求了引导 */
export interface CodexMigrationRunResult {
  action: CodexMigrationAction
  guide: boolean
}

/** 并发认领参数（默认值见 runCodexThemeMigration；单测注入小间隔/超时） */
export interface CodexMigrationRunOptions {
  /** 锁 mtime 陈旧阈值（ms）：超过即视胜者已崩溃，安全接管重抢 */
  lockStaleMs?: number
  /** 认领失败者等待 done 的超时（ms）：超时静默退出（本次不引导） */
  waitTimeoutMs?: number
  /** 等待轮询间隔（ms） */
  pollIntervalMs?: number
  /**
   * B'：锁内 profileId 生成前的身份等待窗（ms）——同 profile 他窗可能
   * 刚生成身份、storage 广播在途，窗内轮询重读可收敛为同一 id（有界
   * 边界见文件头：超窗自生成，一次性、后续激活收敛）
   */
  profileIdWaitMs?: number
  /** 身份等待窗的轮询间隔（ms） */
  profileIdPollMs?: number
}

const NONE_RESULT: CodexMigrationRunResult = { action: 'none', guide: false }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 锁内 profile 身份解析（B' 唯一生成点）：重读两载体（他窗可能在快速
 * 路径与抢锁之间已生成并广播）→ 仍无则在身份等待窗内轮询重读（同
 * profile 他窗的广播在途时收敛为同一 id）→ 超窗自生成新 UUID 并持久
 * 化（声明的有界边界：超窗即可能双 id 多引导一次，后续激活收敛）。
 */
async function resolveOrGenerateProfileId(
  ports: CodexMigrationPorts,
  options: CodexMigrationRunOptions,
): Promise<string> {
  const waitMs = options.profileIdWaitMs ?? 1_000
  const pollMs = options.profileIdPollMs ?? 50
  let id = await ports.readProfileId()
  const deadline = Date.now() + waitMs
  while (id === null && Date.now() < deadline) {
    await sleep(pollMs)
    id = await ports.readProfileId()
  }
  if (id !== null) {
    return id
  }
  id = globalThis.crypto.randomUUID()
  await ports.writeProfileId(id)
  return id
}

/**
 * 胜者序列（认领成功后执行）：锁内解析/补生成 profile 身份（B' 唯一
 * 生成点）→ 磁盘重读状态 → 按恢复规则补完。
 * - plan migrate → 完整序列：写 pending → 串行化重判并落最小补丁（身份
 *   键随补丁同批原子写，见 CODEX_MIGRATION_PROFILE_ID_OVERLAY_KEY）→
 *   （重判仍 migrate 才）发引导（同步序）→ 写 done；重判落到档 2/档 3
 *   说明等待期间用户已自行处置——不引导，直接写 done 收口（P2-A）；
 * - plan clean-legacy → 只清旧键（pending 欠账则补发引导并收口）；
 * - plan none 且 pending 在场 → 补发引导后写 done（引导欠账必达）；
 * - plan none 且无 pending → 静默收尾。
 * 异常时立即释放锁（token 校验式，下次激活可立即重试）；真实进程崩溃
 * 不走 finally，锁残留由 mtime 陈旧接管兜底。
 */
async function executeOwnerSequence(
  ports: CodexMigrationPorts,
  profileId: string | null,
  options: CodexMigrationRunOptions,
): Promise<CodexMigrationRunResult> {
  try {
    // B'：身份缺失时在锁内生成（快速路径可能带着 null 进来——那是需要
    // 迁移但尚无身份的首次激活；等待窗语义见 resolveOrGenerateProfileId）
    const id = profileId ?? await resolveOrGenerateProfileId(ports, options)
    // 认领后从磁盘重读权威状态（P2-B：等待期间其他窗口可能已完成收口）
    const marker = await ports.readMarker(id)
    if (marker?.state === 'done') {
      return NONE_RESULT
    }
    const recoveredPending = marker?.state === 'pending'
    const rawOverlay = ports.readRawOverlay()
    const plan = planCodexThemeMigration(rawOverlay, false)
    const version = ports.extensionVersion()

    if (plan.action === 'migrate') {
      // 持久化顺序（发现 1）：pending 先于设置改写落盘——中途任何失败都
      // 能从 pending 恢复，引导不会永久丢失
      await ports.writeMarker(id, { state: 'pending', version })
      // P2-A（PR #581 三审）：pending 落盘后在串行化路径内重读最新
      // overlay 并按三档矩阵重新判定，只写主题相关键的最小补丁（不做
      // 全量 overlay 回写）——等待窗口内用户经 SettingsService.apply
      // 保存的新选择与其他设置都在互斥内的最新快照上合并
      const revisedAction = await ports.applyExclusiveOverlayStep((latest) => {
        const revised = planCodexThemeMigration(latest, false)
        if (revised.action === 'none') {
          return { patch: null, result: 'none' as const }
        }
        // B'：profile 身份随迁移补丁同批原子写（第二载体，同域同写）
        return {
          patch: { ...revised.overlayPatch, [CODEX_MIGRATION_PROFILE_ID_OVERLAY_KEY]: id },
          result: revised.action,
        }
      })
      if (revisedAction === 'migrate') {
        // 引导 fire 与 done 写之间无 await（同步序）：残余崩溃窗口见文件头
        ports.requestGuide()
        await ports.writeMarker(id, { state: 'done', version })
        return { action: plan.action, guide: true }
      }
      // 等待期间用户已自行处置（改选组件主题 → 档 2 清旧键、保留新键；
      // 双键到位 → 档 3 无操作）：按重判档位语义不引导——引导的原始
      // 理由（旧 codex 待回落并告知去向）已消失，用户的选择优先。本次
      // pending 非历史欠账（是本运行刚写），直接写 done 收口
      await ports.writeMarker(id, { state: 'done', version })
      return revisedAction === 'clean-legacy'
        ? { action: 'clean-legacy', guide: false }
        : NONE_RESULT
    }
    if (plan.action === 'clean-legacy') {
      await ports.applyExclusiveOverlayStep(() => ({
        patch: { ...plan.overlayPatch, [CODEX_MIGRATION_PROFILE_ID_OVERLAY_KEY]: id },
        result: undefined,
      }))
      if (recoveredPending) {
        // pending = 引导欠账：清旧键之外补发引导并收口
        ports.requestGuide()
        await ports.writeMarker(id, { state: 'done', version })
        return { action: plan.action, guide: true }
      }
      return { action: plan.action, guide: false }
    }
    // plan none：设置已迁移（或本就无需迁移）——只有 pending 欠账需要补发
    if (recoveredPending) {
      ports.requestGuide()
      await ports.writeMarker(id, { state: 'done', version })
      return { action: 'none', guide: true }
    }
    return NONE_RESULT
  } finally {
    // 释放失败不传播（陈旧接管兜底；磁盘 done 状态才是收口判据）
    await ports.lock.release().catch(() => undefined)
  }
}

/**
 * 宿主编排（五审 P2-C 判定链）：读 globalState profile 身份（激活时
 * memento 从 db 初始化，常态新鲜）→ 读按身份命名的磁盘权威状态（即时）→
 * done 跳过 / pending 走恢复 / 缺失走锁内完整序列（身份缺失且需要迁移
 * 时，身份在锁内生成——唯一生成点）。磁盘 done 短路（快速路径不抢锁，
 * P2-B：判据不依赖 memento 缓存）→ 需迁移或恢复时跨进程原子认领（代次
 * 锁协议：O_EXCL 认领 gen+1 + 指针原子推进）→
 * 胜者执行 owner 序列；败者短等待身份出现与磁盘 done 后静默退出（绝不
 * 通知），等待期间锁陈旧/消失则接管补完。超时静默退出：本次不引导，待
 * 下次激活按恢复规则补完。无身份且无迁移负担的 profile 零磁盘/锁开销。
 */
export async function runCodexThemeMigration(
  ports: CodexMigrationPorts,
  options: CodexMigrationRunOptions = {},
): Promise<CodexMigrationRunResult> {
  const lockStaleMs = options.lockStaleMs ?? 10_000
  const waitTimeoutMs = options.waitTimeoutMs ?? 5_000
  const pollIntervalMs = options.pollIntervalMs ?? 100

  // ---- B'：profile 身份 → 磁盘权威状态 → 快速路径 ----
  let profileId = await ports.readProfileId()
  if (profileId !== null) {
    // 快速路径：磁盘权威 done 在场（重开/重启/多窗口常规形态）——不抢锁
    // 直接退出。跨窗口一致：他窗已收口时本窗即使 memento 缓存过期也短路
    const initialMarker = await ports.readMarker(profileId)
    if (initialMarker?.state === 'done') {
      return NONE_RESULT
    }
    const pending = initialMarker?.state === 'pending'
    const plan = planCodexThemeMigration(ports.readRawOverlay(), false)
    if (plan.action === 'none' && !pending) {
      return NONE_RESULT
    }
  } else {
    // 无身份：无需迁移的 profile 不生成身份、不碰磁盘锁（零开销退出）
    const plan = planCodexThemeMigration(ports.readRawOverlay(), false)
    if (plan.action === 'none') {
      return NONE_RESULT
    }
    // 需要迁移但尚无身份：进锁内生成（executeOwnerSequence 的唯一生成点）
  }

  if (await ports.lock.tryAcquire()) {
    return executeOwnerSequence(ports, profileId, options)
  }
  if (await ports.lock.takeoverIfStale(lockStaleMs)) {
    return executeOwnerSequence(ports, profileId, options)
  }
  // 认领失败：等待身份出现（同 profile 胜者刚生成、广播在途）与磁盘 done
  // （期间锁陈旧/消失则接管补完——胜者崩溃不留死锁；代次锁按文件名代次
  // 行动，不按过期观察删新锁）
  const start = Date.now()
  for (;;) {
    if (profileId === null) {
      profileId = await ports.readProfileId()
    }
    if (profileId !== null && (await ports.readMarker(profileId))?.state === 'done') {
      return NONE_RESULT
    }
    if (Date.now() - start > waitTimeoutMs) {
      // 超时静默退出：绝不通知（本次不引导，待下次激活恢复）
      return NONE_RESULT
    }
    const age = await ports.lock.ageMs()
    if (age === null || age > lockStaleMs) {
      // 锁不在位（胜者异常退出已释放）或已陈旧（胜者崩溃残留）——接力或
      // 接管：owner 序列重读磁盘状态，幂等安全
      if (await ports.lock.takeoverIfStale(lockStaleMs)) {
        return executeOwnerSequence(ports, profileId, options)
      }
    }
    await sleep(pollIntervalMs)
  }
}
