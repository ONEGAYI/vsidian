// #535 T08 旧主题预设迁移——纯函数与宿主编排（单一事实源；
// 不依赖 vscode/DOM）。迁移语义见 docs/specs/addon-themes.md §6.2。
//
// 判据关键：迁移判定必须读 globalState `vsidian.settings` 的**原始
// overlay**（未经 sanitizeStoredSettings）——旧 Mermaid 键的设置定义随
// 本票删除后，overlay 中残留的退役预设值会被 sanitize 当未知键忽略、
// 快照层无法区分「曾是退役值」与「从未设置」，一次性引导将永不触发。
// 因此编排直接读写原始 overlay 层（读经 readRawOverlay；写经
// applyExclusiveOverlayStep——与 SettingsService.apply 同一进程内串行链
// 的最小主题键补丁，PR #581 三审 P2-A：pending 持久化等待窗口内的用户
// 保存不被旧快照覆盖）。
//
// 完成标记（PR #581 三审 P2-B + 五审 P2-C 方案 B'）：**按 profile 身份
// 命名的磁盘权威状态文件**（globalStorageUri 下 `legacy-theme-migration.
// <profileId>.state.json`，wiring 层 tmp+rename 原子写）——判据完全不依赖
// 各窗口 globalState memento 缓存。1.82.3 的 Memento.get 只读本地 _value，
// 存储写入与跨窗广播是分离通道：A 窗口写 done 删锁后，B 窗口缓存过期时会
// 按旧退役值/空标记再次迁移再次引导（评审方受控缓存模拟实测 guides=2）。
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
// **身份等待超时语义（六审 R5-1 改判，失败关闭）**：身份等待窗超时后
// **不再自生成**——磁盘上已有任一迁移状态时本窗让位（不迁移、不引导、
// 不写迁移状态），下次激活 memento 从 db 初始化读到已收敛身份后短路或
// 正常迁移（1.82.3 的窗口重开即 db 读，storage 广播延迟只影响已开窗口
// 的缓存、不影响重开窗口的初始读）。全新 profile 经 overlay 让位记号
// （见 LEGACY_THEME_MIGRATION_IDENTITY_WAIT_DEFERRED_OVERLAY_KEY）在下
// 次激活恢复生成资格——跨 profile 活性不因让位回退（五审 P2-C 修复面
// 保持）。**声明的残余边界（如实落档，不虚饰）**：让位记号的「已让位
// 过一轮 → 恢复生成资格」判定无法区分「全新 profile（db 无身份）」与
// 「身份已入 db 但本窗缓存跨激活地过期」——后者在两窗跨激活交错（一窗
// 的让位记号已入 db、他窗的身份写入尚未到达本窗缓存）且同时在恢复资
// 格上并发时，仍可能多引导一次；该形态比六审前的「任意缓存延迟即每窗
// 重复一次」严格收窄，源于平台不存在「profile 隔离 + 跨窗即时」双满足
// 通道的固有缺口，不承诺「任意延迟下恰 1」。
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
// 多窗口并发（PR #581 评审修复发现 2 + 三审同修 + 四审 P2-D + 六审
// P2-E）：迁移与恢复经 globalStorage 目录的代次锁（fencing）原子认领。
// 六审 P2-E 修订：锁提交点改为 O_EXCL 单调标记族（代次提交与所有权成立
// 是同一原子动作，指针不可回退，见 legacyThemeMigrationLock 六审节）；
// 普通认领对在途候选 fail-closed；owner 序列每个关键副作用（写 pending/
// 发引导）前经 isCurrentGeneration 复核，滞后 owner 静默撤退不再引导。
// **声明的有界边界（六审）**：fence 核验与副作用之间、引导 fire 与 done
// 写之间均为同步序窗口——要求 owner 在其间被更高代次接管需「滞缓超陈旧
// 阈值（默认 10s）+ 微秒级交错」同时成立，比六审前的「24ms 交错即双
// owner」严格多个数量级，与既有「进程 kill 的同步序残余窗口」同类取舍。
// 认领成功者执行完整序列；认领失败者短等待磁盘 done 出现后静默退出（绝
// 不通知），超时也静默退出（本次不引导，待下次激活恢复）。胜者崩溃后锁
// 残留由 mtime 陈旧接管兜底（超阈值接管），不会永久锁死。
import { APPEARANCE_THEME_DEFAULT, APPEARANCE_THEME_KEY, MERMAID_THEME_KEY } from './settings'
import type { LegacyThemeMigrationLockHandle } from './legacyThemeMigrationLock'

