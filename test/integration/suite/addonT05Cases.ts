// #354 T05 组件管理侧栏数据面、故障手动重试与 realpath 逃逸守卫——
// 真宿主生产路径用例。
//
// 覆盖（票面验收的宿主侧证据）：
// - realpath 符号链接逃逸：夹具 vsidian-test-fixture.addon-escape 登记
//   「词法在内、真实路径在安装目录外」的页面入口（escape/ 为 runTest
//   运行期创建的 junction，指向临时目录）——登记成功（词法第一层放行）
//   但装载意图被宿主 realpath 守卫拒绝：面板桥事件留痕
//   directive.load-rejected-realpath、无 directive.load、编辑器面板装载器
//   无该组件（view.state.addonPage 探针）。
// - 故障手动重试（先释放旧代次再重新唤醒）：addon-t02 夹具 armEchoCrash
//   注入故障 → _test.addonRetry 释放旧代次并重新唤醒 → 1.82.3 实证失败
//   过的 activate() 假成功——状态如实呈现 awaiting-registration；组件侧
//   重新接入（releaseAndReRegister）后恢复 registered/enabled。
// - 侧栏数据面：官方清单为空占位（当前事实）下全部发现组件归第三方
//   （official=false）；状态列表仍呈现不兼容/激活失败组件（内置设置操作
//   不回退）。
import * as vscode from 'vscode'

const VIEW_TYPE = 'onegayi.vsidian.editor'
const ESCAPE_ID = 'vsidian-test-fixture.addon-escape'
const T02_ID = 'vsidian-test-fixture.addon-t02'
const wsDir = process.env['WORKSPACE_DIR'] ?? ''

function wsUri(name: string): vscode.Uri {
  return vscode.Uri.file(`${wsDir}/${name}`)
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

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) {
    throw new Error(`断言失败：${message}`)
  }
}

interface BridgeEvent {
  panel: 'editor' | 'settings'
  kind: string
  addonId: string
  generation?: number
}

interface AddonRuntimeStatus {
  enabled: boolean
  runState: 'idle' | 'enabled' | 'disabled' | 'faulted'
  faultReason?: string
  hasSettingsPage: boolean
}

async function bridgeEvents(): Promise<BridgeEvent[]> {
  return (await vscode.commands.executeCommand('onegayi.vsidian._test.addonPageEvents')) as BridgeEvent[]
}

async function runtimeStatus(addonId: string): Promise<AddonRuntimeStatus | null> {
  return (await vscode.commands.executeCommand('onegayi.vsidian._test.addonRuntimeStatus', { addonId })) as AddonRuntimeStatus | null
}

/** 打开一个 .md 编辑器面板（生产 CustomTextEditorProvider——装载器随面板在场） */
async function openEditorPanel(file: string): Promise<void> {
  await vscode.commands.executeCommand('vscode.openWith', wsUri(file), VIEW_TYPE)
  await poll('编辑器面板就绪', async () => {
    const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.getSessionState', wsUri(file).toString())) as
      | { found: boolean; panels: Array<{ ready: boolean }> } | undefined
    return state?.found && state.panels.some((panel) => panel.ready) ? true : undefined
  })
}

