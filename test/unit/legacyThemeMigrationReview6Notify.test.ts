// #535 T08 迁移 PR #581 六审 R5-2 契约测试（迁移完成后的首屏状态刷新）。
// 红态场景（对五审尾实现跑红，out/test/t08-review6-notify-red.log）：
// R5 复审实测——迁移 fire-and-forget，无身份先等约 1 秒；期间编辑器/设
// 置页完成首读；迁移写回 overlay 走 SettingsService.runExclusiveOverlayStep
// （P2-A 的串行互斥写），该路径**持久化但不通知**，而主题推送只订阅
// SettingsService.onChange（addonWiring：refreshPreferred + refreshRendererTable
// + postThemesState）——页面停留在首条消息（升级残留旧值/不可用态），
// 迁移完成后无补推，直到重开。
// 修复：runExclusiveOverlayStep 在补丁落盘后走与 apply 成功路径同构的
// 变更通知（链外、以新快照回调监听者）——先打开页面、后迁移完成的窗口
// 经既有通知链收到回落值补推。本测试在 SettingsService↔runLegacyTheme
// Migration 的接缝上钉该通知（下游主题推送与 apply 共用同一通道，为既有
// 机制）；message 层的 preferred/preferredAvailable 全链在集成侧由主题
// 状态用例覆盖。
import { afterAll, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  runLegacyThemeMigration,
  type LegacyThemeMigrationPorts,
} from '../../src/shared/legacyThemeMigration'
import {
  SettingsService,
  SETTINGS_STORAGE_KEY,
  type SettingsStorage,
} from '../../src/host/settingsService'
import { PRODUCTION_SETTING_DEFINITIONS } from '../../src/shared/settings'
import { MERMAID_THEME_KEY, APPEARANCE_THEME_KEY } from '../../src/shared/settings'
import { makeDiskMarkerStore } from './legacyDiskMarkerStore'

const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'vsidian-legacy-review6-notify-'))
afterAll(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true })
})

/** 内存 memento（globalState 语义） */
function makeMemento(): { memento: SettingsStorage; store: Map<string, unknown> } {
  const store = new Map<string, unknown>()
  const memento: SettingsStorage = {
    get: <T>(key: string) => store.get(key) as T | undefined,
    update: (key: string, value: unknown) => {
      store.set(key, value)
      return Promise.resolve()
    },
  }
  return { memento, store }
}

/** 内存锁（通知接缝测试不涉锁协议，细节由 review6Lock 钉住） */
function makeMemLock() {
  const state = { held: false }
  return {
    tryAcquire: async () => {
      if (state.held) return false
      state.held = true
      return true
    },
    takeoverIfStale: async () => state.held === false,
    release: async () => {
      state.held = false
    },
    ageMs: async () => (state.held ? 0 : null),
    isCurrentGeneration: async () => state.held,
    forceCleanup: async () => {
      state.held = false
    },
  }
}

describe('六审 R5-2：迁移写回 overlay 后经 SettingsService.onChange 补推（首屏不再停留在旧值）', () => {
  it('先订阅（页面首读后）、后迁移完成 → 订阅者收到含回落值的新快照；无补丁路径不打扰', async () => {
    const dir = path.join(tmpRoot, 'case-1')
    await fsp.mkdir(dir, { recursive: true })
    const diskMarker = makeDiskMarkerStore(dir)
    const { memento } = makeMemento()
    // 升级残留形态：新键显式退役内置值 + 旧键退役残留（reviewer 场景的
    // preferred:'codex' 同构——首读快照携带旧值而非 default）
    memento.update(SETTINGS_STORAGE_KEY, {
      [APPEARANCE_THEME_KEY]: 'retired-builtin',
      [MERMAID_THEME_KEY]: 'retired-preset',
    })
    // 真实 SettingsService（与生产同构造）；applyExclusiveOverlayStep 的
    // 组合方式与 legacyThemeMigrationWiring 逐字相同
    const settingsService = new SettingsService(memento, PRODUCTION_SETTING_DEFINITIONS)
    /** 首读（页面打开时的初始快照——仍是迁移前的残留值） */
    const firstRead = settingsService.getSnapshot()
    expect(firstRead[APPEARANCE_THEME_KEY]).toBe('retired-builtin') // 尚未回落

    const seen: unknown[] = []
    settingsService.onChange((values) => seen.push(values))

    let guides = 0
    const ports: LegacyThemeMigrationPorts = {
      readRawOverlay: () => memento.get(SETTINGS_STORAGE_KEY),
      applyExclusiveOverlayStep: (step) => settingsService.runExclusiveOverlayStep(step),
      readProfileId: async () => 'review6-notify-profile',
      writeProfileId: async () => {},
      hasAnyMigrationState: async () => false,
      readMarker: diskMarker.readMarker,
      writeMarker: diskMarker.writeMarker,
      extensionVersion: () => '1.2.3-test',
      requestGuide: () => {
        guides += 1
      },
      lock: makeMemLock(),
    }
    const result = await runLegacyThemeMigration(ports)
    expect(result).toEqual({ action: 'migrate', guide: true })
    expect(guides).toBe(1)
    // 持久值已回落
    const overlay = memento.get<Record<string, unknown>>(SETTINGS_STORAGE_KEY)
    expect(overlay[APPEARANCE_THEME_KEY]).toBe('default')
    expect(overlay[MERMAID_THEME_KEY]).toBe('default')
    // R5-2 核心：迁移写回必须触发与 apply 同构的变更通知——订阅者（主题
    // 推送链）收到含回落值的新快照。红态：runExclusiveOverlayStep 持久
    // 化但不通知，seen 为空（页面停留在首读旧值，无补推）
    expect(seen.length).toBeGreaterThanOrEqual(1)
    const last = seen[seen.length - 1] as Record<string, unknown>
    expect(last[APPEARANCE_THEME_KEY]).toBe('default')
  })

  it('无补丁步骤（plan none 且无 pending）不打扰订阅者——通知只随实际落盘的补丁发生', async () => {
    const dir = path.join(tmpRoot, 'case-2')
    await fsp.mkdir(dir, { recursive: true })
    const diskMarker = makeDiskMarkerStore(dir)
    const { memento } = makeMemento()
    memento.update(SETTINGS_STORAGE_KEY, { [MERMAID_THEME_KEY]: 'default' })
    const settingsService = new SettingsService(memento, PRODUCTION_SETTING_DEFINITIONS)
    const seen: unknown[] = []
    settingsService.onChange((values) => seen.push(values))
    const ports: LegacyThemeMigrationPorts = {
      readRawOverlay: () => memento.get(SETTINGS_STORAGE_KEY),
      applyExclusiveOverlayStep: (step) => settingsService.runExclusiveOverlayStep(step),
      readProfileId: async () => 'review6-notify-profile',
      writeProfileId: async () => {},
      hasAnyMigrationState: async () => false,
      readMarker: diskMarker.readMarker,
      writeMarker: diskMarker.writeMarker,
      extensionVersion: () => '1.2.3-test',
      requestGuide: () => {},
      lock: makeMemLock(),
    }
    // plan none 且无 pending：快速路径零副作用（不抢锁不写盘）
    const result = await runLegacyThemeMigration(ports)
    expect(result).toEqual({ action: 'none', guide: false })
    expect(seen).toEqual([])
  })
})