/**
 * 原始 overlay 内的迁移 profile 身份键（五审 P2-C B' 第二载体）：与迁移
 * 主题补丁**同一次原子 overlay 写**带入（同 PROFILE 域同写——两载体其一
 * 丢失时仍可恢复身份，状态文件名不漂移）。下划线前缀表机制键非设置键，
 * sanitize 快照层按未知键忽略、不污染生效值。
 */
export const LEGACY_THEME_MIGRATION_PROFILE_ID_OVERLAY_KEY = '_legacyThemeMigration.profileId'

/**
 * 身份等待让位记号（六审 R5-1，overlay 机制键）：身份等待窗超时且磁盘
 * 上已有任一迁移状态时本窗让位（不迁移不引导不写迁移状态），并把该记号
 * 落进本 profile 的 overlay（PROFILE 域持久、跨 profile 域隔离、sanitize
 * 按未知键忽略）。下次激活读到自己的记号 → 恢复生成资格——全新 profile
 * 在他 profile 已迁移的磁盘上不至于永久让位（跨 profile 活性，五审
 * P2-C 的修复面不能回退）。生成身份后记号复位为 false。
 */
export const LEGACY_THEME_MIGRATION_IDENTITY_WAIT_DEFERRED_OVERLAY_KEY =
  '_legacyThemeMigration.identityWaitDeferred'

/**
 * 主题值形态分类（值无关化，T08 五审）：迁移判定按**结构**不按具体字面量
 * ——历史值域（内置 default、已退役的内置预设裸词、T07 起的
 * `<addonId>/<themeId>`）上「裸词且非 default」即退役内置值；判定不持有
 * 具体字面量，退役语义由结构承载：
 * - 'default'：内置默认（保留语义）；
 * - 含 '/' 的 `<addonId>/<themeId>`：组件主题——一律保留首选，含当前
 *   未注册的（与 H-U05「不可用时保留首选」同语义，判定层不查目录）；
 * - 其余裸词：退役内置值（触发迁移回落 + 一次性引导）。
 */
function classifyThemeValue(value: string): 'default' | 'namespaced' | 'retired-builtin' {
  if (value === APPEARANCE_THEME_DEFAULT) return 'default'
  if (value.includes('/')) return 'namespaced'
  return 'retired-builtin'
}

/** 迁移动作：migrate=回落+引导；clean-legacy=只清旧键残留；none=无操作 */
export type LegacyThemeMigrationAction = 'migrate' | 'clean-legacy' | 'none'

/** 迁移计划（纯函数产物；overlayPatch 为对原始 overlay 的增量补丁） */
export interface LegacyThemeMigrationPlan {
  action: LegacyThemeMigrationAction
  overlayPatch: Record<string, string>
  guide: boolean
}

/**
 * 一次性标记（可恢复状态机，磁盘权威形态）：pending = 迁移已认领、引导
 * 欠账（恢复时必补发后收口）；done = 迁移收口（重开/重启/多窗口的幂等
 * 短路判据）。version 记录迁移执行时的扩展版本（诊断用）。
 */
export interface LegacyThemeMigrationMarker {
  state: 'pending' | 'done'
  version: string
}

