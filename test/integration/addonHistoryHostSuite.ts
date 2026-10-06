// V01（#348）附加组件历史分组——独立桌面 CDP 探针的真宿主伴随套件。
// 打开 fixture 并等待外部 CDP 键盘/IME 驱动；文件 request/response 通道
// 转发 _test.addonHistory.* 探针命令（richPasteHostSuite 同模式）。
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
    if (event.document.uri.toString() === uri.toString() && event.contentChanges.length) {
      events.push({ version: event.document.version, ...(event.reason ? { reason: event.reason } : {}), text: event.document.getText() })
    }
  })
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
        id: number; action: string; opId?: string; atomic?: boolean; text?: string; changes?: Array<{ offset: number; length: number; text: string }>; op?: 'undo' | 'redo'
      }
      unlinkSync(request)
      let result: unknown
      switch (message.action) {
        case 'attach': result = await vscode.commands.executeCommand('onegayi.vsidian._test.addonHistory.attach', uri.toString()); break
        case 'state': result = await vscode.commands.executeCommand('onegayi.vsidian._test.addonHistory.state', uri.toString()); break
        case 'submit': result = await vscode.commands.executeCommand('onegayi.vsidian._test.addonHistory.submit', uri.toString(), { opId: message.opId, atomic: message.atomic, changes: message.changes }); break
        case 'history': result = await vscode.commands.executeCommand('onegayi.vsidian._test.addonHistory.history', uri.toString(), message.op); break
        case 'nativeHistory': result = await vscode.commands.executeCommand('onegayi.vsidian._test.addonHistory.nativeHistory', uri.toString(), message.op); break
        case 'text': result = doc.getText(); break
        case 'version': result = doc.version; break
        case 'events': result = events; break
        case 'paint': result = await vscode.commands.executeCommand('onegayi.vsidian._test.requestViewState', uri.toString(), 0); break
        case 'activeTextEditor': result = vscode.window.activeTextEditor?.document.uri.toString() ?? null; break
        default: result = { error: `unknown action ${message.action}` }
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
