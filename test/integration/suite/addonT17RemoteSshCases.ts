// #366 T17 附加组件 Remote SSH 同宿主安装、资源与排障——远端会话用例。
//
// 会话语义（与 T16 安装态的本质差异）：被测扩展经远端清单镜像装载进
// **远端扩展宿主**（runRemoteSshAddons.mjs 把本地 CLI 真实安装的权威
// extensions.json 条目镜像到 ~/.vscode-server/extensions——激活/exports/
// 命令注册都在远端真实发生）；宿主以 --remote ssh-remote+<host> 启动
// （Remote-SSH 0.106.x 装隔离 profile；远端=本机回环 sshd，链路真实走
// SSH）。
//
// 架构事实（实测，断言面据此设计）：1.82.3 的 extension tests runner 挂
// 在**本地** ext host——runner 的 vscode.extensions.all 看不到远端扩展；
// 断言经两条通道：
// - 命令路由（本地 runner 调远端 ext host 注册的命令——VSCode 原生通道）；
// - 样例 stats 的宿主观测自报（样例代码在远端执行，读远端清单——
//   remoteName/主扩展可见性/extensionUri scheme）。
//
// 通道边界（如实断言而非绕过）：远端 ext host 不继承本地 env——
// VSIDIAN_TEST_HOOKS 传不进 SSH 会话，_test.* 钩子缺席，SSH 会话天然是
// **发行态语义**（断言面走公开面 + 样例自身公开命令 + 文档文本 +
// tabGroups，T16 阶段 C 先例同源）。因此：输入行为的真实键入
// （table.test.domType 注入）、绘制层探针（requestViewState paint）、经
// _test 的设置写入与 T12 故障链查询，在远端会话不可达——发行态无对应
// 公开命令，保持未验并记录于票面；本地 hooks 会话的同面由 T16 矩阵覆盖。
//
// 阶段矩阵（阶段变量经工作区标记文件 .vsidian-t17-ssh.json 传递——
// env 通道在远端同样不可用）：
// - R1 全装载：远端语义 + 同宿主接入 + 三类公开接入与页面装载 + 卸载
//   释放与手动重接；
// - R2 宿主不可见负向：远端镜像少 input-behavior（本地安装仍在）——
//   「不可见」不冒充「未安装/装错侧」（R1 对照：同一安装下可见且工作）。
import * as vscode from 'vscode'
import { readFileSync } from 'node:fs'
import nodePath from 'node:path'

const VIEW_TYPE = 'onegayi.vsidian.editor'
const INPUT_ID = 'vsidian-example.input-behavior'
const RENDERER_ID = 'vsidian-example.renderer'
const UI_ID = 'vsidian-example.ui-command'

/** 样例 stats 的宿主观测自报块（样例代码在远端执行时读远端清单——
 * 三样例 extension.ts 的 hostObservation 同一形状） */
interface HostObservation {
  remoteName: string | null
  mainExtensionVisible: boolean
  selfExtensionUriScheme: string | null
}

/** SSH 远端会话守卫：remoteName 为 ssh-remote（window 级信号，本地与
 * 远端 ext host 一致——探针实证）。非 SSH 会话（CI dev 分片、T16 安装
 * 态、本地）自跳过 */
function sshSession(): boolean {
  return vscode.env.remoteName === 'ssh-remote'
}

/** 阶段守卫：标记文件 phase（缺席=非 T17 启动器会话，跳过） */
function phaseMatch(...allowed: string[]): boolean {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!root) {
    return false
  }
  try {
    const marker = JSON.parse(readFileSync(nodePath.join(root, '.vsidian-t17-ssh.json'), 'utf8')) as { phase?: unknown }
    return typeof marker.phase === 'string' && allowed.includes(marker.phase)
  } catch {
    return false
  }
}

function skipNotice(caseName: string): void {
  console.log(`[T17] 用例「${caseName}」于${sshSession() ? '非目标阶段' : '非 SSH 会话'}跳过（sshGuard）`)
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) {
    throw new Error(`断言失败：${message}`)
  }
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

function wsUri(name: string): vscode.Uri {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  assert(root !== undefined, 'SSH 会话应有工作区根（vscode-remote 形态）')
  return vscode.Uri.file(`${root}/${name}`)
}

async function docText(name: string): Promise<string> {
  const doc = await vscode.workspace.openTextDocument(wsUri(name))
  return doc.getText()
}

/** 发行态面板打开证据：公开 tabGroups 面 Custom 标签页出现（T16-C 同源） */
async function openEditorPanelPublic(file: string): Promise<void> {
  await vscode.commands.executeCommand('vscode.openWith', wsUri(file), VIEW_TYPE)
  await poll('编辑器标签页出现（公开面）', async () => {
    const tabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs)
    return tabs.some((t) => t.input instanceof vscode.TabInputCustom) ? true : undefined
  })
}

/** 样例 stats 公开命令（远端注册经命令路由到达本地 runner——样例自身的
 * 测试观测面，发行态在场；宿主观测自报块同乘） */
