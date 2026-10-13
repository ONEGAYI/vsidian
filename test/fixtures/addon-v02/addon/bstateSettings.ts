// #476 测试组件设置页源码：消费公开 SDK 的 behaviorState 只读面（设置页
// 挂面载体——灰态消费场景 easy-typing#50 的平台侧验证形态）。
//
// 与编辑器页同构（bstateEditor.ts），差异：
// - mountRoot 渲染标题（设置页挂载证据）；
// - 不注册行为（设置页 behaviors 面不可用——键载体在编辑器页注册）。
//
// 关键场景：组件被用户停用后设置页**不卸载**——change 事件继续上报
// user-disabled（停用灰态事实），enabledState() 仍可查询。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../../../../src/shared/addonPage'
import type { AddonBehaviorEnabledState } from '../../../../src/shared/addonBehaviors'

const ADDON_ID = 'vsidian-test-fixture.addon-bstate'

defineAddonPage(ADDON_ID, (sdk: VsidianAddonPageSdk) => {
  const root = sdk.mountRoot()
  if (!root) {
    throw new Error('设置页 SDK 未提供挂载根')
  }
  root.className = 'bstate-settings-root'
  const title = document.createElement('h3')
  title.className = 'bstate-title'
  title.textContent = 'bstate test addon settings'
  root.append(title)

  const report = (topic: string, state: AddonBehaviorEnabledState | null) =>
    sdk.channel
      .request('bstate.event', {
        topic,
        page: 'settings',
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

  const unsubscribe = facet.onEnabledChange((state) => {
    // 灰态示意（组件自管 UI 的最小形态）：停用态标题半透明
    title.style.opacity = state.addonRunState === 'user-disabled' ? '0.4' : '1'
    void report('change', state)
  })
  void report('initial', facet.enabledState())
  sdk.onDispose(unsubscribe)
})
