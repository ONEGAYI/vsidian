// #620（V02）Remote SSH 最小闭环探针 · 三扩展共享工具。
// 探针代码（研究票产物），不进产品 VSIX，不定义产品行为。
// - 端身份采集：hostname/pid/env.remoteName/workspaceFolders URI 形态/
//   自查 extensionKind——「跑在哪端」的判定依据是 remoteName 与
//   workspaceFolders 的 URI scheme（本机 ext host 无 remoteName 且
//   workspace 是 file: 形态；remote ext host 相反），物理同机时依然可分。
// - 激活标志聚合：三个扩展 activate 时向 workspace 根下的
//   activation-log.jsonl 追加一行 JSON（remote 端经 vscode-remote URI 的
//   fsPath 用 node:fs 写；本机端经 file: 形态或环境变量路径写）。
//   物理同机使「远端文件」与「本机文件」恰在同一磁盘——探针聚合便利，
//   真实异机环境不成立，报告如实标注。

import * as vscode from 'vscode'
import { appendFileSync } from 'node:fs'
import { hostname } from 'node:os'

export const EXT_IDS = {
  workspace: 'vsidian.pdf-remote-probe-workspace',
  ui: 'vsidian.pdf-remote-probe-ui',
  dual: 'vsidian.pdf-remote-probe-dual',
  installee: 'vsidian.pdf-remote-probe-installee',
} as const

export const CMDS = {
  uiIdentity: 'vsidian.pdfRemoteProbe.ui.identity',
  uiEcho: 'vsidian.pdfRemoteProbe.ui.echo',
  uiEchoBigReturn: 'vsidian.pdfRemoteProbe.ui.echoBigReturn',
  uiThrowError: 'vsidian.pdfRemoteProbe.ui.throwError',
  uiFsProbe: 'vsidian.pdfRemoteProbe.ui.fsProbe',
  uiRenderPdf: 'vsidian.pdfRemoteProbe.ui.renderPdf',
  uiProgressStart: 'vsidian.pdfRemoteProbe.ui.progressStart',
  uiProgressPoll: 'vsidian.pdfRemoteProbe.ui.progressPoll',
  uiSleepEcho: 'vsidian.pdfRemoteProbe.ui.sleepEcho',
  uiCancelableStart: 'vsidian.pdfRemoteProbe.ui.cancelableStart',
  uiCancelTask: 'vsidian.pdfRemoteProbe.ui.cancelTask',
  uiTaskState: 'vsidian.pdfRemoteProbe.ui.taskState',
  uiSaveDialogProbe: 'vsidian.pdfRemoteProbe.ui.saveDialogProbe',
  uiHelperInstallVsix: 'vsidian.pdfRemoteProbe.ui.helperInstallVsix',
  workspaceIdentity: 'vsidian.pdfRemoteProbe.workspace.identity',
  workspaceReadFixture: 'vsidian.pdfRemoteProbe.workspace.readFixture',
  workspaceCoreLoop: 'vsidian.pdfRemoteProbe.workspace.coreLoop',
  workspacePayloadEcho: 'vsidian.pdfRemoteProbe.workspace.payloadEcho',
  workspaceErrorProbe: 'vsidian.pdfRemoteProbe.workspace.errorProbe',
  workspaceProgressLoop: 'vsidian.pdfRemoteProbe.workspace.progressLoop',
  workspaceLateAndCancel: 'vsidian.pdfRemoteProbe.workspace.lateAndCancel',
  workspaceDualProbe: 'vsidian.pdfRemoteProbe.workspace.dualProbe',
  workspaceInstallProbe: 'vsidian.pdfRemoteProbe.workspace.installProbe',
  workspaceSaveDialogProbe: 'vsidian.pdfRemoteProbe.workspace.saveDialogProbe',
  workspaceDisconnectFlight: 'vsidian.pdfRemoteProbe.workspace.disconnectFlight',
  dualIdentity: 'vsidian.pdfRemoteProbe.dual.identity',
} as const

export const ACTIVATION_LOG_NAME = 'activation-log.jsonl'

export interface EndIdentity {
  extId: string
  ts: number
  hostname: string
  platform: string
  pid: number
  /** vscode.env.remoteName：窗口级 authority（两端都可能非空，不能单独作端判据）。 */
  envRemoteName: string | null
  /** process.execPath：local ext host 指向宿主 Electron；remote ext host 指向 vscode-server 的 node.exe——铁判据。 */
  execPath: string
  /** process.versions.electron：仅 local ext host（Electron 进程）存在。 */
  electronVersion: string | null
  nodeVersion: string
  /** 本端 workspaceFolders（1.82.3 实测：remote 窗口的 local ext host 为空数组）。 */
  workspaceFolderUris: string[]
  /** 自查（本端注册表）该扩展的 extensionKind 数值：1=UI，2=Workspace。 */
  extensionKindSelf: number | null
  /** process.env.VSIDIAN_* 在本端是否可见（宿主 env 与 server env 的边界取证）。 */
  hostEnvMarkerVisible: boolean
}

/** 端判定：execPath 含 vscode-server 或 cli/servers（0.105 Windows 远端的
 * server 实际跑在 ~/.vscode/cli/servers/Stable-<commit>/server/node.exe）→
 * remote（server node）；含 electron 版本 → local。 */
export function endKindOf(identity: { execPath: string; electronVersion: string | null }): 'remote(server-node)' | 'local(host-electron)' | 'unknown' {
  if (/\.vscode-server[\\/]/.test(identity.execPath) || /\.vscode[\\/]cli[\\/]servers[\\/]/.test(identity.execPath)) return 'remote(server-node)'
  if (identity.electronVersion) return 'local(host-electron)'
  return 'unknown'
}

/** 采集本端身份（用于 identity 命令返回与激活标志）。 */
export function collectIdentity(extId: string): EndIdentity {
  const folders = vscode.workspace.workspaceFolders ?? []
  const self = vscode.extensions.getExtension(extId)
  return {
    extId,
    ts: Date.now(),
    hostname: hostname(),
    platform: process.platform,
    pid: process.pid,
    envRemoteName: vscode.env.remoteName ?? null,
    execPath: process.execPath,
    electronVersion: process.versions.electron ?? null,
    nodeVersion: process.versions.node,
    workspaceFolderUris: folders.map((folder) => folder.uri.toString()),
    extensionKindSelf: self ? self.extensionKind : null,
    hostEnvMarkerVisible: process.env.VSIDIAN_PDF_REMOTE_HOST_ENV_MARKER === '1',
  }
}

/** 追加激活标志行。三个候选路径按序尝试（remote 端命中 vscode-remote 形态，
 * 本机端命中 file: 形态或宿主环境变量路径）。返回命中的绝对路径或 null。 */
export function appendActivationLine(line: Record<string, unknown>): string | null {
  const payload = JSON.stringify(line)
  const candidates: string[] = []
  const folder = vscode.workspace.workspaceFolders?.[0]
  if (folder) {
    candidates.push(vscode.Uri.joinPath(folder.uri, ACTIVATION_LOG_NAME).fsPath)
  }
  if (process.env.VSIDIAN_PDF_REMOTE_ACTIVATION_LOG) {
    candidates.push(process.env.VSIDIAN_PDF_REMOTE_ACTIVATION_LOG)
  }
  for (const candidate of candidates) {
    try {
      appendFileSync(candidate, payload + '\n')
      return candidate
    } catch {
      // 换下一候选（形态不可达或路径不存在）
    }
  }
  return null
}
