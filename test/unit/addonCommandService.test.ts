// #359 T10 宿主命令服务契约测试：上报门控（仅 enabled 接受）、命名空间
// 归属复核、全表替换幂等、宿主命令注册/注销、整组件回收、目录广播与
// 键位运行期表同步。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AddonCommandService } from '../../src/host/addons/addonCommandService'
import type { AddonCommandReport } from '../../src/shared/addonCommands'
import {
  runtimeOperations,
  getEffectiveBindings,
  findConflictedOperationIds,
  __resetRuntimeOperationsForTest,
} from '../../src/shared/keybindings'

const ADDON = 'publisher.addon-a'

function report(commandId: string, addonId = ADDON, overrides: Partial<AddonCommandReport> = {}): AddonCommandReport {
  const localId = commandId.slice(commandId.lastIndexOf('.') + 1)
  return {
    commandId, addonId, localId,
    title: localId, mode: 'both', writes: false, defaults: [],
    ...overrides,
  }
}

function makeService(states: Record<string, string | undefined> = { [ADDON]: 'enabled' }) {
  const registered: Array<{ commandId: string; run: () => boolean; disposed: boolean }> = []
  const forwarded: string[] = []
  const logs: string[] = []
  const service = new AddonCommandService({
    registerHostCommand: (commandId, run) => {
      const entry = { commandId, run, disposed: false }
      registered.push(entry)
      return { dispose: () => { entry.disposed = true } }
    },
    runStateOf: (addonId) => states[addonId] as never,
    forwardToActivePanel: (commandId) => {
      forwarded.push(commandId)
      return true
    },
    log: (stage, addonId, detail) => logs.push(`${stage} ${addonId} ${detail}`),
  })
  return { service, registered, forwarded, logs }
}