/** 标记形态守卫（非对象/未知状态/版本非字符串 → null，视为无标记） */
export function parseLegacyThemeMigrationMarker(value: unknown): LegacyThemeMigrationMarker | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const state = (value as Record<string, unknown>)['state']
  const version = (value as Record<string, unknown>)['version']
  if (state !== 'pending' && state !== 'done') return null
  if (typeof version !== 'string') return null
  return { state, version }
}

const NOOP_PLAN: LegacyThemeMigrationPlan = { action: 'none', overlayPatch: {}, guide: false }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 与 resolveThemePreferred 同款的有意义取值判定：非字符串或 trim 后空串视为未设置 */
function meaningfulThemeValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.trim() === '' ? undefined : value
}

/**
 * 三档迁移矩阵（纯函数；判定只看原始 overlay 与完成标记，不看快照；值
 * 无关化——退役/组件身份按结构分类，见 classifyThemeValue）：
 * 1. 新键为退役内置值（裸词非 default），或新键 default/缺失且原始旧
 *    Mermaid 键为退役内置值 → 双键回落 'default' + 一次性引导；
 * 2. 新键为组件主题身份（命名空间形态，含未注册——用户已作新选择）→
 *    不动新键；旧键退役残留清为 'default'；不引导；
 * 3. 其余（新键组件主题且旧键非退役裸词、双键 default/组件形态、双键
 *    缺失等）→ 无操作。
 */
export function planLegacyThemeMigration(rawOverlay: unknown, migrationDone: boolean): LegacyThemeMigrationPlan {
  if (migrationDone) {
    // done 标记在场即迁移已收口——幂等短路，保证引导只发一次
    return NOOP_PLAN
  }
  if (!isRecord(rawOverlay)) {
    return NOOP_PLAN
  }
  const theme = meaningfulThemeValue(rawOverlay[APPEARANCE_THEME_KEY])
  const legacy = meaningfulThemeValue(rawOverlay[MERMAID_THEME_KEY])
  const themeIsRetired = theme !== undefined && classifyThemeValue(theme) === 'retired-builtin'
  const legacyIsRetired = legacy !== undefined && classifyThemeValue(legacy) === 'retired-builtin'
  const themeIsDefault = theme === undefined || classifyThemeValue(theme) === 'default'
  if (themeIsRetired || (themeIsDefault && legacyIsRetired)) {
    return {
      action: 'migrate',
      overlayPatch: { [APPEARANCE_THEME_KEY]: APPEARANCE_THEME_DEFAULT, [MERMAID_THEME_KEY]: 'default' },
      guide: true,
    }
  }
  if (theme !== undefined && classifyThemeValue(theme) === 'namespaced' && legacyIsRetired) {
    return {
      action: 'clean-legacy',
      overlayPatch: { [MERMAID_THEME_KEY]: 'default' },
      guide: false,
    }
  }
  return NOOP_PLAN
}

/** 宿主编排端口（vscode 层实现见 host/legacyThemeMigrationWiring；单测注入假端口） */
export interface LegacyThemeMigrationPorts {
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
   * （PROFILE 域）→ 原始 overlay 内部键（LEGACY_THEME_MIGRATION_PROFILE_ID_
   * OVERLAY_KEY，迁移补丁同批写入的第二载体）。返回 null = 本 profile
   * 尚无身份——生成只发生在锁内 owner 序列（唯一生成点，见文件头）。
   */
  readProfileId(): Promise<string | null>
  /** profileId 持久化（globalState 独立键；overlay 载体由迁移补丁同批承载） */
  writeProfileId(id: string): Promise<void>
  /**
   * 六审 R5-1（让位判定的磁盘信号）：共享磁盘上是否已有任一按身份命名
   * 的迁移状态文件。身份等待超时且此信号为真时，本窗身份可能只是
   * memento 缓存过期（同 profile 前窗已生成、广播在途）——让位而非自
   * 造新 UUID（R5 复审实测三窗三次重复引导的根因）。
   */
  hasAnyMigrationState(): Promise<boolean>
  /**
   * P2-B/P2-C 磁盘权威状态读（按 profileId 命名的状态文件；即时跨窗、
   * 跨 profile 分居）——不依赖本窗口 memento 缓存（无标记/损坏按 null）。
   */
  readMarker(profileId: string): Promise<LegacyThemeMigrationMarker | null>
  /** 磁盘权威状态文件原子写（wiring 层 tmp+rename） */
  writeMarker(profileId: string, marker: LegacyThemeMigrationMarker): Promise<void>
  /** context.extension.packageJSON.version（标记值，诊断用） */
  extensionVersion(): string
  /** 一次性安装引导通知（VSIDIAN_TEST_HOOKS=1 时短路，wiring 层实现） */
  requestGuide(): void
  /** 跨窗口锁句柄（代次锁/fencing 协议见 legacyThemeMigrationLock） */
  lock: LegacyThemeMigrationLockHandle
}

