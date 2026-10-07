// #356 T07 输入行为——独立桌面 CDP 真宿主伴随套件。
// 与 T06（addonT06EditHostSuite）同模式：打开 fixture 并等待外部 CDP
// 真实键盘/IME 驱动；区别——被测对象是 addon-t07 夹具组件经公开 behaviors
// 面注册的输入行为链（真实键盘键入驱动链执行），断言面：
// - doc 文本（行为修饰真实写回）；
// - t07 收件箱（行为回调/观察事件）；
// - view.state.addonBehaviors 探针（注册清单/宿主状态/驱动计数/轨迹）；
// - 宿主行为状态钩子（setOrder/setDisabled/behaviorState——调序与
//   单项停用的管理面等价入口）。
import * as vscode from 'vscode'
import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'

const ADDON_ID = 'vsidian-test-fixture.addon-t07'

export async function run(): Promise<void> {
  const directory = process.env['WORKSPACE_DIR']!
  const uri = vscode.Uri.file(path.join(directory, 'keyboard.md'))
  await vscode.commands.executeCommand('vscode.openWith', uri, 'onegayi.vsidian.editor')
  const extension = vscode.extensions.getExtension('onegayi.vsidian')
  if (extension && !extension.isActive) await extension.activate()
  const doc = await vscode.workspace.openTextDocument(uri)
  let panelReady = false
  for (let i = 0; i < 100; i++) {
    const state = await vscode.commands.executeCommand<{ panels?: { ready: boolean }[] }>(
      'onegayi.vsidian._test.getSessionState', uri.toString(),
    )
    if (state?.panels?.some((panel) => panel.ready)) {
      panelReady = true
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!panelReady) throw new Error('Vsidian webview 未就绪')
  // 夹具组件运行态收敛 enabled（对齐 addonT07Cases ensureEnabled 口径）
  let enabled = false
  for (let attempt = 0; attempt < 5; attempt++) {
    const status = await vscode.commands.executeCommand<{ runState: string } | null>(
      'onegayi.vsidian._test.addonRuntimeStatus', { addonId: ADDON_ID })
    if (status?.runState === 'enabled') {
      enabled = true
      break
    }
    if (status?.runState === 'faulted') {
      await vscode.commands.executeCommand('onegayi.vsidian._test.addonReleaseGeneration', { addonId: ADDON_ID })
      await vscode.commands.executeCommand(`${ADDON_ID}.reset`)
    } else {
      await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: ADDON_ID, enabled: true })
    }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  if (!enabled) throw new Error('addon-t07 组件未能进入 enabled')
  // 页面行为注册就绪探测（view.state 探针；注册清单三行为在场）
  let registered = false
  for (let i = 0; i < 200; i++) {
    const stats = await vscode.commands.executeCommand<Record<string, unknown> | undefined>(
      'onegayi.vsidian._test.requestViewState', uri.toString(), 0)
    const behaviors = stats?.['addonBehaviors'] as { registrations?: unknown[] } | undefined
    if ((behaviors?.registrations?.length ?? 0) >= 3) {
      registered = true
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!registered) throw new Error('addon-t07 行为注册未就绪')
  writeFileSync(path.join(directory, 'ready'), '')
  const done = path.join(directory, 'done')
  const request = path.join(directory, 'request.json')
  for (let i = 0; i < 2400 && !existsSync(done); i++) {
    if (existsSync(request)) {
      const message = JSON.parse(readFileSync(request, 'utf8')) as {
        id: number; action: string; keys?: string[]; disabled?: boolean; order?: string[]; timeoutMs?: number
      }
      unlinkSync(request)
      let result: unknown
      switch (message.action) {
        // 夹具收件箱（行为回调/观察事件）
        case 'collect': result = await vscode.commands.executeCommand(`${ADDON_ID}.collect`, message.timeoutMs ?? 15000); break
        case 'reset': result = await vscode.commands.executeCommand(`${ADDON_ID}.reset`); break
        // 宿主行为状态管理面（调序/单项停用的等价入口与读取）
        case 'setOrder': result = await vscode.commands.executeCommand('onegayi.vsidian._test.addonBehaviorSetOrder', { order: message.order ?? [] }); break
        case 'setDisabled': result = await vscode.commands.executeCommand('onegayi.vsidian._test.addonBehaviorSetDisabled', { keys: message.keys ?? [], disabled: message.disabled ?? true }); break
        case 'behaviorState': result = await vscode.commands.executeCommand('onegayi.vsidian._test.addonBehaviorState'); break
        // 链观测探针（注册清单/宿主状态/计数/轨迹）
        case 'stats': result = ((await vscode.commands.executeCommand('onegayi.vsidian._test.requestViewState', uri.toString(), 0)) as Record<string, unknown> | undefined)?.['addonBehaviors']; break
        case 'text': result = doc.getText(); break
        default: result = { error: `unknown action ${message.action}` }
      }
      writeFileSync(path.join(directory, `response-${message.id}.json`), JSON.stringify(result))
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  writeFileSync(path.join(directory, 'done'), '')
}
