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
  for (let i = 0; i < 300 && !existsSync(done); i++) {
    if (existsSync(request)) {
      const message = JSON.parse(readFileSync(request, 'utf8')) as {
        id: number; action: string; operationId?: string; bindings?: string[]; text?: string
      }
      unlinkSync(request)
      let result: unknown
      if (message.action === 'set') result = await vscode.commands.executeCommand(
        'onegayi.vsidian._test.setKeybindings', message.operationId, message.bindings, false)
      if (message.action === 'resetAll') result = await vscode.commands.executeCommand(
        'onegayi.vsidian._test.resetKeybindings')
      if (message.action === 'text') result = doc.getText()
      if (message.action === 'mode') result = await vscode.commands.executeCommand(
        'onegayi.vsidian._test.postToPanel', uri.toString(),
        { kind: 'view.mode.set', mode: message.text })
      if (message.action === 'replaceText') {
        const edit = new vscode.WorkspaceEdit()
        edit.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length)), message.text ?? '')
        result = await vscode.workspace.applyEdit(edit)
      }
      // #638 真宿主输入框链路：经命令入口执行 gotoLine（原生输入框由 CDP 侧
      // 驱动键入并确认）。命令内部等待输入框关闭，故此处不 await——先回执已
      // 启动，完成/异常写入 gotoline-result.json 供探针轮询。
      if (message.action === 'gotoLineCommand') {
        void vscode.commands.executeCommand('onegayi.vsidian.gotoLine').then(
          (value) => writeFileSync(path.join(directory, 'gotoline-result.json'),
            JSON.stringify({ done: true, value })),
          (error: unknown) => writeFileSync(path.join(directory, 'gotoline-result.json'),
            JSON.stringify({ done: true, error: String(error) })),
        )
        result = { started: true }
      }
      // #638 光标位置观测经 CDP 在 webview 内直读（见 keybindingsHost.mjs），
      // 本套件不另设读取动作
      writeFileSync(path.join(directory, `response-${message.id}.json`), JSON.stringify(result))
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!existsSync(done)) throw new Error('CDP 探针超时')
  writeFileSync(path.join(directory, 'result'), doc.getText())
}