/** 编排结果：action 同计划；guide = 本次是否请求了引导 */
export interface LegacyThemeMigrationRunResult {
  action: LegacyThemeMigrationAction
  guide: boolean
}

/** 并发认领参数（默认值见 runLegacyThemeMigration；单测注入小间隔/超时） */
export interface LegacyThemeMigrationRunOptions {
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
  /**
   * profileId 生成工厂（UUID）：宿主注入 node:crypto 的 randomUUID——
   * 1.82.3 扩展宿主为 Node 18，globalThis.crypto 尚未挂全局（Node 19+
   * 才有），默认走 globalThis 仅供较新运行时/测试环境兜底
   */
  profileIdFactory?: () => string
}

const NONE_RESULT: LegacyThemeMigrationRunResult = { action: 'none', guide: false }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 锁内 profile 身份解析（六审 R5-1 改判：等待窗超时不再无条件自生成）。
 * 判定链（按序）：
 * 1. 两载体读序（globalState 独立键 → overlay 内部键）+ 等待窗内轮询重
 *    读——同 profile 他窗刚生成、广播在途时收敛为同一 id；
 * 2. 超时后**不生成**：本窗 memento 可能只是缓存过期（同 profile 前窗
 *    已生成身份、storage 广播延迟超出等待窗），此刻自造新 UUID 会让同
 *    profile 每个未收到广播的窗口各迁移各引导一次（R5 复审实测三窗
 *    三次）。让位 = 返回 null：本次激活不迁移、不引导、不写迁移状态，
 *    下次激活 memento 从 db 初始化读到已收敛身份后短路或正常迁移；
 * 3. 让位须可逃逸（跨 profile 活性）：全新 profile 在「他 profile 已有
 *    迁移状态」的磁盘上首次激活也会让位——不可逃逸即永久让位（等于
 *    跨 profile 永久短路，五审 P2-C 修复面回退）。逃逸通道 = overlay
 *    让位记号（见 LEGACY_THEME_MIGRATION_IDENTITY_WAIT_DEFERRED_OVERLAY_KEY）：
 *    已让位过一轮的 profile 下次激活读到自己的记号 → 恢复生成资格，
 *    生成后记号复位；
 * 4. 磁盘全净（无任何 profile 曾认领）→ 首次认领，正常生成（单窗升级
 *    主路径零额外激活成本）。
 */
