// T08（#357）行为冲突管理——宿主侧注册目录服务契约测试。
// 事实源 src/host/addons/addonBehaviorCatalogService.ts。
//
// 契约口径（票面 + ADR-0012「行为协调与渲染选择」Q27 + T10 addonCommand
// Service 的对账先例）：
// - 目录条目来自编辑器 webview 的全量对账上报（addon.behaviors.report）：
//   非 enabled 运行态的迟到上报被忽略并留痕（停用/故障后的空表重放不
//   恢复目录——回收权威在宿主 reconcile）；enabled 的新表整组件替换。
// - 目录是会话内「最后已知注册面」：面板关闭不清目录（设置页仍可管理，
//   与 addons.state 的组件状态合成呈现）；停用/故障经 releaseAddon 回收。
// - catalog 输出按完整键稳定排序（多组件合表；与默认序同键序）。
// - 变化仅在目录内容实际变化后通知（等值重报不打扰）。
import { describe, expect, it } from 'vitest'
import { AddonBehaviorCatalogService } from '../../src/host/addons/addonBehaviorCatalogService'
import type { AddonBehaviorInfo } from '../../src/shared/addonBehaviors'

function info(addonId: string, id: string, name = `${id} 名`): AddonBehaviorInfo {
  return { addonId, id, name, history: 'atomic' }
}

function createHarness(runStates: Record<string, string | undefined> = {}) {
  const logs: string[] = []
  const changes: number[] = []
  const service = new AddonBehaviorCatalogService({
    runStateOf: (addonId) => runStates[addonId] as never,
    log: (stage, addonId, detail) => logs.push(`${stage}:${addonId}:${detail}`),
  })
  const off = service.onChanged(() => changes.push(changes.length))
  return { service, logs, changes, off }
}

describe('T08 行为注册目录服务', () => {
  it('enabled 组件的上报进入目录；多组件合表按完整键稳定排序', () => {
    const h = createHarness({ 'pub.b': 'enabled', 'pub.a': 'enabled' })
    h.service.syncReport('pub.b', 1, [info('pub.b', 'y')])
    h.service.syncReport('pub.a', 1, [info('pub.a', 'z'), info('pub.a', 'x')])
    expect(h.service.catalog().map((entry) => `${entry.addonId}#${entry.id}`))
      .toEqual(['pub.a#x', 'pub.a#z', 'pub.b#y'])
    expect(h.changes).toHaveLength(2)
  })

  it('同组件新表整组件替换（撤项与改名反映）；等值重报不再通知', () => {
    const h = createHarness({ 'pub.a': 'enabled' })
    h.service.syncReport('pub.a', 1, [info('pub.a', 'x'), info('pub.a', 'y')])
    h.service.syncReport('pub.a', 2, [info('pub.a', 'x', '新名')])
    expect(h.service.catalog()).toEqual([info('pub.a', 'x', '新名')])
    const changesBefore = h.changes.length
    h.service.syncReport('pub.a', 2, [info('pub.a', 'x', '新名')])
    expect(h.changes).toHaveLength(changesBefore)
  })

  it('空表上报（全撤信号）清空该组件目录项', () => {
    const h = createHarness({ 'pub.a': 'enabled' })
    h.service.syncReport('pub.a', 1, [info('pub.a', 'x')])
    h.service.syncReport('pub.a', 1, [])
    expect(h.service.catalog()).toEqual([])
  })

  it('非 enabled 运行态的上报被忽略并留痕（迟到空表不恢复目录）', () => {
    const h = createHarness({ 'pub.a': 'enabled' })
    h.service.syncReport('pub.a', 1, [info('pub.a', 'x')])
    ;(h as { runStates?: Record<string, string | undefined> }).runStates
    // 切换运行态后重放（模拟停用/故障后的迟到消息）
    const late = createHarness({ 'pub.a': 'faulted' })
    late.service.syncReport('pub.a', 1, [info('pub.a', 'x')])
    expect(late.service.catalog()).toEqual([])
    expect(late.logs.some((line) => line.includes('behaviors-report-ignored'))).toBe(true)
    // 未注册组件（runState undefined）同样忽略
    const unregistered = createHarness({})
    unregistered.service.syncReport('pub.gone', 1, [info('pub.gone', 'x')])
    expect(unregistered.service.catalog()).toEqual([])
  })

  it('releaseAddon 回收该组件目录项（停用/故障 reconcile 的执行面）', () => {
    const h = createHarness({ 'pub.a': 'enabled' })
    h.service.syncReport('pub.a', 1, [info('pub.a', 'x')])
    h.service.releaseAddon('pub.a')
    expect(h.service.catalog()).toEqual([])
    // 幂等：重复回收不通知
    const before = h.changes.length
    h.service.releaseAddon('pub.a')
    expect(h.changes).toHaveLength(before)
  })

  it('addonIds 列出目录内组件（reconcile 遍历面）；退订后不再通知', () => {
    const h = createHarness({ 'pub.a': 'enabled', 'pub.b': 'enabled' })
    h.service.syncReport('pub.a', 1, [info('pub.a', 'x')])
    h.service.syncReport('pub.b', 1, [info('pub.b', 'y')])
    expect([...h.service.addonIds()].sort()).toEqual(['pub.a', 'pub.b'])
    h.off()
    h.service.syncReport('pub.a', 1, [])
    expect(h.changes).toHaveLength(2)
  })
})

