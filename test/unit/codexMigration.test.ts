// #535 T08 旧内核 Codex 设置迁移——纯函数与宿主编排的契约测试。
//
// 判据关键：迁移判定读 globalState `vsidian.settings` 的**原始 overlay**
// （未经 sanitize）——枚举收窄后 sanitize 会把残留 'codex' 静默变
// 'default'，快照层无法区分「曾是 codex」与「从未设置」，一次性引导
// 将永不触发（探索笔记 theme-settings-flow 第一节的推论）。
import { describe, expect, it } from 'vitest'
import {
  CODEX_MIGRATION_MARKER_KEY,
  planCodexThemeMigration,
  runCodexThemeMigration,
  type CodexMigrationPorts,
} from '../../src/shared/codexMigration'
import { APPEARANCE_THEME_KEY, MERMAID_THEME_KEY } from '../../src/shared/settings'

// ---- 三档迁移矩阵（规格 addon-themes.md §6.2 / 任务书语义矩阵） ----

describe('planCodexThemeMigration（三档迁移矩阵，原始 overlay 判据）', () => {
  it('档 1a：新键显式 codex（T07 过渡内置项身份）→ 双键回落 default + 引导', () => {
    expect(planCodexThemeMigration(
      { [APPEARANCE_THEME_KEY]: 'codex', [MERMAID_THEME_KEY]: 'codex' },
      false,
    )).toEqual({
      action: 'migrate',
      overlayPatch: { [APPEARANCE_THEME_KEY]: 'default', [MERMAID_THEME_KEY]: 'default' },
      guide: true,
    })
  })

  it('档 1b：新键缺失/空串且原始旧键 codex → 双键回落 default + 引导（升级用户主路径）', () => {
    expect(planCodexThemeMigration({ [MERMAID_THEME_KEY]: 'codex' }, false)).toEqual({
      action: 'migrate',
      overlayPatch: { [APPEARANCE_THEME_KEY]: 'default', [MERMAID_THEME_KEY]: 'default' },
      guide: true,
    })
    expect(planCodexThemeMigration({ [APPEARANCE_THEME_KEY]: '', [MERMAID_THEME_KEY]: 'codex' }, false))
      .toMatchObject({ action: 'migrate', guide: true })
  })

  it('档 1c：新键 default 且原始旧键 codex → 双键回落 default + 引导（清残留）', () => {
    expect(planCodexThemeMigration(
      { [APPEARANCE_THEME_KEY]: 'default', [MERMAID_THEME_KEY]: 'codex' },
      false,
    )).toEqual({
      action: 'migrate',
      overlayPatch: { [APPEARANCE_THEME_KEY]: 'default', [MERMAID_THEME_KEY]: 'default' },
      guide: true,
    })
  })

  it('档 2：新键为组件主题身份 → 不动新键；旧键残留 codex 清 default；不引导', () => {
    expect(planCodexThemeMigration(
      { [APPEARANCE_THEME_KEY]: 'pub.two/aqua', [MERMAID_THEME_KEY]: 'codex' },
      false,
    )).toEqual({
      action: 'clean-legacy',
      overlayPatch: { [MERMAID_THEME_KEY]: 'default' },
      guide: false,
    })
  })

  it('档 2b：新键为组件主题身份且旧键无 codex 残留 → 无操作', () => {
    expect(planCodexThemeMigration({ [APPEARANCE_THEME_KEY]: 'pub.two/aqua' }, false))
      .toEqual({ action: 'none', overlayPatch: {}, guide: false })
    expect(planCodexThemeMigration({ [APPEARANCE_THEME_KEY]: 'pub.two/aqua', [MERMAID_THEME_KEY]: 'default' }, false))
      .toEqual({ action: 'none', overlayPatch: {}, guide: false })
  })

  it('档 3：新键 default/缺失且旧键非 codex → 无操作', () => {
    expect(planCodexThemeMigration(undefined, false)).toEqual({ action: 'none', overlayPatch: {}, guide: false })
    expect(planCodexThemeMigration({}, false)).toEqual({ action: 'none', overlayPatch: {}, guide: false })
    expect(planCodexThemeMigration({ [MERMAID_THEME_KEY]: 'default' }, false))
      .toEqual({ action: 'none', overlayPatch: {}, guide: false })
    expect(planCodexThemeMigration({ [APPEARANCE_THEME_KEY]: 'default' }, false))
      .toEqual({ action: 'none', overlayPatch: {}, guide: false })
  })

  it('原始 overlay 形态防御：数组/非对象值 → 无操作', () => {
    expect(planCodexThemeMigration(['codex'], false)).toEqual({ action: 'none', overlayPatch: {}, guide: false })
    expect(planCodexThemeMigration('codex', false)).toEqual({ action: 'none', overlayPatch: {}, guide: false })
  })

  it('一次性标记在场 → 无操作（不再迁移、不再引导——重开/重启/多窗口只一次的判据）', () => {
    expect(planCodexThemeMigration({ [MERMAID_THEME_KEY]: 'codex' }, true))
      .toEqual({ action: 'none', overlayPatch: {}, guide: false })
    expect(planCodexThemeMigration({ [APPEARANCE_THEME_KEY]: 'codex' }, true))
      .toEqual({ action: 'none', overlayPatch: {}, guide: false })
  })
})