describe('T10 宿主命令服务', () => {
  beforeEach(() => __resetRuntimeOperationsForTest())
  afterEach(() => __resetRuntimeOperationsForTest())

  it('enabled 上报接受：宿主命令注册、目录在场、运行期表同步', () => {
    const { service, registered } = makeService()
    service.syncReport(ADDON, 1, [report(`${ADDON}.stamp`, ADDON, { mode: 'live', writes: true, defaults: ['ctrl+alt+f9'] })])
    expect(registered.map((entry) => entry.commandId)).toEqual([`${ADDON}.stamp`])
    expect(service.catalog()).toHaveLength(1)
    expect(runtimeOperations()).toHaveLength(1)
    expect(getEffectiveBindings({}, `${ADDON}.stamp`)).toEqual(['ctrl+alt+f9'])
  })

  it('非 enabled 状态（disabled/faulted/未注册）上报被忽略', () => {
    for (const state of ['disabled', 'faulted', undefined]) {
      const { service, registered, logs } = makeService({ [ADDON]: state })
      service.syncReport(ADDON, 1, [report(`${ADDON}.stamp`)])
      expect(registered).toHaveLength(0)
      expect(logs.some((line) => line.includes('commands-report-ignored'))).toBe(true)
    }
  })

  it('命名空间归属复核：commandId 与 addonId+localId 不一致整批拒绝', () => {
    const { service, logs } = makeService()
    const forged: AddonCommandReport = {
      commandId: 'other.addon.stamp', addonId: ADDON, localId: 'stamp',
      title: 'x', mode: 'both', writes: false, defaults: [],
    }
    service.syncReport(ADDON, 1, [forged])
    expect(service.catalog()).toHaveLength(0)
    expect(logs.some((line) => line.includes('namespace mismatch'))).toBe(true)
  })

  it('全表替换幂等：同表重复上报不重复注册；撤项注销对应命令', () => {
    const { service, registered } = makeService()
    service.syncReport(ADDON, 1, [report(`${ADDON}.one`), report(`${ADDON}.two`)])
    expect(registered).toHaveLength(2)
    // 同表重报（幂等对账）：不新增
    service.syncReport(ADDON, 1, [report(`${ADDON}.one`), report(`${ADDON}.two`)])
    expect(registered).toHaveLength(2)
    // 撤一项：对应宿主命令注销
    service.syncReport(ADDON, 1, [report(`${ADDON}.one`)])
    expect(registered.find((entry) => entry.commandId === `${ADDON}.two`)!.disposed).toBe(true)
    expect(service.catalog().map((item) => item.commandId)).toEqual([`${ADDON}.one`])
  })

  it('宿主命令执行转发到活动面板端口', () => {
    const { service, registered, forwarded } = makeService()
    service.syncReport(ADDON, 1, [report(`${ADDON}.stamp`)])
    const outcome = registered[0]!.run()
    expect(outcome).toBe(true)
    expect(forwarded).toEqual([`${ADDON}.stamp`])
  })

  it('整组件回收：命令注销、目录清空、运行期表同步、广播', () => {
    const { service, registered } = makeService()
    const changes: number[] = []
    service.onChanged(() => changes.push(service.catalog().length))
    service.syncReport(ADDON, 1, [report(`${ADDON}.stamp`)])
    service.releaseAddon(ADDON)
    expect(registered[0]!.disposed).toBe(true)
    expect(service.catalog()).toHaveLength(0)
    expect(runtimeOperations()).toHaveLength(0)
    expect(changes).toEqual([1, 0])
    // 重复回收无害
    service.releaseAddon(ADDON)
    expect(changes).toEqual([1, 0])
  })

  it('#443 非法 defaults（normalizeChord 拒绝形态）整批拒绝', () => {
    const { service, logs } = makeService()
    service.syncReport(ADDON, 1, [
      report(`${ADDON}.one`),
      report(`${ADDON}.bad`, ADDON, { defaults: ['ctrl+alt'] }),
    ])
    expect(service.catalog()).toHaveLength(0)
    expect(runtimeOperations()).toHaveLength(0)
    expect(logs.some((line) =>
      line.includes('commands-report-rejected') && line.includes('invalid defaults'))).toBe(true)
  })

  it('#443 保留 Tab 段 defaults 整批拒绝（SDK 侧 tab-forbidden 的宿主对称面）', () => {
    for (const reserved of ['Tab', 'shift+tab']) {
      const { service, logs } = makeService()
      service.syncReport(ADDON, 1, [
        report(`${ADDON}.one`),
        report(`${ADDON}.tabbed`, ADDON, { defaults: [reserved] }),
      ])
      expect(service.catalog(), reserved).toHaveLength(0)
      expect(runtimeOperations(), reserved).toHaveLength(0)
      expect(logs.some((line) =>
        line.includes('commands-report-rejected') && line.includes('tab-forbidden'))).toBe(true)
    }
    // ctrl/alt/meta+Tab 不属保留段（#427 放行），复验不拒
    const { service: ok } = makeService()
    ok.syncReport(ADDON, 1, [report(`${ADDON}.ctrlTab`, ADDON, { defaults: ['ctrl+tab'] })])
    expect(getEffectiveBindings({}, `${ADDON}.ctrlTab`)).toEqual(['ctrl+tab'])
  })

  it('#443 非规范序 defaults 归一后入目录：冲突检查不漏判', () => {
    const { service } = makeService()
    // 伪造协议消息：defaults 非规范序（大写形态）。修复前宿主目录原样透传，
    // chordOverlap 字面比较与内置 pastePlain 的 ctrl+shift+v 不相等 → 漏判
    service.syncReport(ADDON, 1, [
      report(`${ADDON}.dupe`, ADDON, { defaults: ['Ctrl+Shift+V'] }),
      report(`${ADDON}.alias`, ADDON, { defaults: ['Cmd+Shift+V'] }),
    ])
    expect(getEffectiveBindings({}, `${ADDON}.dupe`)).toEqual(['ctrl+shift+v'])
    expect(getEffectiveBindings({}, `${ADDON}.alias`)).toEqual(['shift+meta+v'])
    const conflicted = findConflictedOperationIds({})
    expect(conflicted.has(`${ADDON}.dupe`)).toBe(true)
    expect(conflicted.has(`${ADDON}.alias`)).toBe(true)
    expect(conflicted.has('pastePlain')).toBe(true)
  })

  it('#449 归一后重复 defaults 上报：目录去重保留首现序、不触发 commands-report-rejected', () => {
    const { service, logs } = makeService()
    // SDK 侧 buildAddonCommandReport 已去重；伪造/旧版消息仍可能携带归一
    // 后重复形态——宿主复验同样去重（与 SDK 侧同语义），重复不属违约
    service.syncReport(ADDON, 1, [
      report(`${ADDON}.dupe`, ADDON, { defaults: ['ctrl+f', 'Ctrl+F'] }),
      report(`${ADDON}.mixed`, ADDON, { defaults: ['Meta+K', 'meta+k', 'ctrl+k'] }),
    ])
    const defaultsOf = (commandId: string) =>
      service.catalog().find((item) => item.commandId === commandId)?.defaults
    expect(defaultsOf(`${ADDON}.dupe`)).toEqual(['ctrl+f'])
    expect(defaultsOf(`${ADDON}.mixed`)).toEqual(['meta+k', 'ctrl+k'])
    expect(getEffectiveBindings({}, `${ADDON}.dupe`)).toEqual(['ctrl+f'])
    expect(logs.some((line) => line.includes('commands-report-rejected'))).toBe(false)
  })

  it('#450 defaults 条数超限（> 4）整批拒绝：too-many defaults', () => {
    const { service, logs } = makeService()
    service.syncReport(ADDON, 1, [
      report(`${ADDON}.one`),
      report(`${ADDON}.many`, ADDON, {
        defaults: ['ctrl+f1', 'ctrl+f2', 'ctrl+f3', 'ctrl+f4', 'ctrl+f5'],
      }),
    ])
    expect(service.catalog()).toHaveLength(0)
    expect(runtimeOperations()).toHaveLength(0)
    expect(logs.some((line) =>
      line.includes('commands-report-rejected') && line.includes('too-many defaults'))).toBe(true)
  })

  it('#450 宿主侧先量后形：超限且含非法 chord 报 too-many defaults 而非 invalid defaults', () => {
    const { service, logs } = makeService()
    service.syncReport(ADDON, 1, [
      report(`${ADDON}.over-bad`, ADDON, {
        defaults: ['ctrl+f1', 'ctrl+f2', 'ctrl+f3', 'ctrl+f4', 'not-a-key'],
      }),
    ])
    expect(service.catalog()).toHaveLength(0)
    expect(logs.some((line) =>
      line.includes('commands-report-rejected') && line.includes('too-many defaults'))).toBe(true)
    expect(logs.some((line) => line.includes('invalid defaults'))).toBe(false)
  })

  it('#450 defaults 恰 4 条通过（边界值；原始条数计数，归一后重复不折抵）', () => {
    const { service, logs } = makeService()
    service.syncReport(ADDON, 1, [
      report(`${ADDON}.four`, ADDON, { defaults: ['ctrl+f1', 'ctrl+f2', 'ctrl+f3', 'ctrl+f4'] }),
      // 原始 4 条含归一后重复（f1/F1）：去重入目录、不拒绝
      report(`${ADDON}.alias`, ADDON, { defaults: ['ctrl+f1', 'Ctrl+F1', 'meta+k', 'ctrl+k'] }),
    ])
    expect(logs.some((line) => line.includes('commands-report-rejected'))).toBe(false)
    const defaultsOf = (commandId: string) =>
      service.catalog().find((item) => item.commandId === commandId)?.defaults
    expect(defaultsOf(`${ADDON}.four`)).toEqual(['ctrl+f1', 'ctrl+f2', 'ctrl+f3', 'ctrl+f4'])
    expect(defaultsOf(`${ADDON}.alias`)).toEqual(['ctrl+f1', 'meta+k', 'ctrl+k'])
  })
})
