// #476 附加组件行为禁用态只读可见面——shared 纯函数与 webview runtime
// 的单元契约（快照口径 D3：addonRunState 两态 + 本组件行为局部 id 集；
// 通知时机 D5：广播到达即时、本组件快照变化才分发）。
//
// 宿主侧落库与面板推送的端到端链路属集成套件（addonBehaviorStateCases）；
// 本文件钉住：广播载荷守卫、完整键 → 本组件局部 id 的过滤单一事实源、
// runtime 的缓存/分发/退订语义与「等值广播不打扰」。
import { describe, expect, it } from 'vitest'
import {
  behaviorDisabledLocalIds,
  isAddonBehaviorEnabledStateBroadcast,
  type AddonBehaviorEnabledStateBroadcast,
} from '../../src/shared/addonBehaviors'
import { AddonBehaviorEnabledStateRuntime } from '../../src/webview/addonBehaviorEnabledState'

const ADDON_A = 'pub.a'
const ADDON_B = 'pub.b'

describe('#476 行为禁用态广播载荷守卫（shared）', () => {
  it('合法形态通过：disabled 完整键集 + 组件运行态表（两态）', () => {
    const broadcast: AddonBehaviorEnabledStateBroadcast = {
      disabled: [`${ADDON_A}#rule-x`],
      addons: [
        { addonId: ADDON_A, addonRunState: 'enabled' },
        { addonId: ADDON_B, addonRunState: 'user-disabled' },
      ],
    }
    expect(isAddonBehaviorEnabledStateBroadcast(broadcast)).toBe(true)
  })

  it('空集与空表是合法形态（无任何用户覆盖时的全默认态）', () => {
    expect(isAddonBehaviorEnabledStateBroadcast({ disabled: [], addons: [] })).toBe(true)
  })

  it('非法形态拒绝：非对象、disabled 非字符串数组、runState 超出两态', () => {
    expect(isAddonBehaviorEnabledStateBroadcast(null)).toBe(false)
    expect(isAddonBehaviorEnabledStateBroadcast('state')).toBe(false)
    expect(isAddonBehaviorEnabledStateBroadcast({ disabled: [1], addons: [] })).toBe(false)
    expect(isAddonBehaviorEnabledStateBroadcast({ disabled: [], addons: 'all' })).toBe(false)
    expect(isAddonBehaviorEnabledStateBroadcast({
      disabled: [],
      addons: [{ addonId: ADDON_A, addonRunState: 'faulted' }],
    })).toBe(false)
    // faulted/idle 不进快照（规格 D3：故障时设置页不装载，语义不可达）
    expect(isAddonBehaviorEnabledStateBroadcast({
      disabled: [],
      addons: [{ addonId: ADDON_A, addonRunState: 'idle' }],
    })).toBe(false)
    expect(isAddonBehaviorEnabledStateBroadcast({
      disabled: [],
      addons: [{ addonId: ADDON_A }],
    })).toBe(false)
  })
})

describe('#476 完整键 → 本组件局部 id 过滤（behaviorDisabledLocalIds）', () => {
  it('剥离本组件前缀、排除他组件键（完整键 = addonId#局部 id，addonId 无 #）', () => {
    expect(behaviorDisabledLocalIds(
      [`${ADDON_A}#rule-x`, `${ADDON_B}#rule-x`, `${ADDON_A}#rule-y`],
      ADDON_A,
    )).toEqual(['rule-x', 'rule-y'])
  })

  it('无匹配返回空数组；顺序保持存储序（不去重不排序——快照报事实）', () => {
    expect(behaviorDisabledLocalIds([`${ADDON_B}#rule-x`], ADDON_A)).toEqual([])
    expect(behaviorDisabledLocalIds([`${ADDON_A}#b`, `${ADDON_A}#a`, `${ADDON_A}#b`], ADDON_A))
      .toEqual(['b', 'a', 'b'])
  })
})

