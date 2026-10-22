// #620（V02）Remote SSH 探针 · 断连轮套件（独立 extensionTestsPath 入口，
// 装载在本机 ext host）。经 workspace 扩展的 disconnectFlight 命令让
// **remote 端**发起 hang 60s 的 renderPdf（远端在途等待本机回包）->
// 打 [probe-mark] in-flight -> 挂起等待。驱动器看到 marker 后杀
// vscode-server 进程，观察宿主断连行为与本机执行端的迟到完成。
// 探针代码，不定义产品行为。

import * as vscode from 'vscode'
import path from 'node:path'
import { CMDS } from './shared'

export async function run(): Promise<void> {
  const fixtureLocalDir = path.join(__dirname, 'fixture')
  const remoteFixtureUri = `vscode-remote://ssh-remote+localhost/${fixtureLocalDir}`
  const launched = await vscode.commands.executeCommand(CMDS.workspaceDisconnectFlight, { rootUri: remoteFixtureUri }) as { launched: boolean }
  if (!launched?.launched) throw new Error('disconnectFlight 未确认发起')
  console.log('[probe-mark] in-flight')
  // 挂起等待驱动器杀 server；超时兜底说明未被断连
  await new Promise((resolve) => setTimeout(resolve, 10 * 60_000))
  console.log('[probe-mark] never-disconnected（10 分钟未被断连，驱动器流程异常）')
  throw new Error('断连轮未被断连')
}
