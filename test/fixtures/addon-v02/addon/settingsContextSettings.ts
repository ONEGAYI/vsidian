// #553 测试组件设置页上下文消费夹具（模拟组件作者用 sdk.settingsContext
// 在自身设置页对齐作用域与搜索定位）。挂载行为：
// - mountRoot 渲染两行只读回显：作用域行（scope=…;hasWorkspace=…）与
//   定位行（locate=def:键 / locate=none）——初始值经 scopeState()/
//   locateTarget() 拉取，后续变化经 onScopeChange/onLocateTarget 订阅
//   更新（自绘控件的显示值与平台作用域一致性的消费样例）；
// - 定位目标到达时给定位行加 data-located 标记（页内定位消费的可观测
//   信号——浏览器断言锚点）。
import { defineAddonPage } from 'vsidian-addon-sdk'
import type { VsidianAddonPageSdk } from '../../../../src/shared/addonPage'
import type {
  AddonSettingsLocateTarget,
  AddonSettingsScopeSnapshot,
} from '../../../../src/shared/addonSettingsContextApi'

const ADDON_ID = 'vsidian-test-fixture.settings-context'

defineAddonPage(ADDON_ID, (sdk: VsidianAddonPageSdk) => {
  const root = sdk.mountRoot()
  if (!root) {
    throw new Error('设置页 SDK 未提供挂载根')
  }
  root.className = 'scx-settings-root'
  const context = sdk.settingsContext
  if (!context) {
    throw new Error('设置页 SDK 未提供 settingsContext 面')
  }

  const scopeLine = document.createElement('p')
  scopeLine.className = 'scx-scope'
  const locateLine = document.createElement('p')
  locateLine.className = 'scx-locate'
  const render = (scope: AddonSettingsScopeSnapshot, target: AddonSettingsLocateTarget | null): void => {
    scopeLine.textContent = `scope=${scope.scope};hasWorkspace=${scope.hasWorkspace}`
    locateLine.textContent = target === null ? 'locate=none' : `locate=${target.kind}:${target.key}`
    if (target !== null) {
      locateLine.setAttribute('data-located', `${target.kind}:${target.key}`)
    } else {
      locateLine.removeAttribute('data-located')
    }
  }

  render(context.scopeState(), context.locateTarget())
  context.onScopeChange((scope) => render(scope, context.locateTarget()))
  context.onLocateTarget((target) => render(context.scopeState(), target))
  root.append(scopeLine, locateLine)
})
