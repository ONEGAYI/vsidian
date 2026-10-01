// jieba-wasm 资源的 vscode 层装配（#239）：globalStorage 文件端口
// （vscode.workspace.fs）+ 宿主侧 fetch（Node 18 全局 fetch——Remote SSH
// 场景在远程机执行下载）+ 逐面板资源 URI 构造（asWebviewUri 前缀面板
// 私有）+ 状态广播与用户通知（i18n）。服务纯逻辑在
// host/jiebaResourceService（端口注入，单测覆盖）。
import * as vscode from 'vscode'
import {
  JIEBA_MANIFEST_FILES,
  JIEBA_WASM_VERSION,
} from '../shared/jiebaManifest'
import { JiebaResourceService, type JiebaResourcePort, type JiebaResourceState } from './jiebaResourceService'
import { WORD_SEGMENT_SOURCE_KEY, JIEBA_CUSTOM_URL_KEY } from '../shared/settings'
import type { SettingsService } from './settingsService'
import { t } from '../shared/i18n'
import type { JiebaSourceMode } from '../shared/jiebaManifest'

export interface JiebaWiring {
  service: JiebaResourceService
  /** wordSegment.state 消息载荷（逐 webview 构造资源 URI；installed 时
   *  才携带 resources——加载入口 js 与 wasm 两文件的 webview 资源 URI） */
  stateFor(webview: Pick<vscode.Webview, 'asWebviewUri'>): JiebaResourceState & {
    resources: { js: string; wasm: string } | null
  }
}

function toRelative(root: vscode.Uri, relativePath: string): vscode.Uri {
  return vscode.Uri.joinPath(root, ...relativePath.split('/'))
}

async function fsBytes(uri: vscode.Uri): Promise<Uint8Array> {
  return new Uint8Array(await vscode.workspace.fs.readFile(uri))
}

export function createJiebaWiring(
  context: vscode.ExtensionContext,
  settingsService: SettingsService,
): JiebaWiring {
  const root = context.globalStorageUri
  const port: JiebaResourcePort = {
    async fetchBytes(url) {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${url}`)
      }
      return new Uint8Array(await response.arrayBuffer())
    },
    async stat(relativePath) {
      try {
        await vscode.workspace.fs.stat(toRelative(root, relativePath))
        return true
      } catch {
        return false
      }
    },
    read: (relativePath) => fsBytes(toRelative(root, relativePath)),
    write: (relativePath, bytes) => vscode.workspace.fs.writeFile(toRelative(root, relativePath), bytes),
    async mkdirp(relativePath) {
      await vscode.workspace.fs.createDirectory(toRelative(root, relativePath))
    },
    async rmdir(relativePath) {
      await vscode.workspace.fs.delete(toRelative(root, relativePath), { recursive: true, useTrash: false })
    },
    rename: (fromPath, toPath) => vscode.workspace.fs.rename(
      toRelative(root, fromPath), toRelative(root, toPath), { overwrite: true }),
  }
  const service = new JiebaResourceService(port, () => {
    const values = settingsService.getSnapshot()
    const mode = values[WORD_SEGMENT_SOURCE_KEY]
    const customUrl = values[JIEBA_CUSTOM_URL_KEY]
    return {
      mode: (typeof mode === 'string' ? mode : 'jsdelivr') as JiebaSourceMode,
      customUrl: typeof customUrl === 'string' ? customUrl : '',
    }
  })
  // 状态变化 → 用户通知（成功 info / 失败 warning；面板与设置页的状态
  // 推送由消费方经 onStateChanged 各自接线——通知不替代状态推送）
  service.onStateChanged(() => {
    const notice = service.getState().notice
    if (!notice) return
    if (notice.kind === 'downloaded') {
      void vscode.window.showInformationMessage(
        t('host.jiebaDownloaded', { version: JIEBA_WASM_VERSION }))
    } else if (notice.kind === 'download-failed') {
      void vscode.window.showWarningMessage(
        t('host.jiebaDownloadFailed', { detail: notice.detail }))
    } else if (notice.kind === 'deleted') {
      void vscode.window.showInformationMessage(t('host.jiebaDeleted'))
    } else if (notice.kind === 'delete-failed') {
      void vscode.window.showWarningMessage(
        t('host.jiebaDeleteFailed', { detail: notice.detail }))
    } else if (notice.kind === 'load-failed') {
      void vscode.window.showWarningMessage(
        t('host.jiebaLoadFailed', { detail: notice.detail ?? '' }))
    }
  })
  // 启动校验（不阻塞激活；篡改/损坏 → installed=false，引擎走 builtin）
  void service.verifyInstalled()
  return {
    service,
    stateFor(webview) {
      const state = service.getState()
      let resources: { js: string; wasm: string } | null = null
      if (state.installed) {
        const byName = new Map(JIEBA_MANIFEST_FILES.map((file) => [file.name, file]))
        const js = byName.get('jieba_rs_wasm.js')
        const wasm = byName.get('jieba_rs_wasm_bg.wasm')
        if (js && wasm) {
          resources = {
            js: webview.asWebviewUri(vscode.Uri.joinPath(root, 'jieba-wasm', JIEBA_WASM_VERSION, js.name)).toString(),
            wasm: webview.asWebviewUri(vscode.Uri.joinPath(root, 'jieba-wasm', JIEBA_WASM_VERSION, wasm.name)).toString(),
          }
        }
      }
      return { ...state, resources }
    },
  }
}
