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
// editorGuard #322 版本锁先例：写锁不依赖用户对通知的响应）：标记与
// 迁移同批写入，重开设置/文档、重启、多窗口（globalState 跨窗口共享，
// 首窗写入后其余窗口读同值）不重复同一引导。已知边界：多窗口在升级
// 后同一毫秒窗内并发激活时存在双弹竞态（与 editorGuard 版本锁同款
// 既定边界，不做分布式锁）。
import { APPEARANCE_THEME_DEFAULT, APPEARANCE_THEME_KEY, MERMAID_THEME_KEY } from './settings'

/** 一次性迁移标记的 globalState 键（vsidian.<域> 命名习惯） */
export const CODEX_MIGRATION_MARKER_KEY = 'vsidian.codexThemeMigration'

/**
 * 迁移判定用的旧内核主题身份字面量。addonThemes 的 CODEX_THEME_ID 已随
 * 内核退役删除，此常量只为迁移判定自持（原始 overlay 中的历史值），
 * 不再是可选主题身份。
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
 * 三档迁移矩阵（纯函数；判定只看原始 overlay 与标记，不看快照）：
 * 1. 新键为旧内核 codex 身份（T07 过渡内置项），或新键 default/缺失且
 *    原始旧 Mermaid 键 = 'codex' → 双键回落 'default' + 一次性引导；
 * 2. 新键为组件主题身份（用户已作新选择）→ 不动新键；旧键残留 'codex'
 *    清为 'default'；不引导；
 * 3. 其余 → 无操作。
 */
export function planCodexThemeMigration(rawOverlay: unknown, markerPresent: boolean): CodexMigrationPlan {
  if (markerPresent) {
    // 标记与迁移同批写入（见 runCodexThemeMigration），标记在场即迁移
    // 已完成——幂等短路，保证引导只发一次
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
  /** globalState.update('vsidian.settings', ...)——迁移唯一写设置通道 */
  writeRawOverlay(value: Record<string, unknown>): Promise<void>
  /** globalState.get(标记键)——undefined 即未迁移 */
  readMarker(): unknown
  /** globalState.update(标记键, 版本)——与迁移同批 */
  writeMarker(version: string): Promise<void>
  /** context.extension.packageJSON.version（标记值，诊断用） */
  extensionVersion(): string
  /** 一次性安装引导通知（VSIDIAN_TEST_HOOKS=1 时短路，wiring 层实现） */
  requestGuide(): void
}

/** 编排结果：action 同计划；guide = 本次是否请求了引导 */
export interface CodexMigrationRunResult {
  action: CodexMigrationAction
  guide: boolean
}

/**
 * 宿主编排：计划 → 写原始 overlay → 写标记（migrate 档）→ 请求引导。
 * 顺序上持久化先于引导（迁移结果不依赖通知成败）；overlay 写失败时异常
 * 向调用方传播、不写标记不引导（下次激活重试）。
 */
export async function runCodexThemeMigration(ports: CodexMigrationPorts): Promise<CodexMigrationRunResult> {
  const rawOverlay = ports.readRawOverlay()
  const plan = planCodexThemeMigration(rawOverlay, ports.readMarker() !== undefined)
  if (plan.action === 'none') {
    return { action: plan.action, guide: false }
  }
  const overlay = isRecord(rawOverlay) ? rawOverlay : {}
  await ports.writeRawOverlay({ ...overlay, ...plan.overlayPatch })
  if (plan.guide) {
    await ports.writeMarker(ports.extensionVersion())
    ports.requestGuide()
  }
  return { action: plan.action, guide: plan.guide }
}