describe('#476 webview 行为禁用态 runtime（快照缓存与订阅分发）', () => {
  it('广播未到达时默认快照：addonRunState enabled、disabled 空集', () => {
    const runtime = new AddonBehaviorEnabledStateRuntime()
    expect(runtime.enabledStateOf(ADDON_A)).toEqual({ addonRunState: 'enabled', disabled: [] })
  })

  it('广播到达后按组件过滤：本组件局部 id 集与运行态（他组件键不泄漏）', () => {
    const runtime = new AddonBehaviorEnabledStateRuntime()
    runtime.applyBroadcast({
      disabled: [`${ADDON_A}#rule-x`, `${ADDON_B}#rule-y`],
      addons: [
        { addonId: ADDON_A, addonRunState: 'enabled' },
        { addonId: ADDON_B, addonRunState: 'user-disabled' },
      ],
    })
    expect(runtime.enabledStateOf(ADDON_A)).toEqual({ addonRunState: 'enabled', disabled: ['rule-x'] })
    expect(runtime.enabledStateOf(ADDON_B)).toEqual({ addonRunState: 'user-disabled', disabled: ['rule-y'] })
  })

  it('组件停用（广播不再列入）后快照回落 enabled——停用态只由显式条目表达', () => {
    const runtime = new AddonBehaviorEnabledStateRuntime()
    runtime.applyBroadcast({
      disabled: [],
      addons: [{ addonId: ADDON_A, addonRunState: 'user-disabled' }],
    })
    runtime.applyBroadcast({ disabled: [], addons: [] })
    expect(runtime.enabledStateOf(ADDON_A)).toEqual({ addonRunState: 'enabled', disabled: [] })
  })

  it('本组件快照变化即时分发（落库后通知 D5）；他组件变化不打扰本组件订阅者', () => {
    const runtime = new AddonBehaviorEnabledStateRuntime()
    const seenA: string[] = []
    const seenB: string[] = []
    runtime.onEnabledChangeOf(ADDON_A, (state) => seenA.push(state.addonRunState))
    runtime.onEnabledChangeOf(ADDON_B, (state) => seenB.push(state.addonRunState))

    runtime.applyBroadcast({
      disabled: [`${ADDON_A}#rule-x`],
      addons: [{ addonId: ADDON_A, addonRunState: 'enabled' }],
    })
    expect(seenA).toEqual(['enabled']) // disabled 集新增 → 本组件快照变化
    expect(seenB).toEqual([])

    runtime.applyBroadcast({
      disabled: [`${ADDON_A}#rule-x`, `${ADDON_B}#rule-y`],
      addons: [
        { addonId: ADDON_A, addonRunState: 'enabled' },
        { addonId: ADDON_B, addonRunState: 'enabled' },
      ],
    })
    expect(seenA).toEqual(['enabled']) // A 快照未变，不重复分发
    expect(seenB).toEqual(['enabled']) // B 的 disabled 集变化
  })

  it('订阅时即持有当前态语义：注册后下一次广播（含等值修复）才触发；退订后不再分发', () => {
    const runtime = new AddonBehaviorEnabledStateRuntime()
    const events: string[] = []
    const unsubscribe = runtime.onEnabledChangeOf(ADDON_A, (state) => events.push(state.addonRunState))

    // 与当前默认态等值的广播：不分发（等值不打扰）
    runtime.applyBroadcast({ disabled: [], addons: [{ addonId: ADDON_A, addonRunState: 'enabled' }] })
    expect(events).toEqual([])

    runtime.applyBroadcast({ disabled: [], addons: [{ addonId: ADDON_A, addonRunState: 'user-disabled' }] })
    expect(events).toEqual(['user-disabled'])

    unsubscribe()
    runtime.applyBroadcast({ disabled: [], addons: [{ addonId: ADDON_A, addonRunState: 'enabled' }] })
    expect(events).toEqual(['user-disabled'])
  })

  it('回调异常不阻断其余订阅者（观察面异常不升级——与 behaviors.onChanged 同口径）', () => {
    const runtime = new AddonBehaviorEnabledStateRuntime()
    const ok: string[] = []
    runtime.onEnabledChangeOf(ADDON_A, () => { throw new Error('observer boom') })
    runtime.onEnabledChangeOf(ADDON_A, (state) => ok.push(state.addonRunState))
    expect(() => runtime.applyBroadcast({
      disabled: [],
      addons: [{ addonId: ADDON_A, addonRunState: 'user-disabled' }],
    })).not.toThrow()
    expect(ok).toEqual(['user-disabled'])
  })

  it('整组件订阅回收（releaseAddon）：该组件订阅不再分发，他组件不受影响；查询不受影响', () => {
    const runtime = new AddonBehaviorEnabledStateRuntime()
    const seenA: string[] = []
    const seenB: string[] = []
    runtime.onEnabledChangeOf(ADDON_A, (state) => seenA.push(state.addonRunState))
    runtime.onEnabledChangeOf(ADDON_B, (state) => seenB.push(state.addonRunState))
    runtime.releaseAddon(ADDON_A)
    runtime.applyBroadcast({
      disabled: [],
      addons: [
        { addonId: ADDON_A, addonRunState: 'user-disabled' },
        { addonId: ADDON_B, addonRunState: 'user-disabled' },
      ],
    })
    expect(seenA).toEqual([]) // 已回收：不分发
    expect(seenB).toEqual(['user-disabled']) // 他组件订阅不受影响
    // 查询路径不受回收影响：仍可读取快照（只读面）
    expect(runtime.enabledStateOf(ADDON_A)).toEqual({ addonRunState: 'user-disabled', disabled: [] })
    // 回收后可重新订阅（换代重装载场景）
    runtime.onEnabledChangeOf(ADDON_A, (state) => seenA.push(state.addonRunState))
    runtime.applyBroadcast({ disabled: [], addons: [{ addonId: ADDON_A, addonRunState: 'enabled' }] })
    expect(seenA).toEqual(['enabled'])
  })
})