async function resolveProfileIdOrDefer(
  ports: LegacyThemeMigrationPorts,
  options: LegacyThemeMigrationRunOptions,
): Promise<string | null> {
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
  const overlay = ports.readRawOverlay()
  const deferredBefore = isRecord(overlay) &&
    overlay[LEGACY_THEME_MIGRATION_IDENTITY_WAIT_DEFERRED_OVERLAY_KEY] === true
  if (!deferredBefore && await ports.hasAnyMigrationState()) {
    // 让位：记号落本 profile overlay（重开窗口从 db 读到；写失败不阻断
    // 让位本身——下次激活按无记号再走一轮，方向仍 fail-closed）
    await ports.applyExclusiveOverlayStep(() => ({
      patch: { [LEGACY_THEME_MIGRATION_IDENTITY_WAIT_DEFERRED_OVERLAY_KEY]: true },
      result: undefined,
    })).catch(() => undefined)
    return null
  }
  const factory = options.profileIdFactory ?? (() => globalThis.crypto.randomUUID())
  id = factory()
  await ports.writeProfileId(id)
  if (deferredBefore) {
    // 生成后复位让位记号：此后本 profile 的身份缓存过期窗（若再有）回到
    // 让位判定，不再持有「已让位过」的生成资格
    await ports.applyExclusiveOverlayStep(() => ({
      patch: { [LEGACY_THEME_MIGRATION_IDENTITY_WAIT_DEFERRED_OVERLAY_KEY]: false },
      result: undefined,
    })).catch(() => undefined)
  }
  return id
}

/**
 * 胜者序列（认领成功后执行）：锁内解析/补生成 profile 身份（B' 唯一
 * 生成点）→ 磁盘重读状态 → 按恢复规则补完。
 * - plan migrate → 完整序列：写 pending → 串行化重判并落最小补丁（身份
 *   键随补丁同批原子写，见 LEGACY_THEME_MIGRATION_PROFILE_ID_OVERLAY_KEY）→
 *   （重判仍 migrate 才）发引导（同步序）→ 写 done；重判落到档 2/档 3
 *   说明等待期间用户已自行处置——不引导，直接写 done 收口（P2-A）；
 * - plan clean-legacy → 只清旧键（pending 欠账则补发引导并收口）；
 * - plan none 且 pending 在场 → 补发引导后写 done（引导欠账必达）；
 * - plan none 且无 pending → 静默收尾。
 * 异常时立即释放锁（token 校验式，下次激活可立即重试）；真实进程崩溃
 * 不走 finally，锁残留由 mtime 陈旧接管兜底。
 */
