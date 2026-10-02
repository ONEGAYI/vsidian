// 独立桌面 CDP 探针的最小真宿主伴随套件：打开 fixture 并等待外部键盘驱动。
import * as vscode from 'vscode'
import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'

export async function run(): Promise<void> {
  const directory = process.env['WORKSPACE_DIR']!
  const uri = vscode.Uri.file(path.join(directory, 'keyboard.md'))
  await vscode.commands.executeCommand('vscode.openWith', uri, 'onegayi.vsidian.editor')
  const extension = vscode.extensions.getExtension('onegayi.vsidian')
  if (extension && !extension.isActive) await extension.activate()
  const doc = await vscode.workspace.openTextDocument(uri)
  const events: { version: number; reason?: number; text: string }[] = []
  const eventSubscription = vscode.workspace.onDidChangeTextDocument(event => {
    if (event.document.uri.toString() === uri.toString() && event.contentChanges.length) events.push({ version: event.document.version, ...(event.reason ? { reason: event.reason } : {}), text: event.document.getText() })
  })
  // openWith 返回早于 webview 内 CM6 挂载；CDP 探针以面板 ready 为起点，
  // 避免单次目标枚举撞上尚未创建 .cm-content 的启动窗口。
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
  writeFileSync(path.join(directory, 'ready'), '')
  const done = path.join(directory, 'done')
  const request = path.join(directory, 'request.json')
  for (let i = 0; i < 1800 && !existsSync(done); i++) {
    if (existsSync(request)) {
      const message = JSON.parse(readFileSync(request, 'utf8')) as {
        id: number; action: string; operationId?: string; bindings?: string[]; text?: string; values?: Record<string, boolean>; panelIndex?: number
      }
      unlinkSync(request)
      let result: unknown
      if (message.action === 'set') result = await vscode.commands.executeCommand(
        'onegayi.vsidian._test.setKeybindings', message.operationId, message.bindings, false)
      if (message.action === 'resetAll') result = await vscode.commands.executeCommand(
        'onegayi.vsidian._test.resetKeybindings')
      if (message.action === 'text') result = doc.getText()
      if (message.action === 'settings') result = await vscode.commands.executeCommand('onegayi.vsidian._test.getSettings')
      if (message.action === 'preferences') result = await vscode.commands.executeCommand('onegayi.vsidian._test.setSettings', message.values)
      if (message.action === 'events') result = events
      if (message.action === 'undo') { await vscode.commands.executeCommand('undo'); result = doc.getText() }
      if (message.action === 'redo') { await vscode.commands.executeCommand('redo'); result = doc.getText() }
      if (message.action === 'source') { await vscode.commands.executeCommand('onegayi.vsidian.mode.toSource', uri); result = true }
      if (message.action === 'live') { await vscode.commands.executeCommand('onegayi.vsidian.mode.toLive', uri); result = true }
      if (message.action === 'sourceType') { await vscode.commands.executeCommand('type', { text: message.text ?? '' }); result = doc.getText() }
      if (message.action === 'sourceEnd') { await vscode.commands.executeCommand('cursorBottom'); await vscode.commands.executeCommand('cursorEnd'); result = true }
      if (message.action === 'split') { await vscode.commands.executeCommand('workbench.action.splitEditorRight'); result = true }
      if (message.action === 'panels') result = await vscode.commands.executeCommand('onegayi.vsidian._test.getSessionState', uri.toString())
      if (message.action === 'paint') result = await vscode.commands.executeCommand('onegayi.vsidian._test.requestViewState', uri.toString(), message.panelIndex ?? 0)
      if (message.action === 'notify') { void vscode.window.showInformationMessage('Host notification remains independent'); result = true }
      if (message.action === 'menu') result = await vscode.commands.executeCommand('onegayi.vsidian._test.postToPanel', uri.toString(), { kind: 'contextMenu.test.contextMenu', pos: 0 })
      if (message.action === 'mode') result = await vscode.commands.executeCommand(
        'onegayi.vsidian._test.postToPanel', uri.toString(),
        { kind: 'view.mode.set', mode: message.text })
      if (message.action === 'replaceText') {
        const edit = new vscode.WorkspaceEdit()
        edit.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), message.text ?? '')
        result = await vscode.workspace.applyEdit(edit)
      }
      writeFileSync(path.join(directory, `response-${message.id}.json`), JSON.stringify(result))
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!existsSync(done)) throw new Error('CDP 探针超时')
  writeFileSync(path.join(directory, 'result'), doc.getText())
  writeFileSync(path.join(directory, 'events.json'), JSON.stringify(events, null, 2))
  eventSubscription.dispose()
}