// ---- 宿主编排 ----

function fakePorts(rawOverlay: unknown, marker: unknown = undefined): { ports: CodexMigrationPorts; state: { overlay: unknown; marker: unknown; guides: number; events: string[] } } {
  const state = { overlay: rawOverlay, marker, guides: 0, events: [] as string[] }
  const ports: CodexMigrationPorts = {
    readRawOverlay: () => {
      return state.overlay
    },
    writeRawOverlay: async (value) => {
      state.events.push('write-overlay')
      state.overlay = value
    },
    readMarker: () => state.marker,
    writeMarker: async () => {
      state.events.push('write-marker')
      state.marker = '1.2.3-test'
    },
    extensionVersion: () => '1.2.3-test',
    requestGuide: () => {
      state.events.push('guide')
      state.guides += 1
    },
  }
  return { ports, state }
}

describe('runCodexThemeMigration（宿主编排）', () => {
  it('迁移：直接改写原始 overlay 双键、写标记、请求引导；持久化先于引导（写锁不依赖用户响应）', async () => {
    const { ports, state } = fakePorts({ [MERMAID_THEME_KEY]: 'codex' })
    const result = await runCodexThemeMigration(ports)
    expect(result).toEqual({ action: 'migrate', guide: true })
    expect(state.overlay).toEqual({ [APPEARANCE_THEME_KEY]: 'default', [MERMAID_THEME_KEY]: 'default' })
    expect(state.marker).toBe('1.2.3-test')
    expect(state.guides).toBe(1)
    // 顺序：先持久化（overlay → marker）再引导——迁移结果不依赖通知成败
    expect(state.events).toEqual(['write-overlay', 'write-marker', 'guide'])
  })

  it('迁移保留原始 overlay 中的无关键（增量补丁语义）', async () => {
    const { ports, state } = fakePorts({ [MERMAID_THEME_KEY]: 'codex', 'editor.readableLineWidth': 800 })
    await runCodexThemeMigration(ports)
    expect(state.overlay).toEqual({
      [APPEARANCE_THEME_KEY]: 'default',
      [MERMAID_THEME_KEY]: 'default',
      'editor.readableLineWidth': 800,
    })
  })

  it('clean-legacy：只清旧键、不写标记、不引导', async () => {
    const { ports, state } = fakePorts({ [APPEARANCE_THEME_KEY]: 'pub.two/aqua', [MERMAID_THEME_KEY]: 'codex' })
    const result = await runCodexThemeMigration(ports)
    expect(result).toEqual({ action: 'clean-legacy', guide: false })
    expect(state.overlay).toEqual({ [APPEARANCE_THEME_KEY]: 'pub.two/aqua', [MERMAID_THEME_KEY]: 'default' })
    expect(state.marker).toBeUndefined()
    expect(state.guides).toBe(0)
  })

  it('无操作：不读不写不引导', async () => {
    const { ports, state } = fakePorts({ [MERMAID_THEME_KEY]: 'default' })
    const result = await runCodexThemeMigration(ports)
    expect(result).toEqual({ action: 'none', guide: false })
    expect(state.events).toEqual([])
    expect(state.guides).toBe(0)
  })

  it('标记在场：无操作（重开/重启/多窗口不重复引导）', async () => {
    const { ports, state } = fakePorts({ [MERMAID_THEME_KEY]: 'codex' }, '1.1.0')
    const result = await runCodexThemeMigration(ports)
    expect(result).toEqual({ action: 'none', guide: false })
    expect(state.overlay).toEqual({ [MERMAID_THEME_KEY]: 'codex' })
    expect(state.guides).toBe(0)
    expect(state.events).toEqual([])
  })

  it('overlay 写失败：异常传播、不写标记不引导（下次激活重试）', async () => {
    const state = { marker: undefined as unknown, guides: 0 }
    const ports: CodexMigrationPorts = {
      readRawOverlay: () => ({ [MERMAID_THEME_KEY]: 'codex' }),
      writeRawOverlay: async () => {
        throw new Error('storage down')
      },
      readMarker: () => state.marker,
      writeMarker: async () => {
        state.marker = '1.2.3-test'
      },
      extensionVersion: () => '1.2.3-test',
      requestGuide: () => {
        state.guides += 1
      },
    }
    await expect(runCodexThemeMigration(ports)).rejects.toThrow('storage down')
    expect(state.marker).toBeUndefined()
    expect(state.guides).toBe(0)
  })
})

describe('CODEX_MIGRATION_MARKER_KEY（标记键形态）', () => {
  it('globalState 独立键（vsidian.<域> 命名习惯，与设置 overlay 同 profile 持久化）', () => {
    expect(CODEX_MIGRATION_MARKER_KEY).toBe('vsidian.codexThemeMigration')
  })
})
