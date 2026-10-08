// #355 T06 键盘/IME 独立桌面 CDP 的真宿主伴随套件。
// 与 V01（addonHistoryHostSuite）同模式：打开 fixture 并等待外部 CDP
// 键盘/IME 驱动；区别——修饰提交不走探针虚拟面板，而是经 addon-t06
// 夹具组件的公开 SDK views.applyEdits（长轮询驱动），历史断言经生产
// 协调器观测 _test.addonHistory.t06State（真实 edit.request/ack 管线）。
import * as vscode from 'vscode'
import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'

const ADDON_ID = 'vsidian-test-fixture.addon-t06'

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
  // 夹具组件运行态收敛 enabled（对齐 addonT06Cases ensureEnabled 口径；
  // faulted 先释放代次再重试，其余态直接置 enabled）
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
  if (!enabled) throw new Error('addon-t06 组件未能进入 enabled')
  // 页面产物就绪探测：queue 一条 list 指令并等待结局（装载滞后的指令在
  // 页面装载后被执行——broadcast 语义保证，对齐 probePageReady 口径）
  const probeSeq = await vscode.commands.executeCommand<number>(`${ADDON_ID}.queue`, 'list')
  for (let i = 0; i < 200; i++) {
    const results = await vscode.commands.executeCommand<Array<{ seq: number }>>(`${ADDON_ID}.collect`, 1000)
    if (results.some((r) => r.seq === probeSeq)) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  writeFileSync(path.join(directory, 'ready'), '')
  const done = path.join(directory, 'done')
  const request = path.join(directory, 'request.json')
  for (let i = 0; i < 1800 && !existsSync(done); i++) {
    if (existsSync(request)) {
      const message = JSON.parse(readFileSync(request, 'utf8')) as {
        id: number; action: string; op?: string; args?: Record<string, unknown>; timeoutMs?: number
      }
      unlinkSync(request)
      let result: unknown
      switch (message.action) {
        // SDK 消费链路：指令塞入组件（长轮询取出执行）
        case 'queue': result = await vscode.commands.executeCommand(`${ADDON_ID}.queue`, message.op, message.args); break
        // SDK 消费链路：组件执行结局收件箱（对位 seq）
        case 'collect': result = await vscode.commands.executeCommand(`${ADDON_ID}.collect`, message.timeoutMs ?? 15000); break
        // 生产协调器状态观测（条目流/应用指针/lost）
        case 't06State': result = await vscode.commands.executeCommand('onegayi.vsidian._test.addonHistory.t06State', uri.toString()); break
        case 'text': result = doc.getText(); break
        case 'version': result = doc.version; break
        case 'events': result = events; break
        case 'paint': result = await vscode.commands.executeCommand('onegayi.vsidian._test.requestViewState', uri.toString(), 0); break
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