async function executeOwnerSequence(
  ports: LegacyThemeMigrationPorts,
  profileId: string | null,
  options: LegacyThemeMigrationRunOptions,
): Promise<LegacyThemeMigrationRunResult> {
  try {
    // 六审 P2-E 方向 B（fencing）：owner 序列的每个关键副作用（写 pending、
    // 发引导）前复核自己仍是最高已提交代次——被更高代次接管（自身滞缓/
    // 崩溃后的陈旧接管）时静默撤退：不写状态、不引导，本次激活放弃（pending
    // 若已写则由下次激活按恢复规则补完）。判据依赖锁的「有效指针不可回
    // 退」（O_EXCL 提交标记族，见 legacyThemeMigrationLock 六审节），单纯
    // fencing 不存在「指针被拉回自己代次后误判有效」的形态；判据读取失败
    // 亦按失效处理（fail-closed）。残余边界：核验与副作用之间为同步序
    // （与「引导 fire 与 done 写之间无 await」同类），不承诺任意调度下
    // 恰 1，详见文件头六审声明
    const stillCurrent = async (): Promise<boolean> => {
      try {
        return await ports.lock.isCurrentGeneration()
      } catch {
        return false
      }
    }
    if (!(await stillCurrent())) return NONE_RESULT
    // B'：身份缺失时在锁内解析（快速路径可能带着 null 进来——那是需要
    // 迁移但尚无身份的首次激活；等待/让位语义见 resolveProfileIdOrDefer）
    const id = profileId ?? await resolveProfileIdOrDefer(ports, options)
    if (id === null) {
      // 六审 R5-1：身份未定让位——本次激活不迁移、不引导、不写迁移状态
      // （finally 照常释放锁；下次激活从 db 收敛身份后短路或正常迁移）
      return NONE_RESULT
    }
    // 认领后从磁盘重读权威状态（P2-B：等待期间其他窗口可能已完成收口）
    const marker = await ports.readMarker(id)
    if (marker?.state === 'done') {
      return NONE_RESULT
    }
    const recoveredPending = marker?.state === 'pending'
    const rawOverlay = ports.readRawOverlay()
    const plan = planLegacyThemeMigration(rawOverlay, false)
    const version = ports.extensionVersion()

    if (plan.action === 'migrate') {
      // 持久化顺序（发现 1）：pending 先于设置改写落盘——中途任何失败都
      // 能从 pending 恢复，引导不会永久丢失。fence：滞后 owner 不得把
      // 状态机从 done 拉回 pending（写前复核代次）
      if (!(await stillCurrent())) return NONE_RESULT
      await ports.writeMarker(id, { state: 'pending', version })
      // P2-A（PR #581 三审）：pending 落盘后在串行化路径内重读最新
      // overlay 并按三档矩阵重新判定，只写主题相关键的最小补丁（不做
      // 全量 overlay 回写）——等待窗口内用户经 SettingsService.apply
      // 保存的新选择与其他设置都在互斥内的最新快照上合并
      const revisedAction = await ports.applyExclusiveOverlayStep((latest) => {
        const revised = planLegacyThemeMigration(latest, false)
        if (revised.action === 'none') {
          return { patch: null, result: 'none' as const }
        }
        // B'：profile 身份随迁移补丁同批原子写（第二载体，同域同写）
        return {
          patch: { ...revised.overlayPatch, [LEGACY_THEME_MIGRATION_PROFILE_ID_OVERLAY_KEY]: id },
          result: revised.action,
        }
      })
      if (revisedAction === 'migrate') {
        // fence：引导是面向用户的不可撤回副作用，滞后 owner 不得发出
        if (!(await stillCurrent())) return NONE_RESULT
        // 引导 fire 与 done 写之间无 await（同步序）：残余崩溃窗口见文件头
        ports.requestGuide()
        await ports.writeMarker(id, { state: 'done', version })
        return { action: plan.action, guide: true }
      }
      // 等待期间用户已自行处置（改选组件主题 → 档 2 清旧键、保留新键；
      // 双键到位 → 档 3 无操作）：按重判档位语义不引导——引导的原始
      // 理由（旧退役值待回落并告知去向）已消失，用户的选择优先。本次
      // pending 非历史欠账（是本运行刚写），直接写 done 收口
      await ports.writeMarker(id, { state: 'done', version })
      return revisedAction === 'clean-legacy'
        ? { action: 'clean-legacy', guide: false }
        : NONE_RESULT
    }
    if (plan.action === 'clean-legacy') {
      await ports.applyExclusiveOverlayStep(() => ({
        patch: { ...plan.overlayPatch, [LEGACY_THEME_MIGRATION_PROFILE_ID_OVERLAY_KEY]: id },
        result: undefined,
      }))
      if (recoveredPending) {
        // pending = 引导欠账：清旧键之外补发引导并收口（fence：滞后 owner
        // 不得补发——接管者会按同一欠账规则补发，不会丢）
        if (!(await stillCurrent())) return NONE_RESULT
        ports.requestGuide()
        await ports.writeMarker(id, { state: 'done', version })
        return { action: plan.action, guide: true }
      }
      return { action: plan.action, guide: false }
    }
    // plan none：设置已迁移（或本就无需迁移）——只有 pending 欠账需要补发
    if (recoveredPending) {
      if (!(await stillCurrent())) return NONE_RESULT
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
export async function runLegacyThemeMigration(
  ports: LegacyThemeMigrationPorts,
  options: LegacyThemeMigrationRunOptions = {},
): Promise<LegacyThemeMigrationRunResult> {
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
    const plan = planLegacyThemeMigration(ports.readRawOverlay(), false)
    if (plan.action === 'none' && !pending) {
      return NONE_RESULT
    }
  } else {
    // 无身份：无需迁移的 profile 不生成身份、不碰磁盘锁（零开销退出）
    const plan = planLegacyThemeMigration(ports.readRawOverlay(), false)
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
