// CSS 片段 vscode 层装配（#128）：CssSnippetService 的文件系统/监听端口
// 实现（workspace.fs + createFileSystemWatcher）、目录选择对话框与设置页
// 接线（SnippetPageWiring）。CssSnippetService 本体不依赖 vscode，本模块
// 是它唯一的 vscode 壳。
import * as vscode from 'vscode'
import { CssSnippetService, type CssSnippetFsPort } from './cssSnippetService'
import { isSnippetFileName } from '../shared/cssSnippets'
import { t } from '../shared/i18n'
import type { SnippetPageWiring } from './settingsPage'

/** 目录读取端口：第一层 .css 文件（含符号链接文件——目录内容属用户自管）；
 *  任何读取异常归并为 null（读取失败，服务保留最近成功清单） */
function listCssFiles(directory: string): Promise<string[] | null> {
  return Promise.resolve(vscode.workspace.fs.readDirectory(vscode.Uri.file(directory)))
    .then((entries) =>
      entries
        .filter(
          ([name, type]) =>
            (type === vscode.FileType.File || type === vscode.FileType.SymbolicLink) &&
            isSnippetFileName(name),
        )
        .map(([name]) => name),
    )
    .catch(() => null)
}

/** 监听端口：递归监听（列表只扫一层，但被嵌套引用的文件变化也要触发刷新，
 *  #129 的 @import 依赖——监听面先行，不增加本票功能）。目录暂不存在时
 *  watcher 保持注册（@parcel/watcher 对不存在基路径监听其重建），目录
 *  恢复后事件继续到达 */
function watchSnippetDirectory(directory: string, onEvent: () => void): () => void {
  const pattern = new vscode.RelativePattern(vscode.Uri.file(directory), '**/*.css')
  const watcher = vscode.workspace.createFileSystemWatcher(pattern)
  const changeSub = watcher.onDidChange(onEvent)
  const createSub = watcher.onDidCreate(onEvent)
  const deleteSub = watcher.onDidDelete(onEvent)
  return () => {
    changeSub.dispose()
    createSub.dispose()
    deleteSub.dispose()
    watcher.dispose()
  }
}

export function createSnippetFsPort(): CssSnippetFsPort {
  return { listCssFiles, watchDirectory: watchSnippetDirectory }
}

/** 设置页接线：目录选择对话框（钩子模式短路——集成测试不弹真实对话框，
 *  目录设置经 _test.setSnippetDirectory / snippets.setDirectory 消息注入），
 *  打开目录走 revealFileInOS（跨平台文件管理器），用户可见失败提示经 t() */
export function createSnippetPageWiring(service: CssSnippetService): SnippetPageWiring {
  return {
    getState: () => service.getState(),
    setDirectory: (directory) => service.setDirectory(directory),
    setEnabled: (name, enabled) => service.setEnabled(name, enabled),
    setPaused: (paused) => service.setPaused(paused),
    refresh: () => service.refresh(),
    chooseDirectory: async () => {
      if (process.env.VSIDIAN_TEST_HOOKS === '1') {
        return null
      }
      const picks = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: t('cssSnippets.chooseOpenLabel'),
      })
      const directory = picks?.[0]?.fsPath ?? null
      if (directory) {
        await service.setDirectory(directory)
      }
      return directory
    },
    openDirectory: () => {
      const directory = service.getState().directory
      if (directory) {
        void vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(directory))
      }
    },
  }
}
