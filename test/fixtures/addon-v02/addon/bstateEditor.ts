// #476 测试组件编辑器页源码：消费公开 SDK 的 behaviorState 只读面——
// 集成用例的「组件感知行为禁用态」载体。
//
// 行为（disabled 集的键载体）：
// - demo-rule：恒不修饰（返回 null）——仅注册进目录，让宿主侧
//   behaviorsSetDisabled 有本组件完整键可禁用（addonId#demo-rule）。
//
// 上报协议（经 setup scope 通道 'bstate.event'——停用后仍服务）：
// - initial：装载即上报 enabledState() 初值（广播先于装载指令到达的
//   时序证据：工厂执行时应已持宿主权威值）；
// - change：onEnabledChange 每次分发上报新快照（含页面种类与代次）；
// - missing：SDK 未提供 behaviorState 面（负向可见性——面装配回退时
//   用例据此失败而非静默）。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../../../../src/shared/addonPage'
import type { AddonBehaviorEnabledState } from '../../../../src/shared/addonBehaviors'

const ADDON_ID = 'vsidian-test-fixture.addon-bstate'

defineAddonPage(ADDON_ID, (sdk: VsidianAddonPageSdk) => {
  const report = (topic: string, state: AddonBehaviorEnabledState | null) =>
    sdk.channel
      .request('bstate.event', {
        topic,
        page: 'editor',
        generation: sdk.addon.generation,
        state,
      })
      .catch(() => {
        // 释放等异常不上报
      })

  const facet = sdk.behaviorState
  if (!facet) {
    void report('missing', null)
    return
  }

  // 键载体行为（恒不修饰）：宿主禁用 addonId#demo-rule 后广播的 disabled
  // 集含本组件局部 id
  sdk.behaviors?.register({ id: 'demo-rule', name: 'bstate demo rule', onInput: () => null })

  const unsubscribe = facet.onEnabledChange((state) => {
    void report('change', state)
  })
  void report('initial', facet.enabledState())
  sdk.onDispose(unsubscribe)
})
