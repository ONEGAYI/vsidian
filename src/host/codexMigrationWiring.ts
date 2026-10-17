// #535 T08 旧内核 Codex 设置迁移——vscode 层装配：globalState 原始
// overlay 读写端口（直写存储层，绕过 SettingsService.apply 的定义校验
// ——旧键定义已删除，经 apply 写旧键会被拒；判定依据见 shared/
// codexMigration 头注释）、一次性安装引导通知、globalStorage 锁文件
// 跨窗口原子认领（PR #581 评审发现 2：fs.open 'wx' = O_EXCL）与
// _test 钩子（VSIDIAN_TEST_HOOKS 门控，判据与 editorGuardWiring 一致）。
//
// 集成测试宿主的通知短路：VSIDIAN_TEST_HOOKS=1 时引导通知 no-op（独立
// 桌面测试宿主无法交互 toast，与 editorGuardWiring 同一口径）；引导计
// 数在 requestGuide 内先递增——短路只挡 UI，不挡「引导已决定」的观测。
import * as vscode from 'vscode'
import { promises as fsp } from 'fs'
import * as path from 'path'
import {
  CODEX_MIGRATION_MARKER_KEY,
  parseCodexMigrationMarker,
  runCodexThemeMigration,
  type CodexMigrationMarker,
  type CodexMigrationPorts,
} from '../shared/codexMigration'
import { APPEARANCE_THEME_KEY, MERMAID_THEME_KEY } from '../shared/settings'
import { SETTINGS_STORAGE_KEY, SettingsService } from './settingsService'
import { t } from '../shared/i18n'
/** globalStorage 内的迁移锁文件名（多窗口原子认领；mtime 为陈旧判据） */
const CODEX_MIGRATION_LOCK_FILE = 'codex-theme-migration.lock'

/** 迁移运行时状态（_test 观测面；原始 overlay 两键为原始层值非快照值） */
export interface CodexMigrationRuntimeState {
  /** 一次性标记（pending = 引导欠账 / done = 迁移收口；null = 未迁移） */
  marker: CodexMigrationMarker | null
  /** 引导已决定次数（含被测试短路挡下的 UI） */
  guideCount: number
  /** 原始 overlay 中的新键值（未经 sanitize） */
  overlayTheme: unknown
  /** 原始 overlay 中的旧 Mermaid 键值（未经 sanitize） */
  overlayMermaid: unknown
}

export interface CodexMigrationWiring {
  /** _test / 诊断观测面 */
  stateFor(): CodexMigrationRuntimeState
  /** 重跑迁移（_test 专用：模拟重启后的再次激活；生产只在 activate 跑一次） */
  run(): Promise<{ action: string; guide: boolean }>
}

