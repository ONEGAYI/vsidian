// #535 T08 旧内核 Codex 设置迁移——vscode 层装配：globalState 原始
// overlay 读端口 + 经 SettingsService 串行链的最小主题键补丁写端口
// （PR #581 三审 P2-A）、profile 作用域磁盘权威完成状态（P2-B：
// globalStorageUri 下 state JSON，跨窗口一致、不依赖各窗口 memento
// 缓存——1.82.3 的 Memento.get 只读本地 _value，写入与跨窗广播分离）、
// token/rename 安全接管锁（codexMigrationLock 协议）、一次性安装引导
// 通知与 _test 钩子（VSIDIAN_TEST_HOOKS 门控，判据与 editorGuardWiring
// 一致）。
//
// 集成测试宿主的通知短路：VSIDIAN_TEST_HOOKS=1 时引导通知 no-op（独立
// 桌面测试宿主无法交互 toast，与 editorGuardWiring 同一口径）；引导计
// 数在 requestGuide 内先递增——短路只挡 UI，不挡「引导已决定」的观测。
import * as vscode from 'vscode'
import { randomUUID } from 'node:crypto'
import { promises as fsp } from 'fs'
import * as path from 'path'
import {
  parseCodexMigrationMarker,
  runCodexThemeMigration,
  type CodexMigrationMarker,
  type CodexMigrationPorts,
} from '../shared/codexMigration'
import {
  createCodexMigrationLock,
  type CodexLockFilesystem,
} from '../shared/codexMigrationLock'
import { APPEARANCE_THEME_KEY, MERMAID_THEME_KEY } from '../shared/settings'
import { SETTINGS_STORAGE_KEY, SettingsService } from './settingsService'
import { t } from '../shared/i18n'

/** globalStorage 内的迁移锁文件名（多窗口原子认领；协议见 codexMigrationLock） */
const CODEX_MIGRATION_LOCK_FILE = 'codex-theme-migration.lock'

/**
 * globalStorage 内的迁移完成状态文件（P2-B：profile 作用域磁盘权威——
 * globalStorageUri 本身按 profile 隔离，不用跨 profile 共享目录；判据
 * 不依赖各窗口 globalState memento 缓存）
 */
const CODEX_MIGRATION_STATE_FILE = 'codex-theme-migration.state.json'

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
  /** _test / 诊断观测面（marker 从磁盘权威状态文件读取） */
  stateFor(): Promise<CodexMigrationRuntimeState>
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

  const storageDir = context.globalStorageUri.fsPath
  const lockPath = path.join(storageDir, CODEX_MIGRATION_LOCK_FILE)
  const statePath = path.join(storageDir, CODEX_MIGRATION_STATE_FILE)

  // ---- P2-B：磁盘权威完成状态（tmp+rename 原子写；损坏按无标记处理，
  // 恢复语义兜底——rename 原子性保证正常路径不会读到半截内容） ----
  const readMarkerFromDisk = async (): Promise<CodexMigrationMarker | null> => {
    try {
      return parseCodexMigrationMarker(JSON.parse(await fsp.readFile(statePath, 'utf8')))
    } catch {
      return null
    }
  }
  const writeMarkerToDisk = async (marker: CodexMigrationMarker): Promise<void> => {
    await fsp.mkdir(storageDir, { recursive: true })
    const tmp = `${statePath}.${process.pid}.tmp`
    await fsp.writeFile(tmp, JSON.stringify(marker), 'utf8')
    await fsp.rename(tmp, statePath)
  }

  // ---- 跨窗口锁（fs 原语端口 + 协议实现；token 为本窗口本次激活的
  // 认领代次标识——释放与接管都经它核对，见 codexMigrationLock） ----
  const lockFs: CodexLockFilesystem = {
    writeFileExclusive: async (target, data) => {
      // 首次认领前 globalStorage 父目录可能尚不存在（激活早期）——先建
      // 目录再 O_EXCL 创建（沿旧 tryAcquireLock 的 mkdir 先例）
      await fsp.mkdir(path.dirname(target), { recursive: true })
      const handle = await fsp.open(target, 'wx')
      try {
        await handle.writeFile(data, 'utf8')
      } finally {
        await handle.close()
      }
    },
    rename: (from, to) => fsp.rename(from, to),
    link: (from, to) => fsp.link(from, to),
    rm: async (target) => {
      await fsp.rm(target, { force: true })
    },
    statMtimeMs: async (target) => {
      try {
        return (await fsp.stat(target)).mtimeMs
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    },
    readFile: (target) => fsp.readFile(target, 'utf8'),
  }
  const migrationLock = createCodexMigrationLock(lockFs, lockPath, {
    token: randomUUID(),
    pid: process.pid,
  })

  const ports: CodexMigrationPorts = {
    readRawOverlay: () => context.globalState.get(SETTINGS_STORAGE_KEY),
    // P2-A（PR #581 三审）：读-判-写经 SettingsService 串行链——与设置页
    // 保存（apply）互斥，等待窗口内的用户写入不被旧快照覆盖
    applyExclusiveOverlayStep: (step) => settingsService.runExclusiveOverlayStep(step),
    readMarker: readMarkerFromDisk,
    writeMarker: writeMarkerToDisk,
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
    lock: migrationLock,
  }

  const stateFor = async (): Promise<CodexMigrationRuntimeState> => {
    const marker = await readMarkerFromDisk()
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
        (): Promise<CodexMigrationRuntimeState> => stateFor(),
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
      // 用例隔离：清磁盘权威状态 + 隔离式清锁（rename 夺走即删，无观察/
      // 动作窗口）+ 引导计数归零（overlay 不动——造数走注入钩子；runner
      // 每用例前调用，防止迁移状态与锁残留跨用例污染——崩溃注入场景的
      // 残留锁在此收口）
      vscode.commands.registerCommand(
        'onegayi.vsidian._test.resetCodexMigration',
        async () => {
          await fsp.rm(statePath, { force: true })
          await migrationLock.forceCleanup()
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