export const addonT05Cases: Array<[string, () => Promise<void>]> = [
  ['附加组件 T05：realpath 符号链接逃逸——登记放行、装载拒绝（#354）', async () => {
    // 夹具组件经协调器主动唤醒注册（escape 入口登记成功——词法第一层放行）
    const entry = await poll('逃逸夹具唤醒并注册', async () => {
      const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.getAddonsState')) as
        | { addons: Array<{ id: string; status: string; enabled?: boolean }> } | undefined
      const found = state?.addons.find((a) => a.id === ESCAPE_ID)
      return found && found.status === 'registered' ? found : undefined
    })
    assert(entry.enabled === true, '逃逸夹具默认启用（编辑器入口登记后进入期望装载）')

    // 清空桥事件后打开生产编辑器面板：装载器在场，宿主尝试推送装载意图
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonPageEvents', { clear: true })
    await openEditorPanel('lf.md')

    // realpath 守卫拒绝：桥事件留痕 load-rejected-realpath，且无该组件的
    // directive.load（逃逸页面代码不装载）
    const events = await poll('realpath 守卫拒绝留痕', async () => {
      const all = await bridgeEvents()
      return all.some((e) => e.addonId === ESCAPE_ID && e.kind === 'directive.load-rejected-realpath') ? all : undefined
    })
    assert(
      !events.some((e) => e.addonId === ESCAPE_ID && e.kind === 'directive.load'),
      '逃逸组件不得出现 directive.load（装载被拒）',
    )
    // 编辑器装载器无该组件（面板探针——逃逸页面代码未进 webview）
    const probe = (await vscode.commands.executeCommand('onegayi.vsidian._test.requestViewState', wsUri('lf.md').toString(), 0)) as
      | { addonPage?: { active: Array<{ addonId: string }> } } | undefined
    assert(
      !(probe?.addonPage?.active ?? []).some((a) => a.addonId === ESCAPE_ID),
      '装载器不得持有逃逸组件的活跃记录',
    )
    console.log('[#354] realpath 符号链接逃逸守卫通过（登记放行、装载拒绝、留痕可观察）')
  }],

  ['附加组件 T05：故障手动重试——释放旧代次、假成功如实呈现、重新接入恢复（#354）', async () => {
    // 前置：t02 夹具注册并启用
    await poll('t02 夹具激活并注册', async () => {
      const s = (await vscode.commands.executeCommand(`${T02_ID}.stats`)) as { setupCount: number } | undefined
      return s && s.setupCount >= 1 ? true : undefined
    })
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: T02_ID, enabled: true })

    // 注入故障：下一次 t02.echo 通道调用抛错 → 宿主归因为故障并全组件暂停
    await vscode.commands.executeCommand(`${T02_ID}.armEchoCrash`)
    await vscode.commands.executeCommand('onegayi.vsidian._test.addonChannelRequest', { addonId: T02_ID, topic: 't02.echo', payload: null })
    await poll('故障暂停可观察', async () => {
      const status = await runtimeStatus(T02_ID)
      return status?.runState === 'faulted' ? status : undefined
    })

    // 手动重试（设置页 UI 的宿主侧等价入口）：先释放旧代次再重新唤醒。
    // 1.82.3 实证失败过的 activate() 假成功——唤醒后如实呈现等待注册
    const retry = (await vscode.commands.executeCommand('onegayi.vsidian._test.addonRetry', { addonId: T02_ID })) as string
    assert(retry === 'ok', `重试应受理，实际 ${JSON.stringify(retry)}`)
    await poll('重试后等待组件注册（假成功如实呈现）', async () => {
      const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.getAddonsState')) as
        | { addons: Array<{ id: string; status: string }> } | undefined
      const entry = state?.addons.find((a) => a.id === T02_ID)
      return entry && entry.status === 'awaiting-registration' ? entry : undefined
    })

    // 组件侧重新接入（其 exports 仍持有 definition——手动重试的现实路径）
    await vscode.commands.executeCommand(`${T02_ID}.releaseAndReRegister`)
    await poll('重新接入恢复运行', async () => {
      const status = await runtimeStatus(T02_ID)
      return status && (status.runState === 'enabled' || status.runState === 'idle') ? status : undefined
    })
    console.log('[#354] 故障手动重试链通过（释放旧代次/如实呈现/重新接入恢复）')
  }],

  ['附加组件 T05：侧栏数据面——官方清单空占位下全部归第三方、状态列表不回退（#354）', async () => {
    const state = (await vscode.commands.executeCommand('onegayi.vsidian._test.getAddonsState')) as
      | { addons: Array<{ id: string; official: boolean; status: string; enabled?: boolean }> } | undefined
    assert(state !== undefined, 'getAddonsState 应可用')
    const addons = state!.addons
    assert(addons.length > 0, '应发现附加组件夹具')
    // 官方登记表为空占位（首个官方组件登记前的事实）——全部归第三方
    for (const entry of addons) {
      assert(entry.official === false, `官方清单空占位下 ${entry.id} 应归第三方（official=false）`)
    }
    // 不兼容与激活失败组件仍在状态列表（呈现不回退——不因侧栏分组消失）
    const ids = addons.map((a) => a.id)
    assert(ids.includes('vsidian-test-fixture.addon-incompatible'), '不兼容组件应在状态列表')
    assert(ids.includes('vsidian-test-fixture.addon-fail'), '激活失败组件应在状态列表')
    console.log('[#354] 侧栏数据面通过（第三方归属/未注册组件状态呈现不回退）')
  }],
]
