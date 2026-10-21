// #620（V02）Remote SSH 探针 · extensionKind 数组语义实验扩展。
// 声明 ["ui", "workspace"]：实测 1.82.3 在 remote 窗口对数组 kind 的
// 激活端决策（双端激活 / 仅 ui 端 / 仅 workspace 端），不凭文档断言。
// 两端若都激活，同名命令 dualIdentity 各注册一份：workspace 侧调用时
// 命令解析器优先命中本端注册——返回值里的端特征即「哪端注册了」的证据，
// 与激活标志文件互为印证。探针代码，不定义产品行为。

import * as vscode from 'vscode'
import { CMDS, EXT_IDS, appendActivationLine, collectIdentity } from '../shared'

export function activate(context: vscode.ExtensionContext): void {
  const identity = collectIdentity(EXT_IDS.dual)
  const writtenTo = appendActivationLine({ ...identity, kind: 'dual-ext' })
  context.subscriptions.push(
    vscode.commands.registerCommand(CMDS.dualIdentity, () => ({ ...identity, activationLogWrittenTo: writtenTo })),
  )
}
