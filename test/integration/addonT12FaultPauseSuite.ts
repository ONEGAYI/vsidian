// #361 T12 输入回调故障暂停——独立桌面 CDP 真宿主伴随套件。
// 与 T07（addonT07BehaviorsSuite）同模式：打开 fixture 并等待外部 CDP
// 真实键盘驱动；被测对象是 addon-t12 夹具组件经公开 behaviors 面注册的
// 输入行为（inject-mark：^ → -T12-）的故障升级路径。断言面在浏览器脚本
// （test/browser/addonT12FaultPause.mjs）：文档文本（行为修饰真实写回
// 与故障后输入仍可用）、宿主 runtimeStatus（全组件暂停与恢复）、夹具
// stats（armAck 确认）与行为目录（贡献回收与恢复）。
import * as vscode from 'vscode'
import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'

const ADDON_ID = 'vsidian-test-fixture.addon-t12'

export async function run(): Promise<void> {
  const directory = process.env['WORKSPACE_DIR']!
  const uri = vscode.Uri.file(path.join(directory, 'keyboard.md'))
  await vscode.commands.executeCommand('vscode.openWith', uri, 'onegayi.vsidian.editor')
  const extension = vscode.extensions.getExtension('onegayi.vsidian')
  if (extension && !extension.isActive) await extension.activate()
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
  // 夹具组件运行态收敛 enabled（对齐 addonT07Cases ensureEnabled 口径；
  // 贡献放行后由外部脚本 reRegister 触发重装载注册）
  let enabled = false
  for (let attempt = 0; attempt < 5; attempt++) {
    const status = await vscode.commands.executeCommand<{ runState: string } | null>(
      'onegayi.vsidian._test.addonRuntimeStatus', { addonId: ADDON_ID })
    if (status?.runState === 'enabled') {
      enabled = true
      break
    }
    if (status?.runState === 'faulted') {
      await vscode.commands.executeCommand('onegayi.vsidian._test.addonRetry', { addonId: ADDON_ID })
      await vscode.commands.executeCommand(`${ADDON_ID}.releaseAndReRegister`)
    } else {
      await vscode.commands.executeCommand('onegayi.vsidian._test.addonSetEnabled', { addonId: ADDON_ID, enabled: true })
    }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  if (!enabled) throw new Error('addon-t12 组件未能进入 enabled')
  writeFileSync(path.join(directory, 'ready'), '')
  const done = path.join(directory, 'done')
  const request = path.join(directory, 'request.json')
  for (let i = 0; i < 2400 && !existsSync(done); i++) {
    if (existsSync(request)) {
      const message = JSON.parse(readFileSync(request, 'utf8')) as {
        id: number; action: string; arm?: string | null; on?: boolean; timeoutMs?: number
      }
      unlinkSync(request)
      let result: unknown
      switch (message.action) {
        case 'stats':
          result = await vscode.commands.executeCommand(`${ADDON_ID}.stats`)
          break
        case 'status':
          result = await vscode.commands.executeCommand('onegayi.vsidian._test.addonRuntimeStatus', { addonId: ADDON_ID })
          break
        case 'behaviorCatalog':
          result = await vscode.commands.executeCommand('onegayi.vsidian._test.addonBehaviorCatalog')
          break
        case 'setArm':
          result = await vscode.commands.executeCommand(`${ADDON_ID}.setArm`, message.arm ?? null)
          break
        case 'setContrib':
          result = await vscode.commands.executeCommand(`${ADDON_ID}.setContrib`, message.on === true)
          break
        case 'retry':
          result = await vscode.commands.executeCommand('onegayi.vsidian._test.addonRetry', { addonId: ADDON_ID })
          break
        case 'reRegister':
          result = await vscode.commands.executeCommand(`${ADDON_ID}.releaseAndReRegister`)
          break
        case 'text': {
          const doc = await vscode.workspace.openTextDocument(uri)
          result = doc.getText()
          break
        }
        default:
          result = { ok: false, reason: `unknown-action:${message.action}` }
      }
      writeFileSync(path.join(directory, `response-${message.id}.json`), JSON.stringify(result ?? null))
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