async function exampleStats(addonId: string): Promise<(Record<string, unknown> & { host?: HostObservation }) | undefined> {
  try {
    return (await vscode.commands.executeCommand(`${addonId}.stats`)) as Record<string, unknown> & { host?: HostObservation }
  } catch {
    return undefined
  }
}

/** 等待样例发行态激活注册（setupCount ≥ 1 且注册成功——注册链要求主扩展
 * 在同一远端宿主 activate 并暴露 exports，是同宿主接入的端到端证据） */
async function waitForRegistered(addonId: string): Promise<Record<string, unknown> & { host?: HostObservation }> {
  return poll(`样例 ${addonId} 发行态激活注册`, async () => {
    const stats = await exampleStats(addonId)
    const registerResult = stats?.['lastRegisterResult'] as { ok?: boolean } | null | undefined
    return stats && Number(stats['setupCount'] ?? 0) >= 1 && registerResult?.ok === true ? stats : undefined
  }, 120000)
}

export const addonT17RemoteSshCases: Array<[string, () => Promise<void>]> = [
  // ---- 阶段 R1：全装载 ----
  ['附加组件 T17：远端同宿主接入与安装面证据（#366）', async () => {
    const name = '附加组件 T17：远端同宿主接入与安装面证据（#366）'
    if (!sshSession() || !phaseMatch('R1')) {
      return skipNotice(name)
    }
    // 会话语义（window 级信号，本地/远端 ext host 一致）：SSH authority、
    // 工作区 vscode-remote scheme（远端文件系统的 VSCode 映射形态）
    assert(vscode.env.remoteName === 'ssh-remote', `remoteName 应为 ssh-remote（实际 ${JSON.stringify(vscode.env.remoteName)}）`)
    const schemes = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.scheme)
    assert(schemes.length > 0 && schemes.every((s) => s === 'vscode-remote'), `工作区应全部为 vscode-remote scheme（实际 ${JSON.stringify(schemes)}）`)
    // 发行态（通道边界实证）：远端会话无法注入 VSIDIAN_TEST_HOOKS——
    // _test.* 缺席本身是断言面（发行态语义成立，与 T16 阶段 C 同构）
    const commands = await vscode.commands.getCommands(true)
    const testHooks = commands.filter((cmd) => cmd.startsWith('onegayi.vsidian._test.'))
    assert(testHooks.length === 0, `远端会话（发行态）不得注册 _test.* 钩子（实际 ${testHooks.length} 枚）`)
    // 同宿主接入（样例在远端执行时的自报观测）：主扩展与样例在同一远端
    // 扩展宿主可见（样例 activate 读远端清单拿主扩展 exports 才能注册成
    // 功——waitForRegistered 的注册成功回执是同宿主链的端到端证据）。
    // 注册链同时拉起主扩展（样例 activate 内 await ext.activate()），
    // 其命令面断言须在注册完成之后
    for (const id of [INPUT_ID, RENDERER_ID, UI_ID]) {
      const stats = await waitForRegistered(id)
      const host = stats.host
      assert(host !== undefined, `${id} stats 应携带宿主观测自报块`)
      assert(host.remoteName === 'ssh-remote', `${id} 自报 remoteName 应为 ssh-remote（实际 ${JSON.stringify(host.remoteName)}）`)
      assert(host.mainExtensionVisible === true, `${id} 在远端宿主应看到主扩展（同宿主接入）`)
      assert(host.selfExtensionUriScheme === 'file', `${id} 自报 extensionUri 应为远端盘面 file scheme（实际 ${JSON.stringify(host.selfExtensionUriScheme)}）`)
      console.log(`[#366] ${id} 远端自报：${JSON.stringify(host)}`)
    }
    // 主扩展在远端激活并暴露命令面（远端注册的命令经路由合并可见）
    const commandsAfter = await vscode.commands.getCommands(true)
    assert(commandsAfter.includes('onegayi.vsidian.openSettings'), '主扩展公开命令 openSettings 应在场（远端注册经命令路由）')
    // 安装面证据（远端清单条目 + VSIX 目录形态 + 主包排除面）由启动器
    // auditRemoteInstallSurface 承载（runner 在本地 ext host 读不到远端
    // 清单——架构事实），结果进阶段报告
    console.log('[#366] R1：远端同宿主接入与安装面证据通过')
  }],

  ['附加组件 T17：远端三类公开接入与页面装载（#366）', async () => {
    const name = '附加组件 T17：远端三类公开接入与页面装载（#366）'
    if (!sshSession() || !phaseMatch('R1')) {
      return skipNotice(name)
    }
    // 三样例发行态注册 + 默认放行（真实安装即生效——无 arm 门控）
    const inputStats = await waitForRegistered(INPUT_ID)
    assert(inputStats['behaviorsAllowed'] === true, '发行态输入样例应默认放行')
    const rendererStats = await waitForRegistered(RENDERER_ID)
    assert(rendererStats['providersAllowed'] === true, '发行态渲染样例应默认放行（安装后自动接管）')
    await waitForRegistered(UI_ID)
    // 页面资源（远端 webview 真实装载）：Custom 标签页出现——样例页面脚本
    // 经 VSCode 资源服务（webview.asWebviewUri 铸造）在远端会话装载
    await openEditorPanelPublic('t15-render.md')
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    await new Promise((r) => setTimeout(r, 250))
    await openEditorPanelPublic('t15-input.md')
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    await new Promise((r) => setTimeout(r, 250))
    // 界面命令在远端工作区真实落盘（命令 → 页面回调 → applyEdits →
    // TextDocument → 远端盘面文件）
    await openEditorPanelPublic('t15-ui.md')
    await poll('发行态命令目录出现样例命令', async () => {
      const commands = await vscode.commands.getCommands(true)
      return commands.includes(`${UI_ID}.insertTimestamp`) ? true : undefined
    })
    await vscode.commands.executeCommand(`${UI_ID}.insertTimestamp`)
    await poll('远端时间戳落盘', async () => {
      const text = await docText('t15-ui.md')
      return /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(text) ? true : undefined
    })
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    console.log('[#366] R1：远端三类公开接入与页面装载通过')
  }],

  ['附加组件 T17：远端卸载释放与手动重接（#366）', async () => {
    const name = '附加组件 T17：远端卸载释放与手动重接（#366）'
    if (!sshSession() || !phaseMatch('R1')) {
      return skipNotice(name)
    }
    // 组件公开 dispose 语义（设计 §3：手动重接 = release 后再 register）：
    // releaseAndReRegister 后 setupCount 增长、注册成功回执——远端宿主内
    // 的贡献释放与重建（代次轮换）
    const before = await waitForRegistered(UI_ID)
    const beforeSetup = Number(before['setupCount'] ?? 0)
    await vscode.commands.executeCommand(`${UI_ID}.releaseAndReRegister`)
    await poll('重接后注册成功', async () => {
      const stats = await exampleStats(UI_ID)
      const registerResult = stats?.['lastRegisterResult'] as { ok?: boolean } | null | undefined
      return stats && Number(stats['setupCount'] ?? 0) > beforeSetup && registerResult?.ok === true ? stats : undefined
    })
    // 重接后的命令重建：insertTimestamp 经页面 SDK 注册（发行态放行，
    // 面板装载即注册）——重开面板装载页面后命令目录重建且可执行落盘
    await openEditorPanelPublic('t15-ui.md')
    await poll('重接后命令目录重建', async () => {
      const commands = await vscode.commands.getCommands(true)
      return commands.includes(`${UI_ID}.insertTimestamp`) ? true : undefined
    })
    // 执行落盘断言取本用例内自洽口径（≥1）：跨用例的 TextDocument 释放
    // 后 openTextDocument 重读磁盘，前序用例未保存的时间戳不延续在场
    // （测试宿主无自动保存），不以跨用例计数为前提
    await vscode.commands.executeCommand(`${UI_ID}.insertTimestamp`)
    await poll('重接后时间戳落盘', async () => {
      const text = await docText('t15-ui.md')
      return (text.match(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g) ?? []).length >= 1 ? true : undefined
    })
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor')
    console.log('[#366] R1：远端卸载释放与手动重接通过')
  }],

  // ---- 阶段 R2：宿主不可见负向 ----
  ['附加组件 T17：宿主不可见不冒充全局安装清单（#366）', async () => {
    const name = '附加组件 T17：宿主不可见不冒充全局安装清单（#366）'
    if (!sshSession() || !phaseMatch('R2')) {
      return skipNotice(name)
    }
    // 本阶段远端镜像不含 input-behavior（当前宿主查不到），本地隔离
    // profile 的安装仍在——R1 已证同一安装下可见且工作，两报告对照即
    // 「宿主可见性 ≠ 安装状态」：不可见不产生任何安装侧归因（协调器
    // 不因缺席编造状态），其余组件接入不受影响
    const commands = await vscode.commands.getCommands(true)
    assert(!commands.includes(`${INPUT_ID}.stats`), 'R2 远端不含输入样例——其命令不应注册（不可见即查不到）')
    try {
      await vscode.commands.executeCommand(`${INPUT_ID}.stats`)
      assert(false, 'R2 会话执行输入样例命令应失败（未注册）')
    } catch (err) {
      console.log(`[T17] R2 输入样例命令缺席（预期）：${String((err as Error)?.message ?? err).slice(0, 120)}`)
    }
    // 可见组件正常接入：宿主可见面如实报告，不因缺席者受影响
    const rendererStats = await waitForRegistered(RENDERER_ID)
    assert(rendererStats.host?.mainExtensionVisible === true, '渲染样例在远端应看到主扩展（不可见面不扩大影响）')
    await waitForRegistered(UI_ID)
    // 主扩展命令面在场（远端注册经命令路由——不可见组件不影响主扩展接入）
    const commandsAfter = await vscode.commands.getCommands(true)
    assert(commandsAfter.includes('onegayi.vsidian.openSettings'), 'R2 会话主扩展公开命令应在场')
    console.log('[#366] R2：宿主不可见不冒充全局安装清单通过（对照 R1：同一安装下可见且工作）')
  }],
]
