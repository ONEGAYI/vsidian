// #461 附加组件存储空目录语义——真宿主「全新 profile 首启」生产路径用例。
//
// 场景：集成宿主每次 mkdtempSync 全新便携 profile（user-data/extensions
// 全新），<globalStorage>/addons 天然不存在（存储根惰性创建，首次写才
// 建）——正是 #461 现场，无需主动删目录。夹具 vsidian-test-fixture.
// addon-storage 在 enable 注册 storage.probe 通道处理器，模拟
// easy-typing fail-safe init：list !ok 即抛（通道回调异常 → 宿主归因
// faulted）；空清单则写种子文件再读回。
//
// 断言面：
// - _test.addonChannelRequest 回执 ok 且 result 携带种子路径结论
//  （entryCount=0 / seeded / readBack——组件 init 走种子路径）；
// - _test.addonRuntimeStatus：runState === 'enabled' 非 faulted、
//   faultReason 为空（修复前该链路 faulted：list 对未建目录 error 拒绝）。
import * as vscode from 'vscode'

const ADDON_ID = 'vsidian-test-fixture.addon-storage'

interface FixtureStats {
  activateCount: number
  setupCount: number
  enableCount: number
  probeCalls: number
  lastProbe: { listOk: boolean; entryCount: number; seeded: boolean; readBack: string } | null
  lastRegisterResult: { ok: boolean } | null
}

interface AddonRuntimeStatus {
  runState: 'idle' | 'enabled' | 'disabled' | 'faulted'
  faultReason?: string
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) {
    throw new Error(`断言失败：${message}`)
  }
}

async function poll<T>(label: string, fn: () => T | undefined | Promise<T | undefined>, timeoutMs = 30000): Promise<T> {
  const start = Date.now()
  for (;;) {
    const value = await fn()
    if (value !== undefined) {
      return value
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`等待超时：${label}`)
    }
    await new Promise((r) => setTimeout(r, 150))
  }
}

async function fixtureStats(): Promise<FixtureStats> {
  return (await vscode.commands.executeCommand(`${ADDON_ID}.stats`)) as FixtureStats
}

export const addonStorageCases: Array<[string, () => Promise<void>]> = [
  ['附加组件存储：全新 profile 首启——list 空目录返回空清单、fail-safe init 走种子路径不 faulted（#461）', async () => {
    // 前置：夹具经协调器唤醒注册并默认启用（enable 内注册 storage.probe 通道）
    await poll('存储夹具激活并启用', async () => {
      const stats = await fixtureStats()
      return stats.enableCount >= 1 && stats.lastRegisterResult?.ok === true ? stats : undefined
    })

    // 通道探测（#461 现场归因链：处理器抛错 → 通道回调异常 → faulted——
    // 修复前 list 对未建目录 error 拒绝，此处即触发）
    const probe = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonChannelRequest', {
      addonId: ADDON_ID, topic: 'storage.probe', payload: null,
    })) as { ok: boolean; result?: { listOk: boolean; entryCount: number; seeded: boolean; readBack: string } }
    assert(probe.ok === true, `存储探测应成功（修复前：list error → fail-safe 抛错 → 通道归因 faulted），实际 ${JSON.stringify(probe)}`)
    assert(probe.result?.listOk === true, '探测结论应为 list ok')
    assert(probe.result?.entryCount === 0, `全新 profile 首启应为空清单（未建目录 = 空存储），实际 ${probe.result?.entryCount} 条`)
    assert(probe.result?.seeded === true, '空存储应走种子路径（写 rule-state.json）')
    assert(probe.result?.readBack === '{"seed":true}', `种子文件应可读回，实际 ${JSON.stringify(probe.result?.readBack)}`)

    // 夹具侧观测对齐（探测确经通道处理器执行）
    const stats = await fixtureStats()
    assert(stats.probeCalls >= 1 && stats.lastProbe?.entryCount === 0, '夹具 stats 应记录探测（entryCount=0）')

    // 运行态权威：enabled 非 faulted、无故障原因
    const status = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonRuntimeStatus', { addonId: ADDON_ID })) as
      | AddonRuntimeStatus | null
    assert(status !== null, '运行状态应可查询')
    assert(status.runState === 'enabled', `组件应为 enabled 非 faulted，实际 ${JSON.stringify(status)}`)
    assert(!status.faultReason, `不应有故障原因，实际 ${JSON.stringify(status.faultReason)}`)
    console.log('[#461] 全新 profile 首启存储链路通过（list 空清单 → 种子路径 → 不 faulted）')
  }],
]