describe('#464 多语言行为名的目录等值比较（sameTable 深比较）', () => {
  const infoWithName = (name: unknown): AddonBehaviorInfo =>
    ({ addonId: 'pub.a', id: 'x', name, history: 'atomic' }) as AddonBehaviorInfo

  it('等值映射重报不打扰（键插入序无关、键数相同值相同即等值）', () => {
    const h = createHarness({ 'pub.a': 'enabled' })
    h.service.syncReport('pub.a', 1, [infoWithName({ en: 'Auto pairs', 'zh-cn': '括号补全' })])
    const before = h.changes.length
    // 相同映射、不同插入序：等值，不通知
    h.service.syncReport('pub.a', 2, [infoWithName({ 'zh-cn': '括号补全', en: 'Auto pairs' })])
    expect(h.changes).toHaveLength(before)
  })

  it('映射值变化或键集变化触发更新通知', () => {
    const h = createHarness({ 'pub.a': 'enabled' })
    h.service.syncReport('pub.a', 1, [infoWithName({ 'zh-cn': '旧名', en: 'Old' })])
    const before = h.changes.length
    // 值变化
    h.service.syncReport('pub.a', 2, [infoWithName({ 'zh-cn': '新名', en: 'Old' })])
    expect(h.changes).toHaveLength(before + 1)
    // 键集变化（少一键）
    h.service.syncReport('pub.a', 3, [infoWithName({ 'zh-cn': '新名' })])
    expect(h.changes).toHaveLength(before + 2)
    // 键规整后等值（ZH-CN 与 zh-cn 规整同键同值）：不打扰
    const steady = h.changes.length
    h.service.syncReport('pub.a', 4, [infoWithName({ 'ZH-CN': '新名' })])
    expect(h.changes).toHaveLength(steady)
  })

  it('string 与映射视为不等值（形态变化即目录变化）', () => {
    const h = createHarness({ 'pub.a': 'enabled' })
    h.service.syncReport('pub.a', 1, [infoWithName('单语言名')])
    const before = h.changes.length
    h.service.syncReport('pub.a', 2, [infoWithName({ 'zh-cn': '单语言名' })])
    expect(h.changes).toHaveLength(before + 1)
    // 目录如实反映最新形态
    expect(h.service.catalog()[0]!.name).toEqual({ 'zh-cn': '单语言名' })
  })

  it('快照防御拷贝 map 形态 name（mutate 上报原对象不影响目录——防外泄引用与 examples 同口径）', () => {
    const h = createHarness({ 'pub.a': 'enabled' })
    const reportName: Record<string, string> = { en: 'Auto pairs', 'zh-cn': '括号补全' }
    h.service.syncReport('pub.a', 1, [infoWithName(reportName)])
    // 调用方事后改写上报载荷的映射对象：目录不得跟随（同一引用外泄）
    reportName['zh-cn'] = '被篡改'
    delete reportName['en']
    expect(h.service.catalog()[0]!.name).toEqual({ en: 'Auto pairs', 'zh-cn': '括号补全' })
  })
})