export function createCodexMigrationWiring(
  context: vscode.ExtensionContext,
  settingsService: SettingsService,
): CodexMigrationWiring {
  // 集成测试宿主通知短路（判据与 editorGuardWiring 一致，见文件头注释）
  const testHooks = process.env.VSIDIAN_TEST_HOOKS === '1'
  let guideCount = 0

  // ---- 多窗口原子认领锁（globalStorage 目录内锁文件；O_EXCL） ----
  const lockPath = path.join(context.globalStorageUri.fsPath, CODEX_MIGRATION_LOCK_FILE)
  const releaseMigrationLock = async (): Promise<void> => {
    await fsp.rm(lockPath, { force: true })
  }
  const ports: CodexMigrationPorts = {
    readRawOverlay: () => context.globalState.get(SETTINGS_STORAGE_KEY),
    // P2-A（PR #581 三审）：读-判-写经 SettingsService 串行链——与设置页
    // 保存（apply）互斥，等待窗口内的用户写入不被旧快照覆盖
    applyExclusiveOverlayStep: (step) => settingsService.runExclusiveOverlayStep(step),
    readMarker: () => context.globalState.get(CODEX_MIGRATION_MARKER_KEY),
    writeMarker: (marker) => Promise.resolve(context.globalState.update(CODEX_MIGRATION_MARKER_KEY, marker)),
    extensionVersion: () => String(
      (context.extension.packageJSON as { version?: unknown }).version ?? ''),
    requestGuide: () => {
      // 计数先于短路：迁移决定本身可观测（集成断言「只引导一次」的判据）
      guideCount += 1
      if (testHooks) {
        return
      }
      // 不自动安装组件、不自动替用户选主题（规格 §6.2）：通知只说明去向
      // 与当前回落，安装与选择归用户
      void vscode.window.showInformationMessage(t('host.codexThemeMigrated'))
    },
    tryAcquireLock: async () => {
      await fsp.mkdir(context.globalStorageUri.fsPath, { recursive: true })
      try {
        const handle = await fsp.open(lockPath, 'wx')
        try {
          await handle.writeFile(String(process.pid), 'utf8')
        } finally {
          await handle.close()
        }
        return true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
        throw error
      }
    },
    lockAgeMs: async () => {
      try {
        const stat = await fsp.stat(lockPath)
        return Date.now() - stat.mtimeMs
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    },
    releaseLock: releaseMigrationLock,
  }

  const stateFor = (): CodexMigrationRuntimeState => {
    const marker = parseCodexMigrationMarker(context.globalState.get(CODEX_MIGRATION_MARKER_KEY))
    const overlay = context.globalState.get<Record<string, unknown>>(SETTINGS_STORAGE_KEY)
    return {
      marker,
      guideCount,
      overlayTheme: typeof overlay === 'object' && overlay !== null && !Array.isArray(overlay)
        ? overlay[APPEARANCE_THEME_KEY]
        : undefined,
      overlayMermaid: typeof overlay === 'object' && overlay !== null && !Array.isArray(overlay)
        ? overlay[MERMAID_THEME_KEY]
        : undefined,
    }
  }

  // 激活即迁移一次（早于编辑器/设置页面板建立——面板拉快照时已读到迁移
  // 后值；不阻塞激活返回，失败仅丢一次迁移，下次激活重试）
  void runCodexThemeMigration(ports).catch((error) => {
    console.warn('[vsidian] Codex 主题迁移失败（下次激活重试）:', error)
  })

  // ---- 测试钩子命令：仅 VSIDIAN_TEST_HOOKS=1 注册（判据与
  // editorGuardWiring 的 _test 块一致），生产 VSIX 与常规 F5 不暴露 ----
  if (testHooks) {
    context.subscriptions.push(
      vscode.commands.registerCommand(
        'onegayi.vsidian._test.getCodexMigrationState',
        (): CodexMigrationRuntimeState => stateFor(),
      ),
      // 用例造数：直写原始 overlay 双键（绕过定义校验，模拟升级残留；
      // null = 删除该键——「从未设置」形态）
      vscode.commands.registerCommand(
        'onegayi.vsidian._test.injectCodexLegacyOverlay',
        async (values: { theme?: string | null; mermaid?: string | null }) => {
          const overlay = {
            ...context.globalState.get<Record<string, unknown>>(SETTINGS_STORAGE_KEY),
          }
          if (values.theme === null) {
            delete overlay[APPEARANCE_THEME_KEY]
          } else if (values.theme !== undefined) {
            overlay[APPEARANCE_THEME_KEY] = values.theme
          }
          if (values.mermaid === null) {
            delete overlay[MERMAID_THEME_KEY]
          } else if (values.mermaid !== undefined) {
            overlay[MERMAID_THEME_KEY] = values.mermaid
          }
          await context.globalState.update(SETTINGS_STORAGE_KEY, overlay)
          return true
        },
      ),
      // 用例隔离：清一次性标记 + 引导计数归零 + 认领锁（overlay 不动——
      // 造数走注入钩子；runner 每用例前调用，防止迁移标记与锁残留跨用例
      // 污染——崩溃注入场景的残留锁在此收口）
      vscode.commands.registerCommand(
        'onegayi.vsidian._test.resetCodexMigration',
        async () => {
          await context.globalState.update(CODEX_MIGRATION_MARKER_KEY, undefined)
          await releaseMigrationLock()
          guideCount = 0
          return true
        },
      ),
      vscode.commands.registerCommand(
        'onegayi.vsidian._test.runCodexMigration',
        () => runCodexThemeMigration(ports),
      ),
    )
  }

  return {
    stateFor,
    run: () => runCodexThemeMigration(ports),
  }
}
