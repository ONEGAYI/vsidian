// #602 主题目录宿主转发——真宿主伴随套件（外部 CDP 断言驱动）。
// 与 addonT07BehaviorsSuite 同模式：宿主内收敛前置并打开真实设置页，
// 等待外部 CDP 脚本（test/browser/addonThemeSettingsHost.mjs）完成
// 设置页 webview 内的主题候选断言。
// 被测链路：设置页 webview 装载即发 addons.themesGet（settingsMain）
// → 宿主 settingsPage 转发 → 附加组件接线应答 addons.themesState
// → webview 渲染主题候选。ebdbce84 型回归（宿主漏转发）时 webview
// 等不到目录，「外观 → 主题」只剩内置 default——候选 DOM 断言必然翻红。
// 本套件自身只断言宿主侧前置收敛（addon-theme 夹具安装启用、主题目录
// 已登记）；转发到 webview 的应答与候选呈现由外部 CDP 在 webview DOM
// （用户可见层）上断言，浏览器 stub 无法覆盖的正是这条转发链路。
import * as vscode from 'vscode'
import { existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const REF = 'vsidian-test-fixture.addon-theme/aqua'

export async function run(): Promise<void> {
  const directory = process.env['WORKSPACE_DIR']!
  // 测试模式的 run() 执行时主扩展未必已激活（无 activation 事件触发），
  // _test.* 命令在 activate 内注册——先显式激活（addonT07BehaviorsSuite
  // 同款口径）；addon-theme 夹具经 extensionDependencies 随之激活
  const extension = vscode.extensions.getExtension('onegayi.vsidian')
  if (!extension) throw new Error('未找到主扩展 onegayi.vsidian')
  if (!extension.isActive) await extension.activate()
  // 前置收敛：addon-theme 夹具随主扩展激活（extensionDependencies），
  // enable 无条件登记 aqua 主题——目录出现可用候选即「已安装并启用」。
  // 这一步只证明宿主接线有目录；转发链路由外部 CDP 断言（两者分离，
  // 失败时才能区分「夹具没装上」与「设置页转发断了」）。
  let registered = false
  for (let i = 0; i < 300; i++) {
    // Thenable 无 .catch——经 Promise.resolve 包装容错（命令未注册的窗口期）
    const state = await Promise.resolve(vscode.commands.executeCommand<{ themes?: Array<{ themeRef: string; available: boolean }> } | undefined>(
      'onegayi.vsidian._test.addonThemes',
    )).catch(() => undefined)
    if (state?.themes?.some((theme) => theme.themeRef === REF && theme.available)) {
      registered = true
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!registered) throw new Error('addon-theme 夹具主题目录未登记（宿主侧前置未收敛，转发链路无从验证）')
  // 打开真实设置页并经宿主正式入口路由到外观分页（openStyleReference
  // → openWithSection('appearance', 'overview')）。webview 装载即发
  // addons.themesGet——真宿主转发链路起点；「主题」页签由外部 CDP 点击
  // data-tab="presets" 切换（真实 click 事件路径）。
  await vscode.commands.executeCommand('onegayi.vsidian.openStyleReference')
  let ready = false
  for (let i = 0; i < 300; i++) {
    const info = await vscode.commands.executeCommand<{ open: boolean; ready: boolean } | undefined>(
      'onegayi.vsidian._test.settingsPageInfo',
    )
    if (info?.open && info.ready) {
      ready = true
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!ready) throw new Error('设置页 webview 未就绪')
  writeFileSync(path.join(directory, 'ready'), '')
  const done = path.join(directory, 'done')
  for (let i = 0; i < 1500 && !existsSync(done); i++) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  writeFileSync(done, '')
}
